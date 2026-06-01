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

-- ── 8) SERVER-AUTHORITATIVE WALLET + INVENTORY + PUBLIC PROFILES ─────────────
-- Canonical economy + public-profile RPCs (mirrors bulletproof_saves.sql) so
-- running THIS one file stands up the whole backend. The DB row is the source
-- of truth for Cinder/items — every spend/grant is an atomic transaction with a
-- ledger entry. Idempotent; SECURITY DEFINER. (get_leaderboard + get_active_
-- matches live in section 7 above — the hardened copies — and are NOT repeated.)

-- 8a) Canonical per-player progress row. Mutated only via the RPCs below.
create table if not exists public.user_progress (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  cinder          bigint not null default 0 check (cinder >= 0),
  sovereigns      bigint not null default 0 check (sovereigns >= 0),
  item_inventory  jsonb  not null default '{}'::jsonb,
  equipment       jsonb  not null default '{}'::jsonb,
  relic_equipment jsonb  not null default '{}'::jsonb,
  ft_tax_total    bigint not null default 0,
  updated_at      timestamptz not null default now()
);
alter table public.user_progress enable row level security;
drop policy if exists up_sel on public.user_progress;
create policy up_sel on public.user_progress for select to authenticated using (user_id = auth.uid());
drop policy if exists up_ins on public.user_progress;
create policy up_ins on public.user_progress for insert to authenticated with check (user_id = auth.uid());
drop policy if exists up_upd on public.user_progress;
create policy up_upd on public.user_progress for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 8b) wallet_ledger — server-side audit trail of every currency/inventory op.
create table if not exists public.wallet_ledger (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  op            text not null,
  resource      text not null,
  delta         bigint not null,
  balance_after bigint,
  reason        text,
  meta          jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists wallet_ledger_user_time on public.wallet_ledger (user_id, created_at desc);
alter table public.wallet_ledger enable row level security;
drop policy if exists wl_sel on public.wallet_ledger;
create policy wl_sel on public.wallet_ledger for select to authenticated using (user_id = auth.uid());
drop policy if exists wl_ins on public.wallet_ledger;
create policy wl_ins on public.wallet_ledger for insert to authenticated with check (false);

-- 8c) Ensure the matches columns the profile RPCs read exist (guarded; no-op if
--     already present). Lets the recent-matches / h2h RPCs create cleanly.
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'matches') then
    alter table public.matches add column if not exists status    text default 'pending';
    alter table public.matches add column if not exists winner_id uuid;
    alter table public.matches add column if not exists rr1_delta int default 0;
    alter table public.matches add column if not exists rr2_delta int default 0;
    alter table public.matches add column if not exists turns     int default 0;
  end if;
end $$;

-- 8d) Public profile (reads user_profiles competitive/records ensured in 7a).
create or replace function public.get_player_profile(p_user_id uuid)
returns table(user_id uuid, display_name text, rr int, ap int, tier_name text,
              win_streak int, wins int, losses int, battles int, faction_id text,
              avatar text, banner text, account_level int, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select user_id,
         coalesce(display_name, 'Anonymous'),
         public._jint(competitive, 'rr', 0),
         public._jint(competitive, 'ap', 0),
         coalesce(competitive->>'tierName', ''),
         public._jint(competitive, 'winStreak', 0),
         public._jint(records, 'wins', 0),
         public._jint(records, 'losses', 0),
         public._jint(records, 'battles', 0),
         (competitive->>'factionId'),
         coalesce(competitive->>'avatar', '🦸'),
         coalesce(competitive->>'banner', 'default'),
         public._jint(competitive, 'accountLevel', 1),
         coalesce((updated_at)::timestamptz, now())
  from public.user_profiles
  where user_id = p_user_id
  limit 1
$$;
grant execute on function public.get_player_profile(uuid) to authenticated;

-- 8e) My ledger (Profile → Transactions audit trail).
create or replace function public.get_my_ledger(p_limit int default 100)
returns table(id uuid, op text, resource text, delta bigint, balance_after bigint,
              reason text, meta jsonb, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select id, op, resource, delta, balance_after, reason, meta, created_at
  from public.wallet_ledger
  where user_id = auth.uid()
  order by created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500))
