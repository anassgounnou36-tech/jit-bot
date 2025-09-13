import { ethers } from 'ethers';
import { MempoolWatcher, PendingSwap } from '../watcher/mempoolWatcher';
import { Simulator, JitParameters } from '../watcher/simulator';
import { BundleBuilder } from '../bundler/bundleBuilder';
import { Executor } from '../executor/executor';
import { Metrics, SwapOpportunity } from '../metrics/metrics';
import { PoolCoordinator } from '../coordinator/poolCoordinator';
import { config, AppConfig } from '../config';
import { createLogger, PerformanceLogger } from '../logging/logger';
import { stateFetcher } from '../pool/stateFetcher';
import { gasEstimator } from '../util/gasEstimator';
import { priceOracle, SupportedToken } from '../price/oracle';
import { fastSimulator } from '../simulator/fastSim';
import { forkSimulator } from '../simulator/forkSim';
import { prometheusMetrics } from '../metrics/prom';

const logger = createLogger('JitBot');

export interface BotConfig {
  mode: 'simulation' | 'live';
  network: string;
  profitThresholdUSD: number;
  maxGasGwei: number;
  retryAttempts: number;
  retryDelayMs: number;
  useMultiPool: boolean;
}

export class JitBot {
  private httpProvider: ethers.providers.JsonRpcProvider;
  private wsProvider: ethers.providers.WebSocketProvider | null = null;
  private mempoolWatcher: MempoolWatcher | null = null; // For single-pool mode
  private poolCoordinator: PoolCoordinator | null = null; // For multi-pool mode
  private simulator: Simulator;
  private bundleBuilder: BundleBuilder;
  private executor: Executor;
  private metrics: Metrics;
  private isRunning: boolean = false;
  private contractAddress: string;
  private botConfig: BotConfig;
  private appConfig: AppConfig;

  constructor() {
    // Use the typed configuration
    this.appConfig = config;
    
    // Create bot configuration from app config
    this.botConfig = {
      mode: this.appConfig.simulationMode ? 'simulation' : 'live',
      network: this.appConfig.chain,
      profitThresholdUSD: this.appConfig.globalMinProfitUsd,
      maxGasGwei: this.appConfig.maxGasGwei,
      retryAttempts: 3,
      retryDelayMs: 1000,
      useMultiPool: this.appConfig.enableMultiPool || this.appConfig.poolIds.length > 0
    };

    logger.info('Starting JIT Bot with new configuration system', {
      mode: this.botConfig.mode,
      chain: this.appConfig.chain,
      multiPool: this.botConfig.useMultiPool,
      poolCount: this.appConfig.poolIds.length,
      simulationMode: this.appConfig.simulationMode,
    });

    // Enforce simulation-only mode for PR1
    if (!this.appConfig.simulationMode) {
      logger.warn('SIMULATION_MODE forced to true for PR1 safety');
      this.appConfig.simulationMode = true;
      this.botConfig.mode = 'simulation';
    }

    // Initialize providers using new config
    this.httpProvider = new ethers.providers.JsonRpcProvider(this.appConfig.rpcUrlHttp);
    
    try {
      this.wsProvider = new ethers.providers.WebSocketProvider(this.appConfig.rpcUrlWs);
    } catch (error: any) {
      logger.warn('WebSocket provider initialization failed, will retry during start', {
        error: error.message,
      });
    }
    
    // Initialize components
    this.simulator = new Simulator(this.appConfig.rpcUrlHttp);
    
    // Validate private key for simulation mode
    if (this.appConfig.privateKey) {
      this.bundleBuilder = new BundleBuilder(this.appConfig.privateKey, this.httpProvider);
    } else {
      logger.warn('Private key not provided - bundle building will be mocked in simulation mode');
      // Create mock bundler for simulation
      this.bundleBuilder = new BundleBuilder('0x1111111111111111111111111111111111111111111111111111111111111111', this.httpProvider);
    }
    
    this.executor = new Executor(this.httpProvider);
    this.metrics = new Metrics(this.appConfig.metricsPort, this.botConfig.mode === 'live');
    
    // Contract address (placeholder for PR1)
    this.contractAddress = '0x0000000000000000000000000000000000000000'; // Will be set in PR2
    
    // Validate that we're not in production mode for PR1
    if (this.appConfig.nodeEnv === 'production' && !this.appConfig.simulationMode) {
      throw new Error(
        'CRITICAL SAFETY ERROR: Production mode with live execution is FORBIDDEN in PR1. ' +
        'Set NODE_ENV=development or SIMULATION_MODE=true.'
      );
    }

    // Initialize either multi-pool coordinator or single watcher
    if (this.botConfig.useMultiPool) {
      this.poolCoordinator = new PoolCoordinator(
        this.httpProvider,
        this.simulator,
        this.bundleBuilder,
        this.executor,
        this.metrics,
        this.contractAddress
      );
    } else if (this.wsProvider) {
      this.mempoolWatcher = new MempoolWatcher(this.appConfig.rpcUrlWs);
    }
    
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Handle detected swaps (only for single-pool mode)
    if (this.mempoolWatcher) {
      this.mempoolWatcher.on('swapDetected', async (swap: PendingSwap) => {
        await this.handleSwapDetected(swap);
      });
    }

    // Handle process termination
    process.on('SIGINT', () => {
      logger.info('Received SIGINT, shutting down gracefully...');
      this.stop();
    });

    process.on('SIGTERM', () => {
      logger.info('Received SIGTERM, shutting down gracefully...');
      this.stop();
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error: Error) => {
      logger.error('Uncaught exception:', { error: error.message, stack: error.stack });
      prometheusMetrics.recordJitFailure('unknown', 'unknown', 'uncaught_exception');
      
      if (this.botConfig.mode === 'live') {
        logger.error('Critical error in live mode, shutting down for safety');
        this.stop();
      }
    });

    process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
      logger.error('Unhandled rejection', { reason: String(reason), promise });
      prometheusMetrics.recordJitFailure('unknown', 'unknown', 'unhandled_rejection');
      
      if (this.botConfig.mode === 'live') {
        logger.error('Critical error in live mode, shutting down for safety');
        this.stop();
      }
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Bot is already running');
      return;
    }

