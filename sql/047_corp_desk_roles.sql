-- ═══════════════════════════════════════════════════════════════════════════
-- 047 — Warehouse Worker and Weapon Smith: two hireable corporation desks.
--
-- WHY THIS FILE EXISTS AT ALL
-- ───────────────────────────
-- Adding a role to CORP_ROLES in the client is not enough. `corp_set_role`
-- carries its OWN hardcoded whitelist, and anything outside it is refused with
-- `invalid role`. That list was written before Bank Teller shipped and never
-- updated, so **reassigning an existing member to Bank Teller has been failing
-- in production ever since** — the hire path (`corp_hire`) copies the role
-- straight off corp_requests and never consulted the list, which is exactly
-- why nobody noticed: hiring worked, re-assigning did not. Fixed here in the
-- same pass, because shipping two more roles into the same trap would have
-- doubled the bug rather than found it.
--
-- WHAT THIS FILE DOES NOT DO
-- ──────────────────────────
-- It creates no tables. Both desks ride on systems that already exist —
-- corp_members.role is the authority, wh_warehouses is the yard, corp_vault is
-- where a smith's work lands — so there is no new data and therefore no new
-- RLS surface. The one new function is SECURITY DEFINER and does its OWN
-- membership check; see the note on recursion below.
--
-- Idempotent and re-runnable. Ends with a verify query.
-- Apply BY HAND in the Supabase SQL editor for project ktsiasyjusesawtrwrjc.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. corp_set_role — the whitelist, brought level with the client's CORP_ROLES.
--
-- Authorisation is unchanged and is the whole point of the function: the UPDATE
-- is scoped to corporations whose founder_id = auth.uid(), so a member cannot
-- promote themselves. corp_members' own RLS only lets a user write their OWN
-- row, which is why this has to be SECURITY DEFINER in the first place.
--
-- 'founder' is deliberately NOT in the list. It is written by corpCreate and by
-- the founder self-heal, and letting the dropdown hand it out would create a
-- second person the ownership checks treat as the owner.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.corp_set_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_role not in (
    'CEO', 'Corp CEO', 'Real Estate Agent', 'Mercenary', 'Lawyer',
    'Bank Teller', 'Warehouse Worker', 'Weapon Smith', 'member'
  ) then
    raise exception 'invalid role';
  end if;
  update public.corp_members m
     set role = p_role
   where m.user_id = p_user_id
     and m.corp_id in (select c.id from public.corporations c where c.founder_id = auth.uid());
end $function$;

revoke all on function public.corp_set_role(uuid, text) from public, anon;
grant execute on function public.corp_set_role(uuid, text) to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. corp_staff_desk — "what desk does my corporation open for me?"
--
-- A Warehouse Worker's desk is the FOUNDER'S yard, and the client cannot find
-- it: wh_directory deliberately withholds owner_id (see its own comment — the
-- privacy rule it was leaking), and wh_warehouses' RLS does not hand a
-- stranger a lookup by owner. So the corporation answers instead, and only for
-- its own staff.
--
-- ⚠ RECURSION. This reads corp_members from inside a SECURITY DEFINER
--   function, which BYPASSES RLS and therefore terminates. Doing the same
--   check from a policy ON corp_members would recurse — the trap CLAUDE.md
--   names. This function is the helper, not the policy.
--
-- ⚠ NO ELEVATION. It returns an id the caller could already have used had they
--   known it — wh_warehouse_json() masks a non-owner's view by itself and is
--   open to any signed-in caller. Nothing here grants a write.
--
-- ⚠ wh_warehouses may not exist (the warehouse migration is separate and may
--   be unapplied). Looked up dynamically through to_regclass so this file
--   applies cleanly either way, and the desk degrades to "no yard" rather than
--   failing to install.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.corp_staff_desk(p_corp_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid       uuid := auth.uid();
  v_role      text;
  v_founder   uuid;
  v_corp_name text;
  v_wh        uuid := null;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;

  -- Membership is the gate. A non-member gets nothing, not even the corp name.
  select m.role into v_role
    from public.corp_members m
   where m.corp_id = p_corp_id and m.user_id = v_uid
   limit 1;
  if v_role is null then
    return jsonb_build_object('ok', false, 'reason', 'not_a_member');
  end if;

  select c.founder_id, c.name into v_founder, v_corp_name
    from public.corporations c where c.id = p_corp_id;
  if v_founder is null then
    return jsonb_build_object('ok', false, 'reason', 'no_corporation');
  end if;

  -- The founder's yard, when the warehouse tables are installed and they have
  -- one. `null` here is an honest "there is no yard to walk", which is a
  -- different sentence from "the tables are missing" — ok stays true either
  -- way and the client says whichever is true.
  if to_regclass('public.wh_warehouses') is not null then
    execute 'select id from public.wh_warehouses where owner_id = $1 order by created_at asc limit 1'
      into v_wh using v_founder;
  end if;

  return jsonb_build_object(
    'ok', true,
    'role', v_role,
    'corp_name', v_corp_name,
    'is_founder', (v_founder = v_uid),
    'warehouse_id', v_wh,
    'warehouse_tables', (to_regclass('public.wh_warehouses') is not null),
    'vault_rpc', (to_regclass('public.corp_vault') is not null)
  );
end $function$;

revoke all on function public.corp_staff_desk(uuid) from public, anon;
grant execute on function public.corp_staff_desk(uuid) to authenticated;

commit;

-- ───────────────────────────────────────────────────────────────────────────
-- VERIFY. Expect two rows, and the role list must contain all three of
-- 'Bank Teller', 'Warehouse Worker', 'Weapon Smith'.
-- ───────────────────────────────────────────────────────────────────────────
select p.proname,
       p.prosecdef                                              as security_definer,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_call,
       (pg_get_functiondef(p.oid) like '%Warehouse Worker%'
        or p.proname = 'corp_staff_desk')                        as knows_new_roles
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('corp_set_role', 'corp_staff_desk')
 order by p.proname;
