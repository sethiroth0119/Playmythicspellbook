-- ============================================================================
-- 038_world_maps.sql
-- World Forge (the 3D map creator, /src/mapforge) — saved maps.
-- Idempotent. Re-runnable. RLS ships in this file. Ends with a verify query.
--
-- Apply BY HAND in the Supabase SQL editor for project ktsiasyjusesawtrwrjc
-- (no CLI login exists in this repo). Nothing in the client requires this to
-- have been applied: before it exists the editor saves to localStorage and
-- says so; applying it turns cloud saving on.
--
-- ── WHAT THIS ADDS ──────────────────────────────────────────────────────────
--  public.world_maps — one row per map. `data` is the whole map document
--  (terrain heights, paint, water, sky, objects — see mapforge.format.js).
--  It is a document, not a ledger: the owner overwrites it on every save.
--
--  Visibility: the owner sees and edits their own rows; anyone signed in
--  can READ a row with is_public = true (so a builder can share a world);
--  nobody but the owner can write. There is no admin override policy on
--  purpose — an admin who wants a copy loads the public row and saves it
--  under their own id.
--
--  Size: a 160×160 map is ~600 KB of JSON. The check constraint caps a row
--  at 4 MB so a runaway client cannot fill the database; the editor limits
--  the grid to 160 on its side anyway.
-- ============================================================================

begin;

create table if not exists public.world_maps (
  id          text primary key,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  owner_name  text,
  name        text not null default 'Untitled world',
  description text not null default '',
  data        jsonb not null,
  is_public   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint world_maps_id_chk   check (id ~ '^[A-Za-z0-9_-]{4,64}$'),
  constraint world_maps_name_chk check (char_length(name) between 1 and 80),
  constraint world_maps_desc_chk check (char_length(description) <= 2000),
  constraint world_maps_size_chk check (pg_column_size(data) <= 4194304)
);

create index if not exists world_maps_owner_idx  on public.world_maps (owner_id, updated_at desc);
create index if not exists world_maps_public_idx on public.world_maps (updated_at desc) where is_public;

-- updated_at is server-owned: the client cannot backdate a save.
create or replace function public.world_maps_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.created_at := coalesce(old.created_at, new.created_at);
  return new;
end $$;
drop trigger if exists world_maps_touch on public.world_maps;
create trigger world_maps_touch before update on public.world_maps
  for each row execute function public.world_maps_touch();

-- ── RLS — the entire security boundary. Review every line. ────────────────
alter table public.world_maps enable row level security;

drop policy if exists world_maps_select on public.world_maps;
create policy world_maps_select on public.world_maps for select
  to authenticated
  using (owner_id = auth.uid() or is_public);

drop policy if exists world_maps_insert on public.world_maps;
create policy world_maps_insert on public.world_maps for insert
  to authenticated
  with check (owner_id = auth.uid());

drop policy if exists world_maps_update on public.world_maps;
create policy world_maps_update on public.world_maps for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists world_maps_delete on public.world_maps;
create policy world_maps_delete on public.world_maps for delete
  to authenticated
  using (owner_id = auth.uid());

grant select, insert, update, delete on public.world_maps to authenticated;

commit;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
select 'table exists' as check_name,
       case when to_regclass('public.world_maps') is not null then 'ok' else 'MISSING' end as result
union all
select 'rls enabled',
       case when rowsecurity then 'ok' else 'RLS OFF' end
  from pg_tables where schemaname = 'public' and tablename = 'world_maps'
union all
select 'four policies',
       case when count(*) = 4 then 'ok' else 'EXPECTED 4, GOT ' || count(*) end
  from pg_policies where schemaname = 'public' and tablename = 'world_maps'
union all
select 'no policy without an owner check',
       case when count(*) = 0 then 'ok' else count(*) || ' policy(ies) lack auth.uid()' end
  from pg_policies where schemaname = 'public' and tablename = 'world_maps'
   and coalesce(qual, '') not like '%auth.uid()%' and coalesce(with_check, '') not like '%auth.uid()%'
union all
select 'touch trigger',
       case when count(*) = 1 then 'ok' else 'MISSING' end
  from pg_trigger where tgname = 'world_maps_touch' and not tgisinternal;
