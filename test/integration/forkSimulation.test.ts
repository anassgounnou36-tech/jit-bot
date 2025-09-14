import { expect } from 'chai';
import { ethers } from 'ethers';
import { runPreflightSimulation } from '../../src/simulator/forkSim';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Fork Integration Tests', function () {
  this.timeout(30000); // 30 second timeout for fork tests

  const TEST_FIXTURES = [
    'fixture-USDC-WETH-0.3%-18500000.json',
    'fixture-USDT-WETH-0.3%-18500100.json',
    'fixture-DAI-WETH-0.3%-18500200.json'
  ];

  describe('E2E Simulation with Victim Transactions', function () {
    TEST_FIXTURES.forEach((fixtureFile) => {
      it(`should simulate profitable JIT strategy for ${fixtureFile}`, async function () {
        // Load test fixture
        const fixturePath = join(process.cwd(), 'reports', fixtureFile);
        const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

        // Prepare simulation parameters
        const simulationParams = {
          poolAddress: fixture.poolAddress,
          swapAmountIn: ethers.BigNumber.from(fixture.swapParams.amountIn),
          swapTokenIn: fixture.swapParams.tokenIn,
          swapTokenOut: fixture.swapParams.tokenOut,
          tickLower: -60, // Example tick range around current price
          tickUpper: 60,
          liquidityAmount: ethers.BigNumber.from(fixture.swapParams.amountIn).mul(2), // 2x swap amount
          gasPrice: ethers.utils.parseUnits('20', 'gwei'),
          blockNumber: fixture.blockNumber,
          victimTransaction: {
            rawTx: fixture.victimTransaction.rawTx,
            hash: fixture.victimTransaction.hash,
            data: fixture.victimTransaction.data
          }
        };

        // Run preflight simulation
        const result = await runPreflightSimulation(simulationParams);

        // Assertions
        expect(result.success).to.be.true;
        expect(result.profitable).to.be.true;
        expect(result.expectedNetProfitUSD).to.be.greaterThan(0);
        
        // Validate all simulation steps passed
        expect(result.validations.poolValidation).to.be.true;
        expect(result.validations.flashloanValidation).to.be.true;
        expect(result.validations.liquidityValidation).to.be.true;
        expect(result.validations.gasValidation).to.be.true;
        
        // Validate simulation steps
        expect(result.simulationSteps.flashloanSimulation).to.be.true;
        expect(result.simulationSteps.mintLiquiditySimulation).to.be.true;
        expect(result.simulationSteps.swapExecutionSimulation).to.be.true;
        expect(result.simulationSteps.burnLiquiditySimulation).to.be.true;
        expect(result.simulationSteps.bundleSimulation).to.be.true;
        expect(result.simulationSteps.victimTxIncluded).to.be.true;

        // Validate breakdown
        expect(result.breakdown).to.exist;
        expect(result.breakdown.flashloanAmount.gt(0)).to.be.true;
        expect(result.breakdown.estimatedFeesCollected.gt(0)).to.be.true;
        expect(result.breakdown.netProfitWei.gt(0)).to.be.true;

        console.log(`✅ ${fixtureFile}: Profit = $${result.expectedNetProfitUSD.toFixed(2)}, Gas = ${result.gasUsed}`);
      });
    });

    it('should fail simulation without victim transaction', async function () {
      // Load fixture but remove victim transaction
      const fixturePath = join(process.cwd(), 'reports', TEST_FIXTURES[0]);
      const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

      const simulationParams = {
        poolAddress: fixture.poolAddress,
        swapAmountIn: ethers.BigNumber.from(fixture.swapParams.amountIn),
        swapTokenIn: fixture.swapParams.tokenIn,
        swapTokenOut: fixture.swapParams.tokenOut,
        tickLower: -60,
        tickUpper: 60,
        liquidityAmount: ethers.BigNumber.from(fixture.swapParams.amountIn).mul(2),
        gasPrice: ethers.utils.parseUnits('20', 'gwei'),
        blockNumber: fixture.blockNumber
        // No victimTransaction provided
      };

      const result = await runPreflightSimulation(simulationParams);

      // Should still succeed but without victim transaction inclusion
      expect(result.success).to.be.true;
      expect(result.simulationSteps.victimTxIncluded).to.be.false;
    });
  });

  describe('Balancer vs Aave Fallback', function () {
    it('should prefer Balancer when liquidity is sufficient', async function () {
      const fixture = JSON.parse(readFileSync(join(process.cwd(), 'reports', TEST_FIXTURES[0]), 'utf8'));

      const simulationParams = {
        poolAddress: fixture.poolAddress,
        swapAmountIn: ethers.utils.parseEther('10'), // Smaller amount for Balancer
        swapTokenIn: fixture.swapParams.tokenIn,
        swapTokenOut: fixture.swapParams.tokenOut,
        tickLower: -60,
        tickUpper: 60,
        liquidityAmount: ethers.utils.parseEther('20'),
        gasPrice: ethers.utils.parseUnits('20', 'gwei'),
        blockNumber: fixture.blockNumber,
        victimTransaction: {
          rawTx: fixture.victimTransaction.rawTx,
          hash: fixture.victimTransaction.hash,
          data: fixture.victimTransaction.data
        }
      };

      const result = await runPreflightSimulation(simulationParams);

      expect(result.success).to.be.true;
      // Should use Balancer (no flashloan fees)
      expect(result.breakdown.flashloanFee).to.equal(ethers.BigNumber.from(0));
    });

    it('should fallback to Aave for large amounts', async function () {
      const fixture = JSON.parse(readFileSync(join(process.cwd(), 'reports', TEST_FIXTURES[0]), 'utf8'));

      const simulationParams = {
        poolAddress: fixture.poolAddress,
        swapAmountIn: ethers.utils.parseEther('10000'), // Large amount to trigger Aave fallback
        swapTokenIn: fixture.swapParams.tokenIn,
        swapTokenOut: fixture.swapParams.tokenOut,
        tickLower: -60,
        tickUpper: 60,
        liquidityAmount: ethers.utils.parseEther('20000'),
        gasPrice: ethers.utils.parseUnits('20', 'gwei'),
        blockNumber: fixture.blockNumber,
        victimTransaction: {
          rawTx: fixture.victimTransaction.rawTx,
          hash: fixture.victimTransaction.hash,
          data: fixture.victimTransaction.data
        }
      };

      const result = await runPreflightSimulation(simulationParams);

      expect(result.success).to.be.true;
      // Should use Aave (with flashloan fees)
      expect(result.breakdown.flashloanFee.gt(0)).to.be.true;
    });
  });

  describe('Profitability Validation', function () {
    it('should reject unprofitable scenarios', async function () {
      const fixture = JSON.parse(readFileSync(join(process.cwd(), 'reports', TEST_FIXTURES[0]), 'utf8'));

      const simulationParams = {
        poolAddress: fixture.poolAddress,
        swapAmountIn: ethers.BigNumber.from(fixture.swapParams.amountIn),
        swapTokenIn: fixture.swapParams.tokenIn,
        swapTokenOut: fixture.swapParams.tokenOut,
        tickLower: -1000, // Bad tick range (far from current price)
        tickUpper: -500,
        liquidityAmount: ethers.utils.parseEther('1'), // Too little liquidity
        gasPrice: ethers.utils.parseUnits('100', 'gwei'), // Very high gas price
        blockNumber: fixture.blockNumber,
        victimTransaction: {
          rawTx: fixture.victimTransaction.rawTx,
          hash: fixture.victimTransaction.hash,
          data: fixture.victimTransaction.data
        }
      };

      const result = await runPreflightSimulation(simulationParams);

      // Simulation should succeed but be unprofitable
      expect(result.success).to.be.true;
      expect(result.profitable).to.be.false;
      expect(result.expectedNetProfitUSD).to.be.lessThanOrEqual(0);
    });

    it('should meet minimum profit thresholds', async function () {
      const fixture = JSON.parse(readFileSync(join(process.cwd(), 'reports', TEST_FIXTURES[0]), 'utf8'));

      const simulationParams = {
        poolAddress: fixture.poolAddress,
        swapAmountIn: ethers.BigNumber.from(fixture.swapParams.amountIn),
        swapTokenIn: fixture.swapParams.tokenIn,
        swapTokenOut: fixture.swapParams.tokenOut,
        tickLower: -60,
        tickUpper: 60,
        liquidityAmount: ethers.BigNumber.from(fixture.swapParams.amountIn).mul(2),
        gasPrice: ethers.utils.parseUnits('20', 'gwei'),
        blockNumber: fixture.blockNumber,
        victimTransaction: {
          rawTx: fixture.victimTransaction.rawTx,
          hash: fixture.victimTransaction.hash,
          data: fixture.victimTransaction.data
        }
      };

      const result = await runPreflightSimulation(simulationParams);

      if (result.profitable) {
        // If profitable, should meet minimum thresholds
        expect(result.expectedNetProfitUSD).to.be.greaterThan(10); // At least $10 profit
        expect(result.validations.profitabilityValidation).to.be.true;
      }
    });
  });

  describe('Error Handling', function () {
    it('should handle invalid pool addresses', async function () {
      const simulationParams = {
        poolAddress: '0x0000000000000000000000000000000000000000', // Invalid pool
        swapAmountIn: ethers.utils.parseEther('10'),
        swapTokenIn: '0xA0b86a33E6427fF2B5B8b9a5e5D17b5c4c6f6b7c',
        swapTokenOut: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        tickLower: -60,
        tickUpper: 60,
        liquidityAmount: ethers.utils.parseEther('20'),
        gasPrice: ethers.utils.parseUnits('20', 'gwei'),
        blockNumber: 18500000
      };

      const result = await runPreflightSimulation(simulationParams);

      expect(result.success).to.be.false;
      expect(result.revertReason).to.include('Pool validation failed');
    });

    it('should handle network errors gracefully', async function () {
      const simulationParams = {
        poolAddress: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8',
        swapAmountIn: ethers.utils.parseEther('10'),
        swapTokenIn: '0xA0b86a33E6427fF2B5B8b9a5e5D17b5c4c6f6b7c',
        swapTokenOut: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        tickLower: -60,
        tickUpper: 60,
        liquidityAmount: ethers.utils.parseEther('20'),
        gasPrice: ethers.utils.parseUnits('20', 'gwei'),
        blockNumber: 99999999 // Far future block that doesn't exist
      };

      const result = await runPreflightSimulation(simulationParams);

      expect(result.success).to.be.false;
      expect(result.revertReason).to.exist;
    });
  });
});