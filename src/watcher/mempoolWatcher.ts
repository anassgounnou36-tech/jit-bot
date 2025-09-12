import WebSocket from 'ws';
import { ethers } from 'ethers';
import { EventEmitter } from 'events';
import config from '../../config.json';

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
}

export class MempoolWatcher extends EventEmitter {
  private ws: WebSocket | null = null;
  private provider: ethers.providers.WebSocketProvider;
  private readonly UNISWAP_V3_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
  private readonly MIN_SWAP_THRESHOLD = ethers.utils.parseEther('10'); // 10 ETH minimum

  constructor(rpcUrl: string) {
    super();
    this.provider = new ethers.providers.WebSocketProvider(rpcUrl);
  }

  async start(): Promise<void> {
    console.log('🔍 Starting mempool watcher...');
    
    try {
      // Subscribe to pending transactions
      await this.provider.send('eth_subscribe', ['newPendingTransactions']);
      
      this.provider.on('pending', (txHash: string) => {
        this.processPendingTransaction(txHash);
      });

      console.log('✅ Mempool watcher started successfully');
    } catch (error) {
      console.error('❌ Failed to start mempool watcher:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.ws) {
      this.ws.close();
    }
    await this.provider.destroy();
    console.log('🛑 Mempool watcher stopped');
  }

  private async processPendingTransaction(txHash: string): Promise<void> {
    try {
      const tx = await this.provider.getTransaction(txHash);
      
      if (!tx || !tx.to) {
        return;
      }

      // Check if transaction is to Uniswap V3 Router
      if (tx.to.toLowerCase() !== this.UNISWAP_V3_ROUTER.toLowerCase()) {
        return;
      }

      // Parse transaction data
      const swapData = this.parseSwapTransaction(tx);
      
      if (!swapData) {
        return;
      }

      // Check if swap meets our criteria
      if (this.shouldProcessSwap(swapData)) {
        console.log(`🎯 Found potential JIT opportunity: ${txHash}`);
        this.emit('swapDetected', swapData);
      }

    } catch (error) {
      // Silently ignore transaction parsing errors
      // This is normal as many transactions will fail to parse
    }
  }

  private parseSwapTransaction(tx: ethers.providers.TransactionResponse): PendingSwap | null {
    try {
      // Simple parsing for exactInputSingle calls
      const iface = new ethers.utils.Interface([
        'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut)'
      ]);

      const parsed = iface.parseTransaction({ data: tx.data });
      
      if (parsed.name !== 'exactInputSingle') {
        return null;
      }

      const params = parsed.args[0];
      
      // Find the target pool
      const targetPool = this.findTargetPool(params.tokenIn, params.tokenOut, params.fee);
      
      if (!targetPool) {
        return null;
      }

      return {
        hash: tx.hash!,
        from: tx.from,
        to: tx.to!,
        value: tx.value.toString(),
        data: tx.data,
        gasPrice: tx.gasPrice?.toString() || '0',
        gasLimit: tx.gasLimit.toString(),
        nonce: tx.nonce,
        pool: targetPool.address,
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn.toString(),
        amountOutMinimum: params.amountOutMinimum.toString(),
        expectedPrice: '0', // Will be calculated later
        estimatedProfit: '0' // Will be calculated later
      };

    } catch (error) {
      return null;
    }
  }

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

  private shouldProcessSwap(swap: PendingSwap): boolean {
    // Check minimum swap size
    const amountIn = ethers.BigNumber.from(swap.amountIn);
    
    if (amountIn.lt(this.MIN_SWAP_THRESHOLD)) {
      return false;
    }

    // Additional checks can be added here
    return true;
  }

  // Estimate profit from a swap (simplified calculation)
  // private estimateProfit(swap: PendingSwap): ethers.BigNumber {
    // This is a simplified calculation
    // In reality, you'd need to:
    // 1. Calculate pool price impact
    // 2. Estimate LP fee capture
    // 3. Account for gas costs
    // 4. Account for flash loan fees
    
    // const amountIn = ethers.BigNumber.from(swap.amountIn);
    // const estimatedFee = amountIn.div(1000); // 0.1% fee estimate
    
    // return estimatedFee;
  // }
}