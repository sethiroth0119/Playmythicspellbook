-- =============================================================================
-- 🔥 tw_node cinder bank — a node now GENERATES cinder for its owner based on how
-- alive it is. Daily (in the same authoritative 24h tick) each node accrues cinder
-- into its BANK from: registered players, contributing players, and node health
-- (trade stability, civilization, % rebuilt). A node with nobody registered earns
-- nothing. The node owner can COLLECT the bank into their cinder wallet.
--
--   daily = registered>0 ? round(registered*30 + contributors*50
--                                 + trade%*4 + civ%*3 + rebuilt%*6) : 0
--   cinder_total = lifetime generated (the "TOTAL CINDER GENERATED" figure)
--   cinder_bank  = uncollected payout the owner can claim
--
-- Run ONCE in the Supabase SQL editor (or `supabase db push`). Idempotent.
-- Requires Stage 1/2/milestones/upgrades migrations.
-- =============================================================================

alter table public.tw_node_recon add column if not exists cinder_total bigint not null default 0;
alter table public.tw_node_recon add column if not exists cinder_bank  bigint not null default 0;

-- ── tw_node_sim_sync — re-applied: GARRISON protection + DAILY CINDER accrual ─
create or replace function public.tw_node_sim_sync(p_force_days integer default 0)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_now        timestamptz := now();
  v_changed    integer := 0;
  r            record;
  v_days       integer;
  v_players    integer;
  v_contrib    integer;
  v_prot       numeric;
  v_corr       integer;
  v_pop        integer;
  v_civ        integer;
  v_trade      integer;
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
    v_prot := least(18, coalesce(v_players, 0) * 1.5 + coalesce(r.garrison, 0) * 1.5);

    v_corr := r.corruption;
    v_pop  := r.population;
    i := 0;
    while i < v_days loop
      v_corr := greatest(0, least(100, v_corr + round(2 - v_prot)::int));
      v_pop  := greatest(0, v_pop - round(v_pop * v_corr / 100.0 * 0.03)::int);
      i := i + 1;
    end loop;

    -- derived health (mirrors the client): civilization, trade stability, rebuilt%
    v_roadsfrac := case when r.roads_total > 0 then r.roads_repaired::numeric / r.roads_total else 0 end;
    v_civ   := greatest(0, least(100, round(
                 (v_pop::numeric / nullif(r.civilians_total, 0)) * 82
               + (r.buildings_restored::numeric / nullif(r.buildings_total, 0)) * 18
               + coalesce(r.civic, 0) * 5)))::int;
    v_trade := greatest(0, least(100, round(v_civ * 0.62 + v_roadsfrac * 30 - v_corr * 0.12)))::int;
    v_rebuilt := round((v_roadsfrac * 0.5
               + (case when r.buildings_total > 0 then r.buildings_restored::numeric / r.buildings_total else 0 end) * 0.5) * 100)::int;

    -- cinder generated per day — nothing if nobody is registered to the node
    v_daily := case when coalesce(v_players, 0) > 0
                    then greatest(0, round(v_players * 30 + coalesce(v_contrib, 0) * 50 + v_trade * 4 + v_civ * 3 + v_rebuilt * 6))::bigint
                    else 0 end;

    update public.tw_node_recon set
      corruption   = v_corr,
      population   = v_pop,
      cinder_total = cinder_total + v_daily * v_days,
      cinder_bank  = cinder_bank  + v_daily * v_days,
      last_tick_at = case when coalesce(p_force_days,0) > 0 then v_now
                          else r.last_tick_at + (v_days || ' days')::interval end,
      updated_at   = v_now
    where node_id = r.node_id;
    v_changed := v_changed + 1;
  end loop;
  return json_build_object('changed', v_changed, 'at', v_now);
end; $$;
grant execute on function public.tw_node_sim_sync(integer) to authenticated;

-- ── tw_node_collect_bank — the node OWNER withdraws the accrued cinder bank ───
-- Owner-gated (tw_node_owners). Atomically zeroes the bank and returns the amount;
-- the client credits the owner's cinder wallet. ⚠ Cinder has a real-money exchange
-- rate — keep this owner-gated. PRODUCTION HARDENING: credit the wallet inside this
-- same transaction (service-role) rather than trusting the client to add it.
create or replace function public.tw_node_collect_bank(p_node_id text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_owner boolean;
  v_amount bigint;
begin
  if v_uid is null or p_node_id is null then return json_build_object('ok', false, 'reason', 'auth'); end if;
  select exists(select 1 from public.tw_node_owners where node_id = p_node_id and user_id = v_uid) into v_owner;
  if not v_owner then return json_build_object('ok', false, 'reason', 'not_owner'); end if;

  select cinder_bank into v_amount from public.tw_node_recon where node_id = p_node_id for update;
  v_amount := coalesce(v_amount, 0);
  if v_amount <= 0 then return json_build_object('ok', false, 'reason', 'empty', 'amount', 0); end if;

  update public.tw_node_recon set cinder_bank = 0, updated_at = now() where node_id = p_node_id;
  return json_build_object('ok', true, 'amount', v_amount);
end; $$;
grant execute on function public.tw_node_collect_bank(text) to authenticated;

-- ── tw_node_recon_reset — re-applied: also clears the cinder total + bank ─────
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
      cinder_total       = 0,
      cinder_bank        = 0,
      last_tick_at       = null,
      updated_at         = now();
  delete from public.tw_node_contrib where node_id = p_node_id;
  delete from public.tw_node_milestone_claims where node_id = p_node_id;
end; $$;
grant execute on function public.tw_node_recon_reset(text, integer, integer, integer) to authenticated;
