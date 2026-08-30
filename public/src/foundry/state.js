/* ════════════════════════════════════════════════════════════════════════════
   ⏱ THE FOUNDRY — state + the clock. Where the line actually runs.
   ----------------------------------------------------------------------------
   Owns the player's inventory, machine levels/condition, the trim dial, and the
   wall-clock accrual that turns "I logged off with a full shredder" into metal.

   🔴 EVERY EXPORT TAKES A HOST. Nothing in this file reads a global. `Profile`,
   `getRes`, `addRes` and `spendGems` are top-level `const` in index.html —
   lexical bindings that are NOT on `window` (CLAUDE.md, "the globals trap",
   which the repo notes has cost real time twice). index.html hands the module
   window.MythicFoundryBridge, index.js narrows it to `h`, and it arrives here as
   an argument. If the Foundry needs something new from the legacy app, it is
   ADDED TO THE BRIDGE — never reached for.

   🔴 STOCK IS { qty, purity }, NOT A NUMBER. Purity is a weighted property of a
   PILE. Tipping 10 units of 90% scrap onto 90 units of 30% scrap gives you 100
   units of 36%, not two stacks and not 90%. mergeStock() is the only function
   allowed to write a stack, precisely so that averaging can never be skipped at
   one call site and applied at another — that class of bug is invisible in
   review and shows up weeks later as "my steel yield is wrong sometimes".
   ════════════════════════════════════════════════════════════════════════════ */

import {
  MATERIALS, matById, RECIPES, recipeById, recipesFor, normIn, normOut,
  resolvePurity, yieldAtPurity, tapFor,
} from './recipes.js';
import {
  MACHINES, machineById, BROWNOUT_SPEED, conditionSpeed,
  trimSpeed, trimPurity, levelSpeed, levelBuffer, repairCost,
} from './machines.js';

export const STATE_VERSION = 1;

/* ⏳ IDLE POLICY. The Foundry does NOT invent a third idle contract — the game
   already has one and index.html hands it over (OP_ACCRUAL_CAP_H). The fallback
   is only for a bridge mounted without it. */
const DEFAULT_CAP_H = 36;

/* Simulation granularity. One minute per slice is fine enough that a 20-second
   recipe does not quantise visibly, and 36h of catch-up is 2,160 slices — a few
   milliseconds. MAX_SLICES is the guard: if a save is somehow older than the cap
   (clock skew, a resumed device), slices WIDEN rather than multiplying, so the
   catch-up can never become an unbounded loop that hangs the page on load. */
const SLICE_MS = 60000;
const MAX_SLICES = 2200;

export const HALT = {
  OK: 'ok',
  NO_RECIPE: 'no-recipe',
  STARVED: 'starved',
  BUFFER_FULL: 'buffer-full',
  STORAGE_FULL: 'storage-full',
  BROKEN: 'broken',
  BROWNOUT: 'brownout',
};

export const HALT_TEXT = {
  [HALT.OK]: 'Running',
  [HALT.NO_RECIPE]: 'No recipe selected',
  [HALT.STARVED]: 'Waiting on input',
  [HALT.BUFFER_FULL]: 'Output buffer full',
  [HALT.STORAGE_FULL]: 'Yard is full',
  [HALT.BROKEN]: 'Broken — needs repair',
  [HALT.BROWNOUT]: 'Brownout — not enough power',
};

/* ── Stock helpers ───────────────────────────────────────────────────────── */

export function emptyStock() { return { qty: 0, purity: 0 }; }

export function stockOf(st, id) {
  const s = st && st.inv && st.inv[id];
  if (!s) return emptyStock();
  return { qty: Math.max(0, Number(s.qty) || 0), purity: Math.max(0, Math.min(1, Number(s.purity) || 0)) };
}

export function qtyOf(st, id) { return stockOf(st, id).qty; }

/* 🔴 THE ONLY WRITER. Weighted-average the incoming grade into the pile.
   Adding zero (or negative) must not disturb the existing purity — a no-op that
   silently reset a stack's grade to 0 would be a very quiet way to destroy a
   player's clean steel. */
export function mergeStock(st, id, addQty, addPurity) {
  if (!st.inv) st.inv = {};
  const cur = stockOf(st, id);
  const q = Number(addQty) || 0;
  if (q <= 0) { st.inv[id] = cur; return cur; }
  const p = Math.max(0, Math.min(1, Number(addPurity) || 0));
  const total = cur.qty + q;
  const purity = total > 0 ? ((cur.qty * cur.purity) + (q * p)) / total : 0;
  st.inv[id] = { qty: total, purity: Math.max(0, Math.min(1, purity)) };
  return st.inv[id];
}

