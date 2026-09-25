-- ════════════════════════════════════════════════════════════════════════════
-- 050 — REVOKE TRUNCATE ON EVERY CORP TABLE
-- ════════════════════════════════════════════════════════════════════════════
-- Run by hand in the Supabase SQL editor for project ktsiasyjusesawtrwrjc.
-- Idempotent and re-runnable. Ends with a verify query. No DDL on data.
--
-- 🔴 WHY THIS IS ITS OWN FILE, AND WHY IT IS THE MOST URGENT ONE
--   RLS DOES NOT APPLY TO TRUNCATE. Every policy on these tables — every
--   carefully reviewed `using (auth.uid() = …)` — is moot against a role that
--   holds the TRUNCATE privilege, because TRUNCATE is a table-level DDL-ish
--   operation that never evaluates a row policy. A single signed-in player
--   could have emptied every corporation's vault, roster, treasury and the
--   corporations table itself, game-wide, with five statements.
--
--   Read out of the LIVE database on 2026-08-21 (read-only, information_schema):
--     corp_members     anon, authenticated   TRUNCATE
--     corp_treasury    anon, authenticated   TRUNCATE
--     corp_vault       anon, authenticated   TRUNCATE
--     corp_vault_log   anon, authenticated   TRUNCATE
--     corporations     anon, authenticated   TRUNCATE
--   Ten grants, all live, all unnecessary.
--
--   sql/045 revokes this for corp_vault and corp_vault_log only, and leaves the
--   other three as a COMMENT telling the reader to run it themselves. A comment
--   is not a migration; nobody ran it, and 045 is itself still pending. This
--   file is the paste-able version, and it covers corp_treasury — which 045
--   never mentioned at all, and which holds the ledger every guild's money is.
--
--   ⚠ These grants come from `grant all on all tables in schema public to
--   anon, authenticated`, which is a common Supabase bootstrap line. Any table
--   created after that line runs inherits the same problem. If you add a corp
--   table later, revoke it there too — or better, stop granting ALL.
--
-- WHAT THIS DOES NOT DO
--   It does not touch SELECT / INSERT / UPDATE / DELETE. Those are the
--   privileges the app actually uses and they stay exactly as they are; RLS is
--   what governs them and RLS is unchanged by this file. TRIGGER and REFERENCES
--   go with TRUNCATE because no client role has any business holding either.
--
--   It is safe to run more than once: REVOKE on a privilege that is not held
--   is a no-op, not an error.
-- ════════════════════════════════════════════════════════════════════════════

revoke truncate, trigger, references on public.corp_vault     from anon, authenticated;
revoke truncate, trigger, references on public.corp_vault_log from anon, authenticated;
revoke truncate, trigger, references on public.corp_members   from anon, authenticated;
revoke truncate, trigger, references on public.corporations   from anon, authenticated;
revoke truncate, trigger, references on public.corp_treasury  from anon, authenticated;

-- Tables from the still-pending migrations. Guarded so this file can be pasted
-- BEFORE or AFTER 047/048 without erroring on an object that does not exist yet
-- — but re-run it after applying those, because a table created later by a
-- `grant all` bootstrap will arrive holding TRUNCATE again.
do $$
declare t text;
begin
  foreach t in array array['corp_staff_desk', 'corp_trade_offers', 'corp_transfers', 'corp_requests', 'corp_operations']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke truncate, trigger, references on public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- Expected after this file: ZERO rows. Any row printed is a table a signed-in
-- player can still empty in one statement, regardless of its RLS policies.
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')
  and grantee in ('anon', 'authenticated')
  and table_name like 'corp%'
order by table_name, grantee, privilege_type;
