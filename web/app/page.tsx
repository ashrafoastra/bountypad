"use client";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence, useMotionValueEvent, useTransform } from "motion/react";
import type { FeedEvent, Stats, TokenSummary } from "@bountypad/shared";
import { useEvents, useHealth, useLive } from "@/lib/api";
import { actionText, fmtCompact, fmtPrice, fmtUsd, sol, short } from "@/lib/format";
import { Brackets, Change, Counter, Crosses, Skeleton, SplitButton, TokenImage } from "@/components/ui";
import { FeedItem, TokenCard, TokenRow, TokenTableHead } from "@/components/cards";
import { explorer } from "@/lib/chain";
import { TargetLock } from "@/components/TargetLock";
import { EASE, Magnetic, Reveal, SplitWords, Stagger, VelocityMarquee, useSectionProgress, useSpotlight } from "@/components/motion";

const LIVE = ["OPEN", "DETECTED_CONFIRMING", "VOTING"];
type Tab = "trending" | "pot" | "new" | "done";

export default function HomePage() {
  return <Suspense><Home /></Suspense>;
}

function Home() {
  const q = (useSearchParams().get("q") ?? "").trim().toLowerCase();
  const { data: health } = useHealth();
  const solUsd = health?.solUsd ?? 150;
  /** Light mode: no escrow program, the pot waits in each coin's Meteora pool. */
  const light = health?.escrowMode === "pool";
  const [tab, setTab] = useState<Tab>("trending");
  const [view, setView] = useState<"list" | "grid">("list");
  const { data: stats } = useLive<Stats>("/api/stats", { every: 5000, on: (e) => e.type !== "TRADE" });
  const { data: featured } = useLive<TokenSummary[]>("/api/tokens?featured=1", { every: 8000, on: (e) => e.type !== "TRADE" });
  const { data: byTrend } = useLive<TokenSummary[]>("/api/tokens?sort=trending", { every: 6000, on: (e) => e.type !== "TRADE" });
  const { data: byPot } = useLive<TokenSummary[]>("/api/tokens?sort=pot", { every: 6000, on: (e) => e.type !== "TRADE" });
  const { data: byNew } = useLive<TokenSummary[]>("/api/tokens?sort=new", { every: 8000, on: (e) => e.type === "TOKEN_LAUNCHED" });
  const { data: initialFeed } = useLive<FeedEvent[]>("/api/feed?limit=12", { every: 60000, on: () => false });
  const [live, setLive] = useState<FeedEvent[]>([]);
  useEvents((e) => { if (e.type !== "TRADE") setLive((l) => [e, ...l].slice(0, 12)); });
  const feed = [...live, ...(initialFeed ?? []).filter((e) => !live.some((l) => l.id === e.id))].slice(0, 8);

  const term = q.replace(/^[$@]/, "");
  const match = (s: TokenSummary) => !term || [s.token.name, s.token.ticker, s.target.username, s.target.name].some((v) => v.toLowerCase().includes(term));
  const rows = useMemo(() => {
    const src = tab === "new" ? byNew : tab === "trending" ? byTrend : byPot;
    return (src ?? []).filter(match).filter((s) => tab === "done" ? s.bounty.status === "PAID" : tab === "new" ? true : s.bounty.status !== "PAID").slice(0, 25);
  }, [byTrend, byPot, byNew, tab, term]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = byPot?.length ?? 0;
  const official = (featured ?? []).filter(match);

  return (
    <div className="flex flex-col gap-20 sm:gap-28">
      {!q && <Hero stats={stats} light={light} targets={byPot ?? undefined} solUsd={solUsd} />}
      {!q && <LiveTape items={byTrend ?? undefined} />}

      {official.length > 0 && <Official items={official} solUsd={solUsd} />}

      <section id="challenges" className="scroll-mt-24">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <div className="label mb-3">{q ? "Search" : "01 · Market"}</div>
            <h2 className="h2">{q ? <>Results for “{q}”</> : "Challenges"}</h2>
          </div>
          <div className="flex items-center gap-3">
            {q && <Link href="/" className="btn btn-outline h-8 text-[13px]">Clear</Link>}
            <div className="seg-group">
              {([["trending", "Trending"], ["pot", "Top pot"], ["new", "Newest"], ["done", "Completed"]] as const).map(([k, l]) => (
                <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
              ))}
            </div>
            <div className="seg-group hidden sm:inline-flex" aria-label="View">
              <button className={view === "list" ? "on" : ""} onClick={() => setView("list")} aria-label="List view">List</button>
              <button className={view === "grid" ? "on" : ""} onClick={() => setView("grid")} aria-label="Grid view">Grid</button>
            </div>
          </div>
        </div>

        {!byPot || !byTrend ? (
          <div className="frame"><Crosses />{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[68px] border-b border-line" />)}</div>
        ) : total === 0 && !q ? (
          <EmptyMarket hasOfficial={official.length > 0} />
        ) : rows.length === 0 ? (
          <div className="frame py-16 text-center text-mute"><Crosses />{q ? "No coins match your search." : tab === "done" ? "No challenge has been completed yet." : "Nothing here yet."}</div>
        ) : view === "grid" ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {rows.map((s) => <TokenCard key={s.token.id} s={s} solUsd={solUsd} />)}
          </div>
        ) : (
          <div className="frame"><Crosses /><TokenTableHead />{rows.map((s, i) => <TokenRow key={s.token.id} s={s} rank={i + 1} solUsd={solUsd} />)}</div>
        )}
      </section>

      {!q && (
        <>
          <Compare light={light} />
          <HowItWorks light={light} />
          <Rules light={light} programId={health?.escrowProgram ?? null} explorerHref={health?.escrowProgram ? explorer(health, "account", health.escrowProgram) : null} />
          {feed.length > 0 && (
            <section>
              <div className="flex items-end justify-between mb-6">
                <div><Reveal><div className="label mb-4">05 · Live</div></Reveal><h2 className="display text-[44px] sm:text-[72px]"><SplitWords lines={["Activity"]} /></h2></div>
                <span className="flex items-center gap-2 label"><span className="live-dot" />Streaming</span>
              </div>
              <div className="frame"><Crosses />
                <AnimatePresence initial={false}>
                  {feed.map((e) => (
                    <motion.div key={e.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} transition={{ duration: 0.25 }}>
                      <FeedItem e={e} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </section>
          )}
          <section className="-mx-4 sm:-mx-8 border-y border-line overflow-hidden">
            <VelocityMarquee base={60} className="py-8 sm:py-12">
              {["Make them earn it", "Name someone", "Set the challenge", "Paid for the action"].map((t, i) => (
                <span key={t} className={`display text-[64px] sm:text-[128px] whitespace-nowrap px-8 ${i % 2 ? "text-outline" : ""}`}>{t}<span className="text-dim mx-10 font-light">+</span></span>
              ))}
            </VelocityMarquee>
            <div className="border-t border-line max-w-[1320px] mx-auto px-4 sm:px-8 py-10 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
              <p className="text-mute text-[17px] max-w-md">Pick anyone on X, one fixed action and a deadline. The pot starts filling with the first trade.</p>
              <Magnetic><SplitButton href="/launch">Launch a coin</SplitButton></Magnetic>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ hero */

function Hero({ stats, light, targets, solUsd }: { stats: Stats | null; light: boolean; targets: TokenSummary[] | undefined; solUsd: number }) {
  return (
    <section className="relative">
      <div className="frame grid lg:grid-cols-[1.18fr_1fr] overflow-hidden">
        <Crosses />
        <div className="relative p-6 sm:p-10 lg:p-14 flex flex-col justify-between gap-14 lg:border-r border-line min-w-0">
          <div>
            <motion.div className="label flex items-center gap-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1, delay: 0.1 }}>
              <span className="w-6 h-px bg-mute" />Solana · Meteora bonding curve · {light ? "Pot held on-chain" : "On-chain escrow"}
            </motion.div>
            <h1 className="display text-[60px] sm:text-[96px] lg:text-[118px] mt-9">
              <SplitWords trigger="mount" delay={0.15} lines={["Make them", "earn it."]} lineClass={["", "text-mute"]} />
            </h1>
            <motion.p className="text-mute text-[17px] sm:text-lg mt-9 max-w-xl leading-relaxed" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.1, delay: 0.7, ease: EASE }}>
              Launch a meme coin with a challenge for anyone on X. Every trade adds to a pot {light ? "held on Solana in the coin's own pool" : "locked in an escrow program"},
              and it pays out <span className="text-ink">only when they do it</span>, verified automatically.
            </motion.p>
          </div>
          <motion.div className="flex flex-wrap items-center gap-3" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.1, delay: 0.85, ease: EASE }}>
            <Magnetic><SplitButton href="/launch">Launch a coin</SplitButton></Magnetic>
            <Magnetic strength={0.2}><a href="#how" className="btn btn-outline">How it works</a></Magnetic>
          </motion.div>
        </div>
        <motion.div className="border-t lg:border-t-0 border-line" initial={{ opacity: 0, clipPath: "inset(0 0 100% 0)" }} animate={{ opacity: 1, clipPath: "inset(0 0 0% 0)" }} transition={{ duration: 1.4, delay: 0.3, ease: EASE }}>
          <TargetLock items={targets} solUsd={solUsd} />
        </motion.div>
      </div>

      {/* real numbers only: zero until something happens */}
      <div className="frame border-t-0 grid grid-cols-2 lg:grid-cols-4">
        <Crosses only={["bl", "br"]} />
        {([
          [light ? "Waiting in pots" : "Locked in escrow", stats ? sol(stats.lockedLamports) : 0, 3, "SOL"],
          ["Paid for actions", stats ? sol(stats.paidLamports) : 0, 3, "SOL"],
          ["Live challenges", stats?.liveCoins ?? 0, 0, ""],
          ["Completed", stats?.bountiesPaid ?? 0, 0, ""],
        ] as const).map(([label, v, dp, unit], i) => (
          <motion.div key={label} className={`p-5 sm:p-8 border-line ${i % 2 ? "border-l" : ""} ${i >= 2 ? "border-t lg:border-t-0" : ""} ${i === 2 ? "lg:border-l" : ""}`}
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, delay: 1 + i * 0.08, ease: EASE }}>
            <div className="label">{label}</div>
            <div className="num text-[26px] sm:text-[36px] mt-3 whitespace-nowrap tracking-[-0.04em]"><Counter value={v} format={(n) => n.toFixed(dp)} />{unit && <span className="text-mute text-sm sm:text-base ml-2">{unit}</span>}</div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/** A tape of the live challenges (real coins only), drifting with the scroll. */
function LiveTape({ items }: { items: TokenSummary[] | undefined }) {
  const live = (items ?? []).filter((s) => LIVE.includes(s.bounty.status)).slice(0, 12);
  if (live.length < 2) return null;
  return (
    <div className="-mx-4 sm:-mx-8 border-y border-line bg-[#0c0c0c] py-3.5">
      <VelocityMarquee base={34}>
        {live.map((s) => (
          <Link key={s.token.id} href={`/token/${s.token.id}`} className="flex items-center gap-3 px-6 font-mono text-[12px] uppercase tracking-[.06em] text-mute hover:text-ink transition-colors whitespace-nowrap">
            <span className="text-ink">${s.token.ticker}</span>
            <span className="text-dim">→</span>
            <span>@{s.target.username}</span>
            <span className="num text-ink normal-case">{sol(s.bounty.potLamports).toFixed(3)} SOL</span>
            <span className="text-dim pl-3">+</span>
          </Link>
        ))}
      </VelocityMarquee>
    </div>
  );
}

function EmptyMarket({ hasOfficial }: { hasOfficial: boolean }) {
  return (
    <div className="frame grid md:grid-cols-[1fr_auto] items-center gap-8 px-6 sm:px-10 py-14">
      <Crosses />
      <div>
        <div className="text-[22px] sm:text-[26px] tracking-[-0.02em]">{hasOfficial ? "Be the first community challenge." : "No challenges yet."}</div>
        <p className="text-mute mt-2 max-w-xl leading-relaxed">Every coin launched here is listed automatically, and the most traded ones rise to the top by themselves. Pick the person, the action and the deadline: the pot starts filling with the first trade.</p>
      </div>
      <div><SplitButton href="/launch">Launch a coin</SplitButton></div>
    </div>
  );
}

/** The platform's own coin, pinned above the market (set by an admin: npm run admin -w api -- feature <mint>). */
function Official({ items, solUsd }: { items: TokenSummary[]; solUsd: number }) {
  return (
    <section>
      <div className="flex items-end justify-between mb-6">
        <div><div className="label mb-3">Official</div><h2 className="h2">The Bounty Pad coin</h2></div>
      </div>
      <div className="flex flex-col gap-4">
        {items.map((s) => {
          const pot = sol(s.bounty.potLamports);
          return (
            <Link key={s.token.id} href={`/token/${s.token.id}`} className="frame grid md:grid-cols-[auto_1fr_auto] items-center gap-6 p-5 sm:p-6 hover:bg-panel transition-colors">
              <Crosses />
              <div className="brackets p-1.5 w-fit"><Brackets /><TokenImage name={s.token.name} ticker={s.token.ticker} src={s.token.imageUrl} className="w-24 h-24" textSize="text-sm" /></div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[26px] tracking-[-0.03em]">{s.token.name}</span>
                  <span className="font-mono text-sm text-mute">${s.token.ticker}</span>
                  <span className="label border border-line-2 px-2 h-6 inline-flex items-center !text-ink">Official</span>
                </div>
                <div className="text-mute text-sm mt-2 truncate">Challenge for @{s.target.username}: {actionText(s.bounty.action, s.token.ticker, s.bounty.phrase)}</div>
              </div>
              <div className="grid grid-cols-4 gap-6 md:gap-8">
                <div><div className="label !text-[10px]">Price</div><div className="num mt-1.5">{fmtPrice(s.market.priceSol)}</div></div>
                <div><div className="label !text-[10px]">24h</div><div className="mt-1.5"><Change pct={s.market.change24h} /></div></div>
                <div><div className="label !text-[10px]">MCap</div><div className="num mt-1.5">{s.market.marketCapSol === null ? "—" : fmtCompact(s.market.marketCapSol)}</div></div>
                <div><div className="label !text-[10px]">Pot</div><div className="num mt-1.5">{pot.toFixed(3)}</div><div className="num text-[11px] text-dim">{fmtUsd(pot * solUsd)}</div></div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ positioning */

const COMPARE: [string, string, string][] = [
  ["What triggers a payout", "Nothing. Fees go to whoever the coin names.", "A public action by the person named, verified."],
  ["Consent", "None. People are paid without being asked.", "The action is the opt-in. Anyone can opt out."],
  ["Where the money waits", "A custodial treasury, an exchange, then X Money.", "An escrow program on Solana. No custodian."],
  ["Who can receive it", "X Money users (US only).", "Any Solana wallet, in any country."],
  ["If nothing happens", "Paid anyway.", "At the deadline the pot buys the coin and burns it."],
  ["What people follow", "A transfer receipt.", "A live challenge with a growing pot."],
];

function Compare({ light }: { light: boolean }) {
  const rows = light ? COMPARE.map((r) => (r[0] === "Where the money waits" ? [r[0], r[1], "In the coin's own pool on Solana, visible on-chain, until it's claimed."] as [string, string, string] : r)) : COMPARE;
  const spot = useSpotlight<HTMLDivElement>();
  return (
    <section id="compare" className="scroll-mt-24">
      <div className="grid lg:grid-cols-[1.7fr_1fr] gap-8 lg:gap-16 mb-12">
        <div>
          <Reveal><div className="label mb-4">02 · Why Bounty Pad</div></Reveal>
          <h2 className="display text-[40px] sm:text-[64px]"><SplitWords lines={["Others pay for nothing.", "We pay for the action."]} lineClass={["", "text-mute"]} stagger={0.045} /></h2>
        </div>
        <Reveal delay={0.2} className="lg:self-end">
          <p className="text-mute text-[17px] leading-relaxed max-w-xl">
            Fee-routing launchpads send trading fees to a public figure whether or not they ever heard of the coin.
            Here the money is a bounty: it waits on-chain {light ? "in the coin's pool" : "in an escrow program"} until the person does the challenge in public, then goes straight to their wallet, not through a payments company.
          </p>
        </Reveal>
      </div>
      <Reveal>
        <div ref={spot} className="frame spot">
          <Crosses />
          <div className="grid grid-cols-2 md:grid-cols-[1fr_1.2fr_1.2fr] border-b border-line">
            <span className="hidden md:block" />
            <div className="px-4 sm:px-6 py-4 md:border-l border-line"><div className="label">Fee-routing launchpads</div><div className="text-dim text-xs mt-1">e.g. UsePaid</div></div>
            <div className="px-4 sm:px-6 py-4 border-l border-line bg-panel"><div className="label !text-ink flex items-center gap-2"><span className="w-1.5 h-1.5 bg-green" />Bounty Pad</div><div className="text-dim text-xs mt-1">Paid for the action</div></div>
          </div>
          <Stagger gap={0.08} y={10}>
            {rows.map(([k, them, us]) => (
              <div key={k} className="group grid grid-cols-2 md:grid-cols-[1fr_1.2fr_1.2fr] border-b border-line">
                <div className="col-span-2 md:col-span-1 px-4 sm:px-6 pt-4 md:py-5 label transition-colors group-hover:!text-ink">{k}</div>
                <div className="px-4 sm:px-6 py-3 md:py-5 text-dim text-[14px] sm:text-[15px] md:border-l border-line line-through decoration-line-2/70 decoration-1">{them}</div>
                <div className="px-4 sm:px-6 py-3 md:py-5 text-[14px] sm:text-[15px] border-l border-line bg-panel">{us}</div>
              </div>
            ))}
          </Stagger>
        </div>
      </Reveal>
      <p className="text-dim text-xs mt-3">Based on UsePaid's public documentation, September 2026.</p>
    </section>
  );
}

function HowItWorks({ light }: { light: boolean }) {
  const items = light ? [
    ["Launch", "Name, ticker, image. The coin goes live on a Meteora bonding curve with its challenge fixed at launch."],
    ["Challenge", "Pick anyone on X and one fixed action: post the cashtag, post the contract address, repost a post you choose, or put the contract address in their bio."],
    ["Fill the pot", "A share of every trading fee stays in the coin's pool on Solana, visible to anyone, until the challenge is verified."],
    ["Pay the action", "We watch X and verify the post. The person logs in with X and the pot is sent to their wallet."],
  ] : [
    ["Launch", "Name, ticker, image. The coin goes live on a Meteora bonding curve, and its bounty is written on-chain in the same transaction."],
    ["Challenge", "Pick anyone on X and one fixed action: post the cashtag, post the contract address, repost a post you choose, or put the contract address in their bio."],
    ["Fill the pot", "A share of every trading fee is claimed into the coin's escrow account. It can't move until the challenge is verified."],
    ["Pay the action", "We watch X, verify the post, recheck it a day later, then the escrow pays their wallet after a public review window."],
  ];
  const { ref, progress } = useSectionProgress(["start center", "end center"]);
  const [active, setActive] = useState(0);
  useMotionValueEvent(progress, "change", (v) => setActive(Math.min(items.length - 1, Math.max(0, Math.floor(v * items.length)))));
  const bar = useTransform(progress, [0, 1], ["0%", "100%"]);
  return (
    <section id="how" className="scroll-mt-24">
      <div className="mb-12">
        <Reveal><div className="label mb-4">03 · How it works</div></Reveal>
        <h2 className="display text-[44px] sm:text-[72px]"><SplitWords lines={["Four steps.", "Nothing to submit."]} lineClass={["", "text-mute"]} /></h2>
      </div>
      <div ref={ref} className="frame grid lg:grid-cols-[0.9fr_1.1fr]">
        <Crosses />
        {/* sticky counter: follows the step being read */}
        <div className="hidden lg:block border-r border-line">
          <div className="sticky top-24 p-10 h-[calc(100vh-8rem)] max-h-[560px] flex flex-col justify-between">
            <div className="label">Step</div>
            <div className="relative h-[180px] overflow-hidden">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div key={active} className="num absolute inset-0 text-[168px] leading-none tracking-[-0.06em]"
                  initial={{ y: "100%", opacity: 0 }} animate={{ y: "0%", opacity: 1 }} exit={{ y: "-100%", opacity: 0 }} transition={{ duration: 0.7, ease: EASE }}>
                  {String(active + 1).padStart(2, "0")}
                </motion.div>
              </AnimatePresence>
            </div>
            <div>
              <div className="h-px bg-line relative overflow-hidden"><motion.div className="absolute inset-y-0 left-0 bg-ink" style={{ width: bar }} /></div>
              <div className="flex justify-between mt-3 label">{items.map(([t], i) => <span key={t} className={i === active ? "!text-ink" : ""}>{t}</span>)}</div>
            </div>
          </div>
        </div>
        <div>
          {items.map(([t, b], i) => (
            <div key={t} className={`p-6 sm:p-10 lg:min-h-[46vh] flex flex-col justify-center border-line ${i > 0 ? "border-t" : ""}`}>
              <Reveal>
                <span className="num text-[13px] text-mute lg:hidden">{String(i + 1).padStart(2, "0")}</span>
                <h3 className={`text-[30px] sm:text-[40px] tracking-[-0.035em] leading-[1.05] mt-3 lg:mt-0 transition-colors duration-700 ${i === active ? "lg:text-ink" : "lg:text-dim"}`}>{t}</h3>
                <p className={`text-[16px] sm:text-[17px] leading-relaxed mt-4 max-w-lg transition-colors duration-700 ${i === active ? "text-mute" : "text-mute lg:text-dim"}`}>{b}</p>
              </Reveal>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Rules({ programId, explorerHref, light }: { programId: string | null; explorerHref: string | null; light: boolean }) {
  const spot = useSpotlight<HTMLDivElement>();
  const rules = light ? [
    ["Fixed challenges", "Four machine-checkable actions. No free text, nothing to argue about."],
    ["Permanent identity", "Targets are stored by X user ID, so a renamed or sold handle can't claim."],
    ["Recheck", "The post must still be live when it's rechecked, and its latest edit must still pass."],
    ["Public pot", "Each pot is the unclaimed fee balance of the coin's pool, readable by anyone on Solana."],
    ["Log in to claim", "Only the X account named can claim, by logging in with X. Payment is one transaction."],
    ["Burn, never share", "An unclaimed pot buys the coin and burns it. Nobody profits from blocking a payout."],
  ] : [
    ["Fixed challenges", "Four machine-checkable actions. No free text, nothing to argue about."],
    ["Permanent identity", "Targets are stored by X user ID, so a renamed or sold handle can't claim."],
    ["24-hour recheck", "The post must still be live a day later, and its latest edit must still pass."],
    ["2 of 3 signatures", "The escrow checks two independent verifier signatures before it moves funds."],
    ["48-hour window", "Every release is public first. A hacked account can be frozen before payment."],
    ["Burn, never share", "An unclaimed pot buys the coin and burns it. Nobody profits from blocking a payout."],
  ];
  return (
    <section id="rules" className="scroll-mt-24">
      <div className="flex flex-wrap items-end justify-between gap-6 mb-10">
        <div><Reveal><div className="label mb-4">04 · Verification</div></Reveal><h2 className="display text-[44px] sm:text-[72px]"><SplitWords lines={["Rules you can audit."]} /></h2></div>
        {programId && explorerHref && (
          <a href={explorerHref} target="_blank" rel="noreferrer" className="label hover:!text-ink">Escrow program {short(programId, 6)} ↗</a>
        )}
      </div>
      <Reveal>
        <div ref={spot} className="frame spot grid sm:grid-cols-2 lg:grid-cols-3">
          <Crosses />
          {rules.map(([t, b], i) => (
            <div key={t} className={`group relative p-6 sm:p-8 border-line ${i > 0 ? "border-t" : ""} ${i === 1 ? "sm:border-t-0 sm:border-l" : ""} ${i === 2 ? "lg:border-t-0 lg:border-l" : ""} ${i === 3 ? "sm:border-l lg:border-l-0" : ""} ${i === 4 ? "lg:border-l" : ""} ${i === 5 ? "sm:border-l" : ""}`}>
              <div className="flex items-center justify-between">
                <span className="num text-[12px] text-dim">{String(i + 1).padStart(2, "0")}</span>
                <span className="w-1.5 h-1.5 bg-line-2 transition-colors duration-500 group-hover:bg-green" />
              </div>
              <h3 className="text-[20px] tracking-[-0.02em] mt-8">{t}</h3>
              <p className="text-mute text-[15px] leading-relaxed mt-3">{b}</p>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
