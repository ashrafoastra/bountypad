# Decisions log

One line per decision, newest first. Anything marked PROPOSED needs all 3 to agree.

| Date | Decision | Status |
|---|---|---|
| 2026-09-28 | Login is Privy: Solana wallet, X, or email with an embedded Solana wallet. The API reads X accounts only from Privy's verified linked twitter_oauth account, never from the client. | Built |
| 2026-09-28 | Path 1 uses Privy `users().getByTwitterSubject` / `users().create` (twitter_oauth account + Solana wallet). Behind `PRIVY_PREGENERATE` until Test A passes. | Built, pending Test A |
| 2026-09-28 | Coin creators can't vote on their own coin (creator wallet excluded from the snapshot). | Agreed (CLAUDE.md §6.5) |
| 2026-09-28 | A rejected detection (deleted, edited, failed vote, no quorum) reopens the bounty; the pot stays locked. Nothing is paid to holders or voters. | Agreed (CLAUDE.md §6.2) |
| 2026-09-28 | Only one active detection per bounty at a time. The watcher only watches `OPEN` bounties. | PROPOSED |
| 2026-09-28 | Payout amount is fixed when the challenge window opens. Fees after that go to the pot but not to this payout. | PROPOSED: on-chain team to confirm |
| 2026-09-28 | If the target has no wallet when the challenge window ends, payout status becomes `AWAITING_CLAIM` (Path 2) until they log in with X. | PROPOSED (added to `shared/types.ts`) |
| 2026-09-28 | Vote snapshot is taken at detection, excluding the creator wallet. Pool/curve and platform wallets must also be excluded once real snapshots exist. | Agreed (CLAUDE.md §6.5) |
| 2026-09-28 | Vote weight cap uses 5% of eligible supply; quorum is measured on raw (uncapped) balances of voters; pass is measured on capped weights. | PROPOSED |
| 2026-09-28 | Payout attestation bytes: `bountypad:payout:v1\|bountyId\|targetXUserId\|postId\|payoutWallet\|amountLamports\|expiry`, ed25519. The escrow program must rebuild exactly this. | PROPOSED: on-chain team to confirm |
| 2026-09-28 | Vote message: `Bounty Pad vote\nround:<id>\nchoice:<YES\|NO>`, signed with the wallet (gasless). | PROPOSED |
| 2026-09-28 | Video bounties need a phrase of at least 2 words. | PROPOSED |
| 2026-09-28 | Quote bounties are disabled in REAL mode until the @BountyPad account can publish launch posts. | Temporary |

## Tests to run before REAL mode

- **Test A (Privy):** create a Privy user with an X linked account + pregenerated Solana wallet server-side, then log in with that X account and confirm the same wallet. Decides Path 1 vs Path 2.
- **Test B (Meteora DBC):** can `feeClaimer` be a program PDA? If not, claim to the multisig and have the keeper deposit into each pot.
- **Test C (X API field names):** X's current OpenAPI spec lists `post.fields` / `referenced_posts`, while most live integrations use `tweet.fields` / `referenced_tweets`. Make one real call to `GET /2/tweets/:id` and set `X_FIELD_STYLE` accordingly. The parser already accepts both.
- **Test D (X API cost):** confirm whether empty search results are billed, to size the watcher interval.

## Logic audit (2026-09-28)

Full lifecycle is covered by `api/test/flow.test.ts` (runs on an in-memory database, `npm test -w api`).

