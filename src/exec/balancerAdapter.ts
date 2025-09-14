import { ethers } from 'ethers';
import { getLogger } from '../logging/logger';
import { ensureAddress } from '../utils/address';

/**
 * Balancer Flashloan Adapter
 * Handles Balancer Vault flashloan integration with automatic liquidity checking
 */
export class BalancerAdapter {
  private logger: any;
  private provider: ethers.providers.Provider;

  // Balancer Vault address (Ethereum mainnet)
  private static readonly VAULT_ADDRESS = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';
  
  // Simulation vault balances (keyed by token address)
  private static simVault: Record<string, number> = {
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': parseFloat(process.env.SIM_BALANCER_USDC ?? '500')
  };

  constructor(provider: ethers.providers.Provider) {
    this.logger = getLogger().child({ component: 'balancer-adapter' });
    this.provider = provider;
  }

  /**
   * Get fee in basis points (Balancer has no fees)
   */
  public static feeBps(): number { 
    return 0; 
  }

  /**
   * Check if Balancer has sufficient liquidity for a flashloan
   */
  async hassufficientLiquidity(token: string, amount: ethers.BigNumber): Promise<boolean> {
    try {
      const vaultBalance = await this.getVaultTokenBalance(token);
      const amountEther = parseFloat(ethers.utils.formatEther(amount));
      
      this.logger.debug({
        msg: 'Checking Balancer vault liquidity',
        token,
        requestedAmount: amountEther,
        vaultBalance: parseFloat(ethers.utils.formatEther(vaultBalance)),
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
    const simulationMode = process.env.NODE_ENV === 'test' || process.env.SIMULATION_MODE === 'true';
    const normalizedToken = ensureAddress(token, { simulationMode });
    
    if (simulationMode) {
      const simBalance = BalancerAdapter.simVault[normalizedToken];
      const balance = typeof simBalance === 'number' ? simBalance : 0;
      return ethers.utils.parseEther(balance.toString());
    }

    try {
      // Balancer Vault ABI for getInternalBalance
      const vaultAbi = [
        'function getInternalBalance(address user, address[] memory tokens) external view returns (uint256[] memory)'
      ];

      const vault = new ethers.Contract(BalancerAdapter.VAULT_ADDRESS, vaultAbi, this.provider);
      
      // Get vault's internal balance for the token
      const balances = await vault.getInternalBalance(BalancerAdapter.VAULT_ADDRESS, [normalizedToken]);
      
      return balances[0] || ethers.BigNumber.from(0);
    } catch (error: any) {
      this.logger.warn({
        msg: 'Failed to get Balancer vault balance',
        token: normalizedToken,
        error: error.message
      });
      
      // Return conservative fallback
      return ethers.BigNumber.from(0);
    }
  }

  /**
   * Check if Balancer has liquidity for amount
   */
  async hasLiquidity(token: string, requestedAmount: number): Promise<boolean> {
    const balance = await this.getVaultTokenBalance(token);
    const balanceEther = parseFloat(ethers.utils.formatEther(balance));
    return balanceEther >= requestedAmount;
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
  async calculateFlashloanFee(_token: string, _amount: ethers.BigNumber): Promise<ethers.BigNumber> {
    return ethers.constants.Zero;
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