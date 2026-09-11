/* ════════════════════════════════════════════════════════════════════════════
   🙂 THE PLOT-MOOD GLYPH LAYER — one mesh, one CanvasTexture, in world space.
   ----------------------------------------------------------------------------
   Cities: Skylines 2 floats a small badge over a building that has a problem:
   a face AND the reason — a drop for no water, a bolt for no power, a shield
   for an unsafe block. That second half is the whole design. A bare mood dot is
   a happiness bar with extra steps, and this project has twice had to tear one
   out of a shipped panel.

   ── WHAT THIS FILE OWNS, AND WHAT IT DELIBERATELY DOES NOT ──────────────────
   `index.js` in this same folder owns the VERDICT: which tile is judged, its
   score, its `reason` id and its `fix` sentence, every one of them read off a
   number the city already computes. THIS FILE OWNS THE GLYPH — the art, the
   mesh, the toggle and the legend — and it invents no verdict of its own. It
   installs itself through the seam index.js published for exactly this
   (`setPainter(fn)`), so there is ONE object in the scene rather than two, and
   it takes the label and the remedy for every legend row from
   `MythicPlotMood.REASONS` AT CALL TIME rather than keeping a copy. A legend
   with its own copy of the model's sentences is a legend that goes stale the
   day the model is retuned.

   🔴 NO VERDICT MODULE, NO BADGES — AND THE LEGEND SAYS SO. An earlier cut of
      this file carried its own reader over a host snapshot so it could draw
      something on its own. That was removed: two readers of the same city is
      the "two different stories about the same street" failure this codebase
      has now named four times. If /src/plotmood/index.js 404s, this layer draws
      nothing and `source()` returns 'none', which the legend prints.

   🔴 THE PERFORMANCE CONSTRAINT, and it is the one /src/power/overlay.js and
      /src/water/overlay.js each refused to lose. A 24×24 board is 576 potential
      badges; a Sprite (or a quad, or a Group) per tile is 576 more meshes and
      576 more draw calls in a scene already running ~1,700 meshes. So this is
      ONE indexed BufferGeometry of quads over ONE CanvasTexture atlas with ONE
      MeshBasicMaterial. Forty badges cost exactly what one costs: a single draw
      call. Measured, not asserted — `cost()` reports it and
      .gauntlet/drive-moodicons.mjs prints the renderer's own delta beside it.

   ⚠ THE BUFFERS ARE ALLOCATED ONCE, AT MOUNT, FOR `MOOD.max` BADGES. paint()
     writes into them and moves `drawRange`; nothing here mints a buffer per
     tick. That is the same discipline as the two sibling overlays' `lastSig`
     repaint gates, and this file keeps that gate too.

   ── WHY THIS DRAWS THE QUADS ITSELF INSTEAD OF REUSING index.js's POINTS ────
   index.js's own painter is a `THREE.Points` cloud with a GLSL ShaderMaterial,
   and it is a good design that this build cannot keep, for two measured
   reasons:
     1. node-city constructs a WebGPURenderer under `?renderer=webgpu` (see THE
        SHADOW BUG at the renderer construction). A GLSL ShaderMaterial handed
        to the node pipeline is A BLANK LAYER WITH A CLEAN CONSOLE — the exact
        failure mode this project keeps paying for. A MeshBasicMaterial renders
        under both renderers.
     2. `gl_PointCoord` gives a SQUARE sprite, so the badge can only be one
        symbol. The brief is a face AND a reason side by side, which needs a
        rectangle.
   The corners are therefore written on the CPU from the camera's own right/up
   vectors inside `onBeforeRender`, which BOTH renderers call. The cost is four
   vec3 writes per visible badge per frame — 160 at the cap — skipped entirely
   when neither the camera matrix nor the badge set has moved.

   ⚠ onBeforeRender IS ALSO WHY THIS SURVIVES THE RENDER TRAP (CLAUDE.md). The
     billboard is rebuilt DURING renderer.render(), so a driver that renders,
     orbits and renders again photographs a correctly-anchored badge both times
     with no hook in the host's animate(). A HUD overlay looks identical in one
     still and fails the second render; this does not.

   ── WHY THE GLYPHS ARE PATHS AND NOT EMOJI TEXT ─────────────────────────────
   `ctx.fillText('💧')` is shorter and was rejected. An emoji glyph depends on a
   font being installed; where it is not, it renders as a tofu box or as nothing
   — silently. A data layer whose REASON can silently disappear is precisely the
   "decorative emoji that is not reading a real value" this feature must not be,
   and it is also unphotographable on the headless box the gauntlet drives.
   Every glyph below is arcs and lines.

   ── ANCHORING, DEPTH AND LIGHT ──────────────────────────────────────────────
   · The anchor is the tile centre under node-city's own mapping, handed over as
     `worldOf` rather than re-derived, raised to the top of that tile's mesh.
     World space, not screen space: orbit and the badge stays over its building.
   · `depthTest: false` — a status icon hidden behind the building it is
     complaining about is not a status icon. It is the one place this layer
     differs from the two ground-plane overlays, which have nothing to occlude
     them.
   · `depthWrite: false`, `toneMapped: false`, no shadow cast or received. A
     shadow across a data layer changes the colour the legend promised, and tone
     mapping would do the same more quietly.

   🔴 THREE ARRIVES FROM THE HOST — THE GLOBALS TRAP (CLAUDE.md). `THREE`,
      `scene` and the tile→world mapping are top-level `const` in node-city's
      module script and invisible to an ES module. This file imports nothing
      from the page; mount() is handed what it needs or it returns false and no
      toggle is offered.
   ════════════════════════════════════════════════════════════════════════════ */

export const MOOD = {
  /* 🔴 THE CAP, AND IT IS PART OF THE FEATURE. "A content city must not become
     a wall of smileys." Only flagged tiles draw at all, and when more than
     `max` are flagged the WORST `max` draw — ranked by the verdict module's own
     score, never by a ranking invented here. `overflow()` reports how many were
     withheld so the count is never silently wrong. */
  max: 40,
  /* 🔴 …AND THE CAP IS NOT THE SAME THING AS A DECLUTTER, WHICH IS WHAT THE
     LINE ABOVE USED TO IMPLY. `max` bounds the COUNT. Nothing bounded the
     DENSITY, and a badge is MOOD.w = 1.7 tiles wide on 1-tile spacing, so on
     any solid block they MUST pile up — measured on a 6×7 housing block with
     agents culled and a do-nothing control of exactly 0 px: the median badge
     had 94.9 % of its screen box sat on by other badges and 35 of 40 were
     more than 90 % covered, i.e. roughly three-quarters of the ink this layer
     drew was buried under itself. A layer whose whole promise is "you can
     tell WHICH building is complaining" failing on a normal residential block
     is the feature failing in the case CS2 is built around.
     `declutter` is the fraction of a candidate badge’s own screen box that
     may already be taken by badges accepted before it. Above that it is not
     drawn at all, and `culled()` reports how many — the same contract as
     `overflow()`: withheld is fine, silently withheld is not.
     ⚠ THE ACCEPT ORDER IS THE VERDICT MODULE’S OWN RANKING (worst score
       first), NOT the camera. So the WORST badge on screen can never be the
       one that loses its place, at any camera angle, and the set is stable
       under orbit except for boxes sitting exactly on the threshold.
     🚫 REJECTED: nudging colliding badges apart. That detaches the glyph from
        the roof it is describing, which is the one thing this layer sells.
        Hiding a badge is honest and counted; moving one is a quiet lie about
        which building has the problem. */
  declutter: 0.45,
  w: 1.7, h: 0.98,        // badge size in tiles at `refDist`
  refDist: 26,            // the default camera sits about here
  minScale: 0.62, maxScale: 2.1,
  lift: 0.55,             // above the roof line, so it clears the mesh
  fallbackTop: 1.4,
  renderOrder: 30,
  /* 🔴 THE ATLAS IS SIZED FROM A BOUND, NOT FROM A GUESS — AND THE GUESS WAS
     WRONG. This was 4×4 = 16 cells, described as "13 reasons + room", and the
     count was of the REASON CATALOGUE rather than of what a city actually
     presents at once. A city short of all eight NEEDS while some plot is also
     off the mains is 8 `need:*` keys plus 5 local ones = 13 ids AT ONE MOOD,
     and the cell key carried the mood too, so anything mixed in severity ran
     past 16 immediately. Over the cap `cellOf[key]` was undefined, the old
     `|| 0` sent it to cell 0, and the badge drew SOMEBODY ELSE'S GLYPH — a
     data layer confidently naming the wrong defect, which is worse than no
     layer. Two changes make that unreachable rather than unlikely:
       · cells are keyed on the ART (mood + glyph shape), not on the reason id,
         so `water` and `need:water` — identical pictures — share one cell
         instead of burning two, and any number of future reason ids that map
         to the same shape cost nothing;
       · 3 moods × the 13 shapes in GLYPH is 39, so 6×7 = 42 cells cannot be
         exhausted by anything this file can draw.
     The cost of the bigger sheet is one texture of 1152×784 instead of
     768×448 — still ONE texture, still one draw call, and it is only ever
     repainted when the set of shapes on screen changes. */
  cell: { w: 192, h: 112 }, cols: 6, rows: 7,   // 42 cells ≥ 3 moods × 13 shapes
};

/* ── THE GLYPH TABLE ─────────────────────────────────────────────────────────
   Keyed on the verdict module's OWN reason ids. This file owns only the two
   columns it is allowed to own — which shape is drawn, and which mood colour it
   is drawn in. The human-readable label and the remedy come from
   `MythicPlotMood.REASONS[id]` at call time, so they cannot drift from the
   model that produced them.
   ⚠ AN UNKNOWN ID STILL DRAWS. A fourteenth reason added to the verdict module
     gets the `unknown` glyph and its own label in the legend rather than
     silently vanishing — a missing badge is indistinguishable from a healthy
     tile, which is the worst way for this layer to fail.
   ⚠ AND THE ATLAS IS KEYED ON THE SHAPE THIS TABLE RETURNS, NOT ON THE ID —
     so that fourteenth reason costs no new cell. See MOOD.cols. */
