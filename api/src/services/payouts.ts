import { randomUUID } from "node:crypto";
import { secondsFromNow, type Ctx } from "../app";
import { signAttestation, countValidSignatures, verifyAttestation, type PayoutAttestation } from "../core/payout";
import { RULES } from "@bountypad/shared";
import { setStatus } from "./status";
import { emit } from "./events";

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[payouts]", ...a);

/** VERIFIED -> CHALLENGE_WINDOW: a public window where an admin can freeze a bad payout. */
export async function startChallenge(ctx: Ctx, bountyId: string, postId: string) {
  const b = (await ctx.db.query(`select pot_lamports::text as pot from bounties where id=$1`, [bountyId]))[0];
  await ctx.db.query(
    `insert into payouts (id, bounty_id, amount_lamports, challenge_ends_at, status) values ($1,$2,$3,$4,'CHALLENGE_WINDOW')
     on conflict (bounty_id) do nothing`,
    [randomUUID(), bountyId, b.pot, secondsFromNow(ctx.env.timing.challengeWindowSec)],
  );
  await setStatus(ctx.db, bountyId, "CHALLENGE_WINDOW", "challenge window opened", postId);
}

function attestation(p: any, b: any, wallet: string): PayoutAttestation {
  return {
    bountyId: b.id, targetXUserId: b.target_x_user_id, postId: b.verified_post_id, payoutWallet: wallet,
    amountLamports: String(p.amount_lamports), expiry: Math.floor(Date.now() / 1000) + 3600,
  };
}

/**
 * After the challenge window: if the target has a wallet (linked or pregenerated), sign the
 * attestation and release. If not, the payout waits for their first X login (Path 2).
 */
export async function releaseDue(ctx: Ctx) {
  const due = await ctx.db.query(
    `select p.*, b.target_x_user_id, b.verified_post_id, b.token_id, b.id as bid, pr.linked_wallet, pr.username, t.ticker
       from payouts p join bounties b on b.id=p.bounty_id join profiles pr on pr.x_user_id=b.target_x_user_id join tokens t on t.id=b.token_id
      where (p.status='CHALLENGE_WINDOW' and p.challenge_ends_at <= now()) or (p.status='AWAITING_CLAIM' and pr.linked_wallet is not null)`,
  );
  for (const p of due) {
    if (!p.linked_wallet) {
      if (p.status !== "AWAITING_CLAIM") {
        await ctx.db.query(`update payouts set status='AWAITING_CLAIM' where id=$1`, [p.id]);
        log(`payout for $${p.ticker} awaiting claim by @${p.username}`);
      }
      continue;
    }
    await release(ctx, p);
  }
}

async function release(ctx: Ctx, p: any) {
  const b = { id: p.bid, target_x_user_id: p.target_x_user_id, verified_post_id: p.verified_post_id };
  const a = attestation(p, b, p.linked_wallet);
  const sigs = [signAttestation(a, ctx.env.verifier.mainSecret)];
  // SIM only: the backup verifier runs in-process. In production it's a separate service
  // that posts its signature to /api/payouts/:id/signatures.
  if (ctx.env.verifier.backupSecret) sigs.push(signAttestation(a, ctx.env.verifier.backupSecret));
  await ctx.db.query(`update payouts set wallet=$2, attestation=$3, signatures=$4 where id=$1`, [p.id, p.linked_wallet, JSON.stringify(a), JSON.stringify(sigs)]);
  if (countValidSignatures(a, sigs, ctx.env.verifier.allowedSigners) < RULES.payout.requiredSignatures) {
    log(`payout ${p.id} waiting for co-signatures`);
    return;
  }
  try {
    const tx = await ctx.payouts.release(a, sigs);
    await ctx.db.query(`update payouts set status='SENT', tx_sig=$2 where id=$1`, [p.id, tx]);
    await ctx.db.query(`update bounties set payout_wallet=$2, paid_tx=$3 where id=$1`, [p.bid, p.linked_wallet, tx]);
    await setStatus(ctx.db, p.bid, "PAID", "released on-chain", p.verified_post_id);
    await emit(ctx.db, "PAYOUT_SENT", p.token_id, p.bid, { amountLamports: String(p.amount_lamports), target: p.username, ticker: p.ticker, tx });
  } catch (e) {
    log(`release failed for ${p.id}:`, (e as Error).message);
  }
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

export async function freeze(ctx: Ctx, payoutId: string) {
  const p = (await ctx.db.query(`select * from payouts where id=$1`, [payoutId]))[0];
  if (!p || p.status !== "CHALLENGE_WINDOW") throw new Error("only payouts in the challenge window can be frozen");
  await ctx.db.query(`update payouts set status='FROZEN' where id=$1`, [payoutId]);
  await setStatus(ctx.db, p.bounty_id, "FROZEN", "frozen by admin");
}

/** Target logs in with X (Privy) and links a wallet. Future bounties pay instantly. */
export async function linkWallet(ctx: Ctx, xUserId: string, wallet: string) {
  await ctx.db.query(`update profiles set linked_wallet=$2 where x_user_id=$1`, [xUserId, wallet]);
  await releaseDue(ctx);
}

export async function optOut(ctx: Ctx, xUserId: string) {
  await ctx.db.query(`update profiles set opted_out=true where x_user_id=$1`, [xUserId]);
  const open = await ctx.db.query(`select id from bounties where target_x_user_id=$1 and status in ('OPEN','DETECTED_CONFIRMING','VOTING')`, [xUserId]);
  for (const b of open) await setStatus(ctx.db, b.id, "OPTED_OUT", "target opted out, pot to be burned");
}
