/* ══ 🌑 CONTACT SHADOWS ════════════════════════════════════════════════════
   Rubric dimensions 2 (Lighting), 7 (Street furniture), 8 (Vehicles) and
   9 (Citizens), which is the whole reason this layer exists rather than a
   fourth pass at the shadow map.

   ── WHAT THE ROUND-19 CRITIC MEASURED ──────────────────────────────────────
   "Nothing below building scale casts a shadow. The ground band immediately
   down-sun of the isolated yellow pickup in the `venue` framing, y=432,
   x=361-455, runs L=126.4-133.4 — a 7-unit spread, which is the surface
   texture's own noise — with no notch anywhere."  Re-run and reproduced before
   a line of this was written: 126.3 … 133.4 over those 95 pixels, and the only
   two notches on the row belong to a bollard (x 417-420) and a shrub.

   ── 🔴 WHY THIS IS NOT BLOCKED BY ROUND 18'S REFUSAL ───────────────────────
   Round 18 swept the shadow map and REFUSED to change it, with numbers: over
   130 lamps the mast's signal-minus-control goes 0.25 -> 0.69 and it takes a
   6-unit frustum to double, i.e. a second cascade, which three r171 has no
   support for. That finding is about RESOLVING A 0.031-UNIT MAST IN A DEPTH
   MAP. Nothing here touches the depth map, the light rig, the frustum, the
   bias or the filter: the 58 px penumbra, the 2.0x key/fill ratio and the cool
   blue shadow colour that scored Lighting 7.0 are exactly as they were.
   Round 18's own closing note names the shape of this fix —
     "a contact/AO patch merged into B_SOLID at each prop's foot — free (same
      bucket, same material, no draw call), directionless and therefore correct
      at every hour — not a bigger map"
   — and this is that patch, with one correction to the bucket, argued below.

   ── ⭐ THE IDEA: THE DECAL IS A MULTIPLIER, NOT A COLOUR ────────────────────
   THREE.MultiplyBlending is dst = src x dst. A white texel changes nothing; a
   0.62 texel removes 38% of whatever radiance the surface under it already
   had. That single property answers four questions at once and is the reason
   this material was chosen over a black alpha decal:

     · NIGHT IS FREE AND CORRECT.  The brief asks what a decal does after dark,
       because "a hard black contact patch under everything at midnight is worse
       than none". A multiply has no colour of its own: at midnight the pavement
       is dim, so 0.62 x dim is a small ABSOLUTE change and the patch all but
       vanishes; inside a lamp pool, where the ground genuinely is lit and the
       occlusion genuinely is there, it comes back in proportion. Measured at
       hour 22 in the round report. A black alpha decal would have needed a
       nightAmt term — one more hand-tuned knob driving one more thing that is
       already a measured quantity.
     · NO STICKER.  The road file's own finding, in RD_WEAR's header: "a flat
       tint laid over a grained road reads as a sticker rather than as wear",
       which is why every wear band in the city is expressed as a MULTIPLIER of
       the road's own tone (T_TRACK 0.76) and not as a hex. A multiply decal
       darkens the grain that is already there — asphalt, paving slab, mown
       verge, bay line — instead of covering it.
     · IT DOES NOT CARE WHAT IS UNDER IT.  Which is what lets ONE mesh serve
       props standing on the footway (MAT.stone, no vertexColors), cars standing
       on a parking bay (bayMat) and agents on the carriageway (RD_WEAR). The
       round-18 note's "merged into B_SOLID" would have worked for the first
       group only, and only as an unmapped flat blob — see the bucket argument
       below.
     · WEATHER RIDES FOR FREE.  A storm dims the key; the patch dims with it,
       because it is a fraction and not a value.

   ⚠ AND THE VERTEX COLOUR IS THE LINEAR TRAP AGAIN, WEARING A NEW HAT.
     CLAUDE.md: "a vertex colour is LINEAR — Color.setHex() converts sRGB->linear,
     a literal does not." Here the conversion runs the OTHER way and it still
     bites. The renderer is ACESFilmic + SRGBColorSpace, so a fragment is
     tone-mapped and then sRGB-ENCODED before it reaches the blend unit — and
     the blend unit is where a multiply happens. So the number that actually
     multiplies the frame buffer is encode(v), not v.
       · toneMapped:false is REQUIRED, not a nicety. A mask is not a radiance;
         run 0.35 through ACES and the multiply becomes ~0.30, i.e. the decal
         gets a curve applied to it that was designed for light.
       · the DISPLAY multipliers are the numbers in M_* below, and each is
         converted ONCE by _lin() into the linear value the attribute carries.
         Write 0.62 into a vertex colour by hand and you get a 0.80 multiply,
         which is a third of the shadow you asked for.

   ── ⚖ STATIC AND MOVING ARE DIFFERENT PROBLEMS, AND ARE SOLVED DIFFERENTLY ──
   A bollard never moves. A pedestrian and a car move every frame. The brief is
   right that these do not have one answer:

     STATIC  (street furniture, parked vehicles, the standing crowd)
       One merged, vertex-coloured, non-instanced mesh for the WHOLE CITY,
       rebuilt only when the tile signature changes — the same lifecycle
       /src/parking and /src/crowd already ride through manageAgents(), which
       every path that changes the city already funnels through. MEASURED on the
       standard district: 299 patches — 181 street-furniture feet, 40 parked
       cars, 78 standing figures — 10,764 triangles, ONE mesh, ONE draw call,
       and no per-frame work at all except the gated sun rewrite below.
       ⚠ AND IT IS DIRECTIONLESS ON PURPOSE — a centred contact/AO patch, not a
         cast shape offset down-sun. The brief asks for an azimuth offset and
         this layer deliberately declines it, for the reason round 18 already
         wrote down: the static bucket is rebuilt on TILE CHANGES, and the sun
         moves on the CLOCK. An offset baked at build time is wrong at every
         other hour of the day and would visibly disagree with the real shadow
         the building next to it is casting from the depth map. Rebuilding
         5,000 vertices every time the sun moves to buy an offset under a
         0.03-unit bollard is not a trade. What a bollard occludes is the SKY
         DOME, all round, and that is a circular patch at its foot.
     MOVING  (every live agent — civilians, cars, trucks, patrols, transit)
       One InstancedMesh, one instance per agent, matrices rewritten in
       agentTick(). ~29 instances, one draw call. This bucket IS offset along
       the sun's azimuth and IS elongated by the sun's elevation, because it is
       recomputed every frame anyway and the offset therefore costs a sin and a
       cos rather than a rebuild — and a moving car is big enough and travels
       far enough for the direction to read.

   ── 💰 COST, HONESTLY ──────────────────────────────────────────────────────
   /src/crowd is the model to beat: +24 meshes for 78 figures. This is
   +2 MESHES AND +2 DRAW CALLS FOR THE ENTIRE CITY — every lamp, bin, hydrant,
   bollard, planter, bench, cabinet, junction sign and bus shelter, every parked
   car, every standing figure and every moving agent.
   Measured with .gauntlet/layer-ab.mjs (one boot, render and read in the same
   task, do-nothing control exactly 0.000%), hour 15, weather Clear:
       draw calls  +2        (2,242 -> 2,244)
       triangles   +11,592   (555,835 -> 567,427, i.e. +2.1%)
       meshes      2         contact-static + contact-agents
   of which 10,764 triangles are the 299 static patches and the rest is one
   instance per live agent at 36 triangles each.
   Rejected on cost grounds, and each of these was the obvious first idea:
     ⚠ REJECTED — a quad per object with its own mesh. ~370 objects, ~370 draw
       calls (740 with the shadow pass). That is the failure the brief names.
     ⚠ REJECTED — a 7th bucket (B_SHADE) inside makeRoad. It is where the
       geometry naturally wants to live, and it costs ONE DRAW CALL PER ROAD
       TILE — 130 of them on the standard district. r1_road.js's own round-3
       header sets that as the binding limit: "Round 4 adds detail, never a
       draw call". It also cannot reach a parked car or an agent, so half the
       feature would still have needed this module.
     ⚠ REJECTED — merging into B_SOLID, which is round 18's own suggestion.
       B_SOLID is RD_SOLID: UNMAPPED, opaque, MeshStandardMaterial. A dark
       opaque patch there is a flat untextured blob laid on a mapped footway —
       the exact sticker RD_WEAR's header forbids — it cannot be soft (an
       opaque patch has to end at SOME colour, and the colour it must end at is
       whatever it happens to be standing on, which differs per surface), and
       it is unreachable for anything that moves.
     ⚠ REJECTED — per-instance darkness via InstancedMesh.setColorAt(). three
       multiplies instanceColor into vColor, so it scales the RIM vertices too;
       the rim is 1.0 precisely so that the patch fades to nothing, and scaling
       it puts a hard-edged disc back. One darkness for the whole moving bucket,
       with SIZE carrying the difference between a pedestrian and a truck.

   ── 🔴 THE GLOBALS TRAP ────────────────────────────────────────────────────
   `game`, `scene`, `THREE`, `MAT`, `RD_PT`, `RD_Y`, `HALF` and `sun` are all
   top-level `const` in node-city/index.html. They are lexical globals and are
   NOT on `window`. The ctx object mount() takes IS the hand-over, exactly as
   /src/parking and /src/crowd do it.

   ── WHERE THE PATCHES COME FROM: CAPTURED, NEVER RE-DERIVED ────────────────
   /src/parking's header: "a second copy of that roll is exactly how two layers
   drift apart". Every prop on a road tile is chosen by a seeded roll inside
   makeRoad, and re-rolling it here would put shadows under furniture that is
   not there. So makeRoad DECLARES its feet — one rdFoot() call beside each prop
   it already emits — into `g.userData.contacts`, and this module harvests them
   off the placed mesh. Parked cars come from MythicParking.spots() and standing
   figures from MythicCrowd.spots(), both of which already existed for exactly
   this kind of reader.

   ── DETERMINISM ────────────────────────────────────────────────────────────
   No Math.random anywhere in this file, and nothing to seed: every patch's
   position, size and darkness is a pure function of the object it belongs to.
   Three "regressions" in this project's history were random draws.
   ══════════════════════════════════════════════════════════════════════════ */

