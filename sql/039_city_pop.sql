-- ═══════════════════════════════════════════════════════════════════════════
-- 039 · THE NODE'S POPULATION BECOMES THE REAL ONE
--
-- Reported: "make it where cities match actual population and vital signs
-- match their node stats, 1 to 1."
--
-- tw_node_recon.population is a 200,000 baseline bled daily by corruption — a
-- simulation with no connection to any city. Meanwhile /src/city/population.js
-- knows the true figure, where every person is accountable to a birth, an
-- arrival, a death or a departure. The two never met.
--
-- 🔴 ADDITIVE ONLY. Nothing here drops, renames or rewrites an existing column.
--    `population`, `civilians_total` and `residents` keep their current values
--    and meanings; city_pop/city_cap are NEW and start at 0, so a node with no
--    city behaves exactly as it does today. Rollback is at the bottom.
--
-- ⚠ city_pop AND city_cap TRAVEL TOGETHER, ON PURPOSE. CIVILIZATION is
--   population/civilians_total and TRADE STABILITY is derived from it, and
--   trade stability SCALES THE RESOURCE PAYOUT. A real population over the
--   fictional 200,000 denominator would read ~0% on every node and quietly cut
--   every player's income to nothing. Both numbers are real or neither is used.
--
-- ⚠ THIS IS CLIENT-REPORTED, like buildings_restored and residents before it,
--   and UNLIKE population — which the server ticks and no client can set. The
--   per-user caps below bound what one account can claim; they do not make the
--   figure trustworthy. Read the note in index.html at _twNodeCivilization.
-- ═══════════════════════════════════════════════════════════════════════════

-- one row per player per node — the same shape tw_node_residency uses
create table if not exists public.tw_node_citypop (
  node_id    text not null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  pop        integer not null default 0,
  cap        integer not null default 0,
  updated_at timestamptz default now(),
  primary key (node_id, user_id)
);
alter table public.tw_node_citypop enable row level security;
drop policy if exists tncp_sel on public.tw_node_citypop;
create policy tncp_sel on public.tw_node_citypop for select to authenticated using (true);
drop policy if exists tncp_mod on public.tw_node_citypop;
create policy tncp_mod on public.tw_node_citypop for all to authenticated using (user_id = auth.uid());

-- the summed pair on the shared node row
alter table public.tw_node_recon add column if not exists city_pop integer not null default 0;
alter table public.tw_node_recon add column if not exists city_cap integer not null default 0;

-- set MY city's figures on this node, then re-sum every city standing on it.
-- Mirrors tw_set_residency exactly: per-user row, server-side SUM, one write.
create or replace function public.tw_set_city_pop(p_node_id text, p_pop integer, p_cap integer)
returns json language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_pop integer; v_cap integer; v_row json;
begin
  if p_node_id is null or v_uid is null then return null; end if;
  -- a city that no longer exists stops counting, rather than freezing forever
  if coalesce(p_pop, 0) <= 0 and coalesce(p_cap, 0) <= 0 then
    delete from public.tw_node_citypop where node_id = p_node_id and user_id = v_uid;
  else
    insert into public.tw_node_citypop (node_id, user_id, pop, cap, updated_at)
      values (p_node_id, v_uid,
              greatest(0, least(1000000, coalesce(p_pop, 0))),
              greatest(0, least(1000000, coalesce(p_cap, 0))),
              now())
      on conflict (node_id, user_id) do update
        set pop = excluded.pop, cap = excluded.cap, updated_at = now();
  end if;
  select coalesce(sum(pop), 0), coalesce(sum(cap), 0) into v_pop, v_cap
    from public.tw_node_citypop where node_id = p_node_id;
  insert into public.tw_node_recon (node_id, city_pop, city_cap) values (p_node_id, v_pop, v_cap)
    on conflict (node_id) do update set city_pop = v_pop, city_cap = v_cap, updated_at = now();
  select row_to_json(t) into v_row from public.tw_node_recon t where t.node_id = p_node_id;
  return v_row;
end; $function$;

-- ROLLBACK (nothing else references these):
--   drop function if exists public.tw_set_city_pop(text, integer, integer);
--   alter table public.tw_node_recon drop column if exists city_pop;
--   alter table public.tw_node_recon drop column if exists city_cap;
--   drop table if exists public.tw_node_citypop;
