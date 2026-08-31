// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console } from "forge-std/Script.sol";

/// @title  Launch SWIM/SINK on Pons v2
/// @notice Launches the SWIM/SINK token via PonsV2LaunchFactory
///         (ponsfamily.com v2). Token is paired against native ETH
///         with creatorTaxBps=100 (1%) and uses a dynamic logo
///         pointing to b20society.com/pools/image (Vercel Edge
///         endpoint that 302-redirects to one of 3 GIFs based on
///         the SWIM market cap direction).
///
///         Usage:
///           forge script script/LaunchPonsV2.s.sol:Launch \
///             --rpc-url $ROBINHOOD_RPC_ALCHEMY \
///             --chain-id 4663 \
///             --broadcast \
///             --private-key $FLAP_PK
contract Launch is Script {
    // Pons v2 factory on Robinhood Chain
    address constant PONS_V2_FACTORY =
        0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e;

    // Creator fee recipient (FLAP_PK deployer wallet)
    address constant CREATOR_FEE_RECIPIENT =
        0x5C71128E059C3DaB0C15F565E87d14963B357abE;

    // launchConfigId=0, pairToken=0x0 (native ETH)
    uint256 constant LAUNCH_CONFIG_ID = 0;
    address constant PAIR_TOKEN = address(0);

    // Creator tax: 1% (100 bps)
    uint16 constant CREATOR_TAX_BPS = 100;

    function run() external {
        // Read pre-computed expectedEconomics for default config.
        // Re-fetched from previewLaunchEconomics(0, address(0)).
        bytes32 expectedEconomics = vm.envBytes32("EXPECTED_ECONOMICS");
        bytes32 salt = vm.envBytes32("LAUNCH_SALT");

        vm.startBroadcast();
        (address token, address curve) = _launchToken(
            "Swim Sink",
            "SWIMSINK",
            "https://b20society.com/pools/image",
            "what if your token's image changed by itself?  not animation. not random. actually watching the market.  when it pumps when it dumps when it's chill  no buttons. no refresh. the art just reacts.",
            "",
            "",
            "",
            "https://b20society.com",
            "",
            CREATOR_FEE_RECIPIENT,
            CREATOR_TAX_BPS,
            false, // buybackEnabled
            expectedEconomics,
            salt
        );
        vm.stopBroadcast();

        console.log("Token deployed at:", token);
        console.log("Curve deployed at:", curve);
        console.log("Creator fee recipient:", CREATOR_FEE_RECIPIENT);
        console.log("Creator tax: 1%");
    }

    struct Socials {
        string twitter;
        string telegram;
        string discord;
        string website;
        string farcaster;
    }

    struct TokenParams {
        string name;
        string symbol;
        string logo;
        string description;
        Socials socials;
        address creatorFeeRecipient;
        uint16 creatorTaxBps;
        bool buybackEnabled;
        bytes32 expectedEconomics;
        bytes32 salt;
    }

    function _launchToken(
        string memory name_,
        string memory symbol_,
        string memory logo_,
        string memory description_,
        string memory twitter_,
        string memory telegram_,
        string memory discord_,
        string memory website_,
        string memory farcaster_,
        address creatorFeeRecipient_,
        uint16 creatorTaxBps_,
        bool buybackEnabled_,
        bytes32 expectedEconomics_,
        bytes32 salt_
    ) internal returns (address token, address curve) {
        Socials memory socials = Socials({
            twitter: twitter_,
            telegram: telegram_,
            discord: discord_,
            website: website_,
            farcaster: farcaster_
        });
        TokenParams memory params = TokenParams({
            name: name_,
            symbol: symbol_,
            logo: logo_,
            description: description_,
            socials: socials,
            creatorFeeRecipient: creatorFeeRecipient_,
            creatorTaxBps: creatorTaxBps_,
            buybackEnabled: buybackEnabled_,
            expectedEconomics: expectedEconomics_,
            salt: salt_
        });
        (bool ok, bytes memory ret) = PONS_V2_FACTORY.call{value: 0.0005 ether}(
            abi.encodeWithSignature(
                "launchToken((string,string,string,string,(string,string,string,string,string),address,uint16,bool,bytes32,bytes32),uint256,address)",
                params,
                LAUNCH_CONFIG_ID,
                PAIR_TOKEN
            )
        );
        require(ok, string(ret));
        (token, curve) = abi.decode(ret, (address, address));
    }
}
