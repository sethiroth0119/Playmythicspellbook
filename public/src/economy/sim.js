/* ════════════════════════════════════════════════════════════════════════════
   🔄 SIM — the circular flow. This is where the money actually moves.
   ----------------------------------------------------------------------------
       Company → Wages → Residents → Shopping → Businesses
              → Taxes → City → Infrastructure → Economy

   Every arrow in that diagram is a TRANSFER in this file: one account is
   debited by exactly what another is credited. Nothing is created by a
   multiplier, and nothing is destroyed by a rounding shortcut.

   🔴 THE AUDIT IS THE POINT OF THIS FILE.
   `audit()` runs every tick and checks:

       Δ(households + firms + treasury + bank reserve)
         === exports + faucet − imports − payout

   If that identity fails, the simulation has minted or lost Cinder, and
   `payoutAllowed` is set false — the city stops paying its owner until the
   books balance again. node-city retired the Cinder Forge for minting currency
   with no customer behind it; this is the mechanism that makes it impossible to
   reintroduce that bug by accident, in any of the ~40 transfers below.

   ── THE CITY INVENTORY IS NOT THE GAME LEDGER ──────────────────────────────
   node-city documents the trap in detail (CITY_STOCK, §2b): `addRes('rations')`
   in parent mode either throws into a swallowed catch or invents a ledger key
   the camp UI can never show and the cloud whitelist never syncs. The chain's
   258 resources are in exactly that position — they are NOT in index.html's
   `RESOURCES`, so they must never be written through the bridge.

   So the economy holds its own `INV`, saved with the city state. The bridge is
   touched for exactly two things: reading real ledger balances that the economy
   consumes, and the audited Cinder payout. Nothing else crosses.
   ════════════════════════════════════════════════════════════════════════════ */

import { ECON } from './tuning.js';
import { DEPOSITS, RECIPES, INDUSTRIES, legsOf, industryOf, bandOf, producible } from './recipes.js';
import * as Prices from './prices.js';
import * as Endow from './endowment.js';
import * as HH from './households.js';
import * as Firms from './firms.js';
import * as Logistics from './logistics.js';
import * as Bank from './bank.js';
import * as Trade from './trade.js';

const S = {
  nodeId: null,
  day: 0,               // economic days elapsed
  dayFrac: 0,           // partial day carried between ticks
  treasury: 0,          // the city's Cinder
  /* 🏦 THE CHARTER FUND — capital held for founding businesses, and the
     lifetime tally of what was ever created to fill it. Both are inside
     totalCinder(), so drawing on the fund is a transfer the audit already
     understands. See ECON.firm.charter for why this account exists at all. */
  charter: 0,
  charterIssued: 0,
  /* 🚰 LIFETIME TALLY OF THE EXPORT FAUCET — the twin of `charterIssued`, and it
     exists for the same reason: those two are the ONLY ways Cinder is ever
     created, so together they say how much money this city has ever made.
     `flow.faucet` is zeroed every runDay and is therefore useless to anything
     that wants a lifetime figure. A readout, and the panel's answer to "where
     did this city's money come from". */
  faucetLifetime: 0,
  /* 💸 THE TWO SUBTRACTION TERMS OF THE LIFETIME IDENTITY

         created (= charterIssued + faucetLifetime)
             = totalCinder + imports + payoutDelivered + payoutOwed

     kept as lifetime tallies for the same reason their two creation twins are:
     `S.flow.*` is wiped by `zeroFlow()` at the top of every runDay, so nothing
     else in the module can say what this city has spent abroad or handed its
     owner over its life.

     ⚠ READOUTS, NOT ENFORCEMENT. A load-time clamp used to consume both to size
       a ceiling on `payoutOwed`; that clamp is gone (see the header above
       `audit()` for the three measured reasons). Nothing on disk can prove a
       city really spent what it says it spent, and building an arbitration on
       these would repeat exactly that mistake. They are here so the panel and
       the gate can ask where the money went. */
  importsLifetime: 0,
  /* ⚠ CONFIRMED DELIVERY ONLY — never incremented by `claimPayout()`. A claim
     the bridge then refuses is put back by `refundPayout()`, and a claim tallied
     at claim time would make a refund look like money the player had already
     received. index.js increments this in the `.then()` and nowhere else, and
     round 0s §4's bridge-down round-trip is what holds that line. */
  payoutLifetime: 0,
  /* Lifetime tally of wound-up firms' cash received into the treasury. Purely a
     readout — the estate is a transfer and appears in no audit identity — but
     without it nothing can tell "no firm ever closed holding cash" apart from
     "the wind-up path is broken again". */
  estateReceived: 0,
  /* 💼 LIFETIME TALLY OF PRIVATE CAPITAL SUBSCRIBED INTO NEW BUSINESSES, and it
     is a lifetime tally for the same reason `estateReceived` above it is: a
     founding happens BETWEEN two runDays (the host's 4 s `syncBuildings`), so a
     per-day `flow` key is wiped by the `zeroFlow()` at the top of the very next
     runDay and reads 0 to everything that ever looks at it. That is not a
     hypothetical — it was written as `flow.equity` first, and every sample of a
     600-day run read exactly 0.0 while the mechanism was funding every single
     founding in the city.
     🔴 A READOUT, NOT A BOOKING. Both ends of the transfer are firm cash, i.e.
        the same term of `totalCinder()`; `audit()` does not mention this and
        deleting it changes no balance. Not serialised, exactly like
        `estateReceived` — a reloaded city reports what IT has subscribed. The
        per-firm `rentLife` beside it in firms.js IS serialised, because a
        closure sentence that is true before a reload and false after it is
        worse than no sentence; this one is only ever a running total. */
  equitySubscribed: 0,
  /* 🔴 THE TREASURY DRAW ALLOWANCE IS PER WINDOW, NOT PER FOUNDING.
     `treasuryDrawPct` used to be applied to the REMAINING balance on every call,
     and `syncBuildings` founds every new tile in ONE pass — so N foundings took
     1 − 0.65^N of the treasury. Measured: nine tiles in a single sync took
     91.15% (10,000.00 → 885.39 🔥), which is the exact opposite of what the
     percentage is for ("a founding that empties it starves the stabilisers").
     So the allowance is computed ONCE per founding window and decremented, and
     the window is the gap between ticks — see `armFoundingWindow`. */
  foundingDrawBudget: 0,
  foundingDrawArmed: false,
  INV: {},              // resource id → units held by the city
  /* ⚰ The last ~120 businesses that were wound up and deleted, so something
     outside this module can say WHICH one died and how. Read-only, bounded,
     never serialised, and no term of `totalCinder()` — see the note at the
     `reap()` call in runDay. */
  closures: [],
  /* Per-day flow readouts, for the panel and the audit. */
  flow: { wages: 0, shopping: 0, b2b: 0, rent: 0, tax: 0, benefits: 0,
          imports: 0, exports: 0, faucet: 0, payout: 0, freight: 0, interest: 0,
          civic: 0, infrastructure: 0, upkeep: 0, welfare: 0, unmetSubsistence: 0,
          founding: 0, estate: 0,
          /* 🏷 GROUND RENT collected from businesses today. A READOUT OF A
             TRANSFER, never a booking — the money moved from firms to the
             landlords and to the treasury inside `runGroundRent`, and both ends
             are already terms of `totalCinder()`. `audit()` does not mention it
             and deleting the key would leave the books balancing exactly as
             they do. (The private-capital subscription that pairs with it is
             NOT here, and could not be: see `equitySubscribed` below.) */
          groundRent: 0,
          /* 🔌 UTILITY TRADE — READOUTS ONLY, AND THAT DISTINCTION IS THE WHOLE
             SAFETY ARGUMENT. Electricity crossing the outside connection is
             settled by `settleUtility()` through the SAME two channels goods
             already use: the import leg is debited from the treasury and booked
             to `flow.imports`, the export leg is folded into the day's export
             revenue and enters through the SAME capped faucet. These two keys
             are a breakdown of that, never a second booking — nothing reads
             them, `audit()` does not mention them, and if they were deleted the
             books would balance exactly as they do now. See the header above
             `settleUtility`. */
          utilityImport: 0, utilityExport: 0,
          /* 💰 Declared, not created on first payout. `zeroFlow()` iterates the
             keys that EXIST, so a key born mid-run made the flow object a
             different shape in a warm process than in a cold one. Harmless here
             (nothing reads it before it is written, and adding 0.0 to a sum is
             exact) — but "reset() leaves the module in one known state" has to be
             provable by reading, and a field that appears out of nowhere is not.
             See logistics.js `congestionMul` for the same pattern where it was
             NOT harmless and silently biased every measurement in the gate. */
          dividends: 0,
          /* 🚚 HOW MUCH OF THE HAULAGE BILL LEFT THE CITY — a READOUT of the part
             of the day's freight that went to outside carriers because the city
             has no haulage firms of its own, and is therefore booked to
             `imports` rather than to `freight`.
             It exists because that Cinder used to be booked to BOTH, and the
             payout basis at step 10 subtracts benefits + imports + freight — so
             one payment was netted twice, and every Cinder that drained from the
             treasury reduced the recorded outgoings by two. See step 4 for the
             measurement. Keeping the amount visible here is what lets a reader
             check that the two buckets are now disjoint. */
          freightAsImport: 0 },
  payoutAllowed: true,
  payoutOwed: 0,        // accumulated, withdrawn by the host through the bridge
  /* 💸 CLAIMED, HANDED TO THE BRIDGE, NOT YET SETTLED — AND THE PLAYER'S MONEY
     DIED HERE ON EVERY TAB CLOSE UNTIL THIS FIELD EXISTED.
     ------------------------------------------------------------------------
     `claimPayout()` debits `payoutOwed` SYNCHRONOUSLY and returns; the bridge
     confirms or refuses a network round trip later, and only then does
     `notePayoutDelivered()` or `refundPayout()` run. Commit cd68272 fixed the
     REJECTION path — a refusal now goes back on `payoutOwed`. It did not, and
     could not, fix the path where nothing settles at all because the page is
     gone: `pagehide`, `visibilitychange` and the 800ms `saveSoon` timer all
     write the save wherever the RPC happens to be, and a save written in that
     window recorded the amount NOWHERE. It had left the treasury on the day it
     was drawn, it was not on `payoutOwed`, and it was not in `payoutLifetime`.

     MEASURED on the tree before this field existed, one ordinary 200-day city,
     save taken mid-RPC and reloaded: 19.00 🔥 gone from the file permanently,
     with `lastAudit.ok === true` — because none of it happens inside runDay's
     window, which is the same blind spot the founding mint and the save-file
     mint lived in.

     THE FIX IS TO MAKE THE IN-FLIGHT AMOUNT A FIRST-CLASS TERM: claim moves it
     `payoutOwed → payoutInFlight`, both settlement paths move it back out, it
     is SERIALIZED, and `load()` moves whatever the save carries back onto
     `payoutOwed` — because an RPC result that has not arrived by the time the
     page is reloaded died with the page, and the only safe reading of "we do
     not know whether the player got it" is to owe it again. The worst case of
     that reading is paying a tick's payout twice after a browser crash that
     killed the page between a successful `addCinders` and the next save; the
     worst case of the other reading is silently destroying the player's money,
     which is what shipped. `payoutOwed` is deliberately NOT a term of
     `totalCinder()`, and neither is this — the Cinder left the city's accounts
     on the day it was drawn — so neither field can move the audited total. */
  payoutInFlight: 0,
  lastAudit: null,
  log: [],              // [{day, kind, msg}]
  booted: false,
  outputValue: {},      // resId → Cinder of value produced today (specialization)
  serviceValue: {},     // industry → Cinder of service revenue today
  observed: {},         // resId → {supply, demand}
  demandEMA: {},        // resId → smoothed daily offtake (see productionTargets)
  /* 🔌 THE UTILITY LINK — energy another module measured, waiting to be paid
     for. See `noteUtilityTrade` and `settleUtility` for why the money moves
     here and not where the energy was measured. NOT a term of `totalCinder()`:
     `owedImport` and `earnedExport` are obligations that have not moved yet,
     and `arrears` is a debt, not a balance. All three ride the save. */
  utility: { owedImport: 0, earnedExport: 0, arrears: 0,
             importUnitMin: 0, exportUnitMin: 0,
             /* Last settlement, for the panel that measured the energy: what it
                asked for, what actually cleared. A meter that reports what it
                REQUESTED rather than what it was PAID is the shape of every
                leak ECONOMY.md lists. */
             last: { day: -1, billed: 0, paid: 0, arrears: 0, earned: 0,
                     importUnitMin: 0, exportUnitMin: 0 } },
};

export function state() { return S; }
export function treasury() { return S.treasury; }
export function inventory() { return S.INV; }

/* 📦 THE ONE WAY GOODS MAY LEAVE THIS CITY FOR AN OUTSIDE BUYER.
   ---------------------------------------------------------------------------
   A city-trade agreement ships real stock to another player's city. Before this
   existed the only honest answer the bridge could give was `city: 0`, because
   `inventory()` hands back the LIVE S.INV and any caller could have drained it
   — silently, unclamped, with no entry in the city log and no catalogue check.

   WHY THIS IS SAFE TO ADD, stated rather than assumed:
   · The tick audit is a CINDER audit. It compares totalCinder() at the top of
     runDay with the same at the bottom and suspends the payout on a mismatch.
     Goods are not a term of it, and they already appear (production) and vanish
     (household consumption, exports) every single day. Removing stock for an
     export is an ordinary operation in this model, not a hole in it.
   · What WOULD have been a hole is minting. This function can only ever
     SUBTRACT: units is clamped to what is on the shelf, negatives are refused,
     and there is no path here that raises S.INV.

   ⚠ CATALOGUED IDS ONLY. `producible()` is the same guard trade.js's
     recordFill uses. An uncatalogued id would create an S.INV key that no
     recipe, price or panel knows about — the mirror of the addRes() trap
     CLAUDE.md documents in the other direction.
   ⚠ RETURNS WHAT IT ACTUALLY TOOK, and the caller must honour that rather than
     what it asked for. /src/citytrade refuses the whole shipment when the three
     stores together fall short, so a partial take here is put back by its
     unwinding step — but a caller that assumed success would ship goods it
     never received. Never assume the ask.
   ⚠ NOT A SALE. No Cinder is credited: the counterparty's payment is whatever
     the agreement's other leg says it is, and inventing a price here would put
     a second, unaudited valuation next to Prices.priceOf(). */
export function takeForExport(id, units) {
  const want = Number(units);
  if (typeof id !== 'string' || !id) return 0;
  if (!Number.isFinite(want) || want <= 0) return 0;
  if (!producible(id)) return 0;
  const have = Number(S.INV[id]) || 0;
  if (have <= 0) return 0;
  const took = Math.min(have, want);
  S.INV[id] = have - took;
  logEvent('info', '🚚 ' + took.toFixed(2) + '× ' + id + ' shipped out under a trade agreement.');
  return took;
}

/* ↩ PUT BACK WHAT takeForExport JUST TOOK — and nothing else.
   A shipment has three legs (city, vault, Bank of Ethos) and the bank leg is a
   network call that can fail after the city leg has already come off the shelf.
   Without this, that failure strands the goods: gone from the city, never
   delivered, unrecoverable.

   🔴 THIS IS A REFUND, NOT A GRANT, and the distinction is one this codebase
      already draws explicitly — /src/trading/settle.js routes a put-back
      through `_refundRes` (uncapped) and a genuine gain through `addRes`
      (capped), because conflating them once destroyed 215 units of a player's
      resources. Same rule: call this ONLY to undo a takeForExport in the same
      call stack. Anything else is minting goods, and goods that appear from
      nowhere distort every price the sim derives from scarcity.
   ⚠ Deliberately NOT exported through MythicEconomy as a general "add stock"
     verb. There is no such verb, and there should not be one. */
export function returnFromExport(id, units) {
  const back = Number(units);
  if (typeof id !== 'string' || !id) return 0;
  if (!Number.isFinite(back) || back <= 0) return 0;
  if (!producible(id)) return 0;
  S.INV[id] = (Number(S.INV[id]) || 0) + back;
  logEvent('info', '↩ ' + back.toFixed(2) + '× ' + id + ' returned — the shipment did not leave.');
  return back;
}

