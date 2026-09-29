-- ════════════════════════════════════════════════════════════════════════════
-- 171 · GRID GUIDE — "How Nodes Pay", editable by admins only
-- ⚠ RENUMBERED from sql/132 (PR #7, never merged into this repo): 132 here is
--   132_node_inventory.sql. Same content, new number, nothing else changed.
--
-- Backs /src/gridguide: the player-facing explainer opened from the City Nodes
-- header. Every player (signed in or not) READS it; only an admin WRITES it.
--
-- ── WHY A VERSIONS TABLE AND NOT ONE ROW ────────────────────────────────────
-- Each save INSERTS a new row and the newest row is the guide. There is no
-- update and no delete policy, so a bad save can never destroy the last good
-- copy, and rolling back is re-inserting an older row's doc.
--
-- ── THE GATE ────────────────────────────────────────────────────────────────
-- ms_is_admin() (sql/062) — the JWT email against the same list as
-- ADMIN_EMAILS in index.html. The client hiding the Edit button is cosmetic;
-- this policy is the boundary. Photos go to the card-art bucket, whose write
-- policies in sql/062 are already admin-only, images only, 25 MB.
--
-- Idempotent. Safe to re-run. Ends with a verify query.
-- ════════════════════════════════════════════════════════════════════════════

-- The shared admin test (062/064/067 create this; repeated so 171 runs alone).
create or replace function public.ms_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(lower(auth.jwt() ->> 'email'), '') in (
    'richaegisop@gmail.com', 'play@mythicsoa.com', 'dev@mythicspellbook.com');
$$;
revoke all on function public.ms_is_admin() from public;
grant execute on function public.ms_is_admin() to authenticated, anon;

create table if not exists public.grid_guide_versions (
  id          bigserial primary key,
  doc         jsonb       not null,
  created_at  timestamptz not null default now(),
  created_by  uuid        not null default auth.uid(),
  -- The page is text plus photo URLs. A cap keeps a runaway paste from
  -- turning the guide every player downloads into megabytes.
  constraint grid_guide_doc_is_object check (jsonb_typeof(doc) = 'object'),
  constraint grid_guide_doc_size      check (octet_length(doc::text) <= 200000)
);

alter table public.grid_guide_versions enable row level security;

drop policy if exists grid_guide_read         on public.grid_guide_versions;
drop policy if exists grid_guide_admin_insert on public.grid_guide_versions;

-- Everyone reads: the guide is public game content.
create policy grid_guide_read on public.grid_guide_versions
  for select to anon, authenticated
  using (true);

-- Only an admin inserts, and only as themselves.
create policy grid_guide_admin_insert on public.grid_guide_versions
  for insert to authenticated
  with check (public.ms_is_admin() and created_by = auth.uid());

-- No update / delete policy on purpose (append-only). Belt and braces:
revoke update, delete, truncate on public.grid_guide_versions from anon, authenticated;
grant select on public.grid_guide_versions to anon, authenticated;
grant insert on public.grid_guide_versions to authenticated;
grant usage, select on sequence public.grid_guide_versions_id_seq to authenticated;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- EXPECT: rls_on = true, and exactly the two policies below.
select c.relrowsecurity as rls_on,
       (select string_agg(policyname || ':' || cmd, ', ' order by policyname)
          from pg_policies where schemaname = 'public' and tablename = 'grid_guide_versions') as policies,
       (select count(*) from public.grid_guide_versions) as saved_versions
  from pg_class c
 where c.oid = 'public.grid_guide_versions'::regclass;
