"use client";
import Link from "next/link";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { FeedEvent, Stats, TokenSummary } from "@bountypad/shared";
import { useEvents, useHealth, useLive } from "@/lib/api";
import { actionText, fmtUsd, sol } from "@/lib/format";
import { Avatar, Counter, Empty, Section, Skeleton, StatusPill, XIcon } from "@/components/ui";
import { FeedItem, TokenCard, feedText } from "@/components/cards";
import { Hero3D } from "@/components/Hero3D";

const ease = [0.2, 0.8, 0.2, 1] as const;
const rise = (delay: number) => ({ initial: { opacity: 0, y: 22, filter: "blur(10px)" }, animate: { opacity: 1, y: 0, filter: "blur(0px)" }, transition: { delay, duration: 0.8, ease } });

const STEPS = [
  { img: "/brand/coin-stack.webp", title: "Launch a coin", body: "Name, ticker, image. It goes live on a Meteora bonding curve in one signature." },
  { img: "/brand/cashtag-bubble.webp", title: "Name anyone on X", body: "Pick the person and the challenge: post the cashtag, the contract, quote the launch, or say a phrase on video." },
  { img: "/brand/vault-lock.webp", title: "Fees lock on-chain", body: "Every trade feeds a pot held by our escrow program. It only moves by the program's rules." },
  { img: "/brand/verified-badge.webp", title: "They do it, they get paid", body: "We watch X, verify the post, wait out a public challenge window, and the escrow pays their wallet." },
];

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
  const top = tokens?.find((t) => ["OPEN", "DETECTED_CONFIRMING", "VOTING"].includes(t.bounty.status)) ?? tokens?.[0];

  return (
    <div className="flex flex-col gap-24 sm:gap-32">
      {/* ---------- hero ---------- */}
      <section className="grid lg:grid-cols-[1.05fr_1fr] gap-10 lg:gap-6 items-center pt-2 sm:pt-8">
        <div className="min-w-0 text-center lg:text-left flex flex-col items-center lg:items-start">
          <motion.div {...rise(0)} className="inline-flex items-center gap-2 rounded-full border border-line bg-white/[.03] pl-3 pr-4 py-1.5 text-sm text-mute">
            <span className="live-dot" /> Every meme coin is a public challenge
          </motion.div>
          <motion.h1 {...rise(0.12)} className="mt-7 text-[52px] sm:text-[84px] lg:text-[96px] leading-[.95] font-semibold tracking-[-0.055em] text-balance">
            Make them <span className="serif-accent gold-text pr-1 text-[1.08em]">earn</span>&nbsp;it.
          </motion.h1>
          <motion.p {...rise(0.28)} className="mt-7 text-mute text-lg sm:text-xl max-w-xl leading-relaxed">
            Launch a meme coin, name anyone on <XIcon size={18} className="inline -mt-1 text-ink" />, set the challenge. Trading fees fill a pot locked on Solana. They get it only when they do it, verified automatically.
          </motion.p>
          <motion.div {...rise(0.42)} className="flex flex-wrap justify-center lg:justify-start gap-3 mt-9">
            <Link href="/launch" className="btn btn-primary h-14 px-7 text-[17px]">Launch a coin <span aria-hidden>→</span></Link>
            <a href="#bounties" className="btn btn-ghost h-14 px-7 text-[17px]">Browse live bounties</a>
          </motion.div>
          <motion.div {...rise(0.56)} className="flex flex-wrap justify-center lg:justify-start gap-x-6 gap-y-2 mt-10 text-[13px] font-mono text-dim">
            <span className="flex items-center gap-2"><Dot c="#3dffa2" />Escrow program on Solana</span>
            <span className="flex items-center gap-2"><Dot c="#f7c75a" />Meteora bonding curve</span>
            <span className="flex items-center gap-2"><Dot c="#1d9bf0" />2 of 3 verifier signatures</span>
          </motion.div>
        </div>

        <div className="relative">
          <Hero3D />
          {/* live pot card: the biggest open challenge, floating over the scene */}
          {top && (
            <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.1, duration: 0.8, ease }}
              className="relative z-20 mx-auto -mt-6 sm:mt-0 sm:absolute sm:mx-0 sm:right-2 sm:bottom-2 w-[min(330px,100%)]">
              <Link href={`/token/${top.token.id}`} className="glass rounded-[22px] p-4 flex flex-col gap-3 hover:border-green/30 transition-colors">
                <div className="flex items-center gap-3">
                  <Avatar name={top.target.name} src={top.target.avatarUrl} size={36} />
                  <div className="min-w-0 text-sm">
                    <div className="font-semibold truncate">@{top.target.username} <span className="text-xblue font-medium">${top.token.ticker}</span></div>
                    <div className="text-mute truncate">{actionText(top.bounty.action, top.token.ticker, top.bounty.phrase)}</div>
                  </div>
                </div>
                <div className="flex items-end justify-between">
                  <div>
                    <div className="eyebrow !text-[10px]">Pot, locked</div>
                    <Counter value={sol(top.bounty.potLamports)} format={(v) => v.toFixed(3)} className="gold-text text-[30px] font-bold tracking-tight leading-none" />
                    <span className="text-gold/80 font-semibold ml-1.5">SOL</span>
                  </div>
                  <StatusPill status={top.bounty.status} />
                </div>
              </Link>
            </motion.div>
          )}
        </div>
      </section>

      {/* ---------- numbers (Glassnode-style data row) ---------- */}
      <section className="card !rounded-[26px] grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-line overflow-hidden">
        {[
          { label: "Locked in pots", v: stats ? sol(stats.lockedLamports) : 0, f: (n: number) => n.toFixed(3), unit: "SOL", sub: stats ? "≈ " + fmtUsd(sol(stats.lockedLamports) * solUsd) : "", gold: true },
          { label: "Paid to people", v: stats ? sol(stats.paidLamports) : 0, f: (n: number) => n.toFixed(3), unit: "SOL", sub: stats ? "≈ " + fmtUsd(sol(stats.paidLamports) * solUsd) : "" },
          { label: "Live challenges", v: stats?.liveCoins ?? 0, f: (n: number) => Math.round(n).toString(), unit: "", sub: "watched on X right now" },
          { label: "Bounties completed", v: stats?.bountiesPaid ?? 0, f: (n: number) => Math.round(n).toString(), unit: "", sub: "verified and paid" },
        ].map((s) => (
          <div key={s.label} className="p-6 sm:p-7">
            <div className="eyebrow">{s.label}</div>
            <div className="mt-3 flex items-baseline gap-1.5">
              <Counter value={s.v} format={s.f} className={`text-[30px] sm:text-[40px] font-semibold tracking-[-0.04em] tabular ${s.gold ? "gold-text" : ""}`} />
              {s.unit && <span className={`font-semibold ${s.gold ? "text-gold/80" : "text-mute"}`}>{s.unit}</span>}
            </div>
            <div className="text-dim text-sm mt-1">{s.sub}</div>
          </div>
        ))}
      </section>

      {/* ---------- how it works ---------- */}
      <section>
        <div className="flex flex-col items-center text-center">
          <div className="eyebrow">How it works</div>
          <h2 className="mt-4 text-[38px] sm:text-[56px] font-semibold tracking-[-0.045em] leading-[1.02] max-w-3xl text-balance">
            A challenge anyone can see. <span className="serif-accent text-mute">A pot nobody can touch.</span>
          </h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-14">
          {STEPS.map((s, i) => (
            <motion.div key={s.title} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }} transition={{ delay: i * 0.1, duration: 0.7, ease }}
              className="card card-hover p-6 flex flex-col relative overflow-hidden group">
              <div className="absolute -right-8 -top-8 w-40 h-40 rounded-full bg-[radial-gradient(circle,rgba(247,199,90,.10),transparent_70%)]" />
              <span className="step-num w-fit">0{i + 1}</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.img} alt="" width={120} height={120} className="w-28 h-28 mt-4 mb-2 self-center drop transition-transform duration-500 group-hover:-translate-y-2 group-hover:rotate-3" />
              <h3 className="text-xl font-semibold tracking-tight mt-2">{s.title}</h3>
              <p className="text-mute text-[15px] leading-relaxed mt-2">{s.body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ---------- trade ticker ---------- */}
      {trades.length > 3 && (
        <div className="relative overflow-hidden border-y border-line py-3 -mx-4 sm:-mx-6 -my-12">
          <div className="marquee flex gap-8 w-max whitespace-nowrap text-sm font-mono">
            {[...trades, ...trades].map((t, i) => (
              <span key={i} className={(t.data as any).side === "BUY" ? "text-green" : "text-red"}>
                {feedText(t)}{health?.chain !== "solana" && <span className="text-gold"> +{(Number((t.data as any).potLamports) / 1e9).toFixed(4)} to pot</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ---------- live bounties + feed ---------- */}
      <div id="bounties" className="grid lg:grid-cols-[1fr_380px] gap-8 scroll-mt-24">
        <Section title="Live bounties" right={
          <div className="flex gap-1 text-sm p-1 rounded-xl border border-line bg-white/[.02]">
            {(["pot", "new"] as const).map((s) => (
              <button key={s} onClick={() => setSort(s)} className={`px-3 py-1 rounded-lg transition-colors ${sort === s ? "bg-white/[.08] text-ink" : "text-mute hover:text-ink"}`}>{s === "pot" ? "Biggest pots" : "Newest"}</button>
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

      {/* ---------- why on-chain ---------- */}
      <section className="grid lg:grid-cols-[1fr_1.1fr] gap-10 items-center">
        <div>
          <div className="eyebrow">Why it's different</div>
          <h2 className="mt-4 text-[38px] sm:text-[52px] font-semibold tracking-[-0.045em] leading-[1.02] text-balance">
            Not a payment app. <span className="serif-accent text-green">An escrow.</span>
          </h2>
          <p className="text-mute text-lg mt-5 max-w-lg leading-relaxed">No money is sent to people who never agreed to anything. The challenge is their consent, the chain is the custodian, and the payout works in every country.</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {[
            ["Locked by a program", "Pots sit in an on-chain escrow. Only 2 of 3 verifier signatures plus a public challenge window can release them."],
            ["Written once, never edited", "Target, challenge and deadline are stored on-chain at launch."],
            ["Nobody profits from failure", "Missed deadlines burn the pot: it buys the coin and burns it. Holders never get it."],
            ["Paid anywhere", "A Solana wallet tied to their X login. No bank, no country list."],
          ].map(([t, b]) => (
            <div key={t} className="card p-5">
              <div className="font-semibold flex items-center gap-2"><Dot c="#3dffa2" />{t}</div>
              <p className="text-mute text-[15px] mt-2 leading-relaxed">{b}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- final CTA ---------- */}
      <section className="card relative overflow-hidden !rounded-[32px] px-6 py-16 sm:py-20 text-center">
        <div className="halo opacity-80" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/coin-tilt.webp" alt="" width={160} height={160} className="bob drop absolute -left-6 sm:left-10 top-6 w-24 sm:w-36 opacity-90" style={{ ["--r" as string]: "-12deg" }} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/verified-badge.webp" alt="" width={140} height={140} className="bob drop absolute -right-4 sm:right-12 bottom-6 w-20 sm:w-32 opacity-90" style={{ ["--r" as string]: "10deg", ["--delay" as string]: "-2s" }} />
        <div className="relative">
          <h2 className="text-[40px] sm:text-[64px] font-semibold tracking-[-0.05em] leading-[.98] text-balance">
            Who should <span className="serif-accent gold-text pr-1">earn</span> yours?
          </h2>
          <p className="text-mute text-lg mt-5">One signature. The challenge is live in seconds.</p>
          <Link href="/launch" className="btn btn-primary h-14 px-8 text-[17px] mt-9">Launch a coin <span aria-hidden>→</span></Link>
        </div>
      </section>
    </div>
  );
}

function Dot({ c }: { c: string }) {
  return <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: c, boxShadow: `0 0 10px ${c}` }} />;
}
