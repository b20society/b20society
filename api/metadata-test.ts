// Token metadata endpoint (test path)
// Same logic as /api/metadata — reads V4 pool, Chainlink, computes tier/marketcap.
// The only difference is the URL path. Both endpoints are production-ready
// and can be used by any wallet or frontend.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { tierImageUrl } from "../lib/tier-images";
import { computeMarketcap, getNvdaPriceUsd } from "../lib/marketcap";

export const config = {
  runtime: "edge",
};

const PUBLIC_DOMAIN = "https://b20society.com";
const STUB_IMAGE = `${PUBLIC_DOMAIN}/images/Soc1.jpg`;
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
        image: tierImageUrl(result.tier, PUBLIC_DOMAIN),
        external_url: PUBLIC_DOMAIN,
      });
    }

    // Stub mode: tier 0, marketcap 0
    return jsonResponse({
      name: "B20 Society",
      symbol: "SOCIETY",
      description: STUB_DESCRIPTION,
      image: STUB_IMAGE,
      external_url: PUBLIC_DOMAIN,
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
      "Cache-Control": "public, max-age=10",
      "Access-Control-Allow-Origin": "*",
      "X-Test-Endpoint": "true",
    },
  });
}
