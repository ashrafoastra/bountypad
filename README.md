# Bounty Pad

Solana meme coin launchpad where every coin carries a public challenge for someone on X. Trading fees fill a locked pot; the person named gets it only when they do the challenge, verified automatically. Read `CLAUDE.md` for the full brief.

## Run it (5 minutes, no keys needed)

Requires Node 20+.

```bash
npm install
npm run dev:api     # API on http://localhost:4000 (SIM MODE)
npm run dev:web     # web on http://localhost:3000   (second terminal)
cp web/.env.example web/.env.local   # first time only
```

With no `X_BEARER_TOKEN`, the API runs in **SIM MODE**:
- a mock X with fictional accounts (@novareyes, @jaxkimura, @alinamarsh, @theo_voss, @sofiaokafor, @bytezen, plus @lockedlena (private) and @novaparody (parody) to test rejections),
- simulated trades on a bonding curve (price, candles, pots) when you buy from a coin page or /dev,
- no demo coins: the site starts empty, like production. `SIM_SEED=true` in `api/.env` seeds a few coins with background trading for UI work,
- fake payouts with real 2-of-3 ed25519 signatures,
- compressed timers (recheck 20s, vote 60s, challenge window 20s),
- an embedded Postgres (PGlite), so no database install. The sim resets on every restart.

Open **/dev** in the web app to post as any fictional account, edit or delete posts, fast-forward timers and make bots vote.

### Try the full flow
1. `/launch`: create a coin targeting @alinamarsh with "Say it on video".
2. `/dev`: post as @alinamarsh, type Video, transcript "I am holding Moon coin" (exact = auto-approve) or something close (holder vote).
3. Watch the token page: detected → confirming → (vote) → verified → releasing.
4. `/claim`: log in as @alinamarsh, link a wallet, and the payout is sent.

## X: reading posts and "Log in with X"

One X app (developer.x.com) gives two different credentials. They do different jobs:

| Credential (developer.x.com → your app → Keys and tokens) | `api/.env` | Used for |
|---|---|---|
| **Bearer Token** (app-only) | `X_BEARER_TOKEN=` | Reading X: target lookups at launch, detecting the action, the 24h recheck. Pay-per-use credits. |
| **OAuth 2.0 Client ID + Client Secret** | `X_CLIENT_ID=` `X_CLIENT_SECRET=` | **"Log in with X"** on /claim (proves who a target is) and connecting the platform account that posts. |

Check reading with one lookup (about $0.01): `npm run x:check -w api -- elonmusk`.

