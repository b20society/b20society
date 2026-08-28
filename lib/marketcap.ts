// Marketcap computation for B20 Society
// Reads V4 pool slot0 + Chainlink NVDA/USD price, returns USD marketcap + tier

import {
  createPublicClient,
  http,
  parseAbi,
  fallback,
  keccak256,
  encodePacked,
  getAddress,
} from "viem";
import { base } from "viem/chains";
import {
  CHAINLINK_NVDA_FEED,
  NVDA_ADDRESS,
  POOL_MANAGER,
  TIER_STEP,
  TOTAL_SUPPLY,
} from "./constants";
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

const POOL_MANAGER_ABI = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function extsload(bytes32 slot) view returns (bytes32)",
]);

const CHAINLINK_ABI = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
]);

// V4 PoolManager._pools mapping slot. Discovered from the contract's
// storage layout. The mapping stores a Pool struct where:
//   slot 0: currency0 (address)
//   slot 1: currency1 (address)
//   slot 2: fee       (uint24)
//   ...
// We read slot 0 (currency0) by computing the mapping's storage slot.
const POOLS_MAPPING_SLOT = 6n; // _pools is the 7th state variable in PoolManager

/**
 * Read currency0 from a V4 pool. Uses the IExtsload interface.
 *
 * In V4's PoolManager, pools are stored in a mapping at slot 6:
 *   mapping(bytes32 => Pool) public _pools;
 * The Pool struct begins with currency0 (address) at offset 0.
 *
 * To read: keccak256(abi.encode(poolId, 6)) gives the slot.
 */
async function getCurrency0(
  poolId: `0x${string}`,
): Promise<`0x${string}`> {
  const slot = keccak256(
    encodePacked(["bytes32", "uint256"], [poolId, POOLS_MAPPING_SLOT]),
  );
  const raw = (await client.readContract({
    address: POOL_MANAGER,
    abi: POOL_MANAGER_ABI,
    functionName: "extsload",
    args: [slot],
  })) as `0x${string}`;
  return `0x${raw.slice(-40)}` as `0x${string}`;
}

/**
 * Read the V4 pool's current sqrtPriceX96 and detect which side SOCIETY is on.
 */
async function getPoolState(poolId: `0x${string}`): Promise<{
  sqrtPriceX96: bigint;
  societyIsCurrency0: boolean;
}> {
  const [slot0, currency0] = await Promise.all([
    client.readContract({
      address: POOL_MANAGER,
      abi: POOL_MANAGER_ABI,
      functionName: "getSlot0",
      args: [poolId],
    }) as Promise<readonly [bigint, number, number, number]>,
    getCurrency0(poolId),
  ]);

  // V4 sorts tokens: currency0 = lower address, currency1 = higher address.
  // Since NVDA is fixed and SOCIETY address comes from env, we can detect
  // the orientation by comparing addresses.
  const nvdaChecksum = getAddress(NVDA_ADDRESS);
  const currency0Checksum = getAddress(currency0);
  const societyIsCurrency0 = currency0Checksum !== nvdaChecksum;

  return {
    sqrtPriceX96: slot0[0],
    societyIsCurrency0,
  };
}

/**
 * Read the latest NVDA/USD price from Chainlink.
 * Returns the price as a Number (USD per NVDA).
 */
export async function getNvdaPriceUsd(): Promise<{
  priceUsd: number;
  updatedAt: number;
  isStale: boolean;
}> {
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

  // Stale check: if updatedAt > 24h ago, mark as stale
  const nowSec = Math.floor(Date.now() / 1000);
  const isStale = nowSec - Number(updatedAt) > 86400;

  return { priceUsd, updatedAt: Number(updatedAt), isStale };
}

/**
 * Compute SOCIETY's USD marketcap from V4 pool + Chainlink.
 *
 * Flow:
 *   1. Read V4 pool sqrtPriceX96 to get SOCIETY/NVDA ratio
 *   2. Read Chainlink for NVDA/USD
 *   3. SOCIETY in USD = (SOCIETY/NVDA ratio) × (NVDA/USD)
 *   4. marketcap = totalSupply × SOCIETY in USD
 */
export async function computeMarketcap(
  poolId: `0x${string}`,
): Promise<{
  marketcapUsd: number;
  tier: number;
  nvdaPriceUsd: number;
  priceStale: boolean;
}> {
  const [pool, price] = await Promise.all([
    getPoolState(poolId),
    getNvdaPriceUsd(),
  ]);

  // V4 stores sqrt(token1/token0) * 2^96
  // If token0=NVDA, token1=SOCIETY: ratio = SOCIETY/NVDA
  // If token0=SOCIETY, token1=NVDA: ratio = NVDA/SOCIETY (we need the inverse)
  const ratio = Number(pool.sqrtPriceX96) / 2 ** 96;
  const priceRatio = ratio * ratio; // token1/token0

  // SOCIETY in NVDA = priceRatio if SOCIETY is token1, else 1/priceRatio
  const societyInNvda = pool.societyIsCurrency0
    ? 1 / priceRatio
    : priceRatio;

  // SOCIETY in USD
  const societyInUsd = societyInNvda * price.priceUsd;

  // Marketcap in USD. TOTAL_SUPPLY has 18 decimals, price is per raw token.
  const marketcapUsd =
    (Number(TOTAL_SUPPLY) / 1e18) * societyInUsd;

  // Tier
  const tier = Math.max(
    0,
    Math.min(TIER_COUNT - 1, Math.floor(marketcapUsd / TIER_STEP)),
  );

  return {
    marketcapUsd,
    tier,
    nvdaPriceUsd: price.priceUsd,
    priceStale: price.isStale,
  };
}
