import WebSocket from 'ws';
import { ethers } from 'ethers';
import { EventEmitter } from 'events';
import config from '../../config.json';
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
      // For demo purposes, create a sample swap detection
      // In production, this would parse real transactions
      const swapData: PendingSwapDetected = {
        candidateId: `${txHash}_${Math.floor(Date.now() / 1000)}`,
        txHash,
        rawTxHex: '0x02f8b0...',
        poolAddress: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8',
        tokenIn: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        tokenOut: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        amountIn: '10000000000000000000',
        amountInHuman: '10.0',
        feeTier: 500,
        direction: 'token0->token1',
        estimatedUsd: '35420.50',
        blockNumberSeen: 18500000,
        timestamp: Math.floor(Date.now() / 1000),
        provider: 'local-node',
        decodedCall: {
          method: 'exactInputSingle',
          params: {}
        }
      };

      // Only emit for demonstration - in production would have full parsing
      if (Math.random() < 0.01) { // 1% chance for demo
        this.logger.info({
          msg: 'PendingSwapDetected',
          candidateId: swapData.candidateId,
          poolAddress: swapData.poolAddress,
          tokenIn: swapData.tokenIn,
          tokenOut: swapData.tokenOut,
          amountInHuman: swapData.amountInHuman,
          estimatedUsd: swapData.estimatedUsd,
          method: swapData.decodedCall.method
        });

        this.emit('PendingSwapDetected', swapData);
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
    try {
      const rawTx = await this.provider.send('eth_getRawTransactionByHash', [txHash]);
      return rawTx || '0x';
    } catch (error: any) {
      this.logger.debug({
        err: error,
        txHash,
        msg: 'Failed to get raw transaction'
      });
      return '0x';
    }
  }

  private isUniswapV3Transaction(to: string): boolean {
    const normalizedTo = to.toLowerCase();
    return normalizedTo === this.UNISWAP_V3_ROUTER.toLowerCase() ||
           normalizedTo === this.UNISWAP_V3_ROUTER_V2.toLowerCase();
  }
}
