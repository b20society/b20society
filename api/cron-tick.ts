// Cron-tick endpoint — called by Vercel Cron every minute.
//
// Fetches /pools/image with no-cache (so the 60s edge cache
// doesn't short-circuit us) and returns the resulting tier + market
// cap as JSON for observability.

export const config = {
  runtime: "edge",
};

export default async function handler(): Promise<Response> {
  const url = "https://b20society.com/pools/image";
  try {
    const res = await fetch(url, {
      // redirect: "manual" so we get the 302 itself (not the GIF
      // body) and can read the X-Pool-* headers.
      redirect: "manual",
      headers: { "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(10_000),
    });
    const location = res.headers.get("location") ?? "n/a";
    const tier = res.headers.get("x-pool-tier") ?? "n/a";
    const mc = res.headers.get("x-pool-marketcap") ?? "n/a";
    return new Response(
      JSON.stringify({
        ok: true,
        status: res.status,
        tier,
        marketcap: mc,
        location: location.slice(0, 80),
      }, null, 2),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