const SEG = 12;            // segments around a patch. 12 is smooth at the
                           // venue and frontage framings and costs 36 tris.
const RING = 0.55;         // inner ring radius as a fraction of the outer. The
                           // patch has a CORE and then a ramp; one cone from a
                           // single centre vertex reads as a spotlight, not as
                           // contact.

/* Display-space multipliers. See the linear-trap note in the header: these are
   what the frame buffer gets multiplied by, and _lin() converts each ONCE.
   They are deliberately mild against what the shadow map already does — round
   18 measured a tree's own cast shadow at 5.15x darkening and a building's at
   3.12x, so a 1.6x contact patch sits well under the darkest thing in frame and
   cannot be mistaken for a second, competing light. Measured in round 20 on a
   sunlit paving slab: 213 -> 132, i.e. 0.62 exactly as written. */
const M_PROP  = 0.62;      // street furniture: lamp, bin, hydrant, bollard, …
const M_FIG   = 0.62;      // a standing figure
const M_CAR   = 0.55;      // a parked vehicle — bigger mass, closer to the ground
const M_AGENT = 0.58;      // every moving agent, one value (see the rejection
                           // of per-instance colour in the header)
const M_MID   = 0.14;      // how much of the way back toward 1.0 the inner ring
                           // has come. Small: the core is meant to be a core.

