/* ══ 🌊 THE OCEAN ══════════════════════════════════════════════════════════
   "WATER: ocean water on every player map. Players must connect their city
    to it."

   THIS FILE IS THE FIRST HALF OF THAT SENTENCE. It is the water you can SEE.

   ── WHY THERE WAS NO SEA, AND WHY THAT IS NOT THE SAME AS "NOBODY GOT ROUND
      TO IT" ────────────────────────────────────────────────────────────────
   /src/water is 2,000 lines of hydrology and it is a SIMULATION AND AN INFO
   VIEW. Its river is a sinusoidal centreline, its lakes are discs, and the only
   place either of them ever becomes pixels is a 576-px CanvasTexture that is
   `visible` exactly while the 💧 panel is open. Close the panel and the river
   is gone. There is not one square metre of 3D water anywhere in node-city's
   41,849 lines — no ocean, no shoreline, no water material — and
   /src/outside/tuning.js says so out loud where it defers the CS2 "water"
   connection: "neither has scenery to connect TO (there is no coast and no
   flight path on this map)".

   And a rolled river only exists above wetness 0.52. On a triangular wetness
   that is about 46% of cities: the majority of players have never had surface
   water at all.

   ── 🔴 THE FOUR THINGS THAT DECIDED THE SHAPE OF THIS LAYER ────────────────

   1. THE PLATE MAY NOT BE EATEN. node-city's map plate is displaced by
      AMP = ±9 mm and is clamped to −0.014 … +0.016 because EVERY building
      recipe lays a full-tile apron in that band. A sea is a hole and a hole is
      outside that envelope; there is no precedent in the file for a hole in the
      plate. And WATER.surface's own comment states the rule that settles it
      anyway: "SURFACE WATER DOES NOT BLOCK CONSTRUCTION, ON PURPOSE. Making a
      river tile unbuildable would retroactively invalidate buildings standing
      in EXISTING SAVES." A coast has that problem an order of magnitude worse.
      ⇒ The sea starts at HALF + 1.75 at its very closest and lives entirely on
        the PLAIN. tryPlace() is untouched, the plate is untouched, no save is
        invalidated, and this round refuses zero buildings.

   2. THE FOG IS THE REAL CONSTRAINT, NOT THE GEOMETRY. `medium` is the tier
      every non-WebGPU client boots at and it runs fog 25 → 34. From the default
      camera (14, 15, 14) looking at the origin, the FAR CORNER OF THE PLATE is
      already 39.7 units out, i.e. 100% haze. Worked against the frustum, the
      only ground outside the plate that is both in shot and inside the far stop
      is the strip EAST of the plate at roughly z ∈ [−10, +2] — the bottom right
      of the frame, 21–29 units from the lens.
      /src/outside/tuning.js records exactly this failure happening once
      already, at z = −19.6: "the thing you can see you are not yet joined to
      was invisible in the photograph". It is silent, and it is why the sea's
      side is a CONSTANT and not a per-city roll — see endowment.js's buildSea.

   3. THE PLAIN IS ALREADY SPOKEN FOR, NORTH AND SOUTH. HW.z = −18.8 with a
      12.0-wide embankment (toe −12.8); RAIL.z = +18.8 with a 5.2-wide one (toe
      +16.2); and node-city's perimeterScenery() fills Chebyshev 15…30 all the
      way round with houses, blocks and towers whose materials are
      FOG-EXEMPT — so they are fully visible however far out they are.
      ⇒ The z band is derived from those two toes, and the outskirts get an
        explicit exclusion. See `isSea` and the note at reperimeter() below.

   4. THE GROUND IS 2 MESHES AND 2 MATERIALS AFTER A DOCUMENTED 576-MESH
      REDUCTION. So is this: ONE swept lattice, ONE MeshStandardMaterial, ONE
      generated normal canvas, no new texture file, no network. Measured as an
      A/B inside one boot with renderer.render() between the reads — see
      `cost()` and .gauntlet/oceanshot.mjs.

   ── 🔴 THE GLOBALS TRAP (CLAUDE.md) ────────────────────────────────────────
   `THREE`, `scene`, `GRID`, `HALF`, `NC_TERRAIN_AT`, `NC_GROUND_AT` and
   `skyEnvRegister` are top-level bindings in node-city's module script and are
   NOT on `window`. The ctx object mount() takes IS the hand-over, copied from
   /src/wild's, which is the shipped precedent for a module that needs the
   terrain. Nothing below reaches for a bare global except the two
   `window.Mythic*` registrations, which are real window properties.

   ── 🔴 WHERE THE WATERLINE COMES FROM, AND WHY IT IS NOT IN THIS FILE ──────
   `window.MythicWater.endowment().sea.shoreAt(z)`. /src/water owns it, because
   /src/water is what answers "can a plant here draw the sea" — and if this
   module held its own copy the two would drift into a contradiction the player
   can SEE: open water on one side of a line the info view calls dry land.
   ⚠ AND IT IS READ THROUGH THE REGISTERED API, NOT BY IMPORTING endowment.js
     DIRECTLY. The hydrology is a pure function of a LATCHED city id — the first
     non-empty id MythicWater is ever given, which for a loaded city comes out
     of the SAVE and not out of whatever the host would derive today. A direct
     import cannot know that id. Reading through the API is what stops a
     player's coastline from moving when they link a second anchor node.
   ⚠ NO FALLBACK. If MythicWater is absent this module draws NOTHING and says
     which call it wanted, in the same idiom /src/wild refuses without
     terrainAt. A guessed coastline would be a second truth that renders
     perfectly and disagrees with the simulation forever — "a guarded fallback
     that fires forever looks exactly like a working feature".
   ══════════════════════════════════════════════════════════════════════════ */

