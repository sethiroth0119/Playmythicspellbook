-- ============================================================================
-- 🛋️ furniture_catalog — admin-curated furniture players BUY with Cinder and
-- then place in their shop (Sims-style decorator). Admins upload a .glb to the
-- `models` Storage bucket, set a price + footprint (+ optional baked animation),
-- and add a row here. Every signed-in player reads the catalog and buys from it;
-- ownership is tracked in the player's profile (no extra table needed). Placed
-- furniture is written to shop_objects (kind 'prop') just like Build-mode props,
-- so it renders + animates in the walkable shop.
-- ============================================================================
create table if not exists public.furniture_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  model_url text,                 -- public URL of the .glb (models bucket); null = colored placeholder
  price int not null default 100, -- Cinder cost
  w int not null default 1,       -- footprint width in grid cells
  d int not null default 1,       -- footprint depth in grid cells
  h real not null default 1,      -- placeholder height (metres)
  color int not null default 13938487,   -- placeholder tint (0xd4af37)
  category text default 'decor',
  anim jsonb,                     -- optional baked-clip / route animation { clip, timeScale, loop, route }
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists furniture_catalog_sort_idx on public.furniture_catalog (sort);

alter table public.furniture_catalog enable row level security;

-- Everyone reads the catalog (so all players can shop for furniture).
drop policy if exists furniture_catalog_read on public.furniture_catalog;
create policy furniture_catalog_read on public.furniture_catalog
  for select using (true);

-- Only admins curate it (upload the .glb + set the price). Admin = JWT role claim.
drop policy if exists furniture_catalog_admin_write on public.furniture_catalog;
create policy furniture_catalog_admin_write on public.furniture_catalog
  for all
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() ->> 'role') = 'admin')
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() ->> 'role') = 'admin');
