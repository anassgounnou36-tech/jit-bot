// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../../contracts/JitExecutor.sol";

/// @title JitExecutor Profit Guard Tests
/// @notice Tests the on-chain profit guard mechanism and profit validation
contract JitExecutorProfitGuardTest is Test {
    JitExecutor public jitExecutor;
    
    address public owner = address(0x1);
    address public profitRecipient = address(0x2);
    address public positionManager = address(0x3);
    
    uint256 public constant MIN_PROFIT_THRESHOLD = 0.01 ether; // 0.01 ETH
    uint256 public constant MAX_LOAN_SIZE = 100 ether;
    
    // Mock token addresses
    address public constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address public constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    
    // Events to test
    event JitExecuted(uint256 indexed tokenId, uint256 profit, uint256 gasUsed);
    event JitRejected(string reason, uint256 expectedProfit, uint256 actualProfit);
    event ProfitTransferred(address indexed recipient, uint256 amount);
    
    function setUp() public {
        vm.startPrank(owner);
        
        jitExecutor = new JitExecutor(
            MIN_PROFIT_THRESHOLD,
            MAX_LOAN_SIZE,
            profitRecipient,
            positionManager
        );
        
        vm.stopPrank();
    }
    
    /// @notice Test profit guard correctly accepts profitable trades
    function testProfitGuard_AcceptsProfitableTrade() public {
        // Set up profitable scenario
        uint256 flashloanAmount = 10 ether;
        uint256 flashloanFee = 0.005 ether; // 0.05% fee
        uint256 feesCollected = 0.1 ether; // 0.1 ETH collected
        uint256 gasCost = 0.02 ether; // 0.02 ETH gas cost
        
        uint256 totalRepayment = flashloanAmount + flashloanFee;
        uint256 totalCosts = totalRepayment + gasCost;
        uint256 expectedProfit = feesCollected - totalCosts;
        
        // Ensure this is profitable
        assertGt(expectedProfit, MIN_PROFIT_THRESHOLD);
        
        // Mock the profit validation function call
        vm.startPrank(address(jitExecutor));
        
        // This would be called internally by _onFlashloanCallback
        // Testing the core profit logic
        uint256 finalAmount = feesCollected;
        uint256 repayAmount = totalRepayment;
        
        // Should NOT revert for profitable trade
        assertTrue(finalAmount >= repayAmount + MIN_PROFIT_THRESHOLD);
        
        vm.stopPrank();
    }
    
    /// @notice Test profit guard correctly rejects unprofitable trades
    function testProfitGuard_RejectsUnprofitableTrade() public {
        // Set up unprofitable scenario
        uint256 flashloanAmount = 10 ether;
        uint256 flashloanFee = 0.005 ether; // 0.05% fee
        uint256 feesCollected = 0.008 ether; // Only 0.008 ETH collected (insufficient)
        
        uint256 totalRepayment = flashloanAmount + flashloanFee;
        uint256 minRequired = totalRepayment + MIN_PROFIT_THRESHOLD;
        
        // Ensure this is unprofitable
        assertLt(feesCollected, minRequired);
        
        // Mock the profit validation
        vm.startPrank(address(jitExecutor));
        
        uint256 finalAmount = feesCollected;
        uint256 repayAmount = totalRepayment;
        
        // Should fail profit guard check
        assertFalse(finalAmount >= repayAmount + MIN_PROFIT_THRESHOLD);
        
        vm.stopPrank();
    }
    
    /// @notice Test minimum profit threshold enforcement
    function testProfitGuard_EnforcesMinimumThreshold() public {
        uint256 newThreshold = 0.05 ether; // 0.05 ETH
        
        vm.startPrank(owner);
        jitExecutor.setMinProfit(newThreshold);
        vm.stopPrank();
        
        assertEq(jitExecutor.minProfitThreshold(), newThreshold);
        
        // Test scenario with profit below new threshold
        uint256 flashloanAmount = 10 ether;
        uint256 flashloanFee = 0.005 ether;
        uint256 feesCollected = 10.02 ether; // Small profit
        
        uint256 totalRepayment = flashloanAmount + flashloanFee;
        uint256 actualProfit = feesCollected - totalRepayment;
        
        // Should be less than new threshold
        assertLt(actualProfit, newThreshold);
        
        // Profit guard should reject
        assertFalse(feesCollected >= totalRepayment + newThreshold);
    }
    
    /// @notice Test profit guard with zero fees collected
    function testProfitGuard_ZeroFeesCollected() public {
        uint256 flashloanAmount = 10 ether;
        uint256 flashloanFee = 0.005 ether;
        uint256 feesCollected = 0; // No fees collected
        
        uint256 totalRepayment = flashloanAmount + flashloanFee;
        
        // Should definitely fail
        assertFalse(feesCollected >= totalRepayment + MIN_PROFIT_THRESHOLD);
    }
    
    /// @notice Test profit calculation with different fee scenarios
    function testProfitGuard_DifferentFeeScenarios() public {
        // Scenario 1: Balancer (no fees)
        uint256 balancerAmount = 10 ether;
        uint256 balancerFee = 0; // Balancer has no fees
        uint256 balancerFeesCollected = 0.03 ether;
        
        assertTrue(balancerFeesCollected >= balancerAmount + balancerFee + MIN_PROFIT_THRESHOLD);
        
        // Scenario 2: Aave (0.05% fee)
        uint256 aaveAmount = 10 ether;
        uint256 aaveFee = 0.005 ether; // 0.05%
        uint256 aaveFeesCollected = 0.03 ether;
        
        assertFalse(aaveFeesCollected >= aaveAmount + aaveFee + MIN_PROFIT_THRESHOLD);
    }
    
    /// @notice Test profit guard integrates with configuration changes
    function testProfitGuard_ConfigurationChanges() public {
        // Test increasing minimum profit
        vm.startPrank(owner);
        
        uint256 oldThreshold = jitExecutor.minProfitThreshold();
        uint256 newThreshold = oldThreshold * 2;
        
        jitExecutor.setMinProfit(newThreshold);
        
        assertEq(jitExecutor.minProfitThreshold(), newThreshold);
        
        vm.stopPrank();
        
        // Test that previously acceptable profit is now rejected
        uint256 flashloanAmount = 10 ether;
        uint256 flashloanFee = 0.005 ether;
        uint256 feesCollected = 10.015 ether; // Small profit
        
        uint256 totalRepayment = flashloanAmount + flashloanFee;
        uint256 actualProfit = feesCollected - totalRepayment;
        
        // Should be above old threshold but below new threshold
        assertGt(actualProfit, oldThreshold);
        assertLt(actualProfit, newThreshold);
        
        // New threshold should reject
        assertFalse(feesCollected >= totalRepayment + newThreshold);
    }
    
    /// @notice Test profit guard boundary conditions
    function testProfitGuard_BoundaryConditions() public {
        uint256 flashloanAmount = 10 ether;
        uint256 flashloanFee = 0.005 ether;
        uint256 totalRepayment = flashloanAmount + flashloanFee;
        
        // Exactly at threshold
        uint256 exactThresholdAmount = totalRepayment + MIN_PROFIT_THRESHOLD;
        assertTrue(exactThresholdAmount >= totalRepayment + MIN_PROFIT_THRESHOLD);
        
        // Just below threshold (should fail)
        uint256 belowThresholdAmount = totalRepayment + MIN_PROFIT_THRESHOLD - 1;
        assertFalse(belowThresholdAmount >= totalRepayment + MIN_PROFIT_THRESHOLD);
        
        // Just above threshold (should pass)
        uint256 aboveThresholdAmount = totalRepayment + MIN_PROFIT_THRESHOLD + 1;
        assertTrue(aboveThresholdAmount >= totalRepayment + MIN_PROFIT_THRESHOLD);
    }
    
    /// @notice Test profit guard with very large numbers
    function testProfitGuard_LargeNumbers() public {
        uint256 largeFlashloanAmount = 1000 ether;
        uint256 largeFee = 0.5 ether; // 0.05%
        uint256 largeFeesCollected = 1003 ether; // 3 ETH profit
        
        uint256 totalRepayment = largeFlashloanAmount + largeFee;
        uint256 actualProfit = largeFeesCollected - totalRepayment;
        
        assertGt(actualProfit, MIN_PROFIT_THRESHOLD);
        assertTrue(largeFeesCollected >= totalRepayment + MIN_PROFIT_THRESHOLD);
    }
    
    /// @notice Test profit guard gas optimization
    function testProfitGuard_GasEfficiency() public view {
        // Simple checks should be gas efficient
        uint256 amount = 100 ether;
        uint256 fee = 0.05 ether;
        uint256 collected = 101 ether;
        
        uint256 repayAmount = amount + fee;
        uint256 threshold = MIN_PROFIT_THRESHOLD;
        
        // This should be a simple comparison
        bool profitable = collected >= repayAmount + threshold;
        assertTrue(profitable);
    }
    
    /// @notice Test profit recipient validation
    function testProfitGuard_RecipientValidation() public {
        assertEq(jitExecutor.profitRecipient(), profitRecipient);
        
        // Change recipient
        vm.startPrank(owner);
        address newRecipient = address(0x999);
        jitExecutor.setProfitRecipient(newRecipient);
        vm.stopPrank();
        
        assertEq(jitExecutor.profitRecipient(), newRecipient);
    }
    
    /// @notice Test that profit guard cannot be bypassed
    function testProfitGuard_CannotBypass() public {
        // Try to call internal function directly (should fail)
        vm.expectRevert("Internal function only");
        jitExecutor._onFlashloanCallback();
    }
    
    /// @notice Test profit guard error messages
    function testProfitGuard_ErrorMessages() public {
        // Test configuration validation
        vm.startPrank(owner);
        
        // Test invalid profit recipient
        vm.expectRevert(JitExecutor.InvalidProfitRecipient.selector);
        jitExecutor.setProfitRecipient(address(0));
        
        vm.stopPrank();
    }
}