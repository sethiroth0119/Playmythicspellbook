/* ════════════════════════════════════════════════════════════════════════════
   🏭 FIRMS — a business is a balance sheet, not a tile that prints goods.
   ----------------------------------------------------------------------------
   "Companies have expenses... If they can't generate enough Cinder to cover
    those costs, they can struggle. Reduced Production → Layoffs → Debt →
    Default → Bankruptcy"

   Every firm holds CASH. Every tick it pays wages, buys inputs, pays for power
   and water and freight and maintenance and tax — out of that cash — and is
   paid by its customers into that cash. Nothing is free and nothing is implied.

   🔴 A FIRM CANNOT SPEND CASH IT DOES NOT HAVE. Every debit goes through
   `pay()`, which returns what it could actually afford. That one rule is what
   turns "businesses can fail" from a feature into a consequence: a firm short
   on cash underpays its workers, who then have less to spend, which is the
   recession loop the announcement describes — and it falls out of the
   accounting rather than being scripted.

   ── WHY FIRMS ARE NOT TILES ────────────────────────────────────────────────
   node-city already has tiles with `gen`/`use` rates, and they keep working
   exactly as they do — this module does not touch them. A FIRM is the business
   ENTITY that may operate one or more production steps. The distinction earns
   its keep the moment a business has a balance sheet: a tile cannot go bankrupt
   because a tile has no cash, and giving every tile a balance sheet would mean
   a player's road network could default.
   ════════════════════════════════════════════════════════════════════════════ */

import { ECON } from './tuning.js';
import { INDUSTRIES, DEPOSITS, RECIPES, legsOf, bandOf, industryOf } from './recipes.js';
import { basePrice, priceOf, bestLeg } from './prices.js';
import * as HH from './households.js';

/* ── THE DISTRESS LADDER ────────────────────────────────────────────────────
   Ordered worst-last. A firm's `rung` indexes this. */
export const RUNGS = ['HEALTHY', 'REDUCED', 'LAYOFFS', 'DEBT', 'DEFAULT', 'BANKRUPT'];
export const RUNG_META = {
  HEALTHY:  { label: 'Healthy',   ico: '🟢', color: '#9ad17a' },
  REDUCED:  { label: 'Reduced',   ico: '🟡', color: '#e0c060' },
  LAYOFFS:  { label: 'Layoffs',   ico: '🟠', color: '#e0a060' },
  DEBT:     { label: 'In Debt',   ico: '🔵', color: '#7fb8ff' },
  DEFAULT:  { label: 'Default',   ico: '🔴', color: '#e0556a' },
  BANKRUPT: { label: 'Bankrupt',  ico: '⚫', color: '#8a8578' },
};

let FIRMS = [];
let NEXT_ID = 1;

export function all() { return FIRMS.slice(); }
export function alive() { return FIRMS.filter(f => f.rung !== 'BANKRUPT'); }
export function byId(id) { return FIRMS.find(f => f.id === id) || null; }
export function byOutput(resId) { return FIRMS.filter(f => f.out === resId && f.rung !== 'BANKRUPT'); }
export function byIndustry(ind) { return FIRMS.filter(f => f.ind === ind && f.rung !== 'BANKRUPT'); }
export function count() { return alive().length; }
export function reset() { FIRMS = []; NEXT_ID = 1; }

/* ── FOUNDING ───────────────────────────────────────────────────────────────
   `out` is the resource this firm produces (or, for retail/service, the
   category it sells into). `capacity` is units per economic day at level 1. */
export function found(out, opts) {
  opts = opts || {};
  const ind = opts.ind || industryOf(out) || 'distributor';
  const meta = INDUSTRIES[ind] || INDUSTRIES.distributor;
  const cap = Math.max(1, opts.capacity || defaultCapacity(out));
  const f = {
    id: NEXT_ID++,
    out, ind, kind: meta.kind,
    name: opts.name || (meta.name),
    level: 1,
    capacity: cap,
    /* 💰 SEED CASH = a fixed number of DAYS OF OPERATING COST, not a flat
       number. A Semiconductor Fab and a bakery cannot start with the same
       buffer or one of them is bankrupt on day two purely because of scale. */
    cash: 0,
    debt: 0, loanId: null, blacklistUntil: 0,
    workers: { unskilled: 0, skilled: 0, technical: 0, advanced: 0 },
    rung: 'HEALTHY',
    badDays: 0, goodDays: 0,
    throttle: 1,
    // rolling books — the level gates read these
    revenueDay: 0, costDay: 0, profitDay: 0, customersDay: 0,
    profitStreak: 0, suppliers: {}, lifetimeRevenue: 0, lifetimeProfit: 0,
    // last tick's diagnosis, for the bottleneck panel
    lastFill: 1, lastInputAvail: 1, lastProduced: 0, lastBottleneck: null, lastLeg: null,
    inventory: 0,
    tileKey: opts.tileKey || null,   // optional link back to a node-city tile
  };
  f.cash = dailyOperatingCost(f) * ECON.firm.startCashDays;
  FIRMS.push(f);
  return f;
}