/* Heights. Each is "just clear of the surface this patch's object stands on",
   and both surfaces are named constants in r1_road.js rather than guesses.
     · every STATIC patch sits on the footway/verge band, whose top is RD_PT
       (0.046) — the lamp is at tile-local (.36,.36), the three prop corners at
       ±.40, the shelter at ±.42, a parking bay at BAY_LAT .355 and a standing
       figure at KERB_LAT/FOOT_LAT, and the verge slab's top is RD_PT too. The
       highest thing already drawn in that band is a parking bay's end line at
       RD_PT+.0030, so +.0045 clears everything with 1.5mm to spare.
     · every MOVING agent is on the CARRIAGEWAY. r1_road.js: spawnAgent gives a
       civilian `lateral: (Math.random()-.5)*.34`, so pedestrians walk a ±0.17
       band about the centreline and the kerb face is at RD_HW = 0.20 — NOBODY
       walks on the footway, which is why one height serves the whole fleet. The
       tallest thing on the carriageway is the gully grate at RD_DY
       (RD_Y+.0072); +.010 clears it. */
const Y_STATIC = 0.0045;   // above RD_PT
const Y_AGENT  = 0.0100;   // above RD_Y

const MAX_AGENTS = 96;     // instance capacity. AGENTS.civMax/carMax/truckMax/
                           // policeMax plus transit is well inside this; the
                           // count is CLAMPED rather than grown, because
                           // resizing an InstancedMesh drops its buffer.

