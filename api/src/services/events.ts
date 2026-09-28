import { EventEmitter } from "node:events";
import type { FeedEvent, FeedEventType } from "@bountypad/shared";
import type { Db } from "../db";
import { mapEvent } from "../db/repo";

export const bus = new EventEmitter();
bus.setMaxListeners(1000);

/** Store a feed event and push it to every open SSE connection. */
export async function emit(db: Db, type: FeedEventType, tokenId: string | null, bountyId: string | null, data: Record<string, unknown> = {}) {
  const r = await db.query(`insert into events (type, token_id, bounty_id, data) values ($1,$2,$3,$4) returning *`, [
    type, tokenId, bountyId, JSON.stringify(data),
  ]);
  const ev: FeedEvent = mapEvent(r[0]);
  bus.emit("event", ev);
  return ev;
}
