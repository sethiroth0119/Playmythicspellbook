/* ════════════════════════════════════════════════════════════════════════════
   👷🛒 HOUSEHOLDS — jobs, wages, and what residents actually buy.
   ----------------------------------------------------------------------------
   "Businesses won't automatically generate income anymore. NPCs need to
    actually purchase their products and services."

   This module owns two halves of the loop and they are inseparable:
     LABOUR    firms post jobs → residents fill them → residents earn Cinder
     DEMAND    residents spend that Cinder → firms earn it back

   🔴 THE INVARIANT THIS FILE EXISTS TO PROTECT: a household can only spend
   Cinder it was actually paid. There is no "consumer spending" term computed
   from population. Population with no jobs generates NO demand, which is what
   makes an unemployment spiral a real thing that happens rather than a number
   on a panel. sim.js audits it every tick.

   ── 🔗 THIS DOES NOT REPLACE MythicCitizens ────────────────────────────────
   /src/city/citizens.city.js owns the ~72 NAMED residents — their moods, jobs,
   bonds and dialogue. It is a roster of characters. This file models the whole
   citizenry as ECONOMIC AGGREGATES (headcount per band, income, savings).
   Merging them would either cap the economy at 72 people or give 4,000 people
   dialogue trees. They are joined at one seam: `bindRoster()` lets the named
   citizens be assigned to the jobs this module creates, so the person you talk
   to has the job the economy says exists. Nothing else crosses.
   ════════════════════════════════════════════════════════════════════════════ */

import { ECON } from './tuning.js';
import { priceOf } from './prices.js';

/* ════════════════════════════════════════════════════════════════════════════
   🛒 THE CONSUMPTION BASKET — the announcement's categories, in its order.
   ----------------------------------------------------------------------------
   Each category names the RESOURCES that satisfy it and the INDUSTRY that
   sells them. `share` is the fraction of disposable income it claims.

   ⚠ A CATEGORY WITH NO RESOURCES BEHIND IT IS A HAPPINESS BAR, which is the
     exact thing this update exists to stop being ("Entertainment won't simply
     increase a happiness bar"). Every entry below resolves to real ids in
     recipes.js, so every Cinder a resident spends buys a real unit that a real
     firm had to produce out of real inputs.

   `tiered: true` means richer households buy the better goods in the list
   first — which is how a wealthy district ends up demanding smartphones while
   a poor one buys none, from one table. */
export const BASKET = [
  { key: 'housing',       name: 'Housing',       ico: '🏠', share: 0.00, ind: 'landlord',
    /* Housing is charged as RENT before disposable income is computed, so its
       share here is 0 on purpose — counting it twice would halve every other
       category. It is listed because the panel must show it, and because
       maintenance is a real resource draw. */
    res: ['constructionComponents', 'electricity', 'freshWater'], rentDriven: true },
  { key: 'food',          name: 'Food',          ico: '🍞', share: 0.24, ind: 'grocer',
    res: ['bread', 'packagedFood', 'vegetables', 'meat', 'dairy', 'eggs', 'beverages', 'cannedFood', 'snacks'] },
  { key: 'utilities',     name: 'Utilities',     ico: '⚡', share: 0.11, ind: 'powerPlant',
    res: ['electricity', 'freshWater', 'naturalGasFuel'] },
  { key: 'transport',     name: 'Transport',     ico: '🚌', share: 0.09, ind: 'transitCo',
    res: ['gasoline', 'maintenanceParts', 'tires'] },
  { key: 'healthcare',    name: 'Healthcare',    ico: '⚕️', share: 0.08, ind: 'pharmacy',
    res: ['medicine', 'medicalSupplies', 'pharmaceuticals'], tiered: true },
  { key: 'clothing',      name: 'Clothing',      ico: '👕', share: 0.07, ind: 'clothier',
    res: ['clothing', 'shoes', 'fabric'] },
  { key: 'electronics',   name: 'Electronics',   ico: '📱', share: 0.08, ind: 'techStore',
    res: ['smartphones', 'computers', 'appliances', 'communicationDevices', 'householdGoods'], tiered: true },
  { key: 'restaurants',   name: 'Restaurants',   ico: '🍽️', share: 0.09, ind: 'restaurant',
    res: ['preparedMeals', 'restaurantSupplies', 'beverages'] },
  { key: 'entertainment', name: 'Entertainment', ico: '🎭', share: 0.10, ind: 'venue',
    res: ['sportingGoods', 'toys', 'books', 'beverages'] },
  /* 🃏 CARDS. Mythic Spellbook itself, as a line in the household budget. This
     is the seam that connects the city economy to the game's own product —
     `boosterPacks` and `collectorPacks` here are the SAME ids the Ouroboros
     printing chain produces in recipes.js, so a resident buying a pack is
     genuinely paying the printer, who is paying the paper mill, who is paying
     the forestry camp. */
  { key: 'cards',         name: 'Ouroboros Cards', ico: '🃏', share: 0.06, ind: 'cardShop',
    res: ['boosterPacks', 'starterDecks', 'collectorPacks', 'tournamentProducts'], tiered: true },
  { key: 'luxury',        name: 'Luxury',        ico: '💎', share: 0.08, ind: 'luxuryStore',
    res: ['luxuryGoods', 'furniture', 'personalCareProducts'], tiered: true },
];

