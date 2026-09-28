import nacl from "tweetnacl";
import bs58 from "bs58";
import { RULES, voteMessage, type VoteChoice, type VoteTally } from "@bountypad/shared";

export interface SnapshotEntry {
  wallet: string;
  balance: bigint;
}

export interface CastVote {
  wallet: string;
  choice: VoteChoice;
}

/**
 * Tally a holder vote (CLAUDE.md §6.5.5).
 * - Only wallets in the snapshot count, with their snapshot balance.
 * - Excluded wallets (pool, creator, platform) must already be removed from the snapshot.
 * - Each wallet's weight is capped at maxWalletWeightPct of the eligible supply.
 * - Quorum uses raw balances of voters; pass uses capped weights.
 */
export function tallyVotes(snapshot: SnapshotEntry[], votes: CastVote[], rules = RULES.vote): VoteTally {
  const bal = new Map(snapshot.map((s) => [s.wallet, s.balance]));
  const eligible = snapshot.reduce((a, s) => a + s.balance, 0n);
  const cap = (eligible * BigInt(Math.round(rules.maxWalletWeightPct * 100))) / 10000n;
  let yes = 0n, no = 0n, turnout = 0n;
  const seen = new Set<string>();
  for (const v of votes) {
    if (seen.has(v.wallet)) continue;
    seen.add(v.wallet);
    const b = bal.get(v.wallet);
    if (!b) continue;
    turnout += b;
    const w = b > cap ? cap : b;
    if (v.choice === "YES") yes += w; else no += w;
  }
  const turnoutPct = eligible > 0n ? Number((turnout * 10000n) / eligible) / 100 : 0;
  const cast = yes + no;
  const yesPct = cast > 0n ? Number((yes * 10000n) / cast) / 100 : 0;
  const quorumMet = turnoutPct >= rules.quorumPct;
  return {
    eligibleSupply: eligible.toString(),
    yesWeight: yes.toString(),
    noWeight: no.toString(),
    turnout: turnout.toString(),
    turnoutPct,
    yesPct,
    quorumMet,
    passed: quorumMet && yesPct >= rules.passPct,
  };
}

/** Verify a gasless vote: the wallet signed voteMessage(roundId, choice) with its ed25519 key. */
export function verifyVoteSignature(roundId: string, choice: VoteChoice, wallet: string, signatureB58: string): boolean {
  try {
    const msg = new TextEncoder().encode(voteMessage(roundId, choice));
    return nacl.sign.detached.verify(msg, bs58.decode(signatureB58), bs58.decode(wallet));
  } catch {
    return false;
  }
}

export type RoundOutcome = "PASSED" | "FAILED" | "EXTEND" | "NO_QUORUM";

/** What happens when a vote window closes. */
export function closeRound(tally: VoteTally, alreadyExtended: boolean): RoundOutcome {
  if (!tally.quorumMet) return alreadyExtended ? "NO_QUORUM" : "EXTEND";
  return tally.passed ? "PASSED" : "FAILED";
}
