/**
 * Proof generation provider abstraction.
 *
 * PROVE_PROVIDER env var controls which backend is used:
 * - "local" (default): runs the pre-compiled host binary with RISC0_DEV_MODE=1
 * - "runpod": calls RunPod Serverless API for real Groth16 proofs (Phase 10)
 */

import { execFile } from "child_process";
import { writeFile, readFile, mkdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

export type ProveRequest = {
  image_base64: string;
  transform: string;
  disclosure: Record<string, unknown>;
  signing_key?: Record<string, unknown>;
};

export type ProveResult = {
  seal: string;
  journalDigest: string;
  pixelHash: string;
  fileHash: string;
  merkleRoot: string;
  transformDesc: string;
  disclosedDate: string;
  disclosedLocation: string;
  disclosedCameraMake: string;
  imageWidth: number;
  imageHeight: number;
};

export async function prove(req: ProveRequest): Promise<ProveResult> {
  const provider = process.env.PROVE_PROVIDER || "local";
  if (provider === "runpod") {
    return proveRunpod(req);
  }
  return proveLocal(req);
}

async function proveLocal(req: ProveRequest): Promise<ProveResult> {
  const workdir = join(tmpdir(), `proofframe-${Date.now()}`);
  await mkdir(workdir, { recursive: true });

  try {
    // Write image to temp file
    const imgPath = join(workdir, "input.png");
    await writeFile(imgPath, Buffer.from(req.image_base64, "base64"));

    // Write signing key if provided
    const keyArgs: string[] = [];
    if (req.signing_key) {
      const keyPath = join(workdir, "key.json");
      await writeFile(keyPath, JSON.stringify(req.signing_key));
      keyArgs.push("--key", keyPath);
    }

    // Build CLI args
    const args = [
      "--image", imgPath,
      "--transform", req.transform,
      "--disclosure", JSON.stringify(req.disclosure),
      "--output", workdir,
      ...keyArgs,
    ];

    // Run host binary
    const hostBin = process.env.PROOFFRAME_HOST_BIN || "proofframe-host";
    await new Promise<void>((resolve, reject) => {
      execFile(hostBin, args, {
        env: { ...process.env, RISC0_DEV_MODE: "1" },
        timeout: 60000,
        maxBuffer: 10 * 1024 * 1024,
      }, (err, _stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve();
      });
    });

    // Read receipt
    const receiptRaw = await readFile(join(workdir, "receipt.json"), "utf-8");
    const receipt = JSON.parse(receiptRaw);

    return {
      seal: `0x${receipt.receipt}`,
      journalDigest: `0x${receipt.journal_digest}`,
      pixelHash: `0x${receipt.pixel_hash}`,
      fileHash: `0x${receipt.file_hash}`,
      merkleRoot: `0x${receipt.merkle_root}`,
      transformDesc: receipt.transform_desc || "none",
      disclosedDate: receipt.disclosed_date || "",
      disclosedLocation: receipt.disclosed_location || "",
      disclosedCameraMake: receipt.disclosed_camera_make || "",
      imageWidth: receipt.image_width || 0,
      imageHeight: receipt.image_height || 0,
    };
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function proveRunpod(_req: ProveRequest): Promise<ProveResult> {
  // Phase 10: Replace with RunPod Serverless API call
  // Same interface — frontend code doesn't change
  throw new Error(
    "RunPod provider not implemented. Set PROVE_PROVIDER=local or omit it."
  );
}
