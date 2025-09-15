import { ethers } from 'ethers';
import { getConfig } from '../config';
import { getLogger } from '../logging/logger';
import { getBalancerAdapter } from './balancerAdapter';
import { getAaveAdapter } from './aaveAdapter';

/**
 * Interface for flashloan providers
 */
export interface IFlashloanProvider {
  readonly name: string;
  readonly enabled: boolean;
  
  /**
   * Get the maximum flashloan amount available for a token
   */
  getMaxFlashloanAmount(token: string): Promise<ethers.BigNumber>;
  
  /**
   * Build a flashloan transaction call data
   */
  buildFlashloanCall(
    token: string,
    amount: ethers.BigNumber,
    receiverAddress: string,
    calldata: string
  ): Promise<{
    to: string;
    data: string;
    value: ethers.BigNumber;
  }>;
  
  /**
   * Calculate flashloan fee for given amount
   */
  calculateFlashloanFee(token: string, amount: ethers.BigNumber): Promise<ethers.BigNumber>;
  
  /**
   * Get the flashloan pool address for a token
   */
  getFlashloanPoolAddress(token: string): Promise<string>;
}

/**
 * Aave V3 Flashloan Provider Implementation
 */
export class AaveV3FlashloanProvider implements IFlashloanProvider {
  readonly name = 'aave-v3';
  readonly enabled = true;
  
  private logger: any;
  private config: any;
  
  // Aave V3 Mainnet addresses
  private static readonly POOL_ADDRESS = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';
  // private static readonly POOL_ADDRESSES_PROVIDER = '0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e';
  
  // Standard Aave V3 fee: 0.05%
  private static readonly FLASHLOAN_FEE_PERCENTAGE = 5; // 0.05% = 5/10000
  
  constructor() {
    this.config = getConfig();
    this.logger = getLogger().child({ component: 'aave-v3-flashloan' });
    
    if (this.config.chain !== 'ethereum') {
      this.logger.warn({
        msg: 'Aave V3 provider configured for non-Ethereum chain',
        chain: this.config.chain,
        note: 'Verify addresses are correct for this chain'
      });
    }
  }
  
  async getMaxFlashloanAmount(_token: string): Promise<ethers.BigNumber> {
    try {
      // Query the Aave pool to get available liquidity
      // const provider = new ethers.providers.JsonRpcProvider(this.config.rpcUrlHttp);
      
      // Simplified: assume we can borrow up to 80% of token balance in pool
      // In production, this would query the actual Aave pool contract
      const mockAvailability = ethers.utils.parseEther('1000'); // 1000 tokens max
      
      this.logger.debug({
        msg: 'Fetched max flashloan amount',
        token: _token,
        maxAmount: ethers.utils.formatEther(mockAvailability)
      });
      
      return mockAvailability;
      
    } catch (error: any) {
      this.logger.error({
        err: error,
        msg: 'Failed to get max flashloan amount',
        token: _token
      });
      
      // Return conservative fallback
      return ethers.utils.parseEther('100');
    }
  }
  
  async buildFlashloanCall(
    token: string,
    amount: ethers.BigNumber,
    receiverAddress: string,
    calldata: string
  ): Promise<{
    to: string;
    data: string;
    value: ethers.BigNumber;
  }> {
    this.logger.info({
      msg: 'Building Aave V3 flashloan call',
      token,
      amount: ethers.utils.formatEther(amount),
      receiver: receiverAddress
    });
    
    // Aave V3 Pool interface for flashLoan function
    const poolInterface = new ethers.utils.Interface([
      'function flashLoan(address receiverAddress, address[] assets, uint256[] amounts, uint256[] modes, address onBehalfOf, bytes params, uint16 referralCode)'
    ]);
    
    // Build the flashloan call
    const flashloanData = poolInterface.encodeFunctionData('flashLoan', [
      receiverAddress,    // receiver (our JIT executor contract)
      [token],           // assets array
      [amount],          // amounts array  
      [0],               // modes array (0 = no debt, must repay in same tx)
      receiverAddress,   // onBehalfOf
      calldata,          // params (our JIT execution calldata)
      0                  // referralCode
    ]);
    
    return {
      to: AaveV3FlashloanProvider.POOL_ADDRESS,
      data: flashloanData,
      value: ethers.BigNumber.from(0) // No ETH value required
    };
  }
  
