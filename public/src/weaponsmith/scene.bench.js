/* ═══════════════════════════════════════════════════════════════════════════
   🔧 THE WORKSHOP, IN 3D — first-person over the bench.

   🔴 FIRST-PERSON IS A DESIGN DECISION, NOT A SHORTCUT. Look at what Gunsmith
      Simulator actually shows: a bench, parts laid out on it, and the gun. You
      do not see a character. That is also the only honest option here — there
      is no rigged character model anywhere in this project (the .glb library is
      furniture, vehicles and static statues; heroes are 2D card art), so a
      visible working figure is an ASSET problem. First-person sidesteps it and
      is more faithful besides. If a rigged smith is ever commissioned it drops
      in behind the bench; _bmLoadGLBUrl already parses animation clips.

   🔴 THE SCENE IS A GARNISH ON A FINISHED FEATURE. Everything here is
      presentation over crafting logic that is already built and tested. Every
      entry point tolerates having no renderer, and mount() returns null rather
      than throwing, so a machine with no WebGL gets exactly today's DOM bench.

   ⚠ TEARDOWN IS NOT OPTIONAL. Browsers cap live WebGL contexts (~16), and this
     overlay opens and closes repeatedly inside a long-lived PWA session. dispose()
     frees geometries, materials, the render target and the context, and cancels
     the frame loop. Leaking one per open would kill the bench after a dozen visits.
   ═══════════════════════════════════════════════════════════════════════════ */

import { boot, webglOk, reducedMotion } from './three.boot.js';

/* Where each part sits on the receiver, in bench units (the receiver is ~0.9
   long and lies along +x). Shared with the DOM bench only through the slot
   NAME, so a blueprint that adds a station gets a sensible default rather than
   a missing mesh. */
export const ANCHORS = {
  receiver:  { pos: [0.00,  0.045, 0], size: [0.90, 0.09, 0.10] },
  barrel:    { pos: [0.62,  0.055, 0], size: [0.62, 0.045, 0.045] },
  bolt:      { pos: [-0.08, 0.105, 0], size: [0.22, 0.05, 0.07] },
  trigger:   { pos: [-0.02, -0.02, 0], size: [0.05, 0.09, 0.03] },
  stock:     { pos: [-0.62, 0.03,  0], size: [0.50, 0.14, 0.09] },
  handguard: { pos: [0.42,  0.06,  0], size: [0.34, 0.08, 0.08] },
  grip:      { pos: [-0.14, -0.09, 0], size: [0.08, 0.18, 0.07] },
  magazine:  { pos: [0.04, -0.14,  0], size: [0.09, 0.22, 0.06] },
  muzzle:    { pos: [0.98,  0.055, 0], size: [0.14, 0.06, 0.06] },
  optic:     { pos: [0.10,  0.15,  0], size: [0.26, 0.05, 0.05] },
};

/* Rough colours per slot so a half-built gun still reads as a gun. Condition
   tints it: a shot part is browner, a pristine one closer to blued steel. */
/* ⚠ THESE WERE TOO DARK ON THE FIRST PASS. True gun-metal values (0x2b–0x4a)
   are correct for a photo and useless here: against a dark mat under one warm
   lamp, every part rendered as the same near-black silhouette and a built gun
   was unreadable as a gun. Lifted into the range where the work light can
   actually catch them, and spread apart so adjacent parts differ — legibility
   beats accuracy when the whole point is watching it come together. */
const SLOT_COLOR = {
  receiver: 0x7c828c, barrel: 0x656b74, bolt: 0x9aa0a8, trigger: 0xb4bac2,
  stock: 0x9a7040, handguard: 0x5a6069, grip: 0x4a4d52,
  magazine: 0x70767f, muzzle: 0x878d96, optic: 0x53575e,
};
const TIER_TINT = { pristine: 1.0, worn: 0.82, shot: 0.62 };