const GLYPH_OF = {
  ok: 'none', meh: 'none',
  water: 'drop', power: 'bolt', road: 'road', dark: 'lamp', roadcap: 'meter',
  food: 'bowl', health: 'plus', safety: 'shield', light: 'moon',
  leisure: 'note', deathcare: 'stone',
};
/* face → mood colour. The verdict module publishes `face` as 'ok' | 'meh' |
   'bad' and that is the only mood signal read here; nothing in this file
   decides how a tile feels. */
const MOOD_OF = { ok: 'good', meh: 'warn', bad: 'bad' };

const COL = {
  bad:  { ring: '#ff5a4e', face: '#ff7a68', ink: '#2a0d09' },
  warn: { ring: '#ffb020', face: '#ffc861', ink: '#2e1f02' },
  good: { ring: '#57d38c', face: '#7fe3aa', ink: '#062416' },
  bg: 'rgba(14,18,24,0.90)',
};

/* ── module state ────────────────────────────────────────────────────────── */
let THREE = null, scene = null, host = null;
let mesh = null, geo = null, tex = null, cvs = null, ctx = null, mat = null;
let posAttr = null, uvAttr = null, idxAttr = null;
/* Per-badge scratch, allocated once at mount and reused: distance to the
   camera, the screen-space box, and whether the declutter dropped it. These
   are rewritten inside onBeforeRender, so allocating here is the difference
   between a layer that costs nothing and one that feeds the GC every frame. */
let _dist = null, _box = null, _cull = null, _order = null, _drawN = 0, _culledN = 0;
let _pv = null, _tmp = null;
let anchors = [];
let live = [];
let cellOf = {};
let atlasSig = '', dataSig = '', camSig = '', overflowN = 0, srcName = 'none';
let opts = { problems: true, praise: false };
let legendEl = null;
const _right = { x: 0, y: 0, z: 0 }, _up = { x: 0, y: 0, z: 0 };
let _camPos = null;

export function mounted() { return !!mesh; }
export function visible() { return !!(mesh && mesh.visible); }
export function source() { return srcName; }
export function overflow() { return overflowN; }
/* Withheld by the SCREEN, not by the cap: how many badges the declutter hid
   behind other badges at the current camera, and how many quads actually
   reached the draw call. Two different numbers from two different causes, so
   they are reported separately rather than added together — a player who
   zooms in gets the culled ones back and never gets the overflowed ones. */
export function culled() { return _culledN; }
export function onScreen() { return _drawN; }
export function options() { return { problems: opts.problems, praise: opts.praise }; }

/* The verdict module, read at CALL time and never captured. It mounts in the
   same await chain as this one and the order between them is not guaranteed. */
function VM() { try { return (typeof window !== 'undefined') ? window.MythicPlotMood : null; } catch (e) { return null; } }

/* 🔴 THE `need:` PREFIX, AND IT COST A DEFECT THAT LOOKED FINE.
   index.js publishes a city-need verdict as `reason: 'need:health'` while its
   REASONS table is keyed on the bare `health` — the prefix is what lets the
   record say "this is the CITY being short, not this plot". Looked up unstripped
   it misses both tables at once: the badge falls through to the `unknown` glyph
   and the legend prints the raw id instead of the module's sentence. Both fail
   SILENTLY and both photograph like a working layer, which is why the id is
   normalised in exactly one place — here. */
function baseId(id) {
  const s = String(id || '');
  return s.indexOf('need:') === 0 ? s.slice(5) : s;
}
/* Which SHAPE a reason id draws. This is the atlas's key half — see the note on
   MOOD.cols. Every id that has no art of its own answers `unknown` rather than
   nothing, so it still occupies a real cell and still draws. */
function glyphKey(id) {
  const b = baseId(id);
  return GLYPH_OF[b] || (b === 'ok' || b === 'meh' ? 'none' : 'unknown');
}
function cellKey(mood, reason) { return mood + '|' + glyphKey(reason); }

function reasonMeta(id) {
  try { const R = VM() && VM().REASONS; const b = baseId(id); if (R && R[b]) return R[b]; } catch (e) {}
  return null;
}

/* ════════════════════════════════════════════════════════════════════════════
   MOUNT
   ════════════════════════════════════════════════════════════════════════════ */
export function mount(h) {
  if (mesh) return true;
  if (!h || !h.THREE || !h.scene) return false;
  THREE = h.THREE; scene = h.scene; host = h;

  cvs = document.createElement('canvas');
  cvs.width = MOOD.cell.w * MOOD.cols;
  cvs.height = MOOD.cell.h * MOOD.rows;
  ctx = cvs.getContext('2d');
  if (!ctx) return false;

  tex = new THREE.CanvasTexture(cvs);
  /* LinearFilter, unlike /src/power/overlay.js's NearestFilter, and the reason
     is the subject: that layer paints TILES, where a smear across a boundary
     turns a one-tile bottleneck into a three-tile one. This paints curves at an
     arbitrary on-screen size, and nearest sampling would staircase every mouth. */
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;

  const N = MOOD.max;
  geo = new THREE.BufferGeometry();
  posAttr = new THREE.BufferAttribute(new Float32Array(N * 4 * 3), 3);
  uvAttr = new THREE.BufferAttribute(new Float32Array(N * 4 * 2), 2);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  uvAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('uv', uvAttr);
  const idx = new Uint16Array(N * 6);
  for (let i = 0; i < N; i++) {
    const v = i * 4, o = i * 6;
    idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
    idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
  }
  /* 🔴 THE INDEX BUFFER IS NOW *DYNAMIC*, AND THAT IS THE WHOLE DEPTH FIX.
     The material is depthTest:false / depthWrite:false in ONE indexed draw,
     so the last quad in the index buffer wins the pixels no matter where it
     is in the world. The old order was apply()’s (score, x, z) — arbitrary
     with respect to the camera. Measured on one city, one code path, only the
     camera differing: at cam [20,22,20] 250 of 284 significantly-overlapping
     pairs happened to have the NEARER badge on top (luck of the x/z tie-break);
     rotate 180° to cam [-30,22,-30] and that inverts to 190 of 211 pairs where
     a FARTHER plot’s badge paints over a nearer one. Reordering the INDEX is
     the cheap correct fix — positions and UVs stay put, so a sort is 40
     numbers and no vertex data moves.
     ⚠ Sorting the vertex data instead was the first design and it is wrong:
       the UVs are what tie a quad to its glyph cell, so any reorder that
       forgets to carry them draws the right badge in the wrong place with a
       clean console. Nothing about the index order can do that. */
  idxAttr = new THREE.BufferAttribute(idx, 1);
  idxAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setIndex(idxAttr);
  _dist = new Float64Array(N);
  _box = new Float64Array(N * 4);
  _cull = new Uint8Array(N);
  _order = new Int32Array(N);
  geo.setDrawRange(0, 0);

  mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, side: THREE.DoubleSide,
    /* 🔴 forceSinglePass, AND IT IS THE DIFFERENCE BETWEEN THE HEADER'S CLAIM
       AND THE MEASUREMENT. This file says "one draw call"; the renderer said
       TWO, with 8 triangles for a 4-triangle layer. Neither the shadow map
       (off: same delta) nor a second object (onBeforeRender fires exactly once
       per render) explained it — three renders a material that is BOTH
       `transparent` and `DoubleSide` in two passes, back faces then front,
       unless this flag is set. See three@0.171 build/three.module.js:15565:
         material.transparent && material.side === DoubleSide && !forceSinglePass
       The two-pass ordering exists so a transparent shell sorts against itself;
       a flat billboard has no inside to sort against, so it buys nothing here
       and cost exactly double.
       ⚠ AND DoubleSide IS KEPT RATHER THAN WINDING THE QUAD FOR FrontSide. The
         corners are built from the camera's right/up, which makes the CCW face
         point AWAY from the camera — FrontSide today would need the index order
         inverted, and any later change to that basis would then turn the whole
         layer invisible with a clean console. Blank-and-silent is this
         project's most expensive failure mode; visible-from-either-side at one
         draw call is the same price without it. */
    forceSinglePass: true,
    depthTest: false, depthWrite: false, toneMapped: false, alphaTest: 0.02,
    /* 🔴 fog:false, AND IT WAS A MEASURED BUG, NOT A PRECAUTION. It defaults to
       TRUE on every three material, and node-city's scene carries Fog. Driven:
       with fog on, the badge over a tile ~35 units from the camera moved
       EXACTLY 0.00 % of its crop while the identical badge at ~28 units moved
       11.1 % — the far one was being mixed into the sky until it fell under the
       6/255 threshold. A status icon that silently fades out at the far end of
       the same board is worse than one that is never drawn, because the empty
       sky over a failing block reads as a healthy block. Same argument as
       toneMapped:false and the no-shadow rule: nothing in the scene is allowed
       to restate this layer's colours. */
    fog: false,
  });

  mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'mythic-plotmood-icons';
  mesh.renderOrder = MOOD.renderOrder;
  mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.userData.noShadow = true;
  /* ⚠ frustumCulled OFF ON PURPOSE. `position` holds BILLBOARD CORNERS,
     rewritten on every camera move, so three's bounding sphere (computed from
     those same corners) would be one frame stale and could cull the whole layer
     for a frame during a fast orbit — an intermittent disappearance, which is
     worse than a constant one because nobody believes the bug report. At 40
     quads there is nothing to save. */
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  _camPos = new THREE.Vector3();

  /* 🔴 THE BILLBOARD, REBUILT INSIDE renderer.render(). Both renderers call
     this, which is the whole reason the corners are written here rather than in
     a vertex shader. */
  mesh.onBeforeRender = function (renderer, sc, camera) { faceCamera(camera); };

  /* 🔗 INSTALL INTO THE VERDICT MODULE'S OWN SEAM. index.js published
     `setPainter(fn)` for this merge in as many words. Taking it means
     `paintPoints` never runs, `ensureObject()` is never called and its
     THREE.Points is never created — ONE object in the scene, not two.
     If the verdict module is absent, this layer simply draws nothing and
     source() says so; it does not fall back to a second opinion. */
  try {
    const M = VM();
    if (M && typeof M.setPainter === 'function') { M.setPainter(paint); srcName = 'MythicPlotMood'; }
    else srcName = 'none';
  } catch (e) { srcName = 'none'; }

  paintAtlas();
  return true;
}

