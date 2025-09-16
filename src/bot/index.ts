import { ethers } from 'ethers';
import { getConfig, getHttpProvider, getWsProvider, getWallet } from '../config';
import { initializeLogger, getLogger, createCandidateLogger, logJitOpportunity, logStartupConfiguration, logShutdown, flushLogs } from '../logging/logger';
import { initializeMetrics } from '../metrics/prom';
import { getMultiplePoolStates, getCurrentPrice } from '../pool/stateFetcher';
import { fastSimulate, quickProfitabilityCheck } from '../simulator/fastSim';
import { runPreflightSimulation } from '../simulator/forkSim';
import { getGasPriceGwei, checkGasPrice } from '../util/gasEstimator';
import { getFlashbotsManager } from '../exec/flashbots';
import { getFlashloanOrchestrator } from '../exec/flashloan';
import { MempoolWatcher, PendingSwapDetected } from '../watcher/mempoolWatcher';

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
  private flashbotsManager: any;
  private flashloanOrchestrator: any;
  private mempoolWatcher: MempoolWatcher;
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
    
    // Initialize MempoolWatcher - always on for real-time monitoring
    this.mempoolWatcher = new MempoolWatcher(
      this.config,
      this.wsProvider,
      this.httpProvider,
      this.metrics
    );
    
    // Initialize Flashbots and Flashloan components for live execution
    if (!this.config.dryRun) {
      this.flashbotsManager = getFlashbotsManager();
    }
    
    this.flashloanOrchestrator = getFlashloanOrchestrator();
    
    // Initialize pools in metrics
    this.initializePoolMetrics();
    
    this.logger.info({
      msg: 'JIT Bot initialized',
      mode: this.config.dryRun ? 'dry-run' : 'live',
      chain: this.config.chain,
      poolCount: this.config.poolIds.length,
      flashbotsEnabled: !this.config.dryRun,
      mempoolWatcherEnabled: true,
      flashloanPriority: this.config.flashloanPriority,
      minSwapEth: this.config.minSwapEth,
      globalMinProfitUsd: this.config.globalMinProfitUsd
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

      // Start mempool monitoring - always on
      await this.startMempoolMonitoring();

      this.isRunning = true;
      this.logger.info({ 
        msg: 'JIT Bot started successfully',
        mode: this.config.dryRun ? 'DRY-RUN' : 'LIVE'
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
      // Stop mempool watcher
      if (this.mempoolWatcher) {
        await this.mempoolWatcher.stop();
      }
      
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
        
        // Update pool price using Uniswap V3 formula
        const currentPrice = getCurrentPrice(state);
        this.metrics.updatePoolPrice(pool.address, pool.symbol0, pool.symbol1, currentPrice);
        
        this.logger.debug({
          msg: 'Pool metrics updated',
          pool: pool.pool,
          price: currentPrice,
          liquidity: liquidityFloat
        });
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

  private async startMempoolMonitoring(): Promise<void> {
    this.logger.info({ msg: 'Starting real-time mempool monitoring...' });
    
    // Setup mempool watcher event handlers
    this.mempoolWatcher.on('PendingSwapDetected', (swapData: PendingSwapDetected) => {
      this.handleMempoolSwapDetected(swapData).catch(error => {
        this.logger.error({
          err: error,
          candidateId: swapData.candidateId,
          msg: 'Error handling mempool swap detection'
        });
      });
    });

    // Start the mempool watcher
    await this.mempoolWatcher.start();
    
    this.logger.info({ 
      msg: 'Real-time mempool monitoring started',
      targetPools: this.config.poolIds.length,
      minSwapEth: this.config.minSwapEth,
      minSwapUsd: this.config.minSwapUsd
    });
  }

  /**
   * Handle detected swap from mempool
   */
  private async handleMempoolSwapDetected(swapData: PendingSwapDetected): Promise<void> {
    const candidateLogger = createCandidateLogger(swapData.poolAddress, swapData.txHash);
    const traceId = candidateLogger.bindings().traceId;
    
    const opportunity: JitOpportunity = {
      traceId,
      candidateId: swapData.candidateId,
      poolAddress: swapData.poolAddress,
      swapHash: swapData.txHash,
      amountIn: ethers.BigNumber.from(swapData.amountIn),
      tokenIn: swapData.tokenIn,
      tokenOut: swapData.tokenOut,
      estimatedProfitUsd: 0,
      gasPrice: ethers.BigNumber.from('20000000000'), // Default gas price
      stage: 'detected',
      profitable: false,
      reason: 'Mempool swap detected'
    };

    await this.processJitOpportunity(opportunity, candidateLogger);
  }

  /**
   * Process JIT opportunity from mempool detection
   */
  private async processJitOpportunity(opportunity: JitOpportunity, candidateLogger: any): Promise<void> {
    try {
      // Record opportunity detection
      this.metrics.recordOpportunityDetected(opportunity.poolAddress);
      this.opportunities.set(opportunity.candidateId, opportunity);

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
        stage: 'detected'
      });

      // Step 1: Quick profitability check with new config
      const quickCheck = await this.performQuickProfitabilityCheck(opportunity);
      
      if (!quickCheck.profitable) {
        opportunity.stage = 'failed';
        opportunity.reason = quickCheck.reason;
        
        candidateLogger.info({
          msg: 'Quick profitability check failed',
          estimatedProfitUsd: quickCheck.estimatedProfitUsd,
          minThreshold: this.config.globalMinProfitUsd,
          reason: quickCheck.reason
        });

        this.metrics.recordJitFailure(opportunity.poolAddress, 'unprofitable');
        return;
      }

      // Step 2: Check gas price
      const gasCheck = await checkGasPrice();
      if (!gasCheck.acceptable) {
        opportunity.stage = 'failed';
        opportunity.reason = gasCheck.reason || 'Gas price too high';
        
        candidateLogger.warn({
          msg: 'Gas price check failed',
          currentGwei: gasCheck.currentGwei,
          maxGwei: gasCheck.maxGwei
        });

        this.metrics.recordJitFailure(opportunity.poolAddress, 'gas_price');
        return;
      }

      // Update gas price metric
      this.metrics.updateGasPrice(gasCheck.currentGwei);

      // Step 3: Record attempt and perform detailed simulation
      this.metrics.incrementJitAttempt(opportunity.poolAddress);
      
      const fastResult = await fastSimulate({
        poolAddress: opportunity.poolAddress,
        swapAmountIn: opportunity.amountIn,
        swapTokenIn: opportunity.tokenIn,
        swapTokenOut: opportunity.tokenOut
      });

      opportunity.stage = 'simulated';
      opportunity.profitable = fastResult.profitable;
      opportunity.estimatedProfitUsd = fastResult.expectedNetProfitUsd;
      opportunity.reason = fastResult.reason || 'Simulation completed';

      // Update metrics
      this.metrics.updateSimulatedProfit(opportunity.poolAddress, fastResult.expectedNetProfitUsd);
      this.metrics.recordSimulationDuration('fast', opportunity.poolAddress, 0.5); // Mock duration

      if (!fastResult.profitable) {
        candidateLogger.info({
          msg: 'Fast simulation unprofitable',
          estimatedProfitUsd: fastResult.expectedNetProfitUsd,
          gasCostUsd: fastResult.gasCostUsd
        });

        this.metrics.recordJitFailure(opportunity.poolAddress, 'simulation_unprofitable');
        return;
      }

      // Step 4: Fork Simulation (always enabled now)
      candidateLogger.info({ msg: 'Running fork simulation preflight' });
      
      const preflightStartTime = Date.now();
      this.metrics.incrementForkSimAttempt(opportunity.poolAddress);
      
      try {
        const preflightResult = await runPreflightSimulation({
          poolAddress: opportunity.poolAddress,
          swapAmountIn: opportunity.amountIn,
          swapTokenIn: opportunity.tokenIn,
          swapTokenOut: opportunity.tokenOut,
          tickLower: fastResult.optimalPosition.tickLower,
          tickUpper: fastResult.optimalPosition.tickUpper,
          liquidityAmount: fastResult.optimalPosition.liquidity,
          gasPrice: opportunity.gasPrice
        });
        
        const preflightDuration = (Date.now() - preflightStartTime) / 1000;
        this.metrics.recordPreflightDuration(opportunity.poolAddress, preflightDuration);
        
        if (!preflightResult.success) {
          opportunity.stage = 'failed';
          opportunity.reason = `Preflight failed: ${preflightResult.revertReason}`;
          
          candidateLogger.warn({
            msg: 'Fork simulation preflight failed',
            reason: preflightResult.revertReason,
            validations: preflightResult.validations,
            simulationSteps: preflightResult.simulationSteps
          });
          
          this.metrics.incrementForkSimFailure(opportunity.poolAddress, preflightResult.revertReason || 'unknown');
          this.metrics.recordJitFailure(opportunity.poolAddress, 'preflight_failed');
          return;
        }
        
        if (!preflightResult.profitable) {
          opportunity.stage = 'failed';
          opportunity.reason = 'Preflight simulation shows unprofitable';
          
          candidateLogger.info({
            msg: 'Preflight simulation unprofitable',
            expectedNetProfitUSD: preflightResult.expectedNetProfitUSD,
            gasUsed: preflightResult.gasUsed,
            breakdown: {
              flashloanFee: ethers.utils.formatEther(preflightResult.breakdown.flashloanFee),
              feesCollected: ethers.utils.formatEther(preflightResult.breakdown.estimatedFeesCollected),
              gasCost: ethers.utils.formatEther(preflightResult.breakdown.estimatedGasCost)
            }
          });
          
          this.metrics.incrementForkSimFailure(opportunity.poolAddress, 'unprofitable');
          this.metrics.recordJitFailure(opportunity.poolAddress, 'preflight_unprofitable');
          return;
        }
        
        // Successful preflight
        this.metrics.incrementForkSimSuccess(opportunity.poolAddress);
        this.metrics.recordExpectedProfit(opportunity.poolAddress, preflightResult.expectedNetProfitUSD);
        
        candidateLogger.info({
          msg: 'Preflight simulation successful',
          expectedNetProfitUSD: preflightResult.expectedNetProfitUSD,
          gasUsed: preflightResult.gasUsed,
          validations: preflightResult.validations
        });
        
        // Update opportunity with preflight results
        opportunity.estimatedProfitUsd = preflightResult.expectedNetProfitUSD;
        
      } catch (error: any) {
        candidateLogger.error({
          err: error,
          msg: 'Preflight simulation error'
        });
        
        this.metrics.incrementForkSimFailure(opportunity.poolAddress, 'simulation_error');
        this.metrics.recordJitFailure(opportunity.poolAddress, 'preflight_error');
        
        opportunity.stage = 'failed';
        opportunity.reason = `Preflight error: ${error.message}`;
        return;
      }
      
      // Step 5: Live Execution or DRY RUN logging
      if (!this.config.dryRun) {
        candidateLogger.info({ msg: 'Proceeding with live execution' });
        
        try {
          await this.executeLiveJitStrategy(opportunity, fastResult, candidateLogger);
        } catch (error: any) {
          candidateLogger.error({
            err: error,
            msg: 'Live execution failed'
          });
          
          opportunity.stage = 'failed';
          opportunity.reason = `Live execution error: ${error.message}`;
          this.metrics.recordJitFailure(opportunity.poolAddress, 'execution_error');
        }
      } else {
        // DRY RUN mode - log what would have been executed
        opportunity.stage = 'validated';
        opportunity.reason = 'DRY RUN mode - execution blocked for safety';
        
        candidateLogger.info({
          msg: 'DRY RUN: Opportunity validated but execution blocked',
          note: 'Set DRY_RUN=false to enable live execution',
          estimatedProfitUsd: opportunity.estimatedProfitUsd,
          wouldExecute: 'Flashbots bundle submission'
        });
        
        this.metrics.incrementJitCandidatesProfitable(opportunity.poolAddress);
      }

    } catch (error: any) {
      opportunity.stage = 'failed';
      opportunity.reason = `Processing error: ${error.message}`;
      
      candidateLogger.error({
        err: error,
        msg: 'Opportunity processing failed'
      });

      this.metrics.recordJitFailure(opportunity.poolAddress, 'processing_error');
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
      
      this.opportunities.set(opportunity.candidateId, opportunity);
    }
  }

  /**
   * Perform quick profitability check with new config parameters
   */
  private async performQuickProfitabilityCheck(opportunity: JitOpportunity): Promise<{
    profitable: boolean;
    estimatedProfitUsd: number;
    reason: string;
  }> {
    try {
      const quickCheck = await quickProfitabilityCheck({
        poolAddress: opportunity.poolAddress,
        swapAmountIn: opportunity.amountIn,
        swapTokenIn: opportunity.tokenIn,
        swapTokenOut: opportunity.tokenOut
      }, this.config.globalMinProfitUsd);

      // Apply capture ratio and risk buffer from config
      const adjustedProfit = (quickCheck.estimatedProfitUsd * this.config.captureRatio) - this.config.riskBufferUsd;
      
      return {
        profitable: adjustedProfit >= this.config.globalMinProfitUsd,
        estimatedProfitUsd: adjustedProfit,
        reason: adjustedProfit >= this.config.globalMinProfitUsd ? 'Profitable after adjustments' : 
                `Adjusted profit ${adjustedProfit.toFixed(2)} below threshold ${this.config.globalMinProfitUsd}`
      };
    } catch (error: any) {
      return {
        profitable: false,
        estimatedProfitUsd: 0,
        reason: `Quick check error: ${error.message}`
      };
    }
  }

  /**
   * Execute live JIT strategy using Flashbots and flashloans
   */
  private async executeLiveJitStrategy(
    opportunity: JitOpportunity,
    fastResult: any,
    candidateLogger: any
  ): Promise<void> {
    const traceId = opportunity.traceId;
    
    candidateLogger.info({
      msg: 'Starting live JIT strategy execution',
      traceId,
      poolAddress: opportunity.poolAddress
    });

    try {
      // Step 1: Build flashloan transaction
      const flashloanTx = await this.flashloanOrchestrator.buildJitFlashloanTransaction(
        opportunity.tokenIn,
        opportunity.amountIn,
        '0x' + '1'.repeat(40), // Mock JIT executor address
        {
          poolAddress: opportunity.poolAddress,
          amountIn: opportunity.amountIn,
          tokenIn: opportunity.tokenIn,
          tokenOut: opportunity.tokenOut,
          tickLower: fastResult.optimalPosition.tickLower,
          tickUpper: fastResult.optimalPosition.tickUpper,
          liquidity: fastResult.optimalPosition.liquidity
        }
      );

      candidateLogger.info({
        msg: 'Flashloan transaction built',
        gasEstimate: flashloanTx.gasEstimate,
        flashloanFee: ethers.utils.formatEther(flashloanTx.flashloanFee)
      });

      // Step 2: Get current base fee for gas optimization
      const baseFee = await this.flashbotsManager.getCurrentBaseFee();
      const optimizedGas = await this.flashbotsManager.createOptimizedGasFees(baseFee);

      // Step 3: Create Flashbots bundle
      const targetBlock = await this.httpProvider.getBlockNumber() + 1;
      const bundle = await this.flashbotsManager.createBundle([
        {
          to: flashloanTx.to,
          data: flashloanTx.data,
          value: flashloanTx.value,
          gasLimit: flashloanTx.gasEstimate,
          maxFeePerGas: optimizedGas.maxFeePerGas,
          maxPriorityFeePerGas: optimizedGas.maxPriorityFeePerGas
        }
      ], targetBlock, traceId);

      candidateLogger.info({
        msg: 'Flashbots bundle created',
        targetBlock,
        gasSettings: {
          maxFeePerGas: ethers.utils.formatUnits(optimizedGas.maxFeePerGas, 'gwei'),
          maxPriorityFeePerGas: ethers.utils.formatUnits(optimizedGas.maxPriorityFeePerGas, 'gwei')
        }
      });

      // Step 4: Simulate bundle
      const simulationResult = await this.flashbotsManager.simulateBundle(bundle, traceId);
      
      if (!simulationResult.simulation?.success) {
        throw new Error(`Bundle simulation failed: ${simulationResult.simulation?.error}`);
      }

      candidateLogger.info({
        msg: 'Bundle simulation successful',
        gasUsed: simulationResult.simulation.gasUsed,
        effectiveGasPrice: ethers.utils.formatUnits(simulationResult.simulation.effectiveGasPrice, 'gwei')
      });

      // Step 5: Submit bundle to Flashbots
      const submissionResult = await this.flashbotsManager.submitBundle(bundle, traceId);
      
      if (submissionResult.submission?.success) {
        opportunity.stage = 'validated';
        opportunity.profitable = true;
        opportunity.reason = 'Live execution submitted successfully';
        
        candidateLogger.info({
          msg: 'Bundle submitted to Flashbots successfully',
          bundleHash: submissionResult.bundleHash,
          targetBlock: submissionResult.submission.targetBlock
        });
        
        this.metrics.recordJitSuccess(opportunity.poolAddress);
      } else {
        throw new Error(`Bundle submission failed: ${submissionResult.submission?.error}`);
      }

    } catch (error: any) {
      candidateLogger.error({
        err: error,
        msg: 'Live JIT strategy execution failed'
      });
      
      opportunity.stage = 'failed';
      opportunity.reason = `Live execution failed: ${error.message}`;
      
      throw error;
    }
  }

  private keepAlive(): void {
    // Status logging every 60 seconds
    setInterval(() => {
      if (this.isRunning) {
        this.logger.info({
          msg: 'JIT Bot status',
          mode: this.config.dryRun ? 'DRY-RUN' : 'LIVE',
          opportunities: this.opportunities.size,
          activelyMonitoring: this.config.poolIds.length,
          mempoolWatcherActive: true,
          minSwapEth: this.config.minSwapEth,
          globalMinProfitUsd: this.config.globalMinProfitUsd
        });
      }
    }, 60000);

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
      mode: this.config.dryRun ? 'dry-run' : 'live',
      chain: this.config.chain,
      walletAddress: this.wallet.address,
      opportunities: Array.from(this.opportunities.values()),
      config: {
        poolIds: this.config.poolIds,
        globalMinProfitUsd: this.config.globalMinProfitUsd,
        maxGasGwei: this.config.maxGasGwei,
        prometheusPort: this.config.prometheusPort,
        dryRun: this.config.dryRun,
        liveRiskAcknowledged: this.config.liveRiskAcknowledged,
        mempoolWatcherEnabled: true,
        minSwapEth: this.config.minSwapEth,
        flashloanPriority: this.config.flashloanPriority
      },
      metricsUrl: this.metrics.getMetricsUrl()
    };
  }
}

