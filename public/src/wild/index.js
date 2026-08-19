/* ══ 🌾 THE WILD GROUND ════════════════════════════════════════════════════
   Rubric dimensions 5 (The plot) and 10 (Vegetation) have both sat at 5.0 for
   nine rounds while every other line of the matrix moved, and the round-9
   aerial says why in one sentence: the buildings and the road network read
   well, and they sit in an unbroken flat plane. Between two roads there is
   NOTHING. No tone change, no dirt, no scrub, no rock, no wear.

   ── WHY THIS IS NOT ANOTHER MATERIAL PASS, WHICH IS THE OBVIOUS ANSWER ────
   The obvious answer is wrong here, and it is wrong for a measured reason.
   The ground is ALREADY a rich material. Round 5 gave the plate two four-stop
   ramps blended by an independent moisture field (value spread 0.133 -> 0.283,
   hue spread 8 deg -> 40 deg), a 256px seamless grain canvas at a 3.71-tile
   period, and ±9mm of relief. Round 7 published that field so patches could
   receive it. Both rounds shipped, both are in the frame today, and the plot
   and vegetation scores did not move at all.

   MEASURED on the round-9 baseline (.gauntlet/shots/r9scale, hour pinned
   15:00), on a 420x240 crop of the empty block in the district frame:

       mean value 0.509    whole-crop sd 0.129    LOCAL contrast 0.043

   …and the eye agrees with the number: the mottle is there, it is just that
   mottle on a plane is a plane with mottle on it. A THIRD material pass buys a
   fourth decimal place on a statistic that is already fine.

   WHAT IS ACTUALLY MISSING IS THE THIRD DIMENSION. At 15:00 there is one
   strong key light in this scene, and flat ground under a key light has
   exactly one shading value however it is coloured. Every other surface in the
   frame that reads as real reads that way because something STANDS on it and
   drops a shadow across it — that is the whole argument /src/crowd made for
   the pavement and /src/parcel made for the forecourt. So this layer is a
   SCATTER, not a texture: tufts, scrub, rock and the odd sapling on the land
   nobody has built on, plus the two flat things a scatter cannot do (bare
   earth where the scrub thins out, and wear where grass meets a kerb).

   ── ⭐ CLUMPING IS THE WHOLE DESIGN, AND IT IS THE THING THAT COULD FAIL ──
   A uniform sprinkle of bushes over 400 tiles does not make ground read as
   terrain. It makes it read as ground with bushes sprinkled on it — busier,
   not better — and it would ALSO destroy the one thing the plate does well,
   because an even scatter reads as one texture and flattens the tonal drift
   underneath it. Real land is patchy: thickets, then bald dusty ground, then
   thickets. So the density is driven by the plate's OWN moisture and height
   field, read through NC_TERRAIN_AT rather than re-derived, plus one
   independent clump octave. Damp hollows get thicket; dry ridges get bare
   earth and stones. The scatter and the colour field therefore say the same
   thing about the same square metre, which is the difference between "terrain"
   and "decorated".

   ── 🔴 THE GLOBALS TRAP (CLAUDE.md) ───────────────────────────────────────
   `game`, `scene`, `THREE`, `GRID`, `HALF`, `isRoad`, `NAT_GROUND`,
   `NAT_PAINT`, `_VG_TEXDIV`, `NC_GRAIN_PER`, `NC_GROUND_AT` and
   `NC_TERRAIN_AT` are all top-level bindings in node-city/index.html and are
   NOT on `window`. The ctx object mount() takes IS the hand-over, exactly as
   /src/parcel and /src/crowd do it. Nothing below reaches for a bare global.

   ── WHAT THIS MODULE MUST NOT TOUCH, AND WHY EACH ONE IS LISTED ───────────
   · ANY TILE THAT EXISTS. `game.tiles[k]` is only written for something that
     was placed — a building, a road, a decor tile, an anchor, a scaffold site.
     If the key is there, the tile is somebody's and this layer stays off it.
     That single test is what keeps it clear of makeHousing's twelve buckets,
     of /src/parcel's forecourts and of every recipe's own apron: it never
     draws on a built tile at all, so the second-ground-pass failure
     /src/parcel's header calls out cannot happen here.
   · THE TILE LINE OF A BUILT NEIGHBOUR. makeHousing fences at .478 from its
     own centre and /src/parcel's unshared boundary sits at .478 too, so an
     object at the edge of an EMPTY tile can still collide with a fence in the
     tile next door. Candidates are rejected within CLR_BUILT of an occupied
     tile — and only 0.05 from a road, because a road tile's footway ends at
     its own tile line and grass is supposed to come right up to the kerb.
     ⚠ AND THE REJECTION IS PER CANDIDATE, NOT A PER-TILE MARGIN. A first cut
       jittered inside ±.42 of each tile centre, which is cheaper and produces
       a 160mm bare gutter along EVERY tile line in the city — i.e. it draws
       the graph paper this whole line of work has spent three rounds erasing.
   · TILE PICKING. tileFromEvent intersects a mathematical plane at y = 0, not
     any mesh, so nothing here can move a click. Nothing here writes a tile, a
     ledger, a save field or a mesh it did not make.

   ── 💰 COST ───────────────────────────────────────────────────────────────
   TWO MESHES for the whole city, at any city size: one merged vertex-coloured
   buffer for everything flat and one for everything standing, which is the
   trick /src/parcel and /src/parking both use. Both ride materials index.html
   ALREADY has (NAT_GROUND, NAT_PAINT), so this adds no material and no
   texture either.
   Measured on the standard gauntlet district, as an A/B inside ONE boot
   (.gauntlet/wildcost.mjs toggles this group's `visible` and reads
   renderer.info twice, because the whole-scene mesh count moves by ±15 between
   boots and a cross-boot delta of "+2 meshes" is inside the instrument's own
   noise): see the round report for the numbers.

   ⚠ THE GEOMETRY IS STAMPED, NOT ALLOCATED. /src/parcel builds a THREE
     geometry per prop and merges at the end, which is fine for the 8 parcels
     it serves and is not fine for 400 tiles: that would be ~2,800 geometry
     allocations and 2,800 disposes on EVERY rebuild, and refresh() runs from
     manageAgents(), i.e. every time the player lays one road. Each shape here
     is authored once at module load into a plain Float32Array and then STAMPED
     — transformed straight into the output arrays — so a rebuild is arithmetic
     with no allocation per object and no merge pass at all.
   ══════════════════════════════════════════════════════════════════════════ */

