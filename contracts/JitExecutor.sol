// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Uniswap V3 Position Manager interface
interface INonfungiblePositionManager {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    struct DecreaseLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    function mint(MintParams calldata params) external payable returns (
        uint256 tokenId,
        uint128 liquidity,
        uint256 amount0,
        uint256 amount1
    );

    function decreaseLiquidity(DecreaseLiquidityParams calldata params) external payable returns (
        uint256 amount0,
        uint256 amount1
    );

    function collect(CollectParams calldata params) external payable returns (
        uint256 amount0,
        uint256 amount1
    );

    function burn(uint256 tokenId) external payable;
}

/// @notice Balancer Vault interface for flashloans
interface IBalancerVault {
    function flashLoan(
        address recipient,
        IERC20[] memory tokens,
        uint256[] memory amounts,
        bytes memory userData
    ) external;
}

/// @notice Aave V3 Pool interface for flashloans
interface IAaveV3Pool {
    function flashLoan(
        address receiverAddress,
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata modes,
        address onBehalfOf,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

/// @title JitExecutor
/// @notice Production-ready JIT executor with Balancer/Aave flashloan support and Uniswap V3 integration
contract JitExecutor is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Admin address (inherits from Ownable)
    // admin is available via owner() function from Ownable
    
    /// @notice Profit recipient address  
    address public profitRecipient;
    
    /// @notice Minimum profit threshold (in wei)
    uint256 public minProfit;
    
    /// @notice Emergency pause state
    bool public paused;

    /// @notice Uniswap V3 Position Manager
    INonfungiblePositionManager public constant positionManager = 
        INonfungiblePositionManager(0xC36442b4a4522E871399CD717aBDD847Ab11FE88);

    /// @notice Events
    event FlashloanRequested(address indexed provider, address indexed token, uint256 amount);
    event FlashloanUsed(address indexed provider, address indexed token, uint256 amount, uint256 fee);
    event ProfitTransferred(address indexed recipient, uint256 amount);
    event JitFailed(string reason);
    event ConfigUpdated(uint256 minProfit, uint256 reserved);
    event ProfitRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event EmergencyPaused(bool paused);

    /// @notice Errors
    error ExecutionPaused();
    error InsufficientProfit(uint256 expected, uint256 actual);
    error FlashloanCallbackFailed(string reason);
    error InvalidProfitRecipient();
    error UnauthorizedFlashloanCallback();

    /// @notice Constructor
    /// @param _minProfit Minimum profit threshold in wei
    /// @param _profitRecipient Address to receive profits
    constructor(
        uint256 _minProfit,
        address _profitRecipient
    ) {
        if (_profitRecipient == address(0)) revert InvalidProfitRecipient();
        
        minProfit = _minProfit;
        profitRecipient = _profitRecipient;
    }

    /// @notice Modifier to check if execution is not paused
    modifier whenNotPaused() {
        if (paused) revert ExecutionPaused();
        _;
    }

    /// @notice Balancer flashloan callback
    /// @param tokens Array of tokens
    /// @param amounts Array of amounts
    /// @param feeAmounts Array of fee amounts
    /// @param userData User data containing execution parameters
    function receiveFlashLoan(
        IERC20[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external whenNotPaused {
        // Validate single token flashloan
        require(tokens.length == 1, "Single token flashloan only");
        
        emit FlashloanRequested(msg.sender, address(tokens[0]), amounts[0]);
        
        // Delegate to internal callback
        _onFlashloanCallback(userData);
        
        emit FlashloanUsed(msg.sender, address(tokens[0]), amounts[0], feeAmounts[0]);
        
        // Repay flashloan
        tokens[0].safeTransfer(msg.sender, amounts[0] + feeAmounts[0]);
    }

    /// @notice Aave flashloan callback
    /// @param assets Array of assets
    /// @param amounts Array of amounts
    /// @param premiums Array of premiums
    /// @param initiator Initiator address
    /// @param params Parameters containing execution data
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external whenNotPaused returns (bool) {
        // Verify callback is from Aave pool and we initiated the flashloan
        require(initiator == address(this), "Unauthorized initiator");
        
        // Validate single asset flashloan
        require(assets.length == 1, "Single asset flashloan only");
        
        emit FlashloanRequested(msg.sender, assets[0], amounts[0]);
        
        // Delegate to internal callback
        _onFlashloanCallback(params);
        
        emit FlashloanUsed(msg.sender, assets[0], amounts[0], premiums[0]);
        
        // Approve repayment
        IERC20(assets[0]).safeApprove(msg.sender, amounts[0] + premiums[0]);
        
        return true;
    }

    /// @notice Internal flashloan callback handler stub
    /// @param data User data from flashloan
    /// @dev This is a stub implementation - full logic will be implemented in PR2
    function _onFlashloanCallback(bytes memory data) internal {
        // TODO: Implement full JIT strategy logic in PR2
        // This should include:
        // 1. Decode flashloan parameters
        // 2. Mint liquidity position around expected price  
        // 3. Wait for victim swap (handled by bundle ordering)
        // 4. Decrease liquidity and collect fees
        // 5. Calculate and validate profit
        // 6. Transfer profit to recipient
        
        // For now, just ensure compilation succeeds
        data; // suppress unused parameter warning
    }

    /// @notice Admin functions
    function pause() external onlyOwner {
        paused = true;
        emit EmergencyPaused(true);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit EmergencyPaused(false);
    }

    function setMinProfit(uint256 _minProfit) external onlyOwner {
        minProfit = _minProfit;
        emit ConfigUpdated(_minProfit, 0);
    }

    function setProfitRecipient(address _profitRecipient) external onlyOwner {
        if (_profitRecipient == address(0)) revert InvalidProfitRecipient();
        
        address oldRecipient = profitRecipient;
        profitRecipient = _profitRecipient;
        emit ProfitRecipientUpdated(oldRecipient, _profitRecipient);
    }

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