/* Removing from a pile does NOT change its grade — you take a representative
   scoop, not the clean half. */
export function takeStock(st, id, n) {
  const cur = stockOf(st, id);
  const take = Math.min(cur.qty, Math.max(0, Number(n) || 0));
  if (!st.inv) st.inv = {};
  st.inv[id] = { qty: cur.qty - take, purity: cur.purity };
  return take;
}

/* ── State shape ─────────────────────────────────────────────────────────── */

export function ensureState(h) {
  let st = null;
  try { st = h.foundryState(); } catch (e) { st = null; }
  if (!st || typeof st !== 'object') st = {};
  if (typeof st.v !== 'number') st.v = STATE_VERSION;
  if (!st.inv || typeof st.inv !== 'object') st.inv = {};
  if (!st.machines || typeof st.machines !== 'object') st.machines = {};
  if (typeof st.trim !== 'number') st.trim = 0.5;
  if (typeof st.lastTick !== 'number') st.lastTick = Date.now();
  if (!st.log || !Array.isArray(st.log)) st.log = [];
  // Normalise any stack that a hand-edit or an older save left as a bare number.
  for (const k in st.inv) {
    const s = st.inv[k];
    if (typeof s === 'number') st.inv[k] = { qty: Math.max(0, s), purity: 0.5 };
    else if (!s || typeof s !== 'object') delete st.inv[k];
  }
  return st;
}

export function machineState(st, id) {
  const m = st.machines && st.machines[id];
  if (!m || typeof m !== 'object') return null;
  return {
    lv: Math.max(1, m.lv | 0),
    cond: Math.max(0, Math.min(100, Number(m.cond) === undefined ? 100 : Number(m.cond))),
    recipe: typeof m.recipe === 'string' ? m.recipe : null,
    on: m.on !== false,
    /* 🔴 carryMs MUST BE ON THIS OBJECT. runMachine reads its leftover time
       through machineState(), and this normaliser used to drop the field — so
       carry was silently always 0 and ANY recipe whose batch took longer than
       one 60s slice could never finish a batch at all. It presented as "the
       slow machines just don't work", which is a miserable thing to debug:
       fast recipes ran fine, so the line looked half-alive. Every field
       runMachine touches has to survive this function. */
    carryMs: Math.max(0, Number(m.carryMs) || 0),
  };
}

export const isBuilt = (st, id) => !!machineState(st, id);
export const builtMachines = (st) => MACHINES.filter(d => isBuilt(st, d.id));

/* ── Capacity ────────────────────────────────────────────────────────────── */

export function storageCap(st) {
  const y = machineState(st, 'yard');
  const base = 400; // a starting yard exists even before the player builds one
  if (!y) return base;
  const def = machineById('yard');
  return base + ((def.effect(y.lv) || {}).storage | 0);
}

export function storageUsed(st) {
  let n = 0;
  for (const k in st.inv) n += Math.max(0, Number(st.inv[k].qty) || 0);
  return Math.round(n);
}

/* ⚡ Grid capacity. A Powerhouse with no fuel in the tank produces NOTHING —
   it is a converter like any other, and that is what forces the refinery line
   to exist before the crush line can run at full speed. */
export function powerCapacity(st) {
  const p = machineState(st, 'powerhouse');
  if (!p || !p.on || p.cond <= 0) return 0;
  const def = machineById('powerhouse');
  const hasFuel = def.burns.some(f => qtyOf(st, f) > 0);
  if (!hasFuel) return 0;
  return ((def.effect(p.lv) || {}).power | 0);
}

export function powerDemand(st) {
  let n = 0;
  for (const d of MACHINES) {
    if (d.kind !== 'converter') continue;
    const m = machineState(st, d.id);
    if (!m || !m.on || m.cond <= 0 || !m.recipe) continue;
    n += d.power | 0;
  }
  return n;
}

/* ── Ordering ────────────────────────────────────────────────────────────── */

