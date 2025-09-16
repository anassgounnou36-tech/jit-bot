#!/usr/bin/env node

/**
 * Smoke test script for Alchemy RPC endpoints
 * Performs minimal HTTP + WebSocket calls to validate connectivity
 * Does NOT send any transactions - only reads blockchain state
 */

const { ethers } = require('ethers');
const WebSocket = require('ws');

const ETHEREUM_MAINNET_CHAIN_ID = 1;
const UNISWAP_V3_FACTORY = '0x1F98431c8aD98523631AE4a59f267346ea31F984';

async function testAlchemyHttp(rpcUrl) {
  console.log('\n🌐 Testing Alchemy HTTP endpoint...');
  
  try {
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    
    // Test 1: Get chain ID
    console.log('📡 Testing eth_chainId...');
    const chainId = await provider.getNetwork();
    console.log(`✅ Chain ID: ${chainId.chainId} (${chainId.name})`);
    
    if (chainId.chainId !== ETHEREUM_MAINNET_CHAIN_ID) {
      console.log(`⚠️  Warning: Expected mainnet (chainId=1), got ${chainId.chainId}`);
    }
    
    // Test 2: Get latest block
    console.log('📡 Testing eth_getBlockByNumber...');
    const latestBlock = await provider.getBlock('latest');
    console.log(`✅ Latest block: ${latestBlock.number} (${new Date(latestBlock.timestamp * 1000).toISOString()})`);
    
    // Test 3: Get gas price
    console.log('📡 Testing eth_gasPrice...');
    const gasPrice = await provider.getGasPrice();
    const gasPriceGwei = ethers.utils.formatUnits(gasPrice, 'gwei');
    console.log(`✅ Gas price: ${gasPriceGwei} gwei`);
    
    // Test 4: Call a contract (Uniswap V3 Factory)
    console.log('📡 Testing eth_call...');
    const factory = new ethers.Contract(
      UNISWAP_V3_FACTORY,
      ['function owner() view returns (address)'],
      provider
    );
    const owner = await factory.owner();
    console.log(`✅ Uniswap V3 Factory owner: ${owner}`);
    
    // Test 5: Get transaction count for a known address (Uniswap router)
    console.log('📡 Testing eth_getTransactionCount...');
    const routerAddress = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
    const txCount = await provider.getTransactionCount(routerAddress);
    console.log(`✅ Uniswap router transaction count: ${txCount}`);
    
    console.log('✅ HTTP endpoint tests completed successfully!');
    return true;
    
  } catch (error) {
    console.error('❌ HTTP endpoint test failed:');
    console.error(`   Error: ${error.message}`);
    if (error.code) {
      console.error(`   Code: ${error.code}`);
    }
    return false;
  }
}

async function testAlchemyWebSocket(wsUrl) {
  console.log('\n🔌 Testing Alchemy WebSocket endpoint...');
  
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    let testsPassed = 0;
    const totalTests = 3;
    
    const timeout = setTimeout(() => {
      console.error('❌ WebSocket test timed out');
      ws.close();
      resolve(false);
    }, 10000); // 10 second timeout
    
    ws.on('open', () => {
      console.log('✅ WebSocket connection established');
      testsPassed++;
      
      // Test 1: Subscribe to new block headers
      console.log('📡 Testing eth_subscribe newHeads...');
      ws.send(JSON.stringify({
        id: 1,
        method: 'eth_subscribe',
        params: ['newHeads']
      }));
    });
    
    ws.on('message', (data) => {
      try {
        const response = JSON.parse(data.toString());
        
        if (response.id === 1 && response.result) {
          console.log(`✅ Subscribed to newHeads: ${response.result}`);
          testsPassed++;
          
          // Test 2: Get latest block via WebSocket
          console.log('📡 Testing eth_getBlockByNumber via WebSocket...');
          ws.send(JSON.stringify({
            id: 2,
            method: 'eth_getBlockByNumber',
            params: ['latest', false]
          }));
          
        } else if (response.id === 2 && response.result) {
          const block = response.result;
          console.log(`✅ Latest block via WebSocket: ${parseInt(block.number, 16)} (${block.hash.substring(0, 10)}...)`);
          testsPassed++;
          
          // All tests completed
          if (testsPassed >= totalTests) {
            console.log('✅ WebSocket endpoint tests completed successfully!');
            clearTimeout(timeout);
            ws.close();
            resolve(true);
          }
          
        } else if (response.method === 'eth_subscription') {
          // Received a new block notification
          const block = response.params.result;
          console.log(`📡 New block notification: ${parseInt(block.number, 16)}`);
          
        } else if (response.error) {
          console.error(`❌ WebSocket RPC error: ${response.error.message}`);
          clearTimeout(timeout);
          ws.close();
          resolve(false);
        }
        
      } catch (parseError) {
        console.error(`❌ Failed to parse WebSocket message: ${parseError.message}`);
      }
    });
    
    ws.on('error', (error) => {
      console.error(`❌ WebSocket error: ${error.message}`);
      clearTimeout(timeout);
      resolve(false);
    });
    
    ws.on('close', () => {
      console.log('🔌 WebSocket connection closed');
      clearTimeout(timeout);
      if (testsPassed < totalTests) {
        resolve(false);
      }
    });
  });
}

async function main() {
  console.log('🔥 Alchemy Endpoint Smoke Test');
  console.log('📅 Started:', new Date().toISOString());
  console.log('🔒 Safety: Read-only operations, no transactions will be sent\n');
  
  // Get environment variables
  const httpUrl = process.env.RPC_URL_HTTP;
  const wsUrl = process.env.RPC_URL_WS;
  
  if (!httpUrl) {
    console.error('❌ RPC_URL_HTTP environment variable is required');
    process.exit(1);
  }
  
  if (!wsUrl) {
    console.error('❌ RPC_URL_WS environment variable is required');
    process.exit(1);
  }
  
  // Mask credentials in URLs for logging
  const maskUrl = (url) => url.replace(/\/\/.*@/, '//***@').replace(/\/v2\/.*/, '/v2/***');
  
  console.log(`🌐 HTTP URL: ${maskUrl(httpUrl)}`);
  console.log(`🔌 WebSocket URL: ${maskUrl(wsUrl)}`);
  
  let allTestsPassed = true;
  
  // Run HTTP tests
  const httpResult = await testAlchemyHttp(httpUrl);
  allTestsPassed = allTestsPassed && httpResult;
  
  // Run WebSocket tests
  const wsResult = await testAlchemyWebSocket(wsUrl);
  allTestsPassed = allTestsPassed && wsResult;
  
  // Summary
  console.log('\n📊 Test Summary:');
  console.log(`   HTTP endpoint: ${httpResult ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   WebSocket endpoint: ${wsResult ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Overall: ${allTestsPassed ? '✅ PASS' : '❌ FAIL'}`);
  
  if (allTestsPassed) {
    console.log('\n🎉 All Alchemy endpoint tests passed!');
    console.log('📈 You should see these requests in your Alchemy dashboard');
    console.log('📅 Completed:', new Date().toISOString());
    process.exit(0);
  } else {
    console.log('\n💥 Some tests failed. Check your Alchemy configuration.');
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⏹️  Test interrupted by user');
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('\n⏹️  Test terminated');
  process.exit(1);
});

// Run the smoke test
if (require.main === module) {
  main().catch(error => {
    console.error('\n💥 Fatal error in smoke test:');
    console.error(error);
    process.exit(1);
  });
}

module.exports = { testAlchemyHttp, testAlchemyWebSocket };