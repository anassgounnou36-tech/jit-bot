import { expect } from 'chai';
import { ethers } from 'ethers';
import { FlashloanOrchestrator } from '../../src/exec/flashloan';
import { resetBalancerAdapter } from '../../src/exec/balancerAdapter';
import { resetAaveAdapter } from '../../src/exec/aaveAdapter';

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
      const amount = ethers.utils.parseUnits('100', 6); // 100 USDC with 6 decimals

      const result = await orchestrator.selectOptimalProvider(token, amount, mockProvider);

      expect(result.providerType).to.equal('balancer');
      expect(result.fee.eq(ethers.BigNumber.from(0))).to.be.true;
      expect(result.reason).to.include('no fees');
    });

    it('should fallback to Aave when Balancer liquidity insufficient', async function () {
      const token = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; // WETH
      // Use 120 ETH (~$240k at $2000/ETH) which exceeds Balancer (100 ETH limit) but stays under 300k USD cap
      const amount = ethers.utils.parseEther('120'); // 120 ETH

      const result = await orchestrator.selectOptimalProvider(token, amount, mockProvider);

      expect(result.providerType).to.equal('aave');
      expect(result.fee.gt(0)).to.be.true;
      expect(result.reason).to.include('Balancer insufficient');
    });

    it('should throw error when amount exceeds USD cap', async function () {
      const token = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; // WETH
      // Use 200 ETH (~$400k at $2000/ETH) to exceed 300k USD cap
      const amount = ethers.utils.parseEther('200'); // 200 ETH

      try {
        await orchestrator.selectOptimalProvider(token, amount, mockProvider);
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('exceeds maximum allowed');
      }
    });
  });

  describe('Flashloan Validation', function () {
    it('should validate flashloan parameters and select provider', async function () {
      const token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // Valid USDC address
      const amount = ethers.utils.parseUnits('100', 6); // 100 USDC with 6 decimals

      const result = await orchestrator.validateFlashloanParams(token, amount, mockProvider);

      // 100 USDC ($100) should be valid (above $10 minimum)
      expect(result.valid).to.be.true;
      expect(result.selectedProvider).to.equal('balancer');
      expect(result.fee?.eq(ethers.BigNumber.from(0))).to.be.true;
      expect(result.adapter).to.exist;
    });

    it('should reject invalid token address', async function () {
      const invalidToken = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB49'; // Invalid checksummed address
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
      const token = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; // WETH
      // Use 120 ETH (~$240k at $2000/ETH) which triggers Aave and stays under 300k USD cap
      const amount = ethers.utils.parseEther('120'); // 120 ETH

      const result = await orchestrator.validateFlashloanParams(token, amount, mockProvider);

      expect(result.selectedProvider).to.equal('aave');
      
      // Check fee calculation: amount * 0.05% 
      const expectedFee = amount.mul(5).div(10000); // 0.05% of the amount
      expect(result.fee?.eq(expectedFee)).to.be.true;
    });

    it('should have zero fees for Balancer', async function () {
      const token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC
      const amount = ethers.utils.parseUnits('50', 6); // 50 USDC with 6 decimals

      const result = await orchestrator.validateFlashloanParams(token, amount, mockProvider);

      expect(result.selectedProvider).to.equal('balancer');
      expect(result.fee?.eq(ethers.BigNumber.from(0))).to.be.true;
    });
  });

  describe('Integration with Providers', function () {
    it('should handle provider failures gracefully', async function () {
      // Use amount that should succeed normally but test failure handling
      const amount = ethers.utils.parseUnits('100', 6); // 100 USDC with 6 decimals

      // For this test, we'll use an invalid token to trigger failure
      const invalidToken = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB49'; // Invalid checksummed address
      const result = await orchestrator.validateFlashloanParams(invalidToken, amount, mockProvider);

      expect(result.valid).to.be.false;
      expect(result.issues.some(issue => issue.includes('Provider selection failed'))).to.be.true;
    });

    it('should enforce 300k USD cap with various token types', async function () {
      // Test with USDC: 250k USDC should pass (under 300k cap)
      const usdcToken = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      const validUsdcAmount = ethers.utils.parseUnits('250000', 6); // 250k USDC

      const validResult = await orchestrator.validateFlashloanParams(usdcToken, validUsdcAmount, mockProvider);
      expect(validResult.valid).to.be.true;

      // Test with WETH: 149 ETH should pass (~$298k at $2000/ETH, under 300k cap)
      const wethToken = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
      const validWethAmount = ethers.utils.parseEther('149'); // 149 ETH

      const validWethResult = await orchestrator.validateFlashloanParams(wethToken, validWethAmount, mockProvider);
      expect(validWethResult.valid).to.be.true;

      // Test cap enforcement: 151 ETH should fail (~$302k at $2000/ETH, over 300k cap)
      const invalidWethAmount = ethers.utils.parseEther('151'); // 151 ETH

      const invalidResult = await orchestrator.validateFlashloanParams(wethToken, invalidWethAmount, mockProvider);
      expect(invalidResult.valid).to.be.false;
      expect(invalidResult.issues.some(issue => issue.includes('exceeds maximum allowed'))).to.be.true;
    });

    it('should prefer lower fees when both providers have liquidity', async function () {
      // Test with amount that both providers can handle (within Balancer range)
      const token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC
      const amount = ethers.utils.parseUnits('100', 6); // 100 USDC with 6 decimals

      const result = await orchestrator.selectOptimalProvider(token, amount, mockProvider);

      // Should prefer Balancer (0 fees) over Aave (0.05% fees)
      expect(result.providerType).to.equal('balancer');
      expect(result.fee.eq(ethers.BigNumber.from(0))).to.be.true;
    });
  });
});