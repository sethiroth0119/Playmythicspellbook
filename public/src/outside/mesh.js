/* ============================================================================
   🛣 OUTSIDE CONNECTIONS — the geometry.
   ============================================================================
   Everything here is authored in WORLD space and lives in one group the module
   owns, because none of it belongs to a tile:

     • the HIGHWAY runs past the map whether or not the player ever joins it —
       it is the thing you can see you are not yet connected to;
     • the RAMPS belong to the interchange but reach ~9 units off the plate,
       and a tile mesh is rotatable (see canRotate in index.html), so authoring
       them as tile geometry would let a player spin the slip road into their
       own city. World space cannot be rotated by mistake.

   🔴 THREE IS HANDED IN, NEVER IMPORTED. node-city's import map points 'three'
      at a CDN and the page already holds one instance; importing it here would
      either 404 offline or, worse, load a SECOND copy whose Vector3 is not
      instanceof the page's. Every function below takes `T` (the page's THREE).

   🔴 FOUR MATERIALS, AND THAT CEILING IS NOT A STYLE PREFERENCE — IT IS A
      CRASH THIS FILE ALREADY CAUSED ONCE.
      The first draft gave every surface its own MeshStandardMaterial: bank,
      verge, concrete, kerb, steel, dark, sign-green, sign-white, ballast,
      sleeper, rail, lamp, lamp-lit — fifteen in all. Driven in the gauntlet
      harness (WebGPURenderer falling back to its WebGL2 backend on SwiftShader,
      which is what a low-end machine looks like), the frame the highway first
      entered the camera printed

          THREE.WebGLProgram: Shader Error 0 — VALIDATE_STATUS false
          (Program Info Log: empty)
          WebGL: CONTEXT_LOST_WEBGL
          THREE.WebGPURenderer: WebGL Device Lost

      and the canvas went black — the whole game, not just the highway. Bisected
      by building the highway piece by piece: everything up to and including the
      guardrails and lighting columns survived (nine new programs); adding the
      sign gantry, whose ONLY new cost is two more materials, killed it. The
      ceiling is the program count, not the triangles.

      So the palette moves into the GEOMETRY as a vertex-colour attribute and
      every unlit surface shares ONE white material — the same trick, and for
      the same reason, as CIV_CLOTH_MAT in index.html (see its header there).
      The material must be WHITE: MeshStandardMaterial MULTIPLIES its colour by
      the vertex colour, so any tint here would stain the entire highway.
      ⚠ If you add a surface, give it a COLOUR in `COL`, not a material.

   🌓 NOTHING HERE CASTS A SHADOW. The directional light's shadow frustum is
      fitted to the CITY; a 150-unit highway 20 units off the plate would either
      be clipped out of it anyway or force the frustum wide enough to halve the
      shadow resolution over the buildings that actually matter. receiveShadow
      is off for the same reason — sampling outside the map would read as a hard
      unlit band across the deck.
   ============================================================================ */

import { HW, RAIL, ICH } from './tuning.js';

/* The whole palette. Naturalistic per BAR.md dimension 1: asphalt is a
   desaturated warm grey and never purple, concrete reads a half-stop lighter
   than the road, and the verge is in the same family as the map plate's dirt so
   the highway sits IN the world rather than on top of it. */
export const COL = {
  bank:    0x2e2a30,   // embankment earth
  verge:   0x3b3b32,   // the grass/dirt shoulder
  concrete:0x8d8a83,   // barriers, aprons
  kerb:    0x9a968c,
  /* ⚠ DARKER THAN `concrete`. The ramp parapets are the highest-contrast thing
     on the slip road, and at full concrete brightness the two ramps read as
     white ski slopes in a fogged frame instead of as a road with barriers. */
  parapet: 0x6d6a63,
  steel:   0xa8adb4,   // guardrail beam, gantry, masts
  dark:    0x3a3d42,   // guardrail posts, roof plant
  signGrn: 0x1f6b45,   // motorway sign board
  signWht: 0xe9e6dd,   // legend bars, cabin
  ballast: 0x4a463f,
  sleeper: 0x3a3128,
  rail:    0x9aa0a6,
  lamp:    0x6f7378,
  lampOn:  0xffd9a0,   // the lit head. Colour, not emissive — see the header.
};

