/**
 * On-chain integration test: real Meteora DBC program + our escrow program on a local validator.
 * Run:  SOLANA_TEST_RPC=http://127.0.0.1:8899 npx vitest run test/chain.test.ts
 * (programs/scripts/start-local-validator.sh starts a validator with both programs loaded.)
 */
import { describe, it, expect, beforeAll } from "vitest";
import bs58 from "bs58";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, sendAndConfirmTransaction, SystemProgram } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";
import { Launchpad, poolAddress, potShare } from "../src/chain/launchpad";
import { EscrowClient, OnchainStatus, ACTION_CODE } from "../src/chain/escrow";
import { signMessage, attestationMessage, KIND } from "../src/chain/attestation";

const RPC = process.env.SOLANA_TEST_RPC;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!RPC)("on-chain: Meteora pool + bounty escrow", () => {
  const conn = new Connection(RPC ?? "http://127.0.0.1:8899", "confirmed");
  const keeper = Keypair.generate(); // fee claimer + admin in this test
  const verifiers = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
  const outsider = Keypair.generate();
  const treasury = Keypair.generate();
  const creator = Keypair.generate();
  const trader = Keypair.generate();
  const target = Keypair.generate(); // the public figure's payout wallet
  const dbcConfig = Keypair.generate();
  let lp: Launchpad;
  let escrow: EscrowClient;
  const vsk = (k: Keypair) => bs58.encode(k.secretKey);
  const now = () => Math.floor(Date.now() / 1000);

  async function airdrop(pk: PublicKey, sol: number) {
    const sig = await conn.requestAirdrop(pk, sol * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, "confirmed");
  }
  async function send(tx: Transaction, signers: Keypair[]) {
    return sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed" });
  }
  const txOf = (...ixs: any[]) => new Transaction().add(...ixs.flat());
  const expectFail = async (p: Promise<unknown>, re: RegExp) => {
    let msg = "";
    try { await p; } catch (e: any) { msg = String(e?.transactionLogs?.join("\n") ?? "") + String(e?.message ?? e); }
    expect(msg, "expected the transaction to fail").toMatch(re);
  };

  async function launch(opts: { deadlineInSec?: number; target?: bigint } = {}) {
    const mint = Keypair.generate();
    const { tx } = await lp.launchTx({
      creator: creator.publicKey, mint, name: "Rocket", symbol: "ROCKET", uri: "https://example.com/rocket.json",
      targetXUserId: opts.target ?? 1001n, action: ACTION_CODE.TWEET_CASHTAG, phraseHash: new Uint8Array(32),
      deadline: now() + (opts.deadlineInSec ?? 90 * 86400),
    });
    tx.partialSign(creator);
    await sendAndConfirmTransaction(conn, tx, [creator, mint], { commitment: "confirmed" });
    return mint.publicKey;
  }

  async function trade(mint: PublicKey, side: "BUY" | "SELL", amountIn: bigint) {
    const { tx } = await lp.swapTx({ mint, owner: trader.publicKey, side, amountIn, slippageBps: 1000 });
    await send(tx, [trader]);
  }

  async function attestVerify(mint: PublicKey, postId: bigint, wallet: PublicKey | null, signers: Keypair[], expiry = now() + 600, targetId = 1001n) {
    const msg = escrow.verifyMessage(mint, targetId, postId, wallet, expiry);
    const sigs = signers.map((k) => signMessage(msg, vsk(k)));
    const ixs = await escrow.verify(mint, postId, wallet, expiry, msg, sigs);
    return send(txOf(...ixs), [keeper]);
  }

  beforeAll(async () => {
    for (const k of [keeper, creator, trader]) await airdrop(k.publicKey, 100);
    await airdrop(outsider.publicKey, 1);
    lp = new Launchpad(conn, dbcConfig.publicKey);
    escrow = lp.escrow;
    if (await escrow.config()) throw new Error("This validator already has an escrow config. Run the test on a fresh validator (--reset).");
    // Our Meteora launchpad config, fee claimer = keeper.
    const cfgTx = await lp.createConfigTx(dbcConfig, keeper.publicKey, keeper.publicKey);
    await send(cfgTx, [keeper, dbcConfig]);
    // Escrow config: 2 of 3 verifiers, short windows for the test.
    await send(txOf(await escrow.initializeConfig(keeper.publicKey, {
      verifiers: verifiers.map((v) => v.publicKey) as [PublicKey, PublicKey, PublicKey], threshold: 2,
      challengeWindowSec: 3, deadlineGraceSec: 2, treasury: treasury.publicKey, dbcConfig: dbcConfig.publicKey,
    })), [keeper]);
  }, 120_000);

  it("attestation bytes match the program's layout", () => {
    const m = attestationMessage({ kind: KIND.VERIFY, programId: PublicKey.default, bounty: PublicKey.default, targetXUserId: 1n, postId: 2n, wallet: null, expiry: 3n });
    expect(m.length).toBe(131);
    expect(Buffer.from(m.slice(0, 10)).toString()).toBe("BOUNTYPAD1");
  });

  let mint: PublicKey;
  it("launch creates the Meteora pool AND the bounty in one transaction", async () => {
    mint = await launch();
    const b = await escrow.bounty(mint);
    expect(b).not.toBeNull();
    expect(b!.status).toBe(OnchainStatus.OPEN);
    expect(b!.targetXUserId).toBe(1001n);
    expect(b!.pool.equals(poolAddress(dbcConfig.publicKey, mint))).toBe(true);
    expect(b!.creator.equals(creator.publicKey)).toBe(true);
    const p = await lp.pool(mint);
    expect(p!.state.poolState.config.equals(dbcConfig.publicKey)).toBe(true);
  }, 60_000);

  it("a bounty can't point at something that isn't our Meteora pool", async () => {
    const fakeMint = Keypair.generate().publicKey;
    const ix = await escrow.createBounty({ mint: fakeMint, pool: trader.publicKey, creator: creator.publicKey, targetXUserId: 5n, action: 0, phraseHash: new Uint8Array(32), deadline: now() + 1000 });
    await expectFail(send(txOf(ix), [creator]), /NotDbcPool|Not a Meteora/);
    // Same mint twice: the bounty PDA already exists.
    const ix2 = await escrow.createBounty({ mint, pool: poolAddress(dbcConfig.publicKey, mint), creator: creator.publicKey, targetXUserId: 5n, action: 0, phraseHash: new Uint8Array(32), deadline: now() + 1000 });
    await expectFail(send(txOf(ix2), [creator]), /already in use|custom program error: 0x0/);
  }, 60_000);

  it("trades generate fees; the keeper claims and deposits exactly 5/8 into the pot", async () => {
    await trade(mint, "BUY", 2n * BigInt(LAMPORTS_PER_SOL));
    await trade(mint, "BUY", 1n * BigInt(LAMPORTS_PER_SOL));
    const ata = getAssociatedTokenAddressSync(mint, trader.publicKey);
    const bal = (await getAccount(conn, ata)).amount;
    expect(bal).toBeGreaterThan(0n);
    await trade(mint, "SELL", bal / 2n);

    const before = await escrow.bounty(mint);
    const r = await lp.claimAndDepositTx(mint, keeper.publicKey, 1n);
    expect(r).not.toBeNull();
    expect(r!.claimed).toBeGreaterThan(0n);
    await send(r!.tx, [keeper]);
    const after = await escrow.bounty(mint);
    expect(after!.potLamports - before!.potLamports).toBe(potShare(r!.claimed));
    expect(after!.totalDeposited).toBe(potShare(r!.claimed));
    // Nothing left to claim right after.
    expect(await lp.claimAndDepositTx(mint, keeper.publicKey, 1n)).toBeNull();
  }, 120_000);

  it("verification needs 2 of 3 verifier signatures over the exact terms", async () => {
    await expectFail(attestVerify(mint, 777n, target.publicKey, [verifiers[0]]), /NotEnoughSignatures|Not enough verifier/);
    await expectFail(attestVerify(mint, 777n, target.publicKey, [verifiers[0], outsider]), /NotEnoughSignatures|Not enough verifier/);
    await expectFail(attestVerify(mint, 777n, target.publicKey, [verifiers[0], verifiers[0]]), /NotEnoughSignatures|Not enough verifier/);
    // Signed for a different target than the one written at launch.
    await expectFail(attestVerify(mint, 777n, target.publicKey, [verifiers[0], verifiers[1]], now() + 600, 9999n), /NotEnoughSignatures|Not enough verifier/);
    await expectFail(attestVerify(mint, 777n, target.publicKey, [verifiers[0], verifiers[1]], now() - 10), /AttestationExpired|Attestation expired/);
    await attestVerify(mint, 777n, target.publicKey, [verifiers[0], verifiers[2]]);
    const b = await escrow.bounty(mint);
    expect(b!.status).toBe(OnchainStatus.VERIFIED);
    expect(b!.postId).toBe(777n);
    // Can't verify twice.
    await expectFail(attestVerify(mint, 778n, target.publicKey, [verifiers[0], verifiers[1]]), /BadStatus|current status/);
  }, 60_000);

  it("release waits for the challenge window, then pays the whole pot to the target", async () => {
    await expectFail(send(txOf(await escrow.release(mint, target.publicKey)), [keeper]), /ChallengeWindowOpen|still open/);
    await expectFail(send(txOf(await escrow.release(mint, outsider.publicKey)), [keeper]), /ChallengeWindowOpen|BadWallet|still open/);
    await sleep(4000);
    await expectFail(send(txOf(await escrow.release(mint, outsider.publicKey)), [keeper]), /BadWallet|Invalid payout wallet/);
    const pot = (await escrow.bounty(mint))!.potLamports;
    // Anyone can push the release (permissionless crank).
    await send(txOf(await escrow.release(mint, target.publicKey)), [outsider]);
    expect(BigInt(await conn.getBalance(target.publicKey))).toBe(pot);
    const b = await escrow.bounty(mint);
    expect(b!.status).toBe(OnchainStatus.PAID);
    expect(b!.potLamports).toBe(0n);
  }, 60_000);

  it("fees earned after payment keep flowing to the target", async () => {
    await trade(mint, "BUY", BigInt(LAMPORTS_PER_SOL));
    const r = await lp.claimAndDepositTx(mint, keeper.publicKey, 1n);
    await send(r!.tx, [keeper]);
    const before = BigInt(await conn.getBalance(target.publicKey));
    await send(txOf(await escrow.release(mint, target.publicKey)), [keeper]);
    expect(BigInt(await conn.getBalance(target.publicKey)) - before).toBe(potShare(r!.claimed));
  }, 60_000);

  it("Path 2: no wallet yet -> release waits -> wallet attested later -> paid", async () => {
    const m = await launch({ target: 2002n });
    await trade(m, "BUY", BigInt(LAMPORTS_PER_SOL));
    await send((await lp.claimAndDepositTx(m, keeper.publicKey, 1n))!.tx, [keeper]);
    await attestVerify(m, 55n, null, [verifiers[1], verifiers[2]], now() + 600, 2002n);
    await sleep(4000);
    const claimer = Keypair.generate();
    await expectFail(send(txOf(await escrow.release(m, claimer.publicKey)), [keeper]), /NoWallet|No payout wallet/);
    const expiry = now() + 600;
    const msg = escrow.walletMessage(m, 2002n, 55n, claimer.publicKey, expiry);
    const ixs = await escrow.assignWallet(m, claimer.publicKey, expiry, msg, [signMessage(msg, vsk(verifiers[0])), signMessage(msg, vsk(verifiers[1]))]);
    await send(txOf(...ixs), [keeper]);
    const pot = (await escrow.bounty(m))!.potLamports;
    await send(txOf(await escrow.release(m, claimer.publicKey)), [keeper]);
    expect(BigInt(await conn.getBalance(claimer.publicKey))).toBe(pot);
  }, 90_000);

  it("admin can freeze, unfreeze (window restarts) and cancel (bounty reopens, pot stays)", async () => {
    const m = await launch({ target: 3003n });
    await trade(m, "BUY", BigInt(LAMPORTS_PER_SOL));
    await send((await lp.claimAndDepositTx(m, keeper.publicKey, 1n))!.tx, [keeper]);
    await attestVerify(m, 66n, target.publicKey, [verifiers[0], verifiers[1]], now() + 600, 3003n);
    await expectFail(send(txOf(await escrow.admin("freeze", m, outsider.publicKey)), [outsider]), /ConstraintHasOne|has one|2001/);
    await send(txOf(await escrow.admin("freeze", m, keeper.publicKey)), [keeper]);
    await sleep(4000);
    await expectFail(send(txOf(await escrow.release(m, target.publicKey)), [keeper]), /BadStatus|current status/);
    await send(txOf(await escrow.admin("unfreeze", m, keeper.publicKey)), [keeper]);
    await expectFail(send(txOf(await escrow.release(m, target.publicKey)), [keeper]), /ChallengeWindowOpen|still open/);
    await send(txOf(await escrow.admin("freeze", m, keeper.publicKey)), [keeper]);
    const pot = (await escrow.bounty(m))!.potLamports;
    await send(txOf(await escrow.admin("cancel", m, keeper.publicKey)), [keeper]);
    const b = await escrow.bounty(m);
    expect(b!.status).toBe(OnchainStatus.OPEN);
    expect(b!.potLamports).toBe(pot);
    expect(b!.payoutWallet.equals(PublicKey.default)).toBe(true);
  }, 90_000);

  it("deadline: no verification after it; expiry sends the pot to the burn treasury", async () => {
    const m = await launch({ target: 4004n, deadlineInSec: 4 });
    await trade(m, "BUY", BigInt(LAMPORTS_PER_SOL));
    await send((await lp.claimAndDepositTx(m, keeper.publicKey, 1n))!.tx, [keeper]);
    await expectFail(send(txOf(await escrow.expire(m, treasury.publicKey)), [keeper]), /NotExpired|hasn't passed/);
    await sleep(7500);
    await expectFail(attestVerify(m, 88n, target.publicKey, [verifiers[0], verifiers[1]], now() + 600, 4004n), /DeadlinePassed|deadline has passed/);
    await expectFail(send(txOf(await escrow.expire(m, outsider.publicKey)), [keeper]), /ConstraintHasOne|has one|2001/);
    const pot = (await escrow.bounty(m))!.potLamports;
    const before = BigInt(await conn.getBalance(treasury.publicKey));
    await send(txOf(await escrow.expire(m, treasury.publicKey)), [outsider]);
    expect(BigInt(await conn.getBalance(treasury.publicKey)) - before).toBe(pot);
    expect((await escrow.bounty(m))!.status).toBe(OnchainStatus.EXPIRED);
  }, 90_000);

  it("opt-out needs 2 of 3 verifiers and burns the pot", async () => {
    const m = await launch({ target: 5005n });
    await trade(m, "BUY", BigInt(LAMPORTS_PER_SOL));
    await send((await lp.claimAndDepositTx(m, keeper.publicKey, 1n))!.tx, [keeper]);
    const expiry = now() + 600;
    const msg = escrow.optOutMessage(m, 5005n, expiry);
    await expectFail(send(txOf(...(await escrow.optOut(m, treasury.publicKey, expiry, msg, [signMessage(msg, vsk(verifiers[0]))]))), [keeper]), /NotEnoughSignatures|Not enough verifier/);
    const pot = (await escrow.bounty(m))!.potLamports;
    const before = BigInt(await conn.getBalance(treasury.publicKey));
    await send(txOf(...(await escrow.optOut(m, treasury.publicKey, expiry, msg, [signMessage(msg, vsk(verifiers[0])), signMessage(msg, vsk(verifiers[2]))]))), [keeper]);
    expect(BigInt(await conn.getBalance(treasury.publicKey)) - before).toBe(pot);
    expect((await escrow.bounty(m))!.status).toBe(OnchainStatus.OPTED_OUT);
  }, 90_000);

  it("nobody can drain a pot directly", async () => {
    const m = await launch({ target: 6006n });
    const b = EscrowClient.bountyPda(m);
    await send(txOf(await escrow.deposit(m, keeper.publicKey, 5_000_000n)), [keeper]);
    // A system transfer out of a program-owned account is impossible.
    await expectFail(send(txOf(SystemProgram.transfer({ fromPubkey: b, toPubkey: outsider.publicKey, lamports: 1 })), [outsider]), /signature|Signature|unknown signer|Missing/);
    await expectFail(send(txOf(await escrow.release(m, outsider.publicKey)), [outsider]), /BadStatus|current status/);
    await expectFail(send(txOf(await escrow.expire(m, treasury.publicKey)), [outsider]), /NotExpired|hasn't passed/);
  }, 60_000);
});
