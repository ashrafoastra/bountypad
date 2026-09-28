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
