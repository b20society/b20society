import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

export const config = {
  runtime: "nodejs",
};

export default function handler(
  _req: VercelRequest,
  res: VercelResponse,
): void {
  const cwd = process.cwd();
  const tries = [
    join(cwd, "public", "images", "pools", "swim.gif"),
    join(cwd, "images", "pools", "swim.gif"),
    join(cwd, "..", "public", "images", "pools", "swim.gif"),
  ];
  const lines: string[] = [`cwd: ${cwd}`];
  for (const p of tries) {
    lines.push(`exists ${p}: ${existsSync(p)}`);
  }
  res.setHeader("Content-Type", "text/plain");
  res.status(200).send(lines.join("\n"));
}
