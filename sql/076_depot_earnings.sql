-- ════════════════════════════════════════════════════════════════════════════
-- 076 · THE TRUCK DEPOT EARNS — and the index learns what a depot tile is called
--
-- ⚠ RUN sql/075 FIRST. This file amends city_depot_stat() and adds a second
--   trigger to transport_contracts; both are 075's.
--
-- ✅ APPLIED to ktsiasyjusesawtrwrjc on 2026-08-28, through the Supabase MCP as
--    four migrations — 076a_depot_config_and_index_fix, 076b_depot_earnings_book,
--    076c_depot_fee_on_delivery, 076d_depot_claim — split only because
--    apply_migration wraps its own transaction. THIS FILE IS THE AUTHORITY on
--    what those four contain; re-running it whole is idempotent.
--
--    THE INDEX FIX, MEASURED. Before: city_depot_stat on an `op_transport` tile
--    answered 0. After: 1. And the backfill immediately put a REAL node on the
--    freight map — `nodes that can receive freight` went 0 → 1 (N-28), a depot
--    that had been standing in a player's city the whole time and was invisible
--    to the gate. That is the proof the bug was real and not theoretical.
--
--    THE FEE, measured inside a transaction that was rolled back, against the
--    live tables and that real depot:
--      · 900 units, level 1, a 40,000 contract → 7,200 to the depot owner
--      · the carrier billed a matching −7,200 'toll' — the two sum to ZERO, so
--        no Cinder was created
--      · the row is held by the OWNER of the destination city, not the shipper
--      · a re-settle of the same contract paid nothing more (1 row, still 1)
--    Fee table from the verify block: 5,000 units @ lvl 3 → 50,000 (the cap
--    binds); 1,000 @ lvl 3 → 20,000; 1,000 @ lvl 1 → 8,000; 40 @ lvl 1 → 320;
--    and 5,000 @ lvl 3 into a 1,000-Cinder haul → 600, the share cap binding so
--    a carrier cannot be billed more than the haul earned.
--
-- ── 1. THE BUG THIS OPENS WITH, BECAUSE IT MADE 075 UNSATISFIABLE ─────────
--
--   sql/075's index matches a city tile with `type = 'transport'`. NO TILE IN
--   THE GAME HAS EVER HAD THAT TYPE. The city registers operations under an
--   `op_` prefix (node-city `opsKeyOf`), so the Transportation Company's
--   building is placed as `op_transport`, and the new licence-free Truck Depot
--   that ships with this round is `truckdepot`. Measured against the deployed
--   function before writing this:
--
--     city_depot_stat('{"tiles":{"1,1":{"type":"op_transport","lvl":1}}}')  → 0
--     city_depot_stat('{"tiles":{"1,1":{"type":"transport","lvl":1}}}')     → 1
--
--   So the destination gate was not merely refusing every haul because nobody
--   had built a depot — it would have gone on refusing them AFTER somebody did.
--   The two failures are indistinguishable from outside ("no nodes can receive
--   freight"), which is exactly why this one could have sat there for weeks.
--   §2 fixes it by matching all three spellings.
--
-- ── 2. WHY A DEPOT IS NOT A BUSINESS YOU MUST OWN ────────────────────────
--
--   The Transport Depot existed ONLY as `OP_BP.transport` — a building unlocked
--   by buying the Transportation Company at City Hall. That is backwards for
--   this particular building: a depot is not something you operate, it is the
--   apron OTHER PEOPLE'S trucks unload on. Every city on the network needs one,
--   including cities whose owner will never found a carrier. Gating it behind a
--   carrier's licence is why the live world had zero of them.
--   node-city now ships `truckdepot` as an ordinary Infrastructure building:
--   city currency, no licence, no ownership test. The op building still counts.
--
-- ── 3. THE FEE, AND WHY IT IS A TRANSFER AND NOT A FAUCET ────────────────
--
--   A delivered haul pays the destination depot's owner an unloading fee:
--
--       fee = units × depot_fee_per_unit × level_multiplier
--       …capped at depot_fee_cap                     (default 50,000)
--       …and never more than depot_fee_max_share of the contract's own price
--
--   🔴 THE MONEY COMES OUT OF THE CARRIER'S FREIGHT BILL, NOT OUT OF THIN AIR.
--      The shipper was already charged `price` by transport_dispatch through
--      wallet_charge. transport_settle credits the CARRIER a positive 'freight'
--      row for it. This file writes, in the same transaction:
--        · a `depot_earnings` row  (+fee, to the depot owner)
--        · a `toll` ledger row     (−fee, against the carrier)
--      so the claims arising from one contract still sum to what the shipper
--      actually paid. sql/073's ledger CHECK is what makes this expressible at
--      all: 'freight' must be positive and every other kind must be negative,
--      and `toll` is the kind it reserved for exactly this.
--      Without the negative leg this would be a mint, and sql/073's header is
--      explicit that a payout leg added carelessly is "the one thing most
--      likely to be fixed wrongly by the next person".
--
--   ⚠ THE SHARE CAP IS WHAT KEEPS A CARRIER SOLVENT. Uncapped, a big load into
--     a level-3 depot could bill more than the haul earned and drive a
--     carrier's ledger negative for doing their job correctly. 60% by default:
--     the carrier always keeps at least 40% of a haul they completed.
--
--   ⚠ AND THE CAP IS WHY THE HEADLINE NUMBER IS "UP TO". At the defaults a
--     5,000-unit load into a level-3 depot prices at 5,000 × 8 × 2.5 = 100,000
--     and is cut to 50,000 by depot_fee_cap; a 40-unit load into a level-1 pays
--     320. The number a player sees scales with what was actually delivered and
--     with the apron they paid to upgrade, which is the design that was asked
--     for.
--
-- ── 4. WHERE IT IS COMPUTED, AND WHY NOT INSIDE transport_settle ─────────
--
--   Same reasoning as 075's gate: transport_settle lives in sql/073, and
--   amending it from here would mean pasting the whole function into this file,
--   where a later re-run of 073 silently deletes the change. A trigger on the
--   contracts table survives that, and it fires INSIDE settle's own transaction,
--   so the fee and the settlement commit or roll back together.
--
--   Idempotency is the UNIQUE constraint on depot_earnings.contract_id: settle
--   is already idempotent ("a second settle returned it unchanged"), and a
--   second delivery transition can therefore never pay a depot twice.
--
-- ── 5. AND IT IS ACTUALLY PAID ───────────────────────────────────────────
--
--   sql/073 left the carrier's payout leg out on purpose, asking for "per-faucet
--   RPCs where the SERVER computes the amount from state it owns". depot_claim()
--   is one: the owner calls it, it sums THEIR OWN unclaimed rows, stamps them
--   claimed and credits the wallet through wallet_credit (sql/023b) in the same
--   transaction. The client sends no amount and cannot: there is no parameter.
--
-- Idempotent. Safe to re-run. RLS ships in this file. Ends with a verify block.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. THE CONFIG — three tunable numbers, in the one place prices may live
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  if to_regclass('public.transport_config') is not null then
    alter table public.transport_config
      add column if not exists depot_fee_per_unit  numeric not null default 8,
      add column if not exists depot_fee_cap       numeric not null default 50000,
      -- A share of the contract price, 0..1. The carrier keeps the rest.
      add column if not exists depot_fee_max_share numeric not null default 0.60;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. THE INDEX LEARNS WHAT A DEPOT TILE IS ACTUALLY CALLED
-- ════════════════════════════════════════════════════════════════════════════
-- Replaces sql/075 §1. Identical in every other respect — same b.k rule, same
-- coalesce (the three-valued-logic trap is documented there and still applies),
-- same tolerance of a non-numeric `lvl`.
create or replace function public.city_depot_stat(p_state jsonb)
returns table (depots integer, top_lvl integer)
language sql immutable as $fn$
  with arr as (
    select case
             when jsonb_typeof(p_state -> 'tiles') = 'object'
               then coalesce((select jsonb_agg(e.value) from jsonb_each(p_state -> 'tiles') e), '[]'::jsonb)
             when jsonb_typeof(p_state -> 'tiles') = 'array'
               then p_state -> 'tiles'
             else '[]'::jsonb
           end as tiles
  ), d as (
    select t.value as tile
      from arr, lateral jsonb_array_elements(arr.tiles) t
     where jsonb_typeof(t.value) = 'object'
       /* 🔴 ALL THREE SPELLINGS, and each one is a real tile that exists:
            'truckdepot'   — the licence-free Infrastructure building (this round)
            'op_transport' — the Transportation Company's own yard, which is what
                             the city has always written for a placed operation
            'transport'    — what sql/075 matched, and what nothing writes. Kept
                             ONLY so that re-running 075 after this file cannot
                             quietly narrow the rule back to a type no tile has.
          A player with either real building can receive freight. There is no
          reason a carrier's yard should unload other people's loads less well
          than a plain apron does. */
       and t.value ->> 'type' in ('truckdepot', 'op_transport', 'transport')
       -- b.k = 0 is a first build still under way: a construction site, not a
       -- depot. The coalesce is load-bearing — see sql/075 §1.
       and not coalesce(t.value -> 'b' ->> 'k' = '0', false)
  )
  select coalesce(count(*), 0)::int,
         coalesce(max(case when jsonb_typeof(tile -> 'lvl') = 'number'
                           then greatest(1, (tile ->> 'lvl')::int)
                           else 1 end), 0)::int
    from d;
$fn$;

-- Re-run the backfill, because the fix above can find depots the old one could
-- not. Same two statements as sql/075, and re-runnable for the same reason.
insert into public.node_depots (user_id, node_id, depots, top_lvl, updated_at)
select cs.user_id, cs.node_id, s.depots, s.top_lvl, now()
  from public.city_state cs, lateral public.city_depot_stat(cs.state) s
 where s.depots > 0
   and cs.node_id is not null and cs.node_id <> ''
   and cs.node_id <> '00000000-0000-0000-0000-000000000000'
on conflict (user_id, node_id) do update
  set depots = excluded.depots, top_lvl = excluded.top_lvl, updated_at = now();

delete from public.node_depots nd
 where not exists (
   select 1 from public.city_state cs, lateral public.city_depot_stat(cs.state) s
    where cs.user_id = nd.user_id and cs.node_id = nd.node_id and s.depots > 0);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. THE EARNINGS BOOK
-- ════════════════════════════════════════════════════════════════════════════
-- Append-only, like every ledger in this project: balance = sum of unclaimed
-- rows. `claimed_at` is the only column that is ever UPDATEd, and only by
-- depot_claim() under a lock.
create table if not exists public.depot_earnings (
  id          bigserial primary key,
  -- The depot owner: whoever owns the city_state row that put this node on the
  -- freight map. Resolved at delivery time and STORED, never re-derived — the
  -- city could be sold or demolished later, and the person who unloaded the
  -- truck is the person who earned the fee.
  owner_id    uuid not null references auth.users(id) on delete cascade,
  node_id     text not null,
  -- 🔴 THE IDEMPOTENCY KEY. transport_settle is idempotent; this makes the fee
  --    idempotent with it. A second delivery transition on the same contract
  --    hits this constraint and pays nothing.
  contract_id uuid not null unique references public.transport_contracts(id) on delete cascade,
  carrier_id  uuid references public.transport_companies(id) on delete set null,
  units       numeric not null default 0,
  depot_lvl   int     not null default 1,
  amount      numeric not null check (amount > 0),
  claimed_at  timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists depot_earnings_owner
  on public.depot_earnings (owner_id, claimed_at, created_at desc);

alter table public.depot_earnings enable row level security;

-- Your own earnings, and nobody else's. No insert/update/delete policy at all:
-- rows are written by the trigger below and stamped by depot_claim(), both
-- SECURITY DEFINER. A player who could write this table could pay themselves.
drop policy if exists depot_earn_sel_own on public.depot_earnings;
create policy depot_earn_sel_own on public.depot_earnings
  for select to authenticated using (owner_id = auth.uid());

revoke all on public.depot_earnings from public, anon;
grant select on public.depot_earnings to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. THE FEE — computed at delivery, inside settle's own transaction
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.depot_fee_for(p_units numeric, p_lvl int, p_price numeric)
returns numeric language sql stable security definer set search_path = public as $fn$
  /* level multiplier: 1 → ×1.0, 2 → ×1.6, 3 → ×2.5. Written as a CASE and not
     as an exponent so the ladder is readable and tunable by eye; three is the
     city's MAX_LVL and a level outside 1..3 is clamped rather than trusted,
     because `lvl` reaches here from a client save blob. */
  select floor(least(
           greatest(0, coalesce(p_units, 0))
             * coalesce((select f.depot_fee_per_unit from public.transport_config f where f.id = 1), 8)
             * case least(3, greatest(1, coalesce(p_lvl, 1)))
                 when 1 then 1.0 when 2 then 1.6 else 2.5 end,
           coalesce((select f.depot_fee_cap from public.transport_config f where f.id = 1), 50000),
           greatest(0, coalesce(p_price, 0))
             * coalesce((select f.depot_fee_max_share from public.transport_config f where f.id = 1), 0.60)
         ));
$fn$;

create or replace function public.depot_pay_on_delivery()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_owner uuid; v_lvl int; v_fee numeric;
begin
  /* Only the transition INTO 'delivered', and only once. `OLD.status = NEW.status`
     is the guard that makes a re-settle free: settle sets the row to delivered
     and any later UPDATE that leaves it delivered must not pay again. The unique
     constraint on contract_id is the second, harder guarantee. */
  if NEW.status <> 'delivered' or coalesce(OLD.status, '') = 'delivered' then
    return NEW;
  end if;

  begin
    -- Who owns the apron? The best depot at the destination node. `order by`
    -- rather than `limit 1` on an arbitrary row: if two players both hold a
    -- city there, the better-built depot took the load.
    select nd.user_id, nd.top_lvl into v_owner, v_lvl
      from public.node_depots nd
     where nd.node_id = NEW.to_node and nd.depots > 0
     order by nd.top_lvl desc, nd.updated_at asc
     limit 1;

    -- No depot at the destination is not an error here. sql/075's gate refuses
    -- such a contract at INSERT, so this can only be reached by a haul that was
    -- booked while the rule was switched off — which is a legal haul that
    -- simply has nobody to pay.
    if v_owner is null then return NEW; end if;

    -- A shipper delivering to their own city pays themselves nothing. The fee
    -- is a charge for someone else's apron; self-dealing here would be a loop
    -- (dispatch to yourself, collect the fee, repeat) and the money would come
    -- out of a carrier they may also own.
    if v_owner = NEW.shipper_id then return NEW; end if;

    v_fee := public.depot_fee_for(NEW.units, v_lvl, NEW.price);
    if coalesce(v_fee, 0) <= 0 then return NEW; end if;

    insert into public.depot_earnings
      (owner_id, node_id, contract_id, carrier_id, units, depot_lvl, amount)
    values (v_owner, NEW.to_node, NEW.id, NEW.carrier_id, NEW.units, coalesce(v_lvl, 1), v_fee);

    /* 🔴 THE OTHER LEG. Without it this is a mint. `toll` is negative by the
       ledger's own CHECK, and only a player carrier has a ledger — a Meridian
       haul has no company row, so the NPC simply absorbs the fee. That is the
       right answer for an NPC price ceiling and it is not an oversight. */
    if NEW.carrier_id is not null then
      insert into public.transport_ledger (company_id, contract_id, amount, kind, memo)
      values (NEW.carrier_id, NEW.id, -v_fee, 'toll',
              'Unloading fee at ' || left(coalesce(NEW.to_node, '?'), 24));
    end if;
  exception
    when unique_violation then
      -- Already paid for this contract. Idempotent by design; not an error.
      null;
    when others then
      /* A failure to pay a fee must never unwind a delivery that happened.
         Same stance as sql/075's index trigger: the haul is the player's, the
         bookkeeping is ours. */
      begin raise warning 'depot_pay_on_delivery skipped for %: %', NEW.id, SQLERRM;
      exception when others then null; end;
  end;
  return NEW;
end $fn$;

do $$
begin
  if to_regclass('public.transport_contracts') is not null then
    drop trigger if exists transport_contracts_depot_fee on public.transport_contracts;
    create trigger transport_contracts_depot_fee
      after update on public.transport_contracts
      for each row execute function public.depot_pay_on_delivery();
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. CLAIMING IT
-- ════════════════════════════════════════════════════════════════════════════
-- What a depot owner is holding, for the panel. Own rows only, by construction:
-- there is no parameter to point it at anybody else.
create or replace function public.depot_earnings_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid(); r jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'why', 'not_signed_in'); end if;
  select jsonb_build_object(
           'ok', true,
           'unclaimed', coalesce(sum(amount) filter (where claimed_at is null), 0),
           'lifetime',  coalesce(sum(amount), 0),
           'loads',     count(*) filter (where claimed_at is null),
           'recent', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'node', e.node_id, 'amount', e.amount, 'units', e.units,
                      'lvl', e.depot_lvl, 'at', e.created_at,
                      'claimed', e.claimed_at is not null) order by e.created_at desc)
               from (select * from public.depot_earnings
                      where owner_id = v_uid order by created_at desc limit 10) e), '[]'::jsonb))
    into r
    from public.depot_earnings where owner_id = v_uid;
  return coalesce(r, jsonb_build_object('ok', true, 'unclaimed', 0, 'lifetime', 0, 'loads', 0, 'recent', '[]'::jsonb));
