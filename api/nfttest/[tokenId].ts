// TEST endpoint — returns mock NFT metadata for frontend testing
// URL: /api/nfttest/[tokenId]
//
// Supports query params:
//   ?phase=N    → override phase (1-10), default = (tokenId % 10) + 1
//   ?exists=true|false → whether token "exists" (default true)
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
  if (tokenId < 1 || tokenId > NFT_MAX_SUPPLY) {
    return jsonError(
      `TokenId out of range (must be 1-${NFT_MAX_SUPPLY})`,
      404,
    );
  }

  // Query overrides
  const phaseOverride = url.searchParams.get("phase");
  const existsOverride = url.searchParams.get("exists");

  let exists = true;
  if (existsOverride === "false") exists = false;
  if (existsOverride === "true") exists = true;

  if (!exists) {
    return jsonError(`[TEST] Token #${tokenIdStr} marked as not minted`, 404);
  }

  // Default phase: (tokenId % 10) + 1, so different tokens show different phases
  let phase: number;
  if (phaseOverride) {
    phase = Math.min(10, Math.max(1, Number(phaseOverride)));
  } else {
    phase = (tokenId % 10) + 1;
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
    headers: { "Content-Type": "application/json" },
  });
}
