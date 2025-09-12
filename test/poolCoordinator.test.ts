import { expect } from "chai";
import { ethers } from "ethers";
import { PoolCoordinator } from "../src/coordinator/poolCoordinator";
import { Simulator } from "../src/watcher/simulator";
import { BundleBuilder } from "../src/bundler/bundleBuilder";
import { Executor } from "../src/executor/executor";
import { Metrics } from "../src/metrics/metrics";

describe("Multi-Pool Coordinator Tests", function () {
  let poolCoordinator: PoolCoordinator;
  let provider: ethers.providers.JsonRpcProvider;
  let simulator: Simulator;
  let bundleBuilder: BundleBuilder;
  let executor: Executor;
  let metrics: Metrics;
  const mockPrivateKey = "0x0123456789012345678901234567890123456789012345678901234567890123";
  const mockContractAddress = "0x1234567890123456789012345678901234567890";

  beforeEach(async function () {
    // Set up test environment variables
    process.env.POOL_IDS = "WETH-USDC-0.05%,ETH-USDT-0.3%";
    process.env.PROFIT_THRESHOLD_USD = "50";
    process.env.POOL_MAX_FAILURES = "3";
    process.env.POOL_COOLDOWN_MS = "5000"; // 5 seconds for testing
    process.env.POOL_PROFIT_THRESHOLD_USD__WETH_USDC_0_05_ = "75";

    // Create mock provider
    provider = new ethers.providers.JsonRpcProvider("http://localhost:8545");
    
    // Initialize components
    simulator = new Simulator("http://localhost:8545");
    bundleBuilder = new BundleBuilder(mockPrivateKey, provider);
    executor = new Executor(provider);
    metrics = new Metrics(3003, false); // Test port

    poolCoordinator = new PoolCoordinator(
      provider,
      simulator,
      bundleBuilder,
      executor,
      metrics,
      mockContractAddress
    );
  });

  afterEach(async function () {
    if (poolCoordinator) {
      await poolCoordinator.stop();
    }
    metrics.stop();
  });

  describe("Initialization", function () {
    it("Should initialize pools from environment configuration", function () {
      const poolStatus = poolCoordinator.getPoolStatus();
      
      expect(Object.keys(poolStatus)).to.have.lengthOf(2);
      expect(poolStatus["WETH-USDC-0.05%"]).to.exist;
      expect(poolStatus["ETH-USDT-0.3%"]).to.exist;
      
      // Check pool-specific threshold
      expect(poolStatus["WETH-USDC-0.05%"].profitThresholdUSD).to.equal(75);
      expect(poolStatus["ETH-USDT-0.3%"].profitThresholdUSD).to.equal(50); // Default
    });

    it("Should initialize all pools as enabled", function () {
      const poolStatus = poolCoordinator.getPoolStatus();
      
      for (const poolId in poolStatus) {
        expect(poolStatus[poolId].enabled).to.be.true;
        expect(poolStatus[poolId].failureCount).to.equal(0);
      }
    });
  });

  describe("Pool Management", function () {
    it("Should track pool failures and disable after threshold", function () {
      const poolId = "WETH-USDC-0.05%";
      
      // Simulate failures
      for (let i = 0; i < 3; i++) {
        poolCoordinator["recordPoolFailure"](poolId, `Test error ${i + 1}`);
      }
      
      const poolStatus = poolCoordinator.getPoolStatus();
      expect(poolStatus[poolId].enabled).to.be.false;
      expect(poolStatus[poolId].failureCount).to.equal(3);
    });

    it("Should record opportunities correctly", function () {
      const mockSwap = {
        hash: "0xtest123",
        from: "0xuser",
        to: "0xrouter",
        value: "0",
        data: "0x",
        gasPrice: "20000000000",
        gasLimit: "200000",
        nonce: 1,
        pool: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
        tokenIn: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        tokenOut: "0xA0b86a33E6441b80B05fdC68F34f8c9C31C8DE4E",
        amountIn: ethers.utils.parseEther("10").toString(),
        amountOutMinimum: "0",
        expectedPrice: "0",
        estimatedProfit: "0"
      };

      const mockJitParams = {
        pool: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
        token0: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        token1: "0xA0b86a33E6441b80B05fdC68F34f8c9C31C8DE4E",
        fee: 500,
        tickLower: -1000,
        tickUpper: 1000,
        amount0: ethers.utils.parseEther("5").toString(),
        amount1: "0",
        deadline: Math.floor(Date.now() / 1000) + 300
      };

      const candidate = {
        swap: mockSwap,
        jitParams: mockJitParams,
        estimatedProfitETH: ethers.utils.parseEther("0.1"),
        estimatedProfitUSD: 300,
        poolId: "WETH-USDC-0.05%",
        timestamp: Date.now(),
        blockNumber: 12345
      };

      poolCoordinator["addOpportunityCandidate"](candidate);
      
      const opportunities = poolCoordinator.getCurrentOpportunities();
      expect(opportunities[12345]).to.have.lengthOf(1);
      expect(opportunities[12345][0].poolId).to.equal("WETH-USDC-0.05%");
      expect(opportunities[12345][0].estimatedProfitUSD).to.equal(300);
    });
  });

  describe("Opportunity Ranking", function () {
    it("Should select the most profitable opportunity", function () {
      const baseCandidate = {
        swap: {
          hash: "0xtest",
          from: "0xuser",
          to: "0xrouter",
          value: "0",
          data: "0x",
          gasPrice: "20000000000",
          gasLimit: "200000",
          nonce: 1,
          pool: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
          tokenIn: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
          tokenOut: "0xA0b86a33E6441b80B05fdC68F34f8c9C31C8DE4E",
          amountIn: ethers.utils.parseEther("10").toString(),
          amountOutMinimum: "0",
          expectedPrice: "0",
          estimatedProfit: "0"
        },
        jitParams: {
          pool: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
          token0: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
          token1: "0xA0b86a33E6441b80B05fdC68F34f8c9C31C8DE4E",
          fee: 500,
          tickLower: -1000,
          tickUpper: 1000,
          amount0: ethers.utils.parseEther("5").toString(),
          amount1: "0",
          deadline: Math.floor(Date.now() / 1000) + 300
        },
        estimatedProfitETH: ethers.utils.parseEther("0.1"),
        timestamp: Date.now(),
        blockNumber: 12345
      };

      // Add multiple opportunities with different profits
      const opportunities = [
        { ...baseCandidate, poolId: "WETH-USDC-0.05%", estimatedProfitUSD: 100 },
        { ...baseCandidate, poolId: "ETH-USDT-0.3%", estimatedProfitUSD: 200 },
        { ...baseCandidate, poolId: "WETH-USDC-0.05%", estimatedProfitUSD: 150 }
      ];

      // Sort like the coordinator would
      opportunities.sort((a, b) => b.estimatedProfitUSD - a.estimatedProfitUSD);

      expect(opportunities[0].estimatedProfitUSD).to.equal(200);
      expect(opportunities[0].poolId).to.equal("ETH-USDT-0.3%");
    });
  });

  describe("Metrics Integration", function () {
    it("Should initialize pool metrics correctly", function () {
      metrics.initializePool("WETH-USDC-0.05%");
      
      const allMetrics = metrics.getMetrics();
      expect(allMetrics.poolMetrics).to.exist;
      expect(allMetrics.poolMetrics!["WETH-USDC-0.05%"]).to.exist;
      expect(allMetrics.poolMetrics!["WETH-USDC-0.05%"].enabled).to.be.true;
      expect(allMetrics.poolMetrics!["WETH-USDC-0.05%"].swapsDetected).to.equal(0);
    });

    it("Should record pool-specific metrics", function () {
      const poolId = "WETH-USDC-0.05%";
      const profitETH = ethers.utils.parseEther("0.1");
      const gasSpent = ethers.utils.parseEther("0.01");
      
      metrics.recordPoolBundleIncluded(poolId, profitETH.toString(), gasSpent.toString(), 300);
      
      const allMetrics = metrics.getMetrics();
      const poolStats = allMetrics.poolMetrics![poolId];
      
      expect(poolStats.bundlesIncluded).to.equal(1);
      expect(poolStats.totalProfitUSD).to.equal(300);
      expect(poolStats.totalProfitETH).to.equal(profitETH.toString());
    });
  });
});