import { ethers } from 'ethers';
import { getLogger } from '../logging/logger';
import { getConfig } from '../config';

/**
 * Balancer Flashloan Adapter
 * Handles Balancer Vault flashloan integration with automatic liquidity checking
 */
export class BalancerAdapter {
  private logger: any;
  private config: any;
  private provider: ethers.providers.Provider;

  // Balancer Vault address (Ethereum mainnet)
  private static readonly VAULT_ADDRESS = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';
  
  // Balancer has no flashloan fees
  private static readonly FLASHLOAN_FEE_PERCENTAGE = 0;

  constructor(provider: ethers.providers.Provider) {
    this.logger = getLogger().child({ component: 'balancer-adapter' });
    this.config = getConfig();
    this.provider = provider;
  }

  /**
   * Check if Balancer has sufficient liquidity for a flashloan
   */
  async hassufficientLiquidity(token: string, amount: ethers.BigNumber): Promise<boolean> {
    try {
      // Query Balancer Vault for token balance
      const vaultBalance = await this.getVaultTokenBalance(token);
      
      this.logger.debug({
        msg: 'Checking Balancer vault liquidity',
        token,
        requestedAmount: ethers.utils.formatEther(amount),
        vaultBalance: ethers.utils.formatEther(vaultBalance),
        sufficient: vaultBalance.gte(amount)
      });

      return vaultBalance.gte(amount);
    } catch (error: any) {
      this.logger.warn({
        msg: 'Failed to check Balancer vault liquidity',
        token,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Get token balance in Balancer Vault
   */
  async getVaultTokenBalance(token: string): Promise<ethers.BigNumber> {
    try {
      // Balancer Vault ABI for getInternalBalance
      const vaultAbi = [
        'function getInternalBalance(address user, address[] memory tokens) external view returns (uint256[] memory)'
      ];

      const vault = new ethers.Contract(BalancerAdapter.VAULT_ADDRESS, vaultAbi, this.provider);
      
      // Get vault's internal balance for the token
      const balances = await vault.getInternalBalance(BalancerAdapter.VAULT_ADDRESS, [token]);
      
      return balances[0] || ethers.BigNumber.from(0);
    } catch (error: any) {
      this.logger.warn({
        msg: 'Failed to get Balancer vault balance',
        token,
        error: error.message
      });
      
      // Return conservative fallback
      return ethers.BigNumber.from(0);
    }
  }

  /**
   * Build Balancer flashloan call data
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
      msg: 'Building Balancer flashloan call',
      token,
      amount: ethers.utils.formatEther(amount),
      receiver: receiverAddress
    });

    // Balancer Vault ABI for flashLoan
    const vaultInterface = new ethers.utils.Interface([
      'function flashLoan(address recipient, address[] memory tokens, uint256[] memory amounts, bytes memory userData) external'
    ]);

    const flashloanData = vaultInterface.encodeFunctionData('flashLoan', [
      receiverAddress,    // recipient (our JIT executor contract)
      [token],           // tokens array
      [amount],          // amounts array
      userData           // userData (our JIT execution parameters)
    ]);

    return {
      to: BalancerAdapter.VAULT_ADDRESS,
      data: flashloanData,
      value: ethers.BigNumber.from(0)
    };
  }

  /**
   * Calculate flashloan fee (Balancer has no fees)
   */
  async calculateFlashloanFee(token: string, amount: ethers.BigNumber): Promise<ethers.BigNumber> {
    return ethers.BigNumber.from(0);
  }

  /**
   * Get maximum flashloan amount available
   */
  async getMaxFlashloanAmount(token: string): Promise<ethers.BigNumber> {
    return this.getVaultTokenBalance(token);
  }

  /**
   * Get the Balancer Vault address
   */
  getVaultAddress(): string {
    return BalancerAdapter.VAULT_ADDRESS;
  }

  /**
   * Check if Balancer flashloan is available for a token
   */
  async isFlashloanAvailable(token: string): Promise<boolean> {
    try {
      const maxAmount = await this.getMaxFlashloanAmount(token);
      return maxAmount.gt(0);
    } catch (error: any) {
      this.logger.warn({
        msg: 'Failed to check Balancer flashloan availability',
        token,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Validate flashloan parameters for Balancer
   */
  async validateFlashloanParams(token: string, amount: ethers.BigNumber): Promise<{
    valid: boolean;
    issues: string[];
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

    // Check if Balancer has sufficient liquidity
    if (!(await this.hassufficientLiquidity(token, amount))) {
      issues.push('Insufficient Balancer vault liquidity');
    }

    return {
      valid: issues.length === 0,
      issues
    };
  }
}

/**
 * Get or create Balancer adapter instance
 */
let balancerAdapter: BalancerAdapter | null = null;

export function getBalancerAdapter(provider?: ethers.providers.Provider): BalancerAdapter {
  if (!balancerAdapter || provider) {
    if (!provider) {
      throw new Error('Provider required for first-time Balancer adapter creation');
    }
    balancerAdapter = new BalancerAdapter(provider);
  }
  return balancerAdapter;
}

/**
 * Reset adapter for testing
 */
export function resetBalancerAdapter(): void {
  balancerAdapter = null;
}