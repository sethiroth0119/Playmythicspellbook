/* ════════════════════════════════════════════════════════════════════════════
   🤝 TRADE & SPECIALIZATION — "YOUR CITY NEEDS OTHER CITIES."
   ----------------------------------------------------------------------------
       🌾 Greenhaven → Food → Blackridge
       ⛏️ Blackridge → Iron & Coal → Manufacturing City
       🏭 Manufacturing → Steel & Machinery → Greenhaven
       💻 Ethos Heights → Electronics → Everyone
     ...and Cinder flows the opposite way.

   ── 🔴 SPECIALIZATION IS EARNED, NEVER CHOSEN ──────────────────────────────
   There is no "pick your city type" menu here and there must never be one. A
   city is known for what it has actually been producing and exporting, for a
   sustained period, at scale (ECON.specialization). Two reasons:

     1. A menu makes the node endowment decorative. If you can declare yourself
        a Mining Specialist on a node with no ore, the ground stopped mattering
        — and the ground mattering is the entire premise of this update.
     2. It makes the claim TRUE. A player reading "Steel Specialist" on another
        city knows that city really does make steel, so trading with them is an
        informed decision rather than a label.

   ── OFFLINE-FIRST, LIKE EVERYTHING ELSE HERE ───────────────────────────────
   CLAUDE.md: "All Supabase access is guarded. The app MUST still work offline /
   before tables exist, degrading to mock or empty data." This module holds NO
   Supabase calls. It computes offers and matches locally, and the host hands it
   remote partners through `setPartners()` if and when the network has any. With
   no network the city trades with SIMULATED regional partners derived from
   neighbouring node ids — so the trade layer is fully playable solo and the
   multiplayer version is the same code with better partners.
   ════════════════════════════════════════════════════════════════════════════ */

import { ECON } from './tuning.js';
import { priceOf, basePrice } from './prices.js';
import * as Endow from './endowment.js';
import { INDUSTRIES, industryOf, DEPOSITS } from './recipes.js';
import * as Logistics from './logistics.js';

/* ════════════════════════════════════════════════════════════════════════════
   ⭐ SPECIALIZATIONS — the announcement's list, each tied to real output.
   `tests` are resource ids; a city qualifies by producing and exporting them.
   ════════════════════════════════════════════════════════════════════════════ */
export const SPECIALIZATIONS = [
  { key: 'agricultural', name: 'Agricultural Specialists', ico: '🌾', color: '#d9c46a',
    tests: ['wheat', 'corn', 'rice', 'potatoes', 'vegetables', 'fruit', 'livestock', 'flour', 'bread', 'packagedFood'] },
  { key: 'mining',       name: 'Mining Specialists',       ico: '⛏️', color: '#a8a29a',
    tests: ['ironOre', 'copperOre', 'coal', 'aluminumOre', 'nickelOre', 'zincOre', 'titanium', 'tungsten', 'lithium', 'cobalt'] },
  { key: 'steel',        name: 'Steel Specialists',        ico: '🏭', color: '#9fb4d8',
    tests: ['pigIron', 'steel', 'structuralSteel', 'sheetMetal', 'metalAlloys', 'advancedAlloys'] },
  { key: 'energy',       name: 'Energy Specialists',       ico: '⚡', color: '#ffcf6b',
    tests: ['electricity', 'crudeOil', 'naturalGas', 'gasoline', 'diesel', 'industrialFuel', 'hydrogen', 'nuclearFuel'] },
  { key: 'technology',   name: 'Technology Specialists',   ico: '💻', color: '#7fb8ff',
    tests: ['microchips', 'advancedMicrochips', 'processors', 'computers', 'smartphones', 'servers', 'circuitBoards', 'siliconWafers'] },
  { key: 'logistics',    name: 'Logistics Specialists',    ico: '🚚', color: '#8fd0a0',
    tests: ['trucks', 'freightVehicles', 'deliveryVehicles', 'packagingMaterial', 'cardboard'] },
  { key: 'cards',        name: 'Card Manufacturing',       ico: '🃏', color: '#d4af37',
    tests: ['cardStock', 'printedCards', 'boosterPacks', 'starterDecks', 'collectorPacks', 'premiumPaper', 'printingInk'] },
  { key: 'holographic',  name: 'Holographic Technology',   ico: '✨', color: '#9ad8ff',
    tests: ['holographicComponents', 'holographicProjectors', 'holographicChips', 'holographicFoil', 'opticalComponents'] },
  { key: 'entertainment',name: 'Entertainment Specialists',ico: '🎭', color: '#e0b8c8',
    tests: ['toys', 'sportingGoods', 'books', 'beverages', 'preparedMeals'] },
  { key: 'tourism',      name: 'Tourism Specialists',      ico: '🏨', color: '#e0a86a',
    /* Tourism exports a SERVICE, so it is scored on service capacity rather
       than on goods — `serviceInd` names the industries that count. */
    tests: [], serviceInd: ['hotel', 'venue', 'restaurant'] },
  { key: 'mythic',       name: 'Mythic Research',          ico: '🟣', color: '#b06bff',
    tests: ['mythicEssence', 'mythicResidue', 'anomalousMatter', 'anomalousEnergy', 'arcaneCrystal', 'advancedMedicine'] },
  { key: 'scp',          name: 'SCP Research',             ico: '🔒', color: '#7fa8c8',
    tests: ['containmentMaterials', 'reinforcedContainmentMaterials', 'realityStabilizationComponents',
            'anomalySensors', 'secureElectronics', 'containmentEquipment', 'classifiedTechnology'] },
];
export const SPEC_BY_KEY = SPECIALIZATIONS.reduce((m, s) => { m[s.key] = s; return m; }, {});

