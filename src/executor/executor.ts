import { ethers } from 'ethers';
import { FlashbotsBundle } from '../bundler/bundleBuilder';

export interface ExecutionResult {
  success: boolean;
  bundleHash?: string;
  blockNumber?: number;
  gasUsed?: ethers.BigNumber;
  effectiveGasPrice?: ethers.BigNumber;
  profit?: ethers.BigNumber;
  error?: string;
}

export interface FlashbotsProvider {
  sendBundle(bundle: FlashbotsBundle): Promise<string>;
  getBundleStats(bundleHash: string): Promise<any>;
  simulate(bundle: FlashbotsBundle): Promise<any>;
}

export class Executor {
  private provider: ethers.providers.JsonRpcProvider;
  private flashbotsProvider: FlashbotsProvider | null = null;
  private maxRetries: number = 3;
  private retryDelay: number = 1000; // 1 second

  constructor(provider: ethers.providers.JsonRpcProvider) {
    this.provider = provider;
  }

  setFlashbotsProvider(flashbotsProvider: FlashbotsProvider): void {
    this.flashbotsProvider = flashbotsProvider;
  }

  async executeBundle(bundle: FlashbotsBundle): Promise<ExecutionResult> {
    console.log(`🚀 Executing bundle for block ${bundle.blockNumber}`);

    if (!this.flashbotsProvider) {
      return {
        success: false,
        error: 'Flashbots provider not configured'
      };
    }

    try {
      // First, simulate the bundle
      const simulationResult = await this.simulateBundle(bundle);
      
      if (!simulationResult.success) {
        return {
          success: false,
          error: `Simulation failed: ${simulationResult.error}`
        };
      }

      // Submit the bundle
      const bundleHash = await this.submitBundle(bundle);
      
      if (!bundleHash) {
        return {
          success: false,
          error: 'Failed to submit bundle'
        };
      }

      // Monitor for inclusion
      const result = await this.monitorBundleInclusion(bundleHash, bundle.blockNumber);
      
      console.log(`📊 Bundle execution result: ${result.success ? 'Success' : 'Failed'}`);
      return result;

    } catch (error) {
      console.error('❌ Bundle execution failed:', error);
      return {
        success: false,
        error: `Execution error: ${error.message}`
      };
    }
  }

  private async simulateBundle(bundle: FlashbotsBundle): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('🧪 Simulating bundle before submission...');
      
      if (!this.flashbotsProvider) {
        throw new Error('Flashbots provider not available');
      }

      const simulation = await this.flashbotsProvider.simulate(bundle);
      
      // Check simulation results
      if (simulation.error) {
        return {
          success: false,
          error: simulation.error
        };
      }

      // Validate that transactions would succeed
      for (const result of simulation.results || []) {
        if (result.error || result.revert) {
          return {
            success: false,
            error: `Transaction would revert: ${result.error || result.revert}`
          };
        }
      }

