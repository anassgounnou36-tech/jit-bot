import { ethers } from "ethers";
import { ForkSimulator } from "../src/fork/forkSimulator";
import { ReportGenerator } from "../src/fork/reportGenerator";
import config from "../config.json";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenv.config();

interface SimulationConfig {
  rpcUrl: string;
  blockNumber?: number;
  targetPools: string[];
  gasPrice?: string;
  swapSizes: {
    small: string;
    medium: string;
    whale: string;
  };
}

async function getLatestBlockNumber(provider: ethers.providers.JsonRpcProvider): Promise<number> {
  try {
    return await provider.getBlockNumber();
  } catch {
    // Fallback to a recent block if network is unavailable
    return 18500000;
  }
}

async function runForkSimulation() {
  console.log("🚀 Starting Fork Simulation for JIT LP Bot");
  console.log("==========================================");

  try {
    // Load configuration
    const rpcUrl = process.env.ETHEREUM_RPC_URL || "https://eth-mainnet.alchemyapi.io/v2/demo";
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    
    const simulationConfig: SimulationConfig = {
      rpcUrl,
      blockNumber: process.env.FORK_BLOCK_NUMBER ? parseInt(process.env.FORK_BLOCK_NUMBER) : undefined,
      targetPools: process.env.TARGET_POOLS?.split(',') || ['WETH-USDC-0.05%', 'ETH-USDT-0.3%', 'WBTC-ETH-0.3%'],
      gasPrice: process.env.SIMULATION_GAS_PRICE_GWEI || '20',
      swapSizes: {
        small: ethers.utils.parseEther("1").toString(),     // 1 ETH
        medium: ethers.utils.parseEther("10").toString(),   // 10 ETH
        whale: ethers.utils.parseEther("100").toString()    // 100 ETH
      }
    };

    // Get block number for fork
    const blockNumber = simulationConfig.blockNumber || await getLatestBlockNumber(provider);
    console.log(`📦 Using block number: ${blockNumber}`);

    // Initialize simulation components
    const forkSimulator = new ForkSimulator(simulationConfig.rpcUrl, blockNumber);
    const reportGenerator = new ReportGenerator();

    console.log(`🎯 Target pools: ${simulationConfig.targetPools.join(', ')}`);
    console.log(`⛽ Gas price: ${simulationConfig.gasPrice} gwei`);
    console.log(`💰 Swap sizes: Small=${ethers.utils.formatEther(simulationConfig.swapSizes.small)} ETH, Medium=${ethers.utils.formatEther(simulationConfig.swapSizes.medium)} ETH, Whale=${ethers.utils.formatEther(simulationConfig.swapSizes.whale)} ETH`);
    console.log("");

    const allResults: any[] = [];

    // Run simulations for each target pool
    for (const poolName of simulationConfig.targetPools) {
      const poolConfig = config.targets.find(t => t.pool === poolName);
      if (!poolConfig) {
        console.warn(`⚠️  Pool configuration not found for: ${poolName}`);
        continue;
      }

      console.log(`🔄 Simulating pool: ${poolName}`);
      console.log(`   Address: ${poolConfig.address}`);
      console.log(`   Fee tier: ${poolConfig.fee / 10000}%`);
      console.log("");

      // Test different swap sizes
      for (const [sizeLabel, amountIn] of Object.entries(simulationConfig.swapSizes)) {
        console.log(`  📊 Testing ${sizeLabel} swap (${ethers.utils.formatEther(amountIn)} ${poolConfig.symbol0})`);

        try {
          const result = await forkSimulator.simulateJitStrategy({
            pool: poolConfig.address,
            token0: poolConfig.token0,
            token1: poolConfig.token1,
            fee: poolConfig.fee,
            tickSpacing: poolConfig.tickSpacing,
            amountIn,
            tokenInSymbol: poolConfig.symbol0,
            tokenOutSymbol: poolConfig.symbol1,
            decimals0: poolConfig.decimals0,
            decimals1: poolConfig.decimals1,
            gasPrice: ethers.utils.parseUnits(simulationConfig.gasPrice || '20', 'gwei')
          });

          allResults.push({
            pool: poolName,
            blockNumber,
            swapSize: sizeLabel,
            amountIn: ethers.utils.formatEther(amountIn),
            tokenIn: poolConfig.symbol0,
            ...result
          });

          // Display results
          const profitIcon = result.profitable ? "✅" : "❌";
          const netProfitEth = ethers.utils.formatEther(result.netProfitEth);
          const netProfitUsdc = result.netProfitUsdc ? result.netProfitUsdc.toFixed(2) : "N/A";
          
          console.log(`     ${profitIcon} Profitable: ${result.profitable}`);
          console.log(`     💰 Net Profit: ${netProfitEth} ETH (~$${netProfitUsdc})`);
          console.log(`     ⛽ Gas Used: ${result.gasUsed.toLocaleString()}`);
          console.log(`     💸 Gas Cost: ${ethers.utils.formatEther(result.gasCostEth)} ETH`);
          console.log(`     🏦 LP Fees: ${ethers.utils.formatEther(result.lpFeesEth)} ETH`);
          
          if (result.reason) {
            console.log(`     📝 Reason: ${result.reason}`);
          }
          console.log("");

        } catch (error: any) {
          console.error(`     ❌ Simulation failed: ${error.message}`);
          
          allResults.push({
            pool: poolName,
            blockNumber,
            swapSize: sizeLabel,
            amountIn: ethers.utils.formatEther(amountIn),
            tokenIn: poolConfig.symbol0,
            profitable: false,
            netProfitEth: ethers.BigNumber.from(0),
            netProfitUsdc: 0,
            gasUsed: 0,
            gasCostEth: ethers.BigNumber.from(0),
            lpFeesEth: ethers.BigNumber.from(0),
            reason: `Error: ${error.message}`
          });
        }
      }
      console.log("");
    }

    // Generate reports
    console.log("📋 Generating simulation reports...");
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportDir = process.env.SIMULATION_REPORT_DIR || './reports';
    
    // Ensure reports directory exists
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    // Generate JSON report
    const jsonReportPath = path.join(reportDir, `simulation-${timestamp}.json`);
    await reportGenerator.generateJsonReport(allResults, jsonReportPath);
    
    // Generate console table
    reportGenerator.generateConsoleReport(allResults);
    
    // Generate summary
    const summary = reportGenerator.generateSummary(allResults);
    console.log("\n📊 Simulation Summary");
    console.log("====================");
    console.log(`Total simulations: ${summary.totalSimulations}`);
    console.log(`Profitable scenarios: ${summary.profitableCount} (${(summary.profitableCount / summary.totalSimulations * 100).toFixed(1)}%)`);
    console.log(`Total potential profit: ${ethers.utils.formatEther(summary.totalProfitEth)} ETH (~$${summary.totalProfitUsdc.toFixed(2)})`);
    console.log(`Average gas used: ${summary.averageGasUsed.toLocaleString()}`);
    console.log(`Best performing pool: ${summary.bestPool}`);
    console.log(`Best swap size: ${summary.bestSwapSize}`);
    
    console.log(`\n📄 Detailed report saved to: ${jsonReportPath}`);
    console.log("\n✅ Fork simulation completed successfully!");

  } catch (error: any) {
    console.error("\n❌ Fork simulation failed:", error.message);
    if (error.stack) {
      console.error("Stack trace:", error.stack);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  runForkSimulation().catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

export { runForkSimulation };