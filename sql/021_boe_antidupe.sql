-- ===========================================================================
-- 021 . BANK OF ETHOS - ANTI-DUPE: DETECTION, ADMIN VISIBILITY, RATE LIMIT
--
-- WHAT HAPPENED (the exploit this file answers)
--   Bank of Ethos deposits credited the bank SERVER-side while saveProfile()
--   only wrote localStorage; the cloud push is 4-second debounced. Refresh
--   inside that window and the wallet came back from the cloud with the bank
--   credit already banked. Deposit / refresh / repeat. Two accounts minted
--   roughly 2.13 BILLION and 11.6 MILLION Cinder. One account went from
--   ~1.5M to ~1.4B in 14 deposits inside 30 minutes.
--
--   The client hole is closed in v120t2 (every money path now awaits
--   cloudSyncProfile() before returning). This file is the part that does not
--   depend on the client being honest.
--
-- WHAT THIS FILE DOES
--   1. Records EVERY increase to a bank_of_ethos cinder balance in a
--      trigger-written, append-only table the client cannot forge or skip.
--   2. Enforces a deposit rate + volume cap in that same trigger, so the cap
--      applies whether the money moved through boe_adjust_balance() or a raw
--      PostgREST update.
--   3. Detects deposit BURSTS (gap-and-islands over both the client ledger and
--      the server-written event log) inside SECURITY DEFINER, admin-gated
--      functions.
--   4. Persists detections as admin-only FLAGS with an admin-settable status,
--      so a false positive can be cleared and stays cleared.
--   5. Gives the admin screen one call that returns wallet + BANK balance +
--      flag state for every account.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--   ** It never takes anyone's money. ** There is no UPDATE of any balance
--   column anywhere below. Detection flags for a human; a human decides.
--   A false positive that empties an honest player's account is worse than a
--   duper going uncaught for an hour.
--
-- Ledgers stay append-only. boe_ledger's own policy shape is untouched:
--   using (user_id = auth.uid())
-- Admin reads go through SECURITY DEFINER functions, never a widened policy.
--
-- Plain ASCII. Idempotent + re-runnable. Supabase SQL editor,
-- project ktsiasyjusesawtrwrjc. Verify queries at the bottom.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. ADMIN GATE
--
-- public.is_admin() already exists (api.sql) and reads the VERIFIED top-level
-- JWT email claim - not user_metadata, which a client can write. We create it
-- ONLY if it is missing, so a project that has since changed the definition
-- (e.g. moved to an admins table) is not clobbered by re-running this file.
-- ---------------------------------------------------------------------------
do $bootstrap$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'is_admin'
  ) then
    execute $fn$
      create function public.is_admin() returns boolean
        language sql stable as $body$
        select lower(coalesce((auth.jwt() ->> 'email'), '')) in
          ('richaegisop@gmail.com', 'play@mythicsoa.com', 'dev@mythicspellbook.com')
      $body$;
    $fn$;
  end if;
end
$bootstrap$;


-- ---------------------------------------------------------------------------
-- 1. SERVER-WRITTEN DEPOSIT EVENT LOG  (append-only, unforgeable)
--
-- boe_ledger is written by the CLIENT (boeLog -> insert). A duper can simply
-- not call it, and then a detector that only reads boe_ledger sees nothing.
-- This table is written by a trigger on bank_of_ethos, so it records the money
-- actually moving, whatever code path moved it.
--
-- RLS: enabled with ZERO policies. Under RLS, no policy = no rows for anon or
-- authenticated, for select AND insert AND update AND delete. The trigger
-- writes it as a SECURITY DEFINER function owned by postgres, which is exempt.
-- The admin reads it through the definer functions below. A player has no read
-- path to it at all - not their own rows either, which is fine: they already
-- see their own history in boe_ledger.
-- ---------------------------------------------------------------------------
create table if not exists public.boe_deposit_events (
  id            bigint generated always as identity primary key,
  user_id       uuid not null,
  ts            timestamptz not null default now(),
  amount        numeric not null default 0,     -- cinder ADDED to the bank
  balance_after numeric
);
create index if not exists boe_dep_ev_user_ts on public.boe_deposit_events (user_id, ts desc);
create index if not exists boe_dep_ev_ts      on public.boe_deposit_events (ts desc);
alter table public.boe_deposit_events enable row level security;
-- Belt and braces: even the table-level grant is withdrawn, so a future
-- accidental "create policy ... using (true)" still cannot leak it.
revoke all on public.boe_deposit_events from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. RATE-LIMIT CONFIG  (one row, admin-tunable without editing this file)
--
-- Same RLS shape: enabled, zero policies, grants revoked. Nobody reads or
-- writes it except the SECURITY DEFINER trigger and you, in the SQL editor.
--
-- THE NUMBERS AND WHY (full argument in .cityloop/_r12/antidupe.NOTES.md):
--   min_seconds_between  2       A human deposit is a click. Two seconds kills
--                                a scripted refresh loop and is invisible to a
--                                person. Also collapses accidental double-taps.
--   max_events_per_hour  40      A normal player banks a few times an hour. The
--                                exploit needed 14 in 30 minutes and would want
--                                far more. 40 is high enough that a bank-open
--                                settlement storm (loans + mercs + market +
--                                requests all crediting at once) never trips it.
--   max_cinder_per_hour  5000000 THE ONE THAT ACTUALLY MATTERS. A count cap
--                                alone does not help: the exploit COMPOUNDED,
--                                so 40 doublings an hour is still ~10^12x. What
--                                stops it is capping the value that can enter a
--                                bank account per unit time.
--   max_cinder_per_day   20000000  Cashout minimum is 500,000 Cinder = $100, so
--                                this is 40x the cashout floor per day - far
--                                above any legitimate earner. Against the real
--                                incident: 2.13 BILLION would take 107 days of
--                                uninterrupted abuse instead of one afternoon,
--                                and detection (part 4) fires within minutes.
--
-- KILL SWITCH. If this ever refuses a legitimate player:
--   update public.boe_rate_limit_config set enabled = false where id = 1;
-- The trigger then only records events and refuses nothing.
-- ---------------------------------------------------------------------------
create table if not exists public.boe_rate_limit_config (
  id                  int primary key,
  enabled             boolean     not null default true,
  min_seconds_between int         not null default 2,
  max_events_per_hour int         not null default 40,
  max_cinder_per_hour numeric     not null default 5000000,
  max_cinder_per_day  numeric     not null default 20000000,
  updated_at          timestamptz not null default now(),
  constraint boe_rlc_single check (id = 1)
);
insert into public.boe_rate_limit_config (id) values (1) on conflict (id) do nothing;
alter table public.boe_rate_limit_config enable row level security;
revoke all on public.boe_rate_limit_config from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. THE RATE LIMIT ITSELF - a BEFORE UPDATE trigger on bank_of_ethos.
--
-- WHY A TRIGGER AND NOT boe_adjust_balance().
--   boe_adjust_balance() is the good path, but bank_of_ethos still carries
--   boe_upd (update ... using user_id = auth.uid()), so a hand-rolled client
--   can update its own balance directly and skip the RPC entirely - the
--   existing _boeAdjust() fallback does exactly that when the RPC is missing.
--   A trigger sits under BOTH paths and cannot be routed around.
--
-- ONLY INCREASES ARE CONSIDERED. Withdrawals, the 200-Cinder maintenance fee
-- and every Aza-only move pass straight through.
--
-- FAILING IS SAFE. The exception aborts the statement, so the bank row is not
-- written; the client's _boeAdjust() gets ok:false and boeDeposit() refunds the
-- wallet it had already debited. Nothing is confiscated, nothing is minted.
-- ---------------------------------------------------------------------------
create or replace function public.boe_rate_limit_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $guard$
declare
  c        public.boe_rate_limit_config%rowtype;
  v_delta  numeric;
  v_n      int;
  v_hour   numeric;
  v_day    numeric;
  v_last   timestamptz;
