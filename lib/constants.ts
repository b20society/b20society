// Base chain configuration and contract addresses for B20 Society

export const CHAIN_ID = 8453 as const;
export const CHAIN_NAME = "base" as const;
export const RPC_URL = "https://base.drpc.org" as const;

// Token contract addresses
export const RWA_STOCK_FACTORY =
  "0xFf70918Ef17A2D74d683a8297813B177BaFaD1f4" as const;
export const CRYPTO_FACTORY =
  "0xa52ad458cE0282a971ecC71C051A32f28946bb9F" as const;

// NVDA token (B20 precompile, paired with SOCIETY)
export const NVDA_ADDRESS =
  "0xb20000000000000000000078ee7ce2fE4908108C" as const;

// Chainlink NVDA/USD price feed on Base
export const CHAINLINK_NVDA_FEED =
  "0x04689a41629776563E6822F76f2e57D148d28513" as const;

// Uniswap V4 PoolManager on Base
export const POOL_MANAGER =
  "0x498581ff718922c3f8e6a244956af099b2652b2b" as const;

// Total supply of SOCIETY token (1B with 18 decimals)
export const TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n;

// Tier mapping: 91 tiers, $11,111.11 per tier (90 × $11,111.11 = $1,000,000).
// Tier 0 = $0, tier 90 = $1M (capped).
export const TIER_STEP = 11_111.11; // USD per tier

// Cache TTL for metadata endpoint
export const METADATA_CACHE_TTL = 10; // seconds
