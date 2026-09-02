-- ============================================================================
-- 039_world_maps_games.sql
-- World Forge: one world per mini-game. Adds the `game` tag and the LIVE flag.
-- Idempotent. Re-runnable. Ends with a verify query. Requires 038.
--
-- Apply BY HAND in the Supabase SQL editor for project ktsiasyjusesawtrwrjc.
-- Until applied the editor still works: it stores `game` inside `data` and
-- the client's select for the new columns fails softly to "cloud unavailable"
-- → device saves. Apply 038 first if you have not.
--
-- ── WHAT THIS ADDS ──────────────────────────────────────────────────────────
--  game  text     which mini-game the map is for ('card-shop', 'battle', …)
--  live  boolean  THE map that mini-game loads. One per (owner, game),
--                 enforced by a partial unique index. Going live forces
--                 is_public = true (players must be able to read it) — done
--                 in a trigger so a client cannot create a live-but-private
--                 map that every player then fails to load.
-- ============================================================================

begin;

alter table public.world_maps add column if not exists game text not null default 'sandbox';
alter table public.world_maps add column if not exists live boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'world_maps_game_chk') then
    alter table public.world_maps add constraint world_maps_game_chk check (game ~ '^[a-z0-9_-]{1,40}$');
  end if;
end $$;

create unique index if not exists world_maps_live_uidx on public.world_maps (owner_id, game) where live;
create index if not exists world_maps_game_idx on public.world_maps (game, live, updated_at desc);

create or replace function public.world_maps_live_public() returns trigger
language plpgsql as $$
begin
  if new.live then new.is_public := true; end if;
  return new;
end $$;
drop trigger if exists world_maps_live_public on public.world_maps;
create trigger world_maps_live_public before insert or update on public.world_maps
  for each row execute function public.world_maps_live_public();

-- RLS from 038 already covers these columns: owner writes, public rows read.
-- No new policy is needed; re-asserting RLS is on is cheap insurance.
alter table public.world_maps enable row level security;

commit;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
select 'game column' as check_name,
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'world_maps' and column_name = 'game') then 'ok' else 'MISSING' end as result
union all
select 'live column',
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'world_maps' and column_name = 'live') then 'ok' else 'MISSING' end
union all
select 'one live per owner+game',
       case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'world_maps_live_uidx') then 'ok' else 'MISSING' end
union all
select 'live forces public',
       case when count(*) = 1 then 'ok' else 'MISSING' end
  from pg_trigger where tgname = 'world_maps_live_public' and not tgisinternal
union all
select 'no live private map',
       case when count(*) = 0 then 'ok' else count(*) || ' live rows are private' end
  from public.world_maps where live and not is_public;
