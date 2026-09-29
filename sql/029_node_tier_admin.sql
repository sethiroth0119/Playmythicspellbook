-- ===========================================================================
-- 029 — LET AN ADMIN SET A NODE'S TIER.
--
-- v120t8 adds PRN node tiers (Free 0.5% … Eternal Founder 20%). The tier is
-- stamped on economy_nodes.meta.tier — JSONB, so there is no schema change and
-- no new column to grant; every other per-node fact already lives there.
--
-- The one thing that does need changing is the UPDATE policy. It reads:
--
--     en_upd  UPDATE  using (owner_id = auth.uid()) with check (owner_id = auth.uid())
--
-- which is correct for a player maintaining their own node and wrong for the
-- feature being asked for: assigning a tier is an ADMIN act, performed on
-- somebody else's node from the Node City tier modal. Without this file the
-- admin's UPDATE matches zero rows and returns NO ERROR — the silent-no-op that
-- has now bitten this codebase twice (bank_of_ethos in 028, gifts in 027). The
-- client checks the returned row and says so, but the real fix is here.
--
-- ⚠ SCOPE: this widens economy_nodes UPDATE to admins for the WHOLE row, not
--   just meta.tier — Postgres RLS gates rows, not JSONB keys. That is the same
--   trust already granted to admins over gifts, detention and court records in
--   api.sql, and is_admin() is the verified top-level JWT email claim (never
--   user_metadata). If per-key control is ever wanted it needs a SECURITY
--   DEFINER setter, not a policy.
--
-- Idempotent and re-runnable. Verify query at the bottom.
-- ===========================================================================

drop policy if exists en_upd on public.economy_nodes;
create policy en_upd on public.economy_nodes
  for update to authenticated
  using      (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- 1) The policy must name both the owner AND is_admin() on each side:
--
-- select policyname, cmd, qual, with_check
--   from pg_policies
--  where schemaname='public' and tablename='economy_nodes' and cmd='UPDATE';
--
-- 2) A non-admin must still be unable to touch a node they do not own
--    (rolls back, changes nothing):
--
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims =
--     '{"sub":"<some NON-owner, NON-admin user_id>","role":"authenticated","email":"nobody@example.com"}';
--   update public.economy_nodes
--      set meta = jsonb_set(coalesce(meta,'{}'::jsonb), '{tier}', '"eternal"')
--    where id = '<a node they do not own>'
--    returning id;
--   -> expect ZERO rows
-- rollback;
--
-- 3) And an admin must be able to:
--
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims =
--     '{"sub":"<any user_id>","role":"authenticated","email":"play@mythicsoa.com"}';
--   update public.economy_nodes
--      set meta = jsonb_set(coalesce(meta,'{}'::jsonb), '{tier}', '"titan"')
--    where id = '<any node>'
--    returning id, meta->>'tier';
--   -> expect ONE row, tier = titan
-- rollback;
-- ===========================================================================
