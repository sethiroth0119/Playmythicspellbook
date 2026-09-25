/* ══ 🛣 STREET SEGMENTATION ═════════════════════════════════════════════════
   A street is a contiguous run of road tiles along ONE axis. The input is the
   same information makeRoad already derives per tile — the n/s/e/w neighbour
   mask — so nothing new is stored on a tile and nothing has to be kept in sync
   with the mesh builder.

   THE RULE, in full, because the edge cases are where a segmenter goes wrong:

     1. A HORIZONTAL run is a maximal set of tiles sharing a z, with consecutive
        x, every adjacent pair road-connected east/west. Emitted when >= 2 tiles.
     2. A VERTICAL run is the same along z. Emitted when >= 2 tiles.
     3. Any road tile that landed in NO run of >= 2 is its own one-tile street.
        (Without rule 3 an isolated tile would be emitted twice — once as a
        length-1 horizontal run and once as a length-1 vertical run — and the
        city would show two identically-named one-tile streets on one tile.)

   A CROSSING TILE BELONGS TO BOTH STREETS, and that is deliberate rather than a
   shortcut. An intersection really is part of both roads that meet there — CS2
   models it the same way — and the alternative (assigning it to one and cutting
   the other in half) produces the much worse artefact of a long avenue that
   silently becomes two streets with two names because something crossed it.
   The consequence is stated wherever it matters: a junction tile's traffic is
   counted for both of its streets, and the panel says so.

   Clicking a crossing tile has to choose ONE street to open, though, and that is
   what `primary` is for: the longer of the two runs wins, with the run the tile
   is INTERIOR to breaking a length tie, and 'x' breaking a total tie. Stable, so
   the same tile always opens the same dossier.                                 */

const kOf = (x, z) => x + ',' + z;

/* Sort key that makes "the anchor tile" a total order rather than whatever
   Object.keys happened to return. The anchor seeds the name generator, so it
   must not depend on insertion order. */
function anchorOf(tiles) {
  let best = null, bx = 0, bz = 0;
  for (const k of tiles) {
    const c = k.indexOf(',');
    const x = +k.slice(0, c), z = +k.slice(c + 1);
    if (best === null || z < bz || (z === bz && x < bx)) { best = k; bx = x; bz = z; }
  }
  return best;
}

/* Build the whole street graph for a set of road tile keys.
   `isRoad(x, z)` is handed in so this file never touches game.tiles itself.

   🛣 `classOf(x, z)` IS OPTIONAL AND BREAKS A RUN WHERE THE CLASS CHANGES.
   A street is "a contiguous run of road tiles along one axis" — and once roads
   have classes (/src/roads: street, avenue, highway, bridge…), a run that
   silently spanned two of them would be ONE street with ONE name covering a
   residential street and the trunk road it turns into. Worse, it would be
   quoted at a single per-tile upkeep (index.js quotes tiles × roadCost) at the
   exact moment two classes started pricing differently, which is how a UI
   number drifts from the ledger without anything throwing.

   ⚠ ABSENT ⇒ BYTE-FOR-BYTE THE OLD SEGMENTER. The default resolver answers
     null for every tile, so every comparison below is null === null and every
     run is exactly the run this file emitted before classes existed. No city's
     street names move because a module loaded.
   ⚠ THE CLASS BREAKS THE RUN; IT DOES NOT BREAK THE JUNCTION. makeStreet's
     `perp` and `deadEnds` below still ask the raw isRoad, deliberately: a
     street that continues as a different class is not a dead end, and a
     crossing of two classes is still a crossing. Those are facts about the
     NETWORK, and the network does not know about classes. */
