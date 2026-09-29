-- ============================================================================
-- 🏬 shop_objects — data-driven layout for the walkable 3D Card Shop.
-- One row per object placed in a shop scene (room shell, NPC, interactive
-- stations, decorative props). Admins write rows (or upload a .glb to the
-- `models` storage bucket and save its public URL here); every signed-in client
-- reads them and renders the shop live — no redeploy needed.
--
-- The walkable shop the game ships is the SHARED "global" shop, so the default
-- shop_id is 'global'. (The column is kept generic so per-player 3D shops can
-- reuse the same table later.)
-- ============================================================================
create table if not exists public.shop_objects (
  id uuid primary key default gen_random_uuid(),
  shop_id text not null default 'global',
  kind text not null,                       -- 'station' | 'prop' | 'npc' | 'room'
  view text,                                -- stations only: myshop|binder|open|browse|vendor
  label text,
  model_url text,                           -- public URL of the .glb (models bucket); null = procedural
  x real not null default 0,
  y real not null default 0,
  z real not null default 0,
  rotation_y real not null default 0,
  scale real not null default 1,
  interact_r real not null default 3,       -- stations: distance the Enter prompt appears
  block_r real not null default 1.6,        -- no-walk collision radius
  anim jsonb,                               -- animation: { clip, timeScale, loop, route:{points,speed,loop,faceTravel} }
  sort int not null default 0,
  updated_at timestamptz not null default now()
);

-- Idempotent guard: if the table already existed without the animation column.
alter table public.shop_objects add column if not exists anim jsonb;

create index if not exists shop_objects_shop_idx on public.shop_objects (shop_id, sort);

alter table public.shop_objects enable row level security;

-- Everyone can READ the layout (so all players see the customized shop).
drop policy if exists shop_objects_read on public.shop_objects;
create policy shop_objects_read on public.shop_objects
  for select using (true);

-- WRITE: a player can edit ONLY their OWN shop (shop_id = their account id), and
-- admins can edit any shop (incl. the shared 'global' template). Each player's
-- card shop is keyed by their auth.uid(), so they build/decorate just their own.
drop policy if exists shop_objects_admin_write on public.shop_objects;
drop policy if exists shop_objects_owner_write on public.shop_objects;
create policy shop_objects_owner_write on public.shop_objects
  for all
  using (
    shop_id = auth.uid()::text
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() ->> 'role') = 'admin'
  )
  with check (
    shop_id = auth.uid()::text
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() ->> 'role') = 'admin'
  );

-- ----------------------------------------------------------------------------
-- 🪣 Storage bucket for the .glb models. Run once (safe to re-run). Public so
-- the CDN serves each .glb to every client; admin-only writes via the client.
-- (If your Storage UI already has a `models` bucket, skip this block.)
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('models', 'models', true)
on conflict (id) do nothing;

-- Public read of the models bucket.
drop policy if exists models_public_read on storage.objects;
create policy models_public_read on storage.objects
  for select using (bucket_id = 'models');

-- Write/update/delete in the models bucket: a player may write only into their
-- OWN folder ({uid}/…, which is how the client uploads shop models), and admins
-- anywhere. Models are public-read so every visitor's shop can load them.
drop policy if exists models_admin_write on storage.objects;
drop policy if exists models_owner_write on storage.objects;
create policy models_owner_write on storage.objects
  for all
  using (
    bucket_id = 'models' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() ->> 'role') = 'admin'
    )
  )
  with check (
    bucket_id = 'models' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() ->> 'role') = 'admin'
    )
  );
