-- ═══════════════════════════════════════════════════════════════════════════
-- 038 · TRANSPORTATION COMPANIES — carriers, fleets, contracts, freight ledger
--
-- The server half of docs/transport-company-design.md and of the (parallel)
-- /src/transport module. One player pays another player real Cinder here, so
-- this file is not "the schema for a feature" — it is the entire security
-- boundary for a player-to-player payment, and it is written that way.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 STATUS: THIS FILE HAS NEVER BEEN RUN AGAINST THE LIVE PROJECT.
--    There is no CLI login in this repo and the Supabase MCP is not reliably
--    authenticated, so migrations here are pasted BY HAND into the SQL editor
--    for project ktsiasyjusesawtrwrjc. Nothing below has touched
--    ktsiasyjusesawtrwrjc. Do not read a green checker, a passing grep, or this
--    header as evidence that it has.
--
-- 📋 WHAT WAS ACTUALLY MEASURED, and on what, 2026-08-28. Recorded because
--    "idempotent and re-runnable" and "policies 7" are the two claims migration
--    headers in this repo have been wrong about before (sql/015's verify note),
--    and because the round before this one was wrong about a third thing: it
--    named two caps as enforced that a single INSERT walked straight through.
--    Applied THREE TIMES in a row with ON_ERROR_STOP to a throwaway PostgreSQL
--    16.13 cluster, on stubs for the three things this file does not own —
--    auth.users, auth.uid() and wallet_charge — plus Supabase's documented
--    default privileges on schema public, so the revokes below had something to
--    revoke. Clean on all three runs; §5's row came back exactly as the
--    `-- Expect:` line predicts.
--
--    THE BOUNDARY, as the `authenticated` role:
--      · UPDATE on charters, UPDATE on rigs, UPDATE on contracts, INSERT into
--        the ledger, DELETE from the ledger and SELECT on config each returned
--        "permission denied for table …"
--      · another player's ledger rows visible: 0. Their rigs: 0. Their
--        charters: all of them — the rate board is deliberately public (§3)
--      · an INSERT of a negative 'freight' row was rejected by
--        transport_ledger_sign_ck EVEN AS SUPERUSER
--      · set_sheet clamped a posted base of 9,999,999 to 500 and an escort_pct
--        of 500 to 100, dropped an unknown key, and refused a non-owner with
--        'not_your_company'
--
--    THE MONEY PATH:
--      · dispatch charged 1,800 once; the same client_ref returned the SAME
--        contract id with retried:true and the balance did not move again
--      · settle wrote one ledger row, a second settle returned it unchanged,
--        reliability recomputed to 100.0 and the rig went back to 'idle'
--      · with 5 Cinder in the wallet, dispatch refused with
--        'insufficient_cinder' and the rig's runs_used went back from 2 to 1 in
--        the same call, with no contract row — the unwind in §4.2 works
--      · a blacklisted shipper was refused by the player carrier, served by
--        Meridian at 4,500, and NO 'refused' contract row was written
--
--    CONCURRENCY, as parallel client processes:
--      · 8 dispatches at one rig with runs_cap 1 → exactly 1 contract, charged
--        exactly once, 7 clean 'rig_out_of_runs'
--      · 11 dispatches at a 6-bay charter already holding one haul → exactly 6
--        in flight, the rest 'no_free_bay'
--      · 8 settles of one delivered contract → exactly 1 ledger row, paid once
--
--    🔴 THE HOLE THIS ROUND CLOSED, measured before and after. It is the same
--       mistake as the two the round before it closed — a limit that was
--       written down but not reachable from the path that needed it — except
--       that this time the limit LOOKED reachable, which is worse.
--
--       BOTH COUNTING CAPS WERE IN A `WITH CHECK`, AND A `WITH CHECK` CANNOT
--       COUNT. The definer helpers it called are `stable`: they answer from the
--       snapshot the statement started with, which does not contain the rows
--       that statement is inserting. So the check passed once per row, every
--       row, and one statement was unbounded. As `authenticated`, against the
--       previous draft:
--         · insert … select from generate_series(1,9)  → 9 charters against
--           max_charters_per_owner = 3
--         · insert … select from generate_series(1,60) → 60 rigs into a
--           depot-level-1 charter whose fleet_cap is 4
--       AFTER, with the BEFORE INSERT guards in §2b:
--         · the 9-row statement raises 'charter_cap' at row 4 and rolls the
--           whole statement back — 0 charters, not 3, because a multi-row
--           INSERT is all or nothing. One at a time: 3 accepted, the 4th
--           refused with cap 3 / used 3.
--         · the 60-row statement raises 'fleet_cap' at row 5 — 0 rigs. One at
--           a time: 4 accepted, the 5th refused with cap 4 / used 4.
--
--       AND THE OVERSHOOT UNDER CONCURRENCY IS GONE TOO, which the previous
--       draft published as a permanent limit of the design ("a policy cannot
--       take a lock"). True of a policy; not true of the guard, which takes an
--       advisory transaction lock before it counts. Measured deterministically
--       rather than by burst — one session inserts and holds its transaction
--       open for 3s, a second goes for the same last slot:
--         · WITH CHECK, trigger disabled → 4 charters against a cap of 3, and
--           5 rigs against a cap of 4. Both sessions committed.
--         · guard enabled → 3 and 4. The second session blocked on the
--           advisory lock until the first committed, then refused.
--       A burst is the weaker test and it passed too: 12 simultaneous
--       foundings, repeated for six independent owners, landed on exactly 3
--       every time.
--
--       AND §5's over_fleet_cap COLUMN IS NOT DECORATIVE. It is the only
--       evidence anyone has that that column can move: it read 1 for exactly
--       as long as the over-capped charter from the trigger-disabled run was
--       on the table, and 0 on every database where the guard has been in
--       force from the start.
--
--    THE MERIDIAN CEILING, re-measured against the enforced caps. The previous
--    draft's attack (nine sock charters at base 1 dragging the quote for a
--    3-hop / 10-unit haul from 4,500 down to 75) now costs more and achieves
--    nothing:
--      · founding above the tariff ceiling is refused outright — base 100000
--        returns "new row violates row-level security policy" from tco_ins
--      · three socks is the most one account can own, and a sock is only
--        sampled once it has DELIVERED something, which costs a real dispatch.
--        Three socks at base 1, each made to deliver, drag the median to 1 —
--        and Meridian still quotes 3,000, because meridian_base_floor is the
--        answer whenever the median falls below it
--      · pushed the other way, with every sampled sheet at the tariff ceiling
--        of 500, the largest legal haul (6 hops x 5000 units) quotes
--        37,500,000 and is REFUSED with 'over_price_cap' against a cap of
--        5,000,000 — the NPC branch does not get an exemption
--
--    ⚠ WHAT THIS DOES NOT PROVE.
--      · The stub wallet_charge is a reduction of the real one (no tax leg, no
--        wallet_ledger, no profile mirror) and the stub auth.uid() reads a GUC
--        PostgREST sets differently. The grant set is Supabase's default as
--        documented, not a copy of the live project's.
--      · Nothing was measured against real data, because there is none: no
--        player has ever founded a carrier.
--      · The guards depend on a Postgres implementation detail — that a
--        VOLATILE plpgsql function advances the command counter before each of
--        its queries, so a BEFORE ROW trigger can see the rows its own
--        statement has already inserted. That is stable behaviour and it is
--        also the single load-bearing assumption in §2b, which is why §5 has a
--        `guards_not_volatile` column: one keyword turns both caps back off
--        without changing anything else a reader would look at.
--
--    WHAT APPLYING IT ACHIEVES: the tables exist, RLS and the revoked grants
--    deny every client write path that is not one of the five RPCs in §4, the
--    two counting caps are allocated rather than announced, and a shipper who
--    calls transport_dispatch is charged a SERVER-computed price and gets a
--    contract row with a server-computed arrival time.
--    WHAT IT DOES NOT ACHIEVE: it does not pay a carrier one Cinder. Delivery
--    writes an append-only CLAIM into transport_ledger; converting that claim
--    into spendable Cinder is a cash-out RPC that is deliberately NOT in this
--    file — see "THE PAYOUT LEG IS MISSING ON PURPOSE" below. Nothing in the
--    client calls any of this yet either; this is build-order step 1 of
--    docs/transport-company-design.md §10, the step whose own note reads
--    "Nothing visible yet."
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔒 SECURITY REVIEW — per bullet, the attack it closes. Not what it does.
--
--   · `security definer` + `set search_path = public` on all eleven functions
--     — five RPCs, four helpers and the two §2b guards.
--     Closes: a caller creating public.transport_config in a schema earlier on
--     their own search_path and having the function read THEIR ceilings as the
--     function owner. RUN_016 states the general form of this; it is worse here
--     because the shadowed table is the one holding every price cap.
--
--   · `revoke all on function … from public, anon` + grant to `authenticated`
--     only, with the full argument type list spelled out.
--     Closes: an unauthenticated PostgREST call to a money function. The type
--     list matters because a partial signature revokes nothing — it names a
--     function that does not exist and succeeds silently.
--
--   · No RPC takes a price, an amount, a user id, a reliability or a runs_used.
--     Closes the sql/015 r9 bug directly. r9's settle inserted the client's
--     payload verbatim — unbounded, unsigned amount, arbitrary to_id — and two
--     HTTP calls minted a billion Cinder into an append-only ledger. Every
--     number that decides money here is re-read from a row or computed from
--     transport_config. transport_dispatch takes ids and a cargo manifest;
--     transport_settle takes a contract id and nothing else.
--
--   · transport_dispatch calls transport_quote for the price instead of
--     computing one. Closes: the quote the player was shown and the price they
--     are charged disagreeing. There is one pricing function, not two.
--
--   · transport_quote has ONE exit, and both the player and the Meridian branch
--     fall through it. Closes: a price leaving the function without passing the
--     max_price_per_contract guard. This is not hypothetical — the Meridian
--     branch used to return above that guard, and the measurement above is the
--     nine-figure quote it let through. A refusal a code path can step over is
--     not a refusal.
--
--   · The Meridian median is clamped per row, restricted to carriers that have
--     actually delivered something, and then floored and ceilinged against
--     transport_config. Closes: the ceiling being set by an attacker. Every row
--     in that median is a row some player INSERTed for free, and the numbers
--     above are what nine of them did to it in both directions. The floor is
--     the part that matters: it makes the OUTCOME of a successful poisoning
--     harmless, rather than only making the attack expensive.
--
--   · tco_ins checks the sheet against the ceiling on the way IN. Closes: a
--     limit that exists only in a setter. UPDATE is revoked on both tables, so
--     before this clause the FIRST write was unbounded by anything but a
--     structural CHECK two hundred times looser than the real ceiling — and a
--     row written once could never be corrected, only re-clamped on read.
--
--   · The BEFORE INSERT guards in §2b hold the charter cap and the fleet cap,
--     and they are triggers rather than policy clauses for a measured reason.
--     Closes: a cap that a single multi-row INSERT walks through. A `WITH
--     CHECK` calls `stable` helpers that cannot see the rows the statement is
--     inserting, so it approves every row of a 60-row burst; a volatile
--     BEFORE ROW trigger can see them, and takes a lock besides. Both of those
--     caps were announced as enforced by a previous draft of this header while
--     one `select from generate_series` walked past them.
--
--   · No UPDATE policy on transport_companies or transport_rigs, and UPDATE is
--     revoked from both. Closes: a carrier who "may only retune their tariff"
--     also rewriting reliability, runs_used, day_key, condition and status.
--     POSTGRES RLS HAS NO COLUMN GRANULARITY — sql/015 deleted its own sev_upd
--     policy over exactly this, and the comment on that policy had promised
--     column-level intent the mechanism could not express.
--
--   · No write policy of any kind on transport_ledger, plus revoked
--     insert/update/delete AND a revoked sequence. Closes: a carrier inserting
--     their own earnings, and a rival inserting a NEGATIVE row against someone
--     else's company to poison a sum() that has no UPDATE path to correct it.
--
--   · Ownership is answered by one SECURITY DEFINER helper that takes a company
--     id and asks about auth.uid() only. Closes: RLS recursion (a policy on a
--     table that queries that table), and the sql/015 r9 helper mistake of
--     taking an arbitrary uuid and answering a question wider than the caller's.
--
--   · transport_contracts.carrier_id and transport_ledger.company_id are
--     `on delete restrict`. Closes: reputation laundering — deleting the
--     company to cascade away the lost/refused contracts that reliability is
--     derived from, then re-founding under the same name.
--
--   · A blocked dispatch does NOT write a 'refused' contract row. Closes: a
--     rival looping transport_dispatch against a carrier to manufacture public
--     refusals and destroy their reliability. See §4.2.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚖ THE LIMIT OF THE GUARANTEE, stated plainly rather than implied.
--
--   Almost everything this feature moves lives in a CLIENT BLOB. There is no
--   server-side inventory, no server-side city and no server-side map graph:
--     · cargo          — Profile.salvage, an opaque save blob
--     · the fleet      — Profile.princePortfolios.lot (index.html:195441), the
--                        same array playerOwnsVehicle() walks
--     · the depot      — city_state, saved as a blob per node
--     · route distance — there is no adjacency table. index.html:206493 records
--                        the discovery that App._cityNodeId is a TERRITORY-WAR
--                        node id ('N-25') while economy_nodes.id is a uuid, and
--                        that "economy_nodes carries no column referencing a TW
--                        node, so the lookup cannot match, ever."
--
--   So the server CANNOT recompute a haul from first principles. It can only
--   BOUND one, and that is all it claims. What it bounds, from rows it owns and
--   from transport_config:
--     · price      — computed here from the carrier's stored tariff, never
--                    accepted; clamped to the Meridian ceiling; refused above
--                    max_price_per_contract
--     · address    — the shipper is auth.uid(); the carrier is a company row;
--                    neither is a parameter
--     · rate       — runs per rig per day, and free bays, both server-counted
--     · time       — depart_at and arrive_at come from now(), so a contract
--                    cannot arrive before the clock says it did
--     · outcome    — delivered vs lost is rolled server-side against a
--                    server-computed risk_pct
--
--   What a determined client can still do INSIDE those bounds: claim a rig it
--   does not own, claim a better condition than the rig has, claim a depot
--   level it has not built, claim hops it did not travel, and ship cargo it
--   does not hold. Each of those is bounded by something the server does own —
--   fleet size by the §2b guard against the depot's cap, runs by the counter in
--   §4.2,
--   hops and units and price by transport_config — so the blast radius is
--   bounded. BUT A BOUND IS NOT A RECOMPUTATION. A player who claims depot
--   level 3 they never built gets 6 bays and 12 fleet slots, and this file
--   cannot tell. Closing that needs a server-side inventory and a server-side
--   node graph, which is a different project.
--   The fleet cap and the charter cap ARE exact — they allocate under a lock
--   (§2b), and the block above has the race that proves it. What they bound is
--   still only the number of rows, not the truth of any of them: four rigs is
--   four rigs whether or not the player owns four vehicles.
--   Do not read this file as claiming otherwise.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 💰 THE PAYOUT LEG IS MISSING ON PURPOSE, and this is the one thing most
--    likely to be "fixed" wrongly by the next person.
--    transport_settle writes a positive transport_ledger row. It does not
--    credit the carrier's wallet, and it must not be made to: the only function
--    that can mint Cinder credits auth.uid() — the SHIPPER, mid-dispatch — and
--    sql/034's own header says of it "THIS IS NOT THE REAL FIX… The real fix is
--    per-faucet RPCs where the SERVER computes the amount from state it owns."
--    A carrier cash-out is exactly such a per-faucet RPC: the carrier calls it
--    themselves, it reads coalesce(sum(amount),0) over their own ledger, and it
--    writes its own negative 'payout' row in the same transaction. It is not
--    here because it is the one function in this feature that pays a player,
--    and it should land in its own numbered file with its own daily bound and
--    its own verify. Until it does, dispatch is a SINK: the shipper's Cinder is
--    charged and burned, and the carrier holds an audited claim, not cash.
--
-- 🔑 `service_role` is not revoked below and carries BYPASSRLS in Supabase, so
--    every "WRITE: nobody" claim here is about anon/authenticated — about every
--    client. A leaked service key writes anything; that is true of every table
--    in this project and is a key-handling problem, not an RLS one.
--
-- Idempotent and re-runnable: paste it twice, nothing errors. No dependency on
-- 001-037 beyond public.wallet_charge (sql/023) and auth.users.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── 1. TABLES ─────────────────────────────────────────────────────────────

-- THE CHARTER. One row per player-run carrier. Public — the rate board in
-- design §5 is the whole game here, and a price nobody can see cannot be
-- undercut.
--
-- ⚠ home_node_id IS text, NOT uuid, and NOT a foreign key. Two different id
--   spaces are called "node" in this codebase and index.html:206493 is the
--   postmortem of confusing them: App._cityNodeId is a Territory-Wars node
--   ('N-25', tw_node_owners.node_id) and economy_nodes.id is a uuid. Freight
--   runs between the places players actually stand, so this holds the TW id.
--   No FK, because tw_node_owners is created by the legacy api.sql which is not
--   in /sql — an FK would make this migration fail outright on any database
--   where api.sql was never applied.
create table if not exists public.transport_companies (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  home_node_id  text,
  -- Claimed from the Freight Depot the owner built in their city. 1-3 is the
  -- building's own maxLevel (design §2b). It is a CLAIM: city_state is a blob.
  depot_level   int  not null default 1 check (depot_level between 1 and 3),
  -- { base, escort_pct, illicit_pct }. jsonb rather than three columns for the
  -- same reason sql/015 stores its ticket tiers this way: adding a fourth rate
  -- class must not be a migration.
  tariff        jsonb not null default '{}'::jsonb,
  -- 🔴 A CACHE, AND THE CONTRACT ROWS ARE THE AUTHORITY. Recomputed inside
  --    transport_settle from transport_contracts and written by nothing else;
  --    UPDATE is revoked below so no client can write it at all. null means
  --    "no completed contract yet", which is NOT the same as 0% and must not be
  --    rendered as one.
  reliability   numeric,
  -- Shippers this carrier refuses. Politics is supposed to live here (design
  -- §5.3) — a refusal is legal, and Meridian Haulage is why it is not fatal.
  blacklist     uuid[] not null default '{}'::uuid[],
  status        text not null default 'open' check (status in ('open','paused','closed')),
  created_at    timestamptz not null default now()
);
alter table public.transport_companies add column if not exists home_node_id text;
alter table public.transport_companies add column if not exists depot_level  int     not null default 1;
alter table public.transport_companies add column if not exists tariff       jsonb   not null default '{}'::jsonb;
alter table public.transport_companies add column if not exists reliability  numeric;
alter table public.transport_companies add column if not exists blacklist    uuid[]  not null default '{}'::uuid[];

-- 🔒 THE TARIFF HAS A SHAPE, and this is the belt to transport_set_sheet's
--    braces. sql/015 shipped a clamp inside a setter while a row-level UPDATE
--    policy still existed, which made the clamp decorative — a plain PostgREST
--    .update() walked straight past it. UPDATE is revoked here (§3), so that
--    exact hole is shut; this constraint is what survives if a future migration
--    ever grants it back. Bounds are STRUCTURAL and deliberately loose. The
--    tight, tunable ceiling is transport_config.max_tariff_per_unit_hop, and
--    when the two disagree the config wins, because it is read at quote time.
alter table public.transport_companies drop constraint if exists transport_companies_tariff_ck;
alter table public.transport_companies add constraint transport_companies_tariff_ck check (
  jsonb_typeof(tariff) = 'object'
  and coalesce((tariff->>'base')::numeric, 0)        between 0 and 100000
  and coalesce((tariff->>'escort_pct')::numeric, 0)  between 0 and 100
  and coalesce((tariff->>'illicit_pct')::numeric, 0) between 0 and 200
);
create index if not exists transport_companies_board on public.transport_companies (status, home_node_id);
create index if not exists transport_companies_owner on public.transport_companies (owner_id);


-- THE FLEET. Rigs are ordinary Prince Portfolios vehicles with a haul class, so
-- vehicle_id points into Profile.princePortfolios.lot — a client blob. The
-- server cannot verify the rig exists; it bounds what one can do.
--
-- ⚠ A RIG IS NEVER REMOVED FROM THE PLAYER'S PP LOT. Registering one here adds
--   a row; it does not move the vehicle. playerOwnsVehicle() (index.html:195441)
--   gates battle-loot extraction on `p.lot.length > 0`, so taking a rig out of
--   the lot to put it "in the fleet" would silently revoke a player's ability to
--   extract loot from a raid — a feature they would never connect to the truck
--   they just registered.
create table if not exists public.transport_rigs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.transport_companies(id) on delete cascade,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  vehicle_id  text,
  -- The game's existing ladder (RARITIES, index.html:39231). Do not invent a
  -- parallel one — index.html:206493 is what happens when two id spaces for the
  -- same idea drift apart.
  rarity      text not null default 'common'
                check (rarity in ('common','uncommon','rare','epic','legendary','mythic')),
  -- PP_COND_MULT's exact keys and exact casing (index.html:195340), so no
  -- translation layer exists between the auction floor and this table.
  condition   text not null default 'Clean'
                check (condition in ('Pristine','Clean','Worn','Battered','Wrecked','Salvage')),
  -- 🔴 DECLARED AUTHORITY. The ladder — 3/4/5/6/8/10 by rarity, times
  --    PP_COND_MULT, floor, minimum 1 (design §3) — lives in rigs.data.js and
  --    that is the authority for what a rig SHOULD do. This column is what the
  --    client claims that ladder produced. The server honours
  --    least(runs_cap, transport_config.max_runs_per_rig), so if the two ever
  --    disagree the carrier gets FEWER runs than the UI promised. That is the
  --    correct direction for this disagreement to fail in: the alternative
  --    pays a carrier for runs the server never counted.
  --    The 10 below is the design's Mythic maximum and is a structural bound,
  --    not the ladder.
  runs_cap    int  not null default 3 check (runs_cap between 1 and 10),
  runs_used   int  not null default 0 check (runs_used >= 0),
  -- 'YYYY-MM-DD' in UTC, written from the DATABASE clock in §4. See the note on
  -- getTodayKey() there for why the client's key cannot be the authority.
  day_key     text,
  repairs_used int not null default 0 check (repairs_used >= 0),
  repair_day  text,
  -- ⚠ DEAD HOOK, LABELLED AS ONE. Nothing in this file and nothing in the
  --   shipped client ever writes assigned_to. It is here for design §6.3: a rig
  --   picked to ride along on a raid is out of the fleet for the duration, so
  --   combat looting competes with freight income out of one budget. That is
  --   build-order step 5 and is NOT being built. The deployment path will write
  --   it; transport_dispatch already REFUSES a rig with it set, so the hook is
  --   inert but not a lie. Grep `assigned_to` before wiring it.
  assigned_to text,
  status      text not null default 'idle'
                check (status in ('idle','hauling','assigned','retired')),
  created_at  timestamptz not null default now()
);
alter table public.transport_rigs add column if not exists runs_cap     int  not null default 3;
alter table public.transport_rigs add column if not exists repairs_used int  not null default 0;
alter table public.transport_rigs add column if not exists repair_day   text;
alter table public.transport_rigs add column if not exists assigned_to  text;
create index if not exists transport_rigs_company on public.transport_rigs (company_id, status);
create index if not exists transport_rigs_owner   on public.transport_rigs (owner_id);


