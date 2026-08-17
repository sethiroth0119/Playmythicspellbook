/* ══════════════════════════════════════════════════════════════════════════
   🏠 ADDRESSES — a building stops being "tile 5,7" and becomes a street number.
   ──────────────────────────────────────────────────────────────────────────
   An address is TWO derived facts, and neither of them is invented:

     1. THE STREET is the road tile this building FRONTS. Frontage is read from
        `t.rot` first (the player turned it to face something, and the dossier
        header already prints "facing south"), then from the four neighbours in
        the same NEI order the rest of the city walks them. No road adjacent ⇒
        NO ADDRESS. A building in the middle of a field does not have one, and
        saying so is the honest answer — see `why: 'nofrontage'`.

     2. THE NUMBER is the building's position ALONG that street, with the two
        sides of the street numbered odd and even the way a real street is.

   🔴 THE NUMBER IS KEYED TO THE GRID COORDINATE, NOT TO THE ROAD'S EXTENT.
      The first cut numbered from the start of the contiguous road run —
      `n = coord - runStart` — which is what a surveyor does, and it is wrong
      here for one reason: laying ONE more road tile at the west end of a
      street renumbered every house on it. A player who extends a road should
      not come back to a district where every address moved. The absolute
      coordinate along the street axis is stable for the life of the tile, and
      still ascends along the street, which is all the reader needs.

   🔴 NOTHING HERE IS PERSISTED. The address is a pure function of
      (tile position, tile rotation, which neighbours are roads). That is why
      an old save opens with addresses and no migration: there is no new field
      to be missing. Move the road and the address moves, which is true.

   🛣 THE STREET NAME comes from the streets layer if that module is mounted —
      it is a SIBLING FEATURE THAT MAY NOT EXIST (see CLAUDE.md on optional
      modules), so it is read through a duck-typed probe that tolerates every
      plausible shape and refuses anything that is not a plain short string.
      With no streets layer the fallback is the grid line the building fronts
      ("Row 8", "Column 12") — deliberately NOT a made-up street name, because
      a fabricated "Robin Street" would be indistinguishable from a real one
      the day the streets module ships and starts disagreeing with it.
   ══════════════════════════════════════════════════════════════════════════ */

/* index.html: `['south','west','north','east'][t.rot & 3]` — the same order,
   as unit steps. rot is quarter turns and the recipes are authored
   frontage-to-+Z, so rot 0 faces +z. */
const ROT_DIR = [[0, 1], [-1, 0], [0, -1], [1, 0]];
/* The same neighbour order index.html's NEI uses, so "first road found" means
   the same thing here as it does in bonusesFor() and lotValue(). */
const NEI4 = [[0, -1], [1, 0], [0, 1], [-1, 0]];

const HOUSE_BASE = 100;    // first block on every street, as most cities number

/* ── the streets layer, read defensively ────────────────────────────────────
   Every call is wrapped: another builder's module may throw, may return an
   object, may return a number. Only a short plain string survives. */
function pluckName(v, depth) {
  if (v == null) return null;
  if (typeof v === 'string') {
    const s = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
    return s ? s.slice(0, 48) : null;
  }
  if (typeof v !== 'object' || (depth | 0) > 1) return null;
  for (const p of ['name', 'label', 'street', 'streetName', 'title', 'text']) {
    const s = pluckName(v[p], (depth | 0) + 1);
    if (s) return s;
  }
  return null;
}
const STREET_FNS = ['nameAt', 'streetAt', 'nameFor', 'nameForTile', 'streetFor',
  'streetOf', 'streetNameAt', 'at', 'forTile', 'get', 'lookup'];
function streetsLayer() {
  try {
    if (typeof window === 'undefined') return null;
    return window.MythicStreets || window.MythicStreet || window.NCStreets || null;
  } catch (e) { return null; }
}
export function moduleStreetName(rx, rz) {
  const S = streetsLayer();
  if (!S) return null;
  const k = rx + ',' + rz;
  for (const fn of STREET_FNS) {
    if (typeof S[fn] !== 'function') continue;
    let s = null;
    try { s = pluckName(S[fn](rx, rz), 0); } catch (e) { s = null; }
    if (!s) { try { s = pluckName(S[fn](k), 0); } catch (e) { s = null; } }
    if (s) return s;
  }
  return null;
}

