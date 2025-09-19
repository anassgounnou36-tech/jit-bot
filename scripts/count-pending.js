#!/usr/bin/env node

/**
 * Standalone raw pending transaction counter script
 * 
 * This script subscribes to eth_subscribe newPendingTransactions and counts
 * transaction hashes, printing per-10s and per-60s totals.
 * 
 * Usage:
 *   WS_URL=wss://your-node.com/ws node scripts/count-pending.js
 *   RPC_URL_WS=wss://your-node.com/ws node scripts/count-pending.js
 */

const WebSocket = require('ws');

// Configuration
const WS_URL = process.env.WS_URL || process.env.RPC_URL_WS;

if (!WS_URL) {
  console.error('Error: WS_URL or RPC_URL_WS environment variable is required');
  console.error('Example: WS_URL=wss://eth-mainnet.ws.alchemyapi.io/v2/YOUR_KEY node scripts/count-pending.js');
  process.exit(1);
}

// Counters
let pendingCount10s = 0;
let pendingCount60s = 0;
let startTime = Date.now();

// WebSocket connection
let ws;
let subscriptionId;

// Graceful shutdown
function gracefulShutdown() {
  console.log('\n🛑 Shutting down gracefully...');
  
  if (ws && ws.readyState === WebSocket.OPEN) {
    if (subscriptionId) {
      // Unsubscribe
      ws.send(JSON.stringify({
        id: 999,
        method: 'eth_unsubscribe',
        params: [subscriptionId]
      }));
    }
    ws.close();
  }
  
  process.exit(0);
}

// Handle SIGINT (Ctrl+C)
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// Log pending counts
function logCounts(interval) {
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const count = interval === '10s' ? pendingCount10s : pendingCount60s;
  
  console.log(`[${new Date().toISOString()}] Pending TX count (${interval}): ${count} (total runtime: ${elapsed}s)`);
  
  // Reset counter
  if (interval === '10s') {
    pendingCount10s = 0;
  } else {
    pendingCount60s = 0;
  }
}

// Start counting intervals
function startCounters() {
  // Log every 10 seconds
  setInterval(() => {
    logCounts('10s');
  }, 10 * 1000);

  // Log every 60 seconds
  setInterval(() => {
    logCounts('60s');
  }, 60 * 1000);
}

// Connect to WebSocket and subscribe
function connect() {
  console.log(`🔗 Connecting to: ${WS_URL}`);
  
  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log('✅ WebSocket connected');
    
    // Subscribe to pending transactions
    const subscribeRequest = {
      id: 1,
      method: 'eth_subscribe',
      params: ['newPendingTransactions']
    };
    
    ws.send(JSON.stringify(subscribeRequest));
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      // Handle subscription confirmation
      if (message.id === 1 && message.result) {
        subscriptionId = message.result;
        console.log(`📡 Subscribed to pending transactions (subscription ID: ${subscriptionId})`);
        console.log('📊 Starting counters...\n');
        startCounters();
        return;
      }
      
      // Handle pending transaction notifications
      if (message.method === 'eth_subscription' && 
          message.params && 
          message.params.subscription === subscriptionId) {
        
        // Count the transaction
        pendingCount10s++;
        pendingCount60s++;
      }
      
    } catch (error) {
      console.error('❌ Error parsing WebSocket message:', error.message);
    }
  });

  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error.message);
  });

  ws.on('close', (code, reason) => {
    console.log(`🔌 WebSocket closed (code: ${code}, reason: ${reason})`);
    
    // Attempt to reconnect after 5 seconds
    setTimeout(() => {
      console.log('🔄 Attempting to reconnect...');
      connect();
    }, 5000);
  });
}

// Start the application
console.log('🚀 Pending Transaction Counter');
console.log('===============================');
console.log(`Node.js version: ${process.version}`);
console.log(`Target URL: ${WS_URL}`);
console.log('');

connect();