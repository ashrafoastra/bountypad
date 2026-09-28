import { randomUUID, randomBytes } from "node:crypto";
import bs58 from "bs58";
import { z } from "zod";
import { RULES, normalizeHandle, normalizeTicker, tickerError, handleError, type Profile } from "@bountypad/shared";
import type { Ctx } from "../app";
import { upsertProfile } from "../db/repo";
import { isSolanaAddress } from "../core/solana";
import { emit } from "./events";

export class LaunchError extends Error { constructor(msg: string, public status = 400) { super(msg); } }

export const launchSchema = z.object({
  name: z.string().trim().min(1).max(32),
  ticker: z.string(),
  imageUrl: z.string().url().max(500).nullish(),
  description: z.string().max(280).optional().default(""),
  creatorWallet: z.string().refine(isSolanaAddress, "not a valid Solana address"),
  targetHandle: z.string(),
  action: z.enum(["TWEET_CASHTAG", "TWEET_CONTRACT", "QUOTE_LAUNCH", "VIDEO_PHRASE"]),
  phrase: z.string().trim().max(80).nullish(),
  deadlineDays: z.number().int().min(1).max(365).optional(),
  /** REAL mode: mint created client-side via Meteora DBC. SIM mode: generated. */
  mint: z.string().refine(isSolanaAddress, "not a valid mint address").optional(),
});

/**
 * Resolve an X handle to a bounty target (CLAUDE.md §6.1.3).
 * Stores the permanent numeric user ID; rejects missing, protected, parody and opted-out accounts.
 */
export async function resolveTarget(ctx: Ctx, rawHandle: string): Promise<{ ok: true; profile: Profile } | { ok: false; reason: string }> {
  const he = handleError(rawHandle);
  if (he) return { ok: false, reason: he };
  const u = await ctx.x.lookupUser(normalizeHandle(rawHandle));
  if (!u) return { ok: false, reason: "No X account with that handle" };
  if (u.protected) return { ok: false, reason: "This account's posts are private, so we can't verify them" };
  if (u.parody) return { ok: false, reason: "Parody accounts can't be targeted" };
  const profile = await upsertProfile(ctx.db, u);
  if (profile.optedOut) return { ok: false, reason: "This person has opted out of bounties" };
  return { ok: true, profile };
}

/**
 * Launch a coin. A coin ALWAYS comes with its bounty: both rows are written in one transaction,
 * so a coin without a challenge can never exist (CLAUDE.md §6.1).
 */
export async function launch(ctx: Ctx, input: unknown) {
  const req = launchSchema.parse(input);
  const te = tickerError(req.ticker);
  if (te) throw new LaunchError(te);
  const ticker = normalizeTicker(req.ticker);
  if (req.action === "VIDEO_PHRASE" && !(req.phrase && req.phrase.split(/\s+/).length >= 2))
    throw new LaunchError("Video bounties need a short phrase of at least 2 words");

  const target = await resolveTarget(ctx, req.targetHandle);
  if (!target.ok) throw new LaunchError(target.reason);

  // One post can't settle two live challenges: the same cashtag challenge for the same person
  // is allowed only once while the first is still live.
  if (req.action === "TWEET_CASHTAG") {
    const dup = await ctx.db.query(
      `select 1 from bounties b join tokens t on t.id=b.token_id
        where b.target_x_user_id=$1 and t.ticker=$2 and b.action='TWEET_CASHTAG'
          and b.status in ('OPEN','DETECTED_CONFIRMING','VOTING','VERIFIED','CHALLENGE_WINDOW','FROZEN')`,
      [target.profile.xUserId, ticker],
    );
    if (dup.length) throw new LaunchError(`A live $${ticker} challenge for @${target.profile.username} already exists. Pick another ticker or challenge.`);
  }

  let mint = req.mint;
  if (!mint) {
    if (!ctx.env.sim) throw new LaunchError("mint is required (create the pool on-chain first)");
    mint = bs58.encode(randomBytes(32));
  }

  // The coin's official launch post (needed for QUOTE_LAUNCH). Posting it for real needs the
  // platform's X account with write access; that's not wired yet outside SIM mode.
  let launchPostId: string | null = null;
  if (ctx.mockX) {
    launchPostId = ctx.mockX.createPost({
      username: "bountypad",
      text: `$${ticker} just launched on Bounty Pad. Challenge for @${target.profile.username} is live.`,
    }).id;
  } else if (req.action === "QUOTE_LAUNCH") {
    throw new LaunchError("Quote bounties aren't available yet (launch post publishing not wired)");
  }

  const tokenId = randomUUID(), bountyId = randomUUID();
  const days = req.deadlineDays ?? RULES.defaultDeadlineDays;
  await ctx.db.tx(async (q) => {
    await q.query(
      `insert into tokens (id, mint, name, ticker, image_url, description, creator_wallet, launch_post_id) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tokenId, mint, req.name, ticker, req.imageUrl ?? null, req.description, req.creatorWallet, launchPostId],
    );
    await q.query(
      `insert into bounties (id, token_id, target_x_user_id, action, phrase, deadline, status, last_seen_post_id)
       values ($1,$2,$3,$4,$5, now() + ($6 || ' days')::interval, 'OPEN', $7)`,
      [bountyId, tokenId, target.profile.xUserId, req.action, req.action === "VIDEO_PHRASE" ? req.phrase : null, String(days), launchPostId],
    );
    await q.query(`insert into audit_log (bounty_id, to_status, reason) values ($1,'OPEN','launched')`, [bountyId]);
  });
  await emit(ctx.db, "TOKEN_LAUNCHED", tokenId, bountyId, { ticker, name: req.name, target: target.profile.username, action: req.action });
  return { id: tokenId, bountyId };
}
