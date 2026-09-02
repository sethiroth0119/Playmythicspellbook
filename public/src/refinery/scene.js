/* ═══════════════════════════════════════════════════════════════════════════
   🛢 HIDN PETRO — the 3D yard (three.js r128 legacy global build)
   ---------------------------------------------------------------------------
   ⚠ WHY window.THREE AND NOT AN IMPORT. index.html carries TWO three.js
   builds: the legacy r128 global used by VFX/battlemap/pack-opener/Extraction
   Field, and an import-map'd 0.171 WebGPU build in module scope for the sprite
   systems. Those are deliberately kept apart. This yard is a sibling of the
   Extraction Field, so it uses the SAME r128 global the rest of the game's 3D
   already loaded — importing 'three' here would pull a second engine into the
   page for no benefit and two WebGL contexts fighting over the same canvas.

   The yard is a PLACE you walk around, not a diagram you click:
     · every unit you own physically stands somewhere, and every unit you do
       NOT own leaves a marked-out plot with its bill of materials over it
     · walking up to a thing and pressing E is what opens its panel
     · the office has a door that opens and a roof that lifts away when you
       step inside, because a roof you cannot see under is a room you cannot use
     · the flare burns in proportion to how hard the column is being run, so
       you can read the yard's state from across it
   Every mesh comes through models.js, so an admin can replace any of it.
   ═════════════════════════════════════════════════════════════════════════ */

import * as St from './state.js';
import * as Models from './models.js';
import * as Walk from './walk.js';
import * as Build from './build.js';
import { EQUIPMENT } from './data.js';

let T = null;
let scene, camera, renderer, raf = 0, host = null;
let root, units = {}, pads = [], flare = null, trucks = [], office = null;
let player = null;
let clock = 0, disposed = false;
let hooks = {};
let overview = false;

const GROUND = 76;
const YARD_SPAN = 88;
const YARD_CX = 2, YARD_CZ = 3;
const FENCE = 44;

/* The office sits on the apron, between the loading bays and the gate, so a
   player walks past it on the way in and out. Interior bounds are what the
   roof fade and the camera pull-in key off. */
const OFFICE = { x: 30, z: 33, w: 13, d: 10, h: 6.4, rot: 0 };
/* Half-width of the doorway. Generous on purpose: a door you have to line
   yourself up with is a door players walk past. */
const DOOR_HALF = 1.9;
const OFFICE_IN = {
  id: 'office',
  minX: OFFICE.x - OFFICE.w / 2 + 0.4, maxX: OFFICE.x + OFFICE.w / 2 - 0.4,
  minZ: OFFICE.z - OFFICE.d / 2 + 0.4, maxZ: OFFICE.z + OFFICE.d / 2 - 0.4,
};

export function available() { return !!(typeof window !== 'undefined' && window.THREE); }
export function getPlayer() { return player; }
export function focus() { return player && player.focus; }
export function isOverview() { return overview; }

export function init(canvasHost, opts) {
  if (!available()) return false;
  T = window.THREE;
  host = canvasHost;
  hooks = opts || {};
  disposed = false;

  scene = new T.Scene();
  scene.background = new T.Color(0x0b0c0d);
  scene.fog = new T.Fog(0x0b0c0d, 150, 300);

  const w = Math.max(320, host.clientWidth || 800);
  const h = Math.max(240, host.clientHeight || 460);
  camera = new T.PerspectiveCamera(52, w / h, 0.4, 460);

  renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, (window.devicePixelRatio || 1)));
  renderer.setSize(w, h, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;border-radius:8px;outline:none';
  renderer.domElement.tabIndex = 0;

  root = new T.Group(); scene.add(root);
  buildLights(); buildGround();

  /* Spawn at the GATE, facing into the plant. Starting beside the office put
     the operator behind it, so the first thing a player saw was the back wall
     of a shed rather than the yard they came to run. */
  player = Walk.create(scene, camera, {
    x: 0, z: 36,
    onInteract: (it) => { if (hooks.onInteract) hooks.onInteract(it); },
    onEnter: (nowIn) => { if (hooks.onEnter) hooks.onEnter(nowIn); },
  });
  Walk.bindInput(player, renderer.domElement);

  // Custom models load in the background; the yard is drawn from primitives
  // immediately and rebuilt as each one arrives, so nothing waits on a fetch.
  Models.preloadAll().then(() => { if (!disposed) rebuild(); }).catch(() => {});

  rebuild();
  window.addEventListener('resize', onResize);
  return true;
}

