"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { RULES, normalizeTicker, tickerError, type BountyAction, type PreparedLaunch, type Profile } from "@bountypad/shared";
import { api, useHealth } from "@/lib/api";
import { airdrop, balanceOf, explorer, signAndSubmit } from "@/lib/chain";
import { useAuth } from "@/lib/auth";
import { actionText } from "@/lib/format";
import { Avatar, Brackets, Crosses, ErrorNote, TokenImage, Verified, XIcon } from "@/components/ui";
import { ImageUpload } from "@/components/ImageUpload";
import { SocialIcon } from "@/components/SocialLinks";
import type { LinkKind } from "@bountypad/shared";

const LINK_FIELDS: [LinkKind, string, string][] = [
  ["website", "Website", "https://yourcoin.xyz"],
  ["x", "X", "https://x.com/yourcoin"],
  ["telegram", "Telegram", "https://t.me/yourcoin"],
  ["github", "GitHub", "https://github.com/yourcoin"],
  ["tiktok", "TikTok", "https://tiktok.com/@yourcoin"],
  ["youtube", "YouTube", "https://youtube.com/@yourcoin"],
];

const STEPS = ["Coin", "Target", "Challenge", "Launch"];
const ACTIONS: { id: BountyAction; title: string; desc: string }[] = [
  { id: "TWEET_CASHTAG", title: "Post the cashtag", desc: "They post a message on X containing $TICKER." },
  { id: "TWEET_CONTRACT", title: "Post the contract address", desc: "They post the coin's contract address on X." },
  { id: "QUOTE_LAUNCH", title: "Quote the launch post", desc: "They quote the coin's official launch post on X." },
  { id: "VIDEO_PHRASE", title: "Say it on video", desc: "They post a video on X saying your phrase. Unclear videos go to a holder vote." },
];

type Lookup = { ok: true; profile: Profile } | { ok: false; reason: string } | null;

