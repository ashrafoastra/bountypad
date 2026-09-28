"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { TokenSummary, TokenDetail } from "@bountypad/shared";
import { api, useHealth, useLive } from "@/lib/api";
import { ago } from "@/lib/format";
import { Avatar, ErrorNote, Section, StatusPill } from "@/components/ui";

type SimUser = { id: string; username: string; name: string };
type SimPost = { id: string; username: string; text: string; createdAt: string; deleted: boolean; media: unknown[]; referenced: { type: string }[] };

/** DEV CONTROLS: post as simulated X accounts, run votes, fast-forward. Needs the simulated X + DEV_TOOLS. */
export default function Dev() {
  const { data: health } = useHealth();
  const [users, setUsers] = useState<SimUser[]>([]);
  const { data: tokens } = useLive<TokenSummary[]>("/api/tokens?sort=new", { every: 3000 });
  const mockX = health?.xMode === "mock" && health?.devTools;
  const { data: posts, reload: reloadPosts } = useLive<SimPost[]>(mockX ? "/api/dev/posts" : null, { every: 4000, on: () => false });
  const [f, setF] = useState({ username: "novareyes", kind: "text", text: "", tokenId: "", transcript: "", duration: 20, reply: false, repost: false });
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  useEffect(() => { api<SimUser[]>("/api/dev/users").then(setUsers).catch(() => {}); }, []);
  if (health && !mockX) return <ErrorNote msg="Dev tools need the simulated X and DEV_TOOLS on (never on a public deployment)." />;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setMsg(null);
    try { await fn(); setMsg({ ok: true, t: label }); reloadPosts(); } catch (e) { setMsg({ ok: false, t: (e as Error).message }); }
  };

  async function post() {
    const tok = tokens?.find((t) => t.token.id === f.tokenId)?.token;
    const body: any = { username: f.username, text: f.text, reply: f.reply, repost: f.repost };
    if (f.kind === "quote") { if (!tok?.launchPostId) throw new Error("Pick a coin"); body.quoteOf = tok.launchPostId; }
    if (f.kind === "contract") { if (!tok) throw new Error("Pick a coin"); body.text = `${f.text} ${tok.mint}`.trim(); }
    if (f.kind === "video") body.video = { transcript: f.transcript, durationSec: f.duration };
    await api("/api/dev/post", { method: "POST", json: body });
  }

  const voting = (tokens ?? []).filter((t) => t.bounty.status === "VOTING");

  return (
    <div className="flex flex-col gap-8">
      <div>
        <div className="text-gold font-mono text-sm tracking-[.14em] uppercase">Simulation</div>
        <h1 className="text-4xl font-semibold tracking-tight mt-2">Dev console</h1>
        <p className="text-mute mt-2">Post as a fictional X account and watch the real watcher, verifier, vote and payout logic react. Waits are compressed: recheck {`~20s`}, vote {`~60s`}, challenge window {`~20s`}.</p>
      </div>
      {msg && (msg.ok ? <div className="rounded-xl border border-green/40 bg-green/10 text-green px-4 py-3 text-sm">{msg.t}</div> : <ErrorNote msg={msg.t} />)}

      <div className="grid lg:grid-cols-2 gap-6">
        <Section title="Post on X as…">
          <div className="card p-5 flex flex-col gap-4">
            <select className="input" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })}>
              {users.map((u) => <option key={u.id} value={u.username}>@{u.username} ({u.name})</option>)}
            </select>
            <div className="grid grid-cols-4 gap-2 text-sm">
              {[["text", "Text"], ["quote", "Quote launch"], ["contract", "With contract"], ["video", "Video"]].map(([k, l]) => (
                <button key={k} onClick={() => setF({ ...f, kind: k })} className={`h-10 rounded-xl border ${f.kind === k ? "border-green/60 bg-green/10" : "border-line text-mute"}`}>{l}</button>
              ))}
            </div>
            {(f.kind === "quote" || f.kind === "contract") && (
              <select className="input" value={f.tokenId} onChange={(e) => setF({ ...f, tokenId: e.target.value })}>
                <option value="">Pick a coin…</option>
                {tokens?.map((t) => <option key={t.token.id} value={t.token.id}>${t.token.ticker} → @{t.target.username}</option>)}
              </select>
            )}
            <input className="input" placeholder={f.kind === "text" ? "e.g. ok fine, you win. $ROCKET" : "Post text (optional)"} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
            {f.kind === "video" && (<>
              <textarea className="input" rows={2} placeholder="What they say in the video (transcript)" value={f.transcript} onChange={(e) => setF({ ...f, transcript: e.target.value })} />
              <label className="text-sm text-mute">Length: {f.duration}s <input type="range" min={5} max={300} value={f.duration} onChange={(e) => setF({ ...f, duration: +e.target.value })} className="w-full accent-[#3dffa2]" /></label>
            </>)}
            <div className="flex gap-4 text-sm text-mute">
              <label className="flex items-center gap-2"><input type="checkbox" checked={f.reply} onChange={(e) => setF({ ...f, reply: e.target.checked })} /> as a reply</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={f.repost} onChange={(e) => setF({ ...f, repost: e.target.checked })} /> as a repost</label>
            </div>
            <button className="btn btn-primary" onClick={() => run("Posted. The watcher picks it up within a few seconds.", post)}>Post</button>
          </div>
        </Section>

        <Section title="Time & votes">
          <div className="card p-5 flex flex-col gap-4">
            <button className="btn btn-ghost" onClick={() => run("Fast-forwarded: rechecks, votes and challenge windows are due now.", () => api("/api/dev/fast-forward", { method: "POST" }))}>Fast-forward all timers</button>
            {voting.length === 0 ? <p className="text-mute text-sm">No votes open. Post a video that half-matches the phrase to start one.</p> : voting.map((t) => (
              <VoteBots key={t.token.id} t={t} run={run} />
            ))}
            {health?.chain === "solana" && <p className="text-dim text-xs">On-chain: this only moves the app's timers. The escrow keeps its own clock, so a payout still waits for the challenge window set on-chain ({health.cluster}).</p>}
            {health?.chain !== "solana" && (<>
              <div className="h-px bg-line" />
              <div className="text-sm text-mute">Pump trades on a coin</div>
              <div className="flex flex-wrap gap-2">
                {tokens?.filter((t) => ["OPEN", "DETECTED_CONFIRMING", "VOTING"].includes(t.bounty.status)).map((t) => (
                  <button key={t.token.id} className="btn btn-ghost h-9 px-3 text-sm" onClick={() => run(`10 buys on $${t.token.ticker}`, () => api(`/api/dev/trades/${t.token.id}`, { method: "POST", json: { count: 10 } }))}>${t.token.ticker}</button>
                ))}
              </div>
            </>)}
          </div>
        </Section>
      </div>

      <Section title="Recent simulated posts">
        <div className="card divide-y divide-line">
          {(posts ?? []).filter((p) => p.username !== "bountypad").slice(0, 15).map((p) => (
            <div key={p.id} className={`flex flex-wrap items-center gap-3 px-5 py-3 ${p.deleted ? "opacity-40" : ""}`}>
              <Avatar name={p.username} size={30} />
              <span className="text-mute text-sm">@{p.username}</span>
              <span className="text-sm min-w-0 flex-1 truncate">{p.text || "(no text)"} {p.media.length > 0 && <span className="text-xblue">[video]</span>} {p.referenced.map((r) => <span key={r.type} className="text-dim">[{r.type}]</span>)}</span>
              <span className="text-dim text-xs font-mono">{ago(p.createdAt)}</span>
              {!p.deleted && (<>
                <button className="text-xs text-mute hover:text-ink" onClick={() => { const t = prompt("New text", p.text); if (t !== null) run("Edited (new version id, like X).", () => api("/api/dev/edit", { method: "POST", json: { postId: p.id, text: t } })); }}>edit</button>
                <button className="text-xs text-red" onClick={() => run("Deleted.", () => api("/api/dev/delete", { method: "POST", json: { postId: p.id } }))}>delete</button>
              </>)}
              {p.deleted && <span className="text-xs text-red">deleted</span>}
            </div>
          ))}
        </div>
      </Section>

      <Section title="All coins">
        <div className="card divide-y divide-line">
          {tokens?.map((t) => (
            <Link key={t.token.id} href={`/token/${t.token.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-white/[.02]">
              <span className="text-xblue w-20">${t.token.ticker}</span><span className="text-mute text-sm">@{t.target.username}</span>
              <span className="text-dim text-sm hidden sm:inline">{t.bounty.action}</span>
              <span className="ml-auto"><StatusPill status={t.bounty.status} /></span>
            </Link>
          ))}
        </div>
      </Section>
    </div>
  );
}

function VoteBots({ t, run }: { t: TokenSummary; run: (l: string, fn: () => Promise<unknown>) => void }) {
  const { data } = useLive<TokenDetail>(`/api/tokens/${t.token.id}`, { every: 4000, on: () => false });
  const round = data?.vote?.round;
  if (!round) return null;
  return (
    <div className="rounded-xl border border-line p-3 flex flex-wrap items-center gap-2 text-sm">
      <span>${t.token.ticker} vote</span>
      <Link className="text-green" href={`/vote/${round.id}`}>open</Link>
      <span className="ml-auto flex gap-2">
        <button className="btn btn-ghost h-8 px-3 text-xs" onClick={() => run("Bots voted mostly YES", () => api(`/api/dev/votes/${round.id}`, { method: "POST", json: { yesShare: 0.85 } }))}>Bots: YES</button>
        <button className="btn btn-ghost h-8 px-3 text-xs" onClick={() => run("Bots voted mostly NO", () => api(`/api/dev/votes/${round.id}`, { method: "POST", json: { yesShare: 0.2 } }))}>Bots: NO</button>
      </span>
    </div>
  );
}
