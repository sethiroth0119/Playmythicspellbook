-- ============================================================================
-- 039_highway_haul_extras.sql — insurance, on-time bonus escrow, guards,
-- tolls, rig upgrades and route records for Highway Haul.
-- Idempotent. Re-runnable. RLS ships in this file. Ends with a verify query.
-- Apply AFTER sql/038, by hand, in the Supabase SQL editor.
--
-- ── WHAT THIS ADDS ──────────────────────────────────────────────────────────
--  1. haul_jobs gains: path (the node ids the route passes), insured +
--     premium, bonus (escrowed with the fare), guard_hired.
--  2. haul_runs gains: from_node/to_node (route records), bonus_paid,
--     toll_paid, guard, wrong_exits, weather.
--  3. haul_upgrades — per-driver rig upgrade levels, bought with Cinder.
--  4. RPCs: haul_post_job (new signature: insurance + bonus), haul_hire_guard,
--     haul_buy_upgrade, and haul_complete re-written to settle bonus, tolls
--     and record the extras. haul_claim_goods pays FULL quantity when insured.
--  5. haul_route_records view: best time per route.
--
-- ── THE MONEY, IN ONE PLACE ─────────────────────────────────────────────────
--   INSURANCE  premium = fare × insurePct, charged at post, NEVER paid out in
--              Cinder: an insured shipment's recipient collects the full
--              quantity of goods however much arrived. The premium is a sink
--              (like the Foundation Tax) — nobody can farm it.
--   BONUS      escrowed with the fare. Paid to the DRIVER in full (a tip, not
--              company revenue) when time ≤ par and cargo ≥ 90%; otherwise
--              refunded to the shipper. That is the "fee they get back".
--   GUARD      one per run, paid BEFORE the run: from the company treasury
--              (append-only negative row) when the driver drives for one,
--              from the driver's own wallet when freelance.
--   TOLLS      tollPct × fare per intermediate node on the path that another
--              player owns (tw_node_owners), paid to that owner out of the
--              COMPANY's side of the fare (or the freelancer's). The driver's
--              wage is computed first and is untouched by tolls.
--   ⚠ Rates mirror OPS_ECON.transport in index.html. Move both.
-- ============================================================================

begin;

alter table public.haul_jobs add column if not exists path        jsonb;
alter table public.haul_jobs add column if not exists insured     boolean not null default false;
alter table public.haul_jobs add column if not exists premium     bigint  not null default 0;
alter table public.haul_jobs add column if not exists bonus       bigint  not null default 0;
alter table public.haul_jobs add column if not exists guard_hired boolean not null default false;

alter table public.haul_runs add column if not exists from_node   text;
alter table public.haul_runs add column if not exists to_node     text;
alter table public.haul_runs add column if not exists bonus_paid  bigint  not null default 0;
alter table public.haul_runs add column if not exists toll_paid   bigint  not null default 0;
alter table public.haul_runs add column if not exists guard       boolean not null default false;
alter table public.haul_runs add column if not exists wrong_exits integer not null default 0;
alter table public.haul_runs add column if not exists weather     text;

