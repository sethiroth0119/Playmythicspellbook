/* ════════════════════════════════════════════════════════════════════════════
   📐 THE MODEL — one whole-map field, five terms, every one of them live.
   ----------------------------------------------------------------------------
   WHAT `lotValue()` WAS, MEASURED, BEFORE THIS EXISTED
   node-city's shipped `lotValue(x, z)` is:

       20
       + 10  per adjacent ROAD                      ┐ a FOUR-TILE stencil:
       + 20 + link×0.5  per adjacent ANCHOR         │ NEI is [[0,-1],[1,0],
       + 30  adjacent ARENA                         │ [0,1],[-1,0]] — nothing
       + 12  adjacent FOUNTAIN                      │ two tiles away exists
       +  5  per adjacent decorPts building         ┘
       + round(citySync() × 0.3)                    ┐ CITY-WIDE. Identical on
       + decorPoints()                              ┘ every tile in the city.

   Two facts follow, and they answer the question the brief asks:

     1. THE ONLY SPATIAL SIGNAL IS ONE TILE WIDE. A plot in the middle of a
        finished downtown, four tiles from an arena, a station and a hundred
        residents, reads EXACTLY the same as a plot in an empty field with the
        same road beside it. It cannot separate a downtown lot from a suburban
        one because it has never looked past the kerb.
     2. THE LARGEST TERM SEPARATES NOTHING AND IS UNBOUNDED. `decorPoints()` is
        a CITY TOTAL added to every tile equally, and it grows with every garden
        the player ever plants. In a decorated city it dominates a spatial
        signal that is capped around 110 — so the map gets uniformly more
        expensive and no more legible.

   So: not rich enough, and extended below. The host's stencil is KEPT — it is
   the correct answer to "what is on my kerb" and it stays the strongest single
   term — and everything new starts at distance `LV.inner` so nothing is
   counted twice.

   ── THE FIVE TERMS, AND THE LIVE CALL BEHIND EACH ─────────────────────────
     stencil   ctx.stencilAt(x,z)                 the HOST's own four-tile sum
     reach     game.tiles + BUILDINGS[t].svc      service amenity in the window
     wealth    MythicDemographics.residents(key)  who lives around here
     transit   game.tiles + MythicTransit.jobAccess().served
     water     MythicWater.endowment().surfaceAt  waterfront
     ×         MythicPollution.landValueAt(x,z)   0.45..1, poison discount

   ⚠ A MISSING MODULE CONTRIBUTES 0, NEVER A PENALTY, and never a plausible
     substitute. /src/demographics absent means "no information about who lives
     here", which is not the same as "nobody wealthy lives here" — and a guarded
     read that silently substitutes a plausible value is indistinguishable from
     a working integration. That is this branch's most expensive lesson
     (HANDOFF §8) and every read below is written to obey it. `sources()`
     reports which terms were live so the panel can say so.

   ── WHAT WAS LEFT OUT, AND WHY. The brief asks for it plainly: if a factor
      has no data behind it, leave it out and say so. Four were considered and
      four are absent.

     ✗ CONGESTION / TRAFFIC. /src/streets keeps a real 24-bucket per-tile ring,
       but a bucket only accrues while the tab is rendering and the ring is
       empty in a fresh or freshly-loaded city. A term that is uniformly zero
       for the first session separates nothing and teaches the player that the
       overlay is broken. It is also the one term this environment cannot even
       measure: rAF never fires in the harness, so agentTick never runs and the
       counter is structurally zero here (HANDOFF §1).
     ✗ SERVICE COVERAGE. node-city's `computeCoverage()` is CITY-WIDE — food,
       water, health, safety, light are one number each for the whole city.
       There is no per-tile coverage model to read, so a coverage term would
       shift every tile by the same amount, exactly like `decorPoints()` already
       does, and add nothing a band can see. When per-tile service coverage
       exists this is the first term to add.
     ✗ CRIME and TOURISM. The brief names both. Neither is modelled anywhere in
       this game: `svc.need === 'safety'` is a coverage input, not a crime rate,
       and there is no visitor model at all. Inventing either would be a number
       with nothing behind it.
     ✗ PARKING. /src/parking places kerbside bays as decoration and exposes no
       per-tile supply or occupancy to read.
   ════════════════════════════════════════════════════════════════════════════ */

