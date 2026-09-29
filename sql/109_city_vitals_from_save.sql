-- ═══════════════════════════════════════════════════════════════════════════
-- 109 · THE NODE'S VITAL SIGNS ARE THE CITY'S, ON EVERY SAVE
--
-- Reported: "Make all city VITAL SIGNS match their city builder VITAL SIGNS."
-- Two screenshots of the SAME node drawer: one reading "NPC POPULATION ·
-- LIVING 92,472 / 200.0K" off the legacy simulation, the other "CITY
-- POPULATION · LIVING 70 / 186 · 116 HOMES FREE" off the real city. The
-- drawer switches on tw_node_recon.city_cap > 0, and that column was only
-- ever written by tw_set_city_pop (sql/094) — which the client calls from
-- pushCityReport, i.e. only while the OWNER has the builder open, once a
-- minute, and never for a mayor. Measured on 2026-09-04: 36 cities on 30
-- nodes, 12 nodes carried a city_cap, 14 carried ZERO, 5 cities had no recon
-- row at all. Nearly half of every city in the game showed the wrong panel.
--
-- The save already carries the truth: city_state.state has npcPop (the
-- headcount), vitals.civilization and vitals.trade — and from this build a
-- vitalsSnap { pop, cap, civ, trade } written by serialize() with the same
-- numbers pushCityReport sends. So the mirror moves to the database: a
-- trigger on city_state keeps tw_city_pop / tw_node_recon in step with every
-- save, owner or mayor, builder open or not.
--
-- ⚠ THE BACKFILL TOUCHES ONLY THE MIRROR TABLES. The obvious `update
--   city_state set state = state` would fire sql/105's version trigger on
--   every city and make every open client believe another device had saved.
--   So the trigger body is a helper, and the backfill calls the helper.
-- ⚠ A SAVE FROM BEFORE vitalsSnap HAS NO CAPACITY. A city with people in it
--   must still read as a city, so the headcount stands in for the cap (the
--   drawer then prints "0 HOMES FREE") until the next save carries the real
--   figure. Zero cap on a real city is the bug this fixes; a pessimistic cap
--   for one save cycle is not.
-- ⚠ THE TRIGGER NEVER BLOCKS A SAVE. Any failure in the mirror is swallowed —
--   a player's city must not fail to save because a vitals column did.
-- ⚠ Sums per node, like tw_set_city_pop: two cities on one node add up; the
--   percentages are not summed, the most recent save's figure stands.
--
-- Idempotent and re-runnable. VERIFY block at the bottom.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0 · the per-player table sql/094 assumed and this project never had ────
-- tw_set_city_pop (094) writes public.tw_city_pop "the residency pattern —
-- the per-player table and the summing trigger are sql/039's". On this
-- project the table did not exist (measured 2026-09-04: relation
-- "public.tw_city_pop" does not exist), so 094's RPC has been throwing on
-- every call the client made — which is a second reason half the city nodes
-- carried no cap. RLS with no policy: only the definer functions touch it.
create table if not exists public.tw_city_pop (
  user_id    uuid not null references auth.users(id) on delete cascade,
  node_id    text not null,
  pop        integer not null default 0,
  cap        integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, node_id)
);
alter table public.tw_city_pop enable row level security;