| Decision | Why |
|---|---|
| A coin and its bounty are written in **one database transaction** | A coin without a bounty can never exist, even if the server crashes mid-launch. |
| Only **one live cashtag challenge per ticker + target** | One tweet of `$ROCKET` could otherwise settle two pots. Contract and video bounties are unique per coin, so they're unaffected. |
| Posts must be made **before the deadline** (new `BEFORE_DEADLINE` check); the watcher keeps looking for a **grace period** after it (15 min real, 10 s SIM) | A post made one minute before the deadline still counts even if the watcher sees it a little later. Posts after the deadline never count. |
| The payout is **the whole pot at release time** | Fees earned during the 48h challenge window go to the target too, not left orphaned. |
| Admins can **unfreeze** (restart the challenge window) or **cancel** a frozen payout (bounty reopens, pot stays locked) | Freezing used to be a dead end. |
| Payout and voter wallets must be valid Solana addresses | Prevents funds being sent to a typo. |
| Opting out also **cancels pending detections and votes** | Otherwise jobs kept running on an opted-out bounty. |
| Every status change is **conditional on the current status** | Two jobs racing (e.g. recheck vs opt-out) can't both move a bounty; the loser fails safely. |
| Jobs re-check the bounty's status before acting | A vote closing on an already-frozen or opted-out bounty is cancelled, not applied. |
| Video phrase score = the lower of (sequence similarity, how much of the phrase's words were actually spoken) | Character similarity alone scored random speech ~30-50%, sending unrelated videos to a vote. "I am going to the gym" vs "I am holding Jax coin" now scores 18 (auto-reject). Transcripts' "im"/"I'm" count as "I am". |
| `shared/types.ts`: `BEFORE_DEADLINE` check id, `CANCELLED` vote result | **Needs approval from all 3** (contract change). |

## On-chain build (2026-09-29)

Escrow program `programs/escrow` (Anchor 0.32.1), program id `BPADDJVZ2YAYgBG1hngg7a6YL5KPYaicKyzbk7AjRQ1Y`. Meteora DBC `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN` (same id on devnet and mainnet). Tested on a local validator running the real Meteora program built from its source: `npm run test:chain -w api` (12 program tests) and `api/scripts/e2e-chain*.ts` (3 full HTTP scenarios).

| Decision | Why |
|---|---|
| One `Bounty` account per coin (PDA of the mint) holds the pot in lamports | Nobody but the program can move it. No token accounts needed: fees are paid in SOL. |
| The launch is ONE transaction: Meteora pool + `create_bounty` | A coin can never exist on-chain without its challenge. `create_bounty` checks the pool is a real Meteora pool made with OUR config, for this mint, by this creator. |
| Terms (target X user id, action, sha256 of the phrase, deadline) written once, never editable | CLAUDE.md §6.1.6. The API re-checks them against the prepared launch before recording the coin. |
| `verify` needs 2 of 3 ed25519 attestations (main, backup, admin key) over a 131-byte message (`BOUNTYPAD1`, kind, program, bounty, target, post, wallet, expiry) | CLAUDE.md §6.6. Checked with Solana's ed25519 program + instruction introspection; only signatures whose data sits inside the ed25519 instruction count. Duplicate signers count once. |
| Release is permissionless after the on-chain challenge window, only to the attested wallet | Anyone (our keeper, or the target) can push it; nobody can redirect it. |
| Path 2: `verify` with no wallet, then `assign_wallet` (2 of 3) when the target logs in | The pot waits in the escrow, not with us. |
| Fees that arrive after payment go to the same target; after expiry / opt-out to the burn treasury | A settled bounty still earns; unverified pots never reach holders (§6.2). |
| Expiry on-chain = deadline + grace, grace = recheck + 2 × vote window + 1h | A post made before the deadline can still finish its 24h recheck and a vote (plus extension) and be verified. The API still rejects posts made after the deadline. |
| Expired / opted-out pots: swept to the treasury, keeper buys the coin on the curve and burns it | §6.2 "burned". Graduated coins (DAMM v2) are logged for a manual buy for now. |
| **Test B result: keeper fallback.** The keeper (DBC fee claimer) claims partner fees and deposits 5/8 into the escrow **in the same transaction**, capped at the amount it read | The deposit always matches the claim. The fully trustless version (fee claimer = program PDA via CPI) is a later upgrade. |
| Fee split on-chain: `creatorTradingFeePercentage = 20` (Meteora pays the creator directly), the partner claim is split pot 5/8, platform 3/8 | Equals the 50 / 30 / 20 of our 80% (§6.2). Proposal: confirm before mainnet. |
| Launchpad curve (PROPOSAL): 1B supply, 6 decimals, 30 → 400 SOL market cap, graduates to DAMM v2, LP 100% permanently locked with the platform | §11 open decision. Locked LP keeps earning fees after graduation. |
| Anti-sniper: exponential fee scheduler 50% → 1% over 120 s; the creator's first buy in the launch transaction pays the low fee | Meteora deprecated the rate limiter for new configs (SDK 1.5), so the fee scheduler is the tool. Proposal: tune. The UI shows the current fee. |
| The database is the brain, the chain is the executor: `syncBounties` pushes verify / freeze / unfreeze / cancel / opt-out / expire to the escrow and reads the real pot back | One status machine (already tested), mirrored on-chain; one action per coin at a time. |
| The API builds transactions, the user's wallet signs, the API sends | No RPC needed in the browser; the API checks the signed message is exactly the one it prepared. |
| Program upgrade authority, escrow admin, fee claimer and burn treasury = the keeper key on devnet | MUST move to the 2-of-3 Squads multisig before mainnet (§4). |
| X and chain are separate switches: `X_BEARER_TOKEN` → real X; `CHAIN=solana` → real Solana | Real X can be tested with the simulated chain and the other way round. |
| `shared/` changes: Token.pool/launchTx/escrow, Health, PreparedLaunch/PreparedTrade, feed events POT_FUNDED / POT_BURNED, launch `firstBuySol` | **Needs approval from all 3.** |

## Design + images (2026-09-29)

| Decision | Why |
|---|---|
| Light, simple UI in the OpenSea / Rarible school; one yellow accent; status colours only | Owner's direction: the dark neon look felt "AI". Content (coin images, pots) carries the page. |
| Every coin needs an image (API rejects launches without `imageUrl`) | Coins are shown like NFTs; the image is also the on-chain metadata image. |
| Images uploaded to the API (`POST /api/uploads`, PNG/JPG/WebP/GIF, 2 MB, checked by magic bytes), stored by sha256 on disk (`UPLOAD_DIR`), served immutable at `/api/files/:name` | Simple and permanent links. On multi-server hosting, move to S3/R2. |
| X credentials: `X_BEARER_TOKEN`, or `X_API_KEY` + `X_API_SECRET` exchanged for one; `npm run x:check -w api` | The OAuth 2.0 Client ID/Secret can't read posts (they're for user login). |
| Own logo (coin + target + check on black); the earlier yellow-square letter mark was dropped | Too close to Rarible's identity. |

