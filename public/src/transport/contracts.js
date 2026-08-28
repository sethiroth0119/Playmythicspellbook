/* ═══════════════════════════════════════════════════════════════════════════
   contracts.js — EVERY Supabase call for Transportation Companies.

   Nothing else in /src/transport touches the client. If a `.from(` or an
   `.rpc(` lives in another file in this directory, that is the bug, not a
   convenience — there is exactly one place where this feature can spend a
   player's money or read another player's row, and this is it.

   ─── HOW THIS FILE CITES OTHER FILES, and why there are no line numbers ─────
   🔴 EVERY CITATION INTO A FILE THAT MOVES (index.html, index.js, depot.js,
   sql/038) IS A NAMED SYMBOL. It did not start
      that way, and the reason it is now is a measured failure rather than a
      style preference: this header and the comments below carried hard line
      numbers into index.html, index.js and depot.js, and a sweep on 2026-08-28
      found that every index.html and every index.js number had rotted. Only
      the depot.js one still landed, and it was rewritten as a symbol anyway so
      it cannot be the next casualty. index.html had grown, so getTodayKey()
      had moved 71039 → 71048, OPS_ECON 79732 → 79741, corpTreasuryDeposit()
      79679 → 79688 and `_vmCreditSeller` 195581 → 195909; every index.js
      number was pointing at unrelated prose, because index.js is edited in the
      same rounds this file is. One of them was not even a comment:
      repairBill()'s not_priced remedy printed a hard index.html line number
      for OPS_ECON straight into the toast, so the one person actually trying
      to act on it was handed a wrong address.
   ⚠ SO: name the function, the branch or the table — `depotReady()`'s drift
     `fix` line, index.js's 'tariff' branch, transport_rigs' status CHECK — and
     let the reader grep. A symbol survives an edit in the other file; a number
     is only true until the next commit, and index.html is 11.6 MB of moving
     target. If a number is genuinely wanted as a scrolling hint, index.html's
     own convention is to mark it soft with a `~` — but this file does not use
     even that, because a soft wrong number still sends a reader to the wrong
     place.

   ─── THE DEGRADATION CONTRACT ───────────────────────────────────────────────
   ⚠ THE TABLES DO NOT EXIST YET. sql/038_transport_companies.sql has never been
   run against ktsiasyjusesawtrwrjc — there is no CLI login in this repo, so it
   is pasted BY HAND into the Supabase SQL editor, and the window between "the
   module ships" and "someone pastes it" will last days. Every export therefore
   returns a typed envelope and NONE of them throws at its caller: empty data
   plus a `missing` flag, so the panel says "run sql/038" instead of breaking
   the depot. This mirrors community.api.js, which states the same contract, and
   the Corp.* helpers before it.

   ─── WHERE THE MONEY ACTUALLY MOVES, because it is not all in one place ─────
   This file is judged as a money file, so the map is written down rather than
   inferred:
     · The FREIGHT FEE is charged SERVER-SIDE. transport_dispatch() calls
       wallet_charge() (sql/023) with a price IT computed from the carrier's
       stored tariff. This file never debits Cinder for a haul, and must never
       be "fixed" to, because that would charge the shipper twice.
     · The CARGO is escrowed CLIENT-SIDE, because it has to be. sql/038's own
       header publishes the limit: cargo lives in an opaque save blob, "the
       server CANNOT recompute a haul from first principles. It can only BOUND
       one." So the manifest leaves the stash here, at dispatch, and comes back
       here, on a delivered settlement. That is the atomic-spend path below.
     · The REPAIR BILL is charged CLIENT-SIDE, and sql/038 says so in the body
       of transport_repair: "the parts and the bill are charged client-side and
       the server cannot verify either… Do not read this function as verifying a
       repair was paid for." Its bound is max_repairs_per_rig_day.
     · THE CARRIER IS NEVER PAID FROM HERE. transport_settle writes a positive
       append-only transport_ledger row — an audited CLAIM, not cash. Balance is
       `sum(amount)`; there is no balance column and no cash-out RPC in this
       release. Crediting the carrier locally on settle would MINT Cinder: the
       shipper's payment was already burned by wallet_charge, so paying it out
       again on the client creates units nobody destroyed. That is precisely the
       unattributable faucet index.html's addGems() `reason` argument exists
       for — a week of production showing "+602,357 🔥 of reconcile gains… with
       nothing attributing a single unit of it to a source".

   ─── 📋 WHAT WAS ACTUALLY MEASURED, and on what, 2026-08-28 ────────────────
   Recorded because "the refund unwinds" is the claim money code in this repo
   has been wrong about before. Driven against a stub bridge and a stub
   PostgREST client (19 cases, then 13 more for the quote seam below, all
   passing) — NOT against ktsiasyjusesawtrwrjc, which has none of these tables:
     · every export returns its typed envelope with no bridge mounted, and the
       module imports without throwing
     · a repair whose RPC refuses put back 900 🔥 and 10 metal exactly
     · a `false` from spendGems refunded the parts leg
     · a dispatch refused after the escrow returned all 40 units into a vault
       ALREADY AT ITS CAP — which is the refundRes-versus-addRes distinction
       being real rather than asserted
     · a settle marked `retried` credited nothing; a settle by the carrier
       credited nothing; a delivery into a vault with room for 10 of 40
       reported the 30 out loud
     · a dispatch answered `retried: true` handed the second escrow back, so a
       resend of a lost call does not take the cargo twice
     · an unknown error code came back containing its own code verbatim
     · a PGRST202 came back naming signature drift AND the nine arguments sent
   And the quote-versus-request seam, driven against routes.js's REAL
   meridianQuote() output rather than a hand-written stand-in for it, because a
   hand-written one would agree with whatever this file assumed:
     · a bare quote object came back as `quote_not_request`, NOT as `bad_cargo`,
       and deducted nothing
     · the enriched object index.js actually sends shipped: the manifest reached
       p_cargo intact, p_units was summed from it (40, not read off the quote),
       p_hops came off the quote, the escrow took exactly 40, and the RPC was
       called with exactly nine named arguments
     · `dispatch({ cargo: {} })` still answered `bad_cargo` — the two failures
       stayed two failures with two fixes
     · a manifest of 80 against a fare quoted for 40 was refused before the
       escrow ran; a manifest of 10 against the same fare shipped
   And the two seams below, 42 more cases, all passing, driven against
   transport_set_sheet's REAL envelope shape and sql/038's REAL raise payloads
   copied out of the file rather than paraphrased:
     · setTariff read bays / fleet_cap / reach / fleet_used / fleet_slots_left
       out of the nested `caps` object where the server actually puts them, and
       charter_slots_left off the envelope — every one of them was `undefined`
       before, read off the top level (see the note at the return itself)
     · a `caps: null` (transport_caps' answer for a company that does not exist)
       and a non-owner's caps object with its owner-only keys absent both came
       back as null and NOT as 0, so `fleetCap > 0` is false when the number is
       unknown instead of quietly true
     · a `fleet_cap` raise with its owner detail produced "all 4 fleet slots are
       taken" rather than the toast `🚛 fleet_cap`; the same code with the
       NON-owner's bare `{"error":"fleet_cap"}` produced a sentence with no `?`
       in it; a cap already equal to max_fleet_rigs said a higher depot will not
       help instead of advising a level nobody can use
     · charter_cap and transport_config_missing likewise, and neither set
       `missing` — a capped fleet must not read as an unapplied migration
     · a unique-constraint violation and an RLS refusal came back VERBATIM with
       no `why` invented, and `relation … does not exist` kept `missing: true`
     · a `details` carrying prose, malformed JSON, nothing at all, or an already
       parsed object each degraded to `{}` without throwing
     · registerRig() and createCompany() were driven against a PostgREST stub
       that fails their insert, and the sentence reached the caller
   And the three refusal codes sql/038's own gap list named as missing from the
   ERROR TABLE — `under_price_floor`, `units_below_min`, `rig_ran_today` — 98
   more cases, all passing, driven against the raise payloads copied out of
   sql/038 rather than paraphrased from them:
     · EVERY entry in the table, not just the new three, returns a non-empty
       why and fix off an empty `d` and off explain() called with no `d` at all,
       with no 'undefined', 'NaN' or '[object Object]' reaching a sentence
     · the quote refusal a player actually meets — `{price:5, floor:100,
       units:1, hops:1}` — reads "under the exchange floor of 100 🔥 per
       contract" instead of explain()'s unknown arm, and says "more than 1 unit"
       rather than "1 units"
     · fleet_cap's owner arm, its ceiling arm and the guard's bare non-owner
       `{"error":"fleet_cap"}`, and charter_cap with and without its detail, name
       NO remedy this build cannot perform — asserted by a regex over the fix
       line, so the promise cannot creep back in unnoticed
     · an unknown code still comes back containing its own code verbatim
   ⚠ WHAT THIS DOES NOT PROVE. No test ran against real PostgREST, so the
     argument-set claim below is argued from sql/038's declared signature, not
     demonstrated against a live schema cache. Nothing here has seen a real
     wallet_charge. Do not read this block as saying the feature works.

   ─── THE GLOBALS TRAP (CLAUDE.md), which has already cost this project time ──
   `Profile`, `Cloud`, `App`, `Corp` and `Forge` are top-level `const` in
   index.html. A top-level `const` in a classic script is a global LEXICAL
   binding and is NOT a property of the global object, so `window.Profile` is
   undefined however global it looks, and an ES module cannot reach another
   script's lexical scope at all. Everything here arrives through `bridge()`.
   Nothing in this file reads a bare global; if it needs something new from the
   legacy app, it goes on the bridge — in BOTH halves — not around it.

   ─── A REJECTED DESIGN, recorded so it is not re-proposed ───────────────────
   🔴 RIGS ARE NOT SOLD CROSS-PLAYER ON THE EXISTING P2P VEHICLE MARKET, and
      that market is not extended to do it. Two concrete reasons, both in the
      live code:
        · `_vmCreditSeller` (in index.html) is a documented no-op:
          `if (sellerId === _vmMyId() …) addCinders(amount); // TODO: Supabase
          RPC for true cross-player credit.` A "sale" therefore destroys the
          buyer's Cinder and pays the seller nothing at all.
        · `Forge.vehicleMarket` rides each player's own `user_profiles.forge`
          row (index.html hydrates it there and merges it on cloud load), so a
          listing never leaves the account that made it. There is no shared
          market to sell into.
      Building fleet trading on that would have shipped a storefront where money
      vanishes and stock is invisible. Rigs come off the Prince Portfolios
      auction floor, which each player already runs against NPC sellers.

   ─── ANOTHER, smaller: the DAY KEY is not sent ──────────────────────────────
   `bridge().todayKey()` exists and is display-only. The runs/day counter and
   its day_key are computed from the DATABASE clock inside transport_dispatch(),
   because index.html's getTodayKey() is `new Date()` on the device with
   no anchor: moving the OS clock mints a fresh day. That is tolerable for a
   counter that only cheats the player themself, and not tolerable for a rate
   limit other players are paying Cinder against. Same call v120g0 made when
   world chat moved to the chat_send() RPC.
   ═══════════════════════════════════════════════════════════════════════════ */

import { bridge, bridgeReady } from './transport.bridge.js';

/* ═══ 1 · WHAT COUNTS AS "NOT INSTALLED" ═══════════════════════════════════ */

/* 🔴 THIS DECIDES ONE THING ONLY: "the migration has not been run", as opposed
   to a real failure. It must NEVER be used to decide the market is EMPTY. A
   rate board with no carriers on it and a rate board whose table does not exist
   are two different sentences to the player — "nobody is carrying yet, found a
   charter" versus "run sql/038 in the Supabase editor" — and collapsing them
   loses the only one an admin can act on. index.html's ResMarket.tableMissing
   test carries the same rule in a comment on its own copy of this regex.

   Three families, three different missing things, all of them meaning "the
   schema is not there yet":
     missing TABLE     PGRST205 · 42P01 · 'relation … does not exist'
     missing FUNCTION  PGRST202 · 42883 · 'Could not find the function'
     missing COLUMN    PGRST204 · 42703
   ⚠ NO /g AND NO /y FLAG, deliberately. A global RegExp keeps `lastIndex`
     between `.test()` calls, so the SAME error string tests true, then false,
     then true — the "run sql/038" banner would appear on every other refresh
     and read as a flapping backend. index.js already rebuilds it stateless
     before use; this side must not need it to. */
export const MISSING_RE =
  /PGRST205|PGRST204|PGRST202|42P01|42883|42703|does not exist|could not find|schema cache/i;

