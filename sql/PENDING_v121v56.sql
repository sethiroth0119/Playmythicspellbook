-- ============================================================
-- PENDING for v121v56 — paste the whole file into the SQL editor.
-- 1) sql/116: get_my_ledger with ref (if not already applied)
-- 2) sql/117: player staff on operations with negotiated wages + payroll
-- 3) sql/118: nodes for sale with Hidn Studios escrow
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

-- 118 · Nodes for sale, with Hidn Studios escrow (v121v56).
--
-- Asked for: "a For Sale button that puts a For Sale sign on the node, lets
-- the owner set the price and write what the node comes with (real estate,
-- operations and more), shows the Cinder price and its worth in USD, and a
-- note that Hidn Studios holds all sales in escrow until payment has been
-- fully transferred between players and ownership."
--
-- One listing per node (the node id is the key). Only the node's owner
-- (tw_node_owners.user_id) can list or cancel. A purchase is ONE
-- transaction: the buyer's Cinder is taken into escrow (_ct_cinder_take,
-- ledger "held in escrow by Hidn Studios"), ownership moves to the buyer,
-- any active mayor contract on the node ends (the new owner appoints their
-- own), the seller's city on that node moves with it when the listing says
-- the city is included and the buyer has no city there yet, and only then
-- is the escrow released to the seller (_ct_cinder_give, ledger "escrow
-- released by Hidn Studios"). If any step fails the whole thing rolls back —
-- nobody is ever paid for a node they still own, and nobody ever pays for a
-- node they did not receive. node_sale_log keeps the escrow trail.

create table if not exists public.node_sales (
  node_id      text primary key,
  seller_id    uuid not null,
  seller_name  text,
  price        bigint not null check (price > 0 and price <= 2000000000),
  details      text,
  includes     jsonb not null default '{}'::jsonb,   -- {city, realEstate, operations, resources, mayor}
  status       text not null default 'listed',       -- listed | sold | cancelled
  buyer_id     uuid,
  buyer_name   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  sold_at      timestamptz
);
create table if not exists public.node_sale_log (
  id           uuid primary key default gen_random_uuid(),
  node_id      text not null,
  action       text not null,            -- listed | cancelled | escrow_held | ownership_moved | escrow_released
  actor_id     uuid,
  counterparty uuid,
  amount       bigint,
  note         text,
  created_at   timestamptz not null default now()
);
alter table public.node_sales enable row level security;
alter table public.node_sale_log enable row level security;
drop policy if exists node_sales_read on public.node_sales;
create policy node_sales_read on public.node_sales for select to authenticated using (true);
drop policy if exists node_sale_log_read on public.node_sale_log;
create policy node_sale_log_read on public.node_sale_log for select to authenticated
  using (actor_id = auth.uid() or counterparty = auth.uid() or public.is_admin());
revoke insert, update, delete on public.node_sales, public.node_sale_log from authenticated, anon;
grant select on public.node_sales, public.node_sale_log to authenticated;

-- the owner lists (or re-prices) their node
create or replace function public.node_sale_list(p_node_id text, p_price bigint, p_details text default null, p_includes jsonb default '{}'::jsonb, p_seller_name text default null)
returns public.node_sales
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_row public.node_sales;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_node_id is null or char_length(p_node_id) = 0 then raise exception 'no node' using errcode = '22023'; end if;
  if p_price is null or p_price <= 0 then raise exception 'set a price above zero' using errcode = '22023'; end if;
  if p_price > 2000000000 then raise exception 'that price is above the 2,000,000,000 🔥 ceiling' using errcode = '22023'; end if;
  if not exists (select 1 from public.tw_node_owners o where o.node_id = p_node_id and o.user_id = v_uid) then
    raise exception 'only the owner of this node can put it up for sale' using errcode = '42501'; end if;
  insert into public.node_sales (node_id, seller_id, seller_name, price, details, includes, status, buyer_id, buyer_name, updated_at, sold_at)
  values (p_node_id, v_uid, p_seller_name, p_price, left(coalesce(p_details, ''), 2000), coalesce(p_includes, '{}'::jsonb), 'listed', null, null, now(), null)
  on conflict (node_id) do update
     set seller_id = excluded.seller_id, seller_name = excluded.seller_name, price = excluded.price, details = excluded.details,
         includes = excluded.includes, status = 'listed', buyer_id = null, buyer_name = null, updated_at = now(), sold_at = null
  returning * into v_row;
  insert into public.node_sale_log (node_id, action, actor_id, amount, note) values (p_node_id, 'listed', v_uid, p_price, left(coalesce(p_details, ''), 200));
  return v_row;
end $$;
revoke all on function public.node_sale_list(text, bigint, text, jsonb, text) from public, anon;
grant execute on function public.node_sale_list(text, bigint, text, jsonb, text) to authenticated;

-- the owner (or an admin) takes the sign down
create or replace function public.node_sale_cancel(p_node_id text)
returns public.node_sales
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_row public.node_sales;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into v_row from public.node_sales where node_id = p_node_id for update;
  if v_row.node_id is null then raise exception 'this node is not for sale' using errcode = 'P0002'; end if;
  if v_row.status <> 'listed' then raise exception 'this listing is already closed' using errcode = '22023'; end if;
  if v_row.seller_id <> v_uid and not public.is_admin()
     and not exists (select 1 from public.tw_node_owners o where o.node_id = p_node_id and o.user_id = v_uid) then
    raise exception 'only the seller can cancel this listing' using errcode = '42501'; end if;
  update public.node_sales set status = 'cancelled', updated_at = now() where node_id = p_node_id returning * into v_row;
  insert into public.node_sale_log (node_id, action, actor_id) values (p_node_id, 'cancelled', v_uid);
  return v_row;
end $$;
revoke all on function public.node_sale_cancel(text) from public, anon;
grant execute on function public.node_sale_cancel(text) to authenticated;

-- the purchase: escrow in, ownership across, escrow out — one transaction
create or replace function public.node_sale_buy(p_node_id text, p_buyer_name text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_row public.node_sales; v_take jsonb; v_give jsonb; v_city_moved boolean := false; v_mayor_ended boolean := false;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into v_row from public.node_sales where node_id = p_node_id for update;
  if v_row.node_id is null or v_row.status <> 'listed' then raise exception 'this node is not for sale' using errcode = 'P0002'; end if;
  if v_row.seller_id = v_uid then raise exception 'you cannot buy your own node' using errcode = '22023'; end if;
  if not exists (select 1 from public.tw_node_owners o where o.node_id = p_node_id and o.user_id = v_row.seller_id) then
    update public.node_sales set status = 'cancelled', updated_at = now() where node_id = p_node_id;
    raise exception 'the seller no longer owns this node — the listing has been taken down' using errcode = '22023';
  end if;
  perform 1 from public.tw_node_owners where node_id = p_node_id for update;

  -- 1 · the buyer's Cinder goes into escrow (refuses if they cannot pay)
  v_take := public._ct_cinder_take(v_uid, v_row.price, 'Node purchase — ' || p_node_id || ' (held in escrow by Hidn Studios)');
  insert into public.node_sale_log (node_id, action, actor_id, counterparty, amount, note)
  values (p_node_id, 'escrow_held', v_uid, v_row.seller_id, v_row.price, 'Hidn Studios holds the payment until ownership has moved');

  -- 2 · ownership moves to the buyer
  update public.tw_node_owners set user_id = v_uid, display_name = coalesce(p_buyer_name, display_name), assigned_by = v_uid, updated_at = now()
   where node_id = p_node_id;
  insert into public.node_sale_log (node_id, action, actor_id, counterparty, note)
  values (p_node_id, 'ownership_moved', v_row.seller_id, v_uid, 'tw_node_owners now names the buyer');

  -- 3 · the old owner's mayor contract on this node ends; the new owner appoints their own
  begin
    update public.node_mayors set active = false, ended_at = now() where node_id = p_node_id and active = true;
    if found then v_mayor_ended := true; end if;
  exception when undefined_table then null; end;

  -- 4 · the city moves with the land when the listing says so and the buyer has none there yet
  begin
    if coalesce((v_row.includes->>'city')::boolean, false)
       and exists (select 1 from public.city_state c where c.user_id = v_row.seller_id and c.node_id = p_node_id)
       and not exists (select 1 from public.city_state c where c.user_id = v_uid and c.node_id = p_node_id) then
      update public.city_state set user_id = v_uid, mayor_id = null, mayor_name = null, updated_at = now()
       where user_id = v_row.seller_id and node_id = p_node_id;
      v_city_moved := true;
    end if;
  exception when undefined_table or undefined_column then null; end;

  -- 5 · escrow released to the seller
  v_give := public._ct_cinder_give(v_row.seller_id, v_row.price, 'Node sale — ' || p_node_id || ' (escrow released by Hidn Studios)');
  insert into public.node_sale_log (node_id, action, actor_id, counterparty, amount, note)
  values (p_node_id, 'escrow_released', v_row.seller_id, v_uid, v_row.price, 'payment and ownership both complete');

  update public.node_sales set status = 'sold', buyer_id = v_uid, buyer_name = p_buyer_name, sold_at = now(), updated_at = now() where node_id = p_node_id;
  return jsonb_build_object('ok', true, 'node_id', p_node_id, 'price', v_row.price, 'seller_id', v_row.seller_id,
                            'buyer_balance', (v_take->>'balance')::bigint, 'buyer_wallet_seq', (v_take->>'wallet_seq')::bigint,
                            'city_moved', v_city_moved, 'mayor_ended', v_mayor_ended);
end $$;
revoke all on function public.node_sale_buy(text, text) from public, anon;
grant execute on function public.node_sale_buy(text, text) to authenticated;

-- verify
-- select proname from pg_proc where proname like 'node_sale%';
