/* ═══════════════════════════════════════════════════════════════════════════
   🛢 HIDN PETRO — the 3D yard (top-down, three.js r128 legacy global build)
   ---------------------------------------------------------------------------
   ⚠ WHY window.THREE AND NOT AN IMPORT. index.html carries TWO three.js
   builds: the legacy r128 global used by VFX/battlemap/pack-opener/Extraction
   Field, and an import-map'd 0.171 WebGPU build in module scope for the sprite
   systems. Those are deliberately kept apart. This yard is a sibling of the
   Extraction Field, so it uses the SAME r128 global the rest of the game's 3D
   already loaded — importing 'three' here would pull a second engine into the
   page for no benefit and two WebGL contexts fighting over the same canvas.
   The bridge hands us loadThree(); if it never resolves, the whole 3D layer is
   skipped and the panel UI plays on its own. The yard is the view, not the game.

   The yard is FUNCTIONAL, not decorative:
     · a unit you do not own is not on the map, so the yard's silhouette is a
       readout of what the company can actually do
     · tank roofs sit at the real fill level
     · the flare burns in proportion to run severity — you can see you are
       running hot from across the screen before you read a single gauge
     · trucks physically occupy a bay while loading and drive the exit road,
       which is what makes "bays, not trucks" legible without a tooltip
   ═════════════════════════════════════════════════════════════════════════ */

import * as St from './state.js';

let T = null;                  // window.THREE, captured at init
let scene, camera, renderer, raf = 0, host = null;
let root, units = {}, flare = null, smoke = [], trucks = [];
let clock = 0, disposed = false;
let onPick = null;
let hovered = null;
let pointer = null, ray = null;

/* The SLAB is far larger than the yard so its edge never appears in frame —
   a visible ground edge with black beyond it makes the whole site read as a
   diorama on a table. The framing below works off YARD_SPAN (the furniture),
   not off the slab. */
const GROUND = 76;             // ground slab half-extent
const YARD_SPAN = 88;          // what the camera actually frames
const YARD_CX = 2, YARD_CZ = 3; // centre of the furniture, not of the slab

export function available() { return !!(typeof window !== 'undefined' && window.THREE); }

