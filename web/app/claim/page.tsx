"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Payout, Profile, TokenSummary } from "@bountypad/shared";
import { api, useHealth } from "@/lib/api";
import { connectWallet } from "@/lib/wallet";
import { fmtSol, short } from "@/lib/format";
import { Avatar, ErrorNote, StatusPill, Verified, XIcon } from "@/components/ui";

type Me = { profile: Profile | null; bounties: TokenSummary[]; payouts: Payout[] };
type SimUser = { id: string; username: string; name: string; verified: boolean; protected: boolean; parody: boolean };

/**
 * Claim page for public figures. REAL mode: "Log in with X" via Privy, which also creates an
 * embedded Solana wallet (waiting on Test A). SIM mode: pick a simulated X account.
 */
export default function Claim() {
  const { data: health } = useHealth();
  const [xUser, setXUser] = useState<string | null>(null);
  const [users, setUsers] = useState<SimUser[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [wallet, setWallet] = useState("");

  useEffect(() => { if (health?.sim) api<SimUser[]>("/api/dev/users").then((u) => setUsers(u.filter((x) => !x.protected && !x.parody))); }, [health?.sim]);
  const load = async (id = xUser) => { if (id) try { setMe(await api<Me>("/api/me/claims", { xUser: id })); } catch (e) { setErr((e as Error).message); } };
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, [xUser]);

  async function link(w: string) {
    setErr(null);
    try { await api("/api/me/wallet", { method: "POST", json: { wallet: w }, xUser }); await load(); } catch (e) { setErr((e as Error).message); }
  }
  async function optOut() {
    if (!confirm("Opt out of all bounties? Current and future pots naming you will be burned, not paid.")) return;
    try { await api("/api/me/opt-out", { method: "POST", xUser }); await load(); } catch (e) { setErr((e as Error).message); }
  }

  if (!xUser) return (
    <div className="max-w-xl mx-auto text-center flex flex-col items-center gap-6 pt-6">
      <div className="text-green font-mono text-sm tracking-[.14em] uppercase">Claim</div>
      <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight">Someone put a bounty on your post?</h1>
      <p className="text-mute text-lg">Log in with X to see every coin that names you, collect the ones you've completed, or opt out entirely.</p>
      {health?.sim ? (
        <div className="w-full card p-4 text-left">
          <div className="text-xs font-mono uppercase tracking-widest text-mute mb-3 px-2">Simulation: log in as</div>
          <div className="grid gap-1">
            {users.map((u) => (
              <button key={u.id} onClick={() => setXUser(u.id)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-white/[.05] text-left">
                <Avatar name={u.name} size={36} /><span className="font-medium flex items-center gap-1">{u.name}{u.verified && <Verified size={14} />}</span><span className="text-mute">@{u.username}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <button className="btn btn-primary h-14 px-8 text-lg" onClick={() => setErr("X login via Privy is wired after Test A (see docs/decisions.md).")}><XIcon size={18} /> Log in with X</button>
      )}
      {err && <ErrorNote msg={err} />}
    </div>
  );

  const p = me?.profile;
  const payoutFor = (bid: string) => me?.payouts.find((x) => x.bountyId === bid);
  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-6">
      <div className="card p-6 flex flex-wrap items-center gap-4">
        {p && <Avatar name={p.name} src={p.avatarUrl} size={60} />}
        <div><div className="text-xl font-semibold flex items-center gap-1.5">{p?.name}{p?.verified && <Verified />}</div><div className="text-mute">@{p?.username}</div></div>
        <button className="ml-auto text-sm text-mute hover:text-ink" onClick={() => { setXUser(null); setMe(null); }}>Log out</button>
      </div>

      {p && !p.optedOut && (
        <div className="card p-6">
          <div className="text-xs font-mono uppercase tracking-widest text-mute mb-3">Payout wallet</div>
          {p.linkedWallet ? (
            <p>Linked to <span className="font-mono text-green">{short(p.linkedWallet, 6)}</span>. Completed bounties are sent here automatically.</p>
          ) : (
            <div className="flex flex-col sm:flex-row gap-3">
              <input className="input" placeholder="Solana wallet address" value={wallet} onChange={(e) => setWallet(e.target.value)} />
              <button className="btn btn-primary shrink-0" disabled={wallet.length < 32} onClick={() => link(wallet)}>Link wallet</button>
              <button className="btn btn-ghost shrink-0" onClick={async () => { try { const w = await connectWallet(); setWallet(w); } catch (e) { setErr((e as Error).message); } }}>Use Phantom</button>
            </div>
          )}
          {health?.sim && !p.linkedWallet && <button className="text-sm text-green mt-3" onClick={async () => link((await api<string[]>("/api/dev/wallets"))[8])}>Use a simulated wallet</button>}
        </div>
      )}
      {err && <ErrorNote msg={err} />}

      <div className="flex flex-col gap-3">
        <h2 className="text-[13px] font-mono uppercase tracking-[.14em] text-mute">Coins naming you</h2>
        {me?.bounties.length === 0 && <div className="card p-6 text-mute">No coins name you yet.</div>}
        {me?.bounties.map((s) => {
          const po = payoutFor(s.bounty.id);
          return (
            <Link key={s.bounty.id} href={`/token/${s.token.id}`} className="card card-hover p-5 flex flex-wrap items-center gap-4">
              <div className="min-w-0"><div className="font-semibold">{s.token.name} <span className="text-xblue">${s.token.ticker}</span></div><div className="text-sm text-mute">{s.bounty.action.replaceAll("_", " ").toLowerCase()}</div></div>
              <div className="ml-auto text-right">
                <div className="font-bold text-gold tabular">{fmtSol(s.bounty.potLamports, 4)} SOL</div>
                <div className="mt-1">{po?.status === "AWAITING_CLAIM" ? <span className="text-xs text-green">Ready: link a wallet to receive</span> : <StatusPill status={s.bounty.status} />}</div>
              </div>
            </Link>
          );
        })}
      </div>

      {p && !p.optedOut && <button className="text-sm text-dim hover:text-red self-start" onClick={optOut}>Opt out of all bounties</button>}
      {p?.optedOut && <p className="text-mute text-sm">You've opted out. New coins can't name you, and pots naming you are burned.</p>}
    </div>
  );
}
