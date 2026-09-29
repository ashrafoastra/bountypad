import { randomUUID, randomBytes, createHash } from "node:crypto";
import bs58 from "bs58";
import { z } from "zod";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { LINK_KINDS, type LinkKind, type TokenLinks, RULES, normalizeHandle, normalizeTicker, tickerError, handleError, type Profile } from "@bountypad/shared";
import type { Ctx } from "../app";
import { upsertProfile } from "../db/repo";
import { isSolanaAddress } from "../core/solana";
import { ACTION_CODE } from "../chain/escrow";
import { emit } from "./events";
import { recordLaunchPrice } from "./market";
import { launchText, platformConnected, postAsPlatform } from "./xposter";

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
  /** Social links, like pump.fun / Axiom. Each must be an https link on its platform. */
  links: z.object(Object.fromEntries(LINK_KINDS.map((k) => [k, link(k)])) as Record<LinkKind, ReturnType<typeof link>>).partial().optional(),
});

const LINK_HOSTS: Record<LinkKind, RegExp | null> = {
  website: null,
  x: /^(www\.)?(x|twitter)\.com$/,
  telegram: /^(www\.)?(t\.me|telegram\.me)$/,
  github: /^(www\.)?github\.com$/,
  tiktok: /^(www\.|m\.)?tiktok\.com$/,
  youtube: /^(www\.|m\.)?(youtube\.com|youtu\.be)$/,
};
const LINK_NAMES: Record<LinkKind, string> = { website: "Website", x: "X", telegram: "Telegram", github: "GitHub", tiktok: "TikTok", youtube: "YouTube" };
function link(kind: LinkKind) {
  return z.string().trim().max(200).transform((v, c) => {
    if (!v) return undefined;
    let u: URL;
    try { u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`); } catch { c.addIssue({ code: "custom", message: `${LINK_NAMES[kind]}: not a valid link` }); return z.NEVER; }
    const host = LINK_HOSTS[kind];
    if (u.protocol !== "https:" && u.protocol !== "http:") { c.addIssue({ code: "custom", message: `${LINK_NAMES[kind]}: use an https link` }); return z.NEVER; }
    if (host && !host.test(u.hostname)) { c.addIssue({ code: "custom", message: `${LINK_NAMES[kind]}: the link must be on ${LINK_NAMES[kind]}` }); return z.NEVER; }
    u.protocol = "https:";
    return u.toString();
  });
}
const cleanLinks = (l: Record<string, string | undefined> | undefined) =>
  Object.fromEntries(Object.entries(l ?? {}).filter(([, v]) => !!v)) as TokenLinks;
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
  if (req.action === "QUOTE_LAUNCH" && !(await platformConnected(ctx)))
    throw new LaunchError("Quote challenges need the platform's X account connected (it publishes the launch post to quote). Pick another challenge.");

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

/**
 * The coin's launch post by the platform account (the post a QUOTE_LAUNCH target quotes).
 * Published when the platform X account is connected; if X fails now, a job retries it.
 */
async function launchPost(ctx: Ctx, t: { id: string; ticker: string; action: string; phrase: string | null }) {
  if (!(await platformConnected(ctx))) return null;
  try { return await postAsPlatform(ctx, launchText(ctx, t)); }
  catch (e) { console.log(new Date().toISOString(), "[launch] launch post failed, will retry:", (e as Error).message); return null; }
}

interface LaunchRecord {
  mint: string; name: string; ticker: string; imageUrl: string | null; description: string; creatorWallet: string;
  targetXUserId: string; targetUsername: string; action: string; phrase: string | null; deadline: Date;
  pool?: string | null; launchTx?: string | null; links?: TokenLinks;
}

/** Token + bounty rows, written together (a coin without its bounty can never exist). */
async function record(ctx: Ctx, r: LaunchRecord) {
  const tokenId = randomUUID(), bountyId = randomUUID();
  const launchPostId = await launchPost(ctx, { id: tokenId, ticker: r.ticker, action: r.action, phrase: r.phrase });
  await ctx.db.tx(async (q) => {
    await q.query(
      `insert into tokens (id, mint, name, ticker, image_url, description, creator_wallet, launch_post_id, pool, launch_tx, links) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [tokenId, r.mint, r.name, r.ticker, r.imageUrl, r.description, r.creatorWallet, launchPostId, r.pool ?? null, r.launchTx ?? null, JSON.stringify(r.links ?? {})],
    );
    await q.query(
      `insert into bounties (id, token_id, target_x_user_id, action, phrase, deadline, status, last_seen_post_id) values ($1,$2,$3,$4,$5,$6,'OPEN',$7)`,
      [bountyId, tokenId, r.targetXUserId, r.action, r.action === "VIDEO_PHRASE" ? r.phrase : null, r.deadline.toISOString(), launchPostId],
    );
    await q.query(`insert into audit_log (bounty_id, to_status, reason) values ($1,'OPEN','launched')`, [bountyId]);
  });
  await recordLaunchPrice(ctx, tokenId, r.mint).catch(() => {});
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
    phrase: req.phrase ?? null, deadline: new Date(Date.now() + days * 86400_000), links: cleanLinks(req.links),
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
    deadline, pool: pool.toBase58(), links: cleanLinks(req.links),
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
    // Simulation errors carry the program logs: keep them in the API log, and show the telling line.
    const logs: string[] = (e as any).logs ?? (e as any).transactionLogs ?? [];
    if (logs.length) console.log(new Date().toISOString(), "[launch] failed tx logs:\n  " + logs.join("\n  "));
    const why = [...logs].reverse().find((l) => /Error|failed|insufficient/i.test(l));
    const msg = (e as Error).message.split("\n")[0] + (why ? ` (${why.replace(/^Program log: /, "")})` : "");
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
    deadline: new Date(i.deadline * 1000), pool: i.pool, launchTx: sig, links: i.links ?? {},
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
  const t = (await ctx.db.query(`select name, ticker, description, image_url, links from tokens where mint=$1`, [mint]))[0];
  const src = t
    ? { name: t.name, ticker: t.ticker, description: t.description, image: t.image_url, links: (t.links ?? {}) as TokenLinks }
    : await ctx.db.query(`select input from pending_launches where mint=$1`, [mint]).then((r) => r[0] && {
        name: r[0].input.name, ticker: r[0].input.ticker, description: r[0].input.description, image: r[0].input.imageUrl, links: (r[0].input.links ?? {}) as TokenLinks,
      });
  if (!src) return null;
  const l = src.links;
  // Metaplex JSON. Top-level website/twitter/telegram is the pump.fun convention that explorers,
  // Axiom, DexScreener and wallets read; `extensions` carries every link (token-list convention).
  return {
    name: src.name, symbol: src.ticker, description: src.description, image: src.image ?? undefined,
    ...(l.website ? { website: l.website, external_url: l.website } : {}),
    ...(l.x ? { twitter: l.x } : {}),
    ...(l.telegram ? { telegram: l.telegram } : {}),
    extensions: { ...(l.website ? { website: l.website } : {}), ...(l.x ? { twitter: l.x } : {}), ...(l.telegram ? { telegram: l.telegram } : {}),
      ...(l.github ? { github: l.github } : {}), ...(l.tiktok ? { tiktok: l.tiktok } : {}), ...(l.youtube ? { youtube: l.youtube } : {}) },
    createdOn: ctx.env.webOrigin,
  };
}
