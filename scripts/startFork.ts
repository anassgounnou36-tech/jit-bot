#!/usr/bin/env node

import { spawn } from "child_process";
import * as dotenv from "dotenv";

dotenv.config();

async function startForkNode() {
  console.log("🚀 Starting Hardhat Fork Node for JIT LP Bot Testing");
  console.log("==================================================");

  const rpcUrl = process.env.ETHEREUM_RPC_URL;
  const blockNumber = process.env.FORK_BLOCK_NUMBER;

  if (!rpcUrl) {
    console.error("❌ Error: ETHEREUM_RPC_URL not set in .env file");
    console.error("Please set your Ethereum RPC URL in the .env file:");
    console.error("ETHEREUM_RPC_URL=https://eth-mainnet.alchemyapi.io/v2/YOUR_KEY");
    process.exit(1);
  }

  console.log(`📡 RPC URL: ${rpcUrl.replace(/\/v2\/.*/, '/v2/***')}`);
  console.log(`📦 Block Number: ${blockNumber || 'latest'}`);
  
  // Build the command
  let command = `npx hardhat node --fork ${rpcUrl}`;
  
  if (blockNumber) {
    command += ` --fork-block-number ${blockNumber}`;
  }
  
  // Additional options for better testing
  command += ` --hostname 0.0.0.0 --port 8545`;
  
  console.log(`\n🔄 Starting fork with command:`);
  console.log(`${command}\n`);
  
  try {
    // Start the fork node
    const forkProcess = spawn('npx', [
      'hardhat', 'node',
      '--fork', rpcUrl,
      ...(blockNumber ? ['--fork-block-number', blockNumber] : []),
      '--hostname', '0.0.0.0',
      '--port', '8545'
    ], {
      stdio: 'inherit',
      env: { ...process.env }
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n\n🛑 Shutting down fork node...');
      forkProcess.kill('SIGINT');
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('\n\n🛑 Shutting down fork node...');
      forkProcess.kill('SIGTERM');
      process.exit(0);
    });

    forkProcess.on('close', (code) => {
      console.log(`\n✅ Fork node process exited with code ${code}`);
      process.exit(code || 0);
    });

    forkProcess.on('error', (error) => {
      console.error(`❌ Failed to start fork node: ${error.message}`);
      process.exit(1);
    });

  } catch (error: any) {
    console.error(`❌ Error starting fork node: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  startForkNode().catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

export { startForkNode };