-- THE CONTRACT. One haul. Both parties can read it; neither can write it.
--
-- ⚠ carrier_id NULL IS MERIDIAN HAULAGE, the NPC carrier, and it must stay
--   null. Giving Meridian a real company row would create something a player
--   could one day own, and the whole point of the NPC (design §5, ratified) is
--   that it is a price CEILING no player controls.
--
-- ⚠ `on delete restrict`, not cascade. reliability is derived from these rows,
--   so a cascade would make "delete the company, re-found it" a reputation
--   launder: every lost and refused haul would vanish with it.
create table if not exists public.transport_contracts (
  id          uuid primary key default gen_random_uuid(),
  carrier_id  uuid references public.transport_companies(id) on delete restrict,
  rig_id      uuid references public.transport_rigs(id) on delete set null,
  shipper_id  uuid not null references auth.users(id) on delete cascade,
  from_node   text,
  to_node     text,
  hops        int  not null default 1 check (hops >= 1),
  units       numeric not null default 1 check (units > 0),
  -- The manifest. Unverifiable (Profile.salvage is a blob) and size-bounded, so
  -- it cannot be used as free storage on a table other players can read.
  cargo       jsonb not null default '{}'::jsonb,
  price       numeric not null default 0 check (price >= 0),
  escort      boolean not null default false,
  risk_pct    int  not null default 0 check (risk_pct between 0 and 100),
  depart_at   timestamptz not null default now(),
  arrive_at   timestamptz not null default now(),
  -- 'late' and 'refused' are in the ladder because design §5 derives
  -- reliability from them. NOTHING PRODUCES THEM YET, deliberately: see §4.2 on
  -- why a blocked dispatch is not recorded as a refusal, and §4.3 on why
  -- settling after arrive_at is the shipper's client being offline rather than
  -- the carrier being late.
  status      text not null default 'in_transit'
                check (status in ('in_transit','delivered','lost','late','refused')),
  -- 🔴 THE RETRY KEY. sql/035: "THE REF IS THE WHOLE SAFETY PROPERTY. Never
  --    retry a credit without one." Same property, other direction — a dispatch
  --    that half-succeeded at the network layer and is sent again must not
  --    charge twice. It carries NO authority: it is compared for equality
  --    against this shipper's own rows only, so the worst a forged one can do
  --    is collide with a contract the caller already paid for and be handed it
  --    back.
  client_ref  text,
  settled_at  timestamptz,
  created_at  timestamptz not null default now()
);
alter table public.transport_contracts add column if not exists rig_id     uuid references public.transport_rigs(id) on delete set null;
alter table public.transport_contracts add column if not exists hops       int     not null default 1;
alter table public.transport_contracts add column if not exists units      numeric not null default 1;
alter table public.transport_contracts add column if not exists client_ref text;
create index if not exists transport_contracts_carrier on public.transport_contracts (carrier_id, status);
create index if not exists transport_contracts_shipper on public.transport_contracts (shipper_id, created_at desc);
create index if not exists transport_contracts_inflight on public.transport_contracts (arrive_at) where status = 'in_transit';
-- Partial: only refs are constrained, so a legacy row without one is untouched.
create unique index if not exists transport_contracts_ref_uniq
  on public.transport_contracts (shipper_id, client_ref) where client_ref is not null;


-- THE LEDGER. Copies corp_treasury and community_ledger EXACTLY: append-only,
-- balance = sum(amount). There is NO balance, total or earnings column, because
-- a balance column is a thing that can drift from its own history — and here
-- the history is the only evidence that another player was owed anything.
create table if not exists public.transport_ledger (
  id          bigserial primary key,
  company_id  uuid not null references public.transport_companies(id) on delete restrict,
  -- `on delete set null` and not NOT NULL, for sql/015's reason: deleting a
  -- contract must not delete the record of what it paid. History may become
  -- unaddressed; a payment may never be CREATED unaddressed, which is enforced
  -- on the way in, in §4.3.
  contract_id uuid references public.transport_contracts(id) on delete set null,
  amount      numeric not null,
  kind        text not null check (kind in ('freight','refund','toll','payout')),
  memo        text,
  created_at  timestamptz not null default now()
);
create index if not exists transport_ledger_company on public.transport_ledger (company_id, created_at desc);
-- 🔴 ONE ROW PER (contract, kind). This is what makes a retry SAFE: a
--    settlement that half-succeeded at the network layer and is sent again
--    cannot double-pay, because the second insert collides. It is belt to the
--    `for update` + status guard in §4.3, and both are wanted — the status
--    guard depends on a function staying correct, the index does not.
create unique index if not exists transport_ledger_once
  on public.transport_ledger (contract_id, kind) where contract_id is not null;

-- 🔒 THE SIGN RULE, and it is not a rounding concern. An unconstrained signed
--    `amount` was a live attack in sql/015: one settle call with a negative row
--    addressed to a rival permanently poisons their sum(amount) in an
--    append-only table that by design has no UPDATE path to correct it. Freight
--    earns, everything else costs, and nothing may be zero.
--    ⚠ 'refund', 'toll' and 'payout' are DEAD HOOKS. Nothing in this file
--      writes them. They are in the ladder so the cash-out RPC (see the header)
--      and design §6.6's region tolls do not need a migration to be added, and
--      so the sign rule is already correct on the day they are.
alter table public.transport_ledger drop constraint if exists transport_ledger_sign_ck;
alter table public.transport_ledger add constraint transport_ledger_sign_ck check (
  (kind = 'freight' and amount > 0) or (kind <> 'freight' and amount < 0)
);


