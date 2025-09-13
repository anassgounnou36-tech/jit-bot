import { ethers, BigNumber } from 'ethers';
import { config } from '../config';
import { createLogger } from '../logging/logger';

const logger = createLogger('GasEstimator');

/**
 * Gas estimation and tracking utilities
 */

export interface GasEstimate {
  gasLimit: BigNumber;
  gasPriceGwei: number;
  estimatedCostEth: BigNumber;
  estimatedCostUsd: number;
}

export interface OperationGasStats {
  operation: string;
  count: number;
  median: number;
  min: number;
  max: number;
  lastUpdated: number;
}

/**
 * Gas estimator with historical tracking and RPC integration
 */
export class GasEstimator {
  private provider: ethers.providers.JsonRpcProvider;
  private gasHistory: Map<string, number[]> = new Map();
  private readonly maxHistorySize = 100;
  private readonly ethPriceUsd = 2000; // Simplified for PR1, oracle integration in PR2

  // Conservative gas estimates for common operations (used as fallbacks)
  private readonly defaultGasLimits = {
    'mint': 300000,
    'burn': 200000,
    'swap': 150000,
    'flashloan': 100000,
    'approve': 50000,
    'transfer': 21000,
    'jit_full_cycle': 800000, // Full JIT LP cycle including flashloan
  };

  constructor(httpRpcUrl: string) {
    this.provider = new ethers.providers.JsonRpcProvider(httpRpcUrl);
    logger.info('GasEstimator initialized');
  }

  /**
   * Get current gas price from RPC and apply max cap
   */
  async getGasPriceGwei(): Promise<number> {
    try {
      const gasPrice = await this.provider.getGasPrice();
      const gasPriceGwei = parseFloat(ethers.utils.formatUnits(gasPrice, 'gwei'));
      
      // Apply maximum gas price cap
      const cappedGasPrice = Math.min(gasPriceGwei, config.maxGasGwei);
      
      if (cappedGasPrice < gasPriceGwei) {
        logger.warn('Gas price capped', {
          actualGwei: gasPriceGwei,
          cappedGwei: cappedGasPrice,
          maxGwei: config.maxGasGwei,
        });
      }

      logger.debug('Gas price fetched', {
        gasPriceGwei: cappedGasPrice,
        cappedAtMax: cappedGasPrice < gasPriceGwei,
      });

      return cappedGasPrice;

    } catch (error: any) {
      logger.error('Failed to fetch gas price, using fallback', {
        error: error.message,
        fallbackGwei: 50,
      });
      
      // Fallback to reasonable default
      return Math.min(50, config.maxGasGwei);
    }
  }

  /**
   * Get gas limit estimate for a specific operation
   */
  getGasLimit(operation: string): BigNumber {
    const history = this.gasHistory.get(operation);
    
    if (history && history.length > 0) {
      // Use historical median with 20% buffer
      const median = this.calculateMedian(history);
      const gasLimit = Math.floor(median * 1.2);
      
      logger.debug('Gas limit from history', {
        operation,
        median,
        gasLimit,
        samples: history.length,
      });
      
      return BigNumber.from(gasLimit);
    }

    // Use default estimate
    const defaultGas = this.defaultGasLimits[operation as keyof typeof this.defaultGasLimits] || 200000;
    
    logger.debug('Gas limit from default', {
      operation,
      gasLimit: defaultGas,
    });
    
    return BigNumber.from(defaultGas);
  }

  /**
   * Record actual gas usage for an operation
   */
  recordGasUsage(operation: string, gasUsed: number): void {
    if (!this.gasHistory.has(operation)) {
      this.gasHistory.set(operation, []);
    }

    const history = this.gasHistory.get(operation)!;
    history.push(gasUsed);

    // Keep only recent history
    if (history.length > this.maxHistorySize) {
      history.shift();
    }

    logger.debug('Gas usage recorded', {
      operation,
      gasUsed,
      samples: history.length,
      median: this.calculateMedian(history),
    });
  }

  /**
   * Get comprehensive gas estimate for an operation
   */
  async estimateGas(operation: string, ethPriceUsd?: number): Promise<GasEstimate> {
    const [gasPriceGwei, gasLimit] = await Promise.all([
      this.getGasPriceGwei(),
      Promise.resolve(this.getGasLimit(operation)),
    ]);

    const gasPriceWei = ethers.utils.parseUnits(gasPriceGwei.toString(), 'gwei');
    const estimatedCostEth = gasLimit.mul(gasPriceWei);
    const estimatedCostUsd = parseFloat(ethers.utils.formatEther(estimatedCostEth)) * (ethPriceUsd || this.ethPriceUsd);

    const estimate: GasEstimate = {
      gasLimit,
      gasPriceGwei,
      estimatedCostEth,
      estimatedCostUsd,
    };

    logger.debug('Gas estimate calculated', {
      operation,
      gasLimit: gasLimit.toString(),
      gasPriceGwei,
      estimatedCostEth: ethers.utils.formatEther(estimatedCostEth),
      estimatedCostUsd: estimatedCostUsd.toFixed(4),
    });

    return estimate;
  }

