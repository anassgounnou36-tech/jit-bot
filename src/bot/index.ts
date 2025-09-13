import { ethers } from 'ethers';
import { getConfig, getHttpProvider, getWsProvider, getWallet, validateNoLiveExecution } from '../config';
import { initializeLogger, getLogger, createCandidateLogger, logJitOpportunity, logStartupConfiguration, logShutdown, flushLogs } from '../logging/logger';
import { initializeMetrics } from '../metrics/prom';
import { getMultiplePoolStates } from '../pool/stateFetcher';
import { fastSimulate, quickProfitabilityCheck } from '../simulator/fastSim';
import { validateJitStrategy } from '../simulator/forkSim';
import { getGasPriceGwei, checkGasPrice } from '../util/gasEstimator';

export interface PendingSwap {
  hash: string;
  pool: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  gasPrice?: string;
  blockNumber?: number;
}

export interface JitOpportunity {
  traceId: string;
  candidateId: string;
  poolAddress: string;
  swapHash: string;
  amountIn: ethers.BigNumber;
  tokenIn: string;
  tokenOut: string;
  estimatedProfitUsd: number;
  gasPrice: ethers.BigNumber;
  stage: 'detected' | 'simulated' | 'validated' | 'failed';
  profitable: boolean;
  reason: string;
}

export class JitBot {
  private httpProvider: ethers.providers.JsonRpcProvider;
  private wsProvider: ethers.providers.WebSocketProvider;
  private wallet: ethers.Wallet;
  private config: any;
  private logger: any;
  private metrics: any;
  private isRunning: boolean = false;
  private opportunities: Map<string, JitOpportunity> = new Map();

  constructor() {
    // Initialize configuration and logging first
    this.config = getConfig();
    initializeLogger();
    this.logger = getLogger().child({ component: 'jit-bot' });
    
    // Log startup configuration
    logStartupConfiguration();
    
    // Initialize providers
    this.httpProvider = getHttpProvider(this.config);
    this.wsProvider = getWsProvider(this.config);
    this.wallet = getWallet(this.config, this.httpProvider);
    
    // Initialize metrics
    this.metrics = initializeMetrics({
      port: this.config.prometheusPort
    });
    
    // Initialize pools in metrics
    this.initializePoolMetrics();
    
    this.logger.info({
      msg: 'JIT Bot initialized',
      mode: this.config.simulationMode ? 'simulation' : 'live',
      chain: this.config.chain,
      poolCount: this.config.poolIds.length
    });

    this.setupEventHandlers();
  }

  private initializePoolMetrics(): void {
    for (const pool of this.config.pools) {
      this.metrics.initializePool(pool.address, pool.symbol0, pool.symbol1);
    }
  }

  private setupEventHandlers(): void {
    // Handle process termination
    process.on('SIGINT', () => {
      this.logger.info({ msg: 'Received SIGINT, shutting down gracefully...' });
      this.stop();
    });

    process.on('SIGTERM', () => {
      this.logger.info({ msg: 'Received SIGTERM, shutting down gracefully...' });
      this.stop();
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error: Error) => {
      this.logger.error({ err: error, msg: 'Uncaught exception' });
      this.metrics.recordSimulationError('uncaught_exception', 'global');
      
      this.logger.error({ msg: 'Critical error, shutting down for safety' });
      this.stop();
    });

    process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
      this.logger.error({ 
        err: reason,
        promise: promise.toString(),
        msg: 'Unhandled rejection'
      });
      this.metrics.recordSimulationError('unhandled_rejection', 'global');
      
      this.logger.error({ msg: 'Critical error, shutting down for safety' });
      this.stop();
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn({ msg: 'Bot is already running' });
      return;
    }

    this.logger.info({ msg: 'Starting JIT Bot...' });

