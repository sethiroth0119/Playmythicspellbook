/* ═══════════════════════════════════════════════════════════════════════════
   haul.game.js — THE HIGHWAY RUN. A Crazy-Taxi-style 3D drive, built on the
   three@0.171 import map index.html already declares (WebGPU, with the WebGL
   backend as fallback on browsers without navigator.gpu).

   WHAT IT IS
     One highway, four lanes one way, guardrails, a road that bends, traffic
     that follows and signals like traffic, and a ROUTE: the shortest path on
     the city node map, city by city. Every city on the way is a JUNCTION with
     a real exit ramp and real signs naming the nodes each road leads to; the
     GPS in the corner says which one to take. Miss it and you are rerouted —
     more road, more clock. Hazards, weather, raiders and toll gates come from
     the route too, so no two hauls are the same road.

   WHAT IT IS NOT
     A money path. play() resolves a plain outcome object; the caller decides
     what it is worth (sql/038–039 do, server-side). Nothing here touches the
     bridge, the wallet or Supabase. That is what lets a test page drive it.

   ⚠ Everything created here is torn down in destroy(): renderer, listeners,
     DOM, the RAF loop. A leaked renderer is a leaked GPU context and the
     second run would fail to init.
   ═══════════════════════════════════════════════════════════════════════════ */

import { roadLength, parSeconds, normalizeCities, route as routeOf } from './haul.map.js';
import { cargoClass, CARGO_CLASSES, upgradeEffects, weatherFor } from './haul.economy.js';

// The lanes. 4 × 3.6 m + a 1.4 m shoulder each side; the rail sits at ±HALF.
const LANE_W = 3.6, LANES = 4, ROAD_W = LANE_W * LANES, HALF = ROAD_W / 2 + 1.4;
const SEG_LEN = 40, SEGS = 16;
const PLAYER_HALF_W = 1.15, PLAYER_HALF_L = 4.2;
const BASE_MAX_SPEED = 62;                      // m/s (≈ 220 km/h) flat out
const CAR_HIT_DMG = 9, RAIL_HIT_DMG = 4, HAZARD_DMG = 3, RAIDER_DMG = 8;
// Exit ramps: the extra lane opens RAMP_IN metres before the junction and the
// decision is read RAMP_OUT metres after it.
const RAMP_IN = 60, RAMP_OUT = 100;

