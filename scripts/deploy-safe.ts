#!/usr/bin/env node

/**
 * Safe Deployment Script with DRY_RUN Support
 * 
 * This script provides a safe way to deploy JitExecutor contracts with:
 * - DRY_RUN mode for validation without deployment
 * - Constructor parameter introspection
 * - Gas estimation and confirmation
 * - CONFIRM_MAINNET guard for production
 * - Comprehensive validation checks
 * 
 * Usage:
 *   DRY_RUN=true ts-node scripts/deploy-safe.ts --network sepolia
 *   CONFIRM_MAINNET=true ts-node scripts/deploy-safe.ts --network mainnet
 * 
 * Environment Variables:
 *   DRY_RUN=true           - Run validation only, no deployment
 *   CONFIRM_MAINNET=true   - Required for mainnet deployment
 *   PRIVATE_KEY           - Deployer private key
 *   RPC_URL_HTTP          - RPC endpoint URL
 */

import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Deployment configuration
 */
interface DeploymentConfig {
  minProfitThreshold: string;  // In ETH (e.g., "0.01")
  maxLoanSize: string;        // In ETH (e.g., "100")
  profitRecipient: string;    // Address
  positionManager: string;    // Uniswap V3 Position Manager address
}

/**
 * Network configurations
 */
const NETWORK_CONFIGS: Record<string, {
  chainId: number;
  name: string;
  rpcUrl: string;
  positionManager: string;
  gasPrice?: string;
  confirmationBlocks: number;
}> = {
  mainnet: {
    chainId: 1,
    name: 'Ethereum Mainnet',
    rpcUrl: process.env.RPC_URL_HTTP || 'https://rpc.ankr.com/eth',
    positionManager: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
    gasPrice: '20000000000', // 20 gwei
    confirmationBlocks: 3
  },
  sepolia: {
    chainId: 11155111,
    name: 'Sepolia Testnet',
    rpcUrl: process.env.RPC_URL_HTTP || 'https://rpc.ankr.com/eth_sepolia',
    positionManager: '0x1238536071E1c677A632429e3655c799b22cDA52',
    gasPrice: '10000000000', // 10 gwei
    confirmationBlocks: 1
  },
  goerli: {
    chainId: 5,
    name: 'Goerli Testnet',
    rpcUrl: process.env.RPC_URL_HTTP || 'https://rpc.ankr.com/eth_goerli',
    positionManager: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
    gasPrice: '10000000000', // 10 gwei  
    confirmationBlocks: 1
  }
};

/**
 * Default deployment configurations by network
 */
const DEFAULT_CONFIGS: Record<string, DeploymentConfig> = {
  mainnet: {
    minProfitThreshold: '0.01',  // 0.01 ETH minimum profit
    maxLoanSize: '300',          // 300 ETH max flashloan
    profitRecipient: '',         // To be set by deployer
    positionManager: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88'
  },
  sepolia: {
    minProfitThreshold: '0.001', // 0.001 ETH for testing
    maxLoanSize: '10',           // 10 ETH for testing
    profitRecipient: '',         // To be set by deployer
    positionManager: '0x1238536071E1c677A632429e3655c799b22cDA52'
  },
  goerli: {
    minProfitThreshold: '0.001', // 0.001 ETH for testing
    maxLoanSize: '10',           // 10 ETH for testing
    profitRecipient: '',         // To be set by deployer
    positionManager: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88'
  }
};

/**
 * Deployment context
 */
class DeploymentContext {
  public network: string;
  public networkConfig: any;
  public config: DeploymentConfig;
  public provider: ethers.providers.JsonRpcProvider;
  public wallet: ethers.Wallet;
  public dryRun: boolean;
  public confirmMainnet: boolean;

