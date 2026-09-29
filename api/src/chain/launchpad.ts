import BN from "bn.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import {
  ActivationType, BaseFeeMode, buildCurveWithMarketCap, CollectFeeMode, DynamicBondingCurveClient, MigrationFeeOption,
  MigrationOption, TokenAuthorityOption, TokenDecimal, TokenType, deriveDbcPoolAddress, getCurrentPoint, getPriceFromSqrtPrice, swapQuote,
  type ConfigParameters,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { EscrowClient } from "./escrow";

/**
 * Our launchpad settings on Meteora's Dynamic Bonding Curve (CLAUDE.md §4, §6.2).
 * These are PROPOSALS (CLAUDE.md §11 "Trading fee tier and DBC curve parameters"): the team
 * must confirm them before mainnet. Changing them means creating a new DBC config key.
 */
export const LAUNCHPAD = {
  totalSupply: 1_000_000_000,
  decimals: TokenDecimal.SIX,
  /** Market caps in SOL. Pools graduate to Meteora DAMM v2 at the migration cap. */
  initialMarketCapSol: 30,
  migrationMarketCapSol: 400,
  /** Anti-sniper: the trading fee starts high and decays to the base fee in the first minutes. */
  startingFeeBps: 5000,
  endingFeeBps: 100, // 1% trading fee after the first minutes
  feeDecayPeriods: 60,
  feeDecaySeconds: 120,
  /** Share of OUR 80% that Meteora pays straight to the coin creator (20% of 80% = the "creator 20%"). */
  creatorTradingFeePercentage: 20,
  /**
   * Of what we claim as partner (the remaining 80% of our 80%): pot 50 / platform 30 of the
   * original split, i.e. 5/8 of the claim goes into the bounty pot, 3/8 to the platform.
   */
  potShareOfPartnerClaim: { num: 5n, den: 8n },
} as const;

export function launchpadConfigParams(): ConfigParameters {
  return buildCurveWithMarketCap({
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: LAUNCHPAD.decimals,
      tokenQuoteDecimal: 9,
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: LAUNCHPAD.totalSupply,
      leftover: 0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerExponential,
        feeSchedulerParam: {
          startingFeeBps: LAUNCHPAD.startingFeeBps,
          endingFeeBps: LAUNCHPAD.endingFeeBps,
          numberOfPeriod: LAUNCHPAD.feeDecayPeriods,
          totalDuration: LAUNCHPAD.feeDecaySeconds,
        },
      },
      dynamicFeeEnabled: true,
      collectFeeMode: CollectFeeMode.QuoteToken, // every fee is paid in SOL
      creatorTradingFeePercentage: LAUNCHPAD.creatorTradingFeePercentage,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: true, // the creator's own first buy isn't hit by the sniper fee
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.FixedBps100,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
    },
    liquidityDistribution: {
      // After graduation the LP stays permanently locked with the platform, so its fees can keep
      // feeding the pot. DBC requires >= 10% locked at day 1.
      partnerPermanentLockedLiquidityPercentage: 100,
      partnerLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 0,
      creatorLiquidityPercentage: 0,
    },
    lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
    activationType: ActivationType.Timestamp,
    initialMarketCap: LAUNCHPAD.initialMarketCapSol,
    migrationMarketCap: LAUNCHPAD.migrationMarketCapSol,
  });
}

export const poolAddress = (dbcConfig: PublicKey, mint: PublicKey) => deriveDbcPoolAddress(NATIVE_MINT, mint, dbcConfig);

export function potShare(claimedLamports: bigint) {
  return (claimedLamports * LAUNCHPAD.potShareOfPartnerClaim.num) / LAUNCHPAD.potShareOfPartnerClaim.den;
}

export class Launchpad {
  readonly dbc: DynamicBondingCurveClient;
  readonly escrow: EscrowClient;
  constructor(readonly connection: Connection, readonly dbcConfig: PublicKey) {
    this.dbc = new DynamicBondingCurveClient(connection, "confirmed");
    this.escrow = new EscrowClient(connection);
  }

  /** One-time: create our DBC config. `feeClaimer` claims partner fees (the keeper). */
  async createConfigTx(configKeypair: Keypair, payer: PublicKey, feeClaimer: PublicKey) {
    return this.dbc.partner.createConfig({
      config: configKeypair.publicKey, feeClaimer, leftoverReceiver: feeClaimer, quoteMint: NATIVE_MINT, payer,
      ...launchpadConfigParams(),
    });
  }

