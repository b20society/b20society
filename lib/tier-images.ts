// Tier constants for B20 Society token images.
//
// 91 tier images live in public/images/uuid/{uuid}.jpg (UUID-named
// to hide the next-tier image from URL-guessing).
// Tier 0 (lowest marketcap) -> tier 1 image
// Tier 90 (highest, capped at $1M) -> tier 91 image
//
// For the actual URL builder, see lib/uuid-map.ts:tierImageUrl.
//
// Step = $1,000,000 / 90 = $11,111.11 per tier (configured in lib/constants.ts).

export const TIER_COUNT = 91;
