-- =============================================================================
-- 🛒 CARD SHOPS — player-owned storefronts. A player opens ONE shop and lists
-- cards from their real collection for Cinder; OTHER players visit shops that are
-- OPEN (owned) and buy the listings. Replaces the old "Walk Camp Heights".
--
-- Tables:
--   card_shops          — one storefront per owner (name/tagline/theme/open)
--   card_shop_listings  — stock lines (a card escrowed from the owner's collection)
--   card_shop_sales     — earnings ledger (the owner collects uncollected sales)
-- RPC:
--   card_shop_buy(listing_id, expected_price) — atomic: decrement qty + log the sale
--
-- Run ONCE in the Supabase SQL editor (or `supabase db push`). Idempotent.
-- =============================================================================

-- ── card_shops — the storefront ─────────────────────────────────────────────
create table if not exists public.card_shops (
  owner_id    uuid primary key references auth.users(id) on delete cascade,
  owner_name  text not null default 'Vendor',
  shop_name   text not null default 'Outpost',
  tagline     text,
  theme       text not null default 'bunker',
  open        boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists card_shops_open_idx on public.card_shops (open);
alter table public.card_shops enable row level security;
drop policy if exists card_shops_sel on public.card_shops;
create policy card_shops_sel on public.card_shops for select to authenticated using (true);
drop policy if exists card_shops_ins on public.card_shops;
create policy card_shops_ins on public.card_shops for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists card_shops_upd on public.card_shops;
create policy card_shops_upd on public.card_shops for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists card_shops_del on public.card_shops;
create policy card_shops_del on public.card_shops for delete to authenticated using (owner_id = auth.uid());

-- ── card_shop_listings — one row per listed card line ───────────────────────
create table if not exists public.card_shop_listings (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  kind       text not null default 'card',           -- 'card' (packs reserved for later)
  card_id    text not null,
  card_json  jsonb,                                   -- snapshot so the buyer receives it
  price      integer not null check (price >= 0),
  qty        integer not null default 1 check (qty >= 0),
  created_at timestamptz not null default now()
);
create index if not exists card_shop_listings_owner_idx on public.card_shop_listings (owner_id);
alter table public.card_shop_listings enable row level security;
drop policy if exists card_shop_listings_sel on public.card_shop_listings;
create policy card_shop_listings_sel on public.card_shop_listings for select to authenticated using (true);
-- owner may list / unlist their own; buying goes through the security-definer rpc.
drop policy if exists card_shop_listings_ins on public.card_shop_listings;
create policy card_shop_listings_ins on public.card_shop_listings for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists card_shop_listings_del on public.card_shop_listings;
create policy card_shop_listings_del on public.card_shop_listings for delete to authenticated using (owner_id = auth.uid());

-- ── card_shop_sales — the owner's earnings ledger ───────────────────────────
create table if not exists public.card_shop_sales (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null,                           -- the seller
  buyer_id   uuid,
  buyer_name text,
  kind       text not null default 'card',
  card_id    text,
  item_name  text,
  amount     integer not null,
  collected  boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists card_shop_sales_owner_idx on public.card_shop_sales (owner_id, collected);
alter table public.card_shop_sales enable row level security;
-- the seller reads their own sales (to collect earnings); writes happen via the rpc.
drop policy if exists card_shop_sales_sel on public.card_shop_sales;
create policy card_shop_sales_sel on public.card_shop_sales for select to authenticated using (owner_id = auth.uid());

-- ── card_shop_buy — ATOMIC purchase ─────────────────────────────────────────
-- Decrements the listing qty under a row lock (so two buyers can't take the last
-- copy), logs the sale to the owner's ledger, and returns the bought card so the
-- client can grant it + spend the buyer's Cinder. Buying your OWN listing is blocked.
-- ⚠ Cinder is spent / credited client-side (same posture as the card market).
create or replace function public.card_shop_buy(p_listing_id uuid, p_expected_price integer)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_l   public.card_shop_listings%rowtype;
  v_name text;
begin
  if v_uid is null or p_listing_id is null then return json_build_object('ok', false, 'reason', 'auth'); end if;

  select * into v_l from public.card_shop_listings where id = p_listing_id for update;
  if not found then return json_build_object('ok', false, 'reason', 'gone'); end if;
  if v_l.owner_id = v_uid then return json_build_object('ok', false, 'reason', 'own'); end if;
  if v_l.qty <= 0 then return json_build_object('ok', false, 'reason', 'soldout'); end if;
  if p_expected_price is not null and v_l.price <> p_expected_price then return json_build_object('ok', false, 'reason', 'price_changed', 'price', v_l.price); end if;

  if v_l.qty <= 1 then delete from public.card_shop_listings where id = p_listing_id;
  else update public.card_shop_listings set qty = qty - 1 where id = p_listing_id; end if;

  v_name := coalesce(v_l.card_json->>'name', v_l.card_id);
  insert into public.card_shop_sales (owner_id, buyer_id, kind, card_id, item_name, amount)
    values (v_l.owner_id, v_uid, v_l.kind, v_l.card_id, v_name, v_l.price);

  return json_build_object('ok', true, 'kind', v_l.kind, 'card_id', v_l.card_id, 'card_json', v_l.card_json, 'price', v_l.price, 'item_name', v_name);
end; $$;
grant execute on function public.card_shop_buy(uuid, integer) to authenticated;

-- ── card_shop_collect — mark the owner's sales collected, return the total ───
create or replace function public.card_shop_collect()
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_total bigint; v_n integer;
begin
  if v_uid is null then return json_build_object('ok', false, 'amount', 0); end if;
  select coalesce(sum(amount), 0), count(*) into v_total, v_n from public.card_shop_sales where owner_id = v_uid and collected = false;
  if coalesce(v_total, 0) <= 0 then return json_build_object('ok', true, 'amount', 0, 'count', 0); end if;
  update public.card_shop_sales set collected = true where owner_id = v_uid and collected = false;
  return json_build_object('ok', true, 'amount', v_total, 'count', v_n);
end; $$;
grant execute on function public.card_shop_collect() to authenticated;