function buildLights() {
  scene.add(new T.HemisphereLight(0x8299b8, 0x201c1a, 0.70));
  const key = new T.DirectionalLight(0xffd4a2, 1.10);
  key.position.set(30, 56, 20);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  const d = 56;
  key.shadow.camera.left = -d; key.shadow.camera.right = d;
  key.shadow.camera.top = d; key.shadow.camera.bottom = -d;
  key.shadow.camera.near = 6; key.shadow.camera.far = 150;
  scene.add(key);
  const rim = new T.DirectionalLight(0x6f8fc8, 0.42);
  rim.position.set(-30, 22, -26); scene.add(rim);
  const apron = new T.PointLight(0xffab5c, 0.62, 74);
  apron.position.set(0, 14, 26); scene.add(apron);
}

function buildGround() {
  const g = new T.Mesh(new T.PlaneGeometry(GROUND * 2, GROUND * 2),
    new T.MeshStandardMaterial({ color: 0x1c1f23, roughness: 0.95, metalness: 0.02 }));
  g.rotation.x = -Math.PI / 2; g.receiveShadow = true; scene.add(g);

  const road = new T.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.88 });
  const strip = (x, z, w, d) => {
    const m = new T.Mesh(new T.BoxGeometry(w, 0.14, d), road);
    m.position.set(x, 0.07, z); m.receiveShadow = true; scene.add(m);
  };
  strip(0, 26, 78, 6);
  strip(0, 0, 6, 78);
  strip(0, 76, 8, 108);

  // The fence, so the site has an edge you can see rather than only feel.
  const post = new T.MeshStandardMaterial({ color: 0x3a3e45, roughness: 0.95 });
  for (let i = -FENCE; i <= FENCE; i += 8) {
    [[i, -FENCE], [i, FENCE], [-FENCE, i], [FENCE, i]].forEach(([x, z]) => {
      if (Math.abs(x) < 5 && z > 0) return;      // the gate
      const p = new T.Mesh(new T.BoxGeometry(0.28, 2.6, 0.28), post);
      p.position.set(x, 1.3, z); p.castShadow = true; scene.add(p);
    });
  }
  const rail = new T.MeshStandardMaterial({ color: 0x30343a, roughness: 0.9 });
  [[0, -FENCE, FENCE * 2, 0.12], [-FENCE, 0, 0.12, FENCE * 2], [FENCE, 0, 0.12, FENCE * 2]].forEach(([x, z, w, d]) => {
    const r = new T.Mesh(new T.BoxGeometry(w || 0.12, 0.1, d || 0.12), rail);
    r.position.set(x, 2.3, z); scene.add(r);
  });
}

const MAT = {};
function mat(key, color, opts) {
  if (!MAT[key]) MAT[key] = new T.MeshStandardMaterial(Object.assign({ color, roughness: 0.66, metalness: 0.34 }, opts || {}));
  return MAT[key];
}

