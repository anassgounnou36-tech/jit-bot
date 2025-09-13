import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

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

export interface FlashLoanConfig {
  vault?: string;
  poolAddressProvider?: string;
  enabled: boolean;
  priority: number;
}

export interface ConfigJson {
  chains: string[];
  targets: PoolConfig[];
  minProfitThreshold: number;
  maxLoanSize: number;
  tickRangeWidth: number;
  gasPriceStrategy: string;
  slippageTolerance: number;
  flashLoanProviders: {
    balancer: FlashLoanConfig;
    aave: FlashLoanConfig;
  };
  contracts: {
    [chain: string]: ChainConfig;
  };
  rpc: {
    [chain: string]: string;
  };
  flashbots: {
    relayUrl: string;
    enabled: boolean;
  };
}

export interface AppConfig {
  // Core Environment
  nodeEnv: 'development' | 'production';
  chain: 'mainnet' | 'arbitrum';
  simulationMode: boolean;
  
  // RPC Configuration
  rpcUrlWs: string;
  rpcUrlHttp: string;
  
  // Gas and Profit Controls
  maxGasGwei: number;
  globalMinProfitUsd: number;
  
  // Pool Configuration
  poolIds: string[];
  
  // Monitoring
  prometheusPort: number;
  metricsPort: number; // deprecated
  
  // Flashbots (placeholders for PR1)
  flashbotsRelayUrl: string;
  flashbotsPrivateKey?: string;
  
  // Wallet (placeholder for PR1)
  privateKey?: string;
  
  // Fork Testing
  forkBlockNumber?: number;
  
  // Legacy Support
  enableMultiPool: boolean;
  poolMaxFailures: number;
  poolCooldownMs: number;
  maxConcurrentWatchers: number;
  
  // Bot Settings
  minProfitThreshold: number;
  maxLoanSize: number;
  tickRangeWidth: number;
  gasPriceMultiplier: number;
  
  // Config JSON data
  configData: ConfigJson;
}

/**
 * Validates that required environment variables are present for simulation-only mode
 */
