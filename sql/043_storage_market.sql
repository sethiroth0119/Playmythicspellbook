-- ════════════════════════════════════════════════════════════════════════════
-- 043 — STORAGE MARKET: hire warehouse capacity from other players
-- ════════════════════════════════════════════════════════════════════════════
-- Idempotent and re-runnable. Ships its RLS in this file. Ends with a verify.
--
-- ⚠ NUMBERING. 040/041/042 are the Weapon Smith set. Check `ls sql/` before
--   adding another — this repo has already had two files claim one number
--   because branches were cut independently, and the collision is invisible
--   until the wrong migration runs.
--
-- WHAT THIS IS
--   A Warehouse operation raises its owner's resource ceiling by
--   storageBase + workers * storagePerWorker (600 + 260/worker, OPS_ECON).
--   Owners rarely use all of it. This lets them rent the spare out, and lets a
--   player who keeps hitting STASH FULL buy ceiling without founding a
--   280,000 Cinder operation of their own.
--
-- ⚠ CINDER IS NOT SERVER-AUTHORITATIVE. It lives in Profile.gems with a mirror,
--   exactly like every other Cinder award in this app (see the Warpath note in
--   its own migration). So payment is client-credited and these tables are the
--   RECORD of the agreement, not an escrow. Do not read that as an oversight to
--   fix here in isolation: tightening it means moving Cinder itself server-side,
--   which is a much larger change and would have to move every award with it.
--   What the server DOES protect is the thing that can be double-spent for
--   free — units of capacity (see ws_hire below).
--
-- ⚠ APPEND-ONLY. storage_rentals is never UPDATEd to change money or units. A
--   cancellation writes a new row with status 'cancelled'; the live figure is
--   derived. Same rule as corp_treasury.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Listings — spare capacity an owner offers ────────────────────────────
create table if not exists public.storage_listings (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references auth.users(id) on delete cascade,
  op_id             text not null,                       -- the Operations row it belongs to
  owner_name        text not null default 'A keeper',
  units_offered     int  not null check (units_offered >= 0 and units_offered <= 100000),
  price_per_day     int  not null check (price_per_day >= 0 and price_per_day <= 1000000),
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- One listing per operation. A second listing for the same warehouse would
  -- let the same units be offered twice over.
  unique (owner_id, op_id)
);
create index if not exists storage_listings_active_idx
  on public.storage_listings (active, price_per_day) where active;

-- ── 2. Rentals — append-only record of who hired what ───────────────────────
create table if not exists public.storage_rentals (
  id            uuid primary key default gen_random_uuid(),
  listing_id    uuid not null references public.storage_listings(id) on delete cascade,
  owner_id      uuid not null references auth.users(id) on delete cascade,
  renter_id     uuid not null references auth.users(id) on delete cascade,
  units         int  not null check (units > 0),
  days          int  not null check (days > 0 and days <= 90),
  cinder_paid   bigint not null default 0 check (cinder_paid >= 0),
  status        text not null default 'active' check (status in ('active','cancelled','expired')),
  starts_at     timestamptz not null default now(),
  ends_at       timestamptz not null,
  created_at    timestamptz not null default now()
);
create index if not exists storage_rentals_renter_idx on public.storage_rentals (renter_id, status);
create index if not exists storage_rentals_owner_idx  on public.storage_rentals (owner_id, status);
create index if not exists storage_rentals_listing_idx on public.storage_rentals (listing_id, status);

-- ── 3. RLS ──────────────────────────────────────────────────────────────────
alter table public.storage_listings enable row level security;
alter table public.storage_rentals  enable row level security;

/* A marketplace has to be browsable, so an ACTIVE listing is readable by any
   signed-in player. That is the whole point of it. It carries no private data:
   owner_name is a display name the owner chose to publish, and units/price are
   the offer itself. An INACTIVE listing is visible only to its owner, so
   withdrawing an offer actually removes it from view. */
drop policy if exists storage_listings_sel on public.storage_listings;
create policy storage_listings_sel on public.storage_listings
  for select to authenticated
  using (active or owner_id = auth.uid());

drop policy if exists storage_listings_ins on public.storage_listings;
create policy storage_listings_ins on public.storage_listings
  for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists storage_listings_upd on public.storage_listings;
create policy storage_listings_upd on public.storage_listings
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists storage_listings_del on public.storage_listings;
create policy storage_listings_del on public.storage_listings
  for delete to authenticated
  using (owner_id = auth.uid());

/* A rental is visible to exactly the two parties — the renter needs it to know
   their ceiling, the owner needs it to know their income. Nobody else. */
drop policy if exists storage_rentals_sel on public.storage_rentals;
create policy storage_rentals_sel on public.storage_rentals
  for select to authenticated
  using (renter_id = auth.uid() or owner_id = auth.uid());

