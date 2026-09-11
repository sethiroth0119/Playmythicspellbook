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

   ⚠ AND "EVERY PLANT IS A BLOB AT THIS DISTANCE" WAS THE WRONG CONCLUSION.
     The first cut spent one prototype — a squashed icosahedron — on tuft,
     scrub, rock and crown alike, on the argument that at these sizes only
     size, squash and tone survive. Photographed at 4x on the district
     framing, a field of them reads as SCATTERED GREEN STONES: convex,
     faceted, hard straight silhouettes. That is the same category error the
     cone note in protos() diagnoses, committed again with a different solid.
     Tufts now have their own 12-triangle splayed fan, and the thing that
     changed is not detail but SILHOUETTE — vertical, tapered, non-convex,
     which an icosahedron cannot produce at any scale or squash. See
     PROTO.fan.

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
   MEASURED on the standard gauntlet district as an A/B inside ONE boot —
   .gauntlet/wildcost.mjs (or .gauntlet/wildshot.mjs, which does this and the
   pictures and the timings together) toggles this group's `visible` and reads
   renderer.info twice, because capture.mjs's own header records the whole-scene
   mesh count moving by ±15 between boots and a cross-boot delta of "+2 meshes"
   is therefore inside the instrument's own noise:

       meshes      1919 -> 1921     (+2)
       draw calls  1624 -> 1626     (+2)
       triangles 457,744 -> 477,125 (+19,381, i.e. +4.2%)

   …serving 224 tiles with 1,062 standing objects (16,696 tris — of which 906
   field tufts and 315 kerb tufts), 111 ground stains and 843 kerb-wear bands
   (2,685 tris between them).
   ⚠ +2 CALLS AND NOT +3. The standing bucket casts, so it was expected to cost
     a shadow-map draw as well; the shadow map is not re-rendered on every
     frame, so the steady-state figure is two.
   ⚠ AND THE MESH LINE IS A MEASUREMENT AGAIN. For one round wildcost.mjs
     computed the `off` mesh count by SUBTRACTING `g.children.length`, which is
     arithmetic that cannot fail: it could only ever restate that this group
     has two children, and it would have gone on printing +2 after the layer
     stopped drawing. It now walks each mesh's ancestry for visibility, which
     is the same question the renderer asks.

   ⚠ THE GEOMETRY IS STAMPED, NOT ALLOCATED. /src/parcel builds a THREE
   geometry per prop and merges at the end, which is fine for the 8 parcels
   it serves and is not fine for 400 tiles: that would be ~2,800 geometry
   allocations and 2,800 disposes on EVERY rebuild, and refresh() runs from
   manageAgents(), i.e. every time the player lays one road. Each shape here
   is authored once at module load into a plain Float32Array and then STAMPED
   — transformed straight into the output arrays — so a rebuild is arithmetic
   with no allocation per object and no merge pass at all.

   🔴 …AND THAT PARAGRAPH WAS TRUE AND THE REBUILD STALLED ANYWAY. Measured in
   the browser on the standard district: 88.5 / 89.9 / 28.3 / 25.1 / 24.5 /
   18.8 ms, and 55.4 ms on an EMPTY 576-tile map — one to three dropped frames
   every time the player lays a road, for a layer that had congratulated itself
   on not allocating geometry. It was allocating everything else. A CPU profile
   (.gauntlet/wildbench.mjs runs build() in node, no browser, so a profile
   points at lines instead of at SwiftShader) named five things, and all five
   are fixed with their own notes at the code:

       Array.push into growing plain arrays  -> Float32Array + a cursor
       Color.setHex per tinted vertex        -> the palettes converted once
       fresh 32k buffers per rebuild         -> buffers held across rebuilds
       computeBoundingSphere over 140k floats-> a sphere set from GRID
       a Set of "x,z" keys + isRoad per cell -> one Uint8Array of occupancy

   The layer now carries TWICE the objects and 26% more triangles than the
   build that stalled, and rebuilds in 8.3-19.3 ms in the browser (node bench:
   district 7.21 -> 6.30 ms, empty map 10.47 -> 4.22 ms). Every rebuild fits
   inside a 60 fps frame, including the two JIT-cold ones.

   ── 🔍 AND IT CHECKS ITSELF ───────────────────────────────────────────────
   `verify()`, reported only when it fails, called one line after the mount in
   the same idiom as MythicLandValue and MythicDistricts. It exists because
   this module's mount is `catch { console.warn('not mounted (non-fatal)') }`
   and nothing else, which makes "drew nothing", "drew the wrong thing" and
   "was never there" the same observation. See its own header.
   ══════════════════════════════════════════════════════════════════════════ */

let CTX = null, group = null, sig = '', flatMesh = null, standMesh = null;
let stats = newStats();
/* `refused` is null on a healthy build and names the missing host call on a
   refused one — see the top of build(). `skipped` counts stains dropped
   because the tile had no room left between two kerbs. */
function newStats() {
  return { tiles: 0, objects: 0, tufts: 0, kerbTufts: 0, tris: 0, flatTris: 0,
           standTris: 0, patches: 0, skipped: 0, wear: 0, refused: null };
}

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
/* 🐞 …AND 0.17 ON EVERYTHING IS HOW THE BARE GUTTER CAME BACK THROUGH THE
   OTHER DOOR. clearOf() requires (object radius + clearance) from the road
   tile's square, so scrub — declared at rad .15 — could not put its CENTRE
   nearer than 320mm of a road tile line, and the aerial crop duly shows a
   clean unplanted band beside every road: the artefact the header spends a
   paragraph designing against, arriving as a side effect of the clearance
   rather than of the jitter.
   The real constraint is not 0.17. It is that no standing vertex may enter the
   road's own 150mm apron — which is a statement about the object's OUTER EDGE,
   and clearOf already takes the radius separately. So the small stuff carries
   CLR_ROAD_TIGHT and its outer blades stop 2mm past the apron, where grass
   beside a kerb actually stops. Scrub keeps the loose figure: it is 280mm
   across with a second lobe leaning out of it, and its true reach is nearer
   .22 than the .15 it declared. */
const CLR_ROAD_TIGHT = 0.152;   // = RD_AP + 2mm, i.e. the apron's outer edge
/* The nine cells clearOf consults, flattened. 🐞 It used to be an inline array
   of arrays IN THE LOOP HEADER, so every one of the ~8,400 calls a rebuild
   makes allocated ten arrays and destructured nine of them. See the buffer
   note: this rebuild's cost was never the geometry, it was the allocation. */
const NB9 = [0, 0, 1, 0, -1, 0, 0, 1, 0, -1, 1, 1, 1, -1, -1, 1, -1, -1];
/* the four shared edges, hoisted for the same reason as NB9 */
const EDGE4 = [[0, 1], [0, -1], [1, 0], [-1, 0]];

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
/* 🔴 THE ~10% LIFT ON THIS FAMILY IS REVERSED, AND THE REASON IT WAS APPLIED
   IS WORTH WRITING DOWN BECAUSE IT WILL OTHERWISE BE RE-DERIVED WRONGLY.

   The lift was spent to recover a mid-bin terrain mean of 0.546 -> 0.528,
   "against round 5's defended target of 0.531". THE TWO NUMBERS ARE NOT THE
   SAME KIND OF NUMBER. index.html's round-5 block (search "measured off the
   stops") defends 0.531 as the AUTHORED RAMP MEAN — the arithmetic mean of the
   ramp's own colour stops, an albedo constant. 0.546 and 0.528 are RENDERED
   PIXEL statistics off a gsample crop: albedo through a key light, a shadow
   pass, a grain map, fog and a tone curve. They cannot be compared, and if one
   insists on comparing them anyway then the baseline was already +0.015 off
   the target and 0.528 is the CLOSER of the two. Either way the lift bought
   nothing and was paid for in the exact currency this module exists to mint.

   ⚠ THE VALID COMPARISON, for whoever asks next: an albedo target is checked
     against the palette, and a rendered level is checked against ANOTHER
     RENDER AT THE SAME HOUR THROUGH THE SAME CAMERA. Round 2's band (0.45-0.55
     rendered, from the reference frames) is the live constraint and 0.528 sits
     inside it with 0.078 of room. Nothing was owed.

   WHAT IS KEPT from that edit: the SIXTH entry. Widening the spread between
   bushes is what stops a thicket reading as one solid dark shape (the same
   argument /src/parcel's tileShade note makes about three shops sharing one
   forecourt) and it is independent of level — so both families keep six
   entries, added one DARKER and one PALER about the pre-lift mean rather than
   one paler above it. Channel means land within 2% of the pre-lift four. */