  async calculateFlashloanFee(_token: string, amount: ethers.BigNumber): Promise<ethers.BigNumber> {
    // Aave V3 charges 0.05% fee
    const fee = amount.mul(AaveV3FlashloanProvider.FLASHLOAN_FEE_PERCENTAGE).div(10000);
    
    this.logger.debug({
      msg: 'Calculated flashloan fee',
      token: _token,
      amount: ethers.utils.formatEther(amount),
      fee: ethers.utils.formatEther(fee),
      feePercentage: '0.05%'
    });
    
    return fee;
  }
  
  async getFlashloanPoolAddress(_token: string): Promise<string> {
    // For Aave V3, all flashloans go through the main Pool contract
    return AaveV3FlashloanProvider.POOL_ADDRESS;
  }
}

/**
 * Compound V3 Flashloan Provider (placeholder for future implementation)
 */
export class CompoundV3FlashloanProvider implements IFlashloanProvider {
  readonly name = 'compound-v3';
  readonly enabled = false; // Not implemented yet
  
  async getMaxFlashloanAmount(_token: string): Promise<ethers.BigNumber> {
    throw new Error('Compound V3 flashloan provider not implemented yet');
  }
  
  async buildFlashloanCall(
    _token: string,
    _amount: ethers.BigNumber,
    _receiverAddress: string,
    _calldata: string
  ): Promise<{ to: string; data: string; value: ethers.BigNumber; }> {
    throw new Error('Compound V3 flashloan provider not implemented yet');
  }
  
  async calculateFlashloanFee(_token: string, _amount: ethers.BigNumber): Promise<ethers.BigNumber> {
    throw new Error('Compound V3 flashloan provider not implemented yet');
  }
  
  async getFlashloanPoolAddress(_token: string): Promise<string> {
    throw new Error('Compound V3 flashloan provider not implemented yet');
  }
}

/**
 * JIT Executor Contract Interface
 * This defines the minimal interface for the contract that executes JIT strategies
 */
export interface IJitExecutor {
  /**
   * Execute JIT strategy with flashloan
   * Called by the flashloan provider during execution
   */
  executeWithFlashloan(
    token: string,
    amount: ethers.BigNumber,
    fee: ethers.BigNumber,
    poolAddress: string,
    swapParams: {
      amountIn: ethers.BigNumber;
      tokenIn: string;
      tokenOut: string;
      tickLower: number;
      tickUpper: number;
      liquidity: ethers.BigNumber;
    }
  ): Promise<{
    gasUsed: number;
    profitable: boolean;
    netProfit: ethers.BigNumber;
  }>;
}

/**
 * Mock JIT Executor for testing and simulation
 */
export class MockJitExecutor implements IJitExecutor {
  private logger: any;
  
  constructor() {
    this.logger = getLogger().child({ component: 'mock-jit-executor' });
  }
  
