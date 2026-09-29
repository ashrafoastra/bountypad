import type { Db } from "./db";
import type { XProvider } from "./x/types";
import type { HolderSource, PayoutExecutor, VideoPipeline } from "./adapters";
import type { MockX } from "./sim/mockX";
import type { PrivyGateway } from "./privy";
import type { SolanaChain } from "./chain/service";
import { env } from "./env";
import type { XOAuth } from "./x/oauth";

export interface Ctx {
  db: Db;
  x: XProvider;
  video: VideoPipeline;
  holders: HolderSource;
  payouts: PayoutExecutor;
  env: typeof env;
  /** Present only in SIM mode. */
  mockX: MockX | null;
  /** Present when PRIVY_APP_ID + PRIVY_APP_SECRET are set. */
  privy: PrivyGateway | null;
  /** Present when CHAIN=solana: real launches, trades, escrow and payouts. */
  chain: SolanaChain | null;
  /** Our X app's OAuth client ("Log in with X", platform posting). Null until X_CLIENT_ID/SECRET are set. */
  xOAuth: XOAuth | null;
}

export const secondsFromNow = (s: number) => new Date(Date.now() + s * 1000).toISOString();
