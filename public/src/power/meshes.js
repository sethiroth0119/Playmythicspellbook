/* ════════════════════════════════════════════════════════════════════════════
   🏭 THE NINE PLANT MESHES — procedural, in the game's own style.
   ----------------------------------------------------------------------------
   Nine buildings that must read apart FROM THE AIR, because that is the camera
   this game is played from. Each one gets a silhouette no other tile in the city
   has, and the silhouette is the point: BAR.md's dimension 3 is lost the moment
   anything "reads as an extruded box with a flat lid".

     wind         a real three-bladed rotor on a tapered tower
     solar        rows of tilted frames — the only striped plan-view in the city
     coal         a fat banded stack, a conveyor and a black coal heap
     gas          two horizontal pressure vessels and a slim stack
     oil          two vertical tanks with roof rings and a pipe rack
     geothermal   a Christmas-tree wellhead and a broad ground-hugging steam cloud
     hydro        a curved dam wall across a reservoir, with a spillway
     nuclear      a HYPERBOLOID cooling tower and a containment dome
     incinerator  a tipping hall, a bunker crane and a tall thin stack

   ── 🔴 WHY THIS FILE EXISTS AT ALL, AND NOT IN index.html ──────────────────
   node-city's make*() recipes and its MAT / TEX_* / SKY blocks belong to another
   workflow this round. Adding nine 60-line builders in the middle of them is a
   merge conflict waiting to happen and, worse, it puts new game content in the
   file CLAUDE.md says new systems must stay out of. So the geometry lives here
   and node-city gains ONE dispatch line.

   🔴 THREE ARRIVES FROM THE HOST — THE GLOBALS TRAP (CLAUDE.md).
      `THREE` is a top-level `const` inside node-city's module script and is not
      on `window`. This file imports nothing and is handed the namespace at
      mount(), exactly as overlay.js is. Before mount, `mesh()` returns null and
      the host falls back to its own Power Station recipe — which is a real
      building rather than an invisible tile, and is what makes a 404 on this
      module cost the player detail instead of a hole in their city.

   ── THE THREE HOUSE RULES THIS FILE OBEYS ──────────────────────────────────
   1. EVERY GEOMETRY IS CREATED PER CALL AND STAMPED `userData.owned = true`.
      node-city's dropTileMesh frees only stamped buffers, and its own comment
      records that this leaked "tens of MB over a session" when it was got wrong.
      Nothing here is cached across calls: a shared geometry stamped `owned`
      would be freed out from under every other plant using it — which is
      exactly why the host refuses to refcount.
   2. MATERIALS ARE SHARED AND ARE NEVER DISPOSED. disposeOwnedGeo touches
      geometry only, so a per-plant material would leak instead. Ten materials
      serve all nine plants.
   3. REPEATED UNITS ARE INSTANCED. Twelve solar panels are ONE draw call, not
      twelve. The city already pushes ~1,700 meshes / ~2.8M triangles and the
      brief's budget line is explicit that 576 of anything is not affordable.
   ════════════════════════════════════════════════════════════════════════════ */

let T = null;      // the THREE namespace, handed over at mount()
let MAT = null;

