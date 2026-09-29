import type { Candle } from "@bountypad/shared";
import type { Q } from "../db";
import type { Ctx } from "../app";
import { PublicKey } from "@solana/web3.js";
import { randomUUID } from "node:crypto";
import { splitTradeFee } from "@bountypad/shared";
import { emit } from "./events";

/**
 * Market data for charts and token stats.
 * price = SOL per whole token (tokens have 6 decimals, total supply 1,000,000,000).
 */
export const TOTAL_SUPPLY = 1_000_000_000;
export const TOKEN_DECIMALS = 6;

/**
 * SIM chain only: a constant-product bonding curve with virtual reserves (the pump.fun shape),
 * so simulated trades move a believable price. Real coins use Meteora's curve on-chain.
 */
export const SIM_CURVE = { virtualSol: 30, virtualTokens: 1_073_000_000, graduationSol: 85 };
const K = SIM_CURVE.virtualSol * SIM_CURVE.virtualTokens;

export function simPrice(netSol: number) {
  const v = SIM_CURVE.virtualSol + Math.max(0, netSol);
  return (v * v) / K;
}
/** Tokens received for `sol` SOL at the current net SOL in the curve. */
export function simBuy(netSol: number, sol: number) {
  const v = SIM_CURVE.virtualSol + Math.max(0, netSol);
  return K / v - K / (v + sol);
}
/** Tokens needed to take `sol` SOL out of the curve. */
export function simSell(netSol: number, sol: number) {
  const v = SIM_CURVE.virtualSol + Math.max(0, netSol);
  const out = Math.min(sol, Math.max(0, netSol));
  return { sol: out, tokens: K / (v - out) - K / v };
}

export async function simNetSol(q: Q, tokenId: string) {
  const r = (await q.query(
    `select coalesce(sum(case when side='BUY' then sol_lamports else -sol_lamports end), 0)::text as n from trades where token_id=$1`,
    [tokenId],
  ))[0];
  return Number(r.n) / 1e9;
}

export async function recordTick(q: Q, tokenId: string, price: number, volumeLamports = 0n, side: string | null = null) {
  if (!Number.isFinite(price) || price <= 0) return;
  await q.query(`insert into price_ticks (token_id, price, volume_lamports, side) values ($1,$2,$3,$4)`, [tokenId, price, volumeLamports.toString(), side]);
}

/** Only record a pool sample when the price actually moved (keeps the table small). */
export async function recordSample(q: Q, tokenId: string, price: number) {
  const last = (await q.query(`select price from price_ticks where token_id=$1 order by at desc, id desc limit 1`, [tokenId]))[0];
  if (last && Math.abs(last.price - price) / last.price < 1e-9) return false;
  await recordTick(q, tokenId, price);
  return true;
}

/** OHLC + volume (SOL) in buckets of `tfSec`. Each candle opens at the previous close, like exchanges do. */
export async function candles(q: Q, tokenId: string, tfSec: number): Promise<Candle[]> {
  const rows = await q.query(
    `select (floor(extract(epoch from at) / $2) * $2)::bigint as t,
            (array_agg(price order by at, id))[1] as o, max(price) as h, min(price) as l,
            (array_agg(price order by at desc, id desc))[1] as c, coalesce(sum(volume_lamports), 0)::text as v
       from price_ticks where token_id=$1 group by 1 order by 1`,
    [tokenId, tfSec],
  );
  const out: Candle[] = [];
  let prevClose: number | null = null;
  for (const r of rows) {
    const open = prevClose ?? Number(r.o);
    const high = Math.max(Number(r.h), open), low = Math.min(Number(r.l), open);
    out.push({ time: Number(r.t), open, high, low, close: Number(r.c), volume: Number(r.v) / 1e9 });
    prevClose = Number(r.c);
  }
  return out;
}

/** Per-token market stats, computed in SQL for a list view. */
export const MARKET_SQL = `
  (select price from price_ticks pt where pt.token_id=t.id order by at desc, id desc limit 1) as price,
  (select price from price_ticks pt where pt.token_id=t.id and at <= now() - interval '24 hours' order by at desc, id desc limit 1) as price_24h,
  (select price from price_ticks pt where pt.token_id=t.id order by at, id limit 1) as price_first,
  (select coalesce(sum(volume_lamports), 0) from price_ticks pt where pt.token_id=t.id and at > now() - interval '24 hours')::text as volume_24h,
  t.curve_progress as curve_progress,
  (select coalesce(sum(case when side='BUY' then sol_lamports else -sol_lamports end), 0) from trades tr where tr.token_id=t.id)::text as net_sol`;

