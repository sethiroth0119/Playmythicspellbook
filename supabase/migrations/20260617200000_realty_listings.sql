-- 🏷 realty_listings — the player Real-Estate Market (Phase 2).
--
-- Players list a property they own for SALE (deed transfers on buy) or RENT
-- (time-boxed Dwelling access; owner keeps the deed). Mirrors the player card
-- market (card_market_listings): atomic compare-and-set claims, seller payout
-- collected on the next fetch (paid_out flag), realtime refresh.
--
-- Self-escrow trust model (no edge functions): the buyer/renter flips the row
-- status atomically (UPDATE … WHERE status='open') and pays from their own
-- wallet; the seller collects Cinder on their next fetch. RLS lets any
-- authenticated user read OPEN rows + their own + rows they bought/rent, and
-- update an OPEN row (the claim) or their own rows.

create table if not exists public.realty_listings (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid not null references auth.users(id) on delete cascade,
  seller_name text,
  kind        text not null default 'sale',          -- 'sale' | 'rent'
  prop_id     text,                                   -- underlying deed / listing id
  prop_json   jsonb,                                  -- snapshot: name/address/icon/color/image/capacity/blurb
  node_id     text,                                   -- District Node it is stationed in
  residents   integer not null default 0,             -- residents it houses (node boost)
  price       integer not null default 0,             -- sale price (Cinder)
  rent        integer not null default 0,             -- rent for the term (Cinder)
  rent_days   integer not null default 7,             -- rental length in days
  status      text not null default 'open',           -- 'open' | 'sold' | 'rented'
  buyer_id    uuid references auth.users(id),
  buyer_name  text,
  rent_until  timestamptz,                            -- when an active rental frees up
  paid_out    boolean not null default false,         -- seller collected the proceeds
  created_at  timestamptz default now()
);

create index if not exists realty_listings_status_idx on public.realty_listings (status);
create index if not exists realty_listings_seller_idx on public.realty_listings (seller_id);

alter table public.realty_listings enable row level security;

drop policy if exists rl_sel on public.realty_listings;
create policy rl_sel on public.realty_listings for select to authenticated
  using (status = 'open' or seller_id = auth.uid() or buyer_id = auth.uid());

drop policy if exists rl_ins on public.realty_listings;
create policy rl_ins on public.realty_listings for insert to authenticated
  with check (seller_id = auth.uid());

drop policy if exists rl_upd on public.realty_listings;
create policy rl_upd on public.realty_listings for update to authenticated
  using (status = 'open' or seller_id = auth.uid() or buyer_id = auth.uid())
  with check (true);

drop policy if exists rl_del on public.realty_listings;
create policy rl_del on public.realty_listings for delete to authenticated
  using (seller_id = auth.uid() and status = 'open');

-- Realtime so the market refreshes live for everyone.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'realty_listings'
  ) then
    alter publication supabase_realtime add table public.realty_listings;
  end if;
end $$;