-- THE CEILINGS. One row, id = 1. Everything here is a server-owned BOUND.
--
-- ⚠ NO PRICING LIVES HERE. CLAUDE.md: "All operation pricing goes through
--   _opEcon()", and OPS_ECON is at index.html:79732. Startup cost, salaries,
--   fuel burn and repair bills are that file's business and are deliberately
--   absent — a second copy of them here would be a second authority with no
--   rule for which one wins. What IS here is the set of numbers a client must
--   not be able to choose, which is a different category: a caller-chosen
--   risk_pct is free insurance, a caller-chosen minutes_per_hop is an
--   instant-delivery button, and a caller-chosen runs cap is unlimited income.
--
-- 🔴 EVERY COLUMN BELOW ALSO HAS ITS OWN `add column if not exists`, and that
--    is load-bearing rather than tidy. sql/037 exists ENTIRELY because
--    aza_to_cinder_exchange read v_cfg.max_aza_per_tx off an %rowtype and that
--    column had never existed: "Referencing a missing field on a plpgsql record
--    RAISES… it does not return null. So every single call threw before
--    touching a balance." The functions below read this table as %rowtype. On a
--    database that already has an older shape of it, the create-table is a
--    no-op and these lines are the only thing standing between a new ceiling
--    and every dispatch in the game throwing.
create table if not exists public.transport_config (
  id                      int primary key check (id = 1),
  enabled                 boolean not null default true,
  -- Ratified, not open (design §5.1). Meridian Haulage is ALWAYS available at
  -- 2.5x the median player tariff and 1.6x the trip time. It is a price
  -- ceiling, never a bypass: it must never be cheaper or faster than a rational
  -- player quote, which is why both multipliers are > 1 and read from here
  -- rather than written as a literal at each call site.
  meridian_tariff_mult    numeric not null default 2.5,
  meridian_time_mult      numeric not null default 1.6,
  -- With no open carrier there is no median, and Meridian must still quote —
  -- otherwise a player who joins before any carrier exists cannot move cargo at
  -- all, which is the exact end-of-game the NPC exists to prevent.
  meridian_base_floor     numeric not null default 40,
  max_hops                int     not null default 6,
  max_units_per_contract  numeric not null default 5000,
  max_tariff_per_unit_hop numeric not null default 500,
  -- Provenance, not a guess: sql/034 measured the largest credit this game has
  -- ever issued (a 1,000,000 admin gift) and set the single-call ceiling on the
  -- game's one crediting path to 5,000,000, five times that. A freight bill is
  -- not a credit, but it is a transfer between players of the same order, and
  -- there is no reason for one haul to move more than the largest sum this
  -- economy has ever moved in one call.
  max_price_per_contract  numeric not null default 5000000,
  max_runs_per_rig        int     not null default 10,
  -- Enforced at rig registration by the BEFORE INSERT guard in §2b, which
  -- reads the depot ladder through transport_caps() so there is still only one
  -- copy of `least(4 * depot_level, max_fleet_rigs)`.
  -- ⚠ IT TOOK TWO DRAFTS TO ENFORCE THIS ANYWHERE. Draft one capped it in the
  --   header and nowhere else; draft two put it in a WITH CHECK, which cannot
  --   count rows its own statement is inserting. The same attack — 60
  --   Mythic/Pristine rigs INSERTed into one depot-level-1 charter in a single
  --   statement — went through both, all 60 accepted, and both times the file
  --   said in prose that it would not. A cap that only exists in a header is
  --   worse than no cap: it stops anyone looking for the real one.
  max_fleet_rigs          int     not null default 12,
  max_bays                int     not null default 6,
  -- 🔒 A SYBIL BOUND, NOT A DESIGN RULE ABOUT HOW MANY BUSINESSES A PLAYER MAY
  --    RUN. Founding a charter is a free INSERT, and every open charter is a
  --    sample in the median that sets the Meridian ceiling (§4.1). Measured:
  --    nine sock charters at base 1, founded by one account in one statement
  --    back when nothing stopped that, moved the Meridian quote for a haul from
  --    4,500 to 75 — 1.7% of the one honest carrier's own rate. At that price
  --    the NPC undercuts every player on the board and the market this feature
  --    exists to create never opens. Raise this if the design ever wants
  --    multi-charter operators; the median's own floor in §4.1 is the defence
  --    that does not depend on this number being right.
  --    ⚠ THAT 75 IS THE FIRST DRAFT'S NUMBER, kept because it is why this
  --      column exists. Re-run against this file, the same attack is held to
  --      three charters by the guard in §2b (NOT by tco_ins — the WITH CHECK
  --      this cap used to live in let all nine through), each of which must
  --      buy a real delivery before it is sampled at all, and the floor in
  --      §4.1 then holds the quote at 3,000 instead of 75.
  max_charters_per_owner  int     not null default 3,
  minutes_per_hop         int     not null default 25,
  risk_pct_per_hop        numeric not null default 4,
  escort_risk_cut_pct     numeric not null default 60,
  max_risk_pct            int     not null default 45,
  max_repairs_per_rig_day int     not null default 2,
  updated_at              timestamptz not null default now()
);
alter table public.transport_config add column if not exists enabled                 boolean not null default true;
alter table public.transport_config add column if not exists meridian_tariff_mult    numeric not null default 2.5;
alter table public.transport_config add column if not exists meridian_time_mult      numeric not null default 1.6;
alter table public.transport_config add column if not exists meridian_base_floor     numeric not null default 40;
alter table public.transport_config add column if not exists max_hops                int     not null default 6;
alter table public.transport_config add column if not exists max_units_per_contract  numeric not null default 5000;
alter table public.transport_config add column if not exists max_tariff_per_unit_hop numeric not null default 500;
alter table public.transport_config add column if not exists max_price_per_contract  numeric not null default 5000000;
alter table public.transport_config add column if not exists max_runs_per_rig        int     not null default 10;
alter table public.transport_config add column if not exists max_fleet_rigs          int     not null default 12;
alter table public.transport_config add column if not exists max_bays                int     not null default 6;
alter table public.transport_config add column if not exists max_charters_per_owner  int     not null default 3;
alter table public.transport_config add column if not exists minutes_per_hop         int     not null default 25;
alter table public.transport_config add column if not exists risk_pct_per_hop        numeric not null default 4;
alter table public.transport_config add column if not exists escort_risk_cut_pct     numeric not null default 60;
alter table public.transport_config add column if not exists max_risk_pct            int     not null default 45;
alter table public.transport_config add column if not exists max_repairs_per_rig_day int     not null default 2;

-- `do nothing`, never `do update`. Re-running this file must not silently reset
-- a ceiling somebody tuned in the SQL editor after an incident — which is
-- precisely when this file is most likely to be pasted again.
insert into public.transport_config (id) values (1) on conflict (id) do nothing;


-- ─── 2. SECURITY DEFINER HELPERS (the anti-recursion layer) ────────────────

-- "Does the CALLER own this company?" — a boolean about auth.uid(), and there
-- is deliberately NO parameter naming a user. sql/015's r9 helper took an
-- arbitrary uuid and answered about anybody, which is more than any caller
-- needed; a definer helper should answer the caller's question and nothing
-- wider.
--
-- ⚠ TWO REASONS THIS IS A FUNCTION AND NOT AN INLINE EXISTS, and the second one
--   is the one that will bite later:
--   1. Recursion. Policies on rigs, contracts and the ledger all need to know
--      who owns a company; written as plain subqueries against each other's
--      tables they re-enter RLS and can recurse forever. A definer function
--      bypasses RLS and therefore TERMINATES. Same rule CLAUDE.md gives for
--      is_community_member. Do not inline these back into the policies.
--   2. A policy's subquery is evaluated AS THE CALLER, under RLS. The charter
--      table is publicly readable today, so an inline EXISTS would work — and
--      would silently start returning false for everyone the day somebody
--      narrows that SELECT policy, quietly unsharing every carrier from their
--      own fleet, contracts and ledger at once. The definer helper is immune to
--      that change by construction.
create or replace function public.is_transport_owner(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.transport_companies c
     where c.id = p_company_id
       and c.owner_id = auth.uid()
  );
$$;
revoke all on function public.is_transport_owner(uuid) from public, anon;
grant execute on function public.is_transport_owner(uuid) to authenticated;


-- 🔴 THE ONE PLACE THE DEPOT LADDER IS EVALUATED. design §2b's building effect
--    is `{ bays: 2*lv, fleetCap: 4*lv, radius: 3+lv }`. Those three expressions
--    were written out at four separate call sites in the first draft of this
--    file — reach in transport_quote, bays in transport_dispatch, and both
--    again in transport_set_sheet's return payload, which is what the owner's
--    UI prints. Four copies of a formula is four authorities, and the day one
--    of them is tuned the carrier is shown a fleet cap the server does not
--    enforce. THIS FUNCTION IS THE AUTHORITY; production.data.js is the
--    authority for what the BUILDING costs and draws. If they disagree the
--    player is sold bays the server will not honour, so change them together.
--
-- ⚠ WHY IT IS A DEFINER FUNCTION and not a view or an inline expression:
--   1. It reads transport_config, which no client may read at all (§3). An
--      inline subquery in a policy runs AS THE CALLER and would see zero rows,
--      so every cap would silently evaluate to null and every check would pass.
--   2. It counts transport_rigs, and it is read by the INSERT path on
--      transport_rigs — today from the guard in §2b, and before that from the
--      policy itself. Inline in a policy, that is a policy on a table querying
--      that table — the recursion CLAUDE.md names. A definer function bypasses
--      RLS and therefore terminates.
--
-- ⚠ 'retired' is currently UNREACHABLE: no UPDATE path to that column exists
--   (§3) and retiring a rig is a DELETE. The filter is here so that on the day
--   retirement becomes a status change, a scrapped rig does not go on holding a
--   fleet slot. Grep `'retired'` before wiring that.
--
-- ⚠ `fleet_used` AND `fleet_slots_left` ARE A UI HINT, NOT THE ENFORCEMENT,
--   and the distinction is worth the two words. This function is `stable`: it
--   answers from the snapshot its caller started with, so inside a multi-row
--   INSERT it reports the slots that were free BEFORE the statement began. It
--   is the right shape for the Depot screen and for transport_set_sheet's
--   payload, and the wrong shape for a limit — which is the whole story of
--   §2b. `fleet_cap` has no such caveat; it is a pure function of the row.
--
-- Returns NULL for a company that does not exist, which is why every caller
-- compares the extracted value rather than trusting it — `null > 0` is null,
-- and a caller who trusts it instead REFUSES. That is the safe direction.
create or replace function public.transport_caps(p_company_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'reach',      3 + c.depot_level,
    'bays',       least(2 * c.depot_level, f.max_bays),
    'fleet_cap',  least(4 * c.depot_level, f.max_fleet_rigs),
    'fleet_used', (select count(*) from public.transport_rigs r
                    where r.company_id = c.id and r.status <> 'retired'),
    'fleet_slots_left',
      greatest(0, least(4 * c.depot_level, f.max_fleet_rigs)
                  - (select count(*) from public.transport_rigs r
                      where r.company_id = c.id and r.status <> 'retired')))
    from public.transport_companies c
    cross join public.transport_config f
   where c.id = p_company_id and f.id = 1;
$$;
revoke all on function public.transport_caps(uuid) from public, anon;
grant execute on function public.transport_caps(uuid) to authenticated;


-- "Is this rate sheet inside the server's ceiling?" — asked by tco_ins, so a
-- charter cannot be BORN above the cap.
--
-- 🔴 WHY THE INSERT PATH NEEDS THIS AND THE CHECK CONSTRAINT IS NOT ENOUGH.
--    transport_set_sheet clamps a sheet on the way in, and UPDATE is revoked,
--    so the clamp cannot be walked past by an UPDATE. But nothing clamped the
--    FIRST write. The column CHECK bounds base at 100000 — a structural bound,
--    two hundred times the tunable ceiling — and a charter founded at 100000
--    was a legal row. Measured on the throwaway cluster: sock charters at that
--    base pushed a Meridian quote for a 6-hop / 5000-unit haul to 7,500,000,000
--    against a max_price_per_contract of 5,000,000. The founding INSERT was the
--    hole, not the setter.
--
-- ⚠ The type guards are not decoration. `(p_tariff->>'base')::numeric` on a
--   base of "5" (a JSON string, not a number) RAISES 22P02, and a raise inside
--   a WITH CHECK is an opaque 500 to the client rather than a refusal it can
--   render. Same class of failure as sql/037's %rowtype postmortem: the
--   expression does not return null, it throws.
create or replace function public.transport_tariff_ok(p_tariff jsonb)
returns boolean language sql stable security definer set search_path = public as $$
  select jsonb_typeof(coalesce(p_tariff, '{}'::jsonb)) = 'object'
     and coalesce(jsonb_typeof(p_tariff->'base'),        'number') = 'number'
     and coalesce(jsonb_typeof(p_tariff->'escort_pct'),  'number') = 'number'
     and coalesce(jsonb_typeof(p_tariff->'illicit_pct'), 'number') = 'number'
     and coalesce((p_tariff->>'base')::numeric, 0)
         <= (select f.max_tariff_per_unit_hop from public.transport_config f where f.id = 1);
$$;
revoke all on function public.transport_tariff_ok(jsonb) from public, anon;
grant execute on function public.transport_tariff_ok(jsonb) to authenticated;


-- "How many more charters may the CALLER found?" — and, exactly like
-- is_transport_owner, there is deliberately no parameter naming a user. It
-- answers about auth.uid() and nobody else.
--
-- ⚠ DEFINER BECAUSE IT COUNTS transport_companies AND IS READ ON THE INSERT
--   PATH OF transport_companies. Written inline in a policy that is the
--   textbook recursion case. It also reads transport_config, which no client
--   may read at all.
--
-- 🔴 THIS IS THE NUMBER THE UI PRINTS. IT IS NOT THE ENFORCEMENT, AND IT USED
--    TO BE. It sat in tco_ins's WITH CHECK as `… > 0` and a single nine-row
--    INSERT walked past it, because a `stable` function answers from the
--    pre-statement snapshot and so never sees the charters being founded
--    alongside the one it is judging. The cap is now allocated by the guard in
--    §2b. What this function is good for is telling an owner how many slots
--    they had a moment ago, which is exactly what a "Found a charter" button
--    needs to grey itself out — and it may be one out of date by the time they
--    click, which is why the guard, not the button, is the authority.
--   Null config row ⇒ null. A caller must treat that as zero, not as "no cap";
--   §2b raises rather than allowing, and `cfg_rows` in §5 catches it.
create or replace function public.transport_charter_slots_left()
returns integer language sql stable security definer set search_path = public as $$
  select greatest(0,
    (select f.max_charters_per_owner from public.transport_config f where f.id = 1)
    - (select count(*)::int from public.transport_companies c where c.owner_id = auth.uid()));
$$;
revoke all on function public.transport_charter_slots_left() from public, anon;
grant execute on function public.transport_charter_slots_left() to authenticated;


