import Link from "next/link";

export default function Home() {
  return (
    <main className="flex-grow hero-gradient">
      {/* Hero Section */}
      <section className="max-w-[1440px] mx-auto px-8 pt-24 pb-32 grid lg:grid-cols-2 gap-16 items-center">
        <div className="space-y-8">
          <div className="inline-flex items-center gap-2 px-4 py-1 rounded-full bg-surface-container-high border border-outline-variant/20">
            <span className="w-2 h-2 rounded-full bg-secondary"></span>
            <span className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
              Live on Sepolia Testnet
            </span>
          </div>
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tighter leading-[0.95] text-on-surface">
            Prove your photos <span className="text-primary">are real</span> without revealing who you are.
          </h1>
          <p className="text-lg text-on-surface-variant max-w-xl leading-relaxed">
            AI fakes are everywhere. C2PA proves photos are real but exposes the photographer.{" "}
            <span className="text-on-surface font-medium">ProofFrame</span> uses ZK proofs to verify
            authenticity without compromising your privacy or revealing identity metadata.
          </p>
          <div className="flex flex-wrap gap-4 pt-4">
            <Link
              href="/attest"
              className="bg-gradient-to-r from-primary to-primary-container text-on-primary-container font-bold px-8 py-4 rounded-xl hover:opacity-90 transition-all active:opacity-80"
            >
              Attest Image
            </Link>
            <Link
              href="/verify"
              className="bg-surface-container-highest text-primary font-bold px-8 py-4 rounded-xl border border-primary/20 hover:bg-surface-bright transition-all active:opacity-80"
            >
              Verify Image
            </Link>
          </div>
        </div>

        {/* Flow Diagram */}
        <div className="relative">
          <div className="absolute -inset-4 bg-primary/5 blur-3xl rounded-full"></div>
          <div className="relative glass-panel rounded-xl p-10 border border-outline-variant/15 flex flex-col gap-12">
            {/* Source Capture */}
            <div className="flex items-center gap-6">
              <div className="w-16 h-16 rounded-xl bg-surface-container-highest flex items-center justify-center text-primary border border-primary/20">
                <span className="material-symbols-outlined text-3xl">photo_camera</span>
              </div>
              <div className="flex-grow">
                <div className="font-label text-xs text-primary uppercase tracking-widest mb-1">Source Capture</div>
                <div className="text-sm text-on-surface-variant">Original image metadata from hardware</div>
              </div>
              <span className="material-symbols-outlined text-outline-variant">trending_flat</span>
            </div>

            {/* ZK Generation */}
            <div className="flex items-center gap-6 translate-x-4">
              <div className="w-16 h-16 rounded-xl bg-primary text-on-primary flex items-center justify-center shadow-[0_0_40px_rgba(173,198,255,0.2)]">
                <span className="material-symbols-outlined text-3xl">shield_person</span>
              </div>
              <div className="flex-grow">
                <div className="font-label text-xs text-primary-fixed uppercase tracking-widest mb-1">ZK Generation</div>
                <div className="text-sm text-on-surface-variant">Obfuscate identity, prove pixels</div>
              </div>
              <span className="material-symbols-outlined text-outline-variant">trending_flat</span>
            </div>

            {/* On-Chain Attestation */}
            <div className="flex items-center gap-6 translate-x-8">
              <div className="w-16 h-16 rounded-xl bg-secondary/20 text-secondary flex items-center justify-center border border-secondary/30">
                <span className="material-symbols-outlined text-3xl">verified_user</span>
              </div>
              <div className="flex-grow">
                <div className="font-label text-xs text-secondary uppercase tracking-widest mb-1">On-Chain Attestation</div>
                <div className="text-sm text-on-surface-variant">Immutable proof hash on Ethereum</div>
              </div>
            </div>

            {/* Tech Readout */}
            <div className="absolute -bottom-6 -right-6 glass-panel p-4 rounded-lg border border-secondary/20 shadow-2xl">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-2 h-2 rounded-full bg-secondary animate-pulse"></div>
                <span className="font-label text-[10px] text-secondary uppercase tracking-tighter">System Integrity: Verified</span>
              </div>
              <div className="font-label text-[9px] text-on-surface-variant font-mono">
                HASH: 0x4f2a...91bc<br />
                ZKVM: RISC ZERO v1.0
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Bento Grid Features */}
      <section className="max-w-[1440px] mx-auto px-8 pb-32">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Large Feature */}
          <div className="md:col-span-2 bg-surface-container-low rounded-xl p-12 flex flex-col justify-between min-h-[400px] border border-outline-variant/10">
            <div>
              <h3 className="text-3xl font-bold mb-4">Cryptographic Redaction</h3>
              <p className="text-on-surface-variant leading-relaxed max-w-md">
                Standard metadata (EXIF) contains GPS, timestamps, and device serials. ProofFrame allows you to redact
                this sensitive information while proving that the image was not altered.
              </p>
            </div>
            <div className="mt-8 flex gap-2 overflow-hidden">
              <div className="w-24 h-24 rounded-lg bg-surface-container flex-shrink-0 border border-outline-variant/20 flex items-center justify-center">
                <span className="material-symbols-outlined text-outline-variant">location_off</span>
              </div>
              <div className="w-24 h-24 rounded-lg bg-surface-container flex-shrink-0 border border-outline-variant/20 flex items-center justify-center">
                <span className="material-symbols-outlined text-outline-variant">person_off</span>
              </div>
              <div className="w-24 h-24 rounded-lg bg-surface-container flex-shrink-0 border border-outline-variant/20 flex items-center justify-center">
                <span className="material-symbols-outlined text-outline-variant">visibility_off</span>
              </div>
            </div>
          </div>

          {/* C2PA Standard */}
          <div className="bg-surface-container rounded-xl p-10 border border-outline-variant/10">
            <div className="w-12 h-12 rounded-lg bg-secondary/10 flex items-center justify-center text-secondary mb-6">
              <span className="material-symbols-outlined">dataset</span>
            </div>
            <h3 className="text-xl font-bold mb-2">C2PA Standard</h3>
            <p className="text-sm text-on-surface-variant leading-relaxed mb-6">
              Built upon the Content Authenticity Initiative standards, optimized for zero-knowledge privacy.
            </p>
            <div className="p-4 bg-surface-container-lowest rounded-lg">
              <div className="text-[10px] font-label text-outline uppercase mb-2">Technical Specs</div>
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-label">
                  <span>Proof System</span>
                  <span className="text-on-surface">STARK</span>
                </div>
                <div className="flex justify-between text-[11px] font-label">
                  <span>Settlement</span>
                  <span className="text-on-surface">Ethereum</span>
                </div>
              </div>
            </div>
          </div>

          {/* Anonymity First */}
          <div className="bg-surface-container-high rounded-xl p-8 border border-outline-variant/10 flex flex-col items-center text-center justify-center gap-4">
            <span className="material-symbols-outlined text-4xl text-primary">fingerprint</span>
            <div>
              <div className="font-bold mb-1">Anonymity First</div>
              <p className="text-xs text-on-surface-variant">No wallets, no accounts, no tracking.</p>
            </div>
          </div>

          {/* Decentralized Trust */}
          <div className="md:col-span-2 relative overflow-hidden bg-surface-container rounded-xl p-10 border border-outline-variant/10 group">
            <div className="relative z-10">
              <h3 className="text-xl font-bold mb-2">Decentralized Trust</h3>
              <p className="text-sm text-on-surface-variant max-w-lg">
                We don&apos;t verify your images&mdash;the math does. Our infrastructure uses RISC Zero&apos;s zkVM to
                execute verification logic off-chain and post the proof to Ethereum.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
