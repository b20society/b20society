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
const ROCKET_THRESHOLD = 0.5;

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

type Tier = "rocket" | "swim" | "sink";

function pickTier(current: number, prev: number, prevTs: number): Tier {
  if (prev <= 0 || prevTs <= 0) return "swim"; // first run
  if (current <= 0) return "sink"; // data error → safe default

  const change = (current - prev) / prev;

  if (current > prev) {
    if (change > ROCKET_THRESHOLD) return "rocket";
    return "swim";
  }
  if (current < prev) return "sink";
  return "swim"; // no change → neutral swim
}

export default async function handler(
  _req: Request,
  ctx: EdgeContext,
): Promise<Response> {
  // Read current MC + previous state in parallel
  const [mc, prev] = await Promise.all([
    getMarketCapUsd().catch(() => 0),
    readState(),
  ]);

  const tier = pickTier(mc, prev.value, prev.ts);
  const imageUrl =
    tier === "rocket" ? IMG_ROCKET : tier === "sink" ? IMG_SINK : IMG_SWIM;

  // Persist current value for next comparison. Use ctx.waitUntil so
  // the Vercel edge runtime keeps the request alive until the write
  // completes (instead of terminating the function when we return).
  ctx.waitUntil(writeState(mc, Date.now()).catch(() => {}));

  // 302 redirect to the chosen image on Pinata. The consumer follows
  // the redirect; the function itself stays lightweight.
  return new Response(null, {
    status: 302,
    headers: {
      Location: imageUrl,
      "Cache-Control": "public, s-maxage=60, max-age=30",
      "X-Pool-Tier": tier,
      "X-Pool-Marketcap": String(mc),
      "X-Pool-Prev-Marketcap": String(prev.value),
      "X-Pool-Change": prev.value > 0
        ? (((mc - prev.value) / prev.value) * 100).toFixed(2) + "%"
        : "n/a",
    },
  });
}