/* ── the four materials ───────────────────────────────────────────────────── */
export function makeMats(T) {
  return {
    /* every unlit surface. DoubleSide because the ramp ribbons and parapets are
       generated strips with no guaranteed winding, and `side` is GL cull state
       rather than a program variant — it costs a little fill, never a program. */
    vc:   new T.MeshStandardMaterial({ color: 0xffffff, roughness: .9, vertexColors: true, side: T.DoubleSide }),
    road: new T.MeshStandardMaterial({ color: 0xffffff, roughness: .95, map: carriagewayTex(T, 3) }),
    ramp: new T.MeshStandardMaterial({ color: 0xffffff, roughness: .95, map: rampTex(T), side: T.DoubleSide }),
    haz:  new T.MeshStandardMaterial({ color: 0xffffff, roughness: .9, map: hazardTex(T) }),
  };
}

/* Bake a flat colour into a geometry's vertices so it can share the one
   material. Returns the geometry, so it drops straight into `new T.Mesh(...)`. */
export function vcg(T, geo, hex) {
  try {
    const n = geo.attributes.position.count;
    const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = r; arr[i * 3 + 1] = g; arr[i * 3 + 2] = b; }
    geo.setAttribute('color', new T.BufferAttribute(arr, 3));
  } catch (e) {}
  return geo;
}

/* ── canvas textures ──────────────────────────────────────────────────────────
   No downloadable assets exist in this project, so markings are PAINTED. */
function cnv(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return { c, g: c.getContext('2d') };
}
function tex(T, c, repX, repY) {
  const t = new T.CanvasTexture(c);
  t.wrapS = t.wrapT = T.RepeatWrapping;
  t.repeat.set(repX, repY);
  t.anisotropy = 4;
  if (T.SRGBColorSpace) t.colorSpace = T.SRGBColorSpace;
  return t;
}
/* Grain, so a 150-unit slab of one flat grey does not read as plastic. Kept
   subtle — BAR.md wants "worn/dirty asphalt", not noise. */
function grain(g, w, h, base, amt) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < w * h * 0.10; i++) {
    const a = (Math.random() * amt) | 0;
    g.fillStyle = 'rgba(255,255,255,' + (a / 255 * .06) + ')';
    g.fillRect((Math.random() * w) | 0, (Math.random() * h) | 0, 1, 1);
  }
}

/* One carriageway: a solid white edge line each side, two dashed lane lines
   between them, all slightly worn.
   ⚠ THE CANVAS IS TRANSPOSED ON PURPOSE. The deck is a PlaneGeometry rotated
     flat, so its u runs ALONG the road (X) and its v ACROSS it (Z) — the
     opposite of the ramp ribbons, which generate their own UVs with u across.
     Painting the lines as horizontal bands and the dashes as runs of x is what
     makes the two agree on screen. Repeat is therefore (len/9, 1): tile ALONG
     the road, never across it. */
export function carriagewayTex(T, lanes) {
  /* ⚠ THE ASPHALT IS DARK AND THE PAINT IS NEAR-WHITE, and that contrast is
     doing real work: the highway is ~20 units from a play camera and scene.fog
     starts at 26, so anything mid-grey out there lerps toward the sky and the
     deck stops reading as a road at all. Dark base + bright paint survives the
     haze; the first draft's #4b4a47 with 86%-alpha lines did not. */
  const W = 256, H = 96, { c, g } = cnv(W, H);
  grain(g, W, H, '#3a3937', 70);
  g.fillStyle = '#e8e6dc';
  g.fillRect(0, 5, W, 4);
  g.fillRect(0, H - 9, W, 4);
  for (let i = 1; i < lanes; i++) {
    const y = 8 + ((H - 16) / lanes) * i - 1;
    for (let x = 0; x < W; x += 44) g.fillRect(x, y, 26, 3);
  }
  g.fillStyle = 'rgba(0,0,0,.07)';                       // tyre polish
  for (let i = 0; i < lanes; i++) {
    const cy = 8 + ((H - 16) / lanes) * (i + .5);
    g.fillRect(0, cy - 11, W, 7); g.fillRect(0, cy + 4, W, 7);
  }
  return tex(T, c, HW.len / 9, 1);
}
/* The ramp: an edge line each side and no centre line — a slip road is one
   lane. The taper does the rest of the talking. Also used for the gore. */
