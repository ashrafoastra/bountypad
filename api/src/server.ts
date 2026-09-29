import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./env";
import { createDb } from "./db";
import type { Ctx } from "./app";
import { RealX } from "./x/real";
import { MockX } from "./sim/mockX";
import { DbHolders, OnchainHolders, SimPayouts, SimVideo, WhisperVideo } from "./adapters";
import { routes } from "./routes";
import { chainRoutes } from "./routes/chain";
import { uploadRoutes } from "./routes/uploads";
import { devRoutes } from "./routes/dev";
import { startJobs } from "./jobs";
import { seed } from "./sim/sim";
import { PrivyGateway } from "./privy";
import { SolanaChain } from "./chain/service";
import { XOAuth } from "./x/oauth";
import { authRoutes } from "./routes/auth";

async function main() {
  const db = await createDb(env.databaseUrl);
  const mockX = env.xMode === "mock" ? new MockX() : null;
  const chain = env.chain === "solana" ? new SolanaChain(env) : null;
  const ctx: Ctx = {
    db,
    x: mockX ?? new RealX(env.xBearer, env.xFieldStyle, undefined, env.xConsumer),
    video: mockX ? new SimVideo(mockX) : new WhisperVideo(env.whisperUrl, env.whisperKey),
    holders: chain ? new OnchainHolders(db, chain) : new DbHolders(db),
    payouts: new SimPayouts(),
    env,
    mockX,
    privy: env.privyAppId && env.privyAppSecret ? new PrivyGateway(env.privyAppId, env.privyAppSecret) : null,
    chain,
    // X_OAUTH_TEST_BASE: point login at a local fake X (integration tests only).
    xOAuth: env.xOAuth ? new XOAuth(env.xOAuth, process.env.X_OAUTH_TEST_BASE, process.env.X_OAUTH_TEST_BASE) : null,
  };

  if (mockX) {
    // The simulated X lives in memory, so a restart must start from a clean database too.
    await db.query(`truncate table votes, vote_rounds, detections, payouts, audit_log, events, trades, holders, fee_claims, burns, pending_launches, bounties, tokens, profiles restart identity cascade`);
    if (!chain && env.simSeed) await seed(ctx);
  }
  if (chain) {
    const cfg = await chain.escrow.config().catch(() => null);
    if (!cfg) throw new Error(`Escrow program not initialized on ${env.solana.cluster} (${env.solana.rpcUrl}). Run: npm run chain:setup -w api`);
    // Every launch is checked on-chain against the escrow's launchpad config: they must match.
    if ((cfg as any).dbcConfig?.toBase58?.() !== env.solana.dbcConfig)
      console.warn(`  ✗ DBC_CONFIG in api/.env (${env.solana.dbcConfig}) is not the launchpad the escrow accepts (${(cfg as any).dbcConfig?.toBase58?.()}). Launches will fail with WrongLaunchpad: fix DBC_CONFIG.`);
    const bal = await chain.balance(chain.keeper.publicKey);
    console.log(`Solana ${chain.cluster}: escrow ${cfg ? "ready" : "missing"}, keeper ${chain.keeper.publicKey.toBase58()} (${Number(bal) / 1e9} SOL)`);
    if (bal < 50_000_000n) console.warn("  Keeper balance is low: fund it so it can pay for claims, verifications and payouts.");
  }

  if (ctx.x instanceof RealX && !env.xBearer) {
    await ctx.x.authCheck().then(
      () => console.log("X: app-only token obtained from the API Key/Secret"),
      (e) => console.warn(`X: ${(e as Error).message}\n   Target lookups and detection will fail until this is fixed.`),
    );
  }

  const app = Fastify({ logger: { level: "warn" } });
  await app.register(cors, { origin: env.webOrigin, credentials: true });
  await routes(app, ctx);
  await chainRoutes(app, ctx);
  await uploadRoutes(app, ctx);
  await authRoutes(app, ctx);
  if (env.devTools) await devRoutes(app, ctx);
  startJobs(ctx);

  await app.listen({ port: env.port, host: "0.0.0.0" });
  const parts = [`X: ${env.xMode === "real" ? "REAL (X API)" : "simulated"}`, `chain: ${chain ? `Solana ${chain.cluster}` : "simulated"}`];
  console.log(`Bounty Pad API on :${env.port} (${parts.join(", ")})${env.devTools ? " [dev tools on]" : ""}`);
  console.log(ctx.xOAuth ? `X login: on (callback ${ctx.xOAuth.callbackUrl}, must be listed in your X app)` : "X login: off (set X_CLIENT_ID + X_CLIENT_SECRET)");
  if (env.privyPregenerate) console.warn("  PRIVY_PREGENERATE=true: X login no longer goes through Privy, so targets can't open those wallets. Keep it false (docs/decisions.md).");
  console.log(ctx.privy ? `Privy: on (app ${env.privyAppId})${env.privyPregenerate ? ", wallet pregeneration on" : ""}` : "Privy: off (dev login only)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
