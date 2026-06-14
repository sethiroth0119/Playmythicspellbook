-- =============================================================================
-- 🏳 tw_camp_registrations — a player's CAMP registers to ONE District Node.
-- Cross-player: every signed-in player can read all registrations, so each
-- District Node's "Settlements" tab lists every camp registered to it. Exactly
-- one row per user (PK = user_id). The single-player camp keeps working without
-- this table; it just won't be visible to other players until it's created.
--
-- Run ONCE in the Supabase SQL editor. Idempotent / safe to re-run.
-- =============================================================================
create table if not exists public.tw_camp_registrations (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  node_id     text not null,
  camp_name   text not null default 'Camp Phoenix',
  prestige    integer not null default 0,
  contrib     integer not null default 0,
  corp_id     uuid,
  updated_at  timestamptz not null default now()
);
create index if not exists tw_camp_reg_node_idx on public.tw_camp_registrations (node_id);

alter table public.tw_camp_registrations enable row level security;

-- READ: any signed-in player can see all registrations (to populate the
-- per-node Settlements list across the whole player base).
drop policy if exists tw_camp_reg_sel on public.tw_camp_registrations;
create policy tw_camp_reg_sel on public.tw_camp_registrations
  for select to authenticated using (true);

-- WRITE: a player may only insert / update / delete their OWN row.
drop policy if exists tw_camp_reg_ins on public.tw_camp_registrations;
create policy tw_camp_reg_ins on public.tw_camp_registrations
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists tw_camp_reg_upd on public.tw_camp_registrations;
create policy tw_camp_reg_upd on public.tw_camp_registrations
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists tw_camp_reg_del on public.tw_camp_registrations;
create policy tw_camp_reg_del on public.tw_camp_registrations
  for delete to authenticated using (user_id = auth.uid());

-- Optional — live updates of the Settlements list as players (un)register.
-- Uncomment if Realtime is enabled for this project:
-- alter publication supabase_realtime add table public.tw_camp_registrations;
