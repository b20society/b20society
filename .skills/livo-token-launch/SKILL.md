---
name: livo-token-launch
description: How to create a token on Livo programmatically — authentication, contract calls, metadata API, and end-to-end flow.
user_invocable: true
---

# Creating a Token on Livo

This document describes the complete flow for creating a token on the Livo launchpad programmatically (outside the frontend UI).

## Overview

Token creation follows a strict order:

1. **Build & precompute** — build the `createToken` transaction and precompute its hash (sign it offline).
2. **Submit metadata** — POST the token metadata (name, image, socials) to the Livo API, keyed by that precomputed hash.
3. **Broadcast** — broadcast the signed transaction on-chain.

**Order matters.** Steps 2 and 3 must be performed one after the other with no delay between them. The metadata is keyed by the transaction hash, which you know before broadcasting because the signed transaction's hash is deterministic.

> **Tip:** uploading an image is the slowest part of the metadata call. To launch instantly, omit the image — pass an already-pinned `imageUrl` (IPFS) in step 2, or skip it entirely and attach it within 10 minutes via `PATCH /api/tokens/image` (see the last section).

The API base URL is `https://livo.trade`.

---

## Step 1: Authenticate

All API calls require a JWT Bearer token. Obtain one by signing a message with your wallet.

### Request
```
POST /api/auth/wallet
Content-Type: application/json

{
  "address": "0xYourWalletAddress",
  "signature": "0x...",
  "message": "Sign in to Livo\nTimestamp: <unix-ms>"
}
```

The message must contain `Timestamp: <unix-ms>` where the timestamp is within the last 5 minutes.

### Response
```json
{ "token": "eyJhbGci..." }
```

Use this token as `Authorization: Bearer <token>` in all subsequent API calls. Tokens expire after 7 days.

---

## Step 2: Build the Create Token Call (on-chain)

### Factory Selection

The protocol uses two token factories. Pick one by whether the token should carry a post-graduation Uniswap LP fee for the creator:

```
if (creator takes a post-graduation LP fee):
    use LivoFactoryUniV4Unified   // graduates to Uniswap V4
else:
    use LivoFactoryUniV2Unified   // graduates to Uniswap V2
```

Both factories take the same struct-based `createToken`, differing only in one extra `UniV4Configs` struct on the V4 factory.

### Contract Addresses

Grab the factory addresses — `LivoFactoryUniV2Unified (proxy)` and `LivoFactoryUniV4Unified (proxy)` — from the per-chain deployment files:

- **Ethereum**: https://github.com/LivoLaunchpad/livo-contracts/blob/main/deployments.ethereum.mainnet.md
- **Robinhood**: https://github.com/LivoLaunchpad/livo-contracts/blob/main/deployments.robinhood.mainnet.md

All contracts are verified on their block explorer — fetch ABIs from there.

### Function Signatures

The V2 and V4 factories take the same arguments; the V4 factory inserts one extra `univ4Configs` struct in position 3.

```solidity
// V2 — LivoFactoryUniV2Unified (graduates to Uniswap V2)
function createToken(
    TokenSetupTiered tokenSetup,
    TaxConfigs taxConfigs,
    SupplyShare[] buyOnDeployShares,
    AntiSniperConfigs antiSniperConfigs,
    CreatorVault[] creatorVaults,
    address referral
) payable returns (address token);

// V4 — LivoFactoryUniV4Unified (graduates to Uniswap V4; adds univ4Configs)
function createToken(
    TokenSetupTiered tokenSetup,
    TaxConfigs taxConfigs,
    UniV4Configs univ4Configs,    // V4 only, position 3
    SupplyShare[] buyOnDeployShares,
    AntiSniperConfigs antiSniperConfigs,
    CreatorVault[] creatorVaults,
    address referral
) payable returns (address token);
```

Total supply is always `1_000_000_000e18`. All bps values are basis points (`10000` = 100%). To disable a feature, pass a zeroed struct (tax, anti-sniper) or an empty array (buy-on-deploy, creator vaults).

### Structs

