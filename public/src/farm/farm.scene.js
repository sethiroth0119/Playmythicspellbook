/* ════════════════════════════════════════════════════════════════════════════
   🐄 HOMESTEAD FARM — the 3D homestead (three.js) with a 2D canvas fallback.
   ----------------------------------------------------------------------------
   Low-poly, no assets: every building and animal is boxes, so the scene has
   nothing to download beyond three.js itself. three.js is fetched the same
   way the combat VFX rig fetches it (cdnjs r128 → window.THREE) so the two
   share one cached copy; if that fetch fails (offline, blocked CDN) the farm
   still works on a top-down 2D canvas — the game must degrade, never break.

   ⚠ THE BROWSER PANE DOES NOT COMPOSITE (CLAUDE.md): requestAnimationFrame
     never fires there and canvas rects read 0×0. The loop below is RAF-driven
     and the fallback timer exists for that environment, not for production.

   Contract: createScene(container, { onSelect(kind, id) }) → { update(view), destroy() }
     view = { pens: [...], animals: [...], buildings: {...} } (state.summary()).
   ════════════════════════════════════════════════════════════════════════════ */

import { FARM_ANIMALS, FARM_BUILDINGS, FARM_GRID, animalDef } from './farm.data.js';
import { FARM_ECON } from './farm.data.js';

const THREE_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';

function ensureThree() {
  return new Promise((resolve) => {
    try {
      if (window.THREE) return resolve(window.THREE);
      if (window.__farmThreeLoading || window.__vfxThreeLoading) {
        const iv = setInterval(() => { if (window.THREE) { clearInterval(iv); resolve(window.THREE); } }, 120);
        setTimeout(() => { clearInterval(iv); resolve(window.THREE || null); }, 9000);
        return;
      }
      window.__farmThreeLoading = true;
      const s = document.createElement('script');
      s.src = THREE_SRC;
      s.onload = () => resolve(window.THREE || null);
      s.onerror = () => resolve(null);
      document.head.appendChild(s);
    } catch (e) { resolve(null); }
  });
}

/* Seeded per-animal wander so a reload does not teleport the herd. */
function hash(n) { let x = (n | 0) * 2654435761 >>> 0; x ^= x >>> 13; x = Math.imul(x, 0x5bd1e995) >>> 0; return (x ^ (x >>> 15)) >>> 0; }
function rnd01(seed) { return (hash(seed) % 10000) / 10000; }

function yardOf(def) { return def.yard || def.plot; }
function tileToWorld(gx, gy) { return { x: gx - FARM_GRID.w / 2, z: gy - FARM_GRID.h / 2 }; }

/* ── Animal wander model (shared by 3D and 2D) ─────────────────────────────── */
class Wanderer {
  constructor(a, yard) {
    this.a = a; this.yard = yard;
    this.x = yard.x + 0.5 + rnd01(a.id * 7 + 1) * (yard.w - 1);
    this.z = yard.y + 0.5 + rnd01(a.id * 7 + 2) * (yard.h - 1);
    this.tx = this.x; this.tz = this.z; this.rot = rnd01(a.id) * Math.PI * 2;
    this.wait = rnd01(a.id * 3) * 3; this.phase = rnd01(a.id * 5) * 6.28; this.speed = 0.35 + rnd01(a.id * 11) * 0.3;
  }
  step(dt) {
    this.phase += dt * 6;
    if (this.wait > 0) { this.wait -= dt; return false; }
    const dx = this.tx - this.x, dz = this.tz - this.z, d = Math.hypot(dx, dz);
    if (d < 0.05) {
      this.wait = 1 + Math.random() * 4;
      this.tx = this.yard.x + 0.4 + Math.random() * (this.yard.w - 0.8);
      this.tz = this.yard.y + 0.4 + Math.random() * (this.yard.h - 0.8);
      return false;
    }
    const v = Math.min(d, this.speed * dt);
    this.x += dx / d * v; this.z += dz / d * v;
    const want = Math.atan2(dx, dz);
    let diff = want - this.rot; while (diff > Math.PI) diff -= 6.283; while (diff < -Math.PI) diff += 6.283;
    this.rot += diff * Math.min(1, dt * 6);
    return true;
  }
}

