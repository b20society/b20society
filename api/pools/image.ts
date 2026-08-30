import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = {
  runtime: "nodejs",
};

export default function handler(
  _req: VercelRequest,
  res: VercelResponse,
): void {
  res.setHeader("Content-Type", "text/plain");
  res.status(200).send("hello from /pools/image, cwd=" + process.cwd());
}