create or replace function public.city_vitals_apply(p_user uuid, p_node text, p_state jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_node  text := btrim(coalesce(p_node, ''));
  v_pop   integer := 0;
  v_cap   integer := 0;
  v_civ   smallint := null;
  v_trade smallint := null;
  v_prev  integer := 0;
begin
  if p_user is null or v_node = '' or p_state is null then return; end if;

  -- headcount: the snapshot, else the live npcPop, else the demographics block
  begin
    v_pop := greatest(0, round(coalesce(
      nullif(p_state->'vitalsSnap'->>'pop', '')::numeric,
      nullif(p_state->>'npcPop', '')::numeric,
      nullif(p_state->'pop'->>'pop', '')::numeric,
      0)))::integer;
  exception when others then v_pop := 0; end;

  -- capacity: the snapshot only; older saves fall back to the headcount
  begin
    v_cap := greatest(0, round(coalesce(nullif(p_state->'vitalsSnap'->>'cap', '')::numeric, 0)))::integer;
  exception when others then v_cap := 0; end;
  if v_cap = 0 and v_pop > 0 then
    select coalesce(c.cap, 0) into v_prev from public.tw_city_pop c
     where c.user_id = p_user and c.node_id = v_node;
    v_cap := greatest(coalesce(v_prev, 0), v_pop);
  end if;

  begin
    if jsonb_typeof(p_state->'vitals'->'civilization') = 'number' then
      v_civ := greatest(0, least(100, round((p_state->'vitals'->>'civilization')::numeric)))::smallint;
    end if;
    if jsonb_typeof(p_state->'vitals'->'trade') = 'number' then
      v_trade := greatest(0, least(100, round((p_state->'vitals'->>'trade')::numeric)))::smallint;
    end if;
  exception when others then v_civ := null; v_trade := null; end;

  insert into public.tw_city_pop (user_id, node_id, pop, cap, updated_at)
  values (p_user, v_node, v_pop, v_cap, now())
  on conflict (user_id, node_id) do update
    set pop = excluded.pop, cap = excluded.cap, updated_at = now();

  insert into public.tw_node_recon (node_id) values (v_node)
  on conflict (node_id) do nothing;

  update public.tw_node_recon r
     set city_pop   = (select coalesce(sum(c.pop), 0) from public.tw_city_pop c where c.node_id = r.node_id),
         city_cap   = (select coalesce(sum(c.cap), 0) from public.tw_city_pop c where c.node_id = r.node_id),
         city_civ   = coalesce(v_civ,   r.city_civ),
         city_trade = coalesce(v_trade, r.city_trade),
         updated_at = now()
   where r.node_id = v_node;
end $$;

revoke all on function public.city_vitals_apply(uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.city_state_sync_vitals()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.city_vitals_apply(new.user_id, new.node_id, new.state);
  exception when others then
    -- the mirror is never a reason a city fails to save
    null;
  end;
  return new;
end $$;

drop trigger if exists city_state_sync_vitals on public.city_state;
create trigger city_state_sync_vitals
  after insert or update of state, node_id on public.city_state
  for each row execute function public.city_state_sync_vitals();

-- ── backfill: every city that exists today, through the helper only ────────
do $$
declare r record; n int := 0;
begin
  for r in select user_id, node_id, state from public.city_state where node_id is not null loop
    begin
      perform public.city_vitals_apply(r.user_id, r.node_id, r.state);
      n := n + 1;
    exception when others then null; end;
  end loop;
  raise notice 'city_vitals backfill: % cities mirrored', n;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY
--   select
--     (select count(distinct node_id) from city_state where node_id is not null) as city_nodes,
--     (select count(*) from tw_node_recon r where exists (select 1 from city_state c where c.node_id = r.node_id) and coalesce(r.city_cap,0) > 0) as with_cap,
--     (select count(*) from tw_node_recon r where exists (select 1 from city_state c where c.node_id = r.node_id) and coalesce(r.city_cap,0) = 0) as zero_cap;
--   -- expect zero_cap = 0 for every node whose city has anyone living in it.
--
--   select tgname, tgenabled from pg_trigger where tgrelid = 'public.city_state'::regclass;
--   -- expect city_state_sync_vitals present and enabled ('O').
--
-- ROLLBACK:
--   drop trigger if exists city_state_sync_vitals on public.city_state;
--   drop function if exists public.city_state_sync_vitals();
--   drop function if exists public.city_vitals_apply(uuid, text, jsonb);
-- ═══════════════════════════════════════════════════════════════════════════
