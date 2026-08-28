// Token metadata endpoint
// Returns ERC-7572 metadata for B20 Society (SOCIETY) token
// Image is dynamic based on the token's USD market cap tier (V4 + Chainlink)
//
// NVDA price is ALWAYS read from Chainlink (independent of V4_POOL_ID).
// Market cap is only computed when V4_POOL_ID is set.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { TOTAL_SUPPLY, METADATA_CACHE_TTL } from "../lib/constants";
import { tierImageUrl, TIER_COUNT } from "../lib/tier-images";
import { computeMarketcap, getNvdaPriceUsd } from "../lib/marketcap";

export const config = {
  runtime: "edge",
};

const PUBLIC_DOMAIN = "https://b20society.com";
const STUB_IMAGE = `${PUBLIC_DOMAIN}/images/Soc1.jpg`;
const STUB_DESCRIPTION =
  "B20 Society — a self-evolving B20 token paired with NVDA. Image morphs with market cap.";

export default async function handler(
  _req: VercelRequest,
  _res: VercelResponse,
): Promise<Response> {
  try {
    const poolId = process.env.V4_POOL_ID as `0x${string}` | undefined;

    // Always read NVDA price from Chainlink
    let nvdaPriceUsd = 0;
    let priceStale = true;
    try {
      const price = await getNvdaPriceUsd();
      nvdaPriceUsd = price.priceUsd;
      priceStale = price.isStale;
    } catch (err) {
      console.warn("Failed to read NVDA price:", err);
    }

    if (!poolId) {
      return jsonResponse(stubMetadata(nvdaPriceUsd, priceStale));
    }

    const result = await computeMarketcap(poolId);
    const TIER_MAX = TIER_COUNT - 1;
    const progressPct = Math.min(
      100,
      Math.max(0, (result.tier / TIER_MAX) * 100),
    );

    const metadata = {
      name: "B20 Society",
      symbol: "SOCIETY",
      description:
        "B20 Society — a self-evolving B20 token paired with NVDA. Image morphs with market cap. 91 tiers from 0% to 100% ($1M), each tier is a hand-crafted scene.",
      image: tierImageUrl(result.tier, PUBLIC_DOMAIN),
      external_url: PUBLIC_DOMAIN,
      attributes: [
        { trait_type: "Progress", value: `${progressPct.toFixed(1)}%` },
        { trait_type: "Tier", value: result.tier },
        { trait_type: "Market Cap (USD)", value: Math.floor(result.marketcapUsd).toString() },
        { trait_type: "NVDA Price (USD)", value: result.nvdaPriceUsd.toFixed(2) },
        { trait_type: "Total Supply", value: TOTAL_SUPPLY.toString() },
        { trait_type: "Price Feed Stale", value: result.priceStale ? "Yes" : "No" },
      ],
    };

    return jsonResponse(metadata);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

function stubMetadata(nvdaPriceUsd: number, priceStale: boolean) {
  return {
    name: "B20 Society",
    symbol: "SOCIETY",
    description: STUB_DESCRIPTION,
    image: STUB_IMAGE,
    external_url: PUBLIC_DOMAIN,
    attributes: [
      { trait_type: "Progress", value: "0.0%" },
      { trait_type: "Tier", value: 0 },
      { trait_type: "Market Cap (USD)", value: "0" },
      { trait_type: "NVDA Price (USD)", value: nvdaPriceUsd.toFixed(2) },
      { trait_type: "Total Supply", value: TOTAL_SUPPLY.toString() },
      { trait_type: "Price Feed Stale", value: priceStale ? "Yes" : "No" },
    ],
  };
}

function jsonResponse(data: object): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${METADATA_CACHE_TTL}`,
      "Access-Control-Allow-Origin": "*",
    },
  });
}
