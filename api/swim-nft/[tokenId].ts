// Backwards-compatibility shim.
//
// The SwimSinkNFT contract's older deployments return
// `https://b20society.com/api/swim-nft/{id}` as their tokenURI. New
// deployments point at `/api/nft/{id}` (the shared endpoint). To keep
// marketplaces that already indexed an older token happy, this shim
// 302-redirects /api/swim-nft/{id} → /api/nft/{id}.

export const config = {
  runtime: "edge",
};

const PUBLIC_DOMAIN = "https://b20society.com";

export default function handler(req: Request): Response {
  const url = new URL(req.url ?? "/", PUBLIC_DOMAIN);
  const match = url.pathname.match(/\/(?:api\/)?swim-nft\/(\d+)/);
  const id = match?.[1];
  if (!id) {
    return new Response(JSON.stringify({ error: "TokenId required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${PUBLIC_DOMAIN}/api/nft/${id}`,
      "Cache-Control": "public, s-maxage=3600, max-age=600",
    },
  });
}