end $fn$;

/* 🔴 A PER-FAUCET RPC, WHICH IS WHAT sql/073 ASKED FOR. It takes NO AMOUNT —
   there is no parameter a client could inflate. The server sums the caller's
   own unclaimed rows, stamps them, and credits the wallet in the same
   transaction, so a crash between the two cannot pay twice or lose the money.
   `for update` on the selected rows is the concurrency guard: two clicks in the
   same second serialise, and the second one finds nothing unclaimed. */
create or replace function public.depot_claim()
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_uid uuid := auth.uid(); v_sum numeric; v_ids bigint[]; v_bal bigint;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'why', 'not_signed_in'); end if;

  select coalesce(sum(amount), 0), array_agg(id)
    into v_sum, v_ids
    from (select id, amount from public.depot_earnings
           where owner_id = v_uid and claimed_at is null
           order by id
           for update) q;

  if coalesce(v_sum, 0) <= 0 then
    return jsonb_build_object('ok', false, 'why', 'nothing_to_claim', 'amount', 0);
  end if;

  update public.depot_earnings set claimed_at = now() where id = any(v_ids);

  -- The one sanctioned credit path (sql/023b). It credits auth.uid() and
  -- nobody else, which is precisely why the claim has to be made by the owner.
  v_bal := public.wallet_credit(floor(v_sum)::bigint, 'Truck Depot unloading fees');

  return jsonb_build_object('ok', true, 'amount', floor(v_sum), 'loads', array_length(v_ids, 1), 'balance', v_bal);
