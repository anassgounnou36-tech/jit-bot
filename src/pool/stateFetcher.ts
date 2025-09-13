import { ethers } from 'ethers';
import { getConfig, getHttpProvider } from '../config';

export interface PoolState {
  address: string;
  sqrtPriceX96: ethers.BigNumber;
  tick: number;
  liquidity: ethers.BigNumber;
  feeGrowthGlobal0X128: ethers.BigNumber;
  feeGrowthGlobal1X128: ethers.BigNumber;
  fee: number;
  tickSpacing: number;
  token0: string;
  token1: string;
  decimals0?: number; // Token0 decimals for price calculation
  decimals1?: number; // Token1 decimals for price calculation
  unlocked: boolean;
  timestamp: number; // Cache timestamp
}

export interface LiquidityEstimate {
  totalLiquidity: ethers.BigNumber;
  liquidityInRange: ethers.BigNumber;
  utilizationRatio: number;
}

// Cache for pool states with TTL
const CACHE_TTL_MS = 1000; // 1 second TTL as specified
const poolStateCache = new Map<string, PoolState>();

// Cache for token decimals (longer TTL since decimals don't change)
const TOKEN_DECIMALS_CACHE_TTL_MS = 3600000; // 1 hour
const tokenDecimalsCache = new Map<string, { decimals: number; timestamp: number }>();

// Uniswap V3 Pool ABI - minimal interface for state fetching
const POOL_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() external view returns (uint128)',
  'function fee() external view returns (uint24)',
  'function tickSpacing() external view returns (int24)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function feeGrowthGlobal0X128() external view returns (uint256)',
  'function feeGrowthGlobal1X128() external view returns (uint256)'
];

// ERC20 ABI for token decimals
const ERC20_ABI = [
  'function decimals() external view returns (uint8)'
];

/**
 * Get token decimals with caching
 * @param tokenAddress Token contract address
 * @returns Token decimals
 */
async function getTokenDecimals(tokenAddress: string): Promise<number> {
  const normalizedAddress = ethers.utils.getAddress(tokenAddress);
  
  // Check cache first
  const cached = tokenDecimalsCache.get(normalizedAddress);
  if (cached && (Date.now() - cached.timestamp) < TOKEN_DECIMALS_CACHE_TTL_MS) {
    return cached.decimals;
  }
  
  const config = getConfig();
  const provider = getHttpProvider(config);
  const tokenContract = new ethers.Contract(normalizedAddress, ERC20_ABI, provider);
  
  try {
    const decimals = await tokenContract.decimals();
    
    // Cache the result
    tokenDecimalsCache.set(normalizedAddress, {
      decimals,
      timestamp: Date.now()
    });
    
    return decimals;
  } catch (error: any) {
    // Default to 18 decimals if we can't fetch (most ERC20 tokens use 18)
    return 18;
  }
}

/**
 * Get current pool state with caching
 * @param poolAddress The pool contract address
 * @returns Current pool state
 */
export async function getPoolState(poolAddress: string): Promise<PoolState> {
  const normalizedAddress = ethers.utils.getAddress(poolAddress);
  
  // Check cache first
  const cached = poolStateCache.get(normalizedAddress);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    return cached;
  }
  
  const config = getConfig();
  const provider = getHttpProvider(config);
  const poolContract = new ethers.Contract(normalizedAddress, POOL_ABI, provider);
  
  try {
    // Fetch all pool state in parallel
    const [slot0, liquidity, fee, tickSpacing, token0, token1, feeGrowthGlobal0X128, feeGrowthGlobal1X128] = await Promise.all([
      poolContract.slot0(),
      poolContract.liquidity(),
      poolContract.fee(),
      poolContract.tickSpacing(),
      poolContract.token0(),
      poolContract.token1(),
      poolContract.feeGrowthGlobal0X128(),
      poolContract.feeGrowthGlobal1X128()
    ]);
    
    // Fetch token decimals for price calculation
    const [decimals0, decimals1] = await Promise.all([
      getTokenDecimals(token0),
      getTokenDecimals(token1)
    ]);
    
    const poolState: PoolState = {
      address: normalizedAddress,
      sqrtPriceX96: slot0.sqrtPriceX96,
      tick: slot0.tick,
      liquidity,
      feeGrowthGlobal0X128,
      feeGrowthGlobal1X128,
      fee,
      tickSpacing,
      token0: ethers.utils.getAddress(token0),
      token1: ethers.utils.getAddress(token1),
      decimals0,
      decimals1,
      unlocked: slot0.unlocked,
      timestamp: Date.now()
    };
    
    // Cache the result
    poolStateCache.set(normalizedAddress, poolState);
    
    return poolState;
    
  } catch (error: any) {
    throw new Error(`Failed to fetch pool state for ${normalizedAddress}: ${error.message}`);
  }
}