export function init(canvasHost, opts) {
  if (!available()) return false;
  T = window.THREE;
  host = canvasHost;
  onPick = (opts && opts.onPick) || null;
  disposed = false;

  scene = new T.Scene();
  scene.background = new T.Color(0x0b0c0d);
  scene.fog = new T.Fog(0x0b0c0d, 150, 300);

  const w = Math.max(320, host.clientWidth || 800);
  const h = Math.max(240, host.clientHeight || 460);
  /* A narrow FOV from high up. This is the trick that makes a perspective
     camera read as "top-down tactical" instead of "flying over" — a true
     orthographic camera loses the parallax that tells you a column is TALL,
     which is the one piece of information the silhouette is carrying. */
  camera = new T.PerspectiveCamera(42, w / h, 1, 460);
  camera.position.set(0, 112, 68);
  camera.lookAt(0, 3, -2);

  renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  // Cap DPR at 2 — a 3× phone screen triples the fragment cost for a yard
  // nobody is inspecting at pixel level.
  renderer.setPixelRatio(Math.min(2, (window.devicePixelRatio || 1)));
  renderer.setSize(w, h, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;border-radius:8px;cursor:pointer';

  root = new T.Group(); scene.add(root);
  buildLights(); buildGround();
  frameYard();
  rebuild();

  pointer = new T.Vector2(); ray = new T.Raycaster();
  renderer.domElement.addEventListener('pointermove', onMove);
  renderer.domElement.addEventListener('pointerdown', onDown);
  window.addEventListener('resize', onResize);
  return true;
}

function buildLights() {
  /* Lit like a working site at dusk: dark enough to belong to the game's
     palette (#0b0c0d and amber), bright enough that the shapes read.
     Both ends of this were wrong once — the first pass rendered nearly black,
     the correction washed the whole yard out to bright grey concrete. */
  scene.add(new T.HemisphereLight(0x8299b8, 0x201c1a, 0.70));
  const key = new T.DirectionalLight(0xffd4a2, 1.10);
  key.position.set(30, 56, 20);
  key.castShadow = true;
  // A tight shadow frustum around the yard. The default 500-unit box would
  // spread the same texels over an area 100× too large and the shadows would
  // look like mud.
  key.shadow.mapSize.set(1024, 1024);
  const d = 52;
  key.shadow.camera.left = -d; key.shadow.camera.right = d;
  key.shadow.camera.top = d; key.shadow.camera.bottom = -d;
  key.shadow.camera.near = 6; key.shadow.camera.far = 140;
  scene.add(key);
  const rim = new T.DirectionalLight(0x6f8fc8, 0.42);
  rim.position.set(-30, 22, -26); scene.add(rim);
  // A warm sodium fill over the loading apron, so the near edge is not a void
  // and the trucks have something to drive out of.
  const apron = new T.PointLight(0xffab5c, 0.62, 74);
  apron.position.set(0, 14, 26); scene.add(apron);
}

function buildGround() {
  const g = new T.Mesh(
    new T.PlaneGeometry(GROUND * 2, GROUND * 2),
    new T.MeshStandardMaterial({ color: 0x1c1f23, roughness: 0.95, metalness: 0.02 })
  );
  g.rotation.x = -Math.PI / 2; g.receiveShadow = true; scene.add(g);

  // The perimeter road + the exit the trucks actually use.
  const road = new T.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.88 });
  const strip = (x, z, w, d) => {
    const m = new T.Mesh(new T.BoxGeometry(w, 0.14, d), road);
    m.position.set(x, 0.07, z); m.receiveShadow = true; scene.add(m);
  };
  strip(0, 26, 78, 6);          // loading apron
  strip(0, 0, 6, 78);           // spine
  strip(0, 76, 8, 108);         // exit road, running off toward the city

  // Bund walls — low kerbs that make the yard read as a contained site.
  const kerb = new T.MeshStandardMaterial({ color: 0x3a3e45, roughness: 0.95 });
  [[-34, 0, 1.4, 62], [34, 0, 1.4, 62], [0, -32, 70, 1.4]].forEach(([x, z, w, d]) => {
    const m = new T.Mesh(new T.BoxGeometry(w, 1.1, d), kerb);
    m.position.set(x, 0.55, z); m.castShadow = true; m.receiveShadow = true; scene.add(m);
  });
}

/* ── Materials, made once. Creating a MeshStandardMaterial per mesh per
      rebuild is the classic way to make a small scene stutter. */
const MAT = {};
function mat(key, color, opts) {
  if (!MAT[key]) MAT[key] = new T.MeshStandardMaterial(Object.assign({ color, roughness: 0.66, metalness: 0.34 }, opts || {}));
  return MAT[key];
}

/* ── THE YARD. Rebuilt whenever equipment changes — cheap, and it keeps the
      "what you own is what you see" promise exact. */
