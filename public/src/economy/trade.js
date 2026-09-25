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
import { INDUSTRIES, industryOf, DEPOSITS, producible } from './recipes.js';
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
  /* 🤝 SETTLED REMOTE FILLS waiting to be booked into the city.
     A fill is confirmed OUTSIDE the economic day (the host awaits an RPC), and
     nothing may move Cinder or goods out there — sim.js captures the audit
     window's `before` at the top of runDay(), so a debit taken between two ticks
     is a debit nobody counted. See `recordFill()`. */
  settled: [],
  settleLog: { requested: 0, filled: 0, credited: 0, rejected: 0, reasons: {} },
};

export function state() { return S; }
export function reset() {
  S.streak = {}; S.active = []; S.offers = []; S.wants = []; S.partners = [];
  S.nextOfferId = 1; S.lastImported = {}; S.lastExported = {};
  S.lastImportSpend = 0; S.lastExportRevenue = 0;
  /* ⚠ EVERY NEW FIELD MUST BE CLEARED HERE. run.mjs round 0m fingerprints
     Trade.state() after reset() and fails on any field that survives a churn of
     dissimilar cities — that round exists because logistics.js forgot exactly
     one field and quietly invalidated measurement across the whole gate. */
  S.settled = [];
  S.settleLog = { requested: 0, filled: 0, credited: 0, rejected: 0, reasons: {} };
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

/* 🔢 EVERY NUMBER THAT CROSSES THE BRIDGE IS SUSPECT UNTIL IT IS FINITE.
   Remote rows are written by other players' clients. A NaN or an Infinity in
   `sells` does not throw — it propagates through match() into `spend`, into the
   treasury, and out through the audit as an un-diagnosable failure three days
   later. Same class as the freight NaN round 1 of the gate was written for. */
const fin = (v) => {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  /* A numeric STRING is legitimate and has to pass: PostgREST hands `numeric`
     columns back as strings on some deployments, so '25' really is 25 units.
     ⚠ ANY OTHER TYPE IS NOT A QUANTITY, and this is not pedantry — a bare
       `Number(v)` turns `true` into 1, and the gate caught exactly that:
       `{ filled: true }` credited one unit of steel. `true` is not a quantity,
       an array is not a quantity, and neither may move goods. */
  if (typeof v === 'string' && v.trim() !== '') { const n = Number(v); return isFinite(n) ? n : 0; }
  return 0;
};

/* An inventory map off the wire: positive finite quantities, catalogued ids
   only. `producible()` is both the validity test and the width bound — an id
   this build has never heard of cannot be traded anyway, and the catalogue is
   258 entries, so a row claiming a hundred thousand keys cannot get through. */
function cleanInventory(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const id in raw) {
    if (!id || typeof id !== 'string') continue;
    if (!producible(id)) continue;
    const v = fin(raw[id]);
    if (v > 0) out[id] = v;
  }
  return out;
}

/* One remote city, shaped for `match()`. Returns null for a row that cannot be
   traded with at all — a partner with no id could never be settled against. */
export function normalizePartner(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id != null ? String(raw.id) : '';
  if (!id) return null;
  const nodeId = raw.nodeId != null ? String(raw.nodeId) : id;
  const p = {
    id, nodeId,
    name: (typeof raw.name === 'string' && raw.name.trim()) ? raw.name.trim() : partnerName(nodeId),
    /* Specs decide price priority in match(), so an unknown key must be dropped
       rather than carried: SPEC_BY_KEY[k] would be undefined and the specialist
       test would throw on `.tests`. */
    specs: Array.isArray(raw.specs) ? raw.specs.filter(k => typeof k === 'string' && SPEC_BY_KEY[k]) : [],
    sells: cleanInventory(raw.sells),
    buys: cleanInventory(raw.buys),
    /* 🔴 EXPLICITLY FALSE, NEVER MERELY ABSENT. refreshPartners() rewrites the
       inventory of every partner whose flag is truthy; a real city that arrived
       without the flag would read falsy today and be left alone — but the flag
       is also what the panel and the tests read to tell a real neighbour from a
       fabricated one, and "undefined" is not an answer. */
    simulated: !!raw.simulated,
    /* The rows a settlement can actually be filled against. Present only on
       real partners; a simulated city has no offer id because there is no row. */
    offers: normalizeOffers(raw.offers),
  };
  return p;
}

/* A remote city's open SELL offers. `offerId` is opaque here on purpose — this
   module never parses it, it only hands it back to the host to settle. */
