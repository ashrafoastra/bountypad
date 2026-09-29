// Market data behind the coin charts: the sim bonding curve, trade/price recording and candles.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createDb } from "../src/db";
import { env } from "../src/env";
import type { Ctx } from "../src/app";
import { MockX } from "../src/sim/mockX";
import { DbHolders, SimPayouts, SimVideo } from "../src/adapters";
import { launch } from "../src/services/launch";
import { SIM_CREATOR, simTrade } from "../src/sim/sim";
import { SIM_CURVE, TOTAL_SUPPLY, candles, mapMarket, simBuy, simPrice, simSell, MARKET_SQL } from "../src/services/market";

vi.spyOn(console, "log").mockImplementation(() => {});

let ctx: Ctx;
beforeEach(async () => {
  const db = await createDb("", { memory: true });
  const x = new MockX();
  ctx = { db, x, mockX: x, video: new SimVideo(x), holders: new DbHolders(db), payouts: new SimPayouts(), privy: null, chain: null, xOAuth: null, env: { ...env, sim: true } };
});

const coin = () => launch(ctx, { name: "Chart", ticker: "CHART", imageUrl: "https://example.com/c.png", creatorWallet: SIM_CREATOR, targetHandle: "novareyes", action: "TWEET_CASHTAG" });
const market = async (id: string) => mapMarket((await ctx.db.query(`select ${MARKET_SQL} from tokens t where t.id=$1`, [id]))[0], true);

describe("sim bonding curve", () => {
  it("price rises on buys and a round trip returns the same SOL", () => {
    const p0 = simPrice(0);
    expect(p0).toBeCloseTo(SIM_CURVE.virtualSol / SIM_CURVE.virtualTokens, 15);
    const got = simBuy(0, 5);
    expect(simPrice(5)).toBeGreaterThan(p0);
    const back = simSell(5, 5);
    expect(back.tokens).toBeCloseTo(got, 3); // selling the same SOL needs exactly the tokens bought
  });

  it("can't take out more SOL than went in", () => {
    expect(simSell(2, 10).sol).toBe(2);
    expect(simSell(0, 1).sol).toBe(0);
  });
});

describe("price recording", () => {
  it("a new coin has a launch price and a 0% change", async () => {
    const { id } = await coin();
    const m = await market(id);
    expect(m.priceSol).toBeCloseTo(simPrice(0), 15);
    expect(m.marketCapSol).toBeCloseTo(simPrice(0) * TOTAL_SUPPLY, 6);
    expect(m.change24h).toBe(0);
    expect(m.curveProgress).toBe(0);
  });

  it("trades store price + token amount, move holders and build candles", async () => {
    const { id } = await coin();
    await simTrade(ctx, id, { side: "BUY", sol: 3, walletIdx: 1, quiet: true });
    await simTrade(ctx, id, { side: "BUY", sol: 2, walletIdx: 2, quiet: true });
    const sell = await simTrade(ctx, id, { side: "SELL", sol: 1, walletIdx: 1, quiet: true });
    expect(sell.side).toBe("SELL");

    const trades = await ctx.db.query(`select side, price, token_amount::text as amt from trades where token_id=$1 order by created_at, id`, [id]);
    expect(trades).toHaveLength(3);
    expect(trades.every((t: any) => t.price > 0 && BigInt(t.amt) > 0n)).toBe(true);
    expect(trades[1].price).toBeGreaterThan(trades[0].price);
    expect(trades[2].price).toBeLessThan(trades[1].price);

    const h = await ctx.db.query(`select wallet, balance::text as b from holders where token_id=$1`, [id]);
    expect(h.length).toBe(2);
    expect(h.every((x: any) => BigInt(x.b.split(".")[0]) > 0n)).toBe(true);

    const m = await market(id);
    expect(m.priceSol).toBeCloseTo(simPrice(4), 12);
    expect(m.change24h!).toBeGreaterThan(0);
    expect(m.curveProgress).toBeCloseTo(4 / SIM_CURVE.graduationSol, 6);
    expect(Number(m.volume24hLamports)).toBe(6e9);

    const c = await candles(ctx.db, id, 60);
    expect(c.length).toBeGreaterThanOrEqual(1);
    const last = c[c.length - 1];
    expect(last.close).toBeCloseTo(simPrice(4), 12);
    expect(last.high).toBeGreaterThanOrEqual(Math.max(last.open, last.close));
    expect(last.low).toBeLessThanOrEqual(Math.min(last.open, last.close));
    expect(c.reduce((a, x) => a + x.volume, 0)).toBeCloseTo(6, 9);
  });

  it("a wallet can never sell more than it holds", async () => {
    const { id } = await coin();
    const bought = await simTrade(ctx, id, { side: "BUY", sol: 1, walletIdx: 3, quiet: true });
    await simTrade(ctx, id, { side: "BUY", sol: 5, walletIdx: 4, quiet: true });
    const s = await simTrade(ctx, id, { side: "SELL", sol: 4, walletIdx: 3, quiet: true });
    expect(s.tokens).toBeLessThanOrEqual(bought.tokens); // capped by its position (worth more now: the price rose)
    expect(Number(s.lamports) / 1e9).toBeLessThan(4);
    const b = (await ctx.db.query(`select balance::text as b from holders where token_id=$1 and wallet=$2`, [id, (await ctx.db.query(`select wallet from trades where token_id=$1 and side='SELL'`, [id]))[0].wallet]))[0].b;
    expect(Number(b)).toBeGreaterThanOrEqual(0);
    expect(Number(b)).toBeLessThan(1e6); // under one whole token left
  });

  it("candles open at the previous close", async () => {
    const { id } = await coin();
    await ctx.db.query(`insert into price_ticks (token_id, at, price) select $1, date_trunc('minute', now()) - interval '5 minutes' + s, p from (values (interval '5 seconds', 1.0), (interval '65 seconds', 2.0), (interval '70 seconds', 1.5)) v(s, p)`, [id]);
    const c = (await candles(ctx.db, id, 60)).filter((x) => x.close !== simPrice(0));
    const i = c.findIndex((x) => x.close === 1.5);
    expect(i).toBeGreaterThan(0);
    expect(c[i].open).toBe(c[i - 1].close);
    expect(c[i].high).toBe(2);
  });
});
