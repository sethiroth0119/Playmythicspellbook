/* ════════════════════════════════════════════════════════════════════════════
   🐄 HOMESTEAD FARM — state, simulation and every mutator.
   ----------------------------------------------------------------------------
   Pure over a `host` adapter (see index.js makeHost): this file never touches
   window, Profile or the DOM, so a node harness can drive the whole economy
   with a fake host and diff the ledger (tools/farm_harness.mjs does).

   State shape, persisted at Profile.farm through the bridge:
     {
       v: 1,
       ts: <epoch ms of the last mutation — the cloud merge's tie-breaker>,
       buildings: { [defId]: { level, builtAt, feed, simAt, lastCollect, accrual: { resId: float } } },
       animals:   [ { id, sp, ageH, born } ],      // ageH = FED hours lived
       seq: <next animal id>,
     }

   ⏱ THE SIMULATION IS DETERMINISTIC AND OFFLINE. Nothing ticks in the
   background: every read calls simulate() first, which advances each pen from
   its `simAt` to now using only the feed that was in the trough. That is what
   makes a 3-day absence and a 3-second one the same code path, and it is why
   the trough is the ONLY clock — an unfed pen simply does not advance.

   🔴 SPENDING IS ATOMIC OR REFUNDED. spendCost() takes resource legs first and
   Cinder last, and unwinds every taken leg with host.refundRes (UNCAPPED — the
   addRes path clamps at the stash cap and would silently destroy a refund;
   see the _refundRes note in index.html). A save failure after a spend is
   turned back into an exception so the same unwind runs. The city module was
   bitten by exactly this (a 50,000-Cinder building that never persisted).
   ════════════════════════════════════════════════════════════════════════════ */

import {
  FARM_ECON, FARM_ANIMALS, FARM_BUILDINGS, animalDef, buildingDef, penFor, buildingCostAt,
} from './farm.data.js';

const H = 3600000;

/* ── State ─────────────────────────────────────────────────────────────────── */
export function ensureState(host) {
  let s = host.state();
  if (!s || typeof s !== 'object') s = {};
  if (s.v !== 1) s.v = 1;
  if (!s.buildings || typeof s.buildings !== 'object') s.buildings = {};
  if (!Array.isArray(s.animals)) s.animals = [];
  if (typeof s.seq !== 'number') s.seq = 1;
  if (typeof s.ts !== 'number') s.ts = 0;
  // Heal rows a stale client could have written short.
  Object.keys(s.buildings).forEach(id => {
    const b = s.buildings[id];
    if (!b || typeof b !== 'object' || !buildingDef(id)) { delete s.buildings[id]; return; }
    b.level = Math.max(1, b.level | 0);
    b.feed = Math.max(0, Number(b.feed) || 0);
    b.simAt = Number(b.simAt) || Date.now();
    b.lastCollect = Number(b.lastCollect) || 0;
    if (!b.accrual || typeof b.accrual !== 'object') b.accrual = {};
  });
  s.animals = s.animals.filter(a => a && animalDef(a.sp)).map(a => ({
    id: a.id | 0, sp: a.sp, ageH: Math.max(0, Number(a.ageH) || 0), born: Number(a.born) || 0,
  }));
  return s;
}

/* 💾 The one write path. Returns nothing; THROWS when the host reports a
   failed persist so every mutator's refund branch is reachable. */
function record(host, s) {
  s.ts = Date.now();
  if (host.setState(s) === false) throw new Error('farm: setState failed');
  if (host.save() === false) throw new Error('farm: save failed');
}

