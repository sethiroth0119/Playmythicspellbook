-- =============================================================================
-- 🚚 WAREHOUSE STORAGE — player-owned warehouses, rented storage bays, and
-- node-level delivery. A player buys/upgrades a WAREHOUSE, rents numbered BAYS
-- to other live players, and those renters SHIP resources out of their city,
-- house or camp. A truck pulls up at the warehouse; the owner (or a worker)
-- walks the crates off the truck and into the renter's bay.
--
-- Model:
--   wh_warehouses  one per owner. tier 1..5 → how many bays may exist.
--   wh_units       the numbered bays. A bay belongs to ONE renter at a time.
--   wh_shipments   resources in transit. ETA is computed HERE from the origin
--                  node's real, server-side level. Free cities always 72h.
--   wh_crates      a shipment split into carryable crates (the minigame loop).
--   wh_lifters     per-player carry capacity (the weight-lifter tiers).
--
-- ⚠ ECONOMY POSTURE — deliberately STRICTER than tw_node_buy_upgrade / tw_node_ads,
--   which spend client-side and carry a "PRODUCTION HARDENING" note. Everything
--   that moves currency, weight or capacity here happens INSIDE the rpc, in the
--   same transaction as the grant, against public.user_progress (the bulletproof
--   wallet). There is no code path where the client says "I paid" and we believe
--   it. Requires bulletproof_saves.sql (user_progress + wallet_ledger).
--
-- Run ONCE in the Supabase SQL editor (or `supabase db push`). Idempotent.
-- Requires: bulletproof_saves.sql, 20260616000000_tw_node_recon.sql,
--           20260614020000_tw_node_owners.sql, 20260616030000_tw_node_upgrades.sql
-- =============================================================================

-- ─── ⚙ CONFIG — every tunable in ONE place ──────────────────────────────────
-- The client reads these through wh_config() and NEVER hardcodes its own copy,
-- so a price change is a single-file change. Canonical peg (index.html:56557):
--   1 Aza Coin = $1 USD = 5,000 Cinder.
--     • a storage bay is "$10 of Aza"  → 10 Aza  or 50,000 Cinder
--     • every Aza price below has an exactly-pegged Cinder twin.
create or replace function public.wh_config()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'aza_to_cinder', 5000,
    -- 📦 A fresh warehouse starts SMALL — two bays, exactly as designed.
    'start_units', 2,
    'unit_price_aza', 10,
    'unit_price_cinder', 50000,
    'unit_capacity_kg', 500,
    -- 🏗 Warehouse tiers → how many bays may exist at all.
    'tiers', jsonb_build_array(
      jsonb_build_object('tier', 1, 'max_units', 4,  'aza', 0,   'cinder', 0,       'name', 'Lean-To Depot'),
      jsonb_build_object('tier', 2, 'max_units', 8,  'aza', 25,  'cinder', 125000,  'name', 'Sheet-Metal Warehouse'),
      jsonb_build_object('tier', 3, 'max_units', 14, 'aza', 60,  'cinder', 300000,  'name', 'Concrete Distribution Hub'),
      jsonb_build_object('tier', 4, 'max_units', 22, 'aza', 140, 'cinder', 700000,  'name', 'Regional Freight Terminal'),
      jsonb_build_object('tier', 5, 'max_units', 32, 'aza', 300, 'cinder', 1500000, 'name', 'Ashfall Logistics Yard')
    ),
    -- 🏋 Weight lifters — "owners OR workers can buy weight lifters to be able
    -- to hold more". Anyone may buy any tier; tier only ever goes up.
    'lifters', jsonb_build_array(
      jsonb_build_object('tier', 0, 'carry_kg', 25,  'aza', 0,  'cinder', 0,      'name', 'Bare Hands',  'icon', '🖐'),
      jsonb_build_object('tier', 1, 'carry_kg', 45,  'aza', 2,  'cinder', 10000,  'name', 'Back Brace',  'icon', '🎽'),
      jsonb_build_object('tier', 2, 'carry_kg', 90,  'aza', 5,  'cinder', 25000,  'name', 'Hand Truck',  'icon', '🛒'),
      jsonb_build_object('tier', 3, 'carry_kg', 180, 'aza', 12, 'cinder', 60000,  'name', 'Pallet Jack', 'icon', '🛠'),
      jsonb_build_object('tier', 4, 'carry_kg', 400, 'aza', 30, 'cinder', 150000, 'name', 'Forklift',    'icon', '🚜')
    ),
    -- ⚖ Per-resource weight in kg. Ids match the game's salvage ledger
    -- (RESOURCES[] in index.html) — do not invent new ids here.
    'weights', jsonb_build_object(
      'food', 1.2, 'water', 2.0, 'ammo', 0.8, 'medicine', 0.4, 'energyDrink', 0.5,
      'supplies', 1.5, 'metal', 3.5, 'fuel', 3.0,
      'corruptedEssence', 0.6, 'memoryShards', 0.2, 'dna', 0.1
    ),
    'default_weight', 1.0,
    -- 📦 A shipment is split into crates of at most this many kg, so hauling a
    -- big load is a real several-trip job rather than one magic click.
    -- ⚠ THIS MUST STAY <= the tier-0 (Bare Hands) carry limit. It used to be 50
    -- against a 25 kg bare-hands limit, which meant a brand-new player could not
    -- lift a single crate and the minigame did not function until they had paid
    -- 25,000 Cinder for a Hand Truck. The weight limit is meant to make you take
    -- TRIPS, not to paywall the loop.
    'crate_kg', 22,
    -- The most a shipment may weigh in one go. Past this the sender splits it.
    -- Silently truncating a payload is how you make resources disappear.
    -- ⚠ Sized against what a renter can REALISTICALLY have waiting for it. A
    -- tier-1 warehouse is 4 bays x 500 kg, and crate granularity wastes ~17 kg
    -- per bay (floor(500/21) = 23 crates = 483 kg), so 1,932 kg is the real
    -- tier-1 ceiling. 4,000 was more than double that and made "accepted" a
    -- promise the yard could not keep. wh_send_shipment also checks the actual
    -- destination now; this is just the outer bound.
    'max_shipment_kg', 1800,
    -- ⏱ ETA in HOURS by node level. Level 1 = the 72h ceiling; level 10 = 6h.
    -- FREE CITIES (a node with no tw_node_owners row) ALWAYS take 72h.
    -- ⚠ LEVEL 1 MUST BEAT LEVEL 0. They both used to be 72, which made the
    -- promise "the higher the node, the faster the run" false at the bottom of
    -- the range and gave a claimed LV1 node no advantage over an unclaimed one.
    -- 72h is now exactly the FREE-CITY rate and nothing else reaches it.
    'eta_hours', jsonb_build_object(
      '0', 72, '1', 68, '2', 62, '3', 56, '4', 50, '5', 44,
      '6', 37, '7', 30, '8', 22, '9', 14, '10', 6
    ),
    'free_city_hours', 72,
    'max_hours', 72,
    -- 💰 Renting a bay: what the renter pays the warehouse owner per day.
    'rent_cinder_per_day', 1200,
    'rent_max_days', 30,
    -- How long a lapsed renter keeps their goods before the warehouse owner may
    -- impound them. Goods are NEVER silently deleted.
    'rent_grace_days', 3
  );
$$;
grant execute on function public.wh_config() to authenticated, anon;

