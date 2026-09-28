import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "Bounty Pad",
  description: "Every meme coin is a public challenge. Launch a coin, name anyone on X, set the challenge.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <div className="grid-bg" />
        <Nav />
        <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12">{children}</main>
        <footer className="relative z-10 border-t border-line mt-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 text-sm text-dim flex flex-col sm:flex-row gap-3 justify-between">
            <span>Bounty Pad · devnet preview</span>
            <span>Coins are not endorsed by the people they name. Nothing here is financial advice.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
