import { ethers, BigNumber } from 'ethers';
import { config } from '../config';
import { createLogger } from '../logging/logger';

const logger = createLogger('Oracle');

/**
 * Price data structure
 */
export interface PriceData {
  price: BigNumber;
  decimals: number;
  timestamp: number;
  source: 'chainlink' | 'fallback';
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Supported tokens for price feeds
 */
export enum SupportedToken {
  ETH = 'ETH',
  USDC = 'USDC',
  USDT = 'USDT',
  WBTC = 'WBTC',
}

/**
 * Price oracle with Chainlink integration and fallbacks
 */
export class PriceOracle {
  private provider: ethers.providers.JsonRpcProvider;
  private priceCache: Map<string, PriceData> = new Map();
  private readonly cacheTtlMs = 60000; // 1 minute cache TTL

  // Chainlink Aggregator ABI (minimal interface)
  private readonly aggregatorAbi = [
    'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
    'function decimals() external view returns (uint8)',
    'function description() external view returns (string)',
  ];

  // Chainlink aggregator addresses for mainnet
  private readonly chainlinkFeeds = {
    mainnet: {
      [SupportedToken.ETH]: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419', // ETH/USD
      [SupportedToken.USDC]: '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6', // USDC/USD
      [SupportedToken.USDT]: '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D', // USDT/USD
      [SupportedToken.WBTC]: '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c', // BTC/USD
    },
    arbitrum: {
      [SupportedToken.ETH]: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612', // ETH/USD
      [SupportedToken.USDC]: '0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3', // USDC/USD
      [SupportedToken.USDT]: '0x3f3f5dF88dC9F13eac63DF89EC16ef6e7E25DdE7', // USDT/USD
      [SupportedToken.WBTC]: '0x6ce185860a4963106506C203335A2910413708e9', // BTC/USD
    },
  };

  // Fallback prices for development/testing (in USD, 8 decimals like Chainlink)
  private readonly fallbackPrices = {
    [SupportedToken.ETH]: BigNumber.from(200000000000), // $2000.00
    [SupportedToken.USDC]: BigNumber.from(100000000), // $1.00
    [SupportedToken.USDT]: BigNumber.from(100000000), // $1.00
    [SupportedToken.WBTC]: BigNumber.from(4500000000000), // $45000.00
  };

  constructor(httpRpcUrl: string) {
    this.provider = new ethers.providers.JsonRpcProvider(httpRpcUrl);
    logger.info('PriceOracle initialized', { 
      chain: config.chain,
      supportedTokens: Object.values(SupportedToken),
    });
  }

  /**
   * Get price for a supported token
   */
  async getPrice(token: SupportedToken): Promise<PriceData> {
    // Check cache first
    const cached = this.priceCache.get(token);
    if (cached && (Date.now() - cached.timestamp) < this.cacheTtlMs) {
      logger.debug('Price retrieved from cache', { token, price: cached.price.toString() });
      return cached;
    }

    try {
      // Try Chainlink first
      const chainlinkPrice = await this.fetchChainlinkPrice(token);
      if (chainlinkPrice) {
        this.priceCache.set(token, chainlinkPrice);
        return chainlinkPrice;
      }
    } catch (error: any) {
      logger.warn('Chainlink price fetch failed, using fallback', {
        token,
        error: error.message,
      });
    }

    // Use fallback price
    const fallbackPrice = this.getFallbackPrice(token);
    this.priceCache.set(token, fallbackPrice);
    return fallbackPrice;
  }

