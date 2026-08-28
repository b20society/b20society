// TEST endpoint — health check for test mode
// URL: /api/healthtest

import type { VercelRequest, VercelResponse } from "@vercel/node";

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
        status: "ok",
        test: true,
        timestamp: Date.now(),
        note: "Test endpoint. Real /api/health reports actual env state.",
        env: {
          V4_POOL_ID: "0x4200000000000000000000000000000000B20P00",
          NFT_CONTRACT_ADDRESS: "0x4200000000000000000000000000000000B20NFT",
          SOCIETY_ADDRESS: "0x4200000000000000000000000000000000B20SOC",
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