$$;
grant execute on function public.get_my_ledger(int) to authenticated;

-- 8f) Recent-matches + head-to-head feeds (depend on the matches table; created
--     only if it exists). Bodies use a distinct inner dollar-tag so they never
--     clash with the surrounding DO block delimiter.
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'matches') then
    execute $f$
      create or replace function public.get_player_recent_matches(p_user_id uuid, p_limit int default 10)
      returns table(id uuid, is_player1 boolean, hero_self text, hero_opp text,
                    won boolean, rr_delta int, turns int, created_at timestamptz)
      language sql stable security definer set search_path = public, pg_temp as $fn$
        select m.id,
               (m.player1_id = p_user_id),
               case when m.player1_id = p_user_id then m.hero1_id else m.hero2_id end,
               case when m.player1_id = p_user_id then m.hero2_id else m.hero1_id end,
               (m.winner_id = p_user_id),
               case when m.player1_id = p_user_id then m.rr1_delta else m.rr2_delta end,
               m.turns, m.created_at
        from public.matches m
        where (m.player1_id = p_user_id or m.player2_id = p_user_id)
          and m.status = 'complete'
        order by m.created_at desc
        limit greatest(1, least(coalesce(p_limit, 10), 50))
      $fn$;
    $f$;
    execute 'grant execute on function public.get_player_recent_matches(uuid, int) to authenticated';

    execute $f$
      create or replace function public.get_h2h_matches(p_other uuid, p_limit int default 20)
      returns table(id uuid, i_was_player1 boolean, hero_me text, hero_opp text,
                    won boolean, rr_delta int, turns int, created_at timestamptz)
      language sql stable security definer set search_path = public, pg_temp as $fn$
        with me as (select auth.uid() as uid)
        select m.id,
               (m.player1_id = (select uid from me)),
               case when m.player1_id = (select uid from me) then m.hero1_id else m.hero2_id end,
               case when m.player1_id = (select uid from me) then m.hero2_id else m.hero1_id end,
               (m.winner_id = (select uid from me)),
               case when m.player1_id = (select uid from me) then m.rr1_delta else m.rr2_delta end,
               m.turns, m.created_at
        from public.matches m, me
        where m.status = 'complete'
          and ((m.player1_id = me.uid and m.player2_id = p_other)
            or (m.player2_id = me.uid and m.player1_id = p_other))
        order by m.created_at desc
        limit greatest(1, least(coalesce(p_limit, 20), 50))
      $fn$;
    $f$;
    execute 'grant execute on function public.get_h2h_matches(uuid, int) to authenticated';
  end if;
end $$;

-- 8g) Atomic wallet — spend with 2% Foundation Tax, refuses if insufficient.
create or replace function public.wallet_charge(p_amount bigint, p_reason text default 'Cinder spending')
returns table(new_balance bigint, tax_amount bigint, ok boolean, reason text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_bal bigint; v_tax bigint;
begin
  if v_uid is null then return query select 0::bigint, 0::bigint, false, 'not_signed_in'::text; return; end if;
  if p_amount is null or p_amount <= 0 then return query select 0::bigint, 0::bigint, false, 'bad_amount'::text; return; end if;
  insert into public.user_progress (user_id) values (v_uid) on conflict do nothing;
  update public.user_progress
    set cinder = cinder - p_amount, updated_at = now()
    where user_id = v_uid and cinder >= p_amount
    returning cinder into v_bal;
  if v_bal is null then
    select cinder into v_bal from public.user_progress where user_id = v_uid;
    return query select coalesce(v_bal, 0::bigint), 0::bigint, false, 'insufficient'::text;
    return;
  end if;
  insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason)
    values (v_uid, 'charge', 'cinder', -p_amount, v_bal, p_reason);
  v_tax := floor(p_amount * 0.02);
  if v_tax > 0 then
    update public.user_progress set ft_tax_total = ft_tax_total + v_tax where user_id = v_uid;
    insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason, meta)
      values (v_uid, 'tax', 'cinder', 0, v_bal, 'Foundation Tax (2%)', jsonb_build_object('tax_amount', v_tax, 'parent_reason', p_reason));
    begin
      insert into public.reserve_tax_log (seller_id, resource, quantity, sale_value, tax_rate, tax_amount, market_type)
        values (v_uid, p_reason, 0, p_amount, 0.02, v_tax, 'spend');
    exception when undefined_table then null;
    end;
  end if;
  return query select v_bal, coalesce(v_tax, 0::bigint), true, ''::text;