/* 🔴 THE NAMED-DEPENDENCY BRANCH, and it goes FIRST — before the generic
   missing-schema test above ever runs.

   index.html's bank_open_cinder error branch is a monument to getting this
   order wrong, in its own words: "'does not exist' does NOT mean the RPC is
   missing. It also fires when the function EXISTS but a table INSIDE it does
   not — which is exactly what
   happened: bank_open_cinder reads public.public_profiles, a table that never
   existed, so this branch told the admin to run a .sql file they had already
   run, FOUR SEPARATE TIMES. Name the real error instead of guessing at a
   cause."

   The same shape is live here: every transport RPC calls transport_quote, and
   transport_dispatch calls wallet_charge from sql/023. If 023 was never
   applied, the raw string is `function public.wallet_charge(…) does not exist`
   — and telling that admin to run sql/038 sends them to the wrong file. So a
   dependency this file knows about by name is reported by name. */
const DEP_RE = /wallet_charge|wallet_ledger|user_profiles|auth\.users|transport_config/i;

/* The shape a caller gets when there is no session at all. `offline` is a
   THIRD state beside ok and missing on purpose — it is not an error, it is a
   designed state, and it gets its own sentence. */
export const OFFLINE = { ok: false, missing: false, offline: true, error: 'not signed in' };

/* Two ways to have no client, and they are not the same problem, so they are
   not the same sentence. bridgeReady() is false when index.html has not handed
   the module its capabilities (the feature is inert and a developer must wire
   the bridge); it is true, with no signed-in session, when the player is simply
   logged out (the player can fix it). */
function offWhy() {
  return bridgeReady()
    ? 'You are signed out — the freight exchange needs a connection.'
    : 'The freight bridge has not mounted, so the depot is inert. index.html must publish window.MythicTransportBridge.';
}

/* Never throws, never returns a half-built client. Touching `window` can throw
   in a sandboxed frame, and `signedIn()` is a bridge call that may itself throw
   before the game has finished booting — so the whole thing is wrapped and a
   failure is simply "no client". */
function client() {
  const b = bridge();
  try {
    if (!b || !b.cloud || !b.cloud.client) return null;
    if (!b.signedIn()) return null;
    return b.cloud.client;
  } catch (e) { return null; }
}

/* The one place a raw error becomes an envelope. Exported because index.js
   classifies on the same flags and a second copy of this rule would be a second
   answer to "is the schema missing?". */
export function fail(e) {
  const msg = (e && (e.message || e.msg || e.details || e.code)) || String(e || '');
  const s = String(msg);
  return { ok: false, offline: false, missing: MISSING_RE.test(s), error: s };
}

/* ═══ 2 · THE ERROR TABLE ══════════════════════════════════════════════════
   Every refusal transport_quote / transport_dispatch / transport_settle /
   transport_repair / transport_set_sheet can return, with its own sentence and
   its own `fix`. This list is copied from the `jsonb_build_object('ok', false,
   'error', …)` sites in sql/038 and NOTHING ELSE decides what a code means.

   🔴 IT COVERS TWO SOURCES NOW, NOT ONE, AND THAT IS A BUG FIX RATHER THAN A
      GENERALISATION. There are exactly two writes in this file that are NOT
      RPCs — createCompany() and registerRig() are direct PostgREST inserts —
      and sql/038 guards both of them with a BEFORE INSERT trigger rather than
      a WITH CHECK (§2b: a `stable` helper inside a WITH CHECK reads the
      pre-statement snapshot, so one `insert … select from generate_series`
      walked past both caps). A trigger refuses by RAISING, so its code arrives
      as an exception MESSAGE on `r.error` and never touches the jsonb envelope
      rpc() unpacks. Those two paths therefore went through fail() alone, which
      keeps `e.message` and nothing else: a player who registered one rig past
      the yard's parking got the toast `🚛 fleet_cap`, and a player founding a
      fourth charter got `🚛 charter_cap` — the raw code, straight out of
      Postgres, in a toast. index.js's reasonOf() was not at fault; it prints
      `r.error` only because there was no `why` to print. depotReady()'s drift
      `fix` line in depot.js states the intended contract in as many words
      ("Registering a rig past the exchange's cap is refused as 'fleet_cap'")
      as something the player is supposed to be able to ACT on, and neither
      string existed anywhere in
      /src/transport. failCoded() below routes those two inserts through this
      same table, so there is still exactly one place a code becomes a
      sentence. The trigger codes are marked ⚡ where they appear.

   ⚠ THE LIST CAN GO STALE, and staleness inverts the check: a code added to
     sql/038 and not added here falls through to the unknown arm, which prints
     the code verbatim. That is the correct direction to fail in — the player
     sees `over_weight_cap` and an admin can grep for it — but it is a worse
     message than a written one, so a new refusal in sql/038 wants a line here.
     What must NEVER happen is the opposite: inventing a plausible cause for a
     code this build has not seen. sql/037:16-23 is the other half of the same
     lesson — an unhandled code fell through to a generic "nothing moved" that
     hid a hard crash for the entire life of that feature.

   The `d` argument is the RPC's own jsonb: sql/038 deliberately ships the
   numbers a client needs to write a sentence (cap, used, remaining, needed,
   bays, reach), so the message states them instead of gesturing at them. For a
   ⚡ trigger code `d` is the parsed `detail` string instead — the guards build
   it with the same jsonb_build_object and the same key names on purpose, so one
   table reads both. ⚠ EVERY ENTRY MUST SURVIVE AN EMPTY `d`: the fleet guard
   deliberately sends the bare `{"error":"fleet_cap"}` to a NON-owner, on the
   grounds — its own words, in sql/038 §2b — that "an error message is a read
   path" and a rival's yard size is competitive information. A sentence that
   assumed `d.cap` would print "all ? slots" there, or throw into explain()'s
   catch and lose the written message entirely. */
