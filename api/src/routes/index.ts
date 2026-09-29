import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { CHART_TIMEFRAMES, type ChartTimeframe, type Health, type Stats, type TokenChart, type TokenDetail, type TokenSummary, type ProfileDetail } from "@bountypad/shared";
import { MARKET_SQL, candles, mapMarket } from "../services/market";
import { ESCROW_PROGRAM_ID } from "../chain/escrow";
import { LAUNCHPAD } from "../chain/launchpad";
import type { Ctx } from "../app";
import { iso, str } from "../db";
import { mapBounty, mapDetection, mapEvent, mapPayout, mapProfile, mapRound, mapToken, mapTrade } from "../db/repo";
import { launch, resolveTarget, LaunchError } from "../services/launch";
import { verifyVoteSignature } from "../core/voting";
import { roundTally } from "../services/pipeline";
import { addSignature, cancelFrozen, freeze, linkWallet, optOut, unfreeze } from "../services/payouts";
import { isSolanaAddress } from "../core/solana";
import { bus } from "../services/events";
import { identify } from "../auth";
import { platformConnected } from "../services/xposter";

const SUMMARY_SQL = `
  select row_to_json(t) as t, row_to_json(b) as b, row_to_json(p) as p,
         (select count(*) from holders h where h.token_id=t.id and h.balance > 0)::int as holders,
         coalesce((select sum(sol_lamports) from trades tr where tr.token_id=t.id), 0)::text as volume,
         ${MARKET_SQL}
    from tokens t join bounties b on b.token_id=t.id join profiles p on p.x_user_id=b.target_x_user_id
   where not t.hidden`;

