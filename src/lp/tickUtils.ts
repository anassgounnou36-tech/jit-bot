import { ethers } from 'ethers';

/**
 * Utility functions for Uniswap V3 tick calculations and LP position management
 * Wraps the @uniswap/v3-sdk math libraries for easier use
 */

export interface TickRange {
  tickLower: number;
  tickUpper: number;
}

export interface LiquidityAmounts {
  amount0: ethers.BigNumber;
  amount1: ethers.BigNumber;
  liquidity: ethers.BigNumber;
}

export interface PositionInfo {
  tickLower: number;
  tickUpper: number;
  liquidity: ethers.BigNumber;
  amount0: ethers.BigNumber;
  amount1: ethers.BigNumber;
}

/**
 * Convert price to tick (simplified for testing)
 * @param price The price as a BigNumber (token1/token0)
 * @returns The corresponding tick
 */
export function priceToTick(price: ethers.BigNumber): number {
  // Simplified tick calculation for testing
  // In a real implementation, this would use the exact Uniswap V3 math
  const priceFloat = parseFloat(ethers.utils.formatEther(price));
  // Use log base 1.0001 to get tick
  return Math.floor(Math.log(priceFloat) / Math.log(1.0001));
}

/**
 * Convert tick to price (simplified for testing)
 * @param tick The tick
 * @returns The price as a BigNumber
 */
export function tickToPrice(tick: number): ethers.BigNumber {
  // Simplified price calculation for testing
  // price = 1.0001^tick
  const priceFloat = Math.pow(1.0001, tick);
  return ethers.utils.parseEther(priceFloat.toString());
}

/**
 * Convert price to sqrt price X96
 * @param price The price as a BigNumber
 * @returns The sqrt price X96
 */
export function priceToSqrtPriceX96(price: ethers.BigNumber): ethers.BigNumber {
  // price = (sqrtPriceX96 / 2^96)^2
  // sqrtPriceX96 = sqrt(price) * 2^96
  
  // Simple square root approximation for BigNumber
  // For production, consider using a more precise sqrt implementation
  const priceFloat = parseFloat(ethers.utils.formatEther(price));
  const sqrtFloat = Math.sqrt(priceFloat);
  const Q96 = ethers.BigNumber.from('79228162514264337593543950336'); // 2^96
  
  return ethers.utils.parseEther(sqrtFloat.toString()).mul(Q96).div(ethers.utils.parseEther('1'));
}

/**
 * Convert sqrt price X96 to price
 * @param sqrtPriceX96 The sqrt price X96
 * @returns The price as a BigNumber
 */
export function sqrtPriceX96ToPrice(sqrtPriceX96: ethers.BigNumber): ethers.BigNumber {
  const Q96 = ethers.BigNumber.from('79228162514264337593543950336'); // 2^96
  const priceX192 = sqrtPriceX96.mul(sqrtPriceX96);
  return priceX192.div(Q96).div(Q96);
}

/**
 * Calculate optimal tick range around current price
 * @param currentTick Current pool tick
 * @param tickSpacing Pool tick spacing
 * @param rangeWidth Range width in tick spacings (e.g., 10 = ±10 tick spacings)
 * @returns Tick range aligned to tick spacing
 */
export function calculateTickRange(
  currentTick: number,
  tickSpacing: number,
  rangeWidth: number = 10
): TickRange {
  const tickRange = rangeWidth * tickSpacing;
  
  // Calculate raw range
  const rawTickLower = currentTick - tickRange;
  const rawTickUpper = currentTick + tickRange;
  
  // Align to tick spacing
  const tickLower = Math.floor(rawTickLower / tickSpacing) * tickSpacing;
  const tickUpper = Math.ceil(rawTickUpper / tickSpacing) * tickSpacing;
  
  return { tickLower, tickUpper };
}

/**
 * Calculate liquidity for a given token amounts and price range
 * @param amount0 Amount of token0
 * @param amount1 Amount of token1
 * @param tickLower Lower tick of the range
 * @param tickUpper Upper tick of the range
 * @param currentTick Current pool tick
 * @returns The calculated liquidity
 */
export function getLiquidityForAmounts(
  amount0: ethers.BigNumber,
  amount1: ethers.BigNumber,
  tickLower: number,
  tickUpper: number,
  currentTick: number
): ethers.BigNumber {
  // Simplified liquidity calculation
  // In a full implementation, this would use the exact Uniswap V3 math
  // TODO: Use precise Uniswap V3 math with tickLower, tickUpper, currentTick
  
  const amount0Float = parseFloat(ethers.utils.formatEther(amount0));
  const amount1Float = parseFloat(ethers.utils.formatEther(amount1));
  
  // Simple geometric mean as liquidity approximation
  const liquidity = Math.sqrt(amount0Float * amount1Float);
  
  // Adjust based on tick range and current position
  const tickRange = tickUpper - tickLower;
  const tickPosition = Math.max(0, Math.min(1, (currentTick - tickLower) / tickRange));
  const adjustment = Math.sqrt(tickRange / 1000) * (1 + tickPosition); // Factor in current position
  
  return ethers.utils.parseEther((liquidity * adjustment).toString());
}

