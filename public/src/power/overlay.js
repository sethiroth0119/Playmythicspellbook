/* ════════════════════════════════════════════════════════════════════════════
   ⚡ THE OVERLAY — every electricity layer, on ONE mesh.
   ----------------------------------------------------------------------------
   🔴 THE PERFORMANCE CONSTRAINT, AND WHY THIS IS SHAPED THE WAY IT IS.
      The city already renders ~1,700 meshes / ~2M triangles. The obvious build
      of a 24x24 info view — a tinted quad per tile — is 576 more meshes and 576
      more draw calls for a layer the player toggles on and off, and it gets
      worse the moment two layers are enabled at once.

      So all of it is ONE `PlaneGeometry(GRID, GRID)` lying on the ground with a
      single CanvasTexture. Enabled layers paint into that one canvas in a fixed
      order; the GPU sees one draw call and one texture whatever is switched on.
      Turning every layer on costs exactly as much as turning one on.

   ⚠ AND IT ONLY REPAINTS WHEN SOMETHING CHANGED. `sync()` is called from the
     panel's refresh, which runs on the economy tick. Repainting a 576px canvas
     at 1 Hz forever is affordable but pointless, so a signature of (enabled
     layers + topology + the numbers actually drawn) gates the redraw. Without
     the gate this is a texture upload every tick for a static picture.

   🔴 THREE ARRIVES FROM THE HOST — THE GLOBALS TRAP (CLAUDE.md).
      node-city imports three through a document import map inside its own module
      script. This file could `import * as THREE from 'three'` and resolve the
      same map, but that couples the overlay to the host's bundling and gives a
      second module identity if the map ever changes. The host hands us THREE and
      the scene instead, the same way ecoHost() hands /src/economy everything it
      is allowed to know. If the host hands us nothing, mount() returns false and
      the panel's layer checkboxes disable themselves — see panel.js.
   ════════════════════════════════════════════════════════════════════════════ */

import { POWER } from './tuning.js';

let THREE = null, scene = null, mesh = null, tex = null, cvs = null, ctx = null;
let GRID = 24, PX = POWER.overlay.px;
let lastSig = '';

export function mounted() { return !!mesh; }

export function mount(host) {
  if (mesh) return true;
  if (!host || !host.THREE || !host.scene) return false;
  THREE = host.THREE; scene = host.scene;
  GRID = host.grid || 24;

  cvs = document.createElement('canvas');
  cvs.width = cvs.height = GRID * PX;
  ctx = cvs.getContext('2d');
  if (!ctx) return false;

  tex = new THREE.CanvasTexture(cvs);
  /* NearestFilter on purpose. This is a data overlay, not a decal: a tile that
     is choking must read as exactly that tile, and bilinear smearing across the
     tile boundary makes a one-tile bottleneck look like a three-tile one. */
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearFilter;
  if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;

  const geo = new THREE.PlaneGeometry(GRID, GRID);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, opacity: POWER.overlay.opacity,
    depthWrite: false, toneMapped: false,
  });
  mesh = new THREE.Mesh(geo, mat);
  /* -PI/2 about X lays the plane flat and puts canvas (0,0) at world
     (-GRID/2, -GRID/2), which is tile (0,0) under node-city's own mapping
     (`x - HALF + .5`). No flip is needed anywhere; the canvas is in tile space. */
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, POWER.overlay.y, 0);
  mesh.renderOrder = 3;
  mesh.visible = false;
  /* Never shadow-cast and never receive. This is paint; a shadow falling across
     a data layer changes the colour the legend just promised. */
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return true;
}

export function dispose() {
  if (!mesh) return;
  try { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); tex.dispose(); } catch (e) {}
  mesh = tex = cvs = ctx = null; lastSig = '';
}

