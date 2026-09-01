/* ════════════════════════════════════════════════════════════════════════════
   💧 THE HYDROLOGY MODEL — extraction, depletion, recharge, contamination.
   ----------------------------------------------------------------------------
   endowment.js is the ground AS IT WAS MADE and never changes. This file is the
   ground AS IT IS NOW: how much is left in each basin, how clean it still is,
   and therefore what a waterworks standing on it can actually deliver this tick.

   ── THE SINGLE-TRUTH RULE (the same one /src/power states) ──────────────────
   There must be exactly one answer to "how much water does this city make".
     • THE HOST OWNS THE RATE. `def.gen.water * tileMult(...)` is node-city's
       central production multiplier — weather, adjacency, staffing, level,
       mayor, morale and the output cap are all already in it. Re-deriving any
       of that here would be a second economy.
     • THIS MODULE OWNS THE GROUND, which the host has never modelled: whether
       there is water under the tile, how much is left, and how clean it is.
     • So `solve()` returns a FACTOR PER TILE, never a rate. The host multiplies
       its own number by ours. Neither side can drift, because only one side has
       ever seen the rate.

   ── 🔴 THE CONTRACT TRAP THIS MODULE WAS WARNED ABOUT ───────────────────────
   node-city already has `game.power = { gen, demand, ratio, factor }` and the
   agreed cross-workflow shape is `{ capacity, load, factor, byPlant }`. Handing
   one back as the other satisfies every guarded read — `factor` is present and
   truthy — while feeding `undefined` capacity to its consumers, and it looks
   like a working feature forever. The water contract is
   `{ capacity, draw, shortfall }`, and index.js maps this solve's fields onto it
   EXPLICITLY, key by key, with no spread and no pass-through. If a field is
   missing it must read as missing, not as a plausible number from a neighbour.

   ── DEPLETION IS THE POINT ──────────────────────────────────────────────────
   An aquifer pumped harder than it recharges draws down, its yield falls on a
   curve, and the city's water production falls with it. Stop pumping and it
   comes back. That is what makes a dry city a constraint the player can play
   against rather than flavour text — and it is the reason `stock` is one of the
   two numbers this module persists.
   ════════════════════════════════════════════════════════════════════════════ */

import { WATER } from './tuning.js';
import { hydrologyFor, riverPosition } from './endowment.js';

/* ── LIVE STATE ─────────────────────────────────────────────────────────────
   Two arrays and a scalar, all keyed to a cityId. Persisted; see index.js
   save()/load(). Everything else is re-derived from the endowment every tick,
   because everything else is pure. */
let S = null;   // { cityId, grid, stock:[], taint:[], surfaceTaint }

function fresh(H) {
  return {
    cityId: H.cityId, grid: H.grid,
    stock: H.basins.map(b => b.volume),   // a new city starts with full basins
    taint: H.basins.map(() => 0),
    surfaceTaint: 0,
  };
}

/* Adopt state for this city, creating it if absent and DISCARDING it if it
   belongs to a different city or a different basin count.
   ⚠ The count check is not paranoia: a tuning change to `endow.basinsMax`
     changes how many basins a city has, and a saved array of the old length
     would leave a basin permanently at `undefined` stock — which is NaN the
     first time it is pumped, and NaN water production is a city that quietly
     dies with no message. Same class of bug as the `Math.floor(str)` one
     ECONOMY.md records in households.load. */
function sync(H) {
  if (!S || S.cityId !== H.cityId || S.grid !== H.grid || S.stock.length !== H.basins.length) {
    S = fresh(H);
    return;
  }
  for (let i = 0; i < H.basins.length; i++) {
    if (!isFinite(S.stock[i])) S.stock[i] = H.basins[i].volume;
    S.stock[i] = Math.max(0, Math.min(H.basins[i].volume, S.stock[i]));
    if (!isFinite(S.taint[i])) S.taint[i] = 0;
    S.taint[i] = Math.max(0, Math.min(1, S.taint[i]));
  }
  if (!isFinite(S.surfaceTaint)) S.surfaceTaint = 0;
}

export function state() { return S; }
export function reset() { S = null; }

