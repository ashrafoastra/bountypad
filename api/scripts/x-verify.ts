/**
 * Dry run of the X READ + VERIFY system against a REAL post, without touching the database.
 * Shows exactly what the watcher would search, whether the search finds the post, and every
 * verification check. Costs a handful of X reads (about $0.02-0.05).
 *
 *   npm run x:verify -w api -- <post url or id> --action TWEET_CASHTAG --ticker BOUNTY --handle someone [--launched 2026-09-28T10:00:00Z]
 *   actions: TWEET_CASHTAG (--ticker) | TWEET_CONTRACT (--mint) | QUOTE_LAUNCH (--launch-post <id>) | VIDEO_PHRASE
 */
import "dotenv/config";
import { RealX } from "../src/x/real";
import { env } from "../src/env";
import { buildSearchQuery } from "../src/core/query";
import { verifyPost, recheck } from "../src/core/verifier";
import type { BountyAction } from "@bountypad/shared";

const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const postArg = argv.find((a) => !a.startsWith("--") && !argv[argv.indexOf(a) - 1]?.startsWith("--"));
const postId = postArg?.match(/(\d{5,25})(?:\D*$)/)?.[1];
const action = (opt("action") ?? "TWEET_CASHTAG") as BountyAction;
const handle = (opt("handle") ?? "").replace(/^@/, "");
if (!postId || !handle) {
  console.error("Usage: npm run x:verify -w api -- <post url or id> --handle <target> --action TWEET_CASHTAG --ticker ABC [--mint ...] [--launch-post id] [--launched ISO]");
  process.exit(1);
}
if (!env.xBearer && !env.xConsumer) { console.error("✗ Set X_BEARER_TOKEN in api/.env first."); process.exit(1); }

const x = new RealX(env.xBearer, env.xFieldStyle, undefined, env.xConsumer);
const mark = (ok: boolean) => (ok ? "✓" : "✗");

(async () => {
  console.log(`\n1. Target @${handle}`);
  const target = await x.lookupUser(handle);
  if (!target) throw new Error(`@${handle} doesn't exist`);
  console.log(`   ${target.name} · user id ${target.id}${target.protected ? " · PRIVATE (would be rejected at launch)" : ""}${target.parody ? " · PARODY (rejected)" : ""}`);

  console.log(`\n2. Post ${postId}`);
  const post = await x.getPost(postId);
  if (!post) throw new Error("X says this post doesn't exist (deleted?)");
  console.log(`   by ${post.authorId} at ${post.createdAt}`);
  console.log(`   text: ${JSON.stringify(post.text.slice(0, 200))}${post.text.length > 200 ? "…" : ""}`);
  console.log(`   cashtags: [${post.cashtags.join(", ")}] · links: ${post.urls?.length ?? 0} · refs: ${post.referenced.map((r) => `${r.type}:${r.id}`).join(", ") || "none"} · edits: ${post.editHistoryIds.length}`);

  const launched = opt("launched") ?? new Date(Date.parse(post.createdAt) - 60_000).toISOString();
  const ctx = {
    action, targetXUserId: target.id, targetUsername: target.username, ticker: (opt("ticker") ?? "").toUpperCase(),
    mint: opt("mint") ?? "", launchPostId: opt("launch-post") ?? null, tokenCreatedAt: launched,
  };

  console.log(`\n3. Verification checks (coin launched at ${launched})`);
  const r = verifyPost(post, ctx);
  for (const c of r.checks) console.log(`   ${mark(c.pass)} ${c.label}${c.detail ? ` (${c.detail})` : ""}`);
  console.log(`   => ${r.pass ? "PASSES: the bounty would go to DETECTED_CONFIRMING" : "does NOT pass"}`);

  const q = buildSearchQuery({ action, username: target.username, ticker: ctx.ticker, mint: ctx.mint, launchPostId: ctx.launchPostId });
  if (q) {
    console.log(`\n4. Watcher search (every ${env.timing.watchEverySec}s per live coin): ${q}`);
    const found = await x.searchRecent(q, null, launched);
    console.log(`   ${found.length} result(s)${found.some((p) => p.id === post.id) ? ", including this post ✓" : ", this post NOT among them ✗ (older than 7 days, or not indexed yet)"}`);
  } else {
    console.log(`\n4. Video challenge: the watcher reads @${target.username}'s timeline instead of searching.`);
  }

  console.log(`\n5. 24-hour recheck, run now (post still live + latest edit still passes)`);
  const rc = await recheck(post.id, ctx, (id) => x.getPost(id));
  for (const c of rc.checks) console.log(`   ${mark(c.pass)} ${c.label}`);
  console.log(`   => ${rc.kind}\n`);
})().catch((e) => { console.error(`\n✗ ${(e as Error).message}\n`); process.exit(1); });
