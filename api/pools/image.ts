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
// Runtime: edge. Images are fetched lazily from the project's own
// public CDN (so the bytes are accessible without filesystem) and
// cached in module scope for the lifetime of the edge instance.
// 60s edge cache, 30s browser cache.

export const config = {
  runtime: "edge",
};

const TIER_THRESHOLD_USD = 5_000;

const PUBLIC_BASE = "https://b20society.com";
const IMAGES: Record<"low" | "high", Promise<ArrayBuffer>> = {
  low: fetch(`${PUBLIC_BASE}/images/pools/duck-low.png`).then((r) => r.arrayBuffer()),
  high: fetch(`${PUBLIC_BASE}/images/pools/duck-high.png`).then((r) => r.arrayBuffer()),
};

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

export default async function handler(): Promise<Response> {
  let mc = 0;
  try {
    mc = await getMarketCapUsd();
  } catch {
    // network/DexScreener down → default to low tier
  }

  const tier: "low" | "high" = mc >= TIER_THRESHOLD_USD ? "high" : "low";

  let bytes: ArrayBuffer;
  try {
    bytes = await IMAGES[tier];
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to load image", tier, message: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Length": bytes.byteLength.toString(),
      "Cache-Control": "public, s-maxage=60, max-age=30",
      "X-Pool-Tier": tier,
      "X-Pool-Marketcap": String(mc),
    },
  });
}
