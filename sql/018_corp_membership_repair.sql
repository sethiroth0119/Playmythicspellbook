-- ============================================================================
-- RUN_018 — corp membership repair + diagnosis
--
-- THE BUG THIS ANSWERS
-- "River Meadows Corp [RIVE] owns this corp but it will not allow him to buy
-- any businesses" — every operation card showed "Corporation required".
--
-- The client decides "do I have a corporation?" from ONE fact: a row in
-- public.corp_members for auth.uid(). That row is written by the CLIENT
-- (index.html corpCreate / the hired-player's next login) and, until the fix
-- shipped alongside this file, its result was never checked. If the write did
-- not land, the corporations row still carries the player's id as founder_id
-- while the app treats them as belonging to no corporation — permanently, with
-- no path back, because nothing ever reconciled founder_id into corp_members.
--
-- The client now self-heals from corporations.founder_id. This file does the
-- same server-side (so it is fixed for everyone at once, including on devices
-- that have not reloaded), and — more importantly — TELLS YOU which state the
-- database is actually in. Sections 1 and 2 only read; nothing before section 3
-- changes a row.
--
-- Idempotent and safe to re-run. Ships its RLS. Ends with a verify query.
-- Run in the Supabase SQL editor for the GAME project (ktsiasyjusesawtrwrjc).
-- ============================================================================

-- ── 1. DIAGNOSE: founders with no membership row ────────────────────────────
-- These are the players who will be told "Corporation required" despite owning
-- a corporation. If RIVE appears here, this was the cause.
select 'founder_without_membership' as finding,
       c.id   as corp_id,
       c.name as corp_name,
       c.tag,
       c.founder_id,
       c.created_at
from   public.corporations c
where  not exists (
         select 1 from public.corp_members m
         where  m.corp_id = c.id and m.user_id = c.founder_id
       )
order  by c.created_at desc;

-- ── 2. DIAGNOSE: players holding MORE THAN ONE membership row ───────────────
-- The old client read this with PostgREST `.maybeSingle()`, which turns "two
-- rows" into the same PGRST116 error as "no rows" — so a duplicate ALSO read
-- as "you have no corporation". Nothing is deleted here: if the multi-org
-- migration (supabase-orgs-multi.sql) was applied these rows are legitimate,
-- and the fixed client now picks the owning row instead of failing.
select 'duplicate_membership' as finding,
       m.user_id,
       count(*) as membership_rows,
       string_agg(c.tag, ', ' order by c.tag) as corps
from   public.corp_members m
left   join public.corporations c on c.id = m.corp_id
group  by m.user_id
having count(*) > 1;

-- ── 3. REPAIR: give every founder a membership row in their own corporation ─
-- `where not exists` rather than `on conflict`, deliberately: the on-conflict
-- target depends on whether corp_members is still keyed on user_id alone or has
-- been re-keyed to (corp_id, user_id) by supabase-orgs-multi.sql. This form
-- works under both and cannot duplicate a row under either.
--
-- 🔒 This grants nothing new. founder_id is only writable as auth.uid() (the
-- corp_ins policy: `with check (founder_id = auth.uid())`), so every row it
-- touches belongs to someone who already paid to incorporate.
insert into public.corp_members (user_id, corp_id, user_name, role)
select c.founder_id,
       c.id,
       coalesce(u.raw_user_meta_data->>'display_name',
                u.raw_user_meta_data->>'full_name',
                u.raw_user_meta_data->>'name',
                'Founder'),
       'founder'
from   public.corporations c
join   auth.users u on u.id = c.founder_id
where  not exists (
         select 1 from public.corp_members m
         where  m.corp_id = c.id and m.user_id = c.founder_id
       );

-- A founder whose row exists but says 'member' cannot fund operations either
-- (the client accepts founder_id OR an owning role; this makes the row agree
-- with the corporations table so both paths say the same thing).
update public.corp_members m
set    role = 'founder'
from   public.corporations c
where  c.id = m.corp_id
  and  c.founder_id = m.user_id
  and  coalesce(m.role, '') not in ('founder', 'owner', 'CEO', 'Corp CEO');

-- ── 4. RLS — restated here so this file is self-contained ───────────────────
-- Identical to foundation_reserve.sql; re-running it changes nothing if that
-- file was already applied, and repairs the policies if it was not.
--   · corporations SELECT is public-to-authenticated on purpose: the corp
--     directory lists every corporation to every signed-in player.
--   · corp_members INSERT stays self-only (user_id = auth.uid()). A founder
--     STILL cannot write someone else's membership from the client — that is
--     what the corp_hire() RPC in sql/016 is for.
alter table public.corporations enable row level security;
alter table public.corp_members enable row level security;

drop policy if exists corp_sel on public.corporations;
create policy corp_sel on public.corporations
  for select to authenticated using (true);

drop policy if exists corp_ins on public.corporations;
create policy corp_ins on public.corporations
  for insert to authenticated with check (founder_id = auth.uid());

drop policy if exists cm_sel on public.corp_members;
create policy cm_sel on public.corp_members
  for select to authenticated using (true);

drop policy if exists cm_ins on public.corp_members;
create policy cm_ins on public.corp_members
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists cm_upd on public.corp_members;
create policy cm_upd on public.corp_members
  for update to authenticated using (user_id = auth.uid())
                            with check (user_id = auth.uid());

drop policy if exists cm_del on public.corp_members;
create policy cm_del on public.corp_members
  for delete to authenticated using (
    user_id = auth.uid()
    or exists (select 1 from public.corporations c
               where c.id = corp_members.corp_id and c.founder_id = auth.uid())
  );

-- ── 5. VERIFY ───────────────────────────────────────────────────────────────
-- `founder_missing` must be 0 on every row. `members` is the roster size the
-- owner will now see in Guild & Hiring.
select c.name,
       c.tag,
       (select count(*) from public.corp_members m where m.corp_id = c.id) as members,
       (select count(*) from public.corp_members m
         where m.corp_id = c.id and m.user_id = c.founder_id)              as founder_row,
       case when exists (select 1 from public.corp_members m
                          where m.corp_id = c.id and m.user_id = c.founder_id)
            then 0 else 1 end                                             as founder_missing
from   public.corporations c
order  by c.name;
