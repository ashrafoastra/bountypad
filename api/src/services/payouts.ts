import { randomUUID } from "node:crypto";
import { secondsFromNow, type Ctx } from "../app";
import type { Q } from "../db";
import { signAttestation, countValidSignatures, verifyAttestation, type PayoutAttestation } from "../core/payout";
import { isSolanaAddress } from "../core/solana";
import { RULES } from "@bountypad/shared";
import { setStatus } from "./status";
import { emit } from "./events";

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[payouts]", ...a);

/** VERIFIED -> CHALLENGE_WINDOW: a public window where an admin can freeze a bad payout. */
export async function startChallenge(ctx: Ctx, q: Q, bountyId: string, postId: string) {
  const b = (await q.query(`select pot_lamports::text as pot from bounties where id=$1`, [bountyId]))[0];
  await q.query(
    `insert into payouts (id, bounty_id, amount_lamports, challenge_ends_at, status) values ($1,$2,$3,$4,'CHALLENGE_WINDOW')
     on conflict (bounty_id) do nothing`,
    [randomUUID(), bountyId, b.pot, secondsFromNow(ctx.env.timing.challengeWindowSec)],
  );
  await setStatus(q, bountyId, "CHALLENGE_WINDOW", "challenge window opened", postId);
}

/**
 * After the challenge window: if the target has a wallet (linked or pregenerated), sign the
 * attestation and release. If not, the payout waits for their first X login (Path 2).
 */
export async function releaseDue(ctx: Ctx) {
  const due = await ctx.db.query(
    `select p.*, b.target_x_user_id, b.verified_post_id, b.token_id, b.id as bid, pr.linked_wallet, pr.username, pr.name as target_name, t.ticker
       from payouts p join bounties b on b.id=p.bounty_id join profiles pr on pr.x_user_id=b.target_x_user_id join tokens t on t.id=b.token_id
      where b.status='CHALLENGE_WINDOW' and (
            (p.status='CHALLENGE_WINDOW' and p.challenge_ends_at <= now())
         or (p.status='AWAITING_CLAIM' and pr.linked_wallet is not null))`,
  );
  for (const p of due) {
    try {
      if (!p.linked_wallet && ctx.privy && ctx.env.privyPregenerate) {
        // Path 1: a wallet tied to their X account, ready before they ever log in.
        try {
          p.linked_wallet = await ctx.privy.walletForX({ id: p.target_x_user_id, username: p.username, name: p.target_name });
          await ctx.db.query(`update profiles set linked_wallet=$2 where x_user_id=$1`, [p.target_x_user_id, p.linked_wallet]);
          log(`pregenerated Privy wallet for @${p.username}`);
        } catch (e) {
          log(`Privy pregeneration failed for @${p.username}, falling back to claim:`, (e as Error).message);
        }
      }
      if (!p.linked_wallet) {
        if (p.status !== "AWAITING_CLAIM") {
          await ctx.db.query(`update payouts set status='AWAITING_CLAIM' where id=$1`, [p.id]);
          log(`payout for $${p.ticker} awaiting claim by @${p.username}`);
        }
        continue;
      }
      await release(ctx, p);
    } catch (e) {
      log(`payout error ${p.id}:`, (e as Error).message);
    }
  }
}

async function release(ctx: Ctx, p: any) {
  // The amount is the whole pot at release time, including fees earned during the challenge window.
  const amount = (await ctx.db.query(`select pot_lamports::text as pot from bounties where id=$1`, [p.bid]))[0].pot;
  const a: PayoutAttestation = {
    bountyId: p.bid, targetXUserId: p.target_x_user_id, postId: p.verified_post_id, payoutWallet: p.linked_wallet,
    amountLamports: amount, expiry: Math.floor(Date.now() / 1000) + 3600,
  };
  const sigs = [signAttestation(a, ctx.env.verifier.mainSecret)];
  // SIM only: the backup verifier runs in-process. In production it's a separate service
  // that posts its signature to /api/payouts/:id/signatures.
  if (ctx.env.verifier.backupSecret) sigs.push(signAttestation(a, ctx.env.verifier.backupSecret));
  await ctx.db.query(`update payouts set wallet=$2, attestation=$3, signatures=$4, amount_lamports=$5 where id=$1`, [
    p.id, p.linked_wallet, JSON.stringify(a), JSON.stringify(sigs), amount,
  ]);
  if (countValidSignatures(a, sigs, ctx.env.verifier.allowedSigners) < RULES.payout.requiredSignatures) {
    log(`payout ${p.id} waiting for co-signatures`);
    return;
  }
  const tx = await ctx.payouts.release(a, sigs);
  await ctx.db.tx(async (q) => {
    await q.query(`update payouts set status='SENT', tx_sig=$2 where id=$1`, [p.id, tx]);
    await q.query(`update bounties set payout_wallet=$2, paid_tx=$3 where id=$1`, [p.bid, p.linked_wallet, tx]);
    await setStatus(q, p.bid, "PAID", "released on-chain", p.verified_post_id);
  });
  await emit(ctx.db, "PAYOUT_SENT", p.token_id, p.bid, { amountLamports: amount, target: p.username, ticker: p.ticker, tx });
}