export function save() {
  if (!S) return null;
  return { v: 1, cityId: S.cityId, grid: S.grid,
           stock: S.stock.map(n => +(+n).toFixed(3)),
           taint: S.taint.map(n => +(+n).toFixed(4)),
           surfaceTaint: +(+S.surfaceTaint).toFixed(4) };
}

/* Optional-with-default in both directions: a blob from a save written before
   this feature existed is `undefined`, and a blob from a DIFFERENT city is
   refused by sync() on the next tick. Neither can throw. */
export function load(blob) {
  if (!blob || typeof blob !== 'object' || !Array.isArray(blob.stock)) { S = null; return; }
  S = {
    cityId: String(blob.cityId == null ? '' : blob.cityId),
    grid: (blob.grid | 0) || 24,
    stock: blob.stock.map(n => (isFinite(+n) ? Math.max(0, +n) : 0)),
    taint: (Array.isArray(blob.taint) ? blob.taint : []).map(n => (isFinite(+n) ? Math.max(0, Math.min(1, +n)) : 0)),
    surfaceTaint: isFinite(+blob.surfaceTaint) ? Math.max(0, Math.min(1, +blob.surfaceTaint)) : 0,
  };
  while (S.taint.length < S.stock.length) S.taint.push(0);
}

/* ── PURITY → USABLE WATER ──────────────────────────────────────────────────
   A contaminated source is not unusable, it is expensive: the plant rejects part
   of the draw. `usableFloor` is what survives treatment even at purity 0 —
   without it a fully poisoned aquifer would read as "no water here at all",
   which is a shortage, and a shortage is the wrong story. The right story is
   "you are running the same plant for less water". */
function usable(purity) {
  const p = Math.max(0, Math.min(1, purity));
  const f = WATER.purity.usableFloor;
  return f + (1 - f) * Math.pow(p, WATER.purity.exp);
}

/* Level → yield, on a curve. The first third of the reserve costs almost
   nothing; the last third costs most of the yield. */
function levelYield(level) {
  const l = Math.max(0, Math.min(1, level));
  return Math.pow(l, WATER.aquifer.yieldCurve);
}

/* ── WHAT IS UNDER (OR BESIDE) THIS TILE, RIGHT NOW ─────────────────────────
   The live counterpart to endowment().groundAt. Returns the agreed cross-
   workflow shape plus the two extras the neighbouring modules already read:
   `flow` (0..1 surface presence — /src/power/overlay.js paints this) and
   `basin` (which body it came from, so the panel can name it). */
export function sourceAt(H, x, z) {
  sync(H);
  const g = H.basinAt(x, z);
  const flow = H.surfaceAt(x, z);
  const sPur = WATER.surface.purity * (1 - S.surfaceTaint * WATER.purity.bite);

  let ground = null;
  if (g) {
    const i = g.basin.i;
    const level = g.basin.volume > 0 ? S.stock[i] / g.basin.volume : 0;
    ground = {
      kind: 'aquifer', basin: i, name: g.basin.name,
      strength: g.strength, level,
      yield: g.strength * levelYield(level),
      purity: g.basin.purity * (1 - S.taint[i] * WATER.purity.bite),
      flow: 0,
    };
  }
  const surf = flow > 0.05
    ? { kind: 'surface', basin: -1, name: H.surface.river && riverPosition(H.surface, x, z, H.grid) != null ? 'River' : 'Lake',
        strength: flow, level: 1, yield: flow, purity: sPur, flow }
    : null;

  /* Which source a waterworks here would actually use: whichever yields more
     usable water. Surface almost always wins where it exists, which is correct —
     an intake beats a well — and is exactly why the pollution lesson is about
     surface water first. */
  const score = (s) => (s ? s.yield * usable(s.purity) : -1);
  let best = score(surf) >= score(ground) ? surf : ground;
  if (!best) return { kind: 'none', basin: -1, name: '', strength: 0, level: 0, yield: 0, purity: 1, flow };
  // `flow` always reports SURFACE presence, whichever source won — the power
  // overlay's "Surface Water Flow" layer reads this field and must not be
  // handed an aquifer number under the same name.
  return { ...best, flow };
}

