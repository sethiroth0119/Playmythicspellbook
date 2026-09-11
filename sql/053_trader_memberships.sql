-- ════════════════════════════════════════════════════════════════════════════
-- 053 — TRADER MEMBERSHIPS: Marketplace listing capacity, bought with AZA
-- ════════════════════════════════════════════════════════════════════════════
-- Run by hand in the Supabase SQL editor for project ktsiasyjusesawtrwrjc.
-- Idempotent and re-runnable. Ends with a verify query. Ships its RLS.
--
-- WHAT IT DOES
--   Every player has 15 Marketplace listing slots for free. Buying a Trader
--   Membership with AZA raises that ceiling. Capacity ONLY — no visibility, no
--   placement, no fee change, no drop rates. A free player sells at the same
--   price as a Market Tycoon.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 THE CAP IS ENFORCED IN THE DATABASE, NOT IN THE UI
--   A listing cap that lives in JavaScript is a suggestion. `card_market_listings`
--   and `resource_listings` are written by the client on its own JWT
--   (index.html ~57387, ~57057 — plain `.insert(row)` calls), so anything the
--   client checks, the client can skip. The BEFORE INSERT triggers below are
--   the actual limit; the UI numbers are a courtesy that happens to agree.
--
--   ⚠ Enforcement is scoped to `auth.uid() = <the row's seller>`. A player can
--     never exceed their OWN cap, while service-role jobs, admin restores and
--     the backfill of an existing table are unaffected — those have no
--     auth.uid() and are not the thing being limited.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠ WHAT COUNTS AS ONE LISTING — and where the three tables came from
--   The brief says "combined active Marketplace listings: cards, resources,
--   equipment, weapons, medicine, crafted items, business resources,
--   collectibles". Those live in THREE tables, read out of the live schema:
--       card_market_listings   seller_id     cards + units      active = 'open'
--       resource_listings      seller_id     resources          active = 'open'
--       boe_market_listings    seller_user   everything else    active = 'active'
--   The active word DIFFERS per table and is taken from the insert sites
--   (index.html ~57385 `status:'open'`, ~60083 `status:'active'`), not guessed
--   from surviving rows — at the time of writing card_market_listings held only
--   'sold' rows and boe_market_listings held none that were live, so inferring
--   from data would have produced a counter that silently matched nothing.
--   `('open','active')` is accepted for all three so a table renaming its live
--   state to the other word keeps working.
--
--   ⚠ DELIBERATELY NOT COUNTED: card_shop_listings (a personal shop, not the
--     player Marketplace), boe_merc_listings (hiring people, not goods), and
--     every city/realty/dojo/storage listing table (different systems with
--     their own limits). Adding one later means adding a trigger AND a term to
--     trader_active_listings — both, or the count and the cap disagree.
--
--   Buying does not consume a slot: only rows where YOU are the seller count.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. THE CATALOGUE ────────────────────────────────────────────────────────
create table if not exists public.trader_membership_tiers (
  id          text primary key,
  name        text        not null,
  slots       int         not null check (slots > 0),
  aza_price   int         not null check (aza_price >= 0),
  sort        int         not null default 0,
  blurb       text
);

insert into public.trader_membership_tiers (id, name, slots, aza_price, sort, blurb) values
  ('survivor',     'Survivor Trader',     15,    0, 1, 'Every survivor can trade. Free, forever.'),
  ('street',       'Street Trader',       35,    9, 2, 'For players beginning to trade regularly.'),
  ('merchant',     'Merchant',            55,   19, 3, 'For established traders, collectors and smaller player businesses.'),
  ('professional', 'Professional Trader', 80,   35, 4, 'For players actively buying, selling, crafting and moving resources.'),
  ('company',      'Trade Company',      140,   69, 5, 'For large player businesses and significant inventories.'),
  ('tycoon',       'Market Tycoon',      300,  125, 6, 'The highest Marketplace membership.')
on conflict (id) do update
  set name = excluded.name, slots = excluded.slots, aza_price = excluded.aza_price,
      sort = excluded.sort, blurb = excluded.blurb;

