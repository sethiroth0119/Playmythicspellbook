-- ============================================================================
-- 141 — A PROFILE UPLOAD CAN NEVER ERASE A HOMESTEAD FARM
-- Project: ktsiasyjusesawtrwrjc
-- Status: DRAFT — NOT APPLIED. Needs the owner's OK.
-- ----------------------------------------------------------------------------
-- Tracker bug-mtzijeyw / bug-mu44lr6j. Clients older than v121v174 never read
-- Profile.farm back from the device's own save, so after a reload they upload
-- `forge.__farm__ = null` over the player's farm. v174 fixes the client
-- (0d89a571ce), but a device still running a cached older build keeps doing it.
-- MEASURED 2026-09-17: GreyDragon's farm was restored at 05:53:00 and nulled
-- again at 05:53:13 by that player's own device.
--
-- THE RULE. No play path deletes a farm (src/farm has no clear), so an update
-- that turns an object farm into null, or drops the key, is always a stale
-- device. Such an update keeps the stored farm; everything else in the row is
-- written as sent. Replacing one farm object with another is untouched — the
-- client's "newest ts wins" merge owns that.
--
-- ⚠ AN ADMIN CAN STILL CLEAR A FARM, deliberately:
--     set local mythic.allow_farm_clear = 'on';  -- inside the same transaction
-- ⚠ Named so it fires BEFORE up_guard_upd (triggers run in name order), so the
--   shrink guard sees the row with the farm already kept.
-- No new table, so no new RLS. The function is SECURITY INVOKER and only reads
-- OLD/NEW. Re-runnable.
-- ============================================================================

create or replace function public.up_farm_keep()
returns trigger
language plpgsql as $fn$
begin
  if coalesce(current_setting('mythic.allow_farm_clear', true), '') = 'on' then
    return new;
  end if;
  if old.forge is not null
     and jsonb_typeof(old.forge -> '__farm__') = 'object'
     and (new.forge is null or jsonb_typeof(new.forge -> '__farm__') is distinct from 'object') then
    new.forge := jsonb_set(coalesce(new.forge, '{}'::jsonb), '{__farm__}', old.forge -> '__farm__', true);
  end if;
  return new;
end $fn$;

drop trigger if exists up_farm_keep on public.user_profiles;
create trigger up_farm_keep
  before update on public.user_profiles
  for each row execute function public.up_farm_keep();

-- ── verify (no side effects: every probe is rolled back) ────────────────────
do $$
declare
  v_uid uuid;
  v_kept text;
  v_cleared text;
begin
  select user_id into v_uid from public.user_profiles
   where jsonb_typeof(forge -> '__farm__') = 'object' limit 1;
  if v_uid is null then raise notice 'no farm on any profile to probe with'; return; end if;
  begin
    update public.user_profiles set forge = jsonb_set(forge, '{__farm__}', 'null'::jsonb) where user_id = v_uid;
    select jsonb_typeof(forge -> '__farm__') into v_kept from public.user_profiles where user_id = v_uid;
    set local mythic.allow_farm_clear = 'on';
    update public.user_profiles set forge = jsonb_set(forge, '{__farm__}', 'null'::jsonb) where user_id = v_uid;
    select jsonb_typeof(forge -> '__farm__') into v_cleared from public.user_profiles where user_id = v_uid;
    raise exception 'probe: null upload kept=% · admin clear=%', v_kept, v_cleared;
  exception when raise_exception then
    raise notice '%', sqlerrm;   -- expect: kept=object · admin clear=null
  end;
end $$;