## Market data, charts, dark direction (2026-09-29)

| Decision | Why |
|---|---|
| Design direction replaced: dark, square, hairline grid, Geist (jtx.com school). See CLAUDE.md §7 | Owner: the light version and the cartoon demo logos looked "for kids". |
| No demo coins by default. `SIM_SEED=true` seeds demo coins (abstract generated images, `/api/placeholder/:seed`) for local UI work only | Nobody has launched yet; a fake market or "trending" list would be dishonest. |
| Site positioning: "Others pay for nothing. We pay for the action." with a dated, factual comparison to fee-routing launchpads (UsePaid) | Owner's positioning vs UsePaid. |
| Every price is stored in `price_ticks` (SOL per whole token): each trade we relay, the launch price, and a keeper sample of every pool on the curve every `MARKET_SAMPLE_EVERY_SEC` (default 20s, only when the price moved) | Trades made outside our site (Jupiter, bots) move the pool too; charts must match the chain. |
| On-chain price = Meteora's pool `sqrtPrice` (SDK `getPriceFromSqrtPrice`, 6 / 9 decimals); curve progress = `quoteReserve / migrationQuoteThreshold` | Read from the pool account, no third-party price feed. |
| Candles are built in SQL per timeframe (1m…1d); each candle opens at the previous close; volume in SOL | Standard exchange convention; no gaps between candles. |
| SIM chain uses a constant-product curve with virtual reserves (30 SOL / 1.073B tokens, graduation 85 SOL) and never sells more than a wallet holds | Believable prices and holder balances in the simulation. Real coins use Meteora's curve. |
| X: `X_CLIENT_ID` / `X_CLIENT_SECRET` are accepted as a last resort for the app-only token exchange; the API checks them at startup and says clearly if X refuses | The owner's credits are on that app; the Bearer Token of the same app is the documented way and uses the same credits. |
| `shared/` changes: `TokenSummary.market` (`MarketStats`), `Trade.tokenAmount` / `priceSol`, `TokenChart`, `Candle`, `ChartTimeframe`, `GET /api/tokens/:id/chart` | **Needs approval from all 3.** |