import { OCEAN } from './tuning.js';
/* The two corridors the plain already carries. Imported rather than copied for
   the same reason the waterline is not copied: if the highway moves, the sea's
   north end must move with it, and a transcription is how it would not. This is
   a pure constants module — no side effects, no registration, no DOM. */
import { HW, RAIL } from '../outside/tuning.js';

let CTX = null;
let group = null, mesh = null, mat = null, ripple = null;
let sea = null;          // the endowment's sea body (tile units)
let band = null;         // { z0, z1 } world z limits, derived from HW / RAIL
let stats = newStats();
let drift = 0;

function newStats() {
  return { built: false, rows: 0, cols: 0, verts: 0, tris: 0,
           shoreMin: 0, shoreMax: 0, z0: 0, z1: 0, refused: null };
}

/* ── COORDINATES ──────────────────────────────────────────────────────────
   node-city maps a tile to the world as `world = tile − HALF + 0.5`, so the
   plate's east edge (world +HALF) is tile `GRID − 0.5`. endowment.js speaks
   tiles and has never seen a world coordinate; this is the ONE place the two
   frames meet, which is why both directions live on adjacent lines. */
const tileOf = (w) => w + CTX.HALF - 0.5;
const worldOf = (t) => t - CTX.HALF + 0.5;

/* The waterline in WORLD x at world z. One call into /src/water per row. */
function shoreWorldAt(wz) {
  if (!sea) return Infinity;
  return worldOf(sea.shoreAt(tileOf(wz)));
}

/* ── IS THIS POINT AT SEA? ────────────────────────────────────────────────
   The predicate node-city's perimeterScenery and /src/wild both consult, and
   the only thing this module exports that anybody else's geometry depends on.
   `margin` pushes the answer INLAND, so a caller can keep its own objects a
   stated distance back from the water rather than balancing on the waterline.
   ⚠ Answers false for everything when the layer refused to build. A module that
     did not draw the sea must not be able to delete the outskirts. */
function isSea(wx, wz, margin) {
  if (!stats.built || !sea || !band) return false;
  const m = Number(margin) || 0;
  if (wz < band.z0 - m || wz > band.z1 + m) return false;
  return wx >= shoreWorldAt(wz) - m;
}

