-- ============================================================================
-- 038_highway_haul.sql — 🛣 HIGHWAY HAUL: player-to-player freight on the
-- city node map, driven live in a 3D highway run.
-- Idempotent. Re-runnable. RLS ships in this file. Ends with a verify query.
--
-- Apply BY HAND in the Supabase SQL editor for project ktsiasyjusesawtrwrjc.
-- Nothing in the client REQUIRES this: /src/haul detects a missing table or
-- RPC and drops to PRACTICE mode (no jobs board, no money moves), so applying
-- it is an upgrade, not a gate.
--
-- ── WHAT THIS ADDS ──────────────────────────────────────────────────────────
--  1. haul_jobs       A shipment a player (the SHIPPER) wants moved from one
--                     city node to another. The fare is paid up front, in
--                     Cinder, by the shipper, and held on the row (escrow).
--                     The goods leave the shipper's stash client-side when the
--                     job is posted (same escrow-first order as the exchange)
--                     and are handed to the recipient by haul_claim_goods().
--  2. haul_runs       APPEND-ONLY. One row per drive, delivered or failed. It
--                     is the driver's whole record: the driver rank, the
--                     "what is this driver worth" figure the company owner
--                     sees, and the audit trail for every Cinder the RPC moved.
--  3. haul_companies  One row per corporation that runs a transport business:
--                     the owner's default driver wage (a % of the fare) and
--                     the crash penalties that come out of that wage.
--  4. haul_wages      Per-driver wage overrides, set by the corp founder.
--  5. SECURITY DEFINER RPCs. Every one derives the actor from auth.uid().
--
-- ── MONEY, AND WHY IT IS SERVER-SIDE ────────────────────────────────────────
-- The fare is real Cinder moving between THREE parties (shipper → driver AND
-- the company treasury), so it cannot be a client-side spendGems/addGems pair:
-- the driver's client would be the one crediting itself. The RPCs below write
-- the canonical wallet exactly the way sql/023 requires — user_progress.cinder
-- AND user_profiles.gems together, wallet_seq bumped on every DEBIT, a
-- wallet_ledger row per movement — so the client's MAX(server, local) ratchet
-- can neither undo a fare nor double a payout. Read 023 before touching this.
--
-- ⚠ Company income goes into corp_treasury as an INSERT (append-only ledger,
--   balance = sum(amount)). Never an UPDATE. CLAUDE.md.
-- ⚠ Crash penalties on a FREELANCE run (no company) are BURNED — removed from
--   circulation like the Foundation Tax — never minted to anyone.
-- ⚠ The run OUTCOME (crashes, cargo %, time) is client-reported, as every
--   minigame outcome in this game is. The exposure is bounded by design: the
--   most a dishonest driver can extract is the fare a shipper voluntarily
--   escrowed, and the server refuses a payout larger than that escrow.
-- ============================================================================

begin;

-- ── 1. JOBS ────────────────────────────────────────────────────────────────
create table if not exists public.haul_jobs (
  id              uuid primary key default gen_random_uuid(),
  shipper_id      uuid not null references auth.users(id) on delete cascade,
  shipper_name    text,
  recipient_id    uuid not null references auth.users(id) on delete cascade,
  from_node       text not null,            -- Territory-War node id, e.g. 'N-04'
  from_name       text not null,
  to_node         text not null,
  to_name         text not null,
  resource        text not null,
  qty             integer not null check (qty > 0 and qty <= 99999),
  distance_km     numeric not null check (distance_km > 0 and distance_km <= 99999),
  fare            bigint  not null check (fare > 0),        -- escrowed Cinder
  status          text not null default 'open'
                  check (status in ('open','claimed','delivered','cancelled')),
  driver_id       uuid references auth.users(id) on delete set null,
  driver_name     text,
  corp_id         uuid,                       -- the transport company, if any
  claimed_at      timestamptz,
  delivered_at    timestamptz,
  cargo_pct       numeric,                    -- 0..1 of qty that arrived intact
  goods_claimed_at timestamptz,               -- recipient collected the goods
  created_at      timestamptz not null default now()
);
create index if not exists haul_jobs_open_idx     on public.haul_jobs (status, created_at desc);
create index if not exists haul_jobs_shipper_idx  on public.haul_jobs (shipper_id, created_at desc);
create index if not exists haul_jobs_driver_idx   on public.haul_jobs (driver_id, created_at desc);

