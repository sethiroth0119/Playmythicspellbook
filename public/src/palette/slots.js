/* ══ THE THREE MATERIAL SLOTS — how a player's colour reaches the mesh ═════
   READ THIS BEFORE CHANGING ANYTHING IN HERE.

   ── The problem ─────────────────────────────────────────────────────────
   A built city is ~1,700 meshes. Buildings are constructed by the make*()
   recipes in node-city/index.html, which BAKE their colours in at build time
   (makeHousing's header explains why: a house seeded off Math.random re-rolled
   its whole street on every reload, so the seed is now the tile's grid coords).
   Giving each building its own material to recolour would mean a material —
   and therefore a draw call and a shader program — per building. That is the
   one thing the file's own perf budget explicitly forbids.

   ── What the file already does, and why that hands us the answer ─────────
   Every merged recipe in index.html already paints itself with VERTEX COLOURS
   over a handful of shared materials:

       HOUSE_PAINT / HOUSE_TRIM     ARC_PAINT / ARC_TRIM
       CIVIC_PAINT / CIVIC_TRIM     EX_PAINT  / EX_TRIM
       DEF_PAINT / DEF_STEEL        AG_PAINT  NAT_PAINT  NT_CLAD

   …all declared `vertexColors: true`, all `color: 0xffffff`. `_hTint(geo, hex)`
   writes ONE uniform colour across a whole merged bucket's `color` attribute,
   and `_hBucket()` then draws that bucket as a single mesh. So a house is
   already twelve meshes over two shared materials, each mesh carrying its own
   flat colour in its own vertex buffer.

   ── The decision, and what it costs ──────────────────────────────────────
   WE REWRITE THAT `color` ATTRIBUTE. Nothing else.

     • Zero new materials. Zero new draw calls. Zero new shader programs.
       The recolour is `attr.setXYZ()` over one buffer plus one
       `needsUpdate = true`; the GPU cost is a single sub-buffer upload of a
       few kilobytes, once, at the moment the player lets go of the handle.
     • It sits ON TOP of whatever the MAT tables and the TEX_* canvases become
       — a parallel agent is retuning both right now. We never read, clone or
       touch a material's own `color`, `map` or roughness, so a retune lands
       under a painted building exactly as it lands under an unpainted one.
     • The cost we DO pay: one saved copy of the generated colour per painted
       submesh, so ↻ Reset can put it back (see `capture` below — a flat bucket
       stores 3 floats, a rare multi-coloured one stores its array). That copy
       lives on the mesh and dies with it.

   Rejected, and why:
     · `mesh.material = base.clone()` per building — the draw-call disaster
       above. This is the obvious approach and it is the wrong one.
     · A shared material cache keyed by colour — better, but it still adds a
       program per distinct colour the player picks, and a colour PICKER is a
       machine for producing distinct colours. It also cannot express "this
       wall and that wall differ" without splitting the merge back apart.
     · Re-running the make*() recipe with an injected palette — that means
       changing every one of ~60 recipes, in a file two other workflows are
       editing right now, to thread a parameter that only this feature wants.

   ── Which submesh is "the wall"? ────────────────────────────────────────
   Tagging roles at construction would be exact, but it means editing recipes
   we are not allowed to touch. Instead we classify what buildMesh hands back,
   and the signals are properties of the SHIPPED file, not guesses:

     1. `geometry.userData.owned === true` — index.html's own ownership stamp,
        set by the _*Merge helpers at the only place ownership is knowable.
        It means "these buffers are referenced by nothing else". Road tiles
        (RD_GEO) and GLB clones are deliberately NOT stamped, so honouring the
        stamp is what stops us recolouring every instance of a shared model.
     2. `material.vertexColors === true` + an existing `color` attribute —
        this IS the paintable substrate, and it is also why an untinted bucket
        (glass on winMat, metal on MAT.metal) is skipped: writing a colour a
        material never reads would be a lie in the UI.
     3. `metalness` splits PAINT from TRIM. Every *_PAINT material leaves it at
        0; every *_TRIM material sets it (.08 … .45). That is an exact
        discriminator for "structural surface" vs "trim/ironwork", not a
        heuristic.
     4. Within PAINT: the wall bucket is always far and away the largest by
        triangle count (it is the extruded panels with the window holes), and
        the roof bucket is the one whose geometry STARTS at the top of the
        building. `bbox.min.y` separates a roof from a plinth exactly.

   Classification is deterministic, so a rebuild classifies identically — which
   is what makes an override survive an upgrade, a repair and a reload.
   ══════════════════════════════════════════════════════════════════════════ */

