-- ════════════════════════════════════════════════════════════════════════════
-- 075 · THE NODE DEPOT INDEX — and the destination gate freight was missing
--
-- ✅ APPLIED to ktsiasyjusesawtrwrjc on 2026-08-28, and unlike most headers in
--    this folder that is a measurement rather than an intention. It went in
--    through the Supabase MCP as four migrations — 075a_node_depot_index_core,
--    075b_depot_gate_switch, 075c_node_depot_readers, 075d_depot_destination_gate
--    — split ONLY because §4 has to precede §3 (see the banner on §4) and
--    because apply_migration wraps its own transaction, so the begin/commit
--    below were dropped for that run. THIS FILE IS THE AUTHORITY on what those
--    four contain; re-running it whole in the SQL editor is idempotent and
--    reaches the same state.
--
--    The verify block at the bottom, run after: every row true, `gate switched
--    ON` = true, `nodes that can receive freight today` = 0.
--
--    BEHAVIOUR, measured inside a transaction that was rolled back, against the
--    live tables and a real 126-tile city on N-02:
--      · a contract to a node with no depot     → refused `no_depot_at_destination`,
--                                                 DETAIL {"to_node":"…"}, HINT the remedy
--      · the same contract to a node with one   → accepted
--      · a haul_requests post to a no-depot node → refused, same code
--      · CONTROL — the switch off, same write   → accepted, so the refusal was
--                                                 this rule and not something else
--      · depot placed but still building (b.k=0) → node NOT on the map
--      · the same depot finished                 → on the map, lvl 1
--      · being upgraded (b.k=1)                  → still on the map
--      · demolished                              → off the map, index row gone
--    Nothing was left behind: node_depots 0 rows, transport_contracts 0.
--
-- ⚠ RUN sql/073 FIRST. §4 adds a column to transport_config and the verify
--   block reads it, so on a database without 073 this file stops there. The two
--   TRIGGERS are guarded and skip cleanly (073 and 074 are both optional to the
--   index itself, which only needs city_state) — it is the config column that
--   is not optional.
--
-- ── THE RULE, WHICH THE GAME ALREADY PROMISES PLAYERS ──────────────────────
--
--   node-city's BUILDINGS.transport — the Transport Depot, shipped v121p1 —
--   describes itself to the player as: "Rigs drop a load here and take the next
--   one out — a city without one cannot receive freight."
--
--   Nothing enforced that. transport_dispatch() takes `p_to_node text`, writes
--   it onto the contract with `left(…, 40)` and asks nothing else about it, so
--   freight arrived at cities with no apron, no weighbridge and no fuel island,
--   and the building was decoration. This file makes the sentence true.
--
-- ── WHY IT COULD NOT BE DONE BEFORE, IN THE WORDS OF THE FILE THAT COULD NOT ─
--
--   sql/073's own "LIMIT OF THE GUARANTEE" section lists what freight moves
--   that the server cannot see, and the depot is one of them:
--
--       · the depot — city_state, saved as a blob per node
--
--   …and it draws the honest conclusion: "A player who claims depot level 3
--   they never built gets 6 bays and 12 fleet slots, and this file cannot tell.
--   Closing that needs a server-side inventory."
--
--   THIS IS THAT INVENTORY, for exactly one question. Not a general city
--   reader, not a second copy of the city, and emphatically not a client
--   check — the rule decides WHO MAY MOVE GOODS TO WHOM, so a check that runs
--   in the shipper's own browser is theatre. `city_state.state` is jsonb and
--   Postgres can read jsonb, so the server CAN answer "does the city at this
--   node have a finished Transport Depot" — it just needed somewhere to keep
--   the answer that a shipper is allowed to read and nobody is allowed to
--   write. That is `node_depots`: derived, trigger-maintained, one row per
--   (city owner, node), holding a COUNT and a LEVEL and nothing else about the
--   city it was read from.
--
-- ── THE SHAPE OF THE BLOB, MEASURED, NOT ASSUMED ───────────────────────────
--
--   node-city/index.html serialize() writes `state.tiles` as an OBJECT keyed
--   "x,z" → { type, lvl, dmg, rot, … } and, on saves old enough, an ARRAY.
--   sql/064's city_tile_count() already handles both and this file follows it
--   rather than inventing a second opinion about the same field.
--
--   A tile is a FINISHED depot when `type = 'transport'` and it is not still on
--   its first build. The build order rides the tile as `b`, and its `k` is the
--   whole distinction (node-city bldRecord/bldLoad):
--       b.k = 0 → a fresh build in progress. The plot is a construction site.
--                 It already carries `type` and `lvl: 1`, which is exactly why
--                 a naive `type = 'transport'` test would count a depot that
--                 does not exist yet and let freight into a building site.
--       b.k = 1 → an UPGRADE of a depot that is already standing and working.
--                 It counts. Refusing freight because the yard is being
--                 enlarged would punish the upgrade.
--   No `b` key at all → finished. That is the common case.
--
--   ⚠ A DAMAGED depot still counts. `dmg` is a maintenance state the city
--     already prices in its own output; making it a freight cliff would mean a
--     storm silently blockades a player's city, which is a rule nobody could
--     predict from the building's description.
--
-- ── WHAT IS MEASURED LIVE, BEFORE CHOOSING THE DEFAULT ─────────────────────
--
--   Read out of ktsiasyjusesawtrwrjc on 2026-08-28, before writing this:
--       city_state rows                          19
--       …on a real (non-sentinel) node           14
--       …holding a Transport Depot                0      ← every single one
--       transport_contracts rows ever             0
--
--   So on the day this ships the gate refuses EVERY destination, and it refuses
--   no haul that exists, because none does. Those two facts are why the default
--   below is `true` and why that is a safe answer rather than a bold one: the
--   rule is in force from the first haul ever dispatched instead of being
--   retrofitted onto a live freight network later, which is the version of this
--   change that would break contracts in flight.
--
--   🔴 IT IS STILL A SWITCH, AND HERE IT IS. If freight needs to move before
--      anyone has built a depot:
--
--        update public.transport_config set require_depot_at_destination = false where id = 1;
--
--      The index keeps building either way, the client keeps showing which
--      nodes can receive freight either way, and turning it back on is the same
--      line with `true`. Nothing about the switch is one-way.
--
-- ── WHERE THE GATE LIVES, AND WHY NOT IN transport_quote() ─────────────────
--
--   The obvious place is transport_quote(), which transport_dispatch() calls
--   first and whose refusal it hands back verbatim — one edit, a clean
--   {ok:false,error:…} envelope, and the quote refuses before the money dialog.
--   It is not used, for one reason: transport_quote lives in sql/073, and the
--   only way to add a line to it from here is to paste the whole 320-line
--   function into this file. This project applies migrations BY HAND and
--   re-runs them ("idempotent and re-runnable" is in every header), so the day
--   someone re-runs 073 the second copy wins and the gate silently disappears —
--   a security rule that evaporates when a file is re-run is worse than no rule,
--   because everyone believes it is still there.
--
--   A TRIGGER SURVIVES THAT. 073 drops and recreates only its OWN triggers by
--   name; it has never heard of these, so re-running it leaves the gate exactly
--   where it is. It is also the layer this project already trusts for precisely
--   this class of rule: cities, market listings and profiles were all fixed by
--   a database trigger and not a client check (064, 067, 070), because a trigger
--   protects stale cached builds too.
--
--   The cost is paid in the error surface: a trigger RAISES, so the refusal
--   reaches the client as an exception instead of an envelope. That is why the
--   raise is shaped the way sql/073's §2b guards are — a BARE CODE as the
--   message, the numbers as jsonb in DETAIL, the human remedy in HINT — which
--   is the shape /src/transport/contracts.js already parses (`failCoded`,
--   `parseDetail`, `CODE_RE`). The client work in this round adds
--   `no_depot_at_destination` to that table and a PRE-FLIGHT so an ordinary
--   player never meets the exception at all: the panel refuses first, in a
--   sentence, before the cargo is escrowed.
--
--   ⚠ AND THE CHARGE IS NOT AT RISK. transport_dispatch charges through
--     wallet_charge and inserts the contract in the SAME function call, i.e.
--     the same transaction, so a raise on the INSERT rolls the charge back with
--     it. The refusal cannot take a shipper's Cinder.
--
-- Idempotent. Safe to re-run. RLS ships in this file. Ends with a verify block.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. READING A DEPOT OUT OF A CITY BLOB
-- ════════════════════════════════════════════════════════════════════════════
-- immutable, so it can be used in a lateral over city_state without the planner
-- re-deciding what it is on every row. It touches nothing but its argument.
create or replace function public.city_depot_stat(p_state jsonb)
returns table (depots integer, top_lvl integer)
language sql immutable as $fn$
  with arr as (
    -- Both spellings of `tiles`, exactly as sql/064's city_tile_count reads
    -- them. `else '[]'` covers null, a missing key, and a `tiles` that is
    -- neither — jsonb_array_elements on a scalar RAISES, and this function is
    -- called from a trigger on the city save path.
    select case
             when jsonb_typeof(p_state -> 'tiles') = 'object'
               then coalesce((select jsonb_agg(e.value) from jsonb_each(p_state -> 'tiles') e), '[]'::jsonb)
             when jsonb_typeof(p_state -> 'tiles') = 'array'
               then p_state -> 'tiles'
             else '[]'::jsonb
           end as tiles
  ), d as (
    select t.value as tile
      from arr, lateral jsonb_array_elements(arr.tiles) t
     where jsonb_typeof(t.value) = 'object'
       and t.value ->> 'type' = 'transport'
       /* b.k = 0 is a first build still under way: a construction site, not a
          depot. b.k = 1 is an upgrade of a working one and counts. See header.

          🔴 THE `coalesce(… , false)` IS THE WHOLE PREDICATE, NOT TIDINESS, AND
             IT WAS MEASURED. The obvious spelling —
               `and not (jsonb_typeof(t.value->'b') = 'object'
                         and coalesce(t.value->'b'->>'k','0') = '0')`
             — is WRONG for the COMMON CASE, which is a finished tile with no
             `b` key at all. `jsonb_typeof(NULL)` is NULL, `NULL and true` is
             NULL, and `not NULL` is NULL, so WHERE drops the row: every
             finished depot in the game counted as zero. Run against the eleven
             blobs above it returned depots=0 for a plain finished depot and 1
             only for the tile that was mid-UPGRADE — the exact inverse of the
             rule.
             It would also have been INVISIBLE: no city in the world has a depot
             today, so "the index finds none" is the true answer either way, and
             the first player to build one would have found freight still
             refused with nothing in any log to explain it.
             Here NULL = '0' is NULL, coalesced to false, and `not false` keeps
             the row. Three-valued logic, and the test table is in the round's
             notes. */
       and not coalesce(t.value -> 'b' ->> 'k' = '0', false)
  )
  select coalesce(count(*), 0)::int,
         -- `jsonb_typeof(...) = 'number'` and not a bare cast: `lvl` comes out
         -- of a client blob and one row with "3" as a string — or as anything
         -- else — would take the whole index down with a cast error. Same
         -- stance sql/073 takes on the tariff sheet it reads from a client.
         coalesce(max(case when jsonb_typeof(tile -> 'lvl') = 'number'
                           then greatest(1, (tile ->> 'lvl')::int)
                           else 1 end), 0)::int
    from d;
$fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. THE INDEX
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 DERIVED DATA. Every row here is recomputed from a city_state write and
--    nothing else may put a row in it — which is why there is no INSERT, UPDATE
--    or DELETE policy below, not even for the owner. A player who could write
--    this table could declare a depot they never built and open their city to
--    freight (and, in the same move, open a rival's).
create table if not exists public.node_depots (
  user_id    uuid        not null,
  node_id    text        not null,
  depots     integer     not null default 0,
  top_lvl    integer     not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, node_id)
);

-- The lookup the gate makes, on the only shape it asks for.
create index if not exists node_depots_by_node
  on public.node_depots (node_id) where depots > 0;

/* The maintainer. AFTER the row lands, so the city has already saved by the
   time this runs, and — read the exception block — a failure in here can never
   be the reason a player loses a build session. That is the same trade 064
   makes ("repair, do not refuse"): the worst case is a stale index row, which
   costs somebody a refused haul until their next autosave, and the alternative
   is a save that throws because a derived table had a bad day. */
create or replace function public.city_depot_index()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_d int; v_l int;
  -- Cities that were never re-keyed by sql/065's city_claim_node() still sit
  -- under the all-zeros sentinel. It is not a place, so it is not a freight
  -- destination — indexing it would publish a node id no route can name.
  c_sentinel constant text := '00000000-0000-0000-0000-000000000000';
