import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import Navigation from "./components/Navigation";
import Footer from "./components/Footer";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "700", "800"],
  variable: "--font-inter",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
  variable: "--font-space-grotesk",
});

export const metadata: Metadata = {
  title: "ProofFrame | Cryptographic Image Authenticity",
  description: "ZK-powered image authenticity verification. Prove your photos are real without revealing who you are.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className={`${inter.variable} ${spaceGrotesk.variable} font-body min-h-screen flex flex-col selection:bg-primary/30 selection:text-primary`}>
        <Navigation />
        <div className="flex-grow flex flex-col">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
