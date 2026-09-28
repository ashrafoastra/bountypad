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
