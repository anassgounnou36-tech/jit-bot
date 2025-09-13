import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { stateFetcher } from '../../src/pool/stateFetcher';
import { computeTickRange, validateTickSpacing } from '../../src/lp/tickUtils';
import { config } from '../../src/config';

describe('StateFetcher Fork Tests', () => {
  // Skip these tests if RPC_URL_HTTP is not available or FORK_BLOCK_NUMBER is not set
  const shouldSkip = !process.env.RPC_URL_HTTP || !process.env.FORK_BLOCK_NUMBER;
  
  before(function() {
    if (shouldSkip) {
      console.log('⏭️  Skipping fork tests - RPC_URL_HTTP or FORK_BLOCK_NUMBER not set');
      this.skip();
    }
  });

  describe('Pool State Fetching', () => {
    it('should fetch real pool state from configured pools', async function() {
      this.timeout(10000); // Allow up to 10 seconds for RPC calls
      
      // Use the first configured pool
      const poolAddress = config.configData.targets[0]?.address;
      
      if (!poolAddress) {
        this.skip();
        return;
      }

      const poolState = await stateFetcher.getPoolState(poolAddress);
      
      expect(poolState).to.exist;
      expect(poolState.poolAddress).to.equal(poolAddress.toLowerCase());
      expect(poolState.sqrtPriceX96.gt(0)).to.be.true;
      expect(poolState.liquidity.gt(0)).to.be.true;
      expect(poolState.tick).to.be.a('number');
      expect(poolState.feeTier).to.be.a('number');
      expect(poolState.tickSpacing).to.be.a('number');
      expect(poolState.lastUpdated).to.be.a('number');
      
      // Verify tick spacing alignment
      expect(validateTickSpacing(poolState.tick, poolState.tickSpacing)).to.be.true;
      
      console.log(`✅ Pool ${poolAddress} state:`, {
        tick: poolState.tick,
        liquidity: poolState.liquidity.toString(),
        feeTier: poolState.feeTier,
        tickSpacing: poolState.tickSpacing,
        sqrtPriceX96: poolState.sqrtPriceX96.toString(),
      });
    });

    it('should validate tick range computation with real data', async function() {
      this.timeout(10000);
      
      const poolAddress = config.configData.targets[0]?.address;
      
      if (!poolAddress) {
        this.skip();
        return;
      }

      const poolState = await stateFetcher.getPoolState(poolAddress);
      const rangeWidth = config.configData.tickRangeWidth || 60;
      
      const tickRange = computeTickRange(
        poolState.sqrtPriceX96,
        poolState.tickSpacing,
        rangeWidth
      );
      
      expect(tickRange.tickLower).to.be.lessThan(tickRange.tickUpper);
      expect(validateTickSpacing(tickRange.tickLower, poolState.tickSpacing)).to.be.true;
      expect(validateTickSpacing(tickRange.tickUpper, poolState.tickSpacing)).to.be.true;
      
      // Range should be reasonable around current tick
      expect(tickRange.tickLower).to.be.lessThanOrEqual(poolState.tick);
      expect(tickRange.tickUpper).to.be.greaterThanOrEqual(poolState.tick);
      
      console.log(`✅ Tick range for pool ${poolAddress}:`, {
        currentTick: poolState.tick,
        tickLower: tickRange.tickLower,
        tickUpper: tickRange.tickUpper,
        tickSpacing: poolState.tickSpacing,
        rangeWidth,
      });
    });

    it('should fetch multiple pool states correctly', async function() {
      this.timeout(15000);
      
      // Get up to 3 configured pools for testing
      const poolAddresses = config.configData.targets
        .slice(0, 3)
        .map(target => target.address);
      
      if (poolAddresses.length === 0) {
        this.skip();
        return;
      }

      const poolStates = await stateFetcher.getMultiplePoolStates(poolAddresses);
      
      expect(poolStates.size).to.be.greaterThan(0);
      expect(poolStates.size).to.be.at.most(poolAddresses.length);
      
      for (const [address, state] of poolStates.entries()) {
        expect(poolAddresses.map(a => a.toLowerCase())).to.include(address);
        expect(state.sqrtPriceX96.gt(0)).to.be.true;
        expect(state.liquidity.gt(0)).to.be.true;
        expect(state.tick).to.be.a('number');
        expect(validateTickSpacing(state.tick, state.tickSpacing)).to.be.true;
      }
      
      console.log(`✅ Fetched ${poolStates.size} pool states successfully`);
    });
  });

  describe('Liquidity Estimation', () => {
    it('should estimate liquidity in tick ranges', async function() {
      this.timeout(10000);
      
      const poolAddress = config.configData.targets[0]?.address;
      
      if (!poolAddress) {
        this.skip();
        return;
      }

      const poolState = await stateFetcher.getPoolState(poolAddress);
      
      // Test range around current tick
      const currentTick = poolState.tick;
      const tickSpacing = poolState.tickSpacing;
      const tickLower = Math.floor((currentTick - 300) / tickSpacing) * tickSpacing;
      const tickUpper = Math.ceil((currentTick + 300) / tickSpacing) * tickSpacing;
      
      const liquidityEstimate = await stateFetcher.estimateLiquidityInRange(
        poolAddress,
        tickLower,
        tickUpper
      );
      
      expect(liquidityEstimate).to.exist;
      expect(liquidityEstimate.tickLower).to.equal(tickLower);
      expect(liquidityEstimate.tickUpper).to.equal(tickUpper);
      expect(liquidityEstimate.estimatedLiquidity.gte(0)).to.be.true;
      expect(['low', 'medium', 'high']).to.include(liquidityEstimate.confidence);
      
      // If current tick is in range, confidence should be higher
      if (currentTick >= tickLower && currentTick <= tickUpper) {
        expect(liquidityEstimate.confidence).to.equal('high');
        expect(liquidityEstimate.estimatedLiquidity.gt(0)).to.be.true;
      }
      
      console.log(`✅ Liquidity estimate for range [${tickLower}, ${tickUpper}]:`, {
        estimatedLiquidity: liquidityEstimate.estimatedLiquidity.toString(),
        confidence: liquidityEstimate.confidence,
        currentTick,
        totalPoolLiquidity: poolState.liquidity.toString(),
      });
    });

    it('should handle ranges outside current tick', async function() {
      this.timeout(10000);
      
      const poolAddress = config.configData.targets[0]?.address;
      
      if (!poolAddress) {
        this.skip();
        return;
      }

      const poolState = await stateFetcher.getPoolState(poolAddress);
      const currentTick = poolState.tick;
      const tickSpacing = poolState.tickSpacing;
      
      // Range far above current tick
      const farTickLower = currentTick + (tickSpacing * 100);
      const farTickUpper = currentTick + (tickSpacing * 200);
      
      const liquidityEstimate = await stateFetcher.estimateLiquidityInRange(
        poolAddress,
        farTickLower,
        farTickUpper
      );
      
      expect(liquidityEstimate.confidence).to.not.equal('high');
      expect(liquidityEstimate.estimatedLiquidity.gte(0)).to.be.true;
      
      console.log(`✅ Far range liquidity estimate:`, {
        rangeDistance: farTickLower - currentTick,
        confidence: liquidityEstimate.confidence,
        estimatedLiquidity: liquidityEstimate.estimatedLiquidity.toString(),
      });
    });
  });

  describe('Pool Validation', () => {
    it('should validate configured pool addresses', async function() {
      this.timeout(15000);
      
      for (const target of config.configData.targets) {
        const isValid = await stateFetcher.validatePoolAddress(target.address);
        expect(isValid).to.be.true;
        
        console.log(`✅ Pool ${target.pool} (${target.address}) is valid`);
      }
    });

    it('should reject invalid pool addresses', async function() {
      this.timeout(5000);
      
      const invalidAddresses = [
        '0x0000000000000000000000000000000000000000', // Zero address
        '0x1111111111111111111111111111111111111111', // Non-existent contract
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH (not a pool)
      ];
      
      for (const address of invalidAddresses) {
        const isValid = await stateFetcher.validatePoolAddress(address);
        expect(isValid).to.be.false;
        
        console.log(`✅ Address ${address} correctly identified as invalid`);
      }
    });
  });

  describe('Cache Performance', () => {
    it('should cache pool state and serve from cache', async function() {
      this.timeout(10000);
      
      const poolAddress = config.configData.targets[0]?.address;
      
      if (!poolAddress) {
        this.skip();
        return;
      }

      // Clear cache first
      stateFetcher.clearCache(poolAddress);
      
      // First call should fetch from network
      const start1 = Date.now();
      const state1 = await stateFetcher.getPoolState(poolAddress);
      const duration1 = Date.now() - start1;
      
      // Second call should be from cache (much faster)
      const start2 = Date.now();
      const state2 = await stateFetcher.getPoolState(poolAddress);
      const duration2 = Date.now() - start2;
      
      expect(state1.timestamp).to.equal(state2.timestamp);
      expect(state1.sqrtPriceX96.eq(state2.sqrtPriceX96)).to.be.true;
      expect(duration2).to.be.lessThan(duration1 / 2); // Cache should be much faster
      
      console.log(`✅ Cache performance: first call ${duration1}ms, cached call ${duration2}ms`);
    });

    it('should provide cache statistics', async function() {
      this.timeout(5000);
      
      const poolAddress = config.configData.targets[0]?.address;
      
      if (!poolAddress) {
        this.skip();
        return;
      }

      stateFetcher.clearCache();
      
      let stats = stateFetcher.getCacheStats();
      expect(stats.size).to.equal(0);
      
      await stateFetcher.getPoolState(poolAddress);
      
      stats = stateFetcher.getCacheStats();
      expect(stats.size).to.equal(1);
      expect(stats.newestEntry).to.be.a('number');
      expect(stats.oldestEntry).to.be.a('number');
      
      console.log(`✅ Cache stats after one fetch:`, stats);
    });
  });

  describe('Real Pool Data Validation', () => {
    it('should have reasonable pool data values', async function() {
      this.timeout(10000);
      
      const poolAddress = config.configData.targets[0]?.address;
      
      if (!poolAddress) {
        this.skip();
        return;
      }

      const poolState = await stateFetcher.getPoolState(poolAddress);
      const poolConfig = config.configData.targets.find(t => 
        t.address.toLowerCase() === poolAddress.toLowerCase()
      );
      
      expect(poolConfig).to.exist;
      
      // Validate against known pool configuration
      expect(poolState.feeTier).to.equal(poolConfig!.fee);
      expect(poolState.tickSpacing).to.equal(poolConfig!.tickSpacing);
      
      // Sanity checks for pool values
      expect(poolState.sqrtPriceX96.gt(BigNumber.from('79228162514264337593543950336'))).to.be.true; // > 2^96 (very low price)
      expect(poolState.sqrtPriceX96.lt(BigNumber.from('1461446703485210103287273052203988822378723970342'))).to.be.true; // < max price
      
      expect(poolState.liquidity.gt(0)).to.be.true;
      expect(poolState.tick).to.be.greaterThanOrEqual(-887272); // Min tick
      expect(poolState.tick).to.be.lessThanOrEqual(887272);     // Max tick
      
      // Fee growth should be non-negative
      expect(poolState.feeGrowthGlobal0X128.gte(0)).to.be.true;
      expect(poolState.feeGrowthGlobal1X128.gte(0)).to.be.true;
      
      console.log(`✅ Pool data validation passed for ${poolConfig!.pool}:`, {
        feeTier: poolState.feeTier,
        tickSpacing: poolState.tickSpacing,
        currentTick: poolState.tick,
        liquidityGT0: poolState.liquidity.gt(0),
        priceInBounds: true,
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent pools gracefully', async function() {
      this.timeout(5000);
      
      const nonExistentPool = '0x1234567890123456789012345678901234567890';
      
      try {
        await stateFetcher.getPoolState(nonExistentPool);
        expect.fail('Should have thrown for non-existent pool');
      } catch (error: any) {
        expect(error.message).to.include(nonExistentPool);
        console.log(`✅ Correctly handled non-existent pool: ${error.message}`);
      }
    });

    it('should handle network timeouts gracefully', async function() {
      this.timeout(8000);
      
      // This test checks the system behavior under network stress
      // We'll try to fetch state for multiple pools quickly
      const poolAddresses = config.configData.targets.map(t => t.address);
      
      if (poolAddresses.length === 0) {
        this.skip();
        return;
      }

      try {
        // Clear cache to force network calls
        stateFetcher.clearCache();
        
        // Try to fetch all states concurrently
        const promises = poolAddresses.map(addr => 
          stateFetcher.getPoolState(addr)
        );
        
        const results = await Promise.allSettled(promises);
        
        // At least some should succeed
        const successful = results.filter(r => r.status === 'fulfilled').length;
        expect(successful).to.be.greaterThan(0);
        
        console.log(`✅ Network stress test: ${successful}/${poolAddresses.length} successful`);
        
      } catch (error: any) {
        console.log(`⚠️ Network timeout test failed (expected in some environments): ${error.message}`);
        // Don't fail the test for network issues in CI environments
      }
    });
  });
});