```solidity
struct TokenSetupTiered {
    string  name;            // non-empty string
    string  symbol;          // non-empty, <= 96 bytes on-chain
    bytes32 salt;            // mined so the address ends in 0x1110 (see Vanity Salt)
    FeeShare[] feeShares;    // trading-fee recipients; shares sum to 10000
    LiquidityTier liquidityTier; // 0=THIN, 1=DEFAULT, 2=THICK (set explicitly)
}

struct FeeShare {
    address account;
    uint256 shares;            // bps, > 0; array sums to exactly 10000
    bool    directFeesEnabled; // at most ONE entry may be true
}

struct TaxConfigs {
    uint16 buyTaxBps;          // long-term buy tax; 0 disables static tax
    uint16 sellTaxBps;         // long-term sell tax; 0 disables static tax
    uint32 taxDurationSeconds; // static-tax window; 0 disables (then bps must be 0)
    bool   startTaxFromLaunch; // true: window from launch; false: from graduation
    uint16 buyTaxDecayStartBps;  // optional launch-tax decay start (buy); 0 = none
    uint16 sellTaxDecayStartBps; // optional launch-tax decay start (sell); 0 = none
    uint32 taxDecayDuration;     // decay window; 0 disables; max 20 min
}

struct UniV4Configs {        // V4 factory only
    bool   renounceOwnership; // true → deployed ownerless; false → owner = msg.sender
    uint16 lpFeeBps;          // post-graduation hook fee: must be 100 or 50
}

struct SupplyShare {
    address account;
    uint256 shares;            // bps, > 0; array sums to exactly 10000
}

struct AntiSniperConfigs {
    uint16  maxBuyPerTxBps;          // 10..300 (0.1%..3% of supply)
    uint16  maxWalletBps;            // 10..300, and >= maxBuyPerTxBps
    uint40  protectionWindowSeconds; // 0 disables; else 60..86400 (1min..24h)
    address[] whitelist;             // <= 20 addresses; bypass caps in the window
}

struct CreatorVault {
    address owner;
    uint256 supplyBps;     // non-zero multiple of 500 (5%); sum across vaults <= 3000 (30%)
    uint256 cliffSeconds;  // pure lock-up before vesting
    uint256 vestingSeconds;// linear vesting after the cliff
}
```

**Field notes:**

- **`feeShares`** — non-zero, unique accounts; every `shares > 0`; the array sums to exactly `10000`. At most one entry may set `directFeesEnabled` (fees forwarded on each accrual instead of pull-claimed).
- **`liquidityTier`** — post-graduation pool depth + graduation marketcap. `0 = THIN` (1.75 ETH liq / 6.125 ETH mcap), `1 = DEFAULT` (3.5 / 12.25), `2 = THICK` (7.0 / 24.5). A zero-initialised field resolves to THIN, not DEFAULT, so set it explicitly.
- **`taxConfigs`** — static tax and launch-tax decay are independent; set either, both, or neither. The effective rate a trade pays per direction is `max(decay, static)`. Static tax is capped by `lpFeeBps + tax <= 500`: V2 has no LP fee, so up to 500 bps (5%); V4 leaves 400 bps (100-bps hook) or 450 bps (50-bps hook). A configured decay start must be strictly greater than the direction's static rate; combined (buy + sell) decay start `<= 2000` bps.
- **`univ4Configs`** (V4 only) — `renounceOwnership` true → `tokenOwner = address(0)`, false → `tokenOwner = msg.sender`. `lpFeeBps` must be `100` (1%) or `50` (0.5%). V2 has no equivalent: V2 tokens are always ownerless with no post-graduation LP fee.
- **`buyOnDeployShares`** — optional deployer buy. The `SupplyShare[]` only splits the bought tokens across recipients (bps summing to `10000`); the *amount* bought is set by the ETH you send (`msg.value`). `value > 0 ⇔ array non-empty` (one without the other reverts); pass `[]` when not buying. The buy is bounded by the bonding curve, not a fixed percentage: its ceiling is the token's graduation amount, which shrinks with the `liquidityTier` threshold and with any creator-vault reserved supply. Read the exact ceiling from `maxBuyOnDeploy(tier, totalLockedInVaultsBps)` and size `value` with `quoteBuyOnDeploy(...)`; overshooting reverts `MaxEthReservesExceeded`. See [Sizing the creator-buy](#sizing-the-creator-buy-and-the-max-buy-special-case).
- **`antiSniperConfigs`** — opt-in via a non-zero `protectionWindowSeconds`. To disable, pass all zeros / empty array (sentinel: if the window is 0, every other field must be 0/empty).
- **`creatorVaults`** — optional vesting vaults that lock part of the supply at deploy. Empty array = none. Max 5 vaults; the sum of `supplyBps` `<= 3000` (30%). Locked supply selects an allocation-specific bonding curve for the tier.
- **`referral`** — reserved for future relayer payouts. Nothing is wired to it on-chain yet — a non-zero value only emits `TokenReferral(token, referral)`, with no storage or payout. **Pass `address(0)` for now.**

