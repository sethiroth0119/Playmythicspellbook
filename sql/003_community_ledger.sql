-- ═══════════════════════════════════════════════════════════════════════════
-- 003 · COMMUNITY CONTRIBUTION LEDGER + AUDIT LOG
--
-- Copies corp_treasury EXACTLY: append-only, balance = sum(amount). There is
-- no balance column, because a balance column is a thing that can drift from
-- its own history.
--
-- ⚠ This ledger records CONTRIBUTION. It is deliberately NOT a second wallet
--   sitting beside corp_treasury — the doc's own warning about duplicating the
--   treasury. Cinder actually leaves the player through the existing
--   spendGems() path; this records who gave what, for standings and rewards.
--
-- Requires 001. Idempotent, re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════

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

-- ⚠ A player may only ever write a POSITIVE contribution in their OWN name.
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
  values (p_community_id, v_uid, left(coalesce(p_actor_name,'—'), 40),
          left(coalesce(p_action,'?'), 60), left(coalesce(p_target,''), 120));
end $$;

revoke all on function public.community_log(uuid, text, text, text) from public, anon;
grant execute on function public.community_log(uuid, text, text, text) to authenticated;

-- ─── VERIFY ── expect tables 2, policies 3, rpc 1
select
  (select count(*) from pg_tables where schemaname='public'
     and tablename in ('community_ledger','community_audit'))                 as tables,
  (select count(*) from pg_policies where schemaname='public'
     and tablename in ('community_ledger','community_audit'))                 as policies,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='community_log')                  as rpc;
