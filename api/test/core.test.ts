import { describe, it, expect } from "vitest";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { splitTradeFee, tickerError, normalizeHandle, handleError, voteMessage } from "@bountypad/shared";
import { buildSearchQuery, groupByTarget } from "../src/core/query";
import { verifyPost, recheck, type VerifyContext } from "../src/core/verifier";
import { phraseMatchScore, videoDecision } from "../src/core/phrase";
import { tallyVotes, verifyVoteSignature, closeRound } from "../src/core/voting";
import { signAttestation, verifyAttestation, countValidSignatures, type PayoutAttestation } from "../src/core/payout";
import { canTransition, assertTransition } from "../src/core/status";
import type { XPost } from "../src/x/types";

const ctx: VerifyContext = {
  action: "TWEET_CASHTAG",
  targetXUserId: "111",
  targetUsername: "novareyes",
  ticker: "ROCKET",
  mint: "RockEtMint1111111111111111111111111111111",
  launchPostId: "900",
  tokenCreatedAt: "2026-09-01T00:00:00Z",
};
const post = (o: Partial<XPost> = {}): XPost => ({
  id: "1000", authorId: "111", text: "ok fine, you win. $ROCKET", createdAt: "2026-09-02T00:00:00Z",
  cashtags: ["ROCKET"], referenced: [], editHistoryIds: ["1000"], media: [], ...o,
});

describe("shared validation", () => {
  it("ticker must be 1-6 letters", () => {
    expect(tickerError("$rocket")).toBeNull();
    expect(tickerError("ROCKETS")).toMatch(/Max 6/);
    expect(tickerError("R0CK")).toMatch(/Letters/);
    expect(tickerError("")).toMatch(/required/);
  });
  it("normalizes handles and urls", () => {
    expect(normalizeHandle("@NovaReyes")).toBe("novareyes");
    expect(normalizeHandle("https://x.com/NovaReyes/status/1")).toBe("novareyes");
    expect(handleError("bad handle!")).toBeTruthy();
  });
});

describe("fees", () => {
  it("splits 1 SOL trade: 1% fee, DBC 20%, pot/platform/creator 50/30/20 of partner", () => {
    const s = splitTradeFee(1_000_000_000n);
    expect(s.tradeFee).toBe(10_000_000n);
    expect(s.dbcProtocol).toBe(2_000_000n);
    expect(s.partner).toBe(8_000_000n);
    expect(s.pot).toBe(4_000_000n);
    expect(s.creator).toBe(1_600_000n);
    expect(s.platform).toBe(2_400_000n);
    expect(s.pot + s.creator + s.platform).toBe(s.partner);
  });
});

describe("search queries", () => {
  const base = { username: "novareyes", ticker: "ROCKET", mint: "MINT", launchPostId: "900" };
  it("builds one query per action", () => {
    expect(buildSearchQuery({ ...base, action: "TWEET_CASHTAG" })).toBe("from:novareyes $ROCKET -is:retweet");
    expect(buildSearchQuery({ ...base, action: "TWEET_CONTRACT" })).toBe('from:novareyes "MINT" -is:retweet');
    expect(buildSearchQuery({ ...base, action: "QUOTE_LAUNCH" })).toBe("quotes_of_tweet_id:900 from:novareyes");
    expect(buildSearchQuery({ ...base, action: "VIDEO_PHRASE" })).toBeNull();
    expect(buildSearchQuery({ ...base, launchPostId: null, action: "QUOTE_LAUNCH" })).toBeNull();
  });
  it("groups bounties by target", () => {
    const g = groupByTarget([{ targetXUserId: "a" }, { targetXUserId: "b" }, { targetXUserId: "a" }]);
    expect(g.get("a")?.length).toBe(2);
    expect(g.size).toBe(2);
  });
});

