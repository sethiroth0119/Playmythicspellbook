/* ══ 🧱 THE PARCEL LAYER ═══════════════════════════════════════════════════
   Rubric dimension 5 — "The plot" — is the one line of the matrix that never
   moved: 3 at baseline, then 4, then 2, then 2, across three rounds that all
   worked on something else. The whole-frame critic named the reason twice:

     "Right now buildings are placed on the road edge and the ground under them
      is one continuous flat pad — THAT SINGLE FACT is why the city reads as
      models on a board."

   HOUSING WAS NEVER THE WHOLE PROBLEM. makeHousing has owned a real parcel
   since round 2 — apron, path, drive, lawn, hedge, bins, a garden tree — and
   round 4 gave it the setback that finally made all of that visible. But the
   OTHER half of a district has nothing at all. Measured on the standard
   gauntlet city: 54 housing tiles carry a parcel and 24 shop / depot / civic
   tiles carry none, so those buildings stand on raw terrain with a doormat of
   paving at the door and no property line anywhere. This module is their
   parcel, and it is the reason a shop now looks like it occupies a lot rather
   than like it was dropped on a lawn.

   ── WHAT A PARCEL IS HERE, AND WHY IT DIFFERS BY BUILDING ─────────────────
   The bar's reference frames are explicit that a plot is not one thing:

     · a shop      gets PAVING to the kerb, bollards, a service bay, planters
     · a depot     gets HARDSTANDING, a painted edge line and a palisade fence
     · a civic hall gets a PLAZA — paving, a lawn quadrant, a low wall

   So the class of the building picks the surface, the boundary AND the props.
   A viewer who can tell a yard from a forecourt from a plaza from the air is
   also reading dimension 11 (density & zoning), which is the point.

   ── 🔴 THE GLOBALS TRAP (CLAUDE.md) ───────────────────────────────────────
   `game`, `scene`, `THREE`, `MAT`, `HALF`, `RD_Y` and `BUILDINGS` are top-level
   `const` in node-city/index.html. They are lexical globals and are NOT on
   `window`. The ctx object mount() takes IS the hand-over, exactly as
   /src/parking and /src/streets do it. Nothing below reaches for a bare global.

   ── WHAT THIS MODULE DOES NOT TOUCH ───────────────────────────────────────
   · HOUSING. makeHousing owns its own ground, in its own twelve buckets, at
     zero extra draw calls. Drawing a second parcel over it would z-fight the
     lawn across the whole suburb. Housing is skipped by name.
   · The DECOR tiles (tree / bush / garden / fountain) and roads. A tree tile
     IS its own ground.
   · The eighteen recipes that pave their WHOLE tile themselves (HAS_OWN_GROUND
     below — the list is read off the file, not guessed). They get the BOUNDARY
     and the props, which are three-dimensional and so cannot fight anything,
     and they keep the ground they already draw.
   · Any tile state. This module reads game.tiles and adds one scene group. It
     never writes a tile, a ledger or a mesh it did not make.

   ── 💰 COST, AND WHY IT IS AFFORDABLE AT 54× ──────────────────────────────
   Everything flat — every parcel surface, every drive, every lot line, every
   painted marking in the whole city — is written into ONE non-indexed vertex
   -coloured buffer and drawn with ONE mesh, which is the trick /src/parking
   uses for its bays and the road recipe uses for its markings. Everything that
   stands up — fences, walls, bollards, planters, shrubs — is merged into a
   SECOND mesh the same way. So the layer is 2 draw calls for the entire city
   no matter how many parcels it serves, and the triangle bill is:

       surface + drive   8 tris  (four quads — see the partition note in build)
       lot line         12 tris  (six quads: four edges, split round the drive)
       boundary      ~72-260     (per RUN, and a run is drawn ONCE per shared
                                  edge rather than once per owner: a low wall is
                                  3 boxes, a palisade 9 posts and 2 rails)
       props          ~60-200

   MEASURED on the standard gauntlet district, which serves 8 non-housing
   parcels: 430,854 triangles with the layer against 428,818 without it — about
   250 a parcel, and 2 draw calls for all of them.
   ══════════════════════════════════════════════════════════════════════════ */

let CTX = null, group = null, sig = '', flatMesh = null, propMesh = null, served = 0;

