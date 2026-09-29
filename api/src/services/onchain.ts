import { PublicKey, Transaction } from "@solana/web3.js";
import type { Ctx } from "../app";
import type { OnchainBounty } from "../chain/escrow";
import { OnchainStatus } from "../chain/escrow";
import { emit } from "./events";
import { releasePool, syncPools } from "./poolmode";

/**
 * CHAIN=solana. The database is the brain (it reads X and runs the status machine); these jobs
 * make the escrow program follow it, and read the real pot back from the chain.
 *
 *   DB status            on-chain action
 *   CHALLENGE_WINDOW     verify (2 of 3 attestations), unfreeze, assign wallet when it appears
 *   FROZEN               freeze (admin)
 *   OPEN after cancel    cancel (admin)
 *   PAID                 release happened in payouts.ts; later fees are swept to the same wallet
 *   EXPIRED / OPTED_OUT  expire / opt_out, then buy the coin with the pot and burn it
 */

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[onchain]", ...a);
const EXPIRY_SEC = 600;
const now = () => Math.floor(Date.now() / 1000);
let adminWarned = false;

/** One on-chain action per bounty at a time (the sync job and a payout can race otherwise). */
const busy = new Set<string>();
async function exclusive<T>(bountyId: string, fn: () => Promise<T>): Promise<T | null> {
  if (busy.has(bountyId)) return null;
  busy.add(bountyId);
  try { return await fn(); } finally { busy.delete(bountyId); }
}

/** Keeper: claim partner fees for every pool, deposit the pot share into its bounty in the same transaction. */
export async function claimFees(ctx: Ctx) {
  const chain = ctx.chain;
  if (!chain || chain.escrowMode === "pool") return; // light mode: fees wait in the pool until payout
  const rows = await ctx.db.query(`select t.id, t.mint, t.ticker, b.id as bounty_id from tokens t join bounties b on b.token_id=t.id where t.pool is not null`);
  for (const t of rows) {
    try {
      const r = await chain.launchpad.claimAndDepositTx(new PublicKey(t.mint), chain.keeper.publicKey, ctx.env.solana.minClaimLamports);
      if (!r) continue;
      const sig = await chain.send(r.tx);
      await ctx.db.query(`insert into fee_claims (token_id, claimed_lamports, pot_lamports, tx_sig) values ($1,$2,$3,$4)`, [t.id, r.claimed.toString(), r.pot.toString(), sig]);
      await emit(ctx.db, "POT_FUNDED", t.id, t.bounty_id, { ticker: t.ticker, potLamports: r.pot.toString(), claimedLamports: r.claimed.toString(), tx: sig });
      log(`$${t.ticker}: claimed ${r.claimed} lamports, ${r.pot} into the pot (${sig})`);
    } catch (e) {
      log(`claim error $${t.ticker}:`, (e as Error).message.slice(0, 300));
    }
  }
}

/** Sync pots from the chain and push the escrow toward the database's status. */
export async function syncBounties(ctx: Ctx) {
  const chain = ctx.chain;
  if (!chain) return;
  if (chain.escrowMode === "pool") return syncPools(ctx);
  const rows = await ctx.db.query(
    `select b.*, t.mint, t.ticker, t.id as token_id, p.linked_wallet, p.username, p.name as target_name
       from bounties b join tokens t on t.id=b.token_id join profiles p on p.x_user_id=b.target_x_user_id
      where t.pool is not null
        and (b.status not in ('PAID','EXPIRED','OPTED_OUT') or b.onchain_status is null
             or (b.status='PAID' and b.onchain_status <> ${OnchainStatus.PAID})
             or (b.status in ('EXPIRED','OPTED_OUT') and b.onchain_status not in (${OnchainStatus.EXPIRED},${OnchainStatus.OPTED_OUT}))
             or b.updated_at > now() - interval '1 day')`,
  );
  for (const b of rows) {
    try {
      const mint = new PublicKey(b.mint);
      // Read inside the lock so a payout that just ran isn't repeated from stale state.
      let oc = await exclusive(b.id, async () => {
        const cur = await chain.escrow.bounty(mint);
        return cur ? (await reconcile(ctx, b, cur)) ?? cur : null;
      });
      if (!oc) continue;
      const pot = oc.status === OnchainStatus.PAID ? oc.totalPaid : [OnchainStatus.EXPIRED, OnchainStatus.OPTED_OUT].includes(oc.status as 4 | 5) ? oc.totalDeposited : oc.potLamports;
      await ctx.db.query(`update bounties set pot_lamports=$2, onchain_status=$3 where id=$1`, [b.id, pot.toString(), oc.status]);
    } catch (e) {
      log(`sync error $${b.ticker}:`, (e as Error).message.slice(0, 300));
    }
  }
}