export function rampTex(T) {
  const W = 48, H = 128, { c, g } = cnv(W, H);
  grain(g, W, H, '#3d3c39', 55);
  g.fillStyle = '#e8e6dc';
  g.fillRect(3, 0, 3, H); g.fillRect(W - 6, 0, 3, H);
  return tex(T, c, 1, 1);
}
/* Yellow-and-black hazard chevrons on the ground in front of the barriers —
   BAR.md's industrial frame calls them out by name. */
export function hazardTex(T) {
  const W = 64, H = 32, { c, g } = cnv(W, H);
  g.fillStyle = '#8d8a83'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#c9a227';
  for (let i = -1; i < 8; i++) {
    g.beginPath(); g.moveTo(i * 9, H); g.lineTo(i * 9 + 5, H);
    g.lineTo(i * 9 + 14, 0); g.lineTo(i * 9 + 9, 0); g.closePath(); g.fill();
  }
  return tex(T, c, 1, 1);
}

/* ── primitives ───────────────────────────────────────────────────────────── */
/* A trapezoidal prism running along X: the embankment cross-section. Eight
   verts, twelve triangles, exact — an extruded Shape would cost a Shape, an
   ExtrudeGeometry and a rotation for the same twelve triangles. */
function prismX(T, len, wTop, wBot, h) {
  const L = len / 2, a = wBot / 2, b = wTop / 2;
  const p = [
    -L, 0, -a,  L, 0, -a,  L, 0, a,  -L, 0, a,
    -L, h, -b,  L, h, -b,  L, h, b,  -L, h, b,
  ];
  const idx = [4, 6, 5, 4, 7, 6,  0, 5, 1, 0, 4, 5,  3, 2, 6, 3, 6, 7,
               0, 3, 7, 0, 7, 4,  1, 5, 6, 1, 6, 2];
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(p, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function plate(T, w, l) {
  const g = new T.PlaneGeometry(w, l, 1, 1); g.rotateX(-Math.PI / 2); return g;
}
function noShadow(o) { o.castShadow = false; o.receiveShadow = false; return o; }

/* One run of guardrail: a continuous beam plus instanced posts. Split out so
   the near side can be built as two runs with a gap for the interchange. */
function guardRun(T, M, zr, x0, len) {
  const g = new T.Group();
  const beam = new T.Mesh(vcg(T, new T.BoxGeometry(len, .1, .04), COL.steel), M.vc);
  beam.position.set(x0 + len / 2, HW.y + .33, zr); g.add(noShadow(beam));
  const n = Math.max(1, Math.floor(len / HW.railPostEvery)), m = new T.Matrix4();
  const posts = new T.InstancedMesh(vcg(T, new T.BoxGeometry(.05, .38, .05), COL.dark), M.vc, n);
  for (let i = 0; i < n; i++) { m.makeTranslation(x0 + (i + .5) * HW.railPostEvery, HW.y + .19, zr); posts.setMatrixAt(i, m); }
  posts.instanceMatrix.needsUpdate = true;
  noShadow(posts); g.add(posts);
  return g;
}

/* The city-side guardrail, with a gap around the interchange so the slip roads
   have somewhere to merge. `gapX` is the interchange's world x, or null for an
   unbroken run (no interchange built). Rebuilt by index.js whenever the
   interchange moves — see syncScenery(). */
export function buildNearGuard(T, M, gapX) {
  const g = new T.Group(); g.name = 'oc-nearguard';
  const z = HW.z + (HW.median / 2 + HW.lane + .22);   // outer edge of the near deck
  const L = -HW.len / 2, R = HW.len / 2;
  if (gapX == null) { g.add(guardRun(T, M, z, L, HW.len)); return g; }
  /* The gap has to clear BOTH merge points — the on-ramp lands at gapX + reach
     and the off-ramp leaves at gapX − reach — plus the gore that runs on past
     each of them. */
  const half = ICH.ramp.reach + ICH.ramp.offset + 5.6;
  const a = Math.max(L, gapX - half), b = Math.min(R, gapX + half);
  if (a - L > 1) g.add(guardRun(T, M, z, L, a - L));
  if (R - b > 1) g.add(guardRun(T, M, z, b, R - b));
  return g;
}

/* ── the highway ──────────────────────────────────────────────────────────── */
export function buildHighway(T, M) {
  const g = new T.Group(); g.name = 'oc-highway';
  const add = (m, x, y, z) => { m.position.set(x, y, z); noShadow(m); g.add(m); return m; };
  const solid = (geo, hex) => new T.Mesh(vcg(T, geo, hex), M.vc);
  const box = (w, h, d, hex) => solid(new T.BoxGeometry(w, h, d), hex);

  // embankment + verge
  add(solid(prismX(T, HW.len, HW.emb.top, HW.emb.bot, HW.y), COL.bank), 0, 0, HW.z);
  add(solid(plate(T, HW.len, HW.emb.top), COL.verge), 0, HW.y + .001, HW.z);

  // the two carriageways, and a kerb lip on each outer edge so the deck ends in
  // an edge rather than in a seam
  const off = HW.median / 2 + HW.lane / 2;
  for (const s of [-1, 1]) {
    add(new T.Mesh(plate(T, HW.len, HW.lane), M.road), 0, HW.y + HW.deckLift, HW.z + s * off);
    add(box(HW.len, .07, .12, COL.kerb), 0, HW.y + .03, HW.z + s * (off + HW.lane / 2 + .06));
  }

  /* central reservation: a jersey barrier profile — wide foot, battered face,
     narrow top. Two prisms, and the silhouette is unmistakable. */
  add(solid(prismX(T, HW.len, .18, .42, .34), COL.concrete), 0, HW.y + .012, HW.z);
  add(box(HW.len, .06, .2, COL.concrete), 0, HW.y + .37, HW.z);

  /* guardrail. ONLY THE FAR SIDE IS BUILT HERE — the near one is its own group
     (buildNearGuard) because it has to open a gap wherever the interchange is,
     and the interchange can move. Photographed with one continuous near-side
     barrier, the two slip roads visibly ran INTO it: the beam sits at z ≈ -14.5
     and the merge point at z ≈ -16.5, so the barrier drew in front of the ramp
     and the ramps looked severed a few units short of the carriageway. */
  g.add(guardRun(T, M, HW.z - (off + HW.lane / 2 + .22), -HW.len / 2, HW.len));

  // lighting columns down the central reservation: mast + lit head
  const nLamp = Math.floor(HW.len / HW.lampEvery);
  const masts = new T.InstancedMesh(vcg(T, new T.CylinderGeometry(.035, .05, 1.5, 6), COL.lamp), M.vc, nLamp);
  const heads = new T.InstancedMesh(vcg(T, new T.BoxGeometry(.34, .05, .13), COL.lampOn), M.vc, nLamp);
  for (let i = 0; i < nLamp; i++) {
    const x = -HW.len / 2 + (i + .5) * HW.lampEvery;
    mtx.makeTranslation(x, HW.y + .75, HW.z); masts.setMatrixAt(i, mtx);
    mtx.makeTranslation(x, HW.y + 1.5, HW.z); heads.setMatrixAt(i, mtx);
  }
  masts.instanceMatrix.needsUpdate = true; heads.instanceMatrix.needsUpdate = true;
  noShadow(masts); noShadow(heads); g.add(masts); g.add(heads);

  // overhead sign gantries — the single detail that says "motorway" fastest
  const span = HW.emb.top;
  for (let x = -HW.len / 2 + HW.gantryEvery; x < HW.len / 2; x += HW.gantryEvery) {
    for (const s of [-1, 1])
      add(solid(new T.CylinderGeometry(.06, .08, 2.1, 6), COL.steel), x, HW.y + 1.05, HW.z + s * (span / 2 - .3));
    add(box(.12, .12, span - .6, COL.steel), x, HW.y + 2.05, HW.z);
    add(box(.08, .7, 2.6, COL.signGrn), x + .1, HW.y + 1.75, HW.z - 1.6);
    add(box(.02, .09, 1.7, COL.signWht), x + .15, HW.y + 1.86, HW.z - 1.6);
    add(box(.02, .09, 1.1, COL.signWht), x + .15, HW.y + 1.66, HW.z - 1.75);
  }
  return g;
}

/* ── the rail mainline ────────────────────────────────────────────────────── */
export function buildRailLine(T, M) {
  const g = new T.Group(); g.name = 'oc-rail';
  const add = (m, x, y, z) => { m.position.set(x, y, z); noShadow(m); g.add(m); return m; };
  const solid = (geo, hex) => new T.Mesh(vcg(T, geo, hex), M.vc);
  add(solid(prismX(T, RAIL.len, RAIL.emb.top, RAIL.emb.bot, RAIL.y), COL.bank), 0, 0, RAIL.z);
  add(solid(plate(T, RAIL.len, RAIL.emb.top), COL.ballast), 0, RAIL.y + .001, RAIL.z);
  const n = Math.floor(RAIL.len / RAIL.sleeperEvery), m = new T.Matrix4();
  const sl = new T.InstancedMesh(vcg(T, new T.BoxGeometry(.16, .05, 1.15), COL.sleeper), M.vc, n);
  for (let i = 0; i < n; i++) { m.makeTranslation(-RAIL.len / 2 + (i + .5) * RAIL.sleeperEvery, RAIL.y + .03, RAIL.z); sl.setMatrixAt(i, m); }
  sl.instanceMatrix.needsUpdate = true; noShadow(sl); g.add(sl);
  for (const s of [-1, 1])
    add(solid(new T.BoxGeometry(RAIL.len, .06, .045), COL.rail), 0, RAIL.y + .075, RAIL.z + s * RAIL.gauge / 2);
  return g;
}

/* ── ribbons: the ramp surface, its verge and its parapets ─────────────────── */
/* A ribbon is a curve swept with a WIDTH THAT CHANGES along it, which is the
   whole point: the merge taper is not decoration, it is the width function. */
function ribbon(T, curve, segs, wAt, lift, mat, vScale, hex) {
  const pos = [], uv = [], idx = [], up = new T.Vector3(0, 1, 0), n = new T.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, p = curve.getPoint(t), d = curve.getTangent(t);
    d.y = 0; d.normalize(); n.crossVectors(up, d).normalize();
    const w = wAt(t) / 2, y = p.y + lift;
    pos.push(p.x - n.x * w, y, p.z - n.z * w, p.x + n.x * w, y, p.z + n.z * w);
    uv.push(0, t * vScale, 1, t * vScale);
  }
  for (let i = 0; i < segs; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  if (hex !== undefined) vcg(T, g, hex);
  return noShadow(new T.Mesh(g, mat));
}
/* A vertical strip standing on one edge of the ramp — the parapet. */
function parapet(T, curve, segs, offAt, h, mat, hex) {
  const pos = [], idx = [], up = new T.Vector3(0, 1, 0), n = new T.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, p = curve.getPoint(t), d = curve.getTangent(t);
    d.y = 0; d.normalize(); n.crossVectors(up, d).normalize();
    const o = offAt(t), y = p.y - .01;
    pos.push(p.x + n.x * o, y, p.z + n.z * o, p.x + n.x * o, y + h, p.z + n.z * o);
  }
  for (let i = 0; i < segs; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  vcg(T, g, hex);
  return noShadow(new T.Mesh(g, mat));
}

/* ── the interchange's slip roads ─────────────────────────────────────────────
   `wx` is the WORLD x of the interchange tile; `edgeZ` the world z of the map
   edge it stands on. Two ramps:
     • the ON-ramp leaves the city, curves, climbs the embankment and TAPERS
       into the near carriageway pointing +X;
     • the OFF-ramp is its mirror, diverging from the mainline back down.
   At each merge sits the GORE — the painted nose in the crotch of the join,
   which is the detail that makes a ramp read as a ramp and not as a diagonal
   road.
   ⚠ ONLY THE NEAR CARRIAGEWAY IS SERVED, deliberately. Reaching the far one
     needs a flyover, and a half-modelled bridge would read worse than an honest
     half-interchange. A full trumpet is the obvious next round.
   ──────────────────────────────────────────────────────────────────────────── */
export function buildRamps(T, M, wx, edgeZ) {
  const g = new T.Group(); g.name = 'oc-ramps';
  const R = ICH.ramp;
  const mainZ = HW.z + HW.median / 2 + HW.lane / 2;     // near carriageway centreline

  for (const dir of [1, -1]) {                          // +1 on-ramp, -1 off-ramp
    const x0 = wx + dir * R.offset;
    const curve = new T.CubicBezierCurve3(
      new T.Vector3(x0, .04, edgeZ + .45),
      new T.Vector3(x0, .16, edgeZ - 2.6),
      new T.Vector3(x0 + dir * R.reach * .48, HW.y * .92, mainZ + 1.35),
      new T.Vector3(x0 + dir * R.reach, HW.y + .012, mainZ));
    const wAt = (t) => R.wide + (R.narrow - R.wide) * (t * t);   // taper, late and fast
    // the causeway the ramp sits on — without it the slip road floats
    g.add(ribbon(T, curve, R.segs, (t) => wAt(t) + .55, -.05, M.vc, 1, COL.verge));
    g.add(ribbon(T, curve, R.segs, wAt, 0, M.ramp, 7));
    for (const s of [-1, 1])
      g.add(parapet(T, curve, R.segs, (t) => s * (wAt(t) / 2 + .04), R.barrier, M.vc, COL.parapet));

    // the gore: a flat triangle from the merge point back along the mainline
    const nose = curve.getPoint(1);
    const gg = new T.BufferGeometry();
    gg.setAttribute('position', new T.Float32BufferAttribute([
      nose.x, nose.y + .014, nose.z,
      nose.x + dir * 4.4, nose.y + .014, nose.z,
      nose.x + dir * 4.4, nose.y + .014, nose.z + 1.15], 3));
    gg.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 1, 0, 1, 1], 2));
    gg.setIndex([0, 1, 2]); gg.computeVertexNormals();
    g.add(noShadow(new T.Mesh(gg, M.ramp)));

    // the ramp's own sign at the city end
    const post = new T.Mesh(vcg(T, new T.CylinderGeometry(.03, .035, .62, 5), COL.steel), M.vc);
    post.position.set(x0 + dir * .55, .31, edgeZ + .2); g.add(noShadow(post));
    const board = new T.Mesh(vcg(T, new T.BoxGeometry(.5, .28, .04), COL.signGrn), M.vc);
    board.position.set(x0 + dir * .55, .68, edgeZ + .2); g.add(noShadow(board));
  }
  return g;
}