/* Default daily capacity for a step, scaled so one firm is a meaningful but not
   overwhelming supplier. Derived from the recipe's labour intensity: a step
   that takes a lot of work per unit produces fewer units. */
export function defaultCapacity(out) {
  const d = DEPOSITS[out];
  if (d) return Math.max(1, Math.round((d.yield || 10) * 2));
  const r = RECIPES[out];
  if (!r) return 40;
  return Math.max(1, Math.round(24 / Math.max(0.02, r.labor || 0.1)));
}

/* ── HEADCOUNT ──────────────────────────────────────────────────────────────
   How many workers this firm needs to run at full capacity. Derived from the
   recipe's labour per unit × capacity, converted through the same
   labour-units-per-day figure prices.js uses — so the wage bill a firm pays and
   the wage cost baked into its price are the same number by construction. */
/* 🔴 A FIRM STAFFS FOR WHAT IT PLANS TO MAKE, NOT FOR ITS NAMEPLATE.
   This used to size every crew from `capacity` alone. Once production became
   demand-driven, that meant a plant with orders for 15% of its line still paid
   a full shift every single day — revenue could never cover payroll, and a
   200-day run watched fourteen healthy businesses consolidate down to three
   while the audit stayed perfectly clean. Nothing was minted; the firms were
   simply all overstaffed by construction.

   `plannedRate` is the units/day sim.js has actually allocated this firm from
   market demand. Sizing the crew to it is what real businesses do, and it is
   what makes a quiet shop survive as a quiet shop instead of dying.

   ⚠ IT IS SIZED TO THE PLAN, NOT TO LAST TICK'S OUTPUT. Staffing from past
   production would close a loop — understaffed → produced less → staffed less
   → produced less — and no business could ever climb out of one bad day. */
export function headcountFor(f) {
  const band = bandOf(f.out);
  const lvl = levelDef(f.level);
  const nameplate = f.capacity * lvl.capMul;
  const planned = (typeof f.plannedRate === 'number' && isFinite(f.plannedRate))
                ? Math.max(0, Math.min(nameplate, f.plannedRate))
                : nameplate;

  /* 🔴 DEPOSITS AND RECIPES MEASURE LABOUR IN DIFFERENT UNITS. Mixing them
     understaffed every extractor in the game by a factor of twelve.
       • A recipe's `labor` is in LABOUR-UNITS per unit produced, and a worker
         delivers `laborUnitsPerDay` of them — so divide by that.
       • A deposit's `yield` is already units per LABOUR-DAY, i.e. what ONE
         worker extracts in a day. Dividing it by laborUnitsPerDay as well
         asked for a twelfth of a person: a soybean farm planning 881 units a
         day staffed one farmhand, and no mine in the game ever needed a second
         worker at any scale. Prices already assume the honest reading (see
         rawBase in prices.js, wage ÷ yield), so this is the side that was
         wrong, and the two now agree. */
  const need = DEPOSITS[f.out]
    ? Math.ceil(planned / Math.max(0.01, DEPOSITS[f.out].yield))
    : Math.ceil(((RECIPES[f.out] && RECIPES[f.out].labor) || 0.1) * planned
                / Math.max(1, ECON.price.laborUnitsPerDay));
  /* Mothballed: no orders at all means no shift and no wage bill. The firm
     still carries its other costs, so it is not free to sit idle — but it is
     not paying people to stand in an empty plant either. */
  if (planned <= 1e-6) return { band, n: 0, mothballed: true };
  return { band, n: Math.max(1, need) };
}

export function levelDef(lv) {
  return ECON.firm.levels[Math.max(0, Math.min(ECON.firm.levels.length - 1, (lv || 1) - 1))];
}

