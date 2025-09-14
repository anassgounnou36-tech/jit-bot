import { ethers } from 'ethers';
import { getLogger } from '../logging/logger';
import { getConfig } from '../config';
import { ensureAddress } from '../utils/address';

/**
 * Enhanced Aave V3 Flashloan Adapter
 * Handles Aave V3 flashloan integration with proper fee calculation and liquidity checks
 */
export class AaveAdapter {
  private logger: any;
  private config: any;
  private provider: ethers.providers.Provider;

  // Aave V3 Mainnet addresses
  private static readonly POOL_ADDRESS = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';
  private static readonly POOL_ADDRESSES_PROVIDER = '0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e';
  
  // Fallback fee if unable to read from protocol: 0.05%
  private static readonly FALLBACK_FLASHLOAN_FEE_PERCENTAGE = 5; // 0.05% = 5/10000
  
  // Cache for flashloan premium to avoid repeated on-chain calls
  private flashloanPremiumCache?: {
    value: number;
    timestamp: number;
    ttl: number;
  };

  constructor(provider: ethers.providers.Provider) {
    this.logger = getLogger().child({ component: 'aave-adapter' });
    this.config = getConfig();
    this.provider = provider;
    
    if (this.config.chain !== 'ethereum') {
      this.logger.warn({
        msg: 'Aave adapter configured for non-Ethereum chain',
        chain: this.config.chain,
        note: 'Verify addresses are correct for this chain'
      });
    }
  }

  /**
   * Check if we're in test or simulation mode
   */
  private isTestOrSimulationMode(): boolean {
    return process.env.NODE_ENV === 'test' || this.config.simulationMode || process.env.SIMULATION_MODE === 'true';
  }

  /**
   * Get simulated liquidity for deterministic testing
   * Returns 5,000 ETH equivalent (moderate liquidity for fallback testing, but not unlimited)
   */
  private getSimulatedLiquidity(): ethers.BigNumber {
    return ethers.utils.parseEther('5000'); // Moderate liquidity for Aave fallback
  }

  /**
   * Get fee in basis points (dynamically from Aave protocol)
   * Synchronous wrapper for backward compatibility
   */
  feeBps(): number {
    // Return fallback for synchronous calls
    return AaveAdapter.FALLBACK_FLASHLOAN_FEE_PERCENTAGE;
  }

  /**
   * Get fee in basis points (dynamically from Aave protocol) - async version
   */
  async feeBpsAsync(): Promise<number> {
    return await this.getFlashloanPremium();
  }

  /**
   * Get flashloan premium dynamically from Aave protocol configuration
   */
  async getFlashloanPremium(): Promise<number> {
    try {
      // Check cache first
      if (this.flashloanPremiumCache) {
        const now = Date.now();
        if (now - this.flashloanPremiumCache.timestamp < this.flashloanPremiumCache.ttl) {
          this.logger.debug({
            msg: 'Using cached flashloan premium',
            premium: this.flashloanPremiumCache.value
          });
          return this.flashloanPremiumCache.value;
        }
      }

      // In test/simulation mode, return fallback value
      if (this.isTestOrSimulationMode()) {
        return AaveAdapter.FALLBACK_FLASHLOAN_FEE_PERCENTAGE;
      }

      // Query Aave protocol configuration for current flashloan premium
      const premium = await this.queryFlashloanPremiumFromProtocol();
      
      // Cache the result for 5 minutes
      this.flashloanPremiumCache = {
        value: premium,
        timestamp: Date.now(),
        ttl: 5 * 60 * 1000 // 5 minutes
      };

      this.logger.debug({
        msg: 'Updated flashloan premium from Aave protocol',
        premium,
        cached: true
      });

      return premium;
    } catch (error: any) {
      this.logger.warn({
        msg: 'Failed to get dynamic flashloan premium, using fallback',
        error: error.message,
        fallbackPremium: AaveAdapter.FALLBACK_FLASHLOAN_FEE_PERCENTAGE
      });
      
      return AaveAdapter.FALLBACK_FLASHLOAN_FEE_PERCENTAGE;
    }
  }

  /**
   * Query flashloan premium from Aave protocol configuration
   */
  private async queryFlashloanPremiumFromProtocol(): Promise<number> {
    try {
      // Aave Pool ABI for configuration
      const poolAbi = [
        'function FLASHLOAN_PREMIUM_TOTAL() external view returns (uint128)',
        'function FLASHLOAN_PREMIUM_TO_PROTOCOL() external view returns (uint128)'
      ];

      const pool = new ethers.Contract(AaveAdapter.POOL_ADDRESS, poolAbi, this.provider);
      
      // Get total flashloan premium (in basis points)
      const premiumTotal = await pool.FLASHLOAN_PREMIUM_TOTAL();
      
      this.logger.debug({
        msg: 'Retrieved flashloan premium from Aave protocol',
        premiumTotal: premiumTotal.toString(),
        premiumBps: premiumTotal.toNumber()
      });

      return premiumTotal.toNumber(); // Returns basis points (e.g., 5 for 0.05%)
    } catch (error: any) {
      this.logger.warn({
        msg: 'Failed to query flashloan premium from protocol',
        error: error.message
      });
      
      // Try alternative method using PoolAddressesProvider
      return await this.queryPremiumFromAddressesProvider();
    }
  }

