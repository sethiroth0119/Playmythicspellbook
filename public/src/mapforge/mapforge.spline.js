/* mapforge.spline.js — splines: roads, walls, fences, rows of trees, paths.

   Unreal's spline component and Unity's spline package do one thing map
   makers reach for constantly: draw a curve on the ground and have a mesh
   follow it. A spline here is an ordinary object (`t: 'spline'`) whose body
   is GENERATED from its control points (`sp.pts`, relative to the object's
   position) and its mode:

     mesh     the source prop/model is repeated along the curve and, by
              default, BENT to it (vertices are mapped onto the arc length:
              a straight road slab becomes a curved road). `stretch` scales
              the pieces so a whole number of them fill the curve exactly.
     scatter  the source is dropped every `gap` metres (jitter, random yaw,
              optionally aligned to the curve) — tree lines, lamp posts.
     terrain  nothing solid: a ribbon shows the path; "Apply to terrain"
              flattens the ground to the curve and paints a layer under it
              (dirt tracks, river beds) through the terrain's own brush so
              the result is undoable like any sculpt stroke.

   Curves are Catmull-Rom (tension 0.5 default), resampled by arc length so
   spacing is even regardless of where the control points sit. Grounded
   splines (`o.g`) read the terrain height at every sample — the control
   points' y is ignored — so a road hugs hills. Splines never collide (a
   single box around a curve would be wrong) and are never instanced
   (unique geometry); see the catalogue entry in mapforge.props.js. */

import { PAINT } from './mapforge.format.js';

export const SPLINE_MODES = ['mesh', 'scatter', 'terrain'];

/* Library presets — what the Splines category offers. `src` names a built-in
   prop; the editor swaps in whatever the Library has picked for "Custom". */
export const SPLINE_PRESETS = [
  { id: 'road',     label: 'Road',        icon: '🛣️', mode: 'mesh',    src: { t: 'road' },     gap: 8,  w: 4,   deform: true,  stretch: true,  tags: ['road', 'asphalt', 'city', 'street'] },
  { id: 'wall',     label: 'Stone wall',  icon: '🧱', mode: 'mesh',    src: { t: 'wall' },     gap: 4,  w: 0.6, deform: true,  stretch: true,  tags: ['stone', 'barrier', 'castle'] },
  { id: 'fence',    label: 'Fence line',  icon: '🪵', mode: 'mesh',    src: { t: 'fence' },    gap: 3,  w: 0.3, deform: false, stretch: true,  tags: ['wood', 'barrier', 'farm'] },
  { id: 'barrier',  label: 'Barriers',    icon: '🚧', mode: 'mesh',    src: { t: 'barrier' },  gap: 2.4, w: 0.6, deform: false, stretch: true, tags: ['concrete', 'road', 'block'] },
  { id: 'trees',    label: 'Tree line',   icon: '🌳', mode: 'scatter', src: { t: 'tree' },     gap: 4,  w: 1.5, jitter: 0.4, align: false, tags: ['plant', 'forest', 'avenue'] },
  { id: 'pines',    label: 'Pine row',    icon: '🌲', mode: 'scatter', src: { t: 'pine' },     gap: 3.5, w: 1,  jitter: 0.3, align: false, tags: ['plant', 'forest'] },
  { id: 'lamps',    label: 'Lamp posts',  icon: '🪔', mode: 'scatter', src: { t: 'lamppost' }, gap: 9,  w: 0,   jitter: 0,   align: true,  tags: ['light', 'street', 'city'] },
  { id: 'lanterns', label: 'Lantern row', icon: '🏮', mode: 'scatter', src: { t: 'lantern' },  gap: 6,  w: 0,   jitter: 0,   align: true,  tags: ['light', 'village', 'night'] },
  { id: 'pillars',  label: 'Colonnade',   icon: '🏛️', mode: 'scatter', src: { t: 'pillar' },   gap: 3,  w: 0,   jitter: 0,   align: true,  tags: ['stone', 'temple'] },
  { id: 'track',    label: 'Dirt track',  icon: '🐾', mode: 'terrain', paint: 2, w: 3,  dy: 0,    tags: ['ground', 'path', 'dirt'] },
  { id: 'path',     label: 'Stone path',  icon: '🧭', mode: 'terrain', paint: 6, w: 2,  dy: 0,    tags: ['ground', 'path', 'stone'] },
  { id: 'river',    label: 'River bed',   icon: '🏞️', mode: 'terrain', paint: 7, w: 6,  dy: -1.2, tags: ['water', 'ground', 'mud'] },
  { id: 'custom',   label: 'Custom (library pick)', icon: '〰️', mode: 'mesh', src: null, gap: 4, w: 1, deform: true, stretch: true, tags: ['any'] },
];
export const SPLINE_PRESET_BY_ID = Object.fromEntries(SPLINE_PRESETS.map(p => [p.id, p]));

