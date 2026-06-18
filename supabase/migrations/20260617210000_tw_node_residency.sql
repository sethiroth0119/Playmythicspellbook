-- =============================================================================
-- 🏠 tw_node_residency — owned/rented HOUSES stationed at a District Node add
-- RESIDENTS that, SHARED across all players, shield the node's population
-- (protection) and draw civilians back (repopulation). This is the server-side
-- aggregate of the client's local _twNodeSimTick residency (Real-Estate Phase 1),
-- so residents from EVERY player's homes count toward a node's defence.
--
-- Model (matches the client's local fallback):
--   residency_protection = least(6, total_residents / 20)   -- ON TOP of the
--     capped players+garrison+shops protection
--   each elapsed day, residents draw ~12 civilians/resident back, capped at the
--     node's civilian baseline.
--
-- Run ONCE in the Supabase SQL editor (idempotent). Requires the Stage-1 node
-- tables (20260616000000_tw_node_recon.sql) and the card-shop sim
-- (20260616100000_card_shop_node.sql — this re-defines tw_node_sim_sync on top
-- of that version, preserving garrison / shops / commerce / cinder logic).
-- =============================================================================

-- Aggregate column the client reads (cr.residents) for the recon row.
alter table public.tw_node_recon add column if not exists residents integer not null default 0;

-- Per-player residency at a node (sum across players = the node's residents).
create table if not exists public.tw_node_residency (
  node_id    text not null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  residents  integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (node_id, user_id)
);
create index if not exists tw_node_residency_node_idx on public.tw_node_residency (node_id);

alter table public.tw_node_residency enable row level security;
drop policy if exists tnr_sel on public.tw_node_residency;
create policy tnr_sel on public.tw_node_residency for select to authenticated using (true);
drop policy if exists tnr_mod on public.tw_node_residency;
create policy tnr_mod on public.tw_node_residency for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Set THIS player's residents at a node (0 removes their residency there) and
-- refresh the node's aggregate `residents` on tw_node_recon so the client sees
-- it immediately, before the next daily tick.
create or replace function public.tw_set_residency(p_node_id text, p_residents integer)
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_sum integer; v_row json;
begin
  if p_node_id is null or v_uid is null then return null; end if;
  if coalesce(p_residents, 0) <= 0 then
    delete from public.tw_node_residency where node_id = p_node_id and user_id = v_uid;
  else
    insert into public.tw_node_residency (node_id, user_id, residents, updated_at)
      values (p_node_id, v_uid, least(500, p_residents), now())
      on conflict (node_id, user_id) do update set residents = least(500, excluded.residents), updated_at = now();
  end if;
  select coalesce(sum(residents), 0) into v_sum from public.tw_node_residency where node_id = p_node_id;
  insert into public.tw_node_recon (node_id, residents) values (p_node_id, v_sum)
    on conflict (node_id) do update set residents = v_sum, updated_at = now();
  select row_to_json(t) into v_row from public.tw_node_recon t where t.node_id = p_node_id;
  return v_row;
end; $$;
grant execute on function public.tw_set_residency(text, integer) to authenticated;

-- Re-define the daily tick WITH residency. Body is the card_shop_node version
-- verbatim plus: residents add protection (capped +6) and repopulation, and the
-- aggregate `residents` is refreshed each tick.
create or replace function public.tw_node_sim_sync(p_force_days integer default 0)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_now        timestamptz := now();
  v_changed    integer := 0;
  r            record;
  v_days       integer;
  v_players    integer;
  v_contrib    integer;
  v_shops      integer;
  v_residents  integer;
  v_prot       numeric;
  v_corr       integer;
  v_pop        integer;
  v_civ        integer;
  v_trade      integer;
  v_commerce   integer;
  v_rebuilt    integer;
  v_roadsfrac  numeric;
  v_daily      bigint;
  i            integer;
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
    select count(*) into v_contrib from public.tw_node_contrib       where node_id = r.node_id;
    select count(*) into v_shops   from public.card_shops where node_id = r.node_id and open = true;
    select coalesce(sum(residents), 0) into v_residents from public.tw_node_residency where node_id = r.node_id;
    -- registered players + garrison + open shops are capped at 18; HOUSE RESIDENTS
    -- shield the node ON TOP of that (up to +6), matching the client.
    v_prot := least(18, coalesce(v_players, 0) * 1.5 + coalesce(r.garrison, 0) * 1.5 + coalesce(v_shops, 0) * 1.0)
              + least(6, coalesce(v_residents, 0) / 20.0);

    v_corr := r.corruption;
    v_pop  := r.population;
    i := 0;
    while i < v_days loop
      v_corr := greatest(0, least(100, v_corr + round(2 - v_prot)::int));
      v_pop  := greatest(0, v_pop - round(v_pop * v_corr / 100.0 * 0.03)::int);
      i := i + 1;
    end loop;
    -- FASTER REPOPULATION: shops draw civilians back (capped at the node's total)
    if coalesce(v_shops, 0) > 0 then
      v_pop := least(r.civilians_total, v_pop + (coalesce(v_shops, 0) * 300 * v_days));
    end if;
    -- 🏠 RESIDENTS draw civilians back too (~12/resident/day), capped at the baseline.
    if coalesce(v_residents, 0) > 0 then
      v_pop := least(r.civilians_total, v_pop + (coalesce(v_residents, 0) * 12 * v_days));
    end if;

    v_roadsfrac := case when r.roads_total > 0 then r.roads_repaired::numeric / r.roads_total else 0 end;
    v_civ   := greatest(0, least(100, round(
                 (v_pop::numeric / nullif(r.civilians_total, 0)) * 82
               + (r.buildings_restored::numeric / nullif(r.buildings_total, 0)) * 18
               + coalesce(r.civic, 0) * 5)))::int;
    v_trade := greatest(0, least(100, round(v_civ * 0.62 + v_roadsfrac * 30 - v_corr * 0.12)))::int;
    v_commerce := greatest(0, least(100, round(v_trade * 0.5 + coalesce(v_shops, 0) * 12)))::int;
    v_rebuilt := round((v_roadsfrac * 0.5
               + (case when r.buildings_total > 0 then r.buildings_restored::numeric / r.buildings_total else 0 end) * 0.5) * 100)::int;

    v_daily := case when coalesce(v_players, 0) > 0
                    then greatest(0, round(v_players * 30 + coalesce(v_contrib, 0) * 50 + v_trade * 4 + v_civ * 3 + v_rebuilt * 6 + v_commerce * 2))::bigint
                    else 0 end;

    update public.tw_node_recon set
      corruption       = v_corr,
      population       = v_pop,
      commerce         = v_commerce,
      shops_registered = coalesce(v_shops, 0),
      residents        = coalesce(v_residents, 0),
      cinder_total     = cinder_total + v_daily * v_days,
      cinder_bank      = cinder_bank  + v_daily * v_days,
      last_tick_at     = case when coalesce(p_force_days,0) > 0 then v_now
                              else r.last_tick_at + (v_days || ' days')::interval end,
      updated_at       = v_now
    where node_id = r.node_id;
    v_changed := v_changed + 1;
  end loop;
  return json_build_object('changed', v_changed, 'at', v_now);
end; $$;
grant execute on function public.tw_node_sim_sync(integer) to authenticated;
