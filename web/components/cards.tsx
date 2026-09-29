"use client";
import Link from "next/link";
import type { FeedEvent, TokenSummary } from "@bountypad/shared";
import { Avatar, Change, Counter, StatusPill, TokenImage, Verified } from "./ui";
import { actionText, ago, countdown, fmtCompact, fmtPrice, fmtSol, fmtUsd, sol } from "@/lib/format";

/** Image-first card: the coin's picture, then the challenge, market and pot. */
export function TokenCard({ s, solUsd }: { s: TokenSummary; solUsd: number }) {
  const { token, bounty, target, market } = s;
  const pot = sol(bounty.potLamports);
  const live = LIVE.includes(bounty.status);
  return (
    <Link href={`/token/${token.id}`} className="card card-hover flex flex-col group">
      <div className="relative aspect-square overflow-hidden border-b border-line">
        <TokenImage name={token.name} ticker={token.ticker} src={token.imageUrl} className="w-full h-full transition-transform duration-700 group-hover:scale-[1.03]" textSize="text-2xl" />
        <div className="absolute top-3 left-3"><StatusPill status={bounty.status} /></div>
      </div>
      <div className="p-4 flex flex-col gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium truncate">{token.name}</span>
            <Change pct={market.change24h} className="text-xs shrink-0" />
          </div>
          <div className="flex items-center gap-1.5 text-sm text-mute mt-1 min-w-0">
            <span className="font-mono text-xs">${token.ticker}</span><span className="text-dim">·</span>
            <span className="truncate">@{target.username}</span>{target.verified && <Verified size={12} />}
          </div>
        </div>
        <div className="grid grid-cols-2 pt-3 border-t border-line">
          <div>
            <div className="label !text-[10px]">Pot</div>
            <div className="num text-[15px] mt-1"><Counter value={pot} format={(v) => v.toFixed(3)} /> <span className="text-mute">SOL</span></div>
          </div>
          <div className="text-right">
            <div className="label !text-[10px]">{live ? "Ends" : "Value"}</div>
            <div className="num text-[15px] mt-1 text-mute">{live ? countdown(bounty.deadline) : fmtUsd(pot * solUsd)}</div>
          </div>
        </div>
      </div>
    </Link>
  );
}

const LIVE = ["OPEN", "DETECTED_CONFIRMING", "VOTING"];
export const ROW_GRID = "grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[28px_minmax(0,1.5fr)_minmax(0,1.7fr)_110px_76px_96px_118px_150px_76px]";

export function TokenTableHead() {
  return (
    <div className={`hidden md:grid ${ROW_GRID} gap-4 px-4 h-10 items-center label !text-[10px] border-b border-line`}>
      <span>#</span><span>Coin</span><span>Challenge</span><span className="text-right">Price</span><span className="text-right">24h</span><span className="text-right">MCap</span><span className="text-right">Pot</span><span>Status</span><span className="text-right">Ends</span>
    </div>
  );
}

/** One row of the challenges table: coin, challenge, market, pot, status. */
export function TokenRow({ s, rank, solUsd }: { s: TokenSummary; rank: number; solUsd: number }) {
  const { token, bounty, target, market } = s;
  const pot = sol(bounty.potLamports);
  return (
    <Link href={`/token/${token.id}`} className={`grid ${ROW_GRID} items-center gap-3 md:gap-4 px-4 py-3 border-b border-line hover:bg-panel transition-colors`}>
      <span className="hidden md:block num text-dim text-sm">{String(rank).padStart(2, "0")}</span>
      <div className="flex items-center gap-3 min-w-0">
        <TokenImage name={token.name} ticker={token.ticker} src={token.imageUrl} className="w-11 h-11 shrink-0 border border-line" textSize="text-[10px]" />
        <div className="min-w-0">
          <div className="font-medium truncate">{token.name} <span className="font-mono text-xs text-mute">${token.ticker}</span></div>
          <div className="text-sm text-mute truncate md:hidden">@{target.username} · {actionText(bounty.action, token.ticker, bounty.phrase)}</div>
        </div>
      </div>
      <div className="hidden md:flex items-center gap-2.5 min-w-0">
        <Avatar name={target.name} src={target.avatarUrl} size={26} />
        <div className="min-w-0 text-sm">
          <div className="flex items-center gap-1 truncate">@{target.username}{target.verified && <Verified size={12} />}</div>
          <div className="text-mute truncate">{actionText(bounty.action, token.ticker, bounty.phrase)}</div>
        </div>
      </div>
      <span className="hidden md:block num text-sm text-right">{fmtPrice(market.priceSol)}</span>
      <Change pct={market.change24h} className="hidden md:block text-sm text-right" />
      <span className="hidden md:block num text-sm text-right text-mute">{market.marketCapSol === null ? "—" : fmtCompact(market.marketCapSol)}</span>
      <div className="text-right">
        <div className="num text-sm">{pot.toFixed(3)} <span className="text-mute">SOL</span></div>
        <div className="num text-[11px] text-dim md:hidden">{fmtUsd(pot * solUsd)} · <Change pct={market.change24h} /></div>
        <div className="num text-[11px] text-dim hidden md:block">{fmtUsd(pot * solUsd)}</div>
      </div>
      <div className="hidden md:block"><StatusPill status={bounty.status} /></div>
      <div className="hidden md:block num text-sm text-mute text-right">{LIVE.includes(bounty.status) ? countdown(bounty.deadline) : "—"}</div>
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
  TOKEN_LAUNCHED: { d: P.launch, color: "#f2f1ee" },
  POST_DETECTED: { d: P.eye, color: "#7eb2ff" },
  BOUNTY_VERIFIED: { d: P.check, color: "#5fcf8f" },
  BOUNTY_REJECTED: { d: P.x, color: "#f0676a" },
  VOTE_OPENED: { d: P.vote, color: "#7eb2ff" },
  VOTE_CLOSED: { d: P.vote, color: "#a7a79f" },
  PAYOUT_SENT: { d: P.coin, color: "#5fcf8f" },
  BOUNTY_EXPIRED: { d: P.clock, color: "#a7a79f" },
  TRADE: { d: P.dot, color: "#a7a79f" },
  POT_FUNDED: { d: P.coin, color: "#e2b04a" },
  POT_BURNED: { d: P.clock, color: "#f0676a" },
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
    <div className="flex items-center gap-3 px-4 py-3 border-b border-line last:border-0 hover:bg-panel-2 transition-colors">
      <span className="w-7 h-7 shrink-0 border border-line-2 flex items-center justify-center">
        <svg width="13" height="13" viewBox="0 0 24 24"><path d={s.d} fill="none" stroke={s.color} strokeWidth="2.2" strokeLinecap="square" /></svg>
      </span>
      <span className="text-[14px] leading-snug flex-1 min-w-0">{feedText(e)}</span>
      <span className="num text-dim text-xs">{ago(e.at)}</span>
    </div>
  );
  return e.tokenId ? <Link href={`/token/${e.tokenId}`}>{inner}</Link> : inner;
}
