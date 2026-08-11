-- ===========================================================================
-- 026b . LOCK THE REMAINING WALLET TABLES
-- ===========================================================================
-- Companion to 026. That file locked the two wallet COLUMNS on user_profiles;
-- this one takes the client's write privilege off every TABLE the currency
-- system owns, so none of it rests on "there happens to be no RLS policy".
--
-- 023 dropped the up_ins/up_upd policies on user_progress, which already made
-- a client UPDATE match zero rows. But the GRANT survived, so the protection
-- was one accidentally re-added policy away from evaporating. The client only
-- ever SELECTs these tables, and every writer is SECURITY DEFINER and bypasses
-- grants, so removing the write privilege costs nothing and removes the
-- dependency on policy hygiene.
--
-- ⚠ APPLIED TO PRODUCTION 2026-08-10 as migration `lock_user_progress_writes_026b`
--   (version 20260810193345) BEFORE this file existed — it was run inline. The
--   file is written after the fact so the repo matches the database. Re-running
--   it is a no-op.
--
-- Apply AFTER 026. Idempotent.
-- ===========================================================================

revoke insert, update, delete on public.user_progress from anon, authenticated;
grant  select                 on public.user_progress to   authenticated;

-- Reward bookkeeping: readable so the UI can show honest limits from the same
-- rows that enforce them, never writable.
revoke insert, update, delete on public.aza_reward_rules    from anon, authenticated;
revoke insert, update, delete on public.aza_reward_settings from anon, authenticated;
revoke insert, update, delete on public.aza_reward_log      from anon, authenticated;
revoke insert, update, delete on public.aza_refunds         from anon, authenticated;
revoke insert, update, delete on public.aza_purchases       from anon, authenticated;
revoke insert, update, delete on public.wallet_ledger       from anon, authenticated;
revoke insert, update, delete on public.bank_of_ethos       from anon, authenticated;

grant select on public.aza_reward_rules    to authenticated;
grant select on public.aza_reward_settings to authenticated;
grant select on public.aza_reward_log      to authenticated;
grant select on public.aza_refunds         to authenticated;
grant select on public.aza_purchases       to authenticated;
grant select on public.wallet_ledger       to authenticated;
grant select on public.bank_of_ethos       to authenticated;

-- ===========================================================================
-- VERIFY — every write false, every read true.
-- ===========================================================================
-- select relname,
--        has_table_privilege('authenticated', c.oid, 'SELECT') as sel,
--        has_table_privilege('authenticated', c.oid, 'UPDATE') as upd,
--        has_table_privilege('authenticated', c.oid, 'INSERT') as ins
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname = 'public'
--    and relname in ('user_progress','bank_of_ethos','wallet_ledger','aza_purchases',
--                    'aza_refunds','aza_reward_rules','aza_reward_settings','aza_reward_log')
--  order by relname;
--   -> sel true, upd false, ins false on all eight
