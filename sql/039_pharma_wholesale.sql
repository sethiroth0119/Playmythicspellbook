-- ════════════════════════════════════════════════════════════════════════════
-- 039 — PHARMA WHOLESALE: lots of finished medicine one Medical Corporation
--       sells to another, hauled by a player-owned Transportation Company.
--
-- Apply BY HAND in the Supabase SQL editor for project ktsiasyjusesawtrwrjc,
-- AFTER 038 (it reuses owns_operation() and files into cure_payouts).
-- Idempotent and re-runnable. RLS ships in this file. Verify query at the end.
--
-- 🔴 THE FEATURE MUST WORK WITH NONE OF THIS APPLIED. /src/hospital/state.js
--    guards every call: with the table absent the Loading Dock reports the
--    board as offline, listing refuses (and un-escrows the units), and the
--    local counter is untouched. "Not applied" and "nobody is selling" look
--    the same, on purpose.
--
-- 🔴 WHAT CROSSES BETWEEN PLAYERS IS THE LOT AND THE MONEY. The shelf itself
--    stays on each player's profile: the seller ESCROWS the units off their
--    shelf when they list (local, immediate), the row here is the offer, and
--    the buyer's client adds the units to THEIR shelf when the haul lands.
--    Money moves the way cure haulage already does — a row in cure_payouts,
--    claimed by whoever owns the payee operation (sum(amount), append-only).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 0. the payout ledger learns a third role ────────────────────────────────
-- The buyer pays the SELLER's medical operation for the goods ('wholesale')
-- and the CARRIER for the drive ('carrier'). unique(shipment_id, role) makes
-- one lot one row per party, exactly like a cure waybill.
alter table public.cure_payouts drop constraint if exists cure_payouts_role_check;
alter table public.cure_payouts add constraint cure_payouts_role_check
  check (role in ('carrier', 'lab', 'wholesale'));

