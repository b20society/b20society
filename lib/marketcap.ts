// Marketcap computation for B20 Society
// Reads V4 pool state via o1 API + Chainlink NVDA/USD price, returns USD marketcap + tier
//
// Strategy: o1 API for V4 pool state (more reliable than direct V4 contract reads,
// which can revert on edge cases). Chainlink for NVDA price is independent and read directly.

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

// o1 API: 5s timeout. Vercel Edge has 25s budget total; o1 sometimes hangs on
// fresh blocks while waiting for their indexer. 5s gives enough time for cache
// hits and a couple of fresh fetches, but never starves the function.
const O1_TIMEOUT_MS = 5_000;

type MarketcapResult = {
  marketcapUsd: number;
  tier: number;
  nvdaPriceUsd: number;
  priceStale: boolean;
  source: "o1" | "fallback";
};

/**
 * Fetch V4 pool state + market cap from o1 API. With explicit timeout.
 */
async function fetchO1PoolState(
  tokenAddress: string,
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
    console.warn(
      "o1 API fetch failed/timed out:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
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
 *   1. Try o1 API (5s timeout)
 *   2. Always read NVDA price from Chainlink (overrides if o1 missing it)
 *   3. Fall back to NVDA price only (tier 0, marketcap 0)
 */
export async function computeMarketcap(
  _poolId: string,
): Promise<MarketcapResult> {
  const societyAddress = process.env.SOCIETY_ADDRESS as string | undefined;

  let marketcapUsd = 0;
  let nvdaPriceUsd = 0;
  let priceStale = false;
  let source: "o1" | "fallback" = "fallback";

  // Try o1 API (5s timeout)
  if (societyAddress) {
    const o1State = await fetchO1PoolState(societyAddress);
    if (o1State && o1State.marketcapUsd > 0) {
      marketcapUsd = o1State.marketcapUsd;
      nvdaPriceUsd = o1State.nvdaPriceUsd;
      priceStale = o1State.priceStale;
      source = "o1";
    }
  }

  // Always read NVDA price from Chainlink (overrides if o1 returned 0)
  if (nvdaPriceUsd === 0) {
    try {
      const price = await getNvdaPriceUsd();
      nvdaPriceUsd = price.priceUsd;
      priceStale = price.isStale;
    } catch {
      /* ignore */
    }
  }

  const tier = Math.max(
    0,
    Math.min(TIER_COUNT - 1, Math.floor(marketcapUsd / TIER_STEP)),
  );

  return { marketcapUsd, tier, nvdaPriceUsd, priceStale, source };
}
