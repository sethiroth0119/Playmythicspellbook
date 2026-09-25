-- =============================================================================
-- 👑 tw_node_owners — admin assigns a District Node to a specific PLAYER.
-- That player (plus studio admins) may then publish sponsor ads on the node.
-- Cross-player: every signed-in player can read who owns what. One row per node
-- (PK = node_id). Run ONCE in the Supabase SQL editor. Idempotent / safe to re-run.
-- =============================================================================
create table if not exists public.tw_node_owners (
  node_id      text primary key,
  user_id      uuid not null,
  display_name text,
  assigned_by  uuid,
  updated_at   timestamptz not null default now()
);
create index if not exists tw_node_owners_user_idx on public.tw_node_owners (user_id);

alter table public.tw_node_owners enable row level security;

-- READ: any signed-in player can see node→player ownership.
drop policy if exists tw_node_owners_sel on public.tw_node_owners;
create policy tw_node_owners_sel on public.tw_node_owners
  for select to authenticated using (true);

-- WRITE: permissive for authenticated — assigning/removing an owner is an
-- ADMIN action gated in the client (matching this game's existing tw_* admin-
-- content model). ⚠ PRODUCTION HARDENING: replace `using (true)` with an
-- admins-table / is_admin() check (or a service-role Edge Function) so a crafted
-- API call can't grant itself ownership of a node.
drop policy if exists tw_node_owners_ins on public.tw_node_owners;
create policy tw_node_owners_ins on public.tw_node_owners
  for insert to authenticated with check (true);
drop policy if exists tw_node_owners_upd on public.tw_node_owners;
create policy tw_node_owners_upd on public.tw_node_owners
  for update to authenticated using (true) with check (true);
drop policy if exists tw_node_owners_del on public.tw_node_owners;
create policy tw_node_owners_del on public.tw_node_owners
  for delete to authenticated using (true);
