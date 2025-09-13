import { BigNumber } from 'ethers';
import { computeTickRange, computeAmountsForLiquidity, getSqrtRatioAtTick } from '../lp/tickUtils';
import { stateFetcher, PoolState } from '../pool/stateFetcher';
import { gasEstimator } from '../util/gasEstimator';
import { priceOracle, SupportedToken } from '../price/oracle';
import { getPoolConfig, config } from '../config';
import { createLogger } from '../logging/logger';

const logger = createLogger('FastSim');

/**
 * Swap candidate information
 */
export interface SwapCandidate {
  hash: string;
  poolAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: BigNumber;
  amountOut: BigNumber;
  estimatedPrice: BigNumber;
  blockNumber?: number;
}

/**
 * Fast simulation result
 */
export interface FastSimResult {
  profitable: boolean;
  estimatedNetProfitUsd: number;
  grossFeeCapture: BigNumber;
  gasCostUsd: number;
  flashLoanCostUsd: number;
  lpShare: number;
  reason?: string;
  confidence: 'low' | 'medium' | 'high';
  breakdown: {
    totalLiquidity: BigNumber;
    estimatedLpLiquidity: BigNumber;
    feeRate: number;
    swapFeeUsd: number;
    lpFeeShareUsd: number;
  };
}

/**
 * Fast math-based simulator for quick profitability filtering
 * 
 * This provides quick estimates without on-chain simulation to filter
 * candidates before passing them to the more expensive forkSim
 */
export class FastSimulator {
  constructor() {
    logger.info('FastSimulator initialized');
  }

