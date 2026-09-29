-- ===========================================================================
-- 037 — THE BANK OF ETHOS EXCHANGE COUNTER HAS NEVER WORKED. Fix it.
--
-- Reported as "The exchange did not go through — nothing moved" on the market
-- site. It is not intermittent: public.aza_exchanges has ZERO rows, so not one
-- Aza → Cinder exchange has ever completed.
--
-- THE BUG. aza_to_cinder_exchange reads
--     v_cfg.max_aza_per_tx
-- from a public.aza_config%rowtype. That column does not exist — the table has
-- `max_aza_per_day`. Referencing a missing field on a plpgsql record RAISES
-- (`record "v_cfg" has no field "max_aza_per_tx"`), it does not return null. So
-- every single call threw before touching a balance.
--
-- ⚠ WHY IT LOOKED LIKE A SILENT FAILURE RATHER THAN AN ERROR. The site's
--   readiness probe calls cinder_from_aza_total(), which is a different
--   function and succeeds regardless — so the counter renders OPEN. The throw
--   then arrives as a transport error, and the client's message chain has no
--   arm for it, so it fell through to the generic "nothing moved". Three
--   separate things had to line up to make a hard crash look like a no-op.
--   The client half of this is fixed alongside (every error code now has a
--   message, and an unknown one says so instead of pretending).
--
-- 🟢 NOTHING WAS EVER LOST. The throw happened BEFORE the sovereigns debit, and
--    plpgsql rolls the whole function back on an exception anyway. Players who
--    tried and saw the error kept their Aza. No restitution is needed — verify
--    with the query at the bottom.
--
-- WHAT max_aza_per_day SHOULD MEAN. The name says per DAY, and the original
-- used it as a per-transaction ceiling. Implemented as the daily cap it is
-- named for: today's exchanged total plus this request must fit inside it.
-- A single request larger than the whole day's allowance is refused
-- separately, because "split it into smaller exchanges" is useless advice when
-- the limit is a daily total.
--
-- min_aza was likewise ignored — the old check was `p_aza <= 0`. Honoured now.
--
-- Idempotent and re-runnable. Verify queries at the bottom.
-- ===========================================================================

create or replace function public.aza_to_cinder_exchange(p_aza integer)
returns jsonb
language plpgsql security definer set search_path = public as $function$
declare
  v_uid   uuid := auth.uid();
  v_cfg   public.aza_config%rowtype;
  v_mint  bigint;
  v_ok    boolean := false;
  v_sov   int;
  v_today bigint;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select * into v_cfg from public.aza_config where id = 1;
  if not found or not v_cfg.enabled then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;

  if p_aza is null or p_aza <= 0 or p_aza < coalesce(v_cfg.min_aza, 1) then
    return jsonb_build_object('ok', false, 'error', 'bad_amount',
                              'min_aza', coalesce(v_cfg.min_aza, 1));
  end if;

  -- 🔴 THE LINE THAT BROKE IT: this read v_cfg.max_aza_per_tx, which is not a
  --    column on aza_config. A missing record field raises, so every call died
  --    here. The real column is max_aza_per_day, and it is a DAILY total.
  if coalesce(v_cfg.max_aza_per_day, 0) > 0 then
    if p_aza > v_cfg.max_aza_per_day then
      -- Bigger than the entire day's allowance: splitting cannot help.
      return jsonb_build_object('ok', false, 'error', 'amount_too_large',
                                'max_aza_per_day', v_cfg.max_aza_per_day);
    end if;
    select coalesce(sum(aza_spent), 0) into v_today
      from public.aza_exchanges
     where user_id = v_uid and created_at >= date_trunc('day', now());
    if v_today + p_aza > v_cfg.max_aza_per_day then
      return jsonb_build_object('ok', false, 'error', 'daily_cap',
                                'max_aza_per_day', v_cfg.max_aza_per_day,
                                'used_today', v_today,
                                'remaining', greatest(0, v_cfg.max_aza_per_day - v_today));
    end if;
  end if;

  v_mint := (p_aza::bigint) * v_cfg.cinder_per_aza;

  -- Balance test lives IN the WHERE clause: this is the concurrency guard as
  -- well as the affordability check, so two calls cannot both overdraw.
  update public.user_profiles
     set sovereigns = sovereigns - p_aza
   where user_id = v_uid and coalesce(sovereigns, 0) >= p_aza
  returning true into v_ok;

  if not coalesce(v_ok, false) then
    select coalesce(sovereigns, 0) into v_sov from public.user_profiles where user_id = v_uid;
    return jsonb_build_object('ok', false, 'error', 'insufficient_aza',
                              'sovereigns', coalesce(v_sov, 0));
  end if;

  update public.user_profiles
     set gems = coalesce(gems, 0) + v_mint
   where user_id = v_uid;

  insert into public.aza_exchanges (user_id, aza_spent, cinder_minted, rate)
  values (v_uid, p_aza, v_mint, v_cfg.cinder_per_aza);

  return jsonb_build_object(
    'ok', true,
    'aza_spent', p_aza,
    'cinder_credited', v_mint,
    'rate', v_cfg.cinder_per_aza,
    'locked_cinder', public.cinder_from_aza_total(),
    'sovereigns', (select coalesce(sovereigns, 0) from public.user_profiles where user_id = v_uid),
    'balance', (select coalesce(gems, 0) from public.user_profiles where user_id = v_uid)
  );
end;
$function$;

revoke all on function public.aza_to_cinder_exchange(integer) from public, anon;
grant execute on function public.aza_to_cinder_exchange(integer) to authenticated;

-- ===========================================================================
-- VERIFY
--
-- 1) The old code path is gone — this must return 0:
--      select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--       where n.nspname='public' and p.proname='aza_to_cinder_exchange'
--         and pg_get_functiondef(p.oid) like '%max_aza_per_tx%';
--
-- 2) Nobody lost Aza to the broken version (the throw preceded the debit):
--      select count(*) as exchanges_ever from public.aza_exchanges;
--      -- was 0 before this fix; anything here now is a real, completed exchange.
--
-- 3) Live round trip (ROLL BACK — it moves real balances):
--      begin;
--        select set_config('request.jwt.claims',
--          '{"sub":"<a user with Aza>","role":"authenticated","email":"x@y.z"}', true);
--        set local role authenticated;
--        select public.aza_to_cinder_exchange(11);
--      rollback;
--
-- 4) Daily cap behaviour:
--      select user_id, sum(aza_spent) as used_today
--        from public.aza_exchanges where created_at >= date_trunc('day', now())
--       group by 1;
-- ===========================================================================
