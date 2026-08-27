// Token metadata endpoint
// Returns ERC-7572 metadata for B20 Society (SOCIETY) token
// Image is dynamic based on the token's USD market cap tier (V4 + Chainlink)

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { TOTAL_SUPPLY, METADATA_CACHE_TTL } from "../lib/constants";
import { TIER_IMAGES, tierImageUrl, TIER_COUNT } from "../lib/tier-images";
import { computeMarketcap } from "../lib/marketcap";

export const config = {
  runtime: "edge",
};

const PUBLIC_DOMAIN = "https://b20society.com";

export default async function handler(
  _req: VercelRequest,
  _res: VercelResponse,
): Promise<Response> {
  try {
    const poolId = process.env.V4_POOL_ID as `0x${string}` | undefined;
    if (!poolId) {
      // Stub mode: if pool ID not set, return tier 0 (will be the placeholder)
      const metadata = stubMetadata(0, "no V4_POOL_ID set");
      return new Response(JSON.stringify(metadata, null, 2), {
        status: 200,
        headers: cacheHeaders(),
      });
    }

    const result = await computeMarketcap(poolId);

    const metadata = {
      name: "B20 Society",
      symbol: "SOCIETY",
      description:
        "B20 Society — a self-evolving B20 token. Image reflects market cap.",
      image: tierImageUrl(result.tier, PUBLIC_DOMAIN),
      external_url: PUBLIC_DOMAIN,
      attributes: [
        { trait_type: "Tier", value: result.tier },
        {
          trait_type: "Market Cap (USD)",
          value: Math.floor(result.marketcapUsd).toString(),
        },
        { trait_type: "NVDA Price (USD)", value: result.nvdaPriceUsd.toFixed(2) },
        { trait_type: "Total Supply", value: TOTAL_SUPPLY.toString() },
        { trait_type: "Price Feed Stale", value: result.priceStale ? "Yes" : "No" },
      ],
    };

    return new Response(JSON.stringify(metadata, null, 2), {
      status: 200,
      headers: cacheHeaders(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

function stubMetadata(tier: number, reason: string) {
  return {
    name: "B20 Society",
    symbol: "SOCIETY",
    description: `B20 Society — a self-evolving B20 token. (stub: ${reason})`,
    image: tierImageUrl(tier, PUBLIC_DOMAIN),
    external_url: PUBLIC_DOMAIN,
    attributes: [
      { trait_type: "Tier", value: tier },
      { trait_type: "Stub Mode", value: reason },
    ],
  };
}

function cacheHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Cache-Control": `public, max-age=${METADATA_CACHE_TTL}`,
    "Access-Control-Allow-Origin": "*",
  };
}
