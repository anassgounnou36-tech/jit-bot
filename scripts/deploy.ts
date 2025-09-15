import { ethers } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  console.log("🚀 Deploying JIT Executor contract...");

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const networkName = network.name === "unknown" ? "hardhat" : network.name;
  
  console.log("📝 Deploying contracts with account:", deployer.address);
  console.log("🌐 Network:", networkName);
  console.log("💰 Account balance:", ethers.utils.formatEther(await deployer.getBalance()), "ETH");

  // Deploy JitExecutor
  const JitExecutor = await ethers.getContractFactory("JitExecutor");
  
  // Get configuration from environment or use defaults
  const minProfitThreshold = process.env.MIN_PROFIT_THRESHOLD 
    ? ethers.utils.parseEther(process.env.MIN_PROFIT_THRESHOLD)
    : ethers.utils.parseEther("0.01"); // 0.01 ETH
  const maxLoanSize = process.env.MAX_LOAN_SIZE 
    ? ethers.utils.parseEther(process.env.MAX_LOAN_SIZE)
    : ethers.utils.parseEther("1000"); // 1000 ETH
  const profitRecipient = process.env.PROFIT_RECIPIENT || deployer.address;
  const positionManager = process.env.POSITION_MANAGER || "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";

  console.log("⚙️ Constructor parameters:");
  console.log("   Min profit threshold:", ethers.utils.formatEther(minProfitThreshold), "ETH");
  console.log("   Max loan size:", ethers.utils.formatEther(maxLoanSize), "ETH");
  console.log("   Profit recipient:", profitRecipient);
  console.log("   Position manager:", positionManager);

  const jitExecutor = await JitExecutor.deploy(
    minProfitThreshold,
    maxLoanSize,
    profitRecipient,
    positionManager
  );

  await jitExecutor.deployed();

  console.log("✅ JitExecutor deployed to:", jitExecutor.address);
  
  // Verify deployment
  console.log("🔍 Verifying deployment...");
  const owner = await jitExecutor.owner();
  const deployedMinProfit = await jitExecutor.minProfitThreshold();
  const deployedMaxLoan = await jitExecutor.maxLoanSize();
  const deployedProfitRecipient = await jitExecutor.profitRecipient();
  const deployedPositionManager = await jitExecutor.positionManager();
  const isPaused = await jitExecutor.paused();

  console.log("📊 Deployment verification:");
  console.log("   Owner:", owner);
  console.log("   Min profit threshold:", ethers.utils.formatEther(deployedMinProfit), "ETH");
  console.log("   Max loan size:", ethers.utils.formatEther(deployedMaxLoan), "ETH");
  console.log("   Profit recipient:", deployedProfitRecipient);
  console.log("   Position manager:", deployedPositionManager);
  console.log("   Paused:", isPaused);

  // Save deployment info
  const deploymentInfo = {
    network: networkName,
    contractAddress: jitExecutor.address,
    deployerAddress: deployer.address,
    blockNumber: await ethers.provider.getBlockNumber(),
    timestamp: new Date().toISOString(),
    constructor: {
      minProfitThreshold: minProfitThreshold.toString(),
      maxLoanSize: maxLoanSize.toString(),
      profitRecipient: profitRecipient,
      positionManager: positionManager
    },
    txHash: jitExecutor.deployTransaction.hash
  };

  console.log("\n📄 Deployment info:");
  console.log(JSON.stringify(deploymentInfo, null, 2));

  // Contract verification (optional)
  if (process.env.VERIFY_CONTRACTS === "true" && process.env.ETHERSCAN_API_KEY) {
    console.log("\n🔍 Verifying contract on Etherscan...");
    try {
      // Wait for a few blocks before verification
      console.log("⏳ Waiting for block confirmations...");
      await jitExecutor.deployTransaction.wait(5);
      
      // Note: Actual verification would use hardhat-etherscan plugin
      // await hre.run("verify:verify", {
      //   address: jitExecutor.address,
      //   constructorArguments: [minProfitThreshold, maxLoanSize],
      // });
      console.log("✅ Contract verification would be initiated here");
      console.log("   (Requires hardhat-etherscan plugin configuration)");
    } catch (error: any) {
      console.error("❌ Verification failed:", error.message);
    }
  }

  // Instructions for next steps
  console.log("\n📋 Next steps:");
  console.log("1. Set JIT_EXECUTOR_ADDRESS in your .env file:");
  console.log(`   JIT_EXECUTOR_ADDRESS=${jitExecutor.address}`);
  console.log("2. Fund the contract with ETH for gas costs");
  console.log("3. Configure the bot with proper RPC endpoints");
  
  // Export line for easy copy-paste
  console.log("\n🔧 Export line for .env:");
  console.log(`JIT_EXECUTOR_ADDRESS=${jitExecutor.address}`);
  
  if (networkName === "fork") {
    console.log("4. Start the bot with: npm run dev");
    console.log("5. Run fork simulation: npm run fork:simulate");
  } else if (networkName === "mainnet") {
    console.log("4. Start the live bot with: npm run live");
    console.log("\n⚠️ MAINNET DEPLOYMENT DETECTED!");
    console.log("🔥 This contract will interact with real funds on Ethereum mainnet");
    console.log("🛡️ Make sure you understand the risks and have tested thoroughly");
  } else {
    console.log("4. Configure network and deploy to target environment");
  }

  // Network-specific recommendations
  if (networkName === "mainnet") {
    console.log("\n💡 Mainnet Safety Recommendations:");
    console.log("- Start with small profit thresholds");
    console.log("- Monitor gas prices carefully");
    console.log("- Have emergency pause procedures ready");
    console.log("- Set up proper monitoring and alerts");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });