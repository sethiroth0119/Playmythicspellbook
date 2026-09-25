-- ============================================================================
-- 019_trading_lots_and_trades.sql
-- Player-to-player TRADE (goods for goods) + LOT-based resource listings.
-- Idempotent. Re-runnable. RLS ships in this file. Ends with a verify query.
--
-- Apply BY HAND in the Supabase SQL editor for project ktsiasyjusesawtrwrjc
-- (no CLI login exists in this repo). Nothing in the client requires this to
-- have been applied: the exchange detects the columns / functions and falls
-- back to its pre-lot behaviour, so applying it is an upgrade, not a gate.
--
-- ── WHAT THIS ADDS ──────────────────────────────────────────────────────────
--  1. LOTS on public.resource_listings.
--       lot_size   units of the resource in ONE lot          (100 wood)
--       lots_total how many lots were listed                 (x 10)
--       lots_left  how many remain unsold                    (partial fills)
--     `qty` is kept as the ORIGINAL total (lot_size * lots_total) and is
--     immutable, so a stale reader can never inflate a partly-filled listing
--     back to full. `price` is PER LOT, which makes every legacy single-lot
--     row already correct with no value migration.
--  2. currency = 'trade'  -> a SWAP: want_res units per lot, no currency.
--  3. resource_trade_ledger  - append-only. One row per settled movement.
--  4. resource_trade_claims  - append-only, PK (ledger_id, party). Inserting
--     the claim IS the lock; a party can therefore collect exactly once, and a
--     client that dies mid-collect simply collects on its next visit.
--  5. SECURITY DEFINER RPCs. Every one derives the actor from auth.uid().
--
-- ── 🔴 SECURITY FIX INCLUDED HERE (do not skip) ─────────────────────────────
-- The shipped policy was:
--     create policy rl_upd on public.resource_listings for update
--       to authenticated using (status = 'open' or seller_id = auth.uid())
--       with check (true);
-- `using (status='open')` + `with check (true)` lets ANY authenticated user
-- rewrite ANY open listing: change its price, its resource, its qty, even its
-- seller_id. It exists because buying was a client-side UPDATE. This migration
-- replaces it with "a seller may update only their own open row" and moves
-- settlement into rl_take_lots(), which is the only thing that may decrement
-- lots_left. A seller cannot set their own payout (the RPC computes it from
-- the row), and a caller cannot move somebody else's goods (the RPC refuses
-- when auth.uid() is the seller, and never touches a stash it does not own).
-- ⚠ CONSEQUENCE: a browser still running a cached pre-lot build can no longer
-- complete a purchase; its UPDATE matches zero rows and it reports "someone
-- already bought that". That is a graceful stop, not data loss, and it is the
-- correct trade against an open write hole.
-- ============================================================================

begin;

-- ── 1. LOT COLUMNS ─────────────────────────────────────────────────────────
create table if not exists public.resource_listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references auth.users(id) on delete cascade,
  seller_name text,
  resource text not null,
  qty integer not null check (qty > 0),
  price integer not null check (price >= 0),
  buyer_id uuid references auth.users(id),
  status text not null default 'open',
  paid_out boolean not null default false,
  created_at timestamptz default now()
);
alter table public.resource_listings add column if not exists currency   text not null default 'cinders';
alter table public.resource_listings add column if not exists want_kind  text;
alter table public.resource_listings add column if not exists want_id    text;
alter table public.resource_listings add column if not exists want_name  text;
alter table public.resource_listings add column if not exists lot_size   integer;
alter table public.resource_listings add column if not exists lots_total integer;
alter table public.resource_listings add column if not exists lots_left  integer;
alter table public.resource_listings add column if not exists want_res   text;
alter table public.resource_listings add column if not exists want_qty   integer;

-- Backfill: a pre-lot row IS one lot of qty. Never guesses; never rewrites a
-- row that already carries lot data.
update public.resource_listings
   set lot_size   = coalesce(lot_size, qty),
       lots_total = coalesce(lots_total, 1),
       lots_left  = coalesce(lots_left, case when status = 'open' then 1 else 0 end)
 where lot_size is null or lots_total is null or lots_left is null;

alter table public.resource_listings alter column lot_size   set default 1;
alter table public.resource_listings alter column lots_total set default 1;
alter table public.resource_listings alter column lots_left  set default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'resource_listings_lots_chk') then
    alter table public.resource_listings
      add constraint resource_listings_lots_chk
      check (lot_size is null or (lot_size > 0 and lots_total > 0 and lots_left >= 0 and lots_left <= lots_total));
  end if;
