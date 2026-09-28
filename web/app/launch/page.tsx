"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { RULES, normalizeTicker, tickerError, type BountyAction, type Profile } from "@bountypad/shared";
import { api, useHealth } from "@/lib/api";
import { connectWallet } from "@/lib/wallet";
import { actionText } from "@/lib/format";
import { Avatar, ErrorNote, Verified, XIcon } from "@/components/ui";

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
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ name: "", ticker: "", imageUrl: "", description: "", handle: "", action: "TWEET_CASHTAG" as BountyAction, phrase: "", deadlineDays: RULES.defaultDeadlineDays });
  const [lookup, setLookup] = useState<Lookup>(null);
  const [looking, setLooking] = useState(false);
  const [wallet, setWallet] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: k === "deadlineDays" ? Number(e.target.value) : e.target.value });

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
    !!f.name.trim() && !!f.ticker && !tErr,
    lookup?.ok === true,
    f.action !== "VIDEO_PHRASE" || f.phrase.trim().split(/\s+/).length >= 2,
    true,
  ];

  async function submit() {
    setErr(null); setBusy(true);
    try {
      let w = wallet;
      if (!w) {
        if (health?.sim) w = "SimCreator111111111111111111111111111111111";
        else w = await connectWallet();
        setWallet(w);
      }
      const r = await api<{ id: string }>("/api/tokens", {
        method: "POST",
        json: { name: f.name, ticker: f.ticker, imageUrl: f.imageUrl || null, description: f.description, creatorWallet: w, targetHandle: f.handle, action: f.action, phrase: f.action === "VIDEO_PHRASE" ? f.phrase : null, deadlineDays: f.deadlineDays },
      });
      router.push(`/token/${r.id}`);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  const target = lookup?.ok ? lookup.profile : null;

  return (
    <div className="grid lg:grid-cols-[1fr_420px] gap-10 max-w-6xl mx-auto">
      <div className="min-w-0">
        <div className="text-green font-mono text-sm tracking-[.14em] uppercase">Launch</div>
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-[-0.035em] mt-3">Launch a coin with a challenge.</h1>
        <p className="text-mute text-lg mt-3">The challenge is written on-chain at launch and can never change.</p>

        <div className="flex flex-wrap gap-2 mt-8 mb-8">
          {STEPS.map((s, i) => (
            <button key={s} onClick={() => i < step || valid.slice(0, i).every(Boolean) ? setStep(i) : null}
              className={`flex items-center gap-2 h-10 px-4 rounded-full border text-sm transition-all ${i === step ? "border-green/60 bg-green/10 text-ink shadow-[0_0_20px_rgba(61,255,162,.15)]" : i < step ? "border-line text-mute" : "border-line text-dim"}`}>
              <span className={`font-mono text-xs ${i <= step ? "text-green" : ""}`}>0{i + 1}</span>{s}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, x: 24, filter: "blur(6px)" }} animate={{ opacity: 1, x: 0, filter: "blur(0px)" }} exit={{ opacity: 0, x: -24, filter: "blur(6px)" }} transition={{ duration: 0.3 }} className="flex flex-col gap-5">
            {step === 0 && (<>
              <Field label="Coin name"><input className="input" maxLength={32} value={f.name} onChange={set("name")} placeholder="Rocket" /></Field>
              <Field label="Ticker" hint={`1 to ${RULES.tickerMaxLength} letters. X only detects short cashtags.`} error={tErr}>
                <input className="input uppercase" value={f.ticker} onChange={set("ticker")} placeholder="ROCKET" />
              </Field>
              <Field label="Image URL" hint="Optional. Upload comes with the on-chain launch."><input className="input" value={f.imageUrl} onChange={set("imageUrl")} placeholder="https://…" /></Field>
              <Field label="Description"><textarea className="input" rows={3} maxLength={280} value={f.description} onChange={set("description")} placeholder="What's the story?" /></Field>
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
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card p-4 flex items-center gap-4 border-green/30">
                  <Avatar name={lookup.profile.name} src={lookup.profile.avatarUrl} size={52} />
                  <div><div className="font-semibold flex items-center gap-1.5">{lookup.profile.name}{lookup.profile.verified && <Verified />}</div><div className="text-mute">@{lookup.profile.username}</div></div>
                  <span className="ml-auto text-green text-sm font-mono">found</span>
                </motion.div>
              ) : <ErrorNote msg={lookup.reason} />)}
              {health?.sim && <p className="text-dim text-sm">Simulation accounts: novareyes, jaxkimura, alinamarsh, theo_voss, sofiaokafor, bytezen. Try lockedlena (private) or novaparody (parody) to see rejections.</p>}
            </>)}

            {step === 2 && (<>
              <div className="grid gap-3">
                {ACTIONS.map((a) => (
                  <button key={a.id} onClick={() => setF({ ...f, action: a.id })}
                    className={`text-left rounded-2xl border p-4 transition-all ${f.action === a.id ? "border-green/60 bg-green/[.06] shadow-[0_0_24px_rgba(61,255,162,.1)]" : "border-line bg-panel hover:border-white/20"}`}>
                    <div className="flex items-center gap-3">
                      <span className={`w-4 h-4 rounded-full border-2 ${f.action === a.id ? "border-green bg-[radial-gradient(#3dffa2_40%,transparent_45%)]" : "border-dim"}`} />
                      <span className="font-semibold">{a.title}</span>
                    </div>
                    <p className="text-mute text-sm mt-1.5 ml-7">{a.desc.replace("TICKER", ticker)}</p>
                  </button>
                ))}
              </div>
              {f.action === "VIDEO_PHRASE" && (
                <Field label="The phrase they must say" hint="Short and natural. Scored against a transcript of their video.">
                  <input className="input" maxLength={80} value={f.phrase} onChange={set("phrase")} placeholder={`I'm holding ${f.name || "Rocket"} coin`} />
                </Field>
              )}
              <Field label={`Deadline: ${f.deadlineDays} days`} hint="If nothing is verified by then, the pot is burned. It never goes to holders.">
                <input type="range" min={7} max={365} value={f.deadlineDays} onChange={set("deadlineDays")} className="w-full accent-[#3dffa2]" />
              </Field>
            </>)}

            {step === 3 && (<>
              <div className="card p-5 flex flex-col gap-3 text-[15px]">
                <Row k="Coin" v={<>{f.name} <span className="text-xblue">${ticker}</span></>} />
                <Row k="Target" v={target ? <>@{target.username}</> : "—"} />
                <Row k="Challenge" v={actionText(f.action, ticker, f.phrase)} />
                <Row k="Deadline" v={`${f.deadlineDays} days`} />
                <div className="h-px bg-line my-1" />
                <Row k="Trading fee" v={`${RULES.fees.tradeFeeBps / 100}%`} />
                <Row k="Of the launchpad share" v={`${RULES.fees.split.potBps / 100}% pot · ${RULES.fees.split.creatorBps / 100}% you · ${RULES.fees.split.platformBps / 100}% platform`} />
              </div>
              <p className="text-dim text-sm">The coin page will say “Not affiliated with @{target?.username ?? "handle"}” until the challenge is verified. The person named hasn't agreed to anything.</p>
              {err && <ErrorNote msg={err} />}
              <button className="btn btn-primary h-14 text-lg" disabled={busy} onClick={submit}>{busy ? "Launching…" : health?.sim ? "Launch (simulated)" : wallet ? "Launch coin" : "Connect wallet & launch"}</button>
            </>)}
          </motion.div>
        </AnimatePresence>

        {step < 3 && (
          <div className="flex gap-3 mt-8">
            {step > 0 && <button className="btn btn-ghost" onClick={() => setStep(step - 1)}>Back</button>}
            <button className="btn btn-primary" disabled={!valid[step]} onClick={() => setStep(step + 1)}>Continue</button>
          </div>
        )}
      </div>

      {/* live preview */}
      <div className="lg:sticky lg:top-24 h-fit">
        <div className="text-mute text-xs font-mono uppercase tracking-widest mb-3">Preview</div>
        <div className="card p-6 flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <Avatar name={f.name || "Coin"} src={f.imageUrl || null} size={48} square />
            <div><div className="font-semibold text-lg">{f.name || "Your coin"}</div><div className="text-xblue font-medium">${ticker}</div></div>
          </div>
          <div>
            <div className="text-mute text-xs font-mono uppercase tracking-widest">Bounty pot</div>
            <div className="text-gold glow-gold text-4xl font-bold mt-1 tabular">0.000 <span className="text-2xl">SOL</span></div>
            <div className="text-dim text-sm mt-1">Fills with every trade</div>
          </div>
          <div className="rounded-xl border border-line bg-panel p-4 flex items-center gap-3">
            <Avatar name={target?.name ?? "?"} src={target?.avatarUrl} size={40} />
            <div className="text-sm min-w-0">
              <div className="font-medium flex items-center gap-1">{target ? <>@{target.username}{target.verified && <Verified size={14} />}</> : <span className="text-dim">Pick a target</span>}</div>
              <div className="text-mute">{actionText(f.action, ticker, f.phrase || "…")}</div>
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
      <span className="text-sm text-mute">{label}</span>
      {children}
      {error ? <span className="text-sm text-red">{error}</span> : hint ? <span className="text-sm text-dim">{hint}</span> : null}
    </label>
  );
}
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-4"><span className="text-mute">{k}</span><span className="text-right">{v}</span></div>;
}
