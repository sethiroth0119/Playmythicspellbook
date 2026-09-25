-- ════════════════════════════════════════════════════════════════════════════
-- 054 — WAREHOUSE: the storage-bay ladder, owner payouts, and the reserve fee
-- ════════════════════════════════════════════════════════════════════════════
-- Run by hand in the Supabase SQL editor for project ktsiasyjusesawtrwrjc.
-- Idempotent (every statement is CREATE OR REPLACE). Ends with a verify query.
-- APPLIED 2026-08-25 — see the record at the foot.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT WAS ALREADY THERE, AND WHAT WAS NOT
--   The warehouse is not new: `supabase/migrations/20260812000000_warehouse_
--   storage.sql` already ships wh_warehouses / wh_units, a first-person iframe,
--   rentals, shipments, lifters, crates and impounds. Renting a bay ALREADY
--   pays the warehouse owner (wh_rent_unit -> _wh_credit). Tenant goods are
--   ALREADY safe: wh_withdraw gates on `renter_id = auth.uid()`, so an owner
--   cannot take, sell or move what is in a rented bay.
--
--   Three things from the design were genuinely missing:
--     1. 🔴 THE UPGRADE MONEY WENT NOWHERE. wh_expand_unit charged the tenant
--        and credited NOBODY — the Cinder was destroyed. The whole premise
--        ("warehouse owners earn Cinder by providing a service") was not true
--        of the upgrade half. Now the owner is credited the full upgrade price.
--     2. No Foundation Reserve fee existed anywhere in the wh_* family.
--     3. Capacity grew LINEARLY (+500kg, four times, flat price) instead of on
--        the design's uneven ladder.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠ TWO NUMBERS IN THE DESIGN DO NOT SURVIVE CONTACT WITH THE LIVE GAME, and
--   the decision on each was taken deliberately rather than by rounding:
--
--   CAPACITY IS KILOGRAMS, NOT AN ITEM COUNT. The doc says "10,000 items". The
--   live warehouse weighs goods — metal 3.5kg, fuel 3, water 2, default 1 — and
--   the entire physical layer is built on that: a crate is 22kg, a forklift
--   carries 400kg, a shipment caps at 1,800kg. Switching to a count would
--   retire all of it. So the doc's SHAPE is kept and its UNIT is not: the
--   ratios 1 : 2.5 : 5 : 7.5 : 10 become 500 / 1250 / 2500 / 3750 / 5000 kg.
--
--   PRICES ARE ×100 THE DOC. The doc says 50,000 / 125,000 Cinder. A bay
--   expansion already cost 5,000,000 and rent is 120,000/day, so the doc's
--   numbers are ~100× under the economy they would live in — a full four-step
--   expansion would cost less than three days of rent. wh_config's own header
--   records that every warehouse Cinder price is deliberately ×100 the pegged
--   Aza rate; these follow that rule. Ratios preserved exactly:
--        doc 50,000 / 50,000 / 50,000 / 125,000
--        here 5,000,000 / 5,000,000 / 5,000,000 / 12,500,000
--   Aza prices are unchanged at 10 / 10 / 10 / 25 (Aza is the real-money price
--   and is NOT scaled — same rule as the rest of the module).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. THE LADDER ───────────────────────────────────────────────────────────
-- A function of its own rather than an edit to wh_config(), which is a large
-- IMMUTABLE jsonb literal — retyping it to add one key is how an unrelated
-- price gets fat-fingered.
create or replace function public.wh_unit_tiers()
returns jsonb language sql immutable as $$
  select jsonb_build_array(
    jsonb_build_object('level',0,'name','Base Unit', 'capacity_kg',  500,'cinder',        0,'aza', 0),
    jsonb_build_object('level',1,'name','Upgrade 1','capacity_kg', 1250,'cinder',  5000000,'aza',10),
    jsonb_build_object('level',2,'name','Upgrade 2','capacity_kg', 2500,'cinder',  5000000,'aza',10),
    jsonb_build_object('level',3,'name','Upgrade 3','capacity_kg', 3750,'cinder',  5000000,'aza',10),
    jsonb_build_object('level',4,'name','Upgrade 4','capacity_kg', 5000,'cinder', 12500000,'aza',25)
  )
$$;

-- ⚠ DERIVED FROM CAPACITY, NOT STORED — which is what lets the bays built by
--   the old linear rule land on the ladder with NO migration and no downtime.
--   "Next" is the first tier STRICTLY WIDER than the bay, so a legacy 1,000kg
--   bay upgrades to 1,250 and a legacy 2,000kg one to 2,500. Capacity can only
--   ever go UP; there is no input that shrinks a bay a tenant already paid for.
create or replace function public.wh_unit_next_tier(p_capacity numeric)
returns jsonb language sql stable as $$
  select t from jsonb_array_elements(public.wh_unit_tiers()) t
   where (t->>'capacity_kg')::numeric > coalesce(p_capacity, 0)
   order by (t->>'capacity_kg')::numeric limit 1
