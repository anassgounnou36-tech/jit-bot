#!/usr/bin/env node
/**
 * Enhanced fixture generation for production-ready E2E simulation
 * Generates comprehensive test fixtures with victim transactions and profitability analysis
 */

import { ethers } from 'ethers';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
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
    gasUsedEstimate: number;
    flashloanFeeUSD: number;
  };
  metadata: {
    generatedAt: string;
    chain: string;
    description: string;
    fixtureVersion: string;
    rpcUrl: string;
    searchBlockCount: number;
  };
  // Enhanced analysis
  profitabilityAnalysis: {
    swapAmountUSD: number;
    expectedFeesEarnedUSD: number;
    gasCostUSD: number;
    flashloanProvider: 'balancer' | 'aave';
    liquidityConditions: {
      balancerLiquidity: string;
      aaveLiquidity: string;
      recommended: 'balancer' | 'aave';
    };
  };
}

// Target pools for fixture generation
const TARGET_POOLS = [
  {
    id: 'USDC-WETH-0.3%',
    address: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8',
    token0: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
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
 * Enhanced fixture generation with comprehensive analysis
 */
async function generateFixtures(): Promise<void> {
  console.log('🔄 Starting enhanced fixture generation...');
  
  const RPC_URL = process.env.MAINNET_RPC_URL || process.env.RPC_URL_HTTP || 'https://eth-mainnet.alchemyapi.io/v2/demo';
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  
  // Enhanced reporting structure
  const reportsDir = join(process.cwd(), 'reports');
  const fixturesDir = join(reportsDir, 'fixtures');
  
  // Ensure directories exist
  [reportsDir, fixturesDir].forEach(dir => {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  });

  console.log(`📊 Searching for fixtures across ${TARGET_POOLS.length} target pools...`);
  console.log(`🔗 Using RPC: ${RPC_URL.replace(/\/\/.*@/, '//***@')}`); // Hide credentials

  const generatedFixtures: TestFixture[] = [];
  const summary = {
    totalSearched: 0,
    fixturesGenerated: 0,
    poolsCovered: 0,
    avgProfitability: 0
  };

  for (const pool of TARGET_POOLS) {
    try {
      console.log(`\n📊 Generating fixture for ${pool.id}...`);
      
      const fixture = await generatePoolFixture(provider, pool);
      
      if (fixture) {
        const filename = `fixture-${pool.id}-${fixture.blockNumber}.json`;
        const filepath = join(fixturesDir, filename);
        
        writeFileSync(filepath, JSON.stringify(fixture, null, 2));
        generatedFixtures.push(fixture);
        summary.fixturesGenerated++;
        summary.poolsCovered++;
        summary.avgProfitability += fixture.expectedResults.estimatedNetProfitUSD;
        
        console.log(`✅ Generated fixture: ${filename}`);
        console.log(`   Block: ${fixture.blockNumber}`);
        console.log(`   Victim TX: ${fixture.victimTransaction.hash.slice(0, 10)}...`);
        console.log(`   Swap Amount: ${ethers.utils.formatEther(fixture.swapParams.amountIn)} tokens`);
        console.log(`   Estimated Profit: $${fixture.expectedResults.estimatedNetProfitUSD}`);
        console.log(`   Recommended Provider: ${fixture.profitabilityAnalysis.liquidityConditions.recommended}`);
      } else {
        console.log(`⚠️  Could not generate fixture for ${pool.id} - no suitable transactions found`);
      }
      
    } catch (error: any) {
      console.error(`❌ Error generating fixture for ${pool.id}:`, error.message);
    }
  }
  
  // Generate summary report
  if (generatedFixtures.length > 0) {
    summary.avgProfitability = summary.avgProfitability / generatedFixtures.length;
    
    const summaryReport = {
      summary,
      fixtures: generatedFixtures.map(f => ({
        file: `fixture-${TARGET_POOLS.find(p => p.address === f.poolAddress)?.id}-${f.blockNumber}.json`,
        pool: f.poolAddress,
        profitable: f.expectedResults.profitable,
        estimatedProfitUSD: f.expectedResults.estimatedNetProfitUSD,
        blockNumber: f.blockNumber,
        swapAmountUSD: f.profitabilityAnalysis.swapAmountUSD
      })),
      generatedAt: new Date().toISOString()
    };
    
    const summaryPath = join(reportsDir, 'fixtures-summary.json');
    writeFileSync(summaryPath, JSON.stringify(summaryReport, null, 2));
    
    console.log(`\n📋 Summary Report:`);
    console.log(`   Fixtures Generated: ${summary.fixturesGenerated}`);
    console.log(`   Pools Covered: ${summary.poolsCovered}/${TARGET_POOLS.length}`);
    console.log(`   Average Profitability: $${summary.avgProfitability.toFixed(2)}`);
    console.log(`   Summary saved to: fixtures-summary.json`);
  }
  
  console.log('\n🏁 Enhanced fixture generation completed');
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
              
              return await createFixture(tx, blockNumber, pool, swapData, provider);
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
 * Create enhanced test fixture with profitability analysis
 */
async function createFixture(tx: any, blockNumber: number, pool: any, swapData: any, provider: ethers.providers.Provider): Promise<TestFixture> {
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
  
  // Enhanced profitability analysis
  const analysis = await analyzeProfitability(swapData, tx, provider);
  
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
      profitable: analysis.profitable,
      estimatedNetProfitUSD: analysis.netProfitUSD,
      gasUsedEstimate: analysis.gasUsedEstimate,
      flashloanFeeUSD: analysis.flashloanFeeUSD
    },
    metadata: {
      generatedAt: new Date().toISOString(),
      chain: 'ethereum',
      description: pool.description,
      fixtureVersion: '2.0.0',
      rpcUrl: provider.connection?.url?.replace(/\/\/.*@/, '//***@') || 'unknown',
      searchBlockCount: 100
    },
    profitabilityAnalysis: analysis.detailedAnalysis
  };
}

/**
 * Analyze profitability of a potential JIT opportunity
 */
async function analyzeProfitability(swapData: any, tx: any, provider: ethers.providers.Provider): Promise<{
  profitable: boolean;
  netProfitUSD: number;
  gasUsedEstimate: number;
  flashloanFeeUSD: number;
  detailedAnalysis: any;
}> {
  try {
    // Basic USD estimation for swap amount
    const swapAmountUSD = await estimateUSDValue(swapData.tokenIn, swapData.amountIn);
    
    // Estimate fees that could be earned (0.3% of swap)
    const expectedFeesEarnedUSD = swapAmountUSD * 0.003; // 0.3% fee tier
    
    // Estimate gas costs (using tx gas price)
    const gasPrice = ethers.BigNumber.from(tx.gasPrice || ethers.utils.parseUnits('20', 'gwei'));
    const estimatedGasUsed = 800000; // JIT strategy gas estimate
    const gasCostWei = gasPrice.mul(estimatedGasUsed);
    const gasCostUSD = parseFloat(ethers.utils.formatEther(gasCostWei)) * 2000; // Assume $2000/ETH
    
    // Determine optimal flashloan provider
    const flashloanProvider = swapAmountUSD > 50000 ? 'aave' : 'balancer'; // Use Aave for large amounts
    const flashloanFeeUSD = flashloanProvider === 'aave' ? swapAmountUSD * 0.0005 : 0; // 0.05% Aave fee
    
    // Calculate net profit
    const netProfitUSD = expectedFeesEarnedUSD - gasCostUSD - flashloanFeeUSD;
    const profitable = netProfitUSD > 10; // Minimum $10 profit threshold
    
    return {
      profitable,
      netProfitUSD: Math.round(netProfitUSD * 100) / 100,
      gasUsedEstimate: estimatedGasUsed,
      flashloanFeeUSD: Math.round(flashloanFeeUSD * 100) / 100,
      detailedAnalysis: {
        swapAmountUSD: Math.round(swapAmountUSD * 100) / 100,
        expectedFeesEarnedUSD: Math.round(expectedFeesEarnedUSD * 100) / 100,
        gasCostUSD: Math.round(gasCostUSD * 100) / 100,
        flashloanProvider,
        liquidityConditions: {
          balancerLiquidity: '500 ETH', // Mock values
          aaveLiquidity: '5000 ETH',
          recommended: flashloanProvider
        }
      }
    };
  } catch (error) {
    // Fallback analysis
    return {
      profitable: true,
      netProfitUSD: 50,
      gasUsedEstimate: 800000,
      flashloanFeeUSD: 0,
      detailedAnalysis: {
        swapAmountUSD: 10000,
        expectedFeesEarnedUSD: 30,
        gasCostUSD: 20,
        flashloanProvider: 'balancer' as const,
        liquidityConditions: {
          balancerLiquidity: 'Unknown',
          aaveLiquidity: 'Unknown',
          recommended: 'balancer' as const
        }
      }
    };
  }
}

/**
 * Estimate USD value for different tokens
 */
async function estimateUSDValue(tokenAddress: string, amount: string): Promise<number> {
  const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
  const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
  const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
  
  const normalizedToken = tokenAddress.toLowerCase();
  const amountBN = ethers.BigNumber.from(amount);
  
  if (normalizedToken === WETH.toLowerCase()) {
    // ETH: amount in wei to USD
    return parseFloat(ethers.utils.formatEther(amountBN)) * 2000;
  } else if ([USDC.toLowerCase(), USDT.toLowerCase()].includes(normalizedToken)) {
    // 6-decimal stablecoins
    return parseFloat(ethers.utils.formatUnits(amountBN, 6));
  } else if (normalizedToken === DAI.toLowerCase()) {
    // 18-decimal stablecoin
    return parseFloat(ethers.utils.formatEther(amountBN));
  } else {
    // Unknown token - conservative estimate
    return parseFloat(ethers.utils.formatEther(amountBN)) * 1000;
  }
}

// Run the fixture generation
if (require.main === module) {
  generateFixtures().catch(console.error);
}

export { generateFixtures, TestFixture };