export function rebuild() {
  if (!T || disposed) return;
  while (root.children.length) {
    const c = root.children.pop();
    root.remove(c);
    c.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      // Materials are shared from MAT and disposed once, in dispose().
    });
  }
  units = {}; flare = null; smoke = [];

  const s = St.S();
  const E = s.equip;

  // Crude tanks — squat, dark, upstream (west side).
  for (let i = 0; i < (E.crudeTank | 0); i++) {
    const t = tank(3.6, 4.2, 0x3a3126, 'crudeTank');
    t.position.set(-25 + (i % 2) * 9, 0, -16 + Math.floor(i / 2) * 10);
    place(t, 'crudeTank', i);
  }
  // Distillation columns — the tall silhouette, dead centre.
  for (let i = 0; i < Math.max(1, E.cdu | 0); i++) {
    const c = column();
    c.position.set(-6 + i * 8, 0, -4);
    place(c, 'cdu', i);
  }
  // Secondary units — each one physically present only if owned.
  const secondaries = [
    ['cracker',  0xc2452d, 14,  -12],
    ['reformer', 0xe8a13a, 22,  -14],
    ['treater',  0x7fb0ff, 14,   -1],
    ['alky',     0x9fe6e6, 23,   -2],
  ];
  for (const [id, color, x, z] of secondaries) {
    for (let i = 0; i < (E[id] | 0); i++) {
      const u = reactor(color);
      u.position.set(x + i * 7, 0, z);
      place(u, id, i);
    }
  }
  // Blending tanks — agitators on top, which is the visual cue that this is
  // where the mixing happens.
  for (let i = 0; i < (E.blendTank | 0); i++) {
    const b = blendTank();
    b.position.set(-24 + i * 8, 0, 8);
    place(b, 'blendTank', i);
  }
  // Product tanks — floating roofs that ride the fill level.
  for (let i = 0; i < (E.storeTank | 0); i++) {
    const t = tank(3.0, 5.0, 0xb9c0c8, 'storeTank', true);
    t.position.set(6 + (i % 5) * 7, 0, 10 + Math.floor(i / 5) * 8);
    place(t, 'storeTank', i);
  }
  // Loading bays + a laboratory hut, both on the apron.
  for (let i = 0; i < (E.bay | 0); i++) {
    const b = bay();
    b.position.set(-21 + i * 13, 0, 25);
    place(b, 'bay', i);
  }
  if ((E.lab | 0) > 0) { const l = hut(0x6fd0a0); l.position.set(28, 0, 20); place(l, 'lab', 0); }
  if ((E.automation | 0) > 0) { const a = hut(0x9b6fd0); a.position.set(28, 0, 27); place(a, 'automation', 0); }
  if ((E.pumps | 0) > 0) {
    for (let i = 0; i < (E.pumps | 0); i++) { const p = pumpSkid(); p.position.set(-14 + i * 3.4, 0, 2.5); place(p, 'pumps', i); }
  }

  buildFlare();
  // Parked trucks: the ones NOT out on the road, so the fleet is countable.
  const out = s.convoy.length;
  for (let i = 0; i < Math.max(0, (E.truck | 0) - out); i++) {
    const t = truckMesh(false);
    t.position.set(-26 + i * 6, 0, 32); t.rotation.y = Math.PI;
    root.add(t);
  }
}

function place(obj, id, i) {
  obj.traverse(o => { o.castShadow = true; o.receiveShadow = true; });
  obj.userData.pick = { id, index: i };
  root.add(obj);
  (units[id] = units[id] || []).push(obj);
}