/* What a trade agreement could draw right now, without taking it. Read-only
   companion to takeForExport so the dialog can show a number it will honour. */
export function exportableStock(id) {
  if (typeof id !== 'string' || !id || !producible(id)) return 0;
  const have = Number(S.INV[id]) || 0;
  return have > 0 ? have : 0;
}
export function day() { return S.day; }
export function invOf(id) { return S.INV[id] || 0; }

const LOG_MAX = 120;
function logEvent(kind, msg) {
  S.log.push({ day: S.day, kind, msg });
  if (S.log.length > LOG_MAX) S.log.splice(0, S.log.length - LOG_MAX);
}
export function log() { return S.log.slice(); }

export function reset(nodeId) {
  S.nodeId = nodeId == null ? null : String(nodeId);
  S.day = 0; S.dayFrac = 0; S.treasury = 0; S.INV = {};
  S.charter = 0; S.charterIssued = 0; S.faucetLifetime = 0; S.estateReceived = 0;
  S.importsLifetime = 0; S.payoutLifetime = 0; S.equitySubscribed = 0;
  S.foundingDrawBudget = 0; S.foundingDrawArmed = false;
  /* ⚠ `payoutInFlight` IS ZEROED HERE AND THAT IS WHY index.js GUARDS ITS
     SETTLEMENT WITH `mountGen`. reset() runs on every mount; a promise from the
     previous city landing afterwards must not decrement a term that now belongs
     to a different city. */
  S.payoutAllowed = true; S.payoutOwed = 0; S.payoutInFlight = 0;
  S.log = []; S.booted = false; S.closures = [];
  S.outputValue = {}; S.serviceValue = {}; S.observed = {}; S.demandEMA = {};
  /* 🔌 …including the utility link, and including its ARREARS. A debt that
     survived reset() would follow one city's unpaid electricity bill into the
     next city loaded in the same page, and would curtail a grid that had never
     imported a watt. */
  S.utility = { owedImport: 0, earnedExport: 0, arrears: 0,
                importUnitMin: 0, exportUnitMin: 0,
                last: { day: -1, billed: 0, paid: 0, arrears: 0, earned: 0,
                        importUnitMin: 0, exportUnitMin: 0 } };
  /* Cleared for the same reason as everything above it: after reset() this module
     must hold ONE known state, so that "is a repeat run identical" is a question
     answered by reading the code rather than by running it twice and hoping. This
     one is a pure readout and carried no drift; `Logistics.congestionMul` looked
     exactly as harmless and was the carrier of a 1.9% run-order swing. */
  S.lastAudit = null;
  zeroFlow();
  HH.reset(); Firms.reset(); Bank.reset(); Trade.reset(); Logistics.reset(); Prices.reset();
  Endow.invalidate();
}

function zeroFlow() {
  for (const k in S.flow) S.flow[k] = 0;
}

export function setNode(nodeId) {
  const id = nodeId == null ? null : String(nodeId);
  if (id === S.nodeId) return;
  S.nodeId = id;
  Endow.invalidate();
}

/* 💸 EVERY CINDER THAT LEAVES THE CITY GOES THROUGH HERE, and it is one call
   rather than five `S.flow.imports += x` sites so that the lifetime tally is
   exact — a readout assembled from five call sites is a readout that drifts.
   ⚠ TALLYING AT THE END OF runDay WOULD HAVE BEEN WRONG, and it was the obvious
     first shape. `runPartial()` also runs production and shopping, both of which
     import, and the next `runDay` opens with `zeroFlow()` — so a day-end tally
     silently drops every partial tick's imports, by however long the host ticks
     below one whole day. Tally where the money actually moves. */
function addImports(amount) {
  if (!(amount > 0)) return;
  S.flow.imports += amount;
  S.importsLifetime += amount;
}

/* ════════════════════════════════════════════════════════════════════════════
   🔌 THE UTILITY LINK — electricity crossing the outside connection.
   ----------------------------------------------------------------------------
   /src/power measures how much energy went out over the Highway Interchange and
   how much came in, and it prices that energy against node-city's own per-minute
   Cinder scale (POWER.trade — see its header for the derivation). It does NOT
   move any money. It calls `noteUtilityTrade()` and stops.

   🔴 WHY THE MONEY MOVES HERE AND NOWHERE ELSE, and this is Rule 1 itself.
      Cinder is never minted. There are exactly two channels through which value
      may cross this city's boundary and both are already audited:
        · OUT — `addImports()`, debited from the treasury, an `outgoings` term.
        · IN  — the export FAUCET, and only against real exported volume, hard
                clamped by `ECON.faucet.maxPerMin`.
      Exported electricity is real exported volume, so it goes through the
      faucet, under the SAME per-day ceiling goods revenue is under — one
      faucet, one cap, and no combination of the two can turn into the Forge.
      Crediting the player for exported power anywhere else would be the retired
      Cinder Forge with a new label on it, and it would look completely correct
      in review, exactly as all four leaks in ECONOMY.md did.

   🔴 AND WHY IT MOVES INSIDE runDay AND NOT WHEN IT IS MEASURED.
      `audit()` compares `totalCinder()` at the top of runDay with the same at
      the bottom. Money that moves BETWEEN two windows is invisible to it — that
      is not a theory, it is the blind spot the founding mint lived in for its
      whole life ("the books balanced because the minting happened between two
      audit windows"). The power tick runs at the host's cadence, which is
      nowhere near an economic day, so what it reports is ACCUMULATED here and
      SETTLED from inside runDay, where the audit can see every Cinder of it.

   🔴 AND WHY AN UNPAID BILL CURTAILS THE IMPORT INSTEAD OF BEING FORGIVEN.
      `settleUtility` pays `min(treasury, billed)` like every other municipal
      charge in this file. The difference is that the ENERGY WAS ALREADY
      DELIVERED — the city ran on it. Writing the shortfall off would hand the
      player free electricity, which is precisely the "credited whether or not
      the shop could pay" shape of the third leak. So the shortfall becomes
      `arrears`, it is reported back, and /src/power stops importing until it
      clears. The neighbour cuts you off; the panel says so.
   ════════════════════════════════════════════════════════════════════════════ */

/** Called by /src/power once per host tick. Values are in Cinder; the unit-min
    figures ride along purely so the panel can report what actually cleared
    rather than what it asked for. Accumulates only — moves nothing. */
export function noteUtilityTrade(t) {
  if (!t || typeof t !== 'object') return false;
  const U = S.utility;
  /* ⚠ EVERY FIELD IS SANITISED, because this one is called from ANOTHER MODULE
     and gauntlet round 1 exists because a NaN from the host poisoned the
     treasury and the audit with it. A non-finite or negative figure is dropped,
     not clamped to something plausible. */
  const num = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : 0);
  U.owedImport   += num(t.importValue);
  U.earnedExport += num(t.exportValue);
  U.importUnitMin += num(t.importUnitMin);
  U.exportUnitMin += num(t.exportUnitMin);
  return true;
}

/** What /src/power needs to know to draw an honest meter and to curtail. */
export function utilityReport() {
  const U = S.utility;
  return { arrears: U.arrears,
           pendingImport: U.owedImport, pendingExport: U.earnedExport,
           pendingImportUnitMin: U.importUnitMin, pendingExportUnitMin: U.exportUnitMin,
           last: { day: U.last.day, billed: U.last.billed, paid: U.last.paid,
                   arrears: U.last.arrears, earned: U.last.earned,
                   importUnitMin: U.last.importUnitMin, exportUnitMin: U.last.exportUnitMin } };
}

/* Settles the day's link. Returns the EXPORT revenue, which the caller folds
   into the day's export earnings so it passes under the one faucet ceiling.
   ⚠ RUNS INSIDE runDay's audit window. Called from exactly one place. */
function settleUtility() {
  const U = S.utility;
  const billed = U.owedImport + U.arrears;
  const paid = Math.min(Math.max(0, S.treasury), billed);
  if (paid > 0) {
    S.treasury -= paid;
    addImports(paid);                 // the Cinder left the city with the energy
    S.flow.utilityImport += paid;     // …and the same Cinder, broken out. Readout.
  }
  U.arrears = Math.max(0, billed - paid);
  if (U.arrears > 0 && U.owedImport > 0) {
    logEvent('bad', 'The city could not pay its electricity bill (' +
      U.arrears.toFixed(2) + ' 🔥 outstanding). The neighbouring grid has cut the import.');
  }
  const earned = U.earnedExport;
  U.last = { day: S.day, billed, paid, arrears: U.arrears, earned,
             importUnitMin: U.importUnitMin, exportUnitMin: U.exportUnitMin };
  U.owedImport = 0; U.earnedExport = 0; U.importUnitMin = 0; U.exportUnitMin = 0;
  return earned;
}

/* ── Inventory helpers. All resource movement goes through these two so a
   future audit of GOODS (not just Cinder) has one place to hook. */
function addInv(id, n) { if (n > 0) S.INV[id] = (S.INV[id] || 0) + n; }
function takeInv(id, n) {
  const have = S.INV[id] || 0;
  const got = Math.min(have, Math.max(0, n));
  if (got > 0) S.INV[id] = have - got;
  return got;
}

/* ════════════════════════════════════════════════════════════════════════════
   🏦 CHARTER CAPITAL — the ONLY place a new business's seed cash comes from.
   ----------------------------------------------------------------------------
   🔴 THE BUG THIS REPLACES, and it is Rule 1 itself.
   `Firms.found()` credited every new firm `dailyOperatingCost × startCashDays`
   and debited nothing. The audit could not see it, and not by accident: the
   host calls `syncBuildings` from a 4 s setInterval, while `runDay` captures
   `before` at its own top — so every tile-founded firm was chartered in the gap
   BETWEEN two audit windows, and the books balanced because the minting
   happened while nobody was counting. Measured on the pre-fix tree, a city with
   all 47 mapped tile types over 240 days: 721,771 🔥 minted at founding against
   −6,159 🔥 of audited flow, audit clean, payouts enabled the whole way.

   THE FIX IS TWO PARTS, and the second one is why this is not just the same
   mint wearing a hat:

     1. FOUNDING IS A TRANSFER. `fundFounding()` moves Cinder from the charter
        fund (and, when that is dry, from the treasury) into the firm. Both
        terms live inside `totalCinder()`, so a founding between ticks moves the
        total by exactly zero and the next day's audit is undisturbed.
     2. FILLING THE FUND IS AN AUDITED, BOUNDED FAUCET. `issueCharter()` is the
        only creation, it happens INSIDE runDay where the audit window can see
        it, it is counted in `S.flow.founding` and carried in the audit
        identity, it is rate-limited per day, and it is capped for the lifetime
        of the city by ECON.firm.charter.lifetimeCap. `audit()` asserts that cap
        independently, so a future edit that bypasses the clamp fails the audit
        instead of quietly printing money again.

   WHAT HAPPENS WHEN NEITHER ACCOUNT CAN PAY: the firm founds with LESS, down to
   nothing. It is not refused (the host has already built the building and taken
   the player's money for it — refusing here would leave a tile that is a
   business in the city and not one in the economy, which is the exact
   desynchronisation round 0c exists to catch) and it is never topped up out of
   thin air. It opens under-capitalised and the distress ladder takes it from
   there, which is the announcement's "a store built somewhere with no customers
   can lose money" arriving one step earlier.
   ════════════════════════════════════════════════════════════════════════════ */
function issueCharter(want) {
  const cap = ECON.firm.charter.lifetimeCap;
  const room = Math.max(0, cap - S.charterIssued);
  const add = Math.max(0, Math.min(want, room));
  if (add <= 0) return 0;
  S.charter += add;
  S.charterIssued += add;
  return add;
}

/* Called once per economic day, from inside the audited window. Tops the fund
   back toward its target so a city that keeps building keeps being able to
   capitalise what it builds — until the lifetime allowance is spent, after
   which new businesses are funded out of the city's own money or not at all. */
function topUpCharter(days) {
  const C = ECON.firm.charter;
  const want = Math.min(Math.max(0, C.fundTarget - S.charter), C.maxPerDay * Math.max(0, days));
  const got = issueCharter(want);
  if (got > 0) S.flow.founding += got;
  return got;
}

/* ── 🪟 THE FOUNDING WINDOW ──────────────────────────────────────────────────
   🔴 THE BUG THIS EXISTS FOR, measured before it was written: `fundFounding`
   applied `treasuryDrawPct` to the treasury balance REMAINING at that instant,
   once per founding. But foundings are not spread out — `syncBuildings` walks
   every new tile in a single pass, so N of them took 1 − 0.65^N of the city's
   money: nine tiles in ONE sync took 91.15% of a 10,000 🔥 treasury, leaving
   885.39 🔥. The percentage was written to protect the stabilisers ("a founding
   that empties it starves the stabilisers") and instead it emptied them, which
   is worse than having no ceiling at all because the comment says otherwise.

   So the allowance is a BUDGET for a WINDOW: computed once against the balance
   the foundings will actually draw on, decremented per founding, and refilled
   at the close of each economic day.

   ⚠ THE WINDOW IS ARMED AT THE END OF runDay, NOT AT THE TOP. Foundings happen
     BETWEEN ticks (the host's 4 s `syncBuildings`), so the balance that matters
     is the one standing when the day's benefits, imports, freight and payout
     have already been paid. Arming at the top of the day would size the budget
     from money the day then spends, and a sync landing after a heavy day could
     still take far more than `treasuryDrawPct` of what was actually left.
   ⚠ IT ALSO ARMS LAZILY. A city that is `load()`ed and built on before its
     first tick would otherwise have a zero budget and found everything short,
     so the first draw of an unarmed window sizes itself from the balance then. */
function armFoundingWindow() {
  S.foundingDrawBudget = Math.max(0, S.treasury) * ECON.firm.charter.treasuryDrawPct;
  S.foundingDrawArmed = true;
}

/* ── 💼 PRIVATE CAPITAL — the city's own savers back the next business ───────
   🔴 THE FINDING THIS EXISTS FOR, measured on a 34-lot commercial district
   driven 600 economic days: past day 480 `charterIssued` was pinned at its
   700,000 🔥 lifetime ceiling and `charter` had drained to 0, so every
   re-founded shopfront opened with nothing and died from an empty till, for
   ever — 90 re-foundings, all with the same ledger sentence, all of them
   naming the wrong cause. AND THE CITY WAS NOT POOR: 692,528 🔥 of its
   696,048 🔥 was firm cash, 74% of it in one landlord and one power plant,
   against 2,275 🔥 in household savings and 72 🔥 in the treasury.

   So the fault is not the size of the charter fund. It is that the circular
   flow has no arrow from SAVINGS back to NEW BUSINESS: money that reaches an
   incumbent's till can be spent on inputs, on wages, on upkeep and on
   dividends, and can never be invested. This is that arrow. See
   ECON.firm.privateCapital for the full argument, the four rejected designs,
   and why the floor is a floor rather than a percentage.

   🔴 IT MOVES THE AUDITED TOTAL BY EXACTLY ZERO. Both ends are firm cash, i.e.
   the same term of `totalCinder()`, so a founding in the host's between-tick
   gap is invisible to `audit()` in the only sense that is safe — because
   nothing was created or destroyed, not because nobody was counting. That
   distinction is the whole of ECONOMY.md's founding-mint story.

   ⚠ THE NEWBORN IS EXCLUDED FROM ITS OWN SUBSCRIPTION, AND IT IS BELT AND
     BRACES TODAY. `Firms.found()` calls the capital source BEFORE it pushes the
     firm onto the roster, so `alive()` does not contain it yet — and it holds 0
     cash, so it would fail the floor twice over. The guard is here because
     "it would fail anyway" is exactly how a firm comes to fund itself the first
     time somebody reorders `found()` or relaxes the floor, and a firm that
     subscribes its own seed capital is a mint that costs nothing to write. */