export function employeeCount(f) {
  let n = 0; for (const b in f.workers) n += f.workers[b]; return n;
}

/* Full daily cost of running this firm at current level and throttle. Used for
   the seed-cash calculation and by the level gates ("cashDays"). */
export function dailyOperatingCost(f) {
  const hc = headcountFor(f);
  const lvl = levelDef(f.level);
  const wage = (ECON.labor.bands[hc.band] || ECON.labor.bands.unskilled).wage * lvl.wageMul;
  const wages = hc.n * wage;
  let inputs = 0;
  const leg = legsOf(f.out)[0];
  if (leg) for (const inp in (leg.in || {})) inputs += basePrice(inp) * leg.in[inp] * f.capacity * lvl.capMul;
  return wages + inputs;
}

/* ════════════════════════════════════════════════════════════════════════════
   💸 THE CASH RULE
   ════════════════════════════════════════════════════════════════════════════ */

/* Spend up to `amount`. Returns what was actually paid — ALWAYS check it.
   ⚠ A firm in DEFAULT still pays wages if it can; it stops paying SUPPLIERS.
     That ordering is deliberate and it matters: a business that stiffs its
     workers first empties the consumer economy far faster than one that stiffs
     its suppliers, and the recession would be unrecoverable rather than deep. */
export function pay(f, amount) {
  const amt = Math.max(0, amount || 0);
  if (amt <= 0) return 0;
  const paid = Math.min(f.cash, amt);
  f.cash -= paid;
  f.costDay += paid;
  return paid;
}

export function earn(f, amount) {
  const amt = Math.max(0, amount || 0);
  if (amt <= 0) return 0;
  f.cash += amt;
  f.revenueDay += amt;
  f.lifetimeRevenue += amt;
  return amt;
}

/* ── PAYROLL ────────────────────────────────────────────────────────────────
   Pays the crew and hands the Cinder to households. Returns the payroll tax
   owed, which sim.js routes to the treasury.

   🔴 THE UNDERPAY PATH IS THE RECESSION. A firm that can only afford part of
   its wage bill pays pro rata; if that falls below `minWagePct` of the going
   wage, workers quit at `quitChancePerDay`, capacity falls, revenue falls, and
   it can afford even less next tick. Nothing scripts this — it is just the
   accounting running forward. */
export function runPayroll(f, days) {
  const hc = headcountFor(f);
  const lvl = levelDef(f.level);
  const wage = (ECON.labor.bands[hc.band] || ECON.labor.bands.unskilled).wage * lvl.wageMul;
  const staffed = f.workers[hc.band] || 0;
  const bill = staffed * wage * days;
  if (bill <= 0) return 0;

  const paid = pay(f, bill);
  const ratio = bill > 0 ? paid / bill : 1;
  HH.payWages(hc.band, paid);
  /* 🔴 THE FIRM PAYS THE PAYROLL TAX OUT OF ITS OWN CASH, and the caller must
     credit the treasury with EXACTLY what `pay()` returned. Returning
     `paid * rate` without debiting the firm mints that Cinder — the treasury
     grows and nothing shrinks. The closed-loop audit in sim.js caught precisely
     this, which is the whole reason the audit exists. */
  const tax = pay(f, paid * ECON.tax.payroll);

  if (ratio < ECON.labor.minWagePct) {
    // Workers walk. Deterministic fraction rather than a per-worker dice roll:
    // a coin flip per employee makes an identical city behave differently on
    // reload, and this state is serialised.
    const quit = Math.ceil(staffed * ECON.labor.quitChancePerDay * days);
    f.workers[hc.band] = Math.max(0, staffed - quit);
  }
  return tax;
}

/* ── PRICING ────────────────────────────────────────────────────────────────
   A firm's asking price is its unit cost plus its target margin, but never
   below the market floor and never above what customers will bear — the
   market multiplier already encodes that. A distressed firm cuts into its
   margin down to `minMargin` before it stops selling. */
export function askPrice(f) {
  const unit = unitCost(f);
  const target = unit * (1 + ECON.firm.marginTarget);
  const market = priceOf(f.out);
  if (f.rung === 'HEALTHY') return Math.max(target, market * 0.92);
  const floor = unit * (1 + ECON.firm.minMargin);
  return Math.max(floor, Math.min(target, market));
}

