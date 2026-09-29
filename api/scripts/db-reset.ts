/**
 * Wipe the LOCAL embedded database (api/.data/pg): every coin, trade, profile and session.
 * For a clean start before going live. Stop the API first. Uploaded images are kept.
 * Refuses to run against a real Postgres (DATABASE_URL): do that on purpose, by hand.
 *
 *   npm run db:reset -w api -- --yes
 */
import "dotenv/config";
import { rmSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.DATABASE_URL) { console.error("✗ DATABASE_URL is set: not wiping a real Postgres from a script."); process.exit(1); }
if (!process.argv.includes("--yes")) { console.error("This deletes every coin in the local database. Run again with --yes (stop the API first)."); process.exit(1); }
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.data/pg");
if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
console.log("✓ Local database wiped. Start the API: it recreates an empty one.");