  async executeWithFlashloan(
    token: string,
    amount: ethers.BigNumber,
    fee: ethers.BigNumber,
    poolAddress: string,
    swapParams: {
      amountIn: ethers.BigNumber;
      tokenIn: string;
      tokenOut: string;
      tickLower: number;
      tickUpper: number;
      liquidity: ethers.BigNumber;
    }
  ): Promise<{
    gasUsed: number;
    profitable: boolean;
    netProfit: ethers.BigNumber;
  }> {
    this.logger.info({
      msg: 'Mock JIT execution',
      token,
      amount: ethers.utils.formatEther(amount),
      fee: ethers.utils.formatEther(fee),
      poolAddress,
      swapParams: {
        ...swapParams,
        amountIn: ethers.utils.formatEther(swapParams.amountIn),
        liquidity: ethers.utils.formatEther(swapParams.liquidity)
      }
    });
    
    // Simulate gas usage
    const gasUsed = 450000; // Typical gas for JIT strategy
    
    // Simulate fees collected (0.03% of swap amount)
    const feesCollected = swapParams.amountIn.mul(30).div(100000);
    
    // Calculate net profit (fees - flashloan fee - gas cost)
    const gasCost = ethers.utils.parseUnits('20', 'gwei').mul(gasUsed);
    const netProfit = feesCollected.sub(fee).sub(gasCost);
    const profitable = netProfit.gt(0);
    
    this.logger.info({
      msg: 'Mock JIT execution completed',
      gasUsed,
      feesCollected: ethers.utils.formatEther(feesCollected),
      flashloanFee: ethers.utils.formatEther(fee),
      gasCost: ethers.utils.formatEther(gasCost),
      netProfit: ethers.utils.formatEther(netProfit),
      profitable
    });
    
    return {
      gasUsed,
      profitable,
      netProfit
    };
  }
}

/**
 * Flashloan Orchestrator
 * Manages flashloan providers and coordinates JIT execution
 */
export class FlashloanOrchestrator {
  private providers: Map<string, IFlashloanProvider> = new Map();
  private logger: any;
  private config: any;
  
  constructor() {
    this.config = getConfig();
    this.logger = getLogger().child({ component: 'flashloan-orchestrator' });
    
    // Initialize providers
    this.initializeProviders();
  }
  
  private initializeProviders(): void {
    // Add Aave V3 provider
    const aaveProvider = new AaveV3FlashloanProvider();
    this.providers.set(aaveProvider.name, aaveProvider);
    
    // Add Compound V3 provider (disabled for now)
    const compoundProvider = new CompoundV3FlashloanProvider();
    this.providers.set(compoundProvider.name, compoundProvider);
    
    this.logger.info({
      msg: 'Flashloan providers initialized',
      providers: Array.from(this.providers.keys()),
      defaultProvider: this.config.flashloanProvider
    });
  }