export function unitCost(f) {
  const lvl = levelDef(f.level);
  const hc = headcountFor(f);
  const wage = (ECON.labor.bands[hc.band] || ECON.labor.bands.unskilled).wage * lvl.wageMul;
  const units = Math.max(1, f.capacity * lvl.capMul);
  let c = (hc.n * wage) / units;
  const leg = f.lastLeg || legsOf(f.out)[0];
  if (leg) for (const inp in (leg.in || {})) c += priceOf(inp) * leg.in[inp];
  return c;
}

/* ── PRODUCTION ─────────────────────────────────────────────────────────────
   `availability` maps resource id → 0..1, how much of what this firm wanted it
   could actually get. Returns units produced and RECORDS THE BINDING
   CONSTRAINT, which is the entire supply-chain-view feature:

     Workers: 96%  Electricity: 100%  Iron Supply: 31% ⚠  →  bottleneck: iron

   ⚠ THE MINIMUM BINDS, NOT THE PRODUCT. Multiplying the factors would mean
     three inputs at 90% gave 73% output, which is not how a production line
     works — a line runs at the rate of its slowest input and idles on the rest. */
export function produce(f, days, availability, ctx) {
  if (f.rung === 'BANKRUPT') { f.lastProduced = 0; return 0; }
  const lvl = levelDef(f.level);
  const hc = headcountFor(f);

  // Labour fill
  const staffed = f.workers[hc.band] || 0;
  const laborFill = hc.n > 0 ? Math.min(1, staffed / hc.n) : 1;

  // Input availability — pick the leg that is actually runnable
  const best = bestLeg(f.out, availability);
  f.lastLeg = best ? best.leg : null;
  let inputFill = 1;
  const constraints = [{ key: 'workers', label: 'Workers', pct: laborFill }];
  if (best && best.leg && best.leg.in) {
    for (const inp in best.leg.in) {
      const a = availability && availability[inp] != null ? availability[inp] : 1;
      constraints.push({ key: inp, label: inp, pct: a });
      inputFill = Math.min(inputFill, a);
    }
  }
  // Utilities, passed in by sim.js from the city's own coverage
  if (ctx) {
    if (ctx.power != null) constraints.push({ key: 'electricity', label: 'Electricity', pct: ctx.power });
    if (ctx.water != null) constraints.push({ key: 'freshWater', label: 'Water', pct: ctx.water });
    if (ctx.freight != null) constraints.push({ key: 'freight', label: 'Freight Capacity', pct: ctx.freight });
  }

  let fill = 1;
  for (const c of constraints) fill = Math.min(fill, Math.max(0, c.pct));
  constraints.sort((a, b) => a.pct - b.pct);
  f.lastConstraints = constraints;
  f.lastBottleneck = (constraints[0] && constraints[0].pct < 0.995) ? constraints[0] : null;
  f.lastFill = fill;
  f.lastInputAvail = inputFill;

  const units = f.capacity * lvl.capMul * f.throttle * fill * Math.max(0, days);
  f.lastProduced = units;
  f.inventory += units;
  return units;
}

/* Sell units out of inventory at `price`. Returns Cinder earned. */
export function sell(f, units, price, customers) {
  const n = Math.max(0, Math.min(f.inventory, units || 0));
  if (n <= 0) return 0;
  f.inventory -= n;
  f.customersDay += (customers || 0);
  return earn(f, n * Math.max(0, price || 0));
}

/* ════════════════════════════════════════════════════════════════════════════
   📅 THE DAILY CLOSE — profit, tax, the distress ladder, and the level gates.
   Called once per ECONOMIC DAY, not once per tick.
   ════════════════════════════════════════════════════════════════════════════ */
