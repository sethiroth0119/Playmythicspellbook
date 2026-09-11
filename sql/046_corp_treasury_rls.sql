-- ════════════════════════════════════════════════════════════════════════════
-- 046 — corp_treasury: stop publishing every corporation's finances
-- ════════════════════════════════════════════════════════════════════════════
-- Idempotent and re-runnable. Ships its own RLS. Ends with a verify query.
-- PENDING: apply this by hand in the Supabase SQL editor (project
-- ktsiasyjusesawtrwrjc). Nothing in this file has been run.
--
-- 🔴 WHAT IS WRONG TODAY. The policy shipped with the Reserve setup string is:
--
--     create policy ct_sel on public.corp_treasury
--       for select to authenticated using (true);
--
--   `using (true)` means ANY signed-in player can read EVERY row of EVERY
--   corporation's treasury: how much each guild holds, who deposited what and
--   when, which operations they funded and what they were charged. That is the
--   complete financial history of every rival guild in the game, one PostgREST
--   call away, and it looks perfectly fine in review — which is exactly why
--   `using (true)` is the thing to hunt for.
--
--   It is not hypothetical: corpTreasuryFetch() in index.html only ever asks
--   for its own corp (`eq('corp_id', Corp.mine.id)`), but the FILTER IS THE
--   CLIENT'S CHOICE. RLS is the boundary; a client filter is a suggestion.
--
-- ✅ WHAT THIS DOES. SELECT becomes membership-or-founder. INSERT additionally
--   requires membership, so a non-member can no longer write a line into
--   someone else's ledger (the old policy checked only that they were writing
--   as themselves — `user_id = auth.uid()` — which any signed-in player is).
--
-- 🔑 WHY A SECURITY DEFINER HELPER AND NOT A SUBQUERY.
--   A policy that queries a table whose own policies query it back recurses and
--   the query dies with "infinite recursion detected in policy". Today a
--   subquery on corp_members inside a corp_treasury policy happens NOT to
--   recurse, because corp_members' own SELECT policy is still `using (true)` —
--   i.e. it is safe only for as long as corp_members stays wide open, which is
--   the next thing someone will (rightly) fix. is_corp_member() is SECURITY
--   DEFINER, so it bypasses RLS and therefore terminates no matter what
--   corp_members' policies become later. Same pattern, same reason, as
--   is_community_member() in sql/001.
--
-- 🔴 AND WHY IT IS THE **TWO-ARGUMENT** HELPER, VERBATIM FROM sql/045.
--   sql/045 (corp vault) already defines
--       public.is_corp_member(p_corp_id uuid, p_user_id uuid default auth.uid())
--   An earlier draft of THIS file defined a second, one-argument
--       public.is_corp_member(p_corp_id uuid)
--   These are different signatures, so Postgres will happily create BOTH — and
--   then every existing one-argument call `is_corp_member(x)` matches both
--   candidates and dies with `function is_corp_member(uuid) is not unique`.
--   Two SECURITY DEFINER functions deciding "who is in this corporation" is
--   also exactly the duplication that lets one get tightened and the other not.
--   So: identical signature, identical body, `create or replace`. Applying 045
--   then 046, or 046 then 045, or either alone, all leave the same single
--   function — and section 1a below removes the one-arg overload if a draft of
--   this file was ever pasted into the SQL editor.
--
-- 📌 APPEND-ONLY IS ENFORCED BY OMISSION. There is deliberately no UPDATE and
--   no DELETE policy on this table. With RLS enabled, no policy = denied, so
--   the balance (sum(amount)) cannot be rewritten by anyone holding only the
--   anon/authenticated key. Do not "helpfully" add one. Corrections are made by
--   appending an offsetting row, which is why `refund` is a ledger kind.
--
-- 🙂 THE CLIENT WORKS EITHER WAY. index.html already scopes every read and
--   every insert to Corp.mine.id, and corpTreasuryFetch() treats a PostgREST
--   error as "not read" (Corp.treasuryKnown = false) rather than as an empty
--   treasury, so the Just Business Corp Treasury screen renders correctly
--   before this migration, after it, and offline. Applying it changes nothing a
--   legitimate member can see — it only removes what a non-member could.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 0. The table, if a fresh project has not run the Reserve setup string ───
-- Kept identical to the shape index.html writes, so this file is safe to run
-- first on a new project as well as against the live one.
create table if not exists public.corp_treasury (
  id         uuid primary key default gen_random_uuid(),
  corp_id    uuid not null references public.corporations(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete set null,
  amount     numeric not null default 0,
  kind       text not null default 'deposit',
  note       text,
  created_at timestamptz default now()
);
create index if not exists corp_treasury_corp on public.corp_treasury (corp_id, created_at desc);

alter table public.corp_treasury enable row level security;

-- ─── 1. Drop the policies FIRST, so section 1a can clean up ──────────────────
-- A policy that calls a function pins it: `drop function` on a function a live
-- policy references fails with "cannot drop ... because other objects depend on
-- it". Dropping the policies up here (rather than immediately before recreating
-- them) is what makes 1a work on a database where an earlier draft of this file
-- was already pasted in. Re-runnable: `if exists` on both.
drop policy if exists ct_sel on public.corp_treasury;
drop policy if exists ct_ins on public.corp_treasury;
-- No UPDATE / DELETE policy is ever created here; drop any that exist. See header.
drop policy if exists ct_upd on public.corp_treasury;
drop policy if exists ct_del on public.corp_treasury;

