/* ════════════════════════════════════════════════════════════════════════════
   💧 THE WATER OVERLAY — groundwater, surface water and draw, on ONE mesh.
   ----------------------------------------------------------------------------
   The reference screenshot's note is the whole brief: "Look at the visual
   overlays to check wind direction and GROUNDWATER LOCATIONS." Groundwater is a
   LOCATED deposit, and a player cannot obey "keep the coal plant away from the
   water" if they cannot see where the water is. This is where they see it.

   🔴 THE PERFORMANCE CONSTRAINT, same as /src/power/overlay.js and for the same
      reason. The obvious build of a 24×24 field is a tinted quad per tile: 576
      meshes, 576 draw calls, for a layer the player toggles. So all of it is ONE
      `PlaneGeometry(GRID, GRID)` lying on the ground with a single CanvasTexture
      that every enabled layer paints into. Turning five layers on costs exactly
      what turning one on costs.

   ⚠ AND IT ONLY REPAINTS WHEN SOMETHING CHANGED — a signature over the enabled
     layers and the numbers actually drawn gates the redraw. Without the gate
     this is a texture upload every tick for a picture that has not moved.

   🔴 THREE ARRIVES FROM THE HOST — THE GLOBALS TRAP (CLAUDE.md). `THREE` and
      `scene` are top-level `const` in node-city's module script and invisible to
      an ES module. This file imports nothing from the page and reads no global
      of the host's; mount() is handed what it needs, or it returns false and the
      panel's legend checkboxes disable themselves.

   ⚠ IT SITS ABOVE /src/power's PLANE, DELIBERATELY (WATER.overlay.y = 0.075 vs
     0.06). Both info views are flat planes over the same ground; coplanar planes
     z-fight into a flicker the moment a player opens both, and there is nothing
     stopping them from doing exactly that.
   ════════════════════════════════════════════════════════════════════════════ */

import { WATER } from './tuning.js';

let THREE = null, scene = null, mesh = null, tex = null, cvs = null, ctx = null;
let GRID = 24, PX = WATER.overlay.px;
let lastSig = '';

/* 📍 THE FOCUSED SOURCE (bug-mu2r4z2p: "it references multiple water sources.
   I can't locate where these sources are on the map (nothing brings any
   information up)"). The panel names basins, the river/lakes and the coast;
   until now nothing tied a name to a place, so "Ashvale Basin is drawing
   down" was a fact the player could not act on. Clicking a source row sets
   this, and sync() outlines that source's tiles on top of every other layer.
   ⚠ THE FOOTPRINT IS THE OVERLAY'S OWN CUT, NOT A NEW ONE. A basin is the
     tiles the aquifer layer paints for it (groundAt ≥ minRead, same basin), a
     surface body is what the surface layer paints (surfaceAt > 0.12), and the
     coast is where sourceAt would offer the sea (seaAt > 0.02). A highlight
     that disagreed with the paint under it would be a second map. */
let focus = null;            // { id, tiles:[[x,z]…] } or null
export function setFocus(f) { focus = f && f.tiles ? f : null; lastSig = ''; }
export function focused() { return focus ? focus.id : null; }

/** Tiles belonging to one named source. `id` is 'basin:<i>', 'surface' or 'sea'. */
export function footprint(H, id, grid) {
  const out = [];
  if (!H || !id) return out;
  const G = grid || H.grid || GRID;
  const m = /^basin:(\d+)$/.exec(id);
  const cut = WATER.aquifer.minRead;
  for (let z = 0; z < G; z++) for (let x = 0; x < G; x++) {
    let hit = false;
    try {
      if (m) {
        const at = H.basinAt(x, z);
        hit = !!(at && at.basin && at.basin.i === +m[1] && H.groundAt(x, z) >= cut);
      } else if (id === 'surface') {
        hit = H.surfaceAt(x, z) > 0.12;
      } else if (id === 'sea') {
        hit = typeof H.seaAt === 'function' && H.seaAt(x, z) > 0.02;
      }
    } catch (e) { hit = false; }
    if (hit) out.push([x, z]);
  }
  return out;
}
/** The tile the camera should centre on: the footprint's mean, snapped to the
    member tile nearest it (a crescent-shaped lake's mean can sit on dry land). */