create table if not exists public.haul_upgrades (
  user_id    uuid not null references auth.users(id) on delete cascade,
  upgrade    text not null check (upgrade in ('engine','brakes','bed')),
  level      integer not null default 0 check (level >= 0 and level <= 3),
  updated_at timestamptz not null default now(),
  primary key (user_id, upgrade)
);
alter table public.haul_upgrades enable row level security;
-- Everyone may read (an owner sizing up a driver's rig); only the RPC writes.
drop policy if exists hu_sel on public.haul_upgrades;
create policy hu_sel on public.haul_upgrades for select to authenticated using (true);
revoke insert, update, delete on public.haul_upgrades from anon, authenticated;
grant select on public.haul_upgrades to authenticated;

commit;

-- The rates. One function so every RPC below reads the same numbers.
create or replace function public._haul_rates()
returns jsonb language sql immutable as $$
  select '{"insurePct":12,"guardFee":350,"tollPct":3,"upgradeBase":4000,"bonusMinCargo":0.9}'::jsonb
$$;
revoke all on function public._haul_rates() from public, anon, authenticated;

-- ── POST, with insurance and a bonus ───────────────────────────────────────
drop function if exists public.haul_post_job(text,text,text,text,text,integer,numeric,bigint,uuid,text);
create or replace function public.haul_post_job(
  p_from_node text, p_from_name text, p_to_node text, p_to_name text,
  p_resource text, p_qty integer, p_distance_km numeric, p_fare bigint,
  p_recipient uuid default null, p_shipper_name text default null,
  p_path jsonb default null, p_insured boolean default false, p_bonus bigint default 0
) returns public.haul_jobs
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n integer; j public.haul_jobs; v_prem bigint := 0; v_bonus bigint := greatest(0, least(coalesce(p_bonus,0), 50000000));
begin
  if me is null then raise exception 'NOT_SIGNED_IN'; end if;
  if p_from_node is null or p_to_node is null or p_from_node = p_to_node then raise exception 'BAD_ROUTE'; end if;
  if p_resource is null or length(p_resource) = 0 or length(p_resource) > 40 then raise exception 'BAD_RESOURCE'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 99999 then raise exception 'BAD_QTY'; end if;
  if p_distance_km is null or p_distance_km <= 0 or p_distance_km > 99999 then raise exception 'BAD_DISTANCE'; end if;
  if p_fare is null or p_fare < 1 or p_fare > 50000000 then raise exception 'BAD_FARE'; end if;
  if p_path is not null and (jsonb_typeof(p_path) <> 'array' or jsonb_array_length(p_path) > 64) then raise exception 'BAD_PATH'; end if;
  select count(*) into n from public.haul_jobs where shipper_id = me and status in ('open','claimed');
  if n >= 10 then raise exception 'TOO_MANY_JOBS'; end if;
  select count(*) into n from public.haul_jobs where shipper_id = me and created_at > now() - interval '3 seconds';
  if n > 0 then raise exception 'TOO_FAST'; end if;
  if coalesce(p_insured,false) then v_prem := floor(p_fare * (public._haul_rates()->>'insurePct')::numeric / 100); end if;

  -- One debit for everything the shipper puts up: fare + bonus escrow + premium.
  perform public._haul_debit(me, p_fare + v_bonus + v_prem, 'Highway Haul fare (escrow)'
                             || case when v_bonus > 0 then ' + bonus' else '' end || case when v_prem > 0 then ' + insurance' else '' end);

  insert into public.haul_jobs
    (shipper_id, shipper_name, recipient_id, from_node, from_name, to_node, to_name,
     resource, qty, distance_km, fare, status, path, insured, premium, bonus)
  values
    (me, left(coalesce(p_shipper_name,'Survivor'), 40), coalesce(p_recipient, me),
     p_from_node, left(coalesce(p_from_name, p_from_node), 60), p_to_node, left(coalesce(p_to_name, p_to_node), 60),
     p_resource, p_qty, p_distance_km, p_fare, 'open', p_path, coalesce(p_insured,false), v_prem, v_bonus)
  returning * into j;
  return j;
end$$;
revoke all on function public.haul_post_job(text,text,text,text,text,integer,numeric,bigint,uuid,text,jsonb,boolean,bigint) from public, anon;
grant execute on function public.haul_post_job(text,text,text,text,text,integer,numeric,bigint,uuid,text,jsonb,boolean,bigint) to authenticated;

-- ── CANCEL refunds fare + bonus. The premium is NOT refunded: insurance was
--    bought for a shipment that existed, and a refundable premium is a free
--    option. Stated on the form.
create or replace function public.haul_cancel_job(p_job_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); j public.haul_jobs;
begin
  if me is null then raise exception 'NOT_SIGNED_IN'; end if;
  select * into j from public.haul_jobs where id = p_job_id for update;
  if not found or j.shipper_id <> me then return false; end if;
  if j.status <> 'open' then return false; end if;
  update public.haul_jobs set status = 'cancelled' where id = j.id;
  perform public._haul_credit(me, j.fare + coalesce(j.bonus,0), 'Highway Haul fare refunded', 'haul_cancel_' || j.id::text);
  return true;
end$$;

-- ── HIRE A GUARD for a claimed run. Once per job; the row remembers it.
create or replace function public.haul_hire_guard(p_job_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); j public.haul_jobs; v_fee bigint := (public._haul_rates()->>'guardFee')::bigint; v_bal bigint;
begin
  if me is null then raise exception 'NOT_SIGNED_IN'; end if;
  select * into j from public.haul_jobs where id = p_job_id for update;
  if not found or j.status <> 'claimed' or j.driver_id <> me then raise exception 'NOT_YOUR_RUN'; end if;
  if j.guard_hired then return true; end if;
  if j.corp_id is not null then
    -- The company pays. Treasury is append-only: the fee is a negative row,
    -- refused when the balance (sum of rows) cannot cover it.
    select coalesce(sum(amount),0) into v_bal from public.corp_treasury where corp_id = j.corp_id;
    if v_bal < v_fee then raise exception 'TREASURY_SHORT'; end if;
    insert into public.corp_treasury (corp_id, user_id, amount, kind, note)
    values (j.corp_id, me, -v_fee, 'haul_guard', 'Guard for haul ' || j.from_name || ' → ' || j.to_name);
  else
    perform public._haul_debit(me, v_fee, 'Highway Haul: guard hired');
  end if;
  update public.haul_jobs set guard_hired = true where id = j.id;
  return true;
end$$;
revoke all on function public.haul_hire_guard(uuid) from public, anon;
grant execute on function public.haul_hire_guard(uuid) to authenticated;

-- ── BUY A RIG UPGRADE. Next level only, priced by the server.
create or replace function public.haul_buy_upgrade(p_upgrade text)
returns integer language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v_lvl integer; v_price bigint;
begin
  if me is null then raise exception 'NOT_SIGNED_IN'; end if;
  if p_upgrade not in ('engine','brakes','bed') then raise exception 'BAD_UPGRADE'; end if;
  select level into v_lvl from public.haul_upgrades where user_id = me and upgrade = p_upgrade for update;
  v_lvl := coalesce(v_lvl, 0);
  if v_lvl >= 3 then return v_lvl; end if;
  v_price := round((public._haul_rates()->>'upgradeBase')::numeric * (v_lvl + 1) * case when p_upgrade = 'bed' then 1.25 else 1 end);
  perform public._haul_debit(me, v_price, 'Highway Haul: ' || p_upgrade || ' upgrade L' || (v_lvl + 1));
  insert into public.haul_upgrades (user_id, upgrade, level) values (me, p_upgrade, v_lvl + 1)
  on conflict (user_id, upgrade) do update set level = excluded.level, updated_at = now();
  return v_lvl + 1;
end$$;
revoke all on function public.haul_buy_upgrade(text) from public, anon;
grant execute on function public.haul_buy_upgrade(text) to authenticated;

-- ── COMPLETE, now settling bonus and tolls ─────────────────────────────────
drop function if exists public.haul_complete(uuid,integer,integer,integer,integer,numeric);
create or replace function public.haul_complete(
  p_job_id uuid, p_crashes_car integer, p_crashes_rail integer,
  p_time_s integer, p_par_s integer, p_cargo_pct numeric,
  p_wrong_exits integer default 0, p_weather text default null
) returns public.haul_runs
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); j public.haul_jobs; c public.haul_companies; r public.haul_runs;
  v_cargo numeric; v_wage_pct numeric; v_pen_pct numeric;
  v_paid bigint; v_gross bigint; v_pen bigint; v_driver bigint; v_company bigint; v_refund bigint;
  v_bonus bigint := 0; v_bonus_back bigint := 0; v_toll_each bigint; v_toll_total bigint := 0; v_owner uuid; v_node text; i integer;
  v_car int := greatest(0, least(coalesce(p_crashes_car,0), 999));
  v_rail int := greatest(0, least(coalesce(p_crashes_rail,0), 999));
