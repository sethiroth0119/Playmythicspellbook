-- ===========================================================================
-- 156 — HELD CINDER IS RELEASED IN ONE SET-BASED MOVE, SO A BIG BACKLOG CAN
--       NEVER OUTGROW THE CALL THAT IS SUPPOSED TO PAY IT — AND HELD CINDER
--       IS PAID BEFORE NEW INCOME (held-first, section 3).
-- DRAFT — NOT APPLIED. Paste into the Supabase SQL editor for project
-- ktsiasyjusesawtrwrjc when the owner approves. Idempotent and re-runnable.
-- Run BEFORE sql/157 (the one-off backlog release uses the function below).
-- (Edited in place 2026-09-18 to add section 3 — still never applied, so
-- there is no earlier "156" on live to reconcile with. Live today still runs
-- sql/093's wallet_credit and wallet_holds_release.)
--
-- Reported by the owner (2026-09-17): "ClareyV has 315,908 Cinder stuck behind
-- the daily earnings cap and never released."
--
-- THE DESIGN (sql/093; section 3 below changes the ORDER — holds are now paid
-- before new income): wallet_credit pays what fits under the
-- 4,500,000-per-rolling-24h ceiling and writes the rest as a wallet_holds row.
-- wallet_holds_release() pays holds back out, oldest first, into whatever room
-- the last 24 hours leave. The client calls it after every credit, on focus,
-- on sign-in and every ten minutes. Released Cinder is an ordinary 'credit'
-- ledger row, so it occupies the window like any other income.
--
-- WHAT WENT WRONG (measured read-only on live, 2026-09-18 03:50 UTC):
--   • ClareyV (6b721987…) owns 35,688 open hold rows totalling 315,908 — an
--     average of ~9 Cinder each, because every tiny credit over the ceiling
--     became its own row (14-17 Sep). released = 0 on every one of them.
--   • She has had ROOM since 2026-09-17 13:42 UTC: 47,888 used of 4,500,000
--     in the current window. The rule said "release now". Nothing released.
--   • The 093 release is a per-row PL/pgSQL loop: for EACH hold it updates the
--     hold, upserts + updates user_progress, updates user_profiles (whose
--     up_guard trigger counts six jsonb columns and scans the salvage forge on
--     every fire) and inserts a ledger row. 35,688 × five writes blows the
--     `authenticated` role's statement_timeout (8s). The statement is
--     cancelled, EVERYTHING rolls back, the next call starts from the same
--     35,688 rows plus whatever new ones arrived — so it can never succeed and
--     only gets further from succeeding. Reproduced in a rolled-back probe:
--       ERROR 57014 canceling statement due to statement timeout
--       CONTEXT update public.user_profiles set gems = v_bal … line 36
--   • The client swallowed the error (res.error → return, silently), so the
--     player was never told the release had failed; the "is being held" toast
--     stopped too, because it only fires on a successful answer.
--   • Every other player's holds DID release (8,851 rows / 3,514,102 Cinder,
--     largest single burst 1,858 rows in one minute). ClareyV is the only open
--     balance on live, and the only one whose row count crossed the timeout.
--
-- THE FIX: the same rule, done as ONE statement.
--   1. Lock the player's user_progress row FOR UPDATE first. Every release for
--      this player now queues on that lock, so two tabs / a retry cannot both
--      read the same open holds and pay them twice.
--   2. Lock the open hold rows, then allocate the room across them oldest
--      first with a running sum, in a single UPDATE … RETURNING.
--   3. Credit the TOTAL once through _ct_cinder_give (sql/048 — the existing
--      server wallet credit path: user_progress + user_profiles mirror + a
--      'credit' ledger row). One trigger fire instead of 35,688.
--   Steps 2 and 3 are in the same transaction as the locks: a hold is marked
--   released if and only if its Cinder landed. A second call finds released =
--   amount and pays 0.
--
-- 🔴 NOTHING IS MINTED. A release only moves amount - released of an existing
--    wallet_holds row into the wallet, and bumps released by exactly that. The
--    sum of what is paid equals the sum of what `released` grew by, always.
-- 🔴 THE RELEASE IS NOT PUT THROUGH wallet_credit, so the ceiling it releases
--    under cannot re-hold it. It is bounded by the same room computation 093
--    used (c_max_day - credits in the last 24h), no more.
-- ⚠ The public signature and the JSON answer are UNCHANGED
--    ({ok, released, held, cinder, cap, frees_at} + a new `holds` count), so the
--    client that is live today starts working the moment this is applied.
--
-- No new table, so no new RLS. wallet_holds keeps sql/093's single SELECT
-- policy (own rows only) and no write policy; the functions are the writers.
--
-- HELD-FIRST (section 3). OWNER DECISION 2026-09-18, to the question "new
-- earnings use up the daily room first, so a player at the cap every day never
-- gets held Cinder back. Should held Cinder be paid out first?": "yes".
--   Under 093, wallet_credit spent the day's room on the NEW income and only
--   then did the client's release call look for room — which a player at the
--   cap every day never leaves. Their holds sat forever while newer income
--   kept being paid. Now wallet_credit, under the player's wallet lock:
--     (a) releases open holds, oldest first, into the room — by CALLING the
--         worker above, not a copy of it, so the two can never drift;
--     (b) credits the new income into whatever room is left;
--     (c) holds the rest, appended BEHIND every older hold.
--   So the queue always drains oldest-first, and Cinder earned today can never
--   overtake Cinder held from yesterday. Since (a) fills the room before (b)
--   looks, "open holds remain" implies "room is 0": new income is never paid
--   while an older hold waits.
--   Conservation, per call, to the Cinder:
--     wallet_after + held_after = wallet_before + held_before + p_amount
--   ((a) moves held → wallet, (b) and (c) split p_amount between them.)
-- ONE OPEN HOLD ROW PER PLAYER. New excess is added to the player's NEWEST
--   open hold instead of inserting a row (a new row only when nothing is
--   open). That keeps FIFO exactly: releases fill oldest first, so the open
--   holds are always the tail of the queue and the newest open row is its
--   last position — adding to it appends behind everything already queued,
--   and the part already in the row still releases first (released counts up
--   from the front of the row). This is what stops a ClareyV repeating: her
--   35,688 rows were 35,688 small over-cap credits. The per-event audit stays
--   where it always was, one 'held' wallet_ledger row per held credit (with
--   asked= and held= in its reason); wallet_holds is the queue, not the log.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 1. The worker. Takes a user id so the one-off backlog (sql/157) runs the
--    SAME code the players call. NOT callable by clients: a caller who could
--    name any uuid could release someone else's hold into that someone's
--    wallet (harmless to them, but it is not the caller's decision). Only the
--    wrapper below and the owner in the SQL editor reach it.
-- --------------------------------------------------------------------------
create or replace function public._wallet_holds_release_for(p_uid uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_bal   bigint;
  v_day   bigint;
  v_room  bigint;
  v_rel   bigint := 0;
  v_n     integer := 0;
  v_left  bigint := 0;
  v_frees timestamptz;
  v_give  jsonb;
  -- 🔴 OWNER-SET (2026-09-03, sql/093). Must match wallet_credit's c_max_day.
  c_max_day constant bigint := 4500000;
begin
  if p_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;

  -- (1) One release per player at a time. The row is created if missing so the
  --     lock always has something to hold (a player with holds always has one).
  insert into public.user_progress (user_id) values (p_uid) on conflict (user_id) do nothing;
  select coalesce(cinder, 0) into v_bal from public.user_progress where user_id = p_uid for update;

  select coalesce(sum(delta), 0) into v_day
    from public.wallet_ledger
   where user_id = p_uid and resource = 'cinder' and op = 'credit'
     and created_at > now() - interval '24 hours';
  v_room := greatest(0, c_max_day - v_day);

  if v_room > 0 then
    -- (2) Lock the open holds (FOR UPDATE cannot sit on the windowed query
    --     below, so it is taken here, separately, in the same order).
    perform 1 from public.wallet_holds
      where user_id = p_uid and released < amount
      order by created_at, id
        for update;

    with open_h as (
      select id, amount - released as rem,
             coalesce(sum(amount - released) over (order by created_at, id
                        rows between unbounded preceding and 1 preceding), 0) as before
        from public.wallet_holds
       where user_id = p_uid and released < amount
    ), take as (
      select id, least(rem, v_room - before) as t
        from open_h
       where before < v_room
    ), upd as (
      update public.wallet_holds h
         set released = h.released + take.t, updated_at = now()
        from take
       where h.id = take.id and take.t > 0
      returning take.t
    )
    select coalesce(sum(t), 0), count(*) into v_rel, v_n from upd;

    -- (3) Exactly what `released` grew by, credited once.
    if v_rel > 0 then
      v_give := public._ct_cinder_give(p_uid, v_rel,
                  'Held Cinder released (24h ceiling) x' || v_n || ' holds');
      v_bal := coalesce((v_give ->> 'balance')::bigint, v_bal + v_rel);
    end if;
  end if;

  select coalesce(sum(amount - released), 0) into v_left
    from public.wallet_holds where user_id = p_uid and released < amount;

  -- When the oldest credit in the window ages out: the earliest moment more
  -- room can appear. Only meaningful while something is still held.
  if v_left > 0 then
    select min(created_at) + interval '24 hours' into v_frees
      from public.wallet_ledger
     where user_id = p_uid and resource = 'cinder' and op = 'credit'
       and created_at > now() - interval '24 hours';
  end if;

  return jsonb_build_object('ok', true, 'released', v_rel, 'holds', v_n, 'held', v_left,
                            'cinder', coalesce(v_bal, 0), 'cap', c_max_day, 'frees_at', v_frees);
end$function$;
revoke all on function public._wallet_holds_release_for(uuid) from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 2. The player's call — same name and answer as sql/093, only ever for
--    auth.uid(). The client calls it on sign-in, after every credit, on focus
--    and every ten minutes.
-- --------------------------------------------------------------------------
create or replace function public.wallet_holds_release()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
begin
  return public._wallet_holds_release_for(auth.uid());
end$function$;
revoke all on function public.wallet_holds_release() from public, anon;
grant execute on function public.wallet_holds_release() to authenticated;

-- --------------------------------------------------------------------------
-- 3. wallet_credit — HELD FIRST. Started from the LIVE definition
--    (pg_get_functiondef, 2026-09-18), which is sql/093's body with the
--    comments stripped and no logic change. Same signature, same bigint
--    answer (the wallet balance after the call — now including anything the
--    call released), same refusals, same ref rule. Seven server functions call
--    it (depot_claim, influence_resolve, merc_claim, merc_cancel_contract,
--    wallet_reconcile_self, and farm via _farm_wallet_credit) and all of them
--    only read that balance, so none of them change.
--
--    ⚠ LOCK ORDER. user_progress (this player) FOR UPDATE first, then the
--      hold rows — the same order as _wallet_holds_release_for, which takes
--      the same row lock again (a no-op inside one transaction). A credit and
--      a release for one player therefore queue behind each other instead of
--      deadlocking, and cannot both see the same open holds. The lock is
--      taken BEFORE the ref check, so two same-ref retries racing each other
--      now serialize and the second finds the ref (093 checked first and
--      locked later, so both could pass the check).
--    ⚠ The lock is taken only if the row already exists: creating an empty
--      user_progress row here, for a call that is then refused, would make a
--      brand-new player's client skip its first-sign-in seed (progress_ensure
--      only seeds when there is no row). The paying paths create it as 093 did.
--    ⚠ The single and hourly refusals run BEFORE the release, exactly where 093
--      had them, so releasing holds can never be what gets new income refused.
--    ⚠ A release is NOT routed through wallet_credit (it goes worker →
--      _ct_cinder_give), so nothing re-holds released Cinder.
-- --------------------------------------------------------------------------
create or replace function public.wallet_credit(p_amount bigint, p_reason text default 'reward', p_ref text default null)
returns bigint language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid  uuid := auth.uid();
  v_bal  bigint;
  v_hour bigint;
  v_day  bigint;
  v_room bigint;
  v_hold bigint;
  v_rel  jsonb;
  v_hid  uuid;
  c_max_single constant bigint := 2000000;
  c_max_hour   constant bigint := 10000000;
  -- 🔴 OWNER-SET (2026-09-03, sql/093). Must match _wallet_holds_release_for's c_max_day.
  c_max_day    constant bigint := 4500000;
begin
  if v_uid is null or p_amount is null or p_amount <= 0 then return 0; end if;

  -- (0) The player's wallet lock, first (see the lock-order note above).
  select coalesce(cinder,0) into v_bal from public.user_progress where user_id = v_uid for update;

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

  -- (a) ⏳ HELD FIRST. Older held Cinder takes the room before this income
  --     does. The worker is the one the players' release call runs; it locks
  --     user_progress (already ours) then the holds, and credits what it
  --     releases as a 'credit' ledger row — so the window sum below sees it.
  if exists (select 1 from public.wallet_holds where user_id = v_uid and released < amount) then
    v_rel := public._wallet_holds_release_for(v_uid);
    if coalesce((v_rel ->> 'released')::bigint, 0) > 0 then
      v_bal := coalesce((v_rel ->> 'cinder')::bigint, v_bal);
    end if;
  end if;

  -- (b) The new income gets only the room the holds left.
  select coalesce(sum(delta),0) into v_day
    from public.wallet_ledger
   where user_id = v_uid and resource='cinder' and op='credit'
     and created_at > now() - interval '24 hours';

  v_room := greatest(0, c_max_day - v_day);
  v_hold := greatest(0, p_amount - v_room);

  -- (c) What does not fit is appended BEHIND every older hold — into the
  --     player's newest open hold row (the tail of the queue), or a new row
  --     when nothing is open. See "ONE OPEN HOLD ROW PER PLAYER" in the header.
  if v_hold > 0 then
    update public.wallet_holds h
       set amount = h.amount + v_hold, updated_at = now()
     where h.id = (select id from public.wallet_holds
                    where user_id = v_uid and released < amount
                    order by created_at desc, id desc
                    limit 1)
    returning h.id into v_hid;
    if v_hid is null then
      insert into public.wallet_holds (user_id, amount, reason) values (v_uid, v_hold, p_reason);
    end if;
    begin
      insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason, ref)
      values (v_uid, 'held', 'cinder', 0, coalesce(v_bal,0),
              'HELD daily>' || c_max_day || ' used=' || v_day || ' asked=' || p_amount || ' held=' || v_hold || ' as=' || coalesce(p_reason,''),
              case when v_room > 0 then null else p_ref end);
    exception
      when unique_violation then null;
      when undefined_table or undefined_column then null;
    end;
    p_amount := p_amount - v_hold;
    if p_amount <= 0 then return coalesce(v_bal, 0::bigint); end if;
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
-- Same grants as live (authenticated + service_role; never anon).
revoke all on function public.wallet_credit(bigint, text, text) from public, anon;
grant execute on function public.wallet_credit(bigint, text, text) to authenticated, service_role;

