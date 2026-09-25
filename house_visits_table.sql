-- ============================================================================
-- 🤝 house_visits_table.sql — sharable house-visit snapshots.
-- ----------------------------------------------------------------------------
-- A house owner generates a "visit link" pointing at a short code (8-char id).
-- Friends paste/open the link → the game fetches this row → renders the
-- owner's interior in read-only Visitor View. Snapshots expire after 7 days
-- so the table doesn't grow forever. The snapshot is just the interior JSON
-- + the listing fields needed to render (name, color, icon, capacity); no
-- player-identifying info beyond display_name.
--
-- Run once in the Supabase SQL editor.
-- ============================================================================

create table if not exists public.house_visits (
  code         text primary key,                                    -- short shareable id ('hv_abc123')
  owner_id     uuid not null references auth.users(id) on delete cascade,
  owner_name   text,                                                -- denormalized display_name at link-gen time
  listing      jsonb not null default '{}'::jsonb,                  -- { name, icon, color, capacity, address, blurb, image }
  interior     jsonb not null default '{}'::jsonb,                  -- { mapW, mapH, furniture: [...] }
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '7 days')
);

alter table public.house_visits enable row level security;

-- 🌐 Anyone (auth'd or not — visitors don't need to be signed in) can SELECT
-- by exact code. The code is the cap: nobody finds your house unless you
-- send them the link.
drop policy if exists house_visits_select on public.house_visits;
create policy house_visits_select on public.house_visits
  for select using (true);

-- 💀 Only the owner can INSERT / UPDATE / DELETE their own snapshot rows.
drop policy if exists house_visits_insert on public.house_visits;
create policy house_visits_insert on public.house_visits
  for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists house_visits_update on public.house_visits;
create policy house_visits_update on public.house_visits
  for update to authenticated using (owner_id = auth.uid());

drop policy if exists house_visits_delete on public.house_visits;
create policy house_visits_delete on public.house_visits
  for delete to authenticated using (owner_id = auth.uid());

-- Cleanup helper — call occasionally to GC expired snapshots.
create or replace function public.house_visits_cleanup_expired()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  delete from public.house_visits where expires_at < now();
  get diagnostics v_count = row_count;
  return coalesce(v_count, 0);
end$$;
grant execute on function public.house_visits_cleanup_expired() to authenticated;
