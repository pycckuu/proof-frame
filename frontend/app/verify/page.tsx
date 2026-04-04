"use client";

import { useState, useCallback } from "react";
import { computePixelHash } from "@/lib/imageHash";
import { publicClient, IMAGE_ATTESTOR_ADDRESS, IMAGE_ATTESTOR_ABI } from "@/lib/contracts";

type Attestation = {
  fileHash: string;
  merkleRoot: string;
  transformDesc: string;
  timestamp: bigint;
  disclosedDate: string;
  disclosedLocation: string;
  disclosedCameraMake: string;
  imageWidth: number;
  imageHeight: number;
};

type VerifyStatus = "idle" | "hashing" | "checking" | "verified" | "not_verified" | "error";

export default function VerifyPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pixelHash, setPixelHash] = useState<string | null>(null);
  const [status, setStatus] = useState<VerifyStatus>("idle");
  const [attestation, setAttestation] = useState<Attestation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(async (f: File) => {
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setStatus("hashing");
    setAttestation(null);
    setError(null);

    try {
      const hash = await computePixelHash(f);
      setPixelHash(hash);
      setStatus("idle");
    } catch (err) {
      setError("Failed to compute pixel hash");
      setStatus("error");
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      if (f && f.type.startsWith("image/")) handleFile(f);
    },
    [handleFile]
  );

  const handleVerify = async () => {
    if (!pixelHash) return;
    setStatus("checking");
    setError(null);

    try {
      const hashBytes = `0x${pixelHash}` as `0x${string}`;

      const verified = await publicClient.readContract({
        address: IMAGE_ATTESTOR_ADDRESS,
        abi: IMAGE_ATTESTOR_ABI,
        functionName: "isVerified",
        args: [hashBytes],
      });

      if (verified) {
        const result = await publicClient.readContract({
          address: IMAGE_ATTESTOR_ADDRESS,
          abi: IMAGE_ATTESTOR_ABI,
          functionName: "getAttestation",
          args: [hashBytes],
        });

        setAttestation({
          fileHash: result.fileHash,
          merkleRoot: result.merkleRoot,
          transformDesc: result.transformDesc,
          timestamp: result.timestamp,
          disclosedDate: result.disclosedDate,
          disclosedLocation: result.disclosedLocation,
          disclosedCameraMake: result.disclosedCameraMake,
          imageWidth: result.imageWidth,
          imageHeight: result.imageHeight,
        });
        setStatus("verified");
      } else {
        setStatus("not_verified");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification check failed");
      setStatus("error");
    }
  };

  return (
    <main className="min-h-screen p-8 max-w-3xl mx-auto">
      <h1 className="text-4xl font-bold mb-2">Verify Image</h1>
      <p className="text-gray-400 mb-8">
        Upload an image to check if it has been authenticated on-chain.
      </p>

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
          dragOver
            ? "border-blue-500 bg-blue-500/10"
            : "border-gray-700 hover:border-gray-500"
        }`}
      >
        {preview ? (
          <img
            src={preview}
            alt="Preview"
            className="max-h-64 mx-auto rounded-lg mb-4"
          />
        ) : (
          <p className="text-gray-500 mb-4">
            Drag and drop an image here, or click to select
          </p>
        )}
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
          className="hidden"
          id="file-upload"
        />
        <label
          htmlFor="file-upload"
          className="inline-block px-6 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg cursor-pointer transition-colors"
        >
          Choose File
        </label>
      </div>

      {/* Pixel hash display */}
      {pixelHash && (
        <div className="mt-6 p-4 bg-gray-900 rounded-xl border border-gray-800">
          <p className="text-sm text-gray-400 mb-1">Pixel Hash (SHA-256)</p>
          <p className="font-mono text-sm break-all text-gray-200">
            0x{pixelHash}
          </p>
        </div>
      )}

      {/* Verify button */}
      {pixelHash && status !== "hashing" && (
        <button
          onClick={handleVerify}
          disabled={status === "checking"}
          className="mt-6 w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors"
        >
          {status === "checking" ? "Checking..." : "Check Verification"}
        </button>
      )}

      {/* Status: Hashing */}
      {status === "hashing" && (
        <p className="mt-6 text-gray-400">Computing pixel hash...</p>
      )}

      {/* Status: Verified */}
      {status === "verified" && attestation && (
        <div className="mt-6 p-6 bg-green-950 border border-green-800 rounded-xl">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-3xl">&#x2713;</span>
            <span className="text-xl font-bold text-green-400">
              VERIFIED
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <Detail
              label="Dimensions"
              value={`${attestation.imageWidth} x ${attestation.imageHeight}`}
            />
            <Detail
              label="Attested"
              value={new Date(
                Number(attestation.timestamp) * 1000
              ).toLocaleString()}
            />
            {attestation.transformDesc && (
              <Detail label="Transforms" value={attestation.transformDesc} />
            )}
            {attestation.disclosedDate && (
              <Detail label="Date" value={attestation.disclosedDate} />
            )}
            {attestation.disclosedLocation && (
              <Detail label="Location" value={attestation.disclosedLocation} />
            )}
            {attestation.disclosedCameraMake && (
              <Detail
                label="Camera"
                value={attestation.disclosedCameraMake}
              />
            )}
            <Detail
              label="File Hash"
              value={attestation.fileHash}
              mono
            />
            <Detail
              label="Merkle Root"
              value={attestation.merkleRoot}
              mono
            />
          </div>
        </div>
      )}

      {/* Status: Not verified */}
      {status === "not_verified" && (
        <div className="mt-6 p-6 bg-red-950 border border-red-800 rounded-xl">
          <div className="flex items-center gap-3">
            <span className="text-3xl">&#x2717;</span>
            <span className="text-xl font-bold text-red-400">
              NOT VERIFIED
            </span>
          </div>
          <p className="mt-2 text-gray-400">
            No on-chain attestation found for this image.
          </p>
        </div>
      )}

      {/* Error */}
      {status === "error" && error && (
        <div className="mt-6 p-4 bg-red-950 border border-red-800 rounded-xl text-red-400">
          {error}
        </div>
      )}
    </main>
  );
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-gray-500 text-xs uppercase tracking-wide">{label}</p>
      <p
        className={`text-gray-200 break-all ${
          mono ? "font-mono text-xs" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
