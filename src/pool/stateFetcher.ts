import { ethers, BigNumber } from 'ethers';
import { getPoolConfig, PoolConfig } from '../config';
import { config } from '../config';
import { createLogger } from '../logging/logger';

const logger = createLogger('StateFetcher');

/**
 * Cached pool state information
 */
export interface PoolState {
  poolAddress: string;
  sqrtPriceX96: BigNumber;
  tick: number;
  liquidity: BigNumber;
  feeGrowthGlobal0X128: BigNumber;
  feeGrowthGlobal1X128: BigNumber;
  lastUpdated: number;
  feeTier: number;
  tickSpacing: number;
}

/**
 * Simple tick liquidity estimation (approximation for PR1)
 */
export interface TickLiquidityEstimate {
  tickLower: number;
  tickUpper: number;
  estimatedLiquidity: BigNumber;
  confidence: 'low' | 'medium' | 'high';
}

/**
 * Pool state fetcher with TTL caching
 */
export class StateFetcher {
  private provider: ethers.providers.JsonRpcProvider;
  private cache: Map<string, PoolState> = new Map();
  private staticDataCache: Map<string, { feeTier: number; tickSpacing: number }> = new Map();
  private readonly cacheTtlMs: number = 1000; // 1 second TTL

  // Uniswap V3 Pool ABI (minimal interface)
  private readonly poolAbi = [
    'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
    'function liquidity() external view returns (uint128)',
    'function fee() external view returns (uint24)',
    'function tickSpacing() external view returns (int24)',
    'function feeGrowthGlobal0X128() external view returns (uint256)',
    'function feeGrowthGlobal1X128() external view returns (uint256)',
    'function token0() external view returns (address)',
    'function token1() external view returns (address)',
  ];

  constructor(httpRpcUrl: string) {
    this.provider = new ethers.providers.JsonRpcProvider(httpRpcUrl);
    logger.info('StateFetcher initialized', { httpRpcUrl: httpRpcUrl.replace(/\/[^\/]*$/, '/***') });
  }

  /**
   * Get current pool state with caching
   */
  async getPoolState(poolAddress: string): Promise<PoolState> {
    const normalizedAddress = poolAddress.toLowerCase();
    
    // Check cache first
    const cached = this.cache.get(normalizedAddress);
    if (cached && (Date.now() - cached.lastUpdated) < this.cacheTtlMs) {
      return cached;
    }

    try {
      // Create pool contract instance
      const poolContract = new ethers.Contract(poolAddress, this.poolAbi, this.provider);
      
      // Fetch static data (cached separately with longer TTL)
      const staticData = await this.getStaticPoolData(poolAddress, poolContract);
      
      // Fetch dynamic state data
      const [slot0Result, liquidity, feeGrowthGlobal0X128, feeGrowthGlobal1X128] = await Promise.all([
        poolContract.slot0(),
        poolContract.liquidity(),
        poolContract.feeGrowthGlobal0X128(),
        poolContract.feeGrowthGlobal1X128(),
      ]);

      const poolState: PoolState = {
        poolAddress: normalizedAddress,
        sqrtPriceX96: slot0Result.sqrtPriceX96,
        tick: slot0Result.tick,
        liquidity,
        feeGrowthGlobal0X128,
        feeGrowthGlobal1X128,
        lastUpdated: Date.now(),
        feeTier: staticData.feeTier,
        tickSpacing: staticData.tickSpacing,
      };

      // Cache the result
      this.cache.set(normalizedAddress, poolState);
      
      logger.debug('Pool state fetched', {
        poolAddress: normalizedAddress,
        tick: poolState.tick,
        sqrtPriceX96: poolState.sqrtPriceX96.toString(),
        liquidity: poolState.liquidity.toString(),
        feeTier: poolState.feeTier,
        tickSpacing: poolState.tickSpacing,
      });

      return poolState;

    } catch (error: any) {
      logger.error('Failed to fetch pool state', {
        poolAddress: normalizedAddress,
        error: error.message,
      });
      throw new Error(`Failed to fetch pool state for ${poolAddress}: ${error.message}`);
    }
  }