    try {
      // Start metrics server
      await this.metrics.start();
      this.logger.info({ 
        msg: 'Metrics server started',
        url: this.metrics.getMetricsUrl()
      });

      // Validate configuration
      await this.validateConfiguration();

      // Start monitoring (simulation only in PR1)
      await this.startMonitoring();

      this.isRunning = true;
      this.logger.info({ 
        msg: 'JIT Bot started successfully',
        mode: this.config.simulationMode ? 'SIMULATION' : 'LIVE'
      });

      // Keep the process alive and run periodic tasks
      this.keepAlive();

    } catch (error: any) {
      this.logger.error({ err: error, msg: 'Failed to start JIT Bot' });
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logShutdown('Manual shutdown');

    try {
      // Stop WebSocket provider
      if (this.wsProvider) {
        this.wsProvider.removeAllListeners();
      }
      
      // Stop metrics server
      await this.metrics.stop();

      // Flush logs
      await flushLogs();

      this.isRunning = false;
      this.logger.info({ msg: 'JIT Bot stopped successfully' });
      process.exit(0);

    } catch (error) {
      this.logger.error({ err: error, msg: 'Error stopping JIT Bot' });
      process.exit(1);
    }
  }

  private async validateConfiguration(): Promise<void> {
    this.logger.info({ msg: 'Validating configuration...' });

    // Check RPC connection
    try {
      const blockNumber = await this.httpProvider.getBlockNumber();
      this.logger.info({ 
        msg: 'Connected to blockchain',
        chain: this.config.chain,
        blockNumber
      });
    } catch (error: any) {
      throw new Error(`Failed to connect to RPC: ${error.message}`);
    }

    // Validate wallet
    const balance = await this.wallet.getBalance();
    this.logger.info({ 
      msg: 'Wallet validated',
      address: this.wallet.address,
      balanceEth: ethers.utils.formatEther(balance)
    });

    // Update wallet balance metric
    const balanceFloat = parseFloat(ethers.utils.formatEther(balance));
    this.metrics.updateWalletBalance(balanceFloat);

    // Check if we have minimum balance
    const minBalance = ethers.utils.parseEther('0.01');
    if (balance.lt(minBalance)) {
      this.logger.warn({ 
        msg: 'Low wallet balance',
        balance: ethers.utils.formatEther(balance),
        minimum: ethers.utils.formatEther(minBalance)
      });
    }

    // Validate pools
    this.logger.info({ msg: 'Validating pool configurations...' });
    const poolAddresses = this.config.pools.map((p: any) => p.address);
    const poolStates = await getMultiplePoolStates(poolAddresses);
    
    for (const pool of this.config.pools) {
      const state = poolStates.get(pool.address);
      if (state) {
        this.logger.info({
          msg: 'Pool validated',
          pool: pool.pool,
          address: pool.address,
          tick: state.tick,
          liquidity: ethers.utils.formatEther(state.liquidity)
        });
        
        // Update pool metrics
        const liquidityFloat = parseFloat(ethers.utils.formatEther(state.liquidity));
        this.metrics.updatePoolLiquidity(pool.address, pool.symbol0, pool.symbol1, liquidityFloat);
      } else {
        this.logger.warn({
          msg: 'Pool validation failed',
          pool: pool.pool,
          address: pool.address
        });
        this.metrics.setPoolDisabled(pool.address, true);
      }
    }

    this.logger.info({ msg: 'Configuration validated successfully' });
  }

  private async startMonitoring(): Promise<void> {
    this.logger.info({ msg: 'Starting pool monitoring (simulation mode)...' });
    
    // In PR1, we only simulate monitoring - no real mempool watching
    // This demonstrates the monitoring loop without actual swap detection
    
    this.logger.info({ 
      msg: 'Monitoring started in simulation mode',
      note: 'Real mempool monitoring will be added in PR2'
    });
  }

  // Simulate processing a swap opportunity (for demonstration)
  private async simulateOpportunityProcessing(): Promise<void> {
    // This demonstrates how opportunities would be processed
    const pools = this.config.pools;
    if (pools.length === 0) return;
    
    const randomPool = pools[Math.floor(Math.random() * pools.length)];
    const mockSwap: PendingSwap = {
      hash: `0x${Math.random().toString(16).slice(2, 66)}`,
      pool: randomPool.address,
      tokenIn: randomPool.token0,
      tokenOut: randomPool.token1,
      amountIn: ethers.utils.parseEther('10').toString(), // 10 ETH swap
      gasPrice: ethers.utils.parseUnits('20', 'gwei').toString()
    };

    await this.handleOpportunity(mockSwap);
  }

