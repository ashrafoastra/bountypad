import { createHash, randomUUID } from "node:crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { splitTradeFee, voteMessage, type VoteChoice } from "@bountypad/shared";
import type { Ctx } from "../app";
import { launch } from "../services/launch";
import { emit } from "../services/events";
import { SIM_CURVE, TOKEN_DECIMALS, recordTick, simBuy, simNetSol, simPrice, simSell } from "../services/market";

/** Deterministic sim wallets with real ed25519 keys, so simulated votes carry valid signatures. */
export const SIM_WALLETS = Array.from({ length: 48 }, (_, i) => {
  const seed = createHash("sha256").update(`bountypad-sim-wallet-${i}`).digest();
  const kp = nacl.sign.keyPair.fromSeed(seed);
  return { address: bs58.encode(kp.publicKey), secretKey: kp.secretKey };
});
export const SIM_CREATOR = SIM_WALLETS[0].address;

function rand(min: number, max: number) { return min + Math.random() * (max - min); }

/**
 * One simulated trade on the sim bonding curve (x·y=k with virtual reserves): moves the price,
 * holder balances (base units, 6 decimals) and adds the pot share of the fee to the bounty.
 */
export async function simTrade(ctx: Ctx, tokenId: string, opts: { side?: "BUY" | "SELL"; sol?: number; walletIdx?: number; wallet?: string; quiet?: boolean } = {}) {
  const w = opts.wallet ? { address: opts.wallet } : SIM_WALLETS[opts.walletIdx ?? 1 + Math.floor(Math.random() * (SIM_WALLETS.length - 1))];
  let side = opts.side ?? (Math.random() < 0.68 ? "BUY" : "SELL");
  let sol = opts.sol ?? Math.exp(rand(Math.log(0.05), Math.log(4)));
  const net = await simNetSol(ctx.db, tokenId);
  let tokens: number;
  if (side === "SELL") {
    const h = (await ctx.db.query(`select balance::text as b from holders where token_id=$1 and wallet=$2`, [tokenId, w.address]))[0];
    const held = h ? Number(h.b) / 10 ** TOKEN_DECIMALS : 0;
    const s = simSell(net, sol);
    if (held <= 0 || s.sol <= 0) { side = "BUY"; tokens = simBuy(net, sol); }
    else if (s.tokens > held) {
      // Sell what they hold instead: solve the curve for the SOL that many tokens return.
      const v = SIM_CURVE.virtualSol + net, k = SIM_CURVE.virtualSol * SIM_CURVE.virtualTokens;
      sol = v - k / (k / v + held);
      tokens = held;
    } else { sol = s.sol; tokens = s.tokens; }
  } else tokens = simBuy(net, sol);
  const lamports = BigInt(Math.max(1, Math.round(sol * 1e9)));
  const baseUnits = BigInt(Math.floor(tokens * 10 ** TOKEN_DECIMALS));
  const after = net + (side === "BUY" ? 1 : -1) * Number(lamports) / 1e9;
  const price = simPrice(after);
  const fee = splitTradeFee(lamports);
  await ctx.db.query(
    `insert into trades (id, token_id, wallet, side, sol_lamports, pot_lamports, token_amount, price) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [randomUUID(), tokenId, w.address, side, lamports.toString(), fee.pot.toString(), baseUnits.toString(), price],
  );
  await ctx.db.query(
    `insert into holders (token_id, wallet, balance) values ($1,$2,$3)
     on conflict (token_id, wallet) do update set balance = greatest(0, holders.balance + $3)`,
    [tokenId, w.address, (side === "BUY" ? baseUnits : -baseUnits).toString()],
  );
  await ctx.db.query(`update bounties set pot_lamports = pot_lamports + $2 where token_id=$1`, [tokenId, fee.pot.toString()]);
  await recordTick(ctx.db, tokenId, price, lamports, side);
  if (!opts.quiet) {
    const t = (await ctx.db.query(`select ticker from tokens where id=$1`, [tokenId]))[0];
    await emit(ctx.db, "TRADE", tokenId, null, { side, solLamports: lamports.toString(), potLamports: fee.pot.toString(), wallet: w.address, ticker: t?.ticker });
  }
  return { side, lamports, tokens: baseUnits, price };
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

/** Demo coins, only with SIM_SEED=true (local UI work). Their images are generated abstract marks. */
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
      name: s.name, ticker: s.ticker, imageUrl: `${ctx.env.publicApiUrl}/api/placeholder/${s.ticker}.svg`, creatorWallet: SIM_CREATOR, targetHandle: s.target,
      action: s.action, phrase: "phrase" in s ? s.phrase : null, description: `${s.name} challenge coin (simulated)`,
    });
    for (let i = 0; i < s.trades; i++) await simTrade(ctx, ids[s.ticker].id, { side: i < 8 ? "BUY" : undefined, quiet: true });
  }
  // ZenByte already did it, linked a wallet, and got paid: gives the feed a finished example.
  ctx.mockX!.createPost({ username: "bytezen", text: "fine. $ZEN. happy now?" });
  await ctx.db.query(`update profiles set linked_wallet=$1 where username='bytezen'`, [SIM_WALLETS[47].address]);
}
