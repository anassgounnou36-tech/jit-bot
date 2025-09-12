import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import { MempoolWatcher, PendingSwap } from '../watcher/mempoolWatcher';
import { Simulator, JitParameters } from '../watcher/simulator';
import { BundleBuilder } from '../bundler/bundleBuilder';
import { Executor } from '../executor/executor';
import { Metrics } from '../metrics/metrics';
import config from '../../config.json';

export interface PoolConfig {
  id: string;
  address: string;
  token0: string;
  token1: string;
  fee: number;
  symbol0: string;
  symbol1: string;
  enabled: boolean;
  failureCount: number;
  lastFailureTime: number;
  profitThresholdUSD?: number;
}

export interface OpportunityCandidate {
  swap: PendingSwap;
  jitParams: JitParameters;
  estimatedProfitETH: ethers.BigNumber;
  estimatedProfitUSD: number;
  poolId: string;
  timestamp: number;
  blockNumber: number;
}

export interface CoordinatorConfig {
  globalProfitThresholdUSD: number;
  maxFailuresBeforeDisable: number;
  poolCooldownMs: number;
  maxConcurrentWatchers: number;
}

export class PoolCoordinator extends EventEmitter {
  private pools: Map<string, PoolConfig> = new Map();
  private watchers: Map<string, MempoolWatcher> = new Map();
  private currentOpportunities: Map<number, OpportunityCandidate[]> = new Map(); // blockNumber -> opportunities
  private config: CoordinatorConfig;
  private simulator: Simulator;
  private bundleBuilder: BundleBuilder;
  private executor: Executor;
  private metrics: Metrics;
  private provider: ethers.providers.JsonRpcProvider;
  private isRunning: boolean = false;
  private blockSubscription: any;
  private contractAddress: string;

  constructor(
    provider: ethers.providers.JsonRpcProvider,
    simulator: Simulator,
    bundleBuilder: BundleBuilder,
    executor: Executor,
    metrics: Metrics,
    contractAddress: string
  ) {
    super();
    this.provider = provider;
    this.simulator = simulator;
    this.bundleBuilder = bundleBuilder;
    this.executor = executor;
    this.metrics = metrics;
    this.contractAddress = contractAddress;

    this.config = {
      globalProfitThresholdUSD: parseFloat(process.env.PROFIT_THRESHOLD_USD || '100'),
      maxFailuresBeforeDisable: parseInt(process.env.POOL_MAX_FAILURES || '5'),
      poolCooldownMs: parseInt(process.env.POOL_COOLDOWN_MS || '300000'), // 5 minutes
      maxConcurrentWatchers: parseInt(process.env.MAX_CONCURRENT_WATCHERS || '10')
    };

    this.initializePools();
  }

  private initializePools(): void {
    // Get pools from environment variable or use config defaults
    const poolIds = process.env.POOL_IDS?.split(',') || [];
    
    // If no POOL_IDS specified, use all pools from config
    const targetPools = poolIds.length > 0 
      ? config.targets.filter(target => poolIds.includes(target.pool))
      : config.targets;

    for (const target of targetPools) {
      const poolConfig: PoolConfig = {
        id: target.pool,
        address: target.address,
        token0: target.token0,
        token1: target.token1,
        fee: target.fee,
        symbol0: target.symbol0,
        symbol1: target.symbol1,
        enabled: true,
        failureCount: 0,
        lastFailureTime: 0,
        profitThresholdUSD: this.getPoolProfitThreshold(target.pool)
      };

      this.pools.set(target.pool, poolConfig);
      console.log(`📊 Initialized pool: ${poolConfig.id} (${poolConfig.symbol0}/${poolConfig.symbol1})`);
    }

    console.log(`✅ Initialized ${this.pools.size} pools for monitoring`);
  }

