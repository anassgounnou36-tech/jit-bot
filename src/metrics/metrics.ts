import express from 'express';
import { ethers } from 'ethers';

export interface BotMetrics {
  // Performance metrics
  totalSwapsDetected: number;
  totalBundlesSubmitted: number;
  totalBundlesIncluded: number;
  successRate: number;
  
  // Financial metrics
  totalProfitEth: string;
  totalGasSpentEth: string;
  netProfitEth: string;
  averageProfitPerBundle: string;
  
  // Operational metrics
  uptime: number;
  lastSwapDetected: number;
  lastBundleSubmitted: number;
  lastSuccessfulExecution: number;
  
  // Error tracking
  simulationFailures: number;
  bundleRejections: number;
  executionErrors: number;
  networkErrors: number;
}

export interface SwapOpportunity {
  timestamp: number;
  hash: string;
  pool: string;
  amountIn: string;
  estimatedProfit: string;
  executed: boolean;
  profitable: boolean;
  reason?: string;
}

export class Metrics {
  private metrics: BotMetrics;
  private opportunities: SwapOpportunity[] = [];
  private app: express.Application;
  private server: any;
  private port: number;
  private startTime: number;

  constructor(port: number = 3001) {
    this.port = port;
    this.startTime = Date.now();
    
    this.metrics = {
      totalSwapsDetected: 0,
      totalBundlesSubmitted: 0,
      totalBundlesIncluded: 0,
      successRate: 0,
      totalProfitEth: '0',
      totalGasSpentEth: '0',
      netProfitEth: '0',
      averageProfitPerBundle: '0',
      uptime: 0,
      lastSwapDetected: 0,
      lastBundleSubmitted: 0,
      lastSuccessfulExecution: 0,
      simulationFailures: 0,
      bundleRejections: 0,
      executionErrors: 0,
      networkErrors: 0
    };

    this.app = express();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.app.use(express.json());

    // Health check endpoint
    this.app.get('/health', (_req, res) => {
      res.json({
        status: 'healthy',
        uptime: this.getUptime(),
        timestamp: Date.now()
      });
    });

    // Main metrics endpoint
    this.app.get('/metrics', (_req, res) => {
      this.updateCalculatedMetrics();
      res.json(this.metrics);
    });

    // Detailed metrics endpoint
    this.app.get('/metrics/detailed', (_req, res) => {
      this.updateCalculatedMetrics();
      res.json({
        ...this.metrics,
        recentOpportunities: this.opportunities.slice(-20), // Last 20 opportunities
        hourlyStats: this.getHourlyStats(),
        dailyStats: this.getDailyStats()
      });
    });

    // Opportunities endpoint
    this.app.get('/opportunities', (req, res) => {
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      
      res.json({
        total: this.opportunities.length,
        opportunities: this.opportunities.slice(offset, offset + limit)
      });
    });

    // Prometheus metrics endpoint
    this.app.get('/metrics/prometheus', (_req, res) => {
      res.set('Content-Type', 'text/plain');
      res.send(this.generatePrometheusMetrics());
    });
  }

