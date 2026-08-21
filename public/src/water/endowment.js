/* ════════════════════════════════════════════════════════════════════════════
   💧 HYDROLOGY — what water is under and across THIS city. Deterministic.
   ----------------------------------------------------------------------------
   "Make it where each player city have different water sources, where some
    cities have more water than others."

   THIS FILE IS THAT SENTENCE, and it is built the way /src/economy/endowment.js
   builds the ore: as a PURE FUNCTION OF THE CITY ID. No storage, no migration,
   no dice roll at claim time. Two players looking at the same city see the same
   ground, forever, and a save written before this file existed gets the same
   answer as one written after it — which is the only reason it is safe to make
   a city's water production depend on it at all.

   ── 🔴 HOW THIS RELATES TO /src/economy/endowment.js, AND WHY IT IS NOT A
        SECOND TRUTH ──────────────────────────────────────────────────────────
   That file already has an opinion about water: `rawWater` is one of its ~51
   deposits, and it is on the GUARANTEED list — pinned to at least POOR on every
   node, because (its words) "a node with no water is not 'specialised', it is
   unplayable, and the player did not choose the node."

   The two answer different questions and cannot contradict each other:

     ECONOMY ENDOWMENT — "can this node extract raw water at all?"  Always YES,
                         by construction. One bit, per NODE, for the resource
                         chain's 258-id graph.
     THIS FILE         — "where in this city is the water, how much is there,
                         how fast does it come back, and how clean is it?"
                         A per-TILE field, for the city builder's own `water`
                         ledger resource and its Purifier.

   "Some, somewhere" is compatible with every distribution this file can produce,
   because `minBasinStrength` guarantees every city at least one usable aquifer —
   which is precisely `rawWater ≥ POOR` restated at tile resolution. The finer
   answer never denies the coarser one.

   🚫 REJECTED, DELIBERATELY: biasing wetness by `MythicEconomy.gradeOf(node,
      'rawWater')`. It is the obvious "make the two agree" move and it is wrong
      twice. First, it would make the ground's answer depend on whether ANOTHER
      MODULE LOADED — a 404 on /src/economy would silently re-roll the city's
      hydrology, which is the determinism promise broken in the least visible
      way possible. Second, `rawWater` is PINNED rather than rolled, so it
      carries almost no signal: it is ≥POOR on every node by design, and reading
      it back would mostly be reading our own floor.

   ── EVERYTHING HERE IS PURE ─────────────────────────────────────────────────
   Nothing in this file mutates. Drawdown and contamination are LIVE state and
   live in hydro.js, which reads this as the ground it starts from. `endowment()`
   is the ground as it was made; `sourceAt()` in hydro.js is the ground as it is
   now. Keeping those two apart is what lets the overlay draw a permanent map of
   deposits and a changing map of what is left in them.
   ════════════════════════════════════════════════════════════════════════════ */

import { WATER } from './tuning.js';

/* ── 🎲 A STABLE HASH ───────────────────────────────────────────────────────
   FNV-1a over `cityId + ':' + salt` — the same core as /src/economy/
   endowment.js's `hash01`, including the `>>> 0` after every step (without it
   this overflows into the float range and stops being the 32-bit FNV everyone
   else's implementation agrees with) — FOLLOWED BY A FINAL AVALANCHE.

   🔴 THE AVALANCHE IS NOT TIDYING. IT IS A BUG FIX, AND IT WAS MEASURED.
      FNV-1a mixes low bits well and HIGH bits badly: its multiply step
      propagates change upwards, so two inputs differing only in their LAST byte
      end up differing mostly in the bottom of the word. `hash01` divides by 2³²,
      which is to say it reads the TOP bits — so salts like 'bx0' and 'bx1' came
      back nearly EQUAL. The first run of this file put every basin in a city at
      the same coordinates with the same radius:

        node-alpha | Kessel@19.5,20.3 r3.2 ; Dunmere@19.5,20.4 r3.2

      i.e. "three aquifers" that were one aquifer drawn three times — the exact
      shape of a feature that looks like it works. The fix is one murmur3-style
      finalizer, which is what every hash used for coordinates has. Nothing else
      in the file changed.

   ⚠ …WHICH IS ALSO WHY THIS IS NOT IMPORTED FROM /src/economy. That file's
     salts differ across their whole length (`dep:ironOre` vs `dep:coal`), so it
     never hit this, and it uses its near-tied values only to ORDER a demotion
     list where a weak spread is harmless. Importing would also drag in
     recipes.js — the whole 258-id production graph — for eight lines of
     arithmetic, and would make a 404 on the economy a 404 on the city's water.
     A hash is a utility, not a truth; the truths are kept apart above. */