/* 🔗 RUN UPSTREAM FIRST, OR THE LINE TAKES AN HOUR PER SLICE TO FILL.
   If the furnace runs before the baler in a given slice, it sees the scrap the
   baler made LAST slice — so a five-stage line would need five minutes of
   simulated time to move one batch end to end, and a fresh line would look dead
   for the first few minutes. Topologically sorting by what the SELECTED recipes
   actually consume and produce means one slice can carry a unit the whole way.

   Derived from the live recipe selection rather than hardcoded because the
   machines are generic: a furnace running Non-Ferrous sits at a different depth
   than one running Pig Iron. Cycles fall back to declaration order — a cycle is
   not currently reachable, but "sorted wrong" must degrade to "runs in a fixed
   order", never to "drops a machine". */
export function runOrder(st) {
  const built = builtMachines(st).filter(d => d.kind === 'converter');
  const producedBy = {};
  for (const d of built) {
    const m = machineState(st, d.id);
    const r = m && m.recipe ? recipeById(m.recipe) : null;
    if (!r) continue;
    for (const out in normOut(r)) (producedBy[out] || (producedBy[out] = [])).push(d.id);
  }
  const depth = {}, visiting = {};
  const depthOf = (id) => {
    if (depth[id] !== undefined) return depth[id];
    if (visiting[id]) return 0;            // cycle guard — see note above
    visiting[id] = true;
    const m = machineState(st, id);
    const r = m && m.recipe ? recipeById(m.recipe) : null;
    let d = 0;
    if (r) {
      for (const inp in normIn(r)) {
        for (const src of (producedBy[inp] || [])) {
          if (src === id) continue;
          d = Math.max(d, depthOf(src) + 1);
        }
      }
    }
    visiting[id] = false;
    return (depth[id] = d);
  };
  return built
    .map((d, i) => ({ d, i, k: depthOf(d.id) }))
    .sort((a, b) => (a.k - b.k) || (a.i - b.i))
    .map(x => x.d);
}

/* ── The tick ────────────────────────────────────────────────────────────── */

/* Per-machine status for the UI. Pure — it must not mutate, because render.js
   calls it on every repaint and a status read that quietly consumed inputs
   would make the factory run faster the more you looked at it. */
export function machineStatus(st, id) {
  const def = machineById(id);
  const m = machineState(st, id);
  if (!def || !m) return null;
  const cap = powerCapacity(st), dem = powerDemand(st);
  const brown = dem > cap;
  let halt = HALT.OK;
  if (m.cond <= 0) halt = HALT.BROKEN;
  else if (def.kind === 'converter' && !m.recipe) halt = HALT.NO_RECIPE;
  else if (def.kind === 'converter') {
    const r = recipeById(m.recipe);
    if (!r) halt = HALT.NO_RECIPE;
    else if (!canRun(st, r)) halt = HALT.STARVED;
    else if (bufferFull(st, def, m, r)) halt = HALT.BUFFER_FULL;
    // Same NET rule the run loop uses — a status that said STORAGE_FULL while
    // the machine happily ran would be worse than no status at all.
    else if (!netFits(st, r)) halt = HALT.STORAGE_FULL;
    else if (brown) halt = HALT.BROWNOUT;
  }
  return {
    def, ...m, halt, haltText: HALT_TEXT[halt],
    speed: effectiveSpeed(st, def, m, brown),
    buffer: levelBuffer(def, m.lv),
    brownout: brown,
  };
}

function effectiveSpeed(st, def, m, brown) {
  let s = levelSpeed(m.lv) * conditionSpeed(m.cond) * trimSpeed(st.trim);
  if (brown) s *= BROWNOUT_SPEED;
  return s;
}

/* Would one batch of `r` fit in the yard? Net of what it consumes. */
function netFits(st, r) {
  const room = Math.max(0, storageCap(st) - storageUsed(st));
  let inSum = 0, outSum = 0;
  for (const k in normIn(r)) inSum += normIn(r)[k];
  for (const k in normOut(r)) outSum += normOut(r)[k];
  return (room + inSum) >= outSum;
}

function canRun(st, r) {
  const need = normIn(r);
  for (const k in need) if (qtyOf(st, k) < need[k]) return false;
  return true;
}

/* A machine stops when its OWN outputs have piled past its buffer — the
   downstream stage has not taken them. This is backpressure, and it is the
   mechanic that makes balancing a line matter. production.data.js warns that a
   halted building reads as a broken one, which is why the reason is surfaced. */