/**
 * Get pool states for multiple pools
 * @param poolAddresses Array of pool addresses
 * @returns Map of pool states
 */
export async function getMultiplePoolStates(poolAddresses: string[]): Promise<Map<string, PoolState>> {
  const results = new Map<string, PoolState>();
  
  // Fetch all pools in parallel
  const promises = poolAddresses.map(async (address) => {
    try {
      const state = await getPoolState(address);
      results.set(address, state);
    } catch (error: any) {
      console.warn(`Failed to fetch state for pool ${address}:`, error.message);
    }
  });
  
  await Promise.allSettled(promises);
  return results;
}

/**
 * Estimate liquidity in a specific tick range (simple approximation)
 * TODO: Refine with subgraph data for more accurate estimates
 * @param poolAddress The pool address
 * @param tickLower Lower tick of the range
 * @param tickUpper Upper tick of the range
 * @returns Liquidity estimate
 */
export async function estimateLiquidityInRange(
  poolAddress: string,
  tickLower: number,
  tickUpper: number
): Promise<LiquidityEstimate> {
  const poolState = await getPoolState(poolAddress);
  
  // Simple approximation: assume uniform liquidity distribution
  // In reality, you would query tick data or use the subgraph
  
  const totalLiquidity = poolState.liquidity;
  
  // Estimate based on tick range size and current tick position
  const currentTick = poolState.tick;
  const rangeSize = tickUpper - tickLower;
  
  // If current tick is in range, assume higher concentration
  let liquidityInRange: ethers.BigNumber;
  
  if (currentTick >= tickLower && currentTick <= tickUpper) {
    // Current price is in range - assume 20% of total liquidity is concentrated here
    liquidityInRange = totalLiquidity.mul(20).div(100);
  } else {
    // Out of range - estimate based on distance and range size
    const distance = Math.min(
      Math.abs(currentTick - tickLower),
      Math.abs(currentTick - tickUpper)
    );
    
    // Further from current price = less liquidity
    const distanceFactor = Math.max(0.01, 1 / (1 + distance / 1000));
    const rangeFactor = Math.min(1, rangeSize / 1000); // Larger ranges have more liquidity
    
    liquidityInRange = totalLiquidity.mul(Math.floor(distanceFactor * rangeFactor * 100)).div(100);
  }
  
  const utilizationRatio = parseFloat(ethers.utils.formatEther(liquidityInRange)) / 
                          parseFloat(ethers.utils.formatEther(totalLiquidity));
  
  return {
    totalLiquidity,
    liquidityInRange,
    utilizationRatio
  };
}

/**
 * Check if pool state is recent enough for trading decisions
 * @param poolState The pool state to check
 * @param maxAgeMs Maximum age in milliseconds
 * @returns True if state is fresh enough
 */
export function isPoolStateFresh(poolState: PoolState, maxAgeMs: number = CACHE_TTL_MS): boolean {
  return (Date.now() - poolState.timestamp) < maxAgeMs;
}

/**
 * Get current price from pool state with decimal adjustment
 * @param poolState The pool state
 * @returns Current price (token1/token0) adjusted for decimals
 */
