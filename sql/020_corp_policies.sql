-- ============================================================================
-- 020 — CORPORATE POLICIES ("laws"): the founder-set charter, append-only.
--
-- WHAT THIS IS
-- A corporation's founder declares three policies — a corporate levy, a hiring
-- policy and an illicit tolerance. Each one moves a term the game already
-- scores (see the CORP_LAWS block in public/index.html): the levy moves the
-- "Taxes & fees paid" compliance term and is charged for real at a corp-market
-- sale, the hiring policy scales the "Raids / member crimes" term and the
-- roster cap, and the illicit tolerance moves the "Smuggling" term. There is no
-- new score here and no new currency.
--
-- WHY A LOG AND NOT A ROW PER CORPORATION
-- Every enactment is an INSERT. Nothing is ever UPDATEd or DELETEd: the current
-- charter is simply the newest row for that corporation. That keeps the house
-- rule ("ledgers are append-only — never UPDATE a balance column") and gives
-- the Licensing Office a real legislative history for free.
--
-- 🔒 RLS IS THE ENTIRE SECURITY BOUNDARY, and it is deliberately TIGHTER than
--    the client. INSERT requires `corporations.founder_id = auth.uid()` for the
--    corp_id being written — exactly the shape corp_licenses already uses:
--      · a founder cannot enact policy for a corporation they did not found
--        (the corp_id is checked against founder_id, not merely "is a uuid");
--      · a plain member cannot enact policy for their own corporation;
--      · nobody can rewrite or erase an enactment, because no UPDATE or DELETE
--        policy exists at all.
--    ⚠ NOTE THE DELIBERATE GAP: the client also treats a corp_members row with
--    role 'CEO' as an owner (Corp.amOwner). This file does NOT, because
--    corp_members' own insert policy is `with check (user_id = auth.uid())` —
--    a member can write their OWN role string, so trusting it here would be a
--    self-service privilege escalation. An appointed CEO's enactment therefore
--    stays on their device (the client flags `lawsUnknown` and says so) until
--    the founder makes it. That is the safe direction to fail in.
--
-- Idempotent. Safe to re-run. Ships its RLS. Ends with a verify query.
-- Run in the Supabase SQL editor for the GAME project (ktsiasyjusesawtrwrjc).
-- ============================================================================

-- ── 1. The table ────────────────────────────────────────────────────────────
create table if not exists public.corp_policy_log (
  id          bigserial primary key,
  corp_id     uuid not null references public.corporations(id) on delete cascade,
  policies    jsonb not null default '{}'::jsonb,
  changed_key text,
  changed_to  text,
  enacted_by  uuid references auth.users(id) on delete set null,
  enacted_at  timestamptz not null default now()
);

-- Re-runnable column adds, for a database that got an earlier draft.
alter table public.corp_policy_log add column if not exists changed_key text;
alter table public.corp_policy_log add column if not exists changed_to  text;
alter table public.corp_policy_log add column if not exists enacted_by  uuid;

-- ── 2. Only the three known policies, only their known values ───────────────
-- A jsonb column with no shape check is a place to store anything, including a
-- megabyte of junk. These constraints mean a row either IS a charter or is
-- rejected. Added defensively so re-running never fails on an existing name.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'corp_policy_log_shape') then
    alter table public.corp_policy_log
      add constraint corp_policy_log_shape check (
        jsonb_typeof(policies) = 'object'
        and (policies - array['tax','hiring','illicit']) = '{}'::jsonb
        and coalesce(policies->>'tax','none')      in ('none','light','std','heavy','tithe')
        and coalesce(policies->>'hiring','open')   in ('open','vetted','closed')
        and coalesce(policies->>'illicit','quiet') in ('zero','quiet','open')
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'corp_policy_log_key') then
    alter table public.corp_policy_log
      add constraint corp_policy_log_key check (
        changed_key is null or changed_key in ('tax','hiring','illicit')
      );
  end if;
end $$;

create index if not exists corp_policy_log_corp_at
  on public.corp_policy_log (corp_id, enacted_at desc);

-- ── 3. The current charter, one row per corporation ─────────────────────────
-- The client reads the table directly (order by enacted_at desc limit 1) so it
-- works without this view; the view exists for dashboards and for anyone
-- reading the data by hand.
create or replace view public.corp_policies_current as
select distinct on (l.corp_id)
       l.corp_id,
       l.policies,
       l.enacted_by,
       l.enacted_at
from   public.corp_policy_log l
order  by l.corp_id, l.enacted_at desc, l.id desc;

-- ── 4. RLS ──────────────────────────────────────────────────────────────────
alter table public.corp_policy_log enable row level security;

