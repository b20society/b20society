// Bankr test image endpoint.
//
// Returns the image bytes referenced by the `image` field in the static
// metadata JSON. Bankr pins the metadata JSON once at launch (frozen
// IPFS CID), but the `image` URL inside that JSON points here — so the
// rendered image can be swapped without re-pinning the metadata or
// redeploying the contract.
//
// Initial content: an inline SVG. Edit `svgFor()` below to change the
// rendered image. To serve binary content (PNG/GIF) instead, replace
// the body with `return new Response(bytes, ...)` and return raw bytes
// with the appropriate Content-Type.

export const config = {
  runtime: "edge",
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function svgFor(label: string, date: string): string {
  // 350x366 matches the testmeta GIF dimensions.
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 350 366" width="350" height="366">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0d1117"/>
      <stop offset="100%" stop-color="#1f6feb"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <text x="50%" y="48%" text-anchor="middle" dominant-baseline="middle"
        font-family="ui-monospace, monospace" font-size="42" font-weight="700"
        fill="#39d353">${escapeXml(label)}</text>
  <text x="50%" y="60%" text-anchor="middle" dominant-baseline="middle"
        font-family="ui-monospace, monospace" font-size="14"
        fill="#8b949e">${escapeXml(date)}</text>
  <text x="50%" y="92%" text-anchor="middle" dominant-baseline="middle"
        font-family="ui-monospace, monospace" font-size="10"
        fill="#6e7681">b20society.com / bankrtest / image</text>
</svg>`;
}

export default function handler(req: Request): Response {
  const url = new URL(req.url);
  // Optional overrides: ?label=foo&date=2026-01-01
  const label = url.searchParams.get("label") ?? "testmeta";
  const date = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);

  const body = svgFor(label, date);

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      // 30s edge cache, 10s browser cache — image can change often
      "Cache-Control": "public, s-maxage=30, max-age=10",
      "Access-Control-Allow-Origin": "*",
    },
  });
}