/* ── DRAWING HELPERS, all in tile space ─────────────────────────────────── */
const cx = (x) => x * PX, cz = (z) => z * PX;
function cell(x, z, col, inset) {
  const i = inset || 0;
  ctx.fillStyle = col;
  ctx.fillRect(cx(x) + i, cz(z) + i, PX - i * 2, PX - i * 2);
}
function ramp(stops, t) {
  t = Math.max(0, Math.min(1, t));
  if (stops.length === 1) return stops[0];
  const f = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(f)), k = f - i;
  const a = hex(stops[i]), b = hex(stops[i + 1]);
  return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * k) + ',' +
                  Math.round(a[1] + (b[1] - a[1]) * k) + ',' +
                  Math.round(a[2] + (b[2] - a[2]) * k) + ')';
}
function hex(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// A ring, for the three "this tile IS a thing" markers. Drawn as a stroked
// square rather than a fill so the consumption layer underneath stays readable
// when both are on — the reference's markers sit ON the building colour, not
// instead of it.
function marker(x, z, col) {
  ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, PX * 0.14);
  ctx.strokeRect(cx(x) + PX * 0.18, cz(z) + PX * 0.18, PX * 0.64, PX * 0.64);
}
// A cable run: a band along the tile, thin for LV, fat for HV.
function cable(x, z, col, w) {
  ctx.fillStyle = col;
  const t = PX * w;
  ctx.fillRect(cx(x), cz(z) + (PX - t) / 2, PX, t);
  ctx.fillRect(cx(x) + (PX - t) / 2, cz(z), t, PX);
}

/* ── THE PAINT ──────────────────────────────────────────────────────────────
   Order matters and is the reference's own grouping, painted back to front:
   TERRAIN colour first (it is the ground), then NETWORK colour (cables lie on
   the ground), then BUILDING colour (buildings sit on top). A layer the host
   cannot supply is simply absent — see index.js on why nothing here invents
   wind or groundwater. */
export function sync(state, layers, host) {
  if (!mesh) return;
  const on = Object.keys(layers).filter(k => layers[k]).sort();
  if (!on.length) { mesh.visible = false; return; }
  mesh.visible = true;

  const sig = on.join(',') + '|' + (state ? state.topo.seg.length + ':' + state.topo.chokes.length + ':' +
              state.load.toFixed(2) + ':' + state.capacity.toFixed(2) : 'none') +
              '|' + (host.terrainSig || '');
  if (sig === lastSig) return;
  lastSig = sig;

  ctx.clearRect(0, 0, cvs.width, cvs.height);
  const C = POWER.col;

  // ── TERRAIN COLOUR ──
  if (layers.wind && host.wind) paintField(host.wind.field, C.windRamp);
  if (layers.ground && host.ground) paintField(host.ground, C.groundRamp);
  if (layers.surface && host.surface) paintField(host.surface, C.surfaceRamp);

  // ── NETWORK COLOUR ──
  if (state) {
    if (layers.lv) for (const s of state.topo.seg) {
      if (s.hv) continue;
      cable(s.x, s.z, s.choke ? C.lvChoke : (s.flow > 0 ? C.lv : C.lvFlow), s.choke ? 0.40 : 0.26);
    }
    if (layers.hv) for (const s of state.topo.seg) {
      if (!s.hv) continue;
      cable(s.x, s.z, s.choke ? C.hvChoke : C.hv, s.choke ? 0.52 : 0.38);
    }

    // ── BUILDING COLOUR ──
    if (layers.demand) {
      /* Normalised against the BIGGEST single draw in the city, not against a
         constant. A fixed denominator meant a city of street lights painted
         itself uniformly pale and the layer said nothing; against the local
         maximum the ramp always spends its full range on the city in front of
         the player, which is what "Low ▁▂▃▄▅▆▇ High" claims in the legend. */
      let max = 0;
      for (const l of host.loads) if (l.draw > max) max = l.draw;
      if (max > 0) for (const l of host.loads) cell(l.x, l.z, ramp(C.demandRamp, l.draw / max), PX * 0.20);
      // Anything the walk could not reach reads grey, whatever it draws.
      for (const u of state.topo.unserved) cell(u.x, u.z, C.unserved, PX * 0.20);
    }
    if (layers.transformers) for (const t of state.topo.transformers) marker(t.x, t.z, C.transformer);
    if (layers.batteries && state.store.cap > 0) for (const p of state.byPlant) marker(p.x, p.z, C.battery);
    if (layers.plants) for (const p of state.byPlant) marker(p.x, p.z, C.plant);
  }

  tex.needsUpdate = true;
}

/* A terrain field is `(x, z) -> 0..1`, which is exactly the shape the agreed
   cross-workflow water/pollution API promises (`airAt`, `groundAt`, `sourceAt`).
   Nothing here knows or cares which module supplied it. */
function paintField(fn, stops) {
  for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
    const v = Number(fn(x, z));
    if (!isFinite(v) || v <= 0) continue;
    ctx.globalAlpha = 0.55 + 0.45 * Math.min(1, v);
    cell(x, z, ramp(stops, v));
  }
  ctx.globalAlpha = 1;
}

export function hide() { if (mesh) mesh.visible = false; }
export function repaintNext() { lastSig = ''; }