    return PerformanceLogger.measure(logger, 'bot_startup', async (perf) => {
      logger.info('Starting JIT Bot with enhanced observability', {
        mode: this.botConfig.mode,
        network: this.botConfig.network,
        profitThreshold: this.botConfig.profitThresholdUSD,
        maxGas: this.botConfig.maxGasGwei,
        pools: this.appConfig.poolIds.length,
      });

      perf.checkpoint('config_validation');
      
      try {
        // Start metrics server first
        prometheusMetrics.initializePlaceholders();
        await prometheusMetrics.start();
        
        perf.checkpoint('metrics_started');
        
        // Start legacy metrics (maintaining backward compatibility)
        this.metrics.start();
        
        // Validate configuration
        await this.validateConfiguration();
        
        perf.checkpoint('config_validated');

        // Initialize fork simulator if possible
        await forkSimulator.initializeFork();
        
        perf.checkpoint('fork_sim_initialized');

        // Additional safety checks for live mode (should not happen in PR1)
        if (this.botConfig.mode === 'live') {
          logger.error('SAFETY VIOLATION: Live mode detected in PR1 - this should be impossible');
          throw new Error('Live mode is forbidden in PR1');
        }

        // Start either pool coordinator or mempool watcher
        if (this.botConfig.useMultiPool && this.poolCoordinator) {
          await this.poolCoordinator.start();
        } else if (this.mempoolWatcher) {
          await this.mempoolWatcher.start();
        } else {
          logger.warn('No mempool monitoring started - WebSocket provider not available');
        }

        perf.checkpoint('watchers_started');

        this.isRunning = true;
        
        logger.info('JIT Bot started successfully', {
          mode: this.botConfig.mode,
          simulationOnly: this.appConfig.simulationMode,
          metricsPort: this.appConfig.prometheusPort,
          components: this.getActiveComponents(),
        });

        // Start monitoring loop
        this.startMonitoringLoop();

        // Keep the process alive
        this.keepAlive();

      } catch (error: any) {
        logger.error('Failed to start JIT Bot', { error: error.message, stack: error.stack });
        prometheusMetrics.recordJitFailure('startup', 'unknown', 'startup_error');
        throw error;
      }
    });
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping JIT Bot...');

