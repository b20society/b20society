// Pools.fun test image endpoint.
//
// 302-redirects to the static duck PNG. Static file path keeps the
// function bundle small (< 1KB) and bypasses Vercel edge function
// size limits that base64-inline approach would hit with this image.

export const config = {
  runtime: "edge",
};

const IMAGE_URL = "https://b20society.com/images/pools-token.png";

export default function handler(): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: IMAGE_URL,
      "Cache-Control": "public, s-maxage=3600, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
