/* ════════════════════════════════════════════════════════════════════════════
   ☁ THE THREE FIELDS — air, ground, water — over the 24×24 tile grid.
   ----------------------------------------------------------------------------
   THEY BEHAVE DIFFERENTLY AND THAT DIFFERENCE IS THE GAMEPLAY:

     AIR    is emitted at a source and CARRIED DOWNWIND. Semi-Lagrangian
            advection along the wind vector, a little isotropic spread, and a
            fast decay that the wind itself accelerates. Upwind of a coal plant
            is clean; downwind is not; and the moment the plant stops, the air
            recovers within minutes. Air pollution is a FLOW problem.
     GROUND spreads slowly and locally and does NOT blow away. Half-life is a
            game day and a half. It is what a player zones around. Ground
            pollution is a STOCK problem.
     WATER  is the surface channel. It takes run-off from the ground beside it
            and carries it DOWNSTREAM.

   And the two couplings between them, which are the mechanic:
     ☁→🕳 FALLOUT: air settles into the ground under it, so the ash from a coal
           plant lands DOWNWIND of the stack rather than in a tidy circle.
     🕳→💧 RUN-OFF: ground washes into surface water.
   The aquifer is poisoned by a THIRD path this file does not run: /src/water
   pulls `groundAt()` itself. See tuning.js `water.seep` for why that must stay
   a pull and never become a push.

   ════════════════════════════════════════════════════════════════════════════
   🔴 CONSERVATION, AND WHY THIS FILE ASSERTS IT.
      ECONOMY.md's one rule is "Cinder is never minted", enforced by an identity
      `sim.js` checks every tick — because four real leaks were found during
      development and "every one of them looked correct in review". Fallout and
      run-off are transfers of exactly that shape: two lines, one subtracting
      from a field and one adding to another, and a version that ADDS to the
      destination without subtracting from the source is a pollution faucet that
      looks identical in a diff. So both transfers go through `move()`, which is
      the only function in this file that may write two fields, and `audit()`
      re-derives the total across all three every step and reports a breach.
      A field that quietly gains mass would present as "pollution seems a bit
      strong lately", which is unfindable.

   🔴 PERFORMANCE. 24×24 = 576 cells. A step is four gathers over 576 cells:
      roughly 12k float operations, which is nothing beside the ~2.8M triangles
      the city already draws — and it runs on the ECONOMY TICK, not per frame.
      The measured cost is reported by `stats().lastStepMs`; the panel prints it.
      Deliberately Float32Array and index arithmetic rather than objects: the
      allocation churn of 576 objects a second is the part that would show up.
   ════════════════════════════════════════════════════════════════════════════ */

import { POLLUTE } from './tuning.js';

const LN2 = Math.log(2);

let G = 24;                       // grid edge
let N = 0;                        // G*G
let air = null, ground = null, water = null;   // the three fields
let tmp = null;                   // one scratch buffer, reused
let pend = null;                  // per-tile emissions banked between ticks
let ready = false;

/* Diagnostics the panel prints, and the only place a number about COST lives. */
const S = { steps: 0, lastStepMs: 0, lastSteps: 0, calls: 0, breach: 0, lastAudit: 0 };

export function mount(grid) {
  G = Math.max(4, (grid | 0) || 24);
  N = G * G;
  air = new Float32Array(N); ground = new Float32Array(N); water = new Float32Array(N);
  tmp = new Float32Array(N);
  pend = { air: new Float32Array(N), ground: new Float32Array(N), water: new Float32Array(N) };
  ready = true;
  return true;
}
export function mounted() { return ready; }
export function grid() { return G; }
export function reset() {
  if (!ready) return;
  air.fill(0); ground.fill(0); water.fill(0);
  pend.air.fill(0); pend.ground.fill(0); pend.water.fill(0);
  S.breach = 0;
}

const idx = (x, z) => z * G + x;
const inB = (x, z) => x >= 0 && z >= 0 && x < G && z < G;