export function unmount() {
  if (!mesh) return false;
  try { scene.remove(mesh); } catch (e) {}
  try { geo.dispose(); mat.dispose(); tex.dispose(); } catch (e) {}
  mesh = geo = mat = tex = cvs = ctx = posAttr = uvAttr = null;
  anchors = []; live = []; cellOf = {}; atlasSig = dataSig = camSig = '';
  idxAttr = null; _dist = _box = _cull = _order = null; _pv = _tmp = null;
  _drawN = 0; _culledN = 0;
  return true;
}

/* ════════════════════════════════════════════════════════════════════════════
   THE BILLBOARD — four corners per badge, from the camera's own basis.
   ════════════════════════════════════════════════════════════════════════════ */
function faceCamera(camera) {
  if (!mesh || !live.length || !camera) return;
  const e = camera.matrixWorld.elements;
  const sig = live.length + '|' + e[0].toFixed(4) + ',' + e[1].toFixed(4) + ',' + e[2].toFixed(4) +
              ',' + e[4].toFixed(4) + ',' + e[5].toFixed(4) + ',' + e[6].toFixed(4) +
              ',' + e[12].toFixed(3) + ',' + e[13].toFixed(3) + ',' + e[14].toFixed(3) + '|' + dataSig;
  if (sig === camSig) return;         // nothing has moved — skip the rewrite
  camSig = sig;

  _right.x = e[0]; _right.y = e[1]; _right.z = e[2];
  _up.x = e[4]; _up.y = e[5]; _up.z = e[6];
  _camPos.set(e[12], e[13], e[14]);

  const arr = posAttr.array;
  for (let i = 0; i < live.length; i++) {
    const a = anchors[i];
    const dx = a.x - _camPos.x, dy = a.y - _camPos.y, dz = a.z - _camPos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    _dist[i] = dist;
    /* Distance compensation, CLAMPED AT BOTH ENDS. Pure world-size badges
       vanish when the player zooms out; pure screen-size badges tile the sky
       into a wall of faces at that same moment. The clamp is the middle. */
    let s = dist / MOOD.refDist;
    if (s < MOOD.minScale) s = MOOD.minScale; else if (s > MOOD.maxScale) s = MOOD.maxScale;
    const hw = MOOD.w * s * 0.5, hh = MOOD.h * s * 0.5;
    const o = i * 12;
    arr[o]      = a.x - _right.x * hw + _up.x * hh;
    arr[o +  1] = a.y - _right.y * hw + _up.y * hh;
    arr[o +  2] = a.z - _right.z * hw + _up.z * hh;
    arr[o +  3] = a.x + _right.x * hw + _up.x * hh;
    arr[o +  4] = a.y + _right.y * hw + _up.y * hh;
    arr[o +  5] = a.z + _right.z * hw + _up.z * hh;
    arr[o +  6] = a.x + _right.x * hw - _up.x * hh;
    arr[o +  7] = a.y + _right.y * hw - _up.y * hh;
    arr[o +  8] = a.z + _right.z * hw - _up.z * hh;
    arr[o +  9] = a.x - _right.x * hw - _up.x * hh;
    arr[o + 10] = a.y - _right.y * hw - _up.y * hh;
    arr[o + 11] = a.z - _right.z * hw - _up.z * hh;
  }
  posAttr.needsUpdate = true;
  declutter(camera, arr);
}

/* ════════════════════════════════════════════════════════════════════════════
   DECLUTTER + DEPTH ORDER — the two things a world-space icon layer owes the
   player once there is more than one of them on screen.

   Both live here, in the ONE place that already knows where the camera is,
   and both are gated behind faceCamera’s `camSig` — so on a still frame this
   costs a string compare and a return, exactly as the billboard rewrite does.
   Work when it does run, at MOOD.max = 40: 40 projections and at most 780
   box overlaps (i·(i-1)/2), then a 40-element sort. That is nothing beside
   the single draw call it protects, and it is why the cap and the declutter
   are separate knobs rather than one.

   🔴 WHY SCREEN SPACE AND NOT TILE SPACE. "Hide a badge if a neighbouring
      tile has one" is cheaper and wrong: whether two badges collide depends
      entirely on the camera. Zoomed out, tiles four apart overlap; zoomed in
      on the same block, adjacent ones do not, and a tile-space rule would go
      on hiding badges the player has plainly made room to read. The overlap
      the player sees is the overlap that gets measured.

   ⚠ COVERAGE IS SUMMED, NOT UNIONED. Summing double-counts where two accepted
     badges overlap each other, so it OVER-states how buried a candidate is and
     errs toward hiding it. That direction is the safe one — the failure mode
     of the true union would be keeping a badge that is in fact unreadable,
     which is the bug being fixed — and a real union over 40 boxes is a
     rectangle-decomposition on the hot path for a difference nobody can see.
   ════════════════════════════════════════════════════════════════════════════ */
function declutter(camera, arr) {
  const n = live.length;
  if (!_pv) { _pv = new THREE.Matrix4(); _tmp = new THREE.Vector3(); }
  /* projectionMatrix × matrixWorldInverse. Vector3.applyMatrix4 does the
     perspective divide, so the result is NDC and a 1:1 aspect is fine — this
     only ever compares boxes against each other. */
  _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const m = _pv.elements;
  _culledN = 0;

  for (let i = 0; i < n; i++) {
    const o = i * 12;
    /* Corner 0 (top-left) and corner 2 (bottom-right). The quad is built from
       the camera’s own right/up, so those two opposite corners ARE the screen
       box — no need to project all four. */
    const ax = arr[o], ay = arr[o + 1], az = arr[o + 2];
    const bx = arr[o + 6], by = arr[o + 7], bz = arr[o + 8];
    /* ⚠ BEHIND THE CAMERA IS NOT A SMALL BOX, IT IS A MIRRORED ONE. w <= 0
       flips both NDC axes, so an un-guarded projection would hand the
       declutter a phantom box somewhere on screen and let it hide a badge the
       player can actually see. frustumCulled is off on this mesh (on purpose,
       see mount), so these quads were being drawn as garbage anyway. */
    const wA = m[3] * ax + m[7] * ay + m[11] * az + m[15];
    const wB = m[3] * bx + m[7] * by + m[11] * bz + m[15];
    if (!(wA > 1e-6) || !(wB > 1e-6)) { _cull[i] = 1; _culledN++; continue; }
    _tmp.set(ax, ay, az).applyMatrix4(_pv);
    const x0 = _tmp.x, y0 = _tmp.y;
    _tmp.set(bx, by, bz).applyMatrix4(_pv);
    const x1 = _tmp.x, y1 = _tmp.y;
    const q = i * 4;
    _box[q]     = Math.min(x0, x1);
    _box[q + 1] = Math.min(y0, y1);
    _box[q + 2] = Math.max(x0, x1);
    _box[q + 3] = Math.max(y0, y1);
    _cull[i] = 0;
  }

  /* GREEDY, IN THE VERDICT MODULE’S OWN WORST-FIRST ORDER. `live` is already
     sorted by score ascending (see apply()), so index 0 is the worst plot on
     the board and is accepted unconditionally. Nothing about the ranking is
     decided here — this only ever answers "is there room left to draw it". */
  let kept = 0;
  for (let i = 0; i < n; i++) {
    if (_cull[i]) continue;
    const q = i * 4;
    const ax0 = _box[q], ay0 = _box[q + 1], ax1 = _box[q + 2], ay1 = _box[q + 3];
    const area = (ax1 - ax0) * (ay1 - ay0);
    if (!(area > 0)) { _cull[i] = 1; _culledN++; continue; }
    let taken = 0;
    for (let j = 0; j < i; j++) {
      if (_cull[j]) continue;
      const p = j * 4;
      const ox = Math.min(ax1, _box[p + 2]) - Math.max(ax0, _box[p]);
      if (ox <= 0) continue;
      const oy = Math.min(ay1, _box[p + 3]) - Math.max(ay0, _box[p + 1]);
      if (oy <= 0) continue;
      taken += (ox * oy) / area;
      if (taken >= MOOD.declutter) break;
    }
    if (taken >= MOOD.declutter) { _cull[i] = 1; _culledN++; } else kept++;
  }

  /* FAR TO NEAR. With depthTest off the index order IS the depth order, so the
     nearest badge must be written LAST to win the pixels where two survivors
     still touch. (They can: the declutter budget allows overlap up to
     MOOD.declutter, it does not forbid it.) */
  let k = 0;
  for (let i = 0; i < n; i++) if (!_cull[i]) _order[k++] = i;
  const ord = Array.prototype.slice.call(_order, 0, k);
  ord.sort((a, b) => _dist[b] - _dist[a]);

  const idx = idxAttr.array;
  for (let s = 0; s < ord.length; s++) {
    const v = ord[s] * 4, o = s * 6;
    idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
    idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
  }
  idxAttr.needsUpdate = true;
  _drawN = ord.length;
  geo.setDrawRange(0, ord.length * 6);
}

/* ════════════════════════════════════════════════════════════════════════════
   PAINT — the callback index.js's repaint() hands the verdict table to.
   ════════════════════════════════════════════════════════════════════════════ */
export function paint(table) {
  if (!mesh || !table) return false;
  const list = [];
  try { for (const v of table.values()) list.push(v); }
  catch (e) { if (Array.isArray(table)) list.push(...table); else return false; }
  return apply(list);
}

/* Ask the verdict module for a fresh answer. `repaint()` is ITS gate: it
   recomputes the table and calls the painter only when its own signature moved,
   so calling this on every economy tick costs a signature comparison on a city
   that has not changed. */
export function sync() {
  if (!mesh) return null;
  const M = VM();
  if (!M || !M.ready || !M.ready()) { srcName = 'none'; return stats(); }
  srcName = 'MythicPlotMood';
  try { M.repaint(); } catch (e) {}
  return stats();
}

