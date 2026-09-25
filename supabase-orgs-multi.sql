-- ════════════════════════════════════════════════════════════════════════
-- 🏢 ORGANIZATIONS — own your own AND join others
--
-- THE BLOCKER: corp_members.user_id is the PRIMARY KEY, so Postgres allows
-- exactly ONE membership per player. Owning your own organization while
-- belonging to someone else's is not "not built" — it is currently
-- impossible at the schema level. This migration changes the key to
-- (corp_id, user_id) so a player can hold several memberships at once.
--
-- Also seeds Aston The DragonHeart as owner of AO Creative Systems.
--
-- Run in the Supabase SQL editor for the GAME project.
-- SAFE TO RE-RUN: every step is idempotent.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. one player, many organizations ───────────────────────────────────
-- Drop the single-membership primary key and re-key on the PAIR. Existing
-- rows survive untouched: each is already a unique (corp_id, user_id).
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.corp_members'::regclass and contype = 'p'
      and conname = 'corp_members_pkey'
      and (select count(*) from unnest(conkey)) = 1
  ) then
    alter table public.corp_members drop constraint corp_members_pkey;
    alter table public.corp_members add constraint corp_members_pkey
      primary key (corp_id, user_id);
  end if;
end $$;

-- A player still has ONE active organization at a time (the one whose screen
-- they are looking at); the rest are memberships they can switch to. Storing
-- it here rather than in the profile means the switch survives a device
-- change and stays consistent with what the server thinks.
alter table public.corp_members
  add column if not exists is_primary boolean not null default false;

-- Exactly one primary per player, enforced rather than hoped for.
drop index if exists corp_members_one_primary;
create unique index corp_members_one_primary
  on public.corp_members (user_id) where is_primary;

create index if not exists corp_members_user on public.corp_members (user_id);

-- ── 2. the switcher RPC ─────────────────────────────────────────────────
-- Flipping which org is primary touches two rows and must never leave a
-- player with none or two. SECURITY DEFINER so the unique index above can be
-- satisfied inside one transaction, and it only ever acts on the CALLER.
create or replace function public.corp_set_primary(p_corp_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from corp_members
                 where corp_id = p_corp_id and user_id = auth.uid()) then
    raise exception 'not a member of that organization';
  end if;
  update corp_members set is_primary = false
    where user_id = auth.uid() and is_primary;
  update corp_members set is_primary = true
    where user_id = auth.uid() and corp_id = p_corp_id;
end $$;
revoke all on function public.corp_set_primary(uuid) from public, anon;
grant execute on function public.corp_set_primary(uuid) to authenticated;

-- ── 3. let a founder's own org be joined alongside others ───────────────
-- The delete policy already lets a founder remove members. The insert policy
-- only allowed self-insert, which is still what we want (you join yourself);
-- nothing to change there. What DID need fixing: a founder was never
-- guaranteed a membership row in their OWN organization, so "my orgs" could
-- come back empty for the person who created it.
insert into public.corp_members (corp_id, user_id, user_name, role, is_primary)
select c.id, c.founder_id, null, 'owner', false
from public.corporations c
where not exists (
  select 1 from public.corp_members m
  where m.corp_id = c.id and m.user_id = c.founder_id
)
on conflict (corp_id, user_id) do nothing;

-- Everyone with memberships but no primary gets one, deterministically.
with pick as (
  select distinct on (user_id) user_id, corp_id
  from public.corp_members
  where user_id not in (select user_id from public.corp_members where is_primary)
  order by user_id, (role = 'owner') desc, joined_at asc
)
update public.corp_members m set is_primary = true
from pick p where m.user_id = p.user_id and m.corp_id = p.corp_id;

-- ── 4. seed AO Creative Systems, owned by Aston The DragonHeart ─────────
-- ⚠ Matched by DISPLAY NAME, because that is the only handle available from
-- the game side. If Aston has not signed in yet, or the name differs by so
-- much as a character, this block does nothing rather than creating an
-- organization owned by the wrong account — verify with the SELECT at the
-- bottom before assuming it worked.
do $$
declare v_uid uuid; v_corp uuid;
begin
  select id into v_uid from auth.users
   where lower(coalesce(raw_user_meta_data->>'display_name',
                        raw_user_meta_data->>'full_name',
                        raw_user_meta_data->>'name','')) = lower('Aston The DragonHeart')
   limit 1;

  if v_uid is null then
    raise notice 'Aston The DragonHeart not found in auth.users — org NOT created. Have them sign in once, then re-run.';
    return;
  end if;

  select id into v_corp from public.corporations where lower(name) = lower('AO Creative Systems') limit 1;

  if v_corp is null then
    insert into public.corporations (name, tag, founder_id)
    values ('AO Creative Systems', 'AOCS', v_uid)
    returning id into v_corp;
    raise notice 'Created AO Creative Systems (%) owned by %', v_corp, v_uid;
  else
    update public.corporations set founder_id = v_uid where id = v_corp;
    raise notice 'AO Creative Systems already existed (%) — ownership set to %', v_corp, v_uid;
  end if;

  insert into public.corp_members (corp_id, user_id, user_name, role, is_primary)
  values (v_corp, v_uid, 'Aston The DragonHeart', 'owner', true)
  on conflict (corp_id, user_id) do update set role = 'owner';

  -- Make it his primary without tripping the one-primary index.
  update public.corp_members set is_primary = false
    where user_id = v_uid and corp_id <> v_corp;
  update public.corp_members set is_primary = true
    where user_id = v_uid and corp_id = v_corp;
end $$;

-- ── verify ──────────────────────────────────────────────────────────────
-- 1) the key really is the pair now (expect corp_id, user_id):
--    select a.attname from pg_constraint c
--      join unnest(c.conkey) k on true
--      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
--     where c.conrelid = 'public.corp_members'::regclass and c.contype = 'p';
--
-- 2) Aston's organizations (expect AO Creative Systems, role owner, primary):
--    select c.name, m.role, m.is_primary from public.corp_members m
--      join public.corporations c on c.id = m.corp_id
--      join auth.users u on u.id = m.user_id
--     where lower(coalesce(u.raw_user_meta_data->>'display_name','')) = lower('Aston The DragonHeart');
--
-- 3) nobody has two primaries (expect zero rows):
--    select user_id, count(*) from public.corp_members where is_primary
--     group by user_id having count(*) > 1;
