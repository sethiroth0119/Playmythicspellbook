-- ============================================================================
-- 📈 cx_prices — LIVE SHARED CRASH / EXCHANGE PRICES
-- ----------------------------------------------------------------------------
-- One row per tradeable asset (cards, resources, AND the Extraction Field part
-- pegs: steelPlating / copperWiring / metal / ironOre …). Every confirmed trade
-- upserts the new price; a Realtime channel merges other players' moves live, so
-- every signed-in player sees the SAME market move in real time. The base price
-- stays client-deterministic (each client agrees on it); only `current_px` /
-- `volume24h` travel through the cloud, and clients clamp to the same MIN/MAX
-- band on read — so a bad write can't push a price out of range for anyone.
--
-- Fully fallback-safe: until this is applied the client logs a one-line notice
-- and the Crash Exchange runs LOCAL-ONLY (single-player). Safe to re-run.
-- ============================================================================

create table if not exists public.cx_prices (
  asset_id     text primary key,
  current_px   numeric not null check (current_px >= 0),
  volume24h    integer not null default 0,
  last_dir     smallint not null default 0 check (last_dir in (-1, 0, 1)),
  last_reason  text,
  updated_by   uuid references auth.users(id) on delete set null,
  updated_at   timestamptz not null default now()
);

create index if not exists cx_prices_updated_at_idx
  on public.cx_prices (updated_at desc);

-- Keep updated_at fresh on every upsert-update (default only fires on insert).
create or replace function public.cx_prices_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists cx_prices_touch_updated on public.cx_prices;
create trigger cx_prices_touch_updated
  before update on public.cx_prices
  for each row execute function public.cx_prices_touch();

-- 🔒 RLS — the market is shared. Any signed-in player can read the whole board
-- and move any asset (that's the point), but every write must stamp the author.
alter table public.cx_prices enable row level security;

drop policy if exists "cx_prices_read" on public.cx_prices;
create policy "cx_prices_read" on public.cx_prices
  for select to authenticated using (true);

drop policy if exists "cx_prices_insert" on public.cx_prices;
create policy "cx_prices_insert" on public.cx_prices
  for insert to authenticated with check (updated_by = auth.uid());

drop policy if exists "cx_prices_update" on public.cx_prices;
create policy "cx_prices_update" on public.cx_prices
  for update to authenticated using (true) with check (updated_by = auth.uid());

grant select, insert, update on public.cx_prices to authenticated;

-- 📡 Realtime — the client subscribes to postgres_changes on this table so
-- everyone's exchange updates together. Add to the supabase_realtime publication
-- (guarded so re-running doesn't error if it's already a member).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'cx_prices'
  ) then
    execute 'alter publication supabase_realtime add table public.cx_prices';
  end if;
end$$;