function normalizeOffers(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const o of raw) {
    if (!o || typeof o !== 'object') continue;
    const offerId = o.offerId != null ? String(o.offerId) : '';
    const res = typeof o.res === 'string' ? o.res : '';
    const units = fin(o.units);
    if (!offerId || !res || !producible(res) || !(units > 0)) continue;
    out.push({ offerId, res, units, unitPrice: fin(o.unitPrice), urgent: !!o.urgent });
    if (out.length >= ECON.trade.maxOpenOffers) break;
  }
  return out;
}

/* 🌍 THE HOST HANDS OVER THE REAL NEIGHBOURS. This is the ONLY call the network
   path needs — matching, freight and pricing already work against a real
   partner exactly as they do against a fabricated one, because both are the
   same shape and always were.

   ⚠ REAL PARTNERS REPLACE REAL PARTNERS; SIMULATED ONES ARE KEPT.
     Two reasons, and the first is the important one:
       1. A city that discovers ONE real neighbour must not thereby lose the
          four it was trading with. Production is planned a day ahead from
          `exportInterest()` (see the note there — that chicken-and-egg deadlock
          idled half the city), so shrinking the partner list on the day a real
          city appears would cut the standing orders the plan was made against.
       2. Discovery returning zero rows is the OFFLINE case, and offline must
          keep working. Wiping the list there would leave the city with nobody
          to trade with until sim.js re-seeded it a day later.
     Dedupe is by id, so a re-discovery updates a partner in place rather than
     stacking a second copy of the same city. */
export function setPartners(list) {
  const incoming = [];
  const seen = new Set();
  for (const raw of (Array.isArray(list) ? list : [])) {
    const p = normalizePartner(raw);
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id); incoming.push(p);
  }
  const kept = S.partners.filter(p => p.simulated && !seen.has(p.id));
  S.partners = incoming.concat(kept);
  return S.partners.length;
}

/* 🛟 THE DEGRADE FLOOR. Called by the host when discovery failed, returned
   nothing, or was never possible (offline, signed out, migration not applied).
   Idempotent: with partners already on the books it does nothing, so a failing
   network poll can call it every day without churning the market.
   ⚠ The count mirrors what sim.js seeds on a cold day (`simulatedPartners(node,
     4)`). It reads ECON first so that adding `trade.simPartners` to the tuning
     table moves this without a code change; sim.js's own call site still holds
     its literal and would have to follow. */
