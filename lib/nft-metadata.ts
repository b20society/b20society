// NFT metadata builder for B20 Society.
//
// Generates ERC-721 metadata with phase-specific attributes, description,
// and traits. The metadata is fully determined by the on-chain phase of
// the NFT, so each phase has its own unique metadata (image, description,
// traits).
//
// Burn cost curve (in $SOCIETY, 18 decimals):
//   1 -> 2:  20,000
//   2 -> 3:  30,000
//   3 -> 4:  40,000
//   4 -> 5:  50,000
//   5 -> 6:  60,000
//   6 -> 7:  70,000
//   7 -> 8:  80,000
//   8 -> 9:  90,000
//   9 -> 10: 100,000  (MAX PHASE — no further burns)

export const BURN_COST_BY_PHASE: Record<number, bigint> = {
  1: 20_000n,
  2: 30_000n,
  3: 40_000n,
  4: 50_000n,
  5: 60_000n,
  6: 70_000n,
  7: 80_000n,
  8: 90_000n,
  9: 100_000n,
};

const PHASE_DESCRIPTIONS: Record<number, string> = {
  1: "B20 Society NFT — Phase 1 of 10. The starting state. Burn $SOCIETY to evolve this NFT through 9 more visual phases.",
  2: "B20 Society NFT — Phase 2 of 10. After burning 20,000 $SOCIETY, the first evolution. Continue burning to unlock more phases.",
  3: "B20 Society NFT — Phase 3 of 10. After burning 50,000 $SOCIETY total. Three burns in, the holder is committed to the journey.",
  4: "B20 Society NFT — Phase 4 of 10. After burning 90,000 $SOCIETY total. Halfway through the evolution curve.",
  5: "B20 Society NFT — Phase 5 of 10. After burning 140,000 $SOCIETY total. The mid-point — visual and on-chain.",
  6: "B20 Society NFT — Phase 6 of 10. After burning 200,000 $SOCIETY total. The cost curve steepens, but the artwork rewards commitment.",
  7: "B20 Society NFT — Phase 7 of 10. After burning 270,000 $SOCIETY total. Three phases from the final form.",
  8: "B20 Society NFT — Phase 8 of 10. After burning 350,000 $SOCIETY total. Two burns away from completion.",
  9: "B20 Society NFT — Phase 9 of 10. After burning 440,000 $SOCIETY total. One last burn to reach the apex.",
  10: "B20 Society NFT — Phase 10 of 10 (MAX). After burning 540,000 $SOCIETY total. Fully evolved. No further burns possible.",
};

/** Format a wei bigint (18 decimals) as a human-readable SOCIETY amount. */
function formatSoc(wei: bigint): string {
  const n = Number(wei) / 1e18;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M $SOCIETY`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K $SOCIETY`;
  return `${n.toFixed(0)} $SOCIETY`;
}

export interface NftMetadataArgs {
  tokenId: string;
  phase: number; // 1..10
  image: string; // pre-built UUID-based image URL
  externalUrl: string;
}

export interface NftMetadata {
  name: string;
  description: string;
  image: string;
  external_url: string;
  attributes: Array<{ trait_type: string; value: string | number }>;
}

/** Build ERC-721 metadata for a B20 Society NFT at the given phase. */
export function buildNftMetadata(args: NftMetadataArgs): NftMetadata {
  const { tokenId, phase, image, externalUrl } = args;
  const isMax = phase >= 10;
  const nextCost = BURN_COST_BY_PHASE[phase] ?? 0n;

  // Cumulative cost (sum of all burn costs up to current phase)
  let cumulative = 0n;
  for (let p = 1; p < phase; p++) {
    cumulative += BURN_COST_BY_PHASE[p] ?? 0n;
  }

  return {
    name: `B20 Society #${tokenId} — Phase ${phase}`,
    description:
      PHASE_DESCRIPTIONS[phase] ??
      `B20 Society NFT — Phase ${phase} of 10. Self-evolving through 10 visual phases via $SOCIETY burns.`,
    image,
    external_url: externalUrl,
    attributes: [
      // Phase info — most important, shown prominently in wallets/marketplaces
      { trait_type: "Phase", value: phase },
      { trait_type: "Phase Name", value: `Phase ${phase}` },
      { trait_type: "Stage", value: `${phase} of 10` },

      // Status
      {
        trait_type: "Status",
        value: isMax ? "Max Phase" : "Active",
      },
      {
        trait_type: "Fully Evolved",
        value: isMax ? "Yes" : "No",
      },

      // Burn economics
      {
        trait_type: "Burn Cost to Next Phase",
        value: isMax ? "MAX" : formatSoc(nextCost * 10n ** 18n),
      },
      {
        trait_type: "Total Burned",
        value: phase === 1 ? "0" : formatSoc(cumulative * 10n ** 18n),
      },

      // Collection info
      { trait_type: "Collection", value: "B20 Society" },
      { trait_type: "Type", value: "Self-Evolving NFT" },
      { trait_type: "Network", value: "Base" },
    ],
  };
}
