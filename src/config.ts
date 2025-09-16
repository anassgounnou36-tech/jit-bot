import * as dotenv from 'dotenv';
import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import { normalizeTokenAddress } from './util/constants';

// Load environment variables
dotenv.config();

export interface PoolConfig {
  pool: string;
  address: string;
  token0: string;
  token1: string;
  fee: number;
  tickSpacing: number;
  symbol0: string;
  symbol1: string;
  decimals0: number;
  decimals1: number;
}

export interface ChainConfig {
  uniswapV3PositionManager: string;
  uniswapV3SwapRouter: string;
}

export interface FlashLoanProvider {
  enabled: boolean;
  priority: number;
  [key: string]: any;
}

export interface JitBotConfig {
  // Runtime configuration
  nodeEnv: 'development' | 'production';
  chain: 'ethereum' | 'arbitrum';
  
  // DRY RUN SAFETY - replaces old simulation flags
  dryRun: boolean;
  liveRiskAcknowledged: boolean;
  minRequiredEth: number;
  
  // Network configuration
  rpcUrlHttp: string;
  rpcUrlWs: string;
  forkBlockNumber?: number;
  
  // External API Keys
  etherscanApiKey?: string;
  blocknativeApiKey?: string;
  
  // Swap Detection Thresholds
  minSwapEth: number;
  minSwapUsd: number;
  
  // Gas and profit configuration
  maxGasGwei: number;
  globalMinProfitUsd: number;
  captureRatio: number;
  riskBufferUsd: number;
  
  // Pool configuration
  poolIds: string[];
  pools: PoolConfig[];
  
  // Metrics configuration
  prometheusPort: number;
  
  // Wallet configuration
  privateKey: string;
  flashbotsSigningKey?: string;
  
  // Flashbots configuration
  flashbotsRelayUrl: string;
  
  // Flashloan configuration
  flashloanPriority: 'balancer-first' | 'aave-first';
  allowReconstructRawTx: boolean;
  
  // Contract addresses
  jitContractAddress?: string;
  chainConfig: ChainConfig;
  
  // Flash loan providers
  flashLoanProviders: Record<string, FlashLoanProvider>;
  
  // Additional configuration from JSON
  minProfitThreshold: number;
  maxLoanSize: number;
  maxFlashloanAmountUSD: number;
  tickRangeWidth: number;
  gasPriceStrategy: string;
  slippageTolerance: number;
  
  // Deprecated flags (for warnings)
  _deprecated?: {
    simulationMode?: boolean;
    enableLiveExecution?: boolean;
    enableForkSimPreflight?: boolean;
    metricsPort?: number;
  };
}

/**
 * Load and validate configuration from environment variables and config.json
 */
