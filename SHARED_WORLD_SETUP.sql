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

-- ── 4) GLOBAL LIVE STATS — plays / wins / losses / kills / trades ────────────
-- Powers the REAL Market Dashboard + card valuation across every player:
-- Most-Played, real Win Rate, kills, Most-Traded. One row per event; aggregated
-- by the usage_top RPC. Relaxes any older card/hero/item-only kind check so the
-- new live-stat kinds are accepted.
create table if not exists public.usage_events (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  ref_id text not null,
  qty int not null default 1 check (qty between 1 and 1000),
  created_at timestamptz not null default now()
);
alter table public.usage_events drop constraint if exists usage_events_kind_check;
alter table public.usage_events add constraint usage_events_kind_check
  check (kind in ('card','hero','item','win','loss','kill','trade'));
create index if not exists usage_events_kind_ref_idx on public.usage_events (kind, ref_id);
create index if not exists usage_events_created_at_idx on public.usage_events (created_at desc);
create index if not exists usage_events_user_id_idx on public.usage_events (user_id);
alter table public.usage_events enable row level security;
drop policy if exists usage_events_self_insert on public.usage_events;
create policy usage_events_self_insert on public.usage_events for insert with check (user_id = auth.uid());
drop policy if exists usage_events_self_read on public.usage_events;
create policy usage_events_self_read on public.usage_events for select using (user_id = auth.uid());

create or replace function public.usage_top(p_kind text, p_limit int default 25, p_since_days int default null)
returns table (ref_id text, plays bigint, distinct_players bigint)
language sql security definer set search_path = public, pg_temp as $$
  select ref_id, sum(qty)::bigint as plays, count(distinct user_id)::bigint as distinct_players
  from public.usage_events
  where kind = p_kind
    and (p_since_days is null or created_at >= now() - (p_since_days::text || ' days')::interval)
  group by ref_id order by plays desc
  limit greatest(1, least(coalesce(p_limit, 25), 200));
$$;
grant execute on function public.usage_top(text, int, int) to anon, authenticated;

-- ── 5) LIVE SHARED CRASH/EXCHANGE PRICES ─────────────────────────────────────
-- One row per tradable asset (resource / corp / currency / channel id). Every
-- player's confirmed buy or sell upserts the new current price + 24h volume, so
-- the WHOLE exchange moves together for everyone in real time. The deterministic
-- base price is computed client-side (identical for all players); only the live
-- `current_px` / `volume24h` travel through the cloud. Not money — it's a game
-- economy — so any signed-in player may move prices by trading (write = true);
-- last-writer-wins on the upsert is intentional and safe.
create table if not exists public.cx_prices (
  asset_id    text primary key,
  current_px  double precision not null default 0,
  volume24h   integer not null default 0,
  last_dir    integer default 0,
  last_reason text,
  updated_by  uuid,
  updated_at  timestamptz default now()
);
alter table public.cx_prices enable row level security;
drop policy if exists cxp_sel on public.cx_prices;
create policy cxp_sel on public.cx_prices for select to authenticated using (true);
drop policy if exists cxp_write on public.cx_prices;
create policy cxp_write on public.cx_prices for all to authenticated using (true) with check (true);

-- ── 6) WAGER HALL — live spectator bets on real matches ──────────────────────
-- Pari-mutuel Cinder wagers on real, spectated multiplayer matches. All stakes
-- on a match form ONE pool; when the match finishes (matches.winner_id is set)
-- the whole pot is split among everyone who backed the winner, proportional to
-- their stake. The pool is PUBLIC (read-all) so odds + the crowd's bets show
-- live for every viewer. Each bettor inserts their own bet and settles their
-- own payout (a conditional update on settled=false makes payout idempotent).
create table if not exists public.match_bets (
  id           uuid primary key default gen_random_uuid(),
  match_id     text not null,
  bettor_id    uuid not null references auth.users(id) on delete cascade,
  bettor_name  text,
  side         text not null check (side in ('p1','p2')),
  pick_user_id uuid,
  stake        integer not null check (stake > 0),
  settled      boolean not null default false,
  won          boolean,
  payout       integer not null default 0,
  created_at   timestamptz default now()
);
create index if not exists match_bets_match_idx on public.match_bets (match_id);
create index if not exists match_bets_bettor_idx on public.match_bets (bettor_id);
alter table public.match_bets enable row level security;
-- Read all (public pool → live odds for every spectator).
drop policy if exists mb_sel on public.match_bets;
create policy mb_sel on public.match_bets for select to authenticated using (true);
-- Insert only your own bets.
drop policy if exists mb_ins on public.match_bets;
create policy mb_ins on public.match_bets for insert to authenticated with check (bettor_id = auth.uid());
-- Update only your own bets (settling your own payout).
drop policy if exists mb_upd on public.match_bets;
create policy mb_upd on public.match_bets for update to authenticated using (bettor_id = auth.uid()) with check (bettor_id = auth.uid());