let CTX = null, group = null, sig = '', flatMesh = null, standMesh = null;
let stats = { tiles: 0, objects: 0, tris: 0, flatTris: 0, standTris: 0, patches: 0, wear: 0 };

/* ── CLEARANCES ───────────────────────────────────────────────────────────
   Both are measured against what is actually drawn in the neighbouring tile,
   not chosen. See the "what this must not touch" note above. */
const CLR_BUILT = 0.13;   // a hedge/fence/pier at .478 + its own thickness
/* 🐞 CLR_ROAD WAS 0.05, ON THE BELIEF THAT A ROAD TILE'S FOOTWAY ENDS AT ITS
   OWN TILE LINE AND GRASS THEREFORE MEETS THE KERB. IT DOES NOT. r1_road.js's
   APRON GEOMETRY block states the contract, measured as distance PAST the road
   tile's edge INTO the neighbouring plot:

       0.000 -> 0.110   paving,  top y = RD_PT (0.046)
       0.110 -> 0.150   feather, top y = 0.012
       beyond 0.150     the neighbour's own ground

   So a road owns the first 150mm of THIS tile, and 110mm of that is solid
   paving standing 46mm proud. At 0.05 the first cut was standing tufts inside
   that paving and drawing its kerb wear 40mm UNDERNEATH it — which is exactly
   what the harness photographed: 654 wear bands built, drawn, and not one
   pixel of any of them in the frame, with the grass/pavement line as razor
   straight as it was at baseline. The apron edge is the real boundary, and it
   is handed over as ctx.roadApron rather than typed here so that it stays the
   same number as the road's. */
const CLR_ROAD  = 0.17;   // = RD_AP (.150) + a little; see above

/* ── HOW MUCH LAND ONE CITY MAY CARRY ─────────────────────────────────────
   The standard district leaves ~404 of its 576 tiles unbuilt. A brand-new map
   leaves all 576, and a scatter that scales linearly with emptiness would make
   the EMPTIEST city — the one a new player opens on — the most expensive one
   to render, which is exactly backwards. Density is scaled by
   TARGET_TILES / servedTiles when there are more than TARGET_TILES of them.
   ⚠ SCALED, NOT TRUNCATED. /src/crowd's header records what truncating a
     sorted candidate list does: it spends the whole budget on the low-x corner
     of the map and leaves the other side bare. Scaling thins evenly. */
const TARGET_TILES = 430;

/* ── THE PALETTES ─────────────────────────────────────────────────────────
   Authored in sRGB and read through THREE.Color, which converts sRGB -> linear
   for us. 🔴 A LITERAL {r,g,b} WOULD NOT BE CONVERTED and would render pale —
   the trap .gauntlet/README.md records as having cost a whole round.
   Every one of these is then LERPED TOWARD THE GROUND TONE UNDER IT (see
   BLEND): a tuft on a bleached ridge has to be strawy and the same tuft in a
   damp hollow has to be green, or the vegetation reads as a decal set that was
   pasted on rather than as something that grew where it is. */
const C_TUFT_WET = [0x5c7a36, 0x678437, 0x4f6b30, 0x738c42];
const C_TUFT_DRY = [0x8a8752, 0x94905c, 0x7c7a48, 0x9d9764];
const C_SCRUB    = [0x47632f, 0x3f5a2c, 0x546f36, 0x3a5430];
const C_SCRUB_DRY= [0x77784a, 0x6b6c42, 0x848256, 0x5f6339];
const C_ROCK     = [0x8b8577, 0x9a9486, 0x7a7468, 0xa39c8c];
const C_BARK     = [0x6b5940, 0x5a4a35, 0x746145];
const C_CROWN    = [0x3f6a34, 0x497a3a, 0x38602f];
const C_DUST     = 0xa39264;   // bare earth, the pale end
const C_SOIL     = 0x7d6a4a;   // trodden earth, the dark end
const C_DAMP     = 0x5d7742;   // the other end of the stain: rank, watered grass
/* How far each of the above is pulled toward the plate's own tone underneath.
   0 = the palette hex verbatim (a decal); 1 = invisible. 0.34 keeps a bush
   plainly a bush while letting the ground's dry/damp drift run through it. */
const BLEND = 0.34;

/* ── the two output buffers ───────────────────────────────────────────────
   Plain arrays, pushed into and then handed to one BufferAttribute each. The
   flat one carries uv because NAT_GROUND is MAPPED (it wears the plate's own
   grain canvas); the standing one does not, because NAT_PAINT has no map. */
function newFlat()  { return { P: [], C: [], U: [], n: 0 }; }
function newStand() { return { P: [], N: [], C: [], n: 0 }; }

/* ── PROTOTYPES ───────────────────────────────────────────────────────────
   Built ONCE at first mount, into flat arrays. See the cost note in the header
   for why this is not a THREE geometry per object.
   ⚠ EVERY ONE IS AUTHORED AT UNIT SIZE, ORIGIN AT ITS FOOT, so a stamp is
     scale-rotate-translate with no per-shape fudge and a blob half-buried in
     the ground is a decision the caller makes rather than an accident. */
