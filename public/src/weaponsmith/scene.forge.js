/* ═══════════════════════════════════════════════════════════════════════════
   ⚔️ THE FORGE, IN 3D.

   A different room for a different game. The assembly bench is about precision
   — stations, fitment, a wrench. The forge is about HEAT, so the whole scene is
   built around one thing:

   🔴 THE BILLET'S COLOUR IS THE GAME STATE. Emissive colour and intensity are
      driven straight off the step bar, so the steel runs black → dull red →
      orange → yellow → white as you hold, and visibly cools when you stop.
      That is the single most satisfying thing available here, and it is
      information rather than decoration: a smith reads temperature by colour,
      and after a few blades the player will too — they will start releasing on
      the colour and only checking the bar to confirm.

   ⚠ Same contract as scene.bench.js: mount() returns null rather than throwing,
     dispose() frees everything, and with no WebGL the DOM forge from phase 10
     is untouched.
   ═══════════════════════════════════════════════════════════════════════════ */

import { boot, webglOk, reducedMotion } from './three.boot.js';

/* Forge colours, coolest → hottest. Real smithing colours, because they are
   both correct and the most legible ramp available: a dull cherry and a
   lemon-yellow are unmistakably different at a glance, which is the whole
   point of using colour as the readout. */
const HEAT_RAMP = [
  { t: 0.00, c: 0x2a2622, e: 0.00 },   // cold, dead grey
  { t: 0.22, c: 0x6b1408, e: 0.55 },   // first colour — faint red in shadow
  { t: 0.42, c: 0xb52a06, e: 1.35 },   // dull cherry
  { t: 0.62, c: 0xff6a10, e: 2.40 },   // orange — working heat
  { t: 0.80, c: 0xffb43c, e: 3.40 },   // yellow
  { t: 1.00, c: 0xfff0c0, e: 4.60 },   // white — too far, burning
];

export function heatColor(THREE, v) {
  const x = Math.max(0, Math.min(1, v || 0));
  let a = HEAT_RAMP[0], b = HEAT_RAMP[HEAT_RAMP.length - 1];
  for (let i = 0; i < HEAT_RAMP.length - 1; i++) {
    if (x >= HEAT_RAMP[i].t && x <= HEAT_RAMP[i + 1].t) { a = HEAT_RAMP[i]; b = HEAT_RAMP[i + 1]; break; }
  }
  const k = (b.t - a.t) > 0 ? (x - a.t) / (b.t - a.t) : 0;
  const col = new THREE.Color(a.c).lerp(new THREE.Color(b.c), k);
  return { color: col, emissive: a.e + (b.e - a.e) * k };
}

export function mount(canvas) {
  if (!canvas || !webglOk()) return Promise.resolve(null);
  return boot().then((THREE) => (THREE ? build(THREE, canvas) : null)).catch(() => null);
}