-- ─── 2b. IN-STATEMENT CAPS (the two limits a policy cannot enforce) ────────
--
-- 🔴 WHY THESE ARE TRIGGERS, AND WHY THAT REVERSES A DECISION THIS FILE USED
--    TO ARGUE FOR, OUT LOUD, IN A COMMENT.
--    The previous draft enforced both counting caps in a WITH CHECK —
--    `transport_charter_slots_left() > 0` on tco_ins, and
--    `(transport_caps(company_id)->>'fleet_slots_left')::int > 0` on trg_ins —
--    and the comment on trg_ins explicitly REJECTED a trigger, on the grounds
--    that "a trigger on an RLS-protected table is a second, invisible authority
--    for a rule this policy already states out loud". The premise was false.
--    The policy did not state a rule it enforced; it stated one it announced.
--
--    A WITH CHECK is evaluated per row, and the definer helpers it calls are
--    `stable`, so they read the snapshot the statement began with — a snapshot
--    that does NOT contain the rows this statement is inserting. The check is
--    therefore asked "is a slot free?" once per row and answers "yes" every
--    time, because as far as it can see nothing has been inserted yet. ONE
--    STATEMENT IS UNBOUNDED. Measured as `authenticated` on the throwaway
--    cluster the header describes, against the shipped file:
--      · insert … select from generate_series(1,9)  → 9 charters against
--        max_charters_per_owner = 3, every WITH CHECK passing
--      · insert … select from generate_series(1,60) → 60 rigs into a
--        depot-level-1 charter whose fleet_cap is 4
--    Both caps were real, both were tested one row at a time, and both were
--    one `select from generate_series` away from being decoration.
--
--    A BEFORE INSERT … FOR EACH ROW trigger is the shape that CAN see them.
--    A volatile plpgsql function runs its queries through SPI, which advances
--    the command counter before each one, so row 4 of a 60-row insert counts
--    rows 1-3.
--    🔴 THAT PROPERTY IS THE WHOLE REASON THESE ARE TRIGGERS: do NOT mark
--       either function `stable` to "help the planner". Stable switches SPI to
--       read-only, the command counter stops advancing, the count goes back to
--       reading a pre-statement snapshot, and the cap silently stops working
--       with no other visible change. That is the same failure as the WITH
--       CHECK, reintroduced by one keyword.
--
-- 🔴 AND THEY ALLOCATE, WHERE THE WITH CHECK ONLY BOUNDED. Each guard takes an
--    advisory transaction lock on the owner (or the charter) BEFORE it counts,
--    and holds it to commit, so concurrent registrations queue instead of
--    racing. A policy cannot take a lock — that was the second half of the
--    hole, and the previous draft published the resulting overshoot as a
--    permanent limit of the design. It is not one. Same last-slot race, run
--    both ways: with the policy alone, two sessions both take the last slot
--    and the owner ends up with 4 charters against a cap of 3 and 5 rigs
--    against a cap of 4; with the guard, the second session waits on the lock
--    and is then refused. Numbers and method in the header.
--
-- ⚠ LOCK NAMESPACE AND LOCK ORDER. Two-key advisory locks, (a class number
--   private to this migration, hash of the id), so nothing else in this
--   database collides with them by accident. hashtext can collide with itself:
--   two unrelated owners may share a key and serialise against each other for
--   the length of one INSERT — a queue, not a wrong answer. These locks are a
--   separate space from the `for update` row locks in §4 and are never held
--   across one: a guard locks, counts and returns inside a single INSERT, and
--   nothing in §4 inserts a charter or a rig.
--
-- ⚠ ONE STATEMENT INSERTING FOR TWO DIFFERENT OWNERS takes two of these locks
--   in row order, so two such statements in opposite orders can deadlock.
--   Postgres detects that and aborts one with 40P01 — a refusal, not a
--   corruption — and no client does it: founding is one charter at a time from
--   a form. Written down because a deadlock nobody predicted reads like data
--   loss at 3am.
--
-- ⚠ INSERT ONLY, DELIBERATELY. Neither guard fires on UPDATE, because there is
--   no UPDATE path to guard: UPDATE is revoked on both tables and no policy
--   grants it (§3), and no function in §4 moves a rig between charters. A
--   trigger covering a path that does not exist is a claim nobody can test.
--   If a future migration adds a "transfer this rig" RPC, it adds the UPDATE
--   arm here in the same file.
--
-- ⚠ NO `grant execute` ON EITHER FUNCTION, and that is not an omission.
--   EXECUTE on a trigger function is checked when the TRIGGER is created, not
--   when it fires, so the guards run for a role that cannot call them directly.
--   Verified on the throwaway cluster: as `authenticated`, with EXECUTE revoked
--   from public, anon AND authenticated, both caps still refuse.

create or replace function public.transport_charter_cap_guard()
returns trigger language plpgsql security definer set search_path = public as $function$
declare
  v_cap  int;
  v_have int;
begin
  -- Lock first, count second. Reversed, this is the race it exists to close.
  perform pg_advisory_xact_lock(38001, hashtext(coalesce(new.owner_id::text, '-')));

  select f.max_charters_per_owner into v_cap
    from public.transport_config f where f.id = 1;
  if v_cap is null then
    -- sql/037's lesson in the other direction: say WHICH thing is missing.
    -- A null cap must never read as "no cap".
    raise exception 'transport_config_missing'
      using errcode = 'check_violation',
            detail  = '{"error":"transport_config_missing"}',
            hint    = 'The id=1 row of transport_config is gone. Re-run sql/038.';
  end if;

  select count(*) into v_have
    from public.transport_companies c where c.owner_id = new.owner_id;

  if v_have >= v_cap then
    -- The numbers are safe to publish to any caller: tco_sel makes this table
    -- a public directory, so anyone can already count anyone's charters. The
    -- fleet guard below is NOT in that position, and does not.
    raise exception 'charter_cap'
      using errcode = 'check_violation',
            detail  = jsonb_build_object('error', 'charter_cap',
                                         'cap', v_cap, 'used', v_have,
                                         'remaining', 0)::text,
            hint    = 'Close an existing charter before founding another.';
  end if;
  return new;
end;
$function$;
-- Revoked from `authenticated` too — see the note above on why the trigger
-- still fires. Nothing may call this as a function; it is not one, in practice.
revoke all on function public.transport_charter_cap_guard() from public, anon, authenticated;
drop trigger if exists transport_companies_cap on public.transport_companies;
create trigger transport_companies_cap
  before insert on public.transport_companies
  for each row execute function public.transport_charter_cap_guard();


create or replace function public.transport_fleet_cap_guard()
returns trigger language plpgsql security definer set search_path = public as $function$
declare
  v_cfg_max int;
  v_cap     int;
  v_have    int;
begin
  perform pg_advisory_xact_lock(38002, hashtext(coalesce(new.company_id::text, '-')));

  select f.max_fleet_rigs into v_cfg_max
    from public.transport_config f where f.id = 1;
  if v_cfg_max is null then
    raise exception 'transport_config_missing'
      using errcode = 'check_violation',
            detail  = '{"error":"transport_config_missing"}',
            hint    = 'The id=1 row of transport_config is gone. Re-run sql/038.';
  end if;

  -- 🔴 THE LADDER IS STILL READ FROM transport_caps, WHICH IS STILL THE ONE
  --    PLACE `least(4 * depot_level, max_fleet_rigs)` IS EVALUATED (§2). Only
  --    the COUNT is repeated here, and only because a count issued from this
  --    volatile function is the one that can see the rows the current statement
  --    has already inserted. Splitting it this way keeps the number the owner's
  --    Depot screen prints and the number that refuses a rig the same number.
  --    The filter below must stay identical to transport_caps' `fleet_used`:
  --    if one counts 'retired' rigs and the other does not, the UI and the
  --    refusal disagree, which is the exact failure §2 exists to prevent.
  v_cap := (public.transport_caps(new.company_id)->>'fleet_cap')::int;
  if v_cap is null then
    raise exception 'no_such_carrier'
      using errcode = 'check_violation',
            detail  = '{"error":"no_such_carrier"}';
  end if;

  select count(*) into v_have
    from public.transport_rigs r
   where r.company_id = new.company_id and r.status <> 'retired';

  if v_have >= v_cap then
    -- ⚠ AN ERROR MESSAGE IS A READ PATH. trg_sel deliberately does not publish
    --   a rival's yard — fleet size is competitive information, and knowing a
    --   carrier is at cap is knowing when to undercut them. So the counts go
    --   only to the owner; everybody else gets the bare code. Without this the
    --   guard would hand out, through a refusal, exactly what the SELECT policy
    --   four sections down refuses to hand out through a query.
    if public.is_transport_owner(new.company_id) then
      raise exception 'fleet_cap'
        using errcode = 'check_violation',
              detail  = jsonb_build_object('error', 'fleet_cap',
                                           'cap', v_cap, 'used', v_have,
                                           'remaining', 0,
                                           'max_fleet_rigs', v_cfg_max)::text,
              hint    = 'Retire a rig, or raise the depot level for more slots.';
    end if;
    raise exception 'fleet_cap'
      using errcode = 'check_violation',
            detail  = '{"error":"fleet_cap"}';
  end if;
  return new;
end;
$function$;
revoke all on function public.transport_fleet_cap_guard() from public, anon, authenticated;
drop trigger if exists transport_rigs_cap on public.transport_rigs;
create trigger transport_rigs_cap
  before insert on public.transport_rigs
  for each row execute function public.transport_fleet_cap_guard();


-- ─── 3. RLS ────────────────────────────────────────────────────────────────
alter table public.transport_companies enable row level security;
alter table public.transport_rigs      enable row level security;
alter table public.transport_contracts enable row level security;
alter table public.transport_ledger    enable row level security;
alter table public.transport_config    enable row level security;

-- CHARTERS · read. `using (true)` — this is a PUBLIC DIRECTORY and the only
-- one in this file. The rate board (design §5) exists so carriers can see and
-- undercut each other's tariffs; a price only its owner can read is not a
-- market. Everything on the row is meant to be shopped: name, home node, depot
-- level, tariff, reliability, status. The blacklist is public too, and that is
-- deliberate — design §5.3 wants a refusal to be visible politics.
drop policy if exists tco_sel on public.transport_companies;
create policy tco_sel on public.transport_companies for select to authenticated
  using (true);

-- Founding is self-service, and the with-check is doing six separate jobs
-- rather than one. In your own name — nobody founds a business for somebody
-- else. Open for business, so a charter cannot be born 'closed' and sit
-- invisible to the antitrust maths of design §5.4. With no reputation yet,
-- because a founder who could pick their own opening reliability would start
-- at 100% and never have to earn it. And with an empty refusal list, so a new
-- charter cannot arrive pre-loaded against a rival. The remaining claimed
-- value, depot_level, is bounded by the column's own CHECK.
--
-- 🔴 THE LAST CLAUSE IS THE FIX FOR ONE HALF OF A MEASURED HOLE, AND §2b IS
--    THE OTHER HALF. Both halves are about the same thing: THE ROWS OF THIS
--    TABLE ARE THE INPUT TO THE MERIDIAN CEILING (§4.1). Founding is a free
--    INSERT with no server round trip that costs anything, so before either
--    half existed the price ceiling for the whole game was populated by
--    whoever was willing to run a loop. The two halves are split the way they
--    are because of what each check has to look at, which turns out to decide
--    where it can physically live.
--    · transport_tariff_ok  — the sheet must be inside max_tariff_per_unit_hop
--      on the way in, not merely on the way through the setter. Nine sock
--      charters at the CHECK's structural limit of 100000 took a Meridian quote
--      to 7,500,000,000. Measured, on the throwaway cluster in the header.
--      transport_tariff_ok is a PER-ROW test — it looks only at the row in
--      front of it — which is why it can live in a WITH CHECK at all.
--    · The other direction, nine sock charters at base 1, took the same quote
--      DOWN to 75 against an honest carrier charging 4,500, which is the more
--      dangerous one: an NPC that undercuts every player is not a price
--      ceiling, it is the end of the player market. That attack is COUNTING —
--      it needs many charters, not one bad one — and a count is the thing a
--      WITH CHECK cannot do. `transport_charter_slots_left() > 0` used to sit
--      on this line and did not work: a nine-row insert produced nine
--      charters against a cap of 3, because a stable helper cannot see the
--      rows its own statement is inserting. It now lives in the BEFORE INSERT
--      guard in §2b, which can see them and which takes a lock as well.
--      Full measurement, before and after, in §2b.
--    Neither clause names this table, so neither can recurse; the surviving one
--    goes through a definer helper in §2. Do not inline it back.
drop policy if exists tco_ins on public.transport_companies;
create policy tco_ins on public.transport_companies for insert to authenticated
  with check (owner_id = auth.uid()
              and status = 'open'
              and reliability is null
              and blacklist = '{}'::uuid[]
              and public.transport_tariff_ok(tariff));

-- 🔴 NO UPDATE POLICY AND NO DELETE POLICY. Both absences are deliberate and
--    both are backed by a revoke below, so the denial does not depend on this
--    file staying un-edited.
--    UPDATE — the temptation is a policy saying "the owner may retune their own
--    tariff and nothing else". POSTGRES RLS HAS NO COLUMN GRANULARITY: a
--    row-level UPDATE policy permits every column of that row, so the same
--    policy hands over reliability (invent a perfect record), depot_level
--    (more bays than you built) and status. sql/015 deleted its sev_upd policy
--    over exactly this, and its comment had promised exactly this intent.
--    An RPC, unlike a policy, CAN express column granularity — so retuning goes
--    through transport_set_sheet in §4.5, which is what turns its clamps from a
--    suggestion into a rule.
--    DELETE — see the `on delete restrict` note on the contract table: a
--    carrier who can delete their charter can delete their reputation.
--    Retirement is status = 'closed'.
revoke update, delete on public.transport_companies from anon, authenticated;

-- FLEET · read. Your own rigs only. A rival's fleet composition is competitive
-- information — how many rigs, what rarity, how many runs each has left today
-- — and knowing a carrier is out of runs is knowing exactly when to undercut
-- them. The rate board publishes free bays; it does not publish the yard.
drop policy if exists trg_sel on public.transport_rigs;
create policy trg_sel on public.transport_rigs for select to authenticated
  using (public.is_transport_owner(company_id));

-- Registering a rig is self-service, and every counter is PINNED AT ITS ZERO.
-- Without those four equalities the insert IS the exploit: a rig arriving with
-- runs_used = -1000 has a thousand free hauls, one arriving already 'hauling'
-- occupies a bay it never earned, and one arriving with assigned_to set is
-- invisible to a dispatch guard that refuses exactly that. The claimed values
-- that remain — rarity, condition, runs_cap — are bounded by their CHECKs and
-- again by the ceilings at dispatch time.
--
-- 🔴 THE FLEET CAP IS NOT HERE, AND THIS IS THE LINE IT WAS WRONG ON TWICE.
--    The first draft of this file shipped max_fleet_rigs in transport_config,
--    printed a `fleet_cap` in transport_set_sheet's payload for the owner's UI,
--    listed "fleet size" in the header among the things that were capped — and
--    enforced it nowhere at all. The second draft added
--    `(transport_caps(company_id)->>'fleet_slots_left')::int > 0` to this WITH
--    CHECK and said so in the header. Measured, as `authenticated`, against
--    that second draft: one `insert … select from generate_series(1,60)` put
--    60 Mythic/Pristine rigs into a depot-level-1 charter whose cap is 4. All
--    60 accepted, with the clause right there on the line, because a `stable`
--    helper called from a WITH CHECK reads the snapshot the statement started
--    with and cannot see the rows the statement is inserting.
--    A CAP THAT EXISTS ONLY IN PROSE is the worst state for a limit to be in,
--    and a cap that exists as an expression which cannot do its job is the
--    same state wearing a costume: both read as enforced in review, and both
--    stop the next reader looking for the real check.
--    THE REAL CHECK IS THE BEFORE INSERT GUARD IN §2b, which can see the
--    statement's own rows and takes a lock besides. What stays here is exactly
--    what a per-row test can decide: ownership and the pinned zeros.
drop policy if exists trg_ins on public.transport_rigs;
create policy trg_ins on public.transport_rigs for insert to authenticated
  with check (owner_id = auth.uid()
              and public.is_transport_owner(company_id)
              and runs_used = 0 and repairs_used = 0
              and assigned_to is null
              and status = 'idle');