let PROTO = null;
function protos(THREE) {
  if (PROTO) return PROTO;
  const grab = (geo, lift) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.normal) g.computeVertexNormals();
    const P = Float32Array.from(g.attributes.position.array);
    const N = Float32Array.from(g.attributes.normal.array);
    for (let i = 1; i < P.length; i += 3) P[i] += lift;   // foot to origin
    if (g !== geo) g.dispose();
    geo.dispose();
    return { P, N, tris: P.length / 9 };
  };
  PROTO = {
    /* 🐞 THERE USED TO BE A CONE HERE AND IT WAS THE ROUND'S ONE REAL MISTAKE.
       A tuft of grass was a four-sided open cone: 4 triangles against the
       blob's 20, and the argument was that at 8 px all that survives is a
       small vertical dark mark. IT IS NOT WHAT SURVIVES. Photographed on the
       district framing, a four-sided cone reads as a four-sided cone — a hard
       geometric spike with two flat lit faces, a straight silhouette and a
       sharp point — and a field of them reads as traffic cones or as toy
       conifers, which is FURTHER from terrain than the bare plane it replaced.
       The saving was 16 triangles an object and the cost was the whole read.
       ⚠ Rejected with it: crossed alpha billboards, the usual answer for
         grass. Each needs a cut-out texture and an alphaTest material; with no
         alpha they render as solid rectangles, which is the cone's problem
         again with a texture bill attached.
       SCRUB / TUFT / ROCK / CROWN therefore all share ONE 20-triangle
       icosahedron, squashed and spun differently per use. Same argument
       /src/parcel's shrub() makes: at this distance every plant is a blob, and
       what tells them apart is size, squash and tone, not facets. */
    blob:  grab(new THREE.IcosahedronGeometry(.5, 0), .5),
    /* A SAPLING TRUNK: a three-sided open cylinder, 6 triangles. Round in
       silhouette from every angle that matters and a third of the cost of a
       box, which has four faces of which two are always hidden. */
    stem:  grab(new THREE.CylinderGeometry(.5, .5, 1, 3, 1, true), .5),
  };
  return PROTO;
}

/* ── THE STAMP ────────────────────────────────────────────────────────────
   Writes one prototype into the standing buffer at (x,y,z), scaled by
   (sx,sy,sz) and rotated by yaw about Y then tilt about X.
   ⚠ NORMALS GET S-INVERSE, NOT S. A squashed blob whose normals were merely
     rotated is lit as if it were a sphere — the flattening is exactly the part
     the light is supposed to show. (R·S) inverse-transpose is R·S-inverse for
     a diagonal S, so it is three divides and the same rotation. */
function stamp(S, pr, col, x, y, z, sx, sy, sz, yaw, tilt) {
  const cy = Math.cos(yaw), sy_ = Math.sin(yaw);
  const cp = Math.cos(tilt), sp = Math.sin(tilt);
  /* R = Ry(yaw) · Rx(tilt), written out. Three sines and three cosines per
     object instead of a Matrix4 allocation per object — at ~2,800 objects a
     rebuild that difference is the difference between a hitch and nothing. */
  const m00 = cy,  m01 = sy_ * sp, m02 = sy_ * cp;
  const m10 = 0,   m11 = cp,       m12 = -sp;
  const m20 = -sy_, m21 = cy * sp, m22 = cy * cp;
  const P = pr.P, N = pr.N, n = P.length;
  const ix = 1 / sx, iy = 1 / sy, iz = 1 / sz;
  for (let i = 0; i < n; i += 3) {
    const px = P[i] * sx, py = P[i + 1] * sy, pz = P[i + 2] * sz;
    S.P.push(m00 * px + m01 * py + m02 * pz + x,
             m10 * px + m11 * py + m12 * pz + y,
             m20 * px + m21 * py + m22 * pz + z);
    const nx = N[i] * ix, ny = N[i + 1] * iy, nz = N[i + 2] * iz;
    let ax = m00 * nx + m01 * ny + m02 * nz;
    let ay = m10 * nx + m11 * ny + m12 * nz;
    let az = m20 * nx + m21 * ny + m22 * nz;
    const L = Math.hypot(ax, ay, az) || 1;
    S.N.push(ax / L, ay / L, az / L);
    S.C.push(col.r, col.g, col.b);
  }
  S.n += n / 9;
}

/* ── the flat writer ──────────────────────────────────────────────────────
   ⭐ ONE TRIANGLE, WITH A COLOUR PER VERTEX, AND THE PER-VERTEX PART IS THE
   WHOLE REASON THE FLAT HALF OF THIS LAYER WORKS AT ALL.
   A patch of bare earth drawn in one flat tone has an OUTLINE, and the round-5
   critic read exactly that back about the tree-base patches: "a single flat
   unmottled colour with a hard straight edge, sitting ON TOP of the ground".
   Carrying the plate's grain (which NAT_GROUND does) fixes the interior and
   does nothing for the edge. What kills the edge is making the rim vertices
   THE GROUND'S OWN COLOUR and only the middle the stain: Gouraud then
   interpolates the difference away to nothing before the boundary is reached,
   so the shape has a centre and no border, which is what a scuff of bare earth
   actually looks like from the air.
   It also removes the reason patches would have needed to overlap — a soft
   blob does the job a stack of hard ones was going to be asked to do, and two
   quads of this layer at one height in one buffer would z-fight each other
   with no offset able to fix it, because they share a material.

   ⚠ WINDING IS [0,2,1] FOR A QUAD AND REVERSED FOR A FAN. In the XZ plane the
     intuitive order is clockwise seen from +Y, so a face written that way
     points DOWN, is back-face culled by the FrontSide default, and
     computeVertexNormals hands it a -Y normal into the bargain. /src/parking
     lost a round to this and /src/parcel repeats the warning; it is repeated
     again because this is the same kind of buffer.
   ⚠ NORMALS ARE WRITTEN, NOT COMPUTED — see the buffer build at the end.
     Everything here is level ground: computeVertexNormals over a fan whose
     vertices differ by 2mm in y produces noise, and (0,1,0) is correct and free.
   ⚠ UV IS WORLD/grainPer. NAT_GROUND wears the plate's grain canvas, and the
     whole point of the round-7 note above that material is that a patch's grain
     must be in phase with the plate's — so the source is world x/z at the
     plate's own period, never a local 0..1. */
