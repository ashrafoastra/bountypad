"use client";
/**
 * The hero's signature object: a targeting reticle that locks onto the live challenges with the
 * biggest pots, one after another (real coins only). With no coin yet it keeps scanning.
 * A background film (NEXT_PUBLIC_HERO_VIDEO) plays behind the instrument when one is set.
 */
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import type { TokenSummary } from "@bountypad/shared";
import { actionText, fmtUsd, sol } from "@/lib/format";
import { EASE } from "./motion";
import { PotField } from "./PotField";

const HERO_VIDEO = process.env.NEXT_PUBLIC_HERO_VIDEO || "";
const LIVE = ["OPEN", "DETECTED_CONFIRMING", "VOTING", "VERIFIED", "CHALLENGE_WINDOW"];
const STATUS_WORD: Record<string, string> = {
  OPEN: "Watching X", DETECTED_CONFIRMING: "Post found · rechecking", VOTING: "Holders voting",
  VERIFIED: "Verified", CHALLENGE_WINDOW: "Verified · claim open",
};

export function TargetLock({ items, solUsd }: { items: TokenSummary[] | undefined; solUsd: number }) {
  const reduce = useReducedMotion();
  const targets = useMemo(() => (items ?? []).filter((s) => LIVE.includes(s.bounty.status)).slice(0, 5), [items]);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (targets.length < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % targets.length), 5200);
    return () => clearInterval(t);
  }, [targets.length]);
  const cur = targets.length ? targets[i % targets.length] : null;
  const pot = cur ? sol(cur.bounty.potLamports) : 0;

  return (
    <div className="relative h-full min-h-[420px] sm:min-h-[520px] overflow-hidden bg-[#0c0c0c] select-none">
      {HERO_VIDEO && (
        <video className="absolute inset-0 w-full h-full object-cover opacity-45 grayscale-[35%]" src={HERO_VIDEO} autoPlay muted loop playsInline preload="metadata" />
      )}
      {/* fine measuring grid */}
      <div aria-hidden className="absolute inset-0 bg-[linear-gradient(to_right,#1a1a19_1px,transparent_1px),linear-gradient(to_bottom,#1a1a19_1px,transparent_1px)] bg-[size:32px_32px] opacity-70" />
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,#0c0c0c_78%)]" />

      {/* scan line */}
      {!reduce && (
        <motion.div aria-hidden className="absolute left-0 right-0 h-24 bg-gradient-to-b from-transparent via-white/[0.035] to-transparent"
          initial={{ top: "-15%" }} animate={{ top: "110%" }} transition={{ duration: 4.8, repeat: Infinity, ease: "linear" }} />
      )}

      {/* the pot: a living sphere of points, fed by streams of trades */}
      <PotField className="absolute inset-0" />

      {/* the reticle */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] sm:w-[360px] sm:h-[360px]">
        {/* locking brackets: fly in from wide to tight on every new target */}
        <AnimatePresence mode="popLayout">
          <motion.div key={cur?.token.id ?? "scan"} className="absolute inset-[27%]"
            initial={reduce ? false : { scale: 1.9, opacity: 0, rotate: -12 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} exit={{ scale: 0.7, opacity: 0 }}
            transition={{ duration: 1.1, ease: EASE }}>
            {cur && (["tl", "tr", "bl", "br"] as const).map((k) => (
              <span key={k} className={`absolute w-5 h-5 border-ink ${k[0] === "t" ? "top-0 border-t" : "bottom-0 border-b"} ${k[1] === "l" ? "left-0 border-l" : "right-0 border-r"}`} />
            ))}
            <div className={`absolute inset-[10%] overflow-hidden ${cur ? "bg-panel-2" : ""}`}>
              {cur?.target.avatarUrl ? (
                <motion.img src={cur.target.avatarUrl} alt="" className="w-full h-full object-cover"
                  initial={reduce ? false : { filter: "grayscale(1) contrast(1.2)", scale: 1.15 }} animate={{ filter: "grayscale(0) contrast(1)", scale: 1 }} transition={{ duration: 1.6, delay: 0.5, ease: EASE }} />
              ) : cur ? (
                <div className="w-full h-full flex items-center justify-center text-[40px] tracking-[-0.04em] text-mute">{cur.target.name.slice(0, 1)}</div>
              ) : null}
            </div>
          </motion.div>
        </AnimatePresence>
        {/* the HUD tag: a leader line from the lock to the name */}
        <AnimatePresence mode="wait">
          {cur && (
            <motion.div key={`tag-${cur.token.id}`} className="absolute left-[73%] top-[16%] flex items-start pointer-events-none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4, delay: reduce ? 0 : 0.9 }}>
              <motion.svg width="46" height="30" className="text-ink/60 shrink-0" initial={{ pathLength: 0 }} aria-hidden>
                <motion.path d="M0 30 L22 8 L46 8" fill="none" stroke="currentColor" strokeWidth="1" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6, delay: reduce ? 0 : 1, ease: EASE }} />
              </motion.svg>
              <div className="-mt-0.5 pl-1.5 font-mono text-[10px] uppercase tracking-[.08em] whitespace-nowrap leading-[1.6]">
                <div className="text-ink">@{cur.target.username}</div>
                <div className="text-dim">${cur.token.ticker} · {pot.toFixed(3)} SOL</div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* readouts */}
      <div className="absolute left-4 top-4 sm:left-6 sm:top-6 font-mono text-[10.5px] uppercase tracking-[.08em] text-dim leading-[1.9]">
        <div className="flex items-center gap-2 text-mute"><span className="live-dot" />{cur ? "Target locked" : "Scanning"}</div>
        <div>{cur ? `${String((i % Math.max(1, targets.length)) + 1).padStart(2, "0")} / ${String(targets.length).padStart(2, "0")}` : "00 / 00"}</div>
      </div>
      <div className="absolute right-4 top-4 sm:right-6 sm:top-6 font-mono text-[10.5px] uppercase tracking-[.08em] text-dim text-right leading-[1.9]">
        <div>Solana</div>
        <div>Meteora DBC</div>
      </div>

      <div className="absolute left-0 right-0 bottom-0 border-t border-line bg-[#0c0c0c]/80 backdrop-blur-sm">
        <AnimatePresence mode="wait">
          {cur ? (
            <motion.div key={cur.token.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.6, ease: EASE }}>
              <Link href={`/token/${cur.token.id}`} className="grid grid-cols-[1fr_auto] gap-4 px-4 sm:px-6 py-4 hover:bg-white/[0.02] transition-colors">
                <div className="min-w-0">
                  <div className="font-mono text-[10.5px] uppercase tracking-[.08em] text-dim">@{cur.target.username} · ${cur.token.ticker}</div>
                  <div className="text-[15px] sm:text-[16px] mt-1 truncate">{actionText(cur.bounty.action, cur.token.ticker, cur.bounty.phrase)}</div>
                  <div className="font-mono text-[10.5px] uppercase tracking-[.08em] text-gold mt-1">{STATUS_WORD[cur.bounty.status] ?? cur.bounty.status}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[10.5px] uppercase tracking-[.08em] text-dim">Pot</div>
                  <div className="num text-[22px] sm:text-[26px] leading-none mt-1.5">{pot.toFixed(3)}<span className="text-mute text-[13px] ml-1.5">SOL</span></div>
                  <div className="num text-[11px] text-dim mt-1">{fmtUsd(pot * solUsd)}</div>
                </div>
              </Link>
            </motion.div>
          ) : (
            <motion.div key="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
              <div>
                <div className="font-mono text-[10.5px] uppercase tracking-[.08em] text-dim">No target yet</div>
                <div className="text-[15px] mt-1">The first coin launched becomes the first target.</div>
              </div>
              <Link href="/launch" className="label hover:!text-ink shrink-0">Launch →</Link>
            </motion.div>
          )}
        </AnimatePresence>
        {/* progress to the next target */}
        {targets.length > 1 && !reduce && (
          <motion.div key={`bar-${i}`} className="h-px bg-ink origin-left" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 5.2, ease: "linear" }} />
        )}
      </div>
    </div>
  );
}
