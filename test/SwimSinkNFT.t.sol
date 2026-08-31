// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test, console } from "forge-std/Test.sol";
import { SwimSinkNFT } from "../contracts/SwimSinkNFT.sol";

/// @dev Mock ERC-20 used to simulate the SWIM token in tests.
contract MockSwim {
    string public name = "Swim";
    string public symbol = "SWIM";
    uint8 public constant decimals = 18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract SwimSinkNFTTest is Test {
    SwimSinkNFT internal nft;
    MockSwim internal swim;

    address internal owner = address(0xABCD);
    address internal alice = address(0x1111);
    address internal bob = address(0x2222);
    address internal royaltyReceiver = address(0xDEAD);

    function setUp() public {
        swim = new MockSwim();
        nft = new SwimSinkNFT(address(swim), royaltyReceiver);
    }

    // =============================================================
    //                       CONSTANTS
    // =============================================================

    function test_constants() public view {
        assertEq(nft.MINT_PRICE(), 0.01 ether, "mint price");
        assertEq(nft.MAX_SUPPLY(), 222, "max supply");
        assertEq(nft.MAX_PER_WALLET(), 2, "max per wallet");
        assertEq(nft.INITIAL_PHASE(), 1, "initial phase");
        assertEq(nft.MAX_PHASE(), 10, "max phase");
        assertEq(nft.PHASE_DENOM(), 10_000, "phase denom");
        assertEq(nft.ROYALTY_BPS(), 500, "royalty bps");
        assertEq(nft.royaltyReceiver(), royaltyReceiver, "royalty receiver");
        assertEq(address(nft.swim()), address(swim), "swim address");
    }

    // =============================================================
    //                         MINTING
    // =============================================================

    function test_mint_happy_path() public {
        uint256 beforeBal = royaltyReceiver.balance;
        vm.deal(alice, 1 ether);

        vm.prank(alice);
        uint256 tokenId = nft.mint{value: 0.01 ether}();

        assertEq(tokenId, 1, "first token id");
        assertEq(nft.ownerOf(tokenId), alice, "owner");
        assertEq(nft.phaseOf(tokenId), 1, "initial phase");
        assertEq(nft.mintedPerWallet(alice), 1, "wallet count");
        assertEq(royaltyReceiver.balance - beforeBal, 0.01 ether, "royalty received");
    }

    function test_mint_wrong_payment_reverts() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(SwimSinkNFT.IncorrectPayment.selector, 0.005 ether, 0.01 ether)
        );
        nft.mint{value: 0.005 ether}();
    }

    function test_mint_overpayment_reverts() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(SwimSinkNFT.IncorrectPayment.selector, 0.02 ether, 0.01 ether)
        );
        nft.mint{value: 0.02 ether}();
    }

    function test_mint_max_per_wallet() public {
        vm.deal(alice, 1 ether);
        vm.startPrank(alice);
        for (uint256 i = 0; i < 2; i++) {
            nft.mint{value: 0.01 ether}();
        }
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(SwimSinkNFT.MaxPerWalletReached.selector, 2)
        );
        nft.mint{value: 0.01 ether}();
    }

    function test_mint_max_supply() public {
        // 111 wallets * 2 mints = 222, hits the cap exactly
        for (uint256 w = 0; w < 111; w++) {
            address wallet = address(uint160(0x1000 + w));
            vm.deal(wallet, 1 ether);
            vm.startPrank(wallet);
            for (uint256 i = 0; i < 2; i++) {
                nft.mint{value: 0.01 ether}();
            }
            vm.stopPrank();
        }
        assertEq(nft.totalMinted(), 222, "222 minted (cap reached)");

        // 223rd mint must revert
        address extra = address(0x9999);
        vm.deal(extra, 1 ether);
        vm.prank(extra);
        vm.expectRevert(
            abi.encodeWithSelector(SwimSinkNFT.MaxSupplyReached.selector, 222)
        );
        nft.mint{value: 0.01 ether}();
    }

    // =============================================================
    //                       PHASE LOGIC
    // =============================================================

    function test_burnCost_curve() public {
        // Mint one
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        uint256 tokenId = nft.mint{value: 0.01 ether}();

        // Phase 1 -> 2: 20K
        assertEq(nft.burnCostFor(tokenId), 20_000 * 10 ** 18, "phase 1 cost");

        // Advance through all 10 phases
        for (uint256 p = 1; p < 10; p++) {
            // Give alice enough SWIM and approve
            uint256 cost = nft.burnCostFor(tokenId);
            swim.mint(alice, cost);
            vm.prank(alice);
            swim.approve(address(nft), cost);

            vm.prank(alice);
            nft.advancePhase(tokenId);

            assertEq(nft.phaseOf(tokenId), uint8(p + 1), "phase after advance");
        }

        // Now at max phase, burnCost should be 0
        assertEq(nft.phaseOf(tokenId), 10, "at max phase");
        assertEq(nft.burnCostFor(tokenId), 0, "no cost at max");
    }

    function test_advancePhase_not_owner_reverts() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        uint256 tokenId = nft.mint{value: 0.01 ether}();

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(SwimSinkNFT.NotTokenOwner.selector, bob, alice)
        );
        nft.advancePhase(tokenId);
    }

    function test_advancePhase_max_phase_reverts() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        uint256 tokenId = nft.mint{value: 0.01 ether}();

        // Advance all 9 times
        for (uint256 p = 1; p < 10; p++) {
            uint256 cost = nft.burnCostFor(tokenId);
            swim.mint(alice, cost);
            vm.prank(alice);
            swim.approve(address(nft), cost);
            vm.prank(alice);
            nft.advancePhase(tokenId);
        }

        // Now at phase 10, try to advance again
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(SwimSinkNFT.MaxPhaseReached.selector, 10)
        );
        nft.advancePhase(tokenId);
    }

    function test_advancePhase_insufficient_allowance_reverts() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        uint256 tokenId = nft.mint{value: 0.01 ether}();

        // Has tokens but didn't approve
        swim.mint(alice, 100_000 * 10 ** 18);

        vm.prank(alice);
        vm.expectRevert();
        nft.advancePhase(tokenId);
    }

    function test_advancePhase_burns_swim() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        uint256 tokenId = nft.mint{value: 0.01 ether}();

        uint256 cost = nft.burnCostFor(tokenId); // 20K
        swim.mint(alice, cost);
        vm.prank(alice);
        swim.approve(address(nft), cost);

        uint256 aliceBefore = swim.balanceOf(alice);
        vm.prank(alice);
        nft.advancePhase(tokenId);
        uint256 aliceAfter = swim.balanceOf(alice);

        assertEq(aliceBefore - aliceAfter, cost, "alice burned cost");
        assertEq(swim.balanceOf(address(0xdEaD)), cost, "burn address received");
    }

    // =============================================================
    //                         METADATA
    // =============================================================

    function test_tokenURI() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        uint256 tokenId = nft.mint{value: 0.01 ether}();

        string memory uri = nft.tokenURI(tokenId);
        assertEq(uri, "https://b20society.com/api/swim-nft/1", "tokenURI");
    }

    function test_tokenURI_nonexistent_reverts() public {
        vm.expectRevert();
        nft.tokenURI(999);
    }

    // =============================================================
    //                         ERC2981
    // =============================================================

    function test_royaltyInfo() public view {
        (address receiver, uint256 amount) = nft.royaltyInfo(1, 1 ether);
        assertEq(receiver, royaltyReceiver, "royalty receiver");
        assertEq(amount, 0.05 ether, "5% royalty");
    }

    // =============================================================
    //                       CONSTRUCTOR
    // =============================================================

    function test_constructor_zero_address_reverts() public {
        vm.expectRevert(SwimSinkNFT.InvalidAddress.selector);
        new SwimSinkNFT(address(0), royaltyReceiver);

        vm.expectRevert(SwimSinkNFT.InvalidAddress.selector);
        new SwimSinkNFT(address(swim), address(0));
    }

    function test_supportsInterface() public view {
        assertTrue(nft.supportsInterface(0x01ffc9a7), "ERC165");
        assertTrue(nft.supportsInterface(0x80ac58cd), "ERC721");
        assertTrue(nft.supportsInterface(0x5b5e139f), "ERC721Metadata");
        assertTrue(nft.supportsInterface(0x780e9d63), "ERC721Enumerable");
        assertTrue(nft.supportsInterface(0x2a55205a), "ERC2981");
    }

    // =============================================================
    //                        ENUMERABLE
    // =============================================================

    function test_enumerable() public {
        vm.deal(alice, 1 ether);
        vm.deal(bob, 1 ether);

        vm.prank(alice);
        uint256 t1 = nft.mint{value: 0.01 ether}();
        vm.prank(bob);
        uint256 t2 = nft.mint{value: 0.01 ether}();

        assertEq(nft.totalSupply(), 2, "total supply");
        assertEq(nft.tokenByIndex(0), t1, "by index 0");
        assertEq(nft.tokenByIndex(1), t2, "by index 1");
        assertEq(nft.tokenOfOwnerByIndex(alice, 0), t1, "alice owns t1");
        assertEq(nft.tokenOfOwnerByIndex(bob, 0), t2, "bob owns t2");
    }

    // =============================================================
    //                        FUZZ
    // =============================================================

    function testFuzz_mint_payment(uint96 amount) public {
        vm.assume(amount != 0.01 ether);
        vm.deal(alice, uint256(amount) + 1 ether);
        vm.prank(alice);
        vm.expectRevert();
        nft.mint{value: amount}();
    }
}
