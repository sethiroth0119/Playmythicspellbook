-- ===========================================================================
-- 025 . AZA REWARDS — the server decides the amount, and the server rolls
-- ===========================================================================
-- WHY
--
--   024 makes Aza server-owned everywhere it can be proved: purchases (Stripe
--   confirms), gifts (the row says the amount), spending (down is safe). The
--   one class it could not close is gameplay rewards, because five paths grant
--   Aza from logic that runs entirely on the client:
--
--     covert mission cv_resource   +1
--     covert mission cv_recruit    +2
--     chest opens t1..t4           a random roll, up to +35
--     Territory Wars Chosen trophy +25   (the code's own note: "≈ $25")
--     Dark Event sabotage          +5
--
--   Handing the client a credit RPC for those would recreate the hole under a
--   new name. So instead the client gets to say WHICH thing it did, and
--   nothing else:
--
--     * the AMOUNT comes from a server table, never from a parameter;
--     * the RANDOM ROLL happens here, so a client cannot re-roll a chest until
--       the jackpot lands;
--     * the FREQUENCY is enforced here. The covert-mission limits below are
--       already written in COVERT_MISSIONS ("2 per week", "1 per 2 weeks") but
--       have only ever been checked on the client, which means they were never
--       really enforced at all.
--
--   A cheater can still claim a mission they did not run. They cannot choose
--   what it pays, cannot roll again for a better number, and cannot exceed the
--   rate. That is the honest limit of what is achievable without moving the
--   gameplay itself server-side, and it is a very different exposure from
--   "set your balance to anything with one PATCH".
--
-- WHERE THE NUMBERS COME FROM
--   Every PAYOUT below is lifted from the existing client code — COVERT_MISSIONS
--   (index.html ~184656) and CHEST_TIERS (~201149). Nothing is invented; this
--   file changes no payout.
--   The RATE LIMITS are new, because three of the five had none. They are
--   anti-abuse ceilings set well above normal play, not balance levers, and
--   they live in ONE table so tuning them is an UPDATE and not a deploy.
--
-- Apply AFTER 024. Idempotent; safe to re-run. Re-running does NOT overwrite
-- rules you have since tuned — see the ON CONFLICT in §3.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 1. The rules. One row per grantable thing.
-- --------------------------------------------------------------------------
create table if not exists public.aza_reward_rules (
  kind           text primary key,
  aza_min        bigint  not null default 0,
  aza_max        bigint  not null default 0,
  chance         numeric not null default 1.0 check (chance >= 0 and chance <= 1),
  max_per_window int     not null default 0,      -- 0 = no per-kind limit
  window_seconds bigint  not null default 86400,
  enabled        boolean not null default true,
  -- ⚠ Lets the CALLER name the amount, clamped to [aza_min, aza_max]. Off by
  --   default and it should stay off: it is a deliberate, bounded concession
  --   for the one grant whose size genuinely is not knowable server-side (an
  --   NPC winning a player's auction pays the bid, and the bid history lives
  --   on the client). Everything else must not have it — for a chest, an
  --   honoured request would simply always be the maximum.
  client_amount  boolean not null default false,
  note           text,
  check (aza_min >= 0 and aza_max >= aza_min)
);
alter table public.aza_reward_rules add column if not exists client_amount boolean not null default false;

-- A single global ceiling, so a kind nobody thought to limit can never become
-- an unbounded tap. Belt to the per-kind braces.
create table if not exists public.aza_reward_settings (
  only_row      boolean primary key default true check (only_row),
  daily_aza_cap bigint not null default 60
);
insert into public.aza_reward_settings (only_row, daily_aza_cap)
values (true, 60) on conflict (only_row) do nothing;

-- --------------------------------------------------------------------------
-- 2. The log. This is what the rate limits are counted from, so it records
--    MISSES too (aza = 0): a chest roll that came up empty still consumed an
--    attempt. Without that, a scripted client could roll forever and only the
--    hits would count — which is the same as having no limit on the thing that
--    actually matters.
-- --------------------------------------------------------------------------
create table if not exists public.aza_reward_log (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind    text not null,
  aza     bigint not null default 0,
  ts      timestamptz not null default now()
);
create index if not exists aza_reward_log_user_kind_ts on public.aza_reward_log (user_id, kind, ts desc);
create index if not exists aza_reward_log_user_ts      on public.aza_reward_log (user_id, ts desc);

alter table public.aza_reward_rules    enable row level security;
alter table public.aza_reward_settings enable row level security;
alter table public.aza_reward_log      enable row level security;

-- Rules are readable so the UI can honestly show "2 per week" from the same
-- source that enforces it, instead of a second copy that can drift.
drop policy if exists arr_sel on public.aza_reward_rules;
create policy arr_sel on public.aza_reward_rules for select to authenticated using (true);
drop policy if exists ars_sel on public.aza_reward_settings;
create policy ars_sel on public.aza_reward_settings for select to authenticated using (true);
drop policy if exists arl_sel on public.aza_reward_log;
create policy arl_sel on public.aza_reward_log for select to authenticated using (user_id = auth.uid());
-- No INSERT/UPDATE policy anywhere here. Writes come only from the definer
-- function below; tuning is done by an admin in the SQL editor.

-- --------------------------------------------------------------------------
-- 3. Seed. ON CONFLICT DO NOTHING on purpose — once you have tuned a rule,
--    re-running this file must not quietly reset it to my defaults.
--    To deliberately reset one:  delete from aza_reward_rules where kind='…';
-- --------------------------------------------------------------------------
insert into public.aza_reward_rules (kind, aza_min, aza_max, chance, max_per_window, window_seconds, client_amount, note) values
  -- An NPC bidder winning the player's auction pays them in Aza. The amount is
  -- the winning bid, which only the client knows — so this is the one rule
  -- with client_amount, hard-clamped to 25 and 5 a day. Aza minted by AI
  -- purchases is an economy question as much as a security one; the ceiling is
  -- set low deliberately, and it is one UPDATE away if that is wrong.
  ('auction_npc_sale',    0, 25,  1.00,  5,      24 * 3600, true,  'NPC won a player auction. Amount is the bid, clamped. Ceiling is conservative on purpose.'),
  -- Payout and limit both already in COVERT_MISSIONS. The limit was
  -- client-side only until now.
  ('cv_resource',         1,  1,  1.00,  2,  7 * 24 * 3600, false, 'Covert: Resource Run. 2 per week — limit was already declared in COVERT_MISSIONS.'),
  ('cv_recruit',          2,  2,  1.00,  1, 14 * 24 * 3600, false, 'Covert: Recruitment Drive. 1 per 2 weeks — limit was already declared in COVERT_MISSIONS.'),
  -- Ranges and chances are exactly CHEST_TIERS. The 40/day is a new ceiling:
  -- chests are gated by chest+key inventory in normal play, which is itself
  -- client-held, so this is the backstop for that.
  ('chest_t1',            1,  3,  0.06, 40,      24 * 3600, false, 'Scavenger Chest. Range + chance from CHEST_TIERS. 40/day is an anti-abuse ceiling, not a drop change.'),
  ('chest_t2',            2,  6,  0.12, 40,      24 * 3600, false, 'Warden Chest. Range + chance from CHEST_TIERS.'),
  ('chest_t3',            5, 14,  0.22, 40,      24 * 3600, false, 'Mythic Chest. Range + chance from CHEST_TIERS.'),
  ('chest_t4',           12, 35,  0.40, 40,      24 * 3600, false, 'Abraxas Chest. Range + chance from CHEST_TIERS.'),
  -- 25 Aza is the single largest grant in the game. "Once per Chosen" is not
  -- a rule a database can check, so it becomes a rate limit.
  ('tw_chosen_trophy',   25, 25,  1.00,  1,  7 * 24 * 3600, false, 'Territory Wars Chosen trophy. Code notes 25 Aza ~ $25. 1 per 7 days is an anti-abuse ceiling.'),
  ('dark_event_sabotage', 5,  5,  1.00,  5,      24 * 3600, false, 'Dark Event sabotaged. 5/day is an anti-abuse ceiling.')
on conflict (kind) do nothing;

-- --------------------------------------------------------------------------
-- 4. sov_reward — the only way a player can cause Aza to be created, and it
--    cannot be told how much to create.
--
--    Returns the granted amount so the client can show it. A miss returns
--    ok:true with granted 0 — that is a legitimate outcome for a chest, not an
--    error, and the caller should render it as "no Aza this time".
-- --------------------------------------------------------------------------
create or replace function public.sov_reward(p_kind text, p_requested bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $r$
declare
  v_uid    uuid := auth.uid();
  v_rule   public.aza_reward_rules%rowtype;
  v_used   int;
  v_today  bigint;
  v_cap    bigint;
  v_amt    bigint := 0;
  v_bal    bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;

  select * into v_rule from public.aza_reward_rules where kind = p_kind;
  if v_rule.kind is null then return jsonb_build_object('ok', false, 'error', 'unknown_kind'); end if;
  if not v_rule.enabled then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;

  -- Per-kind frequency. Counts attempts, hits and misses alike.
  if v_rule.max_per_window > 0 then
    select count(*) into v_used
      from public.aza_reward_log
     where user_id = v_uid
       and kind = p_kind
       and ts > now() - make_interval(secs => v_rule.window_seconds);
    if v_used >= v_rule.max_per_window then
      return jsonb_build_object('ok', false, 'error', 'rate_limited',
                                'used', v_used, 'limit', v_rule.max_per_window,
                                'window_seconds', v_rule.window_seconds);
    end if;
  end if;

  -- 🎲 THE ROLL HAPPENS HERE. Doing it client-side meant a client could keep
  --    rolling until it liked the answer; the amount it then reported was
  --    whatever it chose anyway.
  if v_rule.chance >= 1.0 or random() < v_rule.chance then
    if v_rule.client_amount and p_requested is not null then
      -- The caller may name it, but only inside the rule's band. This is the
      -- auction case; see the client_amount column comment for why it exists
      -- and why nothing else should use it.
      v_amt := least(greatest(p_requested, v_rule.aza_min), v_rule.aza_max);
      if v_amt < 0 then v_amt := 0; end if;
    elsif v_rule.aza_max > v_rule.aza_min then
      v_amt := v_rule.aza_min + floor(random() * (v_rule.aza_max - v_rule.aza_min + 1))::bigint;
    else
      v_amt := v_rule.aza_min;
    end if;
  end if;

  -- Global daily ceiling, checked against what would be granted.
  if v_amt > 0 then
    select daily_aza_cap into v_cap from public.aza_reward_settings where only_row;
    select coalesce(sum(aza), 0) into v_today
      from public.aza_reward_log
     where user_id = v_uid and ts > now() - interval '24 hours';
    if coalesce(v_today, 0) + v_amt > coalesce(v_cap, 60) then
      -- Log the refused attempt so it still consumes the per-kind window;
      -- otherwise hitting the cap would hand out unlimited free retries.
      insert into public.aza_reward_log (user_id, kind, aza) values (v_uid, p_kind, 0);
      return jsonb_build_object('ok', false, 'error', 'daily_cap',
                                'today', coalesce(v_today, 0), 'cap', coalesce(v_cap, 60));
    end if;
  end if;

  insert into public.aza_reward_log (user_id, kind, aza) values (v_uid, p_kind, v_amt);

  if v_amt > 0 then
    v_bal := public._sov_apply(v_uid, v_amt, 'Aza reward: ' || p_kind);
    if v_bal is null then
      raise exception 'sov_reward: credit failed for % (%)', v_uid, p_kind;
    end if;
  else
    select coalesce(sovereigns, 0) into v_bal from public.user_progress where user_id = v_uid;
  end if;

  return jsonb_build_object('ok', true, 'kind', p_kind, 'granted', v_amt,
                            'aza', coalesce(v_bal, 0));
end;
$r$;
revoke all on function public.sov_reward(text, bigint) from public, anon;
grant execute on function public.sov_reward(text, bigint) to authenticated;

-- --------------------------------------------------------------------------
-- 5. sov_refund — reverse ONE specific earlier charge, exactly once.
--
--    Needed because several Aza spends are "charge, then do a thing, put it
--    back if the thing failed" (a failed marketplace payment, a lost auction).
--
--    ⚠ WHY A LEDGER ID AND NOT AN AMOUNT. An amount parameter would be a
--      credit RPC with a friendlier name — the exact hole this work exists to
--      close. Binding to a real prior charge row, plus a UNIQUE row per refund,
--      means the most anyone can get back is money they demonstrably paid, once.
--      Charge/refund cycling nets to zero; it cannot inflate.
--
--    ⚠ WHAT THIS DOES NOT PREVENT: a dishonest client refunding a charge for
--      something it actually received. That is not a currency-integrity
--      problem — a client that will do that can simply decline to call
--      sov_charge in the first place — and it is what the "atomic later" phase
--      fixes, by having one server call both take the money and grant the
--      item. The 10-minute window below is defence in depth for the meantime,
--      matched to the fact that every real refund site fires within seconds.
-- --------------------------------------------------------------------------
create table if not exists public.aza_refunds (
  ledger_id uuid primary key,
  user_id   uuid not null references auth.users(id) on delete cascade,
  aza       bigint not null,
  ts        timestamptz not null default now()
);
alter table public.aza_refunds enable row level security;
drop policy if exists arf_sel on public.aza_refunds;
create policy arf_sel on public.aza_refunds for select to authenticated using (user_id = auth.uid());

create or replace function public.sov_refund(p_ledger_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $f$
declare
  v_uid   uuid := auth.uid();
  v_delta bigint;
  v_when  timestamptz;
  v_new   int := 0;
  v_bal   bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  if p_ledger_id is null then return jsonb_build_object('ok', false, 'error', 'bad_args'); end if;

  -- Must be this player's own Aza charge, and recent.
  select l.delta, l.created_at into v_delta, v_when
    from public.wallet_ledger l
   where l.id = p_ledger_id
     and l.user_id = v_uid
     and l.resource = 'sovereigns'
     and l.op = 'charge'
     and l.delta < 0;

  if v_delta is null then return jsonb_build_object('ok', false, 'error', 'no_such_charge'); end if;
  if v_when < now() - interval '10 minutes' then
    return jsonb_build_object('ok', false, 'error', 'too_old');
  end if;

  -- The UNIQUE primary key is the exactly-once guarantee.
  with ins as (
    insert into public.aza_refunds (ledger_id, user_id, aza)
    values (p_ledger_id, v_uid, -v_delta)
    on conflict (ledger_id) do nothing
    returning ledger_id
  ) select count(*)::int into v_new from ins;

  if v_new = 0 then
    select coalesce(sovereigns, 0) into v_bal from public.user_progress where user_id = v_uid;
    return jsonb_build_object('ok', true, 'already', true, 'aza', coalesce(v_bal, 0), 'refunded', 0);
  end if;

  v_bal := public._sov_apply(v_uid, -v_delta, 'Aza refund of ' || p_ledger_id::text);
  if v_bal is null then
    raise exception 'sov_refund: credit failed for %', p_ledger_id;
  end if;
  return jsonb_build_object('ok', true, 'already', false, 'aza', v_bal, 'refunded', -v_delta);
end;
$f$;
revoke all on function public.sov_refund(uuid) from public, anon;
grant execute on function public.sov_refund(uuid) to authenticated;

-- --------------------------------------------------------------------------
-- 6. sov_charge now hands back the ledger id, so the caller has something to
--    pass to sov_refund. Same behaviour otherwise; the extra key is additive
--    and an older client that ignores it keeps working.
-- --------------------------------------------------------------------------
create or replace function public.sov_charge(p_amount bigint, p_reason text default 'aza spend')
returns jsonb
language plpgsql
security definer
set search_path = public
as $h$
declare
  v_uid  uuid := auth.uid();
  v_bal  bigint;
  v_have bigint;
  v_lid  uuid;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  if p_amount is null or p_amount <= 0 then return jsonb_build_object('ok', false, 'error', 'bad_amount'); end if;

  v_bal := public._sov_apply(v_uid, -p_amount, p_reason);
  if v_bal is null then
    select coalesce(sovereigns, 0) into v_have from public.user_progress where user_id = v_uid;
    return jsonb_build_object('ok', false, 'error', 'insufficient', 'aza', coalesce(v_have, 0));
  end if;

  -- The row _sov_apply just wrote. Newest charge for this user; the lookup is
  -- inside the same transaction so nothing can interleave.
  select l.id into v_lid
    from public.wallet_ledger l
   where l.user_id = v_uid and l.resource = 'sovereigns' and l.op = 'charge'
   order by l.created_at desc, l.id desc
   limit 1;

  return jsonb_build_object('ok', true, 'aza', v_bal, 'charged', p_amount, 'ledger_id', v_lid);
end;
$h$;
revoke all on function public.sov_charge(bigint, text) from public, anon;
grant execute on function public.sov_charge(bigint, text) to authenticated;

-- ===========================================================================
-- VERIFY
-- ===========================================================================

-- 6a. The rules, as they will actually be enforced.
-- select kind, aza_min, aza_max, chance, max_per_window,
--        (window_seconds / 3600.0) || 'h' as window, enabled
--   from public.aza_reward_rules order by kind;
-- select daily_aza_cap from public.aza_reward_settings;

-- 6b. Grants. sov_reward is player-callable BY DESIGN — it is safe only
--     because it takes a kind, not an amount.
-- select p.proname,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed,
--        has_function_privilege('anon',          p.oid, 'EXECUTE') as anon
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.proname in ('sov_reward','sov_refund','sov_charge')
--  order by p.proname;
--   -> all three: authed true, anon false

-- 6c. Once live — what rewards are actually paying out, per day.
-- select date_trunc('day', ts) as day, kind, count(*) as attempts,
--        count(*) filter (where aza > 0) as hits, sum(aza) as aza
--   from public.aza_reward_log
--  group by 1, 2 order by 1 desc, 3 desc;

-- 6d. Anyone pressed against the ceilings is worth a look.
-- select user_id, sum(aza) as aza_24h, count(*) as attempts_24h
--   from public.aza_reward_log where ts > now() - interval '24 hours'
--  group by 1 having sum(aza) >= (select daily_aza_cap from public.aza_reward_settings)
--  order by 2 desc;
