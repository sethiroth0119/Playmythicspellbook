-- 126_city_owner_cards.sql — a mayor reads the OWNER's card collection for the city they manage.
--
-- Reported: "When performing Mayor roles like adding workers to a building, the
-- system asks to select from the mayor's cards not the owner's cards."
-- The crew picker read Profile.cardCollection — the mayor's own. A client city's
-- crew must come from its owner's collection, which lives on the owner's profile
-- row (user_profiles.forge -> '__cardCollection__', the same JSON the client
-- syncs). This is the read, gated exactly like city_owner_ledger_get:
-- _node_manager_owner() answers only for the caller's ACTIVE mayoral contract
-- on that node, so nobody can read a collection they were not appointed over.
-- It hands back ids and counts only — no card art, no names, nothing from
-- auth.users. Idempotent, re-runnable, ends with a verify.

create or replace function public.city_owner_cards_get(p_node_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_cards jsonb;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  v_owner := public._node_manager_owner(p_node_id);
  if v_owner is null then raise exception 'you do not manage this node'; end if;
  select coalesce(forge->'__cardCollection__', '{}'::jsonb)
    into v_cards
    from public.user_profiles where user_id = v_owner;
  return jsonb_build_object('ok', true, 'owner_id', v_owner, 'cards', coalesce(v_cards, '{}'::jsonb));
end $$;

revoke all on function public.city_owner_cards_get(text) from public, anon;
grant execute on function public.city_owner_cards_get(text) to authenticated;

-- verify
select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as security_definer
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'city_owner_cards_get';