/* ═══ THE YARD ════════════════════════════════════════════════════════════ */
export function rebuild() {
  if (!T || disposed) return;
  while (root.children.length) {
    const c = root.children.pop();
    root.remove(c);
    c.traverse(o => { if (o.geometry && !o.userData.shared) o.geometry.dispose(); });
  }
  units = {}; pads = []; flare = null; trucks = []; office = null;

  const s = St.S();
  const E = s.equip;
  const blockers = [];
  const interactables = [];

  /* Everything below goes through Models.build(slot, procedural). If an admin
     has set a url for the slot, that model is used; otherwise the primitives
     run. Callers never branch on which. */
  const put = (slot, proc, x, z, meta) => {
    const g = Models.build(slot, proc);
    g.position.set(x, 0, z);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.userData.pick = meta;
    root.add(g);
    (units[meta.id] = units[meta.id] || []).push(g);
    if (meta.blockR) blockers.push({ x, z, r: meta.blockR });
    if (meta.tab || meta.act) interactables.push({ id: meta.id, label: meta.label, hint: meta.hint, x, z, r: meta.reachR || 2.2, tab: meta.tab, act: meta.act });
    return g;
  };

  const place = (id, count, slot, proc, meta) => {
    for (let i = 0; i < count; i++) {
      const p = Build.plotPosition(id, i);
      put(slot, proc, p.x, p.z, Object.assign({ id }, meta, { index: i }));
    }
  };

  place('crudeTank', E.crudeTank | 0, 'crudeTank', () => tank(3.6, 4.2, 0x3a3126, 'crudeTank'),
    { label: 'Crude Tank', hint: 'Inspect and desalt shipments', tab: 'intake', blockR: 4.4, reachR: 4.0 });

  place('cdu', Math.max(1, E.cdu | 0), 'column', () => column(),
    { label: 'Distillation Column', hint: 'Take the column', tab: 'run', blockR: 3.4, reachR: 3.4 });

  const SEC = { cracker: 0xc2452d, reformer: 0xe8a13a, treater: 0x7fb0ff, alky: 0x9fe6e6 };
  for (const id in SEC) {
    place(id, E[id] | 0, id, () => reactor(SEC[id]),
      { label: EQUIPMENT[id].name, hint: 'Run the unit', tab: 'stock', blockR: 2.4, reachR: 3.0 });
  }

  place('blendTank', E.blendTank | 0, 'blendTank', () => blendTank(),
    { label: 'Blending Tank', hint: 'Work the bench', tab: 'blend', blockR: 3.4, reachR: 3.6 });

  place('storeTank', E.storeTank | 0, 'storeTank', () => tank(3.0, 5.0, 0xb9c0c8, 'storeTank', true),
    { label: 'Product Tank', hint: 'Tank farm and spot market', tab: 'stock', blockR: 3.6, reachR: 3.6 });

  place('bay', E.bay | 0, 'bay', () => bay(),
    { label: 'Loading Bay', hint: 'Dispatch a tanker', tab: 'ship', reachR: 4.4 });

  if ((E.lab | 0) > 0) place('lab', 1, 'lab', () => hut(0x6fd0a0),
    { label: 'Laboratory', hint: 'Test a batch', tab: 'blend', blockR: 3.2, reachR: 3.4 });
  if ((E.automation | 0) > 0) place('automation', 1, 'automation', () => hut(0x9b6fd0),
    { label: 'Automation Suite', hint: 'Autopilot settings', tab: 'run', blockR: 3.2, reachR: 3.4 });
  place('pumps', E.pumps | 0, 'pumps', () => pumpSkid(), { label: 'Pump Skid', id: 'pumps' });

  buildOffice(blockers, interactables);
  buildFlare();

  /* Parked trucks: the ones not out on the road, so the fleet is countable
     without opening a panel. */
  const out = s.convoy.length;
  for (let i = 0; i < Math.max(0, (E.truck | 0) - out); i++) {
    const p = Build.plotPosition('truck', i);
    const t = Models.build('truck', () => truckMesh(false));
    t.position.set(p.x, 0, p.z); t.rotation.y = Math.PI;
    t.traverse(o => { if (o.isMesh) o.castShadow = true; });
    root.add(t);
    blockers.push({ x: p.x, z: p.z, r: 2.6 });
  }

  buildPads(interactables);

  Walk.setWorld(player, { blockers, interactables, interiors: [OFFICE_IN] });
  if (player) Walk.rebuildAvatar(player);
}

/* ── BUILD PLOTS ──────────────────────────────────────────────────────────
   A marked-out pad on the ground the next unit of that type will occupy, with
   a floating plate naming it. Green when affordable, amber when not — so a
   walk round the yard tells you what you could put up right now without
   opening anything. */
function buildPads(interactables) {
  for (const p of Build.openPlots()) {
    const g = Models.build('buildPad', () => padMarker(p.ready));
    g.position.set(p.x, 0, p.z);
    g.userData.pad = p;
    root.add(g);
    pads.push(g);
    interactables.push({
      id: 'pad:' + p.id, label: 'Build ' + p.label + ' #' + p.next,
      hint: p.ready ? 'Materials on site' : 'Short of materials',
      x: p.x, z: p.z, r: 2.6, act: 'build', buildId: p.id, ready: p.ready,
    });
  }
}
function padMarker(ready) {
  const g = new T.Group();
  const col = ready ? 0x7bc043 : 0xe8a13a;
  const ring = new T.Mesh(new T.TorusGeometry(2.6, 0.09, 6, 32),
    new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.16; g.add(ring);
  // Corner stakes — surveyor's marks, not a glowing pad.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const st = new T.Mesh(new T.BoxGeometry(0.12, 0.85, 0.12), mat('stake', 0x9aa2ab, { metalness: 0.4 }));
    st.position.set(Math.cos(a) * 2.6, 0.42, Math.sin(a) * 2.6); g.add(st);
  }
  const beam = new T.Mesh(new T.CylinderGeometry(2.5, 2.5, 0.02, 24),
    new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.09, depthWrite: false }));
  beam.position.y = 0.05; g.add(beam);
  g.userData.ring = ring;
  return g;
}

