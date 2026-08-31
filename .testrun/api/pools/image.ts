// Pools.fun test image endpoint — marketcap-direction dynamic image.
//
// Returns one of three GIFs based on B20 Society / SWIM market cap
// direction vs the value from ~1 minute ago:
//
//   market cap rose by >50% vs ~1min-ago  → rocket
//   market cap rose vs ~1min-ago          → swim  (default)
//   market cap fell vs ~1min-ago          → sink
//   first run / no history                → swim  (default)
//
// Vercel Cron (defined in vercel.json, every minute) calls
// /api/cron-tick, which in turn calls this endpoint. Polling every
// minute keeps the state fresh; the tier decision is based on a
// 1-min window so brief spikes don't trigger an image flip.
//
// Image bytes are served directly from the function (no redirect).
// Files live in /public/images/pools/ — accessible via fetch to the
// same origin in edge runtime (Vercel edge can read public/ files).

export const config = {
  runtime: "edge",
};

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

interface TierLogEntry {
  ts: number;
  tier: Tier;
  mc: number;
  baseline: number | null;
  change_pct: number | null;
}

async function readTierLog(): Promise<TierLogEntry[]> {
  if (!EDGE_CONFIG_ID || !VERCEL_PAT) return [];
  try {
    const res = await fetch(
      `${VERCEL_API}/v1/edge-config/${EDGE_CONFIG_ID}/item/tier_log`,
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

async function writeTierLog(log: TierLogEntry[]): Promise<void> {
  if (!EDGE_CONFIG_ID || !VERCEL_PAT) return;
  try {
    await fetch(`${VERCEL_API}/v1/edge-config/${EDGE_CONFIG_ID}/items`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${VERCEL_PAT}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items: [{ operation: "upsert", key: "tier_log", value: JSON.stringify(log) }],
      }),
      signal: AbortSignal.timeout(3_000),
    });
  } catch {}
}

// 1-min cached ETH price (USD), shared across calls to avoid hammering
// CoinGecko. We re-fetch on every market-cap call but only after the TTL
// expires; the cache lives in module scope.
let _ethPriceUsd: { value: number; ts: number } | null = null;
const ETH_PRICE_TTL_MS = 60_000;

async function getEthPriceUsd(): Promise<number> {
  const now = Date.now();
  if (_ethPriceUsd && now - _ethPriceUsd.ts < ETH_PRICE_TTL_MS) {
    return _ethPriceUsd.value;
  }
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      { signal: AbortSignal.timeout(5_000) },
    );
    if (!res.ok) return _ethPriceUsd?.value ?? 0;
    const data = (await res.json()) as { ethereum?: { usd?: number } };
    const price = data.ethereum?.usd ?? 0;
    if (price > 0) _ethPriceUsd = { value: price, ts: now };
    return price;
  } catch {
    return _ethPriceUsd?.value ?? 0;
  }
}

// Read a Pons v2 bonding-curve's quote / token reserves via the
// getReserves() view. Returns zero on any error (curve not deployed,
// network down, wrong chain id, etc.) so the caller can fall through
// to the legacy DexScreener path.
async function readCurveReservesUsd(
  curve: string,
  rpc: string,
  totalSupplyWei: bigint,
): Promise<number> {
  // getReserves() selector
  const selector = "0x0902f1ac";
  const payload = {
    jsonrpc: "2.0",
    method: "eth_call",
    params: [{ to: curve, data: selector }, "latest"],
    id: 1,
  };
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) return 0;
  const json = (await res.json()) as { result?: string; error?: unknown };
  if (!json.result || json.result === "0x") return 0;
  const hex = json.result.slice(2);
  if (hex.length < 128) return 0;
  // Two uint256 values back to back: 64 hex chars each.
  const quoteReserve = BigInt("0x" + hex.slice(0, 64));
  const tokenReserve = BigInt("0x" + hex.slice(64, 128));
  if (quoteReserve === 0n || tokenReserve === 0n) return 0;

  // Price per token (in quote units, scaled by quote decimals). For a
  // native-ETH launch on Robinhood both sides use 18 decimals, so the
  // wei ratio is the same as the decimal ratio.
  const pricePerTokenWei =
    (quoteReserve * (10n ** 18n)) / tokenReserve;
  // MC = pricePerToken * totalSupply (in wei terms)
  const mcWei =
    (pricePerTokenWei * totalSupplyWei) / (10n ** 18n);

  const ethUsd = await getEthPriceUsd();
  if (ethUsd === 0) return 0;
  // mcWei / 1e18 = ETH, * ethUsd = USD
  return (Number(mcWei) / 1e18) * ethUsd;
}