export function mount(host) {
  if (T) return true;
  if (!host || !host.THREE) return false;
  T = host.THREE;
  /* The palette. Deliberately node-city's own naturalistic register — warm grey
     concrete, neutral steel, dark asphalt — rather than a second look. BAR.md
     dimension 1 is lost by a single saturated building. */
  MAT = {
    concrete: new T.MeshStandardMaterial({ color: 0x9a958b, roughness: 0.94 }),
    pale:     new T.MeshStandardMaterial({ color: 0xc6c2b6, roughness: 0.88 }),
    steel:    new T.MeshStandardMaterial({ color: 0xb2b6ba, roughness: 0.52, metalness: 0.55 }),
    dark:     new T.MeshStandardMaterial({ color: 0x3c3a38, roughness: 0.95 }),
    yard:     new T.MeshStandardMaterial({ color: 0x7d786e, roughness: 0.97 }),
    hazard:   new T.MeshStandardMaterial({ color: 0xb8542f, roughness: 0.8 }),
    glass:    new T.MeshStandardMaterial({ color: 0x1b2430, emissive: 0xffc978,
                                           emissiveIntensity: 0.35, roughness: 0.55 }),
    /* ⚠ THE SOLAR PANEL AND THE WATER ARE BOTH LIFTED FROM THE COLOUR THEY
       "SHOULD" BE, and it was a photograph that decided it. At 0x1d2c44 and
       0x35617f the solar field and the reservoir were the two things in the
       whole set that did not read at dusk — a dark blue plate on dark ground is
       invisible under a low sun, which is half of every day in this game. Both
       carry a low emissive so they hold a colour when the key light leaves,
       which is also what real glass and real water do: they go on reflecting the
       sky after the ground has gone dark. */
    panel:    new T.MeshStandardMaterial({ color: 0x2f4c78, emissive: 0x101c2e,
                                           emissiveIntensity: 0.85, roughness: 0.30, metalness: 0.30 }),
    water:    new T.MeshStandardMaterial({ color: 0x4a86ab, emissive: 0x12293a,
                                           emissiveIntensity: 0.75, roughness: 0.22, metalness: 0.1 }),
    /* The plume. One material for smoke and steam alike — the COLOUR difference
       between a coal stack and a cooling tower is carried by the mesh's own
       `material.color` clone? No: cloning would leak. Both read as pale vapour,
       and what distinguishes them is the SHAPE, which is the honest read anyway:
       a hyperboloid tower's plume is fat and a coal stack's is a thin column. */
    plume:    new T.MeshStandardMaterial({ color: 0xd9dde0, roughness: 1, transparent: true,
                                           opacity: 0.28, depthWrite: false }),
  };
  return true;
}
export function ready() { return !!T; }

/* ── PRIMITIVES ─────────────────────────────────────────────────────────────
   Same signatures as node-city's own box()/cyl() so a reader moving between the
   two files is not translating. `own()` is this file's copy of the host's
   `_ownGeo` stamp — see house rule 1. */
function own(g) { (g.userData || (g.userData = {})).owned = true; return g; }
function box(w, h, d, mat, x, y, z, ry) {
  const m = new T.Mesh(own(new T.BoxGeometry(w, h, d)), mat);
  m.position.set(x || 0, y || 0, z || 0); if (ry) m.rotation.y = ry;
  m.castShadow = m.receiveShadow = true; return m;
}
function cyl(rt, rb, h, mat, x, y, z, seg) {
  const m = new T.Mesh(own(new T.CylinderGeometry(rt, rb, h, seg || 10)), mat);
  m.position.set(x || 0, y || 0, z || 0);
  m.castShadow = m.receiveShadow = true; return m;
}
function pad(w, d, mat, y) {
  const m = box(w, 0.02, d, mat, 0, (y || 0) + 0.01, 0);
  m.castShadow = false; return m;                       // a slab casts nothing useful
}
/* A translucent plume. Never casts and never receives: a vapour column that
   throws a hard shadow across the plot reads as a solid object, which is the one
   thing it must not. */
function plume(r0, r1, h, x, y, z) {
  const m = cyl(r1, r0, h, MAT.plume, x, y, z, 9);
  m.castShadow = m.receiveShadow = false;
  return m;
}
/* N copies of one geometry in ONE draw call. `place(i, obj3d)` positions each
   instance through a scratch Object3D, which is three.js's own idiom and avoids
   allocating a Matrix4 per instance. */
function instanced(geo, mat, n, place) {
  const im = new T.InstancedMesh(own(geo), mat, n);
  const o = new T.Object3D();
  for (let i = 0; i < n; i++) { o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); place(i, o); o.updateMatrix(); im.setMatrixAt(i, o.matrix); }
  im.instanceMatrix.needsUpdate = true;
  im.castShadow = im.receiveShadow = true;
  return im;
}

