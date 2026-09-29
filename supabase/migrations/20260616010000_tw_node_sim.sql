-- =============================================================================
-- 🕛 tw_node_sim — Stage 2: the 24-HOUR node clock becomes SERVER-AUTHORITATIVE.
-- Until now each client ran the daily drift on its OWN copy, so corruption /
-- population could diverge between players. Now the drift is computed once,
-- server-side, from the REAL registered-player count (public.tw_camp_registrations),
-- so every player reads identical corruption / population from public.tw_node_recon.
--
-- Model (per elapsed day, matching the client's local fallback constants):
--   protection = least(12, registered_players * 1.5)
--   corruption = clamp(corruption + 2 - protection, 0, 100)
--   population = max(0, population - round(population * corruption/100 * 0.03))
-- More registered players → more protection → corruption falls → population holds.
--
-- Lazy-on-read: tw_node_sim_sync() advances every node by the whole days elapsed
-- since its last_tick_at (capped, so a long quiet spell can't nuke a node). The
-- first player to load the War Map after midnight "pays" the tick for everyone.
-- Admin "Advance Day" passes p_force_days := 1 to force a day for testing.
--
-- Run ONCE in the Supabase SQL editor (or `supabase db push`). Idempotent.
-- Requires the Stage 1 tables (20260616000000_tw_node_recon.sql) to exist.
-- =============================================================================

-- ── tw_node_contribute — re-applied with an idempotent RESTORED rule ─────────
-- Same atomic contribution as Stage 1, plus: once a node is fully rebuilt
-- (roads + buildings maxed) it is flagged restored and its population recovers
-- to full. Idempotent — re-running on an already-restored node is a no-op.
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

  -- Fully rebuilt → RESTORED (population recovers). Idempotent.
  update public.tw_node_recon set
    restored   = true,
    population = civilians_total,
    updated_at = now()
  where node_id = p_node_id
    and restored = false
    and roads_repaired >= roads_total
    and buildings_restored >= buildings_total;

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

-- ── tw_node_sim_sync — the authoritative daily tick ──────────────────────────
-- Advances every node by the whole days elapsed (or p_force_days if > 0). Uses
-- FOR UPDATE SKIP LOCKED so concurrent callers never double-apply a day: the
-- first caller locks + ticks a row, the rest skip it. Returns how many nodes
-- changed. A node with last_tick_at = NULL is seeded (clock starts) without drift.
create or replace function public.tw_node_sim_sync(p_force_days integer default 0)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_now      timestamptz := now();
  v_changed  integer := 0;
  r          record;
  v_days     integer;
  v_players  integer;
  v_prot     numeric;
  v_corr     integer;
  v_pop      integer;
  i          integer;
begin
  for r in select * from public.tw_node_recon for update skip locked loop
    -- how many whole days to advance
    if coalesce(p_force_days, 0) > 0 then
      v_days := p_force_days;
    elsif r.last_tick_at is null then
      -- first sight: start the clock, no drift yet
      update public.tw_node_recon set last_tick_at = v_now where node_id = r.node_id;
      continue;
    else
      v_days := floor(extract(epoch from (v_now - r.last_tick_at)) / 86400)::int;
    end if;

    if v_days <= 0 then continue; end if;
    if v_days > 30 then v_days := 30; end if;   -- cap catch-up so a quiet spell can't zero a node

    -- protection from the REAL registered-player count on this node
    select count(*) into v_players from public.tw_camp_registrations where node_id = r.node_id;
    v_prot := least(12, coalesce(v_players, 0) * 1.5);

    v_corr := r.corruption;
    v_pop  := r.population;
    i := 0;
    while i < v_days loop
      v_corr := greatest(0, least(100, v_corr + round(2 - v_prot)::int));
      v_pop  := greatest(0, v_pop - round(v_pop * v_corr / 100.0 * 0.03)::int);
      i := i + 1;
    end loop;

    update public.tw_node_recon set
      corruption   = v_corr,
      population   = v_pop,
      last_tick_at = case when coalesce(p_force_days,0) > 0 then v_now
                          else r.last_tick_at + (v_days || ' days')::interval end,
      updated_at   = v_now
    where node_id = r.node_id;
    v_changed := v_changed + 1;
  end loop;
  return json_build_object('changed', v_changed, 'at', v_now);
end; $$;
grant execute on function public.tw_node_sim_sync(integer) to authenticated;
