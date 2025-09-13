import { expect } from 'chai';
import { ethers } from 'ethers';
import {
  priceToTick,
  tickToPrice,
  calculateTickRange,
  validateTickRange,
  getLiquidityForAmounts,
  getAmountsForLiquidity,
  calculateOptimalJitPosition,
  estimateFeesEarned,
  estimatePriceImpact,
  isTickInRange
} from '../../src/lp/tickUtils';

describe('TickUtils', () => {
  describe('priceToTick and tickToPrice', () => {
    it('should convert price to tick and back', () => {
      const price = ethers.utils.parseEther('1'); // 1:1 price
      const tick = priceToTick(price);
      expect(tick).to.be.a('number');
      
      const convertedPrice = tickToPrice(tick);
      expect(convertedPrice).to.be.instanceOf(ethers.BigNumber);
      
      // Should be approximately equal (due to rounding)
      const diff = convertedPrice.sub(price).abs();
      const tolerance = price.div(1000); // 0.1% tolerance
      expect(diff.lte(tolerance)).to.be.true;
    });
  });

  describe('calculateTickRange', () => {
    it('should calculate symmetric tick range around current tick', () => {
      const currentTick = 201240; // Example current tick
      const tickSpacing = 60;
      const rangeWidth = 10;
      
      const range = calculateTickRange(currentTick, tickSpacing, rangeWidth);
      
      expect(range.tickLower).to.be.a('number');
      expect(range.tickUpper).to.be.a('number');
      expect(range.tickUpper).to.be.greaterThan(range.tickLower);
      
      // Should be aligned to tick spacing
      expect(range.tickLower % tickSpacing).to.equal(0);
      expect(range.tickUpper % tickSpacing).to.equal(0);
    });

    it('should use default range width of 10 when not specified', () => {
      const currentTick = 201240;
      const tickSpacing = 60;
      
      const range1 = calculateTickRange(currentTick, tickSpacing);
      const range2 = calculateTickRange(currentTick, tickSpacing, 10);
      
      expect(range1.tickLower).to.equal(range2.tickLower);
      expect(range1.tickUpper).to.equal(range2.tickUpper);
    });
  });

  describe('validateTickRange', () => {
    it('should validate correct tick ranges', () => {
      const tickLower = 201000;
      const tickUpper = 201600;
      const tickSpacing = 60;
      
      const isValid = validateTickRange(tickLower, tickUpper, tickSpacing);
      expect(isValid).to.be.true;
    });

    it('should reject invalid tick ranges', () => {
      const tickSpacing = 60;
      
      // Lower >= Upper
      expect(validateTickRange(201600, 201000, tickSpacing)).to.be.false;
      expect(validateTickRange(201000, 201000, tickSpacing)).to.be.false;
      
      // Not aligned to tick spacing
      expect(validateTickRange(201001, 201600, tickSpacing)).to.be.false;
      expect(validateTickRange(201000, 201601, tickSpacing)).to.be.false;
      
      // Out of bounds
      expect(validateTickRange(-900000, 201600, tickSpacing)).to.be.false;
      expect(validateTickRange(201000, 900000, tickSpacing)).to.be.false;
    });
  });

  describe('getLiquidityForAmounts', () => {
    it('should calculate liquidity from token amounts', () => {
      const amount0 = ethers.utils.parseEther('10');
      const amount1 = ethers.utils.parseEther('20000'); // Assuming USDC-like token
      const tickLower = 201000;
      const tickUpper = 201600;
      const currentTick = 201240;
      
      const liquidity = getLiquidityForAmounts(amount0, amount1, tickLower, tickUpper, currentTick);
      
      expect(liquidity).to.be.instanceOf(ethers.BigNumber);
      expect(liquidity.gt(0)).to.be.true;
    });
  });

  describe('getAmountsForLiquidity', () => {
    it('should calculate token amounts from liquidity', () => {
      const liquidity = ethers.utils.parseEther('1000');
      const tickLower = 201000;
      const tickUpper = 201600;
      const currentTick = 201240;
      
      const amounts = getAmountsForLiquidity(liquidity, tickLower, tickUpper, currentTick);
      
      expect(amounts.amount0).to.be.instanceOf(ethers.BigNumber);
      expect(amounts.amount1).to.be.instanceOf(ethers.BigNumber);
      expect(amounts.liquidity).to.equal(liquidity);
      expect(amounts.amount0.gte(0)).to.be.true;
      expect(amounts.amount1.gte(0)).to.be.true;
    });
  });

  describe('calculateOptimalJitPosition', () => {
    it('should calculate optimal JIT position for a swap', () => {
      const swapAmount = ethers.utils.parseEther('10');
      const tickLower = 201000;
      const tickUpper = 201600;
      const currentTick = 201240;
      const liquidityRatio = 0.1;
      
      const position = calculateOptimalJitPosition(
        swapAmount,
        tickLower,
        tickUpper,
        currentTick,
        liquidityRatio
      );
      
      expect(position.tickLower).to.equal(tickLower);
      expect(position.tickUpper).to.equal(tickUpper);
      expect(position.liquidity).to.be.instanceOf(ethers.BigNumber);
      expect(position.amount0).to.be.instanceOf(ethers.BigNumber);
      expect(position.amount1).to.be.instanceOf(ethers.BigNumber);
      expect(position.liquidity.gt(0)).to.be.true;
    });
  });

  describe('estimateFeesEarned', () => {
    it('should estimate fees from swap volume', () => {
      const swapVolume = ethers.utils.parseEther('100');
      const feeRate = 3000; // 0.3%
      
      const estimatedFees = estimateFeesEarned(swapVolume, feeRate);
      
      expect(estimatedFees).to.be.instanceOf(ethers.BigNumber);
      expect(estimatedFees.gt(0)).to.be.true;
      
      // Should be approximately 0.3% of swap volume
      const expectedFees = swapVolume.mul(3000).div(1000000);
      expect(estimatedFees).to.equal(expectedFees);
    });
  });

  describe('estimatePriceImpact', () => {
    it('should estimate price impact based on swap size and liquidity', () => {
      const amountIn = ethers.utils.parseEther('10');
      const poolLiquidity = ethers.utils.parseEther('1000');
      
      const priceImpact = estimatePriceImpact(amountIn, poolLiquidity);
      
      expect(priceImpact).to.be.a('number');
      expect(priceImpact).to.be.greaterThan(0);
      expect(priceImpact).to.be.lessThanOrEqual(100);
      
      // Should be approximately 1% (10 / 1000 * 100)
      expect(priceImpact).to.be.approximately(1, 0.1);
    });

    it('should cap price impact at 100%', () => {
      const amountIn = ethers.utils.parseEther('2000');
      const poolLiquidity = ethers.utils.parseEther('1000');
      
      const priceImpact = estimatePriceImpact(amountIn, poolLiquidity);
      
      expect(priceImpact).to.equal(100);
    });
  });

  describe('isTickInRange', () => {
    it('should correctly identify if tick is in range', () => {
      const tickLower = 201000;
      const tickUpper = 201600;
      
      expect(isTickInRange(201240, tickLower, tickUpper)).to.be.true;
      expect(isTickInRange(201000, tickLower, tickUpper)).to.be.true;
      expect(isTickInRange(201600, tickLower, tickUpper)).to.be.true;
      
      expect(isTickInRange(200999, tickLower, tickUpper)).to.be.false;
      expect(isTickInRange(201601, tickLower, tickUpper)).to.be.false;
    });
  });
});