end $fn$;

revoke all on function public.depot_fee_for(numeric, int, numeric) from public, anon;
revoke all on function public.depot_earnings_summary()            from public, anon;
revoke all on function public.depot_claim()                       from public, anon;
grant execute on function public.depot_earnings_summary()         to authenticated;
grant execute on function public.depot_claim()                    to authenticated;
-- depot_fee_for stays server-only: it reads config, and a client that could ask
-- it for a number would be reading the ceiling table one probe at a time.

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ════════════════════════════════════════════════════════════════════════════
select 'depot_earnings table'          as check,
       (to_regclass('public.depot_earnings') is not null)::text as pass
union all
select 'RLS on', coalesce((select relrowsecurity::text from pg_class where relname='depot_earnings'), '(no table)')
union all
select 'no write policy (definer only)',
       ((select count(*) from pg_policy p join pg_class c on c.oid=p.polrelid
          where c.relname='depot_earnings' and p.polcmd in ('a','w','d')) = 0)::text
union all
select 'fee trigger on transport_contracts',
       (exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
                 where t.tgname='transport_contracts_depot_fee' and c.relname='transport_contracts'))::text
union all
select 'claim + summary + fee fns',
       ((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname in ('depot_claim','depot_earnings_summary','depot_fee_for')) = 3)::text
union all
-- 🔴 THE ONE THAT PROVES 075 IS NOW SATISFIABLE. Before this file the first of
--    these answered 0, which meant no real depot could ever register.
select 'index sees an op_transport tile',
       (select depots::text from public.city_depot_stat('{"tiles":{"1,1":{"type":"op_transport","lvl":2}}}'))
union all
select 'index sees a truckdepot tile',
       (select depots::text from public.city_depot_stat('{"tiles":{"1,1":{"type":"truckdepot","lvl":3}}}'))
union all
select 'index ignores one still being built',
       (select depots::text from public.city_depot_stat('{"tiles":{"1,1":{"type":"truckdepot","lvl":1,"b":{"k":0,"l":1,"s":1,"d":9}}}}'))
union all
select 'fee · 5000 units, lvl 3, rich contract (cap binds)',
       public.depot_fee_for(5000, 3, 999999)::text
union all
select 'fee · 40 units, lvl 1',
       public.depot_fee_for(40, 1, 999999)::text
union all
select 'fee · share cap binds on a cheap haul',
       public.depot_fee_for(5000, 3, 1000)::text
union all
select 'nodes that can receive freight now',
       (select count(*)::text from public.node_depot_map());
