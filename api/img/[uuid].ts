// Image serving endpoint.
//
// Maps a random UUID to a tier/phase image file, so the API metadata
// can expose unguessable image URLs. Without this, users could preview
// the next tier by guessing /images/Soc{N}.jpg etc.
//
// Routing:
//   /api/img/{tier_uuid}    -> /public/images/Soc{N}.jpg
//   /api/img/{phase_uuid}   -> /public/images/nft/phase-N.gif
//
// Uses Vercel's Node.js runtime (not Edge) because Edge runtime can't
// access the filesystem. Node.js runtime supports fs.readFile.
//
// Edge cache: 1 day (immutable content; tier/phase UUIDs are stable)

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { uuidToTier, uuidToPhase } from "../../lib/uuid-map";

export const config = {
  runtime: "nodejs",
};

const PUBLIC_DIR = join(process.cwd(), "public");

export default async function handler(
  req: VercelRequest,
  _res: VercelResponse,
): Promise<Response> {
  try {
    const url = new URL(req.url ?? "/", "https://b20society.com");
    const match = url.pathname.match(/\/api\/img\/([0-9a-f-]{36})/i);
    const uuid = match?.[1];

    if (!uuid) {
      return jsonError("Invalid UUID", 400);
    }

    // Check if this is a tier UUID
    const tier = uuidToTier(uuid);
    if (tier !== null) {
      const filePath = join(PUBLIC_DIR, "images", `Soc${tier}.jpg`);
      const bytes = await readFile(filePath);
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "public, s-maxage=86400, max-age=86400, immutable",
        },
      });
    }

    // Check if this is a phase UUID
    const phase = uuidToPhase(uuid);
    if (phase !== null) {
      // Phase 1 uses static JPG (Soc1.jpg), phases 2-10 use animated GIFs
      if (phase === 1) {
        const filePath = join(PUBLIC_DIR, "images", "Soc1.jpg");
        const bytes = await readFile(filePath);
        return new Response(bytes, {
          status: 200,
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "public, s-maxage=86400, max-age=86400, immutable",
          },
        });
      }
      const filePath = join(PUBLIC_DIR, "images", "nft", `phase-${phase}.gif`);
      const bytes = await readFile(filePath);
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": "image/gif",
          "Cache-Control": "public, s-maxage=86400, max-age=86400, immutable",
        },
      });
    }

    return jsonError("Unknown UUID", 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonError(message, 500);
  }
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
