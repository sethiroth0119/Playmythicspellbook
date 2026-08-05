-- ═══════════════════════════════════════════════════════════════════════════
-- 001 · COMMUNITY CORE — communities + membership + roles
--
-- Communities sit ABOVE corporations. A Community is a named container that
-- Corporations affiliate with (002) and that players hold membership in.
-- It deliberately does NOT duplicate corp_treasury, corp roles or Territory
-- Wars objectives — those already exist and are reused.
--
-- Supabase SQL editor, project ktsiasyjusesawtrwrjc. Idempotent, re-runnable.
--
-- ⚠ RLS RECURSION. A policy on community_members that queries community_members
--   re-enters RLS and can recurse forever. Every membership/leadership check
--   below therefore goes through a SECURITY DEFINER helper, which bypasses RLS
--   and terminates. Do not inline those EXISTS clauses back into the policies.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── 1. TABLES ───────────────────────────────────────────────────────────
create table if not exists public.communities (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  tag         text not null,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  description text,
  banner_url  text,
  -- 'open'   → joining is immediate
  -- 'apply'  → creates a pending row leadership must approve
  -- 'closed' → invite only; no self-service application
  join_policy text not null default 'apply' check (join_policy in ('open','apply','closed')),
  created_at  timestamptz not null default now()
);
create unique index if not exists communities_tag_uniq on public.communities (lower(tag));
create index if not exists communities_owner on public.communities (owner_id);

-- role: member < officer < leader. The OWNER is communities.owner_id and is not
-- expressible as a role — that keeps "who can delete this" unambiguous.
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


-- ─── 2. SECURITY DEFINER HELPERS (the anti-recursion layer) ──────────────
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


-- ─── 3. RLS ──────────────────────────────────────────────────────────────
alter table public.communities       enable row level security;
alter table public.community_members enable row level security;

-- Communities are a public DIRECTORY — anyone signed in can browse them.
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

-- ⚠ SELF-INSERT IS THE APPLICATION PATH AND IT IS DELIBERATELY NARROW.
--   A player may insert ONLY their own row, ONLY as a plain member, and never
--   already-active — otherwise anyone could self-join a closed community as a
--   leader. 'open' communities are promoted to active by community_apply()
--   below, which is SECURITY DEFINER and checks the join policy.
drop policy if exists cmem_ins on public.community_members;
create policy cmem_ins on public.community_members for insert to authenticated
  with check (user_id = auth.uid() and role = 'member' and status = 'pending');

-- ⚠ NO GENERAL UPDATE POLICY. Role and status changes are the whole security
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


-- ─── 4. APPLY / APPROVE RPCs ─────────────────────────────────────────────
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


-- ─── 5. VERIFY ───────────────────────────────────────────────────────────
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