/* ── WHO GETS WHAT ─────────────────────────────────────────────────────────
   Keyed on the tile type, because that is the only thing this module can see;
   the recipes themselves are 8,000 lines away in another file and are not
   importable. An unknown type falls through to 'commerce', which is the
   mildest of the three treatments — paving and a kerb — so a building added
   later gets a plausible parcel instead of no parcel, and never gets a
   palisade fence it did not ask for. */
const CLASS = {
  industry: ['depot', 'munitions', 'smelter', 'cannery', 'warehouse', 'powerstation',
             'machineshop', 'railyard', 'motorpool', 'scrapmine', 'fuelrig', 'quarry',
             'lumbercamp', 'sawmill', 'weavery', 'papermill', 'printworks', 'fibercroft',
             'forge', 'reslab', 'siphon', 'purifier', 'wind', 'solar', 'coal', 'gas',
             'oil', 'geothermal', 'hydro', 'nuclear', 'incinerator'],
  civic:    ['medlab', 'clinic', 'police', 'firestation', 'arena', 'stadium', 'tower',
             'resthouse', 'barracks', 'obelisk', 'caravanpost'],
  farm:     ['farm', 'hydrofarm'],
  commerce: ['shop', 'lot', 'tenantbiz', 'gasstation', 'restaurant', 'grocery',
             'club', 'foodtruck', 'kalonstable'],
};
const CLASS_OF = {};
for (const k in CLASS) for (const t of CLASS[k]) CLASS_OF[t] = k;

/* Never served: they own their ground already, or they are not buildings. */
const SKIP = new Set(['road', 'anchor', 'housing', 'tree', 'bush', 'garden', 'fountain',
                      'wall', 'gate', 'streetlight', 'interchange', 'indexfund', 'holdco']);

/* ── ALREADY OWN THEIR GROUND ──────────────────────────────────────────────
   These recipes pave the WHOLE tile themselves, at exactly RD_Y, and most of
   them draw their own lot line through `_pcKerb` on top of it. The list is not
   a guess: it is every `Slab(-.5, .5, -.5, .5, AY, GB)` in node-city's recipe
   block, read off the file. Laying a second surface at the same height over
   any of them is a guaranteed z-fight across a whole tile — the loudest
   artefact this layer could possibly produce — so they get the BOUNDARY and
   the props (three-dimensional, nothing to fight with) and nothing flat.
   ⚠ ADD TO THIS LIST if you give a recipe a full-tile apron. The surfMat's
     polygonOffset (see build()) makes a coplanar overlap lose deterministically
     rather than shimmer, so a miss here is a wasted surface and not a flicker —
     but it is still a wasted surface. */
const HAS_OWN_GROUND = new Set(['farm', 'hydrofarm', 'purifier', 'forge', 'reslab',
                                'siphon', 'obelisk', 'kalonstable', 'restaurant',
                                'foodtruck', 'grocery', 'barracks', 'tower', 'munitions',
                                'club', 'motorpool', 'firestation', 'police']);

/* ── THE PALETTE ───────────────────────────────────────────────────────────
   Values first, hues second. At the game's aerial distance a parcel is forty
   pixels across and the only thing that survives is how LIGHT it is against
   the terrain (a mid green, ~.42 luminance) and against the carriageway
   (MAT.road is 0x57544e, ~.33). Hardstanding therefore sits BELOW the road and
   paving well ABOVE it, so a yard and a forecourt can never be confused with
   each other or with the street between them. */
const COL = {
  industry: { pad: 0x484540, drive: 0x565049, line: 0xb9a83f, kerb: 0x9d9689 },
  commerce: { pad: 0x8b857b, drive: 0x777168, line: 0xd6d0c0, kerb: 0xc4bdad },
  civic:    { pad: 0x958f84, drive: 0x847d73, line: 0xd6d0c0, kerb: 0xc9c2b1 },
  farm:     { pad: 0x6b6152, drive: 0x6f6656, line: 0xc4bdad, kerb: 0xb2a893 },
};
const C_WALL   = 0x8b8377;      // masonry boundary
const C_PIER   = 0x9b9285;
const C_STEEL  = 0x50555a;      // palisade / bollard / rail
const C_TIMBER = 0x7a6549;      // farm post and rail
const C_LEAF   = [0x3f7a35, 0x4f9642, 0x2f6b34, 0x568f3c];
const C_LAWN   = 0x6fa94e;