  private async handleOpportunity(swap: PendingSwap): Promise<void> {
    const candidateLogger = createCandidateLogger(swap.pool, swap.hash);
    const traceId = candidateLogger.bindings().traceId;
    
    const opportunity: JitOpportunity = {
      traceId,
      candidateId: swap.hash,
      poolAddress: swap.pool,
      swapHash: swap.hash,
      amountIn: ethers.BigNumber.from(swap.amountIn),
      tokenIn: swap.tokenIn,
      tokenOut: swap.tokenOut,
      estimatedProfitUsd: 0,
      gasPrice: ethers.BigNumber.from(swap.gasPrice || '20000000000'),
      stage: 'detected',
      profitable: false,
      reason: 'Opportunity detected'
    };

    try {
      // Record opportunity detection
      this.metrics.recordOpportunityDetected(swap.pool);
      this.opportunities.set(swap.hash, opportunity);

      logJitOpportunity(candidateLogger, {
        traceId,
        candidateId: swap.hash,
        poolAddress: swap.pool,
        swapHash: swap.hash,
        amountIn: swap.amountIn,
        tokenIn: swap.tokenIn,
        tokenOut: swap.tokenOut,
        estimatedProfitUsd: 0,
        gasPrice: swap.gasPrice || '20000000000',
        timestamp: Date.now(),
        stage: 'detected'
      });

      // Step 1: Quick profitability check
      const quickCheck = await quickProfitabilityCheck({
        poolAddress: swap.pool,
        swapAmountIn: ethers.BigNumber.from(swap.amountIn),
        swapTokenIn: swap.tokenIn,
        swapTokenOut: swap.tokenOut
      }, this.config.globalMinProfitUsd);

      if (!quickCheck.profitable) {
        opportunity.stage = 'failed';
        opportunity.reason = quickCheck.reason;
        
        candidateLogger.info({
          msg: 'Quick profitability check failed',
          estimatedProfitUsd: quickCheck.estimatedProfitUsd,
          minThreshold: this.config.globalMinProfitUsd
        });

        this.metrics.recordJitFailure(swap.pool, 'unprofitable');
        return;
      }

      // Check gas price check
      const gasCheck = await checkGasPrice();
      if (!gasCheck.acceptable) {
        opportunity.stage = 'failed';
        opportunity.reason = gasCheck.reason || 'Gas price too high';
        
        candidateLogger.warn({
          msg: 'Gas price check failed',
          currentGwei: gasCheck.currentGwei,
          maxGwei: gasCheck.maxGwei
        });

        this.metrics.recordJitFailure(swap.pool, 'gas_price');
        return;
      }

      // Update gas price metric
      this.metrics.updateGasPrice(gasCheck.currentGwei);

      // Step 3: Detailed simulation
      const fastResult = await fastSimulate({
        poolAddress: swap.pool,
        swapAmountIn: ethers.BigNumber.from(swap.amountIn),
        swapTokenIn: swap.tokenIn,
        swapTokenOut: swap.tokenOut
      });

      opportunity.stage = 'simulated';
      opportunity.profitable = fastResult.profitable;
      opportunity.estimatedProfitUsd = fastResult.expectedNetProfitUsd;
      opportunity.reason = fastResult.reason || 'Simulation completed';

      // Update metrics
      this.metrics.updateSimulatedProfit(swap.pool, fastResult.expectedNetProfitUsd);
      this.metrics.recordSimulationDuration('fast', swap.pool, 0.5); // Mock duration

      if (!fastResult.profitable) {
        candidateLogger.info({
          msg: 'Fast simulation unprofitable',
          estimatedProfitUsd: fastResult.expectedNetProfitUsd,
          gasCostUsd: fastResult.gasCostUsd
        });

        this.metrics.recordJitFailure(swap.pool, 'simulation_unprofitable');
        return;
      }

      // Step 4: Validation simulation
      const validationResult = await validateJitStrategy({
        poolAddress: swap.pool,
        swapAmountIn: ethers.BigNumber.from(swap.amountIn),
        swapTokenIn: swap.tokenIn,
        swapTokenOut: swap.tokenOut,
        tickLower: fastResult.optimalPosition.tickLower,
        tickUpper: fastResult.optimalPosition.tickUpper,
        liquidityAmount: fastResult.optimalPosition.liquidity,
        gasPrice: ethers.BigNumber.from(swap.gasPrice || '20000000000')
      });

      if (!validationResult.valid) {
        opportunity.stage = 'failed';
        opportunity.reason = `Validation failed: ${validationResult.issues.join(', ')}`;
        
        candidateLogger.warn({
          msg: 'Strategy validation failed',
          issues: validationResult.issues,
          warnings: validationResult.warnings
        });

        this.metrics.recordJitFailure(swap.pool, 'validation_failed');
        return;
      }

      // Step 5: EXECUTION BLOCKED IN PR1
      opportunity.stage = 'failed';
      opportunity.reason = 'Live execution blocked in PR1 (simulation-only mode)';
      
      candidateLogger.info({
        msg: 'Opportunity validated but execution blocked',
        note: 'PR1 is simulation-only - no live transactions',
        estimatedProfitUsd: fastResult.expectedNetProfitUsd
      });

      // This is where execution would happen in PR2
      validateNoLiveExecution('JIT bundle execution');

      this.metrics.recordJitAttempt(swap.pool, 'blocked_pr1');

    } catch (error: any) {
      opportunity.stage = 'failed';
      opportunity.reason = `Processing error: ${error.message}`;
      
      candidateLogger.error({
        err: error,
        msg: 'Opportunity processing failed'
      });

      this.metrics.recordJitFailure(swap.pool, 'processing_error');
    } finally {
      // Log final opportunity state
      logJitOpportunity(candidateLogger, {
        traceId: opportunity.traceId,
        candidateId: opportunity.candidateId,
        poolAddress: opportunity.poolAddress,
        swapHash: opportunity.swapHash,
        amountIn: opportunity.amountIn.toString(),
        tokenIn: opportunity.tokenIn,
        tokenOut: opportunity.tokenOut,
        estimatedProfitUsd: opportunity.estimatedProfitUsd,
        gasPrice: opportunity.gasPrice.toString(),
        timestamp: Date.now(),
        stage: opportunity.stage,
        result: opportunity.profitable ? 'profitable' : 'unprofitable',
        reason: opportunity.reason
      });
      
      this.opportunities.set(swap.hash, opportunity);
    }
  }