/* ── Reads ─────────────────────────────────────────────────────────────────── */
export function building(s, id) { return s.buildings[id] || null; }
export function level(s, id) { const b = building(s, id); return b ? b.level : 0; }
export function has(s, id) { return !!building(s, id); }
export function animalsOf(s, sp) { return s.animals.filter(a => a.sp === sp); }
export function animalsInPen(s, penId) {
  const def = buildingDef(penId);
  if (!def || !def.houses) return [];
  return s.animals.filter(a => def.houses.indexOf(a.sp) >= 0);
}
export function isAdult(a) { const d = FARM_ECON.animals[a.sp]; return !!d && a.ageH >= d.growH; }
export function penCapacity(s, penId) {
  const def = buildingDef(penId), b = building(s, penId);
  return (def && b && typeof def.capacity === 'function') ? def.capacity(b.level) : 0;
}
export function troughCap(s, penId) {
  const b = building(s, penId);
  return b ? FARM_ECON.troughCap + FARM_ECON.troughCapPerLevel * (b.level - 1) : 0;
}
/* Feed units this pen burns per hour with its current herd. */
export function feedDrawPerH(s, penId) {
  let d = 0;
  animalsInPen(s, penId).forEach(a => {
    const ad = animalDef(a.sp), e = FARM_ECON.animals[a.sp];
    if (!ad || !e) return;
    d += e.feedPerH * (ad.ground ? FARM_ECON.grazeDiscount : 1);
  });
  return d;
}
/* Hours the trough lasts at the current draw. Infinity with no animals. */
export function feedHoursLeft(s, penId) {
  const b = building(s, penId); if (!b) return 0;
  const d = feedDrawPerH(s, penId);
  return d > 0 ? b.feed / d : Infinity;
}
/* Full-pen hourly yield (adults only) — the accrual ceiling's basis. */
export function penRatePerH(s, penId) {
  const rate = {};
  animalsInPen(s, penId).forEach(a => {
    if (!isAdult(a)) return;
    const y = FARM_ECON.yieldsPerH[a.sp] || {};
    Object.keys(y).forEach(r => { rate[r] = (rate[r] || 0) + y[r]; });
  });
  return rate;
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

/* ── Simulation ────────────────────────────────────────────────────────────── */
/* Advance every pen to `now`. Mutates `s` in memory only — callers that
   change something call record(); a pure read leaves the advanced state
   unsaved, which is safe because it is re-derivable from simAt + feed. */
export function simulate(host, s, now, rnd) {
  now = now || Date.now();
  rnd = rnd || Math.random;
  FARM_BUILDINGS.forEach(def => {
    if (!def.houses) return;
    const b = building(s, def.id); if (!b) return;
    const hours = Math.max(0, (now - b.simAt) / H);
    b.simAt = now;
    if (hours <= 0) return;
    const herd = animalsInPen(s, def.id);
    if (!herd.length) return;
    const draw = feedDrawPerH(s, def.id);
    const fedH = draw > 0 ? Math.min(hours, b.feed / draw) : hours;
    if (fedH <= 0) return;
    b.feed = Math.max(0, b.feed - fedH * draw);

    // Per-animal: grow, and yield for the part of the window spent adult.
    const capH = host.accrualCapH;
    const gained = {};
    herd.forEach(a => {
      const e = FARM_ECON.animals[a.sp]; if (!e) return;
      const adultH = Math.max(0, fedH - Math.max(0, e.growH - a.ageH));
      a.ageH += fedH;
      if (adultH <= 0) return;
      const y = FARM_ECON.yieldsPerH[a.sp] || {};
      Object.keys(y).forEach(r => { gained[r] = (gained[r] || 0) + y[r] * adultH; });
    });
    /* 📦 The accrual cap is the game's 36h contract: a pen never holds more
       than capH hours of its CURRENT adult rate, so an absent player is
       rewarded up to the cap and not beyond — same rule as operations. */
    const rate = penRatePerH(s, def.id);
    Object.keys(gained).forEach(r => {
      const ceiling = (rate[r] || 0) * capH;
      b.accrual[r] = Math.min(ceiling, (b.accrual[r] || 0) + gained[r]);
    });

    // Breeding: needs two adults of a species and a free stall.
    const cap = penCapacity(s, def.id);
    (def.houses || []).forEach(sp => {
      const adults = herd.filter(a => a.sp === sp && isAdult(a)).length;
      if (adults < 2) return;
      const p = FARM_ECON.breedChancePerH[sp] || 0;
      // Expected births over fedH hours, rolled hour by hour (bounded so a
      // month-long absence cannot loop forever — the cap stops it anyway).
      let trials = Math.min(200, Math.floor(fedH)), frac = fedH - Math.floor(fedH);
      let births = 0;
      for (let i = 0; i < trials; i++) if (rnd() < p) births++;
      if (rnd() < p * frac) births++;
      for (let i = 0; i < births; i++) {
        if (animalsInPen(s, def.id).length >= cap) break;
        s.animals.push({ id: s.seq++, sp, ageH: 0, born: now });
      }
    });
  });
  return s;
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
/* Atomic multi-leg spend. Returns { ok, why }. Never leaves a partial deduction. */
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

/* Run `mutate` then persist; on a persist failure undo the spend and rethrow
   as a result. Every paid mutator below goes through this. */
function paid(host, s, cost, mutate) {
  const sp = spendCost(host, cost);
  if (!sp.ok) return sp;
  /* 📸 Snapshot BEFORE mutating. The harness caught the first cut of this
     leaving a building in memory after its save had failed and its Cinder
     had been refunded — a free building until the next reload. The in-memory
     state has to be unwound with the ledger, not just the ledger. */
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

/* ── Mutators ──────────────────────────────────────────────────────────────── */
export function build(host, s, id) {
  const def = buildingDef(id);
  if (!def) return { ok: false, why: 'unknown building' };
  if (has(s, id)) return { ok: false, why: 'already built' };
  const cost = buildingCostAt(def, 1);
  return paid(host, s, cost, () => {
    s.buildings[id] = { level: 1, builtAt: Date.now(), feed: 0, simAt: Date.now(), lastCollect: 0, accrual: {} };
    return { built: id };
  });
}

export function upgrade(host, s, id) {
  const def = buildingDef(id), b = building(s, id);
  if (!def || !b) return { ok: false, why: 'not built' };
  if (b.level >= def.maxLevel) return { ok: false, why: 'max level' };
  const cost = buildingCostAt(def, b.level + 1);
  return paid(host, s, cost, () => { simulate(host, s); b.level += 1; return { level: b.level }; });
}

export function buyAnimal(host, s, sp, n) {
  n = Math.max(1, n | 0);
  const ad = animalDef(sp), e = FARM_ECON.animals[sp];
  if (!ad || !e) return { ok: false, why: 'unknown animal' };
  const pen = penFor(sp);
  if (!pen || !has(s, pen.id)) return { ok: false, why: 'needs ' + (pen ? pen.name : 'a pen') };
  simulate(host, s);
  const room = penCapacity(s, pen.id) - animalsInPen(s, pen.id).length;
  if (room < n) return { ok: false, why: room <= 0 ? pen.name + ' is full' : 'only room for ' + room };
  return paid(host, s, { cinder: e.cinder * n }, () => {
    for (let i = 0; i < n; i++) s.animals.push({ id: s.seq++, sp, ageH: 0, born: Date.now() });
    return { bought: n };
  });
}

/* Move Animal Feed from the ledger into a pen's trough. `units` clamps to
   the free trough space and to what the player holds. */
export function fillTrough(host, s, penId, units) {
  const def = buildingDef(penId), b = building(s, penId);
  if (!def || !def.houses || !b) return { ok: false, why: 'not a pen' };
  if (!has(s, 'feedmill')) return { ok: false, why: 'build the Feed Mill first' };
  simulate(host, s);
  const free = Math.floor(troughCap(s, penId) - b.feed);
  const have = host.getRes('animalFeed');
  const take = Math.min(free, have, Math.max(0, units | 0));
  if (take <= 0) return { ok: false, why: free <= 0 ? 'trough is full' : (have <= 0 ? 'no Animal Feed — grind some at the Feed Mill' : 'nothing to add') };
  return paid(host, s, { animalFeed: take }, () => { b.feed += take; return { added: take }; });
}

/* Collect a pen's accrual into the ledger. Anything the stash cap refuses
   STAYS in the accrual rather than being destroyed — the city Warehouse bug
   (promised 810, banked 540, lost 270) is the failure this guards against. */
export function collect(host, s, penId) {
  const b = building(s, penId);
  if (!b) return { ok: false, why: 'not built' };
  simulate(host, s);
  const readyAt = collectReadyAt(host, s, penId);
  if (Date.now() < readyAt) return { ok: false, why: 'cooldown', readyAt };
  const want = pendingCollect(s, penId);
  if (!Object.keys(want).length) return { ok: false, why: 'nothing to collect' };
  const got = {}; let clipped = false;
  Object.keys(want).forEach(r => {
    const before = host.getRes(r);
    host.addRes(r, want[r]);
    const landed = Math.max(0, host.getRes(r) - before);
    if (landed < want[r]) clipped = true;
    if (landed > 0) { got[r] = landed; b.accrual[r] = Math.max(0, (b.accrual[r] || 0) - landed); }
  });
  if (Object.keys(got).length) b.lastCollect = Date.now();
  try { record(host, s); } catch (e) { return { ok: false, why: 'save failed', got, clipped }; }
  return { ok: true, got, clipped };
}

/* Slaughter `n` ADULTS of a species at the Butcher's Block. Oldest first. */
export function slaughter(host, s, sp, n) {
  n = Math.max(1, n | 0);
  const ad = animalDef(sp), table = FARM_ECON.slaughter[sp];
  if (!ad || !table) return { ok: false, why: 'unknown animal' };
  const bb = building(s, 'butcher');
  if (!bb) return { ok: false, why: "build the Butcher's Block first" };
  simulate(host, s);
  const adults = animalsOf(s, sp).filter(isAdult).sort((a, b) => b.ageH - a.ageH);
  if (!adults.length) return { ok: false, why: 'no adult ' + ad.plural.toLowerCase() + ' to slaughter' };
  const take = Math.min(n, adults.length);
  const mul = 1 + FARM_ECON.butcherBonusPerLevel * (bb.level - 1);
  const yieldTotal = {};
  Object.keys(table).forEach(r => { yieldTotal[r] = Math.max(1, Math.round(table[r] * mul)) * take; });
  const ids = new Set(adults.slice(0, take).map(a => a.id));
  s.animals = s.animals.filter(a => !ids.has(a.id));
  const got = {}; let clipped = false;
  Object.keys(yieldTotal).forEach(r => {
    const before = host.getRes(r);
    host.addRes(r, yieldTotal[r]);
    const landed = Math.max(0, host.getRes(r) - before);
    if (landed < yieldTotal[r]) clipped = true;
    if (landed > 0) got[r] = landed;
  });
  try { record(host, s); } catch (e) { return { ok: false, why: 'save failed', got, clipped, taken: take }; }
  return { ok: true, taken: take, got, clipped };
}

/* Station recipes (Feed Mill, Tannery, Spinning Shed, Kitchen). `batches`
   is clamped to what the inputs allow. Output scales with station level. */
export function craft(host, s, stationId, recipeKey, batches) {
  const def = buildingDef(stationId), b = building(s, stationId);
  if (!def || !b) return { ok: false, why: 'not built' };
  let recipe;
  if (def.role === 'feed') recipe = FARM_ECON.feedMillRecipe;
  else if (Array.isArray(def.recipes) && def.recipes.indexOf(recipeKey) >= 0) recipe = FARM_ECON.recipes[recipeKey];
  if (!recipe) return { ok: false, why: 'unknown recipe' };
  batches = Math.max(1, batches | 0);
  const maxBy = Math.min(...Object.keys(recipe.inputs).map(k => Math.floor(host.getRes(k) / recipe.inputs[k])));
  if (!(maxBy >= 1)) return { ok: false, why: 'short', shortfall: shortfall(host, recipe.inputs) };
  batches = Math.min(batches, maxBy);
  const cost = {};
  Object.keys(recipe.inputs).forEach(k => { cost[k] = recipe.inputs[k] * batches; });
  const mul = 1 + FARM_ECON.recipeBonusPerLevel * (b.level - 1);
  const sp = spendCost(host, cost);
  if (!sp.ok) return sp;
  const got = {}; let clipped = false;
  Object.keys(recipe.output).forEach(r => {
    const want = Math.round(recipe.output[r] * batches * mul);
    const before = host.getRes(r);
    host.addRes(r, want);
    const landed = Math.max(0, host.getRes(r) - before);
    if (landed < want) clipped = true;
    got[r] = landed;
  });
  try { record(host, s); } catch (e) {}
  return { ok: true, batches, got, clipped };
}

/* Snapshot for the UI + scene: cheap, and re-derivable. */
export function summary(host, s) {
  simulate(host, s);
  const pens = FARM_BUILDINGS.filter(d => d.houses).map(d => {
    const b = building(s, d.id);
    const herd = animalsInPen(s, d.id);
    return {
      id: d.id, built: !!b, level: b ? b.level : 0,
      herd: herd.length, adults: herd.filter(isAdult).length, capacity: penCapacity(s, d.id),
      feed: b ? Math.floor(b.feed) : 0, troughCap: troughCap(s, d.id), hoursLeft: b ? feedHoursLeft(s, d.id) : 0,
      pending: pendingCollect(s, d.id), readyAt: b ? collectReadyAt(host, s, d.id) : 0,
      ratePerH: penRatePerH(s, d.id),
    };
  });
  const species = FARM_ANIMALS.map(a => {
    const list = animalsOf(s, a.id);
    return { id: a.id, count: list.length, adults: list.filter(isAdult).length, young: list.filter(x => !isAdult(x)).length };
  });
  return { pens, species, animals: s.animals.slice(), buildings: Object.assign({}, s.buildings) };
}
