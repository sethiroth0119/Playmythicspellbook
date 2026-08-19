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
  /* last tick's readouts, for the panel.
     ⚠ `lastDividend` used to be created on first use inside payDividend(), which
        meant a cold process and a warm one did not have the same SHAPE of state
        object here. Nothing read it before it was written, so it was not itself a
        source of drift — but see logistics.js `congestionMul` for the field on
        which exactly that assumption was false and cost the gate its credibility.
        Every readout is declared and every readout is cleared, so that "what does
        reset() leave behind" is answerable by reading rather than by sampling. */
  lastIncome: 0, lastSpend: 0, lastRent: 0, lastTax: 0, lastBenefit: 0,
  lastDividend: 0,
  unmetDemand: {},          // category → Cinder that wanted to be spent and could not
  /* 📊 category → the Cinder households WANTED to spend, before the shops were
     asked whether they could serve it. Declared for the same reason every other
     readout here is declared (see the note above `lastIncome`), and it exists
     because `satisfaction` alone cannot be read safely: satisfaction is
     take ÷ want, so it collapses to 0 at ANY size of want, and a consumer that
     averages it unweighted gives a category that wanted 0.04 Cinder the same
     vote as one that wanted five hundred. /src/hud's demand panel shipped
     exactly that bug — a 0.04-Cinder want pinned Commercial demand at 100% —
     and the fix needs the DENOMINATOR, which was the one number that never left
     this module. Pure readout: nothing in the simulation reads it. */
  wantDemand: {},           // category → Cinder that wanted to be spent, served or not
  satisfaction: {},         // category → 0..1 how well it was served
};

