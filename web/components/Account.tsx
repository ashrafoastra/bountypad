"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useAuth } from "@/lib/auth";
import { short } from "@/lib/format";
import { Avatar, Verified, XIcon } from "./ui";

/** Header button: "Connect" when logged out, avatar + wallet chip with a menu when logged in. */
export function Account() {
  const a = useAuth();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (!a.ready) return <div className="h-10 w-28 rounded-xl bg-panel animate-pulse" />;
  if (!a.authenticated) return <button onClick={a.login} className="btn btn-primary h-10 px-4 text-sm"><span className="sm:hidden">Connect</span><span className="hidden sm:inline">Connect wallet</span></button>;

  const label = a.x ? `@${a.x.username}` : a.wallet ? short(a.wallet) : "Account";
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 h-10 pl-1.5 pr-3 rounded-xl bg-panel hover:bg-panel-2 transition-colors">
        <Avatar name={a.x?.name ?? a.wallet ?? "?"} src={a.x?.avatarUrl} size={28} />
        <span className="text-sm font-medium max-w-[120px] truncate">{label}</span>
        {a.mode === "dev" && <span className="text-[10px] font-mono text-gold">DEV</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-72 card shadow-[0_12px_40px_rgba(0,0,0,.12)] p-2 z-50">
            <div className="px-3 py-3 border-b border-line">
              <div className="text-xs font-semibold text-mute mb-2">Wallet</div>
              {a.wallet ? (
                <button className="font-mono text-sm text-ink hover:text-xblue break-all text-left" onClick={() => { navigator.clipboard?.writeText(a.wallet!); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
                  {short(a.wallet, 8)} <span className="text-dim text-xs">{copied ? "copied" : "copy"}</span>
                </button>
              ) : <span className="text-mute text-sm">No wallet yet</span>}
            </div>
            <div className="px-3 py-3 border-b border-line">
              <div className="text-xs font-semibold text-mute mb-2">X account</div>
              {a.x ? (
                <div className="flex items-center gap-2 text-sm"><XIcon size={13} />@{a.x.username}<Verified size={13} /></div>
              ) : (
                <button className="text-sm font-semibold text-xblue" onClick={() => { setOpen(false); a.loginWithX(); }}>Link your X account</button>
              )}
            </div>
            <div className="flex flex-col p-1">
              <Link href="/claim" onClick={() => setOpen(false)} className="px-3 py-2 rounded-lg text-sm hover:bg-panel">Coins that name me</Link>
              <button onClick={() => { setOpen(false); a.logout(); }} className="px-3 py-2 rounded-lg text-sm text-left text-red hover:bg-panel">Log out</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
