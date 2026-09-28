"use client";
import { useParams } from "next/navigation";
import type { ProfileDetail } from "@bountypad/shared";
import { useHealth, useLive } from "@/lib/api";
import { fmtUsd, sol } from "@/lib/format";
import { Avatar, Counter, Empty, ErrorNote, Section, Skeleton, Verified, XIcon } from "@/components/ui";
import { TokenCard } from "@/components/cards";

export default function ProfilePage() {
  const { handle } = useParams<{ handle: string }>();
  const { data: health } = useHealth();
  const solUsd = health?.solUsd ?? 150;
  const { data: d, error } = useLive<ProfileDetail>(`/api/profiles/${handle}`, { every: 4000, on: (e) => e.type !== "TRADE" });
  if (error && !d) return <ErrorNote msg={error} />;
  if (!d) return <Skeleton className="h-80" />;
  const p = d.profile;
  return (
    <div className="flex flex-col gap-10">
      <div className="card p-6 sm:p-8 flex flex-col sm:flex-row gap-6 sm:items-center">
        <Avatar name={p.name} src={p.avatarUrl} size={88} />
        <div>
          <h1 className="text-3xl font-semibold flex items-center gap-2">{p.name}{p.verified && <Verified size={22} />}</h1>
          <a href={`https://x.com/${p.username}`} target="_blank" rel="noreferrer" className="text-mute inline-flex items-center gap-1.5 mt-1 hover:text-ink"><XIcon size={14} />@{p.username}</a>
          {p.optedOut && <div className="mt-3 text-sm text-mute border border-line rounded-full px-3 py-1 w-fit">Opted out of bounties</div>}
        </div>
        <div className="sm:ml-auto grid grid-cols-2 gap-6">
          <div><div className="text-xs font-mono uppercase tracking-widest text-mute">Waiting for them</div><Counter value={sol(d.lockedLamports)} format={(v) => v.toFixed(3) + " SOL"} className="block text-2xl font-bold text-gold mt-1" /><div className="text-dim text-sm">≈ {fmtUsd(sol(d.lockedLamports) * solUsd)}</div></div>
          <div><div className="text-xs font-mono uppercase tracking-widest text-mute">Earned</div><Counter value={sol(d.earnedLamports)} format={(v) => v.toFixed(3) + " SOL"} className="block text-2xl font-bold text-green mt-1" /><div className="text-dim text-sm">≈ {fmtUsd(sol(d.earnedLamports) * solUsd)}</div></div>
        </div>
      </div>
      <Section title={`Challenges naming @${p.username}`}>
        {d.bounties.length === 0 ? <Empty>No coins name this account yet.</Empty> : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">{d.bounties.map((s) => <TokenCard key={s.token.id} s={s} solUsd={solUsd} />)}</div>
        )}
      </Section>
      <p className="text-dim text-sm">Is this you? <a href="/claim" className="text-green">Log in with X</a> to claim completed bounties or opt out of all future ones.</p>
    </div>
  );
}
