-- ════════════════════════════════════════════════════════════════════════════
-- 088b · WHOSE CITIES A CAMP CAN REACH.  ← RUN THIS, 088 IS DEAD WITHOUT IT
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 WHAT WAS WRONG, MEASURED ON THE LIVE DATABASE BEFORE WRITING THIS.
--    088 let a camp hire from cities LOCATED IN the node it is registered to
--    (city_profiles.node_id = the registered node). That assumed a city's node
--    and a node's owner line up. They do not:
--
--        camps registered to another player's node ........... 21
--        …whose node holds a city owned by someone else ......  0   ← every one
--        cities sitting in their own owner's node ............  0
--
--    city_profiles.node_id is WHERE A CITY SITS. tw_node_owners is WHO OWNS A
--    NODE. Players register their camps to nodes they hold no city in, so the
--    two sets never met and camp_labour_market returned nothing to everybody.
--    The feature would have shipped looking broken rather than looking empty.
--
-- ⚠ THE TWO RULES THE ASK NAMED ARE UNCHANGED. You must still be registered to
--   a node somebody ELSE owns, and you may still only take people out of
--   ANOTHER player's city. What widens is only WHICH cities are in reach:
--
--     (a) a city sitting in the node you are registered to        — as before
--     (b) a city belonging to the OWNER of that node              — new
--
--   (b) is the case the ask actually describes: you registered with another
--   player, and you are hiring that player's residents. (a) is kept because a
--   node that does fill up with other players' cities should still trade labour,
--   and losing it would trade one dead rule for another.
--
-- ⚠ AND NEITHER ROUTE CAN REACH YOUR OWN CITY. Both branches still exclude
--   cp.owner_id = the caller, in both functions — that check is the one thing
--   that must not be relaxed while widening the reach around it.
--
-- SAFE TO RE-RUN. Replaces two functions; no table, no data.
-- ════════════════════════════════════════════════════════════════════════════

-- ── the market listing ──────────────────────────────────────────────────────
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

  -- ⚠ EVERY COLUMN IN THIS FUNCTION IS QUALIFIED, and it is not style. node_id,
  --   role, city_id and available are all OUT PARAMETERS as well as columns, and
  --   plpgsql raises "column reference is ambiguous" on an unqualified one — at
  --   RUNTIME, so it installs cleanly and fails on the first call.
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
       and p.available > 0
       -- (a) in the node you registered to, or (b) belonging to its owner
       and (p.node_id = v_node or cp.owner_id = v_owner)
     order by cp.city_name, p.role;
end $$;