/* ════════════════════════════════════════════════════════════════════════════
   THE DISPATCH. `lvl` buys HEIGHT and UNIT COUNT, never footprint — a plant that
   grew past its tile at level 3 would overrun the road it is wired to, which is
   the same rule node-city states for the Stadium.
   ════════════════════════════════════════════════════════════════════════════ */
export function mesh(type, lvl) {
  if (!T) return null;
  const L = Math.max(1, Math.min(4, lvl | 0 || 1));
  switch (type) {
    case 'wind':        return makeWind(L);
    case 'solar':       return makeSolar(L);
    case 'coal':        return makeCoal(L);
    case 'gas':         return makeGas(L);
    case 'oil':         return makeOil(L);
    case 'geothermal':  return makeGeothermal(L);
    case 'hydro':       return makeHydro(L);
    case 'nuclear':     return makeNuclear(L);
    case 'incinerator': return makeIncinerator(L);
    default: return null;
  }
}

/* 🌬 WIND TURBINE. The only slender vertical in the game, and the reason a row
   of them reads as a wind farm from the air: a small round pad, a TAPERED tower
   (wider at the foot — a straight tube reads as a lamp post), a nacelle with a
   visible hub, and three real blades that taper along their length.
   Level buys tower height, so a line of upgraded turbines still lines up.
   7 meshes. */
function makeWind(L) {
  const g = new T.Group();
  const H = 0.52 + (L - 1) * 0.09;
  g.add(pad(0.30, 0.30, MAT.pale, 0));
  g.add(cyl(0.019, 0.045, H, MAT.pale, 0, H / 2 + 0.02, 0, 10));      // the tower
  g.add(box(0.075, 0.055, 0.14, MAT.pale, 0, H + 0.045, -0.01));      // the nacelle
  // The hub: a short cone lying along +Z, so it noses out of the nacelle front.
  const hub = cyl(0.020, 0.038, 0.050, MAT.pale, 0, H + 0.045, 0.082, 10);
  hub.rotation.x = Math.PI / 2;
  g.add(hub);
  /* THE ROTOR. Three blades at 120°, each a long tapered box tilted a few
     degrees out of plane so the disc catches the light unevenly — a flat rotor
     reads as a decal from directly above, which is the view that matters. */
  const blade = new T.BoxGeometry(0.020, 0.30, 0.008);
  blade.translate(0, 0.16, 0);          // root at the hub, not at the centre
  const rotor = instanced(blade, MAT.pale, 3, (i, o) => {
    o.rotation.z = i * Math.PI * 2 / 3;
    o.rotation.x = 0.10;
  });
  rotor.position.set(0, H + 0.045, 0.108);
  g.add(rotor);
  g.add(box(0.05, 0.05, 0.04, MAT.dark, 0.10, 0.05, 0.11));           // the switch cabinet
  g.add(box(0.026, 0.012, 0.026, MAT.hazard, 0, H + 0.078, -0.01));   // the aviation light
  return g;
}

/* ☀ SOLAR FARM. Rows of tilted frames on a gravel field — the one PLAN-VIEW
   stripe in the city, which is exactly how a solar farm is recognised from
   above. Every panel is one instance of one geometry, so 12–20 of them cost one
   draw call. Level buys rows.
   6 meshes. */
function makeSolar(L) {
  const g = new T.Group();
  g.add(pad(0.90, 0.90, MAT.yard, 0));
  const rows = 3 + Math.min(2, L - 1), perRow = 4, n = rows * perRow;
  const panel = new T.BoxGeometry(0.185, 0.008, 0.135);
  panel.rotateX(-0.62);                                   // the tilt, baked in
  const z0 = -0.30, dz = 0.60 / (rows - 1 || 1);
  g.add(instanced(panel, MAT.panel, n, (i, o) => {
    o.position.set(-0.30 + (i % perRow) * 0.20, 0.085, z0 + ((i / perRow) | 0) * dz);
  }));
  // The frames under them, same count, same layout, one more draw call.
  const leg = new T.BoxGeometry(0.010, 0.075, 0.010);
  g.add(instanced(leg, MAT.steel, n, (i, o) => {
    o.position.set(-0.30 + (i % perRow) * 0.20, 0.0475, z0 + ((i / perRow) | 0) * dz + 0.03);
  }));
  g.add(box(0.17, 0.13, 0.13, MAT.pale, 0.30, 0.085, 0.36));          // the inverter hut
  g.add(box(0.10, 0.09, 0.09, MAT.steel, 0.30, 0.065, 0.19));         // its transformer
  g.add(box(0.07, 0.05, 0.012, MAT.glass, 0.30, 0.09, 0.427));        // a lit door
  return g;
}

