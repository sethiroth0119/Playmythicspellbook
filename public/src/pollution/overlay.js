/* ════════════════════════════════════════════════════════════════════════════
   🎨 THE POLLUTION OVERLAY — three fields, the wind arrows and the sources,
      on ONE mesh.
   ----------------------------------------------------------------------------
   The reference screenshot tells the player, in as many words: "Look at the
   visual overlays to check WIND DIRECTION and groundwater locations." Orange
   arrows rake across its terrain. Those arrows are not decoration — they are the
   reason the plume is a plume: upwind of the coal plant is fine and downwind is
   not, and a player cannot act on that without being able to see which way the
   air is going.

   ── WHAT WAS CHOSEN, AND WHY ────────────────────────────────────────────────
   ONE `PlaneGeometry(GRID, GRID)` lying on the ground carrying ONE
   `CanvasTexture` that every enabled layer paints into — the same build
   /src/water/overlay.js and /src/power/overlay.js already use, and for the
   reason both of them state: the obvious build of a 24×24 field is a tinted
   quad per tile, which is 576 meshes and 576 draw calls for a layer the player
   toggles on and off. The brief's own constraint says it plainly — "one
   generated canvas texture on a ground plane, not 576 meshes". Turning all four
   layers on costs exactly what turning one on costs: one mesh, one draw call,
   one texture upload.

   THE ARROWS ARE PAINTED INTO THE SAME CANVAS, not built as geometry. A lattice
   of 36 arrow sprites would be 36 more objects to create, orient, cull and
   dispose, and they would have to be re-oriented every time the wind veered.
   As strokes on the canvas they are three `lineTo` calls each and they cost
   nothing beyond the repaint that was happening anyway.

   ⚠ AND IT ONLY REPAINTS WHEN SOMETHING VISIBLY CHANGED. The fields move every
     economy tick, so a naive signature would upload a 576×576 texture once a
     second for a picture that has not perceptibly altered. The signature is
     therefore QUANTISED — field means and peaks to two decimals, the wind
     bearing to 5° — so the repaint fires when the player could actually see the
     difference and not otherwise.

   🔴 THREE ARRIVES FROM THE HOST — THE GLOBALS TRAP (CLAUDE.md). `THREE` and
      `scene` are top-level `const` in node-city's module script and invisible to
      an ES module. This file imports nothing from the page and reads no global
      of the host's; mount() is handed what it needs or it returns false and the
      panel's legend checkboxes disable themselves.

   ⚠ IT SITS ABOVE BOTH NEIGHBOURS (water 0.075, power 0.06). Coplanar planes
     z-fight into a flicker the moment a player opens two info views, and a
     player comparing a coal plant's plume against the aquifer under it is doing
     exactly what this batch is for.
   ════════════════════════════════════════════════════════════════════════════ */

import { POLLUTE } from './tuning.js';
import * as F from './field.js';

const O = POLLUTE.overlay;

let THREE = null, scene = null, mesh = null, tex = null, cvs = null, ctx = null;
let GRID = 24, PX = O.px;
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
  /* LinearFilter, like /src/water and unlike /src/power. A cable either serves a
     tile or it does not, so power is right to keep hard edges — but a plume is a
     continuous thing in the air and tile-sharp edges on it would draw a
     staircase that the physics does not have. */
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;

  const geo = new THREE.PlaneGeometry(GRID, GRID);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, opacity: O.opacity,
    depthWrite: false, toneMapped: false,
  });
  mesh = new THREE.Mesh(geo, mat);
  /* −π/2 about X lays the plane flat and puts canvas (0,0) at world
     (−GRID/2, −GRID/2), which is tile (0,0) under node-city's own mapping
     (`x - HALF + .5`). The canvas is in tile space; there is no flip anywhere,
     which is what lets wind.js's `dz` be used as a canvas +y directly. */
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, O.y, 0);
  mesh.renderOrder = O.renderOrder;
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
function lerp3(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
function rampRGB(stops, t) {
  t = Math.max(0, Math.min(1, t));
  if (stops.length === 1) return hex(stops[0]);
  const f = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(f)), k = f - i;
  return lerp3(hex(stops[i]), hex(stops[i + 1]), k);
}
const rgb = (c) => 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')';
function ramp(stops, t) { return rgb(rampRGB(stops, t)); }

