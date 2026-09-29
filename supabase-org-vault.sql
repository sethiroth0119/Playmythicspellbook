-- ════════════════════════════════════════════════════════════════════════
-- 🏦 ORG VAULT · LOGISTICS LEDGER · MEMBER TRADE
--
-- Run in the Supabase SQL editor for project ktsiasyjusesawtrwrjc.
-- Idempotent — safe to re-run.
--
-- WHAT WAS BLOCKING THIS
--   corp_vault already restricts SELECT to members of the org, so "only
--   players from that org can see it" was already true. What did NOT work is
--   TAKING anything out: the update policy is `depositor_id = auth.uid()`,
--   so only the person who deposited an item could ever touch it. A shared
--   vault nobody else can draw from is a personal stash.
--
-- WHY WITHDRAWAL IS AN RPC AND NOT A POLICY
--   The obvious fix — let any member UPDATE corp_vault — is unsafe: an UPDATE
--   policy cannot express "you may only DECREASE qty, by an amount you
--   actually asked for". A member could set qty to a million. The RPC below
--   is the only write path: it checks membership, refuses to overdraw, takes
--   from the oldest deposits first, and writes the ledger row in the SAME
--   transaction so a withdrawal can never happen unlogged.
-- ════════════════════════════════════════════════════════════════════════


-- ── 1. THE LEDGER — what Logistics reads ────────────────────────────────
create table if not exists public.corp_vault_log (
  id           bigserial primary key,
  corp_id      uuid not null references public.corporations(id) on delete cascade,
  actor_id     uuid references auth.users(id) on delete set null,
  actor_name   text,
  action       text not null check (action in ('deposit','withdraw','send','claim','cancel')),
  kind         text not null,
  item_id      text not null,
  name         text,
  icon         text,
  qty          numeric not null default 0,
  counterparty_id   uuid references auth.users(id) on delete set null,
  counterparty_name text,
  created_at   timestamptz not null default now()
);
create index if not exists corp_vault_log_corp on public.corp_vault_log (corp_id, created_at desc);

alter table public.corp_vault_log enable row level security;

-- Members read their own org's ledger. Nobody writes it directly — every row
-- comes from an RPC below, so the history cannot be forged or edited.
drop policy if exists cvl_sel on public.corp_vault_log;
create policy cvl_sel on public.corp_vault_log for select to authenticated
  using (exists (select 1 from public.corp_members m
                 where m.corp_id = corp_vault_log.corp_id and m.user_id = auth.uid()));
revoke insert, update, delete on public.corp_vault_log from anon, authenticated;


