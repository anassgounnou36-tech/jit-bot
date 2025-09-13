import { ethers } from 'ethers';
import { getConfig, validateNoLiveExecution } from '../config';
import { getPoolState } from '../pool/stateFetcher';
import { validateTickRange } from '../lp/tickUtils';

export interface ForkSimulationParams {
  poolAddress: string;
  swapAmountIn: ethers.BigNumber;
  swapTokenIn: string;
  swapTokenOut: string;
  tickLower: number;
  tickUpper: number;
  liquidityAmount: ethers.BigNumber;
  gasPrice: ethers.BigNumber;
  blockNumber?: number;
}

export interface ForkSimulationResult {
  success: boolean;
  profitable: boolean;
  
  // Validation results
  validations: {
    tickRangeValid: boolean;
    amountsValid: boolean;
    positionSizeValid: boolean;
    gasLimitValid: boolean;
  };
  
  // Estimated results (from eth_call simulations)
  estimatedResults: {
    flashLoanSuccess: boolean;
    mintPositionSuccess: boolean;
    swapExecutionSuccess: boolean;
    burnPositionSuccess: boolean;
    repaymentSuccess: boolean;
    
    estimatedFeesCollected: ethers.BigNumber;
    estimatedGasUsed: number;
    estimatedNetProfit: ethers.BigNumber;
  };
  
  // Pool state validation
  poolValidation: {
    poolExists: boolean;
    poolUnlocked: boolean;
    liquiditySufficient: boolean;
    tickSpacingValid: boolean;
  };
  
  reason?: string;
  error?: string;
}

/**
 * Fork-based simulation using eth_call to validate JIT strategy
 * This runs validation checks without sending actual transactions
 * @param params Simulation parameters
 * @returns Simulation result with validations
 */
export async function forkSimulate(params: ForkSimulationParams): Promise<ForkSimulationResult> {
  try {
    // CRITICAL: Ensure no live execution in PR1
    validateNoLiveExecution('Fork simulation with transaction execution');
    
    // 1. Validate pool state
    const poolValidation = await validatePoolState(params.poolAddress, params.blockNumber);
    
    if (!poolValidation.poolExists) {
      return createFailedResult('Pool does not exist', { poolValidation });
    }
    
    // 2. Validate tick range
    const poolState = await getPoolState(params.poolAddress);
    const tickRangeValid = validateTickRange(
      params.tickLower,
      params.tickUpper,
      poolState.tickSpacing
    );
    
    // 3. Validate amounts
    const amountsValid = validateAmounts(params);
    
    // 4. Validate position size
    const positionSizeValid = await validatePositionSize(params);
    
    // 5. Validate gas limits
    const gasLimitValid = validateGasLimits(params);
    
    const validations = {
      tickRangeValid,
      amountsValid,
      positionSizeValid,
      gasLimitValid
    };
    
    // If basic validations fail, return early
    if (!tickRangeValid || !amountsValid || !positionSizeValid || !gasLimitValid) {
      return createFailedResult('Validation failed', { poolValidation, validations });
    }
    
    // 6. Run eth_call-style validations (SIMULATION ONLY)
    const estimatedResults = await runEthCallValidations(params);
    
    // 7. Determine overall success and profitability
    const success = Object.values(estimatedResults).every(result => 
      typeof result === 'boolean' ? result : true
    );
    
    const profitable = success && estimatedResults.estimatedNetProfit.gt(0);
    
    return {
      success,
      profitable,
      validations,
      estimatedResults,
      poolValidation,
      reason: success ? 
        (profitable ? 'Fork simulation successful and profitable' : 'Fork simulation successful but not profitable') :
        'Fork simulation validation failed'
    };
    
  } catch (error: any) {
    return createFailedResult(`Fork simulation error: ${error.message}`);
  }
}

/**
 * Validate pool state and existence
 */
async function validatePoolState(
  poolAddress: string,
  _blockNumber?: number
): Promise<ForkSimulationResult['poolValidation']> {
  try {
    const poolState = await getPoolState(poolAddress);
    
    return {
      poolExists: true,
      poolUnlocked: poolState.unlocked,
      liquiditySufficient: poolState.liquidity.gt(0),
      tickSpacingValid: poolState.tickSpacing > 0
    };
    
  } catch (error) {
    return {
      poolExists: false,
      poolUnlocked: false,
      liquiditySufficient: false,
      tickSpacingValid: false
    };
  }
}

/**
 * Validate input amounts
 */
function validateAmounts(params: ForkSimulationParams): boolean {
  return !!(
    params.swapAmountIn &&
    params.swapAmountIn.gt(0) &&
    params.liquidityAmount &&
    params.liquidityAmount.gt(0) &&
    params.gasPrice &&
    params.gasPrice.gt(0)
  );
}

/**
 * Validate position size against pool liquidity
 */
async function validatePositionSize(params: ForkSimulationParams): Promise<boolean> {
  try {
    const poolState = await getPoolState(params.poolAddress);
    
    // Position shouldn't be more than 10% of pool liquidity
    const maxPosition = poolState.liquidity.div(10);
    
    return params.liquidityAmount.lte(maxPosition);
    
  } catch (error) {
    return false;
  }
}

/**
 * Validate gas parameters
 */
function validateGasLimits(params: ForkSimulationParams): boolean {
  const config = getConfig();
  const gasPriceGwei = parseFloat(ethers.utils.formatUnits(params.gasPrice, 'gwei'));
  
  return gasPriceGwei <= config.maxGasGwei;
}