-- ── 2. RUNS (append-only) ──────────────────────────────────────────────────
create table if not exists public.haul_runs (
  id            bigint generated always as identity primary key,
  job_id        uuid not null,               -- NOT a FK: history outlives jobs
  driver_id     uuid not null,
  driver_name   text,
  corp_id       uuid,                        -- null = freelance
  shipper_id    uuid not null,
  outcome       text not null check (outcome in ('delivered','failed')),
  distance_km   numeric not null,
  time_s        integer not null default 0,
  par_s         integer not null default 0,  -- what a clean run should take
  crashes_car   integer not null default 0,
  crashes_rail  integer not null default 0,
  cargo_pct     numeric not null default 0,
  fare          bigint  not null default 0,  -- what the shipper escrowed
  fare_paid     bigint  not null default 0,  -- what the shipper was charged
  wage_pct      numeric not null default 0,  -- driver's contracted share
  wage_gross    bigint  not null default 0,  -- the share before penalties
  penalty       bigint  not null default 0,  -- what crashes cost the driver
  driver_pay    bigint  not null default 0,  -- what actually reached them
  company_net   bigint  not null default 0,  -- what reached the treasury
  created_at    timestamptz not null default now()
);
create index if not exists haul_runs_driver_idx on public.haul_runs (driver_id, created_at desc);
create index if not exists haul_runs_corp_idx   on public.haul_runs (corp_id, created_at desc);

-- ── 3. COMPANIES + 4. WAGES ────────────────────────────────────────────────
-- Percentages are stored as 0..100, the way the owner types them.
create table if not exists public.haul_companies (
  corp_id          uuid primary key references public.corporations(id) on delete cascade,
  wage_pct         numeric not null default 35 check (wage_pct >= 0 and wage_pct <= 100),
  car_penalty_pct  numeric not null default 6  check (car_penalty_pct >= 0 and car_penalty_pct <= 100),
  rail_penalty_pct numeric not null default 3  check (rail_penalty_pct >= 0 and rail_penalty_pct <= 100),
  max_penalty_pct  numeric not null default 80 check (max_penalty_pct >= 0 and max_penalty_pct <= 100),
  updated_by       uuid,
  updated_at       timestamptz not null default now()
);
create table if not exists public.haul_wages (
  corp_id    uuid not null references public.corporations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  wage_pct   numeric not null check (wage_pct >= 0 and wage_pct <= 100),
  set_by     uuid,
  updated_at timestamptz not null default now(),
  primary key (corp_id, user_id)
);

-- ── RLS ────────────────────────────────────────────────────────────────────
-- 🔒 Review every line. RLS is the entire security boundary.
alter table public.haul_jobs      enable row level security;
alter table public.haul_runs      enable row level security;
alter table public.haul_companies enable row level security;
alter table public.haul_wages     enable row level security;

-- Jobs: the open board is public; a party to a job always sees it.
drop policy if exists hj_sel on public.haul_jobs;
create policy hj_sel on public.haul_jobs for select to authenticated
  using (status = 'open' or shipper_id = auth.uid() or recipient_id = auth.uid() or driver_id = auth.uid());
-- No INSERT/UPDATE/DELETE policy: the RPCs are the only writers. A direct
-- insert would let a client post a job with a fare it never paid.

-- Runs: readable by everyone signed in — the driver rank is a public figure
-- and an owner must be able to read a prospective hire's record. Writable by
-- nobody but the RPC.
drop policy if exists hr_sel on public.haul_runs;
create policy hr_sel on public.haul_runs for select to authenticated using (true);

-- Companies: everyone reads (a driver must see the wage before taking a job);
-- only the founder of THAT corp writes, and cannot re-key the row.
drop policy if exists hc_sel on public.haul_companies;
create policy hc_sel on public.haul_companies for select to authenticated using (true);
drop policy if exists hc_ins on public.haul_companies;
create policy hc_ins on public.haul_companies for insert to authenticated
  with check (exists (select 1 from public.corporations c where c.id = haul_companies.corp_id and c.founder_id = auth.uid()));
drop policy if exists hc_upd on public.haul_companies;
create policy hc_upd on public.haul_companies for update to authenticated
  using  (exists (select 1 from public.corporations c where c.id = haul_companies.corp_id and c.founder_id = auth.uid()))
  with check (exists (select 1 from public.corporations c where c.id = haul_companies.corp_id and c.founder_id = auth.uid()));

