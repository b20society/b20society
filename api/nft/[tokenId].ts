// NFT metadata endpoint
// Returns ERC-7572 metadata for a B20 Society NFT
// Image is dynamic based on the NFT's current phase (1-10)

import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = {
  runtime: "edge",
};

const PUBLIC_DOMAIN = "https://b20society.com";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<Response> {
  try {
    // TokenId from the dynamic route
    const url = new URL(req.url ?? "/", PUBLIC_DOMAIN);
    const match = url.pathname.match(/\/api\/nft\/(\d+)/);
    const tokenIdStr = match?.[1];

    if (!tokenIdStr) {
      return new Response(
        JSON.stringify({ error: "TokenId required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const tokenId = BigInt(tokenIdStr);

    // TODO: read phaseOf(tokenId) from the NFT contract on Base
    // For now, stub to phase 1 so the response shape is valid
    const phase = 1;

    const metadata = {
      name: `B20 Society #${tokenIdStr}`,
      description:
        "B20 Society NFT — self-evolving through 10 phases via $SOCIETY burns.",
      image: `${PUBLIC_DOMAIN}/images/nft/phase-${phase}.gif`,
      external_url: `${PUBLIC_DOMAIN}/nft/${tokenIdStr}`,
      attributes: [
        { trait_type: "Phase", value: phase },
        { trait_type: "Token ID", value: tokenIdStr },
      ],
    };

    return new Response(JSON.stringify(metadata, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=10",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