const CODES = {
  not_authenticated: () => ({
    why: 'The freight service did not recognise your session.',
    fix: 'Sign in again — a tab left open since before the session expired looks exactly like this.',
  }),
  closed: () => ({
    why: 'The freight exchange is closed (transport_config.enabled is false).',
    fix: 'Nothing is wrong with your depot — an admin has the exchange switched off.',
  }),
  /* ⚡ Raised by BOTH §2b guards when the id=1 row of transport_config is gone.
     🔴 THIS IS THE ONE BRANCH IN THIS FILE THAT IS ALLOWED TO SAY "RE-RUN
        SQL/038", and it says it because the server NAMED the missing thing
        rather than because this file guessed a cause. That is the whole lesson
        of index.html's bank_open_cinder branch, where "does not exist" was
        read as "the RPC is missing" and sent an admin back to a migration they
        had already
        applied FOUR TIMES: the sin is guessing, not the advice. Here the guard
        raises `transport_config_missing` with the hint "The id=1 row of
        transport_config is gone. Re-run sql/038." — the file is idempotent and
        its config insert is `on conflict do nothing`, so re-running restores
        the row and resets nothing an admin tuned.
     ⚠ AND IT DOES NOT SET `missing`. Rejected: flagging this as a missing
       schema so the panel raises its "run sql/038" banner. `missing` means the
       TABLES are not there and the whole depot degrades to empty; here they
       plainly are — the insert reached a trigger — and blanking a working
       depot over one absent config row would hide the carrier's own fleet
       behind a banner about installation. It is a refusal with a remedy, and
       the remedy fits in the refusal. */
  transport_config_missing: () => ({
    why: 'Freight is installed, but its configuration row is missing, so the exchange cannot tell what its own caps are — and a missing cap must never read as "no cap".',
    fix: 'Re-run sql/038_transport_companies.sql in the Supabase editor. It is idempotent and its config insert is `on conflict do nothing`, so it restores the id=1 row without resetting a ceiling anyone has tuned.',
  }),

  /* ── routing / quote ──────────────────────────────────────────────────── */
  bad_hops: (d) => ({
    why: d.hops === 0 || d.hops == null
      ? 'No route length was sent with that haul, so the exchange has nothing to price.'
      : 'That route is ' + n(d.hops) + ' hops and the exchange carries at most ' + n(d.max_hops) + '.',
    fix: 'Ship to somewhere closer, or in two legs.',
  }),
  bad_units: (d) => ({
    why: n(d.units) + ' units is outside what one contract carries (max ' + n(d.max_units) + ').',
    fix: 'Split the load across two hauls.',
  }),
  /* THE MINIMUM AND THE MAXIMUM ARE TWO CODES ON PURPOSE, and transport_quote
     says why at its own raise site: folding "too small" into `bad_units` would
     have printed bad_units' remedy — "split the load across two hauls" — at a
     load that is too small, and that is not a vague answer, it is the OPPOSITE
     of the fix, because each half is smaller and refused harder. So `bad_units`
     keeps exactly the payload the shipped client already knows (units,
     max_units) and this one carries `min_units`.
     ⚠ LATENT, NOT DEAD. normCargo() below floors every manifest line to an
       integer and drops anything under 1, and min_units_per_contract defaults
       to 1, so nothing the panel can build reaches this today. It is written anyway because that default is an
       operator-tunable column: raising it in the SQL editor makes this
       reachable with no deploy, and sql/038's own gap list named this code as
       missing from this table. */
  units_below_min: (d) => {
    const min = Number(d.min_units);
    const got = Number(d.units);
    return {
      why: Number.isFinite(min)
        ? 'A contract carries at least ' + n(min) + ' units'
          + (Number.isFinite(got) ? '; that manifest is ' + n(got) + '.' : '.')
        : 'That manifest is under the smallest load the exchange will carry.',
      fix: 'Send more in one load — the minimum is per contract, so splitting the run makes it worse, not better.',
    };
  },
  bad_route: () => ({ why: 'Both ends of the route have to be real places.', fix: 'Pick an origin and a destination.' }),
  same_node: () => ({ why: 'The cargo is already there.', fix: 'Pick a different destination.' }),
  out_of_reach: (d) => ({
    why: 'That carrier reaches ' + n(d.reach) + ' hops from its depot; this haul is ' + n(d.hops) + '.',
    fix: 'Hire a carrier closer to the route, or ship with Meridian Haulage.',
  }),
  no_tariff_published: () => ({
    why: 'That carrier has not published a rate yet, so the exchange cannot quote them.',
    fix: 'Pick another carrier, or ship with Meridian Haulage.',
  }),
  over_price_cap: (d) => ({
    why: 'That haul prices at ' + n(d.price) + ' 🔥, over the exchange ceiling of ' + n(d.cap) + ' 🔥.',
    fix: 'Fewer units or fewer hops — the price is units × hops × the tariff.',
  }),
  /* 🔴 THE FLOOR — the refusal a player meets AFTER the money dialog, which is
        why it is worth this many lines. transport_quote refuses
        `under_price_floor` when the price it built is below
        transport_config.min_price_per_contract (default 100), at the same
        single exit the ceiling refuses at, and transport_dispatch hands
        transport_quote's refusal back verbatim.
        THE BUG THIS CLOSES, recorded rather than quietly corrected: with no
        entry here the code fell through to explain()'s unknown arm, so a
        player quoted "5 🔥" for a 1-unit 1-hop haul, who then said yes to
        gcConfirm() and had the cargo escrowed out of the stash, was answered
        with "a code this build does not know". Every player tariff under
        100 ÷ (units × hops) does this — which is most small hauls on the
        board. It is exactly the "shown one number, refused by another" failure
        routes.js's header forbids, delivered in the least readable form there
        is.
     ⚠ THIS ENTRY IS THE SAFETY NET, NOT THE FIX. The refusal belongs BEFORE
       the confirm, in the SHEET mirror and priceRefusal() in routes.js — a
       floor arm beside the ceiling arm those already share between the player
       and Meridian paths. This table only guarantees that one which gets
       through reads as a sentence instead of as a word.
     ⚠ IT REFUSES, IT DOES NOT CLAMP, and the remedy must never imply the
       exchange will round the fare up to the floor. sql/038 rejects clamping
       in as many words at the raise site, because clamping charges a shipper
       more than the sheet they were shown.
     ⚠ AND MERIDIAN IS NOT OFFERED AS THE ESCAPE HATCH here, though it is the
       remedy for `blacklisted` and `out_of_reach` two entries up. Meridian's
       own minimum fare is 40 × 2.5 = exactly 100, sitting ON the floor: the
       floor refuses nothing the NPC could sell, and the NPC cannot undercut it
       either, so "ship with Meridian" would be advice that fails again. */
  under_price_floor: (d) => {
    const price = Number(d.price);
    const floor = Number(d.floor);
    const units = Number(d.units);
    return {
      why: Number.isFinite(price) && Number.isFinite(floor)
        ? 'That haul prices at ' + n(price) + ' 🔥, under the exchange floor of ' + n(floor) + ' 🔥 per contract.'
        : 'That haul prices under the exchange’s floor for a single contract.',
      fix: Number.isFinite(units)
        ? 'Send more than ' + n(units) + (Math.abs(units) === 1 ? ' unit' : ' units') + ' in one load — the floor is per contract, not per unit, so splitting the run cannot reach it.'
        : 'Send more in one load — the floor is per contract, not per unit, so splitting the run cannot reach it.',
    };
  },

  /* ── carrier state ────────────────────────────────────────────────────── */
  no_such_carrier: () => ({ why: 'That carrier is no longer on the exchange.', fix: 'Refresh the rate board.' }),
  carrier_closed: (d) => ({
    why: 'That carrier is ' + (d.status || 'not open') + ', not trading.',
    fix: 'Pick another carrier from the board.',
  }),
  /* Meridian is the answer to this one BY DESIGN — it is a price ceiling that
     exists so a carrier cannot end another player's game by refusing them. */
  blacklisted: () => ({
    why: 'That carrier has refused your business.',
    fix: 'Ship with Meridian Haulage — it never refuses anyone; that is what it is for.',
  }),
  no_free_bay: (d) => ({
    why: 'All ' + n(d.bays) + ' of that carrier’s bays are loaded (' + n(d.in_transit) + ' in transit).',
    fix: 'Wait for one of their hauls to land, or hire someone else.',
  }),
  not_your_company: () => ({
    why: 'That charter is not yours.',
    fix: 'Reopen the depot — the panel is holding a company id that has changed hands.',
  }),
  bad_tariff: () => ({ why: 'That rate sheet is not a tariff the exchange can read.', fix: 'A tariff is a positive number of Cinder per unit·hop.' }),
  bad_status: () => ({ why: 'A charter is open, paused or closed — nothing else.', fix: 'Pick one of the three.' }),
  /* ⚡ transport_charter_cap_guard, on INSERT into transport_companies.
     The numbers are safe to print because sql/038 says so at the raise site:
     tco_sel is `using (true)`, so anybody can already count anybody's charters
     and the detail publishes nothing a query would not. Contrast fleet_cap
     below, which is the same shape and is NOT in that position.
     🔴 AND THE REMEDY IS "THERE ISN'T ONE", because that is what is true. The
        sentence this replaces — "Close an existing charter before founding
        another" — was copied from the guard's own HINT and describes an action
        that does not change the counted quantity: transport_charter_cap_guard
        counts `count(*) … where c.owner_id = new.owner_id` with NO status
        filter, so a charter set to 'closed' through transport_set_sheet still
        occupies its slot, and DELETE on transport_companies is revoked with no
        DELETE policy anywhere, so the row cannot leave either. Telling a player
        to perform a ritual that provably does nothing is worse than telling
        them the cap is the cap.
     ⚠ THE SERVER HINT STILL SAYS THE OLD THING. It lives in sql/038, at
       transport_charter_cap_guard's raise, and that file is not this seam's to
       edit; until it is changed the two sides disagree and THIS is the true
       half. The hint never reaches a player through this file — failCoded()
       and explain() both read the DETAIL's code and this table, never HINT.
     ⚠ REJECTED: filtering the guard's count to `status <> 'closed'` so the old
       sentence becomes true. That is a rule change, not a copy fix — a closed
       charter still carries reliability history and still passes the median's
       sample gate — and it needs its own note in the migration that owns it.
     Scored minor because the shipped panel refuses locally before the insert
     ("You already run a carrier on the exchange") whenever myCompany() found a
     row, so only a console reaches this guard — which is precisely the reader
     most likely to act on a sentence. */
  charter_cap: (d) => ({
    why: Number.isFinite(Number(d.cap))
      ? 'You already hold ' + n(d.used != null ? d.used : d.cap) + ' of the ' + n(d.cap) + ' charters one player may run.'
      : 'You already hold every charter one player may run.',
    fix: 'A charter is permanent — closing one does not free the slot, and nothing in this build can delete it. This is the cap for the account.',
  }),
  blacklist_too_long: (d) => ({
    why: 'A refusal list holds ' + n(d.max) + ' shippers; that one has ' + n(d.sent) + '.',
    fix: 'Drop some names before saving.',
  }),

  /* ── the fleet ────────────────────────────────────────────────────────── */
  /* ⚡ transport_fleet_cap_guard, on INSERT into transport_rigs — the code
     depotReady()'s drift `fix` line in depot.js already promises the player,
     and the one this file was printing raw.
     🔴 THE SENTENCE IS WRITTEN OFF THE DETAIL AND NEVER OFF A FORMULA. The
        ladder is `least(4 × depot_level, max_fleet_rigs)` and sql/038 §2 is
        emphatic that transport_caps() is the ONE place it is evaluated —
        "four copies of a formula is four authorities, and the day one of them
        is tuned the carrier is shown a fleet cap the server does not enforce".
        So this states the cap the refusal itself carried and computes nothing.
     ⚠ TWO SHAPES, because the guard has two arms: the owner gets cap/used/
       max_fleet_rigs, a non-owner gets `{"error":"fleet_cap"}` and nothing
       else, deliberately (fleet size is competitive information). Only the
       owner arm can reach a client today — every insert here goes through
       ownCompanyId() — but the bare arm is handled rather than assumed away.
     The max_fleet_rigs line is worth its length: at the exchange ceiling a
     higher depot level buys NOTHING, and a player told "raise the depot" would
     otherwise spend a level's worth of build cost to get the same four slots.
     🔴 THE FIX LINE NAMES NO REMEDY, AND THAT IS THE FIX — recorded here
        because it reads like a regression otherwise. The round that added this
        entry wrote "Retire a rig, or raise the Freight Depot level — each level
        buys more slots", and BOTH of those doors are bricked up in this build:
          · RETIRE — sql/038 ships transport_retire_rig and no client path calls
            it. There is no retire button, no branch in index.js's onClick(),
            and nothing in this file sends that RPC; index.js says so itself
            where it reasons about listMyRigs(). The same round revoked DELETE
            on transport_rigs, so the client has no fleet-shrinking verb left.
          · DEPOT LEVEL — setTariff() below is the only caller of
            transport_set_sheet and sends `p_depot_level: null`, which the
            function coalesces back to the stored value, so every carrier is
            depot_level 1 on the server forever and `least(4 × 1,
            max_fleet_rigs)` never moves. depot.js and production.data.js both
            already say it: nothing in this build ever WRITES depot_level.
            Building a level-3 city yard changes nothing this guard reads.
        A fluent sentence pointing at two doors that do not open is WORSE than
        the bare `🚛 fleet_cap` it replaced, because the bare code at least sent
        the player to an admin. So the sentence says what is true instead.
     ⚠ REJECTED: wiring a retire button here to make the old sentence true. The
       RPC exists and the wiring is small, but a button is a feature and this
       table is a dictionary — and this round's brief is explicit that a
       message promising something the build cannot do gets its MESSAGE fixed,
       not a feature grown to fit it. When a retire path does land, this line
       changes with it; `rig_ran_today` below is already sitting here for that
       day.
     🔴 STILL OPEN ELSEWHERE, AND SAY SO RATHER THAN LOOK CLOSED. renderFleet()
        in depot.render.js prints an over-cap banner whose second line is
        "Upgrade the Freight Depot, or retire a rig" — the SAME two bricked-up
        doors this entry just stopped promising, and after this edit it is the
        LAST copy of that promise a player can actually see, because that
        banner renders on every fleet tab where fleet.length > cap while this
        table is only reached on a refused INSERT. depot.render.js is a
        different owner's file and is not this file's to edit, so the two
        sides disagree on purpose until someone closes that one; do not read
        this entry's silence as agreement with it, and do NOT re-soften this
        sentence to match the banner. The correct direction is the banner
        moving to what is written here. */
  fleet_cap: (d) => {
    const cap = Number(d.cap);
    const max = Number(d.max_fleet_rigs);
    const atCeiling = Number.isFinite(cap) && Number.isFinite(max) && cap >= max;
    const parks = Number.isFinite(cap) ? 'Your yard parks ' + n(cap) + ' rigs' : 'Your yard is full';
    return {
      why: Number.isFinite(cap)
        ? 'Your yard has no parking left — all ' + n(cap) + ' fleet slots are taken.'
        : 'Your yard has no parking left.',
      fix: atCeiling
        ? parks + ', which is the exchange’s own ceiling of ' + n(max) + ' — no Freight Depot level raises it. This build also has no way to retire a rig, so that is the cap until a later update.'
        : parks + ', and this build has no way to retire a rig, nor to raise the depot level the exchange reads. That is the cap until a later update.',
    };
  },
  no_rig_chosen: () => ({ why: 'No rig was assigned to that haul.', fix: 'Pick a rig from the yard.' }),
  no_such_rig: () => ({ why: 'That rig is not in the fleet table.', fix: 'Refresh the yard — it may have been retired.' }),
  rig_not_in_fleet: () => ({ why: 'That rig belongs to a different carrier.', fix: 'Refresh the yard.' }),
  rig_on_deployment: () => ({
    why: 'That rig is out on a deployment and cannot haul.',
    fix: 'Bring it home first.',
  }),
  rig_retired: () => ({ why: 'That rig is retired.', fix: 'Register another one.' }),
  rig_out_of_runs: (d) => ({
    why: 'That rig has used all ' + n(d.cap) + ' of its runs for the day.',
    fix: 'Use another rig, repair this one to raise its ladder, or wait for the reset (server day ' + (d.day_key || 'UTC') + ').',
  }),
  rig_in_transit: () => ({ why: 'That rig is mid-haul.', fix: 'Settle the contract it is on first.' }),
  /* Raised ONLY by transport_retire_rig, which refuses to park a rig that has
     already worked today so the day's runs cannot be laundered by retiring and
     re-registering. Distinct from `rig_out_of_runs` above, which is the DISPATCH
     path's refusal off the same counter — same numbers, two different verbs.
     ⚠ NOT REACHABLE IN THIS BUILD, and the sentence is worded so it does not
       imply otherwise. Nothing in /src/transport calls transport_retire_rig
       (see fleet_cap above), so no player can meet this code today. It is here
       because sql/038's own gap list named it as missing from this table, and
       because on the day a retire path lands the code must not arrive through
       explain()'s unknown arm. Its presence is NOT evidence that a retire path
       exists — do not read it as one, and do not point another message at it. */
  rig_ran_today: (d) => {
    const used = Number(d.used);
    const cap = Number(d.cap);
    return {
      why: Number.isFinite(used) && Number.isFinite(cap)
        ? 'That rig has already run today (' + n(used) + ' of ' + n(cap) + '), and a rig that has worked cannot be parked until the day rolls over.'
        : 'That rig has already run today, and a rig that has worked cannot be parked until the day rolls over.',
      fix: 'It clears on the server day (' + (d.day_key || 'UTC') + ') — the device clock is not what counts.',
    };
  },
  not_your_rig: () => ({ why: 'That rig is not in a fleet you own.', fix: 'Refresh the yard.' }),
  rig_is_salvage: () => ({
    why: 'That rig is Salvage — it is finished as freight.',
    fix: 'Strip it for parts or sell it on; it will not repair.',
  }),
  not_damaged: (d) => ({
    why: 'That rig is already ' + (d.condition || 'in top condition') + '.',
    fix: 'Nothing to repair.',
  }),
  repair_cap: (d) => ({
    why: 'That rig has had its ' + n(d.cap) + ' repairs for the day.',
    fix: 'It resets on the server day (' + (d.day_key || 'UTC') + ') — the device clock is not what counts.',
  }),

  /* ── the manifest ─────────────────────────────────────────────────────── */
  bad_cargo: () => ({ why: 'That manifest is not something the exchange can carry.', fix: 'Pick a resource and an amount.' }),
  cargo_too_large: (d) => ({
    why: 'That manifest is ' + n(d.bytes) + ' bytes; the limit is ' + n(d.max_bytes) + '.',
    fix: 'Ship fewer distinct resources in one contract.',
  }),

  /* ── money ────────────────────────────────────────────────────────────── */
  insufficient_cinder: (d) => ({
    why: 'The haul costs ' + n(d.needed) + ' 🔥 and the wallet holds ' + n(d.balance) + '.',
    fix: 'Nothing was charged and nothing shipped.',
  }),
  /* 🔴 THE FOUR-TIMES BUG, closed from the other side. sql/038 catches
     `undefined_function` around wallet_charge and hands back THIS code with the
     file to run, precisely so the client does not print "does not exist" and
     send an admin back to the migration they already applied. Say the right
     file out loud. */
  wallet_rpc_missing: (d) => ({
    why: 'Freight is installed, but the wallet RPC it charges through is not.',
    fix: 'Run ' + (d.run_sql || 'sql/023_boe_canonical_wallet.sql') + ' in the Supabase editor — NOT sql/038, which is already applied if you are seeing this code.',
  }),

  /* ── settlement ───────────────────────────────────────────────────────── */
  no_such_contract: () => ({ why: 'That contract is not on the exchange.', fix: 'Refresh the depot.' }),
  not_your_contract: () => ({ why: 'That contract is between two other parties.', fix: 'Refresh the depot.' }),
  still_in_transit: (d) => ({
    why: 'That haul has not landed yet (' + mins(d.seconds_remaining) + ' to run).',
    fix: 'The arrival clock is the server’s — the device clock cannot land it early.',
  }),
};

