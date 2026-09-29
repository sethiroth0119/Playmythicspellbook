/* ════════════════════════════════════════════════════════════════════════════
   🗺 THE FIELDS — what is in the ground of THIS city, and where. Deterministic.
   ----------------------------------------------------------------------------
   "Show resources on the ground … so a player can site a business on the
    resource that feeds it."

   THIS FILE IS THAT SENTENCE, and it is built the way /src/water/endowment.js
   builds the aquifers and /src/power/geology.js builds the vents: as a PURE
   FUNCTION OF THE CITY ID. No storage, no migration, no dice roll at claim
   time. Two players looking at the same city see the same ground, forever, and
   a save written before this file existed gets the same answer as one written
   after it — which is the only reason it is safe to make a city's production
   depend on it at all.

   ── 🔴 WHY THIS IS NOT A THIRD OPINION ABOUT THE GROUND ─────────────────────
   Two files already have one, and neither is contradicted here:

     /src/economy/endowment.js  — "can this NODE extract raw ore at all?" ~51
                                  tier-0 deposits behind a HARD `canExtract`
                                  build gate. One bit, per node, for the
                                  258-id resource chain.
     /src/city/terroir.js       — a per-node SOFT yield ceiling over 14 ledger
                                  resources, carrying the SOLO promise that
                                  nobody is ever locked out.
     THIS FILE                  — "WHERE IN THIS CITY is it, and how much
                                  better is the good ground than the bad?" A
                                  per-TILE field, and a multiplier bounded
                                  between RES.yield.floor and RES.yield.top.

   The split is the one /src/water/endowment.js already drew and defended:
   COARSE decides whether a thing can be had at all, FINE decides where in this
   city and how well. The finer answer never denies the coarser one, because it
   cannot reach zero and it gates nothing.

   🚫 REJECTED, DELIBERATELY, AND FOR THE SECOND TIME IN THIS CODEBASE: biasing
      these fields by `MythicEconomy.gradeOf(node, 'ironOre')`. It is the
      obvious "make the two agree" move and it is wrong for exactly the reasons
      /src/water/endowment.js wrote down. First, it makes the ground's answer
      depend on WHETHER ANOTHER MODULE LOADED — a 404 on /src/economy would
      silently re-roll every ore body in the city, which is the determinism
      promise broken in the least visible way possible. Second, several of those
      grades are PINNED rather than rolled, so reading them back is mostly
      reading our own floor.

   🚫 ALSO REJECTED: reusing node-city's `NC_TERRAIN_AT(wx,wz).m` (moisture) as
      fertility. It is the obvious free lunch and it is wrong twice. Its noise
      seeds are LITERAL CONSTANTS (node-city/index.html:6479), so the moisture
      map is IDENTICAL IN EVERY CITY — every player would get the same farmland
      in the same corner. And re-seeding it per city would retroactively move
      the ground plate's colours and /src/wild's thicket scatter in every
      existing save. It is a rendering field, not an endowment.

   ── EVERYTHING HERE IS PURE ─────────────────────────────────────────────────
   No DOM, no window, no THREE, no import of anything but tuning. That is not
   tidiness: it is what makes this file importable from node, which is the only
   reason the determinism check below can be a test rather than a claim.
   ════════════════════════════════════════════════════════════════════════════ */

import { RES } from './tuning.js';

/* ── 🎲 A STABLE HASH ───────────────────────────────────────────────────────
   FNV-1a over `cityId + ':' + salt`, with the `>>> 0` after every step, then a
   murmur3-style finalizer. BYTE-IDENTICAL to /src/water/endowment.js's
   `hash01` and /src/power/geology.js's — the fifth copy of the same eight
   lines, and it is a copy on purpose.

   🔴 THE AVALANCHE IS NOT TIDYING; IT IS THE BUG FIX /src/water MEASURED.
      FNV-1a mixes low bits well and HIGH bits badly, and `hash01` divides by
      2³² — i.e. it reads the TOP bits. So salts differing only in their last
      byte ('ore-x0' vs 'ore-x1') come back nearly EQUAL, and the first run of
      that file put three aquifers at the same coordinates with the same radius:
      "three aquifers that were one aquifer drawn three times — the exact shape
      of a feature that looks like it works." Every salt in this file differs in
      its last character, so this file would have hit it head-on.

   ⚠ …AND WHY IT IS NOT IMPORTED FROM A SIBLING. Importing /src/economy's would
     drag in recipes.js — the whole 258-id production graph — for eight lines of
     arithmetic, and would make a 404 on the economy a 404 on the city's ore.
     Importing /src/water's would make a 404 on the hydrology re-roll the ore.
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

/* Smooth radial falloff, 1 at the centre and 0 at the rim, with a shoulder.
   (1-t²)² rather than (1-t), and /src/water/endowment.js states the reason this
   file inherits: a linear cone gives every body a wide useless fringe, and the
   overlay then reads as ONE SOFT BLUR instead of as located deposits. That is
   the exact complaint this feature exists to answer, so the shape matters more
   here than it did there. */
