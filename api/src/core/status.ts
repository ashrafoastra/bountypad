import type { BountyStatus } from "@bountypad/shared";

/** Allowed bounty transitions (CLAUDE.md §6.8). Anything else is a bug and throws. */
const ALLOWED: Record<BountyStatus, BountyStatus[]> = {
  OPEN: ["DETECTED_CONFIRMING", "EXPIRED", "OPTED_OUT"],
  DETECTED_CONFIRMING: ["VERIFIED", "VOTING", "OPEN", "OPTED_OUT"],
  VOTING: ["VERIFIED", "OPEN", "OPTED_OUT"],
  VERIFIED: ["CHALLENGE_WINDOW"],
  CHALLENGE_WINDOW: ["PAID", "FROZEN"],
  FROZEN: ["CHALLENGE_WINDOW", "OPEN"],
  PAID: [],
  EXPIRED: [],
  OPTED_OUT: [],
};

export function canTransition(from: BountyStatus, to: BountyStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function assertTransition(from: BountyStatus, to: BountyStatus): void {
  if (!canTransition(from, to)) throw new Error(`Illegal bounty transition ${from} -> ${to}`);
}

/** Statuses where the watcher should look for new posts. */
export const WATCHED: BountyStatus[] = ["OPEN"];
