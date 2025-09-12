import { ethers } from 'ethers';
import { MempoolWatcher, PendingSwap } from '../watcher/mempoolWatcher';
import { Simulator, JitParameters } from '../watcher/simulator';
import { BundleBuilder } from '../bundler/bundleBuilder';
import { Executor } from '../executor/executor';
import { Metrics, SwapOpportunity } from '../metrics/metrics';
import { PoolCoordinator } from '../coordinator/poolCoordinator';
import config from '../../config.json';
import * as dotenv from 'dotenv';

dotenv.config();

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
  private provider: ethers.providers.JsonRpcProvider;
  private mempoolWatcher: MempoolWatcher | null = null; // For single-pool mode
  private poolCoordinator: PoolCoordinator | null = null; // For multi-pool mode
  private simulator: Simulator;
  private bundleBuilder: BundleBuilder;
  private executor: Executor;
  private metrics: Metrics;
  private isRunning: boolean = false;
  private contractAddress: string;
  private config: BotConfig;

  constructor() {
    // Determine execution mode
    const isProduction = process.env.NODE_ENV === 'production';
    const mode = isProduction ? 'live' : 'simulation';
    
    // Initialize configuration
    this.config = {
      mode,
      network: mode === 'live' ? 'mainnet' : 'fork',
      profitThresholdUSD: parseFloat(process.env.PROFIT_THRESHOLD_USD || '10.0'),
      maxGasGwei: parseFloat(process.env.MAX_GAS_GWEI || '100'),
      retryAttempts: 3,
      retryDelayMs: 1000,
      useMultiPool: process.env.ENABLE_MULTI_POOL === 'true' || process.env.POOL_IDS !== undefined
    };

    console.log(`🤖 Starting JIT Bot in ${this.config.mode.toUpperCase()} mode`);
    console.log(`🌐 Target network: ${this.config.network}`);
    console.log(`🔄 Multi-pool mode: ${this.config.useMultiPool ? 'ENABLED' : 'DISABLED'}`);

    // Initialize provider
    const rpcUrl = process.env.ETHEREUM_RPC_URL || config.rpc.ethereum;
    this.provider = new ethers.providers.JsonRpcProvider(rpcUrl.replace('wss://', 'https://'));
    
    // Initialize components
    this.simulator = new Simulator(rpcUrl.replace('wss://', 'https://'));
    
    if (!process.env.PRIVATE_KEY) {
      throw new Error('PRIVATE_KEY environment variable is required');
    }
    
    this.bundleBuilder = new BundleBuilder(process.env.PRIVATE_KEY, this.provider);
    this.executor = new Executor(this.provider);
    this.metrics = new Metrics(parseInt(process.env.METRICS_PORT || '3001'), this.config.mode === 'live');
    
    // Set contract address (would be deployed)
    this.contractAddress = process.env.JIT_CONTRACT_ADDRESS || '0x0000000000000000000000000000000000000000';
    
    if (this.config.mode === 'live' && this.contractAddress === '0x0000000000000000000000000000000000000000') {
      throw new Error('JIT_CONTRACT_ADDRESS must be set for live mode');
    }

    // Initialize either multi-pool coordinator or single watcher
    if (this.config.useMultiPool) {
      this.poolCoordinator = new PoolCoordinator(
        this.provider,
        this.simulator,
        this.bundleBuilder,
        this.executor,
        this.metrics,
        this.contractAddress
      );
    } else {
      this.mempoolWatcher = new MempoolWatcher(config.rpc.ethereum);
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
      
      if (this.config.mode === 'live') {
        console.log('🚨 Critical error in live mode, shutting down for safety');
        this.stop();
      }
    });

    process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
      console.error('❌ Unhandled rejection at:', promise, 'reason:', reason);
      this.metrics.recordExecutionError(`Unhandled rejection: ${String(reason)}`);
      
      if (this.config.mode === 'live') {
        console.log('🚨 Critical error in live mode, shutting down for safety');
        this.stop();
      }
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️ Bot is already running');
      return;
    }

    console.log('🚀 Starting JIT Bot...');
    console.log(`📊 Metrics server will be available at http://localhost:${process.env.METRICS_PORT || '3001'}`);
    console.log(`💰 Profit threshold: $${this.config.profitThresholdUSD} USD`);
    console.log(`⛽ Max gas price: ${this.config.maxGasGwei} gwei`);

    try {
      // Start metrics server
      this.metrics.start();

      // Validate configuration
      await this.validateConfiguration();

      // Additional safety checks for live mode
      if (this.config.mode === 'live') {
        await this.performLiveModeChecks();
      }

      // Start either pool coordinator or mempool watcher
      if (this.config.useMultiPool && this.poolCoordinator) {
        await this.poolCoordinator.start();
      } else if (this.mempoolWatcher) {
        await this.mempoolWatcher.start();
      }

      this.isRunning = true;
      console.log(`✅ JIT Bot started successfully in ${this.config.mode} mode`);
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
      if (this.config.useMultiPool && this.poolCoordinator) {
        await this.poolCoordinator.stop();
      } else if (this.mempoolWatcher) {
        await this.mempoolWatcher.stop();
      }
      
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
      if (this.config.mode === 'live') {
        throw new Error('JIT contract address must be set for live mode');
      }
      console.log('⚠️ Warning: JIT contract address not set, using placeholder');
    } else {
      // Verify contract exists
      const code = await this.provider.getCode(this.contractAddress);
      if (code === '0x') {
        throw new Error(`No contract found at address ${this.contractAddress}`);
      }
      console.log(`✅ JIT contract verified at ${this.contractAddress}`);
    }

    // Validate wallet
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, this.provider);
    const balance = await wallet.getBalance();
    console.log(`💰 Wallet balance: ${ethers.utils.formatEther(balance)} ETH`);

    const minBalance = this.config.mode === 'live' ? '0.1' : '0.01';
    if (balance.lt(ethers.utils.parseEther(minBalance))) {
      const message = `Low wallet balance (< ${minBalance} ETH)`;
      if (this.config.mode === 'live') {
        throw new Error(message);
      }
      console.log(`⚠️ Warning: ${message}`);
    }

    console.log('✅ Configuration validated');
  }

  private async performLiveModeChecks(): Promise<void> {
    console.log('🔒 Performing live mode safety checks...');

    // Check Flashbots configuration
    if (!process.env.FLASHBOTS_RELAY_URL) {
      throw new Error('FLASHBOTS_RELAY_URL must be set for live mode');
    }

    // Verify we're on mainnet
    const network = await this.provider.getNetwork();
    if (network.chainId !== 1) {
      throw new Error(`Expected mainnet (chainId: 1), got chainId: ${network.chainId}`);
    }

    // Check gas price limits
    const currentGasPrice = await this.provider.getGasPrice();
    const currentGwei = parseFloat(ethers.utils.formatUnits(currentGasPrice, 'gwei'));
    
    if (currentGwei > this.config.maxGasGwei) {
      console.log(`⚠️ Warning: Current gas price (${currentGwei} gwei) exceeds limit (${this.config.maxGasGwei} gwei)`);
    }

    console.log('✅ Live mode safety checks passed');
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

      // Step 3: Apply profit threshold check
      if (!this.isProfitable(simulationResult, swap)) {
        console.log(`❌ Below profit threshold: ${simulationResult.reason}`);
        this.metrics.recordSimulationFailure(simulationResult.reason || 'Below threshold');
        return;
      }

      console.log(`✅ Simulation successful, estimated profit: ${ethers.utils.formatEther(simulationResult.estimatedProfit)} ETH`);

      // Step 4: Gas price check for live mode
      if (this.config.mode === 'live') {
        const gasCheck = await this.checkGasPrice();
        if (!gasCheck.acceptable) {
          console.log(`❌ Gas price too high: ${gasCheck.currentGwei} gwei > ${this.config.maxGasGwei} gwei`);
          return;
        }
      }

      // Step 5: Build Flashbots bundle
      const bundle = await this.bundleBuilder.buildJitBundle(swap, jitParams, this.contractAddress);

      if (!this.bundleBuilder.validateBundle(bundle)) {
        console.log('❌ Bundle validation failed');
        this.metrics.recordBundleRejection('Bundle validation failed');
        return;
      }

      this.metrics.recordBundleSubmitted(JSON.stringify(bundle));

      // Step 6: Execute the bundle (with retry logic for live mode)
      const executionResult = await this.executeWithRetry(bundle);

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

  private isProfitable(simulationResult: any, _swap: PendingSwap): boolean {
    if (!simulationResult.profitable) {
      return false;
    }

    // Convert profit to USD (simplified - would need price oracle)
    const ethPrice = 2000; // $2000 per ETH (would fetch from oracle)
    const profitETH = parseFloat(ethers.utils.formatEther(simulationResult.estimatedProfit));
    const profitUSD = profitETH * ethPrice;

    return profitUSD >= this.config.profitThresholdUSD;
  }

  private async checkGasPrice(): Promise<{ acceptable: boolean; currentGwei: number }> {
    const currentGasPrice = await this.provider.getGasPrice();
    const currentGwei = parseFloat(ethers.utils.formatUnits(currentGasPrice, 'gwei'));
    
    return {
      acceptable: currentGwei <= this.config.maxGasGwei,
      currentGwei
    };
  }

  private async executeWithRetry(bundle: any): Promise<any> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        console.log(`📤 Executing bundle (attempt ${attempt}/${this.config.retryAttempts})`);
        
        const result = await this.executor.executeBundle(bundle);
        
        if (result.success) {
          return result;
        }
        
        lastError = new Error(result.error || 'Execution failed');
        
        if (attempt < this.config.retryAttempts) {
          const delay = this.config.retryDelayMs * attempt;
          console.log(`⏳ Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
      } catch (error: any) {
        lastError = error;
        console.error(`❌ Execution attempt ${attempt} failed:`, error.message);
        
        if (attempt < this.config.retryAttempts) {
          const delay = this.config.retryDelayMs * attempt;
          console.log(`⏳ Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    return {
      success: false,
      error: lastError?.message || 'All retry attempts failed'
    };
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
        console.log(`📊 Status [${this.config.mode}]: ${metrics.totalSwapsDetected} swaps detected, ${metrics.totalBundlesIncluded} successful executions`);
        
        if (this.config.mode === 'live') {
          console.log(`💰 Total profit: ${ethers.utils.formatEther(metrics.totalProfitEth || '0')} ETH`);
        }
      }
    }, 60000);
  }

  // Public method to get bot status
  getStatus(): any {
    const baseStatus = {
      isRunning: this.isRunning,
      mode: this.config.mode,
      network: this.config.network,
      contractAddress: this.contractAddress,
      config: this.config,
      metrics: this.metrics.getMetrics(),
      botConfig: {
        minProfitThreshold: config.minProfitThreshold,
        maxLoanSize: config.maxLoanSize,
        tickRangeWidth: config.tickRangeWidth,
        targets: config.targets.length
      }
    };

    // Add pool coordinator status if in multi-pool mode
    if (this.config.useMultiPool && this.poolCoordinator) {
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
      console.log('  NODE_ENV=production - Run in live mode');
      console.log('  NODE_ENV=development - Run in simulation mode (default)');
      process.exit(1);
  }
}