-- ════════════════════════════════════════════════════════════════════════════
-- 088 · CROSS-CITY LABOUR — hiring real people out of other players' cities.
-- ════════════════════════════════════════════════════════════════════════════
-- THE ASK, verbatim:
--   "in the employment board make it where players have to be registered in
--    another players node and can only hire npcs from other players cities and
--    show in the player city npcs that may work for the registered player
--    camp/city. If they are farmers, guards etc....."
--
-- WHAT WAS THERE: the Employment Board sold workers out of thin air. The pool
-- was `_campRolePool()` — a constant, 180 for the node's prime role and 50 for
-- everything else, scaled by node tier. No other player was involved, no city
-- was drained, and the same 50 Farmers were on sale to every player at once.
-- Hiring "drained the node's local labour pool" only in the sense that a
-- counter in the hirer's own save went up.
--
-- WHAT THIS MAKES TRUE INSTEAD:
--   · a camp may only hire from the node it is REGISTERED to
--   · that node must be owned by SOMEBODY ELSE
--   · the workers come out of a real city's real unemployed residents, and the
--     city they came from is one short afterwards
--
-- 🔴 THE POOL IS SERVER-HELD, NOT CLIENT-ASSERTED, AND THAT IS THE WHOLE POINT
--    OF THIS FILE. The city OWNER publishes how many of their residents are out
--    of work in each trade (they are the only one who can count them — the
--    roster lives in their save). The HIRER never writes that number: they call
--    a function that locks the row, checks it, decrements it and charges them,
--    all in one transaction. A client that could post its own "available" would
--    be a client that could hire infinite people.
--
-- ⚠ AND A PUBLISH CANNOT MINT WORKERS EITHER. city_labour_publish only ever
--   sets `available`, never `hired`; the hired tally is owned by the hire
--   function alone. A city owner refreshing their publish cannot undo a hire
--   that already happened, which is the obvious way to farm this.
--
-- SAFE TO RE-RUN.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. THE POOL ─────────────────────────────────────────────────────────────
create table if not exists public.city_labour_pool (
  city_id    uuid        not null references public.city_profiles(id) on delete cascade,
  owner_id   uuid        not null references auth.users(id)          on delete cascade,
  node_id    text        not null,
  role       text        not null,
  -- how many residents of this trade the owner's city says are out of work
  available  integer     not null default 0 check (available >= 0),
  -- how many have been taken by camps. Written ONLY by camp_hire_from_city.
  hired      integer     not null default 0 check (hired >= 0),
  updated_at timestamptz not null default now(),
  primary key (city_id, role)
);

create index if not exists city_labour_pool_node_idx  on public.city_labour_pool (node_id);
create index if not exists city_labour_pool_owner_idx on public.city_labour_pool (owner_id);

alter table public.city_labour_pool enable row level security;

-- 👁 READ: anyone signed in may look at the labour market. It is a count of
--    people looking for work, not a private figure, and the Employment Board
--    has to be able to show a camp what its node offers before it hires.
drop policy if exists city_labour_pool_read on public.city_labour_pool;
create policy city_labour_pool_read on public.city_labour_pool
  for select to authenticated using (true);

-- ✍ WRITE: nobody, through the table. Both mutations go through the two
--    SECURITY DEFINER functions below, because both have rules that a row
--    policy cannot express — "you may set available but not hired" and "you may
--    only take from a city in the node you are registered to".
drop policy if exists city_labour_pool_write on public.city_labour_pool;

