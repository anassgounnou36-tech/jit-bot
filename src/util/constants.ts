import { ethers } from 'ethers';

/**
 * Token address constants for Ethereum mainnet
 */
export const TOKEN_ADDRESSES = {
  ETHEREUM: {
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // Canonical USDC mainnet address
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  }
} as const;

/**
 * Known incorrect addresses that should be auto-corrected
 */
export const INCORRECT_ADDRESSES = {
  USDC_INCORRECT: '0xa0b86a33e6441b80b05fdc68f34f8c9c31c8e9a' // Incorrect USDC address to guard against
} as const;

/**
 * Normalize token address to canonical mainnet address
 * @param address The address to normalize
 * @param tokenSymbol The token symbol for better error messages
 * @param logger Optional logger for warnings
 * @returns Normalized address
 */
export function normalizeTokenAddress(
  address: string, 
  tokenSymbol: string = 'UNKNOWN',
  logger?: any
): string {
  const checksumAddress = ethers.utils.getAddress(address);
  
  // Check for known incorrect USDC address
  if (address.toLowerCase() === INCORRECT_ADDRESSES.USDC_INCORRECT.toLowerCase()) {
    const correctAddress = TOKEN_ADDRESSES.ETHEREUM.USDC;
    
    if (logger) {
      logger.warn({
        msg: 'Detected incorrect USDC address, auto-correcting',
        incorrectAddress: address,
        correctAddress,
        tokenSymbol
      });
    } else {
      console.warn(`WARNING: Detected incorrect USDC address ${address}, auto-correcting to ${correctAddress}`);
    }
    
    return correctAddress;
  }
  
  return checksumAddress;
}

/**
 * Validate that USDC address in config is correct
 * @param address The USDC address to validate
 * @throws Error if address is incorrect and we're not in simulation mode
 */
export function validateUsdcAddress(address: string, simulationMode: boolean = true): void {
  const normalizedAddress = address.toLowerCase();
  const incorrectAddress = INCORRECT_ADDRESSES.USDC_INCORRECT.toLowerCase();
  
  if (normalizedAddress === incorrectAddress) {
    const correctAddress = TOKEN_ADDRESSES.ETHEREUM.USDC;
    const message = `Incorrect USDC address detected: ${address}. Expected: ${correctAddress}`;
    
    if (!simulationMode) {
      throw new Error(`${message}. Cannot proceed in live mode with incorrect address.`);
    } else {
      console.warn(`${message}. Auto-correcting in simulation mode.`);
    }
  }
}