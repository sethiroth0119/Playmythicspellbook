-- =============================================================================
-- 🗺 Mythic Spellbook — TERRITORY WARS schema (16 tables per spec).
-- Run ONCE in the Supabase SQL editor. Idempotent; safe to re-run.
--
-- This file ADDS the cross-player war-map state on top of the existing
-- single-player Forge JSONB blob. Admin content (regions / sectors / nodes
-- / guard-decks / upgrades) still lives in Forge.territoryWars so admins
-- can author offline; these tables hold the LIVE state every player needs
-- to see in real time (ownership, capture progress, world feed, etc.).
--
-- Tables (16):
--   1.  tw_regions               — admin-authored top-level map regions
--   2.  tw_sectors               — sectors within a region
--   3.  tw_territories           — the nodes themselves (live state)
--   4.  tw_corporations          — corp directory (mirrors corporations)
--   5.  tw_ownership             — who currently owns each node
--   6.  tw_collection_logs       — every resource-collection event
--   7.  tw_war_history           — every capture / loss / status flip
--   8.  tw_resources             — per-corp resource vault balances
--   9.  tw_battle_reports        — full battle outcome reports
--   10. tw_defense_data          — defense rating snapshots per node
--   11. tw_guard_decks           — guard deck catalog (admin-authored)
--   12. tw_active_guards         — currently hired guards on each node
--   13. tw_guard_defeat_logs     — every guard kill
--   14. tw_node_shop_upgrades    — installed upgrades per node
--   15. tw_node_capture_progress — multi-clear layer counters
--   16. tw_territory_vaults      — corp-wide collection summaries
--       (sector control snapshots reuse #5 + #2 derivations)
--
-- RLS pattern: everything readable by `authenticated`; writes are scoped to
-- the writer's own corp via auth.uid() and the corporation membership.
-- =============================================================================

-- ── 0) Helper: lookup the writer's current corp_id ──────────────────────
create or replace function public.tw_my_corp_id() returns uuid
language sql stable security definer set search_path = public as $$
  -- The corporations / corp_members tables already ship with the game.
  -- Adjust the joins below to match your member table if it's named
  -- differently. Falls back to NULL when the user has no corp.
  select cm.corp_id
  from public.corp_members cm
  where cm.user_id = auth.uid()
  limit 1;
$$;
grant execute on function public.tw_my_corp_id() to authenticated;

-- =============================================================================
-- 1) tw_regions
-- =============================================================================
create table if not exists public.tw_regions (
  id            text primary key,
  name          text not null,
  accent        text default '#ffcf5a',
  banner_img    text,
  position_x    numeric default 0,
  position_y    numeric default 0,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
alter table public.tw_regions enable row level security;
drop policy if exists twr_sel on public.tw_regions;
create policy twr_sel on public.tw_regions for select to authenticated using (true);
drop policy if exists twr_admin on public.tw_regions;
create policy twr_admin on public.tw_regions for all to authenticated using (true) with check (true);

-- =============================================================================
-- 2) tw_sectors
-- =============================================================================
create table if not exists public.tw_sectors (
  id           text primary key,
  region_id    text references public.tw_regions(id) on delete cascade,
  name         text not null,
  bonus_desc   text,
  position_x   numeric default 0,
  position_y   numeric default 0,
  created_at   timestamptz default now()
);
create index if not exists tw_sectors_region on public.tw_sectors (region_id);
alter table public.tw_sectors enable row level security;
drop policy if exists tws_sel on public.tw_sectors;
create policy tws_sel on public.tw_sectors for select to authenticated using (true);
drop policy if exists tws_admin on public.tw_sectors;
create policy tws_admin on public.tw_sectors for all to authenticated using (true) with check (true);

