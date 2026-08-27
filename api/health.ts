// Health check endpoint
// Returns 200 OK if the service is running

export const config = {
  runtime: "edge",
};

export default async function handler(): Promise<Response> {
  return new Response(
    JSON.stringify({ status: "ok", timestamp: Date.now() }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}
