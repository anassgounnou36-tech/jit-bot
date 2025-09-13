import { register, collectDefaultMetrics, Counter, Gauge, Histogram } from 'prom-client';
import express from 'express';
import { createLogger } from '../logging/logger';
import { config } from '../config';

const logger = createLogger('Metrics');

/**
 * Prometheus metrics for JIT Bot monitoring
 */
export class PrometheusMetrics {
  private app: express.Application;
  private server: any;
  private readonly port: number;

  // Core JIT Bot metrics
  public readonly jitAttemptTotal: Counter<string>;
  public readonly jitSuccessTotal: Counter<string>;
  public readonly jitFailureTotal: Counter<string>;
  public readonly currentSimulatedProfitUsd: Gauge<string>;
  public readonly lastBundleBlockNumber: Gauge<string>;
  public readonly walletBalanceEth: Gauge<string>;
  public readonly poolDisabled: Gauge<string>;

  // Performance metrics
  public readonly simulationDuration: Histogram<string>;
  public readonly gasEstimationDuration: Histogram<string>;
  public readonly poolStateFetchDuration: Histogram<string>;

  // Pool-specific metrics
  public readonly poolProfitTotal: Counter<string>;
  public readonly poolSuccessRate: Gauge<string>;
  public readonly poolFailureCount: Counter<string>;
  public readonly poolEnabled: Gauge<string>;

  // System metrics
  public readonly rpcRequestTotal: Counter<string>;
  public readonly rpcRequestDuration: Histogram<string>;
  public readonly cacheHitTotal: Counter<string>;
  public readonly cacheMissTotal: Counter<string>;