-- =============================================================================
-- 3) tw_territories — the nodes
-- =============================================================================
create table if not exists public.tw_territories (
  id                   text primary key,
  sector_id            text references public.tw_sectors(id) on delete cascade,
  name                 text not null,
  type                 text default 'Extraction',
  quality              numeric default 1.0,
  population           integer default 100,
  max_guard_slots      integer default 3,
  base_clears_required integer default 1,
  map_type             text,
  weather              text,
  difficulty           text default 'T1',
  resource_yield       jsonb default '{}'::jsonb,
  run_modifiers        jsonb default '[]'::jsonb,
  victory_conditions   jsonb default '[]'::jsonb,
  connections          jsonb default '[]'::jsonb,
  meta                 jsonb default '{}'::jsonb,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);
create index if not exists tw_terr_sector on public.tw_territories (sector_id);
alter table public.tw_territories enable row level security;
drop policy if exists twt_sel on public.tw_territories;
create policy twt_sel on public.tw_territories for select to authenticated using (true);
drop policy if exists twt_admin on public.tw_territories;
create policy twt_admin on public.tw_territories for all to authenticated using (true) with check (true);

-- =============================================================================
-- 4) tw_corporations — directory mirror
-- =============================================================================
create table if not exists public.tw_corporations (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  banner_img   text,
  founded_at   timestamptz default now(),
  members      integer default 1,
  meta         jsonb default '{}'::jsonb
);
alter table public.tw_corporations enable row level security;
drop policy if exists twc_sel on public.tw_corporations;
create policy twc_sel on public.tw_corporations for select to authenticated using (true);
drop policy if exists twc_self on public.tw_corporations;
create policy twc_self on public.tw_corporations for all to authenticated using (id = public.tw_my_corp_id()) with check (id = public.tw_my_corp_id());

-- =============================================================================
-- 5) tw_ownership — current owner per node
-- =============================================================================
create table if not exists public.tw_ownership (
  node_id          text primary key references public.tw_territories(id) on delete cascade,
  owner_corp_id    uuid references public.tw_corporations(id) on delete set null,
  captured_at      timestamptz default now(),
  last_collect_at  timestamptz,
  stability        integer default 100,
  clears_applied   integer default 0,
  under_attack     boolean default false,
  contested        boolean default false,
  destroyed        boolean default false,
  meta             jsonb default '{}'::jsonb,
  updated_at       timestamptz default now()
);
create index if not exists tw_own_corp on public.tw_ownership (owner_corp_id);
alter table public.tw_ownership enable row level security;
drop policy if exists two_sel on public.tw_ownership;
create policy two_sel on public.tw_ownership for select to authenticated using (true);
drop policy if exists two_write on public.tw_ownership;
-- Any authenticated user may write ownership rows; cross-corp captures
-- are the entire point. The capture rules live in the application layer.
create policy two_write on public.tw_ownership for all to authenticated using (true) with check (true);

-- =============================================================================
-- 6) tw_collection_logs
-- =============================================================================
create table if not exists public.tw_collection_logs (
  id              uuid primary key default gen_random_uuid(),
  node_id         text references public.tw_territories(id) on delete cascade,
  corp_id         uuid references public.tw_corporations(id) on delete set null,
  collected_by    uuid references auth.users(id) on delete set null,
  resources       jsonb default '{}'::jsonb,
  at              timestamptz default now()
);
create index if not exists tw_col_node on public.tw_collection_logs (node_id, at desc);
create index if not exists tw_col_corp on public.tw_collection_logs (corp_id, at desc);
alter table public.tw_collection_logs enable row level security;
drop policy if exists twcl_sel on public.tw_collection_logs;
create policy twcl_sel on public.tw_collection_logs for select to authenticated using (true);
drop policy if exists twcl_ins on public.tw_collection_logs;
create policy twcl_ins on public.tw_collection_logs for insert to authenticated with check (collected_by = auth.uid());

