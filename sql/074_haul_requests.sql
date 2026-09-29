-- ════════════════════════════════════════════════════════════════════════════
-- 074 · HAUL REQUESTS — the contract board
--
-- ── WHY THIS IS A SEPARATE TABLE FROM sql/073 ──────────────────────────────
--
--   073's `transport_contracts` is a SHIPMENT RECORD, not a marketplace. Read
--   its own status check:  ('in_transit','delivered','lost','late')  — a row is
--   born in transit. There is no `open`, no `accepted`, and no bidding: it
--   describes freight that is ALREADY MOVING, written by a carrier who has
--   already decided to move it.
--
--   What was asked for is the step BEFORE that: a shipper posts "I need
--   supplies for my restaurant, budget 40,000, key level 2 or better", carriers
--   see it, one accepts, and only THEN does freight move. Bending 073's table
--   to hold both would mean a row whose `arrive_at` is meaningless for half its
--   life and a status check that lies about what the row is.
--
--   So: this table owns the OFFER. 073's owns the SHIPMENT. When a request is
--   accepted, `shipment_id` points at the 073 row that carries it, and the two
--   never disagree about which is which.
--
--   ⚠ 073 DOES NOT NEED TO BE APPLIED FIRST. `shipment_id` is a bare uuid with
--     no foreign key precisely so this board works on its own — the FK is added
--     in the commented block at the bottom once 073 is in.
--
-- ── THE ONE THING THAT MUST BE SERVER-SIDE ─────────────────────────────────
--
--   ACCEPTANCE. Two carriers pressing Accept on the same request is the same
--   double-claim bug as corp_vault and kitchen_convoy_claim, and the fix is the
--   same shape: a single UPDATE with the old status in its WHERE clause, so the
--   database decides the winner and the loser is told plainly. A client-side
--   "is it still open?" check cannot do this — it is a read and a write with a
--   gap in the middle, and the gap is the bug.
--
-- Idempotent. Safe to re-run. Ends with a verify block.
-- ════════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.haul_requests (
  id           uuid primary key default gen_random_uuid(),
  shipper_id   uuid not null references auth.users(id) on delete cascade,
  shipper_name text,
  from_node    text not null,
  to_node      text not null,
  need         text not null,                    -- 'supplies' | 'meds' | 'food' | 'storage' | …
  qty          integer not null check (qty > 0),
  budget       integer not null check (budget >= 0),
  key_min      integer not null default 0 check (key_min between 0 and 5),
  note         text,
  status       text not null default 'open'
                 check (status in ('open','accepted','delivered','cancelled','expired')),
  carrier_id   uuid references auth.users(id) on delete set null,
  carrier_name text,
  offered      integer,                          -- what the carrier charges; <= budget
  shipment_id  uuid,                             -- the 073 transport_contracts row, once moving
  accepted_at  timestamptz,
  delivered_at timestamptz,
  expires_at   timestamptz not null default (now() + interval '7 days'),
  created_at   timestamptz not null default now()
);

create index if not exists haul_req_open   on public.haul_requests (status, created_at desc);
create index if not exists haul_req_shipper on public.haul_requests (shipper_id, created_at desc);
create index if not exists haul_req_carrier on public.haul_requests (carrier_id, created_at desc);

-- ── HISTORY, because this project has lost rows twice ──────────────────────
-- Same reasoning as city_state_history and card_market_listings_history: a
-- board that can only be read in its current state cannot answer "what happened
-- to my contract", and that question always gets asked eventually.
create table if not exists public.haul_requests_history (
  hid        bigserial primary key,
  request_id uuid not null,
  status     text,
  carrier_id uuid,
  offered    integer,
  reason     text,
  at         timestamptz not null default now()
);

