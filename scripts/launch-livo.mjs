// End-to-end Livo (livo.trade) launch script for Swim/Sink.
//
// Flow (per livo-token-launch skill):
//   1. Build createToken calldata (no salt yet)
//   2. Auth with Livo (sign-in wallet) → JWT
//   3. previewTokenImplementation() to know which impl to mine against
//   4. Mine vanity salt (predicted address ends in 0x1110)
//   5. Re-encode createToken calldata with the mined salt
//   6. Sign offline → keccak256(signedTx) = precomputed txHash
//   7. POST metadata to Livo (with the GIF as multipart `image` — Livo
//      pins via their own Pinata, we don't need our own Pinata JWT)
//   8. Save /tmp/livo-launch.json (signedTx + txHash) — broadcast-ready.
//      WAIT for "go" before sending sendRawTransaction.
//
// Requirements:
//   - FLAP_PK env var (deployer / fee recipient)
//
// Run:
//   FLAP_PK=... node scripts/launch-livo.mjs
//
//   After the script prints the predicted token + txHash, review and run:
//   node scripts/launch-livo-broadcast.mjs

import {
  createPublicClient,
  http,
  keccak256,
  encodePacked,
  encodeFunctionData,
  pad,
  toHex,
  concat,
  getCreate2Address,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";
import { readFileSync, writeFileSync } from "fs";

const CHAIN_ID = 4663;
const FACTORY = "0x7843203be233b3Be7E5017A68a64FdBf32b45fFE";
const PROXY_PREFIX = "0x3d602d80600a3d3981f3363d3d373d3d3d363d73";
const PROXY_SUFFIX = "0x5af43d82803e903d91602b57fd5bf3";

const FLAP_PK = process.env.FLAP_PK;
if (!FLAP_PK) { console.error("FLAP_PK env required"); process.exit(1); }

const rpcUrl =
  process.env.ROBINHOOD_RPC_ALCHEMY ??
  "https://robinhood-mainnet.g.alchemy.com/v2/-d5tRgRg5RkHMPvZrTwRV";
const robinhood = defineChain({
  id: CHAIN_ID,
  name: "Robinhood Chain",
  network: "robinhood",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});
const publicClient = createPublicClient({ chain: robinhood, transport: http(rpcUrl) });
const account = privateKeyToAccount(FLAP_PK);

// Factory ABI (relevant functions only)
const factoryAbi = JSON.parse(readFileSync("/tmp/livo_v2_factory_abi.json"));

// --- Step 1: Read swim.gif for later Livo upload ---
console.log("=== Step 1: Read swim.gif for Livo upload ===");
const swimGif = readFileSync("/workspace/b20society/public/images/pools/swim.gif");
console.log(`  swim.gif: ${swimGif.length} bytes (Livo will pin via their Pinata)`);

// --- Step 2: Livo auth ---
console.log("\n=== Step 2: Livo auth ===");
const timestamp = Date.now();
const message = `Sign in to Livo\nTimestamp: ${timestamp}`;
const signature = await account.signMessage({ message });
const authRes = await fetch("https://www.livo.trade/api/auth/wallet", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ address: account.address, signature, message }),
});
if (!authRes.ok) {
  console.error("Auth failed:", authRes.status, await authRes.text());
  process.exit(1);
}
const { token: jwt } = await authRes.json();
console.log(`  JWT acquired (${jwt.slice(0, 24)}...)`);

// --- Step 3: previewTokenImplementation ---
// With 3% buy/sell tax → taxable impl, so we mine against TOKEN_IMPL_TAX.
console.log("\n=== Step 3: previewTokenImplementation() ===");
const feeShares = [{ account: account.address, shares: 10000n, directFeesEnabled: true }];
const buyOnDeployShares = []; // empty
const taxConfigs = {
  buyTaxBps: 300,
  sellTaxBps: 300,
  taxDurationSeconds: 2_592_000, // 30 days
  startTaxFromLaunch: true,
  buyTaxDecayStartBps: 0,
  sellTaxDecayStartBps: 0,
  taxDecayDuration: 0,
};
const antiSniperConfigs = {
  maxBuyPerTxBps: 0,
  maxWalletBps: 0,
  protectionWindowSeconds: 0,
  whitelist: [],
};
const tokenImpl = await publicClient.readContract({
  address: FACTORY,
  abi: factoryAbi,
  functionName: "previewTokenImplementation",
  args: [feeShares, buyOnDeployShares, taxConfigs, antiSniperConfigs],
});
console.log(`  Implementation: ${tokenImpl}`);

