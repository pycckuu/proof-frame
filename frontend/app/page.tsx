import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="text-center max-w-2xl">
        <h1 className="text-6xl font-bold mb-4 bg-gradient-to-r from-blue-400 to-blue-600 bg-clip-text text-transparent">
          ProofFrame
        </h1>
        <p className="text-xl text-gray-400 mb-12">
          Zero-knowledge image authenticity. Prove your photos are real without
          revealing who you are.
        </p>

        <div className="flex flex-col sm:flex-row gap-6 justify-center">
          <Link
            href="/attest"
            className="px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white text-lg font-semibold rounded-xl transition-colors"
          >
            Attest Image
          </Link>
          <Link
            href="/verify"
            className="px-8 py-4 bg-gray-800 hover:bg-gray-700 text-white text-lg font-semibold rounded-xl border border-gray-700 transition-colors"
          >
            Verify Image
          </Link>
        </div>

        <p className="mt-16 text-sm text-gray-600">
          Powered by RISC Zero zkVM &middot; Ethereum Sepolia
        </p>
      </div>
    </main>
  );
}
