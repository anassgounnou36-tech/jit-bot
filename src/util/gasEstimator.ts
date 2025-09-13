import { ethers } from 'ethers';
import { getConfig, getHttpProvider } from '../config';

export interface GasEstimate {
  gasPrice: ethers.BigNumber;
  gasPriceGwei: number;
  maxFeePerGas: ethers.BigNumber;
  maxPriorityFeePerGas: ethers.BigNumber;
  isEIP1559: boolean;
  capped: boolean;
}

export interface GasConstants {
  flashLoan: number;
  mintPosition: number;
  burnPosition: number;
  collectFees: number;
  repayFlashLoan: number;
  swapOverhead: number;
  totalEstimate: number;
}

// Conservative gas estimates for JIT operations
export const JIT_GAS_CONSTANTS: GasConstants = {
  flashLoan: 50000,           // Flash loan initiation
  mintPosition: 150000,       // Mint LP position
  burnPosition: 120000,       // Burn LP position
  collectFees: 80000,         // Collect fees from position
  repayFlashLoan: 30000,      // Repay flash loan
  swapOverhead: 50000,        // Additional overhead and safety margin
  totalEstimate: 480000       // Total conservative estimate
};

// Gas price cache with short TTL
interface GasPriceCache {
  gasPrice: ethers.BigNumber;
  maxFeePerGas: ethers.BigNumber;
  maxPriorityFeePerGas: ethers.BigNumber;
  timestamp: number;
  isEIP1559: boolean;
}

let gasPriceCache: GasPriceCache | null = null;
const GAS_CACHE_TTL_MS = 5000; // 5 seconds

/**
 * Get current gas price from RPC with capping
 * @returns Gas estimate with price capped by MAX_GAS_GWEI
 */
export async function getGasPriceGwei(): Promise<GasEstimate> {
  const config = getConfig();
  
  // Check cache first
  if (gasPriceCache && (Date.now() - gasPriceCache.timestamp) < GAS_CACHE_TTL_MS) {
    const gasPriceGwei = parseFloat(ethers.utils.formatUnits(gasPriceCache.gasPrice, 'gwei'));
    const capped = gasPriceGwei > config.maxGasGwei;
    
    return {
      gasPrice: capped ? ethers.utils.parseUnits(config.maxGasGwei.toString(), 'gwei') : gasPriceCache.gasPrice,
      gasPriceGwei: Math.min(gasPriceGwei, config.maxGasGwei),
      maxFeePerGas: gasPriceCache.maxFeePerGas,
      maxPriorityFeePerGas: gasPriceCache.maxPriorityFeePerGas,
      isEIP1559: gasPriceCache.isEIP1559,
      capped
    };
  }
  
  const provider = getHttpProvider(config);
  
  try {
    // Try to get EIP-1559 gas prices first
    let gasPrice: ethers.BigNumber;
    let maxFeePerGas: ethers.BigNumber;
    let maxPriorityFeePerGas: ethers.BigNumber;
    let isEIP1559 = false;
    
    try {
      const feeData = await provider.getFeeData();
      
      if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
        // EIP-1559 network
        maxFeePerGas = feeData.maxFeePerGas;
        maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
        gasPrice = maxFeePerGas; // Use maxFeePerGas as base gas price
        isEIP1559 = true;
      } else if (feeData.gasPrice) {
        // Legacy gas pricing
        gasPrice = feeData.gasPrice;
        maxFeePerGas = gasPrice;
        maxPriorityFeePerGas = ethers.BigNumber.from(0);
      } else {
        throw new Error('No gas price data available');
      }
    } catch (eip1559Error) {
      // Fallback to legacy gas price
      gasPrice = await provider.getGasPrice();
      maxFeePerGas = gasPrice;
      maxPriorityFeePerGas = ethers.BigNumber.from(0);
    }
    
    // Update cache
    gasPriceCache = {
      gasPrice,
      maxFeePerGas,
      maxPriorityFeePerGas,
      timestamp: Date.now(),
      isEIP1559
    };
    
    const gasPriceGwei = parseFloat(ethers.utils.formatUnits(gasPrice, 'gwei'));
    const capped = gasPriceGwei > config.maxGasGwei;
    
    return {
      gasPrice: capped ? ethers.utils.parseUnits(config.maxGasGwei.toString(), 'gwei') : gasPrice,
      gasPriceGwei: Math.min(gasPriceGwei, config.maxGasGwei),
      maxFeePerGas: capped ? ethers.utils.parseUnits(config.maxGasGwei.toString(), 'gwei') : maxFeePerGas,
      maxPriorityFeePerGas,
      isEIP1559,
      capped
    };
    
  } catch (error: any) {
    throw new Error(`Failed to fetch gas price: ${error.message}`);
  }
}

/**
 * Calculate gas cost for JIT operation
 * @param gasEstimate Gas price estimate
 * @param gasUsed Optional custom gas amount, defaults to JIT_GAS_CONSTANTS.totalEstimate
 * @returns Gas cost in ETH
 */
