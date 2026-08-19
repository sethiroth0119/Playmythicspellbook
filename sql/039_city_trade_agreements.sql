-- ════════════════════════════════════════════════════════════════════════════
-- 039 — CITY TRADE AGREEMENTS: standing 12-hourly deals between two cities
-- ----------------------------------------------------------------------------
-- "Do business with this city."
--
-- 038 gave cities a marketplace: standing OFFERS and WANTS that anyone can
-- fill once. This is the other half — a CONTRACT. Two named cities agree to
-- ship each other a fixed quantity every cycle (12h by default) for a fixed
-- number of days, and it settles on its own until it expires or is cancelled.
--
-- 🔴 RESOURCES DO NOT LIVE IN POSTGRES, AND THIS FILE DOES NOT PRETEND THEY DO.
--    A city's stock is client-side (see CLAUDE.md: the economy holds its own
--    inventory; only the audited Cinder payout crosses the bridge). So there is
--    no server-side "move 200 metal" here and there cannot be one. This schema
--    records OBLIGATIONS and FACTS; each client applies its own side locally
--    through /src/trading/settle.js, the atomic unwinding mover that already
--    exists for player-to-player trade.
--    That is not a workaround — it is exactly the shape 019 already uses for
--    resource trades (resource_trade_ledger + resource_trade_claims, where the
--    claim insert IS the lock). Copying a proven pattern beats inventing a
--    second one that has to be debugged from scratch.
--
-- 🔴 THE CYCLE ROW IS THE LOCK. Settlement is client-driven: whichever party is
--    online computes which cycles are due and inserts them. `unique (agreement_id,
--    cycle_index)` means the second client to try is a no-op rather than a
--    double shipment. There is no scheduler to run and nothing to monitor.
--    ⚠ Consequence, stated rather than hidden: a cycle settles when SOMEONE
--      comes online, not at the exact minute. A deal whose parties are both away
--      for two days settles four cycles at once on the next login. Catch-up is
--      bounded by MAX_CATCHUP_CYCLES in the client so a long absence cannot
--      dump fifty shipments in one frame.
--
-- 🔴 RLS IS THE ENTIRE SECURITY BOUNDARY. Every policy below is scoped by
--    auth.uid() through is_city_trade_party(). A missing `using (...)` here is
--    a data breach that looks fine in review — read every line.
--    ⚠ RECURSION: a policy on city_trade_agreements that itself SELECTs
--      city_trade_agreements would recurse. The party check is a SECURITY
--      DEFINER function, which bypasses RLS and therefore terminates. Same rule
--      the community tables follow.
--
-- Idempotent and re-runnable. Ends with a verify query.
-- Apply by hand in the Supabase SQL editor for project ktsiasyjusesawtrwrjc.
-- Depends on 038 (city_profiles).
-- ════════════════════════════════════════════════════════════════════════════

-- ── city_trade_agreements ───────────────────────────────────────────────────
-- One row per standing deal. Mutable ONLY in `status` and `cancelled_*` — the
-- terms are frozen once accepted, because a deal whose quantity can be edited
-- after acceptance is not a deal.
create table if not exists public.city_trade_agreements (
  id              uuid primary key default gen_random_uuid(),

  proposer_id     uuid not null references auth.users(id)          on delete cascade,
  partner_id      uuid not null references auth.users(id)          on delete cascade,
  proposer_city   uuid not null references public.city_profiles(id) on delete cascade,
  partner_city    uuid not null references public.city_profiles(id) on delete cascade,

  -- What each side ships PER CYCLE. Either leg may be zero: a one-way supply
  -- deal ("I will send you 200 water every 12h") is a legitimate agreement and
  -- forcing a token return leg would make the UI lie about what was agreed.
  gives_resource  text    not null,
  gives_units     numeric not null check (gives_units >= 0),
  wants_resource  text    not null,
  wants_units     numeric not null check (wants_units >= 0),

  cycle_hours     integer not null default 12 check (cycle_hours between 1 and 168),
  days            integer not null check (days between 1 and 90),

  -- 🔴 A PROPOSAL IS NOT A CONTRACT. The partner's stock is their property, so
  --    nothing ships until they accept. This is not in the brief and is added
  --    deliberately: without it, any player could bind any other player's
  --    resources by filling in a form.
  status          text not null default 'pending'
                    check (status in ('pending','active','declined','cancelled','completed')),

  starts_at       timestamptz,                        -- set on accept, not on propose
  accepted_at     timestamptz,
  cancelled_at    timestamptz,
  cancelled_by    uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),

  -- A city cannot contract with itself, and the two legs must name real work.
  constraint cta_distinct_parties check (proposer_id <> partner_id),
  constraint cta_some_cargo       check (gives_units > 0 or wants_units > 0)
);

