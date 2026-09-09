/* ════════════════════════════════════════════════════════════════════════════
   🐄 HOMESTEAD FARM — state, simulation and every mutator.
   ----------------------------------------------------------------------------
   Pure over a `host` adapter (see index.js makeHost): this file never touches
   window, Profile or the DOM, so a node harness can drive the whole economy
   with a fake host and diff the ledger (tools/farm_harness.mjs does).

   State shape, persisted at Profile.farm through the bridge:
     {
       v: 2, ts, seed,
       buildings: { [defId]: { level, builtAt, feed, simAt, lastCollect, accrual: {resId: float}, damaged } },
       animals:   [ { id, sp, name, ageH, grownH, hungry, health, breed, born } ],
       seq, eventAt, journal: [ {t, kind, icon, text} ], stats: {...},
       demand: { day, used }, look: { ground, sky, decor, roofs, name },
     }
     ageH   = REAL hours lived (old age, the prize ribbon, the card's "Age").
     grownH = FED hours (growth, weight, adulthood). v1 saves stored only
              ageH-as-fed-hours; ensureState migrates them.

   ⏱ THE SIMULATION IS DETERMINISTIC AND OFFLINE. Nothing ticks in the
   background: every read calls simulate() first, which advances each pen from
   its `simAt` to now using only the feed that was in the trough, then replays
   every 6h event window the farm slept through with a seeded RNG. A 3-day
   absence and a 3-second one are the same code path.

   🔴 SPENDING IS ATOMIC OR REFUNDED. spendCost() takes resource legs first and
   Cinder last, and unwinds every taken leg with host.refundRes (UNCAPPED). A
   save failure after a spend is turned back into an exception so the same
   unwind runs, and the in-memory state is restored from a snapshot.

   🔴 EVENTS ARE THE ONE PLACE A *READ* WRITES. A replayed window can add loot
   to the ledger or remove an animal; if that were not persisted at once the
   next reload would replay the same window (double gift, double loss). So
   simulate() reports `changed` and summary() records when it is set.
   ════════════════════════════════════════════════════════════════════════════ */

import {
  FARM_ECON, FARM_ANIMALS, FARM_BUILDINGS, FARM_LOOKS, animalDef, buildingDef, penFor, buildingCostAt,
} from './farm.data.js';
import { rngFor, pickWeighted, seasonFor, weatherAt, eventWindowsBetween, defaultName, rivalName, hash32 } from './farm.events.js';

const H = 3600000;
const DAY = 86400000;

