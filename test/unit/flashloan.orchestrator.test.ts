import { expect } from 'chai';
import { ethers } from 'ethers';
import { FlashloanOrchestrator } from '../../src/exec/flashloan';
import { getBalancerAdapter, resetBalancerAdapter } from '../../src/exec/balancerAdapter';
import { getAaveAdapter, resetAaveAdapter } from '../../src/exec/aaveAdapter';

describe('Flashloan Orchestrator', function () {
  let orchestrator: FlashloanOrchestrator;
  let mockProvider: ethers.providers.JsonRpcProvider;

  beforeEach(function () {
    // Reset adapters for clean tests
    resetBalancerAdapter();
    resetAaveAdapter();
    
    // Create mock provider
    mockProvider = new ethers.providers.JsonRpcProvider('http://localhost:8545');
    
    // Create orchestrator
    orchestrator = new FlashloanOrchestrator();
  });

  describe('Provider Selection', function () {
    it('should prefer Balancer when sufficient liquidity exists', async function () {
      const token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC
      const amount = ethers.utils.parseEther('100'); // Use amount within Balancer simulation range

      const result = await orchestrator.selectOptimalProvider(token, amount, mockProvider);

      expect(result.providerType).to.equal('balancer');
      expect(result.fee).to.equal(ethers.BigNumber.from(0));
      expect(result.reason).to.include('no fees');
    });

    it('should fallback to Aave when Balancer liquidity insufficient', async function () {
      const token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC
      const amount = ethers.utils.parseEther('1000'); // Use amount that exceeds Balancer but fits Aave

      const result = await orchestrator.selectOptimalProvider(token, amount, mockProvider);

      expect(result.providerType).to.equal('aave');
      expect(result.fee.gt(0)).to.be.true;
      expect(result.reason).to.include('Balancer insufficient');
    });

    it('should throw error when no provider has sufficient liquidity', async function () {
      const token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC
      const amount = ethers.utils.parseEther('10000'); // Very large amount that exceeds both

      try {
        await orchestrator.selectOptimalProvider(token, amount, mockProvider);
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('No flashloan provider has sufficient liquidity');
      }
    });
  });

  describe('Flashloan Validation', function () {
    it('should validate flashloan parameters and select provider', async function () {
      const token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // Valid USDC address
      const amount = ethers.utils.parseEther('100'); // Use amount within Balancer range

      const result = await orchestrator.validateFlashloanParams(token, amount, mockProvider);

      expect(result.valid).to.be.true;
      expect(result.issues).to.be.empty;
      expect(result.selectedProvider).to.equal('balancer');
      expect(result.fee).to.equal(ethers.BigNumber.from(0));
      expect(result.adapter).to.exist;
    });

    it('should reject invalid token address', async function () {
      const invalidToken = '0xinvalid';
      const amount = ethers.utils.parseEther('100');

      const result = await orchestrator.validateFlashloanParams(invalidToken, amount, mockProvider);

      expect(result.valid).to.be.false;
      expect(result.issues).to.include('Invalid token address');
    });

    it('should reject zero or negative amounts', async function () {
      const token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC
      const zeroAmount = ethers.BigNumber.from(0);

      const result = await orchestrator.validateFlashloanParams(token, zeroAmount, mockProvider);

      expect(result.valid).to.be.false;
      expect(result.issues).to.include('Amount must be positive');
    });
  });

  describe('Fee Calculation', function () {
    it('should calculate correct Aave fees', async function () {
      const token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC
      const amount = ethers.utils.parseEther('1000'); // Use amount that exceeds Balancer but fits Aave

      const result = await orchestrator.validateFlashloanParams(token, amount, mockProvider);

      expect(result.valid).to.be.true;
      expect(result.selectedProvider).to.equal('aave');
      
      // Check fee calculation: 1000 ETH * 0.05% = 0.5 ETH
      const expectedFee = amount.mul(5).div(10000);
      expect(result.fee).to.equal(expectedFee);
    });

    it('should have zero fees for Balancer', async function () {
      const token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC
      const amount = ethers.utils.parseEther('50'); // Use amount that Balancer simulation can handle

      const result = await orchestrator.validateFlashloanParams(token, amount, mockProvider);

      expect(result.valid).to.be.true;
      expect(result.selectedProvider).to.equal('balancer');
      expect(result.fee).to.equal(ethers.BigNumber.from(0));
    });
  });

  describe('Integration with Providers', function () {
    it('should handle provider failures gracefully', async function () {
      // Use amount that should succeed normally but test failure handling
      const token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC
      const amount = ethers.utils.parseEther('100');

      // For this test, we'll use an invalid token to trigger failure
      const invalidToken = '0xinvalid';
      const result = await orchestrator.validateFlashloanParams(invalidToken, amount, mockProvider);

      expect(result.valid).to.be.false;
      expect(result.issues.some(issue => issue.includes('Provider selection failed'))).to.be.true;
    });

    it('should prefer lower fees when both providers have liquidity', async function () {
      // Test with amount that both providers can handle (within Balancer range)
      const token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC
      const amount = ethers.utils.parseEther('100');

      const result = await orchestrator.selectOptimalProvider(token, amount, mockProvider);

      // Should prefer Balancer (0 fees) over Aave (0.05% fees)
      expect(result.providerType).to.equal('balancer');
      expect(result.fee).to.equal(ethers.BigNumber.from(0));
    });
  });
});