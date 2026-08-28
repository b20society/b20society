// Marketcap computation for B20 Society
// Reads V4 pool state via o1 API + Chainlink NVDA/USD price, returns USD marketcap + tier
//
// Strategy: use o1 API for V4 pool state (more reliable than direct V4 contract reads,
// which can revert on edge cases). Chainlink for NVDA price is independent and read directly.

import { createPublicClient, http, parseAbi, fallback } from "viem";
import { base } from "viem/chains";
import { CHAINLINK_NVDA_FEED, TIER_STEP, TOTAL_SUPPLY } from "./constants";
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

/**
 * Fetch V4 pool state + market cap from o1 API.
 * o1's indexer computes market cap from their node, which is more reliable
 * than reading V4 contract directly (V4 has quirks with slot0 reading).
 */
async function fetchO1PoolState(tokenAddress: `0x${string}`): Promise<{
  marketcapUsd: number;
  nvdaPriceUsd: number;
  priceStale: boolean;
} | null> {
  const apiKey = process.env.O1_API;
  if (!apiKey) return null;

  try {
    const res = await fetch(
      `https://api.launch.o1.exchange/v1/tokens/8453/${tokenAddress}`,
      { headers: { "x-api-key": apiKey } },
    );
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
  } catch {
    return null;
  }
}

/**
 * Read NVDA/USD price from Chainlink as fallback.
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
 *   1. Try o1 API (most reliable for V4 pool state)
 *   2. Fall back to stub (tier 0) if API fails or env vars missing
 *
 * NVDA price always from Chainlink (independent).
 */
export async function computeMarketcap(
  poolId: `0x${string}`,
): Promise<{
  marketcapUsd: number;
  tier: number;
  nvdaPriceUsd: number;
  priceStale: boolean;
}> {
  const societyAddress = process.env.SOCIETY_ADDRESS as
    | `0x${string}`
    | undefined;

  // Try o1 API first
  if (societyAddress) {
    const o1State = await fetchO1PoolState(societyAddress);
    if (o1State) {
      const tier = Math.max(
        0,
        Math.min(
          TIER_COUNT - 1,
          Math.floor(o1State.marketcapUsd / TIER_STEP),
        ),
      );
      return {
        marketcapUsd: o1State.marketcapUsd,
        tier,
        nvdaPriceUsd: o1State.nvdaPriceUsd,
        priceStale: o1State.priceStale,
      };
    }
  }

  // Fallback: read NVDA price from Chainlink + assume 0 market cap
  const price = await getNvdaPriceUsd();

  return {
    marketcapUsd: 0,
    tier: 0,
    nvdaPriceUsd: price.priceUsd,
    priceStale: price.isStale,
  };
}