$$;

-- ── 2. THE UPGRADE, WITH THE MONEY ATTACHED ─────────────────────────────────
create or replace function public.wh_expand_unit(p_unit_id uuid, p_currency text default 'cinder')
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid uuid := auth.uid(); v_u public.wh_units; v_w public.wh_warehouses;
  v_cur text; v_cost bigint; v_next jsonb; v_newcap numeric;
  v_pct numeric := 0.05; v_fee bigint := 0; v_total bigint; v_is_owner boolean;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  v_cur := case when p_currency = 'aza' then 'aza' else 'cinder' end;
  select * into v_u from public.wh_units where id = p_unit_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_unit'); end if;
  select * into v_w from public.wh_warehouses where id = v_u.warehouse_id;
  if v_w.owner_id is distinct from v_uid and v_u.renter_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  -- The rental must be CURRENT. Paying for capacity you cannot reach is the bug
  -- this guard was added for; the ladder rewrite does not get to drop it.
  if v_u.renter_id is not null and v_u.rent_until is not null and v_u.rent_until < now() then
    return jsonb_build_object('ok', false, 'reason', 'rental_expired', 'rent_until', v_u.rent_until);
  end if;

  -- SEQUENTIAL BY CONSTRUCTION. "10K -> 25K -> 50K -> 75K -> 100K, no jumping"
  -- needs no check: the function takes no tier argument, so the only thing it
  -- can ever sell is the next rung.
  v_next := public.wh_unit_next_tier(v_u.capacity_kg);
  if v_next is null then
    return jsonb_build_object('ok', false, 'reason', 'bay_maxed', 'capacity_kg', v_u.capacity_kg);
  end if;
  v_newcap := (v_next ->> 'capacity_kg')::numeric;
  v_cost   := (v_next ->> (case when v_cur = 'aza' then 'aza' else 'cinder' end))::bigint;

  -- No counterparty when you expand a bay in your OWN warehouse: paying
  -- yourself is a no-op and a 5% transaction fee on it taxes nothing.
  v_is_owner := (v_w.owner_id = v_uid);
  if v_is_owner then v_fee := 0; else v_fee := ceil(v_cost * v_pct); end if;
  -- ⚠ THE FEE IS ON TOP, NOT A DEDUCTION. The design is explicit that the owner
  --   receives the full listed price and the tenant pays 105%. Taking 5% out of
  --   the owner's side would be a different (and worse) deal for the person
  --   providing the service.
  v_total := v_cost + v_fee;

  if not public._wh_charge(v_uid, v_cur, v_total,
       'Warehouse: ' || (v_next ->> 'name') || ' on bay ' || v_u.bay_no
       || case when v_fee > 0 then ' (incl. reserve fee)' else '' end) then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'currency', v_cur,
      'cost', v_cost, 'fee', v_fee, 'total', v_total, 'next', v_next);
  end if;

  if not v_is_owner then
    perform public._wh_credit(v_w.owner_id, v_cur, v_cost,
      'Warehouse: bay ' || v_u.bay_no || ' ' || (v_next ->> 'name'));
    insert into public.reserve_tax_log
      (seller_id, buyer_id, resource, quantity, sale_value, tax_rate, tax_amount, market_type)
    values (v_w.owner_id, v_uid, case when v_cur='aza' then 'sovereigns' else 'cinder' end,
            1, v_cost, v_pct, v_fee, 'warehouse_upgrade');
  end if;

  update public.wh_units set capacity_kg = v_newcap, updated_at = now() where id = v_u.id;
  return jsonb_build_object('ok', true, 'unit_id', v_u.id, 'bay_no', v_u.bay_no,
    'level', (v_next ->> 'level')::int, 'level_name', v_next ->> 'name',
    'capacity_kg', v_newcap, 'used_kg', v_u.used_kg,
    'cost', v_cost, 'fee', v_fee, 'fee_pct', v_pct, 'spent', v_total, 'currency', v_cur,
    'paid_to_owner', case when v_is_owner then 0 else v_cost end,
    'next', public.wh_unit_next_tier(v_newcap),
    'wallet', (select jsonb_build_object('cinder', cinder, 'aza', sovereigns)
               from public.user_progress where user_id = v_uid));
end; $function$;