describe("verifyPost", () => {
  it("passes a valid cashtag post", () => {
    expect(verifyPost(post(), ctx).pass).toBe(true);
  });
  it("fails wrong author (look-alike account)", () => {
    const r = verifyPost(post({ authorId: "999" }), ctx);
    expect(r.pass).toBe(false);
    expect(r.checks.find((c) => c.id === "AUTHOR")?.pass).toBe(false);
  });
  it("fails posts from before launch", () => {
    expect(verifyPost(post({ createdAt: "2026-08-01T00:00:00Z" }), ctx).pass).toBe(false);
  });
  it("fails reposts and replies", () => {
    expect(verifyPost(post({ referenced: [{ type: "retweeted", id: "5" }] }), ctx).pass).toBe(false);
    expect(verifyPost(post({ referenced: [{ type: "replied_to", id: "5" }] }), ctx).pass).toBe(false);
  });
  it("cashtag must match exactly, not a prefix", () => {
    expect(verifyPost(post({ cashtags: ["ROCKETS"], text: "$ROCKETS" }), ctx).pass).toBe(false);
    expect(verifyPost(post({ cashtags: [], text: "buy $rocket now" }), ctx).pass).toBe(true);
    expect(verifyPost(post({ cashtags: [], text: "buy $ROCKETS now" }), ctx).pass).toBe(false);
  });
  it("contract bounty needs the exact address", () => {
    const c = { ...ctx, action: "TWEET_CONTRACT" as const };
    expect(verifyPost(post({ text: `ca: ${ctx.mint}` }), c).pass).toBe(true);
    expect(verifyPost(post({ text: "ca: something else" }), c).pass).toBe(false);
  });
  it("quote bounty needs a quote of the exact launch post", () => {
    const c = { ...ctx, action: "QUOTE_LAUNCH" as const };
    expect(verifyPost(post({ referenced: [{ type: "quoted", id: "900" }] }), c).pass).toBe(true);
    expect(verifyPost(post({ referenced: [{ type: "quoted", id: "901" }] }), c).pass).toBe(false);
  });
  it("video bounty needs a native video under the max length", () => {
    const c = { ...ctx, action: "VIDEO_PHRASE" as const };
    expect(verifyPost(post({ media: [{ type: "video", durationMs: 30_000, mp4Url: "u" }] }), c).pass).toBe(true);
    expect(verifyPost(post({ media: [{ type: "video", durationMs: 600_000, mp4Url: "u" }] }), c).pass).toBe(false);
    expect(verifyPost(post({ media: [{ type: "photo", durationMs: null, mp4Url: null }] }), c).pass).toBe(false);
  });
});

describe("24h recheck", () => {
  it("fails when the post was deleted", async () => {
    const r = await recheck("1000", ctx, async () => null);
    expect(r.kind).toBe("DELETED");
  });
  it("checks the latest edited version", async () => {
    const store: Record<string, XPost> = {
      "1000": post({ editHistoryIds: ["1000", "1001"] }),
      "1001": post({ id: "1001", text: "edited, nothing here", cashtags: [], editHistoryIds: ["1000", "1001"] }),
    };
    const r = await recheck("1000", ctx, async (id) => store[id] ?? null);
    expect(r.kind).toBe("FAIL");
  });
  it("passes when still live and unchanged", async () => {
    const r = await recheck("1000", ctx, async () => post());
    expect(r.kind).toBe("PASS");
    expect(r.checks.find((c) => c.id === "STILL_LIVE")?.pass).toBe(true);
  });
});

describe("video phrase matching", () => {
  it("scores exact and near matches high", () => {
    expect(phraseMatchScore("I'm holding Rocket coin", "yeah so I'm holding rocket coin guys")).toBe(100);
    expect(phraseMatchScore("I'm holding Rocket coin", "im holding rockit coin")).toBeGreaterThanOrEqual(85);
  });
  it("rejects speech that shares small words but not the phrase", () => {
    expect(phraseMatchScore("I am holding Jax coin", "I am going to the gym")).toBeLessThanOrEqual(30);
    expect(phraseMatchScore("I am holding Jax coin", "good morning everyone welcome to the stream")).toBeLessThanOrEqual(30);
    expect(phraseMatchScore("I am holding Jax coin", "ok so today, I am holding Jax coin, let's go")).toBe(100);
  });
  it("scores unrelated speech low", () => {
    expect(phraseMatchScore("I'm holding Rocket coin", "good morning everyone welcome to the stream")).toBeLessThan(40);
  });
  it("maps scores to decisions", () => {
    expect(videoDecision(95)).toBe("AUTO_APPROVE");
    expect(videoDecision(20)).toBe("AUTO_REJECT");
    expect(videoDecision(60)).toBe("VOTE");
  });
});

