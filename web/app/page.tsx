"use client";
import Link from "next/link";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { FeedEvent, Stats, TokenSummary } from "@bountypad/shared";
import { useEvents, useHealth, useLive } from "@/lib/api";
import { fmtUsd, sol } from "@/lib/format";
import { Counter, Empty, Section, Skeleton, XIcon } from "@/components/ui";
import { FeedItem, TokenCard, feedText } from "@/components/cards";

const WORDS = ["Launch a meme coin.", "Name anyone on", "Set the challenge."];

export default function Home() {
  const { data: health } = useHealth();
  const solUsd = health?.solUsd ?? 150;
  const [sort, setSort] = useState<"pot" | "new">("pot");
  const { data: stats } = useLive<Stats>("/api/stats", { every: 4000, on: (e) => e.type !== "TRADE" || Math.random() < 0.3 });
  const { data: tokens } = useLive<TokenSummary[]>(`/api/tokens?sort=${sort}`, { every: 3000, on: (e) => e.type !== "TRADE" });
  const { data: initialFeed } = useLive<FeedEvent[]>("/api/feed?limit=30", { every: 60000, on: () => false });
  const [live, setLive] = useState<FeedEvent[]>([]);
  useEvents((e) => { if (e.type !== "TRADE") setLive((l) => [e, ...l].slice(0, 30)); });
  const feed = [...live, ...(initialFeed ?? []).filter((e) => !live.some((l) => l.id === e.id))].slice(0, 24);
  const [trades, setTrades] = useState<FeedEvent[]>([]);
  useEvents((e) => { if (e.type === "TRADE") setTrades((t) => [e, ...t].slice(0, 16)); });

  return (
    <div className="flex flex-col gap-14">
      {/* hero */}
      <section className="pt-4 sm:pt-10 text-center flex flex-col items-center">
        <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}
          className="inline-flex items-center gap-2 rounded-full border border-line bg-white/[.03] px-4 py-1.5 text-sm text-mute mb-8">
          <span className="live-dot" /> Every meme coin is a public challenge
        </motion.div>
        <h1 className="text-[40px] sm:text-[76px] leading-[1.02] font-semibold tracking-[-0.04em] max-w-4xl">
          {WORDS.map((w, i) => (
            <motion.span key={i} className="block" initial={{ opacity: 0, filter: "blur(12px)", y: 18 }} animate={{ opacity: i === 2 ? 1 : 0.9, filter: "blur(0px)", y: 0 }} transition={{ delay: 0.15 + i * 0.35, duration: 0.7 }}>
              {i === 1 ? <>{w.replace(" on", "")} <span className="whitespace-nowrap">on <XIcon size={56} className="inline -mt-2 sm:-mt-3 w-[.72em] h-[.72em]" />.</span></> : i === 2 ? <span className="text-green glow-green">{w}</span> : w}
            </motion.span>
          ))}
        </h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.3 }} className="text-mute text-lg sm:text-xl mt-6 max-w-2xl">
          Trading fees fill a locked pot. The person you name gets it only when they do the challenge, verified automatically and paid on-chain.
        </motion.p>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.5 }} className="flex gap-3 mt-8">
          <Link href="/launch" className="btn btn-primary">Launch a coin</Link>
          <a href="#pots" className="btn btn-ghost">See live bounties</a>
        </motion.div>
      </section>

      {/* stats */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Locked in pots", v: stats ? sol(stats.lockedLamports) : 0, f: (n: number) => n.toFixed(3) + " SOL", sub: stats ? "≈ " + fmtUsd(sol(stats.lockedLamports) * solUsd) : "", gold: true },
          { label: "Paid to people", v: stats ? sol(stats.paidLamports) : 0, f: (n: number) => n.toFixed(3) + " SOL", sub: stats ? "≈ " + fmtUsd(sol(stats.paidLamports) * solUsd) : "" },
          { label: "Live challenges", v: stats?.liveCoins ?? 0, f: (n: number) => Math.round(n).toString(), sub: "watching X now" },
          { label: "Bounties completed", v: stats?.bountiesPaid ?? 0, f: (n: number) => Math.round(n).toString(), sub: "verified + paid" },
        ].map((s) => (
          <div key={s.label} className="card p-5">
            <div className="text-mute text-xs font-mono uppercase tracking-widest">{s.label}</div>
            <Counter value={s.v} format={s.f} className={`block mt-2 text-[26px] sm:text-[30px] font-bold tracking-tight ${s.gold ? "text-gold glow-gold" : ""}`} />
            <div className="text-dim text-sm mt-1">{s.sub}</div>
          </div>
        ))}
      </section>

      {/* trade ticker */}
      {trades.length > 3 && (
        <div className="relative overflow-hidden border-y border-line py-3 -mx-4 sm:-mx-6">
          <div className="marquee flex gap-8 w-max whitespace-nowrap text-sm font-mono">
            {[...trades, ...trades].map((t, i) => (
              <span key={i} className={(t.data as any).side === "BUY" ? "text-green" : "text-red"}>
                {feedText(t)} <span className="text-gold">+{(Number((t.data as any).potLamports) / 1e9).toFixed(4)} to pot</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div id="pots" className="grid lg:grid-cols-[1fr_380px] gap-8 scroll-mt-24">
        <Section title="Live bounties" right={
          <div className="flex gap-1 text-sm">
            {(["pot", "new"] as const).map((s) => (
              <button key={s} onClick={() => setSort(s)} className={`px-3 py-1 rounded-lg ${sort === s ? "bg-white/[.07] text-ink" : "text-mute hover:text-ink"}`}>{s === "pot" ? "Biggest pots" : "Newest"}</button>
            ))}
          </div>
        }>
          {!tokens ? (
            <div className="grid sm:grid-cols-2 gap-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-64" />)}</div>
          ) : tokens.length === 0 ? (
            <Empty>No coins yet. <Link className="text-green" href="/launch">Launch the first one.</Link></Empty>
          ) : (
            <motion.div layout className="grid sm:grid-cols-2 gap-4">
              <AnimatePresence>
                {tokens.map((s) => (
                  <motion.div key={s.token.id} layout initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 28 }}>
                    <TokenCard s={s} solUsd={solUsd} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </Section>

        <Section title="Live feed" right={<span className="live-dot" />}>
          <div className="card p-2 max-h-[780px] overflow-y-auto">
            {feed.length === 0 ? <p className="text-mute p-6 text-center">Waiting for activity…</p> : (
              <AnimatePresence initial={false}>
                {feed.map((e) => (
                  <motion.div key={e.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} transition={{ duration: 0.35 }}>
                    <FeedItem e={e} />
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}
