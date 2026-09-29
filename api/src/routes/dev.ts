import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Ctx } from "../app";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { SIM_WALLETS, simTrade, simVotes } from "../sim/sim";

/**
 * Dev-only controls (DEV_TOOLS, never on a public deployment): fake X posts with the simulated X,
 * simulated trades with the simulated chain, and sim wallets that sign real transactions on
 * localnet/devnet so the whole on-chain flow can be tested without Privy.
 */
export async function devRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;
  app.get("/api/dev/wallets", async () => SIM_WALLETS.slice(0, 12).map((w) => w.address));

  /** Dev login without Privy: sign a message with one of the simulated wallets. */
  app.post("/api/dev/sign", async (req, reply) => {
    const b = z.object({ wallet: z.string(), message: z.string().max(500) }).parse(req.body);
    const w = SIM_WALLETS.find((s) => s.address === b.wallet);
    if (!w) return reply.status(400).send({ error: "Not a simulated wallet" });
    return { signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(b.message), w.secretKey)) };
  });

  /** fast-forward: make rechecks, votes and challenge windows due now (DB timers only; the escrow keeps its own clock). */
  app.post("/api/dev/fast-forward", async () => {
    await db.query(`update detections set recheck_at=now() where status='CONFIRMING'`);
    await db.query(`update vote_rounds set closes_at=now() where result='PENDING'`);
    await db.query(`update payouts set challenge_ends_at=now() where status='CHALLENGE_WINDOW'`);
    return { ok: true };
  });

  if (ctx.chain) {
    const chain = ctx.chain;
    /** A sim wallet signs a real transaction (localnet/devnet testing without a browser wallet). */
    app.post("/api/dev/sign-tx", async (req, reply) => {
      const b = z.object({ wallet: z.string(), transaction: z.string().max(4000) }).parse(req.body);
      const w = SIM_WALLETS.find((s) => s.address === b.wallet);
      if (!w) return reply.status(400).send({ error: "Not a simulated wallet" });
      const tx = Transaction.from(Buffer.from(b.transaction, "base64"));
      tx.partialSign(Keypair.fromSecretKey(w.secretKey));
      return { signedTransaction: tx.serialize({ requireAllSignatures: false }).toString("base64") };
    });
    app.post("/api/dev/airdrop", async (req, reply) => {
      if (chain.cluster === "mainnet-beta") return reply.status(400).send({ error: "no airdrops on mainnet" });
      const b = z.object({ wallet: z.string(), sol: z.number().min(0.1).max(100).default(5) }).parse(req.body);
      const to = new PublicKey(b.wallet);
      try {
        const sig = await chain.connection.requestAirdrop(to, Math.round(b.sol * 1e9));
        await chain.connection.confirmTransaction(sig, "confirmed");
      } catch (e) {
        // The public devnet faucet is often rate limited (429). Test SOL from the keeper instead,
        // capped so the keeper always keeps enough to pay for fee claims and payouts.
        const give = Math.min(0.5, b.sol) * 1e9, keep = 1e9;
        const bal = Number(await chain.balance(chain.keeper.publicKey));
        if (chain.cluster !== "devnet" && chain.cluster !== "localnet") throw e;
        if (bal - give < keep) return reply.status(429).send({ error: "The devnet faucet is busy. Get free test SOL at faucet.solana.com (sign in with GitHub)." });
        await chain.send(new Transaction().add(SystemProgram.transfer({ fromPubkey: chain.keeper.publicKey, toPubkey: to, lamports: Math.round(give) })));
      }
      return { ok: true, balance: Number(await chain.balance(to)) / 1e9 };
    });
  }

  if (!ctx.chain) {
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
  }

  app.post("/api/dev/votes/:roundId", async (req) => {
    const b = z.object({ yesShare: z.number().min(0).max(1), turnout: z.number().min(0).max(1).default(0.7) }).parse(req.body);
    return { voters: await simVotes(ctx, (req.params as any).roundId, b.yesShare, b.turnout) };
  });

  if (!ctx.mockX) return;
  const x = ctx.mockX;
  app.get("/api/dev/users", async () => x.users.filter((u) => u.username !== "bountypad"));

  app.get("/api/dev/posts", async () =>
    [...x.posts.values()].sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1)).slice(0, 30)
      .map((p) => ({ ...p, username: x.userById(p.authorId)?.username, deleted: x.deleted.has(p.id) })));

  /** Set a simulated account's X bio (for the bio challenge). */
  app.post("/api/dev/bio", async (req) => {
    const b = z.object({ username: z.string(), text: z.string().max(160) }).parse(req.body);
    x.setBio(b.username, b.text);
    return { ok: true };
  });

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

}
