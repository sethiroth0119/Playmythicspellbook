/* ══════════════════════════════════════════════════════════════════════════
   🎬 SCENE — the containment lab, in three.js.
   ──────────────────────────────────────────────────────────────────────────
   🔴 IT REUSES THE LEGACY GLOBAL `window.THREE` (r128 from cdnjs), NOT the
   `three` import-map entry. index.html carries BOTH: an import map pointing at
   the 0.171 WebGPU build for /sprite-live, and a lazily-injected r128 global
   for the VFX, the battlemap and the pack opener. This file is loaded as a
   classic module from index.html AND could be opened from the city page, and
   only the global is reachable from both. `ensureThree()` is a copy of
   index.html's `_vfxEnsureThree` for exactly that reason — do not "modernise"
   it to a bare `import * as THREE from 'three'` unless you have checked every
   page that mounts this.

   🔴 IT MUST BE ABLE TO FAIL. `build()` returns null if WebGL is unavailable
   or the CDN is blocked, and index.js falls back to the 2D bench (see
   `open({ flat: true })`). A player on a locked-down device or an old phone
   still gets the whole cure/ship/outbreak loop; what they lose is the room.
   The 3D layer is the presentation of a feature, never the feature.

   ⚠ THE BROWSER PANE IN THIS ENVIRONMENT DOES NOT COMPOSITE (CLAUDE.md):
   requestAnimationFrame never fires, so `frame(dt)` is exported and driven by
   index.js's loop rather than being a closed-over RAF callback. A driver can
   step the scene by hand.
   ══════════════════════════════════════════════════════════════════════════ */

import { ROOM, HOT_Z, STATIONS } from './stations.js';

export function ensureThree() {
  return new Promise((resolve) => {
    try {
      if (window.THREE) { resolve(window.THREE); return; }
      if (window.__vfxThreeLoading) {
        const iv = setInterval(() => { if (window.THREE) { clearInterval(iv); resolve(window.THREE); } }, 120);
        setTimeout(() => { clearInterval(iv); resolve(window.THREE || null); }, 9000);
        return;
      }
      window.__vfxThreeLoading = true;
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
      s.onload = () => resolve(window.THREE || null);
      s.onerror = () => resolve(null);
      document.head.appendChild(s);
    } catch (e) { resolve(null); }
  });
}

const COL = {
  floorClean: 0x1c2430,
  floorHot: 0x2a1d24,
  wall: 0x141a23,
  trim: 0x2e3a4a,
  hazard: 0xd8a13a,
  glass: 0x7fd6ff,
};

/* One shared material cache. A station is a handful of boxes and there are six
   of them; building fresh materials per mesh would be forty draw-call state
   changes for a room that should be one. */
function mats(THREE) {
  const m = (c, o) => new THREE.MeshLambertMaterial(Object.assign({ color: c }, o || {}));
  return {
    floorClean: m(COL.floorClean),
    floorHot: m(COL.floorHot),
    wall: m(COL.wall),
    trim: m(COL.trim),
    hazard: m(COL.hazard),
    glass: new THREE.MeshLambertMaterial({ color: COL.glass, transparent: true, opacity: 0.22 }),
    suitOff: m(0xd8dce4),
    suitOn: m(0xffd166),
    visor: m(0x1a2430),
  };
}

function box(THREE, mat, w, h, d, x, y, z) {
  const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  g.position.set(x, y, z);
  return g;
}

/* ── the player avatar ─────────────────────────────────────────────────────
   Six boxes. It is deliberately crude and deliberately READABLE from the
   isometric camera: the whole job of this model is to answer "am I wearing
   the suit" at a glance, from thirty metres up, on a phone. The suit is a
   COLOUR CHANGE plus a visor, because a silhouette change would not survive
   that camera and a particle effect would not survive a mid-range GPU. */
function makeAvatar(THREE, M) {
  const g = new THREE.Group();
  const body = box(THREE, M.suitOff, 0.62, 0.92, 0.38, 0, 0.92, 0);
  const head = box(THREE, M.suitOff, 0.40, 0.38, 0.36, 0, 1.58, 0);
  const visor = box(THREE, M.visor, 0.30, 0.16, 0.04, 0, 1.60, 0.19);
  const armL = box(THREE, M.suitOff, 0.16, 0.72, 0.18, -0.40, 0.96, 0);
  const armR = box(THREE, M.suitOff, 0.16, 0.72, 0.18, 0.40, 0.96, 0);
  const legL = box(THREE, M.suitOff, 0.22, 0.86, 0.24, -0.16, 0.43, 0);
  const legR = box(THREE, M.suitOff, 0.22, 0.86, 0.24, 0.16, 0.43, 0);
  visor.visible = false;
  g.add(body, head, visor, armL, armR, legL, legR);
  g.userData = { body, head, visor, armL, armR, legL, legR };
  return g;
}

