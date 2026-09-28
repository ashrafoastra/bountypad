/** Third scenario: video bounty -> unclear match -> vote snapshot read from the chain -> holders vote YES -> paid. */
import { Connection, PublicKey } from "@solana/web3.js";
const API = process.env.API || "http://localhost:4000";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ok = (s: string) => console.log(`  ✓ ${s}`);
async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(API + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${j.error ?? ""}`);
  return j;
}
const signTx = async (wallet: string, transaction: string) => (await call("POST", "/api/dev/sign-tx", { wallet, transaction })).signedTransaction as string;
async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined | false>, timeoutSec = 120): Promise<T> {
  const end = Date.now() + timeoutSec * 1000;
  while (Date.now() < end) { const v = await fn(); if (v) return v as T; await sleep(1500); }
  throw new Error(`timed out waiting for: ${label}`);
}
async function main() {
  const [creator, h1, h2, payee] = (await call("GET", "/api/dev/wallets")).slice(7, 11) as string[];
  for (const w of [creator, h1, h2]) await call("POST", "/api/dev/airdrop", { wallet: w, sol: 10 });
  const users = await call("GET", "/api/dev/users");
  const theo = users.find((u: any) => u.username === "theo_voss");
  await call("POST", "/api/me/wallet", { wallet: payee }, { "x-dev-x-user-id": theo.id });
  const prep = await call("POST", "/api/launch/prepare", { name: "Voss Video", ticker: "VID" + Math.random().toString(36).slice(2, 4).toUpperCase().replace(/[^A-Z]/g, "Z"), creatorWallet: creator, targetHandle: "theo_voss", action: "VIDEO_PHRASE", phrase: "I am holding Voss coin", firstBuySol: 1 });
  const c = await call("POST", "/api/launch/submit", { launchId: prep.launchId, signedTransaction: await signTx(creator, prep.transaction) });
  ok("video coin launched (creator bought 1 SOL in the launch tx)");
  for (const [w, sol] of [[h1, 3], [h2, 1]] as const) {
    const t = await call("POST", "/api/trade/prepare", { tokenId: c.id, wallet: w, side: "BUY", amount: String(sol * 1e9) });
    await call("POST", "/api/trade/submit", { tradeId: t.tradeId, signedTransaction: await signTx(w, t.transaction) });
  }
  ok("two holders bought");
  await call("POST", "/api/dev/post", { username: "theo_voss", text: "", video: { transcript: "yeah I am holding Voss", durationSec: 20 } });
  const d = await waitFor("VOTING", async () => { const x = await call("GET", `/api/tokens/${c.id}`); return x.bounty.status === "VOTING" ? x : null; }, 90);
  ok(`unclear video (${d.detections[0].matchScore}% match) -> holder vote`);
  const v = await call("GET", `/api/votes/${d.vote.round.id}?wallet=${creator}`);
  const snapWallets = (await call("GET", `/api/votes/${d.vote.round.id}?wallet=${h1}`));
  if (v.me.eligible) throw new Error("creator is in the snapshot");
  if (!snapWallets.me.eligible) throw new Error("holder missing from on-chain snapshot");
  ok(`snapshot read from Solana: ${v.voters} voters, creator excluded ("${v.me.reason}")`);
  await call("POST", `/api/dev/votes/${d.vote.round.id}`, { yesShare: 1, turnout: 1 });
  await call("POST", "/api/dev/fast-forward", {});
  const conn = new Connection("http://127.0.0.1:8899", "confirmed");
  const before = await conn.getBalance(new PublicKey(payee));
  await waitFor("PAID", async () => (await call("GET", `/api/tokens/${c.id}`)).bounty.status === "PAID", 120);
  ok(`vote passed -> verified on-chain -> paid ${(await conn.getBalance(new PublicKey(payee)) - before) / 1e9} SOL`);
  console.log("\nALL GOOD: video vote with on-chain snapshot\n");
}
main().catch((e) => { console.error(`\n✗ ${(e as Error).message}\n`); process.exit(1); });
