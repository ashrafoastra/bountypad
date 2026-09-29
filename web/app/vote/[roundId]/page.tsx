"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { voteMessage, type Detection, type TokenSummary, type VoteChoice, type VoteRound, type VoteTally } from "@bountypad/shared";
import { api, useLive } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ago, countdown, short } from "@/lib/format";
import { ErrorNote, PostCard, Skeleton } from "@/components/ui";
import { VoteBars } from "@/components/VoteBars";

type VoteData = { round: VoteRound; tally: VoteTally; detection: Detection; summary: TokenSummary; voters: number; me: { eligible: boolean; voted: VoteChoice | null; reason: string | null } | null };

export default function VotePage() {
  const { roundId } = useParams<{ roundId: string }>();
  const auth = useAuth();
  const { data: d, error, reload } = useLive<VoteData>(`/api/votes/${roundId}${auth.wallet ? `?wallet=${auth.wallet}` : ""}`, { every: 3000, on: (e) => e.type.startsWith("VOTE") });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (error && !d) return <ErrorNote msg={error} />;
  if (!d) return <Skeleton className="h-96" />;
  const { round, tally, detection: det, summary } = d;
  const open = round.result === "PENDING";

  async function vote(choice: VoteChoice) {
    setBusy(true); setMsg(null);
    try {
      const w = auth.wallet;
      if (!w) { auth.login(); setBusy(false); return; }
      const signature = await auth.signMessage(voteMessage(roundId, choice));
      await api(`/api/votes/${roundId}`, { method: "POST", json: { wallet: w, choice, signature } });
      setMsg({ ok: true, text: `Vote recorded: ${choice}. Signed by ${short(w)}, no transaction, no fee.` });
      reload();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    setBusy(false);
  }

  return (
    <div className="max-w-5xl mx-auto grid lg:grid-cols-[1fr_360px] gap-8">
      <div className="flex flex-col gap-5">
        <Link href={`/token/${summary.token.id}`} className="text-mute text-sm hover:text-ink">← {summary.token.name} ${summary.token.ticker}</Link>
        <h1 className="display text-[40px] sm:text-[56px]">Did @{summary.target.username} say it?</h1>
        <p className="text-mute">The transcript was too close to call automatically, so holders at the moment the video was posted decide.</p>
        <div className="card p-5 border-gold/30">
          <div className="label">Required phrase</div>
          <p className="text-2xl mt-2 text-ink">“{summary.bounty.phrase}”</p>
        </div>
        <PostCard name={summary.target.name} username={summary.target.username} verified={summary.target.verified} text={det.text} at={ago(det.postCreatedAt)}>
          <div className="mt-4 aspect-video bg-panel border border-line flex items-center justify-center text-mute text-sm">
            {det.mediaUrl?.startsWith("sim://") ? "Simulated video (no playback in SIM mode)" : det.mediaUrl ? <video src={det.mediaUrl} controls className="w-full h-full" /> : "No video"}
          </div>
          <div className="mt-4 bg-panel border border-line p-4">
            <div className="label mb-2">Transcript · {det.matchScore}% match</div>
            <p className="italic">“{det.transcript}”</p>
          </div>
        </PostCard>
      </div>

      <div className="flex flex-col gap-4 lg:sticky lg:top-24 h-fit">
        <div className="card p-6">
          <div className="flex justify-between label mb-5">
            <span>{open ? "Voting open" : `Closed · ${round.result.toLowerCase().replace("_", " ")}`}</span>
            {open && <span className="text-ink">{countdown(round.closesAt)}</span>}
          </div>
          <VoteBars yes={tally.yesPct} turnout={tally.turnoutPct} />
          {open && !auth.wallet && <button className="btn btn-primary w-full mt-6" onClick={auth.login}>Connect wallet to vote</button>}
          {open && auth.wallet && d.me && !d.me.eligible && <div className="mt-6 border border-line bg-panel px-4 py-3 text-sm text-mute">{d.me.reason}</div>}
          {open && auth.wallet && d.me?.voted && <div className="mt-6 border border-green/40 bg-green/10 px-4 py-3 text-sm text-green">You voted {d.me.voted}. Signed, no fee.</div>}
          {open && auth.wallet && d.me?.eligible && !d.me.voted && (
            <div className="grid grid-cols-2 gap-3 mt-6">
              <button className="btn btn-primary" disabled={busy} onClick={() => vote("YES")}>Yes, said it</button>
              <button className="btn btn-outline !border-red/40 !text-red" disabled={busy} onClick={() => vote("NO")}>No</button>
            </div>
          )}
          {msg && <div className={`mt-4 text-sm ${msg.ok ? "text-green" : "text-red"}`}>{msg.text}</div>}
        </div>
        <div className="card p-5 text-sm text-mute flex flex-col gap-2">
          <p><span className="text-ink">Who can vote:</span> {d.voters} wallets that held ${summary.token.ticker} when the video was detected.</p>
          <p><span className="text-ink">Fair weights:</span> no wallet counts for more than 5% of the vote.</p>
          <p><span className="text-ink">No incentive to block:</span> a NO doesn't pay anyone. Fees stay locked and the challenge stays open.</p>
          <p><span className="text-ink">Free:</span> you sign a message, not a transaction.</p>
        </div>
      </div>
    </div>
  );
}
