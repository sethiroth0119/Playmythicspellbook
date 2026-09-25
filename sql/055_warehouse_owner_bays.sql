-- ════════════════════════════════════════════════════════════════════════════
-- 055 — WAREHOUSE: the owner can use their own building
-- ════════════════════════════════════════════════════════════════════════════
-- Run by hand in the Supabase SQL editor for project ktsiasyjusesawtrwrjc.
-- Idempotent (CREATE OR REPLACE + a guarded in-place patch). APPLIED 2026-08-25.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 THE BUG UNDERNEATH THE FEATURE REQUEST
--   A warehouse owner could not use their own warehouse AT ALL. Not a missing
--   button — a closed loop:
--     · wh_rent_unit refuses `own_warehouse`, so an owner can never become the
--       renter of any bay in their own building;
--     · wh_send_shipment, wh_store_crate, wh_withdraw and wh_expand_unit all
--       authorise on `renter_id = auth.uid()`.
--   So the owner could not send to, store in, withdraw from or expand a single
--   bay in the building they paid for. The in-world copy even told them to
--   "rent it from the Camp", which is the one thing the server refuses them.
--
--   wh_claim_own_bay is therefore the WHOLE feature: making the owner the
--   renter of a free bay hands them the entire existing loop with no change to
--   any of the four functions above. No rent is charged and `rent_until` stays
--   NULL — they own the building, there is nobody to pay and nothing to expire.
--   ⚠ NULL rent_until is load-bearing, not laziness. wh_my_rentals selects
--     `rent_until is null or rent_until > now()`, wh_send_shipment and
--     wh_expand_unit both skip their expiry guard on NULL, and wh_rent_unit's
--     "free bay" test needs `rent_until < now()` which NULL never satisfies —
--     so an owner-held bay is also permanently out of the rental pool, which is
--     exactly "take away one of their empty bays".
--
-- ⚠ NOT DONE HERE, and it is the honest limit of this migration: shipments
--   still carry RESOURCES ONLY, and only the 11 that wh_config()->'weights'
--   names. _wh_sane_payload drops every other key. Cards and items cannot be
--   shipped or stored by any part of this stack — that needs a weight model for
--   them, changes to the crate packer, to bay contents and to withdraw, and is
--   a separate piece of work rather than a line in this file.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. CLAIM ────────────────────────────────────────────────────────────────
-- Returns the FULL warehouse state, the way wh_buy_unit and wh_upgrade_tier do:
-- the client's contract for a mutation is `WH.setState(r); refreshWorld()`, and
-- a function returning only its own little result object leaves the 3D floor
-- and the HUD showing the bay as vacant until something else reloads.
create or replace function public.wh_claim_own_bay(p_unit_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_w public.wh_warehouses; v_u public.wh_units; v_out jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  select * into v_w from public.wh_warehouses where owner_id = v_uid limit 1;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_warehouse'); end if;
  if p_unit_id is null then
    -- Lowest-numbered genuinely free bay. SKIP LOCKED so a tenant renting at the
    -- same instant and the owner claiming can never both take the same bay.
    select * into v_u from public.wh_units where warehouse_id = v_w.id and renter_id is null
      order by bay_no limit 1 for update skip locked;
  else
    select * into v_u from public.wh_units where id = p_unit_id and warehouse_id = v_w.id for update;
  end if;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_free_unit'); end if;
  -- ⚠ A BAY WITH A TENANT IS NOT AVAILABLE, EVEN TO THE OWNER. Claiming one
  --   would be precisely the "owner takes the tenant's space" theft the
  --   ownership rule forbids — and their goods would still be sitting in it.
  if v_u.renter_id is not null and v_u.renter_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'reason', 'occupied', 'bay_no', v_u.bay_no);
  end if;
  if v_u.renter_id is distinct from v_uid then
    update public.wh_units
       set renter_id = v_uid, renter_name = public._wh_display_name(v_uid),
           rent_until = null, updated_at = now()
     where id = v_u.id;
  end if;
  v_out := public.wh_warehouse_json(v_w.id);
  return v_out || jsonb_build_object('ok', true, 'unit_id', v_u.id, 'bay_no', v_u.bay_no, 'owner_bay', true);
end; $function$;

-- ── 2. RELEASE ──────────────────────────────────────────────────────────────
create or replace function public.wh_release_own_bay(p_unit_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_w public.wh_warehouses; v_u public.wh_units; v_out jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  select * into v_w from public.wh_warehouses where owner_id = v_uid limit 1;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_warehouse'); end if;
  select * into v_u from public.wh_units where id = p_unit_id and warehouse_id = v_w.id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_unit'); end if;
  if v_u.renter_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'reason', 'not_your_bay');
  end if;
  -- Empty only. Releasing a bay with stock in it would strand the owner's own
  -- goods in a bay the next tenant then rents — the same loss the impound rules
  -- exist to prevent, only self-inflicted.
  if coalesce(v_u.used_kg, 0) > 0 or coalesce(v_u.contents, '{}'::jsonb) <> '{}'::jsonb then
    return jsonb_build_object('ok', false, 'reason', 'not_empty', 'used_kg', v_u.used_kg, 'bay_no', v_u.bay_no);
  end if;
  update public.wh_units set renter_id = null, renter_name = null, rent_until = null, updated_at = now()
   where id = v_u.id;
  v_out := public.wh_warehouse_json(v_w.id);
  return v_out || jsonb_build_object('ok', true, 'unit_id', v_u.id, 'bay_no', v_u.bay_no, 'released', true);
end; $function$;

grant execute on function public.wh_claim_own_bay(uuid)   to authenticated;
grant execute on function public.wh_release_own_bay(uuid) to authenticated;

-- ── 3. THE OWNER'S OWN RUN IS A FLAT 12 HOURS ───────────────────────────────
-- ⚠ PATCHED IN PLACE, NOT RETYPED. wh_send_shipment is ~9,400 characters and
--   carries an advisory-lock fix for a MEASURED 360%-of-capacity overbooking
--   race (four concurrent 1,799kg sends against 2,000kg of storage all
--   accepted) and the payment path that closed a resource mint. Retyping it to
--   change two lines risks losing either, silently. This rewrites ONLY the line
--   that clamps v_hours, by string replacement on the live definition, and
--   REFUSES to guess if the anchor has moved.
do $$
declare d text; anchor text; repl text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='wh_send_shipment';
  anchor := 'v_hours := least((v_cfg ->> ''max_hours'')::integer, greatest(1, v_hours));';
  if position(anchor in d) = 0 then
    raise exception 'ANCHOR NOT FOUND — wh_send_shipment changed shape; patch by hand rather than guessing';
  end if;
  if position('owner_id = v_uid then v_hours := 12' in d) > 0 then
    raise notice 'already patched — nothing to do'; return;
  end if;
  repl := anchor || chr(13) || chr(10)
    || '  -- 🏠 THE OWNER''S OWN RUN IS A FLAT 12 HOURS. Node level decides how fast'
    || chr(13) || chr(10)
    || '  -- a TENANT''s goods travel, because that is the service they are buying.'
    || chr(13) || chr(10)
    || '  -- An owner stocking their own building is not buying a service from'
    || chr(13) || chr(10)
    || '  -- anyone, so the design fixes it at 12h regardless of where it ships'
    || chr(13) || chr(10)
    || '  -- from — city, house or camp vault alike. Set AFTER the clamp above so'
    || chr(13) || chr(10)
    || '  -- max_hours cannot drag it back to 72.'
    || chr(13) || chr(10)
    || '  if v_w.owner_id = v_uid then v_hours := 12; end if;';
  d := replace(d, anchor, repl);
  execute d;
end $$;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- All four must be true.
select (pg_get_functiondef(p.oid) like '%owner_id = v_uid then v_hours := 12%') as owner_12h,
       (pg_get_functiondef(p.oid) like '%pg_advisory_xact_lock%')               as race_fix_intact
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='wh_send_shipment';
select p.proname, (pg_get_functiondef(p.oid) like '%wh_warehouse_json%') as returns_full_state
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('wh_claim_own_bay','wh_release_own_bay')
 order by 1;

-- ── APPLIED 2026-08-25 ──────────────────────────────────────────────────────
--   wh_claim_own_bay / wh_release_own_bay created, both returning full state
--   wh_send_shipment patched in place: 9,391 -> 9,861 chars, owner 12h present,
--   advisory-lock race fix intact.
