-- ===========================================================================
-- 106 . city_state_can_write is PER NODE, and city_state RLS is exactly the
--       014 set
-- ---------------------------------------------------------------------------
-- WHAT WAS WRONG. sql/014 made a hired mayor's right to a city row a question
-- about the OWNER: city_state_can_write(p_owner) answers true for any active
-- node_mayors row with owner_id = p_owner, whatever node the contract names.
-- That was the whole truth in 014's world, where city_state had one row per
-- player. sql/065 re-keyed the table to (user_id, node_id), a player now holds
-- one city PER NODE, and a contract is for one node -- node_mayors.node_id,
-- 'N-25' -- so the 014 test is now too wide by exactly the owner's other
-- cities. Measured live before this change: owner b46f7086 holds cities on
-- N-32 and N-25 and has one active contract, for N-25; every one of the three
-- policies on the table calls city_state_can_write(user_id) with no node term,
-- so the N-25 mayor's INSERT/UPDATE/SELECT on the N-32 row was PERMITTED.
-- Owner 3016401f has the same shape with the all-zeros sentinel row beside
-- N-16. Nothing in the client keeps a mayor on the contract node either --
-- _cityNodeKey() is whatever node is being LOOKED AT.
--
-- ALSO WRONG, and only visible in pg_policies: the live table carries FIVE
-- policies, not 014's three. city_sel (SELECT) and city_upd (UPDATE) test
-- `user_id = auth.uid() or mayor_id = auth.uid()` against the city_state.
-- mayor_id COLUMN. No SQL file in this repo creates them, and no row has ever
-- set that column (35 rows live, 0 with mayor_id) -- they date from the hand
-- run node_city_v2 script that index.html's ~238303 note says the game stopped
-- reading. Policies of the same verb are OR-ed, so they widen nothing today,
-- but they are a second, un-versioned answer to "who may touch a city", and
-- a future change to one set cannot be reasoned about while the other set is
-- still there. They go.
--
-- THE FIX. city_state_can_write(p_owner uuid, p_node text): the owner, always;
-- otherwise an ACTIVE node_mayors row for exactly (p_node, p_owner,
-- auth.uid()). Both tables key the node the same way -- city_state.node_id and
-- node_mayors.node_id are text map ids ('N-06'), and live every active
-- contract's node is one of that owner's city_state.node_id values -- so the
-- test is a plain equality, no mapping. The three policies pass (user_id,
-- node_id). A mayor's rights on the sentinel row ('0000...') are gone with
-- this, deliberately: no contract names the sentinel, and that row is the
-- owner's pre-065 city, not a client's.
--
-- ! ORDER MATTERS. The policies depend on the 1-argument function, so it
--   cannot be dropped while they cite it; the policies go first, then the
--   function, then the new function, then the policies again. apply_migration
--   runs this as one transaction, so the table is never left policy-less
--   (RLS on with no policy denies everything) for a moment anyone can observe.
-- ! The 1-argument overload is DROPPED, not left beside the new one. Two
--   overloads with different key sets are fine for PostgREST, but an old
--   client calling the 1-arg form would get 014's per-owner answer back and
--   read it as "safe to build" on the wrong node. The client feature-detects
--   the other way round: it calls the 2-key form first and falls back to the
--   1-key form only on PGRST202, so a client that ships before this is applied
--   keeps working (see cityStateLoad in public/index.html).
-- ! sql/014 must NOT be re-run after this. Its create-or-replace would put the
--   1-arg overload back and re-point the policies at it, silently undoing the
--   node term. Its header says so.
-- ! SECURITY DEFINER with search_path pinned, exactly as 014 explained: the
--   caller has no SELECT on node_mayors that a policy could rely on, and a
--   policy-to-policy reference would recurse.
-- Idempotent. Plain ASCII.
-- ===========================================================================


-- --- 1. THE POLICIES GO FIRST -- they hold the old function's oid -----------
drop policy if exists city_state_read   on public.city_state;
drop policy if exists city_state_write  on public.city_state;
drop policy if exists city_state_update on public.city_state;
-- the two un-versioned survivors of the hand-run node_city_v2 script
drop policy if exists city_sel          on public.city_state;
drop policy if exists city_upd          on public.city_state;
-- and the original owner-only policy, in case 014 was never run here
drop policy if exists city_state_own    on public.city_state;


-- --- 2. THE FUNCTION, NOW WITH A NODE TERM ---------------------------------
drop function if exists public.city_state_can_write(uuid);

create or replace function public.city_state_can_write(p_owner uuid, p_node text)
returns boolean
language sql
stable
security definer
set search_path = public
as $t$
  select
    -- the owner, always, on every one of their rows
    auth.uid() = p_owner
    -- or the ACTIVE hired mayor of exactly THIS node of THIS owner
    or exists (
      select 1
        from public.node_mayors m
       where m.node_id  = p_node
         and m.owner_id = p_owner
         and m.mayor_id = auth.uid()
         and m.active
    );
$t$;

revoke all on function public.city_state_can_write(uuid, text) from public, anon;
grant execute on function public.city_state_can_write(uuid, text) to authenticated;


-- --- 3. THE 014 SET, PER NODE ----------------------------------------------
create policy city_state_read on public.city_state
  for select using (public.city_state_can_write(user_id, node_id));

create policy city_state_write on public.city_state
  for insert with check (public.city_state_can_write(user_id, node_id));

create policy city_state_update on public.city_state
  for update using (public.city_state_can_write(user_id, node_id))
          with check (public.city_state_can_write(user_id, node_id));

-- ! Still no DELETE policy, for 014's reason: nothing in the game deletes a
--   city_state row and a mayor must never be able to wipe an owner's city.


-- --- 4. VERIFY -------------------------------------------------------------
-- Expect: fn_1arg 0, fn_2arg 1, policies 3, per_node 3, legacy 0,
-- node_term true.
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'city_state_can_write'
      and pg_get_function_identity_arguments(p.oid) = 'p_owner uuid')             as fn_1arg,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'city_state_can_write'
      and pg_get_function_identity_arguments(p.oid) = 'p_owner uuid, p_node text') as fn_2arg,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'city_state')                       as policies,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'city_state'
      and policyname in ('city_state_read', 'city_state_write', 'city_state_update')
      and coalesce(qual, with_check) like '%city_state_can_write(user_id, node_id)%') as per_node,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'city_state'
      and policyname in ('city_sel', 'city_upd', 'city_state_own'))                 as legacy,
  (select pg_get_functiondef(p.oid) like '%m.node_id  = p_node%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'city_state_can_write')              as node_term;

-- After applying, confirm end to end AS A MAYOR (the SQL editor runs as owner
-- and bypasses RLS): sign in as the N-25 mayor of an owner who also has a city
-- on another node. Opening N-25 loads and saves; the other node's row is
-- neither readable (zero rows, and the client probe answers false, so the
-- mayor is told and saves stay local) nor writable.