-- ─── 🏢 wh_warehouses — one per owner ────────────────────────────────────────
create table if not exists public.wh_warehouses (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null unique references auth.users(id) on delete cascade,
  owner_name  text,
  node_id     text,                                    -- District Node it sits in
  tier        integer not null default 1 check (tier between 1 and 5),
  units_total integer not null default 2 check (units_total >= 0),
  open_to_all boolean not null default true,           -- owner accepts new renters
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists wh_warehouses_node_idx on public.wh_warehouses (node_id);

alter table public.wh_warehouses enable row level security;
-- READ: everyone signed in can browse warehouses (that IS the rental market).
drop policy if exists whw_sel on public.wh_warehouses;
create policy whw_sel on public.wh_warehouses for select to authenticated using (true);
-- WRITE: no direct client writes at all. Tier, unit count and creation all move
-- through SECURITY DEFINER rpcs that charge the wallet first.
drop policy if exists whw_ins on public.wh_warehouses;
create policy whw_ins on public.wh_warehouses for insert to authenticated with check (false);
drop policy if exists whw_upd on public.wh_warehouses;
create policy whw_upd on public.wh_warehouses for update to authenticated using (false) with check (false);

-- ─── 📦 wh_units — the numbered storage bays inside a warehouse ──────────────
create table if not exists public.wh_units (
  id           uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.wh_warehouses(id) on delete cascade,
  bay_no       integer not null,
  renter_id    uuid references auth.users(id) on delete set null,
  renter_name  text,
  capacity_kg  numeric not null default 500 check (capacity_kg > 0),
  used_kg      numeric not null default 0 check (used_kg >= 0),
  contents     jsonb   not null default '{}'::jsonb,   -- { resourceId: qty }
  rent_until   timestamptz,
  updated_at   timestamptz not null default now(),
  unique (warehouse_id, bay_no)
);
create index if not exists wh_units_renter_idx on public.wh_units (renter_id);

alter table public.wh_units enable row level security;
-- READ: your own bays, and the bays inside your own warehouse. NOT everyone's.
-- ⚠ This used to be `using (true)`, which quietly undid the masking in
-- wh_warehouse_json: the rpc returned contents {} for other renters and a
-- direct table select returned the real {"metal":100,"medicine":50}. It also
-- handed an attacker a shopping list of which bays were worth diverting.
-- The rental market does NOT need this — wh_directory is SECURITY DEFINER and
-- only ever publishes counts.
drop policy if exists whu_sel on public.wh_units;
create policy whu_sel on public.wh_units for select to authenticated using (
  renter_id = auth.uid()
  or exists (select 1 from public.wh_warehouses w where w.id = warehouse_id and w.owner_id = auth.uid())
);
drop policy if exists whu_ins on public.wh_units;
create policy whu_ins on public.wh_units for insert to authenticated with check (false);
drop policy if exists whu_upd on public.wh_units;
create policy whu_upd on public.wh_units for update to authenticated using (false) with check (false);

-- ─── 🚛 wh_shipments — resources in transit to a warehouse ───────────────────
-- payload is ESCROWED: the client debits the sender's salvage ledger the moment
-- this row is written, and wh_cancel_shipment hands the un-stored remainder
-- straight back, so the resources exist in exactly one place at a time.
--
-- ⚠ KNOWN LIMITATIONS — the complete list, not a flattering subset.
--
--  1. THE SALVAGE LEDGER IS NOT SERVER-SIDE. Cinder and Aza are authoritative
--     (public.user_progress), but the salvage ledger (Profile.salvage —
--     food/metal/fuel/…) has no server-side balance anywhere in this game; it
--     rides inside the profile blob. The server validates the SHAPE of a
--     payload (known ids, positive integers, clamped quantities) and derives
--     its weight and ETA itself, but it CANNOT verify the sender owned the
--     goods: `wh_send_shipment` with {"dna":1000000} from an empty ledger
--     returns ok:true. HARDENING: add a user_resources table + a debit rpc and
--     move the debit into wh_send_shipment's transaction.
--
--  2. THIS MODULE INHERITS TWO HOLES IT DOES NOT OWN, and its economy claims
--     are only as strong as they are:
--       • public.tw_node_owners has `with check (true)` on insert, so any
--         authenticated user can insert themselves as the owner of any node.
--         wh_node_level() reads that table, so node ownership — and therefore
--         a faster ETA — is forgeable until that policy is tightened.
--       • bulletproof_saves.sql's `up_upd` policy lets a player UPDATE their
--         own public.user_progress row directly, so a client can set its own
--         Cinder balance. Every "charged inside the transaction" guarantee
--         below is real, but it is a guarantee about a balance the player can
--         also edit. Fix that policy and the guarantees become absolute.
--
--  3. Bay contents are visible to the WAREHOUSE OWNER by design — they have to
--     see a load to unload it. A renter is trusting the warehouse owner with
--     visibility, exactly as in the real world.
--
-- Everything else in this module is enforced server-side: currency, weight,
-- crate splitting, bay capacity, lifter capacity, bay↔shipment ownership, and
-- the free-city 72h floor.
create table if not exists public.wh_shipments (
  id            uuid primary key default gen_random_uuid(),
  sender_id     uuid not null references auth.users(id) on delete cascade,
  sender_name   text,
  warehouse_id  uuid not null references public.wh_warehouses(id) on delete cascade,
  unit_id       uuid references public.wh_units(id) on delete set null,
  origin_kind   text not null check (origin_kind in ('city', 'house', 'camp')),
  origin_node   text,
  origin_label  text,
  node_level    integer not null default 0,
  free_city     boolean not null default true,
  payload       jsonb not null default '{}'::jsonb,
  weight_kg     numeric not null default 0,
  eta_hours     integer not null default 72,
  sent_at       timestamptz not null default now(),
  eta_at        timestamptz not null,
  status        text not null default 'transit'
                check (status in ('transit', 'arrived', 'stored', 'cancelled')),
  crates_total  integer not null default 0,
  crates_stored integer not null default 0
);
create index if not exists wh_shipments_wh_idx     on public.wh_shipments (warehouse_id, status);
create index if not exists wh_shipments_sender_idx on public.wh_shipments (sender_id, status);

alter table public.wh_shipments enable row level security;
-- READ: the sender, and the warehouse owner who has to unload it.
drop policy if exists whs_sel on public.wh_shipments;
create policy whs_sel on public.wh_shipments for select to authenticated using (
  sender_id = auth.uid()
  or exists (select 1 from public.wh_warehouses w where w.id = warehouse_id and w.owner_id = auth.uid())
);
drop policy if exists whs_ins on public.wh_shipments;
create policy whs_ins on public.wh_shipments for insert to authenticated with check (false);
drop policy if exists whs_upd on public.wh_shipments;
create policy whs_upd on public.wh_shipments for update to authenticated using (false) with check (false);

-- ─── 📦 wh_crates — one carryable crate off the truck ────────────────────────
create table if not exists public.wh_crates (
  id          uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.wh_shipments(id) on delete cascade,
  crate_no    integer not null,
  payload     jsonb not null default '{}'::jsonb,
  weight_kg   numeric not null default 0,
  stored      boolean not null default false,
  stored_at   timestamptz,
  unique (shipment_id, crate_no)
);
create index if not exists wh_crates_ship_idx on public.wh_crates (shipment_id, stored);

alter table public.wh_crates enable row level security;
drop policy if exists whc_sel on public.wh_crates;
create policy whc_sel on public.wh_crates for select to authenticated using (
  exists (
    select 1 from public.wh_shipments s
    join public.wh_warehouses w on w.id = s.warehouse_id
    where s.id = shipment_id and (s.sender_id = auth.uid() or w.owner_id = auth.uid())
  )
);
drop policy if exists whc_ins on public.wh_crates;
create policy whc_ins on public.wh_crates for insert to authenticated with check (false);
drop policy if exists whc_upd on public.wh_crates;
create policy whc_upd on public.wh_crates for update to authenticated using (false) with check (false);

-- ─── 🏋 wh_lifters — a player's carry capacity ───────────────────────────────
create table if not exists public.wh_lifters (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  tier       integer not null default 0 check (tier between 0 and 4),
  updated_at timestamptz not null default now()
);
alter table public.wh_lifters enable row level security;
drop policy if exists whl_sel on public.wh_lifters;
create policy whl_sel on public.wh_lifters for select to authenticated using (user_id = auth.uid());
drop policy if exists whl_ins on public.wh_lifters;
create policy whl_ins on public.wh_lifters for insert to authenticated with check (false);
drop policy if exists whl_upd on public.wh_lifters;
create policy whl_upd on public.wh_lifters for update to authenticated using (false) with check (false);

-- ═══════════════════════════════════════════════════════════════════════════
-- INTERNALS
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 💳 _wh_charge — the ONLY way this module moves money ────────────────────
-- Atomically deducts Cinder or Aza (sovereigns) from public.user_progress and
-- writes a wallet_ledger row. Returns true only if the deduction actually
-- happened. Called INSIDE the same transaction as whatever it is buying, so a
-- failure anywhere rolls the payment back with it.
create or replace function public._wh_charge(p_uid uuid, p_currency text, p_amount bigint, p_reason text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_bal bigint;
begin
  if p_uid is null or p_amount is null then return false; end if;
  if p_amount = 0 then return true; end if;
  if p_amount < 0 then return false; end if;
  insert into public.user_progress (user_id) values (p_uid) on conflict do nothing;
  if p_currency = 'aza' then
    update public.user_progress set sovereigns = sovereigns - p_amount, updated_at = now()
      where user_id = p_uid and sovereigns >= p_amount returning sovereigns into v_bal;
    if v_bal is null then return false; end if;
    insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason)
      values (p_uid, 'charge', 'sovereigns', -p_amount, v_bal, p_reason);
  else
    update public.user_progress set cinder = cinder - p_amount, updated_at = now()
      where user_id = p_uid and cinder >= p_amount returning cinder into v_bal;
    if v_bal is null then return false; end if;
    insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason)
      values (p_uid, 'charge', 'cinder', -p_amount, v_bal, p_reason);
  end if;
  return true;
end; $$;
revoke all on function public._wh_charge(uuid, text, bigint, text) from public, authenticated, anon;

-- ─── 💰 _wh_credit — pay a warehouse owner their rent ────────────────────────
create or replace function public._wh_credit(p_uid uuid, p_currency text, p_amount bigint, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_bal bigint;
begin
  if p_uid is null or coalesce(p_amount, 0) <= 0 then return; end if;
  insert into public.user_progress (user_id) values (p_uid) on conflict do nothing;
  if p_currency = 'aza' then
    update public.user_progress set sovereigns = sovereigns + p_amount, updated_at = now()
      where user_id = p_uid returning sovereigns into v_bal;
    insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason)
      values (p_uid, 'credit', 'sovereigns', p_amount, v_bal, p_reason);
  else
    update public.user_progress set cinder = cinder + p_amount, updated_at = now()
      where user_id = p_uid returning cinder into v_bal;
    insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason)
      values (p_uid, 'credit', 'cinder', p_amount, v_bal, p_reason);
  end if;
