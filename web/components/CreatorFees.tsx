"use client";
import { useEffect, useState } from "react";
import type { Token } from "@bountypad/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { signAndSubmit } from "@/lib/chain";

/**
 * The coin creator's 20% share of trading fees waits in the Meteora pool. Only the creator's
 * wallet can claim it: shown to that wallet only, one signature.
 */
export function CreatorFees({ token }: { token: Token }) {
  const auth = useAuth();
  const [lamports, setLamports] = useState<bigint | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mine = !!auth.wallet && auth.wallet === token.creatorWallet;

  const load = () => api<{ lamports: string }>(`/api/tokens/${token.id}/creator-fees`).then((r) => setLamports(BigInt(r.lamports))).catch(() => {});
  useEffect(() => { if (mine) { load(); const t = setInterval(load, 20_000); return () => clearInterval(t); } }, [mine, token.id]);
  if (!mine || lamports === null) return null;

  const claim = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await signAndSubmit(
        () => api<{ claimId: string; transaction: string }>("/api/creator/claim/prepare", { method: "POST", json: { tokenId: token.id, wallet: auth.wallet } }),
        auth.signTransaction,
        (p, signed) => api<{ tx: string }>("/api/creator/claim/submit", { method: "POST", json: { claimId: p.claimId, signedTransaction: signed } }),
      );
      setMsg(`Claimed. Transaction ${r.tx.slice(0, 10)}…`);
      await load();
    } catch (e) {
      const m = (e as Error).message;
      setMsg(/reject|cancel|denied/i.test(m) ? "You cancelled the signature." : m);
    } finally { setBusy(false); }
  };

  return (
    <div className="frame p-5">
      <div className="flex items-center justify-between"><span className="label">Your creator fees</span><span className="label">20% of trading fees</span></div>
      <div className="flex items-baseline gap-2 mt-3"><span className="num text-[28px] leading-none">{(Number(lamports) / 1e9).toFixed(4)}</span><span className="text-mute">SOL</span></div>
      <button className="btn btn-primary h-11 w-full mt-4" disabled={busy || lamports <= 0n} onClick={claim}>{busy ? "Claiming…" : lamports > 0n ? "Claim to your wallet" : "Nothing to claim yet"}</button>
      {msg && <p className="text-sm text-mute mt-3">{msg}</p>}
    </div>
  );
}
