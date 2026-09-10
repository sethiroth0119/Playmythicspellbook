/* ════════════════════════════════════════════════════════════════════════════
   🐄 HOMESTEAD FARM — the 3D homestead (three.js) with a 2D canvas fallback.
   ----------------------------------------------------------------------------
   Low-poly, no assets: every building, animal, tree and raider is boxes, so
   the scene has nothing to download beyond three.js itself. three.js is
   fetched the same way the combat VFX rig fetches it (cdnjs r128 →
   window.THREE) so the two share one cached copy; if that fetch fails the
   farm still works on a top-down 2D canvas — the game must degrade, never
   break.

   What the scene shows, and where each comes from:
     • buildings + yards + fences        view.buildings (ghosts when unbuilt)
     • animals wandering their yard      view.animals (guards patrol the post)
     • prize rosette / rare-breed colour / sick marker   per animal flags
     • torn roof on a damaged pen        pen.damaged
     • live weather: rain, storm, fog    view.weather (the farm's own)
     • season tint on the grass          view.season
     • event actors for 12s after mount  view.recentEvents (UFO, raiders,
                                          wolves, fox, hawk) — the replay of
                                          what happened while you were away
     • decor + palette + roofs           view.look (the Athena Editor)

   ⚠ THE BROWSER PANE DOES NOT COMPOSITE (CLAUDE.md): requestAnimationFrame
     never fires there. The loop is RAF-driven; the interval only watches for
     a detached canvas so a dead pane still disposes the GL context.

   Contract: createScene(container, { onSelect(kind, id) })
             → { update(view), destroy(), select(pick), mode }
   ════════════════════════════════════════════════════════════════════════════ */

import { FARM_ANIMALS, FARM_BUILDINGS, FARM_GRID, FARM_LOOKS, FARM_ECON, animalDef } from './farm.data.js';

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

function hash(n) { let x = (n | 0) * 2654435761 >>> 0; x ^= x >>> 13; x = Math.imul(x, 0x5bd1e995) >>> 0; return (x ^ (x >>> 15)) >>> 0; }
function rnd01(seed) { return (hash(seed) % 10000) / 10000; }
function yardOf(def) { return def.yard || def.plot; }
function tileToWorld(gx, gy) { return { x: gx - FARM_GRID.w / 2, z: gy - FARM_GRID.h / 2 }; }

/* ── Animal wander model (shared by 3D and 2D) ─────────────────────────────── */
class Wanderer {
  constructor(a, yard) {
    this.a = a; this.yard = yard;
    this.x = yard.x + 0.5 + rnd01(a.id * 7 + 1) * Math.max(0.2, yard.w - 1);
    this.z = yard.y + 0.5 + rnd01(a.id * 7 + 2) * Math.max(0.2, yard.h - 1);
    this.tx = this.x; this.tz = this.z; this.rot = rnd01(a.id) * Math.PI * 2;
    this.wait = rnd01(a.id * 3) * 3; this.phase = rnd01(a.id * 5) * 6.28; this.speed = 0.35 + rnd01(a.id * 11) * 0.3;
  }
  step(dt) {
    this.phase += dt * 6;
    if (this.wait > 0) { this.wait -= dt; return false; }
    const dx = this.tx - this.x, dz = this.tz - this.z, d = Math.hypot(dx, dz);
    if (d < 0.05) {
      this.wait = 1 + Math.random() * 4;
      this.tx = this.yard.x + 0.4 + Math.random() * Math.max(0.2, this.yard.w - 0.8);
      this.tz = this.yard.y + 0.4 + Math.random() * Math.max(0.2, this.yard.h - 0.8);
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

  const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x3a4a2a, 0.9); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d0, 1.15);
  sun.position.set(9, 16, 6); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -12; sun.shadow.camera.right = 12; sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12;
  scene.add(sun);

