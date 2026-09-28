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
