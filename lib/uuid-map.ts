// Random UUID map for tier/phase image URLs.
//
// Goal: image URLs are not predictable from the tier/phase number, so users
// can't preview the next tier by guessing /images/Soc2.jpg etc.
//
// The actual file content stays the same (Soc1.jpg, Soc2.jpg, ...), but the
// URL exposed via the metadata API uses a random UUID. The /api/img/[uuid]
// endpoint maps the UUID back to the file.
//
// Note: these UUIDs are not security tokens — they just hide the pattern.
// A determined user could brute-force or scrape links. The point is that
// casual URL-guessing doesn't reveal upcoming tiers.

const TIER_UUIDS: Record<number, string> = {
  1: "f7a3b2c1-4d5e-6f78-90ab-cdef12345678",
  2: "a1b2c3d4-e5f6-7890-1234-567890abcdef",
  3: "9c8d7e6f-5a4b-3c2d-1e0f-fedcba987654",
  4: "2e4f6a8c-0b1d-3f5e-7a9b-cdf012345678",
  5: "b8c7d6e5-f4a3-2918-3647-58596a6b6c6d",
  6: "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
  7: "abcdef01-2345-6789-abcd-ef0123456789",
  8: "deadbeef-cafe-babe-feed-face12345678",
  9: "12345678-9abc-def0-1234-56789abcdef0",
  10: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
  11: "1a1a1a1a-bbbb-cccc-dddd-eeeeffff0000",
  12: "2b2b2b2b-cccc-dddd-eeee-ffff00001111",
  13: "3c3c3c3c-dddd-eeee-ffff-000011112222",
  14: "4d4d4d4d-eeee-ffff-0000-111122223333",
  15: "5e5e5e5e-ffff-0000-1111-222233334444",
  16: "6f6f6f6f-0000-1111-2222-333344445555",
  17: "70809010-2120-3130-4140-515061708182",
  18: "81919293-a4a5-b6b7-c8c9-d9dae0e1e2e3",
  19: "92939495-a6a7-b8b9-cacb-dcdcefdfe0e1",
  20: "a3a4a5a6-a7a8-b9ba-cbcb-dcdde0e1e2e3",
  21: "b4b5b6b7-b8b9-bacb-cccd-dedfe1e2e3e4",
  22: "c5c6c7c8-c9ca-cbdc-cdde-dee0e1e2e3e5",
  23: "d6d7d8d9-dadb-dcec-dede-dfe0e1e2e3e6",
  24: "e7e8e9ea-ebec-eded-edfe-e0e1e2e3e4e7",
  25: "f8f9fafb-fcfc-fdfd-fefe-ff0001020304",
  26: "091a2b3c-4d5e-6f70-8182-939495969798",
  27: "10203040-5060-7080-90a0-b0c0d0e0f000",
  28: "21314151-6171-8181-9191-a1b1c1d1e1f1",
  29: "32425262-7272-8282-9292-a2b2c2d2e2f2",
  30: "43536373-8383-9393-a3a3-b3c3d3e3f303",
  31: "54647484-9494-a4a4-b4b4-c4d4e4f40414",
  32: "65758595-a5a5-b5b5-c5c5-d5e5f5051525",
  33: "768696a6-b6b6-c6c6-d6d6-e6f606162736",
  34: "8797a7b7-c7c7-d7d7-e7e7-f70717182737",
  35: "98a8b8c8-d8d8-e8e8-f8f8-081828384848",
  36: "a9b9c9d9-e9e9-f9f9-0909-192939495959",
  37: "bacadada-fafa-0a0a-1a1a-2b3a4b5c6d6e",
  38: "cbdbedbf-0b0b-1b1b-2b2b-3c4d5e6f7071",
  39: "dcdfeac0-1c1c-2c2c-3c3c-4d5e6f708182",
  40: "edf0c1d2-2d2d-3d3d-4d4d-5e6f70819293",
  41: "fef1c2d3-3e3e-4e4e-5e5f-607182939495",
  42: "0fc2d3e4-4f4f-5f5f-6061-718293a49596",
  43: "10d3e4f5-5050-6060-7171-8283a4b5c697",
  44: "21e4f5a6-6161-7171-8282-9394a5b6c798",
  45: "32f5a6b7-7272-8282-9393-a4a5b6c7d899",
  46: "43a6b7c8-8383-9393-a4a4-b5b6c7d8e9aa",
  47: "54b7c8d9-9494-a4a4-b5b5-c6d7d8e9f0ab",
  48: "65c8d9ea-a5a5-b5b5-c6c6-d7d8e9f0a1bc",
  49: "76d9eafb-b6b6-c6c6-d7d7-e8e9f0a1b2cd",
  50: "87eafb0c-c7c7-d7d7-e8e8-f9f0a1b2c3de",
  51: "98fb0c1d-d8d8-e8e8-f9f9-0a0a1b2c3d4e",
  52: "a90c1d2e-e9e9-f9f9-0a0a-1b1c2d3e4f50",
  53: "ba1d2e3f-fafa-0a0a-1b1b-2c2d3e4f5061",
  54: "cb2e3f40-0b0b-1c1c-2d2d-3e3f40516273",
  55: "dc3f4051-1c1c-2d2d-3e3e-404f51526384",
  56: "ed405162-2d2d-3e3e-4f4f-505162637495",
  57: "fe516273-3e3e-4f4f-5050-616273748596",
  58: "0f627384-4f4f-5050-6161-7273748586a7",
  59: "10738495-5050-6161-7272-838495a6b7c8",
  60: "218495a6-6161-7272-8383-9495a6b7c8d9",
  61: "3295a6b7-7272-8383-9494-a5a6b7c8d9ea",
  62: "43a6b7c8-8383-9494-a5a5-b6c7d8e9fafb",
  63: "54b7c8d9-9494-a5a5-b6b6-c7d8e9fafb0c",
  64: "65c8d9ea-a5a5-b6b6-c7c7-d8e9fafb0c1d",
  65: "76d9eafb-b6b6-c7c7-d8d8-e9fafb0c1d2e",
  66: "87eafb0c-c7c7-d8d8-e9e9-fafb0c1d2e3f",
  67: "98fb0c1d-d8d8-e9e9-fafa-0b0c1d2e3f40",
  68: "a90c1d2e-e9e9-fafa-0b0b-1c1d2e3f4051",
  69: "ba1d2e3f-fafa-0b0b-1c1c-2d2e3f405162",
  70: "cb2e3f40-0b0b-1c1c-2d2d-3e3f40516273",
  71: "dc3f4051-1c1c-2d2d-3e3e-404f51526384",
  72: "ed405162-2d2d-3e3e-4f4f-505162637485",
  73: "fe516273-3e3e-4f4f-5050-616263748596",
  74: "0f627384-4f4f-5050-6161-7273748586a7",
  75: "10738495-5050-6161-7272-83848596a7b8",
  76: "218495a6-6161-7272-8383-949596a7b8c9",
  77: "3295a6b7-7272-8383-9494-a595a6b7c8d9",
  78: "43a6b7c8-8383-9494-a5a5-b6a6b7c8d9ea",
  79: "54b7c8d9-9494-a5a5-b6b6-c7a7b8c8d9ea",
  80: "65c8d9ea-a5a5-b6b6-c7c7-d8a8b8c8d9ea",
  81: "76d9eafb-b6b6-c7c7-d8d8-e9a8b8c8d9ea",
  82: "87eafb0c-c7c7-d8d8-e9e9-fa08a8b8c8d9",
  83: "98fb0c1d-d8d8-e9e9-fafa-0b08a8b8c8d9",
  84: "a90c1d2e-e9e9-fafa-0b0b-1c08a8b8c8d9",
  85: "ba1d2e3f-fafa-0b0b-1c1c-2d08a8b8c8d9",
  86: "cb2e3f40-0b0b-1c1c-2d2d-3e08a8b8c8d9",
  87: "dc3f4051-1c1c-2d2d-3e3e-4008a8b8c8d9",
  88: "ed405162-2d2d-3e3e-4f4f-5008a8b8c8d9",
  89: "fe516273-3e3e-4f4f-5050-6008a8b8c8d9",
  90: "0f627384-4f4f-5050-6161-7008a8b8c8d9",
  91: "10738495-5050-6161-7272-8008a8b8c8d9",
};