function triG(F, A, B, C, cA, cB, cC, per) {
  F.P.push(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2]);
  F.C.push(cA.r, cA.g, cA.b, cB.r, cB.g, cB.b, cC.r, cC.g, cC.b);
  F.U.push(A[0] / per, A[2] / per, B[0] / per, B[2] / per, C[0] / per, C[2] / per);
  F.n += 1;
}

/* Tile-seeded xorshift32 — the same shape /src/parcel, /src/crowd, /src/parking
   and r1_road.js all use. A tile's scatter must be a property of the TILE and
   not of the moment the layer happened to rebuild, or laying one road anywhere
   in the city would reshuffle every bush in it. */
function rngOf(x, z, salt) {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1)
           ^ Math.imul(salt | 0, 0x85ebca6b) ^ 0x9e3779b9) >>> 0;
  h = (h || 0x9e3779b9) >>> 0;
  return () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
}

/* ── THE CLUMP FIELD ──────────────────────────────────────────────────────
   This is the ONE field in the file that is this module's own, and the header
   explains why that is allowed where a second copy of hfield would not be: the
   moisture and height terms have to AGREE with the plate exactly (a thicket
   drawn where the ground is not damp is worse than no thicket), so those come
   from NC_TERRAIN_AT. Whether a given damp patch happens to have grown over is
   a genuinely independent fact, and giving it its own octave is what produces
   bald ground INSIDE a damp region — which is what stops the scatter from
   being a second rendering of the moisture map.
   Two octaves, ~4.4 tiles and ~1.7 tiles. The coarse one carves the thickets;
   the fine one keeps their edges from being smooth blobs. */
const chash = (x, z, s) => {
  let h = (Math.imul(x | 0, 0x2545f491) ^ Math.imul(z | 0, 0x9e3779b1) ^ s) >>> 0;
  h = (h || 0x9e3779b9) >>> 0;
  h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0;
  return h / 4294967296;
};
function cnoise(x, z, f, s) {
  const px = x * f, pz = z * f;
  const X = Math.floor(px), Z = Math.floor(pz);
  const fx = px - X, fz = pz - Z;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = chash(X, Z, s), b = chash(X + 1, Z, s);
  const c = chash(X, Z + 1, s), d = chash(X + 1, Z + 1, s);
  const t = a + (b - a) * sx, u = c + (d - c) * sx;
  return t + (u - t) * sz;
}
const clump = (u, w) => cnoise(u, w, .228, 0x1b873593) * .68
                      + cnoise(u, w, .590, 0x6b43a9b5) * .32;
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

function clear() {
  for (const m of [flatMesh, standMesh]) if (m) { group.remove(m); try { m.geometry.dispose(); } catch (e) {} }
  flatMesh = null; standMesh = null;
  stats = { tiles: 0, objects: 0, tris: 0, flatTris: 0, standTris: 0, patches: 0, wear: 0 };
}

