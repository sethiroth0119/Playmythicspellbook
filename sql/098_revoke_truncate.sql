-- ===========================================================================
-- 098 — TRUNCATE IS NOT GATED BY RLS. REVOKE IT FROM THE CLIENT ROLES.
--
-- WHY THIS EXISTS
-- Found while verifying 097. Enabling RLS on the backup tables did not make
-- them safe, and the verify query is what said so: `anon` still held TRUNCATE
-- on one of them with RLS on and no policy.
--
-- TRUNCATE IS A TABLE PRIVILEGE, and table privileges are checked BEFORE any
-- row policy is consulted. RLS filters rows; it has no opinion about an
-- operation that removes all of them at once. So every "RLS is enabled, we are
-- fine" reading of these tables was wrong in exactly one direction, and it was
-- the direction that empties them.
--
-- 39 tables in `public` had TRUNCATE granted to anon or authenticated. Among
-- them: user_profiles_history (every player's archived saves — the table
-- up_force_reset writes to before it resets anyone, i.e. the undo), wallet_holds,
-- influence_ledger, mission_credits, player_dwellings, pharma_lots,
-- cure_shipments, tw_world_map and world_maps. Each one is every account's data
-- in a single table, removable in a single statement, by one player.
--
-- ⚠ HOW REACHABLE IS IT, HONESTLY. PostgREST exposes no TRUNCATE verb, so there
--   is no known path from the shipped client to any of these grants today. This
--   is defence in depth and it is worth saying plainly rather than overselling:
--   the grant should never have existed, any SECURITY INVOKER function that
--   builds dynamic SQL would make it live, and a direct connection with the
--   publishable key makes it live immediately. Nothing legitimate truncates as
--   a client role, so there is no cost to removing it.
--
-- ⚠ THE DEFAULT PRIVILEGE TOO, or the next `create table` re-grants it and this
--   file becomes a snapshot of one afternoon rather than a rule.
--
-- Idempotent and re-runnable. Verify query at the bottom.
-- ===========================================================================

do $$
declare r record;
begin
  for r in
    select c.oid, c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and (has_table_privilege('anon', c.oid, 'TRUNCATE')
            or has_table_privilege('authenticated', c.oid, 'TRUNCATE'))
  loop
    execute format('revoke truncate on public.%I from anon, authenticated', r.relname);
  end loop;
end $$;

alter default privileges in schema public revoke truncate on tables from anon, authenticated;

-- ===========================================================================
-- VERIFY — expect 0.
--   select count(*)
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relkind = 'r'
--      and (has_table_privilege('anon', c.oid, 'TRUNCATE')
--           or has_table_privilege('authenticated', c.oid, 'TRUNCATE'));
-- ===========================================================================
