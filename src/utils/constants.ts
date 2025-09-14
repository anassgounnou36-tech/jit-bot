import { ethers } from 'ethers';

/**
 * Shared BigNumber constants to ensure object identity across tests and code
 */
export const ZERO_BIGNUMBER = ethers.BigNumber.from(0);
export const ONE_BIGNUMBER = ethers.BigNumber.from(1);

// Re-export ethers constants for convenience
export const { Zero: ETHERS_ZERO, One: ETHERS_ONE } = ethers.constants;