import type { Ctx } from "../app";
import { actionPhrase } from "../core/copy";

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[x-post]", ...a);

/**
 * Posting as the platform's X account (connected once by an admin with
 * `npm run x:connect-platform -w api`, OAuth 2.0 scopes tweet.write + offline.access).
 * Simulated X: posts come from the simulated @bountypad account.
 */
export async function platformConnected(ctx: Ctx) {
  if (ctx.mockX) return true;
  if (!ctx.xOAuth) return false;
  return (await ctx.db.query(`select 1 from platform_x where id=1`)).length > 0;
}

/** A valid access token for the platform account, refreshed (and rotated) when close to expiry. */
async function platformToken(ctx: Ctx): Promise<string | null> {
  if (!ctx.xOAuth) return null;
  const p = (await ctx.db.query(`select * from platform_x where id=1`))[0];
  if (!p) return null;
  if (Date.parse(p.expires_at) - Date.now() > 5 * 60_000) return p.access_token;
  if (!p.refresh_token) throw new Error("platform X token expired and has no refresh token: reconnect with npm run x:connect-platform -w api");
  const t = await ctx.xOAuth.refresh(p.refresh_token);
  await ctx.db.query(`update platform_x set access_token=$1, refresh_token=coalesce($2, refresh_token), expires_at=$3, updated_at=now() where id=1`, [t.accessToken, t.refreshToken, t.expiresAt.toISOString()]);
  return t.accessToken;
}

export async function postAsPlatform(ctx: Ctx, text: string, replyTo?: string | null): Promise<string | null> {
  if (ctx.mockX) return ctx.mockX.createPost({ username: "bountypad", text, replyTo: replyTo ?? undefined }).id;
  const token = await platformToken(ctx);
  if (!token) return null;
  return ctx.xOAuth!.post(token, text, replyTo);
}

/**
 * The coin's launch announcement (the post a QUOTE_LAUNCH target must quote). It never @mentions
 * the target: people are only notified after they act (CLAUDE.md §6.7).
 */
export function launchText(ctx: Ctx, t: { id: string; ticker: string; action: string; phrase: string | null }) {
  return `$${t.ticker} is live on Bounty Pad.\n\nThe challenge: ${actionPhrase(t.action, t.ticker, t.phrase)}.\nEvery trade grows the pot, held on Solana until it's done.\n\n${ctx.env.webOrigin.replace(/\/$/, "")}/token/${t.id}`;
}

/** Job: launch posts that couldn't be published at launch time (X down, token refresh…). */
export async function postPendingLaunches(ctx: Ctx) {
  if (ctx.mockX || !(await platformConnected(ctx))) return;
  const rows = await ctx.db.query(
    `select t.id, t.ticker, b.action, b.phrase, b.id as bounty_id from tokens t join bounties b on b.token_id=t.id
      where t.launch_post_id is null and b.status='OPEN' and t.created_at > now() - interval '3 days' order by t.created_at limit 5`,
  );
  for (const t of rows) {
    try {
      const id = await postAsPlatform(ctx, launchText(ctx, t));
      if (!id) return;
      await ctx.db.query(`update tokens set launch_post_id=$2 where id=$1 and launch_post_id is null`, [t.id, id]);
      await ctx.db.query(`update bounties set last_seen_post_id=coalesce(last_seen_post_id, $2) where id=$1`, [t.bounty_id, id]);
      log(`launch post for $${t.ticker}: ${id}`);
    } catch (e) {
      log(`launch post for $${t.ticker} failed:`, (e as Error).message);
      return; // try again next run
    }
  }
}

/**
 * Job: one public receipt per verified bounty, as a reply to the post that completed it
 * (only AFTER verification, never before: CLAUDE.md §6.7). One attempt; failures are recorded.
 */
export async function postReceipts(ctx: Ctx) {
  if (ctx.mockX || !(await platformConnected(ctx))) return;
  const rows = await ctx.db.query(
    `select b.id, b.status, b.pot_lamports::text as pot, t.id as token_id, t.ticker, p.username, d.post_id
       from bounties b join tokens t on t.id=b.token_id join profiles p on p.x_user_id=b.target_x_user_id
       join detections d on d.bounty_id=b.id and d.status='VERIFIED'
      where b.status in ('CHALLENGE_WINDOW','PAID') and b.receipt_post_id is null limit 5`,
  );
  for (const r of rows) {
    const sol = (Number(r.pot) / 1e9).toFixed(3);
    const text = `Verified. @${r.username} completed the $${r.ticker} challenge.\n\n${sol} SOL is waiting for them on Solana. Log in with X to claim: ${ctx.env.webOrigin.replace(/\/$/, "")}/claim`;
    let mark: string;
    try { mark = (await postAsPlatform(ctx, text, String(r.post_id).startsWith("bio-") ? null : r.post_id)) ?? "skipped"; log(`receipt for $${r.ticker}: ${mark}`); }
    catch (e) { mark = "failed"; log(`receipt for $${r.ticker} failed:`, (e as Error).message); }
    await ctx.db.query(`update bounties set receipt_post_id=$2 where id=$1`, [r.id, mark]);
  }
}
