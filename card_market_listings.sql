-- ============================================================================
-- 🃏 Player Card Market — shared cross-player card/item listings.
-- Run ONCE in the Supabase SQL editor (Dashboard → SQL → New query → Run).
-- Mirrors the resource_listings table. Safe to re-run (idempotent).
-- The in-app Browse "setup needed" panel shows this same SQL with a copy button.
-- ============================================================================
create table if not exists public.card_market_listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references auth.users(id) on delete cascade,
  seller_name text,
  kind text not null default 'card',          -- 'card' | 'item'
  card_id text,
  card_json jsonb,                             -- card snapshot shown to buyers
  unit_json jsonb,                             -- seller's unit instance (level/trait/nature/moves)
  listing_type text not null default 'fixed',  -- 'fixed' | 'auction' (Stage 2)
  currency text not null default 'cinders',
  price integer not null default 0,
  starting_bid integer not null default 0,
  current_bid integer not null default 0,
  current_bidder_id uuid references auth.users(id),
  current_bidder_name text,
  buy_now_price integer,
  bid_history jsonb not null default '[]'::jsonb,
  ends_at timestamptz,
  buyer_id uuid references auth.users(id),
  status text not null default 'open',         -- 'open' | 'sold'
  paid_out boolean not null default false,
  created_at timestamptz default now()
);

alter table public.card_market_listings enable row level security;

drop policy if exists cml_sel on public.card_market_listings;
create policy cml_sel on public.card_market_listings for select to authenticated
  using (status = 'open' or seller_id = auth.uid() or buyer_id = auth.uid() or current_bidder_id = auth.uid());

drop policy if exists cml_ins on public.card_market_listings;
create policy cml_ins on public.card_market_listings for insert to authenticated
  with check (seller_id = auth.uid());

drop policy if exists cml_upd on public.card_market_listings;
create policy cml_upd on public.card_market_listings for update to authenticated
  using (status = 'open' or seller_id = auth.uid()) with check (true);

drop policy if exists cml_del on public.card_market_listings;
create policy cml_del on public.card_market_listings for delete to authenticated
  using (seller_id = auth.uid() and status = 'open');

-- Optional: instant realtime updates instead of the 30s client poll.
alter publication supabase_realtime add table public.card_market_listings;
