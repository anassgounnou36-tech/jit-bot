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
  simulationMode: boolean; // Legacy, derived from !enableLiveExecution
  
  // PR2: Live execution control
  enableLiveExecution: boolean;
  enableFlashbots: boolean;
  enableForkSimPreflight: boolean;
  liveRiskAcknowledged: boolean;
  
  // Network configuration
  rpcUrlHttp: string;
  rpcUrlWs: string;
  forkBlockNumber?: number;
  
  // Gas and profit configuration
  maxGasGwei: number;
  globalMinProfitUsd: number;
  
  // Pool configuration
  poolIds: string[];
  pools: PoolConfig[];
  
  // Metrics configuration
  prometheusPort: number;
  metricsPort?: number; // Deprecated
  
  // Wallet configuration
  privateKey: string;
  executorPrivateKey?: string;
  
  // Flashbots configuration
  flashbotsRelayUrl: string;
  flashbotsPrivateKey?: string;
  
  // Flashloan configuration
  flashloanProvider: string;
  
  // Contract addresses
  jitContractAddress?: string;
  chainConfig: ChainConfig;
  
  // Flash loan providers
  flashLoanProviders: Record<string, FlashLoanProvider>;
  
  // Additional configuration from JSON
  minProfitThreshold: number;
  maxLoanSize: number;
  tickRangeWidth: number;
  gasPriceStrategy: string;
  slippageTolerance: number;
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
  
  // PR2: New live execution flags
  const enableLiveExecution = process.env.ENABLE_LIVE_EXECUTION === 'true';
  const enableFlashbots = process.env.ENABLE_FLASHBOTS === 'true';
  const enableForkSimPreflight = process.env.ENABLE_FORK_SIM_PREFLIGHT !== 'false'; // Default true
  const liveRiskAcknowledged = process.env.I_UNDERSTAND_LIVE_RISK === 'true';
  
  // Legacy simulation mode (derived from live execution setting)
  const simulationMode = !enableLiveExecution;
  
  // Critical PR2 safety checks
  if (enableLiveExecution) {
    // Require Flashbots to be enabled for live execution
    if (!enableFlashbots) {
      throw new Error(
        'CRITICAL ERROR: ENABLE_LIVE_EXECUTION=true requires ENABLE_FLASHBOTS=true. ' +
        'Live execution without Flashbots is not supported for safety.'
      );
    }
    
    // Production environment requires explicit risk acknowledgment
    if (nodeEnv === 'production' && !liveRiskAcknowledged) {
      throw new Error(
        'CRITICAL ERROR: Live execution in production requires I_UNDERSTAND_LIVE_RISK=true. ' +
        'This acknowledges the risks of automated transaction execution with real funds.'
      );
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
  
  // Gas and profit configuration
  const maxGasGwei = parseFloat(process.env.MAX_GAS_GWEI || '100');
  const globalMinProfitUsd = parseFloat(process.env.GLOBAL_MIN_PROFIT_USD || '10.0');
  
  // Pool configuration
  const poolIds = process.env.POOL_IDS ? process.env.POOL_IDS.split(',').map(id => id.trim()) : [];
  
  // Metrics configuration - handle deprecated METRICS_PORT
  let prometheusPort = parseInt(process.env.PROMETHEUS_PORT || '9090');
  let metricsPort: number | undefined;
  
  if (process.env.METRICS_PORT && !process.env.PROMETHEUS_PORT) {
    console.warn('⚠️  METRICS_PORT is deprecated. Please use PROMETHEUS_PORT instead.');
    prometheusPort = parseInt(process.env.METRICS_PORT);
    metricsPort = prometheusPort;
  } else if (process.env.METRICS_PORT) {
    console.warn('⚠️  METRICS_PORT is deprecated and will be ignored. Using PROMETHEUS_PORT instead.');
    metricsPort = parseInt(process.env.METRICS_PORT);
  }
  
  // Wallet configuration
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('PRIVATE_KEY is required');
  }
  
  const executorPrivateKey = process.env.EXECUTOR_PRIVATE_KEY;
  
  // Validate private key format
  if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
    throw new Error('PRIVATE_KEY must be a valid 32-byte hex string starting with 0x');
  }
  
  if (executorPrivateKey && (!executorPrivateKey.startsWith('0x') || executorPrivateKey.length !== 66)) {
    throw new Error('EXECUTOR_PRIVATE_KEY must be a valid 32-byte hex string starting with 0x');
  }
  
  // Flashbots configuration
  const flashbotsRelayUrl = process.env.FLASHBOTS_RELAY_URL || 'https://relay.flashbots.net';
  const flashbotsPrivateKey = process.env.FLASHBOTS_PRIVATE_KEY;
  
  // Validate Flashbots private key if live execution is enabled
  if (enableLiveExecution && enableFlashbots) {
    if (!flashbotsPrivateKey) {
      throw new Error(
        'FLASHBOTS_PRIVATE_KEY is required when ENABLE_LIVE_EXECUTION=true and ENABLE_FLASHBOTS=true'
      );
    }
    
    if (!flashbotsPrivateKey.startsWith('0x') || flashbotsPrivateKey.length !== 66) {
      throw new Error('FLASHBOTS_PRIVATE_KEY must be a valid 32-byte hex string starting with 0x');
    }
  }
  
  // Warn about flashbots configuration in simulation mode
  if (!enableLiveExecution && flashbotsPrivateKey) {
    console.warn('⚠️  Flashbots configuration detected but will not be used in simulation mode');
  }
  
  // Flashloan provider configuration
  const flashloanProvider = process.env.FLASHLOAN_PROVIDER || 'aave-v3';
  
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
  
  const config: JitBotConfig = {
    nodeEnv,
    chain,
    simulationMode,
    enableLiveExecution,
    enableFlashbots,
    enableForkSimPreflight,
    liveRiskAcknowledged,
    rpcUrlHttp,
    rpcUrlWs,
    forkBlockNumber,
    maxGasGwei,
    globalMinProfitUsd,
    poolIds,
    pools,
    prometheusPort,
    metricsPort,
    privateKey,
    executorPrivateKey,
    flashbotsRelayUrl,
    flashbotsPrivateKey,
    flashloanProvider,
    jitContractAddress,
    chainConfig,
    flashLoanProviders: jsonConfig.flashLoanProviders || {},
    
    // Additional configuration from JSON
    minProfitThreshold: jsonConfig.minProfitThreshold || 0.01,
    maxLoanSize: jsonConfig.maxLoanSize || 1000000,
    tickRangeWidth: jsonConfig.tickRangeWidth || 60,
    gasPriceStrategy: jsonConfig.gasPriceStrategy || 'aggressive',
    slippageTolerance: jsonConfig.slippageTolerance || 0.005
  };
  
  // Final simulation mode validation
  validateLiveExecutionSafety(config);
  
  return config;
}

/**
 * Validate live execution safety requirements
 */
function validateLiveExecutionSafety(config: JitBotConfig): void {
  if (config.enableLiveExecution) {
    console.log('⚠️  LIVE EXECUTION ENABLED - This bot will execute real transactions with real funds');
    console.log('⚠️  Ensure you understand the risks and have tested thoroughly in simulation mode');
    
    if (config.nodeEnv === 'production') {
      console.log('⚠️  PRODUCTION MODE with LIVE EXECUTION - Proceeding with extreme caution');
    }
  } else {
    console.log('✅ Simulation mode active - No live execution will occur');
  }
  
  if (config.enableForkSimPreflight) {
    console.log('✅ Fork simulation preflight enabled - Full validation before any execution');
  }
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
  
  if (!config.enableLiveExecution) {
    throw new Error(
      `BLOCKED: ${operation} requires ENABLE_LIVE_EXECUTION=true. ` +
      'This operation is disabled for safety. Set ENABLE_LIVE_EXECUTION=true to enable live execution.'
    );
  }
  
  if (config.enableLiveExecution && !config.enableFlashbots) {
    throw new Error(
      `BLOCKED: ${operation} requires ENABLE_FLASHBOTS=true when live execution is enabled. ` +
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