/* ── THE EMIT ACCUMULATOR ───────────────────────────────────────────────────
   `emit()` is called by /src/power (once per running plant per tick, from its
   `emitAll()` banner) and by this module's own industry pass. It BANKS rather
   than injecting, for one reason: /src/power's power pre-pass runs EARLIER in
   node-city's economyTick than the pollution pre-pass does, so its calls arrive
   before this module has been told how long the tick was. Banking them and
   injecting the whole bank at the top of `step()` means the two feeds are
   treated identically and neither can be applied against the wrong dt.

   ⚠ The amounts are ALREADY multiplied by dtMin by the caller — /src/power's
     documented shape is `emit[channel] × out × dtMin × scale`. This function
     must therefore never multiply by dt again, and `step()` must not either.
     A second dt in this chain would make pollution proportional to the SQUARE
     of the tick length, which is invisible at a steady frame rate and quadruples
     during the offline catch-up. */
export function emit(x, z, e) {
  if (!ready || !e) return false;
  const xi = Math.round(Number(x)), zi = Math.round(Number(z));
  if (!inB(xi, zi)) return false;
  const i = idx(xi, zi);
  let any = false;
  const a = Number(e.air), g = Number(e.ground), w = Number(e.water);
  if (Number.isFinite(a) && a > 0) { pend.air[i] += a; any = true; }
  if (Number.isFinite(g) && g > 0) { pend.ground[i] += g; any = true; }
  if (Number.isFinite(w) && w > 0) { pend.water[i] += w; any = true; }
  if (any) S.calls++;
  return any;
}

/* ── SAMPLING ───────────────────────────────────────────────────────────────
   🔴 BILINEAR, AND IT HAS TO BE. /src/water/hydro.js samples `groundAt` at
      FRACTIONAL coordinates — `b.cx + Math.cos(th) * b.r * rr` for eight angles
      and three radii around every basin — so an implementation that did
      `field[z * G + x]` on a float index would read `undefined`, coerce to NaN,
      and silently taint nothing at all while looking exactly like a module that
      had decided the water was clean. */