const C_SCRUB    = [0x47632f, 0x3f5a2c, 0x546f36, 0x3a5430, 0x35502a, 0x5d7539];
const C_SCRUB_DRY= [0x77784a, 0x6b6c42, 0x848256, 0x5f6339, 0x565a34, 0x8f8d60];
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
   The flat one carries uv because NAT_GROUND is MAPPED (it wears the plate's
   own grain canvas); the standing one does not, because NAT_PAINT has no map.

   🐞 THESE WERE PLAIN ARRAYS AND THAT WAS THE WHOLE OF THE REBUILD STALL.
   Measured on the standard district: forced rebuilds at 88.5 / 89.9 / 28.3 /
   25.1 / 24.5 / 18.8 ms, and 55.4 ms on an EMPTY 576-tile map — and refresh()
   runs from manageAgents(), so laying one road cost one to three dropped
   frames. The header's own cost note was already right that a geometry per
   prop would be unaffordable; what it missed is that ~470,000 `Array.push`
   calls with three arguments each are not free either. They are boxed doubles
   in a growing plain array, so the cost is the pushes, ~20 reallocate-and-copy
   passes over arrays reaching 138,000 elements, AND a final `new
   Float32Array(jsArray)` conversion per attribute — three times over.

   So the buffers are Float32Arrays with a write cursor, doubled when full, and
   handed to BufferAttribute as a `subarray` of exactly what was written. Same
   output, byte for byte (verify() checks precisely that); no push, no boxing,
   no conversion pass. ⚠ `subarray` and not `slice`: BufferAttribute uploads
   the view's own range, so the spare capacity is never touched and never
   copied. */
const BUF_START = 1 << 15;      // 32k floats ≈ 1,200 triangles before the first grow
function fbuf(n) { return new Float32Array(n); }
function fgrow(a, need) {
  if (need <= a.length) return a;
  let n = a.length || BUF_START; while (n < need) n *= 2;
  const m = new Float32Array(n); m.set(a); return m;
}
/* ⚠ AND THEY SURVIVE THE REBUILD, which is the other half of the same fix. A
   fresh pair of 32k buffers per rebuild means three grow-and-copy passes every
   time the player lays a road, over arrays that end at 140,000 floats —
   fgrow() measured 6.2% of a rebuild on its own. Held at module scope, the
   second rebuild of a city finds them already big enough and never grows at
   all; the cursor is what is reset, not the memory.
   🔴 SAFE ONLY BECAUSE clear() RUNS FIRST. The BufferAttributes handed to the
     last geometry are `subarray` VIEWS onto these very arrays, so writing over
     them while that geometry was still in the scene would corrupt what is on
     screen. build() disposes and detaches before it writes a single float, and
     that ordering is now load-bearing. */
const FLAT = { P: fbuf(BUF_START), C: fbuf(BUF_START), U: fbuf(BUF_START >> 1), n: 0 };
const STAND = { P: fbuf(BUF_START), N: fbuf(BUF_START), C: fbuf(BUF_START), n: 0 };
function newFlat()  { FLAT.n = 0; return FLAT; }
function newStand() { STAND.n = 0; return STAND; }

/* ── PROTOTYPES ───────────────────────────────────────────────────────────
   Built ONCE at first mount, into flat arrays. See the cost note in the header
   for why this is not a THREE geometry per object.
   ⚠ EVERY ONE IS AUTHORED AT UNIT SIZE, ORIGIN AT ITS FOOT, so a stamp is
     scale-rotate-translate with no per-shape fudge and a blob half-buried in
     the ground is a decision the caller makes rather than an accident. */
/* 🐞 EVERY HEX ABOVE IS CONVERTED TO A THREE.Color ONCE, HERE, AND THE REASON
   IS A PROFILE AND NOT A PREFERENCE. `Color.setHex()` is what does the sRGB ->
   linear conversion this file depends on (see the palette note), and that
   conversion is a Math.pow per channel. It was being run on EVERY tinted
   vertex colour — about 6,600 times a rebuild — and SRGBToLinear came back as
   11.2% of the whole rebuild in a CPU profile, second only to the stamp loop.
   Converting once and `copy()`ing is the SAME arithmetic on the same numbers,
   just not repeated, so the output is byte-identical (verify()'s determinism
   check compares the buffers across a rebuild and would say otherwise).
   ⚠ IT STILL GOES THROUGH setHex. Writing the linear triples out as literals
     would be the exact trap .gauntlet/README.md records as costing a round:
     a literal {r,g,b} is NOT converted and renders pale. */
let HEXC = null;
function hexc(THREE) {
  if (HEXC) return HEXC;
  HEXC = new Map();
  for (const a of [C_TUFT_WET, C_TUFT_DRY, C_SCRUB, C_SCRUB_DRY, C_ROCK, C_BARK, C_CROWN])
    for (const h of a) if (!HEXC.has(h)) HEXC.set(h, new THREE.Color().setHex(h));
  for (const h of [C_DUST, C_SOIL, C_DAMP]) if (!HEXC.has(h)) HEXC.set(h, new THREE.Color().setHex(h));
  return HEXC;
}

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
    /* 🌿 …AND THE TUFT IS NOT A BLOB, WHICH IS THIS ROUND'S ONE REAL FIX.
       The paragraph above is right about the cone and then draws the wrong
       conclusion from it. "At this distance every plant is a blob" was checked
       at 4x on the district framing and it is false: a field of squashed
       icosahedra photographs as SCATTERED GREEN STONES — convex, faceted, with
       a hard straight silhouette and two flat lit faces. That is the same
       category error the cone note diagnoses, re-committed with a different
       solid, and no amount of scale, squash or tint can move it, because the
       silhouette that separates rough grass from mown lawn in the reference
       frames is VERTICAL, TAPERED AND NON-CONVEX and an icosahedron has no
       such silhouette at any parameter.

       So the tuft gets its own prototype: THREE THIN TAPERED BLADES splaying
       from one foot. 12 triangles — 2 per blade, doubled because NAT_PAINT is
       FrontSide and a one-sided blade vanishes from half the compass.
       ⚠ NUMBERS, ALL OF THEM DERIVED RATHER THAN TYPED:
         · tilt 21 / 27 / 33 deg off vertical, and the blade LENGTHS differ
           (1.071 / 1.000 / 0.918) so that the widest blade's tip lands exactly
           on r = .5 and the most upright one's exactly on y = 1. That is what
           keeps this prototype in the same unit box as blob — foot at the
           origin, y in [0,1], x/z in [-.5,.5] — so a caller's sx/sy mean the
           same thing for both and no stamp needs a per-shape fudge.
         · half-width = length / (2 * 2.35), tapering to 17% of that at the
           tip. At sx = sy a blade is 2.35x taller than wide; the tuft is
           stamped at sy/sx = 1.48 (see the tuft note below), so on screen it
           is 3.5x — inside the 2.5-4 band that reads as a blade rather than a
           leaf. 🐞 2.6 photographed as REEDS: at the district framing three
           blades that thin are three separate spikes with plate between them,
           not a tussock, and the tuft's own outline stopped being one shape.
         · three yaws deliberately UNEVEN (0, 132, 247 deg). At 120 apart a
           tuft seen from above is a perfect tripod, and 500 perfect tripods is
           the stipple failure arriving through the geometry.
       ⚠ AND THE NORMALS ARE PER-FACE, NOT AVERAGED. Each blade is a flat
         sheet whose lit face points up-and-back over the foot; averaging the
         three blades' normals at the shared foot would light the tuft as one
         smooth dome, which is the icosahedron again. Three distinct normals is
         what makes one tuft show a bright blade and a dark one under a single
         key light. */
    fan:   fanProto(),
  };
  return PROTO;
}

/* Authored by hand rather than out of a THREE primitive: no primitive produces
   a splayed tapered fan, and stamping wants the same {P,N,tris} shape grab()
   returns. Cross products for the normals, so a change to any angle above
   cannot silently leave a normal pointing at where the blade used to be. */
