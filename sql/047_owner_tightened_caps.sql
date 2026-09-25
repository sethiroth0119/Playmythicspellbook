-- ═══════════════════════════════════════════════════════════════════════════
-- 047 · THE OWNER TIGHTENS BOTH CAPS, DELIBERATELY, BELOW MEASURED PLAY
--
-- Asked for: "Put the cap to 500,000 cinder and 500 aza."
--
-- 🔴 THIS IS A POLICY DECISION, NOT A MEASUREMENT, AND THAT IS THE WHOLE POINT
--    OF WRITING IT DOWN SEPARATELY FROM sql/046. Every number in 046 was sized
--    ABOVE observed play so nothing legitimate was refused. These two are set
--    BELOW it on purpose, with the cost known in advance and accepted:
--
--      wallet_credit daily ceiling  15,000,000 → 500,000
--        · 41 of 255 recorded player-days (16.1%) exceeded 500,000
--        · 10 of 39 active players had at least one such day
--        · the busiest real day was 10,867,754, so heavy players WILL hit this
--
--      aza_config.max_aza_per_day        1,000 → 500
--
-- ⚠ AND A CORRECTION THAT MATTERS MORE THAN THE NUMBER. I told the owner this
--   Aza cap was "the real-money exit". IT IS NOT. aza_to_cinder_exchange SPENDS
--   sovereigns and MINTS Cinder — it is an ENTRY, the paid one, and halving it
--   restricts what paying players can convert rather than what anyone can
--   extract. It is still a Cinder faucet and tightening it still reduces
--   inflation, which is why it stands; but it was asked for on my wrong
--   description and the record should not repeat the mistake.
--   Separately: CASHOUT_PAYOUTS_ENABLED is not set on the Worker, so the real
--   payout rail is OFF and there is no live money exit at all today.
--
-- ⚠ THE DAILY CEILING NOW BINDS BEFORE THE OTHER TWO. c_max_single (2,000,000)
--   and c_max_hour (10,000,000) are both above it, so any credit over 500,000
--   is refused by the DAY test and logged as 'REFUSED daily>'. That is accurate
--   — the day total would indeed be exceeded — but anyone reading a refusal log
--   should know the single/hour limits are no longer the ones doing the work.
--   They are left in place so raising the daily later restores a sane ladder.
--
-- ROLLBACK: set c_max_day back to 15000000 (sql/046's measured value) and
--           update aza_config set max_aza_per_day = 1000 where id = 1;
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.wallet_credit(p_amount bigint, p_reason text default 'reward', p_ref text default null)
returns bigint language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid uuid := auth.uid();
  v_bal bigint;
  v_hour bigint;
  v_day bigint;
  c_max_single constant bigint := 2000000;
  c_max_hour   constant bigint := 10000000;
  -- 🔴 OWNER-SET, AND BELOW MEASURED PLAY ON PURPOSE. See the header: 16% of
  --    recorded player-days exceeded this. It is not a bug report when a heavy
  --    player is refused — it is this line.
  c_max_day    constant bigint := 500000;
begin
  if v_uid is null or p_amount is null or p_amount <= 0 then return 0; end if;

  select coalesce(cinder,0) into v_bal from public.user_progress where user_id = v_uid;

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

  select coalesce(sum(delta),0) into v_day
    from public.wallet_ledger
   where user_id = v_uid and resource='cinder' and op='credit'
     and created_at > now() - interval '24 hours';

  if v_day + p_amount > c_max_day then
    begin
      insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason)
      values (v_uid, 'refused', 'cinder', 0, coalesce(v_bal,0),
              'REFUSED daily>' || c_max_day || ' used=' || v_day || ' asked=' || p_amount || ' as=' || coalesce(p_reason,''));
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
    when unique_violation then null;
    when undefined_table or undefined_column then null;
  end;

  return coalesce(v_bal, 0::bigint);
end$function$;

-- ── the paid Cinder entry, halved ─────────────────────────────────────────
update public.aza_config set max_aza_per_day = 500, updated_at = now() where id = 1;
