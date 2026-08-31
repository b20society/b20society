// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console } from "forge-std/Script.sol";
import { SwimSinkNFT } from "../contracts/SwimSinkNFT.sol";

/// @title  Deploy SwimSinkNFT
/// @notice Deploys the Swim/Sink Society NFT on Robinhood Chain.
///
///         Usage:
///           SWIM=0x02EAAFA953BA4723F2b690D0d67774290fc5445B \
///           ROYALTY_RECEIVER=0x5C71128E059C3DaB0C15F565E87d14963B357abE \
///           forge script script/DeploySwimNFT.s.sol:Deploy \
///             --rpc-url robinhood --broadcast --private-key $FLAP_PK
contract DeploySwimNFT is Script {
    function run() external {
        address swim = vm.envAddress("SWIM");
        address royaltyReceiver = vm.envAddress("ROYALTY_RECEIVER");
        require(swim != address(0), "SWIM env required");
        require(royaltyReceiver != address(0), "ROYALTY_RECEIVER env required");

        vm.startBroadcast();
        SwimSinkNFT nft = new SwimSinkNFT(swim, royaltyReceiver);
        vm.stopBroadcast();

        console.log("SwimSinkNFT deployed at:", address(nft));
        console.log("SWIM token:", swim);
        console.log("Royalty receiver:", royaltyReceiver);
        console.log("Mint price: 0.01 ETH");
        console.log("Max supply: 222");
        console.log("Max per wallet: 2");
    }
}
