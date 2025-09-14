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
  
  // Standard Aave V3 fee: 0.05%
  private static readonly FLASHLOAN_FEE_PERCENTAGE = 5; // 0.05% = 5/10000

  // Simulation liquidity (keyed by token address)
  private static simLiquidity: Record<string, number> = {
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': parseFloat(process.env.SIM_AAVE_USDC ?? '100000')
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
   * Get fee in basis points
   */
  public static feeBps(): number { 
    return 5; 
  }

  /**
   * Calculate fee for amount
   */
  public static calculateFee(amount: number): number {
    return amount * (AaveAdapter.feeBps() / 10000);
  }

  /**
   * Check if Aave has sufficient liquidity for a flashloan
   */
  async hasSufficientLiquidity(token: string, amount: ethers.BigNumber): Promise<boolean> {
    try {
      const availableLiquidity = await this.getAvailableLiquidity(token);
      
      this.logger.debug({
        msg: 'Checking Aave liquidity',
        token,
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
    const simulationMode = process.env.NODE_ENV === 'test' || process.env.SIMULATION_MODE === 'true';
    const normalizedToken = ensureAddress(token, { simulationMode });
    
    if (simulationMode) {
      const simBalance = AaveAdapter.simLiquidity[normalizedToken];
      const balance = typeof simBalance === 'number' ? simBalance : 0;
      return ethers.utils.parseEther(balance.toString());
    }

    try {
      // Aave Pool ABI for getReserveData
      const poolAbi = [
        'function getReserveData(address asset) external view returns (tuple(tuple(uint256 data) configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))'
      ];

      const pool = new ethers.Contract(AaveAdapter.POOL_ADDRESS, poolAbi, this.provider);
      const reserveData = await pool.getReserveData(normalizedToken);
      
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
        token: normalizedToken,
        error: error.message
      });
      
      // Return conservative fallback
      return ethers.utils.parseEther('100');
    }
  }

  /**
   * Check if Aave has liquidity for amount
   */
  async hasLiquidity(token: string, requestedAmount: number): Promise<boolean> {
    const available = await this.getAvailableLiquidity(token);
    const availableEther = parseFloat(ethers.utils.formatEther(available));
    return availableEther >= requestedAmount;
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
   * Calculate Aave flashloan fee
   */
  async calculateFlashloanFee(token: string, amount: ethers.BigNumber): Promise<ethers.BigNumber> {
    try {
      // Aave V3 standard fee is 0.05%
      const fee = amount.mul(AaveAdapter.FLASHLOAN_FEE_PERCENTAGE).div(10000);
      
      this.logger.debug({
        msg: 'Calculated Aave flashloan fee',
        token,
        amount: ethers.utils.formatEther(amount),
        fee: ethers.utils.formatEther(fee),
        feePercentage: `${AaveAdapter.FLASHLOAN_FEE_PERCENTAGE / 100}%`
      });

      return fee;
    } catch (error: any) {
      this.logger.warn({
        msg: 'Failed to calculate Aave flashloan fee',
        token,
        error: error.message
      });
      
      // Return conservative estimate
      return amount.mul(5).div(10000); // 0.05%
    }
  }

  /**
   * Get maximum flashloan amount available
   */
  async getMaxFlashloanAmount(token: string): Promise<ethers.BigNumber> {
    return this.getAvailableLiquidity(token);
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
  if (!aaveAdapter) {
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