### Sizing the creator-buy (and the max-buy special case)

The deploy-buy amount is **not** a fixed percentage of supply — it is bounded by the bonding curve. The ceiling is the token's graduation amount, which depends on the `liquidityTier` threshold and on any creator-vault reserved supply. Two views drive it:

```solidity
function maxBuyOnDeploy(uint8 tier, uint256 totalLockedInVaultsBps) view returns (uint256 maxTokens);

// V2:
function quoteBuyOnDeploy(uint8 tier, uint256 tokenAmount, uint256 totalLockedInVaultsBps, TaxConfigs taxConfigs) view returns (uint256 totalEthNeeded);

// V4 appends univ4Configs ({ renounceOwnership, lpFeeBps }) as a 5th arg.
```

1. `maxBuyOnDeploy(tier, totalLockedInVaultsBps)` → the largest token amount a deploy-buy can take (the amount that reaches graduation). `totalLockedInVaultsBps` is the sum of `creatorVaults[].supplyBps` (0 when there are no vaults), so reserving vault supply lowers the ceiling.
2. Pick any `tokenAmount <= maxTokens`, then `quoteBuyOnDeploy(tier, tokenAmount, totalLockedInVaultsBps, taxConfigs)` → the exact `value` (msg.value) to send. The quote inflates the raw curve cost by the launch buy fee (tax / trading fee).
3. Send `value` as `msg.value`; the bought `tokenAmount` is split across `buyOnDeployShares`.

**Max-buy special case:** passing `tokenAmount = maxTokens` makes the deploy-buy reach graduation, so the token graduates in the same transaction. Overshooting the ceiling reverts `MaxEthReservesExceeded`.

```javascript
const tier = tokenSetup.liquidityTier;
const totalLockedInVaultsBps = creatorVaults.reduce((s, v) => s + v.supplyBps, 0n); // 0n if none

const maxTokens = await publicClient.readContract({
  address: FACTORY_ADDRESS,
  abi: factoryAbi,
  functionName: "maxBuyOnDeploy",
  args: [tier, totalLockedInVaultsBps],
});
const tokenAmount = maxTokens;  // max-buy: graduates on deploy. Or any amount <= maxTokens.

const value = await publicClient.readContract({
  address: FACTORY_ADDRESS,
  abi: factoryAbi,
  functionName: "quoteBuyOnDeploy",
  // V4 appends the univ4Configs struct as a 5th arg.
  args: [tier, tokenAmount, totalLockedInVaultsBps, taxConfigs],
});

// pass `value` as the tx value; split the bought tokens across recipients
const buyOnDeployShares = [{ account: account.address, shares: 10000n }];
```

### Token Implementation Selection

The factory clones a taxable or a base implementation depending on whether tax is configured (anti-sniper is a gated feature of both impls, not a separate one). Mine the vanity salt against the impl that `previewTokenImplementation(...)` returns for your exact inputs:

```solidity
function previewTokenImplementation(
    FeeShare[] feeShares,
    SupplyShare[] buyOnDeployShares,
    TaxConfigs taxConfigs,
    AntiSniperConfigs antiSniperConfigs
) view returns (address);
```

If the dispatch-relevant inputs (tax vs base) differ between preview and submit, the cloned address won't match what you mined and the call reverts with `InvalidTokenAddress`.

### Vanity Salt Mining

The factory uses CREATE2; the deployed token address must end in `0x1110` (last 2 bytes). The salt is namespaced by the deployer: the effective CREATE2 salt is `keccak256(abi.encodePacked(msg.sender, salt))`, so mining must include the address that will send `createToken` — a salt mined for one sender yields a different address for another (front-run defense). ~65k iterations on average (sub-100ms).

