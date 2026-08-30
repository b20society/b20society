// Cron-tick endpoint — called by Vercel Cron every minute.
//
// Purpose: keep the /pools/image state in Vercel Edge Config fresh
// even when no real user is visiting the site. The function simply
// fires a request to /pools/image so that the SWIM/B20 market cap
// comparison runs and the previous-value gets updated.
//
// This is a thin pass-through: the cron just calls /pools/image
// and the heavy lifting happens there. We do it via fetch to the
// production URL so the cache, environment, and runtime are
// identical to what real users see.
//
// Vercel Cron sends GET with an Authorization header containing
// the deployment protection secret. We don't strictly need to
// validate it for internal cron, but it's good hygiene.

export const config = {
  runtime: "edge",
};

export default async function handler(): Promise<Response> {
  const url = "https://b20society.com/pools/image";
  try {
    // Use redirect: "manual" so we get the 302 response itself instead
    // of fetch following it to Pinata (which would give us the GIF
    // and lose the X-Pool-Tier / X-Pool-Marketcap headers).
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      // Bypass the 60s edge cache so the function actually runs
      // (cron should always see the latest MC, not a stale cache hit)
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
