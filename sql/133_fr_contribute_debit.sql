-- 133_fr_contribute_debit.sql — bug-mu83ph17, Foundation donations took nothing.
--
-- ⚠ ALREADY APPLIED to ktsiasyjusesawtrwrjc on 2026-09-23 via the Supabase MCP,
--   as migration `fr_contribute_debits_the_donor_vault`. This file is the repo's
--   record of it and is idempotent, so re-running it is harmless.
--
-- THE BUG. _fr_contribute_core validated the donation, wrote the nonce log,
-- upserted reserve_contributions and PAID CINDER through _ct_cinder_give — and
-- never touched user_resources. Not one line of it debited the donor. So a
-- donation cost nothing: donate, keep the stock, take the reward, repeat, up to
-- the daily reserve cap. The reporter caught the other half of it too — you
-- could never empty a personal vault, because the resources came straight back.
--
-- THE FIX. Two additions around the existing idempotency guard:
--   1. a cheap pre-check BEFORE the nonce row is written, so a donor who is
--      short gets a clean 'insufficient_resources' answer instead of an
--      exception. The `for update` on cinder_reward_days taken just above
--      serialises this user, so their own stock cannot move underneath it.
--   2. the authoritative debit AFTER the nonce insert succeeds, making that log
--      row the mutual-exclusion token. It RAISES rather than returns on
--      failure: a return would COMMIT a logged, Cinder-paid contribution with
--      nothing taken for it, which is precisely the bug.
--
-- _wh_debit_resources is reused rather than reimplemented — it locks every line
-- in deterministic order, verifies ALL lines before applying ANY, and returns
-- false on insufficient stock. Its id pattern is a superset of the one
-- _fr_contribute_core already enforces, so every id that reaches it is legal.
--
-- 🔴 THIS DOES NOT CLOSE THE HOLE BY ITSELF, AND MUST NOT BE READ AS IF IT DID.
--    wh_resync_resources ratchets a player's vault UP to a client-declared
--    quantity — `least(100000, greatest(v_have, v_claim))`, raising only, never
--    lowering — and logs itself as "resynced from the client profile
--    (SELF-DECLARED)". A client can therefore restore anything this debits, and
--    the same is true of every other server-side debit in the game. At the time
--    of writing that path had granted 623,258 units across 13 players and was
--    still firing (60 events in the preceding 7 days). Closing it is a policy
--    decision for the owner, not a bug fix, because it exists to seed vaults
--    from client saves and tightening it can strand real holdings.
--
-- One accepted consequence: reserve-eligible CUSTOM resources (those declared
-- in card_catalog.__custom_resources__ rather than reserve_resources) have no
-- user_resources rows, so donating them now returns 'insufficient_resources'
-- instead of paying out for free. That is the correct behaviour of the two.

