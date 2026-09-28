"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { BountyStatus, CheckResult } from "@bountypad/shared";
import { STATUS } from "@/lib/format";

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <circle cx="20" cy="20" r="16" fill="none" stroke="#f7c75a" strokeWidth="3.4" />
      <path d="M12.5 20.5l5 5 10-11" fill="none" stroke="#3dffa2" strokeWidth="3.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function XIcon({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-label="X">
      <path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function Verified({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="verified" className="inline-block shrink-0">
      <circle cx="12" cy="12" r="11" fill="#1d9bf0" />
      <path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const GRADS = [["#ff7a59", "#b04cff"], ["#3dffa2", "#1d9bf0"], ["#f7c75a", "#ff5f6d"], ["#6a8dff", "#b04cff"], ["#14f195", "#9945ff"], ["#ff9a8b", "#ff6a88"], ["#43cbff", "#9708cc"], ["#5ee7df", "#b490ca"]];
function hash(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

/** Initials on a gradient, generated from the name. Real avatars come from X in REAL mode. */
export function Avatar({ name, src, size = 40, square = false }: { name: string; src?: string | null; size?: number; square?: boolean }) {
  const [broken, setBroken] = useState(false);
  const g = GRADS[hash(name) % GRADS.length];
  const shape = square ? "rounded-xl" : "rounded-full";
  const initials = name.replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  if (src && !broken) return <img src={src} alt={name} width={size} height={size} onError={() => setBroken(true)} className={`${shape} object-cover shrink-0 bg-panel-2`} style={{ width: size, height: size }} />;
  return (
    <div className={`${shape} shrink-0 flex items-center justify-center font-bold text-white`} style={{ width: size, height: size, fontSize: size * 0.36, background: `linear-gradient(135deg, ${g[0]}, ${g[1]})` }}>
      {initials}
    </div>
  );
}

const TONE = {
  green: "text-green border-green/40 bg-green/10",
  gold: "text-gold border-gold/40 bg-gold/10",
  blue: "text-xblue border-xblue/40 bg-xblue/10",
  mute: "text-mute border-line bg-white/5",
  red: "text-red border-red/40 bg-red/10",
};

export function StatusPill({ status, big = false }: { status: BountyStatus; big?: boolean }) {
  const s = STATUS[status];
  const live = ["DETECTED_CONFIRMING", "VOTING", "CHALLENGE_WINDOW"].includes(status);
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border ${big ? "px-3.5 py-1.5 text-sm" : "px-2.5 py-1 text-xs"} font-medium ${TONE[s.tone]}`}>
      {live && <span className="live-dot" style={{ width: 6, height: 6 }} />}
      {s.label}
    </span>
  );
}

/** Number that tweens to its new value, like the pot counter in the promo. */
export function Counter({ value, format, className = "" }: { value: number; format: (n: number) => string; className?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now(), a = from.current, b = value, dur = 900;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / dur), e = 1 - Math.pow(1 - k, 3);
      const v = a + (b - a) * e;
      setShown(v); from.current = v;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className={`tabular ${className}`}>{format(shown)}</span>;
}

export function Sparkline({ points, height = 64, color = "#f7c75a" }: { points: number[]; height?: number; color?: string }) {
  if (points.length < 2) return <div style={{ height }} />;
  const w = 600, max = Math.max(...points), min = Math.min(...points);
  const xy = points.map((p, i) => [(i / (points.length - 1)) * w, height - 4 - ((p - min) / (max - min || 1)) * (height - 10)]);
  const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const id = "sg" + hash(color + points.length);
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".28" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={`${d} L${w} ${height} L0 ${height} Z`} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const FLOW: { key: BountyStatus; label: string }[] = [
  { key: "OPEN", label: "Waiting" },
  { key: "DETECTED_CONFIRMING", label: "Post found" },
  { key: "VOTING", label: "Holder vote" },
  { key: "CHALLENGE_WINDOW", label: "Verified" },
  { key: "PAID", label: "Paid" },
];
const ORDER: Record<string, number> = { OPEN: 0, DETECTED_CONFIRMING: 1, VOTING: 2, VERIFIED: 3, CHALLENGE_WINDOW: 3, FROZEN: 3, PAID: 4 };

/** The bounty's journey, with the current step lit. Vote step only shows for video bounties. */
export function StatusTimeline({ status, video }: { status: BountyStatus; video: boolean }) {
  const steps = FLOW.filter((s) => video || s.key !== "VOTING");
  if (["EXPIRED", "OPTED_OUT"].includes(status)) return <p className="text-mute text-sm">{status === "EXPIRED" ? "The deadline passed with no verified action. The pot is burned." : "The target opted out. The pot is burned."}</p>;
  const cur = ORDER[status] ?? 0;
  return (
    <div className="flex items-center">
      {steps.map((s, i) => {
        const idx = ORDER[s.key];
        const done = idx < cur || status === "PAID", on = idx === cur && status !== "PAID";
        return (
          <div key={s.key} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-2 min-w-[64px]">
              <div className={`w-9 h-9 rounded-full border flex items-center justify-center transition-all duration-500 ${done ? "bg-green border-green" : on ? "border-green shadow-[0_0_20px_rgba(61,255,162,.45)]" : "border-line bg-panel"}`}>
                {done ? <svg width="16" height="16" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#03140b" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  : <span className={`w-2 h-2 rounded-full ${on ? "bg-green live-dot" : "bg-dim"}`} />}
              </div>
              <span className={`text-xs whitespace-nowrap ${done || on ? "text-ink" : "text-dim"}`}>{s.label}</span>
            </div>
            {i < steps.length - 1 && <div className="flex-1 h-px mx-1 -mt-6 relative bg-line overflow-hidden"><div className="absolute inset-y-0 left-0 bg-green transition-all duration-700" style={{ width: idx < cur || status === "PAID" ? "100%" : "0%" }} /></div>}
          </div>
        );
      })}
    </div>
  );
}

export function CheckList({ checks }: { checks: CheckResult[] }) {
  return (
    <div className="flex flex-col gap-2">
      {checks.map((c) => (
        <div key={c.id} className="flex items-center gap-3 rounded-xl border border-line bg-panel px-4 h-12">
          <span className={`w-6 h-6 rounded-full flex items-center justify-center ${c.pass ? "bg-green" : "bg-red/90"}`}>
            {c.pass ? <svg width="13" height="13" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#03140b" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              : <svg width="11" height="11" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" /></svg>}
          </span>
          <span className="text-[15px]">{c.label}</span>
          <span className={`ml-auto font-mono text-xs ${c.pass ? "text-green" : "text-red"}`}>{c.pass ? "passed" : c.detail ?? "failed"}</span>
        </div>
      ))}
    </div>
  );
}

export function PostCard({ name, username, text, at, verified, highlight, children }: { name: string; username: string; text: string; at: string; verified?: boolean; highlight?: string; children?: React.ReactNode }) {
  const parts = highlight ? text.split(new RegExp(`(\\$${highlight}\\b)`, "i")) : [text];
  return (
    <div className="card p-5 relative overflow-hidden">
      <div className="flex items-center gap-3">
        <Avatar name={name} size={44} />
        <div className="min-w-0">
          <div className="font-semibold flex items-center gap-1.5">{name}{verified && <Verified />}</div>
          <div className="text-mute text-sm">@{username} · {at}</div>
        </div>
        <XIcon size={20} className="ml-auto text-ink" />
      </div>
      <p className="mt-4 text-[19px] leading-snug break-words">{parts.map((p, i) => (i % 2 ? <span key={i} className="text-xblue">{p}</span> : p))}</p>
      {children}
    </div>
  );
}

export function Section({ title, right, children, className = "" }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={className}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[13px] font-mono uppercase tracking-[.14em] text-mute">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="card p-8 text-center text-mute">{children}</div>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl bg-white/[.04] ${className}`} />;
}

export function ErrorNote({ msg }: { msg: string }) {
  return <div className="rounded-xl border border-red/40 bg-red/10 text-red px-4 py-3 text-sm">{msg}</div>;
}

export function A({ href, children, className = "" }: { href: string; children: React.ReactNode; className?: string }) {
  return <Link href={href} className={className}>{children}</Link>;
}