  private getPoolProfitThreshold(poolId: string): number {
    // Check for pool-specific threshold in environment
    const envKey = `POOL_PROFIT_THRESHOLD_USD__${poolId.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const poolSpecific = process.env[envKey];
    
    return poolSpecific ? parseFloat(poolSpecific) : this.config.globalProfitThresholdUSD;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️ Pool coordinator is already running');
      return;
    }

    console.log('🚀 Starting Pool Coordinator...');
    console.log(`📊 Managing ${this.pools.size} pools with ${this.config.maxConcurrentWatchers} max watchers`);

    // Start watchers for enabled pools
    await this.startPoolWatchers();

    // Subscribe to new blocks for opportunity evaluation
    this.subscribeToBlocks();

    this.isRunning = true;
    console.log('✅ Pool Coordinator started successfully');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('🛑 Stopping Pool Coordinator...');

    // Stop all watchers
    for (const [poolId, watcher] of this.watchers) {
      console.log(`🛑 Stopping watcher for pool ${poolId}`);
      await watcher.stop();
    }
    this.watchers.clear();

    // Unsubscribe from blocks
    if (this.blockSubscription) {
      this.provider.off('block', this.blockSubscription);
    }

    this.isRunning = false;
    console.log('✅ Pool Coordinator stopped');
  }

  private async startPoolWatchers(): Promise<void> {
    const enabledPools = Array.from(this.pools.values()).filter(pool => pool.enabled);
    
    for (const pool of enabledPools.slice(0, this.config.maxConcurrentWatchers)) {
      await this.startPoolWatcher(pool);
    }
  }

  private async startPoolWatcher(pool: PoolConfig): Promise<void> {
    if (this.watchers.has(pool.id)) {
      console.log(`⚠️ Watcher for pool ${pool.id} is already running`);
      return;
    }

    try {
      console.log(`🔍 Starting watcher for pool: ${pool.id}`);
      
      // Create pool-specific watcher
      const rpcUrl = process.env.ETHEREUM_RPC_URL || config.rpc.ethereum;
      const watcher = new MempoolWatcher(rpcUrl);
      
      // Listen for swap detections from this pool
      watcher.on('swapDetected', (swap: PendingSwap) => {
        this.handleSwapDetected(swap, pool.id);
      });

      // Start the watcher
      await watcher.start();
      this.watchers.set(pool.id, watcher);
      
      console.log(`✅ Started watcher for pool: ${pool.id}`);
      
    } catch (error: any) {
      console.error(`❌ Failed to start watcher for pool ${pool.id}:`, error.message);
      this.recordPoolFailure(pool.id, error.message);
    }
  }

  private subscribeToBlocks(): void {
    this.blockSubscription = (blockNumber: number) => {
      this.evaluateOpportunitiesForBlock(blockNumber);
    };
    
    this.provider.on('block', this.blockSubscription);
    console.log('🔄 Subscribed to new blocks for opportunity evaluation');
  }

  private async handleSwapDetected(swap: PendingSwap, poolId: string): Promise<void> {
    const pool = this.pools.get(poolId);
    if (!pool || !pool.enabled) {
      return;
    }

    console.log(`🎯 Swap detected in pool ${poolId}: ${swap.hash}`);

    try {
      // Calculate JIT parameters
      const jitParams = await this.calculateJitParameters(swap, pool);
      
      // Simulate the execution
      const simulationResult = await this.simulator.simulateJitBundle(swap, jitParams);
      
      if (!simulationResult.profitable) {
        console.log(`❌ Simulation unprofitable for ${poolId}: ${simulationResult.reason}`);
        return;
      }

      // Estimate USD profit (simplified - would need price feeds in practice)
      const estimatedProfitUSD = this.estimateUSDProfit(simulationResult.estimatedProfit);
      
      // Check pool-specific profit threshold
      const threshold = pool.profitThresholdUSD || this.config.globalProfitThresholdUSD;
      if (estimatedProfitUSD < threshold) {
        console.log(`❌ Below threshold for ${poolId}: $${estimatedProfitUSD} < $${threshold}`);
        return;
      }

      // Get current block number
      const blockNumber = await this.provider.getBlockNumber();
      
      // Create opportunity candidate
      const candidate: OpportunityCandidate = {
        swap,
        jitParams,
        estimatedProfitETH: simulationResult.estimatedProfit,
        estimatedProfitUSD,
        poolId,
        timestamp: Date.now(),
        blockNumber: blockNumber + 1 // Target next block
      };

      // Add to opportunities for evaluation
      this.addOpportunityCandidate(candidate);
      
      console.log(`✅ Added candidate for ${poolId}: $${estimatedProfitUSD} USD profit`);
      
    } catch (error: any) {
      console.error(`❌ Error processing swap for ${poolId}:`, error.message);
      this.recordPoolFailure(poolId, error.message);
    }
  }

  private addOpportunityCandidate(candidate: OpportunityCandidate): void {
    const opportunities = this.currentOpportunities.get(candidate.blockNumber) || [];
    opportunities.push(candidate);
    this.currentOpportunities.set(candidate.blockNumber, opportunities);
    
    // Clean up old opportunities (older than 3 blocks)
    const currentBlock = candidate.blockNumber;
    for (const [blockNum] of this.currentOpportunities) {
      if (blockNum < currentBlock - 3) {
        this.currentOpportunities.delete(blockNum);
      }
    }
  }

  private async evaluateOpportunitiesForBlock(blockNumber: number): Promise<void> {
    const opportunities = this.currentOpportunities.get(blockNumber);
    
    if (!opportunities || opportunities.length === 0) {
      return;
    }

    console.log(`🔍 Evaluating ${opportunities.length} opportunities for block ${blockNumber}`);

    // Sort by estimated profit (highest first)
    opportunities.sort((a, b) => {
      return b.estimatedProfitUSD - a.estimatedProfitUSD;
    });

    // Select the most profitable opportunity
    const bestOpportunity = opportunities[0];
    
    console.log(`🏆 Selected best opportunity: ${bestOpportunity.poolId} with $${bestOpportunity.estimatedProfitUSD} profit`);

    // Execute the best opportunity
    await this.executeOpportunity(bestOpportunity);

    // Record metrics for all opportunities
    this.recordOpportunityMetrics(opportunities, bestOpportunity);
    
    // Clean up processed opportunities
    this.currentOpportunities.delete(blockNumber);
  }

  private async executeOpportunity(opportunity: OpportunityCandidate): Promise<void> {
    const { swap, jitParams, poolId } = opportunity;
    const pool = this.pools.get(poolId)!;

    try {
      console.log(`🚀 Executing opportunity in pool ${poolId}`);

      // Build bundle
      const bundle = await this.bundleBuilder.buildJitBundle(swap, jitParams, this.contractAddress);
      
      if (!this.bundleBuilder.validateBundle(bundle)) {
        throw new Error('Bundle validation failed');
      }

      // Execute bundle
      const result = await this.executor.executeBundle(bundle);
      
      if (result.success) {
        console.log(`✅ Successfully executed opportunity in pool ${poolId}`);
        
        // Estimate profit and gas for metrics
        const estimatedProfitETH = opportunity.estimatedProfitETH;
        const estimatedGasETH = ethers.utils.parseEther('0.01'); // Simplified gas estimate
        
        this.metrics.recordBundleIncluded(JSON.stringify(bundle), estimatedProfitETH, estimatedGasETH);
        
        // Reset failure count on success
        pool.failureCount = 0;
        
        // Record pool-specific success metrics
        this.recordPoolSuccess(poolId, opportunity.estimatedProfitUSD);
        
      } else {
        throw new Error(result.error || 'Execution failed');
      }

    } catch (error: any) {
      console.error(`❌ Failed to execute opportunity in pool ${poolId}:`, error.message);
      this.recordPoolFailure(poolId, error.message);
      this.metrics.recordExecutionError(error.message);
    }
  }

  private recordPoolFailure(poolId: string, error: string): void {
    const pool = this.pools.get(poolId);
    if (!pool) return;

    pool.failureCount++;
    pool.lastFailureTime = Date.now();

    console.log(`📊 Pool ${poolId} failure count: ${pool.failureCount}`);

    // Disable pool if it exceeds failure threshold
    if (pool.failureCount >= this.config.maxFailuresBeforeDisable) {
      this.disablePool(poolId, 'Too many failures');
    }

    // Record metrics
    this.metrics.recordPoolFailure(poolId, error);
  }

  private recordPoolSuccess(poolId: string, profitUSD: number): void {
    // This would be enhanced to record pool-specific metrics
    console.log(`📊 Pool ${poolId} success: $${profitUSD} profit`);
    // Record in metrics with estimated gas cost
    const estimatedGasETH = ethers.utils.parseEther('0.01'); // Simplified
    this.metrics.recordPoolBundleIncluded(poolId, ethers.utils.parseEther((profitUSD / 3000).toString()).toString(), estimatedGasETH.toString(), profitUSD);
  }

  private disablePool(poolId: string, reason: string): void {
    const pool = this.pools.get(poolId);
    if (!pool) return;

    pool.enabled = false;
    console.log(`🚫 Disabled pool ${poolId}: ${reason}`);

    // Stop watcher
    const watcher = this.watchers.get(poolId);
    if (watcher) {
      watcher.stop();
      this.watchers.delete(poolId);
    }

    // Update metrics
    this.metrics.disablePool(poolId);

    // Schedule re-enable
    setTimeout(() => {
      this.enablePool(poolId);
    }, this.config.poolCooldownMs);
  }

  private enablePool(poolId: string): void {
    const pool = this.pools.get(poolId);
    if (!pool) return;

    pool.enabled = true;
    pool.failureCount = 0;
    console.log(`✅ Re-enabled pool ${poolId} after cooldown`);

    // Update metrics
    this.metrics.enablePool(poolId);

    // Restart watcher
    this.startPoolWatcher(pool);
  }

  private async calculateJitParameters(swap: PendingSwap, pool: PoolConfig): Promise<JitParameters> {
    // Reuse existing calculation logic but make it pool-aware
    const currentPrice = ethers.BigNumber.from('1000000000000000000'); // Simplified
    const targetPrice = currentPrice;
    const tickSpacing = pool.fee === 500 ? 10 : 60;

    const tickRange = this.simulator.calculateOptimalTickRange(
      currentPrice,
      targetPrice,
      tickSpacing
    );

    const totalLoanAmount = ethers.utils.parseEther(config.maxLoanSize.toString());
    const amount0 = swap.tokenIn.toLowerCase() === pool.token0.toLowerCase() ? 
      totalLoanAmount.div(2) : ethers.BigNumber.from(0);
    const amount1 = swap.tokenIn.toLowerCase() === pool.token1.toLowerCase() ? 
      totalLoanAmount.div(2) : ethers.BigNumber.from(0);

    return {
      pool: pool.address,
      token0: pool.token0,
      token1: pool.token1,
      fee: pool.fee,
      tickLower: tickRange.tickLower,
      tickUpper: tickRange.tickUpper,
      amount0: amount0.toString(),
      amount1: amount1.toString(),
      deadline: Math.floor(Date.now() / 1000) + 300
    };
  }

  private estimateUSDProfit(profitETH: ethers.BigNumber): number {
    // Simplified USD conversion - in practice would use price feed
    const ethPriceUSD = 3000; // Approximate ETH price
    const profitETHFloat = parseFloat(ethers.utils.formatEther(profitETH));
    return profitETHFloat * ethPriceUSD;
  }

  private recordOpportunityMetrics(opportunities: OpportunityCandidate[], executed: OpportunityCandidate): void {
    // Record metrics about opportunity evaluation
    for (const opp of opportunities) {
      const wasExecuted = opp === executed;
      console.log(`📊 Opportunity ${opp.poolId}: $${opp.estimatedProfitUSD} ${wasExecuted ? '(EXECUTED)' : '(SKIPPED)'}`);
    }
  }

  // Utility methods for monitoring
  getPoolStatus(): { [poolId: string]: PoolConfig } {
    const status: { [poolId: string]: PoolConfig } = {};
    for (const [id, pool] of this.pools) {
      status[id] = { ...pool };
    }
    return status;
  }

  getCurrentOpportunities(): { [blockNumber: number]: OpportunityCandidate[] } {
    const opportunities: { [blockNumber: number]: OpportunityCandidate[] } = {};
    for (const [blockNum, opps] of this.currentOpportunities) {
      opportunities[blockNum] = [...opps];
    }
    return opportunities;
  }
}