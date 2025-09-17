import WebSocket from 'ws';
import { ethers } from 'ethers';
import { EventEmitter } from 'events';
import { getLogger } from '../logging/logger';

export interface PendingSwapDetected {
  candidateId: string;
  txHash: string;
  rawTxHex: string;
  poolAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountInHuman: string;
  feeTier: number;
  direction: 'token0->token1' | 'token1->token0';
  estimatedUsd: string;
  blockNumberSeen: number;
  timestamp: number;
  provider: 'local-node' | 'alchemy' | 'blocknative';
  decodedCall: {
    method: string;
    params: any;
  };
  // Legacy compatibility fields
  id?: string;
  poolId?: string;
  amountUSD?: string;
  poolFeeTier?: number;
  calldata?: string;
  amountOutEstimated?: string;
  from?: string;
  to?: string;
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
  rawTransaction?: string;
}

export class MempoolWatcher extends EventEmitter {
  private ws: WebSocket | null = null;
  private provider: ethers.providers.WebSocketProvider;
  private fallbackProvider?: ethers.providers.JsonRpcProvider;
  private logger: any;
  private config: any;
  private metrics: any;
  
  private readonly UNISWAP_V3_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
  private readonly UNISWAP_V3_ROUTER_V2 = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45';
  
  private readonly UNISWAP_V3_SIGNATURES = {
    exactInputSingle: '0x414bf389',
    exactInput: '0xc04b8d59',
    multicall: '0xac9650d8',
    swap: '0x128acb08'
  };

  private targetPools: Map<string, any> = new Map();

  constructor(config: any, provider: ethers.providers.WebSocketProvider, fallbackProvider?: ethers.providers.JsonRpcProvider, metrics?: any) {
    super();
    this.config = config;
    this.logger = getLogger().child({ component: 'mempool-watcher' });
    this.provider = provider;
    this.fallbackProvider = fallbackProvider;
    this.metrics = metrics;
    
    this.initializeTargetPools();
    
    this.logger.info({
      msg: 'MempoolWatcher initialized',
      targetPoolsCount: this.targetPools.size,
      minSwapEth: config.minSwapEth,
      minSwapUsd: config.minSwapUsd,
      allowReconstruct: config.allowReconstructRawTx
    });
  }

  private initializeTargetPools(): void {
    for (const pool of this.config.pools) {
      const key = `${pool.token0}-${pool.token1}-${pool.fee}`;
      this.targetPools.set(key, pool);
      
      const reverseKey = `${pool.token1}-${pool.token0}-${pool.fee}`;
      this.targetPools.set(reverseKey, { ...pool, direction: 'reverse' });
    }
    
    this.logger.debug({
      msg: 'Target pools initialized',
      pools: Array.from(this.targetPools.keys())
    });
  }

  async start(): Promise<void> {
    this.logger.info('Starting mempool watcher - always on for real-time monitoring');
    
    try {
      await this.provider.send('eth_subscribe', ['newPendingTransactions']);
      
      this.provider.on('pending', (txHash: string) => {
        this.processPendingTransactionEnhanced(txHash).catch(error => {
          this.logger.debug({
            err: error,
            txHash,
            msg: 'Error processing pending transaction'
          });
        });
      });

      this.logger.info({
        msg: 'Mempool watcher started successfully',
        provider: 'ws-subscription',
        features: ['raw-tx-capture', 'uniswap-decoding', 'pool-matching']
      });
    } catch (error: any) {
      this.logger.error({
        err: error,
        msg: 'Failed to start mempool watcher'
      });
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      if (this.provider) {
        await this.provider.destroy();
      }
      if (this.ws) {
        this.ws.close();
      }
      this.logger.info('Mempool watcher stopped');
    } catch (error: any) {
      this.logger.error({
        err: error,
        msg: 'Error stopping mempool watcher'
      });
    }
  }

