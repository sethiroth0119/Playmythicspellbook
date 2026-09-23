-- ============================================================================
-- 197 — CLOSE THE BANK OF ETHOS MINT: boe_adjust_balance() refuses credits.
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
--
-- ⚖ WHY REFUSE CREDITS RATHER THAN REVOKE (owner session, 2026-09-23). No
-- v121v116 client calls it, but the live build (v121v185) could not be
-- inspected. A revoke would break any remaining caller outright; refusing a
-- positive delta closes the mint completely while a DEBIT (the only thing a
-- post-030 client could legitimately send) keeps working. Once
--     grep -rn "boe_adjust_balance" public/     (on the live build)
-- finds nothing, the optional revoke at the bottom can be run too.
--
-- NOT IN THIS FILE (owner decisions, not code):
--   * Existing bank balances that came from the pre-022 client deposit path
--     are real rows today and remain withdrawable with no daily cap. One
--     account holds 1.08 BILLION in the bank (legacy 'Cinder deposit to bank'
--     rows, 2026-08-09..10) and has withdrawn 385M since, in 22 moves.
--   * boe_ledger still has a client INSERT policy (user_id = auth.uid()); it
--     is display history, not money, but it means boe_ledger is not evidence.
--
-- Idempotent and re-runnable. Verify query at the end: both rows as noted.
-- ============================================================================

begin;

create or replace function public.boe_adjust_balance(p_delta_cinder numeric default 0, p_delta_aza numeric default 0)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid uuid := auth.uid();
  v_bal numeric;
  v_aza numeric;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  -- 🔴 sql/197: a client may only DEBIT its bank here. Money reaches the bank
  -- through boe_transfer('deposit'), which moves Cinder the wallet holds.
  if coalesce(p_delta_cinder, 0) > 0 or coalesce(p_delta_aza, 0) > 0 then
    select balance, aza into v_bal, v_aza from public.bank_of_ethos where user_id = v_uid;
    return jsonb_build_object('ok', false, 'error', 'credit_not_allowed',
                              'balance', coalesce(v_bal, 0), 'aza', coalesce(v_aza, 0));
  end if;

  -- Unchanged from sql/004: one statement, row-locked, overdraft-guarded.
  update public.bank_of_ethos
     set balance    = balance + coalesce(p_delta_cinder, 0),
         aza        = aza     + coalesce(p_delta_aza, 0),
         updated_at = now()
   where user_id = v_uid
     and balance + coalesce(p_delta_cinder, 0) >= 0
     and aza     + coalesce(p_delta_aza, 0)    >= 0
  returning balance, aza into v_bal, v_aza;

  if not found then
    select balance, aza into v_bal, v_aza from public.bank_of_ethos where user_id = v_uid;
    return jsonb_build_object('ok', false, 'error', 'insufficient_or_missing',
                              'balance', coalesce(v_bal, 0), 'aza', coalesce(v_aza, 0));
  end if;

  return jsonb_build_object('ok', true, 'balance', v_bal, 'aza', v_aza);
end $function$;

revoke all on function public.boe_adjust_balance(numeric, numeric) from public, anon;

commit;

-- OPTIONAL, LATER — once the live build is confirmed to have no caller:
-- revoke all on function public.boe_adjust_balance(numeric, numeric) from authenticated;

-- VERIFY — expect: anon may execute = false; refuses credits = true.
select 'anon may execute' as check,
       has_function_privilege('anon', 'public.boe_adjust_balance(numeric, numeric)', 'execute')::text as value
union all
select 'refuses credits',
       (position('credit_not_allowed' in pg_get_functiondef('public.boe_adjust_balance(numeric, numeric)'::regprocedure)) > 0)::text;
