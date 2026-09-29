import type { Bounty, Detection, FeedEvent, Payout, Profile, Token, Trade, VoteRound } from "@bountypad/shared";
import { iso, str, type Db } from "./index";
import { PublicKey } from "@solana/web3.js";
import { EscrowClient } from "../chain/escrow";

export const mapProfile = (r: any): Profile => ({
  xUserId: r.x_user_id, username: r.username, name: r.name, avatarUrl: r.avatar_url,
  verified: r.verified, optedOut: r.opted_out, linkedWallet: r.linked_wallet,
});
export const mapToken = (r: any): Token => ({
  id: r.id, mint: r.mint, name: r.name, ticker: r.ticker, imageUrl: r.image_url, description: r.description,
  creatorWallet: r.creator_wallet, launchPostId: r.launch_post_id, pool: r.pool ?? null, launchTx: r.launch_tx ?? null, escrow: r.pool ? EscrowClient.bountyPda(new PublicKey(r.mint)).toBase58() : null, featured: !!r.featured, createdAt: iso(r.created_at),
});
export const mapBounty = (r: any): Bounty => ({
  id: r.id, tokenId: r.token_id, targetXUserId: r.target_x_user_id, action: r.action, phrase: r.phrase,
  deadline: iso(r.deadline), status: r.status, potLamports: str(r.pot_lamports), verifiedPostId: r.verified_post_id,
  payoutWallet: r.payout_wallet, paidTx: r.paid_tx, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
});
export const mapDetection = (r: any): Detection => ({
  id: r.id, bountyId: r.bounty_id, postId: r.post_id, text: r.text, postCreatedAt: iso(r.post_created_at),
  mediaUrl: r.media_url, transcript: r.transcript, matchScore: r.match_score, checks: r.checks, status: r.status,
  detectedAt: iso(r.detected_at), recheckAt: iso(r.recheck_at),
});
export const mapRound = (r: any): VoteRound => ({
  id: r.id, bountyId: r.bounty_id, detectionId: r.detection_id, opensAt: iso(r.opens_at), closesAt: iso(r.closes_at),
  extended: r.extended, result: r.result,
});
export const mapTrade = (r: any): Trade => ({
  id: r.id, tokenId: r.token_id, wallet: r.wallet, side: r.side, solLamports: str(r.sol_lamports),
  potLamports: str(r.pot_lamports), tokenAmount: r.token_amount == null ? null : str(r.token_amount),
  priceSol: r.price == null ? null : Number(r.price), createdAt: iso(r.created_at),
});
export const mapPayout = (r: any): Payout => ({
  id: r.id, bountyId: r.bounty_id, amountLamports: str(r.amount_lamports), wallet: r.wallet, signatures: r.signatures ?? [],
  challengeEndsAt: iso(r.challenge_ends_at), status: r.status, txSig: r.tx_sig,
});
export const mapEvent = (r: any): FeedEvent => ({
  id: Number(r.id), type: r.type, tokenId: r.token_id, bountyId: r.bounty_id, data: r.data ?? {}, at: iso(r.at),
});

export async function upsertProfile(db: Db, p: { id: string; username: string; name: string; avatarUrl: string | null; verified: boolean }) {
  // Handles move between accounts (renamed / sold). The ID is the identity: free the handle from
  // whichever older profile still carries it, so the unique index never blocks the real owner.
  await db.query(`update profiles set username = username || '~' || x_user_id where lower(username)=lower($2) and x_user_id<>$1`, [p.id, p.username]);
  await db.query(
    `insert into profiles (x_user_id, username, name, avatar_url, verified) values ($1,$2,$3,$4,$5)
     on conflict (x_user_id) do update set username=$2, name=$3, avatar_url=$4, verified=$5, updated_at=now()`,
    [p.id, p.username, p.name, p.avatarUrl, p.verified],
  );
  return mapProfile((await db.query(`select * from profiles where x_user_id=$1`, [p.id]))[0]);
}

export async function getProfileByHandle(db: Db, handle: string) {
  const r = await db.query(`select * from profiles where lower(username)=lower($1)`, [handle]);
  return r[0] ? mapProfile(r[0]) : null;
}

export async function getBounty(db: Db, id: string) {
  const r = await db.query(`select * from bounties where id=$1`, [id]);
  return r[0] ? mapBounty(r[0]) : null;
}

export async function getToken(db: Db, id: string) {
  const r = await db.query(`select * from tokens where id=$1`, [id]);
  return r[0] ? mapToken(r[0]) : null;
}

/** Everything the watcher/verifier needs about one bounty in one query. */
export async function bountyContext(db: Db, bountyId: string) {
  const r = await db.query(
    `select b.*, t.ticker, t.mint, t.launch_post_id, t.created_at as token_created_at, t.creator_wallet,
            p.username as target_username
       from bounties b join tokens t on t.id=b.token_id join profiles p on p.x_user_id=b.target_x_user_id
      where b.id=$1`,
    [bountyId],
  );
  return r[0] ?? null;
}