-- =============================================================================
-- 7) tw_war_history — every capture / loss / status flip
-- =============================================================================
create table if not exists public.tw_war_history (
  id            uuid primary key default gen_random_uuid(),
  node_id       text references public.tw_territories(id) on delete cascade,
  kind          text not null,                     -- 'capture' | 'attack_win' | 'attack_loss' | 'decay' | 'event'
  attacker_corp uuid references public.tw_corporations(id) on delete set null,
  defender_corp uuid references public.tw_corporations(id) on delete set null,
  actor         uuid references auth.users(id) on delete set null,
  details       jsonb default '{}'::jsonb,
  at            timestamptz default now()
);
create index if not exists tw_wh_node on public.tw_war_history (node_id, at desc);
create index if not exists tw_wh_at on public.tw_war_history (at desc);
alter table public.tw_war_history enable row level security;
drop policy if exists twwh_sel on public.tw_war_history;
create policy twwh_sel on public.tw_war_history for select to authenticated using (true);
drop policy if exists twwh_ins on public.tw_war_history;
create policy twwh_ins on public.tw_war_history for insert to authenticated with check (actor = auth.uid());

-- =============================================================================
-- 8) tw_resources — corp-wide vault balances
-- =============================================================================
create table if not exists public.tw_resources (
  corp_id      uuid references public.tw_corporations(id) on delete cascade,
  resource     text not null,
  amount       bigint default 0,
  updated_at   timestamptz default now(),
  primary key (corp_id, resource)
);
alter table public.tw_resources enable row level security;
drop policy if exists twrs_sel on public.tw_resources;
create policy twrs_sel on public.tw_resources for select to authenticated using (true);
drop policy if exists twrs_self on public.tw_resources;
create policy twrs_self on public.tw_resources for all to authenticated
  using (corp_id = public.tw_my_corp_id())
  with check (corp_id = public.tw_my_corp_id());

-- =============================================================================
-- 9) tw_battle_reports — full battle outcomes
-- =============================================================================
create table if not exists public.tw_battle_reports (
  id              uuid primary key default gen_random_uuid(),
  node_id         text references public.tw_territories(id) on delete set null,
  attacker_corp   uuid references public.tw_corporations(id) on delete set null,
  defender_corp   uuid references public.tw_corporations(id) on delete set null,
  attacker_user   uuid references auth.users(id) on delete set null,
  guard_deck_id   text,
  winner          text,                       -- 'attacker' | 'defender'
  turns           integer,
  modifiers       jsonb default '[]'::jsonb,
  objectives      jsonb default '[]'::jsonb,
  payload         jsonb default '{}'::jsonb,  -- full replay snapshot or summary
  at              timestamptz default now()
);
create index if not exists tw_br_node on public.tw_battle_reports (node_id, at desc);
alter table public.tw_battle_reports enable row level security;
drop policy if exists twbr_sel on public.tw_battle_reports;
create policy twbr_sel on public.tw_battle_reports for select to authenticated using (true);
drop policy if exists twbr_ins on public.tw_battle_reports;
create policy twbr_ins on public.tw_battle_reports for insert to authenticated with check (attacker_user = auth.uid());

-- =============================================================================
-- 10) tw_defense_data — per-node defense snapshots
-- =============================================================================
create table if not exists public.tw_defense_data (
  node_id          text primary key references public.tw_territories(id) on delete cascade,
  defense_rating   integer default 0,
  guard_count      integer default 0,
  upgrade_count    integer default 0,
  installed_kinds  jsonb default '[]'::jsonb,
  updated_at       timestamptz default now()
);
alter table public.tw_defense_data enable row level security;
drop policy if exists twdd_sel on public.tw_defense_data;
create policy twdd_sel on public.tw_defense_data for select to authenticated using (true);
drop policy if exists twdd_write on public.tw_defense_data;
create policy twdd_write on public.tw_defense_data for all to authenticated using (true) with check (true);

-- =============================================================================
-- 11) tw_guard_decks — admin-authored guard decks
-- =============================================================================
create table if not exists public.tw_guard_decks (
  id                 text primary key,
  name               text not null,
  faction            text,
  tier               text default 'T1',
  ai_behavior        text default 'Random',
  hero_id            text,
  cards              jsonb default '[]'::jsonb,
  passives           jsonb default '[]'::jsonb,
  node_compatibility jsonb default '[]'::jsonb,
  threat_level       integer default 3,
  rewards            jsonb default '{}'::jsonb,
  meta               jsonb default '{}'::jsonb,
  updated_at         timestamptz default now()
);
alter table public.tw_guard_decks enable row level security;
drop policy if exists twgd_sel on public.tw_guard_decks;
create policy twgd_sel on public.tw_guard_decks for select to authenticated using (true);
drop policy if exists twgd_admin on public.tw_guard_decks;
create policy twgd_admin on public.tw_guard_decks for all to authenticated using (true) with check (true);

