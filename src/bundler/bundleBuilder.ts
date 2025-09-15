import { ethers } from 'ethers';
import { PendingSwap, PendingSwapDetected } from '../watcher/mempoolWatcher';
import { JitParameters } from '../watcher/simulator';
import { getLogger } from '../logging/logger';

// Minimal TransactionRequest shape used by exec/flashbots.ts
export interface BundleRequestTx {
  to?: string;
  data?: ethers.utils.BytesLike;
  value?: ethers.BigNumberish;
  gasLimit?: ethers.BigNumberish;
  maxFeePerGas?: ethers.BigNumberish;
  maxPriorityFeePerGas?: ethers.BigNumberish;
  gasPrice?: ethers.BigNumberish;
  type?: number;
  nonce?: number;
}

export interface FlashbotsBundle {
  transactions: Array<string | BundleRequestTx>;
  blockNumber?: number; // Optional to match exec bundle creation pattern
  targetBlockNumber?: number; // Compatibility with exec/flashbots.ts
  maxBlockNumber?: number; // Compatibility with exec/flashbots.ts  
  minTimestamp?: number;
  maxTimestamp?: number;
  // Enhanced bundle with victim transaction support
  victimTransaction?: {
    rawTx?: string; // Alias for compatibility
    rawTxHex?: string; // Legacy field name
    hash: string;
    insertAfterIndex?: number; // Position to insert victim tx in bundle (default: 0)
  };
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

export interface EnhancedJitBundle {
  mintTransaction: BundleTransaction;
  victimTransaction: {
    rawTxHex: string;
    hash: string;
  };
  burnCollectTransaction: BundleTransaction;
  targetBlockNumber: number;
  bundleId: string;
}

export class BundleBuilder {
  private wallet: ethers.Wallet;
  private provider: ethers.providers.JsonRpcProvider;
  private logger: any;

  constructor(privateKey: string, provider: ethers.providers.JsonRpcProvider) {
    this.wallet = new ethers.Wallet(privateKey, provider);
    this.provider = provider;
    this.logger = getLogger().child({ component: 'bundle-builder' });
  }

