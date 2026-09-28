import type { BountyStatus } from "@bountypad/shared";
import type { Q } from "../db";
import { assertTransition } from "../core/status";

/**
 * The ONLY way to change a bounty's status: checks the transition and writes the audit log.
 * The update is conditional on the status we read, so two jobs can never both move the same
 * bounty (the loser throws and its transaction rolls back).
 */
export async function setStatus(q: Q, bountyId: string, to: BountyStatus, reason: string, postId: string | null = null) {
  const cur = (await q.query(`select status from bounties where id=$1`, [bountyId]))[0];
  if (!cur) throw new Error(`bounty ${bountyId} not found`);
  assertTransition(cur.status, to);
  const moved = await q.query(`update bounties set status=$2, updated_at=now() where id=$1 and status=$3 returning id`, [bountyId, to, cur.status]);
  if (!moved.length) throw new Error(`bounty ${bountyId} changed status concurrently`);
  await q.query(`insert into audit_log (bounty_id, from_status, to_status, reason, post_id) values ($1,$2,$3,$4,$5)`, [
    bountyId, cur.status, to, reason, postId,
  ]);
}

/** Current status, for jobs that must re-check before acting. */
export async function statusOf(q: Q, bountyId: string): Promise<BountyStatus | null> {
  return (await q.query(`select status from bounties where id=$1`, [bountyId]))[0]?.status ?? null;
}
