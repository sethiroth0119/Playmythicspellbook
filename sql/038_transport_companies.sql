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
--    🔴 THE SIX HOLES *THIS* ROUND CLOSED, measured before and after on the
--       same throwaway 16.13 cluster, same stubs, same day. Every one of them
--       is the same species as the two the round before closed and the one the
--       round before that: A LIMIT THE HEADER NAMED AND THE CODE DID NOT
--       REACH. Three of these were named in this very header.
--
--       1. NO FLOOR ANYWHERE. Every lever in transport_config had a max and
--          none had a min, and `units` is numeric under `check (units > 0)`.
--          BEFORE: quote(1 hop, 0.000001 units) at base 60 returned ok:true,
--          price 1, and dispatch charged 1 Cinder and wrote a real contract.
--          The owner then self-hauled three of them and settled all three:
--          reliability went to 100.0 and the charter ENTERED THE MERIDIAN
--          MEDIAN — the NPC quote for a 1x1 haul moved off its floor of 100 to
--          150. A perfect public reputation and a seat at the table that sets
--          the price ceiling for the whole game, for 3 Cinder, paid to
--          yourself.
--          AFTER: 'units_below_min' with min_units 1; 0 contracts; reliability
--          null;
--          Meridian still on its floor at 100. And a base-1 carrier's 1-unit
--          1-hop haul is refused with 'under_price_floor' (price 1, floor
--          100) while their 100-unit haul at the same sheet prices at exactly
--          100 and goes through. The floor is not a tax on small carriers; it
--          is a floor under the CONTRACT.
--          ⚠ 100 is not a taste: it is meridian_base_floor x
--            meridian_tariff_mult x min_units x 1 hop, and quote(null,…,1,1)
--            returns exactly 100. The cheapest contract this file will write
--            is the cheapest one the NPC would have written anyway.
--
--       2. A CARRIER WAS THEIR OWN REFERENCE. Nothing checks
--          `v_co.owner_id <> v_uid`, so the self-hauls in (1) counted in both
--          public numbers. AFTER, with `k.shipper_id <> c.owner_id` in the
--          reliability recompute and in the median's delivered-gate: a settled
--          self-haul leaves reliability null and Meridian on its floor; the
--          NEXT haul, from a real shipper, moves reliability to 100.0 and
--          Meridian to 150. The exclusion is exact, not a blanket refusal.
--
--       3. THE RUN COUNTER WAS DELETABLE. runs_used lives on transport_rigs;
--          only UPDATE was revoked; trg_del allowed a DELETE of any rig not
--          'hauling'; trg_ins pins the replacement at 0; registration is free.
--          BEFORE, against a rig with runs_cap 1: run it, settle, second
--          dispatch refused 'rig_out_of_runs' — then `delete from
--          transport_rigs` + `insert into transport_rigs`, two calls, and the
--          next dispatch returned ok:true. AFTER: the DELETE is "permission
--          denied for table transport_rigs"; transport_retire_rig refuses the
--          same rig with 'rig_ran_today' (used 1, cap 10); a rig that has NOT
--          run today retires cleanly and the slot frees (fleet_used 3 → 2);
--          retiring twice returns retried:true; and retiring one with a haul
--          in flight returns 'rig_in_transit'.
--
--       4. THE CHARGE-FAILURE UNWIND MOVED A BUSY RIG TO 'idle'. One rig can
--          legally carry several hauls — §4.2's run claim accepts
--          `status in ('idle','hauling')` on purpose — and the unwind set
--          `status = 'idle'` flat. BEFORE, measured: two hauls in flight on one
--          rig, then a THIRD shipper with 5 Cinder in their wallet gets
--          'insufficient_cinder', and the rig a stranger never hired is now
--          'idle' with 2 contracts still in the air. The owner then walked it
--          straight through trg_del's `status <> 'hauling'` guard — one DELETE,
--          and both live hauls were left with rig_id null and an arrival time
--          nobody is driving towards, which is the exact harm that guard's
--          comment names.
--          AFTER: the same sequence leaves runs_used back at 2 and the status
--          'hauling'; with no live haul the same path still returns the rig to
--          'idle'; and §4.6 asks the CONTRACT ROWS, so it refuses with
--          'rig_in_transit' either way. The run comes back in both cases —
--          putting the `not exists` in the WHERE instead of on the status is
--          the obvious shape and it silently eats the carrier's run.
--
--       5. transport_caps PUBLISHED A RIVAL'S YARD. BEFORE, as a stranger:
--          `{"bays":6,"reach":6,"fleet_cap":12,"fleet_used":3,
--          "fleet_slots_left":9}`. AFTER, the same call returns the first
--          three keys and nothing else; the owner still gets all five. Both
--          §2b guards still hold under the last-slot race (4 rigs against a
--          cap of 4, 3 charters against a cap of 3) and a 9-row burst still
--          lands 0, so nothing regressed by reading caps through an ownership
--          test.
--
--       6. TRUNCATE, AND TWO UNBOUNDED STRINGS. BEFORE, as `authenticated`:
--          `truncate public.transport_config` SUCCEEDED — cfg_rows 0 — after
--          which every founding raised 'transport_config_missing' and every
--          quote returned 'closed'. `truncate public.transport_ledger` was
--          allowed too, and nothing references that table by FK so it needs no
--          CASCADE. Also BEFORE: a 300,000-character name and a
--          5,000-character home_node_id inserted cleanly onto the one
--          world-readable row every client fetches for the rate board. AFTER:
--          all three are "permission denied" / check-constraint violations,
--          and §5's new residual_grants column reads 0.
--
--       AND THE FULL REGRESSION STILL PASSES on the changed file: 1,800
--       charged once with the retry returning the same contract, settle twice
--       writing one ledger row, blacklist → Meridian with no 'refused' row,
--       every revoked write still "permission denied", set_sheet still
--       clamping 9,999,999 to 500 and 500 to 100 and dropping an unknown key,
--       and three consecutive applications clean with §5 returning exactly the
--       `-- Expect:` row.
--
--    🔧 AND FOUR CORRECTIONS MADE AFTER THAT LIST WAS WRITTEN, in the audit
--       pass that followed it. Two of the four exist BECAUSE the round above
--       over-reached — it added server behaviour and wrote comments promising
--       properties the code does not have — so each of these is the smallest
--       correction that closes the thing, and two of them change no behaviour
--       at all.
--       WHAT WAS RUN, on a fresh 16.13 database with the same stubs (an
--       auth.uid() reading the request GUC, a reduced wallet_charge over a stub
--       balance table, and Supabase's default `grant all` to anon and
--       authenticated replayed BEFORE the file, so the revokes in §3 have
--       something to revoke): three consecutive applications clean, §5 returning
--       exactly the `-- Expect:` row each time; (a) driven end to end as two
--       separate `authenticated` roles, one paid haul and then the refusal from
--       each side; (b) driven as `authenticated`, both the refused insert and a
--       re-application over a pre-existing oversize row; the two new §5 columns
--       driven by sabotaging what each watches and watching it fire. NOT
--       re-driven: (c) and (d), which are comment corrections with no code
--       behind them — the numbers quoted in those two are the audit's, not a
--       fresh run's.
--       ⚠ THE STUB CAVEATS IN ⚠ WHAT THIS DOES NOT PROVE APPLY UNCHANGED. This
--         was the same reduced environment, and it still is not the live
--         project's grant set.
--
--       a. THE THIRD READ CHANNEL ON A RIVAL'S FLEET, still open. Hole 5 above
--          shut transport_caps and the round before shut trg_sel, but
--          transport_dispatch's own refusal path re-reads the rig row as
--          SECURITY DEFINER — bypassing trg_sel — and handed the SHIPPER
--          'rig_out_of_runs' complete with cap, used and day_key, plus
--          'rig_on_deployment' complete with assigned_to. One paid haul (the
--          shipper's contract row carries rig_id, and tct_sel grants them that
--          column) bought a free, precise, permanent poll of a stranger's daily
--          counter that answers only when the rig is spent — the exact fact
--          trg_sel says must not be published, and the read half of the DoS the
--          new price floor exists to price. FIXED by giving that diagnosis the
--          same owner/stranger split §2b's fleet-cap guard already uses: the
--          CODES still go to everyone, the NUMBERS go only to the owner. §4.2
--          carries the long note.
--          AFTER, driven as two roles against a rig with runs_cap 1: the
--          shipper's second dispatch returns `{"ok":false,"error":
--          "rig_out_of_runs"}` and nothing else, with their wallet unmoved at
--          999,400 after the one paid haul; the OWNER's same call still returns
--          cap 1, used 1, remaining 0 and the day key. With assigned_to set by
--          hand, the stranger gets a bare 'rig_on_deployment' and the owner
--          gets it with 'assigned_to'. Nothing else in the regression moved.
--
--       b. THE COMPLETENESS CLAIM ON THE NEW name/home_node_id CHECK WAS WRONG
--          BY ONE COLUMN — AND THE FIX FOR THAT WAS WRONG BY A SECOND ONE; see
--          the follow-up at the end of this item. It enumerated every other
--          client-supplied string in
--          the migration and where each was bounded, and left out
--          transport_rigs.vehicle_id — `text`, no CHECK, client INSERT grant,
--          bounded only by contracts.js's `.slice(0, 64)`, the same client-side
--          truncation this round had just demoted from enforcement for `name`.
--          A 1,000,000-character value inserted cleanly. FIXED with
--          transport_rigs_vehicle_id_ck (64) in §1, and the enumeration is now
--          a checkable list rather than a claim. Smaller blast radius than the
--          name case — trg_sel keeps rigs owner-only, so this was storage abuse
--          rather than a payload on the rate board.
--          🔴 AND THE REPLACEMENT LIST WAS ITSELF INCOMPLETE, by the same
--            species of miss, on the entry directly below vehicle_id's. It
--            names `tariff` as bounded by transport_companies_tariff_ck "plus
--            transport_tariff_ok at the RPC" — but at that revision the
--            constraint RANGE-checked three keys and the helper TYPE-checked
--            the same three, and neither bounded SIZE or unknown keys. A
--            1,000,060-character sheet inserted cleanly onto the one row
--            tco_sel publishes `using (true)`, i.e. straight onto the rate
--            board every client fetches — the exact hole the block was written
--            to close, left inside the sentence that closed it. FIXED with a
--            `length(tariff::text) <= 400` term in the same constraint, plus
--            the repair that keeps the file re-runnable. The hole predates
--            that round; the sentence that covered it did not.
--            DRIVEN on a throwaway PostgreSQL 16 cluster with Supabase's
--            documented default grants, as `authenticated`: the junk-key
--            insert above and a 16kB max-scale `base` are both now "violates
--            check constraint transport_companies_tariff_ck"; an honest
--            `{base, escort_pct, illicit_pct}` sheet (50 chars) and the `{}`
--            default are both still accepted; and with the 1,000,060-character
--            row seeded in place and the constraint dropped, a full
--            re-application healed it to 61 characters, kept its base of 2.5,
--            and returned §5's `-- Expect:` row unchanged.
--          AFTER: the vehicle_id insert is "violates check constraint
--          transport_rigs_vehicle_id_ck", and the junk-key sheet is "violates
--          check constraint transport_companies_tariff_ck". And the `left()`
--          repair beside it was
--          driven too, because the constraint alone would have cost this file
--          its re-runnability on any cluster where that 1,000,000-character row
--          had actually landed: with one such row in place, a full
--          re-application succeeded, truncated it to 64, and §5 returned the
--          `-- Expect:` row.
--
--       c. AND THE ROW COUNT THAT MULTIPLIES AGAINST IT IS NOW UNBOUNDED, which
--          is this round's own doing and was not written down: revoking DELETE
--          traded a resettable counter for rows that never leave. Retire →
--          register loops accumulate 'retired' rows the fleet cap never counts
--          (three loops against a 4-slot charter left 7 retired rows behind 1
--          live one). Still the right trade; RECORDED at the departed trg_del
--          in §3 rather than reversed.
--
--       d. A SAFETY PROPERTY ASSERTED ON runs_cap THAT THE CODE DOES NOT HAVE.
--          The column's comment said the server honours
--          `least(runs_cap, max_runs_per_rig)` "so if the two ever disagree the
--          carrier gets FEWER runs than the UI promised". Both numbers are 10 —
--          max_runs_per_rig's default and this column's own CHECK ceiling — so
--          least() cannot clamp anything a client can write. The exploitable
--          delta is ZERO (rarity and condition are claimed on the same row, and
--          a derivation from them yields the top rung anyway); the defect is a
--          security comment that stops the next reader looking. FIXED as a
--          comment, and "claim a runs cap the rig cannot earn" is now in ⚖ THE
--          LIMIT OF THE GUARANTEE where it belongs. REJECTED: lowering
--          max_runs_per_rig to 3 to make the clamp bind — a live economy change
--          made to render a sentence true.
--
--       Plus two verify columns and one widened predicate in §5, because three
--       of this round's claims — the name CHECK, the two floors, and TRUNCATE
--       being revoked from EVERY client role rather than just `authenticated` —
--       were asserted in this header and checked by nothing at the bottom. See
--       data_constraints, floors_off and residual_grants there.
--
--    ⚠ WHAT THIS DOES NOT PROVE.
--      · The stub wallet_charge is a reduction of the real one (no tax leg, no
--        wallet_ledger, no profile mirror) and the stub auth.uid() reads a GUC
--        PostgREST sets differently. The grant set is Supabase's default as
--        documented, not a copy of the live project's.
--      · Nothing was measured against real data, because there is none: no
--        player has ever founded a carrier.
--      · The price floor is a NEW ECONOMIC RULE and it has never been in front
--        of a player. 100 Cinder is derived rather than guessed (it is exactly
--        Meridian's own smallest legal fare) and it refuses nothing the NPC
--        could not already sell, but the first thing a real market does with a
--        floor is find the load size that sits on it. Watch `under_price_floor`
--        in the logs before tuning anything else.
--      · transport_retire_rig's 'rig_ran_today' refusal is likewise untested
--        by anybody who wanted to retire a rig for an honest reason. It is a
--        UTC day key, so a carrier in UTC-7 who runs a rig at 6pm cannot retire
--        it until 5pm the next day. That is the same timezone edge every other
--        day key in this file has, and it is the reason all of them come from
--        the database clock rather than the device.
--      · Nothing in the client calls transport_retire_rig yet. Retiring a rig
--        is a button depot.render.js already TALKS about — its fleet panel's
--        "Upgrade the Freight Depot, or retire a rig" note — with no code
--        behind it, and wiring it belongs in that file, not this one.
--        RE-VERIFIED this round with `grep -rn transport_retire_rig
--        public/src/`: four hits, all of them COMMENTS about this very gap
--        (contracts.js's rig_ran_today entry and its RETIRE note, index.js's
--        ledger note, depot.render.js's 'retired' branch). No call site.
--      · ✅ THE THREE CODES THIS ROUND ADDED NOW HAVE CLIENT COPY — AND THE
--        BULLET THAT SAID OTHERWISE WAS STILL HERE, WHICH IS THE REAL FINDING.
--        This read "🔴 THREE OF THIS ROUND'S CODES HAVE NO CLIENT COPY" and
--        listed 'units_below_min', 'under_price_floor' and 'rig_ran_today' as
--        falling through to explain()'s unknown arm. True when written, FALSE
--        as delivered: contracts.js's CODES table now defines all three, and
--        routes.js's priceRefusal() carries the local under-price-floor mirror
--        beside the ceiling it is the mirror image of — so a below-floor quote
--        is refused BEFORE the money dialog rather than after it, which was
--        the whole complaint.
--        ⚠ WHY IT WENT STALE, because the mechanism matters more than the
--          correction: the bullet cited another seam's file BY LINE NUMBER
--          ("contracts.js:269+", "contracts.js:461-472", "routes.js
--          (:1118-1124)") while that seam was being edited in parallel, and
--          every one of those numbers pointed at unrelated code by the time
--          the two halves were delivered together. Two other citations in this
--          file rotted the same way in the same window. CROSS-FILE CITATIONS
--          IN THIS FILE ARE NAMED SYMBOLS FROM HERE ON — a symbol survives an
--          edit above it, a line number does not, and a confident wrong line
--          number costs the next reader more than no citation at all.
--          REJECTED: keeping the numbers and "just refreshing them" — that is
--          the loop that produced this bullet twice.
--        The one asymmetry that is still deliberate and is NOT a gap: routes.js
--        mirrors `minUnits` as a documented constant and does not enforce it,
--        because resolveInput() already floors the manifest at 1 and this
--        file's own default is 1, so the arm would be unreachable. Its reason
--        is written down beside the constant there.
--      · The guards depend on a Postgres implementation detail — that a
--        VOLATILE plpgsql function advances the command counter before each of
--        its queries, so a BEFORE ROW trigger can see the rows its own
--        statement has already inserted. That is stable behaviour and it is
--        also the single load-bearing assumption in §2b, which is why §5 has a
--        `guards_not_volatile` column: one keyword turns both caps back off
--        without changing anything else a reader would look at.
--
--    WHAT APPLYING IT ACHIEVES: the tables exist, RLS and the revoked grants
--    deny every client write path that is not one of the six RPCs in §4, the
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
--   · `security definer` + `set search_path = public` on all twelve functions
--     — six RPCs, four helpers and the two §2b guards.
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
--     ⚠ THAT BULLET WAS TRUE AND IT WAS NOT ENOUGH, and the two below are the
--       rest of it. A rival never needed refusals: a SUCCESSFUL haul lands in
--       the same reliability denominator, and with no floor under `units` a
--       successful haul cost ONE CINDER. The door was bolted and the wall
--       beside it was open.
--
--   · min_units_per_contract and min_price_per_contract, enforced in
--     transport_quote — the minimum beside the maximum, and the price floor at
--     THE SINGLE EXIT so neither branch can step over it. Closes: a 1-Cinder
--     dispatch, and with it (a) buying 'lost' rows in a rival's reliability at
--     1 Cinder a shot, (b) buying a seat in the Meridian median for 3 Cinder,
--     (c) exhausting a 12-rig fleet's whole day for ~120 Cinder or filling
--     every bay of a level-3 depot for 6. Measured, both directions, below.
--
--   · Reliability and the Meridian median both exclude contracts whose shipper
--     IS the carrier's owner. Closes: a carrier being their own reference. The
--     median's stated defence was "a delivery … costs some shipper a real
--     dispatch fee through that carrier"; without this clause that shipper
--     could be the attacker, paying themselves. Self-dealing is EXCLUDED, not
--     forbidden — see §4.1.
--
--   · DELETE is revoked on transport_rigs and trg_del is gone; retirement is
--     transport_retire_rig (§4.6), which refuses a rig that has run today.
--     Closes: the daily run counter being resettable by deleting the row that
--     carries it. Two `.from('transport_rigs')` calls gave a rig at its cap a
--     fresh day. Note that counting the day's runs off the contract rows
--     instead does NOT close it — `rig_id` is `on delete set null`, so the
--     delete erases that evidence too.
--
--   · transport_caps emits fleet_used / fleet_slots_left ONLY to the owner.
--     Closes: a SECURITY DEFINER helper granted to `authenticated`, taking an
--     arbitrary company id, publishing through PostgREST the exact number
--     trg_sel and the §2b guard's split error message both refuse to publish.
--
--   · transport_dispatch's refusal path splits owner from stranger the same way
--     the §2b guard does: every shipper still gets the CODE, only the owner
--     gets cap / used / day_key / assigned_to. Closes: the THIRD read channel
--     on a rival's yard — a SECURITY DEFINER re-read that bypasses trg_sel and
--     answers a stranger's poll of a rig's daily counter, for the price of one
--     haul, and only when the rig is spent.
--
--   · `truncate` (and `trigger`) on all five revokes, plus a length CHECK on
--     transport_companies.name and .home_node_id, and one on
--     transport_rigs.vehicle_id. Closes: TRUNCATE, which consults no policy at
--     all and emptied transport_config as `authenticated`; a multi-megabyte
--     carrier name on the one world-readable row in this file; and a
--     multi-megabyte vehicle_id on the fleet table — all three bounded until
--     now only by a client-side `.slice()`.
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
--                    max_price_per_contract and BELOW min_price_per_contract.
--                    The floor is not symmetry for its own sake: a dispatch
--                    spends a stranger's bay and a stranger's daily run and
--                    lands in their public reliability, so the cheapest one has
--                    to cost more than a loop
--     · address    — the shipper is auth.uid(); the carrier is a company row;
--                    neither is a parameter
--     · rate       — runs per rig per day, and free bays, both server-COUNTED
--                    AND now un-resettable: the row the counter lives on can no
--                    longer be deleted (§3), and retiring it does not recycle
--                    the slot within the day (§4.6). A charter's whole daily
--                    output is therefore bounded by fleet_cap x
--                    max_runs_per_rig, which is exactly what its largest legal
--                    fleet could do honestly.
--                    ⚠ COUNTED IS NOT SET, and this bullet used to blur the
--                      two. runs_USED is the server's. runs_CAP is a CLIENT
--                      CLAIM, bounded by its column CHECK (1..10) and by
--                      nothing else — max_runs_per_rig is 10 as well, so the
--                      least() at dispatch is a structural ceiling that clamps
--                      nothing a client can actually write. The full note is on
--                      the column itself in §1; the claim is listed below where
--                      it belongs
--     · time       — depart_at and arrive_at come from now(), so a contract
--                    cannot arrive before the clock says it did
--     · outcome    — delivered vs lost is rolled server-side against a
--                    server-computed risk_pct
--
--   What a determined client can still do INSIDE those bounds: claim a rig it
--   does not own, claim a better condition than the rig has, CLAIM A RUNS CAP
--   THE RIG CANNOT EARN (added this round — it always belonged here beside
--   condition, and the column's own comment used to imply a clamp caught it),
--   claim a depot level it has not built, claim hops it did not travel, and
--   ship cargo it does not hold. Each of those is bounded by something the
--   server does own — fleet size by the §2b guard against the depot's cap, runs
--   spent per day by the counter in §4.2, hops and units and price by
--   transport_config — so the blast radius is bounded. ⚠ The runs CAP that
--   counter is measured against is the WEAKEST of these: its only bound is the
--   column's own CHECK, and the column says so.
--   BUT A BOUND IS NOT A RECOMPUTATION. A player who claims depot
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
--    🔴 AND IT NEEDED A SIZE BOUND, WHICH IT DID NOT HAVE UNTIL NOW. The three
--    terms below RANGE-check three keys and say nothing at all about the keys
--    they do not name, so `tariff` was a jsonb bag with no bound on it — on the
--    one row in this file that tco_sel publishes `using (true)`. MEASURED as
--    `authenticated` on the stub cluster:
--      insert into transport_companies (owner_id, name, home_node_id,
--        depot_level, tariff)
--      values (auth.uid(), 'Junk Co', 'n1', 1,
--        jsonb_build_object('base', 2.5, 'escort_pct', 0, 'illicit_pct', 0,
--                           'junk', repeat('Z', 1000000)))
--    → INSERT 0 1, tariff_len 1,000,060. transport_tariff_ok at the RPC does
--    not close it either: it TYPE-checks the same three keys and ignores the
--    rest. contracts.js's carrier queries select `tariff` for every carrier on
--    the rate board, so that is the identical multi-megabyte-payload-on-every-
--    client's-fetch hole the name/home_node_id block below is about, reached
--    through the column beside them.
--    ⚠ THE ENUMERATION BELOW LISTED THIS COLUMN AS ALREADY BOUNDED, and that
--      was the actual defect: the round that wrote "THE FULL LIST, so it can be
--      checked rather than trusted" named `tariff`'s two guards without
--      noticing that neither of them bounds SIZE. A completeness claim that is
--      wrong is worse than no claim — it is the sentence that stops the next
--      reader looking — and this is the SECOND column that list has been wrong
--      about (vehicle_id was the first). Both are now bounded rather than
--      re-worded.
--    400 characters, not a key whitelist. The client only ever writes the three
--    numeric keys setTariff() assembles, and MEASURED, that sheet is 55
--    characters at this constraint's own range maxima and 68 with four decimal
--    places on every one of them — so 400 is loose by most of an order of
--    magnitude and cannot refuse an honest sheet.
--    REJECTED: `tariff - array['base','escort_pct','illicit_pct'] = '{}'::jsonb`
--    to forbid unknown keys outright — tighter, but it
--    makes every future sheet key a migration, and this block's stated posture
--    is that its bounds are STRUCTURAL and deliberately loose while the tunable
--    ceiling lives in transport_config.
--    ⚠ THE REPAIR RUNS FIRST, for the same reason the one at
--      transport_rigs_vehicle_id_ck does: §5 claims "three applications clean",
--      and a cluster where the 1,000,060-character sheet above had actually
--      landed would otherwise fail this ADD CONSTRAINT for ever. It rebuilds
--      the sheet from the three keys this file recognises and drops the rest,
--      which is exactly what setTariff() would have sent. round(…, 4) is not
--      decoration, and the exact reachable case is worth pinning down because
--      the obvious version of it is NOT reachable: jsonb stores a JSON number
--      as `numeric`, so a million-digit literal never becomes a jsonb value at
--      all (measured: `value overflows numeric format` at the cast). What IS
--      legal is numeric's own maximum scale — `{"base":1.<16383 zeros>}` is a
--      well-formed 16kB sheet whose value is 1 and therefore passes all three
--      RANGE terms. Measured: refused by the length term, and healed by
--      round(…, 4) rather than trimmed keys, which on their own would have left
--      that row too big to re-admit. Rejected here too: `not valid`,
--      which would leave the offending row on the rate board while the
--      constraint claimed otherwise.
--      ⚠ The repair normalises scale, so a healed sheet reads `2.5000` rather
--        than `2.5`. Cosmetic and confined to rows that were already junk —
--        `(tariff->>'base')::numeric` is the same number, which is all
--        transport_quote reads.
update public.transport_companies
   set tariff = jsonb_strip_nulls(jsonb_build_object(
     'base', case when jsonb_typeof(tariff->'base') = 'number'
                  then to_jsonb(round((tariff->>'base')::numeric, 4)) end,
     'escort_pct', case when jsonb_typeof(tariff->'escort_pct') = 'number'
                  then to_jsonb(round((tariff->>'escort_pct')::numeric, 4)) end,
     'illicit_pct', case when jsonb_typeof(tariff->'illicit_pct') = 'number'
                  then to_jsonb(round((tariff->>'illicit_pct')::numeric, 4)) end))
 where jsonb_typeof(tariff) = 'object'
   and length(tariff::text) > 400;
alter table public.transport_companies drop constraint if exists transport_companies_tariff_ck;
alter table public.transport_companies add constraint transport_companies_tariff_ck check (
  jsonb_typeof(tariff) = 'object'
  and length(tariff::text) <= 400
  and coalesce((tariff->>'base')::numeric, 0)        between 0 and 100000
  and coalesce((tariff->>'escort_pct')::numeric, 0)  between 0 and 100
  and coalesce((tariff->>'illicit_pct')::numeric, 0) between 0 and 200
);
-- 🔒 THE TWO STRINGS ON THE ONLY WORLD-READABLE ROW IN THIS FILE. name and
--    home_node_id were bounded only by contracts.js's `.slice(0, 40)` — a
--    client-side truncation, which is the one kind of bound this file refuses
--    to rely on anywhere else. tco_sel is `using (true)`, so a console that
--    skips the slice writes a multi-megabyte name onto a row EVERY client
--    fetches to draw the rate board.
--    ⚠ THIS COMMENT USED TO SAY THESE WERE "THE ONLY CLIENT-SUPPLIED STRINGS
--      IN THE WHOLE MIGRATION BOUNDED BY NOTHING BUT THE CLIENT" AND THEN
--      ENUMERATE THE REST. THE ENUMERATION WAS WRONG BY ONE COLUMN, and it is
--      corrected here rather than deleted because a completeness claim that is
--      wrong is worse than no claim: it is the sentence that stops the next
--      reader looking. transport_rigs.vehicle_id was missing from it —
--      `text`, no CHECK, on a table with a client INSERT grant — and a
--      1,000,000-character value inserted cleanly. It is bounded now by
--      transport_rigs_vehicle_id_ck, added one section down beside the fleet
--      table it belongs to.
--    THE FULL LIST, so it can be checked rather than trusted. Every
--    client-supplied string in this migration and where its bound lives:
--      · name, home_node_id — HERE, transport_companies_name_ck (40).
--      · vehicle_id         — transport_rigs_vehicle_id_ck (64), §1.
--      · cargo              — pg_column_size at dispatch (§4.2).
--      · from_node, to_node — `left(…, 40)` at insert (§4.2).
--      · client_ref         — `left(…, 64)` at insert (§4.2).
--      · blacklist          — array_length > 200 in transport_set_sheet (§4.5).
--      · tariff             — transport_companies_tariff_ck (400 chars over the
--                             whole sheet), above. Its three RANGE terms and
--                             transport_tariff_ok at the RPC bound the three
--                             KEYS; the length term is what bounds the bag,
--                             and it was missing when this list first claimed
--                             to be complete. See the block above it.
--    Same idempotent shape as the tariff constraint above, and the same
--    division of labour: 40 is what the client already truncates to, so this
--    demotes that slice from the enforcement to the convenience it should
--    always have been. btrim on the lower bound because a name of three spaces
--    has length 3 and is not a name a shipper can find you by.
alter table public.transport_companies drop constraint if exists transport_companies_name_ck;
alter table public.transport_companies add constraint transport_companies_name_ck check (
  length(name) <= 40
  and length(btrim(name)) >= 1
  and length(coalesce(home_node_id, '')) <= 40
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
  -- 🔴 DECLARED AUTHORITY, AND THE HONEST WORD FOR THIS COLUMN IS "CLAIM".
  --    The ladder — 3/4/5/6/8/10 by rarity, times PP_COND_MULT, floor, minimum
  --    1, then the flat Garage perk (design §3) — is rigs.data.js's
  --    effectiveRuns() and that is the authority for what a rig SHOULD do.
  --    This column is what the CLIENT says that ladder produced, and the server
  --    cannot check it: the vehicle behind it lives in
  --    Profile.princePortfolios.lot, a save blob. See ⚖ THE LIMIT OF THE
  --    GUARANTEE in the header, which now lists this claim beside the others.
  --
  --    ⚠ THIS COMMENT USED TO SAY THE SERVER "honours least(runs_cap,
  --      transport_config.max_runs_per_rig), so if the two ever disagree the
  --      carrier gets FEWER runs than the UI promised. That is the correct
  --      direction for this disagreement to fail in." THE DIRECTION IS RIGHT
  --      AND THE CLAMP NEVER BINDS. max_runs_per_rig defaults to 10 and the
  --      CHECK below stops at 10, so least() cannot reduce any value that got
  --      into the row: it is a STRUCTURAL CEILING, not a live clamp, and the
  --      only bound on a forged runs_cap is that CHECK. §4.2 keeps the least()
  --      because it is the right expression the day an operator tunes
  --      max_runs_per_rig DOWN — not because it is doing work today.
  --      Corrected rather than quietly deleted: a security-relevant comment
  --      asserting a safety property the code does not have is the exact
  --      failure mode this file's header spends its whole length arguing
  --      against, and this one sat on the very column the header points at
  --      when it calls the rate server-owned.
  --
  --    CALIBRATION, so this is not read as bigger than it is. rarity and
  --    condition on this same row are client-claimed too, so a server-side
  --    derivation from the two columns beside this one would hand a
  --    self-declared Mythic/Pristine rig the top of the ladder anyway —
  --    floor(10 x 1.15) = 11, plus 1 for a tier-2 Garage, i.e. ABOVE the 10
  --    written here, which is why contracts.js's registerRig() already sends
  --    `Math.min(10, cap)` — named by SYMBOL, not by line: this citation read
  --    "(:1142)" for one round and pointed at an unrelated note by the time the
  --    two seams were delivered together. No honest registration has ever hit
  --    the CHECK. The exploitable delta over the DISCLOSED envelope is zero. What
  --    was wrong was the sentence, not the number.
  --    What the server does own, exactly and un-resettably as of this round, is
  --    runs_USED — the counter in §4.2, on a row §3 no longer lets anyone
  --    delete. It does not own runs_CAP.
  --    REJECTED: lowering max_runs_per_rig to the Common rung (3) so that
  --    least() binds again. That makes the clamp real by cutting every honest
  --    Mythic carrier's day from ten runs to three — a live economy change made
  --    to render one comment true, on a feature no player has touched. If a
  --    server-verifiable upgrade path ever lands, raise it from a floor then.
  --    The 10 below is the design's Mythic rarity rung and is a structural
  --    bound, not the ladder.
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
-- 🔒 THE STRING THE CONSTRAINT BLOCK IN THE CHARTER TABLE FORGOT. vehicle_id is
--    `text` with no CHECK, on a table that HAS a client INSERT grant and a
--    deliberately permissive trg_ins (it pins the counters, not the strings),
--    and it was bounded by exactly one thing: contracts.js's
--    `String(vehicleId).slice(0, 64)` — the same client-side truncation this
--    round demoted from enforcement to convenience for `name`. Measured by the
--    audit that found it, as `authenticated`: an insert carrying
--    `repeat('A', 1000000)` was accepted, 1,000,000 characters and all. 64 is
--    what the client already truncates to, so this makes that slice the
--    convenience it is everywhere else in this file.
--    ⚠ SMALLER BLAST RADIUS THAN THE NAME CASE, and worth saying so rather than
--      leaving the next reader to re-derive whether this was urgent: trg_sel
--      keeps rig rows owner-only, so unlike a carrier name this never reaches
--      another player's screen. It is storage abuse, not a payload on the rate
--      board — and see the note at the departed trg_del in §3 for why the ROW
--      COUNT it multiplies against is now unbounded too.
--    ⚠ THE `left()` REPAIR RUNS FIRST, AND IT IS NOT DECORATION. This file must
--      survive being pasted a third time (§5 says "three applications clean"),
--      and a cluster where the oversize row above was actually inserted would
--      otherwise fail this ADD CONSTRAINT for ever. Truncating to 64 writes
--      exactly what the client would have written. Rejected: `not valid`, which
--      would leave the offending row in place and make the constraint mean
--      something different from what it says.
update public.transport_rigs set vehicle_id = left(vehicle_id, 64)
 where length(vehicle_id) > 64;
alter table public.transport_rigs drop constraint if exists transport_rigs_vehicle_id_ck;
alter table public.transport_rigs add constraint transport_rigs_vehicle_id_ck check (
  length(coalesce(vehicle_id, '')) <= 64
);
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
  -- 🔒 THE FLOOR HALF OF THE PAIR, AND IT IS THE ONE THAT WAS MISSING. Every
  --    lever in this table had a max and none had a min, and `units` is
  --    `numeric` with only `check (units > 0)` under it — so p_units = 0.000001
  --    at p_hops = 1 priced at ceil(1e-8) = 1. ONE CINDER, at any tariff,
  --    including the 500 ceiling. That single fact was the root of three
  --    attacks this file's own header claims are closed:
  --      · §4.2 refuses to write a 'refused' contract row because "a rival
  --        could loop this function against any carrier and destroy their
  --        public reliability from a script" — but a SUCCESSFUL 1-Cinder
  --        dispatch lands in the reliability denominator too (§4.3 counts
  --        'delivered','late','lost','refused') and carries a server-rolled
  --        16-24% loss chance at reach-limit hops. The rival did not need
  --        refusals; they could buy 'lost' rows at 1 Cinder each. The defended
  --        door was bolted and the wall beside it was open.
  --      · the Meridian median's defence #2 (§4.1) says a sock charter must
  --        DELIVER before it is sampled because "a charter is free; a delivery
  --        is not — it costs some shipper a real dispatch fee". It cost 1
  --        Cinder, paid by the attacker to their own charter.
  --      · the SHIPPER picks p_rig_id (§4.2), so ~120 Cinder exhausted a
  --        12-rig fleet's whole day and 6 Cinder filled every bay of a level-3
  --        depot for 25 minutes a hop, on loop.
  --    A floor does not make any of those impossible. It prices them, which is
  --    the same argument §4.2 makes for why a refusal is only evidence if
  --    making one costs the shipper something.
  min_units_per_contract  numeric not null default 1,
  max_tariff_per_unit_hop numeric not null default 500,
  -- Provenance, not a guess: sql/034 measured the largest credit this game has
  -- ever issued (a 1,000,000 admin gift) and set the single-call ceiling on the
  -- game's one crediting path to 5,000,000, five times that. A freight bill is
  -- not a credit, but it is a transfer between players of the same order, and
  -- there is no reason for one haul to move more than the largest sum this
  -- economy has ever moved in one call.
  max_price_per_contract  numeric not null default 5000000,
  -- Provenance, not a guess, the same way max_price_per_contract has one. 100
  -- is EXACTLY what Meridian charges for the smallest legal haul at its own
  -- floor: meridian_base_floor (40) x meridian_tariff_mult (2.5) x
  -- min_units_per_contract (1) x 1 hop. So the cheapest contract this file will
  -- write is the cheapest contract the NPC would ever have written anyway, and
  -- the floor refuses nothing the fallback carrier could not already sell.
  -- Tune the three numbers it is derived from and this wants tuning with them;
  -- it is a column rather than that expression so that a lowered Meridian floor
  -- does not silently lower the price of griefing at the same time.
  min_price_per_contract  numeric not null default 100,
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
alter table public.transport_config add column if not exists min_units_per_contract  numeric not null default 1;
alter table public.transport_config add column if not exists max_tariff_per_unit_hop numeric not null default 500;
alter table public.transport_config add column if not exists max_price_per_contract  numeric not null default 5000000;
alter table public.transport_config add column if not exists min_price_per_contract  numeric not null default 100;
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
-- ⚠ 'retired' IS REACHABLE AS OF THIS ROUND, and this filter is what makes the
--   change safe. It used to read "currently UNREACHABLE… the filter is here so
--   that on the day retirement becomes a status change, a scrapped rig does not
--   go on holding a fleet slot. Grep `'retired'` before wiring that." That day
--   is this file: retiring a rig was a DELETE, DELETE was the reset button on
--   the daily run counter (see the note where trg_del used to be, §3), and
--   retirement is now transport_retire_rig in §4.6. The grep it asked for
--   turned up four places and all four already handled 'retired' correctly —
--   here, §4.2's run claim, §4.3's release, and §5's over_fleet_cap. The one
--   that did NOT was transport_repair, which is fixed in §4.4.
--
-- ⚠ `fleet_used` AND `fleet_slots_left` ARE A UI HINT, NOT THE ENFORCEMENT,
--   and the distinction is worth the two words. This function is `stable`: it
--   answers from the snapshot its caller started with, so inside a multi-row
--   INSERT it reports the slots that were free BEFORE the statement began. It
--   is the right shape for the Depot screen and for transport_set_sheet's
--   payload, and the wrong shape for a limit — which is the whole story of
--   §2b. `fleet_cap` has no such caveat; it is a pure function of the row.
--
-- 🔴 AND THOSE TWO KEYS ARE OWNER-ONLY, WHICH IS A FIX AND NOT A PREFERENCE.
--    This helper is SECURITY DEFINER, takes an ARBITRARY company id and is
--    granted to `authenticated`, so PostgREST publishes it as
--    `rpc/transport_caps` and ANY player could call it against ANY carrier.
--    Company ids are trivially enumerable because tco_sel is `using (true)`.
--    It was therefore handing out, to anybody who asked, the one number two
--    other places in this same file go out of their way to withhold:
--      · trg_sel (§3) restricts rig reads to the owner because "a rival's
--        fleet composition is competitive information … knowing a carrier is
--        out of runs is knowing exactly when to undercut them."
--      · the fleet-cap guard (§2b) splits its refusal into an owner branch and
--        a bare-code branch specifically so that "the guard would [not] hand
--        out, through a refusal, exactly what the SELECT policy four sections
--        down refuses to hand out through a query."
--    The guard closed the refusal channel, the policy closed the query
--    channel, and this function then answered the question directly. Note the
--    asymmetry that makes the split the right shape rather than a blanket
--    lock-out: reach / bays / fleet_cap are pure functions of depot_level,
--    which tco_sel already publishes to the world, so gating them would hide
--    nothing and would break the rate board's "free bays now" column (design
--    §5). fleet_used is not derivable from any public column, and is the only
--    thing here that is genuinely private.
--    No server path regresses: the §2b guard runs its own count and reads only
--    `fleet_cap`, transport_quote reads only `reach`, transport_dispatch reads
--    only `bays`, and transport_set_sheet's payload is owner-only by
--    construction — it refuses a non-owner four statements earlier.
--
-- Returns NULL for a company that does not exist, which is why every caller
-- compares the extracted value rather than trusting it — `null > 0` is null,
-- and a caller who trusts it instead REFUSES. That is the safe direction.
-- ⚠ A NON-OWNER GETS AN OBJECT WITHOUT THOSE KEYS, NOT AN OBJECT WITH NULLS.
--   `->>'fleet_used'` is null either way, so a client already written against
--   the old shape reads null rather than 0 — the same safe direction. Do not
--   "helpfully" fill them with 0: a 0 fleet_used is a claim about a rival's
--   yard, and a wrong one.
create or replace function public.transport_caps(p_company_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'reach',      3 + c.depot_level,
    'bays',       least(2 * c.depot_level, f.max_bays),
    'fleet_cap',  least(4 * c.depot_level, f.max_fleet_rigs))
    || case when public.is_transport_owner(c.id) then jsonb_build_object(
         'fleet_used', (select count(*) from public.transport_rigs r
                         where r.company_id = c.id and r.status <> 'retired'),
         'fleet_slots_left',
           greatest(0, least(4 * c.depot_level, f.max_fleet_rigs)
                       - (select count(*) from public.transport_rigs r
                           where r.company_id = c.id and r.status <> 'retired')))
       else '{}'::jsonb end
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
-- ⚠ INSERT ONLY, DELIBERATELY, AND THE TEST IS "COULD THIS UPDATE CONSUME A
--   SLOT?" — not "does any UPDATE exist?". UPDATE is revoked on both tables and
--   no policy grants it (§3), so the only writers are the definer functions in
--   §4, and every one of them either leaves the counted set alone or SHRINKS
--   it: transport_set_sheet touches the charter's sheet, §4.2 and §4.3 move a
--   rig between 'idle' and 'hauling' (both counted, so the total does not
--   move), and transport_retire_rig moves one OUT of the count. A guard that
--   can only ever run to approve is a claim nobody can test.
--   Two future changes must add the UPDATE arm here in the same file: a
--   "transfer this rig to my other charter" RPC, and any un-retire — 'retired'
--   is filtered out of the count, so bringing one back is an allocation and
--   needs the lock and the count exactly as an INSERT does. §4.6 says the same
--   thing from the other end.
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
--
-- 🔴 `truncate` IS ON EVERY ONE OF THE FIVE REVOKES BELOW, and it is the one
--    command every "WRITE: nobody" claim in this file was silent about.
--    Supabase's default privileges grant ALL on tables in `public` to
--    `authenticated`, and ALL includes TRUNCATE, REFERENCES and TRIGGER. This
--    repo has already MEASURED the residue an enumerated revoke leaves behind:
--    sql/028:11 and :174 record the observed grant set after exactly this
--    pattern as "REFERENCES, SELECT, TRIGGER, TRUNCATE".
--      · TRUNCATE consults NO POLICY AT ALL. `truncate public.transport_ledger`
--        erases the append-only book this whole feature rests on — and nothing
--        references transport_ledger by a foreign key, so it does not even need
--        CASCADE. `truncate public.transport_config` removes the ceilings row,
--        at which point §2b's guards raise 'transport_config_missing' on every
--        registration and every quote returns 'closed'.
--      · TRIGGER is enough on its own to attach a trigger to a table you do not
--        own; ownership is not required, only the privilege plus EXECUTE on a
--        function. Revoked for that reason rather than for tidiness.
--      · REFERENCES is inert (adding a foreign key requires owning the
--        referencing table) and is revoked with them because leaving one of the
--        four measured residues in place invites the next reader to conclude
--        the list was considered and this one was wanted.
--      · SELECT is the fourth, and it is the one that is WANTED on four of the
--        five tables — it is governed by the policies above. transport_config
--        revokes it explicitly, and always did.
--    ⚠ CALIBRATION, so nobody rewrites the threat model from this paragraph:
--      this is NOT reachable from a devtools console. PostgREST has no TRUNCATE
--      verb and players hold a JWT, not database credentials. It is defence in
--      depth, and it is the only privilege this file's own "the denial does not
--      depend on a policy staying deleted" argument did not actually cover.
--      §5 now counts it rather than asserting it.
revoke update, delete, truncate, trigger, references on public.transport_companies from anon, authenticated;

-- FLEET · read. Your own rigs only. A rival's fleet composition is competitive
-- information — how many rigs, what rarity, how many runs each has left today
-- — and knowing a carrier is out of runs is knowing exactly when to undercut
-- them. The rate board publishes free bays; it does not publish the yard.
drop policy if exists trg_sel on public.transport_rigs;
create policy trg_sel on public.transport_rigs for select to authenticated
  using (public.is_transport_owner(company_id));

-- Registering a rig is self-service, and every counter is PINNED AT ITS ZERO.
-- Without those equalities the insert IS the exploit: a rig arriving with
-- runs_used = -1000 has a thousand free hauls, one arriving already 'hauling'
-- occupies a bay it never earned, and one arriving with assigned_to set is
-- invisible to a dispatch guard that refuses exactly that. The claimed values
-- that remain — rarity, condition, runs_cap — are bounded by their CHECKs and
-- again by the ceilings at dispatch time.
--
-- ⚠ day_key AND repair_day ARE PINNED TOO, AND THEY WERE NOT. The comment
--   above used to say "every counter is PINNED AT ITS ZERO" and list four
--   equalities while the two DAY KEYS those counters are compared against went
--   unmentioned. It was only ever half true, and it was harmless only by
--   luck — each unpinned key's partner counter WAS pinned, so §4.2's
--   `r.day_key is distinct from v_today or r.runs_used < …` and §4.4's
--   equivalent both landed on the zero rather than on the key. Half true by
--   luck is the state this file spends its whole header arguing against: pin
--   both, and the guard no longer depends on which side of that `or` fires.
--   Null is the honest value for a rig that has never run, and it is what the
--   column defaults to.
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
              and day_key is null and repair_day is null
              and assigned_to is null
              and status = 'idle');

-- 🔴 NO DELETE POLICY ANY MORE, AND THE ONE THAT USED TO BE HERE IS THE THIRD
--    CAP THIS FILE ANNOUNCED AND DID NOT HOLD. It read
--      `create policy trg_del … using (owner_id = auth.uid() and status <> 'hauling')`
--    and it was correct about the thing it was thinking about — you may not
--    retire a rig mid-haul — while being the reset button for the thing the
--    header calls one of the four the server genuinely owns: ":253 rate — runs
--    per rig per day, and free bays, both server-counted."
--
--    THE COUNTER LIVED ON A ROW THE CLIENT COULD DESTROY. runs_used and
--    day_key are columns of transport_rigs; DELETE was granted (only UPDATE was
--    revoked); trg_del permitted it for any rig not currently 'hauling'; and
--    trg_ins pins the replacement's runs_used at 0. Registration costs nothing
--    — the doc comment over contracts.js's registerRig() says so in as many
--    words, "It costs NOTHING" — and the §2b fleet guard counts LIVE ROWS, not
--    registrations, so it never saw the churn.
--    ⚠ THIS CITATION HAS NOW BEEN WRONG TWICE, WHICH IS WHY IT NO LONGER
--      CARRIES A NUMBER. It read ":917" (a line in the middle of the
--      contract-list query), was "corrected" to ":1105" against HEAD, and by
--      delivery the parallel edits in that seam had moved the sentence again
--      so that :1105 was a note about pinned INSERT columns. Both times the
--      number was confidently wrong and the claim underneath it was right.
--      A named symbol survives an edit above it; a line number in another
--      seam's file does not, and a confident wrong one costs the next reader
--      more than no citation would. Same rule as the header's cross-file
--      citation note. REJECTED, twice over now: refreshing the number.
--    Back to the counter. A carrier at their daily cap settled a haul (the rig
--    returns to 'idle' in §4.3),
--    deleted the rig, re-inserted it, and had a full day's runs again. Two
--    `.from('transport_rigs')` calls from a devtools console. Once the payout
--    leg lands (see the header) that counter is the ONLY thing rate-limiting a
--    carrier's income.
--
--    ⚠ AND COUNTING THE DAY'S RUNS OFF THE CONTRACT ROWS INSTEAD DOES NOT FIX
--      IT — which is worth writing down, because it is the obvious fix and it
--      looks airtight. `transport_contracts.rig_id` is `on delete set null`
--      (§1), so deleting the rig ALSO erases the contract-side evidence, and
--      the re-inserted rig is a new uuid with no contracts against it either
--      way. Any per-rig counter is resettable while the rig row is
--      destroyable. The row has to stop being destroyable first.
--
--    SO RETIREMENT IS A STATUS CHANGE NOW, through transport_retire_rig in
--    §4.6, and DELETE is revoked below. 'retired' was already in the CHECK
--    ladder and already filtered out of transport_caps' fleet_used, so the
--    fleet slot still frees exactly as it did — what does not happen any more
--    is the row, and its counter, going away. The contract's `on delete set
--    null` stays for the same reason it was written: it is now unreachable
--    from any client, and it is the right behaviour if a future migration ever
--    reaches it.
--    No client path regresses: nothing in /src/transport has ever issued a
--    delete against this table. Re-verified this round by grep, not by memory:
--    depot.render.js's fleet-panel note tells the owner to "Upgrade the Freight
--    Depot, or retire a rig" and there is no code behind that sentence yet, and
--    the only mentions of transport_retire_rig anywhere under public/src/ are
--    comments about that gap. Wiring the button to the new RPC is a client
--    change and belongs in the client's own file.
--
--    ⚠ AND THE OTHER HALF OF THE TRADE, which the paragraph above states only
--      the good news of. A RESETTABLE COUNTER WAS TRADED FOR AN UNBOUNDED ROW
--      COUNT. Retirement leaves the row behind on purpose — that is the whole
--      mechanism — registration is free (contracts.js's registerRig(), checked)
--      and the §2b fleet guard counts LIVE rows only, exactly so that a retired
--      rig frees its slot. Those three together mean a retire → register loop
--      accumulates 'retired' rows that no cap ever sees.
--      Measured by the audit that found it: three loops against a
--      depot-level-1 charter left 7 retired rows and 1 live one behind a
--      fleet_cap of 4. Each row is now bounded in SIZE (the column CHECKs, and
--      transport_rigs_vehicle_id_ck in §1); the NUMBER of them is bounded by
--      nothing.
--      Still the right trade — a reset button on the counter that will rate
--      limit a carrier's income is worse than junk rows, and trg_sel keeps the
--      junk private — but it IS a trade and it was not written down. If it
--      ever matters the fix is a lifetime-registrations bound inside the §2b
--      guard, NOT restoring DELETE: the reason DELETE is gone is the counter,
--      and that reason does not weaken.
drop policy if exists trg_del on public.transport_rigs;

-- 🔴 NO UPDATE POLICY, for the same mechanical reason as the charter table and
--    with more at stake. Every column that decides money is on this row:
--    runs_used and day_key are the daily rate limit, condition feeds the runs
--    ladder, status holds the bay, and assigned_to is the battle interlock. A
--    row-level UPDATE policy hands over all five together, whatever its comment
--    says. Runs move only inside transport_dispatch; condition moves only
--    inside transport_repair; status moves only inside those two and
--    transport_retire_rig. Revoked as well, so the denial survives an edit
--    to this file.
--    DELETE is revoked here as of this round — see the long note on the
--    departed trg_del above. It is what turns "the counter is server-owned"
--    from a sentence into a property.
revoke update, delete, truncate, trigger, references on public.transport_rigs from anon, authenticated;

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
revoke insert, update, delete, truncate, trigger, references on public.transport_contracts from anon, authenticated;

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
revoke insert, update, delete, truncate, trigger, references on public.transport_ledger from anon, authenticated;
revoke all on sequence public.transport_ledger_id_seq from anon, authenticated;

-- CEILINGS · nobody, for any command. RLS is on and there is deliberately no
-- policy at all, so no client can even read this row.
-- ⚠ These numbers are not secret — they are printed on every quote. The reason
--   the client cannot read the table is that a client which reads the ceilings
--   acquires a SECOND copy of the pricing authority and will eventually
--   disagree with the first. Every number the UI needs to render a quote is
--   returned inside transport_quote's own jsonb, so there is exactly one path
--   and it is the one that also does the charging.
revoke select, insert, update, delete, truncate, trigger, references on public.transport_config from anon, authenticated;


-- ─── 4. RPCs ───────────────────────────────────────────────────────────────
--
-- All six below — and the four helpers in §2, and the two guards in §2b — are
-- `security definer` with a pinned search_path and are revoked from public and
-- anon immediately after each definition, with the full argument type list
-- spelled out. A revoke naming a partial signature names a function that does
-- not exist: it succeeds, and it revokes nothing. The six here and the four in
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
  -- 🔒 THE MINIMUM IS BESIDE THE MAXIMUM, which is where it should always have
  --    been: `units` is numeric and had no lower bound but `> 0`, so 0.000001
  --    units priced a haul at 1 Cinder. See min_units_per_contract in §1 for
  --    the three attacks that bought.
  --    The `<= 0` stays as well as the `< min`, and it is not redundant: a
  --    future operator tuning min_units_per_contract to 0 in the SQL editor
  --    would otherwise reopen the door, and the contract table's own
  --    `check (units > 0)` would then answer with an opaque 23514 instead of
  --    this refusal. Two bounds, both cheap.
  --
  -- 🔴 THE FLOOR GETS ITS OWN CODE, and this is a bug the FIRST cut of this
  --    round shipped: the min branch was folded into 'bad_units' with an extra
  --    'min_units' key. That was measured wrong across the seam. The client
  --    that is already deployed renders 'bad_units' as, verbatim,
  --    "<units> units is outside what one contract carries (max <max_units>).
  --    Split the load across two hauls." — the `bad_units` entry in
  --    public/src/transport/contracts.js's CODES table (cited by SYMBOL, not by
  --    line, for the reason the header's cross-file citation note gives).
  --    For a 0.5-unit quote that sentence is not merely unhelpful,
  --    it is ACTIVELY WRONG ADVICE — splitting a too-small load makes each half
  --    smaller and refused harder — and the extra 'min_units' key rendered
  --    nowhere. A separate code fell to that file's explain() unknown arm,
  --    which prints the code verbatim and says to quote it to an admin. Being
  --    told a word you do not know is a bad message; being confidently told to
  --    do the opposite of the fix is a broken one. Prefer the unknown arm.
  --    ⚠ PAST TENSE ON PURPOSE: that was the choice's cost when it was made,
  --      and the client has since paid it off — CODES now carries its own
  --      'units_below_min' entry, so the code no longer reaches the unknown
  --      arm at all. The reasoning is kept because it is why the code is
  --      SEPARATE, which is still the live decision; only the consequence
  --      expired. See the header bullet on the three codes for the state.
  --    ⚠ 'bad_units' therefore keeps EXACTLY the meaning and EXACTLY the
  --      payload shape that shipped client already knows: over the max, with
  --      max_units and units. Do not put a min key back on it.
  if v_units <= 0 or v_units < v_cfg.min_units_per_contract then
    return jsonb_build_object('ok', false, 'error', 'units_below_min',
                              'min_units', v_cfg.min_units_per_contract,
                              'units', v_units);
  end if;
  if v_units > v_cfg.max_units_per_contract then
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
  --    2. Only carriers that have actually DELIVERED something TO SOMEBODY
  --       ELSE are sampled. A charter is free; a delivery is not — it costs
  --       some shipper a real dispatch fee through that carrier. This is what
  --       makes the sock-puppet attack cost money instead of a loop, and it is
  --       why the filter is on contracts rather than on, say, account age.
  --       🔴 `k.shipper_id <> c.owner_id` IS THE HALF THAT WAS MISSING, and
  --          without it the sentence above was not true. Nothing in §4.2 stops
  --          a carrier being a legal shipper to their own charter, so the
  --          "real dispatch fee" was a payment the attacker made to themselves
  --          — and with no floor on units it was ONE CINDER (see
  --          min_units_per_contract in §1). Both halves of that are now fixed
  --          and they are fixed independently, because either alone is enough
  --          to make this an ENTRY TICKET rather than a cost: a floor without
  --          this clause is a ticket you buy from yourself, and this clause
  --          without a floor is a ticket you buy from a friend for 1 Cinder.
  --       ⚠ SELF-DEALING IS EXCLUDED, NOT FORBIDDEN. Rejected: refusing a
  --         dispatch where the shipper owns the carrier. A carrier moving
  --         their own cargo on their own rigs is legitimate play and refusing
  --         it would be a rule nobody outside this file could predict; what
  --         must not happen is that the haul BUYS anything public. It buys
  --         nothing: not a place in this median, and not a point of
  --         reliability (§4.3 excludes it too, and §5b's drift column matches).
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
                  where k.carrier_id = c.id and k.status = 'delivered'
                    and k.shipper_id <> c.owner_id);

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

  -- 🔴 AND THE FLOOR IS AT THE SAME SINGLE EXIT, for the identical reason the
  --    ceiling is. Both branches build a price and neither returns one, so
  --    there is no path that can step over this either — and the Meridian
  --    branch gets no exemption from it any more than it gets one from the
  --    cap. min_units_per_contract bounds the CHEAPEST INPUT; this bounds the
  --    cheapest OUTPUT, and the two are not the same check: a carrier posting
  --    base 1 sells a legal 1-unit 1-hop haul for 1 Cinder with the unit floor
  --    fully satisfied. A dispatch is a public act — it lands in the
  --    reliability denominator, it takes a bay for 25 minutes a hop, and it
  --    spends one of a stranger's daily runs on a rig THE SHIPPER CHOSE — so
  --    the cheapest one has to cost more than a loop.
  --    ⚠ IT REFUSES; IT DOES NOT CLAMP UP. Clamping would charge a shipper
  --      more than the sheet they were shown, which is the one thing §4.2's
  --      "the shipper is charged the price they were shown" exists to prevent.
  --      Refusing is what the ceiling does four lines up, and this is the same
  --      shape pointed the other way: the remedy is a bigger load, which is a
  --      sentence the client can write from `units` and `floor`.
  if v_price < v_cfg.min_price_per_contract then
    return jsonb_build_object('ok', false, 'error', 'under_price_floor',
                              'carrier', v_kind,
                              'price', v_price, 'floor', v_cfg.min_price_per_contract,
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
  -- refusal transport_quote can produce (bad_hops, bad_units, units_below_min,
  -- under_price_floor, out_of_reach, over_price_cap, no_tariff_published…) is
  -- returned verbatim, so a route the
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
      --
      -- 🔒 AND THE NUMBERS IN IT GO ONLY TO THE OWNER. This is the same split,
      --    written to the same rule, as the fleet-cap guard's refusal in §2b:
      --    "AN ERROR MESSAGE IS A READ PATH… the counts go only to the owner;
      --    everybody else gets the bare code." Grep that phrase in
      --    transport_fleet_cap_guard for the original statement of it.
      --
      --    🔴 THIS WAS THE THIRD READ CHANNEL ON A RIVAL'S YARD, and it stayed
      --       open after the other two were shut. trg_sel makes the rig rows
      --       owner-only and transport_caps' fleet_used went owner-only in the
      --       same round — but transport_dispatch is SECURITY DEFINER, so the
      --       re-read below BYPASSES trg_sel, and p_rig_id arrives from the
      --       SHIPPER, who is not the owner and was tested for nothing on this
      --       path. Measured by the audit that found it, as two separate
      --       `authenticated` roles: one paid haul through a rival's carrier
      --       (at the 100-Cinder floor) is enough, because the shipper's own
      --       contract row carries rig_id and tct_sel grants them that column —
      --       no uuid guessing. The second dispatch against that rig returned
      --       `{"error":"rig_out_of_runs","cap":1,"used":1,"remaining":0,
      --       "day_key":"…"}` with the attacker's wallet UNCHANGED. So one
      --       purchase bought a permanent, free, precise poll of a stranger's
      --       daily counter — and it answers only when the rig is SPENT, which
      --       is the precise fact trg_sel's comment says must not be published
      --       ("knowing a carrier is out of runs is knowing exactly when to
      --       undercut them"). It is also the read side of the DoS the price
      --       floor was added to make expensive: knowing WHICH rigs are already
      --       spent is what makes burning the rest efficient.
      --
      --    THE CODES STAY FOR EVERYONE, and only the numbers are gated. A
      --    shipper is entitled to know their own dispatch was refused and in
      --    what kind; they are not entitled to the counter behind it. The
      --    already-deployed client degrades correctly with no detail keys:
      --    contracts.js's rig_out_of_runs entry puts `d.cap` through n(), which
      --    returns '?' for an absent value, and falls back to 'UTC' for
      --    day_key, so the sentence still renders and nothing throws; its
      --    rig_on_deployment entry never reads `assigned_to` at all, so
      --    dropping that key from the stranger's arm changes no pixel.
      --    ⚠ REJECTED: dropping the codes as well, or collapsing all four into
      --      one. A refusal with no code lands on explain()'s unknown arm with
      --      nothing for the player to quote to an admin, and a WRONG code is
      --      worse still — that is the 'bad_units' mistake §4.1 records, made
      --      one section UP in this same file and in this same round.
      --    ⚠ 'rig_retired' and 'rig_not_in_fleet' remain bare membership probes
      --      against a rig uuid for anyone who can guess one. Left as-is
      --      deliberately: they carry no number, the shipper needs both to
      --      understand their own refusal, and the uuid has to come from
      --      somewhere — a contract they already paid for. Recorded rather than
      --      closed so the next reader knows it was considered.
      select * into v_rig from public.transport_rigs where id = p_rig_id;
      if not found then
        return jsonb_build_object('ok', false, 'error', 'no_such_rig');
      elsif v_rig.company_id <> p_carrier_id then
        return jsonb_build_object('ok', false, 'error', 'rig_not_in_fleet');
      elsif v_rig.assigned_to is not null then
        if public.is_transport_owner(p_carrier_id) then
          return jsonb_build_object('ok', false, 'error', 'rig_on_deployment',
                                    'assigned_to', v_rig.assigned_to);
        end if;
        return jsonb_build_object('ok', false, 'error', 'rig_on_deployment');
      elsif v_rig.status = 'retired' then
        return jsonb_build_object('ok', false, 'error', 'rig_retired');
      end if;
      if public.is_transport_owner(p_carrier_id) then
        return jsonb_build_object('ok', false, 'error', 'rig_out_of_runs',
                                  'cap', least(v_rig.runs_cap, v_cfg.max_runs_per_rig),
                                  'used', v_rig.runs_used, 'remaining', 0,
                                  'day_key', v_today);
      end if;
      return jsonb_build_object('ok', false, 'error', 'rig_out_of_runs');
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
    --
    -- 🔴 THE RUN COMES BACK UNCONDITIONALLY; THE STATUS DOES NOT. This used to
    --    be `set … status = 'idle' where id = … and day_key = …` with nothing
    --    else, and that flat assignment was a bug with a name in this file:
    --    ONE RIG CAN CARRY MORE THAN ONE HAUL. The run claim above accepts
    --    `r.status in ('idle','hauling')` on purpose — a rig is limited by its
    --    runs and the charter by its bays, not one contract at a time — so a
    --    rig with a second haul still in flight was moved to 'idle' by an
    --    UNRELATED shipper's failed charge. That is not cosmetic: 'idle' is
    --    exactly what the departed trg_del policy checked (`status <> 'hauling'`),
    --    so a stranger's insufficient_cinder walked a mid-haul rig straight
    --    past the guard whose stated purpose was that "retiring one mid-haul is
    --    not [allowed], because the contract would keep an arrival time nobody
    --    is driving towards." §4.6 asks the same question of the contract rows
    --    rather than of this column, and this `case` stops writing the wrong
    --    answer into it.
    -- ⚠ THE `not exists` IS ON THE STATUS ONLY, NEVER ON THE WHOLE UPDATE.
    --   Putting it in the WHERE (the obvious shape) skips the row entirely and
    --   the carrier silently eats the run — which is the exact harm the unwind
    --   was written to prevent, reintroduced by the fix for a different one.
    -- ⚠ NO CONTRACT ROW FOR *THIS* DISPATCH EXISTS YET — the insert is leg 5
    --   and this is the failure path of leg 4 — so every in_transit row this
    --   sees belongs to some other, still-flying haul.
    -- ⚠ A 'retired' RIG IS NOT RESURRECTED, mirroring the `status <> 'retired'`
    --   guard §4.3 uses when it releases a rig. §4.6 refuses to retire a rig
    --   with a live haul, so this is belt; it is here because the day that
    --   refusal is relaxed, this line would otherwise un-retire scrap.
    if v_rig_id is not null then
      update public.transport_rigs r
         set runs_used = greatest(0, r.runs_used - 1),
             status    = case
                           when r.status = 'retired' then r.status
                           when exists (select 1 from public.transport_contracts k
                                         where k.rig_id = r.id and k.status = 'in_transit')
                             then r.status
                           else 'idle'
                         end
       where r.id = v_rig_id and r.day_key = v_today;
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
    --    🔴 A CARRIER IS NOT THEIR OWN REFERENCE — `k.shipper_id <> c.owner_id`,
    --       and it closes a pump AND a griefing lane at the same line, because
    --       the denominator is a two-way door. Nothing in §4.2 checks
    --       `v_co.owner_id <> v_uid`, so a carrier is a legal shipper to their
    --       own charter (deliberately — see §4.1 on why that stays legal), and
    --       before this clause every such haul landed in this fraction:
    --         · pumping — self-haul on repeat and the number walks to 100%,
    --           burying the losses the shipper who paid for them is entitled to
    --           see. That is the whole asset design §5 says a carrier builds.
    --         · griefing — the same denominator is what a RIVAL was buying into
    --           at 1 Cinder a shot (see min_price_per_contract, §1). §4.2
    --           refuses to write a 'refused' row precisely so a script cannot
    --           move this number, and then a successful cheap haul moved it
    --           anyway, because 'lost' is rolled server-side at 16-24% on a
    --           reach-limit route.
    --       Excluding self-dealt rows is the narrow fix for the first; the
    --       price floor is the fix for the second; neither substitutes for the
    --       other.
    --    ⚠ THE SAME PREDICATE LIVES IN §5b's `drift` COLUMN AND MUST STAY
    --      IDENTICAL TO THIS ONE. drift is defined as this cache minus a live
    --      recompute and its pass condition is a hard 0, so a filter present in
    --      one and absent from the other makes every self-dealing carrier read
    --      as corruption for ever. Change them together, exactly like §2's
    --      note on transport_caps' fleet_used and §2b's count.
    update public.transport_companies c
       set reliability = (
             select case when count(*) = 0 then null
                    else round(100.0 * count(*) filter (where k.status = 'delivered')
                               / count(*), 1) end
               from public.transport_contracts k
              where k.carrier_id = c.id
                and k.shipper_id <> c.owner_id
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
  -- 'retired' WAS UNREACHABLE WHEN THIS FUNCTION WAS WRITTEN and §2 told the
  -- next reader to grep before wiring it. §4.6 wires it, so this is that grep's
  -- other end: nothing un-retires a rig, so repairing one buys a condition that
  -- can never haul. Refusing is cheaper than explaining the receipt.
  if v_rig.status = 'retired' then
    return jsonb_build_object('ok', false, 'error', 'rig_retired');
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


-- ── 4.6 · transport_retire_rig — the setter the deleted DELETE policy needs ─
-- 🔴 THIS FUNCTION IS WHY §3 CAN REVOKE DELETE ON THE FLEET TABLE, and it is
--    the same argument transport_set_sheet makes about UPDATE one section up:
--    RLS can only say yes or no to a whole row, and "yes" to a DELETE is "yes"
--    to destroying the daily run counter that row carries.
--    The full postmortem is where trg_del used to be in §3. The short version:
--    runs_used and day_key live on transport_rigs; DELETE was granted; trg_del
--    allowed it for any rig not 'hauling'; trg_ins pins the replacement at 0;
--    registration is free; and §2b's fleet guard counts live rows, not
--    registrations. Settle a haul, delete the rig, re-insert it, full day's
--    runs again — two calls from a devtools console against the bound that is
--    the only thing rate-limiting a carrier's income once the payout leg lands.
--
-- 🔴 WHY IT REFUSES A RIG THAT HAS RUN TODAY, which is the clause doing the
--    actual work and is not obvious. Revoking DELETE alone does not close the
--    hole; it only makes the hole cost one fleet slot. Retirement frees a slot
--    (transport_caps filters 'retired'), registration is free, so retire →
--    register → run → retire → register is the same unbounded loop wearing a
--    different verb. With this clause a slot yields at most
--    least(runs_cap, max_runs_per_rig) runs per UTC day no matter how many rigs
--    pass through it, so a charter's whole daily output is bounded by
--    fleet_cap x max_runs_per_rig — which is EXACTLY what the largest legal
--    fleet could do honestly. The bound refuses nothing an honest carrier can
--    reach and removes the loop entirely. That property is why the counter can
--    stay on the rig row at all.
--    ⚠ It is a DAY-KEY test, not a lifetime one: a rig that ran yesterday
--      retires today without argument. Same database clock and same
--      `to_char((now() at time zone 'utc')::date, …)` as §4.2 and §4.4 — a
--      device clock here would hand the whole bound back to the client.
--
-- ⚠ ONE-WAY, AND THAT IS LOAD-BEARING. Nothing un-retires a rig: trg_ins pins
--   a new row at 'idle', UPDATE is revoked, and no function here writes
--   'retired' → anything. If a future migration adds an un-retire, it MUST run
--   the §2b fleet guard's count first (that guard is INSERT-only, by the note
--   in §2b, so it will not fire) or a carrier un-retires their way past
--   fleet_cap. And it must not zero runs_used, or this refusal becomes bypassable.
--
-- ⚠ THE LIVE-HAUL CHECK ASKS THE CONTRACT ROWS, NOT THE RIG'S STATUS COLUMN.
--   The status column is a cache of the same fact and it has been wrong before:
--   §4.2's charge-failure unwind used to set a rig with a second haul in flight
--   to 'idle' unconditionally, which is precisely how the departed trg_del was
--   walked past. Both checks are here — status for the cheap answer, the
--   contract rows for the true one — for the same "belt to the braces" reason
--   §1 gives the ledger's unique index.
create or replace function public.transport_retire_rig(p_rig_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $function$
declare
  v_uid   uuid := auth.uid();
  v_rig   public.transport_rigs%rowtype;
  v_cfg   public.transport_config%rowtype;
  v_today text;
  v_live  int;
  v_ok    boolean;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select * into v_cfg from public.transport_config where id = 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;

  -- Lock order, one direction everywhere (§4): the rig, then the contracts.
  -- is_transport_owner only READS the charter, so this takes no charter lock
  -- and cannot invert against transport_set_sheet's `for update`.
  select * into v_rig from public.transport_rigs where id = p_rig_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_such_rig');
  end if;
  if not public.is_transport_owner(v_rig.company_id) then
    return jsonb_build_object('ok', false, 'error', 'not_your_rig');
  end if;

  -- Already retired? Hand back the state rather than erroring — RUN_016's rule
  -- and the same one §4.2 and §4.3 follow, so a double-click or a retry after a
  -- dropped connection is harmless rather than alarming. ('retried' is this
  -- file's word for "this call was a repeat"; it is not 'retired' with the
  -- letters moved, and both appear in this payload on purpose.)
  if v_rig.status = 'retired' then
    return jsonb_build_object('ok', true, 'retried', true, 'rig_id', p_rig_id,
                              'status', 'retired',
                              'caps', public.transport_caps(v_rig.company_id));
  end if;

  if v_rig.assigned_to is not null then
    return jsonb_build_object('ok', false, 'error', 'rig_on_deployment',
                              'assigned_to', v_rig.assigned_to);
  end if;

  select count(*) into v_live from public.transport_contracts k
   where k.rig_id = p_rig_id and k.status = 'in_transit';
  if v_rig.status = 'hauling' or v_live > 0 then
    -- The reason the old DELETE policy existed, kept verbatim: a contract would
    -- keep an arrival time nobody is driving towards.
    return jsonb_build_object('ok', false, 'error', 'rig_in_transit',
                              'in_transit', v_live);
  end if;

  v_today := to_char((now() at time zone 'utc')::date, 'YYYY-MM-DD');
  if v_rig.day_key = v_today and v_rig.runs_used > 0 then
    return jsonb_build_object('ok', false, 'error', 'rig_ran_today',
                              'used', v_rig.runs_used,
                              'cap', least(v_rig.runs_cap, v_cfg.max_runs_per_rig),
                              'day_key', v_today);
  end if;

  -- Every condition re-tested in the WHERE, and the result CHECKED — §4.2 and
  -- §4.4 both do this and for the same two reasons. One: the `for update` above
  -- serialises two tabs today, and this is what keeps the guarantee if somebody
  -- ever removes the lock. Two: a bare UPDATE that matches nothing is silent,
  -- and returning ok:true for a retirement that did not happen is the shape of
  -- refusal this file spends its header arguing against — so the miss is
  -- re-read and reported rather than assumed impossible.
  update public.transport_rigs r
     set status = 'retired'
   where r.id = p_rig_id
     and r.status <> 'retired'
     and r.status <> 'hauling'
     and (r.day_key is distinct from v_today or r.runs_used = 0)
  returning true into v_ok;

  if not coalesce(v_ok, false) then
    select * into v_rig from public.transport_rigs where id = p_rig_id;
    return jsonb_build_object('ok', false, 'error', 'rig_not_retired',
                              'status', coalesce(v_rig.status, 'gone'),
                              'used', v_rig.runs_used, 'day_key', v_today);
  end if;

  return jsonb_build_object('ok', true, 'retried', false, 'rig_id', p_rig_id,
                            'status', 'retired', 'was', v_rig.status,
                            'caps', public.transport_caps(v_rig.company_id));
end;
$function$;

revoke all on function public.transport_retire_rig(uuid) from public, anon;
grant execute on function public.transport_retire_rig(uuid) to authenticated;


-- ─── 5. VERIFY ─────────────────────────────────────────────────────────────
--
-- ⚠ COUNT THEM. sql/015's own verify note: "r9 asserted `policies = 6` when the
--   file created 5, and the mismatch survived into two documents because the
--   query was never run." These are not estimated and not counted off the file
--   by eye either — the query below was RUN, on the throwaway cluster the
--   header describes, and every number here is what it returned.
--     tables   5 — companies, rigs, contracts, ledger, config
--     policies 6 — tco_sel, tco_ins | trg_sel, trg_ins | tct_sel | tld_sel.
--                  There is deliberately no *_upd anywhere, no *_del ANYWHERE
--                  either as of this round, no policy of any kind on the
--                  ledger's write commands, and none at all on config.
--                  🔴 IT WAS 7. trg_del is gone — it let a carrier delete and
--                     re-insert a rig to reset the daily run counter that row
--                     carries. Retirement is transport_retire_rig (§4.6) now.
--                     A 7 here means the old policy came back with the file.
--     helpers  4 — is_transport_owner, transport_caps, transport_tariff_ok,
--                  transport_charter_slots_left. Two of the four exist because
--                  a POLICY needs them and would recurse if inlined; all four
--                  read a table no client may read.
--     rpcs     6 — quote, dispatch, settle, repair, set_sheet, retire_rig
--     secdef  12 — all of the above plus the two §2b trigger guards
--                  (4 helpers + 6 RPCs + 2 guards; it was 11 at 5 RPCs)
--     triggers 2 — transport_companies_cap, transport_rigs_cap. THE TWO CAPS
--                  LIVE HERE AND NOWHERE ELSE, so a zero in this column is not
--                  a cosmetic failure: it means the charter cap and the fleet
--                  cap are both unenforced. That is exactly the state two
--                  earlier drafts of this file shipped in.
--     guards   2 — the retry unique indexes: contracts (shipper, client_ref)
--                  and ledger (contract, kind)
--
-- 🔴 THE NEGATIVE ASSERTIONS ARE THE POINT. A verify that only proves the good
--    policies exist never notices the dangerous one that came back. SEVEN of
--    the columns below must read 0 (it was six until floors_off was added):
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
--      · residual_grants is the privilege the enumerated revokes used to walk
--        straight past. Supabase grants ALL on public tables to
--        `authenticated`, ALL includes TRUNCATE, and TRUNCATE consults no
--        policy at all — so it emptied the append-only ledger without touching
--        a single thing the other five negative columns look at. sql/028:11
--        measured the residue an enumerated revoke leaves ("REFERENCES,
--        SELECT, TRIGGER, TRUNCATE"); this counts three of the four across all
--        five tables, SELECT being the one that is wanted and governed by the
--        policies above. See the long note on the revokes in §3.
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
--      · floors_off is the seventh, and it is the only column here that reads
--        a config VALUE rather than a schema object. The price and unit floors
--        are the newest limits in this file and the easiest to undo — one
--        UPDATE in the SQL editor, no schema change, nothing else in this row
--        moves. §4.1's own comment anticipates it by name.
--    And data_constraints is the one POSITIVE assertion added beside them, for
--    the same reason: four CHECK constraints are the entire bound on four
--    client-supplied values, each of them preceded by its own `drop constraint
--    if exists`, and losing one is invisible everywhere else in this row.
--
-- Expect: tables 5 · policies 6 · helpers 4 · rpcs 6 · secdef 12 · triggers 2 ·
--         guards 2 · no_rig_upd_del 0 · no_co_upd 0 · no_ledger_write 0 ·
--         no_cfg_pol 0 · disabled_triggers 0 · guards_not_volatile 0 ·
--         ledger_balance_cols 0 · residual_grants 0 · over_ceiling_sheets 0 ·
--         over_fleet_cap 0 · data_constraints 4 · floors_off 0 · cfg_rows 1
-- Run on an empty database this returned exactly that row, three applications
-- in. On the populated one it returned it too, except for over_fleet_cap — see
-- the header: it read 1 while a deliberately unguarded charter was on the
-- table, which is the only evidence anyone has that the column works.
-- data_constraints and floors_off were added in a later pass and re-run the
-- same way: three clean applications returning 4 and 0, and then each one
-- driven positive by sabotaging exactly what it watches — the name CHECK
-- dropped (data_constraints 3) and min_price_per_contract set to 0
-- (floors_off 1). A verify column nobody has seen return the WRONG number is
-- only half a verify column.
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
        'transport_repair','transport_set_sheet','transport_retire_rig'))             as rpcs,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.proname in
       ('is_transport_owner','transport_caps','transport_tariff_ok',
        'transport_charter_slots_left','transport_quote','transport_dispatch',
        'transport_settle','transport_repair','transport_set_sheet',
        'transport_retire_rig',
        'transport_charter_cap_guard','transport_fleet_cap_guard'))                    as secdef,
  -- The caps themselves. `not tgisinternal` excludes the FK enforcement
  -- triggers Postgres creates for `references`, which are not ours to count.
  (select count(*) from pg_trigger t join pg_class r on r.oid = t.tgrelid
     join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public' and not t.tgisinternal
      and t.tgname in ('transport_companies_cap','transport_rigs_cap'))                as triggers,
  (select count(*) from pg_indexes where schemaname = 'public'
     and indexname in ('transport_contracts_ref_uniq','transport_ledger_once'))       as guards,
  -- DELETE joined UPDATE here when trg_del was removed: a DELETE policy on
  -- this table is a reset button on the daily run counter, not a tidy-up.
  (select count(*) from pg_policies where schemaname = 'public'
     and tablename = 'transport_rigs' and cmd in ('UPDATE','DELETE'))                  as no_rig_upd_del,
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
  -- 🔴 THE PRIVILEGE NO POLICY CAN SEE. Counts tables where a CLIENT ROLE
  --    still holds any of the three grants the enumerated revokes used to miss.
  --    A non-zero here means one of the revokes in §3 was edited or a later
  --    migration re-granted ALL — and TRUNCATE bypasses RLS entirely, so no
  --    other column in this row would notice.
  --    ⚠ `anon` JOINED `authenticated` HERE THIS ROUND, and the omission was a
  --      real hole rather than tidiness: every revoke in §3 already names both
  --      roles, but this column asked about only one of them. TRUNCATE is the
  --      single command that consults no policy at all, so a later migration
  --      re-granting ALL to `anon` would have made the append-only ledger
  --      truncatable by every logged-out visitor holding the publishable key
  --      while this column went on reading 0 — a verify that cannot see the
  --      failure it was added for. Measured rather than reasoned: with `grant
  --      truncate on public.transport_ledger to anon` in force on the 16.13
  --      stub cluster, the old authenticated-only predicate returned 0 and this
  --      one returns 1.
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('transport_companies','transport_rigs',
                        'transport_contracts','transport_ledger','transport_config')
      and (has_table_privilege('authenticated', c.oid, 'TRUNCATE')
        or has_table_privilege('authenticated', c.oid, 'TRIGGER')
        or has_table_privilege('authenticated', c.oid, 'REFERENCES')
        or has_table_privilege('anon',          c.oid, 'TRUNCATE')
        or has_table_privilege('anon',          c.oid, 'TRIGGER')
        or has_table_privilege('anon',          c.oid, 'REFERENCES')))                 as residual_grants,
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
  -- 🔴 THE TWO CLAIMS THIS FILE ASSERTED IN ITS HEADER AND CHECKED NOWHERE.
  --    Both were added by the same round that added residual_grants "so the
  --    claim is checked rather than asserted", and both were left out of it.
  --    data_constraints: the four named CHECKs that are the ONLY bound on four
  --    client-supplied values — the carrier name and home_node_id (the one
  --    world-readable row), vehicle_id, the tariff object, and the ledger's
  --    sign rule. `drop constraint if exists` runs one line above each `add`,
  --    so a half-applied paste leaves the drop and loses the constraint, and
  --    every other column in this row still reads exactly as specified.
  --    contype = 'c' and the namespace join because conname is unique per
  --    table, not per database.
  --    floors_off: the price and unit floors are CONFIG, not schema, and §4.1
  --    explicitly anticipates "a future operator tuning min_units_per_contract
  --    to 0 in the SQL editor". Nothing else in this row can see that — the
  --    columns still exist, the RPCs still reference them, and the floor is
  --    simply gone. This is the only column that looks at their VALUES.
  --    🔴 AND RE-RUNNING THIS FILE DOES NOT PUT A TUNED FLOOR BACK, which is
  --       the whole reason this column has to exist rather than the paste being
  --       the remedy. §1's config insert is `on conflict (id) do nothing`, on
  --       purpose ("must not silently reset a ceiling somebody tuned in the SQL
  --       editor after an incident"). Measured on the 16.13 stub cluster: with
  --       min_price_per_contract set to 0, a full re-application restored the
  --       dropped CHECK and the missed revoke — data_constraints back to 4,
  --       residual_grants back to 0 — and floors_off STAYED 1. The paste heals
  --       schema; only a human heals config.
  --    ⚠ Both are hard 0/4. A 3 in data_constraints does not say WHICH one is
  --      missing; query pg_constraint by name when it fires.
  (select count(*) from pg_constraint k
     join pg_class kc on kc.oid = k.conrelid
     join pg_namespace kn on kn.oid = kc.relnamespace
    where kn.nspname = 'public' and k.contype = 'c'
      and k.conname in ('transport_companies_name_ck','transport_companies_tariff_ck',
                        'transport_rigs_vehicle_id_ck','transport_ledger_sign_ck'))    as data_constraints,
  (select count(*) from public.transport_config
    where id = 1
      and (min_units_per_contract <= 0 or min_price_per_contract <= 0))                 as floors_off,
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
       -- `k.shipper_id <> c.owner_id` mirrors §4.3's recompute EXACTLY. If the
       -- two ever differ, every carrier who has hauled their own cargo reads as
       -- drift for ever and this column stops meaning anything.
       coalesce(c.reliability, -1) - coalesce((
         select round(100.0 * count(*) filter (where k.status = 'delivered') / count(*), 1)
           from public.transport_contracts k
          where k.carrier_id = c.id
            and k.shipper_id <> c.owner_id
            and k.status in ('delivered','late','lost','refused')
          having count(*) > 0), coalesce(c.reliability, -1))                                as drift,
       (select coalesce(sum(l.amount), 0) from public.transport_ledger l
         where l.company_id = c.id)                                                         as owed
from public.transport_companies c
order by c.name;