export const BASKET_BY_KEY = BASKET.reduce((m, b) => { m[b.key] = b; return m; }, {});

/* ════════════════════════════════════════════════════════════════════════════
   👥 THE CITIZENRY, AS AN ECONOMY
   ════════════════════════════════════════════════════════════════════════════ */

/* Households are tracked in WEALTH TIERS rather than individually. Three tiers
   is enough for the demand curve to bend (a rich district buying smartphones
   while a poor one buys bread) and few enough that the panel is readable.
   Individually-simulated households would be 4,000 objects per tick to produce
   a number three buckets already give. */
export const TIERS = ['low', 'mid', 'high'];

const S = {
  /* headcount per wealth tier */
  pop: { low: 0, mid: 0, high: 0 },
  /* Cinder each tier is holding. THE ONLY SOURCE OF CONSUMER DEMAND. */
  savings: { low: 0, mid: 0, high: 0 },
  /* employment: filled jobs per skill band */
  employed: { unskilled: 0, skilled: 0, technical: 0, advanced: 0 },
  /* jobs firms have POSTED but not filled */
  vacancies: { unskilled: 0, skilled: 0, technical: 0, advanced: 0 },
  /* last tick's readouts, for the panel */
  lastIncome: 0, lastSpend: 0, lastRent: 0, lastTax: 0, lastBenefit: 0,
  unmetDemand: {},          // category → Cinder that wanted to be spent and could not
  satisfaction: {},         // category → 0..1 how well it was served
};

export function state() { return S; }
export function reset() {
  S.pop = { low: 0, mid: 0, high: 0 };
  S.savings = { low: 0, mid: 0, high: 0 };
  S.employed = { unskilled: 0, skilled: 0, technical: 0, advanced: 0 };
  S.vacancies = { unskilled: 0, skilled: 0, technical: 0, advanced: 0 };
  S.unmetDemand = {}; S.satisfaction = {};
}

export function population() { return S.pop.low + S.pop.mid + S.pop.high; }
export function employedTotal() { let n = 0; for (const b in S.employed) n += S.employed[b]; return n; }
export function vacancyTotal() { let n = 0; for (const b in S.vacancies) n += S.vacancies[b]; return n; }

/* 📉 UNEMPLOYMENT — the number the whole recession loop turns on.
   Measured against the WORKING-AGE population, which is a fraction of the
   citizenry; a city of 100 does not have 100 job seekers. */
export const WORKING_AGE_PCT = 0.62;
export function laborForce() { return Math.floor(population() * WORKING_AGE_PCT); }
export function unemployment() {
  const lf = laborForce();
  if (lf <= 0) return 0;
  return Math.max(0, Math.min(1, (lf - employedTotal()) / lf));
}

/* Set the citizenry from the host's population figure. The city already owns
   population (game.pop.npc in node-city, gated by housing); this module does
   NOT invent people — it distributes the ones the city says exist into wealth
   tiers. Two systems growing population independently would diverge within
   minutes and the player would see two different numbers for the same city. */