-- Wages: the driver and the founder read; only the founder writes.
drop policy if exists hw_sel on public.haul_wages;
create policy hw_sel on public.haul_wages for select to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.corporations c where c.id = haul_wages.corp_id and c.founder_id = auth.uid()));
drop policy if exists hw_ins on public.haul_wages;
create policy hw_ins on public.haul_wages for insert to authenticated
  with check (exists (select 1 from public.corporations c where c.id = haul_wages.corp_id and c.founder_id = auth.uid()));
drop policy if exists hw_upd on public.haul_wages;
create policy hw_upd on public.haul_wages for update to authenticated
  using  (exists (select 1 from public.corporations c where c.id = haul_wages.corp_id and c.founder_id = auth.uid()))
  with check (exists (select 1 from public.corporations c where c.id = haul_wages.corp_id and c.founder_id = auth.uid()));
drop policy if exists hw_del on public.haul_wages;
create policy hw_del on public.haul_wages for delete to authenticated
  using (exists (select 1 from public.corporations c where c.id = haul_wages.corp_id and c.founder_id = auth.uid()));

revoke insert, update, delete on public.haul_jobs from anon, authenticated;
revoke insert, update, delete on public.haul_runs from anon, authenticated;
grant select on public.haul_jobs      to authenticated;
grant select on public.haul_runs      to authenticated;
grant select, insert, update on public.haul_companies to authenticated;
grant select, insert, update, delete on public.haul_wages to authenticated;

commit;

-- ============================================================================
-- RPCs
-- ============================================================================

-- ── Wallet primitives (private; not granted to anyone) ─────────────────────
-- Mirrors of wallet_charge / wallet_credit (sql/023, 035) that take the user
-- as an argument so ONE transaction can move Cinder between three people.
-- Both wallet rows are written together and wallet_seq moves on every debit —
-- the invariant 023 exists to enforce. No hourly ceiling applies here: the
-- amount is bounded by an escrow the shipper already paid, not minted.
create or replace function public._haul_debit(p_uid uuid, p_amount bigint, p_reason text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_bal bigint;
begin
  if p_amount <= 0 then
    select coalesce(cinder,0) into v_bal from public.user_progress where user_id = p_uid;
    return coalesce(v_bal, 0);
  end if;
  insert into public.user_progress (user_id) values (p_uid) on conflict (user_id) do nothing;
  update public.user_progress g
     set cinder = g.cinder - p_amount, wallet_seq = g.wallet_seq + 1, updated_at = now()
   where g.user_id = p_uid and g.cinder >= p_amount
   returning g.cinder into v_bal;
  if v_bal is null then raise exception 'INSUFFICIENT'; end if;
  update public.user_profiles set gems = v_bal where user_id = p_uid and coalesce(gems, 0) > v_bal;
  begin
    insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason)
      values (p_uid, 'charge', 'cinder', -p_amount, v_bal, p_reason);
  exception when undefined_table or undefined_column then null; end;
  return v_bal;
end$$;
revoke all on function public._haul_debit(uuid, bigint, text) from public, anon, authenticated;