/* ── State ─────────────────────────────────────────────────────────────────── */
export function ensureState(host) {
  let s = host.state();
  if (!s || typeof s !== 'object') s = {};
  const v1 = s.v === 1;
  s.v = 2;
  if (!s.buildings || typeof s.buildings !== 'object') s.buildings = {};
  if (!Array.isArray(s.animals)) s.animals = [];
  if (typeof s.seq !== 'number') s.seq = 1;
  if (typeof s.ts !== 'number') s.ts = 0;
  if (typeof s.seed !== 'string' || !s.seed) s.seed = 'f' + Math.floor(Math.random() * 1e9).toString(36) + Date.now().toString(36);
  if (typeof s.eventAt !== 'number') s.eventAt = Date.now();
  if (!Array.isArray(s.journal)) s.journal = [];
  if (!s.stats || typeof s.stats !== 'object') s.stats = {};
  if (!Array.isArray(s.shipments)) s.shipments = [];
  s.shipments = s.shipments.filter(x => x && animalDef(x.sp) && (x.n | 0) > 0).map(x => ({ id: x.id | 0, sp: x.sp, n: x.n | 0, carrier: String(x.carrier || ''), label: String(x.label || ''), departAt: Number(x.departAt) || 0, arriveAt: Number(x.arriveAt) || 0, fee: x.fee | 0, price: x.price | 0, risk: Number(x.risk) || 0, insured: Number(x.insured) || 0, escort: x.escort | 0 }));
  ['births', 'slaughtered', 'meat', 'raidsRepelled', 'raidsLost', 'predatorsRepelled', 'lost', 'died', 'abducted', 'returned', 'delivered', 'crated', 'shipped', 'lostInTransit', 'built', 'outbreaks', 'cured', 'contractsDone', 'contractsFailed', 'auctions', 'auctionValue'].forEach(k => { if (typeof s.stats[k] !== 'number') s.stats[k] = 0; });
  if (!s.demand || typeof s.demand !== 'object') s.demand = { day: 0, used: 0 };
  if (!s.contracts || typeof s.contracts !== 'object') s.contracts = { week: 0, offers: [], active: [], rep: 0 };
  if (!Array.isArray(s.contracts.offers)) s.contracts.offers = [];
  if (!Array.isArray(s.contracts.active)) s.contracts.active = [];
  s.contracts.rep = Math.max(FARM_ECON.contracts.repMin, Math.min(FARM_ECON.contracts.repMax, s.contracts.rep | 0));
  if (!s.collection || typeof s.collection !== 'object') s.collection = {};
  if (!s.collectionRewarded || typeof s.collectionRewarded !== 'object') s.collectionRewarded = {};
  if (!Array.isArray(s.lots)) s.lots = [];
  if (!Array.isArray(s.holding)) s.holding = [];      // beasts that came back (claimed lots) with no room in the pen yet
  s.holding = s.holding.filter(a => a && animalDef(a.sp));
  s.lots = s.lots.filter(l => l && l.animal && animalDef(l.animal.sp));
  s.look = normalizeLook(s.look);
  Object.keys(s.buildings).forEach(id => {
    const b = s.buildings[id];
    if (!b || typeof b !== 'object' || !buildingDef(id)) { delete s.buildings[id]; return; }
    b.level = Math.max(1, b.level | 0);
    b.feed = Math.max(0, Number(b.feed) || 0);
    b.simAt = Number(b.simAt) || Date.now();
    b.lastCollect = Number(b.lastCollect) || 0;
    b.damaged = !!b.damaged;
    b.readyAt = Number(b.readyAt) || 0;          // 0 = finished (v2 saves predate construction)
    b.constructing = !!b.constructing && b.readyAt > 0;
    b.pendingLevel = (b.pendingLevel | 0) > b.level ? (b.pendingLevel | 0) : 0;
    if (!b.accrual || typeof b.accrual !== 'object') b.accrual = {};
  });
  s.animals = s.animals.filter(a => a && animalDef(a.sp)).map(a => {
    const fed = Math.max(0, Number(v1 ? a.ageH : a.grownH) || 0);
    return {
      id: a.id | 0, sp: a.sp,
      name: (typeof a.name === 'string' && a.name.trim()) ? a.name.trim().slice(0, 24) : defaultName(a.sp, a.id | 0),
      ageH: Math.max(0, Number(v1 ? a.ageH : a.ageH) || 0),
      grownH: fed,
      hungry: Math.max(0, Number(a.hungry) || 0),
      health: (typeof a.health === 'number') ? Math.max(0, Math.min(100, a.health)) : 100,
      breed: (typeof a.breed === 'string' && FARM_ECON.breeds[a.breed]) ? a.breed : null,
      born: Number(a.born) || 0,
      ill: (typeof a.ill === 'string' && FARM_ECON.disease.kinds[a.ill]) ? a.ill : null,
      illSince: Number(a.illSince) || 0,
      away: a.away | 0,                       // shipment id this guard is escorting, else 0
    };
  });
  return s;
}
export function normalizeLook(look) {
  const d = FARM_LOOKS.defaults;
  const o = (look && typeof look === 'object') ? look : {};
  const out = {
    ground: FARM_LOOKS.ground[o.ground] ? o.ground : d.ground,
    sky: FARM_LOOKS.sky[o.sky] ? o.sky : d.sky,
    decor: Object.assign({}, d.decor),
    roofs: {},
    name: (typeof o.name === 'string') ? o.name.slice(0, 28) : '',
  };
  if (o.decor && typeof o.decor === 'object') Object.keys(FARM_LOOKS.decor).forEach(k => { if (typeof o.decor[k] === 'boolean') out.decor[k] = o.decor[k]; });
  if (o.roofs && typeof o.roofs === 'object') Object.keys(o.roofs).forEach(k => { if (buildingDef(k) && /^#[0-9a-fA-F]{6}$/.test(String(o.roofs[k]))) out.roofs[k] = String(o.roofs[k]).toLowerCase(); });
  return out;
}

/* 💾 The one write path. THROWS on a failed persist so refunds are reachable. */
function record(host, s) {
  s.ts = Date.now();
  if (host.setState(s) === false) throw new Error('farm: setState failed');
  if (host.save() === false) throw new Error('farm: save failed');
}
function journal(s, kind, icon, text, now) {
  s.journal.unshift({ t: now || Date.now(), kind, icon, text: String(text).slice(0, 220) });
  if (s.journal.length > 40) s.journal.length = 40;
}

/* ── Reads ─────────────────────────────────────────────────────────────────── */
export function building(s, id) { return s.buildings[id] || null; }
export function has(s, id) { return !!building(s, id); }
export function animalsOf(s, sp) { return s.animals.filter(a => a.sp === sp); }
export function animalById(s, id) { return s.animals.find(a => a.id === (id | 0)) || null; }
export function animalsInPen(s, penId) {
  const def = buildingDef(penId);
  if (!def || !def.houses) return [];
  return s.animals.filter(a => def.houses.indexOf(a.sp) >= 0);
}
export function econOf(a) { return FARM_ECON.animals[a.sp] || null; }
export function isAdult(a) { const d = econOf(a); return !!d && a.grownH >= d.growH; }
export function isGuard(a) { const d = animalDef(a.sp); return !!(d && d.guard); }
export function isSick(a) { return a.health < FARM_ECON.health.sickBelow; }
/* Health → output factor: 0 when sick, then 0.5 → 1 across the healthy band. */
export function healthFactor(a) {
  const sb = FARM_ECON.health.sickBelow;
  if (a.health < sb) return 0;
  return 0.5 + 0.5 * (a.health - sb) / (100 - sb);
}
export function breedOf(a) { return a.breed ? FARM_ECON.breeds[a.breed] : null; }
export function yieldMul(a) { const b = breedOf(a); let m = b ? b.yieldMul : 1; if (a.ill) m *= FARM_ECON.disease.yieldMul; return m; }
export function tierOf(a) { const b = breedOf(a); return b ? b.tier : null; }
/* 🦠 */
export function isIll(a) { return !!a.ill; }
export function diseaseFor(sp, rnd) {
  const ks = Object.keys(FARM_ECON.disease.kinds).filter(k => FARM_ECON.disease.kinds[k].species.indexOf(sp) >= 0);
  return ks.length ? ks[Math.floor((rnd ? rnd() : Math.random()) * ks.length)] : null;
}
/* Weight in kg: 15% of adult at birth → adult at growH → creeps to max. */
export function weightOf(a) {
  const e = econOf(a); if (!e) return 0;
  const g = Math.min(1, a.grownH / e.growH);
  let w = e.adultWeight * (0.15 + 0.85 * g);
  if (a.grownH > e.growH) w += (e.maxWeight - e.adultWeight) * Math.min(1, (a.grownH - e.growH) / (e.growH * 2));
  // A starved or sick animal is a lighter one.
  w *= 0.75 + 0.25 * (a.health / 100);
  return Math.round(w * 10) / 10;
}
export function penCapacity(s, penId, host) {
  const def = buildingDef(penId), b = building(s, penId);
  if (!(def && b && typeof def.capacity === 'function')) return 0;
  let cap = def.capacity(b.level);
  if (host && penId === 'pasture' && terroirTier(host) === 'BARREN') cap = Math.max(1, cap - FARM_ECON.terroirBarrenCapLoss);
  return cap;
}
/* 🏗 A building under construction exists on the plot but cannot be used. */
export function isReady(s, id, now) { const b = building(s, id); return !!b && !(b.constructing && b.readyAt > (now || Date.now())); }
export function buildProgress(s, id, now) {
  const b = building(s, id); now = now || Date.now();
  if (!b || !b.readyAt || b.readyAt <= now) return null;
  const total = b.readyAt - (b.startedAt || b.builtAt || now), left = b.readyAt - now;
  return { left, total, pct: total > 0 ? Math.max(0, Math.min(100, Math.round((1 - left / total) * 100))) : 0, upgrading: !b.constructing, toLevel: b.pendingLevel || b.level };
}
export function buildersBonus(host) {
  let n = 0; try { n = host.builders ? (host.builders() | 0) : 0; } catch (e) {}
  return Math.min(FARM_ECON.construction.builderCap, n * FARM_ECON.construction.perBuilder);
}
export function buildTimeMs(host, def, level) {
  const hs = Array.isArray(def.buildH) ? def.buildH : [1];
  const h = hs[Math.max(0, Math.min(hs.length - 1, (level | 0) - 1))];
  return Math.round(h * (1 - buildersBonus(host)) * H);
}
export function rushCost(s, id, now) {
  const p = buildProgress(s, id, now); if (!p) return 0;
  return Math.max(FARM_ECON.construction.rushMin, Math.ceil(p.left / 60000) * FARM_ECON.construction.rushCinderPerMin);
}
/* 🚚 Transport. */
export function inTransit(s, penId) {
  const def = buildingDef(penId); if (!def || !def.houses) return 0;
  return s.shipments.filter(x => def.houses.indexOf(x.sp) >= 0).reduce((a, x) => a + x.n, 0);
}
export function carriersFor(host) {
  const T = FARM_ECON.transport;
  const list = Object.keys(T.carriers).map(k => Object.assign({ id: k, own: false }, T.carriers[k]));
  try {
    const rig = host.bestRig && host.bestRig();
    if (rig && rig.id && T.ownRig[rig.id]) list.unshift(Object.assign({ id: 'own:' + rig.id, own: true, name: rig.name + ' (your rig)', emoji: rig.emoji || '🚚', feeBase: 0, feePerKg: 0, insured: 0, blurb: 'Your own truck. No fee; the trip depends on the rig.' }, T.ownRig[rig.id]));
  } catch (e) {}
  return list;
}
export function carrierById(host, id) { const L = carriersFor(host); return L.find(c => c.id === id) || L.find(c => c.id === FARM_ECON.transport.defaultCarrier) || L[0]; }
export function shipFee(carrier, sp, n) {
  const e = FARM_ECON.animals[sp]; if (!e || !carrier) return 0;
  const kg = e.adultWeight * FARM_ECON.transport.shipKgShare * Math.max(1, n | 0);
  return Math.round(carrier.feeBase + carrier.feePerKg * kg);
}
export function troughCap(s, penId) {
  const b = building(s, penId);
  return b ? FARM_ECON.troughCap + FARM_ECON.troughCapPerLevel * (b.level - 1) : 0;
}
export function terroirTier(host) { try { return (host.terroirTier && host.terroirTier('animalFeed')) || 'COMMON'; } catch (e) { return 'COMMON'; } }
export function grazeFactor(host, now) {
  const t = FARM_ECON.terroirGraze[terroirTier(host)] || FARM_ECON.grazeDiscount;
  const wx = weatherAt(seedOf(host), now); const se = seasonFor(now);
  return Math.min(1, t * (wx.grazeMul || 1) * (se.grazeMul || 1));
}
function seedOf(host) { try { const s = host.state(); return (s && s.seed) || 'farm'; } catch (e) { return 'farm'; } }
export function farmersBonus(host) {
  let n = 0; try { n = host.farmers() | 0; } catch (e) {}
  return Math.min(FARM_ECON.farmers.yieldCap, n * FARM_ECON.farmers.yieldPerFarmer);
}
/* Feed units this pen burns per hour with its current herd, now. */
export function feedDrawPerH(s, penId, host, now) {
  now = now || Date.now();
  const se = seasonFor(now), gf = host ? grazeFactor(host, now) : FARM_ECON.grazeDiscount;
  let d = 0;
  animalsInPen(s, penId).forEach(a => {
    const ad = animalDef(a.sp), e = econOf(a);
    if (!ad || !e) return;
    d += e.feedPerH * se.feedMul * (ad.ground ? gf : 1);
  });
  return d;
}
export function feedHoursLeft(s, penId, host) {
  const b = building(s, penId); if (!b) return 0;
  const d = feedDrawPerH(s, penId, host);
  return d > 0 ? b.feed / d : Infinity;
}
/* Full-pen hourly yield (healthy adults) — the accrual ceiling's basis. */
export function penRatePerH(s, penId, host, now) {
  const rate = {}; now = now || Date.now();
  const wx = weatherAt(seedOf(host || { state: () => s }), now);
  const fb = host ? farmersBonus(host) : 0;
  animalsInPen(s, penId).forEach(a => {
    if (!isAdult(a)) return;
    const hf = healthFactor(a); if (hf <= 0) return;
    const y = FARM_ECON.yieldsPerH[a.sp] || {};
    Object.keys(y).forEach(r => {
      let v = y[r] * hf * yieldMul(a) * (1 + fb);
      if (r === 'eggs' && typeof wx.eggMul === 'number') v *= wx.eggMul;
      rate[r] = (rate[r] || 0) + v;
    });
  });
  return rate;
}
export function guardDefense(s) {
  let d = 0;
  s.animals.forEach(a => {
    const e = econOf(a); if (!e || !e.defense || !isAdult(a) || a.away) return;
    d += e.defense * (a.health < FARM_ECON.health.guardHalfBelow ? 0.5 : 1);
  });
  return d;
}
export function penDefense(s, penId) {
  const b = building(s, penId);
  return guardDefense(s) + (b ? (b.level - 1) * FARM_ECON.fenceDefensePerLevel : 0);
}
export function collectReadyAt(host, s, penId) {
  const b = building(s, penId);
  return b ? (b.lastCollect || 0) + host.collectCdMs : 0;
}
export function pendingCollect(s, penId) {
  const b = building(s, penId); if (!b) return {};
  const out = {};
  Object.keys(b.accrual).forEach(r => { const n = Math.floor(b.accrual[r]); if (n > 0) out[r] = n; });
  return out;
}
/* The prize beast: per species, the oldest adult past prizeAgeMul × growH. */
export function prizeIds(s) {
  const out = new Set();
  FARM_ANIMALS.forEach(d => {
    if (d.guard) return;
    const e = FARM_ECON.animals[d.id];
    const list = animalsOf(s, d.id).filter(a => isAdult(a) && a.ageH >= e.growH * FARM_ECON.prizeAgeMul).sort((a, b) => b.ageH - a.ageH);
    if (list.length) out.add(list[0].id);
  });
  return out;
}
export function townOffer(s, now) {
  now = now || Date.now();
  const day = Math.floor(now / DAY);
  const offers = FARM_ECON.townDemand.offers;
  const i = hash32('town:' + s.seed + ':' + day) % offers.length;
  const used = (s.demand.day === day) ? (s.demand.used | 0) : 0;
  const perDay = demandPerDay(s);
  return Object.assign({ day, used, left: Math.max(0, perDay - used), perDay, rep: s.contracts ? s.contracts.rep | 0 : 0 }, offers[i]);
}
export function demandPerDay(s) {
  const rep = s.contracts ? (s.contracts.rep | 0) : 0;
  const table = FARM_ECON.contracts.demandPerDayAtRep;
  let best = FARM_ECON.townDemand.perDay;
  Object.keys(table).map(Number).sort((a, b) => a - b).forEach(k => { if (rep >= k) best = table[String(k)]; });
  return best;
}
/* 📜 Contracts: two seeded offers per week, accept up to maxActive. */
export function weekKey(now) { return Math.floor((now || Date.now()) / (7 * DAY)); }
export function contractOffers(s, now) {
  now = now || Date.now();
  const wk = weekKey(now);
  if (s.contracts.week !== wk) {
    s.contracts.week = wk; s.contracts.offers = [];
    const T = FARM_ECON.contracts, R = rngFor('contract:' + s.seed + ':' + wk);
    const used = new Set();
    for (let i = 0; i < T.offersPerWeek && used.size < T.templates.length; i++) {
      let idx = Math.floor(R() * T.templates.length); while (used.has(idx)) idx = (idx + 1) % T.templates.length; used.add(idx);
      const tpl = T.templates[idx]; const days = T.days[Math.floor(R() * T.days.length)];
      s.contracts.offers.push({ id: wk * 10 + i, give: Object.assign({}, tpl.give), get: Object.assign({}, tpl.get), days });
    }
  }
  return s.contracts.offers;
}
/* 🏛 Sale Ring. */
export function auctionOpen(now) {
  const d = new Date(now || Date.now()); const A = FARM_ECON.auction;
  return d.getDay() === A.dayOfWeek && d.getHours() >= A.hoursOpen[0] && d.getHours() < A.hoursOpen[1];
}
export function nextAuction(now) {
  const d = new Date(now || Date.now()); const A = FARM_ECON.auction;
  const x = new Date(d); x.setHours(A.hoursOpen[0], 0, 0, 0);
  let delta = (A.dayOfWeek - x.getDay() + 7) % 7; if (delta === 0 && x.getTime() + (A.hoursOpen[1] - A.hoursOpen[0]) * H <= d.getTime()) delta = 7;
  x.setDate(x.getDate() + delta); return x.getTime();
}
/* A beast's value in Cinder terms: price × weight share × line × prize. */
export function animalValue(s, a) {
  const e = econOf(a); if (!e) return 0;
  let v = e.cinder * Math.max(0.5, weightOf(a) / e.adultWeight);
  const tier = tierOf(a); if (tier && FARM_ECON.auction.priceMul[tier]) v *= FARM_ECON.auction.priceMul[tier];
  if (prizeIds(s).has(a.id)) v *= FARM_ECON.auction.priceMul.prize;
  return Math.round(v);
}
/* The seeded bid timeline of an NPC lot: who bid what, when. Pure. */
export function lotTimeline(lot) {
  const A = FARM_ECON.auction, R = rngFor('lot:' + lot.seed);
  const n = A.bidsMin + Math.floor(R() * (A.bidsMax - A.bidsMin + 1));
  const total = A.lotMinutes * 60000; const hammerMul = A.hammerRange[0] + R() * (A.hammerRange[1] - A.hammerRange[0]);
  const final = Math.round(lot.reserve * hammerMul);
  const bids = []; let cur = Math.round(lot.reserve * 0.7);
  for (let i = 0; i < n; i++) {
    const b = A.bidders[Math.floor(R() * A.bidders.length)];
    const at = lot.at + Math.round(total * (0.08 + 0.84 * (i + R() * 0.6) / n));
    cur = i === n - 1 ? final : Math.round(cur + (final - cur) * (0.3 + R() * 0.4));
    bids.push({ at, who: b.name, id: b.id, amount: cur });
  }
  const winner = bids[bids.length - 1];
  return { bids, hammerAt: lot.at + total, final, winner: winner.who, winnerId: winner.id, athena: A.athena[Math.floor(R() * A.athena.length)] };
}
export function lotPayout(final) {
  const out = {}; const P = FARM_ECON.auction.payoutPer1000;
  Object.keys(P).forEach(r => { out[r] = Math.max(1, Math.round(P[r] * final / 1000)); });
  return out;
}

/* ── Simulation ────────────────────────────────────────────────────────────── */
export function simulate(host, s, now, rnd) {
  now = now || Date.now();
  let changed = false;
  const se = seasonFor(now);
  const gf = grazeFactor(host, now);
  const wx = weatherAt(s.seed, now);
  const fb = farmersBonus(host);
  const capH = host.accrualCapH;
  const HL = FARM_ECON.health;

  // 🏗 Finish any construction / upgrade whose clock has run out.
  Object.keys(s.buildings).forEach(id => {
    const b = s.buildings[id];
    if (b.readyAt && b.readyAt <= now) {
      const def = buildingDef(id);
      if (b.constructing) { b.constructing = false; journal(s, 'build', '🏠', `The ${def.name} is finished.`, b.readyAt); s.stats.built++; changed = true; }
      if (b.pendingLevel > b.level) { b.level = b.pendingLevel; journal(s, 'build', '⬆', `The ${def.name} is now level ${b.level}.`, b.readyAt); changed = true; }
      b.pendingLevel = 0; b.readyAt = 0;
    }
  });
  // 🚚 Arrivals. Rolled with the shipment's own seed so two devices agree.
  const arrived = s.shipments.filter(x => x.arriveAt <= now);
  if (arrived.length) {
    s.shipments = s.shipments.filter(x => x.arriveAt > now);
    arrived.forEach(x => {
      const ad = animalDef(x.sp); const R = rngFor('ship:' + s.seed + ':' + x.id);
      let n = x.n, lostN = 0;
      const esc = x.escort ? animalById(s, x.escort) : null;
      let risk = x.risk;
      if (esc) { const e = econOf(esc); risk *= Math.max(FARM_ECON.escort.minRiskMul, 1 - (e && e.defense ? e.defense : 0) / FARM_ECON.escort.div); }
      if (risk > 0 && R() < risk) { lostN = Math.max(1, Math.round(n * 0.34)); n -= lostN; if (esc) esc.health = Math.max(1, esc.health - FARM_ECON.escort.woundOnHit); }
      if (esc) { esc.away = 0; journal(s, 'ship', '🐕', `${esc.name} rode back with the ${x.label} truck${lostN ? ', bloodied' : ''}.`, x.arriveAt); }
      const names = [];
      for (let i = 0; i < n; i++) { const a = newAnimal(s, x.sp, x.arriveAt); s.animals.push(a); names.push(a.name); }
      if (lostN) {
        s.stats.lostInTransit += lostN; s.stats.lost += lostN;
        const refund = Math.round((x.price / x.n) * lostN * (x.insured || 0));
        if (refund > 0) host.addGems(refund);
        journal(s, 'raid', '🛻', `${x.label} was hit on the road — ${lostN} ${lostN === 1 ? ad.name.toLowerCase() : ad.plural.toLowerCase()} lost.${refund ? ' Insurance paid back ' + refund.toLocaleString() + ' Cinder.' : ' No insurance.'}${n ? ' ' + n + ' arrived.' : ''}`, x.arriveAt);
      } else {
        journal(s, 'ship', '🚚', `${x.label} delivered ${n} ${n === 1 ? ad.name.toLowerCase() : ad.plural.toLowerCase()}${names.length ? ' — ' + names.slice(0, 3).join(', ') + (names.length > 3 ? '…' : '') : ''}.`, x.arriveAt);
      }
    });
    changed = true;
  }

  FARM_BUILDINGS.forEach(def => {
    if (!def.houses) return;
    const b = building(s, def.id); if (!b) return;
    if (b.constructing && b.readyAt > now) { b.simAt = now; return; }
    const hours = Math.max(0, (now - b.simAt) / H);
    /* ⏮ Never move the clock backwards. A device with a skewed clock (or a
       harness mixing fake time with Date.now()) must not rewind simAt and
       then re-live hours it already lived — that double-charged hunger. */
    if (hours <= 0) return;
    b.simAt = now;
    const herd = animalsInPen(s, def.id);
    if (!herd.length) return;

    // Rain fills the pasture trough a little (grass, really) per window it holds.
    if (def.id === 'pasture' && wx.troughWater && hours >= 1) b.feed = Math.min(troughCap(s, def.id), b.feed + wx.troughWater * Math.min(4, hours / FARM_ECON.weatherWindowH));

    let draw = 0;
    herd.forEach(a => { const ad = animalDef(a.sp), e = econOf(a); if (ad && e) draw += e.feedPerH * se.feedMul * (ad.ground ? gf : 1); });
    const fedH = draw > 0 ? Math.min(hours, b.feed / draw) : hours;
    const unfedH = Math.max(0, hours - fedH);
    b.feed = Math.max(0, b.feed - fedH * draw);

    const gained = {};
    const dead = [];
    // 🦠 Spread, then the clinic. Spread is per pen-mate per hour; the clinic
    // cures the longest-ill first, one medicine each, `cured/h` by level.
    const DZ = FARM_ECON.disease;
    const illNow = herd.filter(a => a.ill);
    if (illNow.length) {
      const R = rnd || rngFor('spread:' + s.seed + ':' + def.id + ':' + Math.floor(now / H));
      herd.forEach(a => {
        if (a.ill) return;
        const src = illNow.find(x => FARM_ECON.disease.kinds[x.ill].species.indexOf(a.sp) >= 0);
        if (!src) return;
        const p = 1 - Math.pow(1 - DZ.spreadPerH, Math.min(hours, 72));
        if (R() < p) { a.ill = src.ill; a.illSince = now; changed = true; }
      });
      const vet = building(s, 'vet');
      if (vet && !vet.constructing) {
        const cures = Math.floor(hours * DZ.vetCureHPerLevel * vet.level / DZ.cureH * 2);
        const queue = herd.filter(a => a.ill).sort((x, y) => x.illSince - y.illSince);
        for (let i = 0; i < Math.min(cures, queue.length); i++) {
          if (host.getRes('medicine') < DZ.vetMedicinePerCure) break;
          if (!host.spendRes('medicine', DZ.vetMedicinePerCure)) break;
          const a = queue[i]; journal(s, 'vet', '🩺', `The clinic cured ${a.name} of ${DZ.kinds[a.ill].label.toLowerCase()}.`, now);
          a.ill = null; a.illSince = 0; s.stats.cured++; changed = true;
        }
      }
    }
    herd.forEach(a => {
      const e = econOf(a); if (!e) return;
      if (a.ill) a.health -= hours * DZ.healthLossPerH;
      // Age is real time; growth is fed time.
      a.ageH += hours;
      const adultH = Math.max(0, fedH - Math.max(0, e.growH - a.grownH));
      a.grownH += fedH;
      // Hunger and healing.
      // Feed heals — unless the animal is ill: a sick beast does not mend on
      // its own however full the trough, which is what makes the clinic matter.
      if (fedH > 0) { a.hungry = Math.max(0, a.hungry - fedH * 2); if (!a.ill) a.health = Math.min(100, a.health + fedH * HL.healPerFedH); }
      if (unfedH > 0) {
        const before = a.hungry; a.hungry += unfedH;
        const painful = Math.max(0, a.hungry - Math.max(before, HL.hungerGraceH));
        if (painful > 0) a.health -= painful * HL.hungerLossPerH;
      }
      if (a.ageH > e.lifeH) a.health -= hours * HL.oldAgeLossPerH;
      a.health = Math.max(0, Math.min(100, a.health));
      if (a.health <= 0) { dead.push(a); return; }
      if (b.damaged || adultH <= 0) return;
      const hf = healthFactor(a); if (hf <= 0) return;
      const y = FARM_ECON.yieldsPerH[a.sp] || {};
      Object.keys(y).forEach(r => {
        let v = y[r] * adultH * hf * yieldMul(a) * (1 + fb);
        if (r === 'eggs' && typeof wx.eggMul === 'number') v *= wx.eggMul;
        gained[r] = (gained[r] || 0) + v;
      });
    });
    if (dead.length) {
      const ids = new Set(dead.map(a => a.id));
      s.animals = s.animals.filter(a => !ids.has(a.id));
      dead.forEach(a => { const d = animalDef(a.sp); journal(s, 'death', '🪦', `${a.name} the ${d.name.toLowerCase()} died${a.ageH > (econOf(a).lifeH) ? ' of old age' : ' of neglect'}.`, now); s.stats.died++; });
      changed = true;
    }
    const rate = penRatePerH(s, def.id, host, now);
    Object.keys(gained).forEach(r => {
      const ceiling = (rate[r] || 0) * capH;
      b.accrual[r] = Math.min(Math.max(ceiling, b.accrual[r] || 0), (b.accrual[r] || 0) + gained[r]);
    });

    // Breeding: two healthy adults of a species, a free stall, the season willing.
    if (!b.damaged && fedH > 0) {
      const cap = penCapacity(s, def.id, host);
      const R = rnd || rngFor('breed:' + s.seed + ':' + Math.floor(now / H));
      (def.houses || []).forEach(sp => {
        const ad = animalDef(sp); if (!ad || ad.guard) return;
        const adults = s.animals.filter(a => a.sp === sp && isAdult(a) && !isSick(a)).length;
        if (adults < 2) return;
        const p = (FARM_ECON.breedChancePerH[sp] || 0) * se.breedMul;
        let trials = Math.min(200, Math.floor(fedH)), frac = fedH - Math.floor(fedH), births = 0;
        for (let i = 0; i < trials; i++) if (R() < p) births++;
        if (R() < p * frac) births++;
        for (let i = 0; i < births; i++) {
          if (animalsInPen(s, def.id).length >= cap) break;
          // 🧬 Lines: pick two adult parents; their tiers decide the child's.
          const parents = s.animals.filter(a => a.sp === sp && isAdult(a) && !isSick(a));
          const p1 = parents[Math.floor(R() * parents.length)], p2 = parents[Math.floor(R() * parents.length)];
          const L = FARM_ECON.lines; const t1 = p1 ? tierOf(p1) : null, t2 = p2 ? tierOf(p2) : null;
          let breed = null;
          if (t1 === 'royal' && t2 === 'royal' && R() < L.mythicChance) breed = sp + ':mythic';
          else if ((t1 === 'rare' || t1 === 'royal') && (t2 === 'rare' || t2 === 'royal') && R() < L.royalChance) breed = sp + ':royal';
          else if ((t1 || t2) && R() < L.inheritRare) breed = sp;
          else if (R() < L.rareChance) breed = sp;
          const a = newAnimal(s, sp, now, breed);
          s.animals.push(a); s.stats.births++; changed = true;
          if (breed) noteCollection(host, s, breed, now);
          const B = breed ? FARM_ECON.breeds[breed] : null;
          journal(s, 'birth', breed ? (B.tier === 'mythic' ? '🌟' : B.tier === 'royal' ? '👑' : '✨') : '🐣', breed ? `A ${B.label} was born — ${a.name}! ${B.tier === 'mythic' ? 'The line is complete: ×5 yield.' : B.tier === 'royal' ? 'A royal line: ×3 yield.' : 'Double yield for life.'}` : `${a.name} the ${ad.name.toLowerCase()} was born.`, now);
        }
      });
    }
  });

  // ⚔ Replay every event window the farm slept through.
  const windows = eventWindowsBetween(s.eventAt, now);
  if (windows.length) {
    windows.forEach(w => { if (resolveWindow(host, s, w)) changed = true; if (rollOutbreaks(host, s, w)) changed = true; });
    s.eventAt = Math.max(s.eventAt, now);
  }
  // 🚧 Beasts waiting at the gate walk in when a stall opens.
  if (s.holding.length) {
    const keep = [];
    s.holding.forEach(a => {
      const pen = penFor(a.sp);
      if (pen && has(s, pen.id) && isReady(s, pen.id, now) && penCapacity(s, pen.id, host) - animalsInPen(s, pen.id).length - inTransit(s, pen.id) >= 1) { s.animals.push(a); journal(s, 'ship', '🚪', `${a.name} walked in from the gate.`, now); changed = true; }
      else keep.push(a);
    });
    s.holding = keep;
  }
  // 🧬 Any breed on the farm counts for the collection (covers migrated saves).
  s.animals.forEach(a => { if (a.breed && !s.collection[a.breed]) { noteCollection(host, s, a.breed, now); changed = true; } });
  // 📜 Contracts past their deadline fail: reputation drops, the town demands less.
  const failed = s.contracts.active.filter(c => c.deadline <= now);
  if (failed.length) {
    s.contracts.active = s.contracts.active.filter(c => c.deadline > now);
    failed.forEach(c => {
      s.contracts.rep = Math.max(FARM_ECON.contracts.repMin, s.contracts.rep - FARM_ECON.contracts.repHit); s.stats.contractsFailed++;
      journal(s, 'contract', '📜', `Missed the town's contract (${Object.keys(c.give).map(k => c.give[k] + ' ' + k).join(', ')}). Reputation ${s.contracts.rep}: the town now takes ${demandPerDay(s)} deliveries a day.`, c.deadline);
    });
    changed = true;
  }
  contractOffers(s, now);
  // 🏛 Lots whose hammer has fallen pay out in goods.
  const done = s.lots.filter(l => !l.p2p && lotTimeline(l).hammerAt <= now);
  if (done.length) {
    s.lots = s.lots.filter(l => done.indexOf(l) < 0);
    done.forEach(l => {
      const tl = lotTimeline(l); const pay = lotPayout(tl.final);
      const { got } = deliver(host, pay);
      s.stats.auctions++; s.stats.auctionValue += tl.final;
      journal(s, 'auction', '🔨', `SOLD — ${l.animal.name} the ${animalDef(l.animal.sp).name.toLowerCase()} to ${tl.winner} for ${tl.final.toLocaleString()}: ${Object.keys(got).map(k => got[k] + ' ' + k).join(', ')}.`, tl.hammerAt);
    });
    changed = true;
  }
  return { changed };
}
/* 🦠 One outbreak roll per pen per window. Crowding and a thin fence raise it; the clinic halves it. */
function rollOutbreaks(host, s, w) {
  const DZ = FARM_ECON.disease; let changed = false;
  const vet = building(s, 'vet'); const vetCut = (vet && !vet.constructing) ? DZ.vetOutbreakCut : 1;
  FARM_BUILDINGS.forEach(def => {
    if (!def.houses) return; const b = building(s, def.id); if (!b) return;
    const herd = animalsInPen(s, def.id).filter(a => !a.ill); if (!herd.length) return;
    const R = rngFor('dz:' + s.seed + ':' + def.id + ':' + w.idx);
    const cap = penCapacity(s, def.id, host) || 1;
    let p = DZ.outbreakBase * vetCut;
    if (herd.length / cap >= DZ.crowdAbove) p *= DZ.crowdMul;
    p *= Math.max(0.3, 1 - DZ.penLevelCut * (b.level - 1));
    if (R() >= p) return;
    const a = herd[Math.floor(R() * herd.length)]; const k = diseaseFor(a.sp, R); if (!k) return;
    a.ill = k; a.illSince = w.at; s.stats.outbreaks++; changed = true;
    journal(s, 'disease', DZ.kinds[k].icon, `${DZ.kinds[k].label} in the ${def.name}: ${a.name} is sick${herd.length / cap >= DZ.crowdAbove ? ' — the pen is crowded' : ''}. It spreads by the hour; ${vet ? 'the clinic is on it' : 'treat it, or build a Vet Clinic'}.`, w.at);
  });
  return changed;
}
/* 🧬 The collection: every breed ever owned. A full tier pays once. */
function noteCollection(host, s, breed, now) {
  if (!breed || s.collection[breed]) return;
  s.collection[breed] = true;
  const B = FARM_ECON.breeds[breed]; if (!B || !B.tier || B.tier === 'glow') return;
  const tier = B.tier;
  const all = Object.keys(FARM_ECON.breeds).filter(k => FARM_ECON.breeds[k].tier === tier);
  if (all.every(k => s.collection[k]) && !s.collectionRewarded[tier]) {
    s.collectionRewarded[tier] = true;
    const { got } = deliver(host, FARM_ECON.lines.collectionReward[tier] || {});
    journal(s, 'collection', '🏆', `Collection complete — every ${tier} breed has lived on this farm. Reward: ${Object.keys(got).map(k => got[k] + ' ' + k).join(', ') || 'nothing fit in the stash'}.`, now);
  }
}

function newAnimal(s, sp, now, breed) {
  const id = s.seq++;
  return { id, sp, name: defaultName(sp, id), ageH: 0, grownH: 0, hungry: 0, health: 100, breed: breed || null, born: now, ill: null, illSince: 0, away: 0 };
}

/* One event window. Returns true when anything changed. */
function resolveWindow(host, s, w) {
  if (!s.animals.length) return false;
  const R = rngFor('ev:' + s.seed + ':' + w.idx);
  const wx = weatherAt(s.seed, w.at - 1);
  if (R() >= FARM_ECON.eventChance) return false;
  const kind = pickWeighted(R, FARM_ECON.events);
  const E = FARM_ECON.events[kind];
  const at = w.at;
  const stock = s.animals.filter(a => !isGuard(a));
  const penOf = (a) => animalDef(a.sp).pen;
  const wound = (a, n) => { a.health = Math.max(0, a.health - n); if (a.health <= 0) { s.animals = s.animals.filter(x => x.id !== a.id); return true; } return false; };
  const guards = s.animals.filter(isGuard);
  const hurtGuard = () => { if (!guards.length) return ''; const g = guards[Math.floor(R() * guards.length)]; wound(g, FARM_ECON.guardWound); return ` ${g.name} the ${animalDef(g.sp).name.toLowerCase()} took a bite.`; };
  const label = (a) => `${a.name} the ${animalDef(a.sp).name.toLowerCase()}`;

  if (kind === 'star') {
    Object.keys(E.gift).forEach(r => host.addRes(r, E.gift[r]));
    journal(s, 'gift', E.icon, `A shooting star came down in the field. The crater was full of rich soil: +${Object.values(E.gift)[0]} fertilizer.`, at);
    return true;
  }
  if (kind === 'storm') {
    const pens = FARM_BUILDINGS.filter(d => d.houses && s.buildings[d.id] && !s.buildings[d.id].damaged);
    if (!pens.length) return false;
    const p = pens[Math.floor(R() * pens.length)];
    s.buildings[p.id].damaged = true;
    journal(s, 'storm', E.icon, `A storm tore the roof off the ${p.name}. Nothing there produces until it is repaired.`, at);
    return true;
  }
  if (kind === 'ufo') {
    if (!stock.length) return false;
    const a = stock[Math.floor(R() * stock.length)];
    s.animals = s.animals.filter(x => x.id !== a.id);
    s.stats.abducted++;
    if (R() < E.returnChance) {
      a.breed = 'glow'; a.health = 100; a.hungry = 0; s.animals.push(a); s.stats.returned++;
      journal(s, 'ufo', E.icon, `Lights over the pasture. ${label(a)} vanished, then walked back out of the fog an hour later — glowing faintly. Yields have doubled and nobody wants to talk about it.`, at);
    } else {
      journal(s, 'ufo', E.icon, `Lights over the pasture. ${label(a)} rose into the sky and did not come back.`, at);
      s.stats.lost++;
    }
    return true;
  }
  // Predators and raids — something has to be beaten.
  let strength = E.strength[0] + R() * (E.strength[1] - E.strength[0]);
  let targets = stock;
  if (E.prey) targets = stock.filter(a => E.prey.indexOf(a.sp) >= 0);
  if (!targets.length) return false;
  const victim = targets[Math.floor(R() * targets.length)];
  const pen = penOf(victim);
  if (kind === 'raid' && wx.raidMul) strength *= wx.raidMul;
  const defense = penDefense(s, pen);
  if (kind === 'raid') {
    const who = rivalName(R, host.rivals ? host.rivals() : []);
    if (defense >= strength) {
      Object.keys(E.loot).forEach(r => host.addRes(r, E.loot[r]));
      s.stats.raidsRepelled++;
      journal(s, 'raid', '🛡', `${who} came for the ${buildingDef(pen).name} under ${wx.label.toLowerCase()} skies and met the guards. They ran, and dropped ${E.loot.supplies} supplies and ${E.loot.metal} metal on the way out.${hurtGuard()}`, at);
    } else {
      s.animals = s.animals.filter(x => x.id !== victim.id);
      s.stats.raidsLost++; s.stats.lost++;
      journal(s, 'raid', E.icon, `${who} raided the ${buildingDef(pen).name} in the ${wx.label.toLowerCase()} and took ${label(victim)}.${guards.length ? ' The guards were not enough.' : ' There was nobody to stop them.'}`, at);
    }
    return true;
  }
  // fox / hawk / wolves
  if (defense >= strength) {
    s.stats.predatorsRepelled++;
    journal(s, kind, '🛡', `${E.label === 'Wolves' ? 'Wolves' : 'A ' + E.label.toLowerCase()} tried the ${buildingDef(pen).name}. ${guards.length ? 'The guards drove ' + (E.label === 'Wolves' ? 'them' : 'it') + ' off.' : 'The fence held.'}${hurtGuard()}`, at);
  } else {
    const died = !isAdult(victim) || wound(victim, FARM_ECON.predatorWound);
    if (died) { s.animals = s.animals.filter(x => x.id !== victim.id); s.stats.lost++; }
    journal(s, kind, E.icon, `${E.label === 'Wolves' ? 'Wolves got' : 'A ' + E.label.toLowerCase() + ' got'} into the ${buildingDef(pen).name}. ${died ? label(victim) + ' was killed.' : label(victim) + ' was mauled and needs treatment.'}${guards.length ? '' : ' A guard dog would have changed that.'}`, at);
  }
  return true;
}

/* ── Cost handling ─────────────────────────────────────────────────────────── */
export function canAfford(host, cost) {
  if (!cost) return true;
  return Object.keys(cost).every(k => k === 'cinder' ? host.gems() >= (cost[k] | 0) : host.getRes(k) >= (cost[k] | 0));
}
export function shortfall(host, cost) {
  const out = {};
  if (!cost) return out;
  Object.keys(cost).forEach(k => {
    const have = k === 'cinder' ? host.gems() : host.getRes(k);
    if (have < (cost[k] | 0)) out[k] = (cost[k] | 0) - have;
  });
  return out;
}
export function spendCost(host, cost) {
  if (!cost) return { ok: true };
  if (!canAfford(host, cost)) return { ok: false, why: 'short', shortfall: shortfall(host, cost) };
  const taken = [];
  const unwind = () => { taken.forEach(([id, n]) => host.refundRes(id, n)); };
  const ids = Object.keys(cost).filter(k => k !== 'cinder' && (cost[k] | 0) > 0);
  for (const id of ids) {
    if (!host.spendRes(id, cost[id] | 0)) { unwind(); return { ok: false, why: 'spendRes failed: ' + id }; }
    taken.push([id, cost[id] | 0]);
  }
  const c = cost.cinder | 0;
  if (c > 0 && !host.spendGems(c)) { unwind(); return { ok: false, why: 'spendGems failed' }; }
  return { ok: true, undo: () => { unwind(); if (c > 0) host.addGems(c); } };
}
/* Run `mutate` then persist; on a persist failure undo the spend AND the
   in-memory state (snapshot). The harness caught the first cut leaving a
   refunded building in memory. */
function paid(host, s, cost, mutate) {
  const sp = spendCost(host, cost);
  if (!sp.ok) return sp;
  const snap = JSON.stringify(s);
  try {
    const r = mutate() || {};
    record(host, s);
    return Object.assign({ ok: true }, r);
  } catch (e) {
    try { if (sp.undo) sp.undo(); } catch (e2) {}
    try { const back = JSON.parse(snap); Object.keys(s).forEach(k => { delete s[k]; }); Object.assign(s, back); } catch (e3) {}
    return { ok: false, why: 'save failed — refunded' };
  }
}
/* Deliver a yield map into the ledger, reporting what actually landed. */
function deliver(host, want) {
  const got = {}; let clipped = false;
  Object.keys(want).forEach(r => {
    const n = Math.floor(want[r]); if (n <= 0) return;
    const before = host.getRes(r);
    host.addRes(r, n);
    const landed = Math.max(0, host.getRes(r) - before);
    if (landed < n) clipped = true;
    if (landed > 0) got[r] = landed;
  });
  return { got, clipped };
}

/* ── Mutators ──────────────────────────────────────────────────────────────── */
export function build(host, s, id) {
  const def = buildingDef(id);
  if (!def) return { ok: false, why: 'unknown building' };
  if (has(s, id)) return { ok: false, why: 'already built' };
  return paid(host, s, buildingCostAt(def, 1), () => {
    const now = Date.now(), ms = buildTimeMs(host, def, 1);
    s.buildings[id] = { level: 1, builtAt: now, startedAt: now, readyAt: now + ms, constructing: ms > 0, pendingLevel: 0, feed: 0, simAt: now, lastCollect: 0, accrual: {}, damaged: false };
    journal(s, 'build', '🏗', `Broke ground on the ${def.name} — ready in ${Math.round(ms / 60000)} min.`, now);
    return { built: id, readyAt: now + ms };
  });
}
export function upgrade(host, s, id) {
  const def = buildingDef(id), b = building(s, id);
  if (!def || !b) return { ok: false, why: 'not built' };
  if (b.level >= def.maxLevel) return { ok: false, why: 'max level' };
  if (b.readyAt > Date.now()) return { ok: false, why: 'crews are already working on it' };
  return paid(host, s, buildingCostAt(def, b.level + 1), () => {
    simulate(host, s);
    const now = Date.now(), ms = buildTimeMs(host, def, b.level + 1);
    if (ms <= 0) { b.level += 1; return { level: b.level, pendingLevel: 0, readyAt: now }; }
    b.pendingLevel = b.level + 1; b.startedAt = now; b.readyAt = now + ms;
    journal(s, 'build', '🏗', `Upgrading the ${def.name} to level ${b.pendingLevel} — ${Math.round(ms / 60000)} min. It keeps working meanwhile.`, now);
    return { level: b.level, pendingLevel: b.pendingLevel, readyAt: b.readyAt };
  });
}
export function repair(host, s, id) {
  const def = buildingDef(id), b = building(s, id);
  if (!def || !b) return { ok: false, why: 'not built' };
  if (!b.damaged) return { ok: false, why: 'nothing to repair' };
  return paid(host, s, FARM_ECON.events.storm.repair, () => { simulate(host, s); b.damaged = false; journal(s, 'repair', '🔨', `The ${def.name} roof is back on.`); return { repaired: id }; });
}
export function buyAnimal(host, s, sp, n, carrier, escortId) {
  n = Math.max(1, n | 0);
  const ad = animalDef(sp), e = FARM_ECON.animals[sp];
  if (!ad || !e) return { ok: false, why: 'unknown animal' };
  const pen = penFor(sp);
  if (!pen || !has(s, pen.id)) return { ok: false, why: 'needs ' + (pen ? pen.name : 'a pen') };
  if (!isReady(s, pen.id)) return { ok: false, why: pen.name + ' is still under construction' };
  simulate(host, s);
  const room = penCapacity(s, pen.id, host) - animalsInPen(s, pen.id).length - inTransit(s, pen.id);
  if (room < n) return { ok: false, why: room <= 0 ? pen.name + ' is full (counting stock on the road)' : 'only room for ' + room };
  /* 🚚 Stock is bought at market and hauled in. It arrives — or not — when
     the carrier does; the pen slot is reserved from now. */
  const c = carrierById(host, carrier);
  const fee = shipFee(c, sp, n), price = e.cinder * n;
  const esc = escortId ? animalById(s, escortId) : null;
  if (escortId && (!esc || !isGuard(esc) || !isAdult(esc) || esc.away || isSick(esc))) return { ok: false, why: 'that guard cannot ride along' };
  return paid(host, s, { cinder: price + fee }, () => {
    const now = Date.now();
    if (!(c.hours > 0)) {
      // A zero-hour carrier (a harness, or a future "at the gate" purchase) hands the stock over now.
      const names = [];
      for (let i = 0; i < n; i++) { const a = newAnimal(s, sp, now); s.animals.push(a); names.push(a.name); }
      s.stats.shipped += n;
      return { shipped: n, arriveAt: now, carrier: c.name, fee, names };
    }
    const sh = { id: s.seq++, sp, n, carrier: c.id, label: c.name, departAt: now, arriveAt: now + Math.round(c.hours * H), fee, price, risk: c.risk || 0, insured: c.insured || 0, escort: esc ? esc.id : 0 };
    if (esc) { esc.away = sh.id; journal(s, 'ship', '🐕', `${esc.name} rides with the truck — the pens are down a guard until it is back.`, now); }
    s.shipments.push(sh); s.stats.shipped += n;
    journal(s, 'ship', c.emoji || '🚚', `${n} ${n === 1 ? ad.name.toLowerCase() : ad.plural.toLowerCase()} ordered — ${c.name} is hauling ${n === 1 ? 'it' : 'them'} in, ETA ${Math.round(c.hours * 60)} min${fee ? ', fee ' + fee.toLocaleString() + ' Cinder' : ''}.`, now);
    return { shipped: n, arriveAt: sh.arriveAt, carrier: c.name, fee };
  });
}
export function rush(host, s, id) {
  const def = buildingDef(id); if (!def || !building(s, id)) return { ok: false, why: 'not built' };
  const cost = rushCost(s, id);
  if (!cost) return { ok: false, why: 'nothing to rush' };
  return paid(host, s, { cinder: cost }, () => { const b = building(s, id); b.readyAt = Date.now() - 1; simulate(host, s); journal(s, 'build', '⚡', `Rushed the ${def.name} for ${cost.toLocaleString()} Cinder.`); return { rushed: id, cost }; });
}
/* 🧪 Shift every clock on the farm by `ms` into the past. Used by the
   sandbox's "skip 12 hours"; only reachable through the API. */
export function debugShift(host, s, ms) {
  ms = ms | 0;
  Object.values(s.buildings).forEach(b => { b.simAt -= ms; if (b.readyAt) b.readyAt -= ms; if (b.startedAt) b.startedAt -= ms; b.lastCollect = Math.max(0, b.lastCollect - ms); });
  s.shipments.forEach(x => { x.departAt -= ms; x.arriveAt -= ms; });
  s.eventAt -= ms;
  try { record(host, s); } catch (e) {}
  return { ok: true };
}
export function rename(host, s, animalId, name) {
  const a = animalById(s, animalId); if (!a) return { ok: false, why: 'no such animal' };
  const nm = String(name || '').replace(/[<>]/g, '').trim().slice(0, 24);
  if (!nm) return { ok: false, why: 'give it a name' };
  a.name = nm;
  try { record(host, s); } catch (e) { return { ok: false, why: 'save failed' }; }
  return { ok: true, name: nm };
}
export function treat(host, s, animalId) {
  const a = animalById(s, animalId); if (!a) return { ok: false, why: 'no such animal' };
  simulate(host, s);
  if (a.ill) {
    const k = a.ill;
    return paid(host, s, FARM_ECON.disease.handCure, () => { a.ill = null; a.illSince = 0; a.health = Math.min(100, a.health + FARM_ECON.health.treatHeal); s.stats.cured++; journal(s, 'vet', '💊', `Treated ${a.name} for ${FARM_ECON.disease.kinds[k].label.toLowerCase()} by hand.`); return { health: a.health, cured: k }; });
  }
  if (a.health >= 100) return { ok: false, why: 'already in perfect health' };
  return paid(host, s, FARM_ECON.health.treatCost, () => { a.health = Math.min(100, a.health + FARM_ECON.health.treatHeal); a.hungry = 0; return { health: a.health }; });
}
export function acceptContract(host, s, offerId) {
  simulate(host, s);
  const o = contractOffers(s).find(x => x.id === (offerId | 0)); if (!o) return { ok: false, why: 'that offer is gone' };
  if (s.contracts.active.length >= FARM_ECON.contracts.maxActive) return { ok: false, why: 'you already hold ' + FARM_ECON.contracts.maxActive + ' contracts' };
  const now = Date.now();
  s.contracts.active.push({ id: o.id, give: o.give, get: o.get, accepted: now, deadline: now + o.days * DAY });
  s.contracts.offers = s.contracts.offers.filter(x => x.id !== o.id);
  journal(s, 'contract', '📜', `Signed a town contract: ${Object.keys(o.give).map(k => o.give[k] + ' ' + k).join(', ')} within ${o.days} days.`, now);
  try { record(host, s); } catch (e) { return { ok: false, why: 'save failed' }; }
  return { ok: true };
}
export function deliverContract(host, s, contractId) {
  simulate(host, s);
  const c = s.contracts.active.find(x => x.id === (contractId | 0)); if (!c) return { ok: false, why: 'no such contract' };
  return paid(host, s, c.give, () => {
    s.contracts.active = s.contracts.active.filter(x => x !== c);
    s.contracts.rep = Math.min(FARM_ECON.contracts.repMax, s.contracts.rep + FARM_ECON.contracts.repGainOnDeliver); s.stats.contractsDone++;
    const { got, clipped } = deliver(host, c.get);
    journal(s, 'contract', '📜', `Contract delivered. The town paid ${Object.keys(got).map(k => got[k] + ' ' + k).join(', ')}. Reputation ${s.contracts.rep}.`);
    return { got, clipped, rep: s.contracts.rep };
  });
}
/* 🏛 Consign a beast to the Sale Ring. NPC lot: hammer in lotMinutes, paid in goods. */
export function consign(host, s, animalId) {
  const a = animalById(s, animalId); if (!a) return { ok: false, why: 'no such animal' };
  if (!has(s, 'salering')) return { ok: false, why: 'build the Sale Ring first' };
  if (!isReady(s, 'salering')) return { ok: false, why: 'the Sale Ring is still under construction' };
  simulate(host, s);
  const now = Date.now();
  if (!auctionOpen(now)) return { ok: false, why: 'the ring opens ' + new Date(nextAuction(now)).toLocaleString() };
  if (!isAdult(a)) return { ok: false, why: a.name + ' is not grown' };
  if (isGuard(a)) return { ok: false, why: 'guards are not sold at the ring' };
  if (a.ill || isSick(a)) return { ok: false, why: a.name + ' is not fit to show' };
  if (!tierOf(a) && !prizeIds(s).has(a.id)) return { ok: false, why: 'the ring only takes prize or bred stock' };
  const reserve = animalValue(s, a);
  const lot = { id: s.seq++, seed: s.seed + ':' + s.seq + ':' + now, at: now, reserve, animal: Object.assign({}, a, { prize: prizeIds(s).has(a.id) }), p2p: false };
  s.animals = s.animals.filter(x => x.id !== a.id);
  s.lots.push(lot);
  journal(s, 'auction', '🏛', `${a.name} the ${animalDef(a.sp).name.toLowerCase()} walks into the ring. Reserve ${reserve.toLocaleString()}. Athena: "${lotTimeline(lot).athena}"`, now);
  try { record(host, s); } catch (e) { s.animals.push(a); s.lots = s.lots.filter(l => l !== lot); return { ok: false, why: 'save failed' }; }
  return { ok: true, lot, timeline: lotTimeline(lot) };
}
/* 🌐 Player lots live on the server (sql/038). The farm only hands the beast
   over (and takes it back if the post fails) — see farm.cloud.js. */
export function takeAnimalForLot(host, s, animalId) {
  const a = animalById(s, animalId); if (!a) return { ok: false, why: 'no such animal' };
  if (!has(s, 'salering') || !isReady(s, 'salering')) return { ok: false, why: 'the Sale Ring must be built and finished' };
  simulate(host, s);
  if (!isAdult(a) || isGuard(a) || a.ill || isSick(a)) return { ok: false, why: a.name + ' cannot be listed' };
  s.animals = s.animals.filter(x => x.id !== a.id);
  try { record(host, s); } catch (e) { s.animals.push(a); return { ok: false, why: 'save failed' }; }
  return { ok: true, animal: Object.assign({}, a, { prize: prizeIds(s).has(a.id), value: animalValue(s, a) }) };
}
/* A beast arriving from outside (a claimed lot). With no room it waits at
   the gate (`holding`) and walks in on the next simulate that finds a stall —
   the claim RPC is once-only, so the animal must never be dropped. */
export function returnAnimal(host, s, animal) {
  if (!animal || !animalDef(animal.sp)) return { ok: false, why: 'bad animal' };
  simulate(host, s);
  const a = Object.assign(newAnimal(s, animal.sp, Date.now()), { name: String(animal.name || '').slice(0, 24) || defaultName(animal.sp, s.seq), ageH: Number(animal.ageH) || 0, grownH: Number(animal.grownH) || 0, health: Math.max(1, Math.min(100, Number(animal.health) || 100)), breed: (typeof animal.breed === 'string' && FARM_ECON.breeds[animal.breed]) ? animal.breed : null });
  const pen = penFor(animal.sp);
  const room = pen && has(s, pen.id) && isReady(s, pen.id) && (penCapacity(s, pen.id, host) - animalsInPen(s, pen.id).length - inTransit(s, pen.id) >= 1);
  if (room) { s.animals.push(a); if (a.breed) noteCollection(host, s, a.breed, Date.now()); }
  else { s.holding.push(a); journal(s, 'ship', '🚧', `${a.name} the ${animalDef(a.sp).name.toLowerCase()} is waiting at the gate — no room in the ${pen ? pen.name : 'pen'}.`); }
  try { record(host, s); } catch (e) { s.animals = s.animals.filter(x => x !== a); s.holding = s.holding.filter(x => x !== a); return { ok: false, why: 'save failed' }; }
  return { ok: true, animal: a, held: !room };
}
export function fillTrough(host, s, penId, units) {
  const def = buildingDef(penId), b = building(s, penId);
  if (!def || !def.houses || !b) return { ok: false, why: 'not a pen' };
  if (!isReady(s, penId)) return { ok: false, why: def.name + ' is still under construction' };
  if (!isReady(s, 'feedmill')) return { ok: false, why: has(s, 'feedmill') ? 'the Feed Mill is still under construction' : 'build the Feed Mill first' };
  simulate(host, s);
  const free = Math.floor(troughCap(s, penId) - b.feed);
  const have = host.getRes('animalFeed');
  const take = Math.min(free, have, Math.max(0, units | 0));
  if (take <= 0) return { ok: false, why: free <= 0 ? 'trough is full' : (have <= 0 ? 'no Animal Feed — grind some at the Feed Mill' : 'nothing to add') };
  return paid(host, s, { animalFeed: take }, () => { b.feed += take; return { added: take }; });
}
/* 👷 Hired Farmers top up any trough under the threshold from the stash.
   Called on mount; records only when feed actually moved. */
export function tend(host, s) {
  let farmers = 0; try { farmers = host.farmers() | 0; } catch (e) {}
  if (farmers <= 0 || !has(s, 'feedmill')) return { ok: true, moved: 0 };
  simulate(host, s);
  // Plan first, pay once, apply inside paid() so a failed save unwinds it all.
  const plan = []; let budget = host.getRes('animalFeed'), moved = 0;
  FARM_BUILDINGS.forEach(def => {
    if (!def.houses) return;
    const b = building(s, def.id); if (!b || !animalsInPen(s, def.id).length) return;
    const cap = troughCap(s, def.id);
    if (b.feed >= cap * FARM_ECON.farmers.topUpBelow) return;
    const take = Math.min(Math.floor(cap - b.feed), Math.max(0, budget));
    if (take > 0) { plan.push([def.id, take]); budget -= take; moved += take; }
  });
  if (!moved) return { ok: true, moved: 0 };
  return paid(host, s, { animalFeed: moved }, () => {
    plan.forEach(([id, n]) => { s.buildings[id].feed += n; });
    journal(s, 'tend', '👷', `Your ${farmers} Farmer${farmers === 1 ? '' : 's'} topped up the troughs with ${moved} feed.`);
    return { moved };
  });
}
export function collect(host, s, penId) {
  const b = building(s, penId);
  if (!b) return { ok: false, why: 'not built' };
  simulate(host, s);
  const readyAt = collectReadyAt(host, s, penId);
  if (Date.now() < readyAt) return { ok: false, why: 'cooldown', readyAt };
  const want = pendingCollect(s, penId);
  if (!Object.keys(want).length) return { ok: false, why: 'nothing to collect' };
  const { got, clipped } = deliver(host, want);
  Object.keys(got).forEach(r => { b.accrual[r] = Math.max(0, (b.accrual[r] || 0) - got[r]); });
  if (Object.keys(got).length) b.lastCollect = Date.now();
  try { record(host, s); } catch (e) { return { ok: false, why: 'save failed', got, clipped }; }
  return { ok: true, got, clipped };
}
/* 🔪 Slaughter. `sel` = { sp, n } (oldest adults first) or { ids: [...] }.
   Yield = base × weight/adultWeight × butcher level × cut × season × breed. */
export function slaughter(host, s, sel, cut) {
  const bb = building(s, 'butcher');
  if (!bb) return { ok: false, why: "build the Butcher's Block first" };
  if (!isReady(s, 'butcher')) return { ok: false, why: "the Butcher's Block is still under construction" };
  const C = FARM_ECON.cuts[cut || 'balanced'] || FARM_ECON.cuts.balanced;
  if (bb.level < C.minLevel) return { ok: false, why: `${C.label} needs Butcher's Block level ${C.minLevel}` };
  simulate(host, s);
  let list;
  if (sel && Array.isArray(sel.ids)) list = sel.ids.map(id => animalById(s, id)).filter(Boolean);
  else {
    const ad = animalDef(sel && sel.sp); if (!ad) return { ok: false, why: 'unknown animal' };
    list = animalsOf(s, ad.id).filter(isAdult).sort((a, b) => b.ageH - a.ageH).slice(0, Math.max(1, (sel.n | 0) || 1));
    if (!list.length) return { ok: false, why: 'no adult ' + ad.plural.toLowerCase() + ' to slaughter' };
  }
  list = list.filter(a => !isGuard(a));
  if (!list.length) return { ok: false, why: 'guards are not for the block' };
  const young = list.filter(a => !isAdult(a));
  if (young.length) return { ok: false, why: `${young[0].name} is not grown yet` };
  const se = seasonFor(Date.now());
  const mul = 1 + FARM_ECON.butcherBonusPerLevel * (bb.level - 1);
  const prizes = prizeIds(s);
  const want = {}; const stories = []; const R = rngFor('cut:' + s.seed + ':' + Date.now());
  list.forEach(a => {
    const table = FARM_ECON.slaughter[a.sp], e = econOf(a), br = breedOf(a);
    const wf = weightOf(a) / e.adultWeight;
    Object.keys(table).forEach(r => {
      let v = table[r] * wf * mul;
      if (r === 'meat') v *= C.meat * se.meatMul * ((br && br.meatMul) || 1);
      else if (r === 'hide') v *= C.hide;
      else v *= C.other;
      want[r] = (want[r] || 0) + Math.max(1, Math.round(v));
    });
    if (C.rare && R() < C.rareChance) { Object.keys(C.rare).forEach(r => { want[r] = (want[r] || 0) + C.rare[r]; }); stories.push(`${a.name}'s trophy cut turned up a Memory Shard.`); }
    if (prizes.has(a.id) && R() < FARM_ECON.prizeRare.chance) { Object.keys(FARM_ECON.prizeRare.drop).forEach(r => { want[r] = (want[r] || 0) + FARM_ECON.prizeRare.drop[r]; }); stories.push(`Prize beast ${a.name} yielded a strand of DNA.`); }
  });
  const ids = new Set(list.map(a => a.id));
  s.animals = s.animals.filter(a => !ids.has(a.id));
  const { got, clipped } = deliver(host, want);
  s.stats.slaughtered += list.length; s.stats.meat += (got.meat | 0);
  const nm = list.length === 1 ? `${list[0].name} the ${animalDef(list[0].sp).name.toLowerCase()}` : `${list.length} ${animalDef(list[0].sp).plural.toLowerCase()}`;
  journal(s, 'butcher', '🔪', `${nm} went to the block (${C.label.toLowerCase()}): ${Object.keys(got).map(k => got[k] + ' ' + k).join(', ')}.${stories.length ? ' ' + stories.join(' ') : ''}`);
  try { record(host, s); } catch (e) { return { ok: false, why: 'save failed', got, clipped, taken: list.length }; }
  return { ok: true, taken: list.length, got, clipped, stories };
}
export function craft(host, s, stationId, recipeKey, batches) {
  const def = buildingDef(stationId), b = building(s, stationId);
  if (!def || !b) return { ok: false, why: 'not built' };
  if (!isReady(s, stationId)) return { ok: false, why: def.name + ' is still under construction' };
  let recipe;
  if (def.role === 'feed') recipe = FARM_ECON.feedMillRecipe;
  else if (Array.isArray(def.recipes) && def.recipes.indexOf(recipeKey) >= 0) recipe = FARM_ECON.recipes[recipeKey];
  if (!recipe) return { ok: false, why: 'unknown recipe' };
  batches = Math.max(1, batches | 0);
  const maxBy = Math.min(...Object.keys(recipe.inputs).map(k => Math.floor(host.getRes(k) / recipe.inputs[k])));
  if (!(maxBy >= 1)) return { ok: false, why: 'short', shortfall: shortfall(host, recipe.inputs) };
  batches = Math.min(batches, maxBy);
  const cost = {}; Object.keys(recipe.inputs).forEach(k => { cost[k] = recipe.inputs[k] * batches; });
  const mul = 1 + FARM_ECON.recipeBonusPerLevel * (b.level - 1);
  const sp = spendCost(host, cost);
  if (!sp.ok) return sp;
  const want = {}; Object.keys(recipe.output).forEach(r => { want[r] = Math.round(recipe.output[r] * batches * mul); });
  const { got, clipped } = deliver(host, want);
  try { record(host, s); } catch (e) {}
  return { ok: true, batches, got, clipped };
}
/* 🏘 Deliver today's town demand: resources for resources, capped per day. */
export function deliverDemand(host, s) {
  simulate(host, s);
  const o = townOffer(s);
  if (o.left <= 0) return { ok: false, why: 'the town has taken all it needs today' };
  return paid(host, s, o.give, () => {
    if (s.demand.day !== o.day) { s.demand.day = o.day; s.demand.used = 0; }
    s.demand.used++; s.stats.delivered++;
    const { got, clipped } = deliver(host, o.get);
    journal(s, 'town', '🏘', `Delivered ${Object.keys(o.give).map(k => o.give[k] + ' ' + k).join(', ')} to town for ${Object.keys(got).map(k => got[k] + ' ' + k).join(', ')}.`);
    return { got, clipped, left: o.left - 1 };
  });
}
/* 📦 Crate a grown animal into one tradeable `livestock` unit. */
export function crate(host, s, animalId) {
  const a = animalById(s, animalId); if (!a) return { ok: false, why: 'no such animal' };
  simulate(host, s);
  if (!isAdult(a)) return { ok: false, why: `${a.name} is not grown yet` };
  if (isSick(a)) return { ok: false, why: `${a.name} is too sick to travel` };
  const before = host.getRes('livestock');
  host.addRes('livestock', 1);
  if (host.getRes('livestock') <= before) return { ok: false, why: 'stash is full' };
  s.animals = s.animals.filter(x => x.id !== a.id);
  s.stats.crated++;
  journal(s, 'crate', '📦', `${a.name} the ${animalDef(a.sp).name.toLowerCase()} was crated for the Exchange.`);
  try { record(host, s); } catch (e) { host.spendRes('livestock', 1); return { ok: false, why: 'save failed' }; }
  return { ok: true };
}
export function uncrate(host, s, sp) {
  const ad = animalDef(sp), e = FARM_ECON.animals[sp];
  if (!ad || !e) return { ok: false, why: 'unknown animal' };
  const pen = penFor(sp);
  if (!pen || !has(s, pen.id)) return { ok: false, why: 'needs ' + (pen ? pen.name : 'a pen') };
  if (!isReady(s, pen.id)) return { ok: false, why: pen.name + ' is still under construction' };
  simulate(host, s);
  if (penCapacity(s, pen.id, host) - animalsInPen(s, pen.id).length - inTransit(s, pen.id) < 1) return { ok: false, why: pen.name + ' is full' };
  const cost = { livestock: 1, cinder: Math.round(e.cinder * FARM_ECON.crate.uncrateDiscount) };
  return paid(host, s, cost, () => { const a = newAnimal(s, sp, Date.now()); a.grownH = e.growH * 0.5; s.animals.push(a); return { name: a.name }; });
}
export function uncrateCost(sp) { const e = FARM_ECON.animals[sp]; return e ? { livestock: 1, cinder: Math.round(e.cinder * FARM_ECON.crate.uncrateDiscount) } : null; }
/* 🅰 Athena Editor. */
export function setLook(host, s, patch) {
  const next = normalizeLook(Object.assign({}, s.look, patch || {}, {
    decor: Object.assign({}, s.look.decor, (patch && patch.decor) || {}),
    roofs: Object.assign({}, s.look.roofs, (patch && patch.roofs) || {}),
  }));
  if (patch && patch.roofs) Object.keys(patch.roofs).forEach(k => { if (patch.roofs[k] === null) delete next.roofs[k]; });
  s.look = next;
  try { record(host, s); } catch (e) { return { ok: false, why: 'save failed' }; }
  return { ok: true, look: next };
}

/* ── Snapshot for the UI + scene ───────────────────────────────────────────── */
export function summary(host, s) {
  const now = Date.now();
  const sim = simulate(host, s, now);
  if (sim.changed) { try { record(host, s); } catch (e) {} }
  const prizes = prizeIds(s);
  const pens = FARM_BUILDINGS.filter(d => d.houses).map(d => {
    const b = building(s, d.id);
    const herd = animalsInPen(s, d.id);
    return {
      id: d.id, built: !!b, level: b ? b.level : 0, damaged: !!(b && b.damaged), ready: isReady(s, d.id, now), progress: buildProgress(s, d.id, now), inTransit: inTransit(s, d.id),
      herd: herd.length, adults: herd.filter(isAdult).length, capacity: penCapacity(s, d.id, host),
      feed: b ? Math.floor(b.feed) : 0, troughCap: troughCap(s, d.id), hoursLeft: b ? feedHoursLeft(s, d.id, host) : 0,
      pending: pendingCollect(s, d.id), readyAt: b ? collectReadyAt(host, s, d.id) : 0,
      ratePerH: penRatePerH(s, d.id, host, now), defense: b ? penDefense(s, d.id) : 0,
    };
  });
  const animals = s.animals.map(a => Object.assign({}, a, {
    adult: isAdult(a), guard: isGuard(a), sick: isSick(a), weight: weightOf(a), prize: prizes.has(a.id),
    breedLabel: breedOf(a) ? breedOf(a).label : null, tier: tierOf(a),
    illLabel: a.ill ? FARM_ECON.disease.kinds[a.ill].label : null, value: animalValue(s, a),
  }));
  const species = FARM_ANIMALS.map(a => {
    const list = animals.filter(x => x.sp === a.id);
    return { id: a.id, count: list.length, adults: list.filter(x => x.adult).length, young: list.filter(x => !x.adult).length };
  });
  const recent = s.journal.filter(j => now - j.t < 12 * H);
  return {
    pens, species, animals, buildings: Object.assign({}, s.buildings),
    look: s.look, journal: s.journal.slice(), stats: Object.assign({}, s.stats),
    season: seasonFor(now), weather: weatherAt(s.seed, now), terroir: terroirTier(host),
    guardDefense: guardDefense(s), farmers: (() => { try { return host.farmers() | 0; } catch (e) { return 0; } })(), farmersBonus: farmersBonus(host),
    town: townOffer(s, now), recentEvents: recent,
    construction: FARM_BUILDINGS.map(d => ({ id: d.id, progress: buildProgress(s, d.id, now), rush: rushCost(s, d.id, now) })).filter(x => x.progress),
    builders: (() => { try { return host.builders ? (host.builders() | 0) : 0; } catch (e) { return 0; } })(), buildersBonus: buildersBonus(host),
    shipments: s.shipments.map(x => Object.assign({}, x, { progress: Math.max(0, Math.min(1, (now - x.departAt) / Math.max(1, x.arriveAt - x.departAt))), pen: animalDef(x.sp).pen })),
    carriers: carriersFor(host),
    contracts: { offers: contractOffers(s, now).slice(), active: s.contracts.active.slice(), rep: s.contracts.rep, demandPerDay: demandPerDay(s) },
    lots: s.lots.map(l => Object.assign({}, l, { timeline: lotTimeline(l) })),
    auction: { open: auctionOpen(now), next: nextAuction(now), ringReady: isReady(s, 'salering', now), ringBuilt: has(s, 'salering') },
    collection: Object.assign({}, s.collection), collectionRewarded: Object.assign({}, s.collectionRewarded),
    escorts: s.animals.filter(a => isGuard(a) && isAdult(a) && !a.away && !isSick(a)).map(a => ({ id: a.id, name: a.name, sp: a.sp, defense: econOf(a).defense })),
    ill: s.animals.filter(a => a.ill).length,
    holding: s.holding.slice(),
  };
}