/* ══════════════════════════ 3D ══════════════════════════ */
function build3D(THREE, container, opts) {
  const W = () => Math.max(1, container.clientWidth), Hh = () => Math.max(1, container.clientHeight);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(W(), Hh());
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  const cv = renderer.domElement;
  cv.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;cursor:grab';
  container.appendChild(cv);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a2233);
  scene.fog = new THREE.Fog(0x1a2233, 22, 48);
  const camera = new THREE.PerspectiveCamera(46, W() / Hh(), 0.1, 200);
  const orbit = { theta: 0.65, phi: 0.95, dist: 21, cx: 0, cz: 0.6 };
  const placeCamera = () => {
    camera.position.set(
      orbit.cx + orbit.dist * Math.sin(orbit.phi) * Math.sin(orbit.theta),
      orbit.dist * Math.cos(orbit.phi),
      orbit.cz + orbit.dist * Math.sin(orbit.phi) * Math.cos(orbit.theta));
    camera.lookAt(orbit.cx, 0, orbit.cz);
  };
  placeCamera();

  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a4a2a, 0.9));
  const sun = new THREE.DirectionalLight(0xfff0d0, 1.15);
  sun.position.set(9, 16, 6); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -12; sun.shadow.camera.right = 12; sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12;
  scene.add(sun);

  const M = (c, o) => new THREE.MeshLambertMaterial(Object.assign({ color: c }, o || {}));
  const box = (w, h, d, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.castShadow = true; m.receiveShadow = true; return m; };

  // Ground: a checker of two greens so the tile grid reads without lines.
  const ground = new THREE.Group();
  const gA = M(0x4f7a3a), gB = M(0x55823f);
  for (let y = 0; y < FARM_GRID.h; y++) for (let x = 0; x < FARM_GRID.w; x++) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 1), ((x + y) & 1) ? gA : gB);
    const p = tileToWorld(x + 0.5, y + 0.5); t.position.set(p.x, -0.1, p.z); t.receiveShadow = true; ground.add(t);
  }
  // Rim of dirt so the plot reads as a place, not a floating tile.
  const rim = new THREE.Mesh(new THREE.BoxGeometry(FARM_GRID.w + 2, 0.18, FARM_GRID.h + 2), M(0x6b4f34));
  rim.position.y = -0.21; rim.receiveShadow = true; ground.add(rim);
  scene.add(ground);

  const pickables = [];
  const buildingNodes = {};   // defId → { group, ghost, built }
  const animalNodes = {};     // animalId → { group, w, legs[] , sp }

  /* Canvas-texture label: emoji + name, always facing the camera. */
  const labelSprite = (text, sub, color) => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 160;
    const x = c.getContext('2d');
    x.fillStyle = 'rgba(8,10,16,0.72)'; x.beginPath(); x.roundRect ? x.roundRect(6, 6, 628, 148, 24) : x.rect(6, 6, 628, 148); x.fill();
    x.strokeStyle = color || '#d4af37'; x.lineWidth = 6; x.stroke();
    // Shrink-to-fit: "Butcher's Block" and "Fenced Pasture" clipped at a fixed size.
    const fit = (str, px, max) => { x.font = 'bold ' + px + 'px system-ui, sans-serif'; while (px > 22 && x.measureText(str).width > max) { px -= 2; x.font = 'bold ' + px + 'px system-ui, sans-serif'; } };
    x.fillStyle = '#f4efe4'; x.textAlign = 'center'; fit(text, 54, 590);
    x.fillText(text, 320, 70);
    if (sub) { x.fillStyle = '#c9c3b6'; x.font = '36px system-ui, sans-serif'; while (x.measureText(sub).width > 590) { x.font = (parseInt(x.font, 10) - 2) + 'px system-ui, sans-serif'; } x.fillText(sub, 320, 124); }
    const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(2.2, 0.55, 1);
    return sp;
  };

  const makeBuilding = (def, level) => {
    const g = new THREE.Group();
    const w = def.plot.w, d = def.plot.h, accent = new THREE.Color(def.accent);
    const wall = M(0xb99a6b), roof = M(accent.getHex()), trim = M(0x3a2f26);
    const hgt = 0.9 + 0.25 * level;
    if (def.id === 'pasture') {
      // A pasture is a gate + a hay pile, not a house.
      const hay = box(1.2, 0.6, 1.0, M(0xd9c46a)); hay.position.set(0, 0.3, 0); g.add(hay);
      const post = box(0.12, 1.1, 0.12, trim); post.position.set(-w / 2 + 0.3, 0.55, 0); g.add(post);
      const post2 = post.clone(); post2.position.x = w / 2 - 0.3; g.add(post2);
      const bar = box(w - 0.6, 0.1, 0.1, trim); bar.position.set(0, 0.9, 0); g.add(bar);
    } else {
      const body = box(w - 0.3, hgt, d - 0.3, wall); body.position.y = hgt / 2; g.add(body);
      const rf = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.62, 0.7 + 0.15 * level, 4), roof);
      rf.rotation.y = Math.PI / 4; rf.position.y = hgt + 0.35 + 0.075 * level; rf.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d));
      rf.castShadow = true; g.add(rf);
      const door = box(0.4, 0.55, 0.06, trim); door.position.set(0, 0.28, d / 2 - 0.13); g.add(door);
      if (def.station) { const chimney = box(0.22, 0.6, 0.22, trim); chimney.position.set(w / 2 - 0.5, hgt + 0.5, -d / 4); g.add(chimney); }
    }
    for (let i = 0; i < level - 1; i++) { const star = box(0.16, 0.16, 0.16, M(0xd4af37)); star.position.set(-w / 2 + 0.35 + i * 0.3, hgt + 0.05, d / 2 - 0.1); g.add(star); }
    const lab = labelSprite(def.emoji + ' ' + def.name, 'Level ' + level, def.accent); lab.position.y = hgt + 1.35; g.add(lab);
    g.traverse(o => { if (o.isMesh) { o.userData.pick = { kind: 'building', id: def.id }; pickables.push(o); } });
    return g;
  };
  const makeGhost = (def) => {
    const g = new THREE.Group();
    const plate = new THREE.Mesh(new THREE.BoxGeometry(def.plot.w - 0.2, 0.06, def.plot.h - 0.2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(def.accent), transparent: true, opacity: 0.28 }));
    plate.position.y = 0.04; g.add(plate);
    const sign = box(0.08, 0.7, 0.08, M(0x3a2f26)); sign.position.set(0, 0.35, 0); g.add(sign);
    const lab = labelSprite(def.emoji + ' ' + def.name, 'Not built — tap to build', def.accent); lab.position.y = 1.2; lab.material.opacity = 0.85; g.add(lab);
    g.traverse(o => { if (o.isMesh) { o.userData.pick = { kind: 'building', id: def.id }; pickables.push(o); } });
    return g;
  };
  const fence = (yard, color) => {
    const g = new THREE.Group(); const mat = M(color || 0x7a5a3a);
    const step = 1, post = () => box(0.1, 0.55, 0.1, mat);
    const along = (x0, z0, x1, z1) => {
      const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / step));
      for (let i = 0; i <= n; i++) { const p = post(); p.position.set(x0 + (x1 - x0) * i / n, 0.27, z0 + (z1 - z0) * i / n); g.add(p); }
      const rail = box(Math.abs(x1 - x0) || 0.08, 0.06, Math.abs(z1 - z0) || 0.08, mat); rail.position.set((x0 + x1) / 2, 0.42, (z0 + z1) / 2); g.add(rail);
      const rail2 = rail.clone(); rail2.position.y = 0.2; g.add(rail2);
    };
    const a = tileToWorld(yard.x, yard.y), b = tileToWorld(yard.x + yard.w, yard.y + yard.h);
    along(a.x, a.z, b.x, a.z); along(b.x, a.z, b.x, b.z); along(b.x, b.z, a.x, b.z); along(a.x, b.z, a.x, a.z);
    return g;
  };

  /* Animals: one recipe per species, all from boxes, all pickable. */
  const makeAnimal = (a) => {
    const def = animalDef(a.sp), c = def.colors, s = def.size;
    const g = new THREE.Group(); const legs = [];
    const bodyM = M(c.body), headM = M(c.head), accM = M(c.accent), legM = M(c.legs);
    const leg = (x, z, h) => { const l = box(0.14 * s, h, 0.14 * s, legM); l.position.set(x, h / 2, z); g.add(l); legs.push(l); return l; };
    if (a.sp === 'chicken') {
      const body = box(0.42 * s, 0.34 * s, 0.5 * s, bodyM); body.position.y = 0.34 * s; g.add(body);
      const head = box(0.22 * s, 0.24 * s, 0.22 * s, headM); head.position.set(0, 0.62 * s, 0.26 * s); g.add(head);
      const comb = box(0.06 * s, 0.12 * s, 0.16 * s, accM); comb.position.set(0, 0.78 * s, 0.26 * s); g.add(comb);
      const beak = box(0.08 * s, 0.06 * s, 0.1 * s, M(0xe0a13c)); beak.position.set(0, 0.6 * s, 0.4 * s); g.add(beak);
      const tail = box(0.2 * s, 0.24 * s, 0.1 * s, bodyM); tail.position.set(0, 0.5 * s, -0.28 * s); g.add(tail);
      leg(-0.1 * s, 0, 0.18 * s); leg(0.1 * s, 0, 0.18 * s);
    } else if (a.sp === 'sheep') {
      const body = box(0.62 * s, 0.5 * s, 0.9 * s, bodyM); body.position.y = 0.55 * s; g.add(body);
      const head = box(0.26 * s, 0.28 * s, 0.32 * s, headM); head.position.set(0, 0.62 * s, 0.55 * s); g.add(head);
      const fluff = box(0.34 * s, 0.14 * s, 0.24 * s, bodyM); fluff.position.set(0, 0.8 * s, 0.55 * s); g.add(fluff);
      [-0.2, 0.2].forEach(x => [-0.3, 0.3].forEach(z => leg(x * s, z * s, 0.32 * s)));
    } else {
      const bw = (a.sp === 'cow' ? 0.6 : 0.5) * s, bh = (a.sp === 'cow' ? 0.6 : 0.45) * s, bl = (a.sp === 'cow' ? 1.15 : 0.95) * s, lh = (a.sp === 'pig' ? 0.22 : 0.42) * s;
      const body = box(bw, bh, bl, bodyM); body.position.y = lh + bh / 2; g.add(body);
      const head = box(bw * 0.6, bh * 0.65, bw * 0.6, headM); head.position.set(0, lh + bh * 0.75, bl / 2 + bw * 0.2); g.add(head);
      if (a.sp === 'cow') {
        const spot = box(bw * 0.5, bh * 0.4, bl * 0.35, accM); spot.position.set(bw * 0.26, lh + bh * 0.6, -bl * 0.15); g.add(spot);
        const spot2 = box(bw * 0.4, bh * 0.35, bl * 0.25, accM); spot2.position.set(-bw * 0.3, lh + bh * 0.45, bl * 0.2); g.add(spot2);
        const horn = box(0.05 * s, 0.05 * s, 0.16 * s, M(0xe8dcc0)); horn.rotation.x = -0.6; horn.position.set(bw * 0.28, lh + bh * 1.05, bl / 2 + bw * 0.1); g.add(horn);
        const horn2 = horn.clone(); horn2.position.x = -bw * 0.28; g.add(horn2);
        const nose = box(bw * 0.62, bh * 0.28, 0.1 * s, M(0xe0a8a8)); nose.position.set(0, lh + bh * 0.6, bl / 2 + bw * 0.5); g.add(nose);
      } else if (a.sp === 'pig') {
        const snout = box(bw * 0.3, bh * 0.25, 0.1 * s, accM); snout.position.set(0, lh + bh * 0.7, bl / 2 + bw * 0.5); g.add(snout);
        const ear = box(0.1 * s, 0.14 * s, 0.05 * s, accM); ear.position.set(bw * 0.25, lh + bh * 1.05, bl / 2); g.add(ear);
        const ear2 = ear.clone(); ear2.position.x = -bw * 0.25; g.add(ear2);
      } else if (a.sp === 'goat') {
        const horn = box(0.05 * s, 0.24 * s, 0.05 * s, accM); horn.rotation.x = 0.5; horn.position.set(bw * 0.2, lh + bh * 1.15, bl / 2); g.add(horn);
        const horn2 = horn.clone(); horn2.position.x = -bw * 0.2; g.add(horn2);
        const beard = box(0.08 * s, 0.14 * s, 0.06 * s, accM); beard.position.set(0, lh + bh * 0.4, bl / 2 + bw * 0.45); g.add(beard);
      }
      [-0.33, 0.33].forEach(x => [-0.36, 0.36].forEach(z => leg(x * bw, z * bl, lh)));
    }
    g.traverse(o => { if (o.isMesh) { o.userData.pick = { kind: 'animal', id: a.sp }; pickables.push(o); } });
    return { group: g, legs };
  };

  const yards = new THREE.Group(); scene.add(yards);
  const buildings = new THREE.Group(); scene.add(buildings);
  const herd = new THREE.Group(); scene.add(herd);

  let view = null, selected = null, selectRing = null;
  const unpick = (root) => root.traverse(o => { const i = pickables.indexOf(o); if (i >= 0) pickables.splice(i, 1); });

  function update(v) {
    view = v;
    FARM_BUILDINGS.forEach(def => {
      const row = v.buildings[def.id], lv = row ? row.level : 0;
      const cur = buildingNodes[def.id];
      if (cur && cur.level === lv) return;
      if (cur) { unpick(cur.group); buildings.remove(cur.group); if (cur.fence) yards.remove(cur.fence); }
      const p = tileToWorld(def.plot.x + def.plot.w / 2, def.plot.y + def.plot.h / 2);
      const g = lv ? makeBuilding(def, lv) : makeGhost(def);
      g.position.set(p.x, 0, p.z); buildings.add(g);
      let f = null;
      if (lv && def.yard) { f = fence(def.yard, 0x7a5a3a); yards.add(f); }
      buildingNodes[def.id] = { group: g, level: lv, fence: f };
    });
    const live = new Set();
    v.animals.forEach(a => {
      live.add(a.id);
      const def = animalDef(a.sp); const penDef = FARM_BUILDINGS.find(b => b.id === def.pen);
      const yard = yardOf(penDef);
      let n = animalNodes[a.id];
      if (!n) {
        const made = makeAnimal(a);
        n = animalNodes[a.id] = { group: made.group, legs: made.legs, w: new Wanderer(a, yard), sp: a.sp };
        herd.add(n.group);
      }
      const e = FARM_ECON.animals[a.sp];
      const grown = e ? Math.min(1, a.ageH / e.growH) : 1;
      const sc = 0.55 + 0.45 * grown; n.group.scale.set(sc, sc, sc);
    });
    Object.keys(animalNodes).forEach(id => {
      if (live.has(+id)) return;
      unpick(animalNodes[id].group); herd.remove(animalNodes[id].group); delete animalNodes[id];
    });
  }

  /* ── input: orbit + pick ── */
  let dragging = false, moved = 0, lx = 0, ly = 0, pinch = 0;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const pickAt = (px, py) => {
    const r = cv.getBoundingClientRect();
    ndc.set(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(pickables, false);
    return hits.length ? hits[0].object.userData.pick : null;
  };
  const onDown = (e) => { dragging = true; moved = 0; lx = e.clientX; ly = e.clientY; cv.style.cursor = 'grabbing'; try { cv.setPointerCapture(e.pointerId); } catch (x) {} };
  const onMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
    orbit.theta -= dx * 0.008; orbit.phi = Math.max(0.35, Math.min(1.35, orbit.phi - dy * 0.006)); placeCamera();
  };
  const onUp = (e) => {
    dragging = false; cv.style.cursor = 'grab';
    if (moved < 6) { const p = pickAt(e.clientX, e.clientY); if (p) { select(p); try { opts.onSelect && opts.onSelect(p.kind, p.id); } catch (x) {} } }
  };
  const onWheel = (e) => { e.preventDefault(); orbit.dist = Math.max(8, Math.min(34, orbit.dist + e.deltaY * 0.02)); placeCamera(); };
  const onTouch = (e) => {
    if (e.touches.length === 2) {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      if (pinch) { orbit.dist = Math.max(8, Math.min(34, orbit.dist - (d - pinch) * 0.04)); placeCamera(); }
      pinch = d; e.preventDefault();
    } else pinch = 0;
  };
  cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp); cv.addEventListener('pointercancel', () => { dragging = false; });
  cv.addEventListener('wheel', onWheel, { passive: false }); cv.addEventListener('touchmove', onTouch, { passive: false });

  function select(p) {
    selected = p;
    if (!selectRing) {
      selectRing = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.85, 32), new THREE.MeshBasicMaterial({ color: 0xd4af37, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
      selectRing.rotation.x = -Math.PI / 2; selectRing.position.y = 0.03; scene.add(selectRing);
    }
    if (p.kind === 'building') {
      const def = FARM_BUILDINGS.find(b => b.id === p.id); const w = tileToWorld(def.plot.x + def.plot.w / 2, def.plot.y + def.plot.h / 2);
      selectRing.position.set(w.x, 0.03, w.z); const r = Math.max(def.plot.w, def.plot.h) * 0.62; selectRing.scale.set(r, r, 1);
      selectRing.visible = true;
    } else selectRing.visible = false;
  }

  /* ── loop ── */
  let last = performance.now(), alive = true, rafId = 0, timerId = 0;
  const frame = (t) => {
    if (!alive) return;
    if (!cv.isConnected) { destroy(); return; }
    const dt = Math.min(0.1, (t - last) / 1000); last = t;
    Object.keys(animalNodes).forEach(id => {
      const n = animalNodes[id]; const walking = n.w.step(dt);
      const p = tileToWorld(n.w.x, n.w.z); n.group.position.set(p.x, 0, p.z); n.group.rotation.y = n.w.rot;
      const bob = walking ? Math.sin(n.w.phase) : 0;
      n.legs.forEach((l, i) => { l.rotation.x = bob * 0.5 * (i % 2 ? 1 : -1); });
      n.group.position.y = walking ? Math.abs(Math.sin(n.w.phase)) * 0.03 : 0;
    });
    if (selectRing && selectRing.visible) selectRing.material.opacity = 0.6 + 0.3 * Math.sin(t / 300);
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(frame);
  };
  rafId = requestAnimationFrame(frame);
  // Fallback: the Browser pane never fires RAF; a slow timer keeps it alive there.
  timerId = setInterval(() => { if (alive && !cv.isConnected) destroy(); }, 1500);

  const onResize = () => { try { renderer.setSize(W(), Hh()); camera.aspect = W() / Hh(); camera.updateProjectionMatrix(); } catch (e) {} };
  window.addEventListener('resize', onResize);
  let ro = null; try { ro = new ResizeObserver(onResize); ro.observe(container); } catch (e) {}

  function destroy() {
    if (!alive) return; alive = false;
    try { cancelAnimationFrame(rafId); clearInterval(timerId); } catch (e) {}
    try { window.removeEventListener('resize', onResize); if (ro) ro.disconnect(); } catch (e) {}
    try { scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { const ms = [].concat(o.material); ms.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); } }); } catch (e) {}
    try { renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss(); } catch (e) {}
    try { cv.remove(); } catch (e) {}
  }
  return { update, destroy, mode: '3d', select };
}

