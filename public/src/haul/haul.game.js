/* ═══════════════════════════════════════════════════════════════════════════
   haul.game.js — THE HIGHWAY RUN. A Crazy-Taxi-style 3D drive, built on the
   three@0.171 import map index.html already declares (WebGPU, with the WebGL
   backend as fallback on browsers without navigator.gpu).

   WHAT IT IS
     One straight-ish highway, four lanes one way, guardrails both sides, a
     road that bends, traffic (cars and trucks) that does not care about you,
     and a distance to cover that comes from the city node map (haul.map.js).
     You drive a rig with the shipper's cargo on the back. Hit a car or a
     rail and the cargo takes damage; arrive with 100% and you are paid in
     full, arrive with 60% and the shipper only pays for what arrived — and
     the crashes come out of YOUR cut (haul.economy.js).

   WHAT IT IS NOT
     A money path. play() resolves a plain outcome object; the caller decides
     what it is worth (sql/038 does, server-side). Nothing here touches the
     bridge, the wallet or Supabase. That is what lets a test page drive it.

   ⚠ Everything created here is torn down in destroy(): renderer, listeners,
     DOM, the RAF loop. The game is a screen you enter and leave; a leaked
     renderer is a leaked GPU context and the second run would fail to init.
   ═══════════════════════════════════════════════════════════════════════════ */

import { roadLength, parSeconds, CRUISE_MPS } from './haul.map.js';

// The lanes. 4 × 3.6 m + a 1.4 m shoulder each side; the rail sits at ±HALF.
const LANE_W = 3.6, LANES = 4, ROAD_W = LANE_W * LANES, HALF = ROAD_W / 2 + 1.4;
const SEG_LEN = 40, SEGS = 14;                 // recycled road chunks
const PLAYER_HALF_W = 1.15, PLAYER_HALF_L = 4.2;
const MAX_SPEED = 62;                          // m/s (≈ 220 km/h) flat out
const CAR_HIT_DMG = 9, RAIL_HIT_DMG = 4;       // % cargo per contact, before speed scaling

/* The road bends. x-offset of the centre line at distance z, smooth enough
   that a rig at cruising speed can hold it and sharp enough that flat out
   through the S-bends puts you in the rail. Two sines so it never repeats
   within a run. */
function centreX(z) { return 6 * Math.sin(z / 260) + 3.5 * Math.sin(z / 97 + 1.3); }

function laneX(i) { return -ROAD_W / 2 + LANE_W * (i + 0.5); }

export async function play(opts) {
  opts = opts || {};
  const km = Math.max(1, Number(opts.km) || 10);
  const total = roadLength(km);
  const par = parSeconds(km);
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
        <div class="haul-pill"><span class="haul-k">ROUTE</span> ${esc(opts.fromName || 'A')} → ${esc(opts.toName || 'B')} · ${km.toFixed(1)} km</div>
        <div class="haul-pill"><span class="haul-k">CARGO</span> <span id="haul-cargo">100%</span> · ${esc(opts.cargoLabel || 'freight')}</div>
        <div class="haul-pill"><span class="haul-k">TIME</span> <span id="haul-time">0:00</span> <span class="haul-dim">/ par ${fmtT(par)}</span></div>
      </div>
      <div class="haul-progress"><div id="haul-prog-bar"></div><div id="haul-prog-txt"></div></div>
      <div class="haul-hud-row haul-hud-bottom">
        <div class="haul-pill haul-speed"><span id="haul-speed">0</span><span class="haul-dim"> km/h</span></div>
        <div class="haul-pill">🚗 <span id="haul-cc">0</span> &nbsp; 🛤 <span id="haul-cr">0</span></div>
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

  // ── Renderer ──────────────────────────────────────────────────────────────
  const hasGPU = !!(typeof navigator !== 'undefined' && navigator.gpu);
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: !hasGPU });
  try { await renderer.init(); }
  catch (e) { root.remove(); throw new Error('The 3D renderer could not start on this device. ' + ((e && e.message) || '')); }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new THREE.Scene();
  // Dusk by default — the whole game is a ruined world. The sky tint is keyed
  // to the route so two hauls do not look identical.
  const hue = ((km * 37) % 360) / 360;
  const sky = new THREE.Color().setHSL(0.62 + hue * 0.08, 0.38, 0.30);
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, 140, 560);
  const cam = new THREE.PerspectiveCamera(62, 1, 0.5, 900);
  // r155+ lights are physically scaled, so these read high: the first cut at
  // 0.9 / 1.4 rendered the skyline as black slabs in a driven screenshot.
  scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x5a4636, 2.2));
  const sun = new THREE.DirectionalLight(0xffd9a8, 2.6); sun.position.set(-60, 120, -80); scene.add(sun);

  // ── Materials (shared; one draw state per look) ──────────────────────────
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
  };
  const G = {
    road: new THREE.PlaneGeometry(ROAD_W, SEG_LEN),
    shoulder: new THREE.PlaneGeometry(1.4, SEG_LEN),
    ground: new THREE.PlaneGeometry(260, SEG_LEN),
    stripe: new THREE.PlaneGeometry(0.16, 3),
    edge: new THREE.PlaneGeometry(0.2, SEG_LEN),
    rail: new THREE.BoxGeometry(0.16, 0.36, SEG_LEN),
    post: new THREE.BoxGeometry(0.14, 0.9, 0.14),
    wheel: new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10),
  };

  // ── Road chunks, recycled as the rig advances ─────────────────────────────
  const segs = [];
  for (let i = 0; i < SEGS; i++) segs.push(makeSegment(i * SEG_LEN));
  function makeSegment(z0) {
    const g = new THREE.Group();
    const road = new THREE.Mesh(G.road, M.road); road.rotation.x = -Math.PI / 2; g.add(road);
    const gr = new THREE.Mesh(G.ground, M.ground); gr.rotation.x = -Math.PI / 2; gr.position.y = -0.05; g.add(gr);
    for (const s of [-1, 1]) {
      const sh = new THREE.Mesh(G.shoulder, M.shoulder); sh.rotation.x = -Math.PI / 2; sh.position.set(s * (ROAD_W / 2 + 0.7), 0.005, 0); g.add(sh);
      const ed = new THREE.Mesh(G.edge, M.edge); ed.rotation.x = -Math.PI / 2; ed.position.set(s * (ROAD_W / 2 - 0.1), 0.01, 0); g.add(ed);
      const r = new THREE.Mesh(G.rail, M.rail); r.position.set(s * HALF, 0.75, 0); g.add(r);
      for (let k = -SEG_LEN / 2 + 2; k < SEG_LEN / 2; k += 4) { const p = new THREE.Mesh(G.post, M.post); p.position.set(s * HALF, 0.45, k); g.add(p); }
    }
    for (let l = 1; l < LANES; l++) for (let k = -SEG_LEN / 2 + 1.5; k < SEG_LEN / 2; k += 6) {
      const st = new THREE.Mesh(G.stripe, M.stripe); st.rotation.x = -Math.PI / 2; st.position.set(-ROAD_W / 2 + l * LANE_W, 0.01, k); g.add(st);
    }
    // Roadside: ruined blocks and pylons, seeded per segment index so a
    // recycled chunk gets a fresh skyline rather than the same four boxes.
    g.userData.props = new THREE.Group(); g.add(g.userData.props);
    scene.add(g);
    const seg = { g, z0 };
    placeSegment(seg, z0);
    return seg;
  }
  function placeSegment(seg, z0) {
    seg.z0 = z0;
    seg.g.position.set(centreX(z0 + SEG_LEN / 2), 0, -(z0 + SEG_LEN / 2));
    // The road follows the curve with a small yaw per chunk; chunks are short
    // enough that the gaps at the joins are hidden under the fog and the rig.
    // Travel is toward −Z, so a bend toward +x is a NEGATIVE yaw about Y
    // (rotation.y = θ sends the −Z nose to (−sin θ, 0, −cos θ)). Same sign
    // rule for every vehicle below.
    const dx = centreX(z0 + SEG_LEN) - centreX(z0);
    seg.g.rotation.y = -Math.atan2(dx, SEG_LEN);
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
      if (rnd() < 0.5) { const wnd = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.6), M.win); wnd.position.set(b.position.x - side * (w / 2 + 0.02), 2 + rnd() * (h - 3), b.position.z); wnd.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2; P.add(wnd); }
    }
    if (rnd() < 0.35) { const py = new THREE.Mesh(new THREE.BoxGeometry(0.6, 28, 0.6), M.post); const side = rnd() < 0.5 ? -1 : 1; py.position.set(side * (HALF + 5), 14, 0); P.add(py); }
  }

  // ── Vehicles ──────────────────────────────────────────────────────────────
  /* Vehicles travel toward −Z (the world scrolls that way), so every model
     is built nose-at-+Z for readability and then turned 180° here — the first
     screenshot had the whole highway driving backwards, cabs facing the camera. */
  function makeCar(truck, color) {
    const outer = new THREE.Group(); const g = new THREE.Group(); g.rotation.y = Math.PI; outer.add(g);
    const body = new THREE.MeshLambertMaterial({ color });
    if (truck) {
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 2.6), body); cab.position.set(0, 1.5, 3.2); g.add(cab);
      const box = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.8, 8.5), new THREE.MeshLambertMaterial({ color: 0xc8c8c8 })); box.position.set(0, 1.7, -2.4); g.add(box);
      const gl = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 0.1), M.glass); gl.position.set(0, 2.1, 4.52); g.add(gl);
      for (const [x, z] of [[-1.1, 3.2], [1.1, 3.2], [-1.1, -1], [1.1, -1], [-1.1, -5], [1.1, -5]]) { const w = new THREE.Mesh(G.wheel, M.wheel); w.rotation.z = Math.PI / 2; w.position.set(x, 0.42, z); g.add(w); }
      outer.userData.halfL = 6.6; outer.userData.halfW = 1.3;
    } else {
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.8, 4.3), body); b.position.y = 0.7; g.add(b);
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 2.2), body); top.position.set(0, 1.4, -0.2); g.add(top);
      const gl = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.1), M.glass); gl.position.set(0, 1.4, 0.95); g.add(gl);
      for (const [x, z] of [[-0.9, 1.4], [0.9, 1.4], [-0.9, -1.4], [0.9, -1.4]]) { const w = new THREE.Mesh(G.wheel, M.wheel); w.rotation.z = Math.PI / 2; w.position.set(x, 0.42, z); g.add(w); }
      outer.userData.halfL = 2.2; outer.userData.halfW = 1.0;
    }
    return outer;
  }
  // The rig: cab + flatbed carrying the cargo, coloured by the resource.
  const rigOuter = new THREE.Group(); const rig = new THREE.Group(); rig.rotation.y = Math.PI; rigOuter.add(rig);
  { const cab = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.3, 2.4), M.player); cab.position.set(0, 1.45, 2.9); rig.add(cab);
    const gl = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.8, 0.1), M.glass); gl.position.set(0, 2.0, 4.12); rig.add(gl);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 6), new THREE.MeshLambertMaterial({ color: 0x333 })); bed.position.set(0, 0.85, -1.4); rig.add(bed);
    for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.4, 1.6), M.cargo); c.position.set(0, 1.8, 0.4 - i * 1.9); c.userData.cargo = true; rig.add(c); }
    for (const [x, z] of [[-1.05, 2.9], [1.05, 2.9], [-1.05, -0.8], [1.05, -0.8], [-1.05, -3.4], [1.05, -3.4]]) { const w = new THREE.Mesh(G.wheel, M.wheel); w.rotation.z = Math.PI / 2; w.position.set(x, 0.42, z); rig.add(w); }
    scene.add(rigOuter); }
  // Finish gate at the destination.
  const gate = new THREE.Group();
  { const m = new THREE.MeshLambertMaterial({ color: 0xffd166 });
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(1, 9, 1), m); p.position.set(s * (HALF + 0.5), 4.5, 0); gate.add(p); }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 + 2, 1.2, 1), m); bar.position.set(0, 9, 0); gate.add(bar);
    gate.position.set(centreX(total), 0, -total); scene.add(gate); }

  const traffic = [];
  const TRAFFIC_COLORS = [0x7a8aa0, 0xa04040, 0x4060a0, 0x9a9a70, 0x507050, 0xc0c0c0, 0x604080];
  function spawnTraffic(zAhead) {
    const truck = Math.random() < 0.3;
    const lane = Math.floor(Math.random() * LANES);
    const mesh = makeCar(truck, TRAFFIC_COLORS[Math.floor(Math.random() * TRAFFIC_COLORS.length)]);
    const v = { mesh, lane, x: laneX(lane), z: zAhead, speed: (truck ? 17 : 22) + Math.random() * (truck ? 5 : 11), truck, halfL: mesh.userData.halfL, halfW: mesh.userData.halfW, hitCd: 0 };
    // Never spawn on top of another vehicle.
    if (traffic.some((t) => t.lane === lane && Math.abs(t.z - v.z) < 24)) { return; }
    scene.add(mesh); traffic.push(v);
  }

  // ── State ─────────────────────────────────────────────────────────────────
  const S = {
    z: 0, x: 0, speed: 0, heading: 0, t: 0, cargo: 100, cc: 0, cr: 0,
    railCd: 0, done: false, paused: false, abandoned: false, started: false,
    keys: {}, touch: { left: false, right: false, brake: false },
  };
  // 🧪 Read-only peek for driven tests (window.__haulRun.t vs wall time tells
  //    you the sim is running at speed). Nothing reads it in the game.
  try { window.__haulRun = S; } catch (e) {}
  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  if (isTouch) { root.classList.add('haul-is-touch'); $('haul-hint').textContent = 'Auto throttle · tap ◀ ▶ to steer · hold BRAKE'; }

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

  // ── The loop ──────────────────────────────────────────────────────────────
  let raf = 0, last = performance.now(), flashT = 0, resolveDone;
  const done = new Promise((res) => { resolveDone = res; });

  // 3-2-1 countdown, then go. The countdown is not on the clock.
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
    // Longitudinal: gas ramps to MAX, brake bites hard, otherwise drag.
    if (brake) S.speed = Math.max(0, S.speed - 34 * dt);
    else if (gas) S.speed = Math.min(MAX_SPEED, S.speed + (S.speed < 20 ? 16 : 9) * dt);
    else S.speed = Math.max(0, S.speed - 5 * dt);
    // Lateral: steering authority grows with speed, so parking-lot wiggles do
    // nothing and a flat-out flick is a lane and a half.
    const steer = (right ? 1 : 0) - (left ? 1 : 0);
    const lat = steer * (6 + S.speed * 0.22);
    S.x += lat * dt;
    S.heading += ((steer * 0.28) - S.heading) * Math.min(1, dt * 8);
    S.z += S.speed * dt;
    // Rails. Contact costs speed and cargo, once per touch.
    S.railCd = Math.max(0, S.railCd - dt);
    if (Math.abs(S.x) + PLAYER_HALF_W > HALF) {
      S.x = Math.sign(S.x) * (HALF - PLAYER_HALF_W);
      if (S.railCd <= 0) { S.cr++; S.railCd = 0.7; damage(RAIL_HIT_DMG * (0.5 + S.speed / MAX_SPEED)); flash('🛤 RAIL'); }
      // Grinding the rail bleeds ~45% of speed per second. Per-SECOND, via
      // pow(dt): a per-frame multiplier here made the rig stop dead on fast
      // screens and barely slow on slow ones (caught by a driven test).
      S.speed *= Math.pow(0.55, dt);
    }
    // Traffic: keep ~1 vehicle per 28 m of road ahead, denser as the run goes on.
    const density = 1 / (30 - Math.min(10, (S.z / total) * 10));
    const want = Math.floor(320 * density);
    for (let i = traffic.length - 1; i >= 0; i--) {
      const v = traffic[i];
      v.z += v.speed * dt; v.hitCd = Math.max(0, v.hitCd - dt);
      // Traffic drifts back to its lane centre after being shoved.
      v.x += (laneX(v.lane) - v.x) * Math.min(1, dt * 1.5);
      if (v.z < S.z - 70 || v.z > S.z + 420) { scene.remove(v.mesh); traffic.splice(i, 1); continue; }
      // Collision, in road space (x relative to the centre line).
      const dz = v.z - S.z, dx = v.x - S.x;
      if (Math.abs(dz) < v.halfL + PLAYER_HALF_L && Math.abs(dx) < v.halfW + PLAYER_HALF_W) {
        const rel = Math.abs(S.speed - v.speed);
        const closing = S.speed - v.speed;             // >0: we are running into them
        const rearEnd = Math.abs(dz) > Math.abs(dx) * 2.2 && dz > 0;
        /* A CRASH needs closing speed. Sitting on somebody's bumper at their
           speed is tailgating, not an impact — a driven test showed the old
           "any contact counts" rule re-crashing every cooldown behind one slow
           truck until the cargo was gone with the rig never touched. The
           threshold is ~30 km/h of CLOSING speed: after a real hit the rig is
           dropped to 80% of their speed and re-closes at ~5 m/s, and a lower
           bar counted that re-contact as a second crash every cooldown (17
           "hits" behind one car in a driven test). Side swipes always count:
           you moved into them. */
        if (v.hitCd <= 0 && (!rearEnd || closing > 8)) { v.hitCd = 0.9; S.cc++; damage(CAR_HIT_DMG * (0.4 + rel / 30)); flash('🚗 CRASH'); }
        // Resolve: rear-end → match their speed and sit behind; side → shove.
        if (rearEnd) { S.speed = Math.min(S.speed, closing > 8 ? v.speed * 0.8 : v.speed); S.z = v.z - (v.halfL + PLAYER_HALF_L) - 0.05; }
        else { const push = Math.sign(dx || 1); S.x -= push * 1.6 * dt * 20; v.x += push * 0.8; S.speed *= 0.93; }
      }
    }
    while (traffic.length < want) spawnTraffic(S.z + 140 + Math.random() * 260);
    // Recycle chunks that fell behind.
    for (const seg of segs) if (seg.z0 + SEG_LEN < S.z - 60) placeSegment(seg, seg.z0 + SEGS * SEG_LEN);
    if (S.z >= total) finish();
  }
  function damage(pct) { S.cargo = Math.max(0, S.cargo - pct); if (S.cargo <= 0) { flash('💥 CARGO LOST'); setTimeout(finish, 600); } }
  function flash(txt) { const f = $('haul-flash'); f.textContent = txt; f.classList.add('on'); flashT = 0.5; }
  function draw() {
    const cx = centreX(S.z);
    const dxdz = (centreX(S.z + 1) - centreX(S.z - 1)) / 2;
    const yaw = -Math.atan2(dxdz, 1);
    rigOuter.position.set(cx + S.x, 0, -S.z); rigOuter.rotation.y = yaw - S.heading * 0.6;
    // Cargo visibly breaks: crates shrink and tilt as integrity falls.
    rig.children.forEach((c) => { if (c.userData.cargo) { const k = 0.5 + 0.5 * (S.cargo / 100); c.scale.set(k, k, k); c.rotation.z = (1 - k) * 0.6; } });
    for (const v of traffic) { v.mesh.position.set(centreX(v.z) + v.x, 0, -v.z); v.mesh.rotation.y = -Math.atan2((centreX(v.z + 1) - centreX(v.z - 1)) / 2, 1); }
    const camBack = 13 + S.speed * 0.08;
    cam.position.set(centreX(S.z - camBack) + S.x * 0.6, 6.2 + S.speed * 0.02, -(S.z - camBack));
    cam.lookAt(cx + S.x * 0.8, 1.6, -(S.z + 18));
    cam.fov = 62 + (S.speed / MAX_SPEED) * 12; cam.updateProjectionMatrix();
    // HUD
    $('haul-speed').textContent = String(Math.round(S.speed * 3.6));
    $('haul-cargo').textContent = Math.round(S.cargo) + '%';
    $('haul-cargo').style.color = S.cargo > 70 ? '#9ad17a' : S.cargo > 35 ? '#ffd166' : '#ff8aa0';
    $('haul-time').textContent = fmtT(S.t); $('haul-time').style.color = S.t > par ? '#ff8aa0' : '';
    $('haul-cc').textContent = String(S.cc); $('haul-cr').textContent = String(S.cr);
    const p = Math.min(1, S.z / total);
    $('haul-prog-bar').style.width = (p * 100).toFixed(1) + '%';
    $('haul-prog-txt').textContent = ((1 - p) * km).toFixed(1) + ' km to ' + (opts.toName || 'destination');
    if (flashT > 0) { flashT -= 1 / 60; if (flashT <= 0) $('haul-flash').classList.remove('on'); }
    renderer.render(scene, cam);
  }
  function finish() {
    if (S.done) return; S.done = true;
    const completed = !S.abandoned && S.z >= total && S.cargo > 0;
    destroy();
    resolveDone({
      completed, abandoned: S.abandoned, timeS: Math.round(S.t), parS: par, km,
      crashesCar: S.cc, crashesRail: S.cr, cargoPct: completed ? Math.round(S.cargo) / 100 : 0,
      distanceM: Math.round(S.z), totalM: total,
    });
  }
  function destroy() {
    cancelAnimationFrame(raf); clearInterval(countTimer);
    window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); window.removeEventListener('resize', onResize);
    try { scene.traverse((o) => { if (o.geometry && !Object.values(G).includes(o.geometry)) o.geometry.dispose(); }); } catch (e) {}
    try { Object.values(G).forEach((g) => g.dispose()); } catch (e) {}
    try { renderer.dispose(); } catch (e) {}
    root.remove();
  }
  raf = requestAnimationFrame(step);
  return done;
}

