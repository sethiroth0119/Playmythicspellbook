-- ===========================================================================
-- 014 - LET A HIRED MAYOR ACTUALLY SAVE THE CITY THEY RUN
--
-- Reported from the game: "Node managers are working on owners cities and the
-- work the managers are working on the city builder is not saving."
--
-- THE CAUSE. city_state.sql ships exactly one policy:
--
--     create policy city_state_own on public.city_state
--       for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
--
-- A mayor edits the OWNER's row - _cityStateUserId() resolves to
-- App._cityOwnerId, which is correct and deliberate. But that row has
-- user_id = <owner>, so for a mayor auth.uid() <> user_id and the policy
-- rejects BOTH halves:
--   * the UPSERT fails `with check`  -> the work never reaches the cloud
--   * the SELECT fails `using`       -> they cannot even read the owner's city,
--                                       so it loads empty and looks unbuilt
--
-- It was invisible because window.cityStateSave ends in `catch (e) {}` with no
-- logging, so a rejected write is indistinguishable from a successful one. The
-- city kept its localStorage copy, so it looked saved until the next load on
-- any other device - or until the owner looked.
--
-- A code comment in index.html (~201257) claims the RLS in
-- node_city_v2_mayors_plots_levels already covers this. It does not - either
-- that migration was never applied or it never granted mayor access. Verified
-- against the shipped city_state.sql, which is owner-only.
--
-- Requires: city_state.sql, and node_mayors from supabase-ALL-PENDING.sql.
-- Idempotent. Plain ASCII.
-- ===========================================================================


-- --- 1. WHO MAY TOUCH A GIVEN CITY ROW -------------------------------------
-- ! SECURITY DEFINER on purpose. A policy on city_state that SELECTs
--   node_mayors would need the caller to hold select rights on node_mayors, and
--   any policy on node_mayors that in turn referenced city_state would recurse.
--   Wrapping the lookup in a definer function breaks that loop outright: the
--   function runs as owner, the policy just calls it.
-- ! search_path is pinned - a SECURITY DEFINER function without it can be
--   hijacked by a caller-controlled search_path.
create or replace function public.city_state_can_write(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $t$
  select
    -- the owner, always
    auth.uid() = p_owner
    -- or the ACTIVE hired mayor of a node that owner owns
    or exists (
      select 1
        from public.node_mayors m
       where m.owner_id = p_owner
         and m.mayor_id = auth.uid()
         and m.active
    );
$t$;

revoke all on function public.city_state_can_write(uuid) from public, anon;
grant execute on function public.city_state_can_write(uuid) to authenticated;


-- --- 2. REPLACE THE OWNER-ONLY POLICY --------------------------------------
-- Split into explicit verbs rather than FOR ALL, so the intent is readable and
-- a future change to one verb cannot silently widen the others.
drop policy if exists city_state_own    on public.city_state;
drop policy if exists city_state_read   on public.city_state;
drop policy if exists city_state_write  on public.city_state;
drop policy if exists city_state_update on public.city_state;

create policy city_state_read on public.city_state
  for select using (public.city_state_can_write(user_id));

create policy city_state_write on public.city_state
  for insert with check (public.city_state_can_write(user_id));

create policy city_state_update on public.city_state
  for update using (public.city_state_can_write(user_id))
          with check (public.city_state_can_write(user_id));

-- ! No DELETE policy, deliberately. Nothing in the game deletes a city_state
--   row, and a mayor must never be able to wipe an owner's city. Absence of a
--   policy denies by default.


-- --- 3. VERIFY -------------------------------------------------------------
-- Expect: fn 1, policies 3 (read/write/update), no city_state_own left.
select
  (select count(*) from pg_proc  p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'city_state_can_write')          as fn,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'city_state')                    as policies,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'city_state'
      and policyname = 'city_state_own')                                         as old_policy_left;

-- After applying, confirm end to end AS THE MAYOR (not in the SQL editor, which
-- runs as owner and therefore bypasses RLS):
--   1. sign in as the mayor, open the owner's city, place one building
--   2. wait ~6s for the flush, hard-refresh, reopen
--   3. the building is still there, and the OWNER sees it too
-- If it still does not stick, the write is failing for a different reason -
-- see 015 below, which makes that failure visible instead of silent.