end; $$;
revoke all on function public._wh_credit(uuid, text, bigint, text) from public, authenticated, anon;

-- ─── 🏳 wh_node_level — the REAL, server-side level of a District Node ───────
-- Built on node state the server already owns and the client cannot forge:
--   tw_node_owners  → is this node CLAIMED at all? No row = a FREE CITY.
--   tw_node_recon   → garrison / refinery / civic, each 0..5 and each only ever
--                     raised by tw_node_buy_upgrade. Level = 1 + their sum,
--                     clamped to 1..10 (the game's NODE_MAX_LEVEL).
--   economy_nodes   → when the id is a corp economy node uuid, its own `level`
--                     column wins if it is higher.
-- Returns 0 for a free/unclaimed city, which the ETA table maps to the 72h ceiling.
create or replace function public.wh_node_level(p_node_id text)
returns integer language plpgsql stable security definer set search_path = public as $$
declare v_owned boolean := false; v_lvl integer := 0; v_up integer := 0; v_en integer := 0;
begin
  if p_node_id is null or length(trim(p_node_id)) = 0 then return 0; end if;
  select exists (select 1 from public.tw_node_owners o where o.node_id = p_node_id) into v_owned;
  if not v_owned then return 0; end if;   -- 🆓 free city → always the 72h ceiling
  select 1 + coalesce(garrison, 0) + coalesce(refinery, 0) + coalesce(civic, 0)
    into v_up from public.tw_node_recon r where r.node_id = p_node_id;
  v_lvl := greatest(1, coalesce(v_up, 1));
  -- Corp economy nodes carry their own authoritative level column.
  begin
    if p_node_id ~ '^[0-9a-fA-F-]{36}$' then
      select level into v_en from public.economy_nodes e where e.id = p_node_id::uuid;
      if coalesce(v_en, 0) > v_lvl then v_lvl := v_en; end if;
    end if;
  exception when others then null;        -- economy_nodes not installed → ignore
  end;
  return greatest(1, least(10, v_lvl));
end; $$;
grant execute on function public.wh_node_level(text) to authenticated;

-- ─── 🪪 _wh_display_name — the caller's REAL name, never the one they claim ──
-- ⚠ Every display identity in this module used to be a client-supplied p_name
-- written straight into owner_name / renter_name / sender_name, unchecked and
-- uncapped. Executed against the previous build:
--     Bob → wh_my_warehouse('Alice')          → owner_name 'Alice'
--     Bob → wh_rent_unit(…, 'Alice (Staff)')  → Alice sees her own bay rented
--                                               by "Alice (Staff)"
--     Bob → wh_send_shipment(…, '<b>MODERATOR</b>')
--     Bob → wh_my_warehouse(repeat('A',1000000)) → accepted, and every shopper
--           downloaded the megabyte back out of the un-paginated directory
-- Two rounds were spent masking owner_id / renter_id so nobody can LEARN who
-- someone is; leaving the write side open meant anyone could ASSERT they were
-- anyone, which is strictly worse. Names now come from public.user_profiles —
-- the same row the rest of the game treats as a player's identity — and the
-- p_name arguments are accepted for signature compatibility and IGNORED.
create or replace function public._wh_display_name(p_uid uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_name text;
begin
  if p_uid is null then return null; end if;
  begin
    select nullif(btrim(up.display_name), '') into v_name
      from public.user_profiles up where up.user_id = p_uid;
  exception when undefined_table or undefined_column then v_name := null;
  end;
  -- Strip control characters and hard-cap the length, so even a compromised
  -- profile row cannot become a payload or a banner.
  v_name := left(regexp_replace(coalesce(v_name, ''), '[\x00-\x1F\x7F]', '', 'g'), 40);
  if v_name = '' then v_name := 'Player ' || left(p_uid::text, 8); end if;
  return v_name;
end; $$;
revoke all on function public._wh_display_name(uuid) from public, anon, authenticated;

-- ─── 🔗 wh_player_at_node — is this player REALLY attached to that node? ────
-- p_node_id arrives from the client, so on its own it proves nothing: an
-- earlier build let a player ship out of their own camp while naming a rich
-- stranger's LV10 node and collect a 6-hour run. We check the relationships the
-- server already records:
--   tw_camp_registrations  their camp is registered at the node
--   tw_node_residency      one of their houses is stationed there
--   tw_node_owners         they own the node
--   city_node_links        their city is linked to it
-- An unverifiable claim is deliberately NOT an error — wh_send_shipment treats
-- it as a free city and charges the full 72 hours, so forging a node id can
-- only ever make your delivery slower.
create or replace function public.wh_player_at_node(p_uid uuid, p_node_id text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_hit boolean := false;
begin
  if p_uid is null or p_node_id is null or length(trim(p_node_id)) = 0 then return false; end if;
  begin
    select exists (select 1 from public.tw_camp_registrations r
                    where r.node_id = p_node_id and r.user_id = p_uid) into v_hit;
  exception when undefined_table or undefined_column then v_hit := false; end;
  if v_hit then return true; end if;
  begin
    select exists (select 1 from public.tw_node_residency r
                    where r.node_id = p_node_id and r.user_id = p_uid and r.residents > 0) into v_hit;
  exception when undefined_table or undefined_column then v_hit := false; end;
  if v_hit then return true; end if;
  begin
    select exists (select 1 from public.tw_node_owners o
                    where o.node_id = p_node_id and o.user_id = p_uid) into v_hit;
  exception when undefined_table or undefined_column then v_hit := false; end;
  if v_hit then return true; end if;
  begin
    if p_node_id ~ '^[0-9a-fA-F-]{36}$' then
      select exists (select 1 from public.city_node_links c
                      where c.node_id = p_node_id::uuid and c.user_id = p_uid) into v_hit;
    end if;
  exception when undefined_table or undefined_column then v_hit := false; end;
  return coalesce(v_hit, false);
end; $$;
-- ⚠ NOT granted to authenticated. It takes an arbitrary user id, so exposing it
-- let any player map any OTHER player's camp registrations and residency:
-- wh_player_at_node(carol, 'node-rich') answered `t` when called by Alice.
-- Only wh_send_shipment needs it, and that runs SECURITY DEFINER.
revoke all on function public.wh_player_at_node(uuid, text) from public, anon, authenticated;

-- ─── ⏱ wh_eta_hours — hours for a delivery, from the config table ───────────
create or replace function public.wh_eta_hours(p_level integer)
returns integer language sql stable as $$
  select coalesce(
    ((public.wh_config() -> 'eta_hours') ->> greatest(0, least(10, coalesce(p_level, 0)))::text)::integer,
    72);
$$;
grant execute on function public.wh_eta_hours(integer) to authenticated;

-- ─── ⚖ _wh_weight — server-side weight of a payload. NEVER client-supplied ───
create or replace function public._wh_weight(p_payload jsonb)
returns numeric language sql stable as $$
  select coalesce(sum(
    greatest(0, (value)::numeric)
    * coalesce(((public.wh_config() -> 'weights') ->> key)::numeric,
               (public.wh_config() ->> 'default_weight')::numeric)
  ), 0)
  from jsonb_each_text(coalesce(p_payload, '{}'::jsonb));
$$;
grant execute on function public._wh_weight(jsonb) to authenticated;

-- ─── 🧹 _wh_sane_payload — reject junk before it becomes weight ──────────────
-- Keeps only positive integer quantities for ids the weight table knows about,
-- capped so nobody ships 10^12 of anything.
create or replace function public._wh_sane_payload(p_payload jsonb)
returns jsonb language sql stable as $$
  select coalesce(jsonb_object_agg(key, qty), '{}'::jsonb) from (
    select key, least(1000000, floor((value)::numeric))::bigint as qty
    from jsonb_each_text(coalesce(p_payload, '{}'::jsonb))
    where (public.wh_config() -> 'weights') ? key
      and (value ~ '^[0-9]+(\.[0-9]+)?$')
      and floor((value)::numeric) >= 1
  ) t;
$$;
grant execute on function public._wh_sane_payload(jsonb) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- PUBLIC RPCs
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 🏢 wh_my_warehouse — get-or-create the caller's warehouse + its bays ────
create or replace function public.wh_my_warehouse(p_name text default null, p_node_id text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_w public.wh_warehouses; v_start integer;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  select * into v_w from public.wh_warehouses where owner_id = v_uid;
  if not found then
    v_start := (public.wh_config() ->> 'start_units')::integer;
    -- p_name is ignored (see _wh_display_name). p_node_id is only kept when the
    -- player can actually be shown to be attached to that node — otherwise a
    -- player could plant their building in someone else's LV10 district and
    -- have the directory report it as provenance.
    insert into public.wh_warehouses (owner_id, owner_name, node_id, units_total)
      values (v_uid, public._wh_display_name(v_uid),
              case when public.wh_player_at_node(v_uid, p_node_id) then p_node_id else null end,
              v_start) returning * into v_w;
    -- 📦 The starting bays. Small on purpose — the player buys their way up.
    insert into public.wh_units (warehouse_id, bay_no, capacity_kg)
      select v_w.id, g, (public.wh_config() ->> 'unit_capacity_kg')::numeric
      from generate_series(1, v_start) g;
  else
    -- Keep the stored name in step with the profile (not with whatever the
    -- client last sent), and adopt a node the player can actually be shown to
    -- be attached to. Setting node_id only on CREATE meant a player who
    -- registered at a district AFTER building their warehouse could never
    -- record it.
    update public.wh_warehouses set
      owner_name = public._wh_display_name(v_uid),
      node_id = case when public.wh_player_at_node(v_uid, p_node_id) then p_node_id else node_id end,
      updated_at = now()
    where id = v_w.id returning * into v_w;
  end if;
  return public.wh_warehouse_json(v_w.id);
end; $$;
grant execute on function public.wh_my_warehouse(text, text) to authenticated;

-- ─── 📄 wh_warehouse_json — the whole warehouse as ONE payload ───────────────
-- Bays, live shipments and their un-stored crates, plus the caller's lifter and
-- wallet, so the minigame boots from a single round-trip.
create or replace function public.wh_warehouse_json(p_warehouse_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_w public.wh_warehouses; v_is_owner boolean;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  select * into v_w from public.wh_warehouses where id = p_warehouse_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_warehouse'); end if;
  v_is_owner := (v_w.owner_id = v_uid);
  return jsonb_build_object(
    'ok', true,
    'is_owner', v_is_owner,
    'config', public.wh_config(),
    'warehouse', jsonb_build_object(
      -- The owner's raw auth.users id is the same class of identifier we mask
      -- for renters; `is_owner` already tells the caller what they need.
      'id', v_w.id, 'owner_id', case when v_is_owner then v_w.owner_id else null end,
      'owner_name', v_w.owner_name,
      'node_id', v_w.node_id, 'tier', v_w.tier, 'units_total', v_w.units_total,
      'max_units', ((public.wh_config() -> 'tiers') -> (v_w.tier - 1) ->> 'max_units')::integer,
      'open_to_all', v_w.open_to_all),
    'units', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', u.id, 'bay_no', u.bay_no,
        -- ⚠ MASKED. Tightening the table RLS moved this leak into the rpc and
        -- made it worse: any authenticated player could read a warehouse id out
        -- of wh_directory() and pull back, per bay, the renter's RAW auth.users
        -- id, their name, how full their bay was and when their rent expired.
        -- Exporting another player's auth uid is worse than the contents leak
        -- it replaced, and used_kg + identity IS the "which bays are worth
        -- diverting" list this module claims not to publish. You see a bay's
        -- occupant only if you own the building or rent that bay.
        'renter_id',   case when v_is_owner or u.renter_id = v_uid then u.renter_id   else null end,
        'renter_name', case when v_is_owner or u.renter_id = v_uid then u.renter_name else null end,
        'used_kg',     case when v_is_owner or u.renter_id = v_uid then u.used_kg     else null end,
        'rent_until',  case when v_is_owner or u.renter_id = v_uid then u.rent_until  else null end,
        'occupied',    (u.renter_id is not null),
        -- Masked too: capacity ranks the bays by who has paid to expand.
        'capacity_kg', case when v_is_owner or u.renter_id = v_uid then u.capacity_kg else null end,
        'contents', case when v_is_owner or u.renter_id = v_uid then u.contents else '{}'::jsonb end,
        -- `= v_uid` on a NULL renter_id yields NULL, not false. An unrented bay
        -- is not 'maybe mine'.
        'mine', coalesce(u.renter_id = v_uid, false)
      ) order by u.bay_no) from public.wh_units u where u.warehouse_id = v_w.id), '[]'::jsonb),
    'shipments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'sender_name', s.sender_name, 'unit_id', s.unit_id,
        'origin_kind', s.origin_kind, 'origin_label', s.origin_label,
        'node_level', s.node_level, 'free_city', s.free_city,
        'eta_hours', s.eta_hours, 'eta_at', s.eta_at, 'sent_at', s.sent_at,
        'weight_kg', s.weight_kg, 'status', case when s.status = 'transit' and s.eta_at <= now() then 'arrived' else s.status end,
        'crates_total', s.crates_total, 'crates_stored', s.crates_stored,
        'crates', coalesce((select jsonb_agg(jsonb_build_object(
            'id', c.id, 'crate_no', c.crate_no, 'payload', c.payload, 'weight_kg', c.weight_kg)
            order by c.crate_no)
          from public.wh_crates c where c.shipment_id = s.id and c.stored = false), '[]'::jsonb)
      ) order by s.eta_at)
      from public.wh_shipments s
      where s.warehouse_id = v_w.id and s.status in ('transit', 'arrived')
        and (v_is_owner or s.sender_id = v_uid)), '[]'::jsonb),
    'lifter_tier', coalesce((select tier from public.wh_lifters where user_id = v_uid), 0),
    'wallet', (select jsonb_build_object('cinder', cinder, 'aza', sovereigns)
               from public.user_progress where user_id = v_uid)
  );