function bufferFull(st, def, m, r) {
  const cap = levelBuffer(def, m.lv);
  if (!cap) return false;
  let held = 0;
  for (const k in normOut(r)) held += qtyOf(st, k);
  return held >= cap;
}

/* The weighted grade of what a recipe is about to consume. */
function inputPurity(st, r) {
  const need = normIn(r);
  let q = 0, acc = 0;
  for (const k in need) {
    const s = stockOf(st, k);
    q += need[k];
    acc += need[k] * s.purity;
  }
  return q > 0 ? acc / q : 0;
}

/* Per-machine, per-material fractional output carry — see the banking note in
   runMachine(). Lives on the machine record so it persists across saves; without
   that, a player who closes the tab between batches loses the remainder and the
   bias creeps back in. */
function fracLedger(st, id) {
  const m = st.machines[id];
  if (!m.frac || typeof m.frac !== 'object') m.frac = {};
  return m.frac;
}

/* Run one machine for `ms`. Returns batches completed. */
function runMachine(st, def, ms, brown, room) {
  const m = machineState(st, def.id);
  if (!m || !m.on || m.cond <= 0) return 0;
  const r = m.recipe ? recipeById(m.recipe) : null;
  if (!r) return 0;

  const speed = effectiveSpeed(st, def, m, brown);
  if (speed <= 0) return 0;

  const perBatchMs = (r.secs * 1000) / speed;
  let budget = ms + (Number(m.carryMs) || 0);
  let batches = 0;
  const cap = levelBuffer(def, m.lv);

  while (budget >= perBatchMs) {
    if (!canRun(st, r)) break;
    if (cap) {
      let held = 0;
      for (const k in normOut(r)) held += qtyOf(st, k);
      if (held >= cap) break;
    }
    const inPur = inputPurity(st, r);
    const need = normIn(r);
    /* Trim's purity penalty lands only on separators, and the yield penalty only
       on grade-sensitive metallurgy — see the notes on TRIM_PURITY (machines.js)
       and yieldAtPurity (recipes.js). Both bounds exist because the unbounded
       version compounded down a six-stage chain into zero output. */
    const outPurity = Math.max(0, Math.min(1, resolvePurity(r, inPur) + (def.separator ? trimPurity(st.trim) : 0)));
    const mult = r.gradeSensitive ? yieldAtPurity(outPurity) : 1;
    const outs = normOut(r);

    /* 🔴 SPACE IS CHECKED ON THE NET, NOT ON THE OUTPUT. Refining is USUALLY
       space-NEGATIVE — smelting 10 scrap + 4 coal into 7 pig iron and 2 slag
       gives 5 units of the yard back. An earlier cut of this loop bailed
       whenever the yard was at capacity, which meant a player who filled the
       yard with feedstock (the obvious opening move, and one buyFeed will
       happily sell them right up to the ceiling) deadlocked every machine
       permanently: nothing could run, so nothing could ever be consumed, so
       the yard could never drain. Netting it means a full yard still runs
       anything that shrinks the pile, and only genuinely space-POSITIVE
       recipes wait for room. */
    let inSum = 0, outSum = 0;
    for (const k in need) inSum += need[k];
    for (const k in outs) outSum += Math.max(0, Math.round(outs[k] * mult));
    if ((room.left + inSum) < outSum) break;

    for (const k in need) takeStock(st, k, need[k]);
    room.left += inSum;

    const frac = fracLedger(st, def.id);
    for (const k in outs) {
      /* 🔴 THE PURITY MULTIPLIER HITS OUTPUT ONLY — inputs were already taken at
         full price above. Charging full and paying partial is the entire cost of
         running dirty; applying it to both would make contamination free.

         🔴 AND IT IS BANKED AS A FRACTION, NOT FLOORED.
         This was `Math.floor(outs[k] * mult)`, which DELETED any output whose
         batch quantity was small. The Magnetic Sorter emits 1 non-ferrous and
         1 glass per batch; at 90% purity the multiplier is ~0.99, so both floored
         to ZERO — every batch, forever. Those two streams simply did not exist in
         the game, which starved the Recyclate Baler and was invisible in review
         because the big outputs (4 ferrous, 3 plastic) came through fine.
         Carrying the remainder per machine per material makes the yield exact
         over time instead of biased down, and means a 1-unit output is never
         rounded out of existence. */
      const exact = Math.max(0, outs[k] * mult) + (Number(frac[k]) || 0);
      const n = Math.floor(exact);
      frac[k] = exact - n;
      if (n > 0) { mergeStock(st, k, n, outPurity); room.left -= n; }
    }
    // Wear is per BATCH, never per second — an idle machine does not rot, so
    // logging off is never punished. (OSIM_DECAY_PER_UNIT precedent.)
    const cur = st.machines[def.id];
    cur.cond = Math.max(0, (Number(cur.cond) === undefined ? 100 : Number(cur.cond)) - (def.wear || 0));
    budget -= perBatchMs;
    batches++;
    if (cur.cond <= 0) break;
  }
  // Keep the remainder so a 20s recipe does not lose 40s of every 60s slice.
  st.machines[def.id].carryMs = Math.max(0, Math.min(budget, perBatchMs));
  return batches;
}