/* ── ☀ HOW FAR DOWN-SUN A PATCH REACHES, AND WHY IT IS CAPPED ──────────────
   A cast shadow's length is H / tan(elevation), and that is the number used —
   read off the light itself, never re-derived from the clock. But it is capped,
   and the cap is the honest half of this design:

     A LAMP MAST IS 0.031 UNITS WIDE AND 0.55 TALL. At the pinned hour the sun
     is 28.2 degrees up, so H/tan gives 1.03 world units — a shadow one whole
     tile long. Drawn as this layer draws it, that would be a 0.16-wide dark bar
     a tile long coming off all 74 lamps: not a lamp's shadow, which is a
     hairline, but a smear that claims to be one. Round 18 refused a second
     cascade for the same object and its note is right that what a mast really
     contributes at this scale is OCCLUSION AT ITS FOOT.

   So the patch stretches down-sun until it reaches MAX_STRETCH times its own
   across-sun width, and then stops. For a car (0.15 across, 0.19 tall) the
   physical length binds at 0.36 and the cap never fires: a car gets a real,
   directional, car-length shadow. For a lamp, a sign post or a standing figure
   the CAP binds, and what they get is a short directed smudge that says where
   the light is coming from without pretending to be a silhouette.
   ⚠ AND IT IS ANCHORED, NOT OFFSET. The ellipse's UP-SUN edge stays on the
     object's foot and only the down-sun edge travels; the centre moves half as
     far. An offset that translated the whole patch would detach it from the
     object at low sun, and a shadow lying next to a car rather than under it
     reads as a second object — worse than no shadow at all. */
const MAX_STRETCH = 2.6;

let CTX = null, group = null, sig = '';
let statMesh = null, dynMesh = null;
let nBase = 0, nAlways = 0, nAll = 0;   // drawRange stops — see setNight
let liveAgents = 0;
/* The static patches, kept as PARAMETERS and not only as vertices, because the
   sun moves and the down-sun stretch has to be re-applied without re-harvesting
   the city. One rewrite of ~8k positions, gated on the sun actually having
   moved — see applySun for why that is affordable and a rebuild is not. */
let PARAMS = [], POS = null;
const _sun = { dx: 0, dz: 0, stretch: 1, lit: -1 };
const _stat = { props: 0, cars: 0, figs: 0 };

/* sRGB -> linear, the same curve THREE.Color.setHex() applies, written out
   because the value we have is a MULTIPLIER and pushing it through
   new THREE.Color() would work but read as if it were a colour. It is not: it
   is "how much of the frame survives". */
const _lin = (c) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

/* ── ⭐ THE ONE PIECE OF GEOMETRY IN THIS FILE ──────────────────────────────
   Every patch, static or moving, is the SAME shape: an ellipse expressed in the
   SUN'S frame, anchored at the object's foot, stretched down-sun.

   The object's own footprint is an ellipse (rx along it, rz across it, spun by
   `rot`), and what a shadow needs is that footprint measured along and across
   the SUN — so ψ = sunAngle − rot and the two support radii are

       along  = hypot(rx·cosψ, rz·sinψ)      across = hypot(rx·sinψ, rz·cosψ)

   which is exact for an ellipse and costs one sin and one cos. That is what
   makes a broadside car's shadow wide and an end-on car's shadow narrow WITHOUT
   a second code path, and what makes the whole thing degenerate correctly to
   the object's own footprint when the sun is down (L = 0).
   ⚠ THIS IS ALSO WHY THE MOVING BUCKET CAN BE ONE InstancedMesh. The result is
     a translate + a rotate + a non-uniform scale of one unit circle — i.e. an
     affine map — so the instanced version is the same maths written as a
     Matrix4 and the two buckets cannot drift apart. */