const num = (v, lo, hi, d) => { v = +v; return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };

/* Schema. Anything goes in, a valid spline (or null when there are fewer
   than two points) comes out. */
export function normalizeSpline(sp, assetIds) {
  if (!sp || typeof sp !== 'object') return null;
  const pts = (Array.isArray(sp.pts) ? sp.pts : []).map(p => Array.isArray(p) && p.length >= 3 ? [num(p[0], -5000, 5000, 0), num(p[1], -5000, 5000, 0), num(p[2], -5000, 5000, 0)] : null).filter(Boolean).slice(0, 200);
  if (pts.length < 2) return null;
  const out = {
    pts,
    closed: sp.closed === true,
    mode: SPLINE_MODES.includes(sp.mode) ? sp.mode : 'mesh',
    gap: num(sp.gap, 0.2, 60, 4),
    w: num(sp.w, 0, 40, 1),
    tension: num(sp.tension, 0, 1, 0.5),
  };
  if (sp.src && typeof sp.src === 'object' && sp.src.t) {
    const src = { t: String(sp.src.t).slice(0, 40) };
    if (src.t === 'glb') { if (!sp.src.a || (assetIds && !assetIds.has(String(sp.src.a)))) src.t = 'placeholder'; else src.a = String(sp.src.a); }
    if (sp.src.c && /^#[0-9a-f]{6}$/i.test(sp.src.c)) src.c = sp.src.c.toLowerCase();
    out.src = src;
  }
  if (out.mode === 'mesh') { out.deform = sp.deform !== false; out.stretch = sp.stretch !== false; if (sp.axis === 'x' || sp.axis === 'z') out.axis = sp.axis; }
  if (out.mode === 'scatter') { out.jitter = num(sp.jitter, 0, 1, 0.3); out.align = sp.align === true; out.seed = num(sp.seed, 0, 1e9, 1) | 0; }
  if (out.mode === 'terrain') { out.paint = num(sp.paint, 0, PAINT.length - 1, 2) | 0; out.dy = num(sp.dy, -20, 20, 0); }
  return out;
}

/* Catmull-Rom through the points, resampled every `step` metres by arc
   length. Returns { pts: [{x,y,z,tx,ty,tz,s}], length }. Each sample carries
   the unit tangent and its arc-length position `s`. */
export function sampleSpline(pts, closed, tension, step) {
  const n = pts.length; if (n < 2) return { pts: [], length: 0 };
  tension = tension == null ? 0.5 : tension; step = Math.max(0.05, step || 0.5);
  const P = (i) => { if (closed) return pts[((i % n) + n) % n]; return pts[Math.max(0, Math.min(n - 1, i))]; };
  const segs = closed ? n : n - 1;
  // dense polyline first (16 per segment), then walk it by arc length
  const dense = [];
  for (let i = 0; i < segs; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const K = 16;
    for (let k = 0; k < K; k++) {
      const t = k / K, t2 = t * t, t3 = t2 * t;
      const out = [0, 0, 0];
      for (let a = 0; a < 3; a++) {
        const m1 = (p2[a] - p0[a]) * tension, m2 = (p3[a] - p1[a]) * tension;
        out[a] = (2 * t3 - 3 * t2 + 1) * p1[a] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[a] + (t3 - t2) * m2;
      }
      dense.push(out);
    }
  }
  dense.push(closed ? dense[0].slice() : pts[n - 1].slice());
  // cumulative length
  const cum = [0]; for (let i = 1; i < dense.length; i++) { const a = dense[i - 1], b = dense[i]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])); }
  const length = cum[cum.length - 1];
  const at = (s) => {   // position + tangent at arc length s
    s = Math.max(0, Math.min(length, s));
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
    const a = dense[lo], b = dense[Math.min(dense.length - 1, lo + 1)], L = cum[hi] - cum[lo] || 1, f = (s - cum[lo]) / L;
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, z: a[2] + (b[2] - a[2]) * f, tx, ty, tz, s };
  };
  const out = []; for (let s = 0; s < length; s += step) out.push(at(s)); out.push(at(length));
  return { pts: out, length, at };
}

/* Mulberry32 — deterministic jitter so a scatter spline looks the same on
   every open and in the game. */
