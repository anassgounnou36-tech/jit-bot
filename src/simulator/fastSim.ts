import { ethers } from 'ethers';
import { getPoolState, estimateLiquidityInRange } from '../pool/stateFetcher';
import { calculateOptimalJitPosition, estimateFeesEarned } from '../lp/tickUtils';
import { getGasPriceGwei, JIT_GAS_CONSTANTS } from '../util/gasEstimator';
import { getPrice, ethToUsd } from '../price/oracle';

export interface FastSimulationParams {
  poolAddress: string;
  swapAmountIn: ethers.BigNumber;
  swapTokenIn: string;
  swapTokenOut: string;
  expectedPriceImpact?: number;
  liquidityRatio?: number; // Ratio of swap amount to use as liquidity
}

export interface FastSimulationResult {
  profitable: boolean;
  expectedNetProfitUsd: number;
  expectedNetProfitEth: ethers.BigNumber;
  
  // Breakdown
  grossFeesUsd: number;
  gasCostUsd: number;
  flashLoanCostUsd: number; // Always 0 in PR1
  
  // Position details
  optimalPosition: {
    tickLower: number;
    tickUpper: number;
    liquidity: ethers.BigNumber;
    amount0: ethers.BigNumber;
    amount1: ethers.BigNumber;
  };
  
  // Gas details
  gasEstimate: {
    gasPrice: ethers.BigNumber;
    gasUsed: number;
    gasCostEth: ethers.BigNumber;
  };
  
  // Pool state
  poolState: {
    currentTick: number;
    currentPrice: ethers.BigNumber;
    totalLiquidity: ethers.BigNumber;
  };
  
  reason?: string;
}

/**
 * Fast simulation of JIT strategy using oracle prices and gas estimates
 * This is a quick profitability check before running full fork simulation
 * @param params Simulation parameters
 * @returns Simulation result
 */
export async function fastSimulate(params: FastSimulationParams): Promise<FastSimulationResult> {
  try {
    // 1. Get current pool state
    const poolState = await getPoolState(params.poolAddress);
    
    // 2. Get current gas price
    const gasEstimate = await getGasPriceGwei();
    const gasCostEth = gasEstimate.gasPrice.mul(JIT_GAS_CONSTANTS.totalEstimate);
    
    // 3. Get ETH price for USD conversions
    const gasCostUsd = await ethToUsd(gasCostEth);
    
    // 4. Calculate optimal JIT position
    const liquidityRatio = params.liquidityRatio || 0.1; // Default 10%
    const rangeWidth = 10; // ±10 tick spacings around current price
    
    const tickLower = Math.floor((poolState.tick - rangeWidth * poolState.tickSpacing) / poolState.tickSpacing) * poolState.tickSpacing;
    const tickUpper = Math.ceil((poolState.tick + rangeWidth * poolState.tickSpacing) / poolState.tickSpacing) * poolState.tickSpacing;
    
    const optimalPosition = calculateOptimalJitPosition(
      params.swapAmountIn,
      tickLower,
      tickUpper,
      poolState.tick,
      liquidityRatio
    );
    
    // 5. Estimate fees earned
    const feeRate = poolState.fee; // Fee in basis points
    const grossFeesEth = estimateFeesEarned(params.swapAmountIn, feeRate);
    const grossFeesUsd = await ethToUsd(grossFeesEth);
    
    // 6. Flash loan cost (always 0 in PR1)
    const flashLoanCostUsd = 0;
    
    // 7. Calculate net profit
    const netProfitUsd = grossFeesUsd - gasCostUsd - flashLoanCostUsd;
    const netProfitEth = grossFeesEth.sub(gasCostEth);
    
    // 8. Determine profitability
    const profitable = netProfitUsd > 0;
    
    // 9. Get current price for context
    const currentPrice = ethers.BigNumber.from(poolState.sqrtPriceX96.toString())
      .mul(poolState.sqrtPriceX96)
      .div('79228162514264337593543950336') // 2^96
      .div('79228162514264337593543950336'); // 2^96
    
    return {
      profitable,
      expectedNetProfitUsd: netProfitUsd,
      expectedNetProfitEth: netProfitEth,
      
      grossFeesUsd,
      gasCostUsd,
      flashLoanCostUsd,
      
      optimalPosition,
      
      gasEstimate: {
        gasPrice: gasEstimate.gasPrice,
        gasUsed: JIT_GAS_CONSTANTS.totalEstimate,
        gasCostEth
      },
      
      poolState: {
        currentTick: poolState.tick,
        currentPrice,
        totalLiquidity: poolState.liquidity
      },
      
      reason: profitable ? 'Fast simulation indicates profitability' : 
              `Insufficient profit: $${netProfitUsd.toFixed(2)} (fees: $${grossFeesUsd.toFixed(2)}, gas: $${gasCostUsd.toFixed(2)})`
    };
    
  } catch (error: any) {
    return {
      profitable: false,
      expectedNetProfitUsd: 0,
      expectedNetProfitEth: ethers.BigNumber.from(0),
      
      grossFeesUsd: 0,
      gasCostUsd: 0,
      flashLoanCostUsd: 0,
      
      optimalPosition: {
        tickLower: 0,
        tickUpper: 0,
        liquidity: ethers.BigNumber.from(0),
        amount0: ethers.BigNumber.from(0),
        amount1: ethers.BigNumber.from(0)
      },
      
      gasEstimate: {
        gasPrice: ethers.BigNumber.from(0),
        gasUsed: 0,
        gasCostEth: ethers.BigNumber.from(0)
      },
      
      poolState: {
        currentTick: 0,
        currentPrice: ethers.BigNumber.from(0),
        totalLiquidity: ethers.BigNumber.from(0)
      },
      
      reason: `Fast simulation failed: ${error.message}`
    };
  }
}

