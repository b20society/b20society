// Public configuration endpoint
// Returns contract addresses and chain info that the frontend needs.
// Safe to expose — no secrets, only public on-chain addresses.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { CHAIN_ID, NFT_MAX_SUPPLY, NFT_MINT_PRICE_WEI, NFT_MAX_PER_WALLET, NFT_PHASE_COUNT } from "../lib/constants";

export const config = {
  runtime: "edge",
  // No caching — addresses may change after launch
};

export default async function handler(
  _req: VercelRequest,
  _res: VercelResponse,
): Promise<Response> {
  const nftContractAddress = process.env.NFT_CONTRACT_ADDRESS as
    | `0x${string}`
    | undefined;
  const societyTokenAddress = process.env.SOCIETY_ADDRESS as
    | `0x${string}`
    | undefined;
  const v4PoolId = process.env.V4_POOL_ID as `0x${string}` | undefined;

  return new Response(
    JSON.stringify(
      {
        chainId: CHAIN_ID,
        chainName: "base",
        nft: {
          contractAddress: nftContractAddress ?? null,
          maxSupply: NFT_MAX_SUPPLY,
          mintPriceWei: NFT_MINT_PRICE_WEI.toString(),
          mintPriceEth: "0.001",
          maxPerWallet: NFT_MAX_PER_WALLET,
          phaseCount: NFT_PHASE_COUNT,
          deployed: Boolean(nftContractAddress),
        },
        token: {
          societyAddress: societyTokenAddress ?? null,
          v4PoolId: v4PoolId ?? null,
          deployed: Boolean(societyTokenAddress),
        },
      },
      null,
      2,
    ),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
