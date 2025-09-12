import { ethers } from "ethers";
import { MempoolWatcher } from "../src/watcher/mempoolWatcher";
import { Simulator } from "../src/watcher/simulator";
import config from "../config.json";
import * as dotenv from "dotenv";

dotenv.config();

async function simulateExample() {
  console.log("🧪 Running JIT simulation example...");

  try {
    // Setup
    const rpcUrl = process.env.ETHEREUM_RPC_URL || "https://eth-mainnet.alchemyapi.io/v2/demo";
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const simulator = new Simulator(rpcUrl);

    console.log("📡 Connected to Ethereum mainnet");
    const blockNumber = await provider.getBlockNumber();
    console.log("📊 Current block:", blockNumber);

    // Example large swap (simulated)
    const exampleSwap = {
      hash: "0x1234567890abcdef1234567890abcdef12345678",
      from: "0x742428888Ff5d84eA8E4b7DF5F9c4f00A9c7B7ce",
      to: "0xE592427A0AEce92De3Edee1F18E0157C05861564", // Uniswap V3 Router
      value: "0",
      data: "0x414bf389", // exactInputSingle selector
      gasPrice: "20000000000", // 20 gwei
      gasLimit: "300000",
      nonce: 100,
      pool: config.targets[0].address, // WETH-USDC pool
      tokenIn: config.targets[0].token0,
      tokenOut: config.targets[0].token1,
      amountIn: ethers.utils.parseEther("50").toString(), // 50 ETH swap
      amountOutMinimum: "0",
      expectedPrice: "0",
      estimatedProfit: "0"
    };

    console.log("🎯 Example swap details:");
    console.log("   Amount in:", ethers.utils.formatEther(exampleSwap.amountIn), "ETH");
    console.log("   Pool:", exampleSwap.pool);
    console.log("   Gas price:", ethers.utils.formatUnits(exampleSwap.gasPrice, "gwei"), "gwei");

    // Calculate JIT parameters
    const jitParams = {
      pool: exampleSwap.pool,
      token0: config.targets[0].token0,
      token1: config.targets[0].token1,
      fee: config.targets[0].fee,
      tickLower: -887220, // Full range for example
      tickUpper: 887220,
      amount0: ethers.utils.parseEther("25").toString(), // 25 ETH
      amount1: ethers.utils.parseEther("25").toString(), // 25 ETH
      deadline: Math.floor(Date.now() / 1000) + 300
    };

    console.log("⚙️ JIT parameters:");
    console.log("   Tick range:", jitParams.tickLower, "to", jitParams.tickUpper);
    console.log("   Amount0:", ethers.utils.formatEther(jitParams.amount0), "ETH");
    console.log("   Amount1:", ethers.utils.formatEther(jitParams.amount1), "ETH");

    // Run simulation
    console.log("🔄 Running simulation...");
    const simulationResult = await simulator.simulateJitBundle(exampleSwap, jitParams);

    console.log("📈 Simulation results:");
    console.log("   Profitable:", simulationResult.profitable ? "✅ YES" : "❌ NO");
    console.log("   Estimated profit:", ethers.utils.formatEther(simulationResult.estimatedProfit), "ETH");
    console.log("   Gas used:", simulationResult.gasUsed.toString());
    console.log("   Gas price:", ethers.utils.formatUnits(simulationResult.gasPrice, "gwei"), "gwei");
    console.log("   Flash loan fees:", ethers.utils.formatEther(simulationResult.flashLoanFees), "ETH");
    console.log("   Net profit:", ethers.utils.formatEther(simulationResult.netProfit), "ETH");

    if (simulationResult.reason) {
      console.log("   Reason:", simulationResult.reason);
    }

    // Calculate additional metrics
    const profitMargin = simulationResult.netProfit.mul(100).div(exampleSwap.amountIn);
    const costBreakdown = simulationResult.gasUsed.mul(simulationResult.gasPrice);

    console.log("📊 Additional metrics:");
    console.log("   Profit margin:", profitMargin.toString(), "basis points");
    console.log("   Gas cost:", ethers.utils.formatEther(costBreakdown), "ETH");
    console.log("   Break-even gas price:", simulationResult.estimatedProfit.div(simulationResult.gasUsed).toString(), "wei");

    // Test different scenarios
    console.log("\n🔬 Testing different scenarios...");

    // Scenario 1: Smaller swap
    const smallSwap = { ...exampleSwap, amountIn: ethers.utils.parseEther("5").toString() };
    const smallResult = await simulator.simulateJitBundle(smallSwap, {
      ...jitParams,
      amount0: ethers.utils.parseEther("2.5").toString(),
      amount1: ethers.utils.parseEther("2.5").toString()
    });
    console.log("   Small swap (5 ETH):", smallResult.profitable ? "Profitable" : "Not profitable");

    // Scenario 2: Higher gas price
    const highGasSwap = { ...exampleSwap, gasPrice: "100000000000" }; // 100 gwei
    const highGasResult = await simulator.simulateJitBundle(highGasSwap, jitParams);
    console.log("   High gas (100 gwei):", highGasResult.profitable ? "Profitable" : "Not profitable");

    // Scenario 3: Different tick range
    const narrowJitParams = {
      ...jitParams,
      tickLower: -6932, // Narrower range
      tickUpper: 6932
    };
    const narrowResult = await simulator.simulateJitBundle(exampleSwap, narrowJitParams);
    console.log("   Narrow tick range:", narrowResult.profitable ? "Profitable" : "Not profitable");

    console.log("\n✅ Simulation example completed successfully!");

  } catch (error) {
    console.error("❌ Simulation failed:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  simulateExample().catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}