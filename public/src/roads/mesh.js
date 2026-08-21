/* ══════════════════════════════════════════════════════════════════════════
   🛣 THE CLASS RECIPES — nine roads, still six draw calls.

   🔴 THE BINDING CONSTRAINT, INHERITED VERBATIM FROM r1_road.js:
      "round 4 adds detail, never a draw call".
   makeRoad emits exactly six merged meshes per tile — B_ROAD (RD_WEAR),
   B_PAVE (MAT.stone), B_DRIVE (MAT.drive), B_SOLID (RD_SOLID), B_GOLD
   (MAT.roadLine) and B_LAMP (lampMat) — and this file emits into THOSE SAME SIX
   BUCKETS, before the merge, through the host's own primitives. So a highway,
   a bridge and a roundabout each cost the same six draw calls a plain street
   costs. Nothing here creates a Mesh, a Material or a Geometry that is not
   already cached by the host's rdGeo/rdQuad.

   ⚠ NO NEW MATERIAL, AND THAT IS WHY EVERY COLOUR GOES IN B_SOLID.
     RD_SOLID is white with `vertexColors: true`, which is what already lets a
     verge be green and a kerb be grey out of one mesh. Every class colour —
     motorway green, galvanised steel, cycle-track green, concrete parapet —
     is a vertex colour on that one material. B_ROAD (RD_WEAR) takes the LINEAR
     GREYSCALE tints only (T_ROAD 1.00, T_TRACK .76 …), because those are
     multipliers on the asphalt, not colours; pushing a hex through rdTint would
     sRGB-decode it. The host's rdCol/rdTint split is what keeps the two honest.

   🔴 THIS FILE IS PURELY ADDITIVE. It never removes a part makeRoad laid, never
      moves one, and never reads or advances rdRng's ten fixed-order rolls
      through the shared stream. Both of those are save-compat contracts:
        · an inserted roll moves every bin, hydrant, drain, patch, shelter and
          verge tone on every tile in every existing city ("APPENDED, NEVER
          INSERTED");
        · a subtracted part means a `street` tile no longer renders byte-for-
          byte as the tile the player already has.
      Where a class needs its own randomness it takes a FRESH rng(tx,tz) stream
      of its own — a second, independent call to the host's rdRng — so the
      shared stream is untouched and a class's props are still a property of the
      tile rather than of the moment it was rebuilt.

   ── HOW A CLASS IS ALLOWED TO CHANGE WHAT YOU SEE, GIVEN THAT ────────────
   Additive-only is a real constraint and it shaped every recipe below. The
   three moves that work:
     1. LAY OVER. The surface stack has room above paint (RD_DY, the grate
        layer) — an alley's setts and a cycle track's green surfacing cover the
        asphalt and its markings completely from there.
     2. LAY ON THE PAVING. The footway is at RD_PT, 3cm above the carriageway.
        Anything laid at RD_PT + a stack step covers footway without touching
        the driving surface — which is how a cul-de-sac's turning head and a
        curve's swept carriageway eat into the pavement without makeRoad having
        to know. `paveOnly()` below is the clip that keeps those layers OFF the
        carriageway, so they never put a step in the driving line.
     3. STAND SOMETHING UP. A median, a crash barrier, a parapet, a roundabout
        island — all raised objects a real road has, all of which read at the
        game's 20-30° camera precisely because they break the flat plane.

   ⚠ WHAT IS DELIBERATELY NOT DONE HERE: THE CARRIAGEWAY IS NEVER WIDENED.
     RD_HW is not read as a variable to change; every class measures ITSELF
     against it. node-city's own note: moving RD_HW "moves every kerb, verge,
     footway, apron and parking bay in the city and re-cuts every junction —
     its own round, not this one". A highway is darker, hatched and barriered;
     it is not wider. Nor is any class multi-tile: index.html:28378 already
     refused multi-tile occupancy at the Stadium and shipped `concourse`
     clearance instead. The roundabout is NINE ONE-TILE ROADS, which is why it
     connects in computeLinks like any other nine roads do.
   ══════════════════════════════════════════════════════════════════════════ */

import { rd } from './tuning.js';

/* ── stepped circles ───────────────────────────────────────────────────────
   Everything round in this file is drawn as a stack of axis-aligned spans,
   because the host's merge carries a TRANSLATION AND NOTHING ELSE — a rotated
   box would have its rotation silently dropped (rdPart's own contract, and the
   same trap RD_BUSH_G pre-bakes its squash to avoid). A 26-row disc at the
   game's camera distance is a circle; at 10 m/unit each step is ~36 cm on a
   ~5 m radius, well under the pixel the camera resolves.
   `emit(x0, x1, z0, z1)` is handed in so the same walk draws asphalt, kerb,
   grass and paint without knowing which. Clipped to the tile on both axes:
   a class may never draw outside its own cell — the ONLY thing in this kit
   that legally reaches a neighbour is makeRoad's apron, and it has a whole
   contract of its own about not doubling. */
