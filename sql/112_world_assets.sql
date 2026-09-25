-- ============================================================================
-- 112_world_assets.sql
-- Athena Engine — the FILES uploaded to the engine (models, animations, audio,
-- VFX presets). Idempotent. Re-runnable. RLS ships in this file.
--
-- Apply BY HAND in the Supabase SQL editor for project ktsiasyjusesawtrwrjc.
-- Until applied the editor's Files tab says so and uploads are refused; maps,
-- the library and every existing feature keep working.
--
-- ── WHAT THIS ADDS ──────────────────────────────────────────────────────────
--  public.world_assets — one row per uploaded file. The BYTES live in the
--  existing public `models` storage bucket under {uid}/athena/{kind}/…, which
--  the bucket's owner-folder policy (shop_objects migration) already allows;
--  this table is the index the editor lists and the maps reference by URL.
--
--  Visibility: every signed-in player can READ every row (a map another
--  player built must be able to load its files); only the owner (or an admin)
--  can write or delete. Deleting a row does not delete the object in storage;
--  the client removes both.
-- ============================================================================

begin;

create table if not exists public.world_assets (
  id          text primary key,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  owner_name  text,
  kind        text not null,                      -- model | anim | audio | vfx
  name        text not null,
  url         text not null,
  path        text not null,                      -- object path inside the models bucket
  bytes       integer not null default 0,
  meta        jsonb not null default '{}'::jsonb, -- clips, duration, preset kind …
  created_at  timestamptz not null default now(),
  constraint world_assets_id_chk   check (id ~ '^[A-Za-z0-9_-]{4,64}$'),
  constraint world_assets_kind_chk check (kind in ('model', 'anim', 'audio', 'vfx')),
  constraint world_assets_name_chk check (char_length(name) between 1 and 120),
  constraint world_assets_url_chk  check (char_length(url) between 8 and 1000)
);

create index if not exists world_assets_owner_idx on public.world_assets (owner_id, created_at desc);
create index if not exists world_assets_kind_idx  on public.world_assets (kind, created_at desc);

alter table public.world_assets enable row level security;

drop policy if exists world_assets_select on public.world_assets;
create policy world_assets_select on public.world_assets for select
  to authenticated using (true);

drop policy if exists world_assets_insert on public.world_assets;
create policy world_assets_insert on public.world_assets for insert
  to authenticated with check (owner_id = auth.uid());

drop policy if exists world_assets_update on public.world_assets;
create policy world_assets_update on public.world_assets for update
  to authenticated
  using (owner_id = auth.uid() or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() ->> 'role') = 'admin')
  with check (owner_id = auth.uid() or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() ->> 'role') = 'admin');

drop policy if exists world_assets_delete on public.world_assets;
create policy world_assets_delete on public.world_assets for delete
  to authenticated
  using (owner_id = auth.uid() or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() ->> 'role') = 'admin');

-- The bucket the bytes go to. Public read, owner-folder write (see the
-- shop_objects migration for the policies); re-asserted here so a fresh
-- project gets it.
insert into storage.buckets (id, name, public)
values ('models', 'models', true)
on conflict (id) do nothing;

commit;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
select 'world_assets table' as check_name,
       case when exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'world_assets') then 'ok' else 'MISSING' end as result
union all
select 'rls on', case when (select relrowsecurity from pg_class where oid = 'public.world_assets'::regclass) then 'ok' else 'MISSING' end
union all
select 'models bucket', case when exists (select 1 from storage.buckets where id = 'models') then 'ok' else 'MISSING' end;
