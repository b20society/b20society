// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console } from "forge-std/Script.sol";
import { B20SocietyNFT } from "../contracts/B20SocietyNFT.sol";

/// @title  Deploy B20SocietyNFT
/// @notice Deploys the B20 Society NFT contract with a predicted SOCIETY
///         token address. Run AFTER o1's API `launches:prepare` returns a
///         predicted address and BEFORE broadcasting the o1 launch.
///
///         Usage:
///           SOCIETY=<predicted_address> \
///           ROYALTY_RECEIVER=<recipient> \
///           forge script script/Deploy.s.sol:Deploy \
///             --rpc-url base --broadcast --private-key $PK
contract Deploy is Script {
    function run() external {
        address society = vm.envAddress("SOCIETY");
        address royaltyReceiver = vm.envAddress("ROYALTY_RECEIVER");
        require(society != address(0), "SOCIETY env required");
        require(royaltyReceiver != address(0), "ROYALTY_RECEIVER env required");

        vm.startBroadcast();
        B20SocietyNFT nft = new B20SocietyNFT(society, royaltyReceiver);
        vm.stopBroadcast();

        console.log("B20SocietyNFT deployed at:", address(nft));
        console.log("SOCIETY:", society);
        console.log("Royalty receiver:", royaltyReceiver);
    }
}
