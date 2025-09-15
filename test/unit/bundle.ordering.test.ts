import { expect } from 'chai';
import { validateBundleOrdering, FlashbotsBundle } from '../../src/bundler/bundleBuilder';
import { getFlashbotsManager } from '../../src/exec/flashbots';
import { ethers } from 'ethers';

/**
 * Comprehensive tests to verify bundle validation requirements:
 * 
 * 1. Enhanced bundles (with victimTransaction) must have exactly 2 JIT transactions
 * 2. Standard bundles (no victimTransaction) must allow >= 1 transaction  
 * 3. Single transaction bundles should work correctly in real usage scenarios
 */
describe('Bundle Validation Requirements Verification', () => {
  
  describe('validateBundleOrdering - Core Requirements', () => {
    
    it('REQUIREMENT: Standard bundles MUST allow single transactions', () => {
      // This is the key requirement from the problem statement
      const singleTxBundle: FlashbotsBundle = {
        transactions: ['0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef012'],
        targetBlockNumber: 12345
      };

      const result = validateBundleOrdering(singleTxBundle);
      
      // CRITICAL: This must pass for single transaction bundles
      expect(result.valid).to.be.true;
      expect(result.issues).to.be.empty;
    });

    it('REQUIREMENT: Enhanced bundles MUST require exactly 2 JIT transactions', () => {
      // Enhanced bundles should be strict about transaction count
      const enhancedBundleWith1Tx: FlashbotsBundle = {
        transactions: ['0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef012'],
        targetBlockNumber: 12345,
        victimTransaction: {
          rawTx: '0xdeadbeef1234567890123456789012345678901234567890123456789012345',
          hash: '0x1234567890123456789012345678901234567890123456789012345678901234',
          insertAfterIndex: 0
        }
      };

      const result = validateBundleOrdering(enhancedBundleWith1Tx);
      
      // CRITICAL: Enhanced bundles with 1 JIT transaction must fail
      expect(result.valid).to.be.false;
      expect(result.issues).to.include('Enhanced bundle requires exactly 2 JIT transactions (mint + burn/collect)');
    });

    it('REQUIREMENT: Enhanced bundles with 2 JIT transactions should pass', () => {
      const enhancedBundleWith2Txs: FlashbotsBundle = {
        transactions: [
          '0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef012',
          '0x789abcdef0123456789abcdef0123456789abcdef0123456789abcdef012345678'
        ],
        targetBlockNumber: 12345,
        victimTransaction: {
          rawTx: '0xdeadbeef1234567890123456789012345678901234567890123456789012345',
          hash: '0x1234567890123456789012345678901234567890123456789012345678901234',
          insertAfterIndex: 0
        }
      };

      const result = validateBundleOrdering(enhancedBundleWith2Txs);
      
      // CRITICAL: Properly configured enhanced bundles must pass
      expect(result.valid).to.be.true;
      expect(result.issues).to.be.empty;
    });
  });

  describe('Real-world Usage Scenarios', () => {
    
    it('FlashbotsManager createBundle should work with single transaction', async () => {
      // This mirrors the actual test in flashbots.test.ts
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
      
      // Verify the bundle was created successfully
      expect(bundle.transactions).to.have.length(1);
      expect(bundle.targetBlockNumber).to.equal(targetBlock);
      
      // Verify the bundle passes validation
      const validation = validateBundleOrdering(bundle);
      expect(validation.valid).to.be.true;
      expect(validation.issues).to.be.empty;
    });
  });

  describe('Edge Cases and Error Handling', () => {
    
    it('should reject empty bundles', () => {
      const emptyBundle: FlashbotsBundle = {
        transactions: [],
        targetBlockNumber: 12345
      };

      const result = validateBundleOrdering(emptyBundle);
      
      expect(result.valid).to.be.false;
      expect(result.issues).to.include('Bundle must contain at least 1 transaction');
    });

    it('should handle multiple transactions in standard bundles', () => {
      const multiTxBundle: FlashbotsBundle = {
        transactions: [
          '0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef012',
          '0x789abcdef0123456789abcdef0123456789abcdef0123456789abcdef012345678',
          '0xdeadbeef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
        ],
        targetBlockNumber: 12345
      };

      const result = validateBundleOrdering(multiTxBundle);
      
      // Standard bundles should allow any number >= 1
      expect(result.valid).to.be.true;
      expect(result.issues).to.be.empty;
    });

    it('should reject enhanced bundles with 3+ JIT transactions', () => {
      const enhancedBundleWith3Txs: FlashbotsBundle = {
        transactions: [
          '0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef012',
          '0x789abcdef0123456789abcdef0123456789abcdef0123456789abcdef012345678',
          '0xdeadbeef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
        ],
        targetBlockNumber: 12345,
        victimTransaction: {
          rawTx: '0xdeadbeef1234567890123456789012345678901234567890123456789012345',
          hash: '0x1234567890123456789012345678901234567890123456789012345678901234',
          insertAfterIndex: 0
        }
      };

      const result = validateBundleOrdering(enhancedBundleWith3Txs);
      
      expect(result.valid).to.be.false;
      expect(result.issues).to.include('Enhanced bundle requires exactly 2 JIT transactions (mint + burn/collect)');
    });
  });

  describe('Backward Compatibility', () => {
    
    it('should support both rawTx and rawTxHex fields', () => {
      const bundleWithRawTxHex: FlashbotsBundle = {
        transactions: [
          '0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef012',
          '0x789abcdef0123456789abcdef0123456789abcdef0123456789abcdef012345678'
        ],
        targetBlockNumber: 12345,
        victimTransaction: {
          rawTxHex: '0xdeadbeef1234567890123456789012345678901234567890123456789012345', // Legacy field
          hash: '0x1234567890123456789012345678901234567890123456789012345678901234',
          insertAfterIndex: 0
        }
      };

      const result = validateBundleOrdering(bundleWithRawTxHex);
      
      expect(result.valid).to.be.true;
      expect(result.issues).to.be.empty;
    });

    it('should support both blockNumber and targetBlockNumber fields', () => {
      const bundleWithBlockNumber: FlashbotsBundle = {
        transactions: ['0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef012'],
        blockNumber: 12345 // Using legacy field
      };

      const result = validateBundleOrdering(bundleWithBlockNumber);
      
      expect(result.valid).to.be.true;
      expect(result.issues).to.be.empty;
    });
  });
});