/** One step toward the DB status. Returns the fresh on-chain state if something was sent. */
async function reconcile(ctx: Ctx, b: any, oc: OnchainBounty): Promise<OnchainBounty | null> {
  const chain = ctx.chain!;
  const mint = new PublicKey(b.mint);
  const reread = () => chain.escrow.bounty(mint);

  switch (b.status) {
    case "CHALLENGE_WINDOW": {
      if (oc.status === OnchainStatus.OPEN) {
        const wallet = await payoutWalletFor(ctx, b);
        const expiry = now() + EXPIRY_SEC;
        const postId = BigInt(b.verified_post_id);
        const msg = chain.escrow.verifyMessage(mint, oc.targetXUserId, postId, wallet, expiry);
        const ixs = await chain.escrow.verify(mint, postId, wallet, expiry, msg, chain.attest(msg));
        const sig = await chain.send(new Transaction().add(...ixs));
        const fresh = (await reread())!;
        await ctx.db.query(`update payouts set challenge_ends_at=to_timestamp($2), wallet=coalesce($3, wallet) where bounty_id=$1`, [b.id, fresh.challengeEnds, wallet?.toBase58() ?? null]);
        await ctx.db.query(`insert into audit_log (bounty_id, from_status, to_status, reason, post_id) values ($1,$2,$2,$3,$4)`, [b.id, b.status, `verified on-chain ${sig}`, b.verified_post_id]);
        log(`$${b.ticker}: verified on-chain (${sig})`);
        return fresh;
      }
      if (oc.status === OnchainStatus.FROZEN) return adminAction(ctx, b, "unfreeze", mint);
      if (oc.status === OnchainStatus.VERIFIED && oc.payoutWallet.equals(PublicKey.default)) {
        const wallet = await payoutWalletFor(ctx, b);
        if (wallet) {
          await assignWallet(ctx, mint, oc, wallet);
          return reread();
        }
      }
      return null;
    }
    case "FROZEN":
      return oc.status === OnchainStatus.VERIFIED ? adminAction(ctx, b, "freeze", mint) : null;
    case "OPEN":
    case "DETECTED_CONFIRMING":
    case "VOTING":
      return oc.status === OnchainStatus.FROZEN ? adminAction(ctx, b, "cancel", mint) : null;
    case "PAID":
      if (oc.status === OnchainStatus.PAID && oc.potLamports >= ctx.env.solana.minClaimLamports) {
        const sig = await chain.send(new Transaction().add(await chain.escrow.release(mint, oc.payoutWallet)));
        await emit(ctx.db, "PAYOUT_SENT", b.token_id, b.id, { amountLamports: oc.potLamports.toString(), target: b.username, ticker: b.ticker, tx: sig, sweep: true });
        return reread();
      }
      return null;
    case "EXPIRED":
    case "OPTED_OUT":
      return burnPot(ctx, b, mint, oc);
  }
  return null;
}

async function burnPot(ctx: Ctx, b: any, mint: PublicKey, oc: OnchainBounty): Promise<OnchainBounty | null> {
  const chain = ctx.chain!;
  const cfg = await chain.escrow.config();
  if (!cfg) return null;
  const treasury = cfg.treasury as PublicKey;
  let sig: string;
  if (oc.status === OnchainStatus.OPEN && b.status === "OPTED_OUT") {
    const expiry = now() + EXPIRY_SEC;
    const msg = chain.escrow.optOutMessage(mint, oc.targetXUserId, expiry);
    sig = await chain.send(new Transaction().add(...(await chain.escrow.optOut(mint, treasury, expiry, msg, chain.attest(msg)))));
  } else if (oc.status === OnchainStatus.OPEN) {
    // The escrow allows expiry only after its own (longer) grace, which covers rechecks and votes.
    if ((await chain.unixTime()) <= oc.deadline + Number(cfg.deadlineGrace)) return null;
    sig = await chain.send(new Transaction().add(await chain.escrow.expire(mint, treasury)));
  } else if ((oc.status === OnchainStatus.EXPIRED || oc.status === OnchainStatus.OPTED_OUT) && oc.potLamports >= ctx.env.solana.minClaimLamports) {
    // Fees that keep arriving after the end are swept in batches, not every tiny claim.
    sig = await chain.send(new Transaction().add(await chain.escrow.expire(mint, treasury))); // sweep later fees
  } else {
    return null;
  }
  const amount = oc.potLamports;
  let burn: Awaited<ReturnType<typeof chain.buyAndBurn>> = null;
  if (amount >= ctx.env.solana.minClaimLamports && treasury.equals(chain.keeper.publicKey)) {
    try { burn = await chain.buyAndBurn(mint, amount); } catch (e) { log(`$${b.ticker}: burn failed, SOL stays in the treasury:`, (e as Error).message.slice(0, 200)); }
  }
  await ctx.db.query(`insert into burns (bounty_id, lamports, sweep_tx, buy_tx, burn_tx, burned_tokens) values ($1,$2,$3,$4,$5,$6)`, [
    b.id, amount.toString(), sig, burn?.buyTx ?? null, burn?.burnTx ?? null, burn?.burned.toString() ?? null,
  ]);
  await emit(ctx.db, "POT_BURNED", b.token_id, b.id, { ticker: b.ticker, lamports: amount.toString(), tx: burn?.burnTx ?? sig });
  log(`$${b.ticker}: pot ${amount} lamports swept (${sig})${burn ? `, bought and burned ${burn.burned} tokens` : ""}`);
  return chain.escrow.bounty(mint);
}