export function closeDay(f) {
  const profit = f.revenueDay - f.costDay;
  f.profitDay = profit;
  f.lifetimeProfit += profit;

  let tax = 0;
  if (profit > 0) {
    tax = profit * ECON.tax.corporate;
    tax = pay(f, tax);           // a firm can only pay tax it has
    f.profitStreak++;
  } else {
    f.profitStreak = 0;
  }

  // ── The ladder ──────────────────────────────────────────────────────────
  const D = ECON.firm.distress;
  if (f.cash <= 0) { f.badDays++; f.goodDays = 0; }
  else if (profit > 0) { f.goodDays++; if (f.goodDays >= D.recoverDays) { f.badDays = Math.max(0, f.badDays - 1); f.goodDays = 0; } }

  const prev = f.rung;
  if (f.rung !== 'BANKRUPT') {
    if (f.badDays >= D.bankruptAfterDays)      f.rung = 'BANKRUPT';
    else if (f.badDays >= D.defaultAfterDays)  f.rung = 'DEFAULT';
    else if (f.badDays >= D.debtAfterDays)     f.rung = 'DEBT';
    else if (f.badDays >= D.layoffsAfterDays)  f.rung = 'LAYOFFS';
    else if (f.badDays >= D.reducedAfterDays)  f.rung = 'REDUCED';
    else                                       f.rung = 'HEALTHY';
  }

  // Consequences of the rung
  f.throttle = (f.rung === 'HEALTHY') ? 1 : D.throttlePct;
  if (f.rung === 'LAYOFFS' && prev !== 'LAYOFFS') {
    for (const b in f.workers) f.workers[b] = Math.floor(f.workers[b] * (1 - D.layoffPct));
  }
  if (f.rung === 'BANKRUPT') {
    /* 🔴 BANKRUPTCY RELEASES THE WORKERS THE SAME DAY. "Factory closes ↓ NPCs
       lose jobs ↓ Household income falls" — the announcement's recession chain
       starts here, and it only starts if the headcount is actually freed. */
    for (const b in f.workers) f.workers[b] = 0;
    f.throttle = 0; f.inventory = 0;
  }

  const closed = { revenue: f.revenueDay, cost: f.costDay, profit, tax, rung: f.rung, was: prev };
  f.revenueDay = 0; f.costDay = 0; f.customersDay = 0;
  return closed;
}

/* ── LEVEL GATES ────────────────────────────────────────────────────────────
   "You won't simply click an upgrade button and magically become Level 5."
   EVERY condition must hold. Returns {ok, missing[]} so the panel can print
   exactly what is still short — a gate the player cannot see is a wall. */
export function levelCheck(f) {
  const next = ECON.firm.levels[f.level];    // levels[] is 0-indexed by lv-1
  if (!next || !next.gate) return { ok: false, maxed: true, missing: [], next: null };
  const g = next.gate;
  const missing = [];
  const opCost = Math.max(1, dailyOperatingCost(f));

  const checks = [
    ['Customers',      f.customersAvg   || 0, g.customersPerDay],
    ['Revenue/day',    f.revenueAvg     || 0, g.revenuePerDay],
    ['Profitable days',f.profitStreak   || 0, g.profitDays],
    ['Employees',      employeeCount(f),      g.employees],
    ['Suppliers',      Object.keys(f.suppliers || {}).length, g.suppliers],
    ['Cash reserve',   f.cash / opCost,       g.cashDays],
    ['Infrastructure', f.infrastructure || 0, g.infrastructure],
  ];
  for (const [label, have, need] of checks) {
    if (have < need) missing.push({ label, have, need });
  }
  return { ok: !missing.length, maxed: false, missing, next };
}

/* Returns the Cinder the expansion cost, or 0 if the gates were not met.
   🔴 THE CALLER MUST BANK THE RETURN VALUE SOMEWHERE. This used to swallow the
   spend inside `pay()`, which DESTROYED that Cinder — the firm's cash fell and
   no account rose. Destruction fails the closed-loop audit exactly as minting
   does, and it is harder to notice because the number only ever goes down. */
export function levelUp(f) {
  const c = levelCheck(f);
  if (!c.ok) return 0;
  f.level = Math.min(ECON.firm.levels.length, f.level + 1);
  /* Expansion COSTS. A firm that levels up spends its reserve doing it —
     otherwise levelling is free and every firm reaches 5 the moment it can,
     which makes the gates a delay rather than a decision. */
  return pay(f, dailyOperatingCost(f) * 4);
}

/* Record that this firm bought from a supplier — feeds the `suppliers` gate. */
export function noteSupplier(f, supplierFirmId) {
  if (!supplierFirmId) return;
  f.suppliers = f.suppliers || {};
  f.suppliers[supplierFirmId] = true;
}

/* Rolling averages the gates read. Called on the daily close by sim.js so the
   gates measure a sustained business rather than one good afternoon. */
