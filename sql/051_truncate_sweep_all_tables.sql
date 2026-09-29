-- ════════════════════════════════════════════════════════════════════════════
-- 051 — REVOKE TRUNCATE FROM anon / authenticated ON EVERY TABLE IN public
-- ════════════════════════════════════════════════════════════════════════════
-- Run by hand in the Supabase SQL editor for project ktsiasyjusesawtrwrjc.
-- Idempotent and re-runnable. Ends with a verify query. Touches PRIVILEGES
-- only — no DDL, no data, no policy changes.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 WHY THIS SUPERSEDES THE "corp_licenses / corp_policy_log" ITEM
--
--   That item was WRONG, and the way it was wrong is the reason this file
--   sweeps instead of lists. It was derived by reading 050's revoke list and
--   noticing two corp tables missing from it — i.e. from the migration, not
--   from the database. Read out of the LIVE database on 2026-08-25:
--
--     corp_licenses     exists, TRUNCATE grants to anon/authenticated: 0
--     corp_policy_log   exists, TRUNCATE grants to anon/authenticated: 0
--
--   Both were already clean. 050 did its job: of every remaining `corp%`
--   object holding TRUNCATE, exactly ONE is left — `corp_policies_current` —
--   and that is a VIEW. Postgres will not TRUNCATE a view, so it is noise in
--   `information_schema`, not a hole.
--
--   The actual finding is 44x larger and has nothing to do with corps:
--
--     222 real tables in `public` still grant TRUNCATE to anon / authenticated
--     222 of those 222 have RLS ENABLED
--      13 views also appear in the grant listing and are harmless
--
--   Among the 222: `chat_messages`, `guild_chat`, `player_banks`.
--
--   RLS DOES NOT APPLY TO TRUNCATE. This is the whole point, and it is worth
--   restating because "RLS is enabled on all 222" reads like reassurance and is
--   the opposite. TRUNCATE never evaluates a row policy — it is a table-level
--   operation. So every `using (auth.uid() = …)` on those 222 tables is moot
--   against any signed-in player who issues a TRUNCATE. One statement empties a
--   table, game-wide, whatever its policies say.
--
--   These grants come from the Supabase bootstrap line
--       grant all on all tables in schema public to anon, authenticated;
--   Anything created after that line runs inherits them, which is exactly why a
--   hand-maintained list of table names cannot hold: 050's list was correct on
--   the day it was written and the schema kept growing underneath it. This file
--   enumerates from `pg_class` at run time instead, so it cannot go stale — and
--   it stays correct if you paste it again after the next migration.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS DOES NOT DO
--   SELECT / INSERT / UPDATE / DELETE are untouched. Those are the privileges
--   the app actually uses; RLS governs them and RLS is unchanged by this file.
--   Nothing in the client can issue TRUNCATE anyway — PostgREST has no verb for
--   it — so removing it costs the application exactly nothing.
--
--   TRIGGER and REFERENCES go with it because no client role has any business
--   holding either: both are DDL rights on someone else's table.
--
--   `service_role` and `postgres` are NOT touched. Server-side jobs, the SQL
--   editor and every migration keep working exactly as before.
--
--   Views are skipped (`relkind = 'r'` only). They cannot be truncated, and
--   revoking on them would only churn the grant table.
--
-- ⚠ THE REAL FIX IS UPSTREAM. If you ever re-run `grant all on all tables in
--   schema public to anon, authenticated`, every one of these comes back. Grant
--   the four DML verbs explicitly instead of ALL, and re-paste this file after
--   any migration that creates tables.
-- ════════════════════════════════════════════════════════════════════════════

-- ── APPLIED 2026-08-25 ──────────────────────────────────────────────────────
--   tables holding TRUNCATE for anon/authenticated   222  ->  0
--   TRUNCATE + TRIGGER + REFERENCES grant rows         ~  ->  0
--   chat_messages · guild_chat · player_banks · corp_treasury · user_progress
--   · wallet_ledger                                          all clear
--
--   ⚠ 26 grant rows REMAIN and are supposed to. They are the 13 views x 2
--     grantees. Postgres will not TRUNCATE a view, so they are noise in
--     information_schema and not a hole — this is exactly why the verify query
--     joins pg_class on relkind='r'. Re-running the UNFILTERED version of that
--     query returns those 26 and looks like a failure; it is not.
--
--   AND THE HALF WORTH CHECKING AFTER A PRIVILEGE SWEEP — that nothing the app
--   needs went with it. Read back the same day:
--     SELECT  248 tables · INSERT 205 · UPDATE 205 · DELETE 206  (authenticated)
--   i.e. every verb the client actually uses is untouched, which is the claim
--   the header makes and the only one that could have been wrong.
-- ════════════════════════════════════════════════════════════════════════════

-- ── BEFORE ──────────────────────────────────────────────────────────────────
-- Recorded so the run has a visible before/after and not just a silent zero.
select 'before' as phase,
       count(distinct c.relname) as tables_holding_truncate
from information_schema.role_table_grants g
join pg_class c      on c.relname = g.table_name and c.relkind = 'r'
join pg_namespace n  on n.oid = c.relnamespace and n.nspname = 'public'
where g.table_schema = 'public'
  and g.privilege_type = 'TRUNCATE'
  and g.grantee in ('anon', 'authenticated');

-- ── SWEEP ───────────────────────────────────────────────────────────────────
-- Enumerated from pg_class at run time, so it covers tables that did not exist
-- when this file was written. REVOKE of a privilege that is not held is a
-- no-op rather than an error, so this is safe to run repeatedly.
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public'
      and c.relkind = 'r'                      -- ordinary tables only, never views
    order by c.relname
  loop
    execute format(
      'revoke truncate, trigger, references on public.%I from anon, authenticated',
      r.relname);
    n := n + 1;
  end loop;
  raise notice 'swept % table(s) in public', n;
end $$;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- Expected: ZERO rows. Any row printed is a TABLE a signed-in player can still
-- empty in one statement regardless of its RLS policies.
-- ⚠ `relkind = 'r'` here too. Without it this returns the 13 views and looks
--   like a failure when nothing is wrong — views cannot be truncated.
select g.table_name, g.grantee, g.privilege_type
from information_schema.role_table_grants g
join pg_class c      on c.relname = g.table_name and c.relkind = 'r'
join pg_namespace n  on n.oid = c.relnamespace and n.nspname = 'public'
where g.table_schema = 'public'
  and g.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')
  and g.grantee in ('anon', 'authenticated')
order by g.table_name, g.grantee, g.privilege_type;

-- ── AND THE VIEWS, FOR THE RECORD ───────────────────────────────────────────
-- Expected: the 13 views, unchanged and harmless. Listed so that a reader who
-- runs the un-filtered version of the verify query above knows why it is not
-- empty and does not "fix" it.
select 'view (not truncatable — expected)' as note,
       string_agg(distinct g.table_name, ', ' order by g.table_name) as views
from information_schema.role_table_grants g
join pg_class c      on c.relname = g.table_name and c.relkind = 'v'
join pg_namespace n  on n.oid = c.relnamespace and n.nspname = 'public'
where g.table_schema = 'public'
  and g.privilege_type = 'TRUNCATE'
  and g.grantee in ('anon', 'authenticated');
