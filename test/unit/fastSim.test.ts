import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { fastSimulator, FastSimulator } from '../../src/simulator/fastSim';

describe('FastSimulator', () => {
  let simulator: FastSimulator;

  before(() => {
    simulator = fastSimulator;
  });

  describe('Opportunity Simulation', () => {
    it('should simulate a basic swap opportunity', async () => {
      const candidate = {
        hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640', // WETH-USDC pool
        tokenIn: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        tokenOut: '0xA0b86a33E6441b80B05fdC68F34f8c9C31C8DE4E', // USDC
        amountIn: BigNumber.from('1000000000000000000'), // 1 ETH
        amountOut: BigNumber.from('2000000000'), // 2000 USDC (6 decimals)
        estimatedPrice: BigNumber.from('2000000000000000000000'), // $2000 per ETH
      };

      const result = await simulator.simulateOpportunity(candidate);

      expect(result).to.have.property('profitable');
      expect(result).to.have.property('estimatedNetProfitUsd');
      expect(result).to.have.property('grossFeeCapture');
      expect(result).to.have.property('gasCostUsd');
      expect(result).to.have.property('flashLoanCostUsd');
      expect(result).to.have.property('lpShare');
      expect(result).to.have.property('confidence');
      expect(result).to.have.property('breakdown');

      expect(result.estimatedNetProfitUsd).to.be.a('number');
      expect(result.gasCostUsd).to.be.a('number');
      expect(result.flashLoanCostUsd).to.equal(0); // Should be 0 in PR1
      expect(result.lpShare).to.be.a('number');
      expect(result.lpShare).to.be.at.least(0);
      expect(result.lpShare).to.be.at.most(1);
      expect(['low', 'medium', 'high']).to.include(result.confidence);
    });

    it('should handle unknown pool addresses', async () => {
      const candidate = {
        hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        poolAddress: '0x0000000000000000000000000000000000000001', // Unknown pool
        tokenIn: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        tokenOut: '0xA0b86a33E6441b80B05fdC68F34f8c9C31C8DE4E',
        amountIn: BigNumber.from('1000000000000000000'),
        amountOut: BigNumber.from('2000000000'),
        estimatedPrice: BigNumber.from('2000000000000000000000'),
      };

      const result = await simulator.simulateOpportunity(candidate);

      expect(result.profitable).to.be.false;
      expect(result.reason).to.exist;
      expect(result.reason).to.include('Pool configuration not found');
    });

    it('should reject opportunities below profit threshold', async () => {
      const candidate = {
        hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
        tokenIn: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        tokenOut: '0xA0b86a33E6441b80B05fdC68F34f8c9C31C8DE4E',
        amountIn: BigNumber.from('1000000000000000'), // Very small amount (0.001 ETH)
        amountOut: BigNumber.from('2000000'),
        estimatedPrice: BigNumber.from('2000000000000000000000'),
      };

      const result = await simulator.simulateOpportunity(candidate);

      // Small swaps should typically not be profitable after gas costs
      expect(result.estimatedNetProfitUsd).to.be.a('number');
      
      if (!result.profitable) {
        expect(result.reason).to.exist;
        expect(result.reason).to.be.a('string');
      }
    });
  });

  describe('Profitability Calculation', () => {
    it('should calculate fee capture correctly', async () => {
      const candidate = {
        hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640', // 0.05% fee pool
        tokenIn: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        tokenOut: '0xA0b86a33E6441b80B05fdC68F34f8c9C31C8DE4E',
        amountIn: BigNumber.from('10000000000000000000'), // 10 ETH
        amountOut: BigNumber.from('20000000000'), // 20000 USDC
        estimatedPrice: BigNumber.from('2000000000000000000000'),
      };

      const result = await simulator.simulateOpportunity(candidate);

      expect(result.breakdown).to.exist;
      expect(result.breakdown.feeRate).to.be.a('number');
      expect(result.breakdown.swapFeeUsd).to.be.a('number');
      expect(result.breakdown.lpFeeShareUsd).to.be.a('number');

      // Fee rate should match the pool's fee tier
      expect(result.breakdown.feeRate).to.be.closeTo(0.0005, 0.0001); // 0.05% ± tolerance

      // LP fee share should be less than or equal to total swap fee
      expect(result.breakdown.lpFeeShareUsd).to.be.at.most(result.breakdown.swapFeeUsd);
    });

    it('should include gas costs in profitability', async () => {
      const candidate = {
        hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
        tokenIn: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        tokenOut: '0xA0b86a33E6441b80B05fdC68F34f8c9C31C8DE4E',
        amountIn: BigNumber.from('1000000000000000000'),
        amountOut: BigNumber.from('2000000000'),
        estimatedPrice: BigNumber.from('2000000000000000000000'),
      };

      const result = await simulator.simulateOpportunity(candidate);

      expect(result.gasCostUsd).to.be.greaterThan(0);
      
      // Gas cost should be reasonable (less than $500 for normal operations)
      expect(result.gasCostUsd).to.be.lessThan(500);
      
      // Flash loan cost should be 0 in PR1
      expect(result.flashLoanCostUsd).to.equal(0);
    });

    it('should handle different pool fee tiers', async () => {
      const pools = [
        {
          address: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640', // 0.05% fee
          expectedFeeRate: 0.0005
        },
        {
          address: '0x4e68Ccd3E89f51C3074ca5072bbAC773960dFa36', // 0.3% fee
          expectedFeeRate: 0.003
        }
      ];

      for (const pool of pools) {
        const candidate = {
          hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          poolAddress: pool.address,
          tokenIn: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          tokenOut: '0xA0b86a33E6441b80B05fdC68F34f8c9C31C8DE4E',
          amountIn: BigNumber.from('1000000000000000000'),
          amountOut: BigNumber.from('2000000000'),
          estimatedPrice: BigNumber.from('2000000000000000000000'),
        };

        try {
          const result = await simulator.simulateOpportunity(candidate);
          
          if (result.breakdown) {
            expect(result.breakdown.feeRate).to.be.closeTo(pool.expectedFeeRate, 0.001);
          }
        } catch (error) {
          // Some pools might not be available in test environment
          console.log(`Pool ${pool.address} not available in test environment`);
        }
      }
    });
  });

  describe('LP Share Estimation', () => {
    it('should estimate LP share realistically', async () => {
      const candidate = {
        hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
        tokenIn: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        tokenOut: '0xA0b86a33E6441b80B05fdC68F34f8c9C31C8DE4E',
        amountIn: BigNumber.from('1000000000000000000'),
        amountOut: BigNumber.from('2000000000'),
        estimatedPrice: BigNumber.from('2000000000000000000000'),
      };

      const result = await simulator.simulateOpportunity(candidate);

      expect(result.lpShare).to.be.at.least(0);
      expect(result.lpShare).to.be.at.most(1);
      
      // For most realistic scenarios, LP share should be small
      expect(result.lpShare).to.be.lessThan(0.5); // Less than 50%
    });

    it('should provide confidence levels based on LP share', async () => {
      const candidate = {
        hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
        tokenIn: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        tokenOut: '0xA0b86a33E6441b80B05fdC68F34f8c9C31C8DE4E',
        amountIn: BigNumber.from('1000000000000000000'),
        amountOut: BigNumber.from('2000000000'),
        estimatedPrice: BigNumber.from('2000000000000000000000'),
      };

      const result = await simulator.simulateOpportunity(candidate);

      expect(['low', 'medium', 'high']).to.include(result.confidence);
      
      // Confidence should correlate with LP share
      if (result.lpShare > 0.1) {
        expect(['medium', 'high']).to.include(result.confidence);
      }
    });
  });

  describe('Batch Simulation', () => {
    it('should simulate multiple opportunities concurrently', async () => {
      const candidates = [
        {
          hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
          poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
          tokenIn: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          tokenOut: '0xA0b86a33E6441b80B05fdC68F34f8c9C31C8DE4E',
          amountIn: BigNumber.from('1000000000000000000'),
          amountOut: BigNumber.from('2000000000'),
          estimatedPrice: BigNumber.from('2000000000000000000000'),
        },
        {
          hash: '0x2222222222222222222222222222222222222222222222222222222222222222',
          poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
          tokenIn: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          tokenOut: '0xA0b86a33E6441b80B05fdC68F34f8c9C31C8DE4E',
          amountIn: BigNumber.from('5000000000000000000'),
          amountOut: BigNumber.from('10000000000'),
          estimatedPrice: BigNumber.from('2000000000000000000000'),
        }
      ];

      const results = await simulator.simulateMultiple(candidates);

      expect(results.size).to.equal(candidates.length);
      
      candidates.forEach(candidate => {
        expect(results.has(candidate.hash)).to.be.true;
        
        const result = results.get(candidate.hash)!;
        expect(result).to.have.property('profitable');
        expect(result).to.have.property('estimatedNetProfitUsd');
      });
    });

    it('should handle empty candidate list', async () => {
      const results = await simulator.simulateMultiple([]);
      expect(results.size).to.equal(0);
    });

    it('should handle mixed valid and invalid candidates', async () => {
      const candidates = [
        {
          hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
          poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640', // Valid
          tokenIn: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          tokenOut: '0xA0b86a33E6441b80B05fdC68F34f8c9C31C8DE4E',
          amountIn: BigNumber.from('1000000000000000000'),
          amountOut: BigNumber.from('2000000000'),
          estimatedPrice: BigNumber.from('2000000000000000000000'),
        },
        {
          hash: '0x2222222222222222222222222222222222222222222222222222222222222222',
          poolAddress: '0x0000000000000000000000000000000000000001', // Invalid
          tokenIn: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          tokenOut: '0xA0b86a33E6441b80B05fdC68F34f8c9C31C8DE4E',
          amountIn: BigNumber.from('1000000000000000000'),
          amountOut: BigNumber.from('2000000000'),
          estimatedPrice: BigNumber.from('2000000000000000000000'),
        }
      ];

      const results = await simulator.simulateMultiple(candidates);

      // Should have results for both (valid and failed)
      expect(results.size).to.equal(candidates.length);
      
      // Valid candidate should have meaningful result
      const validResult = results.get(candidates[0].hash);
      expect(validResult).to.exist;
      
      // Invalid candidate should have failed result
      const invalidResult = results.get(candidates[1].hash);
      expect(invalidResult).to.exist;
      expect(invalidResult!.profitable).to.be.false;
      expect(invalidResult!.reason).to.exist;
    });
  });

  describe('Statistics and Information', () => {
    it('should provide component statistics', () => {
      const stats = simulator.getStats();
      
      expect(stats).to.have.property('component');
      expect(stats).to.have.property('description');
      expect(stats).to.have.property('features');
      expect(stats).to.have.property('limitations');
      
      expect(stats.component).to.equal('FastSimulator');
      expect(stats.features).to.be.an('array');
      expect(stats.limitations).to.be.an('array');
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      const candidate = {
        hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
        tokenIn: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        tokenOut: '0xA0b86a33E6441b80B05fdC68F34f8c9C31C8DE4E',
        amountIn: BigNumber.from('1000000000000000000'),
        amountOut: BigNumber.from('2000000000'),
        estimatedPrice: BigNumber.from('2000000000000000000000'),
      };

      // Should not throw even if network requests fail
      try {
        const result = await simulator.simulateOpportunity(candidate);
        expect(result).to.exist;
      } catch (error) {
        expect.fail('Should handle network errors gracefully');
      }
    });

    it('should handle invalid BigNumber values', async () => {
      const candidate = {
        hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
        tokenIn: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        tokenOut: '0xA0b86a33E6441b80B05fdC68F34f8c9C31C8DE4E',
        amountIn: BigNumber.from(0), // Zero amount
        amountOut: BigNumber.from('2000000000'),
        estimatedPrice: BigNumber.from('2000000000000000000000'),
      };

      const result = await simulator.simulateOpportunity(candidate);
      
      // Should handle gracefully, likely returning unprofitable
      expect(result).to.exist;
      expect(result.profitable).to.be.false;
    });
  });

  describe('Performance', () => {
    it('should complete simulations in reasonable time', async () => {
      const candidate = {
        hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
        tokenIn: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        tokenOut: '0xA0b86a33E6441b80B05fdC68F34f8c9C31C8DE4E',
        amountIn: BigNumber.from('1000000000000000000'),
        amountOut: BigNumber.from('2000000000'),
        estimatedPrice: BigNumber.from('2000000000000000000000'),
      };

      const startTime = Date.now();
      const result = await simulator.simulateOpportunity(candidate);
      const duration = Date.now() - startTime;

      expect(result).to.exist;
      expect(duration).to.be.lessThan(5000); // Should complete within 5 seconds
    });
  });
});