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
  /* Textured layers. The vertex colour stays the base tint (paint × slope);
     a shader injected into the standard material (so lighting, shadows and
     fog are untouched) multiplies in a DETAIL tile per paint layer, chosen
     by sampling a per-vertex layer-index texture with NEAREST filtering at
     the fragment's world position — exact per cell, and blended across the
     four surrounding cells so boundaries feather instead of stepping. Tiles
     are procedural (mapforge has no texture assets and hosts none); steep
     faces switch to the rock tile like the tint already does. */
  const atlas = makeDetailAtlas(THREE);
  let layerTex = null;
  const shaderU = { uAtlas: { value: atlas }, uLayer: { value: null }, uHalf: { value: 0 }, uSize: { value: 1 }, uCell: { value: 1 }, uTile: { value: 0.5 }, uDetail: { value: 0.8 }, uW: { value: 1 } };
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shaderU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vMfWorld; varying float vMfNy;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMfWorld = (modelMatrix * vec4(transformed, 1.0)).xyz; vMfNy = normalize((modelMatrix * vec4(normal, 0.0)).xyz).y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vMfWorld; varying float vMfNy; uniform sampler2D uAtlas; uniform sampler2D uLayer; uniform float uHalf, uSize, uCell, uTile, uDetail, uW;\n'
      + 'vec3 mfTile(float idx, vec2 wxz){ float tx = mod(idx, 4.0), ty = floor(idx / 4.0); vec2 f = fract(wxz * uTile) * 0.94 + 0.03; return texture2D(uAtlas, (f + vec2(tx, ty)) / 4.0).rgb; }\n'
      + 'float mfIdx(vec2 cellUv){ return floor(texture2D(uLayer, cellUv).r * 255.0 + 0.5); }')
      .replace('#include <color_fragment>', '#include <color_fragment>\n{\n  vec2 g = (vMfWorld.xz + uHalf) / uCell;            // grid coords, vertex i at integer g\n  vec2 g0 = floor(g), fr = g - g0;\n  vec2 texel = 1.0 / vec2(uW);\n  vec2 u00 = (g0 + 0.5) * texel, u10 = (g0 + vec2(1.0, 0.0) + 0.5) * texel, u01 = (g0 + vec2(0.0, 1.0) + 0.5) * texel, u11 = (g0 + 1.0 + 0.5) * texel;\n  vec3 d = mfTile(mfIdx(u00), vMfWorld.xz) * (1.0 - fr.x) * (1.0 - fr.y) + mfTile(mfIdx(u10), vMfWorld.xz) * fr.x * (1.0 - fr.y) + mfTile(mfIdx(u01), vMfWorld.xz) * (1.0 - fr.x) * fr.y + mfTile(mfIdx(u11), vMfWorld.xz) * fr.x * fr.y;\n  float steep = clamp((0.86 - vMfNy) / 0.3, 0.0, 1.0);\n  d = mix(d, mfTile(4.0, vMfWorld.xz), steep * 0.85);\n  diffuseColor.rgb *= mix(vec3(1.0), d * 2.0, uDetail);\n}');
  };
  material.customProgramCacheKey = () => 'mf-terrain-splat';
  const api = {};

  function bind() {
    n = t.n; cell = t.cell; size = n * cell; half = size / 2; W = n + 1;
    if (layerTex) layerTex.dispose();
    layerTex = new THREE.DataTexture(new Uint8Array(W * W), W, W, THREE.LuminanceFormat, THREE.UnsignedByteType);
    layerTex.magFilter = layerTex.minFilter = THREE.NearestFilter; layerTex.generateMipmaps = false; layerTex.flipY = false; layerTex.wrapS = layerTex.wrapT = THREE.ClampToEdgeWrapping;
    shaderU.uLayer.value = layerTex; shaderU.uHalf.value = half; shaderU.uSize.value = size; shaderU.uCell.value = cell; shaderU.uW.value = W;
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
    // the layer-index texture the shader samples per cell (row r → texel row r: no flip)
    const d = layerTex.image.data; for (let i = 0; i < W * W; i++) d[i] = t.paint[i] | 0; layerTex.needsUpdate = true;
  }
  function setDetail(v) { shaderU.uDetail.value = Math.max(0, Math.min(1, +v)); }
  function setTile(perMetre) { shaderU.uTile.value = Math.max(0.05, Math.min(4, +perMetre || 0.5)); }

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
  api.recolor = recolor; api.pushHeights = pushHeights; api.setDetail = setDetail; api.setTile = setTile; api.shaderUniforms = shaderU; api.material = material;
  api.setData = (data) => { t.n = data.n; t.cell = data.cell; t.heights = data.heights; t.paint = data.paint; api.rebuild(); };
  api.dispose = () => { try { geo.dispose(); material.dispose(); atlas.dispose(); if (layerTex) layerTex.dispose(); } catch (e) {} };
  Object.defineProperties(api, {
    mesh: { get: () => mesh }, n: { get: () => n }, cell: { get: () => cell }, size: { get: () => size }, half: { get: () => half },
    data: { get: () => t },
  });
  api.rebuild();
  return api;
}

function smooth01(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }
function hash(i) { let x = (i * 374761393 + 668265263) | 0; x = (x ^ (x >>> 13)) * 1274126177 | 0; return ((x ^ (x >>> 16)) >>> 0) / 4294967296; }