  /**
   * Check if current gas conditions are acceptable for execution
   */
  async isGasConditionAcceptable(operation: string): Promise<{ acceptable: boolean; reason?: string; estimate: GasEstimate }> {
    const estimate = await this.estimateGas(operation);
    
    // Check gas price cap
    if (estimate.gasPriceGwei > config.maxGasGwei) {
      return {
        acceptable: false,
        reason: `Gas price ${estimate.gasPriceGwei} gwei exceeds maximum ${config.maxGasGwei} gwei`,
        estimate,
      };
    }

    // Check if cost is reasonable for the operation
    const maxCostUsd = this.getMaxOperationCostUsd(operation);
    if (estimate.estimatedCostUsd > maxCostUsd) {
      return {
        acceptable: false,
        reason: `Estimated cost $${estimate.estimatedCostUsd.toFixed(2)} exceeds maximum $${maxCostUsd}`,
        estimate,
      };
    }

    return {
      acceptable: true,
      estimate,
    };
  }

  /**
   * Get maximum acceptable cost in USD for different operations
   */
  private getMaxOperationCostUsd(operation: string): number {
    const baseCosts = {
      'mint': 100,
      'burn': 80,
      'swap': 60,
      'flashloan': 40,
      'jit_full_cycle': 250,
    };

    return baseCosts[operation as keyof typeof baseCosts] || 100;
  }

  /**
   * Get gas statistics for all tracked operations
   */
  getGasStatistics(): OperationGasStats[] {
    const stats: OperationGasStats[] = [];

    for (const [operation, history] of this.gasHistory.entries()) {
      if (history.length > 0) {
        stats.push({
          operation,
          count: history.length,
          median: this.calculateMedian(history),
          min: Math.min(...history),
          max: Math.max(...history),
          lastUpdated: Date.now(),
        });
      }
    }

    return stats;
  }

  /**
   * Estimate gas for multiple operations in batch
   */
  async estimateMultipleOperations(operations: string[]): Promise<Map<string, GasEstimate>> {
    const estimates = new Map<string, GasEstimate>();
    
    // Get gas price once for all estimates
    const gasPriceGwei = await this.getGasPriceGwei();
    
    for (const operation of operations) {
      const gasLimit = this.getGasLimit(operation);
      const gasPriceWei = ethers.utils.parseUnits(gasPriceGwei.toString(), 'gwei');
      const estimatedCostEth = gasLimit.mul(gasPriceWei);
      const estimatedCostUsd = parseFloat(ethers.utils.formatEther(estimatedCostEth)) * this.ethPriceUsd;

      estimates.set(operation, {
        gasLimit,
        gasPriceGwei,
        estimatedCostEth,
        estimatedCostUsd,
      });
    }

    logger.debug('Batch gas estimates calculated', {
      operations: operations.length,
      gasPriceGwei,
    });

    return estimates;
  }

  /**
   * Calculate median from array of numbers
   */
  private calculateMedian(numbers: number[]): number {
    const sorted = [...numbers].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    } else {
      return sorted[mid];
    }
  }

  /**
   * Clear gas history for testing or reset
   */
  clearHistory(operation?: string): void {
    if (operation) {
      this.gasHistory.delete(operation);
      logger.debug('Gas history cleared for operation', { operation });
    } else {
      this.gasHistory.clear();
      logger.debug('All gas history cleared');
    }
  }

  /**
   * Seed gas history with predefined values for faster startup
   */
  seedHistory(): void {
    const seedData = {
      'mint': [280000, 310000, 295000, 305000, 290000],
      'burn': [185000, 210000, 195000, 200000, 190000],
      'swap': [135000, 160000, 145000, 155000, 140000],
      'flashloan': [85000, 105000, 95000, 100000, 90000],
      'jit_full_cycle': [750000, 820000, 780000, 800000, 770000],
    };

    for (const [operation, values] of Object.entries(seedData)) {
      this.gasHistory.set(operation, [...values]);
    }

    logger.info('Gas history seeded with baseline values', {
      operations: Object.keys(seedData).length,
    });
  }
}

// Export singleton instance
export const gasEstimator = new GasEstimator(config.rpcUrlHttp);

// Seed with baseline values for immediate use
gasEstimator.seedHistory();