export function state() { return S; }
export function reset() {
  S.pop = { low: 0, mid: 0, high: 0 };
  S.savings = { low: 0, mid: 0, high: 0 };
  S.employed = { unskilled: 0, skilled: 0, technical: 0, advanced: 0 };
  S.vacancies = { unskilled: 0, skilled: 0, technical: 0, advanced: 0 };
  S.unmetDemand = {}; S.satisfaction = {}; S.wantDemand = {};
  S.lastIncome = 0; S.lastSpend = 0; S.lastRent = 0; S.lastTax = 0;
  S.lastBenefit = 0; S.lastDividend = 0;
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
/* ── 🏘 WHO THE NEW ARRIVALS ARE — OPTIONAL, AND ABSENT BY DEFAULT ──────────
   The second wire to /src/demographics, and the smaller one. It answers "of the
   people who just moved in, what share are well-off", as weights over the three
   wealth tiers, so a city that zoned detached family housing grows a middle
   class and one that zoned nothing but low-rent housing does not.

   🔴 IT MOVES HEADCOUNT AND NOTHING ELSE. `S.savings` is untouched on this
   path, so `totalSavings()` — a term of sim.js's `totalCinder()` — is invariant
   across it, exactly as it must be for a function the audit window does not
   cover (see the redistributeEmptiedTiers header for what happens when
   something on this path does move money). New residents arrive with nothing;
   what they then EARN is the only way they get any, which is households.js's
   whole invariant. */
let TIER_MIX = null;
export function setArrivalTierMix(fn) {
  TIER_MIX = (typeof fn === 'function') ? fn : null;
  return !!TIER_MIX;
}
function arrivalMix() {
  if (!TIER_MIX) return null;
  let m;
  try { m = TIER_MIX(); } catch (e) { return null; }
  if (!m || typeof m !== 'object') return null;
  let sum = 0; const w = {};
  for (const t of TIERS) { w[t] = Math.max(0, num(m[t], 0, false)); sum += w[t]; }
  if (!(sum > 0)) return null;
  for (const t of TIERS) w[t] /= sum;
  return w;
}
/* Place `n` new residents across the tiers by `w`. The LAST tier takes the
   remainder rather than its own rounded share — three floors of a float do not
   sum back to the original, and a headcount that is one person short every tick
   is a population that silently stops tracking the host's. */
function placeArrivals(n, w) {
  let handed = 0;
  for (let i = 0; i < TIERS.length - 1; i++) {
    const k = Math.floor(n * w[TIERS[i]]);
    S.pop[TIERS[i]] += k; handed += k;
  }
  S.pop[TIERS[TIERS.length - 1]] += Math.max(0, n - handed);
}

export function setPopulation(total) {
  /* The host's population figure crosses the seam here every tick, so it gets
     the same treatment as a loaded save — see num(). */
  total = num(total, 0, true);
  const cur = population();
  if (cur === 0) {
    // Fresh seed: everyone starts poor. A city does not begin with a middle
    // class — unless demographics can say who actually moved in, in which case
    // it is the better answer and the tiers start where the zoning put them.
    const w = arrivalMix();
    S.pop = { low: 0, mid: 0, high: 0 };
    if (w) placeArrivals(total, w); else S.pop.low = total;
    return;
  }
  /* 📈 GROWTH IS PLACED, NOT SCALED. Scaling the existing distribution says the
     newcomers are demographically identical to the residents — which is exactly
     the claim this feature exists to falsify, because the newcomers are whoever
     the newest district was zoned for. Shrinkage still scales: people leaving
     do not choose a wealth tier to leave from. */
  const w = (total > cur) ? arrivalMix() : null;
  if (w) { placeArrivals(total - cur, w); return; }
  // Grow or shrink proportionally, so an existing wealth distribution survives
  // a population change instead of being flattened by it.
  const scale = total / cur;
  let assigned = 0;
  for (let i = 0; i < TIERS.length - 1; i++) {
    S.pop[TIERS[i]] = Math.max(0, Math.floor(S.pop[TIERS[i]] * scale));
    assigned += S.pop[TIERS[i]];
  }
  S.pop.high = Math.max(0, total - assigned);
  redistributeEmptiedTiers();
}

/* 🔴 THE DESTRUCTION THIS REPLACES, AND IT WAS RULE 1 IN THE ONE PLACE THE
   AUDIT STRUCTURALLY CANNOT LOOK.
   ----------------------------------------------------------------------------
   This used to be one line:

       for (const t of TIERS) if (S.pop[t] === 0) { S.savings[t] = 0; }

   and the comment above it claimed the zeroing PREVENTED breaking the audit.
   It had it exactly backwards. A tier whose headcount rounds to zero had its
   whole savings balance DELETED — `HH.totalSavings()` is a term of sim.js's
   `totalCinder()`, so that is Cinder destroyed, not Cinder tidied away.

   It was invisible for a structural reason, not a subtle one: `sim.js runDay`
   takes `before = totalCinder()` INSIDE itself, and index.js `tick()` calls
   `HH.setPopulation(h.population)` BEFORE `Sim.advance(...)`. The destruction
   was therefore complete before the audit window opened, so `delta` and
   `expected` both missed it and `lastAudit.ok` stayed true forever. Anything
   that moves money outside runDay is invisible to the day audit; this lived in
   exactly that gap, and so did the retired founding mint and the save-file mint.

   MEASURED on the pre-fix tree (400 randomised population moves on one city):
     17 destructive calls, 3,987.58 🔥 destroyed, worst single call
     savings 1,368.08 → 0.00, and `lastAudit.ok === true` throughout with
     err = 0.00. The live trigger is ordinary: ecoHost() passes
     `population: cityPop()`, which moves on every migration and on every
     housing build or demolish.

   THE FIX IS CONSERVATION, NOT TIDINESS. The residents who left do not take
   the money out of the city — it passes to the tiers that remain, weighted by
   headcount, which is a transfer and moves `totalCinder()` by zero. When NO
   tier survives (the city emptied completely) the balance is parked in `low`:
   with no population `demand()` and `chargeRent()` generate nothing, so it
   simply sits, and `setPopulation`'s fresh-seed branch puts the returning
   residents back in `low` where they can reach it again.

   ⚠ REJECTED: moving setPopulation inside the audit window instead. It would
     have made the transfer *visible* without making it *correct* — the audit
     would have gone red every time a tier emptied, on a live path, and the
     obvious next move is to widen the tolerance. Destroying money and telling
     the truth about it is still destroying money. */
function redistributeEmptiedTiers() {
  let orphaned = 0;
  for (const t of TIERS) {
    if (S.pop[t] === 0 && S.savings[t] !== 0) { orphaned += S.savings[t]; S.savings[t] = 0; }
  }
  if (!(orphaned > 0)) return;
  let live = 0;
  for (const t of TIERS) if (S.pop[t] > 0) live += S.pop[t];
  if (live <= 0) { S.savings.low += orphaned; return; }
  /* Weighted by headcount, and the LAST surviving tier takes the remainder
     rather than its own share — three divisions of a float do not sum back to
     the original, and "nearly conserved" is the same failure one decimal place
     down. The residue is ~1e-10 🔥; it must be zero. */
  let handed = 0, last = null;
  for (const t of TIERS) if (S.pop[t] > 0) last = t;
  for (const t of TIERS) {
    if (S.pop[t] <= 0 || t === last) continue;
    const share = orphaned * (S.pop[t] / live);
    S.savings[t] += share; handed += share;
  }
  S.savings[last] += orphaned - handed;
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

/* ── 🎓 THE QUALIFICATION SOURCE — OPTIONAL, AND ABSENT BY DEFAULT ───────────
   /src/demographics knows what the city's residents were EDUCATED to do; this
   module knows what its firms are asking for. This is the one wire between
   them, and it is a wire rather than an import for the reason CLAUDE.md gives
   for every other seam in this codebase: a 404 on the other module must cost
   the player that feature and nothing else.

   The provider returns a LADDER:

       { bands: { unskilled: n, skilled: n, technical: n, advanced: n } }

   where each entry is how many working-age residents are qualified to hold
   THAT band's jobs — so it is monotonically decreasing (everyone qualified for
   advanced work is also qualified to sweep a floor, and takes that job when
   there is nothing better). With no provider registered, `hire()` behaves
   EXACTLY as it did before this existed: the whole labour force is qualified
   for everything. That is not a fallback, it is the previous contract, and the
   economy gauntlet still measures it. */
let SUPPLY = null;
export function setLabourSupply(fn) {
  SUPPLY = (typeof fn === 'function') ? fn : null;
  return !!SUPPLY;
}
export function labourSupply() {
  if (!SUPPLY) return null;
  try {
    const r = SUPPLY();
    if (!r || typeof r !== 'object' || !r.bands) return null;
    const out = {};
    for (const b in S.employed) out[b] = num(r.bands[b], 0, true);
    return out;
  } catch (e) { return null; }   // a throwing provider is a missing provider
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
  const qual = labourSupply();
  const fill = {};
  const order = ECON.labor.fillOrder;
  for (let i = 0; i < order.length; i++) {
    const band = order[i];
    const want = S.vacancies[band] || 0;
    /* 🎓 …AND NOW THE SECOND CONSTRAINT. A vacancy the city has nobody
       QUALIFIED for goes unfilled even with idle residents standing next to it,
       which is what makes an advanced industry genuinely starved in a city that
       zoned nothing but low-rent housing. Without a provider `cap` is the whole
       pool and this line is the identity. */
    const cap = qual ? Math.min(pool, qual[band] || 0) : pool;
    const got = Math.min(want, cap);
    S.employed[band] = got;
    pool -= got;
    /* Everyone hired here was ALSO qualified for every band below this one —
       fillOrder runs high to low, so deducting downward is exact and deducting
       upward would be wrong (a college graduate hired as a technician was never
       in the advanced pool). */
    if (qual) for (let j = i; j < order.length; j++) qual[order[j]] = Math.max(0, (qual[order[j]] || 0) - got);
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
  S.lastDividend += amount;   // declared in S and cleared by reset(); see the note there
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
      S.wantDemand[key] = w;
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
    S.wantDemand[key] = w;
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

/* ⚠ THERE USED TO BE A `scaleSavings()` HERE and it is deliberately gone. Its
   only caller was sim.js's load-time Cinder clamp, which scaled every term of
   totalCinder() back to a ceiling derived from the save's own `day` count. That
   clamp was removed — see the header above sim.js `audit()` for the three
   measured reasons, and for the residual it leaves. `HH.load()` still coerces
   every figure through num() for NaN and sign; it does NOT bound magnitude, and
   a scaling hook with no caller is an invitation to rebuild the thing that
   consumed it. */

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

/* Coerce anything to a safe non-negative number. `int` floors it. A value that
   is not finite after coercion becomes `dflt` — never NaN, never negative. */
function num(v, dflt, int) {
  const n = Number(v);
  if (!isFinite(n) || n < 0) return dflt || 0;
  return int ? Math.floor(n) : n;
}

export function serialize() {
  return { v: 1, pop: { ...S.pop }, savings: { ...S.savings }, employed: { ...S.employed } };
}
export function load(raw) {
  reset();
  if (!raw || typeof raw !== 'object') return;
  /* 🔴 COERCE THROUGH Number() BEFORE Math.floor(), ALWAYS.
     `Math.floor((raw.pop && raw.pop[t]) || 0)` looks defensive and is not: a
     non-numeric STRING is truthy, so `|| 0` never fires, `Math.floor('x')` is
     NaN, and `Math.max(0, NaN)` is NaN — the population silently became NaN and
     poisoned the treasury, the audit and every panel downstream from one bad
     byte in a save file. `num()` is the only way values enter this module. */
  for (const t of TIERS) {
    S.pop[t] = num(raw.pop && raw.pop[t], 0, true);
    S.savings[t] = num(raw.savings && raw.savings[t], 0, false);
  }
  for (const b in S.employed) S.employed[b] = num(raw.employed && raw.employed[b], 0, true);
}

export default { BASKET, setPopulation, hire, payWages, demand, buy, unemployment, settle };
