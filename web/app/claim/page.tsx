"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Payout, Profile, TokenSummary } from "@bountypad/shared";
import { api, useHealth } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtSol, short } from "@/lib/format";
import { Avatar, ErrorNote, StatusPill, Verified, XIcon } from "@/components/ui";

type Me = { profile: Profile | null; bounties: TokenSummary[]; payouts: Payout[] };
type SimUser = { id: string; username: string; name: string; avatarUrl: string | null; verified: boolean; protected: boolean; parody: boolean };

/** For the people coins name: log in with X, see every coin naming you, receive or opt out. */
export default function Claim() {
  const { data: health } = useHealth();
  const auth = useAuth();
  const [users, setUsers] = useState<SimUser[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [paste, setPaste] = useState("");

  useEffect(() => {
    if (auth.mode === "dev" && health?.sim) api<SimUser[]>("/api/dev/users").then((u) => setUsers(u.filter((x) => !x.protected && !x.parody))).catch(() => {});
  }, [auth.mode, health?.sim]);

  const load = useCallback(async () => {
    if (!auth.x) { setMe(null); return; }
    try { setMe(await api<Me>("/api/me/claims", { headers: await auth.authHeaders() })); setErr(null); }
    catch (e) { setErr((e as Error).message); }
  }, [auth]);
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, [load]);

  async function link(w: string) {
    setErr(null);
    try { await api("/api/me/wallet", { method: "POST", json: { wallet: w }, headers: await auth.authHeaders() }); await load(); }
    catch (e) { setErr((e as Error).message); }
  }
  async function optOut() {
    if (!confirm("Opt out of all bounties? Current and future pots naming you will be burned, not paid.")) return;
    try { await api("/api/me/opt-out", { method: "POST", headers: await auth.authHeaders() }); await load(); }
    catch (e) { setErr((e as Error).message); }
  }

  if (!auth.ready) return null;

  if (!auth.x) return (
    <div className="max-w-xl mx-auto text-center flex flex-col items-center gap-6 pt-6">
      <div className="text-green font-mono text-sm tracking-[.14em] uppercase">Claim</div>
      <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight">Someone put a bounty on your post?</h1>
      <p className="text-mute text-lg">Log in with X to see every coin that names you, collect the ones you've completed, or opt out entirely. A wallet is created for you if you don't have one.</p>
      {auth.mode === "privy" ? (
        <button className="btn btn-primary h-14 px-8 text-lg" onClick={auth.loginWithX}><XIcon size={18} /> {auth.authenticated ? "Link your X account" : "Log in with X"}</button>
      ) : (
        <div className="w-full card p-4 text-left">
          <div className="text-xs font-mono uppercase tracking-widest text-mute mb-3 px-2">Dev mode: log in as a simulated X account</div>
          <div className="grid gap-1">
            {users.map((u) => (
              <button key={u.id} onClick={() => auth.devSetX?.({ id: u.id, username: u.username, name: u.name, avatarUrl: u.avatarUrl })} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-white/[.05] text-left">
                <Avatar name={u.name} src={u.avatarUrl} size={36} /><span className="font-medium flex items-center gap-1">{u.name}{u.verified && <Verified size={14} />}</span><span className="text-mute">@{u.username}</span>
              </button>
            ))}
          </div>
          <p className="text-dim text-xs mt-3 px-2">Set NEXT_PUBLIC_PRIVY_APP_ID to use real X login.</p>
        </div>
      )}
      {err && <ErrorNote msg={err} />}
    </div>
  );

  const p = me?.profile;
  const payoutFor = (bid: string) => me?.payouts.find((x) => x.bountyId === bid);
  const ready = me?.payouts.filter((x) => x.status === "AWAITING_CLAIM") ?? [];
  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-6">
      <div className="card p-6 flex flex-wrap items-center gap-4">
        <Avatar name={auth.x.name} src={auth.x.avatarUrl} size={60} />
        <div><div className="text-xl font-semibold flex items-center gap-1.5">{auth.x.name}<Verified /></div><div className="text-mute flex items-center gap-1.5"><XIcon size={13} />@{auth.x.username}</div></div>
        {auth.mode === "dev" && <button className="ml-auto text-sm text-mute hover:text-ink" onClick={() => auth.devSetX?.(null)}>Switch account</button>}
      </div>

      {ready.length > 0 && !p?.linkedWallet && (
        <div className="rounded-2xl border border-green/40 bg-green/[.07] p-5 text-green">
          {ready.length} completed {ready.length === 1 ? "bounty is" : "bounties are"} waiting for you: {fmtSol(ready.reduce((a, x) => a + BigInt(x.amountLamports), 0n).toString(), 4)} SOL. Choose a wallet below to receive.
        </div>
      )}

      {p && !p.optedOut && (
        <div className="card p-6">
          <div className="text-xs font-mono uppercase tracking-widest text-mute mb-3">Payout wallet</div>
          {p.linkedWallet ? (
            <p>Payouts go to <span className="font-mono text-green">{short(p.linkedWallet, 6)}</span>. Completed bounties are sent automatically.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {auth.wallet && <button className="btn btn-primary w-fit" onClick={() => link(auth.wallet!)}>Receive to my wallet {short(auth.wallet)}</button>}
              {!auth.wallet && <button className="btn btn-primary w-fit" onClick={auth.login}>Connect a wallet</button>}
              <div className="flex flex-col sm:flex-row gap-3">
                <input className="input" placeholder="…or paste any Solana address" value={paste} onChange={(e) => setPaste(e.target.value)} />
                <button className="btn btn-ghost shrink-0" disabled={paste.length < 32} onClick={() => link(paste)}>Use this address</button>
              </div>
            </div>
          )}
        </div>
      )}
      {err && <ErrorNote msg={err} />}

      <div className="flex flex-col gap-3">
        <h2 className="text-[13px] font-mono uppercase tracking-[.14em] text-mute">Coins naming you</h2>
        {me && me.bounties.length === 0 && (
          <div className="card p-6 text-mute">
            No coins name you yet.
            {health?.sim && <> In simulation you can <Link href="/launch" className="text-green">launch one targeting @{auth.x.username}</Link> and post as yourself from <Link href="/dev" className="text-green">Dev</Link>.</>}
          </div>
        )}
        {me?.bounties.map((s) => {
          const po = payoutFor(s.bounty.id);
          return (
            <Link key={s.bounty.id} href={`/token/${s.token.id}`} className="card card-hover p-5 flex flex-wrap items-center gap-4">
              <div className="min-w-0"><div className="font-semibold">{s.token.name} <span className="text-xblue">${s.token.ticker}</span></div><div className="text-sm text-mute">{s.bounty.action.replaceAll("_", " ").toLowerCase()}</div></div>
              <div className="ml-auto text-right">
                <div className="font-bold text-gold tabular">{fmtSol(s.bounty.potLamports, 4)} SOL</div>
                <div className="mt-1">{po?.status === "AWAITING_CLAIM" ? <span className="text-xs text-green">Ready: choose a wallet above</span> : <StatusPill status={s.bounty.status} />}</div>
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
