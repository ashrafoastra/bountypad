import bs58 from "bs58";

/** A Solana address is 32 bytes, base58-encoded. Rejects typos before money is sent anywhere. */
export function isSolanaAddress(s: string): boolean {
  if (typeof s !== "string" || s.length < 32 || s.length > 44) return false;
  try {
    return bs58.decode(s).length === 32;
  } catch {
    return false;
  }
}