export function build(THREE, canvas) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  } catch (e) { return null; }
  if (!renderer) return null;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e14);
  scene.fog = new THREE.Fog(0x0a0e14, 26, 52);

  const M = mats(THREE);

  // ── lighting. Cheap and flat: a hemisphere for the room, one key for shape,
  //    and a sickly green fill over the hot zone so the two halves of the room
  //    read differently even in a screenshot.
  scene.add(new THREE.HemisphereLight(0xbcd0ea, 0x161c26, 0.95));
  const key = new THREE.DirectionalLight(0xffffff, 0.55);
  key.position.set(8, 18, -6);
  scene.add(key);
  const hotFill = new THREE.PointLight(0x7fe0a0, 0.8, 30);
  hotFill.position.set(0, 5, 8);
  scene.add(hotFill);

  // ── floor, in two slabs so the hot/clean line is geometry, not a texture.
  const cleanD = (ROOM.d / 2) + HOT_Z;
  const hotD = ROOM.d - cleanD;
  scene.add(box(THREE, M.floorClean, ROOM.w, 0.2, cleanD, 0, -0.1, -ROOM.d / 2 + cleanD / 2));
  scene.add(box(THREE, M.floorHot, ROOM.w, 0.2, hotD, 0, -0.1, HOT_Z + hotD / 2));

  // The hazard stripe ON the boundary. This is the single most important line
  // in the room and it is painted, raised and lit so it cannot be missed.
  const stripe = box(THREE, M.hazard, ROOM.w, 0.06, 0.5, 0, 0.02, HOT_Z);
  scene.add(stripe);

  // ── walls
  const wh = ROOM.h;
  scene.add(box(THREE, M.wall, ROOM.w, wh, 0.4, 0, wh / 2, ROOM.d / 2));
  scene.add(box(THREE, M.wall, 0.4, wh, ROOM.d, -ROOM.w / 2, wh / 2, 0));
  scene.add(box(THREE, M.wall, 0.4, wh, ROOM.d, ROOM.w / 2, wh / 2, 0));
  // The airlock end: two stubs with a gap, so the entrance reads as a door.
  const stub = (ROOM.w - 5.2) / 2;
  scene.add(box(THREE, M.wall, stub, wh, 0.4, -(ROOM.w / 2) + stub / 2, wh / 2, -ROOM.d / 2));
  scene.add(box(THREE, M.wall, stub, wh, 0.4, (ROOM.w / 2) - stub / 2, wh / 2, -ROOM.d / 2));

  // A glass partition across the hot line, with the same 5.2m gap the airlock
  // has — you can SEE the hot zone from the clean side, which is what makes
  // walking into it a choice rather than an accident.
  const pw = (ROOM.w - 5.2) / 2;
  scene.add(box(THREE, M.glass, pw, 3.0, 0.16, -(ROOM.w / 2) + pw / 2, 1.5, HOT_Z));
  scene.add(box(THREE, M.glass, pw, 3.0, 0.16, (ROOM.w / 2) - pw / 2, 1.5, HOT_Z));

  // ── stations
  const stationMeshes = {};
  for (const s of STATIONS) {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: s.color });
    const [w, d] = s.size;
    if (s.key === 'suitup') {
      // The airlock is a frame you stand inside, not a bench.
      g.add(box(THREE, M.trim, w, 0.14, d, 0, 0.07, 0));
      g.add(box(THREE, mat, 0.3, 3.0, 0.3, -w / 2, 1.5, 0));
      g.add(box(THREE, mat, 0.3, 3.0, 0.3, w / 2, 1.5, 0));
      g.add(box(THREE, mat, w, 0.3, 0.3, 0, 3.0, 0));
      // Four seal lamps across the lintel — the suit's progress, in the world.
      const lamps = [];
      for (let i = 0; i < 4; i++) {
        const l = box(THREE, new THREE.MeshBasicMaterial({ color: 0x3a4250 }), 0.34, 0.2, 0.16,
          -w / 2 + 0.9 + i * ((w - 1.8) / 3), 2.62, 0.2);
        lamps.push(l); g.add(l);
      }
      g.userData.lamps = lamps;
    } else {
      g.add(box(THREE, M.trim, w, 0.9, d, 0, 0.45, 0));            // cabinet
      g.add(box(THREE, mat, w * 0.98, 0.12, d * 0.98, 0, 0.96, 0)); // worktop
      // A machine on top, sized off the bench so every station looks different
      // without a single bespoke model.
      g.add(box(THREE, mat, Math.min(1.4, w * 0.4), 0.9, Math.min(1.2, d * 0.6), 0, 1.47, 0));
    }
    g.position.set(s.pos[0], 0, s.pos[1]);
    // A ring on the floor marking the interaction radius. Players should never
    // have to guess how close "close enough" is.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(Math.max(w, d) / 2 + 1.2, Math.max(w, d) / 2 + 1.45, 28),
      new THREE.MeshBasicMaterial({ color: s.color, transparent: true, opacity: 0.28, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.pos[0], 0.03, s.pos[1]);
    scene.add(ring);
    scene.add(g);
    stationMeshes[s.key] = { group: g, ring, mat };
  }

  const avatar = makeAvatar(THREE, M);
  scene.add(avatar);

  /* ── camera. Fixed isometric-ish follow, no orbit control on purpose: the
     room has one readable angle and letting a player rotate into a wall is a
     bug report waiting to happen. It LERPS toward the player rather than
     tracking exactly, which hides the collision resolver's tiny corrections. */
  const cam = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 200);
  const camOff = new THREE.Vector3(0, 15.5, -13.5);
  cam.position.set(camOff.x, camOff.y, camOff.z);

  const api = {
    THREE, renderer, scene, camera: cam, avatar, stations: stationMeshes, mats: M,
    resize() {
      try {
        renderer.setSize(window.innerWidth, window.innerHeight, false);
        cam.aspect = window.innerWidth / Math.max(1, window.innerHeight);
        cam.updateProjectionMatrix();
      } catch (e) {}
    },
    /* Drive one frame. `st` is the whole run state — the scene reads it and
       never writes to it, so the simulation stays the single source of truth
       and this file can be deleted without taking the game with it. */
    frame(dt, st) {
      const p = st.player;
      avatar.position.set(p.x, 0, p.z);
      avatar.rotation.y = p.facing;

      // Walk bob + arm swing. Cheap, and it is the difference between a box
      // sliding and a person walking.
      const sw = p.moving ? Math.sin(p.bob) * 0.5 : 0;
      const u = avatar.userData;
      u.armL.rotation.x = sw; u.armR.rotation.x = -sw;
      u.legL.rotation.x = -sw * 0.8; u.legR.rotation.x = sw * 0.8;
      avatar.position.y = p.moving ? Math.abs(Math.sin(p.bob)) * 0.06 : 0;

      // The suit, made visible. This is the readout the whole minigame turns on.
      const sealed = !!(st.suit && st.suit.sealed);
      const partial = st.suit ? Object.keys(st.suit.seals || {}).length : 0;
      const suitMat = sealed ? M.suitOn : M.suitOff;
      u.body.material = partial >= 2 ? suitMat : M.suitOff;
      u.legL.material = u.legR.material = partial >= 1 ? suitMat : M.suitOff;
      u.armL.material = u.armR.material = partial >= 3 ? suitMat : M.suitOff;
      u.head.material = sealed ? suitMat : M.suitOff;
      u.visor.visible = sealed;

      // Airlock seal lamps.
      try {
        const lamps = (stationMeshes.suitup && stationMeshes.suitup.group.userData.lamps) || [];
        const order = ['legs', 'torso', 'gloves', 'hood'];
        for (let i = 0; i < lamps.length; i++) {
          const on = !!(st.suit && st.suit.seals && st.suit.seals[order[i]]);
          lamps[i].material.color.setHex(on ? 0x86e08a : 0x3a4250);
        }
      } catch (e) {}

      // Highlight the station in reach.
      for (const k of Object.keys(stationMeshes)) {
        const sm = stationMeshes[k];
        const near = st.near && st.near.station && st.near.station.key === k;
        sm.ring.material.opacity = near ? 0.75 : 0.24;
        sm.ring.scale.setScalar(near ? 1.04 : 1);
      }

      // Hot-zone warning: the fill light pulses red while the player is in the
      // hot zone unsuited. It is peripheral, constant, and impossible to
      // misread as anything but "get out or suit up".
      const danger = st.suit && st.suit.inHot && !sealed;
      hotFill.color.setHex(danger ? 0xff4d5e : 0x7fe0a0);
      hotFill.intensity = danger ? 1.1 + Math.sin(Date.now() / 140) * 0.5 : 0.8;
      stripe.material.color.setHex(danger ? 0xff4d5e : COL.hazard);

      // Camera follow.
      const want = { x: p.x * 0.35 + camOff.x, y: camOff.y, z: p.z + camOff.z };
      const k2 = 1 - Math.pow(0.0025, Math.max(0, dt) / 1000);
      cam.position.x += (want.x - cam.position.x) * k2;
      cam.position.y += (want.y - cam.position.y) * k2;
      cam.position.z += (want.z - cam.position.z) * k2;
      cam.lookAt(p.x * 0.5, 1.1, p.z + 2.5);

      renderer.render(scene, cam);
    },
    dispose() {
      try {
        scene.traverse((o) => {
          if (o.geometry) { try { o.geometry.dispose(); } catch (e) {} }
          if (o.material) {
            const list = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of list) { try { m.dispose(); } catch (e) {} }
          }
        });
        renderer.dispose();
        /* 🔴 forceContextLoss IS NOT OPTIONAL. Browsers cap live WebGL contexts
           (16 or so); opening and closing this lab twenty times without it
           kills the game's OTHER canvases — the battle board and the pack
           opener — and the report reads as "the board went black", nowhere
           near this file. */
        try { renderer.forceContextLoss(); } catch (e) {}
      } catch (e) {}
    },
  };
  return api;
}
