-- ============================================================================
-- 197 — CLOSE THE BANK OF ETHOS MINT: boe_adjust_balance() is still callable.
--
-- FOUND WHILE MAPPING THE CINDER FAUCETS (sql/196), 2026-09-23, read-only:
--   has_function_privilege('authenticated', 'public.boe_adjust_balance(numeric,numeric)',
--                          'execute')  →  true   (production)
--
-- sql/004 created boe_adjust_balance(p_delta_cinder, p_delta_aza): a SIGNED
-- delta on the caller's own bank_of_ethos row, overdraft-guarded but with NO
-- bound on a positive delta and NO ledger row. sql/030 retired it on the
-- client — its own header says the generic adjust "would hand back the mint
-- this whole line of work exists to close: boe_adjust(1e9, 0) then withdraw" —
-- and the client's _boeAdjust() now calls the debit-only boe_spend(). But 030
-- never REVOKED 004's function, so the door is still open from any
-- supabase-js console:
--     rpc('boe_adjust_balance', { p_delta_cinder: 1e12, p_delta_aza: 1e9 })
--     rpc('boe_transfer', { p_amount: 1e12, p_dir: 'withdraw' })
-- boe_transfer's withdraw writes user_progress.cinder directly (not through
-- wallet_credit), so none of sql/093's per-call, hourly or daily limits apply.
-- The Aza half is premium currency (boe_transfer_aza moves it to the wallet).
-- This is larger than every wallet_credit faucet combined: unbounded, one
-- round trip, and invisible in wallet_ledger except as an ordinary
-- 'Bank of Ethos withdraw' row.
--
-- WHY A PLAIN REVOKE IS SAFE. No v121v116 client calls it (grep of public/:
-- zero hits; _boeAdjust → boe_spend since sql/030). Every other function that
-- moves bank_of_ethos.balance is SECURITY DEFINER and does not go through it
-- (_boe_apply, boe_exchange_aza, boe_transfer, boe_transfer_aza,
-- economy_reset_row, warpath_enter), so revoking the grant breaks nothing
-- server-side.
--   ⚠ PRECONDITION: confirm the same on the LIVE build before applying —
--       grep -rn "boe_adjust_balance" public/     (on v121v185)  → no hits
--     If it does have a caller, that caller is a debit (credits have been
--     refused client-side since 030); switch it to boe_spend(-dC, -dA, reason)
--     first, the way _boeAdjust already does.
--
-- NOT IN THIS FILE (report to the owner, decisions not code):
--   * Existing bank balances that came from the pre-022 client deposit path
--     are real rows today and remain withdrawable with no daily cap. One
--     account holds 1.08 BILLION in the bank (legacy 'Cinder deposit to bank'
--     rows, 2026-08-09..10) and has withdrawn 385M since, in 22 moves. Whether
--     that stock is legitimate is an owner/audit question.
--   * boe_ledger still has a client INSERT policy (user_id = auth.uid()); it
--     is display history, not money, but it means boe_ledger is not evidence.
--
-- Re-runnable. Never applied by an agent — paste into the Supabase SQL editor
-- for project ktsiasyjusesawtrwrjc. Verify: both rows 'false'.
-- ============================================================================

do $$
begin
  if to_regprocedure('public.boe_adjust_balance(numeric, numeric)') is not null then
    revoke all on function public.boe_adjust_balance(numeric, numeric) from public, anon, authenticated;
  end if;
end $$;

-- VERIFY — nobody but the owner may execute it any more (both 'false'; no rows
-- if the function does not exist at all, which is also fine).
select r.rolname as role,
       has_function_privilege(r.rolname, 'public.boe_adjust_balance(numeric, numeric)', 'execute')::text as may_execute
  from pg_roles r
 where r.rolname in ('anon', 'authenticated')
   and to_regprocedure('public.boe_adjust_balance(numeric, numeric)') is not null;