    try {
      // Stop components
      if (this.botConfig.useMultiPool && this.poolCoordinator) {
        await this.poolCoordinator.stop();
      } else if (this.mempoolWatcher) {
        await this.mempoolWatcher.stop();
      }
      
      // Stop WebSocket provider
      if (this.wsProvider) {
        this.wsProvider.destroy();
      }
      
      // Stop metrics servers
      await prometheusMetrics.stop();
      this.metrics.stop();

      this.isRunning = false;
      logger.info('JIT Bot stopped successfully');
      process.exit(0);

    } catch (error: any) {
      logger.error('Error stopping JIT Bot', { error: error.message });
      process.exit(1);
    }
  }

  private async validateConfiguration(): Promise<void> {
    return PerformanceLogger.measure(logger, 'config_validation', async (perf) => {
      logger.info('Validating configuration and connectivity...');

      perf.checkpoint('rpc_connectivity');
      
      // Check HTTP RPC connection
      try {
        const blockNumber = await this.httpProvider.getBlockNumber();
        logger.info('HTTP RPC connected', { 
          endpoint: this.appConfig.rpcUrlHttp.replace(/\/[^/]*$/, '/***'),
          blockNumber,
        });
        prometheusMetrics.recordRpcRequest('getBlockNumber', 'success', 0.1);
      } catch (error: any) {
        prometheusMetrics.recordRpcRequest('getBlockNumber', 'error', 0.1);
        throw new Error(`Failed to connect to HTTP RPC: ${error.message}`);
      }

      // Check WebSocket RPC connection
      if (this.wsProvider) {
        try {
          await this.wsProvider.getBlockNumber();
          logger.info('WebSocket RPC connected', {
            endpoint: this.appConfig.rpcUrlWs.replace(/\/[^/]*$/, '/***'),
          });
        } catch (error: any) {
          logger.warn('WebSocket RPC connection failed', { error: error.message });
        }
      }

      perf.checkpoint('pool_validation');
      
      // Validate configured pools
      if (this.appConfig.poolIds.length > 0) {
        const validPools = 0;
        for (const poolId of this.appConfig.poolIds) {
          try {
            const isValid = await stateFetcher.validatePoolAddress(poolId);
            if (isValid) {
              const poolState = await stateFetcher.getPoolState(poolId);
              logger.debug('Pool validated', {
                pool: poolId,
                tick: poolState.tick,
                liquidity: poolState.liquidity.toString(),
              });
              prometheusMetrics.updatePoolStatus(poolId, true);
            } else {
              logger.warn('Invalid pool address', { pool: poolId });
              prometheusMetrics.updatePoolStatus(poolId, false);
            }
          } catch (error: any) {
            logger.warn('Pool validation failed', { pool: poolId, error: error.message });
            prometheusMetrics.updatePoolStatus(poolId, false);
          }
        }
        
        logger.info('Pool validation completed', {
          totalPools: this.appConfig.poolIds.length,
          validPools,
        });
      }

      perf.checkpoint('oracle_health');
      
      // Check price oracle health
      try {
        const healthCheck = await priceOracle.checkFeedHealth();
        logger.info('Price oracle health check', {
          healthy: healthCheck.healthy,
          feeds: healthCheck.details.length,
        });
      } catch (error: any) {
        logger.warn('Price oracle health check failed', { error: error.message });
      }

      perf.checkpoint('gas_estimation');
      
      // Test gas estimation
      try {
        const gasPrice = await gasEstimator.getGasPriceGwei();
        logger.info('Gas estimation working', {
          gasPriceGwei: gasPrice,
          maxGwei: this.appConfig.maxGasGwei,
          acceptable: gasPrice <= this.appConfig.maxGasGwei,
        });
      } catch (error: any) {
        logger.warn('Gas estimation failed', { error: error.message });
      }

      logger.info('Configuration validation completed successfully');
    });
  }

  private async handleSwapDetected(swap: PendingSwap): Promise<void> {
    const { traceId, logger: swapLogger } = logger.newTrace();
    
    swapLogger.info('Processing swap opportunity', {
      hash: swap.hash,
      pool: swap.pool,
      amountIn: swap.amountIn,
    });

    const opportunity: SwapOpportunity = {
      timestamp: Date.now(),
      hash: swap.hash,
      pool: swap.pool,
      amountIn: swap.amountIn,
      estimatedProfit: '0',
      executed: false,
      profitable: false
    };

    try {
      // Record attempt
      const poolConfig = this.appConfig.configData.targets.find(t => t.address.toLowerCase() === swap.pool.toLowerCase());
      const tokenPair = poolConfig ? `${poolConfig.symbol0}-${poolConfig.symbol1}` : 'unknown';
      
      prometheusMetrics.recordJitAttempt(swap.pool, tokenPair, 'started');

      // Step 1: Fast simulation for quick filtering
      const fastSimStart = Date.now();
      const fastSimResult = await fastSimulator.simulateOpportunity({
        hash: swap.hash,
        poolAddress: swap.pool,
        tokenIn: swap.tokenIn,
        tokenOut: swap.tokenOut,
        amountIn: swap.amountIn,
        amountOut: swap.amountOut || ethers.BigNumber.from(0),
        estimatedPrice: ethers.BigNumber.from(0),
      });
      
      const fastSimDuration = (Date.now() - fastSimStart) / 1000;
      prometheusMetrics.recordSimulationDuration('fast', swap.pool, fastSimDuration);
      
      swapLogger.info('Fast simulation completed', {
        profitable: fastSimResult.profitable,
        estimatedProfitUsd: fastSimResult.estimatedNetProfitUsd.toFixed(2),
        confidence: fastSimResult.confidence,
        lpShare: (fastSimResult.lpShare * 100).toFixed(2) + '%',
      });

      opportunity.estimatedProfit = fastSimResult.estimatedNetProfitUsd.toString();
      opportunity.profitable = fastSimResult.profitable;

      // Update current simulated profit metric
      prometheusMetrics.updateSimulatedProfit(
        swap.pool,
        fastSimResult.estimatedNetProfitUsd,
        fastSimResult.confidence
      );

      // Step 2: Check if profitable enough for fork simulation
      if (!fastSimResult.profitable) {
        swapLogger.info('Opportunity rejected by fast simulation', {
          reason: fastSimResult.reason,
        });
        prometheusMetrics.recordJitAttempt(swap.pool, tokenPair, 'skipped');
        return;
      }

      // Step 3: Fork simulation for validation (if available)
      let forkValidated = false;
      try {
        const forkSimStart = Date.now();
        const forkResult = await forkSimulator.validateOpportunity(
          {
            hash: swap.hash,
            poolAddress: swap.pool,
            tokenIn: swap.tokenIn,
            tokenOut: swap.tokenOut,
            amountIn: swap.amountIn,
            amountOut: swap.amountOut || ethers.BigNumber.from(0),
            estimatedPrice: ethers.BigNumber.from(0),
          },
          fastSimResult
        );
        
        const forkSimDuration = (Date.now() - forkSimStart) / 1000;
        prometheusMetrics.recordSimulationDuration('fork', swap.pool, forkSimDuration);
        
        forkValidated = forkResult.forkValidated;
        
        swapLogger.info('Fork validation completed', {
          validated: forkValidated,
          adjustedProfitUsd: forkResult.estimatedNetProfitUsd.toFixed(2),
          slippage: (forkResult.actualSlippage * 100).toFixed(2) + '%',
        });

        // Update profit estimate with fork-validated value
        opportunity.estimatedProfit = forkResult.estimatedNetProfitUsd.toString();
        opportunity.profitable = forkResult.profitable;

      } catch (error: any) {
        swapLogger.warn('Fork validation failed, proceeding with fast sim result', {
          error: error.message,
        });
      }

      // Step 4: Final profitability check
      if (!opportunity.profitable) {
        swapLogger.info('Opportunity rejected after validation');
        prometheusMetrics.recordJitAttempt(swap.pool, tokenPair, 'skipped');
        return;
      }

      // Step 5: In PR1, we STOP here - no actual execution
      swapLogger.info('SIMULATION MODE: Would execute opportunity', {
        estimatedProfitUsd: opportunity.estimatedProfit,
        forkValidated,
        simulationOnly: true,
      });

      // Record as successful simulation
      prometheusMetrics.recordJitSuccess(swap.pool, tokenPair, parseFloat(opportunity.estimatedProfit));
      opportunity.executed = true; // Mark as "executed" in simulation mode

      // Record the simulated opportunity
      this.metrics.recordSwapDetected(opportunity);

    } catch (error: any) {
      swapLogger.error('Error processing swap opportunity', {
        error: error.message,
        stack: error.stack,
      });
      
      const poolConfig = this.appConfig.configData.targets.find(t => t.address.toLowerCase() === swap.pool.toLowerCase());
      const tokenPair = poolConfig ? `${poolConfig.symbol0}-${poolConfig.symbol1}` : 'unknown';
      prometheusMetrics.recordJitFailure(swap.pool, tokenPair, 'processing_error');
      
      opportunity.reason = error.message;
    }
  }

  private startMonitoringLoop(): void {
    // Update system metrics every 30 seconds
    setInterval(async () => {
      if (!this.isRunning) return;

      try {
        // Update wallet balance (mock for PR1)
        prometheusMetrics.updateWalletBalance(0); // Placeholder

        // Update last bundle block (mock for PR1)
        const currentBlock = await this.httpProvider.getBlockNumber();
        prometheusMetrics.updateLastBundleBlock(currentBlock);

        // Log periodic status
        const metrics = this.metrics.getMetrics();
        logger.debug('Periodic status update', {
          mode: this.botConfig.mode,
          simulationMode: this.appConfig.simulationMode,
          swapsDetected: metrics.totalSwapsDetected,
          successfulExecutions: metrics.totalBundlesIncluded,
          currentBlock,
        });

      } catch (error: any) {
        logger.warn('Monitoring loop error', { error: error.message });
      }
    }, 30000);
  }

  private getActiveComponents(): string[] {
    const components = ['config', 'stateFetcher', 'gasEstimator', 'priceOracle', 'fastSimulator'];
    
    if (this.wsProvider) components.push('webSocketProvider');
    if (this.poolCoordinator) components.push('poolCoordinator');
    if (this.mempoolWatcher) components.push('mempoolWatcher');
    
    components.push('prometheusMetrics', 'forkSimulator');
    
    return components;
  }

  private keepAlive(): void {
    // Log status every 60 seconds
    setInterval(() => {
      if (this.isRunning) {
        const metrics = this.metrics.getMetrics();
        logger.info('Bot status report', {
          mode: this.botConfig.mode,
          simulationOnly: this.appConfig.simulationMode,
          uptime: process.uptime(),
          swapsDetected: metrics.totalSwapsDetected,
          successfulExecutions: metrics.totalBundlesIncluded,
          memoryUsage: process.memoryUsage(),
        });
      }
    }, 60000);
  }

  // Public method to get bot status
  getStatus(): any {
    const baseStatus = {
      isRunning: this.isRunning,
      mode: this.botConfig.mode,
      simulationMode: this.appConfig.simulationMode,
      network: this.botConfig.network,
      contractAddress: this.contractAddress,
      config: {
        profitThresholdUSD: this.botConfig.profitThresholdUSD,
        maxGasGwei: this.botConfig.maxGasGwei,
        poolCount: this.appConfig.poolIds.length,
        useMultiPool: this.botConfig.useMultiPool,
      },
      metrics: this.metrics.getMetrics(),
      components: this.getActiveComponents(),
      pr1Status: {
        configLoaded: true,
        simulationOnly: this.appConfig.simulationMode,
        liveExecutionDisabled: true,
        fastSimReady: true,
        forkSimReady: true,
        metricsEnabled: true,
        oracleEnabled: true,
      },
    };

    // Add pool coordinator status if in multi-pool mode
    if (this.botConfig.useMultiPool && this.poolCoordinator) {
      return {
        ...baseStatus,
        multiPool: {
          enabled: true,
          pools: this.poolCoordinator.getPoolStatus(),
          currentOpportunities: this.poolCoordinator.getCurrentOpportunities()
        }
      };
    }

    return {
      ...baseStatus,
      multiPool: {
        enabled: false
      }
    };
  }
}

