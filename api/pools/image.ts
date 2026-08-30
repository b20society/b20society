// Pools.fun test image endpoint.
//
// Simple 302 redirect to the static duck PNG. The /pools/metadata
// JSON's image field points to a separate Pinata URL, so this
// endpoint is here for backward compat / direct linking.

export const config = {
  runtime: "edge",
};

const IMAGE_URL = "https://b20society.com/images/pools/duck-low.png";

export default function handler(): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: IMAGE_URL,
      "Cache-Control": "public, s-maxage=3600, max-age=3600",
    },
  });
}
