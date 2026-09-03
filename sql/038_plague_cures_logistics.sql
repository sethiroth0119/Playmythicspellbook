-- ════════════════════════════════════════════════════════════════════════════
-- 038 — CURE LOGISTICS: waybills between player-owned haulage and player-owned
--       medical labs, and the payout ledger both ends are paid from.
--
-- Apply BY HAND in the Supabase SQL editor for project ktsiasyjusesawtrwrjc.
-- Idempotent and re-runnable. RLS ships in this file. Verify query at the end.
--
-- 🔴 WHAT IS DELIBERATELY *NOT* HERE, AND WHY.
--    Strains, infections and cure batches are NOT server tables. They live on
--    the player's own profile blob (Profile.plague), because they are facts
--    about ONE city's population — a roster that is itself local to that
--    player's save. Putting them here would mean either a shared world-disease
--    (a design nobody asked for) or a table with one row per citizen per
--    player, which is a lot of write traffic to reproduce state the client
--    already owns. What genuinely crosses between players is the CARGO: a
--    waybill and the money it moves. That is all three objects below.
--
-- 🔴 THE WHOLE FEATURE MUST WORK WITH NONE OF THIS APPLIED. Every call site is
--    guarded (see /src/plague/state.js) and falls back to the player's own
--    operations. "The tables do not exist yet" and "nobody is online" are
--    indistinguishable by design, and that is the correct degraded state.
-- ════════════════════════════════════════════════════════════════════════════

-- ── helper: does the caller own this operation? ─────────────────────────────
-- 🔴 SECURITY DEFINER ON PURPOSE (CLAUDE.md, "RLS recursion"). A policy on
--    cure_payouts that reads corp_operations would otherwise run that read
--    under the CALLER's RLS, and the two policy sets can then chase each other.
--    A definer function bypasses RLS and therefore terminates.
-- ⚠ op_id is TEXT, not uuid. Personally-funded operations live on the profile
--   (Profile.jbLocalOps) with ids like 'local_1712…' and 'company_medical', and
--   those are real operations a player owns — a uuid column would reject them
--   at insert time and quietly cut half the market out of the payout ledger.
--   The cast is guarded so a non-uuid id is simply "not a corp op", never an
--   error that takes the whole policy evaluation down.
create or replace function public.owns_operation(p_op_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.corp_operations o
    join public.corporations c on c.id = o.corp_id
    where c.founder_id = auth.uid()
      and p_op_id ~ '^[0-9a-fA-F-]{36}$'
      and o.id = p_op_id::uuid
  );
$$;
revoke all on function public.owns_operation(text) from public;
grant execute on function public.owns_operation(text) to authenticated;

