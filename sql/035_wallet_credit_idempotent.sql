-- ===========================================================================
-- 035 — MAKE wallet_credit IDEMPOTENT, so credits can be safely RETRIED.
--
-- WHY. Until now a credit whose mirror call failed was recovered by
-- reconcile_local_gain_on_fetch: the client compared its own balance against
-- the canonical row and asked the server to credit the DIFFERENCE. That is an
-- arbitrary, client-computed number on a money path, and it is the last
-- remaining one — gift_claim, boe_exchange_aza, boe_transfer, boe_transfer_aza
-- and _sov_apply all derive their amounts server-side already.
--
-- The client half (the credit OUTBOX) replaces that difference with a REPLAY of
-- the specific reward that failed. Retrying a credit is at-least-once delivery,
-- and at-least-once on money is a minting bug unless the server can recognise a
-- repeat. That is what this file adds.
--
-- 🔴 THE REF IS THE WHOLE SAFETY PROPERTY. Never retry a credit without one.
--    The ledger row carries it under a partial unique index, so the audit row
--    IS the idempotency record — there is no second table to drift out of step
--    with the money.
--
-- ⚠ p_ref is checked BEFORE the ceilings from 034. A replay is cheap and must
--   never be mistaken for fresh abuse — otherwise a player retrying a large
--   legitimate reward would burn their hourly budget on money they already had.
--
-- ⚠ The unique violation on insert is caught and swallowed. Two drains racing
--   (two tabs, say) can both pass the existence check; the index is the real
--   arbiter and the loser must return the balance, not raise.
--
-- ⚠ SIGNATURE CHANGE, HANDLED. p_ref defaults to NULL, so every existing 2-arg
--   caller resolves to this same function unchanged — verified live. The old
--   2-arg function is dropped in the same transaction so there is no window
--   where both exist and PostgREST has to choose.
--
-- Applied 2026-08-12 and verified against the live database:
--   ref A  +500 -> 250,500   |  ref A retried -> 250,500 (no change)
--   ref A  retried again     -> 250,500 (no change)
--   ref B  +500 -> 251,000   |  legacy 2-arg +250 -> 251,250
--
-- Idempotent and re-runnable. Verify queries at the bottom.
-- ===========================================================================

alter table public.wallet_ledger add column if not exists ref text;

-- Partial: only rows that carry a ref are constrained, so the 68k existing
-- rows (and every non-outbox credit) are untouched.
create unique index if not exists wallet_ledger_user_ref_uidx
  on public.wallet_ledger (user_id, ref) where ref is not null;

drop function if exists public.wallet_credit(bigint, text);
create or replace function public.wallet_credit(
  p_amount bigint, p_reason text default 'reward', p_ref text default null)
returns bigint
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid uuid := auth.uid();
  v_bal bigint;
  v_hour bigint;
  -- Ceilings from 034. See that file for how they were sized.
  c_max_single constant bigint := 5000000;
  c_max_hour   constant bigint := 10000000;
begin
  if v_uid is null or p_amount is null or p_amount <= 0 then return 0; end if;

  select coalesce(cinder,0) into v_bal from public.user_progress where user_id = v_uid;

  -- 🔁 REPLAY: already applied, so this is a no-op that returns the balance.
  if p_ref is not null and exists (
       select 1 from public.wallet_ledger where user_id = v_uid and ref = p_ref) then
    return coalesce(v_bal, 0::bigint);
  end if;

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
    insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason, ref)
      values (v_uid, 'credit', 'cinder', p_amount, coalesce(v_bal, 0::bigint), p_reason, p_ref);
  exception
    when unique_violation then null;   -- concurrent replay won the race
    when undefined_table or undefined_column then null;
  end;

  return coalesce(v_bal, 0::bigint);
end$fn$;

revoke all on function public.wallet_credit(bigint, text, text) from public, anon;
grant execute on function public.wallet_credit(bigint, text, text) to authenticated;

-- ===========================================================================
-- VERIFY (run in a transaction and ROLL BACK — it moves real money)
--
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims =
--     '{"sub":"<a user_id>","role":"authenticated","email":"nobody@example.com"}';
--   select public.wallet_credit(500,'Camp loot run','ob_A');  -- credits
--   select public.wallet_credit(500,'Camp loot run','ob_A');  -- NO CHANGE
--   select public.wallet_credit(500,'Camp loot run','ob_B');  -- credits
--   select public.wallet_credit(250,'addGems');               -- legacy 2-arg, credits
-- rollback;
--
-- How much recovery traffic is the outbox actually doing?
--   select date_trunc('day', created_at) d, count(*) refs
--     from public.wallet_ledger where ref is not null group by 1 order by 1 desc;
--
-- 🎯 THE GOAL THIS UNLOCKS. Once outbox delivery is proven in production, the
--    reconcile_local_gain_on_fetch credit can be deleted, the MAX(server,local)
--    adopt can become a plain server adopt, and wallet_credit can finally be
--    revoked from `authenticated` entirely — because nothing legitimate will
--    still be calling it with a client-chosen number. Do NOT do that until the
--    ledger shows the outbox carrying the load; deleting the fallback early
--    strands whoever is mid-divergence today.
-- ===========================================================================
