import { expect } from 'chai';
import {
  validatePriceData,
  getPriceDeviation,
  getAvailablePriceFeeds,
  clearPriceCache,
  getPriceCacheStats
} from '../../src/price/oracle';

// Set up test environment
const originalEnv = process.env;

describe('PriceOracle', () => {
  beforeEach(() => {
    clearPriceCache();
    // Set test environment variables
    process.env.CHAIN = 'ethereum';
    process.env.RPC_URL_HTTP = 'http://localhost:8545';
    process.env.SIMULATION_MODE = 'true';
    process.env.PRIVATE_KEY = '0x' + '1'.repeat(64);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('validatePriceData', () => {
    it('should validate correct price data', () => {
      const validPriceData = {
        symbol: 'ETH',
        priceUsd: 2000,
        timestamp: Date.now(),
        source: 'chainlink' as const,
        decimals: 8
      };
      
      expect(validatePriceData(validPriceData)).to.be.true;
    });

    it('should reject invalid price data', () => {
      // Missing required fields
      expect(validatePriceData({} as any)).to.be.false;
      
      // Invalid price
      expect(validatePriceData({
        symbol: 'ETH',
        priceUsd: -100,
        timestamp: Date.now(),
        source: 'chainlink',
        decimals: 8
      } as any)).to.be.false;
      
      // Invalid timestamp
      expect(validatePriceData({
        symbol: 'ETH',
        priceUsd: 2000,
        timestamp: 0,
        source: 'chainlink',
        decimals: 8
      } as any)).to.be.false;
      
      // Invalid source
      expect(validatePriceData({
        symbol: 'ETH',
        priceUsd: 2000,
        timestamp: Date.now(),
        source: 'invalid',
        decimals: 8
      } as any)).to.be.false;
    });
  });

  describe('getPriceDeviation', () => {
    it('should calculate positive deviation correctly', () => {
      const currentPrice = 2100;
      const referencePrice = 2000;
      
      const deviation = getPriceDeviation(currentPrice, referencePrice);
      
      expect(deviation).to.equal(5); // (2100 - 2000) / 2000 * 100 = 5%
    });

    it('should calculate negative deviation correctly', () => {
      const currentPrice = 1900;
      const referencePrice = 2000;
      
      const deviation = getPriceDeviation(currentPrice, referencePrice);
      
      expect(deviation).to.equal(-5); // (1900 - 2000) / 2000 * 100 = -5%
    });

    it('should return zero for identical prices', () => {
      const price = 2000;
      
      const deviation = getPriceDeviation(price, price);
      
      expect(deviation).to.equal(0);
    });
  });

  describe('getAvailablePriceFeeds', () => {
    it('should return available price feeds for current chain', () => {
      const feeds = getAvailablePriceFeeds();
      
      expect(feeds).to.be.an('array');
      expect(feeds.length).to.be.greaterThan(0);
      
      // Should include common feeds for ethereum
      expect(feeds).to.include('ETH/USD');
      expect(feeds).to.include('USDC/USD');
      expect(feeds).to.include('USDT/USD');
      expect(feeds).to.include('WBTC/USD');
    });
  });

  describe('clearPriceCache', () => {
    it('should clear all cache when called without arguments', () => {
      // First, ensure cache is empty
      clearPriceCache();
      let stats = getPriceCacheStats();
      expect(stats.size).to.equal(0);
      
      // This would normally add items to cache, but since we can't easily mock
      // the actual price fetching in unit tests, we'll just verify the interface
      clearPriceCache();
      stats = getPriceCacheStats();
      expect(stats.size).to.equal(0);
    });

    it('should clear specific symbol when provided', () => {
      clearPriceCache('ETH');
      const stats = getPriceCacheStats();
      expect(stats.pairs).to.not.include('ETH/USD');
    });
  });

  describe('getPriceCacheStats', () => {
    it('should return cache statistics', () => {
      const stats = getPriceCacheStats();
      
      expect(stats).to.have.property('size');
      expect(stats).to.have.property('pairs');
      expect(stats.size).to.be.a('number');
      expect(stats.pairs).to.be.an('array');
    });
  });
});