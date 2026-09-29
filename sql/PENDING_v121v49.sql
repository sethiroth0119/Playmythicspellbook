-- ============================================================
-- PENDING for v121v49 — paste the whole file into the SQL editor.
-- 1) sql/116: get_my_ledger with ref (if not already applied)
-- 2) sql/117: player staff on operations with negotiated wages + payroll
-- ============================================================
-- 116 · The player-side wallet audit, made readable (v121v47).
--
-- Reported (PDF, "Employee Wages Not Reaching Employee Accounts"): a paid
-- player could not see WHY their balance moved — "no employee-side
-- transaction entry such as: Received wages from … +3,591".
--
-- Verified on the live database first: every corp pay / corp wage DOES land
-- (user_progress.cinder and user_profiles.gems both move, and wallet_ledger
-- carries a 'credit' row that names the payer). The missing piece was the
-- READER: the phone Ledger's "Server audit" tab and the Transaction History
-- modal both call get_my_ledger(), which bulletproof_saves.sql defines and
-- which was never applied here — so both screens have always said "not
-- installed". This file installs it, with the `ref` column added so the
-- client can tell a server-originated credit (corp pay, market sale, bank
-- withdraw on another device, held Cinder released — ref is null) from a
-- credit this device mirrored itself (ref set) and only announce the former.
--
-- Also: nothing wrong is being fixed in _ct_cinder_give — credits do not
-- bump wallet_seq on purpose (sql/023: only DEBITS move it; the client
-- adopts the higher server figure at seq level).

drop function if exists public.get_my_ledger(int);
create or replace function public.get_my_ledger(p_limit int default 100)
returns table(
  id            uuid,
  op            text,
  resource      text,
  delta         bigint,
  balance_after bigint,
  reason        text,
  meta          jsonb,
  ref           text,
  created_at    timestamptz
)
language sql security definer set search_path = public stable as $$
  select l.id, l.op, l.resource, l.delta, l.balance_after, l.reason, l.meta, l.ref, l.created_at
    from public.wallet_ledger l
   where l.user_id = auth.uid()
   order by l.created_at desc
   limit greatest(1, least(coalesce(p_limit, 100), 500))
$$;
revoke all on function public.get_my_ledger(int) from public, anon;
grant execute on function public.get_my_ledger(int) to authenticated;

-- verify
-- select proname from pg_proc where proname = 'get_my_ledger';

-- 117 · Player staff on corporation operations, with negotiated wages (v121v49).
--
-- Asked for: "make it where it is both players pay NPCs and players in corp,
-- and make it where players can negotiate how much they get paid so it won't
-- just be a flat amount."
--
-- Model: an operation keeps its NPC workers (corp_operations.workers, paid
-- as op_salary out of the treasury and gone — the existing sink). On top of
-- that, a corporation can put MEMBER PLAYERS on an operation at a wage per
-- hour that both sides agree to:
--   offer    — an officer (founder / CEO) names a wage for a member;
--   apply    — a member asks for a job at a wage;
--   counter  — either side answers with a different number;
--   accept   — the OTHER side's number becomes the wage → 'agreed';
--   end      — either side ends the job (owed wages are paid first).
-- Payroll: corp_staff_payroll(corp) pays every agreed row for the hours since
-- it was last paid (capped at 36 h, the same accrual cap as production), from
-- the treasury, straight into the member's wallet through _ct_cinder_give
-- (which writes the wallet_ledger row "Wages from <corp> — <op>"). A treasury
-- that cannot cover a row skips it; the hours keep accruing up to the cap.
-- Any member may trigger payroll; the timestamps make it idempotent.
-- Staffed players count as workers for production on the client (_opComputed).

