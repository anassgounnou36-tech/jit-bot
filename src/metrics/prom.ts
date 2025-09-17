import express from 'express';
import { register, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';
import { getConfig } from '../config';
import { getLogger, requestLoggingMiddleware } from '../logging/logger';

// Mempool monitoring metrics
const mempoolTxsSeenTotal = new Counter({
  name: 'mempool_txs_seen_total',
  help: 'Total number of transactions seen in mempool',
  labelNames: ['provider']
});

const mempoolTxsRawFetchedTotal = new Counter({
  name: 'mempool_txs_raw_fetched_total',
  help: 'Total number of raw transactions successfully fetched',
  labelNames: ['method']
});

const mempoolTxsRawMissingTotal = new Counter({
  name: 'mempool_txs_raw_missing_total',
  help: 'Total number of transactions where raw tx data could not be retrieved',
  labelNames: ['reason']
});

const mempoolSwapsDecodedTotal = new Counter({
  name: 'mempool_swaps_decoded_total',
  help: 'Total number of Uniswap swaps successfully decoded',
  labelNames: ['method']
});

const mempoolSwapsMatchedTotal = new Counter({
  name: 'mempool_swaps_matched_total',
  help: 'Total number of swaps matched to target pools',
  labelNames: ['pool']
});

const mempoolSwapsRejectedTotal = new Counter({
  name: 'mempool_swaps_rejected_total',
  help: 'Total number of swaps rejected during processing',
  labelNames: ['reason']
});

// JIT strategy metrics
const jitCandidatesProfitableTotal = new Counter({
  name: 'jit_candidates_profitable_total',
  help: 'Total number of profitable JIT candidates identified',
  labelNames: ['pool']
});

const jitBundleSimulationsTotal = new Counter({
  name: 'jit_bundle_simulations_total',
  help: 'Total number of bundle simulations attempted',
  labelNames: ['result', 'pool']
});

const jitBundleSubmissionsTotal = new Counter({
  name: 'jit_bundle_submissions_total',
  help: 'Total number of bundles submitted to Flashbots',
  labelNames: ['result']
});

const jitBundleProfitUsd = new Gauge({
  name: 'jit_bundle_profit_usd',
  help: 'Last simulated bundle profit in USD',
  labelNames: ['pool']
});

const jitBundleGasEstimate = new Gauge({
  name: 'jit_bundle_gas_estimate',
  help: 'Gas estimate for last bundle',
  labelNames: ['pool']
});

// Flashloan provider metrics
const flashloanProviderUsageTotal = new Counter({
  name: 'flashloan_provider_usage_total',
  help: 'Total usage of each flashloan provider',
  labelNames: ['provider']
});

// Victim replacement tracking
const victimReplacementsTotal = new Counter({
  name: 'victim_replacements_total',
  help: 'Total number of victim transaction replacements detected',
  labelNames: ['reason']
});

// Existing metrics
const jitAttemptTotal = new Counter({
  name: 'jit_attempt_total',
  help: 'Total number of JIT strategy attempts',
  labelNames: ['pool', 'result']
});

const jitSuccessTotal = new Counter({
  name: 'jit_success_total',
  help: 'Total number of successful JIT executions',
  labelNames: ['pool']
});

const jitFailureTotal = new Counter({
  name: 'jit_failure_total',
  help: 'Total number of failed JIT attempts',
  labelNames: ['pool', 'error_type']
});

const currentSimulatedProfitUsd = new Gauge({
  name: 'current_simulated_profit_usd',
  help: 'Current estimated profit from simulation in USD',
  labelNames: ['pool']
});

const walletBalanceEth = new Gauge({
  name: 'wallet_balance_eth',
  help: 'Current wallet balance in ETH',
  labelNames: []
});

const poolDisabled = new Gauge({
  name: 'pool_disabled',
  help: 'Whether a pool is currently disabled (1 = disabled, 0 = enabled)',
  labelNames: ['pool']
});

// Performance metrics
const simulationDuration = new Histogram({
  name: 'simulation_duration_seconds',
  help: 'Duration of simulation operations',
  labelNames: ['type', 'pool'],
  buckets: [0.1, 0.5, 1, 2, 5, 10]
});

const gasPriceGwei = new Gauge({
  name: 'gas_price_gwei',
  help: 'Current gas price in Gwei',
  labelNames: []
});

const poolLiquidity = new Gauge({
  name: 'pool_liquidity',
  help: 'Current pool liquidity',
  labelNames: ['pool', 'token0', 'token1']
});

const poolPrice = new Gauge({
  name: 'pool_price',
  help: 'Current pool price (token1/token0)',
  labelNames: ['pool', 'token0', 'token1']
});

const rpcRequestDuration = new Histogram({
  name: 'rpc_request_duration_seconds',
  help: 'Duration of RPC requests',
  labelNames: ['method', 'result'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2]
});

// System metrics
const botUptime = new Gauge({
  name: 'bot_uptime_seconds',
  help: 'Bot uptime in seconds',
  labelNames: []
});

const opportunitiesDetected = new Counter({
  name: 'opportunities_detected_total',
  help: 'Total opportunities detected',
  labelNames: ['pool']
});

const simulationErrors = new Counter({
  name: 'simulation_errors_total',
  help: 'Total simulation errors',
  labelNames: ['type', 'pool']
});

// PR2: New metrics for flashbots, flashloan, and fork simulation
const flashbotsAttemptTotal = new Counter({
  name: 'flashbots_bundle_attempt_total',
  help: 'Total number of Flashbots bundle attempts',
  labelNames: ['operation'] // 'simulate' or 'submit'
});

const flashbotsSuccessTotal = new Counter({
  name: 'flashbots_bundle_success_total',
  help: 'Total number of successful Flashbots bundle operations',
  labelNames: ['operation']
});

const flashbotsFailureTotal = new Counter({
  name: 'flashbots_bundle_failure_total',
  help: 'Total number of failed Flashbots bundle operations',
  labelNames: ['operation', 'reason']
});

const lastBundleBlockNumber = new Gauge({
  name: 'last_bundle_block_number',
  help: 'Block number of the last bundle submission',
  labelNames: []
});

const forkSimAttemptTotal = new Counter({
  name: 'fork_sim_attempt_total',
  help: 'Total number of fork simulation attempts',
  labelNames: ['pool']
});

const forkSimSuccessTotal = new Counter({
  name: 'fork_sim_success_total',
  help: 'Total number of successful fork simulations',
  labelNames: ['pool']
});

const forkSimFailureTotal = new Counter({
  name: 'fork_sim_failure_total',
  help: 'Total number of failed fork simulations',
  labelNames: ['pool', 'reason']
});

const flashloanAttemptTotal = new Counter({
  name: 'flashloan_attempt_total',
  help: 'Total number of flashloan attempts',
  labelNames: ['provider', 'token']
});

const flashloanSuccessTotal = new Counter({
  name: 'flashloan_success_total',
  help: 'Total number of successful flashloan operations',
  labelNames: ['provider', 'token']
});

const flashloanFailureTotal = new Counter({
  name: 'flashloan_failure_total',
  help: 'Total number of failed flashloan operations',
  labelNames: ['provider', 'token', 'reason']
});

// Performance histograms for PR2
const flashbotsDuration = new Histogram({
  name: 'flashbots_operation_duration_seconds',
  help: 'Duration of Flashbots operations',
  labelNames: ['operation'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30]
});

const forkSimDuration = new Histogram({
  name: 'fork_sim_duration_seconds',
  help: 'Duration of fork simulation operations',
  labelNames: ['type'],
  buckets: [0.5, 1, 2, 5, 10, 30, 60]
});

const preflightDuration = new Histogram({
  name: 'preflight_duration_seconds',
  help: 'Duration of preflight simulations',
  labelNames: ['pool'],
  buckets: [1, 2, 5, 10, 20, 30, 60]
});

// Profitability metrics
const expectedProfitUsd = new Histogram({
  name: 'expected_profit_usd',
  help: 'Expected profit in USD from successful preflights',
  labelNames: ['pool'],
  buckets: [1, 5, 10, 25, 50, 100, 250, 500]
});

export interface MetricsServerConfig {
  port: number;
  host?: string;
  path?: string;
}

export class PrometheusMetrics {
  private app: express.Application;
  private server: any;
  private config: MetricsServerConfig;
  private logger: any;
  private startTime: number;

  constructor(config?: Partial<MetricsServerConfig>) {
    this.logger = getLogger().child({ component: 'metrics' });
    this.startTime = Date.now();
    
    const botConfig = getConfig();
    
    this.config = {
      port: config?.port || botConfig.prometheusPort,
      host: config?.host || '0.0.0.0',
      path: config?.path || '/metrics'
    };

    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupDefaultMetrics();
    
    // Warn about deprecated METRICS_PORT - now handled in config.ts
    if (botConfig._deprecated?.metricsPort && !config?.port) {
      this.logger.warn({
        msg: 'METRICS_PORT is deprecated, please use PROMETHEUS_PORT instead',
        metricsPort: botConfig._deprecated.metricsPort,
        prometheusPort: botConfig.prometheusPort
      });
    }
  }

  private setupMiddleware(): void {
    this.app.use(requestLoggingMiddleware());
  }

  private setupRoutes(): void {
    // Main metrics endpoint
    this.app.get(this.config.path!, async (_req, res) => {
      try {
        // Update uptime
        botUptime.set((Date.now() - this.startTime) / 1000);
        
        res.set('Content-Type', register.contentType);
        const metrics = await register.metrics();
        res.end(metrics);
      } catch (error: any) {
        this.logger.error({ err: error, msg: 'Failed to generate metrics' });
        res.status(500).end('Internal Server Error');
      }
    });

    // Health check endpoint
    this.app.get('/health', (_req, res) => {
      res.json({
        status: 'healthy',
        uptime: (Date.now() - this.startTime) / 1000,
        timestamp: new Date().toISOString()
      });
    });

    // Basic status endpoint
    this.app.get('/status', (_req, res) => {
      const config = getConfig();
      res.json({
        mode: config.dryRun ? 'dry-run' : 'live',
        chain: config.chain,
        pools: config.poolIds,
        uptime: (Date.now() - this.startTime) / 1000,
        version: '1.0.0-mempool',
        dryRun: config.dryRun,
        liveRiskAcknowledged: config.liveRiskAcknowledged,
        minRequiredEth: config.minRequiredEth
      });
    });
  }

  private setupDefaultMetrics(): void {
    // Collect default Node.js metrics
    collectDefaultMetrics({
      register,
      prefix: 'jit_bot_'
    });
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.config.port, this.config.host!, () => {
        this.logger.info({
          msg: 'Prometheus metrics server started',
          port: this.config.port,
          host: this.config.host,
          path: this.config.path
        });
        resolve();
      });

      this.server.on('error', (error: any) => {
        this.logger.error({ err: error, msg: 'Metrics server error' });
        reject(error);
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.logger.info({ msg: 'Prometheus metrics server stopped' });
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  // Metric recording methods
  public recordJitAttempt(pool: string, result: 'success' | 'failure'): void {
    jitAttemptTotal.inc({ pool, result });
  }

  public incrementJitAttempt(pool: string): void {
    jitAttemptTotal.inc({ pool, result: 'queued' });
  }

  public recordJitSuccess(pool: string): void {
    jitSuccessTotal.inc({ pool });
  }

  public recordJitFailure(pool: string, errorType: string): void {
    jitFailureTotal.inc({ pool, error_type: errorType });
  }

  public updateSimulatedProfit(pool: string, profitUsd: number): void {
    currentSimulatedProfitUsd.set({ pool }, profitUsd);
  }

  public updateWalletBalance(balanceEth: number): void {
    walletBalanceEth.set(balanceEth);
  }

  public setPoolDisabled(pool: string, disabled: boolean): void {
    poolDisabled.set({ pool }, disabled ? 1 : 0);
  }

  public recordSimulationDuration(type: 'fast' | 'fork', pool: string, durationSeconds: number): void {
    simulationDuration.observe({ type, pool }, durationSeconds);
  }

  public updateGasPrice(gasPriceGweiValue: number): void {
    gasPriceGwei.set(gasPriceGweiValue);
  }

  public updatePoolLiquidity(pool: string, token0: string, token1: string, liquidity: number): void {
    poolLiquidity.set({ pool, token0, token1 }, liquidity);
  }

  public updatePoolPrice(pool: string, token0: string, token1: string, price: number): void {
    poolPrice.set({ pool, token0, token1 }, price);
  }

  public recordRpcRequest(method: string, result: 'success' | 'error', durationSeconds: number): void {
    rpcRequestDuration.observe({ method, result }, durationSeconds);
  }

  public recordOpportunityDetected(pool: string): void {
    opportunitiesDetected.inc({ pool });
  }

  public recordSimulationError(type: string, pool: string): void {
    simulationErrors.inc({ type, pool });
  }

  // PR2: New metric recording methods
  public incrementFlashbotsAttempt(operation: 'simulate' | 'submit'): void {
    flashbotsAttemptTotal.inc({ operation });
  }

  public incrementFlashbotsSuccess(operation: 'simulate' | 'submit'): void {
    flashbotsSuccessTotal.inc({ operation });
  }

  public incrementFlashbotsFailure(operation: 'simulate' | 'submit', reason: string): void {
    flashbotsFailureTotal.inc({ operation, reason });
  }

  public updateLastBundleBlock(blockNumber: number): void {
    lastBundleBlockNumber.set(blockNumber);
  }

  public incrementForkSimAttempt(pool: string): void {
    forkSimAttemptTotal.inc({ pool });
  }

  public incrementForkSimSuccess(pool: string): void {
    forkSimSuccessTotal.inc({ pool });
  }

  public incrementForkSimFailure(pool: string, reason: string): void {
    forkSimFailureTotal.inc({ pool, reason });
  }

  public incrementFlashloanAttempt(provider: string, token: string): void {
    flashloanAttemptTotal.inc({ provider, token });
  }

  public incrementFlashloanSuccess(provider: string, token: string): void {
    flashloanSuccessTotal.inc({ provider, token });
  }

  public incrementFlashloanFailure(provider: string, token: string, reason: string): void {
    flashloanFailureTotal.inc({ provider, token, reason });
  }

  public recordFlashbotsDuration(operation: 'simulate' | 'submit', durationSeconds: number): void {
    flashbotsDuration.observe({ operation }, durationSeconds);
  }

  public recordForkSimDuration(type: 'preflight' | 'validation', durationSeconds: number): void {
    forkSimDuration.observe({ type }, durationSeconds);
  }

  public recordPreflightDuration(pool: string, durationSeconds: number): void {
    preflightDuration.observe({ pool }, durationSeconds);
  }

  public recordExpectedProfit(pool: string, profitUsd: number): void {
    expectedProfitUsd.observe({ pool }, profitUsd);
  }

  // Mempool monitoring methods
  public incrementMempoolTxsSeen(provider: string): void {
    mempoolTxsSeenTotal.inc({ provider });
  }

  public incrementMempoolTxsRawFetched(method: string): void {
    mempoolTxsRawFetchedTotal.inc({ method });
  }

  public incrementMempoolTxsRawMissing(reason: string): void {
    mempoolTxsRawMissingTotal.inc({ reason });
  }

  public incrementMempoolSwapsDecoded(): void {
    mempoolSwapsDecodedTotal.inc();
  }

  public incrementMempoolSwapsMatched(): void {
    mempoolSwapsMatchedTotal.inc();
  }

  public incrementMempoolSwapsRejected(reason: string): void {
    mempoolSwapsRejectedTotal.inc({ reason });
  }

  public incrementJitCandidatesProfitable(pool: string): void {
    jitCandidatesProfitableTotal.inc({ pool });
  }

  public incrementJitBundleSimulations(result: string, pool: string): void {
    jitBundleSimulationsTotal.inc({ result, pool });
  }

  public incrementJitBundleSubmissions(result: string): void {
    jitBundleSubmissionsTotal.inc({ result });
  }

  public updateJitBundleProfitUsd(pool: string, profitUsd: number): void {
    jitBundleProfitUsd.set({ pool }, profitUsd);
  }

  public updateJitBundleGasEstimate(pool: string, gasEstimate: number): void {
    jitBundleGasEstimate.set({ pool }, gasEstimate);
  }

  public incrementFlashloanProviderUsage(provider: string): void {
    flashloanProviderUsageTotal.inc({ provider });
  }

  public incrementVictimReplacements(reason: string = 'detected'): void {
    victimReplacementsTotal.inc({ reason });
  }

  // Utility methods
  public getMetricsUrl(): string {
    return `http://${this.config.host === '0.0.0.0' ? 'localhost' : this.config.host}:${this.config.port}${this.config.path}`;
  }

  public async getMetricsSnapshot(): Promise<string> {
    botUptime.set((Date.now() - this.startTime) / 1000);
    return await register.metrics();
  }

  public clearMetrics(): void {
    register.clear();
    this.setupDefaultMetrics();
  }

  // Initialize pools in metrics
  public initializePool(poolAddress: string, token0: string, token1: string): void {
    this.setPoolDisabled(poolAddress, false);
    this.updatePoolLiquidity(poolAddress, token0, token1, 0);
    this.updatePoolPrice(poolAddress, token0, token1, 0);
    this.updateSimulatedProfit(poolAddress, 0);
    
    this.logger.debug({
      msg: 'Pool initialized in metrics',
      pool: poolAddress,
      token0,
      token1
    });
  }
}

// Global metrics instance
let globalMetrics: PrometheusMetrics | null = null;

/**
 * Initialize global metrics instance
 */
export function initializeMetrics(config?: Partial<MetricsServerConfig>): PrometheusMetrics {
  if (!globalMetrics) {
    globalMetrics = new PrometheusMetrics(config);
  }
  return globalMetrics;
}

/**
 * Get global metrics instance
 */
export function getMetrics(): PrometheusMetrics {
  if (!globalMetrics) {
    return initializeMetrics();
  }
  return globalMetrics;
}

/**
 * Start metrics server
 */
export function startMetricsServer(config?: Partial<MetricsServerConfig>): Promise<void> {
  const metrics = initializeMetrics(config);
  return metrics.start();
}

/**
 * Stop metrics server
 */
export function stopMetricsServer(): Promise<void> {
  if (globalMetrics) {
    return globalMetrics.stop();
  }
  return Promise.resolve();
}

// Export individual metrics for direct access if needed
export {
  jitAttemptTotal,
  jitSuccessTotal,
  jitFailureTotal,
  currentSimulatedProfitUsd,
  lastBundleBlockNumber,
  walletBalanceEth,
  poolDisabled,
  simulationDuration,
  gasPriceGwei,
  poolLiquidity,
  poolPrice,
  rpcRequestDuration,
  botUptime,
  opportunitiesDetected,
  simulationErrors
};