const S = {
  /* Sustained-output tracking. key → consecutive days above threshold. */
  streak: {},
  active: [],            // earned specialization keys, max ECON.specialization.maxActive
  offers: [],            // our open sell offers
  wants: [],             // our open buy requests
  partners: [],          // other cities we can reach
  nextOfferId: 1,
  lastImported: {},      // resId → units imported this day
  lastExported: {},      // resId → units exported this day
  lastImportSpend: 0, lastExportRevenue: 0,
};

export function state() { return S; }
export function reset() {
  S.streak = {}; S.active = []; S.offers = []; S.wants = []; S.partners = [];
  S.nextOfferId = 1; S.lastImported = {}; S.lastExported = {};
  S.lastImportSpend = 0; S.lastExportRevenue = 0;
}

/* ── SPECIALIZATION SCORING ─────────────────────────────────────────────────
   `outputValue` is {resId: Cinder of value produced today}. A specialization
   scores as its share of the city's TOTAL output value — share, not absolute,
   so a big city cannot qualify for everything simply by being big. */
export function scoreSpecializations(outputValue, serviceValue) {
  let total = 0;
  for (const id in outputValue) total += outputValue[id] || 0;
  for (const ind in (serviceValue || {})) total += serviceValue[ind] || 0;
  if (total <= 0) return {};

  const scores = {};
  for (const sp of SPECIALIZATIONS) {
    let v = 0;
    for (const id of sp.tests) v += outputValue[id] || 0;
    if (sp.serviceInd) for (const ind of sp.serviceInd) v += (serviceValue && serviceValue[ind]) || 0;
    scores[sp.key] = v / total;
  }
  return scores;
}

