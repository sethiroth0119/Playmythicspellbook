-- ===========================================================================
-- 097 — ACCOUNT SEPARATION: close two ways one account could reach another.
--
-- WHY THIS EXISTS
-- Asked for as "make sure every aspect of the game runs like a multiplayer game
-- and separate players account so no one account overwrite others". This file is
-- the DATABASE half of that sweep. RLS is the entire security boundary in this
-- project (CLAUDE.md), so a table without it is not "less protected" — it is
-- unprotected, and the publishable key that reaches it ships inside index.html.
--
-- WHAT WAS FOUND, and what was NOT
-- The audit swept every SECURITY DEFINER function that takes a user id, and
-- most of them were fine: msb_award_cinder checks auth.jwt()->>'email',
-- up_force_reset calls ms_is_admin(), eb_placement_record reads the same email
-- claim out of request.jwt.claims. Grepping for `auth.uid()` alone reported all
-- three as unguarded, which is why each one was read before anything was
-- changed. Two things did not survive that reading.
--
-- ── 1. SIX ABANDONED BACKUP TABLES, WORLD READ-WRITE ───────────────────────
-- One-off snapshots taken during past incidents — including one of the very
-- vault this sweep started from. RLS was never enabled on them and the default
-- grants were never revoked, so `anon` holds SELECT, INSERT, UPDATE, DELETE and
-- TRUNCATE on all six. They hold whole `forge` payloads for real accounts, so
-- this is every player's saved game readable by anybody with the key, and
-- destroyable by them too.
--
-- ENABLE, DO NOT DROP. They are incident evidence and dropping them is the one
-- irreversible option on the table. With RLS on and no policy, the tables are
-- deny-all to anon and authenticated and remain fully readable by service_role
-- and by the SQL editor, which is who actually needs them.
-- ⚠ THE GRANTS ARE REVOKED TOO, not just RLS enabled. RLS with no policy is
--   already deny-all for reads and writes, but TRUNCATE is NOT an RLS-gated
--   operation — it is a table privilege, and a table privilege is checked before
--   any row policy is consulted. Enabling RLS alone would have left `anon` able
--   to empty all six.
--
-- ── 2. _push_notify, CALLABLE BY EVERY SIGNED-IN PLAYER ────────────────────
-- An internal helper (underscore prefix, and 013_push_autofire calls it from
-- triggers) that takes an ARRAY of user ids plus a title and body and posts them
-- to the push service. It has no authorisation check of any kind, and
-- `authenticated` held EXECUTE — so any player could push arbitrary text to any
-- other player, or to all of them, under the game's own name.
--
-- Triggers are unaffected: they run as the function owner, not as the caller, so
-- every legitimate caller keeps working. The only client-side caller,
-- index.html:235121, passes `p_user` where the function takes `p_user_ids` —
-- PostgREST cannot resolve that overload, so that call has never once fired.
-- Revoking cannot break it because it was already broken; the trade-agreement
-- push it was meant to send has never been sent and needs its own fix.
--
-- Idempotent and re-runnable. Verify queries at the bottom.
-- ===========================================================================

-- ── 1. THE BACKUP TABLES ───────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'city_state_rekey_backup_20260829',
    'corp_merge_backup_20260829',
    'forge_cards_backup_shufflezones',
    'grimalkin_prn_city_backup_20260829',
    'lids_vault_backup_20260830',
    'prn_removed_backup_20260829',
    -- These two already had their grants revoked but never had RLS enabled.
    -- Included so the whole class ends in one state rather than two.
    'city_profiles_backup_20260825',
    'city_state_backup_20260825'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;

-- ── 2. THE PUSH HELPER ─────────────────────────────────────────────────────
revoke execute on function public._push_notify(uuid[], text, text, text, text, text)
  from anon, authenticated;

-- ===========================================================================
-- VERIFY
-- ---------------------------------------------------------------------------
-- Every backup table denies anon, and TRUNCATE is gone with the rest:
--   select c.relname, c.relrowsecurity as rls,
--          has_table_privilege('anon', c.oid, 'SELECT')   as anon_select,
--          has_table_privilege('anon', c.oid, 'TRUNCATE') as anon_truncate
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relname like '%backup%'
--    order by c.relname;
--   -- expect rls = true and both privilege columns false on every row.
--
-- The push helper is unreachable from a browser session but still reachable
-- from the triggers that own it:
--   select p.oid::regprocedure,
--          has_function_privilege('anon',          p.oid, 'EXECUTE') as anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed,
--          has_function_privilege('service_role',  p.oid, 'EXECUTE') as service
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = '_push_notify';
--   -- expect anon = false, authed = false, service = true.
-- ===========================================================================
