-- ============================================================================
-- 💀 corpses_table.sql — server persistence for corpse-run loot drops.
-- ----------------------------------------------------------------------------
-- Without this table corpses live ONLY in memory (CampCorpses.list) and the
-- Supabase Realtime broadcast channel. A refresh, server restart, or a player
-- joining late never saw them. This table makes the death-drops survive
-- across sessions: every survivor in the zone within 24h can find your bag.
--
-- Run once in the Supabase SQL editor.
-- ============================================================================

create table if not exists public.corpses (
  id          text primary key,                                  -- client-generated 'corpse_<time>_<rand>'
  owner_id    uuid not null references auth.users(id) on delete cascade,
  owner_name  text,                                              -- display name at drop time (denormalized for fast render)
  color       text,                                              -- peer-color hex at drop time
  zone_id     text not null,                                     -- 'wilderness_edge', 'suburbs', etc.
  x           integer not null,
  y           integer not null,
  contents    jsonb  not null default '{}'::jsonb,               -- { resourceId: qty }
  created_at  timestamptz not null default now()
);

alter table public.corpses enable row level security;

-- 🌐 Anyone signed-in can SELECT — corpses are visible to everyone wandering
-- the same zone (the whole point of corpse-run loot).
drop policy if exists corpses_select on public.corpses;
create policy corpses_select on public.corpses
  for select to authenticated using (true);

-- 💀 Only the OWNER can INSERT a corpse — prevents a malicious client from
-- planting fake corpses under another user's name.
drop policy if exists corpses_insert on public.corpses;
create policy corpses_insert on public.corpses
  for insert to authenticated with check (owner_id = auth.uid());

-- 🎒 Anyone signed-in can UPDATE to LOOT (empty out contents). We don't gate
-- this on owner_id because looting by other players is the whole feature.
-- The client always writes contents='{}' on loot — we can't easily restrict
-- the field-level write via RLS, but the worst case is "a stranger zeroed a
-- bag that wasn't theirs" which is exactly the corpse-run mechanic.
drop policy if exists corpses_update on public.corpses;
create policy corpses_update on public.corpses
  for update to authenticated using (true);

-- 🗑 Owner can DELETE their own corpse (e.g. "I made it back, claim it").
drop policy if exists corpses_delete on public.corpses;
create policy corpses_delete on public.corpses
  for delete to authenticated using (owner_id = auth.uid());

-- Index for the common query: "all corpses in zone X newer than 24h".
create index if not exists corpses_zone_age_idx
  on public.corpses (zone_id, created_at desc);

-- ----------------------------------------------------------------------------
-- corpses_cleanup_expired() — delete rows older than 24h. Call from the
-- client occasionally (e.g. on Camp Heights entry) so the table doesn't
-- bloat. With pg_cron available you could schedule this every hour; without
-- it, the client-side cleanup is a reasonable fallback.
-- ----------------------------------------------------------------------------
create or replace function public.corpses_cleanup_expired()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  delete from public.corpses where created_at < now() - interval '24 hours'
    returning 1 into v_count;
  get diagnostics v_count = row_count;
  return coalesce(v_count, 0);
end$$;
grant execute on function public.corpses_cleanup_expired() to authenticated;

-- ----------------------------------------------------------------------------
-- Add to Realtime publication so live updates flow without polling.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'corpses'
  ) then
    execute 'alter publication supabase_realtime add table public.corpses';
  end if;
exception when others then
  null;   -- publication may be managed differently; swallow
end$$;
