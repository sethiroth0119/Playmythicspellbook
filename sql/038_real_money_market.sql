-- ============================================================================
-- 038_real_money_market.sql
-- 💵 THE BAZAAR — player-to-player sales for REAL money, with a platform fee
-- and an escrow-then-payout settlement.
--
-- Idempotent. Re-runnable. RLS ships in this file. Ends with a verify query.
-- Apply BY HAND in the Supabase SQL editor for project ktsiasyjusesawtrwrjc
-- (no CLI login exists in this repo).
--
-- ORDER: apply after 037. Nothing in the client requires this to have been
-- applied — /api/market/config reports `ready:false` when the tables are
-- absent and the Bazaar tile hides itself, exactly like the Cashout Vault
-- does without STRIPE_SECRET_KEY.
--
-- ── THE MONEY SHAPE (decided with the operator, 2026-09-06) ─────────────────
--   buyer → Stripe Checkout → PLATFORM balance     (we are merchant of record)
--   platform → rm_earnings credit for the seller   (minus the platform fee)
--   …hold period…
--   seller → /api/market/payout → Stripe transfer → their connected account
--
-- This is "separate charges and transfers", NOT a destination charge. The
-- money sits with the platform for RM_HOLD_DAYS before a seller can withdraw
-- it, which is the entire point: a chargeback or a fraud report lands inside
-- that window, and reversing an rm_earnings row is free while clawing money
-- back out of somebody else's bank account is not.
--
-- ⚠ CONSEQUENCE, STATED PLAINLY: holding other people's money is a regulated
--   activity in most jurisdictions. The operator, not this file, owns that
--   obligation. See STRIPE.md Part C.
--
-- ── 🔴 THE INVENTORY PROBLEM — READ BEFORE EXTENDING THIS ───────────────────
-- There is NO server-authoritative item inventory in this game. Cards and
-- units live in the player's profile blob, and the existing Cinder-priced
-- card market (card_market_listings) is settled ENTIRELY client-side: the
-- seller uploads their own card_json/unit_json snapshot and the buyer's
-- client claims the row and adds the card locally. Nothing ever verified the
-- seller owned it.
--
-- That is survivable when the price is Cinders. It is NOT survivable when the
-- price is dollars: a client that fabricates a snapshot is selling something
-- that does not exist, for real money, and the chargeback lands on us.
--
-- So this file does what CAN be done without a canonical inventory, and no
-- more. It does not pretend to solve ownership:
--   1. ESCROW AT LIST TIME. rm_list() copies the item payload into the
--      listing row and the seller's client is expected to remove its local
--      copy. The payload is then served to the BUYER from the server, so the
--      seller cannot alter what was sold after the fact.
--   2. ONE INSTANCE, ONE OPEN LISTING. A partial unique index on
--      (seller_id, item_uid) where status='open' makes the same unit instance
--      un-listable twice concurrently. item_uid is the client's per-instance
--      id; it stops the honest double-list and the lazy dupe, not a
--      determined forger.
--   3. VELOCITY CAP. rm_list() refuses more than RM_MAX_OPEN open listings
--      per seller, so a compromised client cannot flood the Bazaar.
--   4. THE HOLD WINDOW above is the real backstop, and it is a human one:
--      the money is still ours when the complaint arrives.
--
-- 🔴 THE REAL FIX, when someone does it: move unit ownership into a server
--    table and have rm_list() DELETE the row inside the same transaction that
--    creates the listing. Until that exists, treat the Bazaar as a rail that
--    needs the operator to watch disputes, and keep RM_HOLD_DAYS generous.
--    Do not raise the listing caps to "make the Bazaar feel busy" — the caps
--    are the fraud budget.
--
-- ── LEDGER DISCIPLINE (CLAUDE.md) ──────────────────────────────────────────
-- rm_earnings is APPEND-ONLY. A seller's balance is sum(amount_cents) over
-- their rows. There is no balance column anywhere in this file, on purpose —
-- the same rule that governs corp_treasury and the wallet ledger. A refund is
-- a NEGATIVE row, never an UPDATE and never a DELETE.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. TUNING. Read by the RPCs below; the Worker reads its own copies from env
--    (MARKET_FEE_BPS / MARKET_HOLD_DAYS) so the two can be tuned together.
--    ⚠ The FEE IS CHARGED IN THE WORKER at order-record time and stored on the
--    order row. This table is the default the Worker falls back to, and the
--    number the UI quotes to a seller before they list.
-- ---------------------------------------------------------------------------
create table if not exists public.rm_config (
  id          integer primary key default 1 check (id = 1),
  fee_bps     integer not null default 1000  check (fee_bps between 0 and 5000),
  hold_days   integer not null default 7     check (hold_days between 0 and 90),
  min_cents   integer not null default 200   check (min_cents >= 100),
  max_cents   integer not null default 50000 check (max_cents > 0),
  max_open    integer not null default 10    check (max_open between 1 and 100),
  payouts_min integer not null default 2500  check (payouts_min >= 0),
  updated_at  timestamptz not null default now()
);
insert into public.rm_config (id) values (1) on conflict (id) do nothing;