-- Retiring a rig is allowed; retiring one mid-haul is not, because the contract
-- would keep an arrival time nobody is driving towards. The contract's own
-- reference is `on delete set null`, so a retired rig leaves the delivery
-- record intact rather than taking it along.
drop policy if exists trg_del on public.transport_rigs;
create policy trg_del on public.transport_rigs for delete to authenticated
  using (owner_id = auth.uid() and status <> 'hauling');

-- 🔴 NO UPDATE POLICY, for the same mechanical reason as the charter table and
--    with more at stake. Every column that decides money is on this row:
--    runs_used and day_key are the daily rate limit, condition feeds the runs
--    ladder, status holds the bay, and assigned_to is the battle interlock. A
--    row-level UPDATE policy hands over all five together, whatever its comment
--    says. Runs move only inside transport_dispatch; condition moves only
--    inside transport_repair. Revoked as well, so the denial survives an edit
--    to this file.
revoke update on public.transport_rigs from anon, authenticated;

-- CONTRACTS · read. BOTH SIDES, and both halves are load-bearing. The shipper
-- must be able to watch their own cargo; the carrier must be able to see the
-- work they were hired for. A third player is entitled to neither — a contract
-- names a route, a price and a manifest, which together are a competitor's
-- entire business. Meridian hauls (carrier_id null) are readable by their
-- shipper through the first branch alone.
drop policy if exists tct_sel on public.transport_contracts;
create policy tct_sel on public.transport_contracts for select to authenticated
  using (shipper_id = auth.uid() or public.is_transport_owner(carrier_id));

-- 🔴 NO INSERT, UPDATE OR DELETE POLICY. With RLS on and no permissive policy,
--    every such statement matches nothing, and the grants are revoked so the
--    denial does not depend on a policy staying deleted. A shipper who could
--    INSERT would write themselves a contract at any price with any arrival
--    time — which is a free haul and an instant one. A carrier who could UPDATE
--    would set status = 'delivered' on a haul that never left, and reliability
--    is derived from that column. The only writer is transport_dispatch /
--    transport_settle, which run outside RLS and can prove what they wrote.
revoke insert, update, delete on public.transport_contracts from anon, authenticated;

-- LEDGER · read. The company's owner, and nobody else — not even the shipper
-- who paid for the line item. A shipper can already read the price on their own
-- contract; what they must not get is the carrier's whole book, which is every
-- price that carrier has ever accepted and therefore the floor of every future
-- negotiation.
drop policy if exists tld_sel on public.transport_ledger;
create policy tld_sel on public.transport_ledger for select to authenticated
  using (public.is_transport_owner(company_id));

-- 🔴 APPEND-ONLY, ENFORCED RATHER THAN ASSERTED. No insert, update or delete
--    policy exists, the grants are revoked, AND the sequence is revoked too —
--    sql/017's fully-locked variant. A carrier who could insert would write
--    their own earnings; a rival who could insert would write a NEGATIVE row
--    against someone else's company and permanently poison a sum() that has no
--    UPDATE path to correct it; anyone who could delete could erase what they
--    were paid. The only writer is transport_settle.
revoke insert, update, delete on public.transport_ledger from anon, authenticated;
revoke all on sequence public.transport_ledger_id_seq from anon, authenticated;

-- CEILINGS · nobody, for any command. RLS is on and there is deliberately no
-- policy at all, so no client can even read this row.
-- ⚠ These numbers are not secret — they are printed on every quote. The reason
--   the client cannot read the table is that a client which reads the ceilings
--   acquires a SECOND copy of the pricing authority and will eventually
--   disagree with the first. Every number the UI needs to render a quote is
--   returned inside transport_quote's own jsonb, so there is exactly one path
--   and it is the one that also does the charging.
revoke select, insert, update, delete on public.transport_config from anon, authenticated;


-- ─── 4. RPCs ───────────────────────────────────────────────────────────────
--
-- All five below — and the four helpers in §2, and the two guards in §2b — are
-- `security definer` with a pinned search_path and are revoked from public and
-- anon immediately after each definition, with the full argument type list
-- spelled out. A revoke naming a partial signature names a function that does
-- not exist: it succeeds, and it revokes nothing. The five here and the four in
-- §2 are then granted to `authenticated`; the two guards are granted to nobody,
-- because a trigger function is not called by the client that fires it.
--
-- ⚠ LOCK ORDER, one direction everywhere: companies → rigs → contracts.
--   transport_settle locks only the contract row and then updates the company's
--   reliability cache without locking it first. That is not an inversion,
--   because transport_dispatch never waits on an existing contract row — it
--   counts them (no row locks) and inserts a new one.
--
-- ⚠ EVERY REFUSAL IS A DISTINCT SHORT CODE, and every code carries the numbers
--   needed to write a sentence (cap, used, remaining, needed). This is not
--   decoration: index.html:79921 records four wasted debugging sessions caused
--   by a toast that blamed a missing migration for any 'does not exist' error —
--   "'does not exist' does NOT mean the RPC is missing. It also fires when the
--   function EXISTS but a table INSIDE it does not." A generic refusal costs
--   somebody a day.


-- ── 4.1 · transport_quote — THE ONE PRICING AUTHORITY ─────────────────────
-- Read-only. Returns what a haul would cost and what Meridian would charge for
-- the same haul, so the rate board and the confirm dialog show the same numbers
-- the charge will use.
--
-- 🔴 transport_dispatch CALLS THIS FUNCTION rather than computing a price of
--    its own. That is the whole reason it exists as a separate RPC: two copies
--    of a price formula is two authorities, and the day they drift the player
--    is shown one number and billed another.
--
-- ⚠ p_hops IS SUPPLIED BY THE CALLER AND CANNOT BE VERIFIED. There is no
--   adjacency table in this database — see the header's note on the two node id
--   spaces. hops multiplies the price, so it is a lever, and it is bounded
--   three ways: by the depot's reach (design §2b: radius = 3 + level), by
--   max_hops, and by max_price_per_contract at the end. A shipper inflating
--   hops charges THEMSELVES more, which is the harmless direction; a carrier
--   cannot inflate it at all, because the shipper is the caller.
--
-- ⚠ p_carrier_id NULL MEANS "quote Meridian Haulage". Answerable with zero
--   carriers on the board — that is the launch-day case and the whole point of
--   the NPC — but NOT unconditionally answerable, and the difference matters
--   enough to write down. When the market's own median sits at the tariff
--   ceiling, a haul at max_units x max_hops prices above max_price_per_contract
--   and Meridian refuses it too, with 'over_price_cap'. Measured: 37,500,000
--   against a cap of 5,000,000. That is the correct failure — a cap that makes
--   an exception for the fallback carrier is not a cap, and the shipper's
--   remedy is to split the load, which is a sentence the client can write from
--   the `units` and `cap` in that refusal. Do not "fix" this by exempting the
--   NPC branch; that exemption is exactly the bug this function shipped with.
create or replace function public.transport_quote(
  p_carrier_id uuid,
  p_from_node  text,
  p_to_node    text,
  p_hops       integer,
  p_units      numeric,
  p_escort     boolean
) returns jsonb
language plpgsql stable security definer set search_path = public as $function$
declare
  v_uid      uuid := auth.uid();
  v_cfg      public.transport_config%rowtype;
  v_co       public.transport_companies%rowtype;
  v_hops     int;
  v_units    numeric;
  v_median   numeric;
  v_mer_base numeric;
  v_mer_price numeric;
  v_mer_eta  int;
  v_base     numeric;
  v_escort_pct numeric := 0;
  v_escort   boolean := false;
  v_price    numeric;
  v_eta      int;
  v_risk     int;
  v_reach    int;
  v_capped   boolean := false;
  v_kind     text;
  v_rel      numeric;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select * into v_cfg from public.transport_config where id = 1;
  if not found or not v_cfg.enabled then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;

  v_hops  := coalesce(p_hops, 0);
  v_units := coalesce(p_units, 0);
  if v_hops < 1 or v_hops > v_cfg.max_hops then
    return jsonb_build_object('ok', false, 'error', 'bad_hops',
                              'max_hops', v_cfg.max_hops, 'hops', v_hops);
  end if;
  if v_units <= 0 or v_units > v_cfg.max_units_per_contract then
    return jsonb_build_object('ok', false, 'error', 'bad_units',
                              'max_units', v_cfg.max_units_per_contract, 'units', v_units);
  end if;
  if coalesce(nullif(p_from_node, ''), '') = '' or coalesce(nullif(p_to_node, ''), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'bad_route');
  end if;
  if p_from_node = p_to_node then
    return jsonb_build_object('ok', false, 'error', 'same_node');
  end if;

  -- 🔴 THE MERIDIAN CEILING, computed here and nowhere else. 2.5x the MEDIAN
  --    player tariff and 1.6x the trip time, both read from transport_config
  --    (ratified: design §5.1). Median rather than mean so one carrier posting
  --    an absurd sheet cannot drag the ceiling up for everybody. Paused and
  --    closed charters are excluded — a ceiling set by carriers who are not
  --    trading is not a market rate.
  --
  -- 🔒 THE MEDIAN IS ATTACKER-POPULATED, AND THAT WAS A REAL HOLE, NOT A
  --    THEORETICAL ONE. Every row in this scan is a row some player INSERTed
  --    for free. Both directions were measured on the throwaway cluster the
  --    header describes, against one honest carrier at base 60:
  --      · nine sock charters at base 1      → Meridian 4,500 → 75
  --      · nine sock charters at base 100000 → Meridian → 7,500,000,000
  --    The first is the one that ends the game: an NPC quoting 1.7% of the only
  --    real carrier's rate is not a price ceiling, it is a state-run competitor
  --    nobody can undercut, and the player market never opens. The second slips
  --    a nine-figure charge past a 5,000,000 cap (see THE SINGLE EXIT below).
  --
  --    THREE THINGS NARROW IT, and they are deliberately not one thing:
  --    1. Each row's base is clamped into [0, max_tariff_per_unit_hop] INSIDE
  --       the percentile, so a single absurd sheet cannot distort the ordering
  --       it is sorted into. Belt.
  --    2. Only carriers that have actually DELIVERED something are sampled. A
  --       charter is free; a delivery is not — it costs some shipper a real
  --       dispatch fee through that carrier. This is what makes the sock-puppet
  --       attack cost money instead of a loop, and it is why the filter is on
  --       contracts rather than on, say, account age.
  --    3. THE RESULT IS FLOORED AND CEILINGED AGAINST CONFIG BELOW. This is the
  --       load-bearing one. 1 and 2 raise the price of the attack; only the
  --       floor makes the outcome of a successful attack harmless, because no
  --       median — poisoned, empty, or honest — can put Meridian below
  --       meridian_base_floor or above max_tariff_per_unit_hop.
  --
  -- ⚠ `jsonb_typeof(...) = 'number'` rather than a bare cast: one row whose
  --   base is the JSON STRING "5" would make `::numeric` raise 22P02 and every
  --   quote in the game would start throwing. The tariff CHECK in §1 validates
  --   on ADD so such a row cannot exist today; this survives a future migration
  --   that drops it. sql/037's lesson — the expression does not return null.
  select percentile_cont(0.5) within group (
           order by least(greatest((c.tariff->>'base')::numeric, 0),
                          v_cfg.max_tariff_per_unit_hop))
    into v_median
    from public.transport_companies c
   where c.status = 'open'
     and jsonb_typeof(c.tariff->'base') = 'number'
     and (c.tariff->>'base')::numeric > 0
     and exists (select 1 from public.transport_contracts k
                  where k.carrier_id = c.id and k.status = 'delivered');

  -- greatest() first, then least(): with no trading carrier at all the median
  -- is null and the floor is the answer, which is also the launch-day case —
  -- design §5.1 requires Meridian to quote before any carrier exists, because a
  -- player who cannot move cargo on day one is the exact end-of-game the NPC is
  -- there to prevent.
  v_mer_base  := least(greatest(coalesce(v_median, v_cfg.meridian_base_floor),
                                v_cfg.meridian_base_floor),
                       v_cfg.max_tariff_per_unit_hop) * v_cfg.meridian_tariff_mult;
  v_mer_price := ceil(v_mer_base * v_units * v_hops);
  v_mer_eta   := ceil(v_hops * v_cfg.minutes_per_hop * v_cfg.meridian_time_mult);

  -- Risk is server-owned in both branches. A caller-chosen risk_pct is free
  -- insurance: set it to 0 and 'lost' becomes unreachable, which also makes the
  -- escort — the thing a carrier sells on top of the tariff — unsellable.
  v_risk := least(v_cfg.max_risk_pct, ceil(v_hops * v_cfg.risk_pct_per_hop))::int;

  -- 🔴 NEITHER BRANCH RETURNS. They set v_price / v_eta and fall through to the
  --    single exit below, and that structure IS the fix for a shipped bug: the
  --    Meridian branch used to `return` here, ABOVE the max_price_per_contract
  --    guard, so the one quote no player controls was the one quote with no
  --    price cap on it. Measured: 7,500,000,000 returned ok:true against a cap
  --    of 5,000,000 — the cap was in the file, and unreachable from the path
  --    that needed it most. A refusal branch that a code path can step over is
  --    not a refusal, so there is now no path that can step over it.
  if p_carrier_id is null then
    -- Meridian: no escort, ever (design §5.1). A caller asking for one is not
    -- refused, because refusing would make the fallback carrier fail in exactly
    -- the situation it exists to cover; the flag comes back false so the UI can
    -- say so instead of quietly charging for something it did not sell.
    v_kind  := 'meridian';
    v_price := v_mer_price;
    v_eta   := v_mer_eta;
  else
    select * into v_co from public.transport_companies where id = p_carrier_id;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'no_such_carrier');
    end if;
    if v_co.status <> 'open' then
      return jsonb_build_object('ok', false, 'error', 'carrier_closed',
                                'status', v_co.status);
    end if;

    -- Reach. design §2b: radius = 3 + depot level, and "no depot in reach of
    -- both endpoints ⇒ you cannot quote that route" is what stops one player
    -- owning the planet from a single tile. Read through transport_caps (§2),
    -- which is the one place that ladder is evaluated. With no node graph the
    -- server can only check the hop COUNT against the reach, not that the
    -- endpoints are really that far apart — a bound, not a recomputation.
    v_reach := (public.transport_caps(v_co.id)->>'reach')::int;
    if v_hops > v_reach then
      return jsonb_build_object('ok', false, 'error', 'out_of_reach',
                                'reach', v_reach, 'hops', v_hops);
    end if;

    -- The carrier's own sheet, clamped AGAIN at read time. tco_ins clamps it on
    -- the way in and transport_set_sheet clamps every change; this third clamp
    -- is what protects a row written before a ceiling was LOWERED, which is the
    -- one case the other two cannot cover — they run at write time, and a
    -- ceiling tuned down after an incident does not rewrite history.
    v_base := least(greatest(coalesce((v_co.tariff->>'base')::numeric, 0), 0),
                    v_cfg.max_tariff_per_unit_hop);
    if v_base <= 0 then
      return jsonb_build_object('ok', false, 'error', 'no_tariff_published');
    end if;

    if coalesce(p_escort, false) then
      v_escort := true;
      v_escort_pct := least(greatest(coalesce((v_co.tariff->>'escort_pct')::numeric, 0), 0), 100);
      v_risk := floor(v_risk * (100 - v_cfg.escort_risk_cut_pct) / 100.0)::int;
    end if;

    v_kind  := 'player';
    v_price := ceil(v_base * v_units * v_hops * (1 + v_escort_pct / 100.0));
    v_eta   := v_hops * v_cfg.minutes_per_hop;
    v_rel   := v_co.reliability;

    -- 🔴 THE TARIFF CAP IS THE NPC RATE (design §5.2), and it CLAMPS rather
    --    than refuses. Rejected: returning 'tariff_above_ceiling' and making
    --    the shipper wait for the carrier to fix their sheet — that punishes
    --    the one party who cannot fix it. Clamped, a monopolist can charge
    --    right up to Meridian and get rich, and still wins the sale, because at
    --    equal price they are 1.6x faster and can sell an escort. That is the
    --    ratified shape: keep the monopoly's power, remove its kill switch.
    if v_price > v_mer_price then
      v_price := v_mer_price;
      v_capped := true;
    end if;
  end if;

  -- 🔴 THE SINGLE EXIT, AND THE ONLY PLACE A PRICE LEAVES THIS FUNCTION.
  --    Both branches pass through this guard. With the median floored and
  --    ceilinged above, the worst reachable Meridian base is
  --    max_tariff_per_unit_hop x meridian_tariff_mult, so the largest quote
  --    this function can now build is that x max_units x max_hops — which is
  --    still over the cap, and is now REFUSED rather than returned. Bounded and
  --    then checked; neither alone was enough.
  if v_price > v_cfg.max_price_per_contract then
    return jsonb_build_object('ok', false, 'error', 'over_price_cap',
                              'carrier', v_kind,
                              'price', v_price, 'cap', v_cfg.max_price_per_contract,
                              'units', v_units, 'hops', v_hops);
  end if;

  return jsonb_build_object(
    'ok', true, 'carrier', v_kind, 'carrier_id', p_carrier_id,
    'price', v_price, 'eta_minutes', v_eta, 'risk_pct', v_risk,
    'escort', v_escort, 'capped', v_capped, 'hops', v_hops, 'units', v_units,
    'reliability', v_rel,
    'meridian', jsonb_build_object('price', v_mer_price, 'eta_minutes', v_mer_eta));
