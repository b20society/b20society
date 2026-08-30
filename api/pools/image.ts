// Pools.fun test image endpoint — marketcap-driven dynamic image.
//
// Returns one of two duck images based on B20 Society's current USD
// market cap. The function reads bytes directly (no redirect, no
// public file URL exposure) so the underlying storage path stays
// private — consumers only see /pools/image.
//
// Tiers (B20 Society on Base, paired with NVDA):
//   market cap < $5,000  → duck-low.png  (swimming, "we're starting out")
//   market cap >= $5,000 → duck-high.png (standing proud, "we made it")
//
// Threshold is currently set just above the live market cap so the
// transition is observable as the project grows. Adjust as needed.
//
// Runtime: Node.js (we need fs to read PNG bytes from /assets/pools/).
// 60s edge cache so we don't hammer DexScreener on every fetch.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readFileSync } from "fs";
import { join } from "path";

export const config = {
  runtime: "nodejs",
};

const TIER_THRESHOLD_USD = 5_000;

// Read PNG bytes at module load (cold start cost only — served from
// memory after). ~1.7MB per file = ~3.5MB total. Well within Node.js
// function memory limits.
const IMAGES: Record<"low" | "high", Buffer> = {
  low: readFileSync(join(process.cwd(), "assets", "pools", "duck-low.png")),
  high: readFileSync(join(process.cwd(), "assets", "pools", "duck-high.png")),
};

async function getMarketCapUsd(): Promise<number> {
  const url =
    "https://api.dexscreener.com/latest/dex/tokens/" +
    "0xb2000000000000000000006006292Dcc749D6401";
  const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) return 0; // safe fallback: show "low" tier
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
  const bytes = IMAGES[tier];

  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Length", bytes.length.toString());
  res.setHeader("Cache-Control", "public, s-maxage=60, max-age=30");
  res.setHeader("X-Pool-Tier", tier);
  res.setHeader("X-Pool-Marketcap", String(mc));
  res.status(200).end(bytes);
}
