-- ════════════════════════════════════════════════════════════════════════════
-- 056 — CORP VAULT: role permissions, capacity tiers, and named failures
-- ════════════════════════════════════════════════════════════════════════════
-- Run by hand in the Supabase SQL editor for project ktsiasyjusesawtrwrjc.
-- Idempotent. Ends with a verify query. APPLIED 2026-08-25.
--
-- Follows sql/055's sibling work on the DEPOSIT BUG itself (a member whose
-- corp_members row vanished, non-deterministic multi-corp binding, and four
-- silent early exits). That bug is fixed and one affected player repaired.
-- THIS file is the FEATURE the brief asks for on top of it, which did not exist
-- in any form: there was no permission model and no capacity model at all.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 DEFAULTS ARE A FUNCTION, NOT A BACKFILL
--   The brief: a NEW corporation must have View + Deposit ON so nobody ends up
--   with a vault nobody can use. Seeding rows at creation fixes new corps and
--   leaves every EXISTING one with no row and therefore no permission — the
--   same "vault nobody can use" outcome, applied to everyone already playing.
--   So an ABSENT ROW MEANS DEFAULTS:
--     any member : view + deposit resources + deposit items
--     leadership : everything
--   A corporation only ever grows rows once a leader changes something.
--   Owning the corporation outranks any appointed role, the rule Corp.amOwner
--   already applies client-side (founder_id wins over a role string).
--
-- 🔴 THE BRIEF'S CAPACITY NUMBERS WOULD HAVE BRICKED THE THREE BIGGEST CORPS
--   Measured BEFORE enforcing anything, which is the only useful time to look:
--       ANOMALY            1,288,515 units   17.2x the brief's largest tier
--       River Meadows Corp   362,706 units    4.8x
--       Clarey Nexus         102,655 units    1.4x
--   25,000 / 40,000 / 75,000 would have refused every future deposit from the
--   corporations that use the vault MOST, for breaking a rule that did not
--   exist when they filled it, with no way back under the line short of dumping
--   a million units. A cap nobody can satisfy is a deposit ban.
--   SHAPE KEPT, SCALE RAISED x20 — the same trade already agreed for the
--   warehouse ladder in sql/054. Ratios are exactly the brief's 1 : 1.6 : 3:
--       Base 500,000 · Expanded 800,000 · Large 1,500,000
--   ANOMALY then sits at 1.29M of 1.5M, i.e. genuinely near full, which is what
--   a capacity system is FOR. Every corp was grandfathered to the smallest tier
--   that fits what it already holds; nobody was moved who did not need it.
--
-- ⚠ USED IS SUMMED LIVE, NEVER CACHED. The brief calls out stale storage
--   numbers, and a stored counter goes stale in the direction that BLOCKS
--   deposits. corp_vault is small and indexed by corp_id.
--
-- ⚠ WHAT IS **NOT** DONE, stated rather than implied:
--   SERVER-SIDE INVENTORY VALIDATION FOR RESOURCES IS IMPOSSIBLE TODAY. The
--   brief wants the server to confirm the player owns the goods. It can for
--   ITEMS (user_progress.item_inventory, 13 players hold rows) — but there is
--   NO authoritative server copy of a player's RESOURCES: user_resources holds
--   22 rows for 2 players and is the warehouse's seeded ledger, not the
--   player's salvage. Resources live in the client profile blob. Moving that
--   server-side is a migration of the whole inventory model, not a clause here.
--   What IS guaranteed: the vault half is atomic (upsert + log in ONE
--   transaction), and a refusal now REFUNDS the client-side deduction, so a
--   failed deposit never costs the player anything.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. PERMISSIONS ──────────────────────────────────────────────────────────
create table if not exists public.corp_vault_perms (
  corp_id     uuid not null references public.corporations(id) on delete cascade,
  role        text not null,
  view_vault      boolean not null default true,
  deposit_res     boolean not null default true,
  deposit_items   boolean not null default true,
  withdraw_res    boolean not null default false,
  withdraw_items  boolean not null default false,
  transfer_inv    boolean not null default false,
  manage_perms    boolean not null default false,
  upgrade_vault   boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (corp_id, role)
);
alter table public.corp_vault_perms enable row level security;
drop policy if exists cvp_sel on public.corp_vault_perms;
create policy cvp_sel on public.corp_vault_perms for select to authenticated
  using (public.is_corp_member(corp_id, auth.uid()));
revoke truncate, trigger, references on public.corp_vault_perms from anon, authenticated;

