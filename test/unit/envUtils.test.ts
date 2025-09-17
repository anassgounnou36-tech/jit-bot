import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import { ethers } from 'ethers';

describe('Environment Utilities', () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    
    // Clear test environment variables
    delete process.env.TEST_ADDRESS;
    delete process.env.TEST_ETH_AMOUNT;
    delete process.env.TEST_NUMBER;
    delete process.env.ETHEREUM_RPC_URL;
    delete process.env.RPC_URL_HTTP;
    delete process.env.PROFIT_RECIPIENT;
    delete process.env.POSITION_MANAGER;
  });

  afterEach(() => {
    // Restore original environment
    Object.keys(process.env).forEach(key => {
      if (key.startsWith('TEST_')) {
        delete process.env[key];
      }
    });
    Object.assign(process.env, originalEnv);
  });

  describe('getAddressEnv', () => {
    const { getAddressEnv } = require('../../scripts/envUtils');

    it('should return valid address when set', () => {
      const validAddress = '0xC36442b4a4522E871399CD717aBDD847Ab11FE88';
      process.env.TEST_ADDRESS = validAddress;
      
      const result = getAddressEnv('TEST_ADDRESS');
      expect(result).to.equal(validAddress);
    });

    it('should use fallback when variable is not set', () => {
      const fallbackAddress = '0xA0b86a33E6417c1C8b8c6c58F86b0e8a7F5b7e8d';
      
      const result = getAddressEnv('TEST_ADDRESS', fallbackAddress);
      expect(result).to.equal(fallbackAddress);
    });

    it('should use fallback when variable is empty string', () => {
      process.env.TEST_ADDRESS = '';
      const fallbackAddress = '0xA0b86a33E6417c1C8b8c6c58F86b0e8a7F5b7e8d';
      
      const result = getAddressEnv('TEST_ADDRESS', fallbackAddress);
      expect(result).to.equal(fallbackAddress);
    });

    it('should use fallback when variable is whitespace only', () => {
      process.env.TEST_ADDRESS = '   ';
      const fallbackAddress = '0xA0b86a33E6417c1C8b8c6c58F86b0e8a7F5b7e8d';
      
      const result = getAddressEnv('TEST_ADDRESS', fallbackAddress);
      expect(result).to.equal(fallbackAddress);
    });

    it('should throw error for invalid address', () => {
      process.env.TEST_ADDRESS = 'invalid-address';
      
      expect(() => getAddressEnv('TEST_ADDRESS')).to.throw(
        'Environment variable TEST_ADDRESS contains invalid address'
      );
    });

    it('should throw error when required but not set', () => {
      expect(() => getAddressEnv('TEST_ADDRESS')).to.throw(
        'Environment variable TEST_ADDRESS is required but not set or empty'
      );
    });

    it('should trim whitespace from valid address', () => {
      const validAddress = '0xC36442b4a4522E871399CD717aBDD847Ab11FE88';
      process.env.TEST_ADDRESS = `  ${validAddress}  `;
      
      const result = getAddressEnv('TEST_ADDRESS');
      expect(result).to.equal(validAddress);
    });
  });

  describe('getEthAmountEnv', () => {
    const { getEthAmountEnv } = require('../../scripts/envUtils');

    it('should parse valid ETH amount', () => {
      process.env.TEST_ETH_AMOUNT = '1.5';
      
      const result = getEthAmountEnv('TEST_ETH_AMOUNT');
      expect(result.toString()).to.equal(ethers.utils.parseEther('1.5').toString());
    });

    it('should use fallback when not set', () => {
      const result = getEthAmountEnv('TEST_ETH_AMOUNT', '2.0');
      expect(result.toString()).to.equal(ethers.utils.parseEther('2.0').toString());
    });

    it('should throw error for invalid ETH amount', () => {
      process.env.TEST_ETH_AMOUNT = 'not-a-number';
      
      expect(() => getEthAmountEnv('TEST_ETH_AMOUNT')).to.throw(
        'Environment variable TEST_ETH_AMOUNT contains invalid ETH amount'
      );
    });
  });

  describe('getNumberEnv', () => {
    const { getNumberEnv } = require('../../scripts/envUtils');

    it('should parse valid number', () => {
      process.env.TEST_NUMBER = '42.5';
      
      const result = getNumberEnv('TEST_NUMBER');
      expect(result).to.equal(42.5);
    });

    it('should use fallback when not set', () => {
      const result = getNumberEnv('TEST_NUMBER', 100);
      expect(result).to.equal(100);
    });

    it('should throw error for invalid number', () => {
      process.env.TEST_NUMBER = 'not-a-number';
      
      expect(() => getNumberEnv('TEST_NUMBER')).to.throw(
        'Environment variable TEST_NUMBER contains invalid number'
      );
    });
  });

  describe('normalizeRpcUrl', () => {
    const { normalizeRpcUrl } = require('../../scripts/envUtils');

    it('should prefer ETHEREUM_RPC_URL over RPC_URL_HTTP', () => {
      process.env.ETHEREUM_RPC_URL = 'https://ethereum-primary.com';
      process.env.RPC_URL_HTTP = 'https://ethereum-fallback.com';
      
      const result = normalizeRpcUrl();
      expect(result).to.equal('https://ethereum-primary.com');
    });

    it('should fallback to RPC_URL_HTTP when ETHEREUM_RPC_URL not set', () => {
      process.env.RPC_URL_HTTP = 'https://ethereum-fallback.com';
      
      const result = normalizeRpcUrl();
      expect(result).to.equal('https://ethereum-fallback.com');
    });

    it('should return empty string when neither is set', () => {
      const result = normalizeRpcUrl();
      expect(result).to.equal('');
    });

    it('should fallback when ETHEREUM_RPC_URL is empty string', () => {
      process.env.ETHEREUM_RPC_URL = '';
      process.env.RPC_URL_HTTP = 'https://ethereum-fallback.com';
      
      const result = normalizeRpcUrl();
      expect(result).to.equal('https://ethereum-fallback.com');
    });
  });

  describe('mask', () => {
    const { mask } = require('../../scripts/envUtils');

    it('should mask short strings completely', () => {
      const result = mask('short');
      expect(result).to.equal('***masked***');
    });

    it('should show first 6 and last 4 characters for long strings', () => {
      const longString = '0x1234567890abcdef1234567890abcdef12345678';
      const result = mask(longString);
      expect(result).to.equal('0x1234...5678');
    });

    it('should handle empty or undefined values', () => {
      expect(mask('')).to.equal('***masked***');
      expect(mask(undefined as any)).to.equal('***masked***');
    });
  });

  describe('validateDeploymentEnv', () => {
    const { validateDeploymentEnv } = require('../../scripts/envUtils');

    beforeEach(() => {
      // Set up minimal valid environment
      process.env.PRIVATE_KEY = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    });

    it('should pass validation with valid environment for fork network', () => {
      expect(() => validateDeploymentEnv('fork')).to.not.throw();
    });

    it('should require RPC URL for mainnet', () => {
      expect(() => validateDeploymentEnv('mainnet')).to.throw(
        'ETHEREUM_RPC_URL (or RPC_URL_HTTP) is required for mainnet deployment'
      );
    });

    it('should pass validation with RPC_URL_HTTP fallback', () => {
      process.env.RPC_URL_HTTP = 'https://rpc.ankr.com/eth';
      
      expect(() => validateDeploymentEnv('mainnet')).to.not.throw();
    });

    it('should throw error for invalid private key format', () => {
      process.env.PRIVATE_KEY = 'invalid-key';
      
      expect(() => validateDeploymentEnv('mainnet')).to.throw(
        'PRIVATE_KEY must be a valid 32-byte hex string starting with 0x'
      );
    });

    it('should throw error for missing private key', () => {
      delete process.env.PRIVATE_KEY;
      
      expect(() => validateDeploymentEnv('mainnet')).to.throw();
    });
  });

  describe('Integration - Real deployment scenario edge cases', () => {
    const { getAddressEnv } = require('../../scripts/envUtils');

    it('should handle the original issue: empty string PROFIT_RECIPIENT', () => {
      // This was the root cause of the original ethers.js invalid address error
      process.env.PROFIT_RECIPIENT = '';
      const deployerAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
      
      // Should use fallback instead of empty string
      const result = getAddressEnv('PROFIT_RECIPIENT', deployerAddress);
      expect(result).to.equal(deployerAddress);
    });

    it('should handle the original issue: empty string POSITION_MANAGER', () => {
      // This was another root cause of the original ethers.js invalid address error
      process.env.POSITION_MANAGER = '';
      const defaultManager = '0xC36442b4a4522E871399CD717aBDD847Ab11FE88';
      
      // Should use fallback instead of empty string
      const result = getAddressEnv('POSITION_MANAGER', defaultManager);
      expect(result).to.equal(defaultManager);
    });

    it('should handle whitespace-only environment variables', () => {
      process.env.PROFIT_RECIPIENT = '   \t\n   ';
      const deployerAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
      
      // Should use fallback for whitespace-only values
      const result = getAddressEnv('PROFIT_RECIPIENT', deployerAddress);
      expect(result).to.equal(deployerAddress);
    });
  });
});