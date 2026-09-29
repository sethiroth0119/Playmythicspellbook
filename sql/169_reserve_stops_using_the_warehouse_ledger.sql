-- ═══════════════════════════════════════════════════════════════════════════
-- 169 — THE FOUNDATION RESERVE STOPS BEING GATED ON THE WAREHOUSE LEDGER.
-- ═══════════════════════════════════════════════════════════════════════════
-- Reports bug-muesa4ot ("Contribution Refused. Insufficient resources … it will
-- allow me to contribute 1 at a time down to a certain point … not on every
-- item but most of them") and bug-mufleldg ("Not able to contribute to
-- Foundation Reserve"), and the owner again on 2026-09-26 with a screenshot:
-- 204 Aluminium Ore held, 204 offered, REFUSED.
--
-- 🔴 THE RESERVE WAS ASKING A LEDGER THAT CANNOT KNOW THE ANSWER.
--   The deployed _fr_contribute_core checked, and then debited, through
--   public.user_resources — the WAREHOUSE's ledger — via _wh_debit_resources.
--   That ledger is not the player's vault. The vault is
--   user_profiles.forge.__salvage__, which the client owns and writes whole.
--
--   The warehouse ledger is FILLED ONCE AND NEVER RAISED, deliberately.
--   wh_resync_resources says so in its own body:
--       "A row that already exists is the server's own number and is left
--        exactly alone — this is what stops a client undoing a debit.
--        Only a genuinely absent row is filled."
--   and wh_seed_resources inserts a row for every weighted resource INCLUDING
--   THE ZEROS. So the first seed plants a 0 for a resource the player did not
--   hold yet, and from that moment the ledger can never learn that they now
--   hold 204 of it. Nothing on the client can repair it; that is the point of
--   the rule, and the rule is right for the warehouse.
--
--   MEASURED 2026-09-26, against every player's vault:
--     vault entries with NO ledger row (fillable by a seed) ....... 1,397
--     ledger rows STUCK AT ZERO (resync skips them for ever) .......... 67  (8 players)
--     ledger rows SHORT of the vault (refused above that figure) ..... 315
--     ledger rows that happen to be adequate ........................ 795
--   ~382 resource/player combinations were therefore refused with no client-
--   side cure. The v121v189 client fix — seeding the ledger before contributing
--   — filled the 1,397 missing rows (the ledger grew 13 → 14 players) and could
--   not, by design, touch the other 382.
--
--   And it can only get worse: goods are earned in the city, the camp and in
--   battle, none of which touch the warehouse. A first-seed-only ledger can
--   never track a vault that grows elsewhere.
--
-- WHAT THIS DOES: removes the affordability CHECK and the server-side DEBIT
-- from _fr_contribute_core, restoring the contract sql/164 states at length —
-- the client owns the vault, debits it, SAVES the debit, and only then calls;
-- the server records the contribution and pays the Cinder.
--
-- ⚠ THE DUPLICATE-DONATION BUG STAYS FIXED, and not by this function. What
--   actually fixed it (v121v184) is the client ORDER: spendResources, then
--   cloudSyncProfile — the debit is on the server's copy of the profile before
--   the RPC is called — and a save that fails undoes the debit and sends
--   nothing. sql/162 added forge.__vaultSpend__ so the anti-wipe guard lets a
--   real vault spend through. The server-side debit added later was
--   belt-and-braces on top of that, and it is the braces that were strangling
--   the player.
-- ⚠ WHAT IS STILL BOUNDED: reserve_config.max_qty_per_call caps a single call,
--   the nonce makes a replay idempotent (_fr_replay), and the per-day Cinder
--   ceiling in cinder_reward_caps['reserve'] caps what a contribution can PAY.
--   Those are the bounds sql/164 chose deliberately, and they are untouched.
-- ⚠ EVERYTHING ELSE IN THIS FUNCTION IS BYTE-FOR-BYTE THE DEPLOYED BODY: the
--   nonce/replay handling, the resource resolution including Forge-authored
--   ids, the reward-day lock, the event and specialty multipliers, the daily
--   clamp, reserve_contribution_log, reserve_contributions and the
--   _ct_cinder_give credit. Two blocks are gone and the now-unused v_have
--   declaration with them; nothing else moved.
-- ⚠ THE WAREHOUSE IS NOT TOUCHED. _wh_debit_resources, wh_seed_resources and
--   wh_resync_resources keep their rules exactly as they are — this only stops
--   the RESERVE asking them a question they were never built to answer.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

CREATE OR REPLACE FUNCTION public._fr_contribute_core(p_uid uuid, p_source text, p_res_id text, p_qty integer, p_client_nonce text, p_specialty text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  /* 🔴 sql/169 — NO AFFORDABILITY CHECK AND NO SERVER DEBIT HERE.
     Both used to read and write public.user_resources, the WAREHOUSE's ledger,
     which is filled once and never raised (wh_resync_resources: "a row that
     already exists is the server's own number and is left exactly alone"). It
     therefore cannot know what is in a vault that grows in the city, the camp
     and in battle, and it refused 382 measured resource/player combinations
     that no client fix could reach. The vault is the client's
     (forge.__salvage__): it debits, SAVES the debit, and only then calls this —
     the v121v184 ordering that actually fixed the duplicate donations. What
     still bounds this call is max_qty_per_call above, the nonce replay just
     handled, and the daily Cinder ceiling below. */

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

commit;

-- ── VERIFY ────────────────────────────────────────────────────────────────
-- Every line must read true.
select
  (select position('user_resources' in pg_get_functiondef(p.oid)) = 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='_fr_contribute_core')            as no_warehouse_ledger_read,
  (select position('_wh_debit_resources' in pg_get_functiondef(p.oid)) = 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='_fr_contribute_core')            as no_server_side_debit,
  (select position('insufficient_resources' in pg_get_functiondef(p.oid)) = 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='_fr_contribute_core')            as refusal_code_gone,
  -- …and the parts that must still be there
  (select position('max_qty_per_call' in pg_get_functiondef(p.oid)) > 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='_fr_contribute_core')            as per_call_cap_kept,
  (select position('_fr_replay' in pg_get_functiondef(p.oid)) > 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='_fr_contribute_core')            as nonce_replay_kept,
  (select position('cinder_reward_caps' in pg_get_functiondef(p.oid)) > 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='_fr_contribute_core')            as daily_cinder_cap_kept,
  (select position('_ct_cinder_give' in pg_get_functiondef(p.oid)) > 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='_fr_contribute_core')            as credit_kept,
  -- the warehouse's own rules are untouched
  (select position('is left exactly alone' in pg_get_functiondef(p.oid)) > 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='wh_resync_resources')            as warehouse_rule_untouched;
