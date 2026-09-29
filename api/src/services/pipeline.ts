import { upsertProfile } from "../db/repo";
import { randomUUID } from "node:crypto";
import { secondsFromNow, type Ctx } from "../app";
import type { Q } from "../db";
import { bountyContext } from "../db/repo";
import { buildSearchQuery, groupByTarget } from "../core/query";
import { verifyPost, recheck, type VerifyContext } from "../core/verifier";
import { phraseMatchScore, videoDecision } from "../core/phrase";
import { tallyVotes, closeRound, type SnapshotEntry } from "../core/voting";
import type { XPost } from "../x/types";
import { setStatus, statusOf } from "./status";
import { emit } from "./events";
import { startChallenge } from "./payouts";

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[pipeline]", ...a);

function verifyCtx(b: any): VerifyContext {
  return {
    action: b.action, targetXUserId: b.target_x_user_id, targetUsername: b.target_username, ticker: b.ticker,
    mint: b.mint, launchPostId: b.launch_post_id, tokenCreatedAt: new Date(b.token_created_at).toISOString(),
    deadline: new Date(b.deadline).toISOString(),
  };
}

const maxId = (ids: (string | null | undefined)[]) =>
  ids.filter(Boolean).reduce<string | null>((m, id) => (!m || BigInt(id!) > BigInt(m) ? id! : m), null);

/**
 * WATCH (CLAUDE.md §6.3): find candidate posts for every OPEN bounty.
 * Text bounties: one search per bounty. Video bounties: one timeline read per target.
 * Keeps watching for a short grace after the deadline so a post made just in time isn't
 * missed; the verifier still rejects anything posted after the deadline.
 */
export async function watch(ctx: Ctx) {
  const open = await ctx.db.query(
    `select b.*, t.ticker, t.mint, t.launch_post_id, t.created_at as token_created_at, t.creator_wallet, p.username as target_username
       from bounties b join tokens t on t.id=b.token_id join profiles p on p.x_user_id=b.target_x_user_id
      where b.status='OPEN' and b.deadline + ($1 || ' seconds')::interval > now()`,
    [String(ctx.env.timing.deadlineGraceSec)],
  );
  for (const [targetId, group] of groupByTarget(open.map((b: any) => ({ ...b, targetXUserId: b.target_x_user_id })))) {
    await refreshHandle(ctx, targetId, group as any[]);
    const videoBounties = group.filter((b: any) => b.action === "VIDEO_PHRASE");
    let timeline: XPost[] | null = null;
    if (videoBounties.length) {
      try {
        const seen = videoBounties.map((b: any) => b.last_seen_post_id);
        const since = seen.some((s: string | null) => !s) ? null : seen.sort((a: string, b: string) => (BigInt(a) < BigInt(b) ? -1 : 1))[0];
        timeline = (await ctx.x.getUserPosts(targetId, since)).filter((p) => p.media.some((m) => m.type === "video"));
      } catch (e) {
        log(`timeline error for ${targetId}:`, (e as Error).message);
      }
    }
    for (const b of group as any[]) {
      try {
        let candidates: XPost[];
        if (b.action === "VIDEO_PHRASE") {
          if (!timeline) continue;
          candidates = timeline.filter((p) => !b.last_seen_post_id || BigInt(p.id) > BigInt(b.last_seen_post_id));
        } else {
          const q = buildSearchQuery({ action: b.action, username: b.target_username, ticker: b.ticker, mint: b.mint, launchPostId: b.launch_post_id });
          if (!q) continue;
          // Never read posts from before the launch (pay-per-use: every post returned is billed).
          candidates = await ctx.x.searchRecent(q, b.last_seen_post_id, new Date(b.token_created_at).toISOString());
        }
        if (!candidates.length) continue;
        candidates.sort((a, c) => (BigInt(a.id) < BigInt(c.id) ? -1 : 1)); // oldest first: the first valid post wins
        let detected = false;
        for (const post of candidates) {
          const r = verifyPost(post, verifyCtx(b));
          if (!r.pass) continue;
          detected = await onDetected(ctx, b, post, r.checks);
          if (detected) break;
        }
        await ctx.db.query(`update bounties set last_seen_post_id=$2 where id=$1`, [b.id, maxId([b.last_seen_post_id, ...candidates.map((c) => c.id)])]);
        if (detected) log(`detected post for $${b.ticker}`);
      } catch (e) {
        log(`watch error for bounty ${b.id}:`, (e as Error).message);
      }
    }
  }
}

/**
 * Search queries use the handle (X's from: operator takes a username), but a target can rename.
 * Once a day per watched target, re-read the account by its permanent ID and update the handle,
 * so detection follows renames. Verification itself always compares the author's numeric ID.
 */