// --- Step 4: Mine vanity salt (address ends in 0x1110) ---
console.log("\n=== Step 4: Mine vanity salt ===");
const initcodeHash = keccak256(concat([PROXY_PREFIX, tokenImpl, PROXY_SUFFIX]));
const deployer = account.address;
let salt = "0x0000000000000000000000000000000000000000000000000000000000000000";
let predictedAddress = null;
const t0 = Date.now();
for (let i = 0n; i < 1_000_000n; i++) {
  const s = pad(toHex(i), { size: 32 });
  const effectiveSalt = keccak256(encodePacked(["address", "bytes32"], [deployer, s]));
  const addr = getCreate2Address({ from: FACTORY, salt: effectiveSalt, bytecodeHash: initcodeHash });
  if (addr.toLowerCase().endsWith("1110")) {
    salt = s;
    predictedAddress = addr;
    break;
  }
}
if (!predictedAddress) {
  console.error("Failed to find vanity salt in 1M iterations");
  process.exit(1);
}
console.log(`  Salt: ${salt}`);
console.log(`  Predicted token: ${predictedAddress}`);
console.log(`  Mining time: ${Date.now() - t0}ms`);

// --- Step 5: Build createToken calldata (V2 factory) ---
console.log("\n=== Step 5: Build createToken calldata ===");
const createTokenAbi = factoryAbi.find(
  (f) => f.name === "createToken" && f.inputs.length === 6,
);
const tokenSetup = {
  name: "Swim/Sink",
  symbol: "SWIM/SINK",
  salt,
  feeShares,
  liquidityTier: 0, // THIN
};
const data = encodeFunctionData({
  abi: [createTokenAbi],
  functionName: "createToken",
  args: [tokenSetup, taxConfigs, buyOnDeployShares, antiSniperConfigs, [], zeroAddress],
});
console.log(`  Calldata length: ${data.length} chars`);

// --- Step 6: Sign tx offline + get txHash ---
console.log("\n=== Step 6: Sign + get txHash ===");
const fees = await publicClient.estimateFeesPerGas();
const nonce = await publicClient.getTransactionCount({ address: deployer });
const gas = await publicClient.estimateGas({ account, to: FACTORY, data, value: 0n });
const tx = {
  type: "eip1559",
  chainId: CHAIN_ID,
  nonce,
  to: FACTORY,
  data,
  value: 0n,
  gas,
  maxFeePerGas: fees.maxFeePerGas,
  maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
};
// We need an EIP-1559 signed tx without going through walletClient (since
// we built the tx by hand). Use the signing helper from viem/accounts.
const signedTx = await account.signTransaction(tx);
const txHash = keccak256(signedTx);
console.log(`  txHash: ${txHash}`);
console.log(`  predicted token: ${predictedAddress}`);

// --- Step 7: POST metadata to Livo ---
console.log("\n=== Step 7: POST metadata to Livo ===");
const description =
  "what if your token's image changed by itself? not animation. not random. actually watching the market. when it pumps when it dumps when it's chill. no buttons. no refresh. the art just reacts.";
const socials = JSON.stringify(["https://platypus.community"]);
const formData = new FormData();
formData.append("txHash", txHash);
formData.append("name", "Swim/Sink");
formData.append("symbol", "SWIM/SINK");
formData.append("chainId", String(CHAIN_ID));
formData.append("description", description);
formData.append("socials", socials);
// Livo accepts either a file upload (their backend pins it to Pinata) or
// an already-pinned IPFS URL. We don't have our own Pinata JWT, so we
// upload the file directly — Livo handles the pinning and returns the
// IPFS URL in `imageUrl` of the response.
formData.append("image", new Blob([swimGif], { type: "image/gif" }), "swim.gif");
const metaRes = await fetch("https://www.livo.trade/api/tokens/create", {
  method: "POST",
  headers: { Authorization: `Bearer ${jwt}` },
  body: formData,
});
const metaBody = await metaRes.text();
if (!metaRes.ok) {
  console.error(`Metadata POST failed: ${metaRes.status} ${metaBody}`);
  process.exit(1);
}
const metaJson = JSON.parse(metaBody);
console.log(`  Response: ${JSON.stringify(metaJson)}`);

// --- Step 8: Persist + print everything ready-to-broadcast ---
const imageUrl = metaJson.imageUrl ?? null;
const ipfsCid = imageUrl
  ? imageUrl.replace(/^https?:\/\/[^/]+\/ipfs\//, "")
  : null;
const out = {
  factory: FACTORY,
  predictedTokenAddress: predictedAddress,
  txHash,
  signedTx,
  nonce,
  imageUrl,
  ipfsCid,
  metadata: metaJson,
  // For broadcast script:
  params: { tokenSetup, taxConfigs, buyOnDeployShares, antiSniperConfigs },
};
writeFileSync("/tmp/livo-launch.json", JSON.stringify(out, null, 2));
console.log("\n=== Saved /tmp/livo-launch.json ===");
console.log("\nReady to broadcast:");
console.log(`  node scripts/launch-livo-broadcast.mjs`);
console.log(`  OR via cast: cast send --rpc-url $ROBINHOOD_RPC_ALCHEMY --private-key $FLAP_PK <FACTORY> <calldata>`);
