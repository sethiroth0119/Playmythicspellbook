/* ════════════════════════════════════════════════════════════════════════════
   🗺 THE RESOURCE OVERLAY — every layer, on ONE mesh.
   ----------------------------------------------------------------------------
   🔴 THE PERFORMANCE CONSTRAINT, STATED IDENTICALLY IN THREE OTHER HEADERS.
      The city already renders ~1,700 meshes. The obvious build of a 24×24 info
      view is a tinted quad per tile: 576 more meshes and 576 more draw calls
      for a layer the player toggles, and it gets worse with every layer they
      switch on at once.

      So all of it is ONE `PlaneGeometry(GRID, GRID)` with a single
      CanvasTexture. Enabled layers paint into that one canvas in a fixed order;
      the GPU sees one draw call and one texture whatever is enabled. Turning
      every layer on costs exactly as much as turning one on.

   ⚠ AND IT ONLY REPAINTS WHEN SOMETHING CHANGED. The fields are DETERMINISTIC
     and never move, so the signature is (enabled layers + city id + grid +
     which read-through owners answered). On a static field that means the
     canvas is painted ONCE per city per layer set — as against a texture upload
     every tick for a picture that cannot have moved.

   🔴 LinearFilter, NOT Nearest, AND THE CHOICE IS THE DIFFERENCE BETWEEN THE
      TWO KINDS OF DATA LAYER. /src/power uses NearestFilter because its value
      is a DECISION about a tile — this tile is choking — and bilinear smearing
      makes a one-tile bottleneck look like a three-tile one. /src/landvalue
      does the same for its bands. An ore body is not a decision, it is a
      CONTINUOUS BODY in the ground that a tile grid is merely sampling, and
      Nearest would draw the smooth (1-t²)² falloff as a staircase of squares —
      i.e. it would show the sampling artefact instead of the thing.

   🔴 THREE ARRIVES FROM THE HOST — THE GLOBALS TRAP (CLAUDE.md). `THREE`,
      `scene` and `GRID` are top-level `const` in node-city's module script and
      are NOT on `window`. mount(host) is the hand-over; with nothing handed
      over this returns false and the panel's rows disable themselves.
   ════════════════════════════════════════════════════════════════════════════ */

import { RES } from './tuning.js';

let THREE = null, scene = null, mesh = null, tex = null, cvs = null, ctx = null;
let GRID = 24, PX = RES.overlay.px;
let lastSig = '';

export function mounted() { return !!mesh; }
export function object() { return mesh; }

export function mount(host) {
  if (mesh) return true;
  if (!host || !host.THREE || !host.scene) return false;
  THREE = host.THREE; scene = host.scene;
  GRID = host.grid || 24;

  if (typeof document === 'undefined') return false;
  cvs = document.createElement('canvas');
  cvs.width = cvs.height = GRID * PX;
  ctx = cvs.getContext('2d');
  if (!ctx) return false;

  tex = new THREE.CanvasTexture(cvs);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  /* The canvas is authored in sRGB (every hex in tuning.js is a colour a human
     picked), so it must be declared sRGB. ⚠ This is the trap that catches
     VERTEX colours in this project — they are LINEAR, and an sRGB amber typed
     into a buffer renders as pale beige. A texture is the other case and needs
     the flag; the two are not the same fix. */
  if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;

  const geo = new THREE.PlaneGeometry(GRID, GRID);
  /* 🔴 NORMALS ARE NOT OPTIONAL, EVEN FOR MeshBasicMaterial. three's WebGPU node
     materials warn "TSL.NormalNode: Vertex attribute normal not found" once per
     geometry, and the city boots on that path for WebGPU clients.
     ⚠ PlaneGeometry SHIPS a normal attribute (a constant +Z, which -PI/2 about
       X turns into +Y). So this does not overwrite it — it ASSERTS it, and
       fills one in only if a future three drops it. Blindly writing our own
       would silently mask the day the assumption stopped holding. */
  if (!geo.getAttribute('normal')) {
    const n = geo.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = 0; arr[i * 3 + 1] = 0; arr[i * 3 + 2] = 1; }
    geo.setAttribute('normal', new THREE.BufferAttribute(arr, 3));
  }

  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, opacity: RES.overlay.opacity,
    depthWrite: false, toneMapped: false,
  });
  mesh = new THREE.Mesh(geo, mat);
  /* -PI/2 about X lays the plane flat and puts canvas (0,0) at world
     (-GRID/2, -GRID/2), which is tile (0,0) under node-city's own mapping
     (`x - HALF + .5`). No flip is needed anywhere; the canvas IS tile space. */
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, RES.overlay.y, 0);
  mesh.renderOrder = RES.overlay.renderOrder;
  mesh.visible = false;
  /* Never shadow-cast and never receive: this is paint, and a shadow falling
     across a data layer changes the colour the legend just promised. */
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
function cell(x, z, col) { ctx.fillStyle = col; ctx.fillRect(cx(x), cz(z), PX, PX); }
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

