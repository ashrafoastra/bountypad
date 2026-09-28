/**
 * Second end-to-end scenario (same setup as e2e-chain.ts):
 *  A. target already has a wallet -> verified with it -> admin freeze -> unfreeze -> paid
 *  B. target opts out -> escrow opt-out with 2 of 3 attestations -> pot buys the coin and burns it
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { EscrowClient, OnchainStatus } from "../src/chain/escrow";

const API = process.env.API || "http://localhost:4000";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const step = (s: string) => console.log(`\n▸ ${s}`);
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
  const health = await call("GET", "/api/health");
  const conn = new Connection(health.cluster === "localnet" ? "http://127.0.0.1:8899" : "https://api.devnet.solana.com", "confirmed");
  const escrow = new EscrowClient(conn);
  const [creator, trader, walletA] = (await call("GET", "/api/dev/wallets")).slice(4, 7) as string[];
  for (const w of [creator, trader]) await call("POST", "/api/dev/airdrop", { wallet: w, sol: 10 });
  const users = await call("GET", "/api/dev/users");
  const idOf = (u: string) => users.find((x: any) => x.username === u).id;
  const rnd = () => Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[^A-Z]/g, "Q");

  async function coin(ticker: string, target: string) {
    const prep = await call("POST", "/api/launch/prepare", { name: `Coin ${ticker}`, ticker, creatorWallet: creator, targetHandle: target, action: "TWEET_CASHTAG" });
    const r = await call("POST", "/api/launch/submit", { launchId: prep.launchId, signedTransaction: await signTx(creator, prep.transaction) });
    const t = await call("POST", "/api/trade/prepare", { tokenId: r.id, wallet: trader, side: "BUY", amount: String(3e9) });
    await call("POST", "/api/trade/submit", { tradeId: t.tradeId, signedTransaction: await signTx(trader, t.transaction) });
    await waitFor("pot", async () => BigInt((await call("GET", `/api/tokens/${r.id}`)).bounty.potLamports) > 0n, 60);
    return { ...r, mint: new PublicKey(prep.mint) };
  }
  const bountyOf = async (id: string) => (await call("GET", `/api/tokens/${id}`));

  step("A. target links a wallet first, then posts");
  await call("POST", "/api/me/wallet", { wallet: walletA }, { "x-dev-x-user-id": idOf("jaxkimura") });
  const A = await coin("A" + rnd(), "jaxkimura");
  const tickerA = (await bountyOf(A.id)).token.ticker;
  await call("POST", "/api/dev/post", { username: "jaxkimura", text: `$${tickerA} lets go` });
  await waitFor("verified on-chain with the wallet", async () => {
    const oc = await escrow.bounty(A.mint);
    return oc?.status === OnchainStatus.VERIFIED && oc.payoutWallet.toBase58() === walletA;
  }, 90);
  ok("verified on-chain, payout wallet attested in the same step (Path 1)");

  const payoutId = (await bountyOf(A.id)).payout.id;
  await call("POST", `/api/admin/payouts/${payoutId}/freeze`, {}, { "x-admin-key": "dev-admin" });
  await waitFor("frozen on-chain", async () => (await escrow.bounty(A.mint))?.status === OnchainStatus.FROZEN, 30);
  ok("admin freeze mirrored on-chain");
  await sleep(25_000);
  if ((await escrow.bounty(A.mint))?.status !== OnchainStatus.FROZEN) throw new Error("frozen payout moved");
  ok("stays frozen past the window: nothing released");
  await call("POST", `/api/admin/payouts/${payoutId}/unfreeze`, {}, { "x-admin-key": "dev-admin" });
  await waitFor("verified again", async () => (await escrow.bounty(A.mint))?.status === OnchainStatus.VERIFIED, 30);
  ok("unfrozen: challenge window restarted on-chain");
  const before = BigInt(await conn.getBalance(new PublicKey(walletA)));
  await waitFor("PAID", async () => (await bountyOf(A.id)).bounty.status === "PAID", 90);
  const got = BigInt(await conn.getBalance(new PublicKey(walletA))) - before;
  ok(`paid ${Number(got) / 1e9} SOL to the pre-linked wallet`);

  step("B. target opts out -> pot burned");
  const B = await coin("B" + rnd(), "alinamarsh");
  const potB = BigInt((await bountyOf(B.id)).bounty.potLamports);
  await call("POST", "/api/me/opt-out", {}, { "x-dev-x-user-id": idOf("alinamarsh") });
  await waitFor("opted out on-chain", async () => (await escrow.bounty(B.mint))?.status === OnchainStatus.OPTED_OUT, 60);
  ok("escrow opt-out landed (2 of 3 attestations)");
  const burn = await waitFor("POT_BURNED", async () => (await call("GET", "/api/feed?limit=50")).find((e: any) => e.type === "POT_BURNED" && e.tokenId === B.id), 60);
  const oc = (await escrow.bounty(B.mint))!;
  if (oc.potLamports !== 0n) throw new Error("pot not empty after burn");
  ok(`${Number(burn.data.lamports) / 1e9} SOL pot (was ${Number(potB) / 1e9}) bought $${(await bountyOf(B.id)).token.ticker} and burned it`);

  step("an opted-out person can't be targeted again");
  try { await call("POST", "/api/launch/prepare", { name: "X", ticker: "N" + rnd(), creatorWallet: creator, targetHandle: "alinamarsh", action: "TWEET_CASHTAG" }); throw new Error("accepted"); }
  catch (e) { if (!String(e).includes("opted out")) throw e; ok("rejected"); }

  console.log("\nALL GOOD: freeze/unfreeze/pay with a linked wallet, opt-out burn\n");
}
main().catch((e) => { console.error(`\n✗ ${(e as Error).message}\n`); process.exit(1); });
