import { randomUUID, randomBytes, createHash } from "node:crypto";
import bs58 from "bs58";
import { z } from "zod";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { RULES, normalizeHandle, normalizeTicker, tickerError, handleError, type Profile } from "@bountypad/shared";
import type { Ctx } from "../app";
import { upsertProfile } from "../db/repo";
import { isSolanaAddress } from "../core/solana";
import { ACTION_CODE } from "../chain/escrow";
import { emit } from "./events";

export class LaunchError extends Error { constructor(msg: string, public status = 400) { super(msg); } }

export const launchSchema = z.object({
  name: z.string().trim().min(1).max(32),
  ticker: z.string(),
  /** The coin's logo (uploaded with POST /api/uploads). Required: every coin shows an image. */
  imageUrl: z.string({ required_error: "Add the coin's image" }).url("Add the coin's image").max(500),
  description: z.string().max(280).optional().default(""),
  creatorWallet: z.string().refine(isSolanaAddress, "not a valid Solana address"),
  targetHandle: z.string(),
  action: z.enum(["TWEET_CASHTAG", "TWEET_CONTRACT", "QUOTE_LAUNCH", "VIDEO_PHRASE"]),
  phrase: z.string().trim().max(80).nullish(),
  deadlineDays: z.number().int().min(1).max(365).optional(),
  /** SOL the creator buys in the launch transaction itself (CHAIN=solana). */
  firstBuySol: z.number().min(0).max(50).optional(),
});
type LaunchInput = z.infer<typeof launchSchema>;

/**
 * Resolve an X handle to a bounty target (CLAUDE.md §6.1.3).
 * Stores the permanent numeric user ID; rejects missing, protected, parody and opted-out accounts.
 */
export async function resolveTarget(ctx: Ctx, rawHandle: string): Promise<{ ok: true; profile: Profile } | { ok: false; reason: string }> {
  const he = handleError(rawHandle);
  if (he) return { ok: false, reason: he };
  let u;
  try {
    u = await ctx.x.lookupUser(normalizeHandle(rawHandle));
  } catch (e) {
    return { ok: false, reason: `Couldn't reach X to check this account (${(e as Error).message}). Try again.` };
  }
  if (!u) return { ok: false, reason: "No X account with that handle" };
  if (u.protected) return { ok: false, reason: "This account's posts are private, so we can't verify them" };
  if (u.parody) return { ok: false, reason: "Parody accounts can't be targeted" };
  const profile = await upsertProfile(ctx.db, u);
  if (profile.optedOut) return { ok: false, reason: "This person has opted out of bounties" };
  return { ok: true, profile };
}

/** Every rule a launch must pass, shared by the simulated and the on-chain launch. */
async function validate(ctx: Ctx, input: unknown) {
  const req = launchSchema.parse(input);
  const te = tickerError(req.ticker);
  if (te) throw new LaunchError(te);
  const ticker = normalizeTicker(req.ticker);
  if (req.action === "VIDEO_PHRASE" && !(req.phrase && req.phrase.split(/\s+/).length >= 2))
    throw new LaunchError("Video bounties need a short phrase of at least 2 words");
  if (req.action === "QUOTE_LAUNCH" && !ctx.mockX)
    throw new LaunchError("Quote bounties aren't available yet (launch post publishing not wired)");

  const target = await resolveTarget(ctx, req.targetHandle);
  if (!target.ok) throw new LaunchError(target.reason);

  // One post can't settle two live challenges: the same cashtag challenge for the same person
  // is allowed only once while the first is still live (or waiting for its wallet signature).
  if (req.action === "TWEET_CASHTAG") {
    const dup = await ctx.db.query(
      `select 1 from bounties b join tokens t on t.id=b.token_id
        where b.target_x_user_id=$1 and t.ticker=$2 and b.action='TWEET_CASHTAG'
          and b.status in ('OPEN','DETECTED_CONFIRMING','VOTING','VERIFIED','CHALLENGE_WINDOW','FROZEN')
       union all
       select 1 from pending_launches where expires_at > now() and input->>'targetXUserId'=$1 and input->>'ticker'=$2 and input->>'action'='TWEET_CASHTAG'`,
      [target.profile.xUserId, ticker],
    );
    if (dup.length) throw new LaunchError(`A live $${ticker} challenge for @${target.profile.username} already exists. Pick another ticker or challenge.`);
  }
  const days = req.deadlineDays ?? RULES.defaultDeadlineDays;
  return { req, ticker, target: target.profile, days };
}

/** The coin's official launch post (needed for QUOTE_LAUNCH). Only the simulated X can post it for now. */
function launchPost(ctx: Ctx, ticker: string, username: string) {
  return ctx.mockX
    ? ctx.mockX.createPost({ username: "bountypad", text: `$${ticker} just launched on Bounty Pad. Challenge for @${username} is live.` }).id
    : null;
}

