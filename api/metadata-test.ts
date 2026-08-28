// TEST endpoint — returns mock metadata for testing the frontend
// without needing real contracts deployed. URL: /api/metadata-test
//
// Supports query params for testing different scenarios:
//   ?tier=N     → returns image for tier N (0-90), default 45
//   ?mcap=N     → returns market cap of N USD, default 555555
//   ?nvda=N     → returns NVDA price of N USD, default = real Chainlink
//
// The real /api/metadata is unaffected. Wallets using the real
// contractURI (https://b20society.com/api/metadata) won't hit this.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { tierImageUrl } from "../lib/tier-images";
import { getNvdaPriceUsd } from "../lib/marketcap";

export const config = {
  runtime: "edge",
};

const PUBLIC_DOMAIN = "https://b20society.com";

export default async function handler(
  req: VercelRequest,
  _res: VercelResponse,
): Promise<Response> {
  const url = new URL(req.url ?? "/", PUBLIC_DOMAIN);
  // Default tier 0 = just launched (fresh state, no trading yet)
  const tier = Math.min(
    90,
    Math.max(0, Number(url.searchParams.get("tier") ?? 0)),
  );
  // Default mcap 0 (no liquidity yet)
  const mcap = Number(url.searchParams.get("mcap") ?? 0);

  // NVDA: use real Chainlink unless overridden
  let nvdaPriceUsd: number;
  const nvdaOverride = url.searchParams.get("nvda");
  if (nvdaOverride) {
    nvdaPriceUsd = Number(nvdaOverride);
  } else {
    try {
      const p = await getNvdaPriceUsd();
      nvdaPriceUsd = p.priceUsd;
    } catch {
      nvdaPriceUsd = 227; // fallback
    }
  }

  const progressPct = ((tier / 90) * 100).toFixed(1);

  return new Response(
    JSON.stringify(
      {
        name: "B20 Society",
        symbol: "SOCIETY",
        description: "[TEST] B20 Society — a self-evolving B20 token. Mock data for frontend testing.",
        image: tierImageUrl(tier, PUBLIC_DOMAIN),
        external_url: PUBLIC_DOMAIN,
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