end;
$function$;

revoke all on function public.transport_quote(uuid, text, text, integer, numeric, boolean) from public, anon;
grant execute on function public.transport_quote(uuid, text, text, integer, numeric, boolean) to authenticated;


-- ── 4.2 · transport_dispatch — the shipper hires, and pays ────────────────
-- The caller IS the shipper. There is NO parameter naming a user, and no
-- parameter naming a price: RUN_016's rule, and sql/015's postmortem of what
-- happens without it.
--
-- 🔴 THE ORDER OF THE LEGS, and the reason it is that order. Two things change
--    state: the rig's run counter (a column this file owns) and the shipper's
--    Cinder (a column it does not). The undoable leg goes FIRST and the
--    un-undoable leg goes LAST:
--      1. free checks — carrier open, not blacklisted, quote priced
--      2. bay claim   — serialised by the `for update` on the charter row
--      3. run claim   — one statement whose WHERE clause is the guard
--      4. the charge  — wallet_charge, whose own WHERE clause is ITS guard
--      5. the insert  — the contract
--    If (4) fails, (3) is handed back explicitly in the same transaction. It
--    cannot be handed back the other way round: the only server function that
--    mints Cinder credits auth.uid(), which mid-dispatch is the shipper, and
--    sql/034 is emphatic that it is a bounded stopgap and not a refund path.
--    If (5) fails — a client_ref collision from a genuine double-send — the
--    raise rolls back (4) as well, because a function body is one transaction.
--    So the only way to be charged is to end up holding a contract.
create or replace function public.transport_dispatch(
  p_carrier_id uuid,
  p_rig_id     uuid,
  p_from_node  text,
  p_to_node    text,
  p_hops       integer,
  p_units      numeric,
  p_cargo      jsonb,
  p_escort     boolean,
  p_client_ref text
) returns jsonb
language plpgsql security definer set search_path = public as $function$
declare
  v_uid    uuid := auth.uid();
  v_cfg    public.transport_config%rowtype;
  v_co     public.transport_companies%rowtype;
  v_rig    public.transport_rigs%rowtype;
  v_prev   public.transport_contracts%rowtype;
  v_q      jsonb;
  v_ref    text;
  v_today  text;
  v_bays   int;
  v_busy   int;
  v_ok     boolean;
  v_price  numeric;
  v_eta    int;
  v_risk   int;
  v_charge record;
  v_no_wallet boolean := false;
  v_id     uuid;
  v_rig_id uuid;
  v_arrive timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select * into v_cfg from public.transport_config where id = 1;
  if not found or not v_cfg.enabled then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;

  if p_cargo is null or jsonb_typeof(p_cargo) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'bad_cargo');
  end if;
  -- Bounded so a manifest cannot be used as free storage on a table the carrier
  -- is entitled to read.
  if pg_column_size(p_cargo) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'cargo_too_large',
                              'bytes', pg_column_size(p_cargo), 'max_bytes', 2000);
  end if;

  -- RETRY GUARD, checked BEFORE anything is claimed or charged. RUN_016's
  -- shape: "Already handled? Return the existing membership rather than
  -- erroring, so a double-click or a retry after a dropped connection is
  -- harmless." A dispatch that succeeded server-side and lost its response on
  -- the way home is the same event, and the second call must hand back the
  -- contract the shipper already paid for rather than sell them another one.
  -- ⚠ A CALLER THAT SENDS NO REF GETS A FRESH UUID AND THEREFORE NO RETRY
  --   PROTECTION AT ALL — the second call cannot match the first and buys a
  --   second haul. sql/035's rule is the one to follow: "Never retry a credit
  --   without one." The default exists so the column is never null and the
  --   partial unique index stays meaningful, not so retries can skip it.
  v_ref := left(coalesce(nullif(p_client_ref, ''), gen_random_uuid()::text), 64);
  select * into v_prev from public.transport_contracts
   where shipper_id = v_uid and client_ref = v_ref;
  if found then
    return jsonb_build_object('ok', true, 'retried', true,
                              'contract_id', v_prev.id, 'price', v_prev.price,
                              'status', v_prev.status, 'arrive_at', v_prev.arrive_at,
                              'risk_pct', v_prev.risk_pct);
  end if;

  -- THE PRICE IS THE QUOTE. Not recomputed, not accepted, not adjusted. Every
  -- refusal transport_quote can produce (bad_hops, bad_units, out_of_reach,
  -- over_price_cap, no_tariff_published…) is returned verbatim, so a route the
  -- board would not quote is a route this cannot dispatch.
  --
  -- ⚠ The quote is taken BEFORE the charter row is locked below, so a tariff
  --   edited in the moment between the two is not applied to this haul. That is
  --   deliberate and it is the harmless direction: the shipper is charged the
  --   price they were shown. Locking first and quoting inside the lock would
  --   let a carrier raise their rate underneath a confirm dialog.
  v_q := public.transport_quote(p_carrier_id, p_from_node, p_to_node,
                                p_hops, p_units, p_escort);
  if not coalesce((v_q->>'ok')::boolean, false) then
    return v_q;
  end if;
  v_price := (v_q->>'price')::numeric;
  v_eta   := (v_q->>'eta_minutes')::int;
  v_risk  := (v_q->>'risk_pct')::int;

  -- 🔒 MERIDIAN HAULS NO PLAYER'S RIG, and dropping the id here is a fix, not
  --    tidiness. In the player branch the run-claim below proves the rig is in
  --    that carrier's fleet (`r.company_id = p_carrier_id`); the NPC branch has
  --    no such proof, so a rig id sent alongside a null carrier would be
  --    written onto the contract unchecked — and transport_settle sets that
  --    rig's status back to 'idle' on arrival. A stranger could then free a
  --    busy carrier's bay by booking a Meridian haul against their rig.
  v_rig_id := case when p_carrier_id is null then null else p_rig_id end;

  v_today  := to_char((now() at time zone 'utc')::date, 'YYYY-MM-DD');
  v_arrive := now() + make_interval(mins => v_eta);

  if p_carrier_id is not null then
    -- Lock the charter. This is the bay allocator: every dispatch to this
    -- carrier serialises here, so two shippers cannot both take the last bay.
    select * into v_co from public.transport_companies where id = p_carrier_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'no_such_carrier');
    end if;
    if v_co.status <> 'open' then
      return jsonb_build_object('ok', false, 'error', 'carrier_closed', 'status', v_co.status);
    end if;

    -- ⚠ A BLOCKED DISPATCH WRITES NO ROW. Rejected design: recording every
    --   blocked attempt as a status='refused' contract, so that design §5.3's
    --   "each refusal is public and drops reliability" would be automatic. It
    --   loses because attempting a dispatch is free — a rival could loop this
    --   function against any carrier and destroy their public reliability from
    --   a script. A refusal is only evidence if making one costs the shipper
    --   something, and nothing here does. Hence 'refused' exists in the status
    --   ladder and nothing produces it yet.
    if v_uid = any (coalesce(v_co.blacklist, '{}'::uuid[])) then
      return jsonb_build_object('ok', false, 'error', 'blacklisted',
                                'carrier_id', v_co.id);
    end if;

    -- Through transport_caps (§2), not a fourth copy of `2 * depot_level`. The
    -- number the owner's UI prints and the number that refuses a haul have to
    -- be the same number, and the only way to guarantee that is for there to be
    -- one of them.
    v_bays := (public.transport_caps(p_carrier_id)->>'bays')::int;
    select count(*) into v_busy from public.transport_contracts
     where carrier_id = p_carrier_id and status = 'in_transit';
    if v_busy >= v_bays then
      return jsonb_build_object('ok', false, 'error', 'no_free_bay',
                                'bays', v_bays, 'in_transit', v_busy, 'remaining', 0);
    end if;

    if p_rig_id is null then
      return jsonb_build_object('ok', false, 'error', 'no_rig_chosen');
    end if;

    -- 🔴 THE RUN CLAIM IS ONE STATEMENT, AND ITS WHERE CLAUSE IS THE
    --    CONCURRENCY GUARD, not just the eligibility test. sql/037 puts the
    --    affordability test inside the WHERE for the same reason: "this is the
    --    concurrency guard as well as the affordability check, so two calls
    --    cannot both overdraw." Read-then-write here would let two dispatches
    --    both see runs_used = 9 against a cap of 10 and both spend the tenth.
    --
    -- 🔴 day_key COMES FROM THE DATABASE CLOCK AND IS NEVER A PARAMETER.
    --    getTodayKey() (index.html:71039) builds its key from `new Date()` on
    --    the DEVICE, in local time. That is fine for _convoyState(), where the
    --    only person a wrong day cheats is yourself — but a carrier is being
    --    paid by other players here, so a clock the payee controls is a fraud
    --    lever: set the device forward, the key rolls, the counter resets, and
    --    the fleet runs all day. It is also wrong by accident across
    --    timezones, where two honest players disagree about what day it is.
    --    The `case` is the reset: a rig whose key is not today starts at 1.
    update public.transport_rigs r
       set runs_used = case when r.day_key = v_today then r.runs_used + 1 else 1 end,
           day_key   = v_today,
           status    = 'hauling'
     where r.id = p_rig_id
       and r.company_id = p_carrier_id
       and r.status in ('idle', 'hauling')
       and r.assigned_to is null
       and (r.day_key is distinct from v_today
            or r.runs_used < least(r.runs_cap, v_cfg.max_runs_per_rig))
    returning true into v_ok;

    if not coalesce(v_ok, false) then
      -- Re-read to say WHICH refusal it was. "This rig cannot run" is the kind
      -- of message index.html:79921 is a monument to.
      select * into v_rig from public.transport_rigs where id = p_rig_id;
      if not found then
        return jsonb_build_object('ok', false, 'error', 'no_such_rig');
      elsif v_rig.company_id <> p_carrier_id then
        return jsonb_build_object('ok', false, 'error', 'rig_not_in_fleet');
      elsif v_rig.assigned_to is not null then
        return jsonb_build_object('ok', false, 'error', 'rig_on_deployment',
                                  'assigned_to', v_rig.assigned_to);
      elsif v_rig.status = 'retired' then
        return jsonb_build_object('ok', false, 'error', 'rig_retired');
      end if;
      return jsonb_build_object('ok', false, 'error', 'rig_out_of_runs',
                                'cap', least(v_rig.runs_cap, v_cfg.max_runs_per_rig),
                                'used', v_rig.runs_used, 'remaining', 0,
                                'day_key', v_today);
    end if;
  end if;

  -- THE CHARGE. wallet_charge (sql/023) is the sanctioned spend path: it debits
  -- the canonical wallet, mirrors user_profiles.gems on the way DOWN, bumps
  -- wallet_seq so the client's protective MAX stays in step, and writes its own
  -- audit row. Raw arithmetic on a balance column here would bypass all four.
  -- Its own atomic deduct is the affordability guard, so an underfunded shipper
  -- cannot overdraw even against a concurrent spend elsewhere in the game.
  --
  -- ⚠ WRAPPED, AND THE ERROR CODE IS DISTINCT ON PURPOSE. This is the one
  --   function in the file that lives in another migration (sql/023). If 023
  --   was never applied the raw failure is `function public.wallet_charge(…)
  --   does not exist` — and index.html:79921 is four wasted debugging sessions
  --   proving what that string does to a reader: "'does not exist' does NOT
  --   mean the RPC is missing. It also fires when the function EXISTS but a
  --   table INSIDE it does not." A dispatch that fails this way must say WHICH
  --   thing is missing, not hand the client a string that has already misled
  --   this project once.
  begin
    select * into v_charge from public.wallet_charge(v_price::bigint,
                                                     'Freight — ' || left(coalesce(p_from_node,'?'), 12)
                                                     || '→' || left(coalesce(p_to_node,'?'), 12));
  exception when undefined_function then
    v_no_wallet := true;
    -- v_charge MUST be assigned on this path. plpgsql does not guarantee that
    -- `or` short-circuits, so a later `v_charge.ok` would raise "record
    -- v_charge is not assigned yet" and replace a legible refusal with a crash.
    -- Same column names and same order wallet_charge itself returns.
    select 0::bigint as new_balance, 0::bigint as tax_amount, false as ok,
           'wallet_rpc_missing'::text as reason, 0::bigint as wallet_seq
      into v_charge;
  end;

  if v_no_wallet or not coalesce(v_charge.ok, false) then
    -- UNWIND THE RUN, in reverse order of the claims and in the same
    -- transaction. Without this a shipper who cannot afford a haul silently
    -- burns one of the CARRIER'S runs for the day — a stranger's resource,
    -- destroyed by a failed purchase they never agreed to. It runs for the
    -- missing-wallet case too: nothing was charged there either.
    if v_rig_id is not null then
      update public.transport_rigs
         set runs_used = greatest(0, runs_used - 1),
             status    = 'idle'
       where id = v_rig_id and day_key = v_today;
    end if;
    if v_no_wallet then
      return jsonb_build_object('ok', false, 'error', 'wallet_rpc_missing',
                                'needed', v_price, 'run_sql', 'sql/023_boe_canonical_wallet.sql');
    end if;
    return jsonb_build_object('ok', false, 'error', 'insufficient_cinder',
                              'needed', v_price, 'balance', coalesce(v_charge.new_balance, 0),
                              'reason', coalesce(v_charge.reason, 'insufficient'));
  end if;

  insert into public.transport_contracts
    (carrier_id, rig_id, shipper_id, from_node, to_node, hops, units, cargo,
     price, escort, risk_pct, depart_at, arrive_at, status, client_ref)
  values
    (p_carrier_id, v_rig_id, v_uid,
     left(coalesce(p_from_node, ''), 40), left(coalesce(p_to_node, ''), 40),
     (v_q->>'hops')::int, (v_q->>'units')::numeric, p_cargo,
     v_price, coalesce((v_q->>'escort')::boolean, false), v_risk,
     now(), v_arrive, 'in_transit', v_ref)
  returning id into v_id;

  return jsonb_build_object(
    'ok', true, 'retried', false, 'contract_id', v_id,
    'carrier', v_q->>'carrier', 'carrier_id', p_carrier_id,
    'price', v_price, 'capped', coalesce((v_q->>'capped')::boolean, false),
    'risk_pct', v_risk, 'escort', coalesce((v_q->>'escort')::boolean, false),
    'depart_at', now(), 'arrive_at', v_arrive, 'eta_minutes', v_eta,
    'balance', coalesce(v_charge.new_balance, 0), 'client_ref', v_ref);
