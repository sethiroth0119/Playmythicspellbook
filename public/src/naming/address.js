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

   🔴 THIS FILE NO LONGER ASKS /src/streets ANYTHING. IT USED TO, AND IT WAS
   WRONG THE WHOLE TIME.
   The original wrote its street read as a duck-typed probe — three candidate
   window globals × five candidate method names, called as `S[m](x, z)` with
   two numbers — because /src/streets had not landed yet and its API was a
   guess. /src/streets then shipped `nameAt(key)` taking ONE "x,z" key string
   (public/src/streets/index.js:362). `nameAt(10, 12)` returns null for every
   tile in the city, so the probe never matched once, the silent fallback below
   fired for all 172 buildings, and the player read invented street names off
   every dossier in the game while the real named-streets feature sat mounted
   and working. Nothing logged. Nothing looked broken. That is the precise
   failure mode a permanently-firing guarded fallback has: it is byte-identical
   to a working integration.

   SO THE PROBE IS GONE, AND SO IS THE INVENTED NAME. /src/dossier/address.js
   is the ONE module that asks "what is this road called" — it made the same
   guess and happened to make it correctly, it already carries the numbered-
   grid fallback and the `source` provenance marker the panels print, and it is
   the address openInspect actually renders (see the note on dossierAddr in
   ./index.js: when two modules disagree about one building, the dossier's
   answer is the one that wins). This file consumes `streetLabel` from there
   and derives only what is genuinely its own: frontage and house number.

   Consequence, and it is the point: when the streets module is absent this
   file now prints "4th Street" marked `source:'grid'` instead of a plausible
   "Kestrel Lane" marked nothing. A fabricated name is unfalsifiable — the day
   streets ships, nobody can tell which of the two names was real. A numbered
   one is visibly a fallback, and moduleStreetName() warns once in the console
   naming the global it wanted.
   ══════════════════════════════════════════════════════════════════════════ */
import { streetLabel } from '../dossier/address.js';
/* 🛣 The road resolver — an address faces a CARRIAGEWAY, whatever class it is. */
import { isRoadTile } from '../roads/types.js';

/* Which way the road at (rx,rz) runs. A road with more east-west road
   neighbours than north-south ones is an east-west street; ties go to
   east-west, which only matters for an isolated stub and is stable either way. */
function roadAxis(tiles, rx, rz) {
  const isRoad = (x, z) => isRoadTile(tiles[x + ',' + z]);
  const ew = (isRoad(rx - 1, rz) ? 1 : 0) + (isRoad(rx + 1, rz) ? 1 : 0);
  const ns = (isRoad(rx, rz - 1) ? 1 : 0) + (isRoad(rx, rz + 1) ? 1 : 0);
  return ns > ew ? 'ns' : 'ew';
}

/* The frontage: which adjacent road tile this building's door faces. Probed in
   a FIXED order so the answer never depends on object iteration — a building
   between two streets keeps one address rather than flickering. */
const FRONTAGE = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/* ⚠ `salt` IS GONE FROM THE SIGNATURE. It existed only to seed the invented
   street names that this file no longer produces; keeping an ignored parameter
   would leave the next reader thinking an address still varies per city. The
   one call site is registry.js's `address()`. */
export function addressFor(tiles, key) {
  const t = tiles[key];
  if (!t) return null;
  const p = key.split(',');
  const x = +p[0], z = +p[1];
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  for (const [dx, dz] of FRONTAGE) {
    const rx = x + dx, rz = z + dz;
    const r = tiles[rx + ',' + rz];
    if (!isRoadTile(r)) continue;
    const axis = roadAxis(tiles, rx, rz);
    /* THE STREET, from the module that owns street names. streetLabel speaks
       the dossier's axis vocabulary — 'x' for a road running east–west, 'z'
       for one running north–south — which is this file's 'ew'/'ns' under a
       different name, so translate rather than keeping two conventions.
       `source` rides out on the returned object: 'streets' means a real named
       street, 'grid' means the numbered fallback and the console said so. */
    const lbl = streetLabel(rx, rz, axis === 'ew' ? 'x' : 'z');
    const street = lbl.name;
    /* Odds one side, evens the other — the same convention every real street
       uses, and it is what makes two facing buildings read as facing. The side
       is decided by which way the building sits FROM the road. */
    const along = (axis === 'ew') ? x : z;
    const side = (axis === 'ew') ? (z < rz ? 1 : 0) : (x < rx ? 1 : 0);
    const num = Math.max(1, along * 2 + (side ? 1 : 2));
    return { num, street, source: lbl.source, full: num + ' ' + street,
             road: rx + ',' + rz, axis };
  }
  return null;   // no frontage: the dossier says so rather than inventing one
}