/* 🪨 COAL PLANT. The dirtiest thing in the game should look it from a distance:
   a squat boiler house, a BLACK CONICAL HEAP of coal (nothing else in the city
   is a cone of that colour), an angled conveyor climbing out of it, and one fat
   banded stack with a real column of smoke.
   Level buys stack height, because a taller stack is what a real plant builds
   when it needs to push more.
   9 meshes. */
function makeCoal(L) {
  const g = new T.Group();
  const SH = 0.62 + (L - 1) * 0.10;
  g.add(pad(0.92, 0.92, MAT.yard, 0));
  g.add(box(0.46, 0.30, 0.36, MAT.concrete, -0.16, 0.17, -0.10));     // the boiler house
  g.add(box(0.50, 0.030, 0.40, MAT.dark, -0.16, 0.335, -0.10));       // its roof cap
  g.add(cyl(0.048, 0.075, SH, MAT.pale, 0.245, SH / 2 + 0.02, -0.24, 12));  // THE STACK
  g.add(cyl(0.052, 0.052, 0.045, MAT.hazard, 0.245, SH - 0.06, -0.24, 12)); // its warning band
  g.add(plume(0.048, 0.15, 0.42, 0.245, SH + 0.23, -0.24));           // the smoke
  g.add(cyl(0.001, 0.20, 0.20, MAT.dark, 0.24, 0.10, 0.30, 12));      // THE COAL HEAP
  // The conveyor out of the heap and into the house — an angled slab on legs.
  const conv = box(0.055, 0.018, 0.42, MAT.steel, 0.06, 0.20, 0.10);
  conv.rotation.x = -0.42;
  g.add(conv);
  g.add(box(0.16, 0.10, 0.02, MAT.glass, -0.16, 0.14, 0.082));        // the lit control room
  return g;
}

/* 🔥 NATURAL GAS PLANT. The cleanest-looking of the three fossils and the most
   industrial in plan: two HORIZONTAL pressure vessels with dished ends — nothing
   else in the city lies down — a compact turbine hall, a slim stack and a pipe
   run tying them together.
   8 meshes. */
function makeGas(L) {
  const g = new T.Group();
  g.add(pad(0.90, 0.90, MAT.yard, 0));
  g.add(box(0.40, 0.24, 0.30, MAT.pale, -0.20, 0.14, -0.14));         // the turbine hall
  g.add(box(0.44, 0.026, 0.34, MAT.steel, -0.20, 0.265, -0.14));      // roof
  // Two horizontal vessels, instanced, lying along X on saddles.
  const vessel = new T.CylinderGeometry(0.070, 0.070, 0.36, 14);
  vessel.rotateZ(Math.PI / 2);
  g.add(instanced(vessel, MAT.steel, 2, (i, o) => o.position.set(0.06, 0.11, 0.14 + i * 0.20)));
  const saddle = new T.BoxGeometry(0.045, 0.055, 0.10);
  g.add(instanced(saddle, MAT.concrete, 4, (i, o) =>
    o.position.set(-0.06 + (i % 2) * 0.24, 0.0275, 0.14 + ((i / 2) | 0) * 0.20)));
  g.add(cyl(0.026, 0.034, 0.50 + (L - 1) * 0.07, MAT.pale, 0.34, 0.27 + (L - 1) * 0.035, -0.30, 10));
  g.add(plume(0.024, 0.070, 0.24, 0.34, 0.60 + (L - 1) * 0.07, -0.30));
  g.add(box(0.14, 0.09, 0.02, MAT.glass, -0.20, 0.12, 0.012));        // lit hall glazing
  return g;
}