end; $$;
grant execute on function public.wh_warehouse_json(uuid) to authenticated;

-- ─── 🗂 wh_directory — warehouses a player could rent a bay in ───────────────
-- Drop the pre-pagination signature, or both overloads coexist and every
-- wh_directory() call fails with "function is not unique".
drop function if exists public.wh_directory();
-- ⚠ PAGINATED. One un-paginated global list meant every shopper downloaded
-- every warehouse row — and one player storing a megabyte in their own name
-- made that everyone else's bandwidth problem.
create or replace function public.wh_directory(p_limit integer default 25, p_offset integer default 0)
returns jsonb language sql stable security definer set search_path = public as $$
  -- The page is selected FIRST, then aggregated. Aggregating and then limiting
  -- would still have built the whole list server-side.
  select coalesce((select jsonb_agg(t.row) from (
    select jsonb_build_object(
      'id', w.id, 'owner_id', w.owner_id, 'owner_name', w.owner_name,
      'node_id', w.node_id, 'tier', w.tier, 'units_total', w.units_total,
      'free_units', (select count(*) from public.wh_units u
                      where u.warehouse_id = w.id
                        and (u.renter_id is null
                             or (u.rent_until < now() - ((public.wh_config() ->> 'rent_grace_days')::int || ' days')::interval
                                 and u.contents = '{}'::jsonb))),
      'my_units', (select count(*) from public.wh_units u
                    where u.warehouse_id = w.id and u.renter_id = auth.uid()
                      and (u.rent_until is null or u.rent_until > now()))
    ) as row
    from public.wh_warehouses w
    where w.open_to_all = true and w.owner_id is distinct from auth.uid()
    order by w.tier desc, w.created_at
    limit greatest(1, least(50, coalesce(p_limit, 25)))
    offset greatest(0, coalesce(p_offset, 0))
  ) t), '[]'::jsonb);
$$;
grant execute on function public.wh_directory(integer, integer) to authenticated;

-- ─── 💸 wh_buy_unit — "You need to open storage unit space" ──────────────────
-- 10 Aza OR 50,000 Cinder (the exact $10 peg). Charged inside the transaction;
-- refuses past the current tier's bay cap.
create or replace function public.wh_buy_unit(p_currency text default 'cinder')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_w public.wh_warehouses;
  v_cfg jsonb := public.wh_config(); v_cur text; v_cost bigint; v_max integer; v_next integer;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  v_cur := case when p_currency = 'aza' then 'aza' else 'cinder' end;
  select * into v_w from public.wh_warehouses where owner_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_warehouse'); end if;
  v_max := ((v_cfg -> 'tiers') -> (v_w.tier - 1) ->> 'max_units')::integer;
  if v_w.units_total >= v_max then
    return jsonb_build_object('ok', false, 'reason', 'tier_cap', 'tier', v_w.tier, 'max_units', v_max);
  end if;
  v_cost := (v_cfg ->> (case when v_cur = 'aza' then 'unit_price_aza' else 'unit_price_cinder' end))::bigint;
  if not public._wh_charge(v_uid, v_cur, v_cost, 'Warehouse: open storage unit space') then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'currency', v_cur, 'cost', v_cost);
  end if;
  v_next := v_w.units_total + 1;
  insert into public.wh_units (warehouse_id, bay_no, capacity_kg)
    values (v_w.id, coalesce((select max(bay_no) from public.wh_units where warehouse_id = v_w.id), 0) + 1,
            (v_cfg ->> 'unit_capacity_kg')::numeric);
  update public.wh_warehouses set units_total = v_next, updated_at = now() where id = v_w.id;
  return public.wh_warehouse_json(v_w.id) || jsonb_build_object('bought', true, 'spent', v_cost, 'currency', v_cur);
end; $$;
grant execute on function public.wh_buy_unit(text) to authenticated;

