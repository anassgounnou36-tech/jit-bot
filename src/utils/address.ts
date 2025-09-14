import { ethers } from 'ethers';

/**
 * Addresses that need normalization in simulation mode
 */
const KNOWN_ADDRESS_ISSUES = {
  // Known bad USDC variant that needs to be corrected to canonical address
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC mainnet
} as const;

export interface AddressOptions {
  simulationMode?: boolean;
}

/**
 * Ensure address is in proper checksummed format and handle known variants
 * @param address The address to normalize
 * @param options Configuration options
 * @returns Checksummed address with known variants corrected
 */
export function ensureAddress(address: string, options: AddressOptions = {}): string {
  if (!ethers.utils.isAddress(address)) {
    throw new Error(`Invalid address format: ${address}`);
  }

  // Convert to lowercase for lookup in known issues
  const lowerAddress = address.toLowerCase();
  
  // In simulation mode, auto-correct known bad variants
  if (options.simulationMode && lowerAddress in KNOWN_ADDRESS_ISSUES) {
    const correctedAddress = KNOWN_ADDRESS_ISSUES[lowerAddress as keyof typeof KNOWN_ADDRESS_ISSUES];
    return ethers.utils.getAddress(correctedAddress);
  }

  // Return checksummed version
  return ethers.utils.getAddress(address);
}

/**
 * Check if an address matches a known variant that needs correction
 * @param address The address to check
 * @returns True if this is a known variant that should be corrected
 */
export function isKnownAddressVariant(address: string): boolean {
  if (!ethers.utils.isAddress(address)) {
    return false;
  }
  
  const lowerAddress = address.toLowerCase();
  return lowerAddress in KNOWN_ADDRESS_ISSUES;
}

/**
 * Get the canonical address for a known variant
 * @param address The variant address
 * @returns The canonical address, or the original if not a known variant
 */
export function getCanonicalAddress(address: string): string {
  if (!ethers.utils.isAddress(address)) {
    throw new Error(`Invalid address format: ${address}`);
  }
  
  const lowerAddress = address.toLowerCase();
  if (lowerAddress in KNOWN_ADDRESS_ISSUES) {
    return KNOWN_ADDRESS_ISSUES[lowerAddress as keyof typeof KNOWN_ADDRESS_ISSUES];
  }
  
  return ethers.utils.getAddress(address);
}