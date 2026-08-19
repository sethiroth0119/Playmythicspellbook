/* ════════════════════════════════════════════════════════════════════════════
   🗺 THE LAND VALUE OVERLAY — the band map, on ONE mesh.
   ----------------------------------------------------------------------------
   "A player cannot plan against a number they cannot see." The dossier already
   prints a lot's value, but a value is only useful next to its neighbours': the
   question a player actually has is "where is my downtown, and where is the
   cheap land" — and that is a picture, not a row.

   🔴 THE PERFORMANCE CONSTRAINT, AND IT IS COPIED RATHER THAN RE-DECIDED.
      /src/power/overlay.js and /src/water/overlay.js both draw their terrain
      field as ONE `PlaneGeometry(GRID, GRID)` with a single `CanvasTexture`
      that every enabled layer paints into. The obvious build — a tinted quad
      per tile — is 576 meshes and 576 draw calls for a layer the player
      toggles. This is the third instance of that pattern and it is deliberately
      the same shape, down to the signature that gates the repaint: without it
      this is a texture upload every tick for a picture that has not moved.

   🔴 THREE ARRIVES FROM THE HOST — THE GLOBALS TRAP (CLAUDE.md). `THREE` and
      `scene` are top-level `const` in node-city's module script and invisible
      to an ES module. This file imports nothing from the page and reads no
      global of the host's.

   ⚠ IT SITS ON TOP OF THE OTHER THREE, and the height was read off their
     tuning files rather than guessed — see LV.overlay in tuning.js for the full
     stack and for the collision that check caught (0.09 is /src/pollution's
     exact plane, and two coplanar planes z-fight into a camera-dependent
     flicker that a still frame would not have shown).

   ⚠ NearestFilter, unlike /src/water's LinearFilter, and for that file's own
     stated reason run the other way: a BAND is a decision about a tile, not a
     continuous body in the ground. Smearing one band into the next across a
     tile boundary would draw a gradient the model does not have, and the whole
     point of the layer is that a player can see where the line is.
   ════════════════════════════════════════════════════════════════════════════ */

import { LV } from './tuning.js';

let THREE = null, scene = null, mesh = null, tex = null, cvs = null, cx2 = null;
let GRID = 24, PX = LV.overlay.px;
let lastSig = '';

export function mounted() { return !!mesh; }

export function mount(host) {
  if (mesh) return true;
  if (!host || !host.THREE || !host.scene) return false;
  THREE = host.THREE; scene = host.scene;
  GRID = host.grid || 24;

  cvs = document.createElement('canvas');
  cvs.width = cvs.height = GRID * PX;
  cx2 = cvs.getContext('2d');
  if (!cx2) return false;

  tex = new THREE.CanvasTexture(cvs);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;

  const geo = new THREE.PlaneGeometry(GRID, GRID);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, opacity: LV.overlay.opacity,
    depthWrite: false, toneMapped: false,
  });
  mesh = new THREE.Mesh(geo, mat);
  /* -PI/2 about X lays the plane flat and puts canvas (0,0) at world
     (-GRID/2, -GRID/2), which is tile (0,0) under node-city's own mapping
     (`x - HALF + .5`). The canvas is in tile space; no flip anywhere. */
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, LV.overlay.y, 0);
  mesh.renderOrder = LV.overlay.renderOrder;
  mesh.visible = false;
  // Never casts and never receives: this is paint, and a shadow across a data
  // layer changes the colour the legend just promised.
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return true;
}

export function dispose() {
  if (!mesh) return;
  try { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); tex.dispose(); } catch (e) {}
  mesh = tex = cvs = cx2 = null; lastSig = '';
}

/* ── drawing helpers, all in tile space ─────────────────────────────────── */
const px = (v) => v * PX;
function cell(x, z, col, inset) {
  const i = inset || 0;
  cx2.fillStyle = col;
  cx2.fillRect(px(x) + i, px(z) + i, PX - i * 2, PX - i * 2);
}
function marker(x, z, col) {
  cx2.strokeStyle = col; cx2.lineWidth = Math.max(2, PX * 0.14);
  cx2.strokeRect(px(x) + PX * 0.2, px(z) + PX * 0.2, PX * 0.6, PX * 0.6);
}
/* Diagonal hatch for the poison discount — a HATCH rather than a fill, for the
   same reason /src/water hatches its drawdown: it has to read ON TOP of the
   band colour it is annotating, and a second fill would simply replace the
   thing it is describing. */
function hatch(x, z, col) {
  cx2.save();
  cx2.beginPath();
  cx2.rect(px(x), px(z), PX, PX);
  cx2.clip();
  cx2.strokeStyle = col; cx2.lineWidth = Math.max(1, PX * 0.09);
  for (let o = -PX; o < PX * 2; o += PX * 0.34) {
    cx2.beginPath();
    cx2.moveTo(px(x) + o, px(z));
    cx2.lineTo(px(x) + o - PX, px(z) + PX);
    cx2.stroke();
  }
  cx2.restore();
}

/* ════════════════════════════════════════════════════════════════════════════
   THE PAINT.  Back to front: BANDS (the ground) → POISON (what is taking value
   off it) → STOPS (what the player built). The same Terrain → Consumption →
   Markers grouping the other two info views use, because the grouping IS the
   mental model and three overlays that group differently are three features.
   ════════════════════════════════════════════════════════════════════════════ */