begin
  v_delta := coalesce(new.balance, 0) - coalesce(old.balance, 0);
  if v_delta <= 0 then
    return new;                                   -- withdrawal / fee / no-op
  end if;

  select * into c from public.boe_rate_limit_config where id = 1;

  if found and c.enabled then
    select count(*), coalesce(sum(e.amount), 0), max(e.ts)
      into v_n, v_hour, v_last
      from public.boe_deposit_events e
     where e.user_id = new.user_id
       and e.ts > now() - interval '1 hour';

    select coalesce(sum(e.amount), 0)
      into v_day
      from public.boe_deposit_events e
     where e.user_id = new.user_id
       and e.ts > now() - interval '24 hours';

    if c.min_seconds_between > 0 and v_last is not null
       and now() - v_last < make_interval(secs => c.min_seconds_between) then
      raise exception 'BOE_RATE_LIMIT_INTERVAL: bank deposits are limited to one every % second(s).',
        c.min_seconds_between
        using hint = 'Wait a moment and deposit again. Nothing was moved.';
    end if;

    if v_n >= c.max_events_per_hour then
      raise exception 'BOE_RATE_LIMIT_COUNT: % bank credits in the last hour (limit %).',
        v_n, c.max_events_per_hour
        using hint = 'Bank deposits are rate limited. Nothing was moved.';
    end if;

    if v_hour + v_delta > c.max_cinder_per_hour then
      raise exception 'BOE_RATE_LIMIT_HOURLY: % Cinder banked in the last hour, this deposit of % would exceed the hourly cap of %.',
        v_hour, v_delta, c.max_cinder_per_hour
        using hint = 'Hourly bank deposit cap reached. Nothing was moved.';
    end if;

    if v_day + v_delta > c.max_cinder_per_day then
      raise exception 'BOE_RATE_LIMIT_DAILY: % Cinder banked in the last 24h, this deposit of % would exceed the daily cap of %.',
        v_day, v_delta, c.max_cinder_per_day
        using hint = 'Daily bank deposit cap reached. Nothing was moved.';
    end if;
  end if;

  -- Record it even when the limiter is disabled, so detection keeps working
  -- from a source the client cannot skip.
  insert into public.boe_deposit_events (user_id, ts, amount, balance_after)
  values (new.user_id, now(), v_delta, new.balance);

  return new;
end
$guard$;

revoke all on function public.boe_rate_limit_guard() from public, anon, authenticated;

drop trigger if exists boe_rate_limit_trg on public.bank_of_ethos;
create trigger boe_rate_limit_trg
  before update of balance on public.bank_of_ethos
  for each row
  when (new.balance is distinct from old.balance)
  execute function public.boe_rate_limit_guard();


-- ---------------------------------------------------------------------------
-- 3b. THE SECOND HOLE THE RATE LIMIT WOULD OTHERWISE LEAVE OPEN.
--
-- bank_of_ethos' insert policy is with check (user_id = auth.uid()) - it
-- constrains WHO, not HOW MUCH. A hand-rolled client with no bank row could
-- insert one with balance = 1e12 and skip every UPDATE-side guard above.
-- The real client inserts { user_id, balance: 0 }, so requiring that costs
-- nothing.
--
-- The check applies ONLY when a signed-in player is inserting their own row
-- (auth.uid() is not null). In the SQL editor auth.uid() is null, so you can
-- still restore a row by hand with any balance you like.
-- ---------------------------------------------------------------------------
create or replace function public.boe_open_account_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $openacct$
begin
  if auth.uid() is not null
     and (coalesce(new.balance, 0) <> 0 or coalesce(new.aza, 0) <> 0) then
    raise exception 'BOE_OPEN_ZERO: a new Bank of Ethos account must open at zero.'
      using hint = 'Open the account, then deposit.';
  end if;
  return new;
end
$openacct$;

revoke all on function public.boe_open_account_guard() from public, anon, authenticated;