create or replace function public._haul_credit(p_uid uuid, p_amount bigint, p_reason text, p_ref text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_bal bigint;
begin
  if p_uid is null or p_amount <= 0 then return 0; end if;
  insert into public.user_progress (user_id) values (p_uid) on conflict (user_id) do nothing;
  update public.user_progress
     set cinder = coalesce(cinder, 0) + p_amount, updated_at = now()
   where user_id = p_uid
   returning cinder into v_bal;
  update public.user_profiles set gems = v_bal where user_id = p_uid and coalesce(gems, 0) < v_bal;
  begin
    insert into public.wallet_ledger (user_id, op, resource, delta, balance_after, reason, ref)
      values (p_uid, 'credit', 'cinder', p_amount, coalesce(v_bal, 0), p_reason, p_ref);
  exception
    when unique_violation then null;
    when undefined_table or undefined_column then null;
  end;
  return coalesce(v_bal, 0);
end$$;
revoke all on function public._haul_credit(uuid, bigint, text, text) from public, anon, authenticated;

-- The company a driver drives for: their corp, IF that corp runs a transport
-- operation. A corp without one is not a transport business and its members
-- haul as freelancers. Returns null for freelance.
create or replace function public._haul_company_of(p_uid uuid)
returns uuid language sql security definer set search_path = public stable as $$
  select m.corp_id from public.corp_members m
   where m.user_id = p_uid
     and exists (select 1 from public.corp_operations o
                  where o.corp_id = m.corp_id and o.op_type = 'transport' and o.status <> 'closed')
   limit 1
$$;
revoke all on function public._haul_company_of(uuid) from public, anon, authenticated;

-- ── POST a shipment. Debits the shipper's fare into escrow. ────────────────
create or replace function public.haul_post_job(
  p_from_node text, p_from_name text, p_to_node text, p_to_name text,
  p_resource text, p_qty integer, p_distance_km numeric, p_fare bigint,
  p_recipient uuid default null, p_shipper_name text default null
) returns public.haul_jobs
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n integer; j public.haul_jobs;
begin
  if me is null then raise exception 'NOT_SIGNED_IN'; end if;
  if p_from_node is null or p_to_node is null or p_from_node = p_to_node then raise exception 'BAD_ROUTE'; end if;
  if p_resource is null or length(p_resource) = 0 or length(p_resource) > 40 then raise exception 'BAD_RESOURCE'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 99999 then raise exception 'BAD_QTY'; end if;
  if p_distance_km is null or p_distance_km <= 0 or p_distance_km > 99999 then raise exception 'BAD_DISTANCE'; end if;
  if p_fare is null or p_fare < 1 or p_fare > 50000000 then raise exception 'BAD_FARE'; end if;
  select count(*) into n from public.haul_jobs where shipper_id = me and status in ('open','claimed');
  if n >= 10 then raise exception 'TOO_MANY_JOBS'; end if;
  select count(*) into n from public.haul_jobs where shipper_id = me and created_at > now() - interval '3 seconds';
  if n > 0 then raise exception 'TOO_FAST'; end if;

  perform public._haul_debit(me, p_fare, 'Highway Haul fare (escrow)');

  insert into public.haul_jobs
    (shipper_id, shipper_name, recipient_id, from_node, from_name, to_node, to_name,
     resource, qty, distance_km, fare, status)
  values
    (me, left(coalesce(p_shipper_name,'Survivor'), 40), coalesce(p_recipient, me),
     p_from_node, left(coalesce(p_from_name, p_from_node), 60), p_to_node, left(coalesce(p_to_name, p_to_node), 60),
     p_resource, p_qty, p_distance_km, p_fare, 'open')
  returning * into j;
  return j;
end$;
revoke all on function public.haul_post_job(text,text,text,text,text,integer,numeric,bigint,uuid,text) from public, anon;
grant execute on function public.haul_post_job(text,text,text,text,text,integer,numeric,bigint,uuid,text) to authenticated;

-- ── CANCEL an open job. Refunds the escrow; the goods come back client-side
--    (the client refunds its stash when this returns ok).
create or replace function public.haul_cancel_job(p_job_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); j public.haul_jobs;
begin
  if me is null then raise exception 'NOT_SIGNED_IN'; end if;
  select * into j from public.haul_jobs where id = p_job_id for update;
  if not found or j.shipper_id <> me then return false; end if;
  if j.status <> 'open' then return false; end if;
  update public.haul_jobs set status = 'cancelled' where id = j.id;
  perform public._haul_credit(me, j.fare, 'Highway Haul fare refunded', 'haul_cancel_' || j.id::text);
  return true;
end$$;
revoke all on function public.haul_cancel_job(uuid) from public, anon;
grant execute on function public.haul_cancel_job(uuid) to authenticated;

-- ── CLAIM a job (the driver takes the wheel). A stale claim (30 min without a
--    delivery) is re-claimable by anyone, so an abandoned tab never strands a
--    shipment. A driver may hold one live claim at a time.
create or replace function public.haul_claim_job(p_job_id uuid, p_driver_name text default null)
returns public.haul_jobs language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); j public.haul_jobs; n integer;
begin
  if me is null then raise exception 'NOT_SIGNED_IN'; end if;
  select * into j from public.haul_jobs where id = p_job_id for update;
  if not found then raise exception 'NO_SUCH_JOB'; end if;
  if j.shipper_id = me then raise exception 'OWN_JOB'; end if;
  if not (j.status = 'open' or (j.status = 'claimed' and j.claimed_at < now() - interval '30 minutes')) then
    raise exception 'ALREADY_CLAIMED';
  end if;
  select count(*) into n from public.haul_jobs
   where driver_id = me and status = 'claimed' and claimed_at >= now() - interval '30 minutes' and id <> j.id;
  if n > 0 then raise exception 'HOLDING_A_JOB'; end if;
  update public.haul_jobs
     set status = 'claimed', driver_id = me, driver_name = left(coalesce(p_driver_name,'Driver'), 40),
         corp_id = public._haul_company_of(me), claimed_at = now()
   where id = j.id
   returning * into j;
  return j;
