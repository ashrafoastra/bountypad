"use client";
import Link from "next/link";
import type { FeedEvent, TokenSummary } from "@bountypad/shared";
import { Avatar, Counter, StatusPill, TokenImage, Verified } from "./ui";
import { actionText, ago, countdown, fmtSol, fmtUsd, sol } from "@/lib/format";

/** Image-first card (the NFT-marketplace pattern): the coin's picture, then the challenge and its pot. */
export function TokenCard({ s, solUsd }: { s: TokenSummary; solUsd: number }) {
  const { token, bounty, target } = s;
  const pot = sol(bounty.potLamports);
  const live = ["OPEN", "DETECTED_CONFIRMING", "VOTING"].includes(bounty.status);
  return (
    <Link href={`/token/${token.id}`} className="card card-hover overflow-hidden flex flex-col group">
      <div className="relative aspect-square overflow-hidden bg-panel">
        <TokenImage name={token.name} ticker={token.ticker} src={token.imageUrl} rounded="" className="w-full h-full transition-transform duration-500 group-hover:scale-[1.04]" textSize="text-3xl" />
        <div className="absolute top-3 left-3"><StatusPill status={bounty.status} /></div>
      </div>
      <div className="p-4 flex flex-col gap-3">
        <div className="min-w-0">
          <div className="font-semibold truncate">{token.name} <span className="text-mute font-medium">${token.ticker}</span></div>
          <div className="flex items-center gap-1.5 text-sm text-mute mt-1 min-w-0">
            <Avatar name={target.name} src={target.avatarUrl} size={18} />
            <span className="truncate">@{target.username}</span>{target.verified && <Verified size={13} />}
          </div>
        </div>
        <div className="flex items-end justify-between gap-2 pt-3 border-t border-line">
          <div>
            <div className="text-xs text-mute">Pot</div>
            <div className="font-semibold tabular"><Counter value={pot} format={(v) => v.toFixed(3)} /> SOL</div>
          </div>
          <div className="text-right text-xs text-mute">
            {live ? <>{countdown(bounty.deadline)} left</> : <>≈ {fmtUsd(pot * solUsd)}</>}
          </div>
        </div>
      </div>
    </Link>
  );
}

/** One row of the "Top bounties" table. */
export function TokenRow({ s, rank, solUsd }: { s: TokenSummary; rank: number; solUsd: number }) {
  const { token, bounty, target } = s;
  const pot = sol(bounty.potLamports);
  return (
    <Link href={`/token/${token.id}`} className="grid grid-cols-[28px_1fr_auto] md:grid-cols-[36px_minmax(0,2.2fr)_minmax(0,2fr)_130px_150px_110px] items-center gap-3 md:gap-4 px-3 py-3 rounded-xl hover:bg-panel transition-colors">
      <span className="text-mute font-semibold text-sm text-center tabular">{rank}</span>
      <div className="flex items-center gap-3 min-w-0">
        <TokenImage name={token.name} ticker={token.ticker} src={token.imageUrl} className="w-12 h-12 shrink-0" textSize="text-[11px]" />
        <div className="min-w-0">
          <div className="font-semibold truncate">{token.name}</div>
          <div className="text-sm text-mute truncate md:hidden">@{target.username} · {actionText(bounty.action, token.ticker, bounty.phrase)}</div>
          <div className="text-sm text-mute hidden md:block">${token.ticker}</div>
        </div>
      </div>
      <div className="hidden md:flex items-center gap-2.5 min-w-0">
        <Avatar name={target.name} src={target.avatarUrl} size={28} />
        <div className="min-w-0 text-sm">
          <div className="font-medium flex items-center gap-1 truncate">@{target.username}{target.verified && <Verified size={13} />}</div>
          <div className="text-mute truncate">{actionText(bounty.action, token.ticker, bounty.phrase)}</div>
        </div>
      </div>
      <div className="text-right md:text-left">
        <div className="font-semibold tabular">{pot.toFixed(3)} SOL</div>
        <div className="text-xs text-mute tabular">{fmtUsd(pot * solUsd)}</div>
      </div>
      <div className="hidden md:block"><StatusPill status={bounty.status} /></div>
      <div className="hidden md:block text-sm text-mute text-right tabular">{["OPEN", "DETECTED_CONFIRMING", "VOTING"].includes(bounty.status) ? countdown(bounty.deadline) : "—"}</div>
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
  TOKEN_LAUNCHED: { d: P.launch, color: "#121212" },
  POST_DETECTED: { d: P.eye, color: "#1d9bf0" },
  BOUNTY_VERIFIED: { d: P.check, color: "#16813d" },
  BOUNTY_REJECTED: { d: P.x, color: "#ff6b7a" },
  VOTE_OPENED: { d: P.vote, color: "#1d9bf0" },
  VOTE_CLOSED: { d: P.vote, color: "#8b909a" },
  PAYOUT_SENT: { d: P.coin, color: "#16813d" },
  BOUNTY_EXPIRED: { d: P.clock, color: "#8b909a" },
  TRADE: { d: P.dot, color: "#8b909a" },
  POT_FUNDED: { d: P.coin, color: "#b26b00" },
  POT_BURNED: { d: P.clock, color: "#d9304f" },
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
    case "POT_FUNDED": return `${fmtSol(d.potLamports, 4)} SOL locked in the ${t} pot`;
    case "POT_BURNED": return `${t} pot (${fmtSol(d.lamports, 3)} SOL) bought and burned`;
    case "TRADE": return `${d.side === "BUY" ? "Buy" : "Sell"} ${fmtSol(d.solLamports)} SOL of ${t}`;
    default: return e.type;
  }
}

export function FeedItem({ e }: { e: FeedEvent }) {
  const s = EV[e.type] ?? EV.TRADE;
  const inner = (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-panel transition-colors">
      <span className="w-8 h-8 shrink-0 rounded-full bg-panel flex items-center justify-center">
        <svg width="15" height="15" viewBox="0 0 24 24"><path d={s.d} fill="none" stroke={s.color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      <span className="text-[14px] leading-snug flex-1 min-w-0">{feedText(e)}</span>
      <span className="text-dim text-xs tabular">{ago(e.at)}</span>
    </div>
  );
  return e.tokenId ? <Link href={`/token/${e.tokenId}`}>{inner}</Link> : inner;
}
