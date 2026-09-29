/* ═══════════════════════════════════════════════════════════════════════════
   🗺 SUPPLY CHAIN · scene.js — the 3D map (three.js r128, the global build).

   mountScene(host, graph, cb) → Promise of
     { select(id), home(), highlightFlow(resId|null), setFilter(f), renderNow(t?),
       project(id), stats(), dispose() }   or null when there is no WebGL.

   WHAT THE PICTURE SAYS, and why it is laid out this way:
     · The owner's p1 reads left to right: Battle System → Just Business →
       City Builder → Camp, with "Market Place Resources" + a Cinder flame at
       every hand-off. So the four systems are four DISTRICTS left to right,
       joined by Marketplace GATES with a flame on the lintel.
     · The owner's p6-p8 put Transport top-centre of every page and a truck
       beside most tiles. So Transport is the RAISED HUB in the middle of its
       district, the tiles stand in two rows facing it, and every supply and
       sale lane is a curve that bends THROUGH the hub deck with freight on it.
       Nothing here decides that a lane goes through Transport — graph.js
       hands each edge `via:'transport'` and a lane with a haul leg; this file
       only draws what it is given, and an edge with no `via` is drawn as a
       direct arc so a missing haul is VISIBLE, not hidden.
     · Loot streams (kind 'loot') leave the Battle / City / Camp districts as
       high ember arcs into the businesses that use them, with embers riding
       them, so "every business needs battle loot" has a shape.
     · A `planned` tile (Fashion Brand, Airport) is ghosted and dashed and its
       plate says PLANNED; a lane that moves nothing today (`live:false`) is
       dashed and carries no truck (contract rule 3: live vs proposed must
       read without colour).

   THIS FILE NEVER NAMES A BUSINESS ID. Rows, districts, gates, the hub and
   the tow-truck lot are all derived from the graph (type / kind / system /
   group / order / badges / edges). Buildings come from scene.nodes.js by
   lookup. Every knob is SC.* (tuning.js); every derived distance is a
   multiple of SC.layout sizes, so there is no second place where "how big a
   tile is" is written down.

   ⚠ RAF drives only the picture. Freight, embers and the idle turntable are
     clocked on Date.now(); camera tweens on performance.now(). The Browser
     pane composites at ~0.56 Hz (CLAUDE.md) and a frame-counted animation
     there is either frozen or minutes long. renderNow(t) takes an explicit
     clock so a test can photograph a deterministic frame.
   ⚠ Picking uses ONE INVISIBLE PROXY BOX per node (carfactory/scene.garage.js):
     r128's Raycaster does not skip `visible:false`, the proxy costs nothing
     to draw, and a click in the gap between a crane and its wall still
     selects the tile — which is what a player means.
   ⚠ DRAW CALLS. Every lane of one style is ONE LineSegments with vertex
     colours (highlighting rewrites the colour attribute, never the scene
     graph); freight is one InstancedMesh; embers one Points; every building
     is baked to one mesh per material (scene.nodes.js). ~250 calls at
     overview on software WebGL; the bar is under 400. stats() reports it.
   🔴 NO WEBGL IS NOT AN ERROR. Resolves null; fallback.js draws the map.
   ═══════════════════════════════════════════════════════════════════════════ */

import { boot, webglOk, reducedMotion } from '../weaponsmith/three.boot.js';
import { SC } from './tuning.js';
import { makeMaterials, buildNode, paintPlate, signSprite, tools, registerNodeMesh, NODE_MESH } from './scene.nodes.js';

export { registerNodeMesh, NODE_MESH };

const L = SC.layout, CAM = SC.camera, PAL = SC.palette;
const hex = (css) => parseInt(String(css).replace('#', ''), 16);
const rad = (d) => d * Math.PI / 180;
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; };

/* ───────────────────────────────────────────── stage: renderer + lights ── */
function envMap(T, renderer) {
  /* A tiny lit room baked through PMREM — without an environment every
     metallic surface (steel, gold) renders near-black (carfactory/scene.js).
     Warm strips, not the factory's blue: the reflections are chrome too. */
  try {
    const env = new T.Scene(), pm = new T.PMREMGenerator(renderer);
    env.add(new T.Mesh(new T.BoxGeometry(40, 20, 40), new T.MeshBasicMaterial({ color: 0x1a1712, side: T.BackSide })));
    const strip = (c, w, d, x, y, z) => { const m = new T.Mesh(new T.BoxGeometry(w, 0.2, d), new T.MeshBasicMaterial({ color: c })); m.position.set(x, y, z); env.add(m); };
    for (let i = -2; i <= 2; i++) strip(0xfff3d6, 2, 12, i * 5, 9.6, 0);
    strip(0xffe0a8, 30, 1.5, 0, 4, 18); strip(0xd9cbaa, 30, 1.5, 0, 5, -18); strip(0xd4af37, 1.5, 30, -18, 3, 0);
    const tex = pm.fromScene(env, 0.04).texture;
    pm.dispose(); env.traverse((n) => { if (n.geometry) n.geometry.dispose(); if (n.material) n.material.dispose(); });
    return tex;
  } catch (e) { return null; }
}

async function stage(host) {
  if (!host || !webglOk()) return null;
  const T = await boot();
  if (!T) return null;
  let renderer;
  try { renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' }); } catch (e) { return null; }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene();
  const bg = new T.Color(hex(PAL.bgDeep)).convertSRGBToLinear();
  scene.background = bg; scene.fog = new T.Fog(bg, 140, 260);
  const env = envMap(T, renderer); if (env) scene.environment = env;
  const cam = new T.PerspectiveCamera(CAM.fov, 16 / 9, CAM.near, CAM.far);
  scene.add(new T.HemisphereLight(0xfff1d6, 0x2a241c, 0.75));
  const key = new T.DirectionalLight(0xfff0d8, 1.05); key.position.set(-40, 70, 50);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0005; key.shadow.normalBias = 0.03;
  const sc = key.shadow.camera; sc.left = -80; sc.right = 80; sc.top = 60; sc.bottom = -60; sc.near = 10; sc.far = 220;
  scene.add(key);
  const rim = new T.DirectionalLight(0xd4af37, 0.25); rim.position.set(60, 30, -60); scene.add(rim);
  const cv = renderer.domElement;
  cv.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;outline:none';
  host.appendChild(cv);
  /* Width-gated AND height-gated, deferred off the observer's own turn: fit()
     changes the canvas size, which re-fires the observer, which the pane logs
     as "ResizeObserver loop completed" (carfactory/scene.js). */
  let lastW = -1, lastH = -1; const onFit = [];
  const fit = () => {
    const w = Math.max(280, host.clientWidth || 640), h = Math.max(200, host.clientHeight || Math.round(w * 9 / 16));
    if (w === lastW && h === lastH) return;
    lastW = w; lastH = h;
    renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
    for (const f of onFit) f(w, h);
  };
  fit();
  let ro = null; try { ro = new ResizeObserver(() => setTimeout(fit, 0)); ro.observe(host); } catch (e) {}
  const kill = () => {
    try { ro && ro.disconnect(); } catch (e) {}
    scene.traverse((n) => { if (n.geometry) n.geometry.dispose(); if (n.material) (Array.isArray(n.material) ? n.material : [n.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); }); });
    try { env && env.dispose(); } catch (e) {}
    renderer.dispose(); try { renderer.forceContextLoss(); } catch (e) {} try { cv.remove(); } catch (e) {}
  };
  return { T, renderer, scene, cam, cv, fit, onFit, kill, size: () => ({ w: lastW, h: lastH }) };
}

/* ─────────────────────────────────────────────────────── layout (pure) ── */
/* Positions for every node, derived from the graph alone. Exported so a test
   (and fallback.js, if it wants the same order) can check it without WebGL. */
