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
- simulated trades that fill pots,
- fake payouts with real 2-of-3 ed25519 signatures,
- compressed timers (recheck 20s, vote 60s, challenge window 20s),
- an embedded Postgres (PGlite), so no database install. The sim resets on every restart.

Open **/dev** in the web app to post as any fictional account, edit or delete posts, fast-forward timers and make bots vote.

### Try the full flow
1. `/launch`: create a coin targeting @alinamarsh with "Say it on video".
2. `/dev`: post as @alinamarsh, type Video, transcript "I am holding Moon coin" (exact = auto-approve) or something close (holder vote).
3. Watch the token page: detected → confirming → (vote) → verified → releasing.
4. `/claim`: log in as @alinamarsh, link a wallet, and the payout is sent.

## Repo

| Folder | Owner | What's in it |
|---|---|---|
| `shared/` | all 3 | Types, API contract, rule defaults (`config.ts`), fee split, validation. **DRAFT** until the team approves. |
| `api/` | backend | Fastify API, Postgres schema, X adapter, verification pipeline, voting, payouts, jobs, simulator |
| `web/` | frontend | Next.js app: home, launch, token, vote, profile, claim, dev console |
| `programs/` | on-chain | Empty. Escrow program comes next (see below). |
| `docs/` | all 3 | `decisions.md` |

### API layout
- `api/src/core/` pure rule logic, fully unit-tested: verifier, 24h recheck, search queries, phrase matching, vote tally, payout attestation, status machine.
- `api/src/services/` launch, pipeline (watch → recheck → vote → verify), payouts.
- `api/src/x/real.ts` X API v2 adapter. `api/src/sim/` mock X + simulator.
- `api/src/adapters.ts` pluggable edges: video transcription (Whisper), holder snapshots, on-chain payout executor.

```bash
npm test            # 28 rule tests
npm run typecheck
```

## Real mode

Set in `api/.env` (see `api/.env.example`): `X_BEARER_TOKEN`, `DATABASE_URL`, `VERIFIER_SECRET_KEY`, `VERIFIER_ALLOWED_SIGNERS`, `WHISPER_URL`. Real mode still needs these pieces before it can run end to end:

| Missing piece | Owner | Status |
|---|---|---|
| Escrow program (hold pot, verify 2-of-3 ed25519 attestation, release, burn) | on-chain | not started; attestation byte format is fixed in `api/src/core/payout.ts` |
| Meteora DBC launch from the web (creates the mint) | on-chain + frontend | API accepts `mint` in REAL mode |
| Keeper claiming DBC partner fees into pots | on-chain + backend | sim adds pot on each trade |
| Holder snapshots from chain (exclude pool/creator/platform) | backend | `HolderSource` interface ready |
| Privy "Log in with X" + embedded wallet | frontend + backend | blocked on Test A |
| Launch post from the @BountyPad account (for quote bounties) | backend | disabled in REAL mode |