function drawPrivateCapital(need, newborn) {
  const P = ECON.firm.privateCapital;
  if (!P || !(P.floorDays > 0) || !(need > 0)) return 0;
  const pool = [];
  let surplus = 0;
  for (const inv of Firms.alive()) {
    if (inv === newborn) continue;
    if (inv.rung !== 'HEALTHY') continue;
    if (P.requireProfit && !(inv.lifetimeProfit > 0)) continue;
    const floor = Math.max(0, Firms.dailyOperatingCost(inv)) * P.floorDays;
    const s = inv.cash - floor;
    if (s > 1e-6) { pool.push({ inv, s }); surplus += s; }
  }
  if (surplus <= 1e-6) return 0;
  const take = Math.min(need, surplus * P.maxShareOfPool);
  if (take <= 1e-6) return 0;
  /* Pro rata on surplus, so the firm with the most spare money puts up the most
     of it and no single investor is singled out by roster order. `withdrawCapital`
     clamps to the balance, so float drift can only ever take LESS. */
  let got = 0;
  for (const p of pool) got += Firms.withdrawCapital(p.inv, take * (p.s / surplus));
  S.equitySubscribed += got;
  return got;
}

/* The capital source firms.js calls at every founding.
   ORDER: private capital, then the charter fund, then the treasury.
   🔴 PRIVATE FIRST, AND THAT IS THE FIX FOR THE TREADMILL. The charter
   allowance is finite and irreplaceable — 700,000 🔥 for the whole life of a
   city — while private surplus regenerates every day the city trades. Spending
   the irreplaceable account while the city is sitting on 692,528 🔥 of
   replaceable one is exactly how the fund came to be dry on day 480. At
   bootstrap there is no private surplus at all (a firm has to be HEALTHY, in
   lifetime profit, and holding 30 days of cover before it can be a source), so
   the opening city is funded from the charter tranche exactly as before.
   Treasury remains LAST: it is the money the city needs the same day for
   benefits, imports and freight. */
function fundFounding(f, want) {
  const need = Math.max(0, Number(want) || 0);
  if (need <= 0) return 0;
  let paid = drawPrivateCapital(need, f);
  if (paid < need - 1e-9) {
    const fromCharter = Math.max(0, Math.min(S.charter, need - paid));  // never a negative "draw"
    S.charter -= fromCharter;
    paid += fromCharter;
  }
  if (paid < need - 1e-9) {
    /* The fund is dry. The city may still back the business out of its own
       treasury — that is a genuine investment of money the city earned, and it
       is bounded, for the WHOLE window rather than per call, so no number of
       foundings in one sync can empty the stabilisers. */
    if (!S.foundingDrawArmed) armFoundingWindow();
    const fromTreasury = Math.max(0, Math.min(need - paid, S.foundingDrawBudget, Math.max(0, S.treasury)));
    S.foundingDrawBudget -= fromTreasury;
    S.treasury -= fromTreasury;
    paid += fromTreasury;
  }
  if (paid < need - 1e-9) {
    logEvent('city', '🏦 ' + (f && f.name ? f.name : 'A new business') + ' opened under-capitalised — ' +
                     Math.round(need - paid).toLocaleString() + ' 🔥 of seed capital could not be funded.');
  }
  return paid;
}
Firms.setCapitalSource(fundFounding);

/* ── ⚰ THE ESTATE RECEIPT — the closing half of the same seam ────────────────
   🔴 THE BUG THIS REPLACES IS THE MINT'S MIRROR IMAGE, in the same function, in
   the same blind spot. `syncBuildings` marks a demolished tile's firm BANKRUPT
   and `Firms.reap()` deleted it; its cash simply left `totalCinder()` between
   two ticks, so the day audit balanced and payouts stayed enabled. Measured on
   the shipping tree: 12 demolitions in a 60-day city destroyed 42,612.05 🔥,
   8.73% of that city's money supply, err=-0.000000.

   A closing business is wound up: what it still holds lands in the treasury as
   the city's estate receipt — the same account, and the same reasoning, as the
   expansion spend in `levelUp` (a firm's cash leaving the firm has to arrive
   somewhere or it is destroyed, and destruction fails the audit exactly as
   minting does, only quieter).

   ⚠ IT IS NOT MUNICIPAL INCOME. `S.flow.estate` is recorded for the panel and
     for diagnosis, and it is deliberately NOT in the payout's income terms
     (tax + faucet): a city that bulldozes its own factories must not be able to
     pay its owner out of the wreckage. It is a transfer, so the audit identity
     is untouched — which is the entire point. */
function receiveEstate(f, amount) {
  const amt = Math.max(0, Number(amount) || 0);
  if (amt <= 0) return 0;
  S.treasury += amt;
  S.flow.estate += amt;
  S.estateReceived += amt;
  logEvent('city', '⚰ ' + (f && f.name ? f.name : 'A business') + ' was wound up — ' +
                   Math.round(amt).toLocaleString() + ' 🔥 of its remaining cash went to the city.');
  return amt;
}
Firms.setEstateSink(receiveEstate);

/* ── ⏱ AND THE THIRD SEAM, WHICH MOVES NOTHING AT ALL ───────────────────────
   The two above exist because firms.js may not touch an account it does not
   own. This one exists because firms.js may not READ a clock it does not own,
   for the identical structural reason: sim.js already imports firms.js, so
   firms.js importing sim.js back to reach `S.day` would close a load-time
   cycle. One function, one integer, no balance on either side of it.

   ⚠ `S.day` AND NOT `S.day + S.dayFrac`. The stamp is compared against `S.day`
     by every reader, and mixing a fractional stamp with an integer day would
     make a firm founded at 09:59 on day 12 read as −0.99 days old for the rest
     of that day. Whole days on both sides; the loss is under one economic day
     on a quantity nothing prints to better than a tenth of a year (≈ 2.4 days).
   ⚠ REJECTED: stamping the wall clock instead, so that /src/lifepath could
     compare it directly against game.cityAge. The two clocks are NOT the same
     clock — `ECON.clock.maxCatchUpDays` deliberately drops idle days, so a city
     left running in a background tab advances cityAge and not S.day — and a
     package whose whole state is denominated in economic days must not store
     one field in a different unit for a consumer's convenience. */
Firms.setClockSource(() => S.day);

/* ════════════════════════════════════════════════════════════════════════════
   🏗 SEEDING — a city with no firms has no economy, so bootstrap one from what
   the ground actually supports. Only ever runs once; after that the player's
   buildings and the market drive what exists.
   ════════════════════════════════════════════════════════════════════════════ */
/* 🌱 SEED A WHOLE CHAIN, NOT A LONE FACTORY.
   Walks `target` back through its recipe and founds a firm for every step the
   node can actually support, inputs first. A step whose raw is NOT in the
   ground is skipped — that resource will have to be imported, which is the
   trade layer's job and exactly the dependency this update is built around.

   🔴 WHY THIS EXISTS: the first version of bootstrap() founded a bakery and a
   waterworks with no wheat farm and no water intake behind them. Both had zero
   input availability from the first tick, produced nothing, earned nothing, and
   were bankrupt inside fifty days. The simulation was right and the seeding was
   wrong — a business with no suppliers SHOULD fail, so the fix belongs here and
   not in the failure ladder. */
function seedChain(target, seen, depth) {
  seen = seen || new Set();
  if (seen.has(target) || (depth || 0) > 8) return 0;
  seen.add(target);
  const nodeId = S.nodeId;
  let founded = 0;

  if (DEPOSITS[target]) {
    if (!Endow.canExtract(nodeId, target)) return 0;      // not in this ground
    if (!Firms.byOutput(target).length) {
      Firms.found(target, { capacity: Endow.extractRate(nodeId, target) * 2 });
      founded++;
    }
    return founded;
  }
  const leg = legsOf(target)[0];
  if (!leg) return 0;
  let inputsOk = true;
  for (const inp in (leg.in || {})) {
    const got = seedChain(inp, seen, (depth || 0) + 1);
    founded += got;
    /* An input that is neither producible here nor already produced has to be
       bought in. That is allowed — but only for ONE leg of a chain. A step
       whose every input must be imported is not a business this city can run
       on day one, so it is left unseeded rather than founded to starve. */
    if (!got && !Firms.byOutput(inp).length && !BYPRODUCT_OK.has(inp)) inputsOk = false;
  }
  if (!inputsOk) return founded;
  if (!Firms.byOutput(target).length) { Firms.found(target, {}); founded++; }
  return founded;
}
/* Byproducts arrive from the city's own activity rather than from a supplier,
   so a recycling step is never blocked for want of a waste "producer". */
const BYPRODUCT_OK = new Set(['wastewater', 'residentialWaste', 'commercialWaste',
  'industrialWaste', 'organicWaste', 'electronicWaste', 'medicalWaste', 'hazardousWaste']);

export function bootstrap(opts) {
  if (S.booted) return false;
  S.booted = true;
  opts = opts || {};
  const nodeId = S.nodeId;

  /* 🏦 THE FOUNDING TRANCHE, issued before a single firm exists.
     This is the city's opening capital and it is the one issuance that is NOT
     carried in a flow term — it happens before the first audit window opens, so
     it is an INITIAL CONDITION in the same sense as the household savings the
     city starts with, not a movement inside a day. (Flowing it would be worse
     than useless: `runDay` zeroes the flows at line ~825, after taking
     `before`, so the term would be wiped before the first audit ever read it,
     and any attempt to carry it would show up as a phantom mint on day 1.)
     It still counts against `charterIssued`, so the lifetime cap bounds the
     bootstrap and everything after it together.

     🔴 …AND IT IS RE-ARMED BY DELETING ONE KEY FROM THE SAVE, which is why
     `opts.established` exists. `reset()` zeroes `charterIssued` and `booted`,
     and node-city reads a missing `economy` key as `null` (:23599) and mounts
     with no state — so a player who deletes that key gets a fresh 300,000 🔥
     tranche AND the whole 700,000 🔥 lifetime allowance back, over and over.
     (Reproduced: reset+bootstrap returns charterIssued to exactly 300,000.00
     from a capped city.) It is not the fortune it looks like — the deletion
     also destroys everything the city had, so it is only worth the gap between
     the city's current total and the seed — but the refreshed *allowance* is
     real money over the following hundred days.

     The host is the only party that can tell "brand new city" from "established
     city whose economy key was deleted": nothing in /src/economy survives a
     reload except the save it is being handed. So the decision is the host's
     and arrives as a flag.

     ✅ WIRED AS OF THIS PACKAGE. node-city derives it in `loadState()` from the
     parsed save and index.js `mount()` also raises it whenever it handed over
     ANY state at all. Reaching this branch therefore means one of two things —
     "the city has tiles but no economy blob", or "we were handed a save and
     something upstream let bootstrap run anyway" — and the correct answer to
     both is the same: no tranche. */
  if (opts.established) {
    /* Never silent. A refusal nobody can see is indistinguishable from a
       refusal that did not fire — which is how the re-arm shipped in the
       first place. */
    logEvent('bad', '🔴 This city already existed — no founding tranche was issued.');
    try { console.warn('[economy] established city bootstrapped — the founding tranche is NOT re-armed.'); } catch (e) {}
  } else {
    issueCharter(ECON.firm.charter.seed);
  }

  /* 1. WATER AND POWER — every other chain draws on them.
        `electricity` has alternate feedstocks, so seedChain tries the primary
        leg (coal) and, failing that, whichever fuel the node does have. */
  seedChain('freshWater');
  if (!seedChain('electricity')) {
    for (const alt of ['naturalGasFuel', 'industrialFuel', 'biomass']) {
      if (seedChain(alt)) { Firms.found('electricity', {}); break; }
    }
  }

  /* 2. FOOD — whichever staple this node actually grows, all the way to a loaf.
        The staple is guaranteed present by the endowment floor, so this always
        finds something; WHICH something varies by node, which is what makes
        one city a wheat town and its neighbour a rice town. */
  const staples = [['wheat', 'bread'], ['corn', 'packagedFood'], ['rice', 'preparedMeals'],
                   ['potatoes', 'packagedFood'], ['vegetables', 'cannedFood']];
  let fed = false;
  for (const [raw, dish] of staples) {
    if (!Endow.canExtract(nodeId, raw)) continue;
    if (seedChain(dish)) { fed = true; break; }
    if (seedChain(raw)) fed = true;
  }
  /* A grocer only exists if there is something for it to sell. A shop with an
     empty supply chain is the exact failure this rewrite is fixing. */
  if (fed) Firms.found('bread', { ind: 'grocer' });

  /* 4. A PROPERTY COMPANY. Residents pay rent from day one, so without a
        landlord every Cinder of it lands in the treasury and stays there —
        "Housing demand, employment and income will all become connected"
        requires something on the receiving end that has its own payroll and
        its own maintenance bill. */
  Firms.found('constructionComponents', { ind: 'landlord', name: 'Property Company' });

  /* 3. THE EXPORT SEAMS — what this node is actually good at. These are the
        city's trade goods and its future specialization. */
  const strong = Endow.strengths(nodeId).slice(0, 4);
  for (const id of strong) {
    if (!Endow.canExtract(nodeId, id)) continue;
    if (Firms.byOutput(id).length) continue;
    const f = Firms.found(id, { capacity: Endow.extractRate(nodeId, id) * 2 });
    f.name = (INDUSTRIES[f.ind] || {}).name || f.name;
  }

  logEvent('city', 'Economy seeded: ' + Firms.alive().length + ' businesses. Seams: ' +
                   (strong.slice(0, 3).join(', ') || 'none surveyed'));
  return true;
}

/* ════════════════════════════════════════════════════════════════════════════
/* ════════════════════════════════════════════════════════════════════════════
   🌩 THE DISASTER GUARD — kept, and it now answers 1 to everything.
   ----------------------------------------------------------------------------
   THE FEATURE THIS GUARDED IS GONE. `host.shock` no longer reaches prices.js,
   there is no `ECON.shock`, and nothing in this file spends a multiplier: a
   disaster does not move the market, which is the behaviour this game shipped
   before the feature was attempted. WHY it was removed — the two independent
   channels that made a siege PAY the city's owner, and what a rebuild would
   have to close — is written out where the hook used to be, in prices.js
   `targetMul()`. Read that before writing any of this back.

   🔴 THE GUARD ITSELF SURVIVES ON ITS OWN MERITS, AND IT PREDATES NOTHING.
   It used to be `host.shock ? …` — a TRUTHINESS test on a number that was
   multiplied into every price in the city. Fed hostile values directly,
   `shock:'abc'` and `shock:{}` CRASHED the tick (string/object arithmetic
   downstream), while NaN, Infinity, '2', 1e308, true, [] and -5 all sailed
   through silently and poisoned the market. `host` arrives across the bridge
   from node-city, and a boundary that trusts the far side is not a boundary —
   so the field stays SAFE whether or not anyone is setting it, and this is the
   one place it may ever be read.

   ⚠ typeof + isFinite, NOT `Number(x) || 1`. `Number(true)` is 1 and `Number([])`
     is 0 — both would be accepted as legitimate readings rather than rejected as
     garbage, and `Math.floor('1e9')` is 1e9, which is how the same class of bug
     already reached a render path once.
   ⚠ EVERY BRANCH ANSWERS 1, INCLUDING THE WELL-FORMED ONE, and that is the whole
     removal expressed in one function: the last line was `return v`. A future
     re-introduction comes back by changing THAT line and nothing else — which
     is deliberate, because it means the value can only ever re-enter the model
     already type-checked and already inside the band prices.js can express
     (ECON.price.minMul … maxMul). Out of range resolves to 1 rather than
     clamping: a garbage 1e308 is a bad reading, not a big disaster, and
     clamping would launder it into a maximum-severity siege.
   ════════════════════════════════════════════════════════════════════════════ */
export function shockOf(host) {
  try {
    const v = host ? host.shock : 1;
    if (typeof v !== 'number' || !isFinite(v)) return 1;
    if (!(v >= ECON.price.minMul) || !(v <= ECON.price.maxMul)) return 1;
    return 1;                    // ← was `return v`. See the header.
  } catch (e) { return 1; }
}

/* ════════════════════════════════════════════════════════════════════════════
   ⏱ THE TICK
   ----------------------------------------------------------------------------
   `advance(dtMin, host)` is called from the host's existing economy tick.
   Fractional days accumulate; a whole economic day runs `runDay()`.
   ════════════════════════════════════════════════════════════════════════════ */