-- ── 2. THE CITY OWNER PUBLISHES WHO IS OUT OF WORK ──────────────────────────
-- p_rows: [{"role":"Farmer","available":6}, …]
create or replace function public.city_labour_publish(
  p_city_id uuid,
  p_rows    jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_node text;
  r      jsonb;
  v_role text;
  v_av   integer;
  n      integer := 0;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  -- ⚠ THE CITY MUST BE THEIRS. Publishing into someone else's city would let a
  --    player advertise labour that another player's residents have to supply.
  select node_id into v_node from city_profiles
   where id = p_city_id and owner_id = v_uid;
  if v_node is null then raise exception 'that city is not yours'; end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then return 0; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_role := left(coalesce(r->>'role', ''), 24);
    v_av   := greatest(0, least(9999, coalesce((r->>'available')::int, 0)));
    continue when v_role = '';
    insert into city_labour_pool (city_id, owner_id, node_id, role, available, updated_at)
    values (p_city_id, v_uid, v_node, v_role, v_av, now())
    on conflict (city_id, role) do update
      -- 🔴 `hired` IS DELIBERATELY NOT IN THIS LIST. A publish states how many
      --    are looking for work; it must never reset the tally of how many have
      --    already been taken, or a city owner could refresh away every hire.
      set available  = excluded.available,
          node_id    = excluded.node_id,
          owner_id   = excluded.owner_id,
          updated_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;

-- ── 3. WHAT THIS CAMP MAY HIRE, AND FROM WHOM ───────────────────────────────
-- Returns one row per (city, role) the caller is allowed to hire out of.
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

  -- ⚠ REGISTRATION IS THE GATE, and it is checked here rather than trusted from
  --   the client, because this same test decides what the hire function allows.
  -- ⚠ EVERY COLUMN IN THIS FUNCTION IS QUALIFIED, and it is not style. `node_id`,
  --   `role`, `city_id` and `available` are all OUT PARAMETERS of this function
  --   as well as columns on the tables below, and plpgsql raises "column
  --   reference is ambiguous" on an unqualified one — at RUNTIME, not at create
  --   time, so it would have installed cleanly and failed on the first call.
  select r.node_id into v_node from tw_camp_registrations r where r.user_id = v_uid;
  if v_node is null then return; end if;                 -- not registered anywhere

  -- 🔴 …AND IT MUST BE SOMEBODY ELSE'S NODE. A player registered to their own
  --    node is not hiring from another player, they are hiring from themselves.
  select o.user_id into v_owner from tw_node_owners o where o.node_id = v_node;
  if v_owner is null or v_owner = v_uid then return; end if;

  return query
    select p.city_id, cp.city_name,
           coalesce(o.display_name, 'a resident of this node') as owner_name,
           p.node_id, p.role, p.available, cp.population
      from city_labour_pool p
      join city_profiles cp on cp.id = p.city_id
      left join tw_node_owners o on o.node_id = p.node_id
     where p.node_id = v_node
       and cp.owner_id <> v_uid                          -- never your own city
       and p.available > 0
     order by cp.city_name, p.role;
end $$;

-- ── 4. TAKE ONE ─────────────────────────────────────────────────────────────
-- Returns jsonb: {ok, hired, cost, city_name, role, why}
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
  v_uid    uuid := auth.uid();
  v_node   text;
  v_owner  uuid;
  v_want   integer;
  v_avail  integer;
  v_city   text;
  v_cityown uuid;
  v_take   jsonb;
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

  select cp.city_name, cp.owner_id into v_city, v_cityown
    from city_profiles cp where cp.id = p_city_id;
  if v_city is null then return jsonb_build_object('ok', false, 'why', 'That city is gone.'); end if;
  if v_cityown = v_uid then
    return jsonb_build_object('ok', false, 'why', 'That is your own city.');
  end if;

  -- 🔒 LOCK, THEN MEASURE — the same order sql/045 spends forty lines on. Two
  --    camps hiring the last farmer at once must not both get them.
  select available into v_avail from city_labour_pool
   where city_id = p_city_id and role = p_role and node_id = v_node
   for update;
  if v_avail is null then
    return jsonb_build_object('ok', false, 'why', 'That city is not offering ' || coalesce(p_role, 'that trade') || '.');
  end if;
  if v_avail < v_want then
    return jsonb_build_object('ok', false, 'why',
      v_city || ' has only ' || v_avail || ' ' || coalesce(p_role, 'worker') || ' looking for work.');
  end if;

  -- 💰 CHARGED THROUGH THE CANONICAL WALLET, never by writing a balance here.
  --    _ct_cinder_take is the one path that keeps user_progress.cinder,
  --    user_profiles.gems and wallet_ledger agreeing with each other.
  --
  -- 🔴 IT SIGNALS FAILURE BY RAISING, NOT BY RETURNING ok:false. Its contract
  --    is `{moved, balance, wallet_seq}` and it does `raise exception 'not
  --    enough Cinder'` when the wallet is short — there is no ok field at all.
  --    An earlier draft of this function tested `(v_take->>'ok')` and would
  --    therefore have treated EVERY SUCCESSFUL CHARGE as a failure, returning
  --    early — and a plain RETURN does not undo the debit, so the player would
  --    have paid and received nobody, every single time.
  -- ⚠ CAUGHT NARROWLY. `when raise_exception` is the code that raise emits;
  --   `when others` would also swallow a genuine fault here and report it to
  --   the player as an empty wallet. The block aborts before the decrement
  --   below, so nothing moves and no Cinder is lost.
  if coalesce(p_cost, 0) > 0 then
    begin
      v_take := public._ct_cinder_take(v_uid, p_cost::bigint,
                  'Hired ' || v_want || ' ' || coalesce(p_role, 'worker') || ' from ' || v_city);
    exception when raise_exception then
      return jsonb_build_object('ok', false, 'why', 'Not enough Cinder — this costs ' || p_cost || '.');
    end;
  end if;

  -- …and only now do the people move. The charge is inside the same
  -- transaction, so a failure past this point takes the Cinder back with it.
  update city_labour_pool
     set available = available - v_want,
         hired     = hired + v_want,
         updated_at = now()
   where city_id = p_city_id and role = p_role;

  -- The wallet's own figures travel back so the client can adopt them rather
  -- than recomputing a balance it cannot see — the same contract corp_pay_member
  -- uses, and the reason a tax-exempt client does not drift from the server.
  return jsonb_build_object('ok', true, 'hired', v_want, 'cost', coalesce(p_cost, 0),
                            'city_name', v_city, 'role', p_role,
                            'balance', v_take->'balance', 'wallet_seq', v_take->'wallet_seq');
end $$;

-- ── 5. WHO IN MY CITY COULD LEAVE ───────────────────────────────────────────
-- The third half of the ask: a city owner should be able to see which of their
-- residents are on offer to camps, and to whom.
create or replace function public.city_labour_mine(p_city_id uuid)
returns table (
  role       text,
  available  integer,
  hired      integer,
  node_id    text,
  node_owner text
)
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  return query
    select p.role, p.available, p.hired, p.node_id,
           coalesce(o.display_name, '—') as node_owner
      from city_labour_pool p
      left join tw_node_owners o on o.node_id = p.node_id
     where p.city_id = p_city_id
       and p.owner_id = v_uid                     -- only your own city
     order by p.role;
end $$;

-- ── 6. GRANTS ───────────────────────────────────────────────────────────────
revoke all on function public.city_labour_publish(uuid, jsonb)              from public, anon;
revoke all on function public.camp_labour_market()                          from public, anon;
revoke all on function public.camp_hire_from_city(uuid, text, integer, integer) from public, anon;
revoke all on function public.city_labour_mine(uuid)                        from public, anon;
grant execute on function public.city_labour_publish(uuid, jsonb)              to authenticated;
grant execute on function public.camp_labour_market()                          to authenticated;
grant execute on function public.camp_hire_from_city(uuid, text, integer, integer) to authenticated;
grant execute on function public.city_labour_mine(uuid)                        to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFY — run as-is. Expect:
--   pool_table   = city_labour_pool
--   fns          = 4
--   read_policy  = 1     one SELECT policy, and it is the only policy
--   write_policy = 0     ← no table-level write path exists
--   anon_holds   = 0
-- ════════════════════════════════════════════════════════════════════════════
select
  to_regclass('public.city_labour_pool')::text                                   as pool_table,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in
      ('city_labour_publish','camp_labour_market','camp_hire_from_city','city_labour_mine')) as fns,
  (select count(*) from pg_policies where schemaname='public'
     and tablename='city_labour_pool' and cmd='SELECT')                          as read_policy,
  (select count(*) from pg_policies where schemaname='public'
     and tablename='city_labour_pool' and cmd <> 'SELECT')                       as write_policy,
  (select count(*) from information_schema.routine_privileges
    where routine_schema='public' and grantee in ('anon','public')
      and routine_name in ('city_labour_publish','camp_labour_market',
                           'camp_hire_from_city','city_labour_mine'))            as anon_holds;
