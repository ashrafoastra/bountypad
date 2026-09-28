import type { Ctx } from "../app";
import { watch, rechecks, closeVotes, expire } from "../services/pipeline";
import { releaseDue } from "../services/payouts";
import { simTradeTick } from "../sim/sim";

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
  if (ctx.env.sim) timers.push(every("sim-trades", t.tradeSimEverySec, () => simTradeTick(ctx)));
  return () => timers.forEach(clearInterval);
}
