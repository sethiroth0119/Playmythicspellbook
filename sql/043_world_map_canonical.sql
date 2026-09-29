-- ═══════════════════════════════════════════════════════════════════════════
-- 043 · ONE WORLD MAP, SHARED — instead of ninety private copies
--
-- Asked for: "this map needs a multiplayer feature where the game knows that
-- all these on the map belong to other players… and yes [do the migration]."
--
-- 🔴 THE ARCHITECTURAL PROBLEM THIS FIXES. Forge.territoryWars — the regions,
--    sectors and NODES of the War Map — was stored inside each player's own
--    user_profiles.forge blob, and copies were reconciled by _preferRicherObj,
--    which keeps whichever whole object weighs more. So every account carried
--    its own vintage of the world:
--
--      40 nodes … 31 profiles   ← the live map, updated today
--      39 nodes … 12 profiles
--      38 nodes …  8 profiles
--      37 nodes …  9 profiles
--      36 nodes …  5 profiles
--      34 nodes … 18 profiles
--      16 nodes … 15 profiles   ← the STARTER SEED, painted over a real map
--       0 nodes …  1 profile
--
--    Two players could stand on the same node id and see different names. A
--    shared world cannot be stored per player; that is the whole finding.
--
-- 🔴 THE NODES WERE NEVER LOST. Every name from the owner's screenshot — Hidn
--    Studios, Anomaly, KuyaGamerz, Talon Forge, Clarey City, Tartaria,
--    Sludgequeen, Lynox.Kelly, Hexia Quest, jirmz, A.C.E, the art of nodes — is
--    alive on 31 profiles right now. This migration does not recover anything.
--    It gives those nodes ONE home so they cannot drift apart again.
--
-- ⚠ NOTHING IS OVERWRITTEN AND NOTHING IS DELETED. Every profile keeps its own
--   copy exactly as it is; the client simply starts PREFERRING the canonical
--   row. A player whose profile still says 16 nodes is not edited — they just
--   read the shared map instead. That makes this reversible by deleting one
--   table, with no per-account repair.
--
-- ⚠ AND EVERY COPY IS BACKED UP FIRST ANYWAY, because "reversible in theory"
--   is not the same as "the bytes still exist".
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · back up every profile's map, before anything else happens ──────────
create table if not exists public.tw_world_map_backup_20260902 (
  user_id      uuid,
  display_name text,
  nodes        integer,
  tw           jsonb,
  updated_at   timestamptz,
  taken_at     timestamptz not null default now()
);
insert into public.tw_world_map_backup_20260902 (user_id, display_name, nodes, tw, updated_at)
select p.user_id, p.display_name,
       jsonb_array_length(coalesce(p.forge->'territoryWars'->'nodes','[]'::jsonb)),
       p.forge->'territoryWars', p.updated_at
  from public.user_profiles p
 where jsonb_typeof(p.forge->'territoryWars') = 'object'
   and not exists (select 1 from public.tw_world_map_backup_20260902);
alter table public.tw_world_map_backup_20260902 enable row level security;
-- no policy: the backup is reachable from the SQL editor only, never the client

-- ── 2 · the canonical map ──────────────────────────────────────────────────
create table if not exists public.tw_world_map (
  id         integer primary key default 1 check (id = 1),
  doc        jsonb   not null,          -- { regions, sectors, nodes }
  version    integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.tw_world_map enable row level security;
drop policy if exists twm_sel on public.tw_world_map;
-- 🔴 EVERY player reads the same map. That is the point.
create policy twm_sel on public.tw_world_map for select to authenticated using (true);
drop policy if exists twm_ins on public.tw_world_map;
drop policy if exists twm_upd on public.tw_world_map;
-- …and only an admin may change the world.
create policy twm_ins on public.tw_world_map for insert to authenticated with check (is_admin());
create policy twm_upd on public.tw_world_map for update to authenticated using (is_admin()) with check (is_admin());

-- ── 3 · seed it from the most-held, most-recent roster ─────────────────────
-- Chosen by evidence, not by picking a person: the roster 31 accounts agree on
-- AND that was written most recently. Ties would fall to recency.
insert into public.tw_world_map (id, doc, updated_at)
select 1,
       jsonb_build_object(
         'regions', coalesce(p.forge->'territoryWars'->'regions', '[]'::jsonb),
         'sectors', coalesce(p.forge->'territoryWars'->'sectors', '[]'::jsonb),
         'nodes',   coalesce(p.forge->'territoryWars'->'nodes',   '[]'::jsonb)),
       now()
  from public.user_profiles p
 where jsonb_array_length(coalesce(p.forge->'territoryWars'->'nodes','[]'::jsonb)) = (
         select max(jsonb_array_length(coalesce(q.forge->'territoryWars'->'nodes','[]'::jsonb)))
           from public.user_profiles q
       )
 order by p.updated_at desc nulls last
 limit 1
on conflict (id) do nothing;

-- ── 4 · publishing it, admin-only and atomic ───────────────────────────────
-- ⚠ THE VERSION IS THE WHOLE SAFETY OF THIS. A client that has not read the
--   current version cannot overwrite it, so two admins editing at once cannot
--   silently discard each other's work the way _preferRicherObj did.
create or replace function public.tw_publish_world_map(p_doc jsonb, p_version integer)
returns json language plpgsql security definer set search_path to 'public' as $fn$
declare v_cur integer; v_uid uuid := auth.uid();
begin
  if v_uid is null or not is_admin() then
    return json_build_object('ok', false, 'why', 'admin only');
  end if;
  -- 🔴 A MAP WITH NO NODES IS NOT A MAP. Publishing one would hand every player
  --    a blank world at once — the exact failure that started this.
  if p_doc is null or jsonb_typeof(p_doc->'nodes') <> 'array'
     or jsonb_array_length(p_doc->'nodes') = 0 then
    return json_build_object('ok', false, 'why', 'refused: the map has no nodes');
  end if;
  select version into v_cur from tw_world_map where id = 1;
  if v_cur is null then
    insert into tw_world_map (id, doc, version, updated_at, updated_by)
      values (1, p_doc, 1, now(), v_uid);
    return json_build_object('ok', true, 'version', 1);
  end if;
  if p_version is not null and p_version <> v_cur then
    return json_build_object('ok', false, 'why', 'stale', 'version', v_cur);
  end if;
  update tw_world_map
     set doc = p_doc, version = v_cur + 1, updated_at = now(), updated_by = v_uid
   where id = 1;
  return json_build_object('ok', true, 'version', v_cur + 1);
end; $fn$;

-- ROLLBACK (every profile still holds its own copy, untouched):
--   drop function if exists public.tw_publish_world_map(jsonb, integer);
--   drop table if exists public.tw_world_map;
--   -- the backup is kept deliberately; drop it only when you are sure:
--   -- drop table if exists public.tw_world_map_backup_20260902;
