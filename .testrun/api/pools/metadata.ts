// SWIM/SINK token metadata endpoint.
//
// This serves the public metadata for the SWIM/SINK token launched
// on Pons v2 (ponsfamily.com) on Robinhood Chain. Pons tokens are
// self-describing on-chain (logo(), description(), socials() are
// read directly from the token contract), so this endpoint is a
// secondary, off-chain reference used by:
//   - Direct consumers (link previews, link unfurls)
//   - Indexers that don't yet have the token indexed
//   - Our own UI / dashboards
//
// The image field points to /pools/image, which 302-redirects to
// one of 3 local GIFs (swim/sink/rocket) based on the SWIM market
// cap direction. This gives us a dynamic image that tracks
// real-time price action without re-deploying the token.

export const config = {
  runtime: "edge",
};

const METADATA = {
  name: "Swim/Sink",
  symbol: "SWIM/SINK",
  description:
    "what if your token's image changed by itself? not animation. not random. actually watching the market. when it pumps when it dumps when it's chill. no buttons. no refresh. the art just reacts.",
  image: "https://b20society.com/pools/image",
  external_url: "https://platypus.community",
  attributes: [
    { trait_type: "launch_provider", value: "pons" },
    { trait_type: "launch_version", value: "v2" },
    { trait_type: "launcher", value: "ponsfamily.com" },
    { trait_type: "chain", value: "robinhood" },
    { trait_type: "chain_id", value: 4663 },
    { trait_type: "factory", value: "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e" },
    { trait_type: "token", value: "0x512c40dd3a94a89126646e30b9b143f408823ee9" },
    { trait_type: "bonding_curve", value: "0x5fcdf31b376f11f7aefd1d55aa520a1923f04093" },
    { trait_type: "fee_escrow", value: "0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e" },
    { trait_type: "quote_token", value: "native ETH" },
    { trait_type: "weth", value: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" },
    { trait_type: "curve_fee_bps", value: 100 },
    { trait_type: "creator_tax_bps", value: 100 },
    { trait_type: "buyback_enabled", value: false },
    { trait_type: "supply", value: "1000000000" },
    { trait_type: "creator_fee_split", value: "70/30 (creator/protocol of base fee) + 100% creator tax" },
    { trait_type: "launch_fee_eth", value: 0.0005 },
    { trait_type: "network", value: "Robinhood Chain" },
  ],
  socials: {
    twitter: "",
    telegram: "",
    discord: "",
    website: "https://platypus.community",
    farcaster: "",
  },
  initial_deployer: {
    address: "0x5c71128e059c3dab0c15f565e87d14963b357abe",
  },
  initial_fee_recipient: {
    address: "0x5c71128e059c3dab0c15f565e87d14963b357abe",
  },
  creator_fee_recipient: "0x5c71128e059c3dab0c15f565e87d14963b357abe",
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