export function setPopulation(total) {
  total = Math.max(0, Math.floor(total || 0));
  const cur = population();
  if (cur === 0) {
    // Fresh seed: everyone starts poor. A city does not begin with a middle class.
    S.pop = { low: total, mid: 0, high: 0 };
    return;
  }
  // Grow or shrink proportionally, so an existing wealth distribution survives
  // a population change instead of being flattened by it.
  const scale = total / cur;
  let assigned = 0;
  for (let i = 0; i < TIERS.length - 1; i++) {
    S.pop[TIERS[i]] = Math.max(0, Math.floor(S.pop[TIERS[i]] * scale));
    assigned += S.pop[TIERS[i]];
  }
  S.pop.high = Math.max(0, total - assigned);
  /* ⚠ Savings follow the people. A tier that shrank must not keep the savings
     of residents who are no longer there — that Cinder would be spendable by
     nobody and would break the closed-loop audit in sim.js. */
  for (const t of TIERS) if (S.pop[t] === 0) { S.savings[t] = 0; }
}

/* ── JOB POSTING ────────────────────────────────────────────────────────────
   Firms call this each tick with the headcount they want per band. */
export function clearVacancies() {
  S.vacancies = { unskilled: 0, skilled: 0, technical: 0, advanced: 0 };
}
export function postJobs(band, n) {
  if (!S.vacancies[band]) S.vacancies[band] = 0;
  S.vacancies[band] += Math.max(0, n || 0);
}

/* ── HIRING ─────────────────────────────────────────────────────────────────
   Fill vacancies from the labour force, best-paid band first (ECON.labor
   .fillOrder). Returns fill ratio per band so a firm can throttle output to
   the crew it actually got.

   🔴 THE HIGH BANDS FILL FIRST AND THAT IS THE DESIGN. It is why a city that
   builds one Semiconductor Fab watches its restaurants lose staff: the fab
   outbids them for the same finite people. "High employment means more money
   flowing through your city" has to have a cost on the other side or there is
   no decision in it. */
export function hire() {
  let pool = laborForce();
  const fill = {};
  for (const band of ECON.labor.fillOrder) {
    const want = S.vacancies[band] || 0;
    const got = Math.min(want, pool);
    S.employed[band] = got;
    pool -= got;
    fill[band] = want > 0 ? got / want : 1;
  }
  return fill;
}

/* ── PAYDAY ─────────────────────────────────────────────────────────────────
   Firms pay wages INTO this function; it is the only way Cinder reaches a
   household. `amount` has already left the firm's cash in firms.js — this side
   only receives, so the pair is a transfer and the audit balances.

   Wages land in the tier that earned them, and earning enough moves a household
   UP a tier over time (see `settle()`). */
export function payWages(band, amount) {
  if (!(amount > 0)) return;
  // Which wealth tier does this band's pay land in? Advanced/technical work is
  // what actually builds a middle and upper class in a city.
  const tier = (band === 'advanced') ? 'high' : (band === 'technical' || band === 'skilled') ? 'mid' : 'low';
  const t = S.pop[tier] > 0 ? tier : 'low';
  S.savings[t] += amount;
  S.lastIncome += amount;
}

/* 💰 Capital income. Lands in the `high` tier — the residents who own the
   businesses — falling back to whichever tier actually has people in it so a
   young city with no upper class still receives it rather than losing it.
   ⚠ Credit ONLY what the firm was actually debited (Firms.pay's return). */
export function payDividend(amount) {
  if (!(amount > 0)) return;
  const t = S.pop.high > 0 ? 'high' : (S.pop.mid > 0 ? 'mid' : 'low');
  S.savings[t] += amount;
  S.lastIncome += amount;
  S.lastDividend = (S.lastDividend || 0) + amount;
}

/* Unemployment benefit, paid by the city treasury (sim.js debits it there).
   The automatic stabiliser — see ECON.labor.benefitPct. */
export function payBenefit(amount) {
  if (!(amount > 0)) return;
  S.savings.low += amount;
  S.lastBenefit += amount;
}
export function benefitBill(days) {
  const lf = laborForce();
  const idle = Math.max(0, lf - employedTotal());
  return idle * ECON.labor.bands.unskilled.wage * ECON.labor.benefitPct * Math.max(0, days || 0);
}

/* ════════════════════════════════════════════════════════════════════════════
   🛒 SHOPPING — the half that makes businesses earn.
   ----------------------------------------------------------------------------
   `demand()` computes what residents WANT this tick, priced at live market
   prices and bent by elasticity. `buy()` is called back by sim.js once it knows
   what the shops could actually supply.
   ════════════════════════════════════════════════════════════════════════════ */

/* Tier weighting: how much of a category a wealth tier buys, relative to a
   baseline household. `tiered` categories skew hard; staples barely move. */
