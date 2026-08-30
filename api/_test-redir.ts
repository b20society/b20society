export const config = { runtime: "edge" };
export default async function handler() {
  const r1 = await fetch("https://b20society.com/pools/image", { redirect: "manual" });
  const out1 = {
    mode: "manual",
    status: r1.status,
    type: r1.type,
    headers: Object.fromEntries(r1.headers.entries()),
  };
  return new Response(JSON.stringify(out1, null, 2));
}
