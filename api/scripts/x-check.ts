/**
 * Checks the X API credentials in api/.env with ONE user lookup (costs about $0.01).
 *   npm run x:check -w api -- elonmusk
 */
import "dotenv/config";
import { RealX } from "../src/x/real";

const handle = (process.argv[2] || "x").replace(/^@/, "");
const bearer = process.env.X_BEARER_TOKEN || "";
import { env } from "../src/env";
if (!bearer && !env.xConsumer) {
  console.error("\n✗ No X credentials in api/.env. Add X_BEARER_TOKEN=... (developer.x.com → your app → Keys and tokens → Bearer Token)\n");
  process.exit(1);
}
const x = new RealX(bearer, (process.env.X_FIELD_STYLE as "tweet" | "post") || "tweet", undefined, env.xConsumer);
console.log(`Using: ${bearer ? "X_BEARER_TOKEN" : "X_API_KEY + X_API_SECRET"}`);
x.lookupUser(handle)
  .then((u) => {
    if (!u) { console.log(`\n✓ Credentials work, but @${handle} doesn't exist.\n`); return; }
    console.log(`\n✓ X API works. @${u.username} = user id ${u.id} (${u.name})${u.protected ? ", private" : ""}${u.verified ? ", verified" : ""}`);
    console.log("  Restart the API: target lookups and post detection now use the real X.\n");
  })
  .catch((e) => { console.error(`\n✗ ${(e as Error).message}\n`); process.exit(1); });