export function mapMarket(r: any, sim: boolean) {
  const price = r.price === null || r.price === undefined ? null : Number(r.price);
  // No trade older than 24h yet: compare with the launch price.
  const ref = r.price_24h ?? r.price_first;
  const change24h = price !== null && ref ? ((price - Number(ref)) / Number(ref)) * 100 : null;
  const curveProgress = sim ? Math.min(1, Math.max(0, Number(r.net_sol) / 1e9 / SIM_CURVE.graduationSol)) : r.curve_progress ?? null;
  return {
    priceSol: price,
    marketCapSol: price !== null ? price * TOTAL_SUPPLY : null,
    change24h,
    volume24hLamports: String(r.volume_24h ?? "0"),
    curveProgress: curveProgress === null ? null : Number(curveProgress),
  };
}

/** Price right after launch: the start of every chart. */
export async function recordLaunchPrice(ctx: Ctx, tokenId: string, mint: string) {
  if (!ctx.chain) return recordTick(ctx.db, tokenId, simPrice(0));
  const m = await ctx.chain.launchpad.market(new PublicKey(mint)).catch(() => null);
  if (m) {
    await recordTick(ctx.db, tokenId, m.price);
    await ctx.db.query(`update tokens set curve_progress=$2 where id=$1`, [tokenId, m.progress]);
  }
}

/**
 * Job (on-chain): sample every pool still on the bonding curve. Trades made outside our site
 * (Jupiter, bots, other frontends) move the pool too; this keeps charts and stats true to the chain.
 */
export async function samplePools(ctx: Ctx) {
  if (!ctx.chain) return;
  const rows = await ctx.db.query(`select id, mint from tokens where pool is not null and coalesce(curve_progress, 0) < 1`);
  for (const t of rows) {
    try {
      const m = await ctx.chain.launchpad.market(new PublicKey(t.mint));
      if (!m) continue;
      await recordSample(ctx.db, t.id, m.price);
      await ctx.db.query(`update tokens set curve_progress=$2 where id=$1`, [t.id, m.progress]);
    } catch (e) {
      console.log(new Date().toISOString(), "[market] sample", t.mint, (e as Error).message);
    }
  }
}

/**
 * Job (on-chain): index every swap on our pools, wherever it was made (our site, Jupiter, Axiom,
 * bots). Reads the pool's new transactions and the change of its two vaults:
 *   SOL vault up + token vault down = BUY, the reverse = SELL. The trader is the wallet whose
 * coin balance moved the other way. Feeds volume, holders, trades, the chart and the feed.
 */
