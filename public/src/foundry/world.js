/* ════════════════════════════════════════════════════════════════════════════
   🌍 THE FOUNDRY FLOOR — a first-person shed you walk around.
   ----------------------------------------------------------------------------
   Ported in spirit from the walkable card shop (index.html ~160138), whose
   header states the pattern this file follows exactly:

     "first-person room (Three.js, lazy-loaded from a CDN, opt-in, disposed on
      exit). Walk up to a station and press E / tap the prompt to open that
      station's panel (reuses the 2D panel bodies)."

   🔴 "REUSES THE 2D PANEL BODIES" IS THE LOAD-BEARING HALF. This file draws a
   room and decides what you are standing near. It does NOT re-implement a single
   machine card, cost line, or recipe dropdown — those come from render.js and
   are the same markup the Blueprint view uses. Two copies of the machine card
   would mean every future change to a cost or a halt reason gets made twice, and
   the 3D one would silently rot. If a panel needs to look different in here,
   that is a CSS job, not a second renderer.

   🔴 THE BLUEPRINT VIEW IS NOT DEPRECATED BY THIS. A phone that cannot hold a
   WebGL context, a player on a train, a screen reader — all still need the flat
   panel, and it is already built and tested. The 3D floor is a MODE, and
   `open({ mode })` honours a stored preference. Deleting the 2D view to "commit"
   to 3D would trade a working feature for a prettier one.

   🔴 THREE ARRIVES THROUGH THE HOST, NEVER AN IMPORT. `_csLoadThree` and
   `_cs3DLoadModel` are top-level function declarations in index.html — lexical
   bindings this module cannot see (CLAUDE.md, the globals trap). They come in
   through window.MythicFoundryBridge like everything else, and they are REUSED
   rather than reimplemented: that loader already patches GLTFLoader for Draco
   and Meshopt, caches templates in an LRU, and clones per instance. Writing a
   second .glb loader here would lose all of that.
   ════════════════════════════════════════════════════════════════════════════ */

import { MACHINES, machineById } from './machines.js';
import { machineStatus, isBuilt, HALT, powerCapacity, powerDemand } from './state.js';
import { FLOOR, SPAWN, LAYOUT, STATIONS, build as buildModel, overrideFor, blockRadius, interactRadius, blocks, pushOut, srgb } from './models.js';

/* Glow colour per machine state. This table IS the reason to render a floor at
   all: from the far end of the shed a player should be able to see that the
   furnace is red and everything past it is amber, and walk straight to the
   problem. Keep these in step with HALT_TEXT — a colour that disagrees with the
   words on the card is worse than no colour. */
const STATE_COLOR = {
  [HALT.OK]:           { hex: 0x7fd6a0, pulse: 0.18, run: true },
  [HALT.STARVED]:      { hex: 0xe0a860, pulse: 0.10, run: false },
  [HALT.BUFFER_FULL]:  { hex: 0xe0a860, pulse: 0.10, run: false },
  [HALT.STORAGE_FULL]: { hex: 0xe0a860, pulse: 0.10, run: false },
  [HALT.NO_RECIPE]:    { hex: 0x8d97a8, pulse: 0.0,  run: false },
  [HALT.BROWNOUT]:     { hex: 0x5aa9e6, pulse: 0.55, run: true },
  [HALT.BROKEN]:       { hex: 0xff5a5a, pulse: 0.9,  run: false },
  // A dry machine reads amber like the other supply stalls, but slower — it is
  // a shortage, not a fault, and should not compete with a breakdown for the eye.
  [HALT.NO_FUEL]:      { hex: 0xd8a05a, pulse: 0.35, run: false },
  // Under construction: the same cyan the ghost pad used, so a site you are
  // waiting on reads as continuous with the pad you started from.
  [HALT.BUILDING]:     { hex: 0x5aa9e6, pulse: 0.5,  run: false },
};
const OFF_COLOR   = { hex: 0x3a4048, pulse: 0, run: false };
const GHOST_COLOR = 0x5aa9e6;

const EYE = 1.6;
const WALK = 5.4;        // m/s — brisk, because the shed is 44 m across
const LOOK = 0.0042;     // rad per px of drag

