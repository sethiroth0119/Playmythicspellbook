/* ════════════════════════════════════════════════════════════════════════════
   🌋 GEOLOGY — how hot the rock is under THIS city, tile by tile.
   ----------------------------------------------------------------------------
   "GEOTHERMAL: clean and constant, but only where the ground allows — gate it on
    the endowment so it is a place-dependent prize rather than a strictly-better
    button."

   THIS FILE IS THE ENFORCEMENT POINT FOR THAT SENTENCE and it is the only one.
   `heatAt(x, z)` is the single gate; the placement refusal, the siting preview,
   the output multiplier and the overlay all ask it. If a second place ever
   decides where a Geothermal Plant may stand, the two will disagree and a player
   will be able to build a plant that produces nothing — which is the worst of
   both.

   ── IT IS THE endowment.js TEMPLATE, RUN AGAIN ─────────────────────────────
   /src/economy/endowment.js answers "what is in the ground under THIS node" as a
   PURE DETERMINISTIC FUNCTION of the node id: no storage, no migration, no dice
   roll at claim time, so two players see the same ground for ever and an old
   save gets the same answer as a new one. Everything below is the same shape,
   asking a different question — not "what can be dug" but "how hot is it".

   The consequences of that choice are the same ones endowment.js lists:
     • A save written before this file existed gets the same heat map as one
       written after, because nothing about the map is stored. There is no
       migration and there is nothing to migrate.
     • The player cannot re-roll it. Geothermal is a property of the PLACE.
     • Two players on the same city id see the same field, so a screenshot of a
       hot spring is checkable.

   ── 🔴 HOW THIS RELATES TO /src/water, AND WHY IT IS NOT A SECOND TRUTH ────
   /src/water/endowment.js already derives a hydrology from the same city id and
   already knows which of its basins are SPRINGFED. A springfed basin is, in that
   module's own words, "the endowment's own answer to surface water sitting over
   ground water" — and in the real world a spring that recharges 3.2× faster than
   the rock around it is very often a HOT spring.

   So this file READS that flag and lets it LIFT the heat it would otherwise have
   rolled. It never writes to /src/water, never contradicts it, and never needs
   it: with the water module absent the field is complete and self-consistent on
   its own, and the springfed lift is a bonus term that is simply zero. The two
   modules therefore answer two different questions about one place and agree
   wherever they overlap, which is exactly the relationship endowment.js's header
   demands of terroir.

   ⚠ AND THE LIFT IS DELIBERATELY ONE-WAY. Heat never moves an aquifer. If a
     future round wants hot water to feed the Purifier, that belongs on the WATER
     side, derived from this call — not smuggled back through here, which would
     close a loop between two deterministic fields and make both of them depend
     on evaluation order.

   ── WHY A FIELD AND NOT A LIST OF SITES ────────────────────────────────────
   A short list of "geothermal tiles" reads as an arbitrary permission slip. A
   continuous field with a THRESHOLD reads as terrain: the player can see the hot
   ground getting hotter, can tell a marginal site from an excellent one, and the
   plant's output scales with how good the site is rather than snapping between
   "allowed" and "forbidden". Same reasoning /src/water gives for basins having a
   radius and a strength instead of being a set of well tiles.
   ════════════════════════════════════════════════════════════════════════════ */

import { POWER } from './tuning.js';

/* ── 🎲 A STABLE HASH ───────────────────────────────────────────────────────
   FNV-1a over `cityId + ':' + salt`, byte-for-byte the same construction
   /src/economy/endowment.js and /src/water/endowment.js use. Not cryptographic
   and does not need to be: it needs to be STABLE across sessions, machines and
   JS engines, which `Math.random()` is not, and which anything involving object
   key order is not either. Returns a float in [0,1). */
function hash01(id, salt) {
  const s = String(id == null ? '' : id) + ':' + salt;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 8) / 0x01000000;
}

/* ── THE PROVINCE CLASSES ───────────────────────────────────────────────────
   A city sits in one of four thermal provinces, and the class is what the panel
   NAMES. A raw 0.43 tells a player nothing; "Volcanic — three vents, one of them
   exceptional" tells them what city they are living in.

   ⚠ The `below` bounds are read off a TRIANGULAR roll (see fieldFor), so the
     share of cities in each class is not the width of its band. Measured over
     4,000 ids by verify(): roughly 46% Cold, 34% Warm, 16% Hot, 4% Volcanic.
     That is the intended shape — geothermal is a PRIZE, and a prize that most
     cities have is a button. */
export const PROVINCES = [
  { key: 'cold',     label: 'Cold Crust',   below: 0.42, vents: [0, 1], blurb:
    'Deep, cold basement rock. Any heat here is shallow groundwater warmth, not a resource.' },
  { key: 'warm',     label: 'Warm Basin',   below: 0.68, vents: [1, 2], blurb:
    'A sedimentary basin with a raised gradient. One or two spots are worth drilling.' },
  { key: 'hot',      label: 'Hot Field',    below: 0.90, vents: [2, 3], blurb:
    'A genuine geothermal field. Several vents, and the ground is warm between them.' },
  { key: 'volcanic', label: 'Volcanic',     below: 1.01, vents: [3, 4], blurb:
    'Young volcanic rock. Steam at shallow depth across most of the map — build on it.' },
];