  /**
   * Fetch price from Chainlink aggregator
   */
  private async fetchChainlinkPrice(token: SupportedToken): Promise<PriceData | null> {
    const chainFeeds = this.chainlinkFeeds[config.chain as keyof typeof this.chainlinkFeeds];
    if (!chainFeeds) {
      throw new Error(`No Chainlink feeds configured for chain: ${config.chain}`);
    }

    const feedAddress = chainFeeds[token];
    if (!feedAddress) {
      throw new Error(`No Chainlink feed for token: ${token} on chain: ${config.chain}`);
    }

    try {
      const aggregator = new ethers.Contract(feedAddress, this.aggregatorAbi, this.provider);
      
      const [latestRoundData, decimals] = await Promise.all([
        aggregator.latestRoundData(),
        aggregator.decimals(),
      ]);

      const { answer, updatedAt } = latestRoundData;

      // Validate freshness (should be updated within last hour for reliable feeds)
      const maxAge = 3600; // 1 hour
      const age = Math.floor(Date.now() / 1000) - updatedAt.toNumber();
      
      if (age > maxAge) {
        logger.warn('Chainlink price is stale', {
          token,
          feedAddress,
          ageSeconds: age,
          maxAgeSeconds: maxAge,
        });
        return null;
      }

      // Validate price is positive
      if (answer.lte(0)) {
        logger.warn('Invalid Chainlink price (non-positive)', {
          token,
          feedAddress,
          price: answer.toString(),
        });
        return null;
      }

      const priceData: PriceData = {
        price: answer,
        decimals,
        timestamp: Date.now(),
        source: 'chainlink',
        confidence: 'high',
      };

      logger.debug('Chainlink price fetched', {
        token,
        price: ethers.utils.formatUnits(answer, decimals),
        decimals,
        ageSeconds: age,
      });

      return priceData;

    } catch (error: any) {
      logger.error('Error fetching Chainlink price', {
        token,
        feedAddress,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Get fallback price for a token
   */
  private getFallbackPrice(token: SupportedToken): PriceData {
    const price = this.fallbackPrices[token];
    if (!price) {
      throw new Error(`No fallback price available for token: ${token}`);
    }

    const priceData: PriceData = {
      price,
      decimals: 8, // Chainlink standard
      timestamp: Date.now(),
      source: 'fallback',
      confidence: 'low',
    };

    logger.info('Using fallback price', {
      token,
      price: ethers.utils.formatUnits(price, 8),
    });

    return priceData;
  }

  /**
   * Get prices for multiple tokens
   */
  async getMultiplePrices(tokens: SupportedToken[]): Promise<Map<SupportedToken, PriceData>> {
    const results = new Map<SupportedToken, PriceData>();
    
    // Fetch all prices concurrently
    const promises = tokens.map(async (token) => {
      try {
        const price = await this.getPrice(token);
        return { token, price };
      } catch (error: any) {
        logger.error('Failed to fetch price in batch', {
          token,
          error: error.message,
        });
        return null;
      }
    });

    const outcomes = await Promise.all(promises);
    
    // Collect successful results
    outcomes.forEach((outcome) => {
      if (outcome) {
        results.set(outcome.token, outcome.price);
      }
    });

    logger.debug('Batch price fetch completed', {
      requested: tokens.length,
      successful: results.size,
      failed: tokens.length - results.size,
    });

    return results;
  }

  /**
   * Get USD value for a token amount
   */
  async getUsdValue(token: SupportedToken, amount: BigNumber, tokenDecimals: number): Promise<BigNumber> {
    const priceData = await this.getPrice(token);
    
    // Convert amount to USD: (amount * price) / (10^tokenDecimals)
    // Price has 8 decimals, so result will have 8 decimals
    const usdValue = amount.mul(priceData.price).div(BigNumber.from(10).pow(tokenDecimals));
    
    logger.debug('USD value calculated', {
      token,
      amount: ethers.utils.formatUnits(amount, tokenDecimals),
      price: ethers.utils.formatUnits(priceData.price, priceData.decimals),
      usdValue: ethers.utils.formatUnits(usdValue, priceData.decimals),
    });

    return usdValue;
  }

  /**
   * Convert between two tokens using their USD prices
   */
  async convertTokenValue(
    fromToken: SupportedToken,
    toToken: SupportedToken,
    amount: BigNumber,
    fromDecimals: number,
    toDecimals: number
  ): Promise<BigNumber> {
    const [fromPrice, toPrice] = await Promise.all([
      this.getPrice(fromToken),
      this.getPrice(toToken),
    ]);

    // Calculate conversion: (amount * fromPrice / toPrice) adjusted for decimals
    const converted = amount
      .mul(fromPrice.price)
      .div(toPrice.price)
      .mul(BigNumber.from(10).pow(toDecimals))
      .div(BigNumber.from(10).pow(fromDecimals));

    logger.debug('Token conversion calculated', {
      fromToken,
      toToken,
      amount: ethers.utils.formatUnits(amount, fromDecimals),
      converted: ethers.utils.formatUnits(converted, toDecimals),
      fromPrice: ethers.utils.formatUnits(fromPrice.price, fromPrice.decimals),
      toPrice: ethers.utils.formatUnits(toPrice.price, toPrice.decimals),
    });

    return converted;
  }

  /**
   * Check if all price feeds are healthy
   */
  async checkFeedHealth(): Promise<{ healthy: boolean; details: any[] }> {
    const allTokens = Object.values(SupportedToken);
    const details: any[] = [];
    let healthy = true;

    for (const token of allTokens) {
      try {
        const priceData = await this.getPrice(token);
        const isHealthy = priceData.source === 'chainlink' && priceData.confidence === 'high';
        
        if (!isHealthy) {
          healthy = false;
        }

        details.push({
          token,
          healthy: isHealthy,
          source: priceData.source,
          confidence: priceData.confidence,
          price: ethers.utils.formatUnits(priceData.price, priceData.decimals),
        });

      } catch (error: any) {
        healthy = false;
        details.push({
          token,
          healthy: false,
          error: error.message,
        });
      }
    }

    logger.info('Price feed health check completed', {
      healthy,
      healthyFeeds: details.filter(d => d.healthy).length,
      totalFeeds: details.length,
    });

    return { healthy, details };
  }

  /**
   * Clear price cache
   */
  clearCache(token?: SupportedToken): void {
    if (token) {
      this.priceCache.delete(token);
      logger.debug('Price cache cleared for token', { token });
    } else {
      this.priceCache.clear();
      logger.debug('All price cache cleared');
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; tokens: string[]; oldestEntry: number | null } {
    const entries = Array.from(this.priceCache.entries());
    
    if (entries.length === 0) {
      return { size: 0, tokens: [], oldestEntry: null };
    }

    const timestamps = entries.map(([, data]) => data.timestamp);
    
    return {
      size: entries.length,
      tokens: entries.map(([token]) => token),
      oldestEntry: Math.min(...timestamps),
    };
  }
}

// Export singleton instance
export const priceOracle = new PriceOracle(config.rpcUrlHttp);