function build() {
  const { THREE, game, GRID, HALF, isRoad, groundAt, terrainAt, grainPer, texDiv } = CTX;
  clear();
  const PR = protos(THREE);
  const F = newFlat(), S = newStand();

  /* ── THE THREE HEIGHTS ON THIS TILE, AND WHY THERE IS ONLY ONE FREE SLOT
     node-city stacks a shade plane at y = 0, the buildable plate and the road
     apron feather at .012, the gridHelper's lines at .0145, every recipe's own
     paving at RD_Y (.016) and the hover highlight at .020. An UNBUILT tile has
     none of the recipe layers on it, so the only two things a flat patch has to
     stay between are the terrain it lies on and the grid line above it.
     🐞 AND IT HAS TO FOLLOW THE TERRAIN, WHICH IS THE PART THAT IS EASY TO GET
        WRONG. The plate is a DISPLACED lattice, ±AMP = ±9mm. A patch pinned to
        a constant y is 9mm in the air on a ridge and 9mm underground in a
        hollow — at the street camera, which sits 300mm up, that is a patch
        visibly hovering. So every vertex takes NC_TERRAIN_AT's own y for its
        own x/z and adds LIFT.
        LIFT = 4mm, and 4 is not a taste: /src/parcel's header records that 2mm
        over the buildable plate lost to the depth buffer entirely and that
        makeHousing's apron proves 4mm renders. 4mm over a terrain that tops out
        at +9mm puts the patch at +13mm, which is still under the gridHelper at
        14.5mm — so a bare-earth patch can never hide the tile grid a player
        builds against. */
  const LIFT = .004;

  /* ── 1. WHICH TILES ─────────────────────────────────────────────────────
     Everything in the grid that nobody has placed anything on. `game.tiles`
     only holds keys that were written by a placement, so absence IS emptiness —
     see the header for why that single test is also the whole z-fight defence.
     The occupancy set is materialised first because the candidate rejection
     below queries neighbours, and a Set lookup beats re-splitting a key. */
  const occ = new Set(Object.keys(game.tiles));
  const empty = [];
  for (let gx = 0; gx < GRID; gx++) for (let gz = 0; gz < GRID; gz++)
    if (!occ.has(gx + ',' + gz)) empty.push([gx, gz]);
  /* See TARGET_TILES: an empty map must not be the expensive one. */
  const load = empty.length > TARGET_TILES ? TARGET_TILES / empty.length : 1;

  const gcol = new THREE.Color(), pal = new THREE.Color(), tmp = new THREE.Color();
  /* Pick a palette entry and pull it toward the ground tone under (wx,wz).
     `div` is 1 for the standing bucket (NAT_PAINT is unmapped) and _VG_TEXDIV
     for the flat one (NAT_GROUND wears the plate's grain and a map multiplies
     in linear, so a colour authored for an unmapped material renders at 83% of
     its stated level the moment the map goes on). Getting those two the wrong
     way round is invisible in review and obvious in a capture. */
  const tint = (arr, R, wx, wz, blend, div) => {
    pal.setHex(arr[(R() * arr.length) | 0]);
    if (groundAt) { groundAt(wx, wz, gcol); pal.lerp(gcol, blend); }
    if (div !== 1) { pal.r = Math.min(1, pal.r / div); pal.g = Math.min(1, pal.g / div); pal.b = Math.min(1, pal.b / div); }
    return pal;
  };
  const tintHex = (hex, wx, wz, blend, div) => {
    tmp.setHex(hex);
    if (groundAt) { groundAt(wx, wz, gcol); tmp.lerp(gcol, blend); }
    if (div !== 1) { tmp.r = Math.min(1, tmp.r / div); tmp.g = Math.min(1, tmp.g / div); tmp.b = Math.min(1, tmp.b / div); }
    return tmp;
  };
  /* The plate's surface, and 0 where the host is too old to publish it. A
     scatter lying dead flat on a ±9mm landform is a worse render than this one
     and a much better one than a page that throws. */
  const surf = (wx, wz) => terrainAt ? terrainAt(wx, wz).y : 0;

  /* Is this world point far enough from anything anybody built? Only the eight
     neighbouring tiles are ever consulted, so this is at most nine Set lookups
     and a point-to-square distance. A road is allowed much closer than a
     building, because a road tile's own footway ends AT its tile line whereas a
     plot's fence stands 22mm inside its — see the clearances at the top. */
  const clearOf = (wx, wz, rad) => {
    const u = wx + HALF, w = wz + HALF;
    const gx = Math.floor(u), gz = Math.floor(w);
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = gx + dx, nz = gz + dz;
      if (nx < 0 || nz < 0 || nx >= GRID || nz >= GRID) continue;
      if (!occ.has(nx + ',' + nz)) continue;
      const road = isRoad(nx, nz);
      const need = rad + (road ? CLR_ROAD : CLR_BUILT);
      /* distance from the point to that tile's square, in the plate frame */
      const qx = Math.max(nx - u, 0, u - (nx + 1));
      const qz = Math.max(nz - w, 0, w - (nz + 1));
      if (Math.hypot(qx, qz) < need) return false;
    }
    return true;
  };
  for (const [gx, gz] of empty) {
    const cx = gx - HALF + .5, cz = gz - HALF + .5;
    const R = rngOf(gx, gz, 0x5eed);
    const T = terrainAt ? terrainAt(cx, cz) : { h: .5, m: .5, y: 0 };

    /* ── 2. HOW MUCH GROWS HERE ──────────────────────────────────────────
       lush  — damp hollows are green and thick; dry ridges bake. The height
               term is a BIAS and not the whole story, exactly as mfield's own
               note in index.html argues: correlated, not identical.
       cover — lush AND the independent clump octave, so a damp region still
               contains bald ground. The -.30 is what makes bald ground exist
               at all: without it the minimum of the product is still positive
               everywhere and every tile in the city carries something, which
               is the "sprinkle" failure the header names.
       ⚠ AND IT FADES OUT WITH THE PLATE. The plate's colour ramp dissolves
         into the surrounding plain over its outer 14% (d > .86, Chebyshev).
         A scatter that ran to the plate's edge at full density and then stopped
         dead would draw a perfect 24x24 square of vegetation on the map — a NEW
         hard edge, in a round whose subject is that hard edges read as a board.
         This starts thinning at .74 and is gone by the time the colour starts
         to go, so the land runs out before the map does. */
    const d = Math.max(Math.abs(cx), Math.abs(cz)) / HALF;
    const rim = 1 - clamp01((d - .74) / .16);
    const lush = clamp01(T.m * 1.20 + (.5 - T.h) * .55);
    /* 🐞 THE CONTRAST CURVE ON `k` IS NOT COSMETIC, AND THE FIRST CUT DID NOT
       HAVE IT. Two octaves of smoothed value noise pile up hard around .5 —
       the same fact the plate's own ramp has a 1.75x curve to undo — so
       `clump * 1.55 - .30` never fell below zero anywhere on the map and EVERY
       TILE IN THE CITY carried something. Photographed, that is precisely the
       sprinkle the header warns against: an even stipple of bushes over an
       unbroken plane, which is busier and not better. Pushing away from .5 by
       2.6x is what makes BALD GROUND EXIST, and bald ground is half of what
       makes the other half read as a thicket. */
    const k = clamp01(.5 + (clump(gx, gz) - .5) * 2.6);
    const cover = clamp01(k * 1.45 - .42 + (lush - .5) * .50) * rim * load;
    if (cover > 0) stats.tiles++;

    /* ── 3. THE STAIN — the answer to "no grass tone change, no dirt" ───
       The critic's sentence names two things and they are ONE PRIMITIVE here:
       a soft-edged blot of ground whose middle is a different tone and whose
       rim IS the ground (see triG — the rim carries the plate's own colour, so
       there is no boundary anywhere on it). Where the cover is thick the stain
       is a barely-there damp/dry drift; where the cover has thinned to bald it
       is bare earth. Same nine triangles either way.

       ⭐ WHY THIS IS NEEDED AT ALL WHEN THE PLATE ALREADY HAS A COLOUR FIELD.
       Measured, not assumed: the plate's finest colour octave is 2.4 TILES and
       its grain canvas is +/-5% at a 3.71-tile period. A district camera sees
       about ten tiles, so within one city block the field is a GRADIENT and the
       grain is a fine speckle — and there is nothing in between. The scale the
       eye reads as "a patch of different ground" is roughly half a tile to a
       tile, and that is the one band neither the lattice nor the canvas can
       reach. This is 9 triangles a tile spent exactly there.

       ⚠ ONE PER TILE, AND THE RADIUS IS CAPPED SO IT CANNOT LEAVE ITS TILE.
         Two stains from neighbouring tiles that overlapped would be two quads
         of THIS layer at THIS height in ONE buffer, which z-fight each other
         and which no polygonOffset can separate because they share a material —
         /src/parcel's header states that rule and this is the same buffer. Max
         reach is .30 * 1.20 (the vertex jitter) + .12 (the centre jitter) =
         .48, i.e. inside the half-tile, so two of them can touch and can never
         cross. */
    if (rim > .22 && R() < .58) {
      const px = cx + (R() - .5) * .24, pz = cz + (R() - .5) * .24;
      const rad = .14 + R() * .16;
      if (clearOf(px, pz, rad)) {
        stats.patches++;
        /* WHAT COLOUR THE MIDDLE IS. Bald ground bares its earth; thick ground
           only drifts. Both are pulled from the plate's own tone at the stain's
           centre, so a stain is always this ground somewhat drier or somewhat
           damper and never a colour from outside the map's palette. */
        const bald = cover < .34;
        const hex = bald ? (R() < .40 ? C_SOIL : C_DUST)
                         : (T.h > .5 ? C_DUST : C_DAMP);
        const mid = tintHex(hex, px, pz, bald ? .34 + R() * .18 : .70 + R() * .12, texDiv).clone();
        const SEG = 9, rr = [], aa = [];
        for (let i = 0; i < SEG; i++) { rr.push(rad * (.55 + R() * .65)); aa.push((i / SEG) * Math.PI * 2 + R() * .30); }
        const y0 = surf(px, pz) + LIFT;
        for (let i = 0; i < SEG; i++) {
          const j = (i + 1) % SEG;
          const bx = px + Math.cos(aa[i]) * rr[i], bz = pz + Math.sin(aa[i]) * rr[i];
          const dx = px + Math.cos(aa[j]) * rr[j], dz = pz + Math.sin(aa[j]) * rr[j];
          /* the rim vertices take the GROUND's tone at their own position, so
             the blot dissolves rather than ending — and it dissolves into the
             plate's actual drift, not into an average of it. */
          const eB = tintHex(hex, bx, bz, 1, texDiv).clone();
          const eD = tintHex(hex, dx, dz, 1, texDiv).clone();
          // reversed winding for a fan seen from +Y — see tri()'s note
          triG(F, [px, y0, pz], [dx, surf(dx, dz) + LIFT, dz], [bx, surf(bx, bz) + LIFT, bz],
               mid, eD, eB, grainPer);
        }
      }
    }

    /* ── 4. WEAR WHERE GRASS MEETS THE PAVING ────────────────────────────
       The baseline's district frame has a razor-straight line between the pale
       footway and the green — 1 px, dead straight, running the whole length of
       every block. Nothing in the reference frames has an edge like that; the
       grass beside a paved edge is trodden thin and irregular for a hand-span.
       This is 3-5 short bands of varying depth along each edge that faces a
       road, so the line becomes a frayed one. 6-10 triangles an edge.

       🐞 IT STARTS AT THE APRON, NOT AT THE TILE LINE, AND THE FIRST CUT DID
          NOT. r1_road.js aprons 150mm PAST its own tile edge into this one —
          110mm of it solid paving standing 46mm proud (see CLR_ROAD). Bands
          drawn from the tile line inward were therefore drawn entirely
          UNDERNEATH that paving: 654 of them in the standard district, every
          one built, merged and rendered, and not one pixel of any of them in
          the capture. The visible line is the apron's outer edge, so that is
          where the wear has to begin.
       ⚠ AND THE INNER EDGE FADES TO THE GROUND'S OWN COLOUR (triG). A band of
         flat dust has two edges, and the one facing the grass would be a second
         straight line 100mm from the first — replacing one hard edge with two,
         which is worse than the problem. */
    for (const [ex, ez] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nx = gx + ex, nz = gz + ez;
      if (nx < 0 || nz < 0 || nx >= GRID || nz >= GRID) continue;
      if (!isRoad(nx, nz)) continue;
      if (rim < .2) continue;
      const W = rngOf(gx * 31 + ex, gz * 31 + ez, 0x7ea4);
      const nSeg = 3 + ((W() * 3) | 0);
      for (let i = 0; i < nSeg; i++) {
        const t0 = -.5 + (i / nSeg) * (1 - .04) + W() * .04;
        const t1 = t0 + (1 / nSeg) * (.55 + W() * .40);
        const dep = .055 + W() * .105;
        const c = tintHex(W() < .45 ? C_SOIL : C_DUST, cx, cz, .30, texDiv).clone();
        /* the edge frame: `t` runs along the shared line, and the band starts
           APR inside this tile because the road's apron owns everything before
           that (see the note above) and runs `dep` further in. */
        const APR = CTX.roadApron || 0.150;
        const px = (t) => cx + (ex ? ex * (.5 - APR) : t);
        const pz = (t) => cz + (ez ? ez * (.5 - APR) : t);
        const ix = ex ? -ex : 0, iz = ez ? -ez : 0;
        const A = [px(t0), pz(t0)], B = [px(t1), pz(t1)];
        const A2 = [A[0] + ix * dep, A[1] + iz * dep], B2 = [B[0] + ix * dep, B[1] + iz * dep];
        // the inner pair takes the ground's own tone, so the band has one edge
        const gA = tintHex(C_DUST, A2[0], A2[1], 1, texDiv).clone();
        const gB = tintHex(C_DUST, B2[0], B2[1], 1, texDiv).clone();
        /* 🐞 NO CLEARANCE TEST HERE, AND THE FIRST CUT HAD ONE. It asked
           clearOf() whether the band's midpoint was far enough from an
           occupied tile — and the midpoint of a band drawn ON the shared line
           is at distance ZERO from the road tile, so the test rejected 100% of
           the wear in the city and the kerb line came back off the harness
           exactly as razor-straight as before. The band is SUPPOSED to touch
           the road: that is the whole feature. Its extent is the shared edge
           and nothing else, so there is nothing left to test. */
        const yA = surf(A[0], A[1]) + LIFT, yB = surf(B[0], B[1]) + LIFT;
        const yA2 = surf(A2[0], A2[1]) + LIFT, yB2 = surf(B2[0], B2[1]) + LIFT;
        /* Two triangles, wound so the pair faces +Y on ALL FOUR edges, and the
           condition is derived rather than guessed. With `a` the along unit and
           `i` the inward unit, the +Y component of (B-A)x(C-A) for the pair
           (A,B,B2) works out to dep*len*(a.z*i.x - a.x*i.z) — so that ordering
           is front-facing exactly when a.z*i.x - a.x*i.z > 0, which for the four
           cases (a,i) = ((1,0),(0,-1)) / ((1,0),(0,1)) / ((0,1),(-1,0)) /
           ((0,1),(1,0)) is true for ez = +1 and ex = -1 and false for the other
           two. Getting it wrong is not a subtle artefact: FrontSide culling
           would silently delete the wear along half the kerbs in the city, and
           the half it deleted would be the two compass directions nobody
           happened to look at. */
        stats.wear++;
        const ccw = (ez === 1 || ex === -1);
        const pA = [A[0], yA, A[1]], pB = [B[0], yB, B[1]];
        const pA2 = [A2[0], yA2, A2[1]], pB2 = [B2[0], yB2, B2[1]];
        if (ccw) {
          triG(F, pA, pB, pB2, c, c, gB, grainPer);
          triG(F, pA, pB2, pA2, c, gB, gA, grainPer);
        } else {
          triG(F, pA, pB2, pB, c, gB, c, grainPer);
          triG(F, pA, pA2, pB2, c, gA, gB, grainPer);
        }
      }
    }

    if (cover <= .02) continue;

    /* ── 5. WHAT STANDS UP ───────────────────────────────────────────────
       The half that actually answers the brief: these are the objects that
       catch the 15:00 key and put a shadow on the ground beside them, which is
       the one thing a colour field cannot do at any budget. */
    const dry = lush < .42;
    /* ⭐ THE THICKET ANCHOR — the second scale of clumping, and the cheaper of
       the two. The clump field carves patches at 4.4 tiles; inside one tile it
       says nothing, so the first cut jittered every object uniformly across the
       whole tile and the result photographed as an EVEN STIPPLE even where the
       field had thinned it. Plants do not grow uniformly across a square: they
       grow round each other. Everything on a tile is therefore scattered about
       one anchor point, so a tile reads as one thicket with ground beside it
       rather than as N objects spread out to fill the square. Costs one pair of
       random numbers a tile. */
    const hx = cx + (R() - .5) * .52, hz = cz + (R() - .5) * .52;
    const place = (rad, spread, fn) => {
      /* Three tries, then give up. A tile beside a building has most of its
         area inside CLR_BUILT and forcing a placement there would push objects
         into a hedge; a tile in open country succeeds on the first try. */
      for (let k = 0; k < 3; k++) {
        /* clamped to the tile: the anchor can sit .26 off centre and a wide
           spread on top of that would walk objects into the NEXT tile's scatter
           and undo the clumping the anchor just bought. */
        const px = Math.max(cx - .49, Math.min(cx + .49, hx + (R() - .5) * spread));
        const pz = Math.max(cz - .49, Math.min(cz + .49, hz + (R() - .5) * spread));
        if (clearOf(px, pz, rad)) { fn(px, pz); return; }
      }
    };

    /* TUFTS OF ROUGH GRASS — the numerous small thing, and the one that carries
       the district framing where scrub carries the aerial.
       ⚠ THE SIZE IS DELIBERATELY NOT THE PHYSICAL ONE. A citizen is .18 tall
         here (see CIV_SCALE), so 40cm of grass is .04 units — which at the
         aerial camera, where a tile is about 46 px, is TWO PIXELS and buys
         nothing but triangles. These are .05-.11 tall and wider than they are
         tall: unmown 50cm-1.1m tussock, splayed the way ungrazed grass splays,
         which is both what grows on land nobody maintains and the smallest
         thing that survives the district framing.
       ⚠ AND THEY ARE BARELY TINTED AWAY FROM THE GROUND (blend .52). The first
         cut used the same .34 every other element uses and every tuft came back
         as a distinctly darker mark on a lighter plane — 900 hard little stamps,
         which is the sprinkle read again, arriving through the palette instead
         of through the distribution. A tussock is the SAME grass, longer; what
         should make it visible is its own shadow, not its colour. */
    const nT = Math.round(cover * 4.2);
    for (let i = 0; i < nT; i++) place(.05, .62, (px, pz) => {
      const r = .042 + R() * .034;
      stamp(S, PR.blob, tint(dry ? C_TUFT_DRY : C_TUFT_WET, R, px, pz, .52, 1),
            px, surf(px, pz) - r * .55, pz, r * 2.3, r * 1.9, r * 2.3 * (.75 + R() * .5),
            R() * 6.283, (R() - .5) * .45);
      stats.objects++;
    });

    /* SCRUB. The thing that actually reads at the aerial camera: .2-.3 across
       is ~12 px up there, with a shadow of its own.
       ⚠ TWO BLOBS, NOT ONE, AND THE SECOND IS 20 TRIANGLES WELL SPENT. A single
         squashed icosahedron at this size photographs as what it is — one
         convex crystal with visible facets and a smooth outline. A second,
         smaller blob leaning out of the first breaks the outline into two
         lobes, and two lobes is the whole difference between "a low-poly bush"
         and "a solid the renderer happened to draw". */
    const nS = R() < cover * .95 ? (R() < cover * .55 ? 2 : 1) : 0;
    for (let i = 0; i < nS; i++) place(.15, .58, (px, pz) => {
      const r = .080 + R() * .062;
      const c = tint(dry ? C_SCRUB_DRY : C_SCRUB, R, px, pz, .40, 1).clone();
      const y = surf(px, pz);
      stamp(S, PR.blob, c, px, y - r * .34, pz,
            r * 2, r * 1.5, r * 2 * (.8 + R() * .4), R() * 6.283, (R() - .5) * .5);
      const r2 = r * (.48 + R() * .26), a = R() * 6.283;
      stamp(S, PR.blob, c, px + Math.cos(a) * r * .78, y - r2 * .3, pz + Math.sin(a) * r * .78,
            r2 * 2, r2 * 1.7, r2 * 2, R() * 6.283, (R() - .5) * .7);
      stats.objects++;
    });

    /* ROCK. Dry ground only, and it is the one element here that is NOT green —
       which is why it earns its place in a round about a plane of one colour.
       Barely tinted (blend .20): a stone is not made of the field it sits in,
       and the whole reason to draw one is that it is a different material. */
    if (R() < (1 - lush) * .40 * cover + .05) place(.11, .70, (px, pz) => {
      const r = .050 + R() * .062;
      stamp(S, PR.blob, tint(C_ROCK, R, px, pz, .20, 1),
            px, surf(px, pz) - r * .45, pz, r * 2.2, r * 1.5, r * 1.7,
            R() * 6.283, (R() - .5) * .9);
      stats.objects++;
    });

    /* A SELF-SEEDED SAPLING. Rare — about one tile in nine of the thick ground
       — because the moment there are two per tile this stops being wild land
       and becomes an orchard, and because the DECOR tree tile is a thing the
       player buys and this must not look like a free one. Trunk + two crowns,
       ~46 triangles, and it is the tallest thing on unbuilt land so it is what
       breaks the horizon line across an empty block. */
    if (R() < cover * .16 && !dry) place(.14, .66, (px, pz) => {
      const y = surf(px, pz);
      const th = .17 + R() * .13;
      stamp(S, PR.stem, tint(C_BARK, R, px, pz, .18, 1).clone(),
            px, y - .01, pz, .030, th, .030, R() * 6.283, 0);
      const cr = .085 + R() * .050;
      const cc = tint(C_CROWN, R, px, pz, BLEND * .7, 1).clone();
      stamp(S, PR.blob, cc, px, y + th * .86, pz, cr * 2, cr * 2.1, cr * 2, R() * 6.283, 0);
      stamp(S, PR.blob, cc, px + (R() - .5) * .06, y + th * 1.30, pz + (R() - .5) * .06,
            cr * 1.4, cr * 1.5, cr * 1.4, R() * 6.283, 0);
      stats.objects++;
    });
  }

  /* ── 6. ONE MESH EACH ────────────────────────────────────────────────── */
  if (F.n) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(F.P), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(F.C), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(F.U), 2));
    // see tri(): everything in this buffer is level ground and (0,1,0) is both
    // correct and free, where computeVertexNormals over 2mm of y is noise.
    const N = new Float32Array(F.P.length);
    for (let i = 1; i < N.length; i += 3) N[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.computeBoundingSphere();
    flatMesh = new THREE.Mesh(g, CTX.groundMat);
    flatMesh.castShadow = false; flatMesh.receiveShadow = true;   // flat: casts nothing
    flatMesh.frustumCulled = false;   // one mesh spans the map; its bounding
    group.add(flatMesh);              // sphere is the map, so culling it can
  }                                   // only ever be wrong in the costly direction
  if (S.n) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(S.P), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(S.N), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(S.C), 3));
    g.computeBoundingSphere();
    standMesh = new THREE.Mesh(g, CTX.propMat);
    /* ⚠ castShadow ON, AND IT IS THE ENTIRE POINT OF THE MODULE. A bush that
       throws no shadow is a green blob painted on a green plane and adds
       nothing a texture could not have done for free — the shadow is what makes
       the eye read the ground as a surface with things standing on it. ONE
       mesh for the city, so this is one extra shadow-map draw and not one per
       bush. */
    standMesh.castShadow = true; standMesh.receiveShadow = true;
    standMesh.frustumCulled = false;
    group.add(standMesh);
  }
  stats.tris = F.n + S.n; stats.flatTris = F.n; stats.standTris = S.n;
  return stats.objects;
}

