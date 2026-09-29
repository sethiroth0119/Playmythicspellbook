-- ═══════════════════════════════════════════════════════════════════════════
-- 046 · TIGHTENING THE CLIENT CINDER FAUCET, AND REMOVING ONE ARGUMENT
--
-- Asked for: close the hole where wallet_credit is executable by
-- `authenticated` and takes the amount as an argument.
--
-- 🔴 WHAT I COULD NOT DO, STATED FIRST BECAUSE IT IS THE IMPORTANT PART.
--    This does NOT close it. wallet_credit has to stay reachable by the client:
--    three call sites depend on it, and every one of them exists because the
--    CLIENT is what knows how much a player earned. Revoking the grant and
--    putting a Worker in front would not add a barrier either — the player's
--    JWT reaches a Worker exactly as easily as it reaches the RPC, so that is
--    a policy chokepoint dressed as an authentication one, and the policy
--    belongs here where calling the RPC directly cannot bypass it.
--    The real fix is per-faucet RPCs that verify the earning server-side, which
--    sql/034 already names. This is harm reduction, measured.
--
-- 📏 EVERY NUMBER BELOW IS MEASURED, not chosen. Against wallet_ledger, with
--    the reasons that come from OTHER paths excluded (Bank of Ethos withdraw,
--    Gift claim, admin restores — none of those go through this function):
--      biggest single credit ............  1,552,600
--      99.9th percentile single .........    137,812
--      busiest hour, one player .........  9,859,847
--      busiest DAY, one player .......... 10,867,754
--      99th percentile day ..............  5,657,774
--
-- ⭐ SO: the single-call ceiling drops 5,000,000 → 2,000,000, which is still
--    ~1.3× the largest credit ever legitimately written, and a DAILY ceiling is
--    added where there was none at all. That last one is the real win: the
--    hourly cap alone permitted 240,000,000 a day, and 15,000,000 is above the
--    busiest real day ever recorded. Mint rate falls 16× with, on the evidence,
--    no legitimate credit refused.
--
-- ⚠ THE HOURLY CEILING IS NOT REDUCED, and that is deliberate rather than an
--   oversight: the busiest legitimate hour measured 9,859,847 against a
--   10,000,000 limit. There is no room there. Anyone reading this looking for
--   more safety should look at aza_config.max_aza_per_day — the real-money exit
--   is capped at 1,000 Aza/day (5,000,000 Cinder), and THAT is the number that
--   bounds what any of this can be turned into. It is a business decision and
--   is deliberately left alone here.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.wallet_credit(p_amount bigint, p_reason text default 'reward', p_ref text default null)
returns bigint language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid uuid := auth.uid();
  v_bal bigint;
  v_hour bigint;
  v_day bigint;
  c_max_single constant bigint := 2000000;    -- was 5,000,000; largest real credit 1,552,600
  c_max_hour   constant bigint := 10000000;   -- unchanged; busiest real hour 9,859,847
  c_max_day    constant bigint := 15000000;   -- NEW; busiest real day 10,867,754
begin
  if v_uid is null or p_amount is null or p_amount <= 0 then return 0; end if;

  select coalesce(cinder,0) into v_bal from public.user_progress where user_id = v_uid;

  -- 🔁 REPLAY. An outbox retry whose first attempt landed but whose RESPONSE
  --    was lost must not credit twice. Checked before the ceilings so a replay
  --    is cheap and can never be mistaken for fresh abuse.
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

  /* 🔴 THE DAY CEILING, WHICH DID NOT EXIST. An hourly cap alone is a daily cap
     of twenty-four times itself — 240,000,000 — and nothing was watching the
     total. Counted over a ROLLING 24 HOURS rather than a calendar day, because
     a calendar boundary is a free second helping at midnight. */
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

-- ── the reconcile stops taking an amount from anybody ─────────────────────
-- 🔴 THE ONE CALL SITE THAT COULD BE CLOSED PROPERLY, AND IS. The client used
--    to compute `gems - cinder` and pass the difference in. It does not need
--    to: BOTH numbers are server-side, and user_profiles.gems is not writable
--    by the player at all — sql/026 revoked the column privilege, so the only
--    things that move it are wallet_credit and wallet_charge. So the server can
--    work out the gap itself, and this function takes no arguments: there is
--    nothing for a caller to inflate.
-- ⚠ IT ONLY EVER CLOSES A GAP, NEVER OPENS ONE. gems <= cinder returns 0 and
--   writes nothing. Measured before shipping: of 121 profiles exactly ONE had
--   gems ahead of the wallet, by 315 Cinder — the drift this repairs is
--   effectively already gone, which is precisely why removing the argument
--   costs nothing.
create or replace function public.wallet_reconcile_self()
returns json language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_uid uuid := auth.uid();
  v_gems bigint;
  v_cin bigint;
  v_diff bigint;
  v_bal bigint;
begin
  if v_uid is null then return json_build_object('ok', false, 'why', 'not signed in'); end if;

  select coalesce(gems,0) into v_gems from public.user_profiles where user_id = v_uid;
  select coalesce(cinder,0) into v_cin from public.user_progress where user_id = v_uid;
  v_diff := coalesce(v_gems,0) - coalesce(v_cin,0);

  if v_diff <= 0 then
    return json_build_object('ok', true, 'moved', 0, 'balance', coalesce(v_cin,0));
  end if;

  -- Through the audited path, so the ceilings and the ledger row apply exactly
  -- as they do to every other credit. A reconcile is not a privileged mint.
  v_bal := public.wallet_credit(v_diff, 'reconcile_canonical_wallet', null);
  return json_build_object('ok', true, 'moved', v_diff, 'balance', coalesce(v_bal, v_cin));
end; $fn$;

revoke all on function public.wallet_reconcile_self() from public, anon;
grant execute on function public.wallet_reconcile_self() to authenticated;

-- ROLLBACK: re-apply sql/034's body to restore the 5,000,000 single ceiling and
-- drop the daily one; drop function public.wallet_reconcile_self().
