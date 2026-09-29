# Bounty Pad: Project Brief for Claude Code

> Working name: **Bounty Pad**. Status: app + escrow program built and tested on a local Solana validator; devnet deploy with `npm run chain:setup -w api`. Last updated: 2026-09-29.
> Read this whole file before doing anything. It is the single source of truth for what we are building.
> If something you are asked to do contradicts this file, stop and ask.

---

## 1. What we are building (one paragraph)

Bounty Pad is a **Solana meme coin launchpad** where every token is launched **with a bounty aimed at a public figure on X (Twitter)**. Trading fees from the token accumulate in a locked pot. The pot is paid to that public figure **only after they complete a specific, publicly verifiable action** (for example: post a tweet containing the token's cashtag, quote the token's launch tweet, or post a video saying a required phrase). Detection and verification are **automatic**: our system watches X, verifies the action, and releases the fees without anyone submitting anything. Every coin becomes a public challenge ("Will Elon say it? Pot: $12,000"), which is our growth engine.

---

## 2. Why we exist: we are a direct competitor to UsePaid ("Paid")

**Competitor:** UsePaid, https://usepaid.app (X: @UsePaid). Docs: https://usepaid.app/docs

**How UsePaid works (as of 2026-09-28):**
- A token deployer launches on pump.fun and points 100% of the token's creator fees at the UsePaid treasury, permanently (pump.fun fee sharing + revoked authority).
- The token description names an X handle ("Fees to @handle via UsePaid").
- UsePaid claims fees on a schedule, sends SOL to **Kraken**, converts to USD, funds the **@UsePaid X Money balance**, and pays the recipient **through X Money**. A payout worker holds a security key to auto-approve X Money sends.
- Split: **80% to the X recipient, 20% protocol** (execution costs, then buy and burn of $PAID).
- The recipient does nothing. No signup, no consent. Money just arrives, and @UsePaid replies publicly with a receipt. That is why it went viral (Elon Musk's profile shows about $178K received across 771 tokens).
- pons.family (Robinhood Chain) support is announced but **not live**.
- Their token **$PAID**: `98kfF7rmsg1QDUEoCqNE7g7M1FdrTt92TEp2CLzypump` (pump.fun, Solana). On 2026-09-28: ~$0.0285, ~$26.8M market cap, ~$12.4M 24h volume on its main PumpSwap pool, created ~2026-09-16. Note: their own $PAID page still says "not launched yet" (stale).

**UsePaid's weaknesses = our advantages:**

| UsePaid weakness | Bounty Pad answer |
|---|---|
| Depends 100% on X Money, and **X Money payouts are currently paused** | Fully on-chain escrow; no third-party payment rail can freeze us |
| Fully custodial (treasury, Kraken, X Money balance) | Funds held by an on-chain program until release |
| X Money is **US-only, 18+**; everyone else's payments expire | Solana wallets work in every country |
| Pays people who never agreed (legal and reputational risk, looks like a scam) | The bounty action itself is the recipient's consent |
| Nothing to watch: money just appears | Every coin is a live public challenge with a growing pot |
| Only pump.fun is live | We run our own launchpad from day one |
| Docs inconsistent (payout minimum $5 in docs vs $50 on capital-flow page) | Clear, published, consistent rules |

**Our pitch:** *UsePaid sends people money they never asked for, through a rail that just froze. Bounty Pad makes them earn it, publicly, and pays them anywhere in the world, with nobody able to stop it.*

**Our biggest risk vs UsePaid:** friction. UsePaid recipients need no crypto. We solve this with X-login embedded wallets (Section 7).

---

## 3. Team and ownership

We are a team of **3**. Each layer has exactly one owner, who has final say within their layer. Cross-layer decisions (anything in `shared/`, product scope) need all 3 to approve.

| Role | Owns | Folder |
|---|---|---|
| On-chain dev | Solana programs, Meteora DBC config, fee claiming, escrow, payouts, devnet deploys | `programs/` |
| Backend dev | X watcher, verification pipeline, video transcription, voting tally, API, database, Privy server side, keeper jobs | `api/` |
| Frontend dev | Launch flow, token/bounty pages, voting UI, X login + wallet, design and motion | `web/` |

When working in this repo, **stay inside the folder of the task you were given** unless the task explicitly says otherwise. Never edit `shared/` without being told the change was approved by all three.

---

## 4. Tech stack

- **Chain:** Solana. Develop and test on **devnet only** until the team explicitly approves mainnet.
- **Launch mechanism:** **Meteora Dynamic Bonding Curve (DBC)**. We are the "partner" (launchpad) and create our own config key. Tokens graduate to **Meteora DAMM v2**.
  - DBC fee facts: a fixed 20% of each trading fee goes to the DBC protocol; the remaining **80% goes to the partner (us)**, which can be shared with the token creator.
  - At least 10% of liquidity must remain locked at day 1 after migration (DBC requirement).
  - Use DBC's **fee time scheduler** (high fee at launch that decays) as anti-sniper protection. (Meteora deprecated the rate limiter for new configs.)
  - Docs: https://docs.meteora.ag/overview/products/dbc/what-is-dbc
- **On-chain programs:** Rust + Anchor framework.
- **Backend:** TypeScript on Node. Postgres database. Scheduled jobs (keeper) for fee claims, watching X, rechecks, payouts.
- **Frontend:** Next.js + React + TypeScript, Solana wallet adapter, Privy for X login and embedded wallets, charts (TradingView lightweight-charts).
- **X data:** X API v2, pay-per-use pricing (about $0.005 per post read, charged per result returned). Docs: https://docs.x.com
- **Wallets for public figures:** Privy (supports Twitter/X OAuth login, embedded Solana wallets, and server-side wallet pregeneration). Docs: https://docs.privy.io
- **Video transcription:** Whisper (self-hosted) or a hosted speech-to-text API; ffmpeg to extract audio.
- **Key control:** treasury, fee claimer, and program upgrade authority behind a **2-of-3 Squads multisig** (one key per team member).
- **Secrets:** Doppler or 1Password. **Never commit secrets, private keys, or API keys.**
- **Hosting:** Vercel (web, preview per PR). Backend on any Node host with cron support.

---

## 5. Repo layout

```
/programs      Solana programs (Anchor): escrow/bounty vault, release, refund/burn
/api           Backend: X watcher, verifier, transcriber, vote tally, REST API, keeper jobs
/web           Next.js frontend
/shared        THE CONTRACT between layers (all 3 must approve changes):
   types.ts    Token, Bounty, Detection, Vote, Payout, BountyStatus...
   api.ts      Every endpoint: path, input, output
   idl/        Anchor IDL generated from /programs
/docs          spec.md (scope), decisions.md (every decision, dated)
CLAUDE.md      This file
```

Workflow: `main` is protected. One branch + one pull request per task. One other teammate reviews before merge. A task is **done** only when merged, working on devnet, the board is updated, and any new rule is written in `docs/decisions.md`.

---

## 6. Core product logic (every rule)

### 6.1 Launching a token (with its bounty)
The creator fills a form with **fixed choices only**. No free-text bounties, so every bounty is machine-checkable.

1. Token name, ticker, image, description (standard).
2. **Ticker must be 1 to 6 letters.** X only recognizes cashtags of 1 to 6 letters; longer tickers would not be detected.
3. **Target:** an X handle. On submit, the backend resolves the handle to the account's **permanent numeric user ID** via the X API and stores the ID (handles can change or be sold; IDs cannot).
   - Reject the launch if the handle does not exist.
   - Reject if the account is **protected** (private posts can't be read).
   - Reject if the account is flagged **parody**.
4. **Bounty action**, one of:
   - `TWEET_CASHTAG`: target posts a tweet containing `$TICKER`
   - `TWEET_CONTRACT`: target posts a tweet containing the token's contract address
   - `QUOTE_LAUNCH`: target quote-tweets the token's official launch tweet
   - `VIDEO_PHRASE`: target posts a native X video in which they say a required phrase (phrase set at launch, short, spoken naturally, e.g. "I'm holding Rocket coin")
5. **Deadline** (default 90 days, configurable).
6. The bounty (target ID, action, phrase, deadline) is **stored on-chain at launch and can never be changed**.
7. Every token page shows **"Not affiliated with @handle"** until the bounty is verified and paid.

### 6.2 Fees
- Trading fees are collected by Meteora DBC; our partner share (80% of the trading fee) is **claimed automatically** by the keeper on a schedule.
- Our share is split per token. **Defaults below are proposals, not final. Confirm with the team before hardcoding; keep them in config:**
  - Bounty pot: 50%
  - Platform: 30%
  - Token creator: 20%
- The bounty pot is held in the token's **escrow vault** (program-owned account).
- **The pot stays locked until the bounty is verified (and, for video, until a YES vote passes).**
- If the deadline passes with no verified action, the pot is **burned** (buy the token and burn it). Unverified pots must **never** go to holders or voters, so nobody profits from blocking a payout.

### 6.3 Automatic detection (no manual submissions)
The backend watches X by itself:

- **Search** for text bounties, every few minutes, one query per active bounty:
  - `TWEET_CASHTAG`: `from:<handle> $TICKER -is:retweet`
  - `TWEET_CONTRACT`: `from:<handle> "<contract address>" -is:retweet`
  - `QUOTE_LAUNCH`: `quotes_of_tweet_id:<launch tweet id> from:<handle>`
  - Recent search only covers the last 7 days, so the watcher must run continuously.
- **Timeline watching** for video bounties: read the target's new posts since the last seen ID, keep only posts with native video (`has:video_link` / media type video).
- **Group by target, not by token:** if 300 tokens target the same person, read their timeline once and check all 300 bounties against each new post.
- Deduplicate: never process the same post twice for the same bounty.

### 6.4 Verification checks (all must pass)
For each candidate post, fetch it by ID (`GET /2/tweets/:id` with `author_id`, `created_at`, `text`, `entities`, `referenced_tweets`, media expansions incl. `variants`, `duration_ms`):

1. `author_id` == the stored target ID
2. Posted **after** the token was created
3. Is an original post or a quote (not a retweet; replies not accepted in v1)
4. Content match:
   - text bounties: exact cashtag entity / exact contract address / quote of the exact launch tweet
   - video bounties: see 6.5
5. **24-hour recheck:** status becomes `DETECTED_CONFIRMING`. After 24h, re-read the post. Must still exist (deleted = resource-not-found = fail) and the **latest edited version** must still pass the content check.

All pass → `VERIFIED` (text bounties) or → `VOTING` / `VERIFIED` (video, see 6.5).

### 6.5 Video bounties
1. Download the video (mp4 variant), reject if longer than the max (default 3 minutes).
2. Extract audio (ffmpeg), transcribe (Whisper).
3. Fuzzy-match the required phrase against the transcript (tolerate small transcription errors).
4. Decision:
   - Match score ≥ 90% → auto-approved → `VERIFIED` (after the 24h recheck)
   - Match score ≤ 30% → auto-rejected
   - In between → **holder vote**
5. **Holder vote rules:**
   - Voting page shows the embedded video, the required phrase, the transcript, and the match score.
   - **Snapshot** of token balances taken at the moment the video is detected. Only wallets holding at snapshot can vote, with that balance.
   - Excluded from voting: bonding curve/pool accounts, token creator wallet, platform wallets.
   - Weight = tokens held, **capped at 5% of total voting power per wallet**.
   - Gasless: wallet signs a message; backend tallies signatures against the snapshot; publish all signatures and the result so anyone can recount.
   - Window 48h. Quorum 10% of eligible supply. Pass = 60% YES.
   - YES → `VERIFIED`. NO → fees stay locked, the bounty stays open for a new attempt until the deadline.
   - Quorum not reached → extend once by 48h; if still no quorum, stays locked and open until the deadline.
   - All numbers are defaults in config, to be tuned.

### 6.6 Payout
The blockchain can't read X, so the backend acts as a signed witness:
1. On `VERIFIED`, the verifier signs a message: bounty ID + target X user ID + post ID + payout wallet + expiry.
2. The escrow program checks the signature with Solana's ed25519 verify instruction before releasing funds.
3. Require **2-of-3 verifier signatures** (main verifier, backup verifier on separate hosting, admin key).
4. **48-hour public challenge window** before release; an admin can freeze a payout if something is wrong (e.g. hacked account).

**Where the money goes (two paths, depends on Test A in Section 9):**
- **Path 1 (preferred, fully automatic):** Privy **pregenerates a Solana wallet tied to the target's X account** server-side. Funds are sent there at release. Whenever the person logs in with X, the wallet and money are already there.
- **Path 2 (fallback):** funds stay in an on-chain vault keyed to the target's X user ID. The bot replies to the verified post ("Bounty completed, $X unlocked, claim at ..."). The person logs in once with X (Privy), a wallet is created, and the vault releases to it. After the first claim, that wallet is linked to their X ID and all future bounties pay instantly.
- **Opt-out:** a verified X account can refuse all bounties. Their future pots are burned, and their tokens are flagged.

### 6.7 Public receipts (marketing)
- Bot replies publicly only **after verification** (never spam people who haven't acted).
- Every token page shows: pot size (live), bounty status, time left, detected post (embedded), vote status, payout transaction.

### 6.8 Bounty statuses
`OPEN` → `DETECTED_CONFIRMING` → (`VOTING` for unclear videos) → `VERIFIED` → `CHALLENGE_WINDOW` → `PAID`
Side exits: `REJECTED` (back to `OPEN`), `EXPIRED` (pot burned), `OPTED_OUT` (pot burned), `FROZEN` (admin, during challenge window).

---

## 7. Design and motion

- Direction (2026-09-29, from the product owner): **simple, light, content first**, in the school of **OpenSea and Rarible**. No dark/neon look, no decorative 3D, no gimmick effects.
  - White surfaces, near-black text and primary buttons, light-grey panels, 1px hairline borders, 16px radii.
  - One brand accent: yellow `#ffc72c`, used sparingly (logo, step numbers, selection). Colour otherwise means status only (green = paid/success, amber = waiting, red = error, blue = links / X).
  - Inter everywhere; bold, tight headings; no monospace labels in the UI (only for addresses when needed).
  - The coin image is the hero of every card and page (like an NFT): **every coin must have an image** (uploaded at launch, required).
  - Motion stays subtle: counters, fades, hover lifts.
- Logo: black rounded square with the gold coin-target and a white check (`web/public/brand/logo.svg`). Don't imitate other brands' marks.
- Key screens: home (featured bounty, top bounties table, new challenges shelf, activity), launch form (step by step), token page (image, challenge, pot, trade, status), voting page, public figure profile, claim page (X login).
- Mobile-first. Every page must work at phone width.

## 8. Security and rules

- Devnet only until the team approves mainnet. Mainnet requires: external audit, bug bounty, capped launch period.
- Never commit secrets. Never print private keys in logs.
- Never invent API endpoints, fields, or SDK methods. If unsure, check the official docs (X, Meteora, Privy, Anchor) and say what you checked.
- X API calls cost money: cache results, deduplicate, never loop or poll faster than configured.
- Every state change in the verification pipeline is logged with the post ID and timestamp (auditable).
- No promises of profit anywhere in the UI or copy.

---

## 9. Two tests to run before building the rest

**Test A: Privy wallet for an X account.** Server-side, create a Privy user with an X (Twitter) linked account plus a pregenerated Solana wallet. Then log in with that X account in the app and confirm the same wallet appears. Privy docs show pregeneration with email/custom auth; X-account pregeneration must be confirmed. Result decides Path 1 vs Path 2 in 6.6.

**Test B: Meteora DBC fee claimer = our program.** On devnet, create a DBC config whose `feeClaimer` is a program-owned address (PDA) and claim partner fees through our program. If not possible, fallback: claim to the multisig treasury and have the keeper deposit into each token's escrow vault.

---

## 10. Milestones

1. Tests A and B (on-chain + backend)
2. Launch a token with a bounty on devnet through our own UI (all three)
3. Text bounty detection and verification end-to-end on devnet (backend + frontend)
4. Automatic payout on devnet (on-chain + backend)
5. Video bounties + holder voting
6. Design and motion polish, audit, mainnet

Weekly rhythm: Monday planning (one demo sentence as the week's goal), 15-minute daily sync, Friday live demo on devnet.

---

## 11. Open decisions (do not hardcode; ask)

- Final fee split (defaults in 6.2)
- Trading fee tier and DBC curve parameters (start cap, graduation threshold)
- Quote asset (SOL default)
- Whether to launch a protocol token and its mechanics (not in v1)
- Final product name and domain
- Geo restrictions / legal review before mainnet

---

## 12. How Claude Code should work in this repo

1. Read this file and `docs/decisions.md` first.
2. For any task: state your plan, list the files you will touch, then implement.
3. Stay within the assigned folder. Changes to `shared/` require explicit team approval.
4. Write tests for verification logic and program instructions.
5. When a new rule or decision emerges, propose an entry for `docs/decisions.md`.
6. If a requirement is ambiguous or conflicts with this file, ask before coding.