  constructor(network: string) {
    this.network = network;
    this.dryRun = process.env.DRY_RUN === 'true';
    this.confirmMainnet = process.env.CONFIRM_MAINNET === 'true';
    
    // Validate network
    if (!NETWORK_CONFIGS[network]) {
      throw new Error(`Unsupported network: ${network}. Supported: ${Object.keys(NETWORK_CONFIGS).join(', ')}`);
    }
    
    this.networkConfig = NETWORK_CONFIGS[network];
    this.config = { ...DEFAULT_CONFIGS[network] };
    
    // Initialize provider
    this.provider = new ethers.providers.JsonRpcProvider(this.networkConfig.rpcUrl);
    
    // Initialize wallet
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('PRIVATE_KEY environment variable required');
    }
    
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    
    // Set profit recipient to deployer if not specified
    if (!this.config.profitRecipient) {
      this.config.profitRecipient = this.wallet.address;
    }
  }

  /**
   * Validate deployment preconditions
   */
  async validate(): Promise<void> {
    console.log('🔍 Validating deployment preconditions...');
    
    // Mainnet confirmation check
    if (this.network === 'mainnet' && !this.confirmMainnet) {
      throw new Error('CONFIRM_MAINNET=true required for mainnet deployment');
    }
    
    // Network connectivity
    console.log('📡 Checking network connectivity...');
    const network = await this.provider.getNetwork();
    if (network.chainId !== this.networkConfig.chainId) {
      throw new Error(`Chain ID mismatch: expected ${this.networkConfig.chainId}, got ${network.chainId}`);
    }
    
    // Account balance
    console.log('💰 Checking deployer balance...');
    const balance = await this.wallet.getBalance();
    const minBalance = ethers.utils.parseEther('0.1'); // 0.1 ETH minimum
    if (balance.lt(minBalance)) {
      throw new Error(`Insufficient balance: ${ethers.utils.formatEther(balance)} ETH (minimum ${ethers.utils.formatEther(minBalance)} ETH)`);
    }
    
    // Contract bytecode availability
    console.log('🔨 Checking contract artifacts...');
    const artifactPath = path.join(__dirname, '../artifacts/contracts/JitExecutor.sol/JitExecutor.json');
    if (!fs.existsSync(artifactPath)) {
      throw new Error(`Contract artifact not found: ${artifactPath}. Run 'npm run build:contracts' first.`);
    }
    
    // Position manager validation
    console.log('🎯 Validating position manager...');
    await this.validatePositionManager();
    
    // Configuration validation
    console.log('⚙️  Validating configuration...');
    this.validateConfiguration();
    
    console.log('✅ All preconditions validated');
  }

  /**
   * Validate position manager contract
   */
  async validatePositionManager(): Promise<void> {
    try {
      const code = await this.provider.getCode(this.config.positionManager);
      if (code === '0x') {
        throw new Error(`Position manager contract not found at ${this.config.positionManager}`);
      }
      
      // Try to call a standard function to verify it's a valid position manager
      const positionManager = new ethers.Contract(
        this.config.positionManager,
        ['function factory() view returns (address)'],
        this.provider
      );
      
      const factory = await positionManager.factory();
      console.log(`📍 Position manager factory: ${factory}`);
      
    } catch (error: any) {
      throw new Error(`Position manager validation failed: ${error.message}`);
    }
  }

  /**
   * Validate deployment configuration
   */
  validateConfiguration(): void {
    const errors: string[] = [];
    
    // Validate addresses
    if (!ethers.utils.isAddress(this.config.profitRecipient)) {
      errors.push('Invalid profit recipient address');
    }
    
    if (!ethers.utils.isAddress(this.config.positionManager)) {
      errors.push('Invalid position manager address');
    }
    
    // Validate amounts
    try {
      const minProfit = ethers.utils.parseEther(this.config.minProfitThreshold);
      if (minProfit.lte(0)) {
        errors.push('Minimum profit threshold must be positive');
      }
    } catch {
      errors.push('Invalid minimum profit threshold format');
    }
    
    try {
      const maxLoan = ethers.utils.parseEther(this.config.maxLoanSize);
      if (maxLoan.lte(0)) {
        errors.push('Maximum loan size must be positive');
      }
    } catch {
      errors.push('Invalid maximum loan size format');
    }
    
    if (errors.length > 0) {
      throw new Error(`Configuration validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`);
    }
  }

  /**
   * Get contract artifact
   */
  getContractArtifact(): any {
    const artifactPath = path.join(__dirname, '../artifacts/contracts/JitExecutor.sol/JitExecutor.json');
    return JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  }

  /**
   * Display deployment summary
   */
  displaySummary(): void {
    console.log('\n📋 Deployment Summary');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🌍 Network:              ${this.networkConfig.name} (Chain ID: ${this.networkConfig.chainId})`);
    console.log(`👤 Deployer:             ${this.wallet.address}`);
    console.log(`💰 Deployer Balance:     ${ethers.utils.formatEther(this.wallet.getBalance())} ETH`);
    console.log(`🔧 Mode:                 ${this.dryRun ? 'DRY RUN (validation only)' : 'LIVE DEPLOYMENT'}`);
    console.log('\n📊 Configuration');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`💎 Min Profit Threshold: ${this.config.minProfitThreshold} ETH`);
    console.log(`💸 Max Loan Size:        ${this.config.maxLoanSize} ETH`);
    console.log(`🎯 Profit Recipient:     ${this.config.profitRecipient}`);
    console.log(`📍 Position Manager:     ${this.config.positionManager}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }
}

/**
 * Estimate deployment gas
 */