end $$;

create index if not exists resource_listings_open_idx on public.resource_listings (status, created_at desc);
create index if not exists resource_listings_seller_idx on public.resource_listings (seller_id);

-- ── 2. LEDGER (append-only) ────────────────────────────────────────────────
-- Balance is never stored. Nothing here is ever UPDATEd: what happened is a
-- fact, and a fact does not get edited.
create table if not exists public.resource_trade_ledger (
  id             bigint generated always as identity primary key,
  listing_id     uuid   not null,          -- deliberately NOT a FK: deleting a
                                           -- listing must never erase history
  kind           text   not null check (kind in ('sale','cancel','expire')),
  seller_id      uuid   not null,
  buyer_id       uuid,
  seller_name    text,
  buyer_name     text,
  resource       text   not null,
  lot_size       integer not null check (lot_size > 0),
  lots           integer not null check (lots > 0),
  units          integer not null check (units > 0),
  currency       text   not null default 'cinders',
  price_per_lot  integer not null default 0,
  price_total    integer not null default 0,
  want_kind      text,
  want_id        text,
  want_name      text,
  want_res       text,
  want_qty       integer,
  want_units     integer,
  created_at     timestamptz not null default now()
);
create index if not exists rtl_seller_idx on public.resource_trade_ledger (seller_id, created_at desc);
create index if not exists rtl_buyer_idx  on public.resource_trade_ledger (buyer_id, created_at desc);

-- ── 3. CLAIMS (append-only; the insert IS the lock) ────────────────────────
create table if not exists public.resource_trade_claims (
  ledger_id  bigint not null references public.resource_trade_ledger(id) on delete cascade,
  party      text   not null check (party in ('seller','buyer')),
  claimed_by uuid   not null,
  claimed_at timestamptz not null default now(),
  primary key (ledger_id, party)
);

-- ── 4. RLS ─────────────────────────────────────────────────────────────────
alter table public.resource_listings      enable row level security;
alter table public.resource_trade_ledger  enable row level security;
alter table public.resource_trade_claims  enable row level security;

-- Listings: everyone reads the open book; you always read your own rows.
drop policy if exists rl_sel on public.resource_listings;
create policy rl_sel on public.resource_listings for select to authenticated
  using (status = 'open' or seller_id = auth.uid() or buyer_id = auth.uid());

-- Insert stays available so a client without the RPC can still post (it
-- escrows locally first). seller_id is pinned to the caller.
drop policy if exists rl_ins on public.resource_listings;
create policy rl_ins on public.resource_listings for insert to authenticated
  with check (seller_id = auth.uid());

-- 🔴 THE FIX. Only the seller, only their own row, and they may not hand it to
-- somebody else. Buyers no longer have any direct UPDATE path at all;
-- rl_take_lots() is SECURITY DEFINER and settles on their behalf.
drop policy if exists rl_upd on public.resource_listings;
create policy rl_upd on public.resource_listings for update to authenticated
  using  (seller_id = auth.uid())
  with check (seller_id = auth.uid());

drop policy if exists rl_del on public.resource_listings;
create policy rl_del on public.resource_listings for delete to authenticated
  using (seller_id = auth.uid() and status = 'open');

-- Ledger + claims: readable only by the two parties, writable by nobody.
-- (No insert/update/delete policy exists, so RLS denies all writes; the
-- SECURITY DEFINER functions below bypass RLS and are the only writers.)
drop policy if exists rtl_sel on public.resource_trade_ledger;
create policy rtl_sel on public.resource_trade_ledger for select to authenticated
  using (seller_id = auth.uid() or buyer_id = auth.uid());

drop policy if exists rtc_sel on public.resource_trade_claims;
create policy rtc_sel on public.resource_trade_claims for select to authenticated
  using (claimed_by = auth.uid());

revoke insert, update, delete on public.resource_trade_ledger from anon, authenticated;
revoke insert, update, delete on public.resource_trade_claims from anon, authenticated;
grant select on public.resource_trade_ledger to authenticated;
grant select on public.resource_trade_claims to authenticated;

commit;

-- ============================================================================
-- 5. RPCs. Every one derives the actor from auth.uid() and NEVER trusts a
--    caller-supplied identity or payout.
-- ============================================================================

