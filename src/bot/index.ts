import { ethers } from 'ethers';
import { MempoolWatcher, PendingSwap } from '../watcher/mempoolWatcher';
import { Simulator, JitParameters } from '../watcher/simulator';
import { BundleBuilder } from '../bundler/bundleBuilder';
import { Executor } from '../executor/executor';
import { Metrics, SwapOpportunity } from '../metrics/metrics';
import config from '../../config.json';
import * as dotenv from 'dotenv';

dotenv.config();

export class JitBot {
  private provider: ethers.providers.JsonRpcProvider;
  private mempoolWatcher: MempoolWatcher;
  private simulator: Simulator;
  private bundleBuilder: BundleBuilder;
  private executor: Executor;
  private metrics: Metrics;
  private isRunning: boolean = false;
  private contractAddress: string;

  constructor() {
    // Initialize provider
    const rpcUrl = process.env.ETHEREUM_RPC_URL || config.rpc.ethereum;
    this.provider = new ethers.providers.JsonRpcProvider(rpcUrl.replace('wss://', 'https://'));
    
    // Initialize components
    this.mempoolWatcher = new MempoolWatcher(config.rpc.ethereum);
    this.simulator = new Simulator(rpcUrl.replace('wss://', 'https://'));
    
    if (!process.env.PRIVATE_KEY) {
      throw new Error('PRIVATE_KEY environment variable is required');
    }
    
    this.bundleBuilder = new BundleBuilder(process.env.PRIVATE_KEY, this.provider);
    this.executor = new Executor(this.provider);
    this.metrics = new Metrics(parseInt(process.env.METRICS_PORT || '3001'));
    
    // Set contract address (would be deployed)
    this.contractAddress = process.env.JIT_CONTRACT_ADDRESS || '0x0000000000000000000000000000000000000000';
    
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Handle detected swaps
    this.mempoolWatcher.on('swapDetected', async (swap: PendingSwap) => {
      await this.handleSwapDetected(swap);
    });

    // Handle process termination
    process.on('SIGINT', () => {
      console.log('🛑 Received SIGINT, shutting down gracefully...');
      this.stop();
    });

    process.on('SIGTERM', () => {
      console.log('🛑 Received SIGTERM, shutting down gracefully...');
      this.stop();
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error: Error) => {
      console.error('❌ Uncaught exception:', error);
      this.metrics.recordExecutionError(error.message);
    });

    process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
      console.error('❌ Unhandled rejection at:', promise, 'reason:', reason);
      this.metrics.recordExecutionError(`Unhandled rejection: ${String(reason)}`);
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️ Bot is already running');
      return;
    }

    console.log('🚀 Starting JIT Bot...');
    console.log(`📊 Metrics server will be available at http://localhost:${process.env.METRICS_PORT || '3001'}`);

    try {
      // Start metrics server
      this.metrics.start();

      // Validate configuration
      await this.validateConfiguration();

      // Start mempool watcher
      await this.mempoolWatcher.start();

      this.isRunning = true;
      console.log('✅ JIT Bot started successfully');
      console.log('🔍 Monitoring mempool for opportunities...');

      // Keep the process alive
      this.keepAlive();

    } catch (error: any) {
      console.error('❌ Failed to start JIT Bot:', error);
      this.metrics.recordExecutionError(error.message);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('🛑 Stopping JIT Bot...');

    try {
      // Stop components
      await this.mempoolWatcher.stop();
      this.metrics.stop();

      this.isRunning = false;
      console.log('✅ JIT Bot stopped successfully');
      process.exit(0);

    } catch (error) {
      console.error('❌ Error stopping JIT Bot:', error);
      process.exit(1);
    }
  }

  private async validateConfiguration(): Promise<void> {
    console.log('🔍 Validating configuration...');

    // Check RPC connection
    try {
      const blockNumber = await this.provider.getBlockNumber();
      console.log(`✅ Connected to Ethereum (block ${blockNumber})`);
    } catch (error: any) {
      throw new Error(`Failed to connect to RPC: ${error.message}`);
    }

    // Check contract address
    if (this.contractAddress === '0x0000000000000000000000000000000000000000') {
      console.log('⚠️ Warning: JIT contract address not set, using placeholder');
    }

    // Validate wallet
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, this.provider);
    const balance = await wallet.getBalance();
    console.log(`💰 Wallet balance: ${ethers.utils.formatEther(balance)} ETH`);

    if (balance.lt(ethers.utils.parseEther('0.1'))) {
      console.log('⚠️ Warning: Low wallet balance (< 0.1 ETH)');
    }

