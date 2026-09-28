import "dotenv/config";
import nacl from "tweetnacl";
import bs58 from "bs58";

const num = (v: string | undefined, d: number) => (v ? Number(v) : d);

const xToken = process.env.X_BEARER_TOKEN || "";
/** X: real as soon as X_BEARER_TOKEN is set (X_MODE=mock forces the simulated X). */
const xMode: "mock" | "real" = process.env.X_MODE === "mock" || !xToken ? "mock" : "real";
/** Chain: "solana" = real launches/trades/escrow on SOLANA_RPC_URL; "sim" = simulated trades and payouts. */
const chain: "sim" | "solana" = process.env.CHAIN === "solana" ? "solana" : "sim";
/** Fully simulated (mock X + sim chain): demo data is seeded and reset on every start. */
const sim = xMode === "mock" && chain === "sim";
const demo = xMode === "mock";

function verifierKeys() {
  if (process.env.VERIFIER_SECRET_KEY) {
    return { main: process.env.VERIFIER_SECRET_KEY, backup: (process.env.VERIFIER_BACKUP_SECRET_KEY || null) as string | null };
  }
  if (chain === "solana") throw new Error("VERIFIER_SECRET_KEY is required when CHAIN=solana (run: npm run chain:setup -w api)");
  // Dev only: ephemeral keys so the 2-of-3 flow can be demoed end to end.
  const k1 = nacl.sign.keyPair(), k2 = nacl.sign.keyPair();
  return { main: bs58.encode(k1.secretKey), backup: bs58.encode(k2.secretKey) };
}
const keys = verifierKeys();
const pub = (sk: string) => bs58.encode(nacl.sign.keyPair.fromSecretKey(bs58.decode(sk)).publicKey);

export const env = {
  port: num(process.env.PORT, 4000),
  webOrigin: process.env.WEB_ORIGIN || "http://localhost:3000",
  databaseUrl: process.env.DATABASE_URL || "",
  sim,
  xMode,
  chain,
  xBearer: xToken,
  /** "tweet" = tweet.fields/referenced_tweets, "post" = post.fields/referenced_posts. Verify with Test C. */
  xFieldStyle: (process.env.X_FIELD_STYLE || "tweet") as "tweet" | "post",
  whisperUrl: process.env.WHISPER_URL || "",
  whisperKey: process.env.WHISPER_API_KEY || "",
  adminKey: process.env.ADMIN_KEY || (demo ? "dev-admin" : ""),
  /** Privy (https://dashboard.privy.io). Without these, login falls back to dev mode (SIM only). */
  privyAppId: process.env.PRIVY_APP_ID || "",
  privyAppSecret: process.env.PRIVY_APP_SECRET || "",
  /** Path 1: create a Privy wallet for a target's X account at payout time. Off until Test A passes. */
  privyPregenerate: process.env.PRIVY_PREGENERATE === "true",
  solUsd: num(process.env.SOL_USD, 150),
  /** Dev helpers (/api/dev/*: fake posts, sim wallets, airdrops). Never on a public deployment. */
  devTools: process.env.DEV_TOOLS ? process.env.DEV_TOOLS === "true" : xMode === "mock" || process.env.SOLANA_CLUSTER === "localnet",
  /** Public URL of this API, used in token metadata links written on-chain. */
  publicApiUrl: (process.env.PUBLIC_API_URL || `http://localhost:${num(process.env.PORT, 4000)}`).replace(/\/$/, ""),
  solana: {
    rpcUrl: process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    cluster: (process.env.SOLANA_CLUSTER || "devnet") as "localnet" | "devnet" | "mainnet-beta",
    /** Our Meteora DBC launchpad config key (created by chain:setup). */
    dbcConfig: process.env.DBC_CONFIG || "",
    /** Fee claimer + transaction payer for jobs + burn treasury. The multisig on mainnet. */
    keeperSecret: process.env.KEEPER_SECRET_KEY || "",
    /** Escrow admin (freeze / unfreeze / cancel). Optional: without it admin actions need the multisig. */
    adminSecret: process.env.ESCROW_ADMIN_SECRET_KEY || "",
    /** Don't claim fees below this (a claim costs a transaction fee). */
    minClaimLamports: BigInt(process.env.KEEPER_MIN_CLAIM_LAMPORTS || "1000000"),
    keeperEverySec: num(process.env.KEEPER_EVERY_SEC, 60),
    syncEverySec: num(process.env.CHAIN_SYNC_EVERY_SEC, 15),
  },
  verifier: {
    mainSecret: keys.main,
    backupSecret: keys.backup,
    allowedSigners: process.env.VERIFIER_ALLOWED_SIGNERS
      ? process.env.VERIFIER_ALLOWED_SIGNERS.split(",")
      : [keys.main, keys.backup].filter(Boolean).map((k) => pub(k as string)),
  },
  /** Job timings. With the simulated X (demo) everything is compressed so a run takes minutes, not days. */
  timing: {
    watchEverySec: num(process.env.WATCH_EVERY_SEC, demo ? 3 : 180),
    recheckAfterSec: num(process.env.RECHECK_AFTER_SEC, demo ? 20 : 24 * 3600),
    voteWindowSec: num(process.env.VOTE_WINDOW_SEC, demo ? 60 : 48 * 3600),
    challengeWindowSec: num(process.env.CHALLENGE_WINDOW_SEC, demo ? 20 : 48 * 3600),
    tradeSimEverySec: num(process.env.TRADE_SIM_EVERY_SEC, 2),
    /** A post made just before the deadline still counts if the watcher sees it within this grace. */
    deadlineGraceSec: num(process.env.DEADLINE_GRACE_SEC, demo ? 10 : 15 * 60),
  },
};