create table if not exists public.corp_staff (
  id            uuid primary key default gen_random_uuid(),
  corp_id       uuid not null references public.corporations(id) on delete cascade,
  op_id         uuid not null references public.corp_operations(id) on delete cascade,
  user_id       uuid not null,
  user_name     text,
  offered_hr    bigint not null default 0,     -- the officer's number
  asked_hr      bigint,                        -- the member's number
  wage_hr       bigint not null default 0,     -- agreed
  status        text   not null default 'offered',   -- offered | countered | agreed | ended
  last_paid_at  timestamptz not null default now(),
  paid_total    bigint not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (op_id, user_id)
);
create index if not exists corp_staff_corp_idx on public.corp_staff (corp_id, status);
alter table public.corp_staff enable row level security;
drop policy if exists corp_staff_read on public.corp_staff;
create policy corp_staff_read on public.corp_staff for select to authenticated
  using (exists (select 1 from public.corp_members m where m.corp_id = corp_staff.corp_id and m.user_id = auth.uid()));
revoke insert, update, delete on public.corp_staff from authenticated, anon;
grant select on public.corp_staff to authenticated;

-- officer test, the same one corp_pay_member_from_treasury uses
create or replace function public._corp_is_officer(p_corp_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select true from public.corporations c where c.id = p_corp_id and c.founder_id = p_uid),
    (select true from public.corp_members m where m.corp_id = p_corp_id and m.user_id = p_uid
        and lower(coalesce(m.role,'')) in ('founder','owner','ceo')),
    false);
$$;
revoke all on function public._corp_is_officer(uuid, uuid) from public, anon;

create or replace function public.corp_staff_list(p_corp_id uuid)
returns setof public.corp_staff
language sql stable security definer set search_path = public as $$
  select s.* from public.corp_staff s
   where s.corp_id = p_corp_id and s.status <> 'ended'
     and exists (select 1 from public.corp_members m where m.corp_id = p_corp_id and m.user_id = auth.uid())
   order by s.created_at;
$$;
revoke all on function public.corp_staff_list(uuid) from public, anon;
grant execute on function public.corp_staff_list(uuid) to authenticated;

-- officer → member
create or replace function public.corp_staff_offer(p_corp_id uuid, p_op_id uuid, p_user_id uuid, p_wage_hr bigint, p_user_name text default null)
returns public.corp_staff
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_row public.corp_staff;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not public._corp_is_officer(p_corp_id, v_uid) then raise exception 'only the founder or a CEO can offer wages' using errcode = '42501'; end if;
  if p_wage_hr is null or p_wage_hr <= 0 then raise exception 'name a wage above zero' using errcode = '22023'; end if;
  if p_wage_hr > 100000 then raise exception 'a wage above 100,000 per hour is not allowed' using errcode = '22023'; end if;
  if p_user_id = v_uid then raise exception 'you cannot put yourself on payroll' using errcode = '22023'; end if;
  if not exists (select 1 from public.corp_members m where m.corp_id = p_corp_id and m.user_id = p_user_id) then
    raise exception 'they are not a member of that corporation' using errcode = '22023'; end if;
  if not exists (select 1 from public.corp_operations o where o.id = p_op_id and o.corp_id = p_corp_id) then
    raise exception 'that operation does not belong to this corporation' using errcode = '22023'; end if;
  insert into public.corp_staff (corp_id, op_id, user_id, user_name, offered_hr, status)
  values (p_corp_id, p_op_id, p_user_id, p_user_name, p_wage_hr, 'offered')
  on conflict (op_id, user_id) do update
     set offered_hr = excluded.offered_hr, user_name = coalesce(excluded.user_name, corp_staff.user_name),
         status = case when corp_staff.status = 'agreed' then 'agreed' else 'offered' end,
         updated_at = now()
  returning * into v_row;
  return v_row;
end $$;
revoke all on function public.corp_staff_offer(uuid, uuid, uuid, bigint, text) from public, anon;
grant execute on function public.corp_staff_offer(uuid, uuid, uuid, bigint, text) to authenticated;

