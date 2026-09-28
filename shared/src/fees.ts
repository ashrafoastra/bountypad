import { RULES } from "./config";

export interface FeeSplit {
  tradeFee: bigint;
  dbcProtocol: bigint;
  partner: bigint;
  pot: bigint;
  platform: bigint;
  creator: bigint;
}

/** Split the fee on one trade (CLAUDE.md §6.2). All values in lamports. Rounding dust goes to platform. */
export function splitTradeFee(tradeLamports: bigint, rules = RULES.fees): FeeSplit {
  const tradeFee = (tradeLamports * BigInt(rules.tradeFeeBps)) / 10000n;
  const dbcProtocol = (tradeFee * BigInt(rules.dbcProtocolShareBps)) / 10000n;
  const partner = tradeFee - dbcProtocol;
  const pot = (partner * BigInt(rules.split.potBps)) / 10000n;
  const creator = (partner * BigInt(rules.split.creatorBps)) / 10000n;
  const platform = partner - pot - creator;
  return { tradeFee, dbcProtocol, partner, pot, platform, creator };
}

export const LAMPORTS_PER_SOL = 1_000_000_000n;

export function lamportsToSol(l: string | bigint): number {
  return Number(BigInt(l)) / 1e9;
}
