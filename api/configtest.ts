// TEST endpoint — returns mock public config for testing
// URL: /api/configtest

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { NFT_MINT_PRICE_WEI, NFT_MAX_SUPPLY, NFT_MAX_PER_WALLET, NFT_PHASE_COUNT } from "../lib/constants";

export const config = {
  runtime: "edge",
};

export default async function handler(
  _req: VercelRequest,
  _res: VercelResponse,
): Promise<Response> {
  return new Response(
    JSON.stringify(
      {
        chainId: 8453,
        chainName: "base",
        test: true,
        note: "This is a TEST endpoint. The real /api/config returns null addresses when env vars are unset. This endpoint returns mock addresses for frontend testing.",
        nft: {
          contractAddress: "0x4200000000000000000000000000000000B20NFT" as `0x${string}`,
          maxSupply: NFT_MAX_SUPPLY,
          mintPriceWei: NFT_MINT_PRICE_WEI.toString(),
          mintPriceEth: "0.001",
          maxPerWallet: NFT_MAX_PER_WALLET,
          phaseCount: NFT_PHASE_COUNT,
          deployed: true, // mock
        },
        token: {
          societyAddress: "0x4200000000000000000000000000000000B20SOC" as `0x${string}`,
          v4PoolId: "0x4200000000000000000000000000000000B20P00" as `0x${string}`,
          deployed: true, // mock
        },
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