function sunFrame(rx, rz, rot, h, sunAng, stretch, lit) {
  const p = sunAng - rot, cp = Math.cos(p), sp = Math.sin(p);
  const along = Math.hypot(rx * cp, rz * sp);
  const across = Math.hypot(rx * sp, rz * cp);
  const L = Math.min(h * stretch, MAX_STRETCH * across) * lit;
  return { a: along + L * 0.5, b: across, c: L * 0.5 };
}

/* One patch's 25 positions, written into the Float32Array `P` at float offset
   `o`. Called once per patch at build and again, for every static patch, each
   time applySun decides the sun has moved far enough to matter. */
function writePatch(P, o, x, y, z, fr, sunAng) {
  const cs = Math.cos(sunAng), sn = Math.sin(sunAng);
  // the centre, already walked half-way down-sun
  const cx = x + cs * fr.c, cz = z + sn * fr.c;
  P[o] = cx; P[o + 1] = y; P[o + 2] = cz;
  let k = o + 3;
  for (let ring = 0; ring < 2; ring++) {
    const f = ring === 0 ? RING : 1;
    for (let i = 0; i < SEG; i++) {
      const ang = (i / SEG) * Math.PI * 2;
      const ux = Math.cos(ang) * fr.a * f, uz = Math.sin(ang) * fr.b * f;
      P[k] = cx + ux * cs - uz * sn; P[k + 1] = y; P[k + 2] = cz + ux * sn + uz * cs;
      k += 3;
    }
  }
}

/* The colours and the indices, which never change once built. */
function writeShade(C, o, m) {
  const core = _lin(m), mid = _lin(m + (1 - m) * M_MID);
  C[o] = C[o + 1] = C[o + 2] = core;
  let k = o + 3;
  for (let i = 0; i < SEG; i++, k += 3) C[k] = C[k + 1] = C[k + 2] = mid;
  for (let i = 0; i < SEG; i++, k += 3) C[k] = C[k + 1] = C[k + 2] = 1;
}
function pushIndex(I, base) {
  const r0 = base + 1, r1 = base + 1 + SEG;
  /* ⚠ WINDING. /src/parking's own note, learned the expensive way: in the XZ
     plane the intuitive order is CLOCKWISE seen from +Y, which back-face culls
     the whole layer against a FrontSide material and hands it a −Y normal into
     the bargain. Twenty parked cars once rendered correctly on twenty invisible
     bays. Both loops below are the reverse of the intuitive one; flip either
     and the shadows vanish. */
  for (let i = 0; i < SEG; i++) {
    const a = r0 + i, b = r0 + (i + 1) % SEG;
    const c = r1 + i, d = r1 + (i + 1) % SEG;
    I.push(base, b, a);
    I.push(a, b, d, a, d, c);
  }
}
const VPP = 1 + SEG * 2;   // vertices per patch

/* The unit patch for the instanced (moving) bucket: a circle of radius 1 at
   y = 0. The instance matrix carries the whole sunFrame() result — position,
   sun angle and the two semi-axes — so nothing here is per-object. */
