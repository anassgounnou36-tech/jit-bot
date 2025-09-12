#!/usr/bin/env node

// Demo script to showcase multi-pool functionality
import { PoolCoordinator } from '../src/coordinator/poolCoordinator';
import { Simulator } from '../src/watcher/simulator';
import { BundleBuilder } from '../src/bundler/bundleBuilder';
import { Executor } from '../src/executor/executor';
import { Metrics } from '../src/metrics/metrics';
import { ethers } from 'ethers';

async function demoMultiPool() {
  console.log('🚀 JIT Bot Multi-Pool Demo');
  console.log('============================');
  
  // Set up environment for demo
  process.env.POOL_IDS = 'WETH-USDC-0.05%,ETH-USDT-0.3%,WBTC-ETH-0.3%';
  process.env.PROFIT_THRESHOLD_USD = '50';
  process.env.POOL_PROFIT_THRESHOLD_USD__WETH_USDC_0_05_ = '75';
  process.env.POOL_MAX_FAILURES = '3';
  
  // Create demo components (mock for demo purposes)
  const mockProvider = new ethers.providers.JsonRpcProvider('https://eth-mainnet.alchemyapi.io/v2/demo');
  const simulator = new Simulator('https://eth-mainnet.alchemyapi.io/v2/demo');
  const bundleBuilder = new BundleBuilder('0x0123456789012345678901234567890123456789012345678901234567890123', mockProvider);
  const executor = new Executor(mockProvider);
  const metrics = new Metrics(3004, false);
  
  // Create coordinator
  const coordinator = new PoolCoordinator(
    mockProvider,
    simulator,
    bundleBuilder,
    executor,
    metrics,
    '0x1234567890123456789012345678901234567890'
  );
  
  console.log('\n📊 Pool Status:');
  const poolStatus = coordinator.getPoolStatus();
  for (const [poolId, pool] of Object.entries(poolStatus)) {
    console.log(`  ${poolId}:`);
    console.log(`    - Address: ${pool.address}`);
    console.log(`    - Enabled: ${pool.enabled}`);
    console.log(`    - Profit Threshold: $${pool.profitThresholdUSD} USD`);
    console.log(`    - Failure Count: ${pool.failureCount}`);
  }
  
  console.log('\n🔧 Configuration:');
  console.log(`  - Global Profit Threshold: $${process.env.PROFIT_THRESHOLD_USD} USD`);
  console.log(`  - Pool-specific Thresholds: ${process.env.POOL_PROFIT_THRESHOLD_USD__WETH_USDC_0_05_ ? 'Configured' : 'None'}`);
  console.log(`  - Max Failures: ${process.env.POOL_MAX_FAILURES}`);
  
  console.log('\n📈 Metrics:');
  const allMetrics = metrics.getMetrics();
  if (allMetrics.poolMetrics) {
    for (const [poolId, poolMetrics] of Object.entries(allMetrics.poolMetrics)) {
      console.log(`  ${poolId}:`);
      console.log(`    - Swaps Detected: ${poolMetrics.swapsDetected}`);
      console.log(`    - Success Rate: ${(poolMetrics.successRate * 100).toFixed(1)}%`);
      console.log(`    - Total Profit: $${poolMetrics.totalProfitUSD} USD`);
    }
  }
  
  console.log('\n✅ Multi-Pool JIT Bot Demo Complete!');
  console.log('\nTo run the actual bot:');
  console.log('  1. Set your environment variables (.env file)');
  console.log('  2. Configure POOL_IDS with desired pools');
  console.log('  3. Run: npm run dev');
  
  // Clean up
  metrics.stop();
}

// Run demo if executed directly
if (require.main === module) {
  demoMultiPool().catch(console.error);
}

export { demoMultiPool };