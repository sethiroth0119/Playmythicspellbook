/* ══════════════════════════════════════════════════════════════════════════
   📍 ADDRESSES — a house number and a street, derived, never stored.

   WHY DERIVED. The reference dossier (BAR.md frame 2) lists a citizen's
   "residence address" as a cross-link, and an address is only useful if it
   agrees with the street it is on. Street NAMES belong to /src/streets — a
   sibling module in this same batch of work that may not exist yet. If this
   file froze an address into the save, then the day a player renamed a street
   every building on it would still be showing the old one. So the number and
   the street are recomputed from the road grid on every read, and nothing
   about an address rides the save. That is a deliberate size decision as much
   as a correctness one: 172 addresses is another ~5 KB of localStorage for
   data that is a pure function of state already saved.

   🔴 THE GUARDED SIBLING READ. /src/streets registers a window global whose
   exact API is not fixed yet. This file probes a handful of plausible shapes,
   accepts a string or a {name} object, and falls back to its own deterministic
   naming if none of them answer. A 404 on the streets module costs the player
   nicer street names and nothing else — see how node-city imports the economy
   and degrades when it is missing.
   ══════════════════════════════════════════════════════════════════════════ */
import { hash32 } from './generate.js';
import { PLACE, STREET_SUFFIX } from './words.js';

/* Probed in order. First one that returns a non-empty string or {name} wins.
   Keep this list SHORT and keep it here — a guessed API scattered through the
   module is a guessed API you cannot correct in one edit when /src/streets
   lands and its real method name is known. */
const STREET_GLOBALS = ['MythicStreets', 'MythicCityStreets', 'NodeCityStreets'];
const STREET_METHODS = ['nameAt', 'streetNameAt', 'streetAt', 'addressStreet', 'nameForTile'];

function siblingStreetName(x, z) {
  if (typeof window === 'undefined') return null;
  for (const g of STREET_GLOBALS) {
    const S = window[g];
    if (!S) continue;
    for (const m of STREET_METHODS) {
      if (typeof S[m] !== 'function') continue;
      try {
        const v = S[m](x, z);
        if (typeof v === 'string' && v.trim()) return v.trim();
        if (v && typeof v.name === 'string' && v.name.trim()) return v.name.trim();
      } catch (e) { /* a sibling that throws is a sibling that is absent */ }
    }
  }
  return null;
}

/* The fallback. Deterministic on the road's own row/column index plus the city
   salt, so every tile on the same road agrees, and two different cities do not
   have the same street list. */
function fallbackStreetName(salt, axis, index) {
  const h = hash32(salt + '|street|' + axis + '|' + index);
  return PLACE[h % PLACE.length] + ' ' + STREET_SUFFIX[(h >>> 8) % STREET_SUFFIX.length];
}

/* Which way the road at (rx,rz) runs. A road with more east-west road
   neighbours than north-south ones is an east-west street; ties go to
   east-west, which only matters for an isolated stub and is stable either way. */
function roadAxis(tiles, rx, rz) {
  const isRoad = (x, z) => { const t = tiles[x + ',' + z]; return !!(t && t.type === 'road'); };
  const ew = (isRoad(rx - 1, rz) ? 1 : 0) + (isRoad(rx + 1, rz) ? 1 : 0);
  const ns = (isRoad(rx, rz - 1) ? 1 : 0) + (isRoad(rx, rz + 1) ? 1 : 0);
  return ns > ew ? 'ns' : 'ew';
}

/* The frontage: which adjacent road tile this building's door faces. Probed in
   a FIXED order so the answer never depends on object iteration — a building
   between two streets keeps one address rather than flickering. */
const FRONTAGE = [[0, -1], [1, 0], [0, 1], [-1, 0]];

export function addressFor(tiles, salt, key) {
  const t = tiles[key];
  if (!t) return null;
  const p = key.split(',');
  const x = +p[0], z = +p[1];
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  for (const [dx, dz] of FRONTAGE) {
    const rx = x + dx, rz = z + dz;
    const r = tiles[rx + ',' + rz];
    if (!r || r.type !== 'road') continue;
    const axis = roadAxis(tiles, rx, rz);
    const street = siblingStreetName(rx, rz)
      || fallbackStreetName(salt, axis, axis === 'ew' ? rz : rx);
    /* Odds one side, evens the other — the same convention every real street
       uses, and it is what makes two facing buildings read as facing. The side
       is decided by which way the building sits FROM the road. */
    const along = (axis === 'ew') ? x : z;
    const side = (axis === 'ew') ? (z < rz ? 1 : 0) : (x < rx ? 1 : 0);
    const num = Math.max(1, along * 2 + (side ? 1 : 2));
    return { num, street, full: num + ' ' + street, road: rx + ',' + rz, axis };
  }
  return null;   // no frontage: the dossier says so rather than inventing one
}
