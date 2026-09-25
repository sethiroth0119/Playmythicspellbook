-- ═══════════════════════════════════════════════════════════════════════════
-- 048 · THE RE-ROLL COMPENSATION IS NOT SUBJECT TO THE ANTI-ABUSE CAP
--
-- 🔴 THE BUG THIS FIXES WAS CREATED BY sql/047, ONE MIGRATION EARLIER, and it
--    would have been invisible. 047 set the rolling daily credit ceiling to
--    500,000. claim_ground_reroll_grant() paid its 100,000 THROUGH
--    wallet_credit, so it inherited that ceiling — and a player who had already
--    earned 450,000 that day simply did not receive it. Driven before writing
--    this: 450,000 of ordinary play, then a claim, and the grant wrote no
--    ledger row at all.
--
--    It was retryable (no ref row means the claim is still owed), so nobody
--    would have lost the money permanently — but the client asks once a
--    session, so an active player could be refused it session after session
--    while the toast never appeared. A compensation the owner ordered, silently
--    not arriving for exactly the busiest players, is the worst shape of bug:
--    no error, no log, and the people most affected by the ground re-roll are
--    the ones most likely to be near the cap.
--
-- ⭐ SO IT CREDITS DIRECTLY, AND THAT IS NOT A HOLE. The daily ceiling exists to
--    bound credits whose AMOUNT COMES FROM THE CLIENT and which can be repeated.
--    This is neither: the figure is a constant in this function body, and the
--    unique index on (user_id, ref) means it can be paid exactly once per
--    account, ever. There is nothing here for a caller to inflate or repeat, so
--    there is nothing for the cap to protect against.
--
-- ⚠ IT STILL WRITES THE LEDGER ROW, and it must: that row IS the idempotency
--   record, the audit trail, and the receipt. Crediting without it would make
--   the payment invisible and repeatable in the same stroke.
-- ⚠ AND IT STILL COUNTS TOWARD LATER CAPS. The row is an ordinary 'credit', so
--   the 100,000 does consume part of that day's allowance for anything credited
--   AFTER it. That is deliberate — the grant should not be a free extra
--   allowance, only a payment the allowance cannot block.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.claim_ground_reroll_grant()
returns json language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_uid uuid := auth.uid();
  v_ref constant text := 'ground-reroll-v1';
  v_amt constant bigint := 100000;
  v_bal bigint;
begin
  if v_uid is null then return json_build_object('ok', false, 'why', 'not signed in'); end if;

  -- Paid already? The ledger row is the record, and the unique index on
  -- (user_id, ref) is what makes this safe against two tabs racing.
  if exists (select 1 from public.wallet_ledger where user_id = v_uid and ref = v_ref) then
    select coalesce(cinder,0) into v_bal from public.user_progress where user_id = v_uid;
    return json_build_object('ok', true, 'already', true, 'amount', 0, 'balance', coalesce(v_bal,0));
  end if;

  insert into public.user_progress (user_id) values (v_uid) on conflict (user_id) do nothing;
  update public.user_progress
     set cinder = coalesce(cinder, 0) + v_amt, updated_at = now()
   where user_id = v_uid
   returning cinder into v_bal;

  -- the mirror user_profiles.gems, kept in step exactly as wallet_credit does
  update public.user_profiles set gems = v_bal
   where user_id = v_uid and coalesce(gems, 0) < v_bal;

  /* 🔴 THE LEDGER ROW IS WRITTEN LAST AND ITS FAILURE IS NOT SWALLOWED. If two
     tabs claim at once the unique index rejects the second, and that second
     call has ALREADY added 100,000 above — so it must give the money back
     rather than report a payment the ledger will not remember. Raising rolls
     the whole function back, which is the only correct answer here. */
  insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason, ref)
    values (v_uid, 'credit', 'cinder', v_amt, coalesce(v_bal, 0::bigint),
            'Ground re-roll compensation — rebuild what the shift cost you', v_ref);

  return json_build_object('ok', true, 'already', false, 'amount', v_amt, 'balance', coalesce(v_bal,0));
exception
  when unique_violation then
    -- the racing tab won; report it as already paid rather than as an error
    select coalesce(cinder,0) into v_bal from public.user_progress where user_id = v_uid;
    return json_build_object('ok', true, 'already', true, 'amount', 0, 'balance', coalesce(v_bal,0));
end; $fn$;

revoke all on function public.claim_ground_reroll_grant() from public, anon;
grant execute on function public.claim_ground_reroll_grant() to authenticated;

-- ROLLBACK: re-apply sql/045's body, which paid through wallet_credit.