/* Advance the streaks and promote/demote. Called once per economic day. */
export function updateSpecializations(outputValue, serviceValue, days) {
  const scores = scoreSpecializations(outputValue, serviceValue);
  const need = ECON.specialization.minShareOfOutput;
  for (const sp of SPECIALIZATIONS) {
    const sc = scores[sp.key] || 0;
    if (sc >= need) S.streak[sp.key] = (S.streak[sp.key] || 0) + Math.max(0, days);
    else {
      /* Decay rather than reset. A single bad day should not erase two weeks of
         being a steel town — but a month of making no steel should. Halving the
         streak makes losing a specialization roughly as slow as earning it. */
      S.streak[sp.key] = Math.max(0, (S.streak[sp.key] || 0) - Math.max(0, days) * 0.5);
    }
  }
  // Promote: the highest-streak qualifiers, up to maxActive.
  const qualified = SPECIALIZATIONS
    .filter(sp => (S.streak[sp.key] || 0) >= ECON.specialization.minDays)
    .sort((a, b) => (S.streak[b.key] || 0) - (S.streak[a.key] || 0))
    .slice(0, ECON.specialization.maxActive)
    .map(sp => sp.key);

  const gained = qualified.filter(k => S.active.indexOf(k) < 0);
  const lost = S.active.filter(k => qualified.indexOf(k) < 0);
  S.active = qualified;
  return { active: S.active.slice(), gained, lost, scores };
}

export function isSpecialized(key) { return S.active.indexOf(key) >= 0; }
export function activeSpecializations() { return S.active.map(k => SPEC_BY_KEY[k]).filter(Boolean); }

/* The bonuses a specialization confers. Applied by sim.js to production and by
   this module to trade priority. */
export function specBonusFor(resId) {
  if (!S.active.length) return { prod: 1, eff: 1, trade: 1 };
  const E = ECON.specialization;
  for (const key of S.active) {
    const sp = SPEC_BY_KEY[key];
    if (!sp) continue;
    if (sp.tests.indexOf(resId) >= 0) {
      return { prod: 1 + E.prodBonus, eff: 1 + E.effBonus, trade: 1 + E.tradeBonus };
    }
  }
  return { prod: 1, eff: 1, trade: 1 };
}

/* ════════════════════════════════════════════════════════════════════════════
   🌍 PARTNERS
   ----------------------------------------------------------------------------
   A partner is another city: {id, name, nodeId, specs[], sells{}, buys{}}.
   `setPartners()` takes REAL ones from the host when the network has them.
   `simulatedPartners()` derives plausible ones from node ids so the trade layer
   works solo — and they are derived from the SAME endowment function real nodes
   use, so a simulated neighbour is never something a real node could not be.
   ════════════════════════════════════════════════════════════════════════════ */
export function setPartners(list) {
  S.partners = Array.isArray(list) ? list.filter(p => p && p.id) : [];
  return S.partners.length;
}

export function simulatedPartners(seedNodeId, n) {
  const out = [];
  const count = Math.max(1, n || 4);
  for (let i = 0; i < count; i++) {
    const nodeId = 'sim:' + String(seedNodeId || 'node') + ':' + i;
    out.push(refreshPartner({ id: nodeId, nodeId, simulated: true, name: partnerName(nodeId), specs: [] }));
  }
  return out;
}

/* 🔄 A PARTNER'S CAPACITY REFILLS EVERY DAY, AND IT MUST.
   `match()` decrements `sells` and `buys` as trades clear — that is correct
   WITHIN a day, so one partner cannot supply the same tonne twice. But nothing
   refilled them, so after the first day or two every simulated city had bought
   and sold everything it would ever trade and the entire export economy was
   silently dead: offers sat unmatched forever, export revenue stayed at zero,
   and the only thing moving the treasury was the payout draining it.

   These are other CITIES. They keep producing and keep needing things. Their
   daily capacity is derived from the same endowment the player's node uses, so
   a simulated neighbour can never offer something a real node could not. */
export function refreshPartner(p) {
  const nodeId = p.nodeId || p.id;
  const strengths = Endow.strengths(nodeId);
  const gaps = Endow.strategicGaps(nodeId);
  p.sells = {}; p.buys = {};
  for (const id of strengths.slice(0, 6)) p.sells[id] = Endow.extractRate(nodeId, id) * 4;
  /* A city buys what it structurally cannot make, plus the everyday goods any
     city consumes — otherwise partners only ever want raw ore and a player who
     built a bakery has nobody to sell bread to. */
  for (const id of gaps.slice(0, 5)) p.buys[id] = 60;
  for (const id of ['bread', 'packagedFood', 'preparedMeals', 'clothing', 'medicine',
                    'electricity', 'freshWater', 'steel', 'lumber', 'concrete',
                    'boosterPacks', 'furniture']) {
    p.buys[id] = (p.buys[id] || 0) + 25;
  }
  return p;
}

