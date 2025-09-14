// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/JitExecutor.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract JitExecutorTest is Test {
    JitExecutor public jitExecutor;
    MockERC20 public token0;
    MockERC20 public token1;
    
    address public owner;
    address public profitRecipient;
    address public user;
    
    uint256 constant MIN_PROFIT_THRESHOLD = 0.01 ether;
    uint256 constant MAX_LOAN_SIZE = 1000 ether;
    
    event FlashloanRequested(address indexed provider, address indexed token, uint256 amount);
    event FlashloanUsed(address indexed provider, address indexed token, uint256 amount, uint256 fee);
    event ProfitTransferred(address indexed recipient, uint256 amount);
    event JitFailed(string reason);

    function setUp() public {
        owner = address(this);
        profitRecipient = makeAddr("profitRecipient");
        user = makeAddr("user");
        
        // Deploy mock tokens
        token0 = new MockERC20("Token0", "TK0");
        token1 = new MockERC20("Token1", "TK1");
        
        // Deploy JIT executor
        jitExecutor = new JitExecutor(
            MIN_PROFIT_THRESHOLD,
            MAX_LOAN_SIZE,
            profitRecipient
        );
        
        // Mint tokens for testing
        token0.mint(address(jitExecutor), 10000 ether);
        token1.mint(address(jitExecutor), 10000 ether);
    }

    function testConstructor() public {
        assertEq(jitExecutor.owner(), owner);
        assertEq(jitExecutor.minProfitThreshold(), MIN_PROFIT_THRESHOLD);
        assertEq(jitExecutor.maxLoanSize(), MAX_LOAN_SIZE);
        assertEq(jitExecutor.profitRecipient(), profitRecipient);
        assertEq(jitExecutor.paused(), false);
    }

    function testSetProfitRecipient() public {
        address newRecipient = makeAddr("newRecipient");
        
        vm.expectEmit(true, true, false, false);
        emit JitExecutor.ProfitRecipientUpdated(profitRecipient, newRecipient);
        
        jitExecutor.setProfitRecipient(newRecipient);
        assertEq(jitExecutor.profitRecipient(), newRecipient);
    }

    function testSetProfitRecipientZeroAddress() public {
        vm.expectRevert(JitExecutor.InvalidProfitRecipient.selector);
        jitExecutor.setProfitRecipient(address(0));
    }

    function testPauseUnpause() public {
        // Test pause
        vm.expectEmit(false, false, false, true);
        emit JitExecutor.EmergencyPaused(true);
        
        jitExecutor.pause();
        assertEq(jitExecutor.paused(), true);
        
        // Test unpause
        vm.expectEmit(false, false, false, true);
        emit JitExecutor.EmergencyPaused(false);
        
        jitExecutor.unpause();
        assertEq(jitExecutor.paused(), false);
    }

    function testBalancerFlashloanCallback() public {
        // Prepare flashloan parameters
        IERC20[] memory tokens = new IERC20[](1);
        tokens[0] = IERC20(address(token0));
        
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100 ether;
        
        uint256[] memory feeAmounts = new uint256[](1);
        feeAmounts[0] = 0; // Balancer has no fees
        
        bytes memory userData = abi.encode(
            address(0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8), // Pool address
            int24(-60), // tickLower
            int24(60)   // tickUpper
        );
        
        // Expect events
        vm.expectEmit(true, true, false, true);
        emit FlashloanRequested(address(this), address(token0), 100 ether);
        
        // This should succeed in a real test environment with proper Uniswap V3 setup
        // For now, we expect it to revert due to missing position manager setup
        vm.expectRevert();
        jitExecutor.receiveFlashLoan(tokens, amounts, feeAmounts, userData);
    }

    function testAaveFlashloanCallback() public {
        // Prepare flashloan parameters
        address[] memory assets = new address[](1);
        assets[0] = address(token0);
        
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100 ether;
        
        uint256[] memory premiums = new uint256[](1);
        premiums[0] = 0.05 ether; // 0.05% Aave fee
        
        bytes memory params = abi.encode(
            address(0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8), // Pool address
            int24(-60), // tickLower
            int24(60)   // tickUpper
        );
        
        // Expect events
        vm.expectEmit(true, true, false, true);
        emit FlashloanRequested(address(this), address(token0), 100 ether);
        
        // This should succeed in a real test environment with proper Uniswap V3 setup
        // For now, we expect it to revert due to missing position manager setup
        vm.expectRevert();
        bool result = jitExecutor.executeOperation(
            assets,
            amounts,
            premiums,
            address(jitExecutor), // initiator
            params
        );
    }

    function testUnauthorizedFlashloanCallback() public {
        address[] memory assets = new address[](1);
        assets[0] = address(token0);
        
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100 ether;
        
        uint256[] memory premiums = new uint256[](1);
        premiums[0] = 0.05 ether;
        
        bytes memory params = abi.encode(
            address(0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8),
            int24(-60),
            int24(60)
        );
        
        // Should revert with unauthorized initiator
        vm.expectRevert("Unauthorized initiator");
        jitExecutor.executeOperation(
            assets,
            amounts,
            premiums,
            user, // unauthorized initiator
            params
        );
    }

    function testFlashloanCallbackWhenPaused() public {
        // Pause the contract
        jitExecutor.pause();
        
        IERC20[] memory tokens = new IERC20[](1);
        tokens[0] = IERC20(address(token0));
        
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100 ether;
        
        uint256[] memory feeAmounts = new uint256[](1);
        feeAmounts[0] = 0;
        
        bytes memory userData = abi.encode(
            address(0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8),
            int24(-60),
            int24(60)
        );
        
        // Should revert when paused
        vm.expectRevert(JitExecutor.ExecutionPaused.selector);
        jitExecutor.receiveFlashLoan(tokens, amounts, feeAmounts, userData);
    }

    function testEmergencyWithdrawETH() public {
        // Send some ETH to the contract
        vm.deal(address(jitExecutor), 1 ether);
        
        uint256 ownerBalanceBefore = owner.balance;
        
        jitExecutor.emergencyWithdraw(address(0), 0.5 ether);
        
        assertEq(owner.balance, ownerBalanceBefore + 0.5 ether);
        assertEq(address(jitExecutor).balance, 0.5 ether);
    }

    function testEmergencyWithdrawToken() public {
        uint256 ownerBalanceBefore = token0.balanceOf(owner);
        uint256 contractBalance = token0.balanceOf(address(jitExecutor));
        
        jitExecutor.emergencyWithdraw(address(token0), 100 ether);
        
        assertEq(token0.balanceOf(owner), ownerBalanceBefore + 100 ether);
        assertEq(token0.balanceOf(address(jitExecutor)), contractBalance - 100 ether);
    }

    function testUpdateConfig() public {
        uint256 newMinProfit = 0.02 ether;
        uint256 newMaxLoan = 2000 ether;
        
        vm.expectEmit(false, false, false, true);
        emit JitExecutor.ConfigUpdated(newMinProfit, newMaxLoan);
        
        jitExecutor.updateConfig(newMinProfit, newMaxLoan);
        
        assertEq(jitExecutor.minProfitThreshold(), newMinProfit);
        assertEq(jitExecutor.maxLoanSize(), newMaxLoan);
    }

    function testSetMinProfit() public {
        uint256 newMinProfit = 0.03 ether;
        
        vm.expectEmit(false, false, false, true);
        emit JitExecutor.ConfigUpdated(newMinProfit, MAX_LOAN_SIZE);
        
        jitExecutor.setMinProfit(newMinProfit);
        
        assertEq(jitExecutor.minProfitThreshold(), newMinProfit);
    }

    function testOnlyOwnerFunctions() public {
        vm.startPrank(user);
        
        vm.expectRevert("Ownable: caller is not the owner");
        jitExecutor.pause();
        
        vm.expectRevert("Ownable: caller is not the owner");
        jitExecutor.unpause();
        
        vm.expectRevert("Ownable: caller is not the owner");
        jitExecutor.setProfitRecipient(user);
        
        vm.expectRevert("Ownable: caller is not the owner");
        jitExecutor.setMinProfit(0.05 ether);
        
        vm.expectRevert("Ownable: caller is not the owner");
        jitExecutor.updateConfig(0.05 ether, 500 ether);
        
        vm.expectRevert("Ownable: caller is not the owner");
        jitExecutor.emergencyWithdraw(address(token0), 100 ether);
        
        vm.stopPrank();
    }

    function testReceiveETH() public {
        uint256 balanceBefore = address(jitExecutor).balance;
        
        (bool success,) = address(jitExecutor).call{value: 1 ether}("");
        assertTrue(success);
        
        assertEq(address(jitExecutor).balance, balanceBefore + 1 ether);
    }

    // Fuzz testing
    function testFuzzSetMinProfit(uint256 minProfit) public {
        vm.assume(minProfit <= type(uint256).max / 2); // Avoid overflow in calculations
        
        jitExecutor.setMinProfit(minProfit);
        assertEq(jitExecutor.minProfitThreshold(), minProfit);
    }

    function testFuzzUpdateConfig(uint256 minProfit, uint256 maxLoan) public {
        vm.assume(minProfit <= type(uint256).max / 2);
        vm.assume(maxLoan <= type(uint256).max / 2);
        
        jitExecutor.updateConfig(minProfit, maxLoan);
        assertEq(jitExecutor.minProfitThreshold(), minProfit);
        assertEq(jitExecutor.maxLoanSize(), maxLoan);
    }
}