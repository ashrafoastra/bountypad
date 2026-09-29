"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Logo, LogoMark } from "./ui";
import { useHealth } from "@/lib/api";
import { Account } from "./Account";

const LINKS = [
  { href: "/", label: "Explore" },
  { href: "/launch", label: "Launch" },
  { href: "/claim", label: "Claim" },
];

function Search() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  useEffect(() => { setQ(params.get("q") ?? ""); }, [params]);
  return (
    <form className="relative flex-1 max-w-[520px] hidden md:block" onSubmit={(e) => { e.preventDefault(); router.push(q.trim() ? `/?q=${encodeURIComponent(q.trim())}#bounties` : "/"); }}>
      <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-dim" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search coins, tickers or people"
        className="w-full h-11 rounded-xl bg-panel pl-11 pr-10 text-[15px] outline-none border border-transparent focus:border-line focus:bg-white transition-colors placeholder:text-dim" />
      <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-medium text-dim border border-line rounded-md px-1.5 py-0.5 bg-white">/</kbd>
    </form>
  );
}

/** Phones: the links and search live in a simple dropdown. */
function MobileMenu({ links, path }: { links: { href: string; label: string }[]; path: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [q, setQ] = useState("");
  useEffect(() => { setOpen(false); }, [path]);
  return (
    <div className="sm:hidden">
      <button aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)} className="w-10 h-10 rounded-xl bg-panel flex items-center justify-center">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">{open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}</svg>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-[68px] bg-white border-b border-line shadow-[0_12px_30px_rgba(0,0,0,.08)] px-4 pb-4 pt-3 flex flex-col gap-1">
          <form onSubmit={(e) => { e.preventDefault(); setOpen(false); router.push(q.trim() ? `/?q=${encodeURIComponent(q.trim())}#bounties` : "/"); }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search coins, tickers or people" className="w-full h-11 rounded-xl bg-panel px-4 text-[15px] outline-none mb-2" />
          </form>
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={`px-3 py-3 rounded-xl text-[16px] font-semibold ${(l.href === "/" ? path === "/" : path.startsWith(l.href)) ? "bg-panel text-ink" : "text-mute"}`}>{l.label}</Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function Nav() {
  const path = usePathname();
  const { data: health } = useHealth();
  // "/" focuses search, like OpenSea and Rarible.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || (e.target as HTMLElement)?.closest("input, textarea")) return;
      e.preventDefault();
      document.querySelector<HTMLInputElement>("header form input")?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const links = [...LINKS, ...(health?.devTools && health?.xMode === "mock" ? [{ href: "/dev", label: "Dev" }] : [])];
  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-line">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-[68px] flex items-center gap-2 sm:gap-6">
        <Link href="/" aria-label="Bounty Pad home" className="shrink-0">
          <span className="hidden sm:inline"><Logo /></span>
          <span className="sm:hidden"><LogoMark size={32} /></span>
        </Link>
        <Suspense fallback={<div className="flex-1 max-w-[520px] hidden md:block" />}><Search /></Suspense>
        <nav className="hidden sm:flex items-center sm:gap-1 text-[15px] font-semibold min-w-0">
          {links.map((l) => {
            const on = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link key={l.href} href={l.href} className={`px-2 sm:px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${on ? "text-ink" : "text-mute hover:text-ink"}`}>
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3 shrink-0 pl-1">
          {health?.sim && <span className="hidden lg:inline-flex items-center text-xs font-semibold text-gold bg-[#fff4d6] rounded-lg px-2.5 py-1">Simulation</span>}
          {health?.chain === "solana" && health.cluster !== "mainnet-beta" && (
            <span className="hidden lg:inline-flex items-center gap-1.5 text-xs font-semibold text-xblue bg-xblue/10 rounded-lg px-2.5 py-1" title={health.xMode === "mock" ? "Real Solana, simulated X" : "Real Solana and X"}>
              <span className="w-1.5 h-1.5 rounded-full bg-xblue" />Solana {health.cluster}{health.xMode === "mock" ? " · test X" : ""}
            </span>
          )}
          <Account />
          <MobileMenu links={links} path={path} />
        </div>
      </div>
    </header>
  );
}