/* ── THE OFFICE ═══════════════════════════════════════════════════════════
   Walls, a hinged door, and a roof that lifts and fades when you step in.
   The roof is its own slot so an admin can replace it separately — you cannot
   fade half a building. */
function buildOffice(blockers, interactables) {
  const g = new T.Group();
  g.position.set(OFFICE.x, 0, OFFICE.z);
  const W = OFFICE.w, D = OFFICE.d, H = OFFICE.h;

  const shell = Models.build('office', () => officeShell(W, D, H));
  g.add(shell);

  const roof = Models.build('officeRoof', () => officeRoof(W, D));
  roof.position.y = H;
  g.add(roof);

  /* Door on the west face, hinged on its left edge. The pivot is a separate
     Group so the door swings about its hinge rather than its centre — a door
     that rotates about the middle looks like a turnstile. */
  const hinge = new T.Group();
  hinge.position.set(-W / 2 + 0.06, 0, -DOOR_HALF);
  const door = Models.build('door', () => doorLeaf());
  door.position.set(0, 0, DOOR_HALF);
  hinge.add(door);
  g.add(hinge);

  const desk = Models.build('desk', () => deskMesh());
  desk.position.set(3.0, 0, 0); desk.rotation.y = -Math.PI / 2; g.add(desk);
  const chair = Models.build('chair', () => chairMesh());
  chair.position.set(1.3, 0, 0); chair.rotation.y = Math.PI / 2; g.add(chair);
  const comp = Models.build('computer', () => computerMesh());
  comp.position.set(3.0, 0.78, 0); comp.rotation.y = -Math.PI / 2; g.add(comp);

  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  root.add(g);
  office = { group: g, roof, hinge, doorOpen: 0, roofFade: 1, comp };

  /* Walls block, but the doorway does not. Four short blockers rather than one
     big one, leaving a gap on the west face where the door is. */
  const B = [
    { x: OFFICE.x, z: OFFICE.z - D / 2, r: 0 },
    { x: OFFICE.x, z: OFFICE.z + D / 2, r: 0 },
    { x: OFFICE.x + W / 2, z: OFFICE.z, r: 0 },
  ];
  // Long thin walls are approximated by a row of small circles — cheap, and
  // exact enough that you cannot walk through a wall at any angle.
  const spread = (x0, z0, x1, z1) => {
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.8);
    for (let i = 0; i <= n; i++) blockers.push({ x: x0 + (x1 - x0) * i / n, z: z0 + (z1 - z0) * i / n, r: 0.55 });
  };
  spread(OFFICE.x - W / 2, OFFICE.z - D / 2, OFFICE.x + W / 2, OFFICE.z - D / 2);
  spread(OFFICE.x - W / 2, OFFICE.z + D / 2, OFFICE.x + W / 2, OFFICE.z + D / 2);
  spread(OFFICE.x + W / 2, OFFICE.z - D / 2, OFFICE.x + W / 2, OFFICE.z + D / 2);
  /* West wall, with the doorway left open around the office's centre line.
     ⚠ THE GAP HAS TO BE WALKABLE. It was 2.7 units wide with 0.8-radius
     blockers either side, leaving about 1.1 units of clearance — a player
     walking straight at the door bounced off the wall and could not work out
     why. Centred, widened, and the blockers slimmed. */
  spread(OFFICE.x - W / 2, OFFICE.z - D / 2, OFFICE.x - W / 2, OFFICE.z - DOOR_HALF);
  spread(OFFICE.x - W / 2, OFFICE.z + DOOR_HALF, OFFICE.x - W / 2, OFFICE.z + D / 2);
  void B;

  interactables.push({ id: 'computer', label: 'Contract Terminal',
    hint: 'Review and accept contracts', x: OFFICE.x + 3.0, z: OFFICE.z, r: 3.4, tab: 'contracts' });
  /* ⚠ ONE interactable at the desk, not two. A separate "The Desk → ledger"
     pick sat 1.7 units from the terminal and, being nearer, won the focus —
     so walking up to the computer offered you the ledger instead. The ledger
     is a tab; the desk is where contracts get signed. */
  interactables.push({ id: 'door', label: 'Office Door',
    hint: 'Walk in — it opens for you', x: OFFICE.x - OFFICE.w / 2, z: OFFICE.z, r: 2.4, act: 'door' });
}