  /**
   * Quickly evaluate a swap candidate for profitability
   */
  async simulateOpportunity(candidate: SwapCandidate): Promise<FastSimResult> {
    const traceId = logger.newTrace();
    const contextLogger = traceId.logger;

    contextLogger.info('Starting fast simulation', {
      swapHash: candidate.hash,
      poolAddress: candidate.poolAddress,
      amountIn: candidate.amountIn.toString(),
    });

    try {
      // Step 1: Get pool configuration and state
      const poolConfig = getPoolConfig(candidate.poolAddress, config);
      if (!poolConfig) {
        throw new Error(`Pool configuration not found: ${candidate.poolAddress}`);
      }

      const poolState = await stateFetcher.getPoolState(candidate.poolAddress);
      
      contextLogger.debug('Pool data loaded', {
        currentTick: poolState.tick,
        liquidity: poolState.liquidity.toString(),
        feeTier: poolState.feeTier,
        tickSpacing: poolState.tickSpacing,
      });

      // Step 2: Calculate optimal LP position parameters
      const tickRange = computeTickRange(
        poolState.sqrtPriceX96,
        poolState.tickSpacing,
        config.configData.tickRangeWidth
      );

      contextLogger.debug('LP position calculated', {
        tickLower: tickRange.tickLower,
        tickUpper: tickRange.tickUpper,
        rangeWidth: config.configData.tickRangeWidth,
      });

      // Step 3: Estimate LP share of liquidity in the range
      const liquidityEstimate = await stateFetcher.estimateLiquidityInRange(
        candidate.poolAddress,
        tickRange.tickLower,
        tickRange.tickUpper
      );

      // Calculate how much liquidity we could provide relative to existing
      const maxLoanSizeEth = BigNumber.from(config.configData.maxLoanSize);
      const { amount0, amount1 } = computeAmountsForLiquidity(
        poolState.sqrtPriceX96,
        tickRange.tickLower,
        tickRange.tickUpper,
        maxLoanSizeEth.mul(BigNumber.from(10).pow(15)) // Use reasonable liquidity amount
      );

      // Estimate our liquidity share (simplified)
      const totalEstimatedLiquidity = liquidityEstimate.estimatedLiquidity.add(maxLoanSizeEth.div(2));
      const ourLiquidityShare = maxLoanSizeEth.div(2);
      const lpShare = totalEstimatedLiquidity.gt(0) 
        ? ourLiquidityShare.mul(10000).div(totalEstimatedLiquidity).toNumber() / 10000
        : 0;

      contextLogger.debug('Liquidity share estimated', {
        totalLiquidity: totalEstimatedLiquidity.toString(),
        ourLiquidity: ourLiquidityShare.toString(),
        lpShare: (lpShare * 100).toFixed(2) + '%',
        confidence: liquidityEstimate.confidence,
      });

      // Step 4: Calculate fee capture
      const feeRate = poolState.feeTier / 1000000; // Convert to decimal (e.g., 3000 -> 0.003)
      
      // Get USD value of the swap
      const tokenInSymbol = this.getTokenSymbol(candidate.tokenIn, poolConfig);
      const swapValueUsd = await this.getSwapValueUsd(
        candidate.amountIn,
        tokenInSymbol,
        poolConfig
      );

      const swapFeeUsd = swapValueUsd * feeRate;
      const lpFeeShareUsd = swapFeeUsd * lpShare;

      contextLogger.debug('Fee calculation', {
        swapValueUsd: swapValueUsd.toFixed(2),
        feeRate: (feeRate * 100).toFixed(3) + '%',
        swapFeeUsd: swapFeeUsd.toFixed(2),
        lpFeeShareUsd: lpFeeShareUsd.toFixed(2),
      });

      // Step 5: Estimate costs
      const gasEstimate = await gasEstimator.estimateGas('jit_full_cycle');
      const gasCostUsd = gasEstimate.estimatedCostUsd;
      
      // Flash loan cost (set to 0 for PR1 as specified)
      const flashLoanCostUsd = 0;

      // Step 6: Calculate net profit
      const totalCostsUsd = gasCostUsd + flashLoanCostUsd;
      const estimatedNetProfitUsd = lpFeeShareUsd - totalCostsUsd;
      
      const profitable = estimatedNetProfitUsd > 0 && 
                        estimatedNetProfitUsd >= config.globalMinProfitUsd;

      // Step 7: Determine confidence level
      let confidence: 'low' | 'medium' | 'high';
      if (liquidityEstimate.confidence === 'high' && lpShare > 0.1) {
        confidence = 'high';
      } else if (liquidityEstimate.confidence === 'medium' && lpShare > 0.05) {
        confidence = 'medium';
      } else {
        confidence = 'low';
      }

      const result: FastSimResult = {
        profitable,
        estimatedNetProfitUsd,
        grossFeeCapture: BigNumber.from(Math.floor(lpFeeShareUsd * 100)), // Convert to cents
        gasCostUsd,
        flashLoanCostUsd,
        lpShare,
        confidence,
        reason: profitable ? undefined : this.getDenialReason(estimatedNetProfitUsd, lpShare, liquidityEstimate.confidence),
        breakdown: {
          totalLiquidity: totalEstimatedLiquidity,
          estimatedLpLiquidity: ourLiquidityShare,
          feeRate,
          swapFeeUsd,
          lpFeeShareUsd,
        },
      };

      contextLogger.info('Fast simulation completed', {
        profitable,
        estimatedNetProfitUsd: estimatedNetProfitUsd.toFixed(2),
        confidence,
        lpShare: (lpShare * 100).toFixed(2) + '%',
        gasCostUsd: gasCostUsd.toFixed(2),
      });

      return result;

    } catch (error: any) {
      contextLogger.error('Fast simulation failed', {
        error: error.message,
        swapHash: candidate.hash,
      });

      // Return failed result
      return {
        profitable: false,
        estimatedNetProfitUsd: 0,
        grossFeeCapture: BigNumber.from(0),
        gasCostUsd: 0,
        flashLoanCostUsd: 0,
        lpShare: 0,
        confidence: 'low',
        reason: `Simulation error: ${error.message}`,
        breakdown: {
          totalLiquidity: BigNumber.from(0),
          estimatedLpLiquidity: BigNumber.from(0),
          feeRate: 0,
          swapFeeUsd: 0,
          lpFeeShareUsd: 0,
        },
      };
    }
  }

  /**
   * Get token symbol from address using pool config
   */
  private getTokenSymbol(tokenAddress: string, poolConfig: any): SupportedToken {
    const addr = tokenAddress.toLowerCase();
    
    if (addr === poolConfig.token0.toLowerCase()) {
      return this.mapSymbolToSupportedToken(poolConfig.symbol0);
    } else if (addr === poolConfig.token1.toLowerCase()) {
      return this.mapSymbolToSupportedToken(poolConfig.symbol1);
    }
    
    // Fallback to ETH if not found
    return SupportedToken.ETH;
  }

