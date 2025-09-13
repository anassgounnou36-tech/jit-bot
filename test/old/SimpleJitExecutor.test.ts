import { expect } from "chai";
import { ethers } from "hardhat";
import { SimpleJitExecutor } from "../typechain-types";

describe("SimpleJitExecutor", function () {
  let jitExecutor: SimpleJitExecutor;
  let owner: any;
  let addr1: any;

  beforeEach(async function () {
    [owner, addr1] = await ethers.getSigners();

    const SimpleJitExecutor = await ethers.getContractFactory("SimpleJitExecutor");
    jitExecutor = await SimpleJitExecutor.deploy(
      ethers.utils.parseEther("0.01"), // minProfitThreshold
      ethers.utils.parseEther("1000")  // maxLoanSize
    );
    await jitExecutor.deployed();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await jitExecutor.owner()).to.equal(owner.address);
    });

    it("Should set initial configuration", async function () {
      expect(await jitExecutor.minProfitThreshold()).to.equal(ethers.utils.parseEther("0.01"));
      expect(await jitExecutor.maxLoanSize()).to.equal(ethers.utils.parseEther("1000"));
      expect(await jitExecutor.paused()).to.equal(false);
    });
  });

  describe("Configuration", function () {
    it("Should allow owner to update config", async function () {
      await jitExecutor.updateConfig(
        ethers.utils.parseEther("0.02"), // new minProfitThreshold
        ethers.utils.parseEther("2000")  // new maxLoanSize
      );

      expect(await jitExecutor.minProfitThreshold()).to.equal(ethers.utils.parseEther("0.02"));
      expect(await jitExecutor.maxLoanSize()).to.equal(ethers.utils.parseEther("2000"));
    });

    it("Should not allow non-owner to update config", async function () {
      await expect(
        jitExecutor.connect(addr1).updateConfig(
          ethers.utils.parseEther("0.02"),
          ethers.utils.parseEther("2000")
        )
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Pause functionality", function () {
    it("Should allow owner to pause and unpause", async function () {
      await jitExecutor.setPaused(true);
      expect(await jitExecutor.paused()).to.equal(true);

      await jitExecutor.setPaused(false);
      expect(await jitExecutor.paused()).to.equal(false);
    });

    it("Should prevent execution when paused", async function () {
      await jitExecutor.setPaused(true);
      
      await expect(
        jitExecutor.simulateJit(ethers.utils.parseEther("100"))
      ).to.be.revertedWith("ExecutionPaused");
    });
  });

  describe("JIT Simulation", function () {
    it("Should simulate profitable JIT execution", async function () {
      const amount = ethers.utils.parseEther("100");
      const expectedProfit = amount.div(1000); // 0.1% profit

      const profit = await jitExecutor.simulateJit(amount);
      expect(profit).to.equal(expectedProfit);
    });

    it("Should reject execution when amount exceeds max loan size", async function () {
      const largeAmount = ethers.utils.parseEther("2000"); // Exceeds maxLoanSize
      
      await expect(
        jitExecutor.simulateJit(largeAmount)
      ).to.be.revertedWith("LoanSizeExceeded");
    });

    it("Should reject execution when profit is below threshold", async function () {
      const smallAmount = ethers.utils.parseEther("1"); // Will generate very small profit
      
      await expect(
        jitExecutor.simulateJit(smallAmount)
      ).to.be.revertedWith("InsufficientProfit");
    });
  });

  describe("Emergency functions", function () {
    it("Should allow owner to withdraw ETH", async function () {
      // Send some ETH to contract
      await owner.sendTransaction({
        to: jitExecutor.address,
        value: ethers.utils.parseEther("1")
      });

      const initialOwnerBalance = await owner.getBalance();
      const contractBalance = await ethers.provider.getBalance(jitExecutor.address);

      const tx = await jitExecutor.emergencyWithdraw(
        ethers.constants.AddressZero, // ETH
        contractBalance
      );
      
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed.mul(tx.gasPrice);

      const finalOwnerBalance = await owner.getBalance();
      const finalContractBalance = await ethers.provider.getBalance(jitExecutor.address);

      expect(finalContractBalance).to.equal(0);
      expect(finalOwnerBalance).to.equal(
        initialOwnerBalance.add(contractBalance).sub(gasUsed)
      );
    });
  });
});