function annulus(emit, cx, cz, rIn, rOut, rows) {
  const z0 = Math.max(-0.5, cz - rOut), z1 = Math.min(0.5, cz + rOut);
  if (z1 - z0 <= 1e-4) return;
  const step = (z1 - z0) / rows;
  for (let i = 0; i < rows; i++) {
    const za = z0 + i * step, zb = za + step, dz = Math.abs((za + zb) / 2 - cz);
    if (dz >= rOut) continue;
    const wo = Math.sqrt(rOut * rOut - dz * dz);
    const wi = dz < rIn ? Math.sqrt(rIn * rIn - dz * dz) : 0;
    if (wi <= 0) { emit(Math.max(-0.5, cx - wo), Math.min(0.5, cx + wo), za, zb); continue; }
    emit(Math.max(-0.5, cx - wo), Math.min(0.5, cx - wi), za, zb);
    emit(Math.max(-0.5, cx + wi), Math.min(0.5, cx + wo), za, zb);
  }
}
const disc = (emit, cx, cz, r, rows) => annulus(emit, cx, cz, 0, r, rows);

/* ⭐ THE CLIP THAT MAKES ADDITIVE WORK. True where the tile's PAVING is, i.e.
   everywhere makeRoad did not lay carriageway. It is the exact complement of
   that recipe's own cross — the `zLo/zHi` clip in §2, re-derived from the same
   four booleans rather than guessed — so a layer wrapped in this can never put
   a 3cm step across the driving line. Everything a class lays at RD_PT goes
   through it. */
function paveOnly(emit, N, S, E, W, HW) {
  return (x0, x1, z0, z1) => {
    if (x1 - x0 <= 1e-4) return;
    const zm = (z0 + z1) / 2;
    let exLo, exHi;
    if (Math.abs(zm) <= HW) { exLo = W ? -0.5 : -HW; exHi = E ? 0.5 : HW; }
    else if ((zm < 0 && N) || (zm > 0 && S)) { exLo = -HW; exHi = HW; }
    else { emit(x0, x1, z0, z1); return; }
    if (x1 <= exLo || x0 >= exHi) { emit(x0, x1, z0, z1); return; }
    if (x0 < exLo) emit(x0, Math.min(x1, exLo), z0, z1);
    if (x1 > exHi) emit(Math.max(x0, exHi), x1, z0, z1);
  };
}

/* A bucket writer bound to one layer and one colour: the `emit` the circle
   walkers want. Guards zero-area spans so a clipped row costs nothing. */
const spanTo = (kit, bucket, top, col) => (x0, x1, z0, z1) => {
  if (x1 - x0 > 1e-4 && z1 - z0 > 1e-4) kit.slab(bucket, x0, x1, z0, z1, top, col);
};

/* The traffic spans on each axis, derived from the SAME four booleans makeRoad
   derives its wheel tracks from (§5, armsZ/armsX). Re-derived rather than
   passed because it is three lines and a stale copy is worse than a duplicate
   one — but it is the same rule, and if that rule ever moves, this moves with
   it in one place instead of six. */
function armsOf(N, S, E, W, HW) {
  const z = [], x = [];
  if (N && S) z.push([-0.5, 0.5]); else { if (N) z.push([-0.5, -HW]); if (S) z.push([HW, 0.5]); }
  if (E && W) x.push([-0.5, 0.5]); else { if (E) x.push([HW, 0.5]); if (W) x.push([-0.5, -HW]); }
  return { z, x };
}

/* Declare an upright prop's footprint for /src/contact's AO patch pass. It
   emits no geometry and costs no draw call here — that module merges the whole
   city's patches into ONE mesh. Only things that STAND UP are listed; a flat
   marking would be a smudge with nothing in it (makeRoad's own rule).
   Guarded, because a host that predates `contacts` hands nothing. */
const foot = (CT, x, z, rx, rz, h) => { if (CT) CT.push({ x, z, rx, rz, h, rot: 0 }); };

/* ══════════════════════════════════════════════════════════════════════════
   🌳 AVENUE — a planted central median.
   The median is founded ON the carriageway with its top at RD_PT, which is not
   an arbitrary height: RD_PT is RD_Y + RD_KH, i.e. exactly one kerb above the
   asphalt, so the median reads as the kerbed island it is and stands at the
   same height as the footways either side of the street.
   ⚠ IT STOPS SHORT OF A JUNCTION BOX. A median carried through an intersection
     would bury the crossings and the stop bars makeRoad lays there, and real
     medians end in a nose at the give-way line anyway. `nose` is RD_HW plus a
     kerb, so the nose lands exactly on the edge of the junction box.
   ══════════════════════════════════════════════════════════════════════════ */
