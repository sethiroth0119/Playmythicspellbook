-- =============================================================================
-- 🏙️ card_shop_node — register a Card Shop to a District Node. A registered, OPEN
-- shop is local commerce: it BOOSTS the node (order / a Commerce stat / faster
-- repopulation) in the shared 24h tick, and the owner earns a DIVIDEND (Cinder +
-- the node's resource) scaled by node health AND the shop's recent sales volume.
--
-- Requires the node migrations (tw_node_recon + sim + upgrades + cinder bank) and
-- card_shops. Idempotent — run ONCE in the Supabase SQL editor.
-- =============================================================================

-- ── link a shop → a node ────────────────────────────────────────────────────
alter table public.card_shops add column if not exists node_id text;
alter table public.card_shops add column if not exists node_resource text;        -- the resource id the node pays (client-supplied)
alter table public.card_shops add column if not exists node_collected_at timestamptz;

-- ── new node stat: Commerce (grows with registered shops + trade) ────────────
alter table public.tw_node_recon add column if not exists commerce        int not null default 0;
alter table public.tw_node_recon add column if not exists shops_registered int not null default 0;
create index if not exists card_shops_node_idx on public.card_shops (node_id) where node_id is not null;

-- ── tw_node_sim_sync — RE-APPLIED: registered OPEN shops now feed the tick ────
-- Adds to the cinder-bank version (full reproduction so no prior effect is lost):
--   • shops add to PROTECTION  → corruption falls (ORDER / anti-corruption)
--   • COMMERCE stat = f(trade, shops)
--   • shops draw civilians back faster (FASTER REPOPULATION)
--   • commerce also lifts the node's daily cinder accrual
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
    -- ORDER: registered open shops add protection, like garrison / registered players
    v_prot := least(18, coalesce(v_players, 0) * 1.5 + coalesce(r.garrison, 0) * 1.5 + coalesce(v_shops, 0) * 1.0);

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

    v_roadsfrac := case when r.roads_total > 0 then r.roads_repaired::numeric / r.roads_total else 0 end;
    v_civ   := greatest(0, least(100, round(
                 (v_pop::numeric / nullif(r.civilians_total, 0)) * 82
               + (r.buildings_restored::numeric / nullif(r.buildings_total, 0)) * 18
               + coalesce(r.civic, 0) * 5)))::int;
    v_trade := greatest(0, least(100, round(v_civ * 0.62 + v_roadsfrac * 30 - v_corr * 0.12)))::int;
    -- COMMERCE stat: trade activity + the registered shops themselves
    v_commerce := greatest(0, least(100, round(v_trade * 0.5 + coalesce(v_shops, 0) * 12)))::int;
    v_rebuilt := round((v_roadsfrac * 0.5
               + (case when r.buildings_total > 0 then r.buildings_restored::numeric / r.buildings_total else 0 end) * 0.5) * 100)::int;

    -- daily cinder — commerce now lifts it too; still nothing if nobody registered
    v_daily := case when coalesce(v_players, 0) > 0
                    then greatest(0, round(v_players * 30 + coalesce(v_contrib, 0) * 50 + v_trade * 4 + v_civ * 3 + v_rebuilt * 6 + v_commerce * 2))::bigint
                    else 0 end;

    update public.tw_node_recon set
      corruption       = v_corr,
      population       = v_pop,
      commerce         = v_commerce,
      shops_registered = coalesce(v_shops, 0),
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

-- ── card_shop_register_node — link the caller's OPEN shop to a node ──────────
-- Switching nodes forfeits the unclaimed dividend (collected_at resets to now).
-- Maintains the cached shops_registered count on the old + new node.
create or replace function public.card_shop_register_node(p_node_id text, p_resource text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_old text;
  v_open boolean;
begin
  if v_uid is null or p_node_id is null then return json_build_object('ok', false, 'reason', 'auth'); end if;
  select node_id, open into v_old, v_open from public.card_shops where owner_id = v_uid;
  if not found then return json_build_object('ok', false, 'reason', 'no_shop'); end if;

  -- seed the node row if it doesn't exist yet (so a fresh district still works)
  insert into public.tw_node_recon (node_id) values (p_node_id) on conflict (node_id) do nothing;

  update public.card_shops
     set node_id = p_node_id, node_resource = p_resource, node_collected_at = now(), updated_at = now()
   where owner_id = v_uid;

  -- refresh cached open-shop counts on both nodes
  if v_old is not null and v_old <> p_node_id then
    update public.tw_node_recon t set shops_registered = (select count(*) from public.card_shops s where s.node_id = t.node_id and s.open = true) where t.node_id = v_old;
  end if;
  update public.tw_node_recon t set shops_registered = (select count(*) from public.card_shops s where s.node_id = t.node_id and s.open = true) where t.node_id = p_node_id;

  return json_build_object('ok', true, 'node_id', p_node_id, 'open', coalesce(v_open, false));
end; $$;
grant execute on function public.card_shop_register_node(text, text) to authenticated;

-- ── card_shop_unregister_node — leave the node (forfeits unclaimed dividend) ──
create or replace function public.card_shop_unregister_node()
returns json language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_old text;
begin
  if v_uid is null then return json_build_object('ok', false); end if;
  select node_id into v_old from public.card_shops where owner_id = v_uid;
  update public.card_shops set node_id = null, node_resource = null, node_collected_at = null, updated_at = now() where owner_id = v_uid;
  if v_old is not null then
    update public.tw_node_recon t set shops_registered = (select count(*) from public.card_shops s where s.node_id = t.node_id and s.open = true) where t.node_id = v_old;
  end if;
  return json_build_object('ok', true);
end; $$;
grant execute on function public.card_shop_unregister_node() to authenticated;

-- ── card_shop_node_dividend — accrue + claim the shop's node dividend ─────────
-- Requires the caller's shop to be OPEN and registered. Dividend = node-health
-- base × days-since-last-collect × a sales multiplier (recent card_shop_sales).
-- Returns the Cinder + resource UNITS to credit; the client adds them (same
-- posture as the node cinder bank). Resets node_collected_at.
create or replace function public.card_shop_node_dividend()
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_shop public.card_shops%rowtype;
  v_node public.tw_node_recon%rowtype;
  v_days numeric;
  v_sales bigint;
  v_mult numeric;
  v_base_cinder numeric;
  v_base_units numeric;
  v_cinder bigint;
  v_units integer;
  v_since timestamptz;
begin
  if v_uid is null then return json_build_object('ok', false, 'reason', 'auth'); end if;
  select * into v_shop from public.card_shops where owner_id = v_uid;
  if not found or v_shop.node_id is null then return json_build_object('ok', false, 'reason', 'not_registered'); end if;
  if not coalesce(v_shop.open, false) then return json_build_object('ok', false, 'reason', 'closed'); end if;

  select * into v_node from public.tw_node_recon where node_id = v_shop.node_id;
  if not found then return json_build_object('ok', false, 'reason', 'no_node'); end if;

  v_since := coalesce(v_shop.node_collected_at, now() - interval '1 hour');
  v_days  := least(30, greatest(0, extract(epoch from (now() - v_since)) / 86400.0));
  if v_days < 0.04 then return json_build_object('ok', false, 'reason', 'too_soon'); end if;  -- ~1h min

  -- recent sales (since last collect) drive the multiplier — rewards active shops
  select coalesce(sum(amount), 0) into v_sales from public.card_shop_sales where owner_id = v_uid and created_at > v_since;
  v_mult := least(2.5, 1.0 + coalesce(v_sales, 0) / 3000.0);

  -- node-health base per day
  v_base_cinder := 20 + coalesce(v_node.commerce, 0) * 1.5 + (case when v_node.restored then 40 else 0 end) + greatest(0, 30 - coalesce(v_node.corruption, 30));
  v_base_units  := 2  + coalesce(v_node.commerce, 0) * 0.30 + (case when v_node.restored then 5 else 0 end);

  v_cinder := greatest(0, round(v_base_cinder * v_days * v_mult))::bigint;
  v_units  := greatest(0, round(v_base_units  * v_days * v_mult))::int;

  update public.card_shops set node_collected_at = now(), updated_at = now() where owner_id = v_uid;

  return json_build_object('ok', true, 'cinder', v_cinder, 'units', v_units,
    'resource', v_shop.node_resource, 'node_id', v_shop.node_id,
    'days', round(v_days, 2), 'mult', round(v_mult, 2), 'sales', coalesce(v_sales, 0));
end; $$;
grant execute on function public.card_shop_node_dividend() to authenticated;