-- ===========================================================================
-- VERIFY (read-only)
-- ===========================================================================
select
  (select prosrc not like '%for r in%' and prosrc like '%_ct_cinder_give%'
     from pg_proc where proname = '_wallet_holds_release_for')              as worker_is_set_based,
  (select prosrc like '%_wallet_holds_release_for(auth.uid())%'
     from pg_proc where proname = 'wallet_holds_release')                   as wrapper_uses_worker,
  has_function_privilege('authenticated', 'public.wallet_holds_release()', 'execute')              as players_can_release,
  not has_function_privilege('authenticated', 'public._wallet_holds_release_for(uuid)', 'execute') as players_cannot_name_a_uid,
  not has_function_privilege('anon', 'public.wallet_holds_release()', 'execute')                   as anon_cannot_call,
  (select prosrc like '%_wallet_holds_release_for(v_uid)%' and prosrc like '%for update%'
          and position('_wallet_holds_release_for(v_uid)' in prosrc) < position('v_room := greatest' in prosrc)
     from pg_proc where proname = 'wallet_credit')                          as credit_is_held_first,
  not has_function_privilege('anon', 'public.wallet_credit(bigint,text,text)', 'execute')          as anon_cannot_credit,
  (select count(*) from (select user_id from public.wallet_holds where released < amount
                          group by user_id having count(*) > 1) x)          as players_with_many_open_rows,  -- only pre-156 rows; shrinks as they drain
  (select count(*) from pg_policies where tablename = 'wallet_holds')        as wallet_holds_policies,   -- 1 (select own)
  (select count(distinct user_id) from public.wallet_holds where released < amount) as players_still_held,
  (select coalesce(sum(amount - released), 0) from public.wallet_holds where released < amount) as cinder_still_held;
