#!/usr/bin/env node
/**
 * Generate test fixtures for E2E simulation with victim transactions
 * This script fetches recent blocks and captures Uniswap V3 swaps for testing
 */

import { ethers } from 'ethers';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

interface TestFixture {
  poolAddress: string;
  blockNumber: number;
  victimTransaction: {
    hash: string;
    rawTx: string;
    data: string;
    from: string;
    to: string;
    value: string;
    gasPrice: string;
    gasLimit: string;
    nonce: number;
  };
  swapParams: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    amountOutMinimum: string;
    fee: number;
  };
  expectedResults: {
    profitable: boolean;
    estimatedNetProfitUSD: number;
  };
  metadata: {
    generatedAt: string;
    chain: string;
    description: string;
  };
}

// Target pools for fixture generation
const TARGET_POOLS = [
  {
    id: 'USDC-WETH-0.3%',
    address: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8',
    token0: '0xA0b86a33E6427fF2B5B8b9a5e5D17b5c4c6f6b7c', // USDC
    token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    fee: 3000,
    description: 'USDC/WETH 0.3% - High volume pool'
  },
  {
    id: 'USDT-WETH-0.3%', 
    address: '0x4e68Ccd3E89f51C3074ca5072bbAC773960dFa36',
    token0: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
    token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    fee: 3000,
    description: 'USDT/WETH 0.3% - Stable volume pool'
  },
  {
    id: 'DAI-WETH-0.3%',
    address: '0xC2e9F25Be6257c210d7Adf0D4Cd6E3E881ba25f8',
    token0: '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
    token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    fee: 3000,
    description: 'DAI/WETH 0.3% - Alternative stable pool'
  }
];

/**
 * Generate test fixtures for the specified pools
 */
async function generateFixtures(): Promise<void> {
  console.log('🔄 Starting fixture generation...');
  
  const RPC_URL = process.env.MAINNET_RPC_URL || 'https://eth-mainnet.alchemyapi.io/v2/demo';
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  
  const reportsDir = join(process.cwd(), 'reports');
  
  // Ensure reports directory exists
  try {
    mkdirSync(reportsDir, { recursive: true });
  } catch (error) {
    // Directory already exists
  }

  for (const pool of TARGET_POOLS) {
    try {
      console.log(`📊 Generating fixture for ${pool.id}...`);
      
      const fixture = await generatePoolFixture(provider, pool);
      
      if (fixture) {
        const filename = `fixture-${pool.id}-${fixture.blockNumber}.json`;
        const filepath = join(reportsDir, filename);
        
        writeFileSync(filepath, JSON.stringify(fixture, null, 2));
        
        console.log(`✅ Generated fixture: ${filename}`);
        console.log(`   Block: ${fixture.blockNumber}`);
        console.log(`   Victim TX: ${fixture.victimTransaction.hash.slice(0, 10)}...`);
        console.log(`   Swap Amount: ${ethers.utils.formatEther(fixture.swapParams.amountIn)} ETH`);
      } else {
        console.log(`⚠️  Could not generate fixture for ${pool.id} - no suitable transactions found`);
      }
      
    } catch (error: any) {
      console.error(`❌ Error generating fixture for ${pool.id}:`, error.message);
    }
  }
  
  console.log('🏁 Fixture generation completed');
}

/**
 * Generate a test fixture for a specific pool
 */
async function generatePoolFixture(provider: ethers.providers.Provider, pool: any): Promise<TestFixture | null> {
  const UNISWAP_V3_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
  const SEARCH_BLOCKS = 100; // Search last 100 blocks
  
  const latestBlock = await provider.getBlockNumber();
  const startBlock = latestBlock - SEARCH_BLOCKS;
  
  console.log(`   Searching blocks ${startBlock} to ${latestBlock}...`);
  
  // Search for transactions to the Uniswap V3 router
  for (let blockNumber = latestBlock; blockNumber >= startBlock; blockNumber--) {
    try {
      const block = await provider.getBlockWithTransactions(blockNumber);
      
      for (const tx of block.transactions) {
        if (tx.to?.toLowerCase() === UNISWAP_V3_ROUTER.toLowerCase()) {
          
          // Try to parse as exactInputSingle
          const swapData = parseExactInputSingle(tx.data);
          if (swapData && isTargetPool(swapData, pool)) {
            
            // Check minimum swap size (10 ETH equivalent)
            const amountIn = ethers.BigNumber.from(swapData.amountIn);
            if (amountIn.gte(ethers.utils.parseEther('10'))) {
              
              return createFixture(tx, blockNumber, pool, swapData);
            }
          }
        }
      }
    } catch (error) {
      // Skip problematic blocks
      continue;
    }
  }
  
  return null;
}

/**
 * Parse exactInputSingle transaction data
 */
function parseExactInputSingle(data: string): any {
  try {
    const iface = new ethers.utils.Interface([
      'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut)'
    ]);
    
    const parsed = iface.parseTransaction({ data });
    
    if (parsed.name === 'exactInputSingle') {
      return parsed.args[0];
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Check if swap data matches target pool
 */
function isTargetPool(swapData: any, pool: any): boolean {
  return (
    swapData.fee === pool.fee && (
      (swapData.tokenIn.toLowerCase() === pool.token0.toLowerCase() && 
       swapData.tokenOut.toLowerCase() === pool.token1.toLowerCase()) ||
      (swapData.tokenIn.toLowerCase() === pool.token1.toLowerCase() && 
       swapData.tokenOut.toLowerCase() === pool.token0.toLowerCase())
    )
  );
}

/**
 * Create test fixture from transaction data
 */
function createFixture(tx: any, blockNumber: number, pool: any, swapData: any): TestFixture {
  // Generate mock raw transaction (in production, would be captured from mempool)
  const mockRawTx = ethers.utils.serializeTransaction({
    to: tx.to,
    value: tx.value,
    data: tx.data,
    gasLimit: tx.gasLimit,
    gasPrice: tx.gasPrice,
    nonce: tx.nonce,
    type: tx.type || 0,
    chainId: tx.chainId || 1
  });
  
  return {
    poolAddress: pool.address,
    blockNumber,
    victimTransaction: {
      hash: tx.hash,
      rawTx: mockRawTx,
      data: tx.data,
      from: tx.from,
      to: tx.to,
      value: tx.value.toString(),
      gasPrice: tx.gasPrice?.toString() || '0',
      gasLimit: tx.gasLimit.toString(),
      nonce: tx.nonce
    },
    swapParams: {
      tokenIn: swapData.tokenIn,
      tokenOut: swapData.tokenOut,
      amountIn: swapData.amountIn.toString(),
      amountOutMinimum: swapData.amountOutMinimum.toString(),
      fee: swapData.fee
    },
    expectedResults: {
      profitable: true, // Assume profitable for test fixtures
      estimatedNetProfitUSD: 50 // Mock profit estimate
    },
    metadata: {
      generatedAt: new Date().toISOString(),
      chain: 'ethereum',
      description: pool.description
    }
  };
}

// Run the fixture generation
if (require.main === module) {
  generateFixtures().catch(console.error);
}

export { generateFixtures, TestFixture };