/**
 * Fast profitability check without full simulation
 * @param params Simulation parameters
 * @param minProfitUsd Minimum profit threshold in USD
 * @returns True if likely profitable
 */
export async function quickProfitabilityCheck(
  params: FastSimulationParams,
  minProfitUsd: number = 10
): Promise<{ profitable: boolean; estimatedProfitUsd: number; reason: string }> {
  try {
    // Quick gas cost estimate
    const gasEstimate = await getGasPriceGwei();
    const gasCostEth = gasEstimate.gasPrice.mul(JIT_GAS_CONSTANTS.totalEstimate);
    const gasCostUsd = await ethToUsd(gasCostEth);
    
    // Quick fee estimate
    const poolState = await getPoolState(params.poolAddress);
    const feeRate = poolState.fee;
    const grossFeesEth = estimateFeesEarned(params.swapAmountIn, feeRate);
    const grossFeesUsd = await ethToUsd(grossFeesEth);
    
    const estimatedProfitUsd = grossFeesUsd - gasCostUsd;
    const profitable = estimatedProfitUsd >= minProfitUsd;
    
    return {
      profitable,
      estimatedProfitUsd,
      reason: profitable ? 
        `Quick check: $${estimatedProfitUsd.toFixed(2)} profit (≥ $${minProfitUsd} threshold)` :
        `Quick check: $${estimatedProfitUsd.toFixed(2)} profit (< $${minProfitUsd} threshold)`
    };
    
  } catch (error: any) {
    return {
      profitable: false,
      estimatedProfitUsd: 0,
      reason: `Quick check failed: ${error.message}`
    };
  }
}

/**
 * Calculate break-even swap size for given gas price
 * @param poolAddress Pool to analyze
 * @param gasPrice Gas price to use
 * @returns Minimum swap size for break-even
 */
export async function calculateBreakEvenSwapSize(
  poolAddress: string,
  gasPrice?: ethers.BigNumber
): Promise<{
  breakEvenSwapSizeEth: ethers.BigNumber;
  breakEvenSwapSizeUsd: number;
  feeRate: number;
  gasCostUsd: number;
}> {
  const poolState = await getPoolState(poolAddress);
  
  const gasEst = gasPrice ? 
    { gasPrice } : 
    await getGasPriceGwei();
  
  const gasCostEth = gasEst.gasPrice.mul(JIT_GAS_CONSTANTS.totalEstimate);
  const gasCostUsd = await ethToUsd(gasCostEth);
  
  const feeRate = poolState.fee;
  const feeRateDecimal = feeRate / 1000000; // Convert from basis points
  
  // Break-even: fee revenue = gas cost
  // fee revenue = swap_size * fee_rate * capture_ratio
  // Assume 10% capture ratio for JIT
  const captureRatio = 0.1;
  const effectiveFeeRate = feeRateDecimal * captureRatio;
  
  const breakEvenSwapSizeUsd = gasCostUsd / effectiveFeeRate;
  const breakEvenSwapSizeEth = await (async () => {
    const ethPrice = await getPrice('ETH');
    return ethers.utils.parseEther((breakEvenSwapSizeUsd / ethPrice.priceUsd).toString());
  })();
  
  return {
    breakEvenSwapSizeEth,
    breakEvenSwapSizeUsd,
    feeRate,
    gasCostUsd
  };
}

/**
 * Estimate maximum profitable position size
 * @param poolAddress Pool address
 * @param availableCapital Available capital for position
 * @returns Optimal position size and expected returns
 */
export async function estimateOptimalPositionSize(
  poolAddress: string,
  availableCapital: ethers.BigNumber
): Promise<{
  recommendedSize: ethers.BigNumber;
  expectedDailyYield: number;
  capitalUtilization: number;
  reason: string;
}> {
  try {
    const poolState = await getPoolState(poolAddress);
    const liquidityEstimate = await estimateLiquidityInRange(
      poolAddress,
      poolState.tick - 100,
      poolState.tick + 100
    );
    
    // Conservative sizing: use at most 50% of available capital
    const maxPosition = availableCapital.div(2);
    
    // Estimate based on pool liquidity
    const poolLiquidityFloat = parseFloat(ethers.utils.formatEther(liquidityEstimate.totalLiquidity));
    const availableCapitalFloat = parseFloat(ethers.utils.formatEther(availableCapital));
    
    // Don't exceed 1% of pool liquidity
    const maxByLiquidity = poolLiquidityFloat * 0.01;
    
    const recommendedFloat = Math.min(
      parseFloat(ethers.utils.formatEther(maxPosition)),
      maxByLiquidity
    );
    
    const recommendedSize = ethers.utils.parseEther(recommendedFloat.toString());
    const capitalUtilization = recommendedFloat / availableCapitalFloat;
    
    // Rough daily yield estimate (very approximate)
    const feeRate = poolState.fee / 1000000; // Convert to decimal
    const estimatedDailyVolume = poolLiquidityFloat * 0.1; // Assume 10% daily turnover
    const expectedDailyYield = (recommendedFloat * feeRate * estimatedDailyVolume / poolLiquidityFloat) * 100;
    
    return {
      recommendedSize,
      expectedDailyYield,
      capitalUtilization,
      reason: `Sized to ${(capitalUtilization * 100).toFixed(1)}% capital utilization, ≤1% of pool liquidity`
    };
    
  } catch (error: any) {
    return {
      recommendedSize: ethers.BigNumber.from(0),
      expectedDailyYield: 0,
      capitalUtilization: 0,
      reason: `Position sizing failed: ${error.message}`
    };
  }
}