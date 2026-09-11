/* ══════════════════════════════════════════════════════════════════════════
   👻 THE RUN PREVIEW — the ghost of the road before it is paid for.

   Two surfaces, and they answer two different questions:
     · the FILM on the ground — "where exactly will this go, and which tiles
       will be refused"; one colour per cell, so a blocked tile is visible
       BEFORE the money moves rather than in a toast afterwards;
     · the CHIP at the cursor — "what is this going to cost me", live, updated
       on every pointermove. A bulk action that quietly empties the treasury is
       the one thing a player cannot undo, so the number leads.

   🔺 GEOMETRY: ONE MESH, ONE MATERIAL, ONE DRAW CALL — the same decision
   /src/zoning/overlay.js's header argues at length, and this file is that
   pattern applied to a path instead of a board. The obvious implementation is
   a quad per cell of the run; on a 40-tile drag that is 40 objects created and
   destroyed on every pointermove. Instead one non-indexed BufferGeometry has
   its position and colour buffers rewritten in place, exactly as the zoning
   film does — the buffers are allocated once at MAX_CELLS and the draw range
   is what moves.

   ⚠ WHY NOT MythicZoning.preview() ITSELF. That is the right primitive for a
     marquee and it is deliberately ONE scaled unit quad: a rectangle of any
     size, moved and scaled, allocating nothing. A road run is not a rectangle —
     an L-bend and a freehand trail are both paths — so a single quad can only
     draw the run's bounding box, which is a lie on every drag that turns a
     corner. Same construction, same material settings, same y-stack reasoning;
     a path's worth of quads instead of one.

   ⚠ THE Y STACK. /src/zoning/overlay.js's header did the measuring: the tile
     shade sits at 0, gridHelper at .0145, the road carriageway at RD_Y .016,
     hover at .02, and a HOUSE brings its own apron (.016), path (.019) and
     planting beds (.022) with it. The zoning film clears all of that at .050
     and its own preview quad sits at .056. This film goes at .060 — above
     zoning's preview so the two can never z-fight if a driver leaves both on,
     and still far below anything that is a building, so the ghost is correctly
     occluded BY the city it is being drawn into.

   ⚠ COLOURS ARE LINEAR, NOT sRGB. A vertex colour handed to three is linear.
     /src/zoning/overlay.js records the cost of forgetting this: the sRGB amber
     anyone would type renders as a pale beige that reads as "slightly lighter
     kerb" rather than as a warning. These are linear values whose OUTPUT is the
     colour named in the comment.
   ══════════════════════════════════════════════════════════════════════════ */

const FILM_Y = 0.060;
const INSET = 0.06;           // gap between a cell's ghost and its neighbour's
const MAX_CELLS = 256;        // buffer ceiling; the run planner clamps below it

/* ok      → a road will be laid here            (linear ≈ #5fe08a mint)
   blocked → something already stands on this tile (linear ≈ #ff5f4a, the same
             refusal red /src/zoning/ui.js uses for its erase preview)
   over    → inside the run but past the maintenance cap; it will be refused for
             a reason the player can FIX, so it is amber, not red (linear ≈ #ffa63d) */
const COL = {
  ok:      { r: 0.11, g: 0.72, b: 0.26 },
  blocked: { r: 1.00, g: 0.10, b: 0.06 },
  over:    { r: 1.00, g: 0.36, b: 0.03 },
};