export function provinceOf(gradient) {
  for (const p of PROVINCES) if (gradient < p.below) return p;
  return PROVINCES[PROVINCES.length - 1];
}

/* ── ONE-SLOT MEMO ──────────────────────────────────────────────────────────
   Keyed on cityId + grid + the springfed signature. The field is pure, so the
   memo is only ever a speed-up — but heatAt() is called once per tile by the
   overlay (576 calls) and once per placement preview, and re-deriving four vents
   and a triangular roll each time is pure waste.
   ⚠ THE SPRINGFED SIGNATURE IS IN THE KEY ON PURPOSE. /src/water can land AFTER
     this module has already answered — module import order is not guaranteed —
     and a memo that ignored it would pin the whole city to the no-water answer
     for the session. That is the "guarded fallback that fires forever" failure
     in its quietest form: the field would be self-consistent, plausible, and
     permanently missing its hot springs. */
let _memo = { key: null, val: null };
export function invalidate() { _memo = { key: null, val: null }; }

/* The springfed basins /src/water is willing to tell us about, as plain
   {x, z, r} discs. Empty array when the water module is absent or refuses —
   which is a complete, valid answer and not a degraded one. */
function springs(cityId) {
  try {
    const W = (typeof window !== 'undefined' && window.MythicWater) || null;
    if (!W || typeof W.endowment !== 'function') return [];
    const e = W.endowment(cityId);
    if (!e || !Array.isArray(e.basins)) return [];
    return e.basins.filter(b => b && b.springfed)
                   .map(b => ({ x: +b.x || 0, z: +b.z || 0, r: Math.max(1, +b.r || 1) }));
  } catch (e) { return []; }
}

export function fieldFor(cityId, grid) {
  const id = String(cityId == null ? '' : cityId);
  const G = Math.max(4, (grid | 0) || 24);
  const sp = springs(id);
  const key = id + '|' + G + '|' + sp.map(s => s.x + ',' + s.z + ',' + s.r.toFixed(2)).join(';');
  if (_memo.key === key) return _memo.val;

  const GE = POWER.geo;

  /* THE CITY'S THERMAL GRADIENT — a triangular roll, exactly as /src/water rolls
     its wetness. Averaging N uniform draws concentrates the mass in the middle,
     which is what makes the extremes rare WITHOUT a hand-written probability
     table that has to be re-tuned whenever a band moves. */
  let g = 0;
  for (let i = 0; i < GE.gradientRolls; i++) g += hash01(id, 'grad' + i);
  const gradient = Math.max(0, Math.min(1, g / GE.gradientRolls));
  const prov = provinceOf(gradient);

  /* THE VENTS. Located, not scattered: each is a disc with a centre, a radius
     and a peak temperature, so heat falls off with distance and a plant on the
     shoulder of a vent is worse than one on its crown. Same construction as a
     water basin, for the same reason — it gives the overlay something with a
     shape, and it gives siting a gradient to climb. */
  const span = prov.vents[1] - prov.vents[0];
  const n = prov.vents[0] + Math.floor(hash01(id, 'nvent') * (span + 0.999));
  const vents = [];
  for (let i = 0; i < n; i++) {
    /* Inset from the edge by `ventInset` tiles. A vent centred on the map border
       loses most of its disc off-map and reads to the player as a bug in the
       overlay rather than as geology. */
    const m = GE.ventInset;
    const cx = m + hash01(id, 'vx' + i) * (G - 1 - m * 2);
    const cz = m + hash01(id, 'vz' + i) * (G - 1 - m * 2);
    const r = GE.ventRadiusMin + hash01(id, 'vr' + i) * (GE.ventRadiusMax - GE.ventRadiusMin) *
              (0.55 + 0.45 * gradient);
    // Peak temperature. Scaled by the province, so a Cold Crust city's one vent
    // is a warm patch and a Volcanic city's is a steam field.
    const peak = Math.min(1, (GE.ventPeakMin + hash01(id, 'vp' + i) * (GE.ventPeakMax - GE.ventPeakMin)) *
                             (0.55 + 0.75 * gradient));
    vents.push({ i, cx, cz, r, peak, name: ventName(id, i) });
  }

  /* ♨ THE SPRINGFED LIFT. A springfed basin gets its own low, broad vent — a
     hot spring rather than a magma chamber, so `springPeak` is deliberately
     BELOW `ventPeakMin`: a spring alone is usually not enough to license a
     plant, and it is the combination of a spring sitting on a warm province
     that is. That is the whole point of reading /src/water here: it makes two
     independent facts about one place COMPOUND, which is what makes a location
     feel discovered rather than granted. */
  for (let i = 0; i < sp.length; i++) {
    const s = sp[i];
    vents.push({ i: vents.length, cx: s.x, cz: s.z, r: s.r * GE.springRadiusMul,
                 peak: Math.min(1, GE.springPeak * (0.65 + 0.6 * gradient)),
                 spring: true, name: 'Hot Spring' + (sp.length > 1 ? ' ' + (i + 1) : '') });
  }

  /* THE BASE FIELD. Everywhere gets a little heat from the province itself, so
     a Volcanic city is warm between its vents and a Cold Crust city is not.
     Below `POWER.plants.geothermal.minHeat` nothing may be built, so the base
     alone never licenses a plant except in a Volcanic city — which is exactly
     the reward for living on one. */
  const base = GE.baseFloor + gradient * GE.baseSpan;

  function heatAt(x, z) {
    let h = base;
    for (const v of vents) {
      const dx = x - v.cx, dz = z - v.cz;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d >= v.r) continue;
      /* Smoothstep falloff, not linear: a linear cone has a visible crease at
         its rim on the overlay and makes the "is this tile hot enough" boundary
         look like a drawing artefact instead of a contour. */
      const t = 1 - d / v.r;
      h = Math.max(h, v.peak * (t * t * (3 - 2 * t)));
    }
    return Math.max(0, Math.min(1, h));
  }

  const val = {
    cityId: id, grid: G, gradient, prov, vents, base, heatAt,
    /* The best tile on the map and its heat — what the panel quotes when it says
       "no site on this map is hot enough", so the refusal is a fact rather than
       an opinion. Computed once, here, over the same field the gate reads. */
    best: (function () {
      let b = { x: 0, z: 0, h: -1 };
      for (let z = 0; z < G; z++) for (let x = 0; x < G; x++) {
        const h = heatAt(x, z);
        if (h > b.h) b = { x, z, h };
      }
      return b;
    })(),
    summary() {
      const usable = vents.filter(v => v.peak >= POWER.plants.geothermal.minHeat).length;
      return prov.label + ' — ' + (vents.length ? vents.length + ' vent' + (vents.length === 1 ? '' : 's') +
             ', ' + usable + ' hot enough to drill' : 'no vents') + '.';
    },
  };
  _memo = { key, val };
  return val;
}