const PHASE_UUIDS: Record<number, string> = {
  1: "aa01bb02-cc03-dd04-ee05-ff06aa07bb08",
  2: "aa11bb22-cc33-dd44-ee55-ff66aa77bb88",
  3: "aa22bb33-cc44-dd55-ee66-ff77aa88bb99",
  4: "aa33bb44-cc55-dd66-ee77-ff88aa99bbaa",
  5: "aa44bb55-cc66-dd77-ee88-ff99aabbccdd",
  6: "aa55bb66-cc77-dd88-ee99-ffaabbccddee",
  7: "aa66bb77-cc88-dd99-eeaa-ffbbccddeeff",
  8: "aa77bb88-cc99-ddaa-eebb-ffccddeeff00",
  9: "aa88bb99-ccaaddebbffccddeeff0011",
  10: "aa99bbaa-ccbbddccffbbccddeeff0022",
};

export function tierToUuid(tier: number): string {
  return TIER_UUIDS[tier] ?? TIER_UUIDS[1];
}

export function uuidToTier(uuid: string): number | null {
  for (const [tier, u] of Object.entries(TIER_UUIDS)) {
    if (u === uuid) return Number(tier);
  }
  return null;
}

export function phaseToUuid(phase: number): string {
  return PHASE_UUIDS[phase] ?? PHASE_UUIDS[1];
}

export function uuidToPhase(uuid: string): number | null {
  for (const [phase, u] of Object.entries(PHASE_UUIDS)) {
    if (u === uuid) return Number(phase);
  }
  return null;
}