  /**
   * Get static pool data (fee tier, tick spacing) with longer caching
   */
  private async getStaticPoolData(
    poolAddress: string, 
    poolContract: ethers.Contract
  ): Promise<{ feeTier: number; tickSpacing: number }> {
    const normalizedAddress = poolAddress.toLowerCase();
    
    // Check static cache first
    const cached = this.staticDataCache.get(normalizedAddress);
    if (cached) {
      return cached;
    }

    // Try to get from config first
    const poolConfig = getPoolConfig(poolAddress, config);
    if (poolConfig) {
      const staticData = {
        feeTier: poolConfig.fee,
        tickSpacing: poolConfig.tickSpacing,
      };
      this.staticDataCache.set(normalizedAddress, staticData);
      return staticData;
    }

    // Fetch from contract if not in config
    try {
      const [fee, tickSpacing] = await Promise.all([
        poolContract.fee(),
        poolContract.tickSpacing(),
      ]);

      const staticData = {
        feeTier: fee,
        tickSpacing,
      };

      this.staticDataCache.set(normalizedAddress, staticData);
      logger.info('Static pool data fetched from contract', {
        poolAddress: normalizedAddress,
        feeTier: staticData.feeTier,
        tickSpacing: staticData.tickSpacing,
      });

      return staticData;

    } catch (error: any) {
      logger.error('Failed to fetch static pool data', {
        poolAddress: normalizedAddress,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Estimate liquidity in a specific tick range
   * 
   * This is a simple approximation for PR1. In PR3, this could be enhanced with:
   * - Subgraph queries for exact tick liquidity distribution
   * - Historical liquidity analysis
   * - Cross-reference with multiple data sources
   */
  async estimateLiquidityInRange(
    poolAddress: string,
    tickLower: number,
    tickUpper: number
  ): Promise<TickLiquidityEstimate> {
    try {
      const poolState = await this.getPoolState(poolAddress);
      
      // Simple approximation: assume liquidity is concentrated around current tick
      const currentTick = poolState.tick;
      const totalLiquidity = poolState.liquidity;
      
      // Calculate overlap with current active range (very simplified)
      let estimatedLiquidity: BigNumber;
      let confidence: 'low' | 'medium' | 'high';
      
      if (currentTick >= tickLower && currentTick <= tickUpper) {
        // Current tick is in our range - high confidence
        // Assume significant portion of liquidity is available
        estimatedLiquidity = totalLiquidity.mul(70).div(100); // 70% estimate
        confidence = 'high';
      } else {
        // Current tick is outside our range - lower confidence
        const distanceFromRange = Math.min(
          Math.abs(currentTick - tickLower),
          Math.abs(currentTick - tickUpper)
        );
        
        if (distanceFromRange < poolState.tickSpacing * 10) {
          // Close to our range
          estimatedLiquidity = totalLiquidity.mul(30).div(100); // 30% estimate
          confidence = 'medium';
        } else {
          // Far from our range
          estimatedLiquidity = totalLiquidity.mul(10).div(100); // 10% estimate
          confidence = 'low';
        }
      }

      const estimate: TickLiquidityEstimate = {
        tickLower,
        tickUpper,
        estimatedLiquidity,
        confidence,
      };

      logger.debug('Liquidity estimated for range', {
        poolAddress: poolAddress.toLowerCase(),
        tickLower,
        tickUpper,
        currentTick,
        totalLiquidity: totalLiquidity.toString(),
        estimatedLiquidity: estimatedLiquidity.toString(),
        confidence,
      });

      return estimate;

    } catch (error: any) {
      logger.error('Failed to estimate liquidity in range', {
        poolAddress: poolAddress.toLowerCase(),
        tickLower,
        tickUpper,
        error: error.message,
      });
      
      // Return conservative estimate on error
      return {
        tickLower,
        tickUpper,
        estimatedLiquidity: BigNumber.from(0),
        confidence: 'low',
      };
    }
  }

  /**
   * Batch fetch pool states for multiple pools
   */
  async getMultiplePoolStates(poolAddresses: string[]): Promise<Map<string, PoolState>> {
    const results = new Map<string, PoolState>();
    
    // Fetch all states concurrently
    const promises = poolAddresses.map(async (address) => {
      try {
        const state = await this.getPoolState(address);
        return { address: address.toLowerCase(), state };
      } catch (error: any) {
        logger.warn('Failed to fetch state for pool in batch', {
          poolAddress: address.toLowerCase(),
          error: error.message,
        });
        return null;
      }
    });

    const outcomes = await Promise.all(promises);
    
    // Collect successful results
    outcomes.forEach((outcome) => {
      if (outcome) {
        results.set(outcome.address, outcome.state);
      }
    });

    logger.info('Batch pool state fetch completed', {
      requested: poolAddresses.length,
      successful: results.size,
      failed: poolAddresses.length - results.size,
    });

    return results;
  }

  /**
   * Clear cache for a specific pool or all pools
   */
  clearCache(poolAddress?: string): void {
    if (poolAddress) {
      const normalized = poolAddress.toLowerCase();
      this.cache.delete(normalized);
      logger.debug('Cache cleared for pool', { poolAddress: normalized });
    } else {
      this.cache.clear();
      logger.debug('All pool state cache cleared');
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; oldestEntry: number | null; newestEntry: number | null } {
    const entries = Array.from(this.cache.values());
    
    if (entries.length === 0) {
      return { size: 0, oldestEntry: null, newestEntry: null };
    }

    const timestamps = entries.map(entry => entry.lastUpdated);
    
    return {
      size: entries.length,
      oldestEntry: Math.min(...timestamps),
      newestEntry: Math.max(...timestamps),
    };
  }

  /**
   * Validate pool address format and contract existence
   */
  async validatePoolAddress(poolAddress: string): Promise<boolean> {
    try {
      // Check address format
      if (!ethers.utils.isAddress(poolAddress)) {
        return false;
      }

      // Check if contract exists
      const code = await this.provider.getCode(poolAddress);
      if (code === '0x') {
        return false;
      }

      // Try to call a basic function to verify it's a Uniswap V3 pool
      const poolContract = new ethers.Contract(poolAddress, ['function fee() external view returns (uint24)'], this.provider);
      await poolContract.fee();
      
      return true;

    } catch (error) {
      return false;
    }
  }
}

// Export singleton instance
export const stateFetcher = new StateFetcher(config.rpcUrlHttp);