/* 🔥 The Powerhouse burns while the grid is under load. It is charged per slice
   rather than per batch because it powers the LINE, not a recipe. */
function burnFuel(st, ms) {
  const p = machineState(st, 'powerhouse');
  if (!p || !p.on || p.cond <= 0) return;
  const def = machineById('powerhouse');
  if (powerDemand(st) <= 0) return; // nothing drawing — do not burn for an idle yard
  /* `want` is in GRID-MINUTES of demand; each fuel converts at its own
     efficiency (burnEff), so a boiler blend goes further than premium gasoline. */
  const want = (def.burnRate || 1) * (ms / 60000) * p.lv;
  let need = want;
  for (const f of def.burns) {
    if (need <= 0) break;
    const eff = (def.burnEff && def.burnEff[f]) || 1;
    const got = takeStock(st, f, need * eff);
    need -= got / eff;
  }
  /* 🔴 WEAR IS PRO-RATA ON FUEL ACTUALLY BURNED, NOT ON ELAPSED TIME.
     This read `cond -= wear * minutes`, which rotted the Powerhouse at 0.4/min
     whether or not it had a drop of fuel — 8 hours of catch-up took a brand new
     one from 100% to 0% and broke the grid before the player ever saw it. Worse,
     it punished exactly the player who had no fuel yet, i.e. every new player.
     Burning nothing now costs nothing, which also keeps the rule the rest of the
     machines follow: things wear from WORK, never from the passage of time. */
  const burned = Math.max(0, want - Math.max(0, need));
  if (burned <= 0) return;
  const cur = st.machines.powerhouse;
  cur.cond = Math.max(0, Number(cur.cond) - (def.wear || 0) * burned);
}

/* 🕰 ACCRUAL. Advance the whole line from lastTick to now, capped. Returns a
   summary the UI can show as "while you were away". */
export function tick(st, h, nowMs) {
  const now = Number(nowMs) || Date.now();
  const capH = (() => { try { return h.accrualCapH() || DEFAULT_CAP_H; } catch (e) { return DEFAULT_CAP_H; } })();
  const capMs = capH * 3600000;

  let elapsed = now - (Number(st.lastTick) || now);
  /* ⚠ A NEGATIVE ELAPSED IS A CLOCK MOVING BACKWARDS, NOT FREE PRODUCTION.
     Device clock changes and timezone-shifted resumes both produce one. Clamp to
     zero and re-anchor, rather than letting a subtraction run the line in
     reverse or a huge negative become a huge positive downstream. */
  if (elapsed < 0) { st.lastTick = now; return { elapsedMs: 0, batches: 0, capped: false, produced: {} }; }

  const capped = elapsed > capMs;
  if (capped) elapsed = capMs;
  if (elapsed < 1000) { st.lastTick = now; return { elapsedMs: 0, batches: 0, capped: false, produced: {} }; }

  const before = {};
  for (const k in st.inv) before[k] = st.inv[k].qty;

  let slices = Math.ceil(elapsed / SLICE_MS);
  let sliceMs = SLICE_MS;
  if (slices > MAX_SLICES) { slices = MAX_SLICES; sliceMs = elapsed / slices; }

  let batches = 0;
  for (let i = 0; i < slices; i++) {
    const order = runOrder(st);
    const brown = powerDemand(st) > powerCapacity(st);
    const room = { left: Math.max(0, storageCap(st) - storageUsed(st)) };
    for (const def of order) batches += runMachine(st, def, sliceMs, brown, room);
    burnFuel(st, sliceMs);
  }

  const produced = {};
  for (const k in st.inv) {
    const d = Math.round(st.inv[k].qty - (before[k] || 0));
    if (d > 0) produced[k] = d;
  }
  st.lastTick = now;
  return { elapsedMs: elapsed, batches, capped, produced };
}