-- member → officer
create or replace function public.corp_staff_apply(p_corp_id uuid, p_op_id uuid, p_wage_hr bigint, p_user_name text default null)
returns public.corp_staff
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_row public.corp_staff;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_wage_hr is null or p_wage_hr <= 0 then raise exception 'ask for a wage above zero' using errcode = '22023'; end if;
  if p_wage_hr > 100000 then raise exception 'a wage above 100,000 per hour is not allowed' using errcode = '22023'; end if;
  if not exists (select 1 from public.corp_members m where m.corp_id = p_corp_id and m.user_id = v_uid) then
    raise exception 'you are not a member of that corporation' using errcode = '42501'; end if;
  if not exists (select 1 from public.corp_operations o where o.id = p_op_id and o.corp_id = p_corp_id) then
    raise exception 'that operation does not belong to this corporation' using errcode = '22023'; end if;
  insert into public.corp_staff (corp_id, op_id, user_id, user_name, asked_hr, status)
  values (p_corp_id, p_op_id, v_uid, p_user_name, p_wage_hr, 'countered')
  on conflict (op_id, user_id) do update
     set asked_hr = excluded.asked_hr, user_name = coalesce(excluded.user_name, corp_staff.user_name),
         status = case when corp_staff.status = 'agreed' then 'agreed' else 'countered' end,
         updated_at = now()
  returning * into v_row;
  return v_row;
end $$;
revoke all on function public.corp_staff_apply(uuid, uuid, bigint, text) from public, anon;
grant execute on function public.corp_staff_apply(uuid, uuid, bigint, text) to authenticated;

-- either side answers with a number
create or replace function public.corp_staff_counter(p_id uuid, p_wage_hr bigint)
returns public.corp_staff
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_row public.corp_staff; v_officer boolean;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into v_row from public.corp_staff where id = p_id for update;
  if v_row.id is null then raise exception 'no such job' using errcode = 'P0002'; end if;
  if p_wage_hr is null or p_wage_hr <= 0 or p_wage_hr > 100000 then raise exception 'name a wage between 1 and 100,000 per hour' using errcode = '22023'; end if;
  v_officer := public._corp_is_officer(v_row.corp_id, v_uid);
  if v_row.user_id = v_uid then
    update public.corp_staff set asked_hr = p_wage_hr, status = case when status = 'agreed' then 'countered' else 'countered' end, updated_at = now() where id = p_id returning * into v_row;
  elsif v_officer then
    update public.corp_staff set offered_hr = p_wage_hr, status = 'offered', updated_at = now() where id = p_id returning * into v_row;
  else
    raise exception 'only the worker or an officer can negotiate this job' using errcode = '42501';
  end if;
  return v_row;
end $$;
revoke all on function public.corp_staff_counter(uuid, bigint) from public, anon;
grant execute on function public.corp_staff_counter(uuid, bigint) to authenticated;

-- the OTHER side's number becomes the wage
create or replace function public.corp_staff_accept(p_id uuid)
returns public.corp_staff
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_row public.corp_staff; v_wage bigint;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into v_row from public.corp_staff where id = p_id for update;
  if v_row.id is null then raise exception 'no such job' using errcode = 'P0002'; end if;
  if v_row.status = 'ended' then raise exception 'that job has ended' using errcode = '22023'; end if;
  if v_row.user_id = v_uid then
    if v_row.status <> 'offered' or coalesce(v_row.offered_hr, 0) <= 0 then raise exception 'there is no offer to accept yet' using errcode = '22023'; end if;
    v_wage := v_row.offered_hr;
  elsif public._corp_is_officer(v_row.corp_id, v_uid) then
    if v_row.status <> 'countered' or coalesce(v_row.asked_hr, 0) <= 0 then raise exception 'there is no ask to accept yet' using errcode = '22023'; end if;
    v_wage := v_row.asked_hr;
  else
    raise exception 'only the worker or an officer can accept this job' using errcode = '42501';
  end if;
  update public.corp_staff set wage_hr = v_wage, status = 'agreed', last_paid_at = now(), updated_at = now() where id = p_id returning * into v_row;
  return v_row;
end $$;
revoke all on function public.corp_staff_accept(uuid) from public, anon;
grant execute on function public.corp_staff_accept(uuid) to authenticated;

