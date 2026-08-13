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
  INV: {},              // resource id → units held by the city
  /* Per-day flow readouts, for the panel and the audit. */
  flow: { wages: 0, shopping: 0, b2b: 0, rent: 0, tax: 0, benefits: 0,
          imports: 0, exports: 0, faucet: 0, payout: 0, freight: 0, interest: 0,
          civic: 0, infrastructure: 0, upkeep: 0, welfare: 0, unmetSubsistence: 0 },
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
  S.payoutAllowed = true; S.payoutOwed = 0; S.log = []; S.booted = false;
  S.outputValue = {}; S.serviceValue = {}; S.observed = {}; S.demandEMA = {};
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
function runPartial(days, host) {
  HH.beginTick();
  runProduction(days, host);
  runShopping(days);
  stepPrices(days, host);
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
  S.flow.imports += importPaid;
  for (const im of traded.imports) addInv(im.res, im.units * (traded.spend > 0 ? importPaid / traded.spend : 0));
  for (const ex of traded.exports) takeInv(ex.res, ex.units);

  /* 🚰 THE FAUCET — the ONE place Cinder enters the city, and only against real
     exported volume. Clamped hard by ECON.faucet.maxPerMin so no combination of
     trades can turn this into the Forge. */
  const capPerDay = ECON.faucet.maxPerMin * ECON.clock.dayMin * days;
  const faucet = Math.min(traded.revenue * ECON.faucet.perExportUnit, capPerDay);
  S.treasury += faucet;
  S.flow.exports += faucet;
  S.flow.faucet += faucet;
  if (traded.revenue > capPerDay) {
    logEvent('city', 'Export earnings capped this day (faucet ceiling).');
  }

  // 4. FREIGHT settles; the city pays its haulage bill.
  Logistics.resolve();
  const freightBill = Logistics.state().booked * Logistics.costPerUnit(1) * 0.1;
  const freightPaid = Math.min(S.treasury, freightBill);
  S.treasury -= freightPaid;
  S.flow.freight += freightPaid;
  /* The haulage bill is revenue for logistics firms if the city has any;
     otherwise it leaves as an import of transport services. */
  const haulers = Firms.byIndustry('distributor').concat(Firms.byIndustry('transitCo'));
  if (haulers.length) for (const f of haulers) Firms.earn(f, freightPaid / haulers.length);
  else S.flow.imports += freightPaid;

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
        S.flow.dividends = (S.flow.dividends || 0) + div;
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
  stepPrices(days, host);

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
    const income = S.flow.tax + S.flow.faucet;
    const outgoings = S.flow.benefits + S.flow.imports + S.flow.freight;
    const surplusToday = Math.max(0, income - outgoings);
    const draw = Math.min(surplusToday * ECON.tax.payoutRate,
                          ECON.tax.payoutMaxPerDay * days,
                          Math.max(0, S.treasury));
    if (draw > 0) { S.treasury -= draw; S.payoutOwed += draw; S.flow.payout += draw; }
  }

  S.day += 1;

  // 11. THE AUDIT.
  audit(before);
  return snapshot();
}

function stepPrices(days, host) {
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
      shock: host && host.shock ? host.shock : 1,
    });
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   🔍 THE AUDIT — proof that no Cinder was minted.
   ════════════════════════════════════════════════════════════════════════════ */
export function totalCinder() {
  return HH.totalSavings() + Firms.totalCash() + S.treasury + Bank.state().reserve;
}

export function audit(before) {
  const after = totalCinder();
  const delta = after - before;
  /* What SHOULD have changed the total:
       + faucet    (export earnings entering from outside)
       − imports   (Cinder leaving for goods made elsewhere)
       − payout    (withdrawn by the player, held in payoutOwed)
     Everything else is a transfer and nets to zero. */
  const expected = S.flow.faucet - S.flow.imports - S.flow.payout;
  const err = delta - expected;
  /* Tolerance scales with the size of the economy: floating-point error across
     several hundred transfers grows with the magnitudes involved, and a fixed
     epsilon would false-positive on a large city and miss a real leak on a
     small one. */
  const tol = Math.max(1, Math.abs(after) * 1e-6);
  const ok = Math.abs(err) <= tol;
  S.lastAudit = { ok, before, after, delta, expected, err, tol, day: S.day };
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
  S.payoutOwed = Math.max(0, Number(raw.payoutOwed) || 0);
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