/* 🔴 THE FADE IS THE ALPHA, NOT THE CUT-OFF. A floor of 0.26 plus a linear ramp
   meant every cell that cleared `minRead` arrived at a quarter opacity, so the
   plume's soft physical tail was painted as a hard rectangular edge exactly at
   the threshold — a stencil of a gradient. Going to zero at zero, with a curve
   that keeps the mid-range readable, draws the shape the field actually has. */
function alphaOf(v) {
  return Math.min(1, O.alphaGain * Math.pow(Math.max(0, Math.min(1, v)), O.alphaCurve));
}

function marker(x, z, col) {
  ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, PX * 0.11);
  ctx.strokeRect(cx(x) + PX * 0.18, cz(z) + PX * 0.18, PX * 0.64, PX * 0.64);
}

/* ── 🧭 ONE ARROW ───────────────────────────────────────────────────────────
   Drawn from the tile centre, along the wind vector, with a two-stroke head.
   `dx`/`dz` come straight from wind.js and are already "the direction the plume
   goes" — see that file's bearing header. No angle is recomputed here, because
   a second derivation of a direction is a second chance to point it backwards.

   Length rides the wind SPEED as well as the direction, so a still day draws
   short stubs and a storm draws long strokes: the arrows carry both halves of
   the reading and the player never has to look up a number to know whether the
   air is moving. */
function arrow(x, z, dx, dz, speed) {
  const L = PX * (1.05 + 1.35 * Math.max(0, Math.min(1, speed)));
  const px0 = cx(x) + PX * 0.5 - dx * L * 0.5;
  const pz0 = cz(z) + PX * 0.5 - dz * L * 0.5;
  const px1 = px0 + dx * L, pz1 = pz0 + dz * L;
  // Perpendicular, for the head. (−dz, dx) is the 90° rotation in canvas space.
  const hx = -dz, hz = dx, hl = L * 0.26;
  ctx.beginPath();
  ctx.moveTo(px0, pz0); ctx.lineTo(px1, pz1);
  ctx.moveTo(px1, pz1); ctx.lineTo(px1 - dx * hl + hx * hl * 0.62, pz1 - dz * hl + hz * hl * 0.62);
  ctx.moveTo(px1, pz1); ctx.lineTo(px1 - dx * hl - hx * hl * 0.62, pz1 - dz * hl - hz * hl * 0.62);
  ctx.stroke();
}

/* ════════════════════════════════════════════════════════════════════════════
   THE PAINT
   Back to front: GROUND (what is in the soil) → WATER (what is in the channel)
   → AIR (what is over both) → LAND VALUE → SOURCES → ARROWS. Air is painted
   over ground because it is literally above it, and the arrows go last because
   they are the key to the layer underneath them and must never be buried.
   ════════════════════════════════════════════════════════════════════════════ */