/* ══════════════════════════ 2D fallback ══════════════════════════ */
function build2D(container, opts) {
  const cv = document.createElement('canvas');
  cv.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;cursor:pointer';
  container.appendChild(cv);
  const ctx = cv.getContext('2d');
  let view = null, wanderers = {}, alive = true, rafId = 0, last = performance.now();
  const tile = () => Math.floor(Math.min(cv.width / (FARM_GRID.w + 1), cv.height / (FARM_GRID.h + 1)));
  const origin = () => { const t = tile(); return { ox: (cv.width - t * FARM_GRID.w) / 2, oy: (cv.height - t * FARM_GRID.h) / 2, t }; };
  const fit = () => { const r = container.getBoundingClientRect(); cv.width = Math.max(320, r.width | 0); cv.height = Math.max(240, r.height | 0); };
  fit();
  function update(v) {
    view = v;
    const live = new Set();
    v.animals.forEach(a => { live.add(a.id); if (!wanderers[a.id]) { const d = animalDef(a.sp), pen = FARM_BUILDINGS.find(b => b.id === d.pen); wanderers[a.id] = { w: new Wanderer(a, yardOf(pen)), a }; } });
    Object.keys(wanderers).forEach(id => { if (!live.has(+id)) delete wanderers[id]; });
  }
  const draw = (dt) => {
    const { ox, oy, t } = origin();
    ctx.fillStyle = '#1a2233'; ctx.fillRect(0, 0, cv.width, cv.height);
    for (let y = 0; y < FARM_GRID.h; y++) for (let x = 0; x < FARM_GRID.w; x++) { ctx.fillStyle = ((x + y) & 1) ? '#4f7a3a' : '#55823f'; ctx.fillRect(ox + x * t, oy + y * t, t, t); }
    if (!view) return;
    FARM_BUILDINGS.forEach(def => {
      const row = view.buildings[def.id];
      if (def.yard && row) { ctx.strokeStyle = '#7a5a3a'; ctx.lineWidth = 3; ctx.strokeRect(ox + def.yard.x * t, oy + def.yard.y * t, def.yard.w * t, def.yard.h * t); }
      ctx.fillStyle = row ? def.accent : 'rgba(255,255,255,0.12)';
      ctx.fillRect(ox + def.plot.x * t + 2, oy + def.plot.y * t + 2, def.plot.w * t - 4, def.plot.h * t - 4);
      ctx.fillStyle = '#f4efe4'; ctx.font = Math.floor(t * 0.7) + 'px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(def.emoji, ox + (def.plot.x + def.plot.w / 2) * t, oy + (def.plot.y + def.plot.h / 2) * t);
      ctx.font = Math.floor(t * 0.3) + 'px system-ui'; ctx.fillText(row ? 'L' + row.level : 'build', ox + (def.plot.x + def.plot.w / 2) * t, oy + (def.plot.y + def.plot.h) * t - t * 0.2);
    });
    Object.keys(wanderers).forEach(id => {
      const n = wanderers[id]; n.w.step(dt); const d = animalDef(n.a.sp);
      ctx.font = Math.floor(t * (0.45 + 0.35 * d.size)) + 'px system-ui'; ctx.fillText(d.emoji, ox + n.w.x * t, oy + n.w.z * t);
    });
  };
  const frame = (ts) => { if (!alive) return; if (!cv.isConnected) { destroy(); return; } const dt = Math.min(0.1, (ts - last) / 1000); last = ts; draw(dt); rafId = requestAnimationFrame(frame); };
  rafId = requestAnimationFrame(frame);
  const onClick = (e) => {
    const r = cv.getBoundingClientRect(); const px = (e.clientX - r.left) * (cv.width / r.width), py = (e.clientY - r.top) * (cv.height / r.height);
    const { ox, oy, t } = origin(); const gx = (px - ox) / t, gy = (py - oy) / t;
    for (const id of Object.keys(wanderers)) { const n = wanderers[id]; if (Math.hypot(n.w.x - gx, n.w.z - gy) < 0.5) { opts.onSelect && opts.onSelect('animal', n.a.sp); return; } }
    for (const def of FARM_BUILDINGS) { if (gx >= def.plot.x && gx < def.plot.x + def.plot.w && gy >= def.plot.y && gy < def.plot.y + def.plot.h) { opts.onSelect && opts.onSelect('building', def.id); return; } }
  };
  cv.addEventListener('click', onClick);
  const onResize = () => fit(); window.addEventListener('resize', onResize);
  function destroy() { if (!alive) return; alive = false; try { cancelAnimationFrame(rafId); window.removeEventListener('resize', onResize); cv.remove(); } catch (e) {} }
  return { update, destroy, mode: '2d', select: () => {} };
}

/* Public: resolves to a scene either way. `prefer2d` forces the fallback. */
export async function createScene(container, opts) {
  opts = opts || {};
  if (!opts.prefer2d) {
    const THREE = await ensureThree();
    if (THREE && container.isConnected) {
      try { return build3D(THREE, container, opts); } catch (e) { try { console.warn('[farm] 3D scene failed, falling back to 2D:', e); } catch (x) {} }
    }
  }
  return build2D(container, opts);
}
