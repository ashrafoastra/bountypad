// Default rule values. Every number here is a PROPOSAL from CLAUDE.md, not a final decision.
// Keep them in config; never hardcode them elsewhere.

export const RULES = {
  tickerMaxLength: 6,
  defaultDeadlineDays: 90,
  /** Hours between detection and the "still live" recheck. */
  recheckHours: 24,
  video: {
    maxDurationMs: 3 * 60 * 1000,
    autoApproveScore: 90,
    autoRejectScore: 30,
  },
  vote: {
    windowHours: 48,
    quorumPct: 10,
    passPct: 60,
    maxWalletWeightPct: 5,
  },
  payout: {
    challengeWindowHours: 48,
    requiredSignatures: 2,
  },
  fees: {
    /** Trading fee tier charged by the bonding curve (open decision). */
    tradeFeeBps: 100,
    /** Meteora DBC keeps a fixed 20% of the trading fee; partner gets 80%. */
    dbcProtocolShareBps: 2000,
    /** Split of OUR partner share. Must sum to 10000. */
    split: { potBps: 5000, platformBps: 3000, creatorBps: 2000 },
  },
} as const;

export type Rules = typeof RULES;

export const ACTION_LABEL: Record<string, string> = {
  TWEET_CASHTAG: "Post the $TICKER on X",
  TWEET_CONTRACT: "Post the contract address on X",
  QUOTE_LAUNCH: "Quote the coin's launch post",
  VIDEO_PHRASE: "Say the phrase in a video on X",
  BIO_CONTRACT: "Put the contract address in their X bio",
  REPOST_POST: "Repost a post on X",
};
