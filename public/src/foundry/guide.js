/* ════════════════════════════════════════════════════════════════════════════
   📖 THE FOUNDRY — what a machine needs, what it makes, and what it is FOR.
   ----------------------------------------------------------------------------
   Three jobs, all of them "answer the question the player actually has":
     • THROUGHPUT — not "10 → 9 per batch" but "≈540 shredded waste an hour at
       this level", and what that becomes if you upgrade.
     • STATIONS   — what each desk on the floor is for.
     • WHAT IT IS FOR — the Foundry pays out Metal, Fuel and Supplies, and a
       player has no reason to care until they know those three are the exact
       things the city builder and their operations are short of. So this file
       cross-references the Foundry's taps against CITY_PRODUCTION's inputs and
       OPS_ECON's inputs, and says so on the machine that makes them.

   🔴 THE CROSS-REFERENCE IS DERIVED, NOT ASSERTED. CITY_USES is built by reading
   CITY_PRODUCTION's own `inputs`/`cost` at load, so a building that stops
   consuming Fuel drops off the list by itself. Hand-listing "the Power Plant
   needs fuel" would be a fourth place to update when someone retunes a recipe,
   and the stalest kind of documentation is the kind that looks authoritative.

   ⚠ OPS_USES CANNOT BE DERIVED — OPS_ECON is a top-level `const` in index.html,
   which a module cannot see (the globals trap). It is mirrored here by hand and
   is the ONE table in this feature that can drift. Keep it in step with
   OPS_ECON (index.html, search `const OPS_ECON`); the shape is deliberately
   tiny so the drift is cheap to check.
   ════════════════════════════════════════════════════════════════════════════ */

import { machineById, levelSpeed, conditionSpeed, trimSpeed, fmtDur, FUEL_ORDER } from './machines.js';
import { recipeById, normIn, normOut, resolvePurity, yieldAtPurity, matName, matIcon, tapFor } from './recipes.js';
import { stockOf, machineStatus, HALT } from './state.js';
import { CITY_PRODUCTION } from '../city/production.data.js';

/* ── Throughput ──────────────────────────────────────────────────────────── */

/* What one batch actually yields right now, given the grade of what is loaded.
   Mirrors runMachine's arithmetic — if that changes, this has to follow, or the
   card will promise a number the line does not deliver. */
function batchOutputs(st, r, def, trim) {
  const need = normIn(r), outs = normOut(r);
  let q = 0, acc = 0;
  for (const k in need) { q += need[k]; acc += need[k] * stockOf(st, k).purity; }
  const inPur = q > 0 ? acc / q : 0;
  const outPurity = Math.max(0, Math.min(1, resolvePurity(r, inPur) + (def.separator ? trim : 0)));
  const mult = r.gradeSensitive ? yieldAtPurity(outPurity) : 1;
  const res = {};
  for (const k in outs) res[k] = outs[k] * mult;
  return { outs: res, purity: outPurity, mult };
}

/* Per-hour figures at a given level. `lv` defaults to the machine's current one;
   pass lv+1 to answer "what does upgrading buy me?" without mutating anything. */
export function ratePerHour(st, id, lv) {
  const def = machineById(id);
  const s = machineStatus(st, id);
  if (!def || !s || !s.recipe) return null;
  const r = recipeById(s.recipe);
  if (!r) return null;
  const level = (lv == null) ? s.lv : lv;
  const trim = trimSpeed(st.trim);
  const trimP = (trimSpeed === undefined) ? 0 : 0; // purity handled in batchOutputs
  /* Speed at THIS level, holding condition and the grid where they are, so the
     comparison between levels isn't muddied by a repair you have not done. */
  const speed = levelSpeed(level) * conditionSpeed(s.cond) * trim * (s.brownout ? 0.4 : 1);
  if (speed <= 0) return null;
  const bph = 3600 / (r.secs / speed);
  const { outs, purity, mult } = batchOutputs(st, r, def, 0);
  const inPerHr = {}, outPerHr = {};
  const need = normIn(r);
  for (const k in need) inPerHr[k] = need[k] * bph;
  for (const k in outs) outPerHr[k] = outs[k] * bph;
  return {
    lv: level, bph, secsPerBatch: r.secs / speed, speed,
    inputs: inPerHr, outputs: outPerHr,
    fuelPerHr: (def.burn || 0) * bph,
    purity, mult, recipe: r,
  };
}

