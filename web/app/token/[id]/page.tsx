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
import { Avatar, CheckList, Counter, ErrorNote, PostCard, Section, Skeleton, Sparkline, StatusPill, StatusTimeline, Verified } from "@/components/ui";

export default function TokenPage() {
  const { id } = useParams<{ id: string }>();
  const launchedTx = useSearchParams().get("launched");
  const { data: health } = useHealth();
  const auth = useAuth();
  const [buyMsg, setBuyMsg] = useState<string | null>(null);
  const solUsd = health?.solUsd ?? 150;
  const { data: d, error } = useLive<TokenDetail>(`/api/tokens/${id}`, { every: 3000, on: (e) => e.tokenId === id });
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);

  if (error && !d) return <ErrorNote msg={error} />;
  if (!d) return <div className="grid lg:grid-cols-[1fr_400px] gap-6"><Skeleton className="h-96" /><Skeleton className="h-96" /></div>;

  const { token, bounty, target } = d;
  const pot = sol(bounty.potLamports);
  const det = d.detections[0];
  const video = bounty.action === "VIDEO_PHRASE";
  const paid = bounty.status === "PAID";

  return (
    <div className="flex flex-col gap-8">
      {/* header */}
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={token.name} src={token.imageUrl} size={64} square />
        <div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{token.name} <span className="text-xblue">${token.ticker}</span></h1>
          <div className="text-mute font-mono text-sm mt-1 flex flex-wrap gap-x-4">
            <span>{short(token.mint, 6)}</span><span>{d.holders} holders</span><span>vol {fmtSol(d.volumeLamports, 2)} SOL</span><span>launched {ago(token.createdAt)} ago</span>
          </div>
        </div>
        <div className="ml-auto"><StatusPill status={bounty.status} big /></div>
      </div>

      {launchedTx && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-green/40 bg-green/[.07] px-4 py-3 text-sm flex flex-wrap items-center gap-2">
          <span className="text-green font-semibold">Launched on Solana.</span>
          <span className="text-mute">The coin and its challenge were created in one transaction.</span>
          <a className="underline text-green ml-auto" target="_blank" rel="noreferrer" href={explorer(health, "tx", launchedTx)}>View transaction</a>
        </motion.div>
      )}

      {!paid && (
        <div className="rounded-xl border border-line bg-white/[.02] px-4 py-2.5 text-sm text-mute">
          Not affiliated with @{target.username}. They haven't agreed to anything unless they complete the challenge.
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr_400px] gap-6">
        <div className="flex flex-col gap-6">
          {/* pot */}
          <div className="card p-6 sm:p-8 relative overflow-hidden">
            <div className="halo opacity-40" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={paid ? "/brand/verified-badge.webp" : "/brand/vault-lock.webp"} alt="" width={140} height={140} className="bob drop absolute right-5 sm:right-10 bottom-5 w-20 sm:w-28 opacity-95 pointer-events-none" style={{ ["--r" as string]: "6deg" }} />
            <div className="flex items-center justify-between">
              <span className="text-mute text-xs font-mono uppercase tracking-widest">Bounty pot</span>
              {token.escrow ? (
                <a target="_blank" rel="noreferrer" href={explorer(health, "account", token.escrow)} className={`text-xs font-medium rounded-full px-3 py-1 border hover:brightness-125 ${paid ? "text-green border-green/40 bg-green/10" : "text-gold border-gold/40 bg-gold/10"}`}>{paid ? "Released" : "Locked in escrow ↗"}</a>
              ) : (
                <span className={`text-xs font-medium rounded-full px-3 py-1 border ${paid ? "text-green border-green/40 bg-green/10" : "text-gold border-gold/40 bg-gold/10"}`}>{paid ? "Released" : "Locked (simulated)"}</span>
              )}
            </div>
            <div className="flex flex-wrap items-baseline gap-x-3 mt-3">
              <Counter value={pot} format={(v) => v.toFixed(4)} className="gold-text text-[56px] sm:text-[80px] font-bold tracking-[-0.04em] leading-none" />
              <span className="text-gold/80 text-2xl font-semibold">SOL</span>
              <span className="text-mute text-lg">≈ {fmtUsd(pot * solUsd)}</span>
            </div>
            <div className="mt-6 -mx-2"><Sparkline points={d.potHistory.map((p) => sol(p.potLamports))} height={90} /></div>
          </div>

          {/* status */}
          <div className="card p-6">
            <StatusTimeline status={bounty.status} video={video} />
          </div>

          {/* detection */}
          <Section title={det ? "Detected post" : "Watching X"}>
            {!det ? (
              <div className="card p-6 relative overflow-hidden">
                <div className="absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-green/10 to-transparent scan-line pointer-events-none" />
                <div className="flex items-center gap-3"><span className="live-dot" /><span>Watching @{target.username} on X for: <span className="text-ink font-medium">{actionText(bounty.action, token.ticker, bounty.phrase)}</span></span></div>
                <p className="text-mute text-sm mt-2">Checked every few minutes. No forms, nobody has to submit anything.</p>
              </div>
            ) : (
              <AnimatePresence mode="wait">
                <motion.div key={det.id + det.status} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3">
                  <PostCard name={target.name} username={target.username} verified={target.verified} text={det.text} at={ago(det.postCreatedAt)} highlight={token.ticker}>
                    {det.transcript !== null && (
                      <div className="mt-4 rounded-xl bg-panel border border-line p-4">
                        <div className="text-xs font-mono uppercase tracking-widest text-mute mb-2">Video transcript · {det.matchScore}% match</div>
                        <p className="text-[15px] italic text-ink/90">“{det.transcript}”</p>
                        <div className="text-xs text-dim mt-2">Required: “{bounty.phrase}”</div>
                      </div>
                    )}
                    {det.status === "VERIFIED" && <div className="mt-4 w-fit sm:mt-0 sm:absolute right-5 bottom-5 font-mono text-green border-[3px] border-green rounded-lg px-3 py-1 tracking-[.14em] -rotate-6 glow-green shadow-[0_0_24px_rgba(61,255,162,.3)]">VERIFIED</div>}
                    {det.status === "REJECTED" && <div className="mt-4 w-fit sm:mt-0 sm:absolute right-5 bottom-5 font-mono text-red border-[3px] border-red rounded-lg px-3 py-1 tracking-[.14em] -rotate-6">REJECTED</div>}
                  </PostCard>
                  <CheckList checks={det.checks} />
                  {det.status === "CONFIRMING" && <p className="text-mute text-sm">Rechecking in {countdown(det.recheckAt)}: the post must still be live, and its latest edit must still pass.</p>}
                </motion.div>
              </AnimatePresence>
            )}
          </Section>

          {d.detections.length > 1 && (
            <Section title="Earlier attempts">
              <div className="flex flex-col gap-2">
                {d.detections.slice(1).map((x) => (
                  <div key={x.id} className="rounded-xl border border-line bg-panel px-4 py-3 flex items-center gap-3 text-sm">
                    <span className={x.status === "REJECTED" ? "text-red" : "text-green"}>{x.status.toLowerCase()}</span>
                    <span className="truncate text-mute">“{x.text}”</span>
                    <span className="ml-auto text-dim font-mono text-xs">{ago(x.detectedAt)}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>

        {/* sidebar */}
        <div className="flex flex-col gap-6">
          <div className="card p-6">
            <div className="text-mute text-xs font-mono uppercase tracking-widest mb-4">The challenge</div>
            <Link href={`/u/${target.username}`} className="flex items-center gap-3 group">
              <Avatar name={target.name} src={target.avatarUrl} size={52} />
              <div><div className="font-semibold flex items-center gap-1.5 group-hover:text-green transition-colors">{target.name}{target.verified && <Verified />}</div><div className="text-mute">@{target.username}</div></div>
            </Link>
            <p className="text-xl font-medium mt-5">{actionText(bounty.action, token.ticker, bounty.phrase)}</p>
            <div className="grid grid-cols-2 gap-3 mt-5">
              <div className="rounded-xl bg-panel border border-line p-3"><div className="text-dim text-xs">Time left</div><div className="font-mono mt-1">{["OPEN", "DETECTED_CONFIRMING", "VOTING"].includes(bounty.status) ? countdown(bounty.deadline) : "—"}</div></div>
              <div className="rounded-xl bg-panel border border-line p-3"><div className="text-dim text-xs">If it expires</div><div className="mt-1">Pot is burned</div></div>
            </div>
          </div>

          {health?.chain === "solana" ? <TradePanel token={token} health={health} /> : ["OPEN", "DETECTED_CONFIRMING", "VOTING"].includes(bounty.status) && (
            <div className="card p-6">
              <div className="text-mute text-xs font-mono uppercase tracking-widest mb-3">Trade</div>
              <p className="text-sm text-mute mb-4">Simulation: buy with your connected wallet to become a holder (and vote on video challenges).</p>
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

          {token.pool && (
            <div className="card p-6">
              <div className="text-mute text-xs font-mono uppercase tracking-widest mb-3">On-chain</div>
              <div className="flex flex-col gap-2 text-sm">
                {([["Coin", "token", token.mint], ["Bonding curve pool", "account", token.pool], ["Escrow (the pot)", "account", token.escrow], ["Launch transaction", "tx", token.launchTx]] as const).map(([k, kind, v]) => v && (
                  <a key={k} target="_blank" rel="noreferrer" href={explorer(health, kind, v)} className="flex justify-between gap-3 hover:text-green transition-colors"><span className="text-mute">{k}</span><span className="font-mono">{short(v, 5)} ↗</span></a>
                ))}
              </div>
            </div>
          )}

          {d.vote && (
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <span className="text-mute text-xs font-mono uppercase tracking-widest">Holder vote</span>
                <span className="text-xs font-mono">{d.vote.round.result === "PENDING" ? `${countdown(d.vote.round.closesAt)} left` : d.vote.round.result.toLowerCase()}</span>
              </div>
              <VoteBars yes={d.vote.tally.yesPct} turnout={d.vote.tally.turnoutPct} />
              {d.vote.round.result === "PENDING" && <Link href={`/vote/${d.vote.round.id}`} className="btn btn-primary w-full mt-5">Review & vote</Link>}
            </div>
          )}

          {d.payout && (
            <div className="card p-6 border-green/25">
              <div className="text-mute text-xs font-mono uppercase tracking-widest mb-3">Payout</div>
              <div className="text-2xl font-bold text-green">{fmtSol(d.payout.amountLamports, 4)} SOL</div>
              <div className="text-sm text-mute mt-2">
                {d.payout.status === "CHALLENGE_WINDOW" && <>Public challenge window: releases in {countdown(d.payout.challengeEndsAt)}</>}
                {d.payout.status === "AWAITING_CLAIM" && <>Waiting for @{target.username} to log in with X and claim.</>}
                {d.payout.status === "FROZEN" && <>Frozen by an admin for review.</>}
                {d.payout.status === "SENT" && <>Sent to {short(d.payout.wallet ?? "", 5)}</>}
              </div>
              {d.payout.signatures.length > 0 && <div className="text-xs text-dim mt-2 font-mono">{d.payout.signatures.length} of 3 verifier signatures</div>}
              {d.payout.txSig && (token.pool
                ? <a target="_blank" rel="noreferrer" href={explorer(health, "tx", d.payout.txSig)} className="text-xs font-mono text-green mt-2 break-all block underline">tx {short(d.payout.txSig, 10)} ↗</a>
                : <div className="text-xs font-mono text-green mt-2 break-all">tx {short(d.payout.txSig, 10)}</div>)}
            </div>
          )}

          <Section title="Trades">
            <div className="card p-2 max-h-[420px] overflow-y-auto">
              {d.trades.length === 0 ? <p className="text-mute p-4 text-sm">No trades yet.</p> : d.trades.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <span className={`w-10 font-semibold ${t.side === "BUY" ? "text-green" : "text-red"}`}>{t.side === "BUY" ? "Buy" : "Sell"}</span>
                  <span className="font-mono text-mute text-xs">{short(t.wallet)}</span>
                  <span className="tabular">{fmtSol(t.solLamports)} SOL</span>
                  {!token.pool && <span className="ml-auto text-gold tabular text-xs">+{fmtSol(t.potLamports, 4)}</span>}
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