interface LaunchRecord {
  mint: string; name: string; ticker: string; imageUrl: string | null; description: string; creatorWallet: string;
  targetXUserId: string; targetUsername: string; action: string; phrase: string | null; deadline: Date;
  pool?: string | null; launchTx?: string | null;
}

/** Token + bounty rows, written together (a coin without its bounty can never exist). */
async function record(ctx: Ctx, r: LaunchRecord) {
  const tokenId = randomUUID(), bountyId = randomUUID();
  const launchPostId = launchPost(ctx, r.ticker, r.targetUsername);
  await ctx.db.tx(async (q) => {
    await q.query(
      `insert into tokens (id, mint, name, ticker, image_url, description, creator_wallet, launch_post_id, pool, launch_tx) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [tokenId, r.mint, r.name, r.ticker, r.imageUrl, r.description, r.creatorWallet, launchPostId, r.pool ?? null, r.launchTx ?? null],
    );
    await q.query(
      `insert into bounties (id, token_id, target_x_user_id, action, phrase, deadline, status, last_seen_post_id) values ($1,$2,$3,$4,$5,$6,'OPEN',$7)`,
      [bountyId, tokenId, r.targetXUserId, r.action, r.action === "VIDEO_PHRASE" ? r.phrase : null, r.deadline.toISOString(), launchPostId],
    );
    await q.query(`insert into audit_log (bounty_id, to_status, reason) values ($1,'OPEN','launched')`, [bountyId]);
  });
  await emit(ctx.db, "TOKEN_LAUNCHED", tokenId, bountyId, { ticker: r.ticker, name: r.name, target: r.targetUsername, action: r.action, tx: r.launchTx ?? null });
  return { id: tokenId, bountyId };
}

/** SIM chain: launch instantly with a generated mint address. */
export async function launch(ctx: Ctx, input: unknown) {
  if (ctx.chain) throw new LaunchError("On-chain mode: launch with /api/launch/prepare and your wallet's signature");
  const { req, ticker, target, days } = await validate(ctx, input);
  return record(ctx, {
    mint: bs58.encode(randomBytes(32)), name: req.name, ticker, imageUrl: req.imageUrl ?? null, description: req.description,
    creatorWallet: req.creatorWallet, targetXUserId: target.xUserId, targetUsername: target.username, action: req.action,
    phrase: req.phrase ?? null, deadline: new Date(Date.now() + days * 86400_000),
  });
}

/** The phrase as written on-chain: sha256 of the lowercased, whitespace-normalized phrase. */
export function phraseHash(phrase: string | null | undefined) {
  if (!phrase) return new Uint8Array(32);
  return new Uint8Array(createHash("sha256").update(phrase.trim().toLowerCase().replace(/\s+/g, " ")).digest());
}

const messageHash = (tx: Transaction) => createHash("sha256").update(tx.serializeMessage()).digest("hex");

/**
 * CHAIN=solana, step 1: validate, then build the launch transaction (Meteora pool + bounty,
 * atomically). The new mint's key signs it here and is then thrown away: after creation the
 * mint belongs to the pool. The creator's wallet signs the rest in the browser.
 */
export async function prepareLaunch(ctx: Ctx, input: unknown) {
  if (!ctx.chain) throw new LaunchError("The API isn't in on-chain mode (CHAIN=solana)");
  const { req, ticker, target, days } = await validate(ctx, input);
  const mint = Keypair.generate();
  const deadline = Math.floor(Date.now() / 1000) + days * 86400;
  const firstBuy = BigInt(Math.round((req.firstBuySol ?? 0) * 1e9));
  const { tx, pool } = await ctx.chain.launchpad.launchTx({
    creator: new PublicKey(req.creatorWallet), mint, name: req.name, symbol: ticker,
    uri: `${ctx.env.publicApiUrl}/api/meta/${mint.publicKey.toBase58()}`,
    targetXUserId: BigInt(target.xUserId), action: ACTION_CODE[req.action], phraseHash: phraseHash(req.phrase),
    deadline, firstBuyLamports: firstBuy,
  });
  const id = randomUUID();
  const pending = {
    name: req.name, ticker, imageUrl: req.imageUrl ?? null, description: req.description, creatorWallet: req.creatorWallet,
    targetXUserId: target.xUserId, targetUsername: target.username, action: req.action, phrase: req.phrase ?? null,
    deadline, pool: pool.toBase58(),
  };
  await ctx.db.query(
    `insert into pending_launches (id, mint, input, message_hash, expires_at) values ($1,$2,$3,$4, now() + interval '3 minutes')`,
    [id, mint.publicKey.toBase58(), JSON.stringify(pending), messageHash(tx)],
  );
  return {
    launchId: id,
    mint: mint.publicKey.toBase58(),
    transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
  };
}

/** CHAIN=solana, step 2: the wallet signed. Send it, then record the coin once the chain confirms. */
export async function submitLaunch(ctx: Ctx, launchId: string, signedBase64: string) {
  if (!ctx.chain) throw new LaunchError("The API isn't in on-chain mode");
  const p = (await ctx.db.query(`select * from pending_launches where id=$1`, [launchId]))[0];
  if (!p) throw new LaunchError("Launch not found or already recorded. Check your coins, or start again.", 404);
  const bytes = Buffer.from(signedBase64, "base64");
  let tx: Transaction;
  try { tx = Transaction.from(bytes); } catch { throw new LaunchError("Not a valid transaction"); }
  if (messageHash(tx) !== p.message_hash) throw new LaunchError("The signed transaction isn't the one we prepared");
  if (!tx.verifySignatures()) throw new LaunchError("The transaction is missing a signature");
  let sig: string;
  try {
    sig = await ctx.chain.sendSigned(bytes);
  } catch (e) {
    const msg = (e as Error).message;
    // It may still have landed (e.g. a timeout). The reconciler records it if so.
    throw new LaunchError(`Launch transaction failed: ${msg.slice(0, 300)}`, 502);
  }
  const r = await registerLaunch(ctx, p, sig);
  if (!r) throw new LaunchError("Transaction confirmed but the bounty isn't on-chain", 502);
  return { ...r, tx: sig, explorer: ctx.chain.explorer(sig) };
}

/**
 * Record a pending launch once the chain has it. The chain is the source of truth: the bounty
 * account must exist with exactly the terms we prepared, on a pool made with our config.
 */
export async function registerLaunch(ctx: Ctx, p: any, sig: string | null) {
  const chain = ctx.chain!;
  const mint = new PublicKey(p.mint);
  const oc = await chain.escrow.bounty(mint);
  if (!oc) return null;
  const i = p.input;
  const mismatch =
    oc.targetXUserId !== BigInt(i.targetXUserId) || oc.deadline !== i.deadline || oc.action !== ACTION_CODE[i.action as keyof typeof ACTION_CODE] ||
    Buffer.compare(Buffer.from(oc.phraseHash), Buffer.from(phraseHash(i.phrase))) !== 0 || oc.pool.toBase58() !== i.pool;
  if (mismatch) throw new LaunchError("On-chain bounty terms don't match the prepared launch", 409);
  const existing = (await ctx.db.query(`select id from tokens where mint=$1`, [p.mint]))[0];
  if (existing) {
    await ctx.db.query(`delete from pending_launches where id=$1`, [p.id]);
    const b = (await ctx.db.query(`select id from bounties where token_id=$1`, [existing.id]))[0];
    return { id: existing.id as string, bountyId: b.id as string };
  }
  const out = await record(ctx, {
    mint: p.mint, name: i.name, ticker: i.ticker, imageUrl: i.imageUrl, description: i.description, creatorWallet: i.creatorWallet,
    targetXUserId: i.targetXUserId, targetUsername: i.targetUsername, action: i.action, phrase: i.phrase,
    deadline: new Date(i.deadline * 1000), pool: i.pool, launchTx: sig,
  });
  await ctx.db.query(`delete from pending_launches where id=$1`, [p.id]);
  return out;
}

/** Job: launches whose submit call never came back (closed tab, timeout) but did land on-chain. */
export async function reconcileLaunches(ctx: Ctx) {
  if (!ctx.chain) return;
  const rows = await ctx.db.query(`select * from pending_launches where created_at < now() - interval '15 seconds'`);
  for (const p of rows) {
    try {
      const r = await registerLaunch(ctx, p, null);
      if (!r && Date.parse(p.expires_at) < Date.now()) await ctx.db.query(`delete from pending_launches where id=$1`, [p.id]);
    } catch (e) {
      console.log(new Date().toISOString(), "[launch] reconcile", p.mint, (e as Error).message);
    }
  }
}

/** Metaplex metadata JSON for a coin (the `uri` written on-chain at launch). */
export async function tokenMetadata(ctx: Ctx, mint: string) {
  const t = (await ctx.db.query(`select name, ticker, description, image_url from tokens where mint=$1`, [mint]))[0];
  if (t) return { name: t.name, symbol: t.ticker, description: t.description, image: t.image_url ?? undefined };
  const p = (await ctx.db.query(`select input from pending_launches where mint=$1`, [mint]))[0];
  if (p) return { name: p.input.name, symbol: p.input.ticker, description: p.input.description, image: p.input.imageUrl ?? undefined };
  return null;
}