export default function Launch() {
  const router = useRouter();
  const { data: health } = useHealth();
  const auth = useAuth();
  const [step, setStep] = useState(0);
  const [links, setLinks] = useState<Record<LinkKind, string>>({ website: "", x: "", telegram: "", github: "", tiktok: "", youtube: "" });
  const [f, setF] = useState({ name: "", ticker: "", imageUrl: "", description: "", handle: "", action: "TWEET_CASHTAG" as BountyAction, phrase: "", deadlineDays: RULES.defaultDeadlineDays, firstBuySol: "" });
  const [stage, setStage] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const onchain = health?.chain === "solana";
  useEffect(() => {
    if (!onchain || !auth.wallet) return;
    balanceOf(auth.wallet).then((b) => setBalance(Number(b.lamports) / 1e9)).catch(() => {});
  }, [onchain, auth.wallet, stage]);
  const [lookup, setLookup] = useState<Lookup>(null);
  const [looking, setLooking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: k === "deadlineDays" ? Number(e.target.value) : e.target.value });
  const firstBuy = Number(f.firstBuySol) || 0;

  // Look up the target on X as they type (debounced).
  useEffect(() => {
    if (!f.handle.trim()) { setLookup(null); return; }
    setLooking(true);
    const t = setTimeout(async () => {
      try { setLookup(await api<Lookup>(`/api/x/lookup?handle=${encodeURIComponent(f.handle)}`)); }
      catch (e) { setLookup({ ok: false, reason: (e as Error).message }); }
      setLooking(false);
    }, 450);
    return () => clearTimeout(t);
  }, [f.handle]);

  const tErr = f.ticker ? tickerError(f.ticker) : null;
  const ticker = normalizeTicker(f.ticker) || "TICKER";
  const valid = [
    !!f.name.trim() && !!f.ticker && !tErr && !!f.imageUrl,
    lookup?.ok === true,
    f.action !== "VIDEO_PHRASE" || f.phrase.trim().split(/\s+/).length >= 2,
    true,
  ];

  async function submit() {
    setErr(null); setBusy(true);
    try {
      const w = auth.wallet;
      if (!w) { auth.login(); setBusy(false); return; }
      const body = { name: f.name, ticker: f.ticker, imageUrl: f.imageUrl || null, description: f.description, creatorWallet: w, targetHandle: f.handle, action: f.action, phrase: f.action === "VIDEO_PHRASE" ? f.phrase : null, deadlineDays: f.deadlineDays,
        links: Object.fromEntries(Object.entries(links).filter(([, v]) => v.trim())) };
      if (!onchain) {
        const r = await api<{ id: string }>("/api/tokens", { method: "POST", json: body });
        router.push(`/token/${r.id}`);
        return;
      }
      // On-chain: the API builds the Meteora pool + bounty transaction, your wallet signs it.
      const r = await signAndSubmit(
        () => api<PreparedLaunch>("/api/launch/prepare", { method: "POST", json: { ...body, firstBuySol: firstBuy } }),
        auth.signTransaction,
        (p, signed) => api<{ id: string; tx: string }>("/api/launch/submit", { method: "POST", json: { launchId: p.launchId, signedTransaction: signed } }),
        (s) => setStage(s === "preparing" ? "Checking everything and building the transaction…" : s === "signing" ? "Approve the launch in your wallet…" : "Confirming on Solana…"),
      );
      router.push(`/token/${r.id}?launched=${r.tx}`);
    } catch (e) {
      const m = (e as Error).message;
      setErr(/reject|cancel|denied/i.test(m) ? "You cancelled the signature. Nothing was launched." : m);
      setBusy(false); setStage(null);
    }
  }

  const target = lookup?.ok ? lookup.profile : null;

  return (
    <div className="grid lg:grid-cols-[1fr_400px] gap-10 lg:gap-16 max-w-6xl mx-auto">
      <div className="min-w-0">
        {health?.chain === "sim" && (
          <div className="border border-gold/40 bg-gold/5 px-4 py-3 text-sm mb-8">
            <span className="text-gold">Simulated chain.</span> <span className="text-mute">Launches here are practice only: nothing is created on Solana and no SOL is spent. Real launches need the Solana setup (README, "Real Solana").</span>
          </div>
        )}
        <div className="label">New challenge coin</div>
        <h1 className="display text-[44px] sm:text-[64px] mt-5">Launch a coin</h1>
        <p className="text-mute text-[17px] mt-5 max-w-xl leading-relaxed">Create the coin and its challenge together. The challenge is written on-chain and can never change.</p>

        <div className="grid grid-cols-4 border border-line mt-10 mb-10">
          {STEPS.map((s, i) => (
            <button key={s} onClick={() => i < step || valid.slice(0, i).every(Boolean) ? setStep(i) : null}
              className={`relative flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 h-auto sm:h-12 px-3 sm:px-4 py-2.5 sm:py-0 text-left border-line transition-colors ${i ? "border-l" : ""} ${i === step ? "bg-panel-2 text-ink" : i < step ? "text-ink hover:bg-panel" : "text-dim"}`}>
              <span className="font-mono text-[11px]">{i < step ? "✓" : String(i + 1).padStart(2, "0")}</span><span className="text-[13px] sm:text-sm">{s}</span>
              {i === step && <span className="absolute left-0 right-0 bottom-0 h-px bg-ink" />}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }} className="flex flex-col gap-5">
            {step === 0 && (<>
              <Field label="Coin name"><input className="input" maxLength={32} value={f.name} onChange={set("name")} placeholder="Rocket" /></Field>
              <Field label="Ticker" hint={`1 to ${RULES.tickerMaxLength} letters. X only detects short cashtags.`} error={tErr}>
                <input className="input uppercase" value={f.ticker} onChange={set("ticker")} placeholder="ROCKET" />
              </Field>
              <div className="flex flex-col gap-2">
                <span className="label">Image</span>
                <ImageUpload value={f.imageUrl} onChange={(url) => setF({ ...f, imageUrl: url })} />
              </div>
              <Field label="Description"><textarea className="input" rows={3} maxLength={280} value={f.description} onChange={set("description")} placeholder="What's the story?" /></Field>
              <div className="flex flex-col gap-2">
                <span className="label">Links (optional)</span>
                <div className="grid sm:grid-cols-2 border border-line">
                  {LINK_FIELDS.map(([k, name, ph], i) => (
                    <label key={k} className={`flex items-center gap-3 px-3 h-12 border-line ${i % 2 ? "sm:border-l" : ""} ${i > 0 ? "border-t" : ""} ${i === 1 ? "sm:border-t-0" : ""} focus-within:bg-panel-2`}>
                      <span className="w-6 flex justify-center text-mute"><SocialIcon kind={k} size={15} /></span>
                      <span className="sr-only">{name}</span>
                      <input className="flex-1 min-w-0 bg-transparent outline-none text-[15px] placeholder:text-dim" value={links[k]} onChange={(e) => setLinks({ ...links, [k]: e.target.value })} placeholder={ph} />
                    </label>
                  ))}
                </div>
                <span className="text-sm text-dim">Shown on the coin page and saved in the coin's metadata, so explorers, wallets and trading terminals show them too.</span>
              </div>
            </>)}

            {step === 1 && (<>
              <Field label="Who is the challenge for?" hint="Anyone on X. Private and parody accounts can't be targeted.">
                <div className="relative">
                  <XIcon size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-mute" />
                  <input className="input !pl-11" value={f.handle} onChange={set("handle")} placeholder="@handle or x.com link" autoFocus />
                </div>
              </Field>
              {looking && <div className="text-mute text-sm">Looking up on X…</div>}
              {!looking && lookup && (lookup.ok ? (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="border border-line bg-panel p-4 flex items-center gap-4">
                  <Avatar name={lookup.profile.name} src={lookup.profile.avatarUrl} size={52} />
                  <div><div className="flex items-center gap-1.5">{lookup.profile.name}{lookup.profile.verified && <Verified />}</div><div className="text-mute">@{lookup.profile.username}</div></div>
                  <span className="ml-auto label !text-green">✓ Found</span>
                </motion.div>
              ) : <ErrorNote msg={lookup.reason} />)}
              {health?.xMode === "real" && <p className="text-dim text-sm">Looked up live on X. The permanent account ID is stored, so a renamed or sold handle can never claim.</p>}
              {health?.xMode === "mock" && <p className="text-dim text-sm">Simulation accounts: novareyes, jaxkimura, alinamarsh, theo_voss, sofiaokafor, bytezen. Try lockedlena (private) or novaparody (parody) to see rejections.</p>}
            </>)}

            {step === 2 && (<>
              <div className="grid gap-3">
                {ACTIONS.map((a) => { const off = a.id === "QUOTE_LAUNCH" && health?.platformX === false; return (
                  <button key={a.id} disabled={off} onClick={() => setF({ ...f, action: a.id })}
                    className={`text-left border p-4 transition-colors disabled:opacity-40 disabled:pointer-events-none ${f.action === a.id ? "border-ink bg-panel-2" : "border-line hover:border-line-2 hover:bg-panel"}`}>
                    <div className="flex items-center gap-3">
                      <span className={`w-4 h-4 border flex items-center justify-center ${f.action === a.id ? "border-ink" : "border-dim"}`}>{f.action === a.id && <span className="w-2 h-2 bg-ink" />}</span>
                      <span>{a.title}</span>
                    </div>
                    <p className="text-mute text-sm mt-1.5 ml-7">{off ? "Available once the platform's X account is connected (it publishes the launch post)." : a.desc.replace("TICKER", ticker)}</p>
                  </button>
                ); })}
              </div>
              {f.action === "VIDEO_PHRASE" && (
                <Field label="The phrase they must say" hint="Short and natural. Scored against a transcript of their video.">
                  <input className="input" maxLength={80} value={f.phrase} onChange={set("phrase")} placeholder={`I'm holding ${f.name || "Rocket"} coin`} />
                </Field>
              )}
              <Field label={`Deadline: ${f.deadlineDays} days`} hint="If nothing is verified by then, the pot is burned. It never goes to holders.">
                <input type="range" min={7} max={365} value={f.deadlineDays} onChange={set("deadlineDays")} className="w-full accent-[#f2f1ee]" />
              </Field>
            </>)}

            {step === 3 && (<>
              <div className="frame p-5 flex flex-col gap-3 text-[15px]"><Crosses />
                <Row k="Coin" v={<>{f.name} <span className="font-mono text-mute">${ticker}</span></>} />
                <Row k="Target" v={target ? <>@{target.username}</> : "—"} />
                <Row k="Challenge" v={actionText(f.action, ticker, f.phrase)} />
                <Row k="Deadline" v={`${f.deadlineDays} days`} />
                <div className="h-px bg-line my-1" />
                {onchain && <Row k="Cost to create" v="≈ 0.027 SOL (Solana rent for the pool, the escrow and the metadata) + your first buy" />}
                {Object.values(links).some((v) => v.trim()) && <Row k="Links" v={<span className="flex gap-2 justify-end">{LINK_FIELDS.filter(([k]) => links[k].trim()).map(([k]) => <SocialIcon key={k} kind={k} size={14} />)}</span>} />}
                <Row k="Trading fee" v={health?.feeSchedule ? `${health.feeSchedule.endingFeeBps / 100}% (starts at ${health.feeSchedule.startingFeeBps / 100}% and drops over the first ${Math.round(health.feeSchedule.decaySeconds / 60)} min to stop snipers)` : `${RULES.fees.tradeFeeBps / 100}%`} />
                <Row k="Of the launchpad share" v={`${RULES.fees.split.potBps / 100}% pot · ${RULES.fees.split.creatorBps / 100}% you · ${RULES.fees.split.platformBps / 100}% platform`} />
              </div>
              {onchain && (
                <Field label="Your first buy (optional, SOL)" hint="Bought in the same transaction as the launch, before anyone else, at the lowest fee.">
                  <input className="input" inputMode="decimal" value={f.firstBuySol} onChange={set("firstBuySol")} placeholder="0" />
                </Field>
              )}
              {auth.wallet && <p className="text-mute text-sm">Creator wallet: <span className="font-mono text-ink">{auth.wallet.slice(0, 6)}…{auth.wallet.slice(-6)}</span> (your {RULES.fees.split.creatorBps / 100}% share goes here){onchain && balance !== null && <> · balance <span className="text-ink">{balance.toFixed(3)} SOL</span></>}</p>}
              {onchain && auth.wallet && balance !== null && balance < 0.05 + firstBuy && (
                <div className="border border-gold/30 bg-gold/5 px-4 py-3 text-sm flex flex-wrap items-center gap-3">
                  <span>You need about {(0.05 + firstBuy).toFixed(2)} SOL on {health?.cluster} to launch (network fees + your first buy).</span>
                  {health?.cluster !== "mainnet-beta" && (health?.devTools
                    ? <button className="btn btn-outline h-9 text-sm" onClick={async () => { try { await airdrop(auth.wallet!, 2); setStage(null); setBalance((await balanceOf(auth.wallet!).then((b) => Number(b.lamports) / 1e9))); } catch (e) { setErr((e as Error).message); } }}>Get 2 test SOL</button>
                    : <a className="underline text-gold" href="https://faucet.solana.com" target="_blank" rel="noreferrer">Get free devnet SOL</a>)}
                </div>
              )}
              <p className="text-dim text-sm">The coin page will say “Not affiliated with @{target?.username ?? "handle"}” until the challenge is verified. The person named hasn't agreed to anything.</p>
              {err && <ErrorNote msg={err} />}
              {stage && <div className="flex items-center gap-3 text-sm text-mute"><span className="live-dot" />{stage}</div>}
              <button className="btn btn-primary h-14 text-[16px]" disabled={busy} onClick={submit}>{busy ? "Launching…" : !auth.wallet ? "Connect wallet to launch" : onchain ? `Launch on Solana ${health?.cluster === "mainnet-beta" ? "" : health?.cluster}` : "Launch (simulated)"}</button>
              {onchain && <p className="text-dim text-xs">One transaction creates the coin on Meteora's bonding curve and writes the challenge into the escrow program{health?.escrowProgram && <> (<a className="underline" target="_blank" rel="noreferrer" href={explorer(health, "account", health.escrowProgram)}>view program</a>)</>}. It can never be changed.</p>}
            </>)}
          </motion.div>
        </AnimatePresence>

        {step < 3 && (
          <div className="flex gap-3 mt-8">
            {step > 0 && <button className="btn btn-outline" onClick={() => setStep(step - 1)}>Back</button>}
            <button className="btn-split bg-ink text-[#101010] hover:bg-white transition-colors disabled:opacity-35 disabled:pointer-events-none" disabled={!valid[step]} onClick={() => setStep(step + 1)}><span className="px-5 text-[14px] font-medium">Continue</span><span className="seg">→</span></button>
          </div>
        )}
      </div>

      {/* live preview: the card as it will appear in Explore */}
      <div className="lg:sticky lg:top-24 h-fit">
        <div className="label mb-4">Preview</div>
        <div className="brackets bg-panel border border-line max-w-[360px]">
          <Brackets />
          <TokenImage name={f.name || "Coin"} ticker={ticker} src={f.imageUrl || null} className="w-full aspect-square border-b border-line" textSize="text-3xl" />
          <div className="p-4 flex flex-col gap-3">
            <div>
              <div>{f.name || "Your coin"} <span className="font-mono text-xs text-mute">${ticker}</span></div>
              <div className="flex items-center gap-1.5 text-sm text-mute mt-1">
                {target ? <><Avatar name={target.name} src={target.avatarUrl} size={18} />@{target.username}{target.verified && <Verified size={13} />}</> : "Pick a target"}
              </div>
            </div>
            <div className="text-sm">{actionText(f.action, ticker, f.phrase || "…")}</div>
            <div className="flex items-end justify-between pt-3 border-t border-line">
              <div><div className="label !text-[10px]">Pot</div><div className="num mt-1">0.000 <span className="text-mute">SOL</span></div></div>
              <div className="text-right"><div className="label !text-[10px]">Ends</div><div className="num mt-1 text-mute">{f.deadlineDays}d</div></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="label">{label}</span>
      {children}
      {error ? <span className="text-sm text-red">{error}</span> : hint ? <span className="text-sm text-dim">{hint}</span> : null}
    </label>
  );
}
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-4"><span className="text-mute">{k}</span><span className="text-right">{v}</span></div>;
}
