/**
 * End-to-end over HTTP against a running API with CHAIN=solana on localnet/devnet and the
 * simulated X (dev tools on). Does what the website does: launch with a wallet signature,
 * trade, then the target posts, and the whole pipeline runs to an on-chain payout.
 *
 *   API=http://localhost:4000 npx tsx scripts/e2e-chain.ts
 */
import { Connection, PublicKey } from "@solana/web3.js";

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

async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined | false>, timeoutSec = 180): Promise<T> {
  const end = Date.now() + timeoutSec * 1000;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v as T;
    await sleep(1500);
  }
  throw new Error(`timed out waiting for: ${label}`);
}

async function main() {
  const health = await call("GET", "/api/health");
  if (health.chain !== "solana" || health.xMode !== "mock" || !health.devTools) throw new Error("Needs CHAIN=solana, the simulated X and dev tools");
  const rpc = health.cluster === "localnet" ? "http://127.0.0.1:8899" : "https://api.devnet.solana.com";
  const conn = new Connection(rpc, "confirmed");
  const [creator, trader, target] = (await call("GET", "/api/dev/wallets")).slice(1, 4) as string[];

  step("fund test wallets");
  for (const w of [creator, trader]) await call("POST", "/api/dev/airdrop", { wallet: w, sol: 10 });
  ok("creator and trader funded");

  step("launch: prepare -> creator's wallet signs -> submit");
  const ticker = "E" + Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[^A-Z]/g, "X");
  const prep = await call("POST", "/api/launch/prepare", {
    name: "E2E Coin", imageUrl: "https://example.com/coin.png", ticker, description: "end to end", creatorWallet: creator,
    targetHandle: "novareyes", action: "TWEET_CASHTAG", deadlineDays: 30, firstBuySol: 0.5,
  });
  const launched = await call("POST", "/api/launch/submit", { launchId: prep.launchId, signedTransaction: await signTx(creator, prep.transaction) });
  ok(`$${ticker} launched: mint ${prep.mint}, tx ${launched.tx.slice(0, 16)}…`);
  const detail = await call("GET", `/api/tokens/${launched.id}`);
  if (detail.token.mint !== prep.mint || !detail.token.pool) throw new Error("token not recorded with its pool");
  ok(`recorded with pool ${detail.token.pool}, bounty ${detail.bounty.status}`);

  step("the same cashtag challenge can't be launched twice");
  try {
    await call("POST", "/api/launch/prepare", { imageUrl: "https://example.com/coin.png", name: "Dup", ticker, creatorWallet: creator, targetHandle: "novareyes", action: "TWEET_CASHTAG" });
    throw new Error("duplicate was accepted");
  } catch (e) { if (!String(e).includes("already exists")) throw e; ok("duplicate rejected"); }

  step("real trades on the bonding curve");
  for (const [side, amount] of [["BUY", 3e9], ["BUY", 2e9]] as const) {
    const t = await call("POST", "/api/trade/prepare", { tokenId: launched.id, wallet: trader, side, amount: String(amount) });
    await call("POST", "/api/trade/submit", { tradeId: t.tradeId, signedTransaction: await signTx(trader, t.transaction) });
  }
  ok("2 buys confirmed");

  step("keeper claims fees into the escrow pot");
  const pot = await waitFor("pot > 0", async () => {
    const d = await call("GET", `/api/tokens/${launched.id}`);
    return BigInt(d.bounty.potLamports) > 0n ? BigInt(d.bounty.potLamports) : null;
  }, 60);
  ok(`pot locked on-chain: ${Number(pot) / 1e9} SOL`);

  step("target posts the cashtag -> detection -> 20s recheck -> verified");
  await call("POST", "/api/dev/post", { username: "novareyes", text: `ok fine $${ticker}` });
  await waitFor("DETECTED_CONFIRMING", async () => (await call("GET", `/api/tokens/${launched.id}`)).bounty.status !== "OPEN", 30);
  ok("detected");
  await waitFor("CHALLENGE_WINDOW", async () => (await call("GET", `/api/tokens/${launched.id}`)).bounty.status === "CHALLENGE_WINDOW", 60);
  ok("verified, challenge window open");

  step("escrow verified on-chain with 2 of 3 verifier signatures");
  await waitFor("audit shows on-chain verify", async () => (await call("GET", `/api/bounties/${launched.bountyId}/audit`)).some((a: any) => a.reason.startsWith("verified on-chain")), 30);
  ok("on-chain verification landed");

  step("no wallet yet -> payout waits for the target (Path 2)");
  await waitFor("AWAITING_CLAIM", async () => (await call("GET", `/api/tokens/${launched.id}`)).payout?.status === "AWAITING_CLAIM", 60);
  ok("awaiting claim");

  step("target logs in with X and links a wallet -> released on-chain");
  const users = await call("GET", "/api/dev/users");
  const nova = users.find((u: any) => u.username === "novareyes");
  const before = BigInt(await conn.getBalance(new PublicKey(target)));
  await call("POST", "/api/me/wallet", { wallet: target }, { "x-dev-x-user-id": nova.id });
  const paid = await waitFor("PAID", async () => {
    const d = await call("GET", `/api/tokens/${launched.id}`);
    return d.bounty.status === "PAID" ? d : null;
  }, 90);
  const after = BigInt(await conn.getBalance(new PublicKey(target)));
  ok(`PAID: ${Number(after - before) / 1e9} SOL arrived in the target's wallet (tx ${paid.payout.txSig.slice(0, 16)}…)`);
  if (after - before < pot) throw new Error("target received less than the pot");

  step("fees after payment keep flowing to the target");
  const t = await call("POST", "/api/trade/prepare", { tokenId: launched.id, wallet: trader, side: "BUY", amount: String(2e9) });
  await call("POST", "/api/trade/submit", { tradeId: t.tradeId, signedTransaction: await signTx(trader, t.transaction) });
  await waitFor("sweep to target", async () => BigInt(await conn.getBalance(new PublicKey(target))) > after, 60);
  ok(`target balance grew to ${Number(await conn.getBalance(new PublicKey(target))) / 1e9} SOL`);

  console.log("\nALL GOOD: launch → trades → pot → post → verification → on-chain payout\n");
}

main().catch((e) => { console.error(`\n✗ ${(e as Error).message}\n`); process.exit(1); });
