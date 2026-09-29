"use client";
import { useEffect, useState } from "react";
import type { Health, PreparedTrade, Token } from "@bountypad/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { airdrop, balanceOf, explorer, signAndSubmit } from "@/lib/chain";

const DECIMALS = 1e6; // launchpad tokens use 6 decimals

/** Real trades on the Meteora bonding curve: the API builds the swap, the wallet signs. */
export function TradePanel({ token, health }: { token: Token; health: Health }) {
  const auth = useAuth();
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [amount, setAmount] = useState("0.1");
  const [bal, setBal] = useState<{ sol: number; tokens: number } | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; tx?: string } | null>(null);

  const refresh = async () => {
    if (!auth.wallet) return;
    try {
      const b = await balanceOf(auth.wallet, token.mint);
      setBal({ sol: Number(b.lamports) / 1e9, tokens: Number(b.tokenAmount ?? 0) / DECIMALS });
    } catch { /* ignore */ }
  };
  useEffect(() => { refresh(); }, [auth.wallet, token.mint]); // eslint-disable-line react-hooks/exhaustive-deps

  async function trade() {
    if (!auth.wallet) return auth.login();
    setMsg(null);
    const n = Number(amount);
    if (!(n > 0)) return setMsg({ ok: false, text: "Enter an amount" });
    const base = side === "BUY" ? Math.round(n * 1e9) : Math.floor(n * DECIMALS);
    try {
      const r = await signAndSubmit(
        () => api<PreparedTrade>("/api/trade/prepare", { method: "POST", json: { tokenId: token.id, wallet: auth.wallet, side, amount: String(base) } }),
        auth.signTransaction,
        (p, signed) => api<{ tx: string }>("/api/trade/submit", { method: "POST", json: { tradeId: p.tradeId, signedTransaction: signed } }),
        (s) => setStage(s === "preparing" ? "Getting a quote…" : s === "signing" ? "Approve in your wallet…" : "Confirming on Solana…"),
      );
      setMsg({ ok: true, text: side === "BUY" ? `Bought $${token.ticker}` : `Sold $${token.ticker}`, tx: r.tx });
      refresh();
    } catch (e) {
      const m = (e as Error).message;
      setMsg({ ok: false, text: /reject|cancel|denied/i.test(m) ? "Signature cancelled." : m });
    } finally { setStage(null); }
  }

  const presets = side === "BUY" ? ["0.1", "0.5", "1"] : ["25%", "50%", "100%"];
  // Anti-sniper fee: decays exponentially from the starting fee to the base fee after launch.
  const fs = health.feeSchedule;
  const age = (Date.now() - Date.parse(token.createdAt)) / 1000;
  const earlyFee = fs && age < fs.decaySeconds ? (fs.startingFeeBps * Math.pow(fs.endingFeeBps / fs.startingFeeBps, Math.max(0, age) / fs.decaySeconds)) / 100 : null;
  return (
    <div className="frame p-5">
      <div className="flex items-center justify-between mb-4">
        <span className="label">Trade</span>
        <span className="label !text-dim">Meteora DBC · {health.cluster}</span>
      </div>
      {earlyFee !== null && fs && (
        <div className="border border-gold/30 bg-gold/5 px-3 py-2 text-xs mb-4 text-mute">
          Launch fee active: about <span className="text-gold num">{earlyFee.toFixed(1)}%</span> right now, dropping to {fs.endingFeeBps / 100}% in {Math.ceil(fs.decaySeconds - age)}s. It stops snipers.
        </div>
      )}
      <div className="grid grid-cols-2 border border-line-2 mb-4">
        {(["BUY", "SELL"] as const).map((s) => (
          <button key={s} onClick={() => { setSide(s); setAmount(s === "BUY" ? "0.1" : ""); setMsg(null); }}
            className={`h-10 text-sm transition-colors ${side === s ? (s === "BUY" ? "bg-green text-[#101010]" : "bg-red text-[#101010]") : "text-mute hover:text-ink"}`}>{s === "BUY" ? "Buy" : "Sell"}</button>
        ))}
      </div>
      <div className="relative">
        <input className="input !pr-24 num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" />
        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-mute font-mono text-xs">{side === "BUY" ? "SOL" : `$${token.ticker}`}</span>
      </div>
      <div className="flex gap-2 mt-3">
        {presets.map((p) => (
          <button key={p} className="btn btn-outline h-8 !px-2 font-mono text-[11px] flex-1" onClick={() => setAmount(p.endsWith("%") ? String(((bal?.tokens ?? 0) * Number(p.slice(0, -1))) / 100) : p)}>{p}</button>
        ))}
      </div>
      {auth.wallet && bal && (
        <div className="num text-xs text-dim mt-3 flex justify-between"><span>{bal.sol.toFixed(3)} SOL</span><span>{bal.tokens.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${token.ticker}</span></div>
      )}
      <button className={`btn w-full h-12 mt-4 ${side === "BUY" ? "btn-primary" : "btn-outline !text-red !border-red/40"}`} disabled={!!stage} onClick={trade}>
        {stage ?? (!auth.wallet ? "Connect wallet to trade" : side === "BUY" ? `Buy $${token.ticker}` : `Sell $${token.ticker}`)}
      </button>
      {msg && (
        <p className={`text-sm mt-3 ${msg.ok ? "text-green" : "text-red"}`}>
          {msg.text}{msg.tx && <> · <a className="underline" target="_blank" rel="noreferrer" href={explorer(health, "tx", msg.tx)}>view transaction</a></>}
        </p>
      )}
      {auth.wallet && bal && bal.sol < 0.02 && health.cluster !== "mainnet-beta" && (
        <p className="text-xs text-mute mt-3">
          Need test SOL?{" "}
          {health.devTools
            ? <button className="text-ink underline" onClick={async () => { try { await airdrop(auth.wallet!, 2); refresh(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } }}>Get 2 SOL</button>
            : <a className="text-ink underline" href="https://faucet.solana.com" target="_blank" rel="noreferrer">faucet.solana.com</a>}
        </p>
      )}
      {health.maxBuySol > 0 && <p className="text-xs text-gold mt-3">Early access: buys are limited to {health.maxBuySol} SOL per transaction.</p>}
      <p className="text-xs text-dim mt-3">Every trade pays a fee. Part of it fills this coin's pot, locked in the escrow until the challenge is verified.</p>
    </div>
  );
}