/* ── Stations ────────────────────────────────────────────────────────────── */

export const STATION_INFO = {
  supply: {
    title: 'Supply Office',
    what: 'Buys feedstock with Cinder — waste bales, crude, coal, flux, and diesel to get the line lit.',
    tip: 'Industrial waste costs the most and carries the best iron fraction. Residential is nearly free and mostly plastic; buying it and skipping the Sorter loses money.',
  },
  weigh: {
    title: 'Weighbridge',
    what: 'Sells finished goods into your real stores — Metal, Fuel and Supplies.',
    tip: 'Grade is priced here. A contaminated pile still sells, just badly, so sorting before you crush is what the money actually comes from.',
  },
  control: {
    title: 'Control Room',
    what: 'The whole-line view: grid load, the trim dial, and every machine that has stopped.',
    tip: 'Trim left for tonnage, right for grade. When the line browns out, this is where you see which machines are eating the power.',
  },
};

/* ── What is it FOR ──────────────────────────────────────────────────────── */

/* Derived from CITY_PRODUCTION itself — see the header note. Returns
   { metal: [{id,name,why}], … } for every live resource a city building wants. */
function buildCityUses() {
  const out = {};
  const push = (res, entry) => { (out[res] || (out[res] = [])).push(entry); };
  for (const b of CITY_PRODUCTION) {
    for (const k in (b.inputs || {})) {
      push(k, { id: b.id, name: b.name, why: 'burns ' + b.inputs[k] + '/cycle' + (b.yields ? ' to make ' + Object.keys(b.yields).join(' + ') : '') });
    }
    const c0 = (b.cost && b.cost[0]) || {};
    for (const k in c0) {
      if (k === 'cinder') continue;
      push(k, { id: b.id, name: b.name, why: 'costs ' + c0[k] + ' to put up', build: true });
    }
  }
  return out;
}
export const CITY_USES = buildCityUses();

/* ⚠ HAND-MIRRORED from OPS_ECON (index.html). A module cannot read it — the
   globals trap — so this is the one table here that can go stale. Only the
   INPUT side is listed: what an operation consumes is what the Foundry can
   supply it with. */
export const OPS_USES = {
  fuel: [
    { id: 'construction', name: 'Construction', why: 'burns 0.5/worker-hr' },
    { id: 'smuggling',    name: 'Smuggling',    why: 'burns 1.0/worker-hr — the thirstiest op there is' },
    { id: 'fishing',      name: 'Fishing',      why: 'burns 0.6/worker-hr' },
    { id: 'cars',         name: 'Cars',         why: 'burns 0.4/worker-hr' },
    { id: 'research',     name: 'Research',     why: 'burns 0.3/worker-hr' },
  ],
  metal: [
    { id: 'cars',     name: 'Cars',     why: 'consumes 1.2/worker-hr to build stock' },
    { id: 'research', name: 'Research', why: 'consumes 0.6/worker-hr' },
  ],
  supplies: [],   // nothing in OPS_ECON consumes Supplies today
};

/* Everything a material is good for, once it reaches the real ledger. */
export function usesFor(resId) {
  const city = (CITY_USES[resId] || []);
  return {
    city: city.filter(x => !x.build).slice(0, 4),
    builds: city.filter(x => x.build).length,
    ops: OPS_USES[resId] || [],
  };
}

/* The one-line "why should I care" for a machine, based on what its recipe
   eventually pays out as. Returns null when a machine only makes intermediates —
   saying "good for nothing" would be worse than saying nothing. */
export function purposeOf(st, id) {
  const s = machineStatus(st, id);
  const r = s && s.recipe ? recipeById(s.recipe) : null;
  if (!r) return null;
  const taps = Object.keys(normOut(r)).map(k => tapFor(k)).filter(Boolean);
  if (!taps.length) return null;
  const byRes = {};
  for (const t of taps) (byRes[t.to] || (byRes[t.to] = [])).push(t.from);
  return Object.keys(byRes).map(res => ({ res, from: byRes[res], uses: usesFor(res) }));
}

export default { ratePerHour, STATION_INFO, CITY_USES, OPS_USES, usesFor, purposeOf };