function n(v) { const x = Number(v); return Number.isFinite(x) ? Math.round(x).toLocaleString() : '?'; }
function mins(secs) {
  const s = Math.max(0, Math.ceil(Number(secs) || 0));
  return s >= 3600 ? Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm'
       : s >= 60 ? Math.floor(s / 60) + 'm' : s + 's';
}

/* The unknown arm SAYS THE CODE. It does not guess a cause, it does not
   apologise generically, and it does not blame the migration — a generic
   "something went wrong" is how a specific, known, fixable condition gets
   hidden, and a guessed cause is how an admin gets sent to the wrong file. */
function explain(code, d) {
  const f = Object.prototype.hasOwnProperty.call(CODES, code) ? CODES[code] : null;
  if (f) { try { return f(d || {}); } catch (e) { /* fall through to verbatim */ } }
  return {
    why: 'The freight service refused with a code this build does not know: "' + code + '".',
    fix: 'Quote that code verbatim to an admin — it is printed rather than guessed at on purpose.',
  };
}

/* The numbers a ⚡ trigger refusal carries, dug out of PostgREST's `details`.
   sql/038's guards put a jsonb object in the exception DETAIL and the human
   remedy in HINT, precisely so a client can write a sentence with real figures
   — but `details` reaches supabase-js as a STRING, so it has to be parsed, and
   a raise that carried no detail at all (or a future one that carries prose
   there instead of jsonb) must degrade to an empty object rather than throw.
   Returns {} on anything that is not a plain object, which is exactly what
   every CODES entry is required to survive. */
function parseDetail(details) {
  if (details && typeof details === 'object' && !Array.isArray(details)) return details;
  if (typeof details !== 'string') return {};
  const s = details.trim();
  if (s.charAt(0) !== '{') return {};              // prose, not a payload
  try {
    const o = JSON.parse(s);
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
  } catch (e) { return {}; }
}

/* A bare refusal code and nothing else. `charter_cap` is one; "duplicate key
   value violates unique constraint …" is not, and must never be handed to
   explain(), which would announce it as "a code this build does not know" and
   turn a perfectly legible Postgres sentence into a confusing one. */
const CODE_RE = /^[a-z][a-z0-9_]{2,48}$/;

/* ⚡ fail()'S TWIN FOR THE TWO DIRECT-INSERT PATHS. See the ERROR TABLE header:
   createCompany() and registerRig() are PostgREST inserts, so sql/038's §2b
   guards refuse them by RAISING, and the code lands as an exception MESSAGE
   that fail() copies to `error` with no `why` beside it. index.js then prints
   `String(r.error)` and the player reads `🚛 fleet_cap`.

   🔴 THE TABLE IS STILL THE ONLY AUTHORITY. This adds no second list; it looks
      the message up in CODES and, on a hit, merges that entry's sentences onto
      the ordinary fail() envelope. On a miss NOTHING is invented — the envelope
      comes back exactly as fail() built it, message verbatim, so an RLS refusal
      or a unique-index violation still reads in the database's own words. That
      is the same direction explain()'s unknown arm fails in and the opposite of
      sql/037:16-23, where an unhandled code fell through to a generic "nothing
      moved" that hid a hard crash for the life of the feature.

   ⚠ `missing` IS LEFT WHERE fail() PUT IT. A trigger code never matches
     MISSING_RE, so a capped fleet cannot masquerade as an unapplied migration —
     which is the confusion MISSING_RE exists to prevent, and the reason `error`
     keeps holding the raw code an admin can grep for rather than being
     overwritten with prose. */
export function failCoded(e) {
  const base = fail(e);
  const code = String((e && e.message) || '').trim();
  if (!CODE_RE.test(code) || !Object.prototype.hasOwnProperty.call(CODES, code)) return base;
  const m = explain(code, parseDetail(e && e.details));
  return Object.assign(base, { code: code, why: m.why, fix: m.fix });
}

/* ═══ 3 · THE CHOKEPOINTS ══════════════════════════════════════════════════ */

/* 🔴 THE ONLY `throw` IN THIS FILE, AND IT NEVER LEAVES IT.
   It is here so the refund branches below stay LIVE CODE. index.html's city
   bridge shipped `setState: (s) => { try { B.setProdState(s); } catch (e) {} }`
   and that single swallowed catch made build()'s refund-on-record-failure
   branch unreachable: a save throw charged a player 50,000 Cinder for a
   building that never persisted, and build() still returned {ok:true}.
   production.state.js's fix is the shape copied here — convert a `false` from
   the seam into a throw at ONE place, so every caller's unwind path is reached
   by a real failure rather than by inspection.

   `=== false`, not `!x`: transport.bridge.js pins every mutator on the seam to
   a boolean and states that "`false` IS the contract", so only an explicit
   refusal unwinds. A bridge that has not been built yet answering `undefined`
   must not make every repair in the game refuse. */
function persist(b) {
  if (b.save() === false) throw new Error('the profile refused to save');
}

/* THE SECOND AND LAST INTERNAL THROW is `ownCompanyId` below, and it is here
   for a reason worth stating rather than a convenience: it could have returned
   null on a read failure, and that would have collapsed "the
   transport_companies table does not exist" into "you do not run a carrier".
   Those are the two sentences MISSING_RE exists to keep apart. It throws, every
   caller already has a try/catch that turns it into a proper `missing`
   envelope, and nothing escapes an export.

   A REFUND HAS TO REACH DISK, and the return value of the save that puts it
   there is CHECKED. A refund that did not persist is a refund the next reload
   silently undoes — the player is left paid-up with nothing — and this project
   has shipped the swallowed-save bug often enough that the branch says so out
   loud instead of `try { save(); } catch (e) {}`. */
function saveRefund(b, what) {
  let ok = false;
  try { ok = (b.save() !== false); } catch (e) { ok = false; }
  if (!ok) {
    try { b.toast('⚠ ' + what + ' was refunded but the profile did not save. Reopen the depot before closing the tab.', 6500); } catch (e) {}
  }
  return ok;
}

/* Every RPC in this feature goes through here, so there is exactly one place
   that decides what a Postgres failure means.

   BOTH guards are mandatory and neither is redundant: supabase-js returns a
   query error as `r.error` on a resolved promise, and a NETWORK failure throws.
   A call site with only the try/catch silently treats a PostgREST 400 as
   success; one with only the `r.error` check dies in a click handler when the
   tunnel drops mid-request. */
async function rpc(c, name, args) {
  const sent = Object.keys(args).join(', ');
  let r;
  try {
    r = await c.rpc(name, args);
  } catch (e) { return rpcFail(name, sent, e); }
  if (r && r.error) return rpcFail(name, sent, r.error);

  const d = (r && r.data && typeof r.data === 'object') ? r.data : null;
  if (!d) {
    /* A 200 with a body that is not the documented envelope. Reported rather
       than coerced: `!d.ok` on a null body would report a refusal that never
       happened, and treating it as success would report a haul that never
       shipped. */
    return {
      ok: false, missing: false, offline: false, code: 'no_answer',
      error: name + ' returned ' + (r && r.data === null ? 'null' : typeof (r && r.data)),
      why: 'The freight service answered without saying whether it worked.',
      fix: 'Refresh the depot before retrying — the call may or may not have landed.',
    };
  }
  if (d.ok === true) return { ok: true, missing: false, offline: false, data: d };

  const code = String(d.error || 'unknown');
  const m = explain(code, d);
  return { ok: false, missing: false, offline: false, code, error: code, why: m.why, fix: m.fix, data: d };
}

/* 🔴 THE ORDER OF THESE THREE BRANCHES IS THE WHOLE POINT.
   1. A dependency this file knows by NAME. "does not exist" is ambiguous, and
      the ambiguity has already cost four debugging sessions here
      (index.html's bank_open_cinder branch): the function existed, a table
      inside it did not, and the generic branch sent an admin back to a
      migration they had already run. So a message that names wallet_charge or
      transport_config wins first.
   2. A genuinely absent RPC. ⚠ And it is reported HONESTLY: PostgREST resolves
      an RPC by the EXACT SET of named arguments, so "the migration was never
      applied" and "the installed function has a different parameter list" are
      the same PGRST202 from out here. Saying only the first would recreate the
      exact bug in (1). The arguments this build sends are printed so the two
      can be told apart in ten seconds.
   3. Anything else, VERBATIM and trimmed. */
function rpcFail(name, sent, e) {
  const base = fail(e);
  const msg = base.error;
  if (DEP_RE.test(msg)) {
    const dep = (msg.match(DEP_RE) || ['a dependency'])[0];
    return Object.assign(base, {
      missing: true,
      why: name + ' is installed but the "' + dep + '" it depends on is not.',
      fix: 'Do not re-run sql/038 — it is clearly applied. Find the migration that creates ' + dep + ' (wallet_charge is sql/023) and run that.',
    });
  }
  if (MISSING_RE.test(msg)) {
    return Object.assign(base, {
      missing: true,
      why: name + '() is not installed, OR it is installed with a different parameter list.',
      fix: 'Run sql/038_transport_companies.sql in the Supabase SQL editor. If it is already applied, compare its signature against the arguments this build sends: (' + sent + ').',
    });
  }
  return Object.assign(base, {
    why: 'The freight service failed: ' + msg.slice(0, 220),
    fix: 'That is the database’s own words, not a guess.',
  });
}

/* One read, one place, and DELIBERATELY NOT CACHED. The pinned signatures for
   setTariff() and listContracts() carry no company id, so the caller's own
   charter has to be looked up. A module-level cache would be a fourth copy of
   "which company am I?" (the panel holds one, the row holds one, the RPC reads
   one) and a stale one after founding, closing or re-founding points a rate
   change at a company that is not there — which the setter then refuses as
   `not_your_company`, a confusing answer to a question the client got wrong.
   It is one row on an indexed owner_id. */
async function ownCompanyId(c, uid) {
  const r = await c.from('transport_companies').select('id').eq('owner_id', uid).limit(1).maybeSingle();
  if (r.error) throw r.error;                    // caught by the caller's own try/catch
  return (r.data && r.data.id) || null;
}

/* ═══ 4 · THE MANIFEST AND THE SPEND ═══════════════════════════════════════ */

/* A manifest is `{ <resourceId>: units }` with every leg a positive integer.
   Zero, negative and NaN legs are DROPPED rather than rounded up: a leg that is
   present but zero is not freight, and shipping it would price a contract for
   cargo that never left the stash. */
function normCargo(cargo) {
  const out = {};
  if (!cargo || typeof cargo !== 'object' || Array.isArray(cargo)) return out;
  for (const k in cargo) {
    if (!Object.prototype.hasOwnProperty.call(cargo, k)) continue;
    const v = Math.floor(Number(cargo[k]));
    if (Number.isFinite(v) && v > 0) out[String(k)] = v;
  }
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v) { return typeof v === 'string' && UUID_RE.test(v); }

/* 🔎 "IS THIS OBJECT A ROUTES.JS QUOTE?" — used by dispatch() to tell a caller
   that handed over a PRICE from one that handed over a HAUL.

   It tests for the fare fields, and it can do so safely because routes.js's
   shape() stamps every one of them onto EVERY outcome it returns, refusals
   included — that is the stated point of having one shape. So their presence is
   structural rather than incidental, and a refusal shape (ok:false, price:null,
   cargoUnits:0) is recognised just as reliably as a live quote.

   ⚠ THREE FIELDS, NOT ONE. `ok` alone is on half the envelopes in this file and
     would misfire on anything. `etaText` and `cargoUnits` together are specific
     to a fare: nothing else in this feature carries a human ETA string and a
     unit count at the same time. And the check is deliberately CONSERVATIVE —
     when in doubt it says "not a quote" and the call proceeds down the ordinary
     path, because a false positive here would refuse a legitimate dispatch,
     which is a worse failure than the confusing message it exists to prevent. */
function isQuoteShaped(o) {
  return !!o && typeof o === 'object' && !Array.isArray(o)
      && typeof o.ok === 'boolean'
      && typeof o.etaText === 'string'
      && Object.prototype.hasOwnProperty.call(o, 'cargoUnits');
}

function unitsOf(legs) {
  let t = 0;
  for (const k in legs) t += legs[k];
  return t;
}