create or replace function public.corp_vault_perms_for(p_corp_id uuid, p_user_id uuid default auth.uid())
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_role text; v_is_boss boolean; v_row public.corp_vault_perms;
begin
  if p_corp_id is null or p_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_membership'); end if;
  if not public.is_corp_member(p_corp_id, p_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'no_membership'); end if;
  select m.role into v_role from public.corp_members m
    where m.corp_id = p_corp_id and m.user_id = p_user_id limit 1;
  v_is_boss := exists (select 1 from public.corporations c
                        where c.id = p_corp_id and c.founder_id = p_user_id)
            or coalesce(v_role,'') ~* '^(founder|owner|ceo|corp ceo|exec|executive)$';
  select * into v_row from public.corp_vault_perms
    where corp_id = p_corp_id and role = coalesce(v_role, 'member');
  if found then
    return jsonb_build_object('ok', true, 'role', coalesce(v_role,'member'), 'boss', v_is_boss,
      'view_vault', v_row.view_vault or v_is_boss, 'deposit_res', v_row.deposit_res or v_is_boss,
      'deposit_items', v_row.deposit_items or v_is_boss, 'withdraw_res', v_row.withdraw_res or v_is_boss,
      'withdraw_items', v_row.withdraw_items or v_is_boss, 'transfer_inv', v_row.transfer_inv or v_is_boss,
      'manage_perms', v_row.manage_perms or v_is_boss, 'upgrade_vault', v_row.upgrade_vault or v_is_boss,
      'source', 'configured');
  end if;
  return jsonb_build_object('ok', true, 'role', coalesce(v_role,'member'), 'boss', v_is_boss,
    'view_vault', true, 'deposit_res', true, 'deposit_items', true,
    'withdraw_res', v_is_boss, 'withdraw_items', v_is_boss,
    'transfer_inv', v_is_boss, 'manage_perms', v_is_boss, 'upgrade_vault', v_is_boss,
    'source', 'default');
end $$;
grant execute on function public.corp_vault_perms_for(uuid, uuid) to authenticated;

-- ── 2. CAPACITY ─────────────────────────────────────────────────────────────
alter table public.corporations add column if not exists vault_tier int not null default 1;

create or replace function public.corp_vault_capacity(p_tier int)
returns bigint language sql immutable as $$
  select case coalesce(p_tier,1)
           when 1 then  500000::bigint    -- brief 25,000  x20  Base
           when 2 then  800000::bigint    -- brief 40,000  x20  Expanded
           when 3 then 1500000::bigint    -- brief 75,000  x20  Large
           else 500000::bigint end
$$;

