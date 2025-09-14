import { ethers } from 'ethers';

/**
 * Shared constants for tests to ensure object identity
 * Used by both test mocks and actual code to ensure BigNumber comparisons work
 */
export const TEST_ZERO_BIGNUMBER = ethers.BigNumber.from(0);
export const TEST_AAVE_FEE_RATE = 5; // 0.05% = 5 bps