end$$;
revoke all on function public.haul_claim_job(uuid, text) from public, anon;
grant execute on function public.haul_claim_job(uuid, text) to authenticated;

-- ── COMPLETE a run. THE settlement. ────────────────────────────────────────
-- Inputs are the run outcome. The server computes every Cinder figure from
-- the escrow + the company's stored wage/penalty terms; the client never
-- names a payout.
--
--   fare_paid   = fare × cargo_pct            (the shipper pays for what arrived;
--                                              the rest is refunded to them)
--   wage_gross  = fare_paid × wage_pct        (the driver's contracted cut)
--   penalty     = wage_gross × min(max, car×crashes_car + rail×crashes_rail)
--   driver_pay  = wage_gross − penalty
--   company_net = fare_paid − driver_pay      → corp_treasury (append-only)
--
-- Freelance (no company): wage_pct is 100, and the penalty is BURNED.
-- cargo_pct = 0 is a FAILED run: the shipper is refunded in full, the job
-- reopens for another driver, and the failure goes on the driver's record.
create or replace function public.haul_complete(
  p_job_id uuid, p_crashes_car integer, p_crashes_rail integer,
  p_time_s integer, p_par_s integer, p_cargo_pct numeric
) returns public.haul_runs
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); j public.haul_jobs; c public.haul_companies; r public.haul_runs;
  v_cargo numeric; v_wage_pct numeric; v_pen_pct numeric;
  v_paid bigint; v_gross bigint; v_pen bigint; v_driver bigint; v_company bigint; v_refund bigint;
  v_car int := greatest(0, least(coalesce(p_crashes_car,0), 999));
  v_rail int := greatest(0, least(coalesce(p_crashes_rail,0), 999));
begin
  if me is null then raise exception 'NOT_SIGNED_IN'; end if;
  select * into j from public.haul_jobs where id = p_job_id for update;
  if not found then raise exception 'NO_SUCH_JOB'; end if;
  if j.status <> 'claimed' or j.driver_id <> me then raise exception 'NOT_YOUR_RUN'; end if;

  v_cargo := greatest(0, least(coalesce(p_cargo_pct, 0), 1));

  -- ── FAILED: nothing is paid, the shipment goes back on the board.
  if v_cargo <= 0 then
    update public.haul_jobs set status = 'open', driver_id = null, driver_name = null, corp_id = null, claimed_at = null
     where id = j.id;
    insert into public.haul_runs (job_id, driver_id, driver_name, corp_id, shipper_id, outcome, distance_km, time_s, par_s,
                                  crashes_car, crashes_rail, cargo_pct, fare)
    values (j.id, me, j.driver_name, j.corp_id, j.shipper_id, 'failed', j.distance_km, greatest(0, coalesce(p_time_s,0)),
            greatest(0, coalesce(p_par_s,0)), v_car, v_rail, 0, j.fare)
    returning * into r;
    return r;
  end if;

  -- ── Terms. A company's stored terms, or the freelance terms.
  if j.corp_id is not null then
    select * into c from public.haul_companies where corp_id = j.corp_id;
    v_wage_pct := coalesce((select w.wage_pct from public.haul_wages w where w.corp_id = j.corp_id and w.user_id = me),
                           c.wage_pct, 35);
    v_pen_pct  := least(coalesce(c.max_penalty_pct, 80),
                        v_car * coalesce(c.car_penalty_pct, 6) + v_rail * coalesce(c.rail_penalty_pct, 3));
  else
    v_wage_pct := 100;
    v_pen_pct  := least(80, v_car * 6 + v_rail * 3);
  end if;

  v_paid    := floor(j.fare * v_cargo);
  v_refund  := j.fare - v_paid;
  v_gross   := floor(v_paid * v_wage_pct / 100);
  v_pen     := floor(v_gross * v_pen_pct / 100);
  v_driver  := greatest(0, v_gross - v_pen);
  v_company := case when j.corp_id is null then 0 else greatest(0, v_paid - v_driver) end;
  -- Belt and braces: never pay out more than was escrowed.
  if v_driver + v_company + v_refund > j.fare then raise exception 'PAYOUT_EXCEEDS_ESCROW'; end if;

  update public.haul_jobs
     set status = 'delivered', delivered_at = now(), cargo_pct = v_cargo
   where id = j.id;

  perform public._haul_credit(me, v_driver, 'Highway Haul: ' || j.from_name || ' → ' || j.to_name, 'haul_pay_' || j.id::text);
  perform public._haul_credit(j.shipper_id, v_refund, 'Highway Haul: damaged cargo refund', 'haul_refund_' || j.id::text);
  if j.corp_id is not null and v_company > 0 then
    insert into public.corp_treasury (corp_id, user_id, amount, kind, note)
    values (j.corp_id, me, v_company, 'haul', 'Haul ' || j.from_name || ' → ' || j.to_name || ' by ' || coalesce(j.driver_name,'driver'));
  end if;

  insert into public.haul_runs (job_id, driver_id, driver_name, corp_id, shipper_id, outcome, distance_km, time_s, par_s,
                                crashes_car, crashes_rail, cargo_pct, fare, fare_paid, wage_pct, wage_gross, penalty,
                                driver_pay, company_net)
  values (j.id, me, j.driver_name, j.corp_id, j.shipper_id, 'delivered', j.distance_km, greatest(0, coalesce(p_time_s,0)),
          greatest(0, coalesce(p_par_s,0)), v_car, v_rail, v_cargo, j.fare, v_paid, v_wage_pct, v_gross, v_pen,
          v_driver, v_company)
  returning * into r;
  return r;