function officeShell(W, D, H) {
  const g = new T.Group();
  const wall = mat('officewall', 0x4a5058, { roughness: 0.88, metalness: 0.12 });
  const trim = mat('officetrim', 0xe8a13a, { roughness: 0.5, metalness: 0.3 });
  const mk = (w, h, d, x, y, z) => { const m = new T.Mesh(new T.BoxGeometry(w, h, d), wall); m.position.set(x, y, z); g.add(m); return m; };
  mk(W, H, 0.3, 0, H / 2, -D / 2);
  mk(W, H, 0.3, 0, H / 2, D / 2);
  mk(0.3, H, D, W / 2, H / 2, 0);
  // West face, split round the doorway and closed above it with a lintel.
  const side = D / 2 - DOOR_HALF;
  mk(0.3, H, side, -W / 2, H / 2, -D / 2 + side / 2);
  mk(0.3, H, side, -W / 2, H / 2,  D / 2 - side / 2);
  mk(0.3, H - 2.8, DOOR_HALF * 2, -W / 2, H - (H - 2.8) / 2, 0);
  // Floor, so the interior does not read as bare site when the roof lifts.
  const fl = new T.Mesh(new T.BoxGeometry(W - 0.4, 0.12, D - 0.4), mat('officefloor', 0x2f333a, { roughness: 0.95 }));
  fl.position.y = 0.06; g.add(fl);
  // A band of window along the yard-facing wall and a sign over the door.
  const glass = new T.Mesh(new T.BoxGeometry(W - 3, 1.5, 0.12),
    new T.MeshStandardMaterial({ color: 0x9fe6e6, roughness: 0.16, metalness: 0.5, transparent: true, opacity: 0.4 }));
  glass.position.set(0, 3.5, -D / 2 - 0.05); g.add(glass);
  const sign = new T.Mesh(new T.BoxGeometry(4.4, 0.75, 0.16), trim);
  sign.position.set(-W / 2 - 0.1, 3.5, 0); sign.rotation.y = Math.PI / 2; g.add(sign);
  return g;
}
function officeRoof(W, D) {
  const g = new T.Group();
  const r = new T.Mesh(new T.BoxGeometry(W + 0.7, 0.4, D + 0.7),
    mat('officeroof', 0x3a3f46, { roughness: 0.92 }));
  r.position.y = 0.2; g.add(r);
  const lip = new T.Mesh(new T.BoxGeometry(W + 0.9, 0.18, D + 0.9), mat('officelip', 0x54596180, { roughness: 0.9 }));
  lip.position.y = 0.44; g.add(lip);
  const vent = new T.Mesh(new T.CylinderGeometry(0.5, 0.5, 0.7, 10), mat('rail', 0x8d959e, { metalness: 0.6 }));
  vent.position.set(W / 4, 0.75, -D / 4); g.add(vent);
  return g;
}
function doorLeaf() {
  const g = new T.Group();
  const d = new T.Mesh(new T.BoxGeometry(0.14, 2.6, 1.25), mat('door', 0x8a5714, { roughness: 0.7, metalness: 0.2 }));
  d.position.set(0, 1.3, 0); g.add(d);
  const handle = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 0.3, 8), mat('rail', 0x8d959e, { metalness: 0.7 }));
  handle.rotation.x = Math.PI / 2; handle.position.set(0.12, 1.25, 0.45); g.add(handle);
  return g;
}
function deskMesh() {
  const g = new T.Group();
  const top = new T.Mesh(new T.BoxGeometry(2.4, 0.09, 1.1), mat('desk', 0x6b5236, { roughness: 0.72, metalness: 0.05 }));
  top.position.y = 0.74; g.add(top);
  [[-1.05, -0.45], [1.05, -0.45], [-1.05, 0.45], [1.05, 0.45]].forEach(([x, z]) => {
    const l = new T.Mesh(new T.BoxGeometry(0.09, 0.74, 0.09), mat('desklegs', 0x33373d, { metalness: 0.5 }));
    l.position.set(x, 0.37, z); g.add(l);
  });
  const draw = new T.Mesh(new T.BoxGeometry(0.7, 0.55, 0.95), mat('deskdraw', 0x55442d, { roughness: 0.8 }));
  draw.position.set(0.75, 0.42, 0); g.add(draw);
  return g;
}
function chairMesh() {
  const g = new T.Group();
  const seat = new T.Mesh(new T.BoxGeometry(0.55, 0.09, 0.55), mat('chair', 0x2a2f38, { roughness: 0.85 }));
  seat.position.y = 0.5; g.add(seat);
  const back = new T.Mesh(new T.BoxGeometry(0.55, 0.6, 0.08), mat('chair', 0x2a2f38));
  back.position.set(0, 0.82, -0.25); g.add(back);
  const post = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 0.5, 8), mat('rail', 0x8d959e, { metalness: 0.6 }));
  post.position.y = 0.25; g.add(post);
  const base = new T.Mesh(new T.CylinderGeometry(0.32, 0.32, 0.05, 12), mat('rail', 0x8d959e));
  base.position.y = 0.03; g.add(base);
  return g;
}
function computerMesh() {
  const g = new T.Group();
  const screen = new T.Mesh(new T.BoxGeometry(0.62, 0.42, 0.04), mat('screen', 0x15171a, { roughness: 0.3 }));
  screen.position.set(0, 0.34, 0); g.add(screen);
  /* The lit face is Basic, not Standard: a monitor emits, it does not take the
     yard's key light, and a Standard material here reads as a dead panel. */
  const glow = new T.Mesh(new T.PlaneGeometry(0.56, 0.36),
    new T.MeshBasicMaterial({ color: 0x7fd8c8 }));
  glow.position.set(0, 0.34, 0.025); g.add(glow);
  const stand = new T.Mesh(new T.BoxGeometry(0.1, 0.16, 0.1), mat('screen', 0x15171a));
  stand.position.y = 0.08; g.add(stand);
  const foot = new T.Mesh(new T.BoxGeometry(0.34, 0.03, 0.2), mat('screen', 0x15171a));
  foot.position.y = 0.015; g.add(foot);
  const kb = new T.Mesh(new T.BoxGeometry(0.5, 0.03, 0.18), mat('kb', 0x2c3036, { roughness: 0.8 }));
  kb.position.set(0, 0.015, 0.28); g.add(kb);
  g.userData.glow = glow;
  return g;
}