export function sync(layers, host) {
  if (!mesh) return;
  const on = Object.keys(layers).filter(k => layers[k]).sort();
  if (!on.length) { mesh.visible = false; return; }
  mesh.visible = true;

  const H = host || {};
  const wind = H.wind || { dx: 0, dz: 1, speed: 0, deg: 180 };
  const st = H.diag || { mean: { air: 0, ground: 0, water: 0 }, peak: { air: 0, ground: 0, water: 0 } };

  /* THE REPAINT GATE, quantised. See this file's header: the fields move every
     tick and a signature that tracked them exactly would upload a 576×576
     texture once a second to redraw a picture nobody could tell apart. */
  const q = (v) => (Math.round((Number(v) || 0) * 100) / 100).toFixed(2);
  const sig = on.join(',') + '|' + q(st.mean.air) + q(st.mean.ground) + q(st.mean.water) +
              q(st.peak.air) + q(st.peak.ground) + q(st.peak.water) +
              '|' + Math.round((wind.deg || 0) / 5) + ':' + q(wind.speed) +
              '|' + ((H.sources && H.sources.length) | 0) + ':' + ((H.homes && H.homes.length) | 0) +
              '|' + (H.waterLive ? 'w' : '-');
  if (sig === lastSig) return;
  lastSig = sig;

  ctx.clearRect(0, 0, cvs.width, cvs.height);
  const R = O.ramps, cut = O.minRead;

  // ── GROUND ─────────────────────────────────────────────────────────────
  /* The stock problem, painted first and underneath, because that is where it
     is. Alpha carries the value as well as the ramp so a faint contamination
     reads as faint rather than as a different colour of bad. */
  if (layers.ground) {
    for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
      const v = F.groundAt(x, z);
      if (v < cut) continue;
      ctx.globalAlpha = alphaOf(v);
      cell(x, z, ramp(R.ground, v));
    }
    ctx.globalAlpha = 1;
  }

  // ── WATER ──────────────────────────────────────────────────────────────
  /* 🔴 THIS LAYER IS THE SCREENSHOT. Its subject is not really this module's own
     surface field — it is "the groundwater deposit under the plant has gone
     bad", which is a fact only /src/water can state, because /src/water owns the
     basins and applies the taint. So where that module is present this reads its
     LIVE purity per tile (`sourceAt(x, z).purity`) and paints the shortfall; the
     module's own surface field is blended in on top for the channel.
     ⚠ WITH /src/water ABSENT IT PAINTS THIS MODULE'S OWN FIELD AND NOTHING ELSE,
       and the legend row says which. Synthesising an aquifer here so the picture
       looked complete would be a second truth about the ground the moment the
       real one loaded, and would be indistinguishable from the real thing at a
       glance — the specific failure both neighbouring modules were told to
       avoid. */
  if (layers.water) {
    const W = H.waterLive;
    for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
      let v = F.waterAt(x, z);
      if (W) {
        try {
          const s = W(x, z);
          if (s && s.kind !== 'none') v = Math.max(v, 1 - (Number(s.purity) || 1));
        } catch (e) {}
      }
      if (v < cut) continue;
      ctx.globalAlpha = alphaOf(v);
      cell(x, z, ramp(R.water, v));
    }
    ctx.globalAlpha = 1;
  }

  // ── AIR ────────────────────────────────────────────────────────────────
  /* The flow problem, painted over everything because it is over everything.
     A little brighter than the two below it: it is the layer that MOVES, and a
     player watching the plume drift is the whole reason the arrows exist. */
  if (layers.air) {
    for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
      const v = F.airAt(x, z);
      if (v < cut) continue;
      ctx.globalAlpha = alphaOf(v);
      cell(x, z, ramp(R.air, v));
    }
    ctx.globalAlpha = 1;
  }

  // ── LAND VALUE ─────────────────────────────────────────────────────────
  /* Painted as an inset square rather than a full cell, so it can be read ON TOP
     of the field that caused it instead of replacing it — the same reason
     /src/water hatches its drawdown rather than filling it. Green where the land
     is worth what it was, red where it is not. */
  if (layers.value && H.landValueAt) {
    for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
      let lv = 1;
      try { lv = Number(H.landValueAt(x, z)); } catch (e) { lv = 1; }
      if (!(lv < 0.995)) continue;
      const t = (lv - POLLUTE.effects.minLandValue) / (1 - POLLUTE.effects.minLandValue);
      ctx.globalAlpha = 0.85;
      cell(x, z, ramp(R.value, Math.max(0, Math.min(1, t))), PX * 0.30);
    }
    ctx.globalAlpha = 1;
  }

  // ── SOURCES AND HOMES ──────────────────────────────────────────────────
  /* Which buildings are DOING this, and which ones are being done to. The pair
     is the whole siting lesson in one glance, and it is the reason the layer is
     called Sources & Homes rather than just Sources. */
  if (layers.sources) {
    for (const s of (H.sources || [])) marker(s.x, s.z, O.src);
    for (const h of (H.homes || [])) if (h.home) marker(h.x, h.z, O.home);
  }

  // ── 🧭 THE WIND ────────────────────────────────────────────────────────
  if (layers.wind) {
    ctx.strokeStyle = O.arrowCol;
    ctx.globalAlpha = O.arrowAlpha;
    ctx.lineWidth = Math.max(2, PX * 0.10);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    /* Offset by half a step so the lattice sits inside the map rather than
       hugging the (0,0) corner — with `arrowEvery` 4 on a 24 grid that is a 6×6
       lattice starting at tile 1. */
    const step = Math.max(1, O.arrowEvery | 0), off = Math.floor(step / 2);
    for (let z = off; z < GRID; z += step) for (let x = off; x < GRID; x += step) {
      arrow(x, z, wind.dx, wind.dz, wind.speed);
    }
    ctx.globalAlpha = 1;
  }

  tex.needsUpdate = true;
}

export function hide() { if (mesh) mesh.visible = false; }
export function repaintNext() { lastSig = ''; }
