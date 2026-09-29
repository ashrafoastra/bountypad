/**
 * Prints the values to paste into Render (API service → Environment → "Add from .env"),
 * read from YOUR api/.env. Contains private keys: paste them only into Render, never in chat.
 *   npm run render:env -w api -- https://bountypad-web.onrender.com
 */
import "dotenv/config";

const site = (process.argv[2] || "").replace(/\/$/, "");
if (!/^https:\/\//.test(site)) { console.error("Usage: npm run render:env -w api -- https://<your web service URL>"); process.exit(1); }
const keys = ["X_BEARER_TOKEN", "X_CLIENT_ID", "X_CLIENT_SECRET", "DBC_CONFIG", "KEEPER_SECRET_KEY", "ESCROW_ADMIN_SECRET_KEY",
  "VERIFIER_SECRET_KEY", "VERIFIER_BACKUP_SECRET_KEY", "VERIFIER_ALLOWED_SIGNERS", "CHALLENGE_WINDOW_SEC", "PRIVY_APP_ID", "PRIVY_APP_SECRET"];
const missing = keys.filter((k) => !process.env[k]);
console.log(`\n# ---- bountypad-api (paste into Render → bountypad-api → Environment → Add from .env) ----`);
console.log(`WEB_ORIGIN=${site}\nPUBLIC_API_URL=${site}`);
for (const k of keys) if (process.env[k]) console.log(`${k}=${process.env[k]}`);
console.log(`\n# ---- bountypad-web ----\nNEXT_PUBLIC_PRIVY_APP_ID=${process.env.PRIVY_APP_ID ?? ""}\nNEXT_PUBLIC_SITE_URL=${site}`);
console.log(`\n# X app → User authentication settings → Callback URI:\n#   ${site}/api/auth/x/callback`);
console.log(`# Privy dashboard → Allowed domains: ${site}\n`);
if (missing.length) console.error(`Missing in api/.env: ${missing.join(", ")}`);