begin
  begin
    if TG_OP = 'DELETE' then
      delete from public.node_depots where user_id = OLD.user_id and node_id = OLD.node_id;
      return OLD;
    end if;

    select s.depots, s.top_lvl into v_d, v_l
      from public.city_depot_stat(NEW.state) s;

    if coalesce(v_d, 0) > 0
       and NEW.node_id is not null and NEW.node_id <> '' and NEW.node_id <> c_sentinel then
      insert into public.node_depots (user_id, node_id, depots, top_lvl, updated_at)
      values (NEW.user_id, NEW.node_id, v_d, coalesce(v_l, 0), now())
      on conflict (user_id, node_id) do update
        set depots = excluded.depots, top_lvl = excluded.top_lvl, updated_at = now();
    else
      -- The depot was demolished, the save arrived empty, or the city moved
      -- node. A stale `true` here is the dangerous direction — it would let
      -- freight into a city that no longer has an apron — so the row goes.
      delete from public.node_depots where user_id = NEW.user_id and node_id = NEW.node_id;
    end if;
  exception when others then
    begin
      raise warning 'city_depot_index skipped for %/%: %', NEW.user_id, NEW.node_id, SQLERRM;
    exception when others then null; end;
  end;
  return NEW;
end $fn$;

drop trigger if exists city_depot_index_trg on public.city_state;
create trigger city_depot_index_trg
  after insert or update or delete on public.city_state
  for each row execute function public.city_depot_index();