export function makeRunPreview(ctx) {
  const THREE = ctx.THREE, scene = ctx.scene, HALF = ctx.HALF;
  const doc = (typeof document !== 'undefined') ? document : null;

  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(MAX_CELLS * 6 * 3);
  const col = new Float32Array(MAX_CELLS * 6 * 3);
  const nrm = new Float32Array(MAX_CELLS * 6 * 3);
  /* ⚠ NORMALS ARE NOT OPTIONAL even for MeshBasicMaterial — node-city runs
     three's WebGPU renderer and its node-material system warns
     "TSL.NormalNode: Vertex attribute normal not found" once per geometry
     without them. The film is flat and faces up, so one constant vector per
     vertex is the whole answer, and it never changes: fill it once. */
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setDrawRange(0, 0);

  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.46,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 8;         // above the zoning film (6) and its preview (7)
  mesh.frustumCulled = false;   // the buffer is rewritten, the bounds lie
  mesh.visible = false;
  mesh.name = 'netdrag-run';
  scene.add(mesh);

  let cells = 0;

  /* ── the cursor chip ──────────────────────────────────────────────────
     Created here rather than in node-city so the whole feature is one import:
     if this module 404s there is no orphan div in the page. */
  let chip = null;
  if (doc && doc.body) {
    if (!doc.getElementById('ndg-chip-style')) {
      const st = doc.createElement('style');
      st.id = 'ndg-chip-style';
      st.textContent = `
#ndg-chip{position:fixed;z-index:9;pointer-events:none;display:none;
  transform:translate(14px,16px);background:rgba(12,9,20,.93);
  border:1px solid var(--edge,rgba(212,175,55,.45));border-radius:9px;
  padding:5px 9px;color:var(--bone,#e9e0cc);font-size:12px;line-height:1.35;
  box-shadow:0 10px 26px rgba(0,0,0,.6);white-space:nowrap;
  font-variant-numeric:tabular-nums}
#ndg-chip.on{display:block}
#ndg-chip b{color:#ffd98a}
#ndg-chip i{font-style:normal;color:#ff9a72;display:block;font-size:11px}`;
      doc.head.appendChild(st);
    }
    chip = doc.createElement('div');
    chip.id = 'ndg-chip';
    doc.body.appendChild(chip);
  }

  function push(i, wx, wz, c) {
    const a = wx + INSET, b = wx + 1 - INSET, u = wz + INSET, v = wz + 1 - INSET;
    const p = i * 18;
    const V = [a, FILM_Y, u, b, FILM_Y, u, b, FILM_Y, v, a, FILM_Y, u, b, FILM_Y, v, a, FILM_Y, v];
    for (let j = 0; j < 18; j++) pos[p + j] = V[j];
    for (let j = 0; j < 6; j++) { col[p + j * 3] = c.r; col[p + j * 3 + 1] = c.g; col[p + j * 3 + 2] = c.b; }
  }

  /* run: [{x, z, state}] in tile coords. Empty or null hides the film. */
  function show(run) {
    const n = Math.min((run && run.length) || 0, MAX_CELLS);
    for (let i = 0; i < n; i++) {
      const c = run[i];
      push(i, c.x - HALF, c.z - HALF, COL[c.state] || COL.ok);
    }
    cells = n;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.setDrawRange(0, n * 6);
    mesh.visible = n > 0;
    return n;
  }

  /* text: the headline (tiles + price). warn: the one line that says why part
     of the run will be refused, or null. ev: the pointer event, so the chip
     follows the cursor the way a CS-style tool's readout does. */
  function label(text, warn, ev) {
    if (!chip) return;
    if (!text) { chip.className = ''; chip.textContent = ''; return; }
    chip.innerHTML = '<b>' + text + '</b>' + (warn ? '<i>' + warn + '</i>' : '');
    if (ev) { chip.style.left = ev.clientX + 'px'; chip.style.top = ev.clientY + 'px'; }
    chip.className = 'on';
  }

  function hide() {
    cells = 0;
    geo.setDrawRange(0, 0);
    mesh.visible = false;
    label(null, null, null);
  }

  function dispose() {
    try { scene.remove(mesh); geo.dispose(); mat.dispose(); } catch (e) {}
    try { if (chip) chip.remove(); } catch (e) {}
  }

  /* `count()` and `text()` are how a driver asserts the preview actually
     tracked the run. The film is a colour and a screenshot of a colour is not a
     measurement — see .gauntlet/README item 6 on why an A/B of the rendered
     frame is the wrong instrument for this. */
  return { show, label, hide, dispose, count: () => cells,
           text: () => (chip ? chip.textContent : ''), mesh };
}