drop trigger if exists boe_open_account_trg on public.bank_of_ethos;
create trigger boe_open_account_trg
  before insert on public.bank_of_ethos
  for each row
  execute function public.boe_open_account_guard();


-- ---------------------------------------------------------------------------
-- 4. BURST DETECTION  (gap-and-islands, admin-gated, read-only)
--
-- A "burst" is a run of deposits where each is within p_gap_minutes of the one
-- before it. That is what the incident looked like: 14 deposits inside 30
-- minutes, each roughly doubling the last. Normal banking has minutes-to-hours
-- of dead air between deposits, so it does not group into a long island.
--
-- Two sources, reported separately and labelled:
--   'ledger'  boe_ledger, written by the client. Covers HISTORY - it is where
--             the incident that already happened is visible. Skippable by a
--             hostile client, so it is a floor, never a ceiling.
--   'server'  boe_deposit_events, written by the trigger above. Unforgeable,
--             but only exists from the moment this migration is applied.
--
-- SECURITY DEFINER + gate. Granted to authenticated because PostgREST needs
-- that to route the call at all; the gate is the first statement in the body:
--   p_user_id null  -> everyone's bursts       -> ADMIN ONLY
--   p_user_id set   -> that one player         -> admin, OR that player asking
--                                                 about themselves (which is
--                                                 what the self-check uses)
-- A player can therefore never see another player's deposit pattern.
-- ---------------------------------------------------------------------------
create index if not exists boe_ledger_kind_ts on public.boe_ledger (kind, ts desc);

drop function if exists public.boe_dupe_bursts(timestamptz, int, int, numeric);
drop function if exists public.boe_dupe_bursts(timestamptz, int, int, numeric, uuid);
create or replace function public.boe_dupe_bursts(
  p_since        timestamptz default (now() - interval '90 days'),
  p_gap_minutes  int         default 10,
  p_min_deposits int         default 6,
  p_min_cinder   numeric     default 250000,
  p_user_id      uuid        default null)
returns table (
  source          text,
  user_id         uuid,
  burst_start     timestamptz,
  burst_end       timestamptz,
  deposits        int,
  cinder_total    numeric,
  largest_deposit numeric,
  growth_ratio    numeric,
  span_minutes    numeric)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $bursts$
begin
  if p_user_id is null then
    if not public.is_admin() then
      raise exception 'boe_dupe_bursts: admin only';
    end if;
  elsif not (public.is_admin() or p_user_id = auth.uid()) then
    raise exception 'boe_dupe_bursts: you may only scan your own account';
  end if;

  return query
  with d as (
    select 'server'::text as src, e.user_id as uid, e.ts as ts, e.amount as cinder
      from public.boe_deposit_events e
     where e.ts >= p_since and e.amount > 0
       and (p_user_id is null or e.user_id = p_user_id)
    union all
    select 'ledger'::text, l.user_id, l.ts, l.cinder
      from public.boe_ledger l
     where l.ts >= p_since and l.kind = 'deposit' and l.cinder > 0
       and (p_user_id is null or l.user_id = p_user_id)
  ),
  g as (
    select d.*,
           case when d.ts - lag(d.ts) over (partition by d.src, d.uid order by d.ts)
                     <= make_interval(mins => p_gap_minutes)
                then 0 else 1 end as newgrp
      from d
  ),
  i as (
    select g.*,
           sum(g.newgrp) over (partition by g.src, g.uid order by g.ts
                               rows between unbounded preceding and current row) as grp
      from g
  )
  select i.src,
         i.uid,
         min(i.ts),
         max(i.ts),
         count(*)::int,
         sum(i.cinder),
         max(i.cinder),
         case when min(i.cinder) > 0
              then round(max(i.cinder) / min(i.cinder), 2)
              else null end,
         round((extract(epoch from (max(i.ts) - min(i.ts))) / 60.0)::numeric, 1)
    from i
   group by i.src, i.uid, i.grp
  having count(*) >= p_min_deposits
     and sum(i.cinder) >= p_min_cinder
   order by sum(i.cinder) desc;
end
$bursts$;