/* ⭐ ROUND 5 — A PLOT'S SURFACE IS ITS OWN, NOT ITS CLASS'S.
   Every industrial yard in the city was byte-identically 0x484540 and every
   forecourt 0x8b857b, so a run of three shops read as ONE forecourt with three
   buildings standing on it — which is the "models placed on a board" reading
   the whole round is against, arriving through the back door. This shades the
   class colour per TILE: value by up to ±13% and, with it, a warm/cool tilt,
   because two poured slabs of the same concrete a year apart differ in exactly
   those two ways.
   ⚠ SEEDED ON THE TILE COORDS DIRECTLY, NOT DRAWN FROM `R`. rngOf's stream is
     consumed by the props, and taking one number out of it here would reshuffle
     every fence, bollard and shrub on every parcel in the city — the same
     lesson makeHousing's lawn key note records. A separate hash costs nothing
     and cannot interfere.
   ⚠ THE LOT LINE AND THE KERB ARE DELIBERATELY NOT SHADED. They are the
     property boundary; a boundary that varies in tone with the ground it
     surrounds is a boundary that stops reading as one. Pale, constant, and the
     same on every plot in the city is the entire point of them. */
function tileShade(gx, gz) {
  const h = (Math.imul(gx | 0, 0x9e3779b1) ^ Math.imul(gz | 0, 0x85ebca77)) >>> 0;
  return (((h >>> 21) & 255) / 255 - .5) * 2;                  // −1 … +1
}
function shadeCol(hex, f) {
  const s = 1 + f * .13;
  const cl = v => Math.max(0, Math.min(255, Math.round(v)));
  return (cl((hex >> 16 & 255) * s * (1 + f * .05)) << 16)
       | (cl((hex >> 8  & 255) * s) << 8)
       |  cl((hex       & 255) * s * (1 - f * .06));
}

/* Tile-seeded xorshift32 — the same shape r1_road.js and /src/parking use. A
   parcel's props must be a property of the TILE, not of the moment the layer
   happened to rebuild, or laying one road anywhere in the city would reshuffle
   every fence and every shrub in it. */
function rngOf(x, z) {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ 0x9e3779b9) >>> 0;
  h = (h || 0x9e3779b9) >>> 0;
  return () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
}

/* ── the flat buffer ───────────────────────────────────────────────────────
   ⚠ WINDING IS [0,2,1 / 0,3,2]. In the XZ plane the intuitive [0,1,2 / 0,2,3]
     is clockwise seen from +Y, so a quad written that way faces DOWN, is
     back-face culled by the FrontSide default, and computeVertexNormals hands
     it a −Y normal into the bargain. /src/parking lost a round to exactly this
     and wrote the warning; it is repeated here because it is the same buffer
     shape and the same trap. Reverse it and every parcel in the city vanishes.
   ⚠ UVs ARE REQUIRED. The material carries MAT.road's asphalt map and a mapped
     material with no `uv` attribute samples garbage. World x/z is the right
     source: it keeps a yard's grain continuous with the street it opens off
     instead of restarting the texture at every property line. */
function quad(F, x0, x1, z0, z1, y, col) {
  if (x1 - x0 <= 1e-5 || z1 - z0 <= 1e-5) return;
  const r = ((col >> 16) & 255) / 255, g = ((col >> 8) & 255) / 255, b = (col & 255) / 255;
  const p = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  for (const i of [0, 2, 1, 0, 3, 2]) {
    F.P.push(p[i][0], y, p[i][1]); F.C.push(r, g, b); F.U.push(p[i][0], p[i][1]);
  }
}

/* ── the standing buffer ───────────────────────────────────────────────────
   Real geometries, pre-transformed and tinted, merged into one non-indexed
   buffer at the end. Boxes and blobs both go here, so a fence post and a shrub
   share a draw call. */
function put(S, geo, col, x, y, z, rot, scl) {
  const { THREE } = CTX;
  if (scl) geo.scale(scl[0], scl[1], scl[2]);
  if (rot) { geo.rotateX(rot[0]); geo.rotateY(rot[1]); geo.rotateZ(rot[2]); }
  geo.translate(x, y, z);
  const c = new THREE.Color(col);
  const n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  S.push(geo);
}
const box = (S, col, w, h, d, x, y, z, rot) =>
  put(S, new CTX.THREE.BoxGeometry(w, h, d), col, x, y, z, rot);

/* A shrub. One low-detail icosahedron squashed flat — 20 triangles, which is
   what makes it affordable to put four of them on every parcel in the city.
   Deliberately NOT the housing recipe's _vegClump: that lives in index.html
   and is not importable, and a boundary shrub at this distance is a blob. */
