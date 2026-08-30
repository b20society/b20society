// Pools.fun test image endpoint — marketcap-direction dynamic image.
//
// Returns one of three GIFs based on B20 Society's market cap direction
// compared to the value stored 1+ minute ago in Vercel Edge Config:
//
//   market cap rose by >50% vs previous  → rocket (🚀)
//   market cap rose vs previous          → swim (default)
//   market cap fell vs previous          → sink (↓)
//   first run / no previous              → swim (default)
//
// All images are hosted on Pinata to keep the storage decoupled from
// b20society.com. The function reads the current market cap from
// DexScreener, compares to the previous value stored in Vercel Edge
// Config, picks the appropriate image, and writes the new value back.
//
// 60s edge cache so the function executes at most once per minute
// per visitor (matches the "1 menit" comparison window the user wants).
//
// Storage: Vercel Edge Config (key: "b20-mc")
//   EDGE_CONFIG env var is set on the project. We use the REST API
//   directly with B20_VERCEL_PAT (also in env) so we don't need to
//   add the @vercel/edge-config SDK as a dependency.

export const config = {
  runtime: "edge",
};

interface EdgeContext {
  waitUntil(promise: Promise<unknown>): void;
}

// Three GIFs, hosted on Pinata. These can be swapped without redeploy
// by editing this constant block.
const IMG_SWIM =
  "https://lime-occupational-yak-490.mypinata.cloud/ipfs/bafkreihdwf6nucjp6rxkvqm62gvzbrpewy7lbhn2io6vknwgsnu6ecttrq";
const IMG_SINK =
  "https://lime-occupational-yak-490.mypinata.cloud/ipfs/bafybeigtb6dxnt562zfpvv73ysnibhvlfjbcjrj4gnj33yelglwett3ijq";
const IMG_ROCKET =
  "https://lime-occupational-yak-490.mypinata.cloud/ipfs/bafkreihaljmd2moifta3d3xctltchmav3cvnno7wpx6epdwntzafyo3d5q";

// 50% threshold for the "rocket" image
const EDGE_CONFIG_ID = process.env.EDGE_CONFIG;
const VERCEL_PAT = process.env.B20_VERCEL_PAT;
const VERCEL_API = "https://api.vercel.com";

interface McState {
  value: number;
  ts: number;
}

async function readState(): Promise<McState> {
  if (!EDGE_CONFIG_ID || !VERCEL_PAT) {
    return { value: 0, ts: 0 };
  }
  try {
    const url = `${VERCEL_API}/v1/edge-config/${EDGE_CONFIG_ID}/item/mc`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${VERCEL_PAT}` },
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return { value: 0, ts: 0 };
    const data = (await res.json()) as { value: string };
    const tsRes = await fetch(
      `${VERCEL_API}/v1/edge-config/${EDGE_CONFIG_ID}/item/ts`,
      { headers: { Authorization: `Bearer ${VERCEL_PAT}` } },
    );
    const tsData = (await tsRes.json()) as { value: string };
    return {
      value: parseFloat(data.value) || 0,
      ts: parseInt(tsData.value || "0", 10) || 0,
    };
  } catch {
    return { value: 0, ts: 0 };
  }
}

async function writeState(value: number, ts: number): Promise<void> {
  if (!EDGE_CONFIG_ID || !VERCEL_PAT) return;
  try {
    await fetch(`${VERCEL_API}/v1/edge-config/${EDGE_CONFIG_ID}/items`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${VERCEL_PAT}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items: [
          { operation: "upsert", key: "mc", value: String(value) },
          { operation: "upsert", key: "ts", value: String(ts) },
        ],
      }),
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    // best-effort; next call will retry
  }
}

// Reads market data (cap + 5-min change %) for SWIM (Robinhood) or B20
// (Base, fallback). Single DexScreener call returns both fields, so
// we use the 5-min priceChange as a smoother direction signal — fewer
// false positives from sub-minute noise than a raw snapshot diff.
interface PoolData {
  marketCap: number;
  change5m: number | null; // percent change over 5 minutes (signed)
}

async function getPoolData(): Promise<PoolData> {
  const swimPool = process.env.SWIM_POOL_ADDRESS;
  const b20Token = "0xb2000000000000000000006006292Dcc749D6401";

  // Prefer SWIM (Robinhood) if env var is set
  if (swimPool && swimPool !== "0x0000000000000000000000000000000000000000") {
    const url = `https://api.dexscreener.com/latest/dex/pairs/robinhood/${swimPool}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return { marketCap: 0, change5m: null };
    const data = (await res.json()) as {
      pair?: {
        marketCap?: number;
        fdv?: number;
        priceChange?: { m5?: number };
      };
      pairs?: Array<{
        marketCap?: number;
        fdv?: number;
        priceChange?: { m5?: number };
      }>;
    };
    const p = data.pair ?? data.pairs?.[0];
    if (!p) return { marketCap: 0, change5m: null };
    return {
      marketCap: p.marketCap ?? p.fdv ?? 0,
      change5m: p.priceChange?.m5 ?? null,
    };
  }

  // Fallback: B20 Society on Base
  const url =
    "https://api.dexscreener.com/latest/dex/tokens/" + b20Token;
  const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) return { marketCap: 0, change5m: null };
  const data = (await res.json()) as {
    pairs?: Array<{
      marketCap?: number;
      fdv?: number;
      priceChange?: { m5?: number };
    }>;
  };
  const pair = data.pairs?.[0];
  if (!pair) return { marketCap: 0, change5m: null };
  return {
    marketCap: pair.marketCap ?? pair.fdv ?? 0,
    change5m: pair.priceChange?.m5 ?? null,
  };
}