async function getMarketCapUsd(): Promise<number> {
  const swimPool = process.env.SWIM_POOL_ADDRESS;
  const swimToken = process.env.SWIM_ADDRESS;
  const b20Token = "0xb2000000000000000000006006292Dcc749D6401";
  const rpc = process.env.ROBINHOOD_RPC;
  const totalSupplyStr = process.env.SWIM_TOTAL_SUPPLY;

  // Pons v2 path: compute MC directly from the bonding curve so the
  // image flips on the first buy, not on DexScreener indexing (which
  // usually lags new launches by minutes).
  if (
    rpc &&
    swimPool &&
    swimPool !== "0x0000000000000000000000000000000000000000" &&
    totalSupplyStr
  ) {
    try {
      const totalSupplyWei = BigInt(totalSupplyStr);
      const mc = await readCurveReservesUsd(swimPool, rpc, totalSupplyWei);
      if (mc > 0) return mc;
    } catch {
      // fall through to DexScreener
    }
  }

  // Legacy path: DexScreener pair. Used once the curve graduates and
  // the pool is a real UniV2 / V3 / V4 pair. The legacy Flap V3 SWIM
  // pool still uses this branch when SWIM_POOL_ADDRESS is set to a
  // pair that DexScreener has indexed.
  if (swimPool && swimPool !== "0x0000000000000000000000000000000000000000") {
    const url = `https://api.dexscreener.com/latest/dex/pairs/robinhood/${swimPool}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (res.ok) {
      const data = (await res.json()) as {
        pair?: { marketCap?: number; fdv?: number };
        pairs?: Array<{ marketCap?: number; fdv?: number }>;
      };
      const p = data.pair ?? data.pairs?.[0];
      if (p && (p.marketCap ?? p.fdv)) {
        return p.marketCap ?? p.fdv ?? 0;
      }
    }
  }

  // Fallback: look up the token on DexScreener by address.
  const url = "https://api.dexscreener.com/latest/dex/tokens/" + (swimToken || b20Token);
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

// In edge runtime, we can't use fs. We fetch the static files via
// the same origin (Vercel serves /public/* at the root).
const IMAGE_URLS = {
  rocket: "https://b20society.com/images/pools/rocket.gif",
  swim: "https://b20society.com/images/pools/swim.gif",
  sink: "https://b20society.com/images/pools/sink.gif",
};

interface EdgeContext {
  waitUntil(promise: Promise<unknown>): void;
}

export default async function handler(
  _req: Request,
  ctx: EdgeContext,
): Promise<Response> {
  const now = Date.now();

  const [mc, history, tierLog] = await Promise.all([
    getMarketCapUsd().catch(() => 0),
    readHistory(),
    readTierLog(),
  ]);

  const { tier, baseline, baselineAgeMs } = pickTier(mc, history, now);
  const imageUrl = IMAGE_URLS[tier];

  // Update history.
  const newHistory = [...history, { value: mc, ts: now }].slice(-HISTORY_MAX);
  ctx.waitUntil(writeHistory(newHistory).catch(() => {}));

  // Append tier change to log (only when tier actually changes —
  // deduped to keep noise low). Log is capped at 200 entries.
  const lastTier = tierLog.length > 0 ? tierLog[tierLog.length - 1].tier : null;
  if (tier !== lastTier) {
    const changePct =
      baseline !== null && baseline > 0
        ? ((mc - baseline) / baseline) * 100
        : null;
    const newLog = [
      ...tierLog,
      { ts: now, tier, mc, baseline, change_pct: changePct },
    ].slice(-200);
    ctx.waitUntil(writeTierLog(newLog).catch(() => {}));
  }

  // Redirect to the local /images/pools/... file. Vercel serves
  // these directly from the same edge, no Pinata dependency.
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
      "X-Pool-Change":
        baseline !== null && baseline > 0
          ? (((mc - baseline) / baseline) * 100).toFixed(2) + "%"
          : "n/a",
      "X-Pool-History-Size": String(newHistory.length),
    },
  });
}
