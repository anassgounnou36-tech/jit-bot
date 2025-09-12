import { ethers } from "hardhat";
import { SimpleJitExecutor } from "../typechain-types";

async function main() {
  console.log("🚀 Deploying JIT Executor contract...");

  const [deployer] = await ethers.getSigners();
  console.log("📝 Deploying contracts with account:", deployer.address);
  console.log("💰 Account balance:", ethers.utils.formatEther(await deployer.getBalance()), "ETH");

  // Deploy SimpleJitExecutor
  const SimpleJitExecutor = await ethers.getContractFactory("SimpleJitExecutor");
  
  const minProfitThreshold = ethers.utils.parseEther("0.01"); // 0.01 ETH
  const maxLoanSize = ethers.utils.parseEther("1000"); // 1000 ETH
  
  console.log("⚙️ Constructor parameters:");
  console.log("   Min profit threshold:", ethers.utils.formatEther(minProfitThreshold), "ETH");
  console.log("   Max loan size:", ethers.utils.formatEther(maxLoanSize), "ETH");

  const jitExecutor = await SimpleJitExecutor.deploy(
    minProfitThreshold,
    maxLoanSize
  );

  await jitExecutor.deployed();

  console.log("✅ SimpleJitExecutor deployed to:", jitExecutor.address);
  
  // Verify deployment
  console.log("🔍 Verifying deployment...");
  const owner = await jitExecutor.owner();
  const deployedMinProfit = await jitExecutor.minProfitThreshold();
  const deployedMaxLoan = await jitExecutor.maxLoanSize();
  const isPaused = await jitExecutor.paused();

  console.log("📊 Deployment verification:");
  console.log("   Owner:", owner);
  console.log("   Min profit threshold:", ethers.utils.formatEther(deployedMinProfit), "ETH");
  console.log("   Max loan size:", ethers.utils.formatEther(deployedMaxLoan), "ETH");
  console.log("   Paused:", isPaused);

  // Save deployment info
  const deploymentInfo = {
    network: ethers.provider.network?.name || "unknown",
    contractAddress: jitExecutor.address,
    deployerAddress: deployer.address,
    blockNumber: await ethers.provider.getBlockNumber(),
    timestamp: new Date().toISOString(),
    constructor: {
      minProfitThreshold: minProfitThreshold.toString(),
      maxLoanSize: maxLoanSize.toString()
    },
    txHash: jitExecutor.deployTransaction.hash
  };

  console.log("\n📄 Deployment info:");
  console.log(JSON.stringify(deploymentInfo, null, 2));

  // Instructions for next steps
  console.log("\n📋 Next steps:");
  console.log("1. Set JIT_CONTRACT_ADDRESS in your .env file:");
  console.log(`   JIT_CONTRACT_ADDRESS=${jitExecutor.address}`);
  console.log("2. Fund the contract with ETH for gas costs");
  console.log("3. Configure the bot with proper RPC endpoints");
  console.log("4. Start the bot with: npm run dev");

  if (ethers.provider.network?.name === "mainnet") {
    console.log("\n⚠️ MAINNET DEPLOYMENT DETECTED!");
    console.log("🔥 This contract will interact with real funds on Ethereum mainnet");
    console.log("🛡️ Make sure you understand the risks and have tested thoroughly");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });