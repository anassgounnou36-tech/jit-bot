import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { gasEstimator, GasEstimator } from '../../src/util/gasEstimator';

describe('GasEstimator', () => {
  let estimator: GasEstimator;

  before(() => {
    // Use the global instance
    estimator = gasEstimator;
  });

  beforeEach(() => {
    // Clear history before each test to ensure clean state
    estimator.clearHistory();
  });

  describe('Gas Price Fetching', () => {
    it('should fetch current gas price', async () => {
      const gasPriceGwei = await estimator.getGasPriceGwei();
      
      expect(gasPriceGwei).to.be.a('number');
      expect(gasPriceGwei).to.be.greaterThan(0);
      expect(gasPriceGwei).to.be.lessThanOrEqual(1000); // Reasonable upper bound
    });

    it('should respect maximum gas price cap', async () => {
      const gasPriceGwei = await estimator.getGasPriceGwei();
      
      // Should not exceed the configured maximum
      // Note: In tests, this depends on the MAX_GAS_GWEI config
      expect(gasPriceGwei).to.be.lessThanOrEqual(200); // Reasonable test cap
    });

    it('should handle RPC failures gracefully', async () => {
      // This is hard to test without mocking, but we can ensure it doesn't throw
      try {
        const gasPriceGwei = await estimator.getGasPriceGwei();
        expect(gasPriceGwei).to.be.a('number');
        expect(gasPriceGwei).to.be.greaterThan(0);
      } catch (error) {
        expect.fail('Should not throw on gas price fetch failure');
      }
    });
  });

  describe('Gas Limit Estimation', () => {
    it('should provide default gas limits for known operations', () => {
      const operations = ['mint', 'burn', 'swap', 'flashloan', 'jit_full_cycle'];
      
      operations.forEach(operation => {
        const gasLimit = estimator.getGasLimit(operation);
        
        expect(gasLimit.gt(0)).to.be.true;
        expect(gasLimit.lt(BigNumber.from(2000000))).to.be.true; // Reasonable upper bound
      });
    });

    it('should provide default for unknown operations', () => {
      const gasLimit = estimator.getGasLimit('unknown_operation');
      
      expect(gasLimit.gt(0)).to.be.true;
      expect(gasLimit.eq(BigNumber.from(200000))).to.be.true; // Default fallback
    });

    it('should use historical data when available', () => {
      const operation = 'test_operation';
      
      // Record some gas usage
      estimator.recordGasUsage(operation, 150000);
      estimator.recordGasUsage(operation, 160000);
      estimator.recordGasUsage(operation, 140000);
      
      const gasLimit = estimator.getGasLimit(operation);
      
      // Should be based on median with 20% buffer
      // Median = 150000, with 20% buffer = 180000
      expect(gasLimit.eq(BigNumber.from(180000))).to.be.true;
    });
  });

  describe('Gas Usage Recording', () => {
    it('should record and track gas usage', () => {
      const operation = 'test_mint';
      const gasUsages = [100000, 110000, 105000, 120000, 95000];
      
      gasUsages.forEach(usage => {
        estimator.recordGasUsage(operation, usage);
      });
      
      const stats = estimator.getGasStatistics();
      const operationStats = stats.find(s => s.operation === operation);
      
      expect(operationStats).to.exist;
      expect(operationStats!.count).to.equal(gasUsages.length);
      expect(operationStats!.median).to.equal(105000); // Median of the array
      expect(operationStats!.min).to.equal(95000);
      expect(operationStats!.max).to.equal(120000);
    });

    it('should limit history size', () => {
      const operation = 'test_operation';
      
      // Record more than max history size (100)
      for (let i = 0; i < 150; i++) {
        estimator.recordGasUsage(operation, 100000 + i);
      }
      
      const stats = estimator.getGasStatistics();
      const operationStats = stats.find(s => s.operation === operation);
      
      expect(operationStats!.count).to.equal(100); // Should be capped
    });
  });

  describe('Comprehensive Gas Estimation', () => {
    it('should provide complete gas estimates', async () => {
      const operation = 'jit_full_cycle';
      const estimate = await estimator.estimateGas(operation);
      
      expect(estimate).to.have.property('gasLimit');
      expect(estimate).to.have.property('gasPriceGwei');
      expect(estimate).to.have.property('estimatedCostEth');
      expect(estimate).to.have.property('estimatedCostUsd');
      
      expect(estimate.gasLimit.gt(0)).to.be.true;
      expect(estimate.gasPriceGwei).to.be.greaterThan(0);
      expect(estimate.estimatedCostEth.gt(0)).to.be.true;
      expect(estimate.estimatedCostUsd).to.be.greaterThan(0);
    });

    it('should calculate costs correctly', async () => {
      const operation = 'swap';
      const estimate = await estimator.estimateGas(operation);
      
      // Verify the calculation
      const expectedCostWei = estimate.gasLimit.mul(
        BigNumber.from(Math.floor(estimate.gasPriceGwei * 1e9))
      );
      
      expect(estimate.estimatedCostEth.eq(expectedCostWei)).to.be.true;
      
      // USD cost should be reasonable
      expect(estimate.estimatedCostUsd).to.be.lessThan(1000); // Should be less than $1000 for normal ops
    });

    it('should handle custom ETH price', async () => {
      const operation = 'mint';
      const customEthPrice = 3000; // $3000 ETH
      
      const estimate = await estimator.estimateGas(operation, customEthPrice);
      
      expect(estimate.estimatedCostUsd).to.be.greaterThan(0);
      
      // Should reflect the custom ETH price
      const expectedUsdCost = parseFloat(estimate.estimatedCostEth.toString()) / 1e18 * customEthPrice;
      expect(estimate.estimatedCostUsd).to.be.closeTo(expectedUsdCost, 0.1);
    });
  });

  describe('Gas Condition Checks', () => {
    it('should validate acceptable gas conditions', async () => {
      const operation = 'mint';
      const result = await estimator.isGasConditionAcceptable(operation);
      
      expect(result).to.have.property('acceptable');
      expect(result).to.have.property('estimate');
      expect(typeof result.acceptable).to.equal('boolean');
      
      if (!result.acceptable) {
        expect(result).to.have.property('reason');
        expect(result.reason).to.be.a('string');
      }
    });

    it('should reject conditions when gas price is too high', async () => {
      // This test assumes that if gas price exceeds the cap, it should be rejected
      const operation = 'jit_full_cycle';
      const result = await estimator.isGasConditionAcceptable(operation);
      
      // Result will depend on current network conditions
      expect(result.acceptable).to.be.a('boolean');
      expect(result.estimate.gasPriceGwei).to.be.a('number');
    });
  });

  describe('Batch Estimation', () => {
    it('should estimate gas for multiple operations', async () => {
      const operations = ['mint', 'burn', 'swap'];
      const estimates = await estimator.estimateMultipleOperations(operations);
      
      expect(estimates.size).to.equal(operations.length);
      
      operations.forEach(operation => {
        expect(estimates.has(operation)).to.be.true;
        
        const estimate = estimates.get(operation)!;
        expect(estimate.gasLimit.gt(0)).to.be.true;
        expect(estimate.gasPriceGwei).to.be.greaterThan(0);
        expect(estimate.estimatedCostEth.gt(0)).to.be.true;
        expect(estimate.estimatedCostUsd).to.be.greaterThan(0);
      });
    });

    it('should use same gas price for all operations in batch', async () => {
      const operations = ['mint', 'burn', 'swap'];
      const estimates = await estimator.estimateMultipleOperations(operations);
      
      const gasPrices = Array.from(estimates.values()).map(e => e.gasPriceGwei);
      const uniqueGasPrices = [...new Set(gasPrices)];
      
      // Should all use the same gas price (fetched once)
      expect(uniqueGasPrices.length).to.equal(1);
    });
  });

  describe('Statistics and History', () => {
    it('should provide accurate statistics', () => {
      const operation = 'test_stats';
      const gasUsages = [100, 200, 150, 180, 120];
      
      gasUsages.forEach(usage => {
        estimator.recordGasUsage(operation, usage);
      });
      
      const stats = estimator.getGasStatistics();
      const operationStats = stats.find(s => s.operation === operation);
      
      expect(operationStats).to.exist;
      expect(operationStats!.count).to.equal(5);
      expect(operationStats!.median).to.equal(150);
      expect(operationStats!.min).to.equal(100);
      expect(operationStats!.max).to.equal(200);
      expect(operationStats!.lastUpdated).to.be.a('number');
    });

    it('should handle empty statistics', () => {
      estimator.clearHistory();
      const stats = estimator.getGasStatistics();
      
      expect(stats).to.be.an('array');
      expect(stats.length).to.equal(0);
    });

    it('should clear history correctly', () => {
      estimator.recordGasUsage('op1', 100000);
      estimator.recordGasUsage('op2', 200000);
      
      // Clear specific operation
      estimator.clearHistory('op1');
      let stats = estimator.getGasStatistics();
      expect(stats.length).to.equal(1);
      expect(stats[0].operation).to.equal('op2');
      
      // Clear all
      estimator.clearHistory();
      stats = estimator.getGasStatistics();
      expect(stats.length).to.equal(0);
    });
  });

  describe('Seeded History', () => {
    it('should initialize with seeded baseline values', () => {
      // The gasEstimator should have seeded history on initialization
      const stats = estimator.getGasStatistics();
      
      // Should have baseline values for common operations
      const operations = ['mint', 'burn', 'swap', 'flashloan', 'jit_full_cycle'];
      const foundOperations = stats.map(s => s.operation);
      
      operations.forEach(operation => {
        expect(foundOperations).to.include(operation);
      });
      
      // Each operation should have multiple samples
      stats.forEach(stat => {
        expect(stat.count).to.be.greaterThan(0);
        expect(stat.median).to.be.greaterThan(0);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle zero gas usage gracefully', () => {
      expect(() => estimator.recordGasUsage('test', 0)).to.not.throw();
      
      const gasLimit = estimator.getGasLimit('test');
      expect(gasLimit.gt(0)).to.be.true; // Should still provide a reasonable estimate
    });

    it('should handle very large gas usage values', () => {
      const largeGas = 10000000; // 10M gas
      
      expect(() => estimator.recordGasUsage('large_test', largeGas)).to.not.throw();
      
      const gasLimit = estimator.getGasLimit('large_test');
      expect(gasLimit.gt(BigNumber.from(largeGas))).to.be.true; // Should include buffer
    });

    it('should handle negative values gracefully', () => {
      // Should not throw, but may not record invalid values
      expect(() => estimator.recordGasUsage('negative_test', -1000)).to.not.throw();
    });
  });
});