function build(THREE, canvas) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0806);
  scene.fog = new THREE.Fog(0x0a0806, 2.6, 6.5);

  const camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.1, 40);
  camera.position.set(0.02, 1.58, 1.72);
  camera.lookAt(0.02, 0.72, -0.30);

  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false }); }
  catch (e) { return null; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const mat = (c, o) => { o = o || {}; return new THREE.MeshStandardMaterial({
    color: c, roughness: o.rough == null ? 0.9 : o.rough, metalness: o.metal || 0,
    emissive: o.emissive || 0x000000, emissiveIntensity: o.ei == null ? 1 : o.ei }); };
  const box = (w, h, d, c, o) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c, o));
    m.castShadow = true; m.receiveShadow = true; return m; };
  const cyl = (rt, rb, h, s, c, o) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, s || 12), mat(c, o));
    m.castShadow = true; m.receiveShadow = true; return m; };

  // ── The smithy ──────────────────────────────────────────────────────────
  const floor = box(7, 0.1, 5, 0x1a1714, { rough: 1 });
  floor.position.set(0, -0.05, 0.4);
  scene.add(floor);
  const backWall = box(7, 3.4, 0.1, 0x2b2520, { rough: 1 });
  backWall.position.set(0, 1.7, -1.35);
  scene.add(backWall);

  // The anvil, dead centre — this is where the work happens.
  const anvilBase = box(0.46, 0.12, 0.34, 0x2e2a26, { rough: 0.95, metal: 0.2 });
  anvilBase.position.set(0, 0.36, -0.16);
  scene.add(anvilBase);
  const anvilWaist = box(0.24, 0.14, 0.22, 0x3a3530, { rough: 0.85, metal: 0.3 });
  anvilWaist.position.set(0, 0.47, -0.16);
  scene.add(anvilWaist);
  const anvilFace = box(0.86, 0.14, 0.28, 0x5e5750, { rough: 0.35, metal: 0.85 });
  anvilFace.position.set(0, 0.60, -0.16);
  scene.add(anvilFace);
  const horn = cyl(0.02, 0.10, 0.30, 12, 0x5e5750, { rough: 0.35, metal: 0.85 });
  horn.rotation.z = Math.PI / 2;
  horn.position.set(-0.56, 0.60, -0.16);
  scene.add(horn);
  // The anvil stands on a timber stump, which is what stops it reading as a
  // metal shape floating above a floor.
  const stump = cyl(0.26, 0.30, 0.30, 14, 0x4a3520, { rough: 1 });
  stump.position.set(0, 0.15, -0.16);
  scene.add(stump);

  scene.add(new THREE.AmbientLight(0x24201c, 1.0));

  // ── The hearth, off to the left, breathing ──────────────────────────────
  const hearth = box(0.86, 0.52, 0.62, 0x3a322a, { rough: 1 });
  hearth.position.set(-1.28, 0.26, -0.5);
  scene.add(hearth);
  const coals = box(0.62, 0.10, 0.42, 0xff5a12, { rough: 0.9, emissive: 0xff4a08, ei: 2.2 });
  coals.position.set(-1.28, 0.54, -0.5);
  scene.add(coals);
  const hearthLight = new THREE.PointLight(0xff7a20, 2.0, 4.2, 2);
  hearthLight.position.set(-1.28, 0.72, -0.42);
  scene.add(hearthLight);

  // The quench barrel, to the right.
  const barrel = cyl(0.30, 0.28, 0.62, 16, 0x4a3a26, { rough: 0.95 });
  barrel.position.set(1.22, 0.31, -0.30);
  scene.add(barrel);
  const water = cyl(0.27, 0.27, 0.02, 16, 0x14202a, { rough: 0.25, metal: 0.4 });
  water.position.set(1.22, 0.60, -0.30);
  scene.add(water);
  for (const y of [0.16, 0.46]) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.018, 8, 22), mat(0x6a6058, { rough: 0.5, metal: 0.7 }));
    hoop.rotation.x = Math.PI / 2;
    hoop.position.set(1.22, y, -0.30);
    scene.add(hoop);
  }

  // Tool rack behind.
  for (let i = 0; i < 4; i++) {
    const t = cyl(0.016, 0.016, 0.42, 8, 0x7a736a, { rough: 0.5, metal: 0.7 });
    t.position.set(-0.42 + i * 0.3, 1.36, -1.28);
    scene.add(t);
  }

  const key = new THREE.DirectionalLight(0xffe0b0, 0.22);
  key.position.set(1.6, 2.6, 1.6);
  scene.add(key);

  /* ── THE BILLET ─────────────────────────────────────────────────────────
     Its own light as well as its own emissive: hot steel does not just LOOK
     bright, it lights the room. Without the point light the anvil stays dark
     next to a glowing bar and the illusion dies immediately. */
  const billet = box(0.62, 0.055, 0.085, 0x2a2622, { rough: 0.55, metal: 0.6 });
  billet.position.set(0.02, 0.695, -0.16);
  scene.add(billet);
  const billetLight = new THREE.PointLight(0xff6a10, 0, 2.6, 2);
  billetLight.position.set(0.02, 0.76, -0.16);
  scene.add(billetLight);

  const api = {
    THREE, scene, camera, renderer, billet, billetLight,
    _raf: 0, _t0: Date.now(), _disposed: false, _reduced: reducedMotion(),
    _heat: 0, _target: 0, _stepId: null,
  };

  /* Drive the heat. `v` is the step bar, 0..1 — the same number the DOM shows.
     `stepId` lets the scene react to WHICH step it is: a quench should not
     glow brighter as the bar fills, it should go dark. */
  api.setHeat = function (v, stepId) {
    if (api._disposed) return;
    api._stepId = stepId || null;
    const x = Math.max(0, Math.min(1, v || 0));
    // 💧 Quench INVERTS — holding it under longer takes heat OUT. Reading the
    // bar the same way on every step would have the steel getting hotter in
    // the water, which is the one thing everybody knows is wrong.
    api._target = (stepId === 'quench') ? (1 - x) * 0.55 : x;
  };

  api.resize = function () {
    if (api._disposed || !canvas.parentElement) return;
    const w = canvas.clientWidth || canvas.parentElement.clientWidth || 640;
    /* ⚠ CLAMPED AT 340. Height derived purely from width gave a 640px canvas on
       the full-width forge panel and pushed the controls off-screen. The CSS
       caps it too; both are needed, since the renderer sizes the drawing buffer
       and the CSS only sizes the box. */
    const h = Math.min(340, Math.max(200, Math.round(w * 0.56)));
    canvas.style.height = h + 'px';
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  api.render = function () { if (!api._disposed) renderer.render(scene, camera); };

  api.start = function () {
    if (api._disposed) return;
    if (api._reduced) { applyHeat(1); api.render(); return; }
    let last = Date.now();
    const tick = () => {
      if (api._disposed) return;
      const now = Date.now();
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const t = (now - api._t0) / 1000;

      /* Heat CHASES its target rather than snapping, and cools slower than it
         heats — steel takes work to warm and gives it up grudgingly. That
         asymmetry is what makes the bar feel like a physical process instead
         of a slider. */
      const rate = (api._target > api._heat) ? 6.0 : 1.6;
      api._heat += (api._target - api._heat) * Math.min(1, dt * rate);
      applyHeat(api._heat);

      // The hearth breathes, which keeps the room alive between steps.
      hearthLight.intensity = 2.0 + Math.sin(t * 1.7) * 0.35 + Math.sin(t * 5.3) * 0.12;
      coals.material.emissiveIntensity = 2.2 + Math.sin(t * 1.7) * 0.3;

      api.render();
      api._raf = requestAnimationFrame(tick);
    };
    tick();
  };

  function applyHeat(h) {
    const { color, emissive } = heatColor(THREE, h);
    billet.material.color.copy(color);
    billet.material.emissive.copy(color);
    billet.material.emissiveIntensity = emissive;
    // Hot steel lights its surroundings — see the note on billetLight.
    billetLight.color.copy(color);
    billetLight.intensity = emissive * 0.55;
  }

  api.dispose = function () {
    if (api._disposed) return;
    api._disposed = true;
    if (api._raf) cancelAnimationFrame(api._raf);
    scene.traverse((o) => {
      if (o.geometry) { try { o.geometry.dispose(); } catch (e) {} }
      if (o.material) {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach((m) => { try { m.dispose(); } catch (e) {} });
      }
    });
    try { renderer.dispose(); } catch (e) {}
    try { renderer.forceContextLoss(); } catch (e) {}
  };

  applyHeat(0);
  api.resize();
  return api;
}
