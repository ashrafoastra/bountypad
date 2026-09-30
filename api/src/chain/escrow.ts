import anchorPkg, { type Program as ProgramT, type Wallet } from "@coral-xyz/anchor";
import BN from "bn.js";

// @coral-xyz/anchor ships CommonJS; Node's ESM loader only sees its default export.
const { AnchorProvider, Program } = anchorPkg as unknown as typeof import("@coral-xyz/anchor");
import { Connection, Keypair, PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import idlJson from "./idl/bounty_escrow.json" with { type: "json" };
import type { BountyEscrow } from "./idl/bounty_escrow";
import { attestationMessage, ed25519Instruction, type Ed25519Sig, KIND } from "./attestation";

export const ESCROW_PROGRAM_ID = new PublicKey(idlJson.address);

/** Mirrors `Status` in the program. */
export const OnchainStatus = { OPEN: 0, VERIFIED: 1, FROZEN: 2, PAID: 3, EXPIRED: 4, OPTED_OUT: 5 } as const;
/** BIO_CONTRACT is light-mode only (never written to the escrow program); 255 is never sent. */
export const ACTION_CODE = { TWEET_CASHTAG: 0, TWEET_CONTRACT: 1, QUOTE_LAUNCH: 2, VIDEO_PHRASE: 3, BIO_CONTRACT: 255, REPOST_POST: 254 } as const;

export interface OnchainBounty {
  address: PublicKey;
  mint: PublicKey;
  pool: PublicKey;
  creator: PublicKey;
  targetXUserId: bigint;
  action: number;
  phraseHash: number[];
  createdAt: number;
  deadline: number;
  status: number;
  postId: bigint;
  payoutWallet: PublicKey;
  challengeEnds: number;
  totalDeposited: bigint;
  totalPaid: bigint;
  /** Lamports held above the rent minimum: the pot right now. */
  potLamports: bigint;
}

const readOnlyWallet = (pk: PublicKey): Wallet => ({
  publicKey: pk,
  payer: undefined as unknown as Keypair,
  signTransaction: async () => { throw new Error("read-only"); },
  signAllTransactions: async () => { throw new Error("read-only"); },
});

/** Builds escrow instructions and reads bounty accounts. Never holds keys itself. */
export class EscrowClient {
  readonly program: ProgramT<BountyEscrow>;
  constructor(readonly connection: Connection) {
    const provider = new AnchorProvider(connection, readOnlyWallet(PublicKey.default), { commitment: "confirmed" });
    this.program = new Program<BountyEscrow>(idlJson as BountyEscrow, provider);
  }

  static configPda() { return PublicKey.findProgramAddressSync([Buffer.from("config")], ESCROW_PROGRAM_ID)[0]; }
  static bountyPda(mint: PublicKey) { return PublicKey.findProgramAddressSync([Buffer.from("bounty"), mint.toBuffer()], ESCROW_PROGRAM_ID)[0]; }

  async config() {
    return this.program.account.config.fetchNullable(EscrowClient.configPda());
  }

  async bounty(mint: PublicKey): Promise<OnchainBounty | null> {
    const address = EscrowClient.bountyPda(mint);
    const info = await this.connection.getAccountInfo(address, "confirmed");
    if (!info) return null;
    const b = this.program.coder.accounts.decode("bounty", info.data);
    const rent = await this.connection.getMinimumBalanceForRentExemption(info.data.length);
    return {
      address, mint: b.mint, pool: b.pool, creator: b.creator,
      targetXUserId: BigInt(b.targetXUserId.toString()), action: b.action, phraseHash: b.phraseHash,
      createdAt: b.createdAt.toNumber(), deadline: b.deadline.toNumber(), status: b.status,
      postId: BigInt(b.postId.toString()), payoutWallet: b.payoutWallet, challengeEnds: b.challengeEnds.toNumber(),
      totalDeposited: BigInt(b.totalDeposited.toString()), totalPaid: BigInt(b.totalPaid.toString()),
      potLamports: BigInt(Math.max(0, info.lamports - rent)),
    };
  }

  initializeConfig(admin: PublicKey, args: ConfigArgs) {
    return this.program.methods.initializeConfig(toArgs(args)).accountsPartial({ config: EscrowClient.configPda(), admin }).instruction();
  }

  updateConfig(admin: PublicKey, args: ConfigArgs, newAdmin: PublicKey) {
    return this.program.methods.updateConfig(toArgs(args), newAdmin).accountsPartial({ config: EscrowClient.configPda(), admin }).instruction();
  }

  createBounty(p: { mint: PublicKey; pool: PublicKey; creator: PublicKey; targetXUserId: bigint; action: number; phraseHash: Uint8Array; deadline: number }) {
    return this.program.methods
      .createBounty({ targetXUserId: new BN(p.targetXUserId.toString()), action: p.action, phraseHash: Array.from(p.phraseHash), deadline: new BN(p.deadline) })
      .accountsPartial({ config: EscrowClient.configPda(), bounty: EscrowClient.bountyPda(p.mint), mint: p.mint, pool: p.pool, creator: p.creator, systemProgram: SystemProgram.programId })
      .instruction();
  }

  deposit(mint: PublicKey, payer: PublicKey, lamports: bigint) {
    return this.program.methods.deposit(new BN(lamports.toString()))
      .accountsPartial({ bounty: EscrowClient.bountyPda(mint), payer, systemProgram: SystemProgram.programId }).instruction();
  }

  /** Message the verifiers sign for `verify` (kind 1). */
  verifyMessage(mint: PublicKey, targetXUserId: bigint, postId: bigint, wallet: PublicKey | null, expiry: number) {
    return attestationMessage({ kind: KIND.VERIFY, programId: ESCROW_PROGRAM_ID, bounty: EscrowClient.bountyPda(mint), targetXUserId, postId, wallet, expiry: BigInt(expiry) });
  }
  walletMessage(mint: PublicKey, targetXUserId: bigint, postId: bigint, wallet: PublicKey, expiry: number) {
    return attestationMessage({ kind: KIND.WALLET, programId: ESCROW_PROGRAM_ID, bounty: EscrowClient.bountyPda(mint), targetXUserId, postId, wallet, expiry: BigInt(expiry) });
  }
  optOutMessage(mint: PublicKey, targetXUserId: bigint, expiry: number) {
    return attestationMessage({ kind: KIND.OPT_OUT, programId: ESCROW_PROGRAM_ID, bounty: EscrowClient.bountyPda(mint), targetXUserId, postId: 0n, wallet: null, expiry: BigInt(expiry) });
  }

  /** [ed25519 verify, escrow.verify] */
  async verify(mint: PublicKey, postId: bigint, wallet: PublicKey | null, expiry: number, msg: Uint8Array, sigs: Ed25519Sig[]): Promise<TransactionInstruction[]> {
    const ix = await this.program.methods.verify(new BN(postId.toString()), wallet ?? PublicKey.default, new BN(expiry))
      .accountsPartial(this.attestAccounts(mint)).instruction();
    return [ed25519Instruction(msg, sigs), ix];
  }

  async assignWallet(mint: PublicKey, wallet: PublicKey, expiry: number, msg: Uint8Array, sigs: Ed25519Sig[]) {
    const ix = await this.program.methods.assignWallet(wallet, new BN(expiry)).accountsPartial(this.attestAccounts(mint)).instruction();
    return [ed25519Instruction(msg, sigs), ix];
  }

  async optOut(mint: PublicKey, treasury: PublicKey, expiry: number, msg: Uint8Array, sigs: Ed25519Sig[]) {
    const ix = await this.program.methods.optOut(new BN(expiry))
      .accountsPartial({ ...this.attestAccounts(mint), treasury }).instruction();
    return [ed25519Instruction(msg, sigs), ix];
  }

  release(mint: PublicKey, payoutWallet: PublicKey) {
    return this.program.methods.release().accountsPartial({ bounty: EscrowClient.bountyPda(mint), payoutWallet }).instruction();
  }

  expire(mint: PublicKey, treasury: PublicKey) {
    return this.program.methods.expire().accountsPartial({ config: EscrowClient.configPda(), bounty: EscrowClient.bountyPda(mint), treasury }).instruction();
  }

  admin(action: "freeze" | "unfreeze" | "cancel", mint: PublicKey, admin: PublicKey) {
    return this.program.methods[action]().accountsPartial({ config: EscrowClient.configPda(), bounty: EscrowClient.bountyPda(mint), admin }).instruction();
  }

  private attestAccounts(mint: PublicKey) {
    return { config: EscrowClient.configPda(), bounty: EscrowClient.bountyPda(mint), instructions: SYSVAR_INSTRUCTIONS_PUBKEY };
  }
}

export interface ConfigArgs {
  verifiers: [PublicKey, PublicKey, PublicKey];
  threshold: number;
  challengeWindowSec: number;
  deadlineGraceSec: number;
  treasury: PublicKey;
  dbcConfig: PublicKey;
}

function toArgs(a: ConfigArgs) {
  return {
    verifiers: a.verifiers, threshold: a.threshold, challengeWindow: new BN(a.challengeWindowSec),
    deadlineGrace: new BN(a.deadlineGraceSec), treasury: a.treasury, dbcConfig: a.dbcConfig,
  };
}