  /**
   * The launch transaction: Meteora pool + our bounty, atomically (a coin can never exist
   * on-chain without its bounty). Fee payer and pool creator = the creator's wallet.
   * Returned partially signed by the new mint keypair; the creator's wallet signs the rest.
   */
  async launchTx(p: {
    creator: PublicKey; mint: Keypair; name: string; symbol: string; uri: string;
    targetXUserId: bigint; action: number; phraseHash: Uint8Array; deadline: number; firstBuyLamports?: bigint;
  }) {
    const pool = poolAddress(this.dbcConfig, p.mint.publicKey);
    const createParam = {
      name: p.name, symbol: p.symbol, uri: p.uri, payer: p.creator, poolCreator: p.creator,
      config: this.dbcConfig, baseMint: p.mint.publicKey,
    };
    const poolTx = p.firstBuyLamports && p.firstBuyLamports > 0n
      ? await this.dbc.creator.createPoolWithFirstBuy({
          createPoolParam: createParam,
          firstBuyParam: { buyer: p.creator, buyAmount: new BN(p.firstBuyLamports.toString()), minimumAmountOut: new BN(1), referralTokenAccount: null },
        })
      : await this.dbc.creator.createPool(createParam);
    const bountyIx = await this.escrow.createBounty({
      mint: p.mint.publicKey, pool, creator: p.creator, targetXUserId: p.targetXUserId,
      action: p.action, phraseHash: p.phraseHash, deadline: p.deadline,
    });
    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ...stripComputeBudget(poolTx.instructions),
      bountyIx,
    );
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = p.creator;
    tx.partialSign(p.mint);
    return { tx, pool };
  }

  async pool(mint: PublicKey) {
    const address = poolAddress(this.dbcConfig, mint);
    const state = await this.dbc.state.getPool(address);
    return state ? { address, state } : null;
  }

  private configCache: Awaited<ReturnType<DynamicBondingCurveClient["state"]["getPoolConfig"]>> = null;
  /** Our DBC config never changes once created, so it is read once. */
  async config() {
    if (!this.configCache) this.configCache = await this.dbc.state.getPoolConfig(this.dbcConfig);
    return this.configCache;
  }

  /**
   * Live market read of a pool: spot price (SOL per whole token, from the pool's sqrt price)
   * and progress toward graduation (quote reserve / migration threshold).
   */
  async market(mint: PublicKey) {
    const p = await this.pool(mint);
    if (!p) return null;
    const s = p.state.poolState;
    const price = Number(getPriceFromSqrtPrice(s.sqrtPrice, LAUNCHPAD.decimals, 9).toString());
    const cfg = await this.config();
    const threshold = cfg ? Number(cfg.migrationQuoteThreshold.toString()) : 0;
    const progress = s.isMigrated ? 1 : threshold > 0 ? Math.min(1, Number(s.quoteReserve.toString()) / threshold) : null;
    return { price, progress, migrated: !!s.isMigrated };
  }

  /**
   * Claim our partner fees for one pool and put the pot's share into its bounty, in ONE
   * transaction. The claim is capped at the amount we read, so the deposit always matches.
   */
  async claimAndDepositTx(mint: PublicKey, keeper: PublicKey, minClaimLamports: bigint) {
    const p = await this.pool(mint);
    if (!p) return null;
    const claimable = BigInt(p.state.poolState.partnerQuoteFee.toString());
    if (claimable < minClaimLamports) return null;
    const claimTx = await this.dbc.partner.claimPartnerTradingFee({
      feeClaimer: keeper, payer: keeper, pool: p.address, maxBaseAmount: new BN(0), maxQuoteAmount: new BN(claimable.toString()),
    });
    const pot = potShare(claimable);
    const tx = new Transaction().add(...claimTx.instructions, await this.escrow.deposit(mint, keeper, pot));
    tx.feePayer = keeper;
    return { tx, claimed: claimable, pot };
  }

  /** Buy (SOL -> coin) or sell (coin -> SOL) on the bonding curve. */
  async swapTx(p: { mint: PublicKey; owner: PublicKey; side: "BUY" | "SELL"; amountIn: bigint; slippageBps: number }) {
    const pool = await this.pool(p.mint);
    if (!pool) throw new Error("pool not found");
    if (pool.state.poolState.isMigrated) throw new Error("This coin graduated to Meteora DAMM v2; trade it there");
    const config = await this.config();
    if (!config) throw new Error("launchpad config not found");
    const swapBaseForQuote = p.side === "SELL";
    const currentPoint = await getCurrentPoint(this.connection, config.activationType);
    const quote = swapQuote(pool.state, config, swapBaseForQuote, new BN(p.amountIn.toString()), p.slippageBps, false, currentPoint, false);
    const tx = await this.dbc.pool.swap({
      owner: p.owner, pool: pool.address, amountIn: new BN(p.amountIn.toString()),
      minimumAmountOut: quote.minimumAmountOut, swapBaseForQuote, referralTokenAccount: null,
    });
    tx.feePayer = p.owner;
    return { tx, expectedOut: BigInt(quote.outputAmount.toString()), minimumOut: BigInt(quote.minimumAmountOut.toString()) };
  }
}

/** The SDK may add its own compute budget; we set one limit for the whole launch transaction. */
function stripComputeBudget(ixs: TransactionInstruction[]) {
  return ixs.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId));
}