alter table public.trader_membership_tiers enable row level security;
drop policy if exists trader_tiers_read on public.trader_membership_tiers;
-- A shop catalogue. Readable by anyone, writable by no client.
create policy trader_tiers_read on public.trader_membership_tiers
  for select to anon, authenticated using (true);

-- ── 2. WHO HOLDS WHAT ───────────────────────────────────────────────────────
create table if not exists public.trader_memberships (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  tier        text not null references public.trader_membership_tiers(id),
  aza_paid    int  not null default 0,
  purchased_at timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.trader_memberships enable row level security;
drop policy if exists trader_mem_read on public.trader_memberships;
-- 🔴 SELECT ONLY, AND ONLY YOUR OWN. There is deliberately NO insert/update/
--    delete policy for anon or authenticated: the ONLY way to hold a tier is
--    trader_buy_membership(), which charges for it. A writable table here would
--    let any signed-in player grant themselves Market Tycoon with one PATCH.
create policy trader_mem_read on public.trader_memberships
  for select to authenticated using (auth.uid() = user_id);

revoke truncate, trigger, references on public.trader_memberships       from anon, authenticated;
revoke truncate, trigger, references on public.trader_membership_tiers  from anon, authenticated;

-- ── 3. CAPACITY AND USAGE ───────────────────────────────────────────────────
-- SECURITY DEFINER so the count is complete even where RLS would hide a row
-- from the caller; both only ever answer for ONE user id.
create or replace function public.trader_slots(p_uid uuid)
returns int language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select t.slots
       from public.trader_memberships m
       join public.trader_membership_tiers t on t.id = m.tier
      where m.user_id = p_uid),
    (select slots from public.trader_membership_tiers where id = 'survivor'),
    15)
$$;

create or replace function public.trader_active_listings(p_uid uuid)
returns int language sql stable security definer set search_path to 'public' as $$
  select
    (select count(*) from public.card_market_listings
      where seller_id   = p_uid and coalesce(status,'') in ('open','active'))
  + (select count(*) from public.resource_listings
      where seller_id   = p_uid and coalesce(status,'') in ('open','active'))
  + (select count(*) from public.boe_market_listings
      where seller_user = p_uid and coalesce(status,'') in ('open','active'))
$$;

-- What the Marketplace header renders. One round trip, no client arithmetic.
create or replace function public.trader_membership_status()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_tier text; v_name text; v_slots int; v_used int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  select coalesce(m.tier, 'survivor') into v_tier
    from (select 1) _ left join public.trader_memberships m on m.user_id = v_uid;
  select t.name, t.slots into v_name, v_slots
    from public.trader_membership_tiers t where t.id = coalesce(v_tier, 'survivor');
  v_used := public.trader_active_listings(v_uid);
  return jsonb_build_object(
    'ok', true, 'tier', coalesce(v_tier,'survivor'), 'name', v_name,
    'slots', v_slots, 'used', v_used, 'remaining', greatest(0, v_slots - v_used));
end;
$$;

-- ── 4. THE CAP ITSELF ───────────────────────────────────────────────────────
-- One trigger function for all three tables. TG_ARGV[0] names the seller column
-- because it differs (`seller_id` vs `seller_user`).
create or replace function public.trader_enforce_listing_cap()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_seller uuid;
  v_used   int;
  v_slots  int;
begin
  execute format('select ($1).%I', TG_ARGV[0]) into v_seller using NEW;
  -- Only a live listing occupies a slot, and only the seller's own cap applies.
  if v_seller is null or coalesce(NEW.status,'') not in ('open','active') then return NEW; end if;
  -- See the note in the header: service-role and admin paths are not the thing
  -- being limited, and blocking them would break restores and backfills.
  if auth.uid() is null or auth.uid() <> v_seller then return NEW; end if;

  v_slots := public.trader_slots(v_seller);
  v_used  := public.trader_active_listings(v_seller);
  if v_used >= v_slots then
    raise exception using
      errcode = 'P0001',
      message = format('Marketplace capacity reached: %s of %s active listings.', v_used, v_slots),
      hint    = 'Remove or sell a listing, or upgrade your Trader Membership.';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_trader_cap_cards on public.card_market_listings;