function fanProto() {
  const TILT = [.36652, .47124, .57596];       // 21, 27, 33 deg
  const LEN  = [1.0709, 1.0000, .91800];       // see the note above
  const YAW  = [0, 2.3038, 4.3110];            // 0, 132, 247 deg
  const RATIO = 2.35, TAPER = .17;
  const P = new Float32Array(3 * 3 * 4 * 3), N = new Float32Array(P.length);
  let o = 0;
  const put = (px, py, pz, nx, ny, nz) => {
    P[o] = px; P[o + 1] = py; P[o + 2] = pz;
    N[o] = nx; N[o + 1] = ny; N[o + 2] = nz; o += 3;
  };
  for (let b = 0; b < 3; b++) {
    const th = TILT[b], ph = YAW[b], L = LEN[b];
    const st = Math.sin(th), ct = Math.cos(th), cp = Math.cos(ph), sp = Math.sin(ph);
    // a = the blade's own axis; w = across the blade, horizontal and tangential
    const ax = st * cp, ay = ct, az = st * sp;
    const wx = -sp, wz = cp;
    // n = w x a, i.e. the sheet's normal, which comes out pointing up and back
    // over the foot — the face a 15:00 key actually lights.
    let nx = 0 * az - wz * ay, ny = wz * ax - wx * az, nz = wx * ay - 0 * ax;
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const wb = L / (2 * RATIO), wt = wb * TAPER;
    const b0 = [-wb * wx, 0, -wb * wz], b1 = [wb * wx, 0, wb * wz];
    const t0 = [ax * L - wt * wx, ay * L, az * L - wt * wz];
    const t1 = [ax * L + wt * wx, ay * L, az * L + wt * wz];
    /* (b0,b1,t1) and (b0,t1,t0) are front-facing for n — worked through the
       same way the flat writer's winding note does it, since guessing this
       wrong deletes half of every tuft and looks like a density bug. */
    for (const [p, q, r] of [[b0, b1, t1], [b0, t1, t0]]) {
      put(p[0], p[1], p[2], nx, ny, nz);
      put(q[0], q[1], q[2], nx, ny, nz);
      put(r[0], r[1], r[2], nx, ny, nz);
      // …and the same triangle wound backwards, so the blade has two sides
      put(p[0], p[1], p[2], -nx, -ny, -nz);
      put(r[0], r[1], r[2], -nx, -ny, -nz);
      put(q[0], q[1], q[2], -nx, -ny, -nz);
    }
  }
  return { P, N, tris: P.length / 9 };
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
  let o = S.n * 9;
  if (o + n > S.P.length) { S.P = fgrow(S.P, o + n); S.N = fgrow(S.N, o + n); S.C = fgrow(S.C, o + n); }
  const OP = S.P, ON = S.N, OC = S.C;
  const cr = col.r, cg = col.g, cb = col.b;
  for (let i = 0; i < n; i += 3, o += 3) {
    const px = P[i] * sx, py = P[i + 1] * sy, pz = P[i + 2] * sz;
    OP[o]     = m00 * px + m01 * py + m02 * pz + x;
    OP[o + 1] = m10 * px + m11 * py + m12 * pz + y;
    OP[o + 2] = m20 * px + m21 * py + m22 * pz + z;
    const nx = N[i] * ix, ny = N[i + 1] * iy, nz = N[i + 2] * iz;
    const ax = m00 * nx + m01 * ny + m02 * nz;
    const ay = m10 * nx + m11 * ny + m12 * nz;
    const az = m20 * nx + m21 * ny + m22 * nz;
    const L = Math.hypot(ax, ay, az) || 1;
    ON[o] = ax / L; ON[o + 1] = ay / L; ON[o + 2] = az / L;
    OC[o] = cr; OC[o + 1] = cg; OC[o + 2] = cb;
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
  const p = F.n * 9, u = F.n * 6;
  if (p + 9 > F.P.length) { F.P = fgrow(F.P, p + 9); F.C = fgrow(F.C, p + 9); F.U = fgrow(F.U, u + 6); }
  const P = F.P, K = F.C, U = F.U;
  P[p] = A[0]; P[p + 1] = A[1]; P[p + 2] = A[2];
  P[p + 3] = B[0]; P[p + 4] = B[1]; P[p + 5] = B[2];
  P[p + 6] = C[0]; P[p + 7] = C[1]; P[p + 8] = C[2];
  K[p] = cA.r; K[p + 1] = cA.g; K[p + 2] = cA.b;
  K[p + 3] = cB.r; K[p + 4] = cB.g; K[p + 5] = cB.b;
  K[p + 6] = cC.r; K[p + 7] = cC.g; K[p + 8] = cC.b;
  U[u] = A[0] / per; U[u + 1] = A[2] / per;
  U[u + 2] = B[0] / per; U[u + 3] = B[2] / per;
  U[u + 4] = C[0] / per; U[u + 5] = C[2] / per;
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

/* A sphere that certainly contains the plate: the grid is GRID tiles across
   and centred on the origin, so its half-diagonal plus a metre of headroom for
   anything standing on it bounds every vertex this module can write. */
function sphereOfMap(THREE, g) {
  const r = CTX.GRID * 0.7072 + 1;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), r);
}

function clear() {
  for (const m of [flatMesh, standMesh]) if (m) { group.remove(m); try { m.geometry.dispose(); } catch (e) {} }
  flatMesh = null; standMesh = null;
  stats = newStats();
}

