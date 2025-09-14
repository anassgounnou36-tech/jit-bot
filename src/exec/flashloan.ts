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
   */
  async selectOptimalProvider(
    token: string, 
    amount: ethers.BigNumber,
    provider?: ethers.providers.Provider
  ): Promise<{
    providerType: 'balancer' | 'aave';
    adapter: any;
    fee: ethers.BigNumber;
    maxAmount: ethers.BigNumber;
    reason: string;
  }> {
    this.logger.info({
      msg: 'Selecting optimal flashloan provider',
      token,
      amount: ethers.utils.formatEther(amount)
    });

    try {
      // Always try Balancer first (no fees)
      const balancerAdapter = getBalancerAdapter(provider);
      const balancerSufficient = await balancerAdapter.hassufficientLiquidity(token, amount);
      
      if (balancerSufficient) {
        const maxAmount = await balancerAdapter.getMaxFlashloanAmount(token);
        
        this.logger.info({
          msg: 'Selected Balancer as flashloan provider',
          reason: 'Sufficient liquidity and no fees'
        });
        
        return {
          providerType: 'balancer',
          adapter: balancerAdapter,
          fee: ethers.BigNumber.from(0),
          maxAmount,
          reason: 'Balancer has sufficient liquidity with no fees'
        };
      }

      // Fallback to Aave
      const aaveAdapter = getAaveAdapter(provider);
      const aaveSufficient = await aaveAdapter.hasSufficientLiquidity(token, amount);
      
      if (aaveSufficient) {
        const aaveFee = await aaveAdapter.calculateFlashloanFee(token, amount);
        const maxAmount = await aaveAdapter.getMaxFlashloanAmount(token);
        
        this.logger.info({
          msg: 'Selected Aave as flashloan provider',
          reason: 'Balancer insufficient, Aave has liquidity',
          fee: ethers.utils.formatEther(aaveFee)
        });
        
        return {
          providerType: 'aave',
          adapter: aaveAdapter,
          fee: aaveFee,
          maxAmount,
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
   * Enhanced flashloan parameters validation with provider selection
   */
  async validateFlashloanParams(
    token: string,
    amount: ethers.BigNumber,
    provider?: ethers.providers.Provider
  ): Promise<{
    valid: boolean;
    issues: string[];
    fee?: ethers.BigNumber;
    maxAmount?: ethers.BigNumber;
    selectedProvider?: 'balancer' | 'aave';
    adapter?: any;
  }> {
    const issues: string[] = [];

    try {
      // Basic validation
      if (!ethers.utils.isAddress(token)) {
        issues.push('Invalid token address');
      }

      if (amount.lte(0)) {
        issues.push('Amount must be positive');
      }

      // Select optimal provider
      const selection = await this.selectOptimalProvider(token, amount, provider);
      
      this.logger.info({
        msg: 'Flashloan validation completed',
        token,
        amount: ethers.utils.formatEther(amount),
        selectedProvider: selection.providerType,
        fee: ethers.utils.formatEther(selection.fee),
        valid: issues.length === 0
      });

      return {
        valid: issues.length === 0,
        issues,
        fee: selection.fee,
        maxAmount: selection.maxAmount,
        selectedProvider: selection.providerType,
        adapter: selection.adapter
      };

    } catch (error: any) {
      issues.push(`Provider selection failed: ${error.message}`);
      
      return {
        valid: false,
        issues
      };
    }
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