import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";
import Link from "next/link";
import { Providers } from "@/lib/auth";
import { Logo } from "@/components/ui";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: { default: "Bounty Pad: make them earn it", template: "%s · Bounty Pad" },
  description: "Every meme coin is a public challenge. Launch a coin, name anyone on X, set the challenge. Fees lock on Solana until they do it.",
  openGraph: { title: "Bounty Pad: make them earn it", description: "Launch a meme coin, name anyone on X, set the challenge. The pot unlocks only when they do it.", type: "website" },
  twitter: { card: "summary_large_image", title: "Bounty Pad: make them earn it" },
};

export const viewport = { themeColor: "#ffffff" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Providers>
          <Nav />
          <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 sm:py-8">{children}</main>
          <footer className="border-t border-line mt-20 bg-panel/60">
            <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-10 flex flex-col md:flex-row gap-8 md:items-start justify-between">
              <div className="flex flex-col gap-3 max-w-sm">
                <Logo />
                <span className="text-sm text-mute leading-relaxed">Launch a meme coin with a public challenge for anyone on X. Fees are locked on Solana until they do it.</span>
              </div>
              <div className="flex gap-14 text-sm">
                <div className="flex flex-col gap-2.5"><span className="font-semibold">Bounty Pad</span><Link href="/" className="text-mute hover:text-ink">Explore</Link><Link href="/launch" className="text-mute hover:text-ink">Launch a coin</Link><Link href="/claim" className="text-mute hover:text-ink">Claim a bounty</Link></div>
              </div>
            </div>
            <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-5 border-t border-line text-xs text-dim flex flex-col sm:flex-row gap-2 justify-between">
              <span>Devnet preview</span>
              <span>Coins are not endorsed by the people they name. Nothing here is financial advice.</span>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