-- ─── 1a. Remove the one-argument overload, if a draft of this file created it ─
-- Harmless no-op on a clean database. On one where the earlier draft ran, this
-- is the line that prevents `function is_corp_member(uuid) is not unique` from
-- breaking sql/045's vault RPCs. Named by its exact signature, so sql/045's
-- two-argument function is untouched.
drop function if exists public.is_corp_member(uuid);

-- ─── 1b. The anti-recursion helper ───────────────────────────────────────────
-- ⚠ SIGNATURE AND BODY ARE VERBATIM sql/045. Do not "improve" one copy: see the
--   header. `create or replace` here means whichever of 045/046 is applied last
--   simply rewrites the identical function, in any order, any number of times.
-- The founder branch matters: a founder's corp_members row can be missing (it
-- is upserted lazily on their next sign-in), and locking a founder out of their
-- own treasury because of that would be a worse bug than the one being fixed.
create or replace function public.is_corp_member(p_corp_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_corp_id is not null
     and p_user_id is not null
     and (
       exists (select 1 from public.corp_members m
                where m.corp_id = p_corp_id and m.user_id = p_user_id)
       -- The founder is a member even when the corp_members row never landed.
       -- corpEnsure() in index.html already self-heals this case client-side;
       -- without the same allowance here a founder can be locked out of their
       -- own treasury by a missing row they never see.
       or exists (select 1 from public.corporations c
                   where c.id = p_corp_id and c.founder_id = p_user_id)
     );
$$;

revoke all on function public.is_corp_member(uuid, uuid) from public, anon;
grant execute on function public.is_corp_member(uuid, uuid) to authenticated;

-- ─── 2. Policies ─────────────────────────────────────────────────────────────
-- Called with BOTH arguments spelled out. A one-argument call would still work
-- today (the second defaults to auth.uid()), but it is the shape that becomes
-- ambiguous the moment anyone adds a one-arg overload again — which is the
-- accident 1a exists to undo.
-- READ: members and the founder of THAT corporation. Nobody else.
create policy ct_sel on public.corp_treasury
  for select to authenticated
  using (public.is_corp_member(corp_treasury.corp_id, auth.uid()));

-- WRITE: as yourself, into a treasury you actually belong to. Both halves are
-- needed — `user_id = auth.uid()` alone let any signed-in player append a line
-- to any guild's ledger, which moves that guild's balance.
create policy ct_ins on public.corp_treasury
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_corp_member(corp_id, auth.uid()));

-- (No UPDATE / DELETE policy, on purpose — they were dropped in section 1 and
--  are deliberately never recreated. See the header.)

-- ─── VERIFY ──────────────────────────────────────────────────────────────────
-- Asserts the DEFECT is gone, not merely that policies exist: a count alone
-- passes against the broken version, because the broken version has the same
-- two policies. `open_read_expect_0` is the line that actually matters, and
-- `secdef_helper_expect_1` is the second one: it counts is_corp_member
-- OVERLOADS, so it reads 2 — and this file is wrong — if the one-argument
-- draft ever comes back alongside sql/045's two-argument version.
select
  (select count(*) from pg_tables
     where schemaname='public' and tablename='corp_treasury' and rowsecurity)      as rls_on_expect_1,
  (select count(*) from pg_policies
     where schemaname='public' and tablename='corp_treasury')                      as policies_expect_2,
  (select count(*) from pg_policies
     where schemaname='public' and tablename='corp_treasury'
       and cmd='SELECT' and coalesce(qual,'') = 'true')                            as open_read_expect_0,
  (select count(*) from pg_policies
     where schemaname='public' and tablename='corp_treasury'
       and cmd in ('UPDATE','DELETE'))                                             as mutating_policies_expect_0,
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='is_corp_member' and p.prosecdef)       as secdef_helper_expect_1,
  (select count(*) from public.corp_treasury)                                      as ledger_rows_preserved;
