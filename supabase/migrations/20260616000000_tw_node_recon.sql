-- =============================================================================
-- 🏗 tw_node_recon — SHARED, server-authoritative District Node reconstruction.
-- Until now each player rebuilt their OWN local copy of node.recon, so Player A
-- repairing roads was invisible to Player B (only the admin's published snapshot
-- was canonical). This makes the rebuild a real shared world: every signed-in
-- player reads the same roads/buildings/civilians totals, and contributions are
-- applied through an ATOMIC rpc so concurrent rebuilders can't clobber each other.
--
-- Tables:
--   tw_node_recon   — one row per node: the shared rebuild counters
--   tw_node_contrib — per-player ledger (who rebuilt what) → Contributors panel
-- RPCs:
--   tw_node_contribute(...) — atomic +buildings/+roads/+civ, capped at totals,
--                             writes the caller's ledger row, returns fresh state
--   tw_node_recon_reset(...) — admin reset to baseline (client-gated, see note)
--
-- Run ONCE in the Supabase SQL editor (or `supabase db push`). Idempotent.
-- The single-player rebuild keeps working without this table; it just won't be
-- shared across players until it exists (client calls degrade to a no-op).
-- =============================================================================

-- ── tw_node_recon — the shared per-node rebuild state ───────────────────────
create table if not exists public.tw_node_recon (
  node_id            text primary key,
  civilians_total    integer not null default 200000,
  civilians_saved    integer not null default 0,
  roads_total        integer not null default 60,
  roads_repaired     integer not null default 0,
  buildings_total    integer not null default 48,
  buildings_restored integer not null default 0,
  population         integer not null default 200000,
  corruption         integer not null default 30,
  campaigns_run      integer not null default 0,
  restored           boolean not null default false,
  last_tick_at       timestamptz,
  updated_at         timestamptz not null default now()
);

alter table public.tw_node_recon enable row level security;

-- READ: any signed-in player sees every node's shared rebuild progress.
drop policy if exists tw_node_recon_sel on public.tw_node_recon;
create policy tw_node_recon_sel on public.tw_node_recon
  for select to authenticated using (true);

-- Direct writes are NOT granted to players — all mutation goes through the
-- security-definer RPCs below (so the only writes possible are capped +N bumps
-- and the admin reset, never an arbitrary set).

-- ── tw_node_contrib — per-player contribution ledger ────────────────────────
create table if not exists public.tw_node_contrib (
  node_id     text not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  buildings   integer not null default 0,
  roads       integer not null default 0,
  civ         integer not null default 0,
  camp_name   text,
  updated_at  timestamptz not null default now(),
  primary key (node_id, user_id)
);
create index if not exists tw_node_contrib_node_idx on public.tw_node_contrib (node_id);

alter table public.tw_node_contrib enable row level security;

-- READ: any signed-in player can read the ledger (to render the Contributors
-- leaderboard on each node). WRITE is via the rpc only (security definer).
drop policy if exists tw_node_contrib_sel on public.tw_node_contrib;
create policy tw_node_contrib_sel on public.tw_node_contrib
  for select to authenticated using (true);

-- ── tw_node_contribute — ATOMIC rebuild contribution ────────────────────────
-- Seeds the node row on first touch (using the caller-supplied totals so the
-- admin-published node sizes carry over), then increments roads/buildings/civ
-- capped at their totals, bumps campaigns_run, and upserts the caller's ledger
-- row. Returns the fresh node row as json so the client can refresh its cache.
create or replace function public.tw_node_contribute(
  p_node_id text,
  p_buildings integer,
  p_roads integer,
  p_civ integer,
  p_roads_total integer default 60,
  p_buildings_total integer default 48,
  p_civ_total integer default 200000,
  p_camp_name text default null
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_b integer := greatest(0, coalesce(p_buildings, 0));
  v_r integer := greatest(0, coalesce(p_roads, 0));
  v_c integer := greatest(0, coalesce(p_civ, 0));
  v_row json;
begin
  if p_node_id is null or v_uid is null then return null; end if;

  insert into public.tw_node_recon (node_id, roads_total, buildings_total, civilians_total, population)
    values (p_node_id, coalesce(p_roads_total, 60), coalesce(p_buildings_total, 48), coalesce(p_civ_total, 200000), coalesce(p_civ_total, 200000))
    on conflict (node_id) do nothing;

  update public.tw_node_recon set
    roads_repaired     = least(roads_total, roads_repaired + v_r),
    buildings_restored = least(buildings_total, buildings_restored + v_b),
    civilians_saved    = least(civilians_total, civilians_saved + v_c),
    campaigns_run      = campaigns_run + 1,
    updated_at         = now()
  where node_id = p_node_id;

  insert into public.tw_node_contrib (node_id, user_id, buildings, roads, civ, camp_name, updated_at)
    values (p_node_id, v_uid, v_b, v_r, v_c, p_camp_name, now())
    on conflict (node_id, user_id) do update set
      buildings  = tw_node_contrib.buildings + v_b,
      roads      = tw_node_contrib.roads + v_r,
      civ        = tw_node_contrib.civ + v_c,
      camp_name  = coalesce(p_camp_name, tw_node_contrib.camp_name),
      updated_at = now();

  select row_to_json(t) into v_row from public.tw_node_recon t where t.node_id = p_node_id;
  return v_row;
end; $$;
grant execute on function public.tw_node_contribute(text, integer, integer, integer, integer, integer, integer, text) to authenticated;

-- ── tw_node_recon_reset — admin reset to baseline ───────────────────────────
-- Resets the shared counters to a fresh node (0 rebuilt, full population, 30%
-- corruption) and clears the per-node contribution ledger. Accepts fresh totals
-- so an admin who randomized node sizes carries the new sizes over.
-- ⚠ Like the tw_node_ads moderation RPCs, this is permissive (any authenticated
--   caller) and GATED IN THE CLIENT (only the admin Reset Nodes button calls it).
--   PRODUCTION HARDENING: gate on an admins table / is_admin() or move to a
--   service-role Edge Function before this is a competitive economy.
create or replace function public.tw_node_recon_reset(
  p_node_id text,
  p_roads_total integer default 60,
  p_buildings_total integer default 48,
  p_civ_total integer default 200000
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_node_id is null then return; end if;
  insert into public.tw_node_recon (node_id, roads_total, buildings_total, civilians_total, population, corruption, restored)
    values (p_node_id, coalesce(p_roads_total,60), coalesce(p_buildings_total,48), coalesce(p_civ_total,200000), coalesce(p_civ_total,200000), 30, false)
    on conflict (node_id) do update set
      roads_total        = coalesce(p_roads_total, 60),
      buildings_total    = coalesce(p_buildings_total, 48),
      civilians_total    = coalesce(p_civ_total, 200000),
      roads_repaired     = 0,
      buildings_restored = 0,
      civilians_saved    = 0,
      campaigns_run      = 0,
      population         = coalesce(p_civ_total, 200000),
      corruption         = 30,
      restored           = false,
      last_tick_at       = null,
      updated_at         = now();
  delete from public.tw_node_contrib where node_id = p_node_id;
end; $$;
grant execute on function public.tw_node_recon_reset(text, integer, integer, integer) to authenticated;

-- Optional — live Contributors panel as players rebuild (needs Realtime on):
-- alter publication supabase_realtime add table public.tw_node_recon;
-- alter publication supabase_realtime add table public.tw_node_contrib;
