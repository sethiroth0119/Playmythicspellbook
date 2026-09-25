-- 130_corp_dissolve.sql — "Shut Down Corporation" (bug-mtw1eyki).
--
-- A founder could never leave their own corporation (corpLeave refuses
-- founders, and sql/078 allows one corporation per founder), so a player who
-- founded one at the start of the game was locked out of joining another.
-- This is the ONLY door out: security definer, founder only, and it refuses
-- while the corporation still holds anything that would be destroyed with it
-- (Cinder in the treasury, items in the vault) — those are paid out or
-- withdrawn first with the tools that already exist. Everything else
-- (members, requests, licences, operations, staff, offers, chat, policies)
-- goes with the row through the existing ON DELETE CASCADE constraints;
-- economy_nodes.corp_id is SET NULL, so licensed nodes survive under their
-- owner. Idempotent; ends with a verify.

create or replace function public.corp_dissolve(p_corp_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_name text; v_treasury numeric; v_vault bigint; v_members bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select name into v_name from corporations where id = p_corp_id and founder_id = v_uid;
  if v_name is null then return jsonb_build_object('ok', false, 'error', 'only the founder can shut a corporation down'); end if;
  select coalesce(sum(amount), 0) into v_treasury from corp_treasury where corp_id = p_corp_id;
  if v_treasury > 0 then
    return jsonb_build_object('ok', false, 'error', 'the treasury still holds ' || trim(to_char(v_treasury, 'FM999,999,999,999')) || ' Cinder — pay it out first');
  end if;
  select count(*) into v_vault from corp_vault where corp_id = p_corp_id and coalesce(qty, 0) > 0;
  if v_vault > 0 then
    return jsonb_build_object('ok', false, 'error', 'the vault still holds ' || v_vault || ' item line(s) — withdraw them first');
  end if;
  select count(*) into v_members from corp_members where corp_id = p_corp_id and user_id <> v_uid;
  delete from corporations where id = p_corp_id and founder_id = v_uid;
  return jsonb_build_object('ok', true, 'name', v_name, 'members_released', v_members);
end $$;

revoke all on function public.corp_dissolve(uuid) from public, anon;
grant execute on function public.corp_dissolve(uuid) to authenticated;

-- verify
select 'corp_dissolve installed' as check,
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'corp_dissolve') as ok;