create or replace function public.haul_log()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.haul_requests_history (request_id, status, carrier_id, offered, reason)
  values (OLD.id, OLD.status, OLD.carrier_id, OLD.offered, TG_OP);
  if TG_OP = 'DELETE' then
    -- Nothing legitimately deletes a request; cancelling is a status.
    return null;
  end if;
  return NEW;
end;
$fn$;

drop trigger if exists haul_log_upd on public.haul_requests;
create trigger haul_log_upd before update on public.haul_requests
  for each row execute function public.haul_log();
drop trigger if exists haul_log_del on public.haul_requests;
create trigger haul_log_del before delete on public.haul_requests
  for each row execute function public.haul_log();

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.haul_requests enable row level security;
alter table public.haul_requests_history enable row level security;

-- Everyone signed in can SEE an open board — that is what makes it a market.
-- Your own rows stay visible to you at every status.
drop policy if exists haul_sel on public.haul_requests;
create policy haul_sel on public.haul_requests
  for select to authenticated
  using (status = 'open' or shipper_id = auth.uid() or carrier_id = auth.uid());

-- You may post only as yourself.
drop policy if exists haul_ins on public.haul_requests;
create policy haul_ins on public.haul_requests
  for insert to authenticated with check (shipper_id = auth.uid());

/* 🔴 NO UPDATE POLICY, ON PURPOSE. Every state change goes through an RPC
   below. A `for update using (true)` here would let any player rewrite any
   open contract — which is exactly the hole sql/067 had to close on
   card_market_listings after a player could edit somebody else's listing. */

drop policy if exists haul_hist_sel on public.haul_requests_history;
create policy haul_hist_sel on public.haul_requests_history
  for select to authenticated using (true);

-- ── POST ───────────────────────────────────────────────────────────────────
create or replace function public.haul_post(
  p_from text, p_to text, p_need text, p_qty int, p_budget int,
  p_key_min int default 0, p_note text default null)
returns public.haul_requests language plpgsql security definer set search_path = public as $fn$
declare r public.haul_requests;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if coalesce(p_qty,0) <= 0 then raise exception 'qty must be positive'; end if;
  if coalesce(p_budget,0) < 0 then raise exception 'budget cannot be negative'; end if;
  if coalesce(p_from,'') = '' or coalesce(p_to,'') = '' then raise exception 'both nodes are required'; end if;
  /* A cap on open requests per player. Without one, a board is a free
     denial-of-service: post ten thousand and no carrier can find anything. */
  if (select count(*) from public.haul_requests
       where shipper_id = auth.uid() and status = 'open') >= 25 then
    raise exception 'you already have 25 open requests — cancel one first';
  end if;
  insert into public.haul_requests
    (shipper_id, shipper_name, from_node, to_node, need, qty, budget, key_min, note)
  values
    (auth.uid(),
     coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'email', 'Operator'),
     p_from, p_to, p_need, p_qty, p_budget, greatest(0, least(5, coalesce(p_key_min,0))), p_note)
  returning * into r;
  return r;
end;
$fn$;

-- ── ACCEPT — the one that must be atomic ───────────────────────────────────
create or replace function public.haul_accept(p_id uuid, p_offer int)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare r public.haul_requests;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;

  select * into r from public.haul_requests where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'why', 'no such request'); end if;
  if r.shipper_id = auth.uid() then
    return jsonb_build_object('ok', false, 'why', 'you cannot haul your own freight');
  end if;
  if coalesce(p_offer, 0) > r.budget then
    return jsonb_build_object('ok', false, 'why', 'your price is over the budget');
  end if;

  /* 🔴 THE RACE IS DECIDED HERE, BY THE DATABASE. `and status = 'open'` in the
     WHERE is the whole guard: two carriers pressing Accept in the same second
     both reach this statement, exactly one UPDATE finds an open row, and the
     other updates nothing and is told so. A read-then-write in the client has a
     gap between the two halves, and the gap is the bug — the same one
     kitchen_convoy_claim and corp_vault had to close. */
  update public.haul_requests
     set status = 'accepted', carrier_id = auth.uid(), offered = greatest(0, coalesce(p_offer,0)),
         carrier_name = coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'email', 'Carrier'),
         accepted_at = now()
   where id = p_id and status = 'open'
   returning * into r;

  if not found then
    return jsonb_build_object('ok', false, 'why', 'another carrier took that contract first');
  end if;
  return jsonb_build_object('ok', true, 'request', to_jsonb(r));
