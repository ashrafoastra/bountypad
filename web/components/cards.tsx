"use client";
import Link from "next/link";
import type { FeedEvent, TokenSummary } from "@bountypad/shared";
import { Avatar, Counter, StatusPill, Verified } from "./ui";
import { actionText, ago, countdown, fmtSol, fmtUsd, sol } from "@/lib/format";

export function TokenCard({ s, solUsd }: { s: TokenSummary; solUsd: number }) {
  const { token, bounty, target } = s;
  const pot = sol(bounty.potLamports);
  return (
    <Link href={`/token/${token.id}`} className="card card-hover p-5 flex flex-col gap-4 group">
      <div className="flex items-center gap-3">
        <Avatar name={token.name} src={token.imageUrl} size={44} square />
        <div className="min-w-0">
          <div className="font-semibold truncate">{token.name}</div>
          <div className="text-xblue text-sm font-medium">${token.ticker}</div>
        </div>
        <div className="ml-auto"><StatusPill status={bounty.status} /></div>
      </div>
      <div>
        <div className="text-mute text-xs font-mono uppercase tracking-widest">Bounty pot</div>
        <div className="flex items-baseline gap-2 mt-1">
          <Counter value={pot} format={(v) => v.toFixed(3)} className="text-gold glow-gold text-[34px] font-bold tracking-tight" />
          <span className="text-gold/80 font-semibold">SOL</span>
          <span className="text-mute text-sm ml-auto">≈ {fmtUsd(pot * solUsd)}</span>
        </div>
      </div>
      <div className="rounded-xl border border-line bg-panel px-3.5 py-3 flex items-center gap-3">
        <Avatar name={target.name} src={target.avatarUrl} size={32} />
        <div className="min-w-0 text-sm">
          <div className="flex items-center gap-1 font-medium truncate">@{target.username}{target.verified && <Verified size={14} />}</div>
          <div className="text-mute truncate">{actionText(bounty.action, token.ticker, bounty.phrase)}</div>
        </div>
      </div>
      <div className="flex justify-between text-xs text-mute font-mono">
        <span>{s.holders} holders · vol {fmtSol(s.volumeLamports, 1)} SOL</span>
        <span>{bounty.status === "OPEN" ? `${countdown(bounty.deadline)} left` : ""}</span>
      </div>
    </Link>
  );
}

const P = {
  launch: "M12 19V5m0 0l-6 6m6-6l6 6",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zm10 3a3 3 0 100-6 3 3 0 000 6z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6L6 18",
  vote: "M4 12l5 5L20 6M4 20h16",
  coin: "M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3 2 2.6 4.5 3 4.5 1.3 4.5 3-2 3-4.5 3-4.5-1.3-4.5-3",
  clock: "M12 7v5l3 2M12 21a9 9 0 110-18 9 9 0 010 18z",
  dot: "M12 12h.01",
};
const EV: Record<string, { d: string; color: string }> = {
  TOKEN_LAUNCHED: { d: P.launch, color: "#f4f5f7" },
  POST_DETECTED: { d: P.eye, color: "#1d9bf0" },
  BOUNTY_VERIFIED: { d: P.check, color: "#3dffa2" },
  BOUNTY_REJECTED: { d: P.x, color: "#ff6b7a" },
  VOTE_OPENED: { d: P.vote, color: "#1d9bf0" },
  VOTE_CLOSED: { d: P.vote, color: "#8b909a" },
  PAYOUT_SENT: { d: P.coin, color: "#f7c75a" },
  BOUNTY_EXPIRED: { d: P.clock, color: "#8b909a" },
  TRADE: { d: P.dot, color: "#8b909a" },
};

export function feedText(e: FeedEvent): string {
  const d = e.data as any;
  const t = d.ticker ? `$${d.ticker}` : "";
  switch (e.type) {
    case "TOKEN_LAUNCHED": return `${t} launched. Challenge for @${d.target}`;
    case "POST_DETECTED": return `@${d.target} posted. ${t} bounty is confirming`;
    case "BOUNTY_VERIFIED": return `${t} bounty verified for @${d.target}`;
    case "BOUNTY_REJECTED": return `${t} attempt rejected: ${d.reason}`;
    case "VOTE_OPENED": return `Holders vote on @${d.target}'s ${t} video (${d.matchScore}% match)`;
    case "VOTE_CLOSED": return `${t} vote ${String(d.outcome).toLowerCase().replace("_", " ")} (${d.yesPct}% yes)`;
    case "PAYOUT_SENT": return `${fmtSol(d.amountLamports, 3)} SOL sent to @${d.target}`;
    case "BOUNTY_EXPIRED": return `${t} bounty expired`;
    case "TRADE": return `${d.side === "BUY" ? "Buy" : "Sell"} ${fmtSol(d.solLamports)} SOL of ${t}`;
    default: return e.type;
  }
}

export function FeedItem({ e }: { e: FeedEvent }) {
  const s = EV[e.type] ?? EV.TRADE;
  const inner = (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/[.03] transition-colors">
      <span className="w-8 h-8 shrink-0 rounded-full bg-panel-2 border border-line flex items-center justify-center">
        <svg width="15" height="15" viewBox="0 0 24 24"><path d={s.d} fill="none" stroke={s.color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      <span className="text-[14px] leading-snug flex-1 min-w-0">{feedText(e)}</span>
      <span className="text-dim text-xs font-mono">{ago(e.at)}</span>
    </div>
  );
  return e.tokenId ? <Link href={`/token/${e.tokenId}`}>{inner}</Link> : inner;
}