export function rollAverages(f, closed) {
  const a = 0.2;   // EMA weight — ~5 day window
  f.revenueAvg   = (f.revenueAvg   || 0) * (1 - a) + closed.revenue * a;
  f.customersAvg = (f.customersAvg || 0) * (1 - a) + (f.customersDayPrev || 0) * a;
}

/* Remove bankrupt firms once their closure has been reported. Kept as a
   separate step so the tick that killed them can still show them in the log —
   a business that vanishes between frames never gets explained to the player. */
export function reap() {
  const dead = FIRMS.filter(f => f.rung === 'BANKRUPT' && f.reported);
  FIRMS = FIRMS.filter(f => !(f.rung === 'BANKRUPT' && f.reported));
  return dead;
}

export function totalCash() { let n = 0; for (const f of FIRMS) n += f.cash; return n; }
export function totalDebt()  { let n = 0; for (const f of FIRMS) n += f.debt; return n; }

export function serialize() {
  return {
    v: 1, nextId: NEXT_ID,
    firms: FIRMS.map(f => ({
      id: f.id, out: f.out, ind: f.ind, name: f.name, level: f.level, capacity: f.capacity,
      cash: Math.round(f.cash * 100) / 100, debt: Math.round(f.debt * 100) / 100,
      workers: { ...f.workers }, rung: f.rung, badDays: f.badDays, goodDays: f.goodDays,
      inventory: Math.round(f.inventory * 100) / 100, profitStreak: f.profitStreak,
      suppliers: Object.keys(f.suppliers || {}), tileKey: f.tileKey,
      revenueAvg: f.revenueAvg || 0, customersAvg: f.customersAvg || 0,
      lifetimeRevenue: f.lifetimeRevenue || 0, lifetimeProfit: f.lifetimeProfit || 0,
    })),
  };
}

/* 🔴 ABSENT-TOLERANT, like production.state.js's ensureState. A save written
   before this feature existed must load as "no firms", never as a throw, and a
   firm whose output id no longer exists in the catalogue is dropped rather than
   rendered as undefined. */
export function load(raw) {
  reset();
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.firms)) return;
  for (const r of raw.firms) {
    if (!r || typeof r !== 'object' || !r.out) continue;
    if (!RECIPES[r.out] && !DEPOSITS[r.out] && !INDUSTRIES[r.ind]) continue;
    const meta = INDUSTRIES[r.ind] || INDUSTRIES[industryOf(r.out)] || INDUSTRIES.distributor;
    const f = {
      id: r.id || NEXT_ID++, out: r.out, ind: r.ind || industryOf(r.out) || 'distributor',
      kind: meta.kind, name: r.name || meta.name,
      level: Math.max(1, Math.min(ECON.firm.levels.length, r.level | 0 || 1)),
      capacity: Math.max(1, Number(r.capacity) || defaultCapacity(r.out)),
      cash: Math.max(0, Number(r.cash) || 0), debt: Math.max(0, Number(r.debt) || 0),
      loanId: null, blacklistUntil: 0,
      workers: { unskilled: 0, skilled: 0, technical: 0, advanced: 0 },
      rung: RUNGS.indexOf(r.rung) >= 0 ? r.rung : 'HEALTHY',
      badDays: r.badDays | 0, goodDays: r.goodDays | 0, throttle: 1,
      revenueDay: 0, costDay: 0, profitDay: 0, customersDay: 0,
      profitStreak: r.profitStreak | 0, suppliers: {},
      lifetimeRevenue: Number(r.lifetimeRevenue) || 0, lifetimeProfit: Number(r.lifetimeProfit) || 0,
      revenueAvg: Number(r.revenueAvg) || 0, customersAvg: Number(r.customersAvg) || 0,
      lastFill: 1, lastInputAvail: 1, lastProduced: 0, lastBottleneck: null, lastLeg: null,
      inventory: Math.max(0, Number(r.inventory) || 0), tileKey: r.tileKey || null,
    };
    if (r.workers) for (const b in f.workers) f.workers[b] = Math.max(0, (r.workers[b] | 0));
    if (Array.isArray(r.suppliers)) for (const s of r.suppliers) f.suppliers[s] = true;
    FIRMS.push(f);
    if (f.id >= NEXT_ID) NEXT_ID = f.id + 1;
  }
  if (raw.nextId > NEXT_ID) NEXT_ID = raw.nextId;
}

export default { found, all, alive, produce, sell, closeDay, levelCheck, levelUp, RUNGS, RUNG_META };