/* ════════════════════════════════════════════════════════════════════════════
   🔴 THE ATOMIC RESOURCE SPEND. Verify EVERY leg with a human message before
   touching a single balance; then deduct, recording each leg so it can be put
   back exactly; and hand the caller a `refund` closure so the path that fails
   AFTER this returns can unwind too.

   This is cost.js's spendCost() applied to a manifest. The one structural
   difference is that Cinder is NOT a leg here — transport_dispatch charges it
   server-side through wallet_charge — so the ordering argument cost.js makes
   ("resources first, Cinder last, because Cinder is the leg that can fail for
   reasons outside this function") lands differently: the leg outside this
   function is the RPC itself, so every local leg is taken first and the RPC is
   the last thing that can fail. Unwinding N resource legs is cheap; unwinding a
   charge that has already fired a server write is not, and from here it is not
   even possible.

   🔴 THE REFUND USES b.refundRes, NEVER b.addRes, and the distinction is a
      safety property rather than a naming nicety. addRes is the CAPPED add: it
      respects the stash cap and returns WITHOUT ADDING when the vault is full,
      which is right for a payout (a delivery that overflows is a smaller
      delivery) and catastrophic for an undo. A driven test in /src/city caught
      exactly that failure: 95 metal and 70 supplies deducted, "refunded", and
      gone. A refund is an UNDO of units the player held moments ago, so it must
      bypass the ceiling. Unwound in REVERSE so the ledger retraces its steps.
   ════════════════════════════════════════════════════════════════════════════ */
function takeRes(b, legs, what) {
  const ids = Object.keys(legs);

  // ── Phase 1: verify everything. Nothing has moved yet.
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const have = b.getRes(id) | 0;
    if (have < legs[id]) {
      return {
        ok: false, code: 'short_res',
        why: 'Not enough ' + id + ' for ' + what + ' — need ' + n(legs[id]) + ', have ' + n(have) + '.',
        fix: 'Produce or buy ' + n(legs[id] - have) + ' more, or send a smaller load.',
      };
    }
  }

  // ── Phase 2: deduct, recording each leg.
  const taken = [];
  const refund = () => {
    // Nothing was ever deducted (an empty parts bill, or a double call from two
    // failure paths). Returning early keeps a no-op unwind from triggering a
    // save and a "did not save" toast about zero units.
    if (!taken.length) return true;
    let lost = 0;
    for (let i = taken.length - 1; i >= 0; i--) {
      const t = taken[i];
      // Wrapped per leg: one throwing seam must not abandon the remaining legs
      // half-refunded, which is a worse state than the one being unwound. Each
      // leg's return value is counted, because a refund that returned false is
      // units the player is owed and did not get back.
      try {
        const done = (typeof b.refundRes === 'function')
          ? b.refundRes(t.id, t.n)
          : b.addRes(t.id, t.n);             // last resort; see the cap note above
        if (done === false) lost += t.n;
      } catch (e) { lost += t.n; }
    }
    taken.length = 0;
    if (lost > 0) {
      try { b.toast('⚠ ' + n(lost) + ' units could not be put back into the stash. Tell an admin.', 7000); } catch (e) {}
    }
    saveRefund(b, what);
    return lost === 0;
  };

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    // `!x` matches cost.js exactly: an `undefined` from the seam counts as a
    // REFUSAL here, not a success, because the cost of guessing wrong on a
    // deduction is the player's goods.
    if (!b.spendRes(id, legs[id])) {
      refund();
      return {
        ok: false, code: 'ledger_refused',
        why: 'The stash refused ' + n(legs[id]) + ' ' + id + ' — every deducted leg was refunded.',
        fix: 'Reopen the depot and try again.',
      };
    }
    taken.push({ id: id, n: legs[id] });
  }
  return { ok: true, refund: refund, taken: taken };
}

/* 🎚 THE REPAIR BILL COMES FROM _opEcon AND NOWHERE ELSE.
   CLAUDE.md: "All operation pricing goes through _opEcon(). Never hardcode
   economy numbers." So this reads the transport operation's own economy row
   through the bridge and REFUSES if there is not one, rather than inventing a
   figure. An invented figure would be a second pricing authority that the shop
   cannot see and an admin retune cannot reach — which is how a UI comes to
   advertise one price while the charge does something else.

   THE RULE, stated once: one rung of condition costs one worker-hour of the
   yard's own gross rate. `ratePerWorkerHr` and nothing multiplied by it — a
   coefficient here would BE the hardcoded economy number, just wearing a
   variable name. If the econ row ever publishes an explicit `repairPerStep`
   that wins, so the authority can become exact later without another edit here.

   ⚠ PROVISIONAL, AND THIS COMMENT EXISTS TO BE DELETED BY WHOEVER FIXES IT.
     Design §4 says repairs also consume PP_PARTS-mapped resources. PP_PARTS is
     a `const` in index.html and this module genuinely cannot see it
     (the globals trap), and copying the sixteen-row table here would be a
     second parts catalog to drift against the first. So until
     `_opEcon('transport').repairParts` publishes a dict, a repair costs Cinder
     only, and the parts leg below is dead but correct. */
function repairBill(b) {
  let e = null;
  try { e = b.opEcon('transport'); } catch (err) { e = null; }
  if (!e || typeof e !== 'object') {
    return {
      ok: false, code: 'not_priced',
      why: 'Freight has no economy row yet, so a repair has no price.',
      fix: 'Add a `transport` entry to the OPS_ECON table in index.html — this module will not invent one.',
    };
  }
  const raw = (e.repairPerStep != null) ? e.repairPerStep : e.ratePerWorkerHr;
  const cinder = Math.max(0, Math.floor(Number(raw) || 0));
  if (!(cinder > 0)) {
    return {
      ok: false, code: 'not_priced',
      why: 'The freight economy row publishes no rate, so a repair has no price.',
      fix: 'Set ratePerWorkerHr (or repairPerStep) on the `transport` entry in OPS_ECON.',
    };
  }
  return { ok: true, cinder: cinder, parts: normCargo(e.repairParts) };
}

/* ═══ 5 · READS ════════════════════════════════════════════════════════════
   Every read returns its empty collection ALONGSIDE the flags, from the failure
   path and the catch alike, so a caller never has to branch on failure to find
   the array. `rows` is always an array; `row` is always present or null. */

/* The caller's own charter. `maybeSingle()` rather than `single()`: having no
   company is the ordinary state for every player who has not founded one, and
   `single()` turns that into a PGRST116 error the panel would have to un-learn. */
export async function myCompany() {
  const c = client(); if (!c) return { ...OFFLINE, row: null, why: offWhy() };
  const b = bridge();
  let uid = null;
  try { uid = b.userId(); } catch (e) { uid = null; }
  if (!uid) return { ...OFFLINE, row: null, why: offWhy() };
  try {
    const r = await c.from('transport_companies')
      .select('id,owner_id,name,home_node_id,depot_level,tariff,reliability,status,created_at')
      .eq('owner_id', uid).limit(1).maybeSingle();
    if (r.error) return { ...fail(r.error), row: null };
    return { ok: true, row: r.data || null };
  } catch (e) { return { ...fail(e), row: null }; }
}

/* THE RATE BOARD. Public by policy (`using (true)` on transport_companies, and
   sql/038 says why: "a price nobody can see cannot be undercut").

   ⚠ `blacklist` IS DELIBERATELY NOT SELECTED, even though the row-level policy
     would return it. Two reasons: it is up to 200 uuids on every row of a board
     that lists sixty carriers, and pre-filtering the board by it would publish
     to every client exactly who has refused whom. A refusal arrives instead as
     the `blacklisted` code at dispatch — one round trip, one carrier, and the
     message points at Meridian, which is what Meridian is for. */
export async function listCarriers(limit = 60) {
  const c = client(); if (!c) return { ...OFFLINE, rows: [], why: offWhy() };
  const lim = Math.max(1, Math.min(200, Math.floor(Number(limit) || 60)));
  try {
    const r = await c.from('transport_companies')
      .select('id,owner_id,name,home_node_id,depot_level,tariff,reliability,status,created_at')
      .eq('status', 'open')
      .order('reliability', { ascending: false, nullsFirst: false })
      .limit(lim);
    if (r.error) return { ...fail(r.error), rows: [] };
    return { ok: true, rows: r.data || [] };
  } catch (e) { return { ...fail(e), rows: [] }; }
}

/* The yard. RLS already narrows this to fleets the caller owns
   (`is_transport_owner(company_id)`), so there is no owner filter here — and
   adding one would be a client-side re-statement of a server-side boundary,
   which reads as security and is not. */
export async function listMyRigs() {
  const c = client(); if (!c) return { ...OFFLINE, rows: [], why: offWhy() };
  try {
    const r = await c.from('transport_rigs')
      .select('id,company_id,owner_id,vehicle_id,rarity,condition,runs_cap,runs_used,day_key,repairs_used,assigned_to,status,created_at')
      .order('created_at', { ascending: true }).limit(200);
    if (r.error) return { ...fail(r.error), rows: [] };
    return { ok: true, rows: r.data || [] };
  } catch (e) { return { ...fail(e), rows: [] }; }
}

/* Contracts on either side. `role` is 'carrier' | 'shipper'; anything else —
   including the no-argument call the panel makes on refresh — means BOTH, in
   one round trip, because the depot screen shows a player their inbound and
   outbound freight together and two queries would render them out of step.
   A carrier with no charter simply has no carrier side. */
export async function listContracts(role) {
  const c = client(); if (!c) return { ...OFFLINE, rows: [], why: offWhy() };
  const b = bridge();
  let uid = null;
  try { uid = b.userId(); } catch (e) { uid = null; }
  if (!uid) return { ...OFFLINE, rows: [], why: offWhy() };
  const cols = 'id,carrier_id,rig_id,shipper_id,from_node,to_node,hops,units,cargo,price,escort,risk_pct,depart_at,arrive_at,status,settled_at,created_at';
  try {
    let q = c.from('transport_contracts').select(cols);
    if (role === 'shipper') {
      q = q.eq('shipper_id', uid);
    } else {
      const mine = await ownCompanyId(c, uid);
      if (role === 'carrier') {
        // No charter means no carrier-side contracts. Answering with an empty
        // list is the truth; a query with `carrier_id = null` would return the
        // Meridian hauls of every player on the exchange.
        if (!mine) return { ok: true, rows: [] };
        q = q.eq('carrier_id', mine);
      } else {
        /* ⚠ `or()` TAKES A FILTER EXPRESSION, NOT A PARAMETER. PostgREST parses
           this string as its own mini-language, so a uuid carrying a comma, a
           dot or a parenthesis would not be escaped — it would change which
           rows come back. Both values are checked against the uuid shape first
           and the query falls back to the single-sided `eq()` form, which IS
           parameterised, if either one is not one. */
        q = (mine && isUuid(uid) && isUuid(mine))
          ? q.or('shipper_id.eq.' + uid + ',carrier_id.eq.' + mine)
          : q.eq('shipper_id', uid);
      }
    }
    const r = await q.order('created_at', { ascending: false }).limit(200);
    if (r.error) return { ...fail(r.error), rows: [] };
    return { ok: true, rows: r.data || [] };
  } catch (e) { return { ...fail(e), rows: [] }; }
}

/* ═══ 6 · WRITES THAT MOVE NO MONEY ════════════════════════════════════════ */

/* Founding the charter. The CINDER for it is NOT charged here — a charter is
   bought in Just Business through _opFound/_opEcon, which is the one place an
   operation is priced. Charging again on this insert would be a second price
   for the same thing and the two could disagree.

   ⚠ WHAT IS DELIBERATELY NOT SENT, and why the omissions are the security:
   sql/038's insert policy pins `status='open'`, `reliability is null` and
   `blacklist='{}'`. Every one of those is left to the column default rather
   than stated here — a founder who could pick their own opening reliability
   would start at 100% and never earn it, and a charter born with a refusal list
   arrives pre-loaded against a rival. Sending them would at best duplicate the
   policy and at worst violate it after a future edit. */
export async function createCompany(name, homeNodeId) {
  const c = client(); if (!c) return { ...OFFLINE, row: null, why: offWhy() };
  const b = bridge();
  // The pinned contract is positional; index.js's 'found' branch in onClick()
  // calls createCompany({ name, homeNodeId }) — an object, not two arguments.
  // Accepted rather than refused, because a two-file arity drift must degrade to
  // a working call, not to a company named "[object Object]".
  if (name && typeof name === 'object') {
    homeNodeId = (homeNodeId != null) ? homeNodeId : (name.homeNodeId || name.home_node_id);
    name = name.name;
  }
  const nm = String(name == null ? '' : name).trim().slice(0, 40);
  if (!nm) {
    return { ok: false, missing: false, offline: false, error: 'no_name',
             why: 'A carrier needs a name shippers can find it by.', fix: 'Type one in.' };
  }
  let uid = null;
  try { uid = b.userId(); } catch (e) { uid = null; }
  if (!uid) return { ...OFFLINE, row: null, why: offWhy() };

  // The depot's home node. Falls back to where the player's city actually is,
  // because home_node_id holds a TERRITORY-WARS node id ('N-25') — sql/038 has
  // the postmortem on the two id spaces both called "node".
  let home = homeNodeId;
  if (home == null) { try { home = b.campNodeId(); } catch (e) { home = null; } }

  try {
    const r = await c.from('transport_companies')
      .insert({ owner_id: uid, name: nm, home_node_id: home ? String(home).slice(0, 40) : null })
      .select('id,owner_id,name,home_node_id,depot_level,tariff,reliability,status,created_at')
      .maybeSingle();
    /* ⚡ failCoded, not fail: this insert is guarded by transport_companies_cap,
       which refuses a fourth charter by RAISING `charter_cap` rather than by
       returning an envelope. Through fail() alone that reached the player as
       the toast `🚛 charter_cap`. Anything the table does not know still comes
       back verbatim. */
    if (r.error) return { ...failCoded(r.error), row: null };
    return { ok: true, row: r.data || null };
  } catch (e) { return { ...failCoded(e), row: null }; }
}

