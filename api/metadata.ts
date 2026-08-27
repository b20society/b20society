// Token metadata endpoint
// Returns ERC-7572 metadata for B20 Society (SOCIETY) token
// Image is dynamic based on the token's USD market cap tier

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { TOTAL_SUPPLY, TIER_STEP } from "../lib/constants";

export const config = {
  runtime: "edge",
};

const TIER_IMAGE_COUNT = 100;

function tierToUuid(tier: number): string {
  // TODO: replace placeholder with actual UUIDs loaded from /lib/tier-images.ts
  // For now, return a deterministic placeholder so the response shape is valid
  const seed = `tier-${tier.toString().padStart(3, "0")}`;
  return `placeholder-${seed}`;
}

export default async function handler(
  _req: VercelRequest,
  res: VercelResponse,
): Promise<Response> {
  try {
    // TODO: read V4 pool + Chainlink to compute marketcap → tier
    // For now, return a stub response so the endpoint is testable
    const stubMarketcapUsd = 0;
    const tier = Math.max(
      0,
      Math.min(
        TIER_IMAGE_COUNT - 1,
        Math.floor(stubMarketcapUsd / TIER_STEP),
      ),
    );

    const metadata = {
      name: "B20 Society",
      symbol: "SOCIETY",
      description:
        "B20 Society — a self-evolving B20 token. Image reflects market cap.",
      image: `https://b20society.com/images/${tierToUuid(tier)}.webp`,
      external_url: "https://b20society.com",
      attributes: [
        { trait_type: "Tier", value: tier },
        {
          trait_type: "Total Supply",
          value: TOTAL_SUPPLY.toString(),
        },
      ],
    };

    return new Response(JSON.stringify(metadata, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=10",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