-- ── BACKFILL, both directions ─────────────────────────────────────────────
-- Re-runnable: the insert is an upsert and the delete removes rows the cities
-- no longer justify, so running this file twice converges rather than drifting.
insert into public.node_depots (user_id, node_id, depots, top_lvl, updated_at)
select cs.user_id, cs.node_id, s.depots, s.top_lvl, now()
  from public.city_state cs, lateral public.city_depot_stat(cs.state) s
 where s.depots > 0
   and cs.node_id is not null and cs.node_id <> ''
   and cs.node_id <> '00000000-0000-0000-0000-000000000000'
on conflict (user_id, node_id) do update
  set depots = excluded.depots, top_lvl = excluded.top_lvl, updated_at = now();

delete from public.node_depots nd
 where not exists (
   select 1 from public.city_state cs, lateral public.city_depot_stat(cs.state) s
    where cs.user_id = nd.user_id and cs.node_id = nd.node_id and s.depots > 0);

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table public.node_depots enable row level security;

/* You may read YOUR OWN index rows and no one else's. The map every shipper
   needs is published through the SECURITY DEFINER readers in §3 instead, which
   answer with node ids and counts and never with WHO owns the city — a table a
   stranger could select would turn "can freight reach N-25" into "which player
   holds a depot at N-25", which is a different question nobody asked to have
   answered. */
drop policy if exists node_depots_sel_own on public.node_depots;
create policy node_depots_sel_own on public.node_depots
  for select to authenticated using (user_id = auth.uid());

-- No insert / update / delete policy, deliberately. See §2's banner.

revoke all on public.node_depots from public, anon;
grant select on public.node_depots to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. THE SWITCH
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 NUMBERED 4 AND PLACED BEFORE 3 ON PURPOSE — DO NOT "TIDY" IT BACK.
--    §3's transport_depot_gate() is `language sql`, and Postgres VALIDATES a
--    SQL function's body when it is created, not when it is called. With this
--    block below it, applying this file to a database that has never seen the
--    column fails at that CREATE with
--        42703: column f.require_depot_at_destination does not exist
--    and stops — measured, on the first apply. The number is kept so the
--    header's references to §4 still find it.
-- Same `add column if not exists` shape sql/073 §1 uses for every other lever,
-- so this file and that one can be applied in either order and re-run in any
-- combination. Default true — see the measurement in the header, and the one
-- line that turns it off.
do $$
begin
  if to_regclass('public.transport_config') is not null then
    alter table public.transport_config
      add column if not exists require_depot_at_destination boolean not null default true;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. THE READERS — what a shipper is allowed to know
