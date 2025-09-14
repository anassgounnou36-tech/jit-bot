// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockERC20
 * @notice Mock ERC20 token for testing
 */
contract MockERC20 is ERC20 {
    uint8 private _decimals;

    constructor(
        string memory name,
        string memory symbol,
        uint8 __decimals
    ) ERC20(name, symbol) {
        _decimals = __decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }
}

/**
 * @title MockPositionManager
 * @notice Mock Uniswap V3 Position Manager for testing
 */
contract MockPositionManager {
    struct MintReturn {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0;
        uint256 amount1;
    }

    struct CollectReturn {
        uint256 amount0;
        uint256 amount1;
    }

    MintReturn private _mintReturn;
    CollectReturn private _collectReturn;
    uint256 private _nextTokenId = 1;

    function setMintReturn(
        uint256 tokenId,
        uint128 liquidity,
        uint256 amount0,
        uint256 amount1
    ) external {
        _mintReturn = MintReturn(tokenId, liquidity, amount0, amount1);
    }

    function setCollectReturn(uint256 amount0, uint256 amount1) external {
        _collectReturn = CollectReturn(amount0, amount1);
    }

    function mint(
        MintParams calldata /* params */
    ) external returns (
        uint256 tokenId,
        uint128 liquidity,
        uint256 amount0,
        uint256 amount1
    ) {
        if (_mintReturn.tokenId == 0) {
            tokenId = _nextTokenId++;
            liquidity = 1000;
            amount0 = 100 ether;
            amount1 = 0;
        } else {
            tokenId = _mintReturn.tokenId;
            liquidity = _mintReturn.liquidity;
            amount0 = _mintReturn.amount0;
            amount1 = _mintReturn.amount1;
        }
    }

    function decreaseLiquidity(
        DecreaseLiquidityParams calldata /* params */
    ) external returns (uint256 amount0, uint256 amount1) {
        return (0, 0); // Mock implementation
    }

    function collect(
        CollectParams calldata /* params */
    ) external returns (uint256 amount0, uint256 amount1) {
        return (_collectReturn.amount0, _collectReturn.amount1);
    }

    function burn(uint256 /* tokenId */) external {
        // Mock implementation - do nothing
    }

    // Struct definitions for compatibility
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
}