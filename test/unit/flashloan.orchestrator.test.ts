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
      // Mock Balancer adapter with sufficient liquidity
      const balancerAdapter = getBalancerAdapter(mockProvider);
      balancerAdapter.hassufficientLiquidity = async () => true;
      balancerAdapter.calculateFlashloanFee = async () => ethers.BigNumber.from(0);

      // Mock Aave adapter
      const aaveAdapter = getAaveAdapter(mockProvider);
      aaveAdapter.hasSufficientLiquidity = async () => true;
      aaveAdapter.calculateFlashloanFee = async () => ethers.utils.parseEther('0.005'); // 0.5% fee

      const token = '0xA0b86a33E6427fF2B5B8b9a5e5D17b5c4c6f6b7c'; // USDC
      const amount = ethers.utils.parseEther('100');

      const result = await orchestrator.selectOptimalProvider(token, amount, mockProvider);

      expect(result.providerType).to.equal('balancer');
      expect(result.fee).to.equal(ethers.BigNumber.from(0));
      expect(result.reason).to.include('no fees');
    });

    it('should fallback to Aave when Balancer liquidity insufficient', async function () {
      // Mock Balancer adapter with insufficient liquidity
      const balancerAdapter = getBalancerAdapter(mockProvider);
      balancerAdapter.hassufficientLiquidity = async () => false;

      // Mock Aave adapter with sufficient liquidity
      const aaveAdapter = getAaveAdapter(mockProvider);
      aaveAdapter.hasSufficientLiquidity = async () => true;
      aaveAdapter.calculateFlashloanFee = async (token: string, amount: ethers.BigNumber) => {
        return amount.mul(5).div(10000); // 0.05% fee
      };

      const token = '0xA0b86a33E6427fF2B5B8b9a5e5D17b5c4c6f6b7c'; // USDC
      const amount = ethers.utils.parseEther('1000');

      const result = await orchestrator.selectOptimalProvider(token, amount, mockProvider);

      expect(result.providerType).to.equal('aave');
      expect(result.fee.gt(0)).to.be.true;
      expect(result.reason).to.include('Balancer insufficient');
    });

    it('should throw error when no provider has sufficient liquidity', async function () {
      // Mock both adapters with insufficient liquidity
      const balancerAdapter = getBalancerAdapter(mockProvider);
      balancerAdapter.hassufficientLiquidity = async () => false;

      const aaveAdapter = getAaveAdapter(mockProvider);
      aaveAdapter.hasSufficientLiquidity = async () => false;

      const token = '0xA0b86a33E6427fF2B5B8b9a5e5D17b5c4c6f6b7c'; // USDC
      const amount = ethers.utils.parseEther('10000'); // Very large amount

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
      // Mock Balancer adapter with sufficient liquidity
      const balancerAdapter = getBalancerAdapter(mockProvider);
      balancerAdapter.hassufficientLiquidity = async () => true;
      balancerAdapter.calculateFlashloanFee = async () => ethers.BigNumber.from(0);

      const token = '0xA0b86a33E6427fF2B5B8b9a5e5D17b5c4c6f6b7c'; // Valid USDC address
      const amount = ethers.utils.parseEther('100');

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
      const token = '0xA0b86a33E6427fF2B5B8b9a5e5D17b5c4c6f6b7c'; // USDC
      const zeroAmount = ethers.BigNumber.from(0);

      const result = await orchestrator.validateFlashloanParams(token, zeroAmount, mockProvider);

      expect(result.valid).to.be.false;
      expect(result.issues).to.include('Amount must be positive');
    });
  });

  describe('Fee Calculation', function () {
    it('should calculate correct Aave fees', async function () {
      // Mock Aave adapter only
      const balancerAdapter = getBalancerAdapter(mockProvider);
      balancerAdapter.hassufficientLiquidity = async () => false;

      const aaveAdapter = getAaveAdapter(mockProvider);
      aaveAdapter.hasSufficientLiquidity = async () => true;
      aaveAdapter.calculateFlashloanFee = async (token: string, amount: ethers.BigNumber) => {
        return amount.mul(5).div(10000); // 0.05% fee
      };

      const token = '0xA0b86a33E6427fF2B5B8b9a5e5D17b5c4c6f6b7c'; // USDC
      const amount = ethers.utils.parseEther('1000');

      const result = await orchestrator.validateFlashloanParams(token, amount, mockProvider);

      expect(result.valid).to.be.true;
      expect(result.selectedProvider).to.equal('aave');
      
      // Check fee calculation: 1000 ETH * 0.05% = 0.5 ETH
      const expectedFee = amount.mul(5).div(10000);
      expect(result.fee).to.equal(expectedFee);
    });

    it('should have zero fees for Balancer', async function () {
      // Mock Balancer adapter with sufficient liquidity
      const balancerAdapter = getBalancerAdapter(mockProvider);
      balancerAdapter.hassufficientLiquidity = async () => true;
      balancerAdapter.calculateFlashloanFee = async () => ethers.BigNumber.from(0);

      const token = '0xA0b86a33E6427fF2B5B8b9a5e5D17b5c4c6f6b7c'; // USDC
      const amount = ethers.utils.parseEther('500');

      const result = await orchestrator.validateFlashloanParams(token, amount, mockProvider);

      expect(result.valid).to.be.true;
      expect(result.selectedProvider).to.equal('balancer');
      expect(result.fee).to.equal(ethers.BigNumber.from(0));
    });
  });

  describe('Integration with Providers', function () {
    it('should handle provider failures gracefully', async function () {
      // Mock adapters that throw errors
      const balancerAdapter = getBalancerAdapter(mockProvider);
      balancerAdapter.hassufficientLiquidity = async () => {
        throw new Error('Balancer API unavailable');
      };

      const token = '0xA0b86a33E6427fF2B5B8b9a5e5D17b5c4c6f6b7c'; // USDC
      const amount = ethers.utils.parseEther('100');

      const result = await orchestrator.validateFlashloanParams(token, amount, mockProvider);

      expect(result.valid).to.be.false;
      expect(result.issues.some(issue => issue.includes('Provider selection failed'))).to.be.true;
    });

    it('should prefer lower fees when both providers have liquidity', async function () {
      // Both providers have sufficient liquidity
      const balancerAdapter = getBalancerAdapter(mockProvider);
      balancerAdapter.hassufficientLiquidity = async () => true;
      balancerAdapter.calculateFlashloanFee = async () => ethers.BigNumber.from(0);

      const aaveAdapter = getAaveAdapter(mockProvider);
      aaveAdapter.hasSufficientLiquidity = async () => true;
      aaveAdapter.calculateFlashloanFee = async () => ethers.utils.parseEther('0.005');

      const token = '0xA0b86a33E6427fF2B5B8b9a5e5D17b5c4c6f6b7c'; // USDC
      const amount = ethers.utils.parseEther('100');

      const result = await orchestrator.selectOptimalProvider(token, amount, mockProvider);

      // Should prefer Balancer (0 fees) over Aave (0.05% fees)
      expect(result.providerType).to.equal('balancer');
      expect(result.fee).to.equal(ethers.BigNumber.from(0));
    });
  });
});