```javascript
import { getCreate2Address, keccak256, concat, encodePacked, toHex, pad } from "viem";

const PROXY_PREFIX = "0x3d602d80600a3d3981f3363d3d373d3d3d363d73";
const PROXY_SUFFIX = "0x5af43d82803e903d91602b57fd5bf3";

/**
 * @param {`0x${string}`} factoryAddress - The factory contract address (CREATE2 deployer).
 * @param {`0x${string}`} tokenImplementation - Implementation returned by previewTokenImplementation().
 * @param {`0x${string}`} deployer - The account that will send the createToken tx (msg.sender on the factory).
 */
function findVanitySalt(factoryAddress, tokenImplementation, deployer) {
  const initcodeHash = keccak256(concat([PROXY_PREFIX, tokenImplementation, PROXY_SUFFIX]));
  for (let i = 0n; ; i++) {
    const salt = pad(toHex(i), { size: 32 });
    // factory derives the effective CREATE2 salt as keccak256(deployer ++ salt)
    const effectiveSalt = keccak256(encodePacked(["address", "bytes32"], [deployer, salt]));
    const addr = getCreate2Address({ from: factoryAddress, salt: effectiveSalt, bytecodeHash: initcodeHash });
    if (addr.toLowerCase().endsWith("1110")) return { salt, tokenAddress: addr };
  }
}
```

Recompute the initcode hash whenever the dispatch path (tax vs base) changes.

### Validation Rules

All errors are 4-byte custom errors. The ones most likely to revert:

- **name** — non-empty (metadata API caps it at 96 chars).
- **symbol** — non-empty, `<= 96` bytes on-chain (metadata API caps it at 96 chars).
- **feeShares / buyOnDeployShares** — every share `> 0`; unique non-zero accounts; must sum to exactly `10000`.
- **buyTaxBps / sellTaxBps** — `lpFeeBps + tax <= 500` (V2: `<= 500`; V4: `<= 400` or `450`).
- **taxDurationSeconds** — `0` to disable, else up to ~120 years; if non-zero, a buy or sell tax must be set. No fee-receiver or ownership constraints at any duration.
- **taxDecayDuration** — `0` to disable, else `<= 20 min`; combined decay start `<= 2000` bps.
- **liquidityTier** — `0`, `1`, or `2` — set explicitly.
- **lpFeeBps** (V4) — must be `100` or `50`.
- **antiSniper** (when window enabled) — `maxBuyPerTxBps` 10-300; `maxWalletBps` 10-300 and `>= maxBuyPerTxBps`; window 60-86400; whitelist `<= 20`.
- **creatorVaults** — `supplyBps` a multiple of 500, sum `<= 3000`; `<= 5` vaults.

---

## Step 3: Precompute the Transaction Hash

Encode the `createToken` call, build an EIP-1559 transaction, sign it offline, and take the keccak256 of the signed RLP payload. That digest is the txHash you submit to the API in Step 4 — and the same hash the network assigns once you broadcast in Step 5.

```javascript
import { keccak256, encodeFunctionData } from "viem";

// tokenSetup, taxConfigs, antiSniperConfigs built as in Step 2; salt from the Vanity Salt section.
const data = encodeFunctionData({
  abi: factoryAbi,
  functionName: "createToken",
  // V2 factory args — the V4 factory inserts univ4Configs ({ renounceOwnership, lpFeeBps })
  // in position 3, right after taxConfigs.
  args: [tokenSetup, taxConfigs, buyOnDeployShares, antiSniperConfigs, creatorVaults, referral],
});

const fees = await publicClient.estimateFeesPerGas();
const tx = {
  type: "eip1559",
  chainId,
  nonce: await publicClient.getTransactionCount({ address: account.address }),
  to: factoryAddress,
  data,
  value: 0n, // > 0 only for a deployer buy (buyOnDeployShares non-empty)
  gas: await publicClient.estimateGas({ account, to: factoryAddress, data }),
  maxFeePerGas: fees.maxFeePerGas,
  maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
};
const signedTx = await walletClient.signTransaction(tx);
const txHash = keccak256(signedTx);
```

---

## Step 4: Submit Metadata to API (off-chain)

Submit token metadata to the API **before** broadcasting the transaction, using the precomputed txHash from Step 3.