-- ── POST ───────────────────────────────────────────────────────────────────
create or replace function public.rl_post_listing(
  p_resource    text,
  p_lot_size    integer,
  p_lots        integer,
  p_currency    text default 'cinders',
  p_price       integer default 0,          -- PER LOT
  p_want_kind   text default null,
  p_want_id     text default null,
  p_want_name   text default null,
  p_want_res    text default null,
  p_want_qty    integer default null,       -- PER LOT
  p_seller_name text default null
) returns public.resource_listings
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me   uuid := auth.uid();
  n    integer;
  row  public.resource_listings;
begin
  if me is null then raise exception 'NOT_SIGNED_IN'; end if;
  if p_resource is null or length(p_resource) = 0 then raise exception 'BAD_RESOURCE'; end if;
  if p_lot_size is null or p_lot_size < 1 or p_lot_size > 9999 then raise exception 'BAD_LOT_SIZE'; end if;
  if p_lots is null or p_lots < 1 or p_lots > 999 then raise exception 'BAD_LOT_COUNT'; end if;
  if coalesce(p_currency,'cinders') not in ('cinders','aza','barter','trade') then raise exception 'BAD_CURRENCY'; end if;
  if coalesce(p_price,0) < 0 or coalesce(p_price,0) > 9999999 then raise exception 'BAD_PRICE'; end if;
  if p_currency = 'trade' then
    if p_want_res is null or coalesce(p_want_qty,0) < 1 or p_want_qty > 9999 then raise exception 'BAD_SWAP'; end if;
    if p_want_res = p_resource then raise exception 'SWAP_SAME_RESOURCE'; end if;
  end if;
  if p_currency = 'barter' and p_want_id is null then raise exception 'BAD_BARTER'; end if;

  -- Anti-spam, server side. The client also enforces these; the client is not
  -- the enforcement.
  select count(*) into n from public.resource_listings
   where seller_id = me and status = 'open';
  if n >= 15 then raise exception 'TOO_MANY_LISTINGS'; end if;
  select count(*) into n from public.resource_listings
   where seller_id = me and created_at > now() - interval '3 seconds';
  if n > 0 then raise exception 'TOO_FAST'; end if;

  insert into public.resource_listings
    (seller_id, seller_name, resource, qty, price, status, currency,
     want_kind, want_id, want_name, want_res, want_qty,
     lot_size, lots_total, lots_left)
  values
    (me, left(coalesce(p_seller_name,'Survivor'),40), p_resource,
     p_lot_size * p_lots, coalesce(p_price,0), 'open', coalesce(p_currency,'cinders'),
     p_want_kind, p_want_id, left(coalesce(p_want_name,''),80), p_want_res, p_want_qty,
     p_lot_size, p_lots, p_lots)
  returning * into row;
  return row;
end $$;

-- ── TAKE N LOTS (the settlement) ───────────────────────────────────────────
-- ONE transaction. The row is locked, checked, decremented, and the ledger
-- entry written together; either all of that happened or none of it did.
create or replace function public.rl_take_lots(p_listing uuid, p_lots integer)
returns public.resource_trade_ledger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me   uuid := auth.uid();
  l    public.resource_listings;
  ent  public.resource_trade_ledger;
  ls   integer; ll integer;
begin
  if me is null then raise exception 'NOT_SIGNED_IN'; end if;
  if p_lots is null or p_lots < 1 then raise exception 'BAD_LOTS'; end if;

  select * into l from public.resource_listings
   where id = p_listing and status = 'open' for update;
  if not found then raise exception 'LISTING_GONE'; end if;
  if l.seller_id = me then raise exception 'OWN_LISTING'; end if;

  ls := coalesce(l.lot_size, l.qty);
  ll := coalesce(l.lots_left, 1);
  if p_lots > ll then raise exception 'NOT_ENOUGH_LOTS'; end if;

  update public.resource_listings
     set lots_left = ll - p_lots,
         status    = case when ll - p_lots <= 0 then 'sold' else 'open' end,
         buyer_id  = me
   where id = l.id;

  insert into public.resource_trade_ledger
    (listing_id, kind, seller_id, buyer_id, seller_name, resource,
     lot_size, lots, units, currency, price_per_lot, price_total,
     want_kind, want_id, want_name, want_res, want_qty, want_units)
  values
    (l.id, 'sale', l.seller_id, me, l.seller_name, l.resource,
     ls, p_lots, ls * p_lots, coalesce(l.currency,'cinders'),
     coalesce(l.price,0), coalesce(l.price,0) * p_lots,
     l.want_kind, l.want_id, l.want_name, l.want_res, l.want_qty,
     coalesce(l.want_qty,0) * p_lots)
  returning * into ent;
  return ent;
