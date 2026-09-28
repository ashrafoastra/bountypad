import type { Db } from "./db";
import type { XProvider } from "./x/types";
import type { HolderSource, PayoutExecutor, VideoPipeline } from "./adapters";
import type { MockX } from "./sim/mockX";
import { env } from "./env";

export interface Ctx {
  db: Db;
  x: XProvider;
  video: VideoPipeline;
  holders: HolderSource;
  payouts: PayoutExecutor;
  env: typeof env;
  /** Present only in SIM mode. */
  mockX: MockX | null;
}

export const secondsFromNow = (s: number) => new Date(Date.now() + s * 1000).toISOString();