async function refreshHandle(ctx: Ctx, targetId: string, group: any[]) {
  if (!ctx.x.lookupUserById) return;
  const p = (await ctx.db.query(`select username, updated_at from profiles where x_user_id=$1`, [targetId]))[0];
  if (!p || Date.now() - Date.parse(p.updated_at) < 24 * 3600_000) return;
  try {
    const u = await ctx.x.lookupUserById(targetId);
    if (!u) { await ctx.db.query(`update profiles set updated_at=now() where x_user_id=$1`, [targetId]); return; }
    await upsertProfile(ctx.db, u);
    if (u.username.toLowerCase() !== String(p.username).toLowerCase()) {
      log(`@${p.username} is now @${u.username} (id ${targetId})`);
      for (const b of group) b.target_username = u.username;
    }
  } catch (e) {
    log(`handle refresh failed for ${targetId}:`, (e as Error).message);
  }
}

/** Record a detection and move the bounty to DETECTED_CONFIRMING, atomically. */
async function onDetected(ctx: Ctx, b: any, post: XPost, checks: any[]): Promise<boolean> {
  let transcript: string | null = null, score: number | null = null, snapshot: SnapshotEntry[] | null = null, mediaUrl: string | null = null;
  if (b.action === "VIDEO_PHRASE") {
    mediaUrl = post.media.find((m) => m.type === "video")?.mp4Url ?? null;
    transcript = mediaUrl ? await ctx.video.transcribe(mediaUrl) : "";
    score = phraseMatchScore(b.phrase ?? "", transcript);
    // Snapshot at the moment of detection so buying after the video can't swing a vote.
    snapshot = await ctx.holders.snapshot(b.token_id, [b.creator_wallet]);
  }
  const ok = await ctx.db.tx(async (q) => {
    if ((await statusOf(q, b.id)) !== "OPEN") return false; // opted out / expired meanwhile
    const ins = await q.query(
      `insert into detections (id, bounty_id, post_id, text, post_created_at, media_url, transcript, match_score, checks, snapshot, status, recheck_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'CONFIRMING',$11) on conflict (bounty_id, post_id) do nothing returning id`,
      [randomUUID(), b.id, post.id, post.text, post.createdAt, mediaUrl, transcript, score, JSON.stringify(checks),
       snapshot ? JSON.stringify(snapshot.map((s) => ({ wallet: s.wallet, balance: s.balance.toString() }))) : null,
       secondsFromNow(ctx.env.timing.recheckAfterSec)],
    );
    if (!ins.length) return false; // this post was already processed for this bounty
    await setStatus(q, b.id, "DETECTED_CONFIRMING", "post detected", post.id);
    return true;
  });
  if (ok) await emit(ctx.db, "POST_DETECTED", b.token_id, b.id, { postId: post.id, text: post.text, target: b.target_username, ticker: b.ticker, matchScore: score });
  return ok;
}

/** RECHECK (CLAUDE.md §6.4.5 and §6.5): after the wait, the post must still be live and still pass. */
export async function rechecks(ctx: Ctx) {
  const due = await ctx.db.query(`select * from detections where status='CONFIRMING' and recheck_at <= now()`);
  for (const d of due) {
    const b = await bountyContext(ctx.db, d.bounty_id);
    if (b.status !== "DETECTED_CONFIRMING") {
      await ctx.db.query(`update detections set status='REJECTED' where id=$1`, [d.id]);
      continue;
    }
    try {
      const out = await recheck(d.post_id, verifyCtx(b), (id) => ctx.x.getPost(id));
      const prev = (d.checks as any[]).filter((c) => c.id !== "STILL_LIVE");
      const merged = out.kind === "DELETED" ? [...prev, ...out.checks] : out.checks;
      if (out.kind !== "PASS") {
        await reject(ctx, b, d, merged, out.kind === "DELETED" ? "post deleted before recheck" : "latest version no longer passes");
        continue;
      }
      if (b.action !== "VIDEO_PHRASE") {
        await verified(ctx, b, d, merged, "all checks passed");
        continue;
      }
      const decision = videoDecision(d.match_score ?? 0);
      if (decision === "AUTO_APPROVE") {
        await verified(ctx, b, d, merged, `phrase match ${d.match_score}%`);
      } else if (decision === "AUTO_REJECT") {
        await reject(ctx, b, d, merged, `phrase match only ${d.match_score}%`);
      } else {
        const roundId = randomUUID();
        await ctx.db.tx(async (q) => {
          await q.query(`update detections set status='VOTING', checks=$2 where id=$1`, [d.id, JSON.stringify(merged)]);
          await q.query(
            `insert into vote_rounds (id, bounty_id, detection_id, snapshot, opens_at, closes_at) values ($1,$2,$3,$4, now(), $5)`,
            [roundId, b.id, d.id, JSON.stringify(d.snapshot ?? []), secondsFromNow(ctx.env.timing.voteWindowSec)],
          );
          await setStatus(q, b.id, "VOTING", `phrase match ${d.match_score}%, holders vote`, d.post_id);
        });
        await emit(ctx.db, "VOTE_OPENED", b.token_id, b.id, { roundId, ticker: b.ticker, target: b.target_username, matchScore: d.match_score });
      }
    } catch (e) {
      log(`recheck error ${d.id}:`, (e as Error).message);
    }
  }
}

