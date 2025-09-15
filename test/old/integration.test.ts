import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { SimpleJitExecutor } from "../typechain-types";
// import { JitBot } from "../src/bot/index";
import { Metrics } from "../src/metrics/metrics";

describe("JIT Bot Integration Tests", function () {
  let simpleJitExecutor: SimpleJitExecutor;
  let owner: SignerWithAddress;
  let metrics: Metrics;

  beforeEach(async function () {
    [owner] = await ethers.getSigners();

    // Deploy contract
    const SimpleJitExecutorFactory = await ethers.getContractFactory("SimpleJitExecutor");
    const minProfitThreshold = ethers.utils.parseEther("0.01"); // 0.01 ETH
    const maxLoanSize = ethers.utils.parseEther("1000"); // 1000 ETH

    simpleJitExecutor = await SimpleJitExecutorFactory.deploy(
      minProfitThreshold,
      maxLoanSize
    );
    await simpleJitExecutor.deployed();

    // Initialize metrics
    metrics = new Metrics(3002, false); // Test port, simulation mode
  });

  describe("Contract Deployment", function () {
    it("Should deploy with correct parameters", async function () {
      expect(await simpleJitExecutor.owner()).to.equal(owner.address);
      expect(await simpleJitExecutor.minProfitThreshold()).to.equal(ethers.utils.parseEther("0.01"));
      expect(await simpleJitExecutor.maxLoanSize()).to.equal(ethers.utils.parseEther("1000"));
      expect(await simpleJitExecutor.paused()).to.equal(false);
    });

    it("Should have zero initial balance", async function () {
      const balance = await ethers.provider.getBalance(simpleJitExecutor.address);
      expect(balance).to.equal(0);
    });
  });

  describe("Fork Deployment Simulation", function () {
    it("Should simulate fork deployment successfully", async function () {
      // Set environment variables for fork deployment
      process.env.MIN_PROFIT_THRESHOLD = "0.005";
      process.env.MAX_LOAN_SIZE = "500";
      process.env.DEPLOYMENT_NETWORK = "fork";

      // Deploy new contract with environment parameters
      const SimpleJitExecutorFactory = await ethers.getContractFactory("SimpleJitExecutor");
      const minProfit = ethers.utils.parseEther(process.env.MIN_PROFIT_THRESHOLD);
      const maxLoan = ethers.utils.parseEther(process.env.MAX_LOAN_SIZE);

      const forkContract = await SimpleJitExecutorFactory.deploy(minProfit, maxLoan);
      await forkContract.deployed();

      expect(await forkContract.minProfitThreshold()).to.equal(ethers.utils.parseEther("0.005"));
      expect(await forkContract.maxLoanSize()).to.equal(ethers.utils.parseEther("500"));
    });
  });

  describe("JIT Execution Simulation", function () {
    it("Should simulate JIT execution correctly", async function () {
      const amount = ethers.utils.parseEther("100"); // 100 ETH
      const result = await simpleJitExecutor.simulateJit(amount);
      
      // Expected profit: 100 ETH / 1000 = 0.1 ETH
      const expectedProfit = amount.div(1000);
      expect(result).to.equal(expectedProfit);
    });

    it("Should reject amounts exceeding max loan size", async function () {
      const amount = ethers.utils.parseEther("1001"); // Exceeds 1000 ETH limit
      
      await expect(simpleJitExecutor.simulateJit(amount))
        .to.be.revertedWithCustomError(simpleJitExecutor, "LoanSizeExceeded");
    });

    it("Should reject amounts below profit threshold", async function () {
      const amount = ethers.utils.parseEther("5"); // 5 ETH -> 0.005 ETH profit < 0.01 ETH threshold
      
      await expect(simpleJitExecutor.simulateJit(amount))
        .to.be.revertedWithCustomError(simpleJitExecutor, "InsufficientProfit");
    });
  });

  describe("Emergency Features", function () {
    it("Should allow emergency pause", async function () {
      await simpleJitExecutor.setPaused(true);
      expect(await simpleJitExecutor.paused()).to.equal(true);

      const amount = ethers.utils.parseEther("100");
      await expect(simpleJitExecutor.simulateJit(amount))
        .to.be.revertedWithCustomError(simpleJitExecutor, "ExecutionPaused");
    });

    it("Should allow emergency unpause", async function () {
      await simpleJitExecutor.setPaused(true);
      await simpleJitExecutor.setPaused(false);
      expect(await simpleJitExecutor.paused()).to.equal(false);

      const amount = ethers.utils.parseEther("100");
      await expect(simpleJitExecutor.simulateJit(amount)).to.not.be.reverted;
    });

    it("Should allow emergency ETH withdrawal", async function () {
      // Send ETH to contract
      await owner.sendTransaction({
        to: simpleJitExecutor.address,
        value: ethers.utils.parseEther("1")
      });

      // const initialBalance = await owner.getBalance();
      const contractBalance = await ethers.provider.getBalance(simpleJitExecutor.address);
      
      expect(contractBalance).to.equal(ethers.utils.parseEther("1"));

      // Withdraw ETH
      await simpleJitExecutor.emergencyWithdraw(ethers.constants.AddressZero, contractBalance);
      
      const finalContractBalance = await ethers.provider.getBalance(simpleJitExecutor.address);
      expect(finalContractBalance).to.equal(0);
    });
  });

  describe("Configuration Updates", function () {
    it("Should allow configuration updates", async function () {
      const newMinProfit = ethers.utils.parseEther("0.02");
      const newMaxLoan = ethers.utils.parseEther("2000");

      await simpleJitExecutor.updateConfig(newMinProfit, newMaxLoan);

      expect(await simpleJitExecutor.minProfitThreshold()).to.equal(newMinProfit);
      expect(await simpleJitExecutor.maxLoanSize()).to.equal(newMaxLoan);
    });

    it("Should emit ConfigUpdated event", async function () {
      const newMinProfit = ethers.utils.parseEther("0.02");
      const newMaxLoan = ethers.utils.parseEther("2000");

      await expect(simpleJitExecutor.updateConfig(newMinProfit, newMaxLoan))
        .to.emit(simpleJitExecutor, "ConfigUpdated")
        .withArgs(newMinProfit, newMaxLoan);
    });
  });

  describe("Metrics Integration", function () {
    it("Should initialize metrics correctly", async function () {
      const initialMetrics = metrics.getMetrics();
      
      expect(initialMetrics.totalSwapsDetected).to.equal(0);
      expect(initialMetrics.totalBundlesSubmitted).to.equal(0);
      expect(initialMetrics.totalBundlesIncluded).to.equal(0);
      expect(initialMetrics.successRate).to.equal(0);
    });

    it("Should record swap detection", async function () {
      const opportunity = {
        timestamp: Date.now(),
        hash: "0x123",
        pool: "0xabc",
        amountIn: ethers.utils.parseEther("10").toString(),
        estimatedProfit: ethers.utils.parseEther("0.1").toString(),
        executed: false,
        profitable: true
      };

      metrics.recordSwapDetected(opportunity);
      
      const metricsData = metrics.getMetrics();
      expect(metricsData.totalSwapsDetected).to.equal(1);
    });

    it("Should record bundle execution", async function () {
      const bundleHash = "0x456";
      const profit = ethers.utils.parseEther("0.1");
      const gasSpent = ethers.utils.parseEther("0.01");

      metrics.recordBundleSubmitted(bundleHash);
      metrics.recordBundleIncluded(bundleHash, profit, gasSpent);
      
      const metricsData = metrics.getMetrics();
      expect(metricsData.totalBundlesSubmitted).to.equal(1);
      expect(metricsData.totalBundlesIncluded).to.equal(1);
      expect(metricsData.successRate).to.equal(1);
    });

    it("Should record live execution metrics", async function () {
      const liveMetrics = new Metrics(3003, true); // Live mode
      
      const execution = {
        timestamp: Date.now(),
        bundleHash: "0x789",
        profit: ethers.utils.parseEther("0.1"),
        gasUsed: ethers.utils.parseEther("0.001"),
        gasPrice: ethers.utils.parseUnits("50", "gwei"),
        success: true,
        blockNumber: 18000000
      };

      liveMetrics.recordLiveExecution(execution);
      
      const metricsData = liveMetrics.getMetrics();
      expect(metricsData.liveExecutions).to.equal(1);
      expect(parseFloat(metricsData.realizedProfitEth)).to.be.greaterThan(0);
    });
  });

  describe("Full Deploy → Simulate → Execute Loop", function () {
    it("Should complete full simulation cycle", async function () {
      // 1. Deploy contract ✅ (done in beforeEach)
      expect(simpleJitExecutor.address).to.not.equal(ethers.constants.AddressZero);

      // 2. Simulate JIT execution
      const amount = ethers.utils.parseEther("100");
      const simulationResult = await simpleJitExecutor.simulateJit(amount);
      expect(simulationResult).to.equal(amount.div(1000));

      // 3. Record metrics
      const opportunity = {
        timestamp: Date.now(),
        hash: "0xtest",
        pool: "0xpool",
        amountIn: amount.toString(),
        estimatedProfit: simulationResult.toString(),
        executed: true,
        profitable: true
      };

      metrics.recordSwapDetected(opportunity);
      metrics.recordBundleSubmitted("0xbundle");
      metrics.recordBundleIncluded("0xbundle", simulationResult, ethers.utils.parseEther("0.001"));

      // 4. Verify complete cycle
      const metricsData = metrics.getMetrics();
      expect(metricsData.totalSwapsDetected).to.equal(1);
      expect(metricsData.totalBundlesIncluded).to.equal(1);
      expect(metricsData.successRate).to.equal(1);
    });

    it("Should handle stuck funds scenario", async function () {
      // Send funds to contract
      await owner.sendTransaction({
        to: simpleJitExecutor.address,
        value: ethers.utils.parseEther("1")
      });

      // Verify funds are stuck
      const contractBalance = await ethers.provider.getBalance(simpleJitExecutor.address);
      expect(contractBalance).to.equal(ethers.utils.parseEther("1"));

      // Emergency withdraw should work
      await simpleJitExecutor.emergencyWithdraw(
        ethers.constants.AddressZero, 
        contractBalance
      );

      // Verify funds recovered
      const finalBalance = await ethers.provider.getBalance(simpleJitExecutor.address);
      expect(finalBalance).to.equal(0);
    });
  });

  describe("Error Handling", function () {
    it("Should track simulation failures", async function () {
      metrics.recordSimulationFailure("Insufficient liquidity");
      
      const metricsData = metrics.getMetrics();
      expect(metricsData.simulationFailures).to.equal(1);
    });

    it("Should track bundle rejections", async function () {
      metrics.recordBundleRejection("Gas price too high");
      
      const metricsData = metrics.getMetrics();
      expect(metricsData.bundleRejections).to.equal(1);
    });

    it("Should track execution errors", async function () {
      metrics.recordExecutionError("Transaction reverted");
      
      const metricsData = metrics.getMetrics();
      expect(metricsData.executionErrors).to.equal(1);
    });
  });

  afterEach(async function () {
    // Clean up environment
    delete process.env.MIN_PROFIT_THRESHOLD;
    delete process.env.MAX_LOAN_SIZE;
    delete process.env.DEPLOYMENT_NETWORK;
    
    // Stop metrics server if running
    try {
      metrics.stop();
    } catch (e) {
      // Ignore if already stopped
    }
  });
});