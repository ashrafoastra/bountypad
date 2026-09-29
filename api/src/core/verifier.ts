import { RULES, type BountyAction, type CheckResult } from "@bountypad/shared";
import type { XPost } from "../x/types";

export interface VerifyContext {
  action: BountyAction;
  targetXUserId: string;
  targetUsername: string;
  ticker: string;
  mint: string;
  launchPostId: string | null;
  tokenCreatedAt: string;
  /** Posts made after the deadline never count, even if detected before it expires. */
  deadline?: string;
}

export interface VerifyResult {
  pass: boolean;
  checks: CheckResult[];
}

function hasCashtag(post: XPost, ticker: string): boolean {
  const want = ticker.toUpperCase();
  if (post.cashtags.length) return post.cashtags.some((c) => c.toUpperCase() === want);
  // Fallback when entities are missing: whole-word cashtag in text.
  return new RegExp(`(^|[^A-Za-z0-9_$])\\$${want}(?![A-Za-z0-9_])`, "i").test(post.text);
}

function contentCheck(post: XPost, ctx: VerifyContext): CheckResult {
  switch (ctx.action) {
    case "TWEET_CASHTAG": {
      const ok = hasCashtag(post, ctx.ticker);
      return { id: "CONTENT", label: `Contains $${ctx.ticker}`, pass: ok, detail: ok ? undefined : "cashtag not found" };
    }
    case "TWEET_CONTRACT": {
      // In the text, or inside a link (pump / explorer / our coin page): t.co hides links in the text.
      const ok = post.text.includes(ctx.mint) || (post.urls ?? []).some((u) => u.includes(ctx.mint));
      return { id: "CONTENT", label: "Contains the contract address", pass: ok };
    }
    case "QUOTE_LAUNCH": {
      const ok = !!ctx.launchPostId && post.referenced.some((r) => r.type === "quoted" && r.id === ctx.launchPostId);
      return { id: "CONTENT", label: "Quotes the coin's launch post", pass: ok };
    }
    case "VIDEO_PHRASE": {
      const v = post.media.find((m) => m.type === "video");
      return { id: "CONTENT", label: "Has a native video", pass: !!v && !!v.mp4Url };
    }
    case "BIO_CONTRACT": {
      // The bio text, or a link in the bio / profile website (X shortens links with t.co).
      const ok = post.text.includes(ctx.mint) || (post.urls ?? []).some((u) => u.includes(ctx.mint));
      return { id: "CONTENT", label: "Contract address in their X bio", pass: ok };
    }
  }
}

/**
 * Checks 1-4 from CLAUDE.md §6.4. The "still live after 24h" check (5) is done by recheck().
 * For video bounties this only checks the post; the spoken phrase is scored separately.
 */
export function verifyPost(post: XPost, ctx: VerifyContext): VerifyResult {
  const isRetweet = post.referenced.some((r) => r.type === "retweeted");
  const isReply = post.referenced.some((r) => r.type === "replied_to");
  const checks: CheckResult[] = [
    {
      id: "AUTHOR",
      label: `Posted by @${ctx.targetUsername} (account ID match)`,
      pass: post.authorId === ctx.targetXUserId,
      detail: post.authorId === ctx.targetXUserId ? undefined : `author ${post.authorId}`,
    },
    {
      id: "AFTER_LAUNCH",
      label: "Posted after the coin launched",
      pass: Date.parse(post.createdAt) > Date.parse(ctx.tokenCreatedAt),
    },
    ...(ctx.deadline
      ? [{ id: "BEFORE_DEADLINE" as const, label: "Posted before the deadline", pass: Date.parse(post.createdAt) <= Date.parse(ctx.deadline) }]
      : []),
    {
      id: "POST_TYPE",
      label: "Original post or quote (no reposts or replies)",
      pass: !isRetweet && !isReply,
      detail: isRetweet ? "repost" : isReply ? "reply" : undefined,
    },
    contentCheck(post, ctx),
  ];
  if (ctx.action === "VIDEO_PHRASE") {
    const v = post.media.find((m) => m.type === "video");
    const ok = !!v && v.durationMs != null && v.durationMs <= RULES.video.maxDurationMs;
    checks.push({ id: "VIDEO_LENGTH", label: `Video under ${RULES.video.maxDurationMs / 60000} min`, pass: ok });
  }
  return { pass: checks.every((c) => c.pass), checks };
}

export type RecheckOutcome =
  | { kind: "PASS"; latest: XPost; checks: CheckResult[] }
  | { kind: "DELETED"; checks: CheckResult[] }
  | { kind: "FAIL"; latest: XPost; checks: CheckResult[] };

/**
 * The 24-hour recheck (CLAUDE.md §6.4.5): the post must still exist, and its LATEST
 * edited version must still pass. `fetch` returns null for a deleted post.
 */
export async function recheck(
  postId: string,
  ctx: VerifyContext,
  fetch: (id: string) => Promise<XPost | null>,
): Promise<RecheckOutcome> {
  const original = await fetch(postId);
  const live: CheckResult = { id: "STILL_LIVE", label: `Still live after ${RULES.recheckHours} hours`, pass: !!original };
  if (!original) return { kind: "DELETED", checks: [{ ...live, detail: "post deleted" }] };
  const latestId = original.editHistoryIds.at(-1) ?? original.id;
  const latest = latestId !== original.id ? (await fetch(latestId)) ?? original : original;
  const r = verifyPost(latest, ctx);
  const checks = [...r.checks, live];
  return r.pass ? { kind: "PASS", latest, checks } : { kind: "FAIL", latest, checks };
}