/* ── 🌊 THE RIPPLE NORMAL MAP ─────────────────────────────────────────────
   Generated, not fetched: `public/` is the deploy root and a texture file is a
   request, a cache entry and a thing that can 404 into a flat mirror.
   Four gratings at incommensurate angles summed into a height field, then
   CENTRAL-DIFFERENCED into a tangent-space normal. Tileable by construction —
   every wave's period divides the canvas exactly, so wrapping is seamless and
   the RepeatWrapping below cannot show a seam.
   ⚠ THE BLUE CHANNEL IS THE +Z (UP) AXIS AND IT IS NEAR 255, NOT 128. A normal
     map stores (n+1)/2; a nearly-flat sea has n ≈ (0,0,1). Writing 128 there —
     the value the R and G channels take when flat — is the classic mistake and
     it produces a surface lit as if it were folded at 60°.
   ⚠ colorSpace stays the DEFAULT (no-colour-space) tag. A normal map is DATA,
     not colour; tagging it sRGB would run the transfer function over the
     vectors and bend every normal. node-city's own _skyEnvTex note is the same
     asymmetry seen from the other side. */
function makeRipple(THREE) {
  const N = OCEAN.mat.ripplePx, A = OCEAN.mat.rippleAmp;
  const h = new Float32Array(N * N);
  // [cycles across the canvas in x, in z, amplitude, phase]
  const WAVES = [[1, 0, 1.00, 0.0], [0, 1, 0.62, 1.7],
                 [2, 1, 0.44, 3.1], [1, -3, 0.26, 5.2]];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let v = 0;
    for (const [kx, kz, a, p] of WAVES)
      v += a * Math.sin(2 * Math.PI * (kx * i / N + kz * j / N) + p);
    h[j * N + i] = v * A;
  }
  const cv = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
  if (!cv) return null;
  cv.width = cv.height = N;
  const ctx2d = cv.getContext('2d');
  const img = ctx2d.createImageData(N, N);
  const at = (i, j) => h[((j + N) % N) * N + ((i + N) % N)];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    // central difference; the 0.5 is the two-sample span
    const dx = (at(i + 1, j) - at(i - 1, j)) * 0.5;
    const dz = (at(i, j + 1) - at(i, j - 1)) * 0.5;
    let nx = -dx, ny = -dz, nz = 1;
    const L = Math.hypot(nx, ny, nz) || 1;
    nx /= L; ny /= L; nz /= L;
    const o = (j * N + i) * 4;
    img.data[o]     = Math.round((nx * 0.5 + 0.5) * 255);
    img.data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
    img.data[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    img.data[o + 3] = 255;
  }
  ctx2d.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function clear() {
  if (mesh && group) {
    group.remove(mesh);
    try { mesh.geometry.dispose(); } catch (e) {}
    mesh = null;
  }
  stats = newStats();
}

/* ════════════════════════════════════════════════════════════════════════════
   THE BUILD — one swept lattice, one material, one draw call.
   ════════════════════════════════════════════════════════════════════════════ */
