// NFT metadata endpoint — shared by every B20 Society collection.
//
// Routes by on-chain ownership: the endpoint tries the B20 Society
// contract on Base first, then the SwimSinkNFT on Robinhood Chain, and
// returns metadata for whichever contract actually owns the token.
// This keeps the URL general (`/api/nft/{id}`) so any contract that
// sets its baseURI to this domain lands here, regardless of chain.
//
// Each branch builds a chain-appropriate metadata object (phase image,
// burn economics, contract address, network) and caches for 10s at the
// edge — fast enough that burn-driven phase changes propagate quickly,
// slow enough that OpenSea / Rarity crawlers dedupe.

import type { VercelRequest } from "@vercel/node";
import {
  createPublicClient,
  http,
  parseAbi,
  fallback,
} from "viem";
import { base } from "viem/chains";
import { defineChain } from "viem";
import { phaseImageUrl, tierImageUrl } from "../../lib/uuid-map";
import { NFT_MAX_SUPPLY } from "../../lib/constants";

export const config = {
  runtime: "edge",
};

const PUBLIC_DOMAIN = "https://b20society.com";

const BASE_RPC_URL =
  process.env.BASE_RPC ?? "https://base-mainnet.g.alchemy.com/v2/-d5tRgRg5RkHMPvZrTwRV";

const ROBINHOOD_RPC_URL =
  process.env.ROBINHOOD_RPC ??
  "https://robinhood-mainnet.g.alchemy.com/v2/-d5tRgRg5RkHMPvZrTwRV";

const B20_NFT_DEFAULT = "0xbF3841f149A5c2A45baf36dA2C925B8158e84863";
const SWIMSINK_NFT_DEFAULT = "0x31C5338699688Ca1164d9e95D80e05c39057bcBf";

const B20_NFT_ABI = parseAbi([
  "function phaseOf(uint256 tokenId) view returns (uint8)",
  "function exists(uint256 tokenId) view returns (bool)",
  "function tierOf(uint256 tokenId) view returns (uint8)",
  "function totalSupply() view returns (uint256)",
]);

const SWIMSINK_NFT_ABI = parseAbi([
  "function phaseOf(uint256 tokenId) view returns (uint8)",
  "function exists(uint256 tokenId) view returns (bool)",
  "function totalSupply() view returns (uint256)",
]);

const baseClient = createPublicClient({
  chain: base,
  transport: fallback([
    http(BASE_RPC_URL),
    http("https://mainnet.base.org"),
  ]),
  batch: { multicall: true },
});

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

const robinhoodClient = createPublicClient({
  chain: robinhoodChain,
  transport: fallback([
    http(ROBINHOOD_RPC_URL),
    http("https://mainnet-rpc.robinhood.com"),
  ]),
  batch: { multicall: true },
});

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SWIM_BURN_COST_BY_PHASE: Record<number, bigint> = {
  1: 20_000n, 2: 30_000n, 3: 40_000n, 4: 50_000n, 5: 60_000n,
  6: 70_000n, 7: 80_000n, 8: 90_000n, 9: 100_000n,
};

function formatSwim(wei: bigint): string {
  const n = Number(wei) / 1e18;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M $SWIM`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K $SWIM`;
  return `${n.toFixed(0)} $SWIM`;
}

function formatSoc(wei: bigint): string {
  const n = Number(wei) / 1e18;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M $SOCIETY`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K $SOCIETY`;
  return `${n.toFixed(0)} $SOCIETY`;
}

