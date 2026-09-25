-- ════════════════════════════════════════════════════════════════════════════
-- 038 — CITY ECONOMY: specializations + city-to-city trade
-- ----------------------------------------------------------------------------
-- "YOUR CITY NEEDS OTHER CITIES."
--
-- Two tables:
--   city_profiles      what a city IS — its node, its earned specializations,
--                      and what it can sell / must buy. One row per city.
--   city_trade_offers  standing offers and wants. Append-mostly; a fill is an
--                      UPDATE of `filled_units` and nothing else.
--
-- 🔴 THE CLIENT MUST WORK WITHOUT THIS FILE EVER BEING RUN.
--    CLAUDE.md: "All Supabase access is guarded. The app MUST still work
--    offline / before tables exist, degrading to mock or empty data."
--    /src/economy/trade.js holds NO Supabase calls at all. With no network it
--    trades against SIMULATED partners derived from neighbouring node ids,
--    using the same endowment function real nodes use. This migration upgrades
--    those partners to real cities; it does not enable the feature.
--
-- 🔴 RLS IS THE ENTIRE SECURITY BOUNDARY. Every policy below is scoped by
--    auth.uid(). A missing `using (...)` here is a data breach that looks fine
--    in review — read every line.
--
-- Idempotent and re-runnable. Ends with a verify query.
-- Apply by hand in the Supabase SQL editor for project ktsiasyjusesawtrwrjc.
-- ════════════════════════════════════════════════════════════════════════════

-- ── city_profiles ───────────────────────────────────────────────────────────
create table if not exists public.city_profiles (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references auth.users(id) on delete cascade,
  node_id          text not null,
  city_name        text not null default 'Unnamed City',
  -- Earned, never chosen. See /src/economy/trade.js: a city is known for what
  -- it has actually produced and exported for a sustained period.
  specializations  text[] not null default '{}',
  -- What this city can supply and what it structurally cannot make. Derived
  -- client-side from the node endowment; stored so other players can match
  -- against it without simulating someone else's city.
  sells            jsonb  not null default '{}'::jsonb,
  buys             jsonb  not null default '{}'::jsonb,
  economy_day      integer not null default 0,
  population       integer not null default 0,
  updated_at       timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  -- One profile per city, and a city is one node owned by one player.
  unique (owner_id, node_id)
);

create index if not exists city_profiles_node_idx  on public.city_profiles (node_id);
create index if not exists city_profiles_owner_idx on public.city_profiles (owner_id);
-- Partner discovery reads by specialization; GIN keeps that from scanning.
create index if not exists city_profiles_spec_idx  on public.city_profiles using gin (specializations);

-- ── city_trade_offers ───────────────────────────────────────────────────────
create table if not exists public.city_trade_offers (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  city_id      uuid not null references public.city_profiles(id) on delete cascade,
  side         text not null check (side in ('sell','buy')),
  resource_id  text not null,
  units        numeric not null check (units > 0),
  filled_units numeric not null default 0 check (filled_units >= 0),
  unit_price   numeric not null check (unit_price >= 0),
  -- A gap the city cannot mine at all outbids an ordinary shortfall.
  urgent       boolean not null default false,
  expires_at   timestamptz not null default (now() + interval '7 days'),
  created_at   timestamptz not null default now(),
  -- An offer can never be over-filled. This is the ONLY place that invariant
  -- can be enforced against a concurrent second buyer.
  constraint city_trade_offers_fill_bounds check (filled_units <= units)
);

create index if not exists city_trade_offers_open_idx
  on public.city_trade_offers (resource_id, side, expires_at)
  where filled_units < units;
create index if not exists city_trade_offers_city_idx on public.city_trade_offers (city_id);

-- ════════════════════════════════════════════════════════════════════════════
-- RLS
-- ════════════════════════════════════════════════════════════════════════════
alter table public.city_profiles     enable row level security;
alter table public.city_trade_offers enable row level security;

-- ── city_profiles ───────────────────────────────────────────────────────────
-- READ: any signed-in player may read any city profile. That is the point of
-- the table — you cannot trade with a city you cannot see. It carries no
-- private data: node, name, specializations, and what it trades.
drop policy if exists city_profiles_read on public.city_profiles;
create policy city_profiles_read on public.city_profiles
  for select to authenticated
  using (true);

-- WRITE: only your own, and only ever your own. `with check` on insert stops a
-- player writing a row that claims someone else's owner_id; `using` on
-- update/delete stops them touching a row that is not theirs. Both are needed —
-- `using` alone would let an UPDATE rewrite owner_id and hand the row away.
drop policy if exists city_profiles_insert on public.city_profiles;
create policy city_profiles_insert on public.city_profiles
  for insert to authenticated
  with check (auth.uid() = owner_id);

drop policy if exists city_profiles_update on public.city_profiles;
create policy city_profiles_update on public.city_profiles
  for update to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists city_profiles_delete on public.city_profiles;
