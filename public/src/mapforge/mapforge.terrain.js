/* mapforge.terrain.js — the sculptable heightfield.

   The map document (`map.terrain`) is the source of truth: `heights` and
   `paint` are plain arrays there so they serialise as JSON. This module owns
   the THREE mesh that MIRRORS them — brushes edit the arrays, then push the
   change into the geometry. Nothing here knows about the editor UI.

   Vertex layout: index = row * (n+1) + col, x = -half + col*cell,
   z = -half + row*cell. Keeping it this simple is why heightAt() is a
   ten-line bilinear lookup and the runtime can walk a player over the map
   without a physics engine. */

import { PAINT, makeNoise } from './mapforge.format.js';

export function createTerrain(THREE, t) {
  let n, cell, half, size, W;
  let geo, pos, col, norm, mesh;
  const rockCol = new THREE.Color(PAINT[4].color);
  const palette = PAINT.map(p => new THREE.Color(p.color));
  const noiseTex = makeNoiseTexture(THREE);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, map: noiseTex, roughness: 0.96, metalness: 0 });
  const api = {};

  function bind() {
    n = t.n; cell = t.cell; size = n * cell; half = size / 2; W = n + 1;
    noiseTex.repeat.set(n / 3, n / 3);
  }

  function buildGeometry() {
    if (geo) geo.dispose();
    geo = new THREE.BufferGeometry();
    const verts = W * W;
    pos = new Float32Array(verts * 3); col = new Float32Array(verts * 3); const uv = new Float32Array(verts * 2);
    for (let r = 0; r < W; r++) for (let c = 0; c < W; c++) {
      const i = r * W + c;
      pos[i * 3] = -half + c * cell; pos[i * 3 + 1] = t.heights[i]; pos[i * 3 + 2] = -half + r * cell;
      uv[i * 2] = c / n; uv[i * 2 + 1] = 1 - r / n;
    }
    const idx = new Uint32Array(n * n * 6); let k = 0;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const a = r * W + c, b = a + 1, d = a + W, e = d + 1;
      // alternate the diagonal so long ridges don't show a stair-step
      if ((r + c) & 1) { idx[k++] = a; idx[k++] = d; idx[k++] = b; idx[k++] = b; idx[k++] = d; idx[k++] = e; }
      else { idx[k++] = a; idx[k++] = d; idx[k++] = e; idx[k++] = a; idx[k++] = e; idx[k++] = b; }
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    norm = geo.attributes.normal.array;
    if (!mesh) { mesh = new THREE.Mesh(geo, material); mesh.receiveShadow = true; mesh.castShadow = false; mesh.name = 'mf-terrain'; mesh.userData.mfTerrain = true; }
    else mesh.geometry = geo;
    recolor();
  }

  function pushHeights() {
    for (let i = 0; i < W * W; i++) pos[i * 3 + 1] = t.heights[i];
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
    norm = geo.attributes.normal.array;
    geo.computeBoundingSphere(); geo.computeBoundingBox();
  }

  /* Vertex colour = paint layer × slope. Steep faces fade toward rock the
     way real cliffs shed soil; a little seeded noise stops flat grass from
     reading as a single flat green. */
  const tmp = new THREE.Color();
  function recolor() {
    for (let i = 0; i < W * W; i++) {
      const base = palette[t.paint[i]] || palette[0];
      const ny = norm[i * 3 + 1];
      const steep = Math.max(0, Math.min(1, (0.86 - ny) / 0.3));
      tmp.copy(base).lerp(rockCol, steep * 0.85);
      const nz = 0.92 + 0.16 * hash(i);
      col[i * 3] = tmp.r * nz; col[i * 3 + 1] = tmp.g * nz; col[i * 3 + 2] = tmp.b * nz;
    }
    geo.attributes.color.needsUpdate = true;
  }

  function heightAt(x, z) {
    const gx = (x + half) / cell, gz = (z + half) / cell;
    if (gx < 0 || gz < 0 || gx > n || gz > n) return 0;
    const c0 = Math.min(Math.floor(gx), n - 1), r0 = Math.min(Math.floor(gz), n - 1);
    const fx = gx - c0, fz = gz - r0;
    const h = t.heights, i = r0 * W + c0;
    return (h[i] * (1 - fx) + h[i + 1] * fx) * (1 - fz) + (h[i + W] * (1 - fx) + h[i + W + 1] * fx) * fz;
  }

  /* One brush application. `mode`: raise | lower | smooth | flatten | paint.
     `falloff` 0..1 = how soft the edge is. Returns true if anything changed. */
  function applyBrush(b) {
    const rad = Math.max(cell * 0.5, b.radius), r2 = rad * rad;
    const cMin = Math.max(0, Math.floor((b.x - rad + half) / cell)), cMax = Math.min(n, Math.ceil((b.x + rad + half) / cell));
    const rMin = Math.max(0, Math.floor((b.z - rad + half) / cell)), rMax = Math.min(n, Math.ceil((b.z + rad + half) / cell));
    if (cMin > cMax || rMin > rMax) return false;
    const h = t.heights, p = t.paint, soft = Math.max(0.02, b.falloff == null ? 0.6 : b.falloff);
    let changed = false;
    let smoothSrc = null;
    if (b.mode === 'smooth') smoothSrc = h.slice();
    for (let r = rMin; r <= rMax; r++) for (let c = cMin; c <= cMax; c++) {
      const x = -half + c * cell, z = -half + r * cell, dx = x - b.x, dz = z - b.z, d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      const d = Math.sqrt(d2) / rad;                 // 0 centre … 1 edge
      const w = d < 1 - soft ? 1 : smooth01((1 - d) / soft);   // flat core, soft rim
      const i = r * W + c;
      switch (b.mode) {
        case 'raise':   h[i] += b.strength * w; changed = true; break;
        case 'lower':   h[i] -= b.strength * w; changed = true; break;
        case 'flatten': h[i] += (b.target - h[i]) * Math.min(1, w * b.strength * 2); changed = true; break;
        case 'smooth': {
          let sum = 0, cnt = 0;
          for (let rr = -1; rr <= 1; rr++) for (let cc = -1; cc <= 1; cc++) {
            const r1 = r + rr, c1 = c + cc; if (r1 < 0 || c1 < 0 || r1 > n || c1 > n) continue;
            sum += smoothSrc[r1 * W + c1]; cnt++;
          }
          h[i] += (sum / cnt - h[i]) * Math.min(1, w * b.strength * 2); changed = true; break;
        }
        case 'paint':
          if (w >= (1 - Math.min(1, b.strength)) - 0.0001 && p[i] !== b.paint) { p[i] = b.paint; changed = true; }
          break;
      }
    }
    if (!changed) return false;
    if (b.mode === 'paint') recolor(); else { pushHeights(); recolor(); }
    return true;
  }

  function snapshot() { return { heights: Float32Array.from(t.heights), paint: Uint8Array.from(t.paint), n, cell }; }
  function restore(s) {
    if (!s) return;
    if (s.n !== t.n || s.cell !== t.cell) { t.n = s.n; t.cell = s.cell; t.heights = Array.from(s.heights); t.paint = Array.from(s.paint); api.rebuild(); return; }
    for (let i = 0; i < W * W; i++) { t.heights[i] = s.heights[i]; t.paint[i] = s.paint[i]; }
    pushHeights(); recolor();
  }

  /* Generators. Each writes the whole field, so they are for starting a map,
     not for touching up one — that is what the brushes are for. */
  function generate(g) {
    const kind = g.type || 'hills', seed = (g.seed | 0) || 1, amp = g.amplitude == null ? 6 : g.amplitude, scale = g.scale || 0.35;
    const noise = makeNoise(seed);
    for (let r = 0; r < W; r++) for (let c = 0; c < W; c++) {
      const i = r * W + c, u = c / n - 0.5, v = r / n - 0.5;
      let h = 0;
      if (kind === 'flat') h = 0;
      else {
        h = noise(u * n * scale * 0.1 + 11.3, v * n * scale * 0.1 + 7.7, 5) * amp;
        if (kind === 'island') { const d = Math.sqrt(u * u + v * v) * 2; h = h * (1 - Math.min(1, d * d)) - Math.max(0, d - 0.55) * amp * 1.6 + amp * 0.35 * (1 - d); }
        if (kind === 'valley') { const rv = Math.abs(u + 0.15 * Math.sin(v * 9)) ; h = h * 0.6 + Math.min(amp * 1.4, rv * rv * amp * 9) - amp * 0.5; }
        if (kind === 'mountains') { h = Math.abs(h) * 1.6 + noise(u * 3 + 50, v * 3 + 50, 3) * amp * 0.6; }
      }
      t.heights[i] = h;
      // auto paint: beach near water line, rock high up, snow on peaks
      const rel = h / Math.max(1, amp);
      t.paint[i] = rel < -0.05 ? 3 : rel > 1.35 ? 5 : rel > 0.9 ? 4 : rel > 0.5 ? 1 : 0;
    }
    pushHeights(); recolor();
  }

  api.rebuild = () => { bind(); buildGeometry(); };
  api.heightAt = heightAt; api.applyBrush = applyBrush; api.snapshot = snapshot; api.restore = restore; api.generate = generate;
  api.recolor = recolor; api.pushHeights = pushHeights;
  api.setData = (data) => { t.n = data.n; t.cell = data.cell; t.heights = data.heights; t.paint = data.paint; api.rebuild(); };
  api.dispose = () => { try { geo.dispose(); material.dispose(); noiseTex.dispose(); } catch (e) {} };
  Object.defineProperties(api, {
    mesh: { get: () => mesh }, n: { get: () => n }, cell: { get: () => cell }, size: { get: () => size }, half: { get: () => half },
    data: { get: () => t },
  });
  api.rebuild();
  return api;
}

function smooth01(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }
function hash(i) { let x = (i * 374761393 + 668265263) | 0; x = (x ^ (x >>> 13)) * 1274126177 | 0; return ((x ^ (x >>> 16)) >>> 0) / 4294967296; }

function makeNoiseTexture(THREE) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#bdbdbd'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 14000; i++) { const v = 120 + Math.random() * 135 | 0; x.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + (0.25 + Math.random() * 0.5) + ')'; x.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1 + Math.random() * 2); }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
