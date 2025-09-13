import { expect } from 'chai';
import {
  TOKEN_ADDRESSES,
  INCORRECT_ADDRESSES,
  normalizeTokenAddress,
  validateUsdcAddress
} from '../../src/util/constants';

describe('Constants', () => {
  describe('TOKEN_ADDRESSES', () => {
    it('should have correct USDC address constant equal to canonical mainnet address', () => {
      const expectedUsdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      expect(TOKEN_ADDRESSES.ETHEREUM.USDC).to.equal(expectedUsdcAddress);
    });

    it('should have checksummed addresses', () => {
      // All addresses should be properly checksummed
      expect(TOKEN_ADDRESSES.ETHEREUM.USDC).to.equal('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
      expect(TOKEN_ADDRESSES.ETHEREUM.WETH).to.equal('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
      expect(TOKEN_ADDRESSES.ETHEREUM.WBTC).to.equal('0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599');
    });
  });

  describe('normalizeTokenAddress', () => {
    it('should auto-correct incorrect USDC address', () => {
      const incorrectAddress = INCORRECT_ADDRESSES.USDC_INCORRECT;
      const expectedCorrectAddress = TOKEN_ADDRESSES.ETHEREUM.USDC;
      
      const normalized = normalizeTokenAddress(incorrectAddress, 'USDC');
      expect(normalized).to.equal(expectedCorrectAddress);
    });

    it('should return checksummed address for valid addresses', () => {
      const validAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'; // lowercase
      const expectedChecksummed = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      
      const normalized = normalizeTokenAddress(validAddress, 'USDC');
      expect(normalized).to.equal(expectedChecksummed);
    });

    it('should not modify correct addresses', () => {
      const correctAddress = TOKEN_ADDRESSES.ETHEREUM.USDC;
      const normalized = normalizeTokenAddress(correctAddress, 'USDC');
      expect(normalized).to.equal(correctAddress);
    });
  });

  describe('validateUsdcAddress', () => {
    it('should warn in simulation mode for incorrect address', () => {
      const incorrectAddress = INCORRECT_ADDRESSES.USDC_INCORRECT;
      
      // Should not throw in simulation mode
      expect(() => validateUsdcAddress(incorrectAddress, true)).to.not.throw();
    });

    it('should throw in live mode for incorrect address', () => {
      const incorrectAddress = INCORRECT_ADDRESSES.USDC_INCORRECT;
      
      expect(() => validateUsdcAddress(incorrectAddress, false))
        .to.throw('Incorrect USDC address detected')
        .and.to.throw('Cannot proceed in live mode');
    });

    it('should pass validation for correct address', () => {
      const correctAddress = TOKEN_ADDRESSES.ETHEREUM.USDC;
      
      expect(() => validateUsdcAddress(correctAddress, false)).to.not.throw();
      expect(() => validateUsdcAddress(correctAddress, true)).to.not.throw();
    });
  });
});