function unitPatch(THREE) {
  const P = new Float32Array(VPP * 3), C = new Float32Array(VPP * 3), I = [];
  writePatch(P, 0, 0, 0, 0, { a: 1, b: 1, c: 0 }, 0);
  writeShade(C, 0, M_AGENT);
  pushIndex(I, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  g.setIndex(I);
  /* No normals: the material is MeshBasicMaterial and never reads one. On the
     static buffer that is ~8,000 unused vec3s saved; here it is the principle. */
  return g;
}

/* ── harvesting ────────────────────────────────────────────────────────────
   Nothing below re-derives a roll. Road furniture is read off the placed mesh's
   own declaration; cars and figures off the two modules that own them. */
function harvest() {
  const { game } = CTX;
  const out = { props: [], cars: [], figA: [], figD: [] };

  /* ⚠ SORTED. A merged buffer whose contents depend on Object key order is a
     buffer that can differ between a fresh boot and a loaded save; /src/crowd
     sorts for the same reason (its archetype draw is stratified over
     consecutive seeds). Here it costs nothing and it makes an A/B honest. */
  for (const k of Object.keys(game.tiles).sort()) {
    const t = game.tiles[k];
    if (!t || !t.mesh || t.type !== 'road') continue;
    const list = t.mesh.userData && t.mesh.userData.contacts;
    if (!list || !list.length) continue;
    /* WORLD POSITION OFF THE PLACED MESH, never re-derived from the tile key.
       placeMeshAt owns the tile->world mapping — refreshRoad reads the lamp's
       world position back the same way, and for the same reason: a second copy
       of that mapping drifts the first time it changes. */
    const wx = t.mesh.position.x, wz = t.mesh.position.z;
    for (const c of list)
      out.props.push({ x: wx + c.x, z: wz + c.z, rx: c.rx, rz: c.rz, rot: c.rot || 0,
                       h: c.h || 0.10, m: M_PROP });
  }

  try {
    const P = window.MythicParking;
    if (P && P.spots) for (const s of P.spots()) {
      /* A vehicle is .383 long x .19 wide before CAR_SCALE 1.2 — so .46 x .23,
         and .19 tall at the roof. The footprint is a shade wider than the body
         on both axes because what this stands for is the occlusion under a car,
         which reaches past the sills; a patch NARROWER than the object above it
         reads as a hole in the road rather than as shade. */
      out.cars.push({ x: s.x, z: s.z, rx: 0.26, rz: 0.13, rot: s.rot || 0, h: 0.19, m: M_CAR });
    }
  } catch (e) {}

  try {
    const C = window.MythicCrowd;
    if (C && C.spots) for (const s of C.spots()) {
      /* 🌙 DAY-ONLY FIGURES GO IN THEIR OWN LIST so they can be dropped with a
         drawRange rather than a second mesh — see setNight. A patch left on the
         pavement under a figure that has gone home for the night is a dark spot
         with nothing standing in it, and inside a lamp pool that IS visible. */
      const e = { x: s.x, z: s.z, rx: 0.062, rz: 0.062, rot: 0, h: 0.35, m: M_FIG };
      (s.day ? out.figD : out.figA).push(e);
    }
  } catch (e) {}
  return out;
}

function clearStatic() {
  if (!statMesh) return;
  group.remove(statMesh);
  try { statMesh.geometry.dispose(); } catch (e) {}
  statMesh = null; POS = null; PARAMS = [];
}

/* ☀ Re-lay every static patch for the sun's current azimuth and elevation.
   ⚠ THIS IS WHY THE STATIC BUCKET IS ALLOWED TO BE DIRECTIONAL AT ALL, and it
     is the one place this file departs from round 18's note (which proposed a
     directionless patch precisely because it would otherwise have to be rebuilt
     as the sun moved). The note assumed a REBUILD — re-harvesting the city,
     re-merging, re-uploading. This is not that: the topology, the indices and
     the vertex colours are built once and never touched, and only the ~8,000
     positions are rewritten. Measured against the alternative: a full rebuild
     walks every tile in game.tiles and every entry of two other modules'
     spots(); this walks one flat array.
   ⚠ AND IT IS GATED. `estClock` runs on wall time, so the azimuth moves about
     15 degrees per REAL hour — roughly 0.017 degrees per animation frame. The
     epsilon below fires the rewrite about once every four minutes of play. A
     per-frame rewrite would be affordable too, but "affordable" is not a reason
     to do work. */
function applySun(dx, dz, stretch, lit) {
  if (!statMesh || !POS) return false;
  if (Math.abs(dx - _sun.dx) < 0.02 && Math.abs(dz - _sun.dz) < 0.02 &&
      Math.abs(stretch - _sun.stretch) < 0.05 && Math.abs(lit - _sun.lit) < 0.03) return false;
  _sun.dx = dx; _sun.dz = dz; _sun.stretch = stretch; _sun.lit = lit;
  const sunAng = Math.atan2(dz, dx);
  const y = CTX.RD_PT + Y_STATIC;
  for (let i = 0; i < PARAMS.length; i++) {
    const p = PARAMS[i];
    writePatch(POS, i * VPP * 3, p.x, y, p.z,
               sunFrame(p.rx, p.rz, p.rot, p.h, sunAng, stretch, lit), sunAng);
  }
  statMesh.geometry.attributes.position.needsUpdate = true;
  statMesh.geometry.computeBoundingSphere();
  return true;
}

function build() {
  const { THREE, decalMat } = CTX;
  clearStatic();
  const h = harvest();
  /* ORDER IS LOAD-BEARING: props and cars, then the figures that stand at every
     hour, then the day-only half. setNight() is one integer write into
     drawRange because of this ordering and nothing else. */
  PARAMS = h.props.concat(h.cars);
  const iBase = PARAMS.length;
  PARAMS = PARAMS.concat(h.figA);
  const iAlways = PARAMS.length;
  PARAMS = PARAMS.concat(h.figD);
  _stat.props = h.props.length; _stat.cars = h.cars.length; _stat.figs = h.figA.length + h.figD.length;
  const N = PARAMS.length;
  nBase = iBase * SEG * 9; nAlways = iAlways * SEG * 9; nAll = N * SEG * 9;
  if (!N) return 0;

  POS = new Float32Array(N * VPP * 3);
  const C = new Float32Array(N * VPP * 3), I = [];
  const y = CTX.RD_PT + Y_STATIC;
  for (let i = 0; i < N; i++) {
    const p = PARAMS[i];
    // built flat (lit = 0, i.e. a plain contact patch); applySun lays the
    // stretch on at the first tick and whenever the sun has moved since.
    writePatch(POS, i * VPP * 3, p.x, y, p.z, sunFrame(p.rx, p.rz, p.rot, p.h, 0, 1, 0), 0);
    writeShade(C, i * VPP * 3, p.m);
    pushIndex(I, i * VPP);
  }
  _sun.lit = -1;   // force the first applySun through

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(POS, 3));
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  g.setIndex(I);
  g.attributes.position.setUsage(THREE.DynamicDrawUsage);
  g.computeBoundingSphere();
  statMesh = new THREE.Mesh(g, decalMat);
  statMesh.castShadow = false; statMesh.receiveShadow = false;
  /* One buffer spans the district, so its bounding sphere IS the district and
     culling it can only ever be wrong in the expensive direction — the same
     call and the same reason as /src/crowd's merged buckets. */
  statMesh.frustumCulled = false;
  statMesh.name = 'contact-static';
  group.add(statMesh);
  return N;
}

