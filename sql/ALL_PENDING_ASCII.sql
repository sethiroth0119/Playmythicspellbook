-- ============================================================
-- MYTHIC SPELLBOOK - PENDING MIGRATIONS, IN ORDER
-- Plain ASCII on purpose: emoji and box-drawing get mangled when this is
-- pasted through a console, and the SQL editor then reports invented
-- 42P01 errors on lines that were never SQL.
-- Run top to bottom. Each section is idempotent and ends with a verify
-- query. Stop and read the output if any verify count is unexpected.
-- ============================================================



-- ############################################################
-- FILE: sql/001_community_core.sql
-- ############################################################

-- ---------------------------------------------------------------------------
-- 001  COMMUNITY CORE - communities + membership + roles
--
-- Communities sit ABOVE corporations. A Community is a named container that
-- Corporations affiliate with (002) and that players hold membership in.
-- It deliberately does NOT duplicate corp_treasury, corp roles or Territory
-- Wars objectives - those already exist and are reused.
--
-- Supabase SQL editor, project ktsiasyjusesawtrwrjc. Idempotent, re-runnable.
--
--  RLS RECURSION. A policy on community_members that queries community_members
--   re-enters RLS and can recurse forever. Every membership/leadership check
--   below therefore goes through a SECURITY DEFINER helper, which bypasses RLS
--   and terminates. Do not inline those EXISTS clauses back into the policies.
-- ---------------------------------------------------------------------------


-- --- 1. TABLES -----------------------------------------------------------
create table if not exists public.communities (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  tag         text not null,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  description text,
  banner_url  text,
  -- 'open'   -> joining is immediate
  -- 'apply'  -> creates a pending row leadership must approve
  -- 'closed' -> invite only; no self-service application
  join_policy text not null default 'apply' check (join_policy in ('open','apply','closed')),
  created_at  timestamptz not null default now()
);
create unique index if not exists communities_tag_uniq on public.communities (lower(tag));
create index if not exists communities_owner on public.communities (owner_id);

-- role: member < officer < leader. The OWNER is communities.owner_id and is not
-- expressible as a role - that keeps "who can delete this" unambiguous.
create table if not exists public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  user_name    text,
  role         text not null default 'member' check (role in ('member','officer','leader')),
  status       text not null default 'pending' check (status in ('pending','active','rejected','left','banned')),
  joined_at    timestamptz not null default now(),
  primary key (community_id, user_id)
);
create index if not exists community_members_user on public.community_members (user_id);
create index if not exists community_members_comm on public.community_members (community_id, status);


-- --- 2. SECURITY DEFINER HELPERS (the anti-recursion layer) --------------
-- Both are STABLE and take the community id explicitly so a policy can call
-- them once per row without re-entering RLS.
create or replace function public.is_community_member(p_community_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.community_members m
     where m.community_id = p_community_id
       and m.user_id = auth.uid()
       and m.status = 'active'
  );
$$;

create or replace function public.is_community_leader(p_community_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.communities c
     where c.id = p_community_id and c.owner_id = auth.uid()
  ) or exists (
    select 1 from public.community_members m
     where m.community_id = p_community_id
       and m.user_id = auth.uid()
       and m.status = 'active'
       and m.role in ('officer','leader')
  );
$$;

grant execute on function public.is_community_member(uuid) to authenticated;
grant execute on function public.is_community_leader(uuid) to authenticated;


-- --- 3. RLS --------------------------------------------------------------
alter table public.communities       enable row level security;
alter table public.community_members enable row level security;

-- Communities are a public DIRECTORY - anyone signed in can browse them.
drop policy if exists comm_sel on public.communities;
create policy comm_sel on public.communities for select to authenticated using (true);

-- You may only found a community in your own name.
drop policy if exists comm_ins on public.communities;
create policy comm_ins on public.communities for insert to authenticated
  with check (owner_id = auth.uid());

-- Editing the community record is leadership; transferring or deleting it is
-- the OWNER alone (the with_check keeps owner_id from being reassigned by an
-- officer, which would otherwise be a silent takeover).
drop policy if exists comm_upd on public.communities;
create policy comm_upd on public.communities for update to authenticated
  using (public.is_community_leader(id))
  with check (owner_id = (select c.owner_id from public.communities c where c.id = id));