async function adminAction(ctx: Ctx, b: any, action: "freeze" | "unfreeze" | "cancel", mint: PublicKey) {
  const chain = ctx.chain!;
  if (!chain.admin) {
    if (!adminWarned) log(`escrow admin key not configured: "${action}" for $${b.ticker} must be signed by the admin multisig`);
    adminWarned = true;
    return null;
  }
  const sig = await chain.send(new Transaction().add(await chain.escrow.admin(action, mint, chain.admin.publicKey)), chain.admin.publicKey.equals(chain.keeper.publicKey) ? [] : [chain.admin]);
  log(`$${b.ticker}: ${action} on-chain (${sig})`);
  const fresh = await chain.escrow.bounty(mint);
  if (action === "unfreeze" && fresh) await ctx.db.query(`update payouts set challenge_ends_at=to_timestamp($2) where bounty_id=$1`, [b.id, fresh.challengeEnds]);
  return fresh;
}

async function assignWallet(ctx: Ctx, mint: PublicKey, oc: OnchainBounty, wallet: PublicKey) {
  const chain = ctx.chain!;
  const expiry = now() + EXPIRY_SEC;
  const msg = chain.escrow.walletMessage(mint, oc.targetXUserId, oc.postId, wallet, expiry);
  const sig = await chain.send(new Transaction().add(...(await chain.escrow.assignWallet(mint, wallet, expiry, msg, chain.attest(msg)))));
  log(`wallet ${wallet.toBase58()} attested for ${mint.toBase58()} (${sig})`);
}

/** The target's linked wallet, or (Path 1) a Privy wallet pregenerated for their X account. */
async function payoutWalletFor(ctx: Ctx, b: any): Promise<PublicKey | null> {
  let w: string | null = b.linked_wallet;
  if (!w && ctx.privy && ctx.env.privyPregenerate) {
    try {
      w = await ctx.privy.walletForX({ id: b.target_x_user_id, username: b.username, name: b.target_name });
      await ctx.db.query(`update profiles set linked_wallet=$2 where x_user_id=$1`, [b.target_x_user_id, w]);
    } catch (e) {
      log(`Privy pregeneration failed for @${b.username}:`, (e as Error).message);
    }
  }
  return w ? new PublicKey(w) : null;
}

/**
 * Called by payouts.ts once the challenge window is over and a wallet is known: make sure the
 * wallet is attested, sweep the latest fees into the pot, then release. Returns null if the
 * chain isn't ready yet (a later tick retries).
 */
export async function releaseOnchain(ctx: Ctx, p: { bid: string; mint: string; wallet: string; ticker: string }): Promise<{ tx: string | null; amount: string; wallet: string } | null> {
  if (ctx.chain!.escrowMode === "pool") return exclusive(p.bid, () => releasePool(ctx, p));
  return exclusive(p.bid, () => releaseLocked(ctx, p));
}

async function releaseLocked(ctx: Ctx, p: { bid: string; mint: string; wallet: string; ticker: string }) {
  const chain = ctx.chain!;
  const mint = new PublicKey(p.mint);
  let oc = await chain.escrow.bounty(mint);
  if (!oc || oc.status !== OnchainStatus.VERIFIED) return null; // syncBounties submits the verification first
  const wallet = new PublicKey(p.wallet);
  if (oc.payoutWallet.equals(PublicKey.default)) {
    await assignWallet(ctx, mint, oc, wallet);
    oc = (await chain.escrow.bounty(mint))!;
  }
  if ((await chain.unixTime()) < oc.challengeEnds) return null;
  // Fees earned up to this second go to the target too.
  const claim = await chain.launchpad.claimAndDepositTx(mint, chain.keeper.publicKey, 1n);
  if (claim) {
    const sig = await chain.send(claim.tx);
    await ctx.db.query(`insert into fee_claims (token_id, claimed_lamports, pot_lamports, tx_sig) select token_id, $2, $3, $4 from bounties where id=$1`, [p.bid, claim.claimed.toString(), claim.pot.toString(), sig]);
    oc = (await chain.escrow.bounty(mint))!;
  }
  const amount = oc.potLamports;
  const tx = await chain.send(new Transaction().add(await chain.escrow.release(mint, oc.payoutWallet)));
  return { tx, amount: amount.toString(), wallet: oc.payoutWallet.toBase58() };
}
