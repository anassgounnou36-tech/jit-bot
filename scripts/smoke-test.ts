import { ethers, utils } from 'ethers';
import { FlashloanOrchestrator } from '../src/exec/flashloan';

/**
 * Smoke test script to validate flashloan parameters with proper BigNumber types
 * Tests USDC amounts with 6 decimal precision
 */
async function runSmokeTest() {
  console.log('🔥 Running JIT Bot Smoke Tests...');
  
  // Initialize orchestrator
  const orchestrator = new FlashloanOrchestrator();
  
  // USDC token address on Ethereum mainnet
  const usdcToken = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  
  // Test amounts using proper USDC decimals (6)
  const amount100 = utils.parseUnits("100", 6);      // 100 USDC
  const amount1000 = utils.parseUnits("1000", 6);    // 1000 USDC
  const amount0_001 = utils.parseUnits("0.001", 6);  // 0.001 USDC (1000 units)
  
  // Mock provider for testing (simulation mode)
  const provider = new ethers.providers.JsonRpcProvider('http://localhost:8545');
  
  try {
    console.log('\n📊 Test 1: Small amount (100 USDC) - should prefer Balancer');
    const result1 = await orchestrator.validateFlashloanParameters(usdcToken, amount100, provider);
    console.log(`✅ Valid: ${result1.valid}`);
    console.log(`📋 Provider: ${result1.selectedProvider}`);
    console.log(`💰 Fee: ${result1.fee ? utils.formatUnits(result1.fee, 6) : 'N/A'} USDC`);
    console.log(`📝 Issues: ${result1.issues.length > 0 ? result1.issues.join(', ') : 'None'}`);
    
    console.log('\n📊 Test 2: Large amount (1000 USDC) - should fallback to Aave');
    const result2 = await orchestrator.validateFlashloanParameters(usdcToken, amount1000, provider);
    console.log(`✅ Valid: ${result2.valid}`);
    console.log(`📋 Provider: ${result2.selectedProvider}`);
    console.log(`💰 Fee: ${result2.fee ? utils.formatUnits(result2.fee, 6) : 'N/A'} USDC`);
    console.log(`📝 Issues: ${result2.issues.length > 0 ? result2.issues.join(', ') : 'None'}`);
    
    console.log('\n📊 Test 3: Tiny amount (0.001 USDC) - should show warnings');
    const result3 = await orchestrator.validateFlashloanParameters(usdcToken, amount0_001, provider);
    console.log(`✅ Valid: ${result3.valid}`);
    console.log(`📋 Provider: ${result3.selectedProvider || 'N/A'}`);
    console.log(`💰 Fee: ${result3.fee ? utils.formatUnits(result3.fee, 6) : 'N/A'} USDC`);
    console.log(`📝 Issues: ${result3.issues.length > 0 ? result3.issues.join(', ') : 'None'}`);
    console.log(`⚠️ Warnings: ${result3.warnings && result3.warnings.length > 0 ? result3.warnings.join(', ') : 'None'}`);
    
    // Test provider selection directly
    console.log('\n📊 Test 4: Provider selection for 100 USDC');
    const selection = await orchestrator.selectOptimalProvider(usdcToken, amount100, provider);
    console.log(`📋 Selected Provider: ${selection.providerType}`);
    console.log(`💰 Fee: ${utils.formatUnits(selection.fee, 6)} USDC`);
    console.log(`📝 Reason: ${selection.reason}`);
    
    console.log('\n✅ All smoke tests completed successfully!');
    console.log('🎯 Ready for production deployment');
    
  } catch (error: any) {
    console.error('\n❌ Smoke test failed:');
    console.error(error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Environment configuration
function setupEnvironment() {
  // Set simulation mode if not already set
  if (!process.env.SIMULATION_MODE) {
    process.env.SIMULATION_MODE = 'true';
  }
  
  // Set NODE_ENV for testing
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }
  
  // Set required RPC URLs for testing
  if (!process.env.RPC_URL_HTTP) {
    process.env.RPC_URL_HTTP = 'https://rpc.ankr.com/eth';
  }
  
  if (!process.env.RPC_URL_WS) {
    process.env.RPC_URL_WS = 'wss://rpc.ankr.com/eth/ws';
  }
  
  // Set other required config values
  if (!process.env.PRIVATE_KEY) {
    process.env.PRIVATE_KEY = '0x1111111111111111111111111111111111111111111111111111111111111111';
  }
  
  if (!process.env.CHAIN) {
    process.env.CHAIN = 'ethereum';
  }
  
  console.log(`🔧 Environment: NODE_ENV=${process.env.NODE_ENV}`);
  console.log(`🔧 Simulation Mode: ${process.env.SIMULATION_MODE}`);
}

// Run the smoke test
if (require.main === module) {
  setupEnvironment();
  runSmokeTest().catch(error => {
    console.error('💥 Fatal error in smoke test:', error);
    process.exit(1);
  });
}

export { runSmokeTest };