export function centreOf(tiles) {
  if (!tiles || !tiles.length) return null;
  let sx = 0, sz = 0;
  for (const [x, z] of tiles) { sx += x; sz += z; }
  const mx = sx / tiles.length, mz = sz / tiles.length;
  let best = tiles[0], bd = Infinity;
  for (const t of tiles) { const d = (t[0] - mx) ** 2 + (t[1] - mz) ** 2; if (d < bd) { bd = d; best = t; } }
  return { x: best[0], z: best[1] };
}

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
  /* LinearFilter here, unlike the power overlay's NearestFilter, and the
     difference is the subject matter rather than taste: a cable either serves a
     tile or does not, so it must not smear across the boundary — but an aquifer
     is a continuous body in the ground and hard tile edges on it would draw a
     staircase the geology does not have. */
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;

  const geo = new THREE.PlaneGeometry(GRID, GRID);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, opacity: WATER.overlay.opacity,
    depthWrite: false, toneMapped: false,
  });
  mesh = new THREE.Mesh(geo, mat);
  /* -PI/2 about X lays the plane flat and puts canvas (0,0) at world
     (-GRID/2, -GRID/2), which is tile (0,0) under node-city's own mapping
     (`x - HALF + .5`). The canvas is in tile space; no flip anywhere. */
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, WATER.overlay.y, 0);
  mesh.renderOrder = WATER.overlay.renderOrder;
  mesh.visible = false;
  // Never casts and never receives: this is paint, and a shadow falling across a
  // data layer changes the colour the legend just promised.
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
function hex(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lerp3(a, b, k) {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}
function rampRGB(stops, t) {
  t = Math.max(0, Math.min(1, t));
  if (stops.length === 1) return hex(stops[0]);
  const f = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(f)), k = f - i;
  return lerp3(hex(stops[i]), hex(stops[i + 1]), k);
}
const rgb = (c) => 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')';
function ramp(stops, t) { return rgb(rampRGB(stops, t)); }

function marker(x, z, col) {
  ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, PX * 0.14);
  ctx.strokeRect(cx(x) + PX * 0.18, cz(z) + PX * 0.18, PX * 0.64, PX * 0.64);
}
// Diagonal hatch, for drawdown. A hatch rather than a fill because it has to
// read ON TOP of the aquifer colour it is describing — a second fill would
// simply replace the thing it is annotating.
function hatch(x, z, col) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx(x), cz(z), PX, PX);
  ctx.clip();
  ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, PX * 0.09);
  for (let o = -PX; o < PX * 2; o += PX * 0.36) {
    ctx.beginPath();
    ctx.moveTo(cx(x) + o, cz(z));
    ctx.lineTo(cx(x) + o - PX, cz(z) + PX);
    ctx.stroke();
  }
  ctx.restore();
}

/* ════════════════════════════════════════════════════════════════════════════
   THE PAINT
   Back to front: TERRAIN (the ground) → CONSUMPTION (what sits on it) →
   MARKERS (what the player built). Same grouping the panel's legend uses,
   because the grouping IS the mental model.
   ════════════════════════════════════════════════════════════════════════════ */