drop policy if exists comm_del on public.communities;
create policy comm_del on public.communities for delete to authenticated
  using (owner_id = auth.uid());

-- The roster is public (same call as corp_members, which players already browse).
drop policy if exists cmem_sel on public.community_members;
create policy cmem_sel on public.community_members for select to authenticated using (true);

--  SELF-INSERT IS THE APPLICATION PATH AND IT IS DELIBERATELY NARROW.
--   A player may insert ONLY their own row, ONLY as a plain member, and never
--   already-active - otherwise anyone could self-join a closed community as a
--   leader. 'open' communities are promoted to active by community_apply()
--   below, which is SECURITY DEFINER and checks the join policy.
drop policy if exists cmem_ins on public.community_members;
create policy cmem_ins on public.community_members for insert to authenticated
  with check (user_id = auth.uid() and role = 'member' and status = 'pending');

--  NO GENERAL UPDATE POLICY. Role and status changes are the whole security
--   surface here, so they run through community_set_member() below. The only
--   self-service update is leaving, and it cannot touch `role`.
drop policy if exists cmem_upd on public.community_members;
create policy cmem_upd on public.community_members for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and status = 'left'
    and role = (select m.role from public.community_members m
                 where m.community_id = community_members.community_id
                   and m.user_id = auth.uid())
  );

drop policy if exists cmem_del on public.community_members;
create policy cmem_del on public.community_members for delete to authenticated
  using (user_id = auth.uid() or public.is_community_leader(community_id));


-- --- 4. APPLY / APPROVE RPCs ---------------------------------------------
-- Joining honours the community's own policy, decided SERVER side. A client
-- that lies about the policy gets a pending row at worst.
create or replace function public.community_apply(p_community_id uuid, p_user_name text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_policy text;
  v_status text;
  v_exist  text;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select join_policy into v_policy from communities where id = p_community_id;
  if v_policy is null then raise exception 'no such community'; end if;
  if v_policy = 'closed' then raise exception 'this community is invite only'; end if;

  select status into v_exist from community_members
   where community_id = p_community_id and user_id = v_uid;
  if v_exist = 'banned' then raise exception 'you are banned from this community'; end if;
  if v_exist = 'active' then return 'active'; end if;

  v_status := case when v_policy = 'open' then 'active' else 'pending' end;

  insert into community_members (community_id, user_id, user_name, role, status)
  values (p_community_id, v_uid, left(coalesce(p_user_name, 'Survivor'), 40), 'member', v_status)
  on conflict (community_id, user_id)
  do update set status = v_status, user_name = excluded.user_name;

  return v_status;
end $$;

-- Leadership sets a member's role/status. Guards, in order of how badly each
-- one would hurt: only leadership may call it; the OWNER's row can never be
-- demoted or removed by anyone; and nobody can grant a role above their own.
create or replace function public.community_set_member(
  p_community_id uuid, p_user_id uuid, p_role text default null, p_status text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_owner     uuid;
  v_my_role   text;
  v_am_owner  boolean;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if not public.is_community_leader(p_community_id) then raise exception 'leadership only'; end if;

  select owner_id into v_owner from communities where id = p_community_id;
  v_am_owner := (v_owner = v_uid);
  if p_user_id = v_owner and not v_am_owner then
    raise exception 'the owner cannot be changed by an officer';
  end if;

  select role into v_my_role from community_members
   where community_id = p_community_id and user_id = v_uid;

  -- Only the owner may mint another leader. An officer can promote to officer
  -- at most, so a compromised officer account cannot escalate the community.
  if p_role = 'leader' and not v_am_owner then
    raise exception 'only the owner promotes to leader';
  end if;
  if p_role is not null and p_role not in ('member','officer','leader') then
    raise exception 'bad role';
  end if;
  if p_status is not null and p_status not in ('pending','active','rejected','left','banned') then
    raise exception 'bad status';
  end if;

  update community_members
     set role   = coalesce(p_role, role),
         status = coalesce(p_status, status)
   where community_id = p_community_id and user_id = p_user_id;
end $$;

revoke all on function public.community_apply(uuid, text) from public, anon;
revoke all on function public.community_set_member(uuid, uuid, text, text) from public, anon;
grant execute on function public.community_apply(uuid, text) to authenticated;
grant execute on function public.community_set_member(uuid, uuid, text, text) to authenticated;


-- --- 5. VERIFY -----------------------------------------------------------
-- Expect: tables 2, policies 8, helpers 2, rpcs 2
select
  (select count(*) from pg_tables where schemaname='public'
     and tablename in ('communities','community_members'))                    as tables,
  (select count(*) from pg_policies where schemaname='public'
     and tablename in ('communities','community_members'))                    as policies,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public'
       and p.proname in ('is_community_member','is_community_leader'))        as helpers,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public'
       and p.proname in ('community_apply','community_set_member'))           as rpcs;


