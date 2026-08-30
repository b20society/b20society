// Cron-tick endpoint — called by Vercel Cron every 15s.
//
// Fetches /pools/image with no-cache (so 15s edge cache doesn't
// short-circuit us) and returns the resulting tier + market cap
// as JSON for observability.

import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(
  _req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  try {
    const r = await fetch("https://b20society.com/pools/image", {
      headers: { "Cache-Control": "no-cache" },
      redirect: "manual",
    });
    res.setHeader("Content-Type", "application/json");
    res.status(200).json({
      ok: r.ok,
      status: r.status,
      tier: r.headers.get("x-pool-tier") ?? "n/a",
      marketcap: r.headers.get("x-pool-marketcap") ?? "n/a",
      location: (r.headers.get("location") ?? "n/a").slice(0, 80),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
}
