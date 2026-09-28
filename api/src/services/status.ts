import type { BountyStatus } from "@bountypad/shared";
import type { Db } from "../db";
import { assertTransition } from "../core/status";

/** The ONLY way to change a bounty's status: checks the transition and writes the audit log. */
export async function setStatus(db: Db, bountyId: string, to: BountyStatus, reason: string, postId: string | null = null) {
  const cur = (await db.query(`select status from bounties where id=$1`, [bountyId]))[0];
  if (!cur) throw new Error(`bounty ${bountyId} not found`);
  assertTransition(cur.status, to);
  await db.query(`update bounties set status=$2, updated_at=now() where id=$1`, [bountyId, to]);
  await db.query(`insert into audit_log (bounty_id, from_status, to_status, reason, post_id) values ($1,$2,$3,$4,$5)`, [
    bountyId, cur.status, to, reason, postId,
  ]);
}
