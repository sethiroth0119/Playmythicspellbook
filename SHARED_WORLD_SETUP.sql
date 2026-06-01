-- =============================================================================
-- 🌐 MYTHIC SPELLBOOK — SHARED PLAYER MARKETPLACE (run ONCE in Supabase)
-- -----------------------------------------------------------------------------
-- Creates the two tables that make The Market live + shared across every
-- signed-in player: card/item listings and resource listings (fixed price +
-- auctions). Idempotent — safe to run again; it won't duplicate or wipe data.
--
-- HOW TO RUN:
--   Supabase dashboard → SQL Editor → New query → paste ALL of this → Run.
--   Then: Database → Replication → enable Realtime on both tables below so
--   listings appear for other players instantly (without a refresh).
-- =============================================================================

-- ── 1) PLAYER CARD / ITEM MARKET (fixed price + auctions) ────────────────────
create table if not exists public.card_market_listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references auth.users(id) on delete cascade,
  seller_name text,
  kind text not null default 'card',
  card_id text,
  card_json jsonb,
  unit_json jsonb,
  listing_type text not null default 'fixed',
  currency text not null default 'cinders',
  price integer not null default 0,
  starting_bid integer not null default 0,
  current_bid integer not null default 0,
  current_bidder_id uuid references auth.users(id),
  current_bidder_name text,
  buy_now_price integer,
  bid_history jsonb not null default '[]'::jsonb,
  ends_at timestamptz,
  buyer_id uuid references auth.users(id),
  status text not null default 'open',
  paid_out boolean not null default false,
  created_at timestamptz default now()
);
alter table public.card_market_listings enable row level security;
drop policy if exists cml_sel on public.card_market_listings;
create policy cml_sel on public.card_market_listings for select to authenticated using (status = 'open' or seller_id = auth.uid() or buyer_id = auth.uid() or current_bidder_id = auth.uid());
drop policy if exists cml_ins on public.card_market_listings;
create policy cml_ins on public.card_market_listings for insert to authenticated with check (seller_id = auth.uid());
drop policy if exists cml_upd on public.card_market_listings;
create policy cml_upd on public.card_market_listings for update to authenticated using (status = 'open' or seller_id = auth.uid()) with check (true);
drop policy if exists cml_del on public.card_market_listings;
create policy cml_del on public.card_market_listings for delete to authenticated using (seller_id = auth.uid() and status = 'open');

-- ── 2) PLAYER RESOURCE MARKET ────────────────────────────────────────────────
create table if not exists public.resource_listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references auth.users(id) on delete cascade,
  seller_name text,
  resource text not null,
  qty integer not null check (qty > 0),
  price integer not null check (price >= 0),
  buyer_id uuid references auth.users(id),
  status text not null default 'open',
  paid_out boolean not null default false,
  created_at timestamptz default now()
);
-- extra columns (safe to re-run on an existing table):
alter table public.resource_listings add column if not exists currency text not null default 'cinders';
alter table public.resource_listings add column if not exists want_kind text;
alter table public.resource_listings add column if not exists want_id text;
alter table public.resource_listings add column if not exists want_name text;
alter table public.resource_listings enable row level security;
drop policy if exists rl_sel on public.resource_listings;
create policy rl_sel on public.resource_listings for select to authenticated using (status = 'open' or seller_id = auth.uid() or buyer_id = auth.uid());
drop policy if exists rl_ins on public.resource_listings;
create policy rl_ins on public.resource_listings for insert to authenticated with check (seller_id = auth.uid());
drop policy if exists rl_upd on public.resource_listings;
create policy rl_upd on public.resource_listings for update to authenticated using (status = 'open' or seller_id = auth.uid()) with check (true);
drop policy if exists rl_del on public.resource_listings;
create policy rl_del on public.resource_listings for delete to authenticated using (seller_id = auth.uid() and status = 'open');

-- ── 3) WAR MAP — live node ownership + world feed ───────────────────────────
-- Minimal, CLIENT-COMPATIBLE version: the game only reads/writes tw_ownership
-- (who owns each node → the "lit" nodes) and tw_world_feed (the live field-
-- reports). Deliberately NO foreign keys to tw_territories / tw_corporations —
-- the client authors nodes in the Forge (not those tables), so strict FKs would
-- silently reject every ownership write. owner_corp_id / corp_id are plain text
-- so any corp id the client sends round-trips cleanly.
create table if not exists public.tw_ownership (
  node_id          text primary key,
  owner_corp_id    text,
  captured_at      timestamptz default now(),
  last_collect_at  timestamptz,
  stability        integer default 100,
  clears_applied   integer default 0,
  under_attack     boolean default false,
  contested        boolean default false,
  destroyed        boolean default false,
  meta             jsonb default '{}'::jsonb,
  updated_at       timestamptz default now()
);
alter table public.tw_ownership enable row level security;
drop policy if exists two_sel on public.tw_ownership;
create policy two_sel on public.tw_ownership for select to authenticated using (true);
drop policy if exists two_write on public.tw_ownership;
create policy two_write on public.tw_ownership for all to authenticated using (true) with check (true);

create table if not exists public.tw_world_feed (
  id      uuid primary key default gen_random_uuid(),
  kind    text not null default 'event',
  msg     text not null default '',
  actor   uuid,
  corp_id text,
  node_id text,
  at      timestamptz default now()
);
create index if not exists tw_feed_at on public.tw_world_feed (at desc);
alter table public.tw_world_feed enable row level security;
drop policy if exists twwf_sel on public.tw_world_feed;
create policy twwf_sel on public.tw_world_feed for select to authenticated using (true);
drop policy if exists twwf_ins on public.tw_world_feed;
create policy twwf_ins on public.tw_world_feed for insert to authenticated with check (true);

-- =============================================================================
-- ✅ DONE. Now go to: Database → Replication and toggle Realtime ON for:
--    public.card_market_listings   public.resource_listings
--    public.tw_ownership           public.tw_world_feed
-- so listings + captures show up for other players instantly. (Without it,
-- everything still works but refreshes on a slow poll instead of live.)
-- =============================================================================
