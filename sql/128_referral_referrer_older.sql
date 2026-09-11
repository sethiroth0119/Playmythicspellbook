-- 128_referral_referrer_older.sql — bug-mtrm50hn.
--
-- referral_redeem() re-issued from sql/058 with ONE new refusal, placed right
-- after the self-referral check: the account behind the code must be OLDER
-- than the account redeeming it. Everything else is verbatim 058 (the cycle
-- guard, the IP rules, the rewards). Idempotent; ends with a verify.

create or replace function public.referral_redeem(p_code text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_ref uuid; v_code text; v_name text; v_redeemer_name text; v_count int;
        v_ip text; v_ua text; v_ref_ip text; v_recent int; v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in'); end if;
  v_code := upper(trim(coalesce(p_code, '')));
  if v_code = '' then return jsonb_build_object('ok', false, 'error', 'bad_code'); end if;
  select user_id into v_ref from referral_codes where code = v_code;
  if v_ref is null then return jsonb_build_object('ok', false, 'error', 'bad_code'); end if;
  if v_ref = v_uid then return jsonb_build_object('ok', false, 'error', 'self_referral'); end if;

  /* bug-mtrm50hn: a player typed the code of somebody THEY had invited (who
     had signed up without the link) into their own redeem box. The row was
     accepted — it named the newer player as the inviter — and the primary key
     on redeemer_id then locked the box for good. An account cannot have been
     invited by one created after it, so refuse that, name it, and leave the
     one redemption unspent. */
  if (select u.created_at from auth.users u where u.id = v_ref) > (select u.created_at from auth.users u where u.id = v_uid) then
    return jsonb_build_object('ok', false, 'error', 'referrer_newer');
  end if;

  -- ── §1 of the brief: have I already been referred? Asked BEFORE the insert
  --    so the player gets a clear answer instead of a primary-key violation.
  if exists (select 1 from referral_redemptions where redeemer_id = v_uid) then
    return jsonb_build_object('ok', false, 'error', 'already_redeemed');
  end if;

  -- ── §4 and §5: is this code's owner already below me in the chain?
  --    One walk answers both the mutual case and the longer loop; they are
  --    separated here ONLY so the message can name what actually happened.
  if exists (select 1 from referral_redemptions
              where redeemer_id = v_ref and referrer_id = v_uid and status = 'accepted') then
    return jsonb_build_object('ok', false, 'error', 'mutual_referral');
  end if;
  if public._referral_would_cycle(v_uid, v_ref) then
    return jsonb_build_object('ok', false, 'error', 'referral_cycle');
  end if;

  v_ip := public._referral_client_ip();
  begin v_ua := left(coalesce((current_setting('request.headers', true))::jsonb->>'user-agent', ''), 300);
  exception when others then v_ua := ''; end;

  if v_ip <> '' then
    select ip into v_ref_ip from referral_codes where user_id = v_ref;
    if v_ref_ip is not null and v_ref_ip = v_ip then
      return jsonb_build_object('ok', false, 'error', 'same_ip');
    end if;
    if exists (select 1 from referral_redemptions where referrer_id = v_ref and ip = v_ip) then
      return jsonb_build_object('ok', false, 'error', 'same_ip');
    end if;
    select count(*) into v_recent from referral_redemptions
      where ip = v_ip and created_at > now() - interval '24 hours';
    if v_recent >= 3 then
      return jsonb_build_object('ok', false, 'error', 'ip_limit');
    end if;
  end if;

  /* ⚠ THE ROW IS WRITTEN BEFORE THE GIFTS, AND THAT ORDER IS THE REWARD
     GUARD. rewards_granted is set in the same statement, and the primary key
     on redeemer_id means a concurrent second call cannot get past this insert
     — so the payout below can run exactly once per relationship. Paying first
     and recording after is how a retry becomes a double payout.
     The trigger also runs here: if anything slipped past the checks above,
     this raises rather than paying. */
  begin
    insert into referral_redemptions
      (redeemer_id, referrer_id, code, ip, ua, status, rewards_granted, rewards_granted_at)
      values (v_uid, v_ref, v_code, nullif(v_ip, ''), nullif(v_ua, ''), 'accepted', true, now());
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'error', 'already_redeemed');
    when check_violation then
      -- The backstop fired. Report it as the loop it is rather than as a crash.
      return jsonb_build_object('ok', false, 'error', 'referral_cycle');
  end;

  select display_name into v_name from user_profiles where user_id = v_ref;
  select display_name into v_redeemer_name from user_profiles where user_id = v_uid;

  insert into gifts (to_user, card_id, card_name, qty, message, from_label, status)
  select side.uid, r.card_id, r.card_name, r.qty,
         case when side.uid = v_ref
              then 'Referral reward — ' || coalesce(v_redeemer_name, 'a new Survivor') || ' used your code!'
              else 'Referral welcome reward — thanks for joining, courtesy of ' || coalesce(v_name, 'your friend') || '!' end,
         'Referral', 'pending'
  from (values (v_ref), (v_uid)) as side(uid)
  cross join (values
    ('__cinder__', '5,000 Cinders <span class="cinder-icon"></span>', 5000::numeric),
    ('__aza__', '5 Aza coin 🪙', 5::numeric),
    ('__pack:cpack_1779940171219__', 'Birth of the Universe I Booster Pack', 1::numeric)
  ) as r(card_id, card_name, qty);

  select count(*) into v_count from referral_redemptions where referrer_id = v_ref;
  return jsonb_build_object('ok', true, 'referrer_name', coalesce(v_name, 'a Survivor'), 'referrer_total', v_count);
end $function$;

grant execute on function public.referral_redeem(text) to authenticated;

-- verify
select 'referrer_newer refusal installed' as check,
       pg_get_functiondef(p.oid) like '%referrer_newer%' as ok
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'referral_redeem';
