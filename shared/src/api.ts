// DRAFT: every endpoint the web app calls, with its input and output (CLAUDE.md §5).
import type { Bounty, BountyAction, Detection, FeedEvent, Payout, Profile, Token, Trade, VoteChoice, VoteRound, VoteTally } from "./types";

export interface TokenSummary {
  token: Token;
  bounty: Bounty;
  target: Profile;
  holders: number;
  volumeLamports: string;
}

export interface TokenDetail extends TokenSummary {
  detections: Detection[];
  trades: Trade[];
  vote: { round: VoteRound; tally: VoteTally } | null;
  payout: Payout | null;
  potHistory: { at: string; potLamports: string }[];
}

export interface Stats {
  liveCoins: number;
  lockedLamports: string;
  paidLamports: string;
  bountiesPaid: number;
}

export interface LaunchRequest {
  name: string;
  ticker: string;
  imageUrl?: string | null;
  description?: string;
  creatorWallet: string;
  targetHandle: string;
  action: BountyAction;
  phrase?: string | null;
  deadlineDays?: number;
  /** CHAIN=solana: SOL the creator buys inside the launch transaction. */
  firstBuySol?: number;
}

/** GET /api/health: which parts are real in this deployment. */
export interface Health {
  ok: boolean;
  /** Fully simulated (mock X + simulated chain). */
  sim: boolean;
  xMode: "mock" | "real";
  chain: "sim" | "solana";
  /** CHAIN=solana only. */
  cluster: string | null;
  escrowProgram: string | null;
  dbcConfig: string | null;
  devTools: boolean;
  solUsd: number;
  privy: boolean;
  /** CHAIN=solana: the launchpad's anti-sniper fee schedule (fee starts high, decays to the base fee). */
  feeSchedule: { startingFeeBps: number; endingFeeBps: number; decaySeconds: number } | null;
}

/** CHAIN=solana: a transaction built by the API for the user's wallet to sign (base64, legacy format). */
export interface PreparedTx {
  transaction: string;
}
export interface PreparedLaunch extends PreparedTx {
  launchId: string;
  mint: string;
}
export interface PreparedTrade extends PreparedTx {
  tradeId: string;
  expectedOut: string;
  minimumOut: string;
}

export interface VoteRequest {
  wallet: string;
  choice: VoteChoice;
  /** base58 ed25519 signature of voteMessage(roundId, choice). */
  signature: string;
}

export interface ProfileDetail {
  profile: Profile;
  bounties: TokenSummary[];
  lockedLamports: string;
  earnedLamports: string;
}

export interface ApiRoutes {
  "GET /api/stats": { res: Stats };
  "GET /api/tokens": { query: { sort?: "pot" | "new" }; res: TokenSummary[] };
  "GET /api/tokens/:id": { res: TokenDetail };
  "POST /api/tokens": { body: LaunchRequest; res: { id: string } };
  "GET /api/health": { res: Health };
  "POST /api/launch/prepare": { body: LaunchRequest; res: PreparedLaunch };
  "POST /api/launch/submit": { body: { launchId: string; signedTransaction: string }; res: { id: string; bountyId: string; tx: string; explorer: string } };
  "GET /api/meta/:mint": { res: { name: string; symbol: string; description: string; image?: string } };
  "POST /api/trade/prepare": { body: { tokenId: string; wallet: string; side: "BUY" | "SELL"; amount: string; slippageBps?: number }; res: PreparedTrade };
  "GET /api/chain/balance": { query: { wallet: string; mint?: string }; res: { lamports: string; tokenAmount: string | null } };
  "POST /api/trade/submit": { body: { tradeId: string; signedTransaction: string }; res: { tx: string; explorer: string } };
  "GET /api/x/lookup": { query: { handle: string }; res: { ok: true; profile: Profile } | { ok: false; reason: string } };
  "GET /api/profiles/:handle": { res: ProfileDetail };
  "POST /api/votes/:roundId": { body: VoteRequest; res: { tally: VoteTally } };
  "GET /api/feed": { res: FeedEvent[] };
  "GET /api/events (SSE)": { res: FeedEvent };
}

/** The exact message a wallet signs to vote. Shared so web and api build identical bytes. */
export function voteMessage(roundId: string, choice: VoteChoice): string {
  return `Bounty Pad vote\nround:${roundId}\nchoice:${choice}`;
}
