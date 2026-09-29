"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { BountyStatus, CheckResult } from "@bountypad/shared";
import { STATUS } from "@/lib/format";

/** The Bounty Pad mark (from the Higgsfield concept): a target reticle around a verified check. */
export function LogoMark({ size = 28 }: { size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/logo.svg" width={size} height={size} alt="" aria-hidden className="shrink-0" />;
}

/** Mark + wordmark. */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <span className="flex items-center gap-3">
      <LogoMark size={size} />
      <span className="font-medium tracking-[-0.03em] text-[18px] leading-none text-ink">Bounty Pad</span>
    </span>
  );
}

/**
 * A coin's picture, used as a cover (cards, token page). Without an uploaded image it falls
 * back to a soft colour field with the ticker, so every coin still has a recognisable face.
 */
export function TokenImage({ name, ticker, src, className = "", rounded = "", textSize = "text-4xl" }: { name: string; ticker: string; src?: string | null; className?: string; rounded?: string; textSize?: string }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={name} onError={() => setBroken(true)} className={`${rounded} object-cover bg-panel ${className}`} />;
  }
  return (
    <div className={`${rounded} flex items-center justify-center bg-panel-3 ${className}`}>
      <span className={`font-mono tracking-tight text-mute ${textSize}`}>${ticker}</span>
    </div>
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

function hash(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

/** Initials, generated from the name. Real avatars come from X in REAL mode. */
export function Avatar({ name, src, size = 40, square = false }: { name: string; src?: string | null; size?: number; square?: boolean }) {
  const [broken, setBroken] = useState(false);
  const shape = square ? "" : "rounded-full";
  const initials = name.replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  if (src && !broken) return <img src={src} alt={name} width={size} height={size} onError={() => setBroken(true)} className={`${shape} object-cover shrink-0 bg-panel-2`} style={{ width: size, height: size }} />;
  return (
    <div className={`${shape} shrink-0 flex items-center justify-center font-medium text-ink bg-panel-3 border border-line-2`} style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {initials}
    </div>
  );
}

const TONE = {
  green: "text-green border-green/30",
  gold: "text-gold border-gold/30",
  blue: "text-xblue border-xblue/30",
  mute: "text-mute border-line-2",
  red: "text-red border-red/40",
};
const DOT = { green: "bg-green", gold: "bg-gold", blue: "bg-xblue", mute: "bg-dim", red: "bg-red" };

export function StatusPill({ status, big = false }: { status: BountyStatus; big?: boolean }) {
  const s = STATUS[status];
  const live = ["DETECTED_CONFIRMING", "VOTING", "CHALLENGE_WINDOW"].includes(status);
  return (
    <span className={`inline-flex items-center gap-2 border font-mono uppercase tracking-[.06em] whitespace-nowrap ${big ? "h-8 px-3 text-[12px]" : "h-6 px-2 text-[10.5px]"} ${TONE[s.tone]}`}>
      <span className={`w-1.5 h-1.5 ${DOT[s.tone]} ${live ? "live-dot" : ""}`} />
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

export function Sparkline({ points, height = 64, color = "#f2f1ee" }: { points: number[]; height?: number; color?: string }) {
  if (points.length < 2) return <div style={{ height }} />;
  const w = 600, max = Math.max(...points), min = Math.min(...points);
  const xy = points.map((p, i) => [(i / (points.length - 1)) * w, height - 4 - ((p - min) / (max - min || 1)) * (height - 10)]);
  const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const id = "sg" + hash(color + points.length);
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".18" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={`${d} L${w} ${height} L0 ${height} Z`} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
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
              <div className={`w-8 h-8 border flex items-center justify-center transition-all duration-500 ${done ? "bg-ink border-ink" : on ? "border-ink" : "border-line-2"}`}>
                {done ? <svg width="14" height="14" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#101010" strokeWidth="3" strokeLinecap="square" /></svg>
                  : <span className={`w-1.5 h-1.5 ${on ? "bg-green live-dot" : "bg-dim"}`} />}
              </div>
              <span className={`font-mono uppercase text-[10px] tracking-[.06em] whitespace-nowrap ${done || on ? "text-ink" : "text-dim"}`}>{s.label}</span>
            </div>
            {i < steps.length - 1 && <div className="flex-1 h-px mx-1 -mt-6 relative bg-line-2 overflow-hidden"><div className="absolute inset-y-0 left-0 bg-ink transition-all duration-700" style={{ width: idx < cur || status === "PAID" ? "100%" : "0%" }} /></div>}
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
        <div key={c.id} className="flex items-center gap-3 border border-line bg-panel px-4 h-12">
          <span className={`w-5 h-5 flex items-center justify-center border ${c.pass ? "border-green text-green" : "border-red text-red"}`}>
            {c.pass ? <svg width="11" height="11" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="square" /></svg>
              : <svg width="9" height="9" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="3.4" /></svg>}
          </span>
          <span className="text-[15px]">{c.label}</span>
          <span className={`ml-auto font-mono uppercase tracking-[.06em] text-[10.5px] ${c.pass ? "text-green" : "text-red"}`}>{c.pass ? "passed" : c.detail ?? "failed"}</span>
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
      <p className="mt-4 text-[18px] leading-snug break-words">{parts.map((p, i) => (i % 2 ? <span key={i} className="text-xblue">{p}</span> : p))}</p>
      {children}
    </div>
  );
}

export function Section({ title, right, children, className = "" }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={className}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="h2">{title}</h2>
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
  return <div className={`animate-pulse bg-panel-2 ${className}`} />;
}

export function ErrorNote({ msg }: { msg: string }) {
  return <div className="border border-red/40 bg-red/10 text-red px-4 py-3 text-sm">{msg}</div>;
}

export function A({ href, children, className = "" }: { href: string; children: React.ReactNode; className?: string }) {
  return <Link href={href} className={className}>{children}</Link>;
}

/** "+" crosshairs on the corners of a framed block (the grid joints). */
export function Crosses({ only }: { only?: ("tl" | "tr" | "bl" | "br")[] }) {
  return <>{(only ?? ["tl", "tr", "bl", "br"]).map((k) => <span key={k} aria-hidden className={`cross cross-${k}`} />)}</>;
}

/** Corner brackets around a focused object. Put inside a `relative` element. */
export function Brackets() {
  return <>{["tl", "tr", "bl", "br"].map((k) => <span key={k} aria-hidden className={`bk bk-${k}`} />)}</>;
}

/** Split button: a label and a square "+" segment. */
export function SplitButton({ href, children, onClick, glyph = "+" }: { href?: string; children: React.ReactNode; onClick?: () => void; glyph?: string }) {
  const inner = <><span className="px-5 text-[14px] font-medium">{children}</span><span className="seg">{glyph}</span></>;
  const cls = "btn-split bg-ink text-[#101010] hover:bg-white transition-colors";
  return href ? <Link href={href} className={cls}>{inner}</Link> : <button onClick={onClick} className={cls}>{inner}</button>;
}

/** A mono label over a value, the data cell used across the grid. */
export function Stat({ label, children, sub, className = "" }: { label: string; children: React.ReactNode; sub?: React.ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="label">{label}</div>
      <div className="num text-[20px] sm:text-[22px] mt-2 truncate">{children}</div>
      {sub && <div className="text-xs text-mute mt-1 truncate">{sub}</div>}
    </div>
  );
}

/** Signed % change, coloured. */
export function Change({ pct, className = "" }: { pct: number | null | undefined; className?: string }) {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return <span className={`num text-dim ${className}`}>—</span>;
  const up = pct >= 0;
  return <span className={`num ${up ? "text-green" : "text-red"} ${className}`}>{up ? "+" : ""}{pct.toFixed(Math.abs(pct) < 10 ? 2 : 1)}%</span>;
}
