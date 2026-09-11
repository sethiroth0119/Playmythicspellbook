-- ════════════════════════════════════════════════════════════════════════════
-- 058 — REFERRALS ARE ONE-WAY, PERMANENT, AND CANNOT FORM A LOOP
-- ════════════════════════════════════════════════════════════════════════════
-- Run by hand in the Supabase SQL editor for project ktsiasyjusesawtrwrjc.
-- Idempotent and re-runnable. Ends with a verify block.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 THE HOLE, AND THE FACT THAT IT WAS ALREADY USED
--   referral_redeem() checked three things: the code exists, it is not your
--   own, and you have not redeemed before. It never asked the one question
--   that matters for farming — "has this code's OWNER already been referred by
--   ME?" So A could redeem B's code and B could then redeem A's, and both
--   sides collected the full 5,000 🔥 + 5 👑 + booster pack payout twice.
--
--   That is not hypothetical. At the time of writing, of six rows in
--   referral_redemptions, TWO are a mutual pair:
--       MeanCookie      → Grimalkin Lord   2026-08-22 09:06:39
--       Grimalkin Lord  → MeanCookie       2026-08-22 09:06:49
--   Ten seconds apart, which is what deliberate use of a hole looks like.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🎯 WHY ONE CHECK COVERS THE WHOLE BRIEF
--   referral_redemptions has PRIMARY KEY (redeemer_id). Every player therefore
--   has AT MOST ONE referrer, for ever — the graph is a FOREST, not a general
--   graph. In a forest, adding the edge (redeemer ← referrer) can only create a
--   cycle if the redeemer is already an ANCESTOR of the referrer. So a single
--   walk up the parent chain answers all of it:
--     • A→B then B→A       — walking up from A reaches B on hop 1.
--     • A→B→C then C→A     — walking up from C reaches B, then A. Rejected.
--     • self-referral      — the zero-hop case, still checked separately so
--                            the player gets the specific message.
--   No recursive CTE and no "mutual" special case are needed; a special case
--   for pairs would have missed the three-player loop the brief also asks for.
--
-- ⚠ THE WALK MUST BE BOUNDED, AND NOT AS A THEORETICAL PRECAUTION. The mutual
--   pair above is a REAL CYCLE SITTING IN THE TABLE RIGHT NOW. An unbounded
--   parent walk starting from either of those two accounts never terminates.
--   The visited-set is what actually detects it; the hop cap is the runaway
--   backstop behind that.
--
-- ⚠ EXISTING ROWS ARE GRANDFATHERED, DELIBERATELY. The trigger below fires on
--   INSERT and UPDATE, so it constrains new referrals and leaves history
--   alone. Deleting one leg of the live pair would strip a reward two real
--   accounts already hold and is a moderation decision, not a migration's to
--   make. The verify block at the foot prints the offending pair so it can be
--   actioned deliberately.
--   ⚠ THIS IS ALSO WHY THE BACKFILL RUNS BEFORE THE TRIGGER IS CREATED: a
--     backfill UPDATE would otherwise fire the guard against the very rows it
--     is grandfathering and abort the migration.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. The record the brief asks for ────────────────────────────────────────
-- Referrer id, referred id, code and date already exist. Status and the
-- rewards flag do not.
alter table public.referral_redemptions
  add column if not exists status text not null default 'accepted';
alter table public.referral_redemptions
  add column if not exists rewards_granted boolean not null default false;
alter table public.referral_redemptions
  add column if not exists rewards_granted_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'referral_redemptions_status_ck') then
    alter table public.referral_redemptions
      add constraint referral_redemptions_status_ck
      check (status in ('accepted', 'revoked'));
  end if;
end $$;

-- BACKFILL BEFORE THE TRIGGER EXISTS (see the note above). Every row that
-- predates this migration was paid at redemption time, so the honest value is
-- true — recording them as false would invite a second payout on any future
-- reconciliation pass.
update public.referral_redemptions
   set rewards_granted = true,
       rewards_granted_at = coalesce(rewards_granted_at, created_at)
 where rewards_granted = false;

-- ── 2. Would this edge close a loop? ────────────────────────────────────────
create or replace function public._referral_would_cycle(p_redeemer uuid, p_referrer uuid)
returns boolean language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_cur uuid := p_referrer;
  v_seen uuid[] := array[]::uuid[];
  v_hops int := 0;
begin
  if p_redeemer is null or p_referrer is null then return false; end if;
  if p_redeemer = p_referrer then return true; end if;      -- self, the 0-hop cycle
  -- Walk UP from the prospective referrer. Reaching the redeemer means the
  -- redeemer is already an ancestor, so this edge would close a loop.
  while v_cur is not null and v_hops < 1000 loop
    if v_cur = p_redeemer then return true; end if;
    -- A loop among rows that predate this migration (the grandfathered pair)
    -- would otherwise spin here for ever. This is the real terminator.
    if v_cur = any(v_seen) then return true; end if;
    v_seen := v_seen || v_cur;
    select referrer_id into v_cur
      from public.referral_redemptions
     where redeemer_id = v_cur and status = 'accepted';
    v_hops := v_hops + 1;
  end loop;
  -- Ran off the end of the counter: refuse rather than allow. A 1000-deep
  -- referral chain is not a thing, so this can only mean the data is shaped in
  -- a way this function did not anticipate, and "no" is the safe answer.
  if v_hops >= 1000 then return true; end if;
  return false;