begin
  if me is null then raise exception 'NOT_SIGNED_IN'; end if;
  select * into j from public.haul_jobs where id = p_job_id for update;
  if not found then raise exception 'NO_SUCH_JOB'; end if;
  if j.status <> 'claimed' or j.driver_id <> me then raise exception 'NOT_YOUR_RUN'; end if;
  v_cargo := greatest(0, least(coalesce(p_cargo_pct, 0), 1));

  if v_cargo <= 0 then
    update public.haul_jobs set status = 'open', driver_id = null, driver_name = null, corp_id = null, claimed_at = null
     where id = j.id;   -- guard_hired stays true: it was paid for; the next driver inherits it
    insert into public.haul_runs (job_id, driver_id, driver_name, corp_id, shipper_id, outcome, distance_km, time_s, par_s,
                                  crashes_car, crashes_rail, cargo_pct, fare, from_node, to_node, guard, wrong_exits, weather)
    values (j.id, me, j.driver_name, j.corp_id, j.shipper_id, 'failed', j.distance_km, greatest(0, coalesce(p_time_s,0)),
            greatest(0, coalesce(p_par_s,0)), v_car, v_rail, 0, j.fare, j.from_node, j.to_node, j.guard_hired, coalesce(p_wrong_exits,0), p_weather)
    returning * into r;
    return r;
  end if;

  if j.corp_id is not null then
    select * into c from public.haul_companies where corp_id = j.corp_id;
    v_wage_pct := coalesce((select w.wage_pct from public.haul_wages w where w.corp_id = j.corp_id and w.user_id = me), c.wage_pct, 35);
    v_pen_pct  := least(coalesce(c.max_penalty_pct, 80), v_car * coalesce(c.car_penalty_pct, 6) + v_rail * coalesce(c.rail_penalty_pct, 3));
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

  -- 🎁 The bonus: within par, ≥ 90% cargo → the driver; otherwise back to the shipper.
  if coalesce(j.bonus,0) > 0 then
    if coalesce(p_par_s,0) > 0 and coalesce(p_time_s,0) <= p_par_s and v_cargo >= (public._haul_rates()->>'bonusMinCargo')::numeric then v_bonus := j.bonus;
    else v_bonus_back := j.bonus; end if;
  end if;

  -- 💰 Tolls: intermediate path nodes owned by another player. Out of the
  --    company's side (freelancer's own take), never the driver's wage, and
  --    never more than that side holds.
  v_toll_each := floor(j.fare * (public._haul_rates()->>'tollPct')::numeric / 100);
  if j.path is not null and jsonb_typeof(j.path) = 'array' and v_toll_each > 0 then
    begin
      for i in 1 .. greatest(0, jsonb_array_length(j.path) - 2) loop
        v_node := j.path->>i;
        select user_id into v_owner from public.tw_node_owners where node_id = v_node;
        if v_owner is not null and v_owner <> me and v_owner <> j.shipper_id then
          if j.corp_id is null then
            if v_driver - v_toll_total >= v_toll_each then v_toll_total := v_toll_total + v_toll_each; perform public._haul_credit(v_owner, v_toll_each, 'Highway Haul toll: ' || v_node, 'haul_toll_' || j.id::text || '_' || i); end if;
          else
            if v_company - v_toll_total >= v_toll_each then v_toll_total := v_toll_total + v_toll_each; perform public._haul_credit(v_owner, v_toll_each, 'Highway Haul toll: ' || v_node, 'haul_toll_' || j.id::text || '_' || i); end if;
          end if;
        end if;
      end loop;
    exception when undefined_table then v_toll_total := 0;
    end;
  end if;
  if j.corp_id is null then v_driver := v_driver - v_toll_total; else v_company := v_company - v_toll_total; end if;

  if v_driver + v_company + v_refund + v_toll_total + v_bonus + v_bonus_back > j.fare + coalesce(j.bonus,0) then raise exception 'PAYOUT_EXCEEDS_ESCROW'; end if;

  update public.haul_jobs set status = 'delivered', delivered_at = now(), cargo_pct = v_cargo where id = j.id;

  perform public._haul_credit(me, v_driver + v_bonus, 'Highway Haul: ' || j.from_name || ' → ' || j.to_name || case when v_bonus > 0 then ' (+bonus)' else '' end, 'haul_pay_' || j.id::text);
  perform public._haul_credit(j.shipper_id, v_refund + v_bonus_back, 'Highway Haul: refund', 'haul_refund_' || j.id::text);
  if j.corp_id is not null and v_company > 0 then
    insert into public.corp_treasury (corp_id, user_id, amount, kind, note)
    values (j.corp_id, me, v_company, 'haul', 'Haul ' || j.from_name || ' → ' || j.to_name || ' by ' || coalesce(j.driver_name,'driver'));
  end if;

  insert into public.haul_runs (job_id, driver_id, driver_name, corp_id, shipper_id, outcome, distance_km, time_s, par_s,
                                crashes_car, crashes_rail, cargo_pct, fare, fare_paid, wage_pct, wage_gross, penalty,
                                driver_pay, company_net, from_node, to_node, bonus_paid, toll_paid, guard, wrong_exits, weather)
  values (j.id, me, j.driver_name, j.corp_id, j.shipper_id, 'delivered', j.distance_km, greatest(0, coalesce(p_time_s,0)),
          greatest(0, coalesce(p_par_s,0)), v_car, v_rail, v_cargo, j.fare, v_paid, v_wage_pct, v_gross, v_pen,
          v_driver, v_company, j.from_node, j.to_node, v_bonus, v_toll_total, j.guard_hired, coalesce(p_wrong_exits,0), p_weather)
  returning * into r;
  return r;