-- ─── 📦 wh_expand_unit — GROW an existing bay ───────────────────────────────
-- ⚠ This exists because the no-room modal was selling a non-fix. It charged the
-- 10 Aza / 50,000 Cinder and called wh_buy_unit, which adds a brand-new UNRENTED
-- bay — and the crate in your hands is addressed to the renter's bay, so
-- wh_store_crate still refused it with `wrong_unit`. The player paid and the
-- load remained stranded. Opening storage unit space now means what it says:
-- the ADDRESSED bay gets another unit_capacity_kg of room, for the same price.
-- Either the warehouse owner (who is stood there holding the crate) or the bay's
-- own renter may pay.
create or replace function public.wh_expand_unit(p_unit_id uuid, p_currency text default 'cinder')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_u public.wh_units; v_w public.wh_warehouses;
  v_cfg jsonb := public.wh_config(); v_cur text; v_cost bigint; v_add numeric;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  v_cur := case when p_currency = 'aza' then 'aza' else 'cinder' end;
  select * into v_u from public.wh_units where id = p_unit_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_unit'); end if;
  select * into v_w from public.wh_warehouses where id = v_u.warehouse_id;
  if v_w.owner_id is distinct from v_uid and v_u.renter_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  -- ⚠ THE RENTAL MUST BE CURRENT. wh_send_shipment and wh_store_crate both gate
  -- on rent_until; this one did not, and that is precisely the bug this function
  -- exists to fix — paying for capacity that cannot help the payer. Measured: a
  -- renter ten days past expiry was charged 150,000 Cinder to grow a bay she
  -- could neither send to (not_your_unit) nor store into (rental_expired). The
  -- owner then impounded it and the next tenant got a 2,000 kg bay for the price
  -- of a 500 kg one.
  if v_u.renter_id is not null and v_u.rent_until is not null and v_u.rent_until < now() then
    return jsonb_build_object('ok', false, 'reason', 'rental_expired', 'rent_until', v_u.rent_until);
  end if;
  -- A bay may be expanded up to four times its original size; past that the
  -- warehouse needs more bays, not a bottomless one.
  v_add := (v_cfg ->> 'unit_capacity_kg')::numeric;
  if v_u.capacity_kg >= v_add * 4 then
    return jsonb_build_object('ok', false, 'reason', 'bay_maxed', 'capacity_kg', v_u.capacity_kg);
  end if;
  v_cost := (v_cfg ->> (case when v_cur = 'aza' then 'unit_price_aza' else 'unit_price_cinder' end))::bigint;
  if not public._wh_charge(v_uid, v_cur, v_cost, 'Warehouse: open storage unit space (bay ' || v_u.bay_no || ')') then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'currency', v_cur, 'cost', v_cost);
  end if;
  update public.wh_units set capacity_kg = capacity_kg + v_add, updated_at = now() where id = v_u.id;
  return jsonb_build_object('ok', true, 'unit_id', v_u.id, 'bay_no', v_u.bay_no,
    'capacity_kg', v_u.capacity_kg + v_add, 'used_kg', v_u.used_kg,
    'spent', v_cost, 'currency', v_cur,
    'wallet', (select jsonb_build_object('cinder', cinder, 'aza', sovereigns)
               from public.user_progress where user_id = v_uid));
end; $$;
grant execute on function public.wh_expand_unit(uuid, text) to authenticated;

-- ─── 🏗 wh_upgrade_tier — a bigger building holds more bays ──────────────────
create or replace function public.wh_upgrade_tier(p_currency text default 'cinder')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_w public.wh_warehouses;
  v_cfg jsonb := public.wh_config(); v_cur text; v_cost bigint; v_next integer; v_row jsonb;
  v_max integer; v_seed integer;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  v_cur := case when p_currency = 'aza' then 'aza' else 'cinder' end;
  select * into v_w from public.wh_warehouses where owner_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_warehouse'); end if;
  v_next := v_w.tier + 1;
  if v_next > 5 then return jsonb_build_object('ok', false, 'reason', 'max_tier'); end if;
  v_row := (v_cfg -> 'tiers') -> (v_next - 1);
  v_cost := (v_row ->> (case when v_cur = 'aza' then 'aza' else 'cinder' end))::bigint;
  if not public._wh_charge(v_uid, v_cur, v_cost, 'Warehouse: upgrade to ' || (v_row ->> 'name')) then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'currency', v_cur, 'cost', v_cost);
  end if;
  update public.wh_warehouses set tier = v_next, updated_at = now() where id = v_w.id;
  -- ⚠ AN UPGRADE MUST DELIVER STORAGE, NOT A NUMBER. This used to raise `tier`
  -- and stop: the cap went 4 → 8 while the warehouse still had its original 2
  -- bays, the HUD then advertised 6 slots that could never be filled, and at
  -- tier 5 that was 1,500,000 Cinder for "Bays 2/32". The clause is "upgrade the
  -- building to store MORE storage for other players", so the building now
  -- physically gains bays. Two come with the upgrade; the rest of the new cap
  -- stays buyable through wh_buy_unit.
  v_max  := (v_row ->> 'max_units')::integer;
  v_seed := least(v_max, v_w.units_total + 2);
  if v_seed > v_w.units_total then
    insert into public.wh_units (warehouse_id, bay_no, capacity_kg)
      select v_w.id,
             coalesce((select max(bay_no) from public.wh_units where warehouse_id = v_w.id), 0) + g,
             (v_cfg ->> 'unit_capacity_kg')::numeric
      from generate_series(1, v_seed - v_w.units_total) g;
    update public.wh_warehouses set units_total = v_seed where id = v_w.id;
  end if;
  return public.wh_warehouse_json(v_w.id)
    || jsonb_build_object('upgraded', v_next, 'spent', v_cost, 'currency', v_cur,
                          'bays_added', v_seed - v_w.units_total);
end; $$;
grant execute on function public.wh_upgrade_tier(text) to authenticated;

-- ─── 🏋 wh_buy_lifter — owners OR workers raise their carry capacity ─────────
create or replace function public.wh_buy_lifter(p_tier integer, p_currency text default 'cinder')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_cfg jsonb := public.wh_config(); v_cur text;
  v_have integer; v_cost bigint; v_row jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  if p_tier is null or p_tier < 1 or p_tier > 4 then return jsonb_build_object('ok', false, 'reason', 'bad_tier'); end if;
  v_cur := case when p_currency = 'aza' then 'aza' else 'cinder' end;
  insert into public.wh_lifters (user_id) values (v_uid) on conflict do nothing;
  select tier into v_have from public.wh_lifters where user_id = v_uid for update;
  if coalesce(v_have, 0) >= p_tier then
    return jsonb_build_object('ok', false, 'reason', 'already_owned', 'tier', v_have);
  end if;
  v_row := (v_cfg -> 'lifters') -> p_tier;
  v_cost := (v_row ->> (case when v_cur = 'aza' then 'aza' else 'cinder' end))::bigint;
  if not public._wh_charge(v_uid, v_cur, v_cost, 'Warehouse: ' || (v_row ->> 'name')) then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'currency', v_cur, 'cost', v_cost);
  end if;
  update public.wh_lifters set tier = p_tier, updated_at = now() where user_id = v_uid;
  return jsonb_build_object('ok', true, 'tier', p_tier,
    'carry_kg', (v_row ->> 'carry_kg')::numeric, 'spent', v_cost, 'currency', v_cur,
    'wallet', (select jsonb_build_object('cinder', cinder, 'aza', sovereigns)
               from public.user_progress where user_id = v_uid));
end; $$;
grant execute on function public.wh_buy_lifter(integer, text) to authenticated;

-- ─── 🔑 wh_rent_unit — rent a bay in someone else's warehouse ────────────────
-- The renter pays Cinder; the warehouse owner is credited the same amount in the
-- SAME transaction (no "collect on next fetch" escrow to go wrong).
create or replace function public.wh_rent_unit(p_warehouse_id uuid, p_days integer default 7, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_w public.wh_warehouses; v_u public.wh_units;
  v_cfg jsonb := public.wh_config(); v_days integer; v_cost bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  v_days := greatest(1, least((v_cfg ->> 'rent_max_days')::integer, coalesce(p_days, 7)));
  select * into v_w from public.wh_warehouses where id = p_warehouse_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_warehouse'); end if;
  if v_w.owner_id = v_uid then return jsonb_build_object('ok', false, 'reason', 'own_warehouse'); end if;
  if not v_w.open_to_all then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  -- Claim the lowest-numbered genuinely free bay. FOR UPDATE SKIP LOCKED so two
  -- players racing for the last bay can never both win it.
  -- ⚠ A bay is only FREE if it is empty. An earlier build re-rented any bay
  -- whose rent_until had passed and wiped `contents` to '{}' as it did so —
  -- one second past expiry and another player's goods were gone, irrecoverably.
  -- Now: goods are never destroyed by a rental change. A lapsed bay that still
  -- holds something stays with its renter (who can still wh_withdraw it) until
  -- the warehouse owner impounds it via wh_impound_unit after the grace period.
  select * into v_u from public.wh_units
    where warehouse_id = v_w.id
      and (renter_id is null
           or (rent_until < now() - ((v_cfg ->> 'rent_grace_days')::int || ' days')::interval
               and contents = '{}'::jsonb))
    order by bay_no limit 1 for update skip locked;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_free_unit'); end if;
  v_cost := (v_cfg ->> 'rent_cinder_per_day')::bigint * v_days;
  if not public._wh_charge(v_uid, 'cinder', v_cost, 'Warehouse: rent bay ' || v_u.bay_no) then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'currency', 'cinder', 'cost', v_cost);
  end if;
  perform public._wh_credit(v_w.owner_id, 'cinder', v_cost, 'Warehouse: bay ' || v_u.bay_no || ' rented');
  update public.wh_units set
    renter_id = v_uid, renter_name = public._wh_display_name(v_uid),
    rent_until = greatest(coalesce(rent_until, now()), now()) + (v_days || ' days')::interval,
    updated_at = now()
  where id = v_u.id;
  return jsonb_build_object('ok', true, 'warehouse_id', v_w.id, 'unit_id', v_u.id,
    'bay_no', v_u.bay_no, 'days', v_days, 'spent', v_cost, 'currency', 'cinder',
    'wallet', (select jsonb_build_object('cinder', cinder, 'aza', sovereigns)
               from public.user_progress where user_id = v_uid));
