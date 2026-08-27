// Health check endpoint
// Returns 200 OK with the current configuration status

export const config = {
  runtime: "edge",
};

export default async function handler(): Promise<Response> {
  const config = {
    status: "ok",
    timestamp: Date.now(),
    env: {
      V4_POOL_ID: mask(process.env.V4_POOL_ID),
      NFT_CONTRACT_ADDRESS: mask(process.env.NFT_CONTRACT_ADDRESS),
      SOCIETY_ADDRESS: mask(process.env.SOCIETY_ADDRESS),
    },
  };

  return new Response(JSON.stringify(config, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function mask(value: string | undefined): string {
  if (!value) return "<not set>";
  if (value.length < 12) return "<set>";
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}