function rng(seed) { let a = (seed | 0) + 0x6d2b79f5; return () => { a |= 0; a = a + 0x6d2b79f5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/* Build the body. ctx:
     THREE, source(src) → a fresh Object3D of the source (prop clone / model
     template clone / placeholder), heightAt(x, z) world height or null,
     origin [x, y, z] — the object's position (samples are in its local
     frame; height is read in world space). */
export function buildSpline(o, ctx) {
  const { THREE } = ctx; const sp = o.sp; const g = new THREE.Group(); g.userData.mfSpline = true;
  if (!sp || sp.pts.length < 2) return g;
  const ox = o.p[0], oy = o.p[1], oz = o.p[2];
  const groundY = (x, z) => (o.g !== false && ctx.heightAt) ? ctx.heightAt(x + ox, z + oz) - oy : null;
  const lift = (pt) => { const gy = groundY(pt.x, pt.z); return gy == null ? pt.y : gy; };
  const step = Math.max(0.25, Math.min(1, sp.gap / 8));
  const curve = sampleSpline(sp.pts, sp.closed, sp.tension, step);
  if (!curve.length) return g;
  // ground-follow: rewrite sample heights after sampling so the XZ curve is unchanged
  curve.pts.forEach(pt => { pt.y = lift(pt); });
  const atS = (s) => { const p = curve.at(s); p.y = lift(p); return p; };

  if (sp.mode === 'terrain') {
    g.add(ribbon(THREE, curve.pts, Math.max(0.4, sp.w), PAINT[sp.paint] ? PAINT[sp.paint].color : '#8a6a44'));
    return g;
  }
  const src = sp.src && sp.src.t ? sp.src : { t: 'placeholder' };
  if (sp.mode === 'scatter') {
    const rnd = rng(sp.seed || 1);
    const gap = Math.max(0.2, sp.gap), count = Math.min(400, Math.floor(curve.length / gap) + 1);
    for (let i = 0; i < count; i++) {
      const s = Math.min(curve.length, i * gap + (rnd() - 0.5) * gap * sp.jitter);
      const p = atS(s);
      const nx = -p.tz, nz = p.tx;   // left normal
      const lat = (rnd() * 2 - 1) * sp.w * 0.5;
      const inst = ctx.source(src); if (!inst) continue;
      const x = p.x + nx * lat, z = p.z + nz * lat;
      const gy = groundY(x, z);
      inst.position.set(x, gy == null ? p.y : gy, z);
      inst.rotation.y = sp.align ? Math.atan2(p.tx, p.tz) : rnd() * Math.PI * 2;
      if (sp.jitter > 0) { const k = 1 + (rnd() * 2 - 1) * sp.jitter * 0.35; inst.scale.multiplyScalar(k); }
      g.add(inst);
    }
    return g;
  }
  // mesh mode
  const tpl = ctx.source(src); if (!tpl) return g;
  tpl.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(tpl); if (bb.isEmpty()) return g;
  const size = new THREE.Vector3(); bb.getSize(size);
  const axis = sp.axis || (size.x >= size.z ? 'x' : 'z');      // forward axis of the source: its longer horizontal side
  const F = axis === 'x' ? 'x' : 'z', L = axis === 'x' ? 'z' : 'x';
  const len = Math.max(0.05, size[F]), f0 = bb.min[F], lc = (bb.min[L] + bb.max[L]) / 2, y0 = bb.min.y;
  const total = curve.length; if (total < 0.05) return g;
  let count = Math.max(1, Math.round(total / len)); if (!sp.stretch) count = Math.max(1, Math.floor(total / len));
  count = Math.min(300, count);
  const k = sp.stretch ? total / (count * len) : 1;
  if (!sp.deform) {
    for (let i = 0; i < count; i++) {
      const s = (i + 0.5) * len * k; if (s > total + 1e-6) break;
      const p = atS(s), inst = ctx.source(src);
      inst.position.set(p.x, p.y, p.z);
      // yaw so the source's forward axis lies along the tangent
      const yaw = Math.atan2(p.tx, p.tz); inst.rotation.y = axis === 'x' ? yaw - Math.PI / 2 : yaw;
      if (axis === 'x') inst.scale.x *= k; else inst.scale.z *= k;
      inst.position.y -= y0;
      g.add(inst);
    }
    return g;
  }
  /* Deform: every mesh of the template, every piece, vertex → curve frame.
     Geometries are merged per material so a 40-piece road is a handful of
     draw calls, not 200. Only position / normal / uv survive the merge. */
  const byMat = new Map();
  const meshes = []; tpl.traverse(m => { if (m.isMesh && m.geometry && m.geometry.attributes.position) meshes.push(m); });
  const v = new THREE.Vector3();
  for (const m of meshes) {
    const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const groups = geo.groups && geo.groups.length ? geo.groups : [{ start: 0, count: pos.count, materialIndex: 0 }];
    for (const grp of groups) {
      const mat = mats[grp.materialIndex] || mats[0];
      let acc = byMat.get(mat); if (!acc) { acc = { p: [], u: [] }; byMat.set(mat, acc); }
      for (let i = 0; i < count; i++) {
        const s0 = i * len * k;
        for (let vi = grp.start; vi < grp.start + grp.count; vi++) {
          v.fromBufferAttribute(pos, vi).applyMatrix4(m.matrixWorld);
          const f = (v[F] - f0) * k + s0, lat = v[L] - lc, h = v.y - y0;
          const p = atS(f);
          const nx = -p.tz, nz = p.tx;
          acc.p.push(p.x + nx * lat, p.y + h, p.z + nz * lat);
          if (uv) acc.u.push(uv.getX(vi), uv.getY(vi)); else acc.u.push(0, 0);
        }
      }
    }
  }
  byMat.forEach((acc, mat) => {
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(acc.p, 3));
    bg.setAttribute('uv', new THREE.Float32BufferAttribute(acc.u, 2));
    bg.computeVertexNormals();
    const mesh = new THREE.Mesh(bg, mat); mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.mfSplineMesh = true;
    g.add(mesh);
  });
  return g;
}

/* The translucent ribbon a terrain-mode spline shows (and the editor's path preview). */
export function ribbon(THREE, samples, w, color, opts) {
  opts = opts || {};
  const n = samples.length, pos = new Float32Array(n * 2 * 3), idx = [];
  for (let i = 0; i < n; i++) {
    const p = samples[i], nx = -p.tz, nz = p.tx, h = w / 2, y = p.y + (opts.lift == null ? 0.06 : opts.lift);
    pos.set([p.x + nx * h, y, p.z + nz * h, p.x - nx * h, y, p.z - nz * h], i * 6);
    if (i) idx.push((i - 1) * 2, (i - 1) * 2 + 1, i * 2, (i - 1) * 2 + 1, i * 2 + 1, i * 2);
  }
  const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); bg.setIndex(idx); bg.computeVertexNormals();
  const m = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opts.opacity == null ? 0.55 : opts.opacity, depthWrite: false, side: THREE.DoubleSide }));
  m.renderOrder = 5; m.userData.mfRibbon = true;
  return m;
}