end; $$;
grant execute on function public.wh_rent_unit(uuid, integer, text) to authenticated;

-- ─── 📋 wh_my_rentals — bays this player rents, anywhere ─────────────────────
-- Drives the camp/city/house button label: no rows → "Buy storage from player",
-- rows → "Send to your storage".
create or replace function public.wh_my_rentals()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_agg(jsonb_build_object(
    'unit_id', u.id, 'bay_no', u.bay_no, 'warehouse_id', w.id,
    'owner_name', w.owner_name, 'owner_id', w.owner_id, 'node_id', w.node_id,
    'capacity_kg', u.capacity_kg, 'used_kg', u.used_kg, 'contents', u.contents,
    'rent_until', u.rent_until
  ) order by w.owner_name, u.bay_no)
  from public.wh_units u join public.wh_warehouses w on w.id = u.warehouse_id
  where u.renter_id = auth.uid() and (u.rent_until is null or u.rent_until > now())), '[]'::jsonb);
$$;
grant execute on function public.wh_my_rentals() to authenticated;

-- ─── 📡 wh_my_shipments — what this player has on the road right now ────────
-- Without this a sender had no in-transit view anywhere in the game, and
-- wh_cancel_shipment was unreachable except by someone standing in the yard.
create or replace function public.wh_my_shipments()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_agg(jsonb_build_object(
    'id', s.id, 'warehouse_id', s.warehouse_id, 'owner_name', w.owner_name,
    'unit_id', s.unit_id, 'bay_no', u.bay_no,
    'origin_kind', s.origin_kind, 'origin_label', s.origin_label,
    'node_level', s.node_level, 'free_city', s.free_city,
    'eta_hours', s.eta_hours, 'eta_at', s.eta_at, 'sent_at', s.sent_at,
    'weight_kg', s.weight_kg, 'payload', s.payload,
    'status', case when s.status = 'transit' and s.eta_at <= now() then 'arrived' else s.status end,
    'crates_total', s.crates_total, 'crates_stored', s.crates_stored,
    'crates_left', (select count(*) from public.wh_crates c where c.shipment_id = s.id and c.stored = false)
  ) order by s.eta_at)
  from public.wh_shipments s
  join public.wh_warehouses w on w.id = s.warehouse_id
  left join public.wh_units u on u.id = s.unit_id
  where s.sender_id = auth.uid() and s.status in ('transit', 'arrived')), '[]'::jsonb);
$$;
grant execute on function public.wh_my_shipments() to authenticated;

