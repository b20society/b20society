// NFT metadata endpoint (test path)
// Same logic as /api/nft/[tokenId] — reads NFT contract for exists() and phaseOf().
// The only difference is the URL path. Both endpoints are production-ready
// and can be used by any wallet or frontend.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  createPublicClient,
  http,
  parseAbi,
  fallback,
} from "viem";
import { base } from "viem/chains";
import { NFT_MAX_SUPPLY } from "../../lib/constants";

export const config = {
  runtime: "edge",
};

const PUBLIC_DOMAIN = "https://b20society.com";

const NFT_ABI = parseAbi([
  "function phaseOf(uint256 tokenId) view returns (uint8)",
  "function exists(uint256 tokenId) view returns (bool)",
]);

const client = createPublicClient({
  chain: base,
  transport: fallback([
    // Use BASE_RPC env var (Alchemy) if set, else fall back to public RPCs
    http(process.env.BASE_RPC ?? "https://base.drpc.org"),
    http("https://mainnet.base.org"),
  ]),
  batch: { multicall: true },
});

export default async function handler(
  req: VercelRequest,
  _res: VercelResponse,
): Promise<Response> {
  try {
    const url = new URL(req.url ?? "/", PUBLIC_DOMAIN);
    const match = url.pathname.match(/\/api\/nfttest\/(\d+)/);
    const tokenIdStr = match?.[1];

    if (!tokenIdStr) {
      return jsonError("TokenId required", 400);
    }

    const tokenId = BigInt(tokenIdStr);
    const tokenIdNum = Number(tokenId);

    if (tokenIdNum < 1 || tokenIdNum > NFT_MAX_SUPPLY) {
      return jsonError(
        `TokenId out of range (must be 1-${NFT_MAX_SUPPLY})`,
        404,
      );
    }

    const nftContract = process.env.NFT_CONTRACT_ADDRESS as
      | `0x${string}`
      | undefined;

    if (!nftContract) {
      return jsonError(
        `Token #${tokenIdStr} not minted (NFT contract not deployed)`,
        404,
      );
    }

    let phase = 1;
    try {
      const exists = (await client.readContract({
        address: nftContract,
        abi: NFT_ABI,
        functionName: "exists",
        args: [tokenId],
      })) as boolean;

      if (!exists) {
        return jsonError(`Token #${tokenIdStr} not minted yet`, 404);
      }

      phase = (await client.readContract({
        address: nftContract,
        abi: NFT_ABI,
        functionName: "phaseOf",
        args: [tokenId],
      })) as number;
      if (phase < 1 || phase > 10) phase = 1;
    } catch (err) {
      console.warn(`Failed to read phase for #${tokenIdStr}:`, err);
      return jsonError(`Token #${tokenIdStr} not found`, 404);
    }

    return new Response(
      JSON.stringify(
        {
          name: `B20 Society #${tokenIdStr}`,
          description:
            "B20 Society NFT — self-evolving through 10 phases via $SOCIETY burns.",
          image: phase === 1
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
          "Cache-Control": "public, s-maxage=60, max-age=30",
          "Access-Control-Allow-Origin": "*",
          "X-Test-Endpoint": "true",
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonError(message, 500);
  }
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Test-Endpoint": "true",
    },
  });
}