/**
 * Calculate token amounts for a given liquidity and price range
 * @param liquidity The liquidity amount
 * @param tickLower Lower tick of the range
 * @param tickUpper Upper tick of the range
 * @param currentTick Current pool tick
 * @returns Token amounts required
 */
export function getAmountsForLiquidity(
  liquidity: ethers.BigNumber,
  tickLower: number,
  tickUpper: number,
  currentTick: number
): LiquidityAmounts {
  // Simplified amounts calculation
  // In a full implementation, this would use the exact Uniswap V3 math
  
  const liquidityFloat = parseFloat(ethers.utils.formatEther(liquidity));
  
  // Basic approximation: split liquidity based on current tick position within range
  const tickRange = tickUpper - tickLower;
  const tickPosition = currentTick - tickLower;
  const positionRatio = Math.max(0, Math.min(1, tickPosition / tickRange));
  
  // More token1 needed when price is lower (tick position closer to lower)
  const amount0Ratio = positionRatio;
  const amount1Ratio = 1 - positionRatio;
  
  const amount0 = ethers.utils.parseEther((liquidityFloat * amount0Ratio).toString());
  const amount1 = ethers.utils.parseEther((liquidityFloat * amount1Ratio).toString());
  
  return {
    amount0,
    amount1,
    liquidity
  };
}

/**
 * Calculate optimal liquidity for JIT position based on swap size
 * @param swapAmount The expected swap amount
 * @param tickLower Lower tick of the position
 * @param tickUpper Upper tick of the position
 * @param currentTick Current pool tick
 * @param liquidityRatio Ratio of swap amount to use as liquidity (e.g., 0.1 = 10%)
 * @returns Optimal position info
 */
export function calculateOptimalJitPosition(
  swapAmount: ethers.BigNumber,
  tickLower: number,
  tickUpper: number,
  currentTick: number,
  liquidityRatio: number = 0.1
): PositionInfo {
  // Calculate target liquidity amount based on swap size
  const targetAmount = swapAmount.mul(Math.floor(liquidityRatio * 100)).div(100);
  
  // For JIT, we typically want to provide liquidity in both tokens
  // Split the target amount between token0 and token1
  const amount0 = targetAmount.div(2);
  const amount1 = targetAmount.div(2);
  
  // Calculate the liquidity for these amounts
  const liquidity = getLiquidityForAmounts(
    amount0,
    amount1,
    tickLower,
    tickUpper,
    currentTick
  );
  
  // Get the actual amounts needed for this liquidity
  const actualAmounts = getAmountsForLiquidity(
    liquidity,
    tickLower,
    tickUpper,
    currentTick
  );
  
  return {
    tickLower,
    tickUpper,
    liquidity,
    amount0: actualAmounts.amount0,
    amount1: actualAmounts.amount1
  };
}

/**
 * Validate tick range
 * @param tickLower Lower tick
 * @param tickUpper Upper tick
 * @param tickSpacing Pool tick spacing
 * @returns True if valid
 */
export function validateTickRange(
  tickLower: number,
  tickUpper: number,
  tickSpacing: number
): boolean {
  // Check basic constraints
  if (tickLower >= tickUpper) {
    return false;
  }
  
  // Check tick spacing alignment
  if (tickLower % tickSpacing !== 0 || tickUpper % tickSpacing !== 0) {
    return false;
  }
  
  // Check tick bounds (Uniswap V3 limits)
  const MIN_TICK = -887272;
  const MAX_TICK = 887272;
  
  if (tickLower < MIN_TICK || tickUpper > MAX_TICK) {
    return false;
  }
  
  return true;
}

/**
 * Estimate fees earned from providing liquidity
 * @param swapVolume Volume of swaps through the range
 * @param feeRate Pool fee rate (e.g., 3000 for 0.3%)
 * @returns Estimated fees earned
 */
export function estimateFeesEarned(
  swapVolume: ethers.BigNumber,
  feeRate: number
): ethers.BigNumber {
  // Simplified fee calculation
  // In reality, this would be more complex based on the specific price range
  const feeAmount = swapVolume.mul(feeRate).div(1000000); // Convert from basis points
  
  // Return the total fee amount (actual distribution would depend on liquidity share)
  return feeAmount;
}

/**
 * Calculate price impact for a swap
 * @param amountIn Amount being swapped
 * @param poolLiquidity Current pool liquidity
 * @returns Estimated price impact as a percentage
 */
export function estimatePriceImpact(
  amountIn: ethers.BigNumber,
  poolLiquidity: ethers.BigNumber
): number {
  // Simplified price impact calculation
  // This is an approximation - real calculation would use Uniswap's exact math
  
  const liquidityFloat = parseFloat(ethers.utils.formatEther(poolLiquidity));
  const amountFloat = parseFloat(ethers.utils.formatEther(amountIn));
  
  // Basic price impact formula: impact ≈ amount / liquidity
  const priceImpact = amountFloat / liquidityFloat;
  
  // Return as percentage
  return Math.min(priceImpact * 100, 100); // Cap at 100%
}

/**
 * Check if current price is within position range
 * @param currentTick Current pool tick
 * @param tickLower Position lower tick
 * @param tickUpper Position upper tick
 * @returns True if in range
 */
export function isTickInRange(
  currentTick: number,
  tickLower: number,
  tickUpper: number
): boolean {
  return currentTick >= tickLower && currentTick <= tickUpper;
}