end$$;
revoke all on function public.haul_complete(uuid,integer,integer,integer,integer,numeric) from public, anon;
grant execute on function public.haul_complete(uuid,integer,integer,integer,integer,numeric) to authenticated;

-- ── COLLECT the goods at the destination. The insert-is-the-lock pattern of
--    sql/019: the UPDATE only matches an unclaimed row, so the recipient's
--    stash is credited exactly once. Returns the units that arrived.
create or replace function public.haul_claim_goods(p_job_id uuid)
returns table (resource text, units integer) language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); j public.haul_jobs;
begin
  if me is null then raise exception 'NOT_SIGNED_IN'; end if;
  update public.haul_jobs h set goods_claimed_at = now()
   where h.id = p_job_id and h.recipient_id = me and h.status = 'delivered' and h.goods_claimed_at is null
   returning * into j;
  if not found then return; end if;
  return query select j.resource, greatest(0, floor(j.qty * coalesce(j.cargo_pct, 0)))::integer;
end$$;
revoke all on function public.haul_claim_goods(uuid) from public, anon;
grant execute on function public.haul_claim_goods(uuid) to authenticated;

-- ── DRIVER BOARD: the aggregate behind the driver rank. security_invoker so
--    it reads exactly what hr_sel lets the caller read.
drop view if exists public.haul_driver_board;
create view public.haul_driver_board with (security_invoker = true) as
  select driver_id,
         max(driver_name)                                        as driver_name,
         count(*)                                                as runs,
         count(*) filter (where outcome = 'delivered')           as delivered,
         coalesce(sum(distance_km), 0)                           as km,
         coalesce(sum(crashes_car), 0)                           as crashes_car,
         coalesce(sum(crashes_rail), 0)                          as crashes_rail,
         coalesce(avg(cargo_pct) filter (where outcome = 'delivered'), 0) as cargo_avg,
         coalesce(avg(case when par_s > 0 then least(2.0, time_s::numeric / par_s) else 1 end)
                  filter (where outcome = 'delivered'), 1)      as time_ratio,
         coalesce(sum(driver_pay), 0)                            as earned,
         coalesce(sum(company_net), 0)                           as company_net,
         coalesce(sum(fare_paid), 0)                             as fare_paid,
         max(created_at)                                         as last_run
    from public.haul_runs
   group by driver_id;
grant select on public.haul_driver_board to authenticated;

-- ============================================================================
-- VERIFY
-- ============================================================================
select 'tables' as what, count(*) as n from information_schema.tables
 where table_schema = 'public' and table_name in ('haul_jobs','haul_runs','haul_companies','haul_wages')
union all
select 'policies', count(*) from pg_policies
 where schemaname = 'public' and tablename in ('haul_jobs','haul_runs','haul_companies','haul_wages')
union all
select 'rpcs', count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('haul_post_job','haul_cancel_job','haul_claim_job','haul_complete','haul_claim_goods');
-- expect: tables 4 · policies 10 · rpcs 5