/* ── Yard primitives ─────────────────────────────────────────────────────── */
function tank(r, h, color, key, floatingRoof) {
  const g = new T.Group();
  /* ⚠ CLOSED, not open-ended. These were `openEnded: true` + DoubleSide, which
     the old fixed top-down camera hid completely — from standing height every
     tank read as an open basket you could see the inside of. */
  const shell = new T.Mesh(new T.CylinderGeometry(r, r, h, 20, 1, false), mat(key + '_shell', color, { roughness: 0.78, metalness: 0.4 }));
  shell.position.y = h / 2; g.add(shell);
  const base = new T.Mesh(new T.CylinderGeometry(r + 0.5, r + 0.7, 0.4, 20), mat('pad', 0x2f333a, { metalness: 0.05 }));
  base.position.y = 0.2; g.add(base);
  const roof = new T.Mesh(new T.CylinderGeometry(r * 0.97, r * 0.97, 0.3, 20), mat(key + '_roof', color, { roughness: 0.6 }));
  roof.position.y = floatingRoof ? h * 0.5 : h + 0.15;
  g.add(roof);
  g.userData.roof = roof; g.userData.h = h;
  const ring = new T.Mesh(new T.TorusGeometry(r + 0.12, 0.07, 6, 22), mat('rail', 0x8d959e, { metalness: 0.6 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = h * 0.82; g.add(ring);
  // A ladder, so the tank reads as something people service.
  const lad = new T.Mesh(new T.BoxGeometry(0.08, h, 0.5), mat('rail', 0x8d959e));
  lad.position.set(r + 0.1, h / 2, 0); g.add(lad);
  return g;
}
function column() {
  const g = new T.Group();
  const h = 21;
  const body = new T.Mesh(new T.CylinderGeometry(2.1, 2.6, h, 18), mat('col', 0xb0b6bd, { roughness: 0.55, metalness: 0.55 }));
  body.position.y = h / 2; g.add(body);
  for (let i = 1; i <= 5; i++) {
    const b = new T.Mesh(new T.TorusGeometry(2.28 - i * 0.04, 0.13, 6, 20), mat('band', 0x6a727b, { metalness: 0.7 }));
    b.rotation.x = Math.PI / 2; b.position.y = i * (h / 6.2); g.add(b);
  }
  const cap = new T.Mesh(new T.SphereGeometry(2.1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat('col', 0xb0b6bd));
  cap.position.y = h; g.add(cap);
  const skirt = new T.Mesh(new T.CylinderGeometry(2.9, 3.3, 1.0, 18), mat('pad', 0x2f333a));
  skirt.position.y = 0.5; g.add(skirt);
  const pipe = new T.Mesh(new T.BoxGeometry(13, 0.34, 0.34), mat('pipe', 0x8a929c, { metalness: 0.65 }));
  pipe.position.set(5.6, h * 0.72, 0); g.add(pipe);
  return g;
}
function reactor(color) {
  const g = new T.Group();
  const body = new T.Mesh(new T.CylinderGeometry(1.5, 1.5, 7.5, 16), mat('r' + color, color, { roughness: 0.5, metalness: 0.6 }));
  body.position.y = 4.35; g.add(body);
  const dome = new T.Mesh(new T.SphereGeometry(1.5, 14, 8), mat('r' + color, color));
  dome.position.y = 8.35; dome.scale.y = 0.55; g.add(dome);
  const legs = new T.Mesh(new T.BoxGeometry(3.6, 1.2, 3.6), mat('pad', 0x2f333a));
  legs.position.y = 0.6; g.add(legs);
  const stack = new T.Mesh(new T.CylinderGeometry(0.3, 0.4, 4.4, 10), mat('pipe', 0x8a929c));
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
  const barrel = new T.Mesh(new T.CylinderGeometry(1.1, 1.1, 5.6, 14), mat('barrel' + (loaded ? 'L' : ''), loaded ? 0xd8dde2 : 0x9aa2ab, { metalness: 0.7, roughness: 0.4 }));
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 1.5, -1.4); g.add(barrel);
  const chassis = new T.Mesh(new T.BoxGeometry(1.9, 0.4, 7.6), mat('pad', 0x2f333a));
  chassis.position.y = 0.6; g.add(chassis);
  [[-1, 2.2], [1, 2.2], [-1, -2.4], [1, -2.4], [-1, -3.6], [1, -3.6]].forEach(([x, z]) => {
    const w = new T.Mesh(new T.CylinderGeometry(0.55, 0.55, 0.35, 10), mat('tyre', 0x15171a, { metalness: 0.05, roughness: 1 }));
    w.rotation.z = Math.PI / 2; w.position.set(x, 0.55, z); g.add(w);
  });
  return g;
}
function buildFlare() {
  const g = new T.Group();
  const stack = new T.Mesh(new T.CylinderGeometry(0.5, 0.75, 17, 12), mat('flarestack', 0x5d6167, { metalness: 0.5 }));
  stack.position.y = 8.5; g.add(stack);
  const tip = new T.Mesh(new T.CylinderGeometry(0.85, 0.55, 1.2, 12), mat('flaretip', 0x2f333a));
  tip.position.y = 17.4; g.add(tip);
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

/* ═══ LIVE STATE → VISUALS ════════════════════════════════════════════════ */
let live = { severity: 0, running: false, quality: 1 };
export function setLive(next) { live = Object.assign(live, next || {}); }

function animate() {
  if (disposed) return;
  raf = requestAnimationFrame(animate);
  const now = performance.now() / 1000;
  const dt = Math.min(0.05, now - (clock || now));
  clock = now;

  if (player && !overview) Walk.step(player, dt, FENCE - 1.5);
  else if (overview) overviewCamera(dt);

  const s = St.S();
  const blending = s.batches.length > 0 || live.blending;
  for (const b of (units.blendTank || [])) {
    if (b.userData.agitator) b.userData.agitator.rotation.y += (blending ? 3.4 : 0.25) * dt;
  }

  const fillPct = Math.max(0, Math.min(1, live.storeFill == null ? 0 : live.storeFill));
  for (const t of (units.storeTank || [])) {
    if (!t.userData.roof) continue;
    const h = t.userData.h;
    const target = 0.45 + fillPct * (h - 0.8);
    t.userData.roof.position.y += (target - t.userData.roof.position.y) * 0.06;
  }

  /* ── THE OFFICE. The door swings when you are near it and the roof lifts
     away and fades once you are inside. Both are eased, because a roof that
     pops out of existence reads as a rendering fault rather than a reveal. */
  if (office && player) {
    const dx = player.pos.x - (OFFICE.x - OFFICE.w / 2), dz = player.pos.z - (OFFICE.z - 1.4);
    const nearDoor = Math.hypot(dx, dz) < 4.6 || !!player.inside;
    const wantDoor = nearDoor ? 1 : 0;
    office.doorOpen += (wantDoor - office.doorOpen) * Math.min(1, 5.5 * dt);
    office.hinge.rotation.y = -office.doorOpen * (Math.PI * 0.62);

    const wantRoof = player.inside === 'office' ? 0 : 1;
    office.roofFade += (wantRoof - office.roofFade) * Math.min(1, 6 * dt);
    const f = office.roofFade;
    office.roof.visible = f > 0.02;
    office.roof.position.y = OFFICE.h + (1 - f) * 5.5;
    office.roof.traverse(o => {
      if (!o.isMesh || !o.material) return;
      o.material.transparent = true;
      o.material.opacity = f;
      o.material.depthWrite = f > 0.9;
    });
    if (office.comp && office.comp.userData.glow) {
      // The terminal pulses when there is something on the board to look at.
      const pending = (s.offers || []).length;
      office.comp.userData.glow.material.color.setHSL(0.45, 0.55, pending ? 0.5 + Math.sin(now * 3) * 0.09 : 0.34);
    }
  }

  // Pads breathe so they read as markers rather than scenery.
  for (const p of pads) {
    if (p.userData.ring) p.userData.ring.material.opacity = 0.42 + Math.sin(now * 2.2) * 0.14;
  }

  if (flare) {
    const sev = live.running ? Math.max(0, live.severity - 0.92) : 0;
    const want = Math.min(1, sev * 2.1);
    const fl = flare.userData.flame, gl = flare.userData.glow;
    const flick = 0.82 + Math.sin(now * 21) * 0.12 + Math.sin(now * 7.3) * 0.06;
    fl.material.opacity += (want * 0.85 * flick - fl.material.opacity) * 0.12;
    fl.scale.setScalar(0.6 + want * (0.9 + flick * 0.35));
    fl.position.y = 20 + want * 1.6;
    gl.intensity += (want * 3.4 - gl.intensity) * 0.12;
    fl.material.color.setHSL(0.075 - want * 0.045, 1, 0.5 + want * 0.12);
  }

  syncTrucks();
  for (const t of trucks) {
    const p = Math.max(0, Math.min(1, t.userData.prog()));
    t.position.set(t.userData.lane, 0, 26 - p * 96);
    t.rotation.y = Math.PI;
  }

  if (hooks.onFrame) { try { hooks.onFrame(player && player.focus); } catch (e) {} }
  if (renderer && scene && camera) renderer.render(scene, camera);
}

function syncTrucks() {
  const s = St.S();
  const ids = s.convoy.map(t => t.id);
  for (let i = trucks.length - 1; i >= 0; i--) {
    if (ids.indexOf(trucks[i].userData.cid) < 0) { root.remove(trucks[i]); trucks.splice(i, 1); }
  }
  for (const c of s.convoy) {
    if (trucks.some(t => t.userData.cid === c.id)) continue;
    const m = Models.build('truck', () => truckMesh(true));
    m.userData.cid = c.id;
    m.userData.lane = -8 + (trucks.length % 3) * 8;
    m.userData.prog = () => Math.max(0, Math.min(1, (Date.now() - c.leftAt) / Math.max(1, c.etaMs)));
    trucks.push(m); root.add(m);
  }
}

/* ── OVERVIEW ─────────────────────────────────────────────────────────────
   The original fixed top-down framing, kept as a toggle. It is the fastest way
   to read the whole site, and losing it entirely to the walking camera would
   have been a downgrade for anyone planning where to build. */
export function setOverview(on) {
  overview = !!on;
  if (player) player.enabled = !overview;
  if (overview) frameYard();
}
function frameYard() {
  if (!camera) return;
  const half = YARD_SPAN / 2;
  const f = Math.tan((camera.fov * Math.PI / 180) / 2);
  const d = Math.max(half / f, (half / camera.aspect) / f);
  camera.position.set(YARD_CX, d * 0.94, YARD_CZ + d * 0.30);
  camera.lookAt(YARD_CX, 2, YARD_CZ);
  camera.updateProjectionMatrix();
}
function overviewCamera() { frameYard(); }

export function start() { if (!raf && !disposed) { clock = 0; animate(); } }

function onResize() {
  if (!renderer || !host) return;
  const w = Math.max(320, host.clientWidth || 800);
  const h = Math.max(240, host.clientHeight || 460);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (overview) frameYard();
  renderer.setSize(w, h, false);
}

export function dispose() {
  disposed = true;
  try { cancelAnimationFrame(raf); } catch (e) {}
  raf = 0;
  try { Walk.dispose(player); } catch (e) {}
  player = null;
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
  scene = camera = renderer = root = flare = office = null;
  units = {}; trucks = []; pads = []; host = null;
}