### Request
```
POST /api/tokens/create
Authorization: Bearer <jwt>
Content-Type: multipart/form-data

Fields:
  txHash       (required)  0x-prefixed, 66-character hex string (precomputed in Step 3)
  name         (required)  token name, max 96 characters
  symbol       (required)  token symbol, max 96 chars
  chainId      (required)  1 (mainnet), 11155111 (sepolia), 4663 (Robinhood), 46630
                            (Robinhood testnet), 5042 (Arc), 5042002 (Arc testnet)
  description  (optional)  max 250 characters
  socials      (optional)  JSON array of up to 5 http(s) URL strings, e.g.
                            ["https://x.com/foo","https://t.me/bar"]. The icon is
                            derived from each URL; invalid entries are dropped server-side.
  image        (optional)  JPEG, PNG, GIF, or WebP, max 5MB. Uploading a file is the
                            slow path.
  imageUrl     (optional)  an already-pinned IPFS reference (ipfs:// or an /ipfs/ gateway
                            URL). IPFS only. Skips the upload. If both image and imageUrl
                            are sent, the uploaded file wins.
```

### Response (success)
```json
{
  "success": true,
  "txHash": "0x...",
  "imageUrl": "https://..."
}
```

### Error Responses
| Status | Meaning                                              |
| ------ | ---------------------------------------------------- |
| 400    | Validation error (missing fields, invalid format, etc.) |
| 401    | Unauthorized (missing or invalid JWT)                  |
| 409    | Metadata already exists for this txHash                |
| 500    | Server error                                          |

---

## Step 5: Broadcast the Transaction

As soon as the metadata POST returns successfully, broadcast the signed transaction from Step 3. **Steps 4 and 5 must be performed back-to-back with no delay between them.**

```javascript
const hash = await publicClient.sendRawTransaction({
  serializedTransaction: signedTx,
});
// hash === txHash submitted in Step 4
```

---

## Complete End-to-End Example (viem + fetch)

Minimal token via the V2 factory: single fee receiver, no tax, no anti-sniper, no vaults, no buy-on-deploy, DEFAULT liquidity tier.

```javascript
import {
  createPublicClient, createWalletClient, http, keccak256, encodeFunctionData, zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
// import { findVanitySalt } from "./findVanitySalt"; // from the Vanity Salt section

const API_BASE = "https://livo.trade";
const FACTORY_ADDRESS = "0x..."; // LivoFactoryUniV2Unified (proxy) — see deployment files
const factoryAbi = [/* fetch from the block explorer */];

const account = privateKeyToAccount(process.env.PRIVATE_KEY);
const publicClient = createPublicClient({ chain: mainnet, transport: http() });
const walletClient  = createWalletClient({ account, chain: mainnet, transport: http() });

// 1. Authenticate
const timestamp = Date.now();
const message = `Sign in to Livo\nTimestamp: ${timestamp}`;
const signature = await walletClient.signMessage({ account, message });
const { token: jwt } = await fetch(`${API_BASE}/api/auth/wallet`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ address: account.address, signature, message }),
}).then((r) => r.json());

// 2. Build the createToken structs
const name = "My Token";
const symbol = "MTK";
const feeShares = [{ account: account.address, shares: 10000n, directFeesEnabled: false }];
const taxConfigs = {
  buyTaxBps: 0, sellTaxBps: 0, taxDurationSeconds: 0, startTaxFromLaunch: false,
  buyTaxDecayStartBps: 0, sellTaxDecayStartBps: 0, taxDecayDuration: 0,
};
const antiSniperConfigs = { maxBuyPerTxBps: 0, maxWalletBps: 0, protectionWindowSeconds: 0, whitelist: [] };
const buyOnDeployShares = []; // empty ⇒ no deployer buy (value must be 0)
const creatorVaults = [];

// The factory clones a taxable or base impl depending on the tax config; mine the
// vanity salt against the impl this view returns for THESE exact inputs.
const tokenImplementation = await publicClient.readContract({
  address: FACTORY_ADDRESS, abi: factoryAbi, functionName: "previewTokenImplementation",
  args: [feeShares, buyOnDeployShares, taxConfigs, antiSniperConfigs],
});
const { salt } = findVanitySalt(FACTORY_ADDRESS, tokenImplementation, account.address);

const tokenSetup = { name, symbol, salt, feeShares, liquidityTier: 1 /* DEFAULT */ };
const data = encodeFunctionData({
  abi: factoryAbi, functionName: "createToken",
  // V2 args; the V4 factory inserts { renounceOwnership, lpFeeBps } in position 3.
  args: [tokenSetup, taxConfigs, buyOnDeployShares, antiSniperConfigs, creatorVaults, zeroAddress],
});

// 3. Sign the transaction offline and precompute the txHash
const fees = await publicClient.estimateFeesPerGas();
const tx = {
  type: "eip1559", chainId: mainnet.id,
  nonce: await publicClient.getTransactionCount({ address: account.address }),
  to: FACTORY_ADDRESS, data, value: 0n,
  gas: await publicClient.estimateGas({ account, to: FACTORY_ADDRESS, data }),
  maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
};
const signedTx = await walletClient.signTransaction(tx);
const txHash = keccak256(signedTx);

// 4. Submit metadata BEFORE broadcasting (must be immediately followed by step 5)
const form = new FormData();
form.append("txHash", txHash);
form.append("name", name);
form.append("symbol", symbol);
form.append("chainId", String(mainnet.id));
form.append("description", "An example token");
form.append("socials", JSON.stringify(["https://x.com/yourproject", "https://t.me/yourproject"]));
// form.append("image", imageFile); // optional File / Blob
const metaRes = await fetch(`${API_BASE}/api/tokens/create`, {
  method: "POST", headers: { Authorization: `Bearer ${jwt}` },
  body: form,
});
if (!metaRes.ok) throw new Error(`metadata POST failed: ${await metaRes.text()}`);

// 5. Broadcast immediately — no delay allowed between steps 4 and 5
const broadcastedHash = await publicClient.sendRawTransaction({
  serializedTransaction: signedTx,
});
console.log("token tx:", broadcastedHash); // === txHash
```