async function readB20Metadata(
  tokenId: bigint,
  tokenIdStr: string,
  contract: `0x${string}`,
): Promise<Response | null> {
  try {
    const exists = await baseClient.readContract({
      address: contract,
      abi: B20_NFT_ABI,
      functionName: "exists",
      args: [tokenId],
    });
    if (!exists) return null;

    const phase = await baseClient.readContract({
      address: contract,
      abi: B20_NFT_ABI,
      functionName: "phaseOf",
      args: [tokenId],
    });
    const tier = await baseClient.readContract({
      address: contract,
      abi: B20_NFT_ABI,
      functionName: "tierOf",
      args: [tokenId],
    });

    return new Response(
      JSON.stringify(
        {
          name: `B20 Society #${tokenIdStr} — Phase ${phase}`,
          description:
            `B20 Society NFT — Phase ${phase} of 10. Self-evolving through ` +
            `10 visual phases via $SOCIETY burns.`,
          image: tierImageUrl(Number(tier) || Number(phase), PUBLIC_DOMAIN),
          external_url: `${PUBLIC_DOMAIN}/nft?id=${tokenIdStr}`,
          attributes: [
            { trait_type: "Phase", value: Number(phase) },
            { trait_type: "Tier", value: Number(tier) || Number(phase) },
            { trait_type: "Collection", value: "B20 Society" },
            { trait_type: "Type", value: "Self-Evolving NFT" },
            { trait_type: "Network", value: "Base" },
            { trait_type: "Chain ID", value: 8453 },
            { trait_type: "Contract", value: contract },
          ],
        },
        null,
        2,
      ),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, s-maxage=10, max-age=0, must-revalidate",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  } catch (err) {
    console.warn(`B20 Society read failed for #${tokenIdStr}:`, err);
    return null;
  }
}

async function readSwimSinkMetadata(
  tokenId: bigint,
  tokenIdStr: string,
  contract: `0x${string}`,
): Promise<Response | null> {
  try {
    const exists = await robinhoodClient.readContract({
      address: contract,
      abi: SWIMSINK_NFT_ABI,
      functionName: "exists",
      args: [tokenId],
    });
    if (!exists) return null;

    const phase = await robinhoodClient.readContract({
      address: contract,
      abi: SWIMSINK_NFT_ABI,
      functionName: "phaseOf",
      args: [tokenId],
    });
    const p = Number(phase);
    const isMax = p >= 10;
    const nextCost = SWIM_BURN_COST_BY_PHASE[p] ?? 0n;
    let cumulative = 0n;
    for (let i = 1; i < p; i++) cumulative += SWIM_BURN_COST_BY_PHASE[i] ?? 0n;

    return new Response(
      JSON.stringify(
        {
          name: `Swim Sink Society #${tokenIdStr} — Phase ${p}`,
          description:
            `Swim Sink Society NFT — Phase ${p} of 10. Self-evolving through ` +
            `10 visual phases via $SWIM burns. Burn ${nextCost.toString()} $SWIM to advance.`,
          image: phaseImageUrl(p, PUBLIC_DOMAIN),
          external_url: `${PUBLIC_DOMAIN}/swim-nft?id=${tokenIdStr}`,
          attributes: [
            { trait_type: "Phase", value: p },
            { trait_type: "Stage", value: `${p} of 10` },
            { trait_type: "Status", value: isMax ? "Max Phase" : "Active" },
            { trait_type: "Fully Evolved", value: isMax ? "Yes" : "No" },
            {
              trait_type: "Burn Cost to Next Phase",
              value: isMax ? "MAX" : formatSwim(nextCost * 10n ** 18n),
            },
            {
              trait_type: "Total Burned",
              value: p === 1 ? "0" : formatSwim(cumulative * 10n ** 18n),
            },
            { trait_type: "Collection", value: "Swim Sink Society" },
            { trait_type: "Type", value: "Self-Evolving NFT" },
            { trait_type: "Network", value: "Robinhood Chain" },
            { trait_type: "Chain ID", value: 4663 },
            { trait_type: "Contract", value: contract },
          ],
        },
        null,
        2,
      ),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, s-maxage=10, max-age=0, must-revalidate",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  } catch (err) {
    console.warn(`SwimSink read failed for #${tokenIdStr}:`, err);
    return null;
  }
}

export default async function handler(
  req: VercelRequest,
): Promise<Response> {
  try {
    const url = new URL(req.url ?? "/", PUBLIC_DOMAIN);
    const match = url.pathname.match(/\/api\/nft\/(\d+)/);
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

    const b20Contract = (process.env.NFT_CONTRACT_ADDRESS ??
      B20_NFT_DEFAULT) as `0x${string}`;
    const swimSinkContract = (process.env.SWIMSINK_NFT_ADDRESS ??
      SWIMSINK_NFT_DEFAULT) as `0x${string}`;

    // Try SwimSink first (Robinhood, the newer collection and the one
    // whose tokenURI now points here). Fall back to B20 Society on
    // Base so legacy NFTs still resolve. We parallelize both calls so
    // the slower chain doesn't block the fast path.
    const [swim, b20] = await Promise.all([
      readSwimSinkMetadata(tokenId, tokenIdStr, swimSinkContract),
      readB20Metadata(tokenId, tokenIdStr, b20Contract),
    ]);
    if (swim) return swim;
    if (b20) return b20;

    return jsonError(`Token #${tokenIdStr} not minted yet`, 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonError(message, 500);
  }
}