  /**
   * Build enhanced JIT bundle with victim transaction inclusion
   * Strict ordering: [JIT mint/flashloan trigger] → [victim raw signed tx] → [JIT burn/collect/repay]
   */
  async buildEnhancedJitBundle(
    pendingSwap: PendingSwapDetected,
    jitParams: JitParameters,
    contractAddress: string
  ): Promise<EnhancedJitBundle> {
    const bundleId = `bundle_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    
    this.logger.info({
      msg: 'Building enhanced JIT bundle with victim transaction',
      swapId: pendingSwap.id,
      bundleId,
      poolId: pendingSwap.poolId,
      amountUSD: pendingSwap.amountUSD
    });

    try {
      const currentBlock = await this.provider.getBlockNumber();
      const targetBlock = currentBlock + 1;

      // Step 1: Build JIT mint/flashloan trigger transaction
      const mintTransaction = await this.buildJitMintTransaction(
        pendingSwap,
        jitParams,
        contractAddress
      );

      // Step 2: Prepare victim transaction (raw signed tx bytes)
      const victimTransaction = {
        rawTxHex: pendingSwap.rawTxHex,
        hash: pendingSwap.id
      };

      // Step 3: Build JIT burn/collect/repay transaction
      const burnCollectTransaction = await this.buildJitBurnCollectTransaction(
        pendingSwap,
        jitParams,
        contractAddress
      );

      const enhancedBundle: EnhancedJitBundle = {
        mintTransaction,
        victimTransaction,
        burnCollectTransaction,
        targetBlockNumber: targetBlock,
        bundleId
      };

      this.logger.info({
        msg: 'Enhanced JIT bundle built successfully',
        bundleId,
        targetBlock,
        mintGasLimit: mintTransaction.gasLimit,
        burnGasLimit: burnCollectTransaction.gasLimit,
        victimTxHash: victimTransaction.hash
      });

      return enhancedBundle;

    } catch (error: any) {
      this.logger.error({
        err: error,
        msg: 'Failed to build enhanced JIT bundle',
        swapId: pendingSwap.id,
        bundleId
      });
      throw error;
    }
  }

  /**
   * Build JIT mint/flashloan trigger transaction (first in bundle)
   */
  private async buildJitMintTransaction(
    pendingSwap: PendingSwapDetected,
    _jitParams: JitParameters,
    contractAddress: string
  ): Promise<BundleTransaction> {
    this.logger.debug({
      msg: 'Building JIT mint transaction',
      swapId: pendingSwap.id,
      poolId: pendingSwap.poolId
    });

    // Encode the flashloan trigger call that will mint JIT position
    const iface = new ethers.utils.Interface([
      'function executeJitMint(address pool, address tokenIn, address tokenOut, uint24 fee, int24 tickLower, int24 tickUpper, uint256 flashloanAmount, uint256 minProfit, bytes calldata victimTxData) external'
    ]);

    const flashloanAmount = ethers.BigNumber.from(pendingSwap.amountIn)
      .mul(110).div(100); // 110% of swap amount for liquidity

    const data = iface.encodeFunctionData('executeJitMint', [
      pendingSwap.poolId,
      pendingSwap.tokenIn,
      pendingSwap.tokenOut,
      pendingSwap.poolFeeTier,
      _jitParams.tickLower,
      _jitParams.tickUpper,
      flashloanAmount,
      ethers.utils.parseEther('0.01'), // minProfit: $0.01 equivalent
      pendingSwap.calldata
    ]);

    // Get competitive gas pricing
    const gasPrice = await this.getCompetitiveGasPrice();

    return {
      to: contractAddress,
      data,
      value: '0',
      gasLimit: '800000', // High gas limit for flashloan + mint
      maxFeePerGas: gasPrice.maxFeePerGas.toString(),
      maxPriorityFeePerGas: gasPrice.maxPriorityFeePerGas.toString()
    };
  }

  /**
   * Build JIT burn/collect/repay transaction (third in bundle, after victim)
   */
  private async buildJitBurnCollectTransaction(
    pendingSwap: PendingSwapDetected,
    _jitParams: JitParameters,
    contractAddress: string
  ): Promise<BundleTransaction> {
    this.logger.debug({
      msg: 'Building JIT burn/collect transaction',
      swapId: pendingSwap.id,
      poolId: pendingSwap.poolId
    });

    // Encode the burn/collect/repay call
    const iface = new ethers.utils.Interface([
      'function executeJitBurnCollect(uint256 tokenId, uint128 liquidity, uint256 flashloanRepayAmount, address profitRecipient) external'
    ]);

    const flashloanRepayAmount = ethers.BigNumber.from(pendingSwap.amountIn)
      .mul(110).div(100); // Match the flashloan amount

    const data = iface.encodeFunctionData('executeJitBurnCollect', [
      0, // tokenId - will be set dynamically in contract
      0, // liquidity - will be calculated dynamically
      flashloanRepayAmount,
      this.wallet.address // profit recipient
    ]);

    // Use same gas price as mint transaction for bundle consistency
    const gasPrice = await this.getCompetitiveGasPrice();

    return {
      to: contractAddress,
      data,
      value: '0',
      gasLimit: '600000', // Gas for burn + collect + repay
      maxFeePerGas: gasPrice.maxFeePerGas.toString(),
      maxPriorityFeePerGas: gasPrice.maxPriorityFeePerGas.toString()
    };
  }

  /**
   * Get competitive gas pricing for bundle transactions
   */
  private async getCompetitiveGasPrice(): Promise<{
    maxFeePerGas: ethers.BigNumber;
    maxPriorityFeePerGas: ethers.BigNumber;
  }> {
    try {
      const block = await this.provider.getBlock('latest');
      const baseFeePerGas = block.baseFeePerGas || ethers.utils.parseUnits('20', 'gwei');
      
      // Aggressive pricing for MEV bundles
      const maxPriorityFeePerGas = ethers.utils.parseUnits('3', 'gwei'); // 3 gwei priority
      const maxFeePerGas = baseFeePerGas.mul(130).div(100).add(maxPriorityFeePerGas); // 130% base + priority
      
      return {
        maxFeePerGas,
        maxPriorityFeePerGas
      };
    } catch (error: any) {
      this.logger.warn({
        err: error,
        msg: 'Failed to get competitive gas price, using fallback'
      });
      
      // Fallback pricing
      return {
        maxFeePerGas: ethers.utils.parseUnits('50', 'gwei'),
        maxPriorityFeePerGas: ethers.utils.parseUnits('3', 'gwei')
      };
    }
  }

  /**
   * Convert enhanced bundle to legacy Flashbots bundle format
   */
  async convertToFlashbotsBundle(enhancedBundle: EnhancedJitBundle): Promise<FlashbotsBundle> {
    this.logger.info({
      msg: 'Converting enhanced bundle to Flashbots format',
      bundleId: enhancedBundle.bundleId
    });

    try {
      // Sign the JIT transactions
      const signedMintTx = await this.wallet.signTransaction({
        ...enhancedBundle.mintTransaction,
        nonce: await this.wallet.getTransactionCount(),
        type: 2, // EIP-1559
        chainId: (await this.provider.getNetwork()).chainId
      });

      const signedBurnTx = await this.wallet.signTransaction({
        ...enhancedBundle.burnCollectTransaction,
        nonce: await this.wallet.getTransactionCount() + 1, // Next nonce
        type: 2, // EIP-1559
        chainId: (await this.provider.getNetwork()).chainId
      });

      // Bundle ordering: [mint] → [victim] → [burn/collect]
      // Note: victim tx will be inserted by Flashbots manager at index 1
      const bundle: FlashbotsBundle = {
        transactions: [signedMintTx, signedBurnTx], // Victim tx inserted between these
        blockNumber: enhancedBundle.targetBlockNumber,
        targetBlockNumber: enhancedBundle.targetBlockNumber, // Compatibility with exec/flashbots.ts
        minTimestamp: Math.floor(Date.now() / 1000),
        maxTimestamp: Math.floor(Date.now() / 1000) + 60, // 1 minute max
        victimTransaction: {
          rawTx: enhancedBundle.victimTransaction.rawTxHex, // Alias for compatibility
          rawTxHex: enhancedBundle.victimTransaction.rawTxHex, // Legacy field
          hash: enhancedBundle.victimTransaction.hash,
          insertAfterIndex: 0 // Insert after mint transaction (default value)
        }
      };

      this.logger.info({
        msg: 'Bundle converted to Flashbots format',
        bundleId: enhancedBundle.bundleId,
        totalTransactions: 3, // mint + victim + burn
        targetBlock: bundle.blockNumber || bundle.targetBlockNumber
      });

      return bundle;

    } catch (error: any) {
      this.logger.error({
        err: error,
        msg: 'Failed to convert bundle to Flashbots format',
        bundleId: enhancedBundle.bundleId
      });
      throw error;
    }
  }

  // Legacy method for backward compatibility
  async buildJitBundle(
    pendingSwap: PendingSwap,
    jitParams: JitParameters,
    contractAddress: string
  ): Promise<FlashbotsBundle> {
    this.logger.info({
      msg: 'Building legacy JIT bundle',
      swapHash: pendingSwap.hash,
      note: 'Consider migrating to enhanced bundle format'
    });

    try {
      const currentBlock = await this.provider.getBlockNumber();
      const targetBlock = currentBlock + 1;

      // Build the JIT execution transaction
      const jitTransaction = await this.buildJitTransaction(jitParams, contractAddress);
      
      // Sign the JIT transaction
      const signedJitTx = await this.wallet.signTransaction(jitTransaction);

      // Legacy bundle format (single transaction)
      const bundle: FlashbotsBundle = {
        transactions: [signedJitTx],
        blockNumber: targetBlock,
        targetBlockNumber: targetBlock, // Compatibility with exec/flashbots.ts
        minTimestamp: Math.floor(Date.now() / 1000),
        maxTimestamp: Math.floor(Date.now() / 1000) + 60 // 1 minute max
      };

      this.logger.info({
        msg: 'Legacy bundle built',
        targetBlock,
        transactionCount: bundle.transactions.length
      });

      return bundle;

    } catch (error: any) {
      this.logger.error({
        err: error,
        msg: 'Failed to build legacy bundle'
      });
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
        if (typeof txData === 'string') {
          // Parse the signed transaction to estimate gas
          const tx = ethers.utils.parseTransaction(txData);
          totalGas = totalGas.add(tx.gasLimit || 21000);
        } else {
          // Handle TransactionRequest object
          const gasLimit = txData.gasLimit ? ethers.BigNumber.from(txData.gasLimit) : ethers.BigNumber.from(21000);
          totalGas = totalGas.add(gasLimit);
        }
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

    // Accept either blockNumber or targetBlockNumber
    const effectiveBlockNumber = bundle.blockNumber || bundle.targetBlockNumber;
    if (!effectiveBlockNumber || effectiveBlockNumber <= 0) {
      return false;
    }

    // Validate transaction signatures and structure
    for (const txData of bundle.transactions) {
      try {
        if (typeof txData === 'string') {
          // Validate signed transaction hex
          const tx = ethers.utils.parseTransaction(txData);
          if (!tx.from) {
            return false;
          }
        } else {
          // Validate TransactionRequest object has required fields
          if (!txData.to || txData.to === '') {
            return false;
          }
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

      const effectiveBlockNumber = originalBundle.blockNumber || originalBundle.targetBlockNumber;

      return {
        transactions: [signedCancelTx],
        blockNumber: effectiveBlockNumber,
        targetBlockNumber: effectiveBlockNumber, // Compatibility
        minTimestamp: originalBundle.minTimestamp,
        maxTimestamp: originalBundle.maxTimestamp
      };

    } catch (error) {
      console.error('❌ Failed to build failsafe bundle:', error);
      return null;
    }
  }
}

/**
 * Validate bundle ordering and transaction requirements (from PR #30)
 * Exported for external use by other modules
 */
export function validateBundleOrdering(bundle: FlashbotsBundle): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  // Check minimum transaction count
  if (bundle.transactions.length < 1) {
    issues.push('Bundle must contain at least 1 transaction');
  }

  // Check victim transaction inclusion for enhanced bundles
  if (bundle.victimTransaction) {
    const insertIndex = bundle.victimTransaction.insertAfterIndex || 0;
    
    if (insertIndex < 0 || insertIndex >= bundle.transactions.length) {
      issues.push('Victim transaction insert index out of bounds');
    }
    
    const rawTx = bundle.victimTransaction.rawTx || bundle.victimTransaction.rawTxHex;
    if (!rawTx) {
      issues.push('Victim transaction raw bytes required');
    }
    
    if (!bundle.victimTransaction.hash) {
      issues.push('Victim transaction hash required');
    }
  }

  // Check target block validity
  const effectiveBlockNumber = bundle.blockNumber || bundle.targetBlockNumber;
  if (!effectiveBlockNumber || effectiveBlockNumber <= 0) {
    issues.push('Invalid target block number');
  }

  // Check transaction gas limits
  let totalGasLimit = 0;
  for (const tx of bundle.transactions) {
    if (typeof tx === 'string') {
      try {
        const parsedTx = ethers.utils.parseTransaction(tx);
        totalGasLimit += Number(parsedTx.gasLimit || 21000);
      } catch {
        totalGasLimit += 500000; // Fallback estimate
      }
    } else {
      const gasLimit = tx.gasLimit ? Number(tx.gasLimit) : 21000;
      totalGasLimit += gasLimit;
    }
  }
  
  const MAX_BLOCK_GAS_LIMIT = 30_000_000; // Ethereum block gas limit
  if (totalGasLimit > MAX_BLOCK_GAS_LIMIT * 0.8) { // Use 80% of block limit as safety margin
    issues.push('Bundle gas usage too high for single block');
  }

  return {
    valid: issues.length === 0,
    issues
  };
}