import { ethers } from "ethers";
import * as dotenv from "dotenv";

// Load dotenv if not already loaded
if (!process.env.__JIT_ENV_LOADED) {
  dotenv.config();
  process.env.__JIT_ENV_LOADED = 'true';
}

/**
 * Mask sensitive values for logging (show first 6 + last 4 characters)
 */
export function mask(value: string): string {
  if (!value || value.length <= 10) {
    return '***masked***';
  }
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

/**
 * Get and validate an address from environment variables
 * @param varName - Environment variable name
 * @param fallback - Optional fallback value
 * @returns Validated address
 * @throws Error if address is invalid
 */
export function getAddressEnv(varName: string, fallback?: string): string {
  let value = process.env[varName];
  
  // Trim whitespace if value exists
  if (value !== undefined) {
    value = value.trim();
  }
  
  // Use fallback if value is empty or undefined
  if (!value && fallback !== undefined) {
    value = fallback;
  }
  
  // If still no value, throw error
  if (!value) {
    throw new Error(`Environment variable ${varName} is required but not set or empty`);
  }
  
  // Validate address format
  if (!ethers.utils.isAddress(value)) {
    throw new Error(`Environment variable ${varName} contains invalid address: "${value}"`);
  }
  
  return value;
}

/**
 * Get and validate a number from environment variables
 * @param varName - Environment variable name
 * @param fallback - Optional fallback value
 * @returns Parsed number
 * @throws Error if value is not a valid number
 */
export function getNumberEnv(varName: string, fallback?: number): number {
  let value = process.env[varName];
  
  // Trim whitespace if value exists
  if (value !== undefined) {
    value = value.trim();
  }
  
  // Use fallback if value is empty or undefined
  if (!value && fallback !== undefined) {
    return fallback;
  }
  
  // If still no value, throw error
  if (!value) {
    throw new Error(`Environment variable ${varName} is required but not set or empty`);
  }
  
  const parsed = parseFloat(value);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${varName} contains invalid number: "${value}"`);
  }
  
  return parsed;
}

/**
 * Get and validate an ETH amount from environment variables
 * @param varName - Environment variable name
 * @param fallback - Optional fallback value in ETH
 * @returns Parsed BigNumber in wei
 * @throws Error if value is not a valid ETH amount
 */
export function getEthAmountEnv(varName: string, fallback?: string): ethers.BigNumber {
  let value = process.env[varName];
  
  // Trim whitespace if value exists
  if (value !== undefined) {
    value = value.trim();
  }
  
  // Use fallback if value is empty or undefined
  if (!value && fallback !== undefined) {
    value = fallback;
  }
  
  // If still no value, throw error
  if (!value) {
    throw new Error(`Environment variable ${varName} is required but not set or empty`);
  }
  
  try {
    return ethers.utils.parseEther(value);
  } catch (error) {
    throw new Error(`Environment variable ${varName} contains invalid ETH amount: "${value}"`);
  }
}

/**
 * Get a string environment variable with optional fallback
 * @param varName - Environment variable name
 * @param fallback - Optional fallback value
 * @returns String value
 */
export function getStringEnv(varName: string, fallback?: string): string {
  let value = process.env[varName];
  
  // Trim whitespace if value exists
  if (value !== undefined) {
    value = value.trim();
  }
  
  // Use fallback if value is empty or undefined
  if (!value && fallback !== undefined) {
    return fallback;
  }
  
  // If still no value, throw error
  if (!value) {
    throw new Error(`Environment variable ${varName} is required but not set or empty`);
  }
  
  return value;
}

/**
 * Normalize RPC URL by checking ETHEREUM_RPC_URL first, then RPC_URL_HTTP
 * @returns Normalized RPC URL
 */
export function normalizeRpcUrl(): string {
  let rpcUrl = process.env.ETHEREUM_RPC_URL;
  
  // Trim whitespace if value exists
  if (rpcUrl !== undefined) {
    rpcUrl = rpcUrl.trim();
  }
  
  // Fallback to RPC_URL_HTTP if ETHEREUM_RPC_URL is empty or undefined
  if (!rpcUrl) {
    rpcUrl = process.env.RPC_URL_HTTP;
    if (rpcUrl !== undefined) {
      rpcUrl = rpcUrl.trim();
    }
  }
  
  return rpcUrl || '';
}

/**
 * Validate required environment variables for deployment
 * @param network - Network name for deployment
 * @throws Error if validation fails
 */
export function validateDeploymentEnv(network: string): void {
  const errors: string[] = [];
  
  // Validate private key
  try {
    const privateKey = getStringEnv('PRIVATE_KEY');
    if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
      errors.push('PRIVATE_KEY must be a valid 32-byte hex string starting with 0x');
    }
  } catch (error: any) {
    errors.push(error.message);
  }
  
  // Validate RPC URL for non-fork networks
  if (network !== 'fork' && network !== 'hardhat') {
    const rpcUrl = normalizeRpcUrl();
    if (!rpcUrl) {
      errors.push('ETHEREUM_RPC_URL (or RPC_URL_HTTP) is required for mainnet deployment');
    }
  }
  
  if (errors.length > 0) {
    throw new Error(`Environment validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`);
  }
}