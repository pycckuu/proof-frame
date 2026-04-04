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
  ipfsCid: string;
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
  const [ensName, setEnsName] = useState<string | null>(null);
  const [ipfsCid, setIpfsCid] = useState<string | null>(null);
  const [ensTextRecords, setEnsTextRecords] = useState<Record<string, string> | null>(null);

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
          ipfsCid: result.ipfsCid,
        });
        setStatus("verified");

        // Look up ENS subname + text records from NameStone (non-blocking)
        try {
          const domain = process.env.NEXT_PUBLIC_ENS_DOMAIN || "proof-frame.eth";
          const nsRes = await fetch(
            `https://namestone.com/api/public_v1/get-names?domain=${domain}`
          );
          if (nsRes.ok) {
            const names = await nsRes.json();
            // Find the subname that has this pixelHash in its text records
            const match = names.find(
              (n: { text_records?: Record<string, string> }) =>
                n.text_records?.["io.proofframe.pixelHash"] === `0x${pixelHash}`
            );
            if (match) {
              setEnsName(`${match.name}.${domain}`);
              if (match.text_records) {
                setEnsTextRecords(match.text_records);
                const imgRecord = match.text_records["io.proofframe.image"];
                if (imgRecord) {
                  setIpfsCid(imgRecord.replace("ipfs://", ""));
                }
              }
            }
          }
        } catch {
          // ENS lookup is optional — don't fail verification
        }
      } else {
        setStatus("not_verified");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification check failed");
      setStatus("error");
    }
  };

  // Upload state (no verification yet)
  if (!preview || status === "hashing") {
    return (
      <main className="flex-grow flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-2xl space-y-8">
          <div className="text-center space-y-4">
            <h1 className="text-5xl font-extrabold tracking-tighter text-on-surface">
              Verify <span className="text-primary">Authenticity</span>
            </h1>
            <p className="text-on-surface-variant text-lg font-light leading-relaxed max-w-lg mx-auto">
              Upload an image to check if it has been authenticated on-chain via zero-knowledge proof.
            </p>
          </div>

          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => document.getElementById("file-upload")?.click()}
            className={`border-2 border-dashed rounded-xl p-16 text-center cursor-pointer transition-all ${
              dragOver
                ? "border-primary bg-primary/5"
                : "border-outline-variant/30 hover:border-outline-variant/60 hover:bg-surface-container-highest"
            }`}
          >
            <span className="material-symbols-outlined text-5xl text-outline mb-4 block">cloud_upload</span>
            <p className="text-on-surface-variant font-medium mb-1">
              Drag and drop an image here, or click to select
            </p>
            <p className="font-label text-[10px] text-outline uppercase tracking-widest">
              PNG format supported
            </p>
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
          </div>

          {status === "hashing" && (
            <p className="text-center text-on-surface-variant font-label text-sm uppercase tracking-widest">
              Computing pixel hash...
            </p>
          )}
        </div>
      </main>
    );
  }

  // Verified state
  if (status === "verified" && attestation) {
    return (
      <main className="flex-grow w-full max-w-[1200px] mx-auto px-6 py-12">
        <div className="flex flex-col lg:flex-row gap-12 items-start">
          {/* Left: Image with VERIFIED shield */}
          <div className="w-full lg:w-3/5 space-y-8">
            <div className="relative group">
              {/* Verification Shield */}
              <div className="absolute -top-6 -left-6 z-10 glass-panel border border-secondary/20 px-6 py-4 rounded-xl flex items-center gap-3 shadow-2xl">
                <div className="bg-secondary/10 p-2 rounded-full">
                  <span className="material-symbols-outlined text-secondary text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                    verified
                  </span>
                </div>
                <div>
                  <p className="font-label text-[10px] uppercase tracking-[0.2em] text-secondary/70">Status</p>
                  <p className="font-headline font-bold text-lg text-secondary tracking-tight">VERIFIED</p>
                </div>
              </div>

              {/* Main Image */}
              <div className="rounded-xl overflow-hidden bg-surface-container-low aspect-[4/3] ring-1 ring-white/5 shadow-inner">
                <img
                  className="w-full h-full object-cover opacity-90 transition-opacity duration-700 group-hover:opacity-100"
                  src={preview}
                  alt="Verified image"
                />
              </div>
            </div>

            {/* Check again */}
            <div className="flex justify-center pt-4">
              <button
                onClick={() => {
                  setFile(null);
                  setPreview(null);
                  setPixelHash(null);
                  setAttestation(null);
                  setStatus("idle");
                }}
                className="bg-gradient-to-r from-primary to-primary-container text-on-primary px-10 py-5 rounded-xl font-headline font-semibold text-lg flex items-center gap-3 shadow-xl hover:scale-[1.02] active:scale-95 transition-all"
              >
                <span className="material-symbols-outlined">refresh</span>
                Check Another Image
              </button>
            </div>
          </div>

          {/* Right: Attestation Details */}
          <div className="w-full lg:w-2/5 space-y-6">
            <header>
              <h1 className="text-4xl font-headline font-extrabold tracking-tighter mb-2">Cryptographic Proof</h1>
              <p className="text-on-surface-variant font-body">
                Verification results for file integrity and metadata provenance.
              </p>
            </header>

            <div className="bg-surface-container-low rounded-xl p-8 space-y-8 ring-1 ring-white/5">
              {/* Meta Grid */}
              <div className="grid grid-cols-2 gap-y-6 gap-x-4">
                <MetaField label="Dimensions" value={`${attestation.imageWidth} x ${attestation.imageHeight}`} />
                {attestation.disclosedCameraMake && (
                  <MetaField label="Camera" value={attestation.disclosedCameraMake} />
                )}
                <MetaField
                  label="Attested"
                  value={new Date(Number(attestation.timestamp) * 1000).toLocaleString()}
                />
                <MetaField label="Transforms" value={attestation.transformDesc || "none"} />
                {attestation.disclosedDate && (
                  <MetaField label="Exif Date" value={attestation.disclosedDate} />
                )}
                {attestation.disclosedLocation && (
                  <MetaField label="Location" value={attestation.disclosedLocation} />
                )}
              </div>

              {/* Separator */}
              <div className="h-px bg-surface-variant/20"></div>

              {/* Hash Section */}
              <div className="space-y-6">
                <HashField icon="fingerprint" label="File Hash" value={attestation.fileHash} />
                <HashField icon="devices" label="Device Registry Root" value={attestation.merkleRoot} />
              </div>

              {/* ENS Subname + Text Records */}
              {ensName && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-primary text-sm">badge</span>
                    <div>
                      <p className="font-label text-[10px] text-on-surface-variant/60 uppercase tracking-wider">ENS Name</p>
                      <a
                        href={`https://sepolia.app.ens.domains/${ensName}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-label text-xs text-primary hover:underline"
                      >
                        {ensName}
                      </a>
                    </div>
                  </div>

                  {/* ENS Description */}
                  {ensTextRecords?.description && (
                    <p className="font-body text-sm text-on-surface-variant/80 italic">
                      {ensTextRecords.description}
                    </p>
                  )}

                  {/* ENS Text Records */}
                  {ensTextRecords && Object.keys(ensTextRecords).length > 0 && (
                    <div className="bg-surface-container-lowest rounded-lg p-4 space-y-2">
                      <p className="font-label text-[10px] text-on-surface-variant/60 uppercase tracking-wider mb-2">
                        ENS Text Records
                      </p>
                      {Object.entries(ensTextRecords)
                        .filter(([key]) => key !== "description")
                        .map(([key, value]) => {
                        const label = key.replace("io.proofframe.", "");
                        const isIpfs = value.startsWith("ipfs://");
                        const isUrl = value.startsWith("http://") || value.startsWith("https://");
                        const isHex = value.startsWith("0x");
                        return (
                          <div key={key} className="flex justify-between items-start gap-2">
                            <span className="font-label text-[10px] text-on-surface-variant/50 shrink-0">{label}</span>
                            {isIpfs ? (
                              <a
                                href={`https://proof-frame.infura-ipfs.io/ipfs/${value.replace("ipfs://", "")}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-label text-[10px] text-primary hover:underline text-right break-all"
                              >
                                {value}
                              </a>
                            ) : isUrl ? (
                              <a
                                href={value}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-label text-[10px] text-primary hover:underline text-right break-all"
                              >
                                {value.length > 40 ? `${value.slice(0, 30)}...` : value}
                              </a>
                            ) : (
                              <span className={`font-label text-[10px] text-right break-all ${isHex ? "text-on-surface-variant/70 font-mono" : "text-on-surface"}`}>
                                {value.length > 30 ? `${value.slice(0, 15)}...${value.slice(-10)}` : value}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Trust Badge */}
              <div className="bg-secondary/5 border border-secondary/10 p-4 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-secondary" style={{ fontVariationSettings: "'FILL' 1" }}>
                    shield
                  </span>
                  <span className="font-label text-[11px] uppercase tracking-widest text-secondary/80">ZK-Verified Proof</span>
                </div>
                <span className="font-label text-[10px] text-on-surface-variant/40">RISC ZERO VM</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // Not verified state
  if (status === "not_verified") {
    return (
      <main className="flex-grow flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          {/* Left: Failed image */}
          <div className="lg:col-span-7 relative">
            <div className="bg-surface-container-low p-4 rounded-xl overflow-hidden relative group">
              <img
                className="w-full aspect-[4/3] object-cover rounded-lg opacity-40 grayscale filter blur-[2px]"
                src={preview}
                alt="Unverified image"
              />
              {/* NOT VERIFIED overlay */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="glass-panel px-8 py-10 rounded-xl border border-error/20 flex flex-col items-center text-center shadow-2xl">
                  <div className="w-20 h-20 rounded-full bg-error/10 border-2 border-error flex items-center justify-center mb-6">
                    <span className="material-symbols-outlined text-error text-5xl">close</span>
                  </div>
                  <div className="font-label text-error uppercase tracking-[0.2em] font-bold text-xl mb-2">NOT VERIFIED</div>
                  <div className="font-label text-on-surface-variant text-xs opacity-60">
                    0x{pixelHash?.slice(0, 8)}...
                  </div>
                </div>
              </div>
            </div>
            {/* Technical Readout */}
            <div className="absolute -bottom-6 -right-4 font-label bg-surface-container-highest px-4 py-2 rounded-sm text-[10px] text-error/80 tracking-tighter border-l-2 border-error">
              BLOCK_SCAN: NULL_RESULT // ATTESTATION_ABSENT
            </div>
          </div>

          {/* Right: Content & Action */}
          <div className="lg:col-span-5 flex flex-col space-y-8">
            <div className="space-y-4">
              <h1 className="text-5xl font-extrabold tracking-tighter leading-tight text-on-surface">
                Authenticity <span className="text-error">Check Failed</span>.
              </h1>
              <p className="text-on-surface-variant text-lg font-light leading-relaxed">
                No on-chain attestation found for this image. The cryptographic proof required to validate the
                origin and integrity of this file is missing or has been altered.
              </p>
            </div>

            <div className="bg-surface-container-low p-6 rounded-xl space-y-6">
              <div className="flex items-start gap-4">
                <span className="material-symbols-outlined text-error mt-1">report</span>
                <div className="flex flex-col">
                  <span className="font-label text-[10px] uppercase text-on-surface-variant tracking-widest">Error Trace</span>
                  <span className="font-label text-sm text-on-surface">
                    Zero-Knowledge Verification failed to match image hash against Ethereum Sepolia state.
                  </span>
                </div>
              </div>

              <div className="pt-4 flex flex-col gap-3">
                <button
                  onClick={() => {
                    setFile(null);
                    setPreview(null);
                    setPixelHash(null);
                    setStatus("idle");
                  }}
                  className="bg-gradient-to-r from-error/20 to-error/10 text-error font-medium py-4 px-8 rounded-xl flex items-center justify-center gap-2 hover:from-error/30 transition-all active:opacity-80"
                >
                  <span className="material-symbols-outlined">refresh</span>
                  Try again
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // Default: Image uploaded, ready to verify
  return (
    <main className="flex-grow flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-2xl space-y-8">
        <div className="text-center space-y-4">
          <h1 className="text-5xl font-extrabold tracking-tighter text-on-surface">
            Verify <span className="text-primary">Authenticity</span>
          </h1>
          <p className="text-on-surface-variant text-lg font-light leading-relaxed max-w-lg mx-auto">
            Image loaded. Click below to check on-chain attestation.
          </p>
        </div>

        {/* Image Preview */}
        <div className="bg-surface-container-low p-4 rounded-xl overflow-hidden">
          <img
            src={preview}
            alt="Preview"
            className="w-full aspect-[4/3] object-cover rounded-lg"
          />
        </div>

        {/* Pixel Hash */}
        {pixelHash && (
          <div className="bg-surface-container-lowest p-4 rounded-lg border border-white/5">
            <p className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant/60 mb-2 flex items-center gap-2">
              <span className="material-symbols-outlined text-[14px]">fingerprint</span>
              Pixel Hash (SHA-256)
            </p>
            <code className="font-label text-xs text-primary/80 break-all leading-relaxed">
              0x{pixelHash}
            </code>
          </div>
        )}

        {/* Verify Button */}
        <button
          onClick={handleVerify}
          disabled={status === "checking"}
          className="w-full py-6 rounded-xl bg-gradient-to-r from-primary to-primary-container text-on-primary font-bold text-lg flex items-center justify-center gap-3 shadow-xl shadow-primary/10 hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span className="material-symbols-outlined">verified_user</span>
          <span>{status === "checking" ? "Checking..." : "Check Verification"}</span>
        </button>

        {/* Error */}
        {status === "error" && error && (
          <div className="p-6 bg-error-container/20 border border-error/20 rounded-xl">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-error">error</span>
              <span className="text-error text-sm">{error}</span>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant/60">{label}</p>
      <p className="font-label text-sm text-on-surface">{value}</p>
    </div>
  );
}

function HashField({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="space-y-2">
      <p className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant/60 flex items-center gap-2">
        <span className="material-symbols-outlined text-[14px]">{icon}</span>
        {label}
      </p>
      <div className="bg-surface-container-lowest p-4 rounded-lg border border-white/5">
        <code className="font-label text-xs text-primary/80 break-all leading-relaxed">{value}</code>
      </div>
    </div>
  );
}
