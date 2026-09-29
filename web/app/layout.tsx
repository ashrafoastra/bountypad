import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Nav } from "@/components/Nav";
import Link from "next/link";
import { Providers } from "@/lib/auth";
import { Logo } from "@/components/ui";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: { default: "Bounty Pad: paid for the action", template: "%s · Bounty Pad" },
  description: "Launch a meme coin with a challenge for anyone on X. Trading fees fill a pot on Solana that is paid only when they do it, verified automatically.",
  openGraph: { title: "Bounty Pad: paid for the action", description: "Every coin is a public challenge. The pot unlocks only when the action is verified.", type: "website" },
  twitter: { card: "summary_large_image", title: "Bounty Pad: paid for the action" },
};

export const viewport = { themeColor: "#101010" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen">
        <Providers>
          <Nav />
          <main className="max-w-[1320px] mx-auto px-4 sm:px-8 py-8 sm:py-10">{children}</main>
          <footer className="mt-24 border-t border-line">
            <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-12 grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
              <div className="flex flex-col gap-4 max-w-sm">
                <Logo />
                <p className="text-sm text-mute leading-relaxed">Meme coins with a challenge for anyone on X. Fees fill a pot on Solana, paid only for a verified action.</p>
              </div>
              <div className="flex flex-col gap-3 text-sm">
                <span className="label">Product</span>
                <Link href="/" className="text-mute hover:text-ink">Explore challenges</Link>
                <Link href="/launch" className="text-mute hover:text-ink">Launch a coin</Link>
                <Link href="/claim" className="text-mute hover:text-ink">Claim a bounty</Link>
              </div>
              <div className="flex flex-col gap-3 text-sm">
                <span className="label">Rules</span>
                <Link href="/#rules" className="text-mute hover:text-ink">How verification works</Link>
                <Link href="/#compare" className="text-mute hover:text-ink">Paid for the action</Link>
              </div>
            </div>
            <div className="border-t border-line">
              <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-5 flex flex-col sm:flex-row gap-2 justify-between label !normal-case !tracking-normal !text-[12px] !text-dim">
                <span>Devnet preview</span>
                <span>Coins are not endorsed by the people they name. Nothing here is financial advice.</span>
              </div>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