/* 🛢 OIL PLANT. Two VERTICAL tanks with roof rings and a walkway between them —
   the classic tank-farm read — over a low turbine house and a pipe rack.
   9 meshes. */
function makeOil(L) {
  const g = new T.Group();
  g.add(pad(0.90, 0.90, MAT.yard, 0));
  const TH = 0.26 + (L - 1) * 0.05;
  const tank = new T.CylinderGeometry(0.135, 0.135, TH, 16);
  g.add(instanced(tank, MAT.pale, 2, (i, o) => o.position.set(-0.18 + i * 0.36, TH / 2 + 0.02, 0.24)));
  const ring = new T.CylinderGeometry(0.142, 0.142, 0.014, 16);
  g.add(instanced(ring, MAT.steel, 2, (i, o) => o.position.set(-0.18 + i * 0.36, TH + 0.025, 0.24)));
  g.add(box(0.36, 0.016, 0.026, MAT.steel, 0, TH + 0.04, 0.24));      // the walkway between them
  g.add(box(0.44, 0.22, 0.28, MAT.concrete, -0.14, 0.13, -0.22));     // turbine house
  g.add(box(0.48, 0.026, 0.32, MAT.dark, -0.14, 0.245, -0.22));       // roof
  g.add(cyl(0.032, 0.044, 0.46, MAT.pale, 0.30, 0.25, -0.30, 10));    // the stack
  g.add(plume(0.030, 0.10, 0.30, 0.30, 0.63, -0.30));
  // The pipe rack: four parallel runs on one instanced geometry.
  const pipe = new T.CylinderGeometry(0.012, 0.012, 0.42, 7);
  pipe.rotateX(Math.PI / 2);
  g.add(instanced(pipe, MAT.steel, 4, (i, o) => o.position.set(-0.30 + i * 0.026, 0.16, 0.02)));
  g.add(box(0.14, 0.09, 0.02, MAT.glass, -0.14, 0.11, -0.078));
  return g;
}

/* ♨ GEOTHERMAL PLANT. Reads as a WELL, not a factory — that is the whole point
   of a plant you can only build where the ground allows. A Christmas-tree
   wellhead (a stack of valve bodies and two side wings), a low binary-cycle
   house, an air-cooled condenser deck, and a broad low steam cloud that hugs the
   ground instead of climbing like a stack plume.
   Level buys a second wellhead.
   10 meshes. */
function makeGeothermal(L) {
  const g = new T.Group();
  g.add(pad(0.90, 0.90, MAT.yard, 0));
  g.add(box(0.40, 0.20, 0.30, MAT.pale, -0.20, 0.12, -0.16));         // the turbine house
  g.add(box(0.44, 0.024, 0.34, MAT.steel, -0.20, 0.232, -0.16));
  // The air-cooled condenser: a raised deck of fan bays, instanced.
  const fan = new T.CylinderGeometry(0.048, 0.048, 0.020, 12);
  g.add(instanced(fan, MAT.dark, 4, (i, o) =>
    o.position.set(-0.32 + (i % 2) * 0.24, 0.20, 0.24 + ((i / 2) | 0) * 0.20)));
  g.add(box(0.34, 0.014, 0.30, MAT.steel, -0.20, 0.185, 0.34));       // the deck it sits on
  const wells = L >= 3 ? 2 : 1;
  for (let w = 0; w < wells; w++) {
    const wx = 0.26, wz = -0.24 + w * 0.36;
    g.add(cyl(0.030, 0.048, 0.075, MAT.concrete, wx, 0.055, wz, 10));  // the cellar
    g.add(cyl(0.020, 0.020, 0.20, MAT.steel, wx, 0.19, wz, 8));        // the casing
    // The tree: three valve bodies and two wings, one instanced geometry.
    const body = new T.BoxGeometry(0.046, 0.030, 0.046);
    g.add(instanced(body, MAT.hazard, 3, (i, o) => o.position.set(wx, 0.14 + i * 0.055, wz)));
    g.add(box(0.11, 0.018, 0.018, MAT.steel, wx, 0.245, wz));          // the wings
  }
  /* THE STEAM. Wide, short and low — geothermal vapour rolls, it does not
     column. Two overlapping soft cylinders read as cloud without a particle
     system, and neither casts. */
  g.add(plume(0.13, 0.20, 0.16, 0.26, 0.34, -0.20));
  g.add(plume(0.10, 0.15, 0.12, 0.16, 0.28, -0.06));
  return g;
}