-- ── 3. THE OWNER'S DASHBOARD ────────────────────────────────────────────────
-- 🔴 `contents` IS NEVER SELECTED, AND THAT IS THE POINT. The design rule is
--    explicit: an owner may see how FULL a bay is and may not see or touch what
--    is in it. used_kg / capacity_kg answer "is my property earning"; the jsonb
--    beside them answers "what does my tenant own", which is not the owner's
--    business. Adding `contents` to the select below is a data breach, not a
--    feature — wh_withdraw would still stop them TAKING it, but they would be
--    reading a stranger's private inventory.
create or replace function public.wh_owner_dashboard()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_uid uuid := auth.uid(); v_w public.wh_warehouses;
  v_bays int; v_occ int; v_rent bigint; v_upg bigint; v_tenants jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  select * into v_w from public.wh_warehouses where owner_id = v_uid limit 1;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_warehouse'); end if;

  select count(*),
         count(*) filter (where renter_id is not null and (rent_until is null or rent_until >= now()))
    into v_bays, v_occ
    from public.wh_units where warehouse_id = v_w.id;

  -- Revenue is READ BACK OFF THE LEDGER rather than kept in a counter that can
  -- drift from it. _wh_credit stamps every payout with a reason, and those two
  -- strings are written by wh_rent_unit and wh_expand_unit above.
  select coalesce(sum(delta), 0) into v_rent from public.wallet_ledger
   where user_id = v_uid and resource = 'cinder' and op = 'credit' and reason like 'Warehouse:%rented%';
  select coalesce(sum(delta), 0) into v_upg from public.wallet_ledger
   where user_id = v_uid and resource = 'cinder' and op = 'credit' and reason like 'Warehouse:%Upgrade%';

  select coalesce(jsonb_agg(jsonb_build_object(
           'bay_no', u.bay_no, 'tenant', coalesce(u.renter_name, '—'),
           'capacity_kg', u.capacity_kg, 'used_kg', u.used_kg,
           'pct', case when u.capacity_kg > 0 then round(u.used_kg / u.capacity_kg * 100) else 0 end,
           'level', coalesce((select (t->>'level')::int from jsonb_array_elements(public.wh_unit_tiers()) t
                               where (t->>'capacity_kg')::numeric <= u.capacity_kg
                               order by (t->>'capacity_kg')::numeric desc limit 1), 0),
           'status', case when u.renter_id is null then 'Vacant'
                          when u.rent_until is not null and u.rent_until < now() then 'Expired'
                          else 'Active' end,
           'rent_until', u.rent_until) order by u.bay_no), '[]'::jsonb)
    into v_tenants
    from public.wh_units u where u.warehouse_id = v_w.id;

  return jsonb_build_object('ok', true,
    'warehouse_id', v_w.id, 'tier', v_w.tier, 'node_id', v_w.node_id,
    'open_to_all', v_w.open_to_all,
    'bays', v_bays, 'occupied', v_occ, 'available', greatest(0, v_bays - v_occ),
    'occupancy_pct', case when v_bays > 0 then round(v_occ::numeric / v_bays * 100) else 0 end,
    'rental_revenue', v_rent, 'upgrade_revenue', v_upg,
    'tenants', v_tenants);
end; $function$;

grant execute on function public.wh_owner_dashboard()            to authenticated;
grant execute on function public.wh_unit_tiers()                 to anon, authenticated;
grant execute on function public.wh_unit_next_tier(numeric)      to anon, authenticated;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- The ladder, and the money each rung moves. Owner receives the FULL price;
-- the reserve fee is charged ON TOP; the tenant pays the sum.
select (x->>'name') as tier,
       (x->>'capacity_kg') as new_capacity_kg,
       (x->>'cinder')::bigint as owner_receives,
       ceil((x->>'cinder')::bigint * 0.05)::bigint as reserve_fee,
       ((x->>'cinder')::bigint + ceil((x->>'cinder')::bigint * 0.05))::bigint as tenant_pays
from jsonb_array_elements(public.wh_unit_tiers()) as x
where (x->>'level')::int > 0
order by (x->>'level')::int;

-- These three must ALL be true, and the last one must be FALSE.
select (pg_get_functiondef(p.oid) ilike '%wh_unit_next_tier%') as upgrade_uses_ladder,
       (pg_get_functiondef(p.oid) ilike '%_wh_credit%')        as upgrade_pays_owner,
       (pg_get_functiondef(p.oid) ilike '%reserve_tax_log%')   as upgrade_logs_fee
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='wh_expand_unit';
select (pg_get_functiondef(p.oid) ilike '%contents%') as dashboard_leaks_contents
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='wh_owner_dashboard';

-- ── APPLIED 2026-08-25 ──────────────────────────────────────────────────────
--   ladder             500 / 1250 / 2500 / 3750 / 5000 kg
--   upgrade prices     5,000,000 x3 then 12,500,000 Cinder (Aza 10/10/10/25)
--   owner receives     the full price; reserve fee 5% ON TOP
--   legacy bays        1,000kg -> next is Upgrade 1 (1,250); 2,000kg -> Upgrade 2
--                      (2,500). No migration needed, no bay shrinks.
--   upgrade_uses_ladder t · upgrade_pays_owner t · upgrade_logs_fee t
--   dashboard_leaks_contents f