end;
$function$;

revoke all on function public.transport_dispatch(uuid, uuid, text, text, integer, numeric, jsonb, boolean, text) from public, anon;
grant execute on function public.transport_dispatch(uuid, uuid, text, text, integer, numeric, jsonb, boolean, text) to authenticated;


-- ── 4.3 · transport_settle — arrival, outcome and the ledger row ──────────
-- Takes a contract id and NOTHING ELSE. Not an outcome, not an amount, not a
-- payee: the price is read back off the contract row, the payee is that row's
-- carrier, and whether the cargo arrived is rolled here against the risk_pct
-- the server itself wrote at dispatch.
--
-- 🔴 WHY THE OUTCOME CANNOT BE A PARAMETER. The two parties want opposite
--    answers — the carrier is paid for 'delivered', the shipper keeps their
--    reliability leverage with 'lost' — so whichever one is allowed to say
--    always says the same thing. Server-rolled, it is a real risk, and the
--    escort a carrier sells on top of the tariff has something to protect
--    against.
--
-- 🔴 THE CLOCK IS THE SERVER'S. now() < arrive_at refuses, so no client can
--    land a haul early by moving its own clock — the same reasoning that moved
--    world chat's rate limit into chat_send() at v120g0.
--
-- Either party may settle, because arrival is offline-safe: frConvoyTick()
-- resolves convoys that landed while the player was away, and whichever of the
-- two logs in first should be able to close the haul.
create or replace function public.transport_settle(p_contract_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $function$
declare
  v_uid    uuid := auth.uid();
  v_ct     public.transport_contracts%rowtype;
  v_status text;
  v_paid   numeric := 0;
  v_bal    numeric := 0;
  v_secs   numeric;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  -- `for update`. Two clients settling the same contract race to this lock; the
  -- loser then reads a status that is no longer 'in_transit' and takes the
  -- already-settled branch. Without the lock both would read 'in_transit' and
  -- both would insert a freight row — which the unique index in §1 would then
  -- reject, but as an opaque 23505 rather than a clean answer.
  select * into v_ct from public.transport_contracts where id = p_contract_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_such_contract');
  end if;

  if v_ct.shipper_id <> v_uid
     and not (v_ct.carrier_id is not null and public.is_transport_owner(v_ct.carrier_id)) then
    return jsonb_build_object('ok', false, 'error', 'not_your_contract');
  end if;

  -- Already settled? Hand back what happened rather than erroring. A settle
  -- retried after a dropped connection must be harmless, and an error here
  -- would read to the client as "the delivery failed" for a haul that landed.
  if v_ct.status <> 'in_transit' then
    select coalesce(sum(amount), 0) into v_paid
      from public.transport_ledger where contract_id = v_ct.id;
    return jsonb_build_object('ok', true, 'retried', true,
                              'contract_id', v_ct.id, 'status', v_ct.status,
                              'amount', v_paid, 'settled_at', v_ct.settled_at);
  end if;

  if now() < v_ct.arrive_at then
    v_secs := extract(epoch from (v_ct.arrive_at - now()));
    return jsonb_build_object('ok', false, 'error', 'still_in_transit',
                              'arrive_at', v_ct.arrive_at,
                              'seconds_remaining', ceil(v_secs));
  end if;

  -- The roll. random() is per-call and server-side; there is no seed a client
  -- can influence and no way to re-roll, because the status flip below is what
  -- makes this branch unreachable a second time.
  if (random() * 100.0) < coalesce(v_ct.risk_pct, 0) then
    v_status := 'lost';
  else
    v_status := 'delivered';
  end if;

  -- ⚠ A LOST HAUL DOES NOT REFUND THE SHIPPER, and that is a design decision
  --   rather than an omission. Rejected: auto-refunding the fee on 'lost'. It
  --   loses because it makes route risk free for the shipper and leaves the
  --   carrier as the only party exposed to it — at which point the cheapest,
  --   least reliable carrier is always the rational hire and the rate board
  --   stops being a choice between price and safety, which is the entire game
  --   in design §5. The shipper's protections are picking a reliable carrier
  --   and buying an escort, and both cost money on purpose.
  --   (It also cannot be implemented from here: refunding means crediting a
  --   wallet, and see the header on why this file does not do that.)
  if v_status = 'delivered' and v_ct.carrier_id is not null then
    -- The amount is the contract's own price. Never a parameter, never
    -- recomputed — recomputing could disagree with what the shipper paid, and
    -- a payout that disagrees with its charge is the bug sql/015 §4 exists for.
    insert into public.transport_ledger (company_id, contract_id, amount, kind, memo)
    values (v_ct.carrier_id, v_ct.id, v_ct.price, 'freight',
            left(coalesce(v_ct.from_node, '?') || '→' || coalesce(v_ct.to_node, '?'), 120));
  end if;

  update public.transport_contracts
     set status = v_status, settled_at = now()
   where id = v_ct.id;

  -- Release the rig and the bay. `status <> 'retired'` so settling a haul does
  -- not resurrect a rig its owner retired mid-route.
  if v_ct.rig_id is not null then
    update public.transport_rigs
       set status = 'idle'
     where id = v_ct.rig_id and status <> 'retired';
  end if;

  if v_ct.carrier_id is not null then
    -- 🔴 RELIABILITY IS RECOMPUTED FROM THE CONTRACT ROWS, WHICH ARE THE
    --    AUTHORITY. It is never incremented, never taken from a caller, and
    --    never UPDATEd to a value anyone supplied — this whole statement reads
    --    only from transport_contracts. The column is a cache so the rate board
    --    can ORDER BY it; if it is ever wrong, re-running this expression
    --    against the contract rows is the fix, and the contract rows cannot be
    --    edited by anyone (§3).
    --    This UPDATE lands despite the revoked grant and the absent policy in
    --    §3, because SECURITY DEFINER runs as the function owner and outside
    --    RLS. That asymmetry is the point: the server may write it, no client
    --    may.
    update public.transport_companies c
       set reliability = (
             select case when count(*) = 0 then null
                    else round(100.0 * count(*) filter (where k.status = 'delivered')
                               / count(*), 1) end
               from public.transport_contracts k
              where k.carrier_id = c.id
                and k.status in ('delivered', 'late', 'lost', 'refused')
           )
     where c.id = v_ct.carrier_id;

    -- Balance is sum(amount). There is no balance column to read instead.
    select coalesce(sum(amount), 0) into v_bal
      from public.transport_ledger where company_id = v_ct.carrier_id;
  end if;

  return jsonb_build_object(
    'ok', true, 'retried', false, 'contract_id', v_ct.id, 'status', v_status,
    'amount', case when v_status = 'delivered' and v_ct.carrier_id is not null
                   then v_ct.price else 0 end,
    'carrier_id', v_ct.carrier_id, 'carrier_balance', v_bal,
    'risk_pct', v_ct.risk_pct, 'settled_at', now());
end;
$function$;

revoke all on function public.transport_settle(uuid) from public, anon;
grant execute on function public.transport_settle(uuid) to authenticated;


-- ── 4.4 · transport_repair — the only way condition ever moves up ─────────
-- Takes a rig id. No cost, no target condition, no step count.
--
-- 🔴 WHY THIS IS AN RPC AT ALL: condition feeds the runs ladder, and UPDATE on
--    the fleet table is revoked (§3), so there is no other path. A client that
--    could write `condition` could write itself a Pristine Mythic and, with it,
--    the maximum runs per day.
--
-- 🔴 WHY IT MOVES NO MONEY. A repair bill is pricing, and CLAUDE.md names
--    _opEcon() as the only place pricing lives; a repair_fee column in
--    transport_config would be a second authority with no rule for which one
--    wins. Design §4 also pays for repairs in PP_PARTS-mapped resources, which
--    live in Profile.salvage — a client blob the server cannot read, let alone
--    debit. So the parts and the bill are charged client-side and the server
--    cannot verify either.
--    ⚠ THAT IS A REAL HOLE AND IT IS BOUNDED, NOT CLOSED: a client that skips
--      the payment gets free repairs, and free repairs mean more runs per day
--      on a rig other players are paying to use. The bound is
--      max_repairs_per_rig_day, enforced below with the same day-key guard the
--      run counter uses. Do not read this function as verifying a repair was
--      paid for.
create or replace function public.transport_repair(p_rig_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $function$
declare
  v_uid    uuid := auth.uid();
  v_cfg    public.transport_config%rowtype;
  v_rig    public.transport_rigs%rowtype;
  v_today  text;
  v_i      int;
  v_next   text;
  v_ok     boolean;
  -- Worst to best, PP_COND_MULT's exact keys (index.html:195340). 'Salvage' is
  -- deliberately NOT in the repairable ladder: design §4 says a rig that hits
  -- Salvage is finished as freight — strip it or sell it on the P2P market.
  c_ladder constant text[] := array['Wrecked','Battered','Worn','Clean','Pristine'];
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select * into v_cfg from public.transport_config where id = 1;
  if not found or not v_cfg.enabled then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;

  select * into v_rig from public.transport_rigs where id = p_rig_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_such_rig');
  end if;
  if not public.is_transport_owner(v_rig.company_id) then
    return jsonb_build_object('ok', false, 'error', 'not_your_rig');
  end if;
  if v_rig.status = 'hauling' then
    return jsonb_build_object('ok', false, 'error', 'rig_in_transit');
  end if;
  if v_rig.condition = 'Salvage' then
    return jsonb_build_object('ok', false, 'error', 'rig_is_salvage');
  end if;

  v_i := array_position(c_ladder, v_rig.condition);
  if v_i is null or v_i >= array_length(c_ladder, 1) then
    return jsonb_build_object('ok', false, 'error', 'not_damaged',
                              'condition', v_rig.condition);
  end if;
  v_next := c_ladder[v_i + 1];

  -- One statement again: the daily cap guard and the rung step together, so a
  -- double-click cannot buy two rungs for one repair. Same `case` reset and the
  -- same database clock as the run counter — for the same reason, since a rig's
  -- condition is what its runs cap is derived from.
  v_today := to_char((now() at time zone 'utc')::date, 'YYYY-MM-DD');
  update public.transport_rigs r
     set repairs_used = case when r.repair_day = v_today then r.repairs_used + 1 else 1 end,
         repair_day   = v_today,
         condition    = v_next
   where r.id = p_rig_id
     and r.condition = v_rig.condition
     and (r.repair_day is distinct from v_today
          or r.repairs_used < v_cfg.max_repairs_per_rig_day)
  returning true into v_ok;

  if not coalesce(v_ok, false) then
    return jsonb_build_object('ok', false, 'error', 'repair_cap',
                              'cap', v_cfg.max_repairs_per_rig_day,
                              'used', v_rig.repairs_used, 'remaining', 0,
                              'day_key', v_today);
  end if;

  -- ⚠ NOTHING IN THIS FILE MOVES condition DOWNWARD. Design §4's "one step per
  --   25 runs, faster on high-risk routes" is not implemented server-side, and
  --   it deliberately does not belong inside transport_dispatch: degrading a
  --   rig mid-dispatch would change the runs cap of a haul that was already
  --   quoted and priced. When it moves server-side it wants its own function
  --   and its own migration.
  return jsonb_build_object('ok', true, 'rig_id', p_rig_id,
                            'condition', v_next, 'was', v_rig.condition,
                            'cap', v_cfg.max_repairs_per_rig_day,
                            'used', least(v_cfg.max_repairs_per_rig_day,
                                          case when v_rig.repair_day = v_today
                                               then v_rig.repairs_used + 1 else 1 end));
end;
$function$;

revoke all on function public.transport_repair(uuid) from public, anon;
grant execute on function public.transport_repair(uuid) to authenticated;


-- ── 4.5 · transport_set_sheet — the setter the missing UPDATE policy needs ─
-- 🔴 THIS FUNCTION IS WHY §3 CAN REVOKE UPDATE ON THE CHARTER TABLE. RLS has no
--    column granularity; an RPC does. The columns an owner may move are the
--    four parameters below and there is no fifth, so reliability, owner_id,
--    created_at and home_node_id are unreachable from any client — not because
--    a comment says they are, but because no statement here names them.
--
-- Every parameter is nullable and means "leave this alone", so the client can
-- send one field without round-tripping the others and racing itself.
create or replace function public.transport_set_sheet(
  p_company_id  uuid,
  p_tariff      jsonb,
  p_status      text,
  p_depot_level integer,
  p_blacklist   uuid[]
) returns jsonb
language plpgsql security definer set search_path = public as $function$
declare
  v_uid   uuid := auth.uid();
  v_cfg   public.transport_config%rowtype;
  v_co    public.transport_companies%rowtype;
  v_clean jsonb;
  v_status text;
  v_lvl   int;
  v_black uuid[];
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select * into v_cfg from public.transport_config where id = 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;

  -- Ownership is read fresh from the row, never taken from an argument, and the
  -- lock makes two tabs editing the same sheet resolve in an order rather than
  -- interleaving. RUN_016: "Read it fresh; never trust input."
  select * into v_co from public.transport_companies where id = p_company_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_such_carrier');
  end if;
  if v_co.owner_id <> v_uid then
    return jsonb_build_object('ok', false, 'error', 'not_your_company');
  end if;

  -- THE CLAMP IS HERE, on the server, against transport_config. Unknown keys
  -- are DROPPED rather than stored (sql/015's shape), so a hand-built RPC call
  -- cannot smuggle a fourth rate class past the CHECK constraint in §1 and into
  -- a pricing path that would then ignore it anyway.
  v_clean := v_co.tariff;
  if p_tariff is not null then
    if jsonb_typeof(p_tariff) <> 'object' then
      return jsonb_build_object('ok', false, 'error', 'bad_tariff');
    end if;
    select jsonb_object_agg(k, v) into v_clean from (
      select 'base' as k,
             least(greatest(coalesce((p_tariff->>'base')::numeric, 0), 0),
                   v_cfg.max_tariff_per_unit_hop) as v
      union all select 'escort_pct',
             least(greatest(coalesce((p_tariff->>'escort_pct')::numeric, 0), 0), 100)
      union all select 'illicit_pct',
             least(greatest(coalesce((p_tariff->>'illicit_pct')::numeric, 0), 0), 200)
    ) t;
  end if;

  v_status := coalesce(nullif(p_status, ''), v_co.status);
  if v_status not in ('open', 'paused', 'closed') then
    return jsonb_build_object('ok', false, 'error', 'bad_status');
  end if;

  -- Bounded by the building's own maxLevel (design §2b), and it is still a
  -- claim — the depot lives in the city blob. It buys bays and fleet slots, so
  -- transport_dispatch caps what it can buy against max_bays regardless.
  v_lvl := greatest(1, least(3, coalesce(p_depot_level, v_co.depot_level)));

  -- ⚠ THE ONE PLACE A USER ID LEGITIMATELY CROSSES THIS BOUNDARY AS AN
  --   ARGUMENT, and it is safe for a specific reason rather than by exception:
  --   this list can only ever REDUCE the caller's own business. It moves no
  --   money, names nobody else's row, and every id in it is a shipper this
  --   carrier is choosing not to serve. Length-capped so it cannot become a
  --   1e6-element array on a publicly readable row.
  v_black := coalesce(p_blacklist, v_co.blacklist, '{}'::uuid[]);
  if array_length(v_black, 1) > 200 then
    return jsonb_build_object('ok', false, 'error', 'blacklist_too_long',
                              'max', 200, 'sent', array_length(v_black, 1));
  end if;

  update public.transport_companies
     set tariff = v_clean, status = v_status,
         depot_level = v_lvl, blacklist = v_black
   where id = p_company_id;

  -- Caps are REPORTED from transport_caps, read back AFTER the update, never
  -- recomputed here. This payload is what the owner's Depot screen prints, so
  -- if it were computed locally the UI would advertise a fleet cap and a bay
  -- count that the §2b guard and transport_dispatch might not honour — the shop
  -- advertising a number the engine does not deliver. Same rule the rest of the
  -- file follows for prices: one authority, and the reader is not it.
  return jsonb_build_object('ok', true, 'company_id', p_company_id,
                            'tariff', v_clean, 'status', v_status,
                            'depot_level', v_lvl,
                            'caps', public.transport_caps(p_company_id),
                            'charter_slots_left', public.transport_charter_slots_left(),
                            'blacklist_count', coalesce(array_length(v_black, 1), 0));
end;
$function$;

revoke all on function public.transport_set_sheet(uuid, jsonb, text, integer, uuid[]) from public, anon;
grant execute on function public.transport_set_sheet(uuid, jsonb, text, integer, uuid[]) to authenticated;


-- ─── 5. VERIFY ─────────────────────────────────────────────────────────────
--
-- ⚠ COUNT THEM. sql/015's own verify note: "r9 asserted `policies = 6` when the
--   file created 5, and the mismatch survived into two documents because the
--   query was never run." These are not estimated and not counted off the file
--   by eye either — the query below was RUN, on the throwaway cluster the
--   header describes, and every number here is what it returned.
--     tables   5 — companies, rigs, contracts, ledger, config
--     policies 7 — tco_sel, tco_ins | trg_sel, trg_ins, trg_del | tct_sel |
--                  tld_sel. There is deliberately no *_upd anywhere, no policy
--                  of any kind on the ledger's write commands, and none at all
--                  on config.
--     helpers  4 — is_transport_owner, transport_caps, transport_tariff_ok,
--                  transport_charter_slots_left. Two of the four exist because
--                  a POLICY needs them and would recurse if inlined; all four
--                  read a table no client may read.
--     rpcs     5 — quote, dispatch, settle, repair, set_sheet
--     secdef  11 — all of the above plus the two §2b trigger guards
--     triggers 2 — transport_companies_cap, transport_rigs_cap. THE TWO CAPS
--                  LIVE HERE AND NOWHERE ELSE, so a zero in this column is not
--                  a cosmetic failure: it means the charter cap and the fleet
--                  cap are both unenforced. That is exactly the state two
--                  earlier drafts of this file shipped in.
--     guards   2 — the retry unique indexes: contracts (shipper, client_ref)
--                  and ledger (contract, kind)
--
-- 🔴 THE NEGATIVE ASSERTIONS ARE THE POINT. A verify that only proves the good
--    policies exist never notices the dangerous one that came back. Six of the
--    columns below must read 0:
--      · ledger_balance_cols catches the most likely future mistake — somebody
--        adding a `balance` or `earnings` column to an append-only ledger
--        because summing felt slow.
--      · guards_not_volatile and disabled_triggers between them cover the two
--        ways the §2b guards can stop working without anybody editing this
--        file's logic — one keyword on the function, one ALTER on the table.
--        disabled_triggers catches the second: `alter table … disable
--        trigger` leaves the trigger in pg_trigger, so a count of the triggers
--        alone would still read 2. A restore from a dump taken with
--        --disable-triggers that was never re-enabled looks exactly like this.
--      · over_ceiling_sheets and over_fleet_cap are DATA assertions, not
--        schema ones, and they are here because both of those limits were once
--        stated in this file's header and enforced by nothing. A cap that is
--        only described is invisible in review; a cap with a counting query
--        under it is not.
--        🔴 READ over_fleet_cap AS A HARD 0. It is no longer "0, or 1 after a
--           burst" — that reading belonged to the WITH CHECK draft, whose race
--           this file published as a known limit. The §2b guard takes an
--           advisory lock before it counts, and a re-run of the same burst
--           (12 parallel registrations at a 4-slot charter) now lands exactly
--           4. So a non-zero here has only two innocent explanations, and one
--           guilty one: a ceiling tuned DOWN past rows that already existed
--           (harmless — §4.1 re-clamps every read), a depot_level lowered
--           under a fleet that was legal at the old level (also harmless, and
--           it heals as rigs are retired), or the guard is gone. Check
--           `triggers` and `disabled_triggers` in the same row before
--           concluding anything.
--
-- Expect: tables 5 · policies 7 · helpers 4 · rpcs 5 · secdef 11 · triggers 2 ·
--         guards 2 · no_rig_upd 0 · no_co_upd 0 · no_ledger_write 0 ·
--         no_cfg_pol 0 · disabled_triggers 0 · guards_not_volatile 0 ·
--         ledger_balance_cols 0 · over_ceiling_sheets 0 · over_fleet_cap 0 ·
--         cfg_rows 1
-- Run on an empty database this returned exactly that row, three applications
-- in. On the populated one it returned it too, except for over_fleet_cap — see
-- the header: it read 1 while a deliberately unguarded charter was on the
-- table, which is the only evidence anyone has that the column works.
select
  (select count(*) from pg_tables where schemaname = 'public'
     and tablename in ('transport_companies','transport_rigs',
                       'transport_contracts','transport_ledger','transport_config'))  as tables,
  (select count(*) from pg_policies where schemaname = 'public'
     and tablename in ('transport_companies','transport_rigs',
                       'transport_contracts','transport_ledger','transport_config'))  as policies,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in
       ('is_transport_owner','transport_caps','transport_tariff_ok',
        'transport_charter_slots_left'))                                              as helpers,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in
       ('transport_quote','transport_dispatch','transport_settle',
        'transport_repair','transport_set_sheet'))                                    as rpcs,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.proname in
       ('is_transport_owner','transport_caps','transport_tariff_ok',
        'transport_charter_slots_left','transport_quote','transport_dispatch',
        'transport_settle','transport_repair','transport_set_sheet',
        'transport_charter_cap_guard','transport_fleet_cap_guard'))                    as secdef,
  -- The caps themselves. `not tgisinternal` excludes the FK enforcement
  -- triggers Postgres creates for `references`, which are not ours to count.
  (select count(*) from pg_trigger t join pg_class r on r.oid = t.tgrelid
     join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public' and not t.tgisinternal
      and t.tgname in ('transport_companies_cap','transport_rigs_cap'))                as triggers,
  (select count(*) from pg_indexes where schemaname = 'public'
     and indexname in ('transport_contracts_ref_uniq','transport_ledger_once'))       as guards,
  (select count(*) from pg_policies where schemaname = 'public'
     and tablename = 'transport_rigs' and cmd = 'UPDATE')                              as no_rig_upd,
  (select count(*) from pg_policies where schemaname = 'public'
     and tablename = 'transport_companies' and cmd in ('UPDATE','DELETE'))             as no_co_upd,
  (select count(*) from pg_policies where schemaname = 'public'
     and tablename = 'transport_ledger' and cmd in ('INSERT','UPDATE','DELETE'))       as no_ledger_write,
  (select count(*) from pg_policies where schemaname = 'public'
     and tablename = 'transport_config')                                               as no_cfg_pol,
  -- 'D' is disabled. A disabled trigger is still a trigger in pg_trigger, so
  -- the count above cannot see this and this cannot see a dropped one.
  (select count(*) from pg_trigger t
    where t.tgname in ('transport_companies_cap','transport_rigs_cap')
      and t.tgenabled = 'D')                                                           as disabled_triggers,
  -- 🔴 THE SUBTLEST WAY TO TURN BOTH CAPS OFF, and the one nothing else here
  --    can see. 'v' is volatile. Marked `stable` or `immutable`, a guard's
  --    queries run read-only through SPI, the command counter stops advancing,
  --    and it goes back to counting a pre-statement snapshot — which is exactly
  --    the WITH CHECK failure this file already shipped once. The trigger still
  --    exists, still fires, still passes every other column in this row, and
  --    enforces nothing. See §2b.
  (select count(*) from pg_proc pv join pg_namespace nv on nv.oid = pv.pronamespace
    where nv.nspname = 'public'
      and pv.proname in ('transport_charter_cap_guard','transport_fleet_cap_guard')
      and pv.provolatile <> 'v')                                                       as guards_not_volatile,
  (select count(*) from information_schema.columns where table_schema = 'public'
     and table_name = 'transport_ledger'
     and column_name in ('balance','total','earnings','balance_after'))                as ledger_balance_cols,
  -- The two data assertions. Both must be 0, and both name a limit this file
  -- once only claimed.
  (select count(*) from public.transport_companies c
     where jsonb_typeof(c.tariff->'base') = 'number'
       and (c.tariff->>'base')::numeric
           > (select f.max_tariff_per_unit_hop from public.transport_config f where f.id = 1))
                                                                                       as over_ceiling_sheets,
  (select count(*) from public.transport_companies c
     where (select count(*) from public.transport_rigs r
             where r.company_id = c.id and r.status <> 'retired')
           > (public.transport_caps(c.id)->>'fleet_cap')::int)                         as over_fleet_cap,
  (select count(*) from public.transport_config where id = 1)                          as cfg_rows;