/* The extraction multiplier for a waterworks on this tile: what fraction of its
   host-declared output the ground supports. Returns the decomposition too, so
   the panel's causal list is the same arithmetic the tick charged rather than a
   second derivation of it (the failure node-city's own `insFactors` header
   warns about). */
export function factorAt(H, x, z) {
  const src = sourceAt(H, x, z);
  const E = WATER.extract;
  let gain = 0;
  if (src.kind === 'aquifer') gain = E.groundGain * Math.min(1, src.yield) * usable(src.purity);
  else if (src.kind === 'surface') gain = E.surfaceGain * Math.min(1, src.yield) * usable(src.purity);
  const raw = E.atmos + gain;
  const factor = Math.max(E.min, Math.min(E.max, raw));
  return { factor, atmos: E.atmos, gain: factor - E.atmos, src,
           capped: raw > E.max, usable: usable(src.purity) };
}

/* ── POLLUTION COUPLING ─────────────────────────────────────────────────────
   🔴 PULLED, NOT INVENTED. /src/pollution is a parallel workflow and may land
      at any time, including after this module has mounted — so the global is
      re-read every tick rather than cached. If it is absent NOTHING happens:
      taint stays where it is, the panel says contamination monitoring is
      inactive and names the global it is waiting for, and the overlay draws
      clean water because the water IS clean. Synthesising a plausible pollution
      field here would light the whole mechanic up and be indistinguishable from
      the real thing at a glance — "a guarded fallback that fires forever looks
      exactly like a working feature", which is the specific failure this batch
      was told to avoid. */
function pollutionSample(H, dtMin) {
  const P = (typeof window !== 'undefined' && window.MythicPollution) || null;
  const active = !!(P && typeof P.groundAt === 'function');
  if (!active) return { active: false };

  // Ground: each basin takes the WORST reading over its own footprint. A coal
  // plant on the rim of a basin poisons the basin; averaging over the disc would
  // dilute one bad tile into nothing and the lesson would never land.
  for (const b of H.basins) {
    let worst = 0;
    for (let a = 0; a < 8; a++) {
      const th = a * Math.PI / 4;
      for (const rr of [0, 0.5, 0.9]) {
        const x = b.cx + Math.cos(th) * b.r * rr, z = b.cz + Math.sin(th) * b.r * rr;
        let v = 0;
        try { v = Number(P.groundAt(x, z)); } catch (e) { v = 0; }
        if (isFinite(v) && v > worst) worst = Math.min(1, v);
      }
    }
    const cur = S.taint[b.i];
    const rate = worst > cur ? WATER.purity.groundRise : WATER.purity.groundFall;
    const k = 1 - Math.exp(-rate * dtMin / 60);   // per-hour rates, eased
    S.taint[b.i] = Math.max(0, Math.min(1, cur + (worst - cur) * k));
  }

  // Surface: one city-wide figure, taken at the dirtiest point of the channel
  // and then applied to the whole of it at the `downstream` share. A 24-tile
  // river is not long enough for a per-tile transport model to say anything this
  // does not; what matters is that pollution UPSTREAM reaches an intake
  // DOWNSTREAM, and that it does so faster than an aquifer poisons.
  if (H.surface.river || H.surface.lakes.length) {
    let worst = 0;
    const wf = typeof P.waterAt === 'function' ? P.waterAt : P.groundAt;
    for (let x = 0; x < H.grid; x += 2) for (let z = 0; z < H.grid; z += 2) {
      if (H.surfaceAt(x, z) < 0.2) continue;
      let v = 0;
      try { v = Number(wf.call(P, x, z)); } catch (e) { v = 0; }
      if (isFinite(v) && v > worst) worst = Math.min(1, v);
    }
    const target = worst * WATER.surface.downstream;
    const cur = S.surfaceTaint;
    const rate = target > cur ? WATER.surface.taintRise : WATER.surface.taintFall;
    const k = 1 - Math.exp(-rate * dtMin / 60);
    S.surfaceTaint = Math.max(0, Math.min(1, cur + (target - cur) * k));
  }
  return { active: true };
}