end $function$;

revoke all on function public._referral_would_cycle(uuid, uuid) from public, anon, authenticated;

-- ── 3. The structural backstop ──────────────────────────────────────────────
-- The RPC returns friendly JSON; this makes the rule true of the TABLE, so a
-- future code path (an admin tool, a repair script, a second RPC) cannot
-- reintroduce the hole by not knowing about it.
create or replace function public._referral_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $function$
begin
  if new.redeemer_id = new.referrer_id then
    raise exception 'referral_self_referral' using errcode = '23514';
  end if;
  if public._referral_would_cycle(new.redeemer_id, new.referrer_id) then
    raise exception 'referral_would_cycle' using errcode = '23514';
  end if;
  return new;
end $function$;

drop trigger if exists trg_referral_guard on public.referral_redemptions;
create trigger trg_referral_guard
  before insert or update of redeemer_id, referrer_id
  on public.referral_redemptions
  for each row execute function public._referral_guard();

-- ── 4. The RPC — same checks, but answered in the player's language ─────────
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

-- ── VERIFY ──────────────────────────────────────────────────────────────────
select 'guard installed' as check,
       exists (select 1 from pg_trigger where tgname = 'trg_referral_guard') as ok;

select 'cycle fn is bounded (has the visited-set terminator)' as check,
       pg_get_functiondef(p.oid) like '%v_seen%' as ok
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = '_referral_would_cycle';

-- The pre-existing mutual pair, printed so it can be actioned deliberately
-- rather than discovered later. Expect 2 rows on first run.
select 'GRANDFATHERED mutual pair — decide separately' as check,
       a.redeemer_id, a.referrer_id, a.code, a.created_at
  from referral_redemptions a
  join referral_redemptions b
    on a.redeemer_id = b.referrer_id and a.referrer_id = b.redeemer_id
 order by a.created_at;

-- Proof the guard refuses the three abusive shapes AND STILL ALLOWS the two
-- legitimate ones. The second half is the part that matters: a guard that
-- blocks everything would pass a refusal-only test and break the feature.
-- Everything below is rolled back by the closing RAISE; nothing persists.
-- Substitute four user_ids that have NOT been referred before running.
do $probe$
declare
  P uuid; Q uuid; R uuid; S uuid; results text := '';
begin
  select user_id into P from user_profiles up
    where not exists (select 1 from referral_redemptions r where r.redeemer_id = up.user_id) offset 0 limit 1;
  select user_id into Q from user_profiles up
    where not exists (select 1 from referral_redemptions r where r.redeemer_id = up.user_id) offset 1 limit 1;
  select user_id into R from user_profiles up
    where not exists (select 1 from referral_redemptions r where r.redeemer_id = up.user_id) offset 2 limit 1;
  select user_id into S from user_profiles up
    where not exists (select 1 from referral_redemptions r where r.redeemer_id = up.user_id) offset 3 limit 1;
  if S is null then raise notice 'need 4 unreferred accounts to probe — skipped'; return; end if;

  begin insert into referral_redemptions (redeemer_id, referrer_id, code) values (P, Q, 'T1');
    results := results || E'
  ALLOWED  Q -> P   (a plain new referral)';
  exception when others then results := results || E'
  BLOCKED  Q -> P   !! should have been allowed: ' || sqlerrm; end;

  begin insert into referral_redemptions (redeemer_id, referrer_id, code) values (Q, R, 'T2');
    results := results || E'
  ALLOWED  R -> Q   (chain R -> Q -> P; being referred must not stop you referring)';
  exception when others then results := results || E'
  BLOCKED  R -> Q   !! should have been allowed: ' || sqlerrm; end;

  begin insert into referral_redemptions (redeemer_id, referrer_id, code) values (S, S, 'T3');
    results := results || E'
  ALLOWED  self     !! SHOULD HAVE BEEN REFUSED';
  exception when others then results := results || E'
  refused  self-referral'; end;

  begin insert into referral_redemptions (redeemer_id, referrer_id, code) values (R, P, 'T4');
    results := results || E'
  ALLOWED  P -> R   !! SHOULD HAVE BEEN REFUSED (3-loop)';
  exception when others then results := results || E'
  refused  P -> R   (closes R->Q->P->R)'; end;

  begin insert into referral_redemptions (redeemer_id, referrer_id, code) values (R, Q, 'T5');
    results := results || E'
  ALLOWED  Q -> R   !! SHOULD HAVE BEEN REFUSED (mutual)';
  exception when others then results := results || E'
  refused  Q -> R   (reverses R -> Q)'; end;

  raise exception 'PROBE (rolled back)%', results;
end $probe$;

-- ── APPLIED 2026-08-25 ──────────────────────────────────────────────────────
--   Columns + backfill, _referral_would_cycle, _referral_guard trigger and the
--   rewritten referral_redeem are all live on ktsiasyjusesawtrwrjc.
--   Probe result on the live database:
--       ALLOWED  Q -> P   (a plain new referral)
--       ALLOWED  R -> Q   (chain R -> Q -> P)
--       refused  self-referral
--       refused  P -> R   (closes R->Q->P->R)
--       refused  Q -> R   (reverses R -> Q)
--   6 rows before, 6 rows after, no probe residue.
