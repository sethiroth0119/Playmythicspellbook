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
import { DEPOSITS, RECIPES, INDUSTRIES, legsOf, industryOf, bandOf } from './recipes.js';
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
     created, so together they are the exact ceiling on what this city can
     honestly hold. `flow.faucet` is zeroed every runDay and was therefore
     useless to a loader. See `loadedCinderCeiling()` for what this buys —
     without it, the ceiling has to be derived from the day count alone, which
     is ~3,000× looser than what a city actually earns. */
  faucetLifetime: 0,
  /* 🔴 THE TWO SUBTRACTION TERMS OF THE SAME IDENTITY, AND LEAVING THEM OUT MADE
     THE LOAD CEILING A PER-RELOAD ALLOWANCE INSTEAD OF A CEILING.
     ------------------------------------------------------------------------
     `clampLoadedCinder()` §3 bounds `payoutOwed` by the headroom the ceiling has
     left over the balances on the books, and the identity it is built from is

         created (= charterIssued + faucetLifetime)
             = totalCinder + imports + payoutDelivered + payoutOwed

     `charterIssued` and `faucetLifetime` are lifetime tallies precisely because
     `S.flow.*` is wiped by `zeroFlow()` at the top of every runDay. The two
     SUBTRACTION terms never got the same treatment, so a loader read both as
     zero and handed the city its ENTIRE lifetime spend-and-payout back as fresh
     headroom — and delivering the money did not close it, because nothing
     recorded the delivery either. The next load re-opened it in full.

     MEASURED through the exact call node-city makes, on an ordinary 200-day
     city with ONE edited number (`payoutOwed`) and no day lever:
       5,997 → 10,485 → 10,564 → 10,645 → 10,730 → 10,814 → 10,896 → 10,975 🔥
       into Profile.gems, one grant per page reload, 81,106 🔥 over 8 reloads,
       still rising, `lastAudit.ok === true` throughout.
     With the day lever on top (`day` + `faucetLifetime` + `payoutOwed`, treasury
     deliberately LEFT ALONE so the §2 total clamp does not eat the forgery):
       13,166,610 🔥 in one cycle and 79,020,933 🔥 over six, unbounded.

     ⚠ THESE ARE SUBTRACTION TERMS, so a forger's lever on them points DOWN, and
       zeroing them buys back exactly the headroom that shipped unconditionally
       before this existed. That is not a reason to skip them — it is the
       difference between "one edited number pays forever" and "the forgery has
       to be rewritten, consistently, on every single reload". The city is
       client-authoritative; see clampLoadedCinder()'s header for the honest
       limit of every clamp in this file. */
  importsLifetime: 0,
  /* ⚠ CONFIRMED DELIVERY ONLY — never incremented by `claimPayout()`. A claim
     that the bridge then refuses is put back by `refundPayout()`, and if the
     claim had been tallied here the refund would look like money the city had
     already handed over: the headroom would close against Cinder the player
     never received, and the next reload would confiscate it. index.js increments
     this in the `.then()` and nowhere else. Round 0s §2's bridge-down round-trip
     is what holds that line. */
  payoutLifetime: 0,
  /* Lifetime tally of wound-up firms' cash received into the treasury. Purely a
     readout — the estate is a transfer and appears in no audit identity — but
     without it nothing can tell "no firm ever closed holding cash" apart from
     "the wind-up path is broken again". */
  estateReceived: 0,
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
  /* Per-day flow readouts, for the panel and the audit. */
  flow: { wages: 0, shopping: 0, b2b: 0, rent: 0, tax: 0, benefits: 0,
          imports: 0, exports: 0, faucet: 0, payout: 0, freight: 0, interest: 0,
          civic: 0, infrastructure: 0, upkeep: 0, welfare: 0, unmetSubsistence: 0,
          founding: 0, estate: 0,
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
  lastAudit: null,
  log: [],              // [{day, kind, msg}]
  booted: false,
  outputValue: {},      // resId → Cinder of value produced today (specialization)
  serviceValue: {},     // industry → Cinder of service revenue today
  observed: {},         // resId → {supply, demand}
  demandEMA: {},        // resId → smoothed daily offtake (see productionTargets)
};