/* ── Primitives ─────────────────────────────────────────────────────────── */
function tank(r, h, color, key, floatingRoof) {
  const g = new T.Group();
  const shell = new T.Mesh(new T.CylinderGeometry(r, r, h, 20, 1, true), mat(key + '_shell', color, { roughness: 0.78, metalness: 0.4, side: T.DoubleSide }));
  shell.position.y = h / 2; g.add(shell);
  const base = new T.Mesh(new T.CylinderGeometry(r + 0.5, r + 0.7, 0.4, 20), mat('pad', 0x2c2f34, { metalness: 0.05 }));
  base.position.y = 0.2; g.add(base);
  const roof = new T.Mesh(new T.CylinderGeometry(r * 0.97, r * 0.97, 0.3, 20), mat(key + '_roof', color, { roughness: 0.6 }));
  roof.position.y = floatingRoof ? h * 0.5 : h + 0.15;
  g.add(roof);
  g.userData.roof = roof; g.userData.h = h;
  // Catwalk ring — a couple of rings is all it takes to stop a cylinder
  // reading as a chess piece.
  const ring = new T.Mesh(new T.TorusGeometry(r + 0.12, 0.07, 6, 22), mat('rail', 0x8d959e, { metalness: 0.6 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = h * 0.82; g.add(ring);
  return g;
}

function column() {
  const g = new T.Group();
  const h = 21;
  const body = new T.Mesh(new T.CylinderGeometry(2.1, 2.6, h, 18), mat('col', 0xb0b6bd, { roughness: 0.55, metalness: 0.55 }));
  body.position.y = h / 2; g.add(body);
  // Tray bands — the give-away that this is a fractionating column.
  for (let i = 1; i <= 5; i++) {
    const b = new T.Mesh(new T.TorusGeometry(2.28 - i * 0.04, 0.13, 6, 20), mat('band', 0x6a727b, { metalness: 0.7 }));
    b.rotation.x = Math.PI / 2; b.position.y = i * (h / 6.2); g.add(b);
  }
  const cap = new T.Mesh(new T.SphereGeometry(2.1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat('col', 0xb0b6bd));
  cap.position.y = h; g.add(cap);
  const skirt = new T.Mesh(new T.CylinderGeometry(2.9, 3.3, 1.0, 18), mat('pad', 0x2f333a));
  skirt.position.y = 0.5; g.add(skirt);
  // Overhead piping to the rest of the yard.
  const pipe = new T.Mesh(new T.BoxGeometry(13, 0.34, 0.34), mat('pipe', 0x8a929c, { metalness: 0.65 }));
  pipe.position.set(5.6, h * 0.72, 0); g.add(pipe);
  return g;
}

function reactor(color) {
  const g = new T.Group();
  const body = new T.Mesh(new T.CylinderGeometry(1.5, 1.5, 7.5, 16), mat('r' + color, color, { roughness: 0.5, metalness: 0.6 }));
  body.position.y = 3.75 + 0.6; g.add(body);
  const dome = new T.Mesh(new T.SphereGeometry(1.5, 14, 8), mat('r' + color, color));
  dome.position.y = 8.35; dome.scale.y = 0.55; g.add(dome);
  const legs = new T.Mesh(new T.BoxGeometry(3.6, 1.2, 3.6), mat('pad', 0x2f333a));
  legs.position.y = 0.6; g.add(legs);
  const stack = new T.Mesh(new T.CylinderGeometry(0.3, 0.4, 4.4, 10), mat('pipe', 0x7d858f));
  stack.position.set(2.1, 3.0, 0); g.add(stack);
  return g;
}

function blendTank() {
  const g = tank(2.9, 4.6, 0x4a4f7a, 'blend');
  const motor = new T.Mesh(new T.BoxGeometry(1.2, 0.8, 1.2), mat('motor', 0xe8a13a, { metalness: 0.5 }));
  motor.position.y = 5.1; g.add(motor);
  const shaft = new T.Mesh(new T.CylinderGeometry(0.12, 0.12, 1.2, 8), mat('rail', 0x8d959e));
  shaft.position.y = 4.6; g.add(shaft);
  const blade = new T.Mesh(new T.BoxGeometry(2.6, 0.1, 0.32), mat('rail', 0x8d959e));
  blade.position.y = 5.55; motor.add(blade);
  g.userData.agitator = blade;
  return g;
}

function bay() {
  const g = new T.Group();
  const canopy = new T.Mesh(new T.BoxGeometry(9, 0.35, 6), mat('canopy', 0x3a3f46, { roughness: 0.85 }));
  canopy.position.y = 5.2; g.add(canopy);
  [[-4.2, -2.6], [4.2, -2.6], [-4.2, 2.6], [4.2, 2.6]].forEach(([x, z]) => {
    const p = new T.Mesh(new T.CylinderGeometry(0.22, 0.22, 5.2, 8), mat('rail', 0x8d959e));
    p.position.set(x, 2.6, z); g.add(p);
  });
  const arm = new T.Mesh(new T.BoxGeometry(0.3, 0.3, 3.4), mat('pipe', 0xe8a13a));
  arm.position.set(0, 4.4, 0); g.add(arm);
  return g;
}

function hut(color) {
  const g = new T.Group();
  const b = new T.Mesh(new T.BoxGeometry(5, 3, 4), mat('hut' + color, color, { roughness: 0.8, metalness: 0.15 }));
  b.position.y = 1.5; g.add(b);
  const r = new T.Mesh(new T.BoxGeometry(5.4, 0.3, 4.4), mat('canopy', 0x3a3f46));
  r.position.y = 3.15; g.add(r);
  return g;
}

function pumpSkid() {
  const g = new T.Group();
  const skid = new T.Mesh(new T.BoxGeometry(2.6, 0.4, 1.8), mat('pad', 0x2f333a));
  skid.position.y = 0.2; g.add(skid);
  const m = new T.Mesh(new T.CylinderGeometry(0.5, 0.5, 1.6, 12), mat('motor2', 0x7bc043, { metalness: 0.5 }));
  m.rotation.z = Math.PI / 2; m.position.y = 0.9; g.add(m);
  return g;
}

function truckMesh(loaded) {
  const g = new T.Group();
  const cab = new T.Mesh(new T.BoxGeometry(1.8, 1.8, 2.2), mat('cab', 0xe8a13a, { metalness: 0.4 }));
  cab.position.set(0, 1.3, 2.1); g.add(cab);
  const barrel = new T.Mesh(new T.CylinderGeometry(1.1, 1.1, 5.6, 14), mat('barrel', loaded ? 0xd8dde2 : 0x9aa2ab, { metalness: 0.7, roughness: 0.4 }));
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 1.5, -1.4); g.add(barrel);
  const chassis = new T.Mesh(new T.BoxGeometry(1.9, 0.4, 7.6), mat('pad', 0x2f333a));
  chassis.position.y = 0.6; g.add(chassis);
  [[-1, 2.2], [1, 2.2], [-1, -2.4], [1, -2.4], [-1, -3.6], [1, -3.6]].forEach(([x, z]) => {
    const w = new T.Mesh(new T.CylinderGeometry(0.55, 0.55, 0.35, 10), mat('tyre', 0x15171a, { metalness: 0.05, roughness: 1 }));
    w.rotation.z = Math.PI / 2; w.position.set(x, 0.55, z); g.add(w);
  });
  g.traverse(o => { o.castShadow = true; });
  return g;
}

function buildFlare() {
  const g = new T.Group();
  const stack = new T.Mesh(new T.CylinderGeometry(0.5, 0.75, 17, 12), mat('flarestack', 0x5d6167, { metalness: 0.5 }));
  stack.position.y = 8.5; g.add(stack);
  const tip = new T.Mesh(new T.CylinderGeometry(0.85, 0.55, 1.2, 12), mat('flaretip', 0x2c2f34));
  tip.position.y = 17.4; g.add(tip);
  /* The flame. AdditiveBlending + depthWrite:false is what stops a
     transparent flame from punching a hole in everything behind it. */
  const fm = new T.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false });
  const flame = new T.Mesh(new T.ConeGeometry(1.1, 4.2, 10), fm);
  flame.position.y = 20; g.add(flame);
  const glow = new T.PointLight(0xff7a2f, 0, 34);
  glow.position.y = 20; g.add(glow);
  g.position.set(30, 0, -22);
  g.userData.flame = flame; g.userData.glow = glow;
  root.add(g);
  flare = g;
}

/* ── LIVE STATE → VISUALS ═════════════════════════════════════════════════
   Called every frame by the host with the current run (or null). This is the
   only place the scene reads the game, and it reads a plain object — the
   scene has no opinion about where a run comes from. */
let live = { severity: 0, running: false, fills: {}, quality: 1 };
export function setLive(next) { live = Object.assign(live, next || {}); }

function animate() {
  if (disposed) return;
  raf = requestAnimationFrame(animate);
  const dt = 1 / 60;
  clock += dt;

  // Agitators spin only while there is something to blend.
  const s = St.S();
  const blending = s.batches.length > 0 || live.blending;
  for (const b of (units.blendTank || [])) {
    if (b.userData.agitator) b.userData.agitator.rotation.y += (blending ? 3.4 : 0.25) * dt;
  }

  // Floating roofs ride the fill. A yard full of product looks full.
  const fillPct = Math.max(0, Math.min(1, live.storeFill == null ? 0 : live.storeFill));
  for (const t of (units.storeTank || [])) {
    if (!t.userData.roof) continue;
    const h = t.userData.h;
    const target = 0.45 + fillPct * (h - 0.8);
    t.userData.roof.position.y += (target - t.userData.roof.position.y) * 0.06;
  }
  const crudePct = Math.max(0, Math.min(1, live.crudeFill == null ? 0 : live.crudeFill));
  for (const t of (units.crudeTank || [])) {
    if (!t.userData.roof) continue;
    t.userData.roof.position.y = t.userData.h + 0.15;
    t.children[0].material.emissive && t.children[0].material.emissive.setScalar(0);
    t.scale.y = 1;   // crude tanks are fixed-roof; fill is shown on the HUD
  }
  void crudePct;

  /* THE FLARE. This is the single most useful thing on the screen: it burns
     in proportion to how far past the safe envelope the column is being run,
     so a player looking at the yard rather than the gauges still knows. */
  if (flare) {
    const sev = live.running ? Math.max(0, live.severity - 0.92) : 0;
    const want = Math.min(1, sev * 2.1);
    const f = flare.userData.flame, gl = flare.userData.glow;
    const flick = 0.82 + Math.sin(clock * 21) * 0.12 + Math.sin(clock * 7.3) * 0.06;
    f.material.opacity += (want * 0.85 * flick - f.material.opacity) * 0.12;
    f.scale.setScalar(0.6 + want * (0.9 + flick * 0.35));
    f.position.y = 20 + want * 1.6;
    gl.intensity += (want * 3.4 - gl.intensity) * 0.12;
    f.material.color.setHSL(0.075 - want * 0.045, 1, 0.5 + want * 0.12);
  }

  // Trucks on the exit road. Position IS the delivery progress — no separate
  // progress bar needed to know how far out a load is.
  syncTrucks();
  for (const t of trucks) {
    const p = Math.max(0, Math.min(1, t.userData.prog()));
    // 0 → at the bay · 0.12 → turned onto the road · 1 → off the map north.
    const z = 26 - p * 96;
    t.position.set(t.userData.lane, 0, z);
    t.rotation.y = Math.PI;
    const fade = p > 0.86 ? Math.max(0, 1 - (p - 0.86) / 0.14) : 1;
    t.traverse(o => { if (o.material && o.material.transparent !== undefined) { o.material.transparent = fade < 1; o.material.opacity = fade; } });
  }

  if (renderer && scene && camera) renderer.render(scene, camera);
}

function syncTrucks() {
  const s = St.S();
  const ids = s.convoy.map(t => t.id);
  // Drop meshes for trucks that have arrived.
  for (let i = trucks.length - 1; i >= 0; i--) {
    if (ids.indexOf(trucks[i].userData.cid) < 0) { root.remove(trucks[i]); trucks.splice(i, 1); }
  }
  // Add meshes for new dispatches.
  for (const c of s.convoy) {
    if (trucks.some(t => t.userData.cid === c.id)) continue;
    const m = truckMesh(true);
    m.userData.cid = c.id;
    m.userData.lane = -8 + (trucks.length % 3) * 8;
    m.userData.prog = () => Math.max(0, Math.min(1, (Date.now() - c.leftAt) / Math.max(1, c.etaMs)));
    trucks.push(m); root.add(m);
  }
}

export function start() { if (!raf && !disposed) animate(); }

/* ── PICKING ═══════════════════════════════════════════════════════════════
   Clicking a unit opens its panel. The yard is a menu you can point at, which
   is the only reason a 3D view earns its frame budget in a management game. */
function onMove(e) {
  if (!renderer) return;
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  const hit = castPick();
  const next = hit ? hit.object : null;
  if (next !== hovered) {
    if (hovered) hovered.scale.setScalar(1);
    hovered = next;
    if (hovered) hovered.scale.setScalar(1.045);
    renderer.domElement.style.cursor = hovered ? 'pointer' : 'default';
  }
}
function onDown() {
  const hit = castPick();
  if (hit && onPick) { try { onPick(hit.pick); } catch (e) {} }
}
function castPick() {
  if (!ray || !camera) return null;
  ray.setFromCamera(pointer, camera);
  const hits = ray.intersectObjects(root.children, true);
  for (const h of hits) {
    let o = h.object;
    while (o && !o.userData.pick) o = o.parent;
    if (o && o.userData.pick) return { object: o, pick: o.userData.pick };
  }
  return null;
}

/* Position the camera so the whole yard is in frame at this aspect. Shared by
   init and resize — the two used to disagree, which is why the first frame was
   framed differently from every frame after a resize. */
function frameYard() {
  if (!camera) return;
  /* YARD_SPAN, not the slab width: framing to the whole slab left a ring of
     empty asphalt round the edge that made everything look small.
     The 0.94/0.30 ratio is the important number — it is roughly 72° from the
     horizontal, which reads as TOP-DOWN with just enough parallax left to tell
     you the distillation columns are tall. At the old 0.86/0.52 (~59°) the
     yard read as an isometric plate seen from across the room.
     Framing is centred on YARD_CX/YARD_CZ (where the furniture actually is)
     rather than on the origin, which used to push the parked trucks off the
     bottom of the frame. */
  const half = YARD_SPAN / 2;
  const f = Math.tan((camera.fov * Math.PI / 180) / 2);
  const d = Math.max(half / f, (half / camera.aspect) / f);
  camera.position.set(YARD_CX, d * 0.94, YARD_CZ + d * 0.30);
  camera.lookAt(YARD_CX, 2, YARD_CZ);
  camera.updateProjectionMatrix();
}

function onResize() {
  if (!renderer || !host) return;
  const w = Math.max(320, host.clientWidth || 800);
  const h = Math.max(240, host.clientHeight || 460);
  camera.aspect = w / h;
  frameYard();
  renderer.setSize(w, h, false);
}

/* Full teardown. An un-disposed WebGL context survives the overlay closing and
   the second open then fights the first for the GPU — the Extraction Field
   learned this the hard way, hence forceContextLoss(). */
export function dispose() {
  disposed = true;
  try { cancelAnimationFrame(raf); } catch (e) {}
  raf = 0;
  try { if (renderer) { renderer.domElement.removeEventListener('pointermove', onMove); renderer.domElement.removeEventListener('pointerdown', onDown); } } catch (e) {}
  try { window.removeEventListener('resize', onResize); } catch (e) {}
  try {
    if (scene) scene.traverse(o => {
      if (o.geometry && o.geometry.dispose) o.geometry.dispose();
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      ms.forEach(m => { if (m && m.dispose) m.dispose(); });
    });
  } catch (e) {}
  for (const k in MAT) delete MAT[k];
  try { if (renderer) { renderer.dispose(); renderer.forceContextLoss(); if (renderer.domElement && renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement); } } catch (e) {}
  scene = camera = renderer = root = flare = null;
  units = {}; trucks = []; smoke = []; host = null; hovered = null;
}