/* A number out of a server envelope, or NULL — and null is load-bearing rather
   than tidy. Every cap in this feature is a figure the server may legitimately
   decline to state: transport_caps() answers NULL for a company that does not
   exist, and omits its owner-only keys entirely for anybody else. Coercing
   those to 0 would turn "unknown" into "none left" (a Found-a-charter button
   greyed out forever) or, worse, into a confident claim about a rival's yard.
   Coercing to NaN would leak `?` into every sentence n() writes. So: a finite
   number, or null, and the caller compares. */
function capNum(v) {
  if (v == null) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

/* THE RATE SHEET goes through transport_set_sheet(), never through an UPDATE.
   That is not a style choice: sql/038 revokes UPDATE on transport_companies
   because POSTGRES RLS HAS NO COLUMN GRANULARITY — a row policy saying "the
   owner may retune their own tariff" also hands over reliability, depot_level
   and status. An RPC can express what a policy cannot, so a direct
   `.update({tariff})` from here would simply be denied, and correctly.

   The RPC's parameters are all nullable and mean "leave this alone", so one
   field is sent without round-tripping the others and racing a second tab. */
export async function setTariff(tariff, depotLevel) {
  const c = client(); if (!c) return { ...OFFLINE, row: null, why: offWhy() };
  const b = bridge();
  let uid = null;
  try { uid = b.userId(); } catch (e) { uid = null; }
  if (!uid) return { ...OFFLINE, row: null, why: offWhy() };

  /* A bare number is accepted and normalised to `{ base: n }`, and this is a
     correctness fix rather than politeness: index.js's 'tariff' branch calls
     setTariff() with the bare number off the form field, and transport_quote
     reads the rate as `(tariff->>'base')::numeric`. A jsonb `5`
     has no 'base' key, so the carrier would store a tariff, see it saved, and be
     refused `no_tariff_published` on every quote forever. */
  let sheet = tariff;
  if (typeof sheet === 'number' || typeof sheet === 'string') sheet = { base: Number(sheet) };
  if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet)) {
    return { ok: false, missing: false, offline: false, error: 'bad_tariff',
             why: 'A tariff is a rate sheet or a number of Cinder per unit·hop.', fix: 'Enter a positive number.' };
  }
  const clean = {};
  ['base', 'escort_pct', 'illicit_pct'].forEach((k) => {
    const v = Number(sheet[k]);
    if (Number.isFinite(v) && v >= 0) clean[k] = v;
  });

  try {
    const id = await ownCompanyId(c, uid);
    if (!id) {
      return { ok: false, missing: false, offline: false, error: 'no_company',
               why: 'You do not run a carrier yet.', fix: 'Register one on the exchange first.' };
    }
    /* Every argument is named, including the three this call leaves null.
       PostgREST resolves an RPC by the exact set of named arguments, so omitting
       them would not mean "use the default" — it would fail to find the function
       at all, and arrive here as a PGRST202 that looks exactly like an unapplied
       migration. */
    /* 🔴 THE DEPOT LEVEL HAS TO TRAVEL, AND IT WAS PINNED AT null.
       Every cap the exchange enforces — reach in transport_quote, bays in
       transport_dispatch, fleet_cap in the transport_rigs insert trigger — is
       computed by transport_caps() from transport_companies.depot_level. The
       city building's level lived only in the player's save blob and NOTHING
       ever published it, so the server sat at whatever the row was created
       with. A player could pay the level-2 and level-3 costs in the city
       (hundreds of thousands of Cinder plus metal, supplies and fuel) and buy
       literally nothing: same reach, same bays, same fleet cap.
       The server side already worked and was already bounded —
       `greatest(1, least(3, coalesce(p_depot_level, v_co.depot_level)))` — so
       this was only ever a client omission.
       ⚠ `coalesce` on the server is why null is still the right value to send
         when the caller does not know the level: it means "leave it alone",
         not "reset it to 1". Only a level this client has actually READ off the
         city is worth sending.
       ⚠ KNOWN LIMIT, stated rather than hidden: the level is published when the
         sheet is saved, not the moment the building finishes. A carrier who
         upgrades their depot and never touches their tariff again keeps the old
         caps until the next save. Publishing on every refresh would be a write
         on a read path; the panel says so instead. */
    const lvlRaw = Math.floor(Number(depotLevel));
    const lvl = (Number.isFinite(lvlRaw) && lvlRaw >= 1 && lvlRaw <= 3) ? lvlRaw : null;
    const r = await rpc(c, 'transport_set_sheet', {
      p_company_id: id, p_tariff: clean, p_status: null, p_depot_level: lvl, p_blacklist: null,
    });
    if (!r.ok) return r;
    const d = r.data;
    /* `tariff` is handed back as the CLAMPED BASE NUMBER and the full sheet is
       on `sheet`. The caller prints it — index.js's 'tariff' branch does
       fmtNum(num(r.tariff, t)) — and Number({}) is NaN, which would silently
       echo the requested rate, the one thing that comment says not to do, since
       the server clamps to the
       Meridian ceiling. */
    const base = Number(d.tariff && d.tariff.base);

    /* 🔴 THE CAPS ARE NESTED, AND READING THEM FLAT RETURNED `undefined` FROM A
       CALL SITE THAT LOOKED DESIGNED TO SUPPLY THEM. This used to say
       `bays: d.bays, fleetCap: d.fleet_cap`. transport_set_sheet's envelope has
       neither key: it returns `'caps', public.transport_caps(p_company_id)`,
       and reach / bays / fleet_cap / fleet_used / fleet_slots_left all live
       INSIDE that object (sql/038 §2 — the depot ladder is evaluated in exactly
       one function so the number the owner is shown and the number the §2b
       guard enforces cannot drift). Nothing was visibly broken because
       index.js's 'tariff' branch prints `r.tariff` and nothing else, which is
       precisely how this survives: the next caller reads `r.fleetCap`, gets
       undefined, and has no reason to suspect the seam.
       Also lifted while here: `charter_slots_left`, which sql/038 §2 names
       as "exactly what a 'Found a charter' button needs to grey itself out",
       and which this function was dropping on the floor.

       ⚠ NULL IS AN ANSWER AND IT MEANS "THE SERVER DID NOT SAY", NEVER ZERO.
         transport_caps() returns NULL for a company that does not exist, and
         sql/038 spells out why every caller must compare the extracted value
         rather than trust it: `null > 0` is null, so a caller who trusts it
         REFUSES, which is the safe direction. capNum() keeps that property —
         it hands back null rather than 0 or NaN — so `if (r.fleetCap > 0)` is
         false when the number is unknown instead of quietly true.
       ⚠ AND fleetUsed / fleetSlotsLeft ARE OWNER-ONLY KEYS. transport_caps
         omits them entirely for a non-owner (a rival's fleet composition is
         competitive information), so they come back null there too. Do not
         "helpfully" default them to 0 — a 0 fleet_used is a claim about
         somebody's yard, and a wrong one. This path is always the owner (the
         RPC refuses anyone else four statements earlier), but the extraction
         must not be the thing that assumes it. */
    const caps = (d.caps && typeof d.caps === 'object' && !Array.isArray(d.caps)) ? d.caps : {};
    return {
      ok: true, tariff: Number.isFinite(base) ? base : 0, sheet: d.tariff || clean,
      status: d.status, depotLevel: d.depot_level,
      bays: capNum(caps.bays), fleetCap: capNum(caps.fleet_cap), reach: capNum(caps.reach),
      fleetUsed: capNum(caps.fleet_used), fleetSlotsLeft: capNum(caps.fleet_slots_left),
      charterSlotsLeft: capNum(d.charter_slots_left),
      blacklistCount: capNum(d.blacklist_count),
      row: d,                                  // the raw envelope, caps and all
    };
  } catch (e) { return { ...fail(e), row: null }; }
}

/* Registering a rig into the fleet. It costs NOTHING, and the absence of a
   charge is deliberate: the rig was already bought on the Prince Portfolios
   auction floor, and billing again at registration would be a second price for
   one object with no _opEcon key behind it. A caller's `{ free: false }` is
   therefore honoured as a no-op rather than quietly meaning something.

   ⚠ runs_cap IS THE CALLER'S TO SUPPLY, AND THIS FILE WILL NOT DERIVE IT.
     The ladder — 3/4/5/6/8/10 by rarity × PP_COND_MULT, floor, minimum 1 — is
     rigs.data.js's `effectiveRuns()` and that is the authority. Copying it here
     would be a second ladder to drift against the first, and the auction
     minigame already runs a second, incompatible rarity list (PPA_RARITIES),
     which is exactly how a rig ends up with two contradictory rarities.
     When no cap is handed over the column defaults to 3 server-side, so a Mythic
     rig would run three times a day instead of ten. That is the correct
     direction for the disagreement to fail in — sql/038 says the same about
     `least(runs_cap, max_runs_per_rig)` — but it IS wrong, and the fix is for
     the caller to pass it, not for this file to grow a rarity table. */
export async function registerRig(vehicleId, rarity, condition) {
  const c = client(); if (!c) return { ...OFFLINE, row: null, why: offWhy() };
  const b = bridge();
  // index.js's 'register' branch calls registerRig(id, { free:false, … }) and
  // seedStarter() calls it with { free:true, starter:true, … }.
  // Second-argument-as-options is accepted.
  let opts = {};
  if (rarity && typeof rarity === 'object') { opts = rarity; rarity = opts.rarity; }
  if (condition == null) condition = opts.condition;

  let uid = null;
  try { uid = b.userId(); } catch (e) { uid = null; }
  if (!uid) return { ...OFFLINE, row: null, why: offWhy() };

  const row = {
    owner_id: uid,
    vehicle_id: vehicleId == null ? null : String(vehicleId).slice(0, 64),
  };
  if (rarity) row.rarity = String(rarity).toLowerCase().slice(0, 16);
  if (condition) row.condition = String(condition).slice(0, 16);
  const cap = Math.floor(Number(opts.runsCap != null ? opts.runsCap : opts.runs_cap));
  if (Number.isFinite(cap) && cap > 0) row.runs_cap = Math.min(10, cap);
  /* runs_used, repairs_used, day_key, assigned_to and status are NOT sent —
     every one of them is pinned at its zero by the insert policy, and sending
     them is at best redundant and at worst the exploit the policy is refusing
     (a rig arriving with runs_used = -1000 has a thousand free hauls). */

  try {
    const id = await ownCompanyId(c, uid);
    if (!id) {
      return { ok: false, missing: false, offline: false, error: 'no_company',
               why: 'A rig has to belong to a carrier.', fix: 'Register your carrier on the exchange first.' };
    }
    row.company_id = id;
    const r = await c.from('transport_rigs').insert(row)
      .select('id,company_id,vehicle_id,rarity,condition,runs_cap,runs_used,status').maybeSingle();
    /* ⚡ failCoded, not fail: transport_rigs_cap raises `fleet_cap` (and
       `no_such_carrier`, and `transport_config_missing`) on this insert. This
       is the exact refusal depotReady()'s drift `fix` line promises the player
       is actionable, and until failCoded() existed it arrived as the toast
       `🚛 fleet_cap`. */
    if (r.error) return { ...failCoded(r.error), row: null };
    return { ok: true, row: r.data || null };
  } catch (e) { return { ...failCoded(e), row: null }; }
}

