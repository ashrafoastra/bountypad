import nacl from "tweetnacl";
import bs58 from "bs58";

export interface PayoutAttestation {
  bountyId: string;
  targetXUserId: string;
  postId: string;
  payoutWallet: string;
  amountLamports: string;
  /** Unix seconds after which the attestation is invalid. */
  expiry: number;
}

/**
 * Canonical bytes a verifier signs (CLAUDE.md §6.6). The escrow program rebuilds the
 * same bytes and checks the signature with Solana's ed25519 verify instruction.
 * Field order and separators are part of the contract with programs/.
 */
export function attestationBytes(a: PayoutAttestation): Uint8Array {
  const s = [
    "bountypad:payout:v1",
    a.bountyId,
    a.targetXUserId,
    a.postId,
    a.payoutWallet,
    a.amountLamports,
    String(a.expiry),
  ].join("|");
  return new TextEncoder().encode(s);
}

export function signAttestation(a: PayoutAttestation, secretKeyB58: string): { signer: string; signature: string } {
  const sk = bs58.decode(secretKeyB58);
  const kp = nacl.sign.keyPair.fromSecretKey(sk);
  const sig = nacl.sign.detached(attestationBytes(a), kp.secretKey);
  return { signer: bs58.encode(kp.publicKey), signature: bs58.encode(sig) };
}

export function verifyAttestation(a: PayoutAttestation, signer: string, signature: string): boolean {
  try {
    return nacl.sign.detached.verify(attestationBytes(a), bs58.decode(signature), bs58.decode(signer));
  } catch {
    return false;
  }
}

/** Count valid signatures from the allowed verifier set (2 of 3 required). */
export function countValidSignatures(
  a: PayoutAttestation,
  sigs: { signer: string; signature: string }[],
  allowedSigners: string[],
): number {
  const ok = new Set<string>();
  for (const s of sigs) if (allowedSigners.includes(s.signer) && verifyAttestation(a, s.signer, s.signature)) ok.add(s.signer);
  return ok.size;
}
