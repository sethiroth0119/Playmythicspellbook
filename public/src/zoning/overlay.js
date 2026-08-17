/* ══════════════════════════════════════════════════════════════════════════
   🎨 THE ZONING OVERLAY — the coloured land-use film, and the tool preview.

   ONE mesh for the whole board, rebuilt when the zone map changes. The obvious
   implementation is a plane per zoned tile; on a 24x24 grid that is up to 576
   extra objects in a scene that already carries ~1,700 meshes and pays a draw
   call for each, for something that is a flat film of colour. Everything below
   is concatenated into a single non-indexed BufferGeometry with vertex colours
   instead: one draw call, whatever the player zones.

   ⚠ THE Y STACK IS ALREADY FULL, AND IT IS TALLER THAN IT LOOKS. node-city
     stacks a tile shade plane at y=0, the gridHelper at .012, the road
     carriageway at RD_Y=.016 and the hover highlight at .02 — but a HOUSE also
     brings its own plot with it: makeHousing lays an apron at .016, a path at
     .019 and planting beds at .022. The first cut put the film at .024 and it
     was invisible over every built tile, buried under exactly the paving it was
     supposed to annotate (photographed, .gauntlet/shots). .05 clears the whole
     plot stack while staying far below anything that is a building, so the film
     reads on developed land and is still correctly occluded BY the buildings
     standing in it — which is what makes it an info view rather than a decal
     painted over the city.

   Depth-write is OFF and the material is transparent: the film must not
   occlude the buildings standing in it, and two coplanar quads (fill + border)
   must not fight. renderOrder is pushed up for the same reason.
   ══════════════════════════════════════════════════════════════════════════ */

const FILL_Y = 0.050;
const PREV_Y = 0.056;
const INSET = 0.055;          // gap between a tile's film and its neighbour's
const BORDER = 0.075;         // the brighter rim that makes a block read as a block

export function makeOverlay(THREE, scene, HALF) {
  const geo = new THREE.BufferGeometry();
  const mat = new THREE.MeshBasicMaterial({
    /* 0.72 is measured, not chosen: at 0.55 (the first cut) the film sat over
       node-city's pale ground and every hue read as a wash of the same off-
       white, which is the exact opposite of the point — the whole job of these
       colours is that green/blue/teal/yellow are legible AT A GLANCE. */
    vertexColors: true, transparent: true, opacity: 0.72,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 6;
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.name = 'zoning-overlay';
  scene.add(mesh);

  // The tool preview: one unit quad, moved and scaled. A marquee is a
  // rectangle of any size, so a single scaled plane covers paint, marquee and
  // fill-hover without allocating anything per frame.
  const pgeo = new THREE.PlaneGeometry(1, 1);
  pgeo.rotateX(-Math.PI / 2);
  const pmat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.34, depthWrite: false });
  const prev = new THREE.Mesh(pgeo, pmat);
  prev.renderOrder = 7;
  prev.visible = false;
  prev.name = 'zoning-preview';
  scene.add(prev);

  const _c = new THREE.Color();
  let _built = 0;

  /* zones: { "x,z": zoneId }   colOf: id => 0xRRGGBB | null */
  function rebuild(zones, colOf) {
    const pos = [], col = [];
    const push = (x0, z0, x1, z1, y, r, g, b) => {
      // two triangles, CCW seen from above
      pos.push(x0, y, z0,  x1, y, z0,  x1, y, z1,
               x0, y, z0,  x1, y, z1,  x0, y, z1);
      for (let i = 0; i < 6; i++) col.push(r, g, b);
    };
    let n = 0;
    for (const k in zones) {
      const id = zones[k];
      const hex = colOf(id);
      if (hex == null) continue;
      const c = k.split(',');
      const x = +c[0], z = +c[1];
      if (!isFinite(x) || !isFinite(z)) continue;
      const wx = x - HALF, wz = z - HALF;          // tile's -x/-z corner in world
      _c.setHex(hex);
      const fr = _c.r * 0.90, fg = _c.g * 0.90, fb = _c.b * 0.90;
      const br = Math.min(1, _c.r * 1.7 + 0.03), bg = Math.min(1, _c.g * 1.7 + 0.03), bb = Math.min(1, _c.b * 1.7 + 0.03);
      const a = wx + INSET, b2 = wx + 1 - INSET, c2 = wz + INSET, d = wz + 1 - INSET;
      push(a, c2, b2, d, FILL_Y, fr, fg, fb);                       // the field
      push(a, c2, b2, c2 + BORDER, FILL_Y, br, bg, bb);             // rim, -z
      push(a, d - BORDER, b2, d, FILL_Y, br, bg, bb);               // rim, +z
      push(a, c2, a + BORDER, d, FILL_Y, br, bg, bb);               // rim, -x
      push(b2 - BORDER, c2, b2, d, FILL_Y, br, bg, bb);             // rim, +x
      n++;
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    /* ⚠ NORMALS ARE NOT OPTIONAL even for MeshBasicMaterial. node-city runs
       three's WebGPU renderer (WebGL2 backend here), and its node material
       system warns "TSL.NormalNode: Vertex attribute normal not found" once per
       geometry without them. The film is flat and faces up, so one constant
       vector per vertex is the whole answer. */
    const nrm = new Float32Array(pos.length);
    for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.computeBoundingSphere();
    _built = n;
    return n;
  }

  function setVisible(v) { mesh.visible = !!v && _built > 0; }
  function visible() { return !!mesh.visible; }

  /* rect = {x0,z0,x1,z1} in tile coords, inclusive. hex null hides it. */
  function preview(rect, hex) {
    if (!rect || hex == null) { prev.visible = false; return; }
    const x0 = Math.min(rect.x0, rect.x1), x1 = Math.max(rect.x0, rect.x1);
    const z0 = Math.min(rect.z0, rect.z1), z1 = Math.max(rect.z0, rect.z1);
    const w = x1 - x0 + 1, d = z1 - z0 + 1;
    prev.scale.set(w, 1, d);
    prev.position.set(x0 - HALF + w / 2, PREV_Y, z0 - HALF + d / 2);
    pmat.color.setHex(hex);
    prev.visible = true;
  }

  function dispose() {
    try { scene.remove(mesh); geo.dispose(); mat.dispose(); } catch (e) {}
    try { scene.remove(prev); pgeo.dispose(); pmat.dispose(); } catch (e) {}
  }

  return { rebuild, setVisible, visible, preview, dispose, count: () => _built };
}