/* Same contract as /src/parcel and /src/crowd: cheap enough to call from
   manageAgents(), which every path that changes the city already runs through,
   but only when the layout actually moved. The TYPE is in the hash as well as
   the key because this layer's whole input is WHICH TILES ARE EMPTY — and a
   tile that changes from road to shop does not change that, while a demolition
   does. Hashing keys alone would be enough for emptiness and would miss the
   road/building distinction the two clearances depend on. */
function signature() {
  const { game } = CTX;
  let h = 0, n = 0;
  for (const k in game.tiles) {
    const ty = game.tiles[k].type; n++;
    for (let i = 0; i < k.length; i++) h = (Math.imul(h, 31) + k.charCodeAt(i)) | 0;
    for (let i = 0; i < ty.length; i++) h = (Math.imul(h, 33) + ty.charCodeAt(i)) | 0;
  }
  return h + ':' + n;
}

export function mount(ctx) {
  CTX = ctx;
  const { THREE, scene } = ctx;
  group = new THREE.Group(); group.name = 'wild'; scene.add(group);
  const api = {
    refresh() {
      const s = signature();
      if (s === sig) return stats.objects;
      sig = s;
      return build();
    },
    count: () => stats.objects,
    // for a driver / a cost report: what this layer actually cost, without
    // having to diff a whole-scene triangle count against another round.
    stats: () => Object.assign({}, stats, { meshes: (flatMesh ? 1 : 0) + (standMesh ? 1 : 0) }),
    group: () => group,
  };
  api.refresh();
  return api;
}