export function mount(canvas) {
  if (!canvas || !webglOk()) return Promise.resolve(null);
  return boot().then((THREE) => (THREE ? build(THREE, canvas) : null)).catch(() => null);
}

function build(THREE, canvas) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0b09);
  // A little fog so the far wall falls away instead of ending in a hard line.
  scene.fog = new THREE.Fog(0x0d0b09, 3.2, 7.0);

  const camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.1, 40);
  /* ⚠ HEIGHT AND ANGLE ARE THE WHOLE SHOT, and the first pass got them wrong:
     an eye at 1.42 looking at 0.92 is nearly LEVEL with a bench at 0.86, so the
     weapon rendered edge-on as a dark line and the near lip of the bench
     occluded it. Someone working does not look ACROSS their bench, they look
     DOWN INTO it — about 40° here — which is also the only angle where a gun
     laid flat reads as a gun. Found by screenshotting, not by reasoning. */
  camera.position.set(0.02, 1.86, 0.99);
  /* Aimed slightly BEYOND the mat rather than at it, which tilts the pegboard
     and the tool wall into frame. Without that the shot is a bench floating in
     brown nothing — the room is what makes it read as a workshop. */
  camera.lookAt(0.06, 0.96, -0.30);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
  } catch (e) { return null; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const mat = (c, o) => { o = o || {}; return new THREE.MeshStandardMaterial({
    color: c, roughness: o.rough == null ? 0.85 : o.rough, metalness: o.metal || 0,
    emissive: o.emissive || 0x000000, emissiveIntensity: o.ei == null ? 1 : o.ei }); };
  const box = (w, h, d, c, o) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c, o));
    m.castShadow = true; m.receiveShadow = true; return m; };
  const cyl = (rt, rb, h, s, c, o) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, s || 12), mat(c, o));
    m.castShadow = true; m.receiveShadow = true; return m; };

  // ── The room ────────────────────────────────────────────────────────────
  const room = new THREE.Group();

  const benchTop = box(2.6, 0.08, 1.05, 0xa9814e, { rough: 0.94 });
  benchTop.position.set(0, 0.86, 0);
  room.add(benchTop);
  // The scratched-up working surface everything sits on.
  const matTop = box(1.9, 0.012, 0.62, 0x1b1e21, { rough: 1 });
  matTop.position.set(0, 0.907, 0.02);
  room.add(matTop);

  [[-1.15, -0.4], [1.15, -0.4], [-1.15, 0.4], [1.15, 0.4]].forEach(([x, z]) => {
    const leg = box(0.09, 0.82, 0.09, 0x7a5c38, { rough: 0.95 });
    leg.position.set(x, 0.41, z);
    room.add(leg);
  });
  // Drawers under the near edge — reads as a real workbench rather than a table.
  for (let i = 0; i < 3; i++) {
    const d = box(0.78, 0.2, 0.04, 0x8c2f24, { rough: 0.8, metal: 0.15 });
    d.position.set(-0.82 + i * 0.82, 0.60, 0.5);
    room.add(d);
    const h = box(0.26, 0.025, 0.03, 0xb9b2a4, { rough: 0.5, metal: 0.7 });
    h.position.set(-0.82 + i * 0.82, 0.60, 0.53);
    room.add(h);
  }

  const wall = box(6.0, 3.0, 0.1, 0x39332c, { rough: 1 });
  wall.position.set(0, 1.5, -1.15);
  wall.receiveShadow = true;
  room.add(wall);
  const floor = box(6.0, 0.1, 4.0, 0x22201c, { rough: 1 });
  floor.position.set(0, -0.05, 0.4);
  floor.receiveShadow = true;
  room.add(floor);

  // Pegboard + hanging tools, the thing that makes a wall read as a workshop.
  const peg = box(1.9, 0.72, 0.03, 0x4a4038, { rough: 1 });
  peg.position.set(-0.05, 1.62, -1.08);
  room.add(peg);
  for (let i = 0; i < 7; i++) {
    const x = -0.78 + i * 0.26;
    const shaft = cyl(0.012, 0.012, 0.26 + (i % 3) * 0.06, 8, 0x9aa0a8, { rough: 0.45, metal: 0.8 });
    shaft.position.set(x, 1.66, -1.05);
    room.add(shaft);
    const grip = cyl(0.022, 0.022, 0.1, 8, i % 2 ? 0x2f6fb0 : 0xc8452f, { rough: 0.6 });
    grip.position.set(x, 1.5, -1.05);
    room.add(grip);
  }

  // Parts bins, and an ammo tin for weight on the left.
  for (let i = 0; i < 2; i++) {
    const bin = box(0.3, 0.16, 0.22, 0x2f6fb0, { rough: 0.75 });
    bin.position.set(0.92 + i * 0.34, 0.98, -0.3);
    room.add(bin);
  }
  const tin = box(0.42, 0.26, 0.26, 0x4b5540, { rough: 0.8, metal: 0.2 });
  tin.position.set(-1.0, 1.03, -0.28);
  room.add(tin);
  const oilCan = cyl(0.05, 0.05, 0.22, 12, 0x2f6a33, { rough: 0.5, metal: 0.35 });
  oilCan.position.set(0.72, 1.01, 0.26);
  room.add(oilCan);

  scene.add(room);

  // ── Light ───────────────────────────────────────────────────────────────
  // A single hanging lamp does most of the work; the fills stop the underside
  // of the gun going pure black.
  /* ⚠ THE FIRST LIGHTING PASS BLEW OUT THE BENCH. A point light at intensity
     1.5 sitting 1.2m above a pale wooden top washed the whole surface to flat
     orange and buried the weapon in it — the gun was the darkest thing on
     screen, which is exactly backwards. Dimmer lamp, lifted higher, plus a
     tight spot that pools ON THE MAT so the work is the brightest thing in
     frame and the bench falls off around it. Caught by looking at it. */
  scene.add(new THREE.AmbientLight(0x35302a, 1.0));
  const lamp = new THREE.PointLight(0xffd9a0, 0.62, 7, 2);
  lamp.position.set(0.1, 2.28, 0.3);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(1024, 1024);
  scene.add(lamp);
  const shade = cyl(0.03, 0.2, 0.16, 14, 0x1c1a17, { rough: 0.7, metal: 0.4 });
  shade.position.set(0.1, 2.39, 0.3);
  scene.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0xffe6b8 }));
  bulb.position.set(0.1, 2.26, 0.3);
  scene.add(bulb);
  const cord = cyl(0.004, 0.004, 0.9, 6, 0x14120f, { rough: 1 });
  cord.position.set(0.1, 2.85, 0.3);
  scene.add(cord);

  // The work light. Tight cone on the mat — this is what makes the weapon the
  // brightest object in the frame instead of the bench.
  const spot = new THREE.SpotLight(0xfff1d0, 2.2, 4.5, 0.62, 0.55, 1.6);
  spot.position.set(0.1, 2.2, 0.34);
  spot.target.position.set(0.05, 0.93, -0.02);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  scene.add(spot); scene.add(spot.target);

  const key = new THREE.DirectionalLight(0xfff0d6, 0.28);
  key.position.set(1.4, 2.4, 1.6);
  scene.add(key);
  // Cool rim from behind so blued steel gets an edge instead of vanishing into
  // the mat. Steel is dark; without a rim a finished gun reads as a hole.
  const rim = new THREE.DirectionalLight(0x8fb4e6, 0.5);
  rim.position.set(-1.8, 1.2, -1.4);
  scene.add(rim);

  // ── The weapon, rebuilt from bench state ────────────────────────────────
  // Its own group so a rebuild disposes only the gun, never the room.
  const gun = new THREE.Group();
  gun.position.set(0, 0.965, 0.02);
  scene.add(gun);

  /* ── 🧤 HANDS AND TOOL ────────────────────────────────────────────────
     THIS is the "I am working" feeling, and it needs no rigged character —
     two gloved hands and whatever tool the current step calls for, entering
     from the bottom of frame the way your own hands do.

     Built as a group pivoting at the WRIST rather than animating fingers: at
     this camera distance the readable motion is the tool arcing and the hands
     following it, and a knuckle nobody can see is wasted geometry. Same reason
     the fingers are four boxes.

     ⚠ Parked BELOW the frame by default. Hands permanently hovering over the
       bench would block the weapon — the thing the player is actually here to
       look at — so they rise only while a fastening is being driven. */
  /* 🔴 HANDS ARE PARENTED TO THE CAMERA, NOT TO THE WORLD.
     Three passes of world-space placement all failed the same way: raise them
     and they slid along the bottom edge, push them in and they vanished under
     the bench. That is not a tuning problem, it is the wrong parent. In a
     first-person shot the hands are VIEWER-RELATIVE — they belong at a fixed
     offset from the eye, so they hold the same place on screen no matter how
     the camera is framed, and re-tuning the camera can never lose them again.
     Standard practice for a first-person rig, and it should have been the
     first thing tried. */
  const hands = new THREE.Group();
  scene.add(camera);                     // camera must be in the graph to parent to it
  camera.add(hands);
  // Camera-local: below the eye line, in front of it. -z is forward.
  /* ⚠ THE OFFSET IS COMPUTED, NOT GUESSED. At fov 46° the frustum half-height
     is depth·tan(23°) — so at 0.95 the bottom edge of frame sits at y = -0.40.
     The previous pass parked the hands at exactly -0.40 and they rendered
     perfectly, entirely off-screen. Placed at -0.26 they sit in the lower
     third with room to rise, and the parked position is below the edge on
     purpose. */
  hands.position.set(0.02, -0.62, -0.95);
  hands.rotation.x = 0.20;               // tip them onto the bench plane
  hands.visible = false;

  const SKIN = 0x8a6a4a, GLOVE = 0x3d3730;
  function makeHand(side) {
    const g = new THREE.Group();
    const palm = box(0.13, 0.05, 0.10, GLOVE, { rough: 0.95 });
    g.add(palm);
    for (let i = 0; i < 4; i++) {
      const f = box(0.075, 0.028, 0.019, GLOVE, { rough: 0.95 });
      f.position.set(0.09, 0.004, -0.033 + i * 0.022);
      f.rotation.z = -0.22;
      g.add(f);
    }
    const thumb = box(0.055, 0.026, 0.024, GLOVE, { rough: 0.95 });
    thumb.position.set(0.05, -0.012, side * 0.052);
    thumb.rotation.y = side * 0.5;
    g.add(thumb);
    const cuff = box(0.055, 0.075, 0.105, 0x6a5238, { rough: 0.95 });
    cuff.position.set(-0.085, 0, 0);
    g.add(cuff);
    /* ⚠ THE FOREARM RUNS TOWARD THE VIEWER, not sideways. The first pass laid
       it along local -x, so with the hand turned to face the work the arm shot
       off to the side of frame and read as a log lying on the bench rather than
       as the player's own arm. In a first-person shot the arms have to leave
       the BOTTOM of frame, which means +z and down. */
    const arm = cyl(0.043, 0.055, 0.30, 10, SKIN, { rough: 0.9 });
    arm.rotation.x = Math.PI / 2;
    arm.position.set(-0.10, -0.04, 0.17);
    arm.rotation.z = 0.16;
    g.add(arm);
    return g;
  }

  /* Both hands face INWARD toward the weapon's centreline; the y-rotations put
     the fingers on the work while the forearms trail back and out of frame. */
  const handL = makeHand(1);
  handL.position.set(-0.34, 0, 0.02);
  handL.rotation.set(-0.30, 0.34, 0);
  hands.add(handL);

  const handR = makeHand(-1);
  handR.position.set(0.34, 0, 0.02);
  handR.rotation.set(-0.30, Math.PI - 0.34, 0);
  hands.add(handR);

  /* The tool lives in the RIGHT hand and swaps by step. One group so a swap is
     a visibility flip rather than a rebuild — swapping tools mid-build must not
     allocate. */
  const tools = {};
  function addTool(key, g) { g.visible = false; tools[key] = g; handR.add(g); }

  // 🔧 Torque wrench — the assembly-bench tool.
  {
    const g = new THREE.Group();
    const shaft = box(0.30, 0.038, 0.038, 0x9aa0a8, { rough: 0.4, metal: 0.85 });
    shaft.position.set(0.20, 0, 0);
    g.add(shaft);
    const head = cyl(0.055, 0.055, 0.042, 12, 0xd0d6de, { rough: 0.3, metal: 0.9 });
    head.rotation.x = Math.PI / 2;
    head.position.set(0.36, 0, 0);
    g.add(head);
    const grip = cyl(0.028, 0.028, 0.12, 10, 0xc8452f, { rough: 0.75 });
    grip.rotation.z = Math.PI / 2;
    grip.position.set(0.06, 0, 0);
    g.add(grip);
    addTool('wrench', g);
  }
  // 🔨 Hammer — the forge tool, kept here so both benches share one rig.
  {
    const g = new THREE.Group();
    const haft = cyl(0.017, 0.021, 0.30, 8, 0x8a6534, { rough: 0.92 });
    haft.rotation.z = Math.PI / 2;
    haft.position.set(0.17, 0, 0);
    g.add(haft);
    const headM = box(0.075, 0.062, 0.062, 0x6a7078, { rough: 0.42, metal: 0.85 });
    headM.position.set(0.33, 0, 0);
    g.add(headM);
    addTool('hammer', g);
  }
  // 🧽 Oil rag — cleaning.
  {
    const g = new THREE.Group();
    const rag = box(0.11, 0.03, 0.10, 0xb9b2a4, { rough: 1 });
    rag.position.set(0.10, 0, 0);
    rag.rotation.z = 0.2;
    g.add(rag);
    addTool('rag', g);
  }

  const api = {
    THREE, scene, camera, renderer, gun, lamp, spot, bulb, hands, tools,
    _raf: 0, _t0: Date.now(), _disposed: false, _reduced: reducedMotion(),
    _work: null,          // { tool, value } while a fastening is being driven
    _ease: 0,             // 0 = parked below frame, 1 = up at the bench
  };

  /* Drive the hands from the torque bar. `value` is 0..1 — the same number the
     DOM bar is showing — so the two can never disagree about how far along a
     fastening is. Called every frame while the player holds; `null` releases. */
  api.setWork = function (tool, value) {
    if (api._disposed) return;
    api._work = (tool == null) ? null : { tool: tool, value: Math.max(0, Math.min(1, value || 0)) };
    for (const k in tools) tools[k].visible = !!(api._work && api._work.tool === k);
  };

  /* Rebuild the weapon from `seated` — a map of slot -> { partId, tier }.
     Cheap enough to redo wholesale on every change: ten boxes. Doing it
     wholesale rather than diffing means the 3D view can never drift out of
     step with the DOM bench, which is the failure that would actually matter. */
  api.setSeated = function (seated) {
    if (api._disposed) return;
    for (let i = gun.children.length - 1; i >= 0; i--) {
      const c = gun.children[i];
      gun.remove(c);
      try { c.geometry && c.geometry.dispose(); c.material && c.material.dispose(); } catch (e) {}
    }
    for (const slot in (seated || {})) {
      const a = ANCHORS[slot];
      if (!a) continue;                             // unknown station — skip, never throw
      const tier = (seated[slot] && seated[slot].tier) || 'pristine';
      const base = SLOT_COLOR[slot] || 0x555a60;
      const k = TIER_TINT[tier] == null ? 1 : TIER_TINT[tier];
      const col = new THREE.Color(base).multiplyScalar(k);
      const isMetal = slot !== 'stock' && slot !== 'grip';
      const m = box(a.size[0], a.size[1], a.size[2], col.getHex(),
                    { rough: isMetal ? 0.42 : 0.9, metal: isMetal ? 0.75 : 0.05 });
      m.position.set(a.pos[0], a.pos[1], a.pos[2]);
      gun.add(m);
    }
  };

  api.resize = function () {
    if (api._disposed || !canvas.parentElement) return;
    const w = canvas.clientWidth || canvas.parentElement.clientWidth || 640;
    // ⚠ 0.46 was too letterboxed once hands were in play: they entered at the
    //   bottom edge and got cropped to a sliver. Taller frame, room to work.
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

  /* The frame loop. A gentle lamp flicker and nothing else — the bench should
     feel lived-in, not busy.
     ⚠ Honours prefers-reduced-motion by rendering ONE frame and stopping. The
       scene is still there and still correct; it simply holds still. */
  api.start = function () {
    if (api._disposed) return;
    if (api._reduced) { api.render(); return; }
    let last = Date.now();
    const tick = () => {
      if (api._disposed) return;
      const now = Date.now();
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const t = (now - api._t0) / 1000;

      const f = 1 + Math.sin(t * 2.1) * 0.035 + Math.sin(t * 7.3) * 0.014;
      lamp.intensity = 0.62 * f;
      spot.intensity = 2.2 * f;

      /* Hands ease in and out rather than snapping. A hard cut reads as a
         glitch; 180ms of travel reads as reaching for the work. */
      const want = api._work ? 1 : 0;
      api._ease += (want - api._ease) * Math.min(1, dt * 9);
      // Camera-local now: they rise from below the frame into the work, and
      // the numbers mean the same thing at any camera framing.
      hands.position.y = -0.62 + api._ease * 0.62;    // -0.62 parked → 0.00 up
      hands.visible = api._ease > 0.01;

      if (api._work) {
        const v = api._work.value;
        /* The tool ARCS with the bar — a quarter turn across the whole travel,
           plus a fine tremor that grows as the fastener tightens. The tremor is
           the tell: it is what makes over-torquing FEEL like over-torquing
           before the bar says so. */
        const shake = v * v * 0.05;
        /* 🔧 THE TOOL TURNS, THE HANDS BARELY MOVE — which is what tightening a
           fastener actually looks like, and is the only version that stays in
           frame. Driving the arc through the WRIST pitched the hands ~73° down
           and out of shot by the top of the bar; a wrench rotates about its own
           shaft, so the arc belongs on the tool's local x. Caught by
           screenshotting the top of the arc rather than the middle. */
        const spin = v * 2.6;
        for (const k in tools) if (tools[k].visible) tools[k].rotation.x = spin;

        handR.rotation.x = -0.30 - v * 0.16 + Math.sin(t * 34) * shake;
        handR.position.y = 0.02 + Math.sin(t * 34) * shake * 0.4;
        handL.rotation.x = -0.30 - v * 0.05;
        handL.position.y = Math.sin(t * 21) * 0.004;
        // Steady the gun under the work — the whole rig should feel loaded.
        gun.rotation.z = Math.sin(t * 34) * shake * 0.09;
      } else {
        handR.rotation.x = -0.30; handL.rotation.x = -0.30;
        handR.position.y = 0; handL.position.y = 0;
        for (const k in tools) tools[k].rotation.x = 0;
        gun.rotation.z = 0;
      }

      api.render();
      api._raf = requestAnimationFrame(tick);
    };
    tick();
  };

  /* 🔴 Free everything. See the header — leaking a context per open kills the
     bench after a dozen visits, and the symptom (a blank canvas, much later)
     points nowhere near the cause. */
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

  api.resize();
  return api;
}
