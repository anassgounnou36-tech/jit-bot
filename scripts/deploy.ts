import { ethers } from "hardhat";
import { getAddressEnv, getEthAmountEnv, validateDeploymentEnv } from "./envUtils";

async function main() {
  console.log("🚀 Deploying JIT Executor contract...");

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const networkName = network.name === "unknown" ? "hardhat" : network.name;
  
  console.log("📝 Deploying contracts with account:", deployer.address);
  console.log("🌐 Network:", networkName);
  console.log("💰 Account balance:", ethers.utils.formatEther(await deployer.getBalance()), "ETH");

  // Validate environment variables early
  try {
    validateDeploymentEnv(networkName);
    console.log("✅ Environment validation passed");
  } catch (error: any) {
    console.error("❌ Environment validation failed:", error.message);
    process.exit(1);
  }

  // Deploy JitExecutor
  const JitExecutor = await ethers.getContractFactory("JitExecutor");
  
  // Get configuration from environment with proper validation and fallbacks
  let minProfitThreshold: ethers.BigNumber;
  let maxLoanSize: ethers.BigNumber;
  let profitRecipient: string;
  let positionManager: string;

  try {
    // Parse ETH amounts with validation
    minProfitThreshold = getEthAmountEnv("MIN_PROFIT_THRESHOLD", "0.01"); // 0.01 ETH default
    maxLoanSize = getEthAmountEnv("MAX_LOAN_SIZE", "1000"); // 1000 ETH default
    
    // Parse addresses with validation - use deployer address as fallback for profit recipient
    profitRecipient = getAddressEnv("PROFIT_RECIPIENT", deployer.address);
    positionManager = getAddressEnv("POSITION_MANAGER", "0xC36442b4a4522E871399CD717aBDD847Ab11FE88");
    
  } catch (error: any) {
    console.error("❌ Configuration parameter validation failed:", error.message);
    process.exit(1);
  }

  // Early diagnostic print of all constructor params BEFORE attempting deployment
  console.log("\n🔍 Constructor parameters validation:");
  console.log("   Min profit threshold:", ethers.utils.formatEther(minProfitThreshold), "ETH");
  console.log("   Max loan size:", ethers.utils.formatEther(maxLoanSize), "ETH");
  console.log("   Profit recipient:", profitRecipient);
  console.log("   Position manager:", positionManager);
  
  // Additional parameter validation
  if (minProfitThreshold.lte(0)) {
    console.error("❌ MIN_PROFIT_THRESHOLD must be positive");
    process.exit(1);
  }
  
  if (maxLoanSize.lte(0)) {
    console.error("❌ MAX_LOAN_SIZE must be positive");
    process.exit(1);
  }
  
  console.log("✅ All constructor parameters validated");

  try {
    console.log("\n🚀 Deploying contract...");
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
    
  } catch (error: any) {
    console.error("\n❌ Deployment failed with sanitized error:");
    
    // Provide helpful context for common errors
    if (error.message.includes('invalid address')) {
      console.error("🔍 Address validation error detected:");
      console.error("   - Check PROFIT_RECIPIENT environment variable");
      console.error("   - Check POSITION_MANAGER environment variable");
      console.error("   - Ensure addresses are valid Ethereum addresses");
    } else if (error.message.includes('insufficient funds')) {
      console.error("💰 Insufficient funds for deployment");
      console.error("   - Current balance:", ethers.utils.formatEther(await deployer.getBalance()), "ETH");
      console.error("   - Ensure deployer account has sufficient ETH");
    } else if (error.message.includes('network')) {
      console.error("🌐 Network connectivity error");
      console.error("   - Check ETHEREUM_RPC_URL or RPC_URL_HTTP");
      console.error("   - Verify network connectivity");
    }
    
    console.error("Full error:", error.message);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });