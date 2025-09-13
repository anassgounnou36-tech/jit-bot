import { ethers } from 'ethers';
import { getConfig, getHttpProvider } from '../config';

export interface PriceData {
  symbol: string;
  priceUsd: number;
  timestamp: number;
  source: 'chainlink' | 'fallback';
  decimals: number;
}

export interface PriceFeed {
  address: string;
  decimals: number;
  description: string;
}

// Chainlink price feed addresses for mainnet
const CHAINLINK_FEEDS: Record<string, Record<string, PriceFeed>> = {
  ethereum: {
    'ETH/USD': {
      address: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
      decimals: 8,
      description: 'ETH / USD'
    },
    'USDC/USD': {
      address: '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6',
      decimals: 8,
      description: 'USDC / USD'
    },
    'USDT/USD': {
      address: '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D',
      decimals: 8,
      description: 'USDT / USD'
    },
    'WBTC/USD': {
      address: '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c',
      decimals: 8,
      description: 'WBTC / USD'
    }
  },
  arbitrum: {
    'ETH/USD': {
      address: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
      decimals: 8,
      description: 'ETH / USD'
    },
    'USDC/USD': {
      address: '0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3',
      decimals: 8,
      description: 'USDC / USD'
    }
  }
};

// Chainlink aggregator ABI
const CHAINLINK_AGGREGATOR_ABI = [
  'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() external view returns (uint8)',
  'function description() external view returns (string)'
];

// Price cache with TTL
const PRICE_CACHE_TTL_MS = 30000; // 30 seconds
const priceCache = new Map<string, PriceData>();

// Fallback prices for development/testing
const FALLBACK_PRICES: Record<string, number> = {
  'ETH/USD': 2000,
  'USDC/USD': 1,
  'USDT/USD': 1,
  'WBTC/USD': 40000
};

/**
 * Get price for a token pair from Chainlink oracle
 * @param symbol Token symbol (e.g., 'ETH', 'USDC', 'WBTC')
 * @param quoteCurrency Quote currency (default: 'USD')
 * @returns Price data
 */
export async function getPrice(symbol: string, quoteCurrency: string = 'USD'): Promise<PriceData> {
  const pairKey = `${symbol}/${quoteCurrency}`;
  
  // Check cache first
  const cached = priceCache.get(pairKey);
  if (cached && (Date.now() - cached.timestamp) < PRICE_CACHE_TTL_MS) {
    return cached;
  }
  
  // Config is used in getChainlinkPrice function
  
  try {
    // Try to get price from Chainlink first
    const chainlinkPrice = await getChainlinkPrice(pairKey);
    
    // Cache the result
    priceCache.set(pairKey, chainlinkPrice);
    
    return chainlinkPrice;
    
  } catch (chainlinkError) {
    console.warn(`Chainlink oracle failed for ${pairKey}, using fallback:`, chainlinkError);
    
    // Use fallback price
    const fallbackPrice = FALLBACK_PRICES[pairKey];
    if (!fallbackPrice) {
      throw new Error(`No price available for ${pairKey}`);
    }
    
    const priceData: PriceData = {
      symbol,
      priceUsd: fallbackPrice,
      timestamp: Date.now(),
      source: 'fallback',
      decimals: 8
    };
    
    // Cache fallback for shorter period
    const shortCache = { ...priceData, timestamp: Date.now() - (PRICE_CACHE_TTL_MS * 0.5) };
    priceCache.set(pairKey, shortCache);
    
    return priceData;
  }
}

/**
 * Get price from Chainlink oracle
 * @param pairKey Price pair key (e.g., 'ETH/USD')
 * @returns Price data from Chainlink
 */
async function getChainlinkPrice(pairKey: string): Promise<PriceData> {
  const config = getConfig();
  const feeds = CHAINLINK_FEEDS[config.chain];
  
  if (!feeds || !feeds[pairKey]) {
    throw new Error(`Chainlink feed not available for ${pairKey} on ${config.chain}`);
  }
  
  const feed = feeds[pairKey];
  const provider = getHttpProvider(config);
  const aggregator = new ethers.Contract(feed.address, CHAINLINK_AGGREGATOR_ABI, provider);
  
  try {
    const [roundData, decimals] = await Promise.all([
      aggregator.latestRoundData(),
      aggregator.decimals()
    ]);
    
    const price = parseFloat(ethers.utils.formatUnits(roundData.answer, decimals));
    const timestamp = roundData.updatedAt.toNumber() * 1000; // Convert to milliseconds
    
    // Check if price is stale (older than 1 hour)
    const maxAge = 60 * 60 * 1000; // 1 hour
    if (Date.now() - timestamp > maxAge) {
      throw new Error(`Chainlink price for ${pairKey} is stale (${new Date(timestamp).toISOString()})`);
    }
    
    const symbol = pairKey.split('/')[0];
    
    return {
      symbol,
      priceUsd: price,
      timestamp,
      source: 'chainlink',
      decimals
    };
    
  } catch (error: any) {
    throw new Error(`Chainlink oracle error for ${pairKey}: ${error.message}`);
  }
}