export async function indexPoolTrades(ctx: Ctx) {
  const chain = ctx.chain;
  if (!chain) return;
  const rows = await ctx.db.query(`select id, mint, ticker, pool, last_indexed_sig from tokens where pool is not null and coalesce(curve_progress, 0) < 1`);
  for (const t of rows) {
    try {
      const pool = await chain.launchpad.pool(new PublicKey(t.mint));
      if (!pool) continue;
      const baseVault = pool.state.poolState.baseVault.toBase58();
      const quoteVault = pool.state.poolState.quoteVault.toBase58();
      const sigs = await chain.connection.getSignaturesForAddress(new PublicKey(t.pool), t.last_indexed_sig ? { until: t.last_indexed_sig, limit: 100 } : { limit: 100 }, "confirmed");
      if (!sigs.length) continue;
      const m = await chain.launchpad.market(new PublicKey(t.mint)).catch(() => null);
      for (const s of [...sigs].reverse()) {
        if (s.err) continue;
        const tx = await chain.connection.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
        if (!tx?.meta) continue;
        const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses }).keySegments().flat().map((k) => k.toBase58());
        const bal = (list: typeof tx.meta.preTokenBalances, i: number) => list?.find((b) => b.accountIndex === i);
        const bi = keys.indexOf(baseVault), qi = keys.indexOf(quoteVault);
        if (bi < 0 || qi < 0) continue;
        const preB = bal(tx.meta.preTokenBalances, bi), postB = bal(tx.meta.postTokenBalances, bi);
        const preQ = bal(tx.meta.preTokenBalances, qi), postQ = bal(tx.meta.postTokenBalances, qi);
        if (!preB || !postB || !preQ || !postQ) continue; // pool creation: the first buy is recorded at launch
        const dBase = BigInt(postB.uiTokenAmount.amount) - BigInt(preB.uiTokenAmount.amount);
        const dQuote = BigInt(postQ.uiTokenAmount.amount) - BigInt(preQ.uiTokenAmount.amount);
        const side = dQuote > 0n && dBase < 0n ? "BUY" : dQuote < 0n && dBase > 0n ? "SELL" : null;
        if (!side) continue; // fee claims, migrations…
        const sol = side === "BUY" ? dQuote : -dQuote;
        const tokens = side === "BUY" ? -dBase : dBase;
        // The trader: the non-pool account whose coin balance moved opposite to the vault.
        const moved = (tx.meta.postTokenBalances ?? []).filter((b) => b.mint === t.mint && b.accountIndex !== bi).map((b) => {
          const pre = BigInt(tx.meta!.preTokenBalances?.find((p) => p.accountIndex === b.accountIndex)?.uiTokenAmount.amount ?? "0");
          return { owner: b.owner ?? keys[0], balance: BigInt(b.uiTokenAmount.amount), delta: BigInt(b.uiTokenAmount.amount) - pre };
        });
        const trader = moved.find((x) => (side === "BUY" ? x.delta > 0n : x.delta < 0n)) ?? { owner: keys[0], balance: null as bigint | null, delta: 0n };
        const price = tokens > 0n ? Number(sol) / 1e9 / (Number(tokens) / 10 ** TOKEN_DECIMALS) : null;
        const pot = splitTradeFee(sol).pot;
        const ins = await ctx.db.query(
          `insert into trades (id, token_id, wallet, side, sol_lamports, pot_lamports, token_amount, price, tx_sig, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9, to_timestamp($10)) on conflict do nothing returning id`,
          [randomUUID(), t.id, trader.owner, side, sol.toString(), pot.toString(), tokens.toString(), price, s.signature, s.blockTime ?? Date.now() / 1000],
        );
        if (trader.balance !== null) {
          await ctx.db.query(`insert into holders (token_id, wallet, balance) values ($1,$2,$3) on conflict (token_id, wallet) do update set balance=$3`, [t.id, trader.owner, trader.balance.toString()]);
        }
        if (!ins.length) continue; // already recorded by our own trade route
        // Chart: the pool price now (execution prices include the launch fee and would spike the candles).
        if (m?.price) await ctx.db.query(`insert into price_ticks (token_id, at, price, volume_lamports, side) values ($1, to_timestamp($2), $3, $4, $5)`, [t.id, s.blockTime ?? Date.now() / 1000, m.price, sol.toString(), side]);
        await emit(ctx.db, "TRADE", t.id, null, { side, solLamports: sol.toString(), potLamports: pot.toString(), wallet: trader.owner, ticker: t.ticker, tx: s.signature });
      }
      await ctx.db.query(`update tokens set last_indexed_sig=$2 where id=$1`, [t.id, sigs[0].signature]);
    } catch (e) {
      console.log(new Date().toISOString(), "[market] index", t.mint, (e as Error).message.slice(0, 200));
    }
  }
}

/** Live SOL/USD for the dollar figures on the site (falls back to SOL_USD). Refreshed every few minutes. */
let solUsdLive: { v: number; at: number } | null = null;
export function solUsd(fallback: number) { return solUsdLive?.v ?? fallback; }
export async function refreshSolUsd() {
  const sources: [string, (j: any) => number][] = [
    ["https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", (j) => Number(j?.solana?.usd)],
    ["https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112", (j) => Number(j?.So11111111111111111111111111111111111111112?.usdPrice)],
  ];
  for (const [url, pick] of sources) {
    try {
      const v = pick(await (await fetch(url, { signal: AbortSignal.timeout(5000) })).json());
      if (Number.isFinite(v) && v > 1) { solUsdLive = { v, at: Date.now() }; return; }
    } catch { /* next source */ }
  }
}
