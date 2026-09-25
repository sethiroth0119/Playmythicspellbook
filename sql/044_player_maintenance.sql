-- ═══════════════════════════════════════════════════════════════════════════
-- 044 · MAINTENANCE MODE FOR ONE PLAYER, not the whole game
--
-- Asked for: "Make a maintenance mode button that I can put certain players in
-- maintenance mode in user management."
--
-- The game already HAS a maintenance lock — Forge.maintenance, published on the
-- catalogue, which holds every non-admin on the "DOWN FOR MAINTENANCE" screen.
-- It is all-or-nothing: to work on one player's save you had to shut the game
-- for everybody. This is the same lock, addressed to one account.
--
-- 🔴 A SEPARATE TABLE, NOT A COLUMN ON user_profiles, AND THE REASON IS THE
--    CLIENT'S OWN SAVE. user_profiles rows are written by the player's own
--    client, wholesale, on every cloud sync. An admin flag living in that row
--    is one sync away from being erased by the very person it is meant to hold
--    — and it would be erased silently, at the exact moment they reconnect,
--    which is the moment the flag matters most. Nothing the player's client
--    writes can reach this table.
--
-- ⚠ THE PLAYER MUST BE ABLE TO READ THEIR OWN ROW. That is not a leak, it is
--   the enforcement: the client cannot hold someone on a screen for a flag it
--   is not allowed to see. Only an admin may WRITE one.
--
-- ⚠ RLS `to authenticated` RETURNS ZERO ROWS WITH NO ERROR FOR AN ANON CLIENT.
--   That trap has already cost this project two production lockouts this
--   month — node owners told they owned no node, and the shared world map read
--   as empty. The client half of this feature therefore treats "no session" as
--   UNKNOWN and never as "not in maintenance"; see _maintFetchMine in
--   index.html. Stated here because the table is where the assumption starts.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.player_maintenance (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  enabled     boolean not null default true,
  title       text,
  message     text,
  -- 🕓 WHEN THE SHUTTER CAME DOWN, AND WHEN IT WENT BACK UP. Not bookkeeping:
  --    maintenanceFrozenMs() (index.html) subtracts this window from every
  --    wall-clock accrual, so a player held for repairs does not come back to
  --    a larder that was billed for cycles they were locked out of. The global
  --    lock learned that the hard way; the per-player one inherits the fix.
  since       timestamptz not null default now(),
  ended_at    timestamptz,
  set_by      uuid references auth.users(id) on delete set null,
  set_by_name text,
  updated_at  timestamptz not null default now()
);

alter table public.player_maintenance enable row level security;

-- ── the player reads their own row; an admin reads everyone's ──────────────
drop policy if exists pm_sel on public.player_maintenance;
create policy pm_sel on public.player_maintenance
  for select to authenticated
  using (user_id = auth.uid() or is_admin());

-- ── …and only an admin may put anybody in maintenance, or take them out ────
drop policy if exists pm_ins on public.player_maintenance;
create policy pm_ins on public.player_maintenance
  for insert to authenticated with check (is_admin());
drop policy if exists pm_upd on public.player_maintenance;
create policy pm_upd on public.player_maintenance
  for update to authenticated using (is_admin()) with check (is_admin());
drop policy if exists pm_del on public.player_maintenance;
create policy pm_del on public.player_maintenance
  for delete to authenticated using (is_admin());

create index if not exists player_maintenance_enabled
  on public.player_maintenance (enabled) where enabled;

-- ROLLBACK (nothing else references this table; dropping it releases everyone):
--   drop table if exists public.player_maintenance;