export function ensureSimulated(nodeId) {
  if (S.partners.length) return 0;
  const n = ECON.trade.simPartners || 4;
  S.partners = simulatedPartners(nodeId, n);
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

/* ════════════════════════════════════════════════════════════════════════════
   🤝 SETTLEMENT AGAINST A REAL CITY — plan, confirm, book.
   ----------------------------------------------------------------------------
   THREE STEPS, AND THE MIDDLE ONE IS NOT IN THIS FILE.

     planFills()   here — what this city would like to buy, and from which row.
     the RPC       the HOST — `city_trade_fill(offer_id, units)`, next to Cloud
                   and Profile in index.html, because those are top-level
                   `const` over there and invisible to a module (the globals
                   trap, CLAUDE.md). Not one network call lives in this file and
                   none may be added; /src/trading/index.js documents the same
                   seam and the same reason.
     recordFill()  here — books EXACTLY what the server says was filled.

   🔴 CREDIT `filled`, NEVER WHAT WE ASKED FOR. This is the whole reason the
      fill is an RPC that takes `for update` on the row rather than a read
      followed by a write: two cities filling the last 40 units of one offer
      would otherwise both read 0 filled, both write 40, and the seller would
      ship 80. The lock makes the server's answer authoritative — and an
      authoritative answer is worth nothing if the client then credits its own
      request. `filled` is the ONLY quantity that may move goods here, and it is
      additionally clamped to what we asked for: a server (or a doctored proxy)
      answering 900 to a request for 40 does not get to hand this city 900.

   🔴 AND THE BOOKING HAPPENS INSIDE THE ECONOMIC DAY, NOT AT CONFIRMATION TIME.
      sim.js takes the audit's `before` at the top of runDay(). Anything that
      moved Cinder between two ticks is a movement nobody counted — that is
      precisely how firms.js minted 721,771 🔥 with a clean audit (see the
      charter note in sim.js). So a confirmed fill is QUEUED and drained by
      match(), where sim.js pays for it out of the treasury and books it to
      `flow.imports`, which the audit identity already subtracts.
   ════════════════════════════════════════════════════════════════════════════ */

/* What this city will pay per unit for a remote fill.
   ⚠ THE COUNTERPARTY OWNS `unit_price` ON THEIR OWN ROW. RLS lets a player
     write any price into their own offer, so an unclamped quote is two attacks
     at once: 0 is free goods forever, and 1e12 empties the treasury in one day.
     The band is the SAME spread the local path already trades inside — nothing
     new to tune, and no numeric literal here (Rule 4). A quote outside it is
     not refused (that would let a hostile row block trade); it is clamped, and
     the trade goes ahead at a price this city's own model can defend. */
export function fillPrice(res, quoted) {
  const local = priceOf(res);
  const lo = local * (1 - ECON.trade.spreadPct);
  const hi = local * (1 + ECON.trade.spreadPct) * ECON.trade.specPriority;
  const q = fin(quoted);
  if (!(q > 0)) return local * (1 + ECON.trade.spreadPct);
  return Math.max(lo, Math.min(hi, q));
}

/* Units already confirmed and waiting to be booked, per resource. Planning has
   to see these or a want gets ordered twice — once from the queue and once
   again the next day before the queue drains. */
function pendingUnits(res) {
  let n = 0;
  for (const s of S.settled) if (s.res === res) n += s.units;
  return n;
}

/* 📋 THE ORDER BOOK THIS CITY WOULD LIKE FILLED, urgent wants first.
   Returns [{offerId, res, units, unitPrice, partnerId, partnerName}] — plain
   data, all of it primitives, for the host to hand to the RPC one row at a
   time. Simulated partners are skipped: they have no row and no offer id, and
   they are already traded with locally inside match(). */
export function planFills(cashAvailable, day) {
  const out = [];
  const budget = Math.max(0, fin(cashAvailable));
  const freight = Logistics.costPerUnit(ECON.logistics.tradeHops);
  let spend = 0;
  const wants = S.wants.slice().sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0));
  for (const w of wants) {
    let need = fin(w.units) - pendingUnits(w.res);
    if (!(need > 0)) continue;
    for (const p of S.partners) {
      if (p.simulated || !Array.isArray(p.offers) || !p.offers.length) continue;
      for (const o of p.offers) {
        if (need <= 0) break;
        if (o.res !== w.res) continue;
        const price = fillPrice(o.res, o.unitPrice);
        const delivered = price + freight;
        if (delivered > w.maxPrice && !w.urgent) continue;
        const afford = Math.floor((budget - spend) / Math.max(0.01, delivered));
        const units = Math.floor(Math.min(need, o.units, afford));
        if (units <= 0) continue;
        out.push({ offerId: o.offerId, res: o.res, units, unitPrice: price,
                   partnerId: p.id, partnerName: p.name });
        spend += units * delivered;
        need -= units;
        /* The same bound the local offer book uses: how many open trade lines
           this city runs at once. Without it one hungry day could fire a
           hundred RPCs. */
        if (out.length >= ECON.trade.maxOpenOffers) return out;
      }
    }
  }
  return out;
}

/* 🧾 BOOK ONE CONFIRMED FILL. `row` is whatever the RPC returned, untouched —
   the host must NOT interpret it, because every interpretation is a chance to
   substitute the requested quantity for the filled one.
   Returns { credited, filled, reason }. `credited` is what this city will
   actually receive, and it is 0 for every failure shape:
     null / undefined row      the RPC returned nothing
     {} or a malformed row     no `filled` key at all
     filled: 0                 someone else took the last units (the race this
                               whole path exists to survive)
     filled: 'abc' / NaN /     not a number: fin() answers 0 and nothing moves
     Infinity / -3
   A throw or a timeout never reaches here at all — the host catches it and
   calls nothing, which credits nothing. That is the same outcome by
   construction rather than by another branch. */
export function recordFill(req, row) {
  S.settleLog.requested++;
  const reject = (why) => {
    S.settleLog.rejected++;
    S.settleLog.reasons[why] = (S.settleLog.reasons[why] || 0) + 1;
    return { credited: 0, filled: 0, reason: why };
  };
  if (!req || typeof req !== 'object') return reject('bad-request');
  const res = typeof req.res === 'string' ? req.res : '';
  const asked = fin(req.units);
  if (!res || !producible(res) || !(asked > 0)) return reject('bad-request');
  if (!row || typeof row !== 'object') return reject('no-row');
  /* PostgREST hands `numeric` back as a STRING on some deployments, so fin()
     goes through Number() rather than testing typeof — but 'abc' becomes NaN
     and NaN is not finite, so a non-numeric answer still credits nothing. */
  const filled = fin(row.filled);
  if (!(filled > 0)) return reject(row.filled === undefined ? 'no-fill' : 'zero-fill');

  // 🔴 THE INVARIANT. Never `asked`. Never `row.units`. Never `remaining`.
  const units = Math.min(filled, asked);

  S.settled.push({
    res, units,
    unitPrice: fillPrice(res, row.unit_price !== undefined ? row.unit_price : row.unitPrice),
    offerId: req.offerId != null ? String(req.offerId) : '',
    from: req.partnerId != null ? String(req.partnerId) : null,
    fromName: req.partnerName != null ? String(req.partnerName) : null,
  });
  S.settleLog.filled += filled;
  S.settleLog.credited += units;
  return { credited: units, filled, reason: 'ok' };
}