  /**
   * Map pool config symbols to our supported tokens
   */
  private mapSymbolToSupportedToken(symbol: string): SupportedToken {
    const symbolMap: { [key: string]: SupportedToken } = {
      'WETH': SupportedToken.ETH,
      'ETH': SupportedToken.ETH,
      'USDC': SupportedToken.USDC,
      'USDT': SupportedToken.USDT,
      'WBTC': SupportedToken.WBTC,
    };

    return symbolMap[symbol.toUpperCase()] || SupportedToken.ETH;
  }

  /**
   * Get USD value of a swap amount
   */
  private async getSwapValueUsd(
    amount: BigNumber,
    tokenSymbol: SupportedToken,
    poolConfig: any
  ): Promise<number> {
    try {
      // Determine token decimals
      const decimals = tokenSymbol === SupportedToken.ETH || tokenSymbol === SupportedToken.WBTC 
        ? 18 
        : 6; // USDC/USDT typically have 6 decimals

      const usdValue = await priceOracle.getUsdValue(tokenSymbol, amount, decimals);
      return parseFloat(usdValue.toString()) / 100000000; // Convert from 8 decimal USD to float

    } catch (error: any) {
      logger.warn('Failed to get USD value, using fallback', {
        tokenSymbol,
        error: error.message,
      });
      
      // Fallback calculation (very rough)
      const ethPrice = 2000; // $2000 ETH
      const amountEth = parseFloat(amount.toString()) / 1e18;
      return amountEth * ethPrice;
    }
  }

  /**
   * Get reason for denial
   */
  private getDenialReason(netProfitUsd: number, lpShare: number, confidence: string): string {
    if (netProfitUsd <= 0) {
      return `Negative profit: $${netProfitUsd.toFixed(2)}`;
    }
    
    if (netProfitUsd < config.globalMinProfitUsd) {
      return `Below minimum profit threshold: $${netProfitUsd.toFixed(2)} < $${config.globalMinProfitUsd}`;
    }
    
    if (lpShare < 0.01) {
      return `LP share too small: ${(lpShare * 100).toFixed(2)}%`;
    }
    
    if (confidence === 'low') {
      return `Low confidence estimate`;
    }
    
    return 'Unknown reason';
  }

  /**
   * Batch simulate multiple opportunities
   */
  async simulateMultiple(candidates: SwapCandidate[]): Promise<Map<string, FastSimResult>> {
    const results = new Map<string, FastSimResult>();
    
    logger.info('Starting batch fast simulation', {
      candidateCount: candidates.length,
    });

    // Process candidates concurrently (with reasonable limit)
    const concurrency = 5;
    for (let i = 0; i < candidates.length; i += concurrency) {
      const batch = candidates.slice(i, i + concurrency);
      
      const promises = batch.map(async (candidate) => {
        try {
          const result = await this.simulateOpportunity(candidate);
          return { hash: candidate.hash, result };
        } catch (error: any) {
          logger.error('Batch simulation failed for candidate', {
            hash: candidate.hash,
            error: error.message,
          });
          return null;
        }
      });

      const outcomes = await Promise.all(promises);
      
      outcomes.forEach((outcome) => {
        if (outcome) {
          results.set(outcome.hash, outcome.result);
        }
      });
    }

    const profitable = Array.from(results.values()).filter(r => r.profitable).length;

    logger.info('Batch fast simulation completed', {
      total: candidates.length,
      processed: results.size,
      profitable,
      profitableRate: ((profitable / results.size) * 100).toFixed(1) + '%',
    });

    return results;
  }

  /**
   * Get simulation statistics
   */
  getStats(): any {
    return {
      component: 'FastSimulator',
      description: 'Quick math-based profitability filter',
      features: [
        'LP share estimation',
        'Fee capture calculation',
        'Gas cost integration',
        'Oracle price integration',
        'Confidence scoring',
      ],
      limitations: [
        'Simplified liquidity distribution model',
        'No slippage calculation',
        'No MEV competition modeling',
        'Flash loan costs set to 0 in PR1',
      ],
    };
  }
}

// Export singleton instance
export const fastSimulator = new FastSimulator();