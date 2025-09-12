// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title SimpleJitExecutor
/// @notice Simplified JIT executor for demonstration
contract SimpleJitExecutor is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Emergency pause state
    bool public paused;
    
    /// @notice Minimum profit threshold (in ETH, scaled by 1e18)
    uint256 public minProfitThreshold;
    
    /// @notice Maximum loan size
    uint256 public maxLoanSize;

    /// @notice Events
    event JitExecuted(uint256 profit);
    event ConfigUpdated(uint256 minProfitThreshold, uint256 maxLoanSize);
    event EmergencyPaused(bool paused);

    /// @notice Errors
    error ExecutionPaused();
    error InsufficientProfit(uint256 expected, uint256 actual);
    error LoanSizeExceeded(uint256 requested, uint256 max);

    /// @notice Constructor
    /// @param _minProfitThreshold Minimum profit threshold
    /// @param _maxLoanSize Maximum loan size
    constructor(
        uint256 _minProfitThreshold,
        uint256 _maxLoanSize
    ) {
        minProfitThreshold = _minProfitThreshold;
        maxLoanSize = _maxLoanSize;
    }

    /// @notice Modifier to check if execution is not paused
    modifier whenNotPaused() {
        if (paused) revert ExecutionPaused();
        _;
    }

    /// @notice Simulate JIT execution (placeholder)
    /// @param amount Amount to simulate with
    function simulateJit(uint256 amount) external onlyOwner whenNotPaused returns (uint256) {
        if (amount > maxLoanSize) {
            revert LoanSizeExceeded(amount, maxLoanSize);
        }
        
        // Simulate profit calculation
        uint256 profit = amount / 1000; // 0.1% profit simulation
        
        if (profit < minProfitThreshold) {
            revert InsufficientProfit(minProfitThreshold, profit);
        }
        
        emit JitExecuted(profit);
        return profit;
    }

    /// @notice Update configuration
    /// @param _minProfitThreshold New minimum profit threshold
    /// @param _maxLoanSize New maximum loan size
    function updateConfig(
        uint256 _minProfitThreshold,
        uint256 _maxLoanSize
    ) external onlyOwner {
        minProfitThreshold = _minProfitThreshold;
        maxLoanSize = _maxLoanSize;
        
        emit ConfigUpdated(_minProfitThreshold, _maxLoanSize);
    }

    /// @notice Emergency pause/unpause
    /// @param _paused New pause state
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit EmergencyPaused(_paused);
    }

    /// @notice Withdraw stuck tokens (emergency)
    /// @param token Token address (address(0) for ETH)
    /// @param amount Amount to withdraw
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            payable(owner()).transfer(amount);
        } else {
            IERC20(token).safeTransfer(owner(), amount);
        }
    }

    /// @notice Receive ETH
    receive() external payable {}
}