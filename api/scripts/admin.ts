/**
 * Listing admin (the API must be running; uses ADMIN_KEY from api/.env).
 *   npm run admin -w api -- feature <mint | ticker | id>     pin the platform's own coin above the market
 *   npm run admin -w api -- unfeature <…>
 *   npm run admin -w api -- hide <…>                         remove a test / abusive coin from every list and page
 *   npm run admin -w api -- unhide <…>
 */
import "dotenv/config";

const [action, id] = process.argv.slice(2);
const api = (process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/$/, "");
if (!["feature", "unfeature", "hide", "unhide"].includes(action) || !id) {
  console.error("Usage: npm run admin -w api -- feature|unfeature|hide|unhide <mint | ticker | id>");
  process.exit(1);
}
fetch(`${api}/api/admin/tokens/${encodeURIComponent(id)}/${action}`, { method: "POST", headers: { "x-admin-key": process.env.ADMIN_KEY || "" } })
  .then(async (r) => { const b: any = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.error ?? `API ${r.status}`); for (const t of b) console.log(`✓ $${t.ticker}: featured=${t.featured} hidden=${t.hidden}`); })
  .catch((e) => { console.error(`✗ ${(e as Error).message}`); process.exit(1); });