export function calculateGasCost(
  gasEstimate: GasEstimate,
  gasUsed: number = JIT_GAS_CONSTANTS.totalEstimate
): ethers.BigNumber {
  return gasEstimate.gasPrice.mul(gasUsed);
}

/**
 * Calculate gas cost in USD
 * @param gasEstimate Gas price estimate
 * @param ethPriceUsd ETH price in USD
 * @param gasUsed Optional custom gas amount
 * @returns Gas cost in USD
 */
export function calculateGasCostUsd(
  gasEstimate: GasEstimate,
  ethPriceUsd: number,
  gasUsed: number = JIT_GAS_CONSTANTS.totalEstimate
): number {
  const gasCostEth = calculateGasCost(gasEstimate, gasUsed);
  const gasCostEthFloat = parseFloat(ethers.utils.formatEther(gasCostEth));
  return gasCostEthFloat * ethPriceUsd;
}

/**
 * Get gas estimate for specific JIT operation components
 * @param operations Array of operation names
 * @returns Total gas estimate for specified operations
 */
export function getJitOperationGasEstimate(operations: (keyof GasConstants)[]): number {
  return operations.reduce((total, op) => {
    if (op === 'totalEstimate') return total;
    return total + JIT_GAS_CONSTANTS[op];
  }, 0);
}

/**
 * Check if gas price is acceptable for execution
 * @param maxGasGwei Maximum acceptable gas price in Gwei
 * @returns Gas check result
 */
export async function checkGasPrice(maxGasGwei?: number): Promise<{
  acceptable: boolean;
  currentGwei: number;
  maxGwei: number;
  reason?: string;
}> {
  const config = getConfig();
  const maxGas = maxGasGwei || config.maxGasGwei;
  
  try {
    const gasEstimate = await getGasPriceGwei();
    
    return {
      acceptable: gasEstimate.gasPriceGwei <= maxGas,
      currentGwei: gasEstimate.gasPriceGwei,
      maxGwei: maxGas,
      reason: gasEstimate.gasPriceGwei > maxGas ? 
        `Gas price ${gasEstimate.gasPriceGwei} gwei exceeds limit ${maxGas} gwei` : 
        undefined
    };
  } catch (error: any) {
    return {
      acceptable: false,
      currentGwei: 0,
      maxGwei: maxGas,
      reason: `Failed to check gas price: ${error.message}`
    };
  }
}

/**
 * Get historical gas price data (simplified)
 * @param blocks Number of recent blocks to analyze
 * @returns Gas price statistics
 */
export async function getHistoricalGasData(blocks: number = 10): Promise<{
  average: number;
  median: number;
  min: number;
  max: number;
  samples: number;
}> {
  const config = getConfig();
  const provider = getHttpProvider(config);
  
  try {
    const currentBlock = await provider.getBlockNumber();
    const promises: Promise<ethers.providers.Block>[] = [];
    
    // Fetch recent blocks
    for (let i = 0; i < blocks; i++) {
      promises.push(provider.getBlock(currentBlock - i));
    }
    
    const blockData = await Promise.all(promises);
    const gasPrices = blockData
      .filter(block => block.gasUsed.gt(0))
      .map(_block => {
        // Estimate gas price from block base fee (if available) or use current price
        // This is simplified - real implementation would look at transaction gas prices
        return 20; // Default to 20 gwei for now
      });
    
    if (gasPrices.length === 0) {
      throw new Error('No gas price data available');
    }
    
    gasPrices.sort((a, b) => a - b);
    
    const average = gasPrices.reduce((sum, price) => sum + price, 0) / gasPrices.length;
    const median = gasPrices[Math.floor(gasPrices.length / 2)];
    const min = gasPrices[0];
    const max = gasPrices[gasPrices.length - 1];
    
    return {
      average,
      median,
      min,
      max,
      samples: gasPrices.length
    };
    
  } catch (error: any) {
    throw new Error(`Failed to fetch historical gas data: ${error.message}`);
  }
}

/**
 * Estimate transaction confirmation time based on gas price
 * @param gasPriceGwei Gas price in Gwei
 * @returns Estimated confirmation time in seconds
 */
export function estimateConfirmationTime(gasPriceGwei: number): number {
  // Simple heuristic based on gas price tiers
  if (gasPriceGwei >= 50) return 15;  // Fast: ~1 block
  if (gasPriceGwei >= 30) return 30;  // Standard: ~2 blocks
  if (gasPriceGwei >= 20) return 60;  // Slow: ~4 blocks
  return 120; // Very slow: ~8 blocks
}

/**
 * Clear gas price cache (useful for testing)
 */
export function clearGasPriceCache(): void {
  gasPriceCache = null;
}

/**
 * Get current cache status
 */
export function getGasCacheStatus(): { cached: boolean; age: number } {
  return {
    cached: gasPriceCache !== null,
    age: gasPriceCache ? Date.now() - gasPriceCache.timestamp : 0
  };
}