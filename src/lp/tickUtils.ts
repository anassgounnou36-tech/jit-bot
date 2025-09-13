import { BigNumber } from 'ethers';

/**
 * Uniswap V3 tick utilities using accurate math
 * Based on Uniswap V3 core libraries for precise calculations
 */

// Constants from Uniswap V3
const MIN_TICK = -887272;
const MAX_TICK = 887272;
const Q96 = BigNumber.from(2).pow(96);
const Q128 = BigNumber.from(2).pow(128);

/**
 * Calculate price from sqrtPriceX96
 */
export function sqrtPriceX96ToPrice(sqrtPriceX96: BigNumber, decimals0: number, decimals1: number): BigNumber {
  const price = sqrtPriceX96.mul(sqrtPriceX96).div(Q96);
  
  // Adjust for token decimals
  const decimalAdjustment = BigNumber.from(10).pow(decimals1 - decimals0);
  return price.mul(decimalAdjustment).div(Q96);
}

/**
 * Calculate sqrtPriceX96 from price
 */
export function priceToSqrtPriceX96(price: BigNumber, decimals0: number, decimals1: number): BigNumber {
  // Adjust for token decimals
  const decimalAdjustment = BigNumber.from(10).pow(decimals0 - decimals1);
  const adjustedPrice = price.mul(decimalAdjustment);
  
  // Calculate sqrt(price * 2^192)
  const sqrtPrice = sqrt(adjustedPrice.mul(Q96).mul(Q96));
  return sqrtPrice;
}

/**
 * Calculate tick from sqrtPriceX96
 * Based on TickMath.getTickAtSqrtRatio from Uniswap V3 core
 */
export function getTickAtSqrtRatio(sqrtPriceX96: BigNumber): number {
  if (sqrtPriceX96.lt(BigNumber.from('4295128739')) || sqrtPriceX96.gte(BigNumber.from('1461446703485210103287273052203988822378723970342'))) {
    throw new Error('R');
  }

  let ratio = sqrtPriceX96.shl(32);
  
  let r = ratio;
  let msb = 0;

  let f = r.gt(BigNumber.from('0xffffffffffffffffffffffffffffffff')) ? 1 : 0;
  msb = msb | (f << 7);
  r = r.shr(f << 7);

  f = r.gt(BigNumber.from('0xffffffffffffffff')) ? 1 : 0;
  msb = msb | (f << 6);
  r = r.shr(f << 6);

  f = r.gt(BigNumber.from('0xffffffff')) ? 1 : 0;
  msb = msb | (f << 5);
  r = r.shr(f << 5);

  f = r.gt(BigNumber.from('0xffff')) ? 1 : 0;
  msb = msb | (f << 4);
  r = r.shr(f << 4);

  f = r.gt(BigNumber.from('0xff')) ? 1 : 0;
  msb = msb | (f << 3);
  r = r.shr(f << 3);

  f = r.gt(BigNumber.from('0xf')) ? 1 : 0;
  msb = msb | (f << 2);
  r = r.shr(f << 2);

  f = r.gt(BigNumber.from('0x3')) ? 1 : 0;
  msb = msb | (f << 1);
  r = r.shr(f << 1);

  f = r.gt(BigNumber.from('0x1')) ? 1 : 0;
  msb = msb | f;

  if (msb >= 128) r = ratio.shr(msb - 127);
  else r = ratio.shl(127 - msb);

  let log_2 = (BigNumber.from(msb).sub(128)).shl(64);

  for (let i = 0; i < 14; i++) {
    r = r.mul(r).shr(127);
    f = r.shr(128);
    log_2 = log_2.or(BigNumber.from(f).shl(63 - i));
    r = r.shr(f);
  }

  const log_sqrt10001 = log_2.mul(BigNumber.from('255738958999603826347141'));

  const tickLow = log_sqrt10001.sub(BigNumber.from('3402992956809132418596140100660247210')).shr(128);
  const tickHi = log_sqrt10001.add(BigNumber.from('291339464771989622907027621153398088495')).shr(128);

  const tick = tickLow.eq(tickHi) ? tickLow.toNumber() : (getSqrtRatioAtTick(tickHi.toNumber()).lte(sqrtPriceX96) ? tickHi.toNumber() : tickLow.toNumber());
  
  return tick;
}

/**
 * Calculate sqrtPriceX96 from tick
 * Based on TickMath.getSqrtRatioAtTick from Uniswap V3 core
 */