/* ── ONE FIELD ──────────────────────────────────────────────────────────────
   `fn` is `(x, z) -> 0..1`, which is the shape every field in this project
   already publishes (`groundAt`, `heatAt`, `airAt`, and this module's own
   `valueAt`). Nothing here knows or cares which module supplied it — the same
   contract /src/power/overlay.js's paintField() states.

   TWO PASSES, AND THE SECOND ONE IS THE FEATURE:
     ① the ramp, alpha-weighted from RES.overlay.fieldAlpha.lo, and CUT at
        `line.cut`. A dense field painted from a high alpha floor washes the
        district flat grey (measured on geothermal heat — see the tuning file),
        so it fades to nothing where it has nothing to say.
     ② the OUTLINE at `line.mark`. A gradient tells a player there is more here
        than there; a line tells them whether they are ON it. That is the
        difference between a picture and a map, and it is what the siting
        refusal points at when it says "every tile inside the outline is a legal
        site".

   🔴 `line` IS A PARAMETER AND NOT A PROPERTY OF `spec`, AND THAT IS THE FIX.
      A read-through layer's threshold belongs to the module that GATES the
      field, so index.js reads it from that owner live and hands it in here. The
      version this replaced took `spec.mark` — a number typed into RES beside a
      `markFrom` that nothing ever read — and cut the paint at the shared alpha
      floor, so the groundwater layer coloured 27.9% of its tiles below
      /src/water's own gate and left 7.2% of the legal ones outside its outline.
      The paint cut matters as much as the outline: a tile tinted 💧 and then
      refused is the map telling a lie the player only discovers by clicking.

   ⚠ `cut` MAY BE LOOSER THAN `mark`, ON PURPOSE. /src/power paints its whole
     heat field and outlines the licence line inside it, so heat arrives here as
     { mark: 0.46, cut: null } and `null` falls back to the alpha floor. Cutting
     the paint at the mark there would make this panel show a different picture
     from the one next to it. Groundwater's two numbers are equal because
     /src/water's own overlay cuts at exactly its gate. */
function paintField(fn, spec, line) {
  const A = RES.overlay.fieldAlpha;
  const stops = spec.ramp;
  const L = line || {};
  const cutRaw = Number(L.cut);
  const cut = isFinite(cutRaw) && cutRaw > A.floor ? cutRaw : A.floor;
  /* `> cut` for the floor (a tile at exactly the alpha floor says nothing) but
     `>= cut` once the OWNER set the line, because the owner's gate is `>=` —
     `basinAt()` accepts `m >= minRead`. One tile of disagreement at the
     boundary is exactly the kind of off-by-one that puts a legal site outside
     the picture, and there is a whole comment above about that. */
  const owned = cut > A.floor;
  for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
    const v = Number(fn(x, z));
    if (!isFinite(v)) continue;
    if (owned ? v < cut : v <= cut) continue;
    ctx.globalAlpha = A.lo + (A.hi - A.lo) * Math.min(1, v);
    cell(x, z, ramp(stops, v));
  }
  const mark = Number(L.mark);
  if (isFinite(mark) && mark > 0) {
    ctx.globalAlpha = RES.overlay.edgeAlpha;
    ctx.fillStyle = spec.key;
    const t = Math.max(1, PX * RES.overlay.edge);
    const out = (xx, zz) => {
      if (xx < 0 || zz < 0 || xx >= GRID || zz >= GRID) return true;
      const v = Number(fn(xx, zz));
      return !isFinite(v) || v < mark;
    };
    for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
      const v = Number(fn(x, z));
      if (!isFinite(v) || v < mark) continue;
      if (out(x, z - 1)) ctx.fillRect(cx(x), cz(z), PX, t);
      if (out(x, z + 1)) ctx.fillRect(cx(x), cz(z) + PX - t, PX, t);
      if (out(x - 1, z)) ctx.fillRect(cx(x), cz(z), t, PX);
      if (out(x + 1, z)) ctx.fillRect(cx(x) + PX - t, cz(z), t, PX);
    }
  }
  ctx.globalAlpha = 1;
}