/* 💧 HYDRO PLANT. A DAM: a wall across the tile with a batter (thicker at the
   foot), a reservoir behind it, a spillway notch with water falling through, two
   penstocks dropping to a powerhouse at the toe. The only tile in the city with
   standing water on it, which is exactly the read.
   11 meshes. */
function makeHydro(L) {
  const g = new T.Group();
  g.add(pad(0.90, 0.90, MAT.dark, 0));
  const DH = 0.30 + (L - 1) * 0.04;
  g.add(box(0.86, 0.012, 0.36, MAT.water, 0, 0.026, -0.26));          // the reservoir
  /* The wall, built as three stacked slabs of decreasing depth so it has a real
     batter rather than being a slab on edge. */
  g.add(box(0.86, DH * 0.42, 0.16, MAT.concrete, 0, DH * 0.21 + 0.02, -0.03));
  g.add(box(0.86, DH * 0.34, 0.115, MAT.concrete, 0, DH * 0.59 + 0.02, -0.045));
  g.add(box(0.86, DH * 0.24, 0.075, MAT.pale, 0, DH * 0.88 + 0.02, -0.055));
  g.add(box(0.86, 0.016, 0.095, MAT.steel, 0, DH + 0.028, -0.055));   // the crest roadway
  g.add(box(0.13, DH * 0.55, 0.085, MAT.water, 0.20, DH * 0.30 + 0.02, 0.010));  // the spillway
  g.add(box(0.24, 0.012, 0.20, MAT.water, 0.20, 0.028, 0.16));        // the tailrace pool
  // Two penstocks down the face, instanced and tilted.
  const pen = new T.CylinderGeometry(0.026, 0.026, DH * 0.9, 9);
  pen.rotateX(0.30);
  g.add(instanced(pen, MAT.steel, 2, (i, o) => o.position.set(-0.26 + i * 0.16, DH * 0.48, 0.03)));
  g.add(box(0.32, 0.13, 0.16, MAT.pale, -0.18, 0.085, 0.24));         // the powerhouse
  g.add(box(0.36, 0.020, 0.20, MAT.steel, -0.18, 0.158, 0.24));       // its roof
  g.add(box(0.16, 0.055, 0.02, MAT.glass, -0.18, 0.085, 0.322));      // lit machine hall
  return g;
}

/* ☢ NUCLEAR PLANT. The one unmistakable industrial silhouette in the world, and
   it is worth the vertices: a genuine HYPERBOLOID cooling tower turned on a
   LatheGeometry from a real 1/r profile — not three stacked tubes — plus a
   hemispherical containment dome and a long turbine hall.
   ⚠ THE PROFILE IS WHY THE TOWER READS. A cone or a stack of cylinders gives a
     waist that is straight or stepped; the whole visual signature of a cooling
     tower is that its sides are CURVED and its throat flares back out at the
     top. Twelve profile points and a 20-segment lathe is 480 triangles for the
     most recognisable shape in the set.
   Level buys tower height and a second, smaller tower.
   9 meshes. */
