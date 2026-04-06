"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

export default function Navigation() {
  const pathname = usePathname();

  const navLink = (href: string, label: string) => {
    const isActive = pathname === href;
    return (
      <Link
        href={href}
        className={`transition-colors ${
          isActive
            ? "text-[#adc6ff] border-b-2 border-[#adc6ff] pb-1"
            : "text-[#c2c6d6] hover:text-white"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <nav className="w-full top-0 sticky z-50 bg-[#131313] font-body font-light tracking-tight">
      <div className="flex justify-between items-center px-8 py-6 max-w-[1440px] mx-auto bg-[#1c1b1b]">
        <Link href="/" className="flex items-center gap-3 text-2xl font-bold tracking-tighter text-[#adc6ff]">
          <Image src="/logo.png" alt="ProofFrame" width={36} height={36} className="rounded-lg" />
          ProofFrame
        </Link>
        <div className="hidden md:flex items-center gap-8">
          {navLink("/", "Landing")}
          {navLink("/attest", "Attest")}
          {navLink("/verify", "Verify")}
        </div>
        <div className="flex items-center gap-4">
          <div className="md:hidden">
            <span className="material-symbols-outlined text-on-surface">menu</span>
          </div>
          <div className="hidden md:flex h-10 w-10 rounded-full bg-surface-container-highest items-center justify-center text-primary">
            <span className="material-symbols-outlined">shield_person</span>
          </div>
        </div>
      </div>
    </nav>
  );
}