end$$;
revoke all on function public.haul_complete(uuid,integer,integer,integer,integer,numeric,integer,text) from public, anon;
grant execute on function public.haul_complete(uuid,integer,integer,integer,integer,numeric,integer,text) to authenticated;

-- ── COLLECT: insured shipments hand over the full quantity.
create or replace function public.haul_claim_goods(p_job_id uuid)
returns table (resource text, units integer) language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); j public.haul_jobs;
begin
  if me is null then raise exception 'NOT_SIGNED_IN'; end if;
  update public.haul_jobs h set goods_claimed_at = now()
   where h.id = p_job_id and h.recipient_id = me and h.status = 'delivered' and h.goods_claimed_at is null
   returning * into j;
  if not found then return; end if;
  return query select j.resource, case when j.insured then j.qty else greatest(0, floor(j.qty * coalesce(j.cargo_pct, 0)))::integer end;
end$$;

-- ── ROUTE RECORDS: best clean-ish time per route.
drop view if exists public.haul_route_records;
create view public.haul_route_records with (security_invoker = true) as
  select distinct on (from_node, to_node) from_node, to_node, driver_id, driver_name, time_s, cargo_pct, created_at
    from public.haul_runs
   where outcome = 'delivered' and from_node is not null and cargo_pct >= 0.5
   order by from_node, to_node, time_s asc, created_at asc;
grant select on public.haul_route_records to authenticated;

-- ============================================================================
-- VERIFY
-- ============================================================================
select 'columns' as what, count(*) as n from information_schema.columns
 where table_schema = 'public' and table_name = 'haul_jobs' and column_name in ('path','insured','premium','bonus','guard_hired')
union all
select 'upgrades table', count(*) from information_schema.tables where table_schema = 'public' and table_name = 'haul_upgrades'
union all
select 'rpcs', count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('haul_hire_guard','haul_buy_upgrade','haul_complete','haul_post_job');
-- expect: columns 5 · upgrades table 1 · rpcs 4