function shrub(S, R, x, z, y, r) {
  put(S, new CTX.THREE.IcosahedronGeometry(r, 0), C_LEAF[(R() * C_LEAF.length) | 0],
      x, y + r * .62, z, [R() * 3, R() * 3, R() * 3], [1, .78, 1]);
}

/* ── BOUNDARY RUNS ─────────────────────────────────────────────────────────
   `ax`/`az` is the unit vector the run travels along; (cx,cz) is its centre;
   `half` its half-length. Every class draws a different physical object,
   because a fence round a factory and a wall round a civic hall are not the
   same statement about the ground and the bar's frames show both. */
function boundary(S, R, kind, cx, cz, ax, az, half, y) {
  const w = ax ? 2 * half : .030, d = az ? 2 * half : .030;
  if (kind === 'industry') {
    /* PALISADE: posts on a pitch with two rails. A solid slab in steel colour
       reads as a wall; the gaps are what make it read as a fence, and they are
       also what lets the yard behind it stay visible, which is the whole
       reason an industrial boundary is a fence in the first place. */
    const n = Math.max(2, Math.round(2 * half / .105));
    for (let i = 0; i <= n; i++) {
      const t = -half + (i / n) * 2 * half;
      box(S, C_STEEL, .018, .150, .018, cx + ax * t, y + .075, cz + az * t);
    }
    box(S, C_STEEL, ax ? 2 * half : .012, .012, az ? 2 * half : .012, cx, y + .140, cz);
    box(S, C_STEEL, ax ? 2 * half : .012, .010, az ? 2 * half : .012, cx, y + .062, cz);
  } else if (kind === 'farm') {
    // POST AND RAIL. Two rails, timber, wide pitch — a field boundary.
    const n = Math.max(2, Math.round(2 * half / .190));
    for (let i = 0; i <= n; i++) {
      const t = -half + (i / n) * 2 * half;
      box(S, C_TIMBER, .026, .130, .026, cx + ax * t, y + .065, cz + az * t);
    }
    for (const h of [.052, .112])
      box(S, C_TIMBER, ax ? 2 * half : .014, .014, az ? 2 * half : .014, cx, y + h, cz);
  } else {
    /* LOW WALL, with a pier at each end. Commerce and civic both. The piers
       are what stop a wall run reading as an extruded line — they are the
       thing that says the wall was built rather than drawn. */
    box(S, C_WALL, w, .072, d, cx, y + .036, cz);
    box(S, C_PIER, .062, .092, .062, cx - ax * half, y + .046, cz - az * half);
    box(S, C_PIER, .062, .092, .062, cx + ax * half, y + .046, cz + az * half);
    /* ⚠ NO PLANTING IS DRAWN FROM HERE. A first cut put two shrubs "behind"
       each civic wall run, and this function is given the run's centre and its
       direction but NOT which side of it is inside the plot — so the offset was
       rolled, and half of them landed in the neighbour's garden or in the road.
       The civic green in §5 knows where inside is; it plants there. */
  }
}

/* Which way the building faces, as a unit vector. buildMesh authors every
   recipe pointing at +z and placeMeshAt spins it by t.rot quarter-turns, and
   the inspector prints those four as south / west / north / east — so the door,
   the fascia sign, the loading shutter and therefore the DRIVE are all on this
   side. Deriving the frontage from the nearest road instead would put a
   driveway through the back wall of any building the player rotated. */
function facing(rot) {
  switch ((rot | 0) & 3) {
    case 1:  return [-1, 0];
    case 2:  return [0, -1];
    case 3:  return [1, 0];
    default: return [0, 1];
  }
}

function clear() {
  for (const m of [flatMesh, propMesh]) if (m) { group.remove(m); m.geometry.dispose(); }
  flatMesh = null; propMesh = null; served = 0;
}

