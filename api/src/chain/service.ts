import bs58 from "bs58";
import BN from "bn.js";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, ComputeBudgetProgram, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, createBurnInstruction, getAccount } from "@solana/spl-token";
import { deriveDbcPoolAuthority, deriveDammV2PoolAuthority } from "@meteora-ag/dynamic-bonding-curve-sdk";
import type { env as Env } from "../env";
import { Launchpad } from "./launchpad";
import { EscrowClient } from "./escrow";
import { signMessage, type Ed25519Sig } from "./attestation";

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[chain]", ...a);

/**
 * Everything the backend does on Solana. Built only when CHAIN=solana.
 * Keys: the keeper (fee claimer, job payer, burn treasury on devnet), the two in-process
 * verifier keys (main + backup; the 3rd verifier is the admin's offline key), optional admin.
 */
export class SolanaChain {
  readonly connection: Connection;
  readonly launchpad: Launchpad;
  readonly escrow: EscrowClient;
  readonly keeper: Keypair;
  readonly admin: Keypair | null;
  readonly cluster: string;
  private verifierSecrets: string[];

  constructor(e: typeof Env) {
    const s = e.solana;
    if (!s.dbcConfig) throw new Error("DBC_CONFIG is missing (run: npm run chain:setup -w api)");
    if (!s.keeperSecret) throw new Error("KEEPER_SECRET_KEY is missing (run: npm run chain:setup -w api)");
    this.connection = new Connection(s.rpcUrl, "confirmed");
    this.launchpad = new Launchpad(this.connection, new PublicKey(s.dbcConfig));
    this.escrow = this.launchpad.escrow;
    this.keeper = Keypair.fromSecretKey(bs58.decode(s.keeperSecret));
    this.admin = s.adminSecret ? Keypair.fromSecretKey(bs58.decode(s.adminSecret)) : null;
    this.cluster = s.cluster;
    this.verifierSecrets = [e.verifier.mainSecret, e.verifier.backupSecret].filter(Boolean) as string[];
  }

  explorer(sig: string) {
    const c = this.cluster === "mainnet-beta" ? "" : this.cluster === "localnet" ? "?cluster=custom&customUrl=http%3A%2F%2F127.0.0.1%3A8899" : `?cluster=${this.cluster}`;
    return `https://solscan.io/tx/${sig}${c}`;
  }

  /** Sign an attestation with every verifier key this process holds. */
  attest(msg: Uint8Array): Ed25519Sig[] {
    return this.verifierSecrets.map((k) => signMessage(msg, k));
  }

  /** Keeper-paid transaction. */
  async send(tx: Transaction, extraSigners: Keypair[] = []): Promise<string> {
    tx.feePayer = this.keeper.publicKey;
    if (!tx.instructions.some((i) => i.programId.equals(ComputeBudgetProgram.programId))) {
      tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
    }
    return sendAndConfirmTransaction(this.connection, tx, [this.keeper, ...extraSigners], { commitment: "confirmed" });
  }

  /** A transaction the user's wallet signed in the browser. */
  async sendSigned(bytes: Uint8Array): Promise<string> {
    const sig = await this.connection.sendRawTransaction(bytes, { skipPreflight: false, preflightCommitment: "confirmed" });
    const tx = Transaction.from(bytes);
    const { lastValidBlockHeight } = await this.connection.getLatestBlockhash("confirmed");
    const res = await this.connection.confirmTransaction({ signature: sig, blockhash: tx.recentBlockhash!, lastValidBlockHeight }, "confirmed");
    if (res.value.err) throw new Error(`transaction failed: ${JSON.stringify(res.value.err)}`);
    return sig;
  }

  /**
   * Token balances for a vote snapshot, read from the chain. Excludes the bonding curve and
   * graduated pool vaults, the creator and platform wallets (CLAUDE.md §6.5.5).
   */
  async holders(mint: PublicKey, exclude: string[]): Promise<{ wallet: string; balance: bigint }[]> {
    const accounts = await this.connection.getProgramAccounts(TOKEN_PROGRAM_ID, {
      commitment: "confirmed",
      filters: [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: mint.toBase58() } }],
    });
    const skip = new Set([
      ...exclude,
      deriveDbcPoolAuthority().toBase58(),
      deriveDammV2PoolAuthority().toBase58(),
      this.keeper.publicKey.toBase58(),
    ]);
    const byOwner = new Map<string, bigint>();
    for (const a of accounts) {
      const d = a.account.data;
      const owner = new PublicKey(d.subarray(32, 64)).toBase58();
      const amount = d.readBigUInt64LE(64);
      if (amount === 0n || skip.has(owner)) continue;
      byOwner.set(owner, (byOwner.get(owner) ?? 0n) + amount);
    }
    return [...byOwner].map(([wallet, balance]) => ({ wallet, balance }));
  }

  /**
   * Burn an expired / opted-out pot (CLAUDE.md §6.2): buy the coin with the SOL, then burn
   * the tokens. Nobody profits from a bounty failing. Returns null if the coin already
   * graduated (then it's bought on DAMM v2 by hand for now).
   */
  async buyAndBurn(mint: PublicKey, lamports: bigint): Promise<{ buyTx: string; burnTx: string; burned: bigint } | null> {
    const pool = await this.launchpad.pool(mint);
    if (!pool || pool.state.poolState.isMigrated) {
      log(`burn for ${mint.toBase58()} needs a manual DAMM v2 buy (graduated)`);
      return null;
    }
    const { tx } = await this.launchpad.swapTx({ mint, owner: this.keeper.publicKey, side: "BUY", amountIn: lamports, slippageBps: 1000 });
    const buyTx = await this.send(tx);
    const ata = getAssociatedTokenAddressSync(mint, this.keeper.publicKey);
    const bal = (await getAccount(this.connection, ata, "confirmed")).amount;
    const burnTx = await this.send(new Transaction().add(createBurnInstruction(ata, mint, this.keeper.publicKey, bal)));
    return { buyTx, burnTx, burned: bal };
  }

  /** The chain's own clock (what the escrow compares windows and deadlines against). */
  async unixTime(): Promise<number> {
    const info = await this.connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, "confirmed");
    return info ? Number(info.data.readBigInt64LE(32)) : Math.floor(Date.now() / 1000);
  }

  async balance(pk: PublicKey) { return BigInt(await this.connection.getBalance(pk, "confirmed")); }
}

export { BN };
