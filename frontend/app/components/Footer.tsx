export default function Footer() {
  return (
    <footer className="w-full py-12 mt-auto bg-[#131313] border-t border-[#353534]/15">
      <div className="flex flex-col items-center justify-center gap-4 text-center px-8">
        <div className="text-xs font-mono text-[#c2c6d6]">
          ProofFrame
        </div>
        <div className="font-label text-[10px] uppercase tracking-widest text-[#c2c6d6]">
          Powered by <span className="text-[#adc6ff]">RISC Zero zkVM</span> &middot;{" "}
          <span className="text-[#adc6ff]">Ethereum Sepolia</span>
        </div>
        <div className="flex gap-6 mt-2">
          <a className="text-[#c2c6d6] hover:text-[#adc6ff] transition-opacity duration-500 font-label text-[10px] uppercase tracking-widest" href="#">
            Documentation
          </a>
          <a className="text-[#c2c6d6] hover:text-[#adc6ff] transition-opacity duration-500 font-label text-[10px] uppercase tracking-widest" href="#">
            Github
          </a>
          <a className="text-[#c2c6d6] hover:text-[#adc6ff] transition-opacity duration-500 font-label text-[10px] uppercase tracking-widest" href="#">
            Privacy
          </a>
        </div>
        <div className="mt-4 text-[9px] text-outline/30 uppercase tracking-[0.3em]">
          &copy; 2026 ProofFrame Protocol. Verifiable Reality.
        </div>
      </div>
    </footer>
  );
}