  private async processPendingTransactionEnhanced(txHash: string): Promise<void> {
    if (this.metrics) {
      this.metrics.incrementMempoolTxsSeen('local-node');
    }

    try {
      // Step 1: Get transaction from mempool
      const tx = await this.provider.getTransaction(txHash);
      if (!tx || !tx.to) {
        return;
      }

      // Step 2: Check if it's a Uniswap V3 transaction
      if (!this.isUniswapV3Transaction(tx.to)) {
        return;
      }

      // Step 3: Check for victim replacement
      const currentTx = await this.provider.getTransaction(txHash);
      if (!currentTx || currentTx.hash !== txHash) {
        if (this.metrics) {
          this.metrics.incrementVictimReplacements();
        }
        this.logger.warn({
          txHash,
          msg: 'VictimReplaced',
          reason: 'transaction_replaced_before_processing'
        });
        return;
      }

      // Step 4: Check if already included
      if (currentTx.blockNumber) {
        this.logger.debug({
          txHash,
          blockNumber: currentTx.blockNumber,
          msg: 'CandidateRejected',
          reason: 'already_included'
        });
        return;
      }

      // Step 5: Attempt to get raw transaction hex
      const rawTxHex = await this.getRawSignedTransaction(txHash);
      if (!rawTxHex && !this.config.allowReconstructRawTx) {
        if (this.metrics) {
          this.metrics.incrementMempoolTxsRawMissing('local-node');
        }
        this.logger.debug({
          txHash,
          msg: 'CandidateRejected',
          reason: 'raw_tx_unavailable'
        });
        return;
      }

      if (this.metrics) {
        this.metrics.incrementMempoolTxsRawFetched('local-node');
      }

      // Step 6: Parse transaction data
      const swapData = await this.parseSwapTransaction(tx, rawTxHex || '0x');
      if (!swapData) {
        return;
      }

      // Step 7: Validate thresholds
      const amountEth = parseFloat(ethers.utils.formatEther(swapData.amountIn));
      const estimatedUsdValue = parseFloat(swapData.estimatedUsd);

      if (amountEth < this.config.minSwapEth && estimatedUsdValue < this.config.minSwapUsd) {
        if (this.metrics) {
          this.metrics.incrementMempoolSwapsRejected('amount_too_small');
        }
        this.logger.debug({
          txHash,
          amountEth,
          estimatedUsdValue,
          msg: 'CandidateRejected',
          reason: 'amount_below_threshold'
        });
        return;
      }

      if (this.metrics) {
        this.metrics.incrementMempoolSwapsMatched();
      }

      // Step 8: Emit PendingSwapDetected
      this.logger.info({
        msg: 'PendingSwapDetected',
        candidateId: swapData.candidateId,
        txHash: swapData.txHash,
        poolAddress: swapData.poolAddress,
        tokenIn: swapData.tokenIn,
        tokenOut: swapData.tokenOut,
        amountIn: swapData.amountIn,
        amountInHuman: swapData.amountInHuman,
        feeTier: swapData.feeTier,
        direction: swapData.direction,
        estimatedUsd: swapData.estimatedUsd,
        blockNumberSeen: swapData.blockNumberSeen,
        timestamp: swapData.timestamp,
        provider: swapData.provider,
        decodedCall: swapData.decodedCall
      });

      this.emit('PendingSwapDetected', swapData);

    } catch (error: any) {
      this.logger.debug({
        err: error,
        txHash,
        msg: 'Failed to process pending transaction'
      });
    }
  }

  private async getRawSignedTransaction(txHash: string): Promise<string> {
    try {
      // Try local node first
      const rawTx = await this.provider.send('eth_getRawTransactionByHash', [txHash]);
      if (rawTx && rawTx !== '0x') {
        return rawTx;
      }
    } catch (error: any) {
      this.logger.debug({
        err: error,
        txHash,
        msg: 'Failed to get raw transaction from local node'
      });
    }

    // Try fallback provider if available
    if (this.fallbackProvider) {
      try {
        const rawTx = await this.fallbackProvider.send('eth_getRawTransactionByHash', [txHash]);
        if (rawTx && rawTx !== '0x') {
          return rawTx;
        }
      } catch (error: any) {
        this.logger.debug({
          err: error,
          txHash,
          msg: 'Failed to get raw transaction from fallback provider'
        });
      }
    }

    return '';
  }

  private isUniswapV3Transaction(to: string): boolean {
    const normalizedTo = to.toLowerCase();
    return normalizedTo === this.UNISWAP_V3_ROUTER.toLowerCase() ||
           normalizedTo === this.UNISWAP_V3_ROUTER_V2.toLowerCase();
  }

  private async parseSwapTransaction(tx: ethers.providers.TransactionResponse, rawTxHex: string): Promise<PendingSwapDetected | null> {
    try {
      const iface = new ethers.utils.Interface([
        'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96))',
        'function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum))',
        'function multicall(uint256 deadline, bytes[] data) external payable',
        'function swap(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)'
      ]);

      // Try to decode the transaction
      const methodId = tx.data.slice(0, 10);
      let parsed: any;

      try {
        parsed = iface.parseTransaction({ data: tx.data, value: tx.value });
      } catch (error: any) {
        this.logger.debug({
          txHash: tx.hash,
          methodId,
          msg: 'Failed to parse transaction',
          err: error.message
        });
        return null;
      }

      // Handle different swap functions
      switch (parsed.name) {
        case 'exactInputSingle':
          return await this.parseExactInputSingle(tx, rawTxHex, parsed.args);
        
        case 'exactInput':
          return await this.parseExactInput(tx, rawTxHex, parsed.args);
        
        case 'multicall':
          return await this.parseMulticall(tx, rawTxHex, parsed.args);
        
        default:
          this.logger.debug({
            txHash: tx.hash,
            method: parsed.name,
            msg: 'Unsupported swap method'
          });
          return null;
      }
    } catch (error: any) {
      this.logger.debug({
        err: error,
        txHash: tx.hash,
        msg: 'Error parsing swap transaction'
      });
      return null;
    }
  }