/* Which way does the road at (rx,rz) run, as seen from a building standing
   beside it? The building's offset is along ONE axis, so the street runs along
   the OTHER — which is well defined even at a crossroads, where asking "which
   way does the road continue" has two answers. */
export function streetAxisFor(dx, dz) { return dz !== 0 ? 'x' : 'z'; }

function ordinal(n) {
  const v = n % 100;
  const suf = (v >= 11 && v <= 13) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
  return n + suf;
}

/* The label for one street, with its provenance. `source` is printed in the
   panel so a player can tell a real street name from the grid fallback.

   ⚠ THE FALLBACK IS A NUMBERED STREET, NOT A MADE-UP ONE, and the distinction
     is the whole point. The first cut printed "Row 8" / "Column 12", which is
     unambiguously honest and reads like a debug string in a panel heading —
     rubric 12 is legibility. Manhattan's own convention solves it without
     inventing anything: numbered STREETS run east–west, numbered AVENUES run
     north–south, and the number here is the grid line the road actually sits
     on (1-based, because no city has an 0th Street). "112 4th Street" is a
     real address AND a statement about the grid. It is still marked
     `source: 'grid'`, and the card says so, so the day the streets layer ships
     a real name nobody has to reconcile two of them. */
export function streetLabel(rx, rz, axis) {
  const m = moduleStreetName(rx, rz);
  if (m) return { name: m, source: 'streets' };
  return axis === 'x'
    ? { name: ordinal(rz + 1) + ' Street', source: 'grid' }
    : { name: ordinal(rx + 1) + ' Avenue', source: 'grid' };
}

/* The road tile this building fronts, or null. */
export function frontageOf(C, x, z, t) {
  const facing = ROT_DIR[(((t && t.rot) | 0) & 3)];
  const tries = [facing].concat(NEI4);
  for (const d of tries) {
    const rx = x + d[0], rz = z + d[1];
    let road = false;
    try { road = !!C.isRoad(rx, rz); } catch (e) { road = false; }
    if (road) return { rx, rz, dx: d[0], dz: d[1], faced: d === facing };
  }
  return null;
}

/* THE ADDRESS. Always returns an object; `ok` is the only thing a caller
   should branch on, and `why` names the reason when it is false so the panel
   can print a real sentence instead of an empty row. */
export function addressOf(C, k) {
  const t = C.game && C.game.tiles ? C.game.tiles[k] : null;
  if (!t) return { ok: false, why: 'notile' };
  const p = String(k).split(',');
  const x = +p[0], z = +p[1];
  if (!Number.isFinite(x) || !Number.isFinite(z)) return { ok: false, why: 'badkey' };

  /* A ROAD IS NOT AT an address — it IS the street. Report which one, so the
     dossier of a road tile can be titled with the street's name. */
  if (t.type === 'road') {
    // A road's own axis: whichever direction it continues in. Both ⇒ crossing.
    let ew = false, ns = false;
    try { ew = C.isRoad(x - 1, z) || C.isRoad(x + 1, z); } catch (e) {}
    try { ns = C.isRoad(x, z - 1) || C.isRoad(x, z + 1); } catch (e) {}
    const axis = ew && !ns ? 'x' : !ew && ns ? 'z' : ew && ns ? 'x' : 'x';
    const st = streetLabel(x, z, axis);
    return { ok: false, why: 'isroad', street: st.name, source: st.source,
             crossing: ew && ns, axis };
  }

  const f = frontageOf(C, x, z, t);
  if (!f) return { ok: false, why: 'nofrontage' };

  const axis = streetAxisFor(f.dx, f.dz);
  const along = axis === 'x' ? f.rx : f.rz;       // position ALONG the street
  const roadPerp = axis === 'x' ? f.rz : f.rx;    // the street's own line
  const selfPerp = axis === 'x' ? z : x;          // which side we stand on
  const odd = selfPerp < roadPerp ? 1 : 0;
  const number = HOUSE_BASE + 2 * along + odd;
  const st = streetLabel(f.rx, f.rz, axis);
  return {
    ok: true, number, street: st.name, source: st.source,
    text: number + ' ' + st.name,
    side: odd ? 'odd' : 'even',
    faced: !!f.faced,
    road: f.rx + ',' + f.rz,
    axis,
  };
}
