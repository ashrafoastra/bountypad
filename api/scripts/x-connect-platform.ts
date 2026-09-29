/**
 * Connect the platform's own X account (the one that posts launch announcements and receipts).
 * The API must be running. Open the printed link while logged in to X AS THE PLATFORM ACCOUNT.
 *
 *   npm run x:connect-platform -w api
 */
import "dotenv/config";

const api = (process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/$/, "");
const key = process.env.ADMIN_KEY || "";
(async () => {
  if (process.argv.includes("--status")) {
    const b: any = await (await fetch(`${api}/api/admin/x/platform`, { headers: { "x-admin-key": key } })).json();
    console.log(b.connected ? `\n✓ Connected: @${b.account.username}\n` : `\n${b.error ?? "Not connected yet."}\n`);
    return;
  }
  if (!key) throw new Error("Set ADMIN_KEY in api/.env (any long random string), restart the API, then run this again.");
  const r = await fetch(`${api}/api/admin/x/platform/start`, { method: "POST", headers: { "x-admin-key": key } });
  const b: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b.error ?? `API ${r.status}`);
  console.log(`\nOpen this link while logged in to X as the platform account (e.g. @bountypad):\n\n  ${b.url}\n`);
  console.log(`X will send you back to ${b.callback}. Then check: npm run x:connect-platform -w api -- --status\n`);
})().catch((e) => { console.error(`\n✗ ${(e as Error).message}\n`); process.exit(1); });

