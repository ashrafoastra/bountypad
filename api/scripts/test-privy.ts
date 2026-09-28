// TEST A (CLAUDE.md §9): can we create a Privy wallet for an X account before that person logs in?
//
// Usage (from the repo root, with PRIVY_APP_ID and PRIVY_APP_SECRET in api/.env):
//   npm run test:privy -w api -- <your_x_handle>
//
// Then log in on the web app with that same X account. If the wallet shown in the app's
// account menu matches the address printed here, Test A PASSES: set PRIVY_PREGENERATE=true.
import "dotenv/config";
import { PrivyGateway } from "../src/privy";

const handle = (process.argv[2] ?? "").replace(/^@/, "");
const { PRIVY_APP_ID, PRIVY_APP_SECRET, X_BEARER_TOKEN } = process.env;
if (!handle || !PRIVY_APP_ID || !PRIVY_APP_SECRET) {
  console.error("Usage: npm run test:privy -w api -- <x_handle>   (needs PRIVY_APP_ID + PRIVY_APP_SECRET in api/.env)");
  process.exit(1);
}

async function xUserId(): Promise<{ id: string; name: string }> {
  // With an X API token we look up the real numeric ID; otherwise ask for it.
  if (X_BEARER_TOKEN) {
    const r = await fetch(`https://api.x.com/2/users/by/username/${handle}`, { headers: { Authorization: `Bearer ${X_BEARER_TOKEN}` } });
    const b: any = await r.json();
    if (b?.data?.id) return { id: b.data.id, name: b.data.name };
  }
  const id = process.env.X_USER_ID;
  if (!id) {
    console.error(`No X API token set. Find your numeric X user ID (e.g. tweeterid.com) and run:\n  X_USER_ID=123456 npm run test:privy -w api -- ${handle}`);
    process.exit(1);
  }
  return { id, name: handle };
}

const x = await xUserId();
const privy = new PrivyGateway(PRIVY_APP_ID, PRIVY_APP_SECRET);
const wallet = await privy.walletForX({ id: x.id, username: handle, name: x.name });
console.log(`\nX account:  @${handle} (id ${x.id})`);
console.log(`Privy wallet: ${wallet}\n`);
console.log("Now log in on the web app with this X account and open the account menu.");
console.log("Same address = Test A passes (Path 1 works). Different or new wallet = use Path 2.");