    console.log('✅ Configuration validated');
  }

  private async handleSwapDetected(swap: PendingSwap): Promise<void> {
    console.log(`🎯 Processing swap opportunity: ${swap.hash}`);

    const opportunity: SwapOpportunity = {
      timestamp: Date.now(),
      hash: swap.hash,
      pool: swap.pool,
      amountIn: swap.amountIn,
      estimatedProfit: '0',
      executed: false,
      profitable: false
    };

    this.metrics.recordSwapDetected(opportunity);

    try {
      // Step 1: Calculate optimal JIT parameters
      const jitParams = await this.calculateJitParameters(swap);

      // Step 2: Simulate the JIT execution
      const simulationResult = await this.simulator.simulateJitBundle(swap, jitParams);

      opportunity.estimatedProfit = simulationResult.estimatedProfit.toString();
      opportunity.profitable = simulationResult.profitable;

      if (!simulationResult.profitable) {
        console.log(`❌ Simulation shows unprofitable: ${simulationResult.reason}`);
        this.metrics.recordSimulationFailure(simulationResult.reason || 'Unprofitable');
        return;
      }

      console.log(`✅ Simulation successful, estimated profit: ${ethers.utils.formatEther(simulationResult.estimatedProfit)} ETH`);

      // Step 3: Build Flashbots bundle
      const bundle = await this.bundleBuilder.buildJitBundle(swap, jitParams, this.contractAddress);

      if (!this.bundleBuilder.validateBundle(bundle)) {
        console.log('❌ Bundle validation failed');
        this.metrics.recordBundleRejection('Bundle validation failed');
        return;
      }

      this.metrics.recordBundleSubmitted(JSON.stringify(bundle));

      // Step 4: Execute the bundle
      const executionResult = await this.executor.executeBundle(bundle);

      opportunity.executed = executionResult.success;

      if (executionResult.success) {
        console.log(`🎉 Bundle executed successfully!`);
        this.metrics.recordBundleIncluded(
          executionResult.bundleHash || '',
          executionResult.profit || ethers.BigNumber.from(0),
          executionResult.gasUsed || ethers.BigNumber.from(0)
        );
      } else {
        console.log(`❌ Bundle execution failed: ${executionResult.error}`);
        this.metrics.recordExecutionError(executionResult.error || 'Unknown error');
      }

    } catch (error: any) {
      console.error(`❌ Error processing swap ${swap.hash}:`, error);
      this.metrics.recordExecutionError(error.message);
      opportunity.reason = error.message;
    }
  }

  private async calculateJitParameters(swap: PendingSwap): Promise<JitParameters> {
    // Find the target pool configuration
    const poolConfig = config.targets.find(target => target.address === swap.pool);
    
    if (!poolConfig) {
      throw new Error(`Pool configuration not found for ${swap.pool}`);
    }

    // Calculate optimal tick range
    const currentPrice = ethers.BigNumber.from('1000000000000000000'); // 1 ETH = 1 token (simplified)
    const targetPrice = currentPrice; // Use current price as target
    const tickSpacing = 60; // Standard for 0.3% pools

    const tickRange = this.simulator.calculateOptimalTickRange(
      currentPrice,
      targetPrice,
      tickSpacing
    );

    // Calculate amounts based on loan size
    const totalLoanAmount = ethers.utils.parseEther(config.maxLoanSize.toString());
    const amount0 = swap.tokenIn.toLowerCase() === poolConfig.token0.toLowerCase() ? 
      totalLoanAmount.div(2) : ethers.BigNumber.from(0);
    const amount1 = swap.tokenIn.toLowerCase() === poolConfig.token1.toLowerCase() ? 
      totalLoanAmount.div(2) : ethers.BigNumber.from(0);

    return {
      pool: swap.pool,
      token0: poolConfig.token0,
      token1: poolConfig.token1,
      fee: poolConfig.fee,
      tickLower: tickRange.tickLower,
      tickUpper: tickRange.tickUpper,
      amount0: amount0.toString(),
      amount1: amount1.toString(),
      deadline: Math.floor(Date.now() / 1000) + 300 // 5 minutes
    };
  }

  private keepAlive(): void {
    // Log status every 60 seconds
    setInterval(() => {
      if (this.isRunning) {
        const metrics = this.metrics.getMetrics();
        console.log(`📊 Status: ${metrics.totalSwapsDetected} swaps detected, ${metrics.totalBundlesIncluded} successful executions`);
      }
    }, 60000);
  }

  // Public method to get bot status
  getStatus(): any {
    return {
      isRunning: this.isRunning,
      contractAddress: this.contractAddress,
      metrics: this.metrics.getMetrics(),
      config: {
        minProfitThreshold: config.minProfitThreshold,
        maxLoanSize: config.maxLoanSize,
        tickRangeWidth: config.tickRangeWidth,
        targets: config.targets.length
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
        console.error('Failed to start bot:', error);
        process.exit(1);
      });
      break;

    case 'status':
      console.log(JSON.stringify(bot.getStatus(), null, 2));
      break;

    default:
      console.log('Usage: node dist/bot/index.js [start|status]');
      console.log('');
      console.log('Commands:');
      console.log('  start   - Start the JIT bot');
      console.log('  status  - Show bot status');
      process.exit(1);
  }
}