---

## Set the Image Later (optional)

To launch as fast as possible, create the token with metadata only (no `image` / `imageUrl` in Step 4) and attach the image within **10 minutes** of the on-chain creation. The window is measured from the token's on-chain creation timestamp, so the token must already be indexed (a few seconds after broadcast); call again if it returns `409`.

```
PATCH /api/tokens/image
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "txHash": "0x...",       // or "tokenAddress": "0x..."
  "imageUrl": "ipfs://..." // IPFS only (ipfs:// or /ipfs/ gateway URL)
}
```

Only the token's original creator (the authenticated wallet that submitted the metadata) may set the image. Returns `403` after the 10-minute window closes. The image can only be set once — a token that already has an image returns `409`.

---

## ABIs

All Livo contracts are verified on their block explorer. To get the ABI for any contract:

1. Get the contract address from the deployment files (see [Contract Addresses](#contract-addresses) above).
2. Look it up on the chain's explorer (Ethereum mainnet: `etherscan.io`).
3. Use the "Read/Write Contract" or explorer API.

Key contracts and their roles:

- **`LivoFactoryUniV2Unified` / `LivoFactoryUniV4Unified`** — `createToken`, `previewTokenImplementation`, `quoteBuyOnDeploy`.
- **`LivoLaunchpad`** — `buyTokensWithExactEth`, `sellExactTokens`, quote functions (post-creation trading on the bonding curve).

## Key Events

After token creation, the factory emits:
```solidity
event TokenCreated(
    address indexed token,
    string name, string symbol,
    address tokenOwner, address launchpad, address graduator, address feeHandler
);
```

The launchpad emits:
```solidity
event TokenLaunched(address indexed token, uint256 graduationThreshold, uint256 maxExcessOverThreshold);
```

The V4 factory additionally emits `LpFeeBpsSet(token, lpFeeBps)`, and a non-zero `referral` emits `TokenReferral(token, referral)`. You already know the token address deterministically from the mined salt; `TokenCreated` / `TokenLaunched` in the receipt confirm it.

## Notes

- Token creation is free (no ETH cost beyond gas) — unless you buy supply on deploy (`value > 0`).
- Tokens start on a bonding curve managed by `LivoLaunchpad` and automatically graduate to Uniswap once enough ETH is raised. The threshold scales with the chosen `liquidityTier` — DEFAULT graduates at the original depth (~3.5 ETH of liquidity), THIN at half, THICK at double.
- The `image` field on the metadata API is a raw file upload; the API pins it to IPFS via Pinata. To skip the upload, pass an already-pinned `imageUrl` (IPFS only) instead, or attach the image after creation via `PATCH /api/tokens/image`.
