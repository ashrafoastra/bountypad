import type { Ctx } from "../app";
import { watch, rechecks, closeVotes, expire } from "../services/pipeline";
import { releaseDue } from "../services/payouts";
import { simTradeTick } from "../sim/sim";
import { samplePools } from "../services/market";
import { claimFees, syncBounties } from "../services/onchain";
import { reconcileLaunches } from "../services/launch";

/** Single-process scheduler. Each job never overlaps with itself. */
function every(name: string, sec: number, fn: () => Promise<void>) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await fn(); } catch (e) { console.error(`[job:${name}]`, (e as Error).message); } finally { busy = false; }
  };
  return setInterval(tick, sec * 1000);
}

export function startJobs(ctx: Ctx) {
  const t = ctx.env.timing;
  const timers = [
    every("watch", t.watchEverySec, () => watch(ctx)),
    every("recheck", Math.min(10, t.watchEverySec * 2), () => rechecks(ctx)),
    every("votes", 5, () => closeVotes(ctx)),
    every("payouts", 5, () => releaseDue(ctx)),
    every("expire", 60, () => expire(ctx)),
  ];
  if (ctx.chain) {
    const s = ctx.env.solana;
    timers.push(
      every("launches", 15, () => reconcileLaunches(ctx)),
      every("keeper-fees", s.keeperEverySec, () => claimFees(ctx)),
      every("chain-sync", s.syncEverySec, () => syncBounties(ctx)),
      every("market", s.marketEverySec, () => samplePools(ctx)),
    );
  } else if (ctx.env.sim && ctx.env.simSeed) {
    timers.push(every("sim-trades", t.tradeSimEverySec, () => simTradeTick(ctx)));
  }
  return () => timers.forEach(clearInterval);
}