/* Refill every simulated partner. Real (networked) partners are left alone —
   their inventory is whatever the host last told us it was. */
export function refreshPartners() {
  for (const p of S.partners) if (p.simulated) refreshPartner(p);
}

/* Deterministic, pronounceable city names for simulated partners, so the trade
   panel reads like a map rather than like a list of hashes. */
const NAME_A = ['Green', 'Black', 'Iron', 'Ember', 'Ash', 'Stone', 'Gold', 'Sil', 'Red', 'North', 'Far', 'Deep'];
const NAME_B = ['haven', 'ridge', 'hold', 'reach', 'fall', 'gate', 'ford', 'crest', 'mere', 'vale', 'watch', 'span'];
export function partnerName(nodeId) {
  let h = 0;
  const s = String(nodeId);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  /* ⚠ `>>>` NOT `>>`. `h` is an unsigned 32-bit value, and for any id hashing
     above 2^31 the SIGNED shift returns a negative number — `negative % len` is
     negative in JS, indexes off the front of the array, and every such city was
     named "Stoneundefined". Same class of bug the endowment hash guards against
     with its own `>>> 0`. */
  return NAME_A[h % NAME_A.length] + NAME_B[(h >>> 5) % NAME_B.length];
}

/* ════════════════════════════════════════════════════════════════════════════
   📦 OFFERS
   ════════════════════════════════════════════════════════════════════════════ */

/* What this city should be SELLING: surplus of things it is good at. */
export function buildOffers(surplus, day) {
  S.offers = S.offers.filter(o => o.expiresDay > day);
  for (const id in surplus) {
    const units = surplus[id];
    if (!(units >= ECON.trade.minOffer)) continue;
    if (S.offers.some(o => o.res === id)) continue;
    if (S.offers.length >= ECON.trade.maxOpenOffers) break;
    const bonus = specBonusFor(id);
    S.offers.push({
      id: S.nextOfferId++, res: id, units,
      price: priceOf(id) * (1 + ECON.trade.spreadPct),
      priority: bonus.trade,
      expiresDay: day + ECON.trade.offerTtlDays,
    });
  }
  return S.offers.slice();
}

/* What this city must BUY: strategic gaps plus anything it is short of. */
export function buildWants(shortfall, nodeId, day) {
  S.wants = S.wants.filter(w => w.expiresDay > day);
  const gaps = new Set(Endow.strategicGaps(nodeId));
  for (const id in shortfall) {
    const units = shortfall[id];
    if (!(units > 0)) continue;
    if (S.wants.some(w => w.res === id)) continue;
    S.wants.push({
      id: S.nextOfferId++, res: id, units,
      /* A strategic gap is URGENT: this city cannot make it at all, ever. It
         outbids an ordinary shortfall, which is what makes a node's missing
         iron actually drive its trade behaviour. */
      urgent: gaps.has(id),
      maxPrice: priceOf(id) * (gaps.has(id) ? 1.6 : 1.15),
      expiresDay: day + ECON.trade.offerTtlDays,
    });
  }
  return S.wants.slice();
}

/* ── MATCHING ───────────────────────────────────────────────────────────────
   Match our wants against partner sells, and our offers against partner buys.
   Returns the trades that CLEARED, with freight already booked.

   ⚠ FREIGHT IS BOOKED HERE AND THE TRADE IS CUT TO WHAT FREIGHT ALLOWS.
     A trade the city cannot physically carry must not clear — otherwise
     logistics is a cosmetic number and "Buying something doesn't mean it
     magically appears" is untrue. */
