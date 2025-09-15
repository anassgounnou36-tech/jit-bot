import { ethers } from 'ethers';
import { EventEmitter } from 'events';
import config from '../../config.json';
import { getLogger } from '../logging/logger';

export interface PendingSwapDetected {
  id: string;
  poolId: string;
  poolFeeTier: number;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOutEstimated: string;
  amountUSD: string;
  from: string;
  to: string;
  rawTxHex: string;
  calldata: string;
  gasLimitEstimate: string;
  timestamp: number;
}

// Legacy interface for backward compatibility
export interface PendingSwap {
  hash: string;
  from: string;
  to: string;
  value: string;
  data: string;
  gasPrice: string;
  gasLimit: string;
  nonce: number;
  pool: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOutMinimum: string;
  expectedPrice: string;
  estimatedProfit: string;
  // New field for raw signed transaction bytes
  rawTransaction?: string;
}

export class MempoolWatcher extends EventEmitter {
  private provider: ethers.providers.WebSocketProvider;
  private fallbackProvider?: ethers.providers.JsonRpcProvider;
  private logger: any;
  
  private readonly UNISWAP_V3_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
  private readonly UNISWAP_V3_ROUTER_V2 = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45'; // SwapRouter02
  private readonly MIN_SWAP_THRESHOLD = ethers.utils.parseEther('10'); // 10 ETH minimum
  
  // Uniswap V3 function signatures
  private readonly UNISWAP_V3_SIGNATURES = {
    exactInputSingle: '0x414bf389', // exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))
    exactInput: '0xc04b8d59', // exactInput((bytes,address,uint256,uint256,uint256))
    multicall: '0xac9650d8', // multicall(uint256,bytes[])
    swap: '0x128acb08' // swap(address,bool,int256,uint160,bytes)
  };

  constructor(rpcUrl: string, fallbackApiUrl?: string) {
    super();
    this.logger = getLogger().child({ component: 'mempool-watcher' });
    this.provider = new ethers.providers.WebSocketProvider(rpcUrl);
    
    // Setup fallback provider if vendor API URL is configured
    if (fallbackApiUrl) {
      this.fallbackProvider = new ethers.providers.JsonRpcProvider(fallbackApiUrl);
      this.logger.info({
        msg: 'Fallback provider configured',
        fallbackUrl: fallbackApiUrl.replace(/\/\/.*@/, '//***@') // Hide credentials
      });
    }
  }

  async start(): Promise<void> {
    this.logger.info('Starting mempool watcher for raw signed tx capture');
    
    try {
      // Subscribe to pending transactions
      await this.provider.send('eth_subscribe', ['newPendingTransactions']);
      
      this.provider.on('pending', (txHash: string) => {
        this.processPendingTransactionEnhanced(txHash);
      });

      this.logger.info('Mempool watcher started successfully with raw tx capture');
    } catch (error: any) {
      this.logger.error({
        err: error,
        msg: 'Failed to start mempool watcher'
      });
      throw error;
    }
  }

  async stop(): Promise<void> {
    await this.provider.destroy();
    this.logger.info('Mempool watcher stopped');
  }

  /**
   * Enhanced pending transaction processing with raw signed tx capture
   */
  private async processPendingTransactionEnhanced(txHash: string): Promise<void> {
    try {
      // Step 1: Try to get raw signed transaction bytes immediately
      const rawTxHex = await this.getRawSignedTransaction(txHash);
      
      // Step 2: Get transaction details
      const tx = await this.getTransactionWithFallback(txHash);
      
      if (!tx || !tx.to) {
        return;
      }

      // Step 3: Check if transaction targets Uniswap V3 routers
      if (!this.isUniswapV3Transaction(tx.to)) {
        return;
      }

      // Step 4: Parse and decode Uniswap V3 swap transaction
      const swapData = await this.parseUniswapV3Transaction(tx, rawTxHex);
      
      if (!swapData) {
        return;
      }

      // Step 5: Check if swap meets our criteria
      if (this.shouldProcessSwap(swapData)) {
        this.logger.info({
          msg: 'Found potential JIT opportunity',
          txHash,
          poolId: swapData.poolId,
          amountUSD: swapData.amountUSD
        });
        
        // Emit both new and legacy events for backward compatibility
        this.emit('PendingSwapDetected', swapData);
        this.emit('swapDetected', this.convertToLegacyFormat(swapData, tx));
      }

    } catch (error: any) {
      // Log detailed errors for debugging but don't throw
      // Mempool processing should be resilient to individual tx failures
      this.logger.debug({
        msg: 'Transaction processing failed',
        txHash,
        error: error.message
      });
    }
  }