function apply(listIn) {
  const norm = [];
  for (const raw of listIn) {
    const n = normalise(raw);
    if (!n) continue;
    if (n.mood === 'good' && !opts.praise) continue;
    if (n.mood !== 'good' && !opts.problems) continue;
    norm.push(n);
  }
  /* WORST FIRST, by the verdict module's OWN score (lower is worse). The tile
     order breaks ties so two equal scores never swap places between ticks and
     make the layer flicker. No ranking is invented here. */
  norm.sort((a, b) => (a.score - b.score) || (a.x - b.x) || (a.z - b.z));
  overflowN = Math.max(0, norm.length - MOOD.max);
  const keep = norm.slice(0, MOOD.max);

  const sig = keep.map(v => v.x + ',' + v.z + ',' + v.reason + ',' + v.mood).join(';') +
              '|' + opts.problems + opts.praise;
  if (sig === dataSig) { renderLegend(); return true; }   // ⚠ THE REPAINT GATE
  dataSig = sig;
  camSig = '';                                            // force the billboard to rebuild

  ensureCells(keep);
  rebuild(keep);
  renderLegend();
  return true;
}

function stats() {
  return { icons: live.length, withheld: overflowN, source: srcName,
           onScreen: _drawN, culled: _culledN,
           visible: visible(), cells: Object.keys(cellOf).length };
}

/* The verdict module's record is `{ k, x, z, score, reason, face, fix, … }`.
   Being liberal about the key names is cheap; being strict would let the model
   and its renderer disagree about one name and draw nothing, with a clean
   console. */
function normalise(raw) {
  if (!raw) return null;
  let x = raw.x, z = raw.z;
  if (x == null && typeof raw.k === 'string') { const p = raw.k.split(','); x = +p[0]; z = +p[1]; }
  x = Math.round(Number(x)); z = Math.round(Number(z));
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const rid = String(raw.reason || raw.code || 'unknown');
  const face = String(raw.face || (rid === 'ok' ? 'ok' : 'bad'));
  const mood = MOOD_OF[face] || 'bad';
  const score = Number.isFinite(+raw.score) ? +raw.score : (mood === 'good' ? 1 : 0);
  /* `label` and `fix` are carried from the RECORD, not looked up again here.
     index.js already resolved them for this verdict (including the ok/meh
     override), and resolving them a second time is how a tooltip comes to
     disagree with the card that reads the same record. */
  return { x, z, reason: rid, mood, score, key: raw.k || (x + ',' + z),
           label: raw.label || null, fix: raw.fix || '' };
}

/* One atlas cell per (mood, reason) actually in use, repainted ONLY when that
   set changes. A city that stays broken in the same way repaints once. */
function ensureCells(keep) {
  const want = {};
  for (const v of keep) want[cellKey(v.mood, v.reason)] = 1;
  const sig = Object.keys(want).sort().join(';');
  if (sig === atlasSig) return;
  atlasSig = sig;
  cellOf = {};
  let i = 0;
  const cap = MOOD.cols * MOOD.rows;
  /* The break is unreachable by the arithmetic above and is kept anyway: if a
     later edit adds a fourteenth shape or a fourth mood without growing the
     sheet, the badges that find no cell are DROPPED and counted (see rebuild),
     never drawn with a neighbour's symbol. Losing a badge is visible in the
     legend's own count; drawing the wrong one is not visible at all. */
  for (const k of Object.keys(want).sort()) { if (i >= cap) break; cellOf[k] = i++; }
  paintAtlas();
}

function rebuild(keep) {
  /* ⚠ A BADGE WITH NO CELL IS NOT DRAWN AT ALL. The old line here was
     `cellOf[key] || 0`, which silently pointed an unallocated badge at cell 0
     — the frown said "no road access" while the picture said whatever cell 0
     happened to hold. With the atlas now sized from a bound this list is
     always empty, and it is filtered rather than defaulted so that if it ever
     is not, the layer under-reports instead of lying. */
  const short = keep.filter(v => cellOf[cellKey(v.mood, v.reason)] === undefined);
  if (short.length) { keep = keep.filter(v => cellOf[cellKey(v.mood, v.reason)] !== undefined); overflowN += short.length; }
  live = keep;
  anchors = [];
  const uv = uvAttr.array;
  const cw = 1 / MOOD.cols, ch = 1 / MOOD.rows;
  for (let i = 0; i < keep.length; i++) {
    const v = keep[i];
    const w = worldOf(v.x, v.z);
    anchors.push(new THREE.Vector3(w.x, anchorY(v), w.z));
    const cell = cellOf[cellKey(v.mood, v.reason)];
    const cx = (cell % MOOD.cols) * cw;
    /* Canvas rows run top-down and UV rows run bottom-up: canvas row 0 is the
       TOP, i.e. v from 1-ch to 1. Getting this backwards silently swaps one
       badge for another, so it is written once, here. */
    const row = Math.floor(cell / MOOD.cols);
    const v1 = 1 - row * ch, v0 = v1 - ch;
    const o = i * 8;
    uv[o] = cx;          uv[o + 1] = v1;
    uv[o + 2] = cx + cw; uv[o + 3] = v1;
    uv[o + 4] = cx + cw; uv[o + 5] = v0;
    uv[o + 6] = cx;      uv[o + 7] = v0;
  }
  uvAttr.needsUpdate = true;
  geo.setDrawRange(0, keep.length * 6);
}

/* The tile→world mapping is the HOST'S — placeMeshAt's own expression, handed
   over rather than copied. Duplicating it is how an overlay drifts off its
   tile, and this layer's whole claim is that it has not. */
function worldOf(x, z) {
  try { if (host && typeof host.worldOf === 'function') { const w = host.worldOf(x, z); if (w) return w; } } catch (e) {}
  const half = ((host && host.grid) || 24) / 2;
  return { x: x - half + 0.5, z: z - half + 0.5 };
}

/* The badge sits above the ROOF, not above the ground — a bolt floating inside
   a tower is unreadable. `topAt` is the host's measurement of the tile's own
   mesh, because the host is the only side that can see `game.tiles`. */
function anchorY(v) {
  let top = MOOD.fallbackTop;
  try {
    if (host && typeof host.topAt === 'function') {
      const t = host.topAt(v.x, v.z);
      if (Number.isFinite(+t) && +t > 0) top = +t;
    }
  } catch (e) {}
  return top + MOOD.lift;
}

/* The world anchor of a tile, published so a driver can project it through the
   LIVE camera and compare it against the badge's bright-pixel centroid — then
   orbit and do it again. That is the difference between a world-space layer and
   a HUD, and a HUD looks identical in a single still. */
export function anchorAt(x, z) {
  const i = live.findIndex(l => l.x === x && l.z === z);
  const v = i < 0 ? null : live[i];
  const w = worldOf(x, z);
  /* `drawn` means the verdict module flagged this tile AND the declutter left
     room for it. Splitting the two out (`flagged` / `occluded`) matters: a
     driver that cannot tell "no badge" from "badge hidden behind a neighbour"
     will read a working declutter as a broken verdict. */
  return { x: w.x, y: anchorY(v || { x, z }), z: w.z,
           flagged: !!v, occluded: !!(v && _cull && _cull[i]),
           drawn: !!(v && !(_cull && _cull[i])), reason: v ? v.reason : null };
}
/* ⚠ `occluded` IS NOT COSMETIC — IT IS WHAT KEEPS THIS HANDLE HONEST. Before
   the declutter existed every record here was on screen, so a driver could
   read this list and assert. Now some are hidden behind others, and a driver
   asserting "the badge over tile 2,2 is drawn" off an un-flagged list would
   pass on a badge the player cannot see. The flag is the camera’s answer as
   of the last faceCamera() pass; `anchorAt()` reports the same thing per tile. */
export function drawn() {
  return live.map((v, i) => ({ x: v.x, z: v.z, reason: v.reason, mood: v.mood, score: v.score,
                          occluded: !!(_cull && _cull[i]),
                          glyph: glyphKey(v.reason), cell: cellOf[cellKey(v.mood, v.reason)] }));
}

/* The atlas allocation, published so a driver can decode the live geometry's UVs
   back to a cell index and check that the quad over a tile points at the cell
   holding THAT tile's own symbol. Two badges sharing a cell is only wrong if
   their (mood, shape) differ — which is exactly what this lets a driver assert
   rather than eyeball. */
export function cellMap() { return Object.assign({}, cellOf); }

/* ════════════════════════════════════════════════════════════════════════════
   VISIBILITY AND OPTIONS
   ════════════════════════════════════════════════════════════════════════════ */
export function show() {
  if (!mesh) return false;
  mesh.visible = true;
  /* force:true, ONCE, on the way in. The verdict module's repaint() is gated on
     ITS signature, and a player who switches the layer off and back on with a
     city that has not changed would otherwise get whatever geometry was last
     built — which is right today and would be a silent staleness bug the first
     time anything clears it. */
  try { const M = VM(); if (M && M.ready && M.ready()) M.repaint(true); } catch (e) {}
  renderLegend();
  return true;
}
export function hide() { if (!mesh) return false; mesh.visible = false; renderLegend(); return true; }
export function toggle() { return visible() ? (hide(), false) : (show(), true); }

export function setOption(k, on) {
  if (k !== 'problems' && k !== 'praise') return false;
  opts[k] = !!on;
  dataSig = '';                                   // the filter moved: the gate must not hold
  try { const M = VM(); if (M && M.ready && M.ready()) M.repaint(true); } catch (e) {}
  return true;
}

/* ════════════════════════════════════════════════════════════════════════════
   THE ATLAS PAINTER — and the legend swatches come out of the SAME function,
   so a legend cannot drift from the thing it labels.
   ════════════════════════════════════════════════════════════════════════════ */
function paintAtlas() {
  if (!ctx) return;
  ctx.clearRect(0, 0, cvs.width, cvs.height);
  for (const k of Object.keys(cellOf)) {
    const i = cellOf[k];
    const p = k.split('|');
    ctx.save();
    ctx.translate((i % MOOD.cols) * MOOD.cell.w, Math.floor(i / MOOD.cols) * MOOD.cell.h);
    paintBadge(ctx, p[0], p[1], MOOD.cell.w, MOOD.cell.h);
    ctx.restore();
  }
  if (tex) tex.needsUpdate = true;
}

/* One badge: a bubble with a tail that points at the plot, a face on the left
   and the reason's glyph on the right. THE GLYPH IS NOT DECORATION — it is the
   half that makes the frown actionable, so it gets equal room, not a corner.
   `ok` and `meh` have no defect to name and draw the face alone, centred. */