export function getSqrtRatioAtTick(tick: number): BigNumber {
  if (tick < MIN_TICK || tick > MAX_TICK) {
    throw new Error('T');
  }

  const absTick = tick < 0 ? -tick : tick;

  let ratio = (absTick & 0x1) !== 0 
    ? BigNumber.from('0xfffcb933bd6fad37aa2d162d1a594001')
    : BigNumber.from('0x100000000000000000000000000000000');

  if ((absTick & 0x2) !== 0) ratio = ratio.mul(BigNumber.from('0xfff97272373d413259a46990580e213a')).shr(128);
  if ((absTick & 0x4) !== 0) ratio = ratio.mul(BigNumber.from('0xfff2e50f5f656932ef12357cf3c7fdcc')).shr(128);
  if ((absTick & 0x8) !== 0) ratio = ratio.mul(BigNumber.from('0xffe5caca7e10e4e61c3624eaa0941cd0')).shr(128);
  if ((absTick & 0x10) !== 0) ratio = ratio.mul(BigNumber.from('0xffcb9843d60f6159c9db58835c926644')).shr(128);
  if ((absTick & 0x20) !== 0) ratio = ratio.mul(BigNumber.from('0xff973b41fa98c081472e6896dfb254c0')).shr(128);
  if ((absTick & 0x40) !== 0) ratio = ratio.mul(BigNumber.from('0xff2ea16466c96a3843ec78b326b52861')).shr(128);
  if ((absTick & 0x80) !== 0) ratio = ratio.mul(BigNumber.from('0xfe5dee046a99a2a811c461f1969c3053')).shr(128);
  if ((absTick & 0x100) !== 0) ratio = ratio.mul(BigNumber.from('0xfcbe86c7900a88aedcffc83b479aa3a4')).shr(128);
  if ((absTick & 0x200) !== 0) ratio = ratio.mul(BigNumber.from('0xf987a7253ac413176f2b074cf7815e54')).shr(128);
  if ((absTick & 0x400) !== 0) ratio = ratio.mul(BigNumber.from('0xf3392b0822b70005940c7a398e4b70f3')).shr(128);
  if ((absTick & 0x800) !== 0) ratio = ratio.mul(BigNumber.from('0xe7159475a2c29b7443b29c7fa6e889d9')).shr(128);
  if ((absTick & 0x1000) !== 0) ratio = ratio.mul(BigNumber.from('0xd097f3bdfd2022b8845ad8f792aa5825')).shr(128);
  if ((absTick & 0x2000) !== 0) ratio = ratio.mul(BigNumber.from('0xa9f746462d870fdf8a65dc1f90e061e5')).shr(128);
  if ((absTick & 0x4000) !== 0) ratio = ratio.mul(BigNumber.from('0x70d869a156d2a1b890bb3df62baf32f7')).shr(128);
  if ((absTick & 0x8000) !== 0) ratio = ratio.mul(BigNumber.from('0x31be135f97d08fd981231505542fcfa6')).shr(128);
  if ((absTick & 0x10000) !== 0) ratio = ratio.mul(BigNumber.from('0x9aa508b5b7a84e1c677de54f3e99bc9')).shr(128);
  if ((absTick & 0x20000) !== 0) ratio = ratio.mul(BigNumber.from('0x5d6af8dedb81196699c329225ee604')).shr(128);
  if ((absTick & 0x40000) !== 0) ratio = ratio.mul(BigNumber.from('0x2216e584f5fa1ea926041bedfe98')).shr(128);
  if ((absTick & 0x80000) !== 0) ratio = ratio.mul(BigNumber.from('0x48a170391f7dc42444e8fa2')).shr(128);

  if (tick > 0) ratio = BigNumber.from(2).pow(256).sub(1).div(ratio);

  return ratio.shr(32).add(ratio.mod(BigNumber.from(1).shl(32)).eq(0) ? 0 : 1);
}

/**
 * Compute optimal tick range for LP position
 */
export function computeTickRange(
  sqrtPriceX96: BigNumber,
  tickSpacing: number,
  rangeWidthInTicks: number
): { tickLower: number; tickUpper: number } {
  const currentTick = getTickAtSqrtRatio(sqrtPriceX96);
  
  // Calculate range bounds
  const halfRange = Math.floor(rangeWidthInTicks / 2);
  let tickLower = currentTick - halfRange;
  let tickUpper = currentTick + halfRange;
  
  // Align to tick spacing
  tickLower = Math.floor(tickLower / tickSpacing) * tickSpacing;
  tickUpper = Math.ceil(tickUpper / tickSpacing) * tickSpacing;
  
  // Ensure within bounds
  tickLower = Math.max(tickLower, MIN_TICK);
  tickUpper = Math.min(tickUpper, MAX_TICK);
  
  // Ensure tickLower < tickUpper
  if (tickLower >= tickUpper) {
    tickUpper = tickLower + tickSpacing;
  }
  
  return { tickLower, tickUpper };
}

/**
 * Calculate liquidity amount for a given amount of token0
 */
