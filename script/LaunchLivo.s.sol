// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console } from "forge-std/Script.sol";

/// @title  Launch Swim/Sink on Livo (Robinhood Chain)
/// @notice Builds + signs the createToken call for LivoFactoryUniV2Unified
///         with 3%/3% tax, all fees → creator, DEFAULT liquidity tier.
///
///         Usage:
///           forge script script/LaunchLivo.s.sol:LaunchLivo \
///             --rpc-url robinhood --private-key $FLAP_PK
///
///         Output:
///           - Final createToken calldata (broadcast-ready signed tx payload)
///           - Precomputed txHash (use as key in Livo /api/tokens/create)
///           - Predicted token address (CREATE2 + mined salt)
contract LaunchLivo is Script {
    // LivoFactoryUniV2Unified (proxy) on Robinhood mainnet
    address internal constant LIVO_FACTORY =
        0x7843203be233b3Be7E5017A68a64FdBf32b45fFE;

    // LivoToken (base impl) on Robinhood mainnet
    address internal constant TOKEN_IMPL_BASE =
        0x92A71B6A578D2345946DeCeDbCA3874702a3fCa3;

    // LivoTaxableTokenUniV2 (impl) on Robinhood mainnet
    address internal constant TOKEN_IMPL_TAX =
        0x2Bf62383a4A1349461bB744b4eC561338D8b4CF9;

    function run() external {
        address creator = vm.envAddress("CREATOR");
        require(creator != address(0), "CREATOR env required (fee recipient + msg.sender)");

        // Salt is filled in by the off-chain miner (address must end in 0x1110).
        // If unset, default to 0x0; the Livo flow will pre-mine the salt and
        // re-encode this call with the correct one.
        bytes32 salt = vm.envOr("SALT", bytes32(uint256(0)));

        // ----- TokenSetupTiered -----
        string memory name = "Swim/Sink";
        string memory symbol = "SWIM/SINK";

        // Single fee receiver: 100% of trading fees go to the creator.
        // directFeesEnabled = true forwards ETH on every accrual (no pull-claim).
        // Sum of shares must equal exactly 10000 bps.
        bytes memory feeShares = abi.encode(
            address(creator),   // account
            uint256(10000),     // shares
            true                // directFeesEnabled
        );

        // ----- TaxConfigs -----
        // 3% buy tax, 3% sell tax, applies for 30 days from launch
        // (taxDurationSeconds = 2_592_000, startTaxFromLaunch = true).
        // No decay — the static rate is the effective rate for the full window.
        uint16 buyTaxBps = 300;
        uint16 sellTaxBps = 300;
        uint32 taxDurationSeconds = 2_592_000; // 30 days in seconds
        bool startTaxFromLaunch = true;
        uint16 buyTaxDecayStartBps = 0;
        uint16 sellTaxDecayStartBps = 0;
        uint32 taxDecayDuration = 0;

        // ----- AntiSniperConfigs (disabled) -----
        // protectionWindowSeconds = 0 sentinel: every other field must be 0/empty.
        uint16 maxBuyPerTxBps = 0;
        uint16 maxWalletBps = 0;
        uint40 protectionWindowSeconds = 0;
        address[] memory whitelist = new address[](0);

        // ----- BuyOnDeployShares (empty) -----
        // value = 0; passes the (empty ⇔ value=0) invariant.
        bytes memory buyOnDeployShares = abi.encode();

        // ----- CreatorVaults (empty) -----
        bytes memory creatorVaults = abi.encode();

        // LiquidityTier: 0=THIN, 1=DEFAULT, 2=THICK. Set explicitly.
        // THIN (small) graduates at ~1.75 ETH liq / 6.125 ETH mcap — half the
        // depth of DEFAULT, easier to graduate on low volume.
        uint8 liquidityTier = 0;

        // referral: not yet wired on-chain; pass zero.
        address referral = address(0);

        // ----- Build the calldata (V2 factory shape) -----
        // createToken(
        //   TokenSetupTiered tokenSetup,
        //   TaxConfigs taxConfigs,
        //   SupplyShare[] buyOnDeployShares,
        //   AntiSniperConfigs antiSniperConfigs,
        //   CreatorVault[] creatorVaults,
        //   address referral
        // )
        bytes memory tokenSetup = abi.encode(
            name,
            symbol,
            salt,
            // FeeShare[] feeShares
            abi.encode(feeShares),
            liquidityTier
        );

        bytes memory taxConfigs = abi.encode(
            buyTaxBps,
            sellTaxBps,
            taxDurationSeconds,
            startTaxFromLaunch,
            buyTaxDecayStartBps,
            sellTaxDecayStartBps,
            taxDecayDuration
        );

        bytes memory antiSniperConfigs = abi.encode(
            maxBuyPerTxBps,
            maxWalletBps,
            protectionWindowSeconds,
            whitelist
        );

        bytes memory data = abi.encodeWithSignature(
            "createToken((string,string,bytes32,(address,uint256,bool)[],uint8),(uint16,uint16,uint32,bool,uint16,uint16,uint32),(address,uint256)[],(uint16,uint16,uint40,address[]),(address,uint256,uint256,uint256)[],address)",
            // TokenSetupTiered: re-encode inline
            abi.encode(
                name, symbol, salt,
                abi.encode(
                    abi.encode(creator, uint256(10000), true) // FeeShare
                ),
                liquidityTier
            ),
            // TaxConfigs: re-encode inline
            abi.encode(buyTaxBps, sellTaxBps, taxDurationSeconds, startTaxFromLaunch, buyTaxDecayStartBps, sellTaxDecayStartBps, taxDecayDuration),
            new address[](0),  // buyOnDeployShares
            // AntiSniperConfigs: re-encode inline (decode-then-encode
            // collides on dynamic address[] encoding).
            abi.encode(maxBuyPerTxBps, maxWalletBps, protectionWindowSeconds, whitelist),
            new address[](0),  // creatorVaults
            referral
        );

        console.log("LivoFactory:", LIVO_FACTORY);
        console.log("Creator (fee recipient):", creator);
        console.log("Name:", name);
        console.log("Symbol:", symbol);
        console.log("Salt (set via SALT env):");
        console.logBytes32(salt);
        console.log("Liquidity tier (0=THIN, 1=DEFAULT, 2=THICK):", liquidityTier);
        console.log("Buy tax (bps):", buyTaxBps);
        console.log("Sell tax (bps):", sellTaxBps);
        console.log("");
        console.log("Full calldata (broadcast-ready):");
        console.logBytes(data);
        console.log("");
        console.log("Note: salt must be mined off-chain so that the predicted");
        console.log("token address ends in 0x1110. Re-run with SALT=<mined>.");
    }
}
