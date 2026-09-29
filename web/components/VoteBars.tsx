"use client";
import { motion } from "motion/react";

/** Yes/No split (60% line) and turnout (10% quorum line). Neutral until the first vote. */
export function VoteBars({ yes, turnout }: { yes: number; turnout: number }) {
  const none = turnout === 0;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex justify-between text-sm mb-2">
          {none ? <span className="text-mute">No votes yet</span> : <><span className="text-green">Yes {yes}%</span><span className="text-red">No {Math.round((100 - yes) * 100) / 100}%</span></>}
        </div>
        <div className={`h-2 overflow-hidden relative ${none ? "bg-panel-3" : "bg-red/30"}`}>
          <motion.div className="h-full bg-green" animate={{ width: `${none ? 0 : yes}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
          <div className="absolute inset-y-0 w-px bg-ink" style={{ left: "60%" }} />
        </div>
        <div className="text-xs text-dim mt-1.5">Needs 60% yes</div>
      </div>
      <div>
        <div className="flex justify-between text-sm mb-2"><span className="text-mute">Turnout</span><span className="num">{turnout}%</span></div>
        <div className="h-2 bg-panel-3 overflow-hidden relative">
          <motion.div className="h-full bg-xblue" animate={{ width: `${Math.min(100, turnout)}%` }} />
          <div className="absolute inset-y-0 w-px bg-ink" style={{ left: "10%" }} />
        </div>
        <div className="text-xs text-dim mt-1.5">Needs 10% of holders</div>
      </div>
    </div>
  );
}