function fmtT(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
// Deterministic per-chunk randomness so recycled scenery is stable.
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export const GAME_CSS = `
#haul-run{position:fixed;inset:0;z-index:100050;background:#0b0c10;font-family:inherit;color:#f0e6d0;user-select:none}
#haul-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.haul-hud{position:absolute;inset:0;pointer-events:none;display:flex;flex-direction:column;justify-content:space-between;padding:max(10px,env(safe-area-inset-top)) 12px max(10px,env(safe-area-inset-bottom))}
.haul-hud-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.haul-hud-bottom{justify-content:space-between}
.haul-pill{background:rgba(8,10,16,.72);border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:6px 11px;font-size:.86rem;font-weight:700;letter-spacing:.02em;backdrop-filter:blur(4px)}
.haul-k{color:#ffb060;font-size:.68rem;letter-spacing:.12em;margin-right:6px}
.haul-dim{color:#a89880;font-weight:500}
.haul-speed{font-size:1.5rem;min-width:7rem;text-align:center}
.haul-progress{position:absolute;left:12px;right:12px;top:58px;height:8px;background:rgba(255,255,255,.1);border-radius:6px;overflow:visible}
#haul-prog-bar{height:100%;background:linear-gradient(90deg,#ffb060,#ffd166);border-radius:6px;width:0}
#haul-prog-txt{position:absolute;top:10px;right:0;font-size:.74rem;color:#d8c8a8}
.haul-touch{display:none;position:absolute;left:0;right:0;bottom:64px;justify-content:space-between;padding:0 14px;pointer-events:none}
.haul-is-touch .haul-touch{display:flex}
.haul-tbtn{pointer-events:auto;width:88px;height:88px;border-radius:50%;border:2px solid rgba(255,255,255,.25);background:rgba(20,22,30,.7);color:#fff;font-size:1.6rem;font-weight:800;touch-action:none}
.haul-tbtn[data-t=brake]{width:120px;border-radius:20px;font-size:1rem;background:rgba(120,30,30,.7)}
.haul-flash{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);font-size:2.4rem;font-weight:900;color:#ff6a4a;text-shadow:0 0 18px #000;opacity:0;transition:opacity .15s}
.haul-flash.on{opacity:1}
.haul-countdown{position:absolute;left:50%;top:45%;transform:translate(-50%,-50%);font-size:6rem;font-weight:900;color:#ffd166;text-shadow:0 0 30px #000}
.haul-pause{position:absolute;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;pointer-events:auto}
.haul-pause[hidden]{display:none}
.haul-pause-card{background:#1a1c24;border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:22px;max-width:360px;text-align:center}
.haul-pause-card h3{margin:0 0 8px}
.haul-pause-card p{color:#a89880;font-size:.9rem}
.haul-btn{display:inline-block;margin:6px 4px 0;padding:10px 16px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:#2a2d38;color:#fff;font-weight:700;cursor:pointer}
.haul-btn-danger{background:#6a2020}
`;
