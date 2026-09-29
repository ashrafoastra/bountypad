// DRAFT: every endpoint the web app calls, with its input and output (CLAUDE.md §5).
import type { TokenLinks, Bounty, BountyAction, Detection, FeedEvent, Payout, Profile, Token, Trade, VoteChoice, VoteRound, VoteTally } from "./types";

export interface TokenSummary {
  token: Token;
  bounty: Bounty;
  target: Profile;
  holders: number;
  volumeLamports: string;
  market: MarketStats;
}

/** Price is in SOL per whole token (6 decimals, 1B supply). null until the first trade/sample. */
export interface MarketStats {
  priceSol: number | null;
  marketCapSol: number | null;
  /** % change over 24h (vs the launch price when the coin is younger than 24h). */
  change24h: number | null;
  volume24hLamports: string;
  /** 0..1 progress toward graduation on the bonding curve. */
  curveProgress: number | null;
}

export type ChartTimeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
export const CHART_TIMEFRAMES: Record<ChartTimeframe, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 };

export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }

export interface TokenChart {
  timeframe: ChartTimeframe;
  candles: Candle[];
  /** Pot in SOL over time (unix seconds). */
  pot: { time: number; value: number }[];
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
  /** Optional social links (https). Each must be on its platform's domain. */
  links?: TokenLinks;
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
  /** "Log in with X" through our own X app (OAuth 2.0) is configured. */
  xLogin: boolean;
  /** The platform's X account is connected (launch posts, receipts; enables "quote the launch post"). */
  platformX: boolean;
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
  "GET /api/tokens/:id/chart": { query: { tf?: ChartTimeframe }; res: TokenChart };
  "POST /api/tokens": { body: LaunchRequest; res: { id: string } };
  "GET /api/health": { res: Health };
  "GET /api/auth/x/login": { query: { return?: string }; res: "302 to X" };
  "POST /api/auth/x/complete": { body: { code: string }; res: { x: Profile; returnTo: string } };
  "GET /api/auth/session": { res: { x: Profile | null } };
  "POST /api/auth/logout": { res: { ok: true } };
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
