import { randomUUID, createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PublicKey, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { splitTradeFee, type PreparedTrade } from "@bountypad/shared";
import type { Ctx } from "../app";
import { isSolanaAddress } from "../core/solana";
import { prepareLaunch, submitLaunch, tokenMetadata, LaunchError } from "../services/launch";
import { emit } from "../services/events";
import { recordTick } from "../services/market";

/** Trades waiting for a wallet signature. In memory: the API runs as a single instance. */
const pendingTrades = new Map<string, { tokenId: string; wallet: string; side: "BUY" | "SELL"; amountIn: bigint; expectedOut: bigint; hash: string; expires: number }>();
const msgHash = (tx: Transaction) => createHash("sha256").update(tx.serializeMessage()).digest("hex");

export async function chainRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;

  app.post("/api/launch/prepare", async (req) => prepareLaunch(ctx, req.body));

  app.post("/api/launch/submit", async (req) => {
    const b = z.object({ launchId: z.string().uuid(), signedTransaction: z.string().max(4000) }).parse(req.body);
    return submitLaunch(ctx, b.launchId, b.signedTransaction);
  });

  // Metaplex JSON behind the `uri` written on-chain at launch (wallets and explorers read it).
  app.get("/api/meta/:mint", async (req, reply) => {
    const m = await tokenMetadata(ctx, (req.params as any).mint);
    if (!m) return reply.status(404).send({ error: "not found" });
    reply.header("Cache-Control", "public, max-age=300");
    return m;
  });

  app.get("/api/chain/balance", async (req, reply) => {
    if (!ctx.chain) return reply.status(400).send({ error: "The API isn't in on-chain mode" });
    const q = z.object({ wallet: z.string().refine(isSolanaAddress), mint: z.string().refine(isSolanaAddress).optional() }).parse(req.query);
    const owner = new PublicKey(q.wallet);
    const lamports = (await ctx.chain.balance(owner)).toString();
    let tokenAmount: string | null = null;
    if (q.mint) {
      const ata = getAssociatedTokenAddressSync(new PublicKey(q.mint), owner);
      tokenAmount = await ctx.chain.connection.getTokenAccountBalance(ata, "confirmed").then((r) => r.value.amount).catch(() => "0");
    }
    return { lamports, tokenAmount };
  });

  app.post("/api/trade/prepare", async (req, reply): Promise<PreparedTrade | void> => {
    if (!ctx.chain) return reply.status(400).send({ error: "The API isn't in on-chain mode" });
    const b = z.object({
      tokenId: z.string(), wallet: z.string().refine(isSolanaAddress, "not a valid Solana address"),
      side: z.enum(["BUY", "SELL"]), amount: z.string().regex(/^\d+$/, "amount in base units"), slippageBps: z.number().int().min(10).max(5000).default(500),
    }).parse(req.body);
    const t = (await db.query(`select id, mint from tokens where id=$1 or mint=$1`, [b.tokenId]))[0];
    if (!t) return reply.status(404).send({ error: "coin not found" });
    const amountIn = BigInt(b.amount);
    if (amountIn <= 0n) throw new LaunchError("Amount must be above zero");
    if (b.side === "BUY" && ctx.env.maxBuySol > 0 && amountIn > BigInt(Math.round(ctx.env.maxBuySol * 1e9)))
      throw new LaunchError(`Buys are limited to ${ctx.env.maxBuySol} SOL per transaction for now`);
    const q = await ctx.chain.launchpad.swapTx({ mint: new PublicKey(t.mint), owner: new PublicKey(b.wallet), side: b.side, amountIn, slippageBps: b.slippageBps });
    const { blockhash, lastValidBlockHeight } = await ctx.chain.connection.getLatestBlockhash("confirmed");
    q.tx.recentBlockhash = blockhash;
    q.tx.lastValidBlockHeight = lastValidBlockHeight;
    const tradeId = randomUUID();
    pendingTrades.set(tradeId, { tokenId: t.id, wallet: b.wallet, side: b.side, amountIn, expectedOut: q.expectedOut, hash: msgHash(q.tx), expires: Date.now() + 120_000 });
    for (const [k, v] of pendingTrades) if (v.expires < Date.now()) pendingTrades.delete(k);
    return {
      tradeId, expectedOut: q.expectedOut.toString(), minimumOut: q.minimumOut.toString(),
      transaction: q.tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    };
  });

  app.post("/api/trade/submit", async (req, reply) => {
    if (!ctx.chain) return reply.status(400).send({ error: "The API isn't in on-chain mode" });
    const b = z.object({ tradeId: z.string().uuid(), signedTransaction: z.string().max(4000) }).parse(req.body);
    const p = pendingTrades.get(b.tradeId);
    if (!p) return reply.status(404).send({ error: "Trade expired. Try again." });
    const bytes = Buffer.from(b.signedTransaction, "base64");
    const tx = Transaction.from(bytes);
    if (msgHash(tx) !== p.hash) return reply.status(400).send({ error: "The signed transaction isn't the one we prepared" });
    pendingTrades.delete(b.tradeId);
    const sig = await ctx.chain.sendSigned(bytes);
    // Recorded for the coin page (chart, feed, holder count). The pot itself is read from the chain.
    const t = (await db.query(`select mint, ticker from tokens where id=$1`, [p.tokenId]))[0];
    const sol = p.side === "BUY" ? p.amountIn : p.expectedOut;
    const tokens = p.side === "BUY" ? p.expectedOut : p.amountIn;
    const potEstimate = splitTradeFee(sol).pot;
    // The price after the trade, read from the pool itself (falls back to the trade's own average price).
    const m = await ctx.chain.launchpad.market(new PublicKey(t.mint)).catch(() => null);
    const price = m?.price ?? (tokens > 0n ? Number(sol) / 1e9 / (Number(tokens) / 1e6) : null);
    await db.query(`insert into trades (id, token_id, wallet, side, sol_lamports, pot_lamports, token_amount, price) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [randomUUID(), p.tokenId, p.wallet, p.side, sol.toString(), potEstimate.toString(), tokens.toString(), price]);
    if (price) await recordTick(db, p.tokenId, price, sol, p.side);
    if (m) await db.query(`update tokens set curve_progress=$2 where id=$1`, [p.tokenId, m.progress]);
    try {
      const ata = getAssociatedTokenAddressSync(new PublicKey(t.mint), new PublicKey(p.wallet));
      const bal = await ctx.chain.connection.getTokenAccountBalance(ata, "confirmed").then((r) => r.value.amount).catch(() => "0");
      await db.query(`insert into holders (token_id, wallet, balance) values ($1,$2,$3) on conflict (token_id, wallet) do update set balance=$3`, [p.tokenId, p.wallet, bal]);
    } catch { /* holder count is cosmetic */ }
    await emit(db, "TRADE", p.tokenId, null, { side: p.side, solLamports: sol.toString(), potLamports: potEstimate.toString(), wallet: p.wallet, ticker: t.ticker, tx: sig });
    return { tx: sig, explorer: ctx.chain.explorer(sig) };
  });
}