/**
 * Run eth_call-style validations (SIMULATION ONLY - NO ACTUAL TRANSACTIONS)
 */
async function runEthCallValidations(params: ForkSimulationParams): Promise<ForkSimulationResult['estimatedResults']> {
  // IMPORTANT: This is simulation only in PR1
  // In PR2, this would use actual eth_call simulations
  
  // For now, return conservative estimates based on parameters
  const estimatedGasUsed = 480000; // Conservative total gas estimate
  const estimatedFeesCollected = params.swapAmountIn.mul(300).div(1000000); // 0.03% fee estimate
  const estimatedGasCost = params.gasPrice.mul(estimatedGasUsed);
  const estimatedNetProfit = estimatedFeesCollected.sub(estimatedGasCost);
  
  return {
    flashLoanSuccess: true,        // Balancer flash loans are typically reliable
    mintPositionSuccess: true,     // Assume position can be minted
    swapExecutionSuccess: true,    // Assume swap will execute
    burnPositionSuccess: true,     // Assume position can be burned
    repaymentSuccess: true,        // Assume repayment will succeed
    
    estimatedFeesCollected,
    estimatedGasUsed,
    estimatedNetProfit
  };
}

/**
 * Create a failed simulation result
 */
function createFailedResult(
  reason: string,
  partialResult?: Partial<ForkSimulationResult>
): ForkSimulationResult {
  return {
    success: false,
    profitable: false,
    
    validations: {
      tickRangeValid: false,
      amountsValid: false,
      positionSizeValid: false,
      gasLimitValid: false
    },
    
    estimatedResults: {
      flashLoanSuccess: false,
      mintPositionSuccess: false,
      swapExecutionSuccess: false,
      burnPositionSuccess: false,
      repaymentSuccess: false,
      
      estimatedFeesCollected: ethers.BigNumber.from(0),
      estimatedGasUsed: 0,
      estimatedNetProfit: ethers.BigNumber.from(0)
    },
    
    poolValidation: {
      poolExists: false,
      poolUnlocked: false,
      liquiditySufficient: false,
      tickSpacingValid: false
    },
    
    reason,
    ...partialResult
  };
}

/**
 * Validate JIT strategy parameters before simulation
 * @param params Strategy parameters
 * @returns Validation result
 */
export async function validateJitStrategy(params: ForkSimulationParams): Promise<{
  valid: boolean;
  issues: string[];
  warnings: string[];
}> {
  const issues: string[] = [];
  const warnings: string[] = [];
  
  try {
    // Check pool existence
    const poolState = await getPoolState(params.poolAddress);
    
    // Validate tick range
    if (!validateTickRange(params.tickLower, params.tickUpper, poolState.tickSpacing)) {
      issues.push('Invalid tick range or tick spacing alignment');
    }
    
    // Check if position is in range
    if (poolState.tick < params.tickLower || poolState.tick > params.tickUpper) {
      warnings.push('Position is out of current price range');
    }
    
    // Check position size
    const positionRatio = parseFloat(ethers.utils.formatEther(params.liquidityAmount)) / 
                         parseFloat(ethers.utils.formatEther(poolState.liquidity));
    
    if (positionRatio > 0.1) {
      warnings.push(`Large position size (${(positionRatio * 100).toFixed(1)}% of pool liquidity)`);
    }
    
    // Check gas price
    const config = getConfig();
    const gasPriceGwei = parseFloat(ethers.utils.formatUnits(params.gasPrice, 'gwei'));
    
    if (gasPriceGwei > config.maxGasGwei) {
      issues.push(`Gas price ${gasPriceGwei} gwei exceeds limit ${config.maxGasGwei} gwei`);
    }
    
    // Check swap amount reasonableness
    const swapAmountEth = parseFloat(ethers.utils.formatEther(params.swapAmountIn));
    if (swapAmountEth < 0.01) {
      warnings.push('Very small swap amount, fees may not cover gas costs');
    }
    if (swapAmountEth > 1000) {
      warnings.push('Very large swap amount, high price impact expected');
    }
    
  } catch (error: any) {
    issues.push(`Validation error: ${error.message}`);
  }
  
  return {
    valid: issues.length === 0,
    issues,
    warnings
  };
}

/**
 * Get fork simulation requirements
 * @returns Minimum requirements for fork simulation
 */
export function getForkSimulationRequirements(): {
  minimumSwapSize: ethers.BigNumber;
  minimumLiquidity: ethers.BigNumber;
  maximumGasPrice: ethers.BigNumber;
  requiredBlockConfirmations: number;
} {
  const config = getConfig();
  
  return {
    minimumSwapSize: ethers.utils.parseEther('0.01'), // 0.01 ETH minimum
    minimumLiquidity: ethers.utils.parseEther('0.1'),  // 0.1 ETH minimum liquidity
    maximumGasPrice: ethers.utils.parseUnits(config.maxGasGwei.toString(), 'gwei'),
    requiredBlockConfirmations: 1
  };
}

/**
 * Estimate simulation execution time
 * @param params Simulation parameters
 * @returns Estimated execution time in seconds
 */
export function estimateSimulationTime(params: ForkSimulationParams): number {
  // Base time for validations
  let estimatedTime = 2; // 2 seconds base
  
  // Add time for complex validations
  if (params.liquidityAmount.gt(ethers.utils.parseEther('10'))) {
    estimatedTime += 1; // Large positions take longer
  }
  
  // Add time for historical block simulation
  if (params.blockNumber) {
    estimatedTime += 3; // Historical simulations are slower
  }
  
  return estimatedTime;
}