/**
 * Get multiple prices in parallel
 * @param symbols Array of token symbols
 * @param quoteCurrency Quote currency (default: 'USD')
 * @returns Map of symbol to price data
 */
export async function getMultiplePrices(
  symbols: string[],
  quoteCurrency: string = 'USD'
): Promise<Map<string, PriceData>> {
  const results = new Map<string, PriceData>();
  
  const promises = symbols.map(async (symbol) => {
    try {
      const price = await getPrice(symbol, quoteCurrency);
      results.set(symbol, price);
    } catch (error: any) {
      console.warn(`Failed to get price for ${symbol}:`, error.message);
    }
  });
  
  await Promise.allSettled(promises);
  return results;
}

/**
 * Calculate USD value of token amount
 * @param tokenSymbol Token symbol
 * @param amount Token amount as BigNumber
 * @param decimals Token decimals
 * @returns USD value
 */
export async function calculateUsdValue(
  tokenSymbol: string,
  amount: ethers.BigNumber,
  decimals: number = 18
): Promise<number> {
  const priceData = await getPrice(tokenSymbol);
  const tokenAmount = parseFloat(ethers.utils.formatUnits(amount, decimals));
  return tokenAmount * priceData.priceUsd;
}

/**
 * Get ETH price (commonly used)
 * @returns ETH price in USD
 */
export async function getEthPrice(): Promise<number> {
  const priceData = await getPrice('ETH');
  return priceData.priceUsd;
}

/**
 * Convert ETH amount to USD
 * @param ethAmount ETH amount as BigNumber
 * @returns USD value
 */
export async function ethToUsd(ethAmount: ethers.BigNumber): Promise<number> {
  const ethPrice = await getEthPrice();
  const ethFloat = parseFloat(ethers.utils.formatEther(ethAmount));
  return ethFloat * ethPrice;
}

/**
 * Convert USD amount to ETH
 * @param usdAmount USD amount
 * @returns ETH amount as BigNumber
 */
export async function usdToEth(usdAmount: number): Promise<ethers.BigNumber> {
  const ethPrice = await getEthPrice();
  const ethAmount = usdAmount / ethPrice;
  return ethers.utils.parseEther(ethAmount.toString());
}

/**
 * Calculate token pair price ratio
 * @param token0Symbol First token symbol
 * @param token1Symbol Second token symbol
 * @returns Price ratio (token1/token0)
 */
export async function getTokenPairRatio(
  token0Symbol: string,
  token1Symbol: string
): Promise<number> {
  const [price0, price1] = await Promise.all([
    getPrice(token0Symbol),
    getPrice(token1Symbol)
  ]);
  
  return price1.priceUsd / price0.priceUsd;
}

/**
 * Check if price data is fresh enough
 * @param priceData Price data to check
 * @param maxAgeMs Maximum age in milliseconds
 * @returns True if fresh enough
 */
export function isPriceFresh(priceData: PriceData, maxAgeMs: number = PRICE_CACHE_TTL_MS): boolean {
  return (Date.now() - priceData.timestamp) < maxAgeMs;
}

/**
 * Get price deviation from a reference price
 * @param currentPrice Current price
 * @param referencePrice Reference price
 * @returns Deviation percentage (positive = current is higher)
 */
export function getPriceDeviation(currentPrice: number, referencePrice: number): number {
  return ((currentPrice - referencePrice) / referencePrice) * 100;
}

/**
 * Clear price cache (useful for testing)
 * @param symbol Optional specific symbol to clear
 */
export function clearPriceCache(symbol?: string): void {
  if (symbol) {
    const keys = Array.from(priceCache.keys()).filter(key => key.startsWith(symbol));
    keys.forEach(key => priceCache.delete(key));
  } else {
    priceCache.clear();
  }
}

/**
 * Get cache statistics
 * @returns Cache stats
 */
export function getPriceCacheStats(): { size: number; pairs: string[] } {
  return {
    size: priceCache.size,
    pairs: Array.from(priceCache.keys())
  };
}

/**
 * Get available price feeds for current chain
 * @returns Available price feed pairs
 */
export function getAvailablePriceFeeds(): string[] {
  const config = getConfig();
  const feeds = CHAINLINK_FEEDS[config.chain];
  return feeds ? Object.keys(feeds) : [];
}

/**
 * Validate price data
 * @param priceData Price data to validate
 * @returns True if valid
 */
export function validatePriceData(priceData: PriceData): boolean {
  return !!(
    priceData.symbol &&
    typeof priceData.priceUsd === 'number' &&
    priceData.priceUsd > 0 &&
    typeof priceData.timestamp === 'number' &&
    priceData.timestamp > 0 &&
    (priceData.source === 'chainlink' || priceData.source === 'fallback') &&
    typeof priceData.decimals === 'number'
  );
}