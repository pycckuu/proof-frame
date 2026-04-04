/**
 * Verify pixel hash consistency between browser (canvas) and ZK guest.
 *
 * The ZK guest computes: SHA-256(image.to_rgb8().into_raw())
 * The browser computes: SHA-256(canvas.getImageData() with alpha stripped)
 *
 * These MUST match for the verify page to work.
 *
 * Usage: bun run frontend/scripts/verify-pixel-hash.ts
 */

import { createCanvas, loadImage } from "canvas";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");
const CLEAN_PNG = resolve(PROJECT_ROOT, "test_images/ethglobal_cannes.clean.png");
const SIGNING_KEY = resolve(PROJECT_ROOT, "test_images/ethglobal_cannes.signing_key.json");

async function main() {
  console.log("Pixel Hash Consistency Verification");
  console.log("====================================\n");

  // 1. Load the expected pixel hash from the signing key JSON
  const keyData = JSON.parse(readFileSync(SIGNING_KEY, "utf-8"));
  const expectedHash = keyData.pixel_hash;
  console.log(`Expected (from Python/host): ${expectedHash}`);

  // 2. Method A: Canvas-based (mimics browser imageHash.ts)
  const img = await loadImage(CLEAN_PNG);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const rgba = imageData.data;

  // Extract RGB (skip alpha)
  const rgb = new Uint8Array(canvas.width * canvas.height * 3);
  let j = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    rgb[j++] = rgba[i];     // R
    rgb[j++] = rgba[i + 1]; // G
    rgb[j++] = rgba[i + 2]; // B
  }

  const canvasHash = createHash("sha256").update(rgb).digest("hex");
  console.log(`Canvas method (browser):    ${canvasHash}`);

  // 3. Method B: Direct PNG decode via canvas loadImage (reference)
  // This uses the same decode path as canvas but confirms dimensions
  console.log(`\nImage dimensions: ${img.width}x${img.height}`);
  console.log(`RGBA buffer size: ${rgba.length} bytes`);
  console.log(`RGB buffer size:  ${rgb.length} bytes`);
  console.log(`Expected RGB size: ${img.width * img.height * 3} bytes`);

  // 4. Compare
  console.log("\n--- Result ---");
  if (canvasHash === expectedHash) {
    console.log("MATCH! Browser pixel hash matches ZK guest pixel hash.");
    console.log("The verify page will correctly identify attested images.");
  } else {
    console.log("MISMATCH! Browser and ZK guest produce different pixel hashes.");
    console.log("The verify page will NOT work correctly.");
    console.log("\nDebugging info:");
    console.log(`  First 20 RGB bytes (canvas): ${Array.from(rgb.slice(0, 20)).join(",")}`);

    // Check if alpha values are all 255 (opaque)
    let nonOpaqueCount = 0;
    for (let i = 3; i < rgba.length; i += 4) {
      if (rgba[i] !== 255) nonOpaqueCount++;
    }
    console.log(`  Non-opaque pixels: ${nonOpaqueCount} (should be 0 for PNG without transparency)`);

    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