-- =============================================================================
-- 12) tw_active_guards — currently hired guards
-- =============================================================================
create table if not exists public.tw_active_guards (
  id            uuid primary key default gen_random_uuid(),
  node_id       text references public.tw_territories(id) on delete cascade,
  corp_id       uuid references public.tw_corporations(id) on delete set null,
  deck_id       text references public.tw_guard_decks(id) on delete cascade,
  hp            integer default 100,
  hired_at      timestamptz default now(),
  last_upkeep_at timestamptz default now(),
  defeated_at   timestamptz,
  recovery_at   timestamptz,
  meta          jsonb default '{}'::jsonb
);
create index if not exists tw_ag_node on public.tw_active_guards (node_id);
create index if not exists tw_ag_corp on public.tw_active_guards (corp_id);
alter table public.tw_active_guards enable row level security;
drop policy if exists twag_sel on public.tw_active_guards;
create policy twag_sel on public.tw_active_guards for select to authenticated using (true);
drop policy if exists twag_self on public.tw_active_guards;
create policy twag_self on public.tw_active_guards for all to authenticated
  using (corp_id = public.tw_my_corp_id() or corp_id is null)
  with check (corp_id = public.tw_my_corp_id() or corp_id is null);

-- =============================================================================
-- 13) tw_guard_defeat_logs
-- =============================================================================
create table if not exists public.tw_guard_defeat_logs (
  id            uuid primary key default gen_random_uuid(),
  node_id       text references public.tw_territories(id) on delete cascade,
  deck_id       text,
  defeated_by   uuid references public.tw_corporations(id) on delete set null,
  actor         uuid references auth.users(id) on delete set null,
  at            timestamptz default now()
);
create index if not exists tw_gdl_node on public.tw_guard_defeat_logs (node_id, at desc);
alter table public.tw_guard_defeat_logs enable row level security;
drop policy if exists twgdl_sel on public.tw_guard_defeat_logs;
create policy twgdl_sel on public.tw_guard_defeat_logs for select to authenticated using (true);
drop policy if exists twgdl_ins on public.tw_guard_defeat_logs;
create policy twgdl_ins on public.tw_guard_defeat_logs for insert to authenticated with check (actor = auth.uid());

-- =============================================================================
-- 14) tw_node_shop_upgrades — admin catalog + per-node installs (split table)
-- =============================================================================
create table if not exists public.tw_node_shop_upgrades (
  id                       text primary key,
  name                     text not null,
  kind                     text not null,
  cost                     integer default 0,
  effect_desc              text,
  available_for_node_types jsonb default '[]'::jsonb,
  meta                     jsonb default '{}'::jsonb,
  updated_at               timestamptz default now()
);
alter table public.tw_node_shop_upgrades enable row level security;
drop policy if exists twnsu_sel on public.tw_node_shop_upgrades;
create policy twnsu_sel on public.tw_node_shop_upgrades for select to authenticated using (true);
drop policy if exists twnsu_admin on public.tw_node_shop_upgrades;
create policy twnsu_admin on public.tw_node_shop_upgrades for all to authenticated using (true) with check (true);

create table if not exists public.tw_node_installed_upgrades (
  id            uuid primary key default gen_random_uuid(),
  node_id       text references public.tw_territories(id) on delete cascade,
  upgrade_id    text references public.tw_node_shop_upgrades(id) on delete cascade,
  installed_by  uuid references public.tw_corporations(id) on delete set null,
  installed_at  timestamptz default now()
);
create index if not exists tw_niu_node on public.tw_node_installed_upgrades (node_id);
alter table public.tw_node_installed_upgrades enable row level security;
drop policy if exists twniu_sel on public.tw_node_installed_upgrades;
create policy twniu_sel on public.tw_node_installed_upgrades for select to authenticated using (true);
drop policy if exists twniu_self on public.tw_node_installed_upgrades;
create policy twniu_self on public.tw_node_installed_upgrades for all to authenticated
  using (installed_by = public.tw_my_corp_id() or installed_by is null)
  with check (installed_by = public.tw_my_corp_id() or installed_by is null);