create index if not exists cta_proposer_idx on public.city_trade_agreements (proposer_id, status);
create index if not exists cta_partner_idx  on public.city_trade_agreements (partner_id,  status);
-- The catch-up sweep asks "what of mine is live" on every city open.
create index if not exists cta_live_idx     on public.city_trade_agreements (status, starts_at)
  where status = 'active';

-- ── city_trade_shipments ────────────────────────────────────────────────────
-- Append-only. One row per cycle that fired. Nothing here is ever UPDATEd:
-- what happened is a fact, and a fact does not get edited (019's rule).
create table if not exists public.city_trade_shipments (
  id             bigint generated always as identity primary key,
  agreement_id   uuid    not null references public.city_trade_agreements(id) on delete cascade,
  cycle_index    integer not null check (cycle_index >= 0),

  -- What each side was ABLE to ship. Short of the agreed units is the
  -- interesting case and is recorded rather than corrected.
  proposer_sent  numeric not null default 0 check (proposer_sent >= 0),
  partner_sent   numeric not null default 0 check (partner_sent  >= 0),

  -- 'settled'      both legs delivered in full
  -- 'short_*'      that side could not cover its leg
  -- 'short_both'   neither could
  outcome        text not null default 'settled'
                   check (outcome in ('settled','short_proposer','short_partner','short_both')),

  due_at         timestamptz not null,
  settled_at     timestamptz not null default now(),

  -- 🔴 THE LOCK. Both clients race to settle a due cycle; the loser's insert
  --    violates this and is swallowed as "already done". This single constraint
  --    is what makes client-driven settlement safe without a scheduler.
  unique (agreement_id, cycle_index)
);

create index if not exists cts_agreement_idx on public.city_trade_shipments (agreement_id, cycle_index desc);

-- ── city_trade_shipment_claims ──────────────────────────────────────────────
-- A shipment ROW says the cycle fired. It does not say either player's local
-- ledger has been touched — that happens in the browser. Each party claims its
-- own side exactly once so a reload cannot re-apply the same cargo.
-- Same shape and same reason as 019's resource_trade_claims.
create table if not exists public.city_trade_shipment_claims (
  shipment_id bigint not null references public.city_trade_shipments(id) on delete cascade,
  party       text   not null check (party in ('proposer','partner')),
  claimed_by  uuid   not null references auth.users(id) on delete cascade,
  claimed_at  timestamptz not null default now(),
  primary key (shipment_id, party)
);

-- ════════════════════════════════════════════════════════════════════════════
-- PARTY CHECK — SECURITY DEFINER so the policies below cannot recurse.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.is_city_trade_party(p_agreement uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.city_trade_agreements a
    where a.id = p_agreement
      and (a.proposer_id = p_user or a.partner_id = p_user)
  );
$$;
revoke all on function public.is_city_trade_party(uuid, uuid) from public;
grant execute on function public.is_city_trade_party(uuid, uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- RLS
-- ════════════════════════════════════════════════════════════════════════════
alter table public.city_trade_agreements       enable row level security;
alter table public.city_trade_shipments        enable row level security;
alter table public.city_trade_shipment_claims  enable row level security;

-- ── agreements ──────────────────────────────────────────────────────────────
-- Read: the two parties, and nobody else. A standing deal is commercially
-- private; the marketplace in 038 is the public surface.
drop policy if exists cta_sel on public.city_trade_agreements;
create policy cta_sel on public.city_trade_agreements for select to authenticated
  using (proposer_id = auth.uid() or partner_id = auth.uid());

-- Insert: you may only propose AS yourself, only as the proposer, and only
-- 'pending'. Pinning status here is what stops a client from posting an
-- already-'active' deal and skipping the partner's consent entirely.
drop policy if exists cta_ins on public.city_trade_agreements;
create policy cta_ins on public.city_trade_agreements for insert to authenticated
  with check (
    proposer_id = auth.uid()
    and partner_id <> auth.uid()
    and status = 'pending'
    and starts_at is null
    and accepted_at is null
  );

-- Update: both parties may move status, and NOTHING else. Postgres RLS cannot
-- express "only these columns", so the terms are frozen by a trigger below —
-- the policy alone would let a party rewrite gives_units mid-deal.
drop policy if exists cta_upd on public.city_trade_agreements;
create policy cta_upd on public.city_trade_agreements for update to authenticated
  using  (proposer_id = auth.uid() or partner_id = auth.uid())
  with check (proposer_id = auth.uid() or partner_id = auth.uid());

-- No delete. A cancelled deal stays as history; erasing it would erase the
-- shipments that reference it.
drop policy if exists cta_del on public.city_trade_agreements;

-- 🔒 FROZEN TERMS. The update policy above cannot restrict columns, so this
--    trigger does. Without it either party could accept a deal and then raise
--    what the other owes, which the UI would happily settle every 12 hours.
create or replace function public.city_trade_freeze_terms()
returns trigger
language plpgsql
as $$
begin
  if new.proposer_id   is distinct from old.proposer_id
  or new.partner_id    is distinct from old.partner_id
  or new.proposer_city is distinct from old.proposer_city
  or new.partner_city  is distinct from old.partner_city
  or new.gives_resource is distinct from old.gives_resource
  or new.gives_units    is distinct from old.gives_units
  or new.wants_resource is distinct from old.wants_resource
  or new.wants_units    is distinct from old.wants_units
  or new.cycle_hours    is distinct from old.cycle_hours
  or new.days           is distinct from old.days
  or new.created_at     is distinct from old.created_at then
    raise exception 'city_trade_agreements: terms are frozen; only status may change';
  end if;
  -- Only the PARTNER may accept or decline a pending proposal. The proposer
  -- accepting their own offer is the whole consent hole this closes.
  if old.status = 'pending' and new.status in ('active','declined')
     and auth.uid() is distinct from old.partner_id then
    raise exception 'city_trade_agreements: only the partner may accept or decline';
  end if;
  return new;
end;
$$;
drop trigger if exists city_trade_freeze on public.city_trade_agreements;
create trigger city_trade_freeze before update on public.city_trade_agreements
  for each row execute function public.city_trade_freeze_terms();

-- ── shipments ───────────────────────────────────────────────────────────────
-- Read: parties only.
drop policy if exists cts_sel on public.city_trade_shipments;
create policy cts_sel on public.city_trade_shipments for select to authenticated
  using (public.is_city_trade_party(agreement_id, auth.uid()));

-- Insert: either party may record a due cycle — that is the point of
-- client-driven settlement — but only on an agreement they are actually in,
-- and only while it is active.
drop policy if exists cts_ins on public.city_trade_shipments;
create policy cts_ins on public.city_trade_shipments for insert to authenticated
  with check (
    public.is_city_trade_party(agreement_id, auth.uid())
    and exists (select 1 from public.city_trade_agreements a
                where a.id = agreement_id and a.status = 'active')
  );

-- No update, no delete. Append-only means append-only.
drop policy if exists cts_upd on public.city_trade_shipments;
drop policy if exists cts_del on public.city_trade_shipments;

-- ── claims ──────────────────────────────────────────────────────────────────
drop policy if exists ctc_sel on public.city_trade_shipment_claims;
create policy ctc_sel on public.city_trade_shipment_claims for select to authenticated
  using (claimed_by = auth.uid()
         or exists (select 1 from public.city_trade_shipments s
                    where s.id = shipment_id
                      and public.is_city_trade_party(s.agreement_id, auth.uid())));

-- You may only claim YOUR OWN side, and only on a shipment you are a party to.
-- claimed_by is pinned to the caller so a claim can never be filed for someone
-- else — that would let one player mark the other's cargo as delivered.
drop policy if exists ctc_ins on public.city_trade_shipment_claims;
create policy ctc_ins on public.city_trade_shipment_claims for insert to authenticated
  with check (
    claimed_by = auth.uid()
    and exists (
      select 1
      from public.city_trade_shipments s
      join public.city_trade_agreements a on a.id = s.agreement_id
      where s.id = shipment_id
        and ((party = 'proposer' and a.proposer_id = auth.uid())
          or (party = 'partner'  and a.partner_id  = auth.uid()))
    )
  );

drop policy if exists ctc_upd on public.city_trade_shipment_claims;
drop policy if exists ctc_del on public.city_trade_shipment_claims;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFY — expect 3 tables, 1 function, 1 trigger, and 8 policies.
-- ════════════════════════════════════════════════════════════════════════════
select
  (select count(*) from information_schema.tables
     where table_schema = 'public'
       and table_name in ('city_trade_agreements','city_trade_shipments','city_trade_shipment_claims'))       as tables_expect_3,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'is_city_trade_party')                                        as party_fn_expect_1,
  (select count(*) from pg_trigger where tgname = 'city_trade_freeze' and not tgisinternal)                   as freeze_trigger_expect_1,
  (select count(*) from pg_policies where schemaname = 'public'
     and tablename in ('city_trade_agreements','city_trade_shipments','city_trade_shipment_claims'))          as policies_expect_8,
  (select count(*) from pg_tables where schemaname = 'public'
     and tablename in ('city_trade_agreements','city_trade_shipments','city_trade_shipment_claims')
     and rowsecurity)                                                                                        as rls_on_expect_3;
