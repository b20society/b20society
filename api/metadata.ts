// Token metadata endpoint
// Returns ERC-7572 metadata for B20 Society (SOCIETY) token
// Image is dynamic based on the token's USD market cap tier (V4 + Chainlink)
//
// NVDA price is ALWAYS read from Chainlink (independent of V4_POOL_ID).
// Market cap is only computed when V4_POOL_ID is set.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { computeMarketcap, getNvdaPriceUsd } from "../lib/marketcap";
import { tierToUuid } from "../lib/uuid-map";

export const config = {
  runtime: "edge",
};

const PUBLIC_DOMAIN = "https://b20society.com";
const STUB_DESCRIPTION =
  "B20 Society — a self-evolving B20 token paired with NVDA. Image morphs with market cap.";
const LIVE_DESCRIPTION =
  "B20 Society — a self-evolving B20 token paired with NVDA. Image morphs with market cap. 91 tiers from 0% to 100% ($1M), each tier is a hand-crafted scene.";

export default async function handler(
  _req: VercelRequest,
  _res: VercelResponse,
): Promise<Response> {
  try {
    const poolId = process.env.V4_POOL_ID as `0x${string}` | undefined;

    if (poolId) {
      const result = await computeMarketcap(poolId);
      return jsonResponse({
        name: "B20 Society",
        symbol: "SOCIETY",
        description: LIVE_DESCRIPTION,
        // Use UUID-based URL so the next tier can't be guessed from
        // the current tier number. /api/img/{uuid} serves the actual file.
        image: `${PUBLIC_DOMAIN}/api/img/${tierToUuid(result.tier)}`,
        external_url: PUBLIC_DOMAIN,
        attributes: [
          { trait_type: "Tier", value: result.tier },
          { trait_type: "Market Cap (USD)", value: Math.round(result.marketcapUsd * 100) / 100 },
          { trait_type: "NVDA Price (USD)", value: Math.round(result.nvdaPriceUsd * 100) / 100 },
          { trait_type: "Total Supply", value: "1000000000000000000000000000" },
          { trait_type: "Price Feed Stale", value: result.priceStale ? "Yes" : "No" },
        ],
      });
    }

    // Stub mode: tier 0, marketcap 0, but show real NVDA price
    let nvdaPriceUsd = 0;
    let nvdaStale = false;
    try {
      const price = await getNvdaPriceUsd();
      nvdaPriceUsd = price.priceUsd;
      nvdaStale = price.isStale;
    } catch (err) {
      console.warn("Failed to read NVDA price:", err);
    }
    return jsonResponse({
      name: "B20 Society",
      symbol: "SOCIETY",
      description: STUB_DESCRIPTION,
      // Use UUID-based URL even in stub mode so URL pattern is consistent.
      image: `${PUBLIC_DOMAIN}/api/img/${tierToUuid(0)}`,
      external_url: PUBLIC_DOMAIN,
      attributes: [
        { trait_type: "Tier", value: 0 },
        { trait_type: "Market Cap (USD)", value: 0 },
        { trait_type: "NVDA Price (USD)", value: Math.round(nvdaPriceUsd * 100) / 100 },
        { trait_type: "Total Supply", value: "1000000000000000000000000000" },
        { trait_type: "Price Feed Stale", value: nvdaStale ? "Yes" : "No" },
        { trait_type: "Stub Mode", value: "V4_POOL_ID not set in Vercel" },
      ],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

function jsonResponse(data: object): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // s-maxage = Vercel edge cache TTL. 60s means even if 1000 users hit
      // /api/metadata in 60s, only 1 function invocation happens.
      // max-age = browser cache TTL (shorter so user gets fresh UI data).
      "Cache-Control": "public, s-maxage=60, max-age=30",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