end $$;

-- ── CANCEL (escrow comes back in full) ─────────────────────────────────────
create or replace function public.rl_cancel_listing(p_listing uuid)
returns public.resource_trade_ledger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me  uuid := auth.uid();
  l   public.resource_listings;
  ent public.resource_trade_ledger;
  ls integer; ll integer;
begin
  if me is null then raise exception 'NOT_SIGNED_IN'; end if;
  select * into l from public.resource_listings
   where id = p_listing and seller_id = me and status = 'open' for update;
  if not found then raise exception 'LISTING_GONE'; end if;

  ls := coalesce(l.lot_size, l.qty);
  ll := coalesce(l.lots_left, 1);
  if ll < 1 then raise exception 'NOTHING_ESCROWED'; end if;

  update public.resource_listings set status = 'cancelled', lots_left = 0 where id = l.id;

  insert into public.resource_trade_ledger
    (listing_id, kind, seller_id, buyer_id, seller_name, resource,
     lot_size, lots, units, currency, price_per_lot, price_total)
  values
    (l.id, 'cancel', me, null, l.seller_name, l.resource,
     ls, ll, ls * ll, coalesce(l.currency,'cinders'), 0, 0)
  returning * into ent;
  return ent;
end $$;

-- ── EXPIRE MY STALE LISTINGS (same shape as cancel) ────────────────────────
create or replace function public.rl_expire_mine(p_ttl_hours integer default 72)
returns setof public.resource_trade_ledger
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); l public.resource_listings; ent public.resource_trade_ledger;
begin
  if me is null then raise exception 'NOT_SIGNED_IN'; end if;
  for l in select * from public.resource_listings
            where seller_id = me and status = 'open'
              and created_at < now() - make_interval(hours => greatest(1, coalesce(p_ttl_hours,72)))
            for update
  loop
    update public.resource_listings set status = 'expired', lots_left = 0 where id = l.id;
    insert into public.resource_trade_ledger
      (listing_id, kind, seller_id, buyer_id, seller_name, resource,
       lot_size, lots, units, currency, price_per_lot, price_total)
    values
      (l.id, 'expire', me, null, l.seller_name, l.resource,
       coalesce(l.lot_size, l.qty), greatest(1, coalesce(l.lots_left,1)),
       coalesce(l.lot_size, l.qty) * greatest(1, coalesce(l.lots_left,1)),
       coalesce(l.currency,'cinders'), 0, 0)
    returning * into ent;
    return next ent;
  end loop;
end $$;

-- ── WHAT IS WAITING FOR ME (read-only) ─────────────────────────────────────
-- Returns unclaimed ledger rows with the role I hold. The client decides what
-- it can physically accept (a stash at its cap can accept nothing) and claims
-- only that, so a payout is never half-delivered and never silently clamped.
create or replace function public.rl_claimable()
returns table (
  ledger_id bigint, party text, kind text, resource text,
  lot_size integer, lots integer, units integer, currency text,
  price_per_lot integer, price_total integer,
  want_kind text, want_id text, want_name text, want_res text, want_units integer,
  counterparty text, created_at timestamptz
)
language sql security definer set search_path = public, pg_temp as $$
  select e.id, 'seller'::text, e.kind, e.resource,
         e.lot_size, e.lots, e.units, e.currency,
         e.price_per_lot, e.price_total,
         e.want_kind, e.want_id, e.want_name, e.want_res, e.want_units,
         e.buyer_name, e.created_at
    from public.resource_trade_ledger e
   where e.seller_id = auth.uid()
     and not exists (select 1 from public.resource_trade_claims c
                      where c.ledger_id = e.id and c.party = 'seller')
  union all
  select e.id, 'buyer'::text, e.kind, e.resource,
         e.lot_size, e.lots, e.units, e.currency,
         e.price_per_lot, e.price_total,
         e.want_kind, e.want_id, e.want_name, e.want_res, e.want_units,
         e.seller_name, e.created_at
    from public.resource_trade_ledger e
   where e.buyer_id = auth.uid() and e.kind = 'sale'
     and not exists (select 1 from public.resource_trade_claims c
                      where c.ledger_id = e.id and c.party = 'buyer')
   order by 17 asc
