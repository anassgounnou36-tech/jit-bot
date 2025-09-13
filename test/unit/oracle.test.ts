import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { priceOracle, PriceOracle, SupportedToken } from '../../src/price/oracle';

describe('PriceOracle', () => {
  let oracle: PriceOracle;

  before(() => {
    // Use the global oracle instance for testing
    oracle = priceOracle;
  });

  describe('Fallback Price Mechanism', () => {
    it('should provide fallback prices for all supported tokens', async () => {
      const tokens = Object.values(SupportedToken);
      
      for (const token of tokens) {
        const priceData = await oracle.getPrice(token);
        
        expect(priceData).to.exist;
        expect(priceData.price.gt(0)).to.be.true;
        expect(priceData.decimals).to.equal(8); // Chainlink standard
        expect(priceData.timestamp).to.be.a('number');
        expect(['chainlink', 'fallback']).to.include(priceData.source);
        expect(['high', 'medium', 'low']).to.include(priceData.confidence);
      }
    });

    it('should return reasonable fallback prices', async () => {
      // Clear cache to ensure we're testing fallback mechanism
      oracle.clearCache();
      
      const ethPrice = await oracle.getPrice(SupportedToken.ETH);
      const usdcPrice = await oracle.getPrice(SupportedToken.USDC);
      const wbtcPrice = await oracle.getPrice(SupportedToken.WBTC);
      
      // ETH should be worth more than $1000
      const ethUsd = parseFloat(ethPrice.price.toString()) / 100000000;
      expect(ethUsd).to.be.greaterThan(1000);
      
      // USDC should be close to $1
      const usdcUsd = parseFloat(usdcPrice.price.toString()) / 100000000;
      expect(usdcUsd).to.be.closeTo(1, 0.1);
      
      // WBTC should be worth more than ETH
      const wbtcUsd = parseFloat(wbtcPrice.price.toString()) / 100000000;
      expect(wbtcUsd).to.be.greaterThan(ethUsd);
    });
  });

  describe('Price Caching', () => {
    it('should cache prices and return cached values', async () => {
      oracle.clearCache();
      
      const firstCall = await oracle.getPrice(SupportedToken.ETH);
      const secondCall = await oracle.getPrice(SupportedToken.ETH);
      
      expect(firstCall.timestamp).to.equal(secondCall.timestamp);
      expect(firstCall.price.eq(secondCall.price)).to.be.true;
    });

    it('should provide cache statistics', async () => {
      oracle.clearCache();
      
      // Get initial stats
      let stats = oracle.getCacheStats();
      expect(stats.size).to.equal(0);
      expect(stats.tokens).to.be.empty;
      
      // Add some entries
      await oracle.getPrice(SupportedToken.ETH);
      await oracle.getPrice(SupportedToken.USDC);
      
      stats = oracle.getCacheStats();
      expect(stats.size).to.equal(2);
      expect(stats.tokens).to.include(SupportedToken.ETH);
      expect(stats.tokens).to.include(SupportedToken.USDC);
      expect(stats.oldestEntry).to.be.a('number');
    });

    it('should clear cache correctly', async () => {
      await oracle.getPrice(SupportedToken.ETH);
      await oracle.getPrice(SupportedToken.USDC);
      
      // Clear specific token
      oracle.clearCache(SupportedToken.ETH);
      let stats = oracle.getCacheStats();
      expect(stats.size).to.equal(1);
      expect(stats.tokens).to.not.include(SupportedToken.ETH);
      expect(stats.tokens).to.include(SupportedToken.USDC);
      
      // Clear all
      oracle.clearCache();
      stats = oracle.getCacheStats();
      expect(stats.size).to.equal(0);
    });
  });

  describe('Batch Price Fetching', () => {
    it('should fetch multiple prices concurrently', async () => {
      oracle.clearCache();
      
      const tokens = [SupportedToken.ETH, SupportedToken.USDC, SupportedToken.WBTC];
      const prices = await oracle.getMultiplePrices(tokens);
      
      expect(prices.size).to.equal(tokens.length);
      
      for (const token of tokens) {
        expect(prices.has(token)).to.be.true;
        const priceData = prices.get(token)!;
        expect(priceData.price.gt(0)).to.be.true;
      }
    });

    it('should handle empty token list', async () => {
      const prices = await oracle.getMultiplePrices([]);
      expect(prices.size).to.equal(0);
    });
  });

  describe('USD Value Calculations', () => {
    it('should calculate USD value correctly', async () => {
      const ethAmount = BigNumber.from('1000000000000000000'); // 1 ETH (18 decimals)
      const usdValue = await oracle.getUsdValue(SupportedToken.ETH, ethAmount, 18);
      
      // Should be approximately the ETH price in USD (with 8 decimal places)
      const ethPrice = await oracle.getPrice(SupportedToken.ETH);
      expect(usdValue.eq(ethPrice.price)).to.be.true;
    });

    it('should handle different token decimals', async () => {
      // USDC typically has 6 decimals
      const usdcAmount = BigNumber.from('1000000'); // 1 USDC (6 decimals)
      const usdValue = await oracle.getUsdValue(SupportedToken.USDC, usdcAmount, 6);
      
      // Should be close to $1 (100000000 in 8-decimal format)
      const expectedValue = BigNumber.from('100000000'); // $1.00 in 8 decimals
      const ratio = usdValue.mul(100).div(expectedValue).toNumber();
      expect(ratio).to.be.closeTo(100, 10); // Within 10% tolerance
    });

    it('should handle zero amounts', async () => {
      const usdValue = await oracle.getUsdValue(SupportedToken.ETH, BigNumber.from(0), 18);
      expect(usdValue.eq(0)).to.be.true;
    });
  });

  describe('Token Conversion', () => {
    it('should convert between tokens correctly', async () => {
      const ethAmount = BigNumber.from('1000000000000000000'); // 1 ETH
      
      // Convert 1 ETH to USDC equivalent
      const usdcAmount = await oracle.convertTokenValue(
        SupportedToken.ETH,
        SupportedToken.USDC,
        ethAmount,
        18, // ETH decimals
        6   // USDC decimals
      );
      
      expect(usdcAmount.gt(0)).to.be.true;
      
      // Should be reasonable amount (ETH is worth hundreds/thousands of USDC)
      const usdcValue = parseFloat(usdcAmount.toString()) / 1000000; // Convert to human readable
      expect(usdcValue).to.be.greaterThan(1000); // ETH should be worth more than 1000 USDC
    });

    it('should handle same token conversion', async () => {
      const amount = BigNumber.from('1000000000000000000');
      
      const convertedAmount = await oracle.convertTokenValue(
        SupportedToken.ETH,
        SupportedToken.ETH,
        amount,
        18,
        18
      );
      
      expect(convertedAmount.eq(amount)).to.be.true;
    });

    it('should handle zero conversion amounts', async () => {
      const convertedAmount = await oracle.convertTokenValue(
        SupportedToken.ETH,
        SupportedToken.USDC,
        BigNumber.from(0),
        18,
        6
      );
      
      expect(convertedAmount.eq(0)).to.be.true;
    });
  });

  describe('Feed Health Check', () => {
    it('should perform health check on all feeds', async () => {
      const healthResult = await oracle.checkFeedHealth();
      
      expect(healthResult).to.have.property('healthy');
      expect(healthResult).to.have.property('details');
      expect(healthResult.details).to.be.an('array');
      expect(healthResult.details.length).to.equal(Object.values(SupportedToken).length);
      
      // Each detail should have required fields
      healthResult.details.forEach((detail: any) => {
        expect(detail).to.have.property('token');
        expect(detail).to.have.property('healthy');
        expect(Object.values(SupportedToken)).to.include(detail.token);
        
        if (detail.healthy) {
          expect(detail).to.have.property('source');
          expect(detail).to.have.property('confidence');
          expect(detail).to.have.property('price');
        }
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid token gracefully', async () => {
      // This test would need to be adapted based on implementation
      // For now, we test that all enum values work
      const tokens = Object.values(SupportedToken);
      for (const token of tokens) {
        try {
          const price = await oracle.getPrice(token);
          expect(price).to.exist;
        } catch (error) {
          // Should not throw for valid tokens
          expect.fail(`Should not throw for valid token: ${token}`);
        }
      }
    });

    it('should handle network errors gracefully', async () => {
      // This is hard to test without mocking, but we can at least ensure
      // the fallback mechanism works
      oracle.clearCache();
      
      // Should still return fallback prices even if Chainlink fails
      const price = await oracle.getPrice(SupportedToken.ETH);
      expect(price).to.exist;
      expect(price.price.gt(0)).to.be.true;
    });
  });

  describe('Price Reasonableness', () => {
    it('should return reasonable price relationships', async () => {
      const [ethPrice, usdcPrice, wbtcPrice, usdtPrice] = await Promise.all([
        oracle.getPrice(SupportedToken.ETH),
        oracle.getPrice(SupportedToken.USDC),
        oracle.getPrice(SupportedToken.WBTC),
        oracle.getPrice(SupportedToken.USDT),
      ]);
      
      // Convert to numeric values for comparison
      const eth = parseFloat(ethPrice.price.toString()) / 100000000;
      const usdc = parseFloat(usdcPrice.price.toString()) / 100000000;
      const wbtc = parseFloat(wbtcPrice.price.toString()) / 100000000;
      const usdt = parseFloat(usdtPrice.price.toString()) / 100000000;
      
      // Basic sanity checks
      expect(eth).to.be.greaterThan(100);    // ETH > $100
      expect(wbtc).to.be.greaterThan(eth);   // BTC typically > ETH
      expect(usdc).to.be.closeTo(1, 0.2);   // USDC ~= $1
      expect(usdt).to.be.closeTo(1, 0.2);   // USDT ~= $1
      
      // Relative relationships
      expect(wbtc / eth).to.be.greaterThan(1); // BTC/ETH ratio > 1
      expect(Math.abs(usdc - usdt)).to.be.lessThan(0.1); // Stablecoins close to each other
    });
  });
});