-- ── and the hire itself ─────────────────────────────────────────────────────
create or replace function public.camp_hire_from_city(
  p_city_id uuid,
  p_role    text,
  p_qty     integer,
  p_cost    integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_node    text;
  v_owner   uuid;
  v_want    integer;
  v_avail   integer;
  v_city    text;
  v_cityown uuid;
  v_citynode text;
  v_take    jsonb;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  v_want := greatest(0, least(50, coalesce(p_qty, 0)));
  if v_want <= 0 then return jsonb_build_object('ok', false, 'why', 'Ask for at least one worker.'); end if;

  select node_id into v_node from tw_camp_registrations where user_id = v_uid;
  if v_node is null then
    return jsonb_build_object('ok', false, 'why', 'Register your camp to a District Node first.');
  end if;

  select o.user_id into v_owner from tw_node_owners o where o.node_id = v_node;
  if v_owner is null then
    return jsonb_build_object('ok', false, 'why', 'Nobody owns that node yet, so there is no one to hire from.');
  end if;
  if v_owner = v_uid then
    return jsonb_build_object('ok', false, 'why', 'You own this node. Register with another player''s node to hire their residents.');
  end if;

  select cp.city_name, cp.owner_id, cp.node_id
    into v_city, v_cityown, v_citynode
    from city_profiles cp where cp.id = p_city_id;
  if v_city is null then return jsonb_build_object('ok', false, 'why', 'That city is gone.'); end if;
  if v_cityown = v_uid then
    return jsonb_build_object('ok', false, 'why', 'That is your own city.');
  end if;

  -- 🔴 THE REACH TEST, AND IT IS THE SAME ONE THE LISTING USES. If these two
  --    ever disagree the board offers a worker the hire then refuses, which is
  --    the worst of both — a button that looks live and never works.
  if not (v_citynode = v_node or v_cityown = v_owner) then
    return jsonb_build_object('ok', false, 'why',
      v_city || ' is not in reach of your camp. Register with the node whose owner runs it.');
  end if;

  -- 🔒 LOCK, THEN MEASURE. Two camps hiring the last farmer at once must not
  --    both get them.
  select available into v_avail from city_labour_pool
   where city_id = p_city_id and role = p_role
   for update;
  if v_avail is null then
    return jsonb_build_object('ok', false, 'why', 'That city is not offering ' || coalesce(p_role, 'that trade') || '.');
  end if;
  if v_avail < v_want then
    return jsonb_build_object('ok', false, 'why',
      v_city || ' has only ' || v_avail || ' ' || coalesce(p_role, 'worker') || ' looking for work.');
  end if;

  -- 💰 CHARGED THROUGH THE CANONICAL WALLET.
  -- 🔴 IT SIGNALS FAILURE BY RAISING, NOT BY RETURNING ok:false. Its contract is
  --    {moved, balance, wallet_seq} — there is no ok field. Testing for one
  --    would treat every SUCCESSFUL charge as a failure, and a plain RETURN does
  --    not undo the debit: the player would pay and receive nobody, every time.
  -- ⚠ CAUGHT NARROWLY. `when others` would report a genuine fault as an empty
  --   wallet. The block aborts before the decrement, so nothing moves.
  if coalesce(p_cost, 0) > 0 then
    begin
      v_take := public._ct_cinder_take(v_uid, p_cost::bigint,
                  'Hired ' || v_want || ' ' || coalesce(p_role, 'worker') || ' from ' || v_city);
    exception when raise_exception then
      return jsonb_build_object('ok', false, 'why', 'Not enough Cinder — this costs ' || p_cost || '.');
    end;
  end if;

  update city_labour_pool
     set available = available - v_want,
         hired     = hired + v_want,
         updated_at = now()
   where city_id = p_city_id and role = p_role;

  return jsonb_build_object('ok', true, 'hired', v_want, 'cost', coalesce(p_cost, 0),
                            'city_name', v_city, 'role', p_role,
                            'balance', v_take->'balance', 'wallet_seq', v_take->'wallet_seq');
end $$;

revoke all on function public.camp_labour_market()                              from public, anon;
revoke all on function public.camp_hire_from_city(uuid, text, integer, integer) from public, anon;
grant execute on function public.camp_labour_market()                              to authenticated;
grant execute on function public.camp_hire_from_city(uuid, text, integer, integer) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFY — run as-is. Expect:
--   reachable_now  = 14   camps that can now see somebody (was 0)
--   still_own_node =  8   registered to their own node — correctly still shut out
--   anon_holds     =  0
-- ════════════════════════════════════════════════════════════════════════════
with reg as (
  select r.user_id, r.node_id, o.user_id as node_owner
    from tw_camp_registrations r
    join tw_node_owners o on o.node_id = r.node_id
   where o.user_id is not null and o.user_id <> r.user_id
)
select
  (select count(*) from reg g where exists (
      select 1 from city_profiles cp
       where cp.owner_id <> g.user_id
         and (cp.node_id = g.node_id or cp.owner_id = g.node_owner)))          as reachable_now,
  (select count(*) from tw_camp_registrations r
     join tw_node_owners o on o.node_id = r.node_id
    where o.user_id = r.user_id)                                               as still_own_node,
  (select count(*) from information_schema.routine_privileges
    where routine_schema='public' and grantee in ('anon','public')
      and routine_name in ('camp_labour_market','camp_hire_from_city'))        as anon_holds;
