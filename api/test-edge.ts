export const config = { runtime: "edge" };

export default function handler() {
  // List ALL process.env keys (values redacted for security)
  const envKeys = Object.keys(process.env);
  const env = {};
  for (const k of envKeys) {
    if (k.includes("VERCEL") || k.includes("B20") || k.includes("EDGE") || k.includes("PAT")) {
      env[k] = process.env[k] ? `<set: ${process.env[k].length} chars>` : "empty";
    }
  }
  return new Response(JSON.stringify({
    allKeys: envKeys,
    relevantEnv: env,
    direct_B20_VERCEL_PAT: process.env.B20_VERCEL_PAT ? "SET" : "UNDEFINED",
    direct_VERCEL_PAT: process.env.VERCEL_PAT ? "SET" : "UNDEFINED",
  }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