type Tier = "rocket" | "swim" | "sink";

// Pick tier using DexScreener's 5-min price change as the primary
// signal. Falls back to snapshot comparison if 5-min data is missing.
// This is more efficient than always comparing raw snapshots (no
// extra storage writes) AND smoother (averaged over 5 min, fewer
// sub-minute false positives).
const ROCKET_CHANGE_THRESHOLD = 50; // +50% over 5 min → rocket
const SWIM_CHANGE_THRESHOLD = 1;   // +1% over 5 min → swim (any positive)

function pickTier(change5m: number | null, mc: number, prev: McState): Tier {
  // 5-min change is the primary signal
  if (change5m !== null) {
    if (change5m >= ROCKET_CHANGE_THRESHOLD) return "rocket";
    if (change5m >= SWIM_CHANGE_THRESHOLD) return "swim";
    if (change5m < 0) return "sink";
    // 0% change: fall through to snapshot check
  }

  // Fallback: raw snapshot comparison (1 min ago)
  if (prev.value > 0 && mc > 0) {
    const change = (mc - prev.value) / prev.value * 100;
    if (change > ROCKET_CHANGE_THRESHOLD) return "rocket";
    if (change > 0) return "swim";
    if (change < 0) return "sink";
  }

  // No data → default
  return "swim";
}

export default async function handler(
  _req: Request,
  ctx: EdgeContext,
): Promise<Response> {
  // Read current pool data + previous state in parallel
  const [pool, prev] = await Promise.all([
    getPoolData().catch(() => ({ marketCap: 0, change5m: null })),
    readState(),
  ]);

  const tier = pickTier(pool.change5m, pool.marketCap, prev);
  const imageUrl =
    tier === "rocket" ? IMG_ROCKET : tier === "sink" ? IMG_SINK : IMG_SWIM;

  // Persist current MC for fallback comparison. Use ctx.waitUntil so
  // the Vercel edge runtime keeps the request alive until the write
  // completes (instead of terminating the function when we return).
  ctx.waitUntil(writeState(pool.marketCap, Date.now()).catch(() => {}));

  // 302 redirect to the chosen image on Pinata. The consumer follows
  // the redirect; the function itself stays lightweight.
  const changeStr = pool.change5m !== null
    ? pool.change5m.toFixed(2) + "% (5m)"
    : prev.value > 0
    ? (((pool.marketCap - prev.value) / prev.value) * 100).toFixed(2) + "% (1m)"
    : "n/a";

  return new Response(null, {
    status: 302,
    headers: {
      Location: imageUrl,
      "Cache-Control": "public, s-maxage=60, max-age=30",
      "X-Pool-Tier": tier,
      "X-Pool-Marketcap": String(pool.marketCap),
      "X-Pool-Change-5m": pool.change5m !== null ? pool.change5m.toFixed(2) + "%" : "n/a",
      "X-Pool-Change": changeStr,
    },
  });
}
