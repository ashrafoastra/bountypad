"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark } from "./ui";
import { useHealth } from "@/lib/api";

const LINKS = [
  { href: "/", label: "Explore" },
  { href: "/launch", label: "Launch" },
  { href: "/claim", label: "Claim" },
];

export function Nav() {
  const path = usePathname();
  const { data: health } = useHealth();
  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-bg/70 border-b border-line">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-6">
        <Link href="/" className="flex items-center gap-2.5 font-bold text-lg tracking-tight">
          <LogoMark /> <span className="hidden sm:inline">Bounty Pad</span>
        </Link>
        <nav className="flex items-center gap-0.5 sm:gap-1 text-[15px] min-w-0 overflow-x-auto">
          {[...LINKS, ...(health?.sim ? [{ href: "/dev", label: "Dev" }] : [])].map((l) => {
            const on = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link key={l.href} href={l.href} className={`px-3 py-1.5 rounded-lg transition-colors ${on ? "text-ink bg-white/[.06]" : "text-mute hover:text-ink"}`}>
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {health?.sim && <span className="hidden sm:inline-flex items-center gap-2 text-xs font-mono text-gold border border-gold/30 bg-gold/10 rounded-full px-3 py-1">SIMULATION</span>}
          <Link href="/launch" className="btn btn-primary h-10 px-4 text-sm hidden sm:inline-flex">Launch a coin</Link>
        </div>
      </div>
    </header>
  );
}