describe("voting", () => {
  const snap = [
    { wallet: "whale", balance: 500n },
    { wallet: "a", balance: 100n },
    { wallet: "b", balance: 100n },
    { wallet: "c", balance: 300n },
  ]; // eligible 1000, cap 5% = 50
  it("caps each wallet at 5% so a whale can't decide alone", () => {
    const t = tallyVotes(snap, [{ wallet: "whale", choice: "NO" }, { wallet: "a", choice: "YES" }, { wallet: "b", choice: "YES" }]);
    expect(t.noWeight).toBe("50");
    expect(t.yesWeight).toBe("100");
    expect(t.passed).toBe(true);
  });
  it("ignores wallets not in the snapshot and duplicate votes", () => {
    const t = tallyVotes(snap, [{ wallet: "late-buyer", choice: "YES" }, { wallet: "a", choice: "YES" }, { wallet: "a", choice: "NO" }]);
    expect(t.turnout).toBe("100");
    expect(t.yesWeight).toBe("50");
  });
  it("needs 10% quorum and 60% yes", () => {
    const low = tallyVotes(snap, [{ wallet: "none", choice: "YES" }]);
    expect(low.quorumMet).toBe(false);
    const split = tallyVotes(snap, [{ wallet: "a", choice: "YES" }, { wallet: "c", choice: "NO" }]);
    expect(split.quorumMet).toBe(true);
    expect(split.yesPct).toBe(50);
    expect(split.passed).toBe(false);
  });
  it("extends once on no quorum, then gives up", () => {
    const t = tallyVotes(snap, []);
    expect(closeRound(t, false)).toBe("EXTEND");
    expect(closeRound(t, true)).toBe("NO_QUORUM");
  });
  it("verifies wallet vote signatures", () => {
    const kp = nacl.sign.keyPair();
    const wallet = bs58.encode(kp.publicKey);
    const sig = bs58.encode(nacl.sign.detached(new TextEncoder().encode(voteMessage("r1", "YES")), kp.secretKey));
    expect(verifyVoteSignature("r1", "YES", wallet, sig)).toBe(true);
    expect(verifyVoteSignature("r1", "NO", wallet, sig)).toBe(false);
    expect(verifyVoteSignature("r2", "YES", wallet, sig)).toBe(false);
  });
});

describe("payout attestation", () => {
  const a: PayoutAttestation = { bountyId: "b1", targetXUserId: "111", postId: "1000", payoutWallet: "W", amountLamports: "123", expiry: 1_900_000_000 };
  it("signs and verifies; any field change breaks it", () => {
    const kp = nacl.sign.keyPair();
    const s = signAttestation(a, bs58.encode(kp.secretKey));
    expect(verifyAttestation(a, s.signer, s.signature)).toBe(true);
    expect(verifyAttestation({ ...a, payoutWallet: "X" }, s.signer, s.signature)).toBe(false);
  });
  it("counts only distinct allowed signers (2 of 3)", () => {
    const k1 = nacl.sign.keyPair(), k2 = nacl.sign.keyPair(), k3 = nacl.sign.keyPair();
    const allowed = [k1, k2].map((k) => bs58.encode(k.publicKey));
    const s1 = signAttestation(a, bs58.encode(k1.secretKey));
    const s3 = signAttestation(a, bs58.encode(k3.secretKey));
    expect(countValidSignatures(a, [s1, s1, s3], allowed)).toBe(1);
    const s2 = signAttestation(a, bs58.encode(k2.secretKey));
    expect(countValidSignatures(a, [s1, s2], allowed)).toBe(2);
  });
});

describe("status machine", () => {
  it("follows the documented flow", () => {
    expect(canTransition("OPEN", "DETECTED_CONFIRMING")).toBe(true);
    expect(canTransition("DETECTED_CONFIRMING", "VOTING")).toBe(true);
    expect(canTransition("VERIFIED", "CHALLENGE_WINDOW")).toBe(true);
    expect(canTransition("CHALLENGE_WINDOW", "PAID")).toBe(true);
  });
  it("blocks illegal jumps", () => {
    expect(() => assertTransition("OPEN", "PAID")).toThrow();
    expect(() => assertTransition("PAID", "OPEN")).toThrow();
    expect(canTransition("EXPIRED", "OPEN")).toBe(false);
  });
});