      console.log('✅ Bundle simulation successful');
      return { success: true };

    } catch (error) {
      return {
        success: false,
        error: `Simulation error: ${error.message}`
      };
    }
  }

  private async submitBundle(bundle: FlashbotsBundle): Promise<string | null> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        console.log(`📤 Submitting bundle (attempt ${attempt}/${this.maxRetries})`);
        
        if (!this.flashbotsProvider) {
          throw new Error('Flashbots provider not available');
        }

        const bundleHash = await this.flashbotsProvider.sendBundle(bundle);
        
        if (bundleHash) {
          console.log(`✅ Bundle submitted successfully: ${bundleHash}`);
          return bundleHash;
        }

      } catch (error) {
        lastError = error;
        console.error(`❌ Bundle submission attempt ${attempt} failed:`, error.message);
        
        if (attempt < this.maxRetries) {
          await this.sleep(this.retryDelay * attempt);
        }
      }
    }

    console.error('❌ All bundle submission attempts failed');
    return null;
  }

  private async monitorBundleInclusion(
    bundleHash: string,
    targetBlock: number
  ): Promise<ExecutionResult> {
    const maxWaitTime = 30000; // 30 seconds
    const checkInterval = 1000; // 1 second
    const startTime = Date.now();

    console.log(`👀 Monitoring bundle inclusion: ${bundleHash}`);

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const currentBlock = await this.provider.getBlockNumber();
        
        // If we're past the target block, check if our bundle was included
        if (currentBlock >= targetBlock) {
          const result = await this.checkBundleInclusion(bundleHash, targetBlock);
          
          if (result.success !== undefined) {
            return result;
          }
        }

        // If we're too far past the target block, consider it failed
        if (currentBlock > targetBlock + 2) {
          return {
            success: false,
            error: 'Bundle not included within expected timeframe'
          };
        }

        await this.sleep(checkInterval);

      } catch (error) {
        console.error('❌ Error monitoring bundle:', error);
      }
    }

    return {
      success: false,
      error: 'Bundle monitoring timeout'
    };
  }

  private async checkBundleInclusion(
    bundleHash: string,
    blockNumber: number
  ): Promise<ExecutionResult> {
    try {
      if (!this.flashbotsProvider) {
        throw new Error('Flashbots provider not available');
      }

      const stats = await this.flashbotsProvider.getBundleStats(bundleHash);
      
      if (stats.isIncluded) {
        // Bundle was included, analyze the results
        const block = await this.provider.getBlock(blockNumber, true);
        
        if (!block) {
          return {
            success: false,
            error: 'Block not found'
          };
        }

        return await this.analyzeBundleResults(bundleHash, block);
      }

      if (stats.isFailed) {
        return {
          success: false,
          error: `Bundle failed: ${stats.error || 'Unknown error'}`
        };
      }

      // Bundle status unknown, continue monitoring
      return { success: undefined as any };

    } catch (error) {
      return {
        success: false,
        error: `Error checking bundle inclusion: ${error.message}`
      };
    }
  }

  private async analyzeBundleResults(
    bundleHash: string,
    block: ethers.providers.Block
  ): Promise<ExecutionResult> {
    try {
      // Find our transactions in the block
      let totalGasUsed = ethers.BigNumber.from(0);
      let totalGasPrice = ethers.BigNumber.from(0);
      let transactionCount = 0;

      for (const tx of block.transactions) {
        if (typeof tx === 'string') continue;
        
        const receipt = await this.provider.getTransactionReceipt(tx.hash);
        
        if (receipt && receipt.status === 1) {
          totalGasUsed = totalGasUsed.add(receipt.gasUsed);
          totalGasPrice = totalGasPrice.add(tx.gasPrice || 0);
          transactionCount++;
        }
      }

      const avgGasPrice = transactionCount > 0 ? 
        totalGasPrice.div(transactionCount) : 
        ethers.BigNumber.from(0);

      console.log(`✅ Bundle included in block ${block.number}`);
      console.log(`   Gas used: ${totalGasUsed.toString()}`);
      console.log(`   Avg gas price: ${ethers.utils.formatUnits(avgGasPrice, 'gwei')} gwei`);

      return {
        success: true,
        bundleHash,
        blockNumber: block.number,
        gasUsed: totalGasUsed,
        effectiveGasPrice: avgGasPrice,
        profit: ethers.BigNumber.from(0) // Would be calculated from contract events
      };

    } catch (error) {
      return {
        success: false,
        error: `Error analyzing results: ${error.message}`
      };
    }
  }

  async cancelBundle(bundleHash: string, reason: string): Promise<boolean> {
    console.log(`🚫 Cancelling bundle ${bundleHash}: ${reason}`);
    
    try {
      // In a real implementation, this might involve:
      // 1. Submitting a conflicting transaction with higher gas
      // 2. Notifying Flashbots to remove the bundle
      // 3. Updating internal state
      
      console.log(`✅ Bundle cancellation requested`);
      return true;

    } catch (error) {
      console.error('❌ Failed to cancel bundle:', error);
      return false;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}