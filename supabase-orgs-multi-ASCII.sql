-- ORGS: multi-membership + Aston / AO Creative Systems
-- Plain ASCII on purpose: box-drawing and emoji in comments get mangled when
-- this file is echoed through a PowerShell console before being pasted.
-- Idempotent. Run in the Supabase SQL editor, project ktsiasyjusesawtrwrjc.

-- 1. the column first, so it exists no matter what follows
alter table public.corp_members
  add column if not exists is_primary boolean not null default false;

-- 2. re-key so one player may belong to MANY organizations.
-- The old primary key was corp_members.user_id alone, which is what made
-- "own your own and join others" impossible at the schema level.
do $$
declare v_name text;
begin
  select conname into v_name
    from pg_constraint
   where conrelid = 'public.corp_members'::regclass
     and contype = 'p'
     and array_length(conkey, 1) = 1;

  if v_name is not null then
    execute format('alter table public.corp_members drop constraint %I', v_name);
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.corp_members'::regclass and contype = 'p') then
    alter table public.corp_members
      add constraint corp_members_pkey primary key (corp_id, user_id);
  end if;
end $$;

-- 3. exactly one active org per player
drop index if exists corp_members_one_primary;
create unique index corp_members_one_primary
  on public.corp_members (user_id) where is_primary;

create index if not exists corp_members_user on public.corp_members (user_id);

-- 4. the switcher
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

-- 5. a founder always holds a membership row in their own org
insert into public.corp_members (corp_id, user_id, user_name, role, is_primary)
select c.id, c.founder_id, null, 'owner', false
  from public.corporations c
 where not exists (select 1 from public.corp_members m
                    where m.corp_id = c.id and m.user_id = c.founder_id)
on conflict (corp_id, user_id) do nothing;

-- 6. anyone with memberships but no primary gets one
with pick as (
  select distinct on (user_id) user_id, corp_id
    from public.corp_members
   where user_id not in (select user_id from public.corp_members where is_primary)
   order by user_id, (role = 'owner') desc, joined_at asc
)
update public.corp_members m set is_primary = true
  from pick p
 where m.user_id = p.user_id and m.corp_id = p.corp_id;

-- 7. Aston The DragonHeart owns AO Creative Systems.
-- Matched on DISPLAY NAME (the only handle the game has). Does nothing rather
-- than guess if that account has never signed in.
do $$
declare v_uid uuid; v_corp uuid;
begin
  select id into v_uid from auth.users
   where lower(coalesce(raw_user_meta_data->>'display_name',
                        raw_user_meta_data->>'full_name',
                        raw_user_meta_data->>'name','')) = lower('Aston The DragonHeart')
   limit 1;

  if v_uid is null then
    raise notice 'Aston The DragonHeart not found in auth.users - ownership NOT changed.';
    return;
  end if;

  select id into v_corp from public.corporations
   where lower(name) = lower('AO Creative Systems') limit 1;

  if v_corp is null then
    insert into public.corporations (name, tag, founder_id)
    values ('AO Creative Systems', 'AOCS', v_uid) returning id into v_corp;
  else
    update public.corporations set founder_id = v_uid where id = v_corp;
  end if;

  insert into public.corp_members (corp_id, user_id, user_name, role, is_primary)
  values (v_corp, v_uid, 'Aston The DragonHeart', 'owner', false)
  on conflict (corp_id, user_id) do update set role = 'owner';

  update public.corp_members set is_primary = false
   where user_id = v_uid and corp_id <> v_corp;
  update public.corp_members set is_primary = true
   where user_id = v_uid and corp_id = v_corp;
end $$;