export async function routes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;
  const toSummary = (r: any): TokenSummary => ({
    token: mapToken(r.t), bounty: mapBounty(r.b), target: mapProfile(r.p), holders: r.holders, volumeLamports: str(r.volume),
    market: mapMarket(r, !ctx.chain),
  });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof LaunchError) return reply.status(err.status).send({ error: err.message });
    if (err instanceof z.ZodError) return reply.status(400).send({ error: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    app.log.error(err);
    return reply.status(err.statusCode ?? 500).send({ error: err.message ?? "server error" });
  });

  app.get("/api/health", async (): Promise<Health> => ({
    ok: true, sim: ctx.env.sim, xMode: ctx.env.xMode, chain: ctx.env.chain,
    cluster: ctx.chain?.cluster ?? null, escrowProgram: ctx.chain ? ESCROW_PROGRAM_ID.toBase58() : null,
    dbcConfig: ctx.chain ? ctx.env.solana.dbcConfig : null, devTools: ctx.env.devTools, solUsd: ctx.env.solUsd, privy: !!ctx.privy,
    xLogin: !!ctx.xOAuth, platformX: await platformConnected(ctx), videoChallenges: !!ctx.mockX || !!ctx.env.whisperUrl,
    feeSchedule: ctx.chain ? { startingFeeBps: LAUNCHPAD.startingFeeBps, endingFeeBps: LAUNCHPAD.endingFeeBps, decaySeconds: LAUNCHPAD.feeDecaySeconds } : null,
  }));

  app.get("/api/stats", async (): Promise<Stats> => {
    const r = (await db.query(`
      select count(*) filter (where status in ('OPEN','DETECTED_CONFIRMING','VOTING'))::int as live,
             coalesce(sum(pot_lamports) filter (where status not in ('PAID','EXPIRED','OPTED_OUT')),0)::text as locked,
             count(*) filter (where status='PAID')::int as npaid,
             (select coalesce(sum(amount_lamports),0) from payouts where status='SENT')::text as paid
        from bounties`))[0];
    return { liveCoins: r.live, lockedLamports: r.locked, paidLamports: r.paid, bountiesPaid: r.npaid };
  });

  app.get("/api/tokens", async (req): Promise<TokenSummary[]> => {
    // Real activity only. "trending" = most SOL traded in the last 24h (then pot): a coin that gets
    // hyped rises to the top by itself. Featured (the platform's own coin) is returned separately.
    const q = req.query as { sort?: string; featured?: string };
    if (q.featured) return (await db.query(`${SUMMARY_SQL} and t.featured order by t.created_at`)).map(toSummary);
    const sort = q.sort === "new" ? "t.created_at desc"
      : q.sort === "pot" ? "b.pot_lamports desc, t.created_at desc"
      : "vol24 desc, b.pot_lamports desc, t.created_at desc";
    const rows = await db.query(
      `select * from (${SUMMARY_SQL} and not t.featured) s,
         lateral (select coalesce(sum(sol_lamports),0) as vol24 from trades tr where tr.token_id=(s.t->>'id') and tr.created_at > now() - interval '24 hours') v
       order by ${sort.replace(/\bt\.created_at/g, "(s.t->>'created_at')::timestamptz").replace("b.pot_lamports", "(s.b->>'pot_lamports')::numeric")} limit 60`,
    );
    return rows.map(toSummary);
  });

  app.get("/api/tokens/:id", async (req, reply) => {
    const id = (req.params as any).id;
    const r = (await db.query(`${SUMMARY_SQL} and (t.id=$1 or t.mint=$1)`, [id]))[0];
    if (!r) return reply.status(404).send({ error: "not found" });
    const s = toSummary(r);
    const [dets, trades, round, payout, hist] = await Promise.all([
      db.query(`select * from detections where bounty_id=$1 order by detected_at desc`, [s.bounty.id]),
      db.query(`select * from trades where token_id=$1 order by created_at desc limit 30`, [s.token.id]),
      db.query(`select * from vote_rounds where bounty_id=$1 order by opens_at desc limit 1`, [s.bounty.id]),
      db.query(`select * from payouts where bounty_id=$1`, [s.bounty.id]),
      ctx.chain
        // On-chain: the pot grows when the keeper claims fees into the escrow.
        ? db.query(`select at as created_at, (sum(pot_lamports) over (order by at))::text as pot from fee_claims where token_id=$1 order by at`, [s.token.id])
        : db.query(`select created_at, (sum(pot_lamports) over (order by created_at))::text as pot from trades where token_id=$1 order by created_at`, [s.token.id]),
    ]);
    const step = Math.max(1, Math.ceil(hist.length / 120));
    const detail: TokenDetail = {
      ...s,
      detections: dets.map(mapDetection),
      trades: trades.map(mapTrade),
      vote: round[0] ? { round: mapRound(round[0]), tally: await roundTally(ctx, round[0]) } : null,
      payout: payout[0] ? mapPayout(payout[0]) : null,
      potHistory: hist.filter((_, i) => i % step === 0 || i === hist.length - 1).map((h: any) => ({ at: iso(h.created_at), potLamports: str(h.pot) })),
    };
    return detail;
  });

  // Candles for the coin page: every trade and pool sample, bucketed; plus the pot over time.
  app.get("/api/tokens/:id/chart", async (req, reply): Promise<TokenChart | void> => {
    const tf = z.enum(Object.keys(CHART_TIMEFRAMES) as [ChartTimeframe, ...ChartTimeframe[]]).default("5m").parse((req.query as any).tf);
    const t = (await db.query(`select id from tokens where id=$1 or mint=$1`, [(req.params as any).id]))[0];
    if (!t) return reply.status(404).send({ error: "not found" });
    const potRows = ctx.chain
      ? await db.query(`select extract(epoch from at)::bigint as ts, (sum(pot_lamports) over (order by at))::text as pot from fee_claims where token_id=$1 order by at`, [t.id])
      : await db.query(`select extract(epoch from created_at)::bigint as ts, (sum(pot_lamports) over (order by created_at, id))::text as pot from trades where token_id=$1 order by created_at, id`, [t.id]);
    // One point per second at most (the chart library needs strictly increasing times).
    const pot = new Map<number, number>();
    for (const r of potRows) pot.set(Number(r.ts), Number(r.pot) / 1e9);
    reply.header("Cache-Control", "no-store");
    return {
      timeframe: tf,
      candles: await candles(db, t.id, CHART_TIMEFRAMES[tf]),
      pot: [...pot].map(([time, value]) => ({ time, value })),
    };
  });

  app.post("/api/tokens", async (req) => launch(ctx, req.body));

  app.get("/api/x/lookup", async (req) => resolveTarget(ctx, String((req.query as any).handle ?? "")));

  app.get("/api/profiles/:handle", async (req, reply): Promise<ProfileDetail | void> => {
    const p = (await db.query(`select * from profiles where lower(username)=lower($1)`, [(req.params as any).handle]))[0];
    if (!p) return reply.status(404).send({ error: "not found" });
    const rows = (await db.query(`${SUMMARY_SQL} and b.target_x_user_id=$1 order by b.pot_lamports desc`, [p.x_user_id])).map(toSummary);
    const sum = (f: (s: TokenSummary) => boolean) => rows.filter(f).reduce((a, s) => a + BigInt(s.bounty.potLamports), 0n).toString();
    return {
      profile: mapProfile(p),
      bounties: rows,
      lockedLamports: sum((s) => !["PAID", "EXPIRED", "OPTED_OUT"].includes(s.bounty.status)),
      earnedLamports: sum((s) => s.bounty.status === "PAID"),
    };
  });

  app.get("/api/feed", async (req) => {
    const limit = Math.min(100, Number((req.query as any).limit ?? 40));
    const types = (req.query as any).all ? "" : `where type <> 'TRADE'`;
    return (await db.query(`select * from events ${types} order by id desc limit $1`, [limit])).map(mapEvent);
  });

  // Server-sent events: every feed event, live.
  app.get("/api/events", (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive",
      "Access-Control-Allow-Origin": ctx.env.webOrigin,
    });
    reply.raw.write(": connected\n\n");
    const onEv = (ev: unknown) => reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
    const ping = setInterval(() => reply.raw.write(": ping\n\n"), 15000);
    bus.on("event", onEv);
    req.raw.on("close", () => { bus.off("event", onEv); clearInterval(ping); });
  });

  app.get("/api/votes/:roundId", async (req, reply) => {
    const r = (await db.query(`select * from vote_rounds where id=$1`, [(req.params as any).roundId]))[0];
    if (!r) return reply.status(404).send({ error: "not found" });
    const d = (await db.query(`select * from detections where id=$1`, [r.detection_id]))[0];
    const s = toSummary((await db.query(`${SUMMARY_SQL} and b.id=$1`, [r.bounty_id]))[0]);
    // Optional ?wallet= tells the voter up front whether they can vote and what they chose.
    const w = (req.query as any).wallet as string | undefined;
    let me = null;
    if (w) {
      const inSnap = (r.snapshot ?? []).some((x: any) => x.wallet === w);
      const voted = (await db.query(`select choice from votes where round_id=$1 and wallet=$2`, [r.id, w]))[0]?.choice ?? null;
      me = {
        eligible: inSnap,
        voted,
        reason: inSnap ? null : w === s.token.creatorWallet ? "Creators can't vote on their own coin." : `This wallet didn't hold $${s.token.ticker} when the video was detected.`,
      };
    }
    return { round: mapRound(r), tally: await roundTally(ctx, r), detection: mapDetection(d), summary: s, voters: (r.snapshot ?? []).length, me };
  });

  app.post("/api/votes/:roundId", async (req, reply) => {
    const body = z.object({ wallet: z.string().refine(isSolanaAddress, "not a valid Solana address"), choice: z.enum(["YES", "NO"]), signature: z.string().max(120) }).parse(req.body);
    const roundId = (req.params as any).roundId;
    const r = (await db.query(`select * from vote_rounds where id=$1`, [roundId]))[0];
    if (!r || r.result !== "PENDING" || Date.parse(r.closes_at) < Date.now()) return reply.status(400).send({ error: "Vote is closed" });
    if (!(r.snapshot ?? []).some((s: any) => s.wallet === body.wallet)) {
      const creator = (await db.query(`select t.creator_wallet from bounties b join tokens t on t.id=b.token_id where b.id=$1`, [r.bounty_id]))[0]?.creator_wallet;
      return reply.status(403).send({ error: body.wallet === creator ? "Creators can't vote on their own coin." : "This wallet didn't hold the coin when the video was detected." });
    }
    if (!verifyVoteSignature(roundId, body.choice, body.wallet, body.signature)) return reply.status(400).send({ error: "Bad signature" });
    await db.query(`insert into votes (round_id, wallet, choice, signature) values ($1,$2,$3,$4) on conflict (round_id, wallet) do nothing`, [
      roundId, body.wallet, body.choice, body.signature,
    ]);
    return { tally: await roundTally(ctx, r) };
  });

  // ---- claim flow for public figures (X login) ----
  app.get("/api/me", async (req, reply) => {
    const me = await identify(ctx, req);
    if (!me) return reply.status(401).send({ error: "Not logged in" });
    const p = me.xUserId ? (await db.query(`select * from profiles where x_user_id=$1`, [me.xUserId]))[0] : null;
    return { via: me.via, wallets: me.wallets, profile: p ? mapProfile(p) : null };
  });

  app.get("/api/me/claims", async (req, reply) => {
    const me = await identify(ctx, req);
    if (!me) return reply.status(401).send({ error: "Log in first" });
    if (!me.xUserId) return reply.status(403).send({ error: "Link your X account to see coins that name you" });
    const xid = me.xUserId;
    const p = (await db.query(`select * from profiles where x_user_id=$1`, [xid]))[0];
    if (!p) return { profile: null, bounties: [] };
    const rows = (await db.query(`${SUMMARY_SQL} and b.target_x_user_id=$1 order by b.pot_lamports desc`, [xid])).map(toSummary);
    const payouts = (await db.query(`select p.* from payouts p join bounties b on b.id=p.bounty_id where b.target_x_user_id=$1`, [xid])).map(mapPayout);
    return { profile: mapProfile(p), bounties: rows, payouts };
  });

  app.post("/api/me/wallet", async (req, reply) => {
    const me = await identify(ctx, req);
    if (!me?.xUserId) return reply.status(401).send({ error: "Log in with X" });
    const xid = me.xUserId;
    const { wallet } = z.object({ wallet: z.string().min(32).max(44) }).parse(req.body);
    await linkWallet(ctx, xid, wallet);
    return { ok: true };
  });

  app.post("/api/me/opt-out", async (req, reply) => {
    const me = await identify(ctx, req);
    if (!me?.xUserId) return reply.status(401).send({ error: "Log in with X" });
    const xid = me.xUserId;
    await optOut(ctx, xid);
    return { ok: true };
  });

  // ---- verifier + admin ----
  app.post("/api/payouts/:id/signatures", async (req) => {
    const b = z.object({ signer: z.string(), signature: z.string() }).parse(req.body);
    await addSignature(ctx, (req.params as any).id, b.signer, b.signature);
    return { ok: true };
  });

  for (const [action, fn] of [["freeze", freeze], ["unfreeze", unfreeze], ["cancel", cancelFrozen]] as const) {
    app.post(`/api/admin/payouts/:id/${action}`, async (req, reply) => {
      if (!ctx.env.adminKey || req.headers["x-admin-key"] !== ctx.env.adminKey) return reply.status(401).send({ error: "admin only" });
      await fn(ctx, (req.params as any).id);
      return { ok: true };
    });
  }

  // Listing moderation: feature the platform's own coin; hide test or abusive coins from every list.
  for (const [action, sql] of [
    ["feature", "featured=true"], ["unfeature", "featured=false"], ["hide", "hidden=true"], ["unhide", "hidden=false"],
  ] as const) {
    app.post(`/api/admin/tokens/:id/${action}`, async (req, reply) => {
      if (!ctx.env.adminKey || req.headers["x-admin-key"] !== ctx.env.adminKey) return reply.status(401).send({ error: "admin only" });
      const r = await db.query(`update tokens set ${sql} where id=$1 or mint=$1 or upper(ticker)=upper($1) returning id, ticker, featured, hidden`, [(req.params as any).id]);
      if (!r.length) return reply.status(404).send({ error: "coin not found" });
      return r;
    });
  }

  app.get("/api/bounties/:id/audit", async (req) => {
    return (await db.query(`select * from audit_log where bounty_id=$1 order by id`, [(req.params as any).id])).map((r: any) => ({
      from: r.from_status, to: r.to_status, reason: r.reason, postId: r.post_id, at: iso(r.at),
    }));
  });
}