  private keepAlive(): void {
    // Status logging every 60 seconds
    setInterval(() => {
      if (this.isRunning) {
        this.logger.info({
          msg: 'JIT Bot status',
          mode: 'SIMULATION',
          opportunities: this.opportunities.size,
          activelyMonitoring: this.config.poolIds.length
        });
      }
    }, 60000);

    // Simulate opportunity detection every 30 seconds (for demo)
    setInterval(() => {
      if (this.isRunning) {
        this.simulateOpportunityProcessing().catch(error => {
          this.logger.error({
            err: error,
            msg: 'Error in simulated opportunity processing'
          });
        });
      }
    }, 30000);

    // Update system metrics every 10 seconds
    setInterval(async () => {
      if (this.isRunning) {
        try {
          // Update wallet balance
          const balance = await this.wallet.getBalance();
          const balanceFloat = parseFloat(ethers.utils.formatEther(balance));
          this.metrics.updateWalletBalance(balanceFloat);

          // Update gas price
          const gasPrice = await getGasPriceGwei();
          this.metrics.updateGasPrice(gasPrice.gasPriceGwei);

        } catch (error: any) {
          this.logger.debug({
            err: error,
            msg: 'Error updating system metrics'
          });
        }
      }
    }, 10000);
  }

  // Public method to get bot status
  getStatus(): any {
    return {
      isRunning: this.isRunning,
      mode: this.config.simulationMode ? 'simulation' : 'live',
      chain: this.config.chain,
      walletAddress: this.wallet.address,
      opportunities: Array.from(this.opportunities.values()),
      config: {
        poolIds: this.config.poolIds,
        globalMinProfitUsd: this.config.globalMinProfitUsd,
        maxGasGwei: this.config.maxGasGwei,
        prometheusPort: this.config.prometheusPort
      },
      metricsUrl: this.metrics.getMetricsUrl()
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
        console.error('Failed to start bot:', error);
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
      console.log('  start   - Start the JIT bot in simulation mode');
      console.log('  status  - Show bot status');
      console.log('');
      console.log('Environment:');
      console.log('  SIMULATION_MODE=true - Run in simulation mode (default, required in PR1)');
      console.log('  NODE_ENV=development - Development mode (default)');
      console.log('  NODE_ENV=production - Production mode (with SIMULATION_MODE=true)');
      console.log('');
      console.log('Note: Live execution is blocked in PR1 for safety.');
      process.exit(1);
  }
}