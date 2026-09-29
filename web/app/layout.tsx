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

export const viewport = { themeColor: "#060709" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Providers>
          <div className="grid-bg" />
          <Nav />
          <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12">{children}</main>
          <footer className="relative z-10 border-t border-line mt-24">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 flex flex-col md:flex-row gap-8 md:items-center justify-between">
              <div className="flex flex-col gap-3">
                <Logo />
                <span className="text-sm text-dim">Every meme coin is a public challenge. Devnet preview.</span>
              </div>
              <nav className="flex gap-6 text-sm text-mute">
                <Link href="/" className="hover:text-ink">Explore</Link>
                <Link href="/launch" className="hover:text-ink">Launch</Link>
                <Link href="/claim" className="hover:text-ink">Claim a bounty</Link>
              </nav>
            </div>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-8 text-xs text-dim">Coins are not endorsed by the people they name. Nothing here is financial advice.</div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