/* ── Player actions. Every one returns { ok, why } — never throws. ───────── */

export function setTrim(st, h, v) {
  st.trim = Math.max(0, Math.min(1, Number(v) || 0));
  h.save();
  return { ok: true };
}

export function setRecipe(st, h, machineId, recipeId) {
  const m = machineState(st, machineId);
  if (!m) return { ok: false, why: 'That machine is not built yet.' };
  if (recipeId) {
    const r = recipeById(recipeId);
    if (!r || r.machine !== machineId) return { ok: false, why: 'That recipe does not run on this machine.' };
  }
  st.machines[machineId].recipe = recipeId || null;
  h.save();
  return { ok: true };
}

export function toggleMachine(st, h, machineId) {
  const m = machineState(st, machineId);
  if (!m) return { ok: false, why: 'That machine is not built yet.' };
  st.machines[machineId].on = !m.on;
  h.save();
  return { ok: true, on: st.machines[machineId].on };
}

export function nextCost(def, lv) {
  const i = Math.max(0, (lv | 0));
  return (def.cost && def.cost[i]) || null;
}

export function build(st, h, machineId) {
  const def = machineById(machineId);
  if (!def) return { ok: false, why: 'Unknown machine.' };
  if (isBuilt(st, machineId)) return { ok: false, why: 'Already built.' };
  const cost = nextCost(def, 0);
  if (!cost) return { ok: false, why: 'No build cost defined.' };
  const paid = h.spendCost(cost);
  if (!paid.ok) return { ok: false, why: paid.why };
  st.machines[machineId] = { lv: 1, cond: 100, recipe: null, on: true, carryMs: 0 };
  // Default to the first recipe so a freshly built machine is not a mystery box
  // sitting at "No recipe selected" — the player can change it immediately.
  const rs = recipesFor(machineId);
  if (rs.length) st.machines[machineId].recipe = rs[0].id;
  if (!h.save()) {
    /* 🔴 REFUND ON A FAILED SAVE. MythicCityBridge learned this the hard way:
       a save() throw once charged a player 50,000 Cinder for a building that
       never persisted, and build() still reported success. */
    h.refundCost(cost);
    delete st.machines[machineId];
    return { ok: false, why: 'Could not save — the build was refunded.' };
  }
  return { ok: true };
}

export function upgrade(st, h, machineId) {
  const def = machineById(machineId);
  const m = machineState(st, machineId);
  if (!def || !m) return { ok: false, why: 'That machine is not built yet.' };
  if (m.lv >= (def.maxLevel | 0)) return { ok: false, why: 'Already at maximum level.' };
  const cost = nextCost(def, m.lv);
  if (!cost) return { ok: false, why: 'No upgrade cost defined.' };
  const paid = h.spendCost(cost);
  if (!paid.ok) return { ok: false, why: paid.why };
  st.machines[machineId].lv = m.lv + 1;
  if (!h.save()) {
    h.refundCost(cost);
    st.machines[machineId].lv = m.lv;
    return { ok: false, why: 'Could not save — the upgrade was refunded.' };
  }
  return { ok: true, lv: m.lv + 1 };
}

export function repair(st, h, machineId) {
  const def = machineById(machineId);
  const m = machineState(st, machineId);
  if (!def || !m) return { ok: false, why: 'That machine is not built yet.' };
  if (m.cond >= 100) return { ok: false, why: 'Already in perfect condition.' };
  const cost = repairCost(def, m.cond);
  const paid = h.spendCost(cost);
  if (!paid.ok) return { ok: false, why: paid.why };
  st.machines[machineId].cond = 100;
  if (!h.save()) {
    h.refundCost(cost);
    st.machines[machineId].cond = m.cond;
    return { ok: false, why: 'Could not save — the repair was refunded.' };
  }
  return { ok: true };
}

export default {
  STATE_VERSION, HALT, HALT_TEXT,
  ensureState, machineState, isBuilt, builtMachines,
  stockOf, qtyOf, mergeStock, takeStock,
  storageCap, storageUsed, powerCapacity, powerDemand, runOrder,
  machineStatus, tick,
  setTrim, setRecipe, toggleMachine, build, upgrade, repair, nextCost,
};