export function sync(state, layers, ctxHost) {
  if (!mesh) return;
  const on = Object.keys(layers).filter(k => layers[k]).sort();
  const H = ctxHost && ctxHost.H;
  // 📍 A focused source shows even with every layer switched off — the player
  // asked "where is it", not "turn the aquifer layer on first".
  if ((!on.length && !focus) || !H) { mesh.visible = false; return; }
  mesh.visible = true;

  const sig = on.join(',') + '|' + H.cityId + '|' + (focus ? focus.id + ':' + focus.tiles.length : '-') + '|' +
    (state ? state.basins.map(b => b.level.toFixed(2) + ':' + b.taint.toFixed(2)).join('/') +
             '|' + state.surface.taint.toFixed(2) + '|' + state.capacity.toFixed(2) +
             '|' + state.wells.length : 'static');
  if (sig === lastSig) return;
  lastSig = sig;

  ctx.clearRect(0, 0, cvs.width, cvs.height);
  const C = WATER.col;
  const bs = state ? state.basins : null;

  // ── TERRAIN: GROUNDWATER ───────────────────────────────────────────────
  /* 🔴 THE POLLUTED PART MUST LOOK DIFFERENT FROM THE CLEAN PART — that is the
     brief's own test of this overlay. So the deposit colour is not a single
     ramp: it is the blue ramp LERPED TOWARD the taint ramp by how poisoned that
     basin actually is. A clean rich basin is deep blue, the same basin under a
     coal plant goes sick olive over the same footprint, and the player watches
     it happen without reading a number.
     ⚠ One field, two variables, on purpose. A separate "purity" layer was
       rejected: it means the player has to hold two pictures in their head and
       align them, and the whole value of an overlay is that they do not. */
  if (layers.aquifer) {
    const cut = WATER.aquifer.minRead;
    for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
      const g = H.groundAt(x, z);
      /* ⚠ THE CUTOFF IS `minRead`, NOT HALF OF IT. Painting the falloff's tail
         doubled the footprint of every basin with a value nothing else in the
         system will act on — `sourceAt` calls anything under minRead 'none' —
         so the map promised water on tiles where a waterworks would get the dry
         floor. An overlay that disagrees with the model it draws is worse than
         no overlay. */
      if (g < cut) continue;
      // Normalised ACROSS the readable range, so the ramp spends its full span
      // on ground the player can actually use rather than on the fringe.
      const t = Math.min(1, (g - cut) / (1 - cut));
      let taint = 0, level = 1;
      if (bs) {
        const at = H.basinAt(x, z);
        if (at) { const b = bs[at.basin.i]; if (b) { taint = b.taint; level = b.level; } }
      }
      const col = lerp3(rampRGB(C.aquiferRamp, t), rampRGB(C.taintRamp, t), Math.min(1, taint * 1.15));
      /* Alpha carries the deposit strength AND the drawdown: a basin the city
         has pumped half empty visibly fades, which is the depletion mechanic
         made visible without a second layer. Capped well below opaque — the
         point of comparison is the CITY under the paint. */
      ctx.globalAlpha = (0.22 + 0.58 * t) * (0.45 + 0.55 * level);
      cell(x, z, rgb(col));
    }
    ctx.globalAlpha = 1;
  }

  // ── TERRAIN: SURFACE WATER ─────────────────────────────────────────────
  if (layers.surface) {
    const st = state ? state.surface.taint : 0;
    for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
      const f = H.surfaceAt(x, z);
      if (f <= 0.12) continue;   // the bank fades out; below this it is not water
      const col = lerp3(rampRGB(C.surfaceRamp, Math.min(1, f)), rampRGB(C.taintRamp, 0.6), Math.min(1, st * 1.15));
      /* ⚠ QUIETER THAN THE GROUNDWATER LAYER, DELIBERATELY. Surface water covers
         fewer tiles but at a much higher value, so an alpha matched to the
         aquifer ramp made the lake the loudest thing on the screen and the
         panel's own subject — the groundwater — the quietest. Photographed at
         0.30+0.60f, kept at this. */
      ctx.globalAlpha = 0.22 + 0.46 * Math.min(1, f);
      cell(x, z, rgb(col));
    }
    ctx.globalAlpha = 1;
  }

  // ── DRAWDOWN ───────────────────────────────────────────────────────────
  if (layers.stress && bs) {
    for (const b of bs) {
      if (b.level > 0.75) continue;
      const k = 1 - b.level;
      for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
        const at = H.basinAt(x, z);
        if (!at || at.basin.i !== b.i) continue;
        ctx.globalAlpha = 0.25 + 0.55 * k;
        hatch(x, z, C.stress);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ── CONSUMPTION ────────────────────────────────────────────────────────
  /* Normalised against the biggest single draw in THIS city, not a constant —
     the same argument /src/power/overlay.js makes about its demand ramp. A fixed
     denominator paints a small city uniformly pale and the layer says nothing. */
  if (layers.draw && state && state.users && state.users.length) {
    let max = 0;
    for (const u of state.users) if (u.draw > max) max = u.draw;
    if (max > 0) for (const u of state.users) cell(u.x, u.z, ramp(C.drawRamp, u.draw / max), PX * 0.20);
  }

  // ── MARKERS ────────────────────────────────────────────────────────────
  if (layers.wells && state) {
    for (const w of state.wells) {
      /* A waterworks that found no source is drawn GREY, not absent. It is
         running — on condensation alone — and "why is that Purifier grey" is the
         question this whole overlay exists to answer. */
      marker(w.x, w.z, w.src === 'none' ? C.wellDry : C.well);
    }
  }

  // ── 📍 FOCUS (bug-mu2r4z2p) — LAST, so nothing paints over it ───────────
  if (focus && focus.tiles.length) paintFocus(focus.tiles, C.focus || '#ffe066');

  tex.needsUpdate = true;
}

/* A light wash over the footprint plus a hard outline on its BOUNDARY edges
   only. Outlining every tile draws a grid, which reads as "these squares"
   rather than "this body"; the boundary reads as a shape, which is what a
   basin is. The wash is thin so the layer under it still tells its story. */
function paintFocus(tiles, col) {
  const inSet = new Set(tiles.map(t => t[0] + ',' + t[1]));
  ctx.globalAlpha = 0.28;
  for (const [x, z] of tiles) cell(x, z, col);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = col; ctx.lineWidth = Math.max(3, PX * 0.16); ctx.lineCap = 'square';
  ctx.beginPath();
  for (const [x, z] of tiles) {
    const x0 = cx(x), z0 = cz(z), x1 = x0 + PX, z1 = z0 + PX;
    if (!inSet.has(x + ',' + (z - 1))) { ctx.moveTo(x0, z0); ctx.lineTo(x1, z0); }
    if (!inSet.has(x + ',' + (z + 1))) { ctx.moveTo(x0, z1); ctx.lineTo(x1, z1); }
    if (!inSet.has((x - 1) + ',' + z)) { ctx.moveTo(x0, z0); ctx.lineTo(x0, z1); }
    if (!inSet.has((x + 1) + ',' + z)) { ctx.moveTo(x1, z0); ctx.lineTo(x1, z1); }
  }
  ctx.stroke();
}

export function hide() { if (mesh) mesh.visible = false; }
export function repaintNext() { lastSig = ''; }