-- ── 7) LEADERBOARD + LIVE-MATCH RPCs (Leaderboard screen + Wager Hall) ───────
-- Powers the Leaderboard AND the Wager Hall "Live Matches" list + spectating.
-- (Canonical copies also live in bulletproof_saves.sql; included here, HARDENED,
-- so running THIS one file is enough to make both work.) SECURITY DEFINER so
-- they read across players without exposing private rows.
--
-- WHY THIS MATTERS: if get_leaderboard is missing or throws, the Leaderboard +
-- Wager-Hall data calls fail. The versions below are crash-proof: they (a) make
-- sure the jsonb columns exist first, and (b) parse rr/ap/etc. with a regex
-- guard so a single bad value can never abort the whole query.

-- 7a) Make sure the columns get_leaderboard reads actually exist. (No-op if the
--     user_profiles table already has them. Guarded so it's safe even if the
--     table somehow isn't present yet.)
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'user_profiles') then
    alter table public.user_profiles add column if not exists competitive jsonb not null default '{}'::jsonb;
    alter table public.user_profiles add column if not exists records     jsonb not null default '{}'::jsonb;
    alter table public.user_profiles add column if not exists display_name text;
  end if;
end $$;

-- 7b) Safe integer extractor — returns the int inside a jsonb text value, or
--     the fallback if it's missing/non-numeric. Stops a stray "S+" / "" / null
--     from throwing a cast error that would break the entire leaderboard query.
create or replace function public._jint(p jsonb, k text, d int default 0)
returns int language sql immutable as $$
  select case
    when p ? k and (p->>k) ~ '^-?[0-9]+$' then (p->>k)::int
    else d
  end
$$;

-- 7c) Leaderboard — top players by RR (reads competitive/records jsonb safely).
create or replace function public.get_leaderboard(p_limit int default 100)
returns table(user_id uuid, display_name text, rr int, ap int, win_streak int, faction_id text, wins int, losses int)
language sql stable security definer set search_path = public, pg_temp as $$
  select user_id,
         coalesce(display_name, 'Anonymous')      as display_name,
         public._jint(competitive, 'rr', 0)        as rr,
         public._jint(competitive, 'ap', 0)        as ap,
         public._jint(competitive, 'winStreak', 0) as win_streak,
         (competitive->>'factionId')               as faction_id,
         public._jint(records, 'wins', 0)          as wins,
         public._jint(records, 'losses', 0)        as losses
  from public.user_profiles
  where public._jint(competitive, 'rr', -2147483648) <> -2147483648
  order by public._jint(competitive, 'rr', 0) desc,
           public._jint(competitive, 'ap', 0) desc
  limit greatest(1, least(coalesce(p_limit, 100), 200))
$$;
grant execute on function public._jint(jsonb, text, int) to anon, authenticated;
grant execute on function public.get_leaderboard(int) to authenticated;

-- 7d) Live matches — in-progress games (status='pending', not finished, recent)
--     for the Wager Hall list + spectating. Only created if the matches table
--     exists; otherwise skipped (no error) so the rest of this script still runs.
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'matches') then
    execute $f$
      create or replace function public.get_active_matches(p_limit int default 20)
      returns table(id uuid, player1_id uuid, player2_id uuid, hero1_id text, hero2_id text, created_at timestamptz)
      language sql stable security definer set search_path = public, pg_temp as $body$
        select id, player1_id, player2_id, hero1_id, hero2_id, created_at
        from public.matches
        where status = 'pending' and winner_id is null
          and created_at > now() - interval '30 minutes'
        order by created_at desc
        limit greatest(1, least(coalesce(p_limit, 20), 50))
      $body$;
    $f$;
    execute 'grant execute on function public.get_active_matches(int) to authenticated';
  end if;
end $$;

-- =============================================================================
-- ✅ DONE. Now go to: Database → Replication and toggle Realtime ON for:
--    public.card_market_listings   public.resource_listings
--    public.tw_ownership           public.tw_world_feed
--    public.cx_prices              public.match_bets
-- so listings + captures + live exchange prices + live wager odds show up for
-- other players instantly. (Without it, everything still works but refreshes on
-- a slow poll instead of live.)
-- (usage_events, get_leaderboard, and get_active_matches are read via RPC — no
-- Realtime toggle needed for them.)
--
-- 🏆 The Leaderboard + Wager-Hall "Live Matches" list now work as soon as this
-- script has run (section 7). If the Leaderboard was erroring before, that was
-- get_leaderboard missing/throwing — section 7 (re)creates it crash-proof.
-- =============================================================================
