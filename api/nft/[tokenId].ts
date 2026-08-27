// NFT metadata endpoint
// Returns ERC-7572 metadata for a B20 Society NFT
// Image is dynamic based on the NFT's current phase (1-10)
//
// Phase is read from the on-chain B20SocietyNFT contract via
// phaseOf(tokenId) — the value is set by the contract when the
// holder burns $SOCIETY to advance the phase.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  createPublicClient,
  http,
  parseAbi,
  fallback,
} from "viem";
import { base } from "viem/chains";

export const config = {
  runtime: "edge",
};

const PUBLIC_DOMAIN = "https://b20society.com";

const NFT_ABI = parseAbi([
  "function phaseOf(uint256 tokenId) view returns (uint8)",
  "function ownerOf(uint256 tokenId) view returns (address)",
]);

const client = createPublicClient({
  chain: base,
  transport: fallback([
    http("https://base.drpc.org"),
    http("https://mainnet.base.org"),
  ]),
});

export default async function handler(
  req: VercelRequest,
  _res: VercelResponse,
): Promise<Response> {
  try {
    // TokenId from the dynamic route
    const url = new URL(req.url ?? "/", PUBLIC_DOMAIN);
    const match = url.pathname.match(/\/api\/nft\/(\d+)/);
    const tokenIdStr = match?.[1];

    if (!tokenIdStr) {
      return jsonError("TokenId required", 400);
    }

    const tokenId = BigInt(tokenIdStr);

    // Read phase from on-chain contract
    const nftContract = process.env.NFT_CONTRACT_ADDRESS as
      | `0x${string}`
      | undefined;

    let phase: number;
    if (nftContract) {
      try {
        const result = (await client.readContract({
          address: nftContract,
          abi: NFT_ABI,
          functionName: "phaseOf",
          args: [tokenId],
        })) as number;
        phase = result;
        if (phase < 1 || phase > 10) {
          // Out of bounds (e.g. un-minted tokenId). Default to phase 1.
          phase = 1;
        }
      } catch {
        // Contract call failed (e.g. token doesn't exist). Default to phase 1.
        phase = 1;
      }
    } else {
      // Stub mode if NFT_CONTRACT_ADDRESS is not set yet
      phase = 1;
    }

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
    return jsonError(message, 500);
  }
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
