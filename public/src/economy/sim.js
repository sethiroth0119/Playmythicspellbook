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
          /* 🌩 What the disaster cost the city today. ALL THREE ARE READOUTS,
             not accounts: `emergency` is a slice of `imports` (the response is
             bought from outside — see step 9b), while `blocked` (export revenue
             the blockade stopped) and `spoiled` (the value of destroyed output)
             never moved Cinder at all. Which is exactly why they have to be
             visible somewhere: a disaster whose cost appears in no readout is
             how a siege stayed profitable for a whole release. */
          emergency: 0, blocked: 0, spoiled: 0,
          /* 🚚 HOW MUCH OF THE HAULAGE BILL LEFT THE CITY — a READOUT of the part
             of the day's freight that went to outside carriers because the city
             has no haulage firms of its own, and is therefore booked to
             `imports` rather than to `freight`.
             It exists because that Cinder used to be booked to BOTH, and the
             payout basis at step 9b subtracts benefits + imports + freight — so
             one payment was netted twice, and every Cinder the emergency drained
             from the treasury reduced the recorded outgoings by two. See step 4
             for the measurement. Keeping the amount visible here is what lets a
             reader check that the two buckets are now disjoint. */
          freightAsImport: 0 },
  /* The disaster multiplier the last day actually ran at, AFTER the guard and
     after the catch-up sample budget. Telemetry: a term nobody can read is a
     term nobody notices inverting. */
  lastShock: 1,
  /* 🚒 THE REPAIR BILL — emergency response the city has been invoiced for and
     has not yet been able to pay. A real liability: it is settled out of the
     treasury ahead of the player's payout, every day, until it is clear.
     `shockRecoveryLeft` / `shockSev` are the recovery window that keeps
     invoicing it: a city that was hit is still repairing days later, which is
     also exactly as long as the price premium it caused is still being paid.
     See step 9b in runDay — a same-day-only charge was measured and could not
     work.
     ⚠ `shockSev` IS THE JOB CURRENTLY IN HAND, NOT A HIGH-WATER MARK. It was
       written as `Math.max(shockSev, sev)` and latched at the worst severity the
       city had ever seen, because the only thing that cleared it — the window
       expiring — could not happen at the cadence the host actually produces
       shocks at. See resolveShock() for the measurement and the rule that
       replaced it. */
  emergencyDue: 0,
  /* 💸 WHAT THE EMERGENCY HAS ALREADY SPENT AND THE OWNER HAS NOT YET GONE
     WITHOUT — the austerity register, and the round-2 half of FIX-C2.
     Paying for the response takes Cinder out of the treasury, and EVERY other
     municipal payment in this file is settled `min(treasury, bill)`. So the
     days after a response are days the city quietly fails to pay its benefits,
     its imports and its haulage — and those are the very outgoings the payout
     basis nets off, so the shortfall comes back as SURPLUS and lands in the
     owner's pocket. Measured on rho-6/pop120/warehouse-1 over 600 days at a
     1-in-6 severity-0.30 cadence: the response was billed and paid in full at
     3,244 🔥 and it removed 6,318 🔥 of recorded outgoings, so the disaster
     manufactured about twice the surplus the charge took and the owner went
     635 → 1,024 🔥 (+61.3%). No value of `emergencyPer` fixes that — the charge
     is a share of a basis it inflates, and a share capped at `maxSurplusShare`
     1.00 can never claw back more than it created.
     So every Cinder the response spends is registered here and withheld from
     the surplus of the days that follow, until it is worked off. "The week it
     spends rebuilding is the week it is not paying its owner", made literal and
     made independent of whether the austerity happened to show up as a smaller
     benefit cheque or a cancelled convoy.
     ⚠ REJECTED: rebuilding the basis on BILLS INCURRED rather than cash paid,
       which is the same idea from the other end and was tried first. It is far
       too blunt: these cities cannot pay their benefit bill in CALM either
       (shock-probe/pop200 bills 1,399 🔥/day of benefit against 128 🔥/day of
       tax), so `income − billed` is permanently negative and the payout
       collapsed to zero in 20 of 21 probe cities. The defect is the CHANGE the
       disaster makes to what gets paid, so the register tracks the change.
     ⚠ NOT A SECOND CHARGE ON THE TREASURY. Nothing is debited here — this only
       decides how much of a later day's surplus is distributable, so Rule 1 is
       untouched and the audit never sees it. */
  emergencyOffset: 0,
  shockRecoveryLeft: 0,
  shockSev: 0,
  /* 🕓 THE SAMPLE METER, IN SIMULATED DAYS, AND IT LIVES IN `S` FOR ONE REASON:
     a per-CALL local measured the wrong thing. See advance(). */
  shockBudgetDays: 0,
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
  S.charter = 0; S.charterIssued = 0; S.estateReceived = 0;
  S.foundingDrawBudget = 0; S.foundingDrawArmed = false;
  S.payoutAllowed = true; S.payoutOwed = 0; S.log = []; S.booted = false;
  S.lastShock = 1; S.emergencyDue = 0; S.shockRecoveryLeft = 0; S.shockSev = 0;
  S.emergencyOffset = 0;
  /* Starts FULL, not empty: a fresh (or freshly loaded) city is live again and
     the next reading it takes is a real observation, not a replay. */
  S.shockBudgetDays = (ECON.shock && ECON.shock.cost) ? ECON.shock.cost.sampleDays : 0;
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
     bootstrap and everything after it together. */
  issueCharter(ECON.firm.charter.seed);

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
   🌩 THE DISASTER TERM — the guard, and the bill.
   ----------------------------------------------------------------------------
   🔴 THE GUARD IS THE LAST LINE OF DEFENCE AND IT USED TO BE `host.shock ? …`.
   That is a TRUTHINESS test on a number that is multiplied into every price in
   the city. Fed hostile values directly, `shock:'abc'` and `shock:{}` CRASHED
   the tick (string/object arithmetic downstream), while NaN, Infinity, '2',
   1e308, true, [] and -5 all sailed through silently and poisoned the market.
   node-city's `ecoShock()` does guarantee a finite number today — but the whole
   reason this guard exists is that NOTHING set host.shock before this session
   and now something does, and the host is across a bridge. A boundary that
   trusts the far side is not a boundary.

   ⚠ typeof + isFinite, NOT `Number(x) || 1`. `Number(true)` is 1 and `Number([])`
     is 0 — both would be accepted as legitimate readings rather than rejected as
     garbage, and `Math.floor('1e9')` is 1e9, which is how the same class of bug
     already reached the render path once (see node-city's `_shkNum`).
   ⚠ OUT OF RANGE RESOLVES TO 1, IT DOES NOT CLAMP. The accepted band is the one
     prices.js can actually express (ECON.price.minMul … maxMul). A value outside
     it is not a big shock, it is a bad reading — clamping would launder a
     garbage 1e308 into a maximum-severity siege, which is precisely the outcome
     the guard exists to prevent. 1 is neutral: the economy simply does not hear
     about the storm.
   ════════════════════════════════════════════════════════════════════════════ */
export function shockOf(host) {
  try {
    const v = host ? host.shock : 1;
    if (typeof v !== 'number' || !isFinite(v)) return 1;
    if (!(v >= ECON.price.minMul) || !(v <= ECON.price.maxMul)) return 1;
    return v;
  } catch (e) { return 1; }
}

/* What a shock of this size costs the city, as three shares in 0..1.
   Severity is `shock − 1`, so ALL THREE ARE EXACTLY ZERO AT SHOCK 1 — a calm
   city runs the identical code path it ran before disasters existed. See the
   long note on ECON.shock for why the premium alone made a siege profitable. */
function shockCost(shock) {
  const C = (ECON.shock && ECON.shock.cost) || null;
  const sev = C ? Math.max(0, Math.min(C.maxSeverity, shock - 1)) : 0;
  if (!(sev > 0)) return { sev: 0, outputLoss: 0, exportBlock: 0 };
  const cap = x => Math.max(0, Math.min(C.maxLoss, x));
  return {
    sev,
    outputLoss:  cap(sev * C.outputLossPer),
    exportBlock: cap(sev * C.exportBlockPer),
    /* The third cost — the emergency response — is NOT here: it is not a share
       of a physical stock but of the city's MUNICIPAL SURPLUS, and it is billed
       across a recovery window rather than on the day. It was a share of
       RECEIPTS until FIX-C2 measured a city that was billed 12,844 🔥 for it and
       still ended richer for the disaster. See runDay step 9b. */
  };
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

  /* 🌩 THE SHOCK IS SAMPLED ONCE, HERE, AND IT IS SPENT LIKE A BUDGET.
     `host` is one object describing ONE instant, but the caller can run many
     economic days out of it. Replaying that instant is the frozen-premium bug:
     weather resets to clear on load, but `game.raid.timer` is serialised and
     the offline sweep does not run raidTick, so a save written inside the raid
     window ran the entire catch-up at a fixed siege premium — a disaster that
     lasted precisely as long as the player was asleep. The sample can only
     honestly cover ECON.shock.cost.sampleDays; after that the city runs calm.

     🔴 THE BUDGET IS METERED AGAINST ELAPSED SIMULATED TIME AND IT LIVES IN `S`.
        It used to be a `let` inside this function, refilled on every entry, and
        that bounded THE WRONG THING: it bounds one CALL, and the host does not
        make the call this function imagined. `offlineCatchUp()` sweeps the
        absence in OFFLINE_SLICE_SEC (10 s) slices — ~12,960 separate advance()
        calls for the 36 h cap — so the per-call meter was re-issued 12,960
        times and every slice re-sampled the same frozen host. Measured on the
        shipped path: a 36 h sweep at a held 1.6 ran 107 economic days and
        ENDED at lastShock 1.6, with resolveShock() re-arming the recovery
        window on every one of those slices so the emergency bill never stopped.
        The one-call shape the old test used passed at lastShock 1, which is
        why nothing reported it. Counting `days` — the call's own elapsed
        simulated time — makes 12,960 ten-second slices cost exactly what one
        36-hour call costs, which is the only property that can hold for a call
        shape this function does not get to choose.

     ⚠ REFILLED BY CALM, NOT BY TIME. sim.js cannot tell a fresh reading that
       happens to repeat from a replay of a stale one — the value is identical.
       What it can see is the sky clearing, so a neutral reading restores the
       meter. That costs the live path nothing: the raid ramp is 18 real minutes
       and the longest weather row averages ~5, both under one 20-minute
       economic day, so a live disaster ends and refills long before it is
       capped. A contrived back-to-back raid-plus-storm would lose the tail past
       sampleDays — the bound is stated, it is small, and it errs toward calm,
       which since FIX-C is the direction that does NOT quietly bill the player.
     ⚠ NOT SERIALISED — see serialize(). */
  const sampled = shockOf(host);
  const budgetMax = (ECON.shock && ECON.shock.cost) ? ECON.shock.cost.sampleDays : 0;
  if (!(sampled > 1)) S.shockBudgetDays = budgetMax;
  /* Clamped on the way in as well: `sampleDays` is a tuning number and S is
     reachable from a load, and a meter that is somehow larger than the tuning
     allows is exactly the unbounded budget this block exists to remove. */
  S.shockBudgetDays = Math.max(0, Math.min(budgetMax, Number(S.shockBudgetDays) || 0));
  /* How much of THIS call the sample is entitled to cover. Taken before the
     loop, so a single long call is bounded exactly as it was before. */
  let covered = Math.min(days, S.shockBudgetDays);
  if (sampled > 1) S.shockBudgetDays = Math.max(0, S.shockBudgetDays - days);
  const nextShock = (d) => {
    if (!(sampled > 1) || !(covered > 0)) return 1;
    covered -= (d > 0 ? d : 0);
    return sampled;
  };

  let ran = null;
  let guard = 0;
  while (S.dayFrac >= 1 && guard++ < ECON.clock.maxCatchUpDays + 1) {
    S.dayFrac -= 1;
    ran = runDay(1, host || {}, nextShock(1));
  }
  /* Sub-day remainder still runs the CONTINUOUS half (production, shopping) so
     a short session is not economically dead — but the DISCRETE half (payroll
     close, tax, the distress ladder, levels) only happens on a whole day. */
  if (!ran && S.dayFrac > 0) ran = runPartial(S.dayFrac, host || {}, nextShock(S.dayFrac));
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
function runProduction(days, host, shock) {
  const dmg = shockCost(shock === undefined ? shockOf(host) : shock);
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
    /* 💥 THE DISASTER DESTROYS OUTPUT.
       Applied AFTER the inputs were consumed and while the wages stay paid,
       because that is the difference between a loss and a pause — a firm that
       simply made less would be no worse off per unit and the crisis would
       never reach its balance sheet. This is also what EARNS the premium the
       same shock puts on prices: less of the good exists, so scarcity is real
       rather than a number the market was told to believe. */
    if (dmg.outputLoss > 0 && units > 0) {
      const lost = units * dmg.outputLoss;
      f.inventory = Math.max(0, f.inventory - lost);   // it was banked by produce()
      units -= lost;
      S.flow.spoiled += lost * Prices.priceOf(f.out);
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
      else S.flow.imports += paid;      // bought in from outside
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
      S.flow.imports += value;
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
    S.flow.imports += paid;
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
function runPartial(days, host, shock) {
  const sh = resolveShock(host, shock);
  HH.beginTick();
  runProduction(days, host, sh);
  runShopping(days);
  stepPrices(days, sh);
  return snapshot();
}

/* The shock a step runs at: the one `advance()` metered out, or — for a direct
   call from a test or a future caller — freshly guarded from the host. Never
   the raw `host.shock`: that is the truthiness hole this session closed.

   🔴 THE RECOVERY WINDOW IS ARMED HERE, NOT IN runDay, AND THAT IS A HOLE THIS
   CLOSED RATHER THAN A TIDY-UP. `stepPrices` runs in runPartial as well as in
   runDay, so a shock the host samples during SUB-DAY ticks moves prices with
   full effect — but the tax close, the payout and the repair bill only exist on
   a whole day. A raid ramp is 18 real minutes against a 20-minute economic day,
   so that is not an edge case, it is the NORMAL way a raid is seen. Arming the
   window wherever the shock is actually observed means the next whole day bills
   for it; billing only what runDay happens to witness would have left the
   commonest disaster in the game free again.

   🔴 AND IT USED TO RATCHET. THIS IS THE DEFECT THIS BLOCK NOW EXISTS TO PREVENT.
   The two lines were `S.shockSev = Math.max(S.shockSev, sev)` and an
   unconditional `S.shockRecoveryLeft = recoveryDays`, and `shockSev` was cleared
   in ONE place: runDay step 9b, when the window fully expired. So the level
   latched at the worst severity the city had EVER seen and the window was
   re-armed to its full length by every later touch, however trivial — and
   because `recoveryDays` (4 economic days = 80 real minutes) is LONGER than the
   gap between shock-producing events, the window could not reach 0 to clear it.
   Measured on the pre-fix tree: one tornado-grade 1.33 on day 0, then nothing
   but 1.148 snow every third day, and `shockSev` read 0.330 on every one of the
   next fifteen days — a drizzle invoiced at 2.2× its true severity, for ever.
   The arithmetic needs no weather model to be the normal case: RAID_INTERVAL
   7200 s is six economic days against a 4-day window, so raids ALONE hold it
   open 4 days in 6, and node-city's weather roll (WX_ROLL_EVERY 150 s, 0.062
   non-rain probability per roll → a ~40-minute mean gap, comfortably inside the
   80-minute window) closes what is left. Under the combined signal the window
   was open on 99.6% of days in the probe.
   Round 0i never saw it because its raid signal fires every SIXTH day with five
   clean calm days between — the one cadence in which the window does close and
   the level does reset. Section 5 of that round now drives weather AND raids.

   🔑 THE RULE THAT REPLACES THE MAX: the window drains linearly, so the share of
      the last repair still OUTSTANDING is `shockRecoveryLeft / recoveryDays`. A
      new event either is at least as big as what is still outstanding — in which
      case it is now the job the city is doing, and it OWNS the window at its own
      severity — or it is smaller, in which case it adds nothing measurable to a
      rebuild already under way and must NOT extend it. Either way the level
      tracks the CURRENT disaster and decays with the window instead of latching.
   ⚠ REJECTED: decaying the billed severity across the window (`sev × left/rd`
     every day). It reads well but it silently halves the total charge of a
     single pulse, and `emergencyPer` 1.10 was measured against the flat window
     to just beat the tax uplift the premium creates. Changing the counterweight
     by a factor of two as a side effect of a ratchet fix is how the mechanic
     inverts again. The flat window is preserved exactly; only the LEVEL changes.
   ⚠ A milder event during a bigger rebuild is still billed at the bigger rate,
     and that is intended: one day after a tornado the city is repairing a
     tornado. What it may not do is RESTART the tornado's clock. */
function resolveShock(host, shock) {
  const sh = (shock === undefined) ? shockOf(host) : shockOf({ shock });
  S.lastShock = sh;
  const sev = shockCost(sh).sev;
  if (sev > 0) {
    if (!(S.shockRecoveryLeft > 0)) {
      logEvent('bad', '🚒 Disaster response — the city is repairing, and buying in ' +
                      'emergency supplies and outside crews.');
    }
    const rd = Math.max(1e-9, ECON.shock.cost.recoveryDays);
    /* How much of the last disaster's repair the city has still to do. Zero once
       the window has drained, which is what lets a drizzle take over cleanly. */
    const outstanding = S.shockSev * Math.max(0, Math.min(1, S.shockRecoveryLeft / rd));
    if (sev >= outstanding) {
      S.shockSev = sev;                                   // this is the job now
      S.shockRecoveryLeft = ECON.shock.cost.recoveryDays;
    }
    /* else: smaller than the rebuild already running. Bill the rebuild, at the
       rebuild's rate, on the rebuild's own clock. Nothing is extended. */
  }
  return sh;
}

/* ════════════════════════════════════════════════════════════════════════════
   📅 A WHOLE ECONOMIC DAY
   ════════════════════════════════════════════════════════════════════════════ */
function runDay(days, host, shock) {
  const before = totalCinder();
  const sh = resolveShock(host, shock);
  const dmg = shockCost(sh);
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
  runProduction(days, host, sh);
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
  S.flow.imports += importPaid;
  for (const im of traded.imports) addInv(im.res, im.units * (traded.spend > 0 ? importPaid / traded.spend : 0));
  /* 🚧 THE BLOCKADE. A blocked contract does not ship AND is not paid, so the
     goods stay in the warehouse rather than evaporating — a siege stops the
     convoy, it does not confiscate the cargo. Keeping the stock also feeds the
     ordinary supply term next day, which is what stops the premium and the
     scarcity it causes from bootstrapping each other upward. */
  /* 🔴 …EXCEPT THAT "THE CARGO GOES BACK IN THE WAREHOUSE" IS A SUBSIDY IN ANY
     CITY WHOSE EXPORTS EARN NOTHING, AND SOME DO. Measured on rho-6/pop120/wh1
     over 600 days: that city ships real volume for zero faucet revenue (its
     partners take the goods and the export earns 0 🔥), so shipping is a pure
     inventory loss and BLOCKING it is a pure gain. With `exportBlockPer` at 0.80
     a ×1.12 pulse every 30 days left the owner +17.3%; with the blockade switched
     off entirely the same signal left him −31.3%. The blockade was the single
     biggest thing making a disaster profitable there, which is the opposite of
     the job it was put in to do — and it survives `emergencyPer` = 0, so it is
     not the charge and not the basis.
     So a blocked contract now LOSES `blockedCargoLostPer` of its cargo, and at
     the shipped 1.00 that makes the blockade cost REVENUE AND NOTHING ELSE:
     `shipped + lost` is 1, the goods leave the warehouse either way, and what the
     siege takes is the payment for them. The cargo was seized at the roadblock.
     ⚠ INTERMEDIATE VALUES DO NOT WORK AND THE REASON IS WORTH KNOWING: at 0.50 a
       severity-0.30 blockade still hands 12% of the cargo back, and the gate is
       as red as it is at 0.00 (10 richer cells at +10.88% against 9 at +10.93%).
       What returned stock buys a marginal city is a different set of surviving
       firms, not a proportional amount of inventory, so the fault is a threshold
       and not a slope.
     ⚠ WHAT THIS GIVES UP is in the note on ECON.shock.cost.blockedCargoLostPer:
       the returned stock used to feed the ordinary supply term and damp the
       premium. Nothing damps it now except the price clamp, which round 0i §1
       asserts holds under every hostile multiplier. */
  const shipped = 1 - dmg.exportBlock;
  const lost = dmg.exportBlock * ECON.shock.cost.blockedCargoLostPer;
  for (const ex of traded.exports) takeInv(ex.res, ex.units * (shipped + lost));

  /* 🚰 THE FAUCET — the ONE place Cinder enters the city, and only against real
     exported volume. Clamped hard by ECON.faucet.maxPerMin so no combination of
     trades can turn this into the Forge.
     ⚠ The blockade is applied to the REVENUE BEFORE the ceiling, not after: it
       is fewer contracts, not a discount on the cap, and applying it after
       would leave a big city's exports untouched whenever the cap was binding
       — i.e. exactly the cities a blockade should hurt most. */
  const capPerDay = ECON.faucet.maxPerMin * ECON.clock.dayMin * days;
  const earned = traded.revenue * shipped;
  const faucet = Math.min(earned * ECON.faucet.perExportUnit, capPerDay);
  S.treasury += faucet;
  S.flow.exports += faucet;
  S.flow.faucet += faucet;
  S.flow.blocked += Math.max(0, (traded.revenue - earned) * ECON.faucet.perExportUnit);
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
  else { S.flow.imports += freightPaid; S.flow.freightAsImport += freightPaid; }

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
  stepPrices(days, sh);

  /* 9b. 🚒 THE EMERGENCY RESPONSE — what the disaster costs the city, and the
     term that actually decides whether a crisis is a crisis.
     ----------------------------------------------------------------------
     🔴 THE OWNER IS PAID AFTER THE CITY'S OBLIGATIONS, WHICH IS WHY THIS SITS
     HERE, one step above the drain. Two earlier placements were built and
     measured and both were dead letters:
       · step 5b, after banking, reserved against the benefit bill like
         municipal spending — executed ZERO times in 300 days. By then the day's
         receipts had gone into the bank capitalisation, and `treasury − benefit
         reserve` is negative in any city carrying unemployment.
       · step 2b, immediately after shopping — took 2 🔥/day of a wanted 24 🔥.
         Subsistence welfare drains the treasury to nothing during shopping
         (10,909 🔥 of welfare and 143,000 🔥 of UNMET subsistence over the same
         300 days); the corporate tax that refills it does not land until the
         books close at step 7.
     A response the city cannot pay for is not a cost. So the bill is settled
     out of what the city actually holds once the day is done — before its owner
     takes a distribution, never after.

     🔴 IT IS A LIABILITY THAT OUTLIVES THE DISASTER, AND THAT IS THE POINT.
     A one-day charge could not work and the measurement says why: the PREMIUM
     outlives the disaster too. Prices lerp back at `ECON.price.lerpPerDay` and
     a destroyed stock is restocked over the following week, so a single pulse
     at 1.3 cost the owner 3.80 🔥 on the day and then paid him back +4.42,
     +6.66, +6.91, +6.41 … over the days after — net POSITIVE from one bad
     afternoon. Worse, in a city whose payout is limited by its balance rather
     than by its surplus (a small city runs at 0.24 🔥/day), there is nothing in
     the treasury to charge ON the day at all, so a same-day-only bill is
     unpayable exactly where the tail is most profitable: +76% at a realistic
     cadence, with every cost term switched on.
     So the damage ACCRUES as `emergencyDue` and is paid down out of every
     subsequent day's SURPLUS until it is cleared. A city rebuilds for a week
     after a siege; the week it spends rebuilding is the week it is not paying
     its owner. Capped at `dueCapDays` days of the payout allowance so a
     permanent shock cannot compound an infinite debt onto a city that already
     cannot pay.

     🔴 AND THIS IS WHY DESTROYED OUTPUT ALONE COULD NOT FIX THE INVERSION.
     Measured: with the blockade and the output loss in and this term absent, a
     permanent 1.6 shock left the player RICHER STILL (claimed 5,762 → 6,032)
     and the realistic cadence got WORSE, not better (+2.6% → +8.0%). Scarcity
     raises prices, spending on inelastic staples is price × quantity, so the
     sales-tax base GREW — 114,769 🔥 of shopping calm against 120,729 🔥 under
     permanent shock. Any mechanism acting only on supply feeds the very term
     that inverted the mechanic. The counterweight has to be a real claim on the
     treasury, and larger than the tax uplift the premium creates (~0.19 ×
     severity × receipts, measured).

     🔴 THE RESPONSE IS BOUGHT FROM OUTSIDE, AND IT HAS TO BE — this was written
     the other way first and the measurement is unambiguous. Paying emergency
     crews as local wages (`HH.payWages`) keeps the Cinder inside the loop, and
     inside the loop it is a STIMULUS: households receive it, spend it, and the
     sales-tax base grows. In a poor city that dominates — a nearly broke test
     city paying 73 🔥 over 300 days went to +2,150% under a permanent 1.3 shock,
     i.e. the disaster relief was worth more to the owner than the disaster cost
     him. Field medicine, water bowsers, munitions and outside engineers are
     IMPORTS: they are consumed by the emergency, they are made somewhere else,
     and the Cinder genuinely leaves the city. So this books through
     `flow.imports`, the outflow the audit identity already subtracts (Rule 1 is
     "never minted", and a recorded debit is exactly what it asks for) and which
     the drain below already counts as an outgoing.
     ⚠ NO GOODS ARRIVE IN `INV`, deliberately: what was bought was the response
       itself, and it is spent in the act of responding. Modelling it as stock
       would hand the city a warehouse of free supplies every time it was hit.
     ⚠ NO BENEFIT RESERVE, unlike municipal spending, and it needs none — but
       NOT for the reason first written here. The old note said the ask was
       "a share of the day's RECEIPTS … paid only out of what the treasury
       actually holds", and that is exactly the shape that failed: competing with
       the benefit bill for the same balance meant the response was funded BY
       skipping welfare, and welfare is an outgoing the payout already nets off.
       The ask is now a share of what is left AFTER benefits — it cannot crowd
       them out because it is charged behind them. */
  /* 🔴 THE BASIS IS THE DAY'S MUNICIPAL SURPLUS, NOT ITS RECEIPTS, AND THAT IS
     THE WHOLE OF FIX-C2. READ THIS BEFORE MOVING IT BACK.
     The first version of this term billed `flow.tax × severity × emergencyPer`
     and paid it out of the treasury here, one step above the drain. Three
     hardcoded probe cities said it worked. Swept across the population axis it
     inverts, and the reference cell is rho-6 / warehouse 1 / population 120 over
     1,200 days under the shipped raid cadence.
     ⚠ THE NUMBERS BELOW WERE RE-MEASURED ON THIS TREE and an earlier draft's
       were not: that draft quoted a 2,868 🔥 calm baseline for this cell, which
       is not what this cell pays — the freight double-booking fix at step 4
       moved every calm baseline in the model, so any figure taken before it is
       unreconcilable with anything a reader can run today. Re-derive, do not
       copy forward. The recipe is in run.mjs's ECON_TEST_SABOTAGE notes, shape
       (b); this same cell measured through it prints:

         RECEIPTS BASIS      claimed  5,041 🔥 calm →  8,794 🔥 raided  (+74.4%)
                             receipts  123,257 → 99,301   (−23,956)
                             outgoings 107,509 → 78,804   (−28,705)
                               of which benefits          (−28,201)
                             response billed AND PAID IN FULL: 13,937 🔥

     i.e. the counterweight was charged in full and the player still came out
     4,749 🔥 of surplus AHEAD of peace. WHY: the response was funded from THE
     SAME TREASURY BALANCE THE BENEFIT BILL IS FUNDED FROM, and step 6 pays
     welfare with `min(treasury, bill)`. So every Cinder of repairs bought was a
     Cinder of welfare the city then could not pay, and BENEFITS ARE AN OUTGOING
     IN THE PAYOUT FORMULA BELOW. The bill bought itself back out of another
     outgoing: receipts fell 23,956 🔥 but outgoings fell 28,705 🔥, so the
     disaster MANUFACTURED surplus to hand the owner. A charge on receipts can be
     crowded out; a charge on what is LEFT after every other municipal claim
     cannot be, because by then there is nothing left to crowd.

         THIS ARRANGEMENT      claimed  5,041 🔥 calm →  3,272 🔥 raided (−35.1%)
                               receipts  123,257 → 122,089  (−1,168)
                               outgoings 107,509 → 108,858  (+1,349)
                                 of which benefits            (−836)
                               response billed AND PAID: 3,011 🔥

     Read the outgoings row: it is the whole fix in one line. Under the old basis
     the disaster made the city's other obligations go AWAY (−28,705); here they
     go UP (+1,349), because the response is charged behind them instead of
     competing with them, and welfare is left almost untouched (−836 against
     −28,201). The sign of the mechanic stops depending on how much welfare a
     city of that size happened to owe — which is exactly why it used to depend
     on population.

     So the response is now taken from the surplus itself, after benefits,
     imports and freight, and ahead of the owner — the ordinary rule that
     creditors are paid before a distribution. It bears on exactly the quantity
     the disaster's gain arrives in, per day, which is what makes the sign of
     the mechanic independent of city size instead of accidental in it.
     ⚠ It is still bought from OUTSIDE (flow.imports) for the reason the old note
       below gives: paid as local wages it is a stimulus, and the stimulus was
       worth more to the owner than the disaster cost him.
     ⚠ REJECTED: "just tax the payout". Same arithmetic, no model — see the note
       on ECON.shock. This spends the city's spare cash on the emergency, and
       the smaller payout is the consequence of the spending, not a penalty. */
  const income = S.flow.tax + S.flow.faucet;
  /* 🚒 The response is NOT yet in `imports` — it is charged below, out of what
     this line leaves — so it is counted exactly once, and `flow.emergency` is a
     readout rather than a second account.
     🚚 `benefits + imports + freight` IS NOW A SUM OF DISJOINT BUCKETS, and it
     was not before: the haulage bill of a city with no carriers of its own was
     booked to `freight` AND to `imports`, so this line subtracted one payment
     twice. Fixed at step 4, not here — gauntlet2 §9 restates this same identity
     and the two files have to agree on it. */
  const outgoings = S.flow.benefits + S.flow.imports + S.flow.freight;
  let surplusToday = Math.max(0, income - outgoings);
  /* 🔴 THE RECOVERY WINDOW, AND WHY THE BILL CANNOT BE A SINGLE DAY'S CHARGE.
     `stepPrices` runs at step 9 — AFTER shopping. So a shock raises prices at
     the END of the day it happens on, and the higher prices are not PAID until
     the day after: the whole tax uplift, and every Cinder of the payout it
     creates, lands on days the disaster is already over. Measured in a small
     city, day by day: the shock day itself paid the owner 0.00 🔥 and the
     following day paid 4.07 🔥 where calm paid nothing at all. A charge levied
     on the shock day was therefore aimed at the one day in the sequence with
     nothing to take, which is why the first version of this still left the
     player up 76% at a realistic cadence.
     The city is in RECOVERY for `recoveryDays` after it is hit, and a share of
     every one of those days' SURPLUS goes to the repairs. That makes the cost
     scale with the exact quantity the payout is a share of, on the same days the
     premium's gain arrives, instead of hoping one day's take covers a week of
     elevated prices and restocking. */
  /* The window itself was armed by resolveShock — including on the sub-day
     ticks this function never sees. See the note there. */
  if (S.shockRecoveryLeft > 0 && S.shockSev > 0) {
    /* The share of the day's surplus the repairs take. Clamped by `maxLoss` for
       the same reason every other cost term is: a disaster must leave something
       to trade through, and at severity 0.60 an unclamped share would be the
       whole surplus and then some. */
    const share = Math.max(0, Math.min(ECON.shock.cost.maxSurplusShare,
                                       S.shockSev * ECON.shock.cost.emergencyPer));
    const billed = surplusToday * share;
    S.shockRecoveryLeft = Math.max(0, S.shockRecoveryLeft - Math.max(0, days));
    if (S.shockRecoveryLeft <= 0) S.shockSev = 0;
    if (billed > 0) {
      /* ⚠ THE CEILING IS APPLIED HERE, WHERE THE DEBT GROWS, AND NOWHERE ELSE.
         Written as a clamp evaluated every day it silently WIPED the balance:
         the basis is 0 on a day the city runs no surplus, so the cap became 0
         and a bad week paid off the whole repair bill by having no economy. A
         bill is only ever bounded against the surplus that raised it.
         ⚠ The ceiling is in DAYS OF PAYOUT ALLOWANCE, not days of the basis:
           `dueCapDays × payoutMaxPerDay` is the same yardstick deserialize()
           already clamps a loaded balance against, and unlike the basis it does
           not collapse to nothing on a bad day. */
      const cap = ECON.shock.cost.dueCapDays * ECON.tax.payoutMaxPerDay;
      S.emergencyDue = Math.min(S.emergencyDue + billed, Math.max(billed, cap));
    }
  }
  /* Settled out of the surplus, ahead of the owner. Bounded by the treasury as
     well because it is real Cinder leaving a real balance (Rule 1: debit exactly
     what you credit) — what the city cannot pay for today stays owed and claims
     the surplus of the days after, which is what "the week it spends rebuilding
     is the week it is not paying its owner" means in code. */
  if (S.emergencyDue > 0 && surplusToday > 0) {
    const paid = Math.max(0, Math.min(S.emergencyDue, surplusToday, S.treasury));
    if (paid > 0) {
      S.treasury -= paid;
      S.flow.imports += paid;      // it left the city — see the note above
      S.flow.emergency += paid;
      S.emergencyDue -= paid;
      surplusToday -= paid;
      /* 💸 …and the same Cinder is registered as austerity to come. See the note
         on `S.emergencyOffset`: the treasury this just emptied is the treasury
         tomorrow's benefits, imports and haulage are settled against, so without
         this the payment buys itself straight back out of the outgoings it
         suppresses. Registered at the moment the cash leaves, so the register is
         exactly the size of the disturbance it has to cancel. */
      S.emergencyOffset += paid * ECON.shock.cost.austerityMul;
    }
  }
  /* 💸 THE AUSTERITY REGISTER DRAINS AGAINST THE SURPLUS OF THE DAYS AFTER, and
     it stands ahead of the owner for the same reason the bill itself does.
     ⚠ IT IS BOUNDED BY THE REGISTER AND THE SURPLUS AND NOTHING ELSE — no
       treasury bound, deliberately, because nothing is being paid. Bounding a
       book entry by the balance would make the correction vanish in exactly the
       cash-starved cities that need it, which is the shape of the bug it fixes.
     ⚠ MONOTONE IN SEVERITY BY CONSTRUCTION, which is the property round 0i §3
       now asserts: a worse disaster bills more, so it registers more, so strictly
       more of the following days' surplus is withheld. The old arrangement was
       not monotone at all — at rho-6/pop120 a ×1.30 1-in-6 cadence paid the owner
       MORE than a ×1.12 one at the same cadence, because the bigger bill bought
       more of the austerity that manufactured the surplus. */
  if (S.emergencyOffset > 0 && surplusToday > 0) {
    const absorbed = Math.min(S.emergencyOffset, surplusToday);
    S.emergencyOffset -= absorbed;
    surplusToday -= absorbed;
  }

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
    /* 🚒 `surplusToday` was computed at step 9b and the repairs have ALREADY
       been taken out of it there — deliberately, because that ordering is the
       fix: the response is charged against what is left after every other
       municipal claim, so it cannot be funded by crowding one of them out. It
       is counted exactly once (the payment also went into `flow.imports`, but
       this variable was reduced by the payment rather than recomputed from the
       flows, so the two cannot double-charge). */
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

function stepPrices(days, shock) {
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
      /* 🌩 ALREADY GUARDED — see shockOf(). This used to read
         `host && host.shock ? host.shock : 1`, a truthiness test on a number
         that multiplies every price in the city: 'abc' and {} crashed the tick
         outright and NaN/Infinity/true/[]/-5/1e308 poisoned the market in
         silence. The value arriving here is now always a finite number inside
         the price clamp's own band. */
      shock: shock,
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
    /* 🌩 The multiplier the last step actually ran at — after the guard and
       after the catch-up sample budget, so it is what happened rather than what
       the host asked for. Deliberately NOT serialised: a disaster is a live
       reading of the city's weather and raid state, and a save carrying one
       would hand the loaded city a storm that is no longer there. */
    shock: S.lastShock,
    emergencyDue: S.emergencyDue,
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
    /* 🚒 THE REPAIR BILL RIDES THE SAVE. A liability that does not is a bill
       the reload button pays for you — the same reasoning prices.js already
       gives for not resetting prices on load ("a player could dodge every shock
       by reloading"). Clamped on the way back in, like every other number that
       arrives from disk. */
    emergencyDue: Math.round(S.emergencyDue * 100) / 100,
    /* 💸 …and so does the austerity register, for exactly the same reason: it is
       an outstanding claim on future surplus, and a claim that does not ride the
       save is a claim the reload button settles for you. Clamped against the same
       yardstick as `emergencyDue` on the way back in. */
    emergencyOffset: Math.round(S.emergencyOffset * 100) / 100,
    shockRecoveryLeft: Math.round(S.shockRecoveryLeft * 1000) / 1000,
    shockSev: Math.round(S.shockSev * 1000) / 1000,
    /* ⚠ `shockBudgetDays` is DELIBERATELY ABSENT, and it is the one shock field
       that is. It is not a balance and not a liability — it is a meter that
       distinguishes a live reading from a replayed one, and a reload ends the
       replay by definition: the tab is open, the sky is being rolled again and
       the raid timer is being ticked again. reset() therefore refills it.
       The usual objection to a field that resets on load is "the reload button
       pays the bill for you" (see emergencyDue, which is why THAT one rides the
       save). It does not apply here and the incentive runs the other way: since
       FIX-C a shock only ever costs the player, so a refilled meter can only
       expose them to MORE of one. There is no reload exploit to close, and the
       liability the shock created — emergencyDue / shockRecoveryLeft /
       shockSev — is persisted right above and survives regardless. */
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
  S.day = Math.max(0, raw.day | 0);
  S.dayFrac = Math.max(0, Math.min(1, Number(raw.dayFrac) || 0));
  S.treasury = Math.max(0, Number(raw.treasury) || 0);
  /* 🔴 THE SAVE FILE IS NOT ALLOWED TO MINT EITHER, and this is the one field
     where it could: `charter` is a term of totalCinder(), so a blob claiming a
     fund of 10⁹ would hand the city a fortune on load. Clamp it to the largest
     balance the fund can honestly hold (the bootstrap tranche, or the top-up
     target if that is somehow larger) — the same reasoning gauntlet1's corrupt-
     save round applies to every other number that arrives from disk. */
  const fundMax = Math.max(ECON.firm.charter.seed, ECON.firm.charter.fundTarget);
  S.charter = Math.min(fundMax, Math.max(0, Number(raw.charter) || 0));
  /* An older save has no tally. Treat what it is CARRYING as already issued —
     the alternative reads a pre-charter save as having spent nothing and gives
     it the whole allowance a second time. Clamped to the cap at the top so a
     garbage tally cannot suspend payouts for the rest of the city's life: the
     audit's ceiling check exists to catch a CODE path that outruns the clamp,
     and a corrupt byte on disk is not that. */
  S.charterIssued = Math.min(ECON.firm.charter.lifetimeCap,
                             Math.max(Number(raw.charterIssued) || 0, S.charter));
  S.payoutOwed = Math.max(0, Number(raw.payoutOwed) || 0);
  /* 🚒 The outstanding repair bill. Absent in any save older than this feature,
     which reads correctly as "no disaster is outstanding". Clamped like every
     other number from disk — a garbage liability would suppress the payout for
     the life of the city, which is the same class of harm as a garbage charter
     tally and gets the same treatment. */
  S.emergencyDue = Math.min(ECON.shock.cost.dueCapDays * ECON.tax.payoutMaxPerDay,
                            Math.max(0, Number(raw.emergencyDue) || 0));
  /* 💸 The austerity register — same clamp, same reasoning. It can only ever have
     been raised by cash that actually left the treasury, so `dueCapDays` days of
     the payout allowance bounds it just as it bounds the bill that raised it. */
  S.emergencyOffset = Math.min(ECON.shock.cost.dueCapDays * ECON.tax.payoutMaxPerDay,
                               Math.max(0, Number(raw.emergencyOffset) || 0));
  S.shockRecoveryLeft = Math.min(ECON.shock.cost.recoveryDays,
                                 Math.max(0, Number(raw.shockRecoveryLeft) || 0));
  S.shockSev = Math.min(ECON.shock.cost.maxSeverity, Math.max(0, Number(raw.shockSev) || 0));
  S.payoutAllowed = raw.payoutAllowed !== false;
  S.booted = !!raw.booted;
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

export default { advance, snapshot, bootstrap, reset, serialize, load, claimPayout, audit };