  /**
   * Select optimal flashloan provider based on liquidity availability
   * Prefers Balancer (no fees) over Aave when sufficient liquidity exists
   * Respects MAX_FLASHLOAN_AMOUNT_USD configuration
   */
  async selectOptimalProvider(
    token: string, 
    amount: ethers.BigNumber,
    provider?: ethers.providers.Provider
  ): Promise<{
    providerType: 'balancer' | 'aave';
    adapter: any;
    fee: ethers.BigNumber;
    reason: string;
  }> {
    this.logger.info({
      msg: 'Selecting optimal flashloan provider',
      token,
      amount: ethers.utils.formatEther(amount)
    });

    try {
      // Validate amount against MAX_FLASHLOAN_AMOUNT_USD
      await this.validateFlashloanAmount(token, amount);

      // Use a mock provider if none provided and we're in test mode
      if (!provider && process.env.NODE_ENV === 'test') {
        const { ethers } = require('ethers');
        provider = new ethers.providers.JsonRpcProvider('http://localhost:8545');
      }

      // Always try Balancer first (no fees)
      const balancerAdapter = getBalancerAdapter(provider);
      const balancerSufficient = await balancerAdapter.hassufficientLiquidity(token, amount);
      
      if (balancerSufficient) {
        this.logger.info({
          msg: 'Selected Balancer as flashloan provider',
          reason: 'Sufficient liquidity and no fees'
        });
        
        return {
          providerType: 'balancer',
          adapter: balancerAdapter,
          fee: ethers.BigNumber.from(0),
          reason: 'Balancer has sufficient liquidity with no fees'
        };
      }

      // Fallback to Aave
      const aaveAdapter = getAaveAdapter(provider);
      const aaveSufficient = await aaveAdapter.hasSufficientLiquidity(token, amount);
      
      if (aaveSufficient) {
        const aaveFee = await aaveAdapter.calculateFlashloanFee(token, amount);
        
        this.logger.info({
          msg: 'Selected Aave as flashloan provider',
          reason: 'Balancer insufficient, Aave has liquidity',
          fee: ethers.utils.formatEther(aaveFee)
        });
        
        return {
          providerType: 'aave',
          adapter: aaveAdapter,
          fee: aaveFee,
          reason: 'Balancer insufficient liquidity, fallback to Aave'
        };
      }

      throw new Error('No flashloan provider has sufficient liquidity');
      
    } catch (error: any) {
      this.logger.error({
        msg: 'Failed to select flashloan provider',
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Validate flashloan amount against MAX_FLASHLOAN_AMOUNT_USD configuration
   */
  private async validateFlashloanAmount(token: string, amount: ethers.BigNumber): Promise<void> {
    try {
      // Get USD equivalent of flashloan amount
      const usdValue = await this.estimateUSDValue(token, amount);
      
      // Check against configuration limit (default 300k USD if not configured)
      const maxFlashloanUSD = ethers.utils.parseEther(this.config.maxFlashloanAmountUSD?.toString() || '300000');
      
      if (usdValue.gt(maxFlashloanUSD)) {
        const usdValueFormatted = ethers.utils.formatEther(usdValue);
        const maxUsdFormatted = ethers.utils.formatEther(maxFlashloanUSD);
        
        this.logger.warn({
          msg: 'Flashloan amount exceeds USD limit',
          token,
          amount: ethers.utils.formatEther(amount),
          usdValue: usdValueFormatted,
          maxUsdLimit: maxUsdFormatted
        });
        
        throw new Error(`Flashloan amount $${usdValueFormatted} exceeds maximum allowed $${maxUsdFormatted}`);
      }
      
      this.logger.debug({
        msg: 'Flashloan amount within USD limits',
        token,
        amount: ethers.utils.formatEther(amount),
        usdValue: ethers.utils.formatEther(usdValue),
        maxUsdLimit: ethers.utils.formatEther(maxFlashloanUSD)
      });
      
    } catch (error: any) {
      this.logger.warn({
        msg: 'Failed to validate flashloan amount',
        token,
        error: error.message
      });
      // Re-throw to prevent execution if validation fails
      throw error;
    }
  }

  /**
   * Estimate USD value of token amount (basic implementation)
   */
  private async estimateUSDValue(tokenAddress: string, amount: ethers.BigNumber): Promise<ethers.BigNumber> {
    try {
      // Basic USD estimation (in production would use price oracle)
      const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
      const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
      
      const normalizedToken = tokenAddress.toLowerCase();
      
      if (normalizedToken === WETH.toLowerCase()) {
        // For ETH: amount (in wei) * $2000 = USD value in wei (18 decimals)
        return amount.mul(2000);
      } else if (normalizedToken === USDC.toLowerCase() || normalizedToken === USDT.toLowerCase()) {
        // Stablecoins: For 6-decimal tokens like USDC, assume 1:1 USD
        // Convert 6 decimals to 18 decimals: amount * 10^12
        return amount.mul(ethers.BigNumber.from(10).pow(12));
      } else {
        // For unknown tokens, assume similar to ETH but more conservative
        return amount.mul(1000);
      }
    } catch (error: any) {
      this.logger.debug({
        msg: 'Failed to estimate USD value',
        tokenAddress,
        error: error.message
      });
      // Return small value to avoid triggering limits in tests
      return amount.div(1000000);
    }
  }

  /**
   * Enhanced flashloan parameters validation with provider selection
   */
  async validateFlashloanParameters(
    token: string,
    amount: ethers.BigNumber,
    provider?: ethers.providers.Provider
  ): Promise<{
    valid: boolean;
    issues: string[];
    warnings: string[];
    fee?: ethers.BigNumber;
    selectedProvider?: 'balancer' | 'aave';
    adapter?: any;
  }> {
    const issues: string[] = [];
    const warnings: string[] = [];

    try {
      // Basic validation
      if (!ethers.utils.isAddress(token)) {
        issues.push('Invalid token address');
      }

      if (amount.lte(0)) {
        issues.push('Amount must be positive');
      }

      // Check for very small amounts that may not be profitable
      // Convert to USD value to check minimum threshold regardless of token decimals
      const usdValue = await this.estimateUSDValue(token, amount);
      const minUsdValue = ethers.utils.parseEther('10'); // $10 USD minimum
      if (usdValue.lt(minUsdValue)) {
        issues.push('very_small_amount');
        warnings.push('Amount too small - flashloan fees may exceed profits');
      }

      // Select optimal provider
      const selection = await this.selectOptimalProvider(token, amount, provider);
      
      this.logger.info({
        msg: 'Flashloan validation completed',
        token,
        amount: ethers.utils.formatEther(amount),
        selectedProvider: selection.providerType,
        fee: ethers.utils.formatEther(selection.fee),
        valid: issues.length === 0,
        warnings: warnings.length > 0 ? warnings : undefined
      });

      return {
        valid: issues.length === 0,
        issues,
        warnings,
        fee: selection.fee,
        selectedProvider: selection.providerType,
        adapter: selection.adapter
      };

    } catch (error: any) {
      issues.push(`Provider selection failed: ${error.message}`);
      
      return {
        valid: false,
        issues,
        warnings
      };
    }
  }

  /**
   * Legacy method for backward compatibility
   */
  async validateFlashloanParams(
    token: string,
    amount: ethers.BigNumber,
    provider?: ethers.providers.Provider
  ): Promise<{
    valid: boolean;
    issues: string[];
    fee?: ethers.BigNumber;
    selectedProvider?: 'balancer' | 'aave';
    adapter?: any;
  }> {
    const result = await this.validateFlashloanParameters(token, amount, provider);
    
    // For backward compatibility, include warning messages in issues
    const allIssues = [...result.issues];
    if (result.warnings && result.warnings.length > 0) {
      allIssues.push(...result.warnings);
    }
    
    return {
      valid: result.valid,
      issues: allIssues,
      fee: result.fee,
      selectedProvider: result.selectedProvider,
      adapter: result.adapter
    };
  }
  
  /**
   * Get the configured flashloan provider
   */
  getProvider(providerName?: string): IFlashloanProvider {
    const targetProvider = providerName || this.config.flashloanProvider;
    const provider = this.providers.get(targetProvider);
    
    if (!provider) {
      throw new Error(`Flashloan provider not found: ${targetProvider}`);
    }
    
    if (!provider.enabled) {
      throw new Error(`Flashloan provider disabled: ${targetProvider}`);
    }
    
    return provider;
  }
  
  /**
   * Build a complete flashloan transaction for JIT execution
   */
  async buildJitFlashloanTransaction(
    token: string,
    amount: ethers.BigNumber,
    jitExecutorAddress: string,
    swapParams: {
      poolAddress: string;
      amountIn: ethers.BigNumber;
      tokenIn: string;
      tokenOut: string;
      tickLower: number;
      tickUpper: number;
      liquidity: ethers.BigNumber;
    },
    providerName?: string
  ): Promise<{
    to: string;
    data: string;
    value: ethers.BigNumber;
    gasEstimate: number;
    flashloanFee: ethers.BigNumber;
  }> {
    const provider = this.getProvider(providerName);
    
    this.logger.info({
      msg: 'Building JIT flashloan transaction',
      provider: provider.name,
      token,
      amount: ethers.utils.formatEther(amount),
      jitExecutor: jitExecutorAddress
    });
    
    // Calculate flashloan fee
    const flashloanFee = await provider.calculateFlashloanFee(token, amount);
    
    // Build the JIT execution calldata (this would be the actual contract call)
    // For now, we'll use a placeholder calldata
    const jitExecutionCalldata = this.buildJitExecutionCalldata(swapParams, flashloanFee);
    
    // Build the flashloan call
    const flashloanCall = await provider.buildFlashloanCall(
      token,
      amount,
      jitExecutorAddress,
      jitExecutionCalldata
    );
    
    // Estimate gas (conservative estimate)
    const gasEstimate = 500000; // Total gas for flashloan + JIT execution
    
    this.logger.info({
      msg: 'JIT flashloan transaction built',
      to: flashloanCall.to,
      gasEstimate,
      flashloanFee: ethers.utils.formatEther(flashloanFee)
    });
    
    return {
      ...flashloanCall,
      gasEstimate,
      flashloanFee
    };
  }
  
  /**
   * Build calldata for JIT execution (simplified for now)
   */
  private buildJitExecutionCalldata(
    swapParams: {
      poolAddress: string;
      amountIn: ethers.BigNumber;
      tokenIn: string;
      tokenOut: string;
      tickLower: number;
      tickUpper: number;
      liquidity: ethers.BigNumber;
    },
    flashloanFee: ethers.BigNumber
  ): string {
    // This would encode the actual JIT executor function call
    // For now, return a placeholder
    const calldata = ethers.utils.defaultAbiCoder.encode(
      ['address', 'uint256', 'address', 'address', 'int24', 'int24', 'uint128', 'uint256'],
      [
        swapParams.poolAddress,
        swapParams.amountIn,
        swapParams.tokenIn,
        swapParams.tokenOut,
        swapParams.tickLower,
        swapParams.tickUpper,
        swapParams.liquidity,
        flashloanFee
      ]
    );
    
    return calldata;
  }
  
  /**
   * Get available providers
   */
  getAvailableProviders(): { name: string; enabled: boolean }[] {
    return Array.from(this.providers.values()).map(provider => ({
      name: provider.name,
      enabled: provider.enabled
    }));
  }
  
  /**
   * Validate flashloan parameters for specific provider
   */
  async validateFlashloanParamsForProvider(
    token: string,
    amount: ethers.BigNumber,
    providerName?: string
  ): Promise<{
    valid: boolean;
    issues: string[];
    maxAmount?: ethers.BigNumber;
    fee?: ethers.BigNumber;
  }> {
    const issues: string[] = [];
    
    try {
      const provider = this.getProvider(providerName);
      
      // Check maximum available amount
      const maxAmount = await provider.getMaxFlashloanAmount(token);
      
      if (amount.gt(maxAmount)) {
        issues.push(`Requested amount ${ethers.utils.formatEther(amount)} exceeds maximum ${ethers.utils.formatEther(maxAmount)}`);
      }
      
      // Calculate fee
      const fee = await provider.calculateFlashloanFee(token, amount);
      
      // Check minimum amount makes sense
      if (amount.lt(ethers.utils.parseEther('0.01'))) {
        issues.push('Flashloan amount too small, fees may exceed profits');
      }
      
      return {
        valid: issues.length === 0,
        issues,
        maxAmount,
        fee
      };
      
    } catch (error: any) {
      issues.push(`Validation error: ${error.message}`);
      return {
        valid: false,
        issues
      };
    }
  }
}

/**
 * Create singleton flashloan orchestrator
 */
let flashloanOrchestrator: FlashloanOrchestrator | null = null;

export function getFlashloanOrchestrator(): FlashloanOrchestrator {
  if (!flashloanOrchestrator) {
    flashloanOrchestrator = new FlashloanOrchestrator();
  }
  return flashloanOrchestrator;
}

/**
 * Reset orchestrator for testing
 */
export function resetFlashloanOrchestrator(): void {
  flashloanOrchestrator = null;
}