/* ── THE PAINT ──────────────────────────────────────────────────────────────
   `host` is { F, readers, lines } — F is fields.js's answer for this city,
   `readers` is { groundwater, heat } of `(x,z)->0..1` or null, and `lines` is
   { groundwater, heat } of { mark, cut } read from those layers' OWNERS by
   index.js. A read row with a reader but no line cannot happen: index.js nulls
   the reader in the same place it fails to find the line, so the panel and this
   file can never disagree about which rows are live.

   ORDER IS DELIBERATE AND IS THE OPPOSITE OF THE PANEL'S. The GENERATED fields
   are painted first and the READ-THROUGH ones last, so groundwater — the layer
   the player asked for by name, and the only one with a placement gate behind
   it — is never buried under an ore body. A legend row that is on but invisible
   is worse than one that is off. */
export function sync(host, layers) {
  if (!mesh) return;
  const on = Object.keys(layers).filter(k => layers[k]).sort();
  if (!on.length || !host || !host.F) { mesh.visible = false; return; }
  mesh.visible = true;

  const R = host.readers || {};
  const LN = host.lines || (R.lines || {});
  /* 🔴 THE THRESHOLDS ARE IN THE SIGNATURE. They are read from another module
     every paint, so they CAN move under a live city — /src/water mounting after
     this panel opened is the ordinary case. A signature that quantised only the
     city id would hold a stale picture drawn to a line that no longer exists,
     and it would look exactly like a working overlay. */
  const lsig = RES.read.map(s => {
    const l = LN[s.id];
    return l ? s.id + ':' + Number(l.mark).toFixed(4) + '/' + (l.cut == null ? '-' : Number(l.cut).toFixed(4)) : s.id + ':-';
  }).join(',');
  const sig = on.join(',') + '|' + host.F.cityId + '@' + host.F.grid +
              '|' + (R.groundwater ? 'w' : '-') + (R.heat ? 'h' : '-') + '|' + lsig;
  if (sig === lastSig) return;
  lastSig = sig;

  ctx.clearRect(0, 0, cvs.width, cvs.height);

  for (const spec of RES.fields) {
    if (!layers[spec.id]) continue;
    /* A GENERATED field's line is this module's own richness contour, and it is
       the one case where the number does live in RES — because here this module
       IS the owner. `cut` is left undefined so paintField uses the alpha floor:
       the fringe outside an ore body is still legal ground (`bodyAt` cuts at
       `minRead`, below every mark), so hiding it would under-draw legal sites. */
    paintField((x, z) => host.F.valueAt(spec.id, x, z), spec, { mark: spec.mark, cut: null });
  }
  for (const spec of RES.read) {
    if (!layers[spec.id]) continue;
    const fn = R[spec.id];
    /* 🔴 NO FALLBACK, EVER. If the owner is absent the row is DISABLED in the
       panel and nothing is drawn here. A layer that paints something plausible
       when its data source is missing is indistinguishable from a working
       feature, and it would have to be un-taught — the anti-fallback rule
       /src/power/panel.js and /src/water/panel.js both state, and the same
       discipline /src/ocean applies when it refuses to guess a coastline. */
    if (typeof fn !== 'function') continue;
    /* 🔴 AND NO LINE MEANS NO PAINT, for the same reason. Drawing this field
       from an alpha floor this module chose would put a colour on ground the
       owner's gate refuses — the defect measured at the top of paintField. */
    const line = LN[spec.id];
    if (!line) continue;
    paintField(fn, spec, line);
  }

  tex.needsUpdate = true;
}

export function hide() { if (mesh) mesh.visible = false; }
export function repaintNext() { lastSig = ''; }