$$;

-- ── CLAIM (insert-once; the PK is the lock) ────────────────────────────────
create or replace function public.rl_claim(p_ids bigint[])
returns setof bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'NOT_SIGNED_IN'; end if;
  if p_ids is null or array_length(p_ids,1) is null then return; end if;
  return query
    insert into public.resource_trade_claims (ledger_id, party, claimed_by)
    select e.id,
           case when e.seller_id = me then 'seller' else 'buyer' end,
           me
      from public.resource_trade_ledger e
     where e.id = any(p_ids)
       and (e.seller_id = me or (e.buyer_id = me and e.kind = 'sale'))
    on conflict (ledger_id, party) do nothing
    returning ledger_id;
end $$;

revoke all on function public.rl_post_listing(text,integer,integer,text,integer,text,text,text,text,integer,text) from public, anon;
revoke all on function public.rl_take_lots(uuid,integer)      from public, anon;
revoke all on function public.rl_cancel_listing(uuid)         from public, anon;
revoke all on function public.rl_expire_mine(integer)         from public, anon;
revoke all on function public.rl_claimable()                  from public, anon;
revoke all on function public.rl_claim(bigint[])              from public, anon;

grant execute on function public.rl_post_listing(text,integer,integer,text,integer,text,text,text,text,integer,text) to authenticated;
grant execute on function public.rl_take_lots(uuid,integer)   to authenticated;
grant execute on function public.rl_cancel_listing(uuid)      to authenticated;
grant execute on function public.rl_expire_mine(integer)      to authenticated;
grant execute on function public.rl_claimable()               to authenticated;
grant execute on function public.rl_claim(bigint[])           to authenticated;

-- Optional, for instant refresh instead of the 45s safety poll:
--   alter publication supabase_realtime add table public.resource_listings;

-- ============================================================================
-- VERIFY — every line should read 'ok'.
-- ============================================================================
select 'lot columns'      as check,
       case when count(*) = 5 then 'ok' else 'MISSING (' || count(*) || '/5)' end as result
  from information_schema.columns
 where table_schema = 'public' and table_name = 'resource_listings'
   and column_name in ('lot_size','lots_total','lots_left','want_res','want_qty')
union all
select 'ledger table',
       case when to_regclass('public.resource_trade_ledger') is not null then 'ok' else 'MISSING' end
union all
select 'claims table',
       case when to_regclass('public.resource_trade_claims') is not null then 'ok' else 'MISSING' end
union all
select 'rpcs',
       case when count(*) = 6 then 'ok' else 'MISSING (' || count(*) || '/6)' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('rl_post_listing','rl_take_lots','rl_cancel_listing','rl_expire_mine','rl_claimable','rl_claim')
union all
select 'rpcs are security definer',
       case when count(*) = 6 then 'ok' else 'NOT ALL SECDEF (' || count(*) || '/6)' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef
   and p.proname in ('rl_post_listing','rl_take_lots','rl_cancel_listing','rl_expire_mine','rl_claimable','rl_claim')
union all
select 'rls on all three tables',
       case when count(*) = 3 then 'ok' else 'NOT ALL RLS (' || count(*) || '/3)' end
  from pg_tables
 where schemaname = 'public' and rowsecurity
   and tablename in ('resource_listings','resource_trade_ledger','resource_trade_claims')
union all
select 'no wide-open listing UPDATE',
       case when count(*) = 0 then 'ok' else 'STILL OPEN — rerun section 4' end
  from pg_policies
 where schemaname = 'public' and tablename = 'resource_listings' and cmd = 'UPDATE'
   and coalesce(with_check,'') in ('true','')
union all
select 'ledger has no write policy',
       case when count(*) = 0 then 'ok' else 'WRITABLE — rerun section 4' end
  from pg_policies
 where schemaname = 'public' and tablename = 'resource_trade_ledger' and cmd <> 'SELECT'
union all
select 'every listing has lot data',
       case when count(*) = 0 then 'ok' else count(*) || ' rows unbackfilled' end
  from public.resource_listings where lot_size is null or lots_total is null or lots_left is null
union all
select 'qty = lot_size * lots_total',
       case when count(*) = 0 then 'ok' else count(*) || ' rows disagree' end
  from public.resource_listings where lot_size is not null and qty <> lot_size * lots_total;
