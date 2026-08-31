// Metadata endpoint for SwimSinkNFT (Robinhood Chain).
//
// ERC-721 tokenURI(1) currently returns "nft/1" on-chain (the contract
// has no baseURI set, so OpenZeppelin's default kicks in and concatenates
// the per-token override). The user-visible URL the marketplace should
// hit is the absolute one served by this function:
//
//   https://b20society.com/api/swim-nft/{id}
//
// We keep a Vercel rewrite at /api/swim-nft/:id → this function so the
// path mirrors the file structure, and a second rewrite at /nft/:id
// → /api/swim-nft/:id so any client that resolves the contract's
// "nft/{id}" relative URI against our origin also lands here.
//
// Reads come from Robinhood Chain via the ROBINHOOD_RPC env var
// (added in commit 3f9ffb0 for the SWIM/SINK image tier feed). When the
// env var is unset or the chain call fails, we 404 — same as the B20
// Society endpoint.

import type { VercelRequest } from "@vercel/node";
import {
  createPublicClient,
  http,
  parseAbi,
  fallback,
} from "viem";
import { defineChain } from "viem";
import { phaseImageUrl } from "../../lib/uuid-map";

export const config = {
  runtime: "edge",
};

const PUBLIC_DOMAIN = "https://b20society.com";

// 222 NFTs, 2 per wallet, 0.01 ETH mint. Matches SwimSinkNFT.sol.
const NFT_MAX_SUPPLY = 222;

const ROBINHOOD_RPC_URL =
  process.env.ROBINHOOD_RPC ??
  "https://robinhood-mainnet.g.alchemy.com/v2/-d5tRgRg5RkHMPvZrTwRV";

// viem doesn't ship a Robinhood Chain config; add it inline so createPublicClient
// can batch multicalls and so the chain id shows up in error messages.
const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  network: "robinhood",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [ROBINHOOD_RPC_URL] },
    public: { http: [ROBINHOOD_RPC_URL] },
  },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
  },
});

const NFT_ABI = parseAbi([
  "function phaseOf(uint256 tokenId) view returns (uint8)",
  "function exists(uint256 tokenId) view returns (bool)",
  "function totalSupply() view returns (uint256)",
]);

const client = createPublicClient({
  chain: robinhoodChain,
  transport: fallback([http(ROBINHOOD_RPC_URL), http("https://mainnet-rpc.robinhood.com")]),
  batch: { multicall: true },
});

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Burn cost curve (in $SWIM, 18 decimals). Mirrors SwimSinkNFT._phaseCost.
const BURN_COST_BY_PHASE: Record<number, bigint> = {
  1: 20_000n,
  2: 30_000n,
  3: 40_000n,
  4: 50_000n,
  5: 60_000n,
  6: 70_000n,
  7: 80_000n,
  8: 90_000n,
  9: 100_000n,
};

function formatSwim(wei: bigint): string {
  const n = Number(wei) / 1e18;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M $SWIM`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K $SWIM`;
  return `${n.toFixed(0)} $SWIM`;
}

export default async function handler(
  req: VercelRequest,
): Promise<Response> {
  try {
    const url = new URL(req.url ?? "/", PUBLIC_DOMAIN);
    // /api/swim-nft/{id} OR /nft/{id} (rewritten)
    const match =
      url.pathname.match(/\/api\/swim-nft\/(\d+)/) ??
      url.pathname.match(/\/nft\/(\d+)/);
    const tokenIdStr = match?.[1];

    if (!tokenIdStr) {
      return jsonError("TokenId required", 400);
    }

    const tokenId = BigInt(tokenIdStr);
    const tokenIdNum = Number(tokenId);

    if (
      !Number.isFinite(tokenIdNum) ||
      tokenIdNum < 1 ||
      tokenIdNum > NFT_MAX_SUPPLY
    ) {
      return jsonError(
        `TokenId out of range (must be 1-${NFT_MAX_SUPPLY})`,
        404,
      );
    }

    const nftContract = (process.env.SWIMSINK_NFT_ADDRESS ??
      "0x31C5338699688Ca1164d9e95D80e05c39057bcBf") as `0x${string}`;

    let phase = 1;
    try {
      const exists = await client.readContract({
        address: nftContract,
        abi: NFT_ABI,
        functionName: "exists",
        args: [tokenId],
      });
      if (!exists) {
        return jsonError(`Token #${tokenIdStr} not minted yet`, 404);
      }
      phase = await client.readContract({
        address: nftContract,
        abi: NFT_ABI,
        functionName: "phaseOf",
        args: [tokenId],
      });
      if (phase < 1 || phase > 10) phase = 1;
    } catch (err) {
      console.warn(`Failed to read phase for #${tokenIdStr}:`, err);
      return jsonError(`Token #${tokenIdStr} not found`, 404);
    }

    const isMax = phase >= 10;
    const nextCost = BURN_COST_BY_PHASE[phase] ?? 0n;
    let cumulative = 0n;
    for (let p = 1; p < phase; p++) cumulative += BURN_COST_BY_PHASE[p] ?? 0n;

    const metadata = {
      name: `Swim Sink Society #${tokenIdStr} — Phase ${phase}`,
      description:
        `Swim Sink Society NFT — Phase ${phase} of 10. Self-evolving through ` +
        `10 visual phases via $SWIM burns. Burn ${nextCost.toString()} $SWIM to advance.`,
      image: phaseImageUrl(phase, PUBLIC_DOMAIN),
      external_url: `${PUBLIC_DOMAIN}/swim-nft?id=${tokenIdStr}`,
      attributes: [
        { trait_type: "Phase", value: phase },
        { trait_type: "Stage", value: `${phase} of 10` },
        { trait_type: "Status", value: isMax ? "Max Phase" : "Active" },
        { trait_type: "Fully Evolved", value: isMax ? "Yes" : "No" },
        {
          trait_type: "Burn Cost to Next Phase",
          value: isMax ? "MAX" : formatSwim(nextCost * 10n ** 18n),
        },
        {
          trait_type: "Total Burned",
          value: phase === 1 ? "0" : formatSwim(cumulative * 10n ** 18n),
        },
        { trait_type: "Collection", value: "Swim Sink Society" },
        { trait_type: "Type", value: "Self-Evolving NFT" },
        { trait_type: "Network", value: "Robinhood Chain" },
        { trait_type: "Chain ID", value: 4663 },
        {
          trait_type: "Contract",
          value: "0x31C5338699688Ca1164d9e95D80e05c39057bcBf",
        },
      ],
    };

    return new Response(JSON.stringify(metadata, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        // Phase advances on every burn, so cache briefly. 10s matches the
        // B20 Society endpoint.
        "Cache-Control": "public, s-maxage=10, max-age=0, must-revalidate",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonError(message, 500);
  }
}