// CLI interface
if (require.main === module) {
  const bot = new JitBot();

  // Handle command line arguments
  const command = process.argv[2];

  switch (command) {
    case 'start':
      bot.start().catch(error => {
        logger.error('Failed to start bot', { error: error.message, stack: error.stack });
        process.exit(1);
      });
      break;

    case 'status':
      console.log(JSON.stringify(bot.getStatus(), null, 2));
      break;

    default:
      console.log('Usage: ts-node src/bot/index.ts [start|status]');
      console.log('');
      console.log('Commands:');
      console.log('  start   - Start the JIT bot (simulation-only in PR1)');
      console.log('  status  - Show bot status');
      console.log('');
      console.log('Environment:');
      console.log('  NODE_ENV=development - Run in simulation mode (default)');
      console.log('  SIMULATION_MODE=true - Force simulation mode (default for PR1)');
      console.log('');
      console.log('PR1 Features:');
      console.log('  - Typed configuration with validation');
      console.log('  - Live pool state fetching');
      console.log('  - Accurate LP math with tick utilities');
      console.log('  - Two-tier simulator (fastSim + forkSim)');
      console.log('  - Gas estimation with price capping');
      console.log('  - Price oracle with Chainlink integration');
      console.log('  - Structured logging with trace IDs');
      console.log('  - Prometheus metrics on port ' + config.prometheusPort);
      console.log('  - Live execution DISABLED for safety');
      process.exit(1);
  }
}