function makeNuclear(L) {
  const g = new T.Group();
  g.add(pad(0.94, 0.94, MAT.yard, 0));

  const towerGeo = (h, rBase) => {
    /* r(y) = rThroat * sqrt(1 + ((y - yThroat)/c)^2) — the hyperboloid of one
       sheet, which is what a cooling tower actually is. Sampled at 12 points. */
    const pts = [];
    const rT = rBase * 0.60, yT = h * 0.72, c = h * 0.62;
    for (let i = 0; i <= 11; i++) {
      const y = (i / 11) * h;
      const r = rT * Math.sqrt(1 + Math.pow((y - yT) / c, 2));
      pts.push(new T.Vector2(r, y));
    }
    return own(new T.LatheGeometry(pts, 20));
  };

  const towers = L >= 3 ? 2 : 1;
  for (let i = 0; i < towers; i++) {
    const h = (0.46 + (L - 1) * 0.05) * (i ? 0.78 : 1);
    const rB = 0.155 * (i ? 0.80 : 1);
    const tx = i ? 0.30 : 0.245, tz = i ? 0.30 : -0.24;
    const t = new T.Mesh(towerGeo(h, rB), MAT.concrete);
    t.position.set(tx, 0.02, tz);
    t.castShadow = t.receiveShadow = true;
    g.add(t);
    g.add(plume(rB * 0.62, rB * 1.5, 0.30, tx, h + 0.18, tz));         // the steam
  }
  // The containment: a hemisphere on a short drum. Nothing else here is round
  // and closed at the top.
  const dome = new T.Mesh(own(new T.SphereGeometry(0.115, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), MAT.pale);
  dome.position.set(-0.20, 0.20, -0.14); dome.castShadow = dome.receiveShadow = true;
  g.add(dome);
  g.add(cyl(0.115, 0.115, 0.18, MAT.pale, -0.20, 0.11, -0.14, 16));    // its drum
  g.add(box(0.44, 0.15, 0.20, MAT.pale, -0.14, 0.095, 0.20));          // the turbine hall
  g.add(box(0.48, 0.022, 0.24, MAT.steel, -0.14, 0.181, 0.20));        // its roof
  g.add(box(0.22, 0.055, 0.02, MAT.glass, -0.14, 0.095, 0.302));       // lit hall glazing
  return g;
}

/* ♻ GARBAGE INCINERATOR. A waste problem turned into an energy answer, and it
   should look like the problem: a big blank TIPPING HALL with a roller door, a
   bunker with a crane gantry over it, a skip in the yard, and one tall THIN
   stack — taller and thinner than coal's, because that is exactly how the two
   are told apart in real skylines.
   10 meshes. */
function makeIncinerator(L) {
  const g = new T.Group();
  g.add(pad(0.92, 0.92, MAT.yard, 0));
  g.add(box(0.50, 0.34, 0.38, MAT.pale, -0.14, 0.19, -0.06));          // the tipping hall
  g.add(box(0.54, 0.028, 0.42, MAT.steel, -0.14, 0.375, -0.06));       // roof
  g.add(box(0.20, 0.20, 0.026, MAT.dark, -0.14, 0.12, 0.132));         // the roller door
  g.add(box(0.21, 0.014, 0.030, MAT.hazard, -0.14, 0.028, 0.16));      // the hazard chevron
  // The bunker crane: a gantry beam on two legs over the yard.
  const legG = new T.BoxGeometry(0.016, 0.20, 0.016);
  g.add(instanced(legG, MAT.steel, 2, (i, o) => o.position.set(0.16, 0.12, -0.30 + i * 0.34)));
  g.add(box(0.030, 0.026, 0.36, MAT.steel, 0.16, 0.228, -0.13));       // the beam
  g.add(box(0.055, 0.070, 0.055, MAT.hazard, 0.16, 0.175, -0.20));     // the grab
  g.add(cyl(0.030, 0.042, 0.72 + (L - 1) * 0.10, MAT.pale, 0.34, 0.38 + (L - 1) * 0.05, 0.28, 12));
  g.add(plume(0.028, 0.11, 0.34, 0.34, 0.90 + (L - 1) * 0.10, 0.28));
  return g;
}