/* ── the rail spur ────────────────────────────────────────────────────────────
   A qualifying Rail Yard throws a short spur to the mainline. Deliberately
   plain: it is a branch line, not a second piece of hero geometry. */
export function buildRailSpur(T, M, wx, wz) {
  const g = new T.Group(); g.name = 'oc-railspur';
  const len = Math.abs(RAIL.z - wz) + .5, cz = (RAIL.z + wz) / 2, y = RAIL.y * .6;
  const solid = (geo, hex) => noShadow(new T.Mesh(vcg(T, geo, hex), M.vc));
  const bed = solid(prismX(T, len, 2.2, 3.0, y), COL.bank);
  bed.rotation.y = Math.PI / 2; bed.position.set(wx, 0, cz); g.add(bed);
  const bal = solid(plate(T, 2.2, len), COL.ballast); bal.position.set(wx, y + .002, cz); g.add(bal);
  const n = Math.max(1, Math.floor(len / RAIL.sleeperEvery)), m = new T.Matrix4();
  const sl = new T.InstancedMesh(vcg(T, new T.BoxGeometry(1.15, .05, .16), COL.sleeper), M.vc, n);
  for (let i = 0; i < n; i++) { m.makeTranslation(wx, y + .03, cz - len / 2 + (i + .5) * RAIL.sleeperEvery); sl.setMatrixAt(i, m); }
  sl.instanceMatrix.needsUpdate = true; noShadow(sl); g.add(sl);
  for (const s of [-1, 1]) {
    const r = solid(new T.BoxGeometry(.045, .06, len), COL.rail);
    r.position.set(wx + s * RAIL.gauge / 2, y + .075, cz); g.add(r);
  }
  return g;
}

