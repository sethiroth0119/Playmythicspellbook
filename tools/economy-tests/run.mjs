/* 🧪 THE ECONOMY GAUNTLET — the regression gate for /src/economy.
   ----------------------------------------------------------------------------
   Run from the repo root:   node tools/economy-tests/run.mjs
   Exits non-zero on any failure, so it can gate a deploy.

   Three rounds, and each exists because it caught something real:
     1. HOSTILE INPUT   NaN/Infinity dt, corrupt saves, zero population, a
                        garbage host object. Found: an Infinity dt that ran
                        three economic days off a bad clock read; a NaN
                        population from one bad byte in a save; NaN leaking
                        into the freight panel.
     2. INVARIANTS      Conservation of Cinder across 40 randomized cities ×
                        120 days, save/load completeness, price clamps, bank
                        solvency, level gates, the faucet ceiling, the payout
                        bound. Found: three unsaved state variables, one of
                        which let a firm take a SECOND loan by reloading.
     3. INTEGRATION     Buildings → businesses → jobs, through the same map
                        node-city uses. Found: a rebuilt tile inheriting the
                        previous business's balance sheet.

   ⚠ Round 3 models node-city's REAL population cap (4 + 6 per housing level).
     An earlier version let population grow freely, which made a tuning change
     look strictly beneficial when against the real cap it deleted the
     unemployment mechanic entirely. A test that does not match the host's
     constraints will confidently point the wrong way. */
import { spawnSync } from 'child_process';
/* mkdir/readdir/write/rm are for round0s §6, which proves its two refusals can
   fail by REBUILDING /src/economy into a temp directory with one line reverted
   and importing that copy — the shipped tree is never written to. */
import { readFileSync, mkdirSync, readdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
const here = dirname(fileURLToPath(import.meta.url));
let bad = 0;

/* 🧨 THE SABOTAGE SWITCH — how these rounds are proved to be able to FAIL.
   ----------------------------------------------------------------------------
   A tripwire nobody has ever seen trip is a comment. Rounds 0b and 0c both
   defend against SILENT failures (an id that is dropped without a warning, a
   firm that is reaped without a log line), so "it printed ✅" is exactly the
   evidence they are designed to distrust. Each accepts one deliberate injury:

     ECON_TEST_SABOTAGE=bogus-id   round0b: add an unproducible id to the map
     ECON_TEST_SABOTAGE=no-map     round0b AND round0d: read node-city from a
                                   path that is not there, i.e. extraction
                                   returns NOTHING
     ECON_TEST_SABOTAGE=withdraw   round0c: withdraw an UPGRADING tile from the
                                   reconcile list for exactly one sync — the
                                   invariant at node-city:17117, violated once
     ECON_TEST_SABOTAGE=seed-mint  round0e: credit one new firm its seed capital
                                   out of nowhere, inside the between-tick gap —
                                   the original firms.js mint, re-committed once
     ECON_TEST_SABOTAGE=charter-cap round0e: push the lifetime founding tally
                                   past its ceiling, i.e. a second issuance path
                                   that ignores the clamp
     ECON_TEST_SABOTAGE=reap-burn  round0e: burn a demolished firm's cash at the
                                  seam, exactly as Firms.reap() used to
     ECON_TEST_SABOTAGE=dark-cards round0j: put `holographicFoil: 0.02` back into
                                   the boosterPacks recipe. That is the SHIPPED
                                   recipe, and because firms.js produce() takes
                                   the MINIMUM over inputs, that one coefficient
                                   — for a foil no city tile can make — is the
                                   whole difference between a card economy and
                                   `cardOutput()` returning totalUnits 0 forever
     ECON_TEST_SABOTAGE=price-drift round0k: nudge the packagingMaterial timber
                                   coefficient 0.8 → 1.9 — the "soften the fall"
                                   retune FIX-D2 considered and rejected. It is a
                                   perfectly reasonable-looking recipe edit that
                                   moves 13 consumer goods, which is the whole
                                   point: 0k is red for a change nothing else in
                                   this gate can see
     ECON_TEST_SABOTAGE=twin-blind round0f: drop ECO_LOGISTICS_OPS on the way
                                   in — the exact pre-fix source for op_warehouse
     ECON_TEST_SABOTAGE=stale-workplaces round0f §7: evaluate workplaceTypes()
                                   against a BUILDINGS the ops registration loop
                                   has NOT run over. That is precisely what the
                                   `const WORKPLACES = Object.keys(BUILDINGS)…`
                                   snapshot did, three thousand lines too early
     ECON_TEST_SABOTAGE=cap-typo   round0f §9: mistype a value of
                                   ECO_LOGISTICS_TILES ('railhead' → 'railheed').
                                   Before §9 existed this passed EVERY check in
                                   the gate, because a key missing from
                                   ECON.logistics.capacity contributes 0 and both
                                   sides of every count comparison were 0
     ECON_TEST_SABOTAGE=venue-blind round0g: empty MORALE_VENUE_OPS on the way
                                   in — the exact pre-fix source for op_dojo
     ECON_TEST_SABOTAGE=wx-twin-blind round0h: empty WEATHER_TWIN_OPS on the way
                                   in — the exact pre-fix source for op_agri,
                                   op_smuggling, op_research and op_oil
    ECON_TEST_SABOTAGE=draw-compound round0e: open the founding window's treasury
                                   allowance, reproducing the per-call clamp that
                                   let one sync take 91.15% of the treasury

     ECON_TEST_SABOTAGE=warm-residue round0m: carry `Logistics.congestionMul`
                                   across `Sim.reset()` by hand — the shipped
                                   defect, in which a field written at the END of
                                   an economic day and read at the START of one
                                   was simply absent from reset(). Under it a
                                   fresh city is quoted freight at the PREVIOUS
                                   city's congestion, and the same configuration
                                   pays differently depending on what the test
                                   process happened to simulate before it

     ECON_TEST_SABOTAGE=no-producer round0p: delete the CITY_PRODUCTION building
                                   that yields `timber`, i.e. promote an id into
                                   RESOURCES and forget its producer. That is the
                                   "real and inert" failure RESOURCES_NEXT.md is
                                   written about, and nothing else in the repo
                                   sees it: the vault renders the row at 0, the
                                   market lists it, the audit is untouched
     ECON_TEST_SABOTAGE=promo-drift round0p: add one plausible id (`flour`) to
                                   PROMOTED_CHAIN_IDS without touching
                                   ECO_BUILDING_MAP — a hand-extended promotion
                                   list, which is the other direction the same
                                   mistake arrives from

     ECON_TEST_SABOTAGE=loot-ledger round0q: point the three reward sites back at
                                   RESOURCE_IDS / RESOURCES, i.e. re-commit the
                                   pre-fix code. Reddens COMPOSITION and reprints
                                   the ~20%-legacy dilution the round exists for
     ECON_TEST_SABOTAGE=loot-promo  round0q: promote a fake id (`flour`) into
                                   RESOURCES without saying whether it is
                                   lootable. Reddens COVERAGE — the guard that
                                   forces the NEXT promotion to declare itself

     ECON_TEST_SABOTAGE=sell-promo  round0t §1: promote a fake id (`flour`) into
                                   RESOURCES without giving it a price, i.e. the
                                   exact shape of the defect — 59 ids reached the
                                   Refinery shelf priced at `|| 3` because nobody
                                   had to say. Reddens PRICE COVERAGE
     ECON_TEST_SABOTAGE=sell-pump   round0t §3/§3b: double one chain building's
                                   yield — in the CATALOGUE, so the driven collect
                                   sees it too — until a cycle's output outsells
                                   the inputs it ate. Reddens NOT-A-PUMP and the
                                   driven ratio together, at 2.000×. DERIVATION
                                   stays green on purpose: the parity price of a
                                   bigger yield still floors to 1, so the failure
                                   is isolated to the thing that actually moved
     ECON_TEST_SABOTAGE=sell-asym   round0t §3b: patch the SHIPPED
                                   production.state.js so collect() charges its
                                   inputs FLAT again while pending() still scales
                                   the yield by terroir — the original defect, put
                                   back into the module the round actually runs.
                                   Reddens the driven ratio at 4.800× with 56/56
                                   chain producers Cinder-positive. If this one is
                                   ever GREEN, §3b has stopped measuring the payout
                                   path and is certifying the catalogue again
     ECON_TEST_SABOTAGE=sell-cap    round0t §3b: patch pending()'s affordability
                                   loop back to FLAT while collect() keeps charging
                                   by tf — the fix's own failure mode, and the
                                   "banked 🥫 270 (6 cycles) → Not enough Water" bug
                                   production.state.js documents. Reddens the
                                   promise-vs-charge round with "promised 6 paid 2"
     ECON_TEST_SABOTAGE=sell-default round0t §1b: re-commit the pre-fix table —
                                   drop every derived price and let `|| 3` price
                                   the ledger again. Reddens COVERAGE, DERIVATION
                                   and the driven ratios together

     ECON_TEST_SABOTAGE=boot-presweep round0r §1/§2: put the pre-catch-up sweep
                                   back — call bldNormalize() in its completing
                                   form from boot(), i.e. re-commit the boot-order
                                   mint verbatim. Reddens THE GAP and the
                                   never-mint bound
     ECON_TEST_SABOTAGE=cancel-sited round0r §3: blind bldCancel to the operation
                                   row (`opsRowForKey(kk)` → `null`), which is
                                   exactly the pre-fix source: the licence stays
                                   sited and the next boot reconcile resurrects
                                   the building FINISHED
     ECON_TEST_SABOTAGE=cancel-blind round0r §3c: decide "is this tile an
                                   operation?" from whether a ROW RESOLVED
                                   (`!!opsTypeOf(t.type)` → `!!opsRowForKey(kk)`)
                                   instead of from the tile's own type. That is
                                   the round-1 source, and it hands out the SAME
                                   free operation whenever the register is down —
                                   `message` mode, an older parent, a hired
                                   manager. Reddens the refusal
     ECON_TEST_SABOTAGE=ops-zombie  round0r §3c/§3d: let opsReconcile's boot
                                   branch resurrect a dangling licence as a
                                   FINISHED building again. TWO patches, and the
                                   second is the one that matters: it re-commits
                                   the ROUND-2 source verbatim —
                                   `bldRecord(0, 1, bldDuration(…), {})` — which
                                   is not a deleted line but an INERT one. It
                                   reads as a fix and returns null on every real
                                   boot, because opsReconcile(true) is awaited by
                                   loadState, before the economy module exists,
                                   so bldCfg() is null → bldDuration 0 →
                                   bldRecord null → `bld: null` → FINISHED.
                                   ⚠ It reddens §3d ONLY. §3c runs with ECON up,
                                     where bldRecord answers normally, so §3c
                                     stays GREEN under this sabotage — which is
                                     exactly how the defect shipped for a round.
                                     If a future edit makes §3c redden here too,
                                     that stub has been un-chained from ECON_ON
                                     again; see the bldDuration note in mkCity.
     ECON_TEST_SABOTAGE=refund-blind round0r §3e: re-commit the shipped refund —
                                   nobody asks the stash ceiling before promising
                                   a 100% refund (bldRefundFit's headroom read →
                                   `null`, so `free` stays Infinity, the fit is
                                   always whole, no dialog is raised and every
                                   promise site prints "refunded in full"). addRes
                                   still clamps, so a Power Station cancelled at a
                                   full 2,000-unit vault returns its Cinder and
                                   destroys all 400 units of materials in silence
     ECON_TEST_SABOTAGE=demolish-blind round0r §3f: re-commit the shipped 🧨
                                   demolish tail — no honesty question, the raw
                                   `for (const k in refund) … addRes(k, …)` loop
                                   back in place of bldPayRefund, and no toast.
                                   Demolishing a mid-upgrade building at a full
                                   vault then destroys BOTH refund legs with
                                   nothing at all said to the player
     ECON_TEST_SABOTAGE=refund-raw  round0r §4: strip bldLoad's two clamps, i.e.
                                   pass a save's `pc` and `pr` through unbounded
                                   and unvalidated, as shipped
     ECON_TEST_SABOTAGE=free-repair round0r §5: restore loadState's unconditional
                                   `if (t.bld) t.damaged = false;`
     ECON_TEST_SABOTAGE=lab-ungated round0r §6: remove the bldSite gate from
                                   opsFindLab and opsResearchAdj

     ECON_TEST_SABOTAGE=settle-requested round0n: credit the units REQUESTED
                                   rather than the units the row says were
                                   FILLED — the rule that stops a seller
                                   shipping the same 40 units twice
                                   (this switch predates the block below and was
                                   simply missing from this index, which
                                   declares itself complete; it works)

     ── round0s, the five boundaries the day audit cannot see ──────────────────
     ECON_TEST_SABOTAGE=pop-zero   round0s §1: restore households.js's
                                   `if (S.pop[t] === 0) { S.savings[t] = 0; }`,
                                   i.e. destroy an emptied tier's savings before
                                   `runDay` opens its window. Measured on the
                                   shipped tree: 3,987.58 🔥 gone, audit green
     ECON_TEST_SABOTAGE=inflight-drop round0s §2b: write the save WITHOUT the
                                   `payoutInFlight` key — serialize() verbatim as
                                   it shipped. A save taken between claimPayout()
                                   and the bridge's answer then records the
                                   claimed Cinder NOWHERE: 19.00 🔥 destroyed on
                                   one ordinary tab close, permanently, from the
                                   saved file, lastAudit.ok true throughout
     ECON_TEST_SABOTAGE=rearm-caller round0s §3: strip `established` back out of
                                   node-city's own E.mount() literal — i.e. the
                                   production caller that passed no flag at all
                                   for the whole life of the feature. A lived
                                   180-day city, charterIssued 300,000.00 /
                                   totalCinder 293,295.48, remounts at
                                   300,000.00 / 300,000.00 with the full
                                   700,000 🔥 allowance back
     ECON_TEST_SABOTAGE=defer-closed round0s §3: collapse cityEcoVerdict's third
                                   value into 'established' — i.e. FAIL CLOSED,
                                   the tree this package fixed. A brand-new
                                   player whose very first city read is ambiguous
                                   (an RLS hiccup, a momentary offline, a save
                                   stamped for somebody else) is PERMANENTLY
                                   denied the 300,000 🔥 founding tranche:
                                   measured charterIssued 0.00 🔥, forever, and
                                   their city can never capitalise a firm
     ECON_TEST_SABOTAGE=defer-open round0s §3: collapse it into 'new' instead —
                                   the tree BEFORE that fix. The same ambiguous
                                   read now buys a fresh 300,000 🔥 tranche and
                                   re-arms the whole 700,000 🔥 allowance. The two
                                   switches are the two horns this round exists
                                   to prove nobody has to pick between
     ECON_TEST_SABOTAGE=boot-open  round0s §3b: initialise node-city's
                                   `_cityVerdict` back to a DECIDED value, i.e.
                                   answer the founding question before any
                                   evidence exists. It is only ever derived
                                   inside loadState(), which runs behind an await
                                   inside boot's try — whose catch logs
                                   "non-fatal" and falls straight through to the
                                   one E.mount call. So any throw before that
                                   (spawnAnchors, a rejected bridge read, a
                                   renderer fault) decides it off a bad network
                                   instead of deferring it
     ECON_TEST_SABOTAGE=defer-noSave round0s §3c: put back the FIRST attempt at
                                   deferral, which blocked BOTH save writers
                                   while the founding question was open. It
                                   traded a denied tranche for a deleted city:
                                   `window.cityStateLoad` raises
                                   `__cityLoadUnsafe` unconditionally whenever
                                   there is no Cloud client or no
                                   Profile.cloud.userId, so a signed-out or
                                   offline player is 'unknown' as a STEADY STATE
                                   and the retry can never clear it. Measured
                                   through the shipped bridge: verdict 'unknown',
                                   localStorage keys written 0, cityStateSave
                                   calls 0 — every session, forever
     ECON_TEST_SABOTAGE=defer-serverwrite round0s §3c: let a deferred session
                                   write the ACCOUNT row as well. That is the
                                   hazard the block was invented for and it is
                                   real: measured, one deferred session's empty
                                   city lands on top of a 400-day save the read
                                   was merely refused
     ECON_TEST_SABOTAGE=defer-nostamp round0s §3c: drop the `ecoDefer` term from
                                   cityEcoVerdict, so the deferral's own local
                                   save is read back as proof of an established
                                   city — a brand-new offline player talked out
                                   of their 300,000 🔥 by their own autosave
     ⚠ ECON_TEST_SABOTAGE=rearm is RETIRED. It flipped an argument this file
       passed itself, so it only ever proved the refusal inside /src/economy
       fires — while the one production caller passed nothing and the hole
       stayed wide open under a green gate. The switches above break the
       SHIPPED call and the SHIPPED initialiser instead. See §3's header.
     ECON_TEST_SABOTAGE=payout-drop round0s §4: restore `.catch(() => {})`, i.e.
                                   drop whatever claimPayout() took and the
                                   bridge then refused. 10,193 🔥 in neither
                                   ledger over 400 ticks, audit green throughout

     ── COVER, the three fixes that had no round at all ────────────────────────
     🔴 ALL THREE WERE FOUND THE SAME WAY: copy the product tree outside the
        repo, revert ONE hunk of this session's 67, run the gate and both syntax
        checks. 21 of the 67 came back green. These are the three that a player
        can be hurt by, and each one's round below drives the SHIPPED statement
        rather than a shape this file wrote — which is what all three were
        missing. See each section's header for the caller it mirrors.
     ECON_TEST_SABOTAGE=save-gone  round0s §3e: re-commit the pre-fix saveSoon()
                                   timer body — `_saveWouldErase()` and a
                                   one-argument `saveCity(serialize())`. That
                                   function NO LONGER EXISTS (it became
                                   `_savePolicy()`), so the reverted tree throws
                                   a ReferenceError on EVERY autosave: the city
                                   simply stops saving, silently, and neither the
                                   gate nor `_synckcheck.mjs` could see it —
                                   an undefined free variable is valid syntax.
                                   §3e catches it TWICE, on purpose: the lifted
                                   writers are executed (so the ReferenceError is
                                   caught and reported as a failure, not a stack
                                   trace) AND every identifier the save path
                                   calls is checked against node-city's own
                                   declarations, so a call on a branch this
                                   scenario does not take is caught too
     ECON_TEST_SABOTAGE=load-catch-open round0s §3d: strip the verdict downgrade
                                   out of loadState()'s catch clause, i.e. let a
                                   load that threw mid-way keep asserting the
                                   founding decision it derived before the throw.
                                   `_cityVerdict` is what boot()'s one E.mount
                                   call passes as `established`, so this is the
                                   founding tranche being issued off a half-built
                                   city. ⚠ The downgrade is deliberately
                                   CONDITIONAL — §3d asserts an ESTABLISHED city
                                   that threw in the renderer is NOT deferred,
                                   because deferring it would block the saves of
                                   a city already proved to exist
     ECON_TEST_SABOTAGE=faucet-untallied round0s §7: drop `S.faucetLifetime +=
                                   faucet` from runDay, i.e. stop tallying one
                                   of the two ways this city can make Cinder.
                                   Reddens the lifetime identity at -176.15 🔥
                                   — money that exists and that neither creation
                                   path admits to making
     ECON_TEST_SABOTAGE=imports-untallied round0s §7: drop `S.importsLifetime +=
                                   amount` from addImports(). Reddens the same
                                   identity at +11,195.44 🔥 in the other
                                   direction. ⚠ It injures the HELPER, not one
                                   of the four call sites that adopted it this
                                   session — see §7's header for the measurement
                                   that forced that choice, and for what §7
                                   therefore does and does not cover
     ECON_TEST_SABOTAGE=halt-flat  round0t §3c: re-commit haltState()'s FLAT
                                   one-cycle input figure (`(inputs[k]|0) * lvl`)
                                   into the shipped production.state.js, while
                                   collect() keeps charging by terroir.
                                   `pending()` opens with
                                   `if (!halt.running || cycles <= 0) return
                                   { cycles: 0 … }`, so this verdict does not
                                   explain a stall, IT CAUSES ONE: measured on
                                   poor ground (tf 0.150–0.450) it halts 30 of
                                   140 producer×ground probes that could afford
                                   the cycle, and on rich ground (tf 4.800) it
                                   calls a building "running" for a cycle
                                   collect() cannot fund
     ECON_TEST_SABOTAGE=defer-deadbtn round0s §3f: delete the block that
                                   dispatches 🔄 Retry now and ↻ Reload above
                                   ecoAction's `if (!E || !E.ready())` gate. A
                                   deferred economy is never ready, so both
                                   buttons on the deferral panel become inert —
                                   and once the backoff list is exhausted the
                                   panel itself says "Retrying · on request",
                                   i.e. the dead button is all a signed-out
                                   player has left
     ECON_TEST_SABOTAGE=defer-park round0r §1/§2b: delete boot()'s
                                   `try { if (_bldDeferredFinish) bldFinishAll(…) }`.
                                   `bldNormalize(true)` defers every completion,
                                   so without this statement its report is
                                   computed and discarded and every in-flight
                                   order parks FOREVER whenever /src/economy
                                   404s. §2b used to perform that hand-off with
                                   a line of its own, which is why the deletion
                                   was invisible

     ── round0w, the three payout fixes that shipped with no round on them ─────
     🔴 ALL THREE WENT GREEN UNDER A FULL REVERT BEFORE THIS ROUND EXISTED. They
        were found by copying the tree outside the repo, reverting one fix and
        running the gate — the method every switch here is supposed to encode.
     ECON_TEST_SABOTAGE=stale-refund  round0w §3: drop the `gen === mountGen` test
                                   from index.js's `back()`, so a rejection that
                                   lands after a remount refunds into the NEW
                                   city. MEASURED: city B, day 0, never ticked,
                                   came back owed 8,029.00 🔥 of city A's money
     ECON_TEST_SABOTAGE=stale-deliver round0w §4: drop the same test from the
                                   `notePayoutDelivered` arm, so a confirmation
                                   that lands after a remount is booked against
                                   the new city. MEASURED: city B, day 0,
                                   payoutLifetime 8,029.00 🔥 for money it never
                                   paid anyone — and the term that says "a payout
                                   ARRIVED" is the one it corrupts
     ECON_TEST_SABOTAGE=nobridge-drop round0w §5: empty the `else` that refunds
                                   when there is no bridge at all. MEASURED: 400
                                   bridgeless ticks left 8,469.00 🔥 stranded in
                                   `payoutInFlight` where nothing retries it —
                                   when the bridge came back only 100.00 🔥 was
                                   ever delivered, against 8,569.00 🔥 on the
                                   shipped tree

     ── 🗑 RETIRED WITH THE LOAD-TIME CINDER CLAMP, AND NOT TO BE REVIVED ───────
     `save-mint`, `payout-save`, `faucet-rail`, `owed-confiscate`,
     `faucet-margin` and `owed-ratchet` all sabotaged `clampLoadedCinder()` /
     `loadedCinderCeiling()`, which have been REMOVED from sim.js. Read the
     header above sim.js `audit()` before writing anything like them again: the
     clamp derived every rail from the save's own `day` count, so a four-field
     edit was worth ≈7,500 gems per real hour of real Profile.gems — and the
     round that was supposed to bound it read the forger's own ceiling as the
     yardstick and certified the forgery as PASSING. The rounds that graded it
     went with it. What SURVIVED is the half that measures a player being
     harmed: §2a (a rejecting bridge's Cinder comes back after a reload) and
     §2b (a claim in flight when the page dies comes back too).

     ── round0s §6 and round0u, the three doors this package closed ────────────
     ECON_TEST_SABOTAGE=ops-swallow round0u: re-commit `Operations.fetchFailed =
                                   false` on a PostgREST `{error}` response, i.e.
                                   record a successful read of a table that was
                                   never read. The city then sees no licence and
                                   the free-licence grant writes a SECOND
                                   permanent corp_operations row
     ECON_TEST_SABOTAGE=ops-grant-unknown round0u: keep the honest flag but drop
                                   cityOpsGrantFree's `unknown-state` refusal, so
                                   it grants against a list it cannot vouch for
     ECON_TEST_SABOTAGE=ops-found-unguarded round0u §7: re-commit the FOURTH route
                                   — the Just Business "Found" button calling
                                   `_opCreateLocal(a.op, 0, 'free-licence')`
                                   inline, with the write-seam refusal removed
                                   too. This is the shape that SHIPPED past a
                                   green round 0u: fetchFailed was correctly
                                   true and the branch never asked. INSERTS=1
     ECON_TEST_SABOTAGE=ops-found-inline round0u §7: delete ONLY the delegation,
                                   leaving _opCreateLocal's own free-licence
                                   refusal in place. Behaviour still looks
                                   clean (INSERTS=0) — this switch exists to
                                   prove the TEXT assertion catches a re-inlined
                                   branch that a behaviour test cannot see
     ── COVER2: five paths whose SILENT revert destroys property or voids the ──
     ──          feature, and which a full-revert sweep found unguarded        ──
     🔴 FOUND THE SAME WAY AS THE BLOCK ABOVE, and measured before a line of
        this was written: copy the product tree outside the repo, reverse-apply
        ONE REAL HUNK of this branch's diff, run the gate and both syntax
        checks. Every hunk below came back CLEAN and GREEN, exit 0.
        ⚠ The demolish/cancel pair (h111/h112) was on that list too and is NOT
          here: round0r §3f already reddens on all three of h111, h112 and the
          two together. It was added one commit after the sweep was taken.
     ECON_TEST_SABOTAGE=save-noborder round0r §7: stop serialize() writing the
                                   `b` key — hunk h137 reversed. `s` and `d` are
                                   the ONLY record that a 24-hour job is
                                   running, so EVERY PAID ORDER ON THE BOARD
                                   vanishes on the next save, and bldLoad's
                                   resolve-toward-COMPLETION rule then hands the
                                   building over finished on the reload with the
                                   Cinder already spent
     ECON_TEST_SABOTAGE=load-nolvl round0r §7: take the `lvl` binding back out of
                                   loadState's tile statement — h145 reversed —
                                   so `bldLoad(td.b, lvl, td.type)` reads a free
                                   identifier and throws ReferenceError on the
                                   first tile of every load. NO CITY LOADS AT
                                   ALL, and an undefined free variable is valid
                                   syntax, so `_synckcheck.mjs` cannot see it.
                                   §7 catches it by EXECUTING the statement with
                                   `lvl` deliberately absent from the parameter
                                   list — the shape round0s §3e uses for
                                   `save-gone`
     ECON_TEST_SABOTAGE=gate-ungated round0r §8: turn BOTH placement refusals in
                                   the order-gate decorator into `if (false)` —
                                   h156's whole point, reversed. Unlimited
                                   queued jobs past bldSlots(), and a 3h23 arena
                                   placeable with no Construction Co., i.e. the
                                   entire municipal-ceiling design defeated
     ECON_TEST_SABOTAGE=cap-race   round0r §8: drop `+ _pendingOf(placeType)`
                                   from tryPlace's per-type count AND the two
                                   reservation declarations — h096. Two clicks
                                   15 ms apart on DIFFERENT squares then both
                                   pass a `cap: 1` check, which used to be a
                                   click and a refund away and is now a day-long
                                   unwinnable tile
     ECON_TEST_SABOTAGE=place-nobld round0r §8: drop `bld: bldRecord(…)` off the
                                   placed tile — h098. Every building goes up
                                   instantly: no timer, no site, nothing to
                                   cancel. The headline feature is simply not
                                   there and nothing else in this gate says so
     ECON_TEST_SABOTAGE=beat-dead  round0r §9a: delete `bldSweep(Date.now())`
                                   from animate()'s 4-second block — h180. It is
                                   the only thing in the live page that
                                   completes a due order, so the countdown
                                   reaches zero and the building sits inert
                                   until the player reloads or places something
                                   else
     ECON_TEST_SABOTAGE=offline-nosweep round0r §9b: delete the in-loop sweep
                                   from offlineCatchUp — h142 — so the scrape
                                   comes back null, which is what a deleted
                                   statement looks like from here (same shape as
                                   defer-park). OFFLINE COMPLETION STOPS
                                   ENTIRELY: a 24-hour build never finishes
                                   while the tab is closed, and boot()'s
                                   hand-off cannot save it because
                                   bldNormalize(true) defers rather than
                                   completes
     ECON_TEST_SABOTAGE=licence-paywalled round0u §8: put the 350,000 🔥 fee back
                                   in OPS_ECON and delete the override clamp —
                                   h014 + h017, which is how they would be
                                   reverted, the table saying one thing and the
                                   clamp having the last word. Every Cinder
                                   earner in the game sits above the free
                                   municipal ceiling, so this re-paywalls the
                                   whole feature behind income the player cannot
                                   earn yet. ⚠ Everything ELSE in round0u stubs
                                   `_opEcon` at startup 0, so all of it grades
                                   the grant while taking the zero on faith

     ⚠ round0s §6 takes no switch. It proves its two refusals by REBUILDING
       /src/economy into a temp directory with one line reverted and importing
       that copy — reverting either alone must still refuse, reverting both must
       re-arm 300,000 🔥. The shipped tree is never written to.

   ⚠ Every one of these must turn the gate RED. If you change these rounds, run
     all of them and check that they still do; an unset variable is the shipping
     path and does nothing. */
const SABOTAGE = process.env.ECON_TEST_SABOTAGE || '';
/* 🔴 AN UNRECOGNISED SWITCH ABORTS, AND THIS IS NOT PEDANTRY.
   A sabotage that no round reads is INERT: it prints "this run is DELIBERATELY
   injured and MUST fail" and then the gate goes green, which reads as "the
   defect is closed" when it means "nothing was injured". This file's own first
   rule is that a sabotage nobody has watched go red is a comment. Six switches
   were retired with the load-time Cinder clamp (see the catalogue above) and
   anyone re-running them from an old note would otherwise get a reassuring
   green. Add the name here in the same commit that adds the switch. */
const SABOTAGES = [
  'bogus-id', 'boot-open', 'boot-presweep', 'cancel-blind', 'cancel-sited', 'cap-typo',
  'charter-cap', 'dark-cards', 'defer-closed', 'defer-noSave', 'defer-nostamp', 'defer-open', 'demolish-blind',
  'defer-deadbtn', 'defer-park', 'defer-serverwrite', 'draw-compound', 'eco-erase', 'load-catch-open',
  'faucet-untallied', 'free-repair', 'halt-flat', 'imports-untallied', 'inflight-drop', 'lab-ungated',
  'loot-ledger', 'loot-promo', 'no-map', 'no-producer', 'nobridge-drop', 'ops-found-inline',
  'ops-found-unguarded', 'ops-grant-unknown', 'ops-swallow', 'ops-zombie', 'payout-drop',
  'payout-blind', 'pop-zero', 'price-drift', 'promo-drift', 'reap-burn', 'rearm-caller',
  'refund-blind', 'refund-raw', 'save-gone', 'seed-mint', 'sell-asym', 'sell-cap', 'sell-default', 'sell-promo',
  'sell-pump', 'settle-requested', 'stale-deliver', 'stale-refund', 'stale-workplaces',
  'twin-blind', 'venue-blind', 'warm-residue', 'withdraw', 'wx-twin-blind',
  // ── COVER2, the four fixes a revert could delete under a green gate ──
  'save-noborder', 'load-nolvl', 'gate-ungated', 'cap-race', 'place-nobld',
  'beat-dead', 'offline-nosweep', 'licence-paywalled',
];
const RETIRED_SABOTAGES = {
  rearm: 'retired: it flipped an argument this file passed itself — see round0s §3',
  'rearm-derive': 'retired with the two-valued flag it injured — the verdict is three-valued now; see round0s §3 defer-closed / defer-open',
  'save-mint': 'retired with the load-time Cinder clamp — see the catalogue above',
  'payout-save': 'retired with the load-time Cinder clamp — see the catalogue above',
  'faucet-rail': 'retired with the load-time Cinder clamp — see the catalogue above',
  'faucet-margin': 'retired with the load-time Cinder clamp — see the catalogue above',
  'owed-confiscate': 'retired with the load-time Cinder clamp — round0s §2a covers the honest half',
  'owed-ratchet': 'retired with the load-time Cinder clamp — see the catalogue above',
};
if (SABOTAGE) {
  if (RETIRED_SABOTAGES[SABOTAGE]) {
    console.error('🧨 ECON_TEST_SABOTAGE=' + SABOTAGE + ' is RETIRED — ' + RETIRED_SABOTAGES[SABOTAGE] +
                  '.\n   Refusing to run: a green gate under an inert switch reads as a closed defect.');
    process.exit(2);
  }
  if (!SABOTAGES.includes(SABOTAGE)) {
    console.error('🧨 ECON_TEST_SABOTAGE=' + SABOTAGE + ' is not a switch this file knows.' +
                  '\n   Refusing to run rather than reporting a green gate on an injury nobody applied.' +
                  '\n   Known: ' + SABOTAGES.join(', '));
    process.exit(2);
  }
  console.log('🧨 ECON_TEST_SABOTAGE=' + SABOTAGE + ' — this run is DELIBERATELY injured and MUST fail.');
}

/* Filled by round 0b, consumed by round 0c: the real ECO_BUILDING_MAP as read
   out of node-city/index.html. 0c reconciles against the SAME map the city
   does rather than against a hand-kept copy — gauntlet3.mjs keeps such a copy
   (its `MAP` literal) and it has already fallen 5 entries behind. */
let CITY_MAP = null;

/* Brace-match the `{…}` block that starts at `decl`, stepping over block
   comments, line comments and quoted strings — node-city is full of prose and
   OP_BP carries an escaped apostrophe ("the city\'s Health coverage"), both of
   which a naive scan would miscount. Returns the block TEXT, comments and all:
   `new Function` parses those natively, so nothing has to be stripped and no
   regex has to understand JavaScript. Returns null on an unbalanced scan —
   NEVER a guess, because a half-read block passes vacuously.
   Module scope because BOTH round0b (object literals) and round0d (the body of
   `function ecoHost()`) read the shipped file this way; the second copy was
   written and then deleted. */
/* `open` defaults to '{' — every pre-existing caller reads an object literal.
   round0p passes '[' to read index.html's `const RESOURCES = [ … ]`, which is
   the same scan with the other bracket pair; giving it a parameter beats a
   second copy of a scanner whose whole job is being fussy about strings and
   comments. */
const srcBlockAfter = (src, decl, open) => {
  if (!src) return null;
  open = open || '{';
  const close = open === '[' ? ']' : '}';
  const at = src.indexOf(decl);
  if (at < 0) return null;
  let i = src.indexOf(open, at + decl.length - 1);
  if (i < 0) return null;
  const start = i;
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return null; i = e + 1; continue; }
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i + 2); if (e < 0) return null; i = e; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      for (; i < src.length; i++) { if (src[i] === '\\') { i++; continue; } if (src[i] === q) break; }
      continue;
    }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;                       // unbalanced ⇒ nothing, never a guess
};

/* 🔴 COMMENTS OUT, AND THIS IS NOT TIDINESS — IT IS THE ROUNDS WORKING AT ALL.
   Any round that reasons about WHERE a call appears, or about WHICH functions a
   block calls, has to read code and not prose — and node-city is prose that
   NAMES its own call sites. round0r §1 learned this the hard way: boot()'s own
   comment says "this call sits ~118 lines above the `await offlineCatchUp()`
   below", a raw scan found that sentence first, put `catchAt` hundreds of
   characters too early, and the ordering assertion passed no matter what the
   code did. round0s §3e has the same exposure from the other direction — the
   erasure-guard header names `_saveWouldErase`, `saveNow()` and `saveSoon()` in
   running text, so an un-stripped scan of the save path would "find" every
   function it is trying to prove still exists.
   Strings are stepped over too, for the same reason srcBlockAfter does it.
   ⚠ MODULE SCOPE ON PURPOSE. It lived inside round0r's block until round0s §3e
     needed it; a second copy was written and then deleted, exactly as the
     srcBlockAfter header above describes. One fussy scanner, one place. */
const stripComments = (src) => {
  if (!src) return src;
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = (e < 0 ? src.length : e + 1); continue; }
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i + 2); i = (e < 0 ? src.length : e - 1); continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += c; i++;
      for (; i < src.length; i++) { out += src[i]; if (src[i] === '\\') { out += src[++i]; continue; } if (src[i] === q) break; }
      continue;
    }
    out += c;
  }
  return out;
};

/* ════════════════════════════════════════════════════════════════════════════
   ROUND 0 — 🏗 THE CONSTRUCTION DURATION CURVE
   ----------------------------------------------------------------------------
   Runs IN-PROCESS (no spawn): construction.js is a pure function over a plain
   profile object and imports nothing but tuning.js — no bridge, no window, no
   chain catalogue. That is the whole point of putting the curve in a module
   instead of in node-city/index.html, and this round is the payoff.

   🔴 WHY THIS ROUND EXISTS, AND WHY IT PINS EVERY VALUE TO THE SECOND.
   `municipal.maxSec` (2400) is the free Municipal Works ceiling and it ALONE
   decides whether a brand-new city can build itself. The whole starter shelf
   has to stay under it (sawmill 30m43, barracks 33m36 are the tight ones) and
   every Cinder earner has to stay above it (gasstation 1h53) — that split IS
   the design. Nothing about a `gamma` or a `costExp` tells you at a glance
   which side of 2400 a sawmill lands on, so a retune done by feel silently
   either bricks the bootstrap or hands the player free income buildings. The
   table below is the tripwire: change any number in ECON.construction and this
   round reprints the shelf and fails on the ones that moved.

   ⚠ THE SPEC'S §2.3 TABLE IS OFF BY UP TO 4 SECONDS AND THE FORMULA WINS.
     SPEC_CONSTRUCTION.md §2.1 (the formula) and §2.3 (the worked table) do not
     agree to the second. §2.3 is internally inconsistent — feeding its OWN
     printed `score` column back through its OWN printed formula gives arena
     12194, farm 565, housing 655, gasstation 6764, which matches neither its
     duration column nor each other. The deltas run in both directions
     (-1/+1/+4), which is the signature of hand-rounded intermediate arithmetic
     rather than a different formula; four candidate re-derivations were tried
     and the verbatim one fits best. So §2.1 is implemented VERBATIM and is
     normative, and this round asserts BOTH:
       • `exact`  — the integer the shipped formula actually returns, pinned to
                    the second, because that is what regresses.
       • `spec`   — the §2.3 figure, within SPEC_TOL seconds, so the worked
                    examples stay reconciled and a real drift away from the
                    design intent still fails.
     If a future retune is meant to MOVE the shelf, update both columns
     together and say so in the commit. Do not widen SPEC_TOL to make a red
     round green — 4 seconds is rounding, 40 is a design change. */

/* ════════════════════════════════════════════════════════════════════════════
   ROUND 0m — 🎲 THE HARNESS ITSELF MUST BE DETERMINISTIC
   ----------------------------------------------------------------------------
   THIS ROUND RUNS FIRST BECAUSE EVERY OTHER ROUND'S NUMBERS DEPEND ON IT.

   THE DEFECT IT EXISTS FOR, and it silently invalidated measurement across the
   whole gate for as long as it was there:
   `Logistics.reset()` cleared five fields and left a sixth. `S.congestionMul` is
   WRITTEN by `resolve()` at the end of an economic day and READ by
   `costPerUnit()` from the first freight quote of a day — including day 0, which
   happens before any `resolve()` has ever run. It was not declared on the state
   object and not cleared by `reset()`, so `S.congestionMul || 1` read 1 in a cold
   process and THE PREVIOUS CITY'S FINAL CONGESTION in a warm one. A brand-new
   city with nothing booked was quoted freight at up to `maxCongestionMul`,
   entirely according to what the test process happened to have simulated before.

   MEASURED ON THE BROKEN TREE, all calm, same configuration, same process:
     rho-6 / pop45 / warehouse-0 / 600d → 3,102 🔥 cold
                                        → 3,162 🔥 called again (+1.9%)
                                        → 3,102 🔥 after an intervening city
   and neutralising THAT ONE FIELD and nothing else restored 3,102 exactly.
   (The critic's stated hypothesis — `setNode()` early-returning without calling
   `Endow.invalidate()` — was checked first and is WRONG twice over: `reset()`
   calls `Endow.invalidate()` unconditionally, and the endowment is a pure
   function of the node id, so its cache cannot carry a value that differs.
   Prices, households, trade, bank and the firm registry were all cleared by hand
   and none of them restored the cold value either. Do not re-derive those.)

   WHY THAT MATTERED SO MUCH: the round this defect was found under (0i, the
   disaster-economics sweep, since deleted with the feature it guarded) measured
   a `calm` baseline FIRST and its shocked comparisons after, so the baseline and
   every number compared against it sat at DIFFERENT points in the residue
   history by construction. Its headline worst cell was −0.18% against order
   noise of 1.9% — a tenth of the noise. Every assertion in this gate that
   compares a before against an after was resting on run.mjs's own claim that
   "Nothing here is random", and that claim was false. THAT IS NOT A HISTORICAL
   NOTE: any future round that compares two runs inherits the same exposure, and
   this round is what makes the comparison mean something.

   WHAT IS ASSERTED HERE, and §1 is the important one:
     1. STRUCTURAL. After `Sim.reset()` the economy modules hold ONE state, no
        matter what was simulated before. This is the guarantee you can check by
        READING reset(), and it catches the whole class — every future field that
        someone forgets to clear — rather than the cells this round samples.
     2. BEHAVIOURAL. The same configuration run in five different call orders
        gives bit-identical results, compared on the full serialised city and not
        merely on the headline number.
     3. A host that varies a field the model no longer reads changes NOTHING.
        `host.shock` is that field: the disaster→prices term was removed and
        sim.js `shockOf()` now answers 1 to every input, so a pulsed signal and a
        calm one must produce bit-identical cities. Asserted rather than assumed,
        because "the field is inert" is precisely the kind of claim that rots.

   Prove this round can fail: ECON_TEST_SABOTAGE=warm-residue, which re-commits
   the defect exactly — it carries `congestionMul` across the reset by hand.
   ════════════════════════════════════════════════════════════════════════════ */
{
  console.log('\n########## round0m-harness-determinism ##########');
  let fails = 0;
  const chk = (name, cond, extra) => {
    if (cond) { console.log('✅ ' + name); return true; }
    fails++; console.log('❌ ' + name + (extra ? ' :: ' + extra : '')); return false;
  };

  if (!global.window) {
    global.window = { MythicCityBridge: { addCinders: async () => {} }, MythicResourceChain: null };
    const chain = await import('../../public/src/resources/chain.js');
    global.window.MythicResourceChain = { ALL: chain.RESOURCE_CHAIN };
  }
  const P = '../../public/src/economy/';
  const Sim = await import(P + 'sim.js');
  const HH = await import(P + 'households.js');
  const Prices = await import(P + 'prices.js');
  const Firms = await import(P + 'firms.js');
  const Trade = await import(P + 'trade.js');
  const Logis = await import(P + 'logistics.js');
  const Bank = await import(P + 'bank.js');
  const { ECON } = await import(P + 'tuning.js');
  const DAY = ECON.clock.dayMin;

  /* 🧨 THE INJURY: `reset()` fails to clear one field of one module. Written as
     "carry the value across the reset" rather than by editing logistics.js,
     because that is precisely what the shipped bug DID — the field survived the
     reset — and a sabotage that reproduces the mechanism is worth more than one
     that reproduces the symptom. */
  const RESIDUE = SABOTAGE === 'warm-residue';

  const resetCity = (node) => {
    const carried = Logis.state().congestionMul;
    Sim.reset(node);
    if (RESIDUE) Logis.state().congestionMul = carried;
  };

  /* THE FINGERPRINT. Deliberately WIDER than Sim.serialize(): the carrier this
     round exists for lives in logistics.js, which does not ride the save at all,
     so a fingerprint taken from the save file could never have seen it. Anything
     a tick can READ has to be in here. */
  const fingerprint = () => JSON.stringify({
    sim: Sim.state(), hh: HH.state(), trade: Trade.state(), logistics: Logis.state(),
    bank: Bank.serialize(), prices: Prices.movers(999), firms: Firms.all(),
  });

  const drive = (sig, pop, node, wh, days) => {
    resetCity(node); HH.setPopulation(pop); Sim.bootstrap();
    let claimed = 0;
    for (let d = 0; d < days; d++) {
      Sim.advance(DAY, { powerFactor: 1, waterFactor: 1, hasBank: true, infrastructure: 0.7,
                         logisticsCounts: { warehouse: wh }, shock: sig(d) });
      claimed += Sim.claimPayout();
    }
    return { claimed, print: fingerprint() };
  };
  const calm = () => 1;
  const pulse = (mag, cad) => d => (d % cad === cad - 1 ? mag : 1);

  // ── 1. RESET IS A TRUE RESET ────────────────────────────────────────────
  /* Take the state fingerprint immediately after reset(), cold, then again after
     three deliberately dissimilar cities have been simulated. Any field the
     reset forgets shows up here as a diff, named, whether or not it happens to
     change a headline number today. */
  resetCity('det-a');
  const coldReset = fingerprint();
  const churn = [['det-b', 200, 3, 90], ['rho-6', 45, 0, 120], ['mu-12', 330, 1, 60]];
  const resetDiffs = [];
  for (const [node, pop, wh, days] of churn) {
    drive(calm, pop, node, wh, days);
    resetCity('det-a');
    const after = fingerprint();
    if (after !== coldReset) {
      /* Name the offending field rather than printing two 60 KB blobs. */
      const a = JSON.parse(coldReset), b = JSON.parse(after);
      const walk = (x, y, path) => {
        if (JSON.stringify(x) === JSON.stringify(y)) return;
        if (x && y && typeof x === 'object' && typeof y === 'object') {
          for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], path + '.' + k);
          return;
        }
        resetDiffs.push('after ' + node + '/pop' + pop + ':' + path +
                        ' cold=' + JSON.stringify(x) + ' warm=' + JSON.stringify(y));
      };
      walk(a, b, '');
    }
  }
  chk('reset() leaves ONE state, whatever was simulated before (' +
      churn.length + ' dissimilar cities churned through first)',
      resetDiffs.length === 0, resetDiffs.slice(0, 6).join(' | '));

  // ── 2. THE SAME CONFIGURATION, IN FIVE DIFFERENT CALL ORDERS ────────────
  /* The orders are chosen to be the ones a round actually produces: cold, an
     immediate repeat, after an unrelated city, after a DIFFERENT node (which is
     the axis the critic's hypothesis blamed), and after a save/load cycle. */
  const CELLS = [
    { name: 'rho-6/pop45/wh0/600d calm', sig: calm, pop: 45, node: 'rho-6', wh: 0, days: 600 },
    { name: 'rho-6/pop45/wh1/240d calm', sig: calm, pop: 45, node: 'rho-6', wh: 1, days: 240 },
    { name: 'mu-12/pop200/wh3/240d calm', sig: calm, pop: 200, node: 'mu-12', wh: 3, days: 240 },
    /* A host that PULSES `host.shock`. It kept a residue that only bit the
       shocked leg from hiding when the disaster term existed; it is kept now
       because §3 below compares it against the calm run of the same cell. */
    { name: 'rho-6/pop120/wh1/240d ×1.30/cad6', sig: pulse(1.30, 6), pop: 120, node: 'rho-6', wh: 1, days: 240 },
  ];
  const ORDERS = [
    ['cold', () => {}],
    ['immediate repeat', function (c) { drive(c.sig, c.pop, c.node, c.wh, c.days); }],
    ['after an unrelated city', () => { drive(calm, 260, 'det-b', 2, 120); }],
    ['after a different node', () => { drive(calm, 45, 'det-c', 0, 120); }],
    /* A reload is a real host event and it goes through a different door into the
       same state: load() calls reset() itself. If load left anything behind, a
       measurement taken after the player reloaded would not match one taken
       before, and no round in this gate would have noticed. */
    ['after a save/load', () => { const s = drive(calm, 160, 'det-d', 1, 90); void s; Sim.load(Sim.serialize()); }],
  ];
  let orderBad = [], cellRows = [];
  for (const c of CELLS) {
    let ref = null, row = [];
    for (const [label, prep] of ORDERS) {
      prep(c);
      const got = drive(c.sig, c.pop, c.node, c.wh, c.days);
      row.push(Math.round(got.claimed));
      if (ref === null) ref = got;
      else if (got.print !== ref.print || got.claimed !== ref.claimed) {
        orderBad.push(c.name + ' [' + label + '] ' + Math.round(got.claimed) +
                      ' 🔥 against cold ' + Math.round(ref.claimed) + ' 🔥' +
                      (got.claimed === ref.claimed ? ' (claim equal, CITY differs)' : ''));
      }
    }
    cellRows.push('    ' + c.name.padEnd(32) + row.map(v => String(v).padStart(8)).join(''));
  }
  console.log('\n  🎲 SAME CONFIGURATION, ' + ORDERS.length + ' CALL ORDERS — claimed 🔥\n');
  console.log('    cell                              ' +
              ORDERS.map(o => o[0].slice(0, 7).padStart(8)).join(''));
  console.log('    ' + '-'.repeat(32 + ORDERS.length * 8));
  for (const r of cellRows) console.log(r);
  console.log('');
  chk('every configuration is bit-identical across all ' + ORDERS.length +
      ' call orders (' + CELLS.length + ' cells, compared on the whole city and not just the claim)',
      orderBad.length === 0, orderBad.slice(0, 4).join(' | '));

  // ── 3. `host.shock` IS INERT ────────────────────────────────────────────
  /* The disaster→prices feature was removed and sim.js `shockOf()` now answers
     exactly 1 to every input, so a host that reports a violent, varying shock
     must produce a city IDENTICAL to one that reports none at all. Compared on
     the whole fingerprint, not the claim: a term that moved prices but happened
     to leave the payout alone would pass a claim-only check.
     ⚠ THIS IS A SAMPLE AND IT IS LABELLED AS ONE. The real guarantee is
       structural and is checked by READING `shockOf()`, whose every branch
       returns the literal 1. This cell exists so that re-wiring the field
       without re-reading that function turns the gate red. */
  const SHOCK_CELL = { pop: 120, node: 'shock-inert', wh: 1, days: 240 };
  const inertCalm = drive(calm, SHOCK_CELL.pop, SHOCK_CELL.node, SHOCK_CELL.wh, SHOCK_CELL.days);
  const inertPulse = drive(pulse(1.30, 6), SHOCK_CELL.pop, SHOCK_CELL.node, SHOCK_CELL.wh, SHOCK_CELL.days);
  /* A signal at the far end of what the guard's old band could express, held on
     EVERY day rather than pulsed — the shape that used to be the worst cell. */
  const inertHeld = drive(() => 1.60, SHOCK_CELL.pop, SHOCK_CELL.node, SHOCK_CELL.wh, SHOCK_CELL.days);
  /* And hostile values, which is the other half of what the guard is for: these
     crashed the tick outright before it existed. */
  const HOSTILE = ['abc', {}, NaN, Infinity, -5, true, [], 1e308, null, undefined];
  let hostileBad = '';
  for (const v of HOSTILE) {
    let got = null;
    try { got = drive(() => v, SHOCK_CELL.pop, SHOCK_CELL.node, SHOCK_CELL.wh, 60); }
    catch (e) { hostileBad = JSON.stringify(String(v)) + ' THREW: ' + e.message; break; }
    const ref = drive(calm, SHOCK_CELL.pop, SHOCK_CELL.node, SHOCK_CELL.wh, 60);
    if (got.print !== ref.print) { hostileBad = JSON.stringify(String(v)) + ' moved the city'; break; }
  }
  chk('a pulsed shock signal leaves the city bit-identical to a calm one (' +
      Math.round(inertCalm.claimed) + ' 🔥 both)',
      inertPulse.print === inertCalm.print && inertPulse.claimed === inertCalm.claimed,
      Math.round(inertPulse.claimed) + ' 🔥 against calm ' + Math.round(inertCalm.claimed) + ' 🔥');
  chk('a shock held at 1.60 on EVERY day is inert too',
      inertHeld.print === inertCalm.print && inertHeld.claimed === inertCalm.claimed,
      Math.round(inertHeld.claimed) + ' 🔥 against calm ' + Math.round(inertCalm.claimed) + ' 🔥');
  chk('every hostile host.shock value (' + HOSTILE.length +
      ') neither throws nor moves the city', hostileBad === '', hostileBad);

  if (fails) { bad++; console.log('\n=== ROUND 0m: ' + fails + ' FAILED ==='); }
  else console.log('\n=== ROUND 0m: ALL PASS ===');
}

{
  const P = '../../public/src/economy/';
  const { seconds } = await import(P + 'construction.js');
  const { ECON } = await import(P + 'tuning.js');
  const C = ECON.construction;
  const SPEC_TOL = 5;                     // seconds; see the note above

  let fails = 0;
  const chk = (name, cond, extra) => {
    if (cond) { console.log('✅ ' + name); return; }
    fails++; console.log('❌ ' + name + (extra ? ' :: ' + extra : ''));
  };
  const hms = s => [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
    .map((n, i) => i ? String(n).padStart(2, '0') : String(n)).join(':');

  /* The profiles are the spec's, and they are what node-city's bldProfile()
     will hand over: RAW def.cost/def.tierCost flattened at costResWeight=2 —
     ⚠ never costOf(), which returns tierCost unscaled and would build a
     Stadium faster than a starter Farm. cinderPerHr is genOf()*60. */
  const SHELF = [
    // name             profile                                    exact  spec§2.3
    ['farm',            { cost: 22, res: 90 },                       565,  566],
    ['housing',         { cost: 58 },                                655,  654],
    ['gasstation',      { cost: 62, cinderPerHr: 0.25 },            6765, 6765],
    ['arena',           { cost: 280, cinderPerHr: 0.20, svc: 0.8 }, 12196, 12192],
    ['indexfund',       { cost: 4166 },                            53869, 53868],
    ['holdco',          { cost: 13736 },                           86400, 86400],
    ['op_construction', { fixedSec: C.opSec },                       900,  900],
  ];

  console.log('\n########## round0-construction ##########');
  console.log('\n  🏗 DURATION CURVE — ECON.construction, formulaV ' + C.formulaV +
              '  (municipal ceiling ' + C.municipal.maxSec + 's = ' + hms(C.municipal.maxSec) + ')\n');
  console.log('    building          duration        exact    spec§2.3   Δ   free crew?');
  console.log('    ' + '-'.repeat(68));
  const got = {};
  for (const [name, p, exact, spec] of SHELF) {
    const v = seconds(p);
    got[name] = v;
    const free = (p.fixedSec ? true : v <= C.municipal.maxSec) ? 'yes' : 'NEEDS CO.';
    console.log('    ' + name.padEnd(17) + hms(v).padStart(9) + '  ' +
                String(v).padStart(9) + String(spec).padStart(11) +
                String(v - spec).padStart(5) + '   ' + free);
  }
  console.log('');
  for (const [name, p, exact, spec] of SHELF) {
    chk('duration ' + name + ' === ' + exact + 's', got[name] === exact, 'got ' + got[name]);
    chk('  …within ' + SPEC_TOL + 's of spec §2.3 (' + spec + ')',
        Math.abs(got[name] - spec) <= SPEC_TOL, 'got ' + got[name] + ', spec ' + spec);
  }

  /* (a) THE TOP OF THE CURVE MUST SEPARATE, NOT SATURATE. This is why full.cost
     is 1200 and not a value that pins everything expensive at the ceiling: if
     an Index Fund and a Holding Company both clamp to 24h, the cap stops being
     a cap and becomes the entire late game. holdco clamps (score >= 1);
     indexfund must not. */
  chk('indexfund < holdco — the top separates rather than saturating',
      got.indexfund < got.holdco, got.indexfund + ' vs ' + got.holdco);
  chk('holdco is the clamp (score clamps to 1 ⇒ exactly maxSec)',
      got.holdco === C.maxSec, String(got.holdco));

  /* (b) MONOTONICITY. A building that costs more, earns more and produces more
     can never take LESS time to build. Nothing in the curve enforces this
     structurally — it is a property of the weights all being positive and the
     clamp being applied to the SUM — so a retune that made any weight negative,
     or that clamped per channel, would break it silently and hand the player a
     "upgrade the profile to build it faster" exploit. */
  const AXES = { cost: [0, 22, 58, 280, 1200, 4166, 13736],
                 cinderPerHr: [0, 0.05, 0.2, 0.3, 1],
                 res: [0, 90, 700, 1400, 5000] };
  const grid = [];
  for (const cost of AXES.cost) for (const cinderPerHr of AXES.cinderPerHr) for (const res of AXES.res)
    grid.push({ cost, cinderPerHr, res });
  let monoBad = null;
  for (const a of grid) {
    if (monoBad) break;
    for (const b of grid) {
      if (!(a.cost <= b.cost && a.cinderPerHr <= b.cinderPerHr && a.res <= b.res)) continue;
      if (seconds(a) > seconds(b)) { monoBad = JSON.stringify(a) + ' → ' + seconds(a) + ' > ' +
                                                JSON.stringify(b) + ' → ' + seconds(b); break; }
    }
  }
  chk('monotonic over ' + grid.length + ' profiles (' + (grid.length * grid.length) +
      ' ordered pairs): bigger is never faster', !monoBad, monoBad);

  /* (c) THE 24-HOUR CEILING IS ABSOLUTE, ON EVERY PATH. The upgrade multiplier
     (0.75 × 1.6^(lvl-1)) is applied AFTER the base duration and reaches ~4.9×
     at level 5, so the cap has to be the LAST operation or a level-5 upgrade of
     an expensive building runs for five days. Hostile profiles go through the
     same gate: the feature was asked for a 24h ceiling and there is no input
     that buys more. */
  let capBad = null, floorBad = null;
  const HOSTILE = [{}, { cost: NaN }, { cost: Infinity }, { cost: -5 }, { cost: '13736' },
                   { cost: 1e300, res: 1e300, cinderPerHr: 1e300, svc: 1e300 },
                   { fixedSec: 1e12 }, { fixedSec: 1 }, { cost: 13736, speedMul: 0 },
                   { cost: 13736, speedMul: -4 }, { cost: 13736, speedMul: NaN }];
  for (const p of grid.concat(HOSTILE)) {
    for (const kind of [0, 1]) for (const lvl of [1, 2, 3, 4, 5]) {
      const v = seconds(Object.assign({}, p, { kind, lvl }));
      if (!(v <= C.maxSec)) capBad = JSON.stringify(p) + ' k' + kind + ' l' + lvl + ' → ' + v;
      if (!(v >= C.minSec)) floorBad = JSON.stringify(p) + ' k' + kind + ' l' + lvl + ' → ' + v;
    }
  }
  chk('nothing ever exceeds maxSec (' + C.maxSec + 's = 24h), incl. L5 upgrades + hostile input',
      !capBad, capBad);
  chk('nothing ever falls below minSec (' + C.minSec + 's)', !floorBad, floorBad);

  /* ⚠ speedMul DIVIDES, so it is the one input that could produce Infinity. It
     is floored at 1: a 0, a negative or a NaN can only ever fail toward the
     slower, honest duration — never toward an instant build. */
  const noCrew = seconds({ cost: 280 });
  chk('speedMul is floored at 1 — 0/negative/NaN cannot shorten a job',
      seconds({ cost: 280, speedMul: 0 })   === noCrew &&
      seconds({ cost: 280, speedMul: -4 })  === noCrew &&
      seconds({ cost: 280, speedMul: NaN }) === noCrew &&
      seconds({ cost: 280, speedMul: 0.1 }) === noCrew,
      'baseline ' + noCrew + ', speedMul0 ' + seconds({ cost: 280, speedMul: 0 }) +
      ', speedMul0.1 ' + seconds({ cost: 280, speedMul: 0.1 }));
  chk('speedMul 2.0 halves a mid-shelf job',
      Math.abs(seconds({ cost: 62, cinderPerHr: 0.25, speedMul: C.speed.maxMul }) -
               got.gasstation / C.speed.maxMul) <= 1,
      String(seconds({ cost: 62, cinderPerHr: 0.25, speedMul: C.speed.maxMul })));

  /* The upgrade branch, read off ECON rather than off a literal, so this still
     pins the shape if upgrade.base/mulPerLevel are retuned. */
  const u1 = seconds({ cost: 22, res: 90, kind: 1, lvl: 1 });
  const u2 = seconds({ cost: 22, res: 90, kind: 1, lvl: 2 });
  chk('upgrade L1 = base × upgrade.base (' + C.upgrade.base + ')',
      Math.abs(u1 / got.farm - C.upgrade.base) < 0.01, u1 + '/' + got.farm);
  chk('each upgrade level × upgrade.mulPerLevel (' + C.upgrade.mulPerLevel + ')',
      Math.abs(u2 / u1 - C.upgrade.mulPerLevel) < 0.01, u2 + '/' + u1);

  /* (d) ⚡ 'power' MUST BE SKIPPED. gen.power 6.0 falling through to
     defaultTier 1 (×4) yields vRes 1440 against full.resource 1400 — the single
     largest resource channel in the game, from a quantity that is NEVER banked
     (index.html:2211) — which makes the mandatory Power Station a 5h52 build,
     above the free-crew ceiling, in a city that cannot function without it. */
  chk("resSkip contains 'power' (never banked — index.html:2211)",
      Array.isArray(C.resSkip) && C.resSkip.indexOf('power') >= 0, JSON.stringify(C.resSkip));
  chk("resSkip contains 'cinder' (counted by the cinderPerHr channel, not twice)",
      C.resSkip.indexOf('cinder') >= 0, JSON.stringify(C.resSkip));

  /* The feature's own off switch. ECON.construction.on = 0 turns every timer
     off without touching a line of index.html (a 0 duration is the host's
     "place instantly" path), which is the rollback plan. */
  const savedOn = C.on; C.on = 0;
  chk('on:0 returns 0 — the whole feature switches off from ECON alone',
      seconds({ cost: 13736 }) === 0 && seconds({ fixedSec: 900 }) === 0);
  C.on = savedOn;

  if (fails) { bad++; console.log('\n=== ROUND 0: ' + fails + ' FAILED ==='); }
  else console.log('\n=== ROUND 0: ALL PASS ===');
}

/* ════════════════════════════════════════════════════════════════════════════
   ROUND 0b — 🏭 EVERY BUILDING IN THE MAP IS A BUSINESS THAT CAN EXIST
   ----------------------------------------------------------------------------
   🔴 THE FAILURE THIS DEFENDS AGAINST IS COMPLETELY SILENT.
   `syncBuildings` (public/src/economy/index.js:153) does this:

       if (!Recipes.producible(b.out)) continue;

   — no warn, no throw, no event. A typo in ECO_BUILDING_MAP, or an id that
   exists only in /src/resources/chain.js and has no recipe or deposit behind
   it, therefore yields a tile that looks PERFECTLY wired in the table, founds
   no firm, employs nobody, and does it forever with a green console. The same
   goes for an `ind` that is not in INDUSTRIES: firms.js falls back to
   `distributor` and the building quietly becomes a haulier.

   The city has 47 entries across two literals and no human is going to re-check
   them. So the gate does.

   ── HOW IT READS THE MAP, AND WHAT HAPPENS WHEN THAT BREAKS ────────────────
   ECO_BUILDING_MAP lives inside a 25,000-line HTML file, inside one enormous
   IIFE. There is no import to be had: this round scans the text of
   public/node-city/index.html for three named object literals, brace-matching
   past comments and strings, and evaluates each as a plain literal. That is
   legitimate because the literals contain nothing but strings and arrays of
   strings — the ops rows are attached to the map by a LOOP (index.html, the
   `for (const t of OPS_TYPES)` registration block) and this round re-runs that
   join itself from OP_ECO_MAP + OPS_PREFIX.

   🔴 A TEXT SCRAPE THAT MATCHES NOTHING PASSES VACUOUSLY, and that is a worse
      state than having no test — the comment in index.html would still claim
      this round guards the map. So the read is NOT allowed to come back empty:
      a missing file, a renamed declaration, a moved brace or a partial match
      all fail HARD below, on the extraction itself, before a single id is
      checked. Prove it with ECON_TEST_SABOTAGE=no-map. The sentinel keys are
      the guard against a match that terminated early and grabbed half a map.
   ════════════════════════════════════════════════════════════════════════════ */
{
  console.log('\n########## round0b-building-map ##########');
  let fails = 0;
  const chk = (name, cond, extra) => {
    if (cond) { console.log('✅ ' + name); return true; }
    fails++; console.log('❌ ' + name + (extra ? ' :: ' + extra : '')); return false;
  };

  const HTML_PATH = SABOTAGE === 'no-map'
    ? join(here, '../../public/node-city/THIS-FILE-DOES-NOT-EXIST.html')
    : join(here, '../../public/node-city/index.html');

  let HTML = null;
  try { HTML = readFileSync(HTML_PATH, 'utf8'); } catch (e) { HTML = null; }
  chk('read node-city/index.html (' + HTML_PATH.replace(/\\/g, '/').split('/').slice(-2).join('/') + ')',
      !!HTML && HTML.length > 100000, HTML ? HTML.length + ' bytes' : 'UNREADABLE — the map cannot be checked at all');

  /* The brace-matching scanner lives at module scope (`srcBlockAfter`) because
     round0d reads `function ecoHost()` out of the same file the same way. */
  const literalObj = (decl) => {
    const txt = srcBlockAfter(HTML, decl);
    if (!txt) return null;
    try { return (new Function('return (' + txt + ');'))(); } catch (e) { return null; }
  };
  const size = o => (o && typeof o === 'object') ? Object.keys(o).length : -1;

  const STATIC = literalObj('const ECO_BUILDING_MAP = {');
  const OPMAP  = literalObj('const OP_ECO_MAP = {');
  const OPBP   = literalObj('const OP_BP = {');
  const prefixM = HTML ? /const\s+OPS_PREFIX\s*=\s*'([^']*)'/.exec(HTML) : null;
  const PREFIX = prefixM ? prefixM[1] : null;

  const gotAll =
    chk('extracted ECO_BUILDING_MAP', size(STATIC) > 0, 'got ' + size(STATIC) + ' keys') &
    chk('extracted OP_ECO_MAP',       size(OPMAP)  > 0, 'got ' + size(OPMAP)  + ' keys') &
    chk('extracted OP_BP',            size(OPBP)   > 0, 'got ' + size(OPBP)   + ' keys') &
    chk('extracted OPS_PREFIX',       !!PREFIX,         String(PREFIX));

  if (!gotAll) {
    /* Stop here rather than "pass" 0 ids. This is the vacuous-tripwire guard
       the header talks about, and it is the whole reason this round may not
       simply `continue` past a bad read. */
    console.log('\n🔴 THE MAP COULD NOT BE READ — nothing below was checked.');
    console.log('   If a declaration was renamed or moved, fix the three `literalObj` markers');
    console.log('   in this round. Do NOT delete the round: the comment in node-city/index.html');
    console.log('   promises that this check exists.');
    bad++; console.log('\n=== ROUND 0b: ' + fails + ' FAILED ===');
  } else {
    /* Sentinels: a brace scan that terminated early still returns SOME keys.
       One key from the top of each literal, one from the bottom, and one from
       the block a previous package added — a partial match cannot hold all of
       them. */
    chk('ECO_BUILDING_MAP is whole (first/last/mid sentinels present)',
        ['farm', 'shop', 'warehouse', 'resthouse', 'housing'].every(k => STATIC[k]),
        'missing ' + ['farm', 'shop', 'warehouse', 'resthouse', 'housing'].filter(k => !STATIC[k]).join(','));
    chk('OP_ECO_MAP is whole (first/last/mid sentinels present)',
        ['mining', 'smuggling', 'construction', 'warehouse'].every(k => OPMAP[k]),
        'missing ' + ['mining', 'smuggling', 'construction', 'warehouse'].filter(k => !OPMAP[k]).join(','));

    // ── the ops join, performed exactly as the registration loop performs it ──
    const MAP = { ...STATIC };
    for (const t of Object.keys(OPMAP)) MAP[PREFIX + t] = OPMAP[t];
    CITY_MAP = MAP;

    if (SABOTAGE === 'bogus-id') {
      MAP.op_saboteur = { out: ['unobtainium'], ind: 'notAnIndustry' };
      console.log('   🧨 injected op_saboteur → out unobtainium / ind notAnIndustry');
    }

    /* Every operation must be accounted for: it has a business, or it is the
       one row that was argued out. A silent omission is the same class of bug
       as a silent unproducible id — the operation simply never employs anyone
       and nothing says so. */
    const noEco = Object.keys(OPBP).filter(t => !OPMAP[t]);
    chk('exactly one operation has no business, and it is `bank` (index.html:17101)',
        noEco.length === 1 && noEco[0] === 'bank', 'without a business: [' + noEco.join(', ') + ']');
    chk('op_bank is NOT in the map', !MAP[PREFIX + 'bank'], JSON.stringify(MAP[PREFIX + 'bank']));
    chk('every OP_ECO_MAP key names a real OP_BP blueprint',
        Object.keys(OPMAP).every(t => OPBP[t]),
        'unknown: ' + Object.keys(OPMAP).filter(t => !OPBP[t]).join(','));
    chk('all ' + (Object.keys(OPBP).length - 1) + ' non-bank operations are wired',
        Object.keys(OPMAP).length === Object.keys(OPBP).length - 1,
        Object.keys(OPMAP).length + ' of ' + (Object.keys(OPBP).length - 1));

    /* A floor, not an equality: adding a building must not require editing this
       file, but a scrape that suddenly returns a handful of entries must. The
       shipped figure is printed on every run so a real drop is visible. */
    const FLOOR = 40;
    chk('map has at least ' + FLOOR + ' entries (shipped: ' + Object.keys(MAP).length + ')',
        Object.keys(MAP).length >= FLOOR, String(Object.keys(MAP).length));

    // ── THE ACTUAL TRIPWIRE ────────────────────────────────────────────────
    global.window = { MythicCityBridge: { addCinders: async () => {} }, MythicResourceChain: null };
    const chain = await import('../../public/src/resources/chain.js');
    global.window.MythicResourceChain = { ALL: chain.RESOURCE_CHAIN };
    const R = await import('../../public/src/economy/recipes.js');

    const badOut = [], badInd = [];
    for (const k of Object.keys(MAP)) {
      const m = MAP[k];
      if (!m || !Array.isArray(m.out) || !m.out.length) { badOut.push(k + ' → no `out` list'); continue; }
      for (const o of m.out) if (!R.producible(o)) badOut.push(k + ' → ' + o);
      if (!R.INDUSTRIES[m.ind]) badInd.push(k + ' → ind ' + m.ind);
    }
    console.log('\n  checked ' + Object.keys(MAP).length + ' buildings, ' +
                Object.keys(MAP).reduce((n, k) => n + ((MAP[k].out || []).length), 0) + ' output ids, ' +
                new Set(Object.keys(MAP).map(k => MAP[k].ind)).size + ' industries\n');
    chk('every `out` id satisfies Recipes.producible() — else syncBuildings drops it SILENTLY',
        badOut.length === 0, badOut.join(' | '));
    chk('every `ind` exists in INDUSTRIES — else the firm silently becomes a distributor',
        badInd.length === 0, badInd.join(' | '));

    if (fails) { bad++; console.log('\n=== ROUND 0b: ' + fails + ' FAILED ==='); }
    else console.log('\n=== ROUND 0b: ALL PASS ===');
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   ROUND 0j — 🃏 PRODUCIBLE IS NOT THE SAME THING AS PRODUCIBLE-HERE
   ----------------------------------------------------------------------------
   🔴 WHAT ROUND 0b CANNOT SEE, AND WHY THAT MATTERED FOR A WHOLE ROUND.
   0b asks `Recipes.producible(id)` of every output in ECO_BUILDING_MAP. That
   predicate answers ONE question — "does this id have a recipe, a deposit or a
   byproduct entry" — and `boosterPacks`, `printedCards`, `cardStock` and
   `holographicFoil` all answered YES from the day they were written. 0b was
   green. The card economy still produced NOTHING, in every city, forever.

   The reason is a level up from the predicate:

     · a recipe only runs if a FIRM makes each of its inputs
     · a firm only exists where a BUILDING maps to that id (ECO_BUILDING_MAP)
     · firms.js `produce()` takes the MINIMUM over the inputs (:363) —
       "a line runs at the rate of its slowest input"

   so ONE input with no building behind it darkens every step above it, in
   perfect silence, with a healthy-looking firm reporting a bottleneck nobody
   reads. `boosterPacks` needed `printedCards`; nothing made `printedCards`;
   the Card Shop was structurally incapable of printing a single pack and
   `cardOutput()` — the Foundation Reserve's feed — returned
   {units:{}, totalUnits:0} for every player, forever.

   THIS ROUND ASKS THE HARDER QUESTION: walk each mapped output back down its
   PRIMARY leg and check the walk terminates in the ground. Roots are deposits
   (a tile digs them, or trade imports them — trade.js sells partner endowment
   STRENGTHS, which are deposits) and ids some other row of the map makes.
   Byproducts are NOT roots: nothing in sim.js ever adds one to inventory.

   ⚠ THE CARD LINE IS ASSERTED; THE REST IS REPORTED. Plenty of the map is
     still dark for the same structural reason (the city has no chemical tier,
     no refinery and no semiconductor fab), and turning that into a red today
     would be a test nobody could make pass. The dark list is PRINTED on every
     run so the number is visible and can be driven down deliberately, and the
     Ouroboros ids — the ones a package was written to fix — are a hard fail.

   Prove this round can fail: ECON_TEST_SABOTAGE=dark-cards, which puts
   `holographicFoil` back into the `boosterPacks` recipe. That is not an
   arbitrary poke: it is the SHIPPED recipe, and by the min rule above that one
   0.02 coefficient is the whole difference between a card economy and a dead
   one.
   ════════════════════════════════════════════════════════════════════════════ */
{
  console.log('\n########## round0j-chain-reachability ##########');
  let fails = 0;
  const chk = (name, cond, extra) => {
    if (cond) { console.log('✅ ' + name); return true; }
    fails++; console.log('❌ ' + name + (extra ? ' :: ' + extra : '')); return false;
  };

  if (!CITY_MAP) {
    /* Same vacuous-tripwire guard round 0c uses: with no map there is nothing
       to walk, and "0 unreachable ids" would be a green that means nothing. */
    console.log('🔴 round0b could not read ECO_BUILDING_MAP — this round has nothing to walk.');
    bad++; console.log('\n=== ROUND 0j: 1 FAILED ===');
  } else {
    const R = await import('../../public/src/economy/recipes.js');
    if (SABOTAGE === 'dark-cards') {
      R.RECIPES.boosterPacks.in.holographicFoil = 0.02;
      console.log('   🧨 restored `holographicFoil: 0.02` to the boosterPacks recipe (the shipped version)');
    }

    /* Every id ANY tile in the city can found a firm for. A deposit in this set
       still has to be in the ground on a given node — pickAvailable decides
       that per city — so this walk is about STRUCTURE, not about one node. */
    const MAKEABLE = new Set();
    for (const k of Object.keys(CITY_MAP)) for (const o of (CITY_MAP[k].out || [])) MAKEABLE.add(o);

    const memo = new Map();
    function reach(id, stack) {
      if (R.isDeposit(id)) return true;             // the ground, or an import
      if (R.isByproduct(id)) return false;          // nothing ever banks these
      if (memo.has(id)) return memo.get(id);
      if (stack.has(id)) return false;              // a cycle is not a root
      if (!MAKEABLE.has(id)) { memo.set(id, false); return false; }
      stack.add(id);
      const leg = R.legsOf(id)[0] || { in: {} };
      let ok = true;
      for (const inp in (leg.in || {})) if (!reach(inp, stack)) { ok = false; break; }
      stack.delete(id);
      memo.set(id, ok);
      return ok;
    }
    /* WHY THE PRIMARY LEG AND ONLY THE PRIMARY LEG. `legsOf()` returns the
       ALT_FEEDSTOCK list when there is one, and an alternate leg is NOT a
       second way to be reachable in practice: sim.js `availabilityMap()` only
       measures the inputs of the leg a firm is ALREADY running, so an
       alternate's inputs are missing from the map and read as fully available.
       Measured: an electricity plant on a node with no fuel of any kind hopped
       to the `biomass` leg and produced 1200 units from zero biomass. Counting
       alternates here would let this round certify a chain that only "runs"
       through that hole. legs[0] is also what prices.js derives base price
       from, for the same reason. */

    const dark = [], lit = [];
    for (const id of Array.from(MAKEABLE).sort()) (reach(id, new Set()) ? lit : dark).push(id);

    console.log('\n  ' + lit.length + ' of ' + MAKEABLE.size + ' mapped outputs reach the ground.');
    console.log('  still dark (no city tile makes an input, somewhere below them):');
    console.log('    ' + (dark.join(', ') || '— none —') + '\n');

    // ── THE OUROBOROS LINE IS NOT ALLOWED TO BE DARK ────────────────────────
    const LINE = ['boosterPacks', 'printedCards', 'cardStock', 'packagingMaterial'];
    for (const id of LINE) {
      chk('`' + id + '` reaches the ground — the Card Shop can actually print',
          MAKEABLE.has(id) && reach(id, new Set()),
          MAKEABLE.has(id) ? 'blocked below it' : 'NO ECO_BUILDING_MAP row makes it');
    }
    /* The two rows the whole fix hangs on. Named explicitly so deleting one is
       a red with the reason attached, rather than four confusing failures. */
    chk('the map still has a paper mill and a print works',
        MAKEABLE.has('cardStock') && MAKEABLE.has('printedCards'),
        'cardStock:' + MAKEABLE.has('cardStock') + ' printedCards:' + MAKEABLE.has('printedCards'));
    /* A CEILING, WRITTEN DOWN AS A LITERAL — deliberately NOT `dark.length`
       compared against itself. That shape is the exact tautology this package
       exists to remove (gauntlet3's old card assertion was `x > 0 || price > 0`
       and could not fail), and a self-comparison here would be the same
       mistake wearing a different hat. The number is a CEILING and not an
       equality because the list is expected to SHRINK as the city grows a
       chemical tier; a round that had to be edited every time something got
       FIXED would be edited into uselessness. Lower it when you lower it. */
    const DARK_CEILING = 19;
    chk('the dark list has not grown past the shipped ceiling of ' + DARK_CEILING,
        dark.length <= DARK_CEILING, dark.length + ' dark ids');
    chk('no Ouroboros id is on the dark list',
        !dark.some(id => LINE.includes(id)), dark.filter(id => LINE.includes(id)).join(', '));

    if (SABOTAGE === 'dark-cards') delete R.RECIPES.boosterPacks.in.holographicFoil;

    if (fails) { bad++; console.log('\n=== ROUND 0j: ' + fails + ' FAILED ==='); }
    else console.log('\n=== ROUND 0j: ALL PASS ===');
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   ROUND 0c — 🔴 A BUILDING BEING UPGRADED IS STILL A BUSINESS
   ----------------------------------------------------------------------------
   THE INVARIANT, verbatim from node-city/index.html:17117:

     > A tile may be ABSENT from `ecoBuildings()` until its first completion,
     > and is PRESENT forever after. It is NEVER withdrawn.
     > `ecoBuildings` is gated on `bldSite`, never on `bldBusy`.

   Why it is the most dangerous line in the city, and why NOTHING ELSE catches
   a violation of it:

     · `bldSite(t)` is true only for a tile with nothing standing on it yet.
       `bldBusy(t)` is true for ANY job, including the upgrade of a working
       factory. Swapping one for the other is a one-word "simplification" that
       reads like a tidy-up.
     · With bldBusy there, an upgrading tile leaves the reconcile list for the
       length of the job — up to 24 hours. syncBuildings (economy/index.js:163)
       then sets rung='BANKRUPT' and Firms.reap() DELETES the firm: its id, its
       lifetime revenue, its supplier set and its rung are gone, and a fresh
       firm is founded on the rubble when the job ends. No warn. No throw. No
       log line.
       ⚠ IT USED TO TAKE THE CASH WITH IT TOO, and that is fixed — `reap()` now
         hands a closing firm's balance to the treasury (sim.js `receiveEstate`)
         so the money survives. That makes the MONEY assertion below blind to
         this particular failure and the IDENTITY assertions the only ones that
         still see it. Both are kept: money moving at this seam is a different
         bug, and this is the round positioned to catch it.
     · And the gauntlet stays GREEN, because sim.js captures `before` INSIDE
       runDay (sim.js:820) while the host calls syncBuildings from a 4 s
       setInterval — i.e. always between ticks, never inside the audited
       window. The books balance because the theft happened while nobody was
       counting.

   So this round counts. It drives a full place → build → complete → upgrade →
   complete cycle and asserts on BOTH halves of the damage:

     IDENTITY  the firm id, its lifetime revenue, its supplier set and its rung
               survive the upgrade. A reap-and-refound gives a NEW id and a
               zeroed book, which is what a player would experience as "my
               factory forgot everything".
     MONEY     totalCinder() is measured either side of EVERY syncBuildings
               call, not just either side of a tick. Across the upgrade window
               that delta must be EXACTLY zero. It is the guard against ANY
               Cinder crossing this seam — not, any longer, against the reap
               itself: founding draws on the charter fund and a wind-up pays
               into the treasury, so both halves are transfers and both read 0
               here. Round 0e owns the demolition seam directly.

   ⚠ MEASURED, NOT MODELLED — AND THE MEASUREMENT CHANGED WHAT IT PROVES.
     `Firms.found()` USED to credit a new firm dailyOperatingCost ×
     ECON.firm.startCashDays out of nowhere, and because founding happens
     between ticks the day audit never saw a Cinder of it: this round measured
     721,771 🔥 of it in a 240-day city against −6,159 🔥 of audited flow. Seed
     capital now comes out of the CHARTER FUND (sim.js, `fundFounding`), which
     is a term of totalCinder(), so a founding moves the total by ZERO and the
     sync term below is zero at EVERY sync rather than only during an upgrade.
     The books are still closed the honest way,
        Δ totalCinder = Σ(faucet + founding − imports − payout) + Σ(sync deltas)
     with the sync term measured directly — it is just that the sync term is
     now expected to be flat 0, which is a much stronger statement than the
     "measure whatever it minted and add it back" closure it replaces.
     Round 0e owns the bound on the `founding` term itself.

   Prove this round can fail: ECON_TEST_SABOTAGE=withdraw.
   ════════════════════════════════════════════════════════════════════════════ */
{
  console.log('\n########## round0c-firm-stability ##########');
  let fails = 0;
  const chk = (name, cond, extra) => {
    if (cond) { console.log('✅ ' + name); return true; }
    fails++; console.log('❌ ' + name + (extra ? ' :: ' + extra : '')); return false;
  };

  if (!CITY_MAP) {
    console.log('❌ round0b could not read ECO_BUILDING_MAP — this round has nothing to reconcile against.');
    bad++; console.log('\n=== ROUND 0c: 1 FAILED ===');
  } else {
    if (!global.window) {
      global.window = { MythicCityBridge: { addCinders: async () => {} }, MythicResourceChain: null };
      const chain = await import('../../public/src/resources/chain.js');
      global.window.MythicResourceChain = { ALL: chain.RESOURCE_CHAIN };
    }
    const P = '../../public/src/economy/';
    const E = (await import(P + 'index.js')).default;
    const { ECON } = await import(P + 'tuning.js');
    const DAY = ECON.clock.dayMin;          // minutes that make exactly one runDay

    /* ⚠ THE GATE UNDER TEST, COPIED VERBATIM FROM node-city:17250. This is the
       one line this round exists to defend, so it is written out rather than
       imported (it cannot be imported — it is a `const` arrow inside an IIFE
       in an HTML file). If node-city's definition and this one ever disagree,
       this round is testing a fiction; that is the cost of the globals trap
       and it is why the browser-driven check in the package notes exists too. */
    const bldSite = t => !!(t && t.bld && t.bld.k === 0);

    const tiles = {};
    /* Withheld key: the sabotage hook. Nothing sets this on a shipping run. */
    let WITHHOLD = null;
    const list = () => Object.entries(tiles)
      .filter(([k, t]) => CITY_MAP[t.type] && !t.damaged && !bldSite(t) && k !== WITHHOLD)
      .map(([k, t]) => {
        const o = E.pickAvailable(CITY_MAP[t.type].out);
        return o ? { key: k, out: o, ind: CITY_MAP[t.type].ind, lvl: t.lvl } : null;
      }).filter(Boolean);
    const inList = k => list().some(b => b.key === k);
    const firmAt = k => E.firms().find(f => f.tileKey === k) || null;

    /* A node that actually has timber, so the sawmill under test buys from a
       LOCAL supplier and its `suppliers` set is non-empty. Without that the
       "suppliers survived" assertion would be true of an empty object and
       would prove nothing — the same vacuity round0b guards against. */
    let node = null;
    for (let i = 0; i < 80 && !node; i++) {
      const id = 'wp7-' + i;
      E.mount({ nodeId: id, population: 60 });
      if (E.canBuild('timber')) node = id;
    }
    chk('found a node whose ground carries timber (so the supplier leg is real)', !!node, 'scanned 80 nodes');
    if (!node) node = 'wp7-0';

    E.mount({ nodeId: node, population: 60 });
    const host = { powerFactor: 1, waterFactor: 1, logisticsCounts: { warehouse: 3, depot: 2 },
                   hasBank: true, infrastructure: 0.75 };

    // ── the accounting, running for the whole cycle ────────────────────────
    const START = E.totalCinder();
    let expected = 0, syncTotal = 0, auditBad = null;
    const tick = () => {
      E.tick(DAY, host);
      const s = E.snapshot();
      expected += s.flow.faucet + (s.flow.founding || 0) - s.flow.imports - s.flow.payout;
      if (!s.audit || !s.audit.ok) auditBad = JSON.stringify(s.audit);
    };
    /* Every sync is weighed. `label` is only used to report where money moved. */
    const sync = () => { const t0 = E.totalCinder(); E.syncBuildings(list());
                         const d = E.totalCinder() - t0; syncTotal += d; return d; };

    // A small working city around the subject, so it has customers and inputs.
    tiles['1,0'] = { type: 'lumbercamp', lvl: 1, damaged: false };
    tiles['2,0'] = { type: 'purifier',   lvl: 1, damaged: false };
    tiles['3,0'] = { type: 'farm',       lvl: 1, damaged: false };
    tiles['4,0'] = { type: 'grocery',    lvl: 1, damaged: false };
    /* 🏭 …and one of the 14 operations this package wired, so the new entries
       are proved to found a firm rather than only to be spelled correctly. */
    tiles['9,0'] = { type: 'op_warehouse', lvl: 1, damaged: false };

    // ── 1. PLACED AS A SITE: nothing standing, so no business. ─────────────
    const SUBJ = '5,0';
    tiles[SUBJ] = { type: 'sawmill', lvl: 1, damaged: false,
                    bld: { k: 0, l: 1, s: Date.now(), d: 900 } };
    sync();
    chk('a construction SITE is absent from the reconcile list', !inList(SUBJ));
    chk('a construction SITE founds no firm', !firmAt(SUBJ));
    chk('an op_* tile founds a firm (the 14 new entries are live)',
        !!firmAt('9,0'), 'op_warehouse → ' + JSON.stringify(firmAt('9,0') && firmAt('9,0').out));

    // ── 2. COMPLETE: the business exists. ──────────────────────────────────
    delete tiles[SUBJ].bld;
    const dFound = sync();
    const born = firmAt(SUBJ);
    chk('completion founds the business', !!born, 'no firm at ' + SUBJ);
    /* 🔴 THIS CHECK USED TO ASSERT `dFound > 0` — i.e. it PINNED the mint,
       because at the time the mint was the truth and a test that models what
       ought to happen instead of what does is worthless. Founding is now a
       transfer out of the charter fund, so the honest assertion is the
       opposite one, and it is stronger: no Cinder appears at the seam, and the
       business is nevertheless capitalised. Both halves matter — "0 moved" is
       also what a founding that funded NOTHING would print. */
    chk('founding moves NO Cinder at the seam — seed capital is a transfer, not a mint',
        Math.abs(dFound) < 1e-9, 'sync moved ' + dFound.toFixed(2) + ' 🔥');
    chk('...and the business was actually capitalised out of the charter fund',
        !!born && born.cash > 0 && born.cash <= born.seedWant + 1e-9,
        born ? 'cash ' + born.cash.toFixed(2) + ' of seedWant ' + (born.seedWant || 0).toFixed(2) : 'no firm');

    // ── 3. TRADE for a while, so there is a book worth losing. ─────────────
    for (let d = 0; d < 14; d++) { sync(); tick(); }
    const f0 = firmAt(SUBJ);
    const BEFORE = f0 ? { id: f0.id, cash: f0.cash, rev: f0.lifetimeRevenue,
                          sup: Object.keys(f0.suppliers || {}).sort(), rung: f0.rung, level: f0.level } : null;
    chk('the business is trading before the upgrade (cash, revenue and a supplier)',
        !!BEFORE && BEFORE.rev > 0 && BEFORE.sup.length > 0 && BEFORE.rung !== 'BANKRUPT',
        BEFORE ? 'rev ' + BEFORE.rev.toFixed(0) + ', suppliers [' + BEFORE.sup.join(',') + ']' : 'no firm');

    // ── 4. ORDER THE UPGRADE. k=1 ⇒ a STANDING building with a job on it. ──
    tiles[SUBJ].bld = { k: 1, l: 2, s: Date.now(), d: 3600 };
    let absentDuring = 0, idChanged = 0, movedDuring = [], vanished = 0;
    /* 🔴 CONTINUOUS, NOT ENDPOINT. An earlier draft compared the firm's books
       only before and after the window and both checks stayed GREEN under the
       sabotage: the replacement firm had out-earned the original's recorded
       revenue by the time the window closed, and Firms.reap() DELETES a
       bankrupt firm outright so `snapshot().bankrupt` reads 0 afterwards. The
       reap is only visible while it is happening. So the books are read at
       every sync and any DROP is the finding. */
    let prevRev = BEFORE ? BEFORE.rev : 0;
    let prevSup = BEFORE ? BEFORE.sup : [];
    let revDropped = [], supShrank = 0;
    const upSyncStart = syncTotal;
    for (let d = 0; d < 10; d++) {
      if (SABOTAGE === 'withdraw' && d === 0) {
        WITHHOLD = SUBJ;                 // 🧨 exactly one sync, exactly as bldBusy would
        console.log('   🧨 withholding ' + SUBJ + ' from the reconcile list for one sync');
      }
      const dS = sync();
      WITHHOLD = null;
      if (Math.abs(dS) > 1e-9) movedDuring.push('sync' + d + ' Δ' + dS.toFixed(2));
      if (!inList(SUBJ)) absentDuring++;
      const f = firmAt(SUBJ);
      if (!f) { vanished++; idChanged++; }
      else {
        if (!BEFORE || f.id !== BEFORE.id) idChanged++;
        if (f.lifetimeRevenue + 1e-9 < prevRev)
          revDropped.push('sync' + d + ' ' + prevRev.toFixed(0) + '→' + f.lifetimeRevenue.toFixed(0));
        if (!prevSup.every(s => f.suppliers && f.suppliers[s])) supShrank++;
        prevRev = f.lifetimeRevenue;
        prevSup = Object.keys(f.suppliers || {});
      }
      tick();
    }
    chk('the business never disappears mid-upgrade', vanished === 0,
        vanished + ' of 10 syncs found NO firm on the tile');
    chk('lifetime revenue never drops at any sync of the upgrade (a refound zeroes it)',
        revDropped.length === 0, revDropped.join(', '));
    chk('the supplier set never shrinks at any sync of the upgrade',
        supShrank === 0, supShrank + ' of 10 syncs lost a supplier');
    chk('an UPGRADING tile is in the reconcile list on every sync of the job',
        absentDuring === 0, absentDuring + ' of 10 syncs withdrew it');
    chk('the firm id never changes during the upgrade', idChanged === 0,
        idChanged + ' of 10 syncs saw a different (or missing) firm');
    /* ⚠ NOT the reap detector any more — see the header. A reap is a transfer
       in both directions now, so this reads 0 either way; the identity checks
       above are what catch the withdrawal. This still guards the seam against
       anything that DOES move money across it. */
    chk('NO CINDER MOVES AT SYNC during an upgrade',
        movedDuring.length === 0, movedDuring.join(', ') +
        ' (total ' + (syncTotal - upSyncStart).toFixed(2) + ' 🔥)');

    // ── 5. COMPLETE THE UPGRADE. Still there, still the same business. ─────
    delete tiles[SUBJ].bld; tiles[SUBJ].lvl = 2;
    const dDone = sync(); tick();
    const f1 = firmAt(SUBJ);
    chk('the tile is present after the upgrade completes', inList(SUBJ) && !!f1);
    chk('same firm id across the whole cycle',
        !!f1 && !!BEFORE && f1.id === BEFORE.id,
        BEFORE ? 'id ' + BEFORE.id + ' → ' + (f1 ? f1.id : 'GONE') : 'no baseline');
    /* ⚠ `f1.id === BEFORE.id` is part of BOTH of these on purpose. A
       replacement firm can out-earn the original's recorded revenue and can
       re-acquire the same two suppliers within a few days, so without the
       identity clause these read green over a city that lost the business and
       quietly built another one on its rubble. */
    chk('the SAME firm still holds its lifetime revenue',
        !!f1 && !!BEFORE && f1.id === BEFORE.id && f1.lifetimeRevenue >= BEFORE.rev,
        BEFORE ? 'id ' + BEFORE.id + '→' + (f1 ? f1.id : '—') + ', rev ' +
                 BEFORE.rev.toFixed(0) + '→' + (f1 ? f1.lifetimeRevenue.toFixed(0) : '—') : '');
    chk('the SAME firm still holds its supplier set',
        !!f1 && !!BEFORE && f1.id === BEFORE.id &&
        BEFORE.sup.every(s => f1.suppliers && f1.suppliers[s]),
        BEFORE ? 'id ' + BEFORE.id + '→' + (f1 ? f1.id : '—') + ', suppliers [' +
                 BEFORE.sup.join(',') + '] → [' +
                 (f1 ? Object.keys(f1.suppliers || {}).sort().join(',') : '') + ']' : '');
    chk('the rung was never reset to a fresh HEALTHY after a BANKRUPT',
        !!f1 && f1.rung !== 'BANKRUPT' && E.snapshot().bankrupt === 0,
        (f1 ? 'rung ' + f1.rung + ', ' : '') + E.snapshot().bankrupt + ' bankrupt firms in the city');
    chk('completing the upgrade moves no Cinder either (no refound)',
        Math.abs(dDone) < 1e-9, dDone.toFixed(4) + ' 🔥');

    // ── 6. THE BOOKS, CLOSED OVER THE WHOLE CYCLE. ─────────────────────────
    const END = E.totalCinder();
    const drift = (END - START) - expected - syncTotal;
    const tol = Math.max(1, Math.abs(END) * 1e-6);
    console.log('\n  💰 place → build → complete → upgrade → complete');
    console.log('     totalCinder     ' + START.toFixed(2) + ' → ' + END.toFixed(2) +
                '   (Δ ' + (END - START).toFixed(2) + ')');
    console.log('     audited flows   ' + expected.toFixed(2) + '   (faucet + founding − imports − payout)');
    console.log('     seam movement   ' + syncTotal.toFixed(2) + '   (measured at syncBuildings — must be 0)');
    console.log('     unexplained     ' + drift.toFixed(6) + '   (tolerance ' + tol.toFixed(4) + ')\n');
    chk('no Cinder was minted or burned outside the audited terms', Math.abs(drift) <= tol,
        'drift ' + drift.toFixed(6));
    chk('the day audit stayed clean throughout', !auditBad, auditBad);
    chk('payouts were never suspended', E.snapshot().payoutAllowed === true);

    if (fails) { bad++; console.log('\n=== ROUND 0c: ' + fails + ' FAILED ==='); }
    else console.log('\n=== ROUND 0c: ALL PASS ===');
  }
}
/* ════════════════════════════════════════════════════════════════════════════
   ROUND 0d — 🏦 THE DEAD DEBT RUNG
   ----------------------------------------------------------------------------
   THE BUG THIS ROUND EXISTS FOR, and it shipped:

     ecoHost() answered  `hasBank: …some(t => t.type === 'bank' && …)`

   but the bank tile is BUILDINGS['op_bank'], registered by the OPS loop off
   OPS_PREFIX. NO TILE IS EVER THE BARE STRING 'bank'. So hasBank was
   permanently false, sim.js never capitalised the lender, bank.js answered
   "No bank in the city" to every request, and the ENTIRE DEBT RUNG — borrow,
   interest, amortisation, missed payment, default, write-off — was dead code
   that had never once executed in production. Nothing was red, because dead
   code is quiet.

   Two halves, and neither alone is enough:

     THE TILE TEST   `function ecoHost()` is read OUT OF THE SHIPPED FILE and
                     evaluated. Not a copy — round0c has to copy `bldSite`
                     because it is a const arrow inside an IIFE, and the header
                     there says plainly that a copy tests a fiction if the two
                     drift. ecoHost is a plain `function`, so it can be lifted
                     whole and driven over real tile shapes.
     THE RUNG        a city with a real op_bank tile is driven through
                     capitalise → borrow → accrue → repay, and the loan is
                     followed by id the whole way. "hasBank is true" would pass
                     over a lender that still refuses every application.

   🔴 PROVING THE KEY IS DERIVED, NOT TYPED. `opsKeyOf('bank')` and the literal
      'op_bank' are textually different and behaviourally identical — until the
      prefix moves, at which point the literal becomes this exact bug again. So
      the strong check is not a grep: ecoHost is run a SECOND time with
      opsKeyOf stubbed to a different prefix, and the answer has to FOLLOW the
      stub. A hardcoded key cannot pass that. The greps are kept as well,
      because they name the mistake in the failure message.

   ⚠ WHICH TWO TERMS THE MONEY MOVES BETWEEN (Rule 1). totalCinder() is
     HH.totalSavings() + Firms.totalCash() + S.treasury + Bank.state().reserve.
     Seeding the lender moves treasury → reserve; a loan moves reserve → firm
     cash; a repayment moves firm cash → reserve. All four terms are INSIDE the
     sum, so every leg is a transfer and none of it mints. This round asserts
     that arithmetic directly rather than trusting the audit to notice.

   ⚠ ROUND ORDER MATTERS. This runs after 0c and re-mounts the economy on its
     own node; the modules are singletons in this process and a round that
     inherited 0c's firms would be measuring 0c's city.
   ════════════════════════════════════════════════════════════════════════════ */
{
  console.log('\n########## round0d-bank-debt-rung ##########');
  let fails = 0;
  const chk = (name, cond, extra) => {
    if (cond) { console.log('✅ ' + name); return true; }
    fails++; console.log('❌ ' + name + (extra ? ' :: ' + extra : '')); return false;
  };

  /* ECON_TEST_SABOTAGE=no-map injures this round too, not only round0b: this
     round's extraction has exactly the same vacuity failure mode — a scrape
     that matches nothing would sail past every assertion below while the
     comment in index.html still claimed the tile test was guarded. */
  let HTML = null;
  try {
    HTML = readFileSync(join(here, SABOTAGE === 'no-map'
      ? '../../public/node-city/THIS-FILE-DOES-NOT-EXIST.html'
      : '../../public/node-city/index.html'), 'utf8');
  } catch (e) { HTML = null; }
  const BODY = srcBlockAfter(HTML, 'function ecoHost() {');
  const prefixM = HTML ? /const\s+OPS_PREFIX\s*=\s*'([^']*)'/.exec(HTML) : null;
  const PREFIX = prefixM ? prefixM[1] : null;

  const got =
    chk('read ecoHost() out of node-city/index.html',
        !!BODY && BODY.indexOf('hasBank') > 0,
        BODY ? BODY.length + ' chars, no hasBank in it' : 'UNREADABLE or unbalanced — the tile test cannot be checked at all') &
    chk('read OPS_PREFIX out of node-city/index.html', !!PREFIX, String(PREFIX));

  if (!got) {
    /* Same rule as round0b: a scrape that matched nothing must fail HARD, not
       pass vacuously. If ecoHost was renamed, fix the marker above. */
    console.log('\n🔴 ecoHost() COULD NOT BE READ — nothing below was checked.');
    bad++; console.log('\n=== ROUND 0d: ' + fails + ' FAILED ===');
  } else {
    // ── 1. THE TILE TEST, read from source and then actually run ───────────
    const clause = BODY.slice(BODY.indexOf('hasBank:'), BODY.indexOf('infrastructure:'));
    chk('the hasBank clause derives its key through opsKeyOf()',
        /opsKeyOf\(\s*'bank'\s*\)/.test(clause), clause.trim().slice(0, 120));
    chk("the hasBank clause contains NO hardcoded 'op_bank' — one prefix change from being this bug again",
        !/['"]op_bank['"]/.test(clause), clause.trim().slice(0, 200));
    chk("the original bug is gone: no `t.type === 'bank'`",
        !/type\s*===\s*['"]bank['"]/.test(clause), clause.trim().slice(0, 200));
    chk('the clause still refuses a DAMAGED bank', /!\s*t\.damaged/.test(clause));
    chk('the clause guards on bldSite (a SITE is inert), NOT bldBusy (an upgrading bank still lends)',
        /bldSite\s*\(/.test(clause) && !/bldBusy\s*\(/.test(clause), clause.trim().slice(0, 200));

    /* ⚠ COPIED VERBATIM FROM node-city, same as round0c's copy and for the same
       reason — a const arrow inside an IIFE cannot be imported. If these drift,
       round0c fails first and loudly. */
    const bldSite = t => !!(t && t.bld && t.bld.k === 0);

    /* Lift the shipped function whole and hand it everything it reaches for.
       ⚠ THE LIST IS THE POINT: `new Function` resolves these names from the
         parameter list, so anything ecoHost() reaches for and is NOT named here
         throws ReferenceError and this round goes red. That is what makes the
         lift honest rather than a re-implementation. It used to carry an
         `ecoShock` stub; ecoHost no longer calls it (the disaster→prices term
         was removed) and a stub for a function nobody calls is exactly the dead
         scaffolding that makes the next reader hunt for a caller. */
    const runHost = (tiles, keyFn) => {
      /* 👥 `demogPopulation` is the demographics handover — ecoHost() now asks
         it how many of the city's residents the zoning actually houses and
         falls back to cityPop() when the module is absent. Stubbed at the same
         figure cityPop() answers, because this round is about the BANK clause
         and a different population would only make its cities disagree. */
      const names = ['game', 'cityPop', 'demogPopulation', 'ecoLogisticsCounts', 'bldSite', 'opsKeyOf',
                     'roadUsed', 'roadCap'];
      const fn = new Function(...names, 'return (function ecoHost() ' + BODY + ')();');
      return fn(
        { tiles, cov: { avg: 0.75, pct: { water: 1 } }, power: { factor: 1 } },
        () => 60, () => 60, () => ({ warehouse: 3, depot: 2 }), bldSite, keyFn,
        () => 0, () => 1);
    };
    const realKey = ty => PREFIX + ty;
    const asks = tiles => !!runHost(tiles, realKey).hasBank;

    const BANK_T = PREFIX + 'bank';
    const standing = { '1,0': { type: 'grocery', lvl: 1 }, '2,0': { type: BANK_T, lvl: 1 } };
    const bareStr  = { '1,0': { type: 'grocery', lvl: 1 }, '2,0': { type: 'bank',  lvl: 1 } };
    const site     = { '1,0': { type: 'grocery', lvl: 1 },
                       '2,0': { type: BANK_T, lvl: 1, bld: { k: 0, l: 1, s: Date.now(), d: 900 } } };
    const upgrading= { '1,0': { type: 'grocery', lvl: 1 },
                       '2,0': { type: BANK_T, lvl: 1, bld: { k: 1, l: 2, s: Date.now(), d: 900 } } };
    const damaged  = { '1,0': { type: 'grocery', lvl: 1 }, '2,0': { type: BANK_T, lvl: 1, damaged: true } };

    /* 🐛 THE BUG, REPRODUCED. This is the predicate that shipped, written out,
       run over the SAME city that the fixed one answers true for. It is here so
       the round shows the before as well as the after — a green test that only
       ever saw the fixed code cannot tell you the bug was real. */
    const PRE_FIX = tiles => Object.values(tiles).some(t => t.type === 'bank' && !t.damaged && !bldSite(t));
    chk("BEFORE: the shipped predicate (`t.type === 'bank'`) is FALSE with a bank standing — the whole bug",
        PRE_FIX(standing) === false, 'tile type is ' + BANK_T);
    chk('AFTER: the fixed clause is TRUE with the same bank standing', asks(standing) === true);

    chk('no bank at all ⇒ false', asks({ '1,0': { type: 'grocery', lvl: 1 } }) === false);
    chk("a tile literally typed 'bank' ⇒ false (no such tile exists; the old string matched nothing)",
        asks(bareStr) === false);
    chk('🏗 a construction SITE bank ⇒ false (a hole in the ground makes no loans)', asks(site) === false);
    chk('an UPGRADING bank ⇒ TRUE (bldSite, not bldBusy — a working branch stays live)',
        asks(upgrading) === true);
    chk('a DAMAGED bank ⇒ false', asks(damaged) === false);

    /* THE DERIVATION CHECK. Move the prefix and the answer must move with it. */
    const swapped = ty => 'zz_' + ty;
    chk('the key is DERIVED: with opsKeyOf stubbed to a different prefix, op_bank stops counting',
        runHost(standing, swapped).hasBank === false,
        'a hardcoded op_bank would still read true here');
    chk('…and zz_bank starts counting instead',
        runHost({ '2,0': { type: 'zz_bank', lvl: 1 } }, swapped).hasBank === true);

    // ── 2. THE RUNG. A real city, a real op_bank tile, a real loan. ────────
    if (!global.window) {
      global.window = { MythicCityBridge: { addCinders: async () => {} }, MythicResourceChain: null };
      const chain = await import('../../public/src/resources/chain.js');
      global.window.MythicResourceChain = { ALL: chain.RESOURCE_CHAIN };
    }
    const P = '../../public/src/economy/';
    const E = (await import(P + 'index.js')).default;
    const { ECON } = await import(P + 'tuning.js');
    const DAY = ECON.clock.dayMin;

    E.mount({ nodeId: 'bank-rung', population: 60 });

    const tiles = {
      '1,0': { type: 'lumbercamp', lvl: 1 }, '2,0': { type: 'purifier', lvl: 1 },
      '3,0': { type: 'farm', lvl: 1 },       '4,0': { type: 'grocery', lvl: 1 },
      '5,0': { type: 'sawmill', lvl: 1 },    '6,0': { type: 'housing', lvl: 2 },
      /* 🏦 The subject. CITY_MAP has no op_bank row on purpose (round0b asserts
         that), so this tile founds NO firm — its entire economic effect is the
         boolean under test. */
      '9,0': { type: BANK_T, lvl: 1 },
    };
    const list = () => Object.entries(tiles)
      .filter(([, t]) => CITY_MAP[t.type] && !t.damaged && !bldSite(t))
      .map(([k, t]) => {
        const o = E.pickAvailable(CITY_MAP[t.type].out);
        return o ? { key: k, out: o, ind: CITY_MAP[t.type].ind, lvl: t.lvl } : null;
      }).filter(Boolean);

    E.syncBuildings(list());
    chk('the bank tile founds no business (it is not in ECO_BUILDING_MAP)',
        !E.firms().some(f => f.tileKey === '9,0'));

    /* The host is the SHIPPED ecoHost, over the SHIPPED tile test. Nothing
       between the fix and the lender is hand-written here. */
    const host = () => runHost(tiles, realKey);
    chk('the shipped ecoHost reports hasBank for this city', host().hasBank === true);

    /* The FIVE terms of totalCinder(), read the way sim.js defines them.
       ⚠ `charter` is the newest of them and it is the one a future edit is most
       likely to forget: the charter fund is a real balance that founding draws
       on, so leaving it out of this sum would read as a leak of exactly the
       unspent seed capital and would send the next reader hunting a phantom. */
    const terms = () => { const s = E.snapshot();
      return { savings: s.savings, firmCash: s.firmCash, treasury: s.treasury,
               charter: s.charter, reserve: s.bank.reserve, total: s.totalCinder }; };
    const SUM_TOL = 1e-6;
    let auditBad = null, flows = 0;
    const tick = () => {
      E.tick(DAY, host());
      const s = E.snapshot();
      flows += s.flow.faucet + (s.flow.founding || 0) - s.flow.imports - s.flow.payout;
      if (!s.audit || !s.audit.ok) auditBad = JSON.stringify(s.audit);
    };

    const START = E.snapshot().totalCinder;
    const seedT0 = terms();
    const flows0 = flows;
    tick();                                    // the day the lender is capitalised
    const seedT1 = terms();
    chk('CAPITALISE: the lender has a reserve for the first time in this feature\'s life',
        seedT0.reserve === 0 && seedT1.reserve > 0,
        'reserve ' + seedT0.reserve.toFixed(2) + ' → ' + seedT1.reserve.toFixed(2));
    /* ⚠ NOT `treasury went down`. That was the first draft and it failed
       honestly: the seeding happens at step 5 of runDay, and steps 7–8 of the
       SAME day then pay corporate tax and property tax INTO the treasury, so
       the day's net treasury move is upward (0.00 → 8.00 on the run that
       caught this) even though the seed left it. An endpoint comparison cannot
       see an intra-day transfer. What CAN be asserted exactly is the pair of
       claims that actually matter: the reserve appeared, and the day's total
       moved by nothing but the audited flows — i.e. the seed was a transfer
       between two totalCinder() terms, not a mint. The debit itself is pinned
       at its source below, where sim.js writes it. */
    chk('CAPITALISE mints nothing: the seeding day moves totalCinder by exactly the audited flows',
        Math.abs((seedT1.total - seedT0.total) - (flows - flows0)) <= Math.max(1, Math.abs(seedT1.total) * 1e-6),
        'Δtotal ' + (seedT1.total - seedT0.total).toFixed(6) + ' vs flows ' + (flows - flows0).toFixed(6));
    /* The two terms, named at the source. `S.treasury -= Bank.capitalise(seed)`
       debits the treasury by EXACTLY what the lender accepted — the judge's
       audit-safety argument in one line, and the line a future edit is most
       likely to break by debiting `seed` instead of the return value (they
       differ whenever the treasury is short). */
    let simSrc = '';
    try { simSrc = readFileSync(join(here, '../../public/src/economy/sim.js'), 'utf8'); } catch (e) {}
    chk('the seed is `S.treasury -= Bank.capitalise(…)` — debited by the amount actually accepted',
        /S\.treasury\s*-=\s*Bank\.capitalise\(/.test(simSrc),
        'sim.js no longer debits the treasury by capitalise()\'s return value');

    // Trade for a fortnight so a firm has a revenue average to borrow against.
    for (let d = 0; d < 14; d++) tick();

    const cands = E.firms().filter(f => f.rung !== 'BANKRUPT' && (f.revenueAvg || 0) > 0)
                           .sort((a, b) => (b.revenueAvg || 0) - (a.revenueAvg || 0));
    chk('at least one business is trading and could service a loan', cands.length > 0,
        E.firms().length + ' firms, none with revenue');
    const subject = cands[0] || null;

    // ── BORROW — the exact call the panel's 🏦 Borrow button makes ─────────
    const before = terms();
    const beforeLoans = E.snapshot().bank.loans;
    const beforeDebt = E.snapshot().firmDebt;
    const r = subject ? E.borrow(subject.id, Infinity) : { ok: false, why: 'no firm' };
    chk('BORROW: the lender advances — the rung EXECUTES for the first time',
        !!(r && r.ok && r.amount >= 1),
        r ? ('refused: ' + (r.why || '?') + ' (this is the sentence the dead rung always gave)') : 'no result');
    const after = terms();
    const loan = (r && r.ok && r.loan) ? r.loan : null;

    chk('the loan appears on the book', E.snapshot().bank.loans === beforeLoans + 1,
        beforeLoans + ' → ' + E.snapshot().bank.loans);
    chk('the borrower carries the debt', Math.abs(E.snapshot().firmDebt - beforeDebt - (r.amount || 0)) < 1e-6,
        beforeDebt.toFixed(2) + ' → ' + E.snapshot().firmDebt.toFixed(2));
    chk('BORROW moves reserve → firm cash, and ONLY those two terms',
        Math.abs((before.reserve - after.reserve) - (r.amount || 0)) < 1e-6 &&
        Math.abs((after.firmCash - before.firmCash) - (r.amount || 0)) < 1e-6 &&
        Math.abs(after.treasury - before.treasury) < 1e-6 &&
        Math.abs(after.savings - before.savings) < 1e-6,
        'Δreserve ' + (after.reserve - before.reserve).toFixed(2) +
        ', ΔfirmCash ' + (after.firmCash - before.firmCash).toFixed(2) +
        ', Δtreasury ' + (after.treasury - before.treasury).toFixed(2));
    chk('RULE 1: totalCinder is unchanged across the borrow — a loan mints nothing',
        Math.abs(after.total - before.total) < Math.max(1e-6, Math.abs(after.total) * 1e-9),
        before.total.toFixed(6) + ' → ' + after.total.toFixed(6));

    /* ── ACCRUE and REPAY ──────────────────────────────────────────────────
       🔴 FOLLOWED BY THE LOAN OBJECT, NOT BY CITY AGGREGATES. The first draft
       asserted on snapshot().bank counts and it failed HONESTLY, twice over:
       sim.js calls Bank.autoBorrow() for every DEBT/DEFAULT firm each day, so
       this city opened several OTHER loans to dying businesses, one of which
       went bankrupt and had 179.25 🔥 written off. Both are the rung working
       exactly as designed — "the reserve eats it, that is what a bad loan book
       costs" — but they make `written === 0` and `loans === 0` say nothing
       about the loan under test. So the subject loan is tracked through the
       object `borrow()` returned, which stays live in LENDER.loans and, when
       it is removed, KEEPS its final `owed` — the one field that separates a
       loan repaid (≈0) from a loan defaulted (>0). */
    const Bank = await import(P + 'bank.js');
    const L = Bank.state();
    const principal = loan ? loan.principal : 0;
    const openMine = () => !!loan && L.loans.some(x => x.id === loan.id);
    let paidMine = 0, interestMine = 0, cleared = -1, otherLoans = 0;
    for (let d = 0; d < ECON.bank.termDays + 60 && loan; d++) {
      const owed0 = loan.owed, day0 = E.snapshot().day;
      tick();
      const elapsed = E.snapshot().day - day0;
      /* bank.js: interest = owed * (rate/365) * days, added BEFORE the payment
         is taken. Recomputed here rather than read, so this is an independent
         check of the arithmetic and not a restatement of it. */
      const i = owed0 * (loan.rate / 365) * elapsed;
      interestMine += i;
      paidMine += (owed0 + i) - loan.owed;
      otherLoans = Math.max(otherLoans, L.loans.length - (openMine() ? 1 : 0));
      if (!openMine()) { cleared = d; break; }
    }
    chk('ACCRUE: interest was charged on the loan (rate ' +
        (loan ? (loan.rate * 100).toFixed(2) : '—') + '%/yr)',
        interestMine > 0, 'no interest accrued over ' + (cleared + 1) + ' days');
    chk('ACCRUE: repayments flow firm cash → reserve', paidMine > 0,
        'nothing was ever paid back');
    chk('REPAY: the borrower paid back MORE than it borrowed — debt is not free money',
        paidMine > principal + 1e-6,
        'principal ' + principal.toFixed(2) + ', paid ' + paidMine.toFixed(2));
    chk('REPAY: the subject loan cleared inside its term', cleared >= 0,
        'still open after ' + (ECON.bank.termDays + 60) + ' days');
    chk('REPAY: it cleared by being PAID OFF, not written off or defaulted',
        !!loan && loan.owed <= 0.01 && subject.rung !== 'BANKRUPT' && !(subject.blacklistUntil > 0),
        loan ? ('final owed ' + loan.owed.toFixed(2) + ', rung ' + subject.rung +
                ', blacklistUntil ' + (subject.blacklistUntil || 0)) : 'no loan');
    chk('the borrower is out of debt', Math.abs(subject.debt || 0) < 1e-6,
        String(subject.debt));
    chk('the reserve was never negative while lending', L.reserve >= 0, L.reserve.toFixed(2));
    /* Informational, and it is the other half of the rung proving it runs: the
       AUTOMATIC distress path (sim.js → Bank.autoBorrow) opened loans of its
       own, and the write-off branch executed on a business that failed. Not
       asserted — a healthy run may legitimately produce neither. */
    console.log('   ℹ the automatic distress path also ran: ' + otherLoans +
                ' other loan(s) open at peak, ' + L.lifetimeWritten.toFixed(2) +
                ' 🔥 written off across the city.');

    // ── THE BOOKS, over the whole capitalise → borrow → accrue → repay ─────
    const END = E.snapshot().totalCinder;
    const T = terms();
    const drift = (END - START) - flows;
    const tol = Math.max(1, Math.abs(END) * 1e-6);
    const bk = E.snapshot().bank;
    console.log('\n  🏦 capitalise → borrow → accrue → repay');
    console.log('     subject loan    principal ' + principal.toFixed(2) + ' → paid ' +
                paidMine.toFixed(2) + ' (interest ' + interestMine.toFixed(2) +
                ') over ' + (cleared + 1) + ' days');
    console.log('     city loan book  lent ' + bk.lent.toFixed(2) + ' · repaid ' + bk.repaid.toFixed(2) +
                ' · written ' + bk.written.toFixed(2) + ' · open ' + bk.loans);
    console.log('     terms  savings ' + T.savings.toFixed(2) + ' + firmCash ' + T.firmCash.toFixed(2) +
                ' + treasury ' + T.treasury.toFixed(2) + ' + charter ' + T.charter.toFixed(2) +
                ' + reserve ' + T.reserve.toFixed(2));
    console.log('     totalCinder     ' + START.toFixed(2) + ' → ' + END.toFixed(2) +
                '   (Δ ' + (END - START).toFixed(2) + ')');
    console.log('     audited flows   ' + flows.toFixed(2) + '   (faucet + founding − imports − payout)');
    console.log('     unexplained     ' + drift.toFixed(6) + '   (tolerance ' + tol.toFixed(4) + ')\n');
    chk('the five terms still sum to totalCinder()',
        Math.abs((T.savings + T.firmCash + T.treasury + T.charter + T.reserve) - T.total) < SUM_TOL,
        (T.savings + T.firmCash + T.treasury + T.charter + T.reserve).toFixed(6) + ' vs ' + T.total.toFixed(6));
    /* ⚠ No syncBuildings runs inside this window — the city is fixed — so no
       founding TRANSFER happens here at all. The `founding` term in `flows` is
       still carried because the charter fund tops itself up inside runDay
       whenever it is below target, and that issuance is audited creation like
       the export faucet. */
    chk('RULE 1: no Cinder minted or burned with the DEBT RUNG LIVE',
        Math.abs(drift) <= tol, 'drift ' + drift.toFixed(6));
    chk('the day audit stayed clean throughout', !auditBad, auditBad);
    chk('payouts were never suspended', E.snapshot().payoutAllowed === true);

    /* RULE 5. Belt and braces, in the gate rather than in a reviewer's memory:
       the simulated lender must never reach the player's real Cinder. */
    let bankSrc = '';
    try { bankSrc = readFileSync(join(here, '../../public/src/economy/bank.js'), 'utf8'); } catch (e) {}
    chk('RULE 5: bank.js names no player-money symbol (Profile.gems / player_banks / spendGems / addGems)',
        !!bankSrc && !/Profile\s*\.\s*gems|player_banks|spendGems|addGems|MythicCityBridge/.test(
          bankSrc.replace(/\/\*[\s\S]*?\*\//g, '')),
        'bank.js reaches for real player money');

    if (fails) { bad++; console.log('\n=== ROUND 0d: ' + fails + ' FAILED ==='); }
    else console.log('\n=== ROUND 0d: ALL PASS ===');
  }
}
/* ════════════════════════════════════════════════════════════════════════════
   ROUND 0e — 🏦 THE FOUNDING MINT, AND THE CEILING THAT NOW BOUNDS IT
   ----------------------------------------------------------------------------
   THE DEFECT THIS ROUND EXISTS FOR, measured on the pre-fix tree before a line
   was changed:

     firms.js:  f.cash = dailyOperatingCost(f) * ECON.firm.startCashDays

   credited every new firm and debited nothing. A city holding all 47 mapped
   tile types over 240 days minted 721,771 🔥 that way (69 foundings — a firm
   that goes bankrupt is RE-founded on the next sync, so this is a pump and not
   a one-off) plus 182,997 🔥 at bootstrap, against −6,159 🔥 of audited flow —
   with ZERO failed day audits and payouts enabled throughout. The audit could
   not see it because the host founds firms from `syncBuildings` on a 4 s
   interval and `runDay` captures `before` at its own top: the creation happened
   between the audit windows, every single time. That is Rule 1 — "Cinder is
   never minted" — broken continuously, behind a green gate, for the whole life
   of the file.

   So this round asserts the two claims the fix rests on, and neither one is a
   restatement of the day audit:

     TRANSFER  totalCinder() is read either side of EVERY syncBuildings call and
               must move by EXACTLY zero. Seed capital comes out of the charter
               fund, which is a term of totalCinder(); if anyone ever restores a
               credit in `found()` — or adds a second one — this is the check
               that goes red, and it goes red at the seam where it happens
               rather than in a drift number four hundred lines later.
     WIND-UP   AND THE SEAM IS WALKED IN BOTH DIRECTIONS, because for one round
               this round only ever walked it in one. The mint was fixed while
               its mirror image was left running: `syncBuildings` marks a
               DEMOLISHED tile's firm BANKRUPT, `Firms.reap()` deleted it, and
               its whole cash balance left totalCinder() in the same between-tick
               gap. Measured on the tree that shipped with the founding fix in
               it: 12 demolitions in a 60-day city destroyed 42,612.05 🔥 —
               8.73% of that city's entire money supply — and the next day's
               audit read err=-0.000000, payoutAllowed=true. A round that adds
               buildings and never removes one cannot tell those two states
               apart, so this one now razes as well as builds, and the estate
               (sim.js `receiveEstate`) makes the removal a transfer too.
     CEILING   `charterIssued` is every Cinder this city has EVER created as
               founding capital. It must never exceed ECON.firm.charter
               .lifetimeCap, and — the half that stops this round from being
               vacuous — it must actually REACH the cap in this run. A bound
               nothing ever touches proves nothing about a bound.

   And the consequence of the ceiling is asserted rather than assumed: once the
   fund is dry and the treasury cannot cover, a founding is FUNDED SHORT. The
   firm opens with less than it wanted (`seedShort > 0`), keeps existing, and
   nothing is invented to make up the difference.

   Prove this round can fail:
     ECON_TEST_SABOTAGE=seed-mint    re-commits the original bug for one sync
     ECON_TEST_SABOTAGE=charter-cap  pushes the lifetime tally past the ceiling
     ECON_TEST_SABOTAGE=reap-burn    re-commits the DEMOLITION burn for one sync
   ════════════════════════════════════════════════════════════════════════════ */
{
  console.log('\n########## round0e-charter-capital ##########');
  let fails = 0;
  const chk = (name, cond, extra) => {
    if (cond) { console.log('✅ ' + name); return true; }
    fails++; console.log('❌ ' + name + (extra ? ' :: ' + extra : '')); return false;
  };

  if (!global.window) {
    global.window = { MythicCityBridge: { addCinders: async () => {} }, MythicResourceChain: null };
    const chain = await import('../../public/src/resources/chain.js');
    global.window.MythicResourceChain = { ALL: chain.RESOURCE_CHAIN };
  }
  const P = '../../public/src/economy/';
  const E = (await import(P + 'index.js')).default;
  const Sim = await import(P + 'sim.js');
  const { ECON } = await import(P + 'tuning.js');
  const DAY = ECON.clock.dayMin;
  const C = ECON.firm.charter;

  E.mount({ nodeId: 'charter-0', population: 90 });
  const host = { powerFactor: 1, waterFactor: 1, logisticsCounts: { warehouse: 3, depot: 2 },
                 hasBank: true, infrastructure: 0.7 };

  /* 🔴 A BRAND-NEW CITY'S ENTIRE MONEY SUPPLY IS THE CHARTER TRANCHE.
     Households start at 0 savings and the treasury starts at 0 (sim.js reset),
     so before the fix this equality was against a number that fell out of
     however many firms bootstrap happened to seed and what they happened to
     cost. Now it is a stated quantity, and that is the point. */
  const START = E.totalCinder();
  chk('a fresh city holds exactly the bootstrap charter tranche and not a Cinder more',
      Math.abs(START - C.seed) < 1e-6, START.toFixed(2) + ' vs seed ' + C.seed.toFixed(2));
  chk('the bootstrap tranche is counted against the lifetime allowance',
      Math.abs(E.snapshot().charterIssued - C.seed) < 1e-6, String(E.snapshot().charterIssued));

  /* A city that keeps building. Every tile is a real map entry so the founding
     path is the shipped one; the point is the VOLUME, which is what drains the
     allowance and gets us to the ceiling inside a test-sized run. */
  const types = CITY_MAP ? Object.keys(CITY_MAP) : [];
  chk('round0b handed over the real building map', types.length > 0, 'no map — nothing to build');

  const tiles = {};
  const list = () => Object.entries(tiles).map(([k, t]) => {
    const m = CITY_MAP[t.type];
    const o = m ? E.pickAvailable(m.out) : null;
    return o ? { key: k, out: o, ind: m.ind, lvl: 1 } : null;
  }).filter(Boolean);

  let seamTotal = 0, worstSeam = 0, worstSeamAt = '', flows = 0, auditBad = null;
  let overCap = 0, peakIssued = 0, minted = false;
  /* 🪟 THE WINDOW DRAW. `winBase` is the treasury standing when the current
     founding window opened (sim.js arms the allowance at the close of runDay,
     so that is the balance right after a tick; before the very first tick the
     window arms lazily off whatever is there when the first founding draws).
     `winDrawn` is every Cinder foundings have taken out of the treasury since.
     The bound is on the WINDOW — see below for why per-founding was a fiction. */
  let winBase = Sim.state().treasury, winDrawn = 0;
  let worstDrawPct = 0, worstDrawAt = '', drawOver = 0, worstDrawDetail = '';
  /* Set by the demolition phase to the keys about to be removed, so the
     reap-burn sabotage can destroy their cash INSIDE the measured window —
     which is where `Firms.reap()` used to destroy it. Burning it before `t0` is
     read would show up as end-of-run drift instead of as a seam crossing, and
     would be testing the wrong assertion. */
  let RAZE_DOOMED = null, burned = false;
  const sync = (label) => {
    const t0 = E.totalCinder();
    const tre0 = Sim.state().treasury;
    if (SABOTAGE === 'reap-burn' && RAZE_DOOMED && !burned) {
      /* 🧨 THE DEMOLITION BURN, re-committed for exactly one sync: the firms
         about to be reaped have their cash destroyed instead of handed to the
         treasury — precisely what `Firms.reap()` did before `receiveEstate`
         existed, in this same between-tick gap, and with the same spotless
         audit on the following day. */
      let lost = 0;
      for (const k of RAZE_DOOMED) {
        const f = E.firms().find(x => String(x.tileKey) === String(k));
        if (f) { lost += f.cash; f.cash = 0; }
      }
      if (lost > 0) { burned = true;
        console.log('   🧨 destroyed ' + lost.toFixed(2) + ' 🔥 of demolished firms\' cash'); }
    }
    if (SABOTAGE === 'draw-compound') {
      /* 🧨 THE CEILING REMOVED, which is what the per-call clamp amounted to
         once `syncBuildings` founded ten tiles in one pass: each founding got
         its own share of whatever was left, so the "35%" bound multiplied out
         to 1 − 0.65^N. Forcing the budget open reproduces the same end state —
         a single sync draining the treasury the stabilisers run on. */
      Sim.state().foundingDrawBudget = Infinity;
    }
    E.syncBuildings(list());
    const drew = tre0 - Sim.state().treasury;
    if (drew > 0) winDrawn += drew;
    if (winBase > 1e-6) {
      const pct = winDrawn / winBase;
      if (pct > worstDrawPct) {
        worstDrawPct = pct; worstDrawAt = label;
        worstDrawDetail = winDrawn.toFixed(2) + ' 🔥 of a ' + winBase.toFixed(2) + ' 🔥 treasury';
      }
      if (winDrawn > winBase * C.treasuryDrawPct + Math.max(1e-6, winBase * 1e-9)) drawOver++;
    }
    if (SABOTAGE === 'seed-mint' && !minted) {
      /* 🧨 THE ORIGINAL BUG, re-committed for exactly one sync: a firm is
         credited its seed capital and nothing is debited, inside the same
         between-tick gap `syncBuildings` really runs in. */
      const f = E.firms().slice(-1)[0];
      if (f) { f.cash += f.seedWant || 1000; minted = true;
               console.log('   🧨 credited ' + f.name + ' ' + (f.seedWant || 1000).toFixed(2) + ' 🔥 out of nowhere'); }
    }
    const d = E.totalCinder() - t0;
    seamTotal += d;
    if (Math.abs(d) > Math.abs(worstSeam)) { worstSeam = d; worstSeamAt = label; }
    return d;
  };
  const tick = () => {
    E.tick(DAY, host);
    const s = E.snapshot();
    // A tick closes the founding window and opens the next one against `treasury`.
    winBase = s.treasury; winDrawn = 0;
    flows += s.flow.faucet + (s.flow.founding || 0) - s.flow.imports - s.flow.payout;
    if (!s.audit || !s.audit.ok) auditBad = JSON.stringify(s.audit);
    peakIssued = Math.max(peakIssued, s.charterIssued);
    if (s.charterIssued > C.lifetimeCap + 1e-6) overCap++;
  };

  let short = null, key = 0;
  for (let d = 0; d < 120 && types.length; d++) {
    // three new buildings a day: enough churn to spend the allowance in 120 days
    for (let i = 0; i < 3; i++) { tiles[(key++) + ',0'] = { type: types[key % types.length] }; }
    sync('d' + d);
    if (SABOTAGE === 'charter-cap' && d === 60) {
      /* 🧨 A second issuance path that ignores the clamp — the shape of the
         regression the ceiling exists to catch. */
      Sim.state().charterIssued = C.lifetimeCap * 2;
      console.log('   🧨 charterIssued forced to ' + (C.lifetimeCap * 2).toFixed(0) + ' 🔥');
    }
    if (!short) short = E.firms().find(f => (f.seedShort || 0) > 1e-6) || null;
    tick();
  }

  /* ── 🏚 AND NOW THE OTHER DIRECTION ────────────────────────────────────────
     Every sync above ADDED tiles. The burn only happens on REMOVAL, which is
     why it survived a round built to catch exactly this class: `syncBuildings`
     kills the firm on a tile that is gone, and until `receiveEstate` existed
     `Firms.reap()` deleted its cash along with its record. The demolitions are
     measured at the same seam, one sync at a time, and the per-sync bound is
     tighter than the aggregate on purpose — a single razed factory is a single
     large number, not accumulated float noise. */
  const builtTiles = Object.keys(tiles).length;
  const cashBeforeRaze = E.firms().reduce((n, f) => n + f.cash, 0);
  const firmsBeforeRaze = E.snapshot().firms;
  const estateBeforeRaze = E.snapshot().estateReceived || 0;
  let razeSeam = 0, worstRaze = 0, worstRazeAt = '', razed = 0;
  /* 🔬 THE BOUND IS IN ULPS, AND HERE IS WHY — MEASURED, NOT ASSUMED.
     The first draft of this check asserted |Δ| < 1e-9 flat and went RED at
     −1.164e-10 per raze. That was not a leak. `totalCinder()` sums savings +
     every firm's cash + treasury + charter + reserve LEFT TO RIGHT, and reaping
     a firm removes a term from the middle of that sum — so the same money
     re-associates and the last bit of a ~680,000 🔥 double moves. Probed
     directly: naive Δ was ±1.164e-10 or ±2.328e-10 (1–2 ulps; one ulp at that
     magnitude is 1.51e-10) while a KAHAN-compensated sum of the identical terms
     read exactly 0.000e+0 at every single raze. The transfer is exact to the
     bit; only the summation order is not.
     So the ceiling is 8 ulps of the money supply — about 1.2e-9 🔥 on this
     city, five orders below one Cinder and fourteen below the 113,724.82 🔥 the
     reap-burn sabotage pushes across this seam. Widening it to hide a real leak
     is not available: a leak is a firm's whole balance sheet, not a bit. */
  const ULPS = 8;
  let razeTol = 0;
  /* And the claim that owes nothing to floating point at all: every Cinder that
     left the demolished firms ARRIVED in the treasury. Term to term, no sum of
     350 doubles involved. */
  let estateMismatch = [];
  for (let d = 0; d < 20; d++) {
    /* 🔴 THE RICHEST BUSINESSES GO FIRST, deliberately. Razing whatever tile
       happens to be oldest picked near-broke firms and put 1.55 🔥 across the
       seam — a bound that only ever sees small numbers is barely a bound. The
       biggest balance in the city is the largest thing this seam can destroy,
       so that is what gets pushed through it. */
    const doomed = Object.keys(tiles)
      .map(k => ({ k, cash: (E.firms().find(f => String(f.tileKey) === String(k)) || {}).cash || 0 }))
      .sort((a, b) => b.cash - a.cash).slice(0, 3).map(x => x.k);
    if (!doomed.length) break;
    RAZE_DOOMED = doomed;
    const doomedCash = doomed.reduce((n, k) => {
      const f = E.firms().find(x => String(x.tileKey) === String(k));
      return n + (f ? f.cash : 0);
    }, 0);
    const est0 = E.snapshot().estateReceived || 0;
    razeTol = Math.max(razeTol, Math.abs(E.totalCinder()) * ULPS * Number.EPSILON);
    for (const k of doomed) { delete tiles[k]; razed++; }
    const dz = sync('raze' + d);
    RAZE_DOOMED = null;
    const arrived = (E.snapshot().estateReceived || 0) - est0;
    if (Math.abs(arrived - doomedCash) > 1e-9)
      estateMismatch.push('raze' + d + ' held ' + doomedCash.toFixed(6) +
                          ' 🔥, treasury received ' + arrived.toFixed(6));
    razeSeam += dz;
    if (Math.abs(dz) > Math.abs(worstRaze)) { worstRaze = dz; worstRazeAt = 'raze' + d; }
    tick();
  }
  const estateTaken = (E.snapshot().estateReceived || 0) - estateBeforeRaze;

  const END = E.totalCinder();
  const snap = E.snapshot();
  const drift = (END - START) - flows - seamTotal;
  const tol = Math.max(1, Math.abs(END) * 1e-6);

  console.log('\n  🏦 120 days of continuous building, ' + builtTiles + ' tiles placed');
  console.log('     totalCinder     ' + START.toFixed(2) + ' → ' + END.toFixed(2) +
              '   (Δ ' + (END - START).toFixed(2) + ')');
  console.log('     audited flows   ' + flows.toFixed(2) + '   (faucet + founding − imports − payout)');
  console.log('     seam movement   ' + seamTotal.toFixed(2) + '   (worst single sync ' +
              worstSeam.toFixed(2) + (worstSeamAt ? ' at ' + worstSeamAt : '') + ')');
  console.log('     charter issued  ' + snap.charterIssued.toFixed(2) + ' of ' + C.lifetimeCap.toFixed(2) +
              '   (fund holds ' + snap.charter.toFixed(2) + ')');
  console.log('     unexplained     ' + drift.toFixed(6) + '   (tolerance ' + tol.toFixed(4) + ')');
  console.log('     worst window draw ' + (100 * worstDrawPct).toFixed(2) + '% of the treasury' +
              (worstDrawAt ? ' at ' + worstDrawAt : '') + '   (ceiling ' +
              (100 * C.treasuryDrawPct).toFixed(0) + '%' +
              (worstDrawDetail ? ', ' + worstDrawDetail : '') + ')\n');
  console.log('  🏚 then 20 days of demolition, ' + razed + ' tiles razed');
  console.log('     businesses      ' + firmsBeforeRaze + ' → ' + snap.firms +
              '   (held ' + cashBeforeRaze.toFixed(2) + ' 🔥 before the first raze)');
  console.log('     estate received ' + estateTaken.toFixed(2) + ' 🔥 into the treasury');
  console.log('     raze seam       ' + razeSeam.toExponential(3) + '   (worst single raze ' +
              worstRaze.toExponential(3) + (worstRazeAt ? ' at ' + worstRazeAt : '') +
              ', ceiling ' + razeTol.toExponential(3) + ' = ' + ULPS + ' ulps)\n');

  chk('NO CINDER MOVES AT ANY syncBuildings — founding is a transfer, at every seam',
      Math.abs(seamTotal) < 1e-6, 'total ' + seamTotal.toFixed(6) + ', worst ' + worstSeam.toFixed(6) +
      ' at ' + worstSeamAt);
  /* 🔴 THE REMOVAL SEAM, ASSERTED PER SYNC. Prove it can fail with
     ECON_TEST_SABOTAGE=reap-burn. */
  chk('NO CINDER MOVES WHEN A BUILDING IS DEMOLISHED — the estate is a transfer, not a burn',
      Math.abs(worstRaze) <= razeTol && Math.abs(razeSeam) <= razeTol * razed,
      'total ' + razeSeam.toExponential(3) + ', worst ' + worstRaze.toExponential(3) +
      ' at ' + worstRazeAt + ', ceiling ' + razeTol.toExponential(3) + ' (' + ULPS + ' ulps)');
  chk('every Cinder a demolished business held ARRIVED in the treasury — term to term',
      estateMismatch.length === 0, estateMismatch.slice(0, 3).join(' | '));
  /* The non-vacuity half, and it is not optional: "0 moved at every raze" is
     also what a run that razed nothing, or razed only broke firms, would print.
     The demolitions have to have closed real businesses holding real money. */
  chk('the demolitions actually wound up businesses that were HOLDING money',
      razed > 0 && snap.firms < firmsBeforeRaze && estateTaken > 0,
      razed + ' razed, firms ' + firmsBeforeRaze + '→' + snap.firms +
      ', estate ' + estateTaken.toFixed(2) + ' 🔥');
  chk('founding capital NEVER exceeds its lifetime ceiling',
      overCap === 0 && snap.charterIssued <= C.lifetimeCap + 1e-6,
      snap.charterIssued.toFixed(2) + ' issued of ' + C.lifetimeCap + ' (' + overCap + ' days over)');
  chk('the ceiling actually BINDS in this run (a bound nothing touches proves nothing)',
      peakIssued >= C.lifetimeCap - 1e-6, 'peak issued ' + peakIssued.toFixed(2) + ' of ' + C.lifetimeCap);
  chk('every Cinder created for founding is carried in the audited `founding` flow',
      Math.abs(drift) <= tol, 'drift ' + drift.toFixed(6));
  chk('a founding the accounts cannot cover is FUNDED SHORT, not invented',
      !!short && short.cash < short.seedWant && short.rung !== undefined,
      short ? short.name + ' wanted ' + short.seedWant.toFixed(2) + ', got ' + short.cash.toFixed(2) +
              ' (short ' + short.seedShort.toFixed(2) + ')'
            : 'no under-funded firm appeared — the allowance was never exhausted');
  /* 🔴 THE BOUND IS ON THE WINDOW, AND IT HAS TO BE CHECKED HERE BECAUSE THE
     AUDIT CANNOT SEE IT. Founding is a TRANSFER, so a sync that moves the whole
     treasury into ten new firms balances perfectly and the day audit reports
     clean — the money is not minted, it is merely all gone from the account
     that pays unemployment benefit, freight, imports and the player's payout.
     `treasuryDrawPct` was written as the protection against exactly that and
     did not provide it: applied per founding to the balance REMAINING, N tiles
     in one `syncBuildings` pass took 1 − 0.65^N. Measured on the pre-fix tree,
     nine tiles in a single sync took 91.15% (10,000.00 → 885.39 🔥).
     Prove this can fail: ECON_TEST_SABOTAGE=draw-compound. */
  chk('NO founding window takes more than treasuryDrawPct of the treasury, however many tiles found at once',
      drawOver === 0 && worstDrawPct <= C.treasuryDrawPct + 1e-6,
      'worst ' + (100 * worstDrawPct).toFixed(2) + '% at ' + (worstDrawAt || '?') +
      ' (' + worstDrawDetail + '), ceiling ' + (100 * C.treasuryDrawPct).toFixed(0) +
      '%, ' + drawOver + ' window(s) over');
  chk('the day audit stayed clean throughout', !auditBad, auditBad);
  chk('payouts were never suspended', snap.payoutAllowed === true);

  if (fails) { bad++; console.log('\n=== ROUND 0e: ' + fails + ' FAILED ==='); }
  else console.log('\n=== ROUND 0e: ALL PASS ===');
}
/* ════════════════════════════════════════════════════════════════════════════
   ROUND 0f — 🚚 THE BARE-STRING TILE-TYPE BUG CLASS
   ----------------------------------------------------------------------------
   THIS IS THE THIRD TIME THE SAME MISTAKE HAS SHIPPED IN ONE FILE, so this round
   is deliberately NOT a test for the third instance.

     #1  ecoLogisticsCounts() counted only Supply Depots, with a comment claiming
         "Warehouses do not exist as a tile type here yet". `warehouse` had been
         in BUILDINGS all along; every player who built one got none of its 900
         units/day and nothing anywhere said so.
     #2  ecoHost().hasBank tested `t.type === 'bank'` against a tile that is
         `op_bank`. Permanently false ⇒ the entire DEBT rung never executed.
     #3  the fix for #1 was applied to the standing `warehouse` tile only, while
         `op_warehouse` — "Warehouse Co.", a 280,000 🔥 licence whose own
         blueprint says "Its real product is capacity" — went on granting ZERO
         freight. Measured on the live page before the fix: injecting a
         {type:'op_warehouse'} tile left logisticsCounts at {warehouse:3,depot:2}
         and freight at 3600/day; the identical tile typed 'warehouse' gave
         {warehouse:4} and 4500. A 900-unit difference, silent, for 280k.

   A regression test that checks op_warehouse would leave instance #4 to be found
   by a player, so the assertion here is a CLASS INVARIANT, and both sides of it
   are re-derived from the shipped file rather than hand-listed:

     WHO IS A TWIN   op O is the twin of city tile M when OP_BP[O].mesh === M
                     *and* OP_ECO_MAP[O].ind === ECO_BUILDING_MAP[M].ind.
                     🔴 MESH ALONE IS NOT ENOUGH and this is the trap the naive
                        version of this test fell into: `salvage` ("Salvage
                        Operation") also renders on the warehouse mesh, and a
                        mesh-only rule hands a scrap yard 900 units/day of
                        freight the city does not have. The industry is the
                        claim; the geometry is a coincidence.
     THE INVARIANT   for EVERY op type: a city containing one op tile must
                     produce EXACTLY the counts of a city containing its twin
                     when the twin is a logistics tile, and EXACTLY the empty
                     counts otherwise. Add a new twin of a freight tile to
                     OP_BP/OP_ECO_MAP and this round goes red until the guard is
                     taught about it.

   ⚠ THE SHIPPED FUNCTION IS LIFTED AND RUN, not copied — same technique as
     round0d's ecoHost, and for the reason stated there: a copy tests a fiction
     the moment the two drift.

   ────────────────────────────────────────────────────────────────────────────
   §6–§9 WERE ADDED AFTER THE SWEEP THAT FOUND #1–#6 WAS SHOWN TO BE BLIND.
   Every hunt so far grepped `t.type === '…'` (or, for the weather family, a bare
   parameter named `type`). Two more shapes had never been looked at, and both
   were live:

     (a) LIST MEMBERSHIP — `TRUCK_STOPS.includes(t.type)`. Three of that list's
         six entries are derived twins (gasstation↔op_gas, scrapmine↔op_mining,
         fuelrig↔op_oil), so those three operations generated no freight traffic
         and were not truck endpoints. MEASURED LIVE, one probe city (3 roads,
         one housing, two probe tiles): scrapmine gave {commuteDest 2, truckStops
         2, trucks 2} and op_mining gave {3, 3, 0} — 3 being the "no stops at all,
         fall back to every road" answer.
     (b) A LOAD-ORDER SNAPSHOT, a shape nobody had named. `const WORKPLACES =
         Object.keys(BUILDINGS).filter(…)` is a top-level const evaluated ~3,100
         lines ABOVE the ops registration loop, so it froze BUILDINGS before any
         op_ row existed and NO OPERATION COULD EVER BE A COMMUTE DESTINATION.
         MEASURED LIVE: 45 workplace types, 0 of them op_; 60 and 15 after the
         fix, with all 15 op types satisfying the very predicate it filters on.
         There is no string and no list here — the defect is purely WHEN the
         expression ran, which is why §7 asserts on the SHAPE as well as on the
         behaviour.

   §6 and §7 therefore drive the two SHIPPED CONSUMERS — agentEndpoints() and
   desiredAgentCounts() — over a probe city, and fail on the WORST CELL of the
   op × twin sweep rather than on an average or on three lucky points. §8/§9 are
   the same class read backwards: a PRICE WITH NO PRODUCER (ECON.logistics
   .capacity prices `port` and `airfreight` and nothing in the city grants
   either) and a VALUE THAT NAMES NOTHING (a typo in ECO_LOGISTICS_TILES made
   both sides of every existing comparison equally zero and passed).

   Prove this round can fail:
     ECON_TEST_SABOTAGE=no-map      the scrape reads nothing ⇒ hard fail, never a
                                    vacuous pass (same switch round0b/0d honour)
     ECON_TEST_SABOTAGE=twin-blind  drops ECO_LOGISTICS_OPS on the way in, which
                                    is exactly the pre-fix source
     ECON_TEST_SABOTAGE=wx-twin-blind empties the op→standing-tile twin table
                                    §6 reads, which is the pre-fix TRUCK_STOPS
     ECON_TEST_SABOTAGE=stale-workplaces §7: the pre-fix load-order snapshot
     ECON_TEST_SABOTAGE=cap-typo    §9: a mistyped logistics value
   ════════════════════════════════════════════════════════════════════════════ */
{
  console.log('\n########## round0f-tile-type-twins ##########');
  let fails = 0;
  const chk = (name, cond, extra) => {
    if (cond) { console.log('✅ ' + name); return true; }
    fails++; console.log('❌ ' + name + (extra ? ' :: ' + extra : '')); return false;
  };

  let HTML = null;
  try {
    HTML = readFileSync(join(here, SABOTAGE === 'no-map'
      ? '../../public/node-city/THIS-FILE-DOES-NOT-EXIST.html'
      : '../../public/node-city/index.html'), 'utf8');
  } catch (e) { HTML = null; }

  /* Every one of these is brace-matched out of the shipped file. `new Function`
     parses the block natively — prose comments and all — so no regex here has to
     understand JavaScript, only to find a declaration. */
  const lit = (decl) => {
    const txt = srcBlockAfter(HTML, decl);
    if (!txt) return null;
    try { return new Function('return (' + txt + ');')(); } catch (e) { return null; }
  };
  /* Markers stop at the IDENTIFIER — srcBlockAfter takes the next `{` — so
     re-aligning the `=` in the shipped file cannot silently un-read a table.
     That is not hypothetical: ECO_LOGISTICS_OPS is column-aligned today. */
  /* 0h's evaluator: a `with` over a Proxy answering 0 to every free identifier.
     BUILDINGS is the only table that needs it, because its rows cite constants
     declared elsewhere. §7 reads `crew`/`gen`/`defense` off it and those are
     literals; a stubbed cost cannot fake one. */
  const loose = (decl) => {
    const txt = srcBlockAfter(HTML, decl);
    if (!txt) return null;
    try {
      const scope = new Proxy({}, { has: () => true,
        get: (t, k) => (k === Symbol.unscopables ? undefined : 0) });
      return new Function('__s', 'with (__s) { return (' + txt + '); }')(scope);
    } catch (e) { return null; }
  };
  /* Array literals have no `{`, so srcBlockAfter cannot reach them — and a LIST
     is half of what this round now exists to check. Non-greedy to the first `]`,
     which is exact for a flat list of strings and returns null rather than a
     guess for anything nested. */
  const arrLit = (name) => {
    const m = HTML ? new RegExp('const\\s+' + name + '\\s*=\\s*(\\[[^\\]]*\\])\\s*;').exec(HTML) : null;
    if (!m) return null;
    try { const v = new Function('return (' + m[1] + ');')(); return Array.isArray(v) ? v : null; }
    catch (e) { return null; }
  };
  /* Comments are prose in this file and full of the very identifiers §6 greps
     for ("`TRUCK_STOPS.includes(t.type)`" appears in two headers describing the
     bug). A structural check that counts them is a check that can never go
     green, so strip them — same scanner discipline as srcBlockAfter, strings
     preserved because the guard lists ARE strings. */
  const stripComments = (src) => {
    if (!src) return '';
    let out = '', last = '';                 // last significant char, for regex/division
    for (let i = 0; i < src.length; i++) {
      const c = src[i], d = src[i + 1];
      if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) break; i = e + 1; continue; }
      if (c === '/' && d === '/') { const e = src.indexOf('\n', i + 2); if (e < 0) break; out += '\n'; i = e; continue; }
      /* 🔴 REGEX LITERALS, or this scanner desynchronises and never recovers.
         node-city is full of `/['"]op_[a-z]/`-shaped tests; a `/` that is not a
         comment used to be emitted raw, the apostrophe inside it opened a
         phantom string, and every block comment for the next 200k characters
         survived into "code". The standard disambiguator: a `/` starts a regex
         only when the previous significant character cannot end an expression. */
      if (c === '/' && (last === '' || '(,=:[!&|?{};+-*%~^<>'.includes(last))) {
        out += c; i++;
        for (let cls = false; i < src.length; i++) {
          const r = src[i]; out += r;
          if (r === '\\') { out += src[++i]; continue; }
          if (r === '[') cls = true; else if (r === ']') cls = false;
          else if (r === '/' && !cls) break;
          else if (r === '\n') break;         // unterminated ⇒ it was division
        }
        last = '/'; continue;
      }
      if (c === '"' || c === "'") {
        /* Bounded to one line. A single-quoted JS string cannot span a newline,
           so if no closing quote appears before it this was not a string at all
           and treating it as one is exactly how the desync happened. */
        const nl = src.indexOf('\n', i);
        let j = i + 1, closed = -1;
        for (; j < src.length && (nl < 0 || j < nl); j++) {
          if (src[j] === '\\') { j++; continue; }
          if (src[j] === c) { closed = j; break; }
        }
        if (closed < 0) { out += c; last = c; continue; }
        out += src.slice(i, closed + 1); i = closed; last = c; continue;
      }
      if (c === '`') {
        let j = i + 1;
        for (; j < src.length; j++) { if (src[j] === '\\') { j++; continue; } if (src[j] === '`') break; }
        out += src.slice(i, j + 1); i = j; last = '`'; continue;
      }
      out += c;
      if (!/\s/.test(c)) last = c;
    }
    return out;
  };

  const OP_BP        = lit('const OP_BP');
  const OP_ECO_MAP   = lit('const OP_ECO_MAP');
  const CITY_ECO_MAP = lit('const ECO_BUILDING_MAP');
  const LOG_TILES_RAW= lit('const ECO_LOGISTICS_TILES');
  /* The mistyped value the `cap-typo` switch injects. It is deliberately a
     PLAUSIBLE typo of a real key, because that is the failure §9 exists for. */
  const LOG_TILES    = SABOTAGE === 'cap-typo'
    ? { ...LOG_TILES_RAW, railyard: 'railheed' } : LOG_TILES_RAW;
  const LOG_OPS_RAW  = lit('const ECO_LOGISTICS_OPS');
  const LOG_OPS      = SABOTAGE === 'twin-blind' ? {} : LOG_OPS_RAW;
  const LOG_UNIMPL   = arrLit('ECO_LOGISTICS_UNIMPLEMENTED');
  const BODY         = srcBlockAfter(HTML, 'function ecoLogisticsCounts()');
  const prefixM      = HTML ? /const\s+OPS_PREFIX\s*=\s*'([^']*)'/.exec(HTML) : null;
  const PREFIX       = prefixM ? prefixM[1] : null;
  /* ⚠ THE MODULE SCRIPT ONLY, not the whole file. node-city is an HTML document
     and its prose is full of apostrophes ("the city's"); fed the markup, the
     stripper takes the first one as a string opener and desynchronises — which
     it did, silently, and §7 then "found" a WORKPLACES snapshot inside the very
     comment that describes the bug. The self-check below is the guard: a
     correctly stripped source contains no `/*` at all. */
  const jsAt        = HTML ? HTML.indexOf('<script type="module">') : -1;
  const SRC         = jsAt >= 0 ? stripComments(HTML.slice(jsAt)) : '';

  // ── §6/§7 scaffolding: the shipped agent guards and everything they reach ──
  const BUILDINGS_RAW = loose('const BUILDINGS');
  const REG_BODY      = srcBlockAfter(HTML, 'for (const t of OPS_TYPES)');
  const WX_TWIN_RAW   = lit('const WEATHER_TWIN_OPS');
  const WX_TWIN       = SABOTAGE === 'wx-twin-blind' ? {} : WX_TWIN_RAW;
  const AGENTS_LIT    = lit('const AGENTS');
  const WEATHER_LIT   = lit('const WEATHER');
  const TRUCK_STOPS   = arrLit('TRUCK_STOPS');
  const FN = {};
  for (const [k, decl] of Object.entries({
    weatherTwinType: 'function weatherTwinType(type)', twinTileType: 'function twinTileType(type)',
    isTruckStop: 'function isTruckStop(ty)', workplaceTypes: 'function workplaceTypes()',
    tileAt: 'function tileAt(x, z)', isRoad: 'function isRoad(x, z)',
    allRoadKeys: 'function allRoadKeys()', roadsAdjacentTo: 'function roadsAdjacentTo(match)',
    roadsAdjacentToTypes: 'function roadsAdjacentToTypes(types)',
    roadsAdjacentToAnchors: 'function roadsAdjacentToAnchors()',
    agentEndpoints: 'function agentEndpoints(kind, agent)',
    desiredAgentCounts: 'function desiredAgentCounts()',
  })) FN[k] = srcBlockAfter(HTML, decl);

  /* 🔴 A SCRAPE THAT MATCHED NOTHING MUST FAIL HARD. Round0b's header makes the
     same point: the failure mode of an extraction test is not a wrong answer,
     it is a green run over an empty set. If a declaration was renamed, rename
     the marker — do not let this round pass quietly. */
  const got =
    chk('read ecoLogisticsCounts() out of node-city/index.html',
        !!BODY && BODY.indexOf('ECO_LOGISTICS_TILES') > 0,
        BODY ? BODY.length + ' chars, no table lookup in it' : 'UNREADABLE or unbalanced') &
    chk('read OP_BP / OP_ECO_MAP / ECO_BUILDING_MAP / the two logistics tables',
        !!OP_BP && !!OP_ECO_MAP && !!CITY_ECO_MAP && !!LOG_TILES && !!LOG_OPS_RAW,
        [OP_BP, OP_ECO_MAP, CITY_ECO_MAP, LOG_TILES, LOG_OPS_RAW].map(o => o ? Object.keys(o).length : 'NULL').join('/')) &
    chk('read OPS_PREFIX', !!PREFIX, String(PREFIX)) &
    chk('read ECO_LOGISTICS_UNIMPLEMENTED (§8 needs the explicit declaration, not a guess)',
        Array.isArray(LOG_UNIMPL), String(LOG_UNIMPL)) &
    chk('read the twelve shipped agent guards + BUILDINGS + AGENTS + WEATHER + TRUCK_STOPS + the ops loop',
        Object.values(FN).every(Boolean) && !!BUILDINGS_RAW && !!REG_BODY && !!AGENTS_LIT &&
        !!WEATHER_LIT && !!WX_TWIN_RAW && Array.isArray(TRUCK_STOPS),
        Object.entries(FN).filter(([, v]) => !v).map(([k]) => k).join(',') + ' | ' +
        [BUILDINGS_RAW, REG_BODY, AGENTS_LIT, WEATHER_LIT, WX_TWIN_RAW, TRUCK_STOPS]
          .map(o => o ? 'ok' : 'NULL').join('/')) &
    chk('the comment stripper left real code behind AND removed every block comment ' +
        '(a desynced stripper reads prose as code — it did, once)',
        SRC.length > 200000 && SRC.indexOf('function ecoLogisticsCounts()') > 0 && SRC.indexOf('/*') < 0,
        SRC.length + ' chars, first surviving /* at ' + SRC.indexOf('/*') +
        ' :: ' + SRC.slice(Math.max(0, SRC.indexOf('/*')), SRC.indexOf('/*') + 90));

  if (!got) {
    console.log('\n🔴 ecoLogisticsCounts() COULD NOT BE READ — nothing below was checked.');
    bad++; console.log('\n=== ROUND 0f: ' + fails + ' FAILED ===');
  } else {
    const CAP = (await import('../../public/src/economy/tuning.js')).ECON.logistics.capacity;
    /* ⚠ COPIED VERBATIM from node-city (`const bldSite = t => …`), same as
       round0c and round0d and for the same reason — a const arrow cannot be
       imported out of an HTML module script. If it drifts, round0c fails first. */
    const bldSite = t => !!(t && t.bld && t.bld.k === 0);
    const opsKeyOf = ty => PREFIX + ty;

    /* The shipped function, handed everything it reaches for. LOG_OPS is passed
       in so the sabotage switch can blind it without editing the shipped file. */
    const run = (tiles) => {
      const names = ['game', 'bldSite', 'opsKeyOf', 'NODE_TYPES',
                     'ECO_LOGISTICS_TILES', 'ECO_LOGISTICS_OPS'];
      const fn = new Function(...names,
        'return (function ecoLogisticsCounts() ' + BODY + ')();');
      return fn({ tiles }, bldSite, opsKeyOf, {}, LOG_TILES, LOG_OPS);
    };
    const freight = (c) => Object.keys(c).reduce((s, k) => s + (CAP[k] || 0) * c[k], 0);
    const one = (t) => run(t ? { '9,9': t } : {});
    const EMPTY = one(null);
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    // ── 1. THE INSTANCE, before and after ────────────────────────────────────
    /* 🐛 THE SHIPPED PREDICATE, WRITTEN OUT. A green test that has only ever
       seen the fixed code cannot tell you the bug was real. */
    const PRE_FIX = (ty) => ty === 'warehouse' ? 1 : 0;
    const OPW = opsKeyOf('warehouse');
    chk("BEFORE: `t.type === 'warehouse'` scores the 280,000 🔥 Warehouse Co. at ZERO",
        PRE_FIX(OPW) === 0, OPW);
    const opCounts = one({ type: OPW, lvl: 1 });
    chk('AFTER: one ' + OPW + ' grants exactly one warehouse of capacity',
        opCounts.warehouse === 1 && freight(opCounts) - freight(EMPTY) === CAP.warehouse,
        JSON.stringify(opCounts) + ' Δfreight=' + (freight(opCounts) - freight(EMPTY)));
    chk('…the SAME counts as the standing twin, level for level',
        same(one({ type: OPW, lvl: 3 }), one({ type: 'warehouse', lvl: 3 })),
        JSON.stringify(one({ type: OPW, lvl: 3 })) + ' vs ' + JSON.stringify(one({ type: 'warehouse', lvl: 3 })));

    // ── 2. 🏗 CONSTRUCTION CONSISTENCY, on the op exactly as on the tile ─────
    const now = Date.now();
    chk('🏗 a SITE Warehouse Co. grants nothing (a hole in the ground stores nothing)',
        same(one({ type: OPW, lvl: 1, bld: { k: 0, l: 1, s: now, d: 900 } }), EMPTY));
    chk('an UPGRADING Warehouse Co. still grants (bldSite, not bldBusy — WP4)',
        same(one({ type: OPW, lvl: 1, bld: { k: 1, l: 2, s: now, d: 900 } }), one({ type: OPW, lvl: 1 })));
    chk('a DAMAGED Warehouse Co. grants nothing', same(one({ type: OPW, lvl: 1, damaged: true }), EMPTY));

    // ── 3. THE KEY IS DERIVED, NOT TYPED ────────────────────────────────────
    chk("the shipped function contains NO hardcoded 'op_…' literal",
        !/['"]op_[a-z]/.test(BODY), (BODY.match(/['"]op_[a-z][a-z_]*['"]/g) || []).join(','));
    chk('the op keys go through opsKeyOf()', /opsKeyOf\s*\(/.test(BODY));
    chk("the tables are keyed by OP TYPE, not tile type — no 'op_' key in ECO_LOGISTICS_OPS",
        Object.keys(LOG_OPS_RAW).every(k => k.indexOf(PREFIX) !== 0), Object.keys(LOG_OPS_RAW).join(','));

    // ── 4. THE CLASS INVARIANT — derived, never hand-listed ─────────────────
    /* twin = same mesh AND same industry. See the header for why mesh alone is
       the trap and not the rule. */
    const twinOf = (op) => {
      const mesh = (OP_BP[op] || {}).mesh;
      if (!mesh || !CITY_ECO_MAP[mesh]) return null;
      const oi = (OP_ECO_MAP[op] || {}).ind, ci = CITY_ECO_MAP[mesh].ind;
      return (oi && oi === ci) ? mesh : null;
    };
    const expectFreight = [], expectNone = [];
    for (const op of Object.keys(OP_BP)) {
      const twin = twinOf(op);
      (twin && LOG_TILES[twin] ? expectFreight : expectNone).push(op);
    }
    chk('the twin derivation is not vacuous: it finds at least one freight twin',
        expectFreight.length > 0, 'freight twins: ' + expectFreight.join(','));
    console.log('   ↳ derived freight twins: [' + expectFreight.join(', ') +
                ']  ·  must grant nothing: [' + expectNone.join(', ') + ']');

    let missed = [], overcredited = [];
    for (const op of expectFreight) {
      const ty = opsKeyOf(op);
      if (!same(one({ type: ty, lvl: 2 }), one({ type: twinOf(op), lvl: 2 })))
        missed.push(op + ' → ' + JSON.stringify(one({ type: ty, lvl: 2 })) +
                    ' but its twin ' + twinOf(op) + ' → ' + JSON.stringify(one({ type: twinOf(op), lvl: 2 })));
    }
    for (const op of expectNone) {
      const ty = opsKeyOf(op);
      if (!same(one({ type: ty, lvl: 2 }), EMPTY))
        overcredited.push(op + ' → ' + JSON.stringify(one({ type: ty, lvl: 2 })));
    }
    chk('🔴 EVERY derived freight twin is credited exactly like its standing tile — ' +
        'THE CLASS, not the instance', missed.length === 0, missed.join(' | '));
    chk('…and no other operation is credited any freight at all (salvage shares the ' +
        'warehouse MESH and must still get nothing)', overcredited.length === 0, overcredited.join(' | '));

    // ── 5. PROTOTYPE POLLUTION, the other way a bare lookup lies ────────────
    chk("a tile typed 'constructor' is not credited as a logistics building",
        same(one({ type: 'constructor', lvl: 1 }), EMPTY), JSON.stringify(one({ type: 'constructor', lvl: 1 })));

    /* ══ §6/§7 — THE TWO SHAPES THE `t.type === '…'` SWEEP CANNOT SEE ═══════
       The SHIPPED consumers are assembled and run over a probe city. Nothing
       here is a copy of a guard: agentEndpoints, desiredAgentCounts, the two
       road-adjacency helpers, isTruckStop, workplaceTypes and the twin resolver
       are all lifted from node-city, and the ops REGISTRATION LOOP is lifted
       too — "no op_ row exists yet" is the load-bearing half of §7 and a
       hand-built BUILDINGS here would be asserting about a fiction.
       ⚠ COPIED VERBATIM, and only these: `key`, `NEI` (a const arrow and a const
         array — srcBlockAfter needs a `{`, and neither carries a tile-type
         comparison to get wrong). Same concession round0c/0d/0f make for
         `bldSite`, for the same stated reason. */
    const buildGuards = (BLD) => {
      const city = { tiles: {}, anchors: [] };
      const api = new Function(
        'game', 'bldSite', 'opsKeyOf', 'OPS_TYPES', 'BUILDINGS', 'TRUCK_STOPS',
        'POLICE_SOURCES', 'WEATHER_TWIN_OPS', 'WEATHER', 'wx', 'wellbeing', 'AGENTS',
        'let nightAmt = 0;\nlet _wxTwinTypes = null;\nlet _workplaceTypes = null;\n' +
        "const key = (x, z) => x + ',' + z;\nconst NEI = [[0,-1],[1,0],[0,1],[-1,0]];\n" +
        Object.entries(FN).map(([k, b]) => {
          const args = { weatherTwinType: 'type', twinTileType: 'type', isTruckStop: 'ty',
            workplaceTypes: '', tileAt: 'x, z', isRoad: 'x, z', allRoadKeys: '',
            roadsAdjacentTo: 'match', roadsAdjacentToTypes: 'types', roadsAdjacentToAnchors: '',
            agentEndpoints: 'kind, agent', desiredAgentCounts: '' }[k];
          return 'function ' + k + '(' + args + ') ' + b + '\n';
        }).join('') +
        'return { agentEndpoints, desiredAgentCounts, isTruckStop, workplaceTypes, twinTileType };')
        (city, bldSite, opsKeyOf, Object.keys(OP_BP), BLD, TRUCK_STOPS,
         arrLit('POLICE_SOURCES') || [], WX_TWIN, WEATHER_LIT, { type: 'clear' },
         { morale: 50 }, AGENTS_LIT);
      /* THE PROBE CITY. Three road tiles, not four: desiredAgentCounts() floors
         trucks at 1 once `roads >= 4` ("ambient street life"), and a floor is
         exactly the kind of thing that turns a broken guard green. Two probe
         tiles so the truck endpoint set can reach 2 and skip the `stops.length
         < 2 ⇒ use every road` fallback — with one tile the fallback answer and
         the correct answer are both "some roads" and nothing is measured. */
      api.probe = (ty) => {
        for (const k of Object.keys(city.tiles)) delete city.tiles[k];
        for (let x = 1; x <= 3; x++) city.tiles[x + ',5'] = { type: 'road', lvl: 1, bld: null };
        city.tiles['2,6'] = { type: 'housing', lvl: 1, bld: null };
        if (ty) { city.tiles['1,4'] = { type: ty, lvl: 1, bld: null };
                  city.tiles['3,4'] = { type: ty, lvl: 1, bld: null }; }
        return { commuteDest: api.agentEndpoints('civilian').to.length,
                 truckStops: api.agentEndpoints('truck').to.length,
                 trucks: api.desiredAgentCounts().truck };
      };
      return api;
    };
    /* Two BUILDINGS: one the registration loop has run over, one it has not.
       The second IS the pre-fix world and the `stale-workplaces` switch keeps
       it — a fix whose old behaviour cannot be reproduced cannot be shown to
       have been needed. */
    const mkBld = (registered) => {
      const B = loose('const BUILDINGS');
      if (registered) new Function('OPS_TYPES', 'OP_BP', 'BUILDINGS', 'opsKeyOf', 'BUILD_ORDER',
        'OP_ECO_MAP', 'ECO_BUILDING_MAP', 'for (const t of OPS_TYPES) ' + REG_BODY)
        (Object.keys(OP_BP), OP_BP, B, opsKeyOf, [], OP_ECO_MAP, { ...CITY_ECO_MAP });
      return B;
    };
    const BLD_POST = mkBld(true), BLD_PRE = mkBld(false);
    const G = buildGuards(SABOTAGE === 'stale-workplaces' ? BLD_PRE : BLD_POST);
    const CONTROL = G.probe(null);          // no probe tile: the fallback answer

    // ── 6. 📋 LIST-SHAPED GUARDS — the shape no `===` grep prints ───────────
    console.log('   ↳ probe city control (no probe tile) = ' + JSON.stringify(CONTROL) +
                '  — every number here is the "fall back to every road" answer');
    /* Every top-level SCREAMING_CASE array of standing building types is a guard
       list by construction, discovered rather than hand-listed so a future one
       is armed the day it is written. */
    const guardLists = [];
    for (const m of SRC.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*(\[[^\]]*\])\s*;/g)) {
      let v = null; try { v = new Function('return (' + m[2] + ');')(); } catch (e) { v = null; }
      if (!Array.isArray(v) || v.length < 2) continue;
      if (!v.every(s => typeof s === 'string' && s.indexOf(PREFIX) !== 0 && BLD_PRE[s])) continue;
      /* 🚫 REGISTRIES ARE NOT GUARDS. BUILD_ORDER starts life as a list of
         standing types and is then APPENDED TO by the ops registration loop, so
         it satisfies the shape above and has ten op twins in it — and it is not
         a guard at all, it is the build menu. A list the ops loop extends has
         already been taught about operations by construction. */
      if (new RegExp('\\b' + m[1] + '\\s*\\.\\s*push\\s*\\(').test(SRC)) {
        console.log('   ↳ ' + m[1] + ' is a REGISTRY (the ops loop pushes into it), not a guard list — skipped');
        continue;
      }
      guardLists.push({ name: m[1], list: v });
    }
    chk('found the LIST-shaped guards at all (a discovery that matches nothing passes vacuously)',
        guardLists.length > 0, guardLists.map(g => g.name).join(','));
    for (const g of guardLists) {
      g.twins = Object.keys(OP_BP).filter(o => twinOf(o) && g.list.includes(twinOf(o)));
      console.log('   ↳ guard list ' + g.name + ' = [' + g.list.join(', ') + ']  ·  op twins in it: [' +
                  (g.twins.join(', ') || 'NONE — exempt until one appears') + ']');
    }
    /* THE STRUCTURAL HALF. A list whose set contains an op twin may not be read
       by a bare membership test anywhere in the file. This is what generalises:
       it fires for a list this round has never heard of. */
    const rawUse = [];
    for (const g of guardLists) {
      if (!g.twins.length) continue;
      for (const m of SRC.matchAll(new RegExp('\\b' + g.name + '\\s*\\.\\s*(includes|indexOf)\\s*\\(([^)]*\\)?[^)]*)\\)', 'g')))
        if (!/twinTileType\s*\(/.test(m[2])) rawUse.push(g.name + '.' + m[1] + '(' + m[2].trim() + ')');
      for (const m of SRC.matchAll(new RegExp('roadsAdjacentToTypes\\s*\\(\\s*' + g.name + '\\s*\\)', 'g')))
        rawUse.push(m[0]);
    }
    chk('🔴 no guard list with an op twin is read by a BARE membership test — THE CLASS',
        rawUse.length === 0, rawUse.join(' | '));
    /* THE BEHAVIOURAL HALF, swept, failing on the WORST CELL. */
    const measured = {}, meas = (ty) => (measured[ty] = measured[ty] || G.probe(ty));
    let worstList = null;
    for (const op of Object.keys(OP_BP)) {
      const tw = twinOf(op); if (!tw) continue;
      const a = meas(opsKeyOf(op)), b = meas(tw);
      if (JSON.stringify(a) !== JSON.stringify(b) && !worstList)
        worstList = opsKeyOf(op) + ' ' + JSON.stringify(a) + '  vs its twin ' + tw + ' ' + JSON.stringify(b);
    }
    chk("🔴 EVERY derived twin is the SAME truck source and the same endpoint as its " +
        'standing tile, measured through the shipped agentEndpoints/desiredAgentCounts',
        !worstList, 'WORST CELL — ' + worstList);
    console.log('   ↳ ' + Object.keys(OP_BP).filter(o => G.isTruckStop(opsKeyOf(o))).map(opsKeyOf).join(', ') +
                ' generate freight;  standing truck stops: ' + TRUCK_STOPS.join(', '));
    chk('BEFORE: the raw list scores all three freight operations at ZERO',
        !['mining', 'oil', 'gas'].some(o => TRUCK_STOPS.includes(opsKeyOf(o))));

    // ── 7. 🕒 THE LOAD-ORDER SNAPSHOT ───────────────────────────────────────
    /* THE SHAPE. Any top-level `const X = Object.keys(BUILDINGS)…` declared
       ABOVE the registration loop has this bug automatically, whatever it is
       called and whatever it filters on — so the assertion is about position,
       not about WORKPLACES. */
    const regAt = SRC.indexOf('for (const t of OPS_TYPES)');
    const snaps = [];
    /* ⚠ ANCHORED AT COLUMN 0 (`^` with /m). That is what "top-level" means in
       this file, and it is the whole distinction: workplaceTypes()'s own
       `const list = Object.keys(BUILDINGS)…` is INDENTED and runs per call,
       which is the fix. Without the anchor this check reports the fix as the
       bug — it did on the first run. */
    for (const m of SRC.matchAll(/^const\s+(\w+)\s*=\s*Object\.(keys|values|entries)\s*\(\s*BUILDINGS\s*\)/gm))
      if (m.index < regAt) snaps.push(m[1] + ' at char ' + m.index + ' (registration loop at ' + regAt + ')');
    chk('🔴 no top-level Object.keys(BUILDINGS) snapshot is taken ABOVE the ops registration ' +
        'loop — THE SHAPE, not the instance', regAt > 0 && snaps.length === 0, snaps.join(' | '));
    const WP = G.workplaceTypes();
    const wpOps = Object.keys(OP_BP).filter(o => WP.includes(opsKeyOf(o)));
    console.log('   ↳ workplace types: ' + WP.length + ', of which operations: ' + wpOps.length +
                '/' + Object.keys(OP_BP).length);
    chk('every operation whose blueprint gives it crew is a WORKPLACE (the snapshot had none of them)',
        wpOps.length === Object.keys(OP_BP).length,
        Object.keys(OP_BP).filter(o => !WP.includes(opsKeyOf(o))).join(','));
    /* PARITY, swept, worst cell. An op that shipped with crew:0 beside a twin
       that has crew turns this red — the untaught-op case. */
    let worstWp = null;
    for (const op of Object.keys(OP_BP)) {
      const tw = twinOf(op); if (!tw) continue;
      const a = WP.includes(opsKeyOf(op)), b = WP.includes(tw);
      if (a !== b && !worstWp) worstWp = opsKeyOf(op) + '=' + a + ' vs twin ' + tw + '=' + b;
    }
    chk('…and an operation is a commute destination exactly when its standing twin is',
        !worstWp, 'WORST CELL — ' + worstWp);
    let worstDest = null;
    for (const op of Object.keys(OP_BP)) {
      const a = meas(opsKeyOf(op));
      if (a.commuteDest === CONTROL.commuteDest && !worstDest)
        worstDest = opsKeyOf(op) + ' ' + JSON.stringify(a) + ' — identical to the no-workplace fallback';
    }
    chk('…and the shipped agentEndpoints() really routes commuters to each one',
        !worstDest, 'WORST CELL — ' + worstDest);
    /* THE MEMO TRAP, the same one weatherTwinType()/isMoraleVenue() carry: an
       answer computed before the ops exist must not be cached, or "operations
       are not workplaces" becomes permanently true. */
    const preG = buildGuards(BLD_PRE);
    const preCount = preG.workplaceTypes().length;
    chk('BEFORE: the pre-registration BUILDINGS yields a workplace set with NO operation in it',
        preCount < WP.length && !preG.workplaceTypes().some(t => t.indexOf(PREFIX) === 0),
        preCount + ' types vs ' + WP.length);

    // ── 8. 🚢 THE CLASS BACKWARDS: A PRICE WITH NO PRODUCER ─────────────────
    /* Sweep every building type in the game plus the anchor branch through the
       shipped counter and collect which capacity kinds anything can actually
       grant. `port` (8,800/day) and `airfreight` (2,100/day) are granted by
       nothing, so node-city declares them unimplemented and this checks the
       declaration against reality rather than trusting it. */
    const reach = new Set();
    const probes = Object.keys(BLD_POST).map(ty => ({ type: ty, lvl: 1 }))
      .concat([{ type: 'anchor', lvl: 1, anchor: { node: { node_type: '__t' } } }]);
    for (const p of probes) {
      const fn = new Function('game', 'bldSite', 'opsKeyOf', 'NODE_TYPES', 'ECO_LOGISTICS_TILES',
        'ECO_LOGISTICS_OPS', 'return (function ecoLogisticsCounts() ' + BODY + ')();');
      const c = fn({ tiles: { '9,9': p } }, bldSite, opsKeyOf,
                   { __t: { feeds: ['__roads__'] } }, LOG_TILES, LOG_OPS);
      for (const k in c) if (c[k] > 0) reach.add(k);
    }
    console.log('   ↳ capacity kinds reachable from some tile: [' + [...reach].join(', ') +
                ']  ·  declared unimplemented: [' + LOG_UNIMPL.join(', ') + ']');
    const orphanCap = Object.keys(CAP).filter(k => !reach.has(k) && !LOG_UNIMPL.includes(k));
    chk('🔴 every key of ECON.logistics.capacity is reachable from some tile, or is ' +
        'explicitly declared unimplemented', orphanCap.length === 0,
        orphanCap.map(k => k + ' priced at ' + CAP[k] + '/day and granted by nothing').join(', '));
    chk('…and nothing REACHABLE is hiding on the unimplemented list (it cannot be used to ' +
        'silence a live kind)', !LOG_UNIMPL.some(k => reach.has(k)),
        LOG_UNIMPL.filter(k => reach.has(k)).join(','));
    chk('…and the unimplemented list names only real capacity keys',
        LOG_UNIMPL.every(k => k in CAP), LOG_UNIMPL.filter(k => !(k in CAP)).join(','));

    // ── 9. 💥 A VALUE THAT NAMES NOTHING ────────────────────────────────────
    /* ecoLogisticsCounts()'s own header requires every value of the two tables
       to be a capacity kind, and NOTHING CHECKED IT. A typo ('railheed') makes
       the count land on a key ECON does not price, so it contributes 0 — and
       every comparison in §1–§4 stays green because both sides are equally
       zero. That is the same failure mode as a test that samples three points. */
    const badVal = Object.entries(LOG_TILES).concat(Object.entries(LOG_OPS_RAW))
      .filter(([, v]) => !(v in CAP)).map(([k, v]) => k + ' → ' + v);
    chk('🔴 every VALUE of ECO_LOGISTICS_TILES/ECO_LOGISTICS_OPS is a priced kind in ' +
        'ECON.logistics.capacity', badVal.length === 0,
        badVal.join(', ') + ' — priced kinds are [' + Object.keys(CAP).join(', ') + ']');

    if (fails) { bad++; console.log('\n=== ROUND 0f: ' + fails + ' FAILED ==='); }
    else console.log('\n=== ROUND 0f: ALL PASS ===');
  }
}
/* ════════════════════════════════════════════════════════════════════════════
   ROUND 0g — 🏟 THE SAME BUG CLASS, IN THE PRODUCTION MULTIPLIER
   ----------------------------------------------------------------------------
   Round 0f pinned the class down in ecoLogisticsCounts(). It is a FILE-WIDE
   class, not a function-wide one, and the sweep that followed the freight fix
   found a fourth live instance in tileMult():

       if (t.type === 'arena') m *= Math.max(.3, wellbeing.morale / 50);

   `op_dojo` — the Dojo operation, 150,000 🔥, OP_BP mesh 'arena', OP_ECO_MAP
   `ind: 'venue'`, row commented `// ↔ arena` — never matched, so it never felt
   morale at all. Measured on the live page at morale 49: arena ×0.982 with the
   "😊 City morale 49 — crowds follow it" row in its inspector; op_dojo ×1.000
   with no such row.

   ⚠ THE FIRST SWEEP WROTE THIS OFF WITH A FALSE REASON — "operations have no
     `gen`, so there is nothing for tileMult to scale". Both halves are wrong,
     and this round asserts the truth of both so the excuse cannot be made
     again:
       · the production loop admits a tile on
         `def.gen || def.use || def.svc || LEGACY_SERVICE[t.type]`, and
       · every op in OP_BP carries `use` and/or `svc`,
     therefore tileMult IS evaluated for every operation, and its result scales
     the op's input draw and the coverage its `svc` supplies.

   THE CLASS INVARIANT, re-derived from the shipped file, never hand-listed:
     twin(op) = OP_BP[op].mesh, when that mesh is a real city building AND
                OP_ECO_MAP[op].ind === ECO_BUILDING_MAP[mesh].ind.
                (Mesh alone is the trap — see round0f's header.)
     For every op: isMoraleVenue(opsKeyOf(op)) must be TRUE exactly when its
     twin is one of the standing tiles isMoraleVenue() seeds itself with, and
     FALSE otherwise. Give any future operation the `venue` industry on the
     arena mesh and this round goes red until the guard is taught about it.

   Prove this round can fail:
     ECON_TEST_SABOTAGE=no-map       the scrape reads nothing ⇒ hard fail
     ECON_TEST_SABOTAGE=venue-blind  empties MORALE_VENUE_OPS on the way in,
                                     which is exactly the pre-fix source
   ════════════════════════════════════════════════════════════════════════════ */
{
  console.log('\n########## round0g-morale-venue-twins ##########');
  let fails = 0;
  const chk = (name, cond, extra) => {
    if (cond) { console.log('✅ ' + name); return true; }
    fails++; console.log('❌ ' + name + (extra ? ' :: ' + extra : '')); return false;
  };

  let HTML = null;
  try {
    HTML = readFileSync(join(here, SABOTAGE === 'no-map'
      ? '../../public/node-city/THIS-FILE-DOES-NOT-EXIST.html'
      : '../../public/node-city/index.html'), 'utf8');
  } catch (e) { HTML = null; }

  const lit = (decl) => {
    const txt = srcBlockAfter(HTML, decl);
    if (!txt) return null;
    try { return new Function('return (' + txt + ');')(); } catch (e) { return null; }
  };
  const OP_BP        = lit('const OP_BP');
  const OP_ECO_MAP   = lit('const OP_ECO_MAP');
  const CITY_ECO_MAP = lit('const ECO_BUILDING_MAP');
  const LEGACY_SVC   = lit('const LEGACY_SERVICE');
  const VENUE_BODY   = srcBlockAfter(HTML, 'function isMoraleVenue(ty)');
  const MULT_BODY    = srcBlockAfter(HTML, 'function tileMult(x, z, t, staff, powered)');
  const FAC_BODY     = srcBlockAfter(HTML, 'function insFactors(x, z, t)');
  const TICK_BODY    = srcBlockAfter(HTML, 'async function economyTick(dtMin)');
  const opsListM     = HTML ? /const\s+MORALE_VENUE_OPS\s*=\s*\[([^\]]*)\]/.exec(HTML) : null;
  const prefixM      = HTML ? /const\s+OPS_PREFIX\s*=\s*'([^']*)'/.exec(HTML) : null;
  const PREFIX       = prefixM ? prefixM[1] : null;
  const VENUE_OPS_RAW = opsListM
    ? opsListM[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : null;
  const VENUE_OPS    = SABOTAGE === 'venue-blind' ? [] : VENUE_OPS_RAW;
  /* The standing half of the family, read back out of the function itself
     (`new Set(['arena'])`) rather than typed here — so adding a second standing
     venue widens the invariant instead of quietly falling outside it. */
  const seedM        = VENUE_BODY ? /new Set\(\[([^\]]*)\]\)/.exec(VENUE_BODY) : null;
  const SEED         = seedM
    ? seedM[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : null;

  const got =
    chk('read isMoraleVenue() / tileMult() / insFactors() / economyTick() out of node-city',
        !!VENUE_BODY && !!MULT_BODY && !!FAC_BODY && !!TICK_BODY,
        [VENUE_BODY, MULT_BODY, FAC_BODY, TICK_BODY].map(b => b ? b.length : 'NULL').join('/')) &
    chk('read OP_BP / OP_ECO_MAP / ECO_BUILDING_MAP / LEGACY_SERVICE',
        !!OP_BP && !!OP_ECO_MAP && !!CITY_ECO_MAP && !!LEGACY_SVC,
        [OP_BP, OP_ECO_MAP, CITY_ECO_MAP, LEGACY_SVC].map(o => o ? Object.keys(o).length : 'NULL').join('/')) &
    chk('read MORALE_VENUE_OPS, its standing seed set, and OPS_PREFIX',
        !!VENUE_OPS_RAW && !!SEED && SEED.length > 0 && !!PREFIX,
        JSON.stringify(VENUE_OPS_RAW) + ' seed=' + JSON.stringify(SEED) + ' prefix=' + PREFIX);

  if (!got) {
    console.log('\n🔴 THE MORALE GUARD COULD NOT BE READ — nothing below was checked.');
    bad++; console.log('\n=== ROUND 0g: ' + fails + ' FAILED ===');
  } else {
    const opsKeyOf = ty => PREFIX + ty;
    /* The shipped predicate, lifted and run. `_moraleVenueTypes` is the module
       `let` it memoises into; a fresh one per build means the memo cannot leak
       between the sabotaged and un-sabotaged constructions. */
    const buildVenue = (opsList) => new Function('opsKeyOf', 'MORALE_VENUE_OPS',
      'let _moraleVenueTypes = null;\n' +
      'return function isMoraleVenue(ty) ' + VENUE_BODY + ';')(opsKeyOf, opsList);
    const isMoraleVenue = buildVenue(VENUE_OPS);

    // ── 1. THE PREMISE the first sweep got wrong ─────────────────────────────
    /* ⚠ "ops have no gen" was the excuse. The loop does not ask for gen. */
    chk('the production loop admits a tile on use/svc, not on gen alone',
        /!def\.gen\s*&&\s*!def\.use\s*&&\s*!def\.svc/.test(TICK_BODY),
        'admission line not found in economyTick — re-read it before trusting this round');
    const reached = (o) => !!(OP_BP[o].use || OP_BP[o].svc || OP_BP[o].gen || LEGACY_SVC[opsKeyOf(o)]);
    const skipped = Object.keys(OP_BP).filter(o => !reached(o));
    /* NOT "every op" — measured, `bank` and `warehouse` declare neither, so the
       loop really does skip them and tileMult never sees them. That is exactly
       why this is asserted per-op below instead of as a blanket claim: a sweep
       that generalises from two rows is how the first one got this wrong. */
    console.log('   ↳ ops the production loop never reaches (no gen/use/svc): [' +
                skipped.join(', ') + '] — tileMult is not evaluated for these');
    chk('most operations carry use and/or svc, so tileMult() runs for them',
        skipped.length < Object.keys(OP_BP).length / 2, 'skipped: ' + skipped.join(','));
    chk('…and tileMult() is what the loop then applies to that draw',
        /tileMult\(/.test(TICK_BODY));

    // ── 2. THE INSTANCE, before and after ────────────────────────────────────
    const PRE_FIX = (ty) => ty === 'arena';           // the shipped predicate, verbatim
    const OPD = opsKeyOf('dojo');
    chk("BEFORE: `t.type === 'arena'` scores the Dojo operation as NOT a venue", !PRE_FIX(OPD), OPD);
    chk('AFTER: ' + OPD + ' IS a venue and feels morale', isMoraleVenue(OPD) === true);
    chk('…and the standing arena still does', isMoraleVenue('arena') === true);
    /* The band the op was missing out on, printed so the report cannot round it
       off: Math.max(.3, morale/50) over morale 0…100. */
    const band = m => Math.max(.3, m / 50);
    console.log('   ↳ morale band the Dojo now feels: ×' + band(0).toFixed(2) + ' at morale 0, ×' +
                band(49).toFixed(3) + ' at the live-page morale 49, ×' + band(100).toFixed(2) + ' at 100');

    // ── 3. THE CLASS INVARIANT — derived, never hand-listed ─────────────────
    const twinOf = (op) => {
      const mesh = (OP_BP[op] || {}).mesh;
      if (!mesh || !CITY_ECO_MAP[mesh]) return null;
      const oi = (OP_ECO_MAP[op] || {}).ind, ci = CITY_ECO_MAP[mesh].ind;
      return (oi && oi === ci) ? mesh : null;
    };
    const expectVenue = [], expectNot = [];
    for (const op of Object.keys(OP_BP)) {
      const twin = twinOf(op);
      (twin && SEED.indexOf(twin) >= 0 ? expectVenue : expectNot).push(op);
    }
    chk('the twin derivation is not vacuous: it finds at least one venue twin',
        expectVenue.length > 0, 'venue twins: ' + expectVenue.join(','));
    console.log('   ↳ derived venue twins: [' + expectVenue.join(', ') +
                ']  ·  must NOT feel morale: [' + expectNot.join(', ') + ']');

    const missed = expectVenue.filter(o => !isMoraleVenue(opsKeyOf(o)));
    const spurious = expectNot.filter(o => isMoraleVenue(opsKeyOf(o)));
    chk('🔴 EVERY derived venue twin feels morale — THE CLASS, not the instance',
        missed.length === 0, missed.map(o => o + ' (twin ' + twinOf(o) + ')').join(' | '));
    chk('…and no other operation does (a Fishing Company is not a crowd)',
        spurious.length === 0, spurious.join(' | '));
    chk('a tile type nobody declared is not a venue',
        !isMoraleVenue('farm') && !isMoraleVenue('constructor') && !isMoraleVenue(undefined));
    /* The guard is only worth anything for ops the tick actually evaluates. If a
       future venue twin declares no gen/use/svc, tileMult never runs for it and
       this whole round would be asserting about dead code — say so loudly. */
    chk('every derived venue twin is an op the production loop actually reaches',
        expectVenue.every(reached), expectVenue.filter(o => !reached(o)).join(','));

    // ── 4. THE KEY IS DERIVED, NOT TYPED ────────────────────────────────────
    const opLit = s => (s.match(/['"]op_[a-z][a-z_]*['"]/g) || []);
    chk("no hardcoded 'op_…' literal in isMoraleVenue / tileMult / insFactors",
        !opLit(VENUE_BODY).length && !opLit(MULT_BODY).length && !opLit(FAC_BODY).length,
        [].concat(opLit(VENUE_BODY), opLit(MULT_BODY), opLit(FAC_BODY)).join(','));
    chk('the op keys go through opsKeyOf()', /opsKeyOf\s*\(/.test(VENUE_BODY));
    chk("MORALE_VENUE_OPS is keyed by OP TYPE, not tile type",
        VENUE_OPS_RAW.every(k => k.indexOf(PREFIX) !== 0), VENUE_OPS_RAW.join(','));

    // ── 5. THE PANEL PRINTS WHAT THE TICK CHARGED ───────────────────────────
    /* Two copies of `Math.max(.3, wellbeing.morale / 50)` behind two copies of
       the predicate is how the inspector starts lying about the tick. Both now
       call the one helper, and neither may re-inline the expression. */
    chk('tileMult() and insFactors() both gate on isMoraleVenue()',
        /isMoraleVenue\s*\(/.test(MULT_BODY) && /isMoraleVenue\s*\(/.test(FAC_BODY));
    chk('…and both take the value from moraleVenueMult(), not a re-typed literal',
        /moraleVenueMult\s*\(/.test(MULT_BODY) && /moraleVenueMult\s*\(/.test(FAC_BODY) &&
        !/wellbeing\.morale\s*\/\s*50/.test(MULT_BODY) && !/wellbeing\.morale\s*\/\s*50/.test(FAC_BODY),
        'a re-inlined morale expression is back in tileMult or insFactors');

    if (fails) { bad++; console.log('\n=== ROUND 0g: ' + fails + ' FAILED ==='); }
    else console.log('\n=== ROUND 0g: ALL PASS ===');
  }
}
/* ════════════════════════════════════════════════════════════════════════════
   ROUND 0h — ☔ THE SAME BUG CLASS, IN THE WEATHER
   ----------------------------------------------------------------------------
   Rounds 0f and 0g pinned the class down in ecoLogisticsCounts() and in the
   morale term. Both of those were found by grepping `t.type === '…'`. THAT GREP
   IS STRUCTURALLY BLIND to weatherMult(), which compares a bare PARAMETER named
   `type` — so three more live instances sat one line above the one 0g fixed
   (`tileMult` reaches them through `* weatherMult(t.type)`), plus a fourth
   nobody had named:

     · `type === 'farm'`                     missed `op_agri` (Agricultural Op.)
     · `W.anomaly && type === 'siphon'`      missed `op_smuggling`
     · `W.anomaly && type === 'reslab'`      missed `op_research`
     · `def.outdoor` — `outdoor` lives on the BUILDINGS row and the ops
       registration loop copies name/ico/pop/crew/powerNeed/use/svc and NOT
       `outdoor`, so every operation on an open-air twin's mesh was weatherproof:
       `op_oil` on the Fuel Rig mesh is the live one.

   MEASURED ON THE LIVE PAGE BEFORE THE FIX (tileMult under weather ÷ tileMult
   under clear, so every other term cancels):
     TORNADO farm ×0.50 · op_agri ×1.00   |  RAIN farm ×1.30 · op_agri ×1.00
     SNOW    farm ×0.396 · op_agri ×0.88  |  ANOMALY siphon ×3 · op_smuggling ×1
     ANOMALY reslab ×3 · op_research ×1   |  TORNADO fuelrig ×0.50 · op_oil ×1.00
   A 3× production swing denied to a 600,000 🔥 licence, silently.

   THE INVARIANT, and it is deliberately TOTAL rather than per-instance:
     for EVERY op whose twin is non-null, and under EVERY row of WEATHER,
       weatherMult(opsKeyOf(op)) === weatherMult(twin)
     and for every op with NO twin, weatherMult is the plain indoor baseline.
   twin(op) is re-derived here exactly as in 0f/0g — same mesh AND same industry
   — never hand-listed, so an operation that joins the class turns this red
   without anyone remembering to add a case. 🔴 MESH ALONE IS THE TRAP: op_fishing
   renders on the purifier mesh and is a fishing fleet (ind `fishery`), not a
   waterworks; a mesh rule would hand it the purifier's rain ×1.35. Asserted
   below as an explicit negative.

   ⚠ THE SHIPPED FUNCTIONS ARE LIFTED AND RUN, not copied, and so is the ops
     REGISTRATION LOOP — the claim "an operation never carries `outdoor`" is the
     load-bearing half of the op_oil defect, and a hand-built op blueprint here
     would be asserting about a fiction.
   ⚠ BUILDINGS is evaluated in a `with`-scope that answers 0 to every unknown
     name (it references STOCK_CAP_PER_WAREHOUSE and friends). Only the `outdoor`
     flags are read from it and those are literal `true`; nothing here depends on
     a cost number, and a stubbed cost cannot fake an `outdoor`.

   Prove this round can fail:
     ECON_TEST_SABOTAGE=no-map        the scrape reads nothing ⇒ hard fail
     ECON_TEST_SABOTAGE=wx-twin-blind empties WEATHER_TWIN_OPS on the way in,
                                      which is exactly the pre-fix source
   ════════════════════════════════════════════════════════════════════════════ */
{
  console.log('\n########## round0h-weather-twins ##########');
  let fails = 0;
  const chk = (name, cond, extra) => {
    if (cond) { console.log('✅ ' + name); return true; }
    fails++; console.log('❌ ' + name + (extra ? ' :: ' + extra : '')); return false;
  };

  let HTML = null;
  try {
    HTML = readFileSync(join(here, SABOTAGE === 'no-map'
      ? '../../public/node-city/THIS-FILE-DOES-NOT-EXIST.html'
      : '../../public/node-city/index.html'), 'utf8');
  } catch (e) { HTML = null; }

  /* Two evaluators. `lit` is 0f/0g's; `loose` is the same thing inside a `with`
     over a Proxy that answers 0 for every free identifier — BUILDINGS is the
     only table that needs it, and it needs it because it cites constants
     declared elsewhere in the file. */
  const lit = (decl) => {
    const txt = srcBlockAfter(HTML, decl);
    if (!txt) return null;
    try { return new Function('return (' + txt + ');')(); } catch (e) { return null; }
  };
  const loose = (decl) => {
    const txt = srcBlockAfter(HTML, decl);
    if (!txt) return null;
    try {
      const scope = new Proxy({}, { has: () => true,
        get: (t, k) => (k === Symbol.unscopables ? undefined : 0) });
      return new Function('__s', 'with (__s) { return (' + txt + '); }')(scope);
    } catch (e) { return null; }
  };
  const OP_BP        = lit('const OP_BP');
  const OP_ECO_MAP   = lit('const OP_ECO_MAP');
  const CITY_ECO_MAP = lit('const ECO_BUILDING_MAP');
  const WEATHER      = lit('const WEATHER');
  const TWIN_RAW     = lit('const WEATHER_TWIN_OPS');
  const TWIN         = SABOTAGE === 'wx-twin-blind' ? {} : TWIN_RAW;
  const BUILDINGS    = loose('const BUILDINGS');
  const REG_BODY     = srcBlockAfter(HTML, 'for (const t of OPS_TYPES)');
  const MULT_BODY    = srcBlockAfter(HTML, 'function weatherMult(type)');
  const TWIN_BODY    = srcBlockAfter(HTML, 'function weatherTwinType(type)');
  const SENS_BODY    = srcBlockAfter(HTML, 'function weatherSensitive(type)');
  const RISK_BODY    = srcBlockAfter(HTML, 'function insRisk(t, x, z)');
  const TILEM_BODY   = srcBlockAfter(HTML, 'function tileMult(x, z, t, staff, powered)');
  const prefixM      = HTML ? /const\s+OPS_PREFIX\s*=\s*'([^']*)'/.exec(HTML) : null;
  const PREFIX       = prefixM ? prefixM[1] : null;

  /* 🔴 A SCRAPE THAT MATCHED NOTHING MUST FAIL HARD — round0b's point, and 0f's.
     The failure mode of an extraction test is not a wrong answer, it is a green
     run over an empty set. */
  const got =
    chk('read weatherMult / weatherTwinType / weatherSensitive / insRisk out of node-city',
        !!MULT_BODY && !!TWIN_BODY && !!SENS_BODY && !!RISK_BODY && !!TILEM_BODY,
        [MULT_BODY, TWIN_BODY, SENS_BODY, RISK_BODY, TILEM_BODY].map(b => b ? b.length : 'NULL').join('/')) &
    chk('read WEATHER / BUILDINGS / OP_BP / OP_ECO_MAP / ECO_BUILDING_MAP / WEATHER_TWIN_OPS',
        !!WEATHER && !!BUILDINGS && !!OP_BP && !!OP_ECO_MAP && !!CITY_ECO_MAP && !!TWIN_RAW,
        [WEATHER, BUILDINGS, OP_BP, OP_ECO_MAP, CITY_ECO_MAP, TWIN_RAW].map(o => o ? Object.keys(o).length : 'NULL').join('/')) &
    chk('read the ops registration loop and OPS_PREFIX', !!REG_BODY && !!PREFIX,
        (REG_BODY ? REG_BODY.length : 'NULL') + ' / ' + PREFIX) &
    chk('BUILDINGS really carries outdoor flags (the loose eval did not flatten it)',
        !!BUILDINGS && Object.keys(BUILDINGS).some(k => BUILDINGS[k] && BUILDINGS[k].outdoor),
        BUILDINGS ? Object.keys(BUILDINGS).filter(k => BUILDINGS[k] && BUILDINGS[k].outdoor).join(',') : 'NULL');

  if (!got) {
    console.log('\n🔴 THE WEATHER GUARD COULD NOT BE READ — nothing below was checked.');
    bad++; console.log('\n=== ROUND 0h: ' + fails + ' FAILED ===');
  } else {
    const opsKeyOf = ty => PREFIX + ty;
    /* THE SHIPPED REGISTRATION, RUN. This is what puts op_* rows into BUILDINGS,
       and the whole op_oil defect is the fact that it does not copy `outdoor`. */
    new Function('OPS_TYPES', 'OP_BP', 'BUILDINGS', 'opsKeyOf', 'BUILD_ORDER',
                 'OP_ECO_MAP', 'ECO_BUILDING_MAP', 'for (const t of OPS_TYPES) ' + REG_BODY)
      (Object.keys(OP_BP), OP_BP, BUILDINGS, opsKeyOf, [], OP_ECO_MAP, CITY_ECO_MAP);
    chk('the registered operations exist in BUILDINGS and NONE of them carries `outdoor` — ' +
        'the reason op_oil was weatherproof',
        Object.keys(OP_BP).every(o => BUILDINGS[opsKeyOf(o)]) &&
        Object.keys(OP_BP).every(o => !BUILDINGS[opsKeyOf(o)].outdoor),
        Object.keys(OP_BP).filter(o => !BUILDINGS[opsKeyOf(o)] || BUILDINGS[opsKeyOf(o)].outdoor).join(','));

    /* The three shipped functions, built over one live `wx` so a row can be put
       over the city by assignment. `_wxTwinTypes` is the module `let` they
       memoise into; a fresh one per build keeps the sabotaged and un-sabotaged
       constructions from sharing a memo. */
    const wx = { type: 'clear' };
    const build = (keyFn, twins) => new Function('WEATHER', 'wx', 'BUILDINGS', 'opsKeyOf', 'WEATHER_TWIN_OPS',
      'let _wxTwinTypes = null;\n' +
      'function weatherTwinType(type) ' + TWIN_BODY + '\n' +
      'function weatherSensitive(type) ' + SENS_BODY + '\n' +
      'function weatherMult(type) ' + MULT_BODY + '\n' +
      'return { weatherMult, weatherSensitive, weatherTwinType };')
      (WEATHER, wx, BUILDINGS, keyFn, twins);
    const A = build(opsKeyOf, TWIN);
    const WX_ROWS = Object.keys(WEATHER);
    const under = (w, fn) => { const s = wx.type; wx.type = w; try { return fn(); } finally { wx.type = s; } };

    // ── 1. THE INSTANCES, before and after ───────────────────────────────────
    /* 🐛 THE SHIPPED PREDICATES, WRITTEN OUT — a green test that has only ever
       seen the fixed code cannot tell you the bug was real. */
    const PRE_FARM = ty => ty === 'farm';
    const PRE_RIFT = ty => ty === 'siphon' || ty === 'reslab';
    const PRE_OUT  = ty => !!(BUILDINGS[ty] && BUILDINGS[ty].outdoor);
    chk("BEFORE: `type === 'farm'` scores the Agricultural Op. as not-a-farm",
        !PRE_FARM(opsKeyOf('agri')));
    chk("BEFORE: the anomaly clause misses op_smuggling and op_research",
        !PRE_RIFT(opsKeyOf('smuggling')) && !PRE_RIFT(opsKeyOf('research')));
    chk("BEFORE: `def.outdoor` is false for op_oil though fuelrig is open-air",
        !PRE_OUT(opsKeyOf('oil')) && PRE_OUT('fuelrig'));
    const shown = [
      ['tornado', 'farm', 'agri'], ['rain', 'farm', 'agri'], ['snow', 'farm', 'agri'],
      ['anomaly', 'siphon', 'smuggling'], ['anomaly', 'reslab', 'research'],
      ['tornado', 'fuelrig', 'oil'], ['storm', 'fuelrig', 'oil'],
    ];
    for (const [w, tile, op] of shown) {
      const a = under(w, () => A.weatherMult(opsKeyOf(op))), b = under(w, () => A.weatherMult(tile));
      chk('AFTER: ' + w.toUpperCase() + ' ' + tile + ' ×' + b + ' — ' + opsKeyOf(op) + ' now ×' + a, a === b,
          'op ' + a + ' vs twin ' + b);
    }

    // ── 2. THE CLASS INVARIANT, every twin × every weather row ──────────────
    const twinOf = (op) => {
      const mesh = (OP_BP[op] || {}).mesh;
      if (!mesh || !CITY_ECO_MAP[mesh]) return null;
      const oi = (OP_ECO_MAP[op] || {}).ind, ci = CITY_ECO_MAP[mesh].ind;
      return (oi && oi === ci) ? mesh : null;
    };
    const twins = Object.keys(OP_BP).filter(twinOf), orphans = Object.keys(OP_BP).filter(o => !twinOf(o));
    chk('the twin derivation is not vacuous', twins.length > 0);
    console.log('   ↳ derived weather twins: [' + twins.map(o => o + '→' + twinOf(o)).join(', ') + ']');
    console.log('   ↳ operations with NO twin (must feel the plain indoor row): [' + orphans.join(', ') + ']');

    const mismatch = [];
    for (const w of WX_ROWS) for (const op of twins) {
      const a = under(w, () => A.weatherMult(opsKeyOf(op))), b = under(w, () => A.weatherMult(twinOf(op)));
      if (a !== b) mismatch.push(w + ': ' + op + ' ×' + a + ' vs ' + twinOf(op) + ' ×' + b);
    }
    chk('🔴 EVERY derived twin feels EXACTLY its standing twin\'s weather, in EVERY row — ' +
        'THE CLASS, not the instance', mismatch.length === 0, mismatch.join(' | '));

    const wrong = [];
    for (const w of WX_ROWS) for (const op of orphans) {
      const base = WEATHER[w] && w !== 'clear' ? (WEATHER[w].allMult || 1) : 1;
      const a = under(w, () => A.weatherMult(opsKeyOf(op)));
      if (a !== base) wrong.push(w + ': ' + op + ' ×' + a + ' (baseline ×' + base + ')');
    }
    chk('…and an operation with no twin gets the plain indoor baseline, nothing else',
        wrong.length === 0, wrong.join(' | '));
    /* 🔴 THE NEGATIVE THAT KILLS THE MESH SHORTCUT. op_fishing borrows the
       purifier MESH; if anyone ever "simplifies" the table to OP_BP[…].mesh, a
       fishing fleet starts collecting the waterworks' rain bonus and this goes
       red. */
    chk('op_fishing does NOT inherit the purifier it is drawn as (mesh ≠ industry)',
        under('rain', () => A.weatherMult(opsKeyOf('fishing'))) !== under('rain', () => A.weatherMult('purifier')),
        'rain: op_fishing ×' + under('rain', () => A.weatherMult(opsKeyOf('fishing'))) +
        ' vs purifier ×' + under('rain', () => A.weatherMult('purifier')));

    // ── 3. THE INSPECTOR PRINTS WHAT THE TICK CHARGED ───────────────────────
    const rowMiss = twins.filter(o => A.weatherSensitive(opsKeyOf(o)) !== A.weatherSensitive(twinOf(o)));
    chk('the weather ROW appears for an op exactly when it appears for its twin ' +
        '(op_agri showed none at all)', rowMiss.length === 0,
        rowMiss.map(o => o + ' ' + A.weatherSensitive(opsKeyOf(o)) + ' vs ' + twinOf(o) + ' ' + A.weatherSensitive(twinOf(o))).join(' | '));
    chk('…and insRisk gates on weatherSensitive() rather than re-typing its rule',
        /weatherSensitive\s*\(/.test(RISK_BODY) &&
        !/t\.type\s*===\s*'(farm|purifier)'/.test(RISK_BODY),
        'a re-typed farm/purifier comparison is back in insRisk');
    chk('tileMult() still routes production through weatherMult()', /weatherMult\s*\(/.test(TILEM_BODY));

    // ── 4. THE KEY IS DERIVED, NOT TYPED ────────────────────────────────────
    const opLit = s => (s.match(/['"]op_[a-z][a-z_]*['"]/g) || []);
    chk("no hardcoded 'op_…' literal in weatherMult / weatherTwinType / weatherSensitive / insRisk",
        !opLit(MULT_BODY).length && !opLit(TWIN_BODY).length && !opLit(SENS_BODY).length && !opLit(RISK_BODY).length,
        [].concat(opLit(MULT_BODY), opLit(TWIN_BODY), opLit(SENS_BODY), opLit(RISK_BODY)).join(','));
    chk('the op keys go through opsKeyOf()', /opsKeyOf\s*\(/.test(TWIN_BODY));
    chk('WEATHER_TWIN_OPS is keyed by OP TYPE, not tile type',
        Object.keys(TWIN_RAW).every(k => k.indexOf(PREFIX) !== 0), Object.keys(TWIN_RAW).join(','));
    chk('…and every value in it is a real standing building',
        Object.values(TWIN_RAW).every(v => !!BUILDINGS[v] && v.indexOf(PREFIX) !== 0),
        Object.values(TWIN_RAW).filter(v => !BUILDINGS[v]).join(','));

    // ── 5. THE TWO WAYS A LOOKUP LIES ───────────────────────────────────────
    chk("a tile typed 'constructor' resolves to itself, not up the prototype chain",
        A.weatherTwinType('constructor') === 'constructor' && A.weatherTwinType(undefined) === undefined,
        String(A.weatherTwinType('constructor')));
    /* THE TDZ PATH. opsKeyOf is a const arrow ~19,600 lines below weatherMult;
       a call during boot THROWS. The fallback must be identity AND must not be
       memoised, or "ops are not twinned yet" becomes permanent. */
    let tdz = true;
    const T = build((t) => { if (tdz) throw new ReferenceError('TDZ'); return PREFIX + t; }, TWIN);
    const duringBoot = under('tornado', () => T.weatherMult(opsKeyOf('agri')));
    tdz = false;
    const afterBoot = under('tornado', () => T.weatherMult(opsKeyOf('agri')));
    chk('during boot the twin lookup fails SAFE to the old behaviour (×1 allMult), ' +
        'and does NOT poison the memo',
        duringBoot === 1 && afterBoot === under('tornado', () => A.weatherMult('farm')),
        'boot ×' + duringBoot + ' then ×' + afterBoot);

    if (fails) { bad++; console.log('\n=== ROUND 0h: ' + fails + ' FAILED ==='); }
    else console.log('\n=== ROUND 0h: ALL PASS ===');
  }
}


/* ════════════════════════════════════════════════════════════════════════════
   ROUND 0k — 💰 BASE-PRICE DRIFT: A RECIPE EDIT MAY NOT SILENTLY REPRICE THE
              CONSUMER BASKET
   ----------------------------------------------------------------------------
   🔴 THE BUG THIS ROUND EXISTS FOR, WITH ITS NUMBER.
   The card package re-rooted `packagingMaterial` from {cardboard 0.7, plastic
   0.2} to {timber 0.8} so the Ouroboros chain could actually run. It could not
   have been more clearly in scope, and it was correct. It also moved 19 of the
   258 derived base prices, and ELEVEN of them have nothing to do with cards:

     packagingMaterial 4.477→0.974 −78.2%   packagedFood −20.9%   snacks −19.8%
     beverages −19.1%   frozenFood −13.4%   emergencyFood −13.2%
     personalCareProducts −10.8%   processedMeat −8.3%   bottledWater −8.2%
     cleaningProducts −5.6%   emergencySupplies −3.3%   medicine −2.0%
     pharmaceuticals −0.9%   advancedMedicine −0.4%

   Nobody noticed. Every round was green, because every round asked whether the
   chain PRODUCED, whether the audit BALANCED, whether the ids were REACHABLE —
   and none of those questions can see a price. `packagingMaterial` is an input
   to 13 goods; one recipe line rewrote what households pay for food, medicine
   and cleaning products, and rewrote the denomination of the `value` figure
   cardOutput() hands the Foundation Reserve. It reached the gate as a footnote
   reading "packaging firms now trade".

   THE CLASS OF BUG IS "A RECIPE EDIT REPRICES UNRELATED GOODS", AND IT WILL
   RECUR, because prices.js derives every price from the graph — which is the
   right design and is exactly why one coefficient reaches everywhere. The only
   defence against a derived catalogue is a snapshot of the derived catalogue.

   ── WHAT THIS ROUND ASSERTS ────────────────────────────────────────────────
   BASELINE below is the WHOLE derived catalogue — every id deriveBase() knows,
   not a watchlist, because a watchlist only ever contains the ids somebody
   already thought of, and the eleven goods above were precisely the ids nobody
   thought of. Any id moving more than DRIFT_TOL, appearing, or disappearing is
   a RED that names it. Base prices are a pure function of ECON and RECIPES with
   no clock, no RNG and no node in them, so this is exactly reproducible and the
   tolerance can be tight.

   ⚠ GOING RED HERE IS NOT "YOU BROKE SOMETHING". It is "you changed prices, say
     so". Re-baseline in the SAME commit that moves them, and put the numbers in
     the commit message. That is the entire deliverable: the number changing is
     fine, the number changing in silence is what cost a package.

   ⚠ WHY THIS IS NOT A RUBBER STAMP, PROVEN ON EVERY RUN. A snapshot test that
     is never exercised rots into an assertion that passes because nothing
     called it. §2 below therefore re-runs the detector against the ACTUAL
     pre-card-package recipe and requires it to fire and to name
     `packagingMaterial` plus the consumer goods. So this round demonstrates,
     every time it runs, that it would have caught the change that created it.
     (That is deliberately not a `dark-cards`-style env switch: the historical
     case is the one case worth checking unconditionally.)

   Prove the round can fail from the outside too: ECON_TEST_SABOTAGE=price-drift
   nudges the `packagingMaterial` timber coefficient 0.8→1.9 — the "soften the
   fall" retune that was considered and rejected — and §1 must go red naming it.
   ════════════════════════════════════════════════════════════════════════════ */
{
  console.log('\n########## round0k-base-price-drift ##########');
  let fails = 0;
  const chk = (name, cond, extra) => {
    if (cond) { console.log('✅ ' + name); return true; }
    fails++; console.log('❌ ' + name + (extra ? ' :: ' + extra : '')); return false;
  };

  const R = await import('../../public/src/economy/recipes.js');
  const P = await import('../../public/src/economy/prices.js');

  /* The baseline, packed several ids to a row purely so 258 numbers stay
     reviewable in a diff. 8 significant figures — deriveBase() is deterministic,
     so anything looser would let a real move hide inside the rounding. */
  const BASELINE_ROWS = [
  'acids:9.70038 adhesives:6.3074081 advancedAlloys:32.687785 advancedBatteries:27.348391',
  'advancedMedicine:93.882588 advancedMicrochips:121.45881 advancedSensors:78.387204',
  'aerospaceAluminum:43.973653 agriculturalMachinery:25.463368 aluminum:6.8920429',
  'aluminumOre:2.0228571 animalFeed:0.91375884 anomalousEnergy:219.14286',
  'anomalousMatter:255.66667 anomalySensors:140.72752 appliances:22.029748',
  'arcaneCrystal:292.19048 artificialIntelligenceHardware:216.62864 asphalt:1.5697984',
  'automationSystems:117.67078 aviationFuel:5.6777831 batteries:12.496193 beverages:2.1041269',
  'biomass:0.55310685 books:11.738103 boosterPacks:7.6536281 bottledWater:2.3080658',
  'bread:1.812369 brick:1.2361633 buses:121.42305 cannedFood:2.9304904 cardBoxes:47.516575',
  'cardStock:3.1244433 cardboard:2.3419063 cars:73.233381 cement:1.7912744 cheese:15.493517',
  'chemicalFeedstock:6.3513932 circuitBoards:20.344229 classifiedTechnology:260.45006',
  'clay:0.4956 cleaningChemicals:8.2873659 cleaningProducts:8.4066824 clothing:6.7391939',
  'coal:1.2872727 cobalt:9.44 collectorPacks:27.643281 commercialWaste:0.0375',
  'communicationComponents:21.343569 communicationDevices:37.661254',
  'communicationEquipment:39.936347 compositeMaterials:13.738718 compost:0.2655',
  'computerComponents:49.967544 computers:82.456878 concrete:2.1236238',
  'constructionComponents:10.084747 constructionEquipment:43.398836',
  'constructionGlass:4.2179363 containmentEquipment:294.7911 containmentMaterials:75.594533',
  'cookingOil:1.6896892 copper:6.5221682 copperOre:2.1784615 copperWire:9.2099571',
  'corn:0.52168421 cotton:0.90109091 crudeOil:1.5308108 dairy:4.6434556',
  'dataStorageHardware:84.067089 deliveryVehicles:78.939968 diagnosticEquipment:97.293603',
  'diesel:3.6174495 dimensionalMaterial:438.28571 displays:31.072665 droneComponents:72.232696',
  'eggs:1.6729544 electricVehicles:122.03991 electricalComponents:9.8613182 electricity:0.25',
  'electronicComponents:16.709527 electronicWaste:0.0375 emergencyEquipment:29.949767',
  'emergencyFood:4.3821729 emergencySupplies:8.9645 engines:20.21532 fabric:4.3908501',
  'factoryEquipment:56.305207 fertilizer:5.4768835 fiberOpticCable:11.813466 flour:1.110262',
  'freightVehicles:122.36547 freshFish:1.0325 freshWater:0.54575 frozenFood:3.2111626',
  'fruit:0.826 furniture:8.1092477 furnitureComponents:4.3685868 gasoline:3.8039851',
  'generators:19.871934 glass:2.2793239 goldOre:12.586667 gravel:0.38123077',
  'hazardousMaterialEquipment:99.678009 hazardousWaste:0.0375 heavyMachinery:40.352319',
  'herbs:1.77 holographicChemicals:35.492001 holographicChips:117.29301',
  'holographicComponents:65.516705 holographicFoil:42.232737 holographicProjectors:171.04253',
  'householdGoods:9.1321553 hydrogen:3.328898 industrialChemicals:8.6128014',
  'industrialFuel:3.7663208 industrialGas:2.9236515 industrialMachinery:25.425414',
  'industrialRobots:187.86378 industrialVehicles:64.509265 industrialWaste:0.0375',
  'industrialWater:0.413 inkChemicals:10.927511 insulation:7.7057634 ironOre:1.77',
  'leather:3.6591235 limestone:0.53869565 lithium:6.2933333 livestock:6.1641174',
  'lumber:1.4203267 luxuryGoods:12.389771 machineParts:11.652847 maintenanceParts:15.394149',
  'meat:3.7511366 medicalChemicals:14.003373 medicalEquipment:27.77018',
  'medicalSupplies:9.0690974 medicalWaste:0.0375 medicine:16.288482 metalAlloys:10.174337',
  'metalComponents:9.4131702 microchips:77.135205 miningEquipment:46.59934',
  'mythicEssence:191.75 mythicResidue:122.72 naturalGas:1.3814634 naturalGasFuel:2.6110522',
  'networkingEquipment:66.186754 nickelOre:3.776 nuclearFuel:67.831038',
  'officeSupplies:7.6524872 opticalComponents:12.568518 organicWaste:0.0375',
  'packagedFood:2.7229497 packagingMaterial:0.97428667 paint:8.2623044 paper:5.957267',
  'personalCareProducts:4.1167307 petrochemicals:4.3801518 pharmaceuticals:46.122885',
  'pigIron:4.8655528 plantFiber:0.76246154 plastic:9.3987366 plasticFeedstock:6.5214581',
  'platinumOre:22.656 plumbingComponents:6.641336 plywood:2.3325514 potatoes:0.45054545',
  'poultry:3.1887602 prefabricatedComponents:12.364236 premiumPaper:7.1042187',
  'preparedMeals:2.4493443 printedCards:6.6146853 printingInk:13.771023',
  'processedMeat:4.5851538 processors:158.40091 protectiveCoating:8.0584548',
  'protectiveEquipment:15.545745 pumps:14.369309 quantumComponents:117.60093 quartz:1.4576471',
  'rareEarthMinerals:35.4 rareMinerals:30.975 rawMilk:2.9221055 rawWater:0.25',
  'realityFragments:681.77778 realityMatter:383.5 realityStabilizationComponents:203.97022',
  'reclaimedIndustrialMaterials:3.6164379 reclaimedWater:0.25 recycledElectronics:3.3774909',
  'recycledGlass:0.441025 recycledMetal:0.53395 recycledPaper:0.38055 recycledPlastic:0.48675',
  'reinforcedConcrete:4.7111748 reinforcedContainmentMaterials:177.97682',
  'relayComponents:55.224305 researchChemicals:25.718649 researchEquipment:157.79398',
  'residentialWaste:0.0375 restaurantSupplies:3.2942137 rice:0.6195 robotics:103.78761',
  'rubber:6.8652713 sand:0.413 satelliteComponents:105.55551 satelliteSystems:325.27674',
  'seafood:1.18 seaweed:0.85448276 secureElectronics:113.60715 securityEquipment:33.797785',
  'seeds:1.239 semiconductorChemicals:25.254676 semiconductorMaterials:62.055083',
  'sensors:36.152988 servers:296.8389 sheetMetal:10.501739 shellfish:1.9061538 shoes:5.3817367',
  'signalProcessors:135.59598 silica:0.63538462 siliconWafers:30.297312 silverOre:8.0914286',
  'smartphones:60.858049 snacks:1.6781959 solvents:8.0852792 soulEnergy:322.94737',
  'soybeans:0.6608 specializedMedicalSupplies:89.51962 specialtyPolymers:12.468306',
  'sportingGoods:8.5685637 starterDecks:14.537948 steel:8.0434746 stone:0.51625',
  'structuralSteel:12.383997 sugar:1.7457198 sugarCrops:0.58305882 surgicalSupplies:16.446494',
  'surveillanceEquipment:79.704619 syntheticFiber:7.3362476 timber:0.68833333 tires:9.7773829',
  'titanium:7.08 tournamentProducts:45.828122 toys:7.5384717 trucks:108.10154',
  'tungsten:10.298182 turbines:37.939574 vegetables:0.708 vehicleParts:15.970069',
  'wastewater:0.0375 wheat:0.55066667 wiring:13.437501 wood:0.72882353 woodPanels:2.1337304',
  'woodPulp:2.6176727 zincOre:3.3317647',
  ];
  const BASELINE = {};
  for (const row of BASELINE_ROWS) for (const cell of row.split(' ')) {
    const c = cell.lastIndexOf(':');
    if (c > 0) BASELINE[cell.slice(0, c)] = Number(cell.slice(c + 1));
  }

  /* 0.25%. Tight because there is nothing stochastic to absorb: the same ECON
     and the same RECIPES give the same doubles on every run. Loose enough that
     a pure reflow of the relaxation (SWEEPS, ordering) does not cry wolf.
     `medicine` moved 2.0% and `pharmaceuticals` 0.9% in the change above, so a
     1% tolerance would have MISSED pharmaceuticals — which is the argument
     against picking a comfortable number. */
  const DRIFT_TOL = 0.0025;

  /* Returns the whole delta, sorted worst-first. Never an average and never a
     count on its own: the point of this round is to NAME the goods that moved,
     because "3 prices drifted" tells a reviewer nothing about whether dinner
     got cheaper. */
  function drift(actual) {
    const moved = [], added = [], gone = [];
    for (const id in BASELINE) {
      if (!(id in actual)) { gone.push(id); continue; }
      const d = (actual[id] - BASELINE[id]) / Math.max(1e-12, BASELINE[id]);
      if (Math.abs(d) > DRIFT_TOL) moved.push({ id, from: BASELINE[id], to: actual[id], pct: d * 100 });
    }
    for (const id in actual) if (!(id in BASELINE)) added.push(id);
    moved.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
    return { moved, added, gone };
  }
  const cell = m => m.id + ' ' + m.from.toPrecision(6) + '→' + m.to.toPrecision(6) +
                    ' (' + (m.pct >= 0 ? '+' : '') + m.pct.toFixed(2) + '%)';
  function show(d, cap) {
    if (d.moved.length) {
      console.log('     WORST CELL: ' + cell(d.moved[0]));
      for (const m of d.moved.slice(0, cap || 24)) console.log('       ' + cell(m));
      if (d.moved.length > (cap || 24)) console.log('       … and ' + (d.moved.length - (cap || 24)) + ' more');
    }
    if (d.added.length) console.log('     NEW ids not in the baseline: ' + d.added.join(', '));
    if (d.gone.length)  console.log('     ids that VANISHED from the catalogue: ' + d.gone.join(', '));
  }

  if (SABOTAGE === 'price-drift') {
    R.RECIPES.packagingMaterial.in.timber = 1.9;
    console.log('   🧨 packagingMaterial timber 0.8 → 1.9 (the rejected "soften the fall" retune)');
  }

  // ── §1 THE TRIPWIRE ──────────────────────────────────────────────────────
  const now = P.deriveBase(true);
  const nIds = Object.keys(now).length, nBase = Object.keys(BASELINE).length;
  chk('the derived catalogue is still ' + nBase + ' ids wide', nIds === nBase,
      'deriveBase() now returns ' + nIds);
  const d1 = drift(now);
  if (!chk('NO base price has drifted past ' + (DRIFT_TOL * 100).toFixed(2) + '% — ' +
           'a recipe edit did not silently reprice the catalogue',
           d1.moved.length === 0 && d1.added.length === 0 && d1.gone.length === 0,
           d1.moved.length + ' moved, ' + d1.added.length + ' new, ' + d1.gone.length + ' gone')) {
    show(d1);
    console.log('     → If you MEANT this, re-baseline BASELINE_ROWS in the same commit');
    console.log('       (regenerate: for each id, `id:` + Number(deriveBase(true)[id].toPrecision(8)))');
    console.log('       and put these percentages in the commit message.');
  }

  // ── §2 THE DETECTOR MUST BE ABLE TO FIRE, ON THE HISTORICAL CASE ──────────
  /* Swap in the EXACT pre-card-package recipe and require the detector to
     catch it AND to name the goods a reader would care about. If this ever goes
     green, §1's green means nothing. */
  const SHIPPED = R.RECIPES.packagingMaterial;
  R.RECIPES.packagingMaterial = { in: { cardboard: 0.7, plastic: 0.2 },
                                  labor: 0.07, power: 0.12, ind: 'packaging' };
  const d2 = drift(P.deriveBase(true));
  const named = d2.moved.map(m => m.id);
  const MUST_NAME = ['packagingMaterial', 'packagedFood', 'snacks', 'beverages', 'frozenFood',
                     'emergencyFood', 'personalCareProducts', 'processedMeat', 'bottledWater',
                     'cleaningProducts', 'medicine', 'pharmaceuticals'];
  const missed = MUST_NAME.filter(id => !named.includes(id));
  chk('self-test — reverting packagingMaterial to {cardboard,plastic} FIRES this round',
      d2.moved.length > 0, 'the detector saw nothing; §1 is a rubber stamp');
  chk('self-test — and it names all ' + MUST_NAME.length + ' goods the original change moved',
      missed.length === 0, 'missed: ' + missed.join(', '));
  if (d2.moved.length) {
    console.log('   ↳ this is what the gate WOULD have printed had this round existed:');
    show(d2, 14);
  }
  R.RECIPES.packagingMaterial = SHIPPED;
  if (SABOTAGE === 'price-drift') R.RECIPES.packagingMaterial.in.timber = 0.8;
  /* Recompute so nothing after this round reads a poisoned `_base`. deriveBase
     memoises, and §2 left the cache holding the counterfactual catalogue. */
  P.deriveBase(true);

  if (fails) { bad++; console.log('\n=== ROUND 0k: ' + fails + ' FAILED ==='); }
  else console.log('\n=== ROUND 0k: ALL PASS ===');
}

/* ════════════════════════════════════════════════════════════════════════════
   ROUND 0n — 🤝 REAL CITY-TO-CITY TRADE
   ----------------------------------------------------------------------------
   THE DEFECT THIS ROUND EXISTS FOR IS THE DOUBLE SHIP.

   `city_trade_fill(offer_id, units)` takes `for update` on the offer row for one
   reason: two cities filling the last 40 units of the same offer would otherwise
   both read `filled_units = 0`, both write 40, and the seller would ship 80. The
   lock makes the SERVER's answer authoritative — and an authoritative answer is
   worth exactly nothing if the client then credits the number it ASKED for. That
   substitution is a one-word edit, it looks completely reasonable in review
   (`credit(req.units)` beside a variable called `filled`), and every green day in
   the gate would stay green: the audit only tracks Cinder, and goods that appear
   out of nowhere do not fail it.

   So the invariant is asserted by SWEEPING the space rather than by sampling it:
   every combination of what we asked for against what the server said, including
   the server answering MORE than we asked, and the round fails on the worst cell.

   WHAT ELSE IS HERE, and why each is not a comment:
     §1 STRUCTURAL — /src/economy/trade.js contains no network call at all. That
        is provable by READING it, and reading beats sampling: it holds for every
        future partner shape, not for the ones this round happens to try. Comments
        are stripped first, because that file legitimately DISCUSSES Supabase.
     §3 DEGRADE — every failure shape the transport can produce (throw, null, {},
        a non-numeric `filled`, an array, a timeout answered as null) credits
        nothing and leaves the city trading. sql/038 IS NOT APPLIED, so this is
        not an edge case: it is the shipping configuration.
     §4 refreshPartners() must never overwrite a REAL partner's inventory with
        fabricated numbers, and must still refill the simulated ones. The flag is
        the only thing separating a real neighbour from an invention.
     §6 Rule 1 with settlement live: a fill moves value between two parties and
        must not mint. Driven for 240 consecutive days.

   Prove this round can fail: ECON_TEST_SABOTAGE=settle-requested, which
   re-commits the double ship exactly — the driver hands recordFill the quantity
   it REQUESTED in place of the quantity the server filled.
   ════════════════════════════════════════════════════════════════════════════ */
{
  console.log('\n########## round0n-city-trade ##########');
  let fails = 0;
  const chk = (name, cond, extra) => {
    if (cond) { console.log('✅ ' + name); return true; }
    fails++; console.log('❌ ' + name + (extra ? ' :: ' + extra : '')); return false;
  };

  if (!global.window) {
    global.window = { MythicCityBridge: { addCinders: async () => {} }, MythicResourceChain: null };
    const chain = await import('../../public/src/resources/chain.js');
    global.window.MythicResourceChain = { ALL: chain.RESOURCE_CHAIN };
  }
  const PP = '../../public/src/economy/';
  const Sim = await import(PP + 'sim.js');
  const Trade = await import(PP + 'trade.js');
  const HH = await import(PP + 'households.js');
  const Logis = await import(PP + 'logistics.js');
  const { ECON } = await import(PP + 'tuning.js');
  await import(PP + 'index.js');                 // registers window.MythicEconomy
  const E = global.window.MythicEconomy;
  const DAY = ECON.clock.dayMin;
  const HOST = { powerFactor: 1, waterFactor: 1, hasBank: true, infrastructure: 0.7,
                 logisticsCounts: { warehouse: 2 } };

  /* 🧨 THE INJURY: the client credits its own request instead of the server's
     answer. Written at the CALL SITE rather than by editing trade.js, because
     that is exactly the shape the bug takes in real code — the row is right
     there and the wrong field is used. */
  const SETTLE_SABOTAGE = SABOTAGE === 'settle-requested';
  const settle = (req, row) => Trade.recordFill(req, SETTLE_SABOTAGE ? { ...row, filled: req.units } : row);

  // ── §1 NOT ONE NETWORK CALL IN THE MODULE ────────────────────────────────
  /* Strip comments FIRST. trade.js and economy/index.js both talk about
     Supabase, Cloud and the bridge at length — a grep over the raw text would
     be green only by luck and red for a doc edit. */
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  const NET = [
    ['supabase', /supabase/i], ['createClient', /createClient/], ['Cloud.', /\bCloud\s*\./],
    ['fetch(', /\bfetch\s*\(/], ['XMLHttpRequest', /XMLHttpRequest/], ['WebSocket', /WebSocket/],
    ['.rpc(', /\.rpc\s*\(/], ['.from(', /\.from\s*\(\s*['"]/], ['navigator.sendBeacon', /sendBeacon/],
    ['Profile.', /\bProfile\s*\./],
  ];
  for (const f of ['trade.js', 'index.js']) {
    const raw = readFileSync(join(here, '../../public/src/economy/' + f), 'utf8');
    const src = stripComments(raw);
    chk(f + ': the comment stripper actually ran (it is what makes this check honest)',
        src.length < raw.length * 0.9, src.length + ' of ' + raw.length + ' chars left');
    const hits = NET.filter(([, re]) => re.test(src)).map(([n]) => n);
    chk('/src/economy/' + f + ' contains ZERO network calls — every one lives in ' +
        'index.html next to Cloud and Profile (the globals trap)',
        hits.length === 0, 'found: ' + hits.join(', '));
    // Rule 2: a chain resource must never be written through the game ledger.
    const led = ['addRes', 'spendRes', 'refundRes'].filter(n => new RegExp('\\b' + n + '\\s*\\(').test(src));
    chk('/src/economy/' + f + ' never calls addRes/spendRes — Rule 2, the economy ' +
        'holds its own inventory', led.length === 0, 'found: ' + led.join(', '));
  }

  // ── §2 THE INVARIANT, SWEPT ──────────────────────────────────────────────
  /* Every ASKED × FILLED pair, including the server answering more than it was
     asked for (a doctored proxy, or a future RPC change). The rule is one line:
     credit min(filled, asked), and 0 for anything that is not a positive
     finite number. */
  Sim.reset('trade-n1'); HH.setPopulation(60); Sim.bootstrap();
  const ASKED = [1, 2, 7, 13, 40, 199, 1000];
  const answers = (a) => [0, 1, Math.max(1, a - 1), a, a + 1, a * 3, -a, a / 3];
  let swept = 0, worst = null;
  for (const asked of ASKED) {
    for (const f of answers(asked)) {
      const req = { offerId: 'o-' + asked + '-' + f, res: 'steel', units: asked,
                    unitPrice: 10, partnerId: 'p1', partnerName: 'Farvale' };
      const before = Trade.pendingSettlements().reduce((n, s) => n + s.units, 0);
      const r = settle(req, { filled: f, remaining: 0, unit_price: 10 });
      const after = Trade.pendingSettlements().reduce((n, s) => n + s.units, 0);
      const expect = (f > 0) ? Math.min(f, asked) : 0;
      swept++;
      if (r.credited !== expect || Math.abs((after - before) - expect) > 1e-9) {
        const over = r.credited - expect;
        if (!worst || over > worst.over) worst = { asked, f, got: r.credited, expect, over, queued: after - before };
      }
    }
  }
  chk('settlement credits min(filled, asked) on all ' + swept + ' asked×filled cells — ' +
      'NEVER what was requested (the double-ship bug)',
      worst === null,
      worst ? ('worst cell: asked ' + worst.asked + ', server filled ' + worst.f +
               ' → credited ' + worst.got + ' (expected ' + worst.expect + '), queued ' + worst.queued) : '');

  /* The non-numeric answers, which are the ones a JSON transport actually
     produces. `numeric` comes back as a STRING from PostgREST on some
     deployments, so '25' must work and 'abc' must not. */
  const JUNK = [undefined, null, NaN, Infinity, -Infinity, 'abc', '', {}, [], true, false, () => 40];
  let junkBad = [];
  for (const v of JUNK) {
    const req = { offerId: 'j', res: 'steel', units: 40, unitPrice: 10 };
    let r; try { r = Trade.recordFill(req, { filled: v, unit_price: 10 }); }
    catch (e) { junkBad.push(String(v) + ' THREW ' + e.message); continue; }
    if (r.credited !== 0) junkBad.push(JSON.stringify(String(v)) + ' credited ' + r.credited);
  }
  chk('a non-numeric `filled` (' + JUNK.length + ' shapes) credits nothing and never throws',
      junkBad.length === 0, junkBad.slice(0, 4).join(' | '));
  const strNum = Trade.recordFill({ offerId: 's', res: 'steel', units: 40, unitPrice: 10 },
                                  { filled: '25', unit_price: '9.5' });
  chk('a numeric STRING fills normally — PostgREST returns `numeric` as a string',
      strNum.credited === 25, 'credited ' + strNum.credited);

  // ── §3 EVERY DEGRADE SHAPE, THROUGH THE SHIPPED tradeSync() ──────────────
  /* Driven through window.MythicEconomy.tradeSync() with a stub bridge, so this
     exercises the real orchestration — publish, discover, plan, settle — and not
     a test-only twin of it. */
  /* 🔴 THE OFFERS ARE DERIVED FROM THE CITY'S OWN STRATEGIC GAPS, NOT INVENTED.
     The first version of this round used a hand-written shopping list (iron ore,
     steel, bread) and planned ZERO fills for all 240 days — it asserted that
     settlement was correct while never settling anything, which is precisely the
     kind of test this project has shipped before. Two reasons it was vacuous,
     both of them real behaviour worth knowing:
       · a want's `maxPrice` is fixed at the price on the day it was raised, and
         prices roughly double over the first day of a fresh city, so an
         ordinary want will not pay today's price for anything;
       · freight is ~3 🔥/unit at these hops, which is more than a loaf of bread
         is worth — bulk goods legitimately do not travel.
     A STRATEGIC GAP is the case that does clear: the city cannot mine it at any
     price, so `urgent` bypasses the price test — the mechanism the whole feature
     exists for. Deriving the ids from Endow keeps this true if the endowment
     ever changes, instead of rotting into another vacuous round. */
  const Endow = await import(PP + 'endowment.js');
  const gapsOf = (node) => Endow.strategicGaps(node);
  const realRows = (node) => {
    const g = gapsOf(node);
    return [
      { id: 'city-A', name: 'Farvale', nodeId: 'node-A', specs: ['mining'],
        sells: { ironOre: 500, coal: 400, steel: 120 }, buys: { bread: 200, medicine: 80 },
        offers: g.slice(0, 2).map((res, i) => ({ offerId: 'off-A' + i, res, units: 300, unitPrice: 0 })) },
      { id: 'city-B', name: 'Deepmere', nodeId: 'node-B', specs: ['agricultural'],
        sells: { wheat: 900, bread: 300 }, buys: { steel: 150, lumber: 100 },
        offers: g.slice(2, 3).map((res, i) => ({ offerId: 'off-B' + i, res, units: 200, unitPrice: 0 })) },
    ];
  };
  /* The shortfall a city with those gaps really does raise. Injected through
     the SHIPPED buildWants() — the same call sim.js makes — rather than by
     writing into S.wants, so the urgency flag is set by the code under test. */
  const wantGaps = (node, units) => {
    const short = {};
    for (const id of gapsOf(node)) short[id] = units;
    Trade.buildWants(short, node, Sim.state().day);
    return short;
  };
  const mkNet = (fill, node) => ({
    publish: async () => true,
    discover: async () => realRows(node || Sim.state().nodeId),
    fill,
  });
  const mountFresh = (node) => { E.mount({ nodeId: node, population: 90 }); Sim.state().treasury = 250000; };

  /* 🔴 THE FIRST SHAPE IS A SUCCESS, AND IT IS THE MOST IMPORTANT ONE HERE.
     Every other entry in this list answers with a failure, so before it existed
     §3 asserted the credit rule against an RPC THAT NEVER ONCE SUCCEEDED: a
     tradeSync() that credited nothing at all, ever, was green through the whole
     list. "Credits nothing on failure" is only half a spec; the other half is
     "credits exactly `filled` on success", and success is the shape that runs in
     production. It is checked below on four separate counts — the quantity the
     transport was HANDED, the quantity credited, the queue, and the goods
     actually landing after a day. */
  const PARTIAL = 0.4;                       // the server fills 40% of every ask
  const SUCCESS = 'a PARTIAL fill (the normal case)';
  const SHAPES = [
    [SUCCESS, async (id, units) => ({ filled: Math.floor(units * PARTIAL), remaining: 0, unit_price: 3 })],
    ['the RPC throws',                 async () => { throw new Error('42P01 relation does not exist'); }],
    ['the RPC returns null',           async () => null],
    ['the RPC returns undefined',      async () => undefined],
    ['a malformed row ({})',           async () => ({})],
    ['a malformed row (no filled)',    async () => ({ remaining: 40, unit_price: 3 })],
    ['a non-numeric filled',           async () => ({ filled: 'plenty', unit_price: 3 })],
    ['filled: 0 (someone else took the last units)', async () => ({ filled: 0, remaining: 0, unit_price: 3 })],
    ['the raw ARRAY, unwrapped',       async () => ([{ filled: 40, unit_price: 3 }])],
    ['a timeout, answered as null',    async () => new Promise(r => setTimeout(() => r(null), 5))],
    ['the whole seam is missing',      null],
  ];
  /* The shortfall each shape raises. NOT the same number as any offer size:
     the offers below hold 300/300/200 units, so a plan built from the request
     comes out [250, 250, 200] — a multiset that matches neither the want
     ([250,250,250]) nor the offer ([300,300,200]). That is what lets the
     success shape below tell "the transport was handed req.units" apart from
     "it was handed the want" or "it was handed the whole offer". */
  const WANT = 250;
  let shapeBad = [], drive = [];
  for (const [label, fill] of SHAPES) {
    const wins = label === SUCCESS;
    mountFresh('degrade-' + label.length);
    /* 🔴 A SPY ON THE TRANSPORT, NOT JUST A STUB. The first version of this
       loop measured nothing: a freshly mounted city has an EMPTY S.wants, so
       planFills() returned [], tradeSync()'s fill loop never ran, and all ten
       "failure shapes" were asserted against a transport that was never called
       once. §3 is the ONLY coverage tradeSync()'s fill loop has — the
       substitution `recordFill(req, {...row, filled: req.units})` in
       economy/index.js would have shipped green through it. So the stub counts
       its own calls and the gate below fails if any shape got zero. */
    let calls = 0; const args = [];
    /* The spy records its ARGUMENTS as well as its call count. `units` is the
       only quantity that may reach the RPC — handing it the want, the offer
       size or a doubled figure is a different bug from mis-crediting the
       answer, and the credit assertions below cannot see it. */
    const spy = fill ? (async (offerId, units) => { calls++; args.push({ offerId, units }); return fill(offerId, units); }) : null;
    global.window.MythicCityBridge.cityTrade = spy ? mkNet(spy) : { publish: async () => false, discover: async () => [] };
    /* THE CITY MUST WANT SOMETHING BEFORE IT CAN ASK FOR IT. Raised through the
       shipped buildWants() off this node's own STRATEGIC gaps, exactly as §6
       does — those are `urgent`, which is what gets them past the maxPrice test
       on day 0 of a fresh city (see the vacuity note above §3's fixtures). */
    const node = Sim.state().nodeId;
    wantGaps(node, WANT);
    let rep = null, threw = '';
    try { rep = await E.tradeSync(); } catch (e) { threw = e.message; }
    const pending = Trade.pendingSettlements();
    const partners = Trade.state().partners.length;
    /* Measured across the SETTLED ids only, and taken before the day runs: on
       the success shape these goods must actually arrive, not merely be
       counted. */
    const invBefore = { ...Sim.inventory() };
    let snap = null;
    try { snap = Sim.advance(DAY, HOST); } catch (e) { threw = threw || ('day threw: ' + e.message); }
    const audit = Sim.state().lastAudit;
    const inv = Sim.inventory();
    const settledIds = [...new Set(pending.map(s => s.res))];
    const gain = settledIds.reduce((n, id) => n + ((inv[id] || 0) - (invBefore[id] || 0)), 0);
    /* `seam` is false only for the last shape, which has no `fill` at all and
       no real partner — it CANNOT reach the transport by construction, so it is
       held to requested === 0 rather than to requested > 0. */
    drive.push({ label, seam: !!fill, wins, node, args, requested: rep ? rep.requested : -1,
                 real: rep ? rep.real : -1, calls, credited: rep ? rep.credited : -1,
                 queued: pending.reduce((n, s) => n + s.units, 0),
                 drained: Trade.pendingSettlements().length, gain: +gain.toFixed(3) });
    if (threw) shapeBad.push(label + ' THREW ' + threw);
    /* The success shape is EXEMPT from "credits nothing" and from "queues
       nothing" — crediting is the entire point of it — and is held to the
       stricter arithmetic below instead. It is still held to the audit and to
       keeping its partners, like everything else. */
    else if (!wins && rep && rep.credited) shapeBad.push(label + ' credited ' + rep.credited);
    else if (!wins && pending.length) shapeBad.push(label + ' queued ' + pending.length);
    else if (!partners) shapeBad.push(label + ' left the city with NO partners');
    else if (!audit || !audit.ok) shapeBad.push(label + ' broke the audit');
  }
  console.log('\n  🧨 DEGRADE — did each shape actually REACH the transport?\n');
  console.log('    real  requested  RPC calls  units asked  credited  queued  landed   shape');
  for (const d of drive) {
    console.log('    ' + String(d.real).padStart(4) + String(d.requested).padStart(11) +
                String(d.calls).padStart(11) +
                String(d.args.map(a => a.units).join('+') || '—').padStart(13) +
                String(d.credited).padStart(10) + String(d.queued).padStart(8) +
                String(d.gain).padStart(8) + '   ' + d.label);
  }
  console.log('');
  const failShapes = drive.filter(d => !d.wins);
  chk('all ' + failShapes.length + ' transport failure shapes credit nothing, keep partners ' +
      'and leave the audit clean', shapeBad.length === 0, shapeBad.slice(0, 4).join(' | '));

  /* ── THE SUCCESS SHAPE, HELD TO ARITHMETIC ────────────────────────────────
     Four independent claims, because each one fails to a different mutation:
       · the transport was handed the PLANNED quantity — not the want, not the
         whole offer, not a doubled figure;
       · tradeSync() credited exactly Σ floor(asked × 0.4), the server's answer
         summed over the calls it actually made — a client that credited its own
         request would report Σ asked = the double ship, and one that credited
         nothing would report 0;
       · that quantity is sitting in the settlement queue before the day runs;
       · and one Sim.advance later the queue is empty and the goods are IN the
         city. A LOWER BOUND and not an equality here on purpose: the ids are
         this node's strategic gaps, which firms may consume inside the very day
         the delivery lands, and a partner's `sells` can move the same id again
         through the local matching pass — so the exact figure is not knowable
         from here even though it happens to come out equal today. §5 asserts
         the exact quantity, on a fixture isolated so nothing else can move. */
  const win = drive.find(d => d.wins);
  const rows = realRows(win.node);
  const expectAsked = rows.flatMap(r => r.offers).map(o => Math.min(WANT, o.units)).sort((a, b) => a - b);
  const sawAsked = win.args.map(a => a.units).slice().sort((a, b) => a - b);
  const expectCredit = win.args.reduce((n, a) => n + Math.floor(a.units * PARTIAL), 0);
  console.log('    ↳ success shape: asked ' + JSON.stringify(sawAsked) + ', plan expected ' +
              JSON.stringify(expectAsked) + ', credited ' + win.credited + ' of ' + expectCredit +
              ' expected, queued ' + win.queued + ', landed ' + win.gain + '\n');
  chk('the RPC was handed the PLANNED units on every line (' + JSON.stringify(sawAsked) + ') — ' +
      'not the want (' + WANT + ' each) and not the whole offer',
      expectAsked.length > 0 && JSON.stringify(sawAsked) === JSON.stringify(expectAsked),
      'expected ' + JSON.stringify(expectAsked));
  chk('a PARTIAL fill credits exactly Σ floor(asked × ' + PARTIAL + ') = ' + expectCredit +
      ' — the server\'s answer, summed over the calls it really made, never the request (Σ ' +
      sawAsked.reduce((a, b) => a + b, 0) + ')',
      expectCredit > 0 && win.credited === expectCredit, 'credited ' + win.credited);
  chk('…and those ' + win.queued + ' units were QUEUED for the economic day rather than booked ' +
      'between ticks (which is how firms.js once minted 721,771 🔥 with a clean audit)',
      win.queued === expectCredit, 'queued ' + win.queued);
  chk('…and one Sim.advance later the queue is drained and the goods are actually IN the city ' +
      '(+' + win.gain + ' units of the settled ids)',
      win.drained === 0 && win.gain > 0, 'drained-left ' + win.drained + ', gain ' + win.gain);
  /* 🔴 THE ANTI-VACUITY GATE FOR §3, the same rubber-stamp guard §6 carries.
     Everything above this line passes just as happily against a city that never
     planned a fill — which is exactly what §3 did before this line existed. */
  const seamShapes = drive.filter(d => d.seam);
  const vacuous = seamShapes.filter(d => !(d.requested > 0) || !(d.calls > 0));
  chk('…and every one of those ' + seamShapes.length + ' shapes ACTUALLY REACHED THE ' +
      'TRANSPORT (' + seamShapes.reduce((n, d) => n + d.calls, 0) + ' RPC calls over ' +
      seamShapes.reduce((n, d) => n + d.requested, 0) + ' planned lines) — without this ' +
      '§3 asserts ten failure modes against an RPC it never calls',
      seamShapes.length === SHAPES.length - 1 && vacuous.length === 0,
      JSON.stringify(vacuous));
  const noSeam = drive.filter(d => !d.seam);
  chk('…and the one shape with no `fill` on the bridge plans nothing rather than ' +
      'silently succeeding', noSeam.length === 1 && noSeam[0].requested === 0 && noSeam[0].calls === 0,
      JSON.stringify(noSeam));

  /* And with no bridge AT ALL — the shipping configuration until sql/038 runs. */
  mountFresh('offline-city');
  delete global.window.MythicCityBridge.cityTrade;
  let offlineRep = null, offlineThrew = '';
  try { offlineRep = await E.tradeSync(); } catch (e) { offlineThrew = e.message; }
  for (let d = 0; d < 30; d++) Sim.advance(DAY, HOST);
  chk('with NO trade seam on the bridge the city boots, degrades and keeps trading ' +
      'against simulated partners (' + Trade.state().partners.length + ' of them)',
      !offlineThrew && offlineRep && offlineRep.degraded &&
      Trade.state().partners.length > 0 && Trade.state().partners.every(p => p.simulated),
      offlineThrew || JSON.stringify(offlineRep));

  // ── §4 REAL PARTNERS ARE REAL, AND STAY REAL ─────────────────────────────
  mountFresh('mixed-city');
  Trade.setPartners(Trade.simulatedPartners('mixed-city', 3));   // as sim.js seeds them
  global.window.MythicCityBridge.cityTrade = mkNet(async () => null);
  await E.tradeSync();
  const mixed = Trade.state().partners;
  const real = mixed.filter(p => !p.simulated), fake = mixed.filter(p => p.simulated);
  chk('discovery adds the 2 real cities alongside the fabricated ones (' +
      real.length + ' real, ' + fake.length + ' simulated)',
      real.length === 2 && fake.length === 3, JSON.stringify(mixed.map(p => [p.name, p.simulated])));
  chk('p.simulated is exactly FALSE on the real ones and exactly TRUE on the fabricated ' +
      'ones — not undefined, which is what refreshPartners() would read as "leave it alone" ' +
      'by accident rather than on purpose',
      real.every(p => p.simulated === false) && fake.every(p => p.simulated === true),
      JSON.stringify(mixed.map(p => p.simulated)));

  /* Now run a day and prove refreshPartner() rewrote the fabricated inventories
     and did NOT touch the real ones. The simulated partner is drained to zero
     first so "it was refilled" is a visible event and not a coincidence. */
  const realBefore = JSON.stringify(real.map(p => [p.id, p.sells, p.buys, p.offers]));
  for (const p of fake) { p.sells = {}; p.buys = {}; }
  Sim.advance(DAY, HOST);
  const realAfter = JSON.stringify(Trade.state().partners.filter(p => !p.simulated)
                                      .map(p => [p.id, p.sells, p.buys, p.offers]));
  const refilled = Trade.state().partners.filter(p => p.simulated)
                      .every(p => Object.keys(p.sells).length > 0 || Object.keys(p.buys).length > 0);
  chk('a whole economic day later the REAL partners still hold the inventory the ' +
      'network gave them — refreshPartners() did not overwrite them with fabricated numbers',
      realBefore === realAfter, 'before ' + realBefore.slice(0, 160) + ' … after ' + realAfter.slice(0, 160));
  chk('…while the SIMULATED partners were refilled, so the refresh really did run',
      refilled, 'simulated partners came back empty');

  // ── §5 END TO END: A FILL BECOMES GOODS, AND ONLY `filled` OF THEM ───────
  /* Isolated on purpose: the only partner is a real city with EMPTY sells and
     buys, so the local matching pass can neither import nor export and every
     unit that moves this day came out of the settlement queue. */
  const e2e = [];
  for (const [asked, filled] of [[100, 40], [100, 100], [100, 0], [60, 25]]) {
    mountFresh('e2e-' + asked + '-' + filled);
    Trade.setPartners([{ id: 'city-A', name: 'Farvale', nodeId: 'node-A', specs: [],
                         sells: {}, buys: {}, offers: [], simulated: false }]);
    const invBefore = { ...Sim.inventory() }, treBefore = Sim.state().treasury;
    const req = { offerId: 'off-X', res: 'steel', units: asked, unitPrice: 12,
                  partnerId: 'city-A', partnerName: 'Farvale' };
    const r = settle(req, { filled, remaining: 0, unit_price: 12 });
    Sim.advance(DAY, HOST);
    const got = (Sim.inventory().steel || 0) - (invBefore.steel || 0);
    const paid = treBefore - Sim.state().treasury;
    const want = Math.min(filled, asked);
    e2e.push({ asked, filled, credited: r.credited, landed: +got.toFixed(3), want,
               paid: Math.round(paid), audit: !!(Sim.state().lastAudit || {}).ok });
  }
  console.log('\n  🤝 SETTLEMENT, END TO END — asked / server filled / units landed\n');
  console.log('    asked  filled  credited   landed  expected   audit');
  for (const r of e2e) {
    console.log('    ' + String(r.asked).padStart(5) + String(r.filled).padStart(8) +
                String(r.credited).padStart(10) + String(r.landed).padStart(9) +
                String(r.want).padStart(10) + (r.audit ? '      ok' : '    FAIL'));
  }
  console.log('');
  /* 🔴 AN EQUALITY, NOT A CEILING. This read `landed > want + 1e-6` — "never
     MORE than the server filled" — which is only the half of the rule that
     catches the double ship. A settlement that delivered NOTHING at all passed
     it just as happily: drop the drain, or queue the goods and never book them,
     and every cell lands 0 ≤ want and the round stays green. The fixture is
     isolated precisely so that the exact number is knowable (the only partner
     is a real city with empty sells and buys, so nothing else can move steel),
     so there is no excuse for asserting less than the exact number. */
  const e2eBad = e2e.filter(r => Math.abs(r.landed - r.want) > 1e-6 || r.credited !== r.want || !r.audit);
  chk('the units that actually LAND in the city are EXACTLY what the server filled — ' +
      'no more (the double ship) and no fewer (a settlement that quietly delivers ' +
      'nothing) — on every cell, and the audit stays clean through settlement',
      e2eBad.length === 0, JSON.stringify(e2eBad));
  const zero = e2e.find(r => r.filled === 0);
  chk('filled: 0 lands NOTHING and moves no Cinder (the last-40-units race: both ' +
      'buyers must not be told 40)',
      zero && zero.landed === 0 && zero.credited === 0, JSON.stringify(zero));

  // ── §6 RULE 1: A TRADE MOVES VALUE, IT DOES NOT MINT ─────────────────────
  /* 240 consecutive days with settlement live on most of them. The audit is
     re-checked every single day rather than at the end, because a mint on day 3
     that is spent by day 240 leaves no trace in the closing balance. */
  mountFresh('rule1-city');
  Trade.setPartners(realRows('rule1-city'));
  let auditBad = '', days = 0, minted = 0, filledTotal = 0, planned = 0;
  for (let d = 0; d < 240; d++) {
    if (d % 3 !== 2) {
      wantGaps('rule1-city', 120);
      const plan = Trade.planFills(Sim.state().treasury, Sim.state().day);
      planned += plan.length;
      for (const req of plan) {
        // The server fills a random-but-deterministic PART of every request.
        const part = Math.max(0, Math.floor(req.units * ((d % 5) / 4)));
        const r = settle(req, { filled: part, remaining: 0, unit_price: req.unitPrice });
        filledTotal += r.credited;
      }
    }
    Sim.advance(DAY, HOST);
    days++;
    const a = Sim.state().lastAudit;
    if (!a || !a.ok) { auditBad = 'day ' + d + ' ' + JSON.stringify(a); break; }
    if (a.err > a.tol) minted++;
  }
  chk('Rule 1 — the closed-loop audit is clean on all ' + days + ' days with real ' +
      'settlement running (' + Math.round(filledTotal) + ' units filled)',
      auditBad === '' && minted === 0, auditBad || (minted + ' days minted'));
  chk('…and payouts were never suspended, which is what a failed audit does',
      Sim.state().payoutAllowed === true, 'payoutAllowed is false');
  /* 🔴 THE ANTI-VACUITY GATE. Everything above this line would pass just as
     happily against a city that never traded at all — which is exactly how the
     first draft of this round passed while planning nothing. If settlement
     stops happening, this round must go RED rather than quietly become a
     rubber stamp. */
  chk('…and settlement ACTUALLY RAN over those days (' + planned + ' fills planned, ' +
      Math.round(filledTotal) + ' units credited) — without this the round above is a rubber stamp',
      planned > 0 && filledTotal > 0, planned + ' planned / ' + filledTotal + ' credited');

  // ── §7 THE PLAN NEVER OUTRUNS THE CASH OR THE OFFER ──────────────────────
  mountFresh('plan-city');
  Trade.setPartners(realRows('plan-city'));
  Sim.advance(DAY, HOST);
  wantGaps('plan-city', 500);
  const plan = Trade.planFills(Sim.state().treasury, Sim.state().day);
  const offerUnits = {};
  for (const row of realRows('plan-city')) for (const o of row.offers) offerUnits[o.offerId] = o.units;
  const planBad = plan.filter(p => !(p.units > 0) || p.units > offerUnits[p.offerId] ||
                                   !isFinite(p.unitPrice) || p.unitPrice <= 0);
  chk('every planned fill is positive, finite, priced, and within the offer it targets (' +
      plan.length + ' lines)', plan.length > 0 && planBad.length === 0,
      plan.length ? JSON.stringify(planBad.slice(0, 3)) : 'the plan was EMPTY — this check would pass vacuously');
  /* A plan is capped by the cash on hand, and that has to be true against a
     REAL budget rather than the 250,000 🔥 the fixture hands the city. */
  const poor = Trade.planFills(1, Sim.state().day);
  chk('a city with 1 🔥 plans nothing it cannot pay for', poor.length === 0, JSON.stringify(poor));
  chk('the plan never exceeds the open-trade-line bound (ECON.trade.maxOpenOffers = ' +
      ECON.trade.maxOpenOffers + ')', plan.length <= ECON.trade.maxOpenOffers, 'planned ' + plan.length);

  // ── §8 A HOSTILE ROW CANNOT PRICE THE CITY OUT OR GIVE IT FREE GOODS ─────
  const hostile = [0, -5, 1e12, NaN, Infinity, 'free', null];
  const band = hostile.map(q => Trade.fillPrice('steel', q));
  const local = (await import(PP + 'prices.js')).priceOf('steel');
  const lo = local * (1 - ECON.trade.spreadPct), hi = local * (1 + ECON.trade.spreadPct) * ECON.trade.specPriority;
  chk('a counterparty-controlled unit_price is clamped into this city\'s own spread ' +
      '(' + lo.toFixed(2) + '–' + hi.toFixed(2) + ' 🔥) — 0 would be free goods forever ' +
      'and 1e12 would empty the treasury in a day',
      band.every(p => isFinite(p) && p >= lo - 1e-9 && p <= hi + 1e-9), JSON.stringify(band));

  if (fails) { bad++; console.log('\n=== ROUND 0n: ' + fails + ' FAILED ==='); }
  else console.log('\n=== ROUND 0n: ALL PASS ===');
}

/* ════════════════════════════════════════════════════════════════════════════
   ROUND 0p — 🧰 EVERY LEDGER RESOURCE HAS A PRODUCER, AND THE PROMOTION SET IS
              A DERIVATION RATHER THAN A LIST SOMEBODY LIKED
   ----------------------------------------------------------------------------
   🔴 THE FAILURE THIS DEFENDS AGAINST IS THE ONE RESOURCES_NEXT.md IS ABOUT.
   The r12 notes, verbatim:

     > "A resource you can loot, bank, and be capped by — but cannot sell, spend,
     >  make, or see. That is not 'wood is missing'; it is worse than missing,
     >  because the player's pile of it is real and inert."

   index.html's RESOURCES just grew 14 → 70. Every one of the 56 new ids is a
   vault row, a market listing, a cost leg and a share of the stash cap from the
   moment it appears in that array — and NONE of them is in SALVAGE_RES, so
   unlike wood/stone/cloth there is not even a loot table behind them. An id
   promoted without a producer is therefore strictly inert, and NOTHING ELSE IN
   THIS REPO NOTICES: the vault renders it at 0, the market lists it, the audit
   is untouched, the console is clean.

   So this round asserts the two halves of "a resource is promoted TOGETHER with
   its producer, never before it":

     DERIVATION   the promoted set IS
                    { every `out` id of ECO_BUILDING_MAP, ops join applied }
                    ∩ MythicResourceChain.NEW_IDS
                  recomputed here from the SHIPPED node-city file, and compared
                  against BOTH copies that had to be written by hand (RESOURCES
                  in index.html, PROMOTED_CHAIN_IDS in production.data.js).
                  Neither copy may drift in either direction.
     PRODUCER     every id in RESOURCE_IDS is yielded by some CITY_PRODUCTION
                  building, plus the whole of auditCatalog() against the REAL 70
                  rather than its own fallback list.

   …and three things the promotion could have broken silently:

     TERROIR      the slot bag has to sum to the ledger size or profileFor()
                  turns the entire feature off behind one console.warn. Swept
                  over every n from 1 to 258, failing on the WORST cell — not on
                  three lucky points, and not on 70 alone.
     ICONS        node-city's RES_META seeds itself from the catalogue with
                  EXISTING KEYS WINNING, because those icons were chosen for that
                  HUD (stone is 🪨 and not 🧱, which is CITY_STOCK.ingots). The
                  seeding join is re-run here and the hand-picked glyphs are
                  asserted by value.
     RULE 2       promotion changes what the CAMP can hold, price, show and make.
                  It must NOT make the chain writable through the ledger:
                  /src/economy still calls neither addRes nor spendRes, and no
                  node-city BUILDINGS row gen/use/costs a promoted id. Both are
                  checked against comment-stripped source, so a mention in prose
                  cannot pass for a call and a call cannot hide in a comment.

   ── PROVE IT CAN FAIL ──────────────────────────────────────────────────────
     ECON_TEST_SABOTAGE=no-producer   remove the CITY_PRODUCTION building that
                                      yields `timber` — i.e. promote one id and
                                      forget its producer, the exact mistake this
                                      round exists for. Turns the producer check
                                      AND auditCatalog rule 1 red.
     ECON_TEST_SABOTAGE=promo-drift   add one plausible id (`flour`) to the
                                      promoted set without touching the map. A
                                      hand-extended list is the other way this
                                      goes wrong, and it must be just as red.
   ════════════════════════════════════════════════════════════════════════════ */
{
  console.log('\n########## round0p-ledger-promotion ##########');
  let fails = 0;
  const chk = (name, cond, extra) => {
    if (cond) { console.log('✅ ' + name); return true; }
    fails++; console.log('❌ ' + name + (extra ? ' :: ' + extra : '')); return false;
  };
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  const NC_PATH  = join(here, '../../public/node-city/index.html');
  const IDX_PATH = join(here, '../../public/index.html');
  let NC = null, IDX = null;
  try { NC = readFileSync(NC_PATH, 'utf8'); } catch (e) { NC = null; }
  try { IDX = readFileSync(IDX_PATH, 'utf8'); } catch (e) { IDX = null; }

  const litFrom = (src, decl, open) => {
    const txt = srcBlockAfter(src, decl, open);
    if (!txt) return null;
    try { return (new Function('return (' + txt + ');'))(); } catch (e) { return null; }
  };
  /* BUILDINGS is NOT a pure literal — several rows price themselves off
     STOCK_CAP_PER_WAREHOUSE and friends — so it is read the way round0f and
     round0h already read it: evaluated inside a `with` over a Proxy that answers
     0 for every free identifier. Only KEY NAMES matter to the Rule 2 check
     below, and those survive the flattening intact. */
  const looseFrom = (src, decl) => {
    const txt = srcBlockAfter(src, decl);
    if (!txt) return null;
    try {
      const scope = new Proxy({}, { has: () => true, get: (t, k) => (k === Symbol.unscopables ? undefined : 0) });
      return new Function('__s', 'with (__s) { return (' + txt + '); }')(scope);
    } catch (e) { return null; }
  };

  const STATIC = litFrom(NC, 'const ECO_BUILDING_MAP = {');
  const OPMAP  = litFrom(NC, 'const OP_ECO_MAP = {');
  const BLDG   = looseFrom(NC, 'const BUILDINGS = {');
  const STOCK  = litFrom(NC, 'const CITY_STOCK = {');
  const METAH  = litFrom(NC, 'const RES_META = {');
  const RES    = litFrom(IDX, 'const RESOURCES = [', '[');
  const pm     = NC ? /const\s+OPS_PREFIX\s*=\s*'([^']*)'/.exec(NC) : null;
  const PREFIX = pm ? pm[1] : null;

  /* 🔴 THE VACUOUS-TRIPWIRE GUARD, same rule as round0b: a scrape that matches
     nothing would "pass" every assertion below over empty sets, and that is a
     worse state than having no round at all — the comments in index.html and
     production.data.js both promise this check exists. Read fails ⇒ stop. */
  const gotAll =
    chk('read public/index.html and node-city/index.html',
        !!NC && !!IDX && NC.length > 100000 && IDX.length > 1000000,
        (NC ? NC.length : 'NC UNREADABLE') + ' / ' + (IDX ? IDX.length : 'IDX UNREADABLE')) &
    chk('extracted ECO_BUILDING_MAP / OP_ECO_MAP / OPS_PREFIX / BUILDINGS / CITY_STOCK / RES_META / RESOURCES',
        !!STATIC && !!OPMAP && !!PREFIX && !!BLDG && !!STOCK && !!METAH && Array.isArray(RES) && RES.length > 10,
        [STATIC, OPMAP, BLDG, STOCK, METAH, RES].map(o => o ? (Array.isArray(o) ? o.length : Object.keys(o).length) : 'NULL').join('/') + ' prefix=' + PREFIX);

  if (!gotAll) {
    console.log('\n🔴 THE SOURCE COULD NOT BE READ — nothing below was checked.');
    console.log('   If a declaration was renamed or moved, fix the `litFrom` markers in this round.');
    console.log('   Do NOT delete it: index.html\'s RESOURCES block and production.data.js both');
    console.log('   carry a comment saying round0p re-derives them.');
    bad++; console.log('\n=== ROUND 0p: ' + fails + ' FAILED ===');
  } else {
    // ── 1. THE DERIVATION, re-run from the shipped map ─────────────────────
    if (!global.window) global.window = { MythicCityBridge: { addCinders: async () => {} } };
    const chain = await import('../../public/src/resources/chain.js');
    const MAP = { ...STATIC };
    for (const t of Object.keys(OPMAP)) MAP[PREFIX + t] = OPMAP[t];

    const outs = new Set();
    for (const k of Object.keys(MAP)) for (const o of (MAP[k].out || [])) outs.add(o);
    const NEWSET = new Set(chain.NEW_IDS);
    const DERIVED = Array.from(outs).filter(id => NEWSET.has(id)).sort();

    /* Floors, not equalities: adding a building must not require editing this
       file, but a scrape that suddenly returns a handful must fail. Both shipped
       figures are printed every run so a real drop is visible. */
    chk('the derivation is non-vacuous (map ' + Object.keys(MAP).length + ' buildings, ' +
        outs.size + ' distinct outputs, catalogue ' + chain.NEW_IDS.length + ' new ids)',
        Object.keys(MAP).length >= 40 && outs.size >= 40 && chain.NEW_IDS.length >= 200,
        Object.keys(MAP).length + '/' + outs.size + '/' + chain.NEW_IDS.length);
    console.log('\n  promotion rule: ECO_BUILDING_MAP.out (ops join) ∩ chain.NEW_IDS');
    console.log('  → ' + DERIVED.length + ' ids: ' + DERIVED.join(', '));
    console.log('  outputs NOT promoted because index.html already defines them: ' +
                Array.from(outs).filter(id => !NEWSET.has(id)).sort().join(', ') + '\n');
    chk('the derived promotion set has at least 50 ids (shipped: ' + DERIVED.length + ')',
        DERIVED.length >= 50, String(DERIVED.length));

    // ── 2. BOTH HAND COPIES ARE EXACTLY THE DERIVATION ─────────────────────
    const PD = await import('../../public/src/city/production.data.js');
    let PROMOTED = PD.PROMOTED_CHAIN_IDS.slice().sort();
    if (SABOTAGE === 'promo-drift') {
      PROMOTED = PROMOTED.concat(['flour']).sort();
      console.log('   🧨 added `flour` to PROMOTED_CHAIN_IDS — a plausible id with no building behind it');
    }
    chk('production.data.js PROMOTED_CHAIN_IDS === the derivation (' + PROMOTED.length + ' vs ' + DERIVED.length + ')',
        same(PROMOTED, DERIVED),
        'only in the file: [' + PROMOTED.filter(x => !DERIVED.includes(x)).join(', ') +
        '] · only in the derivation: [' + DERIVED.filter(x => !PROMOTED.includes(x)).join(', ') + ']');

    const RIDS = RES.map(r => r.id);
    /* 🔴 THE PRE-PROMOTION LEDGER, WRITTEN OUT AS A LITERAL — and it has to be.
       The first draft of this section computed `LEGACY = RIDS.filter(id =>
       !DERIVED.includes(id))`, which is the complement of DERIVED by
       construction, so "nothing outside LEGACY ∪ DERIVED" was true of EVERY
       possible RESOURCES array and the check could not fail. Driven: adding
       `flour` to RESOURCES left it green. A literal is the only version of this
       assertion that has any content — it is the r12 fourteen, it does not move,
       and if it ever does that is a decision worth a red gate. */
    const LEGACY14 = ['food', 'ammo', 'water', 'medicine', 'energyDrink', 'supplies', 'metal',
                      'fuel', 'corruptedEssence', 'memoryShards', 'dna', 'wood', 'stone', 'cloth'];
    chk('index.html RESOURCES = the 14 legacy ids + EXACTLY the derivation, in that order (' + RIDS.length + ')',
        same(RIDS, LEGACY14.concat(DERIVED)),
        RIDS.length + ' ids vs ' + (LEGACY14.length + DERIVED.length) + ' expected');
    /* …and the same statement said as a SET, so the failure names the offender
       instead of only saying the arrays differ. This is the criterion "no id was
       promoted without a producer" in its contrapositive form: it is not enough
       that the derivation ⊆ RESOURCES, nothing else may ride in beside it. */
    const orphan = RIDS.filter(id => !LEGACY14.includes(id) && !DERIVED.includes(id));
    const missing = DERIVED.filter(id => !RIDS.includes(id));
    chk('no id was promoted that the derivation does not justify, and none it does was left out',
        orphan.length === 0 && missing.length === 0,
        'unjustified: [' + orphan.join(', ') + '] · missing: [' + missing.join(', ') + ']');

    // ── 3. …AND THE LEDGER AND THE CATALOGUE AGREE ON WHAT EACH ONE IS ─────
    const metaBad = [];
    for (const id of DERIVED) {
      const row = RES.find(r => r.id === id), c = chain.chainById(id);
      if (!row || !c) { metaBad.push(id + ' → missing'); continue; }
      if (row.name !== c.name)   metaBad.push(id + ' name ' + row.name + ' ≠ ' + c.name);
      if (row.icon !== c.icon)   metaBad.push(id + ' icon ' + row.icon + ' ≠ ' + c.icon);
      if (row.color !== c.color) metaBad.push(id + ' color ' + row.color + ' ≠ ' + c.color);
    }
    chk('every promoted RESOURCES row matches chain.js name/icon/colour verbatim — the camp and the city must print the same glyph',
        metaBad.length === 0, metaBad.slice(0, 6).join(' | '));

    // ── 4. THE PRODUCER. THIS IS THE TRIPWIRE. ─────────────────────────────
    if (SABOTAGE === 'no-producer') {
      const i = PD.CITY_PRODUCTION.findIndex(b => b.yields && b.yields.timber);
      if (i >= 0) { console.log('   🧨 removed ' + PD.CITY_PRODUCTION[i].id + ' — `timber` is now promoted with no producer'); PD.CITY_PRODUCTION.splice(i, 1); }
    }
    const produced = new Set();
    PD.CITY_PRODUCTION.forEach(b => Object.keys(b.yields || {}).forEach(r => produced.add(r)));
    const noProd = RIDS.filter(id => !produced.has(id));
    console.log('  ' + PD.CITY_PRODUCTION.length + ' CITY_PRODUCTION buildings yield ' + produced.size + ' distinct ids');
    chk('EVERY id in RESOURCES has a building that yields it — else the pile is real and inert',
        noProd.length === 0, 'no producer for: ' + noProd.join(', '));

    /* auditCatalog against the REAL ledger, not its own fallback: rule 1 (a
       producer), 2 (never priced only in what it makes), 3 (≥3 resource legs),
       4 (every cost key is a real resource) and 5 (the top tier pulls a rare),
       over all 71 buildings including the 56 generated ones. */
    const problems = PD.auditCatalog(RIDS);
    chk('auditCatalog() is clean against the live ' + RIDS.length + '-id ledger',
        problems.length === 0, problems.slice(0, 8).join(' | ') + (problems.length > 8 ? ` … +${problems.length - 8}` : ''));
    /* A producer with no way to be reached is the same bug one level up. */
    const badPrereq = [];
    for (const k of Object.keys(PD.CITY_PREREQ)) {
      if (!PD.cityProdDef(k)) badPrereq.push(k + ' → not a building');
      for (const need of (PD.CITY_PREREQ[k] || [])) if (!PD.cityProdDef(need)) badPrereq.push(k + ' needs ' + need + ' → not a building');
    }
    chk('every CITY_PREREQ key and every prerequisite names a real building',
        badPrereq.length === 0, badPrereq.slice(0, 6).join(' | '));

    // ── 5. TERROIR — swept, and failing on the worst cell ──────────────────
    const T = (await import('../../public/src/city/terroir.js')).default;
    chk('terroir FALLBACK_IDS (via resourceIds() with no host) === RESOURCES',
        same(T.resourceIds().slice().sort(), RIDS.slice().sort()),
        T.resourceIds().length + ' vs ' + RIDS.length);
    chk('slotsFor(14) reproduces the shipped r12 row { RICH 3, COMMON 5, SCARCE 4, BARREN 2 } exactly',
        JSON.stringify(T.slotsFor(14)) === JSON.stringify({ RICH: 3, COMMON: 5, SCARCE: 4, BARREN: 2 }),
        JSON.stringify(T.slotsFor(14)));
    let worstSum = null, worstNeg = null, worstBarren = null;
    for (let n = 1; n <= 258; n++) {
      const s = T.slotsFor(n);
      const tot = s.RICH + s.COMMON + s.SCARCE + s.BARREN;
      if (tot !== n && !worstSum) worstSum = 'n=' + n + ' sums to ' + tot + ' ' + JSON.stringify(s);
      if (Math.min(s.RICH, s.COMMON, s.SCARCE, s.BARREN) < 0 && !worstNeg) worstNeg = 'n=' + n + ' ' + JSON.stringify(s);
      const wantB = Math.min(2, Math.max(0, n - 1));
      if (s.BARREN !== wantB && !worstBarren) worstBarren = 'n=' + n + ' BARREN ' + s.BARREN + ' want ' + wantB;
    }
    chk('the slot bag sums to n for EVERY n in 1…258 — a short bag silently disables terroir', !worstSum, worstSum);
    chk('no slot count is ever negative across 1…258', !worstNeg, worstNeg);
    chk('BARREN stays the absolute 2 the r12 reasoning fixed (clamped only below n=3)', !worstBarren, worstBarren);
    /* And the live ledger actually gets a COMPLETE profile — the check that
       would have caught 14-slots-against-70-ids. An `undefined` tier reads as a
       NaN multiplier and silently zeroes a payout. */
    const prof = T.profileFor('round0p-node', null, RIDS);
    const holes = RIDS.filter(id => !prof[id]);
    const tiers = {}; RIDS.forEach(id => { tiers[prof[id]] = (tiers[prof[id]] | 0) + 1; });
    chk('profileFor() gives all ' + RIDS.length + ' ids a tier — ' + JSON.stringify(tiers),
        holes.length === 0, holes.join(', '));
    chk('…and it is NOT the all-COMMON degraded fallback (which is what a wrong bag looks like)',
        tiers.COMMON !== RIDS.length && (tiers.BARREN | 0) === 2, JSON.stringify(tiers));

    // ── 6. NODE-CITY: the deliberate icons survived the catalogue seeding ──
    /* 🔴 THIS IS TESTED WITH A POISONED CATALOGUE ON PURPOSE, and the first
       draft of it was worthless without that. The shipped chain.js happens to
       give `stone` the same 🪨 the hand table does, so comparing the joined
       result against the hand values passes whether the `!RES_META[r.id]` guard
       is there or not — deleting the guard, or deleting the whole `stone` row,
       both stayed green. Measured, not assumed.
       So the join is re-run against a catalogue where stone is 🧱 (the glyph the
       comment explicitly rejects, because 🧱 is CITY_STOCK.ingots and the two
       would sit side by side in the same HUD) and wood is 🌲. If EXISTING KEYS
       WIN, the hand glyphs survive that. If the guard is ever flipped, they do
       not, and this line says so. */
    const POISON = chain.RESOURCE_CHAIN.map(r => (
      r.id === 'stone' ? { ...r, icon: '🧱' } : r.id === 'wood' ? { ...r, icon: '🌲' } : r));
    chk('the poisoned catalogue really differs from the hand table (else the test below is vacuous)',
        POISON.some(r => r.id === 'stone' && r.icon !== METAH.stone.ico) &&
        POISON.some(r => r.id === 'wood' && r.icon !== METAH.wood.ico), 'poison did not take');
    /* …and the join under test is the SHIPPED ONE, lifted out of node-city and
       re-run here, not a paraphrase of it. round0f does the same with the ops
       registration loop and for the same reason: a re-implementation tests the
       copy in this file, and the guard that matters (`!RES_META[r.id]`) is one
       character wide. Deleting it in node-city must turn this red. */
    const SEED_BODY = srcBlockAfter(NC, 'for (const r of _chain.ALL)');
    chk('lifted the RES_META seeding loop out of node-city (' + (SEED_BODY ? SEED_BODY.length : 'NULL') + ' chars)',
        !!SEED_BODY && SEED_BODY.includes('RES_META'), String(SEED_BODY));
    const SEEDED = { ...METAH };
    if (SEED_BODY) {
      try { new Function('RES_META', '_chain', 'for (const r of _chain.ALL) ' + SEED_BODY)(SEEDED, { ALL: POISON }); }
      catch (e) { chk('the lifted seeding loop runs', false, e.message); }
    }
    const HAND = { stone: '🪨', metal: '🔩', food: '🥫', fuel: '⛽', wood: '🪵', cloth: '🧵' };
    const stomped = Object.keys(HAND).filter(k => !SEEDED[k] || SEEDED[k].ico !== HAND[k]);
    chk('RES_META keeps its hand-picked glyphs when the catalogue disagrees — existing keys WIN (stone stays 🪨, not 🧱)',
        stomped.length === 0, stomped.map(k => k + ' is ' + (SEEDED[k] ? SEEDED[k].ico : 'GONE') + ' want ' + HAND[k]).join(', '));
    const unnamed = DERIVED.filter(id => !SEEDED[id] || !SEEDED[id].ico || !SEEDED[id].name);
    chk('every promoted id has a name and an icon in node-city RES_META — `RES_META[r].ico` is read UNGUARDED at the shortage warning',
        unnamed.length === 0, unnamed.join(', '));

    // ── 7. RULE 2 — promotion did NOT open a ledger write for the chain ────
    /* Comments stripped first, in BOTH directions: /src/economy is full of prose
       about addRes (that is how the rule is documented) and a real call must not
       be able to hide inside a block comment either. */
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1 ');
    const ECOFILES = ['sim.js', 'index.js', 'firms.js', 'trade.js', 'recipes.js', 'logistics.js',
                      'households.js', 'prices.js', 'bank.js', 'construction.js', 'endowment.js', 'bottleneck.js'];
    const ecoHits = [];
    for (const f of ECOFILES) {
      let s = null;
      try { s = readFileSync(join(here, '../../public/src/economy/' + f), 'utf8'); } catch (e) { continue; }
      const code = strip(s);
      for (const m of code.matchAll(/\b(addRes|spendRes)\s*\(/g)) ecoHits.push(f + ' → ' + m[1] + '(');
    }
    chk('/src/economy calls neither addRes nor spendRes anywhere in code (' + ECOFILES.length + ' files scanned) — the ONLY ledger write is the audited addCinders payout',
        ecoHits.length === 0, ecoHits.join(', '));
    /* The other half of the same rule, from the city side: economyTick banks
       `def.gen` keys through MythicCityBridge.addRes and charges `def.use` /
       `cost` keys through spendRes. If a promoted id ever appears in one of
       those, the economy's private inventory and the camp ledger have been
       joined and Rule 2 is broken — regardless of what /src/economy does. */
    const PSET = new Set(DERIVED);
    const bldHits = [];
    for (const [k, d] of Object.entries(BLDG)) {
      for (const slot of ['gen', 'use', 'cost']) {
        for (const r of Object.keys((d && d[slot]) || {})) {
          if (PSET.has(r) && !STOCK[r]) bldHits.push(k + '.' + slot + '.' + r);
        }
      }
    }
    /* Anti-vacuity: the loose eval must have produced a BUILDINGS with real
       gen/use/cost maps on it. If it flattened them the check above would pass
       over an empty set, which is the failure mode round0b's header warns about
       and the reason `farm.gen.food` is named here by hand. */
    const slotted = Object.keys(BLDG).filter(k => BLDG[k] && (BLDG[k].gen || BLDG[k].use)).length;
    chk('BUILDINGS really carries gen/use maps (the loose eval did not flatten it): ' + slotted + ' rows, farm.gen.food present',
        slotted >= 10 && !!(BLDG.farm && BLDG.farm.gen && BLDG.farm.gen.food), String(slotted));
    chk('no node-city BUILDINGS row gens, uses or costs a promoted chain id (' + Object.keys(BLDG).length + ' rows) — the city banks none of them',
        bldHits.length === 0, bldHits.join(', '));
    chk('…and none of the 56 collides with a CITY_STOCK key (rations/ingots/planks…), which would make one id mean two things',
        DERIVED.filter(id => STOCK[id]).length === 0, DERIVED.filter(id => STOCK[id]).join(', '));

    // ── 8. THE CACHE-BUST PAIR ────────────────────────────────────────────
    /* production.data.js imports chain.js WITH the query string so there is one
       module instance rather than two. That only holds while the two strings
       match, and nothing else would ever notice them diverging. */
    const tagV = /src\/resources\/chain\.js\?v=([^"']+)/.exec(IDX);
    let pdSrc = null;
    try { pdSrc = readFileSync(join(here, '../../public/src/city/production.data.js'), 'utf8'); } catch (e) {}
    /* Anchored on `from '…'` rather than on the bare path: the comment above the
       import quotes the same URL to explain itself, and a looser pattern reads
       the PROSE instead of the code — which is how a check like this ends up
       green against a file that does not import anything at all. */
    const impV = pdSrc ? /\bfrom\s*'[^']*resources\/chain\.js\?v=([^']+)'/.exec(pdSrc) : null;
    chk('production.data.js imports chain.js at the SAME ?v= as index.html\'s script tag (one module instance, not two)',
        !!tagV && !!impV && tagV[1] === impV[1],
        (tagV ? tagV[1] : 'no tag') + ' vs ' + (impV ? impV[1] : 'no import'));

    if (fails) { bad++; console.log('\n=== ROUND 0p: ' + fails + ' FAILED ==='); }
    else console.log('\n=== ROUND 0p: ALL PASS ===');
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   ROUND 0q — 🎁 THE LOOT POOL IS NOT THE LEDGER
   ----------------------------------------------------------------------------
   🔴 THE DEFECT THIS ROUND EXISTS FOR, MEASURED, NOT ASSERTED.
   `RESOURCES` answers ONE question: "what can the camp HOLD?". Three random-
   reward sites were reading it — via RESOURCE_IDS — to answer a completely
   DIFFERENT one: "what does a scavenging run BRING BACK?". The two answers were
   the same array only for as long as the ledger happened to BE the 14 camp
   staples. Then commit 3a5d7da4 ("Promote the 56 producible chain resources
   into the camp ledger") took RESOURCES 14 → 70, and with NOT ONE LINE CHANGED
   at any of the three sites every loot pool was diluted 5× in a single commit.

   Measured by evaluating the SHIPPED expression at each site, on three trees:

     site                    f8563fad (14)   8587778 (70, pre-fix)   fixed
     _campGrantLoot           100.00%          20.04%               100.00%
     _smugglerDeal            100.00%          20.07%               100.00%
     container resPool        100.00%          20.12%               100.00%
     _resStashFloor()          2,002           10,010                2,002

   …where the percentage is the share of drawn resources that is one of the 14
   the player can actually EAT, BURN, CRAFT OR SPEND. So every expedition's
   food / ammo / water / metal / supplies income fell to ×0.20 overnight and 4
   drops in 5 became an id with no consumer: not in CONSUMABLE_RESOURCES, in no
   craft recipe, and /src/economy is FORBIDDEN to spend it (Rule 2). A drop you
   cannot use is not income; against a shared stash ceiling it is a tax.

   ── WHY THE ROUND IS SHAPED THIS WAY ────────────────────────────────────────
   The bug class is "ADDING TO `RESOURCES` CHANGES SOMETHING THAT READS
   `RESOURCE_IDS` FOR A DIFFERENT PURPOSE", and there WILL be more promotions —
   RESOURCES_NEXT.md has 258 chain ids queued behind these 56. A round that only
   asserted "the fix is present" — a grep for `_lootResRows` — would be green the
   day one of these three sites is rewritten to draw the same wrong pool a
   different way. So this one MEASURES OUTPUT:

   ⚠ AND IT MEASURES EXACTLY THREE SITES, WHICH IS LESS THAN THIS HEADER USED TO
     CLAIM. The sentence above read "…would be green the day someone adds a
     fourth reward site"; that overstated the round by one claim. COMPOSITION
     scrapes `_campGrantLoot`, `_smugglerDeal` and `_campLootContainer` BY NAME
     (see the `stmtIn` / `fnText` calls below) and draws from what it finds
     there. A brand-new fourth reward site reading RESOURCE_IDS is invisible to
     it — nothing here enumerates reward sites, and nothing can, short of a
     whole-file scan for `addRes` that this round does not do. What COVERAGE
     does cover is the other half: a new ID cannot arrive undeclared. A new
     SITE still can, and finding it is a reviewer's job, not this round's.

     COMPOSITION  evaluate the real pick expression scraped out of each of the
                  three call sites and draw >= 100,000 times. The observed set of
                  ids must be EXACTLY the declared loot pool. This is what goes
                  red if a site is pointed back at the ledger, however it is
                  spelled — no grep to outwit, no fix to name.
     COVERAGE     every id in RESOURCES must be CLASSIFIED: lootable (in
                  LOOT_RES_IDS) or city-made (in the chain derivation round0p
                  already computes). An id that is neither is a promotion nobody
                  decided the loot status of, and that is the whole failure mode.
     WIRING       the pool ⊆ the ledger (an id in the pool with no RESOURCES row
                  would be drawable by _lootResPick and invisible to
                  _lootResRows, so the smuggler and the container would disagree
                  about what exists), the weights live in config and no call site
                  names a number, and the bag is never empty.
     STASH        _resStashFloor() is derived from the LOOT pool, not the ledger.

   ⚠ THE COMPOSITION CHECK IS DELIBERATELY BLIND TO THE FIX'S MECHANISM. It
     evaluates whatever text is at the call site today. Rewrite the pool as a
     filter, a tier flag or a second array and this round keeps working; point
     any site back at RESOURCES and it goes red no matter how it is written.

   ── PROVE IT CAN FAIL ──────────────────────────────────────────────────────
     ECON_TEST_SABOTAGE=loot-ledger  re-commit the pre-fix draw at all three
                                     sites. COMPOSITION goes red and reprints the
                                     ~20% dilution above — the regression itself.
     ECON_TEST_SABOTAGE=loot-promo   promote a fake id (`flour`) into RESOURCES
                                     without declaring it lootable. COMPOSITION
                                     stays GREEN — that is the fix working, an
                                     unrelated promotion may not move the pool —
                                     and COVERAGE goes red instead, which is the
                                     assertion that forces the next promotion to
                                     SAY which side the new id is on.
   ════════════════════════════════════════════════════════════════════════════ */
{
  console.log('\n########## round0q-loot-pool ##########');
  let fails = 0;
  const chk = (name, cond, extra) => {
    if (cond) { console.log('✅ ' + name); return true; }
    fails++; console.log('❌ ' + name + (extra ? ' :: ' + extra : '')); return false;
  };

  let IDX = null;
  try { IDX = readFileSync(join(here, '../../public/index.html'), 'utf8'); } catch (e) { IDX = null; }

  /* Whole `function NAME(…) { … }` text. srcBlockAfter brace-matches the BODY;
     the signature is the slice from `function` to the `{` it stopped at, so the
     two together are the function verbatim — parameters, comments and all. It is
     re-evaluated here rather than copied, which is the only version of this
     round that can catch an edit to the shipped file. */
  const fnText = (src, name) => {
    if (!src) return null;
    const at = src.indexOf('function ' + name + '(');
    if (at < 0) return null;
    const body = srcBlockAfter(src, 'function ' + name + '(');
    if (!body) return null;
    const bo = src.indexOf('{', src.indexOf(')', at));
    if (bo < 0 || bo > src.indexOf(body, at) + 1) return null;
    return src.slice(at, bo) + body;
  };
  /* The text of one statement INSIDE a named function, between two anchors.
     Anchored inside the function rather than on a file-wide regex because
     `const rid =` and `const resPool =` are ordinary words that appear in prose
     and in other functions; scoping to the function is what stops this scraping
     a comment and then passing vacuously over it. */
  const stmtIn = (src, fname, from, to) => {
    const f = fnText(src, fname); if (!f) return null;
    const a = f.indexOf(from); if (a < 0) return null;
    const b = f.indexOf(to, a); if (b < 0) return null;
    return f.slice(a, b);
  };
  const litOf = (src, decl, open) => {
    if (!src || src.indexOf(decl) < 0) return null;
    const t = srcBlockAfter(src, decl, open);
    if (!t) return null;
    try { return (new Function('return (' + t + ');'))(); } catch (e) { return null; }
  };

  const RES        = litOf(IDX, 'const RESOURCES = [', '[');
  const LOOT_IDS   = litOf(IDX, 'const LOOT_RES_IDS = [', '[');
  const WEIGHTS    = litOf(IDX, 'const LOOT_RES_WEIGHTS = {');
  const scaleM     = IDX ? /const\s+LOOT_WEIGHT_SCALE\s*=\s*(\d+)/.exec(IDX) : null;
  const baseM      = IDX ? /const\s+RES_STASH_BASE\s*=\s*(\d+)/.exec(IDX) : null;
  const perKindM   = IDX ? /const\s+RES_STASH_PER_KIND\s*=\s*(\d+)/.exec(IDX) : null;
  const campPick   = stmtIn(IDX, '_campGrantLoot', 'const rid =', ';');
  const contPool   = stmtIn(IDX, '_campLootContainer', 'const resPool =', '\n  const lo =');
  const contPick   = stmtIn(IDX, '_campLootContainer', 'const pick = (excludeId)', '\n  const res1');
  const smugDeal   = fnText(IDX, '_smugglerDeal');

  /* 🔴 THE VACUOUS-TRIPWIRE GUARD, same rule as round0b and round0p: a scrape
     that matched nothing would "pass" every measurement below over an empty
     sample, which is strictly worse than having no round — index.html's loot
     block promises in writing that this check exists. Read fails ⇒ stop. */
  const gotAll =
    chk('read public/index.html', !!IDX && IDX.length > 1000000, IDX ? String(IDX.length) : 'UNREADABLE') &
    chk('extracted RESOURCES / LOOT_RES_IDS / LOOT_RES_WEIGHTS / LOOT_WEIGHT_SCALE',
        Array.isArray(RES) && RES.length > 10 && Array.isArray(LOOT_IDS) && LOOT_IDS.length > 0 && !!WEIGHTS && !!scaleM,
        [RES && RES.length, LOOT_IDS && LOOT_IDS.length, WEIGHTS && JSON.stringify(WEIGHTS), scaleM && scaleM[1]].join(' / ')) &
    chk('scraped the live draw expression out of all three reward sites',
        !!campPick && !!contPool && !!contPick && !!smugDeal,
        ['campPick', 'contPool', 'contPick', 'smugglerDeal'].filter((n, i) => ![campPick, contPool, contPick, smugDeal][i]).join(',') + ' NOT FOUND');

  if (!gotAll) {
    console.log('\n🔴 THE SOURCE COULD NOT BE READ — nothing below was checked.');
    console.log('   If a declaration or function was renamed, fix the markers in this round.');
    console.log('   Do NOT delete it: index.html\'s "THE LOOT POOL IS NOT THE LEDGER" block');
    console.log('   promises this round re-measures all three sites.');
    bad++; console.log('\n=== ROUND 0q: ' + fails + ' FAILED ===');
  } else {
    let RIDS = RES.map(r => r.id);
    let RESROWS = RES.slice();
    if (SABOTAGE === 'loot-promo') {
      RESROWS = RESROWS.concat([{ id: 'flour', name: 'Flour', icon: '🌾', color: '#e8d7a0' }]);
      RIDS = RESROWS.map(r => r.id);
      console.log('   🧨 promoted `flour` into RESOURCES without declaring it lootable');
    }

    // ── 1. WIRING ─────────────────────────────────────────────────────────
    /* The pool must be a SUBSET of the ledger. _lootResPick draws ids from the
       bag while _lootResRows maps the same bag through RESOURCES and drops the
       misses, so an id in the pool with no RESOURCES row is drawable by the
       loot run and the smuggler but INVISIBLE to the container — one pool
       meaning two different things, and addRes() would bank a key the vault
       cannot render. */
    const strays = LOOT_IDS.filter(id => !RIDS.includes(id));
    chk('the loot pool is a subset of the ledger — every lootable id has a RESOURCES row (' + LOOT_IDS.length + ' ids)',
        strays.length === 0, 'not in RESOURCES: ' + strays.join(', '));
    chk('the loot pool is not the whole ledger — it is a DECISION, not a copy of RESOURCES (' + LOOT_IDS.length + ' of ' + RIDS.length + ')',
        LOOT_IDS.length < RIDS.length, LOOT_IDS.length + ' vs ' + RIDS.length);
    chk('no duplicate ids in the loot pool (a repeat is a silent double weight)',
        new Set(LOOT_IDS).size === LOOT_IDS.length, LOOT_IDS.length + ' entries, ' + new Set(LOOT_IDS).size + ' distinct');
    /* Rule 4's shape, applied to loot: the mix lives in config. A number at a
       call site is how the last four tuning arguments got lost. */
    chk('the weights live in LOOT_RES_WEIGHTS config, both named and numeric (pool=' + WEIGHTS.pool + ', offPool=' + WEIGHTS.offPool + ')',
        typeof WEIGHTS.pool === 'number' && typeof WEIGHTS.offPool === 'number' && WEIGHTS.pool > 0 && WEIGHTS.offPool >= 0,
        JSON.stringify(WEIGHTS));
    /* Where each site gets its IDS from. This is a source assertion and it is
       deliberately weaker than the composition measurement below — it exists so
       a FAILURE NAMES THE SITE, because "20% of draws were off-pool" does not
       tell you which of the three regressed. */
    const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const [site, txt] of [['_campGrantLoot', campPick], ['_smugglerDeal', smugDeal], ['_campLootContainer', contPool + contPick]]) {
      const code = strip(txt);
      chk(site + ' draws its ids from the loot pool and names no ledger array',
          /_lootRes(Pick|Rows)\s*\(/.test(code) && !/\b(RESOURCE_IDS|RESOURCES|SMUGGLER_RES)\b/.test(code),
          (/_lootRes(Pick|Rows)\s*\(/.test(code) ? '' : 'no _lootRes* call; ') +
          'ledger arrays referenced: [' + ((code.match(/\b(RESOURCE_IDS|RESOURCES|SMUGGLER_RES)\b/g) || []).join(', ')) + ']');
    }
    /* Rule 4's shape applied to the draw itself: the two sites whose draw is a
       single expression may not name a number. 0 and 1 are structural (array
       indices, Math.floor/Math.random bounds, the `|| 1` guards); anything else
       is a weight or a pool size that escaped LOOT_RES_WEIGHTS.
       ⚠ _smugglerDeal is EXCLUDED ON PURPOSE and not asserted over: its 45/170
         deal sizes and 0.6/0.82 branch odds are real, legitimate tuning that has
         nothing to do with which resource a deal names. Asserting "no literals"
         there would be a green tick for a claim that is simply false. */
    for (const [site, txt] of [['_campGrantLoot', campPick], ['_campLootContainer', contPool + contPick]]) {
      const tuning = (strip(txt).match(/\b\d+(\.\d+)?\b/g) || []).filter(n => n !== '0' && n !== '1');
      chk(site + ' names no tuning literal at the draw site — the mix is config, not code',
          tuning.length === 0, tuning.join(','));
    }

    // ── 2. COVERAGE ───────────────────────────────────────────────────────
    /* Every ledger id must be classified. This is the assertion that makes the
       NEXT promotion declare itself: add an id to RESOURCES and it is either
       lootable (say so in LOOT_RES_IDS) or city-made (it came from the chain
       derivation), and if it is neither, nobody decided — which is exactly the
       state that shipped 56 undecided ids into three reward tables. */
    let CHAIN_IDS = [];
    try {
      const chain = await import('../../public/src/resources/chain.js');
      const pd = await import('../../public/src/city/production.data.js');
      const promoted = pd.PROMOTED_CHAIN_IDS || [];
      CHAIN_IDS = promoted.slice();
      chk('read the chain-promoted id set to classify against (' + CHAIN_IDS.length + ' ids, chain catalogue ' + (chain.CHAIN_BY_ID ? Object.keys(chain.CHAIN_BY_ID).length : 0) + ')',
          CHAIN_IDS.length > 0, String(CHAIN_IDS.length));
    } catch (e) {
      chk('read the chain-promoted id set to classify against', false, String(e && e.message));
    }
    const unclassified = RIDS.filter(id => !LOOT_IDS.includes(id) && !CHAIN_IDS.includes(id));
    chk('every one of the ' + RIDS.length + ' ledger ids is CLASSIFIED — lootable (' + LOOT_IDS.length + ') or city-made (' + CHAIN_IDS.length + ')',
        unclassified.length === 0,
        'undeclared: [' + unclassified.join(', ') + '] — add it to LOOT_RES_IDS if a scavenger finds it, or promote it through the chain if the city makes it');

    // ── 3. COMPOSITION — the deliverable ──────────────────────────────────
    /* Rebuild the live loot machinery by EVALUATING the shipped function texts,
       then run the shipped draw expression from each call site against it. What
       is measured is real output, not the presence of a fix. */
    const parts = [];
    parts.push('const LOOT_RES_IDS = ' + JSON.stringify(LOOT_IDS) + ';');
    parts.push('const LOOT_RES_WEIGHTS = ' + JSON.stringify(WEIGHTS) + ';');
    parts.push('const LOOT_WEIGHT_SCALE = ' + scaleM[1] + ';');
    if (/let\s+_lootBag\s*=/.test(IDX)) parts.push('let _lootBag = null, _lootBagFor = -1;');
    for (const fn of ['_lootResBag', '_lootResPick', '_lootResRows', '_smugRng', '_smugInt', '_smugPick']) {
      const t = fnText(IDX, fn); if (t) parts.push(t);
    }
    parts.push('const SMUGGLER_WANT_RARITY = ' + JSON.stringify(litOf(IDX, 'const SMUGGLER_WANT_RARITY = ', '[') || ['common']) + ';');
    if (IDX.indexOf('const SMUGGLER_RES = ') >= 0) {
      const a = IDX.indexOf('const SMUGGLER_RES = ');
      const b = IDX.indexOf('\nconst SMUGGLER_WANT_RARITY', a);
      if (b > a) parts.push(IDX.slice(a, b));
    }
    /* The smuggler's non-loot dependencies, stubbed: the board's window is the
       loop variable here so many windows can be sampled, and the card pool is
       admin content that has nothing to do with which RESOURCE a deal names. */
    parts.push('let __WIN = 0; function _smugglerWindow(){ return __WIN; } function _smugglerCardPool(){ return []; } function __setWin(w){ __WIN = w; }');
    parts.push(smugDeal);
    parts.push('function __campPick(){ ' + campPick + '; return rid; }');
    parts.push('function __contRows(){ ' + contPool + '; return resPool; }');
    parts.push('function __contPick(resPool, lo, hi){ ' + contPick + ' return pick; }');
    if (SABOTAGE === 'loot-ledger') {
      /* Re-commit the pre-fix draw: the reward sites read the LEDGER again.
         Overriding the two helpers reproduces the regression whatever the call
         sites say, and the composition assertions must not survive it. */
      parts.push('_lootResPick = function(rnd){ const r = (typeof rnd === "function") ? rnd() : Math.random(); return RESOURCE_IDS[Math.floor(r * RESOURCE_IDS.length)]; };');
      parts.push('_lootResRows = function(){ return RESOURCES.slice(); };');
      console.log('   🧨 the three reward sites draw from RESOURCE_IDS / RESOURCES again (the pre-fix code)');
    }
    parts.push('return { __campPick, __contRows, __contPick, _smugglerDeal, __setWin };');

    let S = null;
    try {
      S = (new Function('RESOURCES', 'RESOURCE_IDS',
        (SABOTAGE === 'loot-ledger' ? 'var _lootResPick, _lootResRows;\n' : '') + parts.join('\n')))(RESROWS, RIDS);
    } catch (e) {
      chk('the scraped loot machinery evaluates', false, String(e && e.message));
    }

    if (S) {
      const PULLS = 120000;
      const setEq = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
      const POOL = new Set(LOOT_IDS);
      const share = (n, d) => (100 * n / d).toFixed(2) + '%';
      const report = (site, inPool, total, seen) => {
        console.log('   ' + site.padEnd(20) + total + ' draws · ' + share(inPool, total) +
                    ' from the loot pool · ' + seen.size + ' distinct ids');
      };

      // 3a. _campGrantLoot
      {
        let inPool = 0; const seen = new Set();
        for (let i = 0; i < PULLS; i++) { const id = S.__campPick(); seen.add(id); if (POOL.has(id)) inPool++; }
        report('_campGrantLoot', inPool, PULLS, seen);
        chk('_campGrantLoot pays ONLY in lootable resources over ' + PULLS + ' draws — an expedition brings home what it brought home before the promotion',
            inPool === PULLS && setEq(seen, POOL),
            share(inPool, PULLS) + ' in pool; off-pool ids drawn: [' + [...seen].filter(x => !POOL.has(x)).slice(0, 8).join(', ') + ']');
      }
      // 3b. _smugglerDeal — the whole board, over many windows
      {
        /* Every deal index the Black Market can reach (Lv4 → 6, see
           _smugglerDealCount), across enough 12-hour windows that the sample is
           the board a player actually sees rather than one lucky rotation. */
        const DEALS = 6, WINDOWS = 20000;
        let legs = 0, inPool = 0; const seen = new Set();
        for (let w = 0; w < WINDOWS; w++) {
          S.__setWin(w);
          for (let i = 0; i < DEALS; i++) {
            const d = S._smugglerDeal(i);
            for (const side of [d.want, d.give]) {
              if (side && side.kind === 'res') { legs++; seen.add(side.id); if (POOL.has(side.id)) inPool++; }
            }
          }
        }
        report('_smugglerDeal', inPool, legs, seen);
        chk('every smuggler deal wants and pays in a lootable resource over ' + legs + ' legs — the board never asks for a good the camp cannot get',
            legs > 100000 && inPool === legs && setEq(seen, POOL),
            legs + ' legs, ' + share(inPool, legs) + ' in pool; off-pool: [' + [...seen].filter(x => !POOL.has(x)).slice(0, 8).join(', ') + ']');
      }
      // 3c. container rewards
      {
        const rows = S.__contRows();
        const pick = S.__contPick(rows, 1, 5);
        let inPool = 0; const seen = new Set();
        for (let i = 0; i < PULLS; i++) { const r = pick(); if (!r) continue; seen.add(r.id); if (POOL.has(r.id)) inPool++; }
        report('container resPool', inPool, PULLS, seen);
        chk('container rewards pay ONLY in lootable resources over ' + PULLS + ' draws (' + rows.length + ' weighted rows)',
            inPool === PULLS && setEq(seen, POOL),
            share(inPool, PULLS) + ' in pool; off-pool: [' + [...seen].filter(x => !POOL.has(x)).slice(0, 8).join(', ') + ']');
        /* The rows carry the metadata the reward modal renders. A row that lost
           its name or icon in the weighting would print "undefined" at the
           player, which is how a pool rewrite goes wrong without moving a
           single percentage. */
        chk('every weighted container row still carries id + name + icon (the modal renders these)',
            rows.length > 0 && rows.every(r => r && r.id && r.name && r.icon),
            String(rows.filter(r => !r || !r.id || !r.name || !r.icon).length) + ' malformed rows');
      }
      /* THE BAG IS NEVER EMPTY. Every call site does bag[floor(r*len)] and would
         get `undefined` — addRes(undefined, n) banks a literal "undefined" key
         into Profile.salvage that counts against the cap forever and no UI can
         clear. Diluted is survivable; corrupt is not. */
      {
        let degraded = null;
        try {
          const f = new Function('RESOURCES', 'RESOURCE_IDS',
            'const LOOT_RES_IDS = []; const LOOT_RES_WEIGHTS = { pool: 0, offPool: 0 }; const LOOT_WEIGHT_SCALE = ' + scaleM[1] + ';' +
            'let _lootBag = null, _lootBagFor = -1;' + fnText(IDX, '_lootResBag') + ' return _lootResBag();');
          degraded = f(RESROWS, RIDS);
        } catch (e) {}
        chk('an empty or zero-weighted pool degrades to the whole ledger, never to an empty bag (undefined would be banked forever)',
            Array.isArray(degraded) && degraded.length === RIDS.length,
            degraded ? String(degraded.length) : 'THREW');
      }
    }

    // ── 4. THE STASH CAP ──────────────────────────────────────────────────
    /* RESOURCES_NEXT.md argued 143/kind keeps the allowance flat, and that is
       true PER KIND and false IN TOTAL: getResourceUnits() sums EVERY resource
       against ONE ceiling, so moving the denominator 14 → 70 moved the floor
       2,002 → 10,010 and handed a 5× stash buff to every account, including the
       ones that never open the city. DECISION: the denominator is the LOOT POOL,
       because the only kinds a player accumulates WITHOUT CHOOSING TO are the
       ones loot pays in — which is the set the 143 was calibrated against. The
       other 56 arrive only from CITY_PRODUCTION, which the player builds on
       purpose, and the same catalogue sells the Warehouse whose stated job is
       raising this ceiling. */
    const floorFn = fnText(IDX, '_resStashFloor');
    let floorVal = null;
    try {
      floorVal = (new Function('RESOURCE_IDS', 'LOOT_RES_IDS', 'RES_STASH_BASE', 'RES_STASH_PER_KIND',
        floorFn + ' return _resStashFloor();'))(RIDS, LOOT_IDS, +baseM[1], +perKindM[1]);
    } catch (e) {}
    chk('_resStashFloor() = ' + floorVal + ' — the legacy-14 allowance is its pre-promotion value (' + perKindM[1] + ' × ' + LOOT_IDS.length + '), NOT the 10,010 the promotion silently granted',
        floorVal === Math.max(+baseM[1], LOOT_IDS.length * +perKindM[1]) && floorVal === 2002,
        String(floorVal));
    chk('the floor is DERIVED from the loot pool, not from RESOURCE_IDS and not a literal — widening the pool widens the floor with it',
        !!floorFn && /LOOT_RES_IDS/.test(floorFn) && !/RESOURCE_IDS/.test(floorFn),
        (floorFn || '').replace(/\s+/g, ' ').slice(0, 160));

    // ── 5. THE SAME CLASS, ONE LEVEL OVER: the exotic-salvage table ────────
    /* _rollUnitSalvage subtracts "the staples the rolls above already handed
       out" from SALVAGE_RES to get its exotic table. It was subtracting
       RESOURCE_IDS — the ledger — so the day an id that IS in SALVAGE_RES gets
       promoted (leather, ironOre, steelPlating are all queued), it would vanish
       from the exotic table with nobody touching this line. Identical output
       today; pinned so it stays that way. */
    const SALV = litOf(IDX, 'const SALVAGE_RES = [', '[');
    const rollFn = fnText(IDX, '_rollUnitSalvage');
    if (SALV && rollFn) {
      const exoticVsPool = SALV.filter(r => r && r.id && !LOOT_IDS.includes(r.id)).length;
      const exoticVsLedger = SALV.filter(r => r && r.id && !RIDS.includes(r.id)).length;
      chk('_rollUnitSalvage subtracts the LOOT POOL from SALVAGE_RES, not the ledger (' + exoticVsPool + ' exotics)',
          /LOOT_RES_IDS/.test(rollFn), 'still reads RESOURCE_IDS');
      chk('…and the exotic table is unchanged by the promotion — ' + exoticVsPool + ' either way, so this was a latent trap and not a live bug',
          exoticVsPool === exoticVsLedger && exoticVsPool > 100,
          'vs pool ' + exoticVsPool + ' / vs ledger ' + exoticVsLedger);
    } else {
      chk('read SALVAGE_RES and _rollUnitSalvage', false, 'SALVAGE_RES=' + !!SALV + ' fn=' + !!rollFn);
    }

    if (fails) { bad++; console.log('\n=== ROUND 0q: ' + fails + ' FAILED ==='); }
    else console.log('\n=== ROUND 0q: ALL PASS ===');
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   ROUND 0r — 🏗 THE LOAD → CATCH-UP GAP, AND FOUR CONSTRUCTION CLAMPS
   ----------------------------------------------------------------------------
   🔴 WHY THIS ROUND HAD TO BE WRITTEN, AND WHY NOTHING ELSE IN THIS FILE COULD
      HAVE CAUGHT WHAT IT CATCHES.

   sim.js takes `before = totalCinder()` INSIDE runDay. Every conservation
   assertion in this gate therefore has a WINDOW, and anything that moves money
   outside that window is invisible to it — on load, on boot, between ticks, in a
   bridge callback. The construction feature put a Cinder mint in exactly that
   gap and the gate stayed green for a whole session. A green gate proves nothing
   about the gap. This round is the gap.

   THE DEFECT, as shipped on this branch before the fix:
     boot() called `bldNormalize()`, whose tail was `bldSweep(Date.now())`, and
     awaited `offlineCatchUp()` ~118 lines LATER. So every job already due was
     COMPLETED AT THE WALL CLOCK before the absence was simulated. offlineCatchUp
     monkey-patches MythicCityBridge.addRes/addCinders/spendRes for its whole
     slice loop, so the entire absence was then paid to a building that had not
     been standing for it — REAL ledger writes, on the most ordinary path a
     player can take (close the tab with something under construction). The
     in-loop virtual sweep was dead code on a cold boot: `_bldRebuildDue()` built
     an EMPTY list, because the queue had already been cleared.
     Worse, bldNormalize's sweep ran with `_bldOffline === false`, so it fired
     the full trailer including ecoSync() — firms founded and drawing charter
     capital before the absence was simulated.
     bldSweep's own header describes this scenario verbatim and calls it "a
     Cinder mint, and it is the single most dangerous thing this feature could
     have done". The code did the thing the comment warned about.

   MEASURED ON THIS HARNESS, before the fix (§2's board — 12 Clubs, 6 h absence,
   every job due 2 h in, level 1, no multipliers):
     honest 14.400 🔥   pre-sweep 21.600 🔥   MINT +7.200 🔥
     = 24 unearned building-hours, i.e. 12 buildings × the 2 h they did not exist
   The absolute figure scales with output multipliers and with absence length up
   to OFFLINE_CAP_H = 36 h; the round asserts ZERO, not a threshold.

   WHAT IS UNDER TEST IS THE SHIPPED CODE, NOT A COPY OF IT. bldNormalize,
   bldSweep, _bldRebuildDue, bldFinishAll, bldCancel, bldOrderRefund,
   bldPayRefund, bldLoad, costOf/baseCost/scaleCost, bldSite, opsReconcile,
   opsFindLab and opsResearchAdj are LIFTED VERBATIM out of
   public/node-city/index.html and executed here.
   WHAT IS MODELLED, stated plainly so nobody mistakes it for the real thing:
     · bldFinish — mesh work is not economics; the stub does what matters
       (clears `bld`, lands the level) and records WHEN it fired;
     · offlineCatchUp's slice loop — re-walked here with the SAME
       OFFLINE_SLICE_SEC and the SAME `vnow >= _bldNext` early-out, but with a
       linear per-tile Cinder rate (`gen.cinder / CINDER_PERIOD_DIV / 60`) in
       place of economyTick;
     · the ops manifest and its RPCs.
   The ORDER, which is the whole defect, is the shipped order both structurally
   (§1 reads boot()'s own text) and behaviourally (§2 drives it).

   SABOTAGE (each MUST redden this round; each re-commits the pre-fix source):
     boot-presweep · cancel-sited · cancel-blind · ops-zombie · refund-blind ·
     refund-raw · free-repair · lab-ungated
     …and §7-§9, each of which re-commits one REAL HUNK of this branch's diff
     rather than a pre-fix source that predates it:
     save-noborder · load-nolvl · gate-ungated · cap-race · place-nobld ·
     beat-dead · offline-nosweep
   ════════════════════════════════════════════════════════════════════════════ */
{
  console.log('\n########## round0r-boot-order ##########');
  let fails = 0;
  const chk = (name, cond, extra) => {
    if (cond) { console.log('✅ ' + name); return true; }
    fails++; console.log('❌ ' + name + (extra ? ' :: ' + extra : '')); return false;
  };

  let NC = null;
  try {
    NC = readFileSync(join(here, SABOTAGE === 'no-map'
      ? '../../public/node-city/THIS-FILE-DOES-NOT-EXIST.html'
      : '../../public/node-city/index.html'), 'utf8');
  } catch (e) { NC = null; }

  /* 🔧 THE REAL ECON.construction, for §8's crew arithmetic. bldSlots(),
     bldSpeed() and the municipal ceiling are all `C.<something>` reads, so a
     sandbox that invents its own config would grade numbers this file chose
     rather than the ones the product ships (Rule 4). Imported rather than
     written down; Node caches the module, so this costs nothing. */
  const ECON_C = (await import(pathToFileURL(join(here, '../../public/src/economy/tuning.js')).href)).ECON.construction;

  /* Whole `[async ]function NAME(…) { … }` text — round0q's scraper with the
     `async` prefix carried through, because bldCancel, bldPayRefund and
     opsReconcile are all async and a lifted body that has lost its `async`
     cannot be awaited. */
  const fnText = (src, name) => {
    if (!src) return null;
    const at = src.indexOf('function ' + name + '(');
    if (at < 0) return null;
    const body = srcBlockAfter(src, 'function ' + name + '(');
    if (!body) return null;
    const bo = src.indexOf('{', src.indexOf(')', at));
    if (bo < 0 || bo > src.indexOf(body, at) + 1) return null;
    return (src.slice(Math.max(0, at - 6), at) === 'async ' ? 'async ' : '') + src.slice(at, bo) + body;
  };
  /* §1 below reasons about WHERE calls appear in boot(), so it reads code and
     not prose — see the `stripComments` header at module scope for the exact
     sentence in boot() that made this round pass no matter what the code did. */
  // A one-line `const NAME = …;` declaration, verbatim.
  const lineConst = (src, name) => {
    if (!src) return null;
    const m = new RegExp('const\\s+' + name + '\\s*=\\s*[^\\n]+;').exec(src);
    return m ? m[0] : null;
  };
  /* …AND THE SAME THING FOR ONE THAT DOES NOT FIT ON A LINE. lineConst's regex
     is anchored to `[^\n]+;`, so it silently returns null for `bldRemain` (two
     lines) and silently returns a TRUNCATED declaration for `bldOpType`, whose
     arrow body carries its own `;` inside a try. Either failure hands §8 a
     sandbox that is wrong rather than absent, which is the worse of the two.
     This walks to the terminating semicolon at bracket depth 0, stepping over
     strings and comments for the reason the srcBlockAfter header gives. */
  const constDecl = (src, name) => {
    if (!src) return null;
    const at = new RegExp('const\\s+' + name + '\\s*=').exec(src);
    if (!at) return null;
    let i = at.index, depth = 0;
    for (; i < src.length; i++) {
      const c = src[i], d = src[i + 1];
      if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return null; i = e + 1; continue; }
      if (c === '/' && d === '/') { const e = src.indexOf('\n', i + 2); if (e < 0) return null; i = e; continue; }
      if (c === '"' || c === "'" || c === '`') {
        const q = c; i++;
        for (; i < src.length; i++) { if (src[i] === '\\') { i++; continue; } if (src[i] === q) break; }
        continue;
      }
      if ('([{'.indexOf(c) >= 0) depth++;
      else if (')]}'.indexOf(c) >= 0) depth--;
      else if (c === ';' && depth === 0) return src.slice(at.index, i + 1);
    }
    return null;                        // unterminated ⇒ nothing, never a guess
  };
  const num = (src, name) => {
    if (!src) return NaN;
    const m = new RegExp('\\b' + name + '\\s*=\\s*([0-9]+(?:\\.[0-9]+)?)').exec(src);
    return m ? +m[1] : NaN;
  };
  /* BUILDINGS is not a pure literal — see round0p's note. Same Proxy trick. */
  const looseFrom = (src, decl) => {
    const txt = srcBlockAfter(src, decl);
    if (!txt) return null;
    try {
      const scope = new Proxy({}, { has: () => true, get: (t, k) => (k === Symbol.unscopables ? undefined : 0) });
      return new Function('__s', 'with (__s) { return (' + txt + '); }')(scope);
    } catch (e) { return null; }
  };

  /* 🧨 THE SABOTAGE IS APPLIED TO THE LIFTED SOURCE, not to the harness. Each
     patch below turns the shipped text back into the exact text that shipped
     before the fix, which is the strongest form this file has: the round is then
     graded against the real defect rather than against an injured stub.
     ⚠ A patch that matches NOTHING would leave the round green under sabotage —
       a vacuous tripwire, the failure mode this whole gate is built to distrust.
       `patchOk` is asserted before anything else runs. */
  let patchOk = true, patchTried = 0;
  const unfix = (txt, key, pairs) => {
    if (SABOTAGE !== key || !txt) return txt;
    let out = txt;
    for (const p of pairs) {
      patchTried++;
      if (out.indexOf(p[0]) < 0) { patchOk = false; console.log('   🧨 patch MISSED: ' + JSON.stringify(p[0].slice(0, 60))); continue; }
      out = out.split(p[0]).join(p[1]);
    }
    return out;
  };

  const BLDG      = looseFrom(NC, 'const BUILDINGS = {');
  const BOOT_SRC0 = fnText(NC, 'boot');
  const SRC0 = {
    _bldRebuildDue: fnText(NC, '_bldRebuildDue'),
    bldSweep:       fnText(NC, 'bldSweep'),
    bldFinishAll:   fnText(NC, 'bldFinishAll'),
    bldNormalize:   fnText(NC, 'bldNormalize'),
    bldPaid:        fnText(NC, 'bldPaid'),
    bldRecord:      fnText(NC, 'bldRecord'),
    bldOrderRefund: fnText(NC, 'bldOrderRefund'),
    bldRefundFit:   fnText(NC, 'bldRefundFit'),
    bldRefundLabel: fnText(NC, 'bldRefundLabel'),
    bldConfirmLossy: fnText(NC, 'bldConfirmLossy'),
    bldPayRefund:   fnText(NC, 'bldPayRefund'),
    bldCancel:      fnText(NC, 'bldCancel'),
    bldLoad:        fnText(NC, 'bldLoad'),
    bldRefundCap:   fnText(NC, 'bldRefundCap'),
    scaleCost:      fnText(NC, 'scaleCost'),
    baseCost:       fnText(NC, 'baseCost'),
    costOf:         fnText(NC, 'costOf'),
    opsReconcile:   fnText(NC, 'opsReconcile'),
    opsFindLab:     fnText(NC, 'opsFindLab'),
    opsResearchAdj: fnText(NC, 'opsResearchAdj'),
    /* 🏗 §8's CREW ARITHMETIC, lifted for the same reason as everything above
       it: the order gate's first refusal is literally `bldCommitted() >=
       bldSlots()`, so a sandbox that stubbed either number would grade its own
       inequality. bldSlots reads the real ECON slot table through bldCfg;
       bldCommitted is the one that counts orders still inside their payCost. */
    bldCoTiles:     fnText(NC, 'bldCoTiles'),
    bldWorkersOf:   fnText(NC, 'bldWorkersOf'),
    bldSlots:       fnText(NC, 'bldSlots'),
    bldActive:      fnText(NC, 'bldActive'),
    bldCommitted:   fnText(NC, 'bldCommitted'),
    bldNextFreeSec: fnText(NC, 'bldNextFreeSec'),
    bldCrewBusyMsg: fnText(NC, 'bldCrewBusyMsg'),
    bldCoHint:      fnText(NC, 'bldCoHint'),
    tryPlace:       fnText(NC, 'tryPlace'),
  };
  /* Each entry below re-commits the pre-fix source for one defect, on the way
     into the sandbox. The anchors are the exact expressions the fixes added, so
     a rename breaks the SABOTAGE (loudly, via patchOk) rather than the round. */
  const SRC = { ...SRC0,
    bldCancel: unfix(unfix(SRC0.bldCancel, 'cancel-sited', [
      /* the pre-fix bldCancel had no idea an operation lived on the tile */
      ['opsRowForKey(kk)', 'null'],
    ]), 'cancel-blind', [
      /* ROUND 1's source, verbatim in effect: "this tile is an operation" was
         decided by whether a row RESOLVED, so a register that cannot answer —
         `message` mode, an older parent, a hired manager — read as "not an
         operation" and the cancel went through, licence still sited. */
      ['!!opsTypeOf(t.type)', '!!opsRowForKey(kk)'],
    ]),
    /* 🔴 THIS PATCH RE-COMMITS ROUND 2'S SOURCE VERBATIM, NOT AN INJURY.
       It used to DELETE the resurrection line, which reddened §3d only in a way
       the product never failed. What actually shipped was the line PRESENT and
       INERT: `bldRecord(0, 1, bldDuration(…), {})` returns null whenever
       bldCfg() is null, which is every real boot (see §3d). Restoring the call
       is therefore the honest sabotage — it looks like a fix, reads like a fix,
       and lands `bld: null` on 100% of page loads. A sabotage that can only
       redden a round by removing code cannot grade code that is merely dead. */
    /* ⚠ TWO SINGLE-LINE ANCHORS, NEVER ONE SPANNING THE LINE BREAK. The first
       attempt matched across the newline and its continuation indent, missed on
       a whitespace difference, and reddened the round through `patchOk` instead
       of through the defect — a sabotage that fails for the wrong reason grades
       nothing. Single-line anchors cannot drift that way. */
    opsReconcile: unfix(SRC0.opsReconcile, 'ops-zombie', [
      ['bld: { k: 0, l: 1, s: Date.now(), d: Number.MAX_SAFE_INTEGER,', 'bld: null };'],
      ['fv: -1, pc: 0, pr: null } };',
       'try { nt.bld = bldRecord(0, 1, bldDuration(nt.type, 1, 0, bldSpeed()), {}); } catch (e) { nt.bld = null; }'],
    ]),
    bldLoad: unfix(SRC0.bldLoad, 'refund-raw', [
      ['Math.min(Math.max(0, Math.round(+raw.pc || 0)), Math.max(0, Math.round(+cap.cinder || 0)))',
       'Math.max(0, Math.round(+raw.pc || 0))'],
      ['const lim = Math.max(0, Math.round(+cap[r] || 0));', 'const lim = Infinity;'],
    ]),
    /* 🧨 THE PRE-FIX REFUND, RE-COMMITTED WHERE IT ACTUALLY LIVED: nobody asked
       the ceiling. One anchor, and it is enough — with no headroom read `free`
       stays Infinity, so the fit is always `whole`, no dialog is raised, and
       every promise site prints "refunded in full" while addRes clamps. That is
       byte-for-byte the shipped behaviour, not an injury: the shipped code had
       no bldRefundFit at all and the shipped bldPayRefund was the two lines
       still under this one. */
    bldRefundFit: unfix(SRC0.bldRefundFit, 'refund-blind', [
      ['const h = await MythicCityBridge.resourceHeadroom();', 'const h = null;'],
    ]),
    opsFindLab:     unfix(SRC0.opsFindLab,     'lab-ungated', [['if (bldSite(t)) continue;', '']]),
    opsResearchAdj: unfix(SRC0.opsResearchAdj, 'lab-ungated', [['if (t.damaged || bldSite(t)) continue;', 'if (t.damaged) continue;']]),
    /* 🧨 §8's TWO SWITCHES, BOTH RE-COMMITTING A REAL HUNK OF THIS BRANCH.
       cap-race drops the `+ _pendingOf(placeType)` term, which is the whole of
       h096's code change: the per-type count goes back to reading only tiles
       that are already written, and two clicks 15 ms apart on different squares
       both pass a `cap: 1` check.
       place-nobld drops the order record off the placed tile — h098 — so the
       building goes up instantly and the entire timer feature is void with the
       gate still green. */
    tryPlace: unfix(unfix(SRC0.tryPlace, 'cap-race', [
      [' + _pendingOf(placeType)', ''],
    ]), 'place-nobld', [
      ['earn: 0, bld: bldRecord(0, 1, durSec, cost) };', 'earn: 0 };'],
    ]),
  };
  const BLDSITE = lineConst(NC, 'bldSite');
  const BLDBUSY = constDecl(NC, 'bldBusy');
  const BLDREM  = constDecl(NC, 'bldRemain');
  const BLDOPTY = constDecl(NC, 'bldOpType');
  /* 🔒 THE RESERVATION DECLARATIONS, LIFTED RATHER THAN RETYPED. h096 deletes
     `_pendingType` and `_pendingOf` outright, so a copy written here would keep
     §8 green through exactly the revert it exists to catch — the same trap §2b
     fell into with boot()'s hand-off. Null ⇒ the section reports a missing
     declaration, which is what a deleted `const` looks like from here, and the
     real hunk revert is caught exactly that way.
     ⚠ THE `cap-race` SWITCH DELIBERATELY LEAVES THESE ALONE and injures the
       COUNT instead (see tryPlace's unfix above). Nulling them here reddened §8
       through the scrape check, which proves the round notices a missing
       declaration and proves nothing about the race; dropping only
       `+ _pendingOf(placeType)` leaves the reservation being taken and released
       and simply never read, so the two-clicks scenario fails the way a player
       meets it — with two cap-1 buildings on the board. */
  const PLACING     = constDecl(NC, '_placing');
  const PENDING_MAP = constDecl(NC, '_pendingType');
  const PENDING_OF  = constDecl(NC, '_pendingOf');
  const CAPB    = num(NC, 'CAP_PER_BUILDING');
  const CPD     = num(NC, 'CINDER_PERIOD_DIV');
  const SLICE   = num(NC, 'OFFLINE_SLICE_SEC');
  const CAP_H   = num(NC, 'OFFLINE_CAP_H');
  const BCM     = num(NC, 'BUILD_CINDER_MULT');
  const BRM     = num(NC, 'BUILD_RES_MULT');
  const UPM     = num(NC, 'UPGRADE_MULT');
  const MAXL    = num(NC, 'MAX_LVL');
  const RDC     = num(NC, 'ROAD_DEMOLISH_COST');
  const RADIUS  = num(NC, 'OPS_RESEARCH_R');
  /* loadState's damage/order precedence is ONE STATEMENT inside a 400-line
     function, so it is scraped as a statement rather than lifted as a function —
     and then EXECUTED below, so this is not a string comparison dressed up as a
     test. */
  const DMG_HITS = NC ? (NC.match(/if \(t\.bld[^\n]*?\)\s*t\.damaged = false;/g) || []) : [];
  const DMG_STMT = unfix(DMG_HITS.length === 1 ? DMG_HITS[0] : null, 'free-repair',
                         [['if (t.bld && t.bld.k === 0)', 'if (t.bld)']]);

  const missing = Object.keys(SRC).filter(k => !SRC[k]);
  const gotAll =
    chk('read node-city/index.html (' + (NC ? NC.length : 'UNREADABLE') + ' chars)', !!NC && NC.length > 100000) &
    chk('lifted every function under test' + (missing.length ? '' : ' (' + Object.keys(SRC).length + ')'),
        missing.length === 0, 'MISSING: ' + missing.join(',')) &
    chk('lifted bldSite, the damage/order statement and the shipped constants',
        !!BLDSITE && !!DMG_STMT && !!BLDG && !!BOOT_SRC0 &&
        [CPD, SLICE, CAP_H, BCM, BRM, UPM, MAXL, RADIUS, CAPB].every(Number.isFinite),
        'bldSite=' + !!BLDSITE + ' dmg×' + DMG_HITS.length + '=' + JSON.stringify(DMG_STMT) + ' bldgs=' + (BLDG ? Object.keys(BLDG).length : 'NULL') +
        ' [' + [CPD, SLICE, CAP_H, BCM, BRM, UPM, MAXL, RADIUS, CAPB].join(',') + ']') &
    chk('lifted the four one-line bld predicates and the placement reservations',
        !!BLDBUSY && !!BLDREM && !!BLDOPTY && !!PLACING,
        'bldBusy=' + JSON.stringify(BLDBUSY) + ' bldRemain=' + JSON.stringify(BLDREM) +
        ' bldOpType=' + JSON.stringify(BLDOPTY) + ' _placing=' + JSON.stringify(PLACING));

  if (!gotAll) {
    console.log('\n🔴 THE SOURCE COULD NOT BE READ — nothing below was checked.');
    console.log('   If a function was renamed or moved, fix the scrape markers in this round.');
    console.log('   Do NOT delete it: bldSweep\'s header in node-city/index.html names the exact');
    console.log('   mint this round exists to keep out, and the audit in sim.js is structurally');
    console.log('   blind to it — nothing else in this gate can see the load→catch-up gap.');
    bad++; console.log('\n=== ROUND 0r: ' + fails + ' FAILED ===');
  } else {

  /* ── §1 THE ORDER, READ OUT OF boot() ITSELF ────────────────────────────────
     Model-free and one line of reasoning: NOTHING may complete a build order
     before the absence has been simulated, so the first completion call in
     boot() must come AFTER `await offlineCatchUp(`. `bldNormalize(true)` is the
     deferring form — it applies the two ECON bounds (which the catch-up needs
     BEFORE it runs, or it sweeps against an unclamped duration) and completes
     nothing. */
  const BOOT_SRC = unfix(stripComments(BOOT_SRC0), 'boot-presweep', [['bldNormalize(true)', 'bldNormalize()']]);

  /* 🔴 THE DEGRADE HAND-OFF, LIFTED AS THREE STATEMENTS AND THEN EXECUTED BY §2b.
     ----------------------------------------------------------------------------
     §2b used to write its own `if (deferred) api.bldFinishAll(deferred);`, and
     that one harness line was the whole reason the shipped hand-off could be
     DELETED with this gate still green. `bldNormalize(true)` deliberately
     finishes nothing and returns a report instead; if boot() then drops that
     report on the floor, `_bldDeferredFinish` is a write-only variable and every
     in-flight order parks forever the moment /src/economy 404s — which is not
     hypothetical, ADVERSARIAL_FINDINGS §5.7 quotes a real log line of the
     degrade path firing on this machine. A test that performs the product's job
     for it certifies its own line, not the product's.
     So the three statements are scraped out of boot() and RUN. `bootStmt` takes
     the whole physical line, from the comment-stripped text, so the try/catch
     that production wraps each one in comes along — including the `catch` that
     swallows, which is part of the shape under test. */
  const bootStmt = (needle) => {
    if (!BOOT_SRC) return null;
    const i = BOOT_SRC.indexOf(needle);
    if (i < 0) return null;
    const a = BOOT_SRC.lastIndexOf('\n', i) + 1;
    const b = BOOT_SRC.indexOf('\n', i);
    const line = BOOT_SRC.slice(a, b < 0 ? BOOT_SRC.length : b).trim();
    return line || null;
  };
  const DEFER_DECL   = bootStmt('let _bldDeferredFinish');
  const DEFER_ASSIGN = bootStmt('_bldDeferredFinish = bldNormalize(');
  /* 🧨 defer-park models the revert exactly: the LINE IS GONE, so the scrape
     comes back null — which is what a deleted statement looks like to a round
     that reads the shipped text rather than trusting one. */
  const DEFER_FINISH = SABOTAGE === 'defer-park' ? null : bootStmt('bldFinishAll(_bldDeferredFinish)');

  {
    chk('boot() still contains code after the comments are stripped (' + BOOT_SRC.length + ' of ' + BOOT_SRC0.length + ' chars)',
        BOOT_SRC.length > 4000 && BOOT_SRC.length < BOOT_SRC0.length * 0.9,
        'a stripper that returns everything, or nothing, makes §1 vacuous');
    const catchAt = BOOT_SRC.indexOf('await offlineCatchUp(');
    const firstFinish = ['bldSweep(', 'bldFinishAll(', 'bldFinish('].reduce((acc, tok) => {
      const i = BOOT_SRC.indexOf(tok);
      return (i >= 0 && (acc < 0 || i < acc)) ? i : acc;
    }, -1);
    chk('boot() awaits offlineCatchUp() BEFORE anything can complete a build order',
        catchAt >= 0 && firstFinish > catchAt,
        'offlineCatchUp@' + catchAt + ' firstCompletionCall@' + firstFinish);
    chk('boot() calls bldNormalize in its DEFERRING form — bldNormalize(true)',
        BOOT_SRC.indexOf('bldNormalize(true)') >= 0,
        BOOT_SRC.slice(Math.max(0, BOOT_SRC.indexOf('bldNormalize(')), BOOT_SRC.indexOf('bldNormalize(') + 40));
    /* …AND THE OTHER HALF OF THE SAME FIX. Deferring is only safe if somebody
       later ACTS on what was deferred. These two statements are what §2b runs;
       the assertion here is that they exist at all and are in the right order,
       because a deleted hand-off cannot be caught by driving it. */
    chk('boot() keeps bldNormalize(true)\'s degrade report AND acts on it',
        !!DEFER_DECL && !!DEFER_ASSIGN && !!DEFER_FINISH,
        'decl ' + JSON.stringify(DEFER_DECL) + ' assign ' + JSON.stringify(DEFER_ASSIGN) +
        ' finish ' + JSON.stringify(DEFER_FINISH) +
        ' — without the finish, `_bldDeferredFinish` is computed and discarded and a paid-for tile parks forever');
    const finishAt = DEFER_FINISH ? BOOT_SRC.indexOf('bldFinishAll(_bldDeferredFinish)') : -1;
    chk('…and it acts on it AFTER the catch-up, where a completion is no longer a mint',
        finishAt > catchAt,
        'deferred finishAll@' + finishAt + ' vs offlineCatchUp@' + catchAt);
  }

  /* ── THE SANDBOX ───────────────────────────────────────────────────────────
     One scope per scenario, holding the lifted functions and the stubs they
     close over. `_bldOffline`/`_bldDue`/`_bldNext` are `let` at node-city's
     module scope and are declared the same way here, because _bldRebuildDue
     ASSIGNS them and a const copy would silently diverge. */
  const mkCity = (ctx) => {
    const S = `
      const spy = __ctx.spy, BUILDINGS = __ctx.B, MANIFEST = __ctx.manifest || { ops: [] };
      const game = { tiles: {} };
      const OPS = { st: null, at: 0, booted: false, placing: new Set(), lastEffPush: 0, live: null };
      const OP_BP = {};
      let selectedKey = null, _opsNetKey = null, __NOW = Date.now();
      let _bldOffline = false, _bldDirty = false, _bldDue = [], _bldNext = Infinity;
      let ECON_ON = __ctx.econOn !== false;
      const MAX_LVL = ${MAXL}, UPGRADE_MULT = ${UPM};
      const BUILD_CINDER_MULT = ${BCM}, BUILD_RES_MULT = ${BRM};
      const OPS_RESEARCH_R = ${RADIUS}, GRID = 24, OPS_PREFIX = 'op_';
      const ROAD_DEMOLISH_COST = ${RDC};
      /* 🏗 §8's placement scaffolding. Everything here is a stub for something
         tryPlace touches on the way past — the parts UNDER TEST (the per-type
         count, the reservation multiset, the order record, both refusals) are
         lifted out of node-city, never written here. _placing, _pendingType and
         _pendingOf arrive as the SHIPPED declarations (see PLACING / PENDING
         above): they are module-level consts beside tryPlace, and h096 deletes
         two of them, so a copy typed here would keep the round green through
         exactly the revert it exists to catch.
         NOTE FOR EDITORS — this whole block is a TEMPLATE LITERAL. No backticks
         and no dollar-brace in the prose, or the sandbox stops parsing. */
      const CAP_PER_BUILDING = ${CAPB}, ROAD_PER_DEPOT = 0, ROAD_PER_CONVOY = 0;
      let placeType = __ctx.placeType || 'club', placeRot = 0;
      let CARDS = [];
      ${PLACING || 'const _placing = new Set();'}
      ${PENDING_MAP || ''}
      ${PENDING_OF || ''}
      function tileAt(x, z) { return game.tiles[key(x, z)] || null; }
      function canRotate() { return true; }
      function freeCards() { return CARDS.slice(); }
      function popUsed() { return 0; }
      function popCap() { return 9999; }
      function roadCapParts() { return { cap: 9999 }; }
      function roadUsed() { return 0; }
      function allRoadKeys() { return []; }
      function fmtCountdown(sec) { return Math.round(sec) + 's'; }
      function logEsc(s) { return String(s); }
      /* The long-order dialog. Default YES, because every §8 scenario is about
         a REFUSAL that must fire before this is ever reached; a section that
         needs the "no" answer passes __ctx.longAnswer === false explicitly. */
      async function bldConfirmLong(what, durSec) { spy.longConfirms.push(durSec); return __ctx.longAnswer !== false; }
      /* 🏠 node-city reaches for window.MythicHouse behind a try/catch. Modelled
         rather than left to throw, so §3f can assert the sleeping cards are NOT
         handed back on a demolish the player answered "no" to. */
      const window = __ctx.win || {};
      /* 📦 THE PARENT LEDGER'S CEILING, MODELLED AS index.html's addRes ACTUALLY
         ENFORCES IT — free = cap - units, drop the lot when free <= 0, clamp
         otherwise, and say nothing to the caller. spy.writes records what was
         ASKED FOR (every section above this one reads it that way) and
         spy.landed records what the ledger TOOK. The whole §3e defect lives in
         the gap between those two.
         With no __ctx.cap there is no ceiling, and resourceHeadroom answers the
         UNKNOWN shape ({cap:0, free:Infinity}) — which is what a parent with no
         cityResourceHeadroom hook returns, and what every section above runs
         under, so none of them changes behaviour. */
      const LEDGER = __ctx.ledger || {};
      const LCAP = __ctx.cap | 0;
      const lUnits = () => { let t = 0; for (const k in LEDGER) t += LEDGER[k] | 0; return t; };
      const MythicCityBridge = {
        mode: 'standalone',
        addCinders: async (n) => { spy.writes.push({ phase: spy.phase, call: 'addCinders', n: n }); return true; },
        addRes:     async (r, n) => {
          spy.writes.push({ phase: spy.phase, call: 'addRes', r: r, n: n });
          let add = Math.floor(n); if (!add) return;
          if (LCAP > 0 && add > 0) { const free = LCAP - lUnits(); add = free <= 0 ? 0 : Math.min(add, free); }
          if (add > 0) LEDGER[r] = (LEDGER[r] | 0) + add;
          spy.landed[r] = (spy.landed[r] | 0) + add;
        },
        resourceHeadroom: async () => (LCAP > 0
          ? { cap: LCAP, units: lUnits(), free: Math.max(0, LCAP - lUnits()) }
          : { cap: 0, units: 0, free: Infinity }),
        spendRes: async () => true, spendCinders: async () => true,
      };
      /* The lossy-cancel dialog. __ctx.answer is undefined in every scenario
         that does not set it, so the default is "no" — a section that trips the
         dialog without meaning to loses its cancel loudly rather than sliding
         through. */
      function confirm(msg) { spy.confirms.push(msg); return __ctx.answer === true; }
      const _bldCancelling = new Set();
      /* 🏗 THE UPGRADE-RACE REFUND, SCRAPED AS A STATEMENT AND THEN RUN. It is
         one branch inside a 90-line click handler, so it cannot be lifted as a
         function — but it is the SECOND call site of bldPayRefund and it had the
         same defect, so a round that only drove bldCancel would have graded half
         the bug. See §3e (7). */
      ${ctx.raceSrc ? 'async function raceRefund(cost) ' + ctx.raceSrc : ''}
      /* 🧨 THE DEMOLISH BUTTON'S WHOLE CLICK HANDLER, SCRAPED AND RUN — same
         technique, same reason as raceRefund above. The demolish refund is not a
         function anywhere; it is a tail inside the handler, which is exactly how
         it came to diverge from the cancel path in the first place. Grading a
         copy of it here would have graded this file, not the product. */
      /* ⏳ __ctx.payDelay IS THE WHOLE OF §8's RACE. The defect is that the cap
         is counted BEFORE the await on payCost and the tile is written AFTER
         it, so two clicks that overlap that await both see the same count. A
         payCost that resolves in the same microtask cannot reproduce it; one
         real timer tick can. Unset in every other scenario, nothing changes. */
      async function payCost(c) {
        spy.paid.push(c);
        if (__ctx.payDelay) await new Promise(r => setTimeout(r, __ctx.payDelay));
        return __ctx.payFails !== true;
      }
      ${ctx.demSrc ? 'async function demolishClick() ' + ctx.demSrc : ''}
      /* ⚠ THE FIRST FOUR KEYS ARE UNCHANGED, DELIBERATELY. Every section above
         §8 runs against this literal, and swapping in the real ECON.exemptTypes
         would silently change what bldNormalize does to a road in §2. The crew
         and ceiling keys are ADDED for §8 and read by lifted code only
         (bldSlots / bldSpeed / the order gate), so nothing older can see them.
         Their VALUES come from the shipped ECON.construction — Rule 4: the
         municipal ceiling is the number the design turns on and this file does
         not get to pick its own. */
      const bldCfg = () => ECON_ON ? { on: true, maxSec: 86400, formulaV: 1, exemptTypes: [],
                                       municipal: ${JSON.stringify(ECON_C.municipal)},
                                       slots: ${JSON.stringify(ECON_C.slots)},
                                       speed: ${JSON.stringify(ECON_C.speed)},
                                       confirmOverSec: ${ECON_C.confirmOverSec | 0} } : null;
      /* 🔴 THIS STUB LIES UNLESS IT IS CHAINED TO ECON_ON, AND THE LIE HID A
         LIVE DEFECT FOR A WHOLE ROUND. The shipped chain is
         bldDuration -> bldProfile -> bldCfg() -> window.MythicEconomy, and
         bldProfile's FIRST line returns null when bldCfg() does — so the real
         bldDuration returns 0 for exactly as long as bldCfg() returns null.
         This stub used to be an unconditional __ctx.dur, which silently
         asserted "ECON is up" in every scenario that wanted a duration.
         The ONE call site where that matters is opsReconcile's boot branch,
         which is awaited BY loadState — i.e. the one pass bldLoad's own header
         says runs before window.MythicEconomy exists, on 100% of page loads. So
         the amplifier case was graded in a state the product never reaches, and
         the ops-zombie sabotage reddened the round only by DELETING the
         resurrection line rather than by making it INERT, which is what
         actually happened. Chained here, econOn:false means what it says on the
         tin: no ECON, therefore no duration — the real boot ordering. See §3d. */
      const bldDuration = () => ECON_ON ? (__ctx.dur | 0) : 0;
      const bldSpeed = () => 1;
      function applyBuildLook() {}
      function bldFinish(k, t) {
        if (!t || !t.bld) return false;
        const r = t.bld; if (r.k === 1) t.lvl = r.l; delete t.bld;
        spy.finished.push({ key: k, at: __NOW, phase: spy.phase });
        return true;
      }
      function logEvent() {}
      // What the PLAYER READS. §3e grades the sentence, not just the ledger.
      function toast(m, kind) { spy.toasts.push({ m: m, kind: kind }); }
      function computeLinks() {} function manageAgents() {}
      function updateHUD() {} function saveNow() {} function saveSoon() {} function openInspect() {}
      /* §9a's neighbours on the 4-second beat. animate()'s block is scraped and
         RUN whole — the point is that bldSweep is IN it — so every sibling call
         needs a body. Each records itself, so §9a can also assert the beat did
         not stop working for everything else. */
      const performance = { now: () => __NOW };
      function evaluateNeeds() { spy.beat.push('evaluateNeeds'); }
      function caravanTick() { spy.beat.push('caravanTick'); }
      function expeditionTick() { spy.beat.push('expeditionTick'); }
      function refugeeTick() { spy.beat.push('refugeeTick'); }
      function decayTick() { spy.beat.push('decayTick'); }
      function nodeXpTick() { spy.beat.push('nodeXpTick'); }
      function finTick() { spy.beat.push('finTick'); }
      function finCount() { return 0; }
      function finRefreshMarket() { spy.beat.push('finRefreshMarket'); }
      function ecoSync() { spy.ecoSync.push(spy.phase); }
      function dropTileMesh() {} function refreshRoadArea() {} function placeMeshAt() {}
      function buildMesh() { return { mesh: true }; }
      function costLabel(c) { return Object.keys(c).join('+'); }
      function opsNetworkClose() { _opsNetKey = null; }
      const $ = () => ({ classList: { remove: () => {} } });
      const key = (x, z) => x + ',' + z;
      const inGrid = (x, z) => x >= 0 && z >= 0 && x < GRID && z < GRID;
      const opsKeyOf = (t) => OPS_PREFIX + t;
      const opsTypeOf = (b) => (b && b.indexOf(OPS_PREFIX) === 0) ? b.slice(OPS_PREFIX.length) : null;
      function opsRowAt(x, z, opType) {
        /* 🔴 blindRegister IS THE SHIPPED FAILURE SHAPE, NOT AN INVENTED ONE.
           opsRowAt reads the CACHED OPS.st, and opsRefresh writes
           { ops: [], unavailable: true } whenever _opsParent() is null and the
           bridge is not standalone — 'message' mode by design, an older parent
           with no cityOpsState, or a parent whose call threw. st.manager has the
           same effect (the manifest holds the MAYOR's rows, not the owner's).
           MANIFEST below still carries the licence, SITED, because the server
           side is unaffected — only the client's view is dark. */
        if (__ctx.blindRegister) return null;
        return MANIFEST.ops.find(o => o.type === opType && o.site && (o.site.x | 0) === (x | 0) && (o.site.y | 0) === (z | 0)) || null;
      }
      function opsRowForKey(k) {
        const t = game.tiles[k]; if (!t) return null;
        const ot = opsTypeOf(t.type); if (!ot) return null;
        const p = k.split(',').map(Number); return opsRowAt(p[0], p[1], ot);
      }
      async function opsRefresh() { return { ops: __ctx.blindRegister ? [] : MANIFEST.ops, unavailable: !!__ctx.blindRegister, manager: false }; }
      async function opsGrantNodeLicences() {}
      async function opsUnsite(id) {
        spy.unsite.push(id);
        if (__ctx.unsiteFails) return { ok: false };
        const o = MANIFEST.ops.find(q => q.id === id); if (o) o.site = null;
        return { ok: true };
      }
      function opsLab(row) { return (row && row.lab) || { tier: 1 }; }
      ${BLDSITE}
      ${BLDBUSY}
      ${BLDREM}
      ${BLDOPTY}
      /* Storage, not logic — the same reason _bldOffline and friends are
         declared here rather than lifted (see this sandbox's header). What the
         crew gate actually DOES with the counter is bldReserveCrew /
         bldReleaseCrew / bldCommitted, and those are lifted. */
      let _pendingOrders = 0;
      const bldReserveCrew = () => { _pendingOrders++; };
      const bldReleaseCrew = () => { _pendingOrders = Math.max(0, _pendingOrders - 1); };
      ${Object.keys(SRC).map(k => SRC[k]).join('\n')}
      /* 🏗 THE ORDER GATE, WRAPPED THE WAY node-city WRAPS IT — its own two
         statements, over the tryPlace lifted directly above. §8 drives the real
         decorator over the real base, so a refusal that fails to fire shows up
         as a tile on the board, which is what the player would see. */
      ${ctx.gateSrc ? 'const _tryPlaceOrderBase = tryPlace;\n      tryPlace = async function (x, z) ' + ctx.gateSrc + ';' : ''}
      /* 🏗 loadState's tile-rehydration statement, animate()'s 4-second block and
         offlineCatchUp's construction statements — each scraped and RUN, never
         re-typed. See §7, §9a and §9b for why each one has to be the shipped
         text and not a copy of it. The one-iteration for-loop around the load
         statement is not decoration: the shipped statement lives inside a
         for-of loop and opens with three continue guards, which are a
         SyntaxError outside a loop. */
      /* ⚠ __out, NOT a pre-declared t. The scraped statement declares its own
         const t, which SHADOWS anything of that name outside the loop body —
         the first attempt read the outer binding and got null on a healthy
         tree, i.e. the section failed for its own reason instead of the
         product's. The copy-out is the last statement in the block, so a
         continue guard that fires correctly yields no tile. */
      ${ctx.loadSrc ? 'function loadTile(k, td) { let __out = null; for (let _o = 0; _o < 1; _o++) {' + ctx.loadSrc + '\n        __out = t;\n      } return __out; }' : ''}
      ${ctx.beatSrc ? 'let sysTimer = 0;\n      function beatTick(sec) { sysTimer += sec; if (sysTimer >= 4) ' + ctx.beatSrc + ' }' : ''}
      ${ctx.offSrc ? 'async function offlineDrive(simSec, vFrom, OFFLINE_SLICE_SEC) ' + ctx.offSrc : ''}
      return {
        game: game, OPS: OPS,
        bldNormalize: bldNormalize, bldSweep: bldSweep, bldFinishAll: bldFinishAll,
        bldCancel: bldCancel, bldLoad: bldLoad, bldOrderRefund: bldOrderRefund,
        bldPayRefund: bldPayRefund, costOf: costOf, bldSite: bldSite,
        bldRefundFit: bldRefundFit, bldRefundLabel: bldRefundLabel,
        ledger: LEDGER, ledgerUnits: lUnits,
        raceRefund: (typeof raceRefund === 'function' ? raceRefund : null),
        demolishClick: (typeof demolishClick === 'function' ? demolishClick : null),
        select: (k) => { selectedKey = k; }, selected: () => selectedKey,
        opsReconcile: opsReconcile, opsFindLab: opsFindLab, opsResearchAdj: opsResearchAdj,
        rebuildDue: _bldRebuildDue,
        next: () => _bldNext, parkNext: () => { _bldNext = Infinity; },
        setOffline: (v) => { _bldOffline = v; }, setNow: (v) => { __NOW = v; },
        /* boot() in one call: the economy module finishes importing, so bldCfg()
           and bldDuration start answering. §3d uses it to cross the exact
           boundary opsReconcile sits on the wrong side of. */
        setEcon: (v) => { ECON_ON = !!v; },
        // §7 / §8 / §9 — the scraped production statements, exposed to be driven.
        loadTile:   (typeof loadTile === 'function' ? loadTile : null),
        beatTick:   (typeof beatTick === 'function' ? beatTick : null),
        offlineDrive: (typeof offlineDrive === 'function' ? offlineDrive : null),
        tryPlace:   (x, z) => tryPlace(x, z),
        setPlaceType: (v) => { placeType = v; },
        slots:      () => bldSlots(),
        committed:  () => bldCommitted(),
        offline:    () => _bldOffline,
      };`;
    return new Function('__ctx', S)(ctx);
  };
  const mkSpy = () => ({ writes: [], landed: {}, confirms: [], toasts: [], finished: [], ecoSync: [], unsite: [], paid: [], house: [], beat: [], longConfirms: [], phase: 'load' });
  const cinPerSec = (type) => {
    const d = BLDG[type]; const g = d && d.gen && +d.gen.cinder;
    return g > 0 ? g / CPD / 60 : 0;          // per-minute figure → per-hour → per-second
  };

  /* ── §2 THE GAP IS SEALED, AND THE ABSENCE IS PAID ONCE ─────────────────────
     The board: 12 Clubs, every one of them a k=0 site that came DUE 2 h into a
     6 h absence. Honest pay is 4 h of Club output each. Under the pre-sweep the
     buildings were finished at the wall clock before slice 0, so they were paid
     for all 6 h — including the 2 h they were still a hole in the ground. */
  {
    const NOW = Date.now(), awayH = 6, dueOffH = 2;
    const awayMs = awayH * 3600000, saveAt = NOW - awayMs;
    const spy = mkSpy();
    const api = mkCity({ spy: spy, B: BLDG });
    const N = 12, DUR = 3 * 3600;
    for (let i = 0; i < N; i++) {
      const dueAt = saveAt + dueOffH * 3600000;
      api.game.tiles[i + ',0'] = { type: 'club', lvl: 1, rot: 0, born: 0, earn: 0,
                                   bld: { k: 0, l: 1, s: dueAt - DUR * 1000, d: DUR, fv: 1, pc: 0, pr: null } };
    }
    const rate = cinPerSec('club');

    // ── the gap: everything boot() does between loadState() and the catch-up ──
    spy.phase = 'gap';
    api.setNow(NOW);
    api.bldNormalize(SABOTAGE === 'boot-presweep' ? false : true);
    const gapDone = spy.finished.length, gapWrites = spy.writes.length, gapSync = spy.ecoSync.length;
    chk('THE GAP IS SEALED — nothing completes between loadState() and offlineCatchUp()',
        gapDone === 0, gapDone + ' build order(s) completed at the WALL CLOCK, before the absence was simulated');
    chk('THE GAP IS SEALED — no ledger write and no ecoSync() in the gap',
        gapWrites === 0 && gapSync === 0,
        gapWrites + ' bridge write(s), ' + gapSync + ' ecoSync() — ecoSync founds firms, and a firm founded here draws its charter capital before the absence exists');

    // ── offlineCatchUp's slice loop, modelled (see the header) ──
    spy.phase = 'catchup';
    api.setOffline(true); api.rebuildDue();
    const simSec = Math.min(awayMs, CAP_H * 3600000) / 1000;
    let done = 0, credited = 0;
    while (done < simSec - 1e-9) {
      const dt = Math.min(SLICE, simSec - done);
      for (const kk in api.game.tiles) {
        const t = api.game.tiles[kk];
        if (api.bldSite(t)) continue;                 // a hole in the ground earns nothing
        credited += cinPerSec(t.type) * dt;
      }
      done += dt;
      const vnow = saveAt + done * 1000;
      if (vnow >= api.next()) {
        api.setNow(vnow); api.bldSweep(vnow); api.rebuildDue();
        if (api.next() <= vnow) api.parkNext();
      }
    }
    api.setOffline(false);
    spy.phase = 'post';
    api.setNow(Date.now()); api.bldSweep(Date.now());

    const honest = N * rate * (awayH - dueOffH) * 3600;
    const slack  = N * rate * SLICE;               // the slice-boundary under-credit, by design
    const mint   = credited - honest;
    console.log('   6 h absence · 12 Clubs · each due 2 h in · rate ' + (rate * 3600).toFixed(4) + ' 🔥/h');
    console.log('   honest ' + honest.toFixed(3) + ' 🔥   credited ' + credited.toFixed(3) +
                ' 🔥   delta ' + (mint >= 0 ? '+' : '') + mint.toFixed(3) + ' 🔥   (' +
                (mint / (rate * 3600)).toFixed(2) + ' unearned building-hours)');
    chk('RULE 1 — the absence never pays for time a building did not exist',
        mint <= 1e-9, 'MINTED ' + mint.toFixed(3) + ' 🔥 — the whole absence was credited to a building finished at the wall clock');
    chk('…and it is not under-paid beyond one slice boundary per job',
        credited >= honest - slack - 1e-9, 'credited ' + credited.toFixed(3) + ' vs honest ' + honest.toFixed(3));
    chk('every completion landed at the hour it happened, inside the catch-up',
        spy.finished.length === N && spy.finished.every(f => f.phase === 'catchup'),
        spy.finished.length + ' completion(s): ' + JSON.stringify(spy.finished.map(f => f.phase).filter((v, i, a) => a.indexOf(v) === i)));
  }

  /* ── §2b THE DEGRADE PATH STILL COMPLETES EVERYTHING ────────────────────────
     bldNormalize is DELIBERATELY outside boot()'s economy try block: when
     /src/economy 404s, `d` carries no ceiling and a job must never be left
     parked behind a module that never arrived. Deferring the completion must not
     turn that guarantee off — it moves it after the catch-up, where it is also
     no longer a mint. A job that is due still completes at its own hour inside
     the loop; anything left (an unbounded `d`) is finished by bldFinishAll.

     🔴 THIS SECTION DRIVES boot()'s OWN THREE STATEMENTS, NOT ITS OWN COPY OF
        THEM. It used to call `api.bldNormalize(true)` and then, twelve lines
        later, `if (deferred) api.bldFinishAll(deferred)` — a line THIS FILE
        wrote. So the section certified that bldFinishAll completes things, which
        was never in doubt, while the shipped hand-off in boot() could be deleted
        outright with both gates green from end to end. That is the exact shape
        of a round that "passes by exercising a shape production does not use".
        `bootDefer` below compiles the scraped `let _bldDeferredFinish = null;`,
        the scraped `try { _bldDeferredFinish = bldNormalize(true); } catch …`
        and the scraped
        `try { if (_bldDeferredFinish) bldFinishAll(_bldDeferredFinish); } catch …`
        and runs THOSE. Delete the third statement in node-city and this section
        leaves a tile parked, exactly as a player's city would — and §1 above
        goes red first, because a deleted statement cannot be driven at all.
        Prove it can fail: ECON_TEST_SABOTAGE=defer-park. */
  {
    const NOW = Date.now(), awayMs = 6 * 3600000, saveAt = NOW - awayMs;
    const spy = mkSpy();
    const api = mkCity({ spy: spy, B: BLDG, econOn: false });     // bldCfg() → null
    api.game.tiles['1,1'] = { type: 'club', lvl: 1, rot: 0, bld: { k: 0, l: 1, s: saveAt - 3600000, d: 3 * 3600, fv: 1, pc: 0, pr: null } };
    api.game.tiles['2,2'] = { type: 'club', lvl: 1, rot: 0, bld: { k: 0, l: 1, s: saveAt, d: 40 * 24 * 3600, fv: 1, pc: 0, pr: null } };
    spy.phase = 'gap';
    /* boot()'s two halves, in boot()'s own words. `bldNormalize` and
       `bldFinishAll` arrive as parameters, so the lifted statements close over
       this sandbox's tiles exactly as they close over node-city's. A missing
       statement degrades to a no-op rather than a throw, so the FAILURE this
       section reports is the player-visible one — a parked tile — and not a
       stack trace from the harness. */
    const bootDefer = (DEFER_DECL && DEFER_ASSIGN && DEFER_FINISH)
      ? new Function('bldNormalize', 'bldFinishAll', 'console',
          DEFER_DECL + '\n' + DEFER_ASSIGN + '\n' +
          'return { report: function () { return _bldDeferredFinish; },' +
          '         finish: function () { ' + DEFER_FINISH + ' } };')
        (api.bldNormalize, api.bldFinishAll, console)
      : { report: () => null, finish: () => {} };
    const deferred = bootDefer.report();
    chk('degrade path — bldNormalize(true) reports the module is gone instead of completing in the gap',
        typeof deferred === 'string' && deferred.length > 0 && spy.finished.length === 0,
        'returned ' + JSON.stringify(deferred) + ', ' + spy.finished.length + ' completed in the gap');
    spy.phase = 'catchup';
    api.setOffline(true); api.rebuildDue();
    let done = 0; const simSec = awayMs / 1000;
    while (done < simSec - 1e-9) {
      const dt = Math.min(SLICE, simSec - done); done += dt;
      const vnow = saveAt + done * 1000;
      if (vnow >= api.next()) { api.setNow(vnow); api.bldSweep(vnow); api.rebuildDue(); if (api.next() <= vnow) api.parkNext(); }
    }
    api.setOffline(false);
    spy.phase = 'post';
    api.setNow(Date.now()); api.bldSweep(Date.now());
    bootDefer.finish();               // boot()'s statement, not this file's
    const parked = Object.keys(api.game.tiles).filter(k => api.game.tiles[k].bld);
    chk('degrade path — NO TILE IS PARKED: every in-flight order completed by the end of boot',
        parked.length === 0, 'still building: ' + JSON.stringify(parked));
    chk('degrade path — the 40-DAY order was finished by bldFinishAll, not left behind a missing module',
        spy.finished.length === 2, JSON.stringify(spy.finished.map(f => f.key + '@' + f.phase)));
  }

  /* ── §3 CANCEL RETURNS THE LICENCE ──────────────────────────────────────────
     bldCancel() deleted the tile for k=0 and never unsited the operation, so the
     licence stayed sited — and opsReconcile's boot branch then rebuilt the tile
     with `bld: null`, i.e. FINISHED. Place → cancel (full refund) → reload was a
     free, instant, crew-slot-free operation. Applied to op_construction it is a
     BOOTSTRAP: a free Construction Co. lifts the municipal duration ceiling and
     raises crew slots and build speed, unlocking the whole gated feature with
     three ordinary UI clicks and no console. */
  {
    const manifest = { ops: [{ id: 'lic-1', type: 'construction', site: { nodeId: 'n', x: 5, y: 6, rot: 0, sitedAt: Date.now(), eff: 1 } }] };
    const spy = mkSpy();
    const api = mkCity({ spy: spy, B: BLDG, manifest: manifest });
    api.game.tiles['5,6'] = { type: 'op_construction', lvl: 1, rot: 0,
                              bld: { k: 0, l: 1, s: Date.now(), d: 3600, fv: 1, pc: 400, pr: { metal: 3 } } };
    await api.bldCancel('5,6');
    chk('cancelling an operation SITE unsites its licence',
        spy.unsite.indexOf('lic-1') >= 0 && manifest.ops[0].site === null,
        'opsUnsite calls ' + JSON.stringify(spy.unsite) + ', site ' + JSON.stringify(manifest.ops[0].site));
    chk('…and the refund was paid exactly once',
        spy.writes.filter(w => w.call === 'addCinders').length === 1 &&
        spy.writes.filter(w => w.call === 'addCinders')[0].n === 400,
        JSON.stringify(spy.writes));
    // …and now the reload. This is the real opsReconcile boot branch.
    const spy2 = mkSpy();
    const api2 = mkCity({ spy: spy2, B: BLDG, manifest: manifest });   // save has no tile at 5,6
    await api2.opsReconcile(true);
    chk('PLACE → CANCEL → RELOAD does not resurrect a finished operation',
        !api2.game.tiles['5,6'],
        'reload produced ' + JSON.stringify(api2.game.tiles['5,6']) + ' — bld:null means FINISHED, and this one is op_construction');
  }
  {
    /* The bridge can refuse. A cancel that pays the refund and leaves the
       licence sited is the exploit again by accident, so it is REFUSED whole —
       nothing has moved at that point and the player can click again. */
    const manifest = { ops: [{ id: 'lic-2', type: 'construction', site: { nodeId: 'n', x: 7, y: 7, rot: 0 } }] };
    const spy = mkSpy();
    const api = mkCity({ spy: spy, B: BLDG, manifest: manifest, unsiteFails: true });
    api.game.tiles['7,7'] = { type: 'op_construction', lvl: 1, rot: 0,
                              bld: { k: 0, l: 1, s: Date.now(), d: 3600, fv: 1, pc: 400, pr: null } };
    const r = await api.bldCancel('7,7');
    chk('a cancel whose unsite FAILS pays nothing and puts the order back',
        r === null && spy.writes.length === 0 && !!(api.game.tiles['7,7'] && api.game.tiles['7,7'].bld),
        'returned ' + JSON.stringify(r) + ', writes ' + JSON.stringify(spy.writes) + ', tile ' + JSON.stringify(api.game.tiles['7,7']));
  }
  /* ── §3c THE SAME EXPLOIT A SECOND TIME — A DARK REGISTER IS NOT "NOT AN OP" ──
     Round 1 fixed §3 by reading `opRow = (rec.k === 0) ? opsRowForKey(kk) : null`
     and treating `null` as "this tile is not an operation". It is not: null is
     ALSO "this IS an operation and the register cannot say which one", which is
     `message` bridge mode BY DESIGN, an older parent with no cityOpsState, a
     parent that threw, or a hired manager whose manifest holds their OWN rows.
     In all of those the 🧨 button deleted the tile, paid the refund in full and
     left the licence sited — and opsReconcile's boot branch handed the licence
     back as a finished building on the next load. It was reproduced live on the
     round-1 build for a free Construction Co., which is the bootstrap: municipal
     ceiling lifted, crew slots and build speed raised, whole feature unlocked.
     The refusal now keys off opsTypeOf(t.type) — the TILE's own type, which no
     dead bridge can take away. */
  {
    const manifest = { ops: [{ id: 'lic-3', type: 'construction', site: { nodeId: 'n', x: 9, y: 9, rot: 0, sitedAt: Date.now(), eff: 1 } }] };
    const spy = mkSpy();
    const api = mkCity({ spy: spy, B: BLDG, manifest: manifest, blindRegister: true });
    api.game.tiles['9,9'] = { type: 'op_construction', lvl: 1, rot: 0,
                              bld: { k: 0, l: 1, s: Date.now(), d: 3600, fv: 1, pc: 400, pr: { metal: 3 } } };
    // a plain municipal site, on the same dark register — this must still cancel
    api.game.tiles['2,2'] = { type: 'club', lvl: 1, rot: 0,
                              bld: { k: 0, l: 1, s: Date.now(), d: 3600, fv: 1, pc: 40, pr: null } };
    const r = await api.bldCancel('9,9');
    const still = api.game.tiles['9,9'];
    chk('a cancel is REFUSED when the register cannot resolve an operation tile',
        r === null && !!still && !!still.bld,
        'returned ' + JSON.stringify(r) + ', tile ' + JSON.stringify(still));
    chk('…nothing was refunded and the licence stayed BOUND to the plot',
        spy.writes.length === 0 && spy.unsite.length === 0 && manifest.ops[0].site !== null,
        'writes ' + JSON.stringify(spy.writes) + ' unsite ' + JSON.stringify(spy.unsite) +
        ' site ' + JSON.stringify(manifest.ops[0].site));
    const r2 = await api.bldCancel('2,2');
    chk('…and the refusal is NOT blanket — a municipal site still cancels and refunds',
        !!r2 && !api.game.tiles['2,2'] && spy.writes.filter(w => w.call === 'addCinders').length === 1,
        'returned ' + JSON.stringify(r2) + ', writes ' + JSON.stringify(spy.writes));
  }
  {
    /* THE AMPLIFIER. Whatever route ever leaves a licence sited with no tile,
       opsReconcile's boot branch is what turns it into money. It used to write
       `bld: null` — FINISHED. Now it writes a SITE with an EMPTY refund basis,
       so the honest player gets their building back and the exploiter gets a
       hole in the ground that refunds nothing. */
    const manifest = { ops: [{ id: 'lic-4', type: 'construction', site: { nodeId: 'n', x: 9, y: 9, rot: 0 } }] };
    const spy = mkSpy();
    const api = mkCity({ spy: spy, B: BLDG, manifest: manifest, dur: 3600 });
    await api.opsReconcile(true);                       // save carries no tile at 9,9
    const nt = api.game.tiles['9,9'];
    chk('a dangling licence resurrects as a SITE, never as a finished operation',
        !!nt && !!nt.bld && nt.bld.k === 0,
        'reconcile produced ' + JSON.stringify(nt && { type: nt.type, lvl: nt.lvl, bld: nt.bld }) +
        ' — bld:null means FINISHED, and this one is op_construction');
    chk('…with an EMPTY refund basis, so the resurrection is worth no Cinder',
        !!nt && !!nt.bld && (nt.bld.pc | 0) === 0 && !nt.bld.pr,
        JSON.stringify(nt && nt.bld));
    await api.bldCancel('9,9');
    chk('…and cancelling that resurrected site pays out nothing at all',
        spy.writes.length === 0 && manifest.ops[0].site === null,
        'writes ' + JSON.stringify(spy.writes) + ' site ' + JSON.stringify(manifest.ops[0].site));
  }

  /* ── §3d THE AMPLIFIER ON THE REAL BOOT PATH — ECON IS NOT UP YET ───────────
     🔴 THE CASE ABOVE PASSED WHILE THE PRODUCT WAS STILL BROKEN, AND THIS IS WHY.
     It ran with ECON up (`dur: 3600`), and opsReconcile's boot branch NEVER runs
     with ECON up. `opsReconcile(true)` is awaited by the loadState wrapper, i.e.
     inside the tile-rehydration pass bldLoad's own header describes: "RUNS
     BEFORE window.MythicEconomy EXISTS … ECON is undefined for the ENTIRE
     tile-rehydration pass on 100% of page loads." The economy module is imported
     ~1000 lines later in boot(), at the bldNormalize(true) site.
     So the round-2 fix — `nt.bld = bldRecord(0, 1, bldDuration(…), {})` — was
     INERT on every real boot: bldCfg() null → bldProfile null → bldDuration 0 →
     bldRecord returns null → the tile lands `bld: null`, which is FINISHED. The
     pre-fix behaviour, shipped behind a comment that says the opposite. Its
     author anticipated the null and then misread it as "a city with no timers at
     all" — it is not, it is every boot of a perfectly healthy city.
     `boot === true` is the ONLY way into that branch, so the line never executed
     under the conditions it was written for.
     THE PROPERTY UNDER TEST IS STRUCTURAL: the branch must be incapable of
     producing a finished building WITHOUT reading ECON at all. The duration it
     writes is then corrected by bldNormalize(true) — which runs after the module
     mounts and already applies the maxSec clamp and the formulaV rescale to
     every record on the board — and that second half is asserted here too. */
  {
    const manifest = { ops: [{ id: 'lic-5', type: 'construction', site: { nodeId: 'n', x: 11, y: 11, rot: 0 } }] };
    const spy = mkSpy();
    // econOn:false === window.MythicEconomy undefined === the real reconcile.
    const api = mkCity({ spy: spy, B: BLDG, manifest: manifest, econOn: false, dur: 3600 });
    await api.opsReconcile(true);
    const nt = api.game.tiles['11,11'];
    chk('the boot resurrection is a SITE even though ECON is not up yet',
        !!nt && !!nt.bld && nt.bld.k === 0,
        'reconcile produced ' + JSON.stringify(nt && { type: nt.type, lvl: nt.lvl, bld: nt.bld }) +
        ' — bld:null is FINISHED, and this is the state EVERY real boot is in');
    chk('…and it does not depend on a duration it cannot know yet',
        !!nt && !!nt.bld && Number.isFinite(nt.bld.d) && nt.bld.d > 0,
        'd=' + JSON.stringify(nt && nt.bld && nt.bld.d) + ' — a 0/NaN duration is due on the spot, i.e. finished');
    chk('…with an EMPTY refund basis, so it is still worth no Cinder',
        !!nt && !!nt.bld && (nt.bld.pc | 0) === 0 && !nt.bld.pr, JSON.stringify(nt && nt.bld));
    /* Nothing may complete it in the gap either — §1/§2's property, re-asserted
       on the record this branch writes, because a placeholder duration that
       reads as "already due" would be the same exploit wearing a site's hat. */
    const dueNow = api.bldSweep(Date.now());
    chk('…and it is NOT already due — a wall-clock sweep in the gap finishes nothing',
        spy.finished.length === 0 && !!api.game.tiles['11,11'].bld,
        'swept ' + JSON.stringify(spy.finished) + ' (' + dueNow + ')');
  }
  {
    /* THE SECOND HALF: the placeholder is a placeholder, not a number. This is
       the same tile after boot() has imported the economy module and called
       bldNormalize(true) — the only two bounds in the file that read ECON. The
       clamp can only SHORTEN, so the record is written long ON PURPOSE and
       arrives at the true op duration here. Were it written short, min() could
       never lift it and a 15-minute build would be permanent. */
    const manifest = { ops: [{ id: 'lic-6', type: 'construction', site: { nodeId: 'n', x: 12, y: 12, rot: 0 } }] };
    const spy = mkSpy();
    const api = mkCity({ spy: spy, B: BLDG, manifest: manifest, econOn: false, dur: 900 });
    await api.opsReconcile(true);                 // loadState: no ECON
    const raw = { ...api.game.tiles['12,12'].bld };
    api.setEcon(true);                            // the import lands
    api.bldNormalize(true);                       // boot()'s bldNormalize(true)
    const fixed = api.game.tiles['12,12'].bld;
    console.log('   resurrection d: ' + raw.d + 's (fv ' + raw.fv + ') → after bldNormalize ' +
                (fixed && fixed.d) + 's (fv ' + (fixed && fixed.fv) + ')');
    chk('bldNormalize resolves the placeholder to the real op duration',
        !!fixed && fixed.d === 900 && fixed.k === 0,
        JSON.stringify(fixed) + ' — expected the 900s bldDuration answer');
    chk('…and it is still a SITE afterwards, and still completes nothing in the gap',
        spy.finished.length === 0 && !!api.game.tiles['12,12'].bld,
        JSON.stringify(spy.finished));
  }

  /* ── §3e A CANCEL MAY NOT PROMISE WHAT THE VAULT CANNOT HOLD ────────────────
     🔴 THE LIVE PLAYER-HARM BUG. bldPayRefund returns materials through
     MythicCityBridge.addRes, which lands in index.html's addRes() — and that
     CLAMPS to the stash cap and drops the overflow behind a "STASH FULL" toast.
     Cancelling was advertised as a 100% refund in three separate places (the
     Site Board's button title, the long-order confirm, and the cancel toast,
     which printed costLabel(r.refund) — what was ASKED FOR, never what landed).

     MEASURED ON THIS HARNESS, before the fix, cancelling a Power Station site
     (costOf → 20,000 🔥 + 300 metal + 100 supplies = 400 units):
       vault 0/2,000      → 400 of 400 units banked, "refunded in full"   ✔ true
       vault 1,800/2,000  → 200 of 400 units banked, "refunded in full"   ✘ 200 lost
       vault 2,000/2,000  →   0 of 400 units banked, "refunded in full"   ✘ 400 lost
     The Cinder leg was never affected — addCinders has no ceiling — which is
     precisely why it read as working.

     THE PROPERTY UNDER TEST IS NOT "nothing is ever lost". A player at a full
     vault who wants a mis-clicked 24-hour order gone is allowed to take the
     loss, and refusing them would BRICK the tile for a day — the one state
     node-city's demolish comment calls "the only deliberately unrecoverable
     state in the whole design". The property is that THE PROMISE AND THE
     OUTCOME AGREE, and that nothing goes without being counted out loud first:
       · room available → no question asked, everything arrives
       · partial room   → the shortfall is named BEFORE anything moves, and "no"
                          leaves the order, the tile and the ledger untouched
       · no room        → same, and "yes" reports what actually arrived
     `spy.writes` is what the bridge was ASKED for; `spy.landed` is what the
     ledger TOOK. The defect is the gap between them, so both are asserted.

     SABOTAGE: refund-blind (re-commits "nobody asked the ceiling"). */
  {
    const chain = await import('../../public/src/resources/chain.js');
    const CHAIN = new Set(chain.NEW_IDS);
    const CAP = 2000;
    /* costOf, lifted — no price is written down here. A retune moves these
       numbers and the round still means the same thing. */
    const price = mkCity({ spy: mkSpy(), B: BLDG }).costOf('powerstation', 1);
    const pr = { ...price }; delete pr.cinder;
    const WANT = Object.values(pr).reduce((a, b) => a + b, 0);
    const mkRec = () => ({ k: 0, l: 1, s: Date.now(), d: 3600, fv: 1, pc: price.cinder | 0, pr: { ...pr } });
    console.log('   the order under test: costOf(powerstation,1) = ' + JSON.stringify(price) +
                '  → resource leg ' + WANT + ' units, cap ' + CAP);

    chk('§3e the resource leg is big enough to overflow a ' + CAP + '-unit vault',
        WANT > 0 && WANT < CAP, WANT + ' units — a leg of 0 would make every case below vacuous');

    /* THE PROMISE STRINGS THEMSELVES. FIVE places told the player the refund was
       100%, and the fifth was only found by this check: the Site Board's 🧨
       button title, the Demolish button's label, the long-order confirm, the
       dossier's countdown note, and a line of plain HTML in the Site Board's
       footer. None of them passes through a number the cases above can drive, so
       nothing else in this round can see them.
       ⚠ THE RULE IS "DO NOT WRITE THE PHRASE ANYWHERE", COMMENTS INCLUDED, and
         that is a deliberate simplification rather than an oversight.
         stripComments cannot reliably separate prose from markup in a 1.7 MB
         HTML document — an apostrophe in ordinary body text ("don't") opens a
         string as far as the stepper is concerned and can carry it across a
         comment boundary, so a comment that QUOTES the old wording shows up here
         as if it were shipping text. Rewording two comments in node-city was
         cheaper than a JS/HTML parser, and "describe the old promise, never
         reproduce it" is a rule a reader can follow. The failure direction is
         safe either way: this over-reports, it cannot under-report.
       bldRefundLabel builds its own "… refunded" + " in full." from two separate
       literals joined at run time, on the `whole` branch only, which is why the
       one honest use of that sentence is not a hit. */
    {
      const shown = stripComments(NC);
      const hits = ['100% refund', 'full refund', 'refunded in full', 'refunds the order in full',
                    'refunds the upgrade in full']
        .filter(p => shown.indexOf(p) >= 0);
      chk('§3e no UNCONDITIONAL "100% refund" promise is left anywhere a player can read it',
          hits.length === 0,
          'still promising: ' + JSON.stringify(hits) + ' — the refund is 100% of the Cinder and ' +
          'only as much of the materials as the vault will take');
    }

    /* One scenario, driven through the production call shape: the player paid
       at placement (so the units left the vault), then refilled to `held`. */
    const run = async (held, answer) => {
      const spy = mkSpy();
      const api = mkCity({ spy: spy, B: BLDG, cap: CAP, ledger: { food: held }, answer: answer });
      api.game.tiles['4,4'] = { type: 'powerstation', lvl: 1, rot: 0, bld: mkRec() };
      const before = api.ledgerUnits();
      const r = await api.bldCancel('4,4');
      /* WHAT THE PLAYER IS TOLD, built the way all three toasts build it. */
      const said = r ? api.bldRefundLabel(r) : null;
      /* WHAT THE PLAYER IS PROMISED, itemised: the Cinder plus the fit. */
      const promised = {};
      if (r) { if (r.refund.cinder) promised.cinder = r.refund.cinder;
               for (const k in r.fit.fit) if (r.fit.fit[k]) promised[k] = r.fit.fit[k]; }
      const got = {};
      const cin = spy.writes.filter(w => w.call === 'addCinders').reduce((a, w) => a + w.n, 0);
      if (cin) got.cinder = cin;
      for (const k in spy.landed) if (spy.landed[k]) got[k] = spy.landed[k];
      const norm = (o) => JSON.stringify(Object.keys(o).sort().map(k => k + ':' + o[k]));
      return { r, spy, said, promised, got, agree: norm(promised) === norm(got),
               moved: api.ledgerUnits() - before, tile: api.game.tiles['4,4'],
               resAsked: spy.writes.filter(w => w.call === 'addRes') };
    };

    // ── (1) ROOM AVAILABLE — the promise was always true here, and stays true.
    {
      const s = await run(0, true);
      console.log('   room available : said "' + s.said + '"');
      chk('§3e room available — no question is asked and the whole refund arrives',
          s.spy.confirms.length === 0 && s.moved === WANT && s.r && s.r.fit.whole,
          'confirms ' + s.spy.confirms.length + ', banked ' + s.moved + ' of ' + WANT +
          ', landed ' + JSON.stringify(s.spy.landed));
      chk('§3e room available — PROMISE === OUTCOME',
          s.agree && / in full\.$/.test(s.said),
          'promised ' + JSON.stringify(s.promised) + ' vs landed ' + JSON.stringify(s.got) + ' :: ' + s.said);
    }

    // ── (2) PARTIAL ROOM — half the leg fits. This is the case that lied.
    {
      const held = CAP - Math.floor(WANT / 2), fits = Math.floor(WANT / 2);
      const no = await run(held, false);
      chk('§3e partial room — the shortfall is named BEFORE anything moves',
          no.spy.confirms.length === 1 &&
          no.spy.confirms[0].indexOf(String(WANT - fits)) >= 0 &&
          no.spy.confirms[0].indexOf('LOST') >= 0,
          JSON.stringify(no.spy.confirms));
      chk('§3e partial room — "no" leaves the order, the tile and the ledger untouched',
          no.r === null && !!no.tile && !!no.tile.bld && no.spy.writes.length === 0 && no.moved === 0,
          'returned ' + JSON.stringify(no.r) + ', tile ' + JSON.stringify(no.tile && !!no.tile.bld) +
          ', writes ' + JSON.stringify(no.spy.writes) + ', moved ' + no.moved);

      const yes = await run(held, true);
      console.log('   partial room   : said "' + yes.said + '"');
      chk('§3e partial room — PROMISE === OUTCOME (' + fits + ' of ' + WANT + ' units)',
          yes.agree && yes.moved === fits && yes.r.fit.lostUnits === WANT - fits,
          'promised ' + JSON.stringify(yes.promised) + ' vs landed ' + JSON.stringify(yes.got) +
          ', banked ' + yes.moved + ' :: ' + yes.said);
      chk('§3e partial room — and it does NOT say "in full"',
          !/in full/.test(yes.said) && yes.said.indexOf('no room') >= 0, yes.said);
      /* The full leg is still handed to the ledger. Withholding the overflow
         ourselves would make US the destroyer, and would throw away units that
         DO fit wherever the forecast is pessimistic (a hired mayor's uncapped
         salvage delta) — see bldRefundFit's header. */
      chk('§3e partial room — the ledger is still asked for the WHOLE leg, not the fit',
          yes.resAsked.reduce((a, w) => a + w.n, 0) === WANT,
          JSON.stringify(yes.resAsked));
    }

    // ── (3) NO ROOM AT ALL — the worst case, and the one that read as fine.
    {
      const s = await run(CAP, true);
      console.log('   no room at all : said "' + s.said + '"');
      chk('§3e no room — PROMISE === OUTCOME (0 of ' + WANT + ' units, Cinder still whole)',
          s.agree && s.moved === 0 && s.r.fit.fitUnits === 0 && s.r.fit.lostUnits === WANT &&
          (s.promised.cinder | 0) === (price.cinder | 0),
          'promised ' + JSON.stringify(s.promised) + ' vs landed ' + JSON.stringify(s.got) + ' :: ' + s.said);
      chk('§3e no room — the toast names every unit that did not make it',
          !/in full/.test(s.said) && s.said.indexOf(String(WANT)) >= 0, s.said);
    }

    // ── (4) AN UNREADABLE CEILING IS NOT A FULL ONE ───────────────────────────
    /* cityResourceHeadroom answers {cap:0} both when there is no ceiling to
       report and while a hired mayor's owner-ledger is connecting — and in that
       second state cityAddRes QUEUES rather than banks, so nothing is clamped.
       Reading a 0 cap as "everything will be destroyed" would put a full-loss
       dialog in front of every cancel in someone else's city. */
    {
      const spy = mkSpy();
      const api = mkCity({ spy: spy, B: BLDG });          // no cap ⇒ {cap:0, free:Infinity}
      api.game.tiles['4,4'] = { type: 'powerstation', lvl: 1, rot: 0, bld: mkRec() };
      const r = await api.bldCancel('4,4');
      chk('§3e an UNKNOWN ceiling asks nothing and promises everything',
          spy.confirms.length === 0 && !!r && r.fit.whole && r.fit.fitUnits === WANT,
          'confirms ' + JSON.stringify(spy.confirms) + ', fit ' + JSON.stringify(r && r.fit));
    }

    // ── (5) RULE 2 — no chain resource reaches the camp ledger through a refund.
    {
      const chainId = chain.NEW_IDS.find(id => !BLDG.powerstation.cost[id]) || 'timber';
      const spy = mkSpy();
      const api = mkCity({ spy: spy, B: BLDG, cap: CAP, ledger: {}, answer: true });
      const rec = api.bldLoad({ ...mkRec(), pr: { ...pr, [chainId]: 5000 } }, 1, 'powerstation');
      api.game.tiles['4,4'] = { type: 'powerstation', lvl: 1, rot: 0, bld: rec };
      const r = await api.bldCancel('4,4');
      const asked = spy.writes.filter(w => w.call === 'addRes').map(w => w.r);
      chk('§3e RULE 2 — no chain id reaches addRes through the refund (' + chainId + ')',
          asked.every(k => !CHAIN.has(k)), JSON.stringify(asked));
      chk('§3e RULE 2 — and none is counted into the fit the player is promised',
          !!r && Object.keys(r.fit.want).every(k => !CHAIN.has(k)) &&
                 Object.keys(r.fit.fit).every(k => !CHAIN.has(k)),
          JSON.stringify(r && r.fit));
    }

    // ── (7) THE OTHER CALL SITE: THE UPGRADE-RACE REFUND ─────────────────────
    /* bldPayRefund has TWO callers. The second is the branch in the Upgrade
       button that fires when the tile changed while payCost was in flight — the
       player did not ask for anything, the game charged them and then could not
       deliver — and it carried the identical defect: "refunded in full" over a
       clamped addRes. There is no dialog to raise on a path the player did not
       initiate, so the requirement here is narrower and absolute: pay everything
       and NAME any shortfall.
       The branch is one `if` inside a 90-line click handler, so it is SCRAPED AS
       A STATEMENT and EXECUTED — the same technique §5 uses for loadState's
       damage/order line. A string comparison would not have caught that the old
       code ignored bldPayRefund's return value. */
    {
      const raceSrc = srcBlockAfter(NC, 'if (live !== t || bldBusy(t)) {');
      const ok = chk('§3e the upgrade-race refund branch is where this round thinks it is',
          !!raceSrc && raceSrc.indexOf('bldPayRefund') > 0 && raceSrc.indexOf('toast(') > 0,
          'scraped ' + JSON.stringify(raceSrc && raceSrc.slice(0, 80)));
      if (ok) {
        // Same vault, same price, same clamp — the only difference is the caller.
        const spy = mkSpy();
        const api = mkCity({ spy: spy, B: BLDG, cap: CAP, ledger: { food: CAP }, raceSrc: raceSrc });
        await api.raceRefund(price);
        const said = spy.toasts.length ? spy.toasts[0].m : '';
        const landedUnits = Object.values(spy.landed).reduce((a, b) => a + b, 0);
        console.log('   upgrade race   : said "' + said + '"');
        chk('§3e upgrade race — the whole leg is still handed to the ledger',
            spy.writes.filter(w => w.call === 'addRes').reduce((a, w) => a + w.n, 0) === WANT,
            JSON.stringify(spy.writes));
        chk('§3e upgrade race — and the player is TOLD the materials did not arrive',
            landedUnits === 0 && !/in full/.test(said) && said.indexOf(String(WANT)) >= 0 &&
            said.indexOf('no room') >= 0,
            'banked ' + landedUnits + ' units and said :: ' + said);
        chk('§3e upgrade race — the Cinder leg is still paid whole (it has no ceiling)',
            spy.writes.filter(w => w.call === 'addCinders').reduce((a, w) => a + w.n, 0) === (price.cinder | 0),
            JSON.stringify(spy.writes.filter(w => w.call === 'addCinders')));
        // …and with room, it still reads as the clean unwind it is.
        const spy2 = mkSpy();
        const api2 = mkCity({ spy: spy2, B: BLDG, cap: CAP, ledger: {}, raceSrc: raceSrc });
        await api2.raceRefund(price);
        chk('§3e upgrade race — with room, everything arrives and it says so',
            api2.ledgerUnits() === WANT && / in full\.$/.test(spy2.toasts[0].m),
            api2.ledgerUnits() + ' of ' + WANT + ' units :: ' + spy2.toasts[0].m);
      }
    }

    // ── (6) TWO CLICKS, ONE REFUND ────────────────────────────────────────────
    /* bldCancel used to clear `t.bld` synchronously before its first await, so a
       second click found nothing. The honesty check awaits BEFORE anything is
       cleared — it has to, because "no" must leave the order intact — so the
       latch inside bldCancel is now what stands between a double-click and a
       double refund. */
    {
      const spy = mkSpy();
      const api = mkCity({ spy: spy, B: BLDG, cap: CAP, ledger: {}, answer: true });
      api.game.tiles['4,4'] = { type: 'powerstation', lvl: 1, rot: 0, bld: mkRec() };
      const [a, b] = await Promise.all([api.bldCancel('4,4'), api.bldCancel('4,4')]);
      const cin = spy.writes.filter(w => w.call === 'addCinders').reduce((s, w) => s + w.n, 0);
      chk('§3e two clicks on one order pay exactly one refund',
          !!a !== !!b && cin === (price.cinder | 0) && api.ledgerUnits() === WANT,
          'returned ' + JSON.stringify([!!a, !!b]) + ', ' + cin + ' 🔥 paid (expected ' +
          (price.cinder | 0) + '), ' + api.ledgerUnits() + ' units banked (expected ' + WANT + ')');
    }
  }

  /* ── §3f …AND THE 🧨 BUTTON PAYS THE SAME REFUND THE SAME WAY ──────────────
     🔴 THE SIBLING OF §3e, REPRODUCED ON THE SHIPPED PAGE THROUGH ORDINARY UI
     CLICKS. §3e closed the CANCEL refund. The DEMOLISH refund is a tail inside
     the 🧨 click handler rather than a function anywhere, and it built its dict
     and handed it straight to a raw loop:
         for (const k in refund) if (refund[k]) await MythicCityBridge.addRes(k, refund[k]);
     addRes clamps to the vault ceiling, so demolishing at the cap destroyed the
     lot — and unlike the cancel path there was no dialog, no toast and no log
     line, so nothing a player could read said it had happened.

     IT HAS TWO LEGS AND BOTH GO THROUGH THE SAME CLAMP:
       · 50% of costOf(type, lvl) — the standing building;
       · 100% of the order's own pc/pr when the building is MID-UPGRADE (k=1).
     A round that only demolished an idle building would grade half of it, so
     every case below runs on a standing L2 Power Station with a live L3 order.

     MEASURED ON THIS HARNESS against the pre-fix handler (see the numbers the
     section prints): the two legs together are worth several hundred units, and
     at a full vault every one of them evaporated while the player was told
     nothing at all.

     THE PROPERTY IS §3e's, WORD FOR WORD: the promise and the outcome agree,
     and nothing goes without being counted out loud first. It is asserted here
     against the SAME machinery — bldRefundFit / bldConfirmLossy / bldPayRefund /
     bldRefundLabel — because two divergent refund payers is what caused this.

     SABOTAGE: demolish-blind (re-commits the raw loop and the silence).
     ⚠ refund-blind reddens this section too, and should: both paths ask the
       same bldRefundFit. */
  {
    const chain = await import('../../public/src/resources/chain.js');
    const CHAIN = new Set(chain.NEW_IDS);
    const CAP = 2000;
    /* 🧨 THE PRE-FIX TAIL, RE-COMMITTED WHERE IT ACTUALLY LIVED. Three anchors,
       each a single line (see the ops-zombie note on why never across a break):
       the honesty question goes, the one-call payer becomes the two shipped
       lines again, and the sentence the player reads goes with them. */
    const demSrc = unfix(srcBlockAfter(NC, "$('btn-demolish').onclick = guardedAction(async () => "),
      'demolish-blind', [
        ['if (!fore.whole && !(await bldConfirmLossy(', 'if (false && !(await bldConfirmLossy('],
        ['const fit = await bldPayRefund({ ...refund });',
         'if (refund.cinder) { await MythicCityBridge.addCinders(refund.cinder); delete refund.cinder; }\n' +
         '  const fit = { cap: 0, units: 0, want: {}, wantUnits: 0, fit: {}, fitUnits: 0, lost: {}, lostUnits: 0, whole: true };\n' +
         '  for (const k in refund) if (refund[k]) await MythicCityBridge.addRes(k, refund[k]);'],
        ["  toast('🧨 ' + nm + ' demolished'", "  if (0) toast('🧨 ' + nm + ' demolished'"],
      ]);
    const gotDem = chk('§3f the 🧨 click handler is where this round thinks it is',
        !!demSrc && demSrc.indexOf('costOf(') > 0 && demSrc.indexOf('bldOrderRefund(') > 0 &&
        demSrc.indexOf('ROAD_DEMOLISH_COST') > 0 && demSrc.indexOf('bldCancel(') > 0 &&
        Number.isFinite(RDC),
        'scraped ' + JSON.stringify(demSrc && demSrc.slice(0, 80)) + ' roadCost=' + RDC);

    if (gotDem) {
      const probe = mkCity({ spy: mkSpy(), B: BLDG });
      const STAND = probe.costOf('powerstation', 2);          // the level actually reached
      const ORDER = probe.costOf('powerstation', 3);          // the level never delivered
      const half = {}; for (const k in STAND) half[k] = Math.floor(STAND[k] * .5);
      const oPr = { ...ORDER }; delete oPr.cinder;
      /* The refund the handler must produce: 50% of the standing L2 plus 100%
         of the L3 order. Derived from costOf, so a retune moves it and the
         section still means the same thing — no price is written down here. */
      const WANT = {};
      for (const k in half) if (k !== 'cinder' && half[k]) WANT[k] = half[k];
      for (const k in oPr) if (oPr[k]) WANT[k] = (WANT[k] || 0) + oPr[k];
      const UNITS = Object.values(WANT).reduce((a, b) => a + b, 0);
      const STAND_UNITS = Object.keys(half).filter(k => k !== 'cinder').reduce((a, k) => a + half[k], 0);
      const ORDER_UNITS = Object.values(oPr).reduce((a, b) => a + b, 0);
      const CIN = (half.cinder | 0) + (ORDER.cinder | 0);
      console.log('   mid-upgrade demolish: standing L2 half-refund ' + STAND_UNITS +
                  ' units + L3 order ' + ORDER_UNITS + ' units = ' + UNITS + ' units, ' +
                  CIN.toLocaleString() + ' 🔥, cap ' + CAP);
      chk('§3f BOTH legs are non-empty — a one-legged case would grade half the bug',
          STAND_UNITS > 0 && ORDER_UNITS > 0 && UNITS < CAP,
          'standing ' + STAND_UNITS + ' + order ' + ORDER_UNITS + ' of ' + CAP);

      /* One scenario, driven through the PRODUCTION call shape: select the
         tile, then run the shipped click handler. */
      const run = async (held, answer, extra) => {
        const spy = mkSpy();
        const house = [];
        const api = mkCity({ spy: spy, B: BLDG, cap: CAP, ledger: { food: held }, answer: answer,
                             demSrc: demSrc,
                             win: { MythicHouse: { onDemolish: (t) => house.push(t.type) } },
                             ...(extra || {}) });
        api.game.tiles['4,4'] = { type: 'powerstation', lvl: 2, rot: 0,
                                  bld: { k: 1, l: 3, s: Date.now(), d: 3600, fv: 1,
                                         pc: ORDER.cinder | 0, pr: { ...oPr } } };
        api.select('4,4');
        const before = api.ledgerUnits();
        await api.demolishClick();
        const said = spy.toasts.length ? spy.toasts[spy.toasts.length - 1].m : '';
        const cin = spy.writes.filter(w => w.call === 'addCinders').reduce((a, w) => a + w.n, 0);
        const got = {}; if (cin) got.cinder = cin;
        for (const k in spy.landed) if (spy.landed[k]) got[k] = spy.landed[k];
        return { spy, said, house, got, cin, moved: api.ledgerUnits() - before,
                 tile: api.game.tiles['4,4'],
                 resAsked: spy.writes.filter(w => w.call === 'addRes') };
      };
      /* PROMISE === OUTCOME, read the way a player reads it: the sentence must
         name every unit that arrived and every unit that did not. */
      const agrees = (s, fitUnits) => {
        const lost = UNITS - fitUnits;
        const landed = Object.values(s.spy.landed).reduce((a, b) => a + b, 0);
        if (landed !== fitUnits) return false;
        if (s.cin !== CIN) return false;
        if (lost > 0) return /no room/.test(s.said) && s.said.indexOf(String(lost)) >= 0 && !/in full/.test(s.said);
        return / in full\.$/.test(s.said);
      };

      // ── (1) ROOM AVAILABLE ────────────────────────────────────────────────
      {
        const s = await run(0, true);
        console.log('   room available : said "' + s.said + '"');
        chk('§3f room available — no question, both legs arrive, and it says so',
            s.spy.confirms.length === 0 && s.moved === UNITS && agrees(s, UNITS) &&
            !s.tile && s.house.length === 1,
            'confirms ' + s.spy.confirms.length + ', banked ' + s.moved + ' of ' + UNITS +
            ', 🔥 ' + s.cin + ' of ' + CIN + ' :: ' + s.said);
      }

      // ── (2) PARTIAL ROOM — the case that destroyed materials in silence ────
      {
        const fits = Math.floor(UNITS / 2), held = CAP - fits;
        const no = await run(held, false);
        chk('§3f partial room — the shortfall is named BEFORE anything moves',
            no.spy.confirms.length === 1 && no.spy.confirms[0].indexOf(String(UNITS - fits)) >= 0 &&
            no.spy.confirms[0].indexOf('LOST') >= 0 && /[Dd]emolish/.test(no.spy.confirms[0]),
            JSON.stringify(no.spy.confirms));
        chk('§3f partial room — "no" leaves the tile, the order, the House and the ledger untouched',
            !!no.tile && !!no.tile.bld && no.spy.writes.length === 0 && no.moved === 0 &&
            no.house.length === 0 && no.spy.toasts.length === 0,
            'tile ' + JSON.stringify(!!no.tile && !!no.tile.bld) + ', writes ' + no.spy.writes.length +
            ', house ' + no.house.length + ', moved ' + no.moved);

        const yes = await run(held, true);
        console.log('   partial room   : said "' + yes.said + '"');
        chk('§3f partial room — PROMISE === OUTCOME (' + fits + ' of ' + UNITS + ' units)',
            yes.moved === fits && agrees(yes, fits),
            'banked ' + yes.moved + ' of ' + UNITS + ', 🔥 ' + yes.cin + ' :: ' + yes.said);
        chk('§3f partial room — the ledger is still asked for BOTH whole legs, not the fit',
            yes.resAsked.reduce((a, w) => a + w.n, 0) === UNITS, JSON.stringify(yes.resAsked));
      }

      // ── (3) NO ROOM AT ALL — the reproduction case ─────────────────────────
      {
        const s = await run(CAP, true);
        console.log('   no room at all : said "' + s.said + '"');
        chk('§3f no room — PROMISE === OUTCOME (0 of ' + UNITS + ' units, Cinder still whole)',
            s.moved === 0 && agrees(s, 0) && !s.tile,
            'banked ' + s.moved + ', 🔥 ' + s.cin + ' of ' + CIN + ' :: ' + s.said);
        chk('§3f no room — the player is TOLD, in a toast, that nothing came back',
            s.spy.toasts.length === 1 && s.spy.toasts[0].kind === 'bad' &&
            s.said.indexOf(String(UNITS)) >= 0,
            JSON.stringify(s.spy.toasts));
      }

      // ── (4) AN UNREADABLE CEILING IS NOT A FULL ONE ───────────────────────
      {
        const spy = mkSpy();
        const api = mkCity({ spy: spy, B: BLDG, demSrc: demSrc });   // no cap ⇒ {cap:0, free:Infinity}
        api.game.tiles['4,4'] = { type: 'powerstation', lvl: 2, rot: 0,
                                  bld: { k: 1, l: 3, s: Date.now(), d: 3600, fv: 1,
                                         pc: ORDER.cinder | 0, pr: { ...oPr } } };
        api.select('4,4');
        await api.demolishClick();
        /* ⚠ NULL-SAFE ON PURPOSE: under `demolish-blind` there is no toast at
           all, and a section that THREW would leave this round red for the
           wrong reason — a crash grades nothing. */
        chk('§3f an UNKNOWN ceiling asks nothing and demolishes without a dialog',
            spy.confirms.length === 0 && !api.game.tiles['4,4'] &&
            / in full\.$/.test((spy.toasts[0] || {}).m || ''),
            'confirms ' + JSON.stringify(spy.confirms) + ' :: ' + JSON.stringify(spy.toasts));
      }

      // ── (5) RULE 2 — no chain resource reaches the camp ledger ─────────────
      {
        const chainId = chain.NEW_IDS.find(id => !ORDER[id]) || 'timber';
        const spy = mkSpy();
        const api = mkCity({ spy: spy, B: BLDG, cap: CAP, ledger: {}, answer: true, demSrc: demSrc });
        const rec = api.bldLoad({ k: 1, l: 3, s: Date.now(), d: 3600, fv: 1,
                                  pc: ORDER.cinder | 0, pr: { ...oPr, [chainId]: 5000 } },
                                2, 'powerstation');
        api.game.tiles['4,4'] = { type: 'powerstation', lvl: 2, rot: 0, bld: rec };
        api.select('4,4');
        await api.demolishClick();
        const asked = spy.writes.filter(w => w.call === 'addRes').map(w => w.r);
        chk('§3f RULE 2 — no chain id reaches addRes through the demolish refund (' + chainId + ')',
            asked.length > 0 && asked.every(k => !CHAIN.has(k)), JSON.stringify(asked));
      }

      // ── (6) THE IDLE BUILDING AND THE ROAD ARE NOT REGRESSED ──────────────
      /* The 50% leg on its own is what 🧨 has always paid, and a road is CHARGED
         rather than refunded. Both run through the same handler, so both are
         driven here — a fix that only thought about the k=1 case would show up
         as a road that stopped charging or a demolish that stopped paying. */
      {
        const spy = mkSpy();
        const api = mkCity({ spy: spy, B: BLDG, cap: CAP, ledger: {}, demSrc: demSrc });
        api.game.tiles['4,4'] = { type: 'powerstation', lvl: 2, rot: 0 };   // idle, no order
        api.select('4,4');
        await api.demolishClick();
        chk('§3f an IDLE building still pays exactly its 50% leg and nothing more',
            api.ledgerUnits() === STAND_UNITS && spy.confirms.length === 0 &&
            spy.writes.filter(w => w.call === 'addCinders').reduce((a, w) => a + w.n, 0) === (half.cinder | 0),
            api.ledgerUnits() + ' of ' + STAND_UNITS + ' units, writes ' + JSON.stringify(spy.writes));

        const spyR = mkSpy();
        const apiR = mkCity({ spy: spyR, B: BLDG, cap: CAP, ledger: {}, demSrc: demSrc });
        apiR.game.tiles['5,5'] = { type: 'road', lvl: 1, rot: 0 };
        apiR.select('5,5');
        await apiR.demolishClick();
        chk('§3f a road is still CHARGED ' + RDC + ' 🔥 and refunds nothing',
            spyR.paid.length === 1 && spyR.paid[0].cinder === RDC &&
            spyR.writes.length === 0 && !apiR.game.tiles['5,5'],
            'paid ' + JSON.stringify(spyR.paid) + ', writes ' + JSON.stringify(spyR.writes));

        const spyF = mkSpy();
        const apiF = mkCity({ spy: spyF, B: BLDG, cap: CAP, ledger: {}, payFails: true, demSrc: demSrc });
        apiF.game.tiles['5,5'] = { type: 'road', lvl: 1, rot: 0 };
        apiF.select('5,5');
        await apiF.demolishClick();
        chk('§3f …and an unaffordable road is not lifted',
            !!apiF.game.tiles['5,5'] && spyF.toasts.length === 1,
            'tile ' + !!apiF.game.tiles['5,5'] + ' :: ' + JSON.stringify(spyF.toasts));
      }

      // ── (7) A SITE STILL ROUTES THROUGH bldCancel, NOT THROUGH THIS TAIL ──
      /* One refund policy for a hole in the ground. If the 🧨 tail ever grew its
         own site branch it would be a third payer, which is how this started. */
      {
        const spy = mkSpy();
        const api = mkCity({ spy: spy, B: BLDG, cap: CAP, ledger: {}, answer: true, demSrc: demSrc });
        const price = api.costOf('powerstation', 1);
        const sPr = { ...price }; delete sPr.cinder;
        const sUnits = Object.values(sPr).reduce((a, b) => a + b, 0);
        api.game.tiles['4,4'] = { type: 'powerstation', lvl: 1, rot: 0,
                                  bld: { k: 0, l: 1, s: Date.now(), d: 3600, fv: 1,
                                         pc: price.cinder | 0, pr: { ...sPr } } };
        api.select('4,4');
        await api.demolishClick();
        chk('§3f a SITE is cancelled at 100% of the order — one refund policy, not two',
            api.ledgerUnits() === sUnits && !api.game.tiles['4,4'] &&
            spy.writes.filter(w => w.call === 'addCinders').reduce((a, w) => a + w.n, 0) === (price.cinder | 0),
            api.ledgerUnits() + ' of ' + sUnits + ' units :: ' + JSON.stringify(spy.toasts));
      }
    }
  }

  /* ── §4 THE SAVE MAY NOT SET ITS OWN REFUND ─────────────────────────────────
     `pc`/`pr` came off disk unclamped and unvalidated and flow
     bldOrderRefund → bldPayRefund → addCinders → addGems → Profile.gems. That is
     the first attacker-controlled MAGNITUDE in the city save format (the
     pre-existing demolish refund is bounded by costOf). Unvalidated `pr` keys
     also let a CHAIN resource id reach addRes, which is a Rule 2 violation:
     chain ids are not camp ledger ids and nothing must ever bank one. */
  {
    const spy = mkSpy();
    const api = mkCity({ spy: spy, B: BLDG });
    const chain = await import('../../public/src/resources/chain.js');
    const CHAIN = new Set(chain.NEW_IDS);
    const chainId = chain.NEW_IDS.find(id => !BLDG.club.cost[id]) || 'timber';
    const doctored = { k: 0, l: 1, s: Date.now() - 1000, d: 3600, fv: 1,
                       pc: 999999999,
                       pr: { metal: 999999, cinder: 1e9, [chainId]: 5000, ['__proto__']: 1 } };
    const rec = api.bldLoad(doctored, 1, 'club');
    const cap = api.costOf('club', 1);
    const refund = api.bldOrderRefund(rec);
    await api.bldPayRefund({ ...refund });
    const paidCin = spy.writes.filter(w => w.call === 'addCinders').reduce((a, w) => a + w.n, 0);
    const resKeys = spy.writes.filter(w => w.call === 'addRes').map(w => w.r);
    console.log('   doctored save claimed pc=999,999,999 + ' + JSON.stringify(doctored.pr));
    console.log('   costOf(club,1) = ' + JSON.stringify(cap) + '   refunded = ' + JSON.stringify(refund));
    chk('a doctored save refunds no more Cinder than costOf(type, lvl)',
        paidCin <= (cap.cinder | 0), paidCin + ' 🔥 vs cap ' + (cap.cinder | 0));
    chk('…and no more of any resource than costOf(type, lvl)',
        Object.keys(refund).every(r => r === 'cinder' || refund[r] <= (cap[r] | 0)),
        JSON.stringify(refund) + ' vs ' + JSON.stringify(cap));
    chk('RULE 2 — no chain resource id reaches addRes from a save (' + chainId + ')',
        resKeys.every(r => !CHAIN.has(r)), JSON.stringify(resKeys));
    chk('…and no invented key survives either (cinder / __proto__ / unpriced ids)',
        resKeys.every(r => r !== 'cinder' && r !== '__proto__' && (cap[r] | 0) > 0), JSON.stringify(resKeys));
  }

  /* ── §5 A RELOAD IS NOT A FREE REPAIR ───────────────────────────────────────
     loadState dropped the damage flag on ANY tile with a live order. The
     justifying comment says the (bld && damaged) pair is unreachable by
     construction — true for k=0, and FALSE for k=1: damageTile() and decayTick()
     refuse only bldSite(t), so a STANDING building that happens to be upgrading
     can be damaged, and an upgrade window is up to 24 h wide. The reload waived
     REPAIR_COST_FRAC × costOf(). */
  {
    const drop = new Function('t', DMG_STMT + ' return t;');
    const upgrading = drop({ bld: { k: 1, l: 2 }, damaged: true });
    const site      = drop({ bld: { k: 0, l: 1 }, damaged: true });
    console.log('   statement under test, verbatim: ' + DMG_STMT);
    chk('a STANDING building damaged mid-upgrade keeps its damage across a reload',
        upgrading.damaged === true, 'k=1 tile came back damaged=' + upgrading.damaged + ' — that is a free repair');
    chk('…and a construction SITE still cannot come back damaged',
        site.damaged === false, 'k=0 tile came back damaged=' + site.damaged);
  }

  /* ── §6 A HOLE IN THE GROUND PRODUCES NOTHING ───────────────────────────────
     opsFindLab() was the one production read site in the file with no bldSite
     gate (opsResearchAdj the same, for its adjacency bonus): an Anomaly Lab that
     was still a foundation pad produced Anomaly X — sellable for Cinder — and
     consumed the player's reagents. opsLabTick() is `const f = opsFindLab(); if
     (!f) return;`, so the gate here is the whole of "produces nothing, consumes
     nothing". An UPGRADING lab (k=1) is standing and must keep working. */
  {
    const manifest = { ops: [{ id: 'lab-1', type: 'smuggling', site: { x: 3, y: 3, rot: 0 }, lab: { tier: 2 } }] };
    const spy = mkSpy();
    const api = mkCity({ spy: spy, B: BLDG, manifest: manifest });
    const T = api.game.tiles;
    T['3,3'] = { type: 'op_smuggling', lvl: 1, rot: 0, bld: { k: 0, l: 1, s: Date.now(), d: 3600, fv: 1 } };
    T['4,4'] = { type: 'reslab', lvl: 1, rot: 0, bld: { k: 0, l: 1, s: Date.now(), d: 3600, fv: 1 } };
    chk('a sited-but-UNBUILT Anomaly Lab is not found — so it produces and consumes nothing',
        api.opsFindLab() === null, JSON.stringify(api.opsFindLab()));
    chk('an unbuilt Research Spire pays no adjacency bonus',
        api.opsResearchAdj('3,3') === false, 'adjacency granted by a foundation pad');
    T['3,3'].bld = { k: 1, l: 2, s: Date.now(), d: 3600, fv: 1 };   // standing, upgrading
    T['4,4'].bld = null;
    chk('…and a STANDING lab still works while it upgrades, with a real Spire next to it',
        !!api.opsFindLab() && api.opsResearchAdj('3,3') === true,
        'findLab=' + !!api.opsFindLab() + ' adj=' + api.opsResearchAdj('3,3'));
  }

  /* ── §7 THE ORDER SURVIVES A SAVE, AND THE LOAD STATEMENT STILL COMPILES ────
     🔴 THE TWO HUNKS THIS SECTION EXISTS FOR, AND WHAT REVERTING EITHER COSTS.

     h137 adds the `...(t.bld ? { b: {…} } : {})` spread to serialize()'s tile
     record. `s` and `d` are the ONLY record that a 24-hour job is running, so
     without that key EVERY PAID ORDER ON THE BOARD VANISHES on the next save —
     and bldLoad's governing principle ("every ambiguity resolves toward
     COMPLETION") then hands the player the finished building for free on the
     reload. The Cinder was spent. Measured against the shipped tree: revert
     h137, both syntax checks CLEAN, gate GREEN, exit 0.

     h145 splits `lvl` out of the tile literal into its own `const`, because
     `bld: bldLoad(td.b, lvl, td.type)` needs to READ it. Revert it and `lvl`
     is a free identifier inside the tile loop — a ReferenceError on the first
     tile of every load, i.e. no city loads at all. An undefined free variable
     is valid syntax, so `_synckcheck.mjs` cannot see it: measured, both syntax
     checks CLEAN and the gate GREEN, exactly as with h137.

     HOW A ReferenceError IS CAUGHT HERE, since that is the whole trick: the
     scraped statement is EXECUTED, in a `new Function` whose parameters are
     exactly what loadState legitimately has in scope. `lvl` is deliberately NOT
     among them. If the statement declares it, the call returns a tile; if the
     declaration has been reverted away, reading it throws, and the throw is
     caught and reported as a FAILED check rather than as a stack trace — the
     shape round0s §3e uses for `save-gone`.

     THE PRODUCTION CALLERS THIS MIRRORS: `serialize()` (its own `tiles[k] = {…}`
     literal, evaluated) → JSON → `loadState()` (its own tile statement, run) →
     the real `bldLoad`. Nothing between them is re-typed, so the round-trip
     under test is the one an ordinary tab close and reopen performs.

     SABOTAGE: save-noborder (h137) · load-nolvl (h145). */
  {
    /* The serialize literal. Scoped to serialize() first: `tiles[k] =` also
       matches spawnAnchors' `game.tiles[k] = { type: 'anchor', … }` six
       thousand lines above, and srcBlockAfter would happily return THAT — a
       three-key literal with no `b` and no `stad`, i.e. a scrape that reads as
       "the fix is missing" on a healthy tree. The decl must also stop BEFORE
       the brace, or srcBlockAfter starts its scan at the next one it finds:
       an anchor of `tiles[k] = { type: t.type,` returned the `house:` IIFE's
       body instead of the record. */
    const SER_FN = NC.slice(NC.indexOf('function serialize()'));
    const SER_LIT = unfix(srcBlockAfter(SER_FN, 'tiles[k] ='), 'save-noborder', [
      ['...(t.bld ? { b: {', '...(false ? { b: {'],
    ]);
    /* loadState's tile statement: the loop body, cut immediately after the
       statement that calls bldLoad. Taken WITH its `continue` guards, because
       they are part of what production runs — hence the one-iteration `for`
       wrapper in the sandbox. */
    const LOOP = srcBlockAfter(NC, 'for (const [k, td] of Object.entries(s.tiles))');
    const bldAt = LOOP ? LOOP.indexOf('bld: bldLoad(') : -1;
    const stopAt = bldAt >= 0 ? LOOP.indexOf('};', bldAt) : -1;
    /* ⚠ TWO SINGLE-LINE ANCHORS, NEVER ONE ACROSS THE BREAK — the ops-zombie
       rule. Together they are h145 reversed, verbatim: the binding goes and the
       expression moves back inline, so `lvl` in the bldLoad call is free. */
    const LOAD_STMT = unfix(stopAt > 0 ? LOOP.slice(1, stopAt + 2) : null, 'load-nolvl', [
      ['const lvl = Math.min(BUILDINGS[td.type].maxLvl || MAX_LVL, td.lvl | 0) || 1;', ''],
      ['const t = { type: td.type, lvl, damaged: !!td.dmg,',
       'const t = { type: td.type, lvl: Math.min(BUILDINGS[td.type].maxLvl || MAX_LVL, td.lvl | 0) || 1, damaged: !!td.dmg,'],
    ]);

    const gotSer = chk('§7 serialize()\'s tile record and loadState()\'s tile statement are where this round thinks they are',
        !!SER_LIT && !!LOAD_STMT && SER_LIT.indexOf('stad:') > 0 && LOAD_STMT.indexOf('bldLoad(') > 0,
        'literal ' + JSON.stringify(SER_LIT && SER_LIT.slice(0, 60)) + ' stmt ' + JSON.stringify(LOAD_STMT && LOAD_STMT.slice(0, 60)));

    if (gotSer) {
      /* ⏳ A 24-HOUR ORDER, TWO HOURS IN. The numbers come from ECON's own
         ceiling, so a retune moves them and the section still means the same
         thing. */
      const DUR = ECON_C.maxSec, NOW = Date.now(), STARTED = NOW - 2 * 3600000;
      const live = { type: 'powerstation', lvl: 2, damaged: false, rot: 0, wear: 0, born: 0, spent: 0, earn: 0,
                     bld: { k: 1, l: 3, s: STARTED, d: DUR, fv: 1, pc: 4321, pr: { metal: 7 } } };
      const done = { type: 'club', lvl: 1, damaged: false, rot: 0, wear: 0, born: 0, spent: 0, earn: 0 };

      /* serialize()'s OWN literal, evaluated. Only `t` and `window` are in
         scope, which is all it reads. */
      const ser = new Function('t', 'window', 'return (' + SER_LIT + ');');
      let sLive = null, sDone = null, serThrew = null;
      try { sLive = ser(live, {}); sDone = ser(done, {}); } catch (e) { serThrew = String(e); }
      chk('§7 serialize() writes the build order onto the tile it belongs to',
          !!sLive && !!sLive.b && sLive.b.d === DUR && sLive.b.k === 1 && sLive.b.l === 3,
          serThrew || 'saved b = ' + JSON.stringify(sLive && sLive.b) +
          ' — with no `b` key the order is GONE and bldLoad completes the building for free on the next load');
      chk('§7 …and the start stamp survives as a full millisecond epoch, not a 32-bit truncation',
          !!sLive && sLive.b && sLive.b.s === STARTED && sLive.b.s > 2147483647,
          'saved s = ' + JSON.stringify(sLive && sLive.b && sLive.b.s) + ' vs ' + STARTED);
      chk('§7 …and it carries the refund basis the cancel path pays against',
          !!sLive && sLive.b && sLive.b.pc === 4321 && sLive.b.pr && sLive.b.pr.metal === 7,
          JSON.stringify(sLive && sLive.b));
      chk('§7 a FINISHED tile writes no `b` key at all — no existing save grows by a byte',
          !!sDone && !('b' in sDone), JSON.stringify(sDone && sDone.b));

      /* loadState's own statement, RUN. `lvl` is not a parameter — see the
         header. Everything else is what loadState really has in scope. */
      const probe = mkCity({ spy: mkSpy(), B: BLDG, loadSrc: LOAD_STMT });
      probe.game.cityAge = 999999;
      const roundTrip = (saved) => {
        try { return { t: probe.loadTile('4,4', JSON.parse(JSON.stringify(saved))) }; }
        catch (e) { return { err: e }; }
      };
      const rt = roundTrip(sLive || {});
      chk('§7 loadState\'s tile statement RUNS — every identifier it reads is one it declares or is given',
          !rt.err, 'threw ' + (rt.err && (rt.err.name + ': ' + rt.err.message)) +
          ' — an undefined free variable is valid syntax, so neither _synckcheck.mjs nor a behaviour test above can see this');
      const back = rt.t && rt.t.bld;
      chk('§7 THE ROUND TRIP — a 24-hour order two hours in comes back still running',
          !!back && back.k === 1 && back.l === 3 && back.d === DUR &&
          Math.abs((back.s + back.d * 1000 - NOW) / 1000 - (DUR - 7200)) < 60,
          'reloaded bld = ' + JSON.stringify(back) +
          ' — null here means the building was handed over FINISHED, with the Cinder already spent');
      chk('§7 …and the reloaded tile kept its level, which is the same binding bldLoad reads',
          !!rt.t && rt.t.lvl === 2, 'lvl = ' + JSON.stringify(rt.t && rt.t.lvl));
      /* THE HONEST PLAYER ON THE UNHAPPY PATH: a save written before this
         feature has no `b` on any tile, and must load as a finished building —
         never as a hole in the ground nobody can clear. */
      const old = roundTrip({ type: 'club', lvl: 1, rot: 0, wear: 0, born: 0 });
      chk('§7 a pre-feature save still loads, with every building FINISHED',
          !old.err && !!old.t && !old.t.bld,
          old.err ? String(old.err) : 'bld = ' + JSON.stringify(old.t && old.t.bld));
    }
  }

  /* ── §8 THE ORDER GATE, AND THE CAP RACE UNDERNEATH IT ──────────────────────
     🔴 THE THREE HUNKS THIS SECTION EXISTS FOR.

     h156 is the order-gate decorator — the block that wraps tryPlace and holds
     BOTH placement refusals. Revert it and they go together: unlimited queued
     jobs past bldSlots(), and a 3h23 arena placeable in a city with no
     Construction Co., which is the entire municipal-ceiling design defeated in
     one hunk. Measured: both syntax checks CLEAN, gate GREEN, exit 0.

     h096/h097/h099 are the `_pendingType` multiset. The per-type cap is counted
     from `game.tiles` BEFORE `await payCost` and the tile is written AFTER it,
     so two clicks on two DIFFERENT squares both read count 0 and both pass a
     `cap: 1` check. `_placing` does not cover it — it is per-SQUARE by design.
     That was survivable when a duplicate was a click and a refund away; with a
     24-hour timer it is a day-long unwinnable tile. Measured: GREEN.

     h098 puts `bld: bldRecord(0, 1, durSec, cost)` on the placed tile. Revert
     it and every building goes up instantly: no timer, no site, nothing to
     cancel — the headline feature is void and nothing else in this gate says
     so. Measured: GREEN.

     THE PRODUCTION CALLER THIS MIRRORS is a click on the shop card: the shipped
     `tryPlace = async function (x, z)` decorator over the shipped
     `async function tryPlace(x, z)`, both lifted, with the real bldSlots /
     bldCommitted / bldCoTiles arithmetic underneath and the real ECON slot
     table behind bldCfg(). The stubs are the mesh, the ledger and the dialogs.

     ⚠ WHAT THE GUARDS MUST NOT DO TO AN HONEST PLAYER, asserted here because a
       refusal is only half a design: an exempt type (durSec 0 — roads, walls,
       lots, decor) goes straight through with no crew test and no ceiling test,
       and TWO legitimate concurrent placements of a type whose cap allows both
       must BOTH land. The multiset is a multiset for that second reason; a Set
       would have thrown one of them away.

     SABOTAGE: gate-ungated (h156) · cap-race (h096) · place-nobld (h098). */
  {
    /* The gate wrapper's own function body. Sliced from its declaration first:
       `tryPlace = async function (x, z)` matches the OPERATIONS wrapper too,
       and that one is ~75 lines earlier — scraping it would grade the ops gate
       while claiming to grade the order gate. */
    const GATE_AT = NC.indexOf('const _tryPlaceOrderBase = tryPlace;');
    const GATE_SRC = unfix(GATE_AT < 0 ? null : srcBlockAfter(NC.slice(GATE_AT), 'tryPlace = async function (x, z)'),
      'gate-ungated', [
        /* h156 reversed in effect: both refusals stop refusing. The wrapper
           itself stays, so this grades the REFUSALS rather than the scrape.
           ⚠ SINGLE-LINE ANCHORS, and the first attempt here proved why the
             ops-zombie header insists on it: an anchor of
             `…bldSlots()) {\n      toast(bldCrewBusyMsg()` matched NOTHING,
             because node-city has CRLF line endings. It reddened the round
             through `patchOk` instead of through the defect, and REFUSAL 1
             stayed green under a switch that claimed to remove it.
           The crew test appears twice in the wrapper (once before the long-order
           dialog, once after it) and unfix replaces every occurrence — which is
           correct: h156 takes both away together. */
        ['if (bldCommitted() >= bldSlots())', 'if (false)'],
        ['if (bldOpType(placeType) === null && durSec > C.municipal.maxSec && !bldCoTiles().length)', 'if (false)'],
      ]);

    const gotGate = chk('§8 the order gate is where this round thinks it is',
        !!GATE_SRC && GATE_SRC.indexOf('_tryPlaceOrderBase') > 0 && GATE_SRC.indexOf('bldReserveCrew()') > 0 &&
        !!PENDING_MAP && !!PENDING_OF,
        'gate ' + JSON.stringify(GATE_SRC && GATE_SRC.slice(0, 70)) +
        ' _pendingType=' + JSON.stringify(PENDING_MAP) + ' _pendingOf=' + JSON.stringify(PENDING_OF) +
        ' — a missing reservation declaration IS the h096 revert, seen from here');

    if (gotGate) {
      /* A cap-1 building, DERIVED. The comment beside _pendingType names six of
         them; naming one here would rot the day that building is retuned.
         `requiresCard` and `concourse` are excluded because they add a refusal
         of their own — this section is about the CAP, and a scenario that lost
         its race to a missing Structure card would pass for the wrong reason.
         `pop` is NOT excluded: popCap() is stubbed wide open, so the population
         branch never fires, and excluding it leaves no candidate at all. */
      const CAP1 = Object.keys(BLDG).find(t => BLDG[t] && BLDG[t].cap === 1 && !BLDG[t].requiresCard && !BLDG[t].concourse);
      const CAPN = Object.keys(BLDG).find(t => BLDG[t] && !BLDG[t].cap && !BLDG[t].requiresCard &&
                                              !BLDG[t].concourse && !BLDG[t].pop && !BLDG[t].decor && t !== 'road');
      chk('§8 the map still has a cap-1 building and an uncapped one to race',
          !!CAP1 && !!CAPN, 'cap1=' + CAP1 + ' capN=' + CAPN);

      /* 🏭 op_* IS NOT IN THE BUILDINGS LITERAL. node-city registers every
         operation into BUILDINGS from OP_BP at runtime, ~3,000 lines below the
         literal this round reads — the same registration loop round0f's
         `stale-workplaces` switch is about. That loop is NOT what §8 grades:
         the term under test is `bldOpType(placeType) === null` in the ceiling
         refusal, and it needs a def to exist at all to get that far. So one is
         supplied, with the shape ops really have (cost {} — index.html gives
         every op an empty cost dict, the licence having been paid at City Hall)
         and nothing else. */
      const B_OPS = { ...BLDG, op_construction: { name: 'Construction Co.', cost: {} } };

      const mkPlace = (extra) => mkCity({ spy: mkSpy(), B: BLDG, dur: 3600, payDelay: 5, ...(extra || {}) });

      // ── (1) THE CAP RACE — two clicks, two squares, one slot in the design ──
      {
        const api = mkPlace({ placeType: CAP1 });
        await Promise.all([api.tryPlace(1, 1), api.tryPlace(2, 2)]);
        const n = Object.keys(api.game.tiles).length;
        chk('§8 two fast clicks on DIFFERENT squares cannot both beat a cap-1 building',
            n === 1, 'placed ' + n + ' — the per-type count is read before payCost and the tile written after it, so both clicks saw 0');
      }
      // ── (2) …AND THE HONEST PLAYER STILL GETS BOTH LEGITIMATE PLACEMENTS ────
      {
        const api = mkPlace({ placeType: CAPN });
        await Promise.all([api.tryPlace(1, 1), api.tryPlace(2, 2)]);
        const n = Object.keys(api.game.tiles).length;
        chk('§8 …and two legitimate concurrent placements of an uncapped type BOTH land',
            n === 2, 'placed ' + n + ' of 2 — a Set here instead of a multiset throws one of them away');
      }
      // ── (3) h098 — the placed tile actually carries the order ───────────────
      {
        const api = mkPlace({ placeType: CAPN });
        await api.tryPlace(3, 3);
        const t = api.game.tiles['3,3'];
        chk('§8 a placed building carries its build order — the whole feature',
            !!t && !!t.bld && t.bld.k === 0 && t.bld.d === 3600 && t.bld.l === 1,
            'tile = ' + JSON.stringify(t && t.bld) + ' — null means it went up instantly and there is nothing to cancel, time or refund');
        chk('§8 …and the order records what payCost was actually handed, as the refund basis',
            !!t && !!t.bld && t.bld.pc === (api.costOf(CAPN).cinder | 0),
            'pc = ' + JSON.stringify(t && t.bld && t.bld.pc) + ' vs charged ' + JSON.stringify(api.costOf(CAPN)));
      }
      // ── (4) REFUSAL ONE — no free crew ──────────────────────────────────────
      {
        const spy = mkSpy();
        const api = mkCity({ spy: spy, B: BLDG, dur: 3600, gateSrc: GATE_SRC, placeType: CAPN });
        /* The number comes from the lifted bldSlots() over the real ECON slot
           table — not from a constant here, or the fixture would fill a number
           this file chose and the refusal would be graded against itself. */
        const slots = api.slots();
        chk('§8 the free Municipal Works crew is a real, bounded number',
            slots === ECON_C.municipal.slots && slots > 0, 'bldSlots() = ' + slots);
        for (let i = 0; i < slots; i++)
          api.game.tiles['9,' + i] = { type: CAPN, lvl: 1, rot: 0, bld: { k: 0, l: 1, s: Date.now(), d: 3600, fv: 1, pc: 0, pr: null } };
        await api.tryPlace(5, 5);
        chk('§8 REFUSAL 1 — with every crew working, a new order is refused before anything is charged',
            !api.game.tiles['5,5'] && spy.paid.length === 0 && spy.toasts.length === 1 &&
            spy.toasts[0].kind === 'bad' && /crew/i.test(spy.toasts[0].m),
            'tile ' + JSON.stringify(!!api.game.tiles['5,5']) + ', payCost ' + spy.paid.length +
            ', said ' + JSON.stringify(spy.toasts.map(t => t.m)) +
            ' — with no gate there is no queue, so this is an unbounded number of paid 24-hour jobs');
      }
      // ── (5) REFUSAL TWO — the municipal ceiling ─────────────────────────────
      {
        const LONG = ECON_C.municipal.maxSec + 1;
        const spy = mkSpy();
        const api = mkCity({ spy: spy, B: BLDG, dur: LONG, gateSrc: GATE_SRC, placeType: CAPN });
        await api.tryPlace(6, 6);
        chk('§8 REFUSAL 2 — a job over the municipal ceiling is refused with no Construction Co. standing',
            !api.game.tiles['6,6'] && spy.paid.length === 0 && spy.toasts.length === 1 &&
            /Municipal Works/.test(spy.toasts[0].m),
            'tile ' + JSON.stringify(!!api.game.tiles['6,6']) + ', payCost ' + spy.paid.length +
            ', said ' + JSON.stringify(spy.toasts.map(t => t.m)) +
            ' — every Cinder earner in the game sits above this ceiling, so without it the Co. gates nothing');
        /* …AND THE GATE OPENS. A refusal that cannot be satisfied is a wall, so
           the same order with a COMPLETED Co. standing must go through. */
        const spy2 = mkSpy();
        const api2 = mkCity({ spy: spy2, B: BLDG, dur: LONG, gateSrc: GATE_SRC, placeType: CAPN });
        api2.game.tiles['0,9'] = { type: 'op_construction', lvl: 1, rot: 0 };   // finished, undamaged
        await api2.tryPlace(6, 6);
        chk('§8 …and a COMPLETED Construction Co. opens it — the refusal is a gate, not a wall',
            !!api2.game.tiles['6,6'] && !!api2.game.tiles['6,6'].bld,
            'tile ' + JSON.stringify(api2.game.tiles['6,6']) + ', said ' + JSON.stringify(spy2.toasts.map(t => t.m)));
        /* …and an UNFINISHED Co. does not, or the bootstrap is free: place a
           Co., place an arena in the same breath, cancel the Co. */
        const spy3 = mkSpy();
        const api3 = mkCity({ spy: spy3, B: BLDG, dur: LONG, gateSrc: GATE_SRC, placeType: CAPN });
        api3.game.tiles['0,9'] = { type: 'op_construction', lvl: 1, rot: 0,
                                   bld: { k: 0, l: 1, s: Date.now(), d: 900, fv: 1, pc: 0, pr: null } };
        await api3.tryPlace(6, 6);
        chk('§8 …but a Construction Co. that is still a hole in the ground supervises nothing',
            !api3.game.tiles['6,6'], 'a site counted as a standing Co. — place Co., place arena, cancel Co. is then free');
      }
      // ── (6) THE OPS EXEMPTION, AND THE EXEMPT TYPES ────────────────────────
      {
        const spy = mkSpy();
        const api = mkCity({ spy: spy, B: B_OPS, dur: ECON_C.municipal.maxSec + 1, gateSrc: GATE_SRC, placeType: 'op_construction' });
        await api.tryPlace(7, 7);
        chk('§8 an op_* is exempt from the ceiling — the licence was already paid at City Hall',
            !!api.game.tiles['7,7'], 'said ' + JSON.stringify(spy.toasts.map(t => t.m)) +
            ' — charging twice for one business, and op_construction is the one that unlocks the rest');
        /* 🛤 THE HONEST PLAYER PAVING A GRID. durSec 0 ⇒ exempt or no economy
           module: no timer, no slot, no gate. This must never be refused for
           want of a crew, and it must not consume one either. */
        const spy2 = mkSpy();
        const api2 = mkCity({ spy: spy2, B: BLDG, dur: 0, gateSrc: GATE_SRC, placeType: 'road' });
        for (let i = 0; i < 6; i++) await api2.tryPlace(i, 8);
        const roads = Object.keys(api2.game.tiles).length;
        chk('§8 an EXEMPT type is never refused and never takes a crew slot — paving a grid still works',
            roads === 6 && spy2.toasts.length === 0 && api2.committed() === 0,
            'placed ' + roads + ' of 6, said ' + JSON.stringify(spy2.toasts.map(t => t.m)) + ', committed ' + api2.committed());
      }
      // ── (7) THE RESERVATION IS RELEASED — a refusal may not leak a crew ────
      {
        const spy = mkSpy();
        const api = mkCity({ spy: spy, B: BLDG, dur: 3600, gateSrc: GATE_SRC, placeType: CAPN, payFails: true });
        await api.tryPlace(2, 7);
        await api.tryPlace(3, 7);
        chk('§8 a FAILED payment releases both reservations — a bad bridge may not lock the city out for the session',
            api.committed() === 0 && Object.keys(api.game.tiles).length === 0,
            'committed ' + api.committed() + ' with nothing on the board — the finally that releases them spans the whole await');
      }
    }
  }

  /* ── §9 A FINISHED BUILDING GOES UP BY ITSELF — AWAKE AND ASLEEP ────────────
     🔴 THE TWO HUNKS THIS SECTION EXISTS FOR, AND WHY §2 COULD NOT SEE EITHER.

     h180 is `try { bldSweep(Date.now()); } catch (e) {}` on animate()'s
     4-second beat. It is the ONLY thing in the live page that completes a due
     order. Revert it and a building the player watched count down to zero sits
     inert until they reload or place something else — the timer runs out and
     nothing happens. Measured against the shipped tree: both syntax checks
     CLEAN, gate GREEN, exit 0.

     h142 is the in-loop sweep inside offlineCatchUp: `const vnow = vFrom +
     done * 1000; if (vnow >= _bldNext) { bldSweep(vnow); … }`. Revert it and
     OFFLINE COMPLETION STOPS ENTIRELY — a 24-hour build never finishes while
     the tab is closed, and the boot hand-off §1 checks cannot save it because
     bldNormalize(true) defers rather than completes. Measured: GREEN.

     🔴 WHY THIS IS NOT ALREADY COVERED BY §2, WHICH DRIVES A SLICE LOOP.
        §2's loop is THIS FILE'S loop. It re-walks the absence with the same
        constants and then calls `api.bldSweep(vnow)` from a line run.mjs wrote,
        so it proves bldSweep completes things — which was never in doubt —
        while the shipped statement that CALLS it could be deleted outright with
        the gate green from end to end. That is the identical trap §2b's header
        describes for boot()'s hand-off, and the fix is the same one: scrape
        offlineCatchUp's own four statements and RUN THOSE. §9b's loop supplies
        only the slice arithmetic (`dt`, `done`) that the economy owns; every
        construction statement in it is the shipped text.

     THE PRODUCTION CALLERS THIS MIRRORS: animate()'s `if (sysTimer >= 4)` block,
     scraped whole and executed on a rising clock; and offlineCatchUp's
     `_bldOffline = true` / `_bldRebuildDue()` / the vnow sweep / the `_bldDirty`
     trailer, scraped as four statements and executed in that order.

     SABOTAGE: beat-dead (h180) · offline-nosweep (h142). */
  {
    /* animate()'s 4-second block. `if (sysTimer >= 4)` appears once in code;
       the scrape is taken from the comment-stripped source so a sentence that
       mentions it cannot be found first — the rule §1's header sets out. */
    const NC_CODE = stripComments(NC);
    const BEAT_SRC = unfix(srcBlockAfter(NC_CODE, 'if (sysTimer >= 4)'), 'beat-dead', [
      /* h180 reversed: the statement is simply gone. Its exact text appears
         once — boot()'s sweep has a different catch body — so this cannot slide
         onto the wrong call site. */
      ['try { bldSweep(Date.now()); } catch (e) {}', ''],
    ]);
    /* offlineCatchUp's construction statements. Comment-stripped for the same
       reason, and taken from the function body so `if (_bldDirty)` cannot match
       bldSweep's own trailer. */
    const OFF_FN = fnText(NC_CODE, 'offlineCatchUp');
    const offStmt = (needle) => {
      if (!OFF_FN) return null;
      const i = OFF_FN.indexOf(needle); if (i < 0) return null;
      const a = OFF_FN.lastIndexOf('\n', i) + 1, b = OFF_FN.indexOf('\n', i);
      return (OFF_FN.slice(a, b < 0 ? OFF_FN.length : b).trim()) || null;
    };
    const offBlock = (needle) => {
      if (!OFF_FN) return null;
      const body = srcBlockAfter(OFF_FN, needle);
      return body ? needle + ' ' + body : null;
    };
    const OFF_INIT  = offStmt('_bldOffline = true; _bldDirty = false;');
    const OFF_BUILD = offStmt('_bldRebuildDue();');
    const OFF_VNOW  = offStmt('const vnow = vFrom + done * 1000;');
    /* 🧨 offline-nosweep models h142 as an EMPTY statement rather than a null
       scrape. Both are true of the revert — the text is gone, so the structural
       read finds nothing AND the loop stops completing anything — but only the
       second one is a fact about the player. A null here would redden the
       readability check above and skip §9b entirely, i.e. prove that this round
       notices a missing statement while proving nothing about what its absence
       costs. The structural half is not lost: reverse-applying the real h142
       makes offBlock return null and the check fires on its own. */
    const OFF_SWEEP = SABOTAGE === 'offline-nosweep' ? ' ' : offBlock('if (vnow >= _bldNext)');
    const OFF_SYNC  = offBlock('if (_bldDirty)');

    const gotBeat = chk('§9 animate()\'s 4-second block and offlineCatchUp\'s four construction statements are readable',
        !!BEAT_SRC && !!OFF_INIT && !!OFF_BUILD && !!OFF_VNOW && !!OFF_SWEEP && !!OFF_SYNC &&
        BEAT_SRC.indexOf('finTick(') > 0,
        'beat ' + JSON.stringify(BEAT_SRC && BEAT_SRC.slice(0, 50)) + ' init ' + JSON.stringify(OFF_INIT) +
        ' rebuild ' + JSON.stringify(OFF_BUILD) + ' vnow ' + JSON.stringify(OFF_VNOW) +
        ' sweep ' + JSON.stringify(OFF_SWEEP && OFF_SWEEP.slice(0, 40)) + ' sync ' + JSON.stringify(OFF_SYNC && OFF_SYNC.slice(0, 40)) +
        ' — a missing statement here IS the revert, seen from this side');

    // ── §9a THE LIVE BEAT ──────────────────────────────────────────────────
    if (BEAT_SRC) {
      /* ⚠ THE FIXTURE IS DUE IN REAL TIME, NOT ON __NOW. The scraped statement
         is `bldSweep(Date.now())` — the shipped call reads the wall clock, and
         that is the point of it, so the order under it has to be genuinely due
         against the same clock. A record dated off the sandbox's __NOW would
         make this section pass or fail on which clock the harness happened to
         hand it, which is not a property of the product. */
      const NOW = Date.now();
      const spy = mkSpy();
      const api = mkCity({ spy: spy, B: BLDG, beatSrc: BEAT_SRC });
      api.game.tiles['1,1'] = { type: 'club', lvl: 1, rot: 0, bld: { k: 0, l: 1, s: NOW - 11000, d: 10, fv: 1, pc: 0, pr: null } };
      api.setNow(NOW);
      api.beatTick(3.9);                              // under the 4 s threshold
      chk('§9a the beat does not fire early — it is a 4-second timer, not a per-frame sweep',
          spy.beat.length === 0 && spy.finished.length === 0,
          JSON.stringify(spy.beat) + ' — the job IS due; what has not arrived yet is the beat');
      api.beatTick(0.2);                              // 4.1 s: the beat comes round
      chk('§9a THE COMPLETION BEAT — a due building goes up on its own, with no reload and no other click',
          spy.finished.length === 1 && spy.finished[0].key === '1,1' && !api.game.tiles['1,1'].bld,
          'completed ' + spy.finished.length + ', beat ran ' + JSON.stringify(spy.beat) +
          ' — without this the countdown reaches zero and the building just sits there until the player reloads');
      chk('§9a …and the rest of the 4-second beat still ran, so this is the real block',
          spy.beat.indexOf('finTick') >= 0 && spy.beat.indexOf('decayTick') >= 0,
          JSON.stringify(spy.beat));
    }

    // ── §9b THE OFFLINE SWEEP, DRIVEN THROUGH offlineCatchUp'S OWN STATEMENTS ─
    if (OFF_INIT && OFF_BUILD && OFF_VNOW && OFF_SWEEP && OFF_SYNC) {
      /* The shipped statements, in the shipped order, with only the slice
         arithmetic supplied. `_bldNext`, `_bldOffline` and `_bldDirty` are the
         sandbox's own module-scope bindings, so the lifted code assigns the
         same variables node-city's does. */
      const OFF_BODY = '{\n' +
        '  let done = 0;\n' +
        '  ' + OFF_INIT + '\n' +
        '  ' + OFF_BUILD + '\n' +
        '  while (done < simSec - 1e-9) {\n' +
        '    const dt = Math.min(OFFLINE_SLICE_SEC, simSec - done);\n' +
        '    done += dt;\n' +
        '    ' + OFF_VNOW + '\n' +
        '    ' + OFF_SWEEP + '\n' +
        '  }\n' +
        '  _bldOffline = false;\n' +
        '  ' + OFF_SYNC + '\n' +
        '}';
      /* Three orders across a 6 h absence: due 2 h in, due 5 h in, and one that
         is still running when the player comes back.
         🔴 WHY THE ABSENCE IS DRIVEN TWICE AND NOT TIMED. The completion STAMP
            cannot be read from here — bldSweep hands bldFinish(k, t) and not the
            clock it was called with, so a stub cannot record vnow without
            inventing a signature production does not have. WHICH jobs complete
            over WHICH span is the same property and is a real observable: at
            3 h only the 2 h job may be up, at 6 h both. A sweep pinned to the
            wall clock (the h141/h142 failure) finishes all three immediately;
            a sweep that never runs finishes none. */
      const NOW = Date.now();
      const mkRun = async (awayH) => {
        const saveAt = NOW - awayH * 3600000;
        const spy = mkSpy();
        const api = mkCity({ spy: spy, B: BLDG, offSrc: OFF_BODY });
        const mk = (dueH, durH) => ({ type: 'club', lvl: 1, rot: 0,
          bld: { k: 0, l: 1, s: saveAt + (dueH - durH) * 3600000, d: durH * 3600, fv: 1, pc: 0, pr: null } });
        api.game.tiles['1,1'] = mk(2, 3);
        api.game.tiles['2,2'] = mk(5, 1);
        api.game.tiles['3,3'] = mk(30, 24);           // still building on return
        spy.phase = 'catchup';
        api.setNow(saveAt);
        await api.offlineDrive(awayH * 3600, saveAt, SLICE);
        return { spy, api, done: spy.finished.map(f => f.key).sort() };
      };
      const r3 = await mkRun(3), r6 = await mkRun(6);
      console.log('   driven through offlineCatchUp\'s OWN statements — 3 h absence: ' +
                  JSON.stringify(r3.done) + '   6 h absence: ' + JSON.stringify(r6.done));
      chk('§9b THE OFFLINE SWEEP — the orders that came due while the tab was closed completed',
          r6.done.length === 2 && r6.done[0] === '1,1' && r6.done[1] === '2,2',
          'completed ' + JSON.stringify(r6.done) +
          ' — with no sweep in the loop a 24-hour build never finishes while the player is away');
      chk('§9b …and only the ones the VIRTUAL clock had reached: 3 h away finishes the 2 h job and not the 5 h one',
          r3.done.length === 1 && r3.done[0] === '1,1' && !!r3.api.game.tiles['2,2'].bld,
          'after 3 h: ' + JSON.stringify(r3.done) +
          ' — completing the 5 h job here is the wall-clock sweep, i.e. paying for time the building did not exist');
      chk('§9b …and an order that is genuinely still running is left alone',
          !!r6.api.game.tiles['3,3'].bld, 'a 24-hour order was completed 24 hours early');
      chk('§9b the offline flag is set for the sweep and cleared after it — the ledger window closes',
          r6.api.offline() === false && r6.spy.ecoSync.length === 1,
          'offline=' + r6.api.offline() + ' ecoSync ' + r6.spy.ecoSync.length +
          ' — one sync for the whole absence, and only once the bridge is its own again');
    }
  }

  chk('the sabotage patches all landed (' + patchTried + ' applied)', patchOk,
      'a patch that matches nothing leaves this round green under sabotage — fix the anchors');

    if (fails) { bad++; console.log('\n=== ROUND 0r: ' + fails + ' FAILED ==='); }
    else console.log('\n=== ROUND 0r: ALL PASS ===');
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   ROUND 0s — 🔴 THE BLIND SPOT ITSELF: CONSERVATION OUTSIDE runDay's WINDOW
   ----------------------------------------------------------------------------
   THIS IS THE ROUND THE OTHER TWENTY NEEDED AND DID NOT HAVE.

   `sim.js runDay` takes `before = totalCinder()` INSIDE itself. Everything that
   moves money outside that window — on load, on reset, in setPopulation, in a
   bridge callback — is structurally invisible to the closed-loop audit, and
   `lastAudit.ok` stays true through all of it. That is not a subtle gap; it is
   where EVERY Rule 1 violation this project has shipped has lived:

     • the founding mint      between ticks, from syncBuildings   (round 0e)
     • the boot-order mint    between loadState and catch-up      (round 0r §1)
     • setPopulation          before Sim.advance, from index.js tick   (§1 here)
     • the save-file mint     before any window opens at all          (§2 here)
     • the destroyed payout   in a rejected promise after the tick    (§4 here)
     • the founding verdict   decided inside a catch clause    (§3d/load here)
     • the save that never    happened, because the writer named a function
       ran at all             that had been renamed away       (§3e/save here)

   And the gate could not see any of them, because gauntlet2's headline
   conservation assertion reads `lastAudit.ok` — i.e. it asks the audited system
   whether it approved of itself. A green gate proves nothing whatsoever about
   this class. So this round never reads `lastAudit`. It reads `totalCinder()`
   either side of each boundary, with its own arithmetic, and asserts the number.

   MEASURED ON THE PRE-FIX TREE, each with a number before anything changed:
     §1  400 randomised population moves on one city: 17 destructive calls,
         3,987.58 🔥 destroyed, worst single call savings 1,368.08 → 0.00, and
         `lastAudit.ok === true` with err 0.00 throughout.
     §2  one edited field in a JSON save took an honest 298,394 🔥 city to
         1,000,298,330 🔥, and every day audit after it read clean.
     §4  400 ticks against a bridge that rejected every call: 10,193 🔥 claimed
         out of the sim, 0 🔥 delivered, present in NEITHER ledger, audit clean.

   🗑 AND WHAT THIS ROUND USED TO ASSERT AND DELIBERATELY NO LONGER DOES.
      §2 was a doctored-save sweep graded against sim.js's load-time Cinder
      clamp, and §5 was the reload-ratchet round that graded the same clamp over
      eight cycles. THE CLAMP HAS BEEN REMOVED and those sections went with it.
      The short version, because a deleted test is exactly the kind of thing that
      gets quietly rebuilt:
        • every rail in it was f(S.day), and `S.day` came off the same disk as
          the forgery. A four-field save edit was worth ≈7,500 gems per real
          hour of real Profile.gems — and §2 asserted against a bound the
          forgery had itself just moved, so THE GATE CERTIFIED THAT FORGERY AS
          PASSING;
        • the identity it enforced (`created = totalCinder + imports +
          payoutDelivered + payoutOwed`) is FALSE for the whole duration of
          every payout RPC, and node-city saves in exactly that window;
        • the threat was always second-order — this city is
          client-authoritative, `payCost` is client-side, and a console user can
          already reach `addGems`. A save file only made it copy-pasteable.
      sim.js documents the residual in full above `audit()`. What SURVIVES here
      is the half of §2 that measured a PLAYER being harmed rather than the
      house: §2a, a rejecting bridge's Cinder is still owed after a reload, and
      §2b, a claim that was in flight when the page died comes back too.

   Prove this round can fail — one switch per boundary, each re-committing a
   shipped defect verbatim and nothing else:
     ECON_TEST_SABOTAGE=pop-zero     §1: restores households.js's
                                     `if (S.pop[t] === 0) S.savings[t] = 0`
     ECON_TEST_SABOTAGE=inflight-drop §2b: writes the save WITHOUT
                                     `payoutInFlight` — serialize() exactly as it
                                     shipped, which recorded a claim in flight
                                     nowhere at all
     ECON_TEST_SABOTAGE=rearm-caller §3: strips `established` out of node-city's
                                     own E.mount() literal — the production
                                     caller as it actually shipped
     ECON_TEST_SABOTAGE=rearm-derive §3: makes loadState's tiles derivation
                                     answer `false` for a save with tiles
     ECON_TEST_SABOTAGE=boot-open    §3b: initialises node-city's
                                     `_pendingEstablished` back to `false`, i.e.
                                     a guard that FAILS OPEN on any boot throw
     (§6 takes no switch — it rebuilds /src/economy with a refusal reverted)
     ECON_TEST_SABOTAGE=payout-drop  §4: restores `.catch(() => {})`, i.e. drops
                                     whatever claimPayout() took and the bridge
                                     then refused
   ════════════════════════════════════════════════════════════════════════════ */
{
  console.log('\n########## round0s-outside-the-audit-window ##########');
  let fails = 0;
  const chk = (name, cond, extra) => {
    if (cond) { console.log('✅ ' + name); return true; }
    fails++; console.log('❌ ' + name + (extra ? ' :: ' + extra : '')); return false;
  };
  if (!global.window) {
    global.window = { MythicCityBridge: { addCinders: async () => {} }, MythicResourceChain: null };
    const chain = await import('../../public/src/resources/chain.js');
    global.window.MythicResourceChain = { ALL: chain.RESOURCE_CHAIN };
  }
  const P = '../../public/src/economy/';
  const E = (await import(P + 'index.js')).default;
  const Sim = await import(P + 'sim.js');
  const HH = await import(P + 'households.js');
  const Bank = await import(P + 'bank.js');
  const Firms = await import(P + 'firms.js');
  const { ECON } = await import(P + 'tuning.js');
  const DAY = ECON.clock.dayMin;
  const host = { powerFactor: 1, waterFactor: 0.9, logisticsCounts: { warehouse: 2, depot: 1 },
                 hasBank: true, infrastructure: 0.6 };
  /* The bridge is swapped in §4 and must be handed back exactly as found —
     round0s is not the last thing in this process. */
  const BRIDGE0 = global.window.MythicCityBridge.addCinders;
  const flush = () => new Promise((r) => setTimeout(r, 0));

  /* ── §1 setPopulation MOVES PEOPLE, NEVER MONEY ────────────────────────────
     ecoHost() passes `population: cityPop()` on EVERY tick, and index.js calls
     HH.setPopulation() before Sim.advance() — so this boundary is crossed on
     every migration and every housing build or demolish, and it is crossed
     before the audit window opens. A tier whose headcount rounds to zero used
     to have its savings balance deleted outright. */
  {
    E.mount({ nodeId: 'blind-pop', population: 400 });
    for (let i = 0; i < 60; i++) E.tick(DAY, { ...host, population: 400 });
    let destroyed = 0, calls = 0, worst = 0, worstAt = '';
    let seedRng = 1234567;
    const rnd = () => { seedRng = (seedRng * 1103515245 + 12345) & 0x7fffffff; return seedRng / 0x7fffffff; };
    for (let i = 0; i < 400; i++) {
      const before = Sim.totalCinder();
      const sBefore = HH.totalSavings();
      const pre = { ...HH.state().savings };
      /* Deliberately violent: a ±70% swing empties a tier regularly, which is
         the whole trigger. Seeded, so a failure is reproducible. */
      E.setPopulation(Math.max(1, Math.round(HH.population() * (0.3 + rnd() * 1.4))));
      if (SABOTAGE === 'pop-zero') {
        /* 🧨 THE SHIPPED END STATE, re-committed exactly — households.js used to
           finish setPopulation with
             `for (const t of TIERS) if (S.pop[t] === 0) { S.savings[t] = 0; }`
           and its comment claimed the zeroing PREVENTED breaking the audit.
           ⚠ THE RESTORE IS THE POINT, and the first draft of this switch left it
             out and was therefore INERT — a sabotage that passed. Zeroing the
             empty tiers *after* the fix has already emptied them destroys
             nothing, so the pre-call balances have to be put back first; only
             then does zeroing reproduce the loss. A sabotage nobody has watched
             go red is a comment, which is this file's own first rule. */
        const st = HH.state();
        for (const t of ['low', 'mid', 'high']) st.savings[t] = pre[t];
        for (const t of ['low', 'mid', 'high']) if (st.pop[t] === 0) st.savings[t] = 0;
      }
      const d = before - Sim.totalCinder();
      if (Math.abs(d) > 1e-6) {
        calls++; destroyed += d;
        if (Math.abs(d) > Math.abs(worst)) {
          worst = d;
          worstAt = 'savings ' + sBefore.toFixed(2) + ' → ' + HH.totalSavings().toFixed(2);
        }
      }
      E.tick(DAY, { ...host, population: HH.population() });
    }
    console.log('   400 randomised population moves — tiers now ' + JSON.stringify(HH.state().pop));
    chk('setPopulation conserves totalCinder across a tier emptying',
        calls === 0,
        calls + ' call(s) moved money outside the audit window, ' + destroyed.toFixed(2) +
        ' 🔥 net; worst ' + worst.toFixed(2) + ' 🔥 (' + worstAt + ')');
    chk('…and the day audit was NEVER the thing that noticed — it stayed green throughout',
        !!(Sim.state().lastAudit && Sim.state().lastAudit.ok),
        'the audit went red, which means this round is measuring the wrong boundary');
  }

  /* ── §2 THE PLAYER'S PAYOUT SURVIVES THE PAGE ──────────────────────────────
     🔴 THE WINDOW. `claimPayout()` debits `payoutOwed` SYNCHRONOUSLY and the
     bridge answers a network round trip later. Between those two moments the
     Cinder is not in the treasury (it left on the day it was drawn), and until
     this package it was on no save field either. node-city writes its save in
     exactly that window: `pagehide`, `visibilitychange` and the 800ms
     `saveSoon` timer all fire wherever the RPC happens to be, and `addCinders`
     in 'message' mode is an RPC across a postMessage bridge.

     Commit cd68272 closed the REJECTION path — a refusal goes back on
     `payoutOwed` via refundPayout(). It could not close the path where nothing
     settles AT ALL because the page is gone: no `.then`, no `.catch`, ever.

     §2a is the rejection path, kept verbatim so this package cannot regress it.
     §2b is the tab close, which is new, and which measured 19.00 🔥 destroyed
     from the saved file on one ordinary close before `S.payoutInFlight`
     existed — with `lastAudit.ok === true` throughout, because none of it
     happens inside runDay's window.

     ⚠ WHAT THIS SECTION REPLACED. It used to be a doctored-save sweep asserting
       against `loadedCinderCeiling()`. See this round's header: the clamp is
       gone and the sweep went with it, because it graded a bound whose own
       inputs came off the same disk as the forgery. */
  {
    /* ── §2a A REJECTING BRIDGE'S CINDER IS STILL OWED AFTER A RELOAD ─────────
       The real case that grows this field is a bridge that has been refusing
       for hours. Every refund was drawn out of the treasury first, so a reload
       that dropped it would be taking money the player never received. */
    E.mount({ nodeId: 'blind-owed-roundtrip', population: 320 });
    const dead = global.window.MythicCityBridge.addCinders;
    global.window.MythicCityBridge.addCinders = async () => { throw new Error('rpc timeout'); };
    for (let i = 0; i < 200; i++) { E.tick(DAY, { ...host, population: 320 }); await flush(); }
    global.window.MythicCityBridge.addCinders = dead;
    const owedBefore = Sim.state().payoutOwed;
    /* THE PRODUCTION CALL SHAPE — node-city hands the parsed blob to E.mount as
       `state`; it never calls E.load(). A round that used the other seam would
       be certifying a path production does not take. */
    const b2 = JSON.parse(JSON.stringify(E.serialize()));
    E.mount({ nodeId: 'blind-owed-roundtrip', population: 320, state: b2 });
    const owedAfter = Sim.state().payoutOwed;
    console.log('   a city whose bridge REFUSED for 200 ticks is owed ' + owedBefore.toFixed(2) +
                ' 🔥 — after a save/load round trip it is owed ' + owedAfter.toFixed(2) + ' 🔥');
    chk('the bridge-down case is not vacuous — real Cinder really did pile up',
        owedBefore > 1, 'payoutOwed ' + owedBefore.toFixed(2) + ' — nothing accumulated, nothing tested');
    chk('…and a reload does NOT lose what a rejecting bridge failed to deliver',
        Math.abs(owedAfter - owedBefore) < 0.05,
        owedBefore.toFixed(2) + ' 🔥 owed → ' + owedAfter.toFixed(2) + ' 🔥 after reload');

    /* ── §2b THE TAB CLOSE: A CLAIM IN FLIGHT WHEN THE PAGE DIES ──────────────
       The bridge ACCEPTS the call and never answers — which is what a dead
       parent, a closed tab or a killed background page looks like from in here.
       No handler runs, so neither notePayoutDelivered() nor refundPayout() can
       help; the only thing that can is the save itself. */
    E.mount({ nodeId: 'blind-tabclose', population: 320 });
    global.window.MythicCityBridge.addCinders = async () => {};
    for (let i = 0; i < 150; i++) { E.tick(DAY, { ...host, population: 320 }); await flush(); }
    let handed = 0;
    global.window.MythicCityBridge.addCinders = (n) => { handed += n; return new Promise(() => {}); };
    E.tick(DAY, { ...host, population: 320 });
    await flush();                       // nothing can settle — the promise never resolves
    const owedAtSave = Sim.state().payoutOwed;
    const inFlightAtSave = Sim.state().payoutInFlight;
    const blob = JSON.parse(JSON.stringify(E.serialize()));
    if (SABOTAGE === 'inflight-drop') {
      /* 🧨 serialize() AS IT SHIPPED — there was no `payoutInFlight` key, so a
         save written in this window recorded the claimed Cinder nowhere: not in
         the treasury, not on `payoutOwed`, not in `payoutLifetime`. The amount
         is simply gone from the file, permanently, and no later tick can find
         it because nothing remembers that it was ever drawn. */
      delete blob.payoutInFlight;
    }
    chk('the tab-close fixture is not vacuous — an RPC really was left unanswered',
        handed > 0 && inFlightAtSave > 0,
        'handed ' + handed.toFixed(2) + ' 🔥, payoutInFlight ' + inFlightAtSave.toFixed(2) +
        ' — nothing was in flight when the save was taken, so nothing is under test');
    chk('…and the save carries the in-flight claim as a field of its own',
        Math.abs((+blob.payoutInFlight || 0) - handed) < 0.05 || SABOTAGE === 'inflight-drop',
        'serialize() wrote payoutInFlight=' + blob.payoutInFlight + ' against ' + handed.toFixed(2) + ' 🔥 in flight');

    // THE RELOAD. The page died; the RPC result died with it.
    E.mount({ nodeId: 'blind-tabclose', population: 320, state: blob });
    const owedBack = Sim.state().payoutOwed;
    const recovered = owedBack - owedAtSave;
    console.log('   page died mid-RPC with ' + handed.toFixed(2) + ' 🔥 in flight — saved owed ' +
                owedAtSave.toFixed(2) + ' 🔥, reloaded owed ' + owedBack.toFixed(2) +
                ' 🔥 (recovered ' + recovered.toFixed(2) + ' 🔥)');
    chk('a payout in flight when the page died is back on payoutOwed after the reload',
        Math.abs(recovered - handed) < 0.05,
        'recovered ' + recovered.toFixed(2) + ' 🔥 of the ' + handed.toFixed(2) +
        ' 🔥 handed to a bridge that never answered — the rest is in NEITHER ledger');
    /* THE PLAYER'S SIDE OF THE SAME QUESTION, asserted independently of the
       field names. Everything this city ever created, less what it spent abroad
       and what it still holds, is what it has drawn for its owner; every Cinder
       of that must be findable on one of the three payout fields. The shortfall
       IS the money that was destroyed. */
    const st = Sim.state();
    const drawn = st.charterIssued + st.faucetLifetime - st.importsLifetime - Sim.totalCinder();
    const accounted = st.payoutLifetime + st.payoutOwed + st.payoutInFlight;
    const short = drawn - accounted;
    console.log('   the owner\'s ledger after the reload: drawn ' + drawn.toFixed(2) +
                ' 🔥, accounted for ' + accounted.toFixed(2) + ' 🔥, SHORT ' + short.toFixed(2) + ' 🔥');
    chk('…and the player is not short — every Cinder drawn for the owner is on a save field',
        Math.abs(short) < 1,
        short.toFixed(2) + ' 🔥 left the city for its owner and is in no ledger at all');
    /* …and the retry actually pays it, because a balance restored to a field
       nothing claims from is a consolation number on a panel. */
    let paid = 0;
    global.window.MythicCityBridge.addCinders = async (n) => { paid += n; };
    for (let i = 0; i < 30; i++) { E.tick(DAY, { ...host, population: 320 }); await flush(); }
    console.log('   bridge came back — ' + paid.toFixed(2) + ' 🔥 paid out of the ' +
                owedBack.toFixed(2) + ' 🔥 that was owed on load');
    chk('…and the recovered amount is really paid once the bridge answers again',
        paid >= Math.floor(owedBack) - 1,
        'paid ' + paid.toFixed(2) + ' of ' + owedBack.toFixed(2));
    chk('…and payoutInFlight never goes negative or strands a balance',
        Sim.state().payoutInFlight >= -1e-9 && Sim.state().payoutInFlight < paid + 1,
        'payoutInFlight ' + Sim.state().payoutInFlight);
    global.window.MythicCityBridge.addCinders = BRIDGE0;
  }

  /* ── §3 DELETING THE SAVE KEY MAY NOT RE-ARM THE FOUNDING TRANCHE ──────────
     `Sim.reset()` zeroes `charterIssued` and `booted`, and node-city reads a
     missing `economy` key as null and mounts with `state: null` — so removing
     one key from the save hands the city a fresh 300,000 🔥 tranche and the
     whole 700,000 🔥 lifetime allowance, again and again.

     🔴 WHY THIS ROUND WAS REWRITTEN, AND IT IS THE LESSON OF THE WHOLE PACKAGE.
        The first version of it read

            E.mount({ nodeId: 'blind-rearm', population: 150, established: true })

        i.e. it passed the flag ITSELF and then proved the refusal fires. The
        only production caller — node-city's one `E.mount(…)` — passed no flag
        at all, so `bootstrap()` could never see one and the hole was fully
        open with a green round sitting on top of it. Measured on that tree,
        through the real production call: a lived 180-day city with
        charterIssued 300,000.00 / totalCinder 293,295.48 came back from a
        stateless remount at charterIssued 300,000.00 / totalCinder 300,000.00,
        headroom restored to 400,000.00.

        A TEST THAT EXERCISES A SEAM PRODUCTION DOES NOT USE CERTIFIES NOTHING.
        So this round no longer writes the call. It READS node-city's own
        `E.mount({ … })` argument literal out of the shipped file, READS the
        `_pendingEstablished` derivation out of `loadState()`, executes that
        derivation against a save, and mounts with whatever the two of them
        produce. If node-city stops passing the flag, or derives it wrongly, or
        someone edits the literal, this goes red — because the thing under test
        is the shipped text, not a shape written here.

     Prove it can fail:
       ECON_TEST_SABOTAGE=rearm-caller  strips `established:` back out of the
                                        extracted call — the defect verbatim
       ECON_TEST_SABOTAGE=rearm-derive  keeps the flag but makes loadState's
                                        derivation answer `false` for a lived
                                        save, i.e. the same hole one level up */
  {
    const NC = join(here, '../../public/node-city/index.html');
    const ncSrc = readFileSync(NC, 'utf8');

    /* 1. THE CALL, as shipped. `srcBlockAfter` brace-matches over comments and
          strings, which node-city needs — the surrounding prose is full of
          braces and apostrophes.
          ⚠ MATCH ONLY A CALL THAT REALLY TAKES AN OBJECT LITERAL, and count
            them. `E.mount()` also appears inside a comment at the citizens
            bind site, and an unanchored indexOf lands there and brace-matches
            something unrelated. Counting is the other half: a SECOND mount call
            added later would otherwise sail past this round untested. */
    let mountLit = null, mountSites = 0;
    for (let i = ncSrc.indexOf('E.mount('); i >= 0; i = ncSrc.indexOf('E.mount(', i + 1)) {
      if (!/^\s*\{/.test(ncSrc.slice(i + 'E.mount('.length))) continue;
      mountSites++;
      if (!mountLit) mountLit = srcBlockAfter(ncSrc.slice(i), 'E.mount');
    }
    chk('node-city still has exactly one E.mount({…}) call this round can read',
        !!mountLit && mountSites === 1,
        'matched ' + mountSites + ' call sites, literal ' + (mountLit ? 'read' : 'UNREADABLE'));
    /* 🔴 THE ASSERTION THE OLD ROUND COULD NOT MAKE, because it was the caller.
          `established` missing here IS the defect, and nothing else in the gate
          looks at the production call site. */
    chk('…and THE PRODUCTION CALL PASSES `established` (it passed nothing for the whole life of the feature)',
        !!mountLit && /[\s,{]established\s*:/.test(mountLit),
        'E.mount literal: ' + String(mountLit).replace(/\s+/g, ' ').slice(0, 200));

    /* 2. THE DERIVATION, as shipped, and then EXECUTED.
          🔴 IT IS NO LONGER A BOOLEAN, AND THAT IS THIS SECTION'S WHOLE SUBJECT.
          `_pendingEstablished` was a two-valued flag, and BOTH of its defaults
          were wrong. Shipped as `false` it minted a fresh 300,000 🔥 tranche off
          any boot error; flipped to `true` to close that, it PERMANENTLY DENIED
          a brand-new player their tranche whenever their very first city read
          was ambiguous — `loadUnsafe` is true for an RLS refusal, a throw, or a
          save stamped for somebody else, i.e. one bad network moment, and
          nothing ever lowered the flag again. Measured on that tree: brand-new
          player, ambiguous first read, charterIssued 0.00 🔥 against the
          300,000.00 🔥 a founded city receives, forever.

          So node-city now answers with one of THREE values from a pure function,
          `cityEcoVerdict(j, unsafe)`, and this round reads that function's body
          out of the shipped file and runs every branch of it. 'unknown' is not a
          third kind of answer — it is the refusal to answer, and what it buys is
          a DEFERRED mount: no tranche issued, none refused, resolved from the
          next trustworthy read. */
    const lines = ncSrc.split('\n').map((l) => l.trim());
    const initLine   = lines.find((l) => /^let _cityVerdict\s*=/.test(l));
    const verdictSrc = srcBlockAfter(ncSrc, 'function cityEcoVerdict(j, unsafe)');
    chk('node-city derives the verdict in one readable function over the parsed save',
        !!verdictSrc && !!initLine,
        'init: ' + initLine + '  cityEcoVerdict: ' + (verdictSrc ? 'read' : 'UNREADABLE'));
    /* 🔴 AND THE DEFAULT MUST BE THE UNDECIDED ONE. Not 'established' (which
       denies a new player on a boot fault) and not 'new' (which mints on one).
       §3b drives the boot that reaches E.mount without loadState ever running. */
    chk('…and it defaults to \'unknown\' — neither granting nor refusing before any evidence exists',
        !!initLine && /=\s*'unknown'\s*;/.test(initLine), initLine);
    /* …and exactly ONE statement outside that function may write a DECIDED value
       into the verdict. Each extra one is another place a guess can be made
       where boot()'s catch would skip past the evidence. The one that is allowed
       is ecoDeferRetry's, and it fires only on a trusted read. */
    const decideSites = (ncSrc.match(/_cityVerdict\s*=\s*'(new|established)'/g) || []);
    chk('…and EXACTLY ONE statement outside loadState decides it after the fact',
        decideSites.length === 2,
        decideSites.length + ' decided assignments (' + decideSites.join(', ') +
        ') — loadState\'s re-affirm plus ecoDeferRetry\'s is two; anything more is another guess');
    /* 🧨 The two ways to break a three-valued state, both re-committed into the
       EXTRACTED body and nothing else: collapse 'unknown' toward the refusing
       answer (defer-closed — the tree this package fixed) or toward the granting
       one (defer-open — the tree before it). */
    let verdictBody = String(verdictSrc);
    if (SABOTAGE === 'defer-closed' || SABOTAGE === 'defer-open') {
      const to = SABOTAGE === 'defer-closed' ? "'established'" : "'new'";
      const hit = verdictBody.replace(/'unknown'/g, to);
      if (hit === verdictBody) throw new Error('SABOTAGE ' + SABOTAGE + ' matched nothing — cityEcoVerdict was reshaped and this switch is inert');
      verdictBody = hit;
    }
    const verdict = new Function('j', 'unsafe', 'return (function cityEcoVerdict(j, unsafe) ' + verdictBody + ')(j, unsafe);');

    /* 3. THE CALL, COMPILED FROM THE SHIPPED TEXT. `rearm-caller` deletes the
          `established` property from that text and nothing else — which is
          exactly the tree the adversary measured. */
    const litForRun = (SABOTAGE === 'rearm-caller')
      ? String(mountLit).replace(/,?\s*established\s*:\s*[^,}]+/, '')
      : String(mountLit);
    const mkOpts = new Function('nodeId', 'cityPop', '_pendingEconomy', '_cityVerdict',
                                'return (' + litForRun + ');');

    // A lived city, through the ordinary boot path.
    E.mount({ nodeId: 'blind-rearm', population: 150, established: 'new' });
    for (let i = 0; i < 60; i++) E.tick(DAY, host);
    const livedIssued = E.snapshot().charterIssued;
    const livedTotal = E.totalCinder();

    /* THE PLAYER DELETES THE `economy` KEY. What loadState then holds is a save
       with tiles and no economy — so `_pendingEconomy` is null and the verdict is
       whatever node-city's own function makes of it. */
    const livedSave = JSON.stringify({ tiles: { '0,0': { type: 'anchor' }, '3,4': { type: 'house' }, '5,2': { type: 'shop' } } });
    const establishedFlag = verdict(livedSave, false);
    const opts = mkOpts('blind-rearm', () => 150, null, establishedFlag);
    console.log('   loadState derived verdict=' + establishedFlag +
                ' → E.mount(' + JSON.stringify(opts) + ')');
    E.mount(opts);
    const after = E.snapshot();
    console.log('   lived charterIssued ' + livedIssued.toFixed(2) + ' (totalCinder ' + livedTotal.toFixed(2) +
                ') → after the stateless remount ' + after.charterIssued.toFixed(2) +
                ' (totalCinder ' + E.totalCinder().toFixed(2) + ')');
    chk('an established city that arrives with no economy blob is issued NO fresh tranche',
        after.charterIssued < 1e-6 && E.totalCinder() < 1e-6,
        'charterIssued ' + after.charterIssued.toFixed(2) + ', totalCinder ' + E.totalCinder().toFixed(2) +
        ' — deleting one save key re-armed the whole allowance THROUGH THE PRODUCTION CALL');

    /* …and a genuinely new city still gets its opening capital, through the SAME
       compiled call with the SAME derivation — node-city's bridge answered
       cleanly and found nothing, which is the 'new' this produces. */
    E.mount(mkOpts('blind-rearm-new', () => 150, null, verdict(null, false)));
    chk('…while a genuinely new city still receives exactly the bootstrap tranche',
        Math.abs(E.totalCinder() - ECON.firm.charter.seed) < 1e-6,
        E.totalCinder().toFixed(2) + ' vs seed ' + ECON.firm.charter.seed);

    /* THE DERIVATION ITSELF, on every evidence shape that decides a player's
       outcome. Without this a derivation stuck on one value would pass
       everything above and silently deny (or mint) forever. */
    const vcases = [
      ['a save with tiles, clean read',        livedSave, false, 'established'],
      ['a save with tiles, UNSAFE read',       livedSave, true,  'established'],
      ['a save carrying an economy blob',      JSON.stringify({ tiles: {}, economy: { day: 5 } }), true, 'established'],
      ['unparseable JSON (a save exists)',     '{not json',        false, 'established'],
      ['a payload with no tiles key',          '{"army":{}}',      false, 'established'],
      ['NO save, clean read',                  null,               false, 'new'],
      ['an empty saved city, clean read',      '{"tiles":{}}',     false, 'new'],
      ['NO save, UNSAFE read',                 null,               true,  'unknown'],
      ['an empty saved city, UNSAFE read',     '{"tiles":{}}',     true,  'unknown'],
    ];
    for (const [label, j, unsafe, want] of vcases) {
      const got = verdict(j, unsafe);
      chk('…verdict(' + label + ') = ' + want, got === want, 'got ' + got);
    }

    /* ── §3b AN AMBIGUOUS READ MAY COST NOTHING IN EITHER DIRECTION ───────────
       🔴 TWO DEFECTS, ONE LINE, AND FIXING EITHER ONE ALONE CAUSED THE OTHER.
       `_pendingEstablished` shipped initialised to `false` — GRANT — and was
       raised only by statements INSIDE `loadState()`. boot() is, in shape:

           try { await spawnAnchors(); await loadState(); … }
           catch (e) { console.warn('city boot (non-fatal):', e); }
           …
           E.mount({ …, established: <the flag> });

       so ANY throw before loadState reached its first assignment — spawnAnchors,
       a rejected bridge read, a renderer fault — landed in that catch, fell
       straight through, and handed a LIVED city a fresh 300,000 🔥 tranche with
       the whole 700,000 🔥 allowance re-armed, off a bad network.
       The fix flipped the initialiser to `true`. That closed the mint and opened
       the opposite wound: a BRAND-NEW player whose first read was ambiguous was
       permanently denied their 300,000 🔥 and could never capitalise a firm.

       So the third value. The model below is compiled from the SHIPPED
       initialiser and the SHIPPED verdict function, and it asserts BOTH
       invariants at once: an ambiguous read never costs the tranche, and never
       hands out a second one.
       Prove it can fail: boot-open puts the initialiser back to a granting
       value; defer-closed / defer-open collapse the third value into one of the
       other two, which is each of the two shipped defects in turn. */
    const initRhs = (SABOTAGE === 'boot-open')
      ? "'new'"
      : String(initLine).replace(/^let\s+_cityVerdict\s*=\s*/, '').replace(/;\s*$/, '');
    /* THE BOOT, MODELLED: run `steps`, swallow whatever it throws exactly as
       boot()'s "non-fatal" catch does, then answer with the verdict as it
       stands — which is precisely what the one E.mount call downstream reads. */
    const bootVerdict = (steps, j, unsafe) => {
      let v = new Function('return (' + initRhs + ');')();
      try { steps(); v = verdict(j, unsafe); } catch (e) { /* 'city boot (non-fatal)' */ }
      return v;
    };
    const stepsOk = () => {};
    const stepsThrow = () => { throw new Error('spawnAnchors: WebGPU device lost'); };

    /* A lived city that then remounts through node-city's OWN compiled call with
       no economy blob — the deleted-key shape, reached by accident. */
    const livedRemount = (flag, tag) => {
      E.mount({ nodeId: 'blind-failclosed', population: 150, established: 'new' });
      for (let i = 0; i < 60; i++) E.tick(DAY, host);
      const lived = E.totalCinder();
      E.mount(mkOpts('blind-failclosed', () => 150, null, flag));
      const got = E.totalCinder();
      console.log('   [' + tag + '] verdict=' + flag + ' — lived ' + lived.toFixed(2) +
                  ' 🔥 → remount ' + got.toFixed(2) + ' 🔥' + (E.deferred() ? '  (DEFERRED)' : ''));
      return got;
    };

    chk('a boot that THROWS before loadState grants no tranche',
        livedRemount(bootVerdict(stepsThrow, null, false), 'boot threw') < 1,
        'a renderer or bridge fault re-armed the founding tranche — the guard fails OPEN');
    chk('…and it DEFERS rather than deciding, so the question survives the fault',
        E.deferred() === true, 'a boot fault decided the founding question on no evidence at all');
    chk('…and an untrusted read of "no save" grants nothing either',
        livedRemount(bootVerdict(stepsOk, null, true), 'unsafe read') < 1,
        'loadUnsafe bought a tranche');
    chk('…and that one defers too — an RLS blip may not answer this question',
        E.deferred() === true, 'an ambiguous read was answered');
    chk('…and a boot that DID find a save refuses it outright, no deferral',
        livedRemount(bootVerdict(stepsOk, livedSave, false), 'save present') < 1 && E.deferred() === false,
        'a parsed save bought a tranche, or was left undecided when the evidence was in hand');

    /* 🔴 THE HALF THE FAIL-CLOSED FIX BROKE: the brand-new player. Both the clean
       read and the ambiguous one must leave them able to receive their capital —
       the first immediately, the second the moment a trustworthy read lands. */
    const newVerdict = bootVerdict(stepsOk, null, false);
    E.mount(mkOpts('blind-failclosed-new', () => 150, null, newVerdict));
    console.log('   [brand new] clean read, no save → verdict=' + newVerdict +
                ' → totalCinder ' + E.totalCinder().toFixed(2) + ' 🔥');
    chk('…while a clean read that found NO save still pays the bootstrap tranche',
        newVerdict === 'new' && Math.abs(E.totalCinder() - ECON.firm.charter.seed) < 1e-6,
        'verdict ' + newVerdict + ', totalCinder ' + E.totalCinder().toFixed(2) +
        ' vs seed ' + ECON.firm.charter.seed);

    const ambiguous = bootVerdict(stepsOk, null, true);
    E.mount(mkOpts('blind-newplayer-ambiguous', () => 150, null, ambiguous));
    const deniedAtBoot = E.totalCinder();
    chk('a BRAND-NEW player whose first read is ambiguous is not decided against',
        ambiguous === 'unknown' && E.deferred() === true && deniedAtBoot < 1e-6,
        'verdict ' + ambiguous + ', deferred ' + E.deferred() + ', totalCinder ' + deniedAtBoot.toFixed(2));
    chk('…and a deferred economy writes NOTHING into the save, so the evidence survives',
        E.serialize() === null && E.ready() === false,
        'serialize() returned ' + (E.serialize() === null ? 'null' : 'a ' + JSON.stringify(E.serialize()).length + '-byte blob') +
        ', ready() ' + E.ready() + ' — a deferred blob in the save reads as an established city next boot');
    // …and the retry lands. This is the line the old tree could never reach.
    const resolved = E.resolve({ established: verdict(null, false), state: null });
    console.log('   [brand new, ambiguous] deferred at ' + deniedAtBoot.toFixed(2) +
                ' 🔥 → a later trusted read resolves it to ' + E.totalCinder().toFixed(2) + ' 🔥');
    chk('…and a later TRUSTWORTHY read still pays them their founding tranche IN FULL',
        resolved === true && E.deferred() === false &&
        Math.abs(E.totalCinder() - ECON.firm.charter.seed) < 1e-6,
        'resolved ' + resolved + ', totalCinder ' + E.totalCinder().toFixed(2) +
        ' vs seed ' + ECON.firm.charter.seed + ' — the fail-closed flip left this at 0.00 forever');

    /* …AND THE OTHER INVARIANT, at the same seam: an ambiguous read for an
       ESTABLISHED player must not hand out a SECOND tranche when it resolves. */
    E.mount({ nodeId: 'blind-established-ambiguous', population: 150, established: 'new' });
    for (let i = 0; i < 60; i++) E.tick(DAY, host);
    const livedBlob = E.serialize();
    const livedCharter = E.snapshot().charterIssued;
    E.mount(mkOpts('blind-established-ambiguous', () => 150, null, verdict(null, true)));
    chk('an ESTABLISHED player whose read is ambiguous is deferred, not re-founded',
        E.deferred() === true && E.totalCinder() < 1e-6,
        'deferred ' + E.deferred() + ', totalCinder ' + E.totalCinder().toFixed(2));
    E.resolve({ established: verdict(JSON.stringify({ tiles: { '0,0': {} }, economy: livedBlob }), false), state: livedBlob });
    console.log('   [established, ambiguous] lived charterIssued ' + livedCharter.toFixed(2) +
                ' 🔥 → after deferral and resolve ' + E.snapshot().charterIssued.toFixed(2) + ' 🔥');
    chk('…and resolving it issues NO second tranche',
        Math.abs(E.snapshot().charterIssued - livedCharter) < 1e-6,
        'charterIssued ' + E.snapshot().charterIssued.toFixed(2) + ' vs ' + livedCharter.toFixed(2));

    /* ── §3d A LOAD THAT THREW MID-WAY MAY NOT ASSERT A FOUNDING DECISION ─────
       🔴 THE OTHER CATCH. §3b models boot()'s catch — the one that runs when
          loadState() never got started. This one is loadState()'s OWN catch,
          which runs when the read succeeded, the verdict was derived from it,
          and then something further down threw: the tile loop, a road refresh,
          a renderer fault, a citizen record the mesh could not build.

       The verdict has ALREADY been written by then. `_cityVerdict` is the value
       boot()'s single `E.mount({ …, established: _cityVerdict })` passes, so
       leaving a 'new' standing after a half-completed load is a 300,000 🔥
       founding tranche issued off a city we stopped reading half way through —
       and `_loadFailed` is true, so nothing later re-reads and corrects it. The
       shipped catch answers that with one line:

           if (_cityVerdict === 'new') _cityVerdict = 'unknown';

       CALLER MIRRORED: `async function loadState()`'s catch clause, feeding
       boot()'s one E.mount literal — the same `mkOpts` §3/§3b compile from.
       Nothing else in this gate executes that clause; reverting the line left
       the gate and both syntax checks green.

       ⚠ AND IT IS CONDITIONAL, WHICH IS THE HALF THAT PROTECTS AN HONEST PLAYER.
         An unconditional `_cityVerdict = 'unknown'` was tried and rejected: a
         throw AFTER the payload parsed leaves a verdict derived from REAL
         evidence ('established', from tiles on disk), and deferring that city
         costs it nothing it was owed while blocking its server writes for a
         renderer bug — trading one harm for a bigger one, which is the mistake
         this whole package exists to stop. So all three inputs are asserted, not
         just the interesting one.
       🧨 load-catch-open removes the downgrade from the EXTRACTED clause. */
    {
      const lsSrc = srcBlockAfter(ncSrc, 'async function loadState()');
      const warnAt = lsSrc ? lsSrc.indexOf("console.warn('city load failed'") : -1;
      /* The LAST `catch (e) {` before that warn is loadState's outer one — the
         inner guards (JSON.parse, citLoad, lifeLoad) all close above it. */
      const catchAt = warnAt >= 0 ? lsSrc.lastIndexOf('catch (e) {', warnAt) : -1;
      let CATCH = catchAt >= 0 ? lsSrc.slice(lsSrc.indexOf('{', catchAt) + 1, warnAt) : null;
      chk('§3d/load can read loadState\'s outer catch clause out of the shipped file',
          !!CATCH && CATCH.indexOf('_loadFailed = true') >= 0 && CATCH.length < lsSrc.length * 0.5,
          'clause ' + (CATCH ? CATCH.length + ' chars' : 'UNREADABLE') +
          ' — a rename or a reshape made this section vacuous, do NOT delete it');
      /* Separate from the scrape check on purpose: "I could not read it" and
         "I read it and it never mentions the verdict" are different failures and
         the second one is the defect. */
      chk('§3d/load …and that clause SAYS SOMETHING about the founding verdict',
          !!CATCH && CATCH.indexOf('_cityVerdict') >= 0,
          'loadState\'s catch does not touch `_cityVerdict` at all, so whatever was derived before ' +
          'the throw is what boot()\'s E.mount will act on — including a \'new\' that buys a tranche');
      if (SABOTAGE === 'load-catch-open' && CATCH) {
        const hit = CATCH.replace(/if \(_cityVerdict === 'new'\) _cityVerdict = 'unknown';/, '');
        if (hit === CATCH) throw new Error('SABOTAGE load-catch-open matched nothing — loadState\'s catch was reshaped and this switch is inert');
        CATCH = hit;
      }
      if (CATCH) {
        /* The clause, compiled. `_loadDone`/`_loadFailed` are module-scope `let`s
           in node-city and are declared the same way here because the clause
           ASSIGNS them; `e` is the caught error. */
        const loadCatch = new Function('_cityVerdict', 'e',
          'let _loadDone = false, _loadFailed = false;\n' + CATCH + '\nreturn _cityVerdict;');
        const boom = new Error('citLoad: a resident whose workplace the mesh could not build');
        chk('§3d/load a load that threw while the verdict still said \'new\' STOPS SAYING SO',
            loadCatch('new', boom) === 'unknown',
            'catch left the verdict at ' + JSON.stringify(loadCatch('new', boom)) +
            ' — a half-read city asserting a founding decision it cannot justify');
        chk('§3d/load …but an ESTABLISHED city that threw is left alone, not deferred',
            loadCatch('established', boom) === 'established',
            'a renderer fault deferred a city we had already proved exists — that blocks its ' +
            'server writes and denies it nothing it was owed, which is the trade this package exists to refuse');
        chk('§3d/load …and an already-undecided verdict stays undecided',
            loadCatch('unknown', boom) === 'unknown', 'got ' + loadCatch('unknown', boom));

        /* THE PRODUCTION SHAPE, END TO END: derive the verdict from the payload
           exactly as loadState does, throw where loadState can throw, run the
           shipped clause, and hand the result to the shipped E.mount literal. */
        const loadThrew = (j, unsafe) => {
          let v = new Function('return (' + initRhs + ');')();
          try { v = verdict(j, unsafe); throw boom; } catch (err) { return loadCatch(v, err); }
        };
        const vNew = loadThrew('{"tiles":{}}', false);
        E.mount(mkOpts('blind-loadthrow-new', () => 150, null, vNew));
        console.log('   [load threw] payload {"tiles":{}} clean read → verdict=' + vNew +
                    ' → totalCinder ' + E.totalCinder().toFixed(2) + ' 🔥' + (E.deferred() ? '  (DEFERRED)' : ''));
        chk('§3d/load a half-completed load issues NO founding tranche through the production mount',
            vNew === 'unknown' && E.deferred() === true && E.totalCinder() < 1e-6,
            'verdict ' + vNew + ', deferred ' + E.deferred() + ', totalCinder ' + E.totalCinder().toFixed(2) +
            ' 🔥 — the load stopped half way and the city was founded anyway');
        const vLived = loadThrew(livedSave, false);
        E.mount(mkOpts('blind-loadthrow-lived', () => 150, null, vLived));
        chk('§3d/load …while a city with tiles on disk is NOT deferred by the same fault',
            vLived === 'established' && E.deferred() === false,
            'verdict ' + vLived + ', deferred ' + E.deferred() +
            ' — an unconditional downgrade blocks an established city\'s saves for a renderer bug');
      }
    }
  }

  /* ── §3c DEFERRAL MAY NOT COST THE PLAYER THEIR CITY ───────────────────────
     🔴 THE ROUND THAT HAD TO BE WRITTEN BECAUSE §3's FIX WENT TOO FAR.
     §3 stopped node-city deciding the founding question on ambiguous evidence.
     The first implementation of that also blocked BOTH save writers while the
     verdict was 'unknown', reasoning that a write during an unproven read could
     land on a real city the server had merely refused to show. True of the
     ACCOUNT row. False of everything else — and it made the same trade this
     package exists to stop, one size larger.

     `window.cityStateLoad` (public/index.html) opens with
         if (!Cloud || !Cloud.ready || !Cloud.client || !Profile.cloud ||
             !Profile.cloud.userId) { window.__cityLoadUnsafe = true; return null; }
     so a signed-out or offline player gets an unsafe, empty read UNCONDITIONALLY
     — not as a blip, as their steady state, and `_openNodeCity` explicitly
     supports reaching the city that way. MEASURED on that tree, driving the
     SHIPPED bridge IIFE against a signed-out parent: verdict 'unknown', all four
     automatic retries 'unknown', localStorage keys written 0, cityStateSave
     calls 0. Nothing anywhere, every session, forever — while the panel
     promised "Retrying automatically" and "nothing has been lost". The pre-
     deferral tree denied that player their tranche; this one deleted their city.

     SO THE TWO RISKS ARE SEPARATED, and this section drives the shipped
     `_savePolicy()`, the shipped `cityEcoVerdict()`, the shipped `ecoDefer:`
     field out of serialize(), the shipped loadState re-affirm line and the
     shipped bridge, through three full save/load SESSIONS.
     Prove it can fail: defer-noSave / defer-serverwrite / defer-nostamp. */
  {
    const NC2 = join(here, '../../public/node-city/index.html');
    const nc = readFileSync(NC2, 'utf8');
    const BRIDGE = srcBlockAfter(nc, 'const MythicCityBridge = (() =>');
    let VERDICT = srcBlockAfter(nc, 'function cityEcoVerdict(j, unsafe)');
    let POLICY = srcBlockAfter(nc, 'function _savePolicy()');
    /* The two one-liners are read as TEXT and compiled, so this section cannot
       drift away from what serialize() and loadState() actually do. */
    const STAMP_LINE = (nc.match(/^\s*ecoDefer: .*$/m) || [])[0];
    const RAISE_LINE = (nc.match(/^\s*if \(_pendingEconomy \|\| .*_cityVerdict = 'established';\s*$/m) || [])[0];
    chk('§3c can read the bridge, _savePolicy, cityEcoVerdict, the ecoDefer stamp and loadState\'s re-affirm',
        !!BRIDGE && !!VERDICT && !!POLICY && !!STAMP_LINE && !!RAISE_LINE,
        'bridge ' + (BRIDGE ? BRIDGE.length + 'b' : 'UNREADABLE') + ', policy ' + (POLICY ? 'ok' : 'UNREADABLE') +
        ', verdict ' + (VERDICT ? 'ok' : 'UNREADABLE') + ', stamp ' + JSON.stringify(STAMP_LINE) +
        ', re-affirm ' + JSON.stringify(RAISE_LINE) + ' — a rename made this section vacuous');

    if (BRIDGE && VERDICT && POLICY && STAMP_LINE && RAISE_LINE) {
      /* 🧨 Each switch re-commits ONE of the three things that were wrong, into
         the extracted text and nothing else. A switch that matches nothing
         throws rather than running inert. */
      if (SABOTAGE === 'defer-noSave') {
        const hit = POLICY.replace("if (_cityVerdict === 'unknown') return real ? 'local' : 'none';",
                                   "if (_cityVerdict === 'unknown') return 'none';");
        if (hit === POLICY) throw new Error('SABOTAGE defer-noSave matched nothing — _savePolicy was reshaped and this switch is inert');
        POLICY = hit;
      }
      if (SABOTAGE === 'defer-serverwrite') {
        const hit = POLICY.replace("return real ? 'local' : 'none';", "return real ? 'full' : 'none';");
        if (hit === POLICY) throw new Error('SABOTAGE defer-serverwrite matched nothing — _savePolicy was reshaped and this switch is inert');
        POLICY = hit;
      }
      if (SABOTAGE === 'defer-nostamp') {
        const hit = VERDICT.replace(/\s*if \(s\.ecoDefer\) return unsafe \? 'unknown' : 'new';/, '');
        if (hit === VERDICT) throw new Error('SABOTAGE defer-nostamp matched nothing — the ecoDefer term was reshaped and this switch is inert');
        VERDICT = hit;
      }

      const vdict = new Function('j', 'unsafe', 'return (function cityEcoVerdict(j,unsafe)' + VERDICT + ')(j,unsafe);');
      const policy = new Function('_cityVerdict', '_loadDone', '_loadFailed', 'game',
                                  'return (function _savePolicy()' + POLICY + ')();');
      const stamp = new Function('_cityVerdict',
        'return (' + STAMP_LINE.trim().replace(/^ecoDefer:\s*/, '').replace(/,$/, '') + ');');
      const reaffirm = new Function('_pendingEconomy', 's', '_cityVerdict', RAISE_LINE.trim() + ' return _cityVerdict;');

      /* THE PARENT, modelled line for line off public/index.html — because the
         whole defect lives in what that file answers a signed-out player. */
      const makeParent = (o) => {
        const P = {
          getRes: () => 0, addCinders: () => {},
          __cityLoadUnsafe: false, serverRow: o.serverRow || null, serverWrites: 0,
          cityStateLoad: async () => {
            if (!o.signedIn || o.rls) { P.__cityLoadUnsafe = true; return null; }
            P.__cityLoadUnsafe = false; return P.serverRow;
          },
          cityStateSave: async (json) => { if (!o.signedIn) return; P.serverWrites++; P.serverRow = json; return true; },
          cityStateUserId: () => (o.signedIn ? o.uid : null),
        };
        return P;
      };
      const makeBridge = (P, store) => {
        const LS = { getItem: (k) => (store.has(k) ? store.get(k) : null),
                     setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
        const fn = new Function('window', 'localStorage', 'location', 'URLSearchParams', 'console', 'setTimeout',
                                'return (() => ' + BRIDGE + ')();');
        return fn({ parent: P, addEventListener: () => {} }, LS, { search: '' }, URLSearchParams, console, setTimeout);
      };
      /* ONE node-city SESSION: boot → loadCity → verdict → play → save, in the
         shipped call shape and through the shipped bridge. */
      const session = async (tag, popts, store, build) => {
        const P = makeParent(popts), B = makeBridge(P, store);
        const j = await B.loadCity();
        const unsafe = !!B.loadUnsafe;
        let v = vdict(j, unsafe), loadFailed = unsafe;
        const game = { tiles: { '0,0': { type: 'anchor' } } };
        let pendingEconomy = null;
        if (j) {
          let s = null; try { s = JSON.parse(j); } catch (e) { s = null; }
          if (s && s.tiles) {
            game.tiles = s.tiles;
            pendingEconomy = (s.economy && typeof s.economy === 'object') ? s.economy : null;
            v = reaffirm(pendingEconomy, s, v);
          } else loadFailed = true;
        }
        const restored = Object.keys(game.tiles).filter((k) => game.tiles[k].type !== 'anchor').length;
        if (build) for (const [k, t] of build) game.tiles[k] = t;
        const pol = policy(v, true, loadFailed, game);
        if (pol !== 'none') {
          await B.saveCity(JSON.stringify({ tiles: game.tiles, economy: pendingEconomy,
                                            ecoDefer: stamp(v), savedAt: 1 }),
                           { localOnly: pol === 'local' });
        }
        console.log('   [' + tag + '] unsafe=' + unsafe + ' verdict=' + v + ' restored=' + restored +
                    ' policy=' + pol + ' → localStorage ' + store.size + ' key(s), cityStateSave ' + P.serverWrites);
        return { v, pol, P, restored };
      };
      const BUILD = [['3,4', { type: 'house' }], ['5,2', { type: 'shop' }]];

      /* ── the signed-out player, across three sessions ───────────────────── */
      const devA = new Map();
      const a1 = await session('signed out, builds a house', { signedIn: false }, devA, BUILD);
      chk('§3c a signed-out player is DEFERRED, not decided', a1.v === 'unknown', 'verdict ' + a1.v);
      chk('§3c …and their city IS written — to this device',
          a1.pol === 'local' && devA.size === 1,
          'policy ' + a1.pol + ', localStorage keys ' + devA.size +
          ' — blocking the local write deletes the city of every player who has not signed in');
      chk('§3c …while the account row is left untouched',
          a1.P.serverWrites === 0 && a1.P.serverRow === null,
          'cityStateSave calls ' + a1.P.serverWrites + ' — a deferred session wrote the row it cannot read');

      const a2 = await session('comes back, still offline', { signedIn: false }, devA, [['6,6', { type: 'farm' }]]);
      chk('§3c …the city comes BACK next session', a2.restored === 2, 'restored ' + a2.restored + ' tiles');
      chk('§3c …and is STILL deferred — its own autosave is not evidence of an established city',
          a2.v === 'unknown' && a2.pol === 'local',
          'verdict ' + a2.v + ' — the `ecoDefer` stamp is what stops a brand-new offline player being ' +
          'permanently refused their 300,000 🔥 by their own save');

      const a3 = await session('signs in, server has no city', { signedIn: true, uid: 'u-1', serverRow: null }, devA, []);
      chk('§3c …and the first trustworthy read decides it: new city, tranche due',
          a3.v === 'new' && a3.pol === 'full' && a3.P.serverWrites === 1,
          'verdict ' + a3.v + ', policy ' + a3.pol + ', server writes ' + a3.P.serverWrites);

      /* ── the established player whose read blips ─────────────────────────── */
      const REAL = JSON.stringify({ tiles: { '0,0': { type: 'anchor' }, '1,1': { type: 'house' },
                                             '2,2': { type: 'mill' }, '7,7': { type: 'bank' } },
                                    economy: { day: 400, treasury: 57.71, charterIssued: 300000 }, savedAt: 1 });
      const devB = new Map();
      const b1 = await session('RLS blip, builds anyway', { signedIn: true, uid: 'u-9', rls: true, serverRow: REAL }, devB, BUILD);
      chk('§3c an ESTABLISHED player\'s ambiguous read defers too — no second tranche',
          b1.v === 'unknown', 'verdict ' + b1.v);
      chk('§3c …and their 400-day save is NOT overwritten by the deferred session',
          b1.P.serverWrites === 0 && b1.P.serverRow === REAL,
          'cityStateSave calls ' + b1.P.serverWrites + ' — this is the hazard the block was invented for, and it is real');
      const b2 = await session('read recovers', { signedIn: true, uid: 'u-9', serverRow: REAL }, devB, []);
      const b2eco = JSON.parse(b2.P.serverRow).economy;
      chk('§3c …and the lived city loads back intact, established, charterIssued 300,000.00 🔥',
          b2.v === 'established' && b2.restored === 3 && b2eco &&
          Math.abs(b2eco.charterIssued - 300000) < 1e-9 && Math.abs(b2eco.treasury - 57.71) < 1e-9,
          'verdict ' + b2.v + ', tiles ' + b2.restored + ', economy ' + JSON.stringify(b2eco));

      /* ── an EMPTY deferred city still writes nothing, anywhere ───────────── */
      const devC = new Map();
      const c1 = await session('deferred, nothing built', { signedIn: false }, devC, []);
      chk('§3c a deferred city with nothing in it writes nothing at all',
          c1.pol === 'none' && devC.size === 0 && c1.P.serverWrites === 0,
          'policy ' + c1.pol + ', localStorage keys ' + devC.size);

      /* ── and the stamp read straight through the verdict function ────────── */
      const deferBlob = JSON.stringify({ tiles: { '0,0': {}, '3,4': {} }, ecoDefer: 1 });
      chk('§3c verdict(our own deferred blob, UNSAFE read) = unknown', vdict(deferBlob, true) === 'unknown',
          'got ' + vdict(deferBlob, true));
      chk('§3c verdict(our own deferred blob, CLEAN read) = new', vdict(deferBlob, false) === 'new',
          'got ' + vdict(deferBlob, false));
      chk('§3c …but a blob that carries a real economy still outranks the stamp',
          vdict(JSON.stringify({ tiles: { '0,0': {} }, ecoDefer: 1, economy: { day: 9 } }), true) === 'established',
          'a bootstrapped economy is the strongest evidence there is and must win');
    }
  }

  /* ── §3e THE TWO SAVE WRITERS THEMSELVES, LIFTED AND RUN ───────────────────
     🔴 THE COVERAGE GAP THIS SECTION WAS WRITTEN FOR, AND IT IS A NASTY ONE.
     §3c above drives `_savePolicy()` directly. Nothing in this gate had ever
     driven the two functions that CALL it. So when the save-policy fix at
     `saveSoon()`'s timer call site was reverted on its own, the tree that came
     back called `_saveWouldErase()` — A FUNCTION THAT NO LONGER EXISTS, because
     the same commit renamed and reshaped it into `_savePolicy()`. Every autosave
     in that tree throws a ReferenceError and the city silently stops saving.

     BOTH GATES WERE GREEN ON IT. The economy gauntlet never ran the writers, and
     `_synckcheck.mjs` cannot help by construction: an undefined free variable is
     perfectly valid JavaScript and only fails when the line executes. That is
     the single worst shape a coverage hole can have — the product is broken for
     every player on an ordinary path and every automated check says fine.

     CALLERS MIRRORED: `saveSoon()` is the debounced writer behind the ~25
     build/demolish/hire call sites and `bldCancel`'s post-refund save;
     `saveNow()` is the synchronous one behind the 60 s autosave, `pagehide` and
     `visibilitychange`. Both are lifted VERBATIM here, together with the
     `_savePolicy()` they call, and executed — including running the 800 ms timer
     callback, which is where the reverted call site lives.

     TWO INDEPENDENT DETECTORS, deliberately:
       1. EXECUTE. The lifted writers run in a scope holding only what node-city
          actually declares. A call to anything else is a ReferenceError, caught
          and reported as a FAILED ASSERTION rather than a harness stack trace.
       2. READ. Every identifier the save path calls is checked against
          node-city's own declarations. Detector 1 only sees the branches a
          scenario takes; a gone function behind an `if` needs detector 2.
     🧨 save-gone re-commits the pre-fix timer body verbatim and must redden both.

     ⚠ WHAT IS MODELLED, said plainly: `serialize()` (its own 60-field body is
       §3c's subject, not this one's), the bridge, and the timer. What is REAL is
       the two writers, the policy they consult, and the order they consult it
       in. */
  {
    const ncW = readFileSync(join(here, '../../public/node-city/index.html'), 'utf8');
    const declFn = (name) => {
      const b = srcBlockAfter(ncW, 'function ' + name + '()');
      return b ? 'function ' + name + '() ' + b : null;
    };
    let SOON = declFn('saveSoon');
    const NOW = declFn('saveNow'), POL = declFn('_savePolicy');
    chk('§3e/save lifted saveSoon(), saveNow() and _savePolicy() out of the shipped file',
        !!SOON && !!NOW && !!POL && SOON.indexOf('setTimeout') >= 0 && NOW.indexOf('saveCity') >= 0,
        'saveSoon ' + (SOON ? SOON.length + 'b' : 'UNREADABLE') + ', saveNow ' + (NOW ? NOW.length + 'b' : 'UNREADABLE') +
        ', _savePolicy ' + (POL ? POL.length + 'b' : 'UNREADABLE') + ' — a rename made this section vacuous');

    if (SOON && NOW && POL) {
      /* 🧨 THE REVERT, RE-COMMITTED WORD FOR WORD out of the commit that fixed
         it. Not an injury invented here: this is the text that was in the file. */
      if (SABOTAGE === 'save-gone') {
        /* ⚠ NO LINE ENDINGS IN THESE ANCHORS. node-city/index.html is CRLF, so
           a pattern ending in '\n' matches nothing and the switch runs inert —
           which it did, loudly, thanks to the throw below. */
        const pairs = [
          ['const pol = _savePolicy();', ''],
          ["if (pol === 'none') {", 'if (_saveWouldErase()) {'],
          ["MythicCityBridge.saveCity(serialize(), { localOnly: pol === 'local' });", 'MythicCityBridge.saveCity(serialize());'],
        ];
        for (const [from, to] of pairs) {
          if (SOON.indexOf(from) < 0) throw new Error('SABOTAGE save-gone matched nothing at ' + JSON.stringify(from.trim()) + ' — saveSoon was reshaped and this switch is inert');
          SOON = SOON.split(from).join(to);
        }
      }

      /* ── DETECTOR 2: EVERY CALL IN THE SAVE PATH MUST STILL RESOLVE ────────
         Comments stripped first — the erasure-guard header directly above
         `_savePolicy()` names `_saveWouldErase`, `saveNow()` and `saveSoon()` in
         running prose, so an un-stripped scan would cheerfully "find" the very
         function it is trying to prove is gone. */
      const HOSTG = ['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'typeof', 'do', 'else', 'new',
                     'setTimeout', 'clearTimeout', 'JSON', 'Object', 'Number', 'Math', 'String', 'Array', 'Date',
                     'console', 'isNaN', 'parseInt', 'parseFloat', 'Boolean', 'Promise', 'Set', 'Map', 'Error'];
      /* …and string BODIES emptied for the same reason. The blocked-save warning
         reads "…before a clean load (loadDone=", and `load (` is an identifier
         followed by a paren as far as any regex is concerned. Found by running
         this scan on the shipped tree and watching it report `load` as a
         function node-city does not declare. */
      const noStr = (s) => {
        let out = '';
        for (let i = 0; i < s.length; i++) {
          const c = s[i];
          if (c === '"' || c === "'" || c === '`') {
            const q = c; out += c; i++;
            for (; i < s.length; i++) { if (s[i] === '\\') { i++; continue; } if (s[i] === q) break; }
            out += q; continue;
          }
          out += c;
        }
        return out;
      };
      const scan = noStr(stripComments(SOON + '\n' + NOW + '\n' + POL));
      const called = [];
      /* 🔴 LOOKBEHIND, NOT A CONSUMED LEADING CHARACTER — and the difference is
         this detector working at all. The first draft used
         `(^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(`, which swallows the open paren, so
         in `if (_saveWouldErase())` the `if` match consumed `(` and the call
         INSIDE it was never looked at. Measured: the save-gone switch left this
         assertion green while detector 1 was throwing a ReferenceError two
         sections down — the exact "guard shaped like a guard" this file exists
         to distrust. `.foo(` is excluded so method calls on the bridge and on
         console are not mistaken for free identifiers. */
      const callRe = /(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g;
      for (let m = callRe.exec(scan); m; m = callRe.exec(scan)) {
        if (HOSTG.indexOf(m[1]) < 0 && called.indexOf(m[1]) < 0) called.push(m[1]);
      }
      const gone = called.filter((n) => !(new RegExp('(?:function|const|let|var)\\s+' + n + '\\b').test(ncW)));
      chk('§3e/save every function the save path calls is still DECLARED in node-city (' + called.length + ' checked)',
          called.length >= 3 && gone.length === 0,
          'called ' + JSON.stringify(called) + ' — UNDECLARED: ' + JSON.stringify(gone) +
          '. A save path that names a function the file no longer has throws a ReferenceError on ' +
          'every write, and neither the gauntlet nor _synckcheck.mjs can see it');

      /* ── DETECTOR 1: RUN THEM ─────────────────────────────────────────────
         One fresh scope per scenario. `_loadDone`/`_loadFailed`/`_cityVerdict`
         arrive as parameters because node-city holds them at module scope and
         the writers only READ them. `saveTimer` is declared here for the same
         reason it is declared there — both writers assign it. */
      const mkWriters = new Function(
        'game', 'MythicCityBridge', 'console', 'setTimeout', 'clearTimeout', 'serialize',
        '_loadDone', '_loadFailed', '_cityVerdict',
        'let saveTimer = null;\n' + POL + '\n' + SOON + '\n' + NOW + '\n' +
        'return { saveSoon: saveSoon, saveNow: saveNow, policy: _savePolicy };');
      const drive = (v, loadDone, loadFailed, tiles, how) => {
        const wrote = [];
        let cb = null;
        const game = { tiles: tiles };
        const quiet = { warn: () => {}, log: () => {}, error: () => {} };
        const W = mkWriters(game,
          { saveCity: (j, o) => { wrote.push({ bytes: String(j).length, localOnly: !!(o && o.localOnly) }); return Promise.resolve(true); } },
          quiet,
          (fn) => { cb = fn; return 1; }, () => { cb = null; },
          () => JSON.stringify({ tiles: game.tiles }),
          loadDone, loadFailed, v);
        let threw = null;
        try {
          if (how === 'soon') { W.saveSoon(); if (cb) cb(); } else { W.saveNow(); }
        } catch (e) { threw = e; }
        return { wrote: wrote, threw: threw, armed: cb !== null || how !== 'soon' };
      };
      const ANCHOR_ONLY = { '0,0': { type: 'anchor' } };
      const REAL_CITY   = { '0,0': { type: 'anchor' }, '3,4': { type: 'house' }, '5,2': { type: 'shop' } };

      /* THE HEADLINE. A deferred city with real tiles is the commonest shape
         there is — every signed-out or offline session — and it is the one the
         debounced writer serves after every single build click. */
      const soonDefer = drive('unknown', true, true, REAL_CITY, 'soon');
      chk('§3e/save saveSoon()\'s timer callback RUNS — the shipped save path resolves every name it uses',
          soonDefer.threw === null,
          soonDefer.threw ? (soonDefer.threw.name + ': ' + soonDefer.threw.message +
            ' — thrown by node-city\'s OWN saveSoon body. Every autosave in this tree dies here ' +
            'and the player\'s city is never written') : '');
      chk('§3e/save …it armed the 800 ms timer rather than writing inline', soonDefer.armed,
          'setTimeout was never called — the debounce is gone and every click is a Supabase write');
      chk('§3e/save …and a deferred city with real tiles is written, LOCAL ONLY',
          soonDefer.wrote.length === 1 && soonDefer.wrote[0].localOnly === true,
          JSON.stringify(soonDefer.wrote) + ' — this is the write that keeps a signed-out player\'s city');

      const soonEmpty = drive('unknown', true, true, ANCHOR_ONLY, 'soon');
      chk('§3e/save …while an EMPTY deferred city writes nothing at all',
          soonEmpty.threw === null && soonEmpty.wrote.length === 0,
          JSON.stringify(soonEmpty.wrote) + (soonEmpty.threw ? ' threw ' + soonEmpty.threw.message : ''));

      const soonDecided = drive('new', true, false, ANCHOR_ONLY, 'soon');
      chk('§3e/save …and a DECIDED city off a clean load writes both, server included',
          soonDecided.threw === null && soonDecided.wrote.length === 1 && soonDecided.wrote[0].localOnly === false,
          JSON.stringify(soonDecided.wrote) + (soonDecided.threw ? ' threw ' + soonDecided.threw.message : '') +
          ' — a brand-new player is genuinely empty and MUST still save');

      /* The synchronous writer, on the same three shapes. It is the one that
         fires from `pagehide`, so it is the last chance a session gets. */
      const nowDefer   = drive('unknown', true, true, REAL_CITY, 'now');
      const nowEmpty   = drive('unknown', true, true, ANCHOR_ONLY, 'now');
      const nowUnknown = drive('established', true, true, ANCHOR_ONLY, 'now');
      chk('§3e/save saveNow() runs too, and answers the same three shapes the same way',
          nowDefer.threw === null && nowEmpty.threw === null && nowUnknown.threw === null &&
          nowDefer.wrote.length === 1 && nowDefer.wrote[0].localOnly === true &&
          nowEmpty.wrote.length === 0 && nowUnknown.wrote.length === 0,
          'deferred+tiles ' + JSON.stringify(nowDefer.wrote) + ', deferred+empty ' + JSON.stringify(nowEmpty.wrote) +
          ', failed load+empty ' + JSON.stringify(nowUnknown.wrote) +
          (nowDefer.threw ? ' :: THREW ' + nowDefer.threw.message : ''));
      /* …and the erasure guard the whole family exists for is still shut. */
      chk('§3e/save a failed load with an empty city still writes NOTHING, through both writers',
          drive('established', true, true, ANCHOR_ONLY, 'soon').wrote.length === 0 && nowUnknown.wrote.length === 0,
          'the original erasure guard — one row per user, upserted, no history');
    }

    /* ── §3f THE DEFERRAL PANEL'S BUTTONS MUST ACTUALLY DO SOMETHING ─────────
       🔴 THE ONE CONTROL A DEFERRED PLAYER HAS, AND IT WAS ONE `if` FROM DEAD.
       `ecoAction()` opens `if (!E || !E.ready()) return false;` — and a deferred
       economy is BY DEFINITION not ready. So the two buttons `ecoDeferHtml()`
       renders, 🔄 Retry now and ↻ Reload the page, are dispatched in a block
       ABOVE that gate. Delete that block and both buttons are inert: the click
       lands, `ecoAction` returns false, and nothing happens ever again.

       WHY THAT IS PLAYER HARM AND NOT A COSMETIC MISS. `ecoDeferHtml` prints
       "Retrying · automatically" only while `_ecoDeferTries` is inside
       ECO_DEFER_BACKOFF_SEC; once the backoff list is exhausted it prints
       "on request", i.e. the panel tells the player in as many words that the
       button is now the only thing left. For a signed-out player the automatic
       retry can never succeed (cityStateLoad raises `loadUnsafe`
       unconditionally — see §3c), so "on request" is where they END UP, and the
       request does nothing. Their founding tranche is unreachable from the UI.

       CALLER MIRRORED: node-city's economy panel click handler → `ecoAction(act,
       arg)`, with the action ids taken from `ecoDeferHtml()`'s own `ecoBtn(…)`
       calls rather than from a list written here — so a THIRD button added to
       that panel without a dispatch fails this section on the day it lands.
       🧨 defer-deadbtn deletes the dispatch block, which is the revert exactly. */
    {
      const lift = (sig) => {
        const b = srcBlockAfter(ncW, 'function ' + sig);
        return b ? 'function ' + sig + ' ' + b : null;
      };
      let ACT = lift('ecoAction(act, arg)');
      const PANEL = lift('ecoDeferHtml()');
      const ANCH = "if (E && typeof E.deferred === 'function' && E.deferred())";
      chk('§3f/panel lifted ecoAction() and ecoDeferHtml() out of the shipped file',
          !!ACT && !!PANEL && ACT.indexOf('E.ready()') > 0,
          'ecoAction ' + (ACT ? ACT.length + 'b' : 'UNREADABLE') + ', ecoDeferHtml ' + (PANEL ? PANEL.length + 'b' : 'UNREADABLE'));

      if (ACT && PANEL) {
        if (SABOTAGE === 'defer-deadbtn') {
          const a = ACT.indexOf(ANCH);
          const blk = a >= 0 ? srcBlockAfter(ACT.slice(a), ANCH) : null;
          if (!blk) throw new Error('SABOTAGE defer-deadbtn matched nothing — ecoAction was reshaped and this switch is inert');
          const rest = ACT.slice(a + ANCH.length);
          ACT = ACT.slice(0, a) + rest.slice(rest.indexOf(blk) + blk.length);
        }
        /* The buttons the panel really offers, read off the panel. */
        const OFFERED = [];
        for (const m of stripComments(PANEL).matchAll(/ecoBtn\('([a-z]+)'/g)) if (OFFERED.indexOf(m[1]) < 0) OFFERED.push(m[1]);
        chk('§3f/panel the deferral panel offers the buttons this section thinks it does',
            OFFERED.length >= 2, 'ecoBtn ids found in ecoDeferHtml: ' + JSON.stringify(OFFERED));

        const gateAt = ACT.indexOf('E.ready()');
        for (const id of OFFERED) {
          const at = ACT.indexOf("act === '" + id + "'");
          chk('§3f/panel ecoAction dispatches \'' + id + '\' ABOVE the ready() gate',
              at >= 0 && at < gateAt,
              at < 0 ? 'no dispatch for \'' + id + '\' anywhere in ecoAction — the panel renders a button that does nothing'
                     : 'dispatch@' + at + ' is BELOW the ready() gate@' + gateAt +
                       ', and a deferred economy is never ready, so the button is dead');
        }

        /* …AND THEN CLICKED. A text check alone cannot tell a dispatch that runs
           from one that returns early two lines above it. */
        const fired = [];
        const renderEco = function () { fired.push('renderEco'); };
        const mkAction = new Function('window', 'ecoDeferRetry', 'renderEco', 'location', 'console',
                                      ACT + '\nreturn ecoAction;');
        const clickWhileDeferred = (id) => {
          fired.length = 0;
          renderEco._last = 'stale';
          const act = mkAction(
            { MythicEconomy: { deferred: () => true, ready: () => false } },
            (manual) => { fired.push('ecoDeferRetry(' + manual + ')'); },
            renderEco,
            { reload: () => { fired.push('location.reload'); } },
            { warn: () => {}, log: () => {} });
          let ret = null, threw = null;
          try { ret = act(id, ''); } catch (e) { threw = e; }
          return { ret: ret, fired: fired.slice(), threw: threw, cleared: renderEco._last === null };
        };
        const retry = clickWhileDeferred('ecoretry');
        chk('§3f/panel 🔄 Retry now RE-READS the city records and repaints',
            retry.threw === null && retry.ret === true &&
            retry.fired.indexOf('ecoDeferRetry(true)') >= 0 && retry.fired.indexOf('renderEco') >= 0 && retry.cleared,
            'returned ' + retry.ret + ', fired ' + JSON.stringify(retry.fired) + ', repaint cache cleared ' + retry.cleared +
            (retry.threw ? ', threw ' + retry.threw.message : '') +
            ' — once the backoff gives up, this button is the ONLY way a signed-out player reaches their founding capital');
        const reload = clickWhileDeferred('ecoreload');
        chk('§3f/panel ↻ Reload the page actually reloads it',
            reload.threw === null && reload.ret === true && reload.fired.indexOf('location.reload') >= 0,
            'returned ' + reload.ret + ', fired ' + JSON.stringify(reload.fired));

        /* THE HONEST INVERSE: the block is gated on `deferred()`, so a RUNNING
           economy must not reach it — otherwise 'ecoretry' would re-open the
           founding question on a city that has already answered it. */
        fired.length = 0;
        const live = mkAction({ MythicEconomy: { deferred: () => false, ready: () => false } },
                              (m) => { fired.push('ecoDeferRetry(' + m + ')'); }, renderEco,
                              { reload: () => { fired.push('location.reload'); } }, { warn: () => {}, log: () => {} });
        let liveRet = null; try { liveRet = live('ecoretry', ''); } catch (e) { liveRet = 'THREW ' + e.message; }
        chk('§3f/panel …and a NON-deferred economy never takes that path',
            liveRet === false && fired.length === 0,
            'returned ' + liveRet + ', fired ' + JSON.stringify(fired) +
            ' — the deferral controls must not be reachable once the question is answered');
      }
    }
  }

  /* ── §4 A REJECTED PAYOUT IS THE PLAYER'S MONEY, NOT THE HOUSE'S ───────────
     claimPayout() decremented `payoutOwed` unconditionally and index.js did
     `.catch(() => {})`. The treasury had already been debited and `flow.payout`
     recorded on the day of the draw, so the day audit was satisfied — and the
     Cinder was in neither ledger. `addCinders` in 'message' mode is an RPC and
     rejects on a timeout or a dead parent, so this is an ordinary Tuesday, not
     an exploit. */
  {
    E.mount({ nodeId: 'blind-payout', population: 320 });
    let refusals = 0, delivered = 0, rejecting = true, lastN = 0;
    let destroyed = 0, worstLoss = 0;
    global.window.MythicCityBridge.addCinders = async (n) => {
      lastN = n;
      if (rejecting) { refusals++; throw new Error('rpc timeout — the parent is gone'); }
      delivered += n;
    };
    /* ⚠ MEASURED PER TICK, NOT AS A RUNNING TOTAL — and the first draft of this
       round got it wrong in the direction that flatters the fix. The SAME Cinder
       is re-claimed and re-refused every tick, so summing what the bridge was
       offered counts one retry 300 times (988,068 🔥 of "claims" against ~6,000 🔥
       of real money). The only honest question is per attempt: did what the
       bridge refused come straight back onto the books before the next tick? */
    for (let i = 0; i < 300; i++) {
      lastN = 0;
      E.tick(DAY, { ...host, population: 320 });
      const afterClaim = Sim.state().payoutOwed;   // claimPayout() already ran, synchronously
      await flush();                                // let the rejection handler run
      if (SABOTAGE === 'payout-drop') {
        /* 🧨 `.catch(() => {})`, re-committed: whatever the claim took and the
           bridge then refused is simply dropped, which is the shipped end
           state to the Cinder. */
        Sim.state().payoutOwed = afterClaim;
      }
      if (lastN > 0) {
        const restored = Sim.state().payoutOwed - afterClaim;
        const lost = lastN - restored;
        if (lost > 1e-6) { destroyed += lost; worstLoss = Math.max(worstLoss, lost); }
      }
    }
    const owedBack = Sim.state().payoutOwed;
    console.log('   bridge REJECTED every call — ' + refusals + ' refusals, delivered ' +
                delivered.toFixed(2) + ' 🔥, still on the books ' + owedBack.toFixed(2) + ' 🔥');
    chk('the bridge really did refuse, so this section is not vacuous', refusals > 0,
        'nothing was ever claimed — the payout never fired and nothing was tested');
    chk('a rejected payout is restored to payoutOwed, not destroyed',
        destroyed < 1e-6 && delivered === 0,
        destroyed.toFixed(2) + ' 🔥 destroyed across ' + refusals + ' refusals (worst single ' +
        worstLoss.toFixed(2) + ' 🔥) — that money is in neither ledger');
    /* THE RETRY, EXPLICITLY. The restored balance is not a consolation number
       on a panel: the next tick claims it again, and this time the bridge is
       alive. */
    rejecting = false;
    const owedAtRecovery = Sim.state().payoutOwed;
    for (let i = 0; i < 40; i++) { E.tick(DAY, { ...host, population: 320 }); await flush(); }
    console.log('   bridge RECOVERED — delivered ' + delivered.toFixed(2) +
                ' 🔥 of the ' + owedAtRecovery.toFixed(2) + ' 🔥 that was owed when it came back');
    chk('…and the retry pays it out once the bridge is alive again',
        delivered >= Math.floor(owedAtRecovery) - 1,
        'delivered ' + delivered.toFixed(2) + ' of ' + owedAtRecovery.toFixed(2));
    chk('…and never pays it twice (payoutOwed never goes negative)',
        Sim.state().payoutOwed >= -1e-9, String(Sim.state().payoutOwed));
    global.window.MythicCityBridge.addCinders = BRIDGE0;
  }

  /* ── §5 IS GONE, AND ON PURPOSE ────────────────────────────────────────────
     It ran eight reload+tick cycles against an honest control to prove that the
     load-time Cinder clamp was a CEILING rather than a per-reload allowance.
     That clamp has been removed from sim.js, so this section had nothing left
     to grade — the correct answer to "does a forged `payoutOwed` re-grant
     itself on every reload" is now "there is no grant to re-issue; the field is
     loaded as written, and sim.js says so out loud above `audit()`".
     ⚠ ITS TWO NON-CLAMP ASSERTIONS WERE REAL AND ARE KEPT ELSEWHERE: that
       confirmed delivery is tallied for the city's life and serialized, and
       that imports are too. §2b now reads both off the live state as part of
       the owner's-ledger check, which is a stronger test than "> 1" because it
       has to BALANCE. */

  /* ── §6 `booted: false` IN THE SAVE IS THE SECOND DOOR TO THE SAME TRANCHE ──
     Closing §3 is NOT sufficient, and this is why. `load()` ended with
     `S.booted = !!raw.booted` and `bootstrap()` opens with `if (S.booted)
     return false`. So a save that says `booted: false` walks straight back into
     `issueCharter(ECON.firm.charter.seed)` — with the state fully loaded and
     the `established` flag irrelevant because a state WAS handed over. Textbook
     of the structural blind spot: money moving between the load and the first
     tick, where no audit window is open at all.

     MEASURED ON THE FIXED-FOR-§3 TREE, one edited boolean on an otherwise
     honest 60-day save, through the production call `E.mount({ …, state })`:
         charterIssued  300,000.00 → 600,000.00
         totalCinder    293,295.48 → 593,295.48        (+300,000 🔥, one reload)
         eight reloads: charterIssued pinned at the 700,000 🔥 lifetime cap and
         totalCinder settled at 492,514.87 against an honest 293,295.48
     It is worth strictly MORE than the deleted-key door, because the city keeps
     every firm, every balance and every day it had lived.

     TWO INDEPENDENT REFUSALS NOW STAND IN FRONT OF IT, and this section proves
     each one holds ALONE by rebuilding /src/economy with the other reverted:
       A. sim.js `load()` sets `S.booted = true` unconditionally — a save is
          proof the city exists. This is the one that CATCHES it on the shipped
          tree: `bootstrap()` returns at its first line and never reads `opts`.
       B. index.js `mount()` passes `established: hadState || …` — if any state
          was handed over, no tranche, whatever the blob claims about itself.
     Reverting BOTH must re-arm, or this section is asserting nothing. */
  {
    E.mount({ nodeId: 'blind-booted', population: 150 });
    for (let i = 0; i < 60; i++) E.tick(DAY, host);
    const blob = JSON.parse(JSON.stringify(E.serialize()));
    const honestIssued = E.snapshot().charterIssued, honestTotal = E.totalCinder();
    chk('the §6 fixture is not vacuous — the city really did draw its tranche',
        honestIssued > 1, 'charterIssued ' + honestIssued.toFixed(2));

    /* THE PRODUCTION CALL SHAPE. node-city hands the parsed save straight to
       E.mount as `state`; the only thing changed here is one boolean inside it,
       which is all a save editor has to do. */
    const doctored = JSON.parse(JSON.stringify(blob)); doctored.booted = false;
    E.mount({ nodeId: 'blind-booted', population: 150, state: doctored });
    const f6 = E.snapshot();
    console.log('   honest save charterIssued ' + honestIssued.toFixed(2) + ' / totalCinder ' + honestTotal.toFixed(2) +
                '  →  booted:false ' + f6.charterIssued.toFixed(2) + ' / ' + E.totalCinder().toFixed(2));
    chk('a save claiming `booted:false` is issued NO fresh founding tranche',
        Math.abs(f6.charterIssued - honestIssued) < 1 && Math.abs(E.totalCinder() - honestTotal) < 1,
        'charterIssued ' + f6.charterIssued.toFixed(2) + ' vs honest ' + honestIssued.toFixed(2) +
        ', totalCinder ' + E.totalCinder().toFixed(2) + ' vs honest ' + honestTotal.toFixed(2));
    chk('…and refusal A is the one that catches it — load() ignores raw.booted',
        Sim.state().booted === true,
        'S.booted came out of load() as ' + Sim.state().booted + ', so bootstrap() ran on a loaded save');

    /* The ratchet, because a one-shot check would miss a door that only opens
       on the second reload — which is how the pre-fix version behaved. */
    let cur = JSON.parse(JSON.stringify(blob)), worst = 0;
    for (let k = 0; k < 8; k++) {
      cur.booted = false;
      E.mount({ nodeId: 'blind-booted', population: 150, state: cur });
      worst = Math.max(worst, E.totalCinder());
      cur = JSON.parse(JSON.stringify(E.serialize()));
    }
    console.log('   eight booted:false reloads — worst totalCinder ' + worst.toFixed(2) +
                ' against an honest ' + honestTotal.toFixed(2));
    chk('…and it does not ratchet over repeated reloads either',
        worst <= honestTotal + 1, 'worst ' + worst.toFixed(2) + ' vs honest ' + honestTotal.toFixed(2) +
        ' 🔥 — the door reopens on a later reload');

    /* ── AND NOW BREAK IT, FOR REAL. Not a flag written here: a REBUILT copy of
          /src/economy with one line reverted to what shipped, imported through
          its own index.js, driven through the same production call. Anything
          less would be this round grading its own homework — see §3's header. */
    const ECODIR = join(here, '../../public/src/economy');
    const simSrc = readFileSync(join(ECODIR, 'sim.js'), 'utf8');
    const idxSrc = readFileSync(join(ECODIR, 'index.js'), 'utf8');
    const loadBlk = srcBlockAfter(simSrc, 'export function load(raw)');
    /* ⚠ THE ANCHOR MOVED WITH THE THREE-VALUED VERDICT, AND IT IS STILL THE SAME
       REFUSAL. `mount()` used to read `established: hadState || opts.established
       === true`; it now derives a three-valued verdict, and `hadState` is still
       the term that says "we were handed a blob, so this city exists, whatever
       the caller believes". The revert neuters exactly that term and nothing
       else — `hadState && false` — so a doctored `booted:false` save reaches
       bootstrap() with the caller's own verdict instead of the state's. */
    const CALLER_OK  = "const verdict = hadState ? 'established' : verdictOf(opts.established);";
    const CALLER_OLD = "const verdict = (hadState && false) ? 'established' : verdictOf(opts.established);";
    chk('§6 can find both refusals in the source it is about to revert',
        !!loadBlk && loadBlk.indexOf('S.booted = true;') >= 0 && idxSrc.indexOf(CALLER_OK) >= 0,
        'load() block ' + (loadBlk ? 'read' : 'UNREADABLE') + ', caller anchor ' +
        (idxSrc.indexOf(CALLER_OK) >= 0 ? 'found' : 'MISSING') +
        ' — the sabotage anchors have drifted and the can-fail proof below is vacuous');

    const tmpRoots = [];
    const rebuild = async (tag, edits) => {
      const dst = join(tmpdir(), 'econ-sab-' + tag + '-' + process.pid + '-' + Date.now());
      mkdirSync(dst, { recursive: true });
      tmpRoots.push(dst);
      for (const fn of readdirSync(ECODIR)) {
        if (!fn.endsWith('.js')) continue;
        let t = readFileSync(join(ECODIR, fn), 'utf8');
        for (const [find, repl] of (edits[fn] || [])) t = t.split(find).join(repl);
        writeFileSync(join(dst, fn), t);
      }
      return (await import(pathToFileURL(join(dst, 'index.js')).href)).default;
    };
    const REVERT_A = { 'sim.js': [[loadBlk, loadBlk.replace('S.booted = true;', 'S.booted = !!raw.booted;')]] };
    const REVERT_B = { 'index.js': [[CALLER_OK, CALLER_OLD]] };

    const probe = async (tag, edits) => {
      const M = await rebuild(tag, edits);
      M.mount({ nodeId: 'sab-' + tag, population: 150 });
      for (let i = 0; i < 60; i++) M.tick(DAY, host);
      const base = M.totalCinder();
      const s = JSON.parse(JSON.stringify(M.serialize())); s.booted = false;
      M.mount({ nodeId: 'sab-' + tag, population: 150, state: s });
      const got = M.totalCinder();
      console.log('   [' + tag + '] honest ' + base.toFixed(2) + ' → booted:false ' + got.toFixed(2) +
                  '  (delta ' + (got - base).toFixed(2) + ' 🔥)');
      return got - base;
    };

    const dA = await probe('revert-load', REVERT_A);
    chk('refusal B holds ALONE — with load() reverted, the caller still refuses',
        dA < 1, 'reverting sim.js load() alone re-armed ' + dA.toFixed(2) + ' 🔥');
    const dB = await probe('revert-caller', REVERT_B);
    chk('refusal A holds ALONE — with the caller reverted, load() still refuses',
        dB < 1, 'reverting index.js mount() alone re-armed ' + dB.toFixed(2) + ' 🔥');
    const dAB = await probe('revert-both', { ...REVERT_A, ...REVERT_B });
    chk('…and reverting BOTH really does re-arm the tranche — the defect is real and this proof is not vacuous',
        dAB > ECON.firm.charter.seed * 0.5,
        'both refusals reverted and totalCinder only moved ' + dAB.toFixed(2) +
        ' 🔥 — §6 is asserting nothing, find out what else is closing this');
    for (const d of tmpRoots) { try { rmSync(d, { recursive: true, force: true }); } catch (e) {} }
  }

  /* ── §7 THE LIFETIME IDENTITY — THE ONE CROSS-CHECK THAT SPANS A WHOLE CITY ─
     🔴 EVERY OTHER CONSERVATION TEST IN THIS FILE IS A DAY, A TICK OR A SEAM.
     `audit()` closes the loop inside one `runDay`; §1–§4 above each watch one
     boundary. Nothing asked the question that covers all of them at once:

         created  = charterIssued + faucetLifetime
                  = totalCinder + importsLifetime + payoutLifetime
                    + payoutOwed + payoutInFlight

     Those two creation terms are, by sim.js's own statement, the ONLY ways
     Cinder is ever made; the five on the right are everywhere it can be. The
     identity is written down in the header above `S.faucetLifetime` and in the
     one above `audit()` — and, until this section, it was written down and
     never once evaluated.

     WHY IT IS WORTH ITS OWN SECTION AND NOT JUST ANOTHER READOUT CHECK. The
     four sites that keep those tallies honest — three `addImports()` calls and
     one `S.faucetLifetime += faucet` — were all reverted one at a time by the
     COVER sweep and the gate stayed green on every one of them, because
     `S.flow.imports` (which the day audit does read) is still incremented by
     the old code and the lifetime twin simply falls behind. A tally that only
     ever under-counts is invisible to every per-day test there is. This is the
     test that has to BALANCE, so it sees them.

     ⚠ MEASURED THROUGH serialize(), WHICH ROUNDS TO 2 dp, so the tolerance is
       0.05 🔥 across five rounded terms and not 1e-9. That is deliberate: it is
       the same public surface a panel or a save reads, and the defects this
       catches are thousands of Cinder wide (36,018 🔥 of imports on the pop-80
       city below). Measured residual on the shipped tree: 0.0066 🔥 worst.
     ⚠ AND IT IS NOT A CLAMP. Nothing here bounds a loaded value or arbitrates a
       balance — read the header above sim.js `audit()` before turning it into
       one. It grades CODE PATHS on a city this process just simulated.

     CALLER MIRRORED: `E.tick()` from node-city's economy hook and `E.serialize()`
     from serialize()'s `economy:` field — the two calls the city makes every
     session, nothing lifted or modelled.
     🧨 imports-untallied / faucet-untallied re-commit one tally site each, into
        a REBUILT copy of /src/economy in a temp directory. The shipped tree is
        never written to. */
  {
    const ECODIR7 = join(here, '../../public/src/economy');
    const simSrc7 = readFileSync(join(ECODIR7, 'sim.js'), 'utf8');
    /* Each anchor is the exact statement the fix added, so a rename breaks the
       SABOTAGE loudly rather than leaving it inert.
       ⚠ REGEXES, WITH `\s*` ACROSS THE LINE BREAKS, because sim.js is CRLF —
         a literal '…;\n    return;' anchor matches nothing and the switch runs
         inert. Measured: it did, and the round went green under it.
       🔴 AND THE IMPORT SWITCH INJURES `addImports()` ITSELF, NOT ONE OF ITS
          CALL SITES — measured, and the measurement is worth recording because
          it bounds what this section can honestly claim.
          Four sites adopted `addImports()` in this session (runSubsistence:823,
          applyCredits:1028, payUpstream:1064, runDay's import bill:1239). Each
          was reverted here one at a time and the identity did not move by a
          single Cinder, because NONE OF THOSE FOUR BRANCHES EXECUTES on a city
          this gate can simulate: `runSubsistence` always finds a local seller,
          `applyCredits` always finds a payee, `payUpstream` is not reached, and
          `traded.spend` is 0 until the trade layer matches a real partner. All
          of a simulated city's imports arrive through the freight site at :1298,
          which is older than this session.
          So the switch removes the tally line inside `addImports()`, which
          proves this section CAN see an untallied import — and the four
          adoption sites are honestly recorded as UNREACHABLE by this gate's
          city shapes rather than as covered. Do not "fix" that by asserting on
          `S.flow.imports`: the whole point is that the day flow is already
          right and the lifetime twin is what falls behind. */
    const UNTALLY = {
      'imports-untallied': [/S\.importsLifetime \+= amount;/, '', 'addImports\'s lifetime tally'],
      'faucet-untallied':  [/S\.faucetLifetime \+= faucet;/, '', 'runDay\'s faucet tally'],
    };
    const tmp7 = [];
    let MOD = E;
    if (UNTALLY[SABOTAGE]) {
      const [from, to, label] = UNTALLY[SABOTAGE];
      if (!from.test(simSrc7)) throw new Error('SABOTAGE ' + SABOTAGE + ' matched nothing at ' + label + ' — sim.js was reshaped and this switch is inert');
      const dst = join(tmpdir(), 'econ-ident-' + process.pid + '-' + Date.now());
      mkdirSync(dst, { recursive: true });
      tmp7.push(dst);
      for (const fn of readdirSync(ECODIR7)) {
        if (!fn.endsWith('.js')) continue;
        let t = readFileSync(join(ECODIR7, fn), 'utf8');
        if (fn === 'sim.js') t = t.replace(from, to);
        writeFileSync(join(dst, fn), t);
      }
      MOD = (await import(pathToFileURL(join(dst, 'index.js')).href)).default;
      console.log('   🧨 one lifetime tally site reverted: ' + label);
    }

    /* Three cities chosen for what they EXERCISE, not for variety: pop 80 runs
       a large import bill (36k 🔥), pop 320 accumulates the largest unclaimed
       payout, pop 45 runs long enough for the faucet and the import tally to
       both matter. All three are ordinary `mount → tick × N` sessions. */
    const rows = [];
    let worst = 0;
    for (const [pop, days] of [[80, 200], [320, 150], [45, 250]]) {
      MOD.mount({ nodeId: 'ident-' + pop, population: pop, established: 'new' });
      for (let i = 0; i < days; i++) MOD.tick(DAY, { ...host, population: pop });
      const s = MOD.serialize();
      const created = s.charterIssued + s.faucetLifetime;
      const held = MOD.totalCinder() + s.importsLifetime + s.payoutLifetime + s.payoutOwed + s.payoutInFlight;
      const err = created - held;
      if (Math.abs(err) > Math.abs(worst)) worst = err;
      rows.push({ pop, days, created, held, err, imp: s.importsLifetime, fau: s.faucetLifetime,
                  owed: s.payoutOwed, pay: s.payoutLifetime + s.payoutOwed + s.payoutInFlight });
    }
    console.log('\n  🧾 LIFETIME IDENTITY — created (charter + faucet) vs held (total + imports + delivered + owed + in-flight):');
    for (const r of rows) {
      console.log('    pop ' + String(r.pop).padStart(3) + ' × ' + String(r.days).padStart(3) + 'd   created ' +
                  r.created.toFixed(2).padStart(12) + '   held ' + r.held.toFixed(2).padStart(12) +
                  '   err ' + r.err.toFixed(4).padStart(10) + '   [imports ' + r.imp.toFixed(2) +
                  ' · faucet ' + r.fau.toFixed(2) + ' · owner ' + r.pay.toFixed(2) + ']');
    }
    /* ⚠ THE VACUITY GUARD, AND IT ALREADY EARNED ITS KEEP. The first draft asked
       for a large `payoutOwed`, which is what a standalone probe leaves behind —
       but §4 above installs a LIVE `addCinders` on the shared window bridge, so
       by the time this section runs the payouts are being delivered and land in
       `payoutLifetime` instead. Both are terms of the identity; what matters is
       that the owner's leg is non-trivial, not which side of the bridge it is
       sitting on. Asking for the wrong one made this section red on a healthy
       tree, which is how it was found. */
    chk('§7/ident the three cities really ran — imports and the owner\'s leg are both non-trivial',
        rows.every((r) => r.created > 1) && rows.some((r) => r.imp > 1000) && rows.some((r) => r.pay > 100),
        'a city that imported nothing and paid its owner nothing balances vacuously: ' +
        JSON.stringify(rows.map((r) => r.pop + ': imp ' + r.imp.toFixed(0) + ' owner ' + r.pay.toFixed(0))));
    chk('🔴 §7/ident LIFETIME IDENTITY — every Cinder this city ever made is still accounted for ' +
        '(worst err ' + worst.toFixed(4) + ' 🔥 over ' + rows.length + ' cities)',
        Math.abs(worst) < 0.05,
        'created − held = ' + worst.toFixed(4) + ' 🔥. A POSITIVE residual means a term on the right is ' +
        'under-counted (a lifetime tally site was skipped); a NEGATIVE one means Cinder exists that ' +
        'neither creation path admits to making, which is a Rule 1 violation the day audit cannot see');
    for (const d of tmp7) { try { rmSync(d, { recursive: true, force: true }); } catch (e) {} }
  }

  if (fails) { bad++; console.log('\n=== ROUND 0s: ' + fails + ' FAILED ==='); }
  else console.log('\n=== ROUND 0s: ALL PASS ===');
}

/* ════════════════════════════════════════════════════════════════════════════
   ROUND 0t — 💰 NO LEDGER ID SELLS AT A PRICE NOBODY CHOSE
   ----------------------------------------------------------------------------
   🔴 THE DEFECT THIS ROUND EXISTS FOR, MEASURED, NOT ASSERTED.
   `RESOURCE_CINDER_VALUE` held 11 entries and `_resCinderValue` ended in `|| 3`.
   That was a crash guard while RESOURCES was 11 rows. Then the chain promotion
   took RESOURCES to 70, and `_refineryList()` — which returns ALL of RESOURCES —
   put 59 rows on the Refinery shelf at a price nobody had ever chosen. The
   promotion commit does not mention pricing, because nothing made it.

   Measured against the SHIPPED producer shelf (CITY_PRODUCTION), on the tree
   before this round:

     a tier-0 chain building eats {fuel:10} = 40 🔥 and yields 40 units
       sell the 10 fuel          10 × 4 =  40 🔥
       sell the 40 units at 3    40 × 3 = 120 🔥        ratio 3.000×
     over one 36 h OFFLINE_CAP collect (6 cycles): 720 🔥 gross for 240 🔥 of
     fuel, +480 🔥 net, per building, forever

     47 of the 56 promoted producers were Cinder-positive: 30 tier-0 at 3.000×
     and 17 tier-1 at 1.077×. `_refinerySellRes` pays through addCinders →
     addGems → Profile.gems, so this is REAL currency, not city script.

   ── WHY THIS BUG CLASS SURVIVES A GREEN GATE ────────────────────────────────
   The same reason the loot dilution did: promoting an id changes the behaviour
   of every site that reads RESOURCES for a DIFFERENT question. round0q closed
   "what does a scavenging run bring back?". This closes "what is it worth?".
   Nothing pinned sale pricing, so the next promotion re-opened it in silence —
   which is exactly the failure mode round0q was written to end, on the other
   half of the same defect.

   ── 🔴 THE CORRECTION: THIS ROUND USED TO CERTIFY SOMETHING FALSE ───────────
   Revision 1 of this round ended with the line "NOT ONE chain producer is
   Cinder-positive — worst 1.000×". That was measured off CITY_PRODUCTION's BASE
   yields, and it is false for every player who has ever registered a camp node,
   because the shipped payout does not pay base yields.

   The asymmetry, scraped out of public/src/city/production.state.js and asserted
   below rather than described:

       pending()  const n = Math.floor((def.yields[k]|0) * lvl * cycles
                                        * throttle * vitals * tf);   ← × terroir
       collect()  const n = (def.inputs[k]|0) * (p.level|0||1) * pend.cycles;
                                                                     ← FLAT

   Output is multiplied by the terroir factor. The inputs charged for that same
   output are not. So the value ratio of one cycle is

       ratio(player) = ratio(catalogue) × tf

   and `tf` is up to `RICH.yieldMul × SEAM_BONUS_MUL × stackMul(rank 1)`
   = 1.60 × 3 × 1 = 4.80 (all three read from terroir.js by this round, never
   typed). RESOURCES going 14 → 70 fed terroir's resourceIds(), so slotsFor(70)
   = {RICH:15, COMMON:25, SCARCE:28, BARREN:2} now deals RICH ground to chain
   ids routinely — 15 of 70, 21.4%.

   What that does to the number this round used to print:

       measured at            chain worst   chain positive   legacy worst
       tf = 1 (revision 1)      1.000×          0 / 56          8.000×
       RICH ground (1.60)       1.600×         56 / 56         12.800×
       MAX_TF      (4.80)       4.800×         56 / 56         38.400×

   So the certified "worst 1.000×, nothing is Cinder-positive" was true of the
   catalogue and true of nobody. ALL 56 chain producers are Cinder-positive on
   rich ground, and the pre-existing Wellhead pin of 8.000× is 38.400× on a
   seamed node — an integer pin that read as a containment guarantee it did not
   give.

   ── ⚠ WHY REPRICING COULD NOT DO IT, so nobody re-derives the rejected fix ──
   🔴 PRICING IS THE WRONG LEVER AND THE ARITHMETIC SAID SO. The obvious in-file
   remedy — re-derive every price against the worst ground,
   `value(out) = max(1, floor(Σ in.qty × value(in) / (yield × MAX_TF)))` — was
   computed before being rejected. It does not work:

       chain_aluminumOre (tier 0)  exact 0.625 → 0.208🔥 at MAX_TF
       chain_beverages   (tier 1)  exact 1.741 → 1           → 0.574×  ok
       chain_cars        (tier 2)  exact 3.750 → 3           → 0.800×  ok

   Sub-1 prices ARE expressible (`_refineryYield` divides by 0.2 perfectly well),
   so the first draft's stated reason — "1 is the smallest price the table can
   express" — was simply wrong. The real reason is better: `addGems()` does
   `Math.floor(amount || 0)` (index.html :64691), so a tier-0 good priced at
   0.208🔥 pays LITERALLY ZERO for every ordinary-ground sale under 5 units. A
   reprice against the worst ground makes the commonest sale in the game free.
   It also cannot touch the LEGACY producers at all — and those were the dominant
   term (38.400× against 4.800×).

   ── ✅ THE FIX THAT LANDED, AND WHERE ───────────────────────────────────────
   `public/src/city/production.state.js`, under an explicit scope extension:
   `collect()` now charges its inputs by the SAME terroir factor `pending()`
   multiplied the output by, and the affordability loop, the one-cycle halt check
   and the charge all take that factor from ONE shared helper
   (`inputTerroirScale` / `inputCharge`) so the promise and the charge cannot
   drift — scaling one and not the other is verbatim the "banked 🥫 270 (6
   cycles) → Not enough Water" bug that file documents.
   Terroir still means what its own comment claims: 4.8× the THROUGHPUT per
   cycle, per crew slot, per tile. What it stopped doing is manufacturing value.
   Driven, at the seam, 36 h:  chain 4.800× → 1.000×, 56/56 Cinder-positive → 0;
   legacy 38.400× → 8.000×, i.e. back to the pre-existing hand-catalogue pumps
   §4 pins, with the terroir multiplier gone from both shelves at once.
   ⚠ NOTHING BELOW IS PINNED ANY MORE. §3b runs the shipped module.

   ── WHAT THIS ROUND ASSERTS ─────────────────────────────────────────────────
     COVERAGE     every id in RESOURCES has an OWN entry in the table, and the
                  fall-through is MEASURED rather than assumed: the shipped
                  `_resCinderValue` text is evaluated over a Proxy that returns a
                  poison value for any missing key, so an id that reaches `|| 3`
                  is caught however the fallback is spelled.
     DERIVATION   the 59 prices this round set are re-derived from the shipped
                  CITY_PRODUCTION and compared by value:
                      value(out) = max(1, floor( Σ in.qty × value(in) / yield ))
                  Retune CHAIN_TIER and the gate names the new number. The table
                  in index.html is a MIRROR — it has to be, because index.html
                  cannot import an ES module — and this is what makes it safe.
     PAYOUT       🔴 THE SECTION THAT COST THIS ROUND TWO REVISIONS. §3b LOADS
                  production.state.js FROM SOURCE, mounts a fake host and a real
                  terroir seed, and RUNS one 36 h collect per producer on three
                  grounds (unsurveyed tf 1.000 · dealt · the node's own seam,
                  tf 4.800). The ratio is the measured ledger delta priced at
                  `_resCinderValue` — not a model, not a scrape, not a pin.
                  Revision 1 measured base yields (a ratio no player gets);
                  revision 2 scraped two statements and modelled `ratio × tf`,
                  then pinned the products, which had to be retired by hand the
                  day the defect was fixed. Neither could survive the code
                  changing under it. This can.
     BASELINE     no chain producer is Cinder-positive on ANY ground, terroir
                  cannot raise a cycle's value ratio in either shelf, and the
                  charge is exactly inputs × cycles × tf rounded up — never
                  under (a faucet), never more than one unit per input leg over
                  (a stealth nerf). The legacy shelf's PRE-EXISTING base pumps
                  are out of scope and §4 pins them to the Cinder.
     RULE 4       no price literal at a call site: the sale and the conversion
                  name `_resCinderValue`/`REFINERY_CONVERT_SPREAD` and no digit.
     DUPES        `_campLootContainer` passed `res1.name` to an exclusion filter
                  that compares `r.id`, so the two container slots could always
                  roll the same resource. Drawn, not read.

   ── PROVE IT CAN FAIL ──────────────────────────────────────────────────────
     ECON_TEST_SABOTAGE=sell-promo   promote `flour` with no price. COVERAGE red.
     ECON_TEST_SABOTAGE=sell-pump    double one chain building's yield so its
                                     cycle outsells its inputs. The RATIO pins go
                                     red, ALONE — the parity price of a bigger
                                     yield still floors to 1, so DERIVATION stays
                                     green and the failure is isolated.
     ECON_TEST_SABOTAGE=sell-default re-commit the pre-fix table. COVERAGE,
                                     DERIVATION and the driven ratios all red.
     ECON_TEST_SABOTAGE=sell-asym    🔴 THE ONE THAT MATTERS. Patch the SHIPPED
                                     production.state.js source so collect()
                                     charges its inputs FLAT again — the original
                                     defect, put back — and drive it. The driven
                                     ratio goes red at 4.800×, 56/56 chain
                                     producers Cinder-positive. If this is ever
                                     green, §3b has stopped measuring the payout.
     ECON_TEST_SABOTAGE=sell-cap     patch pending()'s affordability loop back to
                                     FLAT while collect() keeps charging by tf —
                                     the fix's own failure mode. The
                                     promise-vs-charge round goes red with
                                     "promised 6 paid 2".
   ════════════════════════════════════════════════════════════════════════════ */
{
  console.log('\n########## round0t-refinery-pricing ##########');
  let fails = 0;
  const chk = (name, cond, extra) => {
    if (cond) { console.log('✅ ' + name); return true; }
    fails++; console.log('❌ ' + name + (extra ? ' :: ' + extra : '')); return false;
  };

  let IDX = null;
  try { IDX = readFileSync(join(here, '../../public/index.html'), 'utf8'); } catch (e) { IDX = null; }

  const litFrom = (src, decl, open) => {
    const t = srcBlockAfter(src, decl, open);
    if (!t) return null;
    try { return (new Function('return (' + t + ');'))(); } catch (e) { return null; }
  };
  const fnText = (src, name) => {
    if (!src) return null;
    const at = src.indexOf('function ' + name + '(');
    if (at < 0) return null;
    const body = srcBlockAfter(src, 'function ' + name + '(');
    if (!body) return null;
    const bo = src.indexOf('{', src.indexOf(')', at));
    if (bo < 0) return null;
    return src.slice(at, bo) + body;
  };
  const stmtIn = (src, fname, from, to) => {
    const f = fnText(src, fname); if (!f) return null;
    const a = f.indexOf(from); if (a < 0) return null;
    const b = f.indexOf(to, a); if (b < 0) return null;
    return f.slice(a, b);
  };
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  let RES     = litFrom(IDX, 'const RESOURCES = [', '[');
  let VAL     = litFrom(IDX, 'const RESOURCE_CINDER_VALUE = {');
  const VALFN   = fnText(IDX, '_resCinderValue');
  const LISTFN  = fnText(IDX, '_refineryList');
  const GROSS   = stmtIn(IDX, '_refinerySellRes', 'const gross =', ';');
  const YIELDFN = fnText(IDX, '_refineryYield');
  const CONTBLK = stmtIn(IDX, '_campLootContainer', 'const resPool =', '// 🎒 Roll an item');

  let PD = null;
  try { PD = await import('../../public/src/city/production.data.js'); } catch (e) { PD = null; }

  /* 🗺 TERROIR — READ, NEVER TYPED. Revision 1 of this round did not import this
     module at all, which is precisely why it certified a ratio no player gets.
     Every terroir number below comes out of TERROIR_ECON / SEAM_BONUS_MUL /
     stackMul, so retuning terroir.js reprints these pins instead of silently
     invalidating them. */
  let TER = null;
  try { TER = await import('../../public/src/city/terroir.js'); } catch (e) { TER = null; }
  /* …and the PAYOUT PATH itself, as source. The asymmetry is a property of these
     two statements, not of the catalogue, so it is scraped and asserted rather
     than assumed — a future edit that closes it MUST redden this round. */
  let PSRC = null;
  try { PSRC = readFileSync(join(here, '../../public/src/city/production.state.js'), 'utf8'); } catch (e) { PSRC = null; }

  /* 🔴 THE VACUOUS-TRIPWIRE GUARD, same rule as round0p and round0q. Every
     assertion below is over a scraped set; a scrape that matched nothing would
     pass all of them over empty input, and index.html's pricing block promises
     in writing that this round re-derives it. Read fails ⇒ stop. */
  const gotAll =
    chk('read public/index.html and production.data.js',
        !!IDX && IDX.length > 1000000 && !!PD && Array.isArray(PD.CITY_PRODUCTION),
        (IDX ? IDX.length : 'IDX UNREADABLE') + ' / ' + (PD ? 'PD ok' : 'PD UNREADABLE')) &
    chk('extracted RESOURCES / RESOURCE_CINDER_VALUE',
        Array.isArray(RES) && RES.length > 10 && !!VAL && Object.keys(VAL).length > 10,
        [RES && RES.length, VAL && Object.keys(VAL).length].join(' / ')) &
    chk('scraped _resCinderValue / _refineryList / the gross statement / _refineryYield / the container draw',
        !!VALFN && !!LISTFN && !!GROSS && !!YIELDFN && !!CONTBLK,
        ['_resCinderValue', '_refineryList', 'gross stmt', '_refineryYield', 'container draw']
          .filter((n, i) => ![VALFN, LISTFN, GROSS, YIELDFN, CONTBLK][i]).join(', ') + ' NOT FOUND') &
    chk('read terroir.js and production.state.js (the PAYOUT PATH, not the catalogue)',
        !!TER && !!TER.TERROIR_ECON && typeof TER.stackMul === 'function' &&
        typeof TER.SEAM_BONUS_MUL === 'number' && !!PSRC && PSRC.length > 2000,
        [TER ? 'terroir ok' : 'terroir UNREADABLE', PSRC ? 'production.state ok' : 'production.state UNREADABLE'].join(' / '));

  if (!gotAll) {
    console.log('\n🔴 THE SOURCE COULD NOT BE READ — nothing below was checked.');
    console.log('   If a declaration or function was renamed, fix the markers in this round.');
    console.log('   Do NOT delete it: index.html\'s RESOURCE_CINDER_VALUE block promises');
    console.log('   round0t re-derives all 59 prices from CITY_PRODUCTION.');
    bad++; console.log('\n=== ROUND 0t: ' + fails + ' FAILED ===');
  } else {
    /* 🔴 THE HAND-PRICED SET, WRITTEN OUT AS A LITERAL — and it has to be, for
       exactly round0p's reason. The first draft computed the derived set as
       "everything in RESOURCES that is not in RESOURCE_CINDER_VALUE", which is
       empty by construction once the fix is in, so DERIVATION would have been a
       green tick over zero ids. These 11 are the r12 staples whose prices were
       chosen by a person; everything else in the ledger must be derived. */
    const HAND_PRICED = ['food', 'water', 'ammo', 'supplies', 'metal', 'energyDrink',
                         'fuel', 'medicine', 'corruptedEssence', 'memoryShards', 'dna'];

    if (SABOTAGE === 'sell-promo') {
      RES = RES.concat([{ id: 'flour', name: 'Flour', icon: '🌾', color: '#e8d7a0' }]);
      console.log('   🧨 promoted `flour` into RESOURCES without giving it a price');
    }
    if (SABOTAGE === 'sell-default') {
      const v = {}; for (const k of HAND_PRICED) v[k] = VAL[k];
      VAL = v;
      console.log('   🧨 dropped all 59 derived prices — `|| 3` prices the ledger again');
    }

    const RIDS = RES.map(r => r.id);
    const own  = id => Object.prototype.hasOwnProperty.call(VAL, id);

    // ── 1. COVERAGE ───────────────────────────────────────────────────────
    /* WHY the whole ledger and not some subset: `_refineryList()` returns all of
       RESOURCES, so every ledger row is a Sell button. Asserted, not assumed —
       if someone narrows the shelf later this line says so and the requirement
       can be narrowed with it. */
    chk('_refineryList() puts the WHOLE ledger on the shelf, so every ledger id is a sale price',
        /\bRESOURCES\b/.test(strip(LISTFN)), strip(LISTFN).trim());
    const unpriced = RIDS.filter(id => !own(id));
    chk('every id in RESOURCES has an EXPLICIT price (' + RIDS.filter(own).length + ' of ' + RIDS.length + ')',
        unpriced.length === 0, 'no RESOURCE_CINDER_VALUE entry: ' + unpriced.join(', '));

    /* ── 1b. …and the fall-through is MEASURED, not inferred ────────────────
       Evaluate the SHIPPED `_resCinderValue` over a Proxy that answers a poison
       value for any key the table does not own. An id that still reaches the
       fallback comes back poisoned no matter how the fallback is written —
       `|| 3`, `?? 3`, or a named default a later edit introduces. This is the
       version of the check that cannot be outwitted by a rename. */
    const MISS = -999;
    const probe = new Proxy({ ...VAL }, {
      has: () => true,
      get: (t, k) => (Object.prototype.hasOwnProperty.call(t, k) ? t[k] : MISS),
    });
    let priceOf = null;
    try {
      priceOf = new Function('RESOURCE_CINDER_VALUE', VALFN + '\n return _resCinderValue;')(probe);
    } catch (e) { priceOf = null; }
    chk('the shipped _resCinderValue is evaluable (the measurement below is not vacuous)',
        typeof priceOf === 'function' && priceOf('fuel') === VAL.fuel,
        priceOf ? 'fuel -> ' + priceOf('fuel') + ', expected ' + VAL.fuel : 'could not evaluate');
    if (typeof priceOf === 'function') {
      const fellThrough = RIDS.filter(id => priceOf(id) === MISS);
      chk('NO ledger id reaches the `|| 3` fallback — it is a crash guard, not a price (' +
          RIDS.length + ' ids priced from the table)',
          fellThrough.length === 0,
          fellThrough.length + ' ids default: ' + fellThrough.join(', '));
    }

    // ── 2. DERIVATION ─────────────────────────────────────────────────────
    /* Every producer, as {out id → building}. Single-output by construction
       today; the loop is written for the general case so a two-output building
       does not silently pick one. */
    const PRODUCERS = [];
    for (const b of PD.CITY_PRODUCTION) {
      if (!b.yields) continue;
      for (const o of Object.keys(b.yields)) {
        PRODUCERS.push({ def: b.id, out: o, y: b.yields[o], inputs: { ...(b.inputs || {}) },
                         chain: b.id.indexOf('chain_') === 0 });
      }
    }
    if (SABOTAGE === 'sell-pump') {
      const t = PRODUCERS.find(p => p.def === 'chain_timber');
      /* Mutate the CATALOGUE too, not only this round's copy — §3b drives the
         real module against PD.CITY_PRODUCTION, so a pump that only existed in
         a local array would redden §3 and leave the driven round green, which
         would read as "the payout is fine" for a building that is not. */
      const b = PD.CITY_PRODUCTION.find(x => x.id === 'chain_timber');
      if (b && b.yields) b.yields.timber = (b.yields.timber | 0) * 2;
      if (t) { t.y *= 2; console.log('   🧨 doubled chain_timber\'s yield to ' + t.y + ' — one cycle now outsells its inputs'); }
    }
    const byOut = {}; for (const p of PRODUCERS) byOut[p.out] = p;
    /* 🔴 PRICES COME FROM THE SHIPPED FUNCTION, FALLBACK AND ALL — NOT FROM
       `VAL[id] || 0`. The first draft of this round did the latter and the
       `sell-default` sabotage (drop every derived price) left NOT-A-PUMP GREEN:
       a missing entry read as 0, so every ratio came out 0.000 and the round
       cheerfully certified the exact defect it exists for. Driving the sabotage
       is what found it. What a player is actually PAID is `_resCinderValue(id)`,
       so that is what the ratio has to be measured in. */
    const V = (typeof priceOf === 'function')
      ? new Function('RESOURCE_CINDER_VALUE', VALFN + '\n return _resCinderValue;')({ ...VAL })
      : (id => VAL[id] || 0);
    const inValue = p => Object.entries(p.inputs).reduce((s, [i, q]) => s + q * V(i), 0);
    /* The parity rule, in one line. `max(1, …)` is the crash guard the table's
       comment names — a price of 0 would make _refineryYield divide by zero. */
    const parity = p => Math.max(1, Math.floor(inValue(p) / p.y));

    const DERIVED_IDS = RIDS.filter(id => !HAND_PRICED.includes(id));
    chk('the derived-price set is the ledger minus the 11 hand-priced staples (' + DERIVED_IDS.length + ')',
        DERIVED_IDS.length >= 50, String(DERIVED_IDS.length));
    const noProducer = DERIVED_IDS.filter(id => !byOut[id]);
    chk('every derived-price id has a CITY_PRODUCTION producer to derive from',
        noProducer.length === 0, 'no producer: ' + noProducer.join(', '));
    const wrong = DERIVED_IDS.filter(id => byOut[id] && VAL[id] !== parity(byOut[id]))
      .map(id => id + ' shipped ' + VAL[id] + ' derived ' + parity(byOut[id]) +
                 ' (' + inValue(byOut[id]) + '🔥 / ' + byOut[id].y + ')');
    chk('every derived price === max(1, floor(inputValue / yield)) re-derived from the shipped shelf',
        wrong.length === 0, wrong.join(' · '));

    // ── 3. THE CATALOGUE RATIO (base yields — necessary, NOT sufficient) ──
    /* ⚠ THIS IS THE NUMBER REVISION 1 STOPPED AT. It is kept because it is the
       thing the PRICES are derived against and the `sell-pump` sabotage acts on
       it — but on its own it certifies a ratio no player receives. §3b is the
       one that measures what is actually paid out. */
    const ratio = p => (p.y * V(p.out)) / Math.max(1e-9, inValue(p));
    const chainP = PRODUCERS.filter(p => p.chain && inValue(p) > 0);
    const rank = chainP.slice().sort((a, b) => ratio(b) - ratio(a));
    console.log('\n  chain producers — sell the CYCLE OUTPUT vs sell the CYCLE INPUTS (BASE yields)');
    for (const p of rank.slice(0, 5)) {
      console.log('    ' + p.def.padEnd(26) + ' out ' + String(p.y * V(p.out)).padStart(4) +
                  '🔥  in ' + String(inValue(p)).padStart(4) + '🔥  ratio ' + ratio(p).toFixed(3));
    }
    console.log('    … ' + chainP.length + ' chain producers, worst ' + ratio(rank[0]).toFixed(3) +
                ', best ' + ratio(rank[rank.length - 1]).toFixed(3));
    const pumps = chainP.filter(p => ratio(p) > 1.0000001)
      .map(p => p.def + ' ' + ratio(p).toFixed(3) + '×');
    chk('at BASE yields no chain producer is Cinder-positive (' +
        chainP.length + ' producers, worst ' + ratio(rank[0]).toFixed(3) + '× — see §3b, this is NOT what a player gets)',
        pumps.length === 0, pumps.join(', '));

    // ── 3b. 🗺 THE PAYOUT PATH, **DRIVEN** — not modelled, not scraped ─────
    /* 🔴 WHY THIS SECTION WAS REWRITTEN, AND IT IS THE THIRD TIME THIS ROUND HAS
       BEEN WRONG ABOUT THE SAME NUMBER. Revision 1 measured CITY_PRODUCTION's
       base yields and certified "worst 1.000×" — true of the catalogue and true
       of nobody, because the shipped payout multiplies the yield by terroir.
       Revision 2 fixed that by SCRAPING the two statements and MODELLING the
       result as `ratio × tf`, then PINNING the products as fixed-point strings.
       That was honest about an unfixed defect, but it was still arithmetic this
       file did, about code this file only read — and the pins had to be retired
       by hand the moment the defect was fixed or they would certify a shape the
       game no longer has.
       So this section now RUNS THE SHIPPED MODULE. production.state.js is loaded
       from its own source text, given a fake host and a real terroir seed, and
       one 36 h collect is executed per producer. The ratio below is the actual
       ledger delta — units the module SPENT, priced at `_resCinderValue`, versus
       units it BANKED — with nothing in between for this round to get wrong.
       There is no pin left to go stale.

       THE DEFECT IT CAUGHT, and the reason it is worth the machinery:
         pending()  scaled the yield by tf;  collect() charged the inputs FLAT.
         Driven, at the seam (tf 4.800), 36 h / 6 cycles:
           chain_aluminumOre   240🔥 in → 1,152🔥 out    4.800×   (56/56 chain +ve)
           wellhead             90🔥 in → 3,456🔥 out   38.400×   (14/14 legacy +ve)
         After collect() charges by the same tf:
           chain_aluminumOre 1,152🔥 in → 1,152🔥 out    1.000×   ( 0/56 chain +ve)
           wellhead            432🔥 in → 3,456🔥 out    8.000×   ( 8/14, the
           pre-existing hand-catalogue pumps of §4 — terroir no longer multiplies
           them, which is the half that WAS in scope) */

    /* 🎛 EVERY TERROIR NUMBER IS READ, NOT TYPED. Retune terroir.js and this
       reprints. TF_MAX is what the harness below has to actually reach for its
       measurement to mean anything, so it is asserted, not assumed. */
    const MAX_TIER_MUL = Math.max(...Object.keys(TER.TERROIR_ECON.tiers)
      .map(k => TER.TERROIR_ECON.tiers[k].yieldMul));
    const STACK1 = TER.stackMul('food', 1);          // rank 1 = sat^0 = the best rank
    const TF_MAX = MAX_TIER_MUL * TER.SEAM_BONUS_MUL * STACK1;
    /* ⚠ TF_MAX uses the SEAM bonus for every id, including chain ids. Under the
       ten random war-map yield keys (_TW_RES_KEYS) a chain id can never win a
       seam — every alias in TERROIR_ECON.seamAliases resolves to a legacy
       staple. But seamIdFor() returns a raw key that is already a ledger id, and
       node.resourceYield is author-controlled (the TW admin node editor writes
       arbitrary keys), so `{ timber: 10 }` on a node makes timber the seam. The
       worst case is therefore reachable, and measuring at the comfortable case
       is the same mistake as measuring at tf = 1. */

    /* 🔌 THE HOST SEAM, MOUNTED. terroir.js reads window.MythicCityBridge and
       nothing else, so this is the whole of "which ground am I standing on". */
    let SEAM = null, NODE = null;
    globalThis.window = globalThis.window || {};
    globalThis.window.MythicCityBridge = {
      resources: RES,
      terroirSeed: () => (NODE ? { nodeId: NODE, seamKey: SEAM } : null),
    };

    /* 📦 Load production.state.js FROM ITS OWN SOURCE TEXT. Two reasons and both
       matter: (1) it proves the bytes on disk are what ran, the same discipline
       `_resCinderValue` gets in §1b; (2) it is the only way to SABOTAGE the
       shipped payout path, and a round that cannot be made to fail is a comment.
       Relative specifiers do not resolve inside a data: URL, so they are
       rewritten to the very files on disk — the same absolute URLs `import()`
       already used, so Node hands back the SAME module instances and
       PD.CITY_PRODUCTION is one object shared by this round and the code under
       test (which is what makes `sell-pump` reach the driven measurement too). */
    const CITYDIR = new URL('../../public/src/city/', import.meta.url).href;
    const loadPS = (patch) => {
      let src = typeof patch === 'function' ? patch(PSRC) : PSRC;
      src = src.replace(/(from\s*['"])\.\/([\w.\-]+)(['"])/g, (m, a, f, z) => a + CITYDIR + f + z);
      return import('data:text/javascript;charset=utf-8,' + encodeURIComponent(src));
    };

    /* 🧰 The fake host — every legacy binding the module is allowed to touch,
       and a plain object ledger so the delta IS the measurement. Deliberately
       generous (huge stash, huge crew, a level-3 Power Plant placed alongside)
       so that nothing but the input/output arithmetic can move the number. */
    const HOUR = 3600000;
    const mkHost = (seed) => {
      const led = Object.create(null);
      for (const id of RIDS) led[id] = seed;
      let st = { placed: [] };
      return {
        led,
        state: () => st, setState: (s) => { st = s; return true; }, save: () => true,
        getRes: (k) => led[k] | 0,
        addRes: (k, n) => { led[k] = (led[k] | 0) + (n | 0); },
        refundRes: (k, n) => { led[k] = (led[k] | 0) + (n | 0); },
        spendRes: (k, n) => { if ((led[k] | 0) < n) return false; led[k] -= n; return true; },
        resName: (k) => k, resMeta: (k) => ({ id: k, name: k, icon: '📦', color: '#fff' }),
        gems: () => 1e9, addGems: () => true, spendGems: () => true,
        resourceCap: () => 1e9, resourceUnits: () => 0,
        workerPool: () => 100000,
        collectCdMs: 6 * HOUR, accrualCapH: 36,
      };
    };
    /* One 36 h collect (6 cycles) of one building on one ground, measured off
       the ledger. `ground` is null for UNSURVEYED (every id COMMON, tf exactly
       1.000 — the identity terroir.js's own comment calls load-bearing), a node
       id for dealt ground, or the building's own output id to force the seam. */
    const runCollect = (PSMOD, def, ground, seamId, seedUnits) => {
      NODE = ground; SEAM = seamId || null;
      const host = mkHost(seedUnits == null ? 5e6 : seedUnits);
      const st = host.state();
      st.placed = [
        { id: 'pp', defId: 'powerplant', level: 3, lastCollect: Date.now(), buffer: {}, workers: 6, x: 0, y: 0, z: 0, rotation_y: 0, scale: 1 },
        { id: 'sub', defId: def.id, level: 1, lastCollect: Date.now() - 36 * HOUR, buffer: {}, workers: 0, x: 0, y: 0, z: 0, rotation_y: 0, scale: 1 },
      ];
      host.setState(st);
      const out = Object.keys(def.yields)[0];
      const p = st.placed[1];
      const tf = PSMOD.terroirFactor(host, p, out);
      const promised = PSMOD.pending(host, p);
      const before = { ...host.led };
      const r = PSMOD.collect(host, 'sub');
      let inV = 0, outV = 0;
      const spent = {};
      for (const k of RIDS) {
        const d = (host.led[k] | 0) - (before[k] | 0);
        if (d > 0) outV += d * V(k); else if (d < 0) { inV += -d * V(k); spent[k] = -d; }
      }
      return { ok: !!r.ok, why: r.why, tf, promised: promised.cycles | 0, paid: r.cycles | 0,
               inV, outV, spent, ratio: inV > 0 ? outV / inV : (outV > 0 ? Infinity : 0) };
    };

    let PSMOD = null;
    try {
      PSMOD = await loadPS((src) => {
        if (SABOTAGE === 'sell-asym') {
          console.log('   🧨 collect() charges its inputs FLAT again — the terroir asymmetry, put back');
          return src.replace('inputCharge((def.inputs[k] | 0) * (p.level | 0 || 1), pend.cycles, tfIn)',
                             '(def.inputs[k] | 0) * (p.level | 0 || 1) * pend.cycles');
        }
        if (SABOTAGE === 'sell-cap') {
          console.log('   🧨 pending()\'s affordability loop goes back to FLAT while collect() charges by tf');
          return src.replace('let affordable = Math.max(0, Math.floor(have / (per * tfIn)));',
                             'let affordable = Math.max(0, Math.floor(have / per));')
                    .replace('while (affordable > 0 && inputCharge(per, affordable, tfIn) > have) affordable--;', '');
        }
        if (SABOTAGE === 'halt-flat') {
          console.log('   🧨 haltState() measures ONE cycle of inputs FLAT again, while collect() charges by tf');
          const hit = src.replace('const need = inputCharge((inputs[k] | 0) * lvl, 1, tfIn);',
                                  'const need = (inputs[k] | 0) * lvl;');
          if (hit === src) throw new Error('SABOTAGE halt-flat matched nothing — haltState was reshaped and this switch is inert');
          return hit;
        }
        return src;
      });
    } catch (e) { PSMOD = null; }

    const drivable = !!PSMOD && typeof PSMOD.collect === 'function' && typeof PSMOD.pending === 'function' &&
                     typeof PSMOD.terroirFactor === 'function';
    chk('production.state.js — THE SHIPPED PAYOUT PATH — loaded from its own source and is drivable',
        drivable, PSMOD ? 'module loaded but collect/pending/terroirFactor missing' : 'the module did not evaluate');

    if (drivable) {
      const RUNNABLE = PD.CITY_PRODUCTION.filter(b => b.yields && b.inputs && Object.keys(b.inputs).length &&
                                                      Object.keys(b.yields).length);
      const M = [];
      for (const d of RUNNABLE) {
        const out = Object.keys(d.yields)[0];
        M.push({
          def: d.id, out, chain: d.id.indexOf('chain_') === 0,
          flat: runCollect(PSMOD, d, null, null),                  // unsurveyed, tf 1.000
          dealt: runCollect(PSMOD, d, 'round0t-node', null),       // dealt ground, tf 0.15…1.60
          seam: runCollect(PSMOD, d, 'round0t-node', out),         // the seam,   tf 4.800
        });
      }
      const halted = M.filter(m => !m.flat.ok || !m.dealt.ok || !m.seam.ok)
        .map(m => m.def + ' (' + [m.flat, m.dealt, m.seam].filter(x => !x.ok).map(x => x.why).join(' / ') + ')');
      chk('every one of the ' + M.length + ' producers actually RAN a 36 h collect on all three grounds ' +
          '(a halted building measures nothing — this is the vacuity guard)',
          M.length >= 60 && halted.length === 0, halted.slice(0, 5).join(' · '));

      /* The harness must genuinely stand on the worst ground, or "≤ 1.000× at
         MAX_TF" is a claim about somewhere else. */
      const notMax = M.filter(m => Math.abs(m.seam.tf - TF_MAX) > 1e-9)
        .map(m => m.def + ' tf ' + m.seam.tf.toFixed(3));
      chk('the seam run really is the WORST GROUND — measured tf === TF_MAX (tier ×' + MAX_TIER_MUL.toFixed(3) +
          ' × seam ×' + TER.SEAM_BONUS_MUL.toFixed(3) + ' × rank-1 stack ×' + STACK1.toFixed(3) +
          ' = ' + TF_MAX.toFixed(3) + ') for all ' + M.length,
          notMax.length === 0, notMax.slice(0, 5).join(', '));
      const notOne = M.filter(m => Math.abs(m.flat.tf - 1) > 1e-9).map(m => m.def + ' tf ' + m.flat.tf.toFixed(3));
      chk('…and the unsurveyed run is EXACTLY tf 1.000 — the identity terroir.js promises for a player with no node',
          notOne.length === 0, notOne.slice(0, 5).join(', '));

      /* ── 🔴 THE HEADLINE. No pin, no model: the measured ledger delta. ──── */
      const chainM = M.filter(m => m.chain), legacyM = M.filter(m => !m.chain);
      const worstOf = (set, g) => set.reduce((a, m) => Math.max(a, m[g].ratio), 0);
      const posOf = (set, g) => set.filter(m => m[g].ratio > 1.0000001).length;
      console.log('\n  🗺 DRIVEN — one 36 h collect per producer, ledger delta priced at _resCinderValue:');
      console.log('    ground                          chain worst   +ve      legacy worst   +ve');
      for (const [label, g] of [['unsurveyed (tf 1.000)', 'flat'], ['dealt ground', 'dealt'],
                                ['AT THE SEAM (tf ' + TF_MAX.toFixed(3) + ')', 'seam']]) {
        console.log('    ' + label.padEnd(31) + worstOf(chainM, g).toFixed(3).padStart(8) + '×  ' +
                    (posOf(chainM, g) + '/' + chainM.length).padStart(6) + '   ' +
                    worstOf(legacyM, g).toFixed(3).padStart(10) + '×  ' +
                    (posOf(legacyM, g) + '/' + legacyM.length).padStart(6));
      }
      const cPos = [];
      for (const m of chainM) for (const g of ['flat', 'dealt', 'seam']) {
        if (m[g].ratio > 1.0000001) cPos.push(m.def + ' @' + g + ' ' + m[g].ratio.toFixed(3) + '× (tf ' + m[g].tf.toFixed(3) + ')');
      }
      chk('🔴 NO CHAIN PRODUCER IS CINDER-POSITIVE ON ANY GROUND — measured, worst ' +
          Math.max(worstOf(chainM, 'flat'), worstOf(chainM, 'dealt'), worstOf(chainM, 'seam')).toFixed(3) +
          '× over ' + chainM.length + ' producers × 3 grounds (was 4.800×, 56/56, at the seam)',
          cPos.length === 0, cPos.slice(0, 6).join(' · '));

      /* ── TERROIR IS VALUE-NEUTRAL, BOTH DIRECTIONS, AND THE BOUND IS EXACT ─
         Up: good ground must not multiply the ratio — that was the defect, and
         it is the half a reprice could never have reached on the legacy shelf.
         Down: it must not DIVIDE it either. A fix that simply overcharged inputs
         would satisfy the first test and quietly nerf the feature, so the
         downward side is bounded too — and NOT by a hand-picked band.

         🔴 THE BAND USED TO BE `> -0.01` AND THAT WAS A GUESS. It went red on
         chain_beverages (0.718 → 0.701 on SCARCE ground) and the honest reading
         is that integer rounding IS a real cost: `ceil` on the charge against
         `floor` on the yield, and on poor ground the quantities are small enough
         for one unit to be 2.4% of the cycle. So the assertion is now the exact
         thing that is true — the charge sits between the real-valued cost and
         one unit per input leg above it — instead of a tolerance chosen to make
         the observed number pass. Under-charging by even a fraction is a faucet
         and is caught by the same line. */
      const defById = {}; for (const d of RUNNABLE) defById[d.id] = d;
      const amp = [], drift = [];
      for (const m of M) for (const g of ['dealt', 'seam']) {
        const r = m[g], def = defById[m.def];
        if (r.ratio - m.flat.ratio > 1e-6) amp.push(m.def + ' @' + g + ' ' + m.flat.ratio.toFixed(3) + '→' + r.ratio.toFixed(3));
        let exact = 0, oneUnit = 0;
        for (const k of Object.keys(def.inputs)) { exact += (def.inputs[k] | 0) * r.paid * r.tf * V(k); oneUnit += V(k); }
        const over = r.inV - exact;
        if (over < -1e-9) drift.push(m.def + ' @' + g + ' UNDER-charged by ' + (-over).toFixed(3) + '🔥');
        else if (over > oneUnit + 1e-9) drift.push(m.def + ' @' + g + ' over-charged ' + over.toFixed(3) +
                                                   '🔥 > one unit per leg (' + oneUnit + '🔥)');
      }
      chk('terroir CANNOT raise the value ratio of a cycle on any ground — the amplification is gone ' +
          '(' + M.length + ' producers × 2 grounds)',
          amp.length === 0, amp.slice(0, 6).join(' · '));
      chk('…and the charge is EXACTLY inputs × cycles × tf, rounded up — never under (a faucet) and never ' +
          'more than one unit per input leg over (a stealth nerf)',
          drift.length === 0, drift.slice(0, 6).join(' · '));
      /* The ε inside inputCharge, driven. 1.6 is 1.6000000000000000888 in IEEE
         754, so 10 × 6 × 1.6 evaluates to 96.00000000000001 and a bare ceil
         takes 97 — one unit of silent over-charge per collect on COMMON-rich
         ground, i.e. on most of the map. */
      chk('inputCharge() snaps IEEE noise instead of billing it — 10 × 6 × tf 1.6 charges 96, not 97',
          typeof PSMOD.inputCharge === 'function' && PSMOD.inputCharge(10, 6, 1.6) === 96,
          typeof PSMOD.inputCharge === 'function' ? 'charged ' + PSMOD.inputCharge(10, 6, 1.6) : 'inputCharge is not exported');

      /* ── THE PROMISE AND THE CHARGE ARE ONE NUMBER ────────────────────────
         🔴 THE BUG THIS EXISTS FOR IS THE FIX'S OWN FAILURE MODE. `pending()`
         decides how many cycles it can afford and `collect()` charges for them.
         Scale one by tf and not the other and the panel banks "🥫 270 (6
         cycles)" and the Collect button answers "Not enough Water" — the exact
         regression production.state.js documents at its inputCap loop. Driven on
         a DELIBERATELY SHORT ledger, on rich ground, where the two disagree. */
      const short = [];
      for (const d of RUNNABLE) {
        const out = Object.keys(d.yields)[0];
        const per = Math.max(...Object.values(d.inputs).map(n => n | 0));
        // Enough for ~2 cycles at tf 4.8 and nowhere near 6 — the band where a
        // flat affordability check over-promises by a factor of tf.
        const r = runCollect(PSMOD, d, 'round0t-node', out, Math.ceil(per * 2 * TF_MAX));
        if (!r.ok) { short.push(d.id + ' REFUSED: ' + r.why); continue; }
        if (r.promised !== r.paid) short.push(d.id + ' promised ' + r.promised + ' paid ' + r.paid);
      }
      chk('on a SHORT ledger every producer pays exactly the cycles pending() promised — the promise and ' +
          'the charge are the same number (' + RUNNABLE.length + ' producers)',
          short.length === 0, short.slice(0, 6).join(' · '));

      /* ── §3c THE HALT REASON IS THE THIRD SURFACE THAT QUOTES THE CHARGE ───
         🔴 AND IT IS THE ONE THAT CAN STOP A BUILDING DEAD.
         `pending()` opens with `if (!halt.running || cycles <= 0) return
         { cycles: 0 … }` — so haltState's NO_INPUTS verdict does not merely
         explain a stall, IT CAUSES ONE. It measures ONE cycle of inputs, and it
         has to measure that cycle at the SAME terroir factor collect() will
         charge, or the two disagree in whichever direction the ground leans:

           tf < 1 (POOR ground)  the flat figure is BIGGER than the real charge,
                                 so a player who can afford the cycle is told
                                 "⛔ NO WATER" and pending() returns 0 cycles.
                                 THE BUILDING IS STOPPED AND PAYS NOTHING, on
                                 exactly the ground that is already worst for
                                 them. This is the harm; the other direction is
                                 only a wrong number on a panel.
           tf > 1 (RICH ground)  the flat figure is SMALLER, so haltState says
                                 "running" for a cycle collect() cannot fund.
                                 pending()'s affordability loop then clamps it to
                                 0 anyway, so the player is not robbed — they are
                                 shown a running building that produces nothing
                                 and told no reason.

         SO BOTH DIRECTIONS ARE ASSERTED, at the exact boundary: seed each input
         leg with EXACTLY `inputCharge(perCycle × lvl, 1, tf)` and the building
         must run and pay one cycle; seed one unit less on every leg and it must
         halt with NO_INPUTS. A round that only tested "enough" or only tested
         "nothing" cannot see a threshold that has moved by a factor of tf.

         CALLER MIRRORED: `pending()`'s own `haltState(host, p)` call at the top
         of the payout path, and production.render.js:119's `pend.halt ||
         haltState(host, p)` — the panel line the player reads. Driven through
         PSMOD, the module loaded from the shipped source, on the same two
         grounds §3b measures.
         🧨 halt-flat re-commits the pre-fix statement into that source. */
      {
        const HALT_NO_INPUTS = (PSMOD.HALT && PSMOD.HALT.NO_INPUTS) || 'NO_INPUTS';
        /* One probe: one building, one ground, every input leg seeded to the
           scaled one-cycle charge plus `delta`. The powerplant is present for
           the same reason runCollect places one — so nothing halts on power. */
        const haltProbe = (def, ground, seamId, delta) => {
          NODE = ground; SEAM = seamId || null;
          const host = mkHost(0);
          const st = host.state();
          st.placed = [
            { id: 'pp', defId: 'powerplant', level: 3, lastCollect: Date.now(), buffer: {}, workers: 6, x: 0, y: 0, z: 0, rotation_y: 0, scale: 1 },
            { id: 'sub', defId: def.id, level: 1, lastCollect: Date.now() - 36 * HOUR, buffer: {}, workers: 0, x: 0, y: 0, z: 0, rotation_y: 0, scale: 1 },
          ];
          host.setState(st);
          const p = st.placed[1];
          const tf = PSMOD.inputTerroirScale(host, p, def);
          for (const k in (def.inputs || {})) {
            host.led[k] = Math.max(0, PSMOD.inputCharge((def.inputs[k] | 0) * 1, 1, tf) + delta);
          }
          const halt = PSMOD.haltState(host, p);
          const pend = PSMOD.pending(host, p);
          const r = PSMOD.collect(host, 'sub');
          return { tf, code: halt && halt.code, running: !!(halt && halt.running),
                   cycles: pend.cycles | 0, ok: !!r.ok, paid: r.cycles | 0, why: r.why };
        };
        const atThreshold = [], belowThreshold = [];
        let probes = 0, poor = 0, rich = 0;
        for (const d of RUNNABLE) {
          for (const [g, s] of [['round0t-node', null], ['round0t-node', Object.keys(d.yields)[0]]]) {
            const on = haltProbe(d, g, s, 0);
            probes++;
            if (on.tf < 1 - 1e-9) poor++; else if (on.tf > 1 + 1e-9) rich++;
            if (on.code === HALT_NO_INPUTS) {
              atThreshold.push(d.id + ' @tf ' + on.tf.toFixed(3) + ' halt=' + on.code +
                               ' cycles=' + on.cycles + ' collect=' + (on.ok ? 'ok×' + on.paid : String(on.why).slice(0, 48)));
            }
            const under = haltProbe(d, g, s, -1);
            if (under.code !== HALT_NO_INPUTS) {
              belowThreshold.push(d.id + ' @tf ' + under.tf.toFixed(3) + ' halt=' + under.code + '/' + under.running);
            }
          }
        }
        console.log('\n  ⛔ HALT THRESHOLD — ' + probes + ' producer×ground probes, ' + poor +
                    ' on ground POORER than 1.000 and ' + rich + ' richer');
        chk('§3c/halt the probe really stood on ground where terroir MOVES the charge (' + poor + ' poor, ' + rich + ' rich)',
            poor + rich > 0 && probes >= 60,
            'every probe landed at tf 1.000, so a flat halt figure and a scaled one are the same number ' +
            'and this section proves nothing');
        /* ⚠ THE ASSERTION IS ON haltState's VERDICT, NOT ON collect() SUCCEEDING,
           and the difference was measured rather than assumed. Seeding exactly
           `inputCharge(per, 1, tf)` and demanding a paid cycle went red on 42 of
           140 probes at tf 4.800 — because pending()'s affordability floor reads
           `Math.floor(have / (per * tfIn))`, and inputCharge's ε-snap can return
           a `have` that is 96 against a `per * tfIn` of 96.00000000000001, so the
           floor is 0 for a player holding EXACTLY what they will be charged.
           That is a real (small, pre-existing) edge in the affordability floor
           and it is NOT what this section is about — asserting it here would put
           a red round on a defect this package did not touch and cannot fix.
           What is asserted is the thing the hunk changed: where haltState draws
           the line. */
        chk('§3c/halt a player holding EXACTLY one cycle\'s scaled charge is NOT halted for NO_INPUTS ' +
            '(' + probes + ' probes)',
            atThreshold.length === 0,
            atThreshold.slice(0, 5).join(' · ') +
            ' — on poor ground a flat halt figure is BIGGER than the real charge, so it stops a building ' +
            'the player can afford to run, and pending() returns 0 cycles for it');
        chk('§3c/halt …and one unit short on every leg DOES halt with NO_INPUTS (' + probes + ' probes)',
            belowThreshold.length === 0,
            belowThreshold.slice(0, 5).join(' · ') +
            ' — on rich ground a flat halt figure is SMALLER than the real charge, so the panel calls a ' +
            'building "running" for a cycle collect() cannot fund');
      }

      /* ── THE LEGACY SHELF, MEASURED AT THE SEAM ───────────────────────────
         The hand catalogue's base pumps are PRE-EXISTING and out of scope (§4
         pins them to the Cinder). What was in scope was terroir multiplying
         them, and this is that number: the Wellhead was 38.400× at the seam. */
      const wh = M.find(m => m.def === 'wellhead');
      if (wh) console.log('\n  wellhead (the worst legacy pump) — unsurveyed ' + wh.flat.ratio.toFixed(3) +
                          '× · at the seam ' + wh.seam.ratio.toFixed(3) + '× (was 38.400× — §4 pins the base)');
      const legAmp = legacyM.filter(m => m.seam.ratio - m.flat.ratio > 1e-6).map(m => m.def);
      chk('the LEGACY shelf is fixed by the same edit — terroir no longer multiplies the pre-existing pumps ' +
          '(' + legacyM.length + ' producers, worst at the seam ' + worstOf(legacyM, 'seam').toFixed(3) +
          '×, unchanged from unsurveyed ' + worstOf(legacyM, 'flat').toFixed(3) + '×)',
          legAmp.length === 0, legAmp.join(', '));
    }

    // ── 4. THE PINNED LEGACY BASELINE, PER BUILDING ───────────────────────
    /* 🔴 THESE ARE PRE-EXISTING AND THEY ARE NOT FIXED. The hand-written catalog
       has been Cinder-positive since it shipped — the Wellhead turns 5 supplies
       (15 🔥) into 60 water (120 🔥), 8.000× before terroir and 38.400× on a
       seamed node. Repricing food/water/metal is a camp-wide balance change and
       it is not this round's; silently leaving it unmeasured is how it stayed
       invisible. So it is pinned AS INTEGERS (out 🔥 / in 🔥 — no float compare,
       nothing to drift), which makes the pre-existing pumps a written-down
       number that cannot grow, and stops a NEW legacy producer hiding inside a
       known-bad set. §3c pins what terroir then multiplies these by. */
    const LEGACY_PIN = {
      wellhead:   [120, 15], refinery:    [152, 76], depot:     [150, 94],
      hydroponics: [90, 60], foundry:     [120, 80], sump:       [64, 50],
      apothecary:  [90, 70], timberyard:  [55, 48],
    };
    const legacyP = PRODUCERS.filter(p => !p.chain && inValue(p) > 0);
    const legacyPos = {};
    for (const p of legacyP) if (ratio(p) > 1.0000001) legacyPos[p.def] = [p.y * V(p.out), inValue(p)];
    const pinKeys = Object.keys(LEGACY_PIN).sort(), posKeys = Object.keys(legacyPos).sort();
    console.log('\n  legacy (hand-priced) producers that are Cinder-positive — PRE-EXISTING, pinned:');
    for (const k of posKeys) console.log('    ' + k.padEnd(14) + ' out ' + String(legacyPos[k][0]).padStart(4) +
                                         '🔥  in ' + String(legacyPos[k][1]).padStart(4) + '🔥  ratio ' +
                                         (legacyPos[k][0] / legacyPos[k][1]).toFixed(3));
    chk('the pre-existing legacy pumps are EXACTLY the pinned set, to the Cinder (' + posKeys.length + ')',
        pinKeys.length === posKeys.length &&
        pinKeys.every(k => legacyPos[k] && legacyPos[k][0] === LEGACY_PIN[k][0] && legacyPos[k][1] === LEGACY_PIN[k][1]),
        'pinned [' + pinKeys.join(',') + '] observed [' + posKeys.join(',') + ']' +
        posKeys.filter(k => LEGACY_PIN[k] && (legacyPos[k][0] !== LEGACY_PIN[k][0] || legacyPos[k][1] !== LEGACY_PIN[k][1]))
          .map(k => ' · ' + k + ' ' + JSON.stringify(legacyPos[k]) + ' vs pinned ' + JSON.stringify(LEGACY_PIN[k])).join(''));

    // ── 5. RULE 4 — no price literal at a call site ───────────────────────
    /* 0 and 1 are structural everywhere in this file (guards, `| 0`, array
       indices); any OTHER digit in a pricing expression is a number that
       escaped the table, which is how `|| 3` became the price of 59 goods. */
    const onlyStructural = s => !(strip(s).replace(/\b[01]\b/g, '').match(/\d/));
    chk('the SALE reads its price from _resCinderValue and names no number',
        /_resCinderValue\s*\(/.test(strip(GROSS)) && onlyStructural(GROSS), strip(GROSS).trim());
    chk('the CONVERSION prices both legs through _resCinderValue and takes its cut from config',
        /_resCinderValue\s*\(/.test(strip(YIELDFN)) && /REFINERY_CONVERT_SPREAD/.test(strip(YIELDFN)) &&
        onlyStructural(YIELDFN), strip(YIELDFN).trim());

    // ── 6. THE CONTAINER'S DUPLICATE EXCLUSION, DRAWN ─────────────────────
    /* Evaluate the shipped draw. `_lootResRows` is stubbed with a WEIGHTED bag
       (rows repeat, which is how the real one encodes weights) so the filter has
       to remove every copy, and with names that differ from ids — which is the
       whole bug: `pick(res1.name)` was filtered against `r.id`. */
    const rows = [];
    for (const r of RES.slice(0, 8)) for (let i = 0; i < 3; i++) rows.push({ id: r.id, name: r.name, icon: r.icon, color: r.color });
    const mkDraw = (body) => {
      try { return new Function('_lootResRows', 'cont', body + '\n return [res1, res2];'); }
      catch (e) { return null; }
    };
    const draw = mkDraw(CONTBLK);
    chk('the shipped container draw is evaluable', !!draw, 'could not compile the scraped block');
    if (draw) {
      const cont = { resMin: 1, resMax: 5 };
      let dupes = 0, n = 20000, nulls = 0;
      for (let i = 0; i < n; i++) {
        const [a, b] = draw(() => rows, cont);
        if (!a || !b) { nulls++; continue; }
        if (a.id === b.id) dupes++;
      }
      chk('the container rolls TWO DIFFERENT resources — the exclusion actually excludes (' +
          n.toLocaleString('en-US') + ' draws, ' + dupes + ' duplicates)',
          dupes === 0 && nulls === 0, dupes + ' duplicate pairs, ' + nulls + ' null draws');
      /* …and the check is not vacuous: put the DEFECT back — pass the display
         name to a filter that compares ids — and the same measurement must find
         duplicates at ~1/8 of draws. A tripwire nobody has driven is a comment. */
      const broken = mkDraw(CONTBLK.replace('pick(res1 ? res1.id : null)', 'pick(res1 ? res1.name : null)'));
      let bd = 0;
      if (broken && CONTBLK.indexOf('res1.id') >= 0) {
        for (let i = 0; i < 20000; i++) { const [a, b] = broken(() => rows, { resMin: 1, resMax: 5 }); if (a && b && a.id === b.id) bd++; }
      }
      chk('…and that measurement CAN fail — the pre-fix `res1.name` draw duplicates (' +
          (bd / 200).toFixed(2) + '% of draws)',
          bd > 1000, 'the name/id sabotage produced ' + bd + ' duplicates; the check may be vacuous');
    }
  }

  if (fails) { bad++; console.log('\n=== ROUND 0t: ' + fails + ' FAILED ==='); }
  else console.log('\n=== ROUND 0t: ALL PASS ===');
}

/* ════════════════════════════════════════════════════════════════════════════
   ROUND 0u — 🏗 A SWALLOWED POSTGREST ERROR MAY NOT BUY A SECOND FREE LICENCE
   ----------------------------------------------------------------------------
   THE ONLY ROUND HERE THAT GUARDS A WRITE TO THE DATABASE, and the reason it is
   the worst of the three defects this package closed: everything else in this
   file bounds Cinder inside a simulation that a reload can re-derive. This one
   ends with `Cloud.client.from('corp_operations').insert(…)` — a permanent row
   that nothing in the codebase ever removes.

   THE MECHANISM, and it is two ordinary bugs meeting:
     1. supabase-js RESOLVES on failure. An RLS refusal, a bad column or a 5xx
        comes back as `{ data: null, error: {…} }`; it does not throw. `opFetch`
        read that with `if (r && !r.error && Array.isArray(r.data)) cloud = r.data;`
        — no else — so an error response left `cloud` as `[]` and continued down
        the success path.
     2. The caller then ran `try { await opFetch(); Operations.fetchFailed = false; }`,
        recording a SUCCESSFUL read of a table it had never read.
   The city therefore sees no Construction Co., the free-licence auto-grant that
   this session added fires, and a duplicate row is written beside the one that
   was already there.

   MEASURED against the shipped source before the fix, `{code:'42501', message:
   'permission denied for table corp_operations'}` and a player who already held
   the cloud licence:
       healthy read → fetchFailed false, 1 row visible, grant refused,  0 written
       error  read  → fetchFailed FALSE, 0 rows visible, grant ISSUED,  1 WRITTEN
                      and it returned {ok:true, existed:false}

   🔴 THE PRODUCTION CALL SHAPE, because that is the whole lesson of this
      package. Nothing below is re-typed: `opFetch`, `_opCreateLocal`,
      `_opsAllRows`, `_jbLocalOpsList` and `cityOpsGrantFree` are all read out of
      public/index.html and compiled, and the caller is the literal
      `try { await opFetch(); … }` line lifted out of corpFetchMine. The stubs
      are only the Supabase client, the profile and the econ table. If any of
      those functions changes shape, this round reads the new shape.

   Prove it can fail — each switch re-commits one half of the shipped defect
   into the extracted source and nothing else:
     ECON_TEST_SABOTAGE=ops-swallow        opFetch records success on an error
                                           response (the `fetchFailed = false`
                                           the caller used to do)
     ECON_TEST_SABOTAGE=ops-grant-unknown  the grant drops its `unknown-state`
                                           refusal and writes against a list it
                                           cannot vouch for
     ECON_TEST_SABOTAGE=licence-paywalled  §8 only: the 350,000 🔥 fee goes back
                                           into OPS_ECON and the override clamp
                                           is deleted. §1-§7 stay GREEN under
                                           it, on purpose — they stub the price,
                                           which is exactly why §8 had to exist
   ════════════════════════════════════════════════════════════════════════════ */
{
  console.log('\n########## round0u-free-licence-against-an-unknown-read ##########');
  let fails = 0;
  const chk = (name, cond, extra) => {
    if (cond) { console.log('✅ ' + name); return true; }
    fails++; console.log('❌ ' + name + (extra ? ' :: ' + extra : '')); return false;
  };
  const IDX = join(here, '../../public/index.html');
  const idxSrc = readFileSync(IDX, 'utf8');
  const blk = (decl) => srcBlockAfter(idxSrc, decl);

  const SRC = {
    opFetch:        blk('async function opFetch()'),
    grant:          blk('window.cityOpsGrantFree = async function (opType)'),
    createLocal:    blk('async function _opCreateLocal(opType, cost, fundedBy)'),
    allRows:        blk('function _opsAllRows()'),
    localList:      blk('function _jbLocalOpsList()'),
    /* §7's subject: the zero-price branch of the Just Business "Found" button.
       `construction` is startup 0 in OPS_ECON, so a real click lands here. */
    found:          blk('if ((e.startup | 0) <= 0)'),
  };
  const missing = Object.keys(SRC).filter((k) => !SRC[k]);
  chk('round0u can read all six shipped functions out of public/index.html',
      !missing.length, 'unreadable: ' + missing.join(', ') + ' — a declaration was renamed and this round is vacuous');

  /* 🧨 §7's switches are applied HERE, to the extracted source itself, rather
     than inside build() where the older two live. §7f is a TEXT assertion, so
     an injury that only reached the compiled copy would leave that check
     reading the healthy file and passing — a switch that cannot turn its own
     assertion red is the same vacuous-green shape this round exists to end.
       ops-found-inline     the delegation is replaced by the old inline create
       ops-found-unguarded  …and _opCreateLocal's write-seam refusal goes too,
                            which together are exactly the branch that shipped */
  if (!missing.length && (SABOTAGE === 'ops-found-inline' || SABOTAGE === 'ops-found-unguarded')) {
    const inlined = SRC.found.replace(
      /const _g = \(typeof window\.cityOpsGrantFree === 'function'\)[\s\S]*?: \{ ok: false, error: 'no-grant-fn' \};/,
      "const _g = { ok: await _opCreateLocal(a.op, 0, 'free-licence'), existed: false };");
    if (inlined === SRC.found) throw new Error('SABOTAGE ' + SABOTAGE + ' matched nothing — the delegation was reshaped and this switch is inert');
    SRC.found = inlined;
  }
  if (!missing.length && SABOTAGE === 'ops-found-unguarded') {
    const unguarded = SRC.createLocal.replace(
      /if \(\(cost \| 0\) <= 0 && fundedBy === 'free-licence'[\s\S]*?return false;\s*\}/, '');
    if (unguarded === SRC.createLocal) throw new Error('SABOTAGE ops-found-unguarded matched nothing — the write-seam refusal was reshaped and this switch is inert');
    SRC.createLocal = unguarded;
  }

  /* THE CALLER, lifted rather than written. corpFetchMine is the path that
     decides whether the app believes it knows the player's operations, and the
     defect was half in that line. Asserting on its TEXT is what stops somebody
     re-adding `Operations.fetchFailed = false` after the await.

     🔴 WHAT THIS ANCHOR COST, and why it is not `find(/^try \{ await opFetch\(\);/)`
        any more. That regex matches THREE lines in public/index.html, and
        `find()` returns the FIRST — the tail of `_opCreateLocal`
        (`try { await opFetch(); } catch (e) {}`), roughly 1200 lines ABOVE
        corpFetchMine. So both text assertions below were reading a line that
        never had the defect and never could, and `runCaller` was compiled from
        the wrong call site. MEASURED: half of the defect was re-committed on
        the real corpFetchMine line —
          `try { await opFetch(); Operations.fetchFailed = false; } catch (e) {…}`
        — and this round printed ALL PASS and the whole gauntlet went green,
        with the bug sitting in the shipped file. A round that certifies a seam
        production does not use certifies nothing.

     THE ANCHOR IS NOW THE CATCH BODY, which is unique to corpFetchMine: it is
     the only caller in the file that resets `Operations.list` and raises
     `fetchFailed` when opFetch throws. Matching on `await opFetch();` anywhere
     in the line (not anchored at ^) also means re-adding the assignment cannot
     slide the match off this line and quietly pass. And we assert there is
     EXACTLY ONE — if a second caller ever grows that catch body, this round
     must be pointed at the right one deliberately rather than silently taking
     whichever came first. */
  const callerCands = idxSrc.split('\n').map((l) => l.trim())
    .filter((l) => /await opFetch\(\);/.test(l) && /Operations\.list = \[\]; Operations\.fetchFailed = true;/.test(l));
  chk('exactly one corpFetchMine caller line, and this round reads it',
      callerCands.length === 1,
      'found ' + callerCands.length + ' candidates — this round is reading the wrong call site: ' +
      JSON.stringify(callerCands));
  const callerLine = callerCands[0];
  chk('…and the corpFetchMine caller line is still there to be read', !!callerLine, String(callerLine));
  chk('…and it no longer clears fetchFailed after the await (that WAS half the defect)',
      !!callerLine && !/await opFetch\(\);\s*Operations\.fetchFailed\s*=\s*false/.test(callerLine),
      callerLine);

  /* `callerLine` gates the harness too: runCaller is COMPILED from it, so an
     unresolved anchor must fail the round above rather than compile the string
     "undefined" and throw something unrelated halfway down. */
  if (!missing.length && callerLine) {
    /* One PostgREST error shape, used everywhere below. Resolves. Never throws
       — which is the entire point and what the old code assumed away. */
    const PG_ERR = { data: null, error: { code: '42501', message: 'permission denied for table corp_operations' } };

    const build = (opts) => {
      const o = opts || {};
      const state = {
        inserts: 0,                       // real corp_operations.insert() calls
        toasts: [],                       // what the player was actually told
        Operations: { list: [], _fetched: 0, fetchFailed: false },
        Profile: { jbLocalOps: [], cloud: { signedIn: o.signedIn !== false } },
        Corp: { mine: o.noCorp ? null : { id: 'corp-1' }, _memberErr: o.memberErr || null },
      };
      const cloudRows = o.cloudHas ? [{ id: 'cloud-1', corp_id: 'corp-1', op_type: 'construction', workers: 0, level: 1, meta: {} }] : [];
      state.Cloud = { client: { from: () => ({
        select: () => ({ eq: () => ({ limit: async () => (o.readFails ? PG_ERR : { data: cloudRows, error: null }) }) }),
        insert: async (row) => { state.inserts++; cloudRows.push({ id: 'cloud-' + state.inserts, ...row }); return { data: null, error: null }; },
      }) } };
      let src = SRC;
      if (SABOTAGE === 'ops-swallow') {
        /* 🧨 THE SHIPPED BEHAVIOUR, re-committed: a read that failed is recorded
           as a read that succeeded. This is precisely `fetchFailed = false`
           after the await plus the missing `else` on the error branch. */
        src = { ...src, opFetch: src.opFetch.replace('Operations.fetchFailed = !cloudOk;', 'Operations.fetchFailed = false;')
                                            .replace('if (cloudOk) Operations._fetched = Date.now();', 'Operations._fetched = Date.now();') };
      }
      if (SABOTAGE === 'ops-grant-unknown') {
        /* 🧨 The other half: grant against a list we cannot vouch for. */
        src = { ...src, grant: src.grant.replace(/if \(!known\(\)\) return \{ ok: false, error: 'unknown-state' \};/, '') };
      }
      /* index.html publishes the grant as `window.cityOpsGrantFree`, and the
         Found branch reaches it THROUGH window — so the harness carries a real
         window object and the branch resolves it exactly as production does.
         `noGrantFn` leaves it unpublished to exercise the missing-helper
         fallback, which must REFUSE rather than fall back to the old create. */
      const win = {};
      const env = {
        Operations: state.Operations, Profile: state.Profile, Corp: state.Corp, Cloud: state.Cloud,
        initCloud: () => true, saveProfile: () => {},
        showToast: (t) => { state.toasts.push(String(t)); },
        _opsAdoptOwnedCompanies: () => {}, _opAfterFound: () => {}, _jbSendData: () => {},
        _opEcon: (t) => (t === 'construction' ? { startup: 0, maxWorkers: 6 } : null),
        OP_LABELS: { construction: 'Construction Co.' },
        Date: global.Date,
        window: win,
        NO_GRANT_FN: !!o.noGrantFn,
      };
      const names = Object.keys(env);
      const api = new Function(...names, `
        function _jbLocalOpsList() ${src.localList}
        function _opsAllRows() ${src.allRows}
        async function opFetch() ${src.opFetch}
        async function _opCreateLocal(opType, cost, fundedBy) ${src.createLocal}
        const cityOpsGrantFree = async function (opType) ${src.grant};
        if (!NO_GRANT_FN) window.cityOpsGrantFree = cityOpsGrantFree;
        /* THE PRODUCTION CALL SHAPE of the Found button: 'a' is the action
           object the Just Business click handler posts, 'e' is _opEcon(a.op)
           computed one line above the branch. The branch body is verbatim;
           only the wrapper handing it 'a' and 'e' is ours. */
        async function opFoundBranch(a) {
          const e = _opEcon(a.op);
          ${src.found.replace(/^\{/, '').replace(/\}$/, '')}
          return 'fell-through';
        }
        return { opFetch, grant: cityOpsGrantFree, rows: _opsAllRows, opFound: opFoundBranch };
      `)(...names.map((n) => env[n]));
      return { state, api };
    };

    /* The production caller, verbatim from corpFetchMine — compiled from the
       line read above so it cannot drift away from what ships. */
    const runCaller = new Function('opFetch', 'Operations', 'return (async () => { ' + callerLine + ' })();');

    const scenario = async (label, opts) => {
      const { state, api } = build(opts);
      await runCaller(api.opFetch, state.Operations);
      const g = await api.grant('construction');
      const held = api.rows().filter((r) => r && r.op_type === 'construction').length;
      console.log('   ' + label.padEnd(42) + ' fetchFailed=' + String(state.Operations.fetchFailed).padEnd(5) +
                  ' visible=' + api.rows().length + ' inserts=' + state.inserts +
                  ' grant=' + JSON.stringify(g));
      return { ...state, grant: g, held, api };
    };

    // ── 1. THE HEALTHY CONTROL. Nothing may regress for the ordinary player. ──
    const okHeld = await scenario('healthy read, player HAS the licence', { cloudHas: true });
    chk('a healthy read reports success', okHeld.Operations.fetchFailed === false);
    chk('…and the grant sees the existing licence and writes nothing',
        okHeld.grant.ok === true && okHeld.grant.existed === true && okHeld.inserts === 0,
        JSON.stringify(okHeld.grant) + ' inserts ' + okHeld.inserts);

    // ── 2. THE DEFECT. An error response, and a player who already holds it. ──
    const bad = await scenario('🔴 PostgREST {error}, player HAS it', { cloudHas: true, readFails: true });
    chk('a PostgREST {error} response is recorded as a FAILED fetch',
        bad.Operations.fetchFailed === true,
        'fetchFailed=' + bad.Operations.fetchFailed + ' — the app believes it read a table it never read');
    chk('…and NO free licence is granted while the player\'s licences are unknown',
        bad.grant.ok === false && bad.grant.error === 'unknown-state',
        JSON.stringify(bad.grant));
    chk('…and NOT ONE corp_operations row is written',
        bad.inserts === 0 && bad.Profile.jbLocalOps.length === 0,
        'inserts ' + bad.inserts + ', local rows ' + bad.Profile.jbLocalOps.length +
        ' — a duplicate permanent licence, from a transient RLS blip');

    // ── 3. THE SAME HOLE ONE TABLE UPSTREAM: corp_members errored, so Corp.mine
    //       is null for a player who may well be in a corp with a licence. ──
    const memErr = await scenario('🔴 corp_members read errored', { noCorp: true, memberErr: 'permission denied' });
    chk('a failed corp_members lookup also counts as an unknown read',
        memErr.Operations.fetchFailed === true, 'fetchFailed=' + memErr.Operations.fetchFailed);
    chk('…and it grants nothing either',
        memErr.grant.ok === false && memErr.inserts === 0,
        JSON.stringify(memErr.grant) + ' inserts ' + memErr.inserts);

    // ── 4. IDEMPOTENCE, run twice, against the real _opCreateLocal. ──
    const { state: st4, api: api4 } = build({ cloudHas: false });
    await runCaller(api4.opFetch, st4.Operations);
    const g4a = await api4.grant('construction');
    const g4b = await api4.grant('construction');
    const rows4 = api4.rows().filter((r) => r && r.op_type === 'construction').length;
    console.log('   grant ×2 on a clean empty read           inserts=' + st4.inserts +
                ' rows=' + rows4 + ' first=' + JSON.stringify(g4a) + ' second=' + JSON.stringify(g4b));
    chk('a new player IS granted the free licence on a trustworthy read',
        g4a.ok === true && g4a.existed === false, JSON.stringify(g4a));
    chk('…and running the grant again writes NOTHING more — exactly one licence exists',
        g4b.ok === true && g4b.existed === true && st4.inserts === 1 && rows4 === 1,
        'inserts ' + st4.inserts + ', rows ' + rows4 + ', second ' + JSON.stringify(g4b));

    // ── 5. …and idempotence holds for a player who ALREADY held it, twice. ──
    const { state: st5, api: api5 } = build({ cloudHas: true });
    await runCaller(api5.opFetch, st5.Operations);
    const g5a = await api5.grant('construction');
    const g5b = await api5.grant('construction');
    const rows5 = api5.rows().filter((r) => r && r.op_type === 'construction').length;
    console.log('   grant ×2, player already holds it        inserts=' + st5.inserts + ' rows=' + rows5);
    chk('…and a player who already holds it gets no second row from two grants',
        st5.inserts === 0 && rows5 === 1 && g5a.existed === true && g5b.existed === true,
        'inserts ' + st5.inserts + ', rows ' + rows5);

    /* ── 6. A FAILED READ MAY NOT DELETE THE PLAYER'S OWN OPERATION EITHER.
           opFetch de-dupes locals against the corp list; doing that on a read
           that failed drops a real local row on the floor. */
    const { state: st6, api: api6 } = build({ cloudHas: true, readFails: true });
    st6.Profile.jbLocalOps.push({ id: 'local_mining_1', op_type: 'mining', meta: {} });
    await runCaller(api6.opFetch, st6.Operations);
    chk('a failed read does not silently drop the player\'s own local operations',
        st6.Profile.jbLocalOps.length === 1 && api6.rows().some((r) => r.op_type === 'mining'),
        'locals ' + st6.Profile.jbLocalOps.length + ', visible ' + JSON.stringify(api6.rows().map((r) => r.op_type)));

    /* ══ 7. THE FOURTH ROUTE — the Just Business "Found" button ═══════════════
       🔴 WHY THIS SECTION EXISTS. §§1-6 above were green, and the duplicate row
          was still one click away in production. The scope that produced them
          named `cityOpsGrantFree / opsAcquireFree / opsGrantNodeLicences`; the
          city's three entry points were correctly funnelled into the first
          (node-city :24321 → `P.cityOpsGrantFree`) and the work stopped at the
          edge of that list. `opFound` reaches the SAME
          `_opCreateLocal(a.op, 0, 'free-licence')` INSERT by a different door
          and never asked whether the books could be read.
       MEASURED against the shipped source before this fix, `{code:'42501'}`,
       player already holding the cloud licence:
           cityOpsGrantFree  error → fetchFailed=true, INSERTS=0, unknown-state
           opFound           error → fetchFailed=true, INSERTS=1, and the player
                                     was toasted "licence issued — free"
       fetchFailed was CORRECT throughout. The read half of the fix worked; the
       branch simply never consulted it. That is the whole lesson: a round that
       drives one caller certifies one caller.
       Everything below runs the branch text lifted out of public/index.html, so
       re-inlining the create makes this section fail rather than drift. */

    const found = async (label, opts) => {
      const { state, api } = build(opts);
      await runCaller(api.opFetch, state.Operations);
      await api.opFound({ kind: 'opFound', op: 'construction' });
      console.log('   ' + label.padEnd(42) + ' fetchFailed=' + String(state.Operations.fetchFailed).padEnd(5) +
                  ' visible=' + api.rows().length + ' inserts=' + state.inserts +
                  ' toast=' + JSON.stringify(state.toasts));
      return { ...state, api };
    };

    // ── 7a. The healthy player who already holds it: unchanged, still refused.
    const f1 = await found('opFound  healthy, player HAS it', { cloudHas: true });
    chk('§7 opFound on a healthy read grants nothing to a player who has it',
        f1.inserts === 0 && f1.Profile.jbLocalOps.length === 0,
        'inserts ' + f1.inserts);

    // ── 7b. THE DEFECT: error response, player already holds the cloud row. ──
    const f2 = await found('🔴 opFound, PostgREST {error}, HAS it', { cloudHas: true, readFails: true });
    chk('§7 a PostgREST {error} still reports a FAILED fetch on this route',
        f2.Operations.fetchFailed === true, 'fetchFailed=' + f2.Operations.fetchFailed);
    chk('§7 opFound writes NO corp_operations row while the licences are unknown',
        f2.inserts === 0 && f2.Profile.jbLocalOps.length === 0,
        'inserts ' + f2.inserts + ', local rows ' + f2.Profile.jbLocalOps.length +
        ' — a permanent duplicate licence from one click on a transient RLS blip');
    chk('§7 …and the player is told to retry, not told a licence was issued',
        f2.toasts.length === 1 && /try again/i.test(f2.toasts[0]) && !/issued/i.test(f2.toasts.join(' ')),
        JSON.stringify(f2.toasts));

    // ── 7c. THE FEATURE STILL WORKS. A new player on a trustworthy read must
    //        still get the free licence, or the fix is just a removal. ──
    const f3 = await found('opFound  healthy, NEW player', { cloudHas: false });
    chk('§7 a new player on a trustworthy read IS still granted the free licence',
        f3.inserts === 1 && f3.api.rows().filter((r) => r && r.op_type === 'construction').length === 1,
        'inserts ' + f3.inserts + ' rows ' + JSON.stringify(f3.api.rows().map((r) => r.op_type)));

    // ── 7d. IDEMPOTENCE ON THIS ROUTE: click Found twice, one row. ──
    const { state: st7, api: api7 } = build({ cloudHas: false });
    await runCaller(api7.opFetch, st7.Operations);
    await api7.opFound({ kind: 'opFound', op: 'construction' });
    await api7.opFound({ kind: 'opFound', op: 'construction' });
    const rows7 = api7.rows().filter((r) => r && r.op_type === 'construction').length;
    console.log('   opFound ×2 on a clean empty read           inserts=' + st7.inserts + ' rows=' + rows7);
    chk('§7 clicking Found twice writes exactly one licence',
        st7.inserts === 1 && rows7 === 1, 'inserts ' + st7.inserts + ', rows ' + rows7);

    // ── 7e. The helper going missing must REFUSE, never fall back to the old
    //        inline create — that fallback is how this defect survives a fix. ──
    const f4 = await found('opFound, grant fn MISSING, error read', { cloudHas: true, readFails: true, noGrantFn: true });
    chk('§7 a missing cityOpsGrantFree refuses rather than re-opening the hole',
        f4.inserts === 0 && f4.Profile.jbLocalOps.length === 0, 'inserts ' + f4.inserts);

    /* ── 7g. THE REGRESSION THAT WOULD HURT EVERY HONEST PLAYER, pinned here
           because the write-seam refusal turns on `_fetched && !fetchFailed`
           and an offline player has never talked to Supabase at all. opFetch
           counts that as TRUSTWORTHY — there is no read to have failed — and it
           must keep doing so, or "unknown state" quietly grows to mean "signed
           out" and the free licence is denied to everyone playing offline. */
    const f5 = await found('opFound  OFFLINE, new player', { signedIn: false, noCorp: true, cloudHas: false });
    chk('§7 an offline player is still granted the free licence',
        f5.Profile.jbLocalOps.length === 1 && f5.Operations.fetchFailed === false,
        'local rows ' + f5.Profile.jbLocalOps.length + ', fetchFailed=' + f5.Operations.fetchFailed +
        ' — the refusal has started eating signed-out players');

    /* ── 7f. THE TEXT ASSERTION, because 7a-7e cannot see a re-inlined branch
           that _opCreateLocal's own refusal happens to cover. The branch must
           DELEGATE; the free-licence create belongs to cityOpsGrantFree alone.
           `ops-found-inline` exists to prove this line does the catching. */
    chk('§7 the opFound branch delegates and does not create the licence itself',
        /window\.cityOpsGrantFree/.test(SRC.found) && !/_opCreateLocal/.test(SRC.found),
        'the Just Business branch reaches _opCreateLocal directly again: ' + SRC.found);
    chk('§7 …and _opCreateLocal still refuses a free licence against an unread list',
        /fundedBy === 'free-licence'/.test(SRC.createLocal) && /fetchFailed/.test(SRC.createLocal),
        'the write-seam refusal is gone — the next caller reopens this');
  }

  /* ── §8 THE LICENCE IS ACTUALLY FREE, AND STAYS FREE THROUGH AN OVERRIDE ────
     🔴 EVERYTHING ABOVE THIS SECTION STUBS THE PRICE. §7's sandbox hands the
        extracted code `_opEcon: (t) => (t === 'construction' ? { startup: 0 …`
        — a number this file wrote. So all of round0u grades the GRANT while
        taking the zero on faith, and the three hunks that produce that zero
        could be reverted with the whole gate green. Measured on the shipped
        tree: revert h014 (the table entry back to 350,000), h016
        (OPS_FREE_LICENCE deleted) and h017 (the override clamp deleted), both
        syntax checks CLEAN, gate GREEN, exit 0.

     WHY THAT MATTERS MORE THAN IT LOOKS. City construction timers put every
     Cinder earner in the game above the free Municipal Works ceiling (gas
     station 1h53, arena 3h23 — round0's own table), so the Construction Co. is
     the thing that unlocks income at all, and 350,000 🔥 is node income a
     player without a node does not have. A silent revert re-paywalls the
     headline feature behind the key to the door you need the key to open, and
     no assertion anywhere would say so — the city would just quietly refuse
     itself with `not-free` and the shop card would keep its padlock.

     THE PRODUCTION CALLER THIS MIRRORS is `_opEcon(t)`, lifted out of
     public/index.html with its real OPS_ECON table and its real
     OPS_FREE_LICENCE clamp, and asked the question every price site asks it.
     Nothing here is re-typed and no price is written down: the assertion is
     `startup === 0` for the free licence and `> 0` for the ones that are not,
     so a retune of any other operation moves nothing here.

     SABOTAGE: licence-paywalled (h014 + h017 together, which is how they would
     be reverted — the table says one thing and the clamp is the last word). */
  {
    const SRC8 = {
      table:  srcBlockAfter(idxSrc, 'const OPS_ECON = {'),
      free:   /const OPS_FREE_LICENCE = \{[^\n]*\};/.exec(idxSrc),
      econ:   srcBlockAfter(idxSrc, 'function _opEcon(t)'),
      ovr:    srcBlockAfter(idxSrc, 'function getOpsEconOverrides()'),
    };
    const got8 = chk('§8 OPS_ECON, OPS_FREE_LICENCE and _opEcon are all readable out of public/index.html',
        !!SRC8.table && !!SRC8.free && !!SRC8.econ && !!SRC8.ovr,
        'table=' + !!SRC8.table + ' freeList=' + JSON.stringify(SRC8.free && SRC8.free[0]) +
        ' _opEcon=' + !!SRC8.econ + ' overrides=' + !!SRC8.ovr +
        ' — a deleted OPS_FREE_LICENCE IS the h016 revert, seen from here');

    if (got8) {
      /* 🧨 h014 + h017 reversed, on the extracted source: the fee comes back in
         the table and the clamp that has the last word is deleted. Two single-
         line anchors, per the ops-zombie rule. */
      let table = SRC8.table, econ = SRC8.econ, sabOk = true;
      if (SABOTAGE === 'licence-paywalled') {
        const t2 = table.replace('construction: { startup: 0,', 'construction: { startup: 350000,');
        const e2 = econ.replace('if (OPS_FREE_LICENCE[t]) merged.startup = 0;', '');
        if (t2 === table || e2 === econ) sabOk = false;
        table = t2; econ = e2;
      }
      chk('§8 the licence-paywalled switch landed', sabOk,
          'an anchor matched nothing — the switch is inert and this section would stay green under it');

      /* _opEcon, compiled over the real table and the real free list. The
         override hook is a parameter so §8 can publish a stale catalog through
         the same seam getOpsEconOverrides() reads. */
      const mkEcon = (overrides) => new Function('__ov', 'return (function () {' +
        '  const OPS_ECON = ' + table + ';' +
        '  ' + SRC8.free[0] +
        '  function getOpsEconOverrides() { return __ov; }' +
        '  function _opEcon(t) ' + econ +
        '  return { _opEcon, OPS_ECON, OPS_FREE_LICENCE };' +
        '})();')(overrides || null);

      const E = mkEcon(null);
      const co = E._opEcon('construction');
      chk('§8 THE CONSTRUCTION CO. LICENCE IS FREE — startup 0, from the shipped table',
          !!co && (co.startup | 0) === 0,
          'startup = ' + JSON.stringify(co && co.startup) +
          ' — this is the change that unblocks all city income; at any other number the feature is paywalled');
      chk('§8 …and the free list is the documentation, so the table and the clamp cannot disagree',
          !!E.OPS_FREE_LICENCE && E.OPS_FREE_LICENCE.construction === 1,
          'OPS_FREE_LICENCE = ' + JSON.stringify(E.OPS_FREE_LICENCE));
      /* THE HALF THE TABLE CANNOT DO. A Catalog published before this change
         still carries construction:{startup:350000}; every player who has ever
         received it merges that on top. The clamp is what makes the table's 0
         true for them too. */
      const stale = mkEcon({ construction: { startup: 350000 } });
      chk('§8 …and a STALE PUBLISHED OVERRIDE cannot put the fee back',
          (stale._opEcon('construction').startup | 0) === 0,
          'a published catalog re-priced the licence at ' + stale._opEcon('construction').startup +
          ' 🔥 — every player who has that catalog is paywalled and the city refuses itself with not-free');
      chk('§8 …while an override of anything ELSE on the same row still applies',
          stale._opEcon('construction').maxWorkers === E._opEcon('construction').maxWorkers &&
          mkEcon({ construction: { maxWorkers: 3 } })._opEcon('construction').maxWorkers === 3,
          'the clamp has started eating unrelated overrides — free means free to ACQUIRE, not "this row is frozen"');
      /* …AND IT IS NOT "EVERYTHING IS FREE". A clamp that zeroed every startup
         would pass every assertion above and hand the whole ops shelf away. */
      const priced = Object.keys(E.OPS_ECON).filter(t => !E.OPS_FREE_LICENCE[t]);
      const wrong = priced.filter(t => (E._opEcon(t).startup | 0) <= 0);
      chk('§8 …and every operation NOT on the free list still costs what it costs (' + priced.length + ' checked)',
          priced.length > 3 && wrong.length === 0,
          'free by accident: ' + JSON.stringify(wrong) + ' of ' + JSON.stringify(priced));
    }
  }

  if (fails) { bad++; console.log('\n=== ROUND 0u: ' + fails + ' FAILED ==='); }
  else console.log('\n=== ROUND 0u: ALL PASS ===');
}

/* ════════════════════════════════════════════════════════════════════════════
   ROUND 0v — 💸 A CONFIRMATION THAT CANNOT DETECT A FAILURE, AND A SAVE THAT
              ERASES WHAT IT CANNOT READ
   ----------------------------------------------------------------------------
   Two defects, one shape: a value that means "I do not know" being read as "yes".

   ── §1/§2 THE PAYOUT-DELIVERY CONFIRMATION ─────────────────────────────────
   index.js guarded the delivery with `if (res === false) back(); else
   notePayoutDelivered(owed)`, and its own comment said "addCinders in 'message'
   mode is an RPC that rejects on timeout or a dead parent." IT DID NOT REJECT.
   node-city's `rpc()` resolved `null` from an 1800 ms setTimeout, resolved
   `null` again when postMessage threw, and `B.addCinders` then did
   `await rpc(...); return;` — returning `undefined` on EVERY path, success and
   failure alike. `undefined !== false`, so a timed-out payout was booked as
   DELIVERED and the player's Cinder was destroyed. It is the exact case the
   comment named, and the comment is what made it look handled.

   MEASURED on the tree before the fix, through the production call shape (the
   real bridge lifted out of node-city, a parent that never answers, 400 ticks):
       addCinders resolved  undefined   on timeout
       addCinders resolved  undefined   when postMessage threw
       addCinders resolved  undefined   on a genuine success
       payoutOwed       0.98 🔥
       payoutInFlight   0.00 🔥
       payoutLifetime 570.00 🔥   ← booked as delivered
       actually in the wallet  0.00 🔥

   ── §3 THE ECONOMY BLOB ────────────────────────────────────────────────────
   node-city's serialize() wrote `economy: window.MythicEconomy ?
   window.MythicEconomy.serialize() : null`, and index.js answers `null` whenever
   it is not mounted. So ONE failed import of /src/economy — a 404, a cache miss,
   an offline moment, a throw in mount() — meant the very next save wrote
   `economy: null` over a lived economy and it came back at zero, silently. The
   `house:` and `stad:` fields twenty lines above had preserved their
   previously-loaded blob for exactly this reason since they were written.

   MEASURED on the pre-fix text against a 400-day blob (treasury 57.71 🔥,
   charterIssued 300,000.00 🔥, 8 firms): module present → a blob, module absent
   → null.

   🔴 THE PRODUCTION CALL SHAPE, throughout. The bridge is the real
      `MythicCityBridge` IIFE read out of public/node-city/index.html and
      evaluated; the payout path is the real `MythicEconomy.tick()`; the save
      field is the real `economy:` expression read out of serialize(). Nothing
      below is re-typed.

   Prove it can fail:
     ECON_TEST_SABOTAGE=payout-blind  rebuild /src/economy with the delivery test
                                      reverted to `res === false`, i.e. the
                                      shipped guard that could not see a timeout
     ECON_TEST_SABOTAGE=eco-erase     revert node-city's `economy:` field to
                                      `window.MythicEconomy ? …serialize() :
                                      null`, i.e. the line that nulled a city
   ════════════════════════════════════════════════════════════════════════════ */
{
  console.log('\n########## round0v-a-failed-credit-must-be-detectable ##########');
  let fails = 0;
  const chk = (name, cond, extra) => {
    if (cond) { console.log('✅ ' + name); return true; }
    fails++; console.log('❌ ' + name + (extra ? ' :: ' + extra : '')); return false;
  };
  const NCPATH = join(here, '../../public/node-city/index.html');
  const ncSrc = readFileSync(NCPATH, 'utf8');
  const DAY = 20;
  const host = { powerFactor: 1, waterFactor: 1, logisticsCounts: { warehouse: 2 }, hasBank: false, infrastructure: 0.6 };

  /* ── THE REAL BRIDGE, LIFTED ───────────────────────────────────────────────
     Everything about this defect lives in the seam between two files, so a
     hand-written stub of either side would test the seam that was never broken.
     The IIFE closes over `window`, `localStorage` and `location` only, which is
     why it can be evaluated at all — the globals trap works in our favour here. */
  const BRIDGE_BODY = srcBlockAfter(ncSrc, 'const MythicCityBridge = (() =>');
  chk('§1 can read the shipped MythicCityBridge out of node-city',
      !!BRIDGE_BODY && BRIDGE_BODY.length > 5000,
      BRIDGE_BODY ? BRIDGE_BODY.length + ' bytes' : 'UNREADABLE — the bridge was reshaped and this round is vacuous');

  const memStore = new Map();
  const fakeLS = {
    getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
    setItem: (k, v) => memStore.set(k, String(v)), removeItem: (k) => memStore.delete(k),
  };
  /* Which bridge TEXT makeBridge compiles. Normally the shipped one; §2 swaps in
     the reverted copy for the length of one build so the two halves of the
     defect can be re-committed independently. */
  let BRIDGE_BODY_ACTIVE = BRIDGE_BODY;
  /* `mode` is forced through the bridge's OWN `?bridge=` switch rather than by
     poking B.mode, so the mode-detection path is the shipped one too. */
  const makeBridge = (opts) => {
    const listeners = [];
    const w = {
      addEventListener: (t, f) => { if (t === 'message') listeners.push(f); },
      parent: {
        postMessage: (m) => {
          if (opts.postMessageThrows) throw new Error('dead parent');
          if (!opts.reply) return;                        // silence → the 1800ms timeout
          setTimeout(() => listeners.forEach((f) => f({ data: { type: 'mythic-city-reply', id: m.id, result: opts.reply(m) } })), 1);
        },
      },
    };
    const fn = new Function('window', 'localStorage', 'location', 'URLSearchParams', 'console', 'setTimeout',
      'return (() => ' + BRIDGE_BODY_ACTIVE + ')();');
    const B = fn(w, fakeLS, { search: '?bridge=' + (opts.mode || 'message') }, URLSearchParams, console, setTimeout);
    B.mode = opts.mode || 'message';
    return B;
  };

  if (BRIDGE_BODY) {
    /* ── §1 THE SIGNAL ITSELF ────────────────────────────────────────────────
       Six answers the bridge can give, and the two that used to be
       indistinguishable are the first two. */
    const cases = [
      ['a parent that never answers (timeout)', { }, false],
      ['postMessage throws (dead parent)', { postMessageThrows: true }, false],
      ['the host confirms', { reply: () => true }, true],
      ['the host REFUSES', { reply: () => false }, false],
      ['an older host that acks with no value', { reply: () => undefined }, true],
      ['standalone (the mock ledger)', { mode: 'standalone' }, true],
    ];
    for (const [label, opts, want] of cases) {
      const B = makeBridge(opts);
      const got = await B.addCinders(1234);
      chk('§1 addCinders → ' + JSON.stringify(want) + '  (' + label + ')',
          got === want, 'resolved ' + JSON.stringify(got) +
          ' — a value that cannot distinguish delivered from destroyed is what booked 570.00 🔥 that never arrived');
    }
    const okB = makeBridge({ reply: () => true });
    chk('§1 …and nothing owed is not a failure',
        (await okB.addCinders(0)) === true, 'addCinders(0) must not make the economy re-owe a payout it never claimed');

    /* ── §2 THE PRODUCTION PAYOUT PATH ───────────────────────────────────────
       🔴 THE DEFECT NEEDED BOTH FILES, AND SO DOES THE PROOF THAT IT IS CLOSED.
       Two independent refusals now stand in front of it:
         A. the bridge resolves a strict boolean, so a timeout is `false`;
         B. index.js books a delivery only on `res === true`, so anything that is
            not a positive confirmation is refunded.
       Either one ALONE saves the money — and that is exactly why a switch that
       reverts only one of them goes green. The first version of this section
       reverted only B and was INERT for that reason, which is the same vacuous
       green this file exists to distrust. So §2 reverts each in turn, asserts
       the money survives both times, and then reverts BOTH and asserts the money
       is destroyed — because a proof that cannot show the defect is not a proof.
       `payout-blind` applies the both-reverted build to the headline checks. */
    const ECODIR = join(here, '../../public/src/economy');
    const idxTxt = readFileSync(join(ECODIR, 'index.js'), 'utf8');
    const GUARD_OK = 'if (res !== true) back();';
    const GUARD_OLD = 'if (res === false) back();';
    /* The bridge half, reverted in the EXTRACTED text: `await rpc(…); return;`
       is what shipped, and it returns `undefined` on every path. */
    const bridgeOld = BRIDGE_BODY.replace(
      /if \(B\.mode === 'message'\) \{\s*const r = await rpcEx\('addCinders'[\s\S]*?return r\.result !== false;\s*\}/,
      "if (B.mode === 'message') { await rpc('addCinders', { n }); return; }");
    chk('§2 can find both refusals it is about to revert',
        idxTxt.indexOf(GUARD_OK) >= 0 && bridgeOld !== BRIDGE_BODY,
        'index.js anchor ' + (idxTxt.indexOf(GUARD_OK) >= 0 ? 'found' : 'MISSING') +
        ', bridge anchor ' + (bridgeOld !== BRIDGE_BODY ? 'found' : 'MISSING') +
        ' — the anchors have drifted and the can-fail proof below is vacuous');

    const tmpRoots = [];
    const buildEco = async (tag, revertGuard) => {
      const dst = join(tmpdir(), 'econ-0v-' + tag + '-' + process.pid + '-' + Date.now());
      mkdirSync(dst, { recursive: true }); tmpRoots.push(dst);
      for (const fn of readdirSync(ECODIR)) {
        if (!fn.endsWith('.js')) continue;
        let t = readFileSync(join(ECODIR, fn), 'utf8');
        if (revertGuard && fn === 'index.js') t = t.split(GUARD_OK).join(GUARD_OLD);
        writeFileSync(join(dst, fn), t);
      }
      return (await import(pathToFileURL(join(dst, 'index.js')).href)).default;
    };

    /* One module instance per scenario: `mounted`, `mountGen` and the sim state
       are module-level, and sharing them across scenarios would let one
       scenario's in-flight promise settle inside the next one's books.
       `wallet` counts only what the bridge said it DELIVERED — it is the number
       the player would actually see, and the whole defect is the gap between it
       and `payoutLifetime`. */
    const runPayout = async (tag, bridgeOpts, rev) => {
      rev = rev || {};
      const M = await buildEco(tag, !!rev.guard);
      const body = rev.bridge ? bridgeOld : BRIDGE_BODY;
      const B = (function () {
        const saved = BRIDGE_BODY_ACTIVE; BRIDGE_BODY_ACTIVE = body;
        try { return makeBridge(bridgeOpts); } finally { BRIDGE_BODY_ACTIVE = saved; }
      })();
      let wallet = 0;
      const inner = B.addCinders;
      B.addCinders = async (n) => { const r = await inner(n); if (r === true) wallet += Math.floor(n); return r; };
      global.window.MythicCityBridge = B;
      M.mount({ nodeId: 'payout-' + tag, population: 320, established: 'new' });
      for (let i = 0; i < 400; i++) M.tick(DAY, host);
      await new Promise((r) => setTimeout(r, 2200));    // every 1800 ms rpc has now settled
      const snap = M.snapshot();
      const life = snap.payoutLifetime != null ? snap.payoutLifetime : 0;
      console.log('   [' + tag + '] owed ' + snap.payoutOwed.toFixed(2) +
                  '  inFlight ' + snap.payoutInFlight.toFixed(2) +
                  '  bookedDelivered ' + life.toFixed(2) +
                  '  actuallyInWallet ' + wallet.toFixed(2) + ' 🔥');
      return { snap, wallet, life };
    };

    const REV = SABOTAGE === 'payout-blind' ? { guard: true, bridge: true } : {};
    const dead = await runPayout('timeout', {}, REV);
    chk('§2 a payout the bridge never confirms is RE-OWED, not destroyed',
        dead.life < 1e-6 && dead.snap.payoutInFlight < 1e-6 && dead.snap.payoutOwed > 1,
        'bookedDelivered ' + dead.life.toFixed(2) + ' 🔥 against ' + dead.wallet.toFixed(2) +
        ' 🔥 actually delivered — the timeout was read as a success and the money is in neither ledger');

    const throwy = await runPayout('pm-throws', { postMessageThrows: true }, REV);
    chk('§2 …and so is one whose postMessage threw',
        throwy.life < 1e-6 && throwy.snap.payoutInFlight < 1e-6 && throwy.snap.payoutOwed > 1,
        'bookedDelivered ' + throwy.life.toFixed(2) + ' 🔥 against ' + throwy.wallet.toFixed(2) + ' 🔥 delivered');

    const good = await runPayout('confirmed', { reply: () => true }, REV);
    chk('§2 …while a GENUINE success still books as delivered, exactly once',
        good.life > 1 && Math.abs(good.life - good.wallet) < 1e-6 && good.snap.payoutInFlight < 1e-6,
        'bookedDelivered ' + good.life.toFixed(2) + ' 🔥 vs wallet ' + good.wallet.toFixed(2) +
        ' 🔥 — a mismatch is a payout counted twice or lost');
    chk('§2 …and a refused payout comes back too',
        (await runPayout('refused', { reply: () => false }, REV)).life < 1e-6,
        'an explicit refusal was booked as a delivery');

    /* ── AND NOW BREAK IT, FOR REAL — one refusal at a time, then both. ────── */
    const onlyBridge = await runPayout('revert-bridge', {}, { bridge: true });
    chk('§2 refusal B holds ALONE — with the bridge blind again, index.js still refunds',
        onlyBridge.life < 1e-6 && onlyBridge.snap.payoutOwed > 1,
        'reverting the bridge alone destroyed ' + onlyBridge.life.toFixed(2) + ' 🔥');
    const onlyGuard = await runPayout('revert-guard', {}, { guard: true });
    chk('§2 refusal A holds ALONE — with `res === false` back, the bridge\'s `false` still catches it',
        onlyGuard.life < 1e-6 && onlyGuard.snap.payoutOwed > 1,
        'reverting index.js alone destroyed ' + onlyGuard.life.toFixed(2) + ' 🔥');
    const both = await runPayout('revert-both', {}, { guard: true, bridge: true });
    console.log('   [revert-both] the shipped tree: ' + both.life.toFixed(2) +
                ' 🔥 booked as delivered, ' + both.wallet.toFixed(2) + ' 🔥 actually delivered');
    chk('§2 …and reverting BOTH really does destroy the money — the defect is real and this proof is not vacuous',
        both.life > 1 && both.wallet < 1e-6,
        'both refusals reverted and only ' + both.life.toFixed(2) + ' 🔥 was mis-booked — §2 is asserting nothing, ' +
        'find out what else is closing this');
    for (const d of tmpRoots) { try { rmSync(d, { recursive: true, force: true }); } catch (e) {} }
  }

  /* ── §3 THE SAVE MAY NOT ERASE WHAT IT CANNOT READ ─────────────────────────
     The `economy:` field is read out of serialize() and run against the two
     module states that matter. `_lastEconomyBlob` is declared inside the harness
     so the extracted expression's assignment to it is observable — that
     assignment is the fix. */
  const ecoField = srcBlockAfter(ncSrc, 'economy: (function ()');
  chk('§3 can read node-city\'s `economy:` save field',
      !!ecoField, 'UNREADABLE — the field was reshaped and this section is vacuous');
  if (ecoField) {
    const body = (SABOTAGE === 'eco-erase')
      ? '{ try { return window.MythicEconomy ? window.MythicEconomy.serialize() : null; } catch (e) { return null; } }'
      : ecoField;
    const runField = new Function('window', '_last', `
      let _lastEconomyBlob = _last;
      const out = (function () ${body})();
      return { out, kept: _lastEconomyBlob };`);

    const lived = { day: 400, treasury: 57.71, charterIssued: 300000, firms: { firms: [1, 2, 3, 4, 5, 6, 7, 8] } };
    const liveMod = { ready: () => true, serialize: () => lived };
    const deferredMod = { ready: () => false, serialize: () => null };

    // 1. the module is there: the blob is written AND remembered.
    const r1 = runField({ MythicEconomy: liveMod }, null);
    chk('§3 a mounted economy writes its blob',
        r1.out === lived && r1.kept === lived, 'wrote ' + JSON.stringify(r1.out));

    // 2. the module 404s on the NEXT session, after loadState stashed the blob.
    const r2 = runField({}, lived);
    console.log('   module absent, last known blob day ' + lived.day + '/treasury ' + lived.treasury.toFixed(2) +
                ' 🔥 → save writes ' + (r2.out ? 'day ' + r2.out.day + '/treasury ' + (+r2.out.treasury).toFixed(2) + ' 🔥' : JSON.stringify(r2.out)));
    chk('§3 …and a FAILED import of /src/economy does not null it',
        r2.out === lived,
        'the save wrote ' + JSON.stringify(r2.out) + ' over a lived economy — one 404 erases the whole city economy');

    // 3. registered but not mounted — the deferred case, and the same door.
    const r3 = runField({ MythicEconomy: deferredMod }, lived);
    chk('§3 …nor does a registered-but-unmounted module (the deferred case)',
        r3.out === lived,
        'wrote ' + JSON.stringify(r3.out) + ' — `E && E.serialize()` is null whenever mounted is false');

    // 4. a throw inside serialize() is the third door onto the same field.
    const r4 = runField({ MythicEconomy: { ready: () => true, serialize: () => { throw new Error('corrupt'); } } }, lived);
    chk('§3 …nor a throw inside serialize()', r4.out === lived, 'wrote ' + JSON.stringify(r4.out));

    // 5. …and the round trip: what survived loads back intact.
    const roundTripped = JSON.parse(JSON.stringify({ tiles: { '0,0': {} }, economy: r2.out }));
    chk('§3 …and the surviving blob reloads intact',
        roundTripped.economy && roundTripped.economy.day === 400 &&
        Math.abs(roundTripped.economy.treasury - 57.71) < 1e-9 &&
        Math.abs(roundTripped.economy.charterIssued - 300000) < 1e-9,
        JSON.stringify(roundTripped.economy));

    /* And the seed: loadState must stash the blob in the first place, or the
       fallback above is always empty and §3 passes on a variable nobody fills. */
    chk('§3 …and loadState seeds it, so the fallback is not permanently null',
        /_lastEconomyBlob\s*=\s*_pendingEconomy\s*;/.test(ncSrc),
        'nothing in loadState assigns `_lastEconomyBlob` — the guard above can only ever return null');
  }

  if (fails) { bad++; console.log('\n=== ROUND 0v: ' + fails + ' FAILED ==='); }
  else console.log('\n=== ROUND 0v: ALL PASS ===');
}

/* ════════════════════════════════════════════════════════════════════════════
   ROUND 0w — 💸 THE THREE PAYOUT REFUSALS NOBODY WAS WATCHING
   ----------------------------------------------------------------------------
   🔴 WHY THIS ROUND EXISTS. Three fixes to the one write that reaches the
      player's real wallet shipped with NO round on them. Each was reverted in a
      copy of the tree outside the repo and the whole gate stayed GREEN:

        A. `const back = () => { if (gen === mountGen) Sim.refundPayout(owed); }`
           reverted to an unconditional refund               → gate GREEN
        B. `if (gen === mountGen) Sim.notePayoutDelivered(owed)`
           reverted to an unconditional tally                → gate GREEN
        C. the missing-bridge `else { Sim.refundPayout(owed); }`
           replaced with a comment                           → gate GREEN

      Round 0v covers a DIFFERENT pair (the bridge's boolean and the
      `res !== true` test) and passes happily with all three of the above gone.
      An unguarded fix is a fix with a half-life.

   ── 🔴 THE PRODUCTION CALL SHAPE, AND EXACTLY HOW FAR IT REACHES ────────────
   Every scenario below is driven through:
     • `E.mount({ nodeId, population: …, state: …, established: … })` — the
       shipped literal at node-city/index.html:28095, asserted below to still be
       the ONE mount call in the file;
     • `MythicEconomy.tick(dtMin, ecoHost())` — node-city:17791, behind the same
       `ready()` gate the host uses;
     • the REAL `MythicCityBridge` IIFE, read out of node-city and evaluated —
       `B.addCinders` in 'message' mode, with its own 1800 ms `rpcEx` timeout.
   Nothing here is a hand-written stand-in for either side of the seam.

   ⚠ AND THE HONEST LIMIT, STATED RATHER THAN GLOSSED. node-city's boot IIFE
     calls `E.mount()` exactly ONCE per page load (§1 asserts the count), so a
     SECOND mount is not something the shipped host does today — its own comment
     at node-city:28096 says so in as many words: "A remount (there is none
     today) would arrive with state:null". The second live `mountGen` bump is
     `E2.resolve({ established: 'new', state: null })` in `ecoDeferRetry()`
     (node-city:16785), and §2 proves why THAT one cannot currently carry a stale
     payout: a deferred module is inert, so nothing has been claimed when it
     fires. §2 is the round that fails if a future edit lets `tick()` run while
     deferred — which is the only way the resolve() bump becomes dangerous.
     §3 and §4 then drive the remount the host's own comment anticipates. Both
     are labelled for what they are; neither is dressed up as something the
     shipped host does today.

   ⚠ §5's `else` is likewise reached whenever `window.MythicCityBridge` is absent
     or carries no `addCinders`. Shipped node-city assigns the bridge at
     top level (line 2072) before the module is imported, so that state is not
     reachable THERE — but `B()` in index.js is written as
     `(typeof window !== 'undefined' ? window.MythicCityBridge : null) || null`
     and is re-read on EVERY tick precisely so the bridge may be absent or
     swapped, which node-city itself does (`B.addCinders` is replaced and
     restored around the offline catch-up, node-city:23723/23816). Every mount of
     `window.MythicEconomy` outside node-city — this gate's own rounds included —
     lives in that state permanently. The rule the `else` encodes is not
     situational: whatever `claimPayout()` took and nothing delivered goes back on
     the books, every path, no exceptions.

   Prove it can fail:
     ECON_TEST_SABOTAGE=stale-refund   §3 headline: unconditional refund
     ECON_TEST_SABOTAGE=stale-deliver  §4 headline: unconditional delivery tally
     ECON_TEST_SABOTAGE=nobridge-drop  §5 headline: the `else` emptied
   …and each section ALSO applies its own revert internally and asserts the
   money really is destroyed, so a section that has quietly stopped measuring
   anything fails on its own without the switch. A proof that cannot show the
   defect is not a proof — round0v §2's first draft was inert for exactly that
   reason and this round inherits the lesson rather than the mistake.
   ════════════════════════════════════════════════════════════════════════════ */
{
  console.log('\n########## round0w-stale-and-bridgeless-payouts ##########');
  let fails = 0;
  const chk = (name, cond, extra) => {
    if (cond) { console.log('✅ ' + name); return true; }
    fails++; console.log('❌ ' + name + (extra ? ' :: ' + extra : '')); return false;
  };
  const F = (n) => (+n).toFixed(2);
  const NCPATH = join(here, '../../public/node-city/index.html');
  const ncSrc = readFileSync(NCPATH, 'utf8');
  const ECODIR = join(here, '../../public/src/economy');
  const idxTxt = readFileSync(join(ECODIR, 'index.js'), 'utf8');
  const DAY = 20;
  const host = { powerFactor: 1, waterFactor: 1, logisticsCounts: { warehouse: 2 }, hasBank: false, infrastructure: 0.6 };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const savedBridge = global.window ? global.window.MythicCityBridge : undefined;

  /* ── §1 THE ANCHORS AND THE SHAPE ─────────────────────────────────────────
     🔴 EVERY ANCHOR IS COUNTED, NOT TESTED FOR PRESENCE. A revert-proof whose
        substitution matches nothing is the vacuous green this whole file exists
        to distrust — and the first draft of this round hit it for real: the tree
        is CRLF, so the multi-line `\n`-joined anchor for §5 matched zero
        occurrences and BOTH the fixed and the reverted build produced byte-
        identical output and identical numbers. The `else` anchor is a regex over
        whitespace for that reason, and every count below must be exactly 1. */
  const A_REFUND_OK = 'const back = () => { if (gen === mountGen) Sim.refundPayout(owed); };';
  const A_REFUND_OLD = 'const back = () => { Sim.refundPayout(owed); };';
  const A_DELIV_OK = 'if (gen === mountGen) Sim.notePayoutDelivered(owed);';
  const A_DELIV_OLD = 'Sim.notePayoutDelivered(owed);';
  const RE_NOBRIDGE = /\}\s*else\s*\{\s*Sim\.refundPayout\(owed\);\s*\}/g;
  const A_NOBRIDGE_OLD = '} else { /* reverted: whatever was claimed is simply not put back */ }';

  const nRefund = idxTxt.split(A_REFUND_OK).length - 1;
  const nDeliv = idxTxt.split(A_DELIV_OK).length - 1;
  const nBridge = (idxTxt.match(RE_NOBRIDGE) || []).length;
  chk('§1 the mountGen refund guard is where this round thinks it is (×1)', nRefund === 1, 'found ' + nRefund);
  chk('§1 the mountGen delivery guard is where this round thinks it is (×1)', nDeliv === 1, 'found ' + nDeliv);
  chk('§1 the missing-bridge refund `else` is where this round thinks it is (×1)', nBridge === 1, 'found ' + nBridge);

  /* The shipped mount literal. §3/§4 replay THIS call twice; if it is reshaped,
     they are replaying something node-city no longer does. */
  const nMount = (ncSrc.match(/E\.mount\(\{/g) || []).length;
  const mountLit = (ncSrc.match(/E\.mount\(\{[\s\S]{0,200}?\);/) || [''])[0];
  chk('§1 node-city still makes exactly ONE E.mount({…}) call', nMount === 1, 'found ' + nMount +
      ' — if a real remount has appeared, §3/§4 stop being hypothetical and this comment must be rewritten');
  chk('§1 …and it passes both `state:` and `established:`, which is the shape §3/§4 replay',
      /state:\s*_pendingEconomy/.test(mountLit) && /established:\s*_cityVerdict/.test(mountLit),
      'the literal reads: ' + mountLit.replace(/\s+/g, ' '));
  chk('§1 …and ecoDeferRetry still calls E2.resolve({…}) — the second live mountGen bump',
      /E2\.resolve\(\{/.test(ncSrc), 'the resolve() caller is gone; §2 is measuring a path nobody walks');
  chk('§1 …and the host gates its tick on ready(), so a deferred module is never ticked by production',
      /window\.MythicEconomy\.ready\(\)/.test(ncSrc) && /window\.MythicEconomy\.tick\(dtMin,\s*ecoHost\(\)\)/.test(ncSrc),
      'node-city no longer gates economyTick on ready() — §2\'s premise is broken');

  /* ── THE REAL BRIDGE, LIFTED (same technique as round0v §1) ────────────────
     Deliberately a SECOND copy of makeBridge rather than a shared helper: this
     one takes a `delay`, because the whole of §4 is a reply that lands AFTER the
     remount, and round0v has no reason to want that. Two rounds that must be
     able to fail independently should not share a fixture. */
  const BRIDGE_BODY = srcBlockAfter(ncSrc, 'const MythicCityBridge = (() =>');
  chk('§1 can read the shipped MythicCityBridge out of node-city',
      !!BRIDGE_BODY && BRIDGE_BODY.length > 5000,
      BRIDGE_BODY ? BRIDGE_BODY.length + ' bytes' : 'UNREADABLE — the bridge was reshaped and this round is vacuous');

  const memStore = new Map();
  const fakeLS = {
    getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
    setItem: (k, v) => memStore.set(k, String(v)), removeItem: (k) => memStore.delete(k),
  };
  const makeBridge = (opts) => {
    const listeners = [];
    const w = {
      addEventListener: (t, f) => { if (t === 'message') listeners.push(f); },
      parent: {
        postMessage: (m) => {
          if (!opts.reply) return;                        // silence → the shipped 1800 ms timeout
          setTimeout(() => listeners.forEach((f) => f({ data: { type: 'mythic-city-reply', id: m.id, result: opts.reply(m) } })),
                     opts.delay || 1);
        },
      },
    };
    const fn = new Function('window', 'localStorage', 'location', 'URLSearchParams', 'console', 'setTimeout',
      'return (() => ' + BRIDGE_BODY + ')();');
    const B = fn(w, fakeLS, { search: '?bridge=message' }, URLSearchParams, console, setTimeout);
    B.mode = 'message';
    return B;
  };

  const tmpRoots = [];
  let seq = 0;
  /* One module INSTANCE per scenario. `mounted`, `mountGen` and the sim state
     are module-level, so a shared instance would let one scenario's in-flight
     promise settle inside the next one's books — which is the very bug under
     test, arriving as a harness artefact. */
  const buildEco = async (tag, revs) => {
    revs = revs || {};
    const dst = join(tmpdir(), 'econ-0w-' + tag + '-' + process.pid + '-' + (++seq));
    mkdirSync(dst, { recursive: true }); tmpRoots.push(dst);
    let touched = 0;
    for (const fn of readdirSync(ECODIR)) {
      if (!fn.endsWith('.js')) continue;
      let t = readFileSync(join(ECODIR, fn), 'utf8');
      if (fn === 'index.js') {
        const before = t;
        if (revs.refund) t = t.split(A_REFUND_OK).join(A_REFUND_OLD);
        if (revs.deliver) t = t.split(A_DELIV_OK).join(A_DELIV_OLD);
        if (revs.nobridge) t = t.replace(RE_NOBRIDGE, A_NOBRIDGE_OLD);
        if (t !== before) touched++;
      }
      writeFileSync(join(dst, fn), t);
    }
    /* A revert that changed nothing would make the "and now it breaks" half of
       every section pass on the SHIPPED code. Every caller gates on the §1
       counts so this cannot normally fire; it is the backstop, and it throws
       rather than warns because a silent no-op revert is the exact failure this
       round was written to end. */
    if ((revs.refund || revs.deliver || revs.nobridge) && !touched) {
      throw new Error('round0w: a revert for [' + Object.keys(revs).join(',') + '] matched nothing — the anchors have drifted');
    }
    return (await import(pathToFileURL(join(dst, 'index.js')).href)).default;
  };

  if (BRIDGE_BODY) {
    /* ── §2 THE LIVE mountGen BUMP, AND WHY IT IS CURRENTLY HARMLESS ─────────
       Mirrors: node-city boot `E.mount({… established: _cityVerdict })` with
       `_cityVerdict === 'unknown'`, then `ecoDeferRetry()` →
       `E2.resolve({ established: 'new', state: null })`.
       resolve() bumps mountGen exactly as mount() does, so if a deferred module
       could claim a payout, THIS is where a stale settlement would land on a
       city founded seconds ago. It cannot, because `tick()` returns null while
       deferred and the host does not even call it (ready() is false). That is a
       property, not a coincidence, and this section is what notices if it stops
       being true. */
    const D = await buildEco('deferred', {});
    global.window.MythicCityBridge = makeBridge({});
    D.mount({ nodeId: 'defer-city', population: 320, state: null, established: 'unknown' });
    chk('§2 an `unknown` verdict mounts DEFERRED, and the host\'s ready() gate keeps tick() away',
        D.deferred() === true && D.ready() === false && D.snapshot() === null,
        'deferred ' + D.deferred() + ' ready ' + D.ready());
    let ticked = 0;
    for (let i = 0; i < 400; i++) if (D.tick(DAY, host) !== null) ticked++;
    chk('§2 …and tick() is inert on its own too, so nothing is ever claimed while the verdict is open',
        ticked === 0, ticked + ' of 400 ticks advanced a city whose founding question is undecided');
    const resolved = D.resolve({ established: 'new', state: null });
    const rs = D.snapshot();
    chk('§2 …so when resolve() bumps mountGen there is nothing in flight to strand',
        resolved === true && rs && rs.payoutInFlight < 1e-9 && rs.payoutOwed < 1e-9,
        'resolved ' + resolved + (rs ? ' inFlight ' + F(rs.payoutInFlight) + ' owed ' + F(rs.payoutOwed) : ' snapshot null'));
    /* 🔴 THE THREE FIELDS EVERY SECTION BELOW MEASURES. `payoutLifetime` was
       tracked but unreadable outside sim.js until cfde63c exposed it, and
       dropping it again turns §4 into a comparison against `undefined` — which
       fails, but for a reason nobody reading the output would understand. Asked
       here so the message names the cause. */
    chk('§2 …and snapshot() exposes the three payout terms the sections below read',
        rs && typeof rs.payoutOwed === 'number' && typeof rs.payoutInFlight === 'number' &&
        typeof rs.payoutLifetime === 'number',
        'snapshot() reports owed=' + (rs && typeof rs.payoutOwed) + ' inFlight=' + (rs && typeof rs.payoutInFlight) +
        ' lifetime=' + (rs && typeof rs.payoutLifetime) + ' — a payout figure nobody can read is a payout figure ' +
        'nobody notices going wrong, which is how 570.00 🔥 of "delivered" money reached no wallet');

    /* ── THE REMOUNT DRIVER, shared by §3 and §4 ────────────────────────────
       The shipped literal, twice. City A runs 400 days against a bridge whose
       answer has not arrived; the page then mounts city B (state:null — the
       remount node-city:28096 describes); THEN city A's answers land.
       `Sim.reset()` has zeroed payoutOwed and payoutInFlight in between, which
       is exactly why the settlement must be discarded rather than applied. */
    const stale = async (tag, revs, bridgeOpts, settleMs) => {
      const M = await buildEco(tag, revs);
      global.window.MythicCityBridge = makeBridge(bridgeOpts);
      /* ⚠ THE NODE IDS ARE FIXED, NOT DERIVED FROM `tag`. The ground a city
         stands on is a function of its node id, so tagging them would give the
         shipped run and the reverted run different endowments and the two
         printed figures would not be comparable — which is the whole output of
         this section. Only the temp directory varies. */
      M.mount({ nodeId: 'stale-A', population: 320, state: null, established: 'new' });
      for (let i = 0; i < 400; i++) M.tick(DAY, host);
      const a = M.snapshot();
      M.mount({ nodeId: 'stale-B', population: 320, state: null, established: 'new' });
      const fresh = M.snapshot();
      await sleep(settleMs);
      const b = M.snapshot();
      console.log('   [' + tag + '] cityA left ' + F(a.payoutInFlight) + ' 🔥 in flight → cityB (day ' + b.day +
                  ') owed ' + F(b.payoutOwed) + '  inFlight ' + F(b.payoutInFlight) +
                  '  lifetime ' + F(b.payoutLifetime) + ' 🔥');
      return { a, fresh, b };
    };

    /* ── §3 A REJECTION THAT ARRIVES AFTER THE REMOUNT IS NOT THE NEW CITY'S ──
       Bridge: a parent that never answers, so every addCinders resolves `false`
       at the shipped 1800 ms timeout — the ordinary case, not an exotic one.
       Reverted, `back()` credits city A's 8,029 🔥 onto city B's `payoutOwed`,
       and city B pays it to the player out of a treasury that was never debited.
       That is a mint: the Cinder left city A's books on the day it was drawn and
       city A no longer exists.

       🔴 EVERY REVERT BELOW IS GATED ON THE §1 COUNT. If a fix has already been
       removed from index.js the anchor is gone, §1 has said so in as many words,
       and re-running the revert would only rediscover that — while `buildEco`'s
       backstop would take the whole gate down with a stack trace instead of a
       readable red. A missing anchor fails the proof; it does not crash it. */
    const SAB = (name, n) => (SABOTAGE === name && n === 1);
    const s3 = await stale('refund' + (SAB('stale-refund', nRefund) ? '-SABOTAGED' : ''),
                           SAB('stale-refund', nRefund) ? { refund: true } : {}, {}, 2200);
    chk('§3 city A actually left money in flight — otherwise this section tested nothing',
        s3.a.payoutInFlight > 100, 'inFlight ' + F(s3.a.payoutInFlight) + ' 🔥');
    chk('§3 a rejection that lands after a remount is DISCARDED, not refunded onto the new city',
        s3.b.payoutOwed < 1 && s3.b.day === 0,
        'city B has done ' + s3.b.day + ' days and is owed ' + F(s3.b.payoutOwed) +
        ' 🔥 — that is city A\'s payout, minted onto a city whose treasury never paid it');

    const s3rev = nRefund === 1 ? await stale('refund-reverted', { refund: true }, {}, 2200) : null;
    chk('§3 …and reverting the guard really does mint it — this section is not vacuous',
        !!s3rev && s3rev.b.payoutOwed > 100 && Math.abs(s3rev.b.payoutOwed - s3rev.a.payoutInFlight) < 1,
        s3rev ? 'guard reverted and city B came back owed only ' + F(s3rev.b.payoutOwed) +
        ' 🔥 against ' + F(s3rev.a.payoutInFlight) + ' 🔥 in flight — find out what else is closing this'
              : 'the guard text is not in index.js at all, so this proof could not be run — see §1');

    /* ── §4 …AND NEITHER IS A CONFIRMATION ───────────────────────────────────
       Bridge: the host DOES answer `true`, 1200 ms later — inside the 1800 ms
       window, so this is a genuine success arriving late, which is the common
       case on a loaded parent. `notePayoutDelivered` is the only line in the
       codebase allowed to say a payout arrived; reverted, it says so about city
       B for 8,329 🔥 that city B never paid anyone. It also retires an in-flight
       term that belongs to a different city — and `payoutInFlight` is what
       `serialize()` writes and `load()` puts back on `payoutOwed`, so a save
       taken in that window loses the new city's real payout. */
    const s4 = await stale('deliver' + (SAB('stale-deliver', nDeliv) ? '-SABOTAGED' : ''),
                           SAB('stale-deliver', nDeliv) ? { deliver: true } : {}, { reply: () => true, delay: 1200 }, 1700);
    chk('§4 city A actually left money in flight — otherwise this section tested nothing',
        s4.a.payoutInFlight > 100, 'inFlight ' + F(s4.a.payoutInFlight) + ' 🔥');
    chk('§4 a confirmation that lands after a remount is DISCARDED, not booked against the new city',
        s4.b.payoutLifetime < 1e-6 && s4.b.day === 0,
        'city B has done ' + s4.b.day + ' days and reports payoutLifetime ' + F(s4.b.payoutLifetime) +
        ' 🔥 — the one figure that means "a payout ARRIVED" now describes a city that has paid nobody');

    const s4rev = nDeliv === 1 ? await stale('deliver-reverted', { deliver: true }, { reply: () => true, delay: 1200 }, 1700) : null;
    chk('§4 …and reverting the guard really does corrupt it — this section is not vacuous',
        !!s4rev && s4rev.b.payoutLifetime > 100 && Math.abs(s4rev.b.payoutLifetime - s4rev.a.payoutInFlight) < 1,
        s4rev ? 'guard reverted and city B reported only ' + F(s4rev.b.payoutLifetime) +
        ' 🔥 delivered against ' + F(s4rev.a.payoutInFlight) + ' 🔥 in flight'
              : 'the guard text is not in index.js at all, so this proof could not be run — see §1');

    /* ── §5 NO BRIDGE AT ALL IS A FAILED DELIVERY LIKE ANY OTHER ─────────────
       claimPayout() has ALREADY moved the money `payoutOwed → payoutInFlight` by
       the time the bridge is consulted — that is the whole point of the in-flight
       term and it is why the bridge test cannot be a precondition. With the
       `else` emptied nothing ever settles it: `payoutInFlight` grows without
       bound, nothing retries it (the next tick claims only NEW money), and the
       player is paid nothing for as long as the page lives. The measurement is
       the recovery, not the balance: the bridge comes back, and the shipped tree
       delivers everything it parked while the reverted tree delivers only what
       it happened to claim afterwards. */
    const bridgeless = async (tag, revs) => {
      const M = await buildEco(tag, revs);
      global.window.MythicCityBridge = null;                 // B() → null → the `else`
      M.mount({ nodeId: 'nobridge', population: 320, state: null, established: 'new' });  // fixed id — see stale()
      for (let i = 0; i < 400; i++) M.tick(DAY, host);
      const s1 = M.snapshot();
      let wallet = 0;
      const B = makeBridge({ reply: () => true });
      const inner = B.addCinders;
      B.addCinders = async (n) => { const r = await inner(n); if (r === true) wallet += Math.floor(n); return r; };
      global.window.MythicCityBridge = B;
      for (let i = 0; i < 5; i++) M.tick(DAY, host);
      await sleep(400);
      const s2 = M.snapshot();
      console.log('   [' + tag + '] 400 bridgeless ticks → owed ' + F(s1.payoutOwed) + '  inFlight ' + F(s1.payoutInFlight) +
                  ' 🔥 | bridge returns → wallet ' + F(wallet) + '  stranded ' + F(s2.payoutInFlight) + ' 🔥');
      return { s1, s2, wallet };
    };

    const n5 = await bridgeless('nobridge' + (SAB('nobridge-drop', nBridge) ? '-SABOTAGED' : ''),
                                SAB('nobridge-drop', nBridge) ? { nobridge: true } : {});
    chk('§5 with no bridge at all the money stays on payoutOwed, where the next tick retries it',
        n5.s1.payoutOwed > 100 && n5.s1.payoutInFlight < 1e-6,
        'owed ' + F(n5.s1.payoutOwed) + '  inFlight ' + F(n5.s1.payoutInFlight) +
        ' 🔥 — money parked in flight with no bridge to settle it is money nothing will ever hand over');
    chk('§5 …so when the bridge comes back the player is paid ALL of it',
        n5.wallet > 100 && n5.s2.payoutInFlight < 1e-6 && n5.s2.payoutOwed < 1,
        'only ' + F(n5.wallet) + ' 🔥 reached the wallet, ' + F(n5.s2.payoutInFlight) + ' 🔥 still stranded');

    const n5rev = nBridge === 1 ? await bridgeless('nobridge-reverted', { nobridge: true }) : null;
    chk('§5 …and emptying the `else` really does strand it — this section is not vacuous',
        !!n5rev && n5rev.s1.payoutInFlight > 100 && n5rev.wallet < n5rev.s1.payoutInFlight / 2,
        n5rev ? 'the `else` was emptied and ' + F(n5rev.s1.payoutInFlight) + ' 🔥 in flight still delivered ' +
        F(n5rev.wallet) + ' 🔥 — find out what else is closing this'
              : 'the refund `else` is not in index.js at all, so this proof could not be run — see §1');
    if (n5rev) console.log('   shipped vs reverted, same 405 ticks: ' + F(n5.wallet) + ' 🔥 delivered vs ' +
                F(n5rev.wallet) + ' 🔥, with ' + F(n5rev.s2.payoutInFlight) + ' 🔥 stranded on the reverted tree');

    for (const d of tmpRoots) { try { rmSync(d, { recursive: true, force: true }); } catch (e) {} }
  }

  /* ── §6 THE TWO BUMPS NO BEHAVIOUR TEST CAN REACH, AND THE DOOR THEY LEAVE ──
     🔴 FOUND BY THE SAME METHOD, AND HONESTLY UNGUARDABLE BY BEHAVIOUR. Three
        more edits from this session were reverted one at a time in a copy of the
        tree outside the repo and left the gate GREEN even with §2–§5 in place:
          • `mountGen++` in mount()'s DEFERRED branch
          • `mountGen++` in resolve()
          • `load()`'s `deferred = false; deferCtx = null;`
        None of them can be made to fail by driving the module, and that is a
        FACT ABOUT THE CODE rather than a gap in the round: §2 proves a deferred
        module claims nothing, so there is never anything in flight when either
        of those two bumps happens. A behavioural round for them would have to
        manufacture a state production cannot produce, which is precisely what
        this round is not allowed to do.

     🔴 …AND THE HOLE THEY POINT AT, WHICH IS REAL. `load()` sets `mounted = true`
        after `Sim.load(raw)` — it replaces the entire simulation, exactly as
        mount() does — and it does NOT bump `mountGen`. So a settlement in flight
        across a `load()` would be applied to the loaded books. It is worse than
        the mount case: `Sim.load()` has ALREADY moved the save's `payoutInFlight`
        back onto `payoutOwed`, so a late `refundPayout()` credits the same Cinder
        a SECOND time. Today that is unreachable for one reason only — nothing in
        node-city calls `MythicEconomy.load()`; the host hands its blob to
        `mount({state})` instead.

     ⚠ DELIBERATELY NOT FIXED HERE, AND THE REASON IS THE ONE THIS PACKAGE WAS
       CREATED BY. Adding `mountGen++` to load() looks obviously right and is
       almost certainly right — but it is a behaviour change to the money path
       with no production caller to measure it against, made by the package whose
       job is to build the net. The last time someone picked the obvious answer
       on this path ("fail closed") it bricked every new player. So the decision
       is DEFERRED and the precondition is wired instead: the assertion below goes
       RED the moment anything in node-city calls `load()`, which is the only way
       the hole becomes reachable. Whoever wires it up gets told, in the same
       commit, that they now have to decide. */
  const idxLoad = srcBlockAfter(idxTxt, 'function load(raw)');
  const idxMount = srcBlockAfter(idxTxt, 'function mount(opts)');
  const idxResolve = srcBlockAfter(idxTxt, 'function resolve(opts)');
  const bumps = (s) => (s ? (s.match(/mountGen\+\+/g) || []).length : -1);
  chk('§6 mount() bumps mountGen on BOTH of its exits — the decided one and the deferred one',
      bumps(idxMount) === 2, 'found ' + bumps(idxMount) + ' — a mount that does not bump leaves the previous ' +
      'city\'s in-flight promises pointing at the new city\'s books');
  chk('§6 resolve() bumps it too — it is the second live transition and mounts a city that did not exist before',
      bumps(idxResolve) === 1, 'found ' + bumps(idxResolve));
  /* The conditional is the whole point: it permits today's tree AND fails the
     day load() acquires a caller without acquiring the bump. */
  const hostCallsLoad = /MythicEconomy\.load\(|\bE\.load\(|\bE2\.load\(/.test(ncSrc);
  chk('§6 load() either bumps mountGen and clears the deferral, or has no host caller at all',
      (bumps(idxLoad) === 1 && /deferred = false/.test(idxLoad)) || !hostCallsLoad,
      'node-city now calls MythicEconomy.load(), and load() replaces the whole simulation without bumping mountGen — ' +
      'a settlement still in flight will be applied to the loaded books, and because Sim.load() has already moved ' +
      '`payoutInFlight` back onto `payoutOwed` a late refund pays the same Cinder twice. Decide it now: see §6\'s header.');

  if (global.window) global.window.MythicCityBridge = savedBridge;

  if (fails) { bad++; console.log('\n=== ROUND 0w: ' + fails + ' FAILED ==='); }
  else console.log('\n=== ROUND 0w: ALL PASS ===');
}

for (const f of ['gauntlet1.mjs', 'gauntlet2.mjs', 'gauntlet3.mjs']) {
  console.log('\n########## ' + f + ' ##########');
  const r = spawnSync(process.execPath, [join(here, f)], { stdio: 'inherit' });
  if (r.status !== 0) bad++;
}
console.log(bad ? '\n❌ ECONOMY GAUNTLET: ' + bad + ' round(s) failed' : '\n✅ ECONOMY GAUNTLET: all rounds passed');
process.exit(bad ? 1 : 0);
