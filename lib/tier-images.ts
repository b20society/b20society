// Tier-to-filename mapping for B20 Society token images.
//
// 91 images (Soc1.jpg ... Soc91.jpg) live in public/images/.
// Tier 0 (lowest marketcap) = Soc1.jpg
// Tier 90 (highest, capped at $1M) = Soc91.jpg
//
// Step = $1,000,000 / 90 = $11,111.11 per tier (configured in lib/constants.ts).
// This makes tier 90 land at exactly $1M with 91 hand-crafted frames
// (10 masters × 9 transitions between each = 10 + 9×9 = 91).

export const TIER_COUNT = 91;
export const IMAGE_EXT = ".jpg";

/**
 * Get the public URL for a tier image on the deployed domain.
 * @param tier 0 to TIER_COUNT-1
 * @param domain e.g. "https://b20society.com"
 */
export function tierImageUrl(tier: number, domain: string): string {
  if (tier < 0 || tier >= TIER_COUNT) {
    throw new Error(`Invalid tier ${tier}, must be 0-${TIER_COUNT - 1}`);
  }
  return `${domain}/images/Soc${tier + 1}${IMAGE_EXT}`;
}