export function computeLiquidityForAmount0(
  sqrtPriceX96: BigNumber,
  tickLower: number,
  tickUpper: number,
  amount0: BigNumber
): BigNumber {
  const sqrtRatioAX96 = getSqrtRatioAtTick(tickLower);
  const sqrtRatioBX96 = getSqrtRatioAtTick(tickUpper);
  
  if (sqrtPriceX96.lte(sqrtRatioAX96)) {
    // Price below range, only token0 needed
    return amount0.mul(sqrtRatioAX96).mul(sqrtRatioBX96).div(sqrtRatioBX96.sub(sqrtRatioAX96)).div(Q96);
  } else if (sqrtPriceX96.gte(sqrtRatioBX96)) {
    // Price above range, no token0 needed
    return BigNumber.from(0);
  } else {
    // Price in range
    return amount0.mul(sqrtPriceX96).mul(sqrtRatioBX96).div(sqrtRatioBX96.sub(sqrtPriceX96)).div(Q96);
  }
}

/**
 * Calculate liquidity amount for a given amount of token1
 */
export function computeLiquidityForAmount1(
  sqrtPriceX96: BigNumber,
  tickLower: number,
  tickUpper: number,
  amount1: BigNumber
): BigNumber {
  const sqrtRatioAX96 = getSqrtRatioAtTick(tickLower);
  const sqrtRatioBX96 = getSqrtRatioAtTick(tickUpper);
  
  if (sqrtPriceX96.lte(sqrtRatioAX96)) {
    // Price below range, no token1 needed
    return BigNumber.from(0);
  } else if (sqrtPriceX96.gte(sqrtRatioBX96)) {
    // Price above range, only token1 needed
    return amount1.mul(Q96).div(sqrtRatioBX96.sub(sqrtRatioAX96));
  } else {
    // Price in range
    return amount1.mul(Q96).div(sqrtPriceX96.sub(sqrtRatioAX96));
  }
}

/**
 * Calculate token amounts for a given liquidity amount
 */
export function computeAmountsForLiquidity(
  sqrtPriceX96: BigNumber,
  tickLower: number,
  tickUpper: number,
  liquidity: BigNumber
): { amount0: BigNumber; amount1: BigNumber } {
  const sqrtRatioAX96 = getSqrtRatioAtTick(tickLower);
  const sqrtRatioBX96 = getSqrtRatioAtTick(tickUpper);
  
  let amount0 = BigNumber.from(0);
  let amount1 = BigNumber.from(0);
  
  if (sqrtPriceX96.lte(sqrtRatioAX96)) {
    // Price below range, only token0
    amount0 = liquidity.mul(sqrtRatioBX96.sub(sqrtRatioAX96)).mul(Q96).div(sqrtRatioAX96).div(sqrtRatioBX96);
  } else if (sqrtPriceX96.gte(sqrtRatioBX96)) {
    // Price above range, only token1
    amount1 = liquidity.mul(sqrtRatioBX96.sub(sqrtRatioAX96)).div(Q96);
  } else {
    // Price in range, both tokens
    amount0 = liquidity.mul(sqrtRatioBX96.sub(sqrtPriceX96)).mul(Q96).div(sqrtPriceX96).div(sqrtRatioBX96);
    amount1 = liquidity.mul(sqrtPriceX96.sub(sqrtRatioAX96)).div(Q96);
  }
  
  return { amount0, amount1 };
}

/**
 * Helper function to calculate integer square root
 */
function sqrt(value: BigNumber): BigNumber {
  if (value.isZero()) {
    return BigNumber.from(0);
  }
  
  if (value.lt(4)) {
    return BigNumber.from(1);
  }
  
  let z = value;
  let x = value.div(2).add(1);
  
  while (x.lt(z)) {
    z = x;
    x = value.div(x).add(x).div(2);
  }
  
  return z;
}

/**
 * Validate tick is aligned to tick spacing
 */
export function validateTickSpacing(tick: number, tickSpacing: number): boolean {
  return tick % tickSpacing === 0;
}

/**
 * Round tick to nearest valid tick for the given spacing
 */
export function alignTickToSpacing(tick: number, tickSpacing: number): number {
  return Math.round(tick / tickSpacing) * tickSpacing;
}

/**
 * Calculate the optimal liquidity amount given a total value and price range
 */
export function calculateOptimalLiquidity(
  sqrtPriceX96: BigNumber,
  tickLower: number,
  tickUpper: number,
  totalValue: BigNumber,
  token0Price: BigNumber,
  token1Price: BigNumber
): BigNumber {
  const { amount0, amount1 } = computeAmountsForLiquidity(
    sqrtPriceX96,
    tickLower,
    tickUpper,
    BigNumber.from(10).pow(18) // Use 1e18 as base liquidity
  );
  
  // Calculate value per unit liquidity
  const valuePerLiquidity = amount0.mul(token0Price).add(amount1.mul(token1Price));
  
  if (valuePerLiquidity.isZero()) {
    return BigNumber.from(0);
  }
  
  // Scale to target total value
  return totalValue.mul(BigNumber.from(10).pow(18)).div(valuePerLiquidity);
}