create or replace function public._fr_contribute_core(p_uid uuid, p_source text, p_res_id text, p_qty integer, p_client_nonce text, p_specialty text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  cfg      public.reserve_config%rowtype;
  lg       public.reserve_contribution_log%rowtype;
  ev       public.reserve_events%rowtype;
  v_nonce  text := btrim(coalesce(p_client_nonce, ''));
  v_res    text := btrim(coalesce(p_res_id, ''));
  v_weight numeric;
  v_spec_ok boolean := false;
  v_em     boolean;
  v_sp     boolean;
  v_mul    numeric;
  v_points bigint;
  v_want   bigint;
  v_cap    bigint;
  v_day    date := (now() at time zone 'utc')::date;
  v_from   timestamptz;
  v_used   bigint;
  v_pay    bigint;
  v_id     bigint;
  v_give   jsonb;
  v_name   text;
  v_rq     numeric;
  v_rp     numeric;
  v_bal    bigint;
  v_seq    bigint;
  v_have   bigint;
begin
  if p_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  if p_source not in ('deposit', 'convoy') then return jsonb_build_object('ok', false, 'error', 'bad_source'); end if;
  if length(v_nonce) < 8 or length(v_nonce) > 100 then return jsonb_build_object('ok', false, 'error', 'bad_nonce'); end if;
  select * into cfg from public.reserve_config where id = 1;
  if cfg.id is null or not cfg.enabled then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  if p_qty is null or p_qty <= 0 then return jsonb_build_object('ok', false, 'error', 'bad_qty'); end if;
  if p_qty > cfg.max_qty_per_call then
    return jsonb_build_object('ok', false, 'error', 'too_many', 'max', cfg.max_qty_per_call);
  end if;
  if v_res !~ '^[A-Za-z][A-Za-z0-9_]{0,63}$' then return jsonb_build_object('ok', false, 'error', 'unknown_resource'); end if;

  select * into lg from public.reserve_contribution_log where user_id = p_uid and nonce = v_nonce;
  if lg.id is not null then return public._fr_replay(lg, v_res, p_qty, p_source); end if;

  select weight, specialty_ok into v_weight, v_spec_ok from public.reserve_resources where res_id = v_res and enabled;
  if v_weight is null then
    if exists (select 1 from public.card_catalog c
                 cross join lateral jsonb_array_elements(case when jsonb_typeof(c.moves -> '__custom_resources__') = 'array'
                                                              then c.moves -> '__custom_resources__' else '[]'::jsonb end) e
                where c.id = 'singleton' and e ->> 'id' = v_res) then
      v_weight := cfg.weight_default; v_spec_ok := false;
    else
      return jsonb_build_object('ok', false, 'error', 'unknown_resource');
    end if;
  end if;

  insert into public.cinder_reward_days (user_id, bucket, day) values (p_uid, 'reserve', v_day)
  on conflict (user_id, bucket, day) do nothing;
  perform 1 from public.cinder_reward_days where user_id = p_uid and bucket = 'reserve' and day = v_day for update;
  select * into lg from public.reserve_contribution_log where user_id = p_uid and nonce = v_nonce;
  if lg.id is not null then return public._fr_replay(lg, v_res, p_qty, p_source); end if;

  -- 🔴 CAN THE DONOR AFFORD THIS? Friendly answer first; the row lock above
  -- serialises this user, so their own stock cannot move before the debit.
  select coalesce(qty, 0) into v_have from public.user_resources
   where user_id = p_uid and resource_id = v_res;
  if coalesce(v_have, 0) < p_qty then
    return jsonb_build_object('ok', false, 'error', 'insufficient_resources',
                              'resource', v_res, 'have', coalesce(v_have, 0), 'need', p_qty);
  end if;

  ev := public._fr_active_event(now());
  v_em := coalesce(ev.ord is not null and not ev.relief and v_res = any(ev.res), false);
  v_sp := coalesce(v_spec_ok, false) and p_specialty is not null and btrim(p_specialty) = v_res;
  v_mul := least(cfg.mul_cap, (case when v_em then cfg.emergency_mul else 1 end) * (case when v_sp then cfg.specialty_mul else 1 end));
  if p_source = 'convoy' then v_mul := v_mul * cfg.convoy_mul; end if;
  v_points := round(p_qty * v_weight * v_mul)::bigint;
  v_want := greatest(cfg.min_reward, round(v_points * cfg.cinder_per_point))::bigint;

  select daily_cinder into v_cap from public.cinder_reward_caps where bucket = 'reserve';
  v_from := v_day::timestamp at time zone 'utc';
  select coalesce(sum(cinder_paid), 0) into v_used from public.reserve_contribution_log
   where user_id = p_uid and created_at >= v_from and created_at < v_from + interval '1 day';
  v_pay := least(v_want, greatest(0, coalesce(v_cap, 0) - v_used));

  insert into public.reserve_contribution_log (user_id, nonce, source, resource, qty, weight, mul, points,
                                               cinder_want, cinder_paid, emergency, specialty, event_id)
  values (p_uid, v_nonce, p_source, v_res, p_qty, v_weight, v_mul, v_points, v_want, v_pay, v_em, v_sp, ev.id)
  on conflict (user_id, nonce) do nothing returning id into v_id;
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'nonce_conflict');
  end if;

  -- 🔴 THE DEBIT. The line whose absence was the bug. After the nonce insert so
  -- that row is the token; RAISES rather than returns so a failure cannot
  -- commit a paid contribution with nothing taken for it.
  if not public._wh_debit_resources(p_uid, jsonb_build_object(v_res, p_qty)) then
    raise exception '_fr_contribute_core: vault debit failed for % (% x %)', p_uid, p_qty, v_res;
  end if;

  select left(coalesce(nullif(btrim(display_name), ''), 'Survivor'), 40) into v_name
    from public.user_profiles where user_id = p_uid;
  insert into public.reserve_contributions as rc (user_id, user_name, resource, qty, points, updated_at)
  values (p_uid, coalesce(v_name, 'Survivor'), v_res, p_qty, v_points, now())
  on conflict (user_id, resource) do update
     set qty = rc.qty + excluded.qty,
         points = rc.points + excluded.points,
         user_name = coalesce(v_name, rc.user_name),
         updated_at = now()
  returning rc.qty, rc.points into v_rq, v_rp;

  if v_pay > 0 then
    v_give := public._ct_cinder_give(p_uid, v_pay,
                'Foundation Reserve ' || case when p_source = 'convoy' then 'convoy' else 'contribution' end
                || ': ' || p_qty || ' ' || v_res);
    if v_give is null or coalesce((v_give ->> 'moved')::bigint, 0) <> v_pay then
      raise exception '_fr_contribute_core: credit failed for % (%)', p_uid, v_nonce;
    end if;
  end if;
  select g.cinder, g.wallet_seq into v_bal, v_seq from public.user_progress g where g.user_id = p_uid;
  return jsonb_build_object('ok', true, 'already', false, 'source', p_source, 'resource', v_res, 'qty', p_qty,
                            'points', v_points, 'credited', v_pay, 'wanted', v_want, 'clamped', v_pay < v_want,
                            'cap', coalesce(v_cap, 0), 'used_today', v_used + v_pay,
                            'emergency', v_em, 'specialty', v_sp, 'event', ev.id,
                            'cinder', coalesce(v_bal, 0), 'wallet_seq', coalesce(v_seq, 0),
                            'reserve', jsonb_build_object('resource', v_res, 'qty', v_rq, 'points', v_rp));
end $function$;

-- verify
select 'debit present'    as check, pg_get_functiondef(oid) ilike '%_wh_debit_resources%'  as ok from pg_proc where oid = 'public._fr_contribute_core(uuid,text,text,integer,text,text)'::regprocedure;
select 'precheck present' as check, pg_get_functiondef(oid) ilike '%insufficient_resources%' as ok from pg_proc where oid = 'public._fr_contribute_core(uuid,text,text,integer,text,text)'::regprocedure;