-- ─── 🚚 wh_send_shipment — "Send to my storage unit" ─────────────────────────
-- Weight AND eta are computed HERE. The client may not pass either one. The
-- origin node's level comes from wh_node_level(); an unclaimed FREE CITY always
-- gets the 72h ceiling no matter what the client claims about it.
create or replace function public.wh_send_shipment(
  p_unit_id     uuid,
  p_origin_kind text,
  p_node_id     text default null,
  p_origin_label text default null,
  p_payload     jsonb default '{}'::jsonb,
  p_name        text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_u public.wh_units; v_w public.wh_warehouses;
  v_cfg jsonb := public.wh_config(); v_pay jsonb; v_kg numeric;
  v_lvl integer; v_free boolean; v_hours integer; v_ship public.wh_shipments;
  v_crate_kg numeric; v_n integer; v_i integer; v_left numeric; v_take numeric;
  v_kind text; k text; v_qty numeric; v_unit_kg numeric; v_cpay jsonb; v_cw numeric; v_free_kg numeric;
  v_rem jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  v_kind := lower(coalesce(p_origin_kind, ''));
  if v_kind not in ('city', 'house', 'camp') then return jsonb_build_object('ok', false, 'reason', 'bad_origin'); end if;
  select * into v_u from public.wh_units where id = p_unit_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_unit'); end if;
  if v_u.renter_id is distinct from v_uid or (v_u.rent_until is not null and v_u.rent_until < now()) then
    return jsonb_build_object('ok', false, 'reason', 'not_your_unit');
  end if;
  select * into v_w from public.wh_warehouses where id = v_u.warehouse_id;
  v_pay := public._wh_sane_payload(p_payload);
  if v_pay = '{}'::jsonb then return jsonb_build_object('ok', false, 'reason', 'empty_payload'); end if;
  v_kg := public._wh_weight(v_pay);
  if v_kg <= 0 then return jsonb_build_object('ok', false, 'reason', 'empty_payload'); end if;
  -- 🏳 Node level → ETA. Free city (no tw_node_owners row) resolves to level 0,
  -- which the eta table maps to the 72h ceiling.
  -- ⚖ Refuse a load we could not crate up faithfully, rather than truncating it.
  if v_kg > (v_cfg ->> 'max_shipment_kg')::numeric then
    return jsonb_build_object('ok', false, 'reason', 'too_large',
      'weight_kg', v_kg, 'max_shipment_kg', (v_cfg ->> 'max_shipment_kg')::numeric);
  end if;
  -- 🔒 SERIALISE THE WHOLE CALCULATION. The capacity check below sums over
  -- EVERY bay this sender holds in this warehouse, but the only lock held is
  -- the FOR UPDATE on p_unit_id — one bay. Two sessions sending to DIFFERENT
  -- bays therefore never contended, and under READ COMMITTED neither could see
  -- the other's uncommitted wh_shipments row, so both read the same free space
  -- and both said yes. Measured: four concurrent 1,799 kg sends against 2,000 kg
  -- of storage all accepted — 7,196 kg in flight, 360% of capacity, 5,208 kg
  -- permanently stranded once everything that could be stored had been.
  -- Same-bay racing WAS serialised, which is exactly why single-threaded tests
  -- showed this as fixed. The lock has to cover what the arithmetic covers.
  -- An advisory lock keyed on (sender, warehouse) does that with no row-lock
  -- ordering to get wrong and no deadlock cycle: whoever holds it never needs
  -- the waiter's row locks.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || v_w.id::text, 0));
  -- 📏 …and refuse one the DESTINATION cannot hold. Without this the loop
  -- accepted arithmetically impossible deliveries: a 3,997 kg shipment against
  -- a 500 kg bay returned ok:true, and ten of them put 39,970 kg in flight
  -- against 500 kg of storage. The sender learned about it 72 hours later and
  -- the only way out was cancelling everything.
  -- Free space is the sender's own current bays in THIS warehouse, minus every
  -- kilogram already on the road to them.
  select coalesce(sum(u.capacity_kg - u.used_kg), 0) into v_free_kg
    from public.wh_units u
    where u.warehouse_id = v_w.id and u.renter_id = v_uid
      and (u.rent_until is null or u.rent_until > now());
  v_free_kg := v_free_kg - coalesce((
    select sum(sh.weight_kg - coalesce(
             (select sum(c2.weight_kg) from public.wh_crates c2
               where c2.shipment_id = sh.id and c2.stored), 0))
    from public.wh_shipments sh
    where sh.warehouse_id = v_w.id and sh.sender_id = v_uid
      and sh.status in ('transit', 'arrived')), 0);
  if v_kg > v_free_kg then
    return jsonb_build_object('ok', false, 'reason', 'no_room_at_destination',
      'weight_kg', v_kg, 'free_kg', greatest(0, v_free_kg));
  end if;
  -- 🏳 The origin node must be one this player is DEMONSTRABLY attached to.
  -- An unverifiable claim is not an error — it just resolves to a free city and
  -- takes the full 72 hours, so forging a node id can never buy a faster run.
  v_lvl   := case when public.wh_player_at_node(v_uid, p_node_id)
                  then public.wh_node_level(p_node_id) else 0 end;
  v_free  := (v_lvl = 0);
  v_hours := case when v_free then (v_cfg ->> 'free_city_hours')::integer else public.wh_eta_hours(v_lvl) end;
  v_hours := least((v_cfg ->> 'max_hours')::integer, greatest(1, v_hours));

  insert into public.wh_shipments (
    sender_id, sender_name, warehouse_id, unit_id, origin_kind, origin_node, origin_label,
    node_level, free_city, payload, weight_kg, eta_hours, eta_at, status)
  values (
    v_uid, public._wh_display_name(v_uid), v_w.id, v_u.id, v_kind, p_node_id,
    -- origin_label is the sender's own words about where it came from, so it is
    -- capped and stripped rather than trusted verbatim.
    left(regexp_replace(coalesce(p_origin_label, ''), '[\x00-\x1F\x7F]', '', 'g'), 60),
    v_lvl, v_free, v_pay, v_kg, v_hours, now() + (v_hours || ' hours')::interval, 'transit')
  returning * into v_ship;

  -- 📦 Split into carryable crates. Each crate holds whole units of resources up
  -- to crate_kg; the last crate takes the remainder. This is what the player
  -- actually hauls off the truck, one at a time, under their weight limit.
  v_crate_kg := (v_cfg ->> 'crate_kg')::numeric;
  v_rem := v_pay; v_i := 0;
  while (select count(*) from jsonb_each_text(v_rem)) > 0 loop
    -- ⚠ The stop is a HARD ERROR, not a quiet exit. An earlier build bailed out
    -- of this loop and then wrote crates_total = v_i anyway: 400 metal vanished
    -- with ok:true, and because crates_total exceeded the crates that actually
    -- existed the shipment could never reach 'stored' — or be cancelled. If the
    -- payload cannot be crated, nothing is written at all.
    if v_i >= 400 then
      raise exception 'wh_send_shipment: payload needs more than 400 crates';
    end if;
    v_i := v_i + 1;
    v_cpay := '{}'::jsonb; v_cw := 0; v_left := v_crate_kg;
    for k, v_qty in select key, (value)::numeric from jsonb_each_text(v_rem) order by key loop
      v_unit_kg := coalesce(((v_cfg -> 'weights') ->> k)::numeric, (v_cfg ->> 'default_weight')::numeric);
      v_take := least(v_qty, floor(v_left / greatest(v_unit_kg, 0.0001)));
      -- A single item heavier than a whole crate still ships — one item per crate.
      if v_take < 1 and v_cw = 0 then v_take := 1; end if;
      if v_take >= 1 then
        v_cpay := v_cpay || jsonb_build_object(k, v_take);
        v_cw := v_cw + v_take * v_unit_kg;
        v_left := v_left - v_take * v_unit_kg;
        if v_qty - v_take <= 0 then v_rem := v_rem - k;
        else v_rem := v_rem || jsonb_build_object(k, v_qty - v_take); end if;
      end if;
      if v_left <= 0 then exit; end if;
    end loop;
    -- If a pass produced nothing the payload cannot be crated — fail loudly
    -- rather than leaving a shipment whose crates do not add up.
    if v_cpay = '{}'::jsonb then
      raise exception 'wh_send_shipment: payload could not be crated';
    end if;
    insert into public.wh_crates (shipment_id, crate_no, payload, weight_kg)
      values (v_ship.id, v_i, v_cpay, v_cw);
  end loop;
  -- crates_total is counted from the rows that REALLY exist, never from the
  -- loop counter.
  select count(*) into v_i from public.wh_crates where shipment_id = v_ship.id;
  update public.wh_shipments set crates_total = v_i where id = v_ship.id;

  return jsonb_build_object('ok', true,
    'shipment_id', v_ship.id, 'unit_id', v_u.id, 'bay_no', v_u.bay_no,
    'warehouse_id', v_w.id, 'owner_name', v_w.owner_name,
    'payload', v_pay, 'weight_kg', v_kg,
    'node_level', v_lvl, 'free_city', v_free,
    'eta_hours', v_hours, 'eta_at', v_ship.eta_at, 'crates_total', v_i);
end; $$;
grant execute on function public.wh_send_shipment(uuid, text, text, text, jsonb, text) to authenticated;

-- ─── 📥 wh_store_crate — carry ONE crate off the truck into a bay ────────────
-- The heart of the minigame, and the reason capacity is not a client concern:
--   • the crate must belong to a shipment that has actually ARRIVED (eta passed)
--   • the caller must be the warehouse OWNER or the bay's RENTER
--   • the bay must have room for the crate's server-computed weight — this is
--     what raises "You need to open storage unit space"
--   • the caller's LIFTER tier must be able to lift the crate
create or replace function public.wh_store_crate(p_crate_id uuid, p_unit_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_c public.wh_crates; v_s public.wh_shipments;
  v_u public.wh_units; v_w public.wh_warehouses; v_cfg jsonb := public.wh_config();
  v_carry numeric; v_tier integer; v_new jsonb; k text; v_qty numeric; v_done integer;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  select * into v_c from public.wh_crates where id = p_crate_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_crate'); end if;
  if v_c.stored then return jsonb_build_object('ok', false, 'reason', 'already_stored'); end if;
  select * into v_s from public.wh_shipments where id = v_c.shipment_id for update;
  if not found or v_s.status = 'cancelled' then return jsonb_build_object('ok', false, 'reason', 'no_shipment'); end if;
  if v_s.eta_at > now() then
    return jsonb_build_object('ok', false, 'reason', 'in_transit', 'eta_at', v_s.eta_at);
  end if;
  select * into v_u from public.wh_units where id = coalesce(p_unit_id, v_s.unit_id) for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_unit'); end if;
  select * into v_w from public.wh_warehouses where id = v_u.warehouse_id;
  -- ⚠ THE BAY MUST BELONG TO THE SHIPMENT. p_unit_id is client-supplied and only
  -- DEFAULTS to the shipment's bay, so this check is the whole ballgame. An
  -- earlier build only asked "is the caller the owner or the renter OF THE
  -- TARGET BAY" — which a warehouse owner satisfies trivially by renting one
  -- cheap bay in some THIRD player's warehouse. Executed attack: Bob owns the
  -- warehouse, so he legitimately receives Alice's crate ids in order to unload
  -- her truck; he rents a bay in Carol's warehouse for 1,200 Cinder and stores
  -- Alice's crates into it. Alice's bay stays empty, her shipment reports
  -- "stored 10/10", and Bob withdraws her goods as his own.
  -- The bay must be in the SAME warehouse the load was sent to, and rented by
  -- the SAME player who sent it. (Same-warehouse overflow into another of the
  -- sender's own bays stays legal; anything else does not.)
  if v_u.warehouse_id is distinct from v_s.warehouse_id
     or v_u.renter_id is distinct from v_s.sender_id then
    return jsonb_build_object('ok', false, 'reason', 'wrong_unit');
  end if;
  -- The rental has to be current, exactly as wh_send_shipment already demands.
  -- Allowing a lapsed bay to keep accepting deposits contradicted that gate.
  if v_u.rent_until is not null and v_u.rent_until < now() then
    return jsonb_build_object('ok', false, 'reason', 'rental_expired', 'rent_until', v_u.rent_until);
  end if;
  -- …and the caller still has to be someone entitled to touch this warehouse:
  -- the owner (who does the hauling) or the renter themselves.
  if v_w.owner_id is distinct from v_uid and v_u.renter_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  -- 🏋 Can this player physically lift it? Client-side HUD is UX; this is the rule.
  v_tier  := coalesce((select tier from public.wh_lifters where user_id = v_uid), 0);
  v_carry := ((v_cfg -> 'lifters') -> v_tier ->> 'carry_kg')::numeric;
  if v_c.weight_kg > v_carry then
    return jsonb_build_object('ok', false, 'reason', 'too_heavy',
      'weight_kg', v_c.weight_kg, 'carry_kg', v_carry, 'lifter_tier', v_tier);
  end if;
  -- 📦 Room in the bay? This is the "You need to open storage unit space" gate.
  if v_u.used_kg + v_c.weight_kg > v_u.capacity_kg then
    return jsonb_build_object('ok', false, 'reason', 'no_room',
      'used_kg', v_u.used_kg, 'capacity_kg', v_u.capacity_kg, 'weight_kg', v_c.weight_kg);
  end if;
  v_new := v_u.contents;
  for k, v_qty in select key, (value)::numeric from jsonb_each_text(v_c.payload) loop
    v_new := v_new || jsonb_build_object(k, coalesce((v_new ->> k)::numeric, 0) + v_qty);
  end loop;
  update public.wh_units set contents = v_new, used_kg = used_kg + v_c.weight_kg, updated_at = now()
    where id = v_u.id;
  update public.wh_crates set stored = true, stored_at = now() where id = v_c.id;
  select count(*) into v_done from public.wh_crates where shipment_id = v_s.id and stored = true;
  update public.wh_shipments set crates_stored = v_done,
    status = case when v_done >= crates_total then 'stored' else 'arrived' end
    where id = v_s.id;
  return jsonb_build_object('ok', true, 'crate_id', v_c.id, 'unit_id', v_u.id,
    'bay_no', v_u.bay_no, 'weight_kg', v_c.weight_kg,
    'used_kg', v_u.used_kg + v_c.weight_kg, 'capacity_kg', v_u.capacity_kg,
    'crates_stored', v_done, 'crates_total', v_s.crates_total,
    'shipment_done', (v_done >= v_s.crates_total));
end; $$;
grant execute on function public.wh_store_crate(uuid, uuid) to authenticated;

-- ─── ↩ wh_withdraw — a renter takes their goods back out of a bay ───────────
-- Returns the payload so the client can credit the salvage ledger; the bay is
-- emptied in the same transaction, so the resources never exist in two places.
create or replace function public.wh_withdraw(p_unit_id uuid, p_resource text default null, p_qty numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_u public.wh_units; v_cfg jsonb := public.wh_config();
  v_out jsonb := '{}'::jsonb; v_kg numeric := 0; v_have numeric; v_take numeric;
  k text; v_qty numeric;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  select * into v_u from public.wh_units where id = p_unit_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_unit'); end if;
  if v_u.renter_id is distinct from v_uid then return jsonb_build_object('ok', false, 'reason', 'not_your_unit'); end if;
  if p_resource is null then
    v_out := v_u.contents; v_kg := v_u.used_kg;
    update public.wh_units set contents = '{}'::jsonb, used_kg = 0, updated_at = now() where id = v_u.id;
  else
    v_have := coalesce((v_u.contents ->> p_resource)::numeric, 0);
    v_take := least(v_have, greatest(0, floor(coalesce(p_qty, v_have))));
    if v_take <= 0 then return jsonb_build_object('ok', false, 'reason', 'nothing_there'); end if;
    v_out := jsonb_build_object(p_resource, v_take);
    v_kg  := public._wh_weight(v_out);
    update public.wh_units set
      contents = case when v_have - v_take <= 0 then contents - p_resource
                      else contents || jsonb_build_object(p_resource, v_have - v_take) end,
      used_kg = greatest(0, used_kg - v_kg), updated_at = now()
    where id = v_u.id;
  end if;
  return jsonb_build_object('ok', true, 'payload', v_out, 'weight_kg', v_kg, 'unit_id', v_u.id);
end; $$;
grant execute on function public.wh_withdraw(uuid, text, numeric) to authenticated;

-- ─── 🔒 wh_impound_unit — free a lapsed bay without destroying anything ─────
-- After the grace period the warehouse owner may clear a bay whose renter
-- stopped paying. The goods are NOT deleted — they move to wh_impound, which
-- the former renter can still reclaim with wh_reclaim. Somebody else's property
-- is not the warehouse owner's to bin.
create table if not exists public.wh_impound (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  warehouse_id uuid references public.wh_warehouses(id) on delete set null,
  bay_no      integer,
  contents    jsonb not null default '{}'::jsonb,
  weight_kg   numeric not null default 0,
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz
);
create index if not exists wh_impound_user_idx on public.wh_impound (user_id, claimed_at);
alter table public.wh_impound enable row level security;
drop policy if exists whi_sel on public.wh_impound;
create policy whi_sel on public.wh_impound for select to authenticated using (user_id = auth.uid());
drop policy if exists whi_ins on public.wh_impound;
create policy whi_ins on public.wh_impound for insert to authenticated with check (false);
drop policy if exists whi_upd on public.wh_impound;
create policy whi_upd on public.wh_impound for update to authenticated using (false) with check (false);

create or replace function public.wh_impound_unit(p_unit_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_u public.wh_units; v_w public.wh_warehouses;
        v_cfg jsonb := public.wh_config(); v_grace int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  select * into v_u from public.wh_units where id = p_unit_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_unit'); end if;
  select * into v_w from public.wh_warehouses where id = v_u.warehouse_id;
  if v_w.owner_id is distinct from v_uid then return jsonb_build_object('ok', false, 'reason', 'not_allowed'); end if;
  v_grace := (v_cfg ->> 'rent_grace_days')::int;
  if v_u.renter_id is null then return jsonb_build_object('ok', false, 'reason', 'not_rented'); end if;
  if v_u.rent_until is null or v_u.rent_until > now() - (v_grace || ' days')::interval then
    return jsonb_build_object('ok', false, 'reason', 'still_in_grace', 'rent_until', v_u.rent_until);
  end if;
  if v_u.contents <> '{}'::jsonb then
    insert into public.wh_impound (user_id, warehouse_id, bay_no, contents, weight_kg)
      values (v_u.renter_id, v_w.id, v_u.bay_no, v_u.contents, v_u.used_kg);
  end if;
  -- Capacity returns to the base size. An expansion is something a particular
  -- renter paid for; silently transferring it to whoever rents next would let a
  -- 2,000 kg bay go for the price of a 500 kg one.
  update public.wh_units set renter_id = null, renter_name = null, rent_until = null,
    contents = '{}'::jsonb, used_kg = 0,
    capacity_kg = (v_cfg ->> 'unit_capacity_kg')::numeric,
    updated_at = now() where id = v_u.id;
  return jsonb_build_object('ok', true, 'bay_no', v_u.bay_no, 'impounded_kg', v_u.used_kg);
end; $$;
grant execute on function public.wh_impound_unit(uuid) to authenticated;

-- ─── ↩ wh_reclaim — a former renter takes impounded goods back ─────────────
create or replace function public.wh_reclaim(p_impound_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_out jsonb := '{}'::jsonb; r record; k text; v_q numeric; v_n int := 0;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  for r in select * from public.wh_impound
            where user_id = v_uid and claimed_at is null
              and (p_impound_id is null or id = p_impound_id) for update loop
    for k, v_q in select key, (value)::numeric from jsonb_each_text(r.contents) loop
      v_out := v_out || jsonb_build_object(k, coalesce((v_out ->> k)::numeric, 0) + v_q);
    end loop;
    update public.wh_impound set claimed_at = now() where id = r.id;
    v_n := v_n + 1;
  end loop;
  -- Claiming nothing is not a success. Calling this with someone else's impound
  -- id used to return ok:true with an empty payload, which the client toasts as
  -- a win.
  if v_n = 0 then return jsonb_build_object('ok', false, 'reason', 'nothing_there'); end if;
  return jsonb_build_object('ok', true, 'payload', v_out, 'claimed', v_n);
end; $$;
grant execute on function public.wh_reclaim(uuid) to authenticated;

-- ─── ✖ wh_cancel_shipment — pull a load back ────────────────────────────────
-- Returns the escrowed payload of every UN-STORED crate so the sender's ledger
-- can be made whole. Legal while in transit AND after arrival — a load that
-- lands into a bay with no room has to have a way home.
create or replace function public.wh_cancel_shipment(p_shipment_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_s public.wh_shipments; v_back jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  select * into v_s from public.wh_shipments where id = p_shipment_id for update;
  if not found or v_s.sender_id <> v_uid then return jsonb_build_object('ok', false, 'reason', 'not_yours'); end if;
  -- 'arrived' is cancellable too. Otherwise a load that lands into a bay with
  -- no room is stranded forever: every crate returns no_room, wh_buy_unit adds
  -- a NEW bay rather than growing this one, and the sender has no way back.
  if v_s.status not in ('transit', 'arrived') then
    return jsonb_build_object('ok', false, 'reason', 'too_late');
  end if;
  select coalesce(jsonb_object_agg(key, qty), '{}'::jsonb) into v_back from (
    select key, sum((value)::numeric) as qty
    from public.wh_crates c, jsonb_each_text(c.payload)
    where c.shipment_id = v_s.id and c.stored = false group by key) t;
  update public.wh_shipments set status = 'cancelled' where id = v_s.id;
  return jsonb_build_object('ok', true, 'payload', v_back);
end; $$;
grant execute on function public.wh_cancel_shipment(uuid) to authenticated;

-- ─── 📡 Realtime — the yard updates live for owner and renters alike ─────────
do $$ begin
  begin
    alter publication supabase_realtime add table public.wh_shipments;
  exception when duplicate_object then null; when undefined_object then null; end;
  begin
    alter publication supabase_realtime add table public.wh_units;
  exception when duplicate_object then null; when undefined_object then null; end;
end $$;

-- ─── 🔐 Lock the function surface down ──────────────────────────────────────
-- Postgres grants EXECUTE to PUBLIC on every new function by default, so `anon`
-- inherited it: signed out, wh_directory() happily returned live warehouse rows
-- (owner_id, owner_name, node_id, tier). The state-changers all refuse an
-- anonymous caller with not_signed_in, so this was disclosure rather than
-- damage — but it should never have been readable. Revoke from PUBLIC, then
-- grant back only what each role actually needs. wh_config() stays public: it
-- is a price list with no player data in it.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'wh\_%' escape '\'
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    -- Internals stay revoked from everyone; only the rpcs call them.
    -- wh_player_at_node belongs in that set despite its public-looking name:
    -- it takes an arbitrary user id and would otherwise be an oracle for any
    -- player's camp/residency. The sweep runs LAST, so forgetting it here
    -- silently grants it back after the explicit revoke above.
    if f.proname like '\_wh\_%' escape '\' or f.proname = 'wh_player_at_node' then
      continue;
    end if;
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
  -- …and belt-and-braces on every internal, including wh_player_at_node.
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like '\_wh\_%' escape '\'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
grant execute on function public.wh_config() to authenticated, anon;
