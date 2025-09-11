import { ethers } from 'ethers';
import { PendingSwap } from '../watcher/mempoolWatcher';
import { JitParameters } from '../watcher/simulator';

export interface FlashbotsBundle {
  transactions: string[];
  blockNumber: number;
  minTimestamp?: number;
  maxTimestamp?: number;
}

export interface BundleTransaction {
  to: string;
  data: string;
  value?: string;
  gasLimit: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

export class BundleBuilder {
  private wallet: ethers.Wallet;
  private provider: ethers.providers.JsonRpcProvider;

  constructor(privateKey: string, provider: ethers.providers.JsonRpcProvider) {
    this.wallet = new ethers.Wallet(privateKey, provider);
    this.provider = provider;
  }

  async buildJitBundle(
    pendingSwap: PendingSwap,
    jitParams: JitParameters,
    contractAddress: string
  ): Promise<FlashbotsBundle> {
    console.log(`🔧 Building Flashbots bundle for swap ${pendingSwap.hash}`);

    try {
      const currentBlock = await this.provider.getBlockNumber();
      const targetBlock = currentBlock + 1;

      // Build the JIT execution transaction
      const jitTransaction = await this.buildJitTransaction(jitParams, contractAddress);
      
      // Sign the JIT transaction
      const signedJitTx = await this.wallet.signTransaction(jitTransaction);

      // The bundle should include:
      // 1. Our JIT flash loan transaction (first)
      // 2. The target swap transaction (included by reference or sent together)
      
      const bundle: FlashbotsBundle = {
        transactions: [signedJitTx],
        blockNumber: targetBlock,
        minTimestamp: Math.floor(Date.now() / 1000),
        maxTimestamp: Math.floor(Date.now() / 1000) + 60 // 1 minute max
      };

      console.log(`✅ Bundle built for block ${targetBlock}`);
      return bundle;

    } catch (error) {
      console.error('❌ Failed to build bundle:', error);
      throw error;
    }
  }

  private async buildJitTransaction(
    jitParams: JitParameters,
    contractAddress: string
  ): Promise<BundleTransaction> {
    // Encode the JIT execution call
    const iface = new ethers.utils.Interface([
      'function executeJit((address,address,address,uint24,int24,int24,uint256,uint256,uint256,uint256))'
    ]);

    const encodedParams = [
      jitParams.pool,
      jitParams.token0,
      jitParams.token1,
      jitParams.fee,
      jitParams.tickLower,
      jitParams.tickUpper,
      jitParams.amount0,
      jitParams.amount1,
      ethers.utils.parseEther('0.01'), // minProfitThreshold
      jitParams.deadline
    ];

    const data = iface.encodeFunctionData('executeJit', [encodedParams]);

    // Get current gas price and add priority
    const gasPrice = await this.provider.getGasPrice();
    const priorityGasPrice = gasPrice.mul(110).div(100); // 10% above current

    return {
      to: contractAddress,
      data,
      value: '0',
      gasLimit: '1000000', // 1M gas limit
      gasPrice: priorityGasPrice.toString()
    };
  }

  async estimateBundleGas(bundle: FlashbotsBundle): Promise<ethers.BigNumber> {
    let totalGas = ethers.BigNumber.from(0);

    for (const txData of bundle.transactions) {
      try {
        // Parse the signed transaction to estimate gas
        const tx = ethers.utils.parseTransaction(txData);
        totalGas = totalGas.add(tx.gasLimit || 21000);
      } catch (error) {
        // Fallback gas estimate
        totalGas = totalGas.add(500000);
      }
    }

    return totalGas;
  }

  async calculateBundlePriority(
    pendingSwap: PendingSwap,
    estimatedProfit: ethers.BigNumber
  ): Promise<{ gasPrice: ethers.BigNumber; tip: ethers.BigNumber }> {
    const currentGasPrice = await this.provider.getGasPrice();
    const swapGasPrice = ethers.BigNumber.from(pendingSwap.gasPrice || currentGasPrice);

    // Calculate competitive gas price
    // We want to be included in the same block as the target swap
    const competitiveGasPrice = swapGasPrice.mul(105).div(100); // 5% above swap

    // Calculate tip based on profit
    const maxTip = estimatedProfit.div(10); // Max 10% of profit as tip
    const baseTip = currentGasPrice.div(10); // Minimum tip
    const tip = maxTip.gt(baseTip) ? maxTip : baseTip;

    return {
      gasPrice: competitiveGasPrice,
      tip
    };
  }

  validateBundle(bundle: FlashbotsBundle): boolean {
    // Basic bundle validation
    if (bundle.transactions.length === 0) {
      return false;
    }

    if (bundle.blockNumber <= 0) {
      return false;
    }

    // Validate transaction signatures
    for (const txData of bundle.transactions) {
      try {
        const tx = ethers.utils.parseTransaction(txData);
        if (!tx.from) {
          return false;
        }
      } catch (error) {
        return false;
      }
    }

    return true;
  }

  async buildFailsafeBundle(
    originalBundle: FlashbotsBundle,
    reason: string
  ): Promise<FlashbotsBundle | null> {
    // Create a failsafe bundle that just cancels our transaction
    // This prevents us from losing gas if the original opportunity fails
    
    console.log(`🚨 Building failsafe bundle due to: ${reason}`);

    try {
      const nonce = await this.wallet.getTransactionCount();
      
      // Create a simple ETH transfer to ourselves to cancel pending tx
      const cancelTx: BundleTransaction = {
        to: this.wallet.address,
        data: '0x',
        value: '0',
        gasLimit: '21000',
        gasPrice: (await this.provider.getGasPrice()).toString()
      };

      const signedCancelTx = await this.wallet.signTransaction({
        ...cancelTx,
        nonce,
        type: 2
      });

      return {
        transactions: [signedCancelTx],
        blockNumber: originalBundle.blockNumber,
        minTimestamp: originalBundle.minTimestamp,
        maxTimestamp: originalBundle.maxTimestamp
      };

    } catch (error) {
      console.error('❌ Failed to build failsafe bundle:', error);
      return null;
    }
  }
}