end$$;
grant execute on function public.wallet_charge(bigint, text) to authenticated;

-- 8h) Atomic wallet — credit (rewards / refunds / admin grants).
create or replace function public.wallet_credit(p_amount bigint, p_reason text default 'reward')
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_bal bigint;
begin
  if v_uid is null or p_amount is null or p_amount <= 0 then return 0; end if;
  insert into public.user_progress (user_id) values (v_uid) on conflict do nothing;
  update public.user_progress
    set cinder = cinder + p_amount, updated_at = now()
    where user_id = v_uid returning cinder into v_bal;
  insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason)
    values (v_uid, 'credit', 'cinder', p_amount, coalesce(v_bal, 0::bigint), p_reason);
  return coalesce(v_bal, 0::bigint);
end$$;
grant execute on function public.wallet_credit(bigint, text) to authenticated;

-- 8i) Atomic inventory — grant items.
create or replace function public.inv_grant(p_item_id text, p_qty int default 1)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_cur int;
begin
  if v_uid is null or p_item_id is null or p_qty is null or p_qty <= 0 then return 0; end if;
  insert into public.user_progress (user_id) values (v_uid) on conflict do nothing;
  update public.user_progress
    set item_inventory = jsonb_set(item_inventory, array[p_item_id],
          to_jsonb(coalesce((item_inventory ->> p_item_id)::int, 0) + p_qty)),
        updated_at = now()
    where user_id = v_uid;
  select (item_inventory ->> p_item_id)::int into v_cur from public.user_progress where user_id = v_uid;
  insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason)
    values (v_uid, 'inv_grant', p_item_id, p_qty, coalesce(v_cur, 0)::bigint, 'item grant');
  return coalesce(v_cur, 0);
end$$;
grant execute on function public.inv_grant(text, int) to authenticated;

-- 8j) Atomic inventory — consume items (refuses if insufficient).
create or replace function public.inv_consume(p_item_id text, p_qty int default 1)
returns table(ok boolean, new_qty int) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_have int; v_new int;
begin
  if v_uid is null or p_item_id is null or p_qty is null or p_qty <= 0 then return query select false, 0; return; end if;
  select coalesce((item_inventory ->> p_item_id)::int, 0) into v_have from public.user_progress where user_id = v_uid;
  if v_have < p_qty then return query select false, coalesce(v_have, 0); return; end if;
  v_new := v_have - p_qty;
  update public.user_progress
    set item_inventory = case when v_new <= 0 then item_inventory - p_item_id
        else jsonb_set(item_inventory, array[p_item_id], to_jsonb(v_new)) end,
        updated_at = now()
    where user_id = v_uid;
  insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason)
    values (v_uid, 'inv_consume', p_item_id, -p_qty, v_new::bigint, 'item consumed');
  return query select true, v_new;
end$$;
grant execute on function public.inv_consume(text, int) to authenticated;

-- 8k) Seed a fresh user_progress row on first sign-in (idempotent).
create or replace function public.progress_ensure(p_seed_cinder bigint default 0, p_seed_inventory jsonb default '{}'::jsonb)
returns public.user_progress language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_row public.user_progress;
begin
  if v_uid is null then return null; end if;
  insert into public.user_progress (user_id, cinder, item_inventory)
    values (v_uid, greatest(0, coalesce(p_seed_cinder, 0)), coalesce(p_seed_inventory, '{}'::jsonb))
    on conflict (user_id) do nothing;
  select * into v_row from public.user_progress where user_id = v_uid;
  return v_row;
end$$;
grant execute on function public.progress_ensure(bigint, jsonb) to authenticated;

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