async function estimateDeploymentGas(ctx: DeploymentContext): Promise<{
  gasLimit: ethers.BigNumber;
  gasPrice: ethers.BigNumber;
  estimatedCost: ethers.BigNumber;
}> {
  console.log('⛽ Estimating deployment gas...');
  
  const artifact = ctx.getContractArtifact();
  
  // Create contract factory
  const contractFactory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    ctx.wallet
  );
  
  // Constructor parameters
  const minProfitThreshold = ethers.utils.parseEther(ctx.config.minProfitThreshold);
  const maxLoanSize = ethers.utils.parseEther(ctx.config.maxLoanSize);
  const profitRecipient = ctx.config.profitRecipient;
  const positionManager = ctx.config.positionManager;
  
  // Estimate gas
  const deployTransaction = await contractFactory.getDeployTransaction(
    minProfitThreshold,
    maxLoanSize,
    profitRecipient,
    positionManager
  );
  
  const gasLimit = await ctx.provider.estimateGas(deployTransaction);
  const gasPrice = ctx.networkConfig.gasPrice ? 
    ethers.BigNumber.from(ctx.networkConfig.gasPrice) :
    await ctx.provider.getGasPrice();
  
  const estimatedCost = gasLimit.mul(gasPrice);
  
  console.log(`⛽ Gas Limit:             ${gasLimit.toString()}`);
  console.log(`💰 Gas Price:             ${ethers.utils.formatUnits(gasPrice, 'gwei')} gwei`);
  console.log(`💸 Estimated Cost:        ${ethers.utils.formatEther(estimatedCost)} ETH`);
  
  return { gasLimit, gasPrice, estimatedCost };
}

/**
 * Deploy contract
 */
async function deployContract(ctx: DeploymentContext): Promise<{
  address: string;
  transactionHash: string;
  gasUsed: ethers.BigNumber;
  deploymentCost: ethers.BigNumber;
}> {
  console.log('🚀 Deploying JitExecutor contract...');
  
  const artifact = ctx.getContractArtifact();
  
  // Create contract factory
  const contractFactory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    ctx.wallet
  );
  
  // Constructor parameters
  const minProfitThreshold = ethers.utils.parseEther(ctx.config.minProfitThreshold);
  const maxLoanSize = ethers.utils.parseEther(ctx.config.maxLoanSize);
  const profitRecipient = ctx.config.profitRecipient;
  const positionManager = ctx.config.positionManager;
  
  console.log('📝 Constructor parameters:');
  console.log(`   minProfitThreshold: ${ethers.utils.formatEther(minProfitThreshold)} ETH`);
  console.log(`   maxLoanSize:        ${ethers.utils.formatEther(maxLoanSize)} ETH`);
  console.log(`   profitRecipient:    ${profitRecipient}`);
  console.log(`   positionManager:    ${positionManager}`);
  
  // Deploy contract
  const contract = await contractFactory.deploy(
    minProfitThreshold,
    maxLoanSize,
    profitRecipient,
    positionManager,
    {
      gasPrice: ctx.networkConfig.gasPrice ? ethers.BigNumber.from(ctx.networkConfig.gasPrice) : undefined
    }
  );
  
  console.log(`📋 Transaction Hash:      ${contract.deployTransaction.hash}`);
  console.log(`⏳ Waiting for deployment...`);
  
  // Wait for deployment
  const receipt = await contract.deployTransaction.wait(ctx.networkConfig.confirmationBlocks);
  
  const gasUsed = receipt.gasUsed;
  const gasPrice = contract.deployTransaction.gasPrice!;
  const deploymentCost = gasUsed.mul(gasPrice);
  
  console.log(`✅ Contract deployed successfully!`);
  console.log(`📍 Contract Address:      ${contract.address}`);
  console.log(`⛽ Gas Used:              ${gasUsed.toString()}`);
  console.log(`💸 Deployment Cost:       ${ethers.utils.formatEther(deploymentCost)} ETH`);
  console.log(`🔗 Block Number:          ${receipt.blockNumber}`);
  
  return {
    address: contract.address,
    transactionHash: receipt.transactionHash,
    gasUsed,
    deploymentCost
  };
}

/**
 * Verify deployment
 */