  private async parseExactInputSingle(
    tx: ethers.providers.TransactionResponse, 
    rawTxHex: string, 
    args: any
  ): Promise<PendingSwapDetected | null> {
    try {
      const params = args[0]; // exactInputSingle takes a struct as first param
      const { tokenIn, tokenOut, fee, amountIn } = params;

      // Find target pool
      const poolKey = `${tokenIn.toLowerCase()}-${tokenOut.toLowerCase()}-${fee}`;
      const reversePoolKey = `${tokenOut.toLowerCase()}-${tokenIn.toLowerCase()}-${fee}`;
      
      const targetPool = this.targetPools.get(poolKey) || this.targetPools.get(reversePoolKey);
      if (!targetPool) {
        return null; // Not a pool we're monitoring
      }

      // Determine direction
      const direction = tokenIn.toLowerCase() === targetPool.token0.toLowerCase() ? 'token0->token1' : 'token1->token0';

      // Estimate USD value (simplified)
      const estimatedUsdValue = await this.estimateUSDValue(tokenIn, amountIn);

      const currentBlock = await this.provider.getBlockNumber();

      const swapData: PendingSwapDetected = {
        candidateId: `${tx.hash}_${Math.floor(Date.now() / 1000)}`,
        txHash: tx.hash!,
        rawTxHex,
        poolAddress: targetPool.address,
        tokenIn,
        tokenOut,
        amountIn: amountIn.toString(),
        amountInHuman: this.formatTokenAmount(amountIn, tokenIn === targetPool.token0 ? targetPool.decimals0 : targetPool.decimals1),
        feeTier: fee,
        direction,
        estimatedUsd: estimatedUsdValue.toString(),
        blockNumberSeen: currentBlock,
        timestamp: Math.floor(Date.now() / 1000),
        provider: 'local-node',
        decodedCall: {
          method: 'exactInputSingle',
          params: {
            tokenIn,
            tokenOut,
            fee,
            amountIn: amountIn.toString(),
            recipient: params.recipient,
            deadline: params.deadline.toString()
          }
        },
        // Legacy compatibility
        id: tx.hash,
        poolId: targetPool.pool,
        amountUSD: estimatedUsdValue.toString(),
        poolFeeTier: fee,
        calldata: tx.data
      };

      if (this.metrics) {
        this.metrics.incrementMempoolSwapsDecoded();
      }

      return swapData;
    } catch (error: any) {
      this.logger.debug({
        err: error,
        txHash: tx.hash,
        msg: 'Error parsing exactInputSingle'
      });
      return null;
    }
  }

  private async parseExactInput(
    tx: ethers.providers.TransactionResponse, 
    rawTxHex: string, 
    args: any
  ): Promise<PendingSwapDetected | null> {
    try {
      const { path, amountIn } = args;
      
      // Decode path to get tokens and fees
      const pathInfo = this.decodePath(path);
      if (!pathInfo || pathInfo.tokens.length < 2) {
        return null;
      }

      // For multi-hop swaps, we focus on the first hop
      const tokenIn = pathInfo.tokens[0];
      const tokenOut = pathInfo.tokens[1];
      const fee = pathInfo.fees[0];

      // Find target pool for first hop
      const poolKey = `${tokenIn.toLowerCase()}-${tokenOut.toLowerCase()}-${fee}`;
      const reversePoolKey = `${tokenOut.toLowerCase()}-${tokenIn.toLowerCase()}-${fee}`;
      
      const targetPool = this.targetPools.get(poolKey) || this.targetPools.get(reversePoolKey);
      if (!targetPool) {
        return null; // Not a pool we're monitoring
      }

      // Determine direction
      const direction = tokenIn.toLowerCase() === targetPool.token0.toLowerCase() ? 'token0->token1' : 'token1->token0';

      // Estimate USD value
      const estimatedUsdValue = await this.estimateUSDValue(tokenIn, amountIn);

      const currentBlock = await this.provider.getBlockNumber();

      const swapData: PendingSwapDetected = {
        candidateId: `${tx.hash}_${Math.floor(Date.now() / 1000)}`,
        txHash: tx.hash!,
        rawTxHex,
        poolAddress: targetPool.address,
        tokenIn,
        tokenOut,
        amountIn: amountIn.toString(),
        amountInHuman: this.formatTokenAmount(amountIn, tokenIn === targetPool.token0 ? targetPool.decimals0 : targetPool.decimals1),
        feeTier: fee,
        direction,
        estimatedUsd: estimatedUsdValue.toString(),
        blockNumberSeen: currentBlock,
        timestamp: Math.floor(Date.now() / 1000),
        provider: 'local-node',
        decodedCall: {
          method: 'exactInput',
          params: {
            path: pathInfo,
            amountIn: amountIn.toString(),
            recipient: args.recipient,
            deadline: args.deadline.toString()
          }
        },
        // Legacy compatibility
        id: tx.hash,
        poolId: targetPool.pool,
        amountUSD: estimatedUsdValue.toString(),
        poolFeeTier: fee,
        calldata: tx.data
      };

      if (this.metrics) {
        this.metrics.incrementMempoolSwapsDecoded();
      }

      return swapData;
    } catch (error: any) {
      this.logger.debug({
        err: error,
        txHash: tx.hash,
        msg: 'Error parsing exactInput'
      });
      return null;
    }
  }