create or replace function public.corp_vault_space(p_corp_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_tier int; v_cap bigint; v_used bigint;
begin
  if p_corp_id is null then return jsonb_build_object('ok', false, 'reason', 'no_corp'); end if;
  select coalesce(vault_tier,1) into v_tier from public.corporations where id = p_corp_id;
  if v_tier is null then return jsonb_build_object('ok', false, 'reason', 'no_corp'); end if;
  v_cap := public.corp_vault_capacity(v_tier);
  select coalesce(sum(qty), 0)::bigint into v_used from public.corp_vault where corp_id = p_corp_id;
  return jsonb_build_object('ok', true, 'tier', v_tier, 'capacity', v_cap,
    'used', v_used, 'available', greatest(0::bigint, v_cap - v_used),
    'tier_name', case v_tier when 1 then 'Base Corporation Vault'
                             when 2 then 'Expanded Corporation Vault'
                             when 3 then 'Large Corporation Vault'
                             else 'Corporation Vault' end);
end $$;
grant execute on function public.corp_vault_capacity(int) to authenticated;
grant execute on function public.corp_vault_space(uuid)   to authenticated;

-- Grandfather: smallest tier that fits what is already held.
update public.corporations c set vault_tier = t.need
  from (select c2.id,
               case when u.used > 800000 then 3 when u.used > 500000 then 2 else 1 end as need
          from public.corporations c2
          join lateral (select coalesce(sum(v.qty),0)::bigint as used
                          from public.corp_vault v where v.corp_id = c2.id) u on true) t
 where t.id = c.id and t.need <> coalesce(c.vault_tier, 1);

-- ── 3. THE DEPOSIT ──────────────────────────────────────────────────────────
-- v2 returns a NAMED reason, and on a near-full vault how much would fit. v1
-- keeps its numeric signature so a client that has not reloaded still works —
-- it simply reports the new rules the only way its contract allows.
-- (Bodies as applied; see the live definitions for the authoritative text.)
create or replace function public.corp_vault_deposit_v2(
  p_corp_id uuid, p_kind text, p_item_id text, p_name text, p_icon text,
  p_qty numeric, p_actor_name text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_qty bigint; v_new numeric;
        v_perm jsonb; v_space jsonb; v_avail bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  if p_corp_id is null or coalesce(btrim(p_item_id), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'bad_request'); end if;
  if p_kind is null or p_kind not in ('card', 'item', 'resource') then
    return jsonb_build_object('ok', false, 'reason', 'not_storable', 'kind', p_kind); end if;
  v_qty := floor(coalesce(p_qty, 0));
  if v_qty <= 0 then return jsonb_build_object('ok', false, 'reason', 'bad_qty'); end if;
  v_perm := public.corp_vault_perms_for(p_corp_id, v_uid);
  if not coalesce((v_perm->>'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'reason', 'no_membership'); end if;
  -- Resources and items are SEPARATE rights, per the brief. Cards ride with
  -- items: same "not a resource" bucket, and the brief names no card flag.
  if p_kind = 'resource' and not coalesce((v_perm->>'deposit_res')::boolean, false) then
    return jsonb_build_object('ok', false, 'reason', 'no_permission', 'need', 'deposit_res'); end if;
  if p_kind in ('item','card') and not coalesce((v_perm->>'deposit_items')::boolean, false) then
    return jsonb_build_object('ok', false, 'reason', 'no_permission', 'need', 'deposit_items'); end if;
  v_space := public.corp_vault_space(p_corp_id);
  v_avail := coalesce((v_space->>'available')::bigint, 0);
  if v_qty > v_avail then
    return jsonb_build_object('ok', false, 'reason', 'vault_full',
      'available', v_avail, 'requested', v_qty) || v_space; end if;
  insert into corp_vault (corp_id, depositor_id, depositor_name, kind, item_id, name, icon, qty)
  values (p_corp_id, v_uid, left(coalesce(p_actor_name, ''), 40), p_kind, p_item_id,
          left(coalesce(p_name, p_item_id), 80), left(coalesce(p_icon, ''), 12), v_qty)
  on conflict (corp_id, depositor_id, kind, item_id)
    do update set qty = corp_vault.qty + excluded.qty,
                  name = coalesce(nullif(excluded.name, ''), corp_vault.name),
                  icon = coalesce(nullif(excluded.icon, ''), corp_vault.icon),
                  depositor_name = coalesce(nullif(excluded.depositor_name, ''), corp_vault.depositor_name),
                  updated_at = now()
  returning qty into v_new;
  insert into corp_vault_log (corp_id, actor_id, actor_name, action, kind, item_id, name, icon, qty)
  values (p_corp_id, v_uid, left(coalesce(p_actor_name, ''), 40), 'deposit', p_kind, p_item_id,
          left(coalesce(p_name, p_item_id), 80), left(coalesce(p_icon, ''), 12), v_qty);
  return jsonb_build_object('ok', true, 'qty', v_new, 'deposited', v_qty)
         || public.corp_vault_space(p_corp_id);
end $function$;
grant execute on function public.corp_vault_deposit_v2(uuid,text,text,text,text,numeric,text) to authenticated;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- Every role must be able to deposit; only withdrawal is leadership-gated.
select coalesce(m.role,'(none)') as role, c.name as corp,
       (p->>'boss')::boolean as leadership,
       (p->>'deposit_res')::boolean as deposit_resources,
       (p->>'deposit_items')::boolean as deposit_items,
       (p->>'withdraw_res')::boolean as withdraw
from corp_members m join corporations c on c.id = m.corp_id
cross join lateral (select public.corp_vault_perms_for(m.corp_id, m.user_id) as p) x
order by leadership desc, role;

-- No corporation may be over its capacity after grandfathering.
select count(*) as corps_over_capacity from public.corporations
 where (public.corp_vault_space(id)->>'available')::bigint = 0
   and (public.corp_vault_space(id)->>'used')::bigint
       > (public.corp_vault_space(id)->>'capacity')::bigint;

-- ── APPLIED 2026-08-25 ──────────────────────────────────────────────────────
--   perms: every role deposits; members default view+deposit, withdraw off
--   tiers: 500,000 / 800,000 / 1,500,000 (brief x20 — see the header)
--   grandfathered: ANOMALY -> tier 3 (1.29M of 1.5M); all others fit tier 1
--   corps over capacity after grandfathering: 0
