-- ===========================================================================
-- 093 — THE DAILY CINDER CEILING IS 4,500,000, AND WHAT GOES OVER IT IS HELD,
--       NOT LOST.
--
-- Asked for: "if a player earned past the 4,500,000 cinder is the new max and
-- if they go past the max send them a notification where it tells them how
-- much is being held and will be moved over to their next 24 hours."
--
-- Two changes to wallet_credit (last rewritten in sql/047):
--
--   1. c_max_day 500,000 → 4,500,000. Still the owner's number, still below
--      the busiest measured day (10,867,754 in sql/046), so heavy players can
--      still reach it — but nine times fewer of them will.
--
--   2. Over the ceiling the credit is no longer REFUSED. The part that fits
--      is paid now; the remainder becomes a row in wallet_holds and is paid
--      out by wallet_holds_release() as the 24-hour window frees up. The
--      player is told how much is held (the client polls the release call
--      after every credit and every ten minutes, and shows the number).
--      Nothing is ever destroyed: a refusal was a silent loss and turned into
--      support tickets (sql/090 was one of them).
--
-- What does NOT change: the single-credit and hourly tests still refuse
-- outright — those exist to catch a broken or hostile client naming an absurd
-- amount, and holding an absurd amount for later would just defer the exploit.
--
-- Idempotent and re-runnable. RLS ships here. Verify at the bottom.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 1. wallet_holds — one row per over-cap remainder. `released` grows toward
--    `amount` as the release function pays it out; a row is spent when they
--    meet. Append-then-release, never deleted, so the history stays auditable.
--    Players can READ their own rows (the client shows the number); only the
--    SECURITY DEFINER functions below write them.
-- --------------------------------------------------------------------------
create table if not exists public.wallet_holds (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  amount     bigint not null check (amount > 0),
  released   bigint not null default 0 check (released >= 0 and released <= amount),
  reason     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wallet_holds_open_idx on public.wallet_holds (user_id, created_at) where released < amount;

alter table public.wallet_holds enable row level security;
drop policy if exists wallet_holds_sel on public.wallet_holds;
create policy wallet_holds_sel on public.wallet_holds for select to authenticated using (user_id = auth.uid());
-- No insert / update / delete policy on purpose: the functions below are the
-- only writers, and they bypass RLS as SECURITY DEFINER.
grant select on public.wallet_holds to authenticated;

-- --------------------------------------------------------------------------
-- 2. wallet_credit — same body as sql/047 up to the daily test, which now
--    splits the credit instead of refusing it.
--
--    ⚠ THE REF STILL MAKES A RETRY A NO-OP. When part of the credit is paid,
--      the credited ledger row carries the ref as before. When NONE of it fits
--      (room = 0) the 'held' ledger row carries the ref instead — so a client
--      that retries the same credit (the outbox in index.html does exactly
--      that) finds the ref and stops, rather than holding the amount twice.
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
  c_max_single constant bigint := 2000000;
  c_max_hour   constant bigint := 10000000;
  -- 🔴 OWNER-SET (2026-09-03): 4,500,000 a day. Over it is HELD, see below.
  c_max_day    constant bigint := 4500000;
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

  -- ⏳ THE DAILY TEST HOLDS INSTEAD OF REFUSING.
  v_room := greatest(0, c_max_day - v_day);
  v_hold := greatest(0, p_amount - v_room);
  if v_hold > 0 then
    insert into public.wallet_holds (user_id, amount, reason) values (v_uid, v_hold, p_reason);
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

-- --------------------------------------------------------------------------
-- 3. wallet_holds_release — pay out held Cinder into whatever room the last
--    24 hours leave, oldest hold first, and report what is still held. The
--    client calls it after every credit, on focus and every ten minutes; it
--    is safe to call as often as you like (no room ⇒ no writes).
--
--    Released amounts are ordinary 'credit' ledger rows, so they occupy the
--    window like any other income — the ceiling is a ceiling on what lands in
--    the wallet per 24 hours, whichever direction it arrived from.
--
--    `frees_at` is when the oldest credit inside the window ages out, i.e. the
--    earliest moment more room can appear. It is what the client shows as
--    "next release".
-- --------------------------------------------------------------------------
create or replace function public.wallet_holds_release()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid   uuid := auth.uid();
  v_bal   bigint;
  v_day   bigint;
  v_room  bigint;
  v_take  bigint;
  v_rel   bigint := 0;
  v_left  bigint := 0;
  v_frees timestamptz;
  r       record;
  c_max_day constant bigint := 4500000;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;

  select coalesce(cinder,0) into v_bal from public.user_progress where user_id = v_uid;

  select coalesce(sum(delta),0) into v_day
    from public.wallet_ledger
   where user_id = v_uid and resource='cinder' and op='credit'
     and created_at > now() - interval '24 hours';
  v_room := greatest(0, c_max_day - v_day);

  for r in
    select id, amount - released as rem
      from public.wallet_holds
     where user_id = v_uid and released < amount
     order by created_at
       for update
  loop
    exit when v_room <= 0;
    v_take := least(r.rem, v_room);
    update public.wallet_holds set released = released + v_take, updated_at = now() where id = r.id;
    insert into public.user_progress (user_id) values (v_uid) on conflict (user_id) do nothing;
    update public.user_progress
       set cinder = coalesce(cinder, 0) + v_take, updated_at = now()
     where user_id = v_uid
     returning cinder into v_bal;
    update public.user_profiles set gems = v_bal
     where user_id = v_uid and coalesce(gems, 0) < v_bal;
    begin
      insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason)
        values (v_uid, 'credit', 'cinder', v_take, coalesce(v_bal, 0), 'Held Cinder released (24h ceiling)');
    exception when undefined_table or undefined_column then null; end;
    v_room := v_room - v_take;
    v_rel  := v_rel + v_take;
  end loop;

  select coalesce(sum(amount - released),0) into v_left
    from public.wallet_holds where user_id = v_uid and released < amount;

  select min(created_at) + interval '24 hours' into v_frees
    from public.wallet_ledger
   where user_id = v_uid and resource='cinder' and op='credit'
     and created_at > now() - interval '24 hours';

  return jsonb_build_object('ok', true, 'released', v_rel, 'held', v_left,
                            'cinder', coalesce(v_bal, 0), 'cap', c_max_day, 'frees_at', v_frees);
end$function$;
revoke all on function public.wallet_holds_release() from public, anon;
grant execute on function public.wallet_holds_release() to authenticated;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- 1) The ceiling and the hold path are in the live body:
-- select prosrc like '%4500000%' and prosrc like '%wallet_holds%' as ok
--   from pg_proc where proname = 'wallet_credit';
-- 2) Players read only their own holds and cannot write them:
-- select policyname, cmd, qual from pg_policies where tablename = 'wallet_holds';   -- one SELECT policy
-- 3) As a player over the cap: select public.wallet_holds_release();
--    -> {"ok":true,"released":0,"held":<n>,...} until the window frees.
-- ===========================================================================