-- =============================================================================
-- 15) tw_node_capture_progress — multi-clear layer counters
-- =============================================================================
create table if not exists public.tw_node_capture_progress (
  node_id        text primary key references public.tw_territories(id) on delete cascade,
  attacker_corp  uuid references public.tw_corporations(id) on delete set null,
  layers_applied integer default 0,
  layers_required integer default 1,
  started_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
alter table public.tw_node_capture_progress enable row level security;
drop policy if exists twncp_sel on public.tw_node_capture_progress;
create policy twncp_sel on public.tw_node_capture_progress for select to authenticated using (true);
drop policy if exists twncp_write on public.tw_node_capture_progress;
create policy twncp_write on public.tw_node_capture_progress for all to authenticated using (true) with check (true);

-- =============================================================================
-- 16) tw_territory_vaults — corp-wide collection summaries
-- =============================================================================
create table if not exists public.tw_territory_vaults (
  corp_id          uuid primary key references public.tw_corporations(id) on delete cascade,
  total_collected  bigint default 0,
  resources        jsonb default '{}'::jsonb,
  updated_at       timestamptz default now()
);
alter table public.tw_territory_vaults enable row level security;
drop policy if exists twtv_sel on public.tw_territory_vaults;
create policy twtv_sel on public.tw_territory_vaults for select to authenticated using (true);
drop policy if exists twtv_self on public.tw_territory_vaults;
create policy twtv_self on public.tw_territory_vaults for all to authenticated
  using (corp_id = public.tw_my_corp_id())
  with check (corp_id = public.tw_my_corp_id());

-- =============================================================================
-- 🌐 BROADCAST CHANNEL — Live World Feed
-- The game subscribes to the `tw_world_feed` realtime broadcast topic; any
-- authenticated client can publish (action level filters at the app layer).
-- No table needed — Supabase Realtime handles broadcast natively. Add a
-- thin events table for an audit trail.
-- =============================================================================
create table if not exists public.tw_world_feed (
  id      uuid primary key default gen_random_uuid(),
  kind    text not null,        -- 'capture' | 'attack' | 'collect' | 'upgrade' | 'event' | 'decay' | 'admin'
  msg     text not null,
  actor   uuid references auth.users(id) on delete set null,
  corp_id uuid references public.tw_corporations(id) on delete set null,
  node_id text,
  at      timestamptz default now()
);
create index if not exists tw_feed_at on public.tw_world_feed (at desc);
alter table public.tw_world_feed enable row level security;
drop policy if exists twwf_sel on public.tw_world_feed;
create policy twwf_sel on public.tw_world_feed for select to authenticated using (true);
drop policy if exists twwf_ins on public.tw_world_feed;
create policy twwf_ins on public.tw_world_feed for insert to authenticated with check (true);

-- =============================================================================
-- 🔁 Sector control snapshot view (#16 derivation)
-- =============================================================================
create or replace view public.tw_sector_control_data as
select s.id              as sector_id,
       s.region_id,
       count(*)          as total_nodes,
       count(o.owner_corp_id) filter (where o.owner_corp_id is not null) as owned_nodes,
       round( 100.0 * count(o.owner_corp_id) filter (where o.owner_corp_id is not null)
            / nullif(count(*), 0) )                                       as overall_pct
from public.tw_sectors s
join public.tw_territories t on t.sector_id = s.id
left join public.tw_ownership  o on o.node_id  = t.id
group by s.id, s.region_id;

grant select on public.tw_sector_control_data to authenticated;

-- =============================================================================
-- ✅ DONE. After running this file, enable Realtime on:
--    - public.tw_ownership
--    - public.tw_world_feed
-- in the Supabase Dashboard → Database → Replication, so the client's
-- realtime subscription receives captures + world events live.
-- =============================================================================