export function loadConfig(): JitBotConfig {
  // Load JSON configuration
  const configPath = path.join(process.cwd(), 'config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`Configuration file not found: ${configPath}`);
  }
  
  const jsonConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  
  // Parse environment variables
  const nodeEnv = (process.env.NODE_ENV || 'development') as 'development' | 'production';
  const chain = (process.env.CHAIN || 'ethereum') as 'ethereum' | 'arbitrum';
  
  // DRY RUN SAFETY - primary execution control
  const dryRun = process.env.DRY_RUN !== 'false'; // Default to true for safety
  const liveRiskAcknowledged = process.env.I_UNDERSTAND_LIVE_RISK === 'true';
  const minRequiredEth = parseFloat(process.env.MIN_REQUIRED_ETH || '0.005');
  
  // Handle deprecated flags with warnings
  const deprecated: any = {};
  if (process.env.SIMULATION_MODE !== undefined) {
    console.warn('⚠️  SIMULATION_MODE is deprecated. Use DRY_RUN instead.');
    deprecated.simulationMode = process.env.SIMULATION_MODE === 'true';
  }
  if (process.env.ENABLE_LIVE_EXECUTION !== undefined) {
    console.warn('⚠️  ENABLE_LIVE_EXECUTION is deprecated. Use DRY_RUN=false instead.');
    deprecated.enableLiveExecution = process.env.ENABLE_LIVE_EXECUTION === 'true';
  }
  if (process.env.ENABLE_FORK_SIM_PREFLIGHT !== undefined) {
    console.warn('⚠️  ENABLE_FORK_SIM_PREFLIGHT is deprecated. Fork simulation is always enabled.');
    deprecated.enableForkSimPreflight = process.env.ENABLE_FORK_SIM_PREFLIGHT === 'true';
  }
  
  // Critical safety validations
  if (!dryRun) {
    // Live execution requires explicit risk acknowledgment
    if (!liveRiskAcknowledged) {
      throw new Error(
        'CRITICAL ERROR: Live execution (DRY_RUN=false) requires I_UNDERSTAND_LIVE_RISK=true. ' +
        'This acknowledges the risks of automated transaction execution with real funds.'
      );
    }
    
    // Production requires extra safety
    if (nodeEnv === 'production') {
      console.log('⚠️  PRODUCTION MODE with LIVE EXECUTION - Proceeding with extreme caution');
    }
  }
  
  // Network configuration
  const rpcUrlHttp = process.env.RPC_URL_HTTP || process.env.ETHEREUM_RPC_URL;
  const rpcUrlWs = process.env.RPC_URL_WS || process.env.ETHEREUM_RPC_URL?.replace('https://', 'wss://');
  
  if (!rpcUrlHttp) {
    throw new Error('RPC_URL_HTTP is required');
  }
  
  if (!rpcUrlWs) {
    throw new Error('RPC_URL_WS is required');
  }
  
  // External API Keys
  const etherscanApiKey = process.env.ETHERSCAN_API_KEY;
  const blocknativeApiKey = process.env.BLOCKNATIVE_API_KEY;
  
  if (!blocknativeApiKey) {
    console.warn('⚠️  BLOCKNATIVE_API_KEY not provided - mempool monitoring may be limited');
  }
  
  // Swap Detection Thresholds
  const minSwapEth = parseFloat(process.env.MIN_SWAP_ETH || '10');
  const minSwapUsd = parseFloat(process.env.MIN_SWAP_USD || '0');
  
  // Gas and profit configuration
  const maxGasGwei = parseFloat(process.env.MAX_GAS_GWEI || '100');
  const globalMinProfitUsd = parseFloat(process.env.GLOBAL_MIN_PROFIT_USD || '20');
  const captureRatio = parseFloat(process.env.CAPTURE_RATIO || '0.65');
  const riskBufferUsd = parseFloat(process.env.RISK_BUFFER_USD || '0');
  
  // Pool configuration
  const poolIds = process.env.POOL_IDS ? process.env.POOL_IDS.split(',').map(id => id.trim()) : [];
  
  // Metrics configuration - handle deprecated METRICS_PORT
  let prometheusPort = parseInt(process.env.PROMETHEUS_PORT || '9090');
  
  if (process.env.METRICS_PORT && !process.env.PROMETHEUS_PORT) {
    console.warn('⚠️  METRICS_PORT is deprecated. Please use PROMETHEUS_PORT instead.');
    prometheusPort = parseInt(process.env.METRICS_PORT);
  } else if (process.env.METRICS_PORT) {
    console.warn('⚠️  METRICS_PORT is deprecated and will be ignored. Using PROMETHEUS_PORT instead.');
    deprecated.metricsPort = parseInt(process.env.METRICS_PORT);
  }
  
  // Wallet configuration
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('PRIVATE_KEY is required');
  }
  
  const flashbotsSigningKey = process.env.FLASHBOTS_SIGNING_KEY;
  
  // Validate private key format
  if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
    throw new Error('PRIVATE_KEY must be a valid 32-byte hex string starting with 0x');
  }
  
  if (flashbotsSigningKey && (!flashbotsSigningKey.startsWith('0x') || flashbotsSigningKey.length !== 66)) {
    throw new Error('FLASHBOTS_SIGNING_KEY must be a valid 32-byte hex string starting with 0x');
  }
  
  // Critical safety check: private keys must be different
  if (flashbotsSigningKey && privateKey === flashbotsSigningKey) {
    throw new Error(
      'CRITICAL ERROR: PRIVATE_KEY and FLASHBOTS_SIGNING_KEY must be different for security. ' +
      'Using the same key for both purposes creates unnecessary risk.'
    );
  }
  
  // Flashbots configuration
  const flashbotsRelayUrl = process.env.FLASHBOTS_RELAY_URL || 'https://relay.flashbots.net';
  
  // Validate Flashbots signing key if live execution is enabled
  if (!dryRun && !flashbotsSigningKey) {
    throw new Error(
      'FLASHBOTS_SIGNING_KEY is required when DRY_RUN=false (live execution mode)'
    );
  }
  
  // Flashloan configuration
  const flashloanPriority = (process.env.FLASHLOAN_PRIORITY || 'balancer-first') as 'balancer-first' | 'aave-first';
  const allowReconstructRawTx = process.env.ALLOW_RECONSTRUCT_RAW_TX === 'true';
  
  // Contract configuration
  const jitContractAddress = process.env.JIT_CONTRACT_ADDRESS;
  
  // Fork configuration
  const forkBlockNumber = process.env.FORK_BLOCK_NUMBER ? 
    parseInt(process.env.FORK_BLOCK_NUMBER) : undefined;
  
  // Get chain-specific configuration
  const chainConfig = jsonConfig.contracts[chain];
  if (!chainConfig) {
    throw new Error(`Chain configuration not found for: ${chain}`);
  }
  
  // Normalize pool addresses to checksummed format and validate USDC addresses
  const pools: PoolConfig[] = jsonConfig.targets.map((target: any) => ({
    ...target,
    address: ethers.utils.getAddress(target.address),
    token0: ethers.utils.getAddress(normalizeTokenAddress(target.token0, target.symbol0)),
    token1: ethers.utils.getAddress(normalizeTokenAddress(target.token1, target.symbol1))
  }));
  
  // Validate required pools are configured
  if (poolIds.length > 0) {
    for (const poolId of poolIds) {
      const found = pools.find(p => p.pool === poolId);
      if (!found) {
        throw new Error(`Pool configuration not found for: ${poolId}`);
      }
    }
  }
  
  // Minimum balance check for live execution
  if (!dryRun && minRequiredEth > 0) {
    console.log(`⚠️  Live execution requires minimum balance: ${minRequiredEth} ETH`);
  }
  
  const config: JitBotConfig = {
    nodeEnv,
    chain,
    dryRun,
    liveRiskAcknowledged,
    minRequiredEth,
    rpcUrlHttp,
    rpcUrlWs,
    forkBlockNumber,
    etherscanApiKey,
    blocknativeApiKey,
    minSwapEth,
    minSwapUsd,
    maxGasGwei,
    globalMinProfitUsd,
    captureRatio,
    riskBufferUsd,
    poolIds,
    pools,
    prometheusPort,
    privateKey,
    flashbotsSigningKey,
    flashbotsRelayUrl,
    flashloanPriority,
    allowReconstructRawTx,
    jitContractAddress,
    chainConfig,
    flashLoanProviders: jsonConfig.flashLoanProviders || {},
    
    // Additional configuration from JSON
    minProfitThreshold: jsonConfig.minProfitThreshold || 0.01,
    maxLoanSize: jsonConfig.maxLoanSize || 1000000,
    maxFlashloanAmountUSD: parseFloat(process.env.MAX_FLASHLOAN_AMOUNT_USD || jsonConfig.maxFlashloanAmountUSD?.toString() || '300000'),
    tickRangeWidth: jsonConfig.tickRangeWidth || 60,
    gasPriceStrategy: jsonConfig.gasPriceStrategy || 'aggressive',
    slippageTolerance: jsonConfig.slippageTolerance || 0.005,
    
    // Include deprecated warnings if any were found
    _deprecated: Object.keys(deprecated).length > 0 ? deprecated : undefined
  };
  
  // Final safety validation
  validateExecutionSafety(config);
  
  return config;
}