  /**
   * Get raw signed transaction bytes with fallback strategy
   * Primary: local node raw tx APIs
   * Fallback: vendor API if configured
   */
  async getRawSignedTransaction(txHash: string): Promise<string> {
    try {
      // Strategy 1: Try local node raw transaction method
      const rawTx = await this.tryLocalNodeRawTx(txHash);
      if (rawTx) {
        this.logger.debug({
          msg: 'Raw transaction captured via local node',
          txHash,
          method: 'local_node'
        });
        return rawTx;
      }

      // Strategy 2: Try vendor API if configured
      if (this.fallbackProvider) {
        const vendorRawTx = await this.tryVendorApiRawTx(txHash);
        if (vendorRawTx) {
          this.logger.debug({
            msg: 'Raw transaction captured via vendor API',
            txHash,
            method: 'vendor_api'
          });
          return vendorRawTx;
        }
      }

      // Strategy 3: Reconstruct from transaction object (incomplete but better than nothing)
      const tx = await this.provider.getTransaction(txHash);
      if (tx) {
        const reconstructed = this.reconstructRawTransaction(tx);
        if (reconstructed) {
          this.logger.debug({
            msg: 'Raw transaction reconstructed from tx object',
            txHash,
            method: 'reconstructed',
            note: 'May be missing signature components'
          });
          return reconstructed;
        }
      }

      throw new Error('No method available to capture raw transaction');
      
    } catch (error: any) {
      this.logger.warn({
        msg: 'Failed to capture raw signed transaction',
        txHash,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Try to get raw transaction using local node APIs
   */
  private async tryLocalNodeRawTx(txHash: string): Promise<string | null> {
    try {
      // Try eth_getRawTransactionByHash (non-standard but supported by some clients)
      const rawTx = await this.provider.send('eth_getRawTransactionByHash', [txHash]);
      return rawTx;
    } catch (error: any) {
      this.logger.debug({
        msg: 'Local node raw tx method not supported',
        txHash,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Try to get raw transaction using vendor API
   */
  private async tryVendorApiRawTx(txHash: string): Promise<string | null> {
    if (!this.fallbackProvider) {
      return null;
    }

    try {
      // Try vendor-specific methods for raw transaction data
      const rawTx = await this.fallbackProvider.send('eth_getRawTransactionByHash', [txHash]);
      return rawTx;
    } catch (error: any) {
      this.logger.debug({
        msg: 'Vendor API raw tx method failed',
        txHash,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Reconstruct raw transaction from transaction object (fallback method)
   */
  private reconstructRawTransaction(tx: ethers.providers.TransactionResponse): string | null {
    try {
      // This is incomplete without signature (v, r, s) but better than nothing
      const txData = {
        to: tx.to,
        value: tx.value,
        data: tx.data,
        gasLimit: tx.gasLimit,
        gasPrice: tx.gasPrice,
        maxFeePerGas: tx.maxFeePerGas,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
        nonce: tx.nonce,
        type: tx.type || 0,
        chainId: tx.chainId
      };

      return ethers.utils.serializeTransaction(txData);
    } catch (error: any) {
      this.logger.debug({
        msg: 'Transaction reconstruction failed',
        txHash: tx.hash,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Get transaction with fallback provider support
   */
  private async getTransactionWithFallback(txHash: string): Promise<ethers.providers.TransactionResponse | null> {
    try {
      // Try primary provider first
      const tx = await this.provider.getTransaction(txHash);
      if (tx) {
        return tx;
      }

      // Try fallback provider if configured
      if (this.fallbackProvider) {
        return await this.fallbackProvider.getTransaction(txHash);
      }

      return null;
    } catch (error: any) {
      this.logger.debug({
        msg: 'Failed to get transaction from both providers',
        txHash,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Check if transaction targets Uniswap V3 routers
   */
  private isUniswapV3Transaction(to: string): boolean {
    const normalizedTo = to.toLowerCase();
    return normalizedTo === this.UNISWAP_V3_ROUTER.toLowerCase() ||
           normalizedTo === this.UNISWAP_V3_ROUTER_V2.toLowerCase();
  }

  /**
   * Parse and decode Uniswap V3 transactions (exactInputSingle, multicall, pool.swap)
   */
  private async parseUniswapV3Transaction(
    tx: ethers.providers.TransactionResponse, 
    rawTxHex: string
  ): Promise<PendingSwapDetected | null> {
    try {
      const functionSelector = tx.data.slice(0, 10);
      
      this.logger.debug({
        msg: 'Parsing Uniswap V3 transaction',
        txHash: tx.hash,
        functionSelector,
        dataLength: tx.data.length
      });

      switch (functionSelector) {
        case this.UNISWAP_V3_SIGNATURES.exactInputSingle:
          return await this.parseExactInputSingle(tx, rawTxHex);
          
        case this.UNISWAP_V3_SIGNATURES.exactInput:
          return await this.parseExactInput(tx, rawTxHex);
          
        case this.UNISWAP_V3_SIGNATURES.multicall:
          return await this.parseMulticall(tx, rawTxHex);
          
        default:
          this.logger.debug({
            msg: 'Unrecognized Uniswap V3 function',
            txHash: tx.hash,
            functionSelector
          });
          return null;
      }
    } catch (error: any) {
      this.logger.debug({
        msg: 'Failed to parse Uniswap V3 transaction',
        txHash: tx.hash,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Parse exactInputSingle function call
   */
  private async parseExactInputSingle(
    tx: ethers.providers.TransactionResponse,
    rawTxHex: string
  ): Promise<PendingSwapDetected | null> {
    try {
      const iface = new ethers.utils.Interface([
        'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)'
      ]);

      const parsed = iface.parseTransaction({ data: tx.data });
      const params = parsed.args[0];
      
      // Find the target pool
      const targetPool = this.findTargetPool(params.tokenIn, params.tokenOut, params.fee);
      if (!targetPool) {
        return null;
      }

      // Estimate USD value (simplified - would use price oracle in production)
      const amountUSD = await this.estimateUSDValue(params.tokenIn, params.amountIn);

      return {
        id: tx.hash!,
        poolId: targetPool.pool,
        poolFeeTier: params.fee,
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn.toString(),
        amountOutEstimated: params.amountOutMinimum.toString(),
        amountUSD: amountUSD.toString(),
        from: tx.from,
        to: tx.to!,
        rawTxHex: rawTxHex,
        calldata: tx.data,
        gasLimitEstimate: tx.gasLimit?.toString() ?? '0',
        timestamp: Math.floor(Date.now() / 1000)
      };
    } catch (error: any) {
      this.logger.debug({
        msg: 'Failed to parse exactInputSingle',
        txHash: tx.hash,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Parse exactInput function call (multi-hop swaps)
   */
  private async parseExactInput(
    tx: ethers.providers.TransactionResponse,
    rawTxHex: string
  ): Promise<PendingSwapDetected | null> {
    try {
      const iface = new ethers.utils.Interface([
        'function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum)) external payable returns (uint256 amountOut)'
      ]);

      const parsed = iface.parseTransaction({ data: tx.data });
      const params = parsed.args[0];
      
      // Decode the path to get first and last tokens
      const path = this.decodePath(params.path);
      if (!path || path.length < 2) {
        return null;
      }

      // Use the first pool in the path for JIT opportunity
      const firstHop = path[0];
      const targetPool = this.findTargetPool(firstHop.tokenIn, firstHop.tokenOut, firstHop.fee);
      if (!targetPool) {
        return null;
      }

      const amountUSD = await this.estimateUSDValue(firstHop.tokenIn, params.amountIn);

      return {
        id: tx.hash!,
        poolId: targetPool.pool,
        poolFeeTier: firstHop.fee,
        tokenIn: firstHop.tokenIn,
        tokenOut: firstHop.tokenOut,
        amountIn: params.amountIn.toString(),
        amountOutEstimated: params.amountOutMinimum.toString(),
        amountUSD: amountUSD.toString(),
        from: tx.from,
        to: tx.to!,
        rawTxHex: rawTxHex,
        calldata: tx.data,
        gasLimitEstimate: tx.gasLimit?.toString() ?? '0',
        timestamp: Math.floor(Date.now() / 1000)
      };
    } catch (error: any) {
      this.logger.debug({
        msg: 'Failed to parse exactInput',
        txHash: tx.hash,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Parse multicall function (contains multiple operations)
   */
  private async parseMulticall(
    tx: ethers.providers.TransactionResponse,
    rawTxHex: string
  ): Promise<PendingSwapDetected | null> {
    try {
      const iface = new ethers.utils.Interface([
        'function multicall(uint256 deadline, bytes[] calldata data) external payable returns (bytes[] memory results)',
        'function multicall(bytes[] calldata data) external payable returns (bytes[] memory results)'
      ]);

      const parsed = iface.parseTransaction({ data: tx.data });
      const calls = parsed.args.length === 2 ? parsed.args[1] : parsed.args[0];
      
      // Look for swap calls within the multicall
      for (const callData of calls) {
        const innerSelector = callData.slice(0, 10);
        
        if (innerSelector === this.UNISWAP_V3_SIGNATURES.exactInputSingle) {
          // Create a temporary transaction object for the inner call
          const innerTx = { ...tx, data: callData };
          return await this.parseExactInputSingle(innerTx, rawTxHex);
        }
        
        if (innerSelector === this.UNISWAP_V3_SIGNATURES.exactInput) {
          const innerTx = { ...tx, data: callData };
          return await this.parseExactInput(innerTx, rawTxHex);
        }
      }
      
      return null;
    } catch (error: any) {
      this.logger.debug({
        msg: 'Failed to parse multicall',
        txHash: tx.hash,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Decode Uniswap V3 path for multi-hop swaps
   */
  private decodePath(path: string): Array<{tokenIn: string, tokenOut: string, fee: number}> | null {
    try {
      // Uniswap V3 path encoding: token0 (20 bytes) + fee (3 bytes) + token1 (20 bytes) + ...
      const pathBytes = ethers.utils.arrayify(path);
      const hops: Array<{tokenIn: string, tokenOut: string, fee: number}> = [];
      
      for (let i = 0; i < pathBytes.length - 20; i += 23) {
        if (i + 43 > pathBytes.length) break;
        
        const tokenIn = ethers.utils.hexlify(pathBytes.slice(i, i + 20));
        const feeBytes = pathBytes.slice(i + 20, i + 23);
        const fee = (feeBytes[0] << 16) | (feeBytes[1] << 8) | feeBytes[2];
        const tokenOut = ethers.utils.hexlify(pathBytes.slice(i + 23, i + 43));
        
        hops.push({ tokenIn, tokenOut, fee });
      }
      
      return hops;
    } catch (error: any) {
      this.logger.debug({
        msg: 'Failed to decode swap path',
        error: error.message
      });
      return null;
    }
  }

  /**
   * Find target pool configuration from config
   */
  private findTargetPool(tokenIn: string, tokenOut: string, fee: number): any {
    // Support pool filtering if pools are specified
    const allowedPoolIds = process.env.POOL_IDS?.split(',') || [];
    
    return config.targets.find(target => {
      const isMatchingTokensAndFee = target.fee === fee && (
        (target.token0.toLowerCase() === tokenIn.toLowerCase() && 
         target.token1.toLowerCase() === tokenOut.toLowerCase()) ||
        (target.token1.toLowerCase() === tokenIn.toLowerCase() && 
         target.token0.toLowerCase() === tokenOut.toLowerCase())
      );
      
      // If pool filtering is enabled, check if this pool is allowed
      if (allowedPoolIds.length > 0) {
        return isMatchingTokensAndFee && allowedPoolIds.includes(target.pool);
      }
      
      return isMatchingTokensAndFee;
    });
  }

  /**
   * Estimate USD value of token amount (simplified implementation)
   */
  private async estimateUSDValue(tokenAddress: string, amount: ethers.BigNumber): Promise<ethers.BigNumber> {
    try {
      // In production, this would use a price oracle
      // For now, use simplified ETH conversion rates
      const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
      const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
      
      const normalizedToken = tokenAddress.toLowerCase();
      
      if (normalizedToken === WETH.toLowerCase()) {
        // Assume 1 ETH = $2000 for estimation
        return amount.mul(2000).div(ethers.utils.parseEther('1'));
      } else if (normalizedToken === USDC.toLowerCase() || normalizedToken === USDT.toLowerCase()) {
        // Stablecoins: 1:1 USD (accounting for 6 decimals for USDC/USDT)
        return amount.mul(ethers.utils.parseEther('1')).div(ethers.utils.parseUnits('1', 6));
      } else {
        // For other tokens, estimate based on ETH value (simplified)
        const ethAmount = amount.div(ethers.utils.parseEther('0.001')); // Assume 1000:1 ratio
        return ethAmount.mul(2000).div(1000);
      }
    } catch (error: any) {
      this.logger.debug({
        msg: 'Failed to estimate USD value',
        tokenAddress,
        error: error.message
      });
      return ethers.BigNumber.from(0);
    }
  }

  /**
   * Check if swap meets processing criteria
   */
  private shouldProcessSwap(swap: PendingSwapDetected): boolean {
    try {
      // Check minimum swap size
      const amountIn = ethers.BigNumber.from(swap.amountIn);
      if (amountIn.lt(this.MIN_SWAP_THRESHOLD)) {
        return false;
      }

      // Check minimum USD value
      const amountUSD = ethers.BigNumber.from(swap.amountUSD);
      const minUSDThreshold = ethers.utils.parseEther('1000'); // $1000 minimum
      if (amountUSD.lt(minUSDThreshold)) {
        return false;
      }

      // Additional profitability checks can be added here
      return true;
    } catch (error: any) {
      this.logger.debug({
        msg: 'Error checking swap criteria',
        swapId: swap.id,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Convert new format to legacy format for backward compatibility
   */
  private convertToLegacyFormat(swapData: PendingSwapDetected, tx: ethers.providers.TransactionResponse): PendingSwap {
    return {
      hash: swapData.id,
      from: swapData.from,
      to: swapData.to,
      value: tx.value?.toString() ?? '0',
      data: swapData.calldata,
      gasPrice: tx.gasPrice?.toString() || '0',
      gasLimit: swapData.gasLimitEstimate,
      nonce: tx.nonce,
      pool: swapData.poolId,
      tokenIn: swapData.tokenIn,
      tokenOut: swapData.tokenOut,
      amountIn: swapData.amountIn,
      amountOutMinimum: swapData.amountOutEstimated,
      expectedPrice: '0', // Legacy field
      estimatedProfit: '0', // Legacy field
      rawTransaction: swapData.rawTxHex
    };
  }


}