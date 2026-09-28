import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Ctx } from "../app";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { SIM_WALLETS, simTrade, simVotes } from "../sim/sim";

/** SIM-only controls so the whole flow can be demoed without X, Privy or Solana. */
export async function devRoutes(app: FastifyInstance, ctx: Ctx) {
  const x = ctx.mockX!;
  const { db } = ctx;

  app.get("/api/dev/users", async () => x.users.filter((u) => u.username !== "bountypad"));
  app.get("/api/dev/wallets", async () => SIM_WALLETS.slice(0, 12).map((w) => w.address));

  app.get("/api/dev/posts", async () =>
    [...x.posts.values()].sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1)).slice(0, 30)
      .map((p) => ({ ...p, username: x.userById(p.authorId)?.username, deleted: x.deleted.has(p.id) })));

  app.post("/api/dev/post", async (req) => {
    const b = z.object({
      username: z.string(), text: z.string().default(""),
      quoteOf: z.string().optional(), reply: z.boolean().optional(), repost: z.boolean().optional(),
      video: z.object({ transcript: z.string(), durationSec: z.number().min(1).max(3600) }).optional(),
    }).parse(req.body);
    return x.createPost({ username: b.username, text: b.text, quoteOf: b.quoteOf, replyTo: b.reply ? "1" : undefined, repost: b.repost ? "1" : undefined, video: b.video });
  });

  app.post("/api/dev/edit", async (req) => {
    const b = z.object({ postId: z.string(), text: z.string() }).parse(req.body);
    return x.editPost(b.postId, b.text);
  });

  app.post("/api/dev/delete", async (req) => {
    const b = z.object({ postId: z.string() }).parse(req.body);
    x.deletePost(b.postId);
    return { ok: true };
  });

  /** Skip the waiting: make rechecks, votes and challenge windows due now. */
  app.post("/api/dev/fast-forward", async () => {
    await db.query(`update detections set recheck_at=now() where status='CONFIRMING'`);
    await db.query(`update vote_rounds set closes_at=now() where result='PENDING'`);
    await db.query(`update payouts set challenge_ends_at=now() where status='CHALLENGE_WINDOW'`);
    return { ok: true };
  });

  app.post("/api/dev/votes/:roundId", async (req) => {
    const b = z.object({ yesShare: z.number().min(0).max(1), turnout: z.number().min(0).max(1).default(0.7) }).parse(req.body);
    return { voters: await simVotes(ctx, (req.params as any).roundId, b.yesShare, b.turnout) };
  });

  app.post("/api/dev/trades/:tokenId", async (req) => {
    const n = z.object({ count: z.number().int().min(1).max(50).default(10) }).parse(req.body ?? {}).count;
    for (let i = 0; i < n; i++) await simTrade(ctx, (req.params as any).tokenId, { side: "BUY" });
    return { ok: true };
  });

  /** Buy with any wallet (e.g. your Privy wallet) so you become a holder and can vote. */
  app.post("/api/dev/buy", async (req) => {
    const b = z.object({ tokenId: z.string(), wallet: z.string().min(32).max(44), sol: z.number().min(0.01).max(100).default(1) }).parse(req.body);
    await simTrade(ctx, b.tokenId, { side: "BUY", sol: b.sol, wallet: b.wallet });
    return { ok: true };
  });

  /** Dev login without Privy: sign a message with one of the simulated wallets. SIM only. */
  app.post("/api/dev/sign", async (req, reply) => {
    const b = z.object({ wallet: z.string(), message: z.string().max(500) }).parse(req.body);
    const w = SIM_WALLETS.find((s) => s.address === b.wallet);
    if (!w) return reply.status(400).send({ error: "Not a simulated wallet" });
    return { signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(b.message), w.secretKey)) };
  });
}
