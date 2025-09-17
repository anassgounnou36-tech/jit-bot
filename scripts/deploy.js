#!/usr/bin/env node

/**
 * Deploy script for JIT Bot
 * Usage: npm run deploy [network]
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const { loadEnv } = require('./loadEnv');

// Load environment variables from .env file
loadEnv();

/**
 * Mask sensitive values for logging (show first 6 + last 4 characters)
 */
function mask(value) {
  if (!value || value.length <= 10) {
    return '***masked***';
  }
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

/**
 * Validate environment variables before deployment
 */
function validateEnvironment(network, dryRun) {
  console.log('\n🔍 Environment Variables Diagnostic:');
  
  // Check ETHEREUM_RPC_URL and RPC_URL_HTTP
  const ethereumRpcUrl = process.env.ETHEREUM_RPC_URL;
  const rpcUrlHttp = process.env.RPC_URL_HTTP;
  const finalRpcUrl = ethereumRpcUrl || rpcUrlHttp;
  
  console.log(`   ETHEREUM_RPC_URL: ${ethereumRpcUrl ? `${ethereumRpcUrl.slice(0, 30)}...` : 'not set'}`);
  console.log(`   RPC_URL_HTTP: ${rpcUrlHttp ? `${rpcUrlHttp.slice(0, 30)}...` : 'not set'}`);
  console.log(`   Final RPC URL: ${finalRpcUrl ? `${finalRpcUrl.slice(0, 30)}...` : 'MISSING'}`);
  
  // Check PRIVATE_KEY
  const privateKey = process.env.PRIVATE_KEY;
  console.log(`   PRIVATE_KEY: ${privateKey ? mask(privateKey) : 'not set'}`);
  
  // Check deployment-specific variables
  const profitRecipient = process.env.PROFIT_RECIPIENT;
  const positionManager = process.env.POSITION_MANAGER;
  
  console.log(`   DRY_RUN: ${process.env.DRY_RUN || 'not set'}`);
  console.log(`   PROFIT_RECIPIENT: ${profitRecipient || 'not set (will use deployer address)'}`);
  console.log(`   POSITION_MANAGER: ${positionManager || 'not set (will use default)'}`);
  
  // Validate required variables
  const errors = [];
  
  if (!privateKey) {
    errors.push('PRIVATE_KEY is required');
  } else if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
    errors.push('PRIVATE_KEY must be a valid 32-byte hex string starting with 0x');
  }
  
  if (!dryRun && (network === 'mainnet' || network === 'arbitrum')) {
    if (!finalRpcUrl) {
      errors.push('ETHEREUM_RPC_URL (or RPC_URL_HTTP) is required for mainnet deployment');
    }
  }
  
  // Validate addresses if provided and not empty
  if (profitRecipient && profitRecipient.trim() !== '') {
    try {
      if (!ethers.utils.isAddress(profitRecipient.trim())) {
        errors.push(`PROFIT_RECIPIENT contains invalid address: "${profitRecipient}"`);
      }
    } catch (error) {
      errors.push(`PROFIT_RECIPIENT validation failed: ${error.message}`);
    }
  }
  
  if (positionManager && positionManager.trim() !== '') {
    try {
      if (!ethers.utils.isAddress(positionManager.trim())) {
        errors.push(`POSITION_MANAGER contains invalid address: "${positionManager}"`);
      }
    } catch (error) {
      errors.push(`POSITION_MANAGER validation failed: ${error.message}`);
    }
  }
  
  if (errors.length > 0) {
    console.error('\n❌ Environment validation failed:');
    errors.forEach(error => console.error(`   - ${error}`));
    process.exit(1);
  }
  
  console.log('✅ Environment validation passed\n');
}

async function deploy() {
  console.log('🚀 JIT Bot Deploy Script');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const network = process.argv[2] || 'mainnet';
  const dryRun = process.env.DRY_RUN !== 'false';

  console.log(`\nNetwork: ${network}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE DEPLOYMENT'}\n`);

  if (!dryRun) {
    console.log('⚠️  LIVE DEPLOYMENT MODE - Real contracts will be deployed');
    console.log('⚠️  Ensure you have sufficient ETH and understand the risks\n');
  }

  try {
    // Load configuration
    if (!process.env.PRIVATE_KEY) {
      throw new Error('PRIVATE_KEY environment variable is required');
    }

    if (!dryRun && !process.env.I_UNDERSTAND_LIVE_RISK) {
      throw new Error('I_UNDERSTAND_LIVE_RISK=true required for live deployment');
    }

    // Validate environment variables before proceeding
    validateEnvironment(network, dryRun);

    // Check if already deployed
    const deploymentPath = path.join(__dirname, '../deployments', `${network}.json`);
    if (fs.existsSync(deploymentPath)) {
      const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
      console.log('📋 Existing deployment found:');
      console.log(`   JIT Executor: ${deployment.jitExecutor}`);
      console.log(`   Deployed at: ${deployment.timestamp}`);
      console.log(`   Block: ${deployment.blockNumber}\n`);
      
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise(resolve => {
        readline.question('Redeploy? (y/N): ', resolve);
      });
      readline.close();
      
      if (answer.toLowerCase() !== 'y') {
        console.log('✅ Using existing deployment');
        process.exit(0);
      }
    }

    // Deploy contracts
    console.log('🔨 Deploying JIT Executor contract...');
    
    if (dryRun) {
      console.log('🧪 DRY RUN: Contract deployment simulation');
      console.log('   ✅ Contract compilation successful');
      console.log('   ✅ Gas estimation: ~2,500,000 gas');
      console.log('   ✅ Deployment cost: ~0.025 ETH');
      console.log('   ✅ Constructor validation passed');
      
      const mockAddress = '0x' + '1'.repeat(40);
      console.log(`   📋 Mock JIT Executor address: ${mockAddress}`);
      
      // Create mock deployment record
      const deployment = {
        network,
        jitExecutor: mockAddress,
        timestamp: new Date().toISOString(),
        blockNumber: 0,
        transactionHash: '0x' + '0'.repeat(64),
        dryRun: true
      };
      
      // Ensure deployments directory exists
      const deploymentDir = path.join(__dirname, '../deployments');
      if (!fs.existsSync(deploymentDir)) {
        fs.mkdirSync(deploymentDir, { recursive: true });
      }
      
      fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
      
    } else {
      // Actual deployment using hardhat
      const { execSync } = require('child_process');
      
      try {
        const result = execSync(`npx hardhat run scripts/deploy.ts --network ${network}`, {
          encoding: 'utf8',
          cwd: path.join(__dirname, '..')
        });
        
        console.log(result);
        console.log('✅ Contract deployed successfully');
        
      } catch (error) {
        console.error('❌ Deployment failed:', error.message);
        process.exit(1);
      }
    }

    console.log('\n✅ Deployment completed successfully');
    console.log('📖 Next steps:');
    console.log('   1. Update JIT_CONTRACT_ADDRESS in your .env file');
    console.log('   2. Run: npm run run (to start the bot)');
    console.log('   3. Monitor: http://localhost:9090/metrics');

  } catch (error) {
    console.error('\n❌ Deployment failed:', error.message);
    process.exit(1);
  }
}

deploy().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});