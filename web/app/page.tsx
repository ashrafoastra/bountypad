"use client";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import type { FeedEvent, Stats, TokenSummary } from "@bountypad/shared";
import { useEvents, useHealth, useLive } from "@/lib/api";
import { actionText, countdown, sol } from "@/lib/format";
import { Avatar, Counter, Skeleton, TokenImage, Verified } from "@/components/ui";
import { FeedItem, TokenCard, TokenRow } from "@/components/cards";

const LIVE = ["OPEN", "DETECTED_CONFIRMING", "VOTING"];
type Filter = "all" | "live" | "paid";

export default function HomePage() {
  return <Suspense><Home /></Suspense>;
}

function Home() {
  const q = (useSearchParams().get("q") ?? "").trim().toLowerCase();
  const { data: health } = useHealth();
  const solUsd = health?.solUsd ?? 150;
  const [filter, setFilter] = useState<Filter>("all");
  const { data: stats } = useLive<Stats>("/api/stats", { every: 5000, on: (e) => e.type !== "TRADE" });
  const { data: byPot } = useLive<TokenSummary[]>("/api/tokens?sort=pot", { every: 4000, on: (e) => e.type !== "TRADE" });
  const { data: byNew } = useLive<TokenSummary[]>("/api/tokens?sort=new", { every: 6000, on: (e) => e.type === "TOKEN_LAUNCHED" });
  const { data: initialFeed } = useLive<FeedEvent[]>("/api/feed?limit=12", { every: 60000, on: () => false });
  const [live, setLive] = useState<FeedEvent[]>([]);
  useEvents((e) => { if (e.type !== "TRADE") setLive((l) => [e, ...l].slice(0, 12)); });
  const feed = [...live, ...(initialFeed ?? []).filter((e) => !live.some((l) => l.id === e.id))].slice(0, 8);

  const term = q.replace(/^[$@]/, "");
  const match = (s: TokenSummary) => !term || [s.token.name, s.token.ticker, s.target.username, s.target.name].some((v) => v.toLowerCase().includes(term));
  const top = useMemo(
    () => (byPot ?? []).filter(match).filter((s) => filter === "all" || (filter === "live" ? LIVE.includes(s.bounty.status) : s.bounty.status === "PAID")).slice(0, 10),
    [byPot, filter, term], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const newest = (byNew ?? []).filter(match).slice(0, 5); // one clean row, like a marketplace shelf
  const featured = (byPot ?? []).filter((s) => LIVE.includes(s.bounty.status)).slice(0, 4);

  return (
    <div className="flex flex-col gap-14">
      {!q && <Hero featured={featured} stats={stats} />}

      {q && (
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold truncate">Results for “{q}”</h1>
          <Link href="/" className="btn btn-ghost h-10 text-sm shrink-0">Clear search</Link>
        </div>
      )}

      {/* ---- top bounties (the "Hot collections" table) ---- */}
      <section id="bounties" className="scroll-mt-24">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="text-[22px] font-bold tracking-[-0.02em]">Top bounties</h2>
          <div className="flex items-center gap-1 p-1 rounded-xl bg-panel">
            {(["all", "live", "paid"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`h-8 px-3.5 rounded-lg text-sm font-semibold transition-colors ${filter === f ? "bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,.08)]" : "text-mute hover:text-ink"}`}>
                {f === "all" ? "All" : f === "live" ? "Live" : "Paid"}
              </button>
            ))}
          </div>
        </div>
        <div className="hidden md:grid grid-cols-[36px_minmax(0,2.2fr)_minmax(0,2fr)_130px_150px_110px] gap-4 px-3 pb-2 text-xs font-medium text-mute border-b border-line">
          <span className="text-center">#</span><span>Coin</span><span>Challenge</span><span>Pot</span><span>Status</span><span className="text-right">Time left</span>
        </div>
        {!byPot ? (
          <div className="flex flex-col gap-2 mt-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : top.length === 0 ? (
          <div className="py-14 text-center text-mute">{q ? "No coins match your search." : <>No coins here yet. <Link className="text-ink font-semibold underline" href="/launch">Launch the first one.</Link></>}</div>
        ) : (
          <div className="flex flex-col mt-1">
            {top.map((s, i) => <TokenRow key={s.token.id} s={s} rank={i + 1} solUsd={solUsd} />)}
          </div>
        )}
      </section>

      {/* ---- newest challenges (card grid) ---- */}
      {newest.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[22px] font-bold tracking-[-0.02em]">New challenges</h2>
            <Link href="/launch" className="text-sm font-semibold text-mute hover:text-ink">Launch yours →</Link>
          </div>
          {/* A shelf: swipeable row on phones and tablets, one row of five on desktop. */}
          <div className="flex gap-3 sm:gap-4 overflow-x-auto snap-x snap-mandatory -mx-4 px-4 sm:mx-0 sm:px-0 pb-1 lg:grid lg:grid-cols-5 lg:overflow-visible scrollbar-none">
            {newest.map((s) => <div key={s.token.id} className="w-[46%] sm:w-[31%] lg:w-auto shrink-0 snap-start"><TokenCard s={s} solUsd={solUsd} /></div>)}
          </div>
        </section>
      )}

      {!q && (
        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-10">
          {/* ---- how it works ---- */}
          <section>
            <h2 className="text-[22px] font-bold tracking-[-0.02em] mb-4">How it works</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                ["Launch a coin", "Name, ticker, image. It goes live on a Meteora bonding curve with one signature."],
                ["Name anyone on X", "Choose the challenge: post the cashtag or the contract, quote the launch post, or say a phrase on video."],
                ["Fees are locked", "Part of every trade fills the pot, held by an escrow program on Solana until the challenge is met."],
                ["Verified, then paid", "We detect the post automatically. After a public review window the escrow pays their wallet."],
              ].map(([t, b], i) => (
                <div key={t} className="card p-5">
                  <span className="step-num">{i + 1}</span>
                  <h3 className="font-semibold mt-3">{t}</h3>
                  <p className="text-mute text-sm leading-relaxed mt-1.5">{b}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ---- activity ---- */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[22px] font-bold tracking-[-0.02em]">Activity</h2>
              <span className="flex items-center gap-2 text-xs font-semibold text-mute"><span className="live-dot" />Live</span>
            </div>
            <div className="card p-1.5">
              {feed.length === 0 ? <p className="text-mute p-6 text-center text-sm">Nothing yet.</p> : (
                <AnimatePresence initial={false}>
                  {feed.map((e) => (
                    <motion.div key={e.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} transition={{ duration: 0.25 }}>
                      <FeedItem e={e} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

/** Rarible-style hero: a quiet panel with the pitch on the left and a rotating featured bounty on the right. */
function Hero({ featured, stats }: { featured: TokenSummary[]; stats: Stats | null }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (featured.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % featured.length), 5000);
    return () => clearInterval(t);
  }, [featured.length]);
  const f = featured[i % Math.max(1, featured.length)];

  return (
    <section className="rounded-[24px] bg-panel p-6 sm:p-10 lg:p-14 grid lg:grid-cols-[1fr_440px] gap-10 lg:gap-16 items-center">
      <div className="min-w-0">
        <h1 className="text-[40px] sm:text-[56px] leading-[1.02] font-bold tracking-[-0.035em] text-balance">
          Every meme coin is a challenge.
        </h1>
        <p className="text-mute text-lg mt-5 max-w-xl leading-relaxed">
          Launch a coin and name anyone on X. Trading fees fill a pot that's locked on Solana, and it's theirs only when they complete the challenge.
        </p>
        <div className="grid grid-cols-2 sm:flex gap-3 mt-8">
          <a href="#bounties" className="btn btn-primary h-12 px-4 sm:px-6 whitespace-nowrap"><span className="sm:hidden">Explore</span><span className="hidden sm:inline">Explore bounties</span></a>
          <Link href="/launch" className="btn btn-outline h-12 px-4 sm:px-6 whitespace-nowrap">Launch a coin</Link>
        </div>
        <div className="grid grid-cols-3 gap-6 mt-10 max-w-lg">
          {([
            ["Locked in pots", stats ? sol(stats.lockedLamports) : 0, 3, "SOL"],
            ["Paid out", stats ? sol(stats.paidLamports) : 0, 3, "SOL"],
            ["Live challenges", stats?.liveCoins ?? 0, 0, ""],
          ] as const).map(([label, v, dp, unit]) => (
            <div key={label}>
              <div className="text-[20px] sm:text-[22px] font-bold tabular whitespace-nowrap"><Counter value={v} format={(n) => n.toFixed(dp)} />{unit && <span className="text-sm font-semibold text-mute ml-1">{unit}</span>}</div>
              <div className="text-sm text-mute mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="min-w-0">
        {f ? (
          <>
            <AnimatePresence mode="wait">
              <motion.div key={f.token.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3 }}>
                <Link href={`/token/${f.token.id}`} className="block rounded-[20px] overflow-hidden bg-white shadow-[0_18px_50px_rgba(0,0,0,.10)] group">
                  <div className="relative aspect-[4/3.4] overflow-hidden">
                    <TokenImage name={f.token.name} ticker={f.token.ticker} src={f.token.imageUrl} rounded="" className="w-full h-full transition-transform duration-500 group-hover:scale-[1.03]" textSize="text-5xl" />
                    <div className="absolute inset-x-0 bottom-0 pt-16 p-5 bg-gradient-to-t from-black/75 via-black/35 to-transparent text-white">
                      <div className="text-sm font-medium opacity-90">Featured bounty</div>
                      <div className="text-xl font-bold">{f.token.name} <span className="opacity-80 font-semibold">${f.token.ticker}</span></div>
                    </div>
                  </div>
                  <div className="p-4 flex items-center gap-3">
                    <Avatar name={f.target.name} src={f.target.avatarUrl} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold flex items-center gap-1 truncate">@{f.target.username}{f.target.verified && <Verified size={13} />}</div>
                      <div className="text-sm text-mute truncate">{actionText(f.bounty.action, f.token.ticker, f.bounty.phrase)}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold tabular"><Counter value={sol(f.bounty.potLamports)} format={(v) => v.toFixed(3)} /> SOL</div>
                      <div className="text-xs text-mute">{countdown(f.bounty.deadline)} left</div>
                    </div>
                  </div>
                </Link>
              </motion.div>
            </AnimatePresence>
            {featured.length > 1 && (
              <div className="flex justify-center gap-1.5 mt-5">
                {featured.map((x, k) => (
                  <button key={x.token.id} aria-label={`Show ${x.token.name}`} onClick={() => setI(k)} className={`h-1.5 rounded-full transition-all ${k === i % featured.length ? "w-8 bg-ink" : "w-4 bg-black/15"}`} />
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="rounded-[20px] bg-white p-8 text-center shadow-[0_18px_50px_rgba(0,0,0,.08)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo.svg" alt="" width={64} height={64} className="mx-auto" />
            <p className="font-semibold mt-4">No live challenges yet</p>
            <p className="text-mute text-sm mt-1">Be the first to put a bounty on someone.</p>
            <Link href="/launch" className="btn btn-primary h-11 mt-5">Launch a coin</Link>
          </div>
        )}
      </div>
    </section>
  );
}