function avenue(I, bk, kit, CT) {
  const g = rd('geo.median', {}), Y = kit.Y, C = kit.C;
  const half = g.half, ki = g.kerbIn, nose = g.nose, lift = rd('geo.liftHi', 0.0006);
  const through = I.cnt === 2 && ((I.n && I.s) || (I.e && I.w));
  const axis = (I.n && I.s) ? 'z' : (I.e && I.w) ? 'x' : (I.n || I.s) ? 'z' : 'x';

  // Each median leg, as [from, to] along the axis of travel.
  const legs = [];
  if (through) legs.push([-0.5, 0.5]);
  else {
    if (axis === 'z') { if (I.n) legs.push([-0.5, -nose]); if (I.s) legs.push([nose, 0.5]); }
    else { if (I.w) legs.push([-0.5, -nose]); if (I.e) legs.push([nose, 0.5]); }
  }
  const put = (bucket, lat0, lat1, a0, a1, top, col) => {
    if (axis === 'z') kit.slab(bucket, lat0, lat1, a0, a1, top, col);
    else kit.slab(bucket, a0, a1, lat0, lat1, top, col);
  };
  for (const [a0, a1] of legs) {
    if (a1 - a0 <= 1e-4) continue;
    put(bk.solid, -half, half, a0, a1, Y.PT, C.KERB);                       // the kerbed island
    put(bk.solid, -half + ki, half - ki, a0 + ki, a1 - ki, Y.PT + lift, C.GRASS); // planting
    // The white lines that separate the running lanes from the median. Paint,
    // so they go in at RD_PY and the host turns them into films, not slabs.
    put(bk.solid, g.lineOff, g.lineOff + g.lineW, a0, a1, Y.PY, C.MARK);
    put(bk.solid, -(g.lineOff + g.lineW), -g.lineOff, a0, a1, Y.PY, C.MARK);
  }
  /* Shrubs. Their own PRNG stream (see the header): a second rdRng(tx,tz) call,
     never a draw from makeRoad's shared one. */
  const rnd = kit.rng(I.tx, I.tz);
  const n = legs.length ? 3 : 0;
  for (const [a0, a1] of legs) {
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, a = a0 + (a1 - a0) * t;
      if (rnd() < 0.22) continue;                       // a gap in the planting
      const s = g.shrub * (0.82 + rnd() * 0.36), h = g.shrubH * (0.8 + rnd() * 0.45);
      const px = axis === 'z' ? 0 : a, pz = axis === 'z' ? a : 0;
      kit.part(bk.solid, kit.box(s, h, s), px, Y.PT + h / 2, pz, C.LEAF);
      foot(CT, px, pz, s * 0.6, s * 0.6, h);
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   🛤 HIGHWAY — dark surfacing, hatched shoulders, crash barriers.
   The resurfacing goes in at RD_QY, the patch-repair layer, which is the one
   place a full-tile asphalt overlay can go WITHOUT hiding what makes the road
   read as a road: the wheel tracks (RD_WY), the paint (RD_PY) and the gully
   grate (RD_DY) are all above it and survive. A trunk road that had lost its
   wheel polish would read as freshly laid, every tile, forever.
   ══════════════════════════════════════════════════════════════════════════ */
function highway(I, bk, kit, CT) {
  const g = rd('geo.highway', {}), Y = kit.Y, C = kit.C;
  kit.slab(bk.road, -0.5, 0.5, -0.5, 0.5, Y.QY, kit.tint(g.surface));

  const arms = armsOf(I.n, I.s, I.e, I.w, Y.HW);
  const mid = (g.shoulderIn + g.shoulderOut) / 2, wide = g.shoulderOut - g.shoulderIn;
  const hatch = (axis, a0, a1) => {
    for (let a = a0 + g.hatchGap / 2; a < a1 - g.hatch; a += g.hatch + g.hatchGap) {
      for (const sg of [1, -1]) {
        if (axis === 'z') kit.flat(bk.solid, wide, g.hatch, sg * mid, a + g.hatch / 2, Y.PY, C.MARK);
        else kit.flat(bk.solid, g.hatch, wide, a + g.hatch / 2, sg * mid, Y.PY, C.MARK);
      }
    }
  };
  for (const s of arms.z) hatch('z', s[0], s[1]);
  for (const s of arms.x) hatch('x', s[0], s[1]);

  /* The barrier. Only on a side with no road neighbour — a barrier across a
     junction mouth would fence the road off from the road it meets, and that
     side has no footway to stand it on either. */
  const railY = Y.PT + g.railY;
  const rail = (axis, lat, a0, a1) => {
    const len = a1 - a0, mid2 = (a0 + a1) / 2;
    if (len <= 1e-3) return;
    if (axis === 'z') {
      kit.part(bk.solid, kit.box(g.railT, g.railH, len), lat, railY + g.railH / 2, mid2, g.col);
      for (let a = a0 + g.postEvery / 2; a < a1; a += g.postEvery)
        kit.part(bk.solid, kit.box(g.postW, g.railY + g.railH, g.postW), lat, Y.PT + (g.railY + g.railH) / 2, a, g.col);
    } else {
      kit.part(bk.solid, kit.box(len, g.railH, g.railT), mid2, railY + g.railH / 2, lat, g.col);
      for (let a = a0 + g.postEvery / 2; a < a1; a += g.postEvery)
        kit.part(bk.solid, kit.box(g.postW, g.railY + g.railH, g.postW), a, Y.PT + (g.railY + g.railH) / 2, lat, g.col);
    }
    foot(CT, axis === 'z' ? lat : mid2, axis === 'z' ? mid2 : lat,
         axis === 'z' ? g.railT : len / 2, axis === 'z' ? len / 2 : g.railT, g.railY + g.railH);
  };
  if (I.n || I.s) { if (!I.e) rail('z', g.barrierLat, -0.5, 0.5); if (!I.w) rail('z', -g.barrierLat, -0.5, 0.5); }
  if (I.e || I.w) { if (!I.n) rail('x', -g.barrierLat, -0.5, 0.5); if (!I.s) rail('x', g.barrierLat, -0.5, 0.5); }

  /* One route marker per stretch, not per tile — a green board on every square
     is a hoarding, not a motorway. Its own stream, seeded by the tile. */
  const rnd = kit.rng(I.tx, I.tz);
  if (rnd() < 0.30) {
    const sx = rnd() < 0.5 ? 1 : -1, sz = rnd() < 0.5 ? 1 : -1;
    const px = sx * 0.40, pz = sz * 0.40;
    kit.part(bk.solid, kit.box(g.signT, g.signY, g.signT), px, Y.PT + g.signY / 2, pz, C.DARK);
    kit.part(bk.solid, kit.box(g.signW, g.signH, g.signT), px, Y.PT + g.signY + g.signH / 2, pz, g.signCol);
    foot(CT, px, pz, g.signW / 2, g.signT, g.signY + g.signH);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   🌉 BRIDGE — a parapeted deck.
   The deck is NOT raised. Raising it would break the apron contract in both
   directions: every building recipe lays a full-tile apron in the band
   −0.014 … +0.016, and a road that lifted its own surface would leave a lip
   against every neighbour it aprons onto (RD_AP pays 0.150 INTO the next
   plot). So a bridge is read from its PARAPETS, its expansion joints and the
   steel under its edge beams — which is what actually reads from a city
   camera anyway; the 30 cm of deck lift never would.
   ══════════════════════════════════════════════════════════════════════════ */
function bridge(I, bk, kit, CT) {
  const g = rd('geo.bridge', {}), Y = kit.Y, C = kit.C;
  const through = (I.n && I.s) || (I.e && I.w);
  const axis = (I.n && I.s) ? 'z' : (I.e && I.w) ? 'x' : (I.n || I.s) ? 'z' : 'x';

  const wall = (lat) => {
    if (axis === 'z') {
      kit.part(bk.solid, kit.box(g.beamT, g.beamH, 1.0), lat > 0 ? g.beamLat : -g.beamLat, Y.PT + g.beamH / 2, 0, g.steel);
      kit.part(bk.solid, kit.box(g.parapetT, g.parapetH, 1.0), lat, Y.PT + g.parapetH / 2, 0, g.col);
      kit.part(bk.solid, kit.box(g.capT, g.capH, 1.0), lat, Y.PT + g.parapetH + g.capH / 2, 0, g.capCol);
      for (let a = -0.5 + g.postEvery / 2; a < 0.5; a += g.postEvery)
        kit.part(bk.solid, kit.box(g.postW, g.postH, g.postW), lat, Y.PT + g.postH / 2, a, g.capCol);
      foot(CT, lat, 0, g.capT / 2, 0.5, g.parapetH + g.capH);
    } else {
      kit.part(bk.solid, kit.box(1.0, g.beamH, g.beamT), 0, Y.PT + g.beamH / 2, lat > 0 ? g.beamLat : -g.beamLat, g.steel);
      kit.part(bk.solid, kit.box(1.0, g.parapetH, g.parapetT), 0, Y.PT + g.parapetH / 2, lat, g.col);
      kit.part(bk.solid, kit.box(1.0, g.capH, g.capT), 0, Y.PT + g.parapetH + g.capH / 2, lat, g.capCol);
      for (let a = -0.5 + g.postEvery / 2; a < 0.5; a += g.postEvery)
        kit.part(bk.solid, kit.box(g.postW, g.postH, g.postW), a, Y.PT + g.postH / 2, lat, g.capCol);
      foot(CT, 0, lat, 0.5, g.capT / 2, g.parapetH + g.capH);
    }
  };
  if (axis === 'z') { if (!I.e) wall(g.parapetLat); if (!I.w) wall(-g.parapetLat); }
  else { if (!I.s) wall(g.parapetLat); if (!I.n) wall(-g.parapetLat); }

  // Expansion joints, across the direction of travel. Two per tile, so a run of
  // bridge tiles reads as a sequence of spans rather than one endless slab.
  const j = g.joint / 2, tint = kit.tint(g.jointTint);
  for (const sg of [1, -1]) {
    if (axis === 'z') kit.slab(bk.road, -0.5, 0.5, sg * g.jointAt - j, sg * g.jointAt + j, Y.QY, tint);
    else kit.slab(bk.road, sg * g.jointAt - j, sg * g.jointAt + j, -0.5, 0.5, Y.QY, tint);
  }
  // Steel uprights at the corners of a through span — the truss you see from
  // the water. Only on a through tile: at a junction they would stand in the
  // middle of the crossing.
  if (through) {
    for (const sx of [1, -1]) for (const sz of [1, -1]) {
      const px = sx * (0.5 - g.trussW), pz = sz * (0.5 - g.trussW);
      if (axis === 'z' && (Math.abs(px) < Y.HW)) continue;
      kit.part(bk.solid, kit.box(g.trussW, g.trussH, g.trussW), px, Y.PT + g.trussH / 2, pz, g.steel);
      foot(CT, px, pz, g.trussW, g.trussW, g.trussH);
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   ⭕ ROUNDABOUT — nine one-tile roads, one circle.
   The island tile (`rbisle`) draws the island; the eight ring tiles each draw
   THEIR SLICE of one big annulus, centred on the island they find next door.
   That is why this looks like one continuous circulating carriageway and still
   obeys "one tile is one building": nothing here is multi-tile, the nine tiles
   are nine roads, and computeLinks labels them one component exactly as it
   would label any nine touching road tiles.
   ⚠ THE RING TILE FINDS ITS CENTRE, IT IS NOT TOLD. kit.classAt() resolves a
     neighbour's class through the same resolver everything else uses, so a
     roundabout whose island was demolished degrades to eight ordinary road
     tiles with a give-way bar rather than to eight arcs around nothing.
   ══════════════════════════════════════════════════════════════════════════ */
function rbisle(I, bk, kit, CT) {
  const g = rd('geo.round', {}), Y = kit.Y, C = kit.C, lift = rd('geo.liftHi', 0.0006);
  annulus(spanTo(kit, bk.solid, Y.PT, C.KERB), 0, 0, g.isleKerbIn, g.isleKerbOut, g.rows);
  disc(spanTo(kit, bk.solid, Y.PT + lift, C.GRASS), 0, 0, g.isleKerbIn, g.rows);
  disc(spanTo(kit, bk.solid, Y.PT + lift + g.moundH, C.LEAF), 0, 0, g.moundR, g.rows);
  kit.part(bk.solid, kit.box(g.mastW, g.mastH, g.mastW), 0, Y.PT + g.mastH / 2, 0, C.DARK);
  foot(CT, 0, 0, g.moundR, g.moundR, g.mastH);
  const rnd = kit.rng(I.tx, I.tz);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rnd() * 0.6, r = g.isleKerbIn * 0.62;
    const s = 0.052 * (0.8 + rnd() * 0.5), h = 0.078 * (0.8 + rnd() * 0.5);
    const px = Math.cos(a) * r, pz = Math.sin(a) * r;
    kit.part(bk.solid, kit.box(s, h, s), px, Y.PT + lift + h / 2, pz, C.LEAF);
  }
}

function roundabout(I, bk, kit, CT) {
  const g = rd('geo.round', {}), Y = kit.Y, C = kit.C;
  // Where is the island? One of the eight neighbours, resolved through the
  // shared resolver. Absent ⇒ this tile is a stray; draw the give-way and stop.
  let cx = null, cz = null;
  if (typeof kit.classAt === 'function') {
    for (let dz = -1; dz <= 1 && cx === null; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        if (kit.classAt(I.tx + dx, I.tz + dz) === 'rbisle') { cx = dx; cz = dz; break; }
      }
    }
  }
  if (cx !== null) {
    annulus(spanTo(kit, bk.road, Y.WY, kit.tint(g.ringTint)), cx, cz, g.ringIn, g.ringOut, g.rows);
    annulus(spanTo(kit, bk.solid, Y.PY, C.MARK), cx, cz, g.lineR - g.lineW / 2, g.lineR + g.lineW / 2, g.rows);
  }
  /* Give-way bars, on every approach — an edge that has a road neighbour which
     is NOT part of this roundabout. That is the definition of an approach and
     it needs no extra state: the resolver already knows what the neighbour is. */
  const outside = (dx, dz) => {
    if (typeof kit.classAt !== 'function') return true;
    const c = kit.classAt(I.tx + dx, I.tz + dz);
    return c !== 'roundabout' && c !== 'rbisle';
  };
  const d = g.giveWay, at = 0.5 - d / 2, w = Y.HW * 2;
  if (I.n && outside(0, -1)) kit.flat(bk.solid, w, d, 0, -at, Y.PY, C.MARK);
  if (I.s && outside(0, 1)) kit.flat(bk.solid, w, d, 0, at, Y.PY, C.MARK);
  if (I.e && outside(1, 0)) kit.flat(bk.solid, d, w, at, 0, Y.PY, C.MARK);
  if (I.w && outside(-1, 0)) kit.flat(bk.solid, d, w, -at, 0, Y.PY, C.MARK);
}

/* ══════════════════════════════════════════════════════════════════════════
   🔵 CUL-DE-SAC — a turning head with a planted island.
   The head is the one recipe that really wants to REMOVE footway, and cannot.
   What it does instead is lay asphalt ON the footway through paveOnly(), so
   the head grows into the pavement without ever putting a step in the driving
   line, and rings it with a kerb. The result is the same read from the camera
   and it costs the base recipe nothing.
   ══════════════════════════════════════════════════════════════════════════ */
function culdesac(I, bk, kit, CT) {
  const g = rd('geo.culdesac', {}), Y = kit.Y, C = kit.C;
  const lift = rd('geo.lift', 0.0018), hi = rd('geo.liftHi', 0.0006);
  const pave = (bucket, top, col) => paveOnly(spanTo(kit, bucket, top, col), I.n, I.s, I.e, I.w, Y.HW);

  disc(pave(bk.road, Y.PT + lift, kit.tint(rd('geo.round.ringTint', 0.78))), 0, 0, g.kerbIn, rd('geo.round.rows', 26));
  annulus(pave(bk.solid, Y.PT + lift + hi, C.KERB), 0, 0, g.kerbIn, g.kerbOut, rd('geo.round.rows', 26));

  // The planted island in the middle of the head. This one IS on the
  // carriageway, so it is founded at RD_PT — one kerb up, like every island.
  annulus(spanTo(kit, bk.solid, Y.PT, C.KERB), 0, 0, g.isleR, g.isleR + g.isleKerb, rd('geo.round.rows', 26));
  disc(spanTo(kit, bk.solid, Y.PT + hi, C.GRASS), 0, 0, g.isleR, rd('geo.round.rows', 26));
  const rnd = kit.rng(I.tx, I.tz);
  const sh = 0.062 * (0.8 + rnd() * 0.5), shh = 0.098 * (0.8 + rnd() * 0.5);
  kit.part(bk.solid, kit.box(sh, shh, sh), 0, Y.PT + hi + shh / 2, 0, C.LEAF);
  foot(CT, 0, 0, g.isleR, g.isleR, shh);

  // Bollards around the head, skipping the mouth the road comes in by.
  for (let i = 0; i < g.bollards; i++) {
    const a = (i / g.bollards) * Math.PI * 2 + Math.PI / g.bollards;
    const px = Math.cos(a) * g.bollardR, pz = Math.sin(a) * g.bollardR;
    if (Math.abs(px) < Y.HW && ((pz < 0 && I.n) || (pz > 0 && I.s))) continue;
    if (Math.abs(pz) < Y.HW && ((px < 0 && I.w) || (px > 0 && I.e))) continue;
    kit.part(bk.solid, kit.box(g.bollardW, g.bollardH, g.bollardW), px, Y.PT + lift + g.bollardH / 2, pz, C.DARK);
  }
  // "No through road", on the closed side.
  const sx = I.e ? -1 : 1, sz = I.s ? -1 : 1;
  const px = sx * 0.40, pz = sz * 0.40;
  kit.part(bk.solid, kit.box(g.signT, g.signY, g.signT), px, Y.PT + g.signY / 2, pz, C.DARK);
  kit.part(bk.solid, kit.box(g.signW, g.signH, g.signT), px, Y.PT + g.signY + g.signH / 2, pz, g.signCol);
  foot(CT, px, pz, g.signW / 2, g.signT, g.signY + g.signH);
}

/* ══════════════════════════════════════════════════════════════════════════
   🚲 CYCLE TRACK — surfaced green either side, wanded off the traffic.
   Laid at RD_DY, the TOP of the host's surface stack (the gully-grate layer),
   because a surfaced cycle track really is laid over the road and its gutter,
   and it is the only layer from which a class can cover the gutter pan, the
   kerb grime and the edge line in one pass without touching any of them.
   ══════════════════════════════════════════════════════════════════════════ */
function bikelane(I, bk, kit, CT) {
  const g = rd('geo.bike', {}), Y = kit.Y, C = kit.C, lift = rd('geo.lift', 0.0018);
  const arms = armsOf(I.n, I.s, I.e, I.w, Y.HW);
  const run = (axis, a0, a1) => {
    for (const sg of [1, -1]) {
      kit.lane(bk.solid, axis, sg * g.lat, g.w, a0, a1, Y.DY, g.col);
      for (let a = a0; a < a1 - g.dash * 0.5; a += g.dash + g.dashGap)
        kit.lane(bk.solid, axis, sg * g.lineLat, g.lineW, a, Math.min(a1, a + g.dash), Y.DY + lift, C.MARK);
      for (let a = a0 + g.wandEvery / 2; a < a1; a += g.wandEvery) {
        const px = axis === 'z' ? sg * g.wandLat : a, pz = axis === 'z' ? a : sg * g.wandLat;
        kit.part(bk.solid, kit.box(g.wandW, g.wandH, g.wandW), px, Y.Y + g.wandH / 2, pz, g.wandCol);
      }
    }
  };
  for (const s of arms.z) run('z', s[0], s[1]);
  for (const s of arms.x) run('x', s[0], s[1]);
}

/* ══════════════════════════════════════════════════════════════════════════
   🌀 CURVE — the swept carriageway, and the answer to the diagonal staircase.

   THE PROBLEM IT SOLVES. Tiles are a fixed grid, so a diagonal road is a
   staircase of orthogonally-connected cells. The connectivity is already
   perfect — every tile in the staircase touches the next, so computeLinks,
   bfsPath and every agent walk it as one road. What is wrong is the READ: each
   cell squares off its corner, so a diagonal run looks like a flight of steps
   with a notch of pavement at every tread.

   THE FIX. On a bend, a curve tile lays the carriageway that a real road would
   have: an annulus centred on the corner the road turns around, inner radius
   0.5 − RD_HW and outer 0.5 + RD_HW — i.e. the same two lanes, swept. The
   outer half of that annulus lands on PAVEMENT, so paveOnly() lets it through;
   the inner quadrant becomes a kerbed corner island, which is what makes the
   turn read as a turn rather than as a wider square. Consecutive bends in a
   staircase share their arm openings at full carriageway width, so the swept
   ribbon is CONTINUOUS across the run with no tread and no notch.

   The three masks, all three drawn, because a drag will produce all three:
     bend (2 adjacent)    the sweep above
     junction (3 or 4)    rounded corner fillets instead of square corners
     straight / stub      corner easements — the widening a fast alignment gets
   ══════════════════════════════════════════════════════════════════════════ */
function curve(I, bk, kit, CT) {
  const g = rd('geo.curve', {}), Y = kit.Y, C = kit.C;
  const lift = rd('geo.lift', 0.0018), hi = rd('geo.liftHi', 0.0006);
  const rows = g.rows;
  const road = kit.tint(rd('geo.round.ringTint', 0.78));
  const pave = (bucket, top, col) => paveOnly(spanTo(kit, bucket, top, col), I.n, I.s, I.e, I.w, Y.HW);

  const bend = I.cnt === 2 && !((I.n && I.s) || (I.e && I.w));
  if (bend) {
    // The corner the road turns around: the tile corner between the two arms.
    const cx = I.e ? 0.5 : -0.5, cz = I.n ? -0.5 : 0.5;
    annulus(pave(bk.road, Y.PT + lift, road), cx, cz, g.rIn, g.rOut, rows);
    annulus(pave(bk.solid, Y.PT + lift + hi, C.KERB), cx, cz, g.rOut, g.rOut + g.kerbT, rows);
    // The inside of the turn becomes a kerbed island — this is the half that
    // makes it read as a curve rather than as a wider junction.
    annulus(spanTo(kit, bk.solid, Y.PT, C.KERB), cx, cz, g.rIn - g.kerbT, g.rIn, rows);
    disc(spanTo(kit, bk.pave, Y.PT, undefined), cx, cz, g.rIn - g.kerbT, rows);
    // A chevron board on the outside of the bend, where a driver would see it.
    const px = -cx * 0.40, pz = -cz * 0.40;
    kit.part(bk.solid, kit.box(g.chevT, g.chevY, g.chevT), px, Y.PT + g.chevY / 2, pz, C.DARK);
    kit.part(bk.solid, kit.box(g.chevW, g.chevH, g.chevT), px, Y.PT + g.chevY + g.chevH / 2, pz, g.chevCol);
    kit.part(bk.solid, kit.box(g.chevW * 0.62, g.chevH * 0.30, g.chevT * 0.5), px, Y.PT + g.chevY + g.chevH / 2, pz - g.chevT * 0.5, g.chevMark);
    foot(CT, px, pz, g.chevW / 2, g.chevT, g.chevY + g.chevH);
    return;
  }
  if (I.cnt >= 3) {
    // Rounded junction corners. A fillet only where two arms actually meet —
    // anywhere else the corner is already footway and rounding it would eat
    // pavement for no reason.
    const pairs = [[I.n, I.e, 0.5, -0.5], [I.s, I.e, 0.5, 0.5], [I.n, I.w, -0.5, -0.5], [I.s, I.w, -0.5, 0.5]];
    for (const [a, b, cx, cz] of pairs) {
      if (!a || !b) continue;
      disc(pave(bk.road, Y.PT + lift, road), cx, cz, g.fillet, rows);
      annulus(pave(bk.solid, Y.PT + lift + hi, C.KERB), cx, cz, g.fillet, g.fillet + g.kerbT, rows);
    }
    return;
  }
  // Straight or stub: ease every corner that is not a junction corner.
  for (const [cx, cz] of [[0.5, -0.5], [0.5, 0.5], [-0.5, -0.5], [-0.5, 0.5]]) {
    disc(pave(bk.road, Y.PT + lift, road), cx, cz, g.chamfer, rows);
    annulus(pave(bk.solid, Y.PT + lift + hi, C.KERB), cx, cz, g.chamfer, g.chamfer + g.kerbT, rows);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   🧱 ALLEY — setts, no markings.
   The setts go in at RD_DY, ABOVE the paint layer, which is the only way an
   additive recipe can take the white lines off a road: it does not remove
   them, it surfaces over them. That is also what a real alley is — an older
   surface the markings were never painted on.
   ══════════════════════════════════════════════════════════════════════════ */
function alley(I, bk, kit, CT) {
  const g = rd('geo.alley', {}), Y = kit.Y;
  const n = g.cells | 0, step = 1 / n, j = g.joint / 2;
  const rnd = kit.rng(I.tx, I.tz);
  for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) {
    const x0 = -0.5 + i * step + j, x1 = x0 + step - g.joint;
    const z0 = -0.5 + k * step + j, z1 = z0 + step - g.joint;
    // Two tones, chequered, with a seeded third of the setts swapped so the
    // pattern does not read as a chessboard from above.
    const alt = ((i + k) & 1) ? g.colB : g.colA;
    kit.slab(bk.solid, x0, x1, z0, z1, Y.DY, rnd() < 0.3 ? (alt === g.colA ? g.colB : g.colA) : alt);
  }
  // The central drainage channel, down whichever axis carries the traffic.
  const half = g.channel / 2;
  if (I.n || I.s) kit.slab(bk.solid, -half, half, -0.5, 0.5, Y.DY + rd('geo.liftHi', 0.0006), g.channelCol);
  if ((I.e || I.w) && !(I.n || I.s)) kit.slab(bk.solid, -0.5, 0.5, -half, half, Y.DY + rd('geo.liftHi', 0.0006), g.channelCol);
}

/* ── the dispatch ───────────────────────────────────────────────────────────
   `street` is deliberately absent from this table. It is the shipped recipe and
   contributes NOTHING, so a city of plain streets does exactly the work it did
   before this module existed: one property lookup that misses, and out. */
const RECIPES = { avenue, highway, bridge, roundabout, rbisle, culdesac, bikelane, curve, alley };

/* ⭐ THE HOOK node-city's makeRoad calls, once, immediately before its merge.
   Never throws: a class recipe that blows up costs the player its decoration
   and nothing else — the six buckets still merge and the tile is still a road.
   That is the same contract every guarded module seam in this project carries,
   and it matters more here than usual because this runs inside the mesh
   builder for every road tile in the city on every load. */
export function decorate(info, bk, kit, CT) {
  const fn = RECIPES[info && info.cls];
  if (!fn) return false;
  try { fn(info, bk, kit, CT); return true; }
  catch (e) { console.warn('[Roads] class recipe failed: ' + (info && info.cls), e); return false; }
}

export default { decorate };
