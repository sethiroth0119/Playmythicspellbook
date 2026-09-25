-- ═══════════════════════════════════════════════════════════════════════════
-- 004 · BANK OF ETHOS — ATOMIC BALANCE MOVES  🔴 ECONOMY EXPLOIT FIX
--
-- THE BUG (reported 2026-08-05: "withdrawing resets the bank back, which
-- causes farming").
--   Every bank operation in the client was a READ-MODIFY-WRITE of an absolute
--   value: read BankEthos.balance into memory, compute balance ± amount, write
--   the whole column back. openBankOfEthos() starts TWO concurrent chains —
--   boeApplyMaintenance() and boeAutoSettle → boeFetchLoans →
--   boeMercAutoSettle → boeMarketAutoSettle — and each captured its own
--   `prevBal` before the player touched anything.
--
--   Withdraw while one of those is still in flight and it writes its stale
--   prevBal straight over the decrement. The bank row goes back to what it was.
--   The wallet had ALREADY been credited by addGems(). Repeat = infinite Cinder.
--
-- THE FIX
--   Move the arithmetic to the database, where `balance = balance - amt` is a
--   single atomic statement. No read-modify-write, so there is nothing to lose
--   an update against, and the guard is in the same statement so a balance can
--   never go negative or be overdrawn by two racing tabs.
--
--   The client credits the wallet ONLY on a confirmed new balance returned from
--   here. A move that does not happen now costs the player nothing and mints
--   nothing.
--
-- Supabase SQL editor, project ktsiasyjusesawtrwrjc. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

-- Adjust the caller's OWN bank row by a signed delta, atomically.
--   p_delta_cinder / p_delta_aza  — may be negative
--   returns { ok, balance, aza }  — ok=false means nothing was written
--
-- ⚠ SECURITY DEFINER, but it only ever touches auth.uid()'s row. There is no
--   parameter naming a user, so it cannot be aimed at anyone else.
create or replace function public.boe_adjust_balance(
  p_delta_cinder numeric default 0,
  p_delta_aza    numeric default 0)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_bal numeric;
  v_aza numeric;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  -- The whole fix is this one statement. The read and the write are the same
  -- operation, and the row is locked for its duration, so a concurrent chain
  -- cannot compute a stale base and overwrite it.
  update public.bank_of_ethos
     set balance    = balance + coalesce(p_delta_cinder, 0),
         aza        = aza     + coalesce(p_delta_aza, 0),
         updated_at = now()
   where user_id = v_uid
     -- Overdraft guard, in the same statement rather than a check before it.
     -- A withdrawal that would go negative simply matches no row.
     and balance + coalesce(p_delta_cinder, 0) >= 0
     and aza     + coalesce(p_delta_aza, 0)    >= 0
  returning balance, aza into v_bal, v_aza;

  if not found then
    -- Either the row is missing or the move would overdraw. Report the CURRENT
    -- balance so the client can correct its own copy instead of guessing.
    select balance, aza into v_bal, v_aza from public.bank_of_ethos where user_id = v_uid;
    return jsonb_build_object('ok', false, 'error', 'insufficient_or_missing',
                              'balance', coalesce(v_bal, 0), 'aza', coalesce(v_aza, 0));
  end if;

  return jsonb_build_object('ok', true, 'balance', v_bal, 'aza', v_aza);
end $$;

revoke all on function public.boe_adjust_balance(numeric, numeric) from public, anon;
grant execute on function public.boe_adjust_balance(numeric, numeric) to authenticated;


-- ─── VERIFY ── expect has_rpc 1
select count(*) as has_rpc
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'boe_adjust_balance';

-- Sanity check on your OWN account (safe: +0 / -0 writes nothing meaningful).
-- Expect ok:true and your real balance echoed back.
-- select public.boe_adjust_balance(0, 0);