export function layoutGraph(graph) {
  const nodes = (graph && graph.nodes) || [];
  const edgesAll = (graph && graph.edges) || [];
  const pitch = L.tile.w * 1.3;                                 // tile-to-tile distance in a row (1.26 units of street between plinths)
  const gap = L.hubTile.w * 0.75;                               // between districts: room for a gate
  const systems = nodes.filter((n) => n.type === 'system').slice().sort((a, b) => (a.order - b.order) || 0);
  const hub = nodes.find((n) => n.kind === 'hub') || null;
  const pos = new Map();                                        // id -> {x,y,z, district, col, row, stagger, street}
  const districts = [];
  const pageOf = (n) => +n.page || 0;
  const byRow = (a, b) => (pageOf(a) - pageOf(b)) || ((a.order || 0) - (b.order || 0));
  let cursor = 0;                                               // left edge of the next district
  let streets = null;                                           // the hub district's street plan, for lane routing
  for (const sys of systems) {
    const tiles = nodes.filter((n) => n.type === 'business' && n.system === sys.id && n !== hub).sort(byRow);
    const hasHub = !!hub && hub.system === sys.id;
    let width, depth, cx;
    if (hasHub) {
      /* FOUR ROWS facing the hub — two behind it, two in front — in an EVEN
         number of columns, so the centre column line is empty: that is the
         AVENUE every lane drives down to reach the hub deck. Between each
         row and the hub runs a STREET; a tile's lane leaves its plinth for
         its street, turns onto the avenue, and climbs the deck. Manhattan
         routing was chosen over straight spokes because a spoke from an
         outer-row tile cuts through an inner-row roof, and because streets
         are what trucks drive on.

         Filled in PDF page order, back-outer row first, left to right, so a
         page's tiles stay together the way they do on paper.

         The rows stand WELL apart in z. A 16:9 frame at the home tilt has far
         more room front-to-back than the map uses (width sets the zoom), so
         depth is free and spending it separates the rows of name plates on
         screen — the difference between a legible map and a pile. */
      const n = tiles.length;
      const perSide = n > 12 ? 2 : 1;
      let cols = Math.max(2, Math.ceil(n / (2 * perSide))); if (cols % 2) cols++;
      /* 🔴 DEPTH IS WHAT SEPARATES THE ROWS NOW. Rounds 1-5 separated them by
         lifting each row's name plates a rung higher; the plates ended up 300
         px above their own buildings and all 27 buildings shared 28% of the
         frame. Depth is the honest axis for it, and it is nearly free: the
         overview camera pitch is derived from the map's own depth (home()), so
         a deeper map is simply looked at from higher up and lands in the same
         frame — the rows spread down the screen instead of the plates
         spreading up into the sky. */
      const innerZ = L.hubTile.d / 2 + L.tile.d / 2 + pitch * 1.1;
      const outerZ = innerZ + pitch * 2.7;
      const rowsZ = perSide === 2 ? [-outerZ, -innerZ, innerZ, outerZ] : [-innerZ, innerZ];
      const streetOf = (z) => (z < 0 ? -1 : 1) * (Math.abs(z) === innerZ ? (L.hubTile.d / 2 + innerZ - L.tile.d / 2) / 2 : (innerZ + outerZ) / 2);
      /* 🔴 COLUMNS STAND WIDER THAN ROWS ARE DEEP — round 1's one real defect.
         A name plate is a FIXED-PIXEL sprite about 118 css px wide
         (scene.nodes.js), so its screen width does not shrink when the map
         grows; only the gap between plinths does. At the base pitch the home
         zoom left the plinths ~79 px apart, every plate in a row overlapped
         both neighbours, and the overview was a wall of text with the
         buildings hidden BEHIND it — the exact opposite of "27 tiles
         individually recognisable AND labelled".
         Widening only THIS district's columns buys more than it costs,
         because the other three districts keep their width and the camera
         zoom is set by the whole map: the map grows ~30%, the column gap
         grows ~90%. Measured at 1600x900: 79 px -> ~124 px, i.e. just past
         the plate width. Rejected alternatives: shrinking the plate (illegible
         at overview, which is the zoom the bar photographs) and more rows
         (rows pile up in screen-Y far faster than columns do in screen-X). */
      const colPitch = pitch * 1.9;
      /* …and a row further from the camera is spread WIDER in world units to
         come out the same width on screen. Plates are fixed-pixel, the map is
         perspective: at the home distance the back row sits about 40% further
         away than the front row, so an identical world pitch buys it ~40% less
         screen gap — which is why round 2 still had the back row's plates
         overlapping while the front row's were clear. The compensation is a
         straight ramp across the rows; exact reciprocal-depth was rejected
         because it depends on the camera and layoutGraph is pure. */
      const xSpread = (ladder) => 1 + (ladder / Math.max(1, rowsZ.length - 1)) * 0.42;
      /* 🔴 THE AVENUE IS A GAP IN THE PLATE WALL, NOT JUST IN THE PLINTHS.
         The centre column was left empty of TILES so the lanes had a road to
         drive down — but a name plate is ~118 fixed pixels wide, far wider
         than the plinth it labels, so the plates of the two columns either
         side met in the middle and walled the avenue off anyway. The hub's
         own caption then had nowhere to sit that did not cover a neighbour's
         name (SALVAGE OPERATION and SMUGGLING NETWORK, photographed). Pushing
         every column half a pitch further from the centre line costs the map
         about 7% of its width and buys a genuinely clear corridor down the
         middle for the hub, its sign and the road rule. */
      const avenue = colPitch * 0.55;
      const halfW = (cols - 1) / 2 * colPitch * xSpread(rowsZ.length - 1) + avenue + L.tile.w / 2;
      width = halfW * 2; cx = cursor + halfW;
      const slots = [];
      /* `ladder` = how many rows stand IN FRONT of this one. It is the rung of
         the name-plate mast in the mount below: a row further back gets a
         taller mast, so the four rows of plates FAN APART in screen-Y instead
         of landing in one band. (A back row already projects higher; raising
         its plate further widens that gap rather than fighting it.) Kept here,
         with the slot, because it is a property of the LAYOUT — the mount must
         not have to know how many rows a district happens to have. */
      for (let r = 0; r < rowsZ.length; r++) { const lad = rowsZ.length - 1 - r; for (let c = 0; c < cols; c++) { const sx = (c - (cols - 1) / 2) * colPitch * xSpread(lad); slots.push({ x: sx + Math.sign(sx) * avenue, z: rowsZ[r], col: c, row: r, ladder: lad, street: streetOf(rowsZ[r]) }); } }
      tiles.forEach((t, i) => { const sl = slots[i] || slots[slots.length - 1]; pos.set(t.id, { x: cx + sl.x, y: 0, z: sl.z, district: sys.id, col: sl.col, row: sl.row, ladder: sl.ladder, stagger: sl.col % 2, street: sl.street }); });
      pos.set(hub.id, { x: cx, y: 0, z: 0, district: sys.id, hub: true });
      const backZ = -(outerZ + pitch * 1.9);
      /* Back-LEFT, not back-centre. The hub stands on the district's centre
         line and its plate is the tallest one, so a landmark on the same line
         puts the two biggest plates in the map into the same column of pixels
         and one hides the other. Every other district keeps its landmark
         centred (nothing tall stands in front of it there). */
      pos.set(sys.id, { x: cx - halfW * 0.86, y: 0, z: backZ, district: sys.id, landmark: true, street: backZ });
      streets = { avenueX: cx, innerZ, outerZ, frontZ: outerZ + pitch * 1.9, backZ };
      depth = (outerZ + pitch * 1.9) * 2 + L.systemTile.d * 0.6;
    } else {
      /* A landmark with its tiles (if any) in a row in front of it. */
      /* Same fixed-pixel plate, same answer: the row is spread on the plate's
         pitch, not the plinth's. City Builder's three tiles at the base pitch
         had Rail Road, Airport and Bus Company written on top of each other.
         `ladder` alternates so consecutive plates never share a baseline. */
      const rowPitch = pitch * 1.9;
      const rowW = tiles.length ? (tiles.length - 1) * rowPitch + L.tile.w : 0;
      width = Math.max(L.systemTile.w, rowW); cx = cursor + width / 2;
      pos.set(sys.id, { x: cx, y: 0, z: tiles.length ? -pitch * 1.6 : 0, district: sys.id, landmark: true });
      tiles.forEach((n, i) => pos.set(n.id, { x: cx + (i - (tiles.length - 1) / 2) * rowPitch, y: 0, z: pitch * 1.7, district: sys.id, col: i, row: 1, ladder: i % 2 }));
      depth = tiles.length ? pitch * 3.8 + L.tile.d : L.systemTile.d + pitch;
    }
    const margin = pitch * 0.5;
    districts.push({ id: sys.id, x: cx, z: 0, w: width + margin * 2, d: Math.max(depth, L.systemTile.d + pitch * 2), left: cursor - margin, right: cursor + width + margin, tiles: tiles.map((t) => t.id), hasHub });
    cursor += width + margin * 2 + gap;
  }
  /* Channels. The Marketplace is a gate in the gap AFTER the hub's district
     (where the owner's p1 arrow leaves Just Business); copies of the gate
     stand at every other drawn system hand-off and all of them pick as the
     same node. The Car Marketplace is the channel whose sellers are (nearly)
     all tow-truck-badged tiles: a lot in front of the district they stand in.
     Round 1 tested "does any car-badged tile sell here" and put BOTH channels
     on the lot, because every car dealer also sells on the Marketplace. */
  const sysEdges = edgesAll.filter((e) => e.kind === 'system' && e.pdf);
  const dIdx = new Map(districts.map((d, i) => [d.id, i]));
  const gates = [];
  for (const e of sysEdges) {
    const a = districts[dIdx.get(e.from)], b = districts[dIdx.get(e.to)];
    if (!a || !b) continue;
    gates.push({ edge: e.id, from: e.from, to: e.to, x: (a.right + b.left) / 2, z: 0, label: e.label || null });
  }
  const hubD = districts.find((d) => d.hasHub) || districts[0];
  const mainGate = gates.find((g) => hubD && g.from === hubD.id) || gates[0] || null;
  const channels = nodes.filter((n) => n.type === 'channel');
  const carShare = (ch) => { const inn = edgesAll.filter((e) => e.kind === 'channel' && e.to === ch.id); if (!inn.length) return 0; const car = inn.filter((e) => { const s = nodes.find((n) => n.id === e.from); return s && s.badges && s.badges.carMarket; }); return car.length / inn.length; };
  let carCh = null, best = 0.5;
  for (const ch of channels) { const sh = carShare(ch); if (sh > best) { best = sh; carCh = ch; } }
  let gateTaken = false;
  const lotZ = streets ? streets.frontZ : L.hubTile.d * 2;
  for (const ch of channels) {
    if (ch === carCh) {
      const seller = edgesAll.find((e) => e.kind === 'channel' && e.to === ch.id);
      const homeSys = seller && (nodes.find((n) => n.id === seller.from) || {}).system;
      const home = (homeSys && districts[dIdx.get(homeSys)]) || hubD;
      pos.set(ch.id, { x: home.x + pitch * 0.5, y: 0, z: lotZ, district: home.id, lot: true, street: lotZ });
    } else if (mainGate && !gateTaken) {
      gateTaken = true;
      pos.set(ch.id, { x: mainGate.x, y: 0, z: 0, gate: true });
    } else {
      pos.set(ch.id, { x: hubD ? hubD.x - pitch * 1.5 : 0, y: 0, z: lotZ, street: lotZ });
    }
  }
  const marketId = (channels.find((n) => pos.get(n.id) && pos.get(n.id).gate) || {}).id || null;
  // bounds for the camera
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const d of districts) { minX = Math.min(minX, d.x - d.w / 2); maxX = Math.max(maxX, d.x + d.w / 2); minZ = Math.min(minZ, -d.d / 2); maxZ = Math.max(maxZ, d.d / 2); }
  if (!isFinite(minX)) { minX = -10; maxX = 10; minZ = -10; maxZ = 10; }
  return { pos, districts, gates, marketId, hubId: hub ? hub.id : null, pitch, streets, bounds: { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 } };
}

