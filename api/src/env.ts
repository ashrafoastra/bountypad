import "dotenv/config";
import nacl from "tweetnacl";
import bs58 from "bs58";

const num = (v: string | undefined, d: number) => (v ? Number(v) : d);

const xToken = process.env.X_BEARER_TOKEN || "";
/** Simulation mode: mock X, simulated trades, fake payouts. On by default until real keys exist. */
const sim = process.env.SIM_MODE ? process.env.SIM_MODE === "true" : !xToken;

function verifierKeys() {
  if (process.env.VERIFIER_SECRET_KEY) {
    return { main: process.env.VERIFIER_SECRET_KEY, backup: null as string | null };
  }
  if (!sim) throw new Error("VERIFIER_SECRET_KEY is required outside SIM_MODE");
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
  xBearer: xToken,
  /** "tweet" = tweet.fields/referenced_tweets, "post" = post.fields/referenced_posts. Verify with Test C. */
  xFieldStyle: (process.env.X_FIELD_STYLE || "tweet") as "tweet" | "post",
  whisperUrl: process.env.WHISPER_URL || "",
  whisperKey: process.env.WHISPER_API_KEY || "",
  adminKey: process.env.ADMIN_KEY || (sim ? "dev-admin" : ""),
  solUsd: num(process.env.SOL_USD, 150),
  verifier: {
    mainSecret: keys.main,
    backupSecret: keys.backup,
    allowedSigners: process.env.VERIFIER_ALLOWED_SIGNERS
      ? process.env.VERIFIER_ALLOWED_SIGNERS.split(",")
      : [keys.main, keys.backup].filter(Boolean).map((k) => pub(k as string)),
  },
  /** Job timings. In SIM mode everything is compressed so a demo takes minutes, not days. */
  timing: {
    watchEverySec: num(process.env.WATCH_EVERY_SEC, sim ? 3 : 180),
    recheckAfterSec: num(process.env.RECHECK_AFTER_SEC, sim ? 20 : 24 * 3600),
    voteWindowSec: num(process.env.VOTE_WINDOW_SEC, sim ? 60 : 48 * 3600),
    challengeWindowSec: num(process.env.CHALLENGE_WINDOW_SEC, sim ? 20 : 48 * 3600),
    tradeSimEverySec: num(process.env.TRADE_SIM_EVERY_SEC, 2),
  },
};
