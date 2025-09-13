import { expect } from 'chai';
import { ethers } from 'ethers';
import { getPoolState, validatePoolState } from '../../src/pool/stateFetcher';

// This test runs only when FORK_BLOCK_NUMBER and RPC_URL_HTTP are provided
// It validates that we can fetch real pool state from mainnet

describe('Mainnet Fork Integration', () => {
  const FORK_BLOCK_NUMBER = process.env.FORK_BLOCK_NUMBER;
  const RPC_URL_HTTP = process.env.RPC_URL_HTTP;
  
  // Known Uniswap V3 pools on mainnet for testing
  const TEST_POOLS = {
    'WETH-USDC-0.05%': {
      address: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
      tickSpacing: 10,
      fee: 500
    },
    'ETH-USDT-0.3%': {
      address: '0x4e68Ccd3E89f51C3074ca5072bbAC773960dFa36',
      tickSpacing: 60,
      fee: 3000
    }
  };

  beforeEach(() => {
    // Set test environment for fork testing
    if (RPC_URL_HTTP) {
      process.env.RPC_URL_HTTP = RPC_URL_HTTP;
      process.env.RPC_URL_WS = RPC_URL_HTTP.replace('https://', 'wss://');
    }
    process.env.CHAIN = 'ethereum';
    process.env.SIMULATION_MODE = 'true';
    process.env.PRIVATE_KEY = '0x' + '1'.repeat(64);
  });

  describe('Pool State Fetching', () => {
    before(function() {
      // Skip tests if fork environment not configured
      if (!FORK_BLOCK_NUMBER || !RPC_URL_HTTP) {
        this.skip();
      }
    });

    it('should fetch pool state from mainnet fork', async function() {
      this.timeout(10000); // Increase timeout for network calls
      
      const poolConfig = TEST_POOLS['WETH-USDC-0.05%'];
      
      try {
        const poolState = await getPoolState(poolConfig.address);
        
        // Validate basic pool state structure
        expect(poolState).to.have.property('address');
        expect(poolState).to.have.property('sqrtPriceX96');
        expect(poolState).to.have.property('tick');
        expect(poolState).to.have.property('liquidity');
        expect(poolState).to.have.property('fee');
        expect(poolState).to.have.property('tickSpacing');
        expect(poolState).to.have.property('token0');
        expect(poolState).to.have.property('token1');
        expect(poolState).to.have.property('unlocked');
        expect(poolState).to.have.property('timestamp');
        
        // Validate address normalization
        expect(poolState.address).to.equal(ethers.utils.getAddress(poolConfig.address));
        
        // Validate pool configuration matches
        expect(poolState.fee).to.equal(poolConfig.fee);
        expect(poolState.tickSpacing).to.equal(poolConfig.tickSpacing);
        
        // Validate tick is aligned to tick spacing
        expect(poolState.tick % poolState.tickSpacing).to.equal(0);
        
        // Validate basic ranges
        expect(poolState.sqrtPriceX96).to.be.instanceOf(ethers.BigNumber);
        expect(poolState.sqrtPriceX96.gt(0)).to.be.true;
        expect(poolState.liquidity).to.be.instanceOf(ethers.BigNumber);
        expect(poolState.liquidity.gt(0)).to.be.true;
        
        // Validate tick bounds (Uniswap V3 limits)
        expect(poolState.tick).to.be.greaterThanOrEqual(-887272);
        expect(poolState.tick).to.be.lessThanOrEqual(887272);
        
        // Validate pool is unlocked
        expect(poolState.unlocked).to.be.true;
        
        // Validate timestamp is recent
        expect(poolState.timestamp).to.be.greaterThan(Date.now() - 60000); // Within last minute
        
        console.log(`✅ Pool state validated for ${poolConfig.address}:`);
        console.log(`   Tick: ${poolState.tick}`);
        console.log(`   Liquidity: ${ethers.utils.formatEther(poolState.liquidity)} ETH`);
        console.log(`   Fee: ${poolState.fee / 10000}%`);
        console.log(`   Tick Spacing: ${poolState.tickSpacing}`);
        
      } catch (error: any) {
        console.warn(`⚠️  Could not fetch pool state: ${error.message}`);
        // Don't fail the test if it's a network issue
        if (error.message.includes('network') || error.message.includes('timeout')) {
          this.skip();
        } else {
          throw error;
        }
      }
    });

    it('should validate multiple pools in parallel', async function() {
      this.timeout(15000); // Longer timeout for multiple network calls
      
      const poolAddresses = Object.values(TEST_POOLS).map(pool => pool.address);
      
      try {
        // Import the function we need
        const { getMultiplePoolStates } = await import('../../src/pool/stateFetcher');
        
        const poolStates = await getMultiplePoolStates(poolAddresses);
        
        expect(poolStates.size).to.be.greaterThan(0);
        expect(poolStates.size).to.be.lessThanOrEqual(poolAddresses.length);
        
        // Validate each pool state
        for (const [address, state] of poolStates) {
          expect(validatePoolState(state)).to.be.true;
          
          // Find corresponding config
          const poolConfig = Object.values(TEST_POOLS).find(p => 
            p.address.toLowerCase() === address.toLowerCase()
          );
          
          if (poolConfig) {
            expect(state.fee).to.equal(poolConfig.fee);
            expect(state.tickSpacing).to.equal(poolConfig.tickSpacing);
            expect(state.tick % state.tickSpacing).to.equal(0);
          }
        }
        
        console.log(`✅ Validated ${poolStates.size} pools successfully`);
        
      } catch (error: any) {
        console.warn(`⚠️  Could not fetch multiple pool states: ${error.message}`);
        if (error.message.includes('network') || error.message.includes('timeout')) {
          this.skip();
        } else {
          throw error;
        }
      }
    });

    it('should handle non-existent pool gracefully', async function() {
      this.timeout(5000);
      
      const fakePoolAddress = '0x1111111111111111111111111111111111111111';
      
      try {
        await getPoolState(fakePoolAddress);
        expect.fail('Should have thrown an error for non-existent pool');
      } catch (error: any) {
        expect(error.message).to.include('Failed to fetch pool state');
      }
    });

    it('should validate cache behavior', async function() {
      this.timeout(10000);
      
      const poolConfig = TEST_POOLS['WETH-USDC-0.05%'];
      
      try {
        // First call
        const start1 = Date.now();
        const state1 = await getPoolState(poolConfig.address);
        const duration1 = Date.now() - start1;
        
        // Second call should be faster (cached)
        const start2 = Date.now();
        const state2 = await getPoolState(poolConfig.address);
        const duration2 = Date.now() - start2;
        
        // Cached call should be much faster
        expect(duration2).to.be.lessThan(duration1 / 2);
        
        // States should be identical
        expect(state1.tick).to.equal(state2.tick);
        expect(state1.liquidity.toString()).to.equal(state2.liquidity.toString());
        expect(state1.sqrtPriceX96.toString()).to.equal(state2.sqrtPriceX96.toString());
        
        console.log(`✅ Cache validation: first call ${duration1}ms, cached call ${duration2}ms`);
        
      } catch (error: any) {
        if (error.message.includes('network') || error.message.includes('timeout')) {
          this.skip();
        } else {
          throw error;
        }
      }
    });
  });

  describe('Environment Validation', () => {
    it('should validate test environment is properly configured', function() {
      if (!FORK_BLOCK_NUMBER || !RPC_URL_HTTP) {
        console.log('ℹ️  Fork tests skipped - set FORK_BLOCK_NUMBER and RPC_URL_HTTP to run');
        this.skip();
      }
      
      expect(FORK_BLOCK_NUMBER).to.be.a('string');
      expect(parseInt(FORK_BLOCK_NUMBER)).to.be.greaterThan(0);
      expect(RPC_URL_HTTP).to.be.a('string');
      expect(RPC_URL_HTTP).to.include('http');
      
      console.log(`✅ Fork test environment configured:`);
      console.log(`   Block: ${FORK_BLOCK_NUMBER}`);
      console.log(`   RPC: ${RPC_URL_HTTP.substring(0, 50)}...`);
    });
  });
});