/* ⚠ NO INSERT / UPDATE / DELETE POLICY ON storage_rentals — deliberately.
   Every write goes through storage_hire() / storage_cancel() below, which are
   security definer. A direct client INSERT could claim more units than the
   listing offers, or hire from itself; the RPC is where that is checked, so
   the client must not be able to route around it. */

-- ── 4. Helper: units already committed on a listing ─────────────────────────
create or replace function public.storage_units_taken(p_listing uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(units), 0)::int
    from public.storage_rentals
   where listing_id = p_listing and status = 'active' and ends_at > now();
$$;

-- ── 5. Hire ────────────────────────────────────────────────────────────────
/* Returns jsonb {ok, ...}. Every refusal is a reason string the client can
   switch on, never an exception — the dialog stays open and explains itself.

   ⚠ THE OVERSELL IS THE ONLY THING THAT MATTERS HERE. Cinder is client-side,
     so this cannot take payment; what it CAN do is stop the same 500 units
     being sold to eight people, which no amount of client code can. The
     listing row is locked FOR UPDATE so two simultaneous hires serialise. */
create or replace function public.storage_hire(p_listing uuid, p_units int, p_days int, p_paid bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_l public.storage_listings;
  v_taken int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  if p_units is null or p_units <= 0 then return jsonb_build_object('ok', false, 'reason', 'bad_units'); end if;
  if p_days is null or p_days <= 0 or p_days > 90 then return jsonb_build_object('ok', false, 'reason', 'bad_days'); end if;

  select * into v_l from public.storage_listings where id = p_listing for update;
  if v_l.id is null then return jsonb_build_object('ok', false, 'reason', 'no_listing'); end if;
  if not v_l.active then return jsonb_build_object('ok', false, 'reason', 'withdrawn'); end if;
  -- Renting your own spare capacity to yourself would raise your ceiling for
  -- free and pay yourself for it.
  if v_l.owner_id = v_uid then return jsonb_build_object('ok', false, 'reason', 'own_listing'); end if;

  v_taken := public.storage_units_taken(p_listing);
  if v_taken + p_units > v_l.units_offered then
    return jsonb_build_object('ok', false, 'reason', 'not_enough_units',
                              'available', greatest(0, v_l.units_offered - v_taken));
  end if;

  insert into public.storage_rentals (listing_id, owner_id, renter_id, units, days, cinder_paid, ends_at)
    values (p_listing, v_l.owner_id, v_uid, p_units, p_days,
            greatest(0, coalesce(p_paid, 0)), now() + (p_days || ' days')::interval);

  return jsonb_build_object('ok', true, 'units', p_units, 'days', p_days,
                            'remaining', v_l.units_offered - v_taken - p_units);
end $$;

-- ── 6. Cancel (append-only: writes a new row, never rewrites the old) ───────
create or replace function public.storage_cancel(p_rental uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_r public.storage_rentals;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  select * into v_r from public.storage_rentals where id = p_rental;
  if v_r.id is null then return jsonb_build_object('ok', false, 'reason', 'no_rental'); end if;
  -- Either party may end it. The renter is giving up ceiling they paid for;
  -- the owner is taking back units they offered.
  if v_r.renter_id <> v_uid and v_r.owner_id <> v_uid then
    return jsonb_build_object('ok', false, 'reason', 'not_yours');
  end if;
  if v_r.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'already_closed'); end if;

  /* The status column is the ONE field allowed to move, and only ever
     active -> cancelled. Units and cinder_paid are the historical record and
     are never touched, so summing the ledger still reconstructs what happened. */
  update public.storage_rentals set status = 'cancelled' where id = p_rental;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.storage_units_taken(uuid) to authenticated;
grant execute on function public.storage_hire(uuid, int, int, bigint) to authenticated;
grant execute on function public.storage_cancel(uuid) to authenticated;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- Counts COLUMNS as well as objects. A verify that only counts tables reports
-- green against a table of the wrong SHAPE — that is exactly how 039 passed
-- while missing two columns the shipped client wrote on every insert.
select
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name in ('storage_listings','storage_rentals'))         as tables_expect_2,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='storage_listings')                                 as listing_cols_expect_9,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='storage_rentals')                                  as rental_cols_expect_11,
  (select count(*) from pg_policies
    where schemaname='public' and tablename in ('storage_listings','storage_rentals'))             as policies_expect_5,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('storage_hire','storage_cancel','storage_units_taken')) as fns_expect_3,
  (select count(*) from pg_tables
    where schemaname='public' and tablename in ('storage_listings','storage_rentals') and rowsecurity) as rls_expect_2;
