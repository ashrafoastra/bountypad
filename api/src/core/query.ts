import type { BountyAction } from "@bountypad/shared";

export interface QueryInput {
  action: BountyAction;
  username: string;
  ticker: string;
  mint: string;
  launchPostId: string | null;
}

/**
 * X search query per bounty (CLAUDE.md §6.3). Returns null for VIDEO_PHRASE,
 * which is detected by reading the target's timeline instead.
 */
export function buildSearchQuery(q: QueryInput): string | null {
  const from = `from:${q.username}`;
  switch (q.action) {
    case "TWEET_CASHTAG":
      return `${from} $${q.ticker} -is:retweet`;
    case "TWEET_CONTRACT":
      return `${from} "${q.mint}" -is:retweet`;
    case "QUOTE_LAUNCH":
      return q.launchPostId ? `quotes_of_tweet_id:${q.launchPostId} ${from}` : null;
    case "VIDEO_PHRASE":
      return null;
  }
}

/** Group bounties by target so a busy target's timeline is read once, not once per coin. */
export function groupByTarget<T extends { targetXUserId: string }>(items: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const arr = m.get(it.targetXUserId) ?? [];
    arr.push(it);
    m.set(it.targetXUserId, arr);
  }
  return m;
}