/* Flatten + paint the terrain under the curve through its brush, so the
   change is a normal terrain edit (undo via snapshot/restore). `dy` sinks or
   raises the bed relative to the ground the curve read on entry. Returns the
   number of brush applications. */
export function applySplineToTerrain(terrain, o, opts) {
  const sp = o.sp; if (!sp || sp.pts.length < 2) return 0;
  opts = opts || {};
  const w = Math.max(terrain.cell * 0.6, sp.mode === 'terrain' ? sp.w : (sp.w || 1));
  const curve = sampleSpline(sp.pts, sp.closed, sp.tension, Math.max(0.3, Math.min(terrain.cell * 0.5, w * 0.4)));
  const dy = sp.mode === 'terrain' ? (sp.dy || 0) : 0, paint = sp.mode === 'terrain' ? sp.paint : (opts.paint == null ? null : opts.paint);
  // target heights first (read before any flattening so later samples don't chase earlier edits)
  const targets = curve.pts.map(p => ({ x: p.x + o.p[0], z: p.z + o.p[2], y: (o.g !== false ? terrain.heightAt(p.x + o.p[0], p.z + o.p[2]) : p.y + o.p[1]) + dy }));
  // smooth the target profile so the road grade is gentle
  for (let pass = 0; pass < 2; pass++) for (let i = 1; i < targets.length - 1; i++) targets[i].y = (targets[i - 1].y + targets[i].y * 2 + targets[i + 1].y) / 4;
  let n = 0;
  const rad = w / 2 + terrain.cell * 0.5;
  if (opts.flatten !== false) targets.forEach(t => { terrain.applyBrush({ x: t.x, z: t.z, radius: rad, strength: 1, falloff: 0.35, mode: 'flatten', target: t.y }); n++; });
  if (paint != null) targets.forEach(t => { terrain.applyBrush({ x: t.x, z: t.z, radius: w / 2 + terrain.cell * 0.25, strength: 1, falloff: 0.05, mode: 'paint', paint }); n++; });
  return n;
}
