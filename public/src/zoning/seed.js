/* ══════════════════════════════════════════════════════════════════════════
   🏘 ARCHETYPE STEERING — how a zone decides which house gets built, without
   one line of makeHousing being touched.

   THE PROBLEM. makeHousing (node-city/index.html ~5290) already owns five
   archetypes — row, walkup, semi, cottage, detached — and picks between them
   with a DISTRICT ROLL: one hash per 4x4 block of tiles, every plot inside it
   drawing from the same weighted bag. That is a good system and it is what
   gives the city runs of terraces and pockets of cottages. What it is not is
   ZONING: the roll decides, the player does not.

   THE CONSTRAINT. makeHousing is owned by another workstream and is being
   re-modelled in parallel; editing it is not on the table. It also uses tx,tz
   for EXACTLY ONE thing — seeding. Verified by reading every occurrence: the
   coords appear on four lines, all of them inside rdRng() calls. Nothing about
   the mesh's geometry, orientation or plot layout is derived from where the
   tile is.

   THE MECHANISM. Because the archetype is a pure function of the seed, a zone
   does not need to override the choice — it only needs to hand makeHousing a
   DIFFERENT SEED. `surrogate(tx, tz, arch)` searches a deterministic sequence
   of candidate coordinate pairs for one whose district roll lands on the
   archetype the player zoned for, and node-city's buildMesh passes that pair to
   makeHousing instead of the real tile. The house is then built at the real
   tile by placeMeshAt, which owns the tile→world mapping and never looked at
   the seed.

   Three properties fall out of this, and all three are load-bearing:
     • It is STILL a pure function of the plot. The surrogate is hashed from the
       real coords plus the zone, so a reload, an upgrade, a repair and an admin
       re-skin all rebuild the same house — which is the exact bug the seeding
       comment in makeHousing was written to record. Do not make the surrogate
       depend on time, on call order, or on anything that is not serialised.
     • UNZONED LAND IS UNTOUCHED. No zone ⇒ no surrogate ⇒ makeHousing gets the
       real coords and the district roll decides, exactly as before. The roll
       became the FALLBACK rather than being deleted.
     • It degrades to nothing. If the search fails, or this module 404s, the
       caller gets null and passes the real coords.

   THE COUPLING, STATED HONESTLY. The weights below are a COPY of makeHousing's
   own table. If that table is retuned upstream and this one is not, a zone will
   still build a valid, good-looking house — it will just occasionally be the
   wrong archetype for the label the player picked. That is the failure mode:
   cosmetic drift, never a throw. `selfTest()` prints the predicted mix so the
   drift is one console call away from being seen, and MIX_SOURCE names the
   function to diff against.
   ══════════════════════════════════════════════════════════════════════════ */

export const MIX_SOURCE = 'node-city/index.html makeHousing() — the DISTRICT/MIX block';
export const ARCHETYPES = ['row', 'walkup', 'semi', 'cottage', 'detached'];

const MIX = {
  terrace: ['row', 'row', 'row', 'row', 'row', 'walkup'],
  blocks:  ['walkup', 'walkup', 'walkup', 'row', 'row'],
  suburb:  ['detached', 'detached', 'semi', 'semi', 'cottage'],
  lanes:   ['cottage', 'cottage', 'detached', 'semi', 'detached'],
};

/* Replica of node-city's rdRng, used ONLY when the real one was not handed
   over. mount() passes the live function, which is always preferable — this is
   the "module loaded against an older page" case. */
export function localRdRng(tx, tz) {
  if (typeof tx !== 'number' || typeof tz !== 'number' || !isFinite(tx) || !isFinite(tz)) return Math.random;
  let h = (Math.imul(tx | 0, 0x27d4eb2d) ^ Math.imul(tz | 0, 0x165667b1) ^ 0x9e3779b9) >>> 0;
  h = (h || 0x9e3779b9) >>> 0;
  const step = () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
  step(); step();
  return step;
}

export function makeSeeder(rdRng) {
  const rng = typeof rdRng === 'function' ? rdRng : localRdRng;

  /* Which archetype makeHousing WOULD build for these coords. Mirrors the
     order of draws exactly: the district hash is consumed first, then the
     tile's own generator is asked once — and that first draw is the archetype.
     Anything makeHousing draws afterwards (dimensions, cladding, colours) is
     deliberately not modelled; it varies per surrogate and that is the point. */
  function predict(tx, tz) {
    const dq = rng((tx >> 2) * 7 + 13, (tz >> 2) * 5 - 11)();
    const district = dq < .30 ? 'terrace' : dq < .48 ? 'blocks' : dq < .78 ? 'suburb' : 'lanes';
    const mix = MIX[district];
    return mix[(rng(tx, tz)() * mix.length) | 0];
  }

  /* One 32-bit hash of (tile, archetype). The archetype is part of it so that
     re-zoning a plot from row to towers moves it to a genuinely different
     house rather than to the nearest one that happened to match. */
  function hash3(a, b, c) {
    let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35)) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 0x2545f491) >>> 0; h ^= h >>> 13;
    return h >>> 0;
  }

  /* 🔎 THE SEARCH. 96 candidates: the rarest archetype in the table above is
     cottage at ~14.8% of plots, so the chance of 96 misses is about 1 in
     30,000 — and a miss costs a vanilla house, not an error. The candidates are
     pushed a long way off the board (±4096) purely for hygiene: a surrogate
     that landed on a real tile's coords would tie two plots' colours together
     for no reason. */
  const cache = new Map();
  function surrogate(tx, tz, arch) {
    if (!arch || ARCHETYPES.indexOf(arch) < 0) return null;
    if (typeof tx !== 'number' || typeof tz !== 'number' || !isFinite(tx) || !isFinite(tz)) return null;
    const ck = tx + ',' + tz + ':' + arch;
    if (cache.has(ck)) return cache.get(ck);
    const ai = ARCHETYPES.indexOf(arch);
    const h = hash3(tx, tz, ai + 1);
    let out = null;
    for (let i = 0; i < 96; i++) {
      const sx = ((h ^ Math.imul(i + 1, 0x9e3779b1)) % 100003 | 0) + 4096;
      const sz = ((Math.imul(h, 0x85ebca6b) ^ Math.imul(i + 1, 0xc2b2ae35)) % 100019 | 0) - 4096;
      if (predict(sx, sz) === arch) { out = [sx, sz]; break; }
    }
    cache.set(ck, out);
    return out;
  }

  /* Reports the predicted archetype mix over a sample of the board plus a
     round-trip check that every archetype is reachable. If `ok` ever comes back
     false, the copy of MIX above has drifted from makeHousing's. */
  function selfTest(n = 2000) {
    const hist = {}; ARCHETYPES.forEach(a => hist[a] = 0);
    for (let i = 0; i < n; i++) {
      const a = predict((i * 7919) % 4096, (i * 104729) % 4096);
      hist[a] = (hist[a] || 0) + 1;
    }
    const found = {}; let ok = true;
    for (const a of ARCHETYPES) {
      const s = surrogate(3, 5, a);
      found[a] = s ? predict(s[0], s[1]) : null;
      if (found[a] !== a) ok = false;
    }
    return { ok, source: MIX_SOURCE, mix: hist, surrogateRoundTrip: found };
  }

  return { predict, surrogate, selfTest, clearCache: () => cache.clear(), ARCHETYPES };
}
