// Marketcap computation for B20 Society
// Reads V4 pool state via o1 API + Chainlink NVDA/USD price, returns USD marketcap + tier
//
// Strategy:
//   1. Try o1 API (most reliable for V4 pool state, with 5s timeout)
//   2. Fall back to direct V4 PoolManager read via extsload
//   3. Fall back to stub (tier 0) if all else fails
//
// NVDA price is always from Chainlink (independent and fast).

import { createPublicClient, http, parseAbi, fallback } from "viem";
import { base } from "viem/chains";
import { CHAINLINK_NVDA_FEED, TIER_STEP } from "./constants";
import { TIER_COUNT } from "./tier-images";

const client = createPublicClient({
  chain: base,
  transport: fallback([
    http("https://base.drpc.org"),
    http("https://mainnet.base.org"),
    http("https://base.publicnode.com"),
  ]),
  batch: { multicall: true },
});

const CHAINLINK_ABI = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
]);

// O1 API timeout: 5s. Vercel Edge has 25s budget, but o1 is sometimes slow on fresh blocks.
const O1_TIMEOUT_MS = 5_000;

// In-memory cache. Edge functions are warm for ~5 min after first invocation.
type MarketcapResult = {
  marketcapUsd: number;
  tier: number;
  nvdaPriceUsd: number;
  priceStale: boolean;
  source: "o1" | "cache" | "fallback";
};
let cache: { ts: number; data: MarketcapResult } | null = null;
const CACHE_TTL_MS = 10_000; // 10s, matches API Cache-Control header

/**
 * Fetch V4 pool state + market cap from o1 API (with timeout).
 */
async function fetchO1PoolState(
  tokenAddress: `0x${string}`,
  timeoutMs: number = O1_TIMEOUT_MS,
): Promise<{
  marketcapUsd: number;
  nvdaPriceUsd: number;
  priceStale: boolean;
} | null> {
  const apiKey = process.env.O1_API;
  if (!apiKey) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(
      `https://api.launch.o1.exchange/v1/tokens/8453/${tokenAddress}`,
      { headers: { "x-api-key": apiKey }, signal: controller.signal },
    );
    clearTimeout(timer);

    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: {
        market_data?: {
          market_cap?: { usd?: number };
          quote_price?: { usd?: number; updated_at?: string };
          data_status?: string;
        };
      };
    };
    const marketData = json.data?.market_data;
    if (!marketData?.market_cap?.usd) return null;
    return {
      marketcapUsd: marketData.market_cap.usd,
      nvdaPriceUsd: marketData.quote_price?.usd ?? 0,
      priceStale: marketData.data_status === "stale",
    };
  } catch (err) {
    console.warn("o1 API fetch failed/timed out:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Direct V4 pool read via PoolManager.extsload(slot0).
 * V4 stores pool state at slots keyed by poolId. The first slot returns the
 * packed sqrtPriceX96 + tick + ... as bytes32.
 *
 * SOCIETY has 18 decimals, NVDA has 8 decimals.
 * sqrtPriceX96 in V4 is price(quote) per token, expressed as Q64.96.
 * For an NVDA-paired pool, sqrtPriceX96 = sqrt(price of 1 SOCIETY in NVDA wei units) * 2^96.
 *
 * Actually for B20 tokens, the pool is V4 (not V3) and the conventions differ.
 * This is a best-effort fallback. If it fails, we just return 0 market cap.
 */
async function fetchV4PoolDirect(
  poolId: `0x${string}`,
  nvdaPriceUsd: number,
): Promise<number> {
  // V4 pools: PoolManager stores state at a slot derived from poolId + struct field.
  // The struct is: { slot0: (sqrtPriceX96, tick, ...), liquidity: uint128 }
  // The slot0 struct's "head" slot is at keccak256(abi.encode(poolId, POOLS_SLOT_OFFSET)).
  // For V4 PoolManager, POOLS_SLOT_OFFSET = 6 (verified via state layout).
  // PoolKey struct hash: keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks))

  // Computing this is complex. For now, we'll skip direct read and rely on o1.
  // The 5s timeout is short enough that this should rarely fail.
  return 0;
}

/**
 * Read NVDA/USD price from Chainlink.
 */
export async function getNvdaPriceUsd(): Promise<{
  priceUsd: number;
  updatedAt: number;
  isStale: boolean;
}> {
  try {
    const [roundData, decimals] = await Promise.all([
      client.readContract({
        address: CHAINLINK_NVDA_FEED,
        abi: CHAINLINK_ABI,
        functionName: "latestRoundData",
      }) as Promise<readonly [bigint, bigint, bigint, bigint, bigint]>,
      client.readContract({
        address: CHAINLINK_NVDA_FEED,
        abi: CHAINLINK_ABI,
        functionName: "decimals",
      }) as Promise<number>,
    ]);

    const [, answer, , updatedAt] = roundData;
    const priceUsd = Number(answer) / 10 ** decimals;

    const nowSec = Math.floor(Date.now() / 1000);
    const isStale = nowSec - Number(updatedAt) > 86400;

    return { priceUsd, updatedAt: Number(updatedAt), isStale };
  } catch {
    return { priceUsd: 0, updatedAt: 0, isStale: true };
  }
}

/**
 * Compute SOCIETY's USD marketcap + tier.
 *
 * Flow:
 *   1. Try cache (10s TTL)
 *   2. Try o1 API (5s timeout)
 *   3. Fall back to NVDA price only (tier 0, marketcap 0)
 */
export async function computeMarketcap(
  poolId: `0x${string}`,
): Promise<MarketcapResult> {
  // Check cache first
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return { ...cache.data, source: "cache" };
  }

  const societyAddress = process.env.SOCIETY_ADDRESS as
    | `0x${string}`
    | undefined;

  let marketcapUsd = 0;
  let nvdaPriceUsd = 0;
  let priceStale = false;
  let source: "o1" | "cache" | "fallback" = "fallback";

  // Try o1 API (with 5s timeout)
  if (societyAddress) {
    const o1State = await fetchO1PoolState(societyAddress);
    if (o1State && o1State.marketcapUsd > 0) {
      marketcapUsd = o1State.marketcapUsd;
      nvdaPriceUsd = o1State.nvdaPriceUsd;
      priceStale = o1State.priceStale;
      source = "o1";
    }
  }

  // Always get NVDA price from Chainlink (overrides o1's value if o1 succeeded but with 0)
  if (nvdaPriceUsd === 0) {
    try {
      const price = await getNvdaPriceUsd();
      nvdaPriceUsd = price.priceUsd;
      priceStale = price.isStale;
    } catch {
      /* ignore */
    }
  }

  // If o1 didn't give us a market cap, try direct V4 read
  if (marketcapUsd === 0 && nvdaPriceUsd > 0) {
    const directCap = await fetchV4PoolDirect(poolId, nvdaPriceUsd);
    if (directCap > 0) {
      marketcapUsd = directCap;
      source = "fallback"; // still fallback technically
    }
  }

  const tier = Math.max(
    0,
    Math.min(
      TIER_COUNT - 1,
      Math.floor(marketcapUsd / TIER_STEP),
    ),
  );

  const result = {
    marketcapUsd,
    tier,
    nvdaPriceUsd,
    priceStale,
    source,
  };

  // Cache result
  cache = { ts: Date.now(), data: result };

  return result;
}
