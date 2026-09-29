// End-to-end tests of the whole bounty lifecycle, using the real services and a real
// (in-memory) Postgres. Only X and the chain are simulated. Timers are fast-forwarded.
import { describe, it, expect, beforeEach, vi } from "vitest";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { voteMessage } from "@bountypad/shared";
import { createDb } from "../src/db";
import { env } from "../src/env";
import type { Ctx } from "../src/app";
import { MockX } from "../src/sim/mockX";
import { DbHolders, SimPayouts, SimVideo } from "../src/adapters";
import { launch } from "../src/services/launch";
import { watch, rechecks, closeVotes, expire, roundTally } from "../src/services/pipeline";
import { releaseDue, linkWallet, optOut, freeze, unfreeze, cancelFrozen } from "../src/services/payouts";
import { setStatus } from "../src/services/status";
import { SIM_WALLETS, SIM_CREATOR, simTrade, simVotes } from "../src/sim/sim";
import { verifyAttestation } from "../src/core/payout";

vi.spyOn(console, "log").mockImplementation(() => {});

let ctx: Ctx;
let x: MockX;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  const db = await createDb("", { memory: true });
  x = new MockX();
  ctx = {
    db, x, mockX: x, video: new SimVideo(x), holders: new DbHolders(db), payouts: new SimPayouts(), privy: null, chain: null, xOAuth: null,
    env: { ...env, sim: true, privyPregenerate: false, timing: { ...env.timing, recheckAfterSec: 3600, voteWindowSec: 3600, challengeWindowSec: 3600, deadlineGraceSec: 600 } },
  };
});

async function coin(o: Partial<{ ticker: string; target: string; action: string; phrase: string; creator: string }> = {}) {
  const r = await launch(ctx, {
    name: "Test " + (o.ticker ?? "ROCKET"), ticker: o.ticker ?? "ROCKET", creatorWallet: o.creator ?? SIM_CREATOR, imageUrl: "https://example.com/coin.png",
    targetHandle: o.target ?? "novareyes", action: o.action ?? "TWEET_CASHTAG", phrase: o.phrase ?? null,
  });
  await sleep(5); // posts must be strictly after launch
  return r;
}
const status = async (bountyId: string) => (await ctx.db.query(`select status from bounties where id=$1`, [bountyId]))[0].status;
const pot = async (bountyId: string) => BigInt((await ctx.db.query(`select pot_lamports::text as p from bounties where id=$1`, [bountyId]))[0].p);
/** Make every waiting timer due, like the /dev fast-forward button. */
async function due() {
  await ctx.db.query(`update detections set recheck_at=now() - interval '1 second' where status='CONFIRMING'`);
  await ctx.db.query(`update vote_rounds set closes_at=now() - interval '1 second' where result='PENDING'`);
  await ctx.db.query(`update payouts set challenge_ends_at=now() - interval '1 second' where status='CHALLENGE_WINDOW'`);
}
async function jobs() { await watch(ctx); await rechecks(ctx); await closeVotes(ctx); await releaseDue(ctx); await expire(ctx); }
async function buy(tokenId: string, walletIdx: number, sol = 2) { await simTrade(ctx, tokenId, { side: "BUY", sol, walletIdx, quiet: true }); }