/* ═══ 7 · THE MONEY PATHS ══════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════════════════════
   DISPATCH — the shipper hands over cargo and the server charges the fee.

   THE PINNED FIVE ARGUMENTS ARE THE CONTRACT; `route` IS A SIXTH, OPTIONAL, AND
   IT EXISTS BECAUSE THE TWO SIDES DRIFTED. The client-side spec pins
   `dispatch(carrierId, rigId, fromNode, toNode, cargo)` and an RPC taking five
   `p_` arguments. The function that is actually in sql/038 declares NINE, none
   of them with a default: p_hops, p_units, p_escort and p_client_ref as well.
   🔴 THE FILE ON DISK IS THE AUTHORITY, and the consequence of pretending
      otherwise is specific: PostgREST resolves an RPC by the EXACT SET of named
      arguments, so a five-key call against a nine-argument function is not a
      call with defaults — it is PGRST202, "could not find the function", which
      is indistinguishable from an unapplied migration and would send an admin
      to re-run sql/038 for the fifth time in this project's history. So all nine
      are sent, always.
   `route` carries only what cannot be derived here: hops (routes.js owns the
   map; this file must not) and escort. Absent hops is NOT defaulted to 1 —
   price is base × units × hops, so a silent 1 would undercharge every long
   haul. It is sent as null and comes back as a legible `bad_hops` refusal.

   `units` is NOT taken from the caller even when offered: it is summed from the
   manifest, so the number that is priced and the number that leaves the stash
   are the same number. A units figure larger than the manifest charges for
   freight nobody handed over; a smaller one ships goods for free.

   NOTHING ELSE IS SENT. No price, no amount, no user id, no runs_used, no
   day_key, no reliability — the RPC takes ids and re-reads every one of those
   from rows it owns. sql/015's r9 settle is the counter-example this rule comes
   from: it inserted the client's payload verbatim, unbounded and unsigned, and
   two HTTP calls minted a billion Cinder.

   ⚠ A NULL carrierId IS MERIDIAN HAULAGE and is a supported call, not a bug.
     Meridian is a price CEILING at 2.5× the median tariff and 1.6× the trip
     time — ratified — so that a monopolist cannot end another player's game by
     refusing to serve them. It is never cheaper and never faster.

   🔴 THE OBJECT-FORM OVERLOAD, AND THE ONE THING IT WILL NOT GUESS.
      index.js's Dispatch button is holding a routes.js quote when it fires, so
      an object in first position is read as the whole request — cargo, from,
      to, rigId, carrierId. That only works because index.js merges the form it
      quoted ONTO the quote before calling. routes.js's own shape() carries NONE
      of those five: it is a price, not a manifest. It has `price`, `capped`,
      `hops`, `cargoUnits`, `etaText`, `riskPct` — every field needed to show a
      player a fare, and not one field saying what is on the truck.
      🔴 SO A BARE QUOTE IS REFUSED BY NAME, and this file does NOT pretend to
         absorb the drift. It cannot: absorbing it would mean inventing the
         freight — there is no map here, no resource picker, and no way to know
         which of the player's rigs was meant. What a bare quote used to do is
         the reason this branch exists: `normCargo(undefined)` returned {}, and
         the haul came back as `bad_cargo`, "there is nothing on that manifest
         to ship" — which blames the player for a form they filled in correctly
         and sends whoever debugs it to the resource picker, the one place the
         bug is not. That is the four-times bug of index.html's
         bank_open_cinder branch in miniature: a real, specific, fixable
         condition wearing a guessed cause.
         The branch below names the actual defect instead — the call site passed
         the quote rather than the request it quoted — because a wrong caller is
         something a developer can fix in one line and an empty manifest is not.
   ════════════════════════════════════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════════════════════════
   💰 serverQuote() — ASK THE SERVER WHAT THIS HAUL COSTS, BEFORE ASKING THE
   PLAYER TO AGREE TO IT.
   ----------------------------------------------------------------------------
   🔴 THE BUG THIS EXISTS TO CLOSE, measured end to end against a live database:
   the confirm dialog said "Ship for 2,000 🔥?" and the wallet was debited
   20,000. Both numbers were correct — they were just computed from different
   samples. routes.js prices from the carrier rows listCarriers() can SEE;
   transport_quote prices from the median of carriers that have actually
   DELIVERED, which no client can compute because a shipper cannot read a rival's
   contract history. On a normal board — one established carrier at base 400,
   two shells undercutting at 20 to win their first job — the two medians are an
   order of magnitude apart, and only the server's reaches wallet_charge.

   It was wrong in BOTH directions and only coincidentally right at launch, when
   no contract has been delivered anywhere and both sides fall to the same floor.

   routes.js's own drift ledger (see its D3 entry) named this and prescribed the
   remedy — "once a round trip has happened, prefer transport_quote's own
   returned price over this file's". This is that remedy; until now it was a
   comment describing something no code did.

   ⚠ WHY THIS IS SAFE TO TRUST AS THE FINAL NUMBER. transport_dispatch does not
     re-price. Its own comment is "THE PRICE IS THE QUOTE. Not recomputed, not
     accepted, not adjusted" — it calls transport_quote internally with the same
     six values and bills that. So the same six values sent from here return the
     number that will actually be charged, and the dialog and the debit come
     from one expression at last.

   ⚠ REJECTED: reproducing the server's median on the client. routes.js's header
     is right that it cannot be done — the client cannot see which carriers have
     delivered — and an approximation would put us back to two numbers that
     disagree, only with the disagreement now hidden behind a claim of accuracy.

   ⚠ REJECTED: skipping the client quote entirely and only ever calling this.
     The rate board has to price every carrier on screen to be a rate board, and
     that is one RPC per row on every repaint. routes.js stays the DISPLAY
     pricer; this is the CONFIRMATION pricer, called once, at the moment money
     is about to move.

   Degrades like every other call here: offline, or before sql/038 is applied,
   the caller gets ok:false with `missing`/`offline` set and is expected to fall
   back to the client estimate AND SAY SO. A silent fallback would recreate the
   original bug with extra steps.
   ════════════════════════════════════════════════════════════════════════════ */
export async function serverQuote(carrierId, fromNode, toNode, hops, units, escort) {
  const c = client(); if (!c) return { ...OFFLINE, why: offWhy() };

  /* Object-in-first-position, matching dispatch() so both take the same shape
     index.js already carries. Read defensively in every spelling the seam has
     used, because a quote object crosses two module boundaries to get here. */
  if (carrierId && typeof carrierId === 'object') {
    const q = carrierId;
    escort   = q.escort;
    units    = q.cargoUnits != null ? q.cargoUnits : q.units;
    hops     = q.hops;
    toNode   = q.to   != null ? q.to   : (q.toNode   != null ? q.toNode   : q.to_node);
    fromNode = q.from != null ? q.from : (q.fromNode != null ? q.fromNode : q.from_node);
    carrierId = q.carrierId != null ? q.carrierId : q.carrier_id;
  }

  const h = Math.floor(Number(hops));
  const u = Number(units);
  /* Refused HERE rather than sent, so a malformed request reads as a client bug
     with a client fix instead of arriving as the server's `bad_hops` over a form
     the player filled in correctly. Same reasoning as dispatch()'s bad_cargo. */
  if (!Number.isFinite(h) || h <= 0 || !Number.isFinite(u) || u <= 0) {
    return { ok: false, missing: false, offline: false, error: 'bad_quote_request',
             why: 'That haul has no distance or no load to price.',
             fix: 'Pick an origin, a destination and an amount, then quote it again.' };
  }

  /* ⚠ p_carrier_id NULL IS MEANINGFUL, NOT MISSING — it is how the server is
     asked for the Meridian Haulage fallback rather than for a player carrier.
     Coercing a falsy id to undefined here would drop the argument from the
     PostgREST call and resolve a different overload, or none. */
  return await rpc(c, 'transport_quote', {
    p_carrier_id: carrierId || null,
    p_from_node: fromNode == null ? null : String(fromNode).slice(0, 40),
    p_to_node: toNode == null ? null : String(toNode).slice(0, 40),
    p_hops: h,
    p_units: u,
    p_escort: !!escort,
  });
}

export async function dispatch(carrierId, rigId, fromNode, toNode, cargo, route) {
  const c = client(); if (!c) return { ...OFFLINE, row: null, why: offWhy() };
  const b = bridge();

  /* One object in first position is read as the whole request. `quoted` is
     kept rather than discarded because the units check further down needs the
     number the player was actually shown a price for. */
  let quoted = null;
  if (carrierId && typeof carrierId === 'object') {
    const q = carrierId;
    quoted = q;
    /* 🔴 A QUOTE IS NOT A REQUEST — see the header. Refused by its own name, so
       the message points at the call site instead of at the player's form. The
       test is on the FARE FIELDS, not on the absence of cargo alone: a caller
       who genuinely meant `dispatch({ cargo: {} })` has an empty manifest and
       should still hear `bad_cargo` below, which is a different bug with a
       different fix. Only an object that is recognisably one of routes.js's
       shapes AND carries no manifest lands here. */
    if (q.cargo == null && isQuoteShaped(q)) {
      return {
        ok: false, missing: false, offline: false, error: 'quote_not_request',
        why: 'That dispatch was handed a price quote instead of the haul it priced. A quote carries a fare, an ETA and a hop count — it carries no manifest, no origin and no rig, so there is nothing here to ship.',
        fix: 'Pass the request that was quoted: dispatch(carrierId, rigId, from, to, cargo, quote), or merge { from, to, cargo, rigId, carrierId } onto the quote before handing it over. This file will not fill them in — it has no map, no resource picker and no way to know which rig you meant.',
      };
    }
    route = route || q;
    cargo = q.cargo;
    toNode = q.to != null ? q.to : (q.toNode != null ? q.toNode : q.to_node);
    fromNode = q.from != null ? q.from : (q.fromNode != null ? q.fromNode : q.from_node);
    rigId = q.rigId != null ? q.rigId : q.rig_id;
    carrierId = q.carrierId != null ? q.carrierId : q.carrier_id;
  }
  route = route || {};

  const legs = normCargo(cargo);
  if (!Object.keys(legs).length) {
    return { ok: false, missing: false, offline: false, error: 'bad_cargo',
             why: 'There is nothing on that manifest to ship.', fix: 'Pick a resource and an amount.' };
  }
  const units = unitsOf(legs);

  /* 🔴 THE MANIFEST MAY NOT BE BIGGER THAN THE LOAD THE PLAYER AGREED TO PAY
     FOR. The confirm dialog quotes a fare for `cargoUnits`; the server prices
     from `p_units`, which is summed from the manifest. Those are the same
     number on every path index.js takes today — but if they ever drift apart
     the player is charged for a load they never saw a price for, and they
     already pressed Yes. Refusing costs one re-quote; the alternative is a
     silent overcharge, which is the failure this whole file is arranged around.
     ⚠ ONLY THE OVER direction is refused. A manifest SMALLER than the quote is
       a smaller haul at a smaller price — the server re-derives the fare from
       what actually ships, so the player is charged less than they agreed to,
       and refusing that would be refusing a haul in the player's favour. */
  const quotedUnits = quoted ? Math.floor(Number(quoted.cargoUnits)) : NaN;
  if (Number.isFinite(quotedUnits) && quotedUnits > 0 && units > quotedUnits) {
    return {
      ok: false, missing: false, offline: false, error: 'manifest_exceeds_quote',
      why: 'That manifest is ' + n(units) + ' units but the price you approved was quoted for ' + n(quotedUnits) + '. The exchange bills what actually ships, so sending it would charge you more than you agreed to.',
      fix: 'Re-quote the haul at ' + n(units) + ' units and confirm the new fare. Nothing was charged and no cargo has moved.',
    };
  }

  const hopsRaw = Math.floor(Number(route.hops));
  const hops = (Number.isFinite(hopsRaw) && hopsRaw > 0) ? hopsRaw : null;

  /* THE ESCROW. Every leg is verified before anything is deducted, then the
     manifest leaves the stash. It has to happen on this side: sql/038's header
     publishes the limit plainly — cargo lives in a client save blob, so the
     server "can only BOUND a haul, not recompute one", and a manifest nobody
     debited is freight the shipper never actually had. */
  const held = takeRes(b, legs, 'that haul');
  if (!held.ok) return { ok: false, missing: false, offline: false, error: held.code, why: held.why, fix: held.fix };

  try {
    const r = await rpc(c, 'transport_dispatch', {
      p_carrier_id: carrierId || null,
      p_rig_id: rigId || null,
      p_from_node: fromNode == null ? null : String(fromNode).slice(0, 40),
      p_to_node: toNode == null ? null : String(toNode).slice(0, 40),
      p_hops: hops,
      p_units: units,
      p_cargo: legs,
      p_escort: !!route.escort,
      /* The retry guard. sql/038 is explicit that a caller sending no ref gets
         "no retry protection at all": a dispatch that succeeded server-side and
         lost its answer on the way home would sell the shipper a second haul.
         One id per attempt, minted here, so a resend of THIS call matches. */
      p_client_ref: String(route.clientRef || route.client_ref || newRef()).slice(0, 64),
    });

    if (!r.ok) {
      // The RPC refused. The cargo never left, so put it back — uncapped, in
      // reverse — and hand the caller the reason it gave.
      held.refund();
      return r;
    }

    /* 🔴 A RETRY MUST NOT ESCROW THE CARGO TWICE.
       transport_dispatch is idempotent on `client_ref`: a call whose answer was
       lost on the way home and is sent again gets the SAME contract back with
       `retried: true`, and is charged nothing more. But the escrow above ran
       BEFORE the RPC on both attempts, so by here the manifest has left the
       stash a second time for a haul that was already loaded. The server's
       idempotence protects the Cinder; nothing but this line protects the
       goods. Hand them back — and note that the ordinary double-CLICK is a
       different event that does not reach here, because each attempt mints its
       own ref and therefore buys its own haul. */
    if (r.data && r.data.retried === true) held.refund();

    /* 🔴 RECORDING THE ESCROW, AND THE ONE PLACE THIS FILE MUST NOT UNWIND.
       Past this line the contract EXISTS and wallet_charge has already taken
       the fee, so a refused save is not a failed haul and must never be
       reported as one. The obvious shape — persist(); catch; refund(); "the
       haul did not go out" — would print a sentence that is simply false about
       a contract the player is holding, and would hand back cargo they are also
       paying to have moved. So the failure is REPORTED, loudly, and the haul is
       still ok:true. The direction it fails in is the player's favour: the
       deduction is in memory only, so a reload brings the cargo back. */
    let warn;
    try {
      persist(b);
    } catch (e) {
      warn = 'The haul is booked and paid for, but the manifest did not save — your cargo may reappear after a reload.';
      try { b.toast('⚠ ' + warn, 7000); } catch (e2) {}
    }

    /* ⚠ THE HONEST LIMIT OF THE REFUND HANDED BACK HERE. cost.js returns its
       closure on success so a caller that fails while RECORDING a purchase can
       still unwind, and that is why this one is returned too — but it unwinds
       the CARGO ONLY. By this line the contract exists and the fee has been
       charged by wallet_charge inside the RPC, and no client can undo a
       server-side charge: the only function that mints Cinder credits
       auth.uid(), and sql/034's own header calls it "NOT the real fix". So
       calling refund() after a successful dispatch returns the goods to a
       shipper who is also holding a paid contract to move them. It is here for
       a failed local record, not as a cancellation. */
    const d = r.data;
    return {
      ok: true, row: d, contractId: d.contract_id, price: d.price, capped: !!d.capped,
      arriveAt: d.arrive_at, etaMinutes: d.eta_minutes, riskPct: d.risk_pct,
      retried: !!d.retried, refund: held.refund, warn: warn,
    };
  } catch (e) {
    held.refund();
    const f = fail(e);
    return { ...f, row: null, why: 'The haul did not go out and the cargo was returned. ' + f.error.slice(0, 180) };
  }
}

