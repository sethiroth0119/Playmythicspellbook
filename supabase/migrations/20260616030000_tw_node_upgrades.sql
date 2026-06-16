-- =============================================================================
-- 🏗 tw_node_upgrades — SINKS: registered players spend the node's resource to
-- buy shared, persistent node upgrades that benefit EVERY player at the node.
--   🛡 Garrison   → +protection (the server sim slows corruption)
--   ⚙ Refinery   → +resource yield (client-side, scaled by the shared trade)
--   🏛 Civic Hall → +civilization (→ trade stability → yield)
-- Levels are denormalized onto tw_node_recon (so they ride the existing fetch /
-- overlay — no new table). Resources are spent CLIENT-side before the bump (same
-- permissive, client-gated posture as tw_node_ads — see hardening note).
--
-- Run ONCE in the Supabase SQL editor (or `supabase db push`). Idempotent.
-- Requires Stage 1/2/milestones migrations.
-- =============================================================================

alter table public.tw_node_recon add column if not exists garrison integer not null default 0;
alter table public.tw_node_recon add column if not exists refinery integer not null default 0;
alter table public.tw_node_recon add column if not exists civic    integer not null default 0;

-- ── tw_node_buy_upgrade — atomic +1 level (capped) on a shared node upgrade ───
-- ⚠ Client pays the resource cost and gates this to registered players; the rpc
--   only ever +1's a capped level. PRODUCTION HARDENING: move the resource spend
--   server-side (an inventory table + a single transactional rpc) before this is
--   a competitive economy, so a crafted call can't get a free upgrade.
create or replace function public.tw_node_buy_upgrade(
  p_node_id text,
  p_kind text,
  p_max integer default 5,
  p_roads_total integer default 60,
  p_buildings_total integer default 48,
  p_civ_total integer default 200000
) returns json language plpgsql security definer set search_path = public as $$
declare v_row json;
begin
  if auth.uid() is null or p_node_id is null then return null; end if;

  insert into public.tw_node_recon (node_id, roads_total, buildings_total, civilians_total, population)
    values (p_node_id, coalesce(p_roads_total,60), coalesce(p_buildings_total,48), coalesce(p_civ_total,200000), coalesce(p_civ_total,200000))
    on conflict (node_id) do nothing;

  if p_kind = 'garrison' then
    update public.tw_node_recon set garrison = least(coalesce(p_max,5), garrison + 1), updated_at = now() where node_id = p_node_id;
  elsif p_kind = 'refinery' then
    update public.tw_node_recon set refinery = least(coalesce(p_max,5), refinery + 1), updated_at = now() where node_id = p_node_id;
  elsif p_kind = 'civic' then
    update public.tw_node_recon set civic = least(coalesce(p_max,5), civic + 1), updated_at = now() where node_id = p_node_id;
  else
    return null;
  end if;

  select row_to_json(t) into v_row from public.tw_node_recon t where t.node_id = p_node_id;
  return v_row;
end; $$;
grant execute on function public.tw_node_buy_upgrade(text, text, integer, integer, integer, integer) to authenticated;

-- ── tw_node_sim_sync — re-applied: GARRISON now adds to protection ───────────
-- protection = least(18, registered_players*1.5 + garrison*1.5)
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
    if coalesce(p_force_days, 0) > 0 then
      v_days := p_force_days;
    elsif r.last_tick_at is null then
      update public.tw_node_recon set last_tick_at = v_now where node_id = r.node_id;
      continue;
    else
      v_days := floor(extract(epoch from (v_now - r.last_tick_at)) / 86400)::int;
    end if;

    if v_days <= 0 then continue; end if;
    if v_days > 30 then v_days := 30; end if;

    select count(*) into v_players from public.tw_camp_registrations where node_id = r.node_id;
    v_prot := least(18, coalesce(v_players, 0) * 1.5 + coalesce(r.garrison, 0) * 1.5);

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

-- ── tw_node_recon_reset — re-applied: also clears upgrades ───────────────────
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
      milestones         = '[]'::jsonb,
      garrison           = 0,
      refinery           = 0,
      civic              = 0,
      last_tick_at       = null,
      updated_at         = now();
  delete from public.tw_node_contrib where node_id = p_node_id;
  delete from public.tw_node_milestone_claims where node_id = p_node_id;
end; $$;
grant execute on function public.tw_node_recon_reset(text, integer, integer, integer) to authenticated;