create trigger trg_trader_cap_cards before insert on public.card_market_listings
  for each row execute function public.trader_enforce_listing_cap('seller_id');

drop trigger if exists trg_trader_cap_res on public.resource_listings;
create trigger trg_trader_cap_res before insert on public.resource_listings
  for each row execute function public.trader_enforce_listing_cap('seller_id');

drop trigger if exists trg_trader_cap_boe on public.boe_market_listings;
create trigger trg_trader_cap_boe before insert on public.boe_market_listings
  for each row execute function public.trader_enforce_listing_cap('seller_user');

-- ── 5. BUYING ONE ───────────────────────────────────────────────────────────
/* 🔴 THE CHARGE AND THE GRANT ARE ONE TRANSACTION, and the charge goes through
   `_sov_apply` — the SAME primitive sov_charge() uses — so AZA moves through
   wallet_ledger exactly once and by the same rules. A client-side
   "spendSovereigns() then grant" would be two operations with a window between
   them where the player is out of pocket and holds nothing.
   `_sov_apply` returns NULL when the balance is short; that is the whole
   insufficiency check and it is atomic against concurrent spends. */
create or replace function public.trader_buy_membership(p_tier text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid   uuid := auth.uid();
  v_price int;  v_slots int;  v_name text;
  v_cur   int := 0;
  v_bal   bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;

  select t.aza_price, t.slots, t.name into v_price, v_slots, v_name
    from public.trader_membership_tiers t where t.id = p_tier;
  if v_price is null then return jsonb_build_object('ok', false, 'error', 'unknown_tier'); end if;

  v_cur := public.trader_slots(v_uid);
  -- ⚠ UPGRADES ONLY. Without this a player could "buy" a cheaper tier and cut
  --   their own capacity below their live listings — paying AZA to break their
  --   own shop. Sideways and downward moves are refused, not silently ignored.
  if v_slots <= v_cur then
    return jsonb_build_object('ok', false, 'error', 'not_an_upgrade',
                              'slots', v_cur, 'would_be', v_slots);
  end if;

  if v_price > 0 then
    v_bal := public._sov_apply(v_uid, -v_price, 'trader membership: ' || v_name);
    if v_bal is null then
      return jsonb_build_object('ok', false, 'error', 'insufficient_aza', 'price', v_price);
    end if;
  else
    select coalesce(sovereigns, 0) into v_bal from public.user_progress where user_id = v_uid;
  end if;

  insert into public.trader_memberships (user_id, tier, aza_paid, purchased_at, updated_at)
       values (v_uid, p_tier, v_price, now(), now())
  on conflict (user_id) do update
    set tier = excluded.tier, aza_paid = excluded.aza_paid, updated_at = now();

  return jsonb_build_object('ok', true, 'tier', p_tier, 'name', v_name,
                            'slots', v_slots, 'charged', v_price, 'aza', v_bal,
                            'used', public.trader_active_listings(v_uid));
end;
$$;

revoke all on function public.trader_buy_membership(text)   from anon;
grant execute on function public.trader_buy_membership(text) to authenticated;
grant execute on function public.trader_membership_status()  to authenticated;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
select 'tiers' as what, count(*)::text as v from public.trader_membership_tiers
union all select 'triggers installed',
  (select count(*)::text from pg_trigger
    where tgname in ('trg_trader_cap_cards','trg_trader_cap_res','trg_trader_cap_boe'))
union all select 'free slots',
  (select slots::text from public.trader_membership_tiers where id = 'survivor')
union all select 'write policies on trader_memberships (MUST be 0)',
  (select count(*)::text from pg_policies
    where schemaname='public' and tablename='trader_memberships' and cmd <> 'SELECT');

select id, name, slots, aza_price from public.trader_membership_tiers order by sort;
