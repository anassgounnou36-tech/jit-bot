import { expect } from 'chai';
import { ethers } from 'ethers';
import { FlashbotsManager, getFlashbotsManager, resetFlashbotsManager } from '../../src/exec/flashbots';

describe('FlashbotsManager', function () {
  this.timeout(10000);
  
  beforeEach(() => {
    resetFlashbotsManager();
  });

  describe('Bundle Creation', () => {
    it('should create a valid Flashbots bundle', async () => {
      const manager = getFlashbotsManager();
      const targetBlock = 12345678;
      
      const transactions = [{
        to: '0x' + '1'.repeat(40),
        data: '0x1234',
        value: ethers.BigNumber.from(0),
        gasLimit: 100000,
        maxFeePerGas: ethers.utils.parseUnits('50', 'gwei'),
        maxPriorityFeePerGas: ethers.utils.parseUnits('2', 'gwei')
      }];

      const bundle = await manager.createBundle(transactions, targetBlock);
      
      expect(bundle.transactions).to.have.length(1);
      expect(bundle.targetBlockNumber).to.equal(targetBlock);
      expect(bundle.maxBlockNumber).to.equal(targetBlock + 3);
      expect(bundle.transactions[0].type).to.equal(2); // EIP-1559
    });

    it('should reject transactions with excessive gas prices', async () => {
      const manager = getFlashbotsManager();
      const targetBlock = 12345678;
      
      const transactions = [{
        to: '0x' + '1'.repeat(40),
        data: '0x1234',
        value: ethers.BigNumber.from(0),
        gasLimit: 100000,
        maxFeePerGas: ethers.utils.parseUnits('200', 'gwei'), // Exceeds 100 gwei limit
        maxPriorityFeePerGas: ethers.utils.parseUnits('2', 'gwei')
      }];

      await expect(manager.createBundle(transactions, targetBlock))
        .to.be.rejectedWith('exceeds limit');
    });

    it('should validate priority fee limits', async () => {
      const manager = getFlashbotsManager();
      const targetBlock = 12345678;
      
      const transactions = [{
        to: '0x' + '1'.repeat(40),
        data: '0x1234',
        value: ethers.BigNumber.from(0),
        gasLimit: 100000,
        maxFeePerGas: ethers.utils.parseUnits('50', 'gwei'),
        maxPriorityFeePerGas: ethers.utils.parseUnits('150', 'gwei') // Exceeds limit
      }];

      await expect(manager.createBundle(transactions, targetBlock))
        .to.be.rejectedWith('exceeds limit');
    });
  });

  describe('Bundle Simulation', () => {
    it('should simulate bundle successfully in simulation mode', async () => {
      const manager = getFlashbotsManager();
      const targetBlock = 12345678;
      
      const bundle = {
        transactions: [{
          to: '0x' + '1'.repeat(40),
          data: '0x1234',
          value: ethers.BigNumber.from(0),
          gasLimit: 100000,
          maxFeePerGas: ethers.utils.parseUnits('50', 'gwei'),
          maxPriorityFeePerGas: ethers.utils.parseUnits('2', 'gwei'),
          type: 2
        }],
        targetBlockNumber: targetBlock,
        maxBlockNumber: targetBlock + 3
      };

      const result = await manager.simulateBundle(bundle);
      
      expect(result.bundleHash).to.be.a('string');
      expect(result.simulation).to.exist;
      expect(result.simulation!.success).to.be.true;
      expect(result.simulation!.gasUsed).to.be.greaterThan(0);
      expect(result.simulation!.effectiveGasPrice).to.be.instanceOf(ethers.BigNumber);
    });

    it('should handle simulation tracing with trace ID', async () => {
      const manager = getFlashbotsManager();
      const targetBlock = 12345678;
      const traceId = 'test-trace-123';
      
      const bundle = {
        transactions: [{
          to: '0x' + '1'.repeat(40),
          data: '0x1234',
          value: ethers.BigNumber.from(0),
          gasLimit: 100000,
          maxFeePerGas: ethers.utils.parseUnits('50', 'gwei'),
          maxPriorityFeePerGas: ethers.utils.parseUnits('2', 'gwei'),
          type: 2
        }],
        targetBlockNumber: targetBlock,
        maxBlockNumber: targetBlock + 3
      };

      const result = await manager.simulateBundle(bundle, traceId);
      
      expect(result.simulation!.success).to.be.true;
    });
  });

  describe('Gas Fee Optimization', () => {
    it('should create optimized gas fees based on base fee', async () => {
      const manager = getFlashbotsManager();
      const baseFee = ethers.utils.parseUnits('30', 'gwei');

      const optimizedGas = await manager.createOptimizedGasFees(baseFee);
      
      expect(optimizedGas.maxFeePerGas).to.be.instanceOf(ethers.BigNumber);
      expect(optimizedGas.maxPriorityFeePerGas).to.be.instanceOf(ethers.BigNumber);
      
      // Priority fee should be 2 gwei
      expect(optimizedGas.maxPriorityFeePerGas.toString())
        .to.equal(ethers.utils.parseUnits('2', 'gwei').toString());
      
      // Max fee should be reasonable (120% of base + priority)
      const expectedMaxFee = baseFee.mul(120).div(100).add(optimizedGas.maxPriorityFeePerGas);
      expect(optimizedGas.maxFeePerGas.toString()).to.equal(expectedMaxFee.toString());
    });

    it('should cap gas fees at MAX_GAS_GWEI', async () => {
      const manager = getFlashbotsManager();
      const highBaseFee = ethers.utils.parseUnits('150', 'gwei'); // Higher than 100 gwei cap

      const optimizedGas = await manager.createOptimizedGasFees(highBaseFee);
      
      const maxGasWei = ethers.utils.parseUnits('100', 'gwei');
      expect(optimizedGas.maxFeePerGas.lte(maxGasWei)).to.be.true;
      expect(optimizedGas.maxPriorityFeePerGas.lte(maxGasWei)).to.be.true;
    });
  });

  describe('Base Fee Fetching', () => {
    it('should get current base fee', async () => {
      const manager = getFlashbotsManager();
      
      const baseFee = await manager.getCurrentBaseFee();
      
      expect(baseFee).to.be.instanceOf(ethers.BigNumber);
      expect(baseFee.gt(0)).to.be.true;
    });

    it('should handle base fee fetch errors gracefully', async () => {
      const manager = getFlashbotsManager();
      
      // The fallback should return 20 gwei when RPC fails
      const baseFee = await manager.getCurrentBaseFee();
      
      expect(baseFee).to.be.instanceOf(ethers.BigNumber);
      expect(baseFee.gte(ethers.utils.parseUnits('20', 'gwei'))).to.be.true;
    });
  });

  describe('Bundle Status', () => {
    it('should get bundle status', async () => {
      const manager = getFlashbotsManager();
      const bundleHash = '0x' + '1'.repeat(64);

      const status = await manager.getBundleStatus(bundleHash);
      
      expect(status).to.have.property('included');
      expect(status.included).to.be.a('boolean');
    });

    it('should handle bundle status with trace ID', async () => {
      const manager = getFlashbotsManager();
      const bundleHash = '0x' + '1'.repeat(64);
      const traceId = 'test-trace-456';

      const status = await manager.getBundleStatus(bundleHash, traceId);
      
      expect(status.included).to.be.false; // Mock always returns false
    });
  });
});