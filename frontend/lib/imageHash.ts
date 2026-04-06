/**
 * Computes the SHA-256 hash of an image's RGB pixel data.
 *
 * This extracts only RGB channels (skipping alpha) to match the guest program's
 * pixel hashing. Canvas getImageData() returns RGBA — we must strip the alpha byte.
 */
export async function computePixelHash(file: File): Promise<string> {
  const blob = new Blob([await file.arrayBuffer()]);
  // Disable color space conversion to match Rust image crate's raw decode
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: "none" });

  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  // Use srgb color space to prevent browser color management
  const ctx = canvas.getContext("2d", { colorSpace: "srgb" })!;
  ctx.drawImage(bitmap, 0, 0);

  // Get RGBA pixels from canvas
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const rgba = imageData.data;

  // Extract RGB only (skip alpha byte every 4th position)
  const rgb = new Uint8Array(canvas.width * canvas.height * 3);
  let j = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    rgb[j++] = rgba[i]; // R
    rgb[j++] = rgba[i + 1]; // G
    rgb[j++] = rgba[i + 2]; // B
  }

  // SHA-256 hash
  const hashBuffer = await crypto.subtle.digest("SHA-256", rgb);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