export function advance(dtMin, host) {
  /* 🔴 A NON-FINITE dt MUST DO NOTHING AT ALL.
     `NaN` and `undefined` already fell out here (both are falsy, so `|| 0`
     caught them), but `Infinity` did not: it survived the `> 0` test, made
     `dayFrac` Infinity, and then the catch-up clamp happily ran three full
     economic days off a garbage argument. A bad clock reading from the host
     must never move money — the clamp exists to bound a LONG absence, not to
     launder nonsense into a legitimate-looking tick. */
  if (typeof dtMin !== 'number' || !isFinite(dtMin) || dtMin <= 0) return null;
  const days = Math.max(0, dtMin / Math.max(1, ECON.clock.dayMin));
  if (!(days > 0) || !isFinite(days)) return null;

  S.dayFrac += days;
  /* ⚠ CAPPED CATCH-UP. See ECON.clock.maxCatchUpDays: fast-forwarding 36 hours
     of compounding bankruptcies in one frame hands the player a dead city they
     never watched die. Excess time is DISCARDED, not banked — banking it would
     just move the same problem to the next tick. */
  const capped = Math.min(S.dayFrac, ECON.clock.maxCatchUpDays);
  if (capped < S.dayFrac) {
    logEvent('city', 'Skipped ' + Math.round(S.dayFrac - capped) + ' idle days (catch-up cap).');
    S.dayFrac = capped;
  }


  /* ⚠ `host` DESCRIBES ONE INSTANT AND THIS LOOP CAN RUN MANY DAYS OUT OF IT.
     That is why the disaster term used to need a sample budget metered here: an
     offline sweep replaying one frozen raid-timer reading across ~12,960 slices
     billed the player for a siege that lasted exactly as long as they were
     asleep. Nothing in the host is time-varying any more, so nothing has to be
     rationed — but any FUTURE field taken off `host` and spent per-day inherits
     that hazard, and it is not a hypothetical: it shipped. */
  let ran = null;
  let guard = 0;
  while (S.dayFrac >= 1 && guard++ < ECON.clock.maxCatchUpDays + 1) {
    S.dayFrac -= 1;
    ran = runDay(1, host || {});
  }
  /* Sub-day remainder still runs the CONTINUOUS half (production, shopping) so
     a short session is not economically dead — but the DISCRETE half (payroll
     close, tax, the distress ladder, levels) only happens on a whole day. */
  if (!ran && S.dayFrac > 0) ran = runPartial(S.dayFrac, host || {});
  return ran;
}

/* Availability map: for every input any firm needs, what fraction of the wanted
   quantity the city can actually supply out of inventory. Computed ONCE per day
   against a snapshot, so every firm is judged against the same city — the same
   reasoning node-city's `cityOutputMultipliers()` documents for its own tick. */
function availabilityMap(days) {
  const want = {};
  for (const f of Firms.alive()) {
    if (DEPOSITS[f.out]) continue;           // extractors consume nothing
    const leg = Firms.all().length ? (f.lastLeg || legsOf(f.out)[0]) : legsOf(f.out)[0];
    if (!leg) continue;
    const lvl = Firms.levelDef(f.level);
    const units = f.capacity * lvl.capMul * f.throttle * days;
    for (const inp in (leg.in || {})) want[inp] = (want[inp] || 0) + leg.in[inp] * units;
  }
  const avail = {};
  for (const id in want) {
    const have = S.INV[id] || 0;
    avail[id] = want[id] > 0 ? Math.min(1, have / want[id]) : 1;
  }
  return { want, avail };
}

/* ── The continuous half: produce, buy inputs, pay wages, shop. ───────────── */
function runProduction(days, host) {
  const nodeId = S.nodeId;
  const { want, avail } = availabilityMap(days);

  const wantOut = productionTargets(days);
  /* Allocate each firm its share of the demand BEFORE anyone posts a job, so
     crews are sized to the orders on the books rather than to nameplate
     capacity. See the note on Firms.headcountFor. */
  for (const f of Firms.alive()) {
    const room = wantOut[f.out];
    const nameplate = f.capacity * Firms.levelDef(f.level).capMul;
    if (!room || room.total <= 0) { f.plannedRate = nameplate; continue; }
    f.plannedRate = Math.max(0, (room.want / Math.max(0.0001, days)) * (nameplate / room.total));
  }

  // 1. LABOUR MARKET — post, then hire once for the whole city.
  HH.clearVacancies();
  for (const f of Firms.alive()) {
    const hc = Firms.headcountFor(f);
    HH.postJobs(hc.band, hc.n);
  }
  const fill = HH.hire();
  // Distribute the hired headcount back onto firms, proportionally per band.
  const perBand = {};
  for (const f of Firms.alive()) {
    const hc = Firms.headcountFor(f);
    perBand[hc.band] = (perBand[hc.band] || 0) + hc.n;
  }
  for (const f of Firms.alive()) {
    const hc = Firms.headcountFor(f);
    const share = perBand[hc.band] > 0 ? hc.n / perBand[hc.band] : 0;
    for (const b in f.workers) f.workers[b] = 0;
    f.workers[hc.band] = Math.floor((HH.state().employed[hc.band] || 0) * share);
  }

  // 2. UTILITY COVERAGE from the host's own vitals, so the economy and the
  //    city's existing power/water panels can never disagree.
  const ctx = {
    power: host.powerFactor != null ? host.powerFactor : 1,
    water: host.waterFactor != null ? host.waterFactor : 1,
    freight: Logistics.throughput(),
  };

  /* 3. 📦 HOW MUCH DOES ANYONE ACTUALLY WANT?
     🔴 FIRMS PRODUCE TO DEMAND, NOT TO CAPACITY. Without this every producer
     ran flat out into a warehouse nobody was emptying: a seeded city built up
     19,000 units of electricity and 16,000 of fresh water that no household
     could afford and no partner had ordered, while paying full wages to make
     them. Revenue could never cover payroll, so healthy businesses starved to
     death holding enormous unsellable stock — and the panel blamed "demand",
     which was true and completely unactionable.

     A business makes what it can sell plus a buffer. If nobody is buying, it
     makes almost nothing and STILL pays its fixed costs, which is exactly the
     announcement's "A store built somewhere with no customers? It can lose
     money." The failure stays; the absurdity goes. */
  // 4. PRODUCE. Extractors are additionally gated by the ground.
  for (const f of Firms.alive()) {
    if (DEPOSITS[f.out]) {
      /* 🔴 THE HARD GATE. A firm on a seam the node does not have produces
         nothing, ever. This is belt-and-braces: the build menu should never
         have let it be founded, but a save that predates an endowment change
         could carry one, and it must be inert rather than magic. */
      if (!Endow.canExtract(nodeId, f.out)) { f.lastProduced = 0; f.lastBottleneck = { key: f.out, label: 'No deposit on this node', pct: 0 }; continue; }
      f.capacityGrade = Endow.yieldMul(nodeId, f.out);
    }
    const spec = Trade.specBonusFor(f.out);
    let units = Firms.produce(f, days, avail, ctx) * spec.prod
              * (DEPOSITS[f.out] ? (f.capacityGrade || 1) : 1);

    /* Trim to this firm's share of what the market wants. Recorded on the firm
       so the supply-chain panel can say "idle: no orders" rather than leaving
       the player to guess why a fully-staffed plant is running at 12%. */
    const room = wantOut[f.out];
    if (room != null) {
      const share = room.total > 0 ? (f.capacity * Firms.levelDef(f.level).capMul) / room.total : 0;
      const allowed = Math.max(0, room.want * share);
      if (units > allowed) {
        f.idleForDemand = 1 - (allowed / Math.max(1e-9, units));
        // Un-produce the trimmed part: it was added to the firm's inventory by
        // produce(), and stock that was never made must not sit on the books.
        f.inventory = Math.max(0, f.inventory - (units - allowed));
        units = allowed;
      } else f.idleForDemand = 0;
    } else f.idleForDemand = 0;

    // 4. CONSUME THE INPUTS the production actually used.
    const leg = f.lastLeg || legsOf(f.out)[0];
    if (leg && !DEPOSITS[f.out]) {
      for (const inp in (leg.in || {})) {
        const need = leg.in[inp] * units;
        const got = takeInv(inp, need);
        /* 💸 B2B: the firm pays the market for what it consumed. The Cinder
           goes to the firms that MADE it, split by who is actually supplying —
           this is "Each company buys from the previous company using Cinder",
           and it is a transfer, so the audit balances. */
        if (got > 0) payUpstream(f, inp, got);
      }
    }
    if (units > 0) {
      addInv(f.out, units);
      S.outputValue[f.out] = (S.outputValue[f.out] || 0) + units * Prices.priceOf(f.out);
      S.observed[f.out] = S.observed[f.out] || { supply: 0, demand: 0 };
      S.observed[f.out].supply += units;
    }
  }
  for (const id in want) {
    S.observed[id] = S.observed[id] || { supply: 0, demand: 0 };
    S.observed[id].demand += want[id];
  }

  // 5. PAYROLL — firms pay wages; households receive them.
  for (const f of Firms.alive()) {
    const payrollTax = Firms.runPayroll(f, days);
    S.treasury += payrollTax;
    S.flow.tax += payrollTax;
  }
  S.flow.wages += HH.state().lastIncome;
}

/* ════════════════════════════════════════════════════════════════════════════
   🍞 SUBSISTENCE — residents eat before they shop.
   ----------------------------------------------------------------------------
   The basics are consumed because the population exists, not because it could
   afford them. Three payers, in order, and the ordering is the policy:

     1. THE HOUSEHOLD, out of savings.
     2. THE CITY, out of the treasury — this is welfare, and it is what stops a
        downturn from starving the citizenry and collapsing demand permanently.
     3. NOBODY. The goods still ship and the firm eats the loss as bad debt.

   Step 3 is not charity and it is not a leak: no Cinder is created, the firm is
   simply not paid, and its books show the hit. It is what actually transmits a
   household crisis onto business balance sheets — the announcement's recession
   chain, running through the accounts instead of through a script.
   ════════════════════════════════════════════════════════════════════════════ */
