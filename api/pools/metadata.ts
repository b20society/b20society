// Pools.fun test metadata endpoint.

import type { VercelRequest, VercelResponse } from "@vercel/node";

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

export default function handler(
  _req: VercelRequest,
  res: VercelResponse,
): void {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "public, s-maxage=60, max-age=30");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(200).send(JSON.stringify(METADATA, null, 2));
}