/* A per-attempt id for the retry guard. crypto.randomUUID is used when it
   exists and the fallback is not cryptographic — it does not need to be. Its
   only job is to be distinct from every OTHER dispatch this player makes, and a
   collision would be refused by the unique index rather than double-charge. */
function newRef() {
  try {
    if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch (e) {}
  return 'r' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/* ════════════════════════════════════════════════════════════════════════════
   SETTLE — the haul lands, and the cargo comes off the truck.

   The OUTCOME is rolled server-side against the risk_pct the server itself
   wrote at dispatch, and the payout is an append-only transport_ledger row
   credited to the carrier's COMPANY. This function moves no Cinder, in either
   direction, and must not be made to (see the header).

   What it does move is the shipper's cargo, which was escrowed at dispatch.
   Three rules, and each one is a hole if it is dropped:

   🔴 ONLY THE SHIPPER IS CREDITED. Either party may settle — arrival is
      offline-safe and whoever logs in first should be able to close the haul —
      so a carrier settling a stranger's contract must not receive that
      stranger's freight into their own stash. The contract row is read first,
      for `shipper_id` and `cargo`, precisely so this can be checked; the RPC's
      own answer does not carry either.

   🔴 A RETRY CREDITS NOTHING. transport_settle is idempotent and answers an
      already-settled contract with `retried: true` rather than an error, which
      is what makes a double-click harmless server-side. Crediting on that
      branch would make the SAME double-click a duplication exploit: click
      settle twice, receive the cargo twice.

   ⚠ THE CREDIT IS NOT TRANSACTIONAL WITH THE SETTLEMENT, and cannot be made so
     from here. The ledger is server-side, the stash is a client blob, and there
     is no third place to write "paid but not yet delivered". A tab closed in
     the gap between the RPC returning and addRes landing loses that cargo, and
     the retry branch above means the next settle will not re-credit it.
     Rejected alternative: credit on every settle including retries, which
     trades a rare loss for a repeatable exploit. Recorded, not fixed.

   🔴 THE CREDIT USES addRes, NOT refundRes — the exact opposite of the escrow's
      unwind, and deliberately. This is a PAYOUT, not an undo: the goods have
      been in transit, the stash cap applies, and a delivery that overflows a
      full vault is a smaller delivery. refundRes bypasses the ceiling, which is
      right only for units the player held moments ago.
   ════════════════════════════════════════════════════════════════════════════ */
export async function settle(contractId) {
  const c = client(); if (!c) return { ...OFFLINE, row: null, why: offWhy() };
  const b = bridge();
  if (!contractId) {
    return { ok: false, missing: false, offline: false, error: 'no_contract',
             why: 'That contract has no id.', fix: 'Refresh the depot.' };
  }
  let uid = null;
  try { uid = b.userId(); } catch (e) { uid = null; }

  try {
    // Read BEFORE settling. After the RPC the row's status has already moved,
    // and the cargo manifest is the only record of what was escrowed.
    let manifest = {}, shipper = null;
    const pre = await c.from('transport_contracts')
      .select('id,shipper_id,cargo,status').eq('id', contractId).maybeSingle();
    if (pre.error) return { ...fail(pre.error), row: null };
    if (pre.data) { manifest = normCargo(pre.data.cargo); shipper = pre.data.shipper_id; }

    const r = await rpc(c, 'transport_settle', { p_contract_id: contractId });
    if (!r.ok) return r;

    const d = r.data;
    let delivered = 0;
    const refused = [];
    if (d.status === 'delivered' && d.retried !== true && shipper && uid && shipper === uid) {
      for (const id in manifest) {
        /* 🔴 WHAT LANDED IS MEASURED, NEVER ASSUMED FROM THE REQUEST — and a
           driven test is why this line looks like this. addRes is CAPPED and
           returns a boolean, so a vault with room for 10 of a 40-unit delivery
           adds 10 and answers `true`. Counting the request instead of the delta
           made `delivered` read 40, the shortfall read 0, and 30 units vanished
           with the player told nothing. A boolean cannot say how much a capped
           add took; the ledger's own before/after can. */
        let before = 0, after = 0;
        try {
          before = b.getRes(id) | 0;
          // The boolean still matters: `false` means the stash REFUSED the leg
          // outright, which is a different sentence from "it took what it could".
          if (b.addRes(id, manifest[id]) === false) refused.push(id);
          after = b.getRes(id) | 0;
        } catch (e) { after = before; refused.push(id); }
        delivered += Math.max(0, after - before);
      }
      try { persist(b); } catch (e) {
        // The goods are in memory but not on disk. Say so — silence here is the
        // swallowed-save class of bug this project has shipped repeatedly.
        try { b.toast('⚠ The delivery did not save. Reopen the depot before closing the tab.', 6500); } catch (e2) {}
      }

      /* addRes is CAPPED, so a full vault swallows part of a delivery and
         reports nothing. That has to be visible: "where did my cargo go" is not
         a question a player should have to take to the console. This is the
         same cap that makes addRes the wrong call for a refund — here it is
         the right one, and this line is what makes its cost legible. */
      const short = unitsOf(manifest) - delivered;
      if (short > 0) {
        try {
          b.toast(refused.length
            ? '📦 The stash refused ' + refused.join(', ') + ' — ' + n(short) + ' units of the delivery had nowhere to go.'
            : '📦 The stash is full — ' + n(short) + ' units of the delivery had nowhere to go.', 6500);
        } catch (e) {}
      }
    }

    return {
      ok: true, row: d, status: d.status, amount: d.amount, retried: !!d.retried,
      carrierBalance: d.carrier_balance, delivered: delivered,
      why: d.status === 'lost'
        ? 'The haul was lost on the road. A lost haul is not refunded — that is what reliability and escorts are for.'
        : undefined,
    };
  } catch (e) { return { ...fail(e), row: null }; }
}

/* ════════════════════════════════════════════════════════════════════════════
   REPAIR — one rung up the condition ladder, paid for on this side.

   THE ONLY CINDER SPEND IN THIS FILE, and it is shaped exactly like
   corpTreasuryDeposit() (in index.html), which is this repo's settled answer
   to "spend, then write": confirm → spendGems with its RETURN VALUE
   CHECKED → the server call → on failure, put the money back and toast the REAL
   error. Never the raw arithmetic next door in index.html's `ppBuyVehicle`,
   which subtracts from the balance directly and so bypasses whatever the real
   spend path does about persistence and tax exemption — the sibling bug in
   index.html is the misspelled `spendCinderS` that "ALWAYS took the
   raw-subtraction fallback below and bypassed the real spend path".

   ORDER OF THE LEGS, and it is the reverse of cost.js's for a reason. cost.js
   spends resources first and Cinder last because Cinder is the leg that can
   fail for outside reasons. Here the parts leg is local and the Cinder leg is
   local, but the leg that can fail for outside reasons is the RPC — a rig
   already at Pristine, a rig mid-haul, the daily repair cap — so BOTH local
   legs are taken first and the RPC is last. Everything unwinds if it refuses.

   The refund for Cinder goes through addGems WITH A NAMED REASON, and the
   reason is not decoration: every faucet used to land in the wallet ledger as
   an anonymous blob, so the supply could not be audited — production showed
   +602,357 🔥 of reconcile gains in one week with nothing attributing a single
   unit to a source. A named reason per faucet is the prerequisite for ever
   noticing abuse. (Cinder has no ceiling, which is why addGems is a true undo
   here while addRes would not be for resources.)
   ════════════════════════════════════════════════════════════════════════════ */
export async function repair(rigId) {
  const c = client(); if (!c) return { ...OFFLINE, row: null, why: offWhy() };
  const b = bridge();
  if (!rigId) {
    return { ok: false, missing: false, offline: false, error: 'no_rig',
             why: 'That rig has no id.', fix: 'Refresh the yard.' };
  }

  const bill = repairBill(b);
  if (!bill.ok) return { ok: false, missing: false, offline: false, error: bill.code, why: bill.why, fix: bill.fix };

  // ── Phase 1: verify every leg. Nothing has moved.
  const have = b.gems() | 0;
  if (have < bill.cinder) {
    return { ok: false, missing: false, offline: false, error: 'insufficient_cinder',
             why: 'That repair costs ' + n(bill.cinder) + ' 🔥 and you have ' + n(have) + '.',
             fix: 'Nothing was charged.' };
  }
  const parts = takeRes(b, bill.parts, 'that repair');   // verifies before deducting
  if (!parts.ok) return { ok: false, missing: false, offline: false, error: parts.code, why: parts.why, fix: parts.fix };

  // ── Phase 2: the Cinder leg. spendGems re-checks the balance and CAN still
  //    say no — a concurrent tab, a server wallet reconcile — which is exactly
  //    the failure the parts refund above exists for.
  if (!b.spendGems(bill.cinder)) {
    parts.refund();
    return { ok: false, missing: false, offline: false, error: 'spend_refused',
             why: 'The wallet refused ' + n(bill.cinder) + ' 🔥 — every part taken was refunded.',
             fix: 'Reopen the depot and try again.' };
  }

  // One closure that unwinds BOTH legs, in reverse, so there is a single thing
  // to call on every failure path below instead of three near-copies.
  const unwind = () => {
    let back = false;
    try { back = (b.addGems(bill.cinder, 'transport_repair_refund') !== false); } catch (e) { back = false; }
    if (!back) {
      // A Cinder refund the wallet refused is money the player is owed. Silence
      // here would be the swallowed-persist bug wearing a refund's clothes.
      try { b.toast('⚠ ' + n(bill.cinder) + ' 🔥 could not be refunded. Tell an admin before spending anything else.', 8000); } catch (e) {}
    }
    parts.refund();              // saves and reports on its own behalf
    saveRefund(b, 'The repair bill');
    return back;
  };

  try {
    persist(b);                              // a refused save unwinds, it does not ship
    const r = await rpc(c, 'transport_repair', { p_rig_id: rigId });
    if (!r.ok) { unwind(); return r; }
    const d = r.data;
    return {
      ok: true, row: d, condition: d.condition, was: d.was, spent: bill.cinder,
      // On success the caller may still fail while recording; both legs are
      // local here, so unlike dispatch this closure is a complete undo.
      refund: unwind,
    };
  } catch (e) {
    unwind();
    const f = fail(e);
    return { ...f, row: null, why: 'The repair did not happen and the bill was refunded. ' + f.error.slice(0, 180) };
  }
}
