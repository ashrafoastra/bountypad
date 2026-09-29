import "dotenv/config";
import nacl from "tweetnacl";
import bs58 from "bs58";

const num = (v: string | undefined, d: number) => (v ? Number(v) : d);

const xToken = process.env.X_BEARER_TOKEN || "";
/** Alternative to the bearer token: the app's API Key + Secret ("consumer keys"); the API exchanges them for one. */
const xApiKey = process.env.X_API_KEY || "", xApiSecret = process.env.X_API_SECRET || "";
/**
 * "Log in with X" (OAuth 2.0 Authorization Code + PKCE, our own X app): the OAuth 2.0 Client ID +
 * Client Secret from developer.x.com → your app → Keys and tokens. Used to PROVE who a target is
 * when they claim, and to connect the platform's X account (launch posts, receipts).
 * Reading posts uses the app-only Bearer Token above (X refuses this pair for app-only reads).
 */
const xClientId = process.env.X_CLIENT_ID || "", xClientSecret = process.env.X_CLIENT_SECRET || "";
/** X reading: real as soon as X_BEARER_TOKEN (or X_API_KEY + X_API_SECRET) is set. X_MODE=mock forces the simulated X. */
const xMode: "mock" | "real" = process.env.X_MODE === "mock" || !(xToken || (xApiKey && xApiSecret)) ? "mock" : "real";
/** Which app-only credentials the API exchanges for a bearer when X_BEARER_TOKEN isn't set. */
const xConsumer = xApiKey && xApiSecret ? { key: xApiKey, secret: xApiSecret, kind: "api-key" as const } : undefined;
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
  /** SIM only: seed demo coins with background trading. Off by default: the site starts empty, like production. */
  simSeed: process.env.SIM_SEED === "true",
  xMode,
  chain,
  xBearer: xToken,
  xConsumer,
  /** Our X app's OAuth 2.0 client ("Log in with X" for claims + the platform account). */
  xOAuth: xClientId && xClientSecret ? {
    clientId: xClientId,
    clientSecret: xClientSecret,
    /** Must match a Callback URI in the X app settings EXACTLY. */
    callbackUrl: process.env.X_CALLBACK_URL || `${(process.env.PUBLIC_API_URL || `http://127.0.0.1:${num(process.env.PORT, 4000)}`).replace(/\/$/, "")}/api/auth/x/callback`,
  } : null,
  /** Sessions from "Log in with X" last this long. */
  sessionDays: num(process.env.SESSION_DAYS, 30),
  /** Safety cap for real-money testing: max SOL per buy (and per first buy). 0 = no cap. */
  maxBuySol: num(process.env.MAX_BUY_SOL, 0),
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
    /**
     * Where the pot waits until payout.
     *  "program": our escrow program (bounty terms on-chain, 2-of-3 verifier release). Needs the
     *             program deployed once (≈ 2 SOL of rent).
     *  "pool":    light mode. No program: the pot's fees stay unclaimed inside each coin's Meteora
     *             pool (only the keeper, the pool's fee claimer, can take them) and the keeper
     *             claims + pays the target in one transaction when they claim. Setup ≈ 0.02 SOL.
     */
    escrowMode: (process.env.ESCROW_MODE === "pool" ? "pool" : "program") as "program" | "pool",
    /** Fee claimer + transaction payer for jobs + burn treasury. The multisig on mainnet. */
    keeperSecret: process.env.KEEPER_SECRET_KEY || "",
    /** Escrow admin (freeze / unfreeze / cancel). Optional: without it admin actions need the multisig. */
    adminSecret: process.env.ESCROW_ADMIN_SECRET_KEY || "",
    /** Don't claim fees below this (a claim costs a transaction fee). */
    minClaimLamports: BigInt(process.env.KEEPER_MIN_CLAIM_LAMPORTS || "1000000"),
    keeperEverySec: num(process.env.KEEPER_EVERY_SEC, 60),
    syncEverySec: num(process.env.CHAIN_SYNC_EVERY_SEC, 15),
    /** Pool price samples for charts (catches trades made outside our site). */
    marketEverySec: num(process.env.MARKET_SAMPLE_EVERY_SEC, 20),
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
    /** Bio challenges: how often a target's profile is re-read (each read is billed by X). */
    bioCheckEverySec: num(process.env.BIO_CHECK_EVERY_SEC, demo ? 0 : 300),
    deadlineGraceSec: num(process.env.DEADLINE_GRACE_SEC, demo ? 10 : 15 * 60),
  },
};