function sample(f, x, z) {
  if (!ready) return 0;
  const fx = Math.max(0, Math.min(G - 1, Number(x) || 0));
  const fz = Math.max(0, Math.min(G - 1, Number(z) || 0));
  const x0 = Math.floor(fx), z0 = Math.floor(fz);
  const x1 = Math.min(G - 1, x0 + 1), z1 = Math.min(G - 1, z0 + 1);
  const tx = fx - x0, tz = fz - z0;
  const a = f[z0 * G + x0], b = f[z0 * G + x1], c = f[z1 * G + x0], d = f[z1 * G + x1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}
/* …and the same, but returning 0 outside the map instead of clamping to the
   edge. The advection gather uses this: air that blows off the map is GONE, and
   clamping would instead pile it up against the boundary — which would make the
   downwind edge the worst place in the city rather than the best, and quietly
   invert the one siting decision this whole feature is about. */
function sampleOpen(f, x, z) {
  const fx = Number(x), fz = Number(z);
  if (!(fx > -1 && fx < G && fz > -1 && fz < G)) return 0;
  const x0 = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0, tz = fz - z0;
  const at = (xx, zz) => (xx >= 0 && zz >= 0 && xx < G && zz < G) ? f[zz * G + xx] : 0;
  const a = at(x0, z0), b = at(x0 + 1, z0), c = at(x0, z0 + 1), d = at(x0 + 1, z0 + 1);
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

export function airAt(x, z)    { return sample(air, x, z); }
export function groundAt(x, z) { return sample(ground, x, z); }
export function waterAt(x, z)  { return sample(water, x, z); }
export function raw() { return { air, ground, water, G }; }

/* ── THE ONLY FUNCTION ALLOWED TO WRITE TWO FIELDS ─────────────────────────
   Fallout and run-off both go through here. See this file's conservation
   header: written inline, the subtract is one line away from the add and one
   day somebody deletes the wrong one. */
function move(from, to, i, amount) {
  const q = Math.min(from[i], Math.max(0, amount));
  if (q <= 0) return 0;
  from[i] -= q; to[i] += q;
  return q;
}

/* ── DIFFUSION ──────────────────────────────────────────────────────────────
   Explicit 5-point. `k` is the share of a cell handed to its four neighbours
   over this step; stability needs k ≤ 1 and the sub-stepper in `step()`
   guarantees it.
   `open` decides what lies beyond the edge: for AIR it is empty sky and the
   pollution leaves; for GROUND and WATER it is more of the same ground, so the
   boundary is no-flux and nothing is destroyed by sitting near the rim. */
function diffuse(f, k, open) {
  if (k <= 0) return;
  tmp.set(f);
  const share = k / 4;
  for (let z = 0; z < G; z++) {
    for (let x = 0; x < G; x++) {
      const i = z * G + x, c = tmp[i];
      let sum = 0;
      // No-flux is expressed as "the neighbour beyond the edge equals me", so
      // the two terms cancel and nothing crosses. Open is "the neighbour is 0".
      sum += (x > 0)     ? tmp[i - 1] : (open ? 0 : c);
      sum += (x < G - 1) ? tmp[i + 1] : (open ? 0 : c);
      sum += (z > 0)     ? tmp[i - G] : (open ? 0 : c);
      sum += (z < G - 1) ? tmp[i + G] : (open ? 0 : c);
      f[i] = c + share * (sum - 4 * c);
    }
  }
}

/* ── ADVECTION ──────────────────────────────────────────────────────────────
   Semi-Lagrangian: every cell asks "where was this parcel of air a moment ago"
   and gathers from there. Unconditionally stable at any step size, which is
   what lets the offline catch-up hand over a big dt without the field blowing
   up, and it produces a real directional streak rather than the symmetric blob
   a pure diffusion term gives.

   ⚠ THE MINUS SIGN IS THE WHOLE FUNCTION. Gathering from `+d` instead of `−d`
     puts the plume UPWIND of the stack — which is not obviously wrong on a
     screenshot, is exactly backwards for every siting decision in the feature,
     and would make the arrows a lie. Verified in the harness by placing one
     source and reading the field two tiles either side of it. */
function advect(f, dx, dz, d) {
  if (d <= 0) return;
  tmp.set(f);
  for (let z = 0; z < G; z++) {
    for (let x = 0; x < G; x++) {
      f[z * G + x] = sampleOpen(tmp, x - dx * d, z - dz * d);
    }
  }
}

/* ── THE AUDIT ──────────────────────────────────────────────────────────────
   Total mass across all three fields, before and after the two transfers. They
   must agree to within float noise; `step()` compares them and counts breaches.
   This does NOT include decay, advection off the map or injection — those are
   legitimate changes and are measured separately by the caller. */
function total() {
  let t = 0;
  for (let i = 0; i < N; i++) t += air[i] + ground[i] + water[i];
  return t;
}

/* ════════════════════════════════════════════════════════════════════════════
   THE TICK.
     dtMin  real minutes, exactly as node-city measures them
     ctx    { wind, weather, surfaceAt(x,z), depositAt(x,z) }
              wind        from wind.js `read()` — dx/dz/speed/tilesPerMin
              surfaceAt   0..1 surface water presence, from /src/water, or null
              depositAt   0..1 aquifer deposit, from /src/water, or null
   Returns the diagnostics the panel prints.
   ════════════════════════════════════════════════════════════════════════════ */
export function step(dtMin, ctx) {
  if (!ready) return null;
  const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  /* ⚠ HOSTILE dt. ECONOMY.md's gauntlet found that "`Infinity` dt survived the
     guard" in /src/economy and ran three economic days off one bad clock read.
     Same guard, same reason: NaN and Infinity both fail `> 0` here and a
     negative dt would run the diffusion backwards, which is a sharpening filter
     and would turn a smooth plume into a checkerboard. */
  let dt = Number(dtMin);
  if (!(dt > 0) || !Number.isFinite(dt)) dt = 0;
  dt = Math.min(dt, POLLUTE.step.maxStepMin * POLLUTE.step.maxSteps);

  const C = ctx || {};
  const wind = C.wind || { dx: 0, dz: 1, speed: 0, tilesPerMin: 0 };
  const weather = C.weather || 'clear';
  const surfaceAt = typeof C.surfaceAt === 'function' ? C.surfaceAt : null;

  /* ── 1. CONVERT the bank into concentrations. Already carries the caller's dt
     (see `emit`), so no dt appears on these lines. NOT added to the fields yet —
     see the sub-step loop. */
  let injected = 0;
  for (let i = 0; i < N; i++) {
    if (pend.air[i])    { const q = pend.air[i]    * POLLUTE.air.perUnit;    pend.air[i] = q;    injected += q; }
    if (pend.ground[i]) { const q = pend.ground[i] * POLLUTE.ground.perUnit; pend.ground[i] = q; injected += q; }
    if (pend.water[i])  { const q = pend.water[i]  * POLLUTE.water.perUnit;  pend.water[i] = q; injected += q; }
  }
  if (dt <= 0) {
    // No time passed, so nothing is transported — but the emissions are real and
    // must land, or a paused city would silently drop them.
    for (let i = 0; i < N; i++) {
      if (pend.air[i])    { air[i]    += pend.air[i];    pend.air[i] = 0; }
      if (pend.ground[i]) { ground[i] += pend.ground[i]; pend.ground[i] = 0; }
      if (pend.water[i])  { water[i]  += pend.water[i];  pend.water[i] = 0; }
    }
    S.lastStepMs = 0; S.lastSteps = 0; return diag(injected, 0);
  }

  /* ── 2. SUB-STEP. The explicit diffusion needs `spread × dt ≤ 1` and the host
     can hand over a large dt during the offline catch-up. Beyond `maxSteps` the
     remainder is folded into the decay only — a city left alone for a day comes
     back CLEANER, which is the right limit behaviour and is also what actually
     happens to air. */
  const vTiles = Math.max(Number(wind.tilesPerMin) || 0, POLLUTE.water.flowPerMin);
  const nSteps = Math.max(1, Math.min(POLLUTE.step.maxSteps, Math.ceil(Math.max(
    dt / POLLUTE.step.maxStepMin,                       // diffusion stability
    dt * vTiles / POLLUTE.step.maxAdvectTiles))));      // advection Courant limit
  const h = dt / nSteps;
  /* 🔴 THE SOURCE IS SPREAD ACROSS THE SUB-STEPS, AND THE FIRST BUILD PUT IT ALL
     IN BEFORE THE LOOP. That is not a rounding difference: a chimney emits
     continuously, and injecting a whole tick's worth and THEN advecting it twice
     carries every molecule off the stack before the next batch arrives. Measured
     in the harness, the Coal Plant's own tile read 0.057 while the tile two
     downwind read 0.725 — a plant standing in clean air with its plume detached
     and floating downwind of it. Nothing else in the feature looked wrong, and
     an overlay that shows a coal plant sitting in fresh air is a picture nobody
     believes. Spread across the sub-steps the field is also independent of how
     many sub-steps the dt happened to need, which it was not before. */
  const inj = 1 / nSteps;

  /* Decay constants, per sub-step.
     ⚠ RAIN IS NOT AN EXTRA AIR DECAY, AND THAT IS DELIBERATE. Rain removes
       pollution from the air by putting it in the GROUND — it does not destroy
       it. Charging it as decay AND as fallout would remove it twice, which is
       the cheap kind of conservation bug: the sky would be believably clean and
       the water table would be believably dirty, and the totals would never add
       up. So `air.rainScour` drives the fallout term only, and the only thing
       that thins the air without moving it anywhere is genuine dispersal —
       decay, and being carried off the edge of the map. */
  const rain = POLLUTE.air.rainScour[weather] || 0;
  const airLam = (LN2 / POLLUTE.air.halfLifeMin) * (1 + POLLUTE.air.windScour * wind.speed);
  const airKeep = Math.exp(-airLam * h);
  const grdKeep = Math.exp(-(LN2 / POLLUTE.ground.halfLifeMin) * h);
  const watKeep = Math.exp(-(LN2 / POLLUTE.water.halfLifeMin) * h);
  const falloutK = Math.min(0.9, POLLUTE.ground.fallout *
                            (1 + rain * (POLLUTE.ground.falloutRain - 1)) * h);
  const seepK = POLLUTE.water.seep * h;
  const flowD = POLLUTE.water.flowPerMin * h;

  let moved = 0;
  for (let s = 0; s < nSteps; s++) {
    // ── 2a. THE SOURCES, this sub-step's share of them.
    for (let i = 0; i < N; i++) {
      if (pend.air[i])    air[i]    += pend.air[i] * inj;
      if (pend.ground[i]) ground[i] += pend.ground[i] * inj;
      if (pend.water[i])  water[i]  += pend.water[i] * inj;
    }

    // ── 2b. TRANSPORT. Air is carried and spread; ground creeps; water runs.
    advect(air, wind.dx, wind.dz, wind.tilesPerMin * h);
    diffuse(air, POLLUTE.air.spread * h, true);
    diffuse(ground, POLLUTE.ground.spread * h, false);
    /* 💧 DOWNSTREAM. The channel's direction is not something this module can
       know — /src/water models a river as a band across the map, not as a
       directed graph, and node-city has no terrain height to run water down. So
       the drift follows the city's own deterministic bearing, handed in by
       index.js: what stays true is that pollution in open water MOVES, and that
       it moves the same way in the same city for ever, which is what makes
       "upstream" and "downstream" facts about the place rather than a coin
       flip. /src/water then applies its own city-wide `downstream` share on top.
       Skipped entirely when /src/water is absent — see the run-off note below. */
    if (surfaceAt) {
      if (C.flowDx || C.flowDz) advect(water, C.flowDx || 0, C.flowDz || 0, flowD);
      diffuse(water, POLLUTE.water.spread * h, false);
    }

    /* ── 2c. THE TWO TRANSFERS, AND THE AUDIT WINDOW AROUND THEM.
       Nothing between these two `total()` calls is allowed to change the mass in
       the system: `move()` takes from one field and gives to another, exactly.
       Transport (above) legitimately loses mass off the open edge and decay
       (below) legitimately destroys it, so both are outside the window — an
       audit that spanned them would fire on every tick and be turned off within
       a day, which is worse than not having one. */
    const before = total();

    // ☁→🕳 FALLOUT. Rain drags the plume down harder: a wet day is a clean sky
    //     and a dirtier water table, and both halves of that are true.
    if (falloutK > 0) for (let i = 0; i < N; i++) if (air[i] > 0) moved += move(air, ground, i, air[i] * falloutK);

    /* 🕳→💧 RUN-OFF. Only where there is surface water; on dry land the ground
       keeps what it has, which is the whole reason ground pollution is a stock
       problem. With /src/water absent this module knows of no surface water and
       the leg is skipped — NOT replaced by a plausible guess. A guessed river
       would draw a contamination plume across a map with no river in it and
       would be indistinguishable from a working feature. */
    if (surfaceAt) {
      for (let z = 0; z < G; z++) for (let x = 0; x < G; x++) {
        const i = z * G + x;
        if (ground[i] <= 0) continue;
        let sf = 0;
        try { sf = Number(surfaceAt(x, z)) || 0; } catch (e) { sf = 0; }
        if (sf < POLLUTE.water.surfaceMin) continue;
        moved += move(ground, water, i, ground[i] * seepK * Math.min(1, sf));
      }
    }

    const after = total();
    S.lastAudit = after - before;
    if (Math.abs(S.lastAudit) > Math.max(1e-6, before * 1e-4)) S.breach++;

    // ── 2d. DECAY, last, outside the audit window.
    for (let i = 0; i < N; i++) {
      air[i] *= airKeep; ground[i] *= grdKeep; water[i] *= watKeep;
      /* Clamp only the TOP. A field is a concentration and 1 is "as bad as it
         gets"; letting it run to 40 would make the overlay's ramp meaningless
         and would take an hour of clean air to come back down from. The bottom
         is flushed to zero below a threshold so the sparse save stays sparse and
         `total()` does not accumulate denormals. */
      if (air[i] > 1) air[i] = 1; else if (air[i] < 1e-5) air[i] = 0;
      if (ground[i] > 1) ground[i] = 1; else if (ground[i] < 1e-5) ground[i] = 0;
      if (water[i] > 1) water[i] = 1; else if (water[i] < 1e-5) water[i] = 0;
    }
    S.steps++;
  }

  pend.air.fill(0); pend.ground.fill(0); pend.water.fill(0);
  S.lastSteps = nSteps;
  S.lastStepMs = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : 0) - t0;
  return diag(injected, moved);
}

function diag(injected, moved) {
  let mAir = 0, mGrd = 0, mWat = 0, pAir = 0, pGrd = 0, pWat = 0, hot = 0;
  for (let i = 0; i < N; i++) {
    mAir += air[i]; mGrd += ground[i]; mWat += water[i];
    if (air[i] > pAir) pAir = air[i];
    if (ground[i] > pGrd) pGrd = ground[i];
    if (water[i] > pWat) pWat = water[i];
    if (air[i] > 0.35 || ground[i] > 0.35 || water[i] > 0.35) hot++;
  }
  return {
    cells: N, grid: G, injected, moved, hot,
    mean: { air: mAir / N, ground: mGrd / N, water: mWat / N },
    peak: { air: pAir, ground: pGrd, water: pWat },
    stepMs: S.lastStepMs, steps: S.lastSteps, breach: S.breach, calls: S.calls,
  };
}

export function stats() { return { ...S, grid: G, cells: N }; }

/* ════════════════════════════════════════════════════════════════════════════
   💾 SAVE — sparse, quantised, and OPTIONAL-WITH-DEFAULT ON LOAD.
   ----------------------------------------------------------------------------
   Only cells above `save.min` are written, as [index, byte] pairs. A clean city
   writes three empty arrays; a filthy one writes a few hundred numbers. A dense
   576×3 blob would be ~2.3 KB on every autosave of every city in the game
   whether or not anything had ever been built.

   🔴 ABSENT ⇒ A CLEAN CITY, and that is the correct reading of a save written
      before this module existed: nothing had ever measured the air, so there is
      nothing to restore. It is ALSO the deliberate answer to the retro-fit
      question — see tuning.js `sources`. An existing save opens clean and gets
      dirty at the same rate a new city does, in front of the player, with the
      overlay and the panel explaining it the whole time.

   ⚠ A BLOB FROM ANOTHER CITY IS REFUSED. The grid and the city id are both
     written; a mismatch drops the payload rather than painting one city's smoke
     over another's. Same rule /src/water states for its basin reserves.
   ════════════════════════════════════════════════════════════════════════════ */
function packField(f) {
  const out = [];
  const q = POLLUTE.save.quant;
  for (let i = 0; i < N; i++) {
    if (f[i] < POLLUTE.save.min) continue;
    out.push(i, Math.max(1, Math.min(q, Math.round(f[i] * q))));
  }
  return out;
}
function unpackField(f, arr) {
  f.fill(0);
  if (!Array.isArray(arr)) return;
  const q = POLLUTE.save.quant;
  for (let j = 0; j + 1 < arr.length; j += 2) {
    const i = arr[j] | 0, v = +arr[j + 1];
    if (i < 0 || i >= N || !Number.isFinite(v)) continue;
    f[i] = Math.max(0, Math.min(1, v / q));
  }
}

export function save(cityId) {
  if (!ready) return null;
  return { v: 1, cityId: String(cityId || ''), grid: G,
           air: packField(air), ground: packField(ground), water: packField(water) };
}

export function load(blob, cityId) {
  if (!ready) return false;
  reset();
  if (!blob || typeof blob !== 'object') return false;
  if ((blob.grid | 0) !== G) return false;
  if (blob.cityId && cityId && String(blob.cityId) !== String(cityId)) return false;
  unpackField(air, blob.air);
  unpackField(ground, blob.ground);
  unpackField(water, blob.water);
  return true;
}