  start(): void {
    this.server = this.app.listen(this.port, () => {
      console.log(`📊 Metrics server started on port ${this.port}`);
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      console.log('📊 Metrics server stopped');
    }
  }

  // Metric recording methods
  recordSwapDetected(swap: SwapOpportunity): void {
    this.metrics.totalSwapsDetected++;
    this.metrics.lastSwapDetected = Date.now();
    this.opportunities.push(swap);
    
    // Keep only last 1000 opportunities in memory
    if (this.opportunities.length > 1000) {
      this.opportunities = this.opportunities.slice(-1000);
    }
    
    console.log(`📈 Swap detected: ${swap.hash} (Total: ${this.metrics.totalSwapsDetected})`);
  }

  recordBundleSubmitted(bundleHash: string): void {
    this.metrics.totalBundlesSubmitted++;
    this.metrics.lastBundleSubmitted = Date.now();
    console.log(`📤 Bundle submitted: ${bundleHash} (Total: ${this.metrics.totalBundlesSubmitted})`);
  }

  recordBundleIncluded(bundleHash: string, profit: ethers.BigNumber, gasSpent: ethers.BigNumber): void {
    this.metrics.totalBundlesIncluded++;
    this.metrics.lastSuccessfulExecution = Date.now();
    
    // Update financial metrics
    const currentProfit = ethers.BigNumber.from(this.metrics.totalProfitEth || '0');
    const currentGasSpent = ethers.BigNumber.from(this.metrics.totalGasSpentEth || '0');
    
    this.metrics.totalProfitEth = currentProfit.add(profit).toString();
    this.metrics.totalGasSpentEth = currentGasSpent.add(gasSpent).toString();
    
    console.log(`✅ Bundle included: ${bundleHash} (Profit: ${ethers.utils.formatEther(profit)} ETH)`);
  }

  recordSimulationFailure(reason: string): void {
    this.metrics.simulationFailures++;
    console.log(`❌ Simulation failure: ${reason}`);
  }

  recordBundleRejection(reason: string): void {
    this.metrics.bundleRejections++;
    console.log(`❌ Bundle rejection: ${reason}`);
  }

  recordExecutionError(error: string): void {
    this.metrics.executionErrors++;
    console.log(`❌ Execution error: ${error}`);
  }

  recordNetworkError(error: string): void {
    this.metrics.networkErrors++;
    console.log(`❌ Network error: ${error}`);
  }

  private updateCalculatedMetrics(): void {
    // Update uptime
    this.metrics.uptime = this.getUptime();
    
    // Calculate success rate
    if (this.metrics.totalBundlesSubmitted > 0) {
      this.metrics.successRate = this.metrics.totalBundlesIncluded / this.metrics.totalBundlesSubmitted;
    }
    
    // Calculate net profit
    const totalProfit = ethers.BigNumber.from(this.metrics.totalProfitEth || '0');
    const totalGasSpent = ethers.BigNumber.from(this.metrics.totalGasSpentEth || '0');
    this.metrics.netProfitEth = totalProfit.sub(totalGasSpent).toString();
    
    // Calculate average profit per bundle
    if (this.metrics.totalBundlesIncluded > 0) {
      const avgProfit = totalProfit.div(this.metrics.totalBundlesIncluded);
      this.metrics.averageProfitPerBundle = avgProfit.toString();
    }
  }

  private getUptime(): number {
    return Date.now() - this.startTime;
  }

  private getHourlyStats(): any {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    
    const recentOpportunities = this.opportunities.filter(
      op => op.timestamp > oneHourAgo
    );
    
    return {
      detected: recentOpportunities.length,
      executed: recentOpportunities.filter(op => op.executed).length,
      profitable: recentOpportunities.filter(op => op.profitable).length
    };
  }

  private getDailyStats(): any {
    const now = Date.now();
    const oneDayAgo = now - (24 * 60 * 60 * 1000);
    
    const dailyOpportunities = this.opportunities.filter(
      op => op.timestamp > oneDayAgo
    );
    
    return {
      detected: dailyOpportunities.length,
      executed: dailyOpportunities.filter(op => op.executed).length,
      profitable: dailyOpportunities.filter(op => op.profitable).length
    };
  }

  private generatePrometheusMetrics(): string {
    this.updateCalculatedMetrics();
    
    return `
# HELP jit_bot_swaps_detected_total Total number of swaps detected
# TYPE jit_bot_swaps_detected_total counter
jit_bot_swaps_detected_total ${this.metrics.totalSwapsDetected}

# HELP jit_bot_bundles_submitted_total Total number of bundles submitted
# TYPE jit_bot_bundles_submitted_total counter
jit_bot_bundles_submitted_total ${this.metrics.totalBundlesSubmitted}

# HELP jit_bot_bundles_included_total Total number of bundles included
# TYPE jit_bot_bundles_included_total counter
jit_bot_bundles_included_total ${this.metrics.totalBundlesIncluded}

# HELP jit_bot_success_rate Success rate of bundle inclusion
# TYPE jit_bot_success_rate gauge
jit_bot_success_rate ${this.metrics.successRate}

# HELP jit_bot_total_profit_eth Total profit in ETH
# TYPE jit_bot_total_profit_eth gauge
jit_bot_total_profit_eth ${ethers.utils.formatEther(this.metrics.totalProfitEth || '0')}

# HELP jit_bot_net_profit_eth Net profit in ETH
# TYPE jit_bot_net_profit_eth gauge
jit_bot_net_profit_eth ${ethers.utils.formatEther(this.metrics.netProfitEth || '0')}

# HELP jit_bot_uptime_seconds Bot uptime in seconds
# TYPE jit_bot_uptime_seconds gauge
jit_bot_uptime_seconds ${Math.floor(this.metrics.uptime / 1000)}

# HELP jit_bot_simulation_failures_total Total simulation failures
# TYPE jit_bot_simulation_failures_total counter
jit_bot_simulation_failures_total ${this.metrics.simulationFailures}

# HELP jit_bot_bundle_rejections_total Total bundle rejections
# TYPE jit_bot_bundle_rejections_total counter
jit_bot_bundle_rejections_total ${this.metrics.bundleRejections}

# HELP jit_bot_execution_errors_total Total execution errors
# TYPE jit_bot_execution_errors_total counter
jit_bot_execution_errors_total ${this.metrics.executionErrors}

# HELP jit_bot_network_errors_total Total network errors
# TYPE jit_bot_network_errors_total counter
jit_bot_network_errors_total ${this.metrics.networkErrors}
    `.trim();
  }

  // Utility method to get current metrics
  getMetrics(): BotMetrics {
    this.updateCalculatedMetrics();
    return { ...this.metrics };
  }

  // Method to export metrics to external systems
  async exportMetrics(destination: string): Promise<void> {
    const metrics = this.getMetrics();
    
    // This could be implemented to send metrics to:
    // - InfluxDB
    // - CloudWatch
    // - Datadog
    // - Custom webhook
    
    console.log(`📊 Exporting metrics to ${destination}`);
    console.log(JSON.stringify(metrics, null, 2));
  }
}