/** A separate verifier service adds its signature (2 of 3 required). */
export async function addSignature(ctx: Ctx, payoutId: string, signer: string, signature: string) {
  const p = (await ctx.db.query(`select * from payouts where id=$1`, [payoutId]))[0];
  if (!p?.attestation) throw new Error("payout has no attestation yet");
  if (!ctx.env.verifier.allowedSigners.includes(signer)) throw new Error("signer not allowed");
  if (!verifyAttestation(p.attestation, signer, signature)) throw new Error("bad signature");
  const sigs = [...(p.signatures ?? []).filter((s: any) => s.signer !== signer), { signer, signature }];
  await ctx.db.query(`update payouts set signatures=$2 where id=$1`, [payoutId, JSON.stringify(sigs)]);
}

/** Admin: stop a payout during the challenge window (e.g. the account was hacked). */
export async function freeze(ctx: Ctx, payoutId: string) {
  const p = (await ctx.db.query(`select * from payouts where id=$1`, [payoutId]))[0];
  if (!p || !["CHALLENGE_WINDOW", "AWAITING_CLAIM"].includes(p.status)) throw new Error("only payouts that haven't been sent can be frozen");
  await ctx.db.tx(async (q) => {
    await q.query(`update payouts set status='FROZEN' where id=$1`, [payoutId]);
    await setStatus(q, p.bounty_id, "FROZEN", "frozen by admin");
  });
}

/** Admin: false alarm, restart the challenge window. */
export async function unfreeze(ctx: Ctx, payoutId: string) {
  const p = (await ctx.db.query(`select * from payouts where id=$1`, [payoutId]))[0];
  if (!p || p.status !== "FROZEN") throw new Error("payout is not frozen");
  await ctx.db.tx(async (q) => {
    await q.query(`update payouts set status='CHALLENGE_WINDOW', challenge_ends_at=$2 where id=$1`, [payoutId, secondsFromNow(ctx.env.timing.challengeWindowSec)]);
    await setStatus(q, p.bounty_id, "CHALLENGE_WINDOW", "unfrozen by admin");
  });
}

/** Admin: the verification was wrong. Cancel the payout and reopen the challenge; the pot stays locked. */
export async function cancelFrozen(ctx: Ctx, payoutId: string) {
  const p = (await ctx.db.query(`select * from payouts where id=$1`, [payoutId]))[0];
  if (!p || p.status !== "FROZEN") throw new Error("freeze the payout first");
  await ctx.db.tx(async (q) => {
    await q.query(`update detections set status='REJECTED' where bounty_id=$1 and status='VERIFIED'`, [p.bounty_id]);
    await q.query(`update bounties set verified_post_id=null where id=$1`, [p.bounty_id]);
    await q.query(`delete from payouts where id=$1`, [payoutId]);
    await setStatus(q, p.bounty_id, "OPEN", "payout cancelled by admin, challenge reopened");
  });
}

/** Target logs in with X (Privy) and links a wallet. Future bounties pay instantly. */
export async function linkWallet(ctx: Ctx, xUserId: string, wallet: string) {
  if (!isSolanaAddress(wallet)) throw Object.assign(new Error("That's not a valid Solana address"), { statusCode: 400 });
  await ctx.db.query(`update profiles set linked_wallet=$2 where x_user_id=$1`, [xUserId, wallet]);
  await releaseDue(ctx);
}

/** Target refuses all bounties: every live challenge naming them ends and its pot is burned. */
export async function optOut(ctx: Ctx, xUserId: string) {
  await ctx.db.tx(async (q) => {
    await q.query(`update profiles set opted_out=true where x_user_id=$1`, [xUserId]);
    const live = await q.query(`select id from bounties where target_x_user_id=$1 and status in ('OPEN','DETECTED_CONFIRMING','VOTING')`, [xUserId]);
    for (const b of live) {
      await q.query(`update detections set status='REJECTED' where bounty_id=$1 and status in ('CONFIRMING','VOTING')`, [b.id]);
      await q.query(`update vote_rounds set result='CANCELLED' where bounty_id=$1 and result='PENDING'`, [b.id]);
      await setStatus(q, b.id, "OPTED_OUT", "target opted out, pot to be burned");
    }
  });
}
