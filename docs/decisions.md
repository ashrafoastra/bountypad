# Decisions log

One line per decision, newest first. Anything marked PROPOSED needs all 3 to agree.

| Date | Decision | Status |
|---|---|---|
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
