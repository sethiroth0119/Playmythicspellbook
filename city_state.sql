-- ═══════════════════════════════════════════════════════════════════════════
-- 🏙 NODE CITY — cloud persistence + SERVER-SIDE node boost (v118j7)
-- Run in the Supabase SQL editor (same place as api.sql).
--   • city_state       — each player's city layout (owner-only RLS)
--   • city_node_links  — every player's city→node Link % (settlers + owner)
--   • city_push_node_boost(node,pct) — SECURITY DEFINER: upserts the caller's
--     link, AGGREGATES all fresh links for that node, and writes the result
--     onto economy_nodes.meta.cityLink — so every connected settler's city
--     strengthens the node OWNER's node, fully server-side.
--     Aggregate = strongest city + 40% of everyone else's, capped 100.
--     Links older than 24h don't count (dead cities stop shielding).
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.city_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  sync_pct integer not null default 0,
  node_id uuid,
  updated_at timestamptz default now()
);
alter table public.city_state enable row level security;
drop policy if exists city_state_own on public.city_state;
create policy city_state_own on public.city_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.city_node_links (
  node_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  pct integer not null default 0,
  updated_at timestamptz default now(),
  primary key (node_id, user_id)
);
alter table public.city_node_links enable row level security;
drop policy if exists city_links_read on public.city_node_links;
create policy city_links_read on public.city_node_links for select using (true);
-- writes happen only through the RPC below (security definer)

create or replace function public.city_push_node_boost(p_node_id uuid, p_pct integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_pct integer := greatest(0, least(100, coalesce(p_pct, 0)));
  v_max integer; v_sum integer; v_cnt integer; v_agg integer;
begin
  if auth.uid() is null then return null; end if;
  insert into city_node_links (node_id, user_id, pct, updated_at)
    values (p_node_id, auth.uid(), v_pct, now())
    on conflict (node_id, user_id) do update set pct = excluded.pct, updated_at = now();
  select coalesce(max(pct),0), coalesce(sum(pct),0), count(*)
    into v_max, v_sum, v_cnt
    from city_node_links
    where node_id = p_node_id and updated_at > now() - interval '24 hours';
  v_agg := least(100, v_max + round((v_sum - v_max) * 0.4));
  update economy_nodes set
    meta = coalesce(meta,'{}'::jsonb)
      || jsonb_build_object('cityLink', v_agg,
                            'cityLinkAt', (extract(epoch from now())*1000)::bigint,
                            'cityLinkCities', v_cnt),
    updated_at = now()
    where id = p_node_id;
  return v_agg;
end $$;
grant execute on function public.city_push_node_boost(uuid, integer) to authenticated;
