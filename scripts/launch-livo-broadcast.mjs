// Broadcast the precomputed Livo launch transaction.
// Reads /tmp/livo-launch.json (produced by launch-livo.mjs) and sends the
// already-signed raw transaction to the network.
//
// Run:
//   PINATA_JWT=... FLAP_PK=... node scripts/launch-livo.mjs   # produces JSON
//   node scripts/launch-livo-broadcast.mjs                    # this script
import { createPublicClient, http } from "viem";
import { defineChain } from "viem";
import { readFileSync } from "fs";

const CHAIN_ID = 4663;
const rpcUrl = process.env.ROBINHOOD_RPC_ALCHEMY ??
  "https://robinhood-mainnet.g.alchemy.com/v2/-d5tRgRg5RkHMPvZrTwRV";
const robinhood = defineChain({
  id: CHAIN_ID, name: "Robinhood Chain", network: "robinhood",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});
const publicClient = createPublicClient({ chain: robinhood, transport: http(rpcUrl) });

const data = JSON.parse(readFileSync("/tmp/livo-launch.json", "utf8"));
console.log("Broadcasting:");
console.log(`  factory:  ${data.factory}`);
console.log(`  token:    ${data.predictedTokenAddress}`);
console.log(`  txHash:   ${data.txHash}`);
console.log(`  nonce:    ${data.nonce}`);

const hash = await publicClient.sendRawTransaction({
  serializedTransaction: data.signedTx,
});
console.log(`  sent:     ${hash}`);
if (hash !== data.txHash) {
  console.error("WARNING: broadcast hash != precomputed txHash");
}
console.log(`  explorer: https://robinhoodchain.blockscout.com/tx/${hash}`);