-- Charters are public law: anyone signed in can read any corporation's, the
-- same visibility corporations and corp_licenses already have.
drop policy if exists cpl_sel on public.corp_policy_log;
create policy cpl_sel on public.corp_policy_log
  for select to authenticated
  using (true);

-- 🔒 THE BOUNDARY. Only the FOUNDER OF THIS corp_id may enact, and only in
--    their own name. Both halves matter: without the corp_id ↔ founder_id
--    check a founder could legislate for someone else's corporation, and
--    without the enacted_by check they could sign it as another player.
drop policy if exists cpl_ins on public.corp_policy_log;
create policy cpl_ins on public.corp_policy_log
  for insert to authenticated
  with check (
    enacted_by = auth.uid()
    and exists (
      select 1 from public.corporations c
      where  c.id = corp_policy_log.corp_id
      and    c.founder_id = auth.uid()
    )
  );

-- No UPDATE policy and no DELETE policy — deliberately. With RLS enabled and
-- no permissive policy for a command, that command is denied to every
-- non-superuser role, which is what makes this log append-only. These drops
-- exist so re-running the file removes an update/delete policy an earlier
-- draft may have created.
drop policy if exists cpl_upd on public.corp_policy_log;
drop policy if exists cpl_del on public.corp_policy_log;

-- Belt and braces: revoke the privileges outright as well, so the log stays
-- append-only even if someone later adds a permissive policy by accident.
revoke update, delete on public.corp_policy_log from authenticated, anon;
grant  select, insert on public.corp_policy_log to authenticated;
grant  select on public.corp_policies_current to authenticated;

-- ── 5. VERIFY ───────────────────────────────────────────────────────────────
-- Expect: one 'table' row; 'shape' and 'key' constraints present; exactly two
-- policies (cpl_sel SELECT, cpl_ins INSERT) and NOTHING for update/delete.
select 'table' as check, count(*)::text as detail
from   information_schema.tables
where  table_schema = 'public' and table_name = 'corp_policy_log'
union all
select 'constraint: ' || conname, 'present'
from   pg_constraint
where  conname in ('corp_policy_log_shape','corp_policy_log_key')
union all
select 'policy: ' || policyname, cmd
from   pg_policies
where  schemaname = 'public' and tablename = 'corp_policy_log'
union all
select 'rls_enabled', c.relrowsecurity::text
from   pg_class c join pg_namespace n on n.oid = c.relnamespace
where  n.nspname = 'public' and c.relname = 'corp_policy_log'
union all
select 'charters_enacted', count(*)::text from public.corp_policy_log
order  by 1;

-- ── 6. NEGATIVE TESTS (run as a signed-in player, one at a time) ────────────
-- Each of these MUST fail with "new row violates row-level security policy".
-- They are commented out so the file stays safe to run wholesale.
--
--   -- (a) a member (not the founder) legislating for their own corporation:
--   -- insert into public.corp_policy_log (corp_id, policies, enacted_by)
--   -- select m.corp_id, '{"tax":"tithe"}'::jsonb, auth.uid()
--   -- from public.corp_members m
--   -- join public.corporations c on c.id = m.corp_id
--   -- where m.user_id = auth.uid() and c.founder_id <> auth.uid();
--
--   -- (b) a founder legislating for a corporation they did NOT found:
--   -- insert into public.corp_policy_log (corp_id, policies, enacted_by)
--   -- select c.id, '{"tax":"tithe"}'::jsonb, auth.uid()
--   -- from public.corporations c where c.founder_id <> auth.uid() limit 1;
--
--   -- (c) signing someone else's name to your own charter:
--   -- insert into public.corp_policy_log (corp_id, policies, enacted_by)
--   -- select c.id, '{"tax":"tithe"}'::jsonb, c.founder_id
--   -- from public.corporations c where c.founder_id <> auth.uid() limit 1;
--
--   -- (d) rewriting history (must report 0 rows updated / permission denied):
--   -- update public.corp_policy_log set policies = '{"tax":"none"}'::jsonb;
--   -- delete from public.corp_policy_log;
--
--   -- (e) a junk charter, as the rightful founder (violates corp_policy_log_shape):
--   -- insert into public.corp_policy_log (corp_id, policies, enacted_by)
--   -- select c.id, '{"tax":"free_money","evil":true}'::jsonb, auth.uid()
--   -- from public.corporations c where c.founder_id = auth.uid() limit 1;
--
-- 🔴 NOTHING IN THIS FILE DELETES OR REVOKES PLAYER PROPERTY. It creates one
--    log table, one view, two policies and two check constraints. There is no
--    delete, no update, and no statement touching corp_licenses, corp_members,
--    corp_vault, economy_nodes or any balance.