-- ════════════════════════════════════════════════════════════════════════════
-- One node, one boolean. `stable`, so the gate can call it per statement.
create or replace function public.node_has_depot(p_node text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.node_depots
     where node_id = p_node and depots > 0);
$fn$;

/* The whole map, aggregated BY NODE — no user_id, by design (see the RLS note).
   `depots` is summed because two players may both hold a city on one node and
   either one's apron can take a load; `top_lvl` is the best one there, which is
   the figure a route planner would show. */
create or replace function public.node_depot_map()
returns table (node_id text, depots integer, top_lvl integer)
language sql stable security definer set search_path = public as $fn$
  select nd.node_id, sum(nd.depots)::int, max(nd.top_lvl)::int
    from public.node_depots nd
   where nd.depots > 0
   group by nd.node_id
   order by nd.node_id;
$fn$;

/* THE ONE CALL THE CLIENT MAKES. Both halves in one round trip, because asking
   for the node list without asking whether the rule is switched on is how a
   panel ends up refusing a haul the server would have accepted (or, worse,
   promising one it will refuse).
   `required` is read from transport_config, which no client may select — that
   is the whole reason this wrapper is SECURITY DEFINER rather than a view. */
create or replace function public.transport_depot_gate()
returns jsonb language sql stable security definer set search_path = public as $fn$
  select jsonb_build_object(
    'ok', true,
    'required', coalesce((select f.require_depot_at_destination
                            from public.transport_config f where f.id = 1), false),
    'nodes', coalesce((select jsonb_agg(jsonb_build_object(
                                'node', m.node_id, 'depots', m.depots, 'lvl', m.top_lvl)
                              order by m.node_id)
                         from public.node_depot_map() m), '[]'::jsonb));
$fn$;

revoke all on function public.node_has_depot(text)       from public, anon;
revoke all on function public.node_depot_map()           from public, anon;
revoke all on function public.transport_depot_gate()     from public, anon;
revoke all on function public.city_depot_stat(jsonb)     from public, anon;
grant execute on function public.node_has_depot(text)    to authenticated;
grant execute on function public.node_depot_map()        to authenticated;
grant execute on function public.transport_depot_gate()  to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. THE GATE
-- ════════════════════════════════════════════════════════════════════════════
/* 🔴 THE RAISE IS SHAPED FOR THE CLIENT THAT ALREADY EXISTS.
   /src/transport/contracts.js reads a trigger refusal in three parts and this
   raise supplies all three:
     · MESSAGE — a BARE CODE and nothing else. `CODE_RE` is /^[a-z][a-z0-9_]{2,48}$/
       and a message that fails it is printed verbatim instead of being looked
       up, so a friendly English sentence here would DISABLE the friendly
       English sentence the client has for it.
     · DETAIL  — jsonb, parsed by parseDetail(), so the panel can name the node.
     · HINT    — the remedy, for the console and for an admin reading the log.
   Nothing here is decoration; drop any one of them and the player gets a worse
   message than they do now. */
create or replace function public.transport_require_depot()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_req boolean;
begin
  select f.require_depot_at_destination into v_req
    from public.transport_config f where f.id = 1;

  if not found then
    -- Exactly what sql/073's own guards raise when the config row is gone, and
    -- for the same reason: a missing cap must never read as "no cap". The
    -- client has a sentence for this code already.
    raise exception 'transport_config_missing';
  end if;

  if not coalesce(v_req, false) then return NEW; end if;
  -- An unaddressed contract is 073's problem, not this one's. It refuses
  -- `bad_route` upstream, and duplicating that judgement here would mean two
  -- files disagreeing about what an empty node means.
  if coalesce(NEW.to_node, '') = '' then return NEW; end if;

  if public.node_has_depot(NEW.to_node) then return NEW; end if;

  raise exception 'no_depot_at_destination'
    using detail = jsonb_build_object('to_node', NEW.to_node)::text,
          hint   = 'The destination city needs a finished Transport Depot before freight can be unloaded there. '
                || 'Build one in the city at that node (it is in the city build palette), or turn the rule off with: '
                || 'update public.transport_config set require_depot_at_destination = false where id = 1;';