### Set up the X app for "Log in with X" (once)
In developer.x.com → your app → **User authentication settings → Set up / Edit**:
1. **App permissions:** *Read and write* (claimants are only ever asked to *read* their profile; *write* is for the platform account's launch posts and receipts).
2. **Type of App:** *Web App, Automated App or Bot* (confidential client: we keep the secret on the server).
3. **Callback URI / Redirect URL** (must match EXACTLY, add both):
   - local: `http://127.0.0.1:4000/api/auth/x/callback`
   - production: `https://<your API domain>/api/auth/x/callback`
4. **Website URL:** your public site (any real `https://` URL works while testing).
5. Save. The API prints the callback it uses at startup (`X login: on (callback …)`); it must be one of the URIs above. Change it with `X_CALLBACK_URL=` if needed.

If the portal refuses `127.0.0.1`: add `127.0.0.1 bountypad.local` to `/etc/hosts`, register `http://bountypad.local:4000/api/auth/x/callback`, and set `X_CALLBACK_URL` to the same value.

How it works: /claim → **Log in with X** → x.com (the person approves *read profile*) → X sends them back to the API callback, which checks the state (CSRF) and PKCE verifier, asks X `GET /2/users/me` who they are, revokes the token (we keep nothing), and hands the site a one-time code → the site gets an httpOnly session cookie. Claims, payout wallets and opt-outs only trust that session. In production the API must be on the same site as the web app (e.g. `bountypad.xyz` + `api.bountypad.xyz`) so the cookie is sent.

### The platform account (launch posts + receipts)
Launches are announced by the platform's own X account (the post a "quote the launch post" challenge must quote), and verified challenges get a public receipt as a reply. Set `ADMIN_KEY=` (a long random string) in `api/.env`, start the API, run `npm run x:connect-platform -w api`, and open the printed link **while logged in to X as the platform account**. Until it's connected, "quote the launch post" is disabled and nothing is posted. Launch posts never @mention the target: people are only mentioned after they act.

### Check the detection logic against a real post
```bash
npm run x:verify -w api -- https://x.com/someone/status/1234567890 --handle someone --action TWEET_CASHTAG --ticker ABC
```
Prints the post as X returns it, every verification check, the watcher's exact search query and whether it finds the post, and the 24h recheck. A few reads (≈ $0.02–0.05). Also `--action TWEET_CONTRACT --mint <address>`, `--action QUOTE_LAUNCH --launch-post <id>`, `--launched <ISO time>`.

## Listing: real coins only, our coin first
- The site lists only real launches. Every new coin appears automatically; **Trending** sorts by SOL traded in the last 24h, so a coin that gets hyped rises by itself.
- Before going live, start from an empty database: stop the API, `npm run db:reset -w api -- --yes`.
- Launch the Bounty Pad coin through the site like any coin, then pin it above the market: `npm run admin -w api -- feature <mint or ticker>`.
- Remove a test or abusive coin from every list and page: `npm run admin -w api -- hide <mint or ticker>` (`unhide` to undo). Admin commands need `ADMIN_KEY`.

## Wallets (Privy)

Privy is only for **wallets** (Phantom, Solflare… or email with an auto-created wallet). The X identity never comes from Privy. Without Privy keys the app uses dev login: "Connect" gives you a simulated wallet.

1. Create an app at https://dashboard.privy.io. Login methods: **Wallet** and **Email**. Wallets: **Solana** (embedded wallets, create on login).
2. Allowed domains: add `http://localhost:3000` (and your production URL later).
3. `web/.env.local`: `NEXT_PUBLIC_PRIVY_APP_ID=...`. `api/.env`: `PRIVY_APP_ID=...` and `PRIVY_APP_SECRET=...` (the secret never goes in `web/`).
4. Restart both servers.

### Test A (Path 1: pay people before they ever log in)
```bash
npm run test:privy -w api -- your_x_handle
```
It creates (or finds) a Privy user tied to your X account with a Solana wallet and prints the address. Then log in on the site with that X account: if the account menu shows the **same** wallet, Test A passes. Set `PRIVY_PREGENERATE=true` in `api/.env`, and verified bounties then pay straight into a wallet tied to the target's X account.

## Real Solana (devnet)

The coin launch, trades, the locked pot and the payout run on Solana with `CHAIN=solana`. The X part can stay simulated (no X API key needed) so you can post as the target from **/dev**.

**One-time setup (about 10 minutes):**
1. Install the Solana CLI: `sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"`, then open a new terminal and check `solana --version`.
2. Make sure `programs/keys/bounty_escrow-keypair.json` exists (the escrow program's address key; ask the on-chain dev, never commit it).
3. `npm install` at the repo root.
4. `npm run chain:setup -w api`
   - The first run creates the platform keys in `api/.chain/devnet/` (never commit this folder) and prints the **keeper** address.
   - If it says the keeper needs SOL, get 5 devnet SOL for that address at https://faucet.solana.com, then run it again.
   - It deploys the escrow program, creates our Meteora launchpad config and the escrow config, and writes everything into `api/.env` (`CHAIN=solana`).
5. Restart both servers. The top bar shows **DEVNET · SIM X**.

**Using it:**
- Connect a wallet (Privy). With Phantom, turn on Settings → Developer settings → Testnet mode (devnet).
- Your wallet needs devnet SOL too (faucet.solana.com, or the "Get test SOL" button when dev tools are on).
- **Launch:** one signature creates the coin on Meteora's bonding curve **and** its challenge in the escrow program, in the same transaction.
- **Trade** on the coin page. The keeper claims trading fees every minute and locks the pot's share in the escrow ("Locked in escrow ↗" opens it on Solscan).
- **/dev:** post as the target. The pipeline verifies the post, the escrow verifies it on-chain with 2 of 3 signatures, and after the challenge window the pot is paid on-chain. If the target has no wallet yet, it waits until they log in on **/claim**.
- To go back to the full simulation: `CHAIN=sim` in `api/.env`.

**Real X:** see "X: reading posts and Log in with X" above.

**Tests:**
```bash
npm test -w api                              # 75 rule, lifecycle, market and X login tests (no chain needed)
programs/scripts/start-local-validator.sh    # terminal 2: local Solana with Meteora + escrow
npm run test:chain -w api                    # 13 on-chain escrow + Meteora tests
```
Full HTTP scenarios against a running API (localnet or devnet, simulated X): `npx tsx api/scripts/e2e-chain.ts`, `e2e-chain-2.ts` and `e2e-chain-3.ts`.

## Repo

| Folder | Owner | What's in it |
|---|---|---|
| `shared/` | all 3 | Types, API contract, rule defaults, fee split, validation, `idl/bounty_escrow.json`. **DRAFT** until the team approves. |
| `api/` | backend | Fastify API, Postgres schema, X adapter, verification pipeline, voting, payouts, jobs, simulator, `src/chain/` (Solana: launchpad, escrow client, keeper) |
| `web/` | frontend | Next.js app: home, launch, token (trade panel), vote, profile, claim, dev console |
| `programs/` | on-chain | `escrow/` Anchor program, `build/bounty_escrow.so`, `scripts/start-local-validator.sh` |
| `docs/` | all 3 | `decisions.md` (every rule, including the on-chain ones) |

### API layout
- `api/src/core/` pure rule logic, fully unit-tested: verifier, 24h recheck, search queries, phrase matching, vote tally, payout attestation, status machine.
- `api/src/services/` launch (sim + on-chain prepare/submit), pipeline (watch → recheck → vote → verify), payouts, `onchain.ts` (keeper fee claims, escrow sync, burns).
- `api/src/chain/` `launchpad.ts` (Meteora curve settings, launch transaction, fee claims, swaps), `escrow.ts` (program client), `attestation.ts` (the 131-byte message + ed25519 instruction), `service.ts`.
- `api/src/x/real.ts` X API v2 adapter. `api/src/sim/` mock X + simulator.

## Before mainnet
| Item | Owner |
|---|---|
| Move the program upgrade authority, escrow admin, fee claimer and treasury to the 2-of-3 Squads multisig | on-chain |
| Backup verifier as a separate service (today both verifier keys run in the API) | backend |
| Confirm the fee split, curve and anti-sniper numbers (docs/decisions.md) | all 3 |
| Fee claimer = program PDA (trustless Test B) instead of the keeper | on-chain |
| Buy-and-burn for coins that graduated to DAMM v2; claim DAMM v2 LP fees into pots | on-chain + backend |
| Publish the launch post on X (needed for quote challenges) and the Whisper service for videos | backend |
| External audit, bug bounty, capped launch (CLAUDE.md §8) | all 3 |