function falloff(d, r) {
  if (r <= 0) return 0;
  const t = d / r;
  if (t >= 1) return 0;
  const u = 1 - t * t;
  return u * u;
}

/* Body names, so the panel can say "the Redseam lode is the one to build on"
   instead of "deposit 2". A fixed list indexed by body number — deterministic
   for free, and never a per-city name roll that would need its own seed and
   could collide with /src/naming. */
const NAMES = {
  ore:     ['Redseam', 'Ironfall', 'Blackcut', 'Marrow Lode', 'Slagreach'],
  petro:   ['Emberwell', 'Hollowvent', 'Sourpocket'],
  stone:   ['Greyridge', 'Coldquarry', 'Hangfoot', 'Palewall'],
  fertile: ['Longmeadow', 'Greenmarch', 'Sedgeflat', 'Thornacre', 'Millbottom'],
  timber:  ['Deadwood Stand', 'Ashcopse', 'Ravenhold', 'Bitterpine'],
};

/* ════════════════════════════════════════════════════════════════════════════
   THE FIELDS THEMSELVES
   ════════════════════════════════════════════════════════════════════════════ */

let _cache = { key: null, val: null };

export function invalidate() { _cache = { key: null, val: null }; }

/* The spec row for a field id, and the field that feeds a ledger resource.
   ⚠ `fieldForRes` IS THE ONLY PLACE THE RESOURCE→GROUND MAPPING EXISTS. The
     host's pre-pass walks `def.gen` generically and asks this; it never names a
     building type. That is `roadsAdjacentTo(match)`'s rule — a resolver, never
     a list of type strings in a second file — which node-city has had to
     correct three separate times by number. */
export function specOf(id) {
  for (const f of RES.fields) if (f.id === id) return f;
  return null;
}
export function fieldForRes(res) {
  for (const f of RES.fields) if (f.res.indexOf(res) >= 0) return f;
  return null;
}

function buildBodies(id, G, spec) {
  const n = Math.max(spec.nMin, Math.min(spec.nMax,
    spec.nMin + Math.floor(hash01(id, spec.id + '-n') * (spec.nMax - spec.nMin + 0.999))));
  const bodies = [];
  const names = NAMES[spec.id] || [];
  for (let i = 0; i < n; i++) {
    const inset = Math.min(3, Math.max(1, Math.floor(spec.rMin)));
    let cx = inset + hash01(id, spec.id + '-x' + i) * (G - inset * 2 - 1);
    let cz = inset + hash01(id, spec.id + '-z' + i) * (G - inset * 2 - 1);
    const r = spec.rMin + (spec.rMax - spec.rMin) * hash01(id, spec.id + '-r' + i);
    let s = spec.sMin + (spec.sMax - spec.sMin) * hash01(id, spec.id + '-s' + i);
    /* 🛟 THE SCARCITY FLOOR, IMPOSED BY CONSTRUCTION RATHER THAN AFTERWARDS.
       Body 0 is the city's MAIN one for this resource: its centre is SNAPPED TO
       A TILE and its strength is floored at RES.minPeak.

       Why snapped, which looks fussy and is not: falloff() is 1 only at the
       exact centre, and a centre at (7.43, 11.08) puts the nearest TILE 0.44
       away — which on the tightest body in the table (petro, r 1.6) reads
       0.645 × s. So a floor applied to `s` would NOT have been a floor on any
       tile a player can actually build on, and the guarantee would have been
       true of a point nobody can occupy. Snapping makes the peak tile read
       exactly `s`, which is the number verify() then asserts.

       Lifted to EXACTLY the minimum and never higher — /src/water's rule: "a
       pinned basin is never a gift." Bodies 1..n-1 are rolled freely and are
       usually the interesting ones; this only guarantees the floor. */
    if (i === 0) {
      cx = Math.round(cx); cz = Math.round(cz);
      s = Math.max(s, RES.minPeak);
    }
    bodies.push({
      i, name: names[i % (names.length || 1)] || (spec.label + ' ' + (i + 1)),
      cx, cz, r, strength: Math.max(0.05, Math.min(1, s)),
      // The covered area, in tiles. The falloff integrates to about half the
      // disc, so half of πr² is the honest figure for "how big is this body".
      area: Math.PI * r * r * 0.5,
    });
  }
  return bodies;
}

/* Build every field for a city. Pure, deterministic, cached on (cityId, grid)
   in a SINGLE slot — the player is only ever in one city, and the overlay asks
   for this on every repaint. Same one-slot memo /src/water and /src/power use;
   a Map keyed by id would be an unbounded leak for a value nobody re-reads. */
