#!/usr/bin/env node

/**
 * Run script for JIT Bot
 * Usage: npm run run
 */

const { spawn } = require('child_process');
const path = require('path');

async function run() {
  console.log('🚀 JIT Bot Run Script');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Check required environment variables
  const requiredEnvVars = ['PRIVATE_KEY', 'RPC_URL_HTTP', 'RPC_URL_WS'];
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach(varName => {
      console.error(`   - ${varName}`);
    });
    console.error('\n📖 Please check your .env file against .env.example');
    process.exit(1);
  }

  // Safety checks
  const dryRun = process.env.DRY_RUN !== 'false';
  const liveRiskAcknowledged = process.env.I_UNDERSTAND_LIVE_RISK === 'true';

  console.log(`\nMode: ${dryRun ? 'DRY RUN (safe)' : 'LIVE EXECUTION'}`);
  
  if (!dryRun) {
    console.log('⚠️  LIVE EXECUTION MODE - Real transactions will be executed');
    console.log('⚠️  This bot will spend real ETH and submit real MEV bundles');
    
    if (!liveRiskAcknowledged) {
      console.error('\n❌ Live execution requires I_UNDERSTAND_LIVE_RISK=true');
      console.error('   This acknowledgment is required for your safety.');
      process.exit(1);
    }
    
    console.log('✅ Live risk acknowledged\n');
  } else {
    console.log('✅ DRY RUN mode - No live transactions will be executed\n');
  }

  // JIT contract check
  if (!process.env.JIT_CONTRACT_ADDRESS) {
    console.warn('⚠️  JIT_CONTRACT_ADDRESS not set - bot will use mock address');
    console.warn('   Run "npm run deploy" first for production usage\n');
  }

  console.log('🚀 Starting JIT Bot...');
  console.log('📊 Metrics will be available at: http://localhost:' + (process.env.PROMETHEUS_PORT || '9090') + '/metrics');
  console.log('🔄 Mempool monitoring: ENABLED');
  console.log('💰 Min profit threshold: $' + (process.env.GLOBAL_MIN_PROFIT_USD || '20'));
  console.log('⛽ Max gas price: ' + (process.env.MAX_GAS_GWEI || '100') + ' Gwei\n');

  // Start the bot
  const botProcess = spawn('npx', ['ts-node', 'src/bot/index.ts', 'start'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: process.env
  });

  // Handle process signals
  process.on('SIGINT', () => {
    console.log('\n⏹️  Received SIGINT, shutting down...');
    botProcess.kill('SIGINT');
  });

  process.on('SIGTERM', () => {
    console.log('\n⏹️  Received SIGTERM, shutting down...');
    botProcess.kill('SIGTERM');
  });

  botProcess.on('close', (code) => {
    if (code === 0) {
      console.log('\n✅ JIT Bot stopped successfully');
    } else {
      console.log(`\n❌ JIT Bot exited with code ${code}`);
    }
    process.exit(code);
  });

  botProcess.on('error', (error) => {
    console.error('\n❌ Failed to start JIT Bot:', error.message);
    process.exit(1);
  });
}

run().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});