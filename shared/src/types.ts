// DRAFT: the contract between programs/, api/ and web/.
// Changing this file needs approval from all three team members (CLAUDE.md §3).

/** Machine-checkable bounty actions (CLAUDE.md §6.1). No free-text bounties. */
export type BountyAction = "TWEET_CASHTAG" | "TWEET_CONTRACT" | "QUOTE_LAUNCH" | "VIDEO_PHRASE" | "BIO_CONTRACT";

/** Bounty lifecycle (CLAUDE.md §6.8). */
export type BountyStatus =
  | "OPEN"
  | "DETECTED_CONFIRMING"
  | "VOTING"
  | "VERIFIED"
  | "CHALLENGE_WINDOW"
  | "PAID"
  | "EXPIRED"
  | "OPTED_OUT"
  | "FROZEN";

export type DetectionStatus = "CONFIRMING" | "VOTING" | "VERIFIED" | "REJECTED";

export type VoteChoice = "YES" | "NO";

/** A public figure on X that bounties can target. Keyed by the permanent numeric X user ID. */
export interface Profile {
  xUserId: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  verified: boolean;
  optedOut: boolean;
  /** Wallet linked after their first claim (Path 2) or pregenerated (Path 1). */
  linkedWallet: string | null;
}

export const LINK_KINDS = ["website", "x", "telegram", "github", "tiktok", "youtube"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
export type TokenLinks = Partial<Record<LinkKind, string>>;

export interface Token {
  id: string;
  mint: string;
  name: string;
  /** 1 to 6 letters, stored uppercase without "$". */
  ticker: string;
  imageUrl: string | null;
  description: string;
  creatorWallet: string;
  /** The coin's official launch post on X (needed for QUOTE_LAUNCH). */
  launchPostId: string | null;
  /** CHAIN=solana: the Meteora bonding-curve pool and the launch transaction. Null in SIM. */
  pool: string | null;
  launchTx: string | null;
  /** CHAIN=solana: the escrow account holding this coin's pot (PDA of the mint). */
  escrow: string | null;
  /** The platform's own coin, pinned above the market. */
  featured: boolean;
  /** Social links set by the creator at launch (like pump.fun / Axiom). Also in the on-chain metadata JSON. */
  links: TokenLinks;
  createdAt: string;
}

export interface Bounty {
  id: string;
  tokenId: string;
  targetXUserId: string;
  action: BountyAction;
  /** Only for VIDEO_PHRASE. */
  phrase: string | null;
  deadline: string;
  status: BountyStatus;
  /** Bounty pot, in lamports, as a decimal string (bigint-safe). */
  potLamports: string;
  verifiedPostId: string | null;
  payoutWallet: string | null;
  paidTx: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CheckResult {
  id: "AUTHOR" | "AFTER_LAUNCH" | "BEFORE_DEADLINE" | "POST_TYPE" | "CONTENT" | "STILL_LIVE" | "VIDEO_LENGTH";
  label: string;
  pass: boolean;
  detail?: string;
}

export interface Detection {
  id: string;
  bountyId: string;
  postId: string;
  text: string;
  postCreatedAt: string;
  mediaUrl: string | null;
  transcript: string | null;
  /** 0-100, video bounties only. */
  matchScore: number | null;
  checks: CheckResult[];
  status: DetectionStatus;
  detectedAt: string;
  recheckAt: string;
}

export interface VoteRound {
  id: string;
  bountyId: string;
  detectionId: string;
  opensAt: string;
  closesAt: string;
  extended: boolean;
  /** CANCELLED: the bounty left VOTING another way (e.g. the target opted out). */
  result: "PENDING" | "PASSED" | "FAILED" | "NO_QUORUM" | "CANCELLED";
}

export interface VoteTally {
  eligibleSupply: string;
  yesWeight: string;
  noWeight: string;
  turnout: string;
  turnoutPct: number;
  yesPct: number;
  quorumMet: boolean;
  passed: boolean;
}

export interface Trade {
  id: string;
  tokenId: string;
  wallet: string;
  side: "BUY" | "SELL";
  solLamports: string;
  /** Portion of this trade's fee that went to the bounty pot. */
  potLamports: string;
  /** Tokens bought or sold, base units (6 decimals). null for trades recorded before prices were tracked. */
  tokenAmount: string | null;
  /** SOL per whole token right after the trade. */
  priceSol: number | null;
  createdAt: string;
}

export interface Payout {
  id: string;
  bountyId: string;
  amountLamports: string;
  wallet: string;
  /** Verifier signatures collected so far (need 2 of 3). */
  signatures: { signer: string; signature: string }[];
  challengeEndsAt: string;
  /** AWAITING_CLAIM: challenge window passed but the target has no linked wallet yet (Path 2). */
  status: "CHALLENGE_WINDOW" | "FROZEN" | "AWAITING_CLAIM" | "SENT";
  txSig: string | null;
}

export type FeedEventType =
  | "TOKEN_LAUNCHED"
  | "TRADE"
  | "POST_DETECTED"
  | "BOUNTY_VERIFIED"
  | "BOUNTY_REJECTED"
  | "VOTE_OPENED"
  | "VOTE_CLOSED"
  | "PAYOUT_SENT"
  | "BOUNTY_EXPIRED"
  /** CHAIN=solana: trading fees claimed and the pot share locked in the escrow. */
  | "POT_FUNDED"
  /** CHAIN=solana: an expired / opted-out pot bought the coin and burned it. */
  | "POT_BURNED";

export interface FeedEvent {
  id: number;
  type: FeedEventType;
  tokenId: string | null;
  bountyId: string | null;
  data: Record<string, unknown>;
  at: string;
}
