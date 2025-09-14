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
    
    // Initialize PR2 components
    if (this.config.enableFlashbots) {
      this.flashbotsManager = getFlashbotsManager();
    }
    
    this.flashloanOrchestrator = getFlashloanOrchestrator();
    
    // Initialize pools in metrics
    this.initializePoolMetrics();
    
    this.logger.info({
      msg: 'JIT Bot initialized',
      mode: this.config.enableLiveExecution ? 'live' : 'simulation',
      chain: this.config.chain,
      poolCount: this.config.poolIds.length,
      flashbotsEnabled: this.config.enableFlashbots,
      preflightEnabled: this.config.enableForkSimPreflight,
      flashloanProvider: this.config.flashloanProvider
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

      // Step 3: Record attempt and perform detailed simulation
      // Increment jit_attempt_total when candidate is queued for fastSim
      this.metrics.incrementJitAttempt(swap.pool);
      
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

      // Step 4: Fork Simulation Preflight (PR2)
      if (this.config.enableForkSimPreflight) {
        candidateLogger.info({ msg: 'Running fork simulation preflight' });
        
        const preflightStartTime = Date.now();
        this.metrics.incrementForkSimAttempt(swap.pool);
        
        try {
          const preflightResult = await runPreflightSimulation({
            poolAddress: swap.pool,
            swapAmountIn: ethers.BigNumber.from(swap.amountIn),
            swapTokenIn: swap.tokenIn,
            swapTokenOut: swap.tokenOut,
            tickLower: fastResult.optimalPosition.tickLower,
            tickUpper: fastResult.optimalPosition.tickUpper,
            liquidityAmount: fastResult.optimalPosition.liquidity,
            gasPrice: ethers.BigNumber.from(swap.gasPrice || '20000000000')
          });
          
          const preflightDuration = (Date.now() - preflightStartTime) / 1000;
          this.metrics.recordPreflightDuration(swap.pool, preflightDuration);
          
          if (!preflightResult.success) {
            opportunity.stage = 'failed';
            opportunity.reason = `Preflight failed: ${preflightResult.revertReason}`;
            
            candidateLogger.warn({
              msg: 'Fork simulation preflight failed',
              reason: preflightResult.revertReason,
              validations: preflightResult.validations,
              simulationSteps: preflightResult.simulationSteps
            });
            
            this.metrics.incrementForkSimFailure(swap.pool, preflightResult.revertReason || 'unknown');
            this.metrics.recordJitFailure(swap.pool, 'preflight_failed');
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
            
            this.metrics.incrementForkSimFailure(swap.pool, 'unprofitable');
            this.metrics.recordJitFailure(swap.pool, 'preflight_unprofitable');
            return;
          }
          
          // Successful preflight
          this.metrics.incrementForkSimSuccess(swap.pool);
          this.metrics.recordExpectedProfit(swap.pool, preflightResult.expectedNetProfitUSD);
          
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
          
          this.metrics.incrementForkSimFailure(swap.pool, 'simulation_error');
          this.metrics.recordJitFailure(swap.pool, 'preflight_error');
          
          opportunity.stage = 'failed';
          opportunity.reason = `Preflight error: ${error.message}`;
          return;
        }
      }
      
      // Step 5: Live Execution (PR2)
      if (this.config.enableLiveExecution && this.config.enableFlashbots) {
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
          this.metrics.recordJitFailure(swap.pool, 'execution_error');
        }
      } else {
        // Simulation mode - log what would have been executed
        opportunity.stage = 'failed';
        opportunity.reason = this.config.enableLiveExecution ? 
          'Live execution disabled (ENABLE_FLASHBOTS=false)' :
          'Live execution disabled (ENABLE_LIVE_EXECUTION=false)';
        
        candidateLogger.info({
          msg: 'Opportunity validated but execution blocked',
          note: 'Live execution is disabled',
          enableLiveExecution: this.config.enableLiveExecution,
          enableFlashbots: this.config.enableFlashbots,
          estimatedProfitUsd: opportunity.estimatedProfitUsd
        });
        
        this.metrics.recordJitFailure(swap.pool, 'live_execution_disabled');
      }

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

  /**
   * Execute live JIT strategy using Flashbots and flashloans (PR2)
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
          mode: this.config.enableLiveExecution ? 'LIVE' : 'SIMULATION',
          opportunities: this.opportunities.size,
          activelyMonitoring: this.config.poolIds.length,
          flashbotsEnabled: this.config.enableFlashbots,
          preflightEnabled: this.config.enableForkSimPreflight
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
      mode: this.config.enableLiveExecution ? 'live' : 'simulation',
      chain: this.config.chain,
      walletAddress: this.wallet.address,
      opportunities: Array.from(this.opportunities.values()),
      config: {
        poolIds: this.config.poolIds,
        globalMinProfitUsd: this.config.globalMinProfitUsd,
        maxGasGwei: this.config.maxGasGwei,
        prometheusPort: this.config.prometheusPort,
        enableLiveExecution: this.config.enableLiveExecution,
        enableFlashbots: this.config.enableFlashbots,
        enableForkSimPreflight: this.config.enableForkSimPreflight,
        flashloanProvider: this.config.flashloanProvider
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
      console.log('  start   - Start the JIT bot');
      console.log('  status  - Show bot status');
      console.log('');
      console.log('Environment:');
      console.log('  ENABLE_LIVE_EXECUTION=false - Enable live transaction execution (default: false)');
      console.log('  ENABLE_FLASHBOTS=false - Enable Flashbots integration (default: false)');
      console.log('  ENABLE_FORK_SIM_PREFLIGHT=true - Enable fork simulation preflight (default: true)');
      console.log('  NODE_ENV=development - Development mode (default)');
      console.log('  NODE_ENV=production - Production mode (requires I_UNDERSTAND_LIVE_RISK=true for live execution)');
      console.log('');
      console.log('Safety: Live execution is disabled by default. Set appropriate flags to enable.');
      process.exit(1);
  }
}