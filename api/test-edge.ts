export const config = { runtime: "edge" };

const EDGE_ID = process.env.EDGE_CONFIG;
const PAT = process.env.B20_VERCEL_PAT;

export default async function handler() {
  let writeResult = "not attempted";
  if (EDGE_ID && PAT) {
    try {
      const r = await fetch(`https://api.vercel.com/v1/edge-config/${EDGE_ID}/items`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${PAT}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items: [
            { operation: "upsert", key: "test", value: "hello" + Date.now() },
          ],
        }),
        signal: AbortSignal.timeout(3000),
      });
      writeResult = "status: " + r.status;
    } catch (e) {
      writeResult = "error: " + String(e);
    }
  } else {
    writeResult = "missing env";
  }

  let readResult = "not attempted";
  if (EDGE_ID && PAT) {
    try {
      const r = await fetch(`https://api.vercel.com/v1/edge-config/${EDGE_ID}/item/test`, {
        headers: { Authorization: `Bearer ${PAT}` },
        signal: AbortSignal.timeout(3000),
      });
      const data = await r.json();
      readResult = JSON.stringify(data);
    } catch (e) {
      readResult = "error: " + String(e);
    }
  }

  return new Response(JSON.stringify({
    EDGE_ID_present: !!EDGE_ID,
    PAT_present: !!PAT,
    writeResult,
    readResult,
  }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
