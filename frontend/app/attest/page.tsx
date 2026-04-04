"use client";

import { useState, useCallback } from "react";
import { computePixelHash } from "@/lib/imageHash";

type Receipt = {
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

type SubmitStatus = "idle" | "submitting" | "confirmed" | "error";

export default function AttestPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pixelHash, setPixelHash] = useState<string | null>(null);

  // Transform controls
  const [cropX, setCropX] = useState(0);
  const [cropY, setCropY] = useState(0);
  const [cropW, setCropW] = useState(0);
  const [cropH, setCropH] = useState(0);
  const [grayscale, setGrayscale] = useState(false);
  const [brightness, setBrightness] = useState(0);

  // Disclosure policy
  const [revealDate, setRevealDate] = useState(false);
  const [revealLocation, setRevealLocation] = useState(false);
  const [revealCamera, setRevealCamera] = useState(false);
  const [locationPrecision, setLocationPrecision] = useState("hidden");

  // Receipt
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  // Submission
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleImageFile = useCallback(async (f: File) => {
    setFile(f);
    setPreview(URL.createObjectURL(f));
    try {
      const hash = await computePixelHash(f);
      setPixelHash(hash);
    } catch {
      setPixelHash(null);
    }
  }, []);

  const handleReceiptUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string);
          setReceipt(data);
        } catch {
          setError("Invalid receipt JSON");
        }
      };
      reader.readAsText(f);
    },
    []
  );

  const handleSubmit = async () => {
    if (!receipt) {
      setError("Please upload a receipt JSON from the host CLI");
      return;
    }
    setStatus("submitting");
    setError(null);

    try {
      const res = await fetch("/api/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(receipt),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Relay failed: ${res.status}`);
      }

      const data = await res.json();
      setTxHash(data.txHash);
      setStatus("confirmed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
      setStatus("error");
    }
  };

  return (
    <main className="min-h-screen p-8 max-w-3xl mx-auto">
      <h1 className="text-4xl font-bold mb-2">Attest Image</h1>
      <p className="text-gray-400 mb-8">
        Upload your image and ZK proof receipt to submit an on-chain attestation.
      </p>

      {/* Image upload */}
      <Section title="Image">
        <div className="border-2 border-dashed border-gray-700 rounded-xl p-8 text-center">
          {preview ? (
            <img
              src={preview}
              alt="Preview"
              className="max-h-48 mx-auto rounded-lg mb-4"
            />
          ) : (
            <p className="text-gray-500 mb-4">Upload your image</p>
          )}
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImageFile(f);
            }}
            className="hidden"
            id="image-upload"
          />
          <label
            htmlFor="image-upload"
            className="inline-block px-6 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg cursor-pointer transition-colors"
          >
            Choose Image
          </label>
          {pixelHash && (
            <p className="mt-3 font-mono text-xs text-gray-500 break-all">
              Pixel hash: 0x{pixelHash}
            </p>
          )}
        </div>
      </Section>

      {/* Transform controls */}
      <Section title="Transforms">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
          <NumberInput label="Crop X" value={cropX} onChange={setCropX} />
          <NumberInput label="Crop Y" value={cropY} onChange={setCropY} />
          <NumberInput label="Width" value={cropW} onChange={setCropW} />
          <NumberInput label="Height" value={cropH} onChange={setCropH} />
        </div>
        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={grayscale}
              onChange={(e) => setGrayscale(e.target.checked)}
              className="w-4 h-4 accent-blue-500"
            />
            <span className="text-sm">Grayscale</span>
          </label>
          <div className="flex-1">
            <label className="text-sm text-gray-400">
              Brightness: {brightness}
            </label>
            <input
              type="range"
              min={-100}
              max={100}
              value={brightness}
              onChange={(e) => setBrightness(Number(e.target.value))}
              className="w-full accent-blue-500"
            />
          </div>
        </div>
      </Section>

      {/* Disclosure policy */}
      <Section title="Disclosure Policy">
        <div className="space-y-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={revealDate}
              onChange={(e) => setRevealDate(e.target.checked)}
              className="w-4 h-4 accent-blue-500"
            />
            <span className="text-sm">Reveal Date</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={revealLocation}
              onChange={(e) => setRevealLocation(e.target.checked)}
              className="w-4 h-4 accent-blue-500"
            />
            <span className="text-sm">Reveal Location</span>
          </label>
          {revealLocation && (
            <select
              value={locationPrecision}
              onChange={(e) => setLocationPrecision(e.target.value)}
              className="ml-6 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm"
            >
              <option value="exact">Exact</option>
              <option value="city">City</option>
              <option value="country">Country</option>
            </select>
          )}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={revealCamera}
              onChange={(e) => setRevealCamera(e.target.checked)}
              className="w-4 h-4 accent-blue-500"
            />
            <span className="text-sm">Reveal Camera Make</span>
          </label>
        </div>
      </Section>

      {/* Receipt upload */}
      <Section title="Receipt (from host CLI)">
        <input
          type="file"
          accept=".json"
          onChange={handleReceiptUpload}
          className="hidden"
          id="receipt-upload"
        />
        <label
          htmlFor="receipt-upload"
          className="inline-block px-6 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg cursor-pointer transition-colors"
        >
          Upload Receipt JSON
        </label>
        {receipt && (
          <div className="mt-4 p-4 bg-gray-900 rounded-lg border border-gray-800 text-sm">
            <p className="text-green-400 mb-2">Receipt loaded</p>
            <div className="space-y-1 text-gray-400 font-mono text-xs">
              <p>pixelHash: {receipt.pixelHash}</p>
              <p>fileHash: {receipt.fileHash}</p>
              <p>transforms: {receipt.transformDesc || "none"}</p>
              <p>
                dimensions: {receipt.imageWidth} x {receipt.imageHeight}
              </p>
            </div>
          </div>
        )}
      </Section>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={!receipt || status === "submitting"}
        className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors mt-8"
      >
        {status === "submitting"
          ? "Submitting to Relay..."
          : "Submit Attestation"}
      </button>

      {/* Status */}
      {status === "confirmed" && txHash && (
        <div className="mt-6 p-4 bg-green-950 border border-green-800 rounded-xl">
          <p className="text-green-400 font-semibold mb-1">
            Attestation Submitted
          </p>
          <a
            href={`https://sepolia.etherscan.io/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-sm text-blue-400 hover:underline break-all"
          >
            {txHash}
          </a>
        </div>
      )}
      {status === "error" && error && (
        <div className="mt-6 p-4 bg-red-950 border border-red-800 rounded-xl text-red-400">
          {error}
        </div>
      )}
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold mb-3 text-gray-200">{title}</h2>
      <div className="p-5 bg-gray-900/50 border border-gray-800 rounded-xl">
        {children}
      </div>
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="text-xs text-gray-400">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full mt-1 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm"
      />
    </div>
  );
}