/* ⚠ THE THIRD ARGUMENT IS A GLYPH KEY, NOT A REASON ID. It used to be the id,
   resolved to a shape in here — which meant the atlas keyed cells one way and
   the art chose shapes another, and the two only agreed by luck. Every caller
   now passes the shape it means (paintAtlas splits it back out of the cell key;
   the legend passes the row's own `glyph`), so there is exactly one place the
   id → shape mapping happens: glyphKey(). */
function paintBadge(c, mood, gk, W, H) {
  const col = COL[mood] || COL.bad;
  const solo = gk === 'none';
  const pad = 8, r = 22;
  const bw = W - pad * 2, bh = H - pad * 2 - 12;      // 12px reserved for the tail

  c.save();
  c.beginPath(); roundRect(c, pad, pad, bw, bh, r);
  c.fillStyle = COL.bg; c.fill();
  c.lineWidth = 5; c.strokeStyle = col.ring; c.stroke();
  // the tail, filled first then stroked on its two SLANTED sides only —
  // stroking the top edge too would draw a line across the inside of the bubble
  c.beginPath();
  c.moveTo(W / 2 - 11, pad + bh - 1); c.lineTo(W / 2, pad + bh + 13);
  c.lineTo(W / 2 + 11, pad + bh - 1); c.closePath();
  c.fillStyle = COL.bg; c.fill();
  c.beginPath();
  c.moveTo(W / 2 - 11, pad + bh - 2); c.lineTo(W / 2, pad + bh + 13);
  c.lineTo(W / 2 + 11, pad + bh - 2);
  c.strokeStyle = col.ring; c.lineWidth = 5; c.stroke();
  c.restore();

  const cy = pad + bh / 2;
  paintFace(c, solo ? W * 0.5 : W * 0.29, cy, bh * (solo ? 0.38 : 0.33), mood, col);
  if (solo) return;
  c.save();
  c.translate(W * 0.665, cy);
  c.scale(bh * 0.34, bh * 0.34);
  c.lineWidth = 0.16; c.lineCap = 'round'; c.lineJoin = 'round';
  c.strokeStyle = col.ring; c.fillStyle = col.ring;
  (GLYPH[gk] || GLYPH.unknown)(c);
  c.restore();
}