describe("launch", () => {
  it("always creates the coin AND its bounty together", async () => {
    const { id, bountyId } = await coin();
    const rows = await ctx.db.query(`select t.id, b.id as bid, b.status, b.action from tokens t join bounties b on b.token_id=t.id where t.id=$1`, [id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ bid: bountyId, status: "OPEN", action: "TWEET_CASHTAG" });
    const orphans = await ctx.db.query(`select count(*)::int as n from tokens t left join bounties b on b.token_id=t.id where b.id is null`);
    expect(orphans[0].n).toBe(0);
  });

  it("a failed transaction leaves nothing behind", async () => {
    await expect(ctx.db.tx(async (q) => {
      await q.query(`insert into tokens (id, mint, name, ticker, creator_wallet) values ('t1','m1','x','X','w')`);
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect((await ctx.db.query(`select count(*)::int as n from tokens where id='t1'`))[0].n).toBe(0);
  });

  it("rejects every invalid launch and creates nothing", async () => {
    const bad: [Record<string, unknown>, RegExp][] = [
      [{ ticker: "ROCKETMAN" }, /Max 6 letters/],
      [{ ticker: "R0CK" }, /Letters only/],
      [{ target: "lockedlena" }, /private/],
      [{ target: "novaparody" }, /Parody/],
      [{ target: "nobody_here" }, /No X account/],
      [{ action: "VIDEO_PHRASE", phrase: "hi" }, /at least 2 words/],
      [{ creator: "not-a-wallet" }, /Solana address/],
    ];
    for (const [o, err] of bad) await expect(coin(o as any)).rejects.toThrow(err);
    expect((await ctx.db.query(`select count(*)::int as n from tokens`))[0].n).toBe(0);
  });

  it("blocks a second live identical cashtag challenge, allows it after the first ends", async () => {
    const a = await coin();
    await expect(coin()).rejects.toThrow(/already exists/);
    await coin({ target: "jaxkimura" }); // same ticker, different person: fine
    await setStatus(ctx.db, a.bountyId, "EXPIRED", "test");
    await expect(coin()).resolves.toBeTruthy();
  });

  it("rejects targets who opted out", async () => {
    const { bountyId } = await coin();
    await optOut(ctx, "1001");
    expect(await status(bountyId)).toBe("OPTED_OUT");
    await expect(coin({ ticker: "NEW" })).rejects.toThrow(/opted out/);
  });
});

describe("fees", () => {
  it("every trade adds exactly its pot share to the bounty", async () => {
    const { id, bountyId } = await coin();
    for (let i = 1; i <= 10; i++) await buy(id, i, i);
    const sum = BigInt((await ctx.db.query(`select sum(pot_lamports)::text as s from trades where token_id=$1`, [id]))[0].s);
    expect(await pot(bountyId)).toBe(sum);
    expect(sum).toBe(55n * 4_000_000n); // 55 SOL volume x 0.4% pot share
  });
});

describe("text bounty: full lifecycle", () => {
  it("detects, confirms, verifies, waits, pays the right wallet with 2 valid signatures", async () => {
    const { id, bountyId } = await coin();
    await buy(id, 3, 10);
    x.createPost({ username: "novareyes", text: "ok fine, you win. $ROCKET" });

    await jobs();
    expect(await status(bountyId)).toBe("DETECTED_CONFIRMING");
    await jobs(); // recheck not due yet: nothing moves early
    expect(await status(bountyId)).toBe("DETECTED_CONFIRMING");

    await due(); await jobs();
    expect(await status(bountyId)).toBe("CHALLENGE_WINDOW");
    await buy(id, 4, 5); // fees earned during the challenge window
    await jobs(); // window not over yet
    expect((await ctx.db.query(`select status from payouts`))[0].status).toBe("CHALLENGE_WINDOW");

    await due(); await jobs();
    expect((await ctx.db.query(`select status from payouts`))[0].status).toBe("AWAITING_CLAIM"); // no wallet yet
    expect(await status(bountyId)).toBe("CHALLENGE_WINDOW");

    const wallet = SIM_WALLETS[40].address;
    await linkWallet(ctx, "1001", wallet);
    expect(await status(bountyId)).toBe("PAID");

    const p = (await ctx.db.query(`select *, amount_lamports::text as amt from payouts`))[0];
    expect(p.wallet).toBe(wallet);
    expect(BigInt(p.amt)).toBe(await pot(bountyId)); // includes the fees earned during the window
    expect(BigInt(p.amt)).toBe(15n * 4_000_000n);
    const valid = p.signatures.filter((s: any) => ctx.env.verifier.allowedSigners.includes(s.signer) && verifyAttestation(p.attestation, s.signer, s.signature));
    expect(valid.length).toBe(2);
    expect(p.attestation).toMatchObject({ bountyId, targetXUserId: "1001", payoutWallet: wallet });

    const audit = await ctx.db.query(`select to_status, post_id from audit_log where bounty_id=$1 order by id`, [bountyId]);
    expect(audit.map((a: any) => a.to_status)).toEqual(["OPEN", "DETECTED_CONFIRMING", "VERIFIED", "CHALLENGE_WINDOW", "PAID"]);
    expect(audit.slice(1).every((a: any) => a.post_id)).toBe(true);
  });

  it("pays instantly once a wallet is linked (second bounty needs no claim)", async () => {
    const { bountyId } = await coin();
    await linkWallet(ctx, "1001", SIM_WALLETS[40].address);
    x.createPost({ username: "novareyes", text: "$ROCKET" });
    await jobs(); await due(); await jobs(); await due(); await jobs();
    expect(await status(bountyId)).toBe("PAID");
  });

  it("ignores every fake or invalid post", async () => {
    const { bountyId } = await coin();
    x.createPost({ username: "novaparody", text: "$ROCKET" });          // look-alike account
    x.createPost({ username: "jaxkimura", text: "$ROCKET" });           // someone else
    x.createPost({ username: "novareyes", text: "$ROCKET", repost: "1" }); // repost
    x.createPost({ username: "novareyes", text: "$ROCKET", replyTo: "1" }); // reply
    x.createPost({ username: "novareyes", text: "not $ROCKETS lol" });  // wrong cashtag
    x.createPost({ username: "novareyes", text: "rocket without the cashtag" });
    await jobs(); await due(); await jobs();
    expect(await status(bountyId)).toBe("OPEN");
    expect((await ctx.db.query(`select count(*)::int as n from detections`))[0].n).toBe(0);
  });

  it("a deleted post is rejected, then a new valid post still wins", async () => {
    const { bountyId } = await coin();
    const post = x.createPost({ username: "novareyes", text: "$ROCKET" });
    await jobs();
    x.deletePost(post.id);
    await due(); await jobs();
    expect(await status(bountyId)).toBe("OPEN");
    x.createPost({ username: "novareyes", text: "fine, $ROCKET for real" });
    await jobs(); await due(); await jobs();
    expect(await status(bountyId)).toBe("CHALLENGE_WINDOW");
  });

  it("an edit that removes the cashtag is rejected", async () => {
    const { bountyId } = await coin();
    const post = x.createPost({ username: "novareyes", text: "$ROCKET" });
    await jobs();
    x.editPost(post.id, "never mind");
    await due(); await jobs();
    expect(await status(bountyId)).toBe("OPEN");
  });

  it("the same post is never processed twice", async () => {
    const { bountyId } = await coin();
    x.createPost({ username: "novareyes", text: "$ROCKET" });
    await jobs(); await jobs(); await jobs();
    expect((await ctx.db.query(`select count(*)::int as n from detections where bounty_id=$1`, [bountyId]))[0].n).toBe(1);
  });

  it("one post can settle two different coins that name the same person", async () => {
    const a = await coin({ ticker: "ROCKET" });
    const b = await coin({ ticker: "MOON" });
    x.createPost({ username: "novareyes", text: "$ROCKET and $MOON, happy?" });
    await jobs();
    expect(await status(a.bountyId)).toBe("DETECTED_CONFIRMING");
    expect(await status(b.bountyId)).toBe("DETECTED_CONFIRMING");
  });
});

describe("other text actions", () => {
  it("contract address bounty", async () => {
    const { id, bountyId } = await coin({ action: "TWEET_CONTRACT", target: "theo_voss" });
    const mint = (await ctx.db.query(`select mint from tokens where id=$1`, [id]))[0].mint;
    x.createPost({ username: "theo_voss", text: "ca: something-else" });
    await jobs();
    expect(await status(bountyId)).toBe("OPEN");
    x.createPost({ username: "theo_voss", text: `ok here: ${mint}` });
    await jobs(); await due(); await jobs();
    expect(await status(bountyId)).toBe("CHALLENGE_WINDOW");
  });

  it("quote bounty needs a quote of the exact launch post", async () => {
    const { id, bountyId } = await coin({ action: "QUOTE_LAUNCH", target: "alinamarsh" });
    const launchPost = (await ctx.db.query(`select launch_post_id from tokens where id=$1`, [id]))[0].launch_post_id;
    const other = x.createPost({ username: "bytezen", text: "random post" });
    x.createPost({ username: "alinamarsh", text: "lol", quoteOf: other.id });
    await jobs();
    expect(await status(bountyId)).toBe("OPEN");
    x.createPost({ username: "alinamarsh", text: "cute", quoteOf: launchPost });
    await jobs(); await due(); await jobs();
    expect(await status(bountyId)).toBe("CHALLENGE_WINDOW");
  });
});

describe("bio bounty", () => {
  it("pays when the contract address is in the bio, and it must still be there at the recheck", async () => {
    const { id, bountyId } = await coin({ action: "BIO_CONTRACT", target: "sofiaokafor" });
    const mint = (await ctx.db.query(`select mint from tokens where id=$1`, [id]))[0].mint;
    x.setBio("sofiaokafor", "builder. coffee.");
    await jobs();
    expect(await status(bountyId)).toBe("OPEN");
    x.setBio("sofiaokafor", `holding ${mint}`);
    await jobs();
    expect(await status(bountyId)).toBe("DETECTED_CONFIRMING");
    x.setBio("sofiaokafor", "changed my mind");
    await due(); await jobs();
    expect(await status(bountyId)).toBe("OPEN"); // removed before the recheck
    x.setBio("sofiaokafor", `ok fine ${mint}`);
    await jobs(); await due(); await jobs();
    expect(await status(bountyId)).toBe("CHALLENGE_WINDOW");
    const det = (await ctx.db.query(`select post_id, status from detections where bounty_id=$1 and status='VERIFIED'`, [bountyId]))[0];
    expect(det.post_id.startsWith("bio-")).toBe(true);
  });
});

describe("video bounties", () => {
  const video = (transcript: string, durationSec = 20) => x.createPost({ username: "jaxkimura", text: "ok", video: { transcript, durationSec } });

  it("exact phrase auto-approves after the recheck", async () => {
    const { bountyId } = await coin({ action: "VIDEO_PHRASE", target: "jaxkimura", phrase: "I am holding Jax coin", ticker: "JAX" });
    video("hey so I am holding jax coin now");
    await jobs(); await due(); await jobs();
    expect(await status(bountyId)).toBe("CHALLENGE_WINDOW");
  });

  it("unrelated speech auto-rejects; videos too long are ignored", async () => {
    const { bountyId } = await coin({ action: "VIDEO_PHRASE", target: "jaxkimura", phrase: "I am holding Jax coin", ticker: "JAX" });
    video("thanks for watching see you tomorrow");
    await jobs(); await due(); await jobs();
    expect(await status(bountyId)).toBe("OPEN");
    video("I am holding Jax coin", 600);
    await jobs();
    expect(await status(bountyId)).toBe("OPEN");
  });

  it("unclear video goes to a vote; snapshot excludes the creator and late buyers; YES pays", async () => {
    const { id, bountyId } = await coin({ action: "VIDEO_PHRASE", target: "jaxkimura", phrase: "I am holding Jax coin", ticker: "JAX" });
    for (let i = 1; i <= 20; i++) await buy(id, i, 1);
    await simTrade(ctx, id, { side: "BUY", sol: 3, wallet: SIM_CREATOR, quiet: true });
    video("ok I am holding jacks coins");
    await jobs();
    await buy(id, 30, 50); // bought after the video: must not be able to vote
    await due(); await jobs();
    expect(await status(bountyId)).toBe("VOTING");
    const round = (await ctx.db.query(`select * from vote_rounds where bounty_id=$1`, [bountyId]))[0];
    const snap = (round.snapshot as any[]).map((s) => s.wallet);
    expect(snap).not.toContain(SIM_CREATOR);
    expect(snap).not.toContain(SIM_WALLETS[30].address);
    expect(snap).toHaveLength(20);

    await simVotes(ctx, round.id, 1, 1);
    await due(); await jobs();
    expect((await ctx.db.query(`select result from vote_rounds where id=$1`, [round.id]))[0].result).toBe("PASSED");
    expect(await status(bountyId)).toBe("CHALLENGE_WINDOW");
  });

  it("a NO vote reopens the challenge and pays nobody", async () => {
    const { id, bountyId } = await coin({ action: "VIDEO_PHRASE", target: "jaxkimura", phrase: "I am holding Jax coin", ticker: "JAX" });
    for (let i = 1; i <= 20; i++) await buy(id, i, 1);
    const before = await pot(bountyId);
    video("ok I am holding jacks coins");
    await jobs(); await due(); await jobs();
    const round = (await ctx.db.query(`select * from vote_rounds where bounty_id=$1`, [bountyId]))[0];
    await simVotes(ctx, round.id, 0, 1);
    await due(); await jobs();
    expect(await status(bountyId)).toBe("OPEN");
    expect(await pot(bountyId)).toBe(before);
    expect((await ctx.db.query(`select count(*)::int as n from payouts`))[0].n).toBe(0);
  });

  it("no quorum extends once, then reopens", async () => {
    const { id, bountyId } = await coin({ action: "VIDEO_PHRASE", target: "jaxkimura", phrase: "I am holding Jax coin", ticker: "JAX" });
    for (let i = 1; i <= 20; i++) await buy(id, i, 1);
    video("ok I am holding jacks coins");
    await jobs(); await due(); await jobs();
    await due(); await jobs();
    const r1 = (await ctx.db.query(`select * from vote_rounds where bounty_id=$1`, [bountyId]))[0];
    expect(r1.extended).toBe(true);
    expect(r1.result).toBe("PENDING");
    await due(); await jobs();
    expect((await ctx.db.query(`select result from vote_rounds where id=$1`, [r1.id]))[0].result).toBe("NO_QUORUM");
    expect(await status(bountyId)).toBe("OPEN");
  });

  it("a whale can't decide alone (5% cap)", async () => {
    const { id, bountyId } = await coin({ action: "VIDEO_PHRASE", target: "jaxkimura", phrase: "I am holding Jax coin", ticker: "JAX" });
    for (let i = 1; i <= 20; i++) await buy(id, i, 1);
    await buy(id, 21, 80); // whale: 80% of supply
    video("ok I am holding jacks coins");
    await jobs(); await due(); await jobs();
    const round = (await ctx.db.query(`select * from vote_rounds where bounty_id=$1`, [bountyId]))[0];
    const vote = async (idx: number, choice: "YES" | "NO") => {
      const w = SIM_WALLETS[idx];
      await ctx.db.query(`insert into votes (round_id, wallet, choice, signature) values ($1,$2,$3,$4)`, [round.id, w.address, choice,
        bs58.encode(nacl.sign.detached(new TextEncoder().encode(voteMessage(round.id, choice)), w.secretKey))]);
    };
    await vote(21, "NO");
    for (let i = 1; i <= 8; i++) await vote(i, "YES");
    const t = await roundTally(ctx, round);
    expect(t.passed).toBe(true);
    expect(Number(t.noWeight)).toBeLessThanOrEqual(Number(t.eligibleSupply) * 0.05 + 1);
  });
});

describe("deadline", () => {
  it("a post made before the deadline counts even if seen during the grace period", async () => {
    const { bountyId } = await coin();
    x.createPost({ username: "novareyes", text: "$ROCKET" });
    await sleep(5);
    await ctx.db.query(`update bounties set deadline=now() where id=$1`, [bountyId]);
    await sleep(5);
    await jobs();
    expect(await status(bountyId)).toBe("DETECTED_CONFIRMING");
  });

  it("a post made after the deadline doesn't count, and the bounty expires", async () => {
    const { bountyId } = await coin();
    await ctx.db.query(`update bounties set deadline=now() - interval '1 second' where id=$1`, [bountyId]);
    await sleep(5);
    x.createPost({ username: "novareyes", text: "$ROCKET" });
    await jobs();
    expect(await status(bountyId)).toBe("OPEN"); // still in grace, but the post is late
    await ctx.db.query(`update bounties set deadline=now() - interval '1 hour' where id=$1`, [bountyId]);
    await jobs();
    expect(await status(bountyId)).toBe("EXPIRED");
  });
});

describe("opt-out and admin", () => {
  it("opting out mid-confirmation ends cleanly, no payout, no stuck jobs", async () => {
    const { bountyId } = await coin();
    x.createPost({ username: "novareyes", text: "$ROCKET" });
    await jobs();
    await optOut(ctx, "1001");
    await due(); await jobs(); await jobs();
    expect(await status(bountyId)).toBe("OPTED_OUT");
    expect((await ctx.db.query(`select status from detections`))[0].status).toBe("REJECTED");
    expect((await ctx.db.query(`select count(*)::int as n from payouts`))[0].n).toBe(0);
  });

  it("opting out mid-vote cancels the vote", async () => {
    const { id, bountyId } = await coin({ action: "VIDEO_PHRASE", target: "jaxkimura", phrase: "I am holding Jax coin", ticker: "JAX" });
    for (let i = 1; i <= 5; i++) await buy(id, i, 1);
    x.createPost({ username: "jaxkimura", text: "ok", video: { transcript: "ok I am holding jacks coins", durationSec: 9 } });
    await jobs(); await due(); await jobs();
    await optOut(ctx, "1002");
    await due(); await jobs();
    expect(await status(bountyId)).toBe("OPTED_OUT");
    expect((await ctx.db.query(`select result from vote_rounds`))[0].result).toBe("CANCELLED");
  });

  it("freeze stops the payout; unfreeze restarts it; cancel reopens the challenge", async () => {
    const { bountyId } = await coin();
    await linkWallet(ctx, "1001", SIM_WALLETS[40].address);
    x.createPost({ username: "novareyes", text: "$ROCKET" });
    await jobs(); await due(); await jobs();
    const pid = (await ctx.db.query(`select id from payouts`))[0].id;
    await freeze(ctx, pid);
    await due(); await jobs();
    expect(await status(bountyId)).toBe("FROZEN");
    await unfreeze(ctx, pid);
    expect(await status(bountyId)).toBe("CHALLENGE_WINDOW");
    await freeze(ctx, pid);
    await cancelFrozen(ctx, pid);
    expect(await status(bountyId)).toBe("OPEN");
    expect((await ctx.db.query(`select count(*)::int as n from payouts`))[0].n).toBe(0);
  });
});

describe("wallets", () => {
  it("rejects invalid payout addresses", async () => {
    await expect(linkWallet(ctx, "1001", "not-a-wallet")).rejects.toThrow(/valid Solana address/);
  });

  it("Path 1: pays a Privy wallet tied to the X account without any claim", async () => {
    const privyWallet = SIM_WALLETS[44].address;
    ctx.privy = { walletForX: async () => privyWallet } as any;
    ctx.env = { ...ctx.env, privyPregenerate: true };
    const { bountyId } = await coin();
    x.createPost({ username: "novareyes", text: "$ROCKET" });
    await jobs(); await due(); await jobs(); await due(); await jobs();
    expect(await status(bountyId)).toBe("PAID");
    expect((await ctx.db.query(`select wallet from payouts`))[0].wallet).toBe(privyWallet);
  });
});

describe("safety", () => {
  it("two jobs can't move the same bounty at once", async () => {
    const { bountyId } = await coin();
    const results = await Promise.allSettled([
      ctx.db.tx((q) => setStatus(q, bountyId, "EXPIRED", "a")),
      ctx.db.tx((q) => setStatus(q, bountyId, "OPTED_OUT", "b")),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(["EXPIRED", "OPTED_OUT"]).toContain(await status(bountyId));
  });

  it("illegal jumps are refused", async () => {
    const { bountyId } = await coin();
    await expect(setStatus(ctx.db, bountyId, "PAID", "cheat")).rejects.toThrow(/Illegal/);
  });
});

describe("social links", () => {
  it("keeps valid links (normalized to https), rejects links on the wrong platform", async () => {
    const r = await launch(ctx, {
      name: "Linked", ticker: "LINKD", creatorWallet: SIM_CREATOR, imageUrl: "https://example.com/c.png", targetHandle: "novareyes", action: "TWEET_CASHTAG",
      links: { website: "bountypad.xyz", x: "https://x.com/bountypad", telegram: "t.me/bountypad", github: "https://github.com/bountypad", tiktok: "https://www.tiktok.com/@bp", youtube: "https://youtu.be/abc", },
    });
    const t = (await ctx.db.query(`select links from tokens where id=$1`, [r.id]))[0];
    expect(t.links).toEqual({ website: "https://bountypad.xyz/", x: "https://x.com/bountypad", telegram: "https://t.me/bountypad", github: "https://github.com/bountypad", tiktok: "https://www.tiktok.com/@bp", youtube: "https://youtu.be/abc" });
    const { tokenMetadata } = await import("../src/services/launch");
    const mint = (await ctx.db.query(`select mint from tokens where id=$1`, [r.id]))[0].mint;
    const m: any = await tokenMetadata(ctx, mint);
    expect(m).toMatchObject({ symbol: "LINKD", website: "https://bountypad.xyz/", twitter: "https://x.com/bountypad", telegram: "https://t.me/bountypad" });
    expect(m.extensions.github).toBe("https://github.com/bountypad");

    await expect(launch(ctx, {
      name: "Bad", ticker: "BADL", creatorWallet: SIM_CREATOR, imageUrl: "https://example.com/c.png", targetHandle: "novareyes", action: "TWEET_CASHTAG",
      links: { github: "https://evil.example/github" },
    })).rejects.toThrow(/GitHub/);
  });
});
