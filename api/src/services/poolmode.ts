import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import type { Ctx } from "../app";
import { emit } from "./events";

/**
 * Light mode (ESCROW_MODE=pool): no escrow program. The pot is our unclaimed partner fees inside
 * each coin's Meteora pool, where only the keeper (the pool's fee claimer, set in our DBC
 * config) can take them. Nothing leaves the pool before a payout or a burn:
 *
 *   OPEN … CHALLENGE_WINDOW   pot shown live = pot share of the pool's unclaimed partner fees
 *   payout                    claim + transfer the pot share to the target, ONE transaction
 *   PAID                      later fees are swept to the same wallet in batches
 *   EXPIRED / OPTED_OUT       claim, buy the coin with the pot share and burn it
 *
 * The platform keeps the rest of the claim (its 3/8) in the keeper.
 */

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[pool]", ...a);
/** A wallet with 0 SOL can't receive less than the rent-exempt minimum. */
const RENT_MIN = 890_880n;

async function claimAndPay(ctx: Ctx, mint: PublicKey, to: PublicKey, minPot: bigint) {
  const chain = ctx.chain!;
  const c = await chain.launchpad.claimTx(mint, chain.keeper.publicKey);
  if (!c || c.claimed === 0n || c.pot < minPot) return null;
  let amount = c.pot;
  if ((await chain.balance(to)) === 0n && amount < RENT_MIN) amount = RENT_MIN; // keeper covers the tiny gap
  const tx = new Transaction().add(...c.tx!.instructions, SystemProgram.transfer({ fromPubkey: chain.keeper.publicKey, toPubkey: to, lamports: amount }));
  const sig = await chain.send(tx);
  return { sig, claimed: c.claimed, pot: c.pot, paid: amount };
}

/** Payout, called by payouts.ts once the review window is over and the target's wallet is known. */
export async function releasePool(ctx: Ctx, p: { bid: string; mint: string; wallet: string; ticker: string }): Promise<{ tx: string | null; amount: string; wallet: string }> {
  const mint = new PublicKey(p.mint);
  const wallet = new PublicKey(p.wallet);
  const r = await claimAndPay(ctx, mint, wallet, 0n);
  if (!r) {
    // Nothing traded yet: the claim still completes (0 SOL now); later fees are swept to this wallet.
    return { tx: null, amount: "0", wallet: wallet.toBase58() };
  }
  await ctx.db.query(`insert into fee_claims (token_id, claimed_lamports, pot_lamports, tx_sig) select token_id, $2, $3, $4 from bounties where id=$1`, [p.bid, r.claimed.toString(), r.pot.toString(), r.sig]);
  log(`$${p.ticker}: claimed ${r.claimed}, paid ${r.paid} lamports to ${wallet.toBase58()} (${r.sig})`);
  return { tx: r.sig, amount: r.paid.toString(), wallet: wallet.toBase58() };
}

/** Sync job: show the live pot, sweep fees after PAID, burn after EXPIRED / OPTED_OUT. */
export async function syncPools(ctx: Ctx) {
  const chain = ctx.chain;
  if (!chain) return;
  const min = ctx.env.solana.minClaimLamports;
  const rows = await ctx.db.query(
    `select b.id, b.status, b.payout_wallet, t.mint, t.ticker, t.id as token_id, p.username,
            coalesce((select sum(pot_lamports) from fee_claims f where f.token_id=t.id), 0)::text as paid_so_far
       from bounties b join tokens t on t.id=b.token_id join profiles p on p.x_user_id=b.target_x_user_id
      where t.pool is not null`,
  );
  for (const b of rows) {
    try {
      const mint = new PublicKey(b.mint);
      const pending = await chain.launchpad.pendingPot(mint);
      if (pending === null) continue;
      if (b.status === "PAID" && b.payout_wallet && pending >= min) {
        const r = await claimAndPay(ctx, mint, new PublicKey(b.payout_wallet), min);
        if (r) {
          await ctx.db.query(`insert into fee_claims (token_id, claimed_lamports, pot_lamports, tx_sig) values ($1,$2,$3,$4)`, [b.token_id, r.claimed.toString(), r.pot.toString(), r.sig]);
          await emit(ctx.db, "PAYOUT_SENT", b.token_id, b.id, { amountLamports: r.paid.toString(), target: b.username, ticker: b.ticker, tx: r.sig, sweep: true });
          b.paid_so_far = (BigInt(b.paid_so_far) + r.pot).toString();
        }
      } else if ((b.status === "EXPIRED" || b.status === "OPTED_OUT") && pending >= min) {
        await burnPool(ctx, b, mint);
      }
      // PAID / burned: the pot shown is what was paid (or burned) so far; otherwise what waits in the pool.
      const shown = ["PAID", "EXPIRED", "OPTED_OUT"].includes(b.status) ? BigInt(b.paid_so_far) : pending;
      await ctx.db.query(`update bounties set pot_lamports=$2 where id=$1 and pot_lamports is distinct from $2`, [b.id, shown.toString()]);
    } catch (e) {
      log(`sync error $${b.ticker}:`, (e as Error).message.slice(0, 300));
    }
  }
}

async function burnPool(ctx: Ctx, b: any, mint: PublicKey) {
  const chain = ctx.chain!;
  const c = await chain.launchpad.claimTx(mint, chain.keeper.publicKey);
  if (!c?.tx) return;
  const sig = await chain.send(c.tx);
  await ctx.db.query(`insert into fee_claims (token_id, claimed_lamports, pot_lamports, tx_sig) values ($1,$2,$3,$4)`, [b.token_id, c.claimed.toString(), c.pot.toString(), sig]);
  let burn: Awaited<ReturnType<typeof chain.buyAndBurn>> = null;
  try { burn = await chain.buyAndBurn(mint, c.pot); } catch (e) { log(`$${b.ticker}: burn failed, SOL stays with the keeper:`, (e as Error).message.slice(0, 200)); }
  await ctx.db.query(`insert into burns (bounty_id, lamports, sweep_tx, buy_tx, burn_tx, burned_tokens) values ($1,$2,$3,$4,$5,$6)`, [
    b.id, c.pot.toString(), sig, burn?.buyTx ?? null, burn?.burnTx ?? null, burn?.burned.toString() ?? null,
  ]);
  await emit(ctx.db, "POT_BURNED", b.token_id, b.id, { ticker: b.ticker, lamports: c.pot.toString(), tx: burn?.burnTx ?? sig });
  log(`$${b.ticker}: pot ${c.pot} lamports claimed (${sig})${burn ? `, bought and burned ${burn.burned} tokens` : ""}`);
}

/** Launch check in light mode: the pool exists at our config's address for this mint, made by the creator. */
export async function poolMatches(ctx: Ctx, mint: PublicKey, creatorWallet: string, poolAddr: string) {
  const p = await ctx.chain!.launchpad.pool(mint);
  if (!p) return null;
  const s = p.state.poolState;
  return p.address.toBase58() === poolAddr && s.creator.toBase58() === creatorWallet && s.config.toBase58() === ctx.env.solana.dbcConfig;
}