// CLI interface
if (require.main === module) {
  // Handle command line arguments first, before instantiating the bot
  let command = process.argv[2];
  
  // Default to 'start' if no command provided and log a warning
  if (!command) {
    console.warn('No command specified, defaulting to "start". Use "start" or "status" explicitly.');
    command = 'start';
  }

  switch (command) {
    case 'start': {
      // Braces required to satisfy ESLint no-case-declarations rule
      const botStart = new JitBot();
      botStart.start().catch(error => {
        console.error('Failed to start bot:', error);
        process.exit(1);
      });
      break;
    }

    case 'status': {
      // Braces required to satisfy ESLint no-case-declarations rule
      const botStatus = new JitBot();
      console.log(JSON.stringify(botStatus.getStatus(), null, 2));
      break;
    }

    default: {
      // Braces added for consistency, though not required for this case
      console.log('Usage: ts-node src/bot/index.ts [start|status]');
      console.log('');
      console.log('Commands:');
      console.log('  start   - Start the JIT bot');
      console.log('  status  - Show bot status');
      console.log('');
      console.log('Environment:');
      console.log('  DRY_RUN=true - Safe mode with no live execution (default)');
      console.log('  DRY_RUN=false - Enable live transaction execution (requires I_UNDERSTAND_LIVE_RISK=true)');
      console.log('  I_UNDERSTAND_LIVE_RISK=true - Required for live execution mode');
      console.log('  NODE_ENV=development - Development mode (default)');
      console.log('  NODE_ENV=production - Production mode (requires extra safety acknowledgment)');
      console.log('');
      console.log('Safety: DRY_RUN=true by default. Real mempool monitoring active but no live execution.');
      process.exit(1);
    }
  }
}