/**
 * Validate execution safety requirements
 */
function validateExecutionSafety(config: JitBotConfig): void {
  if (!config.dryRun) {
    console.log('⚠️  LIVE EXECUTION ENABLED - This bot will execute real transactions with real funds');
    console.log('⚠️  Ensure you understand the risks and have tested thoroughly in dry-run mode');
    
    if (config.nodeEnv === 'production') {
      console.log('⚠️  PRODUCTION MODE with LIVE EXECUTION - Proceeding with extreme caution');
    }
  } else {
    console.log('✅ DRY RUN mode active - No live execution will occur');
  }
  
  console.log('✅ Fork simulation enabled - Full validation before any execution');
}

/**
 * Get HTTP provider for read operations
 */
export function getHttpProvider(config: JitBotConfig): ethers.providers.JsonRpcProvider {
  return new ethers.providers.JsonRpcProvider(config.rpcUrlHttp);
}

/**
 * Get WebSocket provider for real-time monitoring
 */
export function getWsProvider(config: JitBotConfig): ethers.providers.WebSocketProvider {
  return new ethers.providers.WebSocketProvider(config.rpcUrlWs);
}

/**
 * Get wallet instance
 */
export function getWallet(config: JitBotConfig, provider?: ethers.providers.Provider): ethers.Wallet {
  const wallet = new ethers.Wallet(config.privateKey);
  return provider ? wallet.connect(provider) : wallet;
}

/**
 * Validate that no live execution paths are attempted when disabled
 */
export function validateNoLiveExecution(operation: string): void {
  const config = getConfig();
  
  if (config.dryRun) {
    throw new Error(
      `BLOCKED: ${operation} requires DRY_RUN=false. ` +
      'This operation is disabled for safety. Set DRY_RUN=false and I_UNDERSTAND_LIVE_RISK=true to enable live execution.'
    );
  }
  
  if (!config.dryRun && !config.flashbotsSigningKey) {
    throw new Error(
      `BLOCKED: ${operation} requires FLASHBOTS_SIGNING_KEY when live execution is enabled. ` +
      'Live execution without Flashbots is not supported for safety.'
    );
  }
}

// Export the global config instance
let globalConfig: JitBotConfig | null = null;

export function getConfig(): JitBotConfig {
  if (!globalConfig) {
    globalConfig = loadConfig();
  }
  return globalConfig;
}

// Export for testing
export function resetConfig(): void {
  globalConfig = null;
}