-- ############################################################
-- FILE: sql/002_community_corps.sql
-- ############################################################

-- ---------------------------------------------------------------------------
-- 002  COMMUNITY  CORP AFFILIATION
--
-- This is the actual point of the feature: "Corps hold ground. Communities
-- hold corps together." A corporation FOUNDER applies to affiliate; the
-- community's leadership approves.
--
-- Requires 001 (is_community_leader). Idempotent, re-runnable.
-- ---------------------------------------------------------------------------

create table if not exists public.community_corps (
  community_id  uuid not null references public.communities(id) on delete cascade,
  corp_id       uuid not null references public.corporations(id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending','active','rejected','left')),
  affiliated_at timestamptz not null default now(),
  primary key (community_id, corp_id)
);
--  A corp belongs to at most ONE community at a time. Without this a corp
--   could be counted into two communities' standings simultaneously and the
--   leaderboard stops meaning anything.
create unique index if not exists community_corps_one_active
  on public.community_corps (corp_id) where (status = 'active');
create index if not exists community_corps_comm on public.community_corps (community_id, status);

alter table public.community_corps enable row level security;

-- Affiliations are public - they are what the standings board reads.
drop policy if exists ccorp_sel on public.community_corps;
create policy ccorp_sel on public.community_corps for select to authenticated using (true);

--  ONLY THE CORP'S FOUNDER MAY APPLY, and only as pending. Any member being
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

-- --- VERIFY -- expect table 1, policies 4, one_active_index 1
select
  (select count(*) from pg_tables where schemaname='public' and tablename='community_corps') as tbl,
  (select count(*) from pg_policies where schemaname='public' and tablename='community_corps') as policies,
  (select count(*) from pg_indexes where schemaname='public'
     and indexname='community_corps_one_active') as one_active_index;


-- ############################################################
-- FILE: sql/003_community_ledger.sql
-- ############################################################

-- ---------------------------------------------------------------------------
-- 003  COMMUNITY CONTRIBUTION LEDGER + AUDIT LOG
--
-- Copies corp_treasury EXACTLY: append-only, balance = sum(amount). There is
-- no balance column, because a balance column is a thing that can drift from
-- its own history.
--
--  This ledger records CONTRIBUTION. It is deliberately NOT a second wallet
--   sitting beside corp_treasury - the doc's own warning about duplicating the
--   treasury. Cinder actually leaves the player through the existing
--   spendGems() path; this records who gave what, for standings and rewards.
--
-- Requires 001. Idempotent, re-runnable.
-- ---------------------------------------------------------------------------

create table if not exists public.community_ledger (
  id           bigserial primary key,
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete set null,
  user_name    text,
  amount       numeric not null default 0,
  kind         text not null default 'contribution'
                 check (kind in ('contribution','reward','adjustment')),
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists community_ledger_comm on public.community_ledger (community_id, created_at desc);
create index if not exists community_ledger_user on public.community_ledger (community_id, user_id);

create table if not exists public.community_audit (
  id           bigserial primary key,
  community_id uuid not null references public.communities(id) on delete cascade,
  actor_id     uuid references auth.users(id) on delete set null,
  actor_name   text,
  action       text not null,
  target       text,
  created_at   timestamptz not null default now()
);
create index if not exists community_audit_comm on public.community_audit (community_id, created_at desc);

alter table public.community_ledger enable row level security;
alter table public.community_audit  enable row level security;

-- Members read their own community's ledger; the standings board needs it.
drop policy if exists cled_sel on public.community_ledger;
create policy cled_sel on public.community_ledger for select to authenticated
  using (public.is_community_member(community_id) or public.is_community_leader(community_id));

--  A player may only ever write a POSITIVE contribution in their OWN name.
--   Without the amount check, a member could post a negative row and delete
--   the community's recorded history by arithmetic.
drop policy if exists cled_ins on public.community_ledger;
create policy cled_ins on public.community_ledger for insert to authenticated
  with check (
    user_id = auth.uid()
    and kind = 'contribution'
    and amount > 0
    and public.is_community_member(community_id)
  );

-- APPEND-ONLY, enforced rather than asserted. No update or delete policy exists
-- and the grants are revoked, so history cannot be edited by anyone.
revoke update, delete on public.community_ledger from anon, authenticated;

-- The audit log is leadership-readable and RPC-written only.
drop policy if exists caud_sel on public.community_audit;
create policy caud_sel on public.community_audit for select to authenticated
  using (public.is_community_leader(community_id));
revoke insert, update, delete on public.community_audit from anon, authenticated;

-- Every leadership action lands here through this, inside the caller's own
-- transaction, so an action can never happen unlogged.
create or replace function public.community_log(
  p_community_id uuid, p_action text, p_target text default null, p_actor_name text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  if not public.is_community_leader(p_community_id) then return; end if;
  insert into community_audit (community_id, actor_id, actor_name, action, target)
  values (p_community_id, v_uid, left(coalesce(p_actor_name,'-'), 40),
          left(coalesce(p_action,'?'), 60), left(coalesce(p_target,''), 120));
end $$;

revoke all on function public.community_log(uuid, text, text, text) from public, anon;
grant execute on function public.community_log(uuid, text, text, text) to authenticated;

-- --- VERIFY -- expect tables 2, policies 3, rpc 1
select
  (select count(*) from pg_tables where schemaname='public'
     and tablename in ('community_ledger','community_audit'))                 as tables,
  (select count(*) from pg_policies where schemaname='public'
     and tablename in ('community_ledger','community_audit'))                 as policies,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='community_log')                  as rpc;


-- ############################################################
-- FILE: sql/004_boe_atomic_balance.sql
-- ############################################################

-- ---------------------------------------------------------------------------
-- 004  BANK OF ETHOS - ATOMIC BALANCE MOVES   ECONOMY EXPLOIT FIX
--
-- THE BUG (reported 2026-08-05: "withdrawing resets the bank back, which
-- causes farming").
--   Every bank operation in the client was a READ-MODIFY-WRITE of an absolute
--   value: read BankEthos.balance into memory, compute balance  amount, write
--   the whole column back. openBankOfEthos() starts TWO concurrent chains -
--   boeApplyMaintenance() and boeAutoSettle -> boeFetchLoans ->
--   boeMercAutoSettle -> boeMarketAutoSettle - and each captured its own
--   `prevBal` before the player touched anything.
--
--   Withdraw while one of those is still in flight and it writes its stale
--   prevBal straight over the decrement. The bank row goes back to what it was.
--   The wallet had ALREADY been credited by addGems(). Repeat = infinite Cinder.
--
-- THE FIX
--   Move the arithmetic to the database, where `balance = balance - amt` is a
--   single atomic statement. No read-modify-write, so there is nothing to lose
--   an update against, and the guard is in the same statement so a balance can
--   never go negative or be overdrawn by two racing tabs.
--
--   The client credits the wallet ONLY on a confirmed new balance returned from
--   here. A move that does not happen now costs the player nothing and mints
--   nothing.
--
-- Supabase SQL editor, project ktsiasyjusesawtrwrjc. Idempotent.
-- ---------------------------------------------------------------------------

-- Adjust the caller's OWN bank row by a signed delta, atomically.
--   p_delta_cinder / p_delta_aza  - may be negative
--   returns { ok, balance, aza }  - ok=false means nothing was written
--
--  SECURITY DEFINER, but it only ever touches auth.uid()'s row. There is no
--   parameter naming a user, so it cannot be aimed at anyone else.
create or replace function public.boe_adjust_balance(
  p_delta_cinder numeric default 0,
  p_delta_aza    numeric default 0)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_bal numeric;
  v_aza numeric;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  -- The whole fix is this one statement. The read and the write are the same
  -- operation, and the row is locked for its duration, so a concurrent chain
  -- cannot compute a stale base and overwrite it.
  update public.bank_of_ethos
     set balance    = balance + coalesce(p_delta_cinder, 0),
         aza        = aza     + coalesce(p_delta_aza, 0),
         updated_at = now()
   where user_id = v_uid
     -- Overdraft guard, in the same statement rather than a check before it.
     -- A withdrawal that would go negative simply matches no row.
     and balance + coalesce(p_delta_cinder, 0) >= 0
     and aza     + coalesce(p_delta_aza, 0)    >= 0
  returning balance, aza into v_bal, v_aza;

  if not found then
    -- Either the row is missing or the move would overdraw. Report the CURRENT
    -- balance so the client can correct its own copy instead of guessing.
    select balance, aza into v_bal, v_aza from public.bank_of_ethos where user_id = v_uid;
    return jsonb_build_object('ok', false, 'error', 'insufficient_or_missing',
                              'balance', coalesce(v_bal, 0), 'aza', coalesce(v_aza, 0));
  end if;

  return jsonb_build_object('ok', true, 'balance', v_bal, 'aza', v_aza);
end $$;

revoke all on function public.boe_adjust_balance(numeric, numeric) from public, anon;
grant execute on function public.boe_adjust_balance(numeric, numeric) to authenticated;


-- --- VERIFY -- expect has_rpc 1
select count(*) as has_rpc
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'boe_adjust_balance';

-- Sanity check on your OWN account (safe: +0 / -0 writes nothing meaningful).
-- Expect ok:true and your real balance echoed back.
-- select public.boe_adjust_balance(0, 0);


-- ############################################################
-- FILE: sql/005_community_phase2.sql
-- ############################################################

-- ---------------------------------------------------------------------------
-- 005  COMMUNITY PHASE 2 - announcements  votes  objectives  rewards
--
-- Requires 001 (is_community_member / is_community_leader) and 003 (ledger).
-- Idempotent, re-runnable. Supabase SQL editor, project ktsiasyjusesawtrwrjc.
--
-- Design notes that matter more than the DDL:
--   Votes CHANGE GAME STATE. Closing a vote writes the winning option onto the
--    communities row, and the client reads it. A poll that changes nothing is
--    the "worse Discord" this whole feature exists to avoid.
--   Objectives POINT AT Territory Wars nodes. There is no parallel mission
--    system, no separate progress counter - progress is read live from TW.
--   Rewards are CLAIMED, not pushed. A distribution writes one claimable row
--    per member; each player credits their own wallet. Nothing here can touch
--    another user's balance, which is the only reason this is safe to expose.
-- ---------------------------------------------------------------------------


-- --- 0. Vote outcomes live on the community row --------------------------
alter table public.communities add column if not exists war_target_node text;
alter table public.communities add column if not exists war_target_name text;
-- Levy the community retains from a reward distribution, 0-50%.
alter table public.communities add column if not exists levy_pct numeric not null default 0;
alter table public.communities drop constraint if exists communities_levy_pct_ck;
alter table public.communities add constraint communities_levy_pct_ck check (levy_pct >= 0 and levy_pct <= 50);


-- --- 1. ANNOUNCEMENTS ----------------------------------------------------
-- One-to-many, leadership-only, TEXT ONLY. The lowest-abuse social surface
-- there is: members cannot post, so there is no many-to-many moderation load.
create table if not exists public.community_announcements (
  id           bigserial primary key,
  community_id uuid not null references public.communities(id) on delete cascade,
  author_id    uuid references auth.users(id) on delete set null,
  author_name  text,
  body         text not null check (length(body) between 1 and 2000),
  pinned       boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists community_ann_comm on public.community_announcements (community_id, created_at desc);

alter table public.community_announcements enable row level security;

drop policy if exists cann_sel on public.community_announcements;
create policy cann_sel on public.community_announcements for select to authenticated
  using (public.is_community_member(community_id) or public.is_community_leader(community_id));

--  author_id = auth.uid() AND leadership. Both, not either: without the
--   author check a leader could post under someone else's name.
drop policy if exists cann_ins on public.community_announcements;
create policy cann_ins on public.community_announcements for insert to authenticated
  with check (author_id = auth.uid() and public.is_community_leader(community_id));

drop policy if exists cann_upd on public.community_announcements;
create policy cann_upd on public.community_announcements for update to authenticated
  using (public.is_community_leader(community_id)) with check (true);

drop policy if exists cann_del on public.community_announcements;
create policy cann_del on public.community_announcements for delete to authenticated
  using (public.is_community_leader(community_id));


-- --- 2. VOTES ------------------------------------------------------------
-- kind decides what closing the vote DOES:
--   'war_target' -> communities.war_target_node / _name
--   'levy'       -> communities.levy_pct
--   'advisory'   -> records the result and changes nothing (say so in the UI)
create table if not exists public.community_votes (
  id           bigserial primary key,
  community_id uuid not null references public.communities(id) on delete cascade,
  kind         text not null check (kind in ('war_target','levy','advisory')),
  title        text not null check (length(title) between 1 and 140),
  -- [{ value, label }] - the ballot. Kept as data so the client cannot invent
  -- an option that was never on the paper.
  options      jsonb not null default '[]'::jsonb,
  status       text not null default 'open' check (status in ('open','closed','applied','cancelled')),
  created_by   uuid references auth.users(id) on delete set null,
  created_name text,
  closes_at    timestamptz,
  result_value text,
  result_label text,
  applied_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists community_votes_comm on public.community_votes (community_id, created_at desc);

create table if not exists public.community_ballots (
  vote_id    bigint not null references public.community_votes(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  choice     text not null,
  created_at timestamptz not null default now(),
  primary key (vote_id, user_id)          --  one member, one ballot
);

alter table public.community_votes   enable row level security;
alter table public.community_ballots enable row level security;

drop policy if exists cvote_sel on public.community_votes;
create policy cvote_sel on public.community_votes for select to authenticated
  using (public.is_community_member(community_id) or public.is_community_leader(community_id));

drop policy if exists cvote_ins on public.community_votes;
create policy cvote_ins on public.community_votes for insert to authenticated
  with check (created_by = auth.uid() and public.is_community_leader(community_id) and status = 'open');

--  NO direct update policy. Closing a vote applies game state, so it runs
--   through community_vote_close() where the tally cannot be forged.
drop policy if exists cvote_del on public.community_votes;
create policy cvote_del on public.community_votes for delete to authenticated
  using (public.is_community_leader(community_id));

-- Ballots are public to the community: a tally nobody can audit is not a vote.
drop policy if exists cbal_sel on public.community_ballots;
create policy cbal_sel on public.community_ballots for select to authenticated
  using (exists (select 1 from public.community_votes v
                  where v.id = vote_id and public.is_community_member(v.community_id)));
revoke insert, update, delete on public.community_ballots from anon, authenticated;


-- Cast (or change) your ballot while the vote is open.
create or replace function public.community_vote_cast(p_vote_id bigint, p_choice text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_comm uuid;
  v_stat text;
  v_close timestamptz;
  v_ok   boolean;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select community_id, status, closes_at into v_comm, v_stat, v_close
    from community_votes where id = p_vote_id;
  if v_comm is null then raise exception 'no such vote'; end if;
  if not public.is_community_member(v_comm) then raise exception 'members only'; end if;
  if v_stat <> 'open' then raise exception 'this vote is closed'; end if;
  if v_close is not null and now() > v_close then raise exception 'this vote has expired'; end if;

  -- The choice must be one of the options actually on the ballot.
  select exists (
    select 1 from community_votes cv, jsonb_array_elements(cv.options) o
     where cv.id = p_vote_id and o->>'value' = p_choice
  ) into v_ok;
  if not v_ok then raise exception 'that is not an option on this vote'; end if;

  insert into community_ballots (vote_id, user_id, choice)
  values (p_vote_id, v_uid, p_choice)
  on conflict (vote_id, user_id) do update set choice = excluded.choice, created_at = now();
end $$;


-- Close a vote, tally it, and APPLY the winner to the community.
create or replace function public.community_vote_close(p_vote_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_comm  uuid;
  v_kind  text;
  v_stat  text;
  v_win   text;
  v_label text;
  v_count int;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  select community_id, kind, status into v_comm, v_kind, v_stat
    from community_votes where id = p_vote_id;
  if v_comm is null then raise exception 'no such vote'; end if;
  if not public.is_community_leader(v_comm) then raise exception 'leadership only'; end if;
  if v_stat <> 'open' then raise exception 'already closed'; end if;

  -- Plurality, ties broken by the option that reached its count first.
  select b.choice, count(*) into v_win, v_count
    from community_ballots b where b.vote_id = p_vote_id
   group by b.choice order by count(*) desc, min(b.created_at) asc limit 1;

  if v_win is null then
    update community_votes set status = 'closed', result_value = null,
           result_label = 'No votes cast', applied_at = now() where id = p_vote_id;
    return jsonb_build_object('ok', true, 'applied', false, 'reason', 'no_votes');
  end if;

  select o->>'label' into v_label from community_votes cv, jsonb_array_elements(cv.options) o
   where cv.id = p_vote_id and o->>'value' = v_win limit 1;

  --  THE PART THAT MAKES IT A VOTE AND NOT A POLL.
  if v_kind = 'war_target' then
    update communities set war_target_node = v_win, war_target_name = coalesce(v_label, v_win)
     where id = v_comm;
  elsif v_kind = 'levy' then
    -- Clamped here as well as in the column constraint: a malformed option
    -- must not be able to raise the levy past what members agreed to allow.
    update communities set levy_pct = least(50, greatest(0, coalesce(v_win::numeric, 0)))
     where id = v_comm;
  end if;

  update community_votes
     set status = case when v_kind = 'advisory' then 'closed' else 'applied' end,
         result_value = v_win, result_label = coalesce(v_label, v_win), applied_at = now()
   where id = p_vote_id;

  return jsonb_build_object('ok', true, 'applied', v_kind <> 'advisory',
                            'winner', v_win, 'label', coalesce(v_label, v_win), 'votes', v_count);
end $$;


-- --- 3. OBJECTIVES - pointers at Territory Wars nodes --------------------
--  Deliberately just a POINTER. No progress column, no state machine, no
--   parallel mission system: the client reads live TW control for the node.
--   Anything stored here would immediately drift from the real war.
create table if not exists public.community_objectives (
  id           bigserial primary key,
  community_id uuid not null references public.communities(id) on delete cascade,
  node_id      text not null,
  label        text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (community_id, node_id)
);
create index if not exists community_obj_comm on public.community_objectives (community_id);

alter table public.community_objectives enable row level security;

drop policy if exists cobj_sel on public.community_objectives;
create policy cobj_sel on public.community_objectives for select to authenticated
  using (public.is_community_member(community_id) or public.is_community_leader(community_id));

drop policy if exists cobj_ins on public.community_objectives;
create policy cobj_ins on public.community_objectives for insert to authenticated
  with check (public.is_community_leader(community_id) and created_by = auth.uid());

drop policy if exists cobj_del on public.community_objectives;
create policy cobj_del on public.community_objectives for delete to authenticated
  using (public.is_community_leader(community_id));


-- --- 4. REWARD DISTRIBUTION - by contribution share ----------------------
-- Claimable payouts. A distribution NEVER touches another player's wallet; it
-- writes a row they claim themselves. That is the only reason leadership can be
-- trusted with this button at all.
create table if not exists public.community_rewards (
  id           bigserial primary key,
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  user_name    text,
  amount       numeric not null check (amount > 0),
  note         text,
  claimed_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists community_rewards_user on public.community_rewards (user_id, claimed_at);
create index if not exists community_rewards_comm on public.community_rewards (community_id, created_at desc);

alter table public.community_rewards enable row level security;

-- You see your own payouts; leadership sees the whole distribution.
drop policy if exists crew_sel on public.community_rewards;
create policy crew_sel on public.community_rewards for select to authenticated
  using (user_id = auth.uid() or public.is_community_leader(community_id));
revoke insert, update, delete on public.community_rewards from anon, authenticated;


-- Distribute `p_amount` from the community pot, split by contribution share.
--  THE POT IS THE LEDGER. balance = sum(amount), contributions positive and
--   distributions negative, so a distribution larger than the pot is refused in
--   the same transaction that would have written it. Without that check this
--   function would mint Cinder out of nothing.
create or replace function public.community_distribute(
  p_community_id uuid, p_amount numeric, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_pot   numeric;
  v_levy  numeric;
  v_net   numeric;
  v_total numeric;
  r       record;
  v_paid  numeric := 0;
  v_n     int := 0;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if not public.is_community_leader(p_community_id) then raise exception 'leadership only'; end if;
  p_amount := floor(coalesce(p_amount, 0));
  if p_amount <= 0 then raise exception 'nothing to distribute'; end if;

  select coalesce(sum(amount), 0) into v_pot from community_ledger where community_id = p_community_id;
  if v_pot < p_amount then
    raise exception 'the community pot holds % - cannot distribute %', v_pot, p_amount;
  end if;

  select coalesce(levy_pct, 0) into v_levy from communities where id = p_community_id;
  -- The levy stays in the pot; only the net is shared out.
  v_net := floor(p_amount * (100 - coalesce(v_levy, 0)) / 100);
  if v_net <= 0 then raise exception 'the levy leaves nothing to share'; end if;

  select coalesce(sum(amount), 0) into v_total
    from community_ledger where community_id = p_community_id and kind = 'contribution';
  if v_total <= 0 then raise exception 'nobody has contributed yet'; end if;

  for r in
    select l.user_id, max(l.user_name) as user_name, sum(l.amount) as given
      from community_ledger l
     where l.community_id = p_community_id and l.kind = 'contribution' and l.user_id is not null
     group by l.user_id having sum(l.amount) > 0
  loop
    declare v_share numeric := floor(v_net * (r.given / v_total));
    begin
      if v_share > 0 then
        insert into community_rewards (community_id, user_id, user_name, amount, note)
        values (p_community_id, r.user_id, r.user_name, v_share, p_note);
        v_paid := v_paid + v_share;
        v_n := v_n + 1;
      end if;
    end;
  end loop;

  if v_n = 0 then raise exception 'every share rounded to zero - distribute more'; end if;

  -- Debit the pot by what was ACTUALLY allocated plus the levy's share of it,
  -- never by the requested figure - rounding must not invent or destroy Cinder.
  insert into community_ledger (community_id, user_id, user_name, amount, kind, note)
  values (p_community_id, v_uid, 'Distribution', -(v_paid), 'reward',
          coalesce(p_note, 'Reward distribution'));

  return jsonb_build_object('ok', true, 'distributed', v_paid, 'recipients', v_n,
                            'levy_pct', v_levy, 'pot_after', v_pot - v_paid);
end $$;


-- Claim your own payout. Marks it claimed FIRST and returns the amount, so a
-- double-click cannot pay twice - the same order the mayor-pay claim uses.
create or replace function public.community_claim_rewards(p_community_id uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_total numeric := 0;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  update community_rewards set claimed_at = now()
   where community_id = p_community_id and user_id = v_uid and claimed_at is null;
  select coalesce(sum(amount), 0) into v_total
    from community_rewards
   where community_id = p_community_id and user_id = v_uid
     and claimed_at >= now() - interval '5 seconds';
  return v_total;
end $$;


revoke all on function public.community_vote_cast(bigint, text)          from public, anon;
revoke all on function public.community_vote_close(bigint)               from public, anon;
revoke all on function public.community_distribute(uuid, numeric, text)  from public, anon;
revoke all on function public.community_claim_rewards(uuid)              from public, anon;
grant execute on function public.community_vote_cast(bigint, text)         to authenticated;
grant execute on function public.community_vote_close(bigint)              to authenticated;
grant execute on function public.community_distribute(uuid, numeric, text) to authenticated;
grant execute on function public.community_claim_rewards(uuid)             to authenticated;


-- --- VERIFY -- expect tables 5, policies 12, rpcs 4
select
  (select count(*) from pg_tables where schemaname='public' and tablename in
     ('community_announcements','community_votes','community_ballots',
      'community_objectives','community_rewards'))                          as tables,
  (select count(*) from pg_policies where schemaname='public' and tablename in
     ('community_announcements','community_votes','community_ballots',
      'community_objectives','community_rewards'))                          as policies,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname in
     ('community_vote_cast','community_vote_close','community_distribute',
      'community_claim_rewards'))                                           as rpcs;
