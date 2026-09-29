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

## Log in and wallets (Privy)

Without Privy keys the app uses **dev login**: "Connect" gives you a simulated wallet, and the Claim page lets you pick a simulated X account.

To use real wallets and real "Log in with X":
1. Create an app at https://dashboard.privy.io.
2. Login methods: turn on **Wallet**, **X (Twitter)** and **Email**. Wallets: turn on **Solana** (embedded wallets, create on login).
3. Allowed domains: add `http://localhost:3000` (and your Vercel URL later).
4. Put the **App ID** in `web/.env.local` as `NEXT_PUBLIC_PRIVY_APP_ID=...`
5. Put the **App ID** and **App Secret** in `api/.env` as `PRIVY_APP_ID=...` and `PRIVY_APP_SECRET=...` (the secret never goes in `web/`).
6. Restart both servers.

In SIM mode with Privy on, logging in with your real X account adds it to the simulator, so you can launch a coin targeting yourself, post as yourself in **/dev**, and claim the payout to your Privy wallet.

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

**Real X:** in developer.x.com → your app → **Keys and tokens**, generate the **Bearer Token** and put it in `api/.env` as `X_BEARER_TOKEN=...` (or put the **API Key** and **API Key Secret** as `X_API_KEY` / `X_API_SECRET`). If you only have the OAuth 2.0 **Client ID / Client Secret**, put them as `X_CLIENT_ID` / `X_CLIENT_SECRET`: the API tries them the same way and `x:check` tells you at once whether X accepts them for reading (X documents that pair for user login; if it's refused, generate the Bearer Token in the SAME app, which uses the same credits). Then check it with one lookup (about $0.01): `npm run x:check -w api -- elonmusk`. The API is pay-per-use, so the account needs credits in the developer console. Note: the OAuth 2.0 **Client ID / Client Secret** are for "Log in with X", not for reading posts; they can go in Privy (Login methods → X → use your own credentials) if you want the X login screen to show your app's name.

**Tests:**
```bash
npm test -w api                              # 59 rule + lifecycle tests (no chain needed)
programs/scripts/start-local-validator.sh    # terminal 2: local Solana with Meteora + escrow
npm run test:chain -w api                    # 12 on-chain escrow + Meteora tests
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
