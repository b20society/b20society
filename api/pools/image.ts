// Pools.fun test image endpoint — marketcap-driven dynamic image.
//
// Returns one of two duck PNGs based on B20 Society's current USD
// market cap. Image bytes are returned directly (no redirect, no
// public file URL exposure) so the underlying storage stays private —
// consumers only see /pools/image.
//
// Tiers (B20 Society on Base, paired with NVDA):
//   market cap < $5,000  → duck-low.png  (swimming)
//   market cap >= $5,000 → duck-high.png (standing)
//
// Runtime: Node.js. Reads PNG bytes from /public/images/pools/ at
// module load and serves from memory.
// 60s edge cache, 30s browser cache.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readFileSync } from "fs";
import { join } from "path";

export const config = {
  runtime: "nodejs",
};

const TIER_THRESHOLD_USD = 5_000;

// Read PNG bytes at module load (cold start cost only).
// Files live in /public/images/pools/ — they're deployed as static
// assets AND accessible to the function via fs.
const ASSETS_DIR = join(process.cwd(), "public", "images", "pools");
const DUCK_LOW = readFileSync(join(ASSETS_DIR, "duck-low.png"));
const DUCK_HIGH = readFileSync(join(ASSETS_DIR, "duck-high.png"));

async function getMarketCapUsd(): Promise<number> {
  const url =
    "https://api.dexscreener.com/latest/dex/tokens/" +
    "0xb2000000000000000000006006292Dcc749D6401";
  const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) return 0;
  const data = (await res.json()) as {
    pairs?: Array<{ marketCap?: number; fdv?: number }>;
  };
  const pair = data.pairs?.[0];
  return pair?.marketCap ?? pair?.fdv ?? 0;
}

export default async function handler(
  _req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  let mc = 0;
  try {
    mc = await getMarketCapUsd();
  } catch {
    // network/DexScreener down → default to low tier
  }

  const tier: "low" | "high" = mc >= TIER_THRESHOLD_USD ? "high" : "low";
  const bytes = tier === "high" ? DUCK_HIGH : DUCK_LOW;

  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Length", bytes.length.toString());
  res.setHeader("Cache-Control", "public, s-maxage=60, max-age=30");
  res.setHeader("X-Pool-Tier", tier);
  res.setHeader("X-Pool-Marketcap", String(mc));
  res.status(200).end(bytes);
}