end $fn$;

/* Both triggers are created inside a guard so this file applies in ANY order
   against 073 and 074 — sql/074's header makes the same promise about 073 and
   for the same reason: a migration that only works if another one ran first is
   a migration that gets half-applied at 2am. The verify block names which of
   them was skipped rather than leaving a silent `false`. */
do $$
begin
  if to_regclass('public.transport_contracts') is not null then
    drop trigger if exists transport_contracts_depot_gate on public.transport_contracts;
    create trigger transport_contracts_depot_gate
      before insert on public.transport_contracts
      for each row execute function public.transport_require_depot();
  end if;
end $$;

/* THE BOARD, when it is installed. sql/074 is optional (its own header says so)
   and this file must apply cleanly without it, so the trigger is created inside
   a guard rather than unconditionally.
   Gating the POST and not only the dispatch is the kinder half: a request
   posted to a city that cannot receive it is a contract that wastes a carrier's
   time as well as the shipper's, and the shipper is the one who can fix it. */
do $$
begin
  if to_regclass('public.haul_requests') is not null then
    drop trigger if exists haul_requests_depot_gate on public.haul_requests;
    create trigger haul_requests_depot_gate
      before insert on public.haul_requests
      for each row execute function public.transport_require_depot();
  end if;
end $$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFY — prints its own pass table, plus the one number that decides whether
-- freight can move at all today.
-- ════════════════════════════════════════════════════════════════════════════
select 'node_depots table'                  as check,
       (to_regclass('public.node_depots') is not null)::text as pass
union all
select 'RLS on',
       coalesce((select relrowsecurity::text from pg_class where relname = 'node_depots'), '(no table)')
union all
select 'no write policy on the index (derived data)',
       ((select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
          where c.relname = 'node_depots' and p.polcmd in ('a','w','d')) = 0)::text
union all
-- ⚠ `tgrelid = 'public.x'::regclass` THROWS when x does not exist, which would
--    take the whole verify block down on a database missing 073 — the one case
--    the block is most needed. Matched through the catalog by name instead.
select 'index trigger on city_state',
       (exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                 where t.tgname = 'city_depot_index_trg' and c.relname = 'city_state'))::text
union all
select 'gate trigger on transport_contracts (needs 073)',
       case when to_regclass('public.transport_contracts') is null then 'n/a — 073 not applied'
            else (exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                           where t.tgname = 'transport_contracts_depot_gate'
                             and c.relname = 'transport_contracts'))::text end
union all
select 'gate trigger on haul_requests (needs 074)',
       case when to_regclass('public.haul_requests') is null then 'n/a — 074 not applied'
            else (exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                           where t.tgname = 'haul_requests_depot_gate'
                             and c.relname = 'haul_requests'))::text end
union all
select 'all four readers present',
       ((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname in
            ('city_depot_stat','node_has_depot','node_depot_map','transport_depot_gate')) = 4)::text
union all
-- (Reads transport_config directly. If 073 is not applied this row is where the
--  verify block stops, with "relation does not exist" — which is the honest
--  answer to "is the gate on?" and is why the header says to run 073 first. A
--  `case … to_regclass …` guard would NOT have helped: Postgres resolves the
--  table name at parse time, in both branches of a CASE.)
select 'gate switched ON',
       coalesce((select f.require_depot_at_destination::text
                   from public.transport_config f where f.id = 1), 'no config row!')
union all
-- 🔴 READ THIS ROW. While it is 0 and the row above is `true`, EVERY dispatch
--    is refused with no_depot_at_destination — correctly, because no city in
--    the world has built a depot yet. Either someone builds one, or:
--      update public.transport_config set require_depot_at_destination = false where id = 1;
select 'nodes that can receive freight today',
       (select count(*)::text from public.node_depot_map())
union all
select 'cities indexed (owner, node pairs with a depot)',
       (select count(*)::text from public.node_depots where depots > 0);