  private async parseMulticall(
    tx: ethers.providers.TransactionResponse, 
    rawTxHex: string, 
    args: any
  ): Promise<PendingSwapDetected | null> {
    try {
      const { data } = args;
      
      // Parse each call in the multicall
      for (const callData of data) {
        const methodId = callData.slice(0, 10);
        
        if (methodId === this.UNISWAP_V3_SIGNATURES.exactInputSingle || 
            methodId === this.UNISWAP_V3_SIGNATURES.exactInput) {
          
          // Recursively parse the nested call
          const nestedTx = { ...tx, data: callData };
          const result = await this.parseSwapTransaction(nestedTx, rawTxHex);
          if (result) {
            result.decodedCall.method = 'multicall->' + result.decodedCall.method;
            return result;
          }
        }
      }
      
      return null;
    } catch (error: any) {
      this.logger.debug({
        err: error,
        txHash: tx.hash,
        msg: 'Error parsing multicall'
      });
      return null;
    }
  }

  private decodePath(path: string): { tokens: string[], fees: number[] } | null {
    try {
      // Remove 0x prefix
      const cleanPath = path.startsWith('0x') ? path.slice(2) : path;
      
      const tokens: string[] = [];
      const fees: number[] = [];
      
      let offset = 0;
      
      // First token (20 bytes)
      tokens.push('0x' + cleanPath.slice(offset, offset + 40));
      offset += 40;
      
      // Parse subsequent (fee, token) pairs
      while (offset < cleanPath.length) {
        // Fee (3 bytes)
        const feeHex = cleanPath.slice(offset, offset + 6);
        const fee = parseInt(feeHex, 16);
        fees.push(fee);
        offset += 6;
        
        // Token (20 bytes)
        if (offset + 40 <= cleanPath.length) {
          tokens.push('0x' + cleanPath.slice(offset, offset + 40));
          offset += 40;
        }
      }
      
      return { tokens, fees };
    } catch (error: any) {
      this.logger.debug({
        err: error,
        path,
        msg: 'Error decoding path'
      });
      return null;
    }
  }

  private async estimateUSDValue(tokenAddress: string, amount: ethers.BigNumber): Promise<number> {
    try {
      // Simplified USD estimation - in production this would use price oracles
      // For now, use rough estimates based on known tokens
      const tokenLower = tokenAddress.toLowerCase();
      
      if (tokenLower === '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2') { // WETH
        const ethValue = parseFloat(ethers.utils.formatEther(amount));
        return ethValue * 3500; // Rough ETH price
      } else if (tokenLower === '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48') { // USDC
        return parseFloat(ethers.utils.formatUnits(amount, 6));
      } else if (tokenLower === '0xdac17f958d2ee523a2206206994597c13d831ec7') { // USDT
        return parseFloat(ethers.utils.formatUnits(amount, 6));
      } else if (tokenLower === '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599') { // WBTC
        const btcValue = parseFloat(ethers.utils.formatUnits(amount, 8));
        return btcValue * 65000; // Rough BTC price
      }
      
      // Default fallback
      return 0;
    } catch (error: any) {
      this.logger.debug({
        err: error,
        tokenAddress,
        amount: amount.toString(),
        msg: 'Error estimating USD value'
      });
      return 0;
    }
  }

  private formatTokenAmount(amount: ethers.BigNumber, decimals: number): string {
    try {
      return parseFloat(ethers.utils.formatUnits(amount, decimals)).toFixed(6);
    } catch (error: any) {
      return '0.0';
    }
  }
}