  constructor(port: number = config.prometheusPort) {
    this.port = port;
    this.app = express();

    // Initialize metrics
    this.jitAttemptTotal = new Counter({
      name: 'jit_attempt_total',
      help: 'Total number of JIT liquidity provision attempts',
      labelNames: ['pool', 'token_pair', 'result'],
    });

    this.jitSuccessTotal = new Counter({
      name: 'jit_success_total',
      help: 'Total number of successful JIT executions',
      labelNames: ['pool', 'token_pair'],
    });

    this.jitFailureTotal = new Counter({
      name: 'jit_failure_total',
      help: 'Total number of failed JIT attempts',
      labelNames: ['pool', 'token_pair', 'error_type'],
    });

    this.currentSimulatedProfitUsd = new Gauge({
      name: 'current_simulated_profit_usd',
      help: 'Current estimated profit from simulation in USD',
      labelNames: ['pool', 'confidence'],
    });

    this.lastBundleBlockNumber = new Gauge({
      name: 'last_bundle_block_number',
      help: 'Block number of the last submitted bundle (placeholder for PR1)',
    });

    this.walletBalanceEth = new Gauge({
      name: 'wallet_balance_eth',
      help: 'Current wallet balance in ETH (placeholder for PR1)',
    });

    this.poolDisabled = new Gauge({
      name: 'pool_disabled',
      help: 'Pool disabled status (0=enabled, 1=disabled)',
      labelNames: ['pool'],
    });

    // Performance metrics
    this.simulationDuration = new Histogram({
      name: 'simulation_duration_seconds',
      help: 'Duration of simulations in seconds',
      labelNames: ['type', 'pool'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
    });

    this.gasEstimationDuration = new Histogram({
      name: 'gas_estimation_duration_seconds',
      help: 'Duration of gas estimations in seconds',
      buckets: [0.01, 0.05, 0.1, 0.5, 1],
    });

    this.poolStateFetchDuration = new Histogram({
      name: 'pool_state_fetch_duration_seconds',
      help: 'Duration of pool state fetches in seconds',
      labelNames: ['pool', 'cache_hit'],
      buckets: [0.05, 0.1, 0.5, 1, 2, 5],
    });

    // Pool-specific metrics
    this.poolProfitTotal = new Counter({
      name: 'pool_profit_total_usd',
      help: 'Total profit per pool in USD',
      labelNames: ['pool'],
    });

    this.poolSuccessRate = new Gauge({
      name: 'pool_success_rate',
      help: 'Success rate per pool (0-1)',
      labelNames: ['pool'],
    });

    this.poolFailureCount = new Counter({
      name: 'pool_failure_count',
      help: 'Number of failures per pool',
      labelNames: ['pool', 'failure_type'],
    });

    this.poolEnabled = new Gauge({
      name: 'pool_enabled',
      help: 'Pool enabled status (0=disabled, 1=enabled)',
      labelNames: ['pool'],
    });

    // System metrics
    this.rpcRequestTotal = new Counter({
      name: 'rpc_request_total',
      help: 'Total RPC requests',
      labelNames: ['method', 'status'],
    });

    this.rpcRequestDuration = new Histogram({
      name: 'rpc_request_duration_seconds',
      help: 'RPC request duration in seconds',
      labelNames: ['method'],
      buckets: [0.1, 0.5, 1, 2, 5, 10],
    });

    this.cacheHitTotal = new Counter({
      name: 'cache_hit_total',
      help: 'Total cache hits',
      labelNames: ['cache_type'],
    });

    this.cacheMissTotal = new Counter({
      name: 'cache_miss_total',
      help: 'Total cache misses',
      labelNames: ['cache_type'],
    });

    // Collect default Node.js metrics
    collectDefaultMetrics({ register });

    this.setupRoutes();
    logger.info('Prometheus metrics initialized', { port: this.port });
  }

  /**
   * Setup Express routes for metrics endpoint
   */
  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        mode: config.simulationMode ? 'simulation' : 'live',
      });
    });

    // Metrics endpoint
    this.app.get('/metrics', async (req, res) => {
      try {
        res.set('Content-Type', register.contentType);
        const metrics = await register.metrics();
        res.send(metrics);
      } catch (error: any) {
        logger.error('Failed to generate metrics', { error: error.message });
        res.status(500).send('Error generating metrics');
      }
    });

    // Metrics summary endpoint (human-readable)
    this.app.get('/metrics/summary', async (req, res) => {
      try {
        const summary = await this.getMetricsSummary();
        res.json(summary);
      } catch (error: any) {
        logger.error('Failed to generate metrics summary', { error: error.message });
        res.status(500).json({ error: 'Failed to generate summary' });
      }
    });
  }

  /**
   * Start the metrics server
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, () => {
          logger.info('Metrics server started', {
            port: this.port,
            metricsEndpoint: `http://localhost:${this.port}/metrics`,
            healthEndpoint: `http://localhost:${this.port}/health`,
          });
          resolve();
        });

        this.server.on('error', (error: any) => {
          logger.error('Metrics server error', { error: error.message });
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop the metrics server
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('Metrics server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Record a JIT attempt
   */
  recordJitAttempt(pool: string, tokenPair: string, result: 'success' | 'failure' | 'skipped'): void {
    this.jitAttemptTotal.inc({ pool, token_pair: tokenPair, result });
  }

  /**
   * Record a successful JIT execution
   */
  recordJitSuccess(pool: string, tokenPair: string, profitUsd: number): void {
    this.jitSuccessTotal.inc({ pool, token_pair: tokenPair });
    this.poolProfitTotal.inc({ pool }, profitUsd);
  }

  /**
   * Record a JIT failure
   */
  recordJitFailure(pool: string, tokenPair: string, errorType: string): void {
    this.jitFailureTotal.inc({ pool, token_pair: tokenPair, error_type: errorType });
    this.poolFailureCount.inc({ pool, failure_type: errorType });
  }

  /**
   * Update current simulated profit
   */
  updateSimulatedProfit(pool: string, profitUsd: number, confidence: string): void {
    this.currentSimulatedProfitUsd.set({ pool, confidence }, profitUsd);
  }

  /**
   * Update pool status
   */
  updatePoolStatus(pool: string, enabled: boolean): void {
    this.poolEnabled.set({ pool }, enabled ? 1 : 0);
    this.poolDisabled.set({ pool }, enabled ? 0 : 1);
  }

  /**
   * Record simulation performance
   */
  recordSimulationDuration(type: 'fast' | 'fork', pool: string, durationSeconds: number): void {
    this.simulationDuration.observe({ type, pool }, durationSeconds);
  }

  /**
   * Record RPC performance
   */
  recordRpcRequest(method: string, status: 'success' | 'error', durationSeconds: number): void {
    this.rpcRequestTotal.inc({ method, status });
    this.rpcRequestDuration.observe({ method }, durationSeconds);
  }

  /**
   * Record cache performance
   */
  recordCacheEvent(cacheType: string, hit: boolean): void {
    if (hit) {
      this.cacheHitTotal.inc({ cache_type: cacheType });
    } else {
      this.cacheMissTotal.inc({ cache_type: cacheType });
    }
  }

  /**
   * Update wallet balance (placeholder for PR1)
   */
  updateWalletBalance(balanceEth: number): void {
    this.walletBalanceEth.set(balanceEth);
  }

  /**
   * Update last bundle block number (placeholder for PR1)
   */
  updateLastBundleBlock(blockNumber: number): void {
    this.lastBundleBlockNumber.set(blockNumber);
  }

  /**
   * Get human-readable metrics summary
   */
  private async getMetricsSummary(): Promise<any> {
    const metricsString = await register.metrics();
    const lines = metricsString.split('\n');
    
    const summary: any = {
      timestamp: new Date().toISOString(),
      mode: config.simulationMode ? 'simulation' : 'live',
      jit_attempts: this.extractMetricValue(lines, 'jit_attempt_total'),
      jit_successes: this.extractMetricValue(lines, 'jit_success_total'),
      jit_failures: this.extractMetricValue(lines, 'jit_failure_total'),
      current_simulated_profit: this.extractMetricValue(lines, 'current_simulated_profit_usd'),
      wallet_balance: this.extractMetricValue(lines, 'wallet_balance_eth'),
      pool_status: this.extractPoolMetrics(lines),
      system: {
        uptime_seconds: process.uptime(),
        memory_usage: process.memoryUsage(),
        node_version: process.version,
      },
    };

    return summary;
  }

  /**
   * Extract metric value from Prometheus format
   */
  private extractMetricValue(lines: string[], metricName: string): any {
    const metricLines = lines.filter(line => 
      line.startsWith(metricName) && !line.startsWith('#')
    );
    
    if (metricLines.length === 0) return 0;
    
    // Handle different metric types
    if (metricLines.length === 1) {
      const match = metricLines[0].match(/(\d+\.?\d*)/);
      return match ? parseFloat(match[1]) : 0;
    }
    
    // Handle labeled metrics
    const labeled: any = {};
    metricLines.forEach(line => {
      const labelMatch = line.match(/\{([^}]+)\}/);
      const valueMatch = line.match(/(\d+\.?\d*)$/);
      
      if (labelMatch && valueMatch) {
        labeled[labelMatch[1]] = parseFloat(valueMatch[1]);
      }
    });
    
    return labeled;
  }

  /**
   * Extract pool-specific metrics
   */
  private extractPoolMetrics(lines: string[]): any {
    const poolMetrics: any = {};
    
    const poolEnabledLines = lines.filter(line => 
      line.startsWith('pool_enabled') && !line.startsWith('#')
    );
    
    poolEnabledLines.forEach(line => {
      const poolMatch = line.match(/pool="([^"]+)"/);
      const valueMatch = line.match(/(\d+)$/);
      
      if (poolMatch && valueMatch) {
        const pool = poolMatch[1];
        poolMetrics[pool] = {
          enabled: parseInt(valueMatch[1]) === 1,
        };
      }
    });
    
    return poolMetrics;
  }

  /**
   * Initialize placeholder metrics for PR1
   */
  initializePlaceholders(): void {
    // Set initial placeholder values
    this.lastBundleBlockNumber.set(0); // No bundles in PR1
    this.walletBalanceEth.set(0); // Placeholder in PR1
    
    // Initialize pool metrics for configured pools
    config.poolIds.forEach(poolId => {
      this.poolEnabled.set({ pool: poolId }, 0); // All disabled in PR1
      this.poolDisabled.set({ pool: poolId }, 1);
      this.currentSimulatedProfitUsd.set({ pool: poolId, confidence: 'low' }, 0);
    });

    logger.info('Placeholder metrics initialized for PR1', {
      pools: config.poolIds.length,
    });
  }

  /**
   * Get metrics registry for advanced usage
   */
  getRegistry(): typeof register {
    return register;
  }
}

// Export singleton instance
export const prometheusMetrics = new PrometheusMetrics();