export function createWorld(host, opts) {
  const h = host, o = opts || {};
  const T = (typeof window !== 'undefined') ? window.THREE : null;
  if (!T || !o.mount) return null;

  const mount = o.mount;
  const st = o.state;
  let W = mount.clientWidth || 900, H = mount.clientHeight || 560;

  /* ── Scene ─────────────────────────────────────────────────────────────── */
  const scene = new T.Scene();
  scene.background = srgb(T, 0x0b0d11);
  scene.fog = new T.Fog(srgb(T, 0x0b0d11), 22, 78);
  const camera = new T.PerspectiveCamera(70, W / H, 0.1, 140);
  camera.rotation.order = 'YXZ';
  camera.position.set(SPAWN.x, EYE, SPAWN.z);

  const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, (window.devicePixelRatio || 1)));
  renderer.setSize(W, H);
  /* 🔴 COLOUR MANAGEMENT, OR EVERYTHING CLIPS TO WHITE.
     r128's default output is LinearEncoding with no tone mapping, so any lit
     surface above mid-grey saturates: the first render of this floor had the
     sorter's magnet, its plinth and half the machine trims as flat white slabs
     that read as missing textures. sRGB output plus ACES tone mapping is the
     standard fix — it maps highlights onto a curve instead of a cliff, which is
     also what lets the emissive state glows sit ON TOP of a lit machine and
     still be legible. Set these BEFORE anything is added to the scene.
     ⚠ These property names are r128-era (outputEncoding / sRGBEncoding). If the
     app ever moves this surface to the module build in the importmap they become
     outputColorSpace / SRGBColorSpace — guarded so either build works. */
  try {
    if (T.sRGBEncoding !== undefined) renderer.outputEncoding = T.sRGBEncoding;
    else if (T.SRGBColorSpace !== undefined) renderer.outputColorSpace = T.SRGBColorSpace;
    if (T.ACESFilmicToneMapping !== undefined) { renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95; }
  } catch (e) {}
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;cursor:grab;touch-action:none';
  mount.insertBefore(renderer.domElement, mount.firstChild);

  /* 🔴 LIGHT RIG IS TUNED FOR GAMMA-CORRECTED OUTPUT — do not port these numbers
     to a renderer without the sRGB/ACES block above. Pre-correction the shed
     needed a big ambient to be visible at all (0.95 + eight bright lamps); with
     correction that same rig turned the whole floor into flat beige. Low ambient
     plus tight pools is what makes it read as a working shed at night: you see
     the machine you are standing at, and the glow strips carry the rest. */
  scene.add(new T.AmbientLight(0x4a5470, 0.22));
  const key = new T.DirectionalLight(0xffe8d0, 0.22); key.position.set(8, 18, 6); scene.add(key);
  /* ⚠ INTENSITY IS IN THREE'S CONVENTIONAL UNITS, NOT PHYSICAL ONES.
     `renderer.physicallyCorrectLights` is off (r128 default), so ~1 is a normal
     lamp. A pass that set these to 5.5 — reasoning in lumens — lit a 0x1a1d23
     floor up to pale tan and flattened the whole shed. If physically-correct
     lighting is ever switched on, every number here has to be re-derived.
     distance 15, not 26: a lamp that reaches the far wall is not a pool, it is
     just more ambient. */
  const lamp = (x, z, c, i) => { const l = new T.PointLight(c, i, 15, 1.4); l.position.set(x, 5.0, z); scene.add(l); };
  /* One lamp per working area rather than four for the whole shed — an aisle you
     can see the far end of is an aisle you will walk down. */
  lamp(-14, 6, 0xffb066, 1.3); lamp(-14, -4, 0xffb066, 1.3); lamp(-6, -10, 0xffd28a, 1.0);
  lamp(14, 6, 0x88c4ff, 1.15); lamp(14, -2, 0x88c4ff, 1.15); lamp(9, -10, 0x8affd6, 0.95);
  lamp(0, 10, 0xbfd0e0, 1.0);  lamp(0, 0, 0xffe0b0, 1.1);

  /* ── The shed ──────────────────────────────────────────────────────────── */
  const floorMat = new T.MeshStandardMaterial({ color: srgb(T, 0x1a1d23), roughness: 0.96, metalness: 0.05 });
  const floor = new T.Mesh(new T.PlaneGeometry(FLOOR.w, FLOOR.d), floorMat);
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  /* Aisle stripes. Not decoration — they mark the two lines, so "follow the
     yellow aisle" is a thing a player can actually do to trace their material. */
  const stripe = (x, z, w, d, hex) => {
    const m = new T.Mesh(new T.PlaneGeometry(w, d), new T.MeshBasicMaterial({ color: srgb(T, hex), transparent: true, opacity: 0.13 }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.012, z); scene.add(m);
  };
  stripe(-11, 0, 3.0, 24, 0xc2725a);
  stripe(11, 0, 3.0, 24, 0xffcf6b);
  stripe(0, 8, 26, 3.0, 0x5aa9e6);

  const wallMat = new T.MeshStandardMaterial({ color: srgb(T, 0x14171d), roughness: 0.95, metalness: 0.08, side: T.DoubleSide });
  const wall = (w, hgt, x, z, ry) => { const m = new T.Mesh(new T.PlaneGeometry(w, hgt), wallMat); m.position.set(x, hgt / 2, z); m.rotation.y = ry; scene.add(m); };
  wall(FLOOR.w, 9, 0, -FLOOR.d / 2, 0); wall(FLOOR.w, 9, 0, FLOOR.d / 2, Math.PI);
  wall(FLOOR.d, 9, -FLOOR.w / 2, 0, Math.PI / 2); wall(FLOOR.d, 9, FLOOR.w / 2, 0, -Math.PI / 2);
  const roof = new T.Mesh(new T.PlaneGeometry(FLOOR.w, FLOOR.d), new T.MeshStandardMaterial({ color: srgb(T, 0x0f1216), roughness: 1, side: T.DoubleSide }));
  roof.rotation.x = Math.PI / 2; roof.position.y = 9; scene.add(roof);

  /* ── Placements ────────────────────────────────────────────────────────── */
  /* One record per thing you can stand in front of. `node` is swapped wholesale
     when an admin model loads or when a machine is built, so nothing else needs
     to know whether it is looking at procedural geometry or a .glb. */
  const spots = [];

  function addSpot(rec) {
    const g = new T.Group();
    g.position.set(rec.x, 0, rec.z);
    g.rotation.y = rec.ry || 0;
    scene.add(g);
    rec.group = g; rec.node = null; rec.glow = null;
    spots.push(rec);
    return rec;
  }

  for (const def of MACHINES) {
    const p = LAYOUT[def.id]; if (!p) continue;
    addSpot({
      kind: 'machine', id: def.id, label: def.name, emoji: def.emoji,
      x: p.x, z: p.z, ry: p.ry, r: blockRadius(def.id), ir: interactRadius(def.id),
    });
  }
  for (const s of STATIONS) {
    addSpot({ kind: 'station', id: s.id, label: s.label, emoji: s.emoji, panel: s.panel, x: s.x, z: s.z, ry: s.ry, r: s.r, ir: s.ir });
  }

  /* Ghost geometry for a machine that is not built yet. Showing the PAD rather
     than nothing is what turns "build a machine" from a menu action into a place
     you walk to — and it teaches the floor plan before you can afford it. */
  function ghostFor(id) {
    const g = new T.Group();
    const f = blockRadius(id) * 1.5;
    const pad = new T.Mesh(new T.PlaneGeometry(f, f), new T.MeshBasicMaterial({ color: GHOST_COLOR, transparent: true, opacity: 0.10 }));
    pad.rotation.x = -Math.PI / 2; pad.position.y = 0.015; g.add(pad);
    const ring = new T.Mesh(new T.RingGeometry(f * 0.48, f * 0.52, 28), new T.MeshBasicMaterial({ color: GHOST_COLOR, transparent: true, opacity: 0.5, side: T.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; g.add(ring);
    const post = new T.Mesh(new T.BoxGeometry(0.12, 1.5, 0.12), new T.MeshBasicMaterial({ color: GHOST_COLOR, transparent: true, opacity: 0.35 }));
    post.position.y = 0.75; g.add(post);
    return { group: g, glow: ring, ghost: true };
  }

  /* Swap in whatever this spot should currently look like. Called on mount, when
     a machine is built, and when an admin changes a model. */
  function dressSpot(rec) {
    const built = rec.kind === 'station' || isBuilt(st, rec.id);
    const wantGhost = !built;
    if (rec.node && rec.isGhost === wantGhost && !rec.needsRedress) return;
    if (rec.node) { rec.group.remove(rec.node); disposeNode(rec.node); }
    rec.needsRedress = false;
    const made = wantGhost ? ghostFor(rec.id) : buildModel(T, rec.id);
    rec.node = made.group; rec.glow = made.glow; rec.isGhost = wantGhost;
    rec.spin = made.group.userData && made.group.userData.spin;
    rec.piston = made.group.userData && made.group.userData.piston;
    rec.flare = made.group.userData && made.group.userData.flare;
    rec.group.add(rec.node);
    if (built) tryAdminModel(rec);
  }

  /* 🎨 ADMIN .GLB SWAP. Fail-open at every step: no override, a dead URL, a
     malformed file — all leave the procedural body standing. The shop's rule,
     and the reason an admin can experiment with assets on a live game. */
  function tryAdminModel(rec) {
    let ov = null;
    try { ov = overrideFor(h.forgeFoundry(), rec.id); } catch (e) { ov = null; }
    if (!ov || !h.loadModel) return;
    const token = (rec.token = (rec.token || 0) + 1);
    h.loadModel(ov.url).then(res => {
      if (!res || !res.scene || rec.token !== token || !rec.group.parent) return;
      // The override replaces the BODY, not the plinth-and-glow the state
      // readout drives — so a custom model still reads as running or broken.
      if (rec.node) { rec.group.remove(rec.node); disposeNode(rec.node); }
      const wrap = new T.Group();
      const body = res.scene;
      body.position.y = ov.y || 0;
      if (ov.ry !== null) body.rotation.y = ov.ry;
      body.scale.setScalar(ov.scale || 1);
      wrap.add(body);
      const base = buildModel(T, rec.id);
      // Keep only the glow strip from the procedural build so state still reads.
      if (base.glow) { base.glow.position.y = Math.max(0.2, base.glow.position.y); wrap.add(base.glow); rec.glow = base.glow; }
      rec.node = wrap; rec.spin = rec.piston = rec.flare = null;
      rec.group.add(wrap);
      try { if (h.autoplay && res.animations && res.animations.length) h.autoplay(body, res.animations, { alive: () => !!rec.group.parent, clip: ov.clip }); } catch (e) {}
    }, () => { /* fail-open: procedural body stays */ });
  }

  function disposeNode(n) {
    try {
      n.traverse(x => {
        // __cs3DKeep marks a cached GLTF template's geometry/materials — the
        // shared loader owns those and disposing them here would blank the
        // model everywhere else it is used.
        if (x.geometry && !x.geometry.__cs3DKeep && x.geometry.dispose) x.geometry.dispose();
        const ms = Array.isArray(x.material) ? x.material : (x.material ? [x.material] : []);
        ms.forEach(m => { if (m && !m.__cs3DKeep && m.dispose) m.dispose(); });
      });
    } catch (e) {}
  }

  spots.forEach(dressSpot);

  /* ── Input ─────────────────────────────────────────────────────────────── */
  const S = { yaw: SPAWN.yaw, pitch: 0, cyaw: SPAWN.yaw, cpitch: 0, move: {}, drag: null };
  if (o.resume && typeof o.resume.x === 'number') {
    camera.position.set(o.resume.x, EYE, o.resume.z);
    S.yaw = S.cyaw = o.resume.yaw || 0; S.pitch = S.cpitch = o.resume.pitch || 0;
  }

  const el = renderer.domElement;
  const KEY = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r' };
  let nearRec = null;

  function kd(e) {
    if (o.isTyping && o.isTyping()) return;   // never steal keys from a panel input
    const k = KEY[e.code];
    if (k) { S.move[k] = 1; e.preventDefault(); return; }
    if (e.code === 'KeyE' || e.code === 'Enter') { if (nearRec) { e.preventDefault(); interact(nearRec); } }
  }
  function ku(e) { const k = KEY[e.code]; if (k) S.move[k] = 0; }

  function lookStart(e) { const p = e.touches ? e.touches[0] : e; S.drag = { x: p.clientX, y: p.clientY }; el.style.cursor = 'grabbing'; }
  function lookMove(e) {
    if (!S.drag) return;
    const p = e.touches ? e.touches[0] : e;
    S.yaw -= (p.clientX - S.drag.x) * LOOK;
    S.pitch = Math.max(-1.2, Math.min(1.2, S.pitch - (p.clientY - S.drag.y) * LOOK));
    S.drag = { x: p.clientX, y: p.clientY };
  }
  function lookEnd() { S.drag = null; el.style.cursor = 'grab'; }

  el.addEventListener('pointerdown', lookStart);
  window.addEventListener('pointermove', lookMove);
  window.addEventListener('pointerup', lookEnd);
  el.addEventListener('touchstart', lookStart, { passive: true });
  window.addEventListener('touchmove', lookMove, { passive: true });
  window.addEventListener('touchend', lookEnd);
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);

  // On-screen thumb pad, so the floor is usable on a phone. Same contract the
  // card shop uses (data-fdy3d-move), wired by the caller's markup.
  mount.querySelectorAll('[data-fdy3d-move]').forEach(b => {
    const k = b.getAttribute('data-fdy3d-move');
    const on = e => { e.preventDefault(); S.move[k] = 1; };
    const off = e => { e.preventDefault(); S.move[k] = 0; };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off);
  });

  function interact(rec) { try { o.onInteract && o.onInteract(rec); } catch (e) {} }
  const promptEl = mount.querySelector('[data-fdy3d-prompt]');
  if (promptEl) promptEl.addEventListener('click', () => { if (nearRec) interact(nearRec); });

  function onResize() {
    W = mount.clientWidth || W; H = mount.clientHeight || H;
    camera.aspect = W / H; camera.updateProjectionMatrix(); renderer.setSize(W, H);
  }
  window.addEventListener('resize', onResize);

  /* ── Frame ─────────────────────────────────────────────────────────────── */
  let raf = 0, last = 0, tSec = 0, paused = false;

  function statusOf(rec) {
    if (rec.kind === 'station') return null;
    try { return machineStatus(st, rec.id); } catch (e) { return null; }
  }

  function tick(now) {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016); last = now; tSec += dt;

    /* 🔴 UNSTICK FIRST, EVERY FRAME, PAUSED OR NOT.
       You do not have to walk into a machine to end up inside one: stand on an
       empty pad and press Build, and the walkable ghost becomes a solid body
       around you. Collision alone then traps you for good — every candidate
       position is inside the box, so every move is refused. Running the ejection
       before movement means the trap lasts a single frame.
       It runs while paused too, because a build started from a pop-up completes
       with the panel still open; being freed only after you close it would look
       like the game had let you go as a favour. */
    for (const rec of spots) {
      if (rec.isGhost) continue;
      const out = pushOut(rec.id, rec.ry, camera.position.x, camera.position.z, rec.x, rec.z);
      if (out) { camera.position.x = out.x; camera.position.z = out.z; break; }
    }

    /* 🔴 PAUSED FREEZES INPUT, NOT THE FACTORY. An early cut returned early here
       and rendered a still frame behind the pop-up, which made the shed look
       switched off the moment you opened a panel — the exact "static" feeling
       the 3D mode exists to get rid of. The furnace should still flare and the
       drums still turn while you read a card, because the line really is still
       running. Only walking and the walk-up prompt stop. */
    if (!paused) {
    // Smoothed look — the exponential follow the card shop uses, which is what
    // stops a dragged phone from feeling jittery.
    const k = 1 - Math.exp(-dt * 14);
    S.cyaw += (S.yaw - S.cyaw) * k; S.cpitch += (S.pitch - S.cpitch) * k;
    camera.rotation.y = S.cyaw; camera.rotation.x = S.cpitch;

    const fwd = new T.Vector3(-Math.sin(S.cyaw), 0, -Math.cos(S.cyaw));
    const right = new T.Vector3(Math.cos(S.cyaw), 0, -Math.sin(S.cyaw));
    const dir = new T.Vector3();
    if (S.move.f) dir.add(fwd); if (S.move.b) dir.sub(fwd);
    if (S.move.r) dir.add(right); if (S.move.l) dir.sub(right);
    if (dir.lengthSq() > 0) {
      dir.normalize().multiplyScalar(WALK * dt);
      const nx = camera.position.x + dir.x, nz = camera.position.z + dir.z;
      // Circle collision per spot, then the walls. Resolving each axis
      // separately lets the player slide along a machine instead of sticking.
      const free = (px, pz) => {
        for (const rec of spots) {
          if (rec.isGhost) continue;                    // walk over an empty pad
          if (blocks(rec.id, rec.ry, px, pz, rec.x, rec.z)) return false;
        }
        return Math.abs(px) < FLOOR.w / 2 - 0.6 && Math.abs(pz) < FLOOR.d / 2 - 0.6;
      };
      if (free(nx, camera.position.z)) camera.position.x = nx;
      if (free(camera.position.x, nz)) camera.position.z = nz;
    }

    } // ── end input/movement; everything below runs even while paused ──

    // Nearest interactable, and the state-driven look of every spot.
    let best = null, bestD = Infinity;
    for (const rec of spots) {
      const dx = camera.position.x - rec.x, dz = camera.position.z - rec.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < rec.ir * rec.ir && d2 < bestD) { bestD = d2; best = rec; }

      const s = statusOf(rec);
      let look;
      if (rec.isGhost) look = { hex: GHOST_COLOR, pulse: 0.35, run: false };
      else if (rec.kind === 'station') look = { hex: 0x9fb4d8, pulse: 0.06, run: false };
      else if (!s) look = OFF_COLOR;
      else if (!s.on) look = OFF_COLOR;
      else look = STATE_COLOR[s.halt] || OFF_COLOR;

      if (rec.glow && rec.glow.material) {
        const m = rec.glow.material;
        const puls = look.pulse ? (0.72 + look.pulse * Math.sin(tSec * (look.hex === 0xff5a5a ? 7 : 2.4) + rec.x)) : 0.75;
        /* 🔴 DRIVE EMISSIVE **OR** COLOUR, NEVER BOTH. Setting both on a
           MeshStandardMaterial turns the panel into a lit surface AND a light
           source: the station signs came out as blown-out white slabs that read
           as rendering errors rather than as signage. Emissive alone gives the
           glow; the base colour stays the dark material it was modelled with.
           Only the ghost rings (MeshBasicMaterial, no emissive) take colour. */
        if (m.emissive) { m.emissive.copy(srgb(T, look.hex)); m.emissiveIntensity = puls * (rec.kind === 'station' ? 0.5 : 1.35); }
        else if (m.color) m.color.copy(srgb(T, look.hex));
        if (m.opacity !== undefined && rec.isGhost) m.opacity = 0.35 + 0.25 * Math.sin(tSec * 2);
      }
      // Moving parts only move when the machine is actually producing. A
      // spinning drum on a starved shredder would contradict its own card.
      if (look.run) {
        const sp = s ? Math.max(0.25, s.speed || 1) : 1;
        if (rec.spin) rec.spin.rotation.x += dt * 3.4 * sp;
        if (rec.piston) rec.piston.position.y = 2.9 - 0.42 * (0.5 + 0.5 * Math.sin(tSec * 3.1 * sp));
        if (rec.flare && rec.flare.material) rec.flare.material.emissiveIntensity = 1.2 + 0.9 * Math.sin(tSec * 5.5);
      }
    }

    if (paused) { /* prompt is frozen while a panel is open */ }
    else if (best !== nearRec) {
      nearRec = best;
      try { o.onNear && o.onNear(nearRec, nearRec ? statusOf(nearRec) : null); } catch (e) {}
    } else if (nearRec) {
      // Re-report periodically so the prompt's live numbers (condition, halt)
      // stay current while the player stands still.
      if (!tick._t || now - tick._t > 900) { tick._t = now; try { o.onNear && o.onNear(nearRec, statusOf(nearRec)); } catch (e) {} }
    }

    try { if (o.onMove) o.onMove({ x: camera.position.x, z: camera.position.z, yaw: S.cyaw, pitch: S.cpitch }); } catch (e) {}
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(tick);

  return {
    /* Called after any action that could change what a machine looks like —
       a build, an upgrade, a recipe change, a repair. */
    refresh() { spots.forEach(r => { const wasGhost = r.isGhost; dressSpot(r); if (wasGhost && !r.isGhost) tryAdminModel(r); }); },
    /* An admin changed a model — force this one spot to re-dress from scratch. */
    remodel(id) { const r = spots.find(x => x.id === id); if (r) { r.needsRedress = true; dressSpot(r); } },
    setPaused(v) { paused = !!v; S.move = {}; },
    near() { return nearRec; },
    camera() { return { x: camera.position.x, z: camera.position.z, yaw: S.cyaw, pitch: S.cpitch }; },
    dispose() {
      try { cancelAnimationFrame(raf); } catch (e) {}
      window.removeEventListener('pointermove', lookMove); window.removeEventListener('pointerup', lookEnd);
      window.removeEventListener('touchmove', lookMove); window.removeEventListener('touchend', lookEnd);
      window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku);
      window.removeEventListener('resize', onResize);
      try { spots.forEach(r => { if (r.node) disposeNode(r.node); }); } catch (e) {}
      try { scene.traverse(x => { if (x.geometry && !x.geometry.__cs3DKeep && x.geometry.dispose) x.geometry.dispose(); }); } catch (e) {}
      try { renderer.dispose(); } catch (e) {}
      try { if (renderer.domElement && renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement); } catch (e) {}
    },
  };
}

export default { createWorld };