/* ── the moving bucket ─────────────────────────────────────────────────────
   Called once per agentTick, which is once per frame. Everything here is a
   handful of multiplies per agent; there is no allocation and no upload beyond
   the instance matrix itself (96 x 16 floats worst case, 6 KB). */
const _m = { mat: null, vec: null };
function tickAgents(agents, sun) {
  if (!dynMesh || !agents) return 0;
  const { THREE, RD_Y } = CTX;
  const M = _m.mat || (_m.mat = new THREE.Matrix4());
  const V = _m.vec || (_m.vec = new THREE.Vector3());
  const y = RD_Y + Y_AGENT;

  /* THE SUN'S AZIMUTH, AND HOW FAR DOWN IT PUSHES A SHADOW. updateSky() puts
     the light on a circle about the orbit target, so the direction a shadow
     RUNS is (target − position) flattened into XZ, and the length for an object
     of height H is H/tan(elevation). Read off the light itself rather than
     recomputed from the clock: a second copy of the sun's position is a copy
     that disagrees the first time updateSky changes. */
  let dx = 1, dz = 0, stretch = 1, lit = 0;
  if (sun && sun.target) {
    const px = sun.position.x - sun.target.position.x;
    const py = sun.position.y - sun.target.position.y;
    const pz = sun.position.z - sun.target.position.z;
    const hor = Math.hypot(px, pz);
    if (hor > 1e-4 && py > 1e-4) {
      dx = -px / hor; dz = -pz / hor;
      stretch = hor / py;                       // = 1/tan(elevation)
    }
    /* ☀ NO SUN, NO DIRECTION. sun.intensity is already 0 at night and
       sun.castShadow already false, so a patch that kept its daytime stretch
       after dark would be the only thing left in the city still claiming a key
       light. `lit` takes the stretch to 0 as the key goes out and every patch
       relaxes to the plain contact patch the round-18 note describes — which,
       under a street lamp more or less overhead, is also the correct one. */
    lit = Math.max(0, Math.min(1, (sun.intensity || 0) / 0.6));
  }
  applySun(dx, dz, stretch, lit);              // gated; see its header
  const sunAng = Math.atan2(dz, dx);

  let n = 0;
  for (let i = 0; i < agents.length && n < MAX_AGENTS; i++) {
    const a = agents[i];
    if (!a || !a.mesh || a.state === 'inside' || a.mesh.visible === false) continue;
    const civ = a.kind === 'civilian';
    /* A civilian is ~.07 across; a vehicle is .46 long x .23 wide at its own
       1.2 scale and .19 tall. Same "a shade wider than the body" rule as the
       parked fleet above, and the same reason. */
    const rx = civ ? 0.062 : 0.26, rz = civ ? 0.062 : 0.13, H = civ ? 0.35 : 0.19;
    const fr = sunFrame(rx, rz, a.mesh.rotation.y, H, sunAng, stretch, lit);
    M.makeRotationY(-sunAng);   // −: a Matrix4 rotation about +y is the opposite
                                // sense to atan2(z, x) in the XZ plane, which is
                                // why the static writer multiplies by hand.
    M.scale(V.set(fr.a, 1, fr.b));
    M.setPosition(a.mesh.position.x + Math.cos(sunAng) * fr.c, y,
                  a.mesh.position.z + Math.sin(sunAng) * fr.c);
    dynMesh.setMatrixAt(n, M);
    n++;
  }
  /* ⚠ COUNT, NOT VISIBILITY. Instances past `count` are never submitted, so a
     despawned agent's patch cannot be left lying in the road — and the buffer
     itself is never resized, which is what would drop it mid-frame. */
  dynMesh.count = n;
  dynMesh.instanceMatrix.needsUpdate = true;
  liveAgents = n;
  return n;
}

