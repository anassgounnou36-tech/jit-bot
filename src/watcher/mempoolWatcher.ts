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
  amountOutMin?: string; // Optional field from exactInputSingle/exactInput
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
    multicallWithDeadline: '0x5ae401dc',
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
      
      // Don't reject if raw tx unavailable when reconstruction is allowed
      if (!rawTxHex && !this.config.allowReconstructRawTx) {
        if (this.metrics) {
          this.metrics.incrementMempoolTxsRawMissing('local-node');
        }
        this.logger.debug({
          txHash,
          allowReconstruct: this.config.allowReconstructRawTx,
          msg: 'CandidateRejected',
          reason: 'raw_tx_unavailable'
        });
        return;
      }

      if (rawTxHex) {
        if (this.metrics) {
          this.metrics.incrementMempoolTxsRawFetched('local-node');
        }
      } else {
        this.logger.warn({
          txHash,
          allowReconstruct: this.config.allowReconstructRawTx,
          msg: 'Proceeding without raw transaction - rawTxHex will be empty'
        });
      }

      // Step 6: Parse transaction data
      const swapData = await this.parseSwapTransaction(tx, rawTxHex || '');
      if (!swapData) {
        return;
      }

      // Log SwapObserved IMMEDIATELY after decode and BEFORE amount threshold checks
      if (this.config.logTargetPoolSwaps) {
        this.logger.info({
          msg: 'SwapObserved',
          txHash: swapData.txHash,
          poolAddress: swapData.poolAddress,
          tokenIn: swapData.tokenIn,
          tokenOut: swapData.tokenOut,
          feeTier: swapData.feeTier,
          direction: swapData.direction,
          amountIn: swapData.amountIn,
          amountInHuman: swapData.amountInHuman,
          decodedMethod: swapData.decodedCall.method
        });
      }

      // Increment decoded counter
      if (this.metrics) {
        this.metrics.incrementMempoolSwapsDecoded();
      }

      // Step 7: Emit PendingSwapDetected BEFORE threshold validation for visibility
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
        decodedCall: swapData.decodedCall,
        rawTxHex: swapData.rawTxHex ? 'available' : 'missing'
      });

      this.emit('PendingSwapDetected', swapData);

      // Step 8: Validate thresholds (for downstream filtering, but emission already happened)
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

    } catch (error: any) {
      this.logger.debug({
        err: error,
        txHash,
        msg: 'Failed to process pending transaction'
      });
    }
  }

  private async getRawSignedTransaction(txHash: string): Promise<string> {
    let rawTx = '';
    let source = 'unknown';

    try {
      // Try local node first
      rawTx = await this.provider.send('eth_getRawTransactionByHash', [txHash]);
      if (rawTx && rawTx !== '0x') {
        source = 'raw_from_ws';
        this.logger.debug({
          txHash,
          source,
          msg: 'Raw transaction retrieved from primary provider'
        });
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
        rawTx = await this.fallbackProvider.send('eth_getRawTransactionByHash', [txHash]);
        if (rawTx && rawTx !== '0x') {
          source = 'raw_from_http_fallback';
          this.logger.debug({
            txHash,
            source,
            msg: 'Raw transaction retrieved from fallback provider'
          });
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

    // If raw tx unavailable and reconstruction is allowed, try to reconstruct
    if (this.config.allowReconstructRawTx) {
      try {
        const tx = await this.provider.getTransaction(txHash);
        if (tx && tx.v && tx.r && tx.s) {
          const reconstructed = this.reconstructRawTransaction(tx);
          if (reconstructed) {
            source = 'raw_reconstructed';
            this.logger.debug({
              txHash,
              source,
              msg: 'Raw transaction reconstructed from transaction data'
            });
            return reconstructed;
          }
        } else {
          this.logger.debug({
            txHash,
            msg: 'Cannot reconstruct: missing signature components (v/r/s)'
          });
        }
      } catch (error: any) {
        this.logger.debug({
          err: error,
          txHash,
          msg: 'Failed to reconstruct raw transaction'
        });
      }
    }

    source = 'raw_unavailable';
    this.logger.debug({
      txHash,
      source,
      allowReconstruct: this.config.allowReconstructRawTx,
      msg: 'Raw transaction unavailable'
    });

    return '';
  }

  private reconstructRawTransaction(tx: ethers.providers.TransactionResponse): string | null {
    try {
      // Prepare transaction data for serialization
      const txData: any = {
        to: tx.to,
        value: tx.value,
        data: tx.data,
        gasLimit: tx.gasLimit,
        gasPrice: tx.gasPrice,
        nonce: tx.nonce,
        type: tx.type || 0,
        chainId: tx.chainId
      };

      // Add EIP-1559 fields if present
      if (tx.maxFeePerGas) {
        txData.maxFeePerGas = tx.maxFeePerGas;
      }
      if (tx.maxPriorityFeePerGas) {
        txData.maxPriorityFeePerGas = tx.maxPriorityFeePerGas;
      }

      // Create signature object
      const signature = {
        v: tx.v!,
        r: tx.r!,
        s: tx.s!
      };

      // Serialize the transaction with signature
      return ethers.utils.serializeTransaction(txData, signature);
    } catch (error: any) {
      this.logger.debug({
        err: error,
        txHash: tx.hash,
        msg: 'Error reconstructing raw transaction'
      });
      return null;
    }
  }

  private isUniswapV3Transaction(to: string): boolean {
    const normalizedTo = to.toLowerCase();
    
    // Check if it's a router transaction
    if (normalizedTo === this.UNISWAP_V3_ROUTER.toLowerCase() ||
        normalizedTo === this.UNISWAP_V3_ROUTER_V2.toLowerCase()) {
      return true;
    }
    
    // Check if it's a direct pool transaction
    for (const pool of this.config.pools) {
      if (pool.address.toLowerCase() === normalizedTo) {
        return true;
      }
    }
    
    return false;
  }

  private async parseSwapTransaction(tx: ethers.providers.TransactionResponse, rawTxHex: string): Promise<PendingSwapDetected | null> {
    try {
      // Determine if this is a router or direct pool transaction
      const normalizedTo = tx.to!.toLowerCase();
      const isRouter = normalizedTo === this.UNISWAP_V3_ROUTER.toLowerCase() ||
                      normalizedTo === this.UNISWAP_V3_ROUTER_V2.toLowerCase();
      
      if (isRouter) {
        return await this.parseRouterTransaction(tx, rawTxHex);
      } else {
        return await this.parseDirectPoolTransaction(tx, rawTxHex);
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

  private async parseRouterTransaction(tx: ethers.providers.TransactionResponse, rawTxHex: string): Promise<PendingSwapDetected | null> {
    try {
      const routerIface = new ethers.utils.Interface([
        'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96))',
        'function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum))',
        'function multicall(bytes[] data) external payable',
        'function multicall(uint256 deadline, bytes[] data) external payable'
      ]);

      // Try to decode the transaction
      const methodId = tx.data.slice(0, 10);
      let parsed: any;

      try {
        parsed = routerIface.parseTransaction({ data: tx.data, value: tx.value });
      } catch (error: any) {
        this.logger.debug({
          txHash: tx.hash,
          methodId,
          msg: 'Failed to parse router transaction',
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
            msg: 'Unsupported router method'
          });
          return null;
      }
    } catch (error: any) {
      this.logger.debug({
        err: error,
        txHash: tx.hash,
        msg: 'Error parsing router transaction'
      });
      return null;
    }
  }

  private async parseDirectPoolTransaction(tx: ethers.providers.TransactionResponse, rawTxHex: string): Promise<PendingSwapDetected | null> {
    try {
      const poolIface = new ethers.utils.Interface([
        'function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes data)'
      ]);

      let parsed: any;
      try {
        parsed = poolIface.parseTransaction({ data: tx.data, value: tx.value });
      } catch (error: any) {
        this.logger.debug({
          txHash: tx.hash,
          msg: 'Failed to parse direct pool transaction',
          err: error.message
        });
        return null;
      }

      if (parsed.name === 'swap') {
        return await this.parseDirectPoolSwap(tx, rawTxHex, parsed.args);
      }

      return null;
    } catch (error: any) {
      this.logger.debug({
        err: error,
        txHash: tx.hash,
        msg: 'Error parsing direct pool transaction'
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
      const { tokenIn, tokenOut, fee, amountIn, amountOutMinimum } = params;

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
        amountOutMin: amountOutMinimum ? amountOutMinimum.toString() : undefined,
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
            amountOutMinimum: amountOutMinimum ? amountOutMinimum.toString() : undefined,
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
      const { path, amountIn, amountOutMinimum } = args;
      
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
        amountOutMin: amountOutMinimum ? amountOutMinimum.toString() : undefined,
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
            amountOutMinimum: amountOutMinimum ? amountOutMinimum.toString() : undefined,
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
      // Handle both multicall signatures: multicall(bytes[]) and multicall(uint256, bytes[])
      let data: string[];
      
      if (args.length === 1) {
        // multicall(bytes[] data)
        data = args[0];
      } else if (args.length === 2) {
        // multicall(uint256 deadline, bytes[] data)
        data = args[1];
      } else {
        this.logger.debug({
          txHash: tx.hash,
          msg: 'Unexpected multicall args length',
          argsLength: args.length
        });
        return null;
      }
      
      // Parse each call in the multicall
      for (const callData of data) {
        const methodId = callData.slice(0, 10);
        
        if (methodId === this.UNISWAP_V3_SIGNATURES.exactInputSingle || 
            methodId === this.UNISWAP_V3_SIGNATURES.exactInput) {
          
          // Recursively parse the nested call
          const nestedTx = { ...tx, data: callData };
          const result = await this.parseRouterTransaction(nestedTx, rawTxHex);
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

  private async parseDirectPoolSwap(
    tx: ethers.providers.TransactionResponse, 
    rawTxHex: string, 
    args: any
  ): Promise<PendingSwapDetected | null> {
    try {
      const { recipient, zeroForOne, amountSpecified } = args;
      
      // Find the target pool by address
      const poolAddress = tx.to!.toLowerCase();
      let targetPool: any = null;
      
      for (const pool of this.config.pools) {
        if (pool.address.toLowerCase() === poolAddress) {
          targetPool = pool;
          break;
        }
      }
      
      if (!targetPool) {
        return null; // Pool not in our target list
      }
      
      // Determine tokenIn/tokenOut from zeroForOne
      const tokenIn = zeroForOne ? targetPool.token0 : targetPool.token1;
      const tokenOut = zeroForOne ? targetPool.token1 : targetPool.token0;
      
      // Convert amountSpecified (which can be negative) to amountIn
      const amountIn = amountSpecified.lt(0) ? amountSpecified.abs() : amountSpecified;
      
      // Determine direction
      const direction = zeroForOne ? 'token0->token1' : 'token1->token0';
      
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
        amountInHuman: this.formatTokenAmount(amountIn, zeroForOne ? targetPool.decimals0 : targetPool.decimals1),
        feeTier: targetPool.fee,
        direction,
        estimatedUsd: estimatedUsdValue.toString(),
        blockNumberSeen: currentBlock,
        timestamp: Math.floor(Date.now() / 1000),
        provider: 'local-node',
        decodedCall: {
          method: 'swap',
          params: {
            recipient,
            zeroForOne,
            amountSpecified: amountSpecified.toString(),
            poolAddress: targetPool.address
          }
        },
        // Legacy compatibility
        id: tx.hash,
        poolId: targetPool.pool,
        amountUSD: estimatedUsdValue.toString(),
        poolFeeTier: targetPool.fee,
        calldata: tx.data
      };
      
      return swapData;
    } catch (error: any) {
      this.logger.debug({
        err: error,
        txHash: tx.hash,
        msg: 'Error parsing direct pool swap'
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