-- ── 1. waybills ─────────────────────────────────────────────────────────────
create table if not exists public.cure_shipments (
  id uuid primary key default gen_random_uuid(),
  shipment_id text not null unique,          -- the client's own id; the join key
  shipper_id uuid not null references auth.users(id) on delete cascade,
  shipper_name text,
  carrier_op_id text not null,
  carrier_corp_id uuid references public.corporations(id) on delete set null,
  lab_op_id text not null,
  lab_corp_id uuid references public.corporations(id) on delete set null,
  strain_id text,
  strain_name text,
  doses int not null default 0,
  fee numeric not null default 0,
  integrity numeric not null default 0,
  grade text,                                -- grade AT DISPATCH
  arrived_grade text,                        -- grade ON ARRIVAL. The two differ
                                             -- when the cold chain broke, which
                                             -- is the whole point of the leg.
  cold_chain_broken boolean not null default false,
  status text not null default 'in_transit',
  arrives_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists cure_shipments_carrier on public.cure_shipments (carrier_op_id, status);
create index if not exists cure_shipments_lab on public.cure_shipments (lab_op_id, status);
create index if not exists cure_shipments_shipper on public.cure_shipments (shipper_id, created_at desc);

alter table public.cure_shipments enable row level security;

-- 🔴 READ IS NOT PUBLIC. Three parties have a legitimate interest in a waybill
--    — the shipper, the haulier and the receiving lab — and nobody else. A
--    `using (true)` here would publish every player's medical logistics to
--    every other player, which is exactly the kind of line that "looks fine in
--    review" and is a data leak.
drop policy if exists cs_sel on public.cure_shipments;
create policy cs_sel on public.cure_shipments for select to authenticated
  using (
    shipper_id = auth.uid()
    or public.owns_operation(carrier_op_id)
    or public.owns_operation(lab_op_id)
  );

drop policy if exists cs_ins on public.cure_shipments;
create policy cs_ins on public.cure_shipments for insert to authenticated
  with check (shipper_id = auth.uid());

-- Only the shipper settles their own waybill. The carrier does not get to
-- declare its own delivery a success.
drop policy if exists cs_upd on public.cure_shipments;
create policy cs_upd on public.cure_shipments for update to authenticated
  using (shipper_id = auth.uid())
  with check (shipper_id = auth.uid());

-- ── 2. the payout ledger ────────────────────────────────────────────────────
-- 🔴 APPEND-ONLY (CLAUDE.md). One ROW per party per shipment. An operation's
--    earnings are sum(amount), never a balance column somebody UPDATEs — the
--    same contract corp_treasury runs on.
-- ⚠ `claimed` is NOT a balance and updating it is not a balance write. It is
--   the same claim flag city_mayor_pay already uses: the row and its amount are
--   immutable, and the flag only records that the money has been moved into the
--   payee's Cinder. The check constraint below is what keeps that true.
create table if not exists public.cure_payouts (
  id uuid primary key default gen_random_uuid(),
  shipment_id text not null,
  op_id text not null,
  corp_id uuid references public.corporations(id) on delete set null,
  role text not null check (role in ('carrier', 'lab')),
  amount numeric not null default 0 check (amount >= 0),
  rating_delta int not null default 0,
  payer_id uuid references auth.users(id) on delete set null,
  payer_name text,
  claimed boolean not null default false,
  created_at timestamptz default now(),
  unique (shipment_id, role)                 -- one payout per party per haul
);
create index if not exists cure_payouts_op on public.cure_payouts (op_id, claimed);
create index if not exists cure_payouts_ship on public.cure_payouts (shipment_id);

alter table public.cure_payouts enable row level security;

-- The payee (whoever owns the named operation) and the payer. Nobody else.
drop policy if exists cp_sel on public.cure_payouts;
create policy cp_sel on public.cure_payouts for select to authenticated
  using (payer_id = auth.uid() or public.owns_operation(op_id));

drop policy if exists cp_ins on public.cure_payouts;
create policy cp_ins on public.cure_payouts for insert to authenticated
  with check (payer_id = auth.uid());

-- 🔴 ONLY THE PAYEE MAY CLAIM, and the WITH CHECK is what stops a claim from
--    being an edit. Without `owns_operation` on both sides of this policy a
--    payer could mark their own outgoing payments claimed and the carrier
--    would never see the money.
drop policy if exists cp_upd on public.cure_payouts;
create policy cp_upd on public.cure_payouts for update to authenticated
  using (public.owns_operation(op_id))
  with check (public.owns_operation(op_id));

-- 🔴 NO DELETE POLICY. Append-only means append-only; a payout row is the
--    record that a player was paid and there is no legitimate reason to remove
--    one. RLS denies by default, so the absence of a policy IS the rule.

-- The immutability guard. RLS says WHO may update; this says WHAT they may
-- change — the claim flag and nothing else. Without it, "only the payee may
-- update" would let a payee rewrite their own amount.
create or replace function public.cure_payouts_lock()
returns trigger
language plpgsql
as $$
begin
  if new.amount is distinct from old.amount
     or new.op_id is distinct from old.op_id
     or new.shipment_id is distinct from old.shipment_id
     or new.role is distinct from old.role
     or new.rating_delta is distinct from old.rating_delta
     or new.payer_id is distinct from old.payer_id then
    raise exception 'cure_payouts is append-only; only `claimed` may change';
  end if;
  -- A claim is one-way. Un-claiming would be a second payment.
  if old.claimed and not new.claimed then
    raise exception 'a claimed payout cannot be un-claimed';
  end if;
  return new;
end;
$$;
drop trigger if exists cure_payouts_lock_trg on public.cure_payouts;
create trigger cure_payouts_lock_trg
  before update on public.cure_payouts
  for each row execute function public.cure_payouts_lock();

-- ── 3. the carrier / lab market ─────────────────────────────────────────────
-- A VIEW, not a table. The operations already exist in corp_operations and
-- duplicating them into a second table would create two sources of truth for
-- "how many workers does this haulier have" — and the stale one is the one the
-- shipping quote would read.
-- ⚠ security_invoker = true, matching `reserve_totals`. The view is therefore
--   filtered by corp_operations' OWN select policy rather than bypassing it.
-- ⚠ Only `transport` and `medical` are exposed. A view over every operation
--   type would be a general-purpose directory of everyone's businesses, which
--   is not what this feature needs and not what its RLS was reviewed for.
drop view if exists public.plague_carriers;
create view public.plague_carriers with (security_invoker = true) as
  select
    o.id::text                    as op_id,
    o.corp_id                     as corp_id,
    c.founder_id                  as owner_id,
    coalesce(m.user_name, 'Survivor') as owner_name,
    c.name                        as corp_name,
    o.op_type                     as op_type,
    o.level                       as level,
    o.workers                     as workers,
    o.status                      as status,
    -- Reputation: the sum of every rating delta this operation has earned.
    -- +1 for a clean run, −1 for a slipped chain, −2 for a broken one. It is
    -- derived, never stored, so it cannot drift from the deliveries behind it.
    coalesce(r.rating, 0)::int    as rating
  from public.corp_operations o
  join public.corporations c on c.id = o.corp_id
  left join public.corp_members m on m.user_id = c.founder_id
  left join (
    select op_id, sum(rating_delta) as rating
    from public.cure_payouts
    where role = 'carrier'
    group by op_id
  ) r on r.op_id = o.id::text
  where o.op_type in ('transport', 'medical')
    and o.status = 'active';

grant select on public.plague_carriers to authenticated;

-- ── verify ──────────────────────────────────────────────────────────────────
-- Expect: three rows for the two tables + the view, and rls_enabled true on
-- both tables. A `false` in rls_enabled is a data breach, not a warning.
select 'cure_shipments' as object,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'cure_shipments') as policies,
       (select relrowsecurity from pg_class where oid = 'public.cure_shipments'::regclass) as rls_enabled
union all
select 'cure_payouts',
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'cure_payouts'),
       (select relrowsecurity from pg_class where oid = 'public.cure_payouts'::regclass)
union all
select 'plague_carriers',
       (select count(*) from pg_views where schemaname = 'public' and viewname = 'plague_carriers'),
       true;