export const SLOTS = [
  { id: 'wall', ico: '🧱', name: 'Walls',  hint: 'the main structural surface' },
  { id: 'roof', ico: '🏠', name: 'Roof',   hint: 'roof, parapet and ridge' },
  { id: 'trim', ico: '🪟', name: 'Trim',   hint: 'sills, frames, railings, ironwork' },
];
export const SLOT_IDS = SLOTS.map(s => s.id);

const triCount = (g) => {
  try { return (g.index ? g.index.count : g.attributes.position.count) / 3; }
  catch (e) { return 0; }
};

function minY(g) {
  try {
    if (!g.boundingBox) g.computeBoundingBox();
    return g.boundingBox ? g.boundingBox.min.y : 0;
  } catch (e) { return 0; }
}

/** Is this submesh something a player is allowed to repaint? See header. */
function paintable(o) {
  if (!o || !o.isMesh) return false;
  const g = o.geometry, m = o.material;
  if (!g || !m || Array.isArray(m)) return false;
  // (1) never touch buffers something else might be drawing
  if (!g.userData || g.userData.owned !== true) return false;
  // (2) the paintable substrate
  if (!m.isMeshStandardMaterial || m.vertexColors !== true) return false;
  if (!g.attributes || !g.attributes.color || g.attributes.color.itemSize < 3) return false;
  if (g.attributes.color.count < g.attributes.position.count) return false;
  /* Lamps, neon and lit glazing ride vertexColors too (VH_LAMP, NT_NEON). They
     are LIGHT, not surface — repainting them would make a window a colour swatch
     and would fight the day/night cycle, which writes emissiveIntensity on the
     one shared instance. */
  try { if (m.emissive && m.emissive.getHex() !== 0) return false; } catch (e) {}
  return true;
}

/**
 * @returns {{wall:Mesh|null, roof:Mesh|null, trim:Mesh|null}}
 * Any slot may be null — a Tree, a Wall or a Fountain simply has fewer than
 * three paintable surfaces, and the panel greys those swatches out rather than
 * inventing a target for them.
 */
export function classify(root) {
  const out = { wall: null, roof: null, trim: null };
  if (!root || !root.traverse) return out;
  const cands = [];
  try { root.traverse(o => { if (paintable(o)) cands.push(o); }); } catch (e) { return out; }
  if (!cands.length) return out;

  let paint = cands.filter(o => (o.material.metalness || 0) < .02);
  let trims = cands.filter(o => (o.material.metalness || 0) >= .02);
  // A recipe built entirely out of semi-metallic buckets (some industrial ones
  // are) still deserves a wall and a roof; fall back to ranking them all.
  if (!paint.length) { paint = trims; trims = []; }

  const byTris = (a) => a.slice().sort((x, y) => triCount(y.geometry) - triCount(x.geometry));

  const pOrder = byTris(paint);
  out.wall = pOrder[0] || null;

  const rest = pOrder.slice(1);
  if (rest.length) {
    // The roof is the bucket that STARTS highest. A plinth starts at the ground.
    let best = rest[0], bestY = minY(rest[0].geometry);
    for (const o of rest) { const y = minY(o.geometry); if (y > bestY) { bestY = y; best = o; } }
    out.roof = best;
  }

  if (trims.length) out.trim = byTris(trims)[0];
  else {
    const left = rest.filter(o => o !== out.roof);
    out.trim = left.length ? byTris(left)[0] : null;
  }
  return out;
}