function signature() {
  const { game } = CTX;
  let h = 0, n = 0;
  for (const k in game.tiles) {
    const ty = game.tiles[k].type; n++;
    for (let i = 0; i < k.length; i++) h = (Math.imul(h, 31) + k.charCodeAt(i)) | 0;
    for (let i = 0; i < ty.length; i++) h = (Math.imul(h, 33) + ty.charCodeAt(i)) | 0;
  }
  /* …AND THE TWO LAYERS THIS ONE READS. /src/crowd already carries parking's
     count in its own signature for exactly this reason: on a load where a layer
     mounts after the first refresh the tiles are unchanged, and a signature
     that watched only tiles would keep shadows under cars and figures that have
     since moved. */
  let b = 0, c = 0;
  try { b = window.MythicParking ? window.MythicParking.count() : 0; } catch (e) {}
  try { c = window.MythicCrowd ? window.MythicCrowd.count() : 0; } catch (e) {}
  return h + ':' + n + ':' + b + ':' + c;
}

export function mount(ctx) {
  CTX = ctx;
  const { THREE, scene, decalMat } = ctx;
  group = new THREE.Group(); group.name = 'contact'; scene.add(group);

  dynMesh = new THREE.InstancedMesh(unitPatch(THREE), decalMat, MAX_AGENTS);
  dynMesh.castShadow = false; dynMesh.receiveShadow = false;
  dynMesh.frustumCulled = false;
  dynMesh.count = 0;
  dynMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  dynMesh.name = 'contact-agents';
  group.add(dynMesh);

  const api = {
    refresh() {
      const s = signature();
      if (s === sig) return PARAMS.length;
      sig = s;
      return build();
    },
    tickAgents,
    /* 🌙 ONE INTEGER WRITE, NO SECOND MESH. The whole reason harvest() splits
       the crowd into figA/figD and build() lays them down last: severe weather
       empties the pavement and dusk sends half of it home, exactly as
       /src/crowd's own setNight does, and drawRange can express both because
       the two groups are contiguous tails of one buffer.
       ⚠ It is NOT what makes the layer behave at night — the multiply blend is
         (see the header). This is only about patches whose OBJECT has gone. */
    setNight(night, severe) {
      if (!statMesh) return;
      statMesh.geometry.setDrawRange(0, severe ? nBase : night ? nAlways : nAll);
    },
    counts: () => ({ props: _stat.props, cars: _stat.cars, figures: _stat.figs,
                     agents: liveAgents, patches: PARAMS.length }),
    sun: () => ({ dx: _sun.dx, dz: _sun.dz, stretch: +_sun.stretch.toFixed(3), lit: +_sun.lit.toFixed(3) }),
    meshes: () => (statMesh ? 1 : 0) + (dynMesh ? 1 : 0),
    group: () => group,
  };
  api.refresh();
  return api;
}