-- fee_bps 1000 = 10.00%. Basis points, not a float: money arithmetic in this
-- file is integer cents end to end, because 0.1 has no exact binary form and a
-- rounding drift on a real-money ledger is a reconciliation nightmare.

-- ---------------------------------------------------------------------------
-- 1. LISTINGS
-- ---------------------------------------------------------------------------
create table if not exists public.rm_listings (
  id           uuid primary key default gen_random_uuid(),
  seller_id    uuid not null references auth.users(id) on delete cascade,
  seller_name  text,
  kind         text not null default 'card',       -- 'card' | 'item'
  item_uid     text,                                -- per-instance id (anti-dupe)
  title        text not null,
  blurb        text,
  card_json    jsonb,                               -- shown to buyers
  unit_json    jsonb,                               -- ESCROWED payload, buyer-only
  price_cents  integer not null check (price_cents > 0),
  currency     text not null default 'usd',
  status       text not null default 'open',        -- 'open'|'sold'|'cancelled'
  buyer_id     uuid references auth.users(id),
  sold_at      timestamptz,
  created_at   timestamptz not null default now()
);
alter table public.rm_listings add column if not exists item_uid   text;
alter table public.rm_listings add column if not exists seller_name text;

create index if not exists rm_listings_open_idx
  on public.rm_listings (created_at desc) where status = 'open';
create index if not exists rm_listings_seller_idx
  on public.rm_listings (seller_id, status);
-- 🔒 The same unit instance cannot sit in two OPEN listings at once. Partial,
--    so a sold row does not block a later re-list of a re-acquired instance.
create unique index if not exists rm_listings_one_open_per_item
  on public.rm_listings (seller_id, item_uid) where status = 'open' and item_uid is not null;

