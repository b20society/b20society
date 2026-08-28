// NFT metadata endpoint
// Returns ERC-721 metadata for a B20 Society NFT
// Image is dynamic based on the NFT's current phase (1-10)
//
// In live mode: reads phaseOf(tokenId) from the on-chain contract.
// In stub mode (no NFT_CONTRACT_ADDRESS): returns 404 for non-existent tokenIds.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  createPublicClient,
  http,
  parseAbi,
  fallback,
} from "viem";
import { base } from "viem/chains";
import { NFT_MAX_SUPPLY } from "../lib/constants";

export const config = {
  runtime: "edge",
};

const PUBLIC_DOMAIN = "https://b20society.com";

const NFT_ABI = parseAbi([
  "function phaseOf(uint256 tokenId) view returns (uint8)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function exists(uint256 tokenId) view returns (bool)",
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
    const url = new URL(req.url ?? "/", PUBLIC_DOMAIN);
    const match = url.pathname.match(/\/api\/nft\/(\d+)/);
    const tokenIdStr = match?.[1];

    if (!tokenIdStr) {
      return jsonError("TokenId required", 400);
    }

    const tokenId = BigInt(tokenIdStr);
    const tokenIdNum = Number(tokenId);

    // Validate tokenId range (NFTs are 1..MAX_SUPPLY)
    if (tokenIdNum < 1 || tokenIdNum > NFT_MAX_SUPPLY) {
      return jsonError(
        `TokenId out of range (must be 1-${NFT_MAX_SUPPLY})`,
        404,
      );
    }

    // Read phase from on-chain contract
    const nftContract = process.env.NFT_CONTRACT_ADDRESS as
      | `0x${string}`
      | undefined;

    let phase: number;
    if (nftContract) {
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

        const result = (await client.readContract({
          address: nftContract,
          abi: NFT_ABI,
          functionName: "phaseOf",
          args: [tokenId],
        })) as number;
        phase = result;
        if (phase < 1 || phase > 10) {
          phase = 1;
        }
      } catch (err) {
        console.warn(`Failed to read phase for #${tokenIdStr}:`, err);
        return jsonError(`Token #${tokenIdStr} not found`, 404);
      }
    } else {
      // Stub mode: all valid tokenIds default to phase 1
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
        { trait_type: "Max Supply", value: NFT_MAX_SUPPLY.toString() },
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