export function state() { return S; }
export function treasury() { return S.treasury; }
export function inventory() { return S.INV; }
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
  S.importsLifetime = 0; S.payoutLifetime = 0;
  S.foundingDrawBudget = 0; S.foundingDrawArmed = false;
  S.payoutAllowed = true; S.payoutOwed = 0; S.log = []; S.booted = false;
  S.outputValue = {}; S.serviceValue = {}; S.observed = {}; S.demandEMA = {};
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
   rather than five `S.flow.imports += x` sites for exactly one reason: the
   lifetime tally has to be EXACT or `clampLoadedCinder()` §3 mis-sizes the
   headroom in one of the two directions that costs someone money. Too small a
   tally leaks (that was the whole of round 3); too large a one confiscates
   payouts a rejecting bridge never delivered.
   ⚠ TALLYING AT THE END OF runDay WOULD HAVE BEEN WRONG, and it was the obvious
     first shape. `runPartial()` also runs production and shopping, both of which
     import, and the next `runDay` opens with `zeroFlow()` — so a day-end tally
     silently drops every partial tick's imports and the ceiling drifts open by
     however long the host ticks below one whole day. Tally where the money
     actually moves. */
function addImports(amount) {
  if (!(amount > 0)) return;
  S.flow.imports += amount;
  S.importsLifetime += amount;
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

/* The capital source firms.js calls at every founding. Charter fund first: it
   exists for exactly this, and draining the treasury first would take the money
   the city needs the same day for benefits, imports and freight. */
function fundFounding(f, want) {
  const need = Math.max(0, Number(want) || 0);
  if (need <= 0) return 0;
  let paid = Math.max(0, Math.min(S.charter, need));   // never a negative "draw"
  S.charter -= paid;
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
    /* Never silent, for the same reason clampLoadedCinder() is never silent. */
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
  const earned = traded.revenue;
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
        logEvent('bad', '🏚 ' + f.name + ' (' + f.out + ') went bankrupt. ' +
                        Firms.employeeCount(f) + ' jobs lost.');
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
  Firms.reap();

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
   🔴 THE SECOND AUDIT — THE ONE THE DAY AUDIT STRUCTURALLY CANNOT PERFORM.
   ----------------------------------------------------------------------------
   `audit()` below reads `before` INSIDE runDay. Everything that moves money
   outside that window is invisible to it, and this project has now shipped
   three separate Rule 1 violations in exactly that gap: the founding mint
   (between ticks, from syncBuildings), the setPopulation destruction (before
   Sim.advance, from index.js tick) and this one — `load()`, which runs before
   any window has opened at all.

   MEASURED on the pre-fix tree, from an honest 40-day city holding 298,394 🔥:

     doctor treasury                 → totalCinder 1,000,298,330.49  (+999,999,936)
     doctor bank.reserve             → totalCinder 1,000,298,394.00  (+1,000,000,000)
     doctor households.savings.low   → totalCinder 1,000,296,764.07  (+999,998,370)
     doctor firms.firms[0].cash      → totalCinder 1,000,296,815.33  (+999,998,421)
     doctor charter (the clamped one)→ totalCinder       375,291.96  (+76,898)

   Four of the five terms of `totalCinder()` had NO magnitude bound at all —
   `Math.max(0, Number(x) || 0)` in four different files, each of which is NaN
   safety and nothing more. Every doctored save then passed the day audit for
   the rest of the city's life, because the day audit only ever asks whether the
   DAY balanced. And the fifth, `charter`, was clamped to `max(seed, fundTarget)`
   — a bound well above what the fund honestly holds mid-life, so it leaked
   76,898 🔥 too.

   ── WHY THIS CEILING IS EXACT AND NOT A GUESS ──────────────────────────────
   There are exactly two ways Cinder is ever created:
     • `issueCharter()`, tallied for life in `charterIssued`, hard-capped by
       ECON.firm.charter.lifetimeCap and rate-limited to `maxPerDay`;
     • the export faucet, tallied for life in `faucetLifetime`, hard-clamped
       every day to `ECON.faucet.maxPerMin × ECON.clock.dayMin`.
   Everything else in the model is a transfer. So for any honest city, at any
   moment:

       totalCinder()  ≤  charterIssued + faucetLifetime

   That is not an estimate — it is the day audit's own identity summed over the
   city's life, with the two subtractions (imports, payout) dropped. Measured
   over 12 randomised cities × 200 days the worst headroom was +44.44 🔥 and it
   was never negative, which is what makes it safe to enforce: an honest save is
   never touched, and a doctored one has nowhere to hide.

   ⚠ THE HONEST LIMIT OF THIS, STATED PLAINLY. The city is client-authoritative;
     a console user can already reach the host's addGems. What this stops is the
     PERSISTED-FILE version — no console, survives reloads, copy-pasteable. It
     is a floor, not the only defence. And a forger who doctors `day`,
     `faucetLifetime` and `charterIssued` CONSISTENTLY still buys headroom,
     because an old city may honestly be rich; every field below is therefore
     clamped by what the day count structurally allows, so the forgery has to
     stay internally consistent instead of being one edited number.
   ════════════════════════════════════════════════════════════════════════════ */

/* The largest `day` a save is allowed to claim. NOT a tuning number — it does
   not change one outcome for an honest city, it only stops a doctored `day`
   from buying an unbounded ceiling below. Derived from ECON.clock so it reads
   as what it is: ONE YEAR of continuous, twenty-four-hours-a-day play at 20
   real minutes per economic day. It is in this file rather than in ECON for the
   same reason `LOG_MAX` is — nothing in the simulation reads it.

   🔴 IT USED TO SAY A CENTURY (2,628,000 days) AND THAT WAS THE WHOLE LEVER.
      `faucetMax` below is a per-day allowance, so `days` multiplies it directly:
      at a century the allowance was 47,304,018,000 🔥 and a save doctored with
      `day` + `faucetLifetime` + a balance loaded at totalCinder 1,000,298,159
      against an honest 298,251 — the clamp was present, correctly written, and
      bounded nothing. A century is not a bound, it is a decoration.

   ⚠ WHY THIS CANNOT CONFISCATE FROM A GENUINELY OLD CITY. Clamping `day` only
     lowers the two allowances below; it does not touch a balance directly.
     `charterMax` is already pinned at the 700,000 lifetime cap from day ~100 on,
     so it is unaffected. That leaves the faucet allowance, and the margin there
     is 16× (500 🔥/day allowed against a measured worst of 30.35 🔥/day) — so a
     city would have to be SIXTEEN YEARS of continuous round-the-clock play old
     before the clamp reached its honest export earnings. Round 0s §2a measures
     that margin every run and goes red if a tuning change ever eats it, so the
     clamp can never start quietly confiscating a real player's exports. */
const SAVE_MAX_DAY = Math.ceil((365 * 24 * 60) / ECON.clock.dayMin);

/* 🚰 WHAT THE EXPORT FAUCET HONESTLY EARNS IN A DAY, as opposed to what it is
   structurally permitted to earn.
   ────────────────────────────────────────────────────────────────────────────
   `ECON.faucet.maxPerMin × ECON.clock.dayMin` = 18,000 🔥/day is the clamp
   `runDay` applies to a single day's export income. It is a safety rail set
   hundreds of times above anything the model produces, which is fine as a rail
   and useless as a ceiling: measured over 50 city configurations (10 nodes ×
   5 populations × 400 days) the worst SUSTAINED rate was 20.97 🔥/day, and the
   gate's own narrower sweep finds 30.35 🔥/day — the structural cap is 590×
   loose. Multiplied by a doctored day count that is the entire save-mint lever,
   so the load ceiling uses THIS number instead.

     measured worst sustained  30.35 🔥/day   → allowance 500 🔥/day  (16× margin)
     measured worst single day 474.30 🔥      → covered by the per-day allowance
                                                and again by the burst below

   The burst exists because the first days of a city are lumpy — a single day
   legitimately hit 474 🔥 while the lifetime average was 21 — and a one-day-old
   save must never be clamped. It is not a per-day allowance, it is a one-off
   floor under the whole lifetime bound.

   🔴 THESE ARE NOT GUESSES AND THEY ARE NOT ALLOWED TO ROT. Round 0s sweeps
      honest cities and asserts none of them ever earns within a wide factor of
      the allowance; if a tuning change raises real export income, the GATE goes
      red rather than the clamp quietly confiscating a player's money. */
const HONEST_FAUCET_PER_DAY = 500;
const FAUCET_BURST = 20000;
function honestFaucetMax(days) {
  /* Never above what the per-day structural clamp could have produced either —
     for a very young city the structural bound is the tighter of the two, and
     taking the min means this can only ever be stricter than what shipped. */
  return Math.min(ECON.faucet.maxPerMin * ECON.clock.dayMin * days,
                  FAUCET_BURST + HONEST_FAUCET_PER_DAY * days);
}

export function loadedCinderCeiling() {
  const C = ECON.firm.charter;
  /* `day + 1`, not `day`: a save is written mid-day, so the day in progress has
     already been able to issue and to earn. Resolving the ambiguity upward is
     the only safe direction — the opposite one confiscates honest money. */
  const days = Math.max(0, S.day) + 1;
  /* What the two creation paths could STRUCTURALLY have produced by this day.
     These bound the two tallies; the tallies themselves are what the ceiling is
     actually built from, because they are far tighter. */
  const charterMax = Math.min(C.lifetimeCap, C.seed + C.maxPerDay * days);
  /* 🚰 THE HONEST RATE, NOT THE STRUCTURAL RAIL — see honestFaucetMax(). This
     term used to be `ECON.faucet.maxPerMin × ECON.clock.dayMin × days`, i.e.
     18,000 🔥/day against a measured 20.97 🔥/day, with `days` attacker-supplied
     up to SAVE_MAX_DAY. That is how a doctored save still reached 1.0003 BILLION
     with every one of the five balance clamps working exactly as written. */
  const faucetMax  = honestFaucetMax(days);
  /* 🔴 THE CEILING IS THE TALLIES, NOT THE STRUCTURAL MAXIMA. Using the maxima
     would have been ~55% loose on a 40-day city (464,000 🔥 against an honest
     298,394 🔥) purely because the maxima describe a city that has never spent
     anything. `charterIssued` and `faucetLifetime` are what this city actually
     created, and `total = created − imports − payout` means they bound it
     exactly. Measured over 12 randomised cities × 200 days the worst headroom
     was +44.44 🔥 and never negative.
     Both tallies are themselves clamped on load to the maxima above, so a
     forger cannot simply raise the ceiling by editing them — the day count has
     to move too, and then every other field has to agree with it. */
  const ceiling = Math.min(S.charterIssued, charterMax) + Math.min(S.faucetLifetime, faucetMax);
  /* 🔴 +1 🔥 OF SLACK, AND IT IS NOT A FUDGE FACTOR. `serialize()` rounds the
     money fields to 2dp and each one may round UP; across a treasury, a charter
     fund, a reserve and thirty firms that is a few hundredths of a Cinder of
     honest drift the identity above does not model. One Cinder is four orders
     of magnitude below the thinnest headroom ever measured and eight below the
     smallest doctored value this has to catch. */
  return { charterMax, faucetMax, ceiling: ceiling + 1 };
}

/* Applied by `load()` AFTER every sub-module has loaded, because the ceiling is
   on the TOTAL and four different files hold pieces of it. Returns the list of
   terms it had to touch, so the caller can say so out loud — a clamp that fires
   silently is indistinguishable from a clamp that does not fire. */
function clampLoadedCinder() {
  const { ceiling } = loadedCinderCeiling();
  const clamped = [];
  /* 1. NO SINGLE TERM MAY EXCEED THE WHOLE CITY'S CEILING. This is what stops
        the four one-field doctors above, and it stops them at the field, which
        is where a reader can see which one was forged. */
  if (S.treasury > ceiling) { clamped.push('treasury ' + Math.round(S.treasury)); S.treasury = ceiling; }
  if (S.charter  > ceiling) { clamped.push('charter ' + Math.round(S.charter));   S.charter  = ceiling; }
  if (Bank.state().reserve > ceiling) {
    clamped.push('bank.reserve ' + Math.round(Bank.state().reserve));
    Bank.scaleReserve(ceiling / Bank.state().reserve);
  }
  if (HH.totalSavings() > ceiling) {
    clamped.push('households.savings ' + Math.round(HH.totalSavings()));
    HH.scaleSavings(ceiling / HH.totalSavings());
  }
  if (Firms.totalCash() > ceiling) {
    clamped.push('firms.cash ' + Math.round(Firms.totalCash()));
    Firms.scaleCash(ceiling / Firms.totalCash());
  }
  /* 2. AND THE SUM MAY NOT EITHER. Five terms each just under the ceiling still
        add to five times it, so the whole total is scaled back proportionally
        rather than any one term being singled out — the loader cannot know
        which field was forged, and picking one would be a guess that quietly
        destroys the honest four. */
  const total = totalCinder();
  if (total > ceiling * (1 + 1e-9) + 1e-6) {
    const k = ceiling / total;
    clamped.push('TOTAL ' + Math.round(total) + '→' + Math.round(ceiling));
    S.treasury *= k; S.charter *= k;
    Bank.scaleReserve(k); HH.scaleSavings(k); Firms.scaleCash(k);
  }
  /* ── 3. 🔴 AND `payoutOwed`, WHICH IS THE ONLY ONE THAT LEAVES THE CITY ─────
     THE MISS THAT MADE EVERYTHING ABOVE ORNAMENTAL. `payoutOwed` is a save
     field, it is deliberately NOT a term of `totalCinder()` (the money left the
     city's accounts on the day it was drawn — see refundPayout()'s header), and
     so §1 and §2 above never once looked at it. Every account this function
     bounds stays INSIDE the simulation. `payoutOwed` is the single field that
     crosses the bridge into `Profile.gems`, i.e. into real player currency, and
     it shipped with `Math.max(0, Number(raw.payoutOwed) || 0)` — NaN safety and
     no ceiling at all.

     MEASURED on the tree that had all five clamps above working perfectly,
     doctoring this ONE field and nothing else:

       totalCinder      298,251.05  ← UNCHANGED, so the clamp never looked
       state.payoutOwed 1,000,000,000.00
       after ONE tick: delivered to the player 1,000,000,022 🔥
       lastAudit.ok     true

     THE BOUND IS THE HEADROOM, NOT THE CEILING, and that is tighter and exact.
     Over a city's life the identity is

         created = totalCinder + imports + payoutDelivered + payoutOwed

     and `ceiling` is `created` (+1 🔥 of rounding slack). So the most that can
     honestly still be owed is what the ceiling has left AFTER the balances on
     the books AND the two terms that already left the city. It self-consistently
     makes room for the real case that grows this field: a bridge that has been
     rejecting for hours. Every refund put back on `payoutOwed` was drawn out of
     the treasury first, so `totalCinder()` went DOWN by the same amount, nothing
     was delivered so `payoutLifetime` did not move, and the headroom opened by
     exactly as much. Round 0s §2's round-trip asserts that case directly rather
     than trusting this paragraph.

     🔴 AND THE TWO SUBTRACTED TERMS ARE THE WHOLE OF ROUND 3. This line used to
     read `ceiling - totalCinder()`, i.e. it dropped `imports` and
     `payoutDelivered` from an identity its own header states in full — and the
     paragraph above it argued they "only make it slacker, never tighter", which
     is true of the BOUND and catastrophic for the LEDGER. Both terms describe
     money that has already left the city, so leaving them out re-grants the
     city's entire lifetime spend-and-payout as fresh headroom, and delivering
     against that headroom did not close it because nothing tallied the
     delivery. The clamp was a per-reload allowance, not a ceiling:

       one edited number (`payoutOwed`), ordinary 200-day city, no day lever —
       5,997 → 10,485 → 10,564 → 10,645 → 10,730 → 10,814 → 10,896 → 10,975 🔥
       into Profile.gems, one grant PER PAGE RELOAD, 81,106 🔥 over eight,
       still rising, audit green throughout.

     See `S.importsLifetime` / `S.payoutLifetime` for why the two needed lifetime
     tallies at all, and Round 0s §5 for the loop that would have caught this —
     §2 measures a SINGLE load and is structurally unable to see a ratchet. */
  const headroom = Math.max(0, ceiling - totalCinder() - S.payoutLifetime - S.importsLifetime);
  /* Reported to 2dp rather than rounded, because §2 above can leave the headroom
     at exactly zero on an already-forged save and a whole-number `0→0` would
     read as a no-op clamp. It is not a no-op: the fractional carry really is
     confiscated, and a save that reached §2 has already proven itself forged. */
  if (S.payoutOwed > headroom + 1e-6) {
    clamped.push('payoutOwed ' + S.payoutOwed.toFixed(2) + '→' + headroom.toFixed(2));
    S.payoutOwed = headroom;
  }
  if (clamped.length) {
    /* 🔴 NEVER SILENT. The whole reason this class of bug survived is that
       nothing anywhere said a word when money appeared. */
    logEvent('bad', '🔴 The save claimed more Cinder than this city can hold — clamped to ' +
                    Math.round(ceiling).toLocaleString() + ' 🔥.');
    try { console.warn('[economy] save exceeded the honest Cinder ceiling; clamped: ' + clamped.join(', ')); } catch (e) {}
  }
  return clamped;
}

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
  S.payoutOwed -= whole;
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
   `MythicCityBridge.addCinders` in 'message' mode is an RPC that rejects on
   timeout or a dead parent. There was no retry and no re-credit path.

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
     hole with no rejection involved. See index.js. */
export function refundPayout(amount) {
  const amt = Math.max(0, Number(amount) || 0);
  if (!(amt > 0)) return 0;
  S.payoutOwed += amt;
  return amt;
}

/* 🔴 THE OTHER SIDE OF THE SAME PROMISE — the tally that closes the headroom.
   ----------------------------------------------------------------------------
   Called by index.js ONLY when the bridge has confirmed, and deliberately not by
   `claimPayout()`. `claimPayout()` is optimistic by construction: it decrements
   `payoutOwed` synchronously and the delivery is settled a microtask later, so
   tallying there would count money the player may never receive — and because
   `clampLoadedCinder()` §3 SUBTRACTS this tally from the headroom, an
   over-count is not a cosmetic error. It would close the ceiling against Cinder
   that a rejecting bridge put straight back on `payoutOwed`, and the next reload
   would confiscate it. That is the exact failure `owed-confiscate` sabotages
   round 0s §2 into, and it is why the two halves are separate functions.

   Nothing in the simulation reads this. It exists so that a save can be asked
   the one question the day audit never can: "how much has this city ALREADY
   handed its owner?" Without it, every reload handed the whole lifetime figure
   back as fresh headroom — 81,106 🔥 over eight reloads from one edited byte.

   ⚠ ONE WINDOW STAYS OPEN AND IT IS BOUNDED, STATED HERE RATHER THAN IN A
     COMMIT MESSAGE. `claimPayout()` decrements synchronously and this runs a
     microtask later, so a save written BETWEEN the two records neither the
     `payoutOwed` (already gone) nor the delivery (not yet tallied). The next
     load's headroom is then wider by exactly one tick's payout — tens of 🔥 —
     and it does not compound, because every later delivery is tallied normally.
     It errs toward the player, and closing it properly means making the claim
     and the delivery one transaction, which is a bridge-protocol change and not
     something /src/economy can do alone. */
export function notePayoutDelivered(amount) {
  const amt = Math.max(0, Number(amount) || 0);
  if (!(amt > 0)) return 0;
  S.payoutLifetime += amt;
  return amt;
}

/* ════════════════════════════════════════════════════════════════════════════
   📊 SNAPSHOT — everything the UI and the bottleneck tracer read.
   ════════════════════════════════════════════════════════════════════════════ */
export function snapshot() {
  const hh = HH.state();
  return {
    day: S.day, nodeId: S.nodeId,
    treasury: S.treasury, payoutOwed: S.payoutOwed, payoutAllowed: S.payoutAllowed,
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
    population: HH.population(), laborForce: HH.laborForce(),
    employed: HH.employedTotal(), vacancies: HH.vacancyTotal(),
    unemployment: HH.unemployment(),
    savings: HH.totalSavings(), tiers: { ...hh.pop },
    firms: Firms.alive().length, bankrupt: Firms.all().filter(f => f.rung === 'BANKRUPT').length,
    firmCash: Firms.totalCash(), firmDebt: Firms.totalDebt(),
    flow: { ...S.flow },
    satisfaction: { ...hh.satisfaction },
    unmet: { ...hh.unmetDemand },
    logistics: Logistics.report(),
    bank: Bank.report(),
    trade: Trade.report(S.nodeId),
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
    /* 🚰 The other half of the load ceiling. Dropping this would not lose the
       player a Cinder, but it would make `loadedCinderCeiling()` fall back to
       the day-derived faucet bound, which is ~3,000× what a city actually
       earns — i.e. the clamp would still be there and would no longer bite. */
    faucetLifetime: Math.round(S.faucetLifetime * 100) / 100,
    /* 💸 The two SUBTRACTION terms of the same identity. Dropping either one
       does not lose the player a Cinder — it re-opens the payoutOwed headroom by
       whatever this city has already spent abroad or already paid its owner, on
       EVERY load, which is what turned the round-2 ceiling into a per-reload
       allowance worth 81,106 🔥 over eight reloads. See clampLoadedCinder() §3.
       ⚠ An older save carries neither key; `load()` reads a missing one as 0,
         which is the same open headroom for exactly one load and then closes
         permanently as the city runs. That is the correct direction for a
         migration: a real player's save is never confiscated, and the leak is
         bounded by one reload's honest lifetime figures rather than repeating. */
    importsLifetime: Math.round(S.importsLifetime * 100) / 100,
    payoutLifetime: Math.round(S.payoutLifetime * 100) / 100,
    payoutOwed: Math.round(S.payoutOwed * 100) / 100,
    payoutAllowed: S.payoutAllowed, booted: S.booted,
    inv,
    households: HH.serialize(), firms: Firms.serialize(),
    bank: Bank.serialize(), trade: Trade.serialize(), prices: Prices.serialize(),
  };
}

export function load(raw) {
  if (!raw || typeof raw !== 'object') { reset(S.nodeId); return false; }
  reset(raw.nodeId != null ? raw.nodeId : S.nodeId);
  /* 🔴 DAY FIRST, AND CLAMPED. Every ceiling below is derived from it, so a
     save claiming `day: 2e9` (which `| 0` happily accepted — int32 is 2.1
     billion) used to buy an effectively infinite allowance for the clamps that
     follow. See SAVE_MAX_DAY. */
  S.day = Math.min(SAVE_MAX_DAY, Math.max(0, raw.day | 0));
  S.dayFrac = Math.max(0, Math.min(1, Number(raw.dayFrac) || 0));
  /* 🚰 Loaded BEFORE the balances, because it is half of the ceiling they are
     measured against, and itself clamped to what the daily faucet cap could
     structurally have produced in this many days. */
  /* ⚠ THE SAME BOUND `loadedCinderCeiling()` USES, and it has to be the same one
     or the clamp and the ceiling disagree about what an honest city can earn.
     Both go through honestFaucetMax() for exactly that reason. */
  S.faucetLifetime = Math.min(honestFaucetMax(S.day + 1),
                              Math.max(0, Number(raw.faucetLifetime) || 0));
  /* 🔴 THE SAVE FILE IS NOT ALLOWED TO MINT EITHER — and this comment used to
     say `charter` was "the one field where it could", which was false and cost
     four unbounded terms. `treasury`, `bank.reserve`, `households.savings` and
     every firm's `cash` are terms of totalCinder() too, and each was coerced
     for NaN and never bounded for magnitude; each took the total to 1.0003
     BILLION from an honest 298,394 in the adversarial pass. The ceiling that
     bounds all five together is `clampLoadedCinder()`, applied at the bottom of
     this function once every sub-module has loaded. Read its header before
     touching any of this.
     `charter` keeps its own tighter clamp on top: the fund can never honestly
     hold more than the bootstrap tranche or the top-up target. */
  S.treasury = Math.max(0, Number(raw.treasury) || 0);
  const fundMax = Math.max(ECON.firm.charter.seed, ECON.firm.charter.fundTarget);
  S.charter = Math.min(fundMax, Math.max(0, Number(raw.charter) || 0));
  /* An older save has no tally. Treat what it is CARRYING as already issued —
     the alternative reads a pre-charter save as having spent nothing and gives
     it the whole allowance a second time. Clamped to the cap at the top so a
     garbage tally cannot suspend payouts for the rest of the city's life: the
     audit's ceiling check exists to catch a CODE path that outruns the clamp,
     and a corrupt byte on disk is not that. */
  /* ⚠ AND CLAMPED BY THE DAY COUNT AS WELL AS BY THE LIFETIME CAP. This tally
     is one of the two terms `loadedCinderCeiling()` is built from, so an
     unbounded one is a lever on the ceiling itself: `issueCharter` can only
     ever have produced the bootstrap seed plus `maxPerDay` for each day lived,
     which is a much tighter bound than the lifetime cap for the first hundred
     days of a city and is exactly as true. */
  S.charterIssued = Math.min(ECON.firm.charter.lifetimeCap,
                             ECON.firm.charter.seed + ECON.firm.charter.maxPerDay * (S.day + 1),
                             Math.max(Number(raw.charterIssued) || 0, S.charter));
  /* 💸 THE TWO SUBTRACTION TALLIES, loaded here because `clampLoadedCinder()` §3
     subtracts both from the headroom it allows `payoutOwed` and therefore has to
     have them on the books before it runs.
     Bounded above by everything this city could ever have CREATED: the identity
     is `created = totalCinder + imports + payoutDelivered + payoutOwed` with
     every term non-negative, so neither of these can honestly exceed `created`.
     ⚠ AND THE BOUND THAT MATTERS POINTS THE OTHER WAY — AND CANNOT BE ENFORCED
       HERE. These are SUBTRACTIONS, so a forger lowers them rather than raising
       them, and the floor is zero, which is precisely the behaviour that shipped
       before they existed. Nothing on disk can prove a city really did spend
       what it says it spent, and nothing in this module survives a reload to
       remember. What the two tallies buy is that a forgery must now be rewritten
       consistently on EVERY reload instead of one edited number paying out
       forever — 81,106 🔥 over eight reloads, measured, from a single field. The
       server-authoritative version of this is the only complete answer and is
       out of scope for /src/economy; see clampLoadedCinder()'s header for the
       same caveat stated for the balances. */
  const createdMax = S.charterIssued + S.faucetLifetime;
  S.importsLifetime = Math.min(createdMax, Math.max(0, Number(raw.importsLifetime) || 0));
  S.payoutLifetime  = Math.min(createdMax, Math.max(0, Number(raw.payoutLifetime) || 0));
  /* NaN safety only at this point — the CEILING on this field is applied by
     `clampLoadedCinder()` at the bottom of this function, because it is derived
     from the headroom left under `totalCinder()` and four other files have not
     loaded their share of that total yet. See clampLoadedCinder() §3. */
  S.payoutOwed = Math.max(0, Number(raw.payoutOwed) || 0);
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
     `issueCharter(ECON.firm.charter.seed)`.
     THE PART THAT MADE IT INVISIBLE: `clampLoadedCinder()` is the LAST line of
     this function, so the 300,000 🔥 was issued AFTER the only ceiling that
     could have caught it had already run and passed. Textbook of the structural
     blind spot — money moving between the load and the first tick, where no
     audit window is open.
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
  /* 🔴 LAST, AND IT HAS TO BE LAST. The ceiling is on `totalCinder()`, whose
     five terms live in four different files; nothing before this line can see
     the whole number. See clampLoadedCinder()'s header for the measurements. */
  clampLoadedCinder();
  return true;
}

export default { advance, snapshot, bootstrap, reset, serialize, load, claimPayout, refundPayout,
                 notePayoutDelivered, audit };