export function segment(roadKeys, isRoad, classOf) {
  const streets = [];
  const covered = new Set();
  const parsed = [];
  for (const k of roadKeys) {
    const c = k.indexOf(',');
    parsed.push({ k, x: +k.slice(0, c), z: +k.slice(c + 1) });
  }
  const clsAt = (typeof classOf === 'function') ? classOf : () => null;
  // Continue a run only into a road OF THE SAME CLASS.
  const cont = (x, z, cls) => isRoad(x, z) && clsAt(x, z) === cls;
  // …and a run STARTS wherever the previous tile is not that same-class road,
  // which is what keeps every tile the start of exactly one run per axis. That
  // invariant is what makes this O(roads) rather than O(roads²), and it is also
  // what stops rule 3 below emitting a duplicate.
  const starts = (px, pz, dx, dz) => !cont(px - dx, pz - dz, clsAt(px, pz));

  const emit = (axis, cells) => {
    if (cells.length < 2) return;
    const tiles = cells.map(c => c.k);
    for (const t of tiles) covered.add(t);
    streets.push(makeStreet(axis, cells, isRoad));
  };

  /* Horizontal: a run STARTS at a tile whose west neighbour is not a road of
     the same class, and is walked east. */
  for (const p of parsed) {
    if (!starts(p.x, p.z, 1, 0)) continue;
    const cls = clsAt(p.x, p.z);
    const cells = [];
    let x = p.x;
    while (cont(x, p.z, cls)) { cells.push({ k: kOf(x, p.z), x, z: p.z }); x++; }
    emit('x', cells);
  }
  for (const p of parsed) {
    if (!starts(p.x, p.z, 0, 1)) continue;
    const cls = clsAt(p.x, p.z);
    const cells = [];
    let z = p.z;
    while (cont(p.x, z, cls)) { cells.push({ k: kOf(p.x, z), x: p.x, z }); z++; }
    emit('z', cells);
  }
  // Rule 3: leftovers become one-tile streets, exactly once each.
  for (const p of parsed) {
    if (covered.has(p.k)) continue;
    streets.push(makeStreet('x', [{ k: p.k, x: p.x, z: p.z }], isRoad));
  }

  /* Which street a tile opens. Longer run wins; interior beats endpoint; 'x'
     breaks the remaining tie. Computed here so every consumer agrees. */
  const primary = new Map();
  for (const s of streets) {
    for (const k of s.tiles) {
      const cur = primary.get(k);
      if (!cur) { primary.set(k, s); continue; }
      if (betterPrimary(s, cur, k)) primary.set(k, s);
    }
  }
  return { streets, primary };
}

function interiorTo(street, k) {
  const i = street.tiles.indexOf(k);
  return i > 0 && i < street.tiles.length - 1;
}
function betterPrimary(a, b, k) {
  if (a.tiles.length !== b.tiles.length) return a.tiles.length > b.tiles.length;
  const ai = interiorTo(a, k), bi = interiorTo(b, k);
  if (ai !== bi) return ai;
  return a.axis === 'x' && b.axis !== 'x';
}

function makeStreet(axis, cells, isRoad) {
  const tiles = cells.map(c => c.k);
  /* Junctions: tiles on this run that also connect PERPENDICULAR to it. That is
     the count of other roads meeting this one, and it is what tells a long spur
     from a real through-route in the name generator. */
  let junctions = 0;
  for (const c of cells) {
    // Stamped on the cell, not just counted: the world label uses it to sit on
    // a clear run of carriageway instead of straddling an intersection.
    c.perp = axis === 'x'
      ? (isRoad(c.x, c.z - 1) || isRoad(c.x, c.z + 1))
      : (isRoad(c.x - 1, c.z) || isRoad(c.x + 1, c.z));
    if (c.perp) junctions++;
  }
  const first = cells[0], last = cells[cells.length - 1];
  /* Ends that continue into another road are THROUGH ends; ends that stop are
     dead ends. Reported in the dossier because "this street dead-ends" is a real
     fact about the network a player can act on. */
  const deadEnds =
    (axis === 'x'
      ? (isRoad(first.x - 1, first.z) ? 0 : 1) + (isRoad(last.x + 1, last.z) ? 0 : 1)
      : (isRoad(first.x, first.z - 1) ? 0 : 1) + (isRoad(last.x, last.z + 1) ? 0 : 1));
  const anchor = anchorOf(tiles);
  return {
    axis,
    tiles,
    cells,
    anchor,
    junctions,
    deadEnds,
    len: tiles.length,
    /* Session-local handle. NOT the name key — names are stored per tile so that
       extending or splitting a street does not orphan its name (see index.js).
       This exists so the panel can tell two streets apart while it is open. */
    id: axis + ':' + anchor + ':' + tiles.length,
  };
}

export default { segment };
