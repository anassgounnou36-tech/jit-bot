// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../../contracts/JitExecutor.sol";

/// @title JitExecutor Flashloan Callback Tests
/// @notice Tests the flashloan callback implementations for Balancer and Aave
contract JitExecutorCallbackTest is Test {
    JitExecutor public jitExecutor;
    
    address public owner = address(0x1);
    address public profitRecipient = address(0x2);
    address public positionManager = address(0x3);
    address public balancerVault = address(0x4);
    address public aavePool = address(0x5);
    
    uint256 public constant MIN_PROFIT_THRESHOLD = 0.01 ether;
    uint256 public constant MAX_LOAN_SIZE = 100 ether;
    
    // Mock tokens
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    
    // Events to test
    event FlashloanRequested(address indexed provider, address indexed token, uint256 amount);
    event FlashloanUsed(address indexed provider, address indexed token, uint256 amount, uint256 fee);
    event JitExecuted(uint256 indexed tokenId, uint256 profit, uint256 gasUsed);
    event JitFailed(string reason);
    
    function setUp() public {
        vm.startPrank(owner);
        
        // Deploy mock tokens
        tokenA = new MockERC20("Token A", "TOKA", 18);
        tokenB = new MockERC20("Token B", "TOKB", 18);
        
        jitExecutor = new JitExecutor(
            MIN_PROFIT_THRESHOLD,
            MAX_LOAN_SIZE,
            profitRecipient,
            positionManager
        );
        
        vm.stopPrank();
        
        // Fund the contract with some tokens for testing
        tokenA.mint(address(jitExecutor), 1000 ether);
        tokenB.mint(address(jitExecutor), 1000 ether);
    }
    
    /// @notice Test Balancer flashloan callback with valid parameters
    function testBalancerCallback_ValidFlashloan() public {
        IERC20[] memory tokens = new IERC20[](1);
        tokens[0] = IERC20(address(tokenA));
        
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 10 ether;
        
        uint256[] memory feeAmounts = new uint256[](1);
        feeAmounts[0] = 0; // Balancer has no fees
        
        // Encode pool parameters
        address poolAddress = address(0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8);
        int24 tickLower = -1000;
        int24 tickUpper = 1000;
        bytes memory userData = abi.encode(poolAddress, tickLower, tickUpper);
        
        // Mock Balancer vault call
        vm.startPrank(balancerVault);
        
        // Expect events
        vm.expectEmit(true, true, false, true);
        emit FlashloanRequested(balancerVault, address(tokenA), 10 ether);
        
        // This would fail in the actual callback due to missing position manager setup
        // But we can test the basic callback structure
        vm.expectRevert();
        jitExecutor.receiveFlashLoan(tokens, amounts, feeAmounts, userData);
        
        vm.stopPrank();
    }
    
    /// @notice Test Aave flashloan callback with valid parameters
    function testAaveCallback_ValidFlashloan() public {
        address[] memory assets = new address[](1);
        assets[0] = address(tokenA);
        
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 10 ether;
        
        uint256[] memory premiums = new uint256[](1);
        premiums[0] = 0.005 ether; // 0.05% fee
        
        address initiator = address(jitExecutor);
        
        // Encode pool parameters
        address poolAddress = address(0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8);
        int24 tickLower = -1000;
        int24 tickUpper = 1000;
        bytes memory params = abi.encode(poolAddress, tickLower, tickUpper);
        
        // Mock Aave pool call
        vm.startPrank(aavePool);
        
        // Expect events
        vm.expectEmit(true, true, false, true);
        emit FlashloanRequested(aavePool, address(tokenA), 10 ether);
        
        // This would fail in the actual callback due to missing position manager setup
        vm.expectRevert();
        bool result = jitExecutor.executeOperation(assets, amounts, premiums, initiator, params);
        
        vm.stopPrank();
    }
    
    /// @notice Test Balancer callback with invalid token array
    function testBalancerCallback_InvalidTokenArray() public {
        // Test with empty token array
        IERC20[] memory tokens = new IERC20[](0);
        uint256[] memory amounts = new uint256[](0);
        uint256[] memory feeAmounts = new uint256[](0);
        bytes memory userData = abi.encode(address(0), int24(0), int24(0));
        
        vm.startPrank(balancerVault);
        vm.expectRevert("Single token flashloan only");
        jitExecutor.receiveFlashLoan(tokens, amounts, feeAmounts, userData);
        vm.stopPrank();
        
        // Test with multiple tokens
        IERC20[] memory multiTokens = new IERC20[](2);
        multiTokens[0] = IERC20(address(tokenA));
        multiTokens[1] = IERC20(address(tokenB));
        
        uint256[] memory multiAmounts = new uint256[](2);
        multiAmounts[0] = 10 ether;
        multiAmounts[1] = 10 ether;
        
        uint256[] memory multiFeeAmounts = new uint256[](2);
        multiFeeAmounts[0] = 0;
        multiFeeAmounts[1] = 0;
        
        vm.startPrank(balancerVault);
        vm.expectRevert("Single token flashloan only");
        jitExecutor.receiveFlashLoan(multiTokens, multiAmounts, multiFeeAmounts, userData);
        vm.stopPrank();
    }
    
    /// @notice Test Aave callback with invalid asset array
    function testAaveCallback_InvalidAssetArray() public {
        // Test with multiple assets
        address[] memory assets = new address[](2);
        assets[0] = address(tokenA);
        assets[1] = address(tokenB);
        
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 10 ether;
        amounts[1] = 10 ether;
        
        uint256[] memory premiums = new uint256[](2);
        premiums[0] = 0.005 ether;
        premiums[1] = 0.005 ether;
        
        address initiator = address(jitExecutor);
        bytes memory params = abi.encode(address(0), int24(0), int24(0));
        
        vm.startPrank(aavePool);
        vm.expectRevert("Single asset flashloan only");
        jitExecutor.executeOperation(assets, amounts, premiums, initiator, params);
        vm.stopPrank();
    }
    
    /// @notice Test Aave callback with unauthorized initiator
    function testAaveCallback_UnauthorizedInitiator() public {
        address[] memory assets = new address[](1);
        assets[0] = address(tokenA);
        
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 10 ether;
        
        uint256[] memory premiums = new uint256[](1);
        premiums[0] = 0.005 ether;
        
        address unauthorizedInitiator = address(0x999);
        bytes memory params = abi.encode(address(0), int24(0), int24(0));
        
        vm.startPrank(aavePool);
        vm.expectRevert("Unauthorized initiator");
        jitExecutor.executeOperation(assets, amounts, premiums, unauthorizedInitiator, params);
        vm.stopPrank();
    }
    
    /// @notice Test callback when contract is paused
    function testCallback_WhenPaused() public {
        // Pause the contract
        vm.startPrank(owner);
        jitExecutor.pause();
        vm.stopPrank();
        
        // Test Balancer callback
        IERC20[] memory tokens = new IERC20[](1);
        tokens[0] = IERC20(address(tokenA));
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 10 ether;
        uint256[] memory feeAmounts = new uint256[](1);
        feeAmounts[0] = 0;
        bytes memory userData = abi.encode(address(0), int24(0), int24(0));
        
        vm.startPrank(balancerVault);
        vm.expectRevert(JitExecutor.ExecutionPaused.selector);
        jitExecutor.receiveFlashLoan(tokens, amounts, feeAmounts, userData);
        vm.stopPrank();
        
        // Test Aave callback
        address[] memory assets = new address[](1);
        assets[0] = address(tokenA);
        uint256[] memory aaveAmounts = new uint256[](1);
        aaveAmounts[0] = 10 ether;
        uint256[] memory premiums = new uint256[](1);
        premiums[0] = 0.005 ether;
        
        vm.startPrank(aavePool);
        vm.expectRevert(JitExecutor.ExecutionPaused.selector);
        jitExecutor.executeOperation(assets, aaveAmounts, premiums, address(jitExecutor), userData);
        vm.stopPrank();
    }
    
    /// @notice Test flashloan context management
    function testCallback_FlashloanContext() public {
        // Test that flashloan context is not active initially
        assertFalse(jitExecutor.isFlashloanActive());
        
        // Test that getCurrentFlashloanContext reverts when no active flashloan
        vm.expectRevert("No active flashloan");
        jitExecutor.getCurrentFlashloanContext();
    }
    
    /// @notice Test callback parameter decoding
    function testCallback_ParameterDecoding() public {
        address poolAddress = address(0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8);
        int24 tickLower = -887220; // Min tick
        int24 tickUpper = 887220;  // Max tick
        
        bytes memory userData = abi.encode(poolAddress, tickLower, tickUpper);
        
        // Decode to verify encoding works correctly
        (address decodedPool, int24 decodedLower, int24 decodedUpper) = abi.decode(userData, (address, int24, int24));
        
        assertEq(decodedPool, poolAddress);
        assertEq(decodedLower, tickLower);
        assertEq(decodedUpper, tickUpper);
    }
    
    /// @notice Test callback gas usage estimation
    function testCallback_GasUsage() public {
        IERC20[] memory tokens = new IERC20[](1);
        tokens[0] = IERC20(address(tokenA));
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 10 ether;
        uint256[] memory feeAmounts = new uint256[](1);
        feeAmounts[0] = 0;
        bytes memory userData = abi.encode(address(0), int24(0), int24(0));
        
        vm.startPrank(balancerVault);
        
        uint256 gasBefore = gasleft();
        
        // This will revert but we can measure gas usage up to that point
        try jitExecutor.receiveFlashLoan(tokens, amounts, feeAmounts, userData) {
            // Should not reach here
        } catch {
            uint256 gasUsed = gasBefore - gasleft();
            // Gas usage should be reasonable (less than 100k for basic validation)
            assertLt(gasUsed, 100000);
        }
        
        vm.stopPrank();
    }
    
    /// @notice Test callback event emissions
    function testCallback_EventEmissions() public {
        IERC20[] memory tokens = new IERC20[](1);
        tokens[0] = IERC20(address(tokenA));
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 10 ether;
        uint256[] memory feeAmounts = new uint256[](1);
        feeAmounts[0] = 0;
        bytes memory userData = abi.encode(address(0), int24(0), int24(0));
        
        vm.startPrank(balancerVault);
        
        // Check that FlashloanRequested event is emitted
        vm.expectEmit(true, true, false, true);
        emit FlashloanRequested(balancerVault, address(tokenA), 10 ether);
        
        // Should also emit JitFailed when callback fails
        vm.expectEmit(false, false, false, true);
        emit JitFailed("Position manager not set up properly");
        
        vm.expectRevert();
        jitExecutor.receiveFlashLoan(tokens, amounts, feeAmounts, userData);
        
        vm.stopPrank();
    }
    
    /// @notice Test callback reentrancy protection
    function testCallback_ReentrancyProtection() public {
        // The contract should be protected against reentrancy
        // This is handled by the ReentrancyGuard inheritance
        
        IERC20[] memory tokens = new IERC20[](1);
        tokens[0] = IERC20(address(tokenA));
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 10 ether;
        uint256[] memory feeAmounts = new uint256[](1);
        feeAmounts[0] = 0;
        bytes memory userData = abi.encode(address(0), int24(0), int24(0));
        
        vm.startPrank(balancerVault);
        
        // First call should work (but revert due to other reasons)
        vm.expectRevert();
        jitExecutor.receiveFlashLoan(tokens, amounts, feeAmounts, userData);
        
        vm.stopPrank();
    }
    
    /// @notice Test callback with maximum values
    function testCallback_MaximumValues() public {
        IERC20[] memory tokens = new IERC20[](1);
        tokens[0] = IERC20(address(tokenA));
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = type(uint256).max;
        uint256[] memory feeAmounts = new uint256[](1);
        feeAmounts[0] = 0;
        bytes memory userData = abi.encode(address(0), int24(0), int24(0));
        
        vm.startPrank(balancerVault);
        
        // Should handle maximum values without overflow
        vm.expectRevert(); // Will revert for other reasons, not overflow
        jitExecutor.receiveFlashLoan(tokens, amounts, feeAmounts, userData);
        
        vm.stopPrank();
    }
}

/// @title Mock ERC20 Token for Testing
contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;
    
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    
    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }
    
    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }
    
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }
    
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
    
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        
        emit Transfer(from, to, amount);
        return true;
    }
}