function hash01(cityId, salt) {
  const s = String(cityId == null ? '' : cityId) + ':' + salt;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  h ^= h >>> 16; h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/* ── THE CLASSES ────────────────────────────────────────────────────────────
   A city's water is a fact about the PLACE, so it gets a name the player can
   say out loud. The bands are read off `wetness`, which is triangular, so the
   two ends are genuinely uncommon. */
export const CLASSES = [
  { key: 'ARID',      label: 'Arid',       ico: '🏜', below: 0.16,
    blurb: 'One shallow aquifer and no surface water. Every drop is condensed or pumped, and pumping it hard empties it.' },
  { key: 'DRY',       label: 'Dry',        ico: '🌵', below: 0.36,
    blurb: 'Thin groundwater. A waterworks sited off the basin costs you most of its output.' },
  { key: 'TEMPERATE', label: 'Temperate',  ico: '🌾', below: 0.62,
    blurb: 'Workable groundwater and standing water somewhere on the map. Siting matters; siting badly is survivable.' },
  { key: 'WET',       label: 'Wet',        ico: '🌧', below: 0.84,
    blurb: 'Broad basins and open water. This city can support industry that a dry one cannot.' },
  { key: 'SPRINGFED', label: 'Springfed',  ico: '⛲', below: 1.01,
    blurb: 'River-fed aquifers that refill nearly as fast as you can pump them. Water will never be what stops this city.' },
];
export function classOf(wetness) {
  for (const c of CLASSES) if (wetness < c.below) return c;
  return CLASSES[CLASSES.length - 1];
}

/* Smooth radial falloff, 1 at the centre and 0 at the rim, with a shoulder.
   (1-t²)² rather than (1-t): a linear cone gives every basin a wide useless
   fringe, and the overlay then reads as one soft blur instead of as located
   deposits. */
function falloff(d, r) {
  if (r <= 0) return 0;
  const t = d / r;
  if (t >= 1) return 0;
  const u = 1 - t * t;
  return u * u;
}

/* ════════════════════════════════════════════════════════════════════════════
   THE ENDOWMENT ITSELF
   ════════════════════════════════════════════════════════════════════════════ */

let _cache = { key: null, val: null };

export function invalidate() { _cache = { key: null, val: null }; }

/* Build the whole hydrology for a city. Pure, deterministic, cached on
   (cityId, grid) in a single slot — the player is only ever in one city, and
   hydro.js asks for it on every tick. */
export function hydrologyFor(cityId, grid) {
  const G = Math.max(4, (grid | 0) || 24);
  const id = String(cityId == null ? '' : cityId);
  const ck = id + '@' + G;
  if (_cache.key === ck && _cache.val) return _cache.val;

  const E = WATER.endow;

  // ── 1. WETNESS. Triangular, so the extremes are rare and mean something.
  let w = 0;
  for (let i = 0; i < E.wetnessRolls; i++) w += hash01(id, 'wet' + i);
  const wetness = Math.max(0, Math.min(1, w / E.wetnessRolls));
  const cls = classOf(wetness);

  // ── 2. SURFACE WATER, built FIRST because the aquifers need to know whether
  //       they sit under it (a springfed basin is the endowment's own answer to
  //       "why can this city pump harder than that one").
  const surface = buildSurface(id, G, wetness);
  /* 🌊 HOW MANY BUILDABLE COLUMNS ARE ACTUALLY COASTAL. Counted ONCE, here,
     against the real field — never derived from `reach`, which is measured from
     the waterline and therefore spends its first ~2.5 tiles crossing the gap
     between the last column and the water (see WATER.sea.reach's 🐞). The panel
     prints THIS, because "reaches N tiles inland" has to be a fact about the
     map the player is looking at and not about the falloff's parameter. */
  let seaInland = 0;
  if (surface.sea) {
    for (let x = G - 1; x >= 0; x--) {
      let any = false;
      for (let z = 0; z < G; z++) if (seaStrengthAt(surface.sea, x, z) > 0.02) { any = true; break; }
      if (!any) break;
      seaInland++;
    }
  }

  // ── 3. AQUIFERS.
  const nBasins = Math.max(E.basinsMin, Math.min(E.basinsMax,
    E.basinsMin + Math.floor(hash01(id, 'nbas') * 0.9 + wetness * (E.basinsMax - E.basinsMin + 0.6))));
  const basins = [];
  for (let i = 0; i < nBasins; i++) {
    const inset = 2;
    const cx = inset + hash01(id, 'bx' + i) * (G - inset * 2 - 1);
    const cz = inset + hash01(id, 'bz' + i) * (G - inset * 2 - 1);
    const r = E.radiusMin + (E.radiusMax - E.radiusMin) *
              (0.30 + 0.70 * wetness) * (0.45 + 0.55 * hash01(id, 'br' + i));
    /* Strength is the deposit's richness at its centre. The first basin is the
       city's MAIN one and is rolled high — without that, an arid city could roll
       four equally feeble basins and read as "four aquifers" on the overlay
       while none of them was worth siting a building on. */
    let s = (0.30 + 0.70 * hash01(id, 'bs' + i)) * (0.45 + 0.65 * wetness);
    if (i === 0) s = Math.max(s, E.minBasinStrength + 0.10 * hash01(id, 'bs0lift'));
    s = Math.max(0.08, Math.min(1, s));
    const purity = E.purityMin + (E.purityMax - E.purityMin) * hash01(id, 'bp' + i);

    // Covered area, in tiles, for volume and recharge. The falloff integrates to
    // about half the disc, so half of πr² is the honest figure to scale by.
    const area = Math.PI * r * r * 0.5;
    const springfed = surfaceStrengthAt(surface, cx, cz) > 0.25;
    const volume = WATER.aquifer.volPerTileStrength * area * s;
    let recharge = WATER.aquifer.rechargePerTileStrength * area * s * (0.45 + 1.10 * wetness);
    if (springfed) recharge *= WATER.aquifer.springfedMul;

    basins.push({ i, cx, cz, r, strength: s, purity, volume, recharge, springfed,
                  name: BASIN_NAMES[i % BASIN_NAMES.length] });
  }

  /* 🛟 THE FLOOR, RE-IMPOSED. Everything above can only roll DOWN, so the
     promise "every city has at least one usable source" has to be asserted after
     it — the same shape as /src/economy/endowment.js re-imposing its scarcity
     guarantee after its floors. Lifted to exactly the minimum, never higher:
     a pinned basin is never a gift. */
  const best = basins.reduce((a, b) => (b.strength > a.strength ? b : a), basins[0]);
  if (best.strength < E.minBasinStrength) {
    const lift = E.minBasinStrength / best.strength;
    best.strength = E.minBasinStrength;
    best.volume *= lift;
    best.recharge *= lift;
  }

  const H = {
    cityId: id, grid: G, wetness, cls, basins, surface, seaInland,
    /* The 0..1 deposit field the overlays paint. THE GROUND AS IT WAS MADE —
       no drawdown, no contamination. /src/power/overlay.js paints exactly this
       through `endowment().groundAt`, and it is why that layer is stable while
       the player watches it. */
    groundAt(x, z) {
      let m = 0;
      for (const b of basins) {
        const d = Math.hypot(x - b.cx, z - b.cz);
        const v = b.strength * falloff(d, b.r);
        if (v > m) m = v;
      }
      return m;
    },
    basinAt(x, z) {
      let best = null, m = 0;
      for (const b of basins) {
        const v = b.strength * falloff(Math.hypot(x - b.cx, z - b.cz), b.r);
        if (v > m) { m = v; best = b; }
      }
      return best && m >= WATER.aquifer.minRead ? { basin: best, strength: m } : null;
    },
    surfaceAt(x, z) { return surfaceStrengthAt(surface, x, z); },
    /* 🌊 THE SEA IS ASKED FOR BY NAME AND IS NOT FOLDED INTO `surfaceAt`.
       Folding it in is the obvious tidy-up and it breaks three shipped things at
       once, so it is refused here, once, with the list:
         · /src/power/plants.js sites a Hydro Plant on `sourceAt().flow`, which
           is `surfaceAt` under another name. Every city would get a dam site.
         · `springfed` above is decided by `surfaceStrengthAt(cx, cz)` and feeds
           basin RECHARGE, which is saved state. Every coastal basin in every
           EXISTING city would silently gain a ×3.2 recharge — a balance change
           made from a rendering round, applied retroactively.
         · /src/power/overlay.js paints `flow` as "Surface Water Flow". A sea has
           no flow. The layer would start lying.
       `sourceAt()` consults this separately and reports the sea as its own
       `kind`, which is what "a new body type" has to mean if the bodies behave
       differently. */
    seaAt(x, z) { return seaStrengthAt(surface.sea, x, z); },
    shoreAt(z) { return shoreXAt(surface.sea, z); },
    /* One line a human can read, for the panel header and for any other system
       that wants to describe this city without re-deriving it. */
    summary() {
      const parts = [cls.label.toLowerCase() + ' hydrology',
                     basins.length + ' aquifer' + (basins.length === 1 ? '' : 's')];
      // The sea first among the surface bodies: it is the one that is always
      // there, and a summary that buried it would teach the player it is rare.
      if (surface.sea) parts.push('an ' + surface.sea.side + ' coast');
      if (surface.river) parts.push('a river');
      if (surface.lakes.length) parts.push(surface.lakes.length === 1 ? 'a lake' : surface.lakes.length + ' lakes');
      if (basins.some(b => b.springfed)) parts.push('springfed ground');
      return parts.join(', ');
    },
  };
  _cache = { key: ck, val: H };
  return H;
}

/* Basin names, so the panel can say "the Dunmere basin is drawing down" instead
   of "basin 2". Fixed list indexed by basin number — deterministic for free,
   and never a per-city name roll that would need its own seed. */
const BASIN_NAMES = ['Kessel', 'Dunmere', 'Ashvale', 'Corrin'];

/* ── SURFACE WATER ──────────────────────────────────────────────────────────
   A river is a wandering channel across one axis; a lake is a disc. Both are
   derived, not stored, and both are advisory — see WATER.surface's note on why
   neither blocks construction. */
function buildSurface(id, G, wetness) {
  const E = WATER.endow;
  const out = { river: null, lakes: [], sea: buildSea(id, G) };

  if (wetness >= E.riverAbove) {
    const horiz = hash01(id, 'rax') < 0.5;
    const base = 3 + hash01(id, 'rbase') * (G - 6);
    const amp = 1.5 + hash01(id, 'ramp') * (G * 0.16);
    const phase = hash01(id, 'rph') * Math.PI * 2;
    const freq = (0.5 + hash01(id, 'rfr') * 1.1) * Math.PI * 2 / G;
    out.river = { horiz, base, amp, phase, freq,
                  // Which end is upstream. Only matters for pollution transport,
                  // and it is a fact about the place, so it is rolled here.
                  flip: hash01(id, 'rfl') < 0.5 };
  }

  const nLakes = wetness >= E.lakeAbove ? (hash01(id, 'nlk') < 0.35 + wetness * 0.4 ? 1 : 0) +
                                          (wetness > 0.75 && hash01(id, 'nlk2') < 0.45 ? 1 : 0) : 0;
  for (let i = 0; i < nLakes; i++) {
    out.lakes.push({
      cx: 3 + hash01(id, 'lx' + i) * (G - 6),
      cz: 3 + hash01(id, 'lz' + i) * (G - 6),
      r: 1.6 + hash01(id, 'lr' + i) * (1.4 + wetness * 2.2),
    });
  }
  return out;
}

/* The river's centreline at a given position along its axis. */
function riverCentre(r, along) {
  return r.base + Math.sin(r.phase + along * r.freq) * r.amp;
}

/* ════════════════════════════════════════════════════════════════════════════
   🌊 THE SEA — the third body type, and the only one every city has.
   ----------------------------------------------------------------------------
   A river exists above wetness 0.52 and a lake above 0.34, so a bit over half of
   all cities have no surface water at all. The sea is not rolled. Every map ends
   at a coast on its EAST side; what a city id decides is the SHAPE of that
   coast, never its existence.

   🧭 WHY EAST AND NOT A ROLLED SIDE, WHICH IS THE OBVIOUS MOVE.
      node-city's default camera stands at (14, 15, 14) looking at the origin,
      and on the `medium` quality tier — the one EVERY non-WebGPU client boots at
      — `scene.fog` runs 25 → 34. From that camera the far corner of the plate is
      already 39.7 units out, i.e. 100% fog. Measured against the frustum, the
      ONLY ground outside the plate that is both in shot and inside the fog's far
      stop is the strip east of the plate at roughly z ∈ [−10, +2]: the bottom
      right of the frame, 21–29 units from the lens.
      A rolled side would therefore give three cities in four an ocean that is
      either behind the camera or 100% haze — which is not "a coast you cannot
      see today", it is the /src/outside failure recorded verbatim in its own
      tuning file ("at −19.6 … invisible in the photograph"), shipped again.
      The side is a constant so that the sea is a fact about the GAME; the id
      still owns the bay, the headland and how close the water comes.

   ⚠ EVERYTHING HERE IS IN TILE UNITS, MEASURED FROM THE PLATE'S EAST EDGE at
     tile coordinate `grid - 0.5`. This file has never seen a world coordinate
     and does not start now; /src/ocean converts once, where it has HALF.
   ════════════════════════════════════════════════════════════════════════════ */
function buildSea(id, G) {
  const S = WATER.sea;
  return {
    side: 'east',
    grid: G,
    /* The waterline's mean tile-x. */
    base: (G - 0.5) + S.inset,
    /* Two phases and nothing else is rolled. Frequencies and weights are tuning,
       so two cities differ in WHERE the bay is rather than in how wiggly the
       coast is — a coast whose roughness varied per city would read as a
       rendering inconsistency rather than as geography. */
    p1: hash01(id, 'sea1') * Math.PI * 2,
    p2: hash01(id, 'sea2') * Math.PI * 2,
    f1: Math.PI * 2 / S.wavePeriodCoarse,
    f2: Math.PI * 2 / S.wavePeriodFine,
    reach: S.reach,
    strength: S.strength,
    purity: S.purity,
    name: S.name,
  };
}

/* 🔴 THE WATERLINE. THE ONE TRUTH, AND BOTH CONSUMERS READ THIS FUNCTION.
   `sourceAt()` asks it how far a tile is from the water; /src/ocean asks it
   where to put the edge of the mesh. If either had its own copy, the player
   would eventually stand on a beach the simulation says is inland — and the
   contradiction would be visible on screen, which is the worst place for one.
   Returns the tile-x of the shoreline at tile-z `z`. Defined for ALL z,
   including well past the grid, because the mesh runs further north and south
   than the buildable plate does. */
export function shoreXAt(sea, z) {
  if (!sea) return Infinity;
  const S = WATER.sea;
  return sea.base + S.bow * (Math.sin(sea.p1 + z * sea.f1) * S.weightCoarse
                           + Math.sin(sea.p2 + z * sea.f2) * S.weightFine);
}

/* How strongly the sea reaches a tile: 1 at (and beyond) the waterline, falling
   to 0 `reach` tiles inland.
   ⚠ SMOOTHSTEP, NOT LINEAR, for the same reason `falloff` above is not a cone:
     a linear ramp gives the coast a wide weak fringe and the last tile that
     "counts" is then an arbitrary rounding, which is exactly the sort of edge a
     player learns to distrust. */
export function seaStrengthAt(sea, x, z) {
  if (!sea) return 0;
  const d = shoreXAt(sea, z) - x;          // tiles inland; ≤0 means in the water
  if (d <= 0) return sea.strength;
  if (d >= sea.reach) return 0;
  const t = 1 - d / sea.reach;
  return sea.strength * t * t * (3 - 2 * t);
}

function surfaceStrengthAt(surface, x, z) {
  let m = 0;
  const r = surface.river;
  if (r) {
    const along = r.horiz ? x : z;
    const across = r.horiz ? z : x;
    const d = Math.abs(across - riverCentre(r, along));
    if (d <= 0.75) m = Math.max(m, WATER.surface.flowCenter);
    else if (d <= 1.85) m = Math.max(m, WATER.surface.flowBank * (1 - (d - 0.75) / 1.1));
  }
  for (const l of surface.lakes) {
    const d = Math.hypot(x - l.cx, z - l.cz);
    if (d <= l.r) m = Math.max(m, WATER.surface.lakeFlow);
    else if (d <= l.r + 1.2) m = Math.max(m, WATER.surface.lakeFlow * 0.45 * (1 - (d - l.r) / 1.2));
  }
  return m;
}

/* How far along the river a tile is, 0 (upstream) → 1 (downstream). Used only
   by the pollution coupling, and returns null off the channel. */
export function riverPosition(surface, x, z, grid) {
  const r = surface && surface.river;
  if (!r) return null;
  const along = r.horiz ? x : z;
  const across = r.horiz ? z : x;
  if (Math.abs(across - riverCentre(r, along)) > 1.85) return null;
  const t = Math.max(0, Math.min(1, along / Math.max(1, grid - 1)));
  return r.flip ? 1 - t : t;
}

/* 🔍 SELF-CHECK — proves the guarantees hold for any city id, so a tuning change
   to `endow` can never silently produce a city with no water in it. Returns the
   violations rather than throwing; index.js logs them. Same contract as
   /src/economy/endowment.js `verify()`. */
export function verify(sampleIds, grid) {
  const ids = sampleIds && sampleIds.length ? sampleIds
    : Array.from({ length: 200 }, (_, i) => 'verify-city-' + i);
  const bad = [];
  let wetCount = 0, dryCount = 0, riverCount = 0, seaCount = 0;
  for (const id of ids) {
    invalidate();
    const H = hydrologyFor(id, grid || 24);
    if (!H.basins.length) { bad.push(id + ': no aquifer at all'); continue; }
    const strongest = H.basins.reduce((a, b) => (b.strength > a.strength ? b : a));
    if (strongest.strength < WATER.endow.minBasinStrength - 1e-9)
      bad.push(id + ': strongest basin ' + strongest.strength.toFixed(3) + ' < floor');
    if (!(H.groundAt(strongest.cx, strongest.cz) >= WATER.aquifer.minRead))
      bad.push(id + ': strongest basin centre reads below minRead');
    for (const b of H.basins) {
      if (!(b.volume > 0) || !(b.recharge > 0)) bad.push(id + ': basin ' + b.i + ' has no volume/recharge');
      if (!(b.purity > 0 && b.purity <= 1)) bad.push(id + ': basin ' + b.i + ' purity out of range');
    }
    // Determinism: the same id must answer the same way after a cache flush.
    const a1 = H.groundAt(3, 5);
    invalidate();
    const a2 = hydrologyFor(id, grid || 24).groundAt(3, 5);
    if (a1 !== a2) bad.push(id + ': groundAt not deterministic across a cache flush');
    /* 🌊 EVERY CITY HAS A SEA, AND THIS IS WHERE THAT SENTENCE IS PROVED.
       ~54% of cities get neither river nor lake, so "surface water exists" was
       never a property this file could assert before. The sea is, and it is
       asserted for the same reason `minBasinStrength` is: a promise nobody
       checks is a promise that quietly stops being true after a tuning pass.
       Three things, because "the object exists" is not the claim:
         · the body is there at all;
         · the waterline clears node-city's ring road — the perimeter footway
           ends 1.21 tiles past the plate edge, and a coast inside that runs the
           sea over a road (see WATER.sea.inset's 🐞);
         · a tile ON the last column reads a non-zero sea, i.e. the reach is
           actually long enough to make the east edge coastal. Without this the
           sea would be a picture with no consequence. */
    const sea = H.surface.sea;
    const G2 = grid || 24;
    if (!sea) { bad.push(id + ': no sea'); }
    else {
      let minShore = Infinity, maxShore = -Infinity;
      for (let z = -4; z <= G2 + 4; z += 0.25) {
        const s = H.shoreAt(z);
        if (s < minShore) minShore = s;
        if (s > maxShore) maxShore = s;
      }
      if (!(minShore - (G2 - 0.5) > 1.21))
        bad.push(id + ': waterline ' + (minShore - (G2 - 0.5)).toFixed(3) +
                 ' tiles off the plate — inside the ring road footway (1.21)');
      if (!(maxShore > minShore)) bad.push(id + ': the coastline is a straight ruled line');
      if (!(H.seaAt(G2 - 1, Math.floor(G2 / 2)) > 0))
        bad.push(id + ': the last column is not coastal — reach is too short to matter');
      if (!(H.seaAt(0, Math.floor(G2 / 2)) === 0))
        bad.push(id + ': the WEST edge reads as coastal — the sea has crossed the map');
      seaCount++;
    }
    if (H.wetness > 0.62) wetCount++;
    if (H.wetness < 0.36) dryCount++;
    if (H.surface.river) riverCount++;
  }
  invalidate();
  return { ok: !bad.length, violations: bad, sampled: ids.length,
           wetShare: wetCount / ids.length, dryShare: dryCount / ids.length,
           riverShare: riverCount / ids.length, seaShare: seaCount / ids.length };
}

export default { hydrologyFor, classOf, CLASSES, verify, invalidate, riverPosition,
                 shoreXAt, seaStrengthAt };