const TIER_WEIGHT = { low: 0.55, mid: 1.0, high: 2.4 };
const TIER_LUX    = { low: 0.10, mid: 0.85, high: 3.2 };

/* Rent charged before anything else. Returns the Cinder collected, which sim.js
   hands to the property firms — a landlord is a business with its own costs,
   not a sink. */
export function chargeRent(days) {
  let total = 0;
  for (const t of TIERS) {
    if (S.pop[t] <= 0) continue;
    const want = S.savings[t] * ECON.household.rentPctOfIncome * Math.min(1, days);
    /* A household pays what it can. Unpaid rent is NOT debt here — it is a
       missed payment that hits the landlord's revenue, which is how a
       recession reaches property companies. Modelling household debt as well
       would double-count the same shortfall. */
    const paid = Math.max(0, Math.min(S.savings[t], want));
    S.savings[t] -= paid;
    total += paid;
  }
  S.lastRent += total;
  return total;
}

/* What each category wants to spend, in Cinder, this step.
   ⚠ Bounded by SAVINGS, never by population. This is the invariant. */
export function demand(days) {
  const out = {};
  const sr = ECON.household.savingsRate;
  for (const b of BASKET) {
    if (b.rentDriven) continue;
    let total = 0;
    for (const t of TIERS) {
      if (S.pop[t] <= 0 || S.savings[t] <= 0) continue;
      const w = b.tiered ? TIER_LUX[t] : TIER_WEIGHT[t];
      /* Spendable = this tier's savings, less the part it keeps back.
         `days` scales it: a household spends its budget over time, not all at
         once, which is what lets savings buffer a short downturn. */
      const spendable = S.savings[t] * (1 - sr) * Math.min(1, days);
      total += spendable * b.share * w;
    }
    out[b.key] = total;
  }
  /* Normalise: the weighted shares can exceed the spendable pool (a high-tier
     city weights luxury at 3.2×). Scale back proportionally rather than letting
     one category eat another's budget in list order — list order is a UI
     decision and must never be an economic one. */
  let want = 0; for (const k in out) want += out[k];
  let cap = 0;
  for (const t of TIERS) cap += Math.max(0, S.savings[t]) * (1 - sr) * Math.min(1, days);
  if (want > cap && want > 0) { const f = cap / want; for (const k in out) out[k] *= f; }
  return out;
}

/* Price elasticity: how much of the wanted spend survives the current price.
   Applied per category against the average price of its resources versus their
   base — so a steel shock that raises car prices really does cut transport
   demand, and a food shock barely dents food demand. */
export function elasticityFactor(catKey, priceIndex) {
  const e = ECON.household.elasticity[catKey];
  if (!e || !(priceIndex > 0)) return 1;
  // priceIndex 1.0 = normal. Demand falls as price^-elasticity.
  return Math.max(0.05, Math.min(2.5, Math.pow(priceIndex, -e)));
}

/* Execute the purchase. `spent` is what the shops could actually serve, per
   category. Deducts from savings in tier order (rich pay first for tiered
   goods, poor for staples) and records satisfaction.
   Returns total Cinder that actually moved — sim.js credits it to the firms. */
export function buy(spentByCat, wantedByCat) {
  let moved = 0;
  for (const key in spentByCat) {
    const amt = Math.max(0, spentByCat[key] || 0);
    if (amt <= 0) {
      const w = wantedByCat ? (wantedByCat[key] || 0) : 0;
      S.satisfaction[key] = w > 0 ? 0 : 1;
      S.unmetDemand[key] = w;
      continue;
    }
    // Take it out of savings, proportionally to each tier's holding — a
    // category is bought by everyone who wanted it, not by one bucket.
    let pool = 0; for (const t of TIERS) pool += Math.max(0, S.savings[t]);
    if (pool <= 0) continue;
    let take = Math.min(amt, pool);
    for (const t of TIERS) {
      const share = Math.max(0, S.savings[t]) / pool;
      S.savings[t] = Math.max(0, S.savings[t] - take * share);
    }
    moved += take;
    const w = wantedByCat ? (wantedByCat[key] || 0) : take;
    S.satisfaction[key] = w > 0 ? Math.min(1, take / w) : 1;
    S.unmetDemand[key] = Math.max(0, w - take);
  }
  S.lastSpend += moved;
  return moved;
}

