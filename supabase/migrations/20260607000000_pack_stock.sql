-- ============================================================================
-- 📦 PACK STOCK — GLOBAL, shared-across-all-players shelf stock for card packs.
-- ----------------------------------------------------------------------------
-- One row per pack/set id, tracking how many have been SOLD across EVERY player.
-- The client shows remaining = 100,000 - 100 (baseline) - sold, so the shelf
-- draws down for everyone and persists across refreshes / devices instead of
-- resetting per player.
--
-- Run this once in the Supabase SQL editor (or via `supabase db push`).
-- ============================================================================

create table if not exists public.pack_stock (
  pack_id    text primary key,
  sold       bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.pack_stock enable row level security;

-- Anyone (even signed-out spectators) may READ the shelf counts — they're not
-- sensitive and the shop needs them before sign-in.
drop policy if exists "pack_stock_read" on public.pack_stock;
create policy "pack_stock_read" on public.pack_stock
  for select using (true);

-- Writes go ONLY through the security-definer pack_buy() RPC below, so no client
-- can set an arbitrary count — they can only increment by a bounded qty.

-- 📥 pack_stock_all — return every set's sold count for the shop to render.
create or replace function public.pack_stock_all()
returns table (pack_id text, sold bigint)
language sql
security definer
set search_path = public, pg_temp
as $$
  select pack_id, sold from public.pack_stock;
$$;

grant execute on function public.pack_stock_all() to anon, authenticated;

-- 🛒 pack_buy — atomically add a purchase (1..99) to a set's GLOBAL sold count
-- and return the new total. Upserts the row on first purchase. Bounded qty so a
-- single call can never wildly inflate the count.
create or replace function public.pack_buy(p_pack_id text, p_qty int default 1)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_qty  int := greatest(1, least(coalesce(p_qty, 1), 99));
  v_sold bigint;
begin
  if p_pack_id is null or length(p_pack_id) = 0 then
    return 0;
  end if;
  insert into public.pack_stock (pack_id, sold, updated_at)
    values (p_pack_id, v_qty, now())
  on conflict (pack_id) do update
    set sold = public.pack_stock.sold + v_qty,
        updated_at = now()
  returning sold into v_sold;
  return v_sold;
end;
$$;

-- Only signed-in players can buy.
grant execute on function public.pack_buy(text, int) to authenticated;
