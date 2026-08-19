(() => {
const nc = window.__nc;
if (!nc) return { err: 'no __nc' };
const { renderer, scene, camera, THREE } = nc.three();
const out = { images: {}, notes: [] };

/* ── 1. frame an aerial derived from the placed meshes, exactly as capture.mjs
      does, so the crop cannot drift out of the picture ───────────────────── */
const box = { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 };
for (const t of Object.values(nc.game.tiles)) {
  if (!t.mesh) continue;
  const p = t.mesh.position;
  box.x0 = Math.min(box.x0, p.x); box.x1 = Math.max(box.x1, p.x);
  box.z0 = Math.min(box.z0, p.z); box.z1 = Math.max(box.z1, p.z);
}
const cx = (box.x0 + box.x1) / 2, cz = (box.z0 + box.z1) / 2;
const span = Math.max(box.x1 - box.x0, box.z1 - box.z0);
try { const c = nc.controls; c.maxPolarAngle = Math.PI * .4995; c.minDistance = .05; c.enableDamping = false; } catch (e) {}
camera.position.set(cx + span * .62, span * .55, cz + span * .62);
try { nc.controls.target.set(cx, 0, cz); } catch (e) {}
camera.lookAt(cx, 0, cz);
camera.updateMatrixWorld(); camera.updateProjectionMatrix();
try { nc.cullAgents(90); } catch (e) {}
out.frame = { box, cx, cz, span };

/* ── 2. find the flat data planes by their signature: a PlaneGeometry laid
      flat at a sub-metre y with a CanvasTexture map ───────────────────────── */
const planes = [];
scene.traverse(o => {
  if (!o.isMesh || !o.material || !o.material.map) return;
  if (!o.geometry || !o.geometry.type || o.geometry.type !== 'PlaneGeometry') return;
  if (Math.abs(o.rotation.x + Math.PI / 2) > 0.01) return;
  if (o.position.y > 1) return;
  planes.push(o);
});
const describe = m => ({
  y: +m.position.y.toFixed(4), renderOrder: m.renderOrder, visible: m.visible,
  transparent: m.material.transparent, opacity: m.material.opacity,
  depthTest: m.material.depthTest, depthWrite: m.material.depthWrite,
  blending: m.material.blending, side: m.material.side,
  toneMapped: m.material.toneMapped, frustumCulled: m.frustumCulled,
  mapW: m.material.map.image ? m.material.map.image.width : null,
  geoW: m.geometry.parameters ? m.geometry.parameters.width : null,
  inScene: (() => { let p = m, n = 0; while (p) { if (p === scene) return true; p = p.parent; n++; if (n > 40) break; } return false; })(),
});
out.planes = planes.map(describe);

const LVy = 0.105, Wy = 0.075;
const lvPlane = planes.find(p => Math.abs(p.position.y - LVy) < 1e-3) || null;
const wPlane  = planes.find(p => Math.abs(p.position.y - Wy)  < 1e-3) || null;
out.found = { lv: !!lvPlane, water: !!wPlane };

/* ── 3. pixel lift. drawImage IN THE SAME TASK as render() — the drawing
      buffer is not preserved, so anything later reads a cleared canvas. ──── */
const gl = renderer.domElement;
const CW = gl.width, CH = gl.height;
const scratch = document.createElement('canvas'); scratch.width = CW; scratch.height = CH;
const sctx = scratch.getContext('2d', { willReadFrequently: true });
function shoot() {
  renderer.render(scene, camera);
  sctx.clearRect(0, 0, CW, CH);
  sctx.drawImage(gl, 0, 0, CW, CH);
  return sctx.getImageData(0, 0, CW, CH);
}
function shootNoRender() {           // the SUSPECTED broken measurement
  sctx.clearRect(0, 0, CW, CH);
  sctx.drawImage(gl, 0, 0, CW, CH);
  return sctx.getImageData(0, 0, CW, CH);
}
function diff(a, b, r) {
  const x0 = r ? r.x0 : 0, x1 = r ? r.x1 : CW, y0 = r ? r.y0 : 0, y1 = r ? r.y1 : CH;
  let n = 0, tot = 0, sum = 0, maxd = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * CW + x) * 4;
    const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i+1] - b.data[i+1]) + Math.abs(a.data[i+2] - b.data[i+2]);
    tot++; sum += d; if (d > 12) n++; if (d > maxd) maxd = d;
  }
  return { changed: n, of: tot, pct: +(100 * n / tot).toFixed(2), meanDelta: +(sum / tot).toFixed(2), maxDelta: maxd };
}
function png(img, r) {
  const w = r.x1 - r.x0, h = r.y1 - r.y0;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const cc = c.getContext('2d');
  const s = document.createElement('canvas'); s.width = CW; s.height = CH;
  s.getContext('2d').putImageData(img, 0, 0);
  cc.drawImage(s, r.x0, r.y0, w, h, 0, 0, w, h);
  return c.toDataURL('image/png');
}