function build() {
  const { THREE, game, GRID, HALF, isRoad, groundAt, terrainAt, grainPer, texDiv, isSea } = CTX;
  clear();

  /* ── 🔴 0. THE TWO HOST CALLS, AND WHY A MISSING ONE NOW REFUSES TO DRAW ──
     Both used to be optional with a quiet fallback, and BOTH FALLBACKS PRODUCE
     VERBATIM THE DEFECT THIS MODULE WAS BUILT TO REMOVE — which is the worst
     failure a fallback can have, because the layer keeps reporting success.

     · groundAt missing: the stain's rim lerp (`tintHex(hex, x, z, 1, …)`) is
       what dissolves its boundary. Without it the rim keeps the stain hex at
       full strength and every soft blot becomes a hard-edged flat blob — word
       for word the round-5 critic's finding, "a single flat unmottled colour
       with a hard straight edge, sitting ON TOP of the ground". So the FLAT
       bucket refuses. The standing bucket still draws: an untinted bush is a
       worse bush, not a hard-edged blob, and a field with no vegetation at all
       is the failure this whole round is answering.
     · terrainAt missing: `surf()` returned 0 and the entire scatter lay on the
       y = 0 plane while the plate is displaced by ±9mm — every object and every
       patch floating or half-buried by up to 9mm, which at the street camera
       (300mm up) is the visible hovering the LIFT note is written to prevent.
       There is no partial answer to that, so the whole layer refuses.

     ⚠ AND IT IS RECORDED, NOT JUST LOGGED. A console.warn at boot is a line
       nobody reads six rounds later; `stats.refused` is what verify() names. */
  if (!terrainAt) {
    stats.refused = 'terrainAt';
    console.warn('[Wild] refusing to draw: the host published no NC_TERRAIN_AT, ' +
                 'so every object would sit on y=0 over a plate displaced by ±9mm');
    return 0;
  }
  if (!groundAt) stats.refused = 'groundAt';
  const flatOK = !!groundAt;

  const PR = protos(THREE);
  const F = newFlat(), S = newStand();

  /* ── THE HEIGHTS ON AN UNBUILT TILE, AND WHY THERE IS ONLY ONE FREE SLOT
     node-city stacks a shade plane at y = 0, the road apron's feather at .012,
     the gridHelper's lines at .0145, every recipe's own paving at RD_Y (.016)
     and the hover highlight at .020. An UNBUILT tile carries none of the recipe
     layers, and the two road-apron layers (paving at .046 out to 110mm, feather
     at .012 out to 150mm) are handled by starting everything 150mm in — see
     CLR_ROAD. So the only things left for a flat patch to sit between are the
     terrain it lies on and the grid line above it.
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

  /* ── THE KERB PASS'S OWN NUMBERS, HOISTED ────────────────────────────────
     Section 3 has to know where section 4 will draw (see the coplanar note
     there), so these live here and are DERIVED from the road's apron rather
     than typed twice. WEAR_FREE is the innermost point any band can reach,
     less a 4mm gap: inside it, a stain and a wear band may touch and may never
     cross. */
  const APR = CTX.roadApron || 0.150;
  const WEAR_OUT  = .5 - APR;    // the apron's outer edge = the visible line
  const WEAR_SET  = .075;        // how far back from it a band's OUTER edge may sit
  const WEAR_DEEP = .160;        // …and how much further in it may then run
  const WEAR_FREE = WEAR_OUT - WEAR_SET - WEAR_DEEP - .004;
  /* The corner rule, and it is the third coplanar pairing. Two bands on
     PERPENDICULAR edges of one tile both occupy the square where their
     corridors cross, so one of them has to give it up. The x-facing edges keep
     it (arbitrary, but it has to be one of them and a rule beats a coin), and
     a z-facing band's along-range is cut short of any corner that has an
     x-facing band running through it. */
  const WEAR_CORNER = WEAR_FREE - .004;

  /* ── THE TUFT, hoisted out of section 5 ─────────────────────────────────
     …because section 4 plants them along the kerb as well, and two copies of
     the same stamp is how the two ends of one feature drift apart.
     ⚠ tuftReach IS THE INVARIANT, not a guess at one. `place`/`clearOf` take a
       radius and the layer's standing rule is that no vertex may enter the
       road's 150mm apron, so the radius handed over has to be the WORST CASE
       of the stamp below: the widest a blade can be thrown (sz up to 1.18 sx,
       tip at .5 of the box) plus the furthest the tilt can swing a tip
       sideways (sin of the tilt cap, times the full height). verify() checks
       the result against the real buffer, which is what makes this a claim
       rather than an intention. */
  const TUFT_W = 1.55, TUFT_H = 2.30, TUFT_SZ = 1.18, TUFT_TILT = .20;
  const tuftReach = (r) => r * (TUFT_W * TUFT_SZ * .5 + TUFT_H * Math.sin(TUFT_TILT));

  /* ── 1. WHICH TILES ─────────────────────────────────────────────────────
     Everything in the grid that nobody has placed anything on. `game.tiles`
     only holds keys that were written by a placement, so absence IS emptiness —
     see the header for why that single test is also the whole z-fight defence.
     The occupancy set is materialised first because the candidate rejection
     below queries neighbours, and a Set lookup beats re-splitting a key. */
  /* 🐞 A Uint8Array AND NOT A Set OF KEYS, which is a third of the profile.
     The Set version asked `occ.has(nx + ',' + nz)` and then `isRoad(nx, nz)`
     for every one of the nine cells clearOf consults, on every one of ~3,000
     candidate placements — a string concatenation and a host tile lookup per
     cell, measured at 6.0% (clearOf) plus 5.9% (isRoad) of a rebuild. The
     occupancy of a 24x24 grid is 576 bytes; resolving the road/built question
     ONCE here instead of ~27,000 times below is the same answer, read out of
     an array index. 0 = empty, 1 = built, 2 = road. */
  const OCC = new Uint8Array(GRID * GRID);
  for (const k in game.tiles) {
    const c = k.indexOf(','); if (c < 0) continue;
    const gx = +k.slice(0, c), gz = +k.slice(c + 1);
    if (gx >= 0 && gz >= 0 && gx < GRID && gz < GRID) OCC[gz * GRID + gx] = isRoad(gx, gz) ? 2 : 1;
  }
  /* 🌊 …AND NOTHING GROWS IN THE SEA. /src/ocean puts open water on the plain
     east of the plate on every map, and this layer's whole emptiness test is
     "the key is not in game.tiles" — which a stretch of ocean satisfies
     perfectly. A tuft there would be planted on the plain at NC_TERRAIN_AT's y
     with the water drawn over it, and `stats` would report a healthy build.
     ⚠ PER TILE, NOT PER CANDIDATE, AND THAT IS A COST DECISION WITH A PROOF
       BEHIND IT. clearOf() runs ~8,400 times a rebuild and this test crosses a
       module boundary; per candidate it would be the third thing on the profile.
       Per tile is exact here because the waterline can never come inside
       HALF + 1.75 (WATER.sea.inset − bow) while this layer never leaves the
       plate at HALF — the sea cannot cut a tile in half, so a tile is wholly in
       or wholly out. If the coast is ever brought inside the plate, this test
       moves down into clearOf and the note moves with it.
     ⚠ ABSENT ⇒ NOT SEA. A host that hands over no `isSea` gets exactly the
       scatter it got before this round; the layer never refuses over it. */
  const wet = typeof isSea === 'function' ? isSea : null;
  const empty = [];
  for (let gx = 0; gx < GRID; gx++) for (let gz = 0; gz < GRID; gz++) {
    if (OCC[gz * GRID + gx]) continue;
    if (wet && wet(gx - HALF + .5, gz - HALF + .5)) continue;
    empty.push([gx, gz]);
  }
  /* See TARGET_TILES: an empty map must not be the expensive one. */
  const load = empty.length > TARGET_TILES ? TARGET_TILES / empty.length : 1;

  const gcol = new THREE.Color(), pal = new THREE.Color(), tmp = new THREE.Color();
  /* Pick a palette entry and pull it toward the ground tone under (wx,wz).
     `div` is 1 for the standing bucket (NAT_PAINT is unmapped) and _VG_TEXDIV
     for the flat one (NAT_GROUND wears the plate's grain and a map multiplies
     in linear, so a colour authored for an unmapped material renders at 83% of
     its stated level the moment the map goes on). Getting those two the wrong
     way round is invisible in review and obvious in a capture. */
  const HX = hexc(THREE);
  const tint = (arr, R, wx, wz, blend, div) => {
    pal.copy(HX.get(arr[(R() * arr.length) | 0]));
    if (groundAt) { groundAt(wx, wz, gcol); pal.lerp(gcol, blend); }
    if (div !== 1) { pal.r = Math.min(1, pal.r / div); pal.g = Math.min(1, pal.g / div); pal.b = Math.min(1, pal.b / div); }
    return pal;
  };
  const tintHex = (hex, wx, wz, blend, div) => {
    tmp.copy(HX.get(hex));
    if (groundAt) { groundAt(wx, wz, gcol); tmp.lerp(gcol, blend); }
    if (div !== 1) { tmp.r = Math.min(1, tmp.r / div); tmp.g = Math.min(1, tmp.g / div); tmp.b = Math.min(1, tmp.b / div); }
    return tmp;
  };
  /* The plate's surface. No null branch: build() refused above if the host
     did not publish one, because "dead flat on a ±9mm landform" is the
     floating-patch defect and not a degraded mode worth shipping. */
  const surf = (wx, wz) => terrainAt(wx, wz).y;

  /* ONE TUFT. See PROTO.fan for why this is not a blob any more, and the
     tuftReach note for why the caller has to pass the same r it stamps.
     ⚠ AND IT IS TINTED AT `BLEND`, NOT AT .52. The old .52 was argued as "a
       tussock is the SAME grass, longer; what should make it visible is its
       own shadow, not its colour" — and that argument is right about a tuft
       that HAS a silhouette and was being used to prop up one that did not. At
       .52 on a squashed icosahedron the tufts photographed as nothing at all:
       the district crop shows scrub and bare plate between it, with no middle
       scale of vegetation anywhere. The fan earns its colour back.
     ⚠ TALLER THAN WIDE, which the blob version was not (2.3 wide by 1.9 tall).
       sy/sx = 1.48, so a blade's on-screen aspect is 2.6 * 1.48 = 3.9 — a
       blade, not a leaf — and the tuft's own outline is vertical. That ratio
       is the whole fix; a fan stamped wider than tall reads as a starfish. */
  const putTuft = (RN, px, pz, r, dryHere) => {
    const sx = r * TUFT_W, sy = r * TUFT_H;
    stamp(S, PR.fan, tint(dryHere ? C_TUFT_DRY : C_TUFT_WET, RN, px, pz, BLEND, 1),
          // 4mm into the ground: the blades meet at a point and a point resting
          // exactly on a ±9mm lattice shows daylight under it from the street.
          px, surf(px, pz) - .004, pz,
          sx, sy, sx * (.82 + RN() * (TUFT_SZ - .82)),
          RN() * 6.283, (RN() - .5) * (TUFT_TILT * 2));
    stats.objects++; stats.tufts++;
  };

  /* Is this world point far enough from anything anybody built? Only the eight
     neighbouring tiles are ever consulted, so this is at most nine Set lookups
     and a point-to-square distance. The two clearances are different because
     what reaches into this tile is different: a plot's fence stands 22mm INSIDE
     its own line, while a road slab reaches 150mm OUT of its — see CLR_BUILT
     and CLR_ROAD, both of which are measured rather than chosen. */
  const clearOf = (wx, wz, rad, roadClr) => {
    const u = wx + HALF, w = wz + HALF;
    const gx = Math.floor(u), gz = Math.floor(w);
    for (let q = 0; q < 18; q += 2) {
      const nx = gx + NB9[q], nz = gz + NB9[q + 1];
      if (nx < 0 || nz < 0 || nx >= GRID || nz >= GRID) continue;
      const o = OCC[nz * GRID + nx];
      if (!o) continue;
      const need = rad + (o === 2 ? (roadClr || CLR_ROAD) : CLR_BUILT);
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
    const T = terrainAt(cx, cz);
    /* WHICH EDGES FACE A ROAD, resolved BEFORE anything is drawn on the tile.
       Section 4 wears a band along each of them and section 3 has to keep the
       stain out of that band — see the coplanar note there — so the answer is
       needed by both and is one isRoad() call per edge either way. */
    let rE = 0;                      // 1 = +x, 2 = -x, 4 = +z, 8 = -z
    if (gx + 1 < GRID && OCC[gz * GRID + gx + 1] === 2) rE |= 1;
    if (gx - 1 >= 0   && OCC[gz * GRID + gx - 1] === 2) rE |= 2;
    if (gz + 1 < GRID && OCC[(gz + 1) * GRID + gx] === 2) rE |= 4;
    if (gz - 1 >= 0   && OCC[(gz - 1) * GRID + gx] === 2) rE |= 8;

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
    // hoisted above section 4, which plants kerb tufts and needs the tone
    const dry = lush < .42;

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
         cross.

       🔴 …AND STAIN-VERSUS-STAIN WAS THE ONLY PAIRING THAT PROOF CONSIDERED,
         WHICH IS WHY THE RULE WAS BROKEN ANYWAY. Measured on the standard
         district: 363 disjoint overlapping triangle pairs, 325 of them
         coplanar within 0.2mm, out of 2,244 flat triangles. The pairing it
         misses is STAIN VERSUS THE KERB WEAR ON THE SAME TILE. A stain reaches
         .48 from the tile centre; a wear band occupies .135 to .35 from it on
         any road-facing edge; both are written at `surf(x,z) + LIFT`, into the
         same buffer, on the same material. Same lift, same buffer, same
         material is exactly the case the rule above says no polygonOffset can
         separate — and it has been quiet only because both are tinted toward
         the same ground tone, which this round stops being true.

         So the stain is now placed in what the kerb pass LEAVES: its centre is
         biased to the middle of the free interval on each axis and its radius
         is capped at the distance to the nearest wear corridor. A tile with
         roads on OPPOSITE sides has no interval wide enough and loses its
         stain outright (counted as `skipped`) — that is a one-tile-wide
         verge between two roads, which is wear all the way across anyway.
         ⚠ WEAR_FREE IS DERIVED FROM THE KERB PASS AND NOT TYPED. If the band's
           set-back or depth is retuned there, this moves with it or the
           overlap comes straight back. */
    if (flatOK && rim > .22 && R() < .58) {
      const bx0 = (rE & 2) ? -WEAR_FREE : -.49, bx1 = (rE & 1) ? WEAR_FREE : .49;
      const bz0 = (rE & 8) ? -WEAR_FREE : -.49, bz1 = (rE & 4) ? WEAR_FREE : .49;
      const wx_ = bx1 - bx0, wz_ = bz1 - bz0;
      if (wx_ < .30 || wz_ < .30) { stats.skipped++; R(); R(); R(); }
      else {
      const px = cx + (bx0 + bx1) * .5 + (R() - .5) * Math.min(.24, wx_ * .5);
      const pz = cz + (bz0 + bz1) * .5 + (R() - .5) * Math.min(.24, wz_ * .5);
      /* the cap: the stain's own vertex jitter reaches rad * 1.20 (see rr
         below), so the free radius is the distance to the nearest corridor
         divided by that. */
      const room = Math.min(px - cx - bx0, cx + bx1 - px, pz - cz - bz0, cz + bz1 - pz) / 1.20;
      const rad = Math.min(.14 + R() * .16, room);
      if (rad >= .09 && clearOf(px, pz, rad)) {
        stats.patches++;
        /* WHAT COLOUR THE MIDDLE IS. Bald ground bares its earth; thick ground
           only drifts. Both are pulled from the plate's own tone at the stain's
           centre, so a stain is always this ground somewhat drier or somewhat
           damper and never a colour from outside the map's palette. */
        const bald = cover < .34;
        /* ⚠ BIASED TOWARD THE PALE SIDE ON PURPOSE — .32 and .42, not .5 and
           .5. The scatter above spends terrain value (see the C_SCRUB note);
           the stain is the only element here that can hand some back, and dry
           bleached ground is also the commoner of the two on the grassland
           this city is authored to stand on (GROUND_COL's own argument). */
        const hex = bald ? (R() < .32 ? C_SOIL : C_DUST)
                         : (T.h > .42 ? C_DUST : C_DAMP);
        const mid = tintHex(hex, px, pz, bald ? .34 + R() * .18 : .70 + R() * .12, texDiv).clone();
        /* ⚠ THE RIM IS RESOLVED ONCE PER VERTEX, NOT ONCE PER TRIANGLE. Each
           rim point is the `b` of one triangle and the `d` of the next, and
           the first cut asked the host for its height AND its ground tone in
           both roles — two hfield+mfield evaluations and a Color clone thrown
           away per vertex. The host's noise is the second-largest term in a
           rebuild after the stamp loop (22.7% in a CPU profile), so halving
           the stain's share of it is worth the two little arrays. */
        const SEG = 9, PT = [], EC = [];
        const y0 = surf(px, pz) + LIFT;
        for (let i = 0; i < SEG; i++) {
          const rr = rad * (.55 + R() * .65), aa = (i / SEG) * Math.PI * 2 + R() * .30;
          const bx = px + Math.cos(aa) * rr, bz = pz + Math.sin(aa) * rr;
          PT.push([bx, surf(bx, bz) + LIFT, bz]);
          /* the rim vertices take the GROUND's tone at their own position, so
             the blot dissolves rather than ending — and it dissolves into the
             plate's actual drift, not into an average of it. */
          EC.push(tintHex(hex, bx, bz, 1, texDiv).clone());
        }
        const ctr = [px, y0, pz];
        for (let i = 0; i < SEG; i++) {
          const j = (i + 1) % SEG;
          // reversed winding for a fan seen from +Y — see tri()'s note
          triG(F, ctr, PT[j], PT[i], mid, EC[j], EC[i], grainPer);
        }
      } else if (rad < .09) stats.skipped++;
      }
    }

    /* ── 4. WEAR WHERE GRASS MEETS THE PAVING ────────────────────────────
       The baseline's district frame has a razor-straight line between the pale
       footway and the green — 1 px, dead straight, running the whole length of
       every block. Nothing in the reference frames has an edge like that; the
       grass beside a paved edge is trodden thin and irregular for a hand-span.

       🐞 IT STARTS AT THE APRON, NOT AT THE TILE LINE, AND THE FIRST CUT DID
          NOT. r1_road.js aprons 150mm PAST its own tile edge into this one —
          110mm of it solid paving standing 46mm proud (see CLR_ROAD). Bands
          drawn from the tile line inward were therefore drawn entirely
          UNDERNEATH that paving: 654 of them in the standard district, every
          one built, merged and rendered, and not one pixel of any of them in
          the capture. The visible line is the apron's outer edge, so that is
          where the wear has to begin.

       🔴 …AND THEN THE SECOND CUT PUT ALL OF THEM AT EXACTLY THE SAME OFFSET.
          `px = (t) => cx + (ex ? ex * (.5 - APR) : t)` — the distance from the
          tile line was the CONSTANT `.5 - APR` for every band on every edge in
          the city. Only the inward depth varied, and the inward edge is
          deliberately faded to the ground's own colour, so the only boundary
          the eye could find was still one straight line: the round replaced a
          hard grass|paving line with a hard dust|paving line and reported the
          goal as met. A frayed edge is one whose OFFSET varies.

          Three things vary now, and only the first of them is new geometry:
            · the OUTER edge sets back from the apron by 0 to WEAR_SET, per
              END, so a band can start at the kerb, or a hand-span inside it,
              or slew from one to the other along its own length;
            · the set-back fades: an outer edge that has left the paving is
              lerped toward the ground's own tone in proportion, exactly as the
              inner edge is, because a band that stops short of the paving
              otherwise gains a SECOND hard line facing the grass — which is
              the failure the inner-edge note below already names;
            · and section 4b plants tufts along the kerb, which is what
              actually breaks the line in SILHOUETTE. No flat band can fray the
              paving's own edge: that geometry belongs to r1_road.js and this
              module may not touch it. What it can do is stand something in
              front of it, and the fan-tufts are 150mm from the tile line, i.e.
              hard against the apron.

       🔴 AND THE BANDS NO LONGER OVERLAP EACH OTHER. Two ways they did:
            · ALONG ONE EDGE. `t0` jittered forward by up to .04 while cells
              advanced by only .96/nSeg, so consecutive bands could and did
              cross by up to ~37mm. Cells are now exact and t1 is clamped short
              of the next cell's start, so the gaps are real gaps.
            · AT A CORNER. See WEAR_CORNER.
          Both were coplanar-in-one-buffer, i.e. the case triG's note says
          nothing can separate.

       ⚠ AND THE INNER EDGE FADES TO THE GROUND'S OWN COLOUR (triG). A band of
         flat dust has two edges, and the one facing the grass would be a second
         straight line 100mm from the first — replacing one hard edge with two,
         which is worse than the problem. */
    for (const [ex, ez] of EDGE4) {
      const nx = gx + ex, nz = gz + ez;
      if (nx < 0 || nz < 0 || nx >= GRID || nz >= GRID) continue;
      if (OCC[nz * GRID + nx] !== 2) continue;
      if (rim < .2) continue;
      const W = rngOf(gx * 31 + ex, gz * 31 + ez, 0x7ea4);
      /* the along-range, cut short of any corner an x-facing band already owns
         — see WEAR_CORNER. x-facing edges always run the full tile. */
      const tLo = (ez && (rE & 2)) ? -WEAR_CORNER : -.5;
      const tHi = (ez && (rE & 1)) ?  WEAR_CORNER :  .5;
      const span = tHi - tLo;
      if (span < .12) continue;
      /* ~5.5 bands to the tile: more and shorter than the old 3-5, because the
         gaps BETWEEN bands are half of what makes the line ragged and three
         gaps in a tile reads as three notches rather than as wear. */
      const nSeg = Math.max(2, Math.round(span * 5.5));
      const cw = span / nSeg;
      /* the edge frame. `t` runs along the shared line; `off` is measured
         INWARD from the apron's outer edge, so off = 0 is hard against the
         paving and off > 0 has grass in front of it. */
      const ix = ex ? -ex : 0, iz = ez ? -ez : 0;
      const pt = (t, off) => (ex ? [cx + ex * (WEAR_OUT - off), cz + t]
                                 : [cx + t, cz + ez * (WEAR_OUT - off)]);
      if (flatOK) for (let i = 0; i < nSeg; i++) {
        const cell = tLo + i * cw;
        const t0 = cell + W() * cw * .18;
        // …clamped short of the NEXT cell, so two bands can never cross
        const t1 = Math.min(t0 + cw * (.50 + W() * .42), cell + cw - .010);
        const o0 = W() * WEAR_SET, o1 = W() * WEAR_SET;
        const d0 = .050 + W() * (WEAR_DEEP - .050), d1 = .050 + W() * (WEAR_DEEP - .050);
        const hex = W() < .45 ? C_SOIL : C_DUST;
        if (t1 - t0 < .035) continue;
        const A = pt(t0, o0), B = pt(t1, o1);
        const A2 = pt(t0, o0 + d0), B2 = pt(t1, o1 + d1);
        /* the OUTER pair fades in proportion to its set-back (0 = trodden dust
           against the paving, WEAR_SET = the ground's own tone) and the INNER
           pair is the ground's tone outright, so the only hard boundary a band
           owns is the one it shares with the paving. */
        const cA = tintHex(hex, A[0], A[1], .30 + .70 * (o0 / WEAR_SET), texDiv).clone();
        const cB = tintHex(hex, B[0], B[1], .30 + .70 * (o1 / WEAR_SET), texDiv).clone();
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
           (A,B,B2) works out to d1*len*(a.z*i.x - a.x*i.z) — so that ordering
           is front-facing exactly when a.z*i.x - a.x*i.z > 0, which for the four
           cases (a,i) = ((1,0),(0,-1)) / ((1,0),(0,1)) / ((0,1),(-1,0)) /
           ((0,1),(1,0)) is true for ez = +1 and ex = -1 and false for the other
           two. Getting it wrong is not a subtle artefact: FrontSide culling
           would silently delete the wear along half the kerbs in the city, and
           the half it deleted would be the two compass directions nobody
           happened to look at.
           ⚠ THE SIGN SURVIVES THE SET-BACK. With independent o0/o1 the quad is
             a trapezoid rather than a rectangle, and the cross product's sign
             works out to (t1-t0)*d1 and (t1-t0)*d0 for the two triangles — the
             o terms cancel — so the same flag is still right. */
        stats.wear++;
        const ccw = (ez === 1 || ex === -1);
        const pA = [A[0], yA, A[1]], pB = [B[0], yB, B[1]];
        const pA2 = [A2[0], yA2, A2[1]], pB2 = [B2[0], yB2, B2[1]];
        if (ccw) {
          triG(F, pA, pB, pB2, cA, cB, gB, grainPer);
          triG(F, pA, pB2, pA2, cA, gB, gA, grainPer);
        } else {
          triG(F, pA, pB2, pB, cA, gB, cB, grainPer);
          triG(F, pA, pA2, pB2, cA, gA, gB, grainPer);
        }
      }

      /* ── 4b. AND THE TUFTS THAT ACTUALLY BREAK THE LINE ─────────────────
         🐞 THE BARE GUTTER ALONG EVERY ROAD, which the header designs against
         at length and then produces anyway through the clearance rather than
         through the jitter. See CLR_ROAD_TIGHT: scrub could not put its centre
         within 320mm of a road tile line, so the aerial crop shows a clean
         unplanted band beside every road in the city. A tuft is small enough
         to be placed by its true reach, so it stands with its outer blades 3mm
         past the apron — where roadside grass actually stands — and its
         silhouette, not the flat band under it, is what stops the eye reading
         the paving edge as a drawn line.
         ⚠ IT STILL DOES NOT ENTER THE APRON. The reach handed to clearOf is
           the stamp's worst case (see tuftReach) and CLR_ROAD_TIGHT is RD_AP
           plus 2mm, so "no standing vertex within 150mm of a road tile" — a
           property the round-10 critic measured and this module wants to keep
           true — survives, with about 3mm to spare. verify() re-measures it
           off the buffer rather than trusting this paragraph.
         ⚠ AND THE COUNT FOLLOWS `cover`. A bald dry verge gets one tuft or
           none: kerb grass that ignored the cover field would be a green line
           ruled along every road, which is the graph paper again. */
      const nK = cover > .12 ? 2 + ((W() * 2) | 0) : (W() < .5 ? 1 : 0);
      for (let i = 0; i < nK; i++) {
        const r = .040 + W() * .032;
        const reach = tuftReach(r);
        const t = tLo + .06 + W() * Math.max(0, span - .12);
        const off = WEAR_OUT - reach - .003;
        const kx = ex ? cx + ex * off : cx + t;
        const kz = ez ? cz + ez * off : cz + t;
        if (clearOf(kx, kz, reach, CLR_ROAD_TIGHT)) { putTuft(W, kx, kz, r, dry); stats.kerbTufts++; }
      }
    }

    if (cover <= .02) continue;

    /* ── 5. WHAT STANDS UP ───────────────────────────────────────────────
       The half that actually answers the brief: these are the objects that
       catch the 15:00 key and put a shadow on the ground beside them, which is
       the one thing a colour field cannot do at any budget. */
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
    const place = (rad, spread, fn, roadClr) => {
      /* Three tries, then give up. A tile beside a building has most of its
         area inside CLR_BUILT and forcing a placement there would push objects
         into a hedge; a tile in open country succeeds on the first try. */
      for (let k = 0; k < 3; k++) {
        /* clamped to the tile: the anchor can sit .26 off centre and a wide
           spread on top of that would walk objects into the NEXT tile's scatter
           and undo the clumping the anchor just bought. */
        const px = Math.max(cx - .49, Math.min(cx + .49, hx + (R() - .5) * spread));
        const pz = Math.max(cz - .49, Math.min(cz + .49, hz + (R() - .5) * spread));
        if (clearOf(px, pz, rad, roadClr)) { fn(px, pz); return; }
      }
    };

    /* TUFTS OF ROUGH GRASS — the numerous small thing, and the one that carries
       the district framing where scrub carries the aerial.
       ⚠ THE SIZE IS DELIBERATELY NOT THE PHYSICAL ONE. A citizen is .18 tall
         here (see CIV_SCALE), so 40cm of grass is .04 units — which at the
         aerial camera, where a tile is about 46 px, is TWO PIXELS and buys
         nothing but triangles. These are .10-.18 tall and TALLER than they are
         wide: unmown 50cm-1.1m tussock, splayed the way ungrazed grass splays,
         which is both what grows on land nobody maintains and the smallest
         thing that survives the district framing.
       ⚠ 6.0 A TILE AND NOT 4.2, AND THE SPREAD IS .44 AND NOT .62. The fan is
         12 triangles against the blob's 20, so the tuft budget barely moves
         even as the count rises by half — and it has to rise, because tufts
         are now the only element working at the district scale (scrub reads at
         the aerial, saplings are one tile in nine). The narrower spread is the
         more important of the two: at .62 six tufts are six isolated marks
         scattered over a whole tile, which is the even-stipple failure the
         anchor note above is written against; at .44 they overlap into two or
         three tussocks with bare ground between, which is what rough grass
         does. Same objects, same cost, different read.
       See putTuft for the stamp, and tuftReach for why the radius handed to
       place() is computed rather than the .05 that used to be typed here. */
    const nT = Math.round(cover * 6.0);
    for (let i = 0; i < nT; i++) {
      const r = .042 + R() * .034;
      place(tuftReach(r), .44, (px, pz) => putTuft(R, px, pz, r, dry), CLR_ROAD_TIGHT);
    }

    /* SCRUB. The thing that actually reads at the aerial camera: .2-.3 across
       is ~12 px up there, with a shadow of its own.
       ⚠ TWO BLOBS, NOT ONE, AND THE SECOND IS 20 TRIANGLES WELL SPENT. A single
         squashed icosahedron at this size photographs as what it is — one
         convex crystal with visible facets and a smooth outline. A second,
         smaller blob leaning out of the first breaks the outline into two
         lobes, and two lobes is the whole difference between "a low-poly bush"
         and "a solid the renderer happened to draw". */
    /* 🐞 …AND THE RADIUS IT DECLARES TO place() IS 1.70 r, NOT THE .15 THAT
         USED TO BE TYPED HERE, WHICH WAS NOT A MEASUREMENT OF THIS SHAPE. A
         scrub is a blob of half-width r with a SECOND blob leaning .78 r out
         of it, itself up to .74 r across and tilted by up to .35 rad — so its
         true reach from the stamp point is about 1.66 r, i.e. .236 at the top
         of the size range and not .15. Under-declaring it is how standing
         geometry gets inside a road apron without anybody choosing that; the
         layer only stayed clear by luck of the draw. Declared honestly and
         cleared against CLR_ROAD_TIGHT, scrub now stops exactly at the apron
         instead of 320mm short of it — and it stops there because that is
         where the paving is, not because of a number nobody had checked. */
    const nS = R() < cover * .95 ? (R() < cover * .55 ? 2 : 1) : 0;
    for (let i = 0; i < nS; i++) { const r = .080 + R() * .062;
      place(r * 1.70, .58, (px, pz) => {
      const c = tint(dry ? C_SCRUB_DRY : C_SCRUB, R, px, pz, .28 + R() * .26, 1).clone();
      const y = surf(px, pz);
      stamp(S, PR.blob, c, px, y - r * .34, pz,
            r * 2, r * 1.5, r * 2 * (.8 + R() * .4), R() * 6.283, (R() - .5) * .5);
      const r2 = r * (.48 + R() * .26), a = R() * 6.283;
      stamp(S, PR.blob, c, px + Math.cos(a) * r * .78, y - r2 * .3, pz + Math.sin(a) * r * .78,
            r2 * 2, r2 * 1.7, r2 * 2, R() * 6.283, (R() - .5) * .7);
      stats.objects++;
    }, CLR_ROAD_TIGHT); }

    /* ROCK. Dry ground only, and it is the one element here that is NOT green —
       which is why it earns its place in a round about a plane of one colour.
       Barely tinted (blend .20): a stone is not made of the field it sits in,
       and the whole reason to draw one is that it is a different material. */
    if (R() < (1 - lush) * .40 * cover + .05) { const r = .050 + R() * .062;
      // 1.30 r for the same reason scrub declares 1.70 r: a .5-box blob at
      // sx = 2.2 r reaches 1.1 r on its own, before the .45-rad tilt.
      place(r * 1.30, .70, (px, pz) => {
      stamp(S, PR.blob, tint(C_ROCK, R, px, pz, .20, 1),
            px, surf(px, pz) - r * .45, pz, r * 2.2, r * 1.5, r * 1.7,
            R() * 6.283, (R() - .5) * .9);
      stats.objects++;
    }, CLR_ROAD_TIGHT); }

    /* A SELF-SEEDED SAPLING. Rare — about one tile in nine of the thick ground
       — because the moment there are two per tile this stops being wild land
       and becomes an orchard, and because the DECOR tree tile is a thing the
       player buys and this must not look like a free one. Trunk + two crowns,
       ~46 triangles, and it is the tallest thing on unbuilt land so it is what
       breaks the horizon line across an empty block. */
    if (R() < cover * .16 && !dry) place(.18, .66, (px, pz) => {
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
    // subarray, not slice — see the buffer note: the spare capacity is never
    // uploaded and never copied.
    g.setAttribute('position', new THREE.BufferAttribute(F.P.subarray(0, F.n * 9), 3));
    g.setAttribute('color', new THREE.BufferAttribute(F.C.subarray(0, F.n * 9), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(F.U.subarray(0, F.n * 6), 2));
    // see tri(): everything in this buffer is level ground and (0,1,0) is both
    // correct and free, where computeVertexNormals over 2mm of y is noise.
    const N = new Float32Array(F.n * 9);
    for (let i = 1; i < N.length; i += 3) N[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    /* ⚠ SET, NOT COMPUTED. computeBoundingSphere() walks all 140,000 floats
       twice and measured 5.3% of a rebuild — for a number nothing reads, since
       both meshes below are frustumCulled = false. It is still set rather than
       left null, because a null boundingSphere is a trap for any later code
       that raycasts or re-enables culling; the map is 24 tiles across, so a
       sphere on the origin of GRID is correct for any city this grid holds and
       costs nothing. */
    sphereOfMap(THREE, g);
    flatMesh = new THREE.Mesh(g, CTX.groundMat);
    flatMesh.castShadow = false; flatMesh.receiveShadow = true;   // flat: casts nothing
    flatMesh.frustumCulled = false;   // one mesh spans the map; its bounding
    group.add(flatMesh);              // sphere is the map, so culling it can
  }                                   // only ever be wrong in the costly direction
  if (S.n) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(S.P.subarray(0, S.n * 9), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(S.N.subarray(0, S.n * 9), 3));
    g.setAttribute('color', new THREE.BufferAttribute(S.C.subarray(0, S.n * 9), 3));
    sphereOfMap(THREE, g);   // see the flat mesh above
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

/* ══ 🔍 THE SELF-CHECK ══════════════════════════════════════════════════════
   Reported ONLY when it fails, in the same idiom as MythicLandValue.verify()
   and MythicDistricts.verify() and called one line after the mount, because a
   check that logs on success is one everyone learns to scroll past.

   🔴 IT EXISTS BECAUSE THIS MODULE'S MOUNT IS `catch { console.warn('[Wild]
   not mounted (non-fatal)') }` AND NOTHING ELSE — which makes a layer that
   silently drew nothing indistinguishable from a layer that was never there,
   and a layer that drew the WRONG thing indistinguishable from a healthy one.
   Every question below is one the round-10 critic had to boot a browser and
   write a probe to answer, and every one of them is a number this file already
   has in hand.

     · did a host call go missing? (see build()'s refusal note)
     · does any STANDING vertex sit on a tile somebody built on, or inside the
       road's own 150mm apron? Those are the two properties the whole clearance
       system exists to produce, and they are asserted against the merged
       buffer that actually shipped, not against the intentions in clearOf.
     · do any two FLAT triangles OVERLAP? They are all written at
       `surf(x,z) + LIFT` on one material in one buffer, so an overlap is
       coplanar by construction and no polygonOffset can separate it. The
       header states this rule and proved it only for stain-versus-stain; the
       measured answer on the round-10 build was 363 overlapping pairs, 325 of
       them coplanar within 0.2mm. This is the check that would have found that
       on the day it shipped, and it is the check that stops the three fixes in
       sections 3 and 4 from quietly rotting.
     · is the build DETERMINISTIC? Two of this project's "regressions" were
       random draws. A rebuild has to be byte-identical, so verify() does one
       and compares the hash.

   ⚠ IT IS NOT FREE — the overlap scan is O(pairs in a cell) and the rebuild is
     a rebuild — so it is an on-demand check called once at boot, never per
     frame and never from refresh(). */
function bufHash(m) {
  if (!m) return '-';
  const a = m.geometry.getAttribute('position').array;
  const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16) + ':' + a.length;
}
/* 2D separating-axis test on the six edge normals, with a real epsilon.
   ⚠ THE EPSILON IS THE POINT, not a tolerance for float noise. Triangles that
     SHARE AN EDGE (the two halves of a wear band) or a VERTEX (neighbours in a
     stain fan) touch on a separating axis with exactly zero overlap and are
     not defects; without the epsilon every one of them reports. */
function triOverlap2D(A, B, eps) {
  for (let t = 0; t < 2; t++) {
    const T = t ? B : A;
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      const nx = T[j * 2 + 1] - T[i * 2 + 1], nz = -(T[j * 2] - T[i * 2]);
      const L = Math.hypot(nx, nz); if (L < 1e-9) continue;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (let k = 0; k < 3; k++) {
        const pa = A[k * 2] * nx + A[k * 2 + 1] * nz; if (pa < a0) a0 = pa; if (pa > a1) a1 = pa;
        const pb = B[k * 2] * nx + B[k * 2 + 1] * nz; if (pb < b0) b0 = pb; if (pb > b1) b1 = pb;
      }
      if (a1 < b0 + eps * L || b1 < a0 + eps * L) return false;
    }
  }
  return true;
}
function verify(opt) {
  if (!CTX || !group) return { ok: false, why: 'not mounted', problems: ['not mounted'] };
  const deep = !opt || opt.deep !== false;
  const { game, GRID, HALF, isRoad } = CTX;
  const APR = CTX.roadApron || 0.150;
  const problems = [];

  if (stats.refused === 'terrainAt')
    problems.push('the host published no NC_TERRAIN_AT, so NOTHING is drawn — the layer is ' +
                  'mounted, reports success and contributes no geometry at all');
  else if (stats.refused === 'groundAt')
    problems.push('the host published no NC_GROUND_AT, so the flat bucket (stains and kerb ' +
                  'wear) refused to draw — every blot would have had a hard edge');

  /* ── the occupancy map, once, as a byte per tile: 0 empty / 1 built / 2 road */
  const occ = new Uint8Array(GRID * GRID);
  for (const k in game.tiles) {
    const c = k.indexOf(','); if (c < 0) continue;
    const gx = +k.slice(0, c), gz = +k.slice(c + 1);
    if (gx >= 0 && gz >= 0 && gx < GRID && gz < GRID) {
      let road = false; try { road = !!isRoad(gx, gz); } catch (e) {}
      occ[gz * GRID + gx] = road ? 2 : 1;
    }
  }

  /* ── 1. STANDING GEOMETRY STAYS OFF OTHER PEOPLE'S GROUND ─────────────── */
  let onBuilt = 0, inApron = 0, minApron = Infinity;
  if (standMesh) {
    const P = standMesh.geometry.getAttribute('position').array;
    for (let i = 0; i < P.length; i += 3) {
      const u = P[i] + HALF, w = P[i + 2] + HALF;
      const gx = Math.floor(u), gz = Math.floor(w);
      if (gx < 0 || gz < 0 || gx >= GRID || gz >= GRID) continue;
      if (occ[gz * GRID + gx]) { onBuilt++; continue; }
      for (let q = 0; q < 18; q += 2) {
        const nx = gx + NB9[q], nz = gz + NB9[q + 1];
        if (nx < 0 || nz < 0 || nx >= GRID || nz >= GRID) continue;
        if (occ[nz * GRID + nx] !== 2) continue;
        const dx = Math.max(nx - u, 0, u - (nx + 1));
        const dz = Math.max(nz - w, 0, w - (nz + 1));
        const d = Math.hypot(dx, dz);
        if (d < minApron) minApron = d;
        if (d < APR) { inApron++; break; }
      }
    }
  }
  if (onBuilt) problems.push(onBuilt + ' standing vertices sit on a tile somebody built on — ' +
    'the layer is drawing over a recipe\'s own ground, which is the second-ground-pass z-fight');
  if (inApron) problems.push(inApron + ' standing vertices are inside a road apron (< ' +
    APR + ' from a road tile) — bushes standing in the paving, see CLR_ROAD');

  /* ── 2. NO TWO FLAT TRIANGLES OVERLAP ─────────────────────────────────── */
  let pairs = 0; const sample = [];
  if (flatMesh) {
    const P = flatMesh.geometry.getAttribute('position').array;
    const n = P.length / 9;
    const CELL = .25, buckets = new Map();
    const tri = new Float32Array(n * 6), box = new Float32Array(n * 4);
    for (let t = 0; t < n; t++) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let k = 0; k < 3; k++) {
        const x = P[t * 9 + k * 3], z = P[t * 9 + k * 3 + 2];
        tri[t * 6 + k * 2] = x; tri[t * 6 + k * 2 + 1] = z;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      box[t * 4] = x0; box[t * 4 + 1] = x1; box[t * 4 + 2] = z0; box[t * 4 + 3] = z1;
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
        for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
          const key = cx * 4096 + cz;
          let b = buckets.get(key); if (!b) buckets.set(key, b = []);
          b.push(t);
        }
    }
    const seen = new Set();
    for (const b of buckets.values()) for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) {
      const a = b[i], c = b[j];
      const key = a < c ? a * 100000 + c : c * 100000 + a;
      if (seen.has(key)) continue; seen.add(key);
      if (box[a * 4 + 1] <= box[c * 4] || box[c * 4 + 1] <= box[a * 4]) continue;
      if (box[a * 4 + 3] <= box[c * 4 + 2] || box[c * 4 + 3] <= box[a * 4 + 2]) continue;
      const TA = tri.subarray(a * 6, a * 6 + 6), TB = tri.subarray(c * 6, c * 6 + 6);
      if (!triOverlap2D(TA, TB, 2e-4)) continue;
      pairs++; if (sample.length < 4) sample.push([a, c]);
    }
    if (pairs) problems.push(pairs + ' pairs of FLAT triangles overlap out of ' + n +
      ' — they are all at surf()+LIFT on one material in one buffer, so every one of them ' +
      'is a coplanar z-fight that no polygonOffset can separate (sample ' +
      JSON.stringify(sample) + ')');
  }

  /* ── 3. A REBUILD IS BYTE-IDENTICAL ───────────────────────────────────── */
  let det = null;
  if (deep && !stats.refused) {
    const before = [bufHash(flatMesh), bufHash(standMesh)];
    build();
    const after = [bufHash(flatMesh), bufHash(standMesh)];
    det = before[0] === after[0] && before[1] === after[1];
    if (!det) problems.push('a rebuild of the same city produced a DIFFERENT buffer (' +
      before.join('/') + ' -> ' + after.join('/') + ') — something in the scatter is reading ' +
      'a source that is not the tile coordinates, and every road the player lays will ' +
      'reshuffle the vegetation in the whole city');
  }

  return { ok: problems.length === 0, problems,
           stats: Object.assign({}, stats, { meshes: (flatMesh ? 1 : 0) + (standMesh ? 1 : 0) }),
           checked: { standingVerts: standMesh ? standMesh.geometry.getAttribute('position').count : 0,
                      onBuilt, inApron,
                      nearestRoad: minApron === Infinity ? null : +minApron.toFixed(4),
                      flatTris: flatMesh ? flatMesh.geometry.getAttribute('position').count / 3 : 0,
                      overlapPairs: pairs, deterministic: det } };
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
  /* ⚠ THE SIGNATURE IS RESET, and it was not. `sig` is module state and
     refresh() short-circuits on it, so a SECOND mount() of the same city —
     which is what a hot reload, a preview canvas or a test harness does —
     handed back the first mount's stats and never called build() at all, with
     a brand-new empty group in the scene. Found by a harness that mounted
     three times to check the null-host refusals below and got three identical
     healthy answers, one of which should have been a refusal. */
  sig = '';
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
    verify,
    // for a driver / a cost report: what this layer actually cost, without
    // having to diff a whole-scene triangle count against another round.
    stats: () => Object.assign({}, stats, { meshes: (flatMesh ? 1 : 0) + (standMesh ? 1 : 0) }),
    group: () => group,
  };
  api.refresh();
  return api;
}