end;
$fn$;

-- ── CANCEL (shipper) and MARK DELIVERED (carrier) ──────────────────────────
create or replace function public.haul_cancel(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare n int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.haul_requests set status = 'cancelled'
   where id = p_id and shipper_id = auth.uid() and status = 'open';
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n = 1,
    'why', case when n = 1 then null else 'not yours, or it is no longer open' end);
end;
$fn$;

create or replace function public.haul_delivered(p_id uuid, p_shipment uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare n int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.haul_requests
     set status = 'delivered', delivered_at = now(), shipment_id = coalesce(p_shipment, shipment_id)
   where id = p_id and carrier_id = auth.uid() and status = 'accepted';
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n = 1,
    'why', case when n = 1 then null else 'not your contract, or it is not accepted' end);
end;
$fn$;

-- ── THE BOARD ──────────────────────────────────────────────────────────────
-- One reader for the modal: open requests, newest first, excluding your own so
-- a carrier's list is only things they can actually take.
create or replace function public.haul_board(p_limit int default 50)
returns setof public.haul_requests language sql stable security definer set search_path = public as $fn$
  select * from public.haul_requests
   where status = 'open' and expires_at > now() and shipper_id <> auth.uid()
   order by created_at desc
   limit greatest(1, least(200, coalesce(p_limit, 50)));
$fn$;

-- Your own, both sides, any status.
create or replace function public.haul_mine()
returns setof public.haul_requests language sql stable security definer set search_path = public as $fn$
  select * from public.haul_requests
   where shipper_id = auth.uid() or carrier_id = auth.uid()
   order by created_at desc limit 200;
$fn$;

revoke all on function public.haul_post(text,text,text,int,int,int,text) from public, anon;
revoke all on function public.haul_accept(uuid,int)      from public, anon;
revoke all on function public.haul_cancel(uuid)          from public, anon;
revoke all on function public.haul_delivered(uuid,uuid)  from public, anon;
revoke all on function public.haul_board(int)            from public, anon;
revoke all on function public.haul_mine()                from public, anon;
grant execute on function public.haul_post(text,text,text,int,int,int,text) to authenticated;
grant execute on function public.haul_accept(uuid,int)      to authenticated;
grant execute on function public.haul_cancel(uuid)          to authenticated;
grant execute on function public.haul_delivered(uuid,uuid)  to authenticated;
grant execute on function public.haul_board(int)            to authenticated;
grant execute on function public.haul_mine()                to authenticated;

commit;

-- ── VERIFY — this prints its own pass table ────────────────────────────────
select 'haul_requests table'      as check, (to_regclass('public.haul_requests') is not null)::text as pass
union all
select 'history table',           (to_regclass('public.haul_requests_history') is not null)::text
union all
select 'RLS on',                  (select relrowsecurity::text from pg_class where relname='haul_requests')
union all
select 'NO update policy (RPC only)',
       ((select count(*) from pg_policy p join pg_class c on c.oid=p.polrelid
          where c.relname='haul_requests' and p.polcmd='w') = 0)::text
union all
select 'all six RPCs present',
       ((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname in
            ('haul_post','haul_accept','haul_cancel','haul_delivered','haul_board','haul_mine')) = 6)::text;

-- ── ONCE sql/073 IS APPLIED, tie the shipment link ─────────────────────────
--   alter table public.haul_requests
--     add constraint haul_shipment_fk
--     foreign key (shipment_id) references public.transport_contracts(id) on delete set null;
