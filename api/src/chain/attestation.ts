import nacl from "tweetnacl";
import bs58 from "bs58";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";

/**
 * On-chain attestations (programs/escrow/src/lib.rs `attestation_message`). Byte layout:
 *   "BOUNTYPAD1" | kind u8 | escrow program id (32) | bounty PDA (32) | target X user id u64 LE
 *   | post id u64 LE | payout wallet (32, zeros if none) | expiry i64 LE        = 131 bytes
 * Any change here must be made in the program too (the tests check both sides agree).
 */
export const KIND = { VERIFY: 1, WALLET: 2, OPT_OUT: 3 } as const;
export const ED25519_PROGRAM_ID = new PublicKey("Ed25519SigVerify111111111111111111111111111");

export interface AttestationFields {
  kind: number;
  programId: PublicKey;
  bounty: PublicKey;
  targetXUserId: bigint;
  postId: bigint;
  wallet: PublicKey | null;
  expiry: bigint;
}

export function attestationMessage(a: AttestationFields): Uint8Array {
  const buf = Buffer.alloc(131);
  let o = buf.write("BOUNTYPAD1", 0, "ascii");
  buf.writeUInt8(a.kind, o); o += 1;
  a.programId.toBuffer().copy(buf, o); o += 32;
  a.bounty.toBuffer().copy(buf, o); o += 32;
  buf.writeBigUInt64LE(a.targetXUserId, o); o += 8;
  buf.writeBigUInt64LE(a.postId, o); o += 8;
  (a.wallet ?? PublicKey.default).toBuffer().copy(buf, o); o += 32;
  buf.writeBigInt64LE(a.expiry, o);
  return new Uint8Array(buf);
}

export interface Ed25519Sig { signer: string; signature: string }

export function signMessage(msg: Uint8Array, secretKeyB58: string): Ed25519Sig {
  const kp = nacl.sign.keyPair.fromSecretKey(bs58.decode(secretKeyB58));
  return { signer: bs58.encode(kp.publicKey), signature: bs58.encode(nacl.sign.detached(msg, kp.secretKey)) };
}

export function verifySig(msg: Uint8Array, s: Ed25519Sig): boolean {
  try { return nacl.sign.detached.verify(msg, bs58.decode(s.signature), bs58.decode(s.signer)); } catch { return false; }
}

/**
 * One ed25519-verify instruction carrying several signatures over the SAME message, stored once
 * (keeps the transaction small). All offsets point inside this instruction (index 0xFFFF),
 * which is the only form the escrow program accepts.
 */
export function ed25519Instruction(msg: Uint8Array, sigs: Ed25519Sig[]): TransactionInstruction {
  const n = sigs.length;
  const header = 2 + 14 * n;
  const data = Buffer.alloc(header + n * 96 + msg.length);
  data.writeUInt8(n, 0);
  const msgOff = header + n * 96;
  sigs.forEach((s, i) => {
    const pkOff = header + i * 96, sigOff = pkOff + 32, o = 2 + i * 14;
    data.writeUInt16LE(sigOff, o);
    data.writeUInt16LE(0xffff, o + 2);
    data.writeUInt16LE(pkOff, o + 4);
    data.writeUInt16LE(0xffff, o + 6);
    data.writeUInt16LE(msgOff, o + 8);
    data.writeUInt16LE(msg.length, o + 10);
    data.writeUInt16LE(0xffff, o + 12);
    Buffer.from(bs58.decode(s.signer)).copy(data, pkOff);
    Buffer.from(bs58.decode(s.signature)).copy(data, sigOff);
  });
  Buffer.from(msg).copy(data, msgOff);
  return new TransactionInstruction({ programId: ED25519_PROGRAM_ID, keys: [], data });
}