async function verifyDeployment(ctx: DeploymentContext, contractAddress: string): Promise<void> {
  console.log('🔍 Verifying deployment...');
  
  const artifact = ctx.getContractArtifact();
  const contract = new ethers.Contract(contractAddress, artifact.abi, ctx.provider);
  
  try {
    // Verify configuration
    const [minProfit, maxLoan, recipient, manager, paused] = await Promise.all([
      contract.minProfitThreshold(),
      contract.maxLoanSize(),
      contract.profitRecipient(),
      contract.getPositionManager(),
      contract.paused()
    ]);
    
    console.log('📊 Deployed Configuration:');
    console.log(`   Min Profit Threshold: ${ethers.utils.formatEther(minProfit)} ETH`);
    console.log(`   Max Loan Size:        ${ethers.utils.formatEther(maxLoan)} ETH`);
    console.log(`   Profit Recipient:     ${recipient}`);
    console.log(`   Position Manager:     ${manager}`);
    console.log(`   Paused:               ${paused}`);
    
    // Verify expected values
    const expectedMinProfit = ethers.utils.parseEther(ctx.config.minProfitThreshold);
    const expectedMaxLoan = ethers.utils.parseEther(ctx.config.maxLoanSize);
    
    if (!minProfit.eq(expectedMinProfit)) {
      throw new Error(`Min profit mismatch: expected ${ethers.utils.formatEther(expectedMinProfit)}, got ${ethers.utils.formatEther(minProfit)}`);
    }
    
    if (!maxLoan.eq(expectedMaxLoan)) {
      throw new Error(`Max loan mismatch: expected ${ethers.utils.formatEther(expectedMaxLoan)}, got ${ethers.utils.formatEther(maxLoan)}`);
    }
    
    if (recipient.toLowerCase() !== ctx.config.profitRecipient.toLowerCase()) {
      throw new Error(`Profit recipient mismatch: expected ${ctx.config.profitRecipient}, got ${recipient}`);
    }
    
    if (manager.toLowerCase() !== ctx.config.positionManager.toLowerCase()) {
      throw new Error(`Position manager mismatch: expected ${ctx.config.positionManager}, got ${manager}`);
    }
    
    console.log('✅ Deployment verification successful!');
    
  } catch (error: any) {
    throw new Error(`Deployment verification failed: ${error.message}`);
  }
}

/**
 * Save deployment result
 */
function saveDeploymentResult(ctx: DeploymentContext, result: any): void {
  const deploymentData = {
    network: ctx.network,
    chainId: ctx.networkConfig.chainId,
    contractAddress: result.address,
    transactionHash: result.transactionHash,
    gasUsed: result.gasUsed.toString(),
    deploymentCost: result.deploymentCost.toString(),
    configuration: ctx.config,
    deployer: ctx.wallet.address,
    timestamp: new Date().toISOString(),
    dryRun: ctx.dryRun
  };
  
  const outputPath = path.join(__dirname, `../reports/deployment-${ctx.network}-${Date.now()}.json`);
  
  // Ensure reports directory exists
  const reportsDir = path.dirname(outputPath);
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  
  fs.writeFileSync(outputPath, JSON.stringify(deploymentData, null, 2));
  console.log(`💾 Deployment data saved to: ${outputPath}`);
}

/**
 * Main deployment function
 */
async function main(): Promise<void> {
  console.log('🚀 JitExecutor Safe Deployment Script');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  try {
    // Parse network argument
    const networkArg = process.argv.find(arg => arg.startsWith('--network='))?.split('=')[1] ||
                      (process.argv.includes('--network') ? process.argv[process.argv.indexOf('--network') + 1] : '');
    
    if (!networkArg) {
      throw new Error('Network argument required: --network <network>');
    }
    
    // Initialize deployment context
    const ctx = new DeploymentContext(networkArg);
    
    // Display summary
    ctx.displaySummary();
    
    // Validate preconditions
    await ctx.validate();
    
    // Estimate gas
    const gasEstimate = await estimateDeploymentGas(ctx);
    
    if (ctx.dryRun) {
      console.log('\n🧪 DRY RUN MODE - No deployment will occur');
      console.log('✅ All validation checks passed');
      console.log(`💡 Estimated deployment cost: ${ethers.utils.formatEther(gasEstimate.estimatedCost)} ETH`);
      console.log('🔄 To deploy for real, remove DRY_RUN=true from environment');
      return;
    }
    
    // Confirm deployment
    if (ctx.network === 'mainnet') {
      console.log('\n⚠️  MAINNET DEPLOYMENT - This will use real ETH!');
      console.log('🔒 Deployment confirmed via CONFIRM_MAINNET=true');
    }
    
    // Deploy contract
    const result = await deployContract(ctx);
    
    // Verify deployment
    await verifyDeployment(ctx, result.address);
    
    // Save deployment result
    saveDeploymentResult(ctx, result);
    
    console.log('\n🎉 Deployment completed successfully!');
    console.log(`📍 Contract Address: ${result.address}`);
    console.log(`🔗 Transaction: ${result.transactionHash}`);
    
  } catch (error: any) {
    console.error(`\n❌ Deployment failed: ${error.message}`);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⏹️  Deployment interrupted');
  process.exit(1);
});

// Run if called directly
if (require.main === module) {
  main();
}

export { main, DeploymentContext, deployContract, verifyDeployment };