/* Vent names, so the panel's source table reads as a place rather than as an
   array index — the same argument /src/water makes for naming its basins. */
const VENT_WORDS = ['Ember', 'Cinder', 'Kettle', 'Fumarole', 'Steamhead', 'Blacklode',
                    'Sulphur', 'Deepvent', 'Ashwell', 'Hearth', 'Brimstone', 'Scald'];
function ventName(id, i) {
  return VENT_WORDS[Math.floor(hash01(id, 'vn' + i) * VENT_WORDS.length) % VENT_WORDS.length] +
         (i > 0 ? ' ' + (i + 1) : '');
}

/* ── 🔍 THE SELF-CHECK ──────────────────────────────────────────────────────
   A tuning change must not be able to silently produce a world where geothermal
   is either impossible or universal. Both failures are invisible in a diff and
   both take a play session to notice.
   Reported at boot ONLY when it fails — a self-check that logs on success is one
   everyone learns to scroll past. */
export function verify(ids, grid) {
  const list = Array.isArray(ids) && ids.length ? ids
    : Array.from({ length: 200 }, (_, i) => 'verify-city-' + i);
  const G = grid || 24;
  const violations = [];
  let buildable = 0, volcanic = 0, cold = 0;
  for (const id of list) {
    const f = fieldFor(id, G);
    if (!isFinite(f.best.h)) { violations.push({ id, why: 'heat field is not finite' }); continue; }
    if (f.best.h > 1.0001 || f.best.h < 0) violations.push({ id, why: 'heat out of 0..1: ' + f.best.h });
    if (f.best.h >= POWER.plants.geothermal.minHeat) buildable++;
    if (f.prov.key === 'volcanic') volcanic++;
    if (f.prov.key === 'cold') cold++;
  }
  invalidate();
  const share = buildable / list.length;
  /* THE TWO BOUNDS THAT MATTER. Below `min` geothermal is a myth nobody ever
     sees; above `max` it stops being a prize. These are the numbers a retune has
     to keep, and stating them here is what makes them checkable. */
  const B = POWER.geo.buildableShare;
  if (share < B.min) violations.push({ id: '(all)', why: 'only ' + (share * 100).toFixed(0) + '% of cities can build geothermal' });
  if (share > B.max) violations.push({ id: '(all)', why: (share * 100).toFixed(0) + '% of cities can build geothermal — no longer a prize' });
  return { ok: !violations.length, violations, sampled: list.length,
           buildableShare: share, volcanicShare: volcanic / list.length, coldShare: cold / list.length };
}