/* ── 4. derive the crop from tile centres projected through THIS camera.
      Two crops: the whole district, and UNBUILT ground only (§5 of the
      gauntlet README — a ground film has nothing to draw on under a tower). */
const HALF = 12;
const v = new THREE.Vector3();
function proj(tx, tz) {
  v.set(tx - HALF + .5, 0.105, tz - HALF + .5).project(camera);
  return { x: Math.round((v.x * .5 + .5) * CW), y: Math.round((-v.y * .5 + .5) * CH) };
}
function bboxOf(tiles) {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const [tx, tz] of tiles) { const p = proj(tx, tz);
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const pad = 16;
  return { x0: Math.max(0, x0 - pad), x1: Math.min(CW, x1 + pad), y0: Math.max(0, y0 - pad), y1: Math.min(CH, y1 + pad) };
}
const allT = [], freeT = [];
for (let tz = 3; tz < 21; tz++) for (let tx = 3; tx < 21; tx++) {
  allT.push([tx, tz]);
  if (!nc.game.tiles[tx + ',' + tz]) freeT.push([tx, tz]);
}
out.freeTiles = freeT.length;
const cropAll  = bboxOf(allT);
const cropFree = bboxOf(freeT);
out.crops = { all: cropAll, free: cropFree };

/* a single free tile the camera can see, for a tight crop that is provably
   bare ground — the §5 lesson, taken literally */
let tight = null;
for (const [tx, tz] of freeT) {
  const p = proj(tx, tz);
  if (p.x > 200 && p.x < CW - 200 && p.y > 150 && p.y < CH - 150) { tight = { tx, tz, p }; break; }
}
if (tight) {
  const c = tight.p;
  out.tight = { tile: [tight.tx, tight.tz], rect: { x0: c.x - 110, x1: c.x + 110, y0: c.y - 80, y1: c.y + 80 } };
}

/* ── 5. THE A/B. Landvalue first. ─────────────────────────────────────────── */
function abFor(label, plane, openFn, closeFn) {
  const r = { label };
  if (!plane) { r.err = 'plane not found'; return r; }
  try { openFn(); } catch (e) { r.openErr = String(e); }
  r.afterOpen = describe(plane);
  // canvas content check: is the texture actually painted?
  try {
    const im = plane.material.map.image;
    const t = document.createElement('canvas'); t.width = im.width; t.height = im.height;
    t.getContext('2d').drawImage(im, 0, 0);
    const d = t.getContext('2d').getImageData(0, 0, im.width, im.height).data;
    let nz = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) nz++;
    r.texPaintedPx = nz; r.texTotalPx = d.length / 4;
  } catch (e) { r.texErr = String(e); }

  plane.visible = true;
  const A = shoot();
  // 🔴 THE CONTROL: toggle .visible and DO NOT render — the suspected bug.
  plane.visible = false;
  const Bnr = shootNoRender();
  r.noRender = diff(A, Bnr, cropAll);
  // and now the honest one: render between the toggles.
  const B = shoot();
  r.full     = diff(A, B, null);
  r.district = diff(A, B, cropAll);
  r.bare     = diff(A, B, cropFree);
  if (out.tight) r.tight = diff(A, B, out.tight.rect);
  // control: two renders with NOTHING changed
  const C = shoot();
  r.control  = diff(B, C, cropAll);
  out.images[label + '-on']  = png(A, out.tight ? out.tight.rect : cropAll);
  out.images[label + '-off'] = png(B, out.tight ? out.tight.rect : cropAll);
  out.images[label + '-on-wide']  = png(A, cropAll);
  out.images[label + '-off-wide'] = png(B, cropAll);
  plane.visible = true;
  try { closeFn(); } catch (e) {}
  return r;
}

out.lv = abFor('lv', lvPlane,
  () => { nc.landValuePanel(true); },
  () => {});
out.water = abFor('water', wPlane,
  () => { nc.waterPanel(true); },
  () => {});

/* ── 6. and the isolation control: hide EVERYTHING but the lv plane ─────── */
if (lvPlane) {
  const hidden = [];
  scene.traverse(o => { if (o.isMesh && o !== lvPlane && o.visible) { hidden.push(o); o.visible = false; } });
  lvPlane.visible = true;
  const solo = shoot();
  let painted = 0;
  for (let i = 0; i < solo.data.length; i += 4) if (solo.data[i+3] > 0 && (solo.data[i] + solo.data[i+1] + solo.data[i+2]) > 24) painted++;
  out.soloPaintedPx = painted;
  out.images['lv-solo'] = png(solo, out.crops.all);
  for (const o of hidden) o.visible = true;
}
try { nc.landValuePanel(true); } catch (e) {}
renderer.render(scene, camera);
return out;
})()
