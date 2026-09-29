-- ===========================================================================
-- 034 — BOUND wallet_credit. A guardrail, NOT the full fix.
--
-- THE PROBLEM. wallet_credit(p_amount, p_reason) is SECURITY DEFINER and
-- granted to `authenticated`. It accepted ANY positive amount, from any signed-
-- in caller, with ANY reason. Combined with the MAX(server, local) adopt in
-- cloudFetchProfile, a client that inflated its local balance had the server
-- adopt it and then credit the difference as reconcile_local_gain_on_fetch.
--
-- 🔴 p_reason CARRIES NO AUTHORITY. It is a client-supplied string. Per-reason
--    ceilings are therefore worthless against an attacker — anyone who can pass
--    1e12 can equally pass 'Bank of Ethos withdraw'. Only the AMOUNT can be
--    bounded, so that is what this file bounds. Verified: a forged
--    'Bank of Ethos withdraw' for 81,000,000 is refused.
--
-- WHY THESE NUMBERS. Measured against the live ledger rather than guessed:
--     Gift claim: Cinder             max 1,000,000   (admin grant, 9 rows)
--     addGems                        max   250,000   MEDIAN 2, over 65k rows
--     reconcile_local_gain_on_fetch  max   221,066   median 73
--   c_max_single = 5,000,000 is FIVE TIMES the largest credit ever seen here.
--   c_max_hour   = 10,000,000 clears roughly ten admin gift claims in an hour.
--
-- ⚠ BANK WITHDRAWALS ARE NOT AFFECTED, and this is the fact that makes a low
--   ceiling safe. They reach 81,000,000 — sixteen times the ceiling — but
--   boe_transfer (sql/023) writes user_progress AND the wallet_ledger row
--   ITSELF and never calls this function. Its amount is validated against the
--   real bank balance inside the same transaction, so it is already
--   server-authorised.
--
--   An earlier reading of this same data concluded the opposite. boe_transfer
--   also writes op='credit' rows, and its reason is built at RUNTIME
--   ('Bank of Ethos ' || p_dir) — so grepping the function bodies for the
--   literal string found nothing, and it looked like an unattributed caller
--   sitting on a money path. Chasing that down BEFORE changing anything is what
--   turned an unsafe ceiling into a safe one.
--
-- ⚠ REFUSALS ARE RECORDED, NEVER SILENT. A breach writes an op='refused' row
--   carrying the amount asked for and the reason claimed. A silent refusal
--   would make abuse invisible, which is the state this whole line of work
--   exists to end.
--
-- Signature and return type unchanged: no client edit required, and a refusal
-- returns the CURRENT balance exactly as a no-op credit always did.
--
-- 🔴 THIS IS NOT THE REAL FIX. The real fix is per-faucet RPCs where the SERVER
--    computes the amount from state it owns, after which wallet_credit can be
--    revoked from `authenticated` entirely. This only bounds the blast radius
--    in the meantime: a cheater is capped at 10,000,000/hour instead of
--    unlimited, and every attempt is on the record. Do not mistake it for
--    closure.
--
-- Idempotent (create or replace). Verify queries at the bottom.
-- ===========================================================================

create or replace function public.wallet_credit(p_amount bigint, p_reason text default 'reward')
returns bigint
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid uuid := auth.uid();
  v_bal bigint;
  v_hour bigint;
  c_max_single constant bigint := 5000000;
  c_max_hour   constant bigint := 10000000;
begin
  if v_uid is null or p_amount is null or p_amount <= 0 then return 0; end if;

  select coalesce(cinder,0) into v_bal from public.user_progress where user_id = v_uid;

  if p_amount > c_max_single then
    begin
      insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason)
      values (v_uid, 'refused', 'cinder', 0, coalesce(v_bal,0),
              'REFUSED single>' || c_max_single || ' asked=' || p_amount || ' as=' || coalesce(p_reason,''));
    exception when undefined_table or undefined_column then null; end;
    return coalesce(v_bal, 0::bigint);
  end if;

  select coalesce(sum(delta),0) into v_hour
    from public.wallet_ledger
   where user_id = v_uid and resource='cinder' and op='credit'
     and created_at > now() - interval '1 hour';

  if v_hour + p_amount > c_max_hour then
    begin
      insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason)
      values (v_uid, 'refused', 'cinder', 0, coalesce(v_bal,0),
              'REFUSED hourly>' || c_max_hour || ' used=' || v_hour || ' asked=' || p_amount || ' as=' || coalesce(p_reason,''));
    exception when undefined_table or undefined_column then null; end;
    return coalesce(v_bal, 0::bigint);
  end if;

  insert into public.user_progress (user_id) values (v_uid) on conflict (user_id) do nothing;
  update public.user_progress
     set cinder = coalesce(cinder, 0) + p_amount, updated_at = now()
   where user_id = v_uid
   returning cinder into v_bal;

  update public.user_profiles set gems = v_bal
   where user_id = v_uid and coalesce(gems, 0) < v_bal;

  begin
    insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason)
      values (v_uid, 'credit', 'cinder', p_amount, coalesce(v_bal, 0::bigint), p_reason);
  exception when undefined_table or undefined_column then null; end;

  return coalesce(v_bal, 0::bigint);
end$fn$;

revoke all on function public.wallet_credit(bigint, text) from public, anon;
grant execute on function public.wallet_credit(bigint, text) to authenticated;

-- ===========================================================================
-- VERIFY (run inside a transaction and ROLL BACK — it moves real money)
--
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims =
--     '{"sub":"<a user_id>","role":"authenticated","email":"nobody@example.com"}';
--   select public.wallet_credit(250, 'addGems');                      -- credits
--   select public.wallet_credit(1000000000000, 'addGems');            -- REFUSED
--   select public.wallet_credit(81000000, 'Bank of Ethos withdraw');  -- REFUSED
--   select op, reason from public.wallet_ledger
--    where user_id='<a user_id>' and op='refused' order by created_at desc;
-- rollback;
--
-- Applied 2026-08-12 and verified: balance 250,000 -> 250,250 on the legitimate
-- credit, then UNCHANGED through both refusals, with 2 op='refused' rows.
--
-- Watch for refusals in production — any row here is worth a look:
--   select left(user_id::text,8) usr, created_at, reason
--     from public.wallet_ledger where op='refused' order by created_at desc limit 50;
-- ===========================================================================
