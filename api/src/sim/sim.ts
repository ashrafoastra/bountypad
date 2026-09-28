import { createHash, randomUUID } from "node:crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { splitTradeFee, voteMessage, type VoteChoice } from "@bountypad/shared";
import type { Ctx } from "../app";
import { launch } from "../services/launch";
import { emit } from "../services/events";

/** Deterministic sim wallets with real ed25519 keys, so simulated votes carry valid signatures. */
export const SIM_WALLETS = Array.from({ length: 48 }, (_, i) => {
  const seed = createHash("sha256").update(`bountypad-sim-wallet-${i}`).digest();
  const kp = nacl.sign.keyPair.fromSeed(seed);
  return { address: bs58.encode(kp.publicKey), secretKey: kp.secretKey };
});
export const SIM_CREATOR = SIM_WALLETS[0].address;

function rand(min: number, max: number) { return min + Math.random() * (max - min); }

/** One simulated trade: moves holder balances and adds the pot share of the fee to the bounty. */
export async function simTrade(ctx: Ctx, tokenId: string, opts: { side?: "BUY" | "SELL"; sol?: number; walletIdx?: number; quiet?: boolean } = {}) {
  const w = SIM_WALLETS[opts.walletIdx ?? 1 + Math.floor(Math.random() * (SIM_WALLETS.length - 1))];
  let side = opts.side ?? (Math.random() < 0.72 ? "BUY" : "SELL");
  const sol = opts.sol ?? Math.exp(rand(Math.log(0.05), Math.log(9)));
  const lamports = BigInt(Math.round(sol * 1e9));
  const units = lamports / 1000n; // token units, sim only
  if (side === "SELL") {
    const h = (await ctx.db.query(`select balance::text as b from holders where token_id=$1 and wallet=$2`, [tokenId, w.address]))[0];
    if (!h || BigInt(h.b.split(".")[0]) < units) side = "BUY";
  }
  const fee = splitTradeFee(lamports);
  await ctx.db.query(`insert into trades (id, token_id, wallet, side, sol_lamports, pot_lamports) values ($1,$2,$3,$4,$5,$6)`, [
    randomUUID(), tokenId, w.address, side, lamports.toString(), fee.pot.toString(),
  ]);
  await ctx.db.query(
    `insert into holders (token_id, wallet, balance) values ($1,$2,$3)
     on conflict (token_id, wallet) do update set balance = greatest(0, holders.balance + $3)`,
    [tokenId, w.address, (side === "BUY" ? units : -units).toString()],
  );
  await ctx.db.query(`update bounties set pot_lamports = pot_lamports + $2 where token_id=$1`, [tokenId, fee.pot.toString()]);
  if (!opts.quiet) {
    const t = (await ctx.db.query(`select ticker from tokens where id=$1`, [tokenId]))[0];
    await emit(ctx.db, "TRADE", tokenId, null, { side, solLamports: lamports.toString(), potLamports: fee.pot.toString(), wallet: w.address, ticker: t?.ticker });
  }
}

/** Background trading on live coins so pots grow on screen. */
export async function simTradeTick(ctx: Ctx) {
  const live = await ctx.db.query(`select token_id from bounties where status in ('OPEN','DETECTED_CONFIRMING','VOTING')`);
  if (!live.length) return;
  const n = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < n; i++) await simTrade(ctx, live[Math.floor(Math.random() * live.length)].token_id);
}

/** Simulated holders vote with real signatures. yesShare = fraction of voters choosing YES. */
export async function simVotes(ctx: Ctx, roundId: string, yesShare: number, turnout = 0.6) {
  const round = (await ctx.db.query(`select * from vote_rounds where id=$1`, [roundId]))[0];
  if (!round) throw new Error("round not found");
  const inSnap = new Set(((round.snapshot ?? []) as any[]).map((s) => s.wallet));
  const voters = SIM_WALLETS.filter((w) => inSnap.has(w.address) && Math.random() < turnout);
  for (const w of voters) {
    const choice: VoteChoice = Math.random() < yesShare ? "YES" : "NO";
    const sig = bs58.encode(nacl.sign.detached(new TextEncoder().encode(voteMessage(roundId, choice)), w.secretKey));
    await ctx.db.query(`insert into votes (round_id, wallet, choice, signature) values ($1,$2,$3,$4) on conflict do nothing`, [roundId, w.address, choice, sig]);
  }
  return voters.length;
}

const SEED = [
  { name: "Rocket", ticker: "ROCKET", target: "novareyes", action: "TWEET_CASHTAG", trades: 60 },
  { name: "Jax Coin", ticker: "JAX", target: "jaxkimura", action: "VIDEO_PHRASE", phrase: "I am holding Jax coin", trades: 45 },
  { name: "Marsh Mallow", ticker: "MALLOW", target: "alinamarsh", action: "QUOTE_LAUNCH", trades: 30 },
  { name: "Voss Mode", ticker: "VOSS", target: "theo_voss", action: "TWEET_CONTRACT", trades: 22 },
  { name: "Okafor Gold", ticker: "OKGOLD", target: "sofiaokafor", action: "TWEET_CASHTAG", trades: 38 },
  { name: "Zen Byte", ticker: "ZEN", target: "bytezen", action: "TWEET_CASHTAG", trades: 52 },
] as const;

/** First boot in SIM mode: a few live coins with trading history, one already paid out. */
export async function seed(ctx: Ctx) {
  const has = await ctx.db.query(`select count(*)::int as n from tokens`);
  if (has[0].n > 0) return;
  const ids: Record<string, { id: string; bountyId: string }> = {};
  for (const s of SEED) {
    ids[s.ticker] = await launch(ctx, {
      name: s.name, ticker: s.ticker, creatorWallet: SIM_CREATOR, targetHandle: s.target,
      action: s.action, phrase: "phrase" in s ? s.phrase : null, description: `${s.name} challenge coin (simulated)`,
    });
    for (let i = 0; i < s.trades; i++) await simTrade(ctx, ids[s.ticker].id, { side: i < 8 ? "BUY" : undefined, quiet: true });
  }
  // ZenByte already did it, linked a wallet, and got paid: gives the feed a finished example.
  ctx.mockX!.createPost({ username: "bytezen", text: "fine. $ZEN. happy now?" });
  await ctx.db.query(`update profiles set linked_wallet=$1 where username='bytezen'`, [SIM_WALLETS[47].address]);
}