/* Take `amount` straight out of household savings, proportionally across the
   wealth tiers, and return what was actually available. Used by the subsistence
   pass in sim.js — residents pay the water bill before they choose a basket.
   ⚠ Returns the ACTUAL amount. The caller must credit firms with exactly this,
     never with what it asked for; that difference is unpaid debt, not income. */
export function spendDirect(amount) {
  const want = Math.max(0, amount || 0);
  if (want <= 0) return 0;
  let pool = 0;
  for (const t of TIERS) pool += Math.max(0, S.savings[t]);
  if (pool <= 0) return 0;
  const take = Math.min(want, pool);
  for (const t of TIERS) {
    const share = Math.max(0, S.savings[t]) / pool;
    S.savings[t] = Math.max(0, S.savings[t] - take * share);
  }
  S.lastSpend += take;
  return take;
}

/* Sales tax, skimmed at purchase. Returns the amount for the treasury. */
export function salesTax(spend) { return Math.max(0, spend) * ECON.tax.sales; }

/* ── WEALTH MOBILITY ────────────────────────────────────────────────────────
   Run once per economic day. A household holding well above the cost of its
   basket moves up a tier; one that has been empty moves down. This is what
   makes "high employment means more money flowing through your city" show up
   as a CHANGED CITY rather than a bigger number — a city with real jobs grows
   a middle class that then demands electronics and cards. */
export function settle(days) {
  if (!(days > 0)) return;
  const dayWage = ECON.labor.bands.unskilled.wage;
  for (let i = 0; i < TIERS.length - 1; i++) {
    const from = TIERS[i], to = TIERS[i + 1];
    if (S.pop[from] <= 0) continue;
    const perHead = S.savings[from] / Math.max(1, S.pop[from]);
    // Threshold rises steeply per tier: joining the high tier is not a payday.
    const need = dayWage * (i === 0 ? 14 : 60);
    if (perHead > need) {
      const move = Math.max(1, Math.floor(S.pop[from] * 0.04 * days));
      const n = Math.min(move, S.pop[from]);
      const carried = (S.savings[from] / Math.max(1, S.pop[from])) * n;
      S.pop[from] -= n; S.pop[to] += n;
      S.savings[from] -= carried; S.savings[to] += carried;
    }
  }
  for (let i = TIERS.length - 1; i > 0; i--) {
    const from = TIERS[i], to = TIERS[i - 1];
    if (S.pop[from] <= 0) continue;
    const perHead = S.savings[from] / Math.max(1, S.pop[from]);
    if (perHead < dayWage * (i === 1 ? 2 : 10)) {
      const move = Math.max(1, Math.floor(S.pop[from] * 0.06 * days));
      const n = Math.min(move, S.pop[from]);
      const carried = (S.savings[from] / Math.max(1, S.pop[from])) * n;
      S.pop[from] -= n; S.pop[to] += n;
      S.savings[from] -= carried; S.savings[to] += carried;
    }
  }
}

/* Total Cinder held by residents — one of the terms sim.js audits. */
export function totalSavings() { let n = 0; for (const t of TIERS) n += S.savings[t]; return n; }

/* Reset the per-tick readouts. Called at the top of each tick by sim.js. */
export function beginTick() {
  S.lastIncome = 0; S.lastSpend = 0; S.lastRent = 0; S.lastTax = 0; S.lastBenefit = 0;
}

/* 🔗 THE ONE SEAM TO THE NAMED CITIZENS. Hands MythicCitizens the job counts
   this economy created so the person the player talks to holds a job the
   simulation agrees exists. Guarded: the roster module is optional. */
export function bindRoster(citizens) {
  try {
    if (!citizens || typeof citizens.sync !== 'function') return false;
    citizens.sync();
    return true;
  } catch (e) { return false; }
}

export function serialize() {
  return { v: 1, pop: { ...S.pop }, savings: { ...S.savings }, employed: { ...S.employed } };
}
export function load(raw) {
  reset();
  if (!raw || typeof raw !== 'object') return;
  for (const t of TIERS) {
    S.pop[t] = Math.max(0, Math.floor((raw.pop && raw.pop[t]) || 0));
    S.savings[t] = Math.max(0, Number((raw.savings && raw.savings[t]) || 0)) || 0;
  }
  for (const b in S.employed) S.employed[b] = Math.max(0, Math.floor((raw.employed && raw.employed[b]) || 0));
}

export default { BASKET, setPopulation, hire, payWages, demand, buy, unemployment, settle };
