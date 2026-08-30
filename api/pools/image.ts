// Pools.fun test image endpoint.
//
// 302-redirects to the Pinata-hosted GIF so the actual image
// storage is decoupled from b20society.com. Same URL as the
// `image` field in /pools/metadata so consumers see one canonical
// image source.

export const config = {
  runtime: "edge",
};

const IMAGE_URL =
  "https://lime-occupational-yak-490.mypinata.cloud/ipfs/bafkreihdwf6nucjp6rxkvqm62gvzbrpewy7lbhn2io6vknwgsnu6ecttrq";

export default function handler(): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: IMAGE_URL,
      "Cache-Control": "public, s-maxage=3600, max-age=3600",
    },
  });
}
