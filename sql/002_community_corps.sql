-- ═══════════════════════════════════════════════════════════════════════════
-- 002 · COMMUNITY ⇄ CORP AFFILIATION
--
-- This is the actual point of the feature: "Corps hold ground. Communities
-- hold corps together." A corporation FOUNDER applies to affiliate; the
-- community's leadership approves.
--
-- Requires 001 (is_community_leader). Idempotent, re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.community_corps (
  community_id  uuid not null references public.communities(id) on delete cascade,
  corp_id       uuid not null references public.corporations(id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending','active','rejected','left')),
  affiliated_at timestamptz not null default now(),
  primary key (community_id, corp_id)
);
-- ⚠ A corp belongs to at most ONE community at a time. Without this a corp
--   could be counted into two communities' standings simultaneously and the
--   leaderboard stops meaning anything.
create unique index if not exists community_corps_one_active
  on public.community_corps (corp_id) where (status = 'active');
create index if not exists community_corps_comm on public.community_corps (community_id, status);

alter table public.community_corps enable row level security;

-- Affiliations are public — they are what the standings board reads.
drop policy if exists ccorp_sel on public.community_corps;
create policy ccorp_sel on public.community_corps for select to authenticated using (true);

-- ⚠ ONLY THE CORP'S FOUNDER MAY APPLY, and only as pending. Any member being
--   able to sign the whole corp into a community would be a hostile takeover
--   vector, so founder_id is checked against auth.uid() here rather than in JS.
drop policy if exists ccorp_ins on public.community_corps;
create policy ccorp_ins on public.community_corps for insert to authenticated
  with check (
    status = 'pending'
    and exists (select 1 from public.corporations c
                 where c.id = corp_id and c.founder_id = auth.uid())
  );

-- Approving/rejecting is the COMMUNITY's leadership; withdrawing is the CORP's
-- founder. Both sides can end it, neither can force it.
drop policy if exists ccorp_upd on public.community_corps;
create policy ccorp_upd on public.community_corps for update to authenticated
  using (
    public.is_community_leader(community_id)
    or exists (select 1 from public.corporations c
                where c.id = corp_id and c.founder_id = auth.uid())
  )
  with check (true);

drop policy if exists ccorp_del on public.community_corps;
create policy ccorp_del on public.community_corps for delete to authenticated
  using (
    public.is_community_leader(community_id)
    or exists (select 1 from public.corporations c
                where c.id = corp_id and c.founder_id = auth.uid())
  );

-- ─── VERIFY ── expect table 1, policies 4, one_active_index 1
select
  (select count(*) from pg_tables where schemaname='public' and tablename='community_corps') as tbl,
  (select count(*) from pg_policies where schemaname='public' and tablename='community_corps') as policies,
  (select count(*) from pg_indexes where schemaname='public'
     and indexname='community_corps_one_active') as one_active_index;