function build() {
  const { THREE, terrainAt, groundAt } = CTX;
  clear();

  /* ── 0. THE THREE HOST CALLS, AND WHY EACH MISSING ONE REFUSES ──────────
     Every one of these has an obvious quiet fallback and every one of those
     fallbacks ships the exact defect this layer exists to remove, which is the
     worst failure a fallback can have because the layer goes on reporting
     success. /src/wild's build() states the pattern; this is the same list.
       · MythicWater absent → a guessed coastline. Renders perfectly, disagrees
         with sourceAt() forever, and the player can SEE the disagreement.
       · terrainAt absent → the shore feather has no plate surface to sit
         against. It would still be flat water on a flat plain, but `verify()`
         could no longer prove the mesh clears the plate, so the one guarantee
         that keeps this round out of tryPlace() would be unprovable.
       · groundAt absent → the rim lerp is what dissolves the waterline. Without
         it the sea is a hard-edged blue shape laid ON the ground: word for word
         the round-5 critic's finding about the tree-base patches, which
         /src/wild's header quotes and designs against.
     ⚠ RECORDED, NOT JUST LOGGED. A console.warn at boot is a line nobody reads
       six rounds later; `stats.refused` is what verify() names. */
  const W = (typeof window !== 'undefined' && window.MythicWater) || null;
  const endow = (W && typeof W.endowment === 'function') ? W.endowment() : null;
  sea = (endow && endow.sea) || null;
  if (!sea || typeof sea.shoreAt !== 'function') {
    stats.refused = 'MythicWater.endowment().sea';
    console.warn('[Ocean] refusing to draw: no hydrology model published a sea, and a ' +
                 'coastline guessed here would disagree with sourceAt() forever');
    return 0;
  }
  if (!terrainAt) { stats.refused = 'terrainAt'; console.warn('[Ocean] refusing to draw: the host published no NC_TERRAIN_AT'); return 0; }
  if (!groundAt)  { stats.refused = 'groundAt';  console.warn('[Ocean] refusing to draw: the host published no NC_GROUND_AT, so the waterline would be a hard edge'); return 0; }

  /* ── 1. THE Z BAND, DERIVED FROM THE TWO EARTHWORKS ─────────────────────
     Not typed. `emb.bot` is the embankment's BASE width, so its toe sits at
     `z ± bot/2` — the same arithmetic /src/outside's own header does when it
     explains why HW.z is −18.8 and not −17.4. The sea stops a margin short of
     each toe, which is what makes the highway a coast road and the rail line a
     seawall rather than two things standing in the water. */
  band = {
    z0: HW.z + HW.emb.bot / 2 + OCEAN.extent.marginHighway,
    z1: RAIL.z - RAIL.emb.bot / 2 - OCEAN.extent.marginRail,
  };
  stats.z0 = band.z0; stats.z1 = band.z1;

  const R = OCEAN.mesh.rows, C = OCEAN.mesh.cols;
  const VR = R + 1, VC = C + 1;
  const nv = VR * VC;
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const uv  = new Float32Array(nv * 2);
  const col = new Float32Array(nv * 3);
  const idx = (nv > 65535 ? new Uint32Array(R * C * 6) : new Uint16Array(R * C * 6));

  const Y = OCEAN.extent.y;
  const FAR = OCEAN.extent.far;
  const per = OCEAN.mat.ripplePeriod;
  const cShallow = new THREE.Color().setHex(OCEAN.col.shallow);
  const cMid     = new THREE.Color().setHex(OCEAN.col.mid);
  const cDeep    = new THREE.Color().setHex(OCEAN.col.deep);
  const cGnd = new THREE.Color(), cOut = new THREE.Color();

  let shoreMin = Infinity, shoreMax = -Infinity;
  for (let j = 0; j < VR; j++) {
    const wz = band.z0 + (band.z1 - band.z0) * (j / R);
    const sx = shoreWorldAt(wz);
    if (sx < shoreMin) shoreMin = sx;
    if (sx > shoreMax) shoreMax = sx;
    /* How close this row is to one of the two ENDS, 0 at the end and 1 once it
       is a feather away from it. */
    const dEnd = Math.min(wz - band.z0, band.z1 - wz);
    const gEnd = clamp01(dEnd / OCEAN.ends.feather);

    for (let i = 0; i < VC; i++) {
      /* POWER-SPACED COLUMNS. u = 0 is exactly the waterline for THIS row,
         which is what makes the coast the geometry's own edge. */
      const u = Math.pow(i / C, OCEAN.mesh.columnBias);
      const wx = sx + (FAR - sx) * u;
      const v = j * VC + i, p = v * 3, q = v * 2;

      pos[p] = wx; pos[p + 1] = Y; pos[p + 2] = wz;
      nor[p] = 0;  nor[p + 1] = 1; nor[p + 2] = 0;
      /* ⚠ UV IS WORLD / period, NEVER a local 0..1. The lattice is non-uniform
         in x — a local uv would stretch the chop by 40× between the first
         column and the last, and the far water would read as a smear. Same rule
         /src/wild states for the plate's grain, applied to a different map. */
      uv[q] = wx / per; uv[q + 1] = wz / per;

      // ── DEPTH. Three stops, so the sea has a bar, a middle and a deep.
      const t = clamp01((wx - sx) / OCEAN.col.deepAt);
      if (t < 0.5) cOut.copy(cShallow).lerp(cMid, t * 2);
      else cOut.copy(cMid).lerp(cDeep, (t - 0.5) * 2);

      /* ── THE THREE FEATHERS. See OCEAN.shore / OCEAN.ends: a rim vertex
         carrying the GROUND'S OWN COLOUR is what dissolves a boundary, because
         Gouraud interpolates the difference away before the edge is reached.
         `groundAt` is exact on the plate and returns the plain's own target hex
         out here, which is the tone the plain arrives at within ~3% by the time
         it reaches the waterline — the same source the outskirts' HAZE uses. */
      const gShore = clamp01((wx - sx) / OCEAN.shore.width);
      const kShore = Math.pow(1 - gShore, OCEAN.shore.exp) * OCEAN.shore.blend;
      const kEnds  = (1 - gEnd) * OCEAN.ends.blend;
      const k = Math.max(kShore, kEnds);
      if (k > 0.001) { groundAt(wx, wz, cGnd); cOut.lerp(cGnd, Math.min(1, k)); }

      col[p] = cOut.r; col[p + 1] = cOut.g; col[p + 2] = cOut.b;
    }
  }

  /* ⚠ WINDING. In the XZ plane the intuitive order is clockwise seen from +Y,
     which produces a face pointing DOWN — back-face culled by the FrontSide
     default and lit from underneath. /src/parking lost a round to this, and
     /src/parcel and /src/wild both repeat the warning; it is repeated a fourth
     time because this is the same kind of buffer. Rows advance in +z and
     columns in +x, so (a, c, b) is the front-facing order. */
  let m = 0;
  for (let j = 0; j < R; j++) for (let i = 0; i < C; i++) {
    const a = j * VC + i, b = a + 1, c = a + VC, d = c + 1;
    idx[m++] = a; idx[m++] = c; idx[m++] = b;
    idx[m++] = b; idx[m++] = c; idx[m++] = d;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  /* ⚠ NORMALS ARE WRITTEN, NOT COMPUTED. Every vertex is at the same y, so
     computeVertexNormals() over this lattice is arithmetic on zero — it
     produces (0,1,0) after a pass over 2,178 vertices, or noise if a float
     ever wobbles. (0,1,0) is correct and free. The SURFACE detail is the normal
     map's job, which is the whole reason there is one. */
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();

  if (!ripple) ripple = makeRipple(THREE);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true,
      roughness: OCEAN.mat.roughness, metalness: OCEAN.mat.metalness,
      normalMap: ripple || null,
      normalScale: ripple ? new THREE.Vector2(OCEAN.mat.normalScale, OCEAN.mat.normalScale) : undefined,
      fog: true,
    });
    /* 🪞 The sky, if the host offered it. Guarded because the preview path and
       the WebGPU path both run without one, and a sea with no reflection is a
       duller sea — not a broken one. */
    try { if (CTX.skyEnvRegister) CTX.skyEnvRegister(mat, OCEAN.mat.envIntensity); } catch (e) {}
  }

  mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'ocean-surface';
  /* 🔴 NEITHER. The sea sits 20–100 units out, entirely outside SHADOW_SPAN, so
     a shadow pass over it would be paid and never seen — and a CASTING water
     plane would drop a hard rectangle of shade across the whole plain. This is
     also what keeps the cost at +1 draw call and not +2: /src/wild's own note
     records expecting a shadow-map draw for its standing bucket and measuring
     one less than it budgeted. */
  mesh.castShadow = false; mesh.receiveShadow = false;
  group.add(mesh);

  stats.built = true;
  stats.rows = R; stats.cols = C; stats.verts = nv; stats.tris = R * C * 2;
  stats.shoreMin = shoreMin; stats.shoreMax = shoreMax;
  return stats.tris;
}

