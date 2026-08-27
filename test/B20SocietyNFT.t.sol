// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { B20SocietyNFT, IBurnable } from "../contracts/B20SocietyNFT.sol";

/// @dev Mock SOCIETY token for testing. Implements the IBurnable
///      interface that B20SocietyNFT uses.
contract MockSOCIETY is IBurnable {
    string public name = "B20 Society Token";
    string public symbol = "SOCIETY";
    uint8 public decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
}

contract B20SocietyNFTTest is Test {
    B20SocietyNFT public nft;
    MockSOCIETY public society;
    address public deployer = address(0x1);
    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    function setUp() public {
        society = new MockSOCIETY();
        nft = new B20SocietyNFT(address(society), deployer);

        // Pre-fund test actors with ETH for minting
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    // =============================================================
    //                         DEPLOYMENT
    // =============================================================

    function test_Deploy() public view {
        assertEq(nft.name(), "B20 Society");
        assertEq(nft.symbol(), "B20S");
        assertEq(address(nft.society()), address(society));
        assertEq(nft.royaltyReceiver(), deployer);
    }

    function test_RoyaltyIs5Percent() public view {
        // 5% = 500 basis points
        (address receiver, uint256 amount) = nft.royaltyInfo(1, 10_000);
        assertEq(receiver, deployer);
        assertEq(amount, 500);
    }

    function test_TokenURI_Format() public {
        vm.prank(alice);
        nft.mint{value: 0.001 ether}();

        assertEq(
            nft.tokenURI(1),
            "https://b20society.com/api/nft/1"
        );
    }

    // =============================================================
    //                            MINT
    // =============================================================

    function test_Mint_Success() public {
        vm.prank(alice);
        nft.mint{value: 0.001 ether}();

        assertEq(nft.balanceOf(alice), 1);
        assertEq(nft.ownerOf(1), alice);
        assertEq(nft.totalSupply(), 1);
        assertEq(nft.mintedPerWallet(alice), 1);
    }

    function test_Mint_InitialPhaseIsOne() public {
        vm.prank(alice);
        nft.mint{value: 0.001 ether}();

        assertEq(nft.phaseOf(1), 1);
    }

    function test_Mint_RevertWhen_IncorrectPayment() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(B20SocietyNFT.IncorrectPayment.selector, 0.0005 ether, 0.001 ether)
        );
        nft.mint{value: 0.0005 ether}();
    }

    function test_Mint_RevertWhen_OverPayment() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(B20SocietyNFT.IncorrectPayment.selector, 0.002 ether, 0.001 ether)
        );
        nft.mint{value: 0.002 ether}();
    }

    function test_Mint_RevertWhen_MaxPerWalletReached() public {
        vm.startPrank(alice);
        nft.mint{value: 0.001 ether}();
        nft.mint{value: 0.001 ether}();
        nft.mint{value: 0.001 ether}();
        nft.mint{value: 0.001 ether}();
        nft.mint{value: 0.001 ether}();
        vm.stopPrank();

        // 6th mint should fail
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(B20SocietyNFT.MaxPerWalletReached.selector, 5)
        );
        nft.mint{value: 0.001 ether}();
    }

    function test_Mint_PaysRoyaltyReceiver() public {
        uint256 balBefore = deployer.balance;
        vm.prank(alice);
        nft.mint{value: 0.001 ether}();
        assertEq(deployer.balance - balBefore, 0.001 ether);
    }

    // =============================================================
    //                          PHASE
    // =============================================================

    function test_AdvancePhase_Success() public {
        vm.prank(alice);
        nft.mint{value: 0.001 ether}();
        assertEq(nft.phaseOf(1), 1);

        // Alice approves NFT to burn 20K SOCIETY
        society.mint(alice, 100_000 ether);
        vm.prank(alice);
        society.approve(address(nft), 20_000 ether);

        // Advance 1 -> 2
        vm.prank(alice);
        nft.advancePhase(1);
        assertEq(nft.phaseOf(1), 2);
        assertEq(society.balanceOf(alice), 80_000 ether);
        assertEq(society.balanceOf(BURN_ADDRESS), 20_000 ether);
    }

    function test_AdvancePhase_BurnCostAtMaxIsZero() public {
        vm.prank(alice);
        nft.mint{value: 0.001 ether}();
        society.mint(alice, 10_000_000 ether);
        vm.prank(alice);
        society.approve(address(nft), type(uint256).max);

        for (uint8 i = 0; i < 9; i++) {
            vm.prank(alice);
            nft.advancePhase(1);
        }
        assertEq(nft.phaseOf(1), 10);
        assertEq(nft.burnCostFor(1), 0);
    }

    function test_FullBurnCurve() public {
        vm.prank(alice);
        nft.mint{value: 0.001 ether}();
        society.mint(alice, 1_000_000 ether);
        vm.prank(alice);
        society.approve(address(nft), type(uint256).max);

        uint256 expectedTotalBurn;
        for (uint8 phase = 1; phase < 10; phase++) {
            uint256 cost = nft.burnCostFor(1);
            // Phase 1: 20K, Phase 2: 30K, ..., Phase 9: 100K
            uint256 expected = (uint256(10_000) * (1 + uint256(phase))) * 1e18;
            assertEq(cost, expected, "wrong burn cost at phase");

            vm.prank(alice);
            nft.advancePhase(1);
            expectedTotalBurn += expected;
        }
        // Total burn: 20+30+40+50+60+70+80+90+100 = 540K
        assertEq(expectedTotalBurn, 540_000 * 1e18);
        assertEq(society.balanceOf(BURN_ADDRESS), 540_000 * 1e18);
    }

    // =============================================================
    //                         REVERTS
    // =============================================================

    function test_AdvancePhase_RevertWhen_NotOwner() public {
        vm.prank(alice);
        nft.mint{value: 0.001 ether}();

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(B20SocietyNFT.NotTokenOwner.selector, bob, alice)
        );
        nft.advancePhase(1);
    }

    function test_AdvancePhase_RevertWhen_NoAllowance() public {
        vm.prank(alice);
        nft.mint{value: 0.001 ether}();
        society.mint(alice, 100_000 ether);
        // No approve

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(B20SocietyNFT.InsufficientAllowance.selector, 20_000 ether, 0)
        );
        nft.advancePhase(1);
    }

    function test_AdvancePhase_RevertWhen_MaxPhaseReached() public {
        vm.prank(alice);
        nft.mint{value: 0.001 ether}();
        society.mint(alice, 10_000_000 ether);
        vm.prank(alice);
        society.approve(address(nft), type(uint256).max);

        // Advance 9 times to reach phase 10
        for (uint8 i = 0; i < 9; i++) {
            vm.prank(alice);
            nft.advancePhase(1);
        }
        assertEq(nft.phaseOf(1), 10);

        // 10th should fail
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(B20SocietyNFT.MaxPhaseReached.selector, 10)
        );
        nft.advancePhase(1);
    }

    // =============================================================
    //                         EVENTS
    // =============================================================

    function test_Mint_EmitsEvent() public {
        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit B20SocietyNFT.Minted(1, alice);
        nft.mint{value: 0.001 ether}();
    }

    function test_AdvancePhase_EmitsEvent() public {
        vm.prank(alice);
        nft.mint{value: 0.001 ether}();
        society.mint(alice, 100_000 ether);
        vm.prank(alice);
        society.approve(address(nft), 20_000 ether);

        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit B20SocietyNFT.PhaseAdvanced(1, 1, 2);
        nft.advancePhase(1);
    }

    // =============================================================
    //                    MAX SUPPLY (basic check)
    // =============================================================

    function test_MaxSupply_LimitsAt1000() public {
        // 200 wallets * 5 mints each = 1000 total
        for (uint160 i = 0; i < 200; i++) {
            address minter = address(uint160(0x10000) + i);
            vm.deal(minter, 1 ether);
            vm.startPrank(minter);
            for (uint256 j = 0; j < 5; j++) {
                nft.mint{value: 0.001 ether}();
            }
            vm.stopPrank();
        }
        assertEq(nft.totalSupply(), 1000);

        // 1001st should fail
        address overflow = address(0xCAFE);
        vm.deal(overflow, 1 ether);
        vm.prank(overflow);
        vm.expectRevert(
            abi.encodeWithSelector(B20SocietyNFT.MaxSupplyReached.selector, 1000)
        );
        nft.mint{value: 0.001 ether}();
    }

    // =============================================================
    //                         FULL FLOW
    // =============================================================

    function test_FullLifecycle() public {
        // 1. Alice mints
        vm.prank(alice);
        nft.mint{value: 0.001 ether}();
        assertEq(nft.phaseOf(1), 1);

        // 2. Alice gets SOCIETY
        society.mint(alice, 1_000_000 ether);
        vm.prank(alice);
        society.approve(address(nft), type(uint256).max);

        // 3. Alice advances to max
        for (uint8 i = 0; i < 9; i++) {
            vm.prank(alice);
            nft.advancePhase(1);
        }
        assertEq(nft.phaseOf(1), 10);

        // 4. 540K SOCIETY burned
        assertEq(society.balanceOf(BURN_ADDRESS), 540_000 ether);

        // 5. Bob can't advance Alice's NFT
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(B20SocietyNFT.NotTokenOwner.selector, bob, alice)
        );
        nft.advancePhase(1);
    }
}