export function fieldsFor(cityId, grid) {
  const G = Math.max(4, (grid | 0) || 24);
  const id = String(cityId == null ? '' : cityId);
  const ck = id + '@' + G;
  if (_cache.key === ck && _cache.val) return _cache.val;

  const byId = {};
  for (const spec of RES.fields) {
    const bodies = buildBodies(id, G, spec);
    const base = spec.base || 0;
    const valueAt = (x, z) => {
      let m = base;
      for (const b of bodies) {
        const v = b.strength * falloff(Math.hypot(x - b.cx, z - b.cz), b.r);
        if (v > m) m = v;
      }
      return m > 1 ? 1 : m;
    };
    /* The best TILE, scanned once at build time rather than derived from the
       body list. The two are not the same number when bodies overlap, and the
       panel prints this one because "the best ground in this city" has to be a
       fact about a tile the player can click. */
    let best = { x: 0, z: 0, v: -1 };
    for (let z = 0; z < G; z++) for (let x = 0; x < G; x++) {
      const v = valueAt(x, z);
      if (v > best.v) best = { x, z, v };
    }
    byId[spec.id] = { spec, bodies, base, valueAt, best };
  }

  const F = {
    cityId: id, grid: G,
    ids: RES.fields.map(f => f.id),
    spec: specOf,
    field(fid) { return byId[fid] || null; },
    bodies(fid) { return byId[fid] ? byId[fid].bodies : []; },
    best(fid) { return byId[fid] ? byId[fid].best : { x: 0, z: 0, v: 0 }; },
    valueAt(fid, x, z) { const f = byId[fid]; return f ? f.valueAt(x, z) : 0; },
    /* Which body a tile is standing on, or null. `minRead` is shared with the
       refusal so the message and the map can never disagree about what counts
       as "on the deposit". */
    bodyAt(fid, x, z) {
      const f = byId[fid]; if (!f) return null;
      let best = null, m = 0;
      for (const b of f.bodies) {
        const v = b.strength * falloff(Math.hypot(x - b.cx, z - b.cz), b.r);
        if (v > m) { m = v; best = b; }
      }
      return best && m >= RES.minRead ? { body: best, strength: m } : null;
    },
    /* Every generated field at one tile, for the readout and the inspector.
       Read-through layers (groundwater, heat) are NOT here: they belong to
       their owners and index.js asks those owners live. */
    readAt(x, z) {
      const out = {};
      for (const fid in byId) out[fid] = byId[fid].valueAt(x, z);
      return out;
    },
    /* One line a human can read — the two richest fields, named. */
    summary() {
      const rank = RES.fields.map(s => ({ s, v: byId[s.id].best.v }))
        .sort((a, b) => b.v - a.v);
      const strong = rank.filter(r => r.v >= RES.minPeak + 0.12).slice(0, 2);
      if (!strong.length) return 'ordinary ground — nothing here is exceptional';
      return 'strong ' + strong.map(r => r.s.label.toLowerCase()).join(' and ');
    },
  };
  _cache = { key: ck, val: F };
  return F;
}

/* ════════════════════════════════════════════════════════════════════════════
   🌱 THE YIELD LADDER — the ONE place a field becomes a number.
   ----------------------------------------------------------------------------
   🔴 IT RETURNS A FACTOR AND HAS NEVER SEEN A RATE. node-city computes
      `def.gen[r] × tileMult(...)`; this multiplies it. That is the single-truth
      rule /src/water/hydro.js states — "the HOST owns the rate, the MODULE owns
      the ground" — and it is why a 404 on this module leaves every existing
      city producing byte-identical output: the host's fallback is 1.

   `outdoor` is the row's own existing flag, handed over per tile. A SURFACE
   field (fertile, timber) is exempt for an indoor building: the Hydro Farm is
   ember-lamps in a shed and its own description says "weatherproof", so
   charging it for the soil outside would be the layer telling a lie the player
   can read off the building's own tooltip. An UNDERGROUND field ignores the
   flag entirely, because a roof has never had an opinion about ore. */
export function yieldOf(res, value, outdoor) {
  const spec = fieldForRes(res);
  if (!spec) return { factor: 1, field: null, value: 0, gain: 0, exempt: false };
  if (spec.surface && !outdoor) {
    return { factor: 1, field: spec.id, value: Number(value) || 0, gain: 0, exempt: true };
  }
  const Y = RES.yield;
  const v = Math.max(0, Math.min(1, Number(value) || 0));
  const gain = Math.min(1, v / Y.full);
  return { factor: Y.floor + (Y.top - Y.floor) * gain, field: spec.id, value: v, gain, exempt: false };
}