-- ---------------------------------------------------------------------------
-- 2. ORDERS. One row per PAID Stripe Checkout session.
--    UNIQUE(stripe_session_id) is what makes fulfilment idempotent: the
--    webhook and the buyer's return visit both call rm_record_order() for the
--    same session and the seller is credited exactly once.
-- ---------------------------------------------------------------------------
create table if not exists public.rm_orders (
  id                uuid primary key default gen_random_uuid(),
  listing_id        uuid not null references public.rm_listings(id) on delete restrict,
  buyer_id          uuid not null references auth.users(id) on delete cascade,
  seller_id         uuid not null references auth.users(id) on delete cascade,
  stripe_session_id text not null unique,
  stripe_intent     text,
  amount_cents      integer not null check (amount_cents > 0),
  fee_cents         integer not null check (fee_cents >= 0),
  seller_cents      integer not null check (seller_cents >= 0),
  currency          text not null default 'usd',
  status            text not null default 'paid',  -- 'paid'|'refunded'
  hold_until        timestamptz not null,
  created_at        timestamptz not null default now(),
  constraint rm_orders_split check (fee_cents + seller_cents = amount_cents)
);
create index if not exists rm_orders_seller_idx on public.rm_orders (seller_id, created_at desc);
create index if not exists rm_orders_buyer_idx  on public.rm_orders (buyer_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. EARNINGS — APPEND-ONLY. Balance = sum(amount_cents). Never a column.
--    op: 'sale' (+seller_cents) | 'payout' (−) | 'refund' (−) | 'adjust' (±)
--    available_at is when the row becomes withdrawable; a 'sale' row carries
--    the order's hold_until, a 'payout' row is immediately effective.
-- ---------------------------------------------------------------------------
create table if not exists public.rm_earnings (
  id           bigserial primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  op           text not null check (op in ('sale','payout','refund','adjust')),
  amount_cents integer not null,
  order_id     uuid references public.rm_orders(id) on delete set null,
  payout_id    uuid,
  note         text,
  available_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index if not exists rm_earnings_user_idx on public.rm_earnings (user_id, created_at desc);
-- 🔒 One 'sale' row per order, enforced by the database rather than by the
--    caller remembering. This is the second half of idempotent fulfilment.
create unique index if not exists rm_earnings_one_sale_per_order
  on public.rm_earnings (order_id) where op = 'sale';

-- ---------------------------------------------------------------------------
-- 4. PAYOUTS. A row is created BEFORE the Stripe transfer is attempted and
--    the matching negative rm_earnings row is written in the SAME transaction
--    (rm_payout_open). The money therefore leaves the balance the instant the
--    request is accepted — a second concurrent request sees the lower balance
--    and is refused. Settling or failing the transfer is a later UPDATE of
--    this row only; the ledger row is never rewritten.
-- ---------------------------------------------------------------------------
create table if not exists public.rm_payouts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  amount_cents       integer not null check (amount_cents > 0),
  stripe_account_id  text,
  stripe_transfer_id text,
  status             text not null default 'pending', -- 'pending'|'paid'|'failed'
  failure            text,
  created_at         timestamptz not null default now(),
  settled_at         timestamptz
);
create index if not exists rm_payouts_user_idx on public.rm_payouts (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 5. DELIVERIES — the escrowed payload, released to the BUYER only.
--    Claim-once uses the 019 pattern: the INSERT of the claim IS the lock, so
--    a buyer whose client dies mid-claim simply claims on their next visit and
--    a buyer who retries cannot double-add the item.
-- ---------------------------------------------------------------------------
create table if not exists public.rm_claims (
  order_id   uuid primary key references public.rm_orders(id) on delete cascade,
  buyer_id   uuid not null references auth.users(id) on delete cascade,
  claimed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 6. RLS. Every table, in this file, per CLAUDE.md.
--    THE RULE HERE: clients may READ their own money and WRITE nothing that
--    is money. Every write path below is a SECURITY DEFINER function or the
--    service-role key. There is deliberately no INSERT/UPDATE/DELETE policy
--    on rm_orders, rm_earnings or rm_payouts for `authenticated` at all —
--    absent policy = denied, which is the safe default and the one we want.
-- ---------------------------------------------------------------------------
alter table public.rm_config   enable row level security;
alter table public.rm_listings enable row level security;
alter table public.rm_orders   enable row level security;
alter table public.rm_earnings enable row level security;
alter table public.rm_payouts  enable row level security;
alter table public.rm_claims   enable row level security;

-- rm_config: world-readable tuning (the UI quotes the fee before you list).
drop policy if exists rmc_sel on public.rm_config;
create policy rmc_sel on public.rm_config for select to authenticated using (true);

-- rm_listings: open listings are public; your own rows are always visible.
-- ⚠ unit_json (the escrowed payload) is NOT protected by this policy —
--   row-level security is row level. The payload is withheld by never
--   SELECTing it in the browse path: the client reads through
--   rm_browse(), which returns card_json only. The buyer gets unit_json from
--   rm_claim() and nowhere else. A raw PostgREST reader could still see it on
--   an open row, which is why unit_json must never carry anything secret —
--   it is a card snapshot, and the buyer is about to receive it anyway.
drop policy if exists rml_sel on public.rm_listings;
create policy rml_sel on public.rm_listings for select to authenticated
  using (status = 'open' or seller_id = auth.uid() or buyer_id = auth.uid());

-- 🔴 NO INSERT / UPDATE POLICY ON LISTINGS. This is the hole that
--    card_market_listings still has open (`using (status='open') with check
--    (true)` lets any authenticated user rewrite any open listing — including
--    its price and its seller_id). On a Cinder market that is bad. On a
--    dollar market it is theft. Listing and cancelling go through the RPCs.
drop policy if exists rml_ins on public.rm_listings;
drop policy if exists rml_upd on public.rm_listings;
drop policy if exists rml_del on public.rm_listings;

-- rm_orders / rm_earnings / rm_payouts: read your own, write nothing.
drop policy if exists rmo_sel on public.rm_orders;
create policy rmo_sel on public.rm_orders for select to authenticated
  using (buyer_id = auth.uid() or seller_id = auth.uid());

drop policy if exists rme_sel on public.rm_earnings;
create policy rme_sel on public.rm_earnings for select to authenticated
  using (user_id = auth.uid());

drop policy if exists rmp_sel on public.rm_payouts;
create policy rmp_sel on public.rm_payouts for select to authenticated
  using (user_id = auth.uid());

drop policy if exists rmcl_sel on public.rm_claims;
create policy rmcl_sel on public.rm_claims for select to authenticated
  using (buyer_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 7. RPCs. Every one derives the actor from auth.uid() — no function here
--    takes a user id as an argument except the two the SERVICE KEY calls,
--    and those are revoked from authenticated so a player cannot reach them.
-- ---------------------------------------------------------------------------

-- 7a. LIST AN ITEM.
create or replace function public.rm_list(
  p_kind text, p_item_uid text, p_title text, p_blurb text,
  p_card jsonb, p_unit jsonb, p_price_cents integer
) returns public.rm_listings
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); cfg public.rm_config; n integer; row public.rm_listings;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into cfg from public.rm_config where id = 1;

  -- 🔴 PRICE BOUNDS ARE SERVER-SIDE. The client shows them, but this is what
  --    enforces them. A $0 listing would be a free item-transfer rail with no
  --    Stripe session behind it; a $10,000 listing is a money-laundering
  --    shape, not a game trade.
  if p_price_cents is null or p_price_cents < cfg.min_cents or p_price_cents > cfg.max_cents then
    raise exception 'price must be between % and % cents', cfg.min_cents, cfg.max_cents;
  end if;

  -- Velocity cap — see the header. This is a fraud budget, not a UX knob.
  select count(*) into n from public.rm_listings
   where seller_id = me and status = 'open';
  if n >= cfg.max_open then
    raise exception 'you already have % open listings (max %)', n, cfg.max_open;
  end if;

  insert into public.rm_listings
    (seller_id, seller_name, kind, item_uid, title, blurb, card_json, unit_json, price_cents)
  values
    (me,
     -- Name is DERIVED, never accepted from the caller — same reason sql/012
     -- moved chat names server-side. A seller cannot impersonate another
     -- player in a listing that takes real money.
     coalesce((select display_name from public.user_profiles where user_id = me), 'Survivor'),
     coalesce(nullif(p_kind, ''), 'card'),
     nullif(p_item_uid, ''),
     left(coalesce(nullif(p_title, ''), 'Untitled'), 80),
     left(coalesce(p_blurb, ''), 400),
     p_card, p_unit, p_price_cents)
  returning * into row;
  return row;
exception when unique_violation then
  raise exception 'that item is already listed';
end $$;

-- 7b. CANCEL. Only your own, only while open, only if never sold.
create or replace function public.rm_cancel(p_listing uuid)
returns public.rm_listings
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); row public.rm_listings;
begin
  if me is null then raise exception 'not signed in'; end if;
  update public.rm_listings set status = 'cancelled'
   where id = p_listing and seller_id = me and status = 'open'
  returning * into row;
  if row.id is null then raise exception 'not your open listing'; end if;
  return row;
end $$;

-- 7c. BROWSE. A function rather than a view because it is the thing that
--     WITHHOLDS unit_json from everyone but the buyer. Callers use this;
--     selecting rm_listings directly is possible but returns the payload.
create or replace function public.rm_browse(p_limit integer default 60)
returns table (
  id uuid, seller_id uuid, seller_name text, kind text, title text,
  blurb text, card_json jsonb, item_uid text, price_cents integer, created_at timestamptz
)
language sql security definer set search_path = public as $$
  -- item_uid is returned so a SELLER cancelling their own listing can restore
  -- the ORIGINAL collection entry rather than being granted a fresh copy under
  -- a new id (which would leave a stray duplicate in Forge.customCards).
  select l.id, l.seller_id, l.seller_name, l.kind, l.title,
         l.blurb, l.card_json, l.item_uid, l.price_cents, l.created_at
    from public.rm_listings l
   where l.status = 'open'
   order by l.created_at desc
   limit greatest(1, least(coalesce(p_limit, 60), 200));
$$;

-- 7d. BALANCE. Two numbers: everything, and the part past its hold.
create or replace function public.rm_balance()
returns table (total_cents bigint, available_cents bigint, pending_cents bigint)
language sql security definer set search_path = public as $$
  select
    coalesce(sum(amount_cents), 0)::bigint,
    coalesce(sum(amount_cents) filter (where available_at <= now()), 0)::bigint,
    coalesce(sum(amount_cents) filter (where available_at >  now()), 0)::bigint
  from public.rm_earnings where user_id = auth.uid();
$$;

-- 7e. RECORD A PAID ORDER. 🔒 SERVICE KEY ONLY (revoked below).
--     Called by the Worker after it has retrieved the session from Stripe and
--     confirmed payment_status='paid'. Idempotent on the session id: the
--     second caller finds the order already there and returns it unchanged,
--     which is what lets the webhook and the buyer's return both run.
create or replace function public.rm_record_order(
  p_session text, p_intent text, p_listing uuid, p_buyer uuid,
  p_amount integer, p_fee integer, p_currency text
) returns public.rm_orders
language plpgsql security definer set search_path = public as $$
declare cfg public.rm_config; l public.rm_listings; o public.rm_orders; hold timestamptz;
begin
  select * into o from public.rm_orders where stripe_session_id = p_session;
  if o.id is not null then return o; end if;   -- already fulfilled; no-op

  select * into cfg from public.rm_config where id = 1;
  -- Lock the listing row so two concurrent fulfilments of DIFFERENT sessions
  -- for the same listing cannot both mark it sold and both credit the seller.
  select * into l from public.rm_listings where id = p_listing for update;
  if l.id is null then raise exception 'no such listing'; end if;
  if l.status = 'sold' and l.buyer_id is distinct from p_buyer then
    raise exception 'listing already sold';
  end if;

  hold := now() + (cfg.hold_days || ' days')::interval;

  insert into public.rm_orders
    (listing_id, buyer_id, seller_id, stripe_session_id, stripe_intent,
     amount_cents, fee_cents, seller_cents, currency, hold_until)
  values
    (l.id, p_buyer, l.seller_id, p_session, p_intent,
     p_amount, p_fee, p_amount - p_fee, coalesce(p_currency, 'usd'), hold)
  returning * into o;

  update public.rm_listings
     set status = 'sold', buyer_id = p_buyer, sold_at = now()
   where id = l.id;

  -- The seller's credit. UNIQUE(order_id) where op='sale' is the belt to this
  -- function's braces — even a caller that bypassed the early return above
  -- cannot double-credit.
  insert into public.rm_earnings (user_id, op, amount_cents, order_id, note, available_at)
  values (l.seller_id, 'sale', o.seller_cents, o.id,
          'Bazaar sale: ' || l.title, hold)
  on conflict do nothing;

  return o;
-- ⚠ THE EARLY RETURN AT THE TOP IS NOT ENOUGH ON ITS OWN. The webhook and the
--   buyer's return leg can both be inside this function before either has
--   inserted, so both miss the lookup and race to the INSERT. UNIQUE on
--   stripe_session_id turns the loser into an exception — catch it and return
--   the row the winner wrote, so fulfilment stays idempotent under the
--   concurrency it is actually going to see rather than only in theory.
exception when unique_violation then
  select * into o from public.rm_orders where stripe_session_id = p_session;
  return o;
end $$;

-- 7f. OPEN A PAYOUT. Caller is the seller. Writes the payout row AND the
--     negative ledger row in ONE transaction, so the balance drops before
--     the Worker ever talks to Stripe. A concurrent second request then sees
--     the reduced balance and is refused — this is the whole double-withdraw
--     defence, and it is why the debit is not written "after the transfer
--     succeeds" (which is the shape that loses a race).
create or replace function public.rm_payout_open(p_amount integer)
returns public.rm_payouts
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); cfg public.rm_config; avail bigint; p public.rm_payouts;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into cfg from public.rm_config where id = 1;

  -- Serialise this seller's payouts against each other. Without it two
  -- requests can both read the same balance before either writes its debit.
  perform pg_advisory_xact_lock(hashtext('rm_payout:' || me::text));

  select coalesce(sum(amount_cents) filter (where available_at <= now()), 0)
    into avail from public.rm_earnings where user_id = me;

  if p_amount is null or p_amount <= 0 then raise exception 'bad amount'; end if;
  if p_amount < cfg.payouts_min then
    raise exception 'minimum payout is % cents', cfg.payouts_min;
  end if;
  if p_amount > avail then
    raise exception 'only % cents available', avail;
  end if;

  insert into public.rm_payouts (user_id, amount_cents) values (me, p_amount)
  returning * into p;

  insert into public.rm_earnings (user_id, op, amount_cents, payout_id, note)
  values (me, 'payout', -p_amount, p.id, 'Payout to Stripe');

  return p;
end $$;

-- 7g. SETTLE / FAIL a payout. 🔒 SERVICE KEY ONLY (revoked below).
--     On failure the money is RETURNED with a compensating positive row —
--     the original debit is left standing, because the ledger is append-only
--     and "delete the mistake" is how ledgers stop reconciling.
create or replace function public.rm_payout_settle(
  p_payout uuid, p_transfer text, p_account text, p_ok boolean, p_failure text
) returns public.rm_payouts
language plpgsql security definer set search_path = public as $$
declare p public.rm_payouts;
begin
  select * into p from public.rm_payouts where id = p_payout for update;
  if p.id is null then raise exception 'no such payout'; end if;
  if p.status <> 'pending' then return p; end if;   -- idempotent

  if p_ok then
    update public.rm_payouts
       set status = 'paid', stripe_transfer_id = p_transfer,
           stripe_account_id = p_account, settled_at = now()
     where id = p.id returning * into p;
  else
    update public.rm_payouts
       set status = 'failed', failure = left(coalesce(p_failure, 'transfer failed'), 300),
           settled_at = now()
     where id = p.id returning * into p;
    insert into public.rm_earnings (user_id, op, amount_cents, payout_id, note)
    values (p.user_id, 'adjust', p.amount_cents, p.id, 'Payout failed — returned');
  end if;
  return p;
end $$;

-- 7h. REFUND an order. 🔒 SERVICE KEY ONLY. Reverses the seller's credit with
--     a negative row. This CAN drive a seller's balance negative — that is
--     correct and deliberate: it means they withdrew money for a sale that
--     was later charged back, and the debt should follow them rather than
--     quietly evaporate. rm_payout_open refuses while the balance is short.
create or replace function public.rm_refund_order(p_session text, p_note text)
returns public.rm_orders
language plpgsql security definer set search_path = public as $$
declare o public.rm_orders;
begin
  select * into o from public.rm_orders where stripe_session_id = p_session for update;
  if o.id is null then raise exception 'no such order'; end if;
  if o.status = 'refunded' then return o; end if;   -- idempotent

  update public.rm_orders set status = 'refunded' where id = o.id returning * into o;
  insert into public.rm_earnings (user_id, op, amount_cents, order_id, note)
  values (o.seller_id, 'refund', -o.seller_cents, o.id,
          left(coalesce(p_note, 'Order refunded'), 200));
  return o;
end $$;

-- 7i. CLAIM the escrowed payload. Buyer only, once. The claim INSERT is the
--     lock (019 pattern), so a retry returns 'already claimed' rather than a
--     second copy of the item.
create or replace function public.rm_claim(p_order uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); o public.rm_orders; l public.rm_listings;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into o from public.rm_orders where id = p_order and buyer_id = me;
  if o.id is null then raise exception 'not your order'; end if;
  if o.status <> 'paid' then raise exception 'order is not payable'; end if;

  begin
    insert into public.rm_claims (order_id, buyer_id) values (o.id, me);
  exception when unique_violation then
    raise exception 'already claimed';
  end;

  select * into l from public.rm_listings where id = o.listing_id;
  return jsonb_build_object('kind', l.kind, 'title', l.title,
                            'card', l.card_json, 'unit', l.unit_json);
end $$;

-- 7j. UNCLAIMED — what the buyer still has to collect. Drives the "you have
--     items waiting" prompt without exposing the payload.
create or replace function public.rm_unclaimed()
returns table (order_id uuid, title text, kind text, created_at timestamptz)
language sql security definer set search_path = public as $$
  select o.id, l.title, l.kind, o.created_at
    from public.rm_orders o
    join public.rm_listings l on l.id = o.listing_id
   where o.buyer_id = auth.uid() and o.status = 'paid'
     and not exists (select 1 from public.rm_claims c where c.order_id = o.id)
   order by o.created_at desc;
$$;

-- ---------------------------------------------------------------------------
-- 8. GRANTS. 🔴 THE SECURITY BOUNDARY OF THIS FILE.
--    A SECURITY DEFINER function is granted to PUBLIC by default, which would
--    hand every player rm_record_order() — i.e. the ability to mint themselves
--    earnings rows for a sale that never happened. Revoke first, grant
--    deliberately, and leave the three service-key functions ungranted.
-- ---------------------------------------------------------------------------
revoke all on function public.rm_list(text,text,text,text,jsonb,jsonb,integer) from public, anon, authenticated;
revoke all on function public.rm_cancel(uuid) from public, anon, authenticated;
revoke all on function public.rm_browse(integer) from public, anon, authenticated;
revoke all on function public.rm_balance() from public, anon, authenticated;
revoke all on function public.rm_payout_open(integer) from public, anon, authenticated;
revoke all on function public.rm_claim(uuid) from public, anon, authenticated;
revoke all on function public.rm_unclaimed() from public, anon, authenticated;
revoke all on function public.rm_record_order(text,text,uuid,uuid,integer,integer,text) from public, anon, authenticated;
revoke all on function public.rm_payout_settle(uuid,text,text,boolean,text) from public, anon, authenticated;
revoke all on function public.rm_refund_order(text,text) from public, anon, authenticated;

grant execute on function public.rm_list(text,text,text,text,jsonb,jsonb,integer) to authenticated;
grant execute on function public.rm_cancel(uuid)      to authenticated;
grant execute on function public.rm_browse(integer)   to authenticated;
grant execute on function public.rm_balance()         to authenticated;
grant execute on function public.rm_payout_open(integer) to authenticated;
grant execute on function public.rm_claim(uuid)       to authenticated;
grant execute on function public.rm_unclaimed()       to authenticated;
-- rm_record_order / rm_payout_settle / rm_refund_order: NO GRANT ON PURPOSE.
-- The service-role key bypasses grants, so the Worker can still call them and
-- a signed-in player cannot. Do not "fix" these by granting them.

commit;

-- ============================================================================
-- VERIFY. Every line should read 'ok'.
-- ============================================================================
select 'tables exist' as check,
       case when count(*) = 6 then 'ok' else count(*) || '/6 — rerun' end as result
  from pg_tables where schemaname = 'public'
   and tablename in ('rm_config','rm_listings','rm_orders','rm_earnings','rm_payouts','rm_claims')
union all
select 'RLS on every table',
       case when count(*) = 6 then 'ok' else count(*) || '/6 — RLS MISSING' end
  from pg_tables where schemaname = 'public' and rowsecurity
   and tablename in ('rm_config','rm_listings','rm_orders','rm_earnings','rm_payouts','rm_claims')
union all
select 'no client write policy on money tables',
       case when count(*) = 0 then 'ok' else 'WRITABLE — ' || count(*) || ' policies' end
  from pg_policies where schemaname = 'public'
   and tablename in ('rm_orders','rm_earnings','rm_payouts','rm_listings') and cmd <> 'SELECT'
union all
select 'service-only RPCs not granted to players',
       case when count(*) = 0 then 'ok' else 'GRANTED — revoke section 8' end
  from information_schema.role_routine_grants
 where routine_schema = 'public' and grantee in ('anon','authenticated','PUBLIC')
   and routine_name in ('rm_record_order','rm_payout_settle','rm_refund_order')
union all
select 'player RPCs are callable',
       case when count(distinct routine_name) = 7 then 'ok' else count(distinct routine_name) || '/7 — rerun grants' end
  from information_schema.role_routine_grants
 where routine_schema = 'public' and grantee = 'authenticated'
   and routine_name in ('rm_list','rm_cancel','rm_browse','rm_balance','rm_payout_open','rm_claim','rm_unclaimed')
union all
select 'one open listing per item instance',
       case when count(*) = 1 then 'ok' else 'INDEX MISSING' end
  from pg_indexes where schemaname = 'public' and indexname = 'rm_listings_one_open_per_item'
union all
select 'one sale credit per order',
       case when count(*) = 1 then 'ok' else 'INDEX MISSING' end
  from pg_indexes where schemaname = 'public' and indexname = 'rm_earnings_one_sale_per_order'
union all
select 'every order splits exactly',
       case when count(*) = 0 then 'ok' else count(*) || ' rows disagree' end
  from public.rm_orders where fee_cents + seller_cents <> amount_cents
union all
select 'no seller is overdrawn',
       case when count(*) = 0 then 'ok' else count(*) || ' negative balances (investigate)' end
  from (select user_id from public.rm_earnings group by user_id having sum(amount_cents) < 0) s;