-- ── 2. DEPOSIT ──────────────────────────────────────────────────────────
create or replace function public.corp_vault_deposit(
  p_corp_id uuid, p_kind text, p_item_id text,
  p_name text, p_icon text, p_qty numeric, p_actor_name text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if coalesce(p_qty,0) <= 0 then raise exception 'quantity must be positive'; end if;
  if not exists (select 1 from corp_members where corp_id = p_corp_id and user_id = v_uid) then
    raise exception 'not a member of that organization';
  end if;

  insert into corp_vault (corp_id, depositor_id, depositor_name, kind, item_id, name, icon, qty)
  values (p_corp_id, v_uid, p_actor_name, p_kind, p_item_id, p_name, p_icon, p_qty)
  on conflict (corp_id, depositor_id, kind, item_id)
    do update set qty = corp_vault.qty + excluded.qty,
                  name = coalesce(excluded.name, corp_vault.name),
                  icon = coalesce(excluded.icon, corp_vault.icon),
                  updated_at = now();

  insert into corp_vault_log (corp_id, actor_id, actor_name, action, kind, item_id, name, icon, qty)
  values (p_corp_id, v_uid, p_actor_name, 'deposit', p_kind, p_item_id, p_name, p_icon, p_qty);
end $$;


-- ── 3. WITHDRAW — any member, oldest deposits first ─────────────────────
-- The vault is keyed per DEPOSITOR, so one withdrawal usually spans several
-- rows. Taking oldest-first keeps it fair and predictable, and the whole
-- thing is one transaction: either the full amount comes out and is logged,
-- or nothing moves.
create or replace function public.corp_vault_withdraw(
  p_corp_id uuid, p_kind text, p_item_id text, p_qty numeric, p_actor_name text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_left numeric := coalesce(p_qty, 0);
  v_avail numeric;
  r record;
  v_take numeric;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if v_left <= 0 then raise exception 'quantity must be positive'; end if;
  if not exists (select 1 from corp_members where corp_id = p_corp_id and user_id = v_uid) then
    raise exception 'not a member of that organization';
  end if;

  select coalesce(sum(qty),0) into v_avail from corp_vault
   where corp_id = p_corp_id and kind = p_kind and item_id = p_item_id;
  if v_avail < v_left then
    raise exception 'vault holds only % of that item', v_avail;
  end if;

  for r in select id, qty from corp_vault
            where corp_id = p_corp_id and kind = p_kind and item_id = p_item_id and qty > 0
            order by created_at asc for update
  loop
    exit when v_left <= 0;
    v_take := least(r.qty, v_left);
    update corp_vault set qty = qty - v_take, updated_at = now() where id = r.id;
    v_left := v_left - v_take;
  end loop;

  delete from corp_vault
   where corp_id = p_corp_id and kind = p_kind and item_id = p_item_id and qty <= 0;

  insert into corp_vault_log (corp_id, actor_id, actor_name, action, kind, item_id, qty)
  values (p_corp_id, v_uid, p_actor_name, 'withdraw', p_kind, p_item_id, p_qty);

  return p_qty;
end $$;


-- ── 4. TRADE WINDOW — member to member ──────────────────────────────────
-- Two steps on purpose. A transfer sits as 'sent' until the recipient claims
-- it, so nothing lands in a player's account without the game acknowledging
-- it, and the sender can cancel while it is still pending.
create table if not exists public.corp_transfers (
  id           uuid primary key default gen_random_uuid(),
  corp_id      uuid not null references public.corporations(id) on delete cascade,
  from_id      uuid not null references auth.users(id) on delete cascade,
  from_name    text,
  to_id        uuid not null references auth.users(id) on delete cascade,
  to_name      text,
  kind         text not null,
  item_id      text not null,
  name         text,
  icon         text,
  qty          numeric not null default 0,
  note         text,
  status       text not null default 'sent' check (status in ('sent','claimed','cancelled')),
  created_at   timestamptz not null default now(),
  settled_at   timestamptz
);
create index if not exists corp_transfers_to   on public.corp_transfers (to_id, status);
create index if not exists corp_transfers_corp on public.corp_transfers (corp_id, created_at desc);

alter table public.corp_transfers enable row level security;

-- Either party sees it. Writes go through the RPCs only.
drop policy if exists ctr_sel on public.corp_transfers;
create policy ctr_sel on public.corp_transfers for select to authenticated
  using (from_id = auth.uid() or to_id = auth.uid());
revoke insert, update, delete on public.corp_transfers from anon, authenticated;

create or replace function public.corp_send_asset(
  p_corp_id uuid, p_to_id uuid, p_kind text, p_item_id text,
  p_name text, p_icon text, p_qty numeric, p_note text default null,
  p_from_name text default null, p_to_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if coalesce(p_qty,0) <= 0 then raise exception 'quantity must be positive'; end if;
  if p_to_id = v_uid then raise exception 'cannot send to yourself'; end if;
  -- BOTH sides must be in the org. Without the recipient check this becomes a
  -- way to move assets to any account in the game, org membership irrelevant.
  if not exists (select 1 from corp_members where corp_id = p_corp_id and user_id = v_uid) then
    raise exception 'not a member of that organization';
  end if;
  if not exists (select 1 from corp_members where corp_id = p_corp_id and user_id = p_to_id) then
    raise exception 'recipient is not a member of that organization';
  end if;

  insert into corp_transfers (corp_id, from_id, from_name, to_id, to_name,
                              kind, item_id, name, icon, qty, note)
  values (p_corp_id, v_uid, p_from_name, p_to_id, p_to_name,
          p_kind, p_item_id, p_name, p_icon, p_qty, p_note)
  returning id into v_id;

  insert into corp_vault_log (corp_id, actor_id, actor_name, action, kind, item_id,
                              name, icon, qty, counterparty_id, counterparty_name)
  values (p_corp_id, v_uid, p_from_name, 'send', p_kind, p_item_id,
          p_name, p_icon, p_qty, p_to_id, p_to_name);
  return v_id;
end $$;

-- Claim is idempotent by construction: the WHERE clause only matches a row
-- still in 'sent', so a double-click or a retried request cannot pay twice.
create or replace function public.corp_claim_transfer(p_id uuid)
returns public.corp_transfers language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); r public.corp_transfers;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  update corp_transfers set status = 'claimed', settled_at = now()
   where id = p_id and to_id = v_uid and status = 'sent'
   returning * into r;
  if r.id is null then raise exception 'nothing to claim'; end if;

  insert into corp_vault_log (corp_id, actor_id, actor_name, action, kind, item_id,
                              name, icon, qty, counterparty_id, counterparty_name)
  values (r.corp_id, v_uid, r.to_name, 'claim', r.kind, r.item_id,
          r.name, r.icon, r.qty, r.from_id, r.from_name);
  return r;
end $$;

create or replace function public.corp_cancel_transfer(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); r public.corp_transfers;
begin
  update corp_transfers set status = 'cancelled', settled_at = now()
   where id = p_id and from_id = v_uid and status = 'sent'
   returning * into r;
  if r.id is null then raise exception 'nothing to cancel'; end if;
  insert into corp_vault_log (corp_id, actor_id, actor_name, action, kind, item_id, qty)
  values (r.corp_id, v_uid, r.from_name, 'cancel', r.kind, r.item_id, r.qty);
end $$;


-- ── 5. grants ───────────────────────────────────────────────────────────
revoke all on function public.corp_vault_deposit(uuid,text,text,text,text,numeric,text) from public, anon;
revoke all on function public.corp_vault_withdraw(uuid,text,text,numeric,text)          from public, anon;
revoke all on function public.corp_send_asset(uuid,uuid,text,text,text,text,numeric,text,text,text) from public, anon;
revoke all on function public.corp_claim_transfer(uuid)  from public, anon;
revoke all on function public.corp_cancel_transfer(uuid) from public, anon;

grant execute on function public.corp_vault_deposit(uuid,text,text,text,text,numeric,text) to authenticated;
grant execute on function public.corp_vault_withdraw(uuid,text,text,numeric,text)          to authenticated;
grant execute on function public.corp_send_asset(uuid,uuid,text,text,text,text,numeric,text,text,text) to authenticated;
grant execute on function public.corp_claim_transfer(uuid)  to authenticated;
grant execute on function public.corp_cancel_transfer(uuid) to authenticated;


-- ── verify ──────────────────────────────────────────────────────────────
-- 1) the five RPCs exist:
--    select proname from pg_proc where proname like 'corp_%'
--     and proname in ('corp_vault_deposit','corp_vault_withdraw','corp_send_asset',
--                     'corp_claim_transfer','corp_cancel_transfer');
--
-- 2) the ledger is read-only to players (expect ONE policy, a SELECT):
--    select policyname, cmd from pg_policies where tablename = 'corp_vault_log';
--
-- 3) a non-member cannot overdraw (expect an exception, not a row):
--    select public.corp_vault_withdraw('<some-corp-uuid>','resource','metal',999999);