-- ─── 5b. DATA STATE ────────────────────────────────────────────────────────
-- One row per carrier. Read it after any incident. PASS CONDITIONS:
--   · `drift` must be 0 for every row — it is the cached reliability minus the
--     value recomputed live from the contract rows, and the contract rows are
--     the authority. Anything non-zero means a settle failed after writing the
--     contract, or somebody wrote the cache by hand.
--   · `stuck_in_transit` counts hauls whose arrival time has passed and which
--     nobody has settled. A steady non-zero here is not corruption — it is the
--     offline-arrival case — but a number that only grows means no client is
--     calling transport_settle.
--   · `owed` is coalesce(sum(amount),0) over the ledger and is the ONLY way a
--     balance is ever read here. Until the cash-out RPC exists (see the header)
--     it is a claim, not cash, and it should equal the sum of that carrier's
--     delivered prices exactly.
select c.id, c.name, c.status, c.depot_level,
       (select count(*) from public.transport_rigs r where r.company_id = c.id)             as rigs,
       (select count(*) from public.transport_contracts k
         where k.carrier_id = c.id and k.status = 'in_transit')                             as in_transit,
       (select count(*) from public.transport_contracts k
         where k.carrier_id = c.id and k.status = 'in_transit' and k.arrive_at < now())     as stuck_in_transit,
       (select count(*) from public.transport_contracts k
         where k.carrier_id = c.id and k.status = 'delivered')                              as delivered,
       (select count(*) from public.transport_contracts k
         where k.carrier_id = c.id and k.status = 'lost')                                   as lost,
       c.reliability,
       coalesce(c.reliability, -1) - coalesce((
         select round(100.0 * count(*) filter (where k.status = 'delivered') / count(*), 1)
           from public.transport_contracts k
          where k.carrier_id = c.id
            and k.status in ('delivered','late','lost','refused')
          having count(*) > 0), coalesce(c.reliability, -1))                                as drift,
       (select coalesce(sum(l.amount), 0) from public.transport_ledger l
         where l.company_id = c.id)                                                         as owed
from public.transport_companies c
order by c.name;
