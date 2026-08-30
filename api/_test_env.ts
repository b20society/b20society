export const config = { runtime: "edge" };
export default function handler(): Response {
  return new Response(JSON.stringify({
    EDGE_CONFIG: process.env.EDGE_CONFIG || "MISSING",
    B20_VERCEL_PAT_PRESENT: !!process.env.B20_VERCEL_PAT,
    B20_VERCEL_PAT_LENGTH: process.env.B20_VERCEL_PAT?.length || 0,
  }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