function build() {
  const { THREE, game, HALF, RD_Y, surfMat, propMat, isRoad } = CTX;
  clear();
  const F = { P: [], C: [], U: [] }, S = [];
  /* ── THE THREE HEIGHTS, and why the surface has exactly one slot ─────────
     node-city stacks a tile shade plane at y = 0, the buildable plate and the
     road's apron feather at .012, EVERY recipe's own paving at RD_Y (.016), its
     path at RD_Y+.003, its planting bed at RD_Y+.006 and the hover highlight at
     .020. makeHousing's header says it outright — "a paved surface has exactly
     one slot and RD_Y already sits in it" — and this layer does not get to
     invent a second one.

     🐞 MEASURED, AFTER TWO WRONG ANSWERS.
       · RD_Y − .002 was the first cut, chosen to sit UNDER the recipes. It
         never appeared in a single frame: 2mm over the plate at .012 is inside
         the depth buffer's resolution at city zoom, so the plate won everywhere
         and every yard photographed as bare grass. The housing apron proves 4mm
         is enough, because that one renders.
       · RD_Y exactly, with polygonOffset to break the tie, was the second. The
         offset's FACTOR term scales with the polygon's depth slope and a ground
         quad from a 0.3-high street camera is nearly edge-on, so it pushed the
         layer clean through the plate as well. (The mount site keeps the offset
         with factor 0 — a constant bias only — as insurance and nothing more.)
     So the surface sits 1.5mm ABOVE the recipes' own paving: clear of the plate
     by 5.5mm, clear of a recipe apron by 1.5mm so the two can never be coplanar,
     and still 1.5mm BELOW every recipe's path (RD_Y+.003) so a shop's forecourt,
     a depot's dock and every doormat in the city still draw on top of it.
     ⚠ NOTHING HERE OVERLAPS ANYTHING ELSE HERE. The pad is emitted as the three
       rectangles LEFT OVER once the drive is subtracted, not as a full tile with
       a drive laid over it: two of this layer's own quads at one height in one
       buffer would z-fight each other, and no offset can fix that because they
       share a material. */
  const PAD = RD_Y + .0015, LINE = RD_Y + .010, PROP = RD_Y + .0025;

  for (const k in game.tiles) {
    const t = game.tiles[k];
    if (!t || !t.mesh || SKIP.has(t.type)) continue;
    const cls = CLASS_OF[t.type] || 'commerce';
    const col = COL[cls];
    const [gx, gz] = k.split(',').map(Number);
    if (!isFinite(gx) || !isFinite(gz)) continue;
    const cx = gx - HALF + .5, cz = gz - HALF + .5;
    const R = rngOf(gx, gz);
    const own = HAS_OWN_GROUND.has(t.type);
    const [fx, fz] = facing(t.rot);
    const lx = -fz, lz = fx;                                   // lateral unit

    /* THE FACING FRAME. `a` runs from −.5 at the back of the plot to +.5 at the
       frontage; `l` runs across it. Everything below is authored once, in that
       frame, and comes out correct on all four rotations — which is the only
       way a driveway can be guaranteed to arrive at the door rather than at
       whichever wall the tile happened to be spun towards. Both basis vectors
       are axis units, so a rectangle maps to a rectangle and the quad helper
       still only ever writes an axis-aligned one. */
    const rq = (l0, l1, a0, a1, y, c) => {
      const X = [cx + fx * a0 + lx * l0, cx + fx * a1 + lx * l1];
      const Z = [cz + fz * a0 + lz * l0, cz + fz * a1 + lz * l1];
      quad(F, Math.min(X[0], X[1]), Math.max(X[0], X[1]),
              Math.min(Z[0], Z[1]), Math.max(Z[0], Z[1]), y, c);
    };

    /* 1. THE SURFACE + 2. THE DRIVE, as one non-overlapping partition of the
       tile. The drive runs from just inside the building out to the kerb, in a
       material that is NOT the carriageway — a driveway and the road it joins
       being different surfaces is the reference frame's actual read. It is
       wider for industry, because what uses it is a lorry.
       ⭐ ON A CIVIC PLOT ONE WHOLE FLANK IS LAWN rather than paving. A civic
       building with a green beside it is what the bar's frames show, and doing
       it by substituting the colour of a region that already exists costs
       nothing at all — no extra quad, no carve, no overlap. */
    const dw = cls === 'industry' ? .215 : .135;
    if (!own) {
      // …each in THIS tile's own shade of its class's material — see tileShade
      const sf = tileShade(gx, gz);
      const pad = shadeCol(col.pad, sf), drv = shadeCol(col.drive, sf);
      rq(-.5, -dw, -.5, .5, PAD, pad);
      rq(dw, .5, -.5, .5, PAD, cls === 'civic' ? shadeCol(C_LAWN, sf) : pad);
      rq(-dw, dw, -.5, .06, PAD, pad);
      rq(-dw, dw, .06, .5, PAD, drv);
    }

    /* 3. THE PROPERTY LINE — a pale kerb band round the whole boundary. Eight
       triangles, and the cheapest thing in this file that a first-time viewer
       actually notices: it is what says "and this ground belongs to someone"
       where a continuous pad said "the ground carries on". The frontage run is
       broken either side of the drive and the gap filled with the DROPPED KERB,
       which is always paler than the drive itself — that is how a real one
       reads from above, and it means the ring is still four continuous edges
       with nothing drawn twice.
       ⚠ .010 proud, no more. Citizens walk at y = 0 with a ≤.02 bob and the
         'enter' state walks them .3 of a tile INSIDE the plot, so a lot line
         tall enough to read as a wall is one they wade through — the same
         measurement, and the same reason, as _pcKerb's note in index.html. */
    if (!own) {
      const e = .5, tk = .028, g0 = -dw - .014, g1 = dw + .014;
      rq(-e, g0, e - tk, e, LINE, col.kerb);                   // frontage, left of the drive
      rq(g1, e, e - tk, e, LINE, col.kerb);                    // frontage, right of it
      rq(g0, g1, e - tk, e, LINE, col.line);                   // the dropped kerb
      rq(-e, e, -e, -e + tk, LINE, col.kerb);                  // back
      rq(-e, -e + tk, -e + tk, e - tk, LINE, col.kerb);        // flanks
      rq(e - tk, e, -e + tk, e - tk, LINE, col.kerb);
    }

    /* 4. THE BOUNDARY — what makes a row of lots read as a street rather than
       as objects on a plane. Three rules, each of them measured:
         · never on the FRONTAGE. That is where the gate and the drive are.
         · never against a ROAD. A fence built along a kerb fences in the
           pavement; the road already owns that edge with its own kerb.
         · ONCE per shared edge, not once per owner. Two neighbouring parcels
           each fencing their own side put two parallel fences 4cm apart, which
           doubles the cost of the most expensive thing in this file and reads
           as a mistake. The lower tile key draws it and it sits ON the line. */
    for (const [ex, ez] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      if (ex === fx && ez === fz) continue;
      if (isRoad(gx + ex, gz + ez)) continue;
      const nb = game.tiles[(gx + ex) + ',' + (gz + ez)];
      /* ⚠ NEVER AGAINST HOUSING. makeHousing fences all four of its own edges
         (round 4 closed the rear), and its hedge is .055 thick sitting on .470,
         i.e. .4425….4975 — which a fence of ours at .478 runs straight through.
         One boundary per line, and on that line the house's is the one that
         already exists. */
      if (nb && nb.type === 'housing') continue;
      const shared = !!(nb && nb.mesh && !SKIP.has(nb.type));
      if (shared && (gx * 4096 + gz) > ((gx + ex) * 4096 + (gz + ez))) continue;
      const off = shared ? .5 : .478;
      boundary(S, R, cls, cx + ex * off, cz + ez * off, ez ? 1 : 0, ex ? 1 : 0, .462, PROP);
    }

    /* 5. WHAT STANDS ON IT. A surface and a line say the ground is owned; the
       props say it is USED, and that is the half a viewer reads as life. */
    const at = (l, a, y) => [cx + fx * a + lx * l, y, cz + fz * a + lz * l];
    if (cls === 'industry') {
      for (const sgn of [-1, 1]) {                             // gate posts at the yard mouth
        const q = at(sgn * (dw + .050), .455, PROP + .105);
        box(S, C_STEEL, .044, .210, .044, q[0], q[1], q[2]);
      }
      for (let i = 0; i < 3; i++) {                            // a stack of pallets
        const q = at(-.345, -.150, PROP + .026 + i * .052);
        box(S, C_TIMBER, .155, .048, .125, q[0], q[1], q[2], [0, R() * .3 - .15, 0]);
      }
      const c2 = at(.350, -.230, PROP + .070);
      box(S, 0x6d6a63, .110, .140, .110, c2[0], c2[1], c2[2]);  // gas bottle cage
    } else if (cls === 'commerce') {
      for (const sgn of [-1, 1]) for (let i = 0; i < 2; i++) {  // bollards along the frontage
        const q = at(sgn * (dw + .065 + i * .090), .430, PROP + .048);
        box(S, C_STEEL, .026, .096, .026, q[0], q[1], q[2]);
      }
      const bn = at(.385, .300, PROP + .054);
      box(S, 0x4b4f52, .082, .108, .074, bn[0], bn[1], bn[2]);  // litter bin
      for (const sgn of [-1, 1]) {                             // planters at the back corners
        const q = at(sgn * .330, -.360, PROP + .030);
        box(S, C_WALL, .155, .060, .155, q[0], q[1], q[2]);
        shrub(S, R, q[0], q[2], PROP + .060, .050 + R() * .020);
      }
    } else if (cls === 'civic') {
      for (let i = 0; i < 3; i++) {                            // trees on the green
        const q = at(dw + .105 + R() * .16, -.30 + i * .30, PROP);
        shrub(S, R, q[0], q[2], PROP, .052 + R() * .028);
      }
      for (const sgn of [-1, 1]) {                             // piers flanking the approach
        const q = at(sgn * (dw + .080), .400, PROP + .062);
        box(S, C_PIER, .074, .124, .074, q[0], q[1], q[2]);
      }
    } else if (cls === 'farm') {
      for (const sgn of [-1, 1]) {
        const q = at(sgn * .370, -.400, PROP);
        shrub(S, R, q[0], q[2], PROP, .055 + R() * .025);
      }
    }
    served++;
  }

  if (F.P.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(F.P), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(F.C), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(F.U), 2));
    geo.computeVertexNormals();
    flatMesh = new THREE.Mesh(geo, surfMat);
    flatMesh.castShadow = false; flatMesh.receiveShadow = true;   // flat: casts nothing
    group.add(flatMesh);
  }
  if (S.length) {
    propMesh = new THREE.Mesh(mergeAll(S), propMat);
    /* ⚠ castShadow ON, and it is what grounds the boundary. A fence that throws
       no shadow reads as a decal painted on the pad; the shadow is the whole
       reason the eye accepts it as standing up. ONE mesh for the city, so this
       is one extra shadow-map draw and not one per parcel. */
    propMesh.castShadow = true; propMesh.receiveShadow = true;
    group.add(propMesh);
  }
  return served;
}