/* ─────────────────────────────────────────────────────────── the mount ── */
export async function mountScene(host, graph, cb) {
  cb = cb || {};
  const S = await stage(host);
  if (!S) return null;
  const { T, renderer, scene, cam, cv } = S;
  const still = reducedMotion();
  const MAT = makeMaterials(T);
  const G = graph || { nodes: [], edges: [], lanes: [] };
  const nodes = G.nodes || [], edges = G.edges || [];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const LAY = layoutGraph(G);
  const world = new T.Group(); scene.add(world);
  const disposables = [];
  /* 🔴 THE DRAWN HUB IS BIGGER THAN ITS LAYOUT FOOTPRINT. layoutGraph spaces
     the district on L.hubTile so the streets and the empty centre avenue come
     out right; but at the home zoom a hub the size of one tile is one
     building among twenty-odd, and round 3's uncaptioned overview could not
     say which one was Transport. The lane geometry already keeps a wide
     clearance around the hub (the avenue column is empty and the inner rows
     stand ~10 units away), so the DRAWING can spend it: a footprint a
     quarter wider and a deck nearly twice as tall lift the gantry clear of
     the front rows' name plates without moving a single tile. Everything the
     hub owns — ring, skirt, throat, ramp, caption, pick box — is derived from
     these three numbers, so there is one place to change it. */
  const HUBSCALE = L.hubTile.w / L.tile.w * 1.05;
  const HUBSZ = { w: L.hubTile.w * 1.25, d: L.hubTile.d * 1.05, h: L.hubTile.h * 1.35 };
  const HUBW = HUBSZ.w * HUBSCALE, HUBD = HUBSZ.d * HUBSCALE, HUBH = HUBSZ.h * HUBSCALE;

  /* fonts: paint plates once Cinzel is in, so a screenshot never shows the
     fallback serif; never wait more than a beat for it */
  try { if (document.fonts && document.fonts.load) await Promise.race([Promise.all([document.fonts.load('700 16px Cinzel'), document.fonts.ready]), new Promise((r) => setTimeout(r, 1500))]); } catch (e) {}

  /* ── ground + districts ─────────────────────────────────────────────── */
  const ground = new T.Mesh(new T.PlaneGeometry(L.groundSize * 2.6, L.groundSize * 3.4), new T.MeshStandardMaterial({ color: new T.Color(hex(PAL.bgDeep)).convertSRGBToLinear(), roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(LAY.bounds.cx, -0.02, 0); ground.receiveShadow = true; world.add(ground);
  const slabMat = new T.MeshStandardMaterial({ color: new T.Color(hex(PAL.bgPanel)).convertSRGBToLinear(), roughness: 0.95 });
  const edgeMat = new T.LineBasicMaterial({ color: hex(PAL.border), transparent: true, opacity: 0.9 });
  for (const d of LAY.districts) {
    const slab = new T.Mesh(new T.BoxGeometry(d.w, 0.12, d.d), slabMat); slab.position.set(d.x, 0.0, d.z); slab.receiveShadow = true; world.add(slab);
    const rim = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(d.w, 0.12, d.d)), edgeMat); rim.position.copy(slab.position); world.add(rim);
    /* 🔴 EACH DISTRICT IS NAMED ONCE. It used to be named twice — a floating
       plate AND a name engraved on the slab — in two different styles, and
       the engraved copy was the one that failed: perspective squashes a
       ground decal to nothing at the back of the map and the buildings and
       pads stand on top of it, so it photographed as "TY … LDER" and
       "TTLE SYSTEM". Two names for one thing, one of them broken, is worse
       than one name. The banner (scene.nodes.js, isSys) carries it. */
  }
  /* roads through the gates: the owner's p1 arrows, one per drawn system edge */
  const gateSigns = [];
  const roadMat = new T.MeshStandardMaterial({ color: new T.Color(hex(PAL.border)).convertSRGBToLinear(), roughness: 0.9 });
  const dById = new Map(LAY.districts.map((d) => [d.id, d]));
  for (const g of LAY.gates) {
    const a = dById.get(g.from), b = dById.get(g.to); if (!a || !b) continue;
    const x0 = a.x + a.w / 2 - 2, x1 = b.x - b.w / 2 + 2;
    const road = new T.Mesh(new T.BoxGeometry(x1 - x0, 0.1, 2.4), roadMat); road.position.set((x0 + x1) / 2, 0.02, 0); world.add(road);
    const head = new T.Mesh(new T.ConeGeometry(1.6, 2.4, 3), roadMat); head.rotation.set(-Math.PI / 2, 0, -Math.PI / 2); head.position.set(x1 + 0.6, 0.06, 0); world.add(head);
    /* 🔴 THE GATE NAME IS ON THE ARCH, NOT ON THE TARMAC. As a ground decal it
       photographed as "KET PLACE RESOUR": a 9-unit plane at the far end of a
       map seen from above is a few pixels tall, the district slabs stand
       proud of it at both ends, and the arch itself covers the middle. Stood
       up and hung on the lintel it is a sign — which is what a gate name is —
       and it is the one label on the map that must be readable, because the
       owner's p1 writes "Market Place Resources" at every hand-off. */
    /* …but NOT at the gate where the Marketplace channel node itself stands:
       that arch already carries a readable green MARKETPLACE plate, and two
       names on one arch is the same duplication that cost the districts their
       ground decals. (It cost more than tidiness: the extra sign displaced the
       channel plate left onto MEDICAL CORPORATION's roof, photographed.) */
    const takenByChannel = nodes.some((n) => n.type === 'channel' && (LAY.pos.get(n.id) || {}).gate && Math.abs((LAY.pos.get(n.id) || {}).x - g.x) < 0.5);
    if (g.label && !takenByChannel) gateSigns.push({ x: g.x, label: String(g.label) });
  }

  /* ── nodes ───────────────────────────────────────────────────────────── */
  const proxies = [], proxyMat = new T.MeshBasicMaterial({ visible: false });
  const N = new Map();     // id -> { node, group, plate, proxy, pos, anchorY, dim }
  const plates = new T.Group(); world.add(plates);
  /* The gate signs ride in the plates group so the one fit hook scales them
     with every other fixed-pixel label; they are not nodes, so declutter()
     leaves them alone — they stand over the one strip of the map (the road
     between two districts) that nothing else labels. */
  const gateSpr = [];
  for (const gs of gateSigns) { const sp = signSprite(T, gs.label, { px: 9 }); sp.position.set(gs.x, 4.2, 0.2); plates.add(sp); gateSpr.push(sp); }
  /* WHO SUPPLIES WHOM, straight off the graph's PDF supply edges — this is the
     owner's "the icons next to the business types need the other business to
     earn" (p6 header), and round 3 shipped without it: only the four legend
     badges were on the plates, so the flat PDF still answered "what does X
     need" better than the map. Derived, never named: scene.js asks the edges,
     scene.nodes.js prints the labels it is handed. */
  const needLabels = new Map();
  for (const e of edges) {
    if (e.kind !== 'supply' || !e.pdf) continue;
    const src = nodeById.get(e.from); if (!src || !nodeById.get(e.to)) continue;
    if (!needLabels.has(e.to)) needLabels.set(e.to, []);
    const L2 = needLabels.get(e.to), lab = String(src.label || src.id);
    if (L2.indexOf(lab) < 0) L2.push(lab);
  }
  const mkPlate = (node, lift) => {
    const p = paintPlate(T, node, {
      needs: needLabels.get(node.id) || null,
      // the hub's plate carries the owner's rule in words, because the rule is
      // the reason the hub is in the middle at all
      /* The hub's plate carries the owner's rule in words. An earlier cut
         moved this to a road marking on the ground because the wider plate
         buried SALVAGE OPERATION; the declutter pass below made that trade
         unnecessary — a wide plate now PUSHES its neighbours clear instead of
         covering them, and a sentence in the sky beats one painted flat on
         the tarmac, which perspective squashes to nothing. */
      rule: node.kind === 'hub' ? 'EVERY SHIPMENT PASSES THROUGH HERE' : null,
    });
    const s = new T.Sprite(new T.SpriteMaterial({ map: p.texture, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false }));
    /* The hub's plate draws LAST of all the plates. Round 3's GENETICS LAB
       plate was painted over the hub because plates share one renderOrder and
       ties fall back to scene order — so the one label the map most needs was
       the one a neighbour could hide. */
    /* 🔴 THE HUB'S PLATE HANGS DOWNWARD. Every other plate grows UP from its
       anchor, which is right for a small building with a mast. The hub is the
       one thing on the map whose SHAPE has to be read — the gantry is what
       says "depot" at 20 px — and a 208 px plate anchored on it covered the
       gantry completely (photographed). Anchored at the front kerb of the
       deck and grown downward it becomes a caption UNDER the hub: the
       silhouette is clear above it and the name is still touching it. */
    const below = node.kind === 'hub';
    s.center.set(0.5, below ? 1 : 0); s.renderOrder = below ? 26 : 20;
    s.userData.px = { w: p.w, h: p.h }; s.userData.lift = lift; s.userData.below = below;
    return s;
  };
  for (const node of nodes) {
    const p = LAY.pos.get(node.id); if (!p) continue;
    const size = node.type === 'system' ? L.systemTile : node.kind === 'hub' ? HUBSZ : L.tile;
    const isGate = !!p.gate;
    const group = buildNode(T, node, MAT, size);
    if (node.kind === 'hub') group.scale.setScalar(HUBSCALE);   // the hub is the big tile
    else if (node.type === 'system') group.scale.setScalar(L.systemTile.w / L.tile.w * 0.62);
    /* 🔴 BUILDINGS BIGGER THAN THEIR PLINTH. At the home zoom a tile building
       was 20-25 px — the names were legible and the TILES were not, which is
       half of what the bar asks for. The plinth pitch is set by the name
       PLATE (a fixed-pixel sprite ~118 px wide), not by the building, so a
       tile has roughly twice its own width of empty street around it and the
       model can simply take more of it. 1.32 is the largest scale at which
       the widest model (the gas canopy) still clears its neighbour's plinth
       at the narrowest column pitch. */
    else if (node.type === 'business') group.scale.setScalar(1.32);
    group.position.set(p.x, 0, p.z); world.add(group);
    if (node.kind === 'hub') {
      /* A gold ring on the apron: the one place every lane crosses. Thin and
         flat on the deck — NOT a beacon. The round-3 version of this was a
         ring plus an additive light column plus an emissive mast lamp, and
         together they blew the hub out to a white smear at overview with no
         readable form at all. Brightness was the wrong tool; the gantry
         silhouette in scene.nodes.js is the right one, and it needs the
         picture around it to stay dark to read. */
      const ring = new T.Mesh(new T.TorusGeometry(HUBW * 0.62, 0.07, 6, 64), new T.MeshBasicMaterial({ color: hex(PAL.gold), transparent: true, opacity: 0.55 }));
      ring.rotation.x = Math.PI / 2; ring.position.set(p.x, 0.06, p.z); world.add(ring);
      /* THE COLLECTOR SKIRT. Two shallow gold chevrons on the ground, north
         and south of the deck, pointing in. They sit exactly where the haul
         lanes are drawn to converge, so the pinch is something the eye is led
         into rather than something the lane maths asserts. */
      /* The owner's rule, written on the avenue in front of the hub. It was a
         second line INSIDE the name plate, which made that plate wide enough
         to cover two neighbours' names — and a map that hides "SALVAGE
         OPERATION" to shout a slogan has traded one requirement for another.
         The avenue is the one strip of ground with nothing standing on it and
         no plate over it, which is exactly where a road marking belongs. */
      for (const sz of [-1, 1]) {
        const sk = new T.Mesh(new T.RingGeometry(HUBW * 0.6, HUBW * 0.82, 20, 1, -0.5, 1.0),
          new T.MeshBasicMaterial({ color: hex(PAL.gold), transparent: true, opacity: 0.1, side: T.DoubleSide }));
        sk.rotation.x = -Math.PI / 2; sk.rotation.z = sz > 0 ? -Math.PI / 2 : Math.PI / 2;
        sk.position.set(p.x, 0.05, p.z); world.add(sk);
      }
    }
    // copies of the market gate at the other hand-offs, all picking as this node
    const extra = [];
    if (isGate) for (const g of LAY.gates) if (Math.abs(g.x - p.x) > 0.5) { const c = group.clone(); c.position.set(g.x, 0, g.z); world.add(c); extra.push(c); }
    /* THE MAST LADDER. Every plate hangs on its own mast, and how tall the
       mast is decides whether the overview is a map or a pile:
         · `ladder` rungs (layoutGraph) lift a row once per row standing in
           front of it, so the rows fan apart in screen-Y;
         · `stagger` adds a half rung on odd columns, so two plates in the SAME
           row can never share a baseline even when they touch horizontally;
         · the hub clears the tallest rung, so Transport's plate is the highest
           thing over its district and reads as the hub at a glance.
       Round 1 lifted only the odd columns (by a whole tile width) and left all
       four rows on one baseline — which is how twenty plates ended up stacked
       into one unreadable block over the buildings they were labelling. */
    const rungs = (p.stagger ? 0.35 : 0);
    /* 🔴 THE MAST IS CAPPED AT ABOUT ONE TILE HEIGHT. Rounds 1-4 solved plate
       collisions by ALTITUDE — a `ladder` rung per row standing in front, so
       the four rows fanned apart in screen-Y. Measured on the round-5 frame,
       that is what it actually bought: MINING COMPANY's plate ended at y=158
       and the building it names sat at y=458 — 300 px of empty black sky
       bridged by one 1 px, 55%-opacity mast that crossed four other masts on
       the way down. All 27 buildings were crushed into 28% of the frame while
       half the picture was a sky of floating signboards, and the answer to
       "which building is the Mining Company?" was a guess. A label 300 px from
       its subject is not a label.
       So the mast is now short enough that a plate always sits ON its own
       building, and the three things that used to be done with altitude are
       done where they belong:
         · rows are separated in screen-Y by DEPTH and a steeper overview
           pitch (layoutGraph rowSpread + home()'s derived polar), not by lift;
         · plates that still collide are resolved IN-PLANE by declutter()
           below — slide sideways first, and only then a small nudge up;
         · `stagger` keeps a third of a rung on odd columns so two neighbours
           in the same row do not start life on the identical baseline.
       🔴 THE HUB IS STILL ON THE LOWEST RUNG. A hub label belongs ON the hub;
       it is the widest, brightest, gold-filled plate in the map and it draws
       last, and that is what makes it the centre, not altitude. */
    const lift = node.type === 'system' ? size.h + L.labelLift * 1.3
      : node.kind === 'hub' ? HUBH * 1.02                 // on the deck's front kerb; the plate hangs DOWN from here (mkPlate), so the gantry above it stays readable
      : isGate ? L.labelLift * 1.5
      : L.tile.h + L.labelLift * (0.5 + rungs);
    const plateZ = node.kind === 'hub' ? p.z + HUBD * 0.5 : p.z;
    const plate = mkPlate(node, lift); plate.position.set(p.x, lift, plateZ); plates.add(plate);
    const pw = node.type === 'system' ? size.w * 0.8 : isGate ? 4 : size.w, pd = node.type === 'system' ? size.d * 0.8 : isGate ? 6 : size.d;
    /* 🔴 ONE SHORT PROXY OVER THE BUILDING, AND NOTHING IN THE AIR. The proxy
       used to run from the ground to the plate, which turned every tile into
       an invisible WALL: a click on open ground was answered by whichever
       tile's column happened to be behind it, and the "click nothing, go
       home" gesture stopped working. Round 3 shortened it to two boxes — one
       over the roof, one at the plate — and the plate box was STILL a stray
       wall: a click on the empty bottom-left corner focused a district,
       because that district's landmark plate box is a 9-unit cube 23 units up
       and a low ray passes straight through it. Reproduced at (30,870).
       So: the raycast covers only the building, and the plate — which must
       stay clickable, because a name can be a long way from its roof — is hit
       tested in SCREEN SPACE against its real sprite rectangle (plateAt()
       below). Exact, cheap (33 rectangles), and it cannot be walked into. */
    const boxTop = node.type === 'system' ? L.systemTile.h : node.kind === 'hub' ? HUBH : isGate ? 2.4 : L.tile.h;
    const mk = (x, z) => {
      const h = boxTop + L.tile.h * 0.8;
      const px = new T.Mesh(new T.BoxGeometry(pw, h, pd), proxyMat); px.position.set(x, h / 2, z); px.userData.id = node.id; world.add(px); proxies.push(px);
      return px;
    };
    const proxy = mk(p.x, p.z);
    if (isGate) for (const g of LAY.gates) if (Math.abs(g.x - p.x) > 0.5) mk(g.x, g.z);
    N.set(node.id, { node, group, extra, plate, proxy, pos: p, lift, plateZ, below: !!plate.userData.below, off: 0, mats: [] });
    group.traverse((n) => { if (n.isMesh && n.material) N.get(node.id).mats.push(n.material); });
    for (const c of extra) c.traverse((n) => { if (n.isMesh && n.material) N.get(node.id).mats.push(n.material); });
  }
  /* ── masts ───────────────────────────────────────────────────────────── */
  /* A raised plate has to stay ATTACHED to its building or the ladder above
     just moves the ambiguity from "which plate" to "whose plate". One thin
     gold line from each roof to its plate does that, and one LineSegments
     holds all 33 of them (one draw call, not 33). Drawn before the lanes in
     renderOrder so a lane crossing a mast looks like it passes behind. */
  const fitPts = [];
  let mastPos = null, mastGeo = null;
  {
    const mv = []; let maxLift = 0;
    for (const [, e] of N) {
      const top = e.node.type === 'system' ? L.systemTile.h : e.node.kind === 'hub' ? HUBH : e.pos.gate ? 0.1 : L.tile.h;
      maxLift = Math.max(maxLift, e.lift);
      if (e.lift - top < 0.4) continue;
      /* remember WHERE this node's two mast vertices live, so the declutter
         pass can stretch the mast up to a plate it has nudged: a plate that
         floats free of its mast is a plate whose owner is a guess again */
      e.mastIdx = mv.length / 3; e.mastTop = top;
      mv.push(e.pos.x, top, e.pos.z, e.pos.x, e.lift, e.pos.z);
    }
    LAY.bounds.maxLift = maxLift;
    /* The home fit's real subjects. Round 2 fitted a BOX — the map's bounding
       corners raised to the tallest mast — and there is no plate at those
       corners, so the camera held back for a point that does not exist and the
       map sat in the middle of the frame with a third of it empty. These are
       the actual things that must stay on screen: the ground corners of every
       district, and every plate ANCHOR carried with its own pixel size, so the
       search below can test the plate's real rectangle instead of guessing a
       margin for it. */
    for (const d of LAY.districts) for (const x of [d.x - d.w / 2, d.x + d.w / 2]) for (const z of [d.z - d.d / 2, d.z + d.d / 2]) fitPts.push({ p: new T.Vector3(x, 0, z), hw: 0, up: 0 });
    for (const [, e] of N) fitPts.push({ p: new T.Vector3(e.pos.x, e.lift, e.plateZ), plate: e.plate });
    const mg = new T.BufferGeometry(); mastPos = new Float32Array(mv); mg.setAttribute('position', new T.BufferAttribute(mastPos, 3)); mastGeo = mg;
    const mast = new T.LineSegments(mg, new T.LineBasicMaterial({ color: hex(PAL.border), transparent: true, opacity: 0.55 }));
    mast.renderOrder = 2; world.add(mast);
  }

  const anchor = (id) => { const e = N.get(id); return e ? new T.Vector3(e.pos.x, e.pos.y, e.pos.z) : null; };
  const hubE = LAY.hubId ? N.get(LAY.hubId) : null;
  const deckY = HUBH + L.laneLift;

  /* ── lanes ───────────────────────────────────────────────────────────── */
  /* Each edge becomes a curve. via:'transport' → tile → hub deck → tile (the
     path graph.js gave the lane); anything else → a direct arc whose height
     grows with its kind: service low, market pick-ups low, loot HIGH so the
     ember streams read as coming down from the fight. */
  const SAMPLES = 40;
  const lanes = [];   // { edge, kind, curve, pts, base, batch, offset(vertex index in batch) }
  const battleSys = (nodes.filter((n) => n.type === 'system').sort((a, b) => a.order - b.order)[0] || {}).id;   // the first district: where loot comes from on the owner's p1
  /* 🔴 BRIGHTNESS IS THE ONLY THING SEPARATING 247 LANES. Round 1 drew the
     non-PDF supply lanes and the loot streams bright enough that the district
     disappeared into a red haze and the hub — the one shape the whole map is
     about — could not be found in it. The PDF's own edges stay at full
     strength; everything the owner did NOT draw is background texture that
     only comes forward when it is selected or on a highlighted flow (restyle()
     multiplies these, so a picked lane still goes to 1.5). */
  /* …and round 3 proved that was still not enough separation. The via-less
     arcs (loot, channel pick-ups, service) outnumber the hauled lanes 133 to
     114, they are FULL WIDTH, and additive blending means a hundred lanes at
     0.15 pile up into a bright haze wherever they cross. So the undrawn
     background is pushed down another notch and, crucially, loot is drawn in
     a COOL dim tone at rest instead of full ember: the map has one warm
     subject (the gold haul lanes through the hub) and everything else is
     cold background until the player asks for it. On selection or on a
     highlighted flow a loot lane is repainted `hot` at its true ember — the
     colour is not lost, it is spent where it means something. */
  const baseBright = (e) => e.kind === 'supply' ? (e.pdf ? 1.15 : 0.12) : e.kind === 'channel' ? (e.pdf ? 0.5 : 0.05) : e.kind === 'loot' ? (e.from === battleSys ? 0.075 : 0.03) : e.kind === 'service' ? 0.14 : 0.7;
  const coolEdge = new T.Color(hex(PAL.inkDim));
  const kindColor = (e) => { const c = new T.Color(hex(PAL.edge[e.kind] || PAL.inkDim)); return e.kind === 'loot' ? c.lerp(coolEdge, 0.55) : c; };
  const hotColor = (e) => new T.Color(hex(PAL.edge[e.kind] || PAL.inkDim));
  /* approach(id): the drive from a node to the hub deck edge, on the streets
     when the node has one (hub-district tiles, the lot, the landmark), else
     along the z=0 road from wherever it stands (a gate, another district). */
  const H = hubE ? anchor(LAY.hubId) : null, ST = LAY.streets;
  /* 🔴 THE THROAT. Round 3 let each approach enter the deck at its own x
     (±1.26 on the avenue, ±0.9 on the deck), so 114 haul lanes crossed the
     hub as a loose braid roughly as wide as the hub itself — the convergence
     existed in the geometry and was invisible in the picture. Now every
     approach is funnelled into a throat a fraction of a tile wide, directly
     under the gantry and between the collector chevrons, and it CLIMBS: the
     ramp up to the deck is a visible kink, so a lane reads as going over the
     hub rather than past it. `side` survives only as a sub-lane offset inside
     the throat, which is what keeps 114 lanes from being one z-fighting line. */
  const THROAT = HUBW * 0.042;
  const approach = (id, side) => {
    const P = anchor(id), e = N.get(id); if (!P || !H) return [P];
    const st = e.pos.street, ax = ST ? ST.avenueX + side * THROAT : H.x + side * THROAT;
    const out = [P.clone().setY(L.laneLift)];
    if (typeof st === 'number' && ST) {
      const sz = st, sgn = Math.sign(sz || 1); out.push(new T.Vector3(P.x, L.laneLift, sz));
      out.push(new T.Vector3(ax, L.laneLift, sz));
      out.push(new T.Vector3(ax, L.laneLift + 0.2, sgn * (HUBD / 2 + 1.6)));   // mouth of the funnel
      out.push(new T.Vector3(ax, deckY, sgn * (HUBD / 2 - 0.4)));              // up the ramp onto the deck
    } else {
      const dir = Math.sign(P.x - H.x) || 1;
      out.push(new T.Vector3(P.x - dir * 2.5, L.laneLift, 0));
      out.push(new T.Vector3(H.x + dir * (HUBW / 2 + 1.6), L.laneLift + 0.2, side * THROAT));
      out.push(new T.Vector3(H.x + dir * (HUBW / 2 - 0.4), deckY, side * THROAT));
    }
    return out;
  };
  for (const e of edges) {
    const A = anchor(e.from), B = anchor(e.to);
    if (!A || !B) continue;
    const h = hash(e.id), side = (h - 0.5) * 2;
    let pts = [];
    if (e.via && hubE && e.from !== LAY.hubId && e.to !== LAY.hubId) {
      const inn = approach(e.from, side), outp = approach(e.to, side).reverse();
      pts = inn.concat([H.clone().setY(deckY + 0.05).add(new T.Vector3(side * 0.9, 0, 0))], outp);
    } else if (e.via && hubE) {
      const other = e.from === LAY.hubId ? e.to : e.from, toHub = e.to === LAY.hubId;
      const inn = approach(other, side).concat([H.clone().setY(deckY + 0.05)]);
      pts = toHub ? inn : inn.reverse();
    } else if (e.kind === 'loot') {
      /* 🔴 BUNDLE THE LOOT, DO NOT ARC IT OVER THE MAP. 83 loot streams drawn
         as individual high arcs from the Battle district to every business is
         a sunburst the width of the frame, and round 3's overview was exactly
         that: an orange hairball over every building, drowning the 114 haul
         lanes that are the map's actual subject. They are still all here —
         "every business needs battle loot" is the owner's rule and hiding it
         would be a lie — but they are routed along a shared RIDGE behind the
         districts and drop into their tile from the back. One rope with a fan
         at each end instead of 83 crossings, in the empty band behind the
         buildings, at a weight the haul lanes beat. */
      const rz = LAY.bounds.minZ - L.tile.d * (1.1 + Math.abs(side) * 0.55);
      const y = 1.1 + Math.abs(side) * 0.5;
      pts = [A.clone().setY(L.laneLift + 0.2),
        new T.Vector3(A.x + (B.x - A.x) * 0.06, y * 0.8, (A.z + rz) / 2),
        new T.Vector3(A.x + (B.x - A.x) * 0.2, y, rz),
        new T.Vector3(A.x + (B.x - A.x) * 0.8, y, rz),
        new T.Vector3(B.x, y * 0.8, (B.z + rz) / 2),
        B.clone().setY(L.laneLift + 0.2)];
    } else {
      const len = A.distanceTo(B);
      const top = e.kind === 'system' ? 1.2 : 1.1 + len * 0.018;      // low: a market pick-up runs across the street, not over the roofs
      const mid = A.clone().lerp(B, 0.5).setY(top); mid.z += side * len * L.laneArc * 0.6;
      const q1 = A.clone().lerp(B, 0.25).setY(top * 0.8), q2 = A.clone().lerp(B, 0.75).setY(top * 0.8);
      q1.z += side * len * L.laneArc * 0.45; q2.z += side * len * L.laneArc * 0.45;
      pts = [A.clone().setY(L.laneLift + 0.2), q1, mid, q2, B.clone().setY(L.laneLift + 0.2)];
    }
    // drop consecutive duplicates (a street point equal to the tile point) — CatmullRom divides by zero on them
    pts = pts.filter((q, i) => i === 0 || q.distanceToSquared(pts[i - 1]) > 1e-6);
    const curve = new T.CatmullRomCurve3(pts, false, e.via ? 'catmullrom' : 'centripetal', e.via ? 0.15 : 0.6);   // low tension on street lanes: corners stay corners
    lanes.push({ edge: e, kind: e.kind, curve, pts: curve.getPoints(SAMPLES), base: baseBright(e), color: kindColor(e), hotCol: hotColor(e), length: curve.getLength(), mul: 1 });
  }
  /* batches: one LineSegments per (kind, dashed) so live and proposed lanes
     are different STYLES, not just different colours */
  const batches = new Map();
  for (const ln of lanes) {
    const dashed = ln.kind !== 'loot' && ln.kind !== 'system' && !ln.edge.live;
    const key = ln.kind + (dashed ? '|dash' : '|solid');
    if (!batches.has(key)) batches.set(key, { key, dashed, lanes: [], verts: 0 });
    const b = batches.get(key); ln.batch = b; ln.offset = b.verts; b.lanes.push(ln); b.verts += SAMPLES * 2;
  }
  for (const b of batches.values()) {
    const posA = new Float32Array(b.verts * 3), colA = new Float32Array(b.verts * 3), distA = new Float32Array(b.verts);
    for (const ln of b.lanes) {
      let d = 0;
      for (let i = 0; i < SAMPLES; i++) {
        const p0 = ln.pts[i], p1 = ln.pts[i + 1], k = (ln.offset + i * 2) * 3;
        posA[k] = p0.x; posA[k + 1] = p0.y; posA[k + 2] = p0.z; posA[k + 3] = p1.x; posA[k + 4] = p1.y; posA[k + 5] = p1.z;
        distA[ln.offset + i * 2] = d; d += p0.distanceTo(p1); distA[ln.offset + i * 2 + 1] = d;
      }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(posA, 3)); geo.setAttribute('color', new T.BufferAttribute(colA, 3)); geo.setAttribute('lineDistance', new T.BufferAttribute(distA, 1));
    /* ADDITIVE. A lane's loudness is carried in its vertex colour, and
       LineBasicMaterial has no per-vertex alpha to carry it instead — so with
       normal blending a lane turned "off" is painted near-BLACK, and a
       near-black line over the lit district slab is a dark scratch, perfectly
       visible. highlightFlow dimmed 240 lanes and the picture still read as
       spaghetti, in a different colour. Additive makes dark mean absent and
       bright mean loud, which is the same axis the data already uses, and it
       costs nothing. depthWrite off so lanes never carve holes in each other.*/
    const cfg = { vertexColors: true, transparent: true, opacity: 0.95, blending: T.AdditiveBlending, depthWrite: false };
    const mat = b.dashed ? new T.LineDashedMaterial(Object.assign({ dashSize: SC.status.planned.dash[0], gapSize: SC.status.planned.dash[1] }, cfg)) : new T.LineBasicMaterial(cfg);
    b.mesh = new T.LineSegments(geo, mat); b.mesh.renderOrder = 3; b.colA = colA; world.add(b.mesh);
  }
  const paintLane = (ln) => {
    /* A lane the player has ASKED for is painted at an absolute brightness,
       not at `base * mul`. `base` is now deliberately low for everything the
       owner did not draw, so a multiplier left a highlighted flow almost as
       dark as the haze it was supposed to stand out of: highlightFlow('cloth')
       dimmed the map correctly and then lit nothing. Photographed before it
       was fixed. `hot` is the answer to "is this lane the subject", which is a
       different question from "how loud is this lane normally". */
    const c = ln.hot ? ln.hotCol : ln.color, k = ln.hot ? 1.25 : ln.base * ln.mul, a = ln.batch.colA;
    for (let i = 0; i < SAMPLES * 2; i++) { const o = (ln.offset + i) * 3; a[o] = c.r * k; a[o + 1] = c.g * k; a[o + 2] = c.b * k; }
  };
  const repaintLanes = () => { for (const ln of lanes) paintLane(ln); for (const b of batches.values()) b.mesh.geometry.getAttribute('color').needsUpdate = true; };
  repaintLanes();

  /* ── freight ─────────────────────────────────────────────────────────── */
  /* One truck per LIVE hauled lane (SC.freight.perLane), pdf lanes first, up
     to the software-WebGL budget. A proposed lane carries no truck: nothing
     moves on it today and the picture must not say otherwise. */
  const hauled = lanes.filter((ln) => ln.edge.via && ln.edge.live).sort((a, b) => (b.edge.pdf - a.edge.pdf) || (b.base - a.base));
  const trucks = [];
  for (const ln of hauled) for (let i = 0; i < SC.freight.perLane && trucks.length < SC.freight.maxTotal; i++) trucks.push({ lane: ln, phase: hash(ln.edge.id + i), dir: 1 });
  const truckGeo = (() => {
    const g = new T.Group(); const s = SC.freight.size;
    tools.box(T, g, s * 1.5, s * 0.75, s * 0.7, MAT.white, -s * 0.2, s * 0.55, 0); tools.box(T, g, s * 0.55, s * 0.62, s * 0.62, MAT.orange, s * 0.85, s * 0.48, 0);
    for (const x of [-0.7, 0.1, 0.85]) for (const z of [-1, 1]) tools.cyl(T, g, s * 0.16, s * 0.12, MAT.tyre, x * s, s * 0.16, z * s * 0.36, 'z', 8);
    // bake the truck into one geometry (colour comes from instanceColor)
    const parts = []; g.updateMatrixWorld(true);
    g.traverse((n) => { if (n.isMesh) { const gg = n.geometry.index ? n.geometry.toNonIndexed() : n.geometry.clone(); gg.applyMatrix4(n.matrixWorld); const col = new Float32Array(gg.getAttribute('position').count * 3); const c = n.material.color; for (let i = 0; i < col.length; i += 3) { col[i] = c.r; col[i + 1] = c.g; col[i + 2] = c.b; } gg.setAttribute('color', new T.BufferAttribute(col, 3)); parts.push(gg); n.geometry.dispose(); } });
    const out = new T.BufferGeometry(); let n = 0; for (const p of parts) n += p.getAttribute('position').count;
    for (const name of ['position', 'normal', 'color']) { const size = 3, arr = new Float32Array(n * size); let off = 0; for (const p of parts) { const a = p.getAttribute(name); arr.set(a.array.subarray(0, a.count * size), off); off += a.count * size; } out.setAttribute(name, new T.BufferAttribute(arr, size)); }
    for (const p of parts) p.dispose();
    return out;
  })();
  const truckMesh = new T.InstancedMesh(truckGeo, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 }), Math.max(1, trucks.length));
  truckMesh.castShadow = true; truckMesh.count = trucks.length; truckMesh.renderOrder = 4; world.add(truckMesh);
  const dummy = new T.Object3D(), tmpV = new T.Vector3(), tmpC = new T.Color();
  const stepTrucks = (now) => {
    const period = (ln) => (ln.length / SC.freight.unitsPerSec) * 1000 + SC.freight.pauseAtDepotMs;
    trucks.forEach((tr, i) => {
      const ln = tr.lane, per = period(ln);
      let u = still ? tr.phase : ((now / per) + tr.phase) % 1;
      const travel = 1 - SC.freight.pauseAtDepotMs / per;
      u = Math.min(1, u / travel);                                     // the last slice of the period is the depot pause
      const p = ln.curve.getPointAt(Math.min(0.999, Math.max(0.001, u))), tg = ln.curve.getTangentAt(Math.min(0.999, Math.max(0.001, u)));
      /* 🔴 RESET THE SCALE. `dummy` is shared with showSet(), which writes a
         ring RADIUS into it (scale 3-4). restyle() runs before the first
         frame, so every truck was being drawn at whatever the last ring's
         radius happened to be — freight the size of the building it was
         delivering to, and silently different depending on which node styled
         last. Caught in a focus screenshot, not by any test. */
      dummy.scale.set(1, 1, 1);
      dummy.position.copy(p); dummy.position.y += 0.05;
      tmpV.copy(p).add(tg); dummy.lookAt(tmpV); dummy.rotateY(-Math.PI / 2);
      dummy.updateMatrix(); truckMesh.setMatrixAt(i, dummy.matrix);
      tmpC.setScalar(Math.max(0.12, ln.mul)); truckMesh.setColorAt(i, tmpC);
    });
    truckMesh.instanceMatrix.needsUpdate = true; if (truckMesh.instanceColor) truckMesh.instanceColor.needsUpdate = true;
  };

  /* ── embers on the loot streams ──────────────────────────────────────── */
  const lootLanes = lanes.filter((ln) => ln.kind === 'loot');
  const emberN = Math.min(lootLanes.length * 2, 120);
  const emberPos = new Float32Array(Math.max(1, emberN) * 3), emberCol = new Float32Array(Math.max(1, emberN) * 3);
  const emberGeo = new T.BufferGeometry(); emberGeo.setAttribute('position', new T.BufferAttribute(emberPos, 3)); emberGeo.setAttribute('color', new T.BufferAttribute(emberCol, 3));
  const embers = new T.Points(emberGeo, new T.PointsMaterial({ size: 0.55, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false })); embers.renderOrder = 5; world.add(embers);
  const emberC = new T.Color(hex(PAL.ember));
  const stepEmbers = (now) => {
    for (let i = 0; i < emberN; i++) {
      const ln = lootLanes[i % lootLanes.length], ph = hash(ln.edge.id + ':' + i);
      const u = still ? ph : ((now / 6000) + ph) % 1;
      const p = ln.curve.getPointAt(u), o = i * 3;
      emberPos[o] = p.x; emberPos[o + 1] = p.y + 0.15; emberPos[o + 2] = p.z;
      const k = Math.max(0.05, Math.min(1, ln.mul * (0.4 + ln.base))) * (0.7 + 0.3 * Math.sin(u * Math.PI));
      emberCol[o] = emberC.r * k; emberCol[o + 1] = emberC.g * k; emberCol[o + 2] = emberC.b * k;
    }
    emberGeo.getAttribute('position').needsUpdate = true; emberGeo.getAttribute('color').needsUpdate = true;
  };

  /* ── rings: hover, select, and the flow / neighbour ring set ─────────── */
  const ringGeo = new T.TorusGeometry(1, 0.06, 6, 48);
  const hover = new T.Mesh(ringGeo, new T.MeshBasicMaterial({ color: hex(PAL.goldBright), transparent: true, opacity: 0.6 })); hover.rotation.x = Math.PI / 2; hover.visible = false; hover.renderOrder = 6; world.add(hover);
  const selRing = new T.Mesh(ringGeo, new T.MeshBasicMaterial({ color: hex(PAL.goldBright), transparent: true, opacity: 0.95 })); selRing.rotation.x = Math.PI / 2; selRing.visible = false; selRing.renderOrder = 6; world.add(selRing);
  const setRings = new T.InstancedMesh(ringGeo, new T.MeshBasicMaterial({ color: hex(PAL.gold), transparent: true, opacity: 0.7 }), Math.max(1, nodes.length)); setRings.count = 0; setRings.renderOrder = 6; world.add(setRings);
  const ringR = (id) => { const e = N.get(id); if (!e) return 1; return e.node.type === 'system' ? L.systemTile.w * 0.55 : e.node.kind === 'hub' ? HUBW * 0.58 : e.pos.gate ? 3.6 : L.tile.w * 0.78; };
  const placeRing = (mesh, id) => { const e = N.get(id); if (!e) { mesh.visible = false; return; } const r = ringR(id); mesh.position.set(e.pos.x, 0.09, e.pos.z); mesh.scale.set(r, r, 1); mesh.visible = true; };
  const showSet = (ids) => {
    let i = 0;
    for (const id of ids) { const e = N.get(id); if (!e || i >= setRings.instanceMatrix.count) continue; const r = ringR(id); dummy.position.set(e.pos.x, 0.08, e.pos.z); dummy.rotation.set(Math.PI / 2, 0, 0); dummy.scale.set(r, r, 1); dummy.updateMatrix(); setRings.setMatrixAt(i++, dummy.matrix); }
    setRings.count = i; setRings.instanceMatrix.needsUpdate = true;
  };

  /* ── styling state: filter × flow × selection → one restyle() ────────── */
  const state = { selected: null, flow: null, flowSet: null, filter: null };
  const nodeMul = new Map();
  const dimNode = (id, k) => {
    const e = N.get(id); if (!e) return;
    const planned = e.node.status === 'planned';
    for (const m of e.mats) { const full = planned ? SC.status.planned.opacity * 0.8 : 1; m.transparent = planned || k < 1; m.opacity = full * (k < 1 ? Math.max(0.12, k) : 1); m.depthWrite = !(planned || k < 0.5); }
    e.plate.material.opacity = k < 1 ? Math.max(0.2, k) : 1;
    nodeMul.set(id, k);
  };
  const passes = (n) => {
    const f = state.filter; if (!f) return true;
    if (typeof f === 'function') { try { return !!f(n); } catch (e) { return true; } }
    if (Array.isArray(f.ids) && f.ids.indexOf(n.id) < 0) return false;
    if (f.system && n.type === 'business' && n.system !== f.system) return false;
    if (f.system && n.type === 'system' && n.id !== f.system) return false;
    if (f.status && n.status !== f.status) return false;
    if (f.kind && n.kind !== f.kind && n.type !== f.kind) return false;
    return true;
  };
  function restyle() {
    const flow = state.flowSet, sel = state.selected;
    const nb = sel && typeof G.neighbours === 'function' ? (() => { try { return new Set(G.neighbours(sel, G).all || []); } catch (e) { return null; } })() : null;
    const ringSet = [];
    for (const n of nodes) {
      if (!N.has(n.id)) continue;
      let k = passes(n) ? 1 : 0.18;
      if (flow) k = Math.min(k, flow.nodes.has(n.id) ? 1 : 0.28);
      if (sel && !flow) k = Math.min(k, (n.id === sel || (nb && nb.has(n.id))) ? 1 : 0.55);
      dimNode(n.id, k);
      if ((flow && flow.nodes.has(n.id)) || (sel && nb && nb.has(n.id) && n.id !== sel)) ringSet.push(n.id);
    }
    showSet(ringSet);
    for (const ln of lanes) {
      const e = ln.edge;
      let m = (passes(nodeById.get(e.from) || {}) && passes(nodeById.get(e.to) || {})) ? 1 : 0.06;
      if (flow) m = Math.min(m, flow.edges.has(e.id) ? 1.6 : 0.05);
      else if (sel) m = Math.min(m, (e.from === sel || e.to === sel) ? 1.5 : 0.08);
      // service lanes are hidden at overview (the PDF shows them as a badge) and appear when their node is in play
      if (e.kind === 'service' && !flow && !(sel && (e.from === sel || e.to === sel))) m = 0;
      ln.mul = m;
      ln.hot = m > 1;   // on the highlighted flow, or touching the selected tile
    }
    repaintLanes();
    if (sel) placeRing(selRing, sel); else selRing.visible = false;
  }

  /* ── camera ──────────────────────────────────────────────────────────── */
  const cur = { tx: LAY.bounds.cx, ty: 0, tz: LAY.bounds.cz, dist: CAM.home.dist, polar: rad(CAM.home.polarDeg), az: rad(CAM.home.azimuthDeg) };
  const tw = { from: Object.assign({}, cur), to: Object.assign({}, cur), t0: 0, ms: 1 };
  const applyCam = () => {
    const sp = Math.sin(cur.polar), cp = Math.cos(cur.polar);
    cam.position.set(cur.tx + cur.dist * sp * Math.sin(cur.az), cur.ty + cur.dist * cp, cur.tz + cur.dist * sp * Math.cos(cur.az));
    cam.lookAt(cur.tx, cur.ty, cur.tz);
  };
  const go = (to, ms) => { Object.assign(tw.from, cur); Object.assign(tw.to, cur, to); tw.t0 = performance.now(); tw.ms = still ? SC.tween.reducedMs : (ms == null ? SC.tween.cameraMs : ms); };
  const stepCam = () => {
    const k = Math.min(1, (performance.now() - tw.t0) / Math.max(1, tw.ms)), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    for (const key of ['tx', 'ty', 'tz', 'dist', 'polar', 'az']) cur[key] = tw.from[key] + (tw.to[key] - tw.from[key]) * e;
    applyCam();
  };
  /* Home = the whole map in frame. The distance is searched, not typed: at
     the home polar angle, push the camera back until every district corner
     projects inside the viewport with a margin. Re-run on resize, so a phone
     and a 1600x900 critic both see all four districts. */
  let plateK = 1;
  /* set once declutter() below exists; home() runs before it in source order */
  let declutterFn = null;
  const home = () => {
    const b = LAY.bounds;
    const sz = S.size(), W = Math.max(1, sz.w || 1600), Hh = Math.max(1, sz.h || 900);
    const padX = Math.max(8, W * 0.012), padY = Math.max(8, Hh * 0.018);
    /* 🔴 A PORTRAIT FRAME TURNS THE MAP, IT DOES NOT PUSH IT AWAY.
       The map is four districts side by side: about four times as wide as it
       is deep. On a phone (390 x 844) the frame is the other way round, and
       the distance search answered the only way it could — by backing off —
       until it hit the ceiling and STILL clipped Battle System off the left
       and Camp off the right (measured: both landed ~66 px outside). It
       cannot be solved by backing off further: the distance needed is about
       740 units and the far plane is 400, so the map would be behind the
       camera's own horizon before it fitted.
       So when the frame is portrait and the map is not, the camera takes the
       quarter turn instead: the districts run DOWN the screen in the owner's
       order rather than across it, and the whole map fits at a distance that
       exists. The polar angle goes up with it, because a turned map is seen
       along its short axis and a flatter view spends less depth. Nothing else
       changes — a pick, a focus and the hover card all work off the live
       camera, and the player can still orbit back. */
    const mapW = Math.max(1, b.maxX - b.minX), mapD = Math.max(1, b.maxZ - b.minZ);
    const turn = (W / Hh) < 1 && (mapW / mapD) > 1.6;
    /* 🔴 THE OVERVIEW PITCH IS DERIVED FROM THE FRAME, NOT TYPED.
       CAM.home.polarDeg (52°) is the angle a FOCUSED look uses — close to a
       tile, where a low, architectural view of one building is the point. At
       the overview it was the wrong angle for a different reason: the map is
       four times as wide as it is deep, so WIDTH always binds the distance
       search, and at 52° the whole map's depth — four rows of tiles plus the
       hub — collapsed into 28% of the frame's height (measured: every one of
       the 27 buildings between y=458 and y=706, the back six sharing a single
       24 px band). That is unreadable no matter how good the labels are, and
       it is what forced the plates into the sky in the first place.
       The frame has the room; the camera just has to look down far enough to
       use it. Width fixes the pixels-per-world-unit, so the map's depth lands
       on screen at roughly mapD·cos(polar)·(W/mapW) px — solve that for the
       share of the height we want and clamp into the orbit's own limits. No
       new number: the target share is the same 1 - 2·padY the width test
       already uses, and a 16:9 critic's frame, a 4:3 and a phone each derive
       their own angle. */
    /* After the quarter turn the map's WIDTH runs down the screen and its
       depth runs across it, so the two axes swap in the same formula — which
       is the whole reason it is written as a formula. A typed "+16°" for the
       turned case put the phone's map in the top third of the frame with half
       the picture bare ground under it. */
    const acrossUnits = turn ? mapD : mapW, downUnits = turn ? mapW : mapD;
    const pxPerUnit = (W - padX * 2) / acrossUnits;
    const want = (Hh - padY * 2) / Math.max(1e-3, downUnits * pxPerUnit);
    const ceilDeg = turn ? CAM.maxPolarDeg : CAM.home.polarDeg;
    const polarDeg = Math.max(CAM.minPolarDeg, Math.min(ceilDeg, Math.acos(Math.max(-1, Math.min(1, want))) * 180 / Math.PI));
    const polar = rad(polarDeg);
    const az = rad(turn ? CAM.home.azimuthDeg + 90 : CAM.home.azimuthDeg);
    /* 🔴 THE FIT IS SOLVED FOR THE WHOLE SWAY BAND, NOT FOR ONE AZIMUTH.
       The idle turntable turns the camera while nothing moves it back, so a
       distance that frames the map at the home azimuth says nothing about the
       frame ten seconds later. That is exactly how the overview lost nine of
       its 33 plates — all four district labels among them — by t+60s while
       every fit test in the feature stayed green, because every one of them
       photographed t+0.
       Re-running this whole search on each spin step was the obvious other
       answer and was rejected: the search is ~70 projections of every fit
       point, it would run at frame rate, and a fit that re-derives as the
       camera turns makes the map creep toward and away from the player, which
       looks like a bug. Instead the band is bounded (CAM.idleSwayDeg) and the
       screen box below is the UNION over that band — so one distance and one
       look-at height are correct at every azimuth the idle sway can reach, and
       nothing has to be recomputed while it turns.
       Five samples, not two: the projected extremes of a rotating box are not
       guaranteed to fall at the ends of the arc. Over six degrees the middle
       samples are cheap insurance and cost one resize, not one frame.
       ⏱ AND IT IS PAID FOR ONCE, NOT 70 TIMES. Unioning inside the distance
       search made every probe five projections of every fit point, and the
       overlay's measured open time went from ~18 s to 23 s on the e2e budget —
       a fit that is correct and too slow to open is not a fix. So the search
       and the vertical balance run at the base azimuth exactly as before, and
       the union is switched on only for the LAST WORD below, where a handful
       of tests decide how far to back off. Same guarantee, one twentieth of
       the projections. */
    const swayDeg = Math.max(0, +CAM.idleSwayDeg || 0);
    const azList = swayDeg > 0 ? [-1, -0.5, 0, 0.5, 1].map((f) => az + rad(f * swayDeg)) : [az];
    let unionAz = false;               // ← true only for the final back-off, below
    const tmp = new T.Vector3();
    /* Tested in PIXELS, because that is the unit the thing being kept on
       screen is measured in: a plate is a sizeAttenuation:false sprite, so its
       width does not change with distance and no world-space margin can stand
       in for it. `center` is (0.5, 0), so a plate occupies half its width
       either side of the anchor and all of its height ABOVE it. */
    const place = (d, ty, a) => {
      const aa = (a == null) ? az : a;
      const sp = Math.sin(polar), cp = Math.cos(polar);
      cam.position.set(b.cx + d * sp * Math.sin(aa), ty + d * cp, b.cz + d * sp * Math.cos(aa)); cam.lookAt(b.cx, ty, b.cz); cam.updateMatrixWorld();
    };
    /* The screen rectangle everything actually occupies. */
    let plateAllow = 1;   // how much of a plate the fit insists on keeping inside the frame
    const box = (d, ty) => {
      let l = Infinity, r = -Infinity, t = Infinity, bo = -Infinity, behind = false;
      for (const a of (unionAz ? azList : [az])) {
        place(d, ty, a);
        for (const f of fitPts) {
          const v = tmp.copy(f.p).project(cam);
          if (v.z >= 1) { behind = true; continue; }
          const x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * Hh;
          const px = (plateAllow && f.plate) ? f.plate.userData.px : null, hw = px ? px.w / 2 * plateK * plateAllow : 0, up = px ? px.h * plateK * plateAllow : 0;
          const down = px && f.plate.userData.below;                      // the hub's caption hangs below its anchor
          l = Math.min(l, x - hw); r = Math.max(r, x + hw); t = Math.min(t, down ? y : y - up); bo = Math.max(bo, down ? y + up : y);
        }
      }
      // leave the camera where the BASE azimuth puts it: callers that measure
      // the real picture (the declutter settle below) must not inherit the last
      // sway sample's camera.
      place(d, ty);
      return { l, r, t, b: bo, behind };
    };
    const test = (d, ty) => { const q = box(d, ty); return !q.behind && q.l >= padX && q.r <= W - padX && q.t >= padY && q.b <= Hh - padY; };
    const CEIL = CAM.maxDist * 2.5;
    let hi = CEIL;
    const search = () => { let lo = CAM.minDist, hi = CEIL; for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (test(mid, 0)) hi = mid; else lo = mid; } return hi; };

    /* 🔴 DEGRADE, DO NOT SATURATE. Below about 900 css px the plates simply
       cannot all fit side by side — 27 of them at a fixed 118 px need more
       room than the frame has — so NO distance passes the strict test, the
       search saturates at the ceiling, and the map ends up beyond the fog: a
       390x844 phone shot came back BLACK. Nothing threw and no test noticed,
       which is the failure mode CLAUDE.md warns about. So when the strict fit
       is impossible, fit the GEOMETRY and let the plates overlap — an overview
       with crowded labels is a map; a black rectangle is not. */
    for (const allow of [1, 0.6, 0.3, 0]) { plateAllow = allow; hi = search(); if (test(hi, 0)) break; }
    let dist = Math.min(CEIL, Math.max(CAM.minDist, hi));
    /* …then CENTRE it vertically. The map is much wider than it is deep, so
       the distance search above is always bound by WIDTH and leaves slack
       above and below — which round 2 spent entirely at the bottom, leaving a
       third of the frame as bare ground under the map. Raising the look-at
       target slides the picture down the screen; two secant steps land the
       margins within a few pixels, and any step that would push something off
       the frame is discarded (a fit that clips is worse than one that sits
       high). Measured, not typed: the offset is in world units and comes out
       of the projection, so it re-derives on every resize. */
    let ty = 0;
    for (let i = 0; i < 3; i++) {
      const q0 = box(dist, ty), e0 = ((Hh - q0.b) - q0.t) / 2;        // + = too much room below
      if (!isFinite(e0) || Math.abs(e0) < 3) break;
      const q1 = box(dist, ty + 1), e1 = ((Hh - q1.b) - q1.t) / 2;
      const slope = e1 - e0; if (!isFinite(slope) || Math.abs(slope) < 1e-4) break;
      const next = ty - e0 / slope;
      if (!isFinite(next) || !test(dist, next)) break;
      ty = next;
    }
    /* …and finally settle against what is ACTUALLY on screen. Everything
       above reasons about each plate at its own anchor, but the declutter
       pass moves plates upward to stop them covering each other, and it can
       only do that once a camera exists. So: place the camera, run the real
       declutter, measure the real top and bottom of the picture, and slide
       the look-at target until the two margins match. Without this the whole
       map sat in the top two thirds of the frame with a band of bare ground
       under it, because the fit had balanced a picture that was 90 px shorter
       than the one being drawn. Two secant steps; every step is measured from
       the projection, so it re-derives on any resize or aspect. */
    if (declutterFn) {
      for (let i = 0; i < 2; i++) {
        place(dist, ty); declutterFn();
        let ct = Infinity, cb = -Infinity;
        for (const f of fitPts) {
          const v = tmp.copy(f.p).project(cam); if (v.z >= 1) continue;
          const y = (1 - v.y) / 2 * Hh;
          if (!f.plate) { ct = Math.min(ct, y); cb = Math.max(cb, y); continue; }
          const e = f.plate.userData, ph = e.px.h * plateK * (e.k || 1), off = f.plate.userData.off || 0;
          ct = Math.min(ct, (e.below ? y : y - ph) + off); cb = Math.max(cb, (e.below ? y + ph : y) + off);
        }
        const err = ((Hh - cb) - ct) / 2;
        if (!isFinite(err) || Math.abs(err) < 6) break;
        const q0 = box(dist, ty), q1 = box(dist, ty + 1);
        const slope = (((Hh - q1.b) - q1.t) / 2) - (((Hh - q0.b) - q0.t) / 2);
        if (!isFinite(slope) || Math.abs(slope) < 1e-4) break;
        ty -= err / slope;
      }
    }
    /* ── the last word on the fit ──────────────────────────────────────────
       Everything above balanced the picture vertically, and a secant step that
       lands ty a few pixels past centre can put the union box (which now spans
       the whole idle sway band) back outside the margin. Rather than trust the
       balance, ASK again and back off until it is true: at most 30 steps of 2%,
       bounded by the same ceiling as the search, so a frame that cannot be
       fitted at all degrades exactly as the plateAllow ladder above does and
       this never loops. The idle sway leans on this line. */
    unionAz = true;
    for (let i = 0; i < 30 && dist < CEIL && !test(dist, ty); i++) dist = Math.min(CEIL, dist * 1.02);
    unionAz = false;
    /* The fog is a look, not a limit: it is pinned to the distance the map is
       actually viewed from, so a narrow frame (which must stand further back)
       never has its own subject fogged out. */
    if (scene.fog) { scene.fog.near = dist * 0.75; scene.fog.far = dist * 2.4; }
    return { tx: b.cx, ty, tz: b.cz, dist, polar, az };
  };
  Object.assign(cur, home()); Object.assign(tw.from, cur); Object.assign(tw.to, cur); applyCam();
  S.onFit.push((w, h) => {
    // plates keep a fixed pixel size (sizeAttenuation off): px → sprite scale is 2·tan(fov/2)/H per px
    const k = 2 * Math.tan(rad(CAM.fov) / 2) / h;
    /* Narrow frames get SMALLER plates, not a broken fit. The plate size that
       makes 27 labels legible side by side on a 1600 px critic's frame is
       simply wider than a 390 px phone has, and holding it fixed there made
       the strict fit impossible — which is what sent the phone shot off the
       bottom of the ladder into the fog. Shrinking the label is the trade a
       map makes on a small screen; it stays derived from the frame, so the
       desktop shot the bar photographs is untouched (w >= 1520 gives 1). */
    plateK = Math.max(0.45, Math.min(1, w / 1520));
    plates.children.forEach((s) => s.scale.set(s.userData.px.w * k * plateK, s.userData.px.h * k * plateK, 1));
    if (!state.selected) { const hm = home(); go(hm, 1); }
  });
  { const sz = S.size(); S.onFit[S.onFit.length - 1](sz.w, sz.h); }

  /* ── interaction ─────────────────────────────────────────────────────── */
  const ray = new T.Raycaster(), ndc = new T.Vector2();
  let drag = null, moved = 0, hovered = null, lastInput = Date.now();
  const rect = () => cv.getBoundingClientRect();
  /* A plate is a fixed-PIXEL sprite, so the only honest hit test for it is in
     pixels: project its anchor, rebuild the exact rectangle the sprite
     occupies (center is (0.5,0) — half its width either side, all its height
     above), and test the pointer against that. This replaces the invisible
     boxes that used to float at plate height and swallow clicks aimed at the
     ground behind them. Nearest plate to the camera wins, and a plate the
     current filter has faded out is not clickable — what you cannot read you
     cannot mean to click. */
  const tmpP = new T.Vector3();
  const plateAt = (sx, sy) => {
    const sz = S.size(); if (!sz.w) return null;
    let best = null, bestZ = Infinity;
    for (const [id, e] of N) {
      if (!e.plate.visible || e.plate.material.opacity < 0.3) continue;
      const v = tmpP.set(e.pos.x, e.lift, e.plateZ).project(cam); if (v.z >= 1) continue;
      const x = (v.x + 1) / 2 * sz.w, y = (1 - v.y) / 2 * sz.h;
      const kk = e.scaleK || 1;
      const pw = e.plate.userData.px.w * plateK * kk, ph = e.plate.userData.px.h * plateK * kk;
      const off = e.off || 0, offX = e.offX || 0;                // whatever the declutter pass nudged it by, in the same pixels
      const cx = x + offX;
      const top = (e.below ? y : y - ph) + off, bot = (e.below ? y + ph : y) + off;
      if (sx >= cx - pw / 2 && sx <= cx + pw / 2 && sy >= top && sy <= bot && v.z < bestZ) { bestZ = v.z; best = id; }
    }
    return best;
  };
  const aim = (e) => {
    const r = rect();
    const sx = (e.clientX - r.left) / Math.max(1, r.width), sy = (e.clientY - r.top) / Math.max(1, r.height);
    ndc.set(sx * 2 - 1, -(sy * 2) + 1); ray.setFromCamera(ndc, cam);
    const h = ray.intersectObjects(proxies, false)[0];
    if (h) return h.object.userData.id;
    const sz = S.size();
    return plateAt(sx * (sz.w || r.width), sy * (sz.h || r.height));
  };
  const xy = (e) => { const r = rect(); return { x: e.clientX - r.left, y: e.clientY - r.top, clientX: e.clientX, clientY: e.clientY }; };
  const setHover = (id, e) => {
    if (id === hovered) { if (id && cb.onHover) cb.onHover(id, xy(e)); return; }
    hovered = id;
    if (id) placeRing(hover, id); else hover.visible = false;
    cv.style.cursor = id ? 'pointer' : (drag ? 'grabbing' : 'grab');
    if (cb.onHover) cb.onHover(id, e ? xy(e) : null);
  };
  const focus = (id, quiet) => {
    const e = N.get(id); if (!e) return false;
    state.selected = id;
    const isSys = e.node.type === 'system';
    const f = isSys ? CAM.systemFocus : CAM.focus;
    go({ tx: e.pos.x, ty: isSys ? 1.5 : 0.8, tz: e.pos.z, dist: f.dist, polar: rad(f.polarDeg) });
    restyle();
    if (!quiet && cb.onPick) cb.onPick(id);
    return true;
  };
  const goHome = (quiet) => { const had = state.selected; state.selected = null; go(home()); restyle(); if (!quiet && cb.onPick && had) cb.onPick(null); };
  const onDown = (e) => { lastInput = Date.now(); drag = { x: e.clientX, y: e.clientY, az: cur.az, polar: cur.polar }; moved = 0; try { cv.setPointerCapture(e.pointerId); } catch (_) {} };
  const onMove = (e) => {
    if (drag) {
      moved = Math.max(moved, Math.abs(e.clientX - drag.x), Math.abs(e.clientY - drag.y));
      if (moved > CAM.dragSlopPx) {
        lastInput = Date.now();
        const az = drag.az - (e.clientX - drag.x) * CAM.orbitSpeed, polar = Math.max(rad(CAM.minPolarDeg), Math.min(rad(CAM.maxPolarDeg), drag.polar - (e.clientY - drag.y) * CAM.orbitSpeed * 0.6));
        cur.az = az; cur.polar = polar; Object.assign(tw.from, cur); Object.assign(tw.to, cur); tw.ms = 1; cv.style.cursor = 'grabbing';
      }
      return;
    }
    setHover(aim(e), e);
  };
  const onUp = (e) => {
    const wasDrag = moved > CAM.dragSlopPx; drag = null; cv.style.cursor = hovered ? 'pointer' : 'grab';
    if (wasDrag) return;
    lastInput = Date.now();
    const id = aim(e);
    if (id) focus(id); else goHome();
  };
  const onLeave = () => { if (hovered) setHover(null, null); };
  const onWheel = (e) => {
    e.preventDefault(); lastInput = Date.now();
    const d = Math.max(CAM.minDist, Math.min(CAM.maxDist * 2.5, cur.dist * (1 + Math.sign(e.deltaY) * CAM.zoomStep)));
    cur.dist = d; Object.assign(tw.from, cur); Object.assign(tw.to, cur); tw.ms = 1;
  };
  cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointermove', onMove); cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', () => { drag = null; }); cv.addEventListener('pointerleave', onLeave); cv.addEventListener('wheel', onWheel, { passive: false });

  /* ── label declutter ─────────────────────────────────────────────────── */
  /* 🔴 THE LAST OVERLAP CANNOT BE SOLVED IN THE LAYOUT. Rounds 1-3 fought the
     plate wall with world-space tools — wider columns, a per-row mast ladder,
     a per-row x-spread, a wider avenue — and each one helped and none of them
     finished the job, because a plate is a FIXED-PIXEL sprite and the layout
     is in world units: the relationship between the two changes with every
     camera move. Two plates that clear each other at the home fit can touch
     at another angle, and the last pair (the hub's sign against SALVAGE
     OPERATION) would have needed a 29% wider map to separate in world space,
     which shrinks every label and loses more than it wins.

     So the final pass is done where the problem lives — in pixels, every
     frame. Plates are placed in priority order (the hub first, then landmarks
     and gates, then tiles from the front of the map backwards, which is the
     order the eye reads them) and anything that would land on an
     already-placed rectangle is pushed straight UP until it is clear. The
     nudge is applied through the sprite's `center`, so it is exact on screen
     at any zoom and costs nothing; masts still point at the anchor, so a
     nudged plate stays attached to its building.

     Rejected: hiding the loser (the bar wants all 27 names), shrinking the
     loser (illegible is the same as hidden), and doing this once at the home
     fit (it is wrong the moment the camera moves, which is most of the time). */
  const DECL = [];
  const declRank = (n) => (n.kind === 'hub' ? 0 : n.type === 'system' ? 1 : n.type === 'channel' ? 2 : 3);
  let mastDirty = false;
  const declutter = () => {
    const sz = S.size(); if (!sz.w) return;
    DECL.length = 0;
    for (const [, e] of N) {
      const v = tmpP.set(e.pos.x, e.lift, e.plateZ).project(cam);
      if (v.z >= 1) { e.plate.visible = false; e.off = 0; continue; }
      e.plate.visible = true;
      DECL.push({ e, x: (v.x + 1) / 2 * sz.w, y: (1 - v.y) / 2 * sz.h, w: e.plate.userData.px.w * plateK, h: e.plate.userData.px.h * plateK, depth: v.z });
    }
    DECL.sort((a, b) => declRank(a.e.node) - declRank(b.e.node) || a.depth - b.depth);
    /* 🔴 RESOLVE IN-PLANE, AND KEEP THE PLATE ON ITS BUILDING.
       Rounds 1-5 resolved every collision by PUSHING THE LOSER UP, with a
       give-up threshold of six plate heights. That threshold was reached
       often, which is how the round-5 frame ended up with a sky of plates 300
       px above the buildings they name (MINING COMPANY, GAS STATION) — the
       collision was solved and the LABELLING was destroyed, because the only
       thing binding a plate to its tile was a 1 px mast crossing four others.
       A plate has three cheaper ways out before altitude:
         1. slide SIDEWAYS. Its mast stays short and still lands on its own
            roof, and the street between two tiles is empty pixels anyway.
         2. shrink. 0.78 of a plate is still legible at overview; a plate 300
            px from its subject is not legible at any size.
         3. only then nudge up, and never by more than about one plate height,
            which is roughly the mast length — past that the plate is over its
            neighbour's roof and the label is a guess again.
       Candidates are scored by displacement (sideways is cheap, up is dear)
       so the resolver spends the smallest move that works. If nothing works
       the plate keeps its anchor and overlaps: a crowded name beats a lie
       about which building it belongs to. */
    const placed = [];
    /* The hub's deck and the throat its lanes converge into are an EXCLUSION
       ZONE, not a plate. SMUGGLING NETWORK and SALVAGE OPERATION boxed the
       gantry in on both sides at overview, so the one shape the map has to
       read — every lane pinching into one deck — was hidden behind two of its
       neighbours' names. Reserving it first (the resolver places in order)
       makes every other plate slide around it. */
    /* The gate signs are not nodes, so they are not in the resolver's queue —
       but they are still pixels a plate must not cover. They go in as
       obstacles before anything is placed: the arch between two districts is
       the one label in the map that has nowhere else to go, and a district
       banner that lands on it has plenty of room to move. */
    const gateRects = [];
    for (const sp of gateSpr) {
      const v = tmpP.copy(sp.position).project(cam); if (v.z >= 1) continue;
      const x = (v.x + 1) / 2 * sz.w, y = (1 - v.y) / 2 * sz.h;
      const w = sp.userData.px.w * plateK, h = sp.userData.px.h * plateK;
      gateRects.push({ l: x - w / 2, r: x + w / 2, t: y, b: y + h });
    }
    let hubZone = null;
    if (LAY.hubId) {
      const he = N.get(LAY.hubId);
      if (he) {
        const v = tmpP.set(he.pos.x, HUBH * 0.75, he.pos.z).project(cam);
        if (v.z < 1) {
          const hx = (v.x + 1) / 2 * sz.w, hy = (1 - v.y) / 2 * sz.h;
          const v2 = tmpP.set(he.pos.x + HUBW * 0.62, 0, he.pos.z).project(cam);
          const half = Math.abs((v2.x + 1) / 2 * sz.w - hx) || 40;
          hubZone = { l: hx - half, r: hx + half, t: hy - half * 0.75, b: hy + half * 0.75 };
        }
      }
    }
    /* …but the zone is armed only AFTER the hub's own caption is placed. The
       first cut pushed it before the loop and the hub then collided with its
       own exclusion zone: TRANSPORT slid 150 px left, off the gantry and onto
       the Fishing Company's street, which is precisely the failure the zone
       exists to prevent. The hub sorts first (declRank 0), so arming it on
       the first non-hub item is exact. */
    /* The gate signs are armed one rank LATER still, after the four district
       banners have taken their places. The first cut armed them with the hub
       and the cascade was worse than the collision it prevented: BATTLE
       SYSTEM was pushed off its own district and halfway into Just Business,
       where a heading over the wrong district is a factual error, not a
       crowding one. A district name outranks a road sign; the sign is raised
       above the arch instead, which separates them in practice. */
    let zoneArmed = false, gatesArmed = false;
    const hits = (l, r, t, b) => { for (const p of placed) if (!(l >= p.r - 1 || r <= p.l + 1 || b <= p.t + 1 || t >= p.b - 1)) return true; return false; };
    for (const it of DECL) {
      if (!zoneArmed && it.e.node.kind !== 'hub') { zoneArmed = true; if (hubZone) placed.push(hubZone); }
      if (!gatesArmed && declRank(it.e.node) > 1) { gatesArmed = true; for (const g of gateRects) placed.push(g); }
      let offX = 0, off = 0, k = 1;
      const rectOf = (dx, dy, kk) => {
        const w = it.w * kk, h = it.h * kk;
        const l = it.x + dx - w / 2;
        const t = it.y + dy - (it.e.below ? 0 : h);
        return { l, r: l + w, t, b: t + h };
      };
      let best = null, least = null;
      /* how much of the plate a candidate would still have covered — the
         fallback is the LEAST bad position, not the anchor. Round 5 fell back
         to the anchor, which is how BANK ended up wholly behind the hub's
         caption while a clear gap sat 30 px to its left. */
      const overlap = (q) => { let a = 0; for (const p of placed) { const ow = Math.min(q.r, p.r) - Math.max(q.l, p.l), oh = Math.min(q.b, p.b) - Math.max(q.t, p.t); if (ow > 0 && oh > 0) a += ow * oh; } return a; };
      const consider = (dx, dy, kk) => {
        if (best) return;
        const q = rectOf(dx, dy, kk);
        if (q.t < 4 || q.b > sz.h - 4 || q.l < 2 || q.r > sz.w - 2) return;
        if (!hits(q.l, q.r, q.t, q.b)) { best = { dx, dy, k: kk, q }; return; }
        const a = overlap(q) + (Math.abs(dx) + Math.abs(dy) * 2) * 8;          // cheap tie-break: prefer the smaller move
        if (!least || a < least.a) least = { dx, dy, k: kk, a };
      };
      const stepX = it.w * 0.2, stepY = it.h * 0.3;
      for (const kk of [1, 0.86, 0.72]) {
        consider(0, 0, kk);
        for (let i = 1; i <= 8 && !best; i++) {
          consider(-i * stepX, 0, kk); consider(i * stepX, 0, kk);              // sideways first: the street is empty
          if (i <= 5) { consider(-i * stepX, -stepY, kk); consider(i * stepX, -stepY, kk); consider(-i * stepX, stepY * 0.7, kk); consider(i * stepX, stepY * 0.7, kk); }
        }
        for (let j = 1; j <= 3 && !best; j++) { consider(0, -j * stepY, kk); consider(0, j * stepY * 0.7, kk); }
        if (best) break;
      }
      const pick = best || least;
      if (pick) { offX = pick.dx; off = pick.dy; k = pick.k; }
      const q = rectOf(offX, off, k);
      placed.push({ l: q.l, r: q.r, t: q.t, b: q.b });
      it.e.off = off; it.e.offX = offX; it.e.scaleK = k;
      it.e.plate.userData.off = off; it.e.plate.userData.offX = offX; it.e.plate.userData.k = k;
      /* The nudge is applied through the sprite's own `center`, so it is exact
         on screen at any zoom and costs nothing. Increasing center.x moves the
         sprite LEFT, so a rightward screen offset is a NEGATIVE center delta. */
      it.e.plate.center.set(0.5 - offX / Math.max(1, it.w), (it.e.below ? 1 : 0) + off / Math.max(1, it.h));
      { const kk = 2 * Math.tan(rad(CAM.fov) / 2) / Math.max(1, sz.h); it.e.plate.scale.set(it.e.plate.userData.px.w * kk * plateK * k, it.e.plate.userData.px.h * kk * plateK * k, 1); }
      // lean the mast to wherever the plate ended up (pixels → world units via
      // the local screen scale, measured, so it is right at any zoom). The mast
      // now leans SIDEWAYS as well as stretching, because the resolver's first
      // move is a sideways slide and a mast that stayed vertical would point
      // at the gap next to the plate rather than at the plate.
      if (mastPos && it.e.mastIdx != null) {
        let dy = 0, dx = 0;
        if (off || offX) {
          const vY = tmpP.set(it.e.pos.x, it.e.lift + 1, it.e.plateZ).project(cam);
          const perUnitY = it.y - (1 - vY.y) / 2 * sz.h;    // px of screen per world unit, vertical
          if (perUnitY > 0.01) dy = -off / perUnitY;
          const vX = tmpP.set(it.e.pos.x + 1, it.e.lift, it.e.plateZ).project(cam);
          const perUnitX = (vX.x + 1) / 2 * sz.w - it.x;    // …and horizontal
          if (Math.abs(perUnitX) > 0.01) dx = offX / perUnitX;
        }
        const mk = it.e.mastIdx * 3;
        mastPos[mk + 3] = it.e.pos.x + dx;
        mastPos[mk + 4] = it.e.lift + dy;
        mastDirty = true;
      }
    }
    if (mastDirty && mastGeo) { mastGeo.getAttribute('position').needsUpdate = true; mastDirty = false; }
  };
  declutterFn = declutter;
  /* home() was solved before declutter existed (source order), so the first
     fit balanced a picture 90 px shorter than the one that gets drawn. Re-run
     it now that the real label placement is available. */
  if (!state.selected) { const hm = home(); Object.assign(cur, hm); Object.assign(tw.from, cur); Object.assign(tw.to, cur); applyCam(); }

  /* ── the frame ───────────────────────────────────────────────────────── */
  let raf = 0, dead = false, paused = false;
  // the azimuth the current idle sway swings around; null whenever the camera
  // is not idle, so the next idle re-anchors wherever the player left it
  let idleAz = null;
  const step = (now) => {
    stepCam();
    /* 🔴 THE IDLE TURNTABLE SWAYS, IT DOES NOT SPIN.
       This line used to be `cur.az += rad(CAM.idleSpinDegPerSec) * dt/1000` —
       an unbounded integration with no clamp against the padded frame and no
       re-run of the home() fit. Measured in the real page at 1600x900 from an
       untouched home: 33 plates in frame at t+0, 24 at t+60s (all four district
       labels gone), 27 at t+120s, and the districts skewed out of the owner's
       left-to-right order with CITY BUILDER clipped by the bottom edge. The
       overview is a picture of the owner's PDF; a camera that carries it out of
       frame and out of reading order is not a nicer version of it.
       Two properties, both deliberate:
       • BOUNDED. The azimuth never leaves ±CAM.idleSwayDeg of where the idle
         began, and home() has already proved the union of that whole band fits
         inside the same padX/padY margin — so nothing needs re-fitting as it
         turns, and nothing can drift out. A player who orbited somewhere else
         sways around THAT azimuth: we neither fight them nor make their frame
         worse than they left it.
       • A FUNCTION OF THE CLOCK, NOT AN ACCUMULATION. The phase is measured
         from the instant the idle started (lastInput + idleAfterMs), so the
         camera at time t is the same camera whatever the frame rate was on the
         way there. That matters twice: the 0.56 Hz Browser pane (CLAUDE.md) no
         longer produces a different picture from a 60 Hz tab, and a gate can
         photograph t+300s with one pause()+renderNow(t) instead of replaying
         1,500 frames and hoping the integration matches. */
    if (!still && !state.selected && !drag && now - lastInput > CAM.idleAfterMs) {
      if (idleAz == null) idleAz = cur.az;
      const el = now - lastInput - CAM.idleAfterMs;
      const per = Math.max(1, CAM.idleSwayPeriodMs);
      cur.az = idleAz + rad(CAM.idleSwayDeg || 0) * Math.sin(2 * Math.PI * el / per);
      Object.assign(tw.from, cur); Object.assign(tw.to, cur); applyCam();
    } else idleAz = null;
    stepTrucks(now); stepEmbers(now);
    declutter();
    if (!still) { const p = 1 + Math.sin(now / 300) * 0.03; selRing.scale.x = selRing.scale.y = ringR(state.selected) * p; }
  };
  const draw = (now) => { step(now == null ? Date.now() : now); renderer.render(scene, cam); };
  const frame = () => { if (dead || paused) return; draw(Date.now()); raf = requestAnimationFrame(frame); };
  restyle();
  frame();

  /* ── API ─────────────────────────────────────────────────────────────── */
  const flowSetFor = (resId) => {
    let f = null;
    try { if (typeof G.resourceFlow === 'function') f = G.resourceFlow(resId, G); } catch (e) { f = null; }
    const es = new Set(), ns = new Set();
    if (f && f.known !== false && Array.isArray(f.edges) && f.edges.length) { for (const id of f.edges) es.add(id); for (const id of (f.nodes || [])) ns.add(id); }
    else for (const e of edges) if ((e.cargo || []).indexOf(resId) >= 0) { es.add(e.id); ns.add(e.from); ns.add(e.to); }
    if (!es.size) return null;
    for (const e of edges) if (es.has(e.id)) { ns.add(e.from); ns.add(e.to); }
    return { edges: es, nodes: ns };
  };
  return {
    select: (id) => { if (id == null) { goHome(true); return true; } return focus(id, true); },
    home: () => goHome(true),
    selected: () => state.selected,
    highlightFlow: (resId) => { state.flow = resId || null; state.flowSet = resId ? flowSetFor(resId) : null; if (resId && !state.flowSet) state.flow = null; restyle(); return !!state.flowSet; },
    setFilter: (f) => { state.filter = f || null; restyle(); },
    renderNow: (t) => { draw(t); return renderer.info.render.calls; },
    /* pause() stops the RAF loop so renderNow(t) is the ONLY frame — a test
       photographs one deterministic clock instead of racing the animation. */
    pause: () => { paused = true; cancelAnimationFrame(raf); },
    resume: () => { if (paused && !dead) { paused = false; frame(); } },
    project: (id) => {
      const e = N.get(id); if (!e) return null;
      /* 🔴 A POINT INSIDE THE PLATE, NOT ITS BOTTOM EDGE. This used to return
         the sprite's ANCHOR, which for an upward-growing plate is exactly its
         bottom edge — so a pointermove at project(id) landed one pixel
         outside the rectangle and hit whatever was behind it. Measured: the
         round-5 build hit the right tile on 4 of 27 tiles, and two of them
         (genelab, research) hit-tested as a different business entirely, so a
         hover card anchored on project() reported the wrong company. Both
         hover.js and modal.js anchor here, so this returns the plate's CENTRE
         with every declutter nudge and shrink applied — the same rectangle
         plateAt() tests — plus the rectangle itself, so a caller that wants
         to sit under the plate does not have to guess its size. */
      const v = new T.Vector3(e.pos.x, e.lift, e.plateZ).project(cam); const sz = S.size();
      const kk = e.scaleK || 1;
      const pw = e.plate.userData.px.w * plateK * kk, ph = e.plate.userData.px.h * plateK * kk;
      const ax = (v.x + 1) / 2 * sz.w + (e.offX || 0), ay = (1 - v.y) / 2 * sz.h + (e.off || 0);
      const top = e.below ? ay : ay - ph;
      return { x: ax, y: top + ph / 2, anchorY: ay, w: pw, h: ph, top, bottom: top + ph, left: ax - pw / 2, right: ax + pw / 2, visible: v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1, depth: v.z };
    },
    layout: LAY,
    stats: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, nodes: N.size, lanes: lanes.length, trucks: trucks.length, embers: emberN, batches: batches.size, proxies: proxies.length }),
    dispose: () => {
      dead = true; cancelAnimationFrame(raf);
      cv.removeEventListener('pointerdown', onDown); cv.removeEventListener('pointermove', onMove); cv.removeEventListener('pointerup', onUp); cv.removeEventListener('pointerleave', onLeave); cv.removeEventListener('wheel', onWheel);
      for (const m of Object.values(MAT)) { try { m.dispose(); } catch (e) {} }
      for (const d of disposables) { try { d.dispose(); } catch (e) {} }
      S.kill();
    },
  };
}

export default mountScene;
