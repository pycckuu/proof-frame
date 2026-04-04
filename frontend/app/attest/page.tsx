"use client";

import { useState, useCallback, useMemo } from "react";
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

  // Image natural dimensions (for crop overlay positioning)
  const [naturalWidth, setNaturalWidth] = useState(0);
  const [naturalHeight, setNaturalHeight] = useState(0);

  // Disclosure policy
  const [revealDate, setRevealDate] = useState(false);
  const [revealLocation, setRevealLocation] = useState(false);
  const [revealCamera, setRevealCamera] = useState(false);
  const [locationPrecision, setLocationPrecision] = useState("hidden");

  // Receipt
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  // Proving
  const [proveStatus, setProveStatus] = useState<"idle" | "proving" | "done" | "error">("idle");

  // Submission
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [ensName, setEnsName] = useState<string | null>(null);
  const [ipfsCid, setIpfsCid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showManualUpload, setShowManualUpload] = useState(false);

  // CSS filter string for live preview of grayscale + brightness
  const previewFilter = useMemo(() => {
    const parts: string[] = [];
    if (grayscale) parts.push("grayscale(1)");
    if (brightness !== 0) {
      parts.push(`brightness(${(brightness + 100) / 100})`);
    }
    return parts.length > 0 ? parts.join(" ") : undefined;
  }, [grayscale, brightness]);

  const hasCrop = cropW > 0 && cropH > 0 && naturalWidth > 0 && naturalHeight > 0;
  const hasAnyTransform = grayscale || brightness !== 0 || (cropW > 0 && cropH > 0);

  const handleImageFile = useCallback(async (f: File) => {
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setNaturalWidth(0);
    setNaturalHeight(0);
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

  const handleGenerateProof = async () => {
    if (!file) {
      setError("Please upload an image first");
      return;
    }
    setProveStatus("proving");
    setError(null);
    setReceipt(null);

    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const image_base64 = btoa(binary);

      // Build transform from UI state
      let transform = '"None"';
      const transforms: string[] = [];
      if (cropW > 0 && cropH > 0) {
        transforms.push(`{"Crop":{"x":${cropX},"y":${cropY},"width":${cropW},"height":${cropH}}}`);
      }
      if (grayscale) transforms.push('"Grayscale"');
      if (brightness !== 0) transforms.push(`{"Brighten":{"value":${brightness}}}`);

      if (transforms.length === 1) {
        transform = transforms[0];
      } else if (transforms.length > 1) {
        transform = `{"Chain":[${transforms.join(",")}]}`;
      }

      const disclosure = {
        reveal_date: revealDate,
        reveal_location: revealLocation,
        reveal_camera_make: revealCamera,
        location_precision: locationPrecision === "hidden" ? "Hidden" :
          locationPrecision === "exact" ? "Exact" :
          locationPrecision === "city" ? "City" : "Country",
      };

      const res = await fetch("/api/prove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_base64, transform, disclosure }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Proof generation failed: ${res.status}`);
      }

      const result = await res.json();
      setReceipt(result);
      setProveStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Proof generation failed");
      setProveStatus("error");
    }
  };

  const handleSubmit = async () => {
    if (!receipt) {
      setError("Please generate a proof first");
      return;
    }
    setStatus("submitting");
    setError(null);

    try {
      // Read clean image as base64 for IPFS upload (if file loaded)
      let image_base64: string | undefined;
      if (file) {
        const buffer = await file.arrayBuffer();
        image_base64 = Buffer.from(buffer).toString("base64");
      }

      const res = await fetch("/api/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...receipt, image_base64 }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Relay failed: ${res.status}`);
      }

      const data = await res.json();
      setTxHash(data.txHash);
      setEnsName(data.ensName || null);
      setIpfsCid(data.ipfsCid || null);
      setStatus("confirmed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
      setStatus("error");
    }
  };

  return (
    <main className="flex-grow max-w-[1440px] mx-auto w-full px-8 py-12">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Media & Controls */}
        <div className="lg:col-span-7 space-y-8">
          {/* Image Upload & Preview */}
          <section className="bg-surface-container-low rounded-xl overflow-hidden relative group">
            <div className="p-8 space-y-6">
              <div className="flex justify-between items-end">
                <div>
                  <h1 className="text-4xl font-extrabold tracking-tighter mb-2">Attest Authenticity</h1>
                  <p className="text-on-surface-variant font-label text-sm uppercase tracking-widest">
                    New Verification Session
                  </p>
                </div>
                {pixelHash && (
                  <div className="text-right">
                    <span className="font-label text-[10px] text-on-surface-variant block mb-1">PIXEL HASH</span>
                    <code className="font-label text-xs text-primary bg-primary/10 px-2 py-1 rounded">
                      0x{pixelHash.slice(0, 8)}...
                    </code>
                  </div>
                )}
              </div>

              {/* Drop Zone / Preview Area */}
              <div
                className="relative rounded-xl overflow-hidden aspect-[16/10] bg-surface-container-highest border-2 border-dashed border-outline-variant/30 flex items-center justify-center cursor-pointer"
                onClick={() => document.getElementById("image-upload")?.click()}
              >
                {preview ? (
                  <>
                    <img
                      src={preview}
                      alt="Preview"
                      className={`absolute inset-0 w-full h-full opacity-90 ${hasAnyTransform ? "object-contain" : "object-cover"}`}
                      style={previewFilter ? { filter: previewFilter } : undefined}
                      onLoad={(e) => {
                        const img = e.currentTarget;
                        setNaturalWidth(img.naturalWidth);
                        setNaturalHeight(img.naturalHeight);
                      }}
                    />
                    {hasCrop && (
                      <div className="absolute inset-0 pointer-events-none">
                        {/* Top strip */}
                        <div
                          className="absolute bg-black/60"
                          style={{
                            top: 0,
                            left: 0,
                            right: 0,
                            height: `${(cropY / naturalHeight) * 100}%`,
                          }}
                        />
                        {/* Bottom strip */}
                        <div
                          className="absolute bg-black/60"
                          style={{
                            bottom: 0,
                            left: 0,
                            right: 0,
                            height: `${(Math.max(0, naturalHeight - cropY - cropH) / naturalHeight) * 100}%`,
                          }}
                        />
                        {/* Left strip */}
                        <div
                          className="absolute bg-black/60"
                          style={{
                            top: `${(cropY / naturalHeight) * 100}%`,
                            left: 0,
                            width: `${(cropX / naturalWidth) * 100}%`,
                            height: `${(cropH / naturalHeight) * 100}%`,
                          }}
                        />
                        {/* Right strip */}
                        <div
                          className="absolute bg-black/60"
                          style={{
                            top: `${(cropY / naturalHeight) * 100}%`,
                            right: 0,
                            width: `${(Math.max(0, naturalWidth - cropX - cropW) / naturalWidth) * 100}%`,
                            height: `${(cropH / naturalHeight) * 100}%`,
                          }}
                        />
                        {/* Crop border */}
                        <div
                          className="absolute border-2 border-primary/80 rounded-sm"
                          style={{
                            top: `${(cropY / naturalHeight) * 100}%`,
                            left: `${(cropX / naturalWidth) * 100}%`,
                            width: `${(cropW / naturalWidth) * 100}%`,
                            height: `${(cropH / naturalHeight) * 100}%`,
                          }}
                        />
                      </div>
                    )}
                    {pixelHash && (
                      <div className="absolute top-4 right-4 glass-panel px-4 py-2 rounded-lg border border-white/5 flex items-center gap-3">
                        <span className="material-symbols-outlined text-secondary" style={{ fontVariationSettings: "'FILL' 1" }}>
                          verified
                        </span>
                        <div className="font-label text-[10px] uppercase leading-none">
                          <div className="text-secondary font-bold">Hash Computed</div>
                          <div className="text-on-surface-variant opacity-60">0x{pixelHash.slice(0, 8)}...</div>
                        </div>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="material-symbols-outlined text-4xl text-white mb-2">cloud_upload</span>
                      <p className="font-label text-sm text-white">Click to Replace Image</p>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-3">
                    <span className="material-symbols-outlined text-4xl text-outline">cloud_upload</span>
                    <p className="font-label text-sm text-on-surface-variant">Upload your image</p>
                    <p className="font-label text-[10px] text-outline uppercase tracking-widest">PNG format required</p>
                  </div>
                )}
                <input
                  type="file"
                  accept="image/png,.png"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleImageFile(f);
                  }}
                  className="hidden"
                  id="image-upload"
                />
              </div>
            </div>
          </section>

          {/* Transforms Section */}
          <section className="bg-surface-container-low rounded-xl p-8">
            <div className="flex items-center gap-4 mb-8">
              <span className="material-symbols-outlined text-primary">tune</span>
              <h2 className="font-label text-lg font-medium">Applied Transforms</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
              {/* Crop Inputs */}
              <div className="space-y-6">
                <p className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
                  Crop Boundaries (px)
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <CropInput label="X" value={cropX} onChange={setCropX} />
                  <CropInput label="Y" value={cropY} onChange={setCropY} />
                  <CropInput label="WIDTH" value={cropW} onChange={setCropW} />
                  <CropInput label="HEIGHT" value={cropH} onChange={setCropH} />
                </div>
              </div>

              {/* Filters */}
              <div className="space-y-8">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">Grayscale</p>
                    <p className="text-xs text-outline">Remove color channels</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      className="sr-only peer"
                      type="checkbox"
                      checked={grayscale}
                      onChange={(e) => setGrayscale(e.target.checked)}
                    />
                    <div className="w-11 h-6 bg-surface-container-highest peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                  </label>
                </div>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <p className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">Brightness</p>
                    <span className="font-label text-xs text-primary">
                      {brightness >= 0 ? `+${brightness}%` : `${brightness}%`}
                    </span>
                  </div>
                  <input
                    className="w-full h-1.5 bg-surface-container-highest rounded-lg appearance-none cursor-pointer accent-primary"
                    type="range"
                    min={-100}
                    max={100}
                    value={brightness}
                    onChange={(e) => setBrightness(Number(e.target.value))}
                  />
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Right Column: Policy & Submit */}
        <div className="lg:col-span-5 space-y-8 lg:sticky lg:top-28">
          {/* Disclosure Policy */}
          <section className="bg-surface-container-low rounded-xl p-8 border border-white/[0.02]">
            <div className="flex items-center gap-4 mb-8">
              <span className="material-symbols-outlined text-primary">visibility_off</span>
              <h2 className="font-label text-lg font-medium text-primary">Disclosure Policy</h2>
            </div>
            <div className="space-y-6">
              {/* Reveal Date */}
              <div className="p-4 bg-surface-container rounded-xl flex items-center justify-between border border-transparent hover:border-outline-variant/20 transition-all">
                <div className="flex items-center gap-4">
                  <span className="material-symbols-outlined text-on-surface-variant">calendar_today</span>
                  <div>
                    <p className="text-sm font-medium">Reveal Date</p>
                    <p className="text-[10px] font-label text-outline uppercase tracking-wider">Show precise timestamp</p>
                  </div>
                </div>
                <input
                  className="w-5 h-5 rounded border-outline-variant bg-surface-container-highest text-primary focus:ring-primary/20"
                  type="checkbox"
                  checked={revealDate}
                  onChange={(e) => setRevealDate(e.target.checked)}
                />
              </div>

              {/* Reveal Location */}
              <div className="p-4 bg-surface-container rounded-xl space-y-4 border border-transparent hover:border-outline-variant/20 transition-all">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <span className="material-symbols-outlined text-on-surface-variant">location_on</span>
                    <div>
                      <p className="text-sm font-medium">Reveal Location</p>
                      <p className="text-[10px] font-label text-outline uppercase tracking-wider">Geospatial Granularity</p>
                    </div>
                  </div>
                  <input
                    className="w-5 h-5 rounded border-outline-variant bg-surface-container-highest text-primary focus:ring-primary/20"
                    type="checkbox"
                    checked={revealLocation}
                    onChange={(e) => setRevealLocation(e.target.checked)}
                  />
                </div>
                {revealLocation && (
                  <div className="pl-12">
                    <select
                      className="w-full bg-surface-container-highest border-0 rounded-lg text-sm font-label focus:ring-1 focus:ring-primary/40 text-on-surface p-3 cursor-pointer"
                      value={locationPrecision}
                      onChange={(e) => setLocationPrecision(e.target.value)}
                    >
                      <option value="city">City Level</option>
                      <option value="country">Country Level</option>
                      <option value="exact">Exact Coordinates</option>
                    </select>
                  </div>
                )}
              </div>

              {/* Reveal Camera */}
              <div className="p-4 bg-surface-container rounded-xl flex items-center justify-between border border-transparent hover:border-outline-variant/20 transition-all">
                <div className="flex items-center gap-4">
                  <span className="material-symbols-outlined text-on-surface-variant">photo_camera</span>
                  <div>
                    <p className="text-sm font-medium">Reveal Camera Make</p>
                    <p className="text-[10px] font-label text-outline uppercase tracking-wider">Lens &amp; Sensor Data</p>
                  </div>
                </div>
                <input
                  className="w-5 h-5 rounded border-outline-variant bg-surface-container-highest text-primary focus:ring-primary/20"
                  type="checkbox"
                  checked={revealCamera}
                  onChange={(e) => setRevealCamera(e.target.checked)}
                />
              </div>
            </div>
          </section>

          {/* Generate Proof */}
          <section className="bg-surface-container-low rounded-xl p-8">
            <div className="flex items-center gap-4 mb-6">
              <span className="material-symbols-outlined text-primary">shield</span>
              <h2 className="font-label text-lg font-medium">ZK Proof</h2>
            </div>

            {/* Generate Proof Button */}
            <button
              onClick={handleGenerateProof}
              disabled={!file || proveStatus === "proving"}
              className="w-full py-5 rounded-xl bg-surface-container-highest text-on-surface font-bold text-base flex items-center justify-center gap-3 border border-outline-variant/20 hover:border-primary/40 hover:bg-surface-container transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {proveStatus === "proving" ? (
                <>
                  <span className="material-symbols-outlined animate-spin">progress_activity</span>
                  <span>Generating ZK Proof...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined">bolt</span>
                  <span>Generate Proof</span>
                </>
              )}
            </button>

            {proveStatus === "proving" && (
              <p className="text-center mt-3 text-[10px] font-label text-outline uppercase tracking-widest">
                Running RISC Zero zkVM · ~3 seconds in dev mode
              </p>
            )}

            {/* Proof Result */}
            {receipt && proveStatus === "done" && (
              <div className="mt-4 p-4 bg-surface-container-lowest rounded-lg border border-secondary/20">
                <div className="flex items-center gap-2 mb-2">
                  <span className="material-symbols-outlined text-secondary text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
                    check_circle
                  </span>
                  <span className="font-label text-xs text-secondary uppercase tracking-wider">Proof Generated</span>
                </div>
                <div className="space-y-1 font-label text-xs text-on-surface-variant">
                  <p>pixelHash: {receipt.pixelHash}</p>
                  <p>fileHash: {receipt.fileHash}</p>
                  <p>transforms: {receipt.transformDesc || "none"}</p>
                  <p>dimensions: {receipt.imageWidth} x {receipt.imageHeight}</p>
                </div>
              </div>
            )}

            {/* Manual upload fallback */}
            <div className="mt-4">
              <button
                onClick={() => setShowManualUpload(!showManualUpload)}
                className="text-[10px] font-label text-outline uppercase tracking-widest hover:text-on-surface-variant transition-colors"
              >
                {showManualUpload ? "Hide" : "Or upload receipt manually"}
              </button>
              {showManualUpload && (
                <div className="mt-3">
                  <div
                    className="border border-dashed border-outline-variant/20 rounded-lg p-4 flex flex-col items-center text-center cursor-pointer hover:bg-surface-container-highest transition-all"
                    onClick={() => document.getElementById("receipt-upload")?.click()}
                  >
                    <span className="material-symbols-outlined text-xl text-outline mb-1">upload_file</span>
                    <p className="text-[10px] font-label text-outline">Upload Receipt JSON</p>
                  </div>
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleReceiptUpload}
                    className="hidden"
                    id="receipt-upload"
                  />
                </div>
              )}
            </div>
          </section>

          {/* Submit Action */}
          <div className="pt-4">
            <button
              onClick={handleSubmit}
              disabled={!receipt || status === "submitting"}
              className="w-full py-6 rounded-xl bg-gradient-to-r from-primary to-primary-container text-on-primary font-bold text-lg flex items-center justify-center gap-3 shadow-xl shadow-primary/10 hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span>{status === "submitting" ? "Submitting to Relay..." : "Submit Attestation"}</span>
              <span className="material-symbols-outlined">send</span>
            </button>
            <p className="text-center mt-6 text-[10px] font-label text-outline uppercase tracking-widest leading-relaxed">
              By submitting, you generate a non-interactive zero-knowledge proof<br />
              of the transformations applied to this image.
            </p>
          </div>

          {/* Status Messages */}
          {status === "confirmed" && txHash && (
            <div className="p-6 bg-secondary/5 border border-secondary/20 rounded-xl">
              <div className="flex items-center gap-3 mb-3">
                <span className="material-symbols-outlined text-secondary" style={{ fontVariationSettings: "'FILL' 1" }}>
                  verified
                </span>
                <span className="font-label text-sm text-secondary uppercase tracking-wider font-bold">
                  Attestation Submitted
                </span>
              </div>
              <div className="space-y-2">
                <a
                  href={`https://sepolia.etherscan.io/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-label text-xs text-primary hover:underline break-all block"
                >
                  TX: {txHash}
                </a>
                {ensName && (
                  <a
                    href={`https://app.ens.domains/${ensName}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-label text-xs text-secondary hover:underline block"
                  >
                    ENS: {ensName}
                  </a>
                )}
                {ipfsCid && (
                  <a
                    href={`https://proof-frame.infura-ipfs.io/ipfs/${ipfsCid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-label text-xs text-primary hover:underline break-all block"
                  >
                    IPFS: ipfs://{ipfsCid}
                  </a>
                )}
              </div>
            </div>
          )}
          {status === "error" && error && (
            <div className="p-6 bg-error-container/20 border border-error/20 rounded-xl">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-error">error</span>
                <span className="text-error text-sm">{error}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function CropInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="font-label text-[10px] text-outline ml-2">{label}</label>
      <input
        className="w-full bg-surface-container-highest border-0 rounded-lg text-sm font-label focus:ring-1 focus:ring-primary/40 text-on-surface p-3"
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