/* ── the generated colour, kept so ↻ Reset is exact ────────────────────────
   Almost every bucket is uniformly tinted by _hTint, so the common case costs
   three floats. The rare bucket that carries more than one colour keeps a copy
   of its array — bounded by the mesh, freed with it, and only allocated for a
   submesh the player has actually painted. */
function capture(mesh) {
  if (mesh.userData.ncPaintOrig) return mesh.userData.ncPaintOrig;
  const a = mesh.geometry.attributes.color, n = a.count;
  let uniform = true;
  const r0 = a.getX(0), g0 = a.getY(0), b0 = a.getZ(0);
  for (let i = 1; i < n; i++) {
    if (Math.abs(a.getX(i) - r0) > 1e-4 || Math.abs(a.getY(i) - g0) > 1e-4 || Math.abs(a.getZ(i) - b0) > 1e-4) { uniform = false; break; }
  }
  const rec = uniform ? { u: [r0, g0, b0] } : { a: Float32Array.from(a.array) };
  mesh.userData.ncPaintOrig = rec;
  return rec;
}

/* The `color` attribute holds values in three's WORKING colour space, because
   _hTint writes `new THREE.Color(hex).r/g/b` and that constructor converts
   sRGB→working. So reading one back has to declare the same space or every
   swatch in the panel would be a gamma step away from the pixels on screen. */
const working = (THREE) =>
  (THREE.ColorManagement && THREE.ColorManagement.workingColorSpace) || THREE.LinearSRGBColorSpace;

/** The colour this submesh was GENERATED with, as a 6-digit sRGB hex. */
export function generatedHex(THREE, mesh) {
  if (!mesh) return null;
  try {
    const rec = mesh.userData.ncPaintOrig;
    const c = new THREE.Color(), ws = working(THREE);
    if (rec && rec.u) c.setRGB(rec.u[0], rec.u[1], rec.u[2], ws);
    else if (rec && rec.a) c.setRGB(rec.a[0], rec.a[1], rec.a[2], ws);
    else {
      const a = mesh.geometry.attributes.color;
      c.setRGB(a.getX(0), a.getY(0), a.getZ(0), ws);
    }
    return c.getHexString();
  } catch (e) { return null; }
}

/** What this submesh is showing RIGHT NOW, as a 6-digit sRGB hex. */
export function currentHex(THREE, mesh) {
  if (!mesh) return null;
  try {
    const a = mesh.geometry.attributes.color;
    return new THREE.Color().setRGB(a.getX(0), a.getY(0), a.getZ(0), working(THREE)).getHexString();
  } catch (e) { return null; }
}

/**
 * Paint one submesh. `hex` is sRGB, exactly as the player typed it —
 * THREE.Color does the sRGB→working-space conversion, which is the same
 * conversion _hTint relies on, so a hand-typed C9AF8F lands identically to a
 * generated one.
 */
export function tint(THREE, mesh, hex) {
  if (!mesh) return false;
  try {
    capture(mesh);
    const c = new THREE.Color('#' + hex);
    const a = mesh.geometry.attributes.color;
    for (let i = 0; i < a.count; i++) a.setXYZ(i, c.r, c.g, c.b);
    a.needsUpdate = true;
    return true;
  } catch (e) { return false; }
}

/** Put the generated colour back. No-op if this mesh was never painted. */
export function restore(mesh) {
  if (!mesh) return false;
  const rec = mesh && mesh.userData && mesh.userData.ncPaintOrig;
  if (!rec) return false;
  try {
    const a = mesh.geometry.attributes.color;
    if (rec.u) { for (let i = 0; i < a.count; i++) a.setXYZ(i, rec.u[0], rec.u[1], rec.u[2]); }
    else { a.array.set(rec.a); }
    a.needsUpdate = true;
    return true;
  } catch (e) { return false; }
}