function centreX(z) { return 6 * Math.sin(z / 260) + 3.5 * Math.sin(z / 97 + 1.3); }
function laneX(i) { return -ROAD_W / 2 + LANE_W * (i + 0.5); }
function hash(str) { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/* ── THE ROUTE PLAN ──────────────────────────────────────────────────────────
   Turns a map route into the run's timeline: where each city sits on the road,
   whether the route continues on the mainline or down the exit there, what
   the signs say, where the hazards and raiders are, and the weather. Seeded
   from the route so the same haul is the same road every time — a driver can
   learn a route, which is what makes taking the right exit a skill. */
export function planRun(cities, fromId, toId, opts) {
  opts = opts || {};
  const C = normalizeCities(cities); const byId = {}; C.forEach((c) => { byId[c.id] = c; });
  const r = routeOf(C, fromId, toId);
  if (!r) return null;
  const rnd = mulberry(hash(fromId + '>' + toId));
  const total = roadLength(r.km);
  const mPerKm = total / Math.max(0.1, r.km);
  const junctions = []; let z = 0;
  for (let i = 1; i < r.path.length; i++) {
    z += r.legs[i - 1].km * mPerKm;
    const node = byId[r.path[i]]; const last = i === r.path.length - 1;
    const next = last ? null : byId[r.path[i + 1]];
    const others = (node.connections || []).filter((id) => id !== r.path[i - 1] && (!next || id !== next.id)).map((id) => byId[id]).filter(Boolean);
    // The destination is always an exit. In between, the route leaves the
    // mainline about a third of the time — enough that "always stay on" is
    // never a safe habit.
    const viaExit = last || rnd() < 0.36;
    const exitTo = viaExit ? [last ? node : next].concat(others.slice(0, 1)) : others.slice(0, 2);
    const thruTo = viaExit ? others.slice(0, 2) : [next].concat(others.slice(2, 3));
    // A two-road town has no "other" destination: its exit is the town itself
    // and the mainline runs on. The sign must never be blank.
    const exitNames = exitTo.length ? exitTo.map((n) => n.name) : [node.name + ' (TOWN)'];
    junctions.push({ z: Math.round(z), node, nextName: last ? node.name : next.name, viaExit, last,
                     exitNames, thruNames: thruTo.length ? thruTo.map((n) => n.name) : ['OPEN HIGHWAY'],
                     toll: !!(node.ownerId && opts.driverId && node.ownerId !== opts.driverId && !last) || !!(opts.forceToll && !last),
                     tollOwner: node.ownerName || '' });
  }
  const hazards = [];
  for (let hz = 500 + rnd() * 400; hz < total - 250; hz += 650 + rnd() * 500) {
    // Keep hazards off the ramps, where the driver is already busy.
    if (junctions.some((j) => Math.abs(j.z - hz) < 260)) continue;
    const kind = ['debris', 'breakdown', 'cones'][Math.floor(rnd() * 3)];
    hazards.push({ z: Math.round(hz), kind, lane: Math.floor(rnd() * LANES) });
  }
  const raiders = [];
  if (r.km > 40) for (let rz = 900 + rnd() * 600; rz < total - 400 && raiders.length < 3; rz += 2000 + rnd() * 1500) raiders.push({ z: Math.round(rz) });
  const weather = weatherFor(byId[toId], rnd);
  return { route: r, total, par: parSeconds(r.km), junctions, hazards, raiders, weather, cities: C, fromId, toId };
}

export async function play(opts) {
  opts = opts || {};
  const plan = opts.plan || planRun(opts.cities || [], opts.fromId, opts.toId, opts);
  if (!plan) throw new Error('No route between those cities.');
  const { total, par, junctions, hazards, weather } = plan;
  const km = plan.route.km;
  const cls = CARGO_CLASSES[cargoClass(opts.resource)] || CARGO_CLASSES.standard;
  const up = upgradeEffects(opts.upgrades);
  const MAX_SPEED = BASE_MAX_SPEED * cls.speed * up.speed;
  let THREE;
  try { THREE = await import('three'); }
  catch (e) { throw new Error('three.js failed to load — the run needs the 3D engine. ' + ((e && e.message) || '')); }

  // ── DOM ───────────────────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.id = 'haul-run';
  root.innerHTML = `
    <canvas id="haul-canvas"></canvas>
    <div class="haul-hud">
      <div class="haul-hud-row haul-hud-top">
        <div class="haul-pill"><span class="haul-k">ROUTE</span> ${esc(plan.route.path[0] && plan.cities.find((c) => c.id === plan.fromId).name)} → ${esc(plan.cities.find((c) => c.id === plan.toId).name)} · ${km.toFixed(1)} km</div>
        <div class="haul-pill"><span class="haul-k">CARGO</span> <span id="haul-cargo">100%</span> · ${esc(opts.cargoLabel || 'freight')} <span class="haul-dim">${cls.label}</span></div>
        <div class="haul-pill"><span class="haul-k">TIME</span> <span id="haul-time">0:00</span> <span class="haul-dim">/ par ${fmtT(par)}</span></div>
        <div class="haul-pill haul-dim">${weather.icon} ${esc(weather.label)}${opts.guard ? ' · <span id="haul-guard">🛡 GUARD READY</span>' : ''}</div>
      </div>
      <div class="haul-progress"><div id="haul-prog-bar"></div><div id="haul-prog-txt"></div></div>
      <div class="haul-hud-spacer"></div>
      <div class="haul-gps"><canvas id="haul-gps" width="240" height="170"></canvas><div class="haul-gps-txt" id="haul-gps-txt"></div></div>
      <div class="haul-hud-row haul-hud-bottom">
        <div class="haul-pill haul-speed"><span id="haul-speed">0</span><span class="haul-dim"> km/h</span></div>
        <div class="haul-pill">🚗 <span id="haul-cc">0</span> &nbsp; 🛤 <span id="haul-cr">0</span> &nbsp; ⚠ <span id="haul-hz">0</span></div>
        <div class="haul-pill haul-dim" id="haul-hint">↑/W gas · ↓/S brake · ←/→ steer · Esc pause</div>
      </div>
      <div class="haul-touch">
        <button class="haul-tbtn" data-t="left">◀</button>
        <button class="haul-tbtn" data-t="brake">BRAKE</button>
        <button class="haul-tbtn" data-t="right">▶</button>
      </div>
      <div class="haul-flash" id="haul-flash"></div>
      <div class="haul-pause" id="haul-pause" hidden>
        <div class="haul-pause-card">
          <h3>Paused</h3>
          <p>Abandon the run and the shipment goes back on the board. The failure stays on your record.</p>
          <button class="haul-btn" id="haul-resume">Resume</button>
          <button class="haul-btn haul-btn-danger" id="haul-abandon">Abandon run</button>
        </div>
      </div>
      <div class="haul-countdown" id="haul-count">3</div>
    </div>`;
  document.body.appendChild(root);
  const $ = (id) => root.querySelector('#' + id);
  const canvas = $('haul-canvas');

  // ── Renderer & world ──────────────────────────────────────────────────────
  const hasGPU = !!(typeof navigator !== 'undefined' && navigator.gpu);
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: !hasGPU });
  try { await renderer.init(); }
  catch (e) { root.remove(); throw new Error('The 3D renderer could not start on this device. ' + ((e && e.message) || '')); }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new THREE.Scene();
  const sky = new THREE.Color().setHSL(weather.skyH, weather.skyS, weather.skyL);
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, weather.fogNear, weather.fogFar);
  const cam = new THREE.PerspectiveCamera(62, 1, 0.5, 900);
  // r155+ lights are physically scaled, so these read high: the first cut at
  // 0.9 / 1.4 rendered the skyline as black slabs in a driven screenshot.
  scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x5a4636, 2.2 * weather.light));
  const sun = new THREE.DirectionalLight(0xffd9a8, 2.6 * weather.light); sun.position.set(-60, 120, -80); scene.add(sun);

  const M = {
    road: new THREE.MeshLambertMaterial({ color: 0x2b2d33 }),
    shoulder: new THREE.MeshLambertMaterial({ color: 0x3a3630 }),
    stripe: new THREE.MeshBasicMaterial({ color: 0xd8d0a0 }),
    edge: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    rail: new THREE.MeshLambertMaterial({ color: 0x9aa4b0 }),
    post: new THREE.MeshLambertMaterial({ color: 0x555a60 }),
    ground: new THREE.MeshLambertMaterial({ color: 0x2a2620 }),
    bld: [0x4a5068, 0x5a4848, 0x445a50, 0x605840].map((c) => new THREE.MeshLambertMaterial({ color: c })),
    win: new THREE.MeshBasicMaterial({ color: 0xffc070 }),
    wheel: new THREE.MeshLambertMaterial({ color: 0x151515 }),
    glass: new THREE.MeshLambertMaterial({ color: 0x8fd0ff }),
    cargo: new THREE.MeshLambertMaterial({ color: opts.cargoColor ? new THREE.Color(opts.cargoColor) : 0xd4af37 }),
    player: new THREE.MeshLambertMaterial({ color: 0xff7a2b }),
    blink: new THREE.MeshBasicMaterial({ color: 0xffa000 }),
    blinkOff: new THREE.MeshBasicMaterial({ color: 0x4a2a00 }),
    cone: new THREE.MeshLambertMaterial({ color: 0xff6a1a }),
    debris: new THREE.MeshLambertMaterial({ color: 0x6a6258 }),
    raider: new THREE.MeshLambertMaterial({ color: 0xc02020 }),
    signGreen: new THREE.MeshLambertMaterial({ color: 0x1f6b3a }),
    signBlue: new THREE.MeshLambertMaterial({ color: 0x1f3d8a }),
    signWarn: new THREE.MeshLambertMaterial({ color: 0xd9a400 }),
    toll: new THREE.MeshLambertMaterial({ color: 0x8a2a2a }),
    tracer: new THREE.MeshBasicMaterial({ color: 0xffee88 }),
  };
  const G = {
    road: new THREE.PlaneGeometry(ROAD_W, SEG_LEN), ramp: new THREE.PlaneGeometry(LANE_W, SEG_LEN),
    shoulder: new THREE.PlaneGeometry(1.4, SEG_LEN), ground: new THREE.PlaneGeometry(260, SEG_LEN),
    stripe: new THREE.PlaneGeometry(0.16, 3), edge: new THREE.PlaneGeometry(0.2, SEG_LEN),
    rail: new THREE.BoxGeometry(0.16, 0.36, SEG_LEN), post: new THREE.BoxGeometry(0.14, 0.9, 0.14),
    wheel: new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10), cone: new THREE.ConeGeometry(0.35, 0.9, 8), blinkG: new THREE.BoxGeometry(0.22, 0.16, 0.12),
  };

  /* Text on a sign: a 2D canvas painted once, used as a texture. */
  function textPanel(lines, w, h, bg, fg, fontPx) {
    const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * h / w);
    const g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#ffffff'; g.lineWidth = 8; g.strokeRect(6, 6, c.width - 12, c.height - 12);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    const lh = c.height / (lines.length + 0.4);
    lines.forEach((t, i) => { g.font = 'bold ' + Math.min(fontPx || 64, lh * 0.7) + 'px sans-serif'; g.fillText(String(t).slice(0, 26), c.width / 2, lh * (i + 0.7)); });
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
    return m;
  }
  function placeAt(obj, z, x, y) { obj.position.set(centreX(z) + x, y, -z); obj.rotation.y = -Math.atan2((centreX(z + 1) - centreX(z - 1)) / 2, 1); scene.add(obj); return obj; }
  function roadsideSign(z, lines, mat, side, big) {
    const g = new THREE.Group();
    const w = big ? 7 : 5, h = big ? 3 : 2;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 4, 0.25), M.post); post.position.set(0, 2, 0); g.add(post);
    const panel = textPanel(lines, w, h, mat === M.signGreen ? '#1f6b3a' : mat === M.signBlue ? '#1f3d8a' : mat === M.toll ? '#8a2a2a' : '#d9a400', '#ffffff'); panel.position.set(0, 4 + h / 2, 0); panel.rotation.y = Math.PI; g.add(panel);
    return placeAt(g, z, side * (HALF + 2.2 + (big ? 1.5 : 0)), 0);
  }
  /* The gantry: two panels over the road, THRU on the left, EXIT on the right. */
  function gantry(z, thru, exit, dist) {
    const g = new THREE.Group();
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8, 0.5), M.post); p.position.set(s * (HALF + LANE_W * 0.5), 4, 0); g.add(p); }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 + LANE_W + 1, 0.5, 0.5), M.post); bar.position.set(0, 8, 0); g.add(bar);
    const L = textPanel(['↑ ' + (dist ? dist + ' m' : 'THRU')].concat(thru), 8, 3.2, '#1f6b3a', '#ffffff'); L.position.set(-4.6, 6.4, 0); L.rotation.y = Math.PI; g.add(L);
    const R = textPanel(['EXIT ↗ ' + (dist ? dist + ' m' : '')].concat(exit), 8, 3.2, '#1f3d8a', '#ffffff'); R.position.set(4.6, 6.4, 0); R.rotation.y = Math.PI; g.add(R);
    return placeAt(g, z, 0, 0);
  }

  // ── Road chunks, recycled as the rig advances ─────────────────────────────
  const segs = [];
  function makeSegment(z0) {
    const g = new THREE.Group();
    const road = new THREE.Mesh(G.road, M.road); road.rotation.x = -Math.PI / 2; g.add(road);
    const gr = new THREE.Mesh(G.ground, M.ground); gr.rotation.x = -Math.PI / 2; gr.position.y = -0.05; g.add(gr);
    const parts = { railR: new THREE.Group(), ramp: new THREE.Group() };
    for (const s of [-1, 1]) {
      const sh = new THREE.Mesh(G.shoulder, M.shoulder); sh.rotation.x = -Math.PI / 2; sh.position.set(s * (ROAD_W / 2 + 0.7), 0.005, 0); (s > 0 ? parts.railR : g).add(sh);
      const ed = new THREE.Mesh(G.edge, M.edge); ed.rotation.x = -Math.PI / 2; ed.position.set(s * (ROAD_W / 2 - 0.1), 0.01, 0); (s > 0 ? parts.railR : g).add(ed);
      const r = new THREE.Mesh(G.rail, M.rail); r.position.set(s * HALF, 0.75, 0); (s > 0 ? parts.railR : g).add(r);
      for (let k = -SEG_LEN / 2 + 2; k < SEG_LEN / 2; k += 4) { const p = new THREE.Mesh(G.post, M.post); p.position.set(s * HALF, 0.45, k); (s > 0 ? parts.railR : g).add(p); }
    }
    for (let l = 1; l < LANES; l++) for (let k = -SEG_LEN / 2 + 1.5; k < SEG_LEN / 2; k += 6) {
      const st = new THREE.Mesh(G.stripe, M.stripe); st.rotation.x = -Math.PI / 2; st.position.set(-ROAD_W / 2 + l * LANE_W, 0.01, k); g.add(st);
    }
    // The exit ramp lane: hidden unless this chunk sits in a ramp window. When
    // shown, the right rail assembly is shifted out a lane.
    const rp = new THREE.Mesh(G.ramp, M.road); rp.rotation.x = -Math.PI / 2; rp.position.set(ROAD_W / 2 + LANE_W / 2, 0.002, 0); parts.ramp.add(rp);
    for (let k = -SEG_LEN / 2 + 1.5; k < SEG_LEN / 2; k += 3) { const st = new THREE.Mesh(G.stripe, M.edge); st.rotation.x = -Math.PI / 2; st.position.set(ROAD_W / 2, 0.012, k); parts.ramp.add(st); }
    parts.ramp.visible = false;
    g.add(parts.railR); g.add(parts.ramp);
    g.userData.parts = parts; g.userData.props = new THREE.Group(); g.add(g.userData.props);
    scene.add(g);
    const seg = { g, z0 }; placeSegment(seg, z0); return seg;
  }
  function rampAt(z) { return junctions.some((j) => z > j.z - RAMP_IN && z < j.z + RAMP_OUT); }
  function placeSegment(seg, z0) {
    seg.z0 = z0;
    seg.g.position.set(centreX(z0 + SEG_LEN / 2), 0, -(z0 + SEG_LEN / 2));
    // Travel is toward −Z, so a bend toward +x is a NEGATIVE yaw about Y
    // (rotation.y = θ sends the −Z nose to (−sin θ, 0, −cos θ)). Same sign
    // rule for every vehicle below.
    const dx = centreX(z0 + SEG_LEN) - centreX(z0);
    seg.g.rotation.y = -Math.atan2(dx, SEG_LEN);
    const ramp = rampAt(z0 + SEG_LEN / 2);
    seg.g.userData.parts.ramp.visible = ramp;
    seg.g.userData.parts.railR.position.x = ramp ? LANE_W : 0;
    const P = seg.g.userData.props;
    while (P.children.length) { const c = P.children.pop(); P.remove(c); c.geometry.dispose(); }
    const rnd = mulberry(Math.floor(z0 / SEG_LEN) * 7919 + Math.floor(km * 13));
    const n = 3 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const side = rnd() < 0.5 ? -1 : 1;
      const w = 6 + rnd() * 16, h = 4 + rnd() * 26, d = 6 + rnd() * 12;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M.bld[Math.floor(rnd() * M.bld.length)]);
      b.position.set(side * (HALF + 8 + rnd() * 40 + w / 2), h / 2 - 0.05, -SEG_LEN / 2 + rnd() * SEG_LEN);
      P.add(b);
      if (rnd() < (weather.night ? 0.9 : 0.5)) { const wnd = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.6), M.win); wnd.position.set(b.position.x - side * (w / 2 + 0.02), 2 + rnd() * (h - 3), b.position.z); wnd.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2; P.add(wnd); }
    }
    if (rnd() < 0.35) { const py = new THREE.Mesh(new THREE.BoxGeometry(0.6, 28, 0.6), M.post); const side = rnd() < 0.5 ? -1 : 1; py.position.set(side * (HALF + 5), 14, 0); P.add(py); }
  }
  for (let i = 0; i < SEGS; i++) segs.push(makeSegment(i * SEG_LEN));

  // ── Signs, gates, hazards: absolute objects placed once ───────────────────
  for (const j of junctions) {
    roadsideSign(j.z - 480, ['◆ ' + j.node.name, (j.node.sector || 'SETTLEMENT').toUpperCase()], M.signGreen, 1, true);
    gantry(j.z - 300, j.thruNames, j.exitNames, 300);
    gantry(j.z - 90, j.thruNames, j.exitNames, 0);
    if (j.toll) roadsideSign(j.z - 200, ['TOLL GATE', j.tollOwner ? 'OWNER: ' + j.tollOwner : 'PRIVATE NODE', 'SLOW TO 40'], M.toll, 1, true);
    if (j.toll) { const gate = new THREE.Group(); const b = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3, 0.4), M.toll); b.position.set(-HALF, 1.5, 0); gate.add(b); const arm = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 + LANE_W, 0.25, 0.25), M.signWarn); arm.position.set(LANE_W / 2, 2.6, 0); gate.add(arm); placeAt(gate, j.z - 20, 0, 0); j.gate = gate; }
  }
  for (const hz of hazards) {
    roadsideSign(hz.z - 260, ['⚠ ' + ({ debris: 'DEBRIS', breakdown: 'BREAKDOWN', cones: 'LANES CLOSED' })[hz.kind], 'AHEAD 250 m'], M.signWarn, 1, false);
    hz.objs = [];
    if (hz.kind === 'debris') for (let i = 0; i < 3; i++) { const d = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 1.2), M.debris); const lane = (hz.lane + i) % LANES; placeAt(d, hz.z + i * 9, laneX(lane) + (i % 2 ? 0.8 : -0.6), 0.35); hz.objs.push({ mesh: d, z: hz.z + i * 9, x: laneX(lane) + (i % 2 ? 0.8 : -0.6), hw: 0.6, hl: 0.6, dmg: HAZARD_DMG, live: true }); }
    if (hz.kind === 'breakdown') { const lane = Math.min(hz.lane, LANES - 2); const t = makeCar(true, 0x777777); placeAt(t, hz.z, laneX(lane) + LANE_W / 2, 0); t.rotation.y += 0.5; hz.objs.push({ mesh: t, z: hz.z, x: laneX(lane) + LANE_W / 2, hw: 3.2, hl: 5.2, dmg: CAR_HIT_DMG, live: true, car: true, blink: true }); }
    if (hz.kind === 'cones') for (let i = 0; i < 14; i++) { const c = new THREE.Mesh(G.cone, M.cone); const zz = hz.z + i * 9; const x = i < 4 ? ROAD_W / 2 - LANE_W * (i / 4) * 2 : ROAD_W / 2 - LANE_W * 2; placeAt(c, zz, x, 0.45); hz.objs.push({ mesh: c, z: zz, x, hw: 0.4, hl: 0.4, dmg: 1.5, live: true }); }
  }
  const gate = new THREE.Group();
  { const m = new THREE.MeshLambertMaterial({ color: 0xffd166 });
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(1, 9, 1), m); p.position.set(s * (HALF + LANE_W + 0.5), 4.5, 0); gate.add(p); }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 + LANE_W * 2 + 2, 1.2, 1), m); bar.position.set(0, 9, 0); gate.add(bar);
    const t = textPanel(['◆ ' + plan.cities.find((c) => c.id === plan.toId).name], 12, 2, '#1f6b3a', '#ffffff'); t.position.set(0, 11, 0); t.rotation.y = Math.PI; gate.add(t);
    placeAt(gate, total, 0, 0); }

  // ── Vehicles ──────────────────────────────────────────────────────────────
  function addBlinkers(g, halfW, frontZ, rearZ, y) {
    g.userData.blink = { L: [], R: [] };
    for (const [side, key] of [[-1, 'L'], [1, 'R']]) for (const z of [frontZ, rearZ]) { const m = new THREE.Mesh(G.blinkG, M.blinkOff); m.position.set(side * (halfW - 0.05), y, z); g.add(m); g.userData.blink[key].push(m); }
  }
  function setBlink(g, dir, on) {
    const b = g.userData.blink; if (!b) return;
    b.L.forEach((m) => { m.material = ((dir < 0 || dir === 2) && on) ? M.blink : M.blinkOff; });
    b.R.forEach((m) => { m.material = ((dir > 0) && on) ? M.blink : M.blinkOff; });
  }
  /* Vehicles travel toward −Z, so every model is built nose-at-+Z for
     readability and turned 180° here. */
  function makeCar(truck, color, mat) {
    const outer = new THREE.Group(); const g = new THREE.Group(); g.rotation.y = Math.PI; outer.add(g);
    const body = mat || new THREE.MeshLambertMaterial({ color });
    if (truck) {
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 2.6), body); cab.position.set(0, 1.5, 3.2); g.add(cab);
      const box = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.8, 8.5), new THREE.MeshLambertMaterial({ color: 0xc8c8c8 })); box.position.set(0, 1.7, -2.4); g.add(box);
      const gl = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 0.1), M.glass); gl.position.set(0, 2.1, 4.52); g.add(gl);
      for (const [x, z] of [[-1.1, 3.2], [1.1, 3.2], [-1.1, -1], [1.1, -1], [-1.1, -5], [1.1, -5]]) { const w = new THREE.Mesh(G.wheel, M.wheel); w.rotation.z = Math.PI / 2; w.position.set(x, 0.42, z); g.add(w); }
      addBlinkers(g, 1.25, 4.45, -6.6, 1.1);
      outer.userData.halfL = 6.6; outer.userData.halfW = 1.3;
    } else {
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.8, 4.3), body); b.position.y = 0.7; g.add(b);
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 2.2), body); top.position.set(0, 1.4, -0.2); g.add(top);
      const gl = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.1), M.glass); gl.position.set(0, 1.4, 0.95); g.add(gl);
      for (const [x, z] of [[-0.9, 1.4], [0.9, 1.4], [-0.9, -1.4], [0.9, -1.4]]) { const w = new THREE.Mesh(G.wheel, M.wheel); w.rotation.z = Math.PI / 2; w.position.set(x, 0.42, z); g.add(w); }
      addBlinkers(g, 0.95, 2.1, -2.1, 0.75);
      outer.userData.halfL = 2.2; outer.userData.halfW = 1.0;
    }
    return outer;
  }
  const rigOuter = new THREE.Group(); const rig = new THREE.Group(); rig.rotation.y = Math.PI; rigOuter.add(rig);
  { const cab = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.3, 2.4), M.player); cab.position.set(0, 1.45, 2.9); rig.add(cab);
    const gl = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.8, 0.1), M.glass); gl.position.set(0, 2.0, 4.12); rig.add(gl);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 6), new THREE.MeshLambertMaterial({ color: 0x333 })); bed.position.set(0, 0.85, -1.4); rig.add(bed);
    for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.4, 1.6), M.cargo); c.position.set(0, 1.8, 0.4 - i * 1.9); c.userData.cargo = true; rig.add(c); }
    for (const [x, z] of [[-1.05, 2.9], [1.05, 2.9], [-1.05, -0.8], [1.05, -0.8], [-1.05, -3.4], [1.05, -3.4]]) { const w = new THREE.Mesh(G.wheel, M.wheel); w.rotation.z = Math.PI / 2; w.position.set(x, 0.42, z); rig.add(w); }
    if (opts.guard) { const gd = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.2, 0.7), new THREE.MeshLambertMaterial({ color: 0x2f5d3a })); gd.position.set(0.6, 3.1, 2.9); rig.add(gd); const gun = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 1.6), M.wheel); gun.position.set(0.6, 3.4, 1.8); rig.add(gun); }
    addBlinkers(rig, 1.2, 4.05, -4.35, 1.0);
    scene.add(rigOuter); }
  const tracer = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 30), M.tracer); tracer.visible = false; scene.add(tracer);

  // Rain: a cloud of short streaks that rides along with the camera.
  let rain = null;
  if (weather.rain) {
    const N = 500; const pos = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) { const x = (Math.random() - 0.5) * 60, y = Math.random() * 25, z = (Math.random() - 0.5) * 80; pos.set([x, y, z, x + 0.2, y - 1.4, z], i * 6); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x9fb4d8, transparent: true, opacity: 0.45 })); scene.add(rain);
  }

  const traffic = [];
  const TRAFFIC_COLORS = [0x7a8aa0, 0xa04040, 0x4060a0, 0x9a9a70, 0x507050, 0xc0c0c0, 0x604080];
  function spawnTraffic(zAhead) {
    const truck = Math.random() < 0.3;
    const lane = Math.floor(Math.random() * LANES);
    if (hazards.some((h) => Math.abs(h.z - zAhead) < 120)) return;
    const mesh = makeCar(truck, TRAFFIC_COLORS[Math.floor(Math.random() * TRAFFIC_COLORS.length)]);
    const cruise = (truck ? 17 : 22) + Math.random() * (truck ? 5 : 11);
    const v = { mesh, lane, x: laneX(lane), z: zAhead, speed: cruise, cruise, truck, halfL: mesh.userData.halfL, halfW: mesh.userData.halfW, hitCd: 0,
                phase: 'cruise', toLane: lane, sigDir: 0, sigT: 0, decideCd: 1 + Math.random() * 3 };
    if (traffic.some((t) => t.lane === lane && Math.abs(t.z - v.z) < 24)) return;
    scene.add(mesh); traffic.push(v);
  }

  // ── State ─────────────────────────────────────────────────────────────────
  const S = {
    z: 0, x: 0, speed: 0, heading: 0, t: 0, cargo: 100, cc: 0, cr: 0, hz: 0, wrongExits: 0, detourM: 0, total,
    railCd: 0, done: false, paused: false, abandoned: false, started: false, jIdx: 0, tollsHit: 0, tollsPaid: [],
    raider: null, raiderIdx: 0, raidersBeaten: 0, raiderHits: 0, guardUsed: false, tracerT: 0,
    keys: {}, touch: { left: false, right: false, brake: false },
  };
  // 🧪 Read-only peek for driven tests (window.__haulRun.t vs wall time tells
  //    you the sim is running at speed). Nothing reads it in the game.
  try { window.__haulRun = S; S._traffic = traffic; S._plan = plan; } catch (e) {}
  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  if (isTouch) { root.classList.add('haul-is-touch'); $('haul-hint').textContent = 'Auto throttle · tap ◀ ▶ to steer · hold BRAKE'; }
  const rightLimit = () => HALF + (rampAt(S.z) ? LANE_W : 0);

  // ── Input ─────────────────────────────────────────────────────────────────
  const onKey = (e) => {
    if (e.type === 'keydown' && e.key === 'Escape') { e.preventDefault(); togglePause(); return; }
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', ' '].includes(k)) { S.keys[k] = (e.type === 'keydown'); e.preventDefault(); }
  };
  window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKey);
  root.querySelectorAll('.haul-tbtn').forEach((b) => {
    const t = b.dataset.t;
    const on = (ev) => { ev.preventDefault(); S.touch[t] = true; };
    const off = (ev) => { ev.preventDefault(); S.touch[t] = false; };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
  });
  function togglePause() { if (S.done || !S.started) return; S.paused = !S.paused; $('haul-pause').hidden = !S.paused; }
  $('haul-resume').onclick = () => { S.paused = false; $('haul-pause').hidden = true; };
  $('haul-abandon').onclick = () => { S.abandoned = true; finish(); };
  const onResize = () => {
    const w = root.clientWidth || window.innerWidth, h = root.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize); onResize();

  // ── GPS minimap ───────────────────────────────────────────────────────────
  const gps = $('haul-gps').getContext('2d');
  const gpsBox = (() => {
    const ids = new Set(plan.route.path); plan.route.path.forEach((id) => { const c = plan.cities.find((x) => x.id === id); (c.connections || []).forEach((n) => ids.add(n)); });
    const pts = [...ids].map((id) => plan.cities.find((c) => c.id === id)).filter(Boolean);
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return { x0: Math.min(...xs) - 4, y0: Math.min(...ys) - 4, x1: Math.max(...xs) + 4, y1: Math.max(...ys) + 4, ids };
  })();
  function gpsPt(c) { const W = 240, H = 170; const sx = W / (gpsBox.x1 - gpsBox.x0), sy = H / (gpsBox.y1 - gpsBox.y0); const s = Math.min(sx, sy); return [(c.x - gpsBox.x0) * s + (W - (gpsBox.x1 - gpsBox.x0) * s) / 2, (c.y - gpsBox.y0) * s + (H - (gpsBox.y1 - gpsBox.y0) * s) / 2]; }
  function drawGps() {
    const W = 240, H = 170; gps.clearRect(0, 0, W, H);
    gps.fillStyle = 'rgba(8,10,16,.85)'; gps.fillRect(0, 0, W, H);
    const byId = {}; plan.cities.forEach((c) => { byId[c.id] = c; });
    gps.strokeStyle = 'rgba(255,255,255,.18)'; gps.lineWidth = 1;
    for (const id of gpsBox.ids) { const c = byId[id]; if (!c) continue; for (const n of c.connections) { if (!gpsBox.ids.has(n) || !byId[n]) continue; const a = gpsPt(c), b = gpsPt(byId[n]); gps.beginPath(); gps.moveTo(a[0], a[1]); gps.lineTo(b[0], b[1]); gps.stroke(); } }
    gps.strokeStyle = '#ffb060'; gps.lineWidth = 3; gps.beginPath();
    plan.route.path.forEach((id, i) => { const p = gpsPt(byId[id]); if (i === 0) gps.moveTo(p[0], p[1]); else gps.lineTo(p[0], p[1]); }); gps.stroke();
    for (const id of gpsBox.ids) { const c = byId[id]; if (!c) continue; const p = gpsPt(c); const onRoute = plan.route.path.includes(id); gps.fillStyle = onRoute ? '#ffd166' : '#8090a8'; gps.beginPath(); gps.arc(p[0], p[1], onRoute ? 4 : 2.5, 0, Math.PI * 2); gps.fill();
      if (onRoute) { gps.fillStyle = '#e8e0d0'; gps.font = 'bold 9px sans-serif'; gps.fillText(c.name.slice(0, 12), p[0] + 6, p[1] + 3); } }
    // The rig: interpolated along the current leg.
    let z0 = 0, legI = 0; for (let i = 0; i < junctions.length; i++) { if (S.z >= junctions[i].z) { z0 = junctions[i].z; legI = i + 1; } else break; }
    const a = byId[plan.route.path[Math.min(legI, plan.route.path.length - 1)]], b = byId[plan.route.path[Math.min(legI + 1, plan.route.path.length - 1)]];
    const z1 = junctions[legI] ? junctions[legI].z : total; const f = Math.max(0, Math.min(1, (S.z - z0) / Math.max(1, z1 - z0)));
    const pa = gpsPt(a), pb = gpsPt(b); const px = pa[0] + (pb[0] - pa[0]) * f, py = pa[1] + (pb[1] - pa[1]) * f;
    gps.fillStyle = '#6cd4ff'; gps.beginPath(); gps.arc(px, py, 5, 0, Math.PI * 2); gps.fill(); gps.strokeStyle = '#fff'; gps.lineWidth = 1.5; gps.stroke();
    const j = junctions[S.jIdx];
    let txt = '🏁 Arrived';
    if (j) { const d = Math.max(0, Math.round(j.z + RAMP_OUT - S.z)); txt = (j.viaExit ? '↗ TAKE THE EXIT' : '↑ STAY ON') + ' in ' + (d >= 1000 ? (d / 1000).toFixed(1) + ' km' : d + ' m') + ' → ' + j.nextName + (j.toll ? ' · 💰 toll' : ''); }
    $('haul-gps-txt').textContent = txt;
  }

  // ── The loop ──────────────────────────────────────────────────────────────
  let raf = 0, last = performance.now(), flashT = 0, resolveDone;
  const done = new Promise((res) => { resolveDone = res; });
  let count = 3; const cEl = $('haul-count');
  const countTimer = setInterval(() => { count--; if (count > 0) cEl.textContent = String(count); else { cEl.textContent = 'GO'; setTimeout(() => { cEl.hidden = true; }, 500); S.started = true; clearInterval(countTimer); } }, 800);

  function step(now) {
    raf = requestAnimationFrame(step);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (S.done) return;
    if (S.started && !S.paused) simulate(dt);
    draw();
  }
  function simulate(dt) {
    S.t += dt;
    const K = S.keys, T = S.touch;
    const gas = isTouch ? !T.brake : (K.arrowup || K.w);
    const brake = isTouch ? T.brake : (K.arrowdown || K.s || K[' ']);
    const left = K.arrowleft || K.a || T.left, right = K.arrowright || K.d || T.right;
    const grip = weather.grip;
    if (brake) S.speed = Math.max(0, S.speed - 34 * cls.brake * up.brake * grip * dt);
    else if (gas) S.speed = Math.min(MAX_SPEED, S.speed + (S.speed < 20 ? 16 : 9) * cls.accel * up.accel * dt);
    else S.speed = Math.max(0, S.speed - 5 * dt);
    const steer = (right ? 1 : 0) - (left ? 1 : 0);
    setBlink(rig, steer, steer !== 0 && (Math.floor(S.t * 3) % 2 === 0));
    const lat = steer * (6 + S.speed * 0.22) * grip;
    S.x += lat * dt;
    S.heading += ((steer * 0.28) - S.heading) * Math.min(1, dt * 8);
    S.z += S.speed * dt;
    // Rails. The right rail moves out a lane inside a ramp window.
    S.railCd = Math.max(0, S.railCd - dt);
    const rl = rightLimit();
    if (S.x + PLAYER_HALF_W > rl || -S.x + PLAYER_HALF_W > HALF) {
      S.x = S.x > 0 ? rl - PLAYER_HALF_W : -(HALF - PLAYER_HALF_W);
      if (S.railCd <= 0) { S.cr++; S.railCd = 0.7; damage(RAIL_HIT_DMG * (0.5 + S.speed / MAX_SPEED) * cls.railMul); flash('🛤 RAIL'); }
      // Per-SECOND decay via pow(dt): a per-frame multiplier stopped the rig
      // dead on fast screens and barely slowed it on slow ones.
      S.speed *= Math.pow(0.55, dt);
    }
    // ── Junctions: the exit decision, read RAMP_OUT metres past the city.
    const j = junctions[S.jIdx];
    if (j && S.z >= j.z + RAMP_OUT) {
      const tookExit = S.x > ROAD_W / 2 + 0.3;
      if (tookExit === j.viaExit) { flash(j.last ? '🏁 ' + j.node.name : '✓ ' + (tookExit ? 'EXIT' : 'THRU') + ' → ' + j.nextName); }
      else {
        // Wrong road. The reroute is a real detour: more road on the clock.
        const legLen = (junctions[S.jIdx + 1] ? junctions[S.jIdx + 1].z : total) - j.z;
        const detour = Math.max(150, Math.round(legLen * 0.18));
        S.wrongExits++; S.detourM += detour; S.total += detour;
        for (let k = S.jIdx + 1; k < junctions.length; k++) junctions[k].z += detour;
        for (const h of hazards) if (h.z > S.z) { h.z += detour; h.objs.forEach((o) => { o.z += detour; placeAt(o.mesh, o.z, o.x, o.mesh.position.y); }); }
        gate.position.set(centreX(S.total), 0, -S.total);
        flash('✖ WRONG ' + (tookExit ? 'EXIT' : 'TURN') + ' — REROUTING +' + detour + ' m');
      }
      if (tookExit) { S.x = Math.min(S.x, ROAD_W / 2 - PLAYER_HALF_W - 0.2); }
      S.jIdx++;
    }
    // Toll gates: slow under 40 km/h through the gate or you hit the arm.
    for (const jj of junctions) if (jj.toll && !jj.tollDone && S.z > jj.z - 24 && S.z < jj.z - 16) {
      jj.tollDone = true; S.tollsHit++;
      if (S.speed > 11.2) { S.cr++; damage(RAIL_HIT_DMG * 1.5); S.speed *= 0.5; flash('🚧 TOLL ARM'); } else flash('💰 TOLL PAID · ' + (jj.tollOwner || 'node'));
      if (jj.gate) jj.gate.children[1].rotation.z = 1.2;
    }
    // ── Hazards.
    for (const h of hazards) for (const o of h.objs) {
      if (!o.live || Math.abs(o.z - S.z) > 12) continue;
      if (Math.abs(o.z - S.z) < o.hl + PLAYER_HALF_L && Math.abs(o.x - S.x) < o.hw + PLAYER_HALF_W) {
        o.live = false; if (o.car) { S.cc++; damage(o.dmg * (0.5 + S.speed / MAX_SPEED)); S.speed *= 0.45; flash('🚗 CRASH'); }
        else { S.hz++; damage(o.dmg * cls.railMul * (0.5 + S.speed / MAX_SPEED)); S.speed *= 0.82; flash('⚠ ' + (h.kind === 'cones' ? 'CONE' : 'DEBRIS')); if (!o.car) { o.mesh.position.y = -2; } }
      }
    }
    // ── Traffic AI. Every vehicle keeps a headway to whatever is ahead in
    //    its lane — another vehicle OR the rig — so nothing drives through
    //    anything. Blocked (or restless) vehicles signal, wait, re-check the
    //    target lane both ways, then drift across.
    const aheadOf = (v, lane) => {
      let best = null, bestD = Infinity;
      for (const o of traffic) { if (o === v || o.lane !== lane && o.toLane !== lane) continue; const d = o.z - v.z; if (d > 0 && d < bestD) { bestD = d; best = { z: o.z, speed: o.speed, halfL: o.halfL }; } }
      if (Math.abs(S.x - laneX(lane)) < LANE_W * 0.75) { const d = S.z - v.z; if (d > 0 && d < bestD) { bestD = d; best = { z: S.z, speed: S.speed, halfL: PLAYER_HALF_L, rig: true }; } }
      return best;
    };
    // Hazards are the DRIVER's problem. Traffic only slows and tries to get
    // out of the lane; it never stops for one — a wall of stopped cars behind
    // one debris pile gridlocked the whole road in a driven test.
    const hazardAhead = (v) => { for (const h of hazards) for (const o of h.objs) { if (!o.live || Math.abs(o.x - laneX(v.lane)) > LANE_W * 0.8) continue; const d = o.z - v.z; if (d > 0 && d < 70) return true; } return false; };
    const laneClear = (v, lane, relaxed) => {
      const margin = relaxed ? 2 : 22;   // a stalled car only needs to not overlap
      for (const o of traffic) { if (o === v) continue; if ((o.lane === lane || o.toLane === lane) && Math.abs(o.z - v.z) < margin + v.halfL + o.halfL) return false; }
      if (Math.abs(S.x - laneX(lane)) < LANE_W * 0.75 && Math.abs(S.z - v.z) < 26 + v.halfL + PLAYER_HALF_L) return false;
      return true;
    };
    const density = 1 / (30 - Math.min(10, (S.z / total) * 10));
    const want = Math.floor(320 * density);
    for (let i = traffic.length - 1; i >= 0; i--) {
      const v = traffic[i];
      v.hitCd = Math.max(0, v.hitCd - dt);
      const lead = aheadOf(v, v.lane);
      const hz = hazardAhead(v);
      let wantS = hz ? v.cruise * 0.6 : v.cruise;
      if (lead) {
        const gap = lead.z - v.z - lead.halfL - v.halfL;
        const safe = 4 + v.speed * 0.9;
        if (gap < safe) wantS = Math.min(wantS, Math.max(0, lead.speed - (safe - gap) * 0.6));
        if (gap < 0.3 && !lead.rig) v.z = lead.z - lead.halfL - v.halfL - 0.3;
      }
      v.speed += Math.max(-9 * dt, Math.min(4 * dt, wantS - v.speed));
      v.z += v.speed * dt;
      v.decideCd -= dt;
      if (v.phase === 'cruise') {
        v.x += (laneX(v.lane) - v.x) * Math.min(1, dt * 1.5);
        const blocked = hz || (lead && lead.speed < v.cruise - 3 && (lead.z - v.z) < 40);
        const stalled = v.speed < 2 && lead && !lead.rig;
        if ((v.decideCd <= 0 && (blocked || Math.random() < dt * 0.04)) || stalled) {
          const dirs = [v.lane - 1, v.lane + 1].filter((l) => l >= 0 && l < LANES && laneClear(v, l, stalled));
          if (dirs.length) { v.toLane = dirs[Math.floor(Math.random() * dirs.length)]; v.sigDir = Math.sign(v.toLane - v.lane); v.phase = 'signal'; v.sigT = 0; }
          v.decideCd = 2 + Math.random() * 4;
        }
      } else if (v.phase === 'signal') {
        v.sigT += dt;
        if (!laneClear(v, v.toLane)) { v.phase = 'cruise'; v.toLane = v.lane; }
        else if (v.sigT > 1.2) { v.phase = 'move'; v.lane = v.toLane; }
      } else if (v.phase === 'move') {
        const tx = laneX(v.lane); v.x += (tx - v.x) * Math.min(1, dt * 2.2);
        if (Math.abs(tx - v.x) < 0.08) { v.x = tx; v.phase = 'cruise'; }
      }
      setBlink(v.mesh.children[0], v.sigDir || 0, v.phase !== 'cruise' && (Math.floor(S.t * 3) % 2 === 0));
      if (v.z < S.z - 70 || v.z > S.z + 420) { scene.remove(v.mesh); traffic.splice(i, 1); continue; }
      collideVehicle(v, dt);
    }
    while (traffic.length < want) spawnTraffic(S.z + 140 + Math.random() * 260);
    // ── Raiders: one event at a time, from behind, fast, aimed at the rig.
    const nextRaid = plan.raiders[S.raiderIdx];
    if (!S.raider && nextRaid && S.z > nextRaid.z) {
      S.raiderIdx++;
      const mesh = makeCar(false, 0, M.raider); scene.add(mesh);
      S.raider = { mesh, x: S.x, z: S.z - 90, speed: S.speed + 8, halfL: 2.2, halfW: 1.0, hitCd: 0, t: 0, hits: 0, lane: 0, toLane: 0, sigDir: 0, phase: 'raid' };
      flash('🚨 RAIDERS BEHIND'); setBlink(mesh.children[0], 2, true);
    }
    if (S.raider) {
      const R = S.raider; R.t += dt; R.hitCd = Math.max(0, R.hitCd - dt);
      // A shot raider coasts and spins; only a live one pursues. (The pursuit
      // update used to run first and re-accelerated the wreck for the rest of
      // the run, which also blocked every later raider event.)
      if (!R.dead) { R.speed += Math.max(-20 * dt, Math.min(14 * dt, (Math.min(72, S.speed + 12)) - R.speed)); R.z += R.speed * dt; R.x += (S.x - R.x) * Math.min(1, dt * 1.6); }
      setBlink(R.mesh.children[0], 2, Math.floor(S.t * 6) % 2 === 0);
      const dist = S.z - R.z;
      // The guard: one engagement per run, fired when the raider closes in.
      if (opts.guard && !S.guardUsed && dist < 28 && dist > -6) {
        S.guardUsed = true; S.tracerT = 1.2; S.raidersBeaten++;
        R.dead = true; R.speed = 0; flash('🛡 GUARD OPENED FIRE'); const el = $('haul-guard'); if (el) el.textContent = '🛡 GUARD SPENT';
      }
      if (R.dead) { R.z -= 4 * dt; R.mesh.rotation.z += 3 * dt; if (S.z - R.z > 90) { scene.remove(R.mesh); S.raider = null; } }
      else {
        if (Math.abs(dist) < R.halfL + PLAYER_HALF_L && Math.abs(R.x - S.x) < R.halfW + PLAYER_HALF_W && R.hitCd <= 0) {
          R.hitCd = 1.4; R.hits++; S.raiderHits++; damage(RAIDER_DMG * cls.carMul); S.x += (S.x >= 0 ? 1 : -1) * 1.4; S.speed *= 0.9; flash('💥 RAMMED');
          R.z = S.z - R.halfL - PLAYER_HALF_L - 1;
        }
        if (R.t > 14 || R.hits >= 2 || R.z < S.z - 160) { if (R.hits < 2) S.raidersBeaten++; scene.remove(R.mesh); S.raider = null; flash(R.hits >= 2 ? '🚨 RAIDERS GOT WHAT THEY CAME FOR' : '✓ RAIDERS FELL BACK'); }
      }
    }
    if (S.tracerT > 0) S.tracerT -= dt;
    for (const seg of segs) if (seg.z0 + SEG_LEN < S.z - 60) placeSegment(seg, seg.z0 + SEGS * SEG_LEN);
    if (S.z >= S.total) finish();
  }
  function collideVehicle(v, dt) {
    const dz = v.z - S.z, dx = v.x - S.x;
    if (Math.abs(dz) < v.halfL + PLAYER_HALF_L && Math.abs(dx) < v.halfW + PLAYER_HALF_W) {
      const rel = Math.abs(S.speed - v.speed);
      const closing = S.speed - v.speed;
      const rearEnd = Math.abs(dz) > Math.abs(dx) * 2.2 && dz > 0;
      /* A CRASH needs ~30 km/h of CLOSING speed. Sitting on somebody's bumper
         at their speed is tailgating, not an impact — a driven test showed
         "any contact counts" re-crashing every cooldown behind one slow truck
         until the cargo was gone. After a real hit the rig is dropped to 80%
         of their speed and re-closes at ~5 m/s, and a lower bar counted that
         re-contact as a second crash. Side swipes always count: you moved
         into them. */
      if (v.hitCd <= 0 && (!rearEnd || closing > 8)) {
        v.hitCd = 0.9; S.cc++;
        let d = CAR_HIT_DMG * (0.4 + rel / 30) * cls.carMul;
        if (cls.fire && closing > 25) { d += 25; flash('🔥 CARGO FIRE'); } else flash('🚗 CRASH');
        damage(d);
      }
      if (rearEnd) { S.speed = Math.min(S.speed, closing > 8 ? v.speed * 0.8 : v.speed); S.z = v.z - (v.halfL + PLAYER_HALF_L) - 0.05; }
      else { const push = Math.sign(dx || 1); S.x -= push * 1.6 * dt * 20; v.x += push * 0.8; S.speed *= 0.93; }
    }
  }
  function damage(pct) { S.cargo = Math.max(0, S.cargo - pct * up.bed); if (S.cargo <= 0) { flash('💥 CARGO LOST'); setTimeout(finish, 600); } }
  function flash(txt) { const f = $('haul-flash'); f.textContent = txt; f.classList.add('on'); flashT = 0.7; }
  function draw() {
    const cx = centreX(S.z);
    const yaw = -Math.atan2((centreX(S.z + 1) - centreX(S.z - 1)) / 2, 1);
    rigOuter.position.set(cx + S.x, 0, -S.z); rigOuter.rotation.y = yaw - S.heading * 0.6;
    rig.children.forEach((c) => { if (c.userData.cargo) { const k = 0.5 + 0.5 * (S.cargo / 100); c.scale.set(k, k, k); c.rotation.z = (1 - k) * 0.6; } });
    for (const v of traffic) { v.mesh.position.set(centreX(v.z) + v.x, 0, -v.z); v.mesh.rotation.y = -Math.atan2((centreX(v.z + 1) - centreX(v.z - 1)) / 2, 1); }
    if (S.raider) { const R = S.raider; R.mesh.position.set(centreX(R.z) + R.x, R.dead ? 0.3 : 0, -R.z); if (!R.dead) R.mesh.rotation.y = -Math.atan2((centreX(R.z + 1) - centreX(R.z - 1)) / 2, 1); }
    tracer.visible = S.tracerT > 0 && Math.floor(S.tracerT * 12) % 2 === 0;
    if (tracer.visible && S.raider) { tracer.position.set(cx + S.x + 0.6, 3.4, -(S.z - 12)); }
    for (const h of hazards) for (const o of h.objs) if (o.blink) setBlink(o.mesh.children[0], 2, Math.floor(S.t * 2) % 2 === 0);
    const camBack = 13 + S.speed * 0.08;
    cam.position.set(centreX(S.z - camBack) + S.x * 0.6, 6.2 + S.speed * 0.02, -(S.z - camBack));
    cam.lookAt(cx + S.x * 0.8, 1.6, -(S.z + 18));
    cam.fov = 62 + (S.speed / MAX_SPEED) * 12; cam.updateProjectionMatrix();
    if (rain) { rain.position.set(cam.position.x, 0, cam.position.z - 30); rain.position.y = -((S.t * 18) % 4); }
    $('haul-speed').textContent = String(Math.round(S.speed * 3.6));
    $('haul-cargo').textContent = Math.round(S.cargo) + '%';
    $('haul-cargo').style.color = S.cargo > 70 ? '#9ad17a' : S.cargo > 35 ? '#ffd166' : '#ff8aa0';
    $('haul-time').textContent = fmtT(S.t); $('haul-time').style.color = S.t > par ? '#ff8aa0' : '';
    $('haul-cc').textContent = String(S.cc); $('haul-cr').textContent = String(S.cr); $('haul-hz').textContent = String(S.hz);
    const p = Math.min(1, S.z / S.total);
    $('haul-prog-bar').style.width = (p * 100).toFixed(1) + '%';
    $('haul-prog-txt').textContent = ((S.total - S.z) / (total / km)).toFixed(1) + ' km to go' + (S.detourM ? ' · +' + S.detourM + ' m detour' : '');
    if (flashT > 0) { flashT -= 1 / 60; if (flashT <= 0) $('haul-flash').classList.remove('on'); }
    drawGps();
    renderer.render(scene, cam);
  }
  function finish() {
    if (S.done) return; S.done = true;
    const completed = !S.abandoned && S.z >= S.total && S.cargo > 0;
    destroy();
    resolveDone({
      completed, abandoned: S.abandoned, timeS: Math.round(S.t), parS: par, km,
      crashesCar: S.cc, crashesRail: S.cr + S.hz, hazards: S.hz, cargoPct: completed ? Math.round(S.cargo) / 100 : 0,
      wrongExits: S.wrongExits, detourM: S.detourM, tolls: S.tollsHit, raiders: S.raiderIdx, raidersBeaten: S.raidersBeaten, raiderHits: S.raiderHits,
      guardUsed: S.guardUsed, weather: weather.id, cargoClass: cls.id, distanceM: Math.round(S.z), totalM: S.total,
    });
  }
  function destroy() {
    cancelAnimationFrame(raf); clearInterval(countTimer);
    window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); window.removeEventListener('resize', onResize);
    try { scene.traverse((o) => { if (o.geometry && !Object.values(G).includes(o.geometry)) o.geometry.dispose(); if (o.material && o.material.map) o.material.map.dispose(); }); } catch (e) {}
    try { Object.values(G).forEach((g) => g.dispose()); } catch (e) {}
    try { renderer.dispose(); } catch (e) {}
    root.remove();
  }
  raf = requestAnimationFrame(step);
  return done;
}