/* Everything confirmed since the last economic day, emptied. Called by match()
   and by nothing else — a second caller would book the same goods twice. */
function drainSettled() { const q = S.settled; S.settled = []; return q; }

/* Exposed for the panel and for tests. A queue that can only be READ here
   cannot be drained by accident. */
export function pendingSettlements() { return S.settled.map(s => ({ ...s })); }
export function settleStats() { return { ...S.settleLog, reasons: { ...S.settleLog.reasons } }; }

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

  /* ── 0. SETTLED REMOTE FILLS, FIRST AND UNCONDITIONALLY.
     These are already committed on the other city's row — `filled_units` went
     up when the RPC answered — so they are not a trade this city may decline
     today; they are a bill it has to pay. Hence they take the freight capacity
     and the cash budget ahead of the local matching below.

     ⚠ THEY ARE NOT CUT TO `carry` LIKE A LOCAL TRADE IS. Cutting a settled fill
       would take 40 units off the seller's row and land 20 here: goods deleted
       from the world to keep a haulage number tidy. The freight IS booked, so
       an over-committed day shows up as congestion (which raises everyone's
       costs the next day) rather than as vanished cargo — the honest signal.
     ⚠ IF THE TREASURY CANNOT COVER IT, sim.js scales the whole day's imports
       pro rata (`importPaid / spend`) and the units land reduced. Value is
       conserved either way; the city just gets a part load. */
  for (const s of drainSettled()) {
    const freight = Logistics.costPerUnit(hops);
    const delivered = s.unitPrice + freight;
    Logistics.book(s.units, hops);
    const cost = s.units * delivered;
    spend += cost;
    imports.push({ res: s.res, units: s.units, unitPrice: delivered, cost,
                   from: s.from, fromName: s.fromName, urgent: false, settled: true,
                   offerId: s.offerId });
    S.lastImported[s.res] = (S.lastImported[s.res] || 0) + s.units;
    /* Satisfy the want it was ordered against, so the local pass below does not
       buy the same shortfall a second time from a simulated neighbour. */
    for (const w of S.wants) if (w.res === s.res) { w.units = Math.max(0, w.units - s.units); break; }
  }

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

/* 📤 STANDING EXPORT INTEREST for one resource: how many units per day the
   partners this city can reach would take off its hands.
   ----------------------------------------------------------------------------
   🔴 THIS BREAKS A CHICKEN-AND-EGG DEADLOCK, AND WITHOUT IT HALF THE CITY IDLES.
   Production is planned from demand, and demand was only ever counted from
   REALISED sales. An extractor with no local customer therefore produced
   nothing → held no stock → had nothing to offer → made no exports → recorded
   no demand → produced nothing. A copper mine on a copper-rich node sat dark
   forever while four neighbouring cities were openly asking to buy copper.

   A business produces for the orders it can SEE, and a partner's standing
   interest is an order. This is what actually makes a node's seams worth
   owning, and it is the mechanism behind specialising at all: you mine copper
   because someone will buy copper, not because you personally need it. */
export function exportInterest(resId) {
  let n = 0;
  for (const p of S.partners) n += (p.buys && p.buys[resId]) || 0;
  return n;
}

export function report(nodeId) {
  return {
    active: activeSpecializations(),
    streaks: { ...S.streak },
    offers: S.offers.slice(), wants: S.wants.slice(),
    partners: S.partners.map(p => ({ id: p.id, name: p.name, simulated: !!p.simulated,
                                     specs: p.specs || [], offers: (p.offers || []).length })),
    real: S.partners.filter(p => !p.simulated).length,
    imported: { ...S.lastImported }, exported: { ...S.lastExported },
    importSpend: S.lastImportSpend, exportRevenue: S.lastExportRevenue,
    settle: settleStats(), pending: S.settled.length,
    gaps: Endow.strategicGaps(nodeId), strengths: Endow.strengths(nodeId).slice(0, 8),
  };
}

/* ⚠ PARTNERS AND SETTLEMENTS ARE DELIBERATELY NOT SAVED.
   Partners are re-discovered (or re-simulated) on the first day after a load,
   so a save can never resurrect a neighbour that has since changed hands or
   gone. And a confirmed-but-undrained fill is dropped on reload: the goods are
   not credited and the Cinder is not spent, which loses the player a part load.
   The alternative direction is far worse — a queue that survives a reload is a
   queue that can be drained twice, and that credits goods nobody paid for.
   Lose it, never duplicate it. */
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
