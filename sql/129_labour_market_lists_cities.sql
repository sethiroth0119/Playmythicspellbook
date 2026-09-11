-- 129_labour_market_lists_cities.sql — Reconstruction Employment Board.
--
-- Owner's rule (2026-09-10): the board hires from the residents of the city on
-- the node the camp is registered to, and the "nobody is looking for work" line
-- must appear ONLY when that node has no built city / no residents. sql/088b
-- returned only rows with available > 0, so a built city whose people were all
-- taken read exactly like an empty node. Rows now come back for every trade a
-- city has published (available may be 0 — the client disables the button and
-- prints "0 avail"); an empty result means no city in reach has published any
-- residents at all. Everything else is verbatim 088b: the reach clause (the
-- node you registered to, or its owner's other cities), never your own city,
-- and camp_hire_from_city is untouched — it still refuses at available = 0,
-- and it is the only writer of `hired`. Idempotent; ends with a verify.

create or replace function public.camp_labour_market()
returns table (
  city_id     uuid,
  city_name   text,
  owner_name  text,
  node_id     text,
  role        text,
  available   integer,
  population  integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_node  text;
  v_owner uuid;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  -- every column qualified: node_id, role, city_id and available are OUT
  -- parameters as well as columns (see 088b).
  select r.node_id into v_node from tw_camp_registrations r where r.user_id = v_uid;
  if v_node is null then return; end if;                 -- not registered anywhere
  select o.user_id into v_owner from tw_node_owners o where o.node_id = v_node;
  if v_owner is null or v_owner = v_uid then return; end if;   -- must be someone else's
  return query
    select p.city_id, cp.city_name,
           coalesce(o.display_name, 'a resident of this node') as owner_name,
           p.node_id, p.role, p.available, cp.population
      from city_labour_pool p
      join city_profiles cp on cp.id = p.city_id
      left join tw_node_owners o on o.node_id = cp.node_id
     where cp.owner_id <> v_uid                          -- never your own city
       -- (a) in the node you registered to, or (b) belonging to its owner
       and (p.node_id = v_node or cp.owner_id = v_owner)
     order by cp.city_name, p.role;
end $$;

grant execute on function public.camp_labour_market() to authenticated;

-- verify
select 'camp_labour_market lists cities with 0 free' as check,
       pg_get_functiondef(p.oid) not like '%p.available > 0%' as ok,
       pg_get_functiondef(p.oid) like '%cp.owner_id = v_owner%' as reach_kept
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'camp_labour_market';
