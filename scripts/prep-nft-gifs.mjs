#!/usr/bin/env node
/**
 * NFT GIF preparation script.
 *
 * Takes 10 NFT phase GIFs (any name, any order) and renames them to
 * phase-1.gif through phase-10.gif in public/images/nft/.
 *
 * Usage:
 *   node scripts/prep-nft-gifs.mjs <input-dir> [--dry-run]
 *
 * Input:
 *   Directory with 10 .gif files (any names)
 *   Files sorted alphabetically: phase 1 -> file 1, phase 2 -> file 2, etc.
 *
 * Output:
 *   - public/images/nft/phase-1.gif
 *   - public/images/nft/phase-2.gif
 *   - ...
 *   - public/images/nft/phase-10.gif
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

const PHASE_COUNT = 10;
const NFT_IMAGES_DIR = path.join(
  PROJECT_ROOT,
  "public",
  "images",
  "nft"
);

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { inputDir: null, dryRun: false };
  for (const arg of args) {
    if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (!opts.inputDir) {
      opts.inputDir = arg;
    }
  }
  return opts;
}

function isGif(name) {
  return path.extname(name).toLowerCase() === ".gif";
}

async function main() {
  const opts = parseArgs();

  if (!opts.inputDir) {
    console.error(
      "Usage: node scripts/prep-nft-gifs.mjs <input-dir> [--dry-run]"
    );
    console.error("Example: node scripts/prep-nft-gifs.mjs ./nft-gifs");
    process.exit(1);
  }

  const inputDir = path.resolve(opts.inputDir);
  console.log(`Input directory: ${inputDir}`);
  console.log(`Dry run: ${opts.dryRun ? "YES" : "no"}`);

  let entries;
  try {
    entries = await fs.readdir(inputDir);
  } catch (err) {
    console.error(`Cannot read input dir: ${err.message}`);
    process.exit(1);
  }
  const gifFiles = entries.filter(isGif).sort();

  if (gifFiles.length !== PHASE_COUNT) {
    console.error(
      `Expected ${PHASE_COUNT} GIFs, found ${gifFiles.length}`
    );
    process.exit(1);
  }
  console.log(`Found ${gifFiles.length} GIF files (sorted).`);

  console.log("\n=== Plan ===");
  for (let phase = 1; phase <= PHASE_COUNT; phase++) {
    const src = path.join(inputDir, gifFiles[phase - 1]);
    const dst = path.join(NFT_IMAGES_DIR, `phase-${phase}.gif`);
    if (phase <= 3 || phase === PHASE_COUNT) {
      console.log(`  phase ${phase}: ${gifFiles[phase - 1]} -> phase-${phase}.gif`);
    } else if (phase === 4) {
      console.log(`  ... (${PHASE_COUNT - 4} more) ...`);
    }
  }

  if (opts.dryRun) {
    console.log("\n[dry-run] no files written.");
    return;
  }

  await fs.mkdir(NFT_IMAGES_DIR, { recursive: true });

  console.log("\nCopying files...");
  for (let phase = 1; phase <= PHASE_COUNT; phase++) {
    const src = path.join(inputDir, gifFiles[phase - 1]);
    const dst = path.join(NFT_IMAGES_DIR, `phase-${phase}.gif`);
    await fs.copyFile(src, dst);
  }
  console.log(`Copied ${PHASE_COUNT} GIFs to ${NFT_IMAGES_DIR}`);

  console.log("\n=== Done ===");
  console.log(`Next steps:`);
  console.log(`  1. Verify GIFs in public/images/nft/`);
  console.log(`  2. git add public/images/nft/`);
  console.log(`  3. git commit -m "Add 10 NFT phase GIFs"`);
  console.log(`  4. git push origin main`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