/* ════════════════════════════════════════════════════════════════════════════
   THE API
   ════════════════════════════════════════════════════════════════════════════ */
const API = {
  ready: () => !!(mesh && stats.built),

  mount(h) {
    if (group) return API;
    CTX = h || {};
    const THREE = CTX.THREE;
    group = new THREE.Group();
    group.name = 'ocean';
    CTX.scene.add(group);
    build();
    /* 🏘 THE OUTSKIRTS HAVE TO BE ASKED AGAIN, AND THE ORDERING IS THE WHOLE
       REASON THIS CALL EXISTS.
       node-city runs perimeterScenery() at module top level — right after
       rdRng, ~29,000 lines before boot()'s dynamic imports — because its body
       reads a dozen top-level `const`s that are only initialised there. So the
       houses, blocks and towers of the Chebyshev 15…30 district are already
       merged into two meshes by the time an ES module can possibly exist, and
       those meshes are FOG-EXEMPT (see the note at their creation: `medium`
       pulls the fog in to 34 and the district would otherwise render as grey).
       Fog-exempt means a tower standing in the sea is fully, crisply visible.
       A predicate cannot fix that after the fact: the geometry is merged.
       So the host hands over a `reperimeter` callback and this is the ONE call
       to it, made once, only when the sea actually drew. perimeterScenery()
       was made idempotent for exactly this — it builds the new pair first and
       only then removes the old, so a throw halfway leaves the player's
       outskirts standing.
       🚫 REJECTED: moving perimeterScenery()'s call site into boot(). It builds
          ~33k triangles the player sees on frame one, and boot() is a long
          async function with a dozen awaits and a dozen catch blocks — moving
          it there makes "the outskirts exist" depend on all of them. */
    try { if (stats.built && CTX.reperimeter) CTX.reperimeter(); } catch (e) {}
    return API;
  },

  /* ── The per-frame drift. ONE texture offset, two adds. ─────────────────
     ⚠ IT IS A NO-OP WHEN THE MESH IS HIDDEN, which is what makes the A/B in
       cost() and in .gauntlet/oceanshot.mjs honest: an on/off/on comparison
       whose "off" leg was still advancing an offset would report the drift as
       the layer's contribution. */
  tick(dt) {
    if (!mat || !ripple || !mesh || !mesh.visible) return;
    const d = Math.min(0.25, Math.max(0, Number(dt) || 0));
    drift += d;
    ripple.offset.x = (drift * OCEAN.mat.driftX / OCEAN.mat.ripplePeriod) % 1;
    ripple.offset.y = (drift * OCEAN.mat.driftZ / OCEAN.mat.ripplePeriod) % 1;
  },

  /* Is this WORLD point at sea? `margin` pushes the answer inland. */
  isSea,
  /* The waterline in world x at world z — for anything that wants to stand
     BESIDE the water rather than merely off it. */
  shoreAt: (wz) => shoreWorldAt(wz),
  band: () => (band ? { z0: band.z0, z1: band.z1 } : null),
  group: () => group,
  stats: () => ({ ...stats }),

  /* ── 💰 THE COST, MEASURED AS AN A/B INSIDE ONE BOOT ────────────────────
     Never across two boots. capture.mjs's own header records the whole-scene
     mesh count moving by ±15 between boots, so a cross-boot delta of "+1 mesh"
     is well inside the instrument's own noise. The caller must hand over the
     renderer, the scene and the camera; this drives render() itself, because
     renderer.info is only meaningful after a real submit — and because
     .gauntlet/README.md item 6 records what an A/B with no render between the
     reads returns: a confident, wrong zero. */
  cost(renderer, scene, camera) {
    if (!renderer || !scene || !camera || !group) return null;
    const read = () => {
      renderer.render(scene, camera);
      const i = renderer.info;
      return { calls: i.render.calls, tris: i.render.triangles,
               geos: i.memory.geometries, tex: i.memory.textures };
    };
    const was = group.visible;
    group.visible = false; const off = read();
    group.visible = true;  const on  = read();
    group.visible = was;
    return { off, on,
             dCalls: on.calls - off.calls, dTris: on.tris - off.tris,
             dGeos: on.geos - off.geos, dTex: on.tex - off.tex };
  },

  /* 🔍 SELF-CHECK — reported only when it FAILS, the same idiom as
     MythicWild.verify() and MythicDistricts.verify(). It exists because this
     module's mount is `catch { console.warn('not mounted (non-fatal)') }` and
     nothing else, which makes "drew nothing", "drew the wrong thing" and "was
     never there" the same observation from the console.
     Every assertion below is one of the four constraints in the header, checked
     against the buffer that actually shipped rather than against the intention:
       1. ONE mesh, ONE material.
       2. NOT ONE VERTEX over the buildable plate. This is the guarantee that
          let this round leave tryPlace(), the plate and every save alone, so it
          is checked on the real positions and not on the tuning.
       3. The y is clear of every other flat plane in node-city's ground stack.
       4. The simulation agrees: a tile inside the sea's reach reports kind
          'sea', and one at the far side of the map does not. That is the check
          that would have caught a coastline drawn from a second truth. */
  verify() {
    const p = [];
    if (stats.refused) p.push('refused to draw: no ' + stats.refused);
    /* Not built is never ok — a refusal is a real answer and a healthy one, but
       it is not a drawn sea, and verify() is asked whether there is one. */
    if (!stats.built) return { ok: false, problems: p.length ? p : ['never built and no reason recorded'], stats: { ...stats } };

    if (!mesh || !group) p.push('no mesh');
    if (group && group.children.length !== 1) p.push('expected exactly 1 child, found ' + group.children.length);
    if (mesh && mesh.material !== mat) p.push('the mesh is not on the module material');

    // 2. nothing over the plate
    if (mesh) {
      const a = mesh.geometry.attributes.position.array;
      let minX = Infinity, minZ = Infinity, maxZ = -Infinity, ys = new Set();
      for (let i = 0; i < a.length; i += 3) {
        if (a[i] < minX) minX = a[i];
        if (a[i + 2] < minZ) minZ = a[i + 2];
        if (a[i + 2] > maxZ) maxZ = a[i + 2];
        ys.add(a[i + 1]);
      }
      if (!(minX > CTX.HALF)) p.push('a vertex at x=' + minX.toFixed(3) + ' is over the plate (HALF=' + CTX.HALF + ')');
      if (!(minX > CTX.HALF + 1.21)) p.push('the waterline at x=' + minX.toFixed(3) + ' is inside the ring road footway (HALF+1.21)');
      if (ys.size !== 1) p.push('the surface is not flat: ' + ys.size + ' distinct y values');
      // 3. clear of every other flat plane over the same ground
      const STACK = [['gridHelper', 0.0145], ['RD_Y', 0.016], ['hover', 0.020],
                     ['power overlay', 0.060], ['water overlay', 0.075]];
      for (const [name, y] of STACK)
        if (Math.abs(OCEAN.extent.y - y) < 0.005)
          p.push('sea y=' + OCEAN.extent.y + ' z-fights ' + name + ' at ' + y);
      // and clear of the two earthworks
      if (!(minZ > HW.z + HW.emb.bot / 2)) p.push('the sea reaches the highway embankment toe');
      if (!(maxZ < RAIL.z - RAIL.emb.bot / 2)) p.push('the sea reaches the rail embankment toe');
    }

    // 4. the simulation and the picture agree
    try {
      const W = window.MythicWater;
      if (W && sea) {
        const zt = Math.floor(CTX.GRID / 2);
        const east = W.sourceAt(CTX.GRID - 1, zt);
        const west = W.sourceAt(0, zt);
        if (!(east && (east.kind === 'sea' || east.salt || W.endowment().seaAt(CTX.GRID - 1, zt) > 0)))
          p.push('the east edge draws no sea while the mesh is drawn beside it');
        if (west && west.kind === 'sea')
          p.push('the WEST edge reports sea — the shoreline has crossed the map');
      }
    } catch (e) { p.push('could not cross-check MythicWater: ' + (e && e.message)); }

    return { ok: !p.length, problems: p, stats: { ...stats } };
  },

  tuning: OCEAN,
};

try {
  if (typeof window !== 'undefined') window.MythicOcean = API;
} catch (e) {}

export function mount(h) { return API.mount(h); }
export default API;