/* ════════════════════════════════════════════════════════════════════════════
   🔍 SELF-CHECK — same contract as /src/water/endowment.js and
   /src/economy/endowment.js `verify()`: returns the violations rather than
   throwing, and index.js logs it ONLY when it fails. A self-check that logs on
   success is a self-check everybody learns to scroll past.

   It proves the four things a tuning pass could silently break:
     1. every field in every city has a tile at or above RES.minPeak — i.e.
        nobody is ever left with nowhere good to put an extractor, which is the
        SOLO promise restated at tile resolution;
     2. the field is DETERMINISTIC across a cache flush;
     3. two different ids give different ground (the hash-avalanche bug from
        /src/water would show up here as fields that are equal);
     4. the yield ladder stays inside [floor, top] — it can never gate.
   ════════════════════════════════════════════════════════════════════════════ */
export function verify(sampleIds, grid) {
  const ids = sampleIds && sampleIds.length ? sampleIds
    : Array.from({ length: 200 }, (_, i) => 'verify-city-' + i);
  const G = grid || 24;
  const bad = [];

  /* ── 📏 THE OUTLINE MUST NOT PROMISE LESS THAN THE GATE ALLOWS ────────────
     `siteRefusal()` tells the player "every tile inside the outline is a legal
     site", and `bodyAt()` — the thing that actually decides — cuts at
     `minRead`. That sentence is true only while every field's `mark` sits AT OR
     ABOVE `minRead`. A retune that drops one below it makes the map promise
     ground the refusal then denies, which is exactly the defect the
     read-through rows shipped with (see tuning.js ⑤). It is one comparison, so
     it is an assertion and not a comment. */
  for (const spec of RES.fields) {
    if (!(Number(spec.mark) >= RES.minRead))
      bad.push(spec.id + ': mark ' + spec.mark + ' is below minRead ' + RES.minRead +
               ' — the outline would enclose tiles siteRefusal() rejects');
  }
  /* And the read-through rows must carry NO typed threshold at all: theirs is
     read from the owner that gates the field. A number reappearing here is the
     bug coming back. */
  for (const spec of RES.read) {
    if (spec.mark !== undefined)
      bad.push(spec.id + ': carries a typed `mark` — a read-through layer takes its line from `markFrom`');
    if (!spec.markFrom)
      bad.push(spec.id + ': has no `markFrom`, so nothing can state where its line is');
  }

  for (const id of ids) {
    invalidate();
    const F = fieldsFor(id, G);
    for (const spec of RES.fields) {
      const f = F.field(spec.id);
      if (!f || !f.bodies.length) { bad.push(id + ': ' + spec.id + ' has no bodies at all'); continue; }
      if (!(f.best.v >= RES.minPeak - 1e-9))
        bad.push(id + ': best ' + spec.id + ' tile ' + f.best.v.toFixed(3) + ' < minPeak ' + RES.minPeak);
      for (const b of f.bodies) {
        if (!(b.r > 0) || !(b.strength > 0)) bad.push(id + ': ' + spec.id + ' body ' + b.i + ' is degenerate');
        if (b.cx < -1 || b.cz < -1 || b.cx > G || b.cz > G)
          bad.push(id + ': ' + spec.id + ' body ' + b.i + ' is off the plate');
      }
      // Determinism across a cache flush, at a fixed tile.
      const a1 = f.valueAt(3, 5);
      invalidate();
      const a2 = fieldsFor(id, G).valueAt(spec.id, 3, 5);
      if (a1 !== a2) bad.push(id + ': ' + spec.id + ' is not deterministic across a cache flush');
      // The ladder can never gate.
      for (const v of [0, 0.25, 0.5, 0.75, 1]) {
        const y = yieldOf(spec.res[0], v, true);
        if (!(y.factor >= RES.yield.floor - 1e-9 && y.factor <= RES.yield.top + 1e-9))
          bad.push(id + ': yield ' + y.factor.toFixed(3) + ' escaped [floor, top]');
      }
    }
  }
  /* 🎲 THE AVALANCHE TEST. Two ids one byte apart must not produce the same
     ground. This is the check /src/water did not have when it shipped three
     identical aquifers, written here as an assertion rather than as a comment
     about someone else's bug. */
  invalidate();
  const A = fieldsFor('avalanche-a', G);
  const aVals = RES.fields.map(s => A.valueAt(s.id, 7, 11) + ':' + A.best(s.id).x + ',' + A.best(s.id).z);
  invalidate();
  const B = fieldsFor('avalanche-b', G);
  const bVals = RES.fields.map(s => B.valueAt(s.id, 7, 11) + ':' + B.best(s.id).x + ',' + B.best(s.id).z);
  if (aVals.join('|') === bVals.join('|'))
    bad.push('two city ids one byte apart produced identical ground — the hash is not avalanching');
  invalidate();
  return { ok: !bad.length, violations: bad, sampled: ids.length };
}

export default { fieldsFor, fieldForRes, specOf, yieldOf, verify, invalidate };