async function reject(ctx: Ctx, b: any, d: any, checks: any[], reason: string) {
  await ctx.db.tx(async (q) => {
    await q.query(`update detections set status='REJECTED', checks=$2 where id=$1`, [d.id, JSON.stringify(checks)]);
    await setStatus(q, b.id, "OPEN", `rejected: ${reason}`, d.post_id);
  });
  await emit(ctx.db, "BOUNTY_REJECTED", b.token_id, b.id, { reason, ticker: b.ticker, target: b.target_username });
}

async function verified(ctx: Ctx, b: any, d: any, checks: any[] | null, reason: string) {
  await ctx.db.tx(async (q) => {
    await q.query(`update detections set status='VERIFIED'${checks ? ", checks=$2" : ""} where id=$1`, checks ? [d.id, JSON.stringify(checks)] : [d.id]);
    await q.query(`update bounties set verified_post_id=$2 where id=$1`, [b.id, d.post_id]);
    await setStatus(q, b.id, "VERIFIED", reason, d.post_id);
    await startChallenge(ctx, q, b.id, d.post_id);
  });
  await emit(ctx.db, "BOUNTY_VERIFIED", b.token_id, b.id, { postId: d.post_id, ticker: b.ticker, target: b.target_username, potLamports: String(b.pot_lamports) });
}

export function roundSnapshot(r: any): SnapshotEntry[] {
  return ((r.snapshot ?? []) as any[]).map((s) => ({ wallet: s.wallet, balance: BigInt(s.balance) }));
}

export async function roundTally(ctx: { db: Q }, round: any) {
  const votes = await ctx.db.query(`select wallet, choice from votes where round_id=$1`, [round.id]);
  return tallyVotes(roundSnapshot(round), votes);
}

/** CLOSE VOTES (CLAUDE.md §6.5.5). NO never pays anyone: fees stay locked and the bounty reopens. */
export async function closeVotes(ctx: Ctx) {
  const due = await ctx.db.query(`select * from vote_rounds where result='PENDING' and closes_at <= now()`);
  for (const r of due) {
    try {
      const b = await bountyContext(ctx.db, r.bounty_id);
      if (b.status !== "VOTING") {
        await ctx.db.query(`update vote_rounds set result='CANCELLED' where id=$1`, [r.id]);
        continue;
      }
      const tally = await roundTally(ctx, r);
      const outcome = closeRound(tally, r.extended);
      if (outcome === "EXTEND") {
        await ctx.db.query(`update vote_rounds set extended=true, closes_at=$2 where id=$1`, [r.id, secondsFromNow(ctx.env.timing.voteWindowSec)]);
        continue;
      }
      const d = (await ctx.db.query(`select * from detections where id=$1`, [r.detection_id]))[0];
      await ctx.db.query(`update vote_rounds set result=$2 where id=$1`, [r.id, outcome]);
      await emit(ctx.db, "VOTE_CLOSED", b.token_id, b.id, { roundId: r.id, outcome, yesPct: tally.yesPct, turnoutPct: tally.turnoutPct, ticker: b.ticker });
      if (outcome === "PASSED") await verified(ctx, b, d, null, `holder vote passed ${tally.yesPct}% yes`);
      else await reject(ctx, b, d, d.checks, outcome === "FAILED" ? `holder vote failed ${tally.yesPct}% yes` : "no quorum");
    } catch (e) {
      log(`close vote error ${r.id}:`, (e as Error).message);
    }
  }
}

/** EXPIRE: deadline (+ grace) passed with no verified action. The pot is burned on-chain (programs/). */
export async function expire(ctx: Ctx) {
  const due = await ctx.db.query(
    `select b.*, t.ticker from bounties b join tokens t on t.id=b.token_id
      where b.status='OPEN' and b.deadline + ($1 || ' seconds')::interval <= now()`,
    [String(ctx.env.timing.deadlineGraceSec)],
  );
  for (const b of due) {
    try {
      await setStatus(ctx.db, b.id, "EXPIRED", "deadline passed, pot to be burned");
      await emit(ctx.db, "BOUNTY_EXPIRED", b.token_id, b.id, { ticker: b.ticker });
    } catch (e) {
      log(`expire error ${b.id}:`, (e as Error).message);
    }
  }
}
