"use client";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { TokenDetail } from "@bountypad/shared";
import { api, useHealth, useLive } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { actionText, ago, countdown, fmtSol, fmtUsd, short, sol } from "@/lib/format";
import { VoteBars } from "@/components/VoteBars";
import { TradePanel } from "@/components/TradePanel";
import { explorer } from "@/lib/chain";
import { Avatar, CheckList, Counter, ErrorNote, PostCard, Skeleton, Sparkline, StatusPill, StatusTimeline, TokenImage, Verified } from "@/components/ui";

const LIVE = ["OPEN", "DETECTED_CONFIRMING", "VOTING"];

/** Coin page, in the marketplace item layout: the coin's image on the left, the challenge, pot and actions on the right. */
export default function TokenPage() {
  const { id } = useParams<{ id: string }>();
  const launchedTx = useSearchParams().get("launched");
  const { data: health } = useHealth();
  const auth = useAuth();
  const [buyMsg, setBuyMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const solUsd = health?.solUsd ?? 150;
  const { data: d, error } = useLive<TokenDetail>(`/api/tokens/${id}`, { every: 3000, on: (e) => e.tokenId === id });
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);

  if (error && !d) return <ErrorNote msg={error} />;
  if (!d) return <div className="grid lg:grid-cols-2 gap-10"><Skeleton className="aspect-square" /><Skeleton className="h-96" /></div>;

  const { token, bounty, target } = d;
  const pot = sol(bounty.potLamports);
  const det = d.detections[0];
  const video = bounty.action === "VIDEO_PHRASE";
  const paid = bounty.status === "PAID";
  const live = LIVE.includes(bounty.status);

  return (
    <div className="flex flex-col gap-10">
      {launchedTx && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl bg-green/10 px-4 py-3 text-sm flex flex-wrap items-center gap-2">
          <span className="text-green font-semibold">Launched on Solana.</span>
          <span className="text-ink/80">The coin and its challenge were created in one transaction.</span>
          <a className="font-semibold text-green ml-auto" target="_blank" rel="noreferrer" href={explorer(health, "tx", launchedTx)}>View transaction ↗</a>
        </motion.div>
      )}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] gap-8 lg:gap-12 items-start">
        {/* ---------- left: image + details ---------- */}
        {/* On phones this column dissolves (contents) so the order becomes: image, challenge/pot/trade, details. */}
        <div className="contents lg:flex lg:flex-col lg:gap-4 lg:sticky lg:top-24">
          <div className="card overflow-hidden order-1">
            <TokenImage name={token.name} ticker={token.ticker} src={token.imageUrl} rounded="" className="w-full aspect-square" textSize="text-6xl" />
          </div>
          <div className="order-3 flex flex-col gap-4">
          <Details title="About">
            <p className="text-sm text-mute leading-relaxed">{token.description || `${token.name} is a challenge coin for @${target.username}.`}</p>
            <div className="flex flex-col gap-2.5 text-sm mt-4">
              <Row k="Contract" v={
                <button className="font-medium hover:text-xblue" onClick={() => { navigator.clipboard?.writeText(token.mint); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
                  {short(token.mint, 5)} <span className="text-dim text-xs">{copied ? "copied" : "copy"}</span>
                </button>} />
              <Row k="Holders" v={d.holders} />
              <Row k="Volume" v={`${fmtSol(d.volumeLamports, 2)} SOL`} />
              <Row k="Launched" v={`${ago(token.createdAt)} ago`} />
              <Row k="Creator" v={short(token.creatorWallet, 4)} />
            </div>
          </Details>
          {token.pool && (
            <Details title="On-chain">
              <div className="flex flex-col gap-2.5 text-sm">
                {([["Coin", "token", token.mint], ["Bonding curve pool", "account", token.pool], ["Escrow holding the pot", "account", token.escrow], ["Launch transaction", "tx", token.launchTx]] as const).map(([k, kind, v]) => v && (
                  <a key={k} target="_blank" rel="noreferrer" href={explorer(health, kind, v)} className="flex justify-between gap-3 group">
                    <span className="text-mute">{k}</span><span className="font-medium group-hover:text-xblue">{short(v, 5)} ↗</span>
                  </a>
                ))}
              </div>
            </Details>
          )}
          </div>
        </div>

        {/* ---------- right: challenge, pot, actions ---------- */}
        <div className="flex flex-col gap-5 min-w-0 order-2">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-xblue">
              <Link href={`/u/${target.username}`} className="flex items-center gap-1.5 hover:underline">
                <Avatar name={target.name} src={target.avatarUrl} size={20} />@{target.username}
              </Link>
              {target.verified && <Verified size={14} />}
            </div>
            <h1 className="text-[32px] sm:text-[40px] font-bold tracking-[-0.03em] leading-tight mt-2">{token.name} <span className="text-mute font-semibold">${token.ticker}</span></h1>
            <div className="flex flex-wrap items-center gap-3 mt-3 text-sm text-mute">
              <StatusPill status={bounty.status} />
              {!paid && <span>Not affiliated with @{target.username}.</span>}
            </div>
          </div>

          {/* the challenge */}
          <div className="card p-5">
            <div className="text-sm text-mute">The challenge</div>
            <div className="text-xl font-semibold mt-1">{actionText(bounty.action, token.ticker, bounty.phrase)}</div>
            <div className="text-sm text-mute mt-2">
              {live ? <>Ends in <span className="text-ink font-medium tabular">{countdown(bounty.deadline)}</span>. If nobody completes it, the pot is burned.</> : paid ? "Completed and paid." : null}
            </div>
          </div>

          {/* pot */}
          <div className="card overflow-hidden">
            <div className="p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-mute">{paid ? "Paid out" : "Current pot"}</span>
                {token.escrow
                  ? <a target="_blank" rel="noreferrer" href={explorer(health, "account", token.escrow)} className="text-xs font-semibold text-mute hover:text-ink">{paid ? "Released from escrow ↗" : "Locked in escrow ↗"}</a>
                  : <span className="text-xs font-semibold text-mute">{paid ? "Released" : "Locked (simulation)"}</span>}
              </div>
              <div className="flex flex-wrap items-baseline gap-x-3 mt-1">
                <Counter value={pot} format={(v) => v.toFixed(4)} className="text-[40px] font-bold tracking-[-0.03em]" />
                <span className="text-xl font-semibold">SOL</span>
                <span className="text-mute">{fmtUsd(pot * solUsd)}</span>
              </div>
              {d.potHistory.length > 1 && <div className="mt-3 -mx-1"><Sparkline points={d.potHistory.map((p) => sol(p.potLamports))} height={56} /></div>}
            </div>
            <div className="border-t border-line bg-panel/50 px-5 py-5">
              <StatusTimeline status={bounty.status} video={video} />
            </div>
          </div>

          {health?.chain === "solana" ? <TradePanel token={token} health={health} /> : live && (
            <div className="card p-5">
              <div className="font-semibold">Trade</div>
              <p className="text-sm text-mute mt-1 mb-4">Simulation: buy with your connected wallet to become a holder (and vote on video challenges).</p>
              {auth.wallet ? (
                <div className="grid grid-cols-3 gap-2">
                  {[0.5, 1, 5].map((v) => (
                    <button key={v} className="btn btn-ghost h-11 text-sm" onClick={async () => { try { await api("/api/dev/buy", { method: "POST", json: { tokenId: token.id, wallet: auth.wallet, sol: v } }); setBuyMsg(`Bought ${v} SOL of $${token.ticker}`); } catch (e) { setBuyMsg((e as Error).message); } }}>Buy {v} SOL</button>
                  ))}
                </div>
              ) : <button className="btn btn-primary w-full" onClick={auth.login}>Connect wallet to trade</button>}
              {buyMsg && <p className="text-green text-sm mt-3">{buyMsg}</p>}
            </div>
          )}

          {d.vote && (
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <span className="font-semibold">Holder vote</span>
                <span className="text-sm text-mute">{d.vote.round.result === "PENDING" ? `${countdown(d.vote.round.closesAt)} left` : d.vote.round.result.toLowerCase()}</span>
              </div>
              <VoteBars yes={d.vote.tally.yesPct} turnout={d.vote.tally.turnoutPct} />
              {d.vote.round.result === "PENDING" && <Link href={`/vote/${d.vote.round.id}`} className="btn btn-primary w-full mt-5">Review and vote</Link>}
            </div>
          )}

          {d.payout && (
            <div className="card p-5">
              <div className="flex items-center justify-between">
                <span className="font-semibold">Payout</span>
                <span className="font-bold tabular">{fmtSol(d.payout.amountLamports, 4)} SOL</span>
              </div>
              <div className="text-sm text-mute mt-2">
                {d.payout.status === "CHALLENGE_WINDOW" && <>Public review window: releases in {countdown(d.payout.challengeEndsAt)}.</>}
                {d.payout.status === "AWAITING_CLAIM" && <>Waiting for @{target.username} to log in with X and claim.</>}
                {d.payout.status === "FROZEN" && <>Frozen by an admin for review.</>}
                {d.payout.status === "SENT" && <>Sent to {short(d.payout.wallet ?? "", 5)}.</>}
              </div>
              {d.payout.signatures.length > 0 && <div className="text-xs text-dim mt-2">{d.payout.signatures.length} of 3 verifier signatures</div>}
              {d.payout.txSig && (token.pool
                ? <a target="_blank" rel="noreferrer" href={explorer(health, "tx", d.payout.txSig)} className="text-sm font-semibold text-xblue mt-2 inline-block">View payout transaction ↗</a>
                : <div className="text-xs text-dim mt-2 break-all">tx {short(d.payout.txSig, 10)}</div>)}
            </div>
          )}
        </div>
      </div>

      {/* ---------- detection ---------- */}
      <section>
        <h2 className="text-[22px] font-bold tracking-[-0.02em] mb-4">{det ? "Detected post" : "Watching X"}</h2>
        {!det ? (
          <div className="card p-5 flex items-start gap-3">
            <span className="live-dot mt-2" />
            <div>
              <div>Watching @{target.username} on X for: <span className="font-semibold">{actionText(bounty.action, token.ticker, bounty.phrase)}</span></div>
              <p className="text-mute text-sm mt-1">Checked every few minutes. Nobody has to submit anything.</p>
            </div>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div key={det.id + det.status} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="grid lg:grid-cols-2 gap-4 items-start">
              <PostCard name={target.name} username={target.username} verified={target.verified} text={det.text} at={ago(det.postCreatedAt)} highlight={token.ticker}>
                {det.transcript !== null && (
                  <div className="mt-4 rounded-xl bg-panel p-4">
                    <div className="text-xs font-semibold text-mute mb-2">Video transcript · {det.matchScore}% match</div>
                    <p className="text-[15px] italic">“{det.transcript}”</p>
                    <div className="text-xs text-dim mt-2">Required: “{bounty.phrase}”</div>
                  </div>
                )}
                {det.status === "VERIFIED" && <div className="mt-4 inline-flex text-sm font-semibold text-green bg-green/10 rounded-lg px-2.5 py-1">✓ Verified</div>}
                {det.status === "REJECTED" && <div className="mt-4 inline-flex text-sm font-semibold text-red bg-red/10 rounded-lg px-2.5 py-1">Rejected</div>}
              </PostCard>
              <div className="flex flex-col gap-2">
                <CheckList checks={det.checks} />
                {det.status === "CONFIRMING" && <p className="text-mute text-sm mt-1">Rechecking in {countdown(det.recheckAt)}: the post must still be live, and its latest edit must still pass.</p>}
              </div>
            </motion.div>
          </AnimatePresence>
        )}
        {d.detections.length > 1 && (
          <div className="mt-6">
            <div className="text-sm font-semibold mb-2">Earlier attempts</div>
            <div className="card divide-y divide-line">
              {d.detections.slice(1).map((x) => (
                <div key={x.id} className="px-4 py-3 flex items-center gap-3 text-sm">
                  <span className={`font-semibold ${x.status === "REJECTED" ? "text-red" : "text-green"}`}>{x.status.toLowerCase()}</span>
                  <span className="truncate text-mute">“{x.text}”</span>
                  <span className="ml-auto text-dim text-xs shrink-0">{ago(x.detectedAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ---------- trades ---------- */}
      <section>
        <h2 className="text-[22px] font-bold tracking-[-0.02em] mb-4">Trades</h2>
        <div className="card overflow-hidden">
          <div className="grid grid-cols-[80px_1fr_1fr_90px] gap-3 px-4 py-2.5 text-xs font-medium text-mute border-b border-line bg-panel/50">
            <span>Side</span><span>Wallet</span><span>Amount</span><span className="text-right">Time</span>
          </div>
          {d.trades.length === 0 ? <p className="text-mute p-5 text-sm">No trades yet.</p> : d.trades.map((t) => (
            <div key={t.id} className="grid grid-cols-[80px_1fr_1fr_90px] gap-3 px-4 py-3 text-sm border-b border-line last:border-0">
              <span className={`font-semibold ${t.side === "BUY" ? "text-green" : "text-red"}`}>{t.side === "BUY" ? "Buy" : "Sell"}</span>
              <span className="text-mute truncate">{short(t.wallet)}</span>
              <span className="tabular">{fmtSol(t.solLamports)} SOL</span>
              <span className="text-right text-dim">{ago(t.createdAt)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Details({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <div className="font-semibold mb-3">{title}</div>
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-4"><span className="text-mute">{k}</span><span className="text-right font-medium">{v}</span></div>;
}
