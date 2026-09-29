-- Bounty Pad schema. Amounts are lamports (numeric). Ids are UUID strings made by the app.

create table if not exists profiles (
  x_user_id text primary key,            -- permanent numeric X user ID (never the handle)
  username text not null,
  name text not null,
  avatar_url text,
  verified boolean not null default false,
  opted_out boolean not null default false,
  linked_wallet text,
  updated_at timestamptz not null default now()
);
create unique index if not exists profiles_username on profiles (lower(username));

create table if not exists tokens (
  id text primary key,
  mint text not null unique,
  name text not null,
  ticker text not null,
  image_url text,
  description text not null default '',
  creator_wallet text not null,
  launch_post_id text,
  created_at timestamptz not null default now()
);

create table if not exists bounties (
  id text primary key,
  token_id text not null unique references tokens(id),
  target_x_user_id text not null references profiles(x_user_id),
  action text not null,
  phrase text,
  deadline timestamptz not null,
  status text not null,
  pot_lamports numeric not null default 0,
  last_seen_post_id text,
  verified_post_id text,
  payout_wallet text,
  paid_tx text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bounties_status on bounties (status);
create index if not exists bounties_target on bounties (target_x_user_id);

create table if not exists detections (
  id text primary key,
  bounty_id text not null references bounties(id),
  post_id text not null,
  text text not null,
  post_created_at timestamptz not null,
  media_url text,
  transcript text,
  match_score int,
  checks jsonb not null,
  snapshot jsonb,                        -- holder balances at detection (video bounties)
  status text not null,
  detected_at timestamptz not null default now(),
  recheck_at timestamptz not null,
  unique (bounty_id, post_id)
);

create table if not exists vote_rounds (
  id text primary key,
  bounty_id text not null references bounties(id),
  detection_id text not null references detections(id),
  snapshot jsonb not null,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  extended boolean not null default false,
  result text not null default 'PENDING'
);

create table if not exists votes (
  round_id text not null references vote_rounds(id),
  wallet text not null,
  choice text not null,
  signature text not null,
  created_at timestamptz not null default now(),
  primary key (round_id, wallet)
);

create table if not exists trades (
  id text primary key,
  token_id text not null references tokens(id),
  wallet text not null,
  side text not null,
  sol_lamports numeric not null,
  pot_lamports numeric not null,
  created_at timestamptz not null default now()
);
create index if not exists trades_token on trades (token_id, created_at desc);

create table if not exists holders (
  token_id text not null references tokens(id),
  wallet text not null,
  balance numeric not null,
  primary key (token_id, wallet)
);

create table if not exists payouts (
  id text primary key,
  bounty_id text not null unique references bounties(id),
  amount_lamports numeric not null,
  wallet text,
  attestation jsonb,
  signatures jsonb not null default '[]',
  challenge_ends_at timestamptz not null,
  status text not null,
  tx_sig text,
  created_at timestamptz not null default now()
);

-- Every bounty state change, with the post that caused it (CLAUDE.md §8: auditable).
create table if not exists audit_log (
  id bigserial primary key,
  bounty_id text not null,
  from_status text,
  to_status text not null,
  reason text not null,
  post_id text,
  at timestamptz not null default now()
);

create table if not exists events (
  id bigserial primary key,
  type text not null,
  token_id text,
  bounty_id text,
  data jsonb not null default '{}',
  at timestamptz not null default now()
);

-- ---- on-chain (CHAIN=solana) ----
alter table tokens add column if not exists pool text;
alter table tokens add column if not exists launch_tx text;
alter table bounties add column if not exists onchain_status int;

-- A launch transaction handed to the creator's wallet, waiting for their signature.
create table if not exists pending_launches (
  id text primary key,
  mint text not null unique,
  input jsonb not null,
  message_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- Every partner-fee claim and the pot share deposited into the escrow with it (same transaction).
create table if not exists fee_claims (
  id bigserial primary key,
  token_id text not null references tokens(id),
  claimed_lamports numeric not null,
  pot_lamports numeric not null,
  tx_sig text not null,
  at timestamptz not null default now()
);
create index if not exists fee_claims_token on fee_claims (token_id, at);

-- Expired / opted-out pots: SOL swept to the treasury, coin bought and burned.
create table if not exists burns (
  id bigserial primary key,
  bounty_id text not null references bounties(id),
  lamports numeric not null,
  sweep_tx text not null,
  buy_tx text,
  burn_tx text,
  burned_tokens numeric,
  at timestamptz not null default now()
)
;

-- ---- market data (charts) ----
alter table trades add column if not exists token_amount numeric;
alter table trades add column if not exists price double precision;
alter table tokens add column if not exists curve_progress double precision;

-- Every price we know: each trade, plus samples of the on-chain pool (catches trades made elsewhere).
-- price = SOL per whole token. Candles are built from this.
create table if not exists price_ticks (
  id bigserial primary key,
  token_id text not null references tokens(id),
  at timestamptz not null default now(),
  price double precision not null,
  volume_lamports numeric not null default 0,
  side text
);
create index if not exists price_ticks_token on price_ticks (token_id, at)
;

-- ---- "Log in with X" (OAuth 2.0 + PKCE, our own X app) ----
-- One row per login attempt: CSRF state + PKCE verifier, valid 10 minutes.
create table if not exists oauth_states (
  state text primary key,
  verifier text not null,
  purpose text not null,                 -- 'login' (claimants) | 'platform' (our posting account)
  return_to text not null default '/claim',
  created_at timestamptz not null default now()
);
-- After X redirects back, a one-time code hands the login to the website (2 minutes).
create table if not exists login_codes (
  code text primary key,
  x_user_id text not null references profiles(x_user_id),
  return_to text not null,
  created_at timestamptz not null default now()
);
-- Sessions: the cookie holds the random id; the X account is proven by X itself.
create table if not exists sessions (
  id text primary key,
  x_user_id text not null references profiles(x_user_id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists sessions_user on sessions (x_user_id);
-- The platform's own X account (tweet.write + offline.access), used for launch posts and receipts.
create table if not exists platform_x (
  id int primary key default 1,
  x_user_id text not null,
  username text not null,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

-- ---- listing ----
alter table tokens add column if not exists featured boolean not null default false;
alter table tokens add column if not exists hidden boolean not null default false;
alter table bounties add column if not exists receipt_post_id text;
alter table tokens add column if not exists links jsonb not null default '{}'::jsonb
