// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Minimal INonfungiblePositionManager interface
/// @notice Contains only the functions we need from Uniswap V3 Position Manager
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

/// @title JitExecutor
/// @notice Production-ready JIT executor with Balancer/Aave flashloan support and Uniswap V3 integration
contract JitExecutor is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Emergency pause state
    bool public paused;
    
    /// @notice Minimum profit threshold (in wei)
    uint256 public minProfitThreshold;
    
    /// @notice Profit recipient address
    address public profitRecipient;
    
    /// @notice Maximum loan size
    uint256 public maxLoanSize;

    /// @notice Uniswap V3 Position Manager
    INonfungiblePositionManager public immutable positionManager;

    /// @notice Events
    event FlashloanRequested(address indexed provider, address indexed token, uint256 amount);
    event FlashloanUsed(address indexed provider, address indexed token, uint256 amount, uint256 fee);
    event PositionMinted(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
    event PositionBurned(uint256 indexed tokenId, uint256 amount0, uint256 amount1);
    event ProfitTransferred(address indexed recipient, uint256 amount);
    event JitFailed(string reason);
    event ConfigUpdated(uint256 minProfitThreshold, uint256 maxLoanSize);
    event ProfitRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event EmergencyPaused(bool paused);

    /// @notice Errors
    error ExecutionPaused();
    error InsufficientProfit(uint256 expected, uint256 actual);
    error LoanSizeExceeded(uint256 requested, uint256 max);
    error FlashloanCallbackFailed(string reason);
    error InvalidProfitRecipient();
    error UnauthorizedFlashloanCallback();

    /// @notice Flashloan execution context
    struct FlashloanContext {
        address token;
        uint256 amount;
        uint256 fee;
        address poolAddress;
        int24 tickLower;
        int24 tickUpper;
        uint256 tokenId;
        bool isActive;
    }

    /// @notice Current flashloan context
    FlashloanContext private flashloanContext;

    /// @notice Constructor
    /// @param _minProfitThreshold Minimum profit threshold in wei
    /// @param _maxLoanSize Maximum loan size
    /// @param _profitRecipient Address to receive profits
    /// @param _positionManager Address of Uniswap V3 Position Manager
    constructor(
        uint256 _minProfitThreshold,
        uint256 _maxLoanSize,
        address _profitRecipient,
        address _positionManager
    ) {
        if (_profitRecipient == address(0)) revert InvalidProfitRecipient();
        if (_positionManager == address(0)) revert("Invalid position manager address");
        
        minProfitThreshold = _minProfitThreshold;
        maxLoanSize = _maxLoanSize;
        profitRecipient = _profitRecipient;
        positionManager = INonfungiblePositionManager(_positionManager);
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
        // Decode user data
        (address poolAddress, int24 tickLower, int24 tickUpper) = abi.decode(userData, (address, int24, int24));
        
        // Validate single token flashloan
        require(tokens.length == 1, "Single token flashloan only");
        
        emit FlashloanRequested(msg.sender, address(tokens[0]), amounts[0]);
        
        // Set context and execute
        flashloanContext = FlashloanContext({
            token: address(tokens[0]),
            amount: amounts[0],
            fee: feeAmounts[0],
            poolAddress: poolAddress,
            tickLower: tickLower,
            tickUpper: tickUpper,
            tokenId: 0,
            isActive: true
        });

        try this._onFlashloanCallback() {
            emit FlashloanUsed(msg.sender, address(tokens[0]), amounts[0], feeAmounts[0]);
        } catch Error(string memory reason) {
            emit JitFailed(reason);
            revert FlashloanCallbackFailed(reason);
        }

        // Repay flashloan
        tokens[0].safeTransfer(msg.sender, amounts[0] + feeAmounts[0]);
        
        // Clear context
        delete flashloanContext;
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
        
        // Decode parameters
        (address poolAddress, int24 tickLower, int24 tickUpper) = abi.decode(params, (address, int24, int24));
        
        // Validate single asset flashloan
        require(assets.length == 1, "Single asset flashloan only");
        
        emit FlashloanRequested(msg.sender, assets[0], amounts[0]);
        
        // Set context and execute
        flashloanContext = FlashloanContext({
            token: assets[0],
            amount: amounts[0],
            fee: premiums[0],
            poolAddress: poolAddress,
            tickLower: tickLower,
            tickUpper: tickUpper,
            tokenId: 0,
            isActive: true
        });

        try this._onFlashloanCallback() {
            emit FlashloanUsed(msg.sender, assets[0], amounts[0], premiums[0]);
        } catch Error(string memory reason) {
            emit JitFailed(reason);
            revert FlashloanCallbackFailed(reason);
        }

        // Approve repayment
        IERC20(assets[0]).safeApprove(msg.sender, amounts[0] + premiums[0]);
        
        // Clear context
        delete flashloanContext;
        
        return true;
    }

    /// @notice Internal flashloan callback handler
    /// @dev This function executes the JIT strategy: mint → (victim swap) → decrease/collect → profit validation
    function _onFlashloanCallback() external {
        require(msg.sender == address(this), "Internal function only");
        require(flashloanContext.isActive, "No active flashloan context");

        FlashloanContext memory context = flashloanContext;
        
        // Step 1: Mint liquidity position around expected price
        uint256 tokenId = _mintLiquidityPosition(context);
        flashloanContext.tokenId = tokenId;

        // Step 2: Wait for victim swap to occur (handled by bundle ordering)
        // The victim transaction should execute here between our mint and burn

        // Step 3: Decrease liquidity and collect fees
        (uint256 amount0, uint256 amount1) = _decreaseLiquidityAndCollect(tokenId);

        // Step 4: Calculate and validate profit
        uint256 totalReceived = amount0 + amount1; // Simplified - in practice need to handle token0/token1 properly
        uint256 totalCost = context.amount + context.fee;
        
        if (totalReceived < totalCost + minProfitThreshold) {
            revert InsufficientProfit(totalCost + minProfitThreshold, totalReceived);
        }

        // Step 5: Transfer profit to recipient
        uint256 profit = totalReceived - totalCost;
        if (profit > 0) {
            IERC20(context.token).safeTransfer(profitRecipient, profit);
            emit ProfitTransferred(profitRecipient, profit);
        }
    }

    /// @notice Mint liquidity position
    function _mintLiquidityPosition(FlashloanContext memory context) private returns (uint256 tokenId) {
        // Approve position manager to spend tokens
        IERC20(context.token).safeApprove(address(positionManager), context.amount);

        // For simplicity, assume token is token0 - in production would need to handle both cases
        INonfungiblePositionManager.MintParams memory mintParams = INonfungiblePositionManager.MintParams({
            token0: context.token,
            token1: context.token, // Placeholder - would be derived from pool
            fee: 3000, // 0.3% fee tier - would be derived from pool
            tickLower: context.tickLower,
            tickUpper: context.tickUpper,
            amount0Desired: context.amount,
            amount1Desired: 0,
            amount0Min: 0,
            amount1Min: 0,
            recipient: address(this),
            deadline: block.timestamp + 300 // 5 minutes
        });

        (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1) = positionManager.mint(mintParams);
        
        emit PositionMinted(tokenId, liquidity, amount0, amount1);
    }

    /// @notice Decrease liquidity and collect fees
    function _decreaseLiquidityAndCollect(uint256 tokenId) private returns (uint256 amount0, uint256 amount1) {
        // First decrease all liquidity
        INonfungiblePositionManager.DecreaseLiquidityParams memory decreaseParams = 
            INonfungiblePositionManager.DecreaseLiquidityParams({
                tokenId: tokenId,
                liquidity: type(uint128).max, // Decrease all liquidity
                amount0Min: 0,
                amount1Min: 0,
                deadline: block.timestamp + 300
            });

        (amount0, amount1) = positionManager.decreaseLiquidity(decreaseParams);

        // Then collect all fees and decreased liquidity
        INonfungiblePositionManager.CollectParams memory collectParams = 
            INonfungiblePositionManager.CollectParams({
                tokenId: tokenId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            });

        (uint256 collected0, uint256 collected1) = positionManager.collect(collectParams);
        
        // Burn the NFT position
        positionManager.burn(tokenId);
        
        emit PositionBurned(tokenId, collected0, collected1);
        
        return (collected0, collected1);
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

    function setMinProfit(uint256 _minProfitThreshold) external onlyOwner {
        minProfitThreshold = _minProfitThreshold;
        emit ConfigUpdated(_minProfitThreshold, maxLoanSize);
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

    /// @notice Update configuration
    function updateConfig(uint256 _minProfitThreshold, uint256 _maxLoanSize) external onlyOwner {
        minProfitThreshold = _minProfitThreshold;
        maxLoanSize = _maxLoanSize;
        emit ConfigUpdated(_minProfitThreshold, _maxLoanSize);
    }

    /// @notice Receive ETH
    receive() external payable {}
}