  const M = (c, o) => new THREE.MeshLambertMaterial(Object.assign({ color: c }, o || {}));
  const box = (w, h, d, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.castShadow = true; m.receiveShadow = true; return m; };
  const cyl = (rt, rb, h, mat, seg) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 10), mat); m.castShadow = true; m.receiveShadow = true; return m; };
  const cone = (r, h, mat, seg) => { const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg || 8), mat); m.castShadow = true; return m; };

  /* Sky: a vertical gradient baked to a tiny canvas texture. */
  const skyTex = (top, bottom) => {
    const c = document.createElement('canvas'); c.width = 4; c.height = 64; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 64); g.addColorStop(0, '#' + top.toString(16).padStart(6, '0')); g.addColorStop(1, '#' + bottom.toString(16).padStart(6, '0'));
    x.fillStyle = g; x.fillRect(0, 0, 4, 64);
    const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter; return t;
  };

  // Ground tiles, retinted by the look and season.
  const ground = new THREE.Group(); scene.add(ground);
  const gA = M(0x4f7a3a), gB = M(0x55823f), rimM = M(0x6b4f34);
  for (let y = 0; y < FARM_GRID.h; y++) for (let x = 0; x < FARM_GRID.w; x++) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 1), ((x + y) & 1) ? gA : gB);
    const p = tileToWorld(x + 0.5, y + 0.5); t.position.set(p.x, -0.1, p.z); t.receiveShadow = true; ground.add(t);
  }
  const rim = new THREE.Mesh(new THREE.BoxGeometry(FARM_GRID.w + 3, 0.18, FARM_GRID.h + 3), rimM);
  rim.position.y = -0.21; rim.receiveShadow = true; ground.add(rim);

  const pickables = [];
  const buildingNodes = {}, animalNodes = {};
  const yards = new THREE.Group(); scene.add(yards);
  const buildings = new THREE.Group(); scene.add(buildings);
  const herd = new THREE.Group(); scene.add(herd);
  const decor = new THREE.Group(); scene.add(decor);
  const actors = new THREE.Group(); scene.add(actors);
  const weatherG = new THREE.Group(); scene.add(weatherG);
  const spinners = [];   // windmill blades etc.

  const labelSprite = (text, sub, color) => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 160;
    const x = c.getContext('2d');
    x.fillStyle = 'rgba(8,10,16,0.72)'; x.beginPath(); x.roundRect ? x.roundRect(6, 6, 628, 148, 24) : x.rect(6, 6, 628, 148); x.fill();
    x.strokeStyle = color || '#d4af37'; x.lineWidth = 6; x.stroke();
    const fit = (str, px, max) => { x.font = 'bold ' + px + 'px system-ui, sans-serif'; while (px > 22 && x.measureText(str).width > max) { px -= 2; x.font = 'bold ' + px + 'px system-ui, sans-serif'; } };
    x.fillStyle = '#f4efe4'; x.textAlign = 'center'; fit(text, 54, 590);
    x.fillText(text, 320, 70);
    if (sub) { x.fillStyle = '#c9c3b6'; x.font = '36px system-ui, sans-serif'; while (x.measureText(sub).width > 590) { x.font = (parseInt(x.font, 10) - 2) + 'px system-ui, sans-serif'; } x.fillText(sub, 320, 124); }
    const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(2.2, 0.55, 1);
    return sp;
  };
  const tinySprite = (emoji, size) => {
    const c = document.createElement('canvas'); c.width = c.height = 96; const x = c.getContext('2d');
    x.font = '72px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(emoji, 48, 52);
    const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(size || 0.4, size || 0.4, 1); return sp;
  };

  /* ── Buildings ── */
  const makeBuilding = (def, level, roofHex, damaged) => {
    const g = new THREE.Group();
    const w = def.plot.w, d = def.plot.h;
    const wall = M(0xb99a6b), roof = M(new THREE.Color(roofHex || def.accent).getHex()), trim = M(0x3a2f26);
    const hgt = 0.9 + 0.25 * level;
    if (def.id === 'pasture') {
      const hay = box(1.2, 0.6, 1.0, M(0xd9c46a)); hay.position.set(0, 0.3, 0); g.add(hay);
      const post = box(0.12, 1.1, 0.12, trim); post.position.set(-w / 2 + 0.3, 0.55, 0); g.add(post);
      const post2 = post.clone(); post2.position.x = w / 2 - 0.3; g.add(post2);
      const bar = box(w - 0.6, 0.1, 0.1, trim); bar.position.set(0, 0.9, 0); g.add(bar);
    } else if (def.id === 'guardpost') {
      const house = box(0.9, 0.7, 0.9, wall); house.position.set(-0.4, 0.35, 0); g.add(house);
      const rf = cone(0.75, 0.5, roof, 4); rf.rotation.y = Math.PI / 4; rf.position.set(-0.4, 0.95, 0); g.add(rf);
      const door = box(0.3, 0.35, 0.05, trim); door.position.set(-0.4, 0.2, 0.46); g.add(door);
      const pole = cyl(0.04, 0.05, 1.6, trim, 6); pole.position.set(0.55, 0.8, 0); g.add(pole);
      const lamp = box(0.22, 0.22, 0.22, new THREE.MeshLambertMaterial({ color: 0xffe0a0, emissive: 0xffc860, emissiveIntensity: 0.8 })); lamp.position.set(0.55, 1.55, 0); g.add(lamp);
    } else {
      const body = box(w - 0.3, hgt, d - 0.3, wall); body.position.y = hgt / 2; g.add(body);
      if (damaged) {
        // Roof gone: a few planks at angles and a dark hole.
        const hole = box(w - 0.5, 0.05, d - 0.5, M(0x1a1410)); hole.position.y = hgt + 0.03; g.add(hole);
        for (let i = 0; i < 4; i++) { const pl = box(0.8, 0.06, 0.18, roof); pl.position.set((i - 1.5) * 0.35, hgt + 0.15 + i * 0.05, (i % 2 ? 0.3 : -0.3)); pl.rotation.z = (i % 2 ? 0.5 : -0.4); pl.rotation.y = i * 0.7; g.add(pl); }
      } else {
        const rf = cone(Math.max(w, d) * 0.62, 0.7 + 0.15 * level, roof, 4);
        rf.rotation.y = Math.PI / 4; rf.position.y = hgt + 0.35 + 0.075 * level; rf.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d));
        g.add(rf);
      }
      const door = box(0.4, 0.55, 0.06, trim); door.position.set(0, 0.28, d / 2 - 0.13); g.add(door);
      const win = box(0.25, 0.25, 0.05, new THREE.MeshLambertMaterial({ color: 0x8fb8d8, emissive: 0x304050, emissiveIntensity: 0.4 })); win.position.set(w / 2 - 0.55, hgt * 0.6, d / 2 - 0.13); g.add(win);
      if (def.station) { const chimney = box(0.22, 0.6, 0.22, trim); chimney.position.set(w / 2 - 0.5, hgt + 0.5, -d / 4); g.add(chimney); }
      if (def.id === 'feedmill') {
        const tower = cyl(0.16, 0.2, 1.6, M(0x8a7a5a), 8); tower.position.set(w / 2 + 0.45, 0.8, -d / 2 + 0.3); g.add(tower);
        const hub = new THREE.Group(); hub.position.set(w / 2 + 0.45, 1.65, -d / 2 + 0.1);
        for (let i = 0; i < 4; i++) { const bl = box(0.08, 0.9, 0.16, M(0xe8dcc0)); bl.position.y = 0.45; const arm = new THREE.Group(); arm.rotation.z = i * Math.PI / 2; arm.add(bl); hub.add(arm); }
        g.add(hub); spinners.push(hub);
      }
    }
    for (let i = 0; i < level - 1; i++) { const star = box(0.16, 0.16, 0.16, M(0xd4af37)); star.position.set(-w / 2 + 0.35 + i * 0.3, hgt + 0.05, d / 2 - 0.1); g.add(star); }
    const lab = labelSprite(def.emoji + ' ' + def.name, damaged ? 'Roof torn off — repair' : 'Level ' + level, damaged ? '#e0556a' : (roofHex || def.accent)); lab.position.y = hgt + 1.35; g.add(lab);
    g.traverse(o => { if (o.isMesh) { o.userData.pick = { kind: 'building', id: def.id }; pickables.push(o); } });
    return g;
  };
  const makeGhost = (def) => {
    const g = new THREE.Group();
    const plate = new THREE.Mesh(new THREE.BoxGeometry(def.plot.w - 0.2, 0.06, def.plot.h - 0.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(def.accent), transparent: true, opacity: 0.28 }));
    plate.position.y = 0.04; g.add(plate);
    const sign = box(0.08, 0.7, 0.08, M(0x3a2f26)); sign.position.set(0, 0.35, 0); g.add(sign);
    const lab = labelSprite(def.emoji + ' ' + def.name, 'Not built — tap to build', def.accent); lab.position.y = 1.2; lab.material.opacity = 0.85; g.add(lab);
    g.traverse(o => { if (o.isMesh) { o.userData.pick = { kind: 'building', id: def.id }; pickables.push(o); } });
    return g;
  };
  const fence = (x0t, y0t, x1t, y1t, color, tall) => {
    const g = new THREE.Group(); const mat = M(color || 0x7a5a3a); const h = tall ? 0.75 : 0.55;
    const along = (x0, z0, x1, z1) => {
      const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0)));
      for (let i = 0; i <= n; i++) { const p = box(0.1, h, 0.1, mat); p.position.set(x0 + (x1 - x0) * i / n, h / 2, z0 + (z1 - z0) * i / n); g.add(p); }
      const rail = box(Math.abs(x1 - x0) || 0.08, 0.06, Math.abs(z1 - z0) || 0.08, mat); rail.position.set((x0 + x1) / 2, h * 0.78, (z0 + z1) / 2); g.add(rail);
      const rail2 = rail.clone(); rail2.position.y = h * 0.38; g.add(rail2);
    };
    const a = tileToWorld(x0t, y0t), b = tileToWorld(x1t, y1t);
    along(a.x, a.z, b.x, a.z); along(b.x, a.z, b.x, b.z); along(b.x, b.z, a.x, b.z); along(a.x, b.z, a.x, a.z);
    return g;
  };

  /* ── Animals ── */
  const makeAnimal = (a) => {
    const def = animalDef(a.sp), s = def.size;
    const c = Object.assign({}, def.colors);
    const breed = a.breed ? FARM_ECON.breeds[a.breed] : null;
    if (breed) { c.body = breed.color; if (a.breed !== 'glow') c.head = breed.color; }
    const glow = a.breed === 'glow';
    const mk = (col) => glow ? new THREE.MeshLambertMaterial({ color: col, emissive: 0x4affc0, emissiveIntensity: 0.55 }) : M(col);
    const g = new THREE.Group(); const legs = [];
    const bodyM = mk(c.body), headM = mk(c.head), accM = M(c.accent), legM = M(c.legs);
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
    } else if (def.guard && a.sp !== 'donkey') {
      // Dogs: low body, pointed ears, tail up.
      const bw = 0.42 * s, bh = 0.4 * s, bl = 0.95 * s, lh = 0.36 * s;
      const body = box(bw, bh, bl, bodyM); body.position.y = lh + bh / 2; g.add(body);
      const head = box(bw * 0.8, bh * 0.8, bw * 0.9, headM); head.position.set(0, lh + bh * 0.95, bl / 2 + bw * 0.1); g.add(head);
      const snout = box(bw * 0.4, bh * 0.35, bw * 0.4, accM); snout.position.set(0, lh + bh * 0.8, bl / 2 + bw * 0.6); g.add(snout);
      const ear = box(0.1 * s, 0.22 * s, 0.05 * s, accM); ear.position.set(bw * 0.3, lh + bh * 1.4, bl / 2 - 0.05); g.add(ear);
      const ear2 = ear.clone(); ear2.position.x = -bw * 0.3; g.add(ear2);
      const tail = box(0.08 * s, 0.4 * s, 0.08 * s, bodyM); tail.rotation.x = 0.6; tail.position.set(0, lh + bh * 1.1, -bl / 2); g.add(tail);
      [-0.3, 0.3].forEach(x => [-0.36, 0.36].forEach(z => leg(x * bw, z * bl, lh)));
    } else {
      const isD = a.sp === 'donkey';
      const bw = (a.sp === 'cow' ? 0.6 : 0.5) * s, bh = (a.sp === 'cow' ? 0.6 : 0.45) * s, bl = (a.sp === 'cow' ? 1.15 : 0.95) * s, lh = (a.sp === 'pig' ? 0.22 : 0.42) * s;
      const body = box(bw, bh, bl, bodyM); body.position.y = lh + bh / 2; g.add(body);
      const head = box(bw * 0.6, bh * 0.65, bw * (isD ? 0.9 : 0.6), headM); head.position.set(0, lh + bh * 0.75, bl / 2 + bw * 0.2); g.add(head);
      if (a.sp === 'cow') {
        const spot = box(bw * 0.5, bh * 0.4, bl * 0.35, accM); spot.position.set(bw * 0.26, lh + bh * 0.6, -bl * 0.15); g.add(spot);
        const spot2 = box(bw * 0.4, bh * 0.35, bl * 0.25, accM); spot2.position.set(-bw * 0.3, lh + bh * 0.45, bl * 0.2); g.add(spot2);
        const horn = box(0.05 * s, 0.05 * s, 0.16 * s, M(0xe8dcc0)); horn.rotation.x = -0.6; horn.position.set(bw * 0.28, lh + bh * 1.05, bl / 2 + bw * 0.1); g.add(horn);
        const horn2 = horn.clone(); horn2.position.x = -bw * 0.28; g.add(horn2);
        const nose = box(bw * 0.62, bh * 0.28, 0.1 * s, M(0xe0a8a8)); nose.position.set(0, lh + bh * 0.6, bl / 2 + bw * 0.5); g.add(nose);
        const udder = box(bw * 0.5, bh * 0.25, bl * 0.25, M(0xe8b8b8)); udder.position.set(0, lh - bh * 0.05, -bl * 0.1); g.add(udder);
      } else if (a.sp === 'pig') {
        const snout = box(bw * 0.3, bh * 0.25, 0.1 * s, accM); snout.position.set(0, lh + bh * 0.7, bl / 2 + bw * 0.5); g.add(snout);
        const ear = box(0.1 * s, 0.14 * s, 0.05 * s, accM); ear.position.set(bw * 0.25, lh + bh * 1.05, bl / 2); g.add(ear);
        const ear2 = ear.clone(); ear2.position.x = -bw * 0.25; g.add(ear2);
        const tail = box(0.05 * s, 0.05 * s, 0.18 * s, accM); tail.rotation.x = 0.8; tail.position.set(0, lh + bh * 0.8, -bl / 2 - 0.05); g.add(tail);
      } else if (a.sp === 'goat') {
        const horn = box(0.05 * s, 0.24 * s, 0.05 * s, accM); horn.rotation.x = 0.5; horn.position.set(bw * 0.2, lh + bh * 1.15, bl / 2); g.add(horn);
        const horn2 = horn.clone(); horn2.position.x = -bw * 0.2; g.add(horn2);
        const beard = box(0.08 * s, 0.14 * s, 0.06 * s, accM); beard.position.set(0, lh + bh * 0.4, bl / 2 + bw * 0.45); g.add(beard);
      } else if (isD) {
        const ear = box(0.08 * s, 0.32 * s, 0.06 * s, accM); ear.position.set(bw * 0.25, lh + bh * 1.3, bl / 2 + bw * 0.1); g.add(ear);
        const ear2 = ear.clone(); ear2.position.x = -bw * 0.25; g.add(ear2);
        const mane = box(bw * 0.3, bh * 0.25, bl * 0.5, M(0x3a3430)); mane.position.set(0, lh + bh * 1.05, bl * 0.1); g.add(mane);
        const muzzle = box(bw * 0.5, bh * 0.3, 0.1 * s, accM); muzzle.position.set(0, lh + bh * 0.6, bl / 2 + bw * 0.65); g.add(muzzle);
        const tail = box(0.06 * s, 0.4 * s, 0.06 * s, M(0x3a3430)); tail.position.set(0, lh + bh * 0.6, -bl / 2 - 0.03); g.add(tail);
      }
      [-0.33, 0.33].forEach(x => [-0.36, 0.36].forEach(z => leg(x * bw, z * bl, lh)));
    }
    const top = (a.sp === 'chicken' ? 0.95 : 1.35) * s + 0.25;
    const rosette = tinySprite('🏅', 0.42); rosette.position.y = top; rosette.visible = false; g.add(rosette);
    const sickMark = tinySprite('🤒', 0.36); sickMark.position.y = top; sickMark.visible = false; g.add(sickMark);
    const illMark = tinySprite('🦠', 0.36); illMark.position.y = top; illMark.visible = false; g.add(illMark);
    const crown = tinySprite(a.breed && /:mythic$/.test(a.breed) ? '🌟' : '👑', 0.36); crown.position.y = top + 0.3; crown.visible = false; g.add(crown);
    g.traverse(o => { if (o.isMesh) { o.userData.pick = { kind: 'animal', id: a.sp }; pickables.push(o); } });
    return { group: g, legs, rosette, sickMark, illMark, crown };
  };

  /* ── Decor (rebuilt when the look changes) ── */
  const tree = (x, z, seed) => {
    const g = new THREE.Group(); const sc = 0.8 + rnd01(seed) * 0.6;
    const trunk = cyl(0.08 * sc, 0.12 * sc, 0.6 * sc, M(0x6b4a2a), 6); trunk.position.y = 0.3 * sc; g.add(trunk);
    const shade = [0x2f6a3a, 0x3a7a44, 0x4a8a4a][hash(seed) % 3];
    const c1 = cone(0.55 * sc, 0.9 * sc, M(shade), 7); c1.position.y = 0.95 * sc; g.add(c1);
    const c2 = cone(0.42 * sc, 0.75 * sc, M(shade), 7); c2.position.y = 1.45 * sc; g.add(c2);
    g.position.set(x, 0, z); g.rotation.y = rnd01(seed * 3) * 6.28; return g;
  };
  const buildDecor = (look, season) => {
    while (decor.children.length) { const c = decor.children.pop(); c.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    spinners.length = 0; // windmill is on the feed mill building, keep list only for decor spinners below
    const D = look.decor;
    const snow = look.ground === 'snow';
    if (D.paths) {
      const pathM = M(snow ? 0xb8b0a8 : 0x8a6a46);
      const strip = (x0, y0, x1, y1) => { const a = tileToWorld(x0, y0), b = tileToWorld(x1, y1); const m = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(b.x - a.x) || 0.6, 0.04, Math.abs(b.z - a.z) || 0.6), pathM); m.position.set((a.x + b.x) / 2, 0.02, (a.z + b.z) / 2); m.receiveShadow = true; decor.add(m); };
      strip(4.2, 0, 4.8, 14); strip(8.2, 0, 8.8, 8.8); strip(0, 0.2, 14, 0.8);
    }
    if (D.fence) decor.add(fence(0, 0, FARM_GRID.w, FARM_GRID.h, snow ? 0x5a4a3a : 0x6a4a2a, true));
    if (D.trees) {
      for (let i = 0; i < 16; i++) {
        const t = i / 16, ang = t * Math.PI * 2;
        const gx = FARM_GRID.w / 2 + Math.cos(ang) * (FARM_GRID.w / 2 + 1.1), gy = FARM_GRID.h / 2 + Math.sin(ang) * (FARM_GRID.h / 2 + 1.1);
        const p = tileToWorld(gx + (rnd01(i * 5) - 0.5) * 0.5, gy + (rnd01(i * 9) - 0.5) * 0.5);
        const tr = tree(p.x, p.z, i + 11);
        if (season && season.key === 'autumn') tr.traverse(o => { if (o.isMesh && o.geometry.type === 'ConeGeometry') o.material = M([0xc26a2a, 0xd9a03a, 0x8a5a2a][i % 3]); });
        if (snow) tr.traverse(o => { if (o.isMesh && o.geometry.type === 'ConeGeometry') o.material = M(0xdfe6ec); });
        decor.add(tr);
      }
    }
    if (D.pond) {
      const p = tileToWorld(9.5, 12.4);
      const water = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.06, 20), new THREE.MeshLambertMaterial({ color: snow ? 0x9ab8d0 : 0x3a86b8, emissive: 0x0a2a44, emissiveIntensity: 0.3, transparent: true, opacity: 0.92 }));
      water.position.set(p.x, 0.02, p.z); decor.add(water);
      const bank = new THREE.Mesh(new THREE.TorusGeometry(1.18, 0.09, 6, 20), M(0x8a7a5a)); bank.rotation.x = Math.PI / 2; bank.position.set(p.x, 0.04, p.z); decor.add(bank);
      for (let i = 0; i < 3; i++) { const reed = box(0.05, 0.5, 0.05, M(0x5a8a3a)); reed.position.set(p.x + 0.9 + i * 0.12, 0.25, p.z - 0.6 + i * 0.2); decor.add(reed); }
    }
    if (D.windmill) {
      const p = tileToWorld(8.5, 0.6);
      const tower = cone(0.35, 2.2, M(0x9a8a6a), 6); tower.position.set(p.x, 1.1, p.z); decor.add(tower);
      const hub = new THREE.Group(); hub.position.set(p.x, 2.15, p.z + 0.3);
      for (let i = 0; i < 4; i++) { const bl = box(0.1, 1.1, 0.2, M(0xe8dcc0)); bl.position.y = 0.55; const arm = new THREE.Group(); arm.rotation.z = i * Math.PI / 2; arm.add(bl); hub.add(arm); }
      decor.add(hub); spinners.push(hub);
    }
    if (D.hay) {
      for (let i = 0; i < 4; i++) { const p = tileToWorld(1.5 + i * 0.85, 10.5); const b = cyl(0.3, 0.3, 0.5, M(0xd9c46a), 10); b.rotation.z = Math.PI / 2; b.position.set(p.x, 0.3, p.z); b.rotation.y = rnd01(i * 7) * 0.6; decor.add(b); }
    }
    if (D.crops) {
      for (let r = 0; r < 6; r++) { const p = tileToWorld(13.5, 1.5 + r); const row = box(0.8, 0.12, 0.7, M(snow ? 0x8a8078 : 0x6a4a2a)); row.position.set(p.x, 0.06, p.z); decor.add(row);
        for (let k = 0; k < 3; k++) { const plant = box(0.14, 0.32, 0.14, M(snow ? 0xa8a898 : [0x7ab34a, 0x9ac05a, 0x6a9a3a][k])); plant.position.set(p.x - 0.26 + k * 0.26, 0.28, p.z); decor.add(plant); } }
    }
    if (D.lanterns) {
      FARM_BUILDINGS.forEach(def => {
        if (!def.yard) return;
        [[def.yard.x, def.yard.y], [def.yard.x + def.yard.w, def.yard.y + def.yard.h]].forEach(([gx, gy], i) => {
          const p = tileToWorld(gx, gy);
          const pole = cyl(0.03, 0.04, 1.1, M(0x3a2f26), 6); pole.position.set(p.x, 0.55, p.z); decor.add(pole);
          const lamp = box(0.18, 0.18, 0.18, new THREE.MeshLambertMaterial({ color: 0xffe0a0, emissive: 0xffb040, emissiveIntensity: 1 })); lamp.position.set(p.x, 1.15, p.z); decor.add(lamp);
        });
      });
    }
  };

  /* ── Weather ── */
  let rain = null, rainVel = null, fogBase = null;
  const setWeather = (wx, sky) => {
    while (weatherG.children.length) { const c = weatherG.children.pop(); if (c.geometry) c.geometry.dispose(); }
    rain = null;
    const S = FARM_LOOKS.sky[sky] || FARM_LOOKS.sky.day;
    let top = S.top, bottom = S.bottom, sunI = S.sun, hemiI = S.hemi, fogD = 60;
    if (wx.key === 'rain' || wx.key === 'storm' || wx.key === 'cloud') { top = blend(top, 0x3a4250, wx.key === 'cloud' ? 0.45 : 0.7); bottom = blend(bottom, 0x6a7280, wx.key === 'cloud' ? 0.4 : 0.65); sunI *= wx.key === 'cloud' ? 0.75 : 0.5; }
    if (wx.key === 'fog') { top = blend(top, 0xb8bcc4, 0.6); bottom = blend(bottom, 0xd0d4d8, 0.7); fogD = 24; }
    scene.background = skyTex(top, bottom);
    scene.fog = new THREE.Fog(bottom, wx.key === 'fog' ? 10 : 22, fogD);
    sun.intensity = sunI; hemi.intensity = hemiI;
    if (wx.key === 'rain' || wx.key === 'storm') {
      const n = wx.key === 'storm' ? 900 : 500;
      const pos = new Float32Array(n * 3); rainVel = new Float32Array(n);
      for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 22; pos[i * 3 + 1] = Math.random() * 12; pos[i * 3 + 2] = (Math.random() - 0.5) * 22; rainVel[i] = 6 + Math.random() * 6; }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      rain = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xc8dcf0, size: 0.07, transparent: true, opacity: 0.8 }));
      weatherG.add(rain);
    }
  };
  const blend = (a, b, t) => { const ca = new THREE.Color(a), cb = new THREE.Color(b); return ca.lerp(cb, t).getHex(); };

  /* ── Event actors: the replay of what happened while you were away ── */
  let actorList = [];
  const spawnActors = (events) => {
    while (actors.children.length) actors.children.pop();
    actorList = [];
    const seen = new Set();
    events.forEach(ev => {
      if (seen.has(ev.kind) || actorList.length >= 3) return; seen.add(ev.kind);
      const t0 = performance.now();
      if (ev.kind === 'ufo') {
        const g = new THREE.Group();
        const disc = cyl(1.1, 1.4, 0.25, new THREE.MeshLambertMaterial({ color: 0x9aa4b8, emissive: 0x304060, emissiveIntensity: 0.5 }), 18); g.add(disc);
        const dome = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x8affd6, emissive: 0x4affc0, emissiveIntensity: 0.8, transparent: true, opacity: 0.85 })); dome.position.y = 0.12; g.add(dome);
        const beam = new THREE.Mesh(new THREE.ConeGeometry(1.2, 5.5, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0x8affd6, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })); beam.position.y = -2.9; g.add(beam);
        for (let i = 0; i < 8; i++) { const l = box(0.12, 0.08, 0.12, new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: [0xff4060, 0x40ff80, 0x4080ff][i % 3], emissiveIntensity: 1.2 })); l.position.set(Math.cos(i / 8 * 6.28) * 1.2, -0.1, Math.sin(i / 8 * 6.28) * 1.2); g.add(l); }
        const p = tileToWorld(7, 10.5); g.position.set(p.x, 6, p.z); actors.add(g);
        actorList.push({ kind: 'ufo', g, t0, tick: (t, dt) => { g.rotation.y += dt * 1.2; g.position.y = 6 + Math.sin(t / 700) * 0.3; if (t - t0 > 9000) { g.position.y += dt * 12; g.position.x += dt * 9; } } });
      } else if (ev.kind === 'raid') {
        const g = new THREE.Group();
        for (let i = 0; i < 3; i++) { const r = new THREE.Group(); const body = box(0.32, 0.6, 0.22, M(0x2a2a30)); body.position.y = 0.55; r.add(body); const head = box(0.24, 0.24, 0.24, M(0x5a4a3a)); head.position.y = 0.98; r.add(head); const mask = box(0.26, 0.1, 0.05, M(0xb8404a)); mask.position.set(0, 0.98, 0.13); r.add(mask); const sack = box(0.24, 0.28, 0.24, M(0x8a6a3a)); sack.position.set(-0.22, 0.75, -0.1); r.add(sack); r.position.x = i * 0.6; g.add(r); }
        const p = tileToWorld(-0.8, 6); g.position.set(p.x, 0, p.z); actors.add(g);
        actorList.push({ kind: 'raid', g, t0, tick: (t, dt) => { g.position.x -= dt * 1.4; g.children.forEach((r, i) => { r.position.y = Math.abs(Math.sin(t / 120 + i)) * 0.08; }); } });
      } else if (ev.kind === 'wolves' || ev.kind === 'fox') {
        const g = new THREE.Group(); const n = ev.kind === 'wolves' ? 3 : 1; const col = ev.kind === 'wolves' ? 0x5a5a62 : 0xd8742a;
        for (let i = 0; i < n; i++) { const w = new THREE.Group(); const body = box(0.32, 0.3, 0.8, M(col)); body.position.y = 0.42; w.add(body); const head = box(0.26, 0.26, 0.34, M(col)); head.position.set(0, 0.6, 0.5); w.add(head); const snout = box(0.14, 0.12, 0.2, M(ev.kind === 'fox' ? 0xf4efe4 : 0x3a3a40)); snout.position.set(0, 0.55, 0.72); w.add(snout); const tail = box(0.1, 0.1, 0.45, M(col)); tail.position.set(0, 0.5, -0.55); tail.rotation.x = 0.4; w.add(tail); [-0.1, 0.1].forEach(x => [-0.28, 0.28].forEach(z => { const l = box(0.08, 0.3, 0.08, M(col)); l.position.set(x, 0.15, z); w.add(l); })); w.position.set(i * 0.7, 0, (i % 2) * 0.5); g.add(w); }
        const p = tileToWorld(15.2, 10); g.position.set(p.x, 0, p.z); g.rotation.y = Math.PI / 2; actors.add(g);
        actorList.push({ kind: ev.kind, g, t0, tick: (t, dt) => { const ph = (t - t0) / 1000; g.position.x = p.x + Math.sin(ph * 0.8) * 1.2; g.rotation.y = Math.PI / 2 + (Math.cos(ph * 0.8) > 0 ? 0 : Math.PI); } });
      } else if (ev.kind === 'hawk') {
        const g = new THREE.Group(); const body = box(0.18, 0.12, 0.5, M(0x5a3a2a)); g.add(body); const wl = box(0.9, 0.04, 0.22, M(0x6a4a3a)); wl.position.x = -0.5; g.add(wl); const wr = wl.clone(); wr.position.x = 0.5; g.add(wr);
        const c = tileToWorld(6.5, 4.5); g.position.set(c.x, 5, c.z); actors.add(g);
        actorList.push({ kind: 'hawk', g, t0, tick: (t) => { const ph = (t - t0) / 1000; g.position.set(c.x + Math.cos(ph * 0.9) * 3.2, 4.4 + Math.sin(ph * 1.7) * 0.5, c.z + Math.sin(ph * 0.9) * 3.2); g.rotation.y = -ph * 0.9; wl.rotation.z = Math.sin(ph * 6) * 0.25; wr.rotation.z = -Math.sin(ph * 6) * 0.25; } });
      }
    });
  };

  /* 🏗 Scaffolding: a building being raised is poles, planks and a crate. */
  const makeScaffold = (def, label) => {
    const g = new THREE.Group(); const w = def.plot.w, d = def.plot.h; const wood = M(0x9a7a4a), plank = M(0xc8a068);
    const slab = box(w - 0.3, 0.12, d - 0.3, M(0x8a8078)); slab.position.y = 0.06; g.add(slab);
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sz]) => { const pole = box(0.1, 1.4, 0.1, wood); pole.position.set(sx * (w / 2 - 0.25), 0.7, sz * (d / 2 - 0.25)); g.add(pole); });
    const beam = box(w - 0.4, 0.08, 0.08, wood); beam.position.set(0, 1.35, d / 2 - 0.25); g.add(beam); const beam2 = beam.clone(); beam2.position.z = -(d / 2 - 0.25); g.add(beam2);
    for (let i = 0; i < 3; i++) { const pl = box(0.9, 0.06, 0.2, plank); pl.position.set((i - 1) * 0.5, 0.15 + i * 0.05, (i % 2 ? 0.3 : -0.3)); pl.rotation.y = i * 0.5; g.add(pl); }
    const crate = box(0.4, 0.4, 0.4, plank); crate.position.set(w / 2 - 0.55, 0.32, -d / 2 + 0.55); g.add(crate);
    const lab = labelSprite('🏗 ' + def.name, label || 'Under construction', '#d4af37'); lab.position.y = 2.0; g.add(lab);
    g.traverse(o => { if (o.isMesh) { o.userData.pick = { kind: 'building', id: def.id }; pickables.push(o); } });
    return g;
  };
  /* 🚚 A haulage truck: cab, bed, wheels, and a crate with the animal's emoji. */
  const makeTruck = (emoji, own) => {
    const g = new THREE.Group(); const body = M(own ? 0x8a6a3a : 0x3a4a6a), dark = M(0x1a1a20);
    const bed = box(1.5, 0.35, 0.7, body); bed.position.set(-0.25, 0.42, 0); g.add(bed);
    const cab = box(0.55, 0.55, 0.7, body); cab.position.set(0.75, 0.52, 0); g.add(cab);
    const glass = box(0.08, 0.25, 0.5, new THREE.MeshLambertMaterial({ color: 0x8fb8d8, emissive: 0x203040 })); glass.position.set(1.03, 0.6, 0); g.add(glass);
    const crate = box(0.9, 0.45, 0.55, M(0xc8a068)); crate.position.set(-0.4, 0.82, 0); g.add(crate);
    [[0.7, 0.35], [0.7, -0.35], [-0.6, 0.35], [-0.6, -0.35]].forEach(([x, z]) => { const wh = cyl(0.16, 0.16, 0.12, dark, 10); wh.rotation.x = Math.PI / 2; wh.position.set(x, 0.16, z); g.add(wh); });
    const sp = tinySprite(emoji, 0.45); sp.position.set(-0.4, 1.3, 0); g.add(sp);
    return g;
  };
  const truckNodes = {};

  let view = null, selected = null, selectRing = null, lookKey = '', wxKey = '', actorsShown = false;
  const unpick = (root) => root.traverse(o => { const i = pickables.indexOf(o); if (i >= 0) pickables.splice(i, 1); });

  function update(v) {
    view = v;
    const look = v.look || FARM_LOOKS.defaults;
    const lk = JSON.stringify([look.ground, look.decor, v.season && v.season.key]);
    if (lk !== lookKey) {
      lookKey = lk;
      const G = FARM_LOOKS.ground[look.ground] || FARM_LOOKS.ground.meadow;
      let a = G.a, b = G.b;
      if (v.season && look.ground === 'meadow') { if (v.season.key === 'autumn') { a = blend(a, 0x9a7a3a, 0.35); b = blend(b, 0xa8863a, 0.35); } if (v.season.key === 'winter') { a = blend(a, 0x9aa8a0, 0.35); b = blend(b, 0xa8b4ac, 0.35); } if (v.season.key === 'summer') { a = blend(a, 0x7a9a3a, 0.2); b = blend(b, 0x86a842, 0.2); } }
      gA.color.setHex(a); gB.color.setHex(b); rimM.color.setHex(G.rim);
      buildDecor(look, v.season);
    }
    const wk = (v.weather ? v.weather.key : 'clear') + '|' + look.sky;
    if (wk !== wxKey) { wxKey = wk; setWeather(v.weather || { key: 'clear' }, look.sky); }

    FARM_BUILDINGS.forEach(def => {
      const row = v.buildings[def.id], lv = row ? row.level : 0;
      const roof = look.roofs && look.roofs[def.id];
      const dmg = !!(row && row.damaged);
      const constructing = !!(row && row.constructing && row.readyAt > Date.now());
      const key = lv + '|' + (roof || '') + '|' + dmg + '|' + constructing;
      const cur = buildingNodes[def.id];
      if (cur && cur.key === key) return;
      if (cur) { unpick(cur.group); buildings.remove(cur.group); if (cur.fence) yards.remove(cur.fence); const si = spinners.indexOf(cur.spin); if (si >= 0) spinners.splice(si, 1); }
      const p = tileToWorld(def.plot.x + def.plot.w / 2, def.plot.y + def.plot.h / 2);
      const before = spinners.length;
      const g = !lv ? makeGhost(def) : constructing ? makeScaffold(def) : makeBuilding(def, lv, roof, dmg);
      g.position.set(p.x, 0, p.z); buildings.add(g);
      let f = null;
      if (lv && !constructing && def.yard) { f = fence(def.yard.x, def.yard.y, def.yard.x + def.yard.w, def.yard.y + def.yard.h, lv >= 3 ? 0x5a4a3a : 0x7a5a3a, lv >= 2); yards.add(f); }
      buildingNodes[def.id] = { group: g, key, fence: f, spin: spinners.length > before ? spinners[spinners.length - 1] : null };
    });
    const live = new Set();
    v.animals.forEach(a => {
      live.add(a.id);
      const def = animalDef(a.sp); const penDef = FARM_BUILDINGS.find(b => b.id === def.pen);
      const yard = yardOf(penDef);
      let n = animalNodes[a.id];
      const akey = (a.breed || '') ;
      if (n && n.akey !== akey) { unpick(n.group); herd.remove(n.group); delete animalNodes[a.id]; n = null; }
      if (!n) {
        const made = makeAnimal(a);
        n = animalNodes[a.id] = { group: made.group, legs: made.legs, rosette: made.rosette, sickMark: made.sickMark, illMark: made.illMark, crown: made.crown, w: new Wanderer(a, yard), sp: a.sp, akey };
        herd.add(n.group);
      }
      const e = FARM_ECON.animals[a.sp];
      const grown = e ? Math.min(1, a.grownH / e.growH) : 1;
      let sc = 0.55 + 0.45 * grown;
      if (e && a.weight) sc *= 0.9 + 0.2 * Math.min(1.3, a.weight / e.adultWeight) / 1.3;
      n.group.scale.set(sc, sc, sc);
      n.rosette.visible = !!a.prize; n.illMark.visible = !!a.ill; n.sickMark.visible = !!a.sick && !a.ill && !a.prize;
      n.crown.visible = !!(a.tier === 'royal' || a.tier === 'mythic');
      n.group.visible = !a.away;   // an escort is on the road
    });
    Object.keys(animalNodes).forEach(id => {
      if (live.has(+id)) return;
      unpick(animalNodes[id].group); herd.remove(animalNodes[id].group); delete animalNodes[id];
    });
    // 🚚 Shipments on the road: one truck each, driving the top path toward the pen.
    const ships = Array.isArray(v.shipments) ? v.shipments.slice(0, 4) : [];
    const liveShips = new Set();
    ships.forEach(x => {
      liveShips.add(x.id);
      let n = truckNodes[x.id];
      if (!n) { const ad = animalDef(x.sp); n = truckNodes[x.id] = { g: makeTruck(ad ? ad.emoji : '📦', /^own:/.test(x.carrier)), pen: x.pen }; actors.add(n.g); }
      const penDef = FARM_BUILDINGS.find(b => b.id === x.pen) || FARM_BUILDINGS[0];
      const gx0 = -2.5, gx1 = penDef.plot.x + penDef.plot.w / 2;
      const p = tileToWorld(gx0 + (gx1 - gx0) * x.progress, 0.5);
      n.g.position.set(p.x, 0, p.z); n.g.rotation.y = 0; n.target = p;
    });
    Object.keys(truckNodes).forEach(id => { if (!liveShips.has(+id)) { actors.remove(truckNodes[id].g); delete truckNodes[id]; } });
    if (!actorsShown && Array.isArray(v.recentEvents) && v.recentEvents.length) { actorsShown = true; spawnActors(v.recentEvents); }
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
      selectRing = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.85, 32), new THREE.MeshBasicMaterial({ color: 0xd4af37, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
      selectRing.rotation.x = -Math.PI / 2; selectRing.position.y = 0.03; scene.add(selectRing);
    }
    if (p.kind === 'building') {
      const def = FARM_BUILDINGS.find(b => b.id === p.id); const w = tileToWorld(def.plot.x + def.plot.w / 2, def.plot.y + def.plot.h / 2);
      selectRing.position.set(w.x, 0.03, w.z); const r = Math.max(def.plot.w, def.plot.h) * 0.62; selectRing.scale.set(r, r, 1);
      selectRing.visible = true;
    } else selectRing.visible = false;
  }

  /* ── loop ── */
  let last = performance.now(), alive = true, rafId = 0, timerId = 0, flashAt = 0;
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
    spinners.forEach(h => { h.rotation.z += dt * 1.1; });
    Object.values(truckNodes).forEach(n => { n.g.position.y = Math.abs(Math.sin(t / 90)) * 0.02; });
    if (rain) {
      const pos = rain.geometry.attributes.position.array;
      for (let i = 0; i < rainVel.length; i++) { pos[i * 3 + 1] -= rainVel[i] * dt; if (pos[i * 3 + 1] < 0) pos[i * 3 + 1] = 12; }
      rain.geometry.attributes.position.needsUpdate = true;
      if (view && view.weather && view.weather.key === 'storm' && t - flashAt > 4000 + Math.random() * 6000) { flashAt = t; hemi.intensity = 2.5; setTimeout(() => { if (alive) hemi.intensity = (FARM_LOOKS.sky[(view.look || {}).sky] || FARM_LOOKS.sky.day).hemi; }, 120); }
    }
    for (let i = actorList.length - 1; i >= 0; i--) { const a = actorList[i]; a.tick(t, dt); if (t - a.t0 > 12000) { actors.remove(a.g); actorList.splice(i, 1); } }
    if (selectRing && selectRing.visible) selectRing.material.opacity = 0.6 + 0.3 * Math.sin(t / 300);
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(frame);
  };
  rafId = requestAnimationFrame(frame);
  timerId = setInterval(() => { if (alive && !cv.isConnected) destroy(); }, 1500);

  const onResize = () => { try { renderer.setSize(W(), Hh()); camera.aspect = W() / Hh(); camera.updateProjectionMatrix(); } catch (e) {} };
  window.addEventListener('resize', onResize);
  let ro = null; try { ro = new ResizeObserver(onResize); ro.observe(container); } catch (e) {}

  function destroy() {
    if (!alive) return; alive = false;
    try { cancelAnimationFrame(rafId); clearInterval(timerId); } catch (e) {}
    try { window.removeEventListener('resize', onResize); if (ro) ro.disconnect(); } catch (e) {}
    try { scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { const ms = [].concat(o.material); ms.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); } }); } catch (e) {}
    try { if (scene.background && scene.background.dispose) scene.background.dispose(); } catch (e) {}
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
    v.animals.forEach(a => { live.add(a.id); if (!wanderers[a.id]) { const d = animalDef(a.sp), pen = FARM_BUILDINGS.find(b => b.id === d.pen); wanderers[a.id] = { w: new Wanderer(a, yardOf(pen)), a }; } else wanderers[a.id].a = a; });
    Object.keys(wanderers).forEach(id => { if (!live.has(+id)) delete wanderers[id]; });
  }
  const hx = (n) => '#' + (n | 0).toString(16).padStart(6, '0');
  const draw = (dt) => {
    const { ox, oy, t } = origin();
    const G = view && view.look ? (FARM_LOOKS.ground[view.look.ground] || FARM_LOOKS.ground.meadow) : FARM_LOOKS.ground.meadow;
    ctx.fillStyle = '#1a2233'; ctx.fillRect(0, 0, cv.width, cv.height);
    for (let y = 0; y < FARM_GRID.h; y++) for (let x = 0; x < FARM_GRID.w; x++) { ctx.fillStyle = ((x + y) & 1) ? hx(G.a) : hx(G.b); ctx.fillRect(ox + x * t, oy + y * t, t, t); }
    if (!view) return;
    FARM_BUILDINGS.forEach(def => {
      const row = view.buildings[def.id];
      if (def.yard && row) { ctx.strokeStyle = '#7a5a3a'; ctx.lineWidth = 3; ctx.strokeRect(ox + def.yard.x * t, oy + def.yard.y * t, def.yard.w * t, def.yard.h * t); }
      ctx.fillStyle = row ? ((view.look && view.look.roofs && view.look.roofs[def.id]) || def.accent) : 'rgba(255,255,255,0.12)';
      ctx.fillRect(ox + def.plot.x * t + 2, oy + def.plot.y * t + 2, def.plot.w * t - 4, def.plot.h * t - 4);
      ctx.fillStyle = '#f4efe4'; ctx.font = Math.floor(t * 0.7) + 'px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(def.emoji, ox + (def.plot.x + def.plot.w / 2) * t, oy + (def.plot.y + def.plot.h / 2) * t);
      ctx.font = Math.floor(t * 0.3) + 'px system-ui'; ctx.fillText(row ? (row.damaged ? '🌪 L' + row.level : 'L' + row.level) : 'build', ox + (def.plot.x + def.plot.w / 2) * t, oy + (def.plot.y + def.plot.h) * t - t * 0.2);
    });
    Object.keys(wanderers).forEach(id => {
      const n = wanderers[id]; n.w.step(dt); const d = animalDef(n.a.sp);
      ctx.font = Math.floor(t * (0.45 + 0.35 * d.size)) + 'px system-ui'; ctx.fillText(d.emoji, ox + n.w.x * t, oy + n.w.z * t);
      if (n.a.prize) { ctx.font = Math.floor(t * 0.35) + 'px system-ui'; ctx.fillText('🏅', ox + n.w.x * t, oy + n.w.z * t - t * 0.45); }
    });
    if (view.weather && (view.weather.key === 'rain' || view.weather.key === 'storm')) { ctx.fillStyle = 'rgba(120,150,200,0.18)'; ctx.fillRect(0, 0, cv.width, cv.height); }
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