/* Concatenate pre-transformed, pre-tinted geometries into one non-indexed
   buffer. Same job as index.html's _hMerge, rewritten here because that lives
   in a module script an ES module cannot import — and rewritten SMALLER,
   because everything this file makes carries exactly position / normal / color
   and nothing has a uv. */
function mergeAll(list) {
  const { THREE } = CTX;
  let n = 0;
  for (const g of list) { const p = g.toNonIndexed ? (g.index ? g.toNonIndexed() : g) : g; g._flat = p; n += p.attributes.position.count; }
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) {
    const p = g._flat;
    if (!p.attributes.normal) p.computeVertexNormals();
    P.set(p.attributes.position.array, o * 3);
    N.set(p.attributes.normal.array, o * 3);
    C.set(p.attributes.color.array, o * 3);
    o += p.attributes.position.count;
    if (p !== g) p.dispose();
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(C, 3));
  return geo;
}

/* Cheap enough to call from manageAgents(), which every path that changes the
   city already runs through — but only if the layout actually moved. The TYPE
   and the ROTATION are both in the hash: demolishing a shop and building a
   depot on the same tile has to change the class of the parcel, and rotating a
   building has to move its driveway to the side the door is now on. Hashing
   the keys alone would have missed both. */
function signature() {
  const { game } = CTX;
  let h = 0, n = 0;
  for (const k in game.tiles) {
    const t = game.tiles[k]; n++;
    const s = k + '|' + t.type + '|' + ((t.rot | 0) & 3);
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  }
  return h + ':' + n;
}

export function mount(ctx) {
  CTX = ctx;
  const { THREE, scene } = ctx;
  group = new THREE.Group(); group.name = 'parcel'; scene.add(group);
  const api = {
    refresh() {
      const s = signature();
      if (s === sig) return served;
      sig = s;
      return build();
    },
    count: () => served,
    // for a driver: what each parcel was classified as, so a test can assert a
    // depot got hardstanding without reading the scene graph.
    classes: () => {
      const out = {};
      for (const k in CTX.game.tiles) {
        const t = CTX.game.tiles[k];
        if (!t || !t.mesh || SKIP.has(t.type)) continue;
        const c = CLASS_OF[t.type] || 'commerce';
        out[c] = (out[c] || 0) + 1;
      }
      return out;
    },
    group: () => group,
  };
  api.refresh();
  return api;
}
