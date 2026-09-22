-- 195_web_purchases_key.sql — website pack receipts are written as ONE KEY of
-- user_profiles.forge, never as the whole column.
--
-- 🔴 THE BUG. redeemWebPurchases() (public/index.html) marked receipts applied
-- with
--     update user_profiles set forge = '{"webPurchases": [...]}'
-- i.e. it REPLACED the whole forge column — ~80 cloud-synced keys
-- (__cardCollection__, __itemInventory__, __salvage__, __equipment__,
-- __vaultLayout__ …) — with one key. sql/070's up_guard only restores a forge
-- that drops to ZERO keys, so a one-key forge sailed through; up_farm_keep kept
-- __farm__ and sql/190 kept __salvage__, and nothing else survived. The row
-- stayed gutted until the next full cloudSyncProfile() upload, and a second
-- device that fetched in that window hydrated from it.
--
-- 🔴 AND THE REVERSE. cloudSyncProfile() upserts forge as its own whitelist
-- (forgeSmall), which has never carried webPurchases — so every ordinary save
-- DELETED the receipts the website wrote. Redemption only runs inside the
-- cloud-hydration branch of cloudFetchProfile(), which a same-device reload
-- skips (local-is-fresher), so a website purchase could be erased by the
-- game's own next save before it was ever opened: paid on the site, no pack.
--
-- This file:
--   1. web_purchases_set(p_list) — the ONLY write the client makes to the key:
--      forge = coalesce(forge,'{}') || {webPurchases: p_list}, for auth.uid()'s
--      row only. Every other key is untouched by construction.
--   2. up_webpurchases_keep — a BEFORE UPDATE trigger (the up_farm_keep shape):
--      an update whose forge omits webPurchases keeps the stored one, so the
--      whole-row upsert can no longer erase a receipt.
--
-- ⚖ No new trust: a player could already write their own forge.webPurchases
-- through RLS (own-row update), and redemption is client-side. This file only
-- stops the game destroying data it did not mean to touch.
-- Idempotent and re-runnable; verify query at the end.

begin;

-- 1. The key-level write ──────────────────────────────────────────────────────
create or replace function public.web_purchases_set(p_list jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return false; end if;
  if p_list is null or jsonb_typeof(p_list) <> 'array' then return false; end if;
  -- A receipt list is a handful of entries; refuse anything that is plainly
  -- not one rather than write a megabyte into the profile row.
  if jsonb_array_length(p_list) > 500 or length(p_list::text) > 262144 then return false; end if;
  update public.user_profiles
     set forge = coalesce(forge, '{}'::jsonb) || jsonb_build_object('webPurchases', p_list)
   where user_id = v_uid;
  return found;
end $$;
revoke all on function public.web_purchases_set(jsonb) from public, anon;
grant execute on function public.web_purchases_set(jsonb) to authenticated;

-- 2. Keep the receipts through a whole-row save ──────────────────────────────
create or replace function public.up_webpurchases_keep()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.forge is not null and old.forge ? 'webPurchases'
     and new.forge is not null and not (new.forge ? 'webPurchases') then
    new.forge := new.forge || jsonb_build_object('webPurchases', old.forge -> 'webPurchases');
  end if;
  return new;
end $$;
revoke all on function public.up_webpurchases_keep() from public, anon, authenticated;

drop trigger if exists up_webpurchases_keep on public.user_profiles;
create trigger up_webpurchases_keep before update on public.user_profiles
  for each row execute function public.up_webpurchases_keep();

commit;

-- ── verify (expect 3 rows, all ok = true) ───────────────────────────────────
select 'rpc web_purchases_set exists' as check,
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'web_purchases_set') as ok
union all
select 'rpc is security definer',
       coalesce((select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'web_purchases_set' limit 1), false)
union all
select 'keep trigger armed on user_profiles',
       exists (select 1 from pg_trigger t
                where t.tgrelid = 'public.user_profiles'::regclass
                  and t.tgname = 'up_webpurchases_keep' and not t.tgisinternal);
