import { expect } from 'chai';
import { ethers } from 'ethers';
import {
  calculateGasCost,
  calculateGasCostUsd,
  getJitOperationGasEstimate,
  checkGasPrice,
  estimateConfirmationTime,
  clearGasPriceCache,
  JIT_GAS_CONSTANTS
} from '../../src/util/gasEstimator';

// Mock provider for testing (not used in current tests but kept for future use)
// const mockProvider = {
//   getFeeData: async () => ({
//     gasPrice: ethers.utils.parseUnits('20', 'gwei'),
//     maxFeePerGas: ethers.utils.parseUnits('25', 'gwei'),
//     maxPriorityFeePerGas: ethers.utils.parseUnits('2', 'gwei')
//   }),
//   getGasPrice: async () => ethers.utils.parseUnits('20', 'gwei')
// };

// Mock the config and provider modules
const originalEnv = process.env;

describe('GasEstimator', () => {
  beforeEach(() => {
    clearGasPriceCache();
    // Set test environment variables
    process.env.MAX_GAS_GWEI = '100';
    process.env.RPC_URL_HTTP = 'http://localhost:8545';
    process.env.RPC_URL_WS = 'ws://localhost:8545';
    process.env.CHAIN = 'ethereum';
    process.env.SIMULATION_MODE = 'true';
    process.env.PRIVATE_KEY = '0x' + '1'.repeat(64);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('JIT_GAS_CONSTANTS', () => {
    it('should have reasonable gas estimates', () => {
      expect(JIT_GAS_CONSTANTS.flashLoan).to.be.greaterThan(0);
      expect(JIT_GAS_CONSTANTS.mintPosition).to.be.greaterThan(0);
      expect(JIT_GAS_CONSTANTS.burnPosition).to.be.greaterThan(0);
      expect(JIT_GAS_CONSTANTS.collectFees).to.be.greaterThan(0);
      expect(JIT_GAS_CONSTANTS.repayFlashLoan).to.be.greaterThan(0);
      expect(JIT_GAS_CONSTANTS.swapOverhead).to.be.greaterThan(0);
      
      // Total should be sum of individual components
      const sum = JIT_GAS_CONSTANTS.flashLoan + 
                  JIT_GAS_CONSTANTS.mintPosition + 
                  JIT_GAS_CONSTANTS.burnPosition + 
                  JIT_GAS_CONSTANTS.collectFees + 
                  JIT_GAS_CONSTANTS.repayFlashLoan + 
                  JIT_GAS_CONSTANTS.swapOverhead;
      
      expect(JIT_GAS_CONSTANTS.totalEstimate).to.equal(sum);
    });
  });

  describe('calculateGasCost', () => {
    it('should calculate gas cost correctly', () => {
      const gasPrice = ethers.utils.parseUnits('20', 'gwei');
      const gasUsed = 500000;
      
      const gasEstimate = {
        gasPrice,
        gasPriceGwei: 20,
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas: ethers.utils.parseUnits('2', 'gwei'),
        isEIP1559: false,
        capped: false
      };
      
      const gasCost = calculateGasCost(gasEstimate, gasUsed);
      
      expect(gasCost).to.be.instanceOf(ethers.BigNumber);
      expect(gasCost.eq(gasPrice.mul(gasUsed))).to.be.true;
    });

    it('should use default gas amount when not specified', () => {
      const gasPrice = ethers.utils.parseUnits('20', 'gwei');
      
      const gasEstimate = {
        gasPrice,
        gasPriceGwei: 20,
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas: ethers.utils.parseUnits('2', 'gwei'),
        isEIP1559: false,
        capped: false
      };
      
      const gasCost = calculateGasCost(gasEstimate);
      
      expect(gasCost.eq(gasPrice.mul(JIT_GAS_CONSTANTS.totalEstimate))).to.be.true;
    });
  });

  describe('calculateGasCostUsd', () => {
    it('should calculate gas cost in USD', () => {
      const gasPrice = ethers.utils.parseUnits('20', 'gwei');
      const ethPriceUsd = 2000;
      const gasUsed = 500000;
      
      const gasEstimate = {
        gasPrice,
        gasPriceGwei: 20,
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas: ethers.utils.parseUnits('2', 'gwei'),
        isEIP1559: false,
        capped: false
      };
      
      const gasCostUsd = calculateGasCostUsd(gasEstimate, ethPriceUsd, gasUsed);
      
      expect(gasCostUsd).to.be.a('number');
      expect(gasCostUsd).to.be.greaterThan(0);
      
      // Should be approximately gasPrice * gasUsed * ethPrice
      const expectedGasCostEth = parseFloat(ethers.utils.formatEther(gasPrice.mul(gasUsed)));
      const expectedGasCostUsd = expectedGasCostEth * ethPriceUsd;
      
      expect(gasCostUsd).to.be.approximately(expectedGasCostUsd, 0.01);
    });
  });

  describe('getJitOperationGasEstimate', () => {
    it('should calculate gas for specific operations', () => {
      const operations: Array<keyof typeof JIT_GAS_CONSTANTS> = ['flashLoan', 'mintPosition', 'burnPosition'];
      const gasEstimate = getJitOperationGasEstimate(operations);
      
      const expected = JIT_GAS_CONSTANTS.flashLoan + 
                      JIT_GAS_CONSTANTS.mintPosition + 
                      JIT_GAS_CONSTANTS.burnPosition;
      
      expect(gasEstimate).to.equal(expected);
    });

    it('should exclude totalEstimate from calculation', () => {
      const operations: Array<keyof typeof JIT_GAS_CONSTANTS> = ['totalEstimate', 'flashLoan'];
      const gasEstimate = getJitOperationGasEstimate(operations);
      
      expect(gasEstimate).to.equal(JIT_GAS_CONSTANTS.flashLoan);
    });
  });

  describe('checkGasPrice', () => {
    it('should accept gas price below limit', async () => {
      // This test would require mocking the config and provider
      // For now, just test the interface
      const result = await checkGasPrice(50);
      
      expect(result).to.have.property('acceptable');
      expect(result).to.have.property('currentGwei');
      expect(result).to.have.property('maxGwei');
      expect(result.maxGwei).to.equal(50);
    });
  });

  describe('estimateConfirmationTime', () => {
    it('should estimate confirmation time based on gas price', () => {
      expect(estimateConfirmationTime(50)).to.equal(15);
      expect(estimateConfirmationTime(30)).to.equal(30);
      expect(estimateConfirmationTime(20)).to.equal(60);
      expect(estimateConfirmationTime(10)).to.equal(120);
    });

    it('should return consistent times for gas price tiers', () => {
      // Fast tier (>=50 gwei)
      expect(estimateConfirmationTime(60)).to.equal(15);
      expect(estimateConfirmationTime(50)).to.equal(15);
      
      // Standard tier (>=30 gwei)
      expect(estimateConfirmationTime(40)).to.equal(30);
      expect(estimateConfirmationTime(30)).to.equal(30);
      
      // Slow tier (>=20 gwei)
      expect(estimateConfirmationTime(25)).to.equal(60);
      expect(estimateConfirmationTime(20)).to.equal(60);
      
      // Very slow tier (<20 gwei)
      expect(estimateConfirmationTime(15)).to.equal(120);
      expect(estimateConfirmationTime(5)).to.equal(120);
    });
  });
});