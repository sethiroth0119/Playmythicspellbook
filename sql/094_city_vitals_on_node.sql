-- ===========================================================================
-- 094 — A CITY'S OWN VITALS, ON THE SHARED NODE ROW.
--
-- OPTIONAL. Nothing breaks without it. Read this paragraph before running it.
--
-- The game already makes a player's OWN node map show their OWN city's
-- Civilization and Trade Stability: node-city reports them, index.html stashes
-- them per node in window._twCityVitals, and _twNodeCivilization /
-- _twNodeTradeStability prefer them over the old proxy. That is client-side and
-- this-player-only, which is all the reported problem needed — the same city
-- read 51 and 61 in its own Vital Signs and 82 and 47 on the map.
--
-- APPLY THIS ONLY IF you want OTHER players to see those figures when they
-- open your node. It adds two columns and extends tw_set_city_pop to carry
-- them, alongside city_pop / city_cap which sql/039 already writes.
--
-- 🔴 THESE TWO COLUMNS ARE CLIENT-REPORTED, AND THAT IS A REAL LIMIT.
--    `population` on this table is server-ticked by tw_node_sim_sync and no
--    client can set it. city_pop and city_cap already arrive from the player's
--    own browser (sql/039), and these two join them. The RPC bounds what ONE
--    account may claim for its own node; it does not make the number
--    trustworthy. Civilization feeds Trade Stability, and Trade Stability
--    SCALES THE RESOURCE PAYOUT every registered player collects from the
--    node — so a dishonest client can inflate its own node's yield.
--    Both values are therefore clamped 0..100 here, and the honest fix if this
--    ever matters is to move the city tick server-side. Do not extend this
--    pattern to anything that pays out directly.
--
-- Idempotent and re-runnable. Verify query at the bottom.
-- ===========================================================================

begin;

alter table public.tw_node_recon add column if not exists city_civ   smallint;
alter table public.tw_node_recon add column if not exists city_trade smallint;

comment on column public.tw_node_recon.city_civ is
  'Civilization 0-100 as reported by the city built on this node. CLIENT-REPORTED — see sql/094 header.';
comment on column public.tw_node_recon.city_trade is
  'Trade Stability 0-100 as reported by the city built on this node. CLIENT-REPORTED — see sql/094 header.';

-- --------------------------------------------------------------------------
-- tw_set_city_pop, extended. Same signature plus two OPTIONAL arguments, so
-- every existing caller keeps working untouched: a client that has not been
-- updated still sends two arguments and leaves the new columns alone.
--
-- ⚠ NULL MEANS "NOT REPORTED", NOT ZERO. A city that cannot compute a vital
--   must not be able to write 0 and drag the node's payout down; the columns
--   stay null and the drawer falls back to its own derivation.
-- --------------------------------------------------------------------------
create or replace function public.tw_set_city_pop(
  p_node_id text,
  p_pop     integer,
  p_cap     integer,
  p_civ     integer default null,
  p_trade   integer default null
)
returns public.tw_node_recon
language plpgsql
security definer
set search_path = public
as $f$
declare
  v_uid uuid := auth.uid();
  v_row public.tw_node_recon;
  v_civ   smallint := case when p_civ   is null then null else greatest(0, least(100, p_civ))::smallint end;
  v_trade smallint := case when p_trade is null then null else greatest(0, least(100, p_trade))::smallint end;
begin
  if v_uid is null then raise exception 'tw_set_city_pop: not authenticated'; end if;
  if p_node_id is null or btrim(p_node_id) = '' then raise exception 'tw_set_city_pop: node required'; end if;

  /* One row per player per node — the residency pattern. The per-player table
     and the summing trigger are sql/039's; this only adds the two vitals to
     the node row it maintains. */
  insert into public.tw_city_pop (user_id, node_id, pop, cap, updated_at)
  values (v_uid, btrim(p_node_id), greatest(0, coalesce(p_pop, 0)), greatest(0, coalesce(p_cap, 0)), now())
  on conflict (user_id, node_id) do update
    set pop = excluded.pop, cap = excluded.cap, updated_at = now();

  insert into public.tw_node_recon (node_id) values (btrim(p_node_id))
  on conflict (node_id) do nothing;

  update public.tw_node_recon r
     set city_pop = (select coalesce(sum(pop), 0) from public.tw_city_pop c where c.node_id = r.node_id),
         city_cap = (select coalesce(sum(cap), 0) from public.tw_city_pop c where c.node_id = r.node_id),
         /* The vitals are NOT summed — they are percentages, and a node with
            two cities on it has no single civilization. The most recent
            reporter's figure stands, which is what the drawer shows. */
         city_civ   = coalesce(v_civ,   r.city_civ),
         city_trade = coalesce(v_trade, r.city_trade),
         updated_at = now()
   where r.node_id = btrim(p_node_id)
  returning r.* into v_row;

  return v_row;
end;
$f$;

revoke all on function public.tw_set_city_pop(text, integer, integer, integer, integer) from public, anon;
grant execute on function public.tw_set_city_pop(text, integer, integer, integer, integer) to authenticated;

commit;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- 1) Both columns exist:
-- select column_name, data_type from information_schema.columns
--  where table_schema='public' and table_name='tw_node_recon'
--    and column_name in ('city_civ','city_trade');
--
-- 2) The five-argument form exists and the old two-argument callers still bind:
-- select pg_get_function_identity_arguments(p.oid)
--   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--  where n.nspname='public' and p.proname='tw_set_city_pop';
--
-- 3) Out-of-range claims are clamped, not stored:
-- select public.tw_set_city_pop('N-01', 70, 186, 999, -5);
--   -> city_civ 100, city_trade 0
--
-- 4) Nothing was overwritten with zeros by an old client:
-- select node_id, city_pop, city_cap, city_civ, city_trade
--   from public.tw_node_recon where city_cap > 0 order by city_pop desc limit 10;
-- ===========================================================================