function fmtT(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export const GAME_CSS = `
#haul-run{position:fixed;inset:0;z-index:100050;background:#0b0c10;font-family:inherit;color:#f0e6d0;user-select:none}
#haul-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.haul-hud{position:absolute;inset:0;pointer-events:none;display:flex;flex-direction:column;justify-content:space-between;gap:8px;padding:max(10px,env(safe-area-inset-top)) 12px max(10px,env(safe-area-inset-bottom))}
.haul-hud-top{flex-direction:column;align-items:flex-start;gap:6px}
.haul-hud-top .haul-pill{max-width:min(60vw,520px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.haul-hud-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.haul-hud-bottom{justify-content:space-between}
.haul-pill{background:rgba(8,10,16,.72);border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:6px 11px;font-size:.86rem;font-weight:700;letter-spacing:.02em;backdrop-filter:blur(4px)}
.haul-k{color:#ffb060;font-size:.68rem;letter-spacing:.12em;margin-right:6px}
.haul-dim{color:#a89880;font-weight:500}
.haul-speed{font-size:1.5rem;min-width:7rem;text-align:center}
.haul-progress{position:relative;height:8px;background:rgba(255,255,255,.1);border-radius:6px;overflow:visible;margin-top:4px;flex:none}
.haul-hud-spacer{flex:1}
#haul-prog-bar{height:100%;background:linear-gradient(90deg,#ffb060,#ffd166);border-radius:6px;width:0}
#haul-prog-txt{position:absolute;top:10px;left:0;font-size:.74rem;color:#d8c8a8;white-space:nowrap}
.haul-gps{position:absolute;right:12px;bottom:64px;width:240px;border:1px solid rgba(255,255,255,.18);border-radius:10px;overflow:hidden;background:rgba(8,10,16,.85)}
.haul-gps canvas{display:block;width:240px;height:170px}
.haul-gps-txt{padding:6px 8px;font-size:.8rem;font-weight:800;color:#ffd166;border-top:1px solid rgba(255,255,255,.12);background:rgba(20,22,30,.9)}
.haul-touch{display:none;position:absolute;left:0;right:0;bottom:64px;justify-content:space-between;padding:0 14px;pointer-events:none}
.haul-is-touch .haul-touch{display:flex}
.haul-tbtn{pointer-events:auto;width:88px;height:88px;border-radius:50%;border:2px solid rgba(255,255,255,.25);background:rgba(20,22,30,.7);color:#fff;font-size:1.6rem;font-weight:800;touch-action:none}
.haul-tbtn[data-t=brake]{width:120px;border-radius:20px;font-size:1rem;background:rgba(120,30,30,.7)}
.haul-flash{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);font-size:2rem;font-weight:900;color:#ff6a4a;text-shadow:0 0 18px #000;opacity:0;transition:opacity .15s;text-align:center;max-width:90vw}
.haul-flash.on{opacity:1}
.haul-countdown{position:absolute;left:50%;top:45%;transform:translate(-50%,-50%);font-size:6rem;font-weight:900;color:#ffd166;text-shadow:0 0 30px #000}
.haul-pause{position:absolute;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;pointer-events:auto}
.haul-pause[hidden]{display:none}
.haul-pause-card{background:#1a1c24;border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:22px;max-width:360px;text-align:center}
.haul-pause-card h3{margin:0 0 8px}
.haul-pause-card p{color:#a89880;font-size:.9rem}
.haul-btn{display:inline-block;margin:6px 4px 0;padding:10px 16px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:#2a2d38;color:#fff;font-weight:700;cursor:pointer}
.haul-btn-danger{background:#6a2020}
.haul-is-touch .haul-gps{bottom:auto;top:120px}
@media (max-width:700px){.haul-gps{width:170px}.haul-gps canvas{width:170px;height:120px}}
`;