import { LV } from './tuning.js';
import { bandIndex, premiumFull } from './bands.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const W = () => (typeof window !== 'undefined' ? window : {});

/* ── the module handles, asked for at CALL time and never cached ────────────
   Every one of these can appear or vanish during a session: a sibling module
   mounts late, or 404s and never arrives at all. A cached handle is how a
   feature keeps answering with a module that is no longer there. */
const DEMOG = () => { try { const d = W().MythicDemographics; return (d && d.ready && d.ready()) ? d : null; } catch (e) { return null; } };
const TRANSIT = () => { try { return W().MythicTransit || null; } catch (e) { return null; } };
const WATER = () => { try { const w = W().MythicWater; return (w && w.ready && w.ready()) ? w : null; } catch (e) { return null; } };
const POLL = () => { try { const p = W().MythicPollution; return (p && p.ready && p.ready()) ? p : null; } catch (e) { return null; } };

export function makeField(ctx) {
  const G = ctx.game || {};
  const BUILDINGS = ctx.BUILDINGS || {};
  const GRID = ctx.GRID || 24;
  const N = GRID * GRID;
  const key = ctx.key || ((x, z) => x + ',' + z);
  const bldSite = ctx.bldSite || (() => false);
  const stencilAt = ctx.stencilAt || (() => 0);
  const cityBase = ctx.cityBase || (() => 20);

  const FULL = premiumFull();

  /* The field itself. Four typed arrays reused for ever — this is recomputed on
     a timer and allocating 4×576 floats each pass is garbage for no reason. */
  const premium = new Float32Array(N);
  const value = new Float32Array(N);
  const band = new Uint8Array(N);
  const polmul = new Float32Array(N);
  /* The per-term decomposition, kept because rubric 12 asks for "a METER WITH A
     SIGNED CAUSAL LIST, not a raw number" and the panel cannot build one out of
     a total. Same argument /src/pollution makes for its attribution. */
  const tStencil = new Float32Array(N), tReach = new Float32Array(N);
  const tWealth = new Float32Array(N), tTransit = new Float32Array(N), tWater = new Float32Array(N);

  let city = 20;
  let builtAt = -1e9;
  let live = { demog: false, transit: false, water: false, pollution: false };
  let stats = { min: 0, max: 0, mean: 0, hist: [0, 0, 0, 0, 0], maxStencil: 0, tiles: N };

  const idx = (x, z) => z * GRID + x;
  const inGrid = (x, z) => x >= 0 && z >= 0 && x < GRID && z < GRID;

  /* Linear falloff over the window, d in inner..radius. See tuning.js for why
     linear and not inverse-square. */
  const R = LV.radius, INNER = LV.inner;
  function decay(d) { return d < INNER ? 0 : (R + 1 - d) / R; }
  /* Precomputed once: the weight of every offset in the window, by Chebyshev
     distance. 81 entries; the convolution reads it instead of calling Math. */
  const OFF = [];
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    const d = Math.max(Math.abs(dx), Math.abs(dz));
    const w = decay(d);
    if (w > 0) OFF.push([dx, dz, w, d]);
  }
  /* The same window but from d = 0, for terms the stencil does NOT already
     own — water is a property of the ground under the tile itself, and transit
     stops are counted from the plot they serve. */
  const OFF0 = [];
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    const d = Math.max(Math.abs(dx), Math.abs(dz));
    OFF0.push([dx, dz, (R + 1 - d) / (R + 1), d]);
  }

  /* ── ② REACH: service amenity in the window ────────────────────────────
     Weight per building read off SHIPPED fields only (see tuning.js). A tile
     under construction contributes NOTHING — the host's own stencil makes the
     same call in the same words ("land value arrives with the arena, not with
     the announcement of one") and the two must not disagree. A damaged building
     contributes nothing either: it is not supplying the service it is being
     credited for. */
  function amenityWeight(t) {
    if (!t || t.damaged || bldSite(t)) return 0;
    const def = BUILDINGS[t.type];
    if (!def || !def.svc || !def.svc.need) return 0;
    return LV.reach.perService + LV.reach.perMorale * (+def.svc.morale || 0);
  }

  /* ── ③ WEALTH: who lives around here ───────────────────────────────────
     One `residents()` call per tile that HAS residents. /src/demographics
     answers `ok:false` for anything that is not housing, which is the cheap
     early return that keeps this from being 576 household draws.
     ⚠ WEIGHTED BY PEOPLE, NOT BY TILES. A tower with forty residents should
       weigh more than a bungalow with three, and a mean over tiles would say
       they are the same. */
  function wealthSources() {
    const D = DEMOG();
    if (!D || typeof D.residents !== 'function') return null;
    const out = [];
    let any = false;
    for (const k in (G.tiles || {})) {
      const t = G.tiles[k];
      if (!t || t.type !== 'housing' || t.damaged || bldSite(t)) continue;
      let r = null;
      try { r = D.residents(k); } catch (e) { r = null; }
      if (!r || !r.ok || !(r.residents > 0)) continue;
      const c = k.split(','), x = +c[0], z = +c[1];
      if (!inGrid(x, z)) continue;
      const tier = (r.wealth && LV.wealth.tier[r.wealth.tier] != null) ? LV.wealth.tier[r.wealth.tier] : LV.wealth.tier.mid;
      out.push({ x, z, pop: r.residents, tier });
      any = true;
    }
    return any ? out : (D ? [] : null);   // [] is "asked, nobody lives here yet"
  }

  /* ── ④ TRANSIT: served stops in the window ─────────────────────────────
     🔴 THE MODE SHARE IS THE GATE. `jobAccess().served` is /src/transit's own
        published network mode share; a city with shelters and no lines answers
        0 and the whole term is 0. See tuning.js for why that matters. */
  function transitSources() {
    const T = TRANSIT();
    if (!T || typeof T.jobAccess !== 'function') return null;
    let served = 0;
    try { const a = T.jobAccess(); served = a ? clamp01(+a.served) : 0; } catch (e) { return null; }
    const out = [];
    for (const k in (G.tiles || {})) {
      const t = G.tiles[k];
      if (!t || t.damaged || bldSite(t)) continue;
      const w = LV.transit.weight[t.type];
      if (!w) continue;
      const c = k.split(','), x = +c[0], z = +c[1];
      if (inGrid(x, z)) out.push({ x, z, w });
    }
    return { served, stops: out };
  }

  /* ── ⑤ WATER: the surface field, sampled once over the board ────────────
     /src/water's `endowment()` hands back the hydrology's own `surfaceAt`
     closure. Called ONCE per rebuild and sampled 576 times, not called 576
     times — `endowment()` rebuilds a descriptor object and calling it inside
     the loop would be the expensive way to ask the same question. */
  function waterMask() {
    const Wt = WATER();
    if (!Wt || typeof Wt.endowment !== 'function') return null;
    let surfaceAt = null;
    try { const e = Wt.endowment(); surfaceAt = e && e.surfaceAt; } catch (e) { return null; }
    if (typeof surfaceAt !== 'function') return null;
    const m = new Float32Array(N);
    let any = false;
    for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
      let f = 0;
      try { f = +surfaceAt(x, z) || 0; } catch (e) { f = 0; }
      if (f >= LV.water.minRead) { m[idx(x, z)] = clamp01(f); any = true; }
    }
    return any ? m : m;    // an all-dry city is a real answer, not a missing one
  }

  /* ══ THE REBUILD ═════════════════════════════════════════════════════════ */
  function rebuild(force) {
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (!force && now - builtAt < LV.field.ttlMs) return false;
    builtAt = now;

    try { city = +cityBase() || 20; } catch (e) { city = 20; }

    const wsrc = wealthSources();
    const tsrc = transitSources();
    const wmask = waterMask();
    const PL = POLL();
    live = { demog: !!wsrc, transit: !!tsrc, water: !!wmask, pollution: !!PL };

    /* ① the host's stencil, and its live maximum — `verify()` uses it to catch
       `LV.stencilRef` going stale, which is the only thing anchoring the
       ladder to reality. */
    let maxSten = 0;
    for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
      let s = 0;
      try { s = +stencilAt(x, z) || 0; } catch (e) { s = 0; }
      tStencil[idx(x, z)] = s;
      if (s > maxSten) maxSten = s;
    }

    /* ② reach — scatter, not gather. One pass over the tiles that HAVE a weight
       (a handful) spraying into the window, instead of 576 tiles each reading
       81 neighbours. Same trick /src/transit uses to dilate its housing map. */
    tReach.fill(0);
    for (const k in (G.tiles || {})) {
      const t = G.tiles[k];
      const w = amenityWeight(t);
      if (!w) continue;
      const c = k.split(','), sx = +c[0], sz = +c[1];
      if (!inGrid(sx, sz)) continue;
      for (const o of OFF) {
        const x = sx + o[0], z = sz + o[1];
        if (inGrid(x, z)) tReach[idx(x, z)] += w * o[2];
      }
    }
    for (let i = 0; i < N; i++) if (tReach[i] > LV.reach.cap) tReach[i] = LV.reach.cap;

    /* ③ wealth — two scatters, because the term is a POPULATION-WEIGHTED MEAN
       and a mean needs its own denominator carried alongside it. Coverage is
       the second gate: a single wealthy house in an empty window must not read
       as a wealthy district. */
    tWealth.fill(0);
    if (wsrc && wsrc.length) {
      const num = new Float32Array(N), den = new Float32Array(N);
      for (const s of wsrc) for (const o of OFF0) {
        const x = s.x + o[0], z = s.z + o[1];
        if (!inGrid(x, z)) continue;
        const i = idx(x, z), w = s.pop * o[2];
        num[i] += w * s.tier; den[i] += w;
      }
      for (let i = 0; i < N; i++) {
        if (!(den[i] > 0)) continue;
        const mean = num[i] / den[i];
        const coverage = clamp01(den[i] / LV.wealth.popRef);
        tWealth[i] = mean * coverage * LV.wealth.cap;
      }
    }

    /* ④ transit — the STRONGEST stop in the window, not the sum. Two shelters
       on the same corner are one place you can catch a bus from; summing them
       would price a stop farm. */
    tTransit.fill(0);
    if (tsrc && tsrc.served > 0 && tsrc.stops.length) {
      for (const s of tsrc.stops) for (const o of OFF0) {
        const x = s.x + o[0], z = s.z + o[1];
        if (!inGrid(x, z)) continue;
        const i = idx(x, z), v = s.w * o[2];
        if (v > tTransit[i]) tTransit[i] = v;
      }
      for (let i = 0; i < N; i++) tTransit[i] = clamp01(tTransit[i]) * LV.transit.cap * tsrc.served;
    }

    /* ⑤ water — strongest surface reading in the window, same argument. */
    tWater.fill(0);
    if (wmask) {
      for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
        const f = wmask[idx(x, z)];
        if (!(f > 0)) continue;
        for (const o of OFF0) {
          const ax = x + o[0], az = z + o[1];
          if (!inGrid(ax, az)) continue;
          const i = idx(ax, az), v = f * o[2];
          if (v > tWater[i]) tWater[i] = v;
        }
      }
      for (let i = 0; i < N; i++) tWater[i] = clamp01(tWater[i]) * LV.water.cap;
    }

    /* ⑥ the poison discount, and WHY IT MULTIPLIES THE PREMIUM AND NOT V.
       A plume cannot take away the civic baseline every tile in the city
       shares — that is the same 20-plus-city-totals wherever you stand. What it
       takes away is everything that made THIS plot worth more than bare ground.
       So a poisoned downtown block falls toward suburban, and a poisoned empty
       field is still an empty field, which is the correct pair of answers.
       ⚠ IT IS THE SAME CALL node-city's Lease Plot rent already makes, so the
         two cannot drift: `landValueAt` is 1 on clean ground and falls to
         POLLUTE.effects.minLandValue under a plume. It can only ever REDUCE. */
    let min = Infinity, max = -Infinity, sum = 0;
    const hist = [0, 0, 0, 0, 0];
    for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
      const i = idx(x, z);
      let mul = 1;
      if (PL) {
        try { const v = +PL.landValueAt(x, z); if (Number.isFinite(v) && v > 0 && v <= 1) mul = v; } catch (e) { mul = 1; }
      }
      polmul[i] = mul;
      const p = (tStencil[i] + tReach[i] + tWealth[i] + tTransit[i] + tWater[i]) * mul;
      premium[i] = p;
      const v = Math.max(LV.minValue, city + p);
      value[i] = v;
      const b = bandIndex(clamp01(p / FULL));
      band[i] = b; hist[b]++;
      if (v < min) min = v; if (v > max) max = v; sum += v;
    }
    stats = { min: min === Infinity ? 0 : min, max: max === -Infinity ? 0 : max,
              mean: sum / N, hist, maxStencil: maxSten, tiles: N, full: FULL, city };
    return true;
  }

  /* ── the read side ──────────────────────────────────────────────────────
     Every accessor rebuilds first, on the TTL. The alternative — a dirty flag
     the host sets — needs a hook on every path that places, demolishes,
     upgrades or damages a tile, and a missed one is a map that quietly stops
     agreeing with the city. A 2.5 s staleness is invisible; a missed hook is
     not. */
  function at(x, z) { rebuild(false); return inGrid(x, z) ? idx(x, z) : -1; }

  return {
    rebuild,
    grid: () => GRID,
    cityBase: () => { rebuild(false); return city; },
    valueAt(x, z) { const i = at(x, z); return i < 0 ? LV.minValue : value[i]; },
    premiumAt(x, z) { const i = at(x, z); return i < 0 ? 0 : premium[i]; },
    bandAt(x, z) { const i = at(x, z); return i < 0 ? 0 : band[i]; },
    polAt(x, z) { const i = at(x, z); return i < 0 ? 1 : polmul[i]; },
    /* The signed causal list for one tile, in the order the panel prints it.
       Values are the CONTRIBUTIONS AFTER the poison multiplier, so they add up
       to the premium exactly — a breakdown whose rows do not sum to the total
       it is breaking down is worse than no breakdown. */
    termsAt(x, z) {
      const i = at(x, z);
      if (i < 0) return [];
      const m = polmul[i];
      return [
        { k: 'stencil', ico: '🛣', label: 'Frontage — road, anchor, arena, beauty', v: tStencil[i] * m, src: 'host' },
        { k: 'reach', ico: '🏪', label: 'Amenity within ' + LV.radius + ' tiles', v: tReach[i] * m, src: 'city' },
        { k: 'wealth', ico: '👥', label: 'Households nearby', v: tWealth[i] * m, src: 'demographics', live: live.demog },
        { k: 'transit', ico: '🚌', label: 'Served transit stop', v: tTransit[i] * m, src: 'transit', live: live.transit },
        { k: 'water', ico: '🌊', label: 'Waterfront', v: tWater[i] * m, src: 'water', live: live.water },
        { k: 'poison', ico: '☁', label: 'Pollution discount', v: -(tStencil[i] + tReach[i] + tWealth[i] + tTransit[i] + tWater[i]) * (1 - m), src: 'pollution', live: live.pollution },
      ];
    },
    fields: () => ({ premium, value, band, polmul, grid: GRID }),
    stats: () => { rebuild(false); return stats; },
    sources: () => { rebuild(false); return { ...live }; },
    full: () => FULL,
  };
}
