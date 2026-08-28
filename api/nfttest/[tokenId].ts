// TEST endpoint — returns mock NFT metadata for frontend testing
// URL: /api/nfttest/[tokenId]
//
// By default: token is NOT minted (404) to simulate fresh launch.
// Use ?minted=1,2,3,42 to mark specific tokens as minted.
//
//   GET /api/nfttest/42                   → 404 (default: not minted)
//   GET /api/nfttest/42?minted=42         → 200, minted
//   GET /api/nfttest/42?minted=1,42,100   → 200 for #1, #42, #100, 404 for others
//   GET /api/nfttest/42?phase=7           → override phase (1-10)
//   GET /api/nfttest/42?minted=1,2,3&phase=5  → minted at phase 5
//
// Real /api/nft/[tokenId] is unaffected.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { NFT_MAX_SUPPLY } from "../../lib/constants";

export const config = {
  runtime: "edge",
};

const PUBLIC_DOMAIN = "https://b20society.com";

export default async function handler(
  req: VercelRequest,
  _res: VercelResponse,
): Promise<Response> {
  const url = new URL(req.url ?? "/", PUBLIC_DOMAIN);
  const match = url.pathname.match(/\/api\/nfttest\/(\d+)/);
  const tokenIdStr = match?.[1];

  if (!tokenIdStr) {
    return jsonError("TokenId required", 400);
  }

  const tokenId = Number(tokenIdStr);
  if (Number.isNaN(tokenId) || tokenId < 1 || tokenId > NFT_MAX_SUPPLY) {
    return jsonError(
      `TokenId out of range (must be 1-${NFT_MAX_SUPPLY})`,
      400,
    );
  }

  // Default: not minted. Override via ?minted=1,2,3
  const mintedParam = url.searchParams.get("minted");
  let isMinted = false;
  if (mintedParam) {
    const mintedList = mintedParam
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => !Number.isNaN(n));
    isMinted = mintedList.includes(tokenId);
  }

  if (!isMinted) {
    return jsonError(
      `[TEST] Token #${tokenIdStr} not minted yet (default: fresh launch)`,
      404,
    );
  }

  // Phase override
  const phaseOverride = url.searchParams.get("phase");
  let phase: number;
  if (phaseOverride) {
    phase = Math.min(10, Math.max(1, Number(phaseOverride)));
  } else {
    phase = 1; // default: freshly minted, all start at phase 1
  }

  return new Response(
    JSON.stringify(
      {
        name: `B20 Society #${tokenIdStr}`,
        description: "[TEST] B20 Society NFT — self-evolving through 10 phases via $SOCIETY burns. Mock data.",
        image:
          phase === 1
            ? `${PUBLIC_DOMAIN}/images/Soc1.jpg`
            : `${PUBLIC_DOMAIN}/images/nft/phase-${phase}.gif`,
        external_url: `${PUBLIC_DOMAIN}/nft?id=${tokenIdStr}`,
      },
      null,
      2,
    ),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "X-Test-Endpoint": "true",
      },
    },
  );
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Test-Endpoint": "true",
    },
  });
}