-- ── 1. lots ─────────────────────────────────────────────────────────────────
create table if not exists public.pharma_lots (
  id text primary key,                        -- the client's own id; 'lot_…'
  seller_id uuid not null references auth.users(id) on delete cascade,
  seller_name text,
  seller_op_id text not null,                 -- the seller's medical op (payee)
  product text not null,
  units int not null check (units > 0),
  quality numeric not null default 0 check (quality >= 0 and quality <= 1),
  ask numeric not null default 0 check (ask >= 0),   -- Cinder per unit, seller's price
  status text not null default 'listed' check (status in ('listed', 'sold', 'received', 'withdrawn')),
  buyer_id uuid references auth.users(id) on delete set null,
  buyer_name text,
  buyer_op_id text,                           -- the buyer's medical op (destination)
  carrier_op_id text,
  carrier_corp_id uuid references public.corporations(id) on delete set null,
  carrier_name text,
  fee numeric not null default 0,             -- the haul, paid by the buyer
  integrity numeric not null default 0,       -- cold chain, fixed at purchase
  arrives_at timestamptz,
  sold_at timestamptz,
  received_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists pharma_lots_board on public.pharma_lots (status, created_at desc);
create index if not exists pharma_lots_seller on public.pharma_lots (seller_id, status);
create index if not exists pharma_lots_buyer on public.pharma_lots (buyer_id, status);

alter table public.pharma_lots enable row level security;

-- 🔴 THE BOARD IS PUBLIC WHILE A LOT IS LISTED — that is what a market is —
--    and PRIVATE the moment it is not. A sold lot is the buyer's and the
--    seller's business; nobody else reads who bought what from whom.
drop policy if exists pl_sel on public.pharma_lots;
create policy pl_sel on public.pharma_lots for select to authenticated
  using (status = 'listed' or seller_id = auth.uid() or buyer_id = auth.uid());

-- Only a listed lot may be created, and only by its seller.
-- ⚠ seller_op_id is NOT checked with owns_operation() here, deliberately:
--   personally-funded operations ('local_…') are not corp_operations rows and
--   the helper cannot see them. A seller naming an op they do not own only
--   routes THEIR OWN payment to a stranger, which harms nobody but them; the
--   client refuses to list against a personal op anyway, because the payout
--   row it would produce is unclaimable (see settleWaybill's note in
--   /src/plague/state.js).
drop policy if exists pl_ins on public.pharma_lots;
create policy pl_ins on public.pharma_lots for insert to authenticated
  with check (seller_id = auth.uid() and status = 'listed');

-- The seller may touch their own lot (withdraw). WHAT they may change is the
-- trigger's job below; RLS only says who.
drop policy if exists pl_upd_seller on public.pharma_lots;
create policy pl_upd_seller on public.pharma_lots for update to authenticated
  using (seller_id = auth.uid())
  with check (seller_id = auth.uid());

-- 🔴 THE BUY IS AN UPDATE, and this policy is the whole market's integrity.
--    A buyer may claim a LISTED lot that is not their own, and the row they
--    write must name THEM as buyer and be 'sold'. Two buyers racing the same
--    lot: the client updates `where status = 'listed'`, so the second sees
--    zero rows affected and refunds itself (see buyLot in state.js).
drop policy if exists pl_upd_buy on public.pharma_lots;
create policy pl_upd_buy on public.pharma_lots for update to authenticated
  using (status = 'listed' and seller_id <> auth.uid())
  with check (buyer_id = auth.uid() and status = 'sold');

-- The buyer marks their own purchase received when the haul lands.
drop policy if exists pl_upd_recv on public.pharma_lots;
create policy pl_upd_recv on public.pharma_lots for update to authenticated
  using (buyer_id = auth.uid())
  with check (buyer_id = auth.uid());

-- 🔴 NO DELETE POLICY. A withdrawn lot is a record that an offer existed.

-- The state machine, enforced. RLS says WHO may update; this says WHAT may
-- change on each transition. Without it a buyer's claim could rewrite the
-- ask, or a seller could "withdraw" a lot that was already paid for.
create or replace function public.pharma_lots_lock()
returns trigger
language plpgsql
as $$
begin
  -- The offer itself never changes after listing.
  if new.product is distinct from old.product
     or new.units is distinct from old.units
     or new.quality is distinct from old.quality
     or new.ask is distinct from old.ask
     or new.seller_id is distinct from old.seller_id
     or new.seller_op_id is distinct from old.seller_op_id then
    raise exception 'pharma_lots: the offer is immutable once listed';
  end if;

  if old.status = 'listed' and new.status = 'sold' then
    if new.buyer_id is null or new.buyer_op_id is null or new.carrier_op_id is null or new.arrives_at is null then
      raise exception 'pharma_lots: a sale needs a buyer, a destination, a carrier and an arrival';
    end if;
    if new.buyer_id = old.seller_id then
      raise exception 'pharma_lots: a seller cannot buy their own lot';
    end if;
    return new;
  end if;

  if old.status = 'listed' and new.status = 'withdrawn' then
    if new.buyer_id is not null then
      raise exception 'pharma_lots: a withdrawal names no buyer';
    end if;
    return new;
  end if;

  if old.status = 'sold' and new.status = 'received' then
    -- Only the receipt stamp moves; the purchase is frozen.
    if new.buyer_id is distinct from old.buyer_id
       or new.buyer_op_id is distinct from old.buyer_op_id
       or new.carrier_op_id is distinct from old.carrier_op_id
       or new.fee is distinct from old.fee
       or new.integrity is distinct from old.integrity
       or new.arrives_at is distinct from old.arrives_at then
      raise exception 'pharma_lots: a sold lot cannot be re-negotiated on receipt';
    end if;
    return new;
  end if;

  if new.status = old.status and old.status = 'listed' then
    -- A no-op touch on a listed row (the client re-saving names) is harmless.
    return new;
  end if;

  raise exception 'pharma_lots: illegal transition % -> %', old.status, new.status;
end;
$$;
drop trigger if exists pharma_lots_lock_trg on public.pharma_lots;
create trigger pharma_lots_lock_trg
  before update on public.pharma_lots
  for each row execute function public.pharma_lots_lock();

-- ── verify ──────────────────────────────────────────────────────────────────
-- Expect: pharma_lots with 5 policies and rls_enabled true, and the widened
-- role check on cure_payouts. A `false` in rls_enabled is a data breach.
select 'pharma_lots' as object,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'pharma_lots') as policies,
       (select relrowsecurity from pg_class where oid = 'public.pharma_lots'::regclass) as rls_enabled
union all
select 'cure_payouts role check',
       (select count(*) from pg_constraint where conname = 'cure_payouts_role_check'
          and pg_get_constraintdef(oid) like '%wholesale%'),
       true;