export function match(cashAvailable, day) {
  const imports = [], exports_ = [];
  let spend = 0, revenue = 0;
  const hops = ECON.logistics.tradeHops;
  const carry = Logistics.throughput();

  // ── IMPORTS: satisfy our wants, urgent first.
  const wants = S.wants.slice().sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0));
  for (const w of wants) {
    let need = w.units;
    for (const p of S.partners) {
      if (need <= 0) break;
      const avail = (p.sells && p.sells[w.res]) || 0;
      if (avail <= 0) continue;
      /* A partner that specialises in this good sells it cheaper and clears
         first — the mechanical reward for specialising at all. */
      const specialist = (p.specs || []).some(k => (SPEC_BY_KEY[k] || {}).tests && SPEC_BY_KEY[k].tests.indexOf(w.res) >= 0);
      const unitPrice = priceOf(w.res) * (1 + ECON.trade.spreadPct) / (specialist ? ECON.trade.specPriority : 1);
      const freight = Logistics.costPerUnit(hops);
      const delivered = unitPrice + freight;
      if (delivered > w.maxPrice && !w.urgent) continue;

      let units = Math.min(need, avail);
      units = Math.min(units, Math.floor((cashAvailable - spend) / Math.max(0.01, delivered)));
      units = Math.floor(units * Math.max(0, Math.min(1, carry)));
      if (units <= 0) continue;

      Logistics.book(units, hops);
      const cost = units * delivered;
      spend += cost; need -= units;
      p.sells[w.res] = Math.max(0, avail - units);
      imports.push({ res: w.res, units, unitPrice: delivered, cost, from: p.id, fromName: p.name, urgent: !!w.urgent });
      S.lastImported[w.res] = (S.lastImported[w.res] || 0) + units;
    }
  }

  // ── EXPORTS: fill partner demand from our offers.
  for (const o of S.offers) {
    let have = o.units;
    for (const p of S.partners) {
      if (have <= 0) break;
      const want = (p.buys && p.buys[o.res]) || 0;
      if (want <= 0) continue;
      let units = Math.min(have, want);
      units = Math.floor(units * Math.max(0, Math.min(1, carry)));
      if (units <= 0) continue;

      Logistics.book(units, hops);
      /* The seller pays the freight out of the sale — so a bulk good shipped
         far can net almost nothing, which is why nobody exports gravel. */
      const gross = units * o.price;
      const freight = units * Logistics.costPerUnit(hops);
      const net = Math.max(0, gross - freight);
      revenue += net; have -= units;
      p.buys[o.res] = Math.max(0, want - units);
      exports_.push({ res: o.res, units, gross, freight, net, to: p.id, toName: p.name });
      S.lastExported[o.res] = (S.lastExported[o.res] || 0) + units;
    }
    o.units = have;
  }
  S.offers = S.offers.filter(o => o.units > 0);

  S.lastImportSpend = spend;
  S.lastExportRevenue = revenue;
  return { imports, exports: exports_, spend, revenue };
}

export function beginDay() { S.lastImported = {}; S.lastExported = {}; S.lastImportSpend = 0; S.lastExportRevenue = 0; }

export function report(nodeId) {
  return {
    active: activeSpecializations(),
    streaks: { ...S.streak },
    offers: S.offers.slice(), wants: S.wants.slice(),
    partners: S.partners.map(p => ({ id: p.id, name: p.name, simulated: !!p.simulated, specs: p.specs || [] })),
    imported: { ...S.lastImported }, exported: { ...S.lastExported },
    importSpend: S.lastImportSpend, exportRevenue: S.lastExportRevenue,
    gaps: Endow.strategicGaps(nodeId), strengths: Endow.strengths(nodeId).slice(0, 8),
  };
}

export function serialize() {
  return { v: 1, streak: { ...S.streak }, active: S.active.slice(), nextOfferId: S.nextOfferId };
}
export function load(raw) {
  if (!raw || typeof raw !== 'object') return;
  S.streak = (raw.streak && typeof raw.streak === 'object') ? { ...raw.streak } : {};
  S.active = Array.isArray(raw.active) ? raw.active.filter(k => SPEC_BY_KEY[k]) : [];
  S.nextOfferId = Math.max(1, raw.nextOfferId | 0 || 1);
}

export default { SPECIALIZATIONS, updateSpecializations, match, buildOffers, buildWants, report };