-- pays every agreed row of one corporation for the hours owed (36 h cap)
create or replace function public.corp_staff_payroll(p_corp_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_corp text; v_bal numeric; r record; v_hrs numeric; v_amt bigint; v_out jsonb := '[]'::jsonb; v_short bigint := 0;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not exists (select 1 from public.corp_members m where m.corp_id = p_corp_id and m.user_id = v_uid) then
    raise exception 'you are not a member of that corporation' using errcode = '42501'; end if;
  select name into v_corp from public.corporations where id = p_corp_id;
  perform 1 from public.corporations where id = p_corp_id for update;
  select coalesce(sum(amount), 0) into v_bal from public.corp_treasury where corp_id = p_corp_id;
  for r in
    select s.id, s.user_id, s.user_name, s.wage_hr, s.last_paid_at, o.op_type
      from public.corp_staff s join public.corp_operations o on o.id = s.op_id
     where s.corp_id = p_corp_id and s.status = 'agreed' and s.wage_hr > 0
     order by s.last_paid_at
       for update of s
  loop
    v_hrs := least(36, greatest(0, extract(epoch from (now() - r.last_paid_at)) / 3600.0));
    v_amt := floor(r.wage_hr * v_hrs);
    if v_amt < 1 then continue; end if;
    if v_bal < v_amt then v_short := v_short + v_amt; continue; end if;   -- keeps accruing, up to the cap
    insert into public.corp_treasury (corp_id, user_id, amount, kind, note)
    values (p_corp_id, r.user_id, -v_amt, 'staff_wage',
            coalesce(r.op_type, 'operation') || ' wages — ' || coalesce(r.user_name, 'a member') || ' (' || round(v_hrs, 1) || ' h @ ' || r.wage_hr || '/h)');
    perform public._ct_cinder_give(r.user_id, v_amt, 'Wages from ' || coalesce(v_corp, 'your corporation') || ' — ' || coalesce(r.op_type, 'operation'));
    insert into public.corp_transfers (corp_id, from_id, from_name, to_id, to_name, kind, item_id, name, icon, qty, note, status, settled_at)
    values (p_corp_id, v_uid, coalesce(v_corp, 'Corporation'), r.user_id, r.user_name, 'resource', 'cinder', 'Cinder', '🔥', v_amt,
            'Wages · ' || coalesce(r.op_type, 'operation'), 'claimed', now());
    update public.corp_staff set last_paid_at = now(), paid_total = paid_total + v_amt, updated_at = now() where id = r.id;
    v_bal := v_bal - v_amt;
    v_out := v_out || jsonb_build_object('user_id', r.user_id, 'user_name', r.user_name, 'op_type', r.op_type, 'amount', v_amt, 'hours', round(v_hrs, 1));
  end loop;
  return jsonb_build_object('ok', true, 'paid', v_out, 'treasury', floor(v_bal), 'short', v_short);
end $$;
revoke all on function public.corp_staff_payroll(uuid) from public, anon;
grant execute on function public.corp_staff_payroll(uuid) to authenticated;

-- either side ends the job; owed wages are paid first
create or replace function public.corp_staff_end(p_id uuid)
returns public.corp_staff
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_row public.corp_staff;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into v_row from public.corp_staff where id = p_id;
  if v_row.id is null then raise exception 'no such job' using errcode = 'P0002'; end if;
  if v_row.user_id <> v_uid and not public._corp_is_officer(v_row.corp_id, v_uid) then
    raise exception 'only the worker or an officer can end this job' using errcode = '42501'; end if;
  if v_row.status = 'agreed' then perform public.corp_staff_payroll(v_row.corp_id); end if;
  update public.corp_staff set status = 'ended', updated_at = now() where id = p_id returning * into v_row;
  return v_row;
end $$;
revoke all on function public.corp_staff_end(uuid) from public, anon;
grant execute on function public.corp_staff_end(uuid) to authenticated;

-- verify
-- select proname from pg_proc where proname like 'corp_staff%';