function validateSimulationModeConfig(): void {
  const required = [
    'RPC_URL_WS',
    'RPC_URL_HTTP',
    'CHAIN'
  ];
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables for simulation mode: ${missing.join(', ')}`);
  }
}

/**
 * Validates that live execution is properly disabled in PR1
 */
function validateSimulationOnlyMode(config: Partial<AppConfig>): void {
  const nodeEnv = config.nodeEnv;
  const simulationMode = config.simulationMode;
  
  // Enforce simulation-only mode in PR1
  if (nodeEnv === 'production' && simulationMode === false) {
    throw new Error(
      'CRITICAL SAFETY ERROR: Live execution mode is FORBIDDEN in PR1. ' +
      'This PR is simulation-only. Set SIMULATION_MODE=true or NODE_ENV=development. ' +
      'Live execution will be enabled in PR2.'
    );
  }
  
  if (simulationMode === false) {
    console.warn(
      '⚠️  WARNING: SIMULATION_MODE=false detected but live execution is disabled in PR1. ' +
      'Forcing simulation mode for safety. Live execution will be available in PR2.'
    );
  }
}

/**
 * Validates that Flashbots keys are only required in PR2+, not PR1
 */
function validateFlashbotsConfig(config: Partial<AppConfig>): void {
  // In PR1, Flashbots keys are optional placeholders
  if (config.nodeEnv === 'production' && config.simulationMode === false) {
    // This check is already caught by validateSimulationOnlyMode, but adding for clarity
    if (!config.flashbotsPrivateKey && !config.privateKey) {
      throw new Error(
        'Live mode requires FLASHBOTS_PRIVATE_KEY and PRIVATE_KEY, but these are not implemented in PR1. ' +
        'Live execution will be available in PR2.'
      );
    }
  }
}

/**
 * Normalizes pool addresses to lowercase hex format
 */
function normalizePoolIds(poolIds: string[]): string[] {
  return poolIds.map(id => {
    // If it's already an address (starts with 0x), normalize it
    if (id.startsWith('0x')) {
      return id.toLowerCase();
    }
    // Otherwise, keep as-is for config.json lookup
    return id;
  });
}

/**
 * Loads and validates configuration from environment and config.json
 */
export function loadConfig(): AppConfig {
  // Load config.json
  const configPath = path.join(process.cwd(), 'config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  
  const configData: ConfigJson = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  
  // Validate simulation mode requirements
  validateSimulationModeConfig();
  
  // Parse environment variables
  const nodeEnv = (process.env.NODE_ENV as 'development' | 'production') || 'development';
  const chain = (process.env.CHAIN as 'mainnet' | 'arbitrum') || 'mainnet';
  const simulationMode = process.env.SIMULATION_MODE !== 'false'; // Default to true for safety
  
  // Validate chain exists in config
  if (!configData.chains.includes(chain)) {
    throw new Error(`Unsupported chain "${chain}". Supported chains: ${configData.chains.join(', ')}`);
  }
  
  // Parse pool IDs
  const poolIdsRaw = process.env.POOL_IDS || '';
  const poolIds = poolIdsRaw ? normalizePoolIds(poolIdsRaw.split(',').map(p => p.trim())) : [];
  
  // Create config object
  const config: AppConfig = {
    nodeEnv,
    chain,
    simulationMode: true, // Force true in PR1
    
    rpcUrlWs: process.env.RPC_URL_WS!,
    rpcUrlHttp: process.env.RPC_URL_HTTP!,
    
    maxGasGwei: parseFloat(process.env.MAX_GAS_GWEI || '100'),
    globalMinProfitUsd: parseFloat(process.env.GLOBAL_MIN_PROFIT_USD || '50'),
    
    poolIds,
    
    prometheusPort: parseInt(process.env.PROMETHEUS_PORT || '9090'),
    metricsPort: parseInt(process.env.METRICS_PORT || '3001'), // Legacy support
    
    flashbotsRelayUrl: process.env.FLASHBOTS_RELAY_URL || 'https://relay.flashbots.net',
    flashbotsPrivateKey: process.env.FLASHBOTS_PRIVATE_KEY,
    
    privateKey: process.env.PRIVATE_KEY,
    
    forkBlockNumber: process.env.FORK_BLOCK_NUMBER ? parseInt(process.env.FORK_BLOCK_NUMBER) : undefined,
    
    // Legacy support with deprecation warnings
    enableMultiPool: process.env.ENABLE_MULTI_POOL === 'true',
    poolMaxFailures: parseInt(process.env.POOL_MAX_FAILURES || '5'),
    poolCooldownMs: parseInt(process.env.POOL_COOLDOWN_MS || '300000'),
    maxConcurrentWatchers: parseInt(process.env.MAX_CONCURRENT_WATCHERS || '10'),
    
    minProfitThreshold: parseFloat(process.env.MIN_PROFIT_THRESHOLD || '0.01'),
    maxLoanSize: parseInt(process.env.MAX_LOAN_SIZE || '1000000'),
    tickRangeWidth: parseInt(process.env.TICK_RANGE_WIDTH || '60'),
    gasPriceMultiplier: parseFloat(process.env.GAS_PRICE_MULTIPLIER || '1.1'),
    
    configData
  };
  
  // Perform safety validations
  validateSimulationOnlyMode(config);
  validateFlashbotsConfig(config);
  
  // Legacy warning for METRICS_PORT
  if (process.env.METRICS_PORT && process.env.METRICS_PORT !== process.env.PROMETHEUS_PORT) {
    console.warn(
      '⚠️  DEPRECATION WARNING: METRICS_PORT is deprecated. Use PROMETHEUS_PORT instead. ' +
      `Currently using PROMETHEUS_PORT=${config.prometheusPort}`
    );
  }
  
  return config;
}

/**
 * Get pool configuration by address or pool ID
 */
export function getPoolConfig(poolIdOrAddress: string, config: AppConfig): PoolConfig | undefined {
  return config.configData.targets.find(target => 
    target.address.toLowerCase() === poolIdOrAddress.toLowerCase() ||
    target.pool === poolIdOrAddress
  );
}

/**
 * Get chain-specific contract addresses
 */
export function getChainConfig(chain: string, config: AppConfig): ChainConfig {
  const chainConfig = config.configData.contracts[chain];
  if (!chainConfig) {
    throw new Error(`No contract configuration found for chain: ${chain}`);
  }
  return chainConfig;
}

/**
 * Get RPC URL for the specified chain
 */
export function getRpcUrl(chain: string, config: AppConfig): string {
  const rpcUrl = config.configData.rpc[chain];
  if (!rpcUrl) {
    throw new Error(`No RPC URL configured for chain: ${chain}`);
  }
  return rpcUrl;
}

// Export singleton instance
export const config = loadConfig();

// Log configuration summary
console.log(`🔧 Configuration loaded:`);
console.log(`   Environment: ${config.nodeEnv}`);
console.log(`   Chain: ${config.chain}`);
console.log(`   Simulation Mode: ${config.simulationMode} (forced true in PR1)`);
console.log(`   Pool Count: ${config.poolIds.length}`);
console.log(`   Prometheus Port: ${config.prometheusPort}`);
console.log(`   Global Min Profit: $${config.globalMinProfitUsd} USD`);
console.log(`   Max Gas: ${config.maxGasGwei} gwei`);

if (config.simulationMode) {
  console.log(`✅ SIMULATION MODE: All operations are simulation-only, no live execution`);
} else {
  console.log(`🚨 This should not happen in PR1 - live mode should be disabled`);
}