/* The detail atlas: 4×4 tiles of 256 px, one per PAINT index (row-major),
   drawn on a canvas at startup. Every tile averages mid grey so multiplying
   by 2× keeps the vertex tint's brightness; only the PATTERN differs — grass
   strokes, dirt speckle, sand ripples, rock cracks, snow blotches, cobbles,
   asphalt grain, concrete slabs, rust, toxic blobs, soot. Seeded, so every
   device draws the same ground. Append-only like PAINT: tile i is layer i. */
function makeDetailAtlas(THREE) {
  const T = 256, c = document.createElement('canvas'); c.width = c.height = T * 4;
  const x = c.getContext('2d');
  let seed = 1234; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const tile = (i, fn) => { const ox = (i % 4) * T, oy = Math.floor(i / 4) * T; x.save(); x.beginPath(); x.rect(ox, oy, T, T); x.clip(); x.translate(ox, oy); x.fillStyle = '#808080'; x.fillRect(0, 0, T, T); fn(); x.restore(); };
  const grey = (v, a) => 'rgba(' + v + ',' + v + ',' + v + ',' + a + ')';
  const speckle = (count, lo, hi, size, alpha) => { for (let k = 0; k < count; k++) { const v = lo + rnd() * (hi - lo) | 0; x.fillStyle = grey(v, alpha == null ? 0.6 : alpha); const s = 1 + rnd() * size; x.fillRect(rnd() * T, rnd() * T, s, s); } };
  const strokes = (count, lo, hi, len, wid, vertical) => { for (let k = 0; k < count; k++) { const v = lo + rnd() * (hi - lo) | 0; x.strokeStyle = grey(v, 0.7); x.lineWidth = wid; const px = rnd() * T, py = rnd() * T, l = len * (0.5 + rnd()); x.beginPath(); x.moveTo(px, py); x.lineTo(px + (vertical ? (rnd() - 0.5) * 4 : l), py + (vertical ? -l : (rnd() - 0.5) * 4)); x.stroke(); } };
  const blotches = (count, lo, hi, r) => { for (let k = 0; k < count; k++) { const v = lo + rnd() * (hi - lo) | 0; x.fillStyle = grey(v, 0.45); x.beginPath(); x.ellipse(rnd() * T, rnd() * T, r * (0.5 + rnd()), r * (0.5 + rnd()), rnd() * 3, 0, 6.283); x.fill(); } };
  const cracks = (count, lo, hi) => { for (let k = 0; k < count; k++) { x.strokeStyle = grey(lo + rnd() * (hi - lo) | 0, 0.8); x.lineWidth = 1 + rnd() * 1.5; let px = rnd() * T, py = rnd() * T; x.beginPath(); x.moveTo(px, py); for (let s = 0; s < 8; s++) { px += (rnd() - 0.5) * 40; py += (rnd() - 0.5) * 40; x.lineTo(px, py); } x.stroke(); } };
  const cobbles = (cols, lo, hi) => { const s = T / cols; for (let r = 0; r < cols; r++) for (let q = 0; q < cols; q++) { x.fillStyle = grey(lo + rnd() * (hi - lo) | 0, 0.7); x.beginPath(); x.ellipse(q * s + s / 2 + (rnd() - 0.5) * 4, r * s + s / 2 + (rnd() - 0.5) * 4, s * 0.42, s * 0.36, rnd() * 0.4, 0, 6.283); x.fill(); } };
  const K = { grass: () => { speckle(1500, 90, 150, 2, 0.5); strokes(900, 80, 170, 14, 1.2, true); }, meadow: () => { speckle(1500, 80, 140, 2, 0.5); strokes(1100, 60, 150, 16, 1.4, true); },
    dirt: () => { speckle(4000, 70, 170, 3); blotches(40, 90, 130, 14); }, sand: () => { speckle(6000, 110, 160, 1.5, 0.5); strokes(60, 110, 150, 120, 2, false); },
    rock: () => { blotches(60, 90, 150, 22); cracks(40, 40, 90); speckle(1500, 80, 160, 2); }, snow: () => { blotches(120, 120, 145, 18); speckle(800, 130, 160, 2, 0.4); },
    path: () => { cobbles(6, 95, 150); cracks(8, 60, 90); }, mud: () => { blotches(90, 80, 130, 16); speckle(1500, 70, 120, 2); },
    ash: () => { speckle(5000, 80, 140, 2); blotches(30, 100, 130, 12); }, ember: () => { speckle(2500, 90, 200, 2, 0.7); blotches(30, 150, 220, 6); },
    asphalt: () => { speckle(7000, 100, 150, 1.5, 0.6); cracks(6, 60, 90); }, concrete: () => { speckle(3000, 110, 150, 1.5, 0.5); x.strokeStyle = grey(90, 0.8); x.lineWidth = 2; x.strokeRect(2, 2, T / 2 - 4, T / 2 - 4); x.strokeRect(T / 2 + 2, 2, T / 2 - 4, T / 2 - 4); x.strokeRect(2, T / 2 + 2, T / 2 - 4, T / 2 - 4); x.strokeRect(T / 2 + 2, T / 2 + 2, T / 2 - 4, T / 2 - 4); },
    rust: () => { blotches(80, 70, 170, 14); speckle(2500, 60, 150, 2); }, toxic: () => { blotches(50, 100, 190, 20); speckle(1200, 120, 190, 2, 0.5); }, soot: () => { speckle(6000, 60, 120, 2, 0.7); blotches(40, 70, 100, 14); } };
  PAINT.forEach((p, i) => { if (i < 16) tile(i, K[p.id] || (() => speckle(3000, 90, 160, 2))); });
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.anisotropy = 4;
  return tex;
}
