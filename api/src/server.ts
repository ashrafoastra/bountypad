import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./env";
import { createDb } from "./db";
import type { Ctx } from "./app";
import { RealX } from "./x/real";
import { MockX } from "./sim/mockX";
import { DbHolders, OnchainPayouts, SimPayouts, SimVideo, WhisperVideo } from "./adapters";
import { routes } from "./routes";
import { devRoutes } from "./routes/dev";
import { startJobs } from "./jobs";
import { seed } from "./sim/sim";

async function main() {
  const db = await createDb(env.databaseUrl);
  const mockX = env.sim ? new MockX() : null;
  const ctx: Ctx = {
    db,
    x: mockX ?? new RealX(env.xBearer, env.xFieldStyle),
    video: mockX ? new SimVideo(mockX) : new WhisperVideo(env.whisperUrl, env.whisperKey),
    holders: new DbHolders(db),
    payouts: env.sim ? new SimPayouts() : new OnchainPayouts(),
    env,
    mockX,
  };

  if (env.sim) {
    // Mock X lives in memory, so a restarted sim starts from a clean database too.
    await db.query(`truncate table votes, vote_rounds, detections, payouts, audit_log, events, trades, holders, bounties, tokens, profiles restart identity cascade`);
    await seed(ctx);
  }

  const app = Fastify({ logger: { level: "warn" } });
  await app.register(cors, { origin: env.webOrigin });
  await routes(app, ctx);
  if (env.sim) await devRoutes(app, ctx);
  startJobs(ctx);

  await app.listen({ port: env.port, host: "0.0.0.0" });
  console.log(`Bounty Pad API on :${env.port} ${env.sim ? "(SIM MODE: mock X, simulated trades, fake payouts)" : "(REAL MODE)"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
