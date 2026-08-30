// Pools.fun test metadata endpoint.

export const config = {
  runtime: "edge",
};

const METADATA = {
  name: "TESTT",
  symbol: "TESTTT",
  attributes: [
    { trait_type: "launch_provider", value: "poolsfun" },
    { trait_type: "chain", value: "robinhood" },
  ],
  initial_deployer: {
    address: "0x5c71128e059c3dab0c15f565e87d14963b357abe",
  },
  initial_fee_recipient: {
    address: "0x5c71128e059c3dab0c15f565e87d14963b357abe",
  },
  image: "https://b20society.com/pools/image",
};

export default function handler(): Response {
  return new Response(JSON.stringify(METADATA, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, s-maxage=60, max-age=30",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
// last updated: Sun Aug 30 21:44:50 UTC 2026
