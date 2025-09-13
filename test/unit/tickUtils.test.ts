import { expect } from 'chai';
import { BigNumber } from 'ethers';
import {
  computeTickRange,
  getSqrtRatioAtTick,
  getTickAtSqrtRatio,
  computeLiquidityForAmount0,
  computeLiquidityForAmount1,
  computeAmountsForLiquidity,
  validateTickSpacing,
  alignTickToSpacing,
} from '../../src/lp/tickUtils';

describe('TickUtils', () => {
  describe('Tick and Price Conversion', () => {
    it('should convert tick to sqrtPriceX96 and back correctly', () => {
      const testTicks = [-1000, -100, 0, 100, 1000];
      
      testTicks.forEach(tick => {
        const sqrtPriceX96 = getSqrtRatioAtTick(tick);
        const convertedTick = getTickAtSqrtRatio(sqrtPriceX96);
        
        // Should be within 1 tick due to rounding
        expect(Math.abs(convertedTick - tick)).to.be.lessThanOrEqual(1);
      });
    });

    it('should handle boundary tick values', () => {
      const minTick = -887272;
      const maxTick = 887272;
      
      const minSqrtPrice = getSqrtRatioAtTick(minTick);
      const maxSqrtPrice = getSqrtRatioAtTick(maxTick);
      
      expect(minSqrtPrice.gt(0)).to.be.true;
      expect(maxSqrtPrice.gt(minSqrtPrice)).to.be.true;
    });

    it('should throw on invalid tick values', () => {
      expect(() => getSqrtRatioAtTick(-1000000)).to.throw();
      expect(() => getSqrtRatioAtTick(1000000)).to.throw();
    });
  });

  describe('Tick Range Computation', () => {
    it('should compute valid tick ranges', () => {
      const sqrtPriceX96 = getSqrtRatioAtTick(0); // Price at tick 0
      const tickSpacing = 60;
      const rangeWidth = 120;
      
      const range = computeTickRange(sqrtPriceX96, tickSpacing, rangeWidth);
      
      expect(range.tickLower).to.be.lessThan(range.tickUpper);
      expect(range.tickLower % tickSpacing).to.equal(0);
      expect(range.tickUpper % tickSpacing).to.equal(0);
    });

    it('should handle different tick spacings', () => {
      const sqrtPriceX96 = getSqrtRatioAtTick(1000);
      const spacings = [10, 60, 200];
      
      spacings.forEach(spacing => {
        const range = computeTickRange(sqrtPriceX96, spacing, 100);
        
        expect(range.tickLower % spacing).to.equal(0);
        expect(range.tickUpper % spacing).to.equal(0);
        expect(range.tickLower).to.be.lessThan(range.tickUpper);
      });
    });

    it('should center range around current tick', () => {
      const currentTick = 1200;
      const sqrtPriceX96 = getSqrtRatioAtTick(currentTick);
      const tickSpacing = 60;
      const rangeWidth = 240; // 4 * tickSpacing
      
      const range = computeTickRange(sqrtPriceX96, tickSpacing, rangeWidth);
      
      // Range should be roughly centered around current tick
      const midpoint = (range.tickLower + range.tickUpper) / 2;
      expect(Math.abs(midpoint - currentTick)).to.be.lessThanOrEqual(tickSpacing);
    });
  });

  describe('Liquidity Calculations', () => {
    it('should calculate liquidity for amount0 correctly', () => {
      const sqrtPriceX96 = getSqrtRatioAtTick(0);
      const tickLower = -1000;
      const tickUpper = 1000;
      const amount0 = BigNumber.from('1000000000000000000'); // 1 token
      
      const liquidity = computeLiquidityForAmount0(sqrtPriceX96, tickLower, tickUpper, amount0);
      
      expect(liquidity.gt(0)).to.be.true;
    });

    it('should calculate liquidity for amount1 correctly', () => {
      const sqrtPriceX96 = getSqrtRatioAtTick(0);
      const tickLower = -1000;
      const tickUpper = 1000;
      const amount1 = BigNumber.from('1000000000000000000'); // 1 token
      
      const liquidity = computeLiquidityForAmount1(sqrtPriceX96, tickLower, tickUpper, amount1);
      
      expect(liquidity.gt(0)).to.be.true;
    });

    it('should compute amounts for liquidity correctly', () => {
      const sqrtPriceX96 = getSqrtRatioAtTick(0);
      const tickLower = -1000;
      const tickUpper = 1000;
      const liquidity = BigNumber.from('1000000000000000000'); // 1e18
      
      const amounts = computeAmountsForLiquidity(sqrtPriceX96, tickLower, tickUpper, liquidity);
      
      expect(amounts.amount0.gte(0)).to.be.true;
      expect(amounts.amount1.gte(0)).to.be.true;
      
      // For a range around the current price, both amounts should be positive
      expect(amounts.amount0.gt(0)).to.be.true;
      expect(amounts.amount1.gt(0)).to.be.true;
    });

    it('should handle price outside range correctly', () => {
      const tickLower = 1000;
      const tickUpper = 2000;
      
      // Price below range
      const sqrtPriceBelowRange = getSqrtRatioAtTick(500);
      const liquidity = BigNumber.from('1000000000000000000');
      
      const amountsBelowRange = computeAmountsForLiquidity(
        sqrtPriceBelowRange,
        tickLower,
        tickUpper,
        liquidity
      );
      
      // Should only need token0 when price is below range
      expect(amountsBelowRange.amount0.gt(0)).to.be.true;
      expect(amountsBelowRange.amount1.eq(0)).to.be.true;
      
      // Price above range
      const sqrtPriceAboveRange = getSqrtRatioAtTick(3000);
      
      const amountsAboveRange = computeAmountsForLiquidity(
        sqrtPriceAboveRange,
        tickLower,
        tickUpper,
        liquidity
      );
      
      // Should only need token1 when price is above range
      expect(amountsAboveRange.amount0.eq(0)).to.be.true;
      expect(amountsAboveRange.amount1.gt(0)).to.be.true;
    });
  });

  describe('Round Trip Tests', () => {
    it('should maintain consistency in liquidity calculations', () => {
      const sqrtPriceX96 = getSqrtRatioAtTick(0);
      const tickLower = -600;
      const tickUpper = 600;
      const initialAmount0 = BigNumber.from('1000000000000000000'); // 1 token
      
      // Calculate liquidity from amount0
      const liquidity = computeLiquidityForAmount0(sqrtPriceX96, tickLower, tickUpper, initialAmount0);
      
      // Calculate amounts back from liquidity
      const amounts = computeAmountsForLiquidity(sqrtPriceX96, tickLower, tickUpper, liquidity);
      
      // Amount0 should be close to original (within rounding errors)
      const ratio = amounts.amount0.mul(1000000).div(initialAmount0).toNumber() / 1000000;
      expect(ratio).to.be.closeTo(1, 0.01); // Within 1%
    });

    it('should handle edge cases gracefully', () => {
      const sqrtPriceX96 = getSqrtRatioAtTick(0);
      const tickLower = -60;
      const tickUpper = 60;
      
      // Zero liquidity
      const zeroAmounts = computeAmountsForLiquidity(
        sqrtPriceX96,
        tickLower,
        tickUpper,
        BigNumber.from(0)
      );
      
      expect(zeroAmounts.amount0.eq(0)).to.be.true;
      expect(zeroAmounts.amount1.eq(0)).to.be.true;
      
      // Very small liquidity
      const smallAmounts = computeAmountsForLiquidity(
        sqrtPriceX96,
        tickLower,
        tickUpper,
        BigNumber.from(1)
      );
      
      expect(smallAmounts.amount0.gte(0)).to.be.true;
      expect(smallAmounts.amount1.gte(0)).to.be.true;
    });
  });

  describe('Tick Spacing Validation', () => {
    it('should validate tick spacing correctly', () => {
      expect(validateTickSpacing(60, 60)).to.be.true;
      expect(validateTickSpacing(120, 60)).to.be.true;
      expect(validateTickSpacing(0, 60)).to.be.true;
      
      expect(validateTickSpacing(61, 60)).to.be.false;
      expect(validateTickSpacing(119, 60)).to.be.false;
    });

    it('should align ticks to spacing correctly', () => {
      expect(alignTickToSpacing(61, 60)).to.equal(60);
      expect(alignTickToSpacing(89, 60)).to.equal(120);
      expect(alignTickToSpacing(30, 60)).to.equal(0);
      expect(alignTickToSpacing(-30, 60)).to.equal(0);
      expect(alignTickToSpacing(-90, 60)).to.equal(-120);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid sqrt prices', () => {
      expect(() => getTickAtSqrtRatio(BigNumber.from(0))).to.throw();
      expect(() => getTickAtSqrtRatio(BigNumber.from('999999999999999999999999999999999999999999999999999999'))).to.throw();
    });

    it('should handle invalid tick ranges', () => {
      const sqrtPriceX96 = getSqrtRatioAtTick(0);
      const liquidity = BigNumber.from('1000000000000000000');
      
      // Invalid range where tickLower >= tickUpper
      expect(() => computeAmountsForLiquidity(sqrtPriceX96, 1000, 1000, liquidity)).to.not.throw();
      expect(() => computeAmountsForLiquidity(sqrtPriceX96, 1000, 500, liquidity)).to.not.throw();
    });
  });
});