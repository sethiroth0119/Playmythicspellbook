-- ============================================================================
-- 📊 USAGE EVENTS — global aggregation of card plays / hero picks / item equips
-- ----------------------------------------------------------------------------
-- One row per play event with the player's user_id, so the Player Market
-- "stocks" screen can show top cards / heroes / items aggregated across every
-- signed-in player (instead of just the local player's history).
--
-- Storage budget: with ~30 events/match and ~100 daily-active players, this
-- is ~3K rows/day. Trivial for Supabase free tier. Add a retention job later
-- if needed (drop rows older than N days).
-- ============================================================================

create table if not exists public.usage_events (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('card','hero','item')),
  ref_id      text not null,
  qty         int  not null default 1 check (qty between 1 and 1000),
  created_at  timestamptz not null default now()
);

create index if not exists usage_events_kind_ref_idx
  on public.usage_events (kind, ref_id);
create index if not exists usage_events_created_at_idx
  on public.usage_events (created_at desc);
create index if not exists usage_events_user_id_idx
  on public.usage_events (user_id);
create index if not exists usage_events_kind_created_at_idx
  on public.usage_events (kind, created_at desc);

-- 🔒 RLS — players can insert their own events and read their own back.
-- Aggregation is exposed via the security-definer RPC below, so no one needs
-- direct SELECT on every row.
alter table public.usage_events enable row level security;

drop policy if exists "usage_events_self_insert" on public.usage_events;
create policy "usage_events_self_insert" on public.usage_events
  for insert with check (user_id = auth.uid());

drop policy if exists "usage_events_self_read" on public.usage_events;
create policy "usage_events_self_read" on public.usage_events
  for select using (user_id = auth.uid());

-- 📈 usage_top — aggregated top N ref_ids for a kind, across ALL players.
-- Optional time-window filter (p_since_days null = all-time).
-- security definer so anon/authenticated callers can read aggregates without
-- needing per-row SELECT on the underlying table.
create or replace function public.usage_top(
  p_kind       text,
  p_limit      int default 25,
  p_since_days int default null
)
returns table (ref_id text, plays bigint, distinct_players bigint)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    ref_id,
    sum(qty)::bigint               as plays,
    count(distinct user_id)::bigint as distinct_players
  from public.usage_events
  where kind = p_kind
    and (p_since_days is null or created_at >= now() - (p_since_days::text || ' days')::interval)
  group by ref_id
  order by plays desc
  limit greatest(1, least(coalesce(p_limit, 25), 200));
$$;

grant execute on function public.usage_top(text, int, int) to anon, authenticated;

-- 📊 usage_global_totals — convenience helper for a quick "total plays" stat
-- across every player (used by the Faction Stocks summary cards).
create or replace function public.usage_global_totals(
  p_since_days int default null
)
returns table (kind text, plays bigint, distinct_players bigint)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    kind,
    sum(qty)::bigint                as plays,
    count(distinct user_id)::bigint as distinct_players
  from public.usage_events
  where (p_since_days is null or created_at >= now() - (p_since_days::text || ' days')::interval)
  group by kind
  order by plays desc;
$$;

grant execute on function public.usage_global_totals(int) to anon, authenticated;