/* ── the tile mesh: the toll plaza that stands ON the interchange square ──────
   The RAMPS are world geometry (see the header). What sits on the tile is the
   plaza a player clicks: apron, hazard chevrons, control cabin, lift barriers,
   a motorway sign and a lighting column. Returned to index.html's buildMesh(),
   so it obeys the same 1x1-centred-at-origin contract every other recipe does —
   which is also why the ramps cannot live here. */
export function buildTileMesh(T, M, lvl) {
  const g = new T.Group();
  const add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };
  const solid = (geo, hex) => new T.Mesh(vcg(T, geo, hex), M.vc);
  const box = (w, h, d, hex) => solid(new T.BoxGeometry(w, h, d), hex);

  const apron = solid(plate(T, .98, .98), COL.concrete);
  apron.position.y = .012; apron.receiveShadow = true; g.add(apron);
  add(new T.Mesh(plate(T, .9, .22), M.haz), 0, .016, .34);

  // control cabin — a real little building: base, glazing band, roof, plant
  const cab = box(.34, .26, .28, COL.signWht); cab.castShadow = true; add(cab, -.28, .145, -.1);
  add(box(.36, .04, .3, COL.dark), -.28, .29, -.1);
  add(box(.3, .09, .012, COL.dark), -.28, .2, .045);
  add(box(.1, .07, .08, COL.steel), -.34, .335, -.14);

  // lift barriers across the two lanes
  for (const s of [-1, 1]) {
    add(solid(new T.CylinderGeometry(.02, .025, .2, 5), COL.steel), s * .12, .1, .1);
    const arm = box(.3, .022, .022, COL.signWht); arm.rotation.z = -.06;
    add(arm, s * .12 + .13, .2, .1);
  }
  // the motorway sign the ramp answers to
  for (const s of [-1, 1]) add(solid(new T.CylinderGeometry(.022, .026, .5, 5), COL.steel), s * .38, .25, -.34);
  add(box(.84, .09, .05, COL.steel), 0, .5, -.34);
  const board = box(.66, .26, .035, COL.signGrn); board.castShadow = true; add(board, 0, .36, -.34);
  add(box(.44, .04, .012, COL.signWht), 0, .41, -.36);
  add(box(.3, .035, .012, COL.signWht), -.06, .33, -.36);

  // a lighting column, because everything else on this map has one
  add(solid(new T.CylinderGeometry(.016, .024, .62, 6), COL.lamp), .42, .31, .3);
  add(box(.14, .03, .06, COL.lampOn), .35, .62, .3);

  if (lvl > 1) g.scale.setScalar(1 + (lvl - 1) * .04);
  return g;
}