export function getCurrentPrice(poolState: PoolState): number {
  // Uniswap V3 price formula: price = (sqrtPriceX96^2 / 2^192) * 10^(decimals0 - decimals1)
  const Q96 = ethers.BigNumber.from('79228162514264337593543950336'); // 2^96
  const sqrtPrice = poolState.sqrtPriceX96;
  
  // Calculate price with proper decimal handling
  // price = (sqrtPriceX96^2 / 2^192)
  const priceX192 = sqrtPrice.mul(sqrtPrice);
  const priceBase = priceX192.div(Q96).div(Q96);
  
  // Convert to float for decimal adjustment
  const priceFloat = parseFloat(ethers.utils.formatEther(priceBase.mul(ethers.constants.WeiPerEther)));
  
  // Adjust for token decimals: multiply by 10^(decimals0 - decimals1)
  const decimals0 = poolState.decimals0 || 18;
  const decimals1 = poolState.decimals1 || 18;
  const decimalAdjustment = Math.pow(10, decimals0 - decimals1);
  
  return priceFloat * decimalAdjustment;
}

/**
 * Get current price from pool state (legacy - returns BigNumber)
 * @param poolState The pool state
 * @returns Current price (token1/token0) as BigNumber
 */
export function getCurrentPriceBigNumber(poolState: PoolState): ethers.BigNumber {
  // Convert sqrtPriceX96 to price
  // price = (sqrtPriceX96 / 2^96)^2
  const Q96 = ethers.BigNumber.from('79228162514264337593543950336'); // 2^96
  const sqrtPrice = poolState.sqrtPriceX96;
  
  // Calculate price with precision handling
  const priceX192 = sqrtPrice.mul(sqrtPrice);
  const price = priceX192.div(Q96).div(Q96);
  
  return price;
}

/**
 * Calculate tick from price
 * @param price The price (token1/token0)
 * @returns Corresponding tick
 */
export function priceToTick(price: number): number {
  // tick = log(price) / log(1.0001)
  return Math.floor(Math.log(price) / Math.log(1.0001));
}

/**
 * Calculate price from tick
 * @param tick The tick
 * @returns Corresponding price
 */
export function tickToPrice(tick: number): number {
  // price = 1.0001^tick
  return Math.pow(1.0001, tick);
}

/**
 * Clear cached pool states (useful for testing or forced refresh)
 * @param poolAddress Optional specific pool to clear, or all if not provided
 */
export function clearPoolStateCache(poolAddress?: string): void {
  if (poolAddress) {
    const normalized = ethers.utils.getAddress(poolAddress);
    poolStateCache.delete(normalized);
  } else {
    poolStateCache.clear();
  }
}

/**
 * Get cache statistics
 * @returns Cache stats
 */
export function getCacheStats(): { size: number; addresses: string[] } {
  return {
    size: poolStateCache.size,
    addresses: Array.from(poolStateCache.keys())
  };
}

/**
 * Validate that pool state has required fields
 * @param poolState The pool state to validate
 * @returns True if valid
 */
export function validatePoolState(poolState: PoolState): boolean {
  try {
    return !!(
      poolState.address &&
      poolState.sqrtPriceX96 &&
      typeof poolState.tick === 'number' &&
      poolState.liquidity &&
      typeof poolState.fee === 'number' &&
      typeof poolState.tickSpacing === 'number' &&
      poolState.token0 &&
      poolState.token1 &&
      typeof poolState.unlocked === 'boolean' &&
      typeof poolState.timestamp === 'number'
    );
  } catch {
    return false;
  }
}

/**
 * Get pool info from configuration
 * @param poolAddress Pool address
 * @returns Pool configuration if found
 */
export function getPoolConfig(poolAddress: string) {
  const config = getConfig();
  return config.pools.find(pool => 
    pool.address.toLowerCase() === poolAddress.toLowerCase()
  );
}