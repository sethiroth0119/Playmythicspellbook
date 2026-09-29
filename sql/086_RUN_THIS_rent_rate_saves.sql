-- ============================================================================
-- 086 · RUN THIS — everything the "Save rate" button needs, in one block.
-- ============================================================================
-- Paste the whole file into the Supabase SQL editor and run it.
-- It is IDEMPOTENT: safe to run once, twice, or on a database that already has
-- all of it. Nothing here deletes or overwrites player data.
--
-- ⚠ THIS IS SQL. If you are pasting something that starts with `async function`
--   or `if (...)` that is JavaScript from public/index.html and the SQL editor
--   will reject it — that was my mistake in a previous message, not yours.
--
-- ⚠ AND IF "Save rate" IS STILL FAILING, SQL IS PROBABLY NOT THE CAUSE. The
--   real bug (fixed in v121q29) was client-side: index.html keeps an allowlist,
--   WH_RPC_ALLOW, and refuses any RPC not on it BEFORE it reaches the network.
--   wh_set_rent_rate was missing from it, so the button failed while all of the
--   SQL below was applied, granted and working. Hard-refresh the game
--   (Ctrl+Shift+R) so you are running v121q29 or later.
-- ============================================================================

-- 1 ── Where an owner's price is stored. Null = use the game default, so every
--      warehouse keeps charging what it charged before anyone sets a price.
alter table public.wh_warehouses
  add column if not exists rent_cinder_per_day numeric;

-- 2 ── What a bay here costs per day: the owner's price, or the default.
--      One function, so the quote a renter is shown, the amount actually
--      charged, and the owner's own screen cannot disagree.
create or replace function public.wh_rent_rate(p_warehouse_id uuid)
 returns bigint language sql stable
as $function$
  select coalesce(
    (select nullif(w.rent_cinder_per_day, 0)::bigint
       from public.wh_warehouses w where w.id = p_warehouse_id),
    (public.wh_config() ->> 'rent_cinder_per_day')::bigint)
$function$;

-- 3 ── THE SAVE ITSELF. Owner-only, and clamped 1,000–5,000,000 Cinder a day.
--      A rate of 0 would make bays free and break the "was I paid?" ledger; an
--      unbounded rate lets an owner park a renter's goods behind a price nobody
--      can pay, which is the impound flow with extra steps.
--      Returns `clamped: true` when it had to move the number, so the game can
--      tell the player what was actually stored instead of what they typed.
create or replace function public.wh_set_rent_rate(p_cinder_per_day numeric)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_w public.wh_warehouses; v_rate bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  select * into v_w from public.wh_warehouses where owner_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_warehouse'); end if;
  v_rate := greatest(1000, least(5000000, floor(coalesce(p_cinder_per_day, 0))))::bigint;
  update public.wh_warehouses
     set rent_cinder_per_day = v_rate, updated_at = now()
   where id = v_w.id;
  return jsonb_build_object('ok', true, 'rent_cinder_per_day', v_rate,
    'min', 1000, 'max', 5000000,
    'clamped', (floor(coalesce(p_cinder_per_day, 0)) <> v_rate));
end; $function$;

-- 4 ── Renewing a bay you already rent, at that warehouse's rate. This is what
--      the 7 / 30 / 60 / 90 buttons on the "Your rental has run out" modal call.
--      ⚠ It must work AFTER expiry — that is the whole point of the modal — up
--        until the owner may impound. A lapsed term restarts from NOW, not from
--        the past date, or renewing 7 days a day late would buy 6.
create or replace function public.wh_renew_unit(p_unit_id uuid, p_days integer)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid(); v_u public.wh_units; v_w public.wh_warehouses;
  v_cfg jsonb := public.wh_config(); v_days integer; v_rate bigint; v_cost bigint;
  v_grace int; v_from timestamptz;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  v_days := floor(coalesce(p_days, 0))::int;
  if not (v_cfg -> 'renew_terms') @> to_jsonb(v_days) then
    return jsonb_build_object('ok', false, 'reason', 'bad_term', 'terms', v_cfg -> 'renew_terms');
  end if;
  select * into v_u from public.wh_units where id = p_unit_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_unit'); end if;
  if v_u.renter_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'reason', 'not_your_bay');
  end if;
  select * into v_w from public.wh_warehouses where id = v_u.warehouse_id;
  v_grace := (v_cfg ->> 'rent_grace_days')::int;
  if v_u.rent_until is not null
     and v_u.rent_until < now() - (v_grace || ' days')::interval then
    return jsonb_build_object('ok', false, 'reason', 'grace_expired', 'rent_until', v_u.rent_until);
  end if;
  v_rate := public.wh_rent_rate(v_w.id);
  v_cost := v_rate * v_days;
  if not public._wh_charge(v_uid, 'cinder', v_cost,
       'Warehouse: renew bay ' || v_u.bay_no || ' for ' || v_days || ' days') then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'currency', 'cinder',
      'cost', v_cost, 'rate', v_rate, 'days', v_days);
  end if;
  perform public._wh_credit(v_w.owner_id, 'cinder', v_cost,
    'Warehouse: bay ' || v_u.bay_no || ' renewed ' || v_days || ' days');
  v_from := greatest(coalesce(v_u.rent_until, now()), now());
  update public.wh_units set rent_until = v_from + (v_days || ' days')::interval,
                             updated_at = now()
   where id = v_u.id;
  return jsonb_build_object('ok', true, 'unit_id', v_u.id, 'bay_no', v_u.bay_no,
    'days', v_days, 'rate', v_rate, 'spent', v_cost, 'currency', 'cinder',
    'rent_until', v_from + (v_days || ' days')::interval,
    'wallet', (select jsonb_build_object('cinder', cinder, 'aza', sovereigns)
               from public.user_progress where user_id = v_uid));
end; $function$;

-- 5 ── Let signed-in players actually call them. CREATE FUNCTION grants EXECUTE
--      to PUBLIC by default on most databases, but some setups revoke it — so
--      this is stated rather than assumed. anon is deliberately left out: both
--      of these spend a signed-in player's Cinder.
grant execute on function public.wh_rent_rate(uuid)               to authenticated;
grant execute on function public.wh_set_rent_rate(numeric)        to authenticated;
grant execute on function public.wh_renew_unit(uuid, integer)     to authenticated;

-- 6 ── Tell PostgREST about the new functions. Without this a brand-new RPC can
--      404 with "Could not find the function … in the schema cache" for a few
--      minutes even though it exists and is granted.
notify pgrst, 'reload schema';

-- ── Did it work? ────────────────────────────────────────────────────────────
-- Run this afterwards; every row should read 'yes' or '1'.
select 'rate column exists' as check,
       (select count(*)::text from information_schema.columns
         where table_name = 'wh_warehouses' and column_name = 'rent_cinder_per_day') as result
union all
select 'wh_set_rent_rate exists',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'wh_set_rent_rate')
union all
select 'players may call it',
       case when has_function_privilege('authenticated',
              'public.wh_set_rent_rate(numeric)', 'execute') then 'yes' else 'NO' end
union all
select 'players may renew a bay',
       case when has_function_privilege('authenticated',
              'public.wh_renew_unit(uuid,integer)', 'execute') then 'yes' else 'NO' end;