create policy city_profiles_delete on public.city_profiles
  for delete to authenticated
  using (auth.uid() = owner_id);

-- ── city_trade_offers ───────────────────────────────────────────────────────
-- READ: open offers are public — a market nobody can read is not a market.
drop policy if exists city_trade_offers_read on public.city_trade_offers;
create policy city_trade_offers_read on public.city_trade_offers
  for select to authenticated
  using (true);

drop policy if exists city_trade_offers_insert on public.city_trade_offers;
create policy city_trade_offers_insert on public.city_trade_offers
  for insert to authenticated
  with check (
    auth.uid() = owner_id
    -- ...and the city you are posting for must actually be yours. Without this
    -- a player could post offers in another city's name.
    and exists (
      select 1 from public.city_profiles p
      where p.id = city_id and p.owner_id = auth.uid()
    )
  );

-- ⚠ UPDATE IS DELIBERATELY OWNER-ONLY, AND FILLING GOES THROUGH THE RPC BELOW.
--   A buyer must be able to fill someone else's offer, but they must NOT be
--   able to UPDATE that row — an open update policy would let them set
--   unit_price to 0 and then fill it. So the counterparty path is a
--   SECURITY DEFINER function with its own checks, and the table itself stays
--   locked to its owner.
drop policy if exists city_trade_offers_update on public.city_trade_offers;
create policy city_trade_offers_update on public.city_trade_offers
  for update to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists city_trade_offers_delete on public.city_trade_offers;
create policy city_trade_offers_delete on public.city_trade_offers
  for delete to authenticated
  using (auth.uid() = owner_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 🤝 FILLING AN OFFER
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER because the buyer legitimately needs to modify a row they
-- do not own, and only in one specific way: raise `filled_units`, never past
-- `units`, never touching price or expiry.
--
-- ⚠ `for update` TAKES THE ROW LOCK. Two players filling the last 40 units of
--   the same offer at the same moment would otherwise both read 0 filled, both
--   write 40, and the seller would ship 80 — the classic double-spend. The
--   lock plus the re-read inside the transaction is what makes the check-then-
--   write atomic. The CHECK constraint above is the second line of defence.
--
-- ⚠ RLS RECURSION (CLAUDE.md): this function reads city_profiles from inside a
--   context that bypasses RLS, which is exactly why it terminates. Do NOT
--   "tidy" it into a policy that queries the same table it guards.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.city_trade_fill(
  p_offer_id uuid,
  p_units    numeric
)
returns table (filled numeric, remaining numeric, unit_price numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer   public.city_trade_offers%rowtype;
  v_take    numeric;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_units is null or p_units <= 0 then
    raise exception 'units must be positive';
  end if;

  select * into v_offer
    from public.city_trade_offers
   where id = p_offer_id
     for update;                      -- ← the lock. See the note above.

  if not found then
    raise exception 'offer not found';
  end if;
  if v_offer.expires_at <= now() then
    raise exception 'offer expired';
  end if;
  -- You cannot trade with yourself. Without this a player could launder goods
  -- between two of their own cities and farm the spread indefinitely.
  if v_offer.owner_id = auth.uid() then
    raise exception 'cannot fill your own offer';
  end if;

  v_take := least(p_units, v_offer.units - v_offer.filled_units);
  if v_take <= 0 then
    raise exception 'offer already filled';
  end if;

  update public.city_trade_offers
     set filled_units = filled_units + v_take
   where id = p_offer_id;

  return query
    select v_take,
           (v_offer.units - v_offer.filled_units - v_take),
           v_offer.unit_price;
end;
$$;

revoke all on function public.city_trade_fill(uuid, numeric) from public;
grant execute on function public.city_trade_fill(uuid, numeric) to authenticated;

-- ── Housekeeping: drop expired, fully-filled offers. Safe to call from
--    anywhere; it can only ever remove rows that are already dead.
create or replace function public.city_trade_sweep()
returns integer
language sql
security definer
set search_path = public
as $$
  with gone as (
    delete from public.city_trade_offers
     where expires_at <= now() - interval '1 day'
        or filled_units >= units
    returning 1
  )
  select coalesce(count(*), 0)::integer from gone;
$$;

revoke all on function public.city_trade_sweep() from public;
grant execute on function public.city_trade_sweep() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ════════════════════════════════════════════════════════════════════════════
select
  (select count(*) from pg_tables
    where schemaname = 'public'
      and tablename in ('city_profiles','city_trade_offers'))               as tables_created,
  (select count(*) from pg_policies
    where schemaname = 'public'
      and tablename in ('city_profiles','city_trade_offers'))               as policies_created,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('city_trade_fill','city_trade_sweep'))              as functions_created,
  (select bool_and(rowsecurity) from pg_tables
    where schemaname = 'public'
      and tablename in ('city_profiles','city_trade_offers'))               as rls_enabled;
-- Expect: tables_created = 2, policies_created = 8, functions_created = 2,
--         rls_enabled = true