function runSubsistence(days) {
  const pop = HH.population();
  if (pop <= 0) return;
  for (const id in ECON.household.subsistence) {
    const need = ECON.household.subsistence[id] * pop * Math.max(0, days);
    if (need <= 0) continue;
    S.observed[id] = S.observed[id] || { supply: 0, demand: 0 };
    S.observed[id].demand += need;

    const got = takeInv(id, need);
    if (got <= 0) { S.flow.unmetSubsistence = (S.flow.unmetSubsistence || 0) + need; continue; }
    if (got < need) S.flow.unmetSubsistence = (S.flow.unmetSubsistence || 0) + (need - got);

    const price = Prices.priceOf(id) * Logistics.localPremium(id);
    const bill = got * price;

    // 1. Households pay what they hold.
    const fromHouseholds = HH.spendDirect(bill);
    // 2. The city covers the rest, as far as the treasury allows.
    let covered = 0;
    const short = bill - fromHouseholds;
    if (short > 0) {
      covered = Math.min(S.treasury, short);
      S.treasury -= covered;
      S.flow.welfare = (S.flow.welfare || 0) + covered;
    }
    const paid = fromHouseholds + covered;
    S.flow.shopping += fromHouseholds;

    // 3. Whatever is left unpaid is the producer's loss. Credit only real money.
    const sellers = Firms.byOutput(id);
    if (paid > 0) {
      if (sellers.length) for (const f of sellers) { Firms.earn(f, paid / sellers.length); f.customersDay += 1; }
      else addImports(paid);            // bought in from outside
    }
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   🔧 FIRM UPKEEP — a business spends, it does not hoard.
   ----------------------------------------------------------------------------
   🔴 THE LAST SINK, AND IT WAS ALMOST INVISIBLE.
   A firm's only outgoings were wages, inputs and tax. Anything left just
   accumulated. The property company was the extreme case — it collected rent
   from every household every day, employed one person, bought nothing, and had
   quietly absorbed 22,000 🔥 of a 50,000 🔥 economy by day 200. Households were
   broke, businesses were starved of customers, and the audit was perfectly
   clean the whole time: the money was all still there, it was just parked
   somewhere nothing could reach it.

   The announcement already says what a property business owes — "Maintenance •
   Property Taxes • Utilities • Employees • Loans" — and the same is true of
   every other business. So a firm holding more than its buffer spends the
   excess on real upkeep goods, paying the real firms that made them.

   ⚠ ONLY THE EXCESS ABOVE THE BUFFER. Spending into the buffer would strip the
     reserve that keeps a business alive through a bad week, which is the thing
     the whole distress ladder is calibrated against.
   ════════════════════════════════════════════════════════════════════════════ */
const UPKEEP_GOODS = ['constructionComponents', 'electricity', 'freshWater', 'lumber',
                      'metalComponents', 'machineParts', 'cleaningProducts', 'officeSupplies'];
const UPKEEP_SPEND_RATE = 0.30;    // of the excess, per economic day

function runFirmUpkeep(days) {
  for (const f of Firms.alive()) {
    const buffer = Firms.dailyOperatingCost(f) * ECON.firm.startCashDays;
    const excess = f.cash - buffer;
    if (excess <= 0) continue;
    let budget = excess * UPKEEP_SPEND_RATE * Math.max(0.0001, days);
    if (budget <= 0.01) continue;

    for (const id of UPKEEP_GOODS) {
      if (budget <= 0) break;
      const sellers = Firms.byOutput(id).filter(s => s.id !== f.id);
      if (!sellers.length) continue;                 // nobody to buy from
      const price = Prices.priceOf(id) * Logistics.localPremium(id);
      const affordable = budget / Math.max(0.01, price);
      const got = takeInv(id, affordable);
      if (got <= 0) continue;
      const value = got * price;
      const paid = Firms.pay(f, value);
      if (paid <= 0) { addInv(id, got); break; }     // put it back; it could not pay
      for (const s of sellers) { Firms.earn(s, paid / sellers.length); s.customersDay += 1; }
      Firms.noteSupplier(f, sellers[0].id);
      budget -= paid;
      S.flow.upkeep = (S.flow.upkeep || 0) + paid;
      S.observed[id] = S.observed[id] || { supply: 0, demand: 0 };
      S.observed[id].demand += affordable;
    }
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   🏛 MUNICIPAL SPENDING — the arrow this file was missing.
   ----------------------------------------------------------------------------
   The announcement's circulation diagram has eight arrows and one of them is
   "Government → Infrastructure". Without it the treasury is a SINK: taxes and
   rent flow in, benefits trickle out, and the balance climbs forever while firm
   cash drains away. Sixty simulated days showed exactly that — treasury 21,136
   and rising, firm cash 22,161 → 9,221 and falling, with the audit perfectly
   happy because nothing was minted or destroyed. Money can be in the wrong
   place without any of it going missing, and a closed loop with a sink in it
   is still a dying economy.

   A city spends on its city. Two ways, and both put Cinder back where it can be
   earned again:
     • CIVIC PAYROLL — clerks, crews, maintenance staff. Straight to households.
     • PROCUREMENT   — it buys real goods from real firms at market prices.

   🔴 IT SPENDS INCOME, NOT PRINCIPAL. The reserve floor is what a city keeps
   against a bad month; spending into it would leave nothing for benefits when a
   recession actually arrives, which is when the stabiliser matters most.
   ════════════════════════════════════════════════════════════════════════════ */
const CIVIC_PAYROLL_SHARE = 0.55;      // of the municipal budget
const MUNICIPAL_SPEND_RATE = 0.35;     // of the treasury above its reserve
const RESERVE_DAYS = 6;                // days of benefit liability held back
/* What a city buys. Ordered — it fills potholes before it buys office chairs. */
const PROCUREMENT = ['concrete', 'asphalt', 'lumber', 'constructionComponents',
                     'electricity', 'freshWater', 'medicalSupplies', 'officeSupplies',
                     'emergencySupplies', 'bottledWater'];

function runMunicipalSpending(days) {
  const reserve = HH.benefitBill(1) * RESERVE_DAYS;
  const spendable = Math.max(0, S.treasury - reserve);
  const budget = Math.min(spendable, spendable * MUNICIPAL_SPEND_RATE * Math.max(0.0001, days) + spendable * 0.02);
  if (budget <= 0) return;

  // ── Civic payroll. These are real jobs; the Cinder reaches residents.
  const payroll = budget * CIVIC_PAYROLL_SHARE;
  if (payroll > 0) {
    S.treasury -= payroll;
    HH.payWages('unskilled', payroll);
    S.flow.wages += payroll;
    S.flow.civic = (S.flow.civic || 0) + payroll;
  }

  // ── Procurement. The city buys goods at market price from the firms that
  //    made them, which is what makes a Concrete Works worth building.
  let left = budget - payroll;
  for (const id of PROCUREMENT) {
    if (left <= 0) break;
    const price = Prices.priceOf(id) * Logistics.localPremium(id);
    const affordable = left / Math.max(0.01, price);
    const got = takeInv(id, affordable);
    if (got <= 0) continue;
    const value = got * price;
    const sellers = Firms.byOutput(id);
    if (!sellers.length) { addInv(id, got); continue; }   // put it back; nobody to pay
    S.treasury -= value;
    for (const f of sellers) { Firms.earn(f, value / sellers.length); f.customersDay += 1; }
    left -= value;
    S.flow.infrastructure = (S.flow.infrastructure || 0) + value;
    S.observed[id] = S.observed[id] || { supply: 0, demand: 0 };
    S.observed[id].demand += affordable;
  }
}

/* ── DEMAND FORECAST ────────────────────────────────────────────────────────
   How many units of each output the city wants made this step, given what it
   already holds. `S.demandEMA` is a rolling estimate of daily offtake —
   household purchases, B2B consumption and exports — smoothed so one quiet day
   does not shut a factory and one busy day does not trigger a build-out.

   ⚠ THE WARM-UP MATTERS. A brand-new resource has no demand history, so a
     strict forecast would produce zero of it forever: nobody can buy what was
     never made, so demand stays zero, so nothing is made. Seeding the estimate
     at the firm's own capacity on first sight breaks that deadlock — the market
     over-produces briefly, discovers real demand, and converges down. */
const COVER_DAYS = 2.5;      // days of stock a healthy supply chain carries

/* The floor under daily demand for an id: the population has to eat, drink and
   keep the lights on regardless of what it can afford. See the long note on
   ECON.household.subsistence for why this exists and where the numbers
   come from. Returns 0 for anything that is not a subsistence good. */
function subsistenceFor(id) {
  const per = ECON.household.subsistence[id];
  if (!per) return 0;
  return per * HH.population();
}

/* The floor from OUTSIDE the city: what reachable partners are standing ready
   to buy. See Trade.exportInterest for why production must see this — without
   it an extractor with no local customer can never start. Discounted, because
   an offer is interest rather than a signed contract, and a city that produced
   flat out against every partner's full appetite would drown in unsold stock
   the moment freight or a partner's demand moved. */
const EXPORT_CONFIDENCE = 0.6;
function exportFloorFor(id) {
  try { return Trade.exportInterest(id) * EXPORT_CONFIDENCE; } catch (e) { return 0; }
}

function productionTargets(days) {
  const out = {};
  for (const f of Firms.alive()) {
    const id = f.out;
    const cap = f.capacity * Firms.levelDef(f.level).capMul;
    if (!out[id]) {
      if (S.demandEMA[id] == null) S.demandEMA[id] = cap;     // warm-up seed
      const target = Math.max(S.demandEMA[id], subsistenceFor(id), exportFloorFor(id)) * COVER_DAYS;
      const have = S.INV[id] || 0;
      out[id] = { want: Math.max(0, target - have) * Math.max(0.0001, days), total: 0 };
    }
    out[id].total += cap;
  }
  return out;
}

/* Fold the day's actual offtake into the estimate. Called at the end of a day
   once consumption, shopping and exports are all known. */
function updateDemandEMA(days) {
  const a = Math.min(1, 0.25 * Math.max(0.0001, days));
  const exported = Trade.state().lastExported || {};
  const ids = new Set(Object.keys(S.observed).concat(Object.keys(exported), Object.keys(S.demandEMA)));
  for (const id of ids) {
    const obs = S.observed[id] || { demand: 0 };
    const took = (obs.demand || 0) + (exported[id] || 0);
    const perDay = took / Math.max(0.0001, days);
    S.demandEMA[id] = (S.demandEMA[id] == null) ? perDay
                    : S.demandEMA[id] * (1 - a) + perDay * a;
  }
}

/* Pay out the reserved shopping credits, scaled to the Cinder that households
   genuinely handed over. `scale` is 1 in the normal case; it only bites when a
   household ran out of savings mid-basket, and in that case every firm takes
   the same proportional haircut rather than the ones early in the loop being
   paid in full at the expense of the ones after them. */
function applyCredits(pending, spent, moved) {
  let reserved = 0;
  for (const k in spent) reserved += spent[k] || 0;
  const scale = reserved > 0 ? Math.min(1, moved / reserved) : 0;
  if (!(scale > 0)) return;

  for (const p of pending) {
    const value = p.value * scale;
    if (value <= 0) continue;
    if (p.leaks || !p.payees || !p.payees.length) {
      /* Nothing local sold it — the Cinder left the city with the goods. */
      addImports(value);
      continue;
    }
    /* A retailer's payment to its producers is a TRANSFER, so it must be
       debited from the retailer by exactly what the producers are credited.
       Crediting producers without debiting the shop was the second leak the
       audit found. */
    if (p.from && p.from.length) {
      let raised = 0;
      for (const f of p.from) raised += Firms.pay(f, value / p.from.length);
      if (raised > 0) for (const s of p.payees) Firms.earn(s, raised / p.payees.length);
      continue;
    }
    for (const f of p.payees) { Firms.earn(f, value / p.payees.length); f.customersDay += 1; }
    if (p.isService && p.ind && INDUSTRIES[p.ind] &&
        (INDUSTRIES[p.ind].kind === 'service' || INDUSTRIES[p.ind].kind === 'retail')) {
      S.serviceValue[p.ind] = (S.serviceValue[p.ind] || 0) + value;
    }
  }
}

/* A firm buys `units` of `inp` and the Cinder reaches whoever produced it.
   Split pro rata across live producers of that input; if nobody local makes it,
   the Cinder leaves the city as an IMPORT (tracked, so the audit sees it). */
function payUpstream(buyer, inp, units) {
  const price = Prices.priceOf(inp) * Logistics.localPremium(inp);
  const bill = units * price;
  const paid = Firms.pay(buyer, bill);
  if (paid <= 0) return;
  S.flow.b2b += paid;

  const producers = Firms.byOutput(inp);
  if (!producers.length) {
    /* Nobody here makes it — it came from outside and the money leaves with it.
       This is the honest accounting for "buy Iron from somewhere that has it"
       when the trade layer has not matched a partner. */
    addImports(paid);
    return;
  }
  let totalCap = 0;
  for (const p of producers) totalCap += Math.max(0, p.lastProduced || 0);
  for (const p of producers) {
    const share = totalCap > 0 ? Math.max(0, p.lastProduced || 0) / totalCap : 1 / producers.length;
    Firms.earn(p, paid * share);
    Firms.noteSupplier(buyer, p.id);
  }
}

/* ═════════════════════════════════════════════════════════════════════════════
   🏷 GROUND RENT — the cost of BEING SOMEWHERE, and the one a business can die of
   ----------------------------------------------------------------------------
   "Eventually one FAILS because rent gets too expensive."

   🔴 BEFORE THIS IT COULD NOT HAPPEN, and that was measured rather than
   assumed. `Firms.dailyOperatingCost()` is wages + inputs; `ECON.tax.property`
   is charged on HOUSEHOLD rent in `runShopping` below and on nothing else; and
   no file in /src/economy mentioned `MythicLandValue` at all. Land value
   decided what DEVELOPED on a plot — /src/tenants prices it into a bid — and
   then never appeared on a balance sheet again. Rent could deter a company from
   opening and could never once pressure one that was already there.

   ── WHERE THE MONEY GOES, WHICH IS THE ONLY QUESTION THAT CAN BREAK RULE 1 ──
   The SAME channel household rent already uses, thirty lines below, and
   deliberately not a new one:

     · the property tax slice comes OUT OF the rent, never on top of it. That is
       ECONOMY.md's second leak verbatim ("charged on top of rent instead of out
       of it. Minted 2% of all rent"), which is why `ptax` is subtracted from
       `net` here rather than added beside it.
     · the net is landlord REVENUE, split across the city's `landlord` firms — a
       landlord is a business with its own costs, not a sink.
     · with no landlord firm in the city the net lands in the treasury as
       municipal ground revenue, because it has to land SOMEWHERE inside the loop
       or the audit correctly reports destroyed Cinder. Same fallback, same
       reason, as the housing rent below.
     · and it is credited with what was ACTUALLY PAID. A firm that cannot cover
       its rent pays what it has and the landlord's revenue falls by the
       shortfall. Crediting the BILL is ECONOMY.md's third leak ("producers
       credited whether or not the shop could pay") with the arrow turned round.

   🔴 ONLY `ptax` ENTERS `flow.tax`, and the municipal fallback deliberately does
   not — identical to `runShopping`. `flow.tax` is an INCOME term of the payout
   basis at step 9b, so booking the whole rent there would hand the player a
   quarter of every Cinder the city's businesses pay in ground rent. sim.js's own
   warning at 9b is about new CLAIMS on the treasury funding themselves back out
   of `outgoings`; this is that hazard mirrored onto the income side, and the
   conservative reading is also the one the code beside it already takes.

   ── WHY IT IS CHARGED HERE, BETWEEN SHOPPING AND UPKEEP ─────────────────────
   After `runShopping` so the day's takings are already in the till — a shop
   charged before it has sold anything fails for the calendar rather than for the
   rent. Before `runFirmUpkeep`, which spends a firm's EXCESS cash on goods: rent
   is a prior claim on a business, not a discretionary purchase, and letting
   upkeep go first would let a firm shop its way out of its own rent.
   ⚠ AND IN runDay ONLY, NOT IN runPartial. Rent is a discrete daily bill and
     belongs with the discrete half of the tick (payroll close, tax, the distress
     ladder) for the same reason those are there. `runDay` is always called with
     days === 1 by `tick()`; the argument is honoured anyway so that a future
     caller catching up several days cannot silently charge one.

   ⚠ NO /src/landvalue ⇒ NO RENT AT ALL. The source returns null and this charges
     nothing. It does not fall back to a default premium: "a guarded read that
     silently substitutes a plausible value is indistinguishable from a working
     integration" is /src/landvalue's own most expensive lesson, and it applies
     with more force here because the substitute would be moving money.
   ⚠ AND THE PREMIUM, NOT `valueAt()`. See ECON.firm.groundRent — the printed
     value carries an unbounded city-wide term (`decorPoints()`), so renting off
     it would charge every business in the city for a garden planted across town,
     and would keep doing it for ever.
   ═════════════════════════════════════════════════════════════════════════════ */
let LANDVALUE_SOURCE = null;

/* index.js registers this, for the same reason it registers the capital source
   and the estate sink: `window.MythicLandValue` is a bridge read, and every
   `window` read in this package lives in index.js next to the rest of them. */
export function setLandValueSource(fn) {
  LANDVALUE_SOURCE = typeof fn === 'function' ? fn : null;
}

/* Is a land value source registered AND answering? index.js registers one
   unconditionally, so "registered" says nothing — the honest question is
   whether it returned a number for the last plot it was asked about, which is
   what tells a panel apart from a build where /src/landvalue 404'd. */
export function landValueActive() {
  if (!LANDVALUE_SOURCE) return false;
  for (const f of Firms.alive()) if (premiumFor(f) != null) return true;
  return false;
}

/* The location premium of the plot a firm stands on, or null for "no answer".
   `f.tileKey` is node-city's own 'x,z'. A firm with no tile — every bootstrap
   firm — is not standing anywhere and pays no ground rent. */
function premiumFor(f) {
  if (!LANDVALUE_SOURCE || !f || !f.tileKey) return null;
  const parts = String(f.tileKey).split(',');
  if (parts.length !== 2) return null;
  const x = Number(parts[0]), z = Number(parts[1]);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  let p = null;
  try { p = LANDVALUE_SOURCE(x, z); } catch (e) { p = null; }
  /* 🔴 A HOSTILE READ IS "NO ANSWER", NOT ZERO AND NOT NaN. The gauntlet's
     round 1 exists because an Infinity that survived a guard once ran three
     economic days off a bad clock read and moved real money. */
  if (p == null || !Number.isFinite(p) || p < 0) return null;
  return p;
}

function runGroundRent(days) {
  if (!LANDVALUE_SOURCE) return;
  const R = ECON.firm.groundRent;
  const exempt = R.exemptIndustries || [];
  let collected = 0;
  for (const f of Firms.alive()) {
    if (exempt.indexOf(f.ind) >= 0) continue;
    const premium = premiumFor(f);
    if (premium == null) continue;
    const bill = premium * R.perPremiumDay * Math.max(0, days);
    if (bill <= 0) continue;
    collected += Firms.payGroundRent(f, bill);
  }
  if (collected <= 0) return;

  const ptax = collected * ECON.tax.property;
  const net = collected - ptax;
  S.treasury += ptax;
  S.flow.tax += ptax;
  /* ⚠ The landlords that RECEIVE the rent are exactly the firms exempted from
     PAYING it, which is not a coincidence — it is the reason they are exempt.
     The alternative is a firm billing itself and the city counting the round
     trip twice. */
  const landlords = Firms.byIndustry('landlord');
  if (landlords.length) for (const l of landlords) Firms.earn(l, net / landlords.length);
  else S.treasury += net;
  S.flow.groundRent += collected;
}

/* ── Shopping: households buy from retail/service firms. ──────────────────── */
function runShopping(days) {
  const rent = HH.chargeRent(days);
  if (rent > 0) {
    /* 🔴 PROPERTY TAX COMES OUT OF THE RENT, NOT ON TOP OF IT.
       The household paid `rent` and that is ALL that left their savings. Taxing
       on top and crediting the treasury with `rent * rate` as well conjures
       that slice out of nothing — the audit caught it on day one. The landlord
       receives the net; the city receives the tax; the two sum to what was
       actually paid. Every tax in this file follows that rule. */
    const ptax = rent * ECON.tax.property;
    const net = rent - ptax;
    S.treasury += ptax;
    const landlords = Firms.byIndustry('landlord');
    if (landlords.length) {
      for (const f of landlords) Firms.earn(f, net / landlords.length);
    } else {
      /* No property company exists yet, so the net goes to the city as
         municipal housing revenue. It must land SOMEWHERE inside the loop or
         the audit (correctly) reports destroyed Cinder. */
      S.treasury += net;
    }
    S.flow.rent += rent;
    S.flow.tax += ptax;
  }

  runSubsistence(days);

  const wanted = HH.demand(days);
  const spent = {};
  /* 🔴 CREDITS ARE DEFERRED UNTIL WE KNOW WHAT HOUSEHOLDS ACTUALLY PAID.
     Crediting firms inside the loop and only then calling HH.buy() meant the
     shops were paid `filled` while residents were debited `min(filled,
     savings)` — whenever a household ran short, the difference was Cinder that
     appeared from nowhere. So the loop only RESERVES credits here, and
     `applyCredits()` below scales them to the money that genuinely moved. */
  const pending = [];
  const reserve = (payees, value, isService, ind) => {
    if (value > 0 && payees && payees.length) pending.push({ payees, value, isService, ind });
  };
  for (const b of HH.BASKET) {
    if (b.rentDriven) continue;
    const key = b.key;
    let budget = wanted[key] || 0;
    if (budget <= 0) { spent[key] = 0; continue; }

    // Price index for this category vs. base — drives elasticity.
    let idx = 0, n = 0;
    for (const id of b.res) { idx += Prices.mulOf(id); n++; }
    idx = n ? idx / n : 1;
    budget *= HH.elasticityFactor(key, idx);

    /* The shops can only sell what they HAVE. Buy down the category's resource
       list in order until the budget or the stock runs out. */
    let filled = 0;
    for (const id of b.res) {
      if (budget - filled <= 0) break;
      const price = Prices.priceOf(id) * Logistics.localPremium(id);
      const affordable = (budget - filled) / Math.max(0.01, price);
      const got = takeInv(id, affordable);
      if (got <= 0) continue;
      const value = got * price;
      filled += value;
      S.observed[id] = S.observed[id] || { supply: 0, demand: 0 };
      S.observed[id].demand += affordable;

      // The Cinder goes to the firms that made it.
      const sellers = Firms.byOutput(id);
      const retail = Firms.byIndustry(b.ind);
      const payees = retail.length ? retail : sellers;
      if (payees.length) {
        reserve(payees, value, true, b.ind);
        if (retail.length && sellers.length) {
          /* The retailer keeps a margin and pays the producer the rest — which
             is what makes a Distributor → Grocery Store step worth existing.
             Reserved as its own leg so it is scaled by the same factor. */
          reserve(sellers, value * (1 - ECON.firm.marginTarget), false, null, retail);
          pending[pending.length - 1].from = retail;
        }
      } else {
        /* Nothing local sells it, so the household's Cinder left the city. */
        pending.push({ payees: null, value, leaks: true });
      }
    }
    spent[key] = filled;
  }
  const moved = HH.buy(spent, wanted);
  applyCredits(pending, spent, moved);
  const tax = HH.salesTax(moved);
  /* Sales tax comes OUT of what the shops were paid — the household paid the
     gross, the firm keeps the net. Taxing on top would create Cinder. */
  let toCollect = tax;
  for (const f of Firms.alive()) {
    if (toCollect <= 0) break;
    if (f.kind !== 'retail' && f.kind !== 'service') continue;
    toCollect -= Firms.pay(f, toCollect);
  }
  const collected = tax - Math.max(0, toCollect);
  S.treasury += collected;
  S.flow.tax += collected;
  S.flow.shopping += moved;
}

/* ── The partial tick: production + shopping only. ────────────────────────── */
function runPartial(days, host) {
  HH.beginTick();
  runProduction(days, host);
  runShopping(days);
  stepPrices(days);
  return snapshot();
}


/* ════════════════════════════════════════════════════════════════════════════
   📅 A WHOLE ECONOMIC DAY
   ════════════════════════════════════════════════════════════════════════════ */
function runDay(days, host) {
  const before = totalCinder();
  HH.beginTick();
  Trade.beginDay();
  Logistics.beginDay();
  S.outputValue = {}; S.serviceValue = {}; S.observed = {};
  zeroFlow();

  /* 🏦 THE FOUNDING FAUCET. Deliberately the first money to move in the day and
     deliberately INSIDE the window: this is the only Cinder the economy creates
     apart from the export faucet, so it must be visible to the same audit. It
     fills the fund that the NEXT founding will draw on — foundings themselves
     happen between ticks, from `syncBuildings`, and are pure transfers. */
  topUpCharter(days);

  Logistics.setCapacity(host.logisticsCounts || {});
  /* Partners are established BEFORE production plans, not after trading. The
     production forecast reads their standing interest (exportFloorFor), so a
     city that discovered its partners only at settlement time would spend its
     whole first day blind to every export order on the table. */
  if (!Trade.state().partners.length) Trade.setPartners(Trade.simulatedPartners(S.nodeId, 4));

  // 1–2. Production and consumer spending.
  runProduction(days, host);
  runShopping(days);

  /* 2b. 🏷 GROUND RENT — after the day's takings are in the till and before a
     firm may spend its excess on upkeep. Both halves of that placement are
     argued in runGroundRent's header. */
  runGroundRent(days);


  // 3. TRADE. Surplus out, gaps in.
  const surplus = {}, shortfall = {};
  for (const id in S.INV) {
    const obs = S.observed[id] || { demand: 0 };
    const cover = S.INV[id] - obs.demand;
    if (cover > ECON.trade.minOffer) surplus[id] = cover * 0.5;   // never sell the whole buffer
  }
  for (const id in S.observed) {
    const o = S.observed[id];
    const gap = o.demand - (S.INV[id] || 0) - o.supply;
    if (gap > 0) shortfall[id] = gap;
  }
  Trade.buildOffers(surplus, S.day);
  Trade.buildWants(shortfall, S.nodeId, S.day);
  Trade.refreshPartners();   // other cities keep producing and keep needing things

  const traded = Trade.match(S.treasury, S.day);
  // Imports are paid out of the treasury; the goods land in inventory.
  const importPaid = Math.min(S.treasury, traded.spend);
  S.treasury -= importPaid;
  addImports(importPaid);
  for (const im of traded.imports) addInv(im.res, im.units * (traded.spend > 0 ? importPaid / traded.spend : 0));
  /* EVERY CONTRACT SHIPS. There was an export BLOCKADE here — a share of the
     day's contracts held back per unit of disaster severity — and it went out
     with the rest of the disaster feature. It is worth knowing why it is not
     salvageable on its own: exports are the only Cinder entering the city, so
     blocking them looks like the most literal possible cost, and in the cities
     whose exports earn NO faucet revenue (rho-6 ships real volume for 0 🔥) it
     was a pure GAIN — shipping is an inventory loss there, so stopping the
     convoy paid the owner +17.3% where switching the blockade off left him
     −31.3%. A cost term that inverts on the cells where it bites hardest is not
     a cost term. See prices.js `targetMul()` for the full account. */
  for (const ex of traded.exports) takeInv(ex.res, ex.units);

  /* 🚰 THE FAUCET — the ONE place Cinder enters the city, and only against real
     exported volume. Clamped hard by ECON.faucet.maxPerMin so no combination of
     trades can turn this into the Forge. */
  const capPerDay = ECON.faucet.maxPerMin * ECON.clock.dayMin * days;
  /* 🔌 THE UTILITY LINK SETTLES HERE, and it settles into the SAME `earned`.
     Electricity that left the city over the outside connection is exported
     volume like any other, so its revenue passes under the ONE faucet ceiling
     rather than beside it — a second, separately-capped faucet is two faucets
     however carefully each one is clamped. The import leg has already left the
     treasury inside settleUtility(), booked to `flow.imports` where the payout
     basis at step 10 nets it off. See settleUtility's header. */
  const utilityEarned = settleUtility();
  S.flow.utilityExport += utilityEarned;
  const earned = traded.revenue + utilityEarned;
  const faucet = Math.min(earned * ECON.faucet.perExportUnit, capPerDay);
  S.treasury += faucet;
  S.flow.exports += faucet;
  S.flow.faucet += faucet;
  /* The same Cinder, tallied for the city's whole life. `flow.faucet` is wiped
     by zeroFlow() at the top of the next runDay; the loader needs the lifetime
     figure to know what this city may honestly be holding. */
  S.faucetLifetime += faucet;
  if (earned > capPerDay) {
    logEvent('city', 'Export earnings capped this day (faucet ceiling).');
  }

  // 4. FREIGHT settles; the city pays its haulage bill.
  Logistics.resolve();
  const freightBill = Logistics.state().booked * Logistics.costPerUnit(1) * 0.1;
  const freightPaid = Math.min(S.treasury, freightBill);
  S.treasury -= freightPaid;
  /* The haulage bill is revenue for logistics firms if the city has any;
     otherwise it leaves as an import of transport services.
     🚚 ONE PAYMENT, ONE BUCKET — AND IT USED TO BE TWO.
     The haulage bill was booked to `flow.freight` unconditionally AND to
     `flow.imports` when the city had no haulage firms of its own, so in every
     such city the same Cinder appeared in both. The payout basis at step 9b nets
     off `benefits + imports + freight`, so it subtracted that payment TWICE —
     which meant every Cinder the treasury failed to find for haulage RAISED the
     recorded surplus by two, and the disaster that emptied the treasury was paid
     for it. Measured at rho-6/pop120/wh1 over 600 days, a ×1.12 pulse every 60
     days moved freight by −76 🔥 and the owner by +10 🔥 on a 633 🔥 baseline:
     the whole of the residual inversion, out of an accounting duplicate.
     ⚠ gauntlet2 §9 independently restates the same identity, so the two files
       have to agree — which is why this is fixed by not double-booking rather
       than by subtracting the duplicate back out in step 9b. That was tried; it
       makes sim.js's surplus larger than gauntlet2's and trips it 46 times.
     ⚠ COST OF THE FIX, STATED: in a city with no haulage firms the panel's
       "Freight" row now reads 0 and the spend shows up under Imports, which is
       where it truly went. render.js is outside this package; a later one can
       give the readout its own field. A wrong payout is worse than a coarse
       panel. */
  const haulers = Firms.byIndustry('distributor').concat(Firms.byIndustry('transitCo'));
  if (haulers.length) { S.flow.freight += freightPaid; for (const f of haulers) Firms.earn(f, freightPaid / haulers.length); }
  else { addImports(freightPaid); S.flow.freightAsImport += freightPaid; }

  // 5. BANKING.
  Bank.setHasBank(!!host.hasBank);
  if (host.hasBank && Bank.state().reserve <= 0 && S.treasury > 0) {
    const seed = Math.min(S.treasury, 25000);
    S.treasury -= Bank.capitalise(seed);
  }
  for (const f of Firms.alive()) Bank.autoBorrow(f, S.day);
  const bankEvents = Bank.accrue(days, S.day);
  for (const e of bankEvents) {
    if (e.kind === 'default')  logEvent('bad', e.name + ' defaulted on ' + Math.round(e.amount).toLocaleString() + ' 🔥.');
    if (e.kind === 'writeoff') logEvent('bad', 'Loan written off — ' + e.name + ' is gone.');
    if (e.kind === 'repaid')   logEvent('good', e.name + ' cleared its loan.');
  }

  // 5a. 🔧 FIRM UPKEEP — cash goes back to work instead of piling up.
  runFirmUpkeep(days);

  // 5b. 🏛 MUNICIPAL SPENDING — "City → Infrastructure → Economy".
  runMunicipalSpending(days);

  // 6. UNEMPLOYMENT BENEFIT — the automatic stabiliser, from the treasury.
  const bill = HH.benefitBill(days);
  const paidBenefit = Math.min(S.treasury, bill);
  S.treasury -= paidBenefit;
  HH.payBenefit(paidBenefit);
  S.flow.benefits += paidBenefit;

  // 7. CLOSE THE BOOKS. Profit, corporate tax, the distress ladder, levels.
  for (const f of Firms.all()) {
    if (f.rung === 'BANKRUPT' && f.reported) continue;
    const was = f.rung;
    f.customersDayPrev = f.customersDay;
    const closed = Firms.closeDay(f);
    S.treasury += closed.tax;
    S.flow.tax += closed.tax;
    Firms.rollAverages(f, closed);

    /* 💰 DIVIDENDS. Profit is income for the residents who own the business —
       see the note on ECON.firm.dividendRate for why the loop does not close
       without this. A transfer: debited from the firm by exactly what the
       households are credited, so the audit still balances. */
    if (closed.profit > 0) {
      const div = Firms.pay(f, (closed.profit - closed.tax) * ECON.firm.dividendRate);
      if (div > 0) {
        HH.payDividend(div);
        S.flow.dividends += div;   // declared in S.flow; see the note there
      }
    }

    if (closed.rung !== was) {
      if (closed.rung === 'BANKRUPT') {
        /* 🏷 WHY IT DIED, WHEN THE BOOKS CAN ACTUALLY SAY SO. Every closure in
           this city used to read the same sentence, which is exactly what made
           the churn treadmill unreadable: 345 identical rows cannot tell a firm
           that failed of its rent from one that opened with no capital.
           The claim is made from the firm's own ledger and only when the ledger
           supports it — `lifetimeProfit` is negative AND adding back every
           Cinder of ground rent it ever paid turns it positive. That is
           precisely "this business traded profitably and its landlord took the
           difference", and it is not sayable about a firm that was losing money
           on its trading anyway. */
        const rentLife = f.rentLife || 0;
        const beforeRent = (f.lifetimeProfit || 0) + rentLife;
        const rentKilledIt = rentLife > 0 && (f.lifetimeProfit || 0) <= 0 && beforeRent > 0;
        logEvent('bad', '🏚 ' + f.name + ' (' + f.out + ') went bankrupt. ' +
                        Firms.employeeCount(f) + ' jobs lost.' +
                        (rentKilledIt
                          ? ' 🏷 Ground rent took ' + Math.round(rentLife).toLocaleString() +
                            ' 🔥 — it was ' + Math.round(beforeRent).toLocaleString() +
                            ' 🔥 in profit before the rent.'
                          : rentLife > 0
                            ? ' Ground rent over its life: ' + Math.round(rentLife).toLocaleString() + ' 🔥.'
                            : ''));
        f.reported = true;
      } else if (Firms.RUNGS.indexOf(closed.rung) > Firms.RUNGS.indexOf(was)) {
        logEvent('bad', '⚠ ' + f.name + ' → ' + Firms.RUNG_META[closed.rung].label + '.');
      } else {
        logEvent('good', '↗ ' + f.name + ' recovered to ' + Firms.RUNG_META[closed.rung].label + '.');
      }
    }
    // Level up if every gate is met.
    if (f.rung === 'HEALTHY') {
      f.infrastructure = host.infrastructure != null ? host.infrastructure : 0.6;
      if (Firms.levelCheck(f).ok) {
        const spentOnExpansion = Firms.levelUp(f);
        if (spentOnExpansion >= 0 && f.level > 1) {
          /* The expansion spend is construction bought in the city — permits,
             contractors, fit-out. It lands in the treasury so it stays inside
             the loop; letting `pay()` swallow it destroyed Cinder and failed
             the audit from the other direction. */
          S.treasury += spentOnExpansion;
          S.flow.tax += spentOnExpansion;
          logEvent('good', '⬆ ' + f.name + ' is now a ' + Firms.levelDef(f.level).name + '.');
        }
      }
    }
  }
  /* ⚰ THE CLOSURE RECORD — read-only, and it exists because firms.js's own
     `reap()` header states the problem and nothing had ever solved it: "a
     business that vanishes between frames never gets explained to the player".
     `reap()` has always RETURNED its dead and every caller has always thrown
     them away, so by the time any observer outside this module looks, the firm
     — its name, its rung, its bad days — is simply gone. /src/tenants binds a
     shopfront to a company and cannot otherwise say whether the business there
     went bankrupt or was merely replaced.
     🔴 IT MOVES NOTHING AND IT IS NOT SERIALISED. A bounded ring of plain
        strings and numbers, read by `closures()`, invisible to `totalCinder()`
        and to `audit()`. Deleting these three lines changes no balance. */
  for (const d of Firms.reap()) {
    S.closures.push({ day: S.day, id: d.id, name: d.name, out: d.out, ind: d.ind,
                      tileKey: d.tileKey || null, rung: d.rung,
                      badDays: d.badDays | 0, level: d.level | 0,
                      lifetimeProfit: Math.round(d.lifetimeProfit || 0) });
    if (S.closures.length > 120) S.closures.shift();
  }

  // 8. WEALTH MOBILITY and SPECIALIZATION.
  HH.settle(days);
  const spec = Trade.updateSpecializations(S.outputValue, S.serviceValue, days);
  for (const k of spec.gained) logEvent('good', '⭐ This city is now known for ' + Trade.SPEC_BY_KEY[k].name + '.');
  for (const k of spec.lost)   logEvent('city', 'Lost the ' + Trade.SPEC_BY_KEY[k].name + ' reputation.');

  // 9. PRICES react to everything that just happened.
  updateDemandEMA(days);
  stepPrices(days);

  /* 9b. THE DAY'S MUNICIPAL SURPLUS — what the city earned, less what it spent.
     A city pays its owner out of this and nothing else; step 10 draws on it.

     🚒 THERE WAS A DISASTER COUNTERWEIGHT HERE and it is gone with the feature
     it paid for: an emergency-response bill accrued across a recovery window,
     settled out of this surplus ahead of the owner, plus an "austerity register"
     that withheld the surplus the response manufactured on the days after. Both
     existed ONLY to cancel a price premium that no longer exists, so both are
     now a charge for nothing — see prices.js `targetMul()` for the full account
     of why the feature came out and what a rebuild has to close.

     🔴 ONE THING THAT BLOCK LEARNED IS STILL TRUE OF THE LINES BELOW, AND THE
     NEXT PERSON TO ADD A MUNICIPAL CHARGE WILL WALK INTO IT: `outgoings` is a
     sum of what the city ACTUALLY PAID, not of what it was billed. Benefits,
     imports and freight are every one of them settled `Math.min(S.treasury,
     bill)` upstream. So ANY new claim on the treasury reduces the recorded
     outgoings of the days that follow — it buys itself back out of the payout
     basis, and can hand the player MORE than it took. Measured on the removed
     feature: 3,244 🔥 billed and paid removed 6,318 🔥 of recorded outgoings and
     left the owner +61.3%. A charge that funds itself is not a charge, and no
     coefficient fixes it; what it needs is a shadow treasury booking what was
     OWED. Do not add a term here without measuring that channel first. */
  const income = S.flow.tax + S.flow.faucet;
  /* 🚚 `benefits + imports + freight` IS A SUM OF DISJOINT BUCKETS, and it was
     not before: the haulage bill of a city with no carriers of its own was
     booked to `freight` AND to `imports`, so this line subtracted one payment
     twice. Fixed at step 4, not here — gauntlet2 §9 restates this same identity
     and the two files have to agree on it. */
  const outgoings = S.flow.benefits + S.flow.imports + S.flow.freight;
  const surplusToday = Math.max(0, income - outgoings);

  /* 10. THE DRAIN — what the player may withdraw.
     🔴 BOUNDED BY THE DAY'S MUNICIPAL SURPLUS, NOT BY THE TREASURY BALANCE.
     It used to be a flat 5% of the treasury per day. That is a liquidation, not
     a dividend: the treasury holds the city's working capital, so a city
     earning 37 🔥/day in tax was paying its owner 200 🔥/day out of the money
     its businesses needed to keep trading. Sixty simulated days of it drained
     a healthy economy from 30,200 🔥 to 19,300 🔥 while every panel still read
     "profitable" — the slowest possible version of the Forge bug, running
     backwards.
     A city pays its owner out of what it EARNED: taxes and export income, less
     what it spent on benefits, imports and freight. No surplus, no payout. */
  if (S.payoutAllowed) {
    const draw = Math.min(surplusToday * ECON.tax.payoutRate,
                          ECON.tax.payoutMaxPerDay * days,
                          Math.max(0, S.treasury));
    if (draw > 0) { S.treasury -= draw; S.payoutOwed += draw; S.flow.payout += draw; }
  }

  S.day += 1;

  /* 🪟 Arm the next founding window. Deliberately AFTER every account movement
     this day makes — the foundings it bounds happen in the gap that starts
     here, so the budget is a share of the money that is actually standing when
     they land. See armFoundingWindow for the 91.15%-of-treasury bug this is. */
  armFoundingWindow();

  // 11. THE AUDIT.
  audit(before);
  return snapshot();
}

function stepPrices(days) {
  for (const id in S.observed) {
    const o = S.observed[id];
    Prices.observe(id, {
      supply: o.supply, demand: o.demand, stock: S.INV[id] || 0,
      sellers: Firms.byOutput(id).length,
      imported: (Trade.state().lastImported || {})[id] || 0,
    });
    const unavailable = !!DEPOSITS[id] && !Endow.canExtract(S.nodeId, id) && !Firms.byOutput(id).length;
    Prices.step(id, days, {
      unavailable,
      importPremium: Logistics.importPremium(id),
      /* ⚠ NO `shock` KEY, deliberately. It used to be passed here from the host
         and prices.js multiplied the whole target by it; both ends are gone.
         prices.js `targetMul()` documents why. */
    });
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   🔍 THE AUDIT — proof that no Cinder was minted.
   ════════════════════════════════════════════════════════════════════════════ */
export function totalCinder() {
  /* 🏦 THE CHARTER FUND IS PART OF THE TOTAL. It has to be: founding draws on
     it, and an account that is spent from but never counted is a leak that
     looks like an expense. Counting it is also what turns founding from an
     invisible mint into an ordinary transfer. */
  return HH.totalSavings() + Firms.totalCash() + S.treasury + S.charter + Bank.state().reserve;
}

/* ════════════════════════════════════════════════════════════════════════════
   🔴 WHAT A DOCTORED SAVE CAN STILL DO — AND WHY THERE IS NO CLAMP HERE.
   ----------------------------------------------------------------------------
   A load-time clamp used to live at exactly this spot. It derived a ceiling on
   `totalCinder()` from `charterIssued + faucetLifetime`, bounded all five
   balance terms and `payoutOwed` by it, and scaled the whole total back if the
   sum still exceeded it. IT WAS REMOVED DELIBERATELY, and this comment is here
   so that nobody rebuilds it. It failed in three separate ways, all measured.

   ── 1. IT DID NOT WORK: THE CEILING'S OWN INPUT WAS ON THE SAME DISK ────────
   Every rail in it was f(S.day), and `S.day` arrives from the save like
   everything else. It was bounded only from ABOVE, at one year of continuous
   round-the-clock play (26,280 economic days — 131× an honest 200-day city),
   and the faucet allowance underneath it was PER DAY, so a doctored `day`
   multiplied the whole allowance directly. A four-field edit — `day`,
   `faucetLifetime`, `payoutOwed`, with `treasury` left deliberately HONEST so
   the total clamp had nothing to eat — turned the owner payout into an
   ≈7,500 gems per real hour faucet into real `Profile.gems`. The gate certified
   that forgery as PASSING, because the round asserted against a bound the
   forgery had itself just moved. A clamp whose ceiling is attacker-supplied is
   a decoration; making it tighter only moves the number the forger has to edit.

   ── 2. IT ARBITRATED HONEST MONEY USING AN IDENTITY THAT IS ROUTINELY FALSE ─
   The bound on `payoutOwed` was the headroom left under

       created = totalCinder + imports + payoutDelivered + payoutOwed

   and that identity does NOT hold while a payout RPC is in flight.
   `claimPayout()` debits `payoutOwed` synchronously; the delivery is confirmed
   and tallied a network round trip later. For the whole of that window the
   claimed Cinder is in no term of the sum. node-city writes its save in exactly
   that window — `pagehide`, `visibilitychange` and the 800ms `saveSoon` timer
   all land wherever the RPC happens to be. Money that a clamp cannot account
   for is money a clamp will eventually take, and it has no way to notice that
   it did: it zeroes the field and logs a forgery.
   See `S.payoutInFlight`, which makes that window survivable — it is a
   first-class term now, serialized, and put back on `payoutOwed` on load.

   ── 3. THE THREAT WAS ALWAYS SECOND-ORDER, AND HERE IS THE RESIDUAL ────────
   🔴 STATE IT PLAINLY: A DOCTORED SAVE CAN STILL INFLATE THIS CITY'S MONEY.
      `treasury`, `charter`, `bank.reserve`, every `savings` tier, every firm's
      `cash` and `payoutOwed` are coerced for NaN and for sign on the way in and
      are NOT bounded for magnitude. Editing one raises what the city holds, and
      `payoutOwed` in particular is the one field that crosses the bridge into
      real `Profile.gems`.

      That is the SAME TIER of exposure this app already has. The city is
      client-authoritative: `payCost` is client-side, the save is written by the
      client, and a user with devtools open can reach the host's `addGems`
      directly and skip all of this. The only thing the save file added was that
      the exploit became copy-pasteable — worth a cheap guard, not worth a
      several-hundred-line clamp that carries a critical bypass of its own AND
      adjudicates honest players' balances on a false identity.

      🔴 THE REAL FIX IS SERVER-SIDE AUTHORITY: the payout computed and credited
      by a Postgres function against state the client cannot write, the way
      `chat_send()` moved the profanity mask and the rate limit off the client
      (CLAUDE.md). DO NOT REBUILD A LOAD-TIME CLAMP HERE WITHOUT SOLVING THAT
      FIRST — without server authority the ceiling's inputs sit on the same disk
      as the balances it claims to bound, which is defect 1 above restated, and
      the honest player pays for it, which is defect 2.

   WHAT DELIBERATELY SURVIVED, because each is cheap, exact, and bounds a CODE
   path rather than a value read off disk:
     • `audit()` below — the closed-loop day identity, plus `capOk`, which holds
       `charterIssued` to its lifetime cap and suspends the payout the moment a
       code path outruns it.
     • `load()` holding `charterIssued` to that same lifetime cap — not a
       forgery bound but the opposite: a corrupt tally must not be able to
       suspend a real player's payouts for the rest of the city's life.
     • The two independent refusals that stop a second founding tranche —
       `bootstrap()`'s `established` check and load()'s unconditional
       `S.booted = true`.
   ════════════════════════════════════════════════════════════════════════════ */

export function audit(before) {
  const after = totalCinder();
  const delta = after - before;
  /* What SHOULD have changed the total:
       + faucet    (export earnings entering from outside)
       + founding  (charter capital issued into the fund — the ONLY other
                    creation, bounded by ECON.firm.charter.lifetimeCap)
       − imports   (Cinder leaving for goods made elsewhere)
       − payout    (withdrawn by the player, held in payoutOwed)
     Everything else is a transfer and nets to zero. */
  const expected = S.flow.faucet + S.flow.founding - S.flow.imports - S.flow.payout;
  const err = delta - expected;
  /* Tolerance scales with the size of the economy: floating-point error across
     several hundred transfers grows with the magnitudes involved, and a fixed
     epsilon would false-positive on a large city and miss a real leak on a
     small one. */
  const tol = Math.max(1, Math.abs(after) * 1e-6);
  /* 🔴 THE BOUND ON FOUNDING CAPITAL, ASSERTED SEPARATELY FROM THE IDENTITY.
     The day identity above only proves that what was created was RECORDED. It
     says nothing about how much, and "recorded" is precisely the state the old
     un-audited mint could have been talked into — an unbounded faucet that
     balances its own books every day is still the Forge. `issueCharter()`
     clamps to the lifetime cap; this checks the clamp rather than trusting it,
     so a future edit that adds a second issuance path fails the audit on the
     next tick instead of shipping. */
  const capOk = S.charterIssued <= ECON.firm.charter.lifetimeCap + tol;
  const ok = Math.abs(err) <= tol && capOk;
  S.lastAudit = { ok, before, after, delta, expected, err, tol, day: S.day,
                  founding: S.flow.founding, charter: S.charter,
                  charterIssued: S.charterIssued,
                  charterCap: ECON.firm.charter.lifetimeCap, capOk };
  if (!capOk && S.payoutAllowed) {
    logEvent('bad', '🔴 Charter capital exceeded its lifetime cap (' +
                    Math.round(S.charterIssued).toLocaleString() + ' 🔥 of ' +
                    ECON.firm.charter.lifetimeCap.toLocaleString() + ' 🔥).');
    try { console.error('[economy] CHARTER CAP EXCEEDED', S.lastAudit); } catch (e) {}
  }
  if (!ok) {
    /* 🔴 A FAILED AUDIT DISABLES THE PAYOUT. The simulation is still playable —
       the city keeps running — but it stops paying its owner until the books
       balance. Paying out of an economy that cannot account for its own money
       is exactly the Forge bug, and this is the tripwire for it. */
    if (S.payoutAllowed) {
      S.payoutAllowed = false;
      logEvent('bad', '🔴 Treasury audit failed — payouts suspended. (Δ ' + err.toFixed(2) + ')');
      try { console.error('[economy] AUDIT FAILED', S.lastAudit); } catch (e) {}
    }
  }
  return S.lastAudit;
}

/* The host withdraws what it is owed, through the EXISTING bridge Cinder path.
   Returns the whole Cinder to pay; the fraction is kept for next time so the
   drain does not silently round to zero every tick on a small city. */
export function claimPayout() {
  if (!S.payoutAllowed) return 0;
  const whole = Math.floor(S.payoutOwed);
  if (whole < 1) return 0;
  /* 🔴 THE CLAIM IS A TRANSFER BETWEEN TWO SAVE FIELDS, NOT A DELETION — and
     that is the whole of `payoutInFlight`. It used to be `S.payoutOwed -= whole`
     and nothing else, so between this line and the bridge's answer the money was
     in NO field at all. See `S.payoutInFlight` for the 19.00 🔥 that measured. */
  S.payoutOwed -= whole;
  S.payoutInFlight += whole;
  return whole;
}

/* 🔴 THE OTHER HALF OF claimPayout(), AND IT WAS MISSING. THIS ONE LOST THE
   PLAYER'S MONEY, NOT THE HOUSE'S.
   ----------------------------------------------------------------------------
   `claimPayout()` decrements `payoutOwed` UNCONDITIONALLY and returns, while
   index.js did `Promise.resolve(bridge.addCinders(owed)).catch(() => {})`. So
   whenever the bridge rejected, the Cinder had already left the simulation's
   books — treasury debited on the day it was drawn, `flow.payout` recorded, the
   day audit perfectly satisfied — and it never arrived in the player's wallet.
   It existed in NEITHER ledger. Reachable in production without any exploit:
   `MythicCityBridge.addCinders` in 'message' mode is an RPC over postMessage,
   and it can time out or hit a dead parent. There was no retry and no re-credit
   path.

   ⚠ THIS COMMENT USED TO SAY THAT RPC "REJECTS ON TIMEOUT OR A DEAD PARENT",
     AND THAT WAS FALSE — index.js was written against the claim and inherited
     the bug. node-city's `rpc()` RESOLVED `null` from an 1800 ms setTimeout and
     `null` again when postMessage threw, and `B.addCinders` returned `undefined`
     on every path, so the caller's `if (res === false) refund` never fired and a
     timed-out payout was booked as delivered. MEASURED, 400 ticks against a
     parent that never answered: 570.00 🔥 booked into `payoutLifetime`, 0.00 🔥
     in the wallet. The bridge now resolves a strict boolean and index.js refunds
     on anything that is not `true`. A comment describing a contract the other
     file does not keep is worse than no comment: this one cost the money the
     function below exists to save.

   MEASURED on the pre-fix tree, 400 ticks against a bridge that rejected every
   call: 10,193 🔥 claimed out of the sim, 0 🔥 delivered, `lastAudit.ok === true`
   throughout — because none of it happens inside runDay's window.

   Putting it back on `payoutOwed` is correct and cannot double-pay: `payoutOwed`
   is deliberately NOT a term of `totalCinder()` (the money left the city's
   accounts on the day it was drawn), so a refund moves the audited total by
   exactly zero, and the next tick's `claimPayout()` simply tries the bridge
   again. It rides the save, so a refund also survives a reload.

   ⚠ THE CALLER MUST REFUND WHEN THERE IS NO BRIDGE AT ALL, TOO. The old code
     read `if (bridge && typeof bridge.addCinders === 'function')` AFTER the
     claim, so a missing bridge dropped the money on the floor down the same
     hole with no rejection involved. See index.js.

   ⚠ AND IT RETIRES THE IN-FLIGHT TERM, because this IS the settlement. The
     amount moves `payoutInFlight → payoutOwed`; forgetting the first half would
     leave a phantom on the books that `load()` would then credit a SECOND time
     onto `payoutOwed`, which is a mint operated by a flaky network. */
export function refundPayout(amount) {
  const amt = Math.max(0, Number(amount) || 0);
  if (!(amt > 0)) return 0;
  S.payoutInFlight = Math.max(0, S.payoutInFlight - amt);
  S.payoutOwed += amt;
  return amt;
}

/* 🔴 THE OTHER SIDE OF THE SAME PROMISE — the confirmed delivery.
   ----------------------------------------------------------------------------
   Called by index.js ONLY when the bridge has confirmed, and deliberately not by
   `claimPayout()`. `claimPayout()` is optimistic by construction: it moves the
   money to `payoutInFlight` synchronously and the delivery is settled a network
   round trip later, so tallying there would count money the player may never
   receive — and `refundPayout()` would then have to un-tally it, which is two
   code paths that can disagree about the same Cinder. Claim and delivery are
   separate events; only the second one is real.

   This is where the in-flight term is RETIRED: the amount leaves
   `payoutInFlight` and lands in the lifetime tally, which is the only ledger
   that can answer "how much has this city already handed its owner?".

   ⚠ NOTHING IN THE SIMULATION READS `payoutLifetime`. It is a readout, and it
     is deliberately still here after the load clamp that used to consume it was
     removed: it is the only record that a payout ever actually ARRIVED, and the
     day audit structurally cannot say so (it closes before the promise does). */
export function notePayoutDelivered(amount) {
  const amt = Math.max(0, Number(amount) || 0);
  if (!(amt > 0)) return 0;
  S.payoutInFlight = Math.max(0, S.payoutInFlight - amt);
  S.payoutLifetime += amt;
  return amt;
}

/* ════════════════════════════════════════════════════════════════════════════
   📊 SNAPSHOT — everything the UI and the bottleneck tracer read.
   ════════════════════════════════════════════════════════════════════════════ */
export function closures(n) {
  const a = S.closures || [];
  return n ? a.slice(-Math.max(1, n | 0)) : a.slice();
}

export function snapshot() {
  const hh = HH.state();
  return {
    day: S.day, nodeId: S.nodeId,
    treasury: S.treasury, payoutOwed: S.payoutOwed, payoutAllowed: S.payoutAllowed,
    /* Exposed so "the payout is stuck in the bridge" is readable rather than
       inferred from a balance that quietly stopped moving. */
    payoutInFlight: S.payoutInFlight,
    /* 💸 …AND THE ONE FIGURE THAT SAYS A PAYOUT ACTUALLY ARRIVED, which was
       tracked but unreadable outside this module. Its own header calls it "the
       only record that a payout ever actually ARRIVED" and then nothing could
       see it — so the defect where every timed-out payout was booked as
       delivered (570.00 🔥 "delivered", 0.00 🔥 in the wallet) was invisible to
       the panel AND to the gate. A number nobody can read is a number nobody
       notices going wrong; run.mjs round0v reads this one. */
    payoutLifetime: S.payoutLifetime,
    /* Exposed so a panel (and the gate) can read the founding faucet directly
       rather than inferring it from a total that moved. */
    charter: S.charter, charterIssued: S.charterIssued,
    charterCap: ECON.firm.charter.lifetimeCap,
    /* What is left of THIS window's treasury draw allowance. Exposed for the
       same reason `charterIssued` is: a bound nobody can read is a bound nobody
       notices breaking. It is deliberately NOT serialised — a window is the gap
       between two ticks, and a save carrying a stale allowance would hand the
       loaded city a second one. `reset()` disarms; the first draw re-arms. */
    foundingDrawBudget: S.foundingDrawBudget,
    /* Lifetime estate receipts. `flow.estate` is zeroed every runDay, and a
       demolition happens BETWEEN two runDays — so the per-day figure is usually
       already gone by the time anything reads it. This is the number that
       proves the wind-up path actually ran. */
    estateReceived: S.estateReceived,
    /* 💼 …and the same argument, for the arrow that replaced the treadmill:
       what the city's own savers have put into new businesses over its life.
       Read beside `charterIssued` this is the whole diagnosis in two numbers —
       a city whose foundings are funded privately stops spending its finite
       charter allowance, and `charterIssued` stops climbing. */
    equitySubscribed: S.equitySubscribed,
    population: HH.population(), laborForce: HH.laborForce(),
    employed: HH.employedTotal(), vacancies: HH.vacancyTotal(),
    unemployment: HH.unemployment(),
    savings: HH.totalSavings(), tiers: { ...hh.pop },
    firms: Firms.alive().length, bankrupt: Firms.all().filter(f => f.rung === 'BANKRUPT').length,
    firmCash: Firms.totalCash(), firmDebt: Firms.totalDebt(),
    flow: { ...S.flow },
    satisfaction: { ...hh.satisfaction },
    unmet: { ...hh.unmetDemand },
    /* 📊 The denominator `satisfaction` and `unmet` are two thirds of. Published
       because a reader that only has the ratio cannot tell a city short of five
       hundred Cinder of goods from one short of four hundredths — see the note
       on `wantDemand` in households.js. */
    want: { ...hh.wantDemand },
    logistics: Logistics.report(),
    bank: Bank.report(),
    trade: Trade.report(S.nodeId),
    /* 🔌 The utility link, as a fresh copy — see the header on `labourMarket()`
       in index.js: the live bug this codebase already paid for on the card seam
       was a host object published BY REFERENCE. */
    utility: utilityReport(),
    audit: S.lastAudit,
    totalCinder: totalCinder(),
  };
}

/* ── Persistence ────────────────────────────────────────────────────────────
   🔴 ABSENT-TOLERANT, like everything else that loads in this codebase. A save
   written before the economy existed must open as "no economy", never as a
   throw — this project has shipped silent save bugs three times. */
export function serialize() {
  const inv = {};
  for (const id in S.INV) if (S.INV[id] > 0.001) inv[id] = Math.round(S.INV[id] * 1000) / 1000;
  /* 🔴 THE DEMAND FORECAST IS REAL STATE AND MUST RIDE THE SAVE.
     It was left out because it "recomputes itself" — it does, but only by going
     back through the warm-up seed, which starts every producer at nameplate
     capacity. A reloaded city therefore over-produced for several days, hired
     differently, and drifted: 28 firms became 29 and the treasury landed 8%
     apart from the same starting point. Reproducing a save has to mean
     reproducing the plan, not just the balances. */
  const dema = {};
  for (const id in S.demandEMA) {
    const v = S.demandEMA[id];
    if (isFinite(v) && v > 0.001) dema[id] = Math.round(v * 1000) / 1000;
  }
  return {
    v: 1, nodeId: S.nodeId, day: S.day, dayFrac: S.dayFrac, demandEMA: dema,
    treasury: Math.round(S.treasury * 100) / 100,
    /* 🔴 BOTH CHARTER FIELDS RIDE THE SAVE, and each for its own reason.
       `charter` is a real balance inside totalCinder() — dropping it would
       destroy the unspent fund on every reload (the save/load completeness
       check in gauntlet2 is exactly the test that catches this class, and it
       has caught three fields already). `charterIssued` is the lifetime tally
       the cap is enforced against — dropping THAT would hand every reloaded
       city a fresh allowance, which is an unbounded faucet operated by the save
       button. */
    charter: Math.round(S.charter * 100) / 100,
    charterIssued: Math.round(S.charterIssued * 100) / 100,
    /* 🚰 Lifetime readouts, all four of them. None is enforcement — they answer
       "where did this city's money come from and where did it go" across a
       reload, which `S.flow.*` structurally cannot because `zeroFlow()` wipes it
       every runDay. An older save carries none of them; `load()` reads a missing
       one as 0 and the city simply starts tallying from today. */
    faucetLifetime: Math.round(S.faucetLifetime * 100) / 100,
    importsLifetime: Math.round(S.importsLifetime * 100) / 100,
    payoutLifetime: Math.round(S.payoutLifetime * 100) / 100,
    payoutOwed: Math.round(S.payoutOwed * 100) / 100,
    /* 🔴 THE FIELD THE PLAYER'S MONEY USED TO DIE IN. Without this key a save
       written between `claimPayout()` and the bridge's answer records the
       claimed Cinder NOWHERE — measured at 19.00 🔥 destroyed on one ordinary
       tab close. `load()` moves it back onto `payoutOwed`. See
       `S.payoutInFlight`. */
    payoutInFlight: Math.round(S.payoutInFlight * 100) / 100,
    payoutAllowed: S.payoutAllowed, booted: S.booted,
    /* 🔌 THE UTILITY LINK. Three real numbers and they all have to ride the
       save. `owedImport` is energy the city HAS ALREADY BURNED and not paid
       for; `earnedExport` is energy it has already shipped; `arrears` is the
       debt that curtails the import. Dropping any of them lets a player clear
       an electricity bill with the reload button — which is precisely the bug
       gauntlet2's save/load round already caught twice (`loanId` and
       `blacklistUntil`: "a firm could take a second loan against the first by
       reloading the page"). An older save carries none of this and `load()`
       reads every field as 0, which is the correct reading of a city that has
       never traded power. */
    utility: { owedImport: Math.round(S.utility.owedImport * 100) / 100,
               earnedExport: Math.round(S.utility.earnedExport * 100) / 100,
               arrears: Math.round(S.utility.arrears * 100) / 100,
               importUnitMin: Math.round(S.utility.importUnitMin * 100) / 100,
               exportUnitMin: Math.round(S.utility.exportUnitMin * 100) / 100 },
    inv,
    households: HH.serialize(), firms: Firms.serialize(),
    bank: Bank.serialize(), trade: Trade.serialize(), prices: Prices.serialize(),
  };
}

export function load(raw) {
  if (!raw || typeof raw !== 'object') { reset(S.nodeId); return false; }
  reset(raw.nodeId != null ? raw.nodeId : S.nodeId);
  /* ⚠ NaN AND SIGN ONLY. `day` used to be clamped from above as well, because
     every rail in the load clamp was f(S.day) and a doctored day count bought
     the allowance; that clamp is gone and so is its bound — see the header above
     `audit()` for why, and for what a doctored save can still do. Nothing below
     derives an allowance from this number any more. */
  S.day = Math.max(0, raw.day | 0);
  S.dayFrac = Math.max(0, Math.min(1, Number(raw.dayFrac) || 0));
  /* 🚰 A lifetime readout. NaN and sign only, for the same reason as `day`. */
  S.faucetLifetime = Math.max(0, Number(raw.faucetLifetime) || 0);
  /* ⚠ NaN AND SIGN ONLY, AND THAT IS A KNOWN, DOCUMENTED RESIDUAL. `treasury`,
     `bank.reserve`, `households.savings` and every firm's `cash` are terms of
     totalCinder() and none of them is bounded for magnitude — a doctored save
     can still inflate this city's money. Read the header above `audit()` before
     "fixing" that here: the clamp that used to do it had a critical bypass of
     its own and adjudicated honest players' balances on a false identity.
     `charter` keeps its own tighter bound, which is not a forgery bound: the
     fund cannot honestly hold more than the bootstrap tranche or the top-up
     target, so a garbage value there would visibly distort the panel. */
  S.treasury = Math.max(0, Number(raw.treasury) || 0);
  const fundMax = Math.max(ECON.firm.charter.seed, ECON.firm.charter.fundTarget);
  S.charter = Math.min(fundMax, Math.max(0, Number(raw.charter) || 0));
  /* An older save has no tally. Treat what it is CARRYING as already issued —
     the alternative reads a pre-charter save as having spent nothing and gives
     it the whole allowance a second time.
     🔴 THE `lifetimeCap` BOUND STAYS, AND IT IS NOT A FORGERY BOUND — it points
     the other way. `audit()` suspends the payout when `charterIssued` exceeds
     the cap, because that check exists to catch a CODE path that outruns
     `issueCharter()`. A corrupt byte on disk is not that, and without this line
     one would permanently lock a real player out of their own payouts. */
  S.charterIssued = Math.min(ECON.firm.charter.lifetimeCap,
                             Math.max(Number(raw.charterIssued) || 0, S.charter));
  /* 💸 The two lifetime spend readouts. NaN and sign only — they used to be
     bounded by `charterIssued + faucetLifetime` to size a load-time ceiling that
     no longer exists, and nothing reads them for arbitration now. */
  S.importsLifetime = Math.max(0, Number(raw.importsLifetime) || 0);
  S.payoutLifetime  = Math.max(0, Number(raw.payoutLifetime) || 0);
  /* 🔴 AND THE IN-FLIGHT CLAIM COMES BACK AS OWED. A serialized `payoutInFlight`
     means the save was written between `claimPayout()` and the bridge's answer,
     and that answer died with the page — no `.then()` and no `.catch()` will
     ever run for it. The only two readings are "assume it arrived" (which
     destroys the player's money whenever it did not, and that is precisely what
     shipped: 19.00 🔥 gone on one ordinary tab close) and "assume it did not"
     (which at worst pays one tick's payout twice). Owe it again.
     ⚠ ADDED, NOT ASSIGNED, and `payoutInFlight` is left at zero: a save can
       legitimately carry both fields, and the claim is settled by this line. */
  S.payoutOwed = Math.max(0, Number(raw.payoutOwed) || 0) +
                 Math.max(0, Number(raw.payoutInFlight) || 0);
  /* ⚠ A save written while the disaster feature existed carries four extra keys
     (emergencyDue, emergencyOffset, shockRecoveryLeft, shockSev). They are
     IGNORED rather than migrated, and that is the correct direction: every one
     of them is a liability the player owed for a mechanic that no longer exists,
     so reading them would charge for a siege the city can no longer be in. This
     loader has never thrown on an unknown key — it reads what it names — which
     is why nothing has to be done to drop them. */
  S.payoutAllowed = raw.payoutAllowed !== false;
  /* 🔴 A SAVE IS PROOF THE CITY ALREADY EXISTS — AND THIS LINE USED TO LET THE
     SAVE ARGUE OTHERWISE. It read `S.booted = !!raw.booted`, so a save carrying
     `booted: false` walked out of load() with the flag down, and `bootstrap()`'s
     `if (S.booted) return false` therefore let it straight through to
     `issueCharter(ECON.firm.charter.seed)`. Textbook of the structural blind
     spot — money moving between the load and the first tick, where no audit
     window is open at all.
     MEASURED on the tree before this line changed, one edited boolean on an
     otherwise honest 60-day save, nothing else touched:
         charterIssued  300,000.00 → 600,000.00
         totalCinder    293,295.48 → 593,295.48   (+300,000 🔥, first reload)
         and ratcheting to the 700,000 🔥 lifetime cap over eight reloads:
         totalCinder settled at 492,514.87 against an honest 293,295.48.
     Unlike the deleted-economy-key door this one costs the player NOTHING —
     the city keeps every firm, every balance and every day it had lived.
     THE FIX IS UNCONDITIONAL AND LOSSLESS. `serialize()` only ever runs on a
     mounted economy, and `mount()` always calls `bootstrap()` first, so every
     honestly written save has `booted: true` already; there is no legitimate
     save this discards information from. The founding tranche exists for a city
     that does not exist yet, and a save is the one piece of evidence that
     settles that question. `raw.booted` is not read at all any more — a field
     the loader must ignore, in the same spirit as the retired disaster keys
     above. index.js `mount()` carries the second, independent refusal (it
     passes `established` whenever it handed over ANY state), so reverting this
     line alone does not reopen the door — see the round in run.mjs that breaks
     each of the two in turn. */
  S.booted = true;
  /* 🔌 THE UTILITY LINK. Absent on every save written before power trade
     existed, and 0 is the right reading of every one of them: a city that never
     imported a watt owes nothing. Sanitised the same way `noteUtilityTrade` is
     — a non-finite or negative figure from the disk is DROPPED, never clamped
     to something plausible, because a plausible-looking arrears would curtail a
     grid the player cannot see a reason for.
     ⚠ NOT bounded from above. `arrears` is a DEBT: a doctored save can only use
       it to make its own city worse off, so there is nothing here for the
       load-time-clamp argument above `totalCinder()` to defend against. */
  if (raw.utility && typeof raw.utility === 'object') {
    const u = raw.utility;
    const num = (v) => { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; };
    S.utility.owedImport = num(u.owedImport);
    S.utility.earnedExport = num(u.earnedExport);
    S.utility.arrears = num(u.arrears);
    S.utility.importUnitMin = num(u.importUnitMin);
    S.utility.exportUnitMin = num(u.exportUnitMin);
  }
  if (raw.demandEMA && typeof raw.demandEMA === 'object') {
    for (const id in raw.demandEMA) {
      const v = Number(raw.demandEMA[id]);
      if (isFinite(v) && v >= 0 && (RECIPES[id] || DEPOSITS[id])) S.demandEMA[id] = v;
    }
  }
  if (raw.inv && typeof raw.inv === 'object') {
    for (const id in raw.inv) {
      const v = Number(raw.inv[id]);
      // Drop ids the catalogue no longer knows, rather than carrying phantom stock.
      if (isFinite(v) && v > 0 && (RECIPES[id] || DEPOSITS[id])) S.INV[id] = v;
    }
  }
  HH.load(raw.households); Firms.load(raw.firms);
  Bank.load(raw.bank); Trade.load(raw.trade); Prices.load(raw.prices);
  return true;
}

export default { advance, snapshot, bootstrap, reset, serialize, load, claimPayout, refundPayout,
                 notePayoutDelivered, audit, noteUtilityTrade, utilityReport };
