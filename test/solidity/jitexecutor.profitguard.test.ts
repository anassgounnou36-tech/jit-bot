import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("JitExecutor - Profit Guard and Callbacks", function () {
  let jitExecutor: Contract;
  let owner: SignerWithAddress;
  let profitRecipient: SignerWithAddress;
  let user: SignerWithAddress;
  let mockToken: Contract;
  let mockPositionManager: Contract;

  // Constants
  const MIN_PROFIT_THRESHOLD = ethers.utils.parseEther("0.01"); // 0.01 ETH
  const MAX_LOAN_SIZE = ethers.utils.parseEther("100"); // 100 ETH
  const POSITION_MANAGER_ADDRESS = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88"; // Uniswap V3 NonfungiblePositionManager

  beforeEach(async function () {
    [owner, profitRecipient, user] = await ethers.getSigners();

    // Deploy mock ERC20 token
    const MockToken = await ethers.getContractFactory("MockERC20");
    mockToken = await MockToken.deploy("Test Token", "TEST", 18);
    await mockToken.deployed();

    // For testing, we'll use a mock position manager to avoid complex Uniswap interactions
    const MockPositionManager = await ethers.getContractFactory("MockPositionManager");
    mockPositionManager = await MockPositionManager.deploy();
    await mockPositionManager.deployed();

    // Deploy JitExecutor with mock position manager for isolated testing
    const JitExecutor = await ethers.getContractFactory("JitExecutor");
    jitExecutor = await JitExecutor.deploy(
      MIN_PROFIT_THRESHOLD,
      MAX_LOAN_SIZE,
      profitRecipient.address,
      mockPositionManager.address
    );
    await jitExecutor.deployed();

    // Mint tokens to executor for testing
    await mockToken.mint(jitExecutor.address, ethers.utils.parseEther("1000"));
  });

  describe("Initialization", function () {
    it("should initialize with correct parameters", async function () {
      const config = await jitExecutor.getConfiguration();
      expect(config._minProfitThreshold).to.equal(MIN_PROFIT_THRESHOLD);
      expect(config._maxLoanSize).to.equal(MAX_LOAN_SIZE);
      expect(config._profitRecipient).to.equal(profitRecipient.address);
      expect(config._paused).to.equal(false);
    });

    it("should set correct owner", async function () {
      expect(await jitExecutor.owner()).to.equal(owner.address);
    });

    it("should reject zero address for profit recipient", async function () {
      const JitExecutor = await ethers.getContractFactory("JitExecutor");
      await expect(
        JitExecutor.deploy(
          MIN_PROFIT_THRESHOLD,
          MAX_LOAN_SIZE,
          ethers.constants.AddressZero,
          mockPositionManager.address
        )
      ).to.be.revertedWith("InvalidProfitRecipient");
    });
  });

  describe("Balancer Flashloan Callback", function () {
    it("should execute Balancer flashloan callback successfully with sufficient profit", async function () {
      const flashloanAmount = ethers.utils.parseEther("10");
      const feeAmount = ethers.utils.parseEther("0.001"); // 0.1% fee
      const userData = ethers.utils.defaultAbiCoder.encode(
        ["address", "int24", "int24"],
        [mockToken.address, -1000, 1000]
      );

      // Mock position manager to return profitable amounts
      const profitableAmount = flashloanAmount.add(feeAmount).add(MIN_PROFIT_THRESHOLD).add(ethers.utils.parseEther("0.1"));
      await mockPositionManager.setMintReturn(1, 100, profitableAmount, 0);
      await mockPositionManager.setCollectReturn(profitableAmount, 0);

      // Simulate Balancer calling receiveFlashLoan
      await expect(
        jitExecutor.receiveFlashLoan(
          [mockToken.address],
          [flashloanAmount],
          [feeAmount],
          userData
        )
      ).to.emit(jitExecutor, "JitExecuted");
    });

    it("should revert Balancer flashloan callback with insufficient profit", async function () {
      const flashloanAmount = ethers.utils.parseEther("10");
      const feeAmount = ethers.utils.parseEther("0.001");
      const userData = ethers.utils.defaultAbiCoder.encode(
        ["address", "int24", "int24"],
        [mockToken.address, -1000, 1000]
      );

      // Mock position manager to return insufficient amounts
      const insufficientAmount = flashloanAmount.add(feeAmount).sub(ethers.utils.parseEther("0.001"));
      await mockPositionManager.setMintReturn(1, 100, insufficientAmount, 0);
      await mockPositionManager.setCollectReturn(insufficientAmount, 0);

      await expect(
        jitExecutor.receiveFlashLoan(
          [mockToken.address],
          [flashloanAmount],
          [feeAmount],
          userData
        )
      ).to.be.revertedWith("InsufficientProfit");
    });

    it("should reject multi-token Balancer flashloan", async function () {
      const flashloanAmount = ethers.utils.parseEther("10");
      const feeAmount = ethers.utils.parseEther("0.001");
      const userData = ethers.utils.defaultAbiCoder.encode(
        ["address", "int24", "int24"],
        [mockToken.address, -1000, 1000]
      );

      await expect(
        jitExecutor.receiveFlashLoan(
          [mockToken.address, mockToken.address], // Multiple tokens
          [flashloanAmount, flashloanAmount],
          [feeAmount, feeAmount],
          userData
        )
      ).to.be.revertedWith("Single token flashloan only");
    });
  });

  describe("Aave Flashloan Callback", function () {
    it("should execute Aave flashloan callback successfully with sufficient profit", async function () {
      const flashloanAmount = ethers.utils.parseEther("10");
      const premium = ethers.utils.parseEther("0.005"); // 0.05% fee
      const params = ethers.utils.defaultAbiCoder.encode(
        ["address", "int24", "int24"],
        [mockToken.address, -1000, 1000]
      );

      // Mock position manager to return profitable amounts
      const profitableAmount = flashloanAmount.add(premium).add(MIN_PROFIT_THRESHOLD).add(ethers.utils.parseEther("0.1"));
      await mockPositionManager.setMintReturn(1, 100, profitableAmount, 0);
      await mockPositionManager.setCollectReturn(profitableAmount, 0);

      // Simulate Aave calling executeOperation
      const result = await jitExecutor.executeOperation(
        [mockToken.address],
        [flashloanAmount],
        [premium],
        jitExecutor.address, // initiator
        params
      );

      expect(result).to.be.true;
    });

    it("should revert Aave flashloan callback with insufficient profit", async function () {
      const flashloanAmount = ethers.utils.parseEther("10");
      const premium = ethers.utils.parseEther("0.005");
      const params = ethers.utils.defaultAbiCoder.encode(
        ["address", "int24", "int24"],
        [mockToken.address, -1000, 1000]
      );

      // Mock position manager to return insufficient amounts
      const insufficientAmount = flashloanAmount.add(premium).sub(ethers.utils.parseEther("0.001"));
      await mockPositionManager.setMintReturn(1, 100, insufficientAmount, 0);
      await mockPositionManager.setCollectReturn(insufficientAmount, 0);

      await expect(
        jitExecutor.executeOperation(
          [mockToken.address],
          [flashloanAmount],
          [premium],
          jitExecutor.address,
          params
        )
      ).to.be.revertedWith("InsufficientProfit");
    });

    it("should reject unauthorized Aave flashloan initiator", async function () {
      const flashloanAmount = ethers.utils.parseEther("10");
      const premium = ethers.utils.parseEther("0.005");
      const params = ethers.utils.defaultAbiCoder.encode(
        ["address", "int24", "int24"],
        [mockToken.address, -1000, 1000]
      );

      await expect(
        jitExecutor.executeOperation(
          [mockToken.address],
          [flashloanAmount],
          [premium],
          user.address, // Wrong initiator
          params
        )
      ).to.be.revertedWith("Unauthorized initiator");
    });

    it("should reject multi-asset Aave flashloan", async function () {
      const flashloanAmount = ethers.utils.parseEther("10");
      const premium = ethers.utils.parseEther("0.005");
      const params = ethers.utils.defaultAbiCoder.encode(
        ["address", "int24", "int24"],
        [mockToken.address, -1000, 1000]
      );

      await expect(
        jitExecutor.executeOperation(
          [mockToken.address, mockToken.address], // Multiple assets
          [flashloanAmount, flashloanAmount],
          [premium, premium],
          jitExecutor.address,
          params
        )
      ).to.be.revertedWith("Single asset flashloan only");
    });
  });

  describe("Profit Guard Validation", function () {
    it("should enforce minimum profit threshold", async function () {
      const newMinProfit = ethers.utils.parseEther("0.05"); // 0.05 ETH
      await jitExecutor.setMinProfit(newMinProfit);

      const flashloanAmount = ethers.utils.parseEther("10");
      const feeAmount = ethers.utils.parseEther("0.001");
      const userData = ethers.utils.defaultAbiCoder.encode(
        ["address", "int24", "int24"],
        [mockToken.address, -1000, 1000]
      );

      // Return amount just below new threshold
      const belowThresholdAmount = flashloanAmount.add(feeAmount).add(newMinProfit).sub(1);
      await mockPositionManager.setMintReturn(1, 100, belowThresholdAmount, 0);
      await mockPositionManager.setCollectReturn(belowThresholdAmount, 0);

      await expect(
        jitExecutor.receiveFlashLoan(
          [mockToken.address],
          [flashloanAmount],
          [feeAmount],
          userData
        )
      ).to.be.revertedWith("InsufficientProfit");
    });

    it("should transfer profit to recipient", async function () {
      const flashloanAmount = ethers.utils.parseEther("10");
      const feeAmount = ethers.utils.parseEther("0.001");
      const userData = ethers.utils.defaultAbiCoder.encode(
        ["address", "int24", "int24"],
        [mockToken.address, -1000, 1000]
      );

      const profit = ethers.utils.parseEther("0.5");
      const totalReturn = flashloanAmount.add(feeAmount).add(MIN_PROFIT_THRESHOLD).add(profit);
      await mockPositionManager.setMintReturn(1, 100, totalReturn, 0);
      await mockPositionManager.setCollectReturn(totalReturn, 0);

      const initialBalance = await mockToken.balanceOf(profitRecipient.address);
      
      await jitExecutor.receiveFlashLoan(
        [mockToken.address],
        [flashloanAmount],
        [feeAmount],
        userData
      );

      const finalBalance = await mockToken.balanceOf(profitRecipient.address);
      expect(finalBalance.sub(initialBalance)).to.equal(profit);
    });

    it("should emit JitRejected event for insufficient profit", async function () {
      const flashloanAmount = ethers.utils.parseEther("10");
      const feeAmount = ethers.utils.parseEther("0.001");
      const userData = ethers.utils.defaultAbiCoder.encode(
        ["address", "int24", "int24"],
        [mockToken.address, -1000, 1000]
      );

      const insufficientAmount = flashloanAmount.add(feeAmount);
      await mockPositionManager.setMintReturn(1, 100, insufficientAmount, 0);
      await mockPositionManager.setCollectReturn(insufficientAmount, 0);

      await expect(
        jitExecutor.receiveFlashLoan(
          [mockToken.address],
          [flashloanAmount],
          [feeAmount],
          userData
        )
      ).to.emit(jitExecutor, "JitRejected");
    });
  });

  describe("Admin Controls", function () {
    it("should pause and unpause execution", async function () {
      await jitExecutor.pause();
      expect((await jitExecutor.getConfiguration())._paused).to.be.true;

      // Should revert when paused
      const flashloanAmount = ethers.utils.parseEther("10");
      const feeAmount = ethers.utils.parseEther("0.001");
      const userData = ethers.utils.defaultAbiCoder.encode(
        ["address", "int24", "int24"],
        [mockToken.address, -1000, 1000]
      );

      await expect(
        jitExecutor.receiveFlashLoan(
          [mockToken.address],
          [flashloanAmount],
          [feeAmount],
          userData
        )
      ).to.be.revertedWith("ExecutionPaused");

      // Unpause
      await jitExecutor.unpause();
      expect((await jitExecutor.getConfiguration())._paused).to.be.false;
    });

    it("should update profit recipient", async function () {
      const newRecipient = user.address;
      await expect(jitExecutor.setProfitRecipient(newRecipient))
        .to.emit(jitExecutor, "ProfitRecipientUpdated")
        .withArgs(profitRecipient.address, newRecipient);

      expect((await jitExecutor.getConfiguration())._profitRecipient).to.equal(newRecipient);
    });

    it("should reject zero address as profit recipient", async function () {
      await expect(
        jitExecutor.setProfitRecipient(ethers.constants.AddressZero)
      ).to.be.revertedWith("InvalidProfitRecipient");
    });

    it("should allow emergency withdrawal", async function () {
      const withdrawAmount = ethers.utils.parseEther("10");
      const initialBalance = await mockToken.balanceOf(owner.address);

      await jitExecutor.emergencyWithdraw(mockToken.address, withdrawAmount);

      const finalBalance = await mockToken.balanceOf(owner.address);
      expect(finalBalance.sub(initialBalance)).to.equal(withdrawAmount);
    });

    it("should validate configuration updates", async function () {
      const newMinProfit = ethers.utils.parseEther("0.05");
      const newMaxLoan = ethers.utils.parseEther("200");

      await expect(jitExecutor.updateConfig(newMinProfit, newMaxLoan))
        .to.emit(jitExecutor, "ConfigUpdated")
        .withArgs(newMinProfit, newMaxLoan);

      const config = await jitExecutor.getConfiguration();
      expect(config._minProfitThreshold).to.equal(newMinProfit);
      expect(config._maxLoanSize).to.equal(newMaxLoan);
    });

    it("should reject invalid configuration", async function () {
      const invalidMinProfit = ethers.utils.parseEther("2"); // More than 1% of loan size
      const maxLoan = ethers.utils.parseEther("100");

      await expect(
        jitExecutor.updateConfig(invalidMinProfit, maxLoan)
      ).to.be.revertedWith("Min profit too high");
    });

    it("should transfer ownership securely", async function () {
      await expect(jitExecutor.setOwner(user.address))
        .to.emit(jitExecutor, "OwnershipTransferRequested")
        .withArgs(owner.address, user.address);

      expect(await jitExecutor.owner()).to.equal(user.address);
    });

    it("should reject ownership transfer to zero address", async function () {
      await expect(
        jitExecutor.setOwner(ethers.constants.AddressZero)
      ).to.be.revertedWith("Invalid new owner");
    });

    it("should reject ownership transfer to current owner", async function () {
      await expect(
        jitExecutor.setOwner(owner.address)
      ).to.be.revertedWith("Already the owner");
    });
  });

  describe("View Functions", function () {
    it("should return position manager address", async function () {
      expect(await jitExecutor.getPositionManager()).to.equal(mockPositionManager.address);
    });

    it("should report no active flashloan initially", async function () {
      expect(await jitExecutor.isFlashloanActive()).to.be.false;
    });

    it("should reject getting context when no flashloan is active", async function () {
      await expect(jitExecutor.getCurrentFlashloanContext()).to.be.revertedWith("No active flashloan");
    });
  });

  describe("Access Control", function () {
    it("should restrict admin functions to owner", async function () {
      await expect(jitExecutor.connect(user).pause()).to.be.revertedWith("Ownable: caller is not the owner");
      await expect(jitExecutor.connect(user).setMinProfit(ethers.utils.parseEther("0.1"))).to.be.revertedWith("Ownable: caller is not the owner");
      await expect(jitExecutor.connect(user).setProfitRecipient(user.address)).to.be.revertedWith("Ownable: caller is not the owner");
      await expect(jitExecutor.connect(user).emergencyWithdraw(mockToken.address, 100)).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });
});

// Mock contracts for testing
// Note: These would need to be implemented as separate Solidity contracts for actual testing
contract("MockERC20", function () {
  // Implementation would go here
});

contract("MockPositionManager", function () {
  // Implementation would go here
});