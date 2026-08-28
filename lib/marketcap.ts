// Marketcap computation for B20 Society
// Reads market data from DexScreener (no API key) + Chainlink NVDA/USD price.
//
// Strategy:
//   1. DexScreener for market cap (works reliably, free, no auth)
//   2. Chainlink for NVDA/USD price (independent oracle)
//
// DexScreener is used instead of o1 API because o1 was timing out from Vercel Edge.

import { createPublicClient, http, parseAbi, fallback } from "viem";
import { base } from "viem/chains";
import { CHAINLINK_NVDA_FEED, TIER_STEP } from "./constants";
import { TIER_COUNT } from "./tier-images";

const client = createPublicClient({
  chain: base,
  transport: fallback([
    // Use BASE_RPC env var (Alchemy) if set, else fall back to public RPCs
    http(process.env.BASE_RPC ?? "https://base.drpc.org"),
    http("https://mainnet.base.org"),
    http("https://base.publicnode.com"),
  ]),
  batch: { multicall: true },
});

const CHAINLINK_ABI = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
]);

// DexScreener: 5s timeout (their endpoint usually <500ms).
const DEXS_TIMEOUT_MS = 5_000;

type MarketcapResult = {
  marketcapUsd: number;
  tier: number;
  nvdaPriceUsd: number;
  priceStale: boolean;
  source: "dexscreener" | "fallback";
};

/**
 * Fetch market data from DexScreener (free, no API key).
 * Returns: market cap (FDV) in USD, plus optionally NVDA price.
 */
async function fetchDexScreenerData(
  tokenAddress: string,
  timeoutMs: number = DEXS_TIMEOUT_MS,
): Promise<{
  marketcapUsd: number;
  nvdaPriceUsd: number;
  priceStale: boolean;
} | null> {
  try {
    const fetchPromise = fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
    );
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`DexScreener timeout after ${timeoutMs}ms`)), timeoutMs),
    );
    const res = await Promise.race([fetchPromise, timeoutPromise]);

    if (!res.ok) return null;
    const json = (await res.json()) as {
      pairs?: Array<{
        chainId?: string;
        priceUsd?: string;
        fdv?: number;
        marketCap?: number;
        liquidity?: { usd?: number };
        baseToken?: { address?: string };
        quoteToken?: { address?: string };
      }>;
    };
    // Find the highest-liquidity Base pair for this token
    const basePairs = (json.pairs ?? []).filter(
      (p) => p.chainId === "base" || p.chainId === "8453",
    );
    if (basePairs.length === 0) return null;
    const best = basePairs.sort(
      (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
    )[0];

    // marketCap or FDV (fallback)
    const marketcapUsd = best.marketCap ?? best.fdv ?? 0;
    const priceUsd = Number(best.priceUsd) || 0;
    // DexScreener's price is in USD per raw token (already token-adjusted)
    // If marketCap was 0, derive from price * total supply
    return {
      marketcapUsd,
      nvdaPriceUsd: 0, // We get NVDA price from Chainlink below
      priceStale: false,
    };
  } catch (err) {
    console.warn(
      "DexScreener fetch failed/timed out:",
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
 *   1. DexScreener for market cap (5s timeout)
 *   2. Always read NVDA price from Chainlink
 *   3. Fall back to NVDA price only (tier 0, marketcap 0)
 */
export async function computeMarketcap(
  _poolId: string,
): Promise<MarketcapResult> {
  const societyAddress = process.env.SOCIETY_ADDRESS as string | undefined;

  let marketcapUsd = 0;
  let nvdaPriceUsd = 0;
  let priceStale = false;
  let source: "dexscreener" | "fallback" = "fallback";

  // Try DexScreener (5s timeout)
  if (societyAddress) {
    const dexs = await fetchDexScreenerData(societyAddress);
    if (dexs && dexs.marketcapUsd > 0) {
      marketcapUsd = dexs.marketcapUsd;
      priceStale = dexs.priceStale;
      source = "dexscreener";
    }
  }

  // Always read NVDA price from Chainlink
  try {
    const price = await getNvdaPriceUsd();
    nvdaPriceUsd = price.priceUsd;
    priceStale = price.isStale;
  } catch {
    /* ignore */
  }

  const tier = Math.max(
    0,
    Math.min(TIER_COUNT - 1, Math.floor(marketcapUsd / TIER_STEP)),
  );

  return { marketcapUsd, tier, nvdaPriceUsd, priceStale, source };
}
