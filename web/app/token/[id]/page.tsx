"use client";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { TokenDetail } from "@bountypad/shared";
import { api, useHealth, useLive } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { actionText, ago, countdown, fmtCompact, fmtPrice, fmtSol, fmtUsd, short, sol } from "@/lib/format";
import { VoteBars } from "@/components/VoteBars";
import { TradePanel } from "@/components/TradePanel";
import { TokenChart } from "@/components/TokenChart";
import { SocialLinks } from "@/components/SocialLinks";
import { explorer } from "@/lib/chain";
import { Avatar, Brackets, Change, CheckList, Counter, Crosses, ErrorNote, PostCard, Skeleton, StatusPill, StatusTimeline, TokenImage, Verified } from "@/components/ui";

const LIVE = ["OPEN", "DETECTED_CONFIRMING", "VOTING"];

/** Coin page: a trading terminal (chart, market stats, trade) around the challenge and its locked pot. */
export default function TokenPage() {
  const { id } = useParams<{ id: string }>();
  const launchedTx = useSearchParams().get("launched");
  const { data: health } = useHealth();
  const auth = useAuth();
  const [buyMsg, setBuyMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const solUsd = health?.solUsd ?? 150;
  const { data: d, error } = useLive<TokenDetail>(`/api/tokens/${id}`, { every: 4000, on: (e) => e.tokenId === id });
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);

  if (error && !d) return <ErrorNote msg={error} />;
  if (!d) return <div className="flex flex-col gap-4"><Skeleton className="h-28" /><div className="grid lg:grid-cols-[1fr_380px] gap-4"><Skeleton className="h-[480px]" /><Skeleton className="h-[480px]" /></div></div>;

  const { token, bounty, target, market } = d;
  const pot = sol(bounty.potLamports);
  const det = d.detections[0];
  const video = bounty.action === "VIDEO_PHRASE";
  const paid = bounty.status === "PAID";
  const live = LIVE.includes(bounty.status);
  const copy = () => { navigator.clipboard?.writeText(token.mint); setCopied(true); setTimeout(() => setCopied(false), 1200); };

  return (
    <div className="flex flex-col gap-6">
      {launchedTx && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="border border-green/30 bg-green/5 px-4 py-3 text-sm flex flex-wrap items-center gap-2">
          <span className="text-green">Launched on Solana.</span>
          <span className="text-mute">The coin and its bounty were created in one transaction.</span>
          <a className="text-green ml-auto" target="_blank" rel="noreferrer" href={explorer(health, "tx", launchedTx)}>View transaction ↗</a>
        </motion.div>
      )}

      {/* ---------- header: identity + market stats ---------- */}
      <header className="frame">
        <Crosses />
        <div className="flex flex-col xl:flex-row">
          <div className="flex items-center gap-5 p-5 sm:p-6 xl:border-r border-line min-w-0 xl:w-[460px] shrink-0">
            <div className="brackets p-1.5 shrink-0">
              <Brackets />
              <TokenImage name={token.name} ticker={token.ticker} src={token.imageUrl} className="w-[72px] h-[72px] sm:w-20 sm:h-20" textSize="text-sm" />
            </div>
            <div className="min-w-0">
              <h1 className="text-[26px] sm:text-[32px] tracking-[-0.03em] leading-none truncate">{token.name}</h1>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-3">
                <span className="font-mono text-sm text-mute">${token.ticker}</span>
                <button onClick={copy} className="font-mono text-xs text-dim hover:text-ink" title="Copy contract">{short(token.mint, 4)} {copied ? "✓" : "⧉"}</button>
                <StatusPill status={bounty.status} />
              </div>
              {Object.keys(token.links ?? {}).length > 0 && <div className="mt-3"><SocialLinks links={token.links} /></div>}
            </div>
          </div>
          <div className="grid grid-cols-3 md:grid-cols-6 flex-1 border-t xl:border-t-0 border-line">
            <HStat label="Price" v={<>{fmtPrice(market.priceSol)}</>} sub="SOL" />
            <HStat label="24h" v={<Change pct={market.change24h} />} />
            <HStat label="Market cap" v={market.marketCapSol === null ? "—" : fmtCompact(market.marketCapSol)} sub={market.marketCapSol === null ? undefined : `SOL · ${fmtUsd(market.marketCapSol * solUsd)}`} />
            <HStat label="Vol 24h" v={fmtCompact(sol(market.volume24hLamports))} sub="SOL" />
            <HStat label="Holders" v={d.holders} />
            <HStat label="Curve" v={market.curveProgress === null ? "—" : `${(market.curveProgress * 100).toFixed(1)}%`} bar={market.curveProgress ?? 0} />
          </div>
        </div>
      </header>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
        {/* ---------- chart ---------- */}
        <section className="frame min-w-0"><Crosses /><TokenChart tokenId={token.id} ticker={token.ticker} /></section>

        {/* ---------- side: challenge, pot, trade (second on phones, right column on desktop) ---------- */}
        <aside className="flex flex-col gap-6 min-w-0 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:sticky lg:top-24">
          <div className="frame">
            <Crosses only={["tl", "tr"]} />
            <div className="p-5 border-b border-line">
              <div className="label">The challenge</div>
              <Link href={`/u/${target.username}`} className="flex items-center gap-2.5 mt-4 group">
                <Avatar name={target.name} src={target.avatarUrl} size={32} />
                <div className="min-w-0">
                  <div className="text-sm flex items-center gap-1.5 group-hover:underline">{target.name}{target.verified && <Verified size={13} />}</div>
                  <div className="text-xs text-mute">@{target.username}</div>
                </div>
              </Link>
              <div className="text-[20px] tracking-[-0.02em] leading-snug mt-4">{actionText(bounty.action, token.ticker, bounty.phrase)}</div>
              <div className="text-sm text-mute mt-2">
                {live ? <>Ends in <span className="num text-ink">{countdown(bounty.deadline)}</span>. If nobody does it, the pot is burned.</> : paid ? "Completed and paid." : bounty.status === "EXPIRED" ? "Expired. The pot was burned." : null}
              </div>
              {!paid && <div className="text-xs text-dim mt-3">Not affiliated with @{target.username}.</div>}
            </div>
            <div className="p-5 border-b border-line">
              <div className="flex items-center justify-between">
                <span className="label">{paid ? "Paid out" : "Pot"}</span>
                {token.escrow
                  ? <a target="_blank" rel="noreferrer" href={explorer(health, "account", token.escrow)} className="label hover:!text-ink">{paid ? "Released ↗" : "Escrow ↗"}</a>
                  : token.pool
                    ? <a target="_blank" rel="noreferrer" href={explorer(health, "account", token.pool)} className="label hover:!text-ink">{paid ? "Paid ↗" : "In the pool ↗"}</a>
                    : <span className="label">{paid ? "Released" : "Locked · sim"}</span>}
              </div>
              <div className="flex items-baseline gap-2 mt-3">
                <Counter value={pot} format={(v) => v.toFixed(4)} className="num text-[40px] leading-none" />
                <span className="text-mute">SOL</span>
              </div>
              <div className="num text-sm text-dim mt-2">{fmtUsd(pot * solUsd)}</div>
            </div>
            <div className="p-5"><StatusTimeline status={bounty.status} video={video} /></div>
          </div>

          {health?.chain === "solana" ? <TradePanel token={token} health={health} /> : live && (
            <div className="frame p-5">
              <div className="flex items-center justify-between mb-4"><span className="label">Trade</span><span className="label !text-gold">Simulation</span></div>
              <p className="text-sm text-mute mb-4">Buy with your connected wallet to become a holder and vote on video challenges.</p>
              {auth.wallet ? (
                <div className="grid grid-cols-3 gap-2">
                  {[0.5, 1, 5].map((v) => (
                    <button key={v} className="btn btn-outline h-11 text-sm" onClick={async () => { try { await api("/api/dev/buy", { method: "POST", json: { tokenId: token.id, wallet: auth.wallet, sol: v } }); setBuyMsg(`Bought ${v} SOL of $${token.ticker}`); } catch (e) { setBuyMsg((e as Error).message); } }}>Buy {v}</button>
                  ))}
                </div>
              ) : <button className="btn btn-primary w-full" onClick={auth.login}>Connect wallet to trade</button>}
              {buyMsg && <p className="text-green text-sm mt-3">{buyMsg}</p>}
            </div>
          )}

          {d.vote && (
            <div className="frame p-5">
              <div className="flex items-center justify-between mb-4">
                <span className="label">Holder vote</span>
                <span className="num text-sm text-mute">{d.vote.round.result === "PENDING" ? `${countdown(d.vote.round.closesAt)} left` : d.vote.round.result.toLowerCase()}</span>
              </div>
              <VoteBars yes={d.vote.tally.yesPct} turnout={d.vote.tally.turnoutPct} />
              {d.vote.round.result === "PENDING" && <Link href={`/vote/${d.vote.round.id}`} className="btn btn-primary w-full mt-5">Review and vote</Link>}
            </div>
          )}

          {d.payout && (
            <div className="frame p-5">
              <div className="flex items-center justify-between">
                <span className="label">Payout</span>
                <span className="num">{fmtSol(d.payout.amountLamports, 4)} SOL</span>
              </div>
              <div className="text-sm text-mute mt-3">
                {d.payout.status === "CHALLENGE_WINDOW" && <>Public review window: releases in <span className="num text-ink">{countdown(d.payout.challengeEndsAt)}</span>.</>}
                {d.payout.status === "AWAITING_CLAIM" && <>Waiting for @{target.username} to log in with X and claim.</>}
                {d.payout.status === "FROZEN" && <>Frozen by an admin for review.</>}
                {d.payout.status === "SENT" && <>Sent to <span className="font-mono">{short(d.payout.wallet ?? "", 5)}</span>.</>}
              </div>
              {d.payout.signatures.length > 0 && <div className="label mt-3">{d.payout.signatures.length} of 3 verifier signatures</div>}
              {d.payout.txSig && (token.pool
                ? <a target="_blank" rel="noreferrer" href={explorer(health, "tx", d.payout.txSig)} className="text-sm text-xblue mt-3 inline-block">View payout transaction ↗</a>
                : <div className="font-mono text-xs text-dim mt-3 break-all">tx {short(d.payout.txSig, 10)}</div>)}
            </div>
          )}

          <div className="frame">
            <div className="p-5 border-b border-line">
              <div className="label mb-3">About</div>
              <p className="text-sm text-mute leading-relaxed">{token.description || `${token.name} is a challenge coin for @${target.username}.`}</p>
            </div>
            <dl className="p-5 flex flex-col gap-3 text-sm">
              <Row k="Contract" v={<button className="font-mono hover:text-ink" onClick={copy}>{short(token.mint, 5)} <span className="text-dim">{copied ? "copied" : "copy"}</span></button>} />
              <Row k="Creator" v={<span className="font-mono">{short(token.creatorWallet, 4)}</span>} />
              <Row k="Launched" v={`${ago(token.createdAt)} ago`} />
              <Row k="All-time volume" v={<span className="num">{fmtSol(d.volumeLamports, 2)} SOL</span>} />
              {token.pool && ([["Bonding curve pool", "account", token.pool], ["Escrow account", "account", token.escrow], ["Launch transaction", "tx", token.launchTx]] as const).map(([k, kind, v]) => v && (
                <Row key={k} k={k} v={<a target="_blank" rel="noreferrer" href={explorer(health, kind, v)} className="font-mono hover:text-xblue">{short(v, 5)} ↗</a>} />
              ))}
            </dl>
          </div>
        </aside>

        {/* ---------- detection + trades ---------- */}
        <div className="flex flex-col gap-6 min-w-0">
          <section>
            <SectionHead label="Verification" title={det ? "Detected post" : "Watching X"} />
            {!det ? (
              <div className="frame p-5 flex items-start gap-4">
                <span className="live-dot mt-2" />
                <div>
                  <div>Watching @{target.username} for: <span className="text-ink">{actionText(bounty.action, token.ticker, bounty.phrase)}</span></div>
                  <p className="text-mute text-sm mt-1">Checked every few minutes. Nobody has to submit anything.</p>
                </div>
              </div>
            ) : (
              <AnimatePresence mode="wait">
                <motion.div key={det.id + det.status} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="grid xl:grid-cols-2 gap-4 items-start">
                  <PostCard name={target.name} username={target.username} verified={target.verified} text={det.text} at={ago(det.postCreatedAt)} highlight={token.ticker}>
                    {det.transcript !== null && (
                      <div className="mt-4 border border-line bg-panel-2 p-4">
                        <div className="label mb-2">Transcript · {det.matchScore}% match</div>
                        <p className="text-[15px] italic">“{det.transcript}”</p>
                        <div className="text-xs text-dim mt-2">Required: “{bounty.phrase}”</div>
                      </div>
                    )}
                    {det.status === "VERIFIED" && <div className="mt-4 inline-flex label !text-green border border-green/30 px-2 py-1">✓ Verified</div>}
                    {det.status === "REJECTED" && <div className="mt-4 inline-flex label !text-red border border-red/30 px-2 py-1">Rejected</div>}
                  </PostCard>
                  <div className="flex flex-col gap-2">
                    <CheckList checks={det.checks} />
                    {det.status === "CONFIRMING" && <p className="text-mute text-sm mt-1">Rechecking in <span className="num text-ink">{countdown(det.recheckAt)}</span>: the post must still be live, and its latest edit must still pass.</p>}
                  </div>
                </motion.div>
              </AnimatePresence>
            )}
            {d.detections.length > 1 && (
              <div className="frame mt-4">
                <div className="px-4 h-10 flex items-center label border-b border-line">Earlier attempts</div>
                {d.detections.slice(1).map((x) => (
                  <div key={x.id} className="px-4 py-3 flex items-center gap-3 text-sm border-b border-line last:border-0">
                    <span className={`label ${x.status === "REJECTED" ? "!text-red" : "!text-green"}`}>{x.status.toLowerCase()}</span>
                    <span className="truncate text-mute">“{x.text}”</span>
                    <span className="ml-auto num text-dim text-xs shrink-0">{ago(x.detectedAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <SectionHead label="Market" title="Trades" />
            <div className="frame overflow-hidden">
              <div className="grid grid-cols-[52px_1fr_1fr_1fr_56px] sm:grid-cols-[64px_1.2fr_1fr_1fr_1fr_64px] gap-3 px-4 h-10 items-center label !text-[10px] border-b border-line">
                <span>Side</span><span className="hidden sm:block">Wallet</span><span className="text-right">SOL</span><span className="text-right">${token.ticker}</span><span className="text-right">Price</span><span className="text-right">Age</span>
              </div>
              {d.trades.length === 0 ? <p className="text-mute px-4 py-8 text-sm text-center">No trades yet.</p> : d.trades.map((t) => (
                <div key={t.id} className="grid grid-cols-[52px_1fr_1fr_1fr_56px] sm:grid-cols-[64px_1.2fr_1fr_1fr_1fr_64px] gap-3 px-4 h-11 items-center text-sm border-b border-line last:border-0 hover:bg-panel">
                  <span className={`label ${t.side === "BUY" ? "!text-green" : "!text-red"}`}>{t.side === "BUY" ? "Buy" : "Sell"}</span>
                  <span className="hidden sm:block font-mono text-xs text-mute truncate">{short(t.wallet)}</span>
                  <span className="num text-right">{fmtSol(t.solLamports, 3)}</span>
                  <span className="num text-right text-mute">{t.tokenAmount ? fmtCompact(Number(t.tokenAmount) / 1e6) : "—"}</span>
                  <span className="num text-right text-mute">{fmtPrice(t.priceSol)}</span>
                  <span className="num text-right text-dim text-xs">{ago(t.createdAt)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function HStat({ label, v, sub, bar }: { label: string; v: React.ReactNode; sub?: string; bar?: number }) {
  return (
    <div className="px-4 sm:px-5 py-4 border-line border-l first:border-l-0 [&:nth-child(4)]:border-l-0 md:[&:nth-child(4)]:border-l [&:nth-child(n+4)]:border-t md:[&:nth-child(n+4)]:border-t-0 flex flex-col justify-center min-w-0">
      <div className="label !text-[10px]">{label}</div>
      <div className="num text-[17px] sm:text-[19px] mt-1.5 truncate">{v}</div>
      {sub && <div className="text-[11px] text-dim mt-0.5 truncate">{sub}</div>}
      {bar !== undefined && <div className="h-1 bg-panel-3 mt-2"><div className="h-full bg-ink transition-all duration-700" style={{ width: `${Math.min(100, bar * 100)}%` }} /></div>}
    </div>
  );
}

function SectionHead({ label, title }: { label: string; title: string }) {
  return <div className="flex items-end justify-between mb-4"><div><div className="label mb-2">{label}</div><h2 className="text-[22px] tracking-[-0.02em]">{title}</h2></div></div>;
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-4"><dt className="text-mute">{k}</dt><dd className="text-right">{v}</dd></div>;
}