/* An optional PUSH path for the pollution module, for the case where it would
   rather tell us about an event than be sampled for a field. Additive: the pull
   above remains the primary path, and a module that never calls this is not
   penalised. */
export function taint(H, x, z, amount) {
  sync(H);
  const a = Math.max(0, Math.min(1, Number(amount) || 0));
  if (!a) return false;
  const g = H.basinAt(x, z);
  if (g) S.taint[g.basin.i] = Math.min(1, S.taint[g.basin.i] + a);
  if (H.surfaceAt(x, z) > 0.2) S.surfaceTaint = Math.min(1, S.surfaceTaint + a);
  return true;
}

/* ════════════════════════════════════════════════════════════════════════════
   THE TICK
   ════════════════════════════════════════════════════════════════════════════ */
export function solve(snap) {
  if (!snap) return { ok: false, why: 'no snapshot' };
  const H = hydrologyFor(snap.cityId, snap.grid);
  sync(H);

  /* ⏱ THE dt GUARD. ECONOMY.md records an `Infinity` dt surviving the economy's
     guard and running three economic days off one bad clock read. The same bad
     read here would empty every aquifer in the city in one frame and the player
     would have no way to attribute it. Clamped, never trusted. */
  let dtMin = Number(snap.dtMin);
  if (!isFinite(dtMin) || dtMin <= 0) dtMin = 0;
  dtMin = Math.min(dtMin, 240);

  const wells = Array.isArray(snap.wells) ? snap.wells : [];
  const users = Array.isArray(snap.users) ? snap.users : [];

  const poll = pollutionSample(H, dtMin);

  // ── 1. EXTRACTION. Each waterworks against the ground under it.
  const factor = {};                 // tile key -> multiplier the host applies
  const perWell = [];
  const pumpPerBasin = H.basins.map(() => 0);
  let capacity = 0, pumped = 0, surfaceDraw = 0, rejected = 0;

  for (const w of wells) {
    const want = Number(w.want);
    const f = factorAt(H, w.x, w.z);
    factor[w.k] = f.factor;
    if (!isFinite(want) || want <= 0) {
      perWell.push({ ...w, want: 0, out: 0, factor: f.factor, src: f.src.kind,
                     srcName: f.src.name, purity: f.src.purity, level: f.src.level });
      continue;
    }
    const out = want * f.factor;
    capacity += out;
    /* 🔴 ONLY THE PART ABOVE `atmos` IS PUMPED, because only that part came from
       the ground. Charging the whole output against the aquifer would drain
       every basin in a city whose purifiers never touched one — a leak in the
       same family as the four ECONOMY.md documents, and it would have looked
       perfectly correct in review. */
    const fromSource = want * Math.max(0, f.factor - f.atmos);
    if (f.src.kind === 'aquifer') { pumpPerBasin[f.src.basin] += fromSource; pumped += fromSource; }
    else if (f.src.kind === 'surface') surfaceDraw += fromSource;
    // What contamination cost this well, in water/minute, for the causal list.
    if (f.src.kind !== 'none' && f.usable < 1) {
      const clean = Math.max(WATER.extract.min, Math.min(WATER.extract.max,
        f.atmos + (f.src.kind === 'aquifer' ? WATER.extract.groundGain : WATER.extract.surfaceGain) * Math.min(1, f.src.yield)));
      rejected += Math.max(0, want * (clean - f.factor));
    }
    perWell.push({ ...w, want, out, factor: f.factor, src: f.src.kind, srcName: f.src.name,
                   purity: f.src.purity, level: f.src.level, gain: f.gain });
  }

  // ── 2. DEPLETION AND RECHARGE.
  let recharge = 0;
  const basins = H.basins.map(b => {
    const pump = pumpPerBasin[b.i];
    const before = S.stock[b.i];
    let stock = before - pump * dtMin;
    const room = b.volume - Math.max(0, stock);
    const gain = Math.min(Math.max(0, room), b.recharge * dtMin);
    stock = Math.max(0, Math.min(b.volume, Math.max(0, stock) + gain));
    S.stock[b.i] = stock;
    recharge += b.recharge;
    const level = b.volume > 0 ? stock / b.volume : 0;
    const purity = b.purity * (1 - S.taint[b.i] * WATER.purity.bite);
    return {
      i: b.i, name: b.name, cx: b.cx, cz: b.cz, r: b.r, strength: b.strength,
      volume: b.volume, stock, level, recharge: b.recharge, pump, springfed: b.springfed,
      basePurity: b.purity, taint: S.taint[b.i], purity,
      // The three words the panel needs, decided here so the panel cannot invent
      // a fourth: what is this basin DOING.
      /* ⚠ THE SECOND CLAUSE OF `drawdown` IS NOT REDUNDANT. A basin pumped to
         the bottom reads `pump ≤ recharge` — not because the city stopped
         taking water but because there is none left to take, so the well is
         pulling exactly the recharge as it arrives. Without the level test the
         emptiest basin in the city reported "recharging", which is true and
         entirely misleading. */
      status: purity < WATER.purity.badBelow ? 'contaminated'
            : (pump > b.recharge * 1.02 || (pump > 0 && level < 0.5)) ? 'drawdown'
            : stock >= b.volume - 1e-6 ? 'full'
            : purity < WATER.purity.warnBelow ? 'tainted' : 'recharging',
    };
  });

  // ── 3. DEMAND. The host owns both halves of it; we only add them up.
  let use = 0;
  for (const u of users) { const d = Number(u.draw); if (isFinite(d) && d > 0) use += d; }
  const pop = Math.max(0, Number(snap.pop) || 0);
  const perPop = Number(snap.drinkPerMin);
  /* ⚠ NO DEFAULT FOR `drinkPerMin`. It is node-city's `MORALE.drinkPerPopPerMin`
     and it belongs to the host — inventing a value here would make the panel
     quote a thirst figure the game does not charge. Missing ⇒ the drink term is
     0 and `demandKnown` is false, and the panel says the demand figure is
     partial rather than printing a confident wrong one. */
  const demandKnown = isFinite(perPop) && perPop >= 0;
  const drink = demandKnown ? pop * perPop : 0;
  const draw = use + drink;
  const shortfall = Math.max(0, draw - capacity);

  const meanLevel = basins.length ? basins.reduce((s, b) => s + b.level, 0) / basins.length : 1;
  const drawWeight = perWell.reduce((s, w) => s + (w.out || 0), 0);
  const meanPurity = drawWeight > 0
    ? perWell.reduce((s, w) => s + (w.out || 0) * (w.src === 'none' ? 1 : w.purity), 0) / drawWeight
    : (basins.length ? basins.reduce((s, b) => s + b.purity, 0) / basins.length : 1);

  return {
    ok: true, model: 'hydro',
    cityId: H.cityId, grid: H.grid, wetness: H.wetness, cls: H.cls,
    capacity, draw, shortfall, use, drink, demandKnown,
    pumped, surfaceDraw, recharge, rejected,
    factor, wells: perWell, basins,
    /* Echoed, not recomputed. The overlay's consumption layer paints exactly
       what the host charged this tick; deriving a second per-tile draw here
       would be a second demand figure that agrees with the first until somebody
       retunes one of them. */
    users: users.map(u => ({ k: u.k, x: u.x, z: u.z, name: u.name, ico: u.ico, draw: Number(u.draw) || 0 })),
    surface: { river: !!H.surface.river, lakes: H.surface.lakes.length,
               taint: S.surfaceTaint,
               purity: WATER.surface.purity * (1 - S.surfaceTaint * WATER.purity.bite),
               draw: surfaceDraw },
    meanLevel, meanPurity,
    pollution: poll.active,
    /* Over-pumping, as a single flag the host and the panel can both read.
       ⚠ PER BASIN, NOT ON THE TOTALS. A city with one hammered basin and two
         idle ones has a citywide pumped-vs-recharge that looks healthy while the
         only basin anyone is drinking from empties — averaging is exactly how a
         located resource gets reported as if it were a global number, which is
         the mistake this whole module exists to correct. */
    overdraft: basins.some(b => b.pump > b.recharge * 1.02),
  };
}