export function sync(layers, host) {
  if (!mesh) return;
  const on = Object.keys(layers).filter(k => layers[k]).sort();
  if (!on.length || !host || !host.fields) { mesh.visible = false; return; }
  mesh.visible = true;

  const F = host.fields;
  const st = host.stats || {};
  /* The signature is the enabled layers plus a cheap summary of what is drawn.
     The band histogram plus the extremes moves whenever any tile changes band,
     which is the only thing this picture is made of. */
  const sig = on.join(',') + '|' + (st.hist || []).join('/') + '|' +
              Math.round(st.min || 0) + '/' + Math.round(st.max || 0) + '/' + Math.round(st.city || 0) +
              '|' + (host.stops || []).length;
  if (sig === lastSig) return;
  lastSig = sig;

  cx2.clearRect(0, 0, cvs.width, cvs.height);
  const C = LV.col;

  // ── TERRAIN: THE BANDS ─────────────────────────────────────────────────
  /* Five flat colours, one per band, and NOT a continuous ramp of the raw
     value. The model's output is a decision — which tenants this land admits —
     and painting the number instead of the decision would make the player
     eyeball a threshold that the code already knows exactly. The legend and the
     map are then the same five swatches. */
  if (layers.bands) {
    for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
      const b = F.band[z * GRID + x];
      /* 🔴 HUE CARRIES THE BAND; ALPHA ONLY LEANS ON IT.
         The first build ramped alpha 0.30 → 0.86 across the five bands so the
         cheap end would stay quiet. Worked through: at 0.30 alpha × 0.62
         material opacity, band 0 lands at 0.19 effective over node-city's pale
         ground, and band 0 against band 1 is then a few levels of grey — a
         player cannot see a boundary the model is certain about. A narrow alpha
         ramp on a wide hue ramp fixes it: blue and teal are unmistakable at the
         same weight, and the top band still leads because red at 0.70 is the
         loudest thing on the layer.
         ⚠ WHAT WAS ACTUALLY MEASURED, AND WHAT WAS NOT. The band texture is
           verified pixel-exact — a driver reads this canvas back and compares
           the texel at each tile centre against the band colour the model
           assigned that tile, and three bands matched their hex exactly
           (#5fbf5a, #2f9fb8, #2f4f96) at alphas 143/125/107. The MESH is
           verified to draw — with every other mesh hidden it paints ~660 of
           3600 sampled pixels. What could NOT be established AT THE TIME was
           how it reads OVER a populated frame: an A/B of the rendered buffer
           with the plane shown and hidden reported zero differing pixels — for
           this layer AND for /src/water's, the pattern this one copies.

         ✅ SETTLED SINCE, AND THE INSTRUMENT WAS INDEED THE FAULT. The A/B
           toggled `.visible` and read the framebuffer WITHOUT calling
           renderer.render(). rAF here fires at about 0.56 Hz — not never, which
           is worse than never because it makes the failure intermittent — so
           the read returned the frame from before the flip, for any layer at
           all. That is why /src/water "measured identically": a do-nothing read
           measures everything identically.
           Driven properly, this plane moves 78% of the district crop and 79% of
           a crop of bare ground, mean delta 44-55, AGAINST A CONTROL OF EXACTLY
           ZERO. See .gauntlet/README.md item 6 for the measurement to copy, and
           for the second trap: this module's own 2.5s refresh() interval sets
           mesh.visible = true whenever the panel is open, so an A/B that opens
           the panel and then hand-flips visibility races it and reports ~1%
           instead of ~61%.
           The original note is kept above rather than deleted, because a
           disclosure that was honest and turned out to be wrong is worth more
           in the record than a clean line — HANDOFF §7 records two rounds lost
           to a critic scoring a "regression" the harness had invented, and this
           was very nearly a third. */
      cx2.globalAlpha = 0.42 + 0.07 * b;
      cell(x, z, C.band[b] || C.band[0]);
    }
    cx2.globalAlpha = 1;
  }

  // ── THE POISON DISCOUNT ────────────────────────────────────────────────
  /* Only where it is actually biting. A hatch over a clean city would be a
     permanent decoration for a mechanic that is not running — the same false
     claim node-city's own chips are written to avoid. */
  if (layers.poison) {
    for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
      const m = F.polmul[z * GRID + x];
      if (!(m < C.poisonAt)) continue;
      cx2.globalAlpha = 0.30 + 0.6 * (1 - m);
      hatch(x, z, C.poison);
    }
    cx2.globalAlpha = 1;
  }

  // ── MARKERS: THE STOPS THAT ARE ACTUALLY WORTH SOMETHING ───────────────
  /* Drawn only when the network's mode share is above zero, because that is
     exactly when the term is above zero. A marker on a shelter that no line
     serves would promise a premium the model does not pay. */
  if (layers.stops && host.stops) for (const s of host.stops) marker(s.x, s.z, C.stop);

  tex.needsUpdate = true;
}

export function hide() { if (mesh) mesh.visible = false; }
export function repaintNext() { lastSig = ''; }
