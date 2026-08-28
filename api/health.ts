// Health check endpoint
// Returns 200 OK with the current configuration status
// Note: env var values are FULL (not masked) so deploy/debug tools see real values.

export const config = {
  runtime: "edge",
};

export default async function handler(): Promise<Response> {
  const config = {
    status: "ok",
    timestamp: Date.now(),
    env: {
      V4_POOL_ID: process.env.V4_POOL_ID ?? null,
      NFT_CONTRACT_ADDRESS: process.env.NFT_CONTRACT_ADDRESS ?? null,
      SOCIETY_ADDRESS: process.env.SOCIETY_ADDRESS ?? null,
    },
  };

  return new Response(JSON.stringify(config, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