revoke all on function public.boe_dupe_bursts(timestamptz, int, int, numeric, uuid) from public, anon;
grant execute on function public.boe_dupe_bursts(timestamptz, int, int, numeric, uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. THE FLAG TABLE  (the duper badge, admin-only, never punitive)
--
-- RLS: enabled, ZERO policies, grants revoked. A player cannot read the flag
-- list - not other people's and not their own. That is deliberate:
--   * public shaming is a support problem;
--   * a false positive shown to the player is an accusation you then have to
--     retract;
--   * and telling a real duper exactly what tripped the detector hands them
--     the shape of the evasion.
--
-- status: 'open' (needs a human look) | 'cleared' (checked, legitimate) |
--         'confirmed' (human decided it was a dupe). Nothing in this schema
--         reads status and acts on it. It is a note for you.
-- ---------------------------------------------------------------------------
create table if not exists public.boe_dupe_flags (
  id              bigint generated always as identity primary key,
  user_id         uuid not null,
  source          text not null default 'ledger',
  burst_start     timestamptz not null,
  burst_end       timestamptz not null,
  deposits        int     not null default 0,
  cinder_total    numeric not null default 0,
  largest_deposit numeric not null default 0,
  growth_ratio    numeric,
  span_minutes    numeric,
  severity        text not null default 'review',   -- review | high | critical
  status          text not null default 'open',     -- open | cleared | confirmed
  admin_note      text,
  first_seen      timestamptz not null default now(),
  last_seen       timestamptz not null default now(),
  enforced_at     timestamptz,
  constraint boe_dupe_flags_uq unique (user_id, source, burst_start)
);
alter table public.boe_dupe_flags add column if not exists enforced_at timestamptz;
create index if not exists boe_dupe_flags_user on public.boe_dupe_flags (user_id);
create index if not exists boe_dupe_flags_open on public.boe_dupe_flags (status, cinder_total desc);
alter table public.boe_dupe_flags enable row level security;
revoke all on public.boe_dupe_flags from public, anon, authenticated;


-- Re-scan and upsert flags. Admin-gated. Writes ONLY to boe_dupe_flags -
-- no balance is read-modified, nothing is deducted.
-- An existing flag keeps its status and admin_note: something you already
-- CLEARED stays cleared when the scan runs again.
create or replace function public.boe_dupe_refresh_flags(
  p_since        timestamptz default (now() - interval '90 days'),
  p_gap_minutes  int         default 10,
  p_min_deposits int         default 6,
  p_min_cinder   numeric     default 250000)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $refresh$
declare
  v_n int := 0;
begin
  if not public.is_admin() then
    raise exception 'boe_dupe_refresh_flags: admin only';
  end if;

  insert into public.boe_dupe_flags as f
    (user_id, source, burst_start, burst_end, deposits, cinder_total,
     largest_deposit, growth_ratio, span_minutes, severity, last_seen)
  select b.user_id, b.source, b.burst_start, b.burst_end, b.deposits, b.cinder_total,
         b.largest_deposit, b.growth_ratio, b.span_minutes,
         case
           when b.cinder_total >= 100000000 or coalesce(b.growth_ratio, 0) >= 100 then 'critical'
           when b.cinder_total >=  10000000 or b.deposits >= 12                   then 'high'
           else 'review'
         end,
         now()
    from public.boe_dupe_bursts(p_since, p_gap_minutes, p_min_deposits, p_min_cinder) b
  on conflict (user_id, source, burst_start) do update
    set burst_end       = excluded.burst_end,
        deposits        = excluded.deposits,
        cinder_total    = excluded.cinder_total,
        largest_deposit = excluded.largest_deposit,
        growth_ratio    = excluded.growth_ratio,
        span_minutes    = excluded.span_minutes,
        severity        = excluded.severity,
        last_seen       = now();
        -- status / admin_note intentionally NOT touched.

  get diagnostics v_n = row_count;
  return v_n;
end
$refresh$;

revoke all on function public.boe_dupe_refresh_flags(timestamptz, int, int, numeric) from public, anon;
grant execute on function public.boe_dupe_refresh_flags(timestamptz, int, int, numeric) to authenticated;


-- Admin marks a flag cleared / confirmed and leaves a note. Still no money.
create or replace function public.boe_dupe_set_status(
  p_id     bigint,
  p_status text,
  p_note   text default null)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $setst$
begin
  if not public.is_admin() then
    raise exception 'boe_dupe_set_status: admin only';
  end if;
  if p_status not in ('open', 'cleared', 'confirmed') then
    raise exception 'boe_dupe_set_status: status must be open | cleared | confirmed';
  end if;
  update public.boe_dupe_flags
     set status = p_status,
         admin_note = coalesce(p_note, admin_note)
   where id = p_id;
  return found;
end
$setst$;

revoke all on function public.boe_dupe_set_status(bigint, text, text) from public, anon;
grant execute on function public.boe_dupe_set_status(bigint, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 6. boe_dupe_corrections - HARDEN WHATEVER IS ALREADY THERE
--
-- This table may already exist with a PARTIAL column set from the manual
-- cleanup. "create table if not exists" is a no-op if it exists, so every
-- column is added separately with "add column if not exists", every one
-- NULLABLE (an existing row cannot violate a not-null we add after the fact),
-- and no foreign key is added (an existing row referencing a deleted user
-- would make the migration fail).
--
-- It is an admin audit record of hand corrections. Same RLS shape as the
-- flags: enabled, zero policies, grants revoked.
-- ---------------------------------------------------------------------------
create table if not exists public.boe_dupe_corrections (
  id bigint generated always as identity primary key
);
alter table public.boe_dupe_corrections add column if not exists user_id        uuid;
alter table public.boe_dupe_corrections add column if not exists handle         text;
alter table public.boe_dupe_corrections add column if not exists corrected_at   timestamptz default now();
alter table public.boe_dupe_corrections add column if not exists wallet_before  numeric;
alter table public.boe_dupe_corrections add column if not exists wallet_after   numeric;
alter table public.boe_dupe_corrections add column if not exists bank_before    numeric;
alter table public.boe_dupe_corrections add column if not exists bank_after     numeric;
alter table public.boe_dupe_corrections add column if not exists reason         text;
alter table public.boe_dupe_corrections add column if not exists corrected_by   text;
alter table public.boe_dupe_corrections add column if not exists note           text;
create index if not exists boe_dupe_corr_user on public.boe_dupe_corrections (user_id);
alter table public.boe_dupe_corrections enable row level security;
revoke all on public.boe_dupe_corrections from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 7. ADMIN OVERVIEW - one call for the User Management screen
--
-- Returns, for every profile: wallet (user_profiles.gems), Aza
-- (user_profiles.sovereigns), BANK balance (bank_of_ethos.balance), bank Aza,
-- and the flag summary. SECURITY DEFINER so it can cross bank_of_ethos'
-- self-only policy WITHOUT widening that policy for anybody else.
--
-- Note what is NOT here: no email, no auth metadata. Those already come from
-- the service-role Worker endpoint. This function's blast radius if the gate
-- ever failed is balances, not credentials.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_boe_overview(int);
create or replace function public.admin_boe_overview(
  p_limit int default 1000)
returns table (
  user_id            uuid,
  handle             text,
  wallet_gems        numeric,
  wallet_sovereigns  numeric,
  bank_balance       numeric,
  bank_aza           numeric,
  last_seen          timestamptz,
  flags_open         int,
  flags_total        int,
  worst_severity     text,
  worst_cinder       numeric,
  worst_at           timestamptz,
  credits_last_hour  int,
  cinder_last_24h    numeric)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $overview$
begin
  if not public.is_admin() then
    raise exception 'admin_boe_overview: admin only';
  end if;

  return query
  select p.user_id,
         coalesce(p.display_name, '(no handle)')::text,
         coalesce(p.gems, 0)::numeric,
         coalesce(p.sovereigns, 0)::numeric,
         coalesce(b.balance, 0)::numeric,
         coalesce(b.aza, 0)::numeric,
         p.updated_at,
         coalesce(f.open_n, 0)::int,
         coalesce(f.all_n, 0)::int,
         f.worst_sev::text,
         coalesce(f.worst_cinder, 0)::numeric,
         f.worst_at,
         coalesce(e.n_hour, 0)::int,
         coalesce(e.cinder_day, 0)::numeric
    from public.user_profiles p
    left join public.bank_of_ethos b on b.user_id = p.user_id
    left join (
      select x.user_id,
             count(*) filter (where x.status <> 'cleared')          as all_n,
             count(*) filter (where x.status = 'open')               as open_n,
             max(case x.severity when 'critical' then 3 when 'high' then 2 else 1 end) as sev_rank,
             (array_agg(x.severity order by x.cinder_total desc))[1] as worst_sev,
             max(x.cinder_total)                                     as worst_cinder,
             (array_agg(x.burst_start order by x.cinder_total desc))[1] as worst_at
        from public.boe_dupe_flags x
       where x.status <> 'cleared'
       group by x.user_id
    ) f on f.user_id = p.user_id
    left join (
      select v.user_id,
             count(*) filter (where v.ts > now() - interval '1 hour')                as n_hour,
             coalesce(sum(v.amount) filter (where v.ts > now() - interval '24 hours'), 0) as cinder_day
        from public.boe_deposit_events v
       where v.ts > now() - interval '24 hours'
       group by v.user_id
    ) e on e.user_id = p.user_id
   order by coalesce(f.sev_rank, 0) desc, coalesce(b.balance, 0) desc
   limit greatest(1, least(5000, coalesce(p_limit, 1000)));
end
$overview$;

revoke all on function public.admin_boe_overview(int) from public, anon;
grant execute on function public.admin_boe_overview(int) to authenticated;


-- Flag detail for one player (the dossier panel). Admin-gated.
drop function if exists public.admin_boe_flags(uuid);
create or replace function public.admin_boe_flags(
  p_user_id uuid default null)
returns table (
  id              bigint,
  user_id         uuid,
  source          text,
  burst_start     timestamptz,
  burst_end       timestamptz,
  deposits        int,
  cinder_total    numeric,
  largest_deposit numeric,
  growth_ratio    numeric,
  span_minutes    numeric,
  severity        text,
  status          text,
  admin_note      text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $flags$
begin
  if not public.is_admin() then
    raise exception 'admin_boe_flags: admin only';
  end if;
  return query
  select f.id, f.user_id, f.source, f.burst_start, f.burst_end, f.deposits,
         f.cinder_total, f.largest_deposit, f.growth_ratio, f.span_minutes,
         f.severity, f.status, f.admin_note
    from public.boe_dupe_flags f
   where p_user_id is null or f.user_id = p_user_id
   order by f.cinder_total desc
   limit 500;
end
$flags$;

revoke all on function public.admin_boe_flags(uuid) from public, anon;
grant execute on function public.admin_boe_flags(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 8. AUTOMATED ENFORCEMENT - CONFISCATION, SCP HEAT, WARNING
--
-- ** READ THIS BEFORE CHANGING ANY NUMBER BELOW. **
-- This is the only part of the file that takes something away from a player.
-- Four independent conditions must ALL hold, inside ONE unbroken run of
-- deposits, before it fires. The real incident cleared every one of them by an
-- order of magnitude; ordinary banking clears none of them.
--
--   min_deposits       10        The incident was 14 deposits in 30 minutes.
--   min_cinder_total   25000000  25M Cinder into the bank inside a single
--                                burst. Cashout minimum is 500,000 = $100, so
--                                this is 50x the cashout floor banked in one
--                                sitting. The incident compounded 1.5M -> 1.4B.
--   min_growth_ratio   20        largest deposit / smallest deposit inside the
--                                burst. THIS IS THE SIGNATURE. A duper's
--                                deposits compound upward - each cycle banks
--                                more than the last. An honest player emptying
--                                their wallet repeatedly deposits DECREASING
--                                amounts, because the wallet is draining. A
--                                20x upward spread across 10+ deposits inside
--                                two hours is not what earning looks like.
--   max_span_minutes   120       The whole run has to be tight. A long, slow
--                                banking day cannot qualify no matter how big.
--
-- THE PENALTY (set by the user, deliberately harsher than the first, manual
-- remediation): wallet -> 20,000 Cinder, bank -> 3,000 Cinder.
--
-- FLOOR, NEVER A GRANT. Both use least(current, floor). An account already
-- below the floor is left alone - enforcement can only ever remove, never add,
-- so it cannot be turned into a way to mint 20,000 Cinder.
--
-- WHAT IT NEVER TOUCHES: cards, resources, buildings, placed property,
-- licences, corp assets, Aza. Cinder only. The house rule about never deleting
-- a player's placed property is not bent here.
--
-- REVERSIBILITY IS THE WHOLE SAFETY NET. At 20,000 / 3,000 a false positive is
-- effectively a wipe, so the before-values are staged into dupe_resets in a
-- separate statement BEFORE anything is written, and admin_boe_undo_reset()
-- puts them back from that row. If the insert fails, the whole function fails
-- and nothing is confiscated.
--
-- KILL SWITCH:  update public.boe_enforcement_config set enabled = false where id = 1;
-- ---------------------------------------------------------------------------
create table if not exists public.boe_enforcement_config (
  id                 int primary key,
  enabled            boolean not null default true,
  wallet_floor       numeric not null default 20000,
  bank_floor         numeric not null default 3000,
  min_deposits       int     not null default 10,
  min_cinder_total   numeric not null default 25000000,
  min_growth_ratio   numeric not null default 20,
  max_span_minutes   numeric not null default 120,
  scp_heat           numeric not null default 18,
  -- Filing a court record puts the offender on City Hall's PUBLIC Wanted list.
  -- Default OFF: a false positive that only cost Cinder is refundable, a false
  -- positive that named someone publicly is not. Flip it to true when you trust
  -- the detector, and the escalation becomes a real row the Court screens read.
  file_court_record  boolean not null default false,
  recheck_hours      int     not null default 24,
  updated_at         timestamptz not null default now(),
  constraint boe_enf_single check (id = 1)
);
insert into public.boe_enforcement_config (id) values (1) on conflict (id) do nothing;
alter table public.boe_enforcement_config enable row level security;
revoke all on public.boe_enforcement_config from public, anon, authenticated;


-- The audit / undo record. May ALREADY EXIST (the user created it by hand),
-- possibly with a different column set, so every column is added separately
-- and nullable. Its wallet_after / bank_after defaults were 200000 / 300000
-- from the first, manual remediation; the standing automated penalty is
-- 20000 / 3000, so BOTH the defaults are moved AND every automated insert
-- writes the two columns explicitly. Belt and braces: an audit row that
-- records the wrong "after" is worse than no audit row, because an undo would
-- then restore from a lie.
create table if not exists public.dupe_resets (
  user_id       uuid,
  duped         numeric,
  wallet_before numeric,
  bank_before   numeric,
  wallet_after  numeric,
  bank_after    numeric,
  reset_at      timestamptz default now()
);
alter table public.dupe_resets add column if not exists user_id       uuid;
alter table public.dupe_resets add column if not exists duped         numeric;
alter table public.dupe_resets add column if not exists wallet_before numeric;
alter table public.dupe_resets add column if not exists bank_before   numeric;
alter table public.dupe_resets add column if not exists wallet_after  numeric;
alter table public.dupe_resets add column if not exists bank_after    numeric;
alter table public.dupe_resets add column if not exists reset_at      timestamptz default now();
alter table public.dupe_resets add column if not exists source        text;
alter table public.dupe_resets add column if not exists note          text;
alter table public.dupe_resets add column if not exists undone_at     timestamptz;
alter table public.dupe_resets alter column wallet_after set default 20000;
alter table public.dupe_resets alter column bank_after   set default 3000;
create index if not exists dupe_resets_user on public.dupe_resets (user_id, reset_at desc);
alter table public.dupe_resets enable row level security;
revoke all on public.dupe_resets from public, anon, authenticated;


-- 🌡 SCP HEAT - the REAL mechanic, not a parallel counter.
--
-- Heat in this game is computed by _rlcHeat(run) from the contraband weight in
-- the run's haul (RLC_CONTRABAND), and it feeds three existing consumers:
--   RLC_HEAT_SCP_LOCK = 12   heat >= 12 locks SCP / surveillance nodes and
--                            puts the Black Market Hall into LOCKDOWN
--   RLC_HEAT_LVL_DIV  = 4    every 4 heat = +1 enemy level
-- There is no STORED player heat field today - it is derived per run. So this
-- adds one persistent surcharge column that _rlcHeat() adds to the contraband
-- total. Same function, same three consumers, no second gauge.
--
-- Increment 18: one point above the 12 that already means LOCKDOWN (so a clean
-- offender lands there immediately rather than near the edge) and, at
-- RLC_HEAT_LVL_DIV = 4, +4 enemy levels. In fiction: the Foundation noticed.
-- It costs no items and blocks no content permanently - the admin clears it
-- with a single update, and undoing a reset clears it too.
alter table public.user_profiles add column if not exists scp_heat numeric not null default 0;


-- The enforcement function.
--   p_user_id = auth.uid()  -> the self-check the client runs (a player can
--                              only ever aim this at themselves)
--   any other user          -> ADMIN ONLY
create or replace function public.boe_dupe_enforce_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $enforce$
declare
  cfg           public.boe_enforcement_config%rowtype;
  b             record;
  v_gems        numeric := 0;
  v_progress    numeric := 0;
  v_wallet_bef  numeric := 0;
  v_bank_bef    numeric := 0;
  v_wallet_aft  numeric := 0;
  v_bank_aft    numeric := 0;
  v_prior       timestamptz;
  v_name        text;
  v_duped_type  text;
  v_duped_col   text := '';
  v_duped_val   text := '';
  v_court       boolean := false;
begin
  if p_user_id is null then
    raise exception 'boe_dupe_enforce_user: p_user_id is required';
  end if;
  if not (public.is_admin() or p_user_id = auth.uid()) then
    raise exception 'boe_dupe_enforce_user: you may only run this on your own account';
  end if;

  select * into cfg from public.boe_enforcement_config where id = 1;
  if not found or not cfg.enabled then
    return jsonb_build_object('enforced', false, 'reason', 'disabled');
  end if;

  -- The single worst burst that clears ALL FOUR conditions.
  select * into b
    from public.boe_dupe_bursts(now() - interval '365 days', 10,
                                cfg.min_deposits, cfg.min_cinder_total, p_user_id) x
   where x.deposits              >= cfg.min_deposits
     and x.cinder_total          >= cfg.min_cinder_total
     and coalesce(x.growth_ratio, 0) >= cfg.min_growth_ratio
     and coalesce(x.span_minutes, 0) <= cfg.max_span_minutes
   order by x.cinder_total desc
   limit 1;

  if not found then
    return jsonb_build_object('enforced', false, 'reason', 'no_qualifying_burst');
  end if;

  -- ALREADY HANDLED? Two guards, both erring towards doing nothing:
  --   * a reset already recorded AFTER this burst ended - which also covers
  --     the two accounts the user reset BY HAND, so this never re-punishes
  --     someone who has already been dealt with;
  --   * any reset inside the recheck window, so a repeated self-check on boot
  --     cannot strip an account twice.
  select max(r.reset_at) into v_prior
    from public.dupe_resets r
   where r.user_id = p_user_id and r.undone_at is null;

  if v_prior is not null
     and (v_prior >= b.burst_end
          or v_prior > now() - make_interval(hours => greatest(1, cfg.recheck_hours))) then
    return jsonb_build_object('enforced', false, 'reason', 'already_handled',
                              'prior_reset_at', v_prior);
  end if;

  -- ---- stage the BEFORE values -------------------------------------------
  select coalesce(p.gems, 0), coalesce(p.display_name, '')
    into v_gems, v_name
    from public.user_profiles p where p.user_id = p_user_id;

  select coalesce(g.cinder, 0) into v_progress
    from public.user_progress g where g.user_id = p_user_id;

  select coalesce(k.balance, 0) into v_bank_bef
    from public.bank_of_ethos k where k.user_id = p_user_id;

  -- The canonical-wallet reconcile keeps the HIGHER of user_profiles.gems and
  -- user_progress.cinder, so the honest "before" is the higher of the two -
  -- and both have to be written on the way down or the reconcile just puts the
  -- duped number back and it looks like the penalty failed.
  v_wallet_bef := greatest(coalesce(v_gems, 0), coalesce(v_progress, 0));
  v_wallet_aft := least(v_wallet_bef, cfg.wallet_floor);
  v_bank_aft   := least(coalesce(v_bank_bef, 0), cfg.bank_floor);

  -- dupe_resets.duped may pre-exist as boolean OR numeric depending on how the
  -- table was created by hand. Detect and write whichever it is; if the column
  -- is absent entirely, leave it out of the insert.
  select data_type into v_duped_type
    from information_schema.columns
   where table_schema = 'public' and table_name = 'dupe_resets' and column_name = 'duped';
  if v_duped_type is not null then
    v_duped_col := ', duped';
    v_duped_val := ', ' || case when v_duped_type = 'boolean'
                                then 'true'
                                else quote_literal(b.cinder_total::text) end;
  end if;

  -- ** THE AUDIT ROW GOES IN FIRST. ** If this fails, the exception aborts the
  -- whole function and not one Cinder has moved. wallet_after / bank_after are
  -- written EXPLICITLY rather than left to the column defaults.
  execute format(
    'insert into public.dupe_resets
       (user_id, wallet_before, bank_before, wallet_after, bank_after, reset_at, source, note%s)
     values ($1, $2, $3, $4, $5, now(), $6, $7%s)',
    v_duped_col, v_duped_val)
  using p_user_id, v_wallet_bef, v_bank_bef, v_wallet_aft, v_bank_aft, 'auto',
        format('auto-enforced: %s deposits, %s Cinder, x%s growth, %s min, source=%s, burst %s..%s',
               b.deposits, b.cinder_total, coalesce(b.growth_ratio, 0), coalesce(b.span_minutes, 0),
               b.source, b.burst_start, b.burst_end);

  -- ---- apply the penalty --------------------------------------------------
  update public.user_profiles
     set gems = v_wallet_aft,
         scp_heat = coalesce(scp_heat, 0) + cfg.scp_heat,
         updated_at = now()
   where user_id = p_user_id;

  update public.user_progress
     set cinder = v_wallet_aft, updated_at = now()
   where user_id = p_user_id;

  update public.bank_of_ethos
     set balance = v_bank_aft, updated_at = now()
   where user_id = p_user_id;

  -- The player's OWN ledger explains the change. Append-only, one row, and it
  -- is the only entry in the whole system a duper is allowed to see about this.
  insert into public.boe_ledger (user_id, ts, kind, cinder, aza, note, counterparty)
  values (p_user_id, now(), 'penalty', (v_bank_aft - coalesce(v_bank_bef, 0)), 0,
          'Bank of Ethos enforcement - duplication', 'Bank of Ethos');

  -- Mark the flag(s) that cover this burst.
  update public.boe_dupe_flags
     set status = 'confirmed', enforced_at = now()
   where user_id = p_user_id and burst_start <= b.burst_end and burst_end >= b.burst_start;

  -- Escalation, only if you have switched it on. court_records is the table
  -- City Hall's Wanted list already reads (severity >= 3 with no active
  -- detention = Wanted), so this is a real row on a real screen, not a prop.
  if cfg.file_court_record and coalesce(v_name, '') <> '' then
    -- If court_records is not installed in this project, the escalation is
    -- skipped - it must never abort a confiscation that already happened.
    begin
      insert into public.court_records (offender_name, crime_type, severity, verdict, sentence, judge_name)
      values (v_name, 'duplication', 4, 'flagged',
              'Bank of Ethos enforcement - balances reset, SCP surveillance raised',
              'Bank of Ethos');
      v_court := true;
    exception when others then
      v_court := false;
    end;
  end if;

  return jsonb_build_object(
    'enforced',        true,
    'wallet_before',   v_wallet_bef,
    'wallet_after',    v_wallet_aft,
    'bank_before',     coalesce(v_bank_bef, 0),
    'bank_after',      v_bank_aft,
    'scp_heat_added',  cfg.scp_heat,
    'court_filed',     v_court,
    'burst_source',    b.source,
    'burst_start',     b.burst_start,
    'burst_end',       b.burst_end,
    'deposits',        b.deposits,
    'cinder_total',    b.cinder_total,
    'growth_ratio',    coalesce(b.growth_ratio, 0),
    'span_minutes',    coalesce(b.span_minutes, 0));
end
$enforce$;

revoke all on function public.boe_dupe_enforce_user(uuid) from public, anon;
grant execute on function public.boe_dupe_enforce_user(uuid) to authenticated;


-- What the client calls on sign-in / bank open. No parameters at all, so there
-- is nothing to aim: it can only ever act on the caller.
create or replace function public.boe_dupe_selfcheck()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $selfcheck$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('enforced', false, 'reason', 'not_authenticated');
  end if;
  return public.boe_dupe_enforce_user(v_uid);
end
$selfcheck$;

revoke all on function public.boe_dupe_selfcheck() from public, anon;
grant execute on function public.boe_dupe_selfcheck() to authenticated;


-- Admin sweep. Runs the same enforcement across every account with an open
-- flag. Returns one row per account it acted on.
drop function if exists public.boe_dupe_enforce_all();
create or replace function public.boe_dupe_enforce_all()
returns table (user_id uuid, outcome jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $enfall$
declare
  r record;
begin
  if not public.is_admin() then
    raise exception 'boe_dupe_enforce_all: admin only';
  end if;
  for r in
    select distinct f.user_id as uid
      from public.boe_dupe_flags f
     where f.status <> 'cleared'
  loop
    user_id := r.uid;
    outcome := public.boe_dupe_enforce_user(r.uid);
    if coalesce((outcome ->> 'enforced')::boolean, false) then
      return next;
    end if;
  end loop;
end
$enfall$;

revoke all on function public.boe_dupe_enforce_all() from public, anon;
grant execute on function public.boe_dupe_enforce_all() to authenticated;


-- ---------------------------------------------------------------------------
-- 9. THE UNDO. This is what makes the penalty survivable.
--
-- Restores wallet + bank from the most recent un-undone dupe_resets row,
-- removes the SCP heat that reset added, marks the row undone so it cannot be
-- applied twice, and clears the flags. Admin only.
-- ---------------------------------------------------------------------------
create or replace function public.admin_boe_undo_reset(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $undo$
declare
  cfg public.boe_enforcement_config%rowtype;
  r   record;
begin
  if not public.is_admin() then
    raise exception 'admin_boe_undo_reset: admin only';
  end if;

  select * into cfg from public.boe_enforcement_config where id = 1;

  select * into r
    from public.dupe_resets d
   where d.user_id = p_user_id and d.undone_at is null
   order by d.reset_at desc
   limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_reset_to_undo');
  end if;

  update public.user_profiles
     set gems = coalesce(r.wallet_before, gems),
         scp_heat = greatest(0, coalesce(scp_heat, 0) - coalesce(cfg.scp_heat, 0)),
         updated_at = now()
   where user_id = p_user_id;

  update public.user_progress
     set cinder = coalesce(r.wallet_before, cinder), updated_at = now()
   where user_id = p_user_id;

  update public.bank_of_ethos
     set balance = coalesce(r.bank_before, balance), updated_at = now()
   where user_id = p_user_id;

  insert into public.boe_ledger (user_id, ts, kind, cinder, aza, note, counterparty)
  values (p_user_id, now(), 'adjust',
          coalesce(r.bank_before, 0) - coalesce(r.bank_after, 0), 0,
          'Bank of Ethos enforcement reversed by City Hall', 'Bank of Ethos');

  update public.dupe_resets
     set undone_at = now()
   where user_id = p_user_id and undone_at is null and reset_at = r.reset_at;

  update public.boe_dupe_flags
     set status = 'cleared', enforced_at = null,
         admin_note = coalesce(admin_note, '') || ' [reset undone ' || now()::text || ']'
   where user_id = p_user_id;

  return jsonb_build_object('ok', true,
    'wallet_restored', r.wallet_before, 'bank_restored', r.bank_before);
end
$undo$;

revoke all on function public.admin_boe_undo_reset(uuid) from public, anon;
grant execute on function public.admin_boe_undo_reset(uuid) to authenticated;


-- ===========================================================================
-- VERIFY
-- ===========================================================================

-- V1. Everything installed.
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('boe_rate_limit_guard','boe_open_account_guard','boe_dupe_bursts',
                        'boe_dupe_refresh_flags','boe_dupe_set_status',
                        'admin_boe_overview','admin_boe_flags')) as functions_expect_7,
  (select count(*) from pg_trigger
    where tgname in ('boe_rate_limit_trg','boe_open_account_trg') and not tgisinternal) as triggers_expect_2,
  (select count(*) from information_schema.tables where table_schema='public'
     and table_name in ('boe_deposit_events','boe_rate_limit_config','boe_dupe_flags','boe_dupe_corrections')) as tables_expect_4;

-- V2. RLS is on and there are NO policies on any of the private tables.
--     Expect rls_enabled = true and policy_count = 0 on all four rows.
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as policy_count
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('boe_deposit_events','boe_rate_limit_config','boe_dupe_flags','boe_dupe_corrections')
 order by 1;

-- V3. No table-level grant survives for anon / authenticated on those tables.
--     Expect ZERO rows.
select table_name, grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name in ('boe_deposit_events','boe_rate_limit_config','boe_dupe_flags','boe_dupe_corrections')
   and grantee in ('anon','authenticated','PUBLIC');

-- V4. boe_ledger's own policy shape is UNCHANGED - still self-only.
--     Expect boe_led_sel with qual "(user_id = auth.uid())".
select policyname, cmd, qual, with_check
  from pg_policies where schemaname='public' and tablename='boe_ledger' order by policyname;

-- V5. The rate limit is live and set to the documented numbers.
select * from public.boe_rate_limit_config;

-- V6. Run the detector over ALL history and see what it finds (read-only).
--     This is the query that should light up the two known accounts.
select * from public.boe_dupe_bursts(now() - interval '365 days', 10, 6, 250000);

-- V7. Persist those detections as admin-only flags. Returns the row count.
--     Safe to re-run; it never changes a status you have already set.
-- select public.boe_dupe_refresh_flags(now() - interval '365 days', 10, 6, 250000);

-- V8. What the admin screen will show.
-- select handle, wallet_gems, bank_balance, flags_open, worst_severity, worst_cinder
--   from public.admin_boe_overview(50);

-- V9. NEGATIVE TEST - run this while signed in as a NON-admin (e.g. in the app
--     console via Cloud.client.rpc). Every one of these must fail:
--       select * from public.boe_dupe_bursts();          -> ERROR admin only
--       select * from public.admin_boe_overview();       -> ERROR admin only
--       select * from public.boe_dupe_flags;             -> 0 rows / permission denied
--       select * from public.boe_deposit_events;         -> 0 rows / permission denied
--       select * from public.bank_of_ethos;              -> only your own row