function roundRect(c, x, y, w, h, r) {
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function paintFace(c, cx, cy, r, mood, col) {
  c.save();
  c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2);
  c.fillStyle = col.face; c.fill();
  c.lineWidth = r * 0.14; c.strokeStyle = col.ink; c.stroke();
  c.fillStyle = col.ink;
  c.beginPath(); c.arc(cx - r * 0.34, cy - r * 0.22, r * 0.13, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.arc(cx + r * 0.34, cy - r * 0.22, r * 0.13, 0, Math.PI * 2); c.fill();
  c.lineWidth = r * 0.16; c.strokeStyle = col.ink; c.lineCap = 'round';
  c.beginPath();
  if (mood === 'good') {
    // smile: the LOWER arc of a circle centred on the face
    c.arc(cx, cy + r * 0.04, r * 0.46, Math.PI * 0.18, Math.PI * 0.82);
  } else if (mood === 'warn') {
    c.moveTo(cx - r * 0.36, cy + r * 0.36); c.lineTo(cx + r * 0.36, cy + r * 0.36);
  } else {
    // frown: the UPPER arc of a circle centred BELOW the face
    c.arc(cx, cy + r * 0.76, r * 0.46, Math.PI * 1.18, Math.PI * 1.82);
  }
  c.stroke();
  c.restore();
}

/* ── THE GLYPHS ─────────────────────────────────────────────────────────────
   Each draws inside a -1..1 box with the transform already set by the caller.
   Paths only — see the header for why there is no fillText of an emoji here. */
const GLYPH = {
  drop(c) {                                     // water — no mains
    c.beginPath();
    c.moveTo(0, -1);
    c.bezierCurveTo(0.72, -0.12, 0.78, 0.30, 0.42, 0.66);
    c.bezierCurveTo(0.16, 0.92, -0.16, 0.92, -0.42, 0.66);
    c.bezierCurveTo(-0.78, 0.30, -0.72, -0.12, 0, -1);
    c.closePath(); c.fill();
  },
  bolt(c) {                                     // power — off the grid
    c.beginPath();
    c.moveTo(0.20, -1); c.lineTo(-0.62, 0.10); c.lineTo(-0.06, 0.10);
    c.lineTo(-0.24, 1); c.lineTo(0.62, -0.16); c.lineTo(0.06, -0.16);
    c.closePath(); c.fill();
  },
  road(c) {                                     // road — no access
    c.beginPath();
    c.moveTo(-0.46, -0.86); c.lineTo(0.46, -0.86);
    c.lineTo(0.86, 0.86); c.lineTo(-0.86, 0.86);
    c.closePath(); c.fill();
    c.save(); c.globalCompositeOperation = 'destination-out'; c.lineWidth = 0.15;
    c.beginPath(); c.moveTo(0, -0.62); c.lineTo(0, -0.22); c.stroke();
    c.beginPath(); c.moveTo(0, 0.06); c.lineTo(0, 0.62); c.stroke();
    c.restore();
  },
  meter(c) {                                    // roadcap — the meter is full
    c.lineWidth = 0.15;
    c.beginPath(); c.rect(-0.78, -0.44, 1.56, 0.88); c.stroke();
    c.beginPath(); c.rect(-0.66, -0.32, 1.32, 0.64); c.fill();
    c.save(); c.globalCompositeOperation = 'destination-out'; c.lineWidth = 0.14;
    c.beginPath(); c.moveTo(0.10, -0.32); c.lineTo(0.10, 0.32); c.stroke();
    c.beginPath(); c.moveTo(-0.24, -0.32); c.lineTo(-0.24, 0.32); c.stroke();
    c.restore();
  },
  lamp(c) {                                     // dark — unlit after dark
    c.beginPath();                              // the head
    c.moveTo(-0.52, -0.10); c.lineTo(-0.30, -0.72);
    c.lineTo(0.30, -0.72); c.lineTo(0.52, -0.10);
    c.closePath(); c.fill();
    c.lineWidth = 0.16;
    c.beginPath(); c.moveTo(0, -0.10); c.lineTo(0, 0.66); c.stroke();
    c.beginPath(); c.moveTo(-0.42, 0.88); c.lineTo(0.42, 0.88); c.stroke();
  },
  bowl(c) {                                     // food — not enough
    c.beginPath();
    c.arc(0, -0.02, 0.74, 0, Math.PI);
    c.closePath(); c.fill();
    c.lineWidth = 0.15;
    c.beginPath(); c.moveTo(-0.88, -0.02); c.lineTo(0.88, -0.02); c.stroke();
    c.beginPath(); c.moveTo(-0.30, -0.42); c.lineTo(-0.30, -0.82); c.stroke();
    c.beginPath(); c.moveTo(0.30, -0.42); c.lineTo(0.30, -0.82); c.stroke();
  },
  plus(c) {                                     // health — no cover
    c.beginPath();
    c.rect(-0.24, -0.82, 0.48, 1.64);
    c.rect(-0.82, -0.24, 1.64, 0.48);
    c.fill();
  },
  shield(c) {                                   // safety — unsafe
    c.beginPath();
    c.moveTo(0, -0.90);
    c.lineTo(0.74, -0.56);
    c.bezierCurveTo(0.74, 0.28, 0.40, 0.74, 0, 0.94);
    c.bezierCurveTo(-0.40, 0.74, -0.74, 0.28, -0.74, -0.56);
    c.closePath(); c.fill();
  },
  moon(c) {                                     // light — the city is short
    c.save();
    c.beginPath(); c.arc(0.06, 0, 0.82, 0, Math.PI * 2); c.fill();
    c.globalCompositeOperation = 'destination-out';
    c.beginPath(); c.arc(0.44, -0.24, 0.72, 0, Math.PI * 2); c.fill();
    c.restore();
  },
  note(c) {                                     // leisure — nothing to do
    c.lineWidth = 0.17;
    c.beginPath(); c.moveTo(-0.10, 0.56); c.lineTo(-0.10, -0.82); c.stroke();
    c.beginPath(); c.moveTo(-0.10, -0.82); c.lineTo(0.62, -0.60); c.stroke();
    c.beginPath(); c.moveTo(-0.10, -0.44); c.lineTo(0.62, -0.22); c.stroke();
    c.beginPath(); c.ellipse(-0.40, 0.58, 0.32, 0.24, -0.28, 0, Math.PI * 2); c.fill();
  },
  stone(c) {                                    // deathcare — the dead are unburied
    c.beginPath();
    c.moveTo(-0.56, 0.86); c.lineTo(-0.56, -0.24);
    c.arc(0, -0.24, 0.56, Math.PI, 0);
    c.lineTo(0.56, 0.86); c.closePath(); c.fill();
    c.save(); c.globalCompositeOperation = 'destination-out'; c.lineWidth = 0.15;
    c.beginPath(); c.moveTo(0, -0.42); c.lineTo(0, 0.36); c.stroke();
    c.beginPath(); c.moveTo(-0.30, 0.02); c.lineTo(0.30, 0.02); c.stroke();
    c.restore();
  },
  /* An id this file has no art for still draws — see the note on GLYPH_OF. A
     badge that silently vanishes is indistinguishable from a healthy tile. */
  unknown(c) {
    c.lineWidth = 0.22; c.lineCap = 'round';
    c.beginPath(); c.moveTo(0, -0.78); c.lineTo(0, 0.24); c.stroke();
    c.beginPath(); c.arc(0, 0.72, 0.15, 0, Math.PI * 2); c.fill();
  },
  none() {},
};

/* ════════════════════════════════════════════════════════════════════════════
   THE LEGEND — the toggle, and a row per glyph. The swatch is painted by the
   SAME paintBadge() the world uses, and the words come from the verdict
   module's REASONS. A legend drawn a second way, or worded from a copy, is a
   legend that can be wrong about the thing it labels.
   ════════════════════════════════════════════════════════════════════════════ */
function ensureLegendEl() {
  if (legendEl) return legendEl;
  if (typeof document === 'undefined') return null;
  const el = document.createElement('div');
  el.id = 'pmlegend';
  el.style.cssText = [
    'position:fixed', 'right:12px', 'bottom:96px', 'z-index:60', 'width:274px',
    'max-height:62vh', 'overflow:auto', 'display:none',
    'background:rgba(12,16,22,.94)', 'border:1px solid rgba(255,255,255,.14)',
    'border-radius:12px', 'padding:10px 12px', 'color:#dfe6ef',
    'font:12px/1.35 system-ui,-apple-system,Segoe UI,sans-serif',
    'box-shadow:0 10px 28px rgba(0,0,0,.45)', 'pointer-events:auto',
  ].join(';');
  document.body.appendChild(el);
  el.addEventListener('change', (ev) => {
    const t = ev.target;
    if (!t || t.tagName !== 'INPUT') return;
    setOption(t.dataset.pm, t.checked);
  });
  el.addEventListener('click', (ev) => {
    if (ev.target.closest && ev.target.closest('[data-pmclose]')) hide();
  });
  legendEl = el;
  return el;
}

/* One row per reason the verdict module can return, counted by what is on
   screen. Keyed on the BARE id — `need:health` and a (hypothetical) local health
   reason are the same glyph and the same sentence, and two rows for one symbol
   is a legend that has to be read twice. */
export function legend() {
  const used = {};
  for (const v of live) { const b = baseId(v.reason); used[b] = (used[b] || 0) + 1; }
  const ids = Object.keys(GLYPH_OF);
  for (const id of Object.keys(used)) if (ids.indexOf(id) < 0) ids.push(id);
  return ids.map((id) => {
    const meta = reasonMeta(id) || {};
    return { id, glyph: glyphKey(id),
             mood: id === 'ok' ? 'good' : id === 'meh' ? 'warn' : 'bad',
             label: meta.label || id, fix: meta.fix || '',
             drawn: used[id] || 0 };
  });
}

function renderLegend() {
  const el = ensureLegendEl();
  if (!el) return;
  el.style.display = visible() ? 'block' : 'none';
  if (!visible()) return;
  const rows = legend().map((r) => {
    const on = r.drawn > 0;
    return '<div style="display:flex;gap:8px;align-items:flex-start;margin:7px 0;opacity:' +
      (on ? 1 : 0.42) + '">' +
      '<canvas data-pmsw="' + r.id + '" data-pmglyph="' + r.glyph + '" data-pmmood="' + r.mood + '" width="' + MOOD.cell.w +
      '" height="' + MOOD.cell.h + '" style="width:68px;height:40px;flex:0 0 auto"></canvas>' +
      '<div><b style="color:#fff">' + esc(r.label) + (on ? ' <span style="color:#8ab4ff">×' + r.drawn + '</span>' : '') +
      '</b>' + (r.fix ? '<br><span style="opacity:.8">' + esc(r.fix) + '</span>' : '') + '</div></div>';
  }).join('');

  el.innerHTML =
    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">' +
      '<b style="font-size:13px;color:#fff">🙂 Plot mood</b><span style="flex:1"></span>' +
      '<button data-pmclose="1" style="background:none;border:0;color:#9fb0c4;cursor:pointer;font-size:15px">✕</button></div>' +
    '<label style="display:block;margin:2px 0"><input type="checkbox" data-pm="problems"' +
      (opts.problems ? ' checked' : '') + '> Problems</label>' +
    '<label style="display:block;margin:2px 0 6px"><input type="checkbox" data-pm="praise"' +
      (opts.praise ? ' checked' : '') + '> Praise (content plots)</label>' +
    '<div style="opacity:.72;margin-bottom:4px">' + live.length + ' badge' + (live.length === 1 ? '' : 's') +
      ' drawn' + (overflowN ? ', ' + overflowN + ' more withheld (worst ' + MOOD.max + ' shown)' : '') +
      '<br>verdict from: ' + esc(srcName) +
      (srcName === 'none' ? ' — /src/plotmood/index.js is not loaded, so nothing can be judged' : '') +
      '</div>' + rows;

  for (const cv of el.querySelectorAll('canvas[data-pmsw]')) {
    const c2 = cv.getContext('2d'); if (!c2) continue;
    c2.clearRect(0, 0, cv.width, cv.height);
    paintBadge(c2, cv.dataset.pmmood, cv.dataset.pmglyph, MOOD.cell.w, MOOD.cell.h);
  }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ════════════════════════════════════════════════════════════════════════════
   COST — reported, never asserted. The claim is "one mesh, one texture, one
   draw call whatever is on"; this is how a driver checks it against
   renderer.info rather than taking the header's word for it.
   ════════════════════════════════════════════════════════════════════════════ */
export function cost() {
  return {
    meshes: mesh ? 1 : 0, textures: tex ? 1 : 0, materials: mat ? 1 : 0,
    /* ⚠ quads/triangles are what REACHES THE DRAW CALL, not what was flagged.
       The declutter hides badges behind other badges at the current camera, so
       these two used to over-report the moment more than one plot complained —
       and this block exists precisely so a driver can check the cost claim
       against renderer.info instead of believing the header. `icons` stays the
       flagged count and `culled` is the difference, spelled out. */
    icons: live.length, culled: _culledN,
    quads: _drawN, triangles: _drawN * 2,
    atlasPx: cvs ? cvs.width * cvs.height : 0,
    cells: Object.keys(cellOf).length, cellCapacity: MOOD.cols * MOOD.rows,
    /* The buffers never grow: allocated at mount for MOOD.max and only ever
       partly drawn. A driver comparing two paints should see this constant. */
    vertexCapacity: MOOD.max * 4,
  };
}

/* ════════════════════════════════════════════════════════════════════════════
   🙂 THE PLACEMENT REACTION — the CS2 half the badge layer could not deliver.
   ----------------------------------------------------------------------------
   THE MEASURED GAP THIS CLOSES. The badge mesh above is created with
   `mesh.visible = false` (see mount()), and it only becomes visible when the
   player presses F or clicks '🙂 Plot mood (F)' on node-city's utility card.
   node-city's placement seam is then gated on `MythicPlotIcons.visible()`. So
   out of the box — layer OFF, which is how every player starts — placing a
   building, a road, a pipe or a pole produced NO FACE AT ALL, which is exactly
   the one thing the brief asks for ("when a player places a building or a road,
   show a happy or frowning face"). This is that reaction, and it fires whether
   or not the layer is toggled on. Toggling the layer on is still how you find
   out WHICH plot; this says how the city took it.

   🔴 IT INVENTS NO VERDICT, NO SCORE AND NO SAVE FIELD. Every number below is
      read off `MythicPlotMood.all()` — the same rows the badges draw — and the
      two audiences are the module's OWN per-tile `kind`, which index.js already
      tags 'home' vs 'biz' and already judges on two different need sets (a home
      on food/health/safety/light/leisure/deathcare, a business on the working
      set). Grouping rows that already exist is presentation. A seventh number
      would be a second mood model, and this codebase has twice had to tear one
      of those out of a shipped panel.
   🔴 THE FACE PER AUDIENCE IS A COUNT, NOT AN AVERAGE. Averaging the scores
      would mint a figure nothing else in the game holds and nobody could trace.
      The group wears the face the most plots in it wear, ties going to the
      WORSE face — half a district uneasy is not a contented district — and the
      counts that produced it are printed beside it, so the face is always
      checkable against the row that decided it.

   ⚠ THE BEFORE-PICTURE IS TAKEN BEFORE THE TILE EXISTS. `react()` is called by
     node-city's tryPlace BEFORE `game.tiles[pk] = t` and therefore before
     `invalidate('place')`; the delta is a real before/after across the
     placement rather than a diff of two post-placement reads.
   ⚠ ONE GESTURE, ONE REACTION. A road drag lays twenty tiles through the same
     seam. Only the FIRST call of a gesture photographs the board; the rest just
     extend the window (capped by `maxWaitMs`, so a long unbroken drag still
     reports). That keeps the hot path off `all()`, which recomputes the whole
     table when a placement has dirtied it — the same discipline index.js's
     `invalidate()` is written to.
   ⚠ WATER AND POWER LAG ONE TICK, BY DESIGN UPSTREAM. Both are readers over a
     state that node-city's economyTick pre-passes solve once a second, so a
     mains or a blackout shows up in the NEXT reaction, not this one. The road,
     light and coverage terms are immediate. That is a property of the model
     this file is deliberately not working around — see .gauntlet/drive-moodreact.
   ⚠ pointer-events:none, and it matters: this appears over the board mid-drag,
     and a transient panel that can swallow the next click of a road drag would
     be a bug that only shows up under the player's hand.

   🎨 THE CHROME IS THE RUIN LEDGER'S, NOT THE HOST'S TOKENS. node-city's
      `--panel-solid` / `--edge` are violet-tinted today (#1a1626 / #2e2740) and
      fail the theme pass's chrome test (blue channel over red). The values here
      are the bar's own — near-black warm ground, one hairline gold frame, 3px
      radius, Cinzel small caps for the heading, Crimson Text for the prose.
   ════════════════════════════════════════════════════════════════════════════ */
export const REACT = {
  /* One gesture, one reaction: how long after the last commit the reaction
     waits before it reports, and the hard cap that makes an unbroken drag
     report anyway rather than being deferred forever. */
  coalesceMs: 150,
  maxWaitMs: 900,
  holdMs: 3600,          // how long the chip stays up
  fadeMs: 280,           // must match the CSS transition below
  /* 📐 THE BOTTOM-LEFT STACK. floorPx is where the chip sits when the corner is
     EMPTY; gapPx is the breathing room it leaves above whatever it has to stack
     on. Both are read by reflowReact(), which measures the live tenants of that
     corner instead of assuming it owns it — see the comment there. */
  floorPx: 104,
  gapPx: 10,
  reflowMs: 220,         // re-measure cadence while the chip is up
};

let rEl = null, rStyleEl = null;
let rTimer = null, rHoldTimer = null, rFadeTimer = null, rReflowTimer = null;
let rBefore = null, rArmedAt = 0, rSeen = 0, rWhy = '', rAt = null, rLast = null;
const rStats = { armed: 0, coalesced: 0, pulses: 0, skipped: 0 };

/* The board, grouped by the verdict module's own `kind`. Nothing is derived
   here that index.js has not already decided: which tiles are judged, whether
   each is a home or a business, and which of the three faces it wears. */
function census() {
  const M = VM();
  if (!M || typeof M.all !== 'function') return null;
  if (typeof M.ready === 'function' && !M.ready()) return null;
  let rows = null;
  try { rows = M.all(); } catch (e) { return null; }
  if (!rows) return null;
  const empty = () => ({ n: 0, ok: 0, meh: 0, bad: 0 });
  const out = { home: empty(), biz: empty() };
  for (const v of rows) {
    if (!v) continue;
    const g = v.kind === 'home' ? out.home : out.biz;
    g.n++;
    if (v.face === 'ok') g.ok++; else if (v.face === 'meh') g.meh++; else g.bad++;
  }
  return out;
}

/* Plurality, ties to the worse face. See the header: this is a count, never an
   average, so the number printed beside the face is the one that chose it. */
function groupFace(g) {
  if (!g || !g.n) return null;
  if (g.bad >= g.meh && g.bad >= g.ok) return 'bad';
  if (g.meh >= g.ok) return 'meh';
  return 'ok';
}

/* The emoji for a face id. PREFERRED SOURCE IS THE HOST: node-city hands over
   `faceGlyph` at mount, which is its own shipped `pmGlyph(pmFace(f))` pair, so
   the reaction and the dossier card can never show a player two different
   smileys for one state. The literals are a fallback for a host that predates
   the hand-over, and they are the same three characters. */
function faceGlyph(face) {
  try { if (host && typeof host.faceGlyph === 'function') { const g = host.faceGlyph(face); if (g) return g; } } catch (e) {}
  return face === 'bad' ? '😟' : face === 'meh' ? '😐' : '😀';
}

/* How the group MOVED across the placement. Reported off the buckets rather
   than off a summed score, and worded as what changed rather than as a claim
   about cause: a plot that soured for its own reasons in the same 150 ms is
   still a plot that soured, and pretending otherwise would need a causal model
   nothing here has. A newly placed home also lands in a bucket — that is a real
   change to the group, not a fiction. */
function movement(b, a) {
  if (!b || !a) return { dir: 'flat', txt: '' };
  const dBad = a.bad - b.bad, dOk = a.ok - b.ok;
  if (dBad > 0) return { dir: 'down', txt: '▼ ' + dBad + ' unhappy' };
  if (dOk > 0) return { dir: 'up', txt: '▲ ' + dOk + ' content' };
  if (dBad < 0) return { dir: 'up', txt: '▲ ' + (-dBad) + ' recovered' };
  if (dOk < 0) return { dir: 'down', txt: '▼ ' + (-dOk) + ' content' };
  return { dir: 'flat', txt: '— steady' };
}

function audience(kind, before, after) {
  const a = after[kind], b = before ? before[kind] : null;
  const face = groupFace(a);
  const parts = [];
  if (a.ok) parts.push(a.ok + ' content');
  if (a.meh) parts.push(a.meh + ' getting by');
  if (a.bad) parts.push(a.bad + ' unhappy');
  return {
    kind, n: a.n, ok: a.ok, meh: a.meh, bad: a.bad,
    face, glyph: face ? faceGlyph(face) : '·',
    counts: a.n ? parts.join(' · ') : 'none yet',
    move: movement(b, a),
  };
}

/* The one line about the THING THE PLAYER JUST PUT DOWN, from the other reader
   of the same city — MythicPlotVerdict. It is optional and guarded: a 404 on
   verdict.js costs this line and nothing else, and a road answers `ok:false`
   with its own sentence ("a road has no mood"), which is worth printing as the
   world's voice rather than swallowing. */
function placedLine(at) {
  if (!at || at.x == null) return null;
  let V = null;
  try { V = (typeof window !== 'undefined') ? window.MythicPlotVerdict : null; } catch (e) { V = null; }
  if (!V || typeof V.at !== 'function') return null;
  let v = null;
  try { v = V.at(at.x, at.z); } catch (e) { return null; }
  if (!v) return null;
  if (!v.ok) return { ok: false, text: v.why || '' };
  if (v.reason === 'ok') return { ok: true, text: (v.reasonIco || '🙂') + ' ' + (v.name || '') + ' — nothing wrong here.' };
  return { ok: true, reason: v.reason,
           text: (v.reasonIco || '') + ' ' + (v.reasonLabel || v.reason) + (v.reasonFix ? ' — ' + v.reasonFix : '') };
}

function ensureReactEl() {
  if (rEl) return rEl;
  if (typeof document === 'undefined') return null;
  if (!rStyleEl) {
    rStyleEl = document.createElement('style');
    rStyleEl.id = 'pmreact-css';
    rStyleEl.textContent = [
      /* z-index sits UNDER #toasts (9850): a toast explains the action, this
         explains the city, and the toast is the one that must never be hidden.

         🍞 WHICH IS EXACTLY WHY THE CHIP LIVES IN THE LEFT RAIL AND NOT THE
         CENTRE. It used to be `left:50%;bottom:150px` — the same column #toasts
         occupies (bottom-centred, bottom:104px, z-index 9850). MEASURED at
         1400×860: with 2 toasts up the stack covered 430×26px of the chip
         (18.1%); with 4 — routine, because one placement commonly fires a cost,
         a refusal and an achievement toast in the same beat — it covered
         262×62px (48.8%), and the halves it ate were the BUSINESSES row and the
         .pmr-foot "why" line. The bar's §6b asks for two audiences reported
         separately; under a normal toast burst only one of them was legible.
         Raising z-index above 9850 is the wrong fix — see the line above; the
         chip must lose that argument, not win it. So it moves SIDEWAYS, to the
         bottom-left corner, which is the same corner node-city already parks
         the toast in when the dossier is open (`body.ins-open #toasts`) and is
         empty in every other mode: #leftcol stops at innerHeight−140.
         THE MAX-WIDTH IS THE ARITHMETIC THAT KEEPS IT OUT OF THE TOAST COLUMN,
         and it is derived from the toast's own cap, not guessed: `.toast` is
         `max-width:min(480px,92vw)` and the stack is centred, so a full-width
         toast's left edge is 50vw−240. A chip starting at x=12 must therefore
         stop by 50vw−250 to keep a 10px gap → `calc(50vw - 262px)`. Below
         ~996px viewport that cap falls under `min-width` and min-width wins, so
         the gap closes gradually rather than the chip collapsing; node-city's
         narrowest breakpoint is 820 and the chip stays legible there.
         ⚠ bottom:104px is NOT 56: #buildbar is 78px tall at bottom:12 (see the
         Build bar block in node-city), so its top edge is 90px up and a chip at
         56 sat on it. 104 clears it by 14px and also clears the docked toast in
         `body.ins-open` — see the note further down.
         🔴 bottom:104px IS ONLY THE FLOOR — reflowReact() OWNS THE REAL VALUE.
         The sideways move above was validated against #leftcol, and #leftcol is
         `display:none` (the permanent STASH, node-city index.html ~1803): its
         rect is 0×0 at every viewport, so it can never intersect anything and
         the "accepted cost of a band over the left rail" was a cost that cannot
         occur — while the corner's REAL first-run tenant went unmeasured.
         MEASURED at 1400×860 on a first entry: #npw-intro (the "HIGHWAY
         CONNECTION / Starter Power Pole — FREE" card, position:fixed left:14px
         bottom:96px z-index:60, /src/power/welcome.js) is 340×144 in this exact
         corner, and a chip at [12, 612.5, 430×143.5] covered 340×144 of it —
         100%: its body text and BOTH buttons ("Build Power Line", "Later"), for
         the full 3.6s hold. The chip is z-index 9840 vs 60 so the chip wins, and
         pointer-events:none left those buttons clickable-but-unreadable — the
         same bug node-city's own toast comment (index.html ~838-845) records
         having already fixed once.
         And the horizontal arithmetic below stops holding when the viewport is
         narrow: below ~996px `min-width:236px` beats `max-width:calc(50vw −
         262px)`, so at 820×720 (node-city's own narrowest breakpoint) the chip
         re-entered the toast column — measured ∩ .toast = 43×46, clipping the
         RESIDENTS delta and covering the BUSINESSES one, the exact degradation
         the sideways move was made to eliminate.
         So the position is MEASURED, not asserted: reflowReact() stacks the chip
         above whatever is actually live in that corner, and the cap below is
         kept as the cheap first line of defence that means it usually has
         nothing to stack on. .gauntlet/drive-moodplacereact.mjs asserts the
         #pmreact ∩ #toasts, ∩ #buildbar and ∩ #npw-intro intersections are all
         0×0 with four toasts up, at 1400×860, 1024×640 and 820×720, in both the
         plain and dossier states. */
      '#pmreact{position:fixed;left:12px;bottom:104px;z-index:9840;',
      'pointer-events:none;min-width:236px;max-width:min(430px,calc(100vw - 24px),calc(50vw - 262px));',
      'background:#141210;border:1px solid rgba(198,160,74,.34);border-radius:3px;',
      'box-shadow:0 10px 30px rgba(0,0,0,.55);padding:8px 12px 9px;color:#e8dfc9;',
      "font:13px/1.38 'Crimson Text',Georgia,'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',serif;",
      /* `bottom` transitions too: reflowReact() can move the chip mid-hold when a
         toast arrives or the first-run card is dismissed, and a jump reads as a
         glitch where a 160ms slide reads as the chip making room. */
      'opacity:0;transition:opacity ' + (REACT.fadeMs / 1000) + 's ease-out, bottom .16s ease-out;display:none}',
      '#pmreact.on{opacity:1}',
      "#pmreact .pmr-hd{font-family:'Cinzel',Georgia,serif;font-size:10px;letter-spacing:.14em;",
      'text-transform:uppercase;color:#f0d98a;border-bottom:1px solid rgba(198,160,74,.16);',
      'padding-bottom:5px;margin-bottom:6px}',
      '#pmreact .pmr-hd i{font-style:normal;color:#9d907a}',
      '#pmreact .pmr-row{display:flex;align-items:center;gap:9px;margin:4px 0}',
      '#pmreact .pmr-face{font-size:19px;line-height:1;width:22px;text-align:center}',
      "#pmreact .pmr-who{font-family:'Cinzel',Georgia,serif;font-size:9px;letter-spacing:.12em;",
      'text-transform:uppercase;color:#9d907a;width:74px;flex:0 0 auto}',
      '#pmreact .pmr-cnt{flex:1;font-size:12.5px;font-variant-numeric:tabular-nums}',
      '#pmreact .pmr-d{font-size:11px;font-variant-numeric:tabular-nums;flex:0 0 auto}',
      '#pmreact .pmr-d.up{color:#6fbf85}#pmreact .pmr-d.down{color:#e0703f}#pmreact .pmr-d.flat{color:#9d907a}',
      '#pmreact .pmr-foot{margin-top:6px;padding-top:5px;border-top:1px solid rgba(198,160,74,.16);',
      'font-style:italic;color:#d9cbaa;font-size:12px}',
      /* The dossier owns the middle of the screen — node-city moves #toasts out
         of the way with `body.ins-open`, and this used to follow it with an
         override to left:12px/bottom:56px for the same reason. THAT OVERRIDE IS
         NOW THE DEFAULT (above), so this class needs no position rule at all —
         and it must not get one. MEASURED at 1400×860 with the dossier open:
         `body.ins-open #toasts` docks at left:12px/bottom:10px in this very
         corner and a single toast is 32px tall, so a chip at bottom:78 lost
         272×14px to it. bottom:104 clears a three-line toast (~68px) there.
         The rule is the same in both modes: the chip yields to the toast.
         ⚠ That clearance is now MEASURED rather than trusted to the constant —
         a docked toast is just another live tenant of this corner as far as
         reflowReact() is concerned, and a four-high dock is taller than 104. */
    ].join('');
    (document.head || document.documentElement).appendChild(rStyleEl);
  }
  rEl = document.createElement('div');
  rEl.id = 'pmreact';
  document.body.appendChild(rEl);
  return rEl;
}

/* 📐 STACK THE CHIP ABOVE WHATEVER IS ACTUALLY IN THE CORNER.
   The chip does NOT own the bottom-left corner and must never assume it does —
   that assumption is what put it over 100% of the first-run power card (see the
   CSS comment above). This measures the live rects of the corner's real tenants
   at render time and again on a slow interval while the chip is up, and lifts
   the chip to sit `gapPx` above the tallest one whose COLUMN it shares.

   Why a list and not a special case for #npw-intro: the corner has had three
   different tenants already (#toasts docked by `body.ins-open`, #buildbar in the
   gutter, the power card on first entry) and the next one will not think to tell
   this module either. Anything unknown that overlaps the chip's column simply
   gets cleared, and a selector that matches nothing costs a null.

   Why an interval and not one measurement: toasts arrive DURING the 3.6s hold —
   that is the whole reason the chip lost this argument in the first place — and
   the power card is dismissed during it too, at which point the chip should drop
   back down. ~220ms is four reads a second on at most three elements, only while
   the chip is visible; it is not a render hook and does not touch RAF, which the
   gauntlet's browser pane fires at ~0.56 Hz (CLAUDE.md).

   The overlap test is horizontal only. A tenant in a different column cannot hide
   the chip no matter how tall it is, and lifting for one would push the chip off
   the action for nothing. */
const R_TENANTS = ['#npw-intro', '#toasts', '#buildbar', '#ctrlhint'];

function reflowReact() {
  const el = rEl;
  if (!el || typeof document === 'undefined') return;
  if (el.style.display === 'none') return;
  const vh = (typeof window !== 'undefined' && window.innerHeight) || 0;
  if (!vh) return;
  const me = el.getBoundingClientRect();
  if (!me.width || !me.height) return;
  let want = REACT.floorPx;
  for (const sel of R_TENANTS) {
    let o = null;
    try { o = document.querySelector(sel); } catch (e) { o = null; }
    if (!o || o === el) continue;
    const b = o.getBoundingClientRect();
    if (!b.width || !b.height) continue;                       // hidden / empty stack
    /* #ctrlhint keeps its box and fades with opacity, so a rect is not proof it
       can be read. Only a tenant the player can actually SEE gets to move the
       chip — otherwise the hint would push it up permanently for nothing. */
    let cs = null;
    try { cs = getComputedStyle(o); } catch (e) { cs = null; }
    if (cs && (cs.visibility === 'hidden' || +cs.opacity < 0.05)) continue;
    if (b.left >= me.right + REACT.gapPx) continue;             // different column
    if (b.right <= me.left - REACT.gapPx) continue;
    want = Math.max(want, (vh - b.bottom) + b.height + REACT.gapPx);
  }
  /* Staying ON SCREEN outranks staying clear: a chip pushed past the top edge
     reports nothing at all, which is worse than a chip that overlaps. The driver
     asserts both, so a viewport where they genuinely cannot both hold fails
     loudly rather than silently scrolling the chip out of the world. */
  const ceil = Math.max(8, vh - me.height - 8);
  if (want > ceil) want = ceil;
  const px = Math.round(want) + 'px';
  if (el.style.bottom !== px) el.style.bottom = px;
}

function startReflow() {
  if (rReflowTimer || typeof setInterval !== 'function') return;
  rReflowTimer = setInterval(() => { try { reflowReact(); } catch (e) { stopReflow(); } }, REACT.reflowMs);
}
function stopReflow() {
  if (rReflowTimer) { clearInterval(rReflowTimer); rReflowTimer = null; }
}

function renderReaction(r) {
  const el = ensureReactEl();
  if (!el) return false;
  const row = (a, label, icon) =>
    '<div class="pmr-row"><span class="pmr-face">' + esc(a.glyph) + '</span>' +
    '<span class="pmr-who">' + esc(icon) + ' ' + esc(label) + '</span>' +
    '<span class="pmr-cnt">' + esc(a.counts) + '</span>' +
    '<span class="pmr-d ' + a.move.dir + '">' + esc(a.move.txt) + '</span></div>';
  el.innerHTML =
    '<div class="pmr-hd">The block reacts' +
      (r.at && r.at.name ? ' <i>· ' + esc(r.at.name) + (r.n > 1 ? ' ×' + r.n : '') + '</i>' : '') +
    '</div>' +
    row(r.home, 'Residents', '🏠') + row(r.biz, 'Businesses', '🏢') +
    (r.placed && r.placed.text ? '<div class="pmr-foot">' + esc(r.placed.text) + '</div>' : '');
  el.style.display = 'block';
  /* Position BEFORE the fade-in, in the same task as the display flip: the rect
     is live the moment display leaves `none`, so the chip is never painted once
     at the wrong height and then corrected. */
  try { reflowReact(); } catch (e) { /* a layout read must never take a placement down */ }
  startReflow();
  if (rHoldTimer) { clearTimeout(rHoldTimer); rHoldTimer = null; }
  if (rFadeTimer) { clearTimeout(rFadeTimer); rFadeTimer = null; }
  /* Two frames of grace before `.on`, or the browser coalesces the display flip
     and the opacity flip into one style pass and the transition never runs —
     the chip would pop rather than fade. Cheap, and it is NOT a render hook:
     nothing here needs requestAnimationFrame, which the gauntlet's browser pane
     fires at ~0.56 Hz (CLAUDE.md). */
  setTimeout(() => { if (rEl) rEl.classList.add('on'); }, 16);
  rHoldTimer = setTimeout(() => {
    if (rEl) rEl.classList.remove('on');
    rFadeTimer = setTimeout(() => { if (rEl) rEl.style.display = 'none'; stopReflow(); }, REACT.fadeMs);
  }, REACT.holdMs);
  return true;
}

function pulse() {
  rTimer = null;
  const after = census();
  const before = rBefore;
  rBefore = null;
  if (!after) { rStats.skipped++; return false; }
  if (!after.home.n && !after.biz.n) { rStats.skipped++; return false; }  // nobody to have an opinion
  const r = {
    why: rWhy, n: rSeen, at: rAt,
    home: audience('home', before, after),
    biz: audience('biz', before, after),
    placed: placedLine(rAt),
    before, after, t: Date.now(),
  };
  rLast = r;
  rStats.pulses++;
  try { renderReaction(r); } catch (e) { /* a render must never take a placement down */ }
  return true;
}

/* ⚡ THE HOT PATH, and it is called from inside a road drag. It photographs the
   board ONCE per gesture and otherwise only moves a timer. */
export function react(why, at) {
  try {
    const M = VM();
    if (!M || typeof M.all !== 'function') return false;
    rStats.armed++;
    const now = Date.now();
    if (rTimer == null) {
      rBefore = census();
      rArmedAt = now; rSeen = 0; rWhy = String(why || 'place'); rAt = at || null;
    } else {
      rStats.coalesced++;
      clearTimeout(rTimer); rTimer = null;
      if (at) rAt = at;
    }
    rSeen++;
    const wait = Math.max(0, Math.min(REACT.coalesceMs, rArmedAt + REACT.maxWaitMs - now));
    rTimer = setTimeout(pulse, wait);
    return true;
  } catch (e) { return false; }
}

/* The reads a driver and the console use. `reaction()` is the last reported
   object — the same one the chip was rendered from, so a test asserts on what
   was shown rather than on a re-derivation of it. */
export function reaction() { return rLast; }
export function reactCensus() { return census(); }
export function reactStats() { return { ...rStats, pending: rTimer != null, shown: !!(rEl && rEl.classList.contains('on')) }; }
export function reactHide() {
  if (rHoldTimer) { clearTimeout(rHoldTimer); rHoldTimer = null; }
  if (rFadeTimer) { clearTimeout(rFadeTimer); rFadeTimer = null; }
  stopReflow();
  if (!rEl) return false;
  rEl.classList.remove('on'); rEl.style.display = 'none';
  return true;
}

try {
  if (typeof window !== 'undefined') {
    window.MythicPlotIcons = {
      mount, unmount, mounted, paint, sync, show, hide, toggle, visible,
      setOption, options, legend, cost, source, overflow, culled, onScreen,
      anchorAt, drawn, cellMap,
      /* 🙂 The placement reaction. Deliberately NOT gated on visible(): it is
         the half of the brief the toggled layer cannot deliver. */
      react, reaction, reactCensus, reactStats, reactHide, reactTuning: REACT,
      tuning: MOOD, mesh: () => mesh, atlasCanvas: () => cvs,
    };
  }
} catch (e) {}
