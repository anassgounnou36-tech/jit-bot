import { expect } from 'chai';
import { ethers } from 'ethers';
import { AaveV3FlashloanProvider, getFlashloanOrchestrator, resetFlashloanOrchestrator } from '../../src/exec/flashloan';

describe('FlashloanOrchestrator', function () {
  this.timeout(10000);
  
  beforeEach(() => {
    resetFlashloanOrchestrator();
  });

  describe('Provider Management', () => {
    it('should initialize with default providers', () => {
      const orchestrator = getFlashloanOrchestrator();
      const providers = orchestrator.getAvailableProviders();
      
      expect(providers).to.have.length.greaterThan(0);
      expect(providers.some(p => p.name === 'aave-v3')).to.be.true;
      expect(providers.some(p => p.name === 'compound-v3')).to.be.true;
    });

    it('should get the default provider (aave-v3)', () => {
      const orchestrator = getFlashloanOrchestrator();
      const provider = orchestrator.getProvider();
      
      expect(provider.name).to.equal('aave-v3');
      expect(provider.enabled).to.be.true;
    });

    it('should throw error for non-existent provider', () => {
      const orchestrator = getFlashloanOrchestrator();
      
      expect(() => orchestrator.getProvider('non-existent')).to.throw('Flashloan provider not found');
    });

    it('should throw error for disabled provider', () => {
      const orchestrator = getFlashloanOrchestrator();
      
      expect(() => orchestrator.getProvider('compound-v3')).to.throw('Flashloan provider disabled');
    });
  });

  describe('Aave V3 Provider', () => {
    let provider: AaveV3FlashloanProvider;

    beforeEach(() => {
      provider = new AaveV3FlashloanProvider();
    });

    it('should calculate flashloan fee correctly', async () => {
      const amount = ethers.utils.parseEther('100');
      const fee = await provider.calculateFlashloanFee('0xTokenAddress', amount);
      
      // Aave V3 charges 0.05% = 5/10000
      const expectedFee = amount.mul(5).div(10000);
      expect(fee.toString()).to.equal(expectedFee.toString());
    });

    it('should build flashloan call data', async () => {
      const token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC
      const amount = ethers.utils.parseEther('100');
      const receiver = '0x' + '1'.repeat(40);
      const calldata = '0x1234';

      const result = await provider.buildFlashloanCall(token, amount, receiver, calldata);
      
      expect(result.to).to.equal('0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2'); // Aave V3 Pool
      expect(result.data).to.be.a('string');
      expect(result.data.startsWith('0x')).to.be.true;
      expect(result.value.toString()).to.equal('0');
    });

    it('should return max flashloan amount', async () => {
      const token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      const maxAmount = await provider.getMaxFlashloanAmount(token);
      
      expect(maxAmount.gt(0)).to.be.true;
    });
  });

  describe('Flashloan Validation', () => {
    it('should validate flashloan parameters', async () => {
      const orchestrator = getFlashloanOrchestrator();
      const token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      const amount = ethers.utils.parseEther('10');

      const validation = await orchestrator.validateFlashloanParams(token, amount);
      
      expect(validation.valid).to.be.true;
      expect(validation.issues).to.be.an('array');
      expect(validation.maxAmount).to.be.instanceOf(ethers.BigNumber);
      expect(validation.fee).to.be.instanceOf(ethers.BigNumber);
    });

    it('should fail validation for excessive amount', async () => {
      const orchestrator = getFlashloanOrchestrator();
      const token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      const amount = ethers.utils.parseEther('10000'); // Very large amount

      const validation = await orchestrator.validateFlashloanParams(token, amount);
      
      expect(validation.valid).to.be.false;
      expect(validation.issues.length).to.be.greaterThan(0);
    });

    it('should warn for very small amounts', async () => {
      const orchestrator = getFlashloanOrchestrator();
      const token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      const amount = ethers.utils.parseEther('0.001'); // Very small amount

      const validation = await orchestrator.validateFlashloanParams(token, amount);
      
      expect(validation.valid).to.be.false;
      expect(validation.issues.some(issue => issue.includes('too small'))).to.be.true;
    });
  });

  describe('JIT Transaction Building', () => {
    it('should build complete JIT flashloan transaction', async () => {
      const orchestrator = getFlashloanOrchestrator();
      const token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      const amount = ethers.utils.parseEther('100');
      const jitExecutor = '0x' + '2'.repeat(40);
      
      const swapParams = {
        poolAddress: '0x' + '3'.repeat(40),
        amountIn: ethers.utils.parseEther('10'),
        tokenIn: token,
        tokenOut: '0x' + '4'.repeat(40),
        tickLower: -1000,
        tickUpper: 1000,
        liquidity: ethers.utils.parseEther('50')
      };

      const result = await orchestrator.buildJitFlashloanTransaction(
        token,
        amount,
        jitExecutor,
        swapParams
      );
      
      expect(result.to).to.be.a('string');
      expect(result.data).to.be.a('string');
      expect(result.value).to.be.instanceOf(ethers.BigNumber);
      expect(result.gasEstimate).to.be.a('number');
      expect(result.gasEstimate).to.be.greaterThan(0);
      expect(result.flashloanFee).to.be.instanceOf(ethers.BigNumber);
    });
  });
});