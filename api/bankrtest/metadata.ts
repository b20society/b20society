// Bankr test metadata endpoint.
//
// Returns a fixed JSON payload used to validate a downstream consumer
// (e.g. Bankr's launch pipeline, an external metadata resolver) against
// the shape they expect.
//
// The user can change this body in-place without redeploying the
// rest of the site — only this function's bundle changes.

import type { VercelRequest, VercelResponse } from "@vercel/node";

const METADATA = {
  name: "testmeta",
  symbol: "testmeta",
  attributes: [
    { trait_type: "launch_provider", value: "bankr" },
    { trait_type: "chain", value: "base" },
  ],
  description: "bebek ijo brengsek",
  image: "ipfs://bafkreifpl3nlbhtfwe5g56oboltkeyjkyujdztcwvyrx5dnntalihplmiy",
  tweet_url: "https://x.com/",
  initial_deployer: {
    address: "0xF83BEeACB1b1Fd9a28106617E39302E3bbE5C5Fd",
    x_username: "mattrenggana",
  },
  initial_fee_recipient: {
    address: "0x5c71128e059c3dab0c15f565e87d14963b357abe",
    x_username: "bebekijobrengsek",
  },
};

export default function handler(
  _req: VercelRequest,
  res: VercelResponse,
) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader(
    "Cache-Control",
    "public, s-maxage=60, max-age=30",
  );
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(200).json(METADATA);
}
