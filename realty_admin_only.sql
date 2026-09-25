-- ═══════════════════════════════════════════════════════════════════════════
-- 👑 REAL ESTATE — creation restricted to ADMINS (server-side)
-- ---------------------------------------------------------------------------
-- Run ONCE in the Supabase SQL editor (project ktsiasyjusesawtrwrjc).
-- Safe to re-run: everything is IF NOT EXISTS / OR REPLACE / DROP-then-CREATE.
--
-- WHY THIS IS NEEDED
-- The game client already refuses to create a listing unless isAdmin() passes.
-- But isAdmin() is a CLIENT-SIDE email check, and the live RLS policy was:
--
--     create policy rl_ins on public.realty_listings for insert
--       to authenticated with check (seller_id = auth.uid());
--
-- ...which lets ANY signed-in player POST straight to the REST endpoint and
-- mint property, never touching the client gate. The client check is a UX
-- affordance; THIS file is the actual enforcement.
--
-- Selling, renting, buying and delisting are all left untouched — only the
-- creation of NEW primary supply becomes admin-only.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. A real server-side admin identity ───────────────────────────────────
-- The game had no server concept of "admin" at all (only ADMIN_EMAILS in the
-- bundle). This table is that concept, and any future policy can reuse it.
create table if not exists public.app_admins (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  email    text,
  added_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;

-- Readable by signed-in users so policies and the client can check membership.
-- Deliberately NO insert/update/delete policy: with RLS on and no write policy,
-- the REST API cannot modify this table at all. Adding an admin is a conscious
-- act performed here in the SQL editor, which is exactly what we want for the
-- table that decides who can mint property.
drop policy if exists aa_sel on public.app_admins;
create policy aa_sel on public.app_admins for select to authenticated using (true);

-- ── 2. Seed from the bundle's ADMIN_EMAILS ─────────────────────────────────
-- Matches on auth.users by email, so it only inserts accounts that exist.
insert into public.app_admins (user_id, email)
select u.id, lower(u.email)
  from auth.users u
 where lower(u.email) in (
         'richaegisop@gmail.com',
         'play@mythicsoa.com',
         'dev@mythicspellbook.com'
       )
on conflict (user_id) do nothing;

-- ── 3. The predicate policies use ──────────────────────────────────────────
create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.app_admins a where a.user_id = auth.uid());
$$;

grant execute on function public.is_app_admin() to authenticated;

-- ── 4. Lock listing CREATION to admins ─────────────────────────────────────
drop policy if exists rl_ins on public.realty_listings;
create policy rl_ins on public.realty_listings for insert to authenticated
  with check (seller_id = auth.uid() and public.is_app_admin());

-- ═══ VERIFY ════════════════════════════════════════════════════════════════
-- Expect one row per admin account that actually exists in auth.users:
--   select a.email, a.user_id from public.app_admins a order by a.email;
--
-- Expect the insert policy to carry the is_app_admin() check:
--   select polname, pg_get_expr(polwithcheck, polrelid) as with_check
--     from pg_policy
--    where polrelid = 'public.realty_listings'::regclass and polname = 'rl_ins';
--
-- Sanity: signed in as a NON-admin, this must now fail with a row-level
-- security violation rather than succeeding:
--   insert into public.realty_listings (seller_id, kind, prop_id, price)
--   values (auth.uid(), 'sale', 're_test', 1);
--
-- To add an admin later:
--   insert into public.app_admins (user_id, email)
--   select id, lower(email) from auth.users where lower(email) = 'someone@example.com'
--   on conflict (user_id) do nothing;
