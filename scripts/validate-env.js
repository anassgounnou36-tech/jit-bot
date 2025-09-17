#!/usr/bin/env node

/**
 * Standalone environment validation script
 * Usage: npm run validate:env [network]
 */

const { ethers } = require('ethers');
const { loadEnv } = require('./loadEnv');

// Load environment variables
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
 * Validate environment configuration
 */
function validateEnvironment() {
  console.log('🔍 JIT Bot Environment Validation');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const network = process.argv[2] || 'mainnet';
  const errors = [];
  const warnings = [];

  console.log(`\nTarget Network: ${network}`);
  console.log(`DRY_RUN Mode: ${process.env.DRY_RUN !== 'false'}\n`);

  // === Core Configuration ===
  console.log('📋 Core Configuration:');
  
  // Private Key
  const privateKey = process.env.PRIVATE_KEY;
  console.log(`   PRIVATE_KEY: ${privateKey ? mask(privateKey) : 'NOT SET'}`);
  if (!privateKey) {
    errors.push('PRIVATE_KEY is required');
  } else if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
    errors.push('PRIVATE_KEY must be a valid 32-byte hex string starting with 0x');
  }

  // RPC URLs
  const ethereumRpcUrl = process.env.ETHEREUM_RPC_URL;
  const rpcUrlHttp = process.env.RPC_URL_HTTP;
  const finalRpcUrl = ethereumRpcUrl || rpcUrlHttp;
  
  console.log(`   ETHEREUM_RPC_URL: ${ethereumRpcUrl ? `${ethereumRpcUrl.slice(0, 40)}...` : 'NOT SET'}`);
  console.log(`   RPC_URL_HTTP: ${rpcUrlHttp ? `${rpcUrlHttp.slice(0, 40)}...` : 'NOT SET'}`);
  console.log(`   Effective RPC URL: ${finalRpcUrl ? `${finalRpcUrl.slice(0, 40)}...` : 'MISSING'}`);
  
  if (!finalRpcUrl && (network === 'mainnet' || network === 'arbitrum')) {
    errors.push('ETHEREUM_RPC_URL (or RPC_URL_HTTP) is required for mainnet/arbitrum deployment');
  }
  
  if (!ethereumRpcUrl && rpcUrlHttp) {
    warnings.push('Using RPC_URL_HTTP as fallback. Consider setting ETHEREUM_RPC_URL for consistency');
  }

  // === Deployment Configuration ===
  console.log('\n🚀 Deployment Configuration:');
  
  // Profit configuration
  const minProfitThreshold = process.env.MIN_PROFIT_THRESHOLD;
  const maxLoanSize = process.env.MAX_LOAN_SIZE;
  
  console.log(`   MIN_PROFIT_THRESHOLD: ${minProfitThreshold || 'NOT SET (default: 0.01 ETH)'}`);
  console.log(`   MAX_LOAN_SIZE: ${maxLoanSize || 'NOT SET (default: 1000 ETH)'}`);
  
  if (minProfitThreshold) {
    try {
      const parsed = parseFloat(minProfitThreshold);
      if (isNaN(parsed) || parsed <= 0) {
        errors.push('MIN_PROFIT_THRESHOLD must be a positive number');
      }
    } catch (error) {
      errors.push(`MIN_PROFIT_THRESHOLD parsing failed: ${error.message}`);
    }
  }
  
  if (maxLoanSize) {
    try {
      const parsed = parseFloat(maxLoanSize);
      if (isNaN(parsed) || parsed <= 0) {
        errors.push('MAX_LOAN_SIZE must be a positive number');
      }
    } catch (error) {
      errors.push(`MAX_LOAN_SIZE parsing failed: ${error.message}`);
    }
  }

  // Address configuration
  const profitRecipient = process.env.PROFIT_RECIPIENT;
  const positionManager = process.env.POSITION_MANAGER;
  
  console.log(`   PROFIT_RECIPIENT: ${profitRecipient || 'NOT SET (will use deployer address)'}`);
  console.log(`   POSITION_MANAGER: ${positionManager || 'NOT SET (will use default: 0xC36442b4a4522E871399CD717aBDD847Ab11FE88)'}`);
  
  // Validate addresses if provided and not empty
  if (profitRecipient && profitRecipient.trim() !== '') {
    if (!ethers.utils.isAddress(profitRecipient.trim())) {
      errors.push(`PROFIT_RECIPIENT contains invalid address: "${profitRecipient}"`);
    }
  }
  
  if (positionManager && positionManager.trim() !== '') {
    if (!ethers.utils.isAddress(positionManager.trim())) {
      errors.push(`POSITION_MANAGER contains invalid address: "${positionManager}"`);
    }
  }

  // === Safety Configuration ===
  console.log('\n🛡️ Safety Configuration:');
  
  const dryRun = process.env.DRY_RUN !== 'false';
  const liveRiskAcknowledged = process.env.I_UNDERSTAND_LIVE_RISK === 'true';
  const minRequiredEth = process.env.MIN_REQUIRED_ETH;
  
  console.log(`   DRY_RUN: ${dryRun}`);
  console.log(`   I_UNDERSTAND_LIVE_RISK: ${liveRiskAcknowledged}`);
  console.log(`   MIN_REQUIRED_ETH: ${minRequiredEth || 'NOT SET (default: 0.0111)'}`);
  
  if (!dryRun && !liveRiskAcknowledged) {
    errors.push('I_UNDERSTAND_LIVE_RISK=true required when DRY_RUN=false');
  }

  // === Optional Configuration ===
  console.log('\n⚙️ Optional Configuration:');
  
  const etherscanApiKey = process.env.ETHERSCAN_API_KEY;
  const verifyContracts = process.env.VERIFY_CONTRACTS;
  
  console.log(`   ETHERSCAN_API_KEY: ${etherscanApiKey ? mask(etherscanApiKey) : 'NOT SET'}`);
  console.log(`   VERIFY_CONTRACTS: ${verifyContracts || 'NOT SET'}`);
  
  if (verifyContracts === 'true' && !etherscanApiKey) {
    warnings.push('VERIFY_CONTRACTS=true but ETHERSCAN_API_KEY not set - verification will fail');
  }

  // === Results ===
  console.log('\n' + '━'.repeat(80));
  
  if (warnings.length > 0) {
    console.log('\n⚠️ Warnings:');
    warnings.forEach(warning => console.log(`   - ${warning}`));
  }
  
  if (errors.length > 0) {
    console.log('\n❌ Validation Errors:');
    errors.forEach(error => console.log(`   - ${error}`));
    console.log('\n💡 Fix the above errors before deploying');
    process.exit(1);
  } else {
    console.log('\n✅ Environment validation passed!');
    
    if (!dryRun) {
      console.log('\n⚠️ LIVE DEPLOYMENT MODE DETECTED');
      console.log('🔥 This configuration will deploy real contracts with real funds');
      console.log('🛡️ Make sure you understand the risks');
    } else {
      console.log('\n🧪 DRY RUN mode - Safe for testing');
    }
    
    console.log('\n📋 Ready for deployment:');
    console.log(`   npm run deploy ${network}`);
  }
}

// Run validation
try {
  validateEnvironment();
} catch (error) {
  console.error('\n❌ Validation failed:', error.message);
  process.exit(1);
}