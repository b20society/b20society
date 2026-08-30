// Bankr test metadata endpoint.
//
// Returns a fixed JSON payload used to validate a downstream consumer
// (e.g. Bankr's launch pipeline, an external metadata resolver) against
// the shape they expect.

export const config = {
  runtime: "edge",
};

const METADATA = {
  name: "testmeta",
  symbol: "testmeta",
  attributes: [
    { trait_type: "launch_provider", value: "bankr" },
    { trait_type: "chain", value: "base" },
  ],
  description: "bebek ijo brengsek",
  tweet_url: "https://x.com/",
  initial_deployer: {
    address: "0xf83b814fae4e1f79982549a07763c1473475c5fd",
    x_username: "mattrenggana",
  },
  initial_fee_recipient: {
    address: "0x5c71128e059c3dab0c15f565e87d14963b357abe",
  },
};

export default function handler(): Response {
  return new Response(JSON.stringify(METADATA, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // 60s edge cache, 30s browser cache — small payload, rarely changes
      "Cache-Control": "public, s-maxage=60, max-age=30",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
