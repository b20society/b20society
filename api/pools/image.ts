// Pools.fun test image endpoint — marketcap-direction dynamic image.
//
// Returns one of three GIFs based on B20 Society / SWIM market cap
// direction vs the value from ~1 minute ago:
//
//   market cap rose by >50% vs ~1min-ago  → rocket (🚀)
//   market cap rose vs ~1min-ago          → swim  (default)
//   market cap fell vs ~1min-ago          → sink  (↓)
//   first run / no history                → swim  (default)
//
// Vercel Cron (defined in vercel.json, every minute) calls
// /api/cron-tick, which in turn calls this endpoint. Polling every
// minute keeps the state fresh; the tier decision is based on a
// 1-min window so brief spikes don't trigger an image flip.

export const config = {
  runtime: "edge",
};

const IMG_SWIM =
  "https://lime-occupational-yak-490.mypinata.cloud/ipfs/bafkreihdwf6nucjp6rxkvqm62gvzbrpewy7lbhn2io6vknwgsnu6ecttrq";
const IMG_SINK =
  "https://lime-occupational-yak-490.mypinata.cloud/ipfs/bafybeigtb6dxnt562zfpvv73ysnibhvlfjbcjrj4gnj33yelglwett3ijq";
const IMG_ROCKET =
  "https://lime-occupational-yak-490.mypinata.cloud/ipfs/bafkreihaljmd2moifta3d3xctltchmav3cvnno7wpx6epdwntzafyo3d5q";

const ROCKET_THRESHOLD = 0.5;
const HISTORY_MAX = 12;
const COMPARE_WINDOW_MS = 60_000;

const EDGE_CONFIG_ID = process.env.EDGE_CONFIG;
const VERCEL_PAT = process.env.B20_VERCEL_PAT;
const VERCEL_API = "https://api.vercel.com";

interface McEntry { value: number; ts: number; }

async function readHistory(): Promise<McEntry[]> {
  if (!EDGE_CONFIG_ID || !VERCEL_PAT) return [];
  try {
    const res = await fetch(
      `${VERCEL_API}/v1/edge-config/${EDGE_CONFIG_ID}/item/mc_history`,
      { headers: { Authorization: `Bearer ${VERCEL_PAT}` } },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { value?: string };
    if (!data.value) return [];
    const parsed = JSON.parse(data.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeHistory(history: McEntry[]): Promise<void> {
  if (!EDGE_CONFIG_ID || !VERCEL_PAT) return;
  try {
    await fetch(`${VERCEL_API}/v1/edge-config/${EDGE_CONFIG_ID}/items`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${VERCEL_PAT}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items: [{ operation: "upsert", key: "mc_history", value: JSON.stringify(history) }],
      }),
      signal: AbortSignal.timeout(3_000),
    });
  } catch {}
}

async function getMarketCapUsd(): Promise<number> {
  const swimPool = process.env.SWIM_POOL_ADDRESS;
  const b20Token = "0xb2000000000000000000006006292Dcc749D6401";

  if (swimPool && swimPool !== "0x0000000000000000000000000000000000000000") {
    const url = `https://api.dexscreener.com/latest/dex/pairs/robinhood/${swimPool}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return 0;
    const data = (await res.json()) as {
      pair?: { marketCap?: number; fdv?: number };
      pairs?: Array<{ marketCap?: number; fdv?: number }>;
    };
    const p = data.pair ?? data.pairs?.[0];
    return p?.marketCap ?? p?.fdv ?? 0;
  }

  const url = "https://api.dexscreener.com/latest/dex/tokens/" + b20Token;
  const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) return 0;
  const data = (await res.json()) as {
    pairs?: Array<{ marketCap?: number; fdv?: number }>;
  };
  const pair = data.pairs?.[0];
  return pair?.marketCap ?? pair?.fdv ?? 0;
}

type Tier = "rocket" | "swim" | "sink";

function pickTier(
  current: number,
  history: McEntry[],
  now: number,
): { tier: Tier; baseline: number | null; baselineAgeMs: number | null } {
  if (current <= 0) return { tier: "sink", baseline: null, baselineAgeMs: null };
  if (history.length === 0) {
    return { tier: "swim", baseline: null, baselineAgeMs: null };
  }

  const target = now - COMPARE_WINDOW_MS;
  let baseline: McEntry | null = null;
  let closestDiff = Infinity;
  for (const e of history) {
    const diff = Math.abs(e.ts - target);
    if (diff < closestDiff) {
      closestDiff = diff;
      baseline = e;
    }
  }
  if (!baseline || baseline.value <= 0) {
    return { tier: "swim", baseline: null, baselineAgeMs: null };
  }

  const change = (current - baseline.value) / baseline.value;
  let tier: Tier;
  if (current > baseline.value) {
    tier = change > ROCKET_THRESHOLD ? "rocket" : "swim";
  } else if (current < baseline.value) {
    tier = "sink";
  } else {
    tier = "swim";
  }
  return { tier, baseline: baseline.value, baselineAgeMs: now - baseline.ts };
}

interface EdgeContext {
  waitUntil(promise: Promise<unknown>): void;
}

export default async function handler(
  _req: Request,
  ctx: EdgeContext,
): Promise<Response> {
  const now = Date.now();

  const [mc, history] = await Promise.all([
    getMarketCapUsd().catch(() => 0),
    readHistory(),
  ]);

  const { tier, baseline, baselineAgeMs } = pickTier(mc, history, now);
  const imageUrl =
    tier === "rocket" ? IMG_ROCKET : tier === "sink" ? IMG_SINK : IMG_SWIM;

  // Append current to history, trim, write back. ctx.waitUntil keeps
  // the request alive until the write completes.
  const newHistory = [...history, { value: mc, ts: now }].slice(-HISTORY_MAX);
  ctx.waitUntil(writeHistory(newHistory).catch(() => {}));

  const changeStr =
    baseline !== null && baseline > 0
      ? (((mc - baseline) / baseline) * 100).toFixed(2) + "%"
      : "n/a";

  return new Response(null, {
    status: 302,
    headers: {
      Location: imageUrl,
      "Cache-Control": "public, s-maxage=60, max-age=30",
      "X-Pool-Tier": tier,
      "X-Pool-Marketcap": String(mc),
      "X-Pool-Baseline": baseline !== null ? String(baseline) : "n/a",
      "X-Pool-Baseline-Age-Sec":
        baselineAgeMs !== null ? String(Math.round(baselineAgeMs / 1000)) : "n/a",
      "X-Pool-Change": changeStr,
      "X-Pool-History-Size": String(newHistory.length),
    },
  });
}
