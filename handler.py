"""
ProofFrame — RunPod Serverless Handler

Receives an image + config, runs the RISC Zero host prover, returns receipt JSON.

Input:
  {
    "input": {
      "image_base64": "base64-encoded PNG bytes",
      "key_json": "optional base64-encoded signing key JSON",
      "transform": "{\"None\": null}",
      "disclosure": "{\"reveal_date\":true,...}"
    }
  }

Output:
  {
    "seal": "0x...",
    "journalDigest": "0x...",
    "pixelHash": "0x...",
    "fileHash": "0x...",
    "merkleRoot": "0x...",
    "transformDesc": "...",
    "disclosedDate": "...",
    "disclosedLocation": "...",
    "disclosedCameraMake": "...",
    "imageWidth": N,
    "imageHeight": N
  }
"""

import base64
import json
import os
import subprocess
import tempfile

import runpod

# Log proving mode on startup
dev_mode = os.environ.get("RISC0_DEV_MODE", "0")
print(f"[INFO] ProofFrame prover starting. RISC0_DEV_MODE={dev_mode}", flush=True)


def handler(event):
    """RunPod serverless handler — generates a ZK proof for an image."""
    try:
        inp = event.get("input", {})

        # Decode image from base64
        image_b64 = inp.get("image_base64")
        if not image_b64:
            return {"error": "Missing image_base64 in input"}

        image_bytes = base64.b64decode(image_b64)

        # Validate PNG magic bytes
        if not image_bytes[:8] == b'\x89PNG\r\n\x1a\n':
            return {"error": "Invalid image: not a PNG file"}

        with tempfile.TemporaryDirectory() as tmpdir:
            # Write image to temp file
            image_path = os.path.join(tmpdir, "input.png")
            with open(image_path, "wb") as f:
                f.write(image_bytes)

            # Write signing key if provided
            key_args = []
            if inp.get("key_json"):
                key_path = os.path.join(tmpdir, "key.json")
                key_bytes = base64.b64decode(inp["key_json"])
                with open(key_path, "wb") as f:
                    f.write(key_bytes)
                key_args = ["--key", key_path]

            output_dir = os.path.join(tmpdir, "output")

            # Build command
            cmd = [
                "/app/proofframe-host",
                "--image", image_path,
                "--transform", inp.get("transform", '"None"'),
                "--disclosure", inp.get("disclosure", '{"reveal_date":false,"reveal_location":false,"reveal_camera_make":false,"location_precision":"Hidden"}'),
                "--output", output_dir,
            ] + key_args

            # Run prover
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=600,  # 10 min max
            )

            if result.returncode != 0:
                # Log full output server-side for debugging
                if result.stderr:
                    print(f"[STDERR] {result.stderr[-2000:]}", flush=True)
                if result.stdout:
                    print(f"[STDOUT] {result.stdout[-1000:]}", flush=True)
                return {
                    "error": f"Prover failed (exit {result.returncode})",
                }

            # Read receipt JSON
            receipt_path = os.path.join(output_dir, "receipt.json")
            if not os.path.exists(receipt_path):
                return {"error": "Prover did not produce receipt.json"}

            with open(receipt_path, "r") as f:
                receipt = json.load(f)

            return receipt

    except subprocess.TimeoutExpired:
        return {"error": "Prover timed out after 10 minutes"}
    except Exception as e:
        return {"error": str(e)}


# Start RunPod serverless worker
runpod.serverless.start({"handler": handler})