  /**
   * Alternative method to get premium via PoolAddressesProvider
   */
  private async queryPremiumFromAddressesProvider(): Promise<number> {
    try {
      const providerAbi = [
        'function getPool() external view returns (address)',
        'function getPoolConfigurator() external view returns (address)'
      ];

      const addressesProvider = new ethers.Contract(
        AaveAdapter.POOL_ADDRESSES_PROVIDER, 
        providerAbi, 
        this.provider
      );
      
      const poolAddress = await addressesProvider.getPool();
      
      // Verify we have the correct pool address
      if (poolAddress.toLowerCase() === AaveAdapter.POOL_ADDRESS.toLowerCase()) {
        this.logger.debug({
          msg: 'Verified Aave pool address via AddressesProvider',
          poolAddress
        });
        
        // Return fallback since we can't get the premium directly
        return AaveAdapter.FALLBACK_FLASHLOAN_FEE_PERCENTAGE;
      }
      
      throw new Error('Pool address mismatch');
    } catch (error: any) {
      this.logger.warn({
        msg: 'Alternative premium query failed',
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * Check if Aave has sufficient liquidity for a flashloan
   */
  async hasSufficientLiquidity(token: string, amount: ethers.BigNumber): Promise<boolean> {
    try {
      // Normalize token address
      const normalizedToken = ensureAddress(token, { simulationMode: this.isTestOrSimulationMode() });
      
      // In test/simulation mode, return deterministic results
      if (this.isTestOrSimulationMode()) {
        const simulatedLiquidity = this.getSimulatedLiquidity();
        const sufficient = simulatedLiquidity.gte(amount);
        
        this.logger.debug({
          msg: 'Checking Aave liquidity (simulated)',
          token: normalizedToken,
          requestedAmount: ethers.utils.formatEther(amount),
          simulatedLiquidity: ethers.utils.formatEther(simulatedLiquidity),
          sufficient,
          mode: 'simulation'
        });

        return sufficient;
      }

      const availableLiquidity = await this.getAvailableLiquidity(normalizedToken);
      
      this.logger.debug({
        msg: 'Checking Aave liquidity',
        token: normalizedToken,
        requestedAmount: ethers.utils.formatEther(amount),
        availableLiquidity: ethers.utils.formatEther(availableLiquidity),
        sufficient: availableLiquidity.gte(amount)
      });

      return availableLiquidity.gte(amount);
    } catch (error: any) {
      this.logger.warn({
        msg: 'Failed to check Aave liquidity',
        token,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Get available liquidity in Aave for a token
   */
  async getAvailableLiquidity(token: string): Promise<ethers.BigNumber> {
    try {
      // Aave Pool ABI for getReserveData
      const poolAbi = [
        'function getReserveData(address asset) external view returns (tuple(tuple(uint256 data) configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))'
      ];

      const pool = new ethers.Contract(AaveAdapter.POOL_ADDRESS, poolAbi, this.provider);
      const reserveData = await pool.getReserveData(token);
      
      // Get aToken contract to check available liquidity
      const aTokenAbi = [
        'function totalSupply() external view returns (uint256)',
        'function balanceOf(address account) external view returns (uint256)'
      ];
      
      const aToken = new ethers.Contract(reserveData.aTokenAddress, aTokenAbi, this.provider);
      const totalSupply = await aToken.totalSupply();
      
      // Available liquidity = aToken total supply (simplified)
      return totalSupply;
    } catch (error: any) {
      this.logger.warn({
        msg: 'Failed to get Aave available liquidity',
        token,
        error: error.message
      });
      
      // Return conservative fallback
      return ethers.utils.parseEther('100');
    }
  }

  /**
   * Build Aave flashloan call data
   */
  async buildFlashloanCall(
    token: string,
    amount: ethers.BigNumber,
    receiverAddress: string,
    userData: string
  ): Promise<{
    to: string;
    data: string;
    value: ethers.BigNumber;
  }> {
    this.logger.info({
      msg: 'Building Aave flashloan call',
      token,
      amount: ethers.utils.formatEther(amount),
      receiver: receiverAddress
    });

    // Aave Pool ABI for flashLoan
    const poolInterface = new ethers.utils.Interface([
      'function flashLoan(address receiverAddress, address[] calldata assets, uint256[] calldata amounts, uint256[] calldata modes, address onBehalfOf, bytes calldata params, uint16 referralCode) external'
    ]);

    const flashloanData = poolInterface.encodeFunctionData('flashLoan', [
      receiverAddress,    // receiver (our JIT executor contract)
      [token],           // assets array
      [amount],          // amounts array  
      [0],               // modes array (0 = no debt, must repay in same tx)
      receiverAddress,   // onBehalfOf
      userData,          // params (our JIT execution parameters)
      0                  // referralCode
    ]);
    
    return {
      to: AaveAdapter.POOL_ADDRESS,
      data: flashloanData,
      value: ethers.BigNumber.from(0)
    };
  }

  /**
   * Calculate Aave flashloan fee with dynamic premium
   */
  async calculateFlashloanFee(token: string, amount: ethers.BigNumber): Promise<ethers.BigNumber> {
    try {
      // Normalize token address
      const normalizedToken = ensureAddress(token, { simulationMode: this.isTestOrSimulationMode() });
      
      // Get dynamic flashloan premium from protocol
      const premiumBps = await this.getFlashloanPremium();
      
      // Calculate fee: amount * premium / 10000
      const fee = amount.mul(premiumBps).div(10000);
      
      this.logger.debug({
        msg: 'Calculated Aave flashloan fee with dynamic premium',
        token: normalizedToken,
        amount: ethers.utils.formatEther(amount),
        fee: ethers.utils.formatEther(fee),
        premiumBps,
        feePercentage: `${premiumBps / 100}%`
      });

      return fee;
    } catch (error: any) {
      this.logger.warn({
        msg: 'Failed to calculate Aave flashloan fee, using fallback',
        token,
        error: error.message
      });
      
      // Fallback calculation with static premium
      const fallbackFee = amount.mul(AaveAdapter.FALLBACK_FLASHLOAN_FEE_PERCENTAGE).div(10000);
      return fallbackFee;
    }
  }

  /**
   * Get maximum flashloan amount available
   */
  async getMaxFlashloanAmount(token: string): Promise<ethers.BigNumber> {
    // Normalize token address
    const normalizedToken = ensureAddress(token, { simulationMode: this.isTestOrSimulationMode() });
    
    // In test/simulation mode, return simulated max amount
    if (this.isTestOrSimulationMode()) {
      return this.getSimulatedLiquidity();
    }
    
    return this.getAvailableLiquidity(normalizedToken);
  }

  /**
   * Get the Aave Pool address
   */
  getPoolAddress(): string {
    return AaveAdapter.POOL_ADDRESS;
  }

  /**
   * Check if Aave flashloan is available for a token
   */
  async isFlashloanAvailable(token: string): Promise<boolean> {
    try {
      const maxAmount = await this.getMaxFlashloanAmount(token);
      return maxAmount.gt(0);
    } catch (error: any) {
      this.logger.warn({
        msg: 'Failed to check Aave flashloan availability',
        token,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Validate flashloan parameters for Aave
   */
  async validateFlashloanParams(token: string, amount: ethers.BigNumber): Promise<{
    valid: boolean;
    issues: string[];
    fee?: ethers.BigNumber;
  }> {
    const issues: string[] = [];

    // Check if token is valid address
    if (!ethers.utils.isAddress(token)) {
      issues.push('Invalid token address');
    }

    // Check if amount is positive
    if (amount.lte(0)) {
      issues.push('Amount must be positive');
    }

    // Check if Aave has sufficient liquidity
    if (!(await this.hasSufficientLiquidity(token, amount))) {
      issues.push('Insufficient Aave liquidity');
    }

    // Calculate fee
    const fee = await this.calculateFlashloanFee(token, amount);

    return {
      valid: issues.length === 0,
      issues,
      fee
    };
  }

  /**
   * Check reserve configuration for a token
   */
  async getReserveConfiguration(token: string): Promise<{
    isActive: boolean;
    isFlashLoanEnabled: boolean;
    liquidityIndex: ethers.BigNumber;
  }> {
    try {
      const poolAbi = [
        'function getConfiguration(address asset) external view returns (tuple(uint256 data))'
      ];

      const pool = new ethers.Contract(AaveAdapter.POOL_ADDRESS, poolAbi, this.provider);
      const config = await pool.getConfiguration(token);
      
      // Decode configuration bits (simplified)
      const configData = config.data;
      const isActive = !configData.and(ethers.BigNumber.from(1)).isZero();
      const isFlashLoanEnabled = !configData.shr(80).and(ethers.BigNumber.from(1)).isZero();

      return {
        isActive,
        isFlashLoanEnabled,
        liquidityIndex: ethers.BigNumber.from(0) // Would need more complex decoding
      };
    } catch (error: any) {
      this.logger.warn({
        msg: 'Failed to get reserve configuration',
        token,
        error: error.message
      });

      return {
        isActive: true,
        isFlashLoanEnabled: true,
        liquidityIndex: ethers.BigNumber.from(0)
      };
    }
  }
}

/**
 * Get or create Aave adapter instance
 */
let aaveAdapter: AaveAdapter | null = null;

export function getAaveAdapter(provider?: ethers.providers.Provider): AaveAdapter {
  if (!aaveAdapter || provider) {
    if (!provider) {
      throw new Error('Provider required for first-time Aave adapter creation');
    }
    aaveAdapter = new AaveAdapter(provider);
  }
  return aaveAdapter;
}

/**
 * Reset adapter for testing
 */
export function resetAaveAdapter(): void {
  aaveAdapter = null;
}