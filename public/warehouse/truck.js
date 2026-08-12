/* ════════════════════════════════════════════════════════════════════════════
   🚚 STEP VAN — the delivery truck that pulls up to the player's warehouse.

   An American walk-in step van / box delivery truck (Grumman-Olson / Utilimaster
   P-series on an MT45-style chassis): off-white satin body, forward-control cab
   INTEGRATED with the cargo box, crowned roof, stubby sloped nose, dual rear
   wheels, curb-side sliding door standing open.

   100% procedural THREE.js geometry — no .glb, no texture files, nothing fetched
   from anywhere. Drop the file next to the page and call WHTruck.build(THREE).

   HOW THE SHELL IS MADE (the part that matters):
     A step van is not a box. Its roof is CROWNED across the width, its top edges
     carry a big radius, and it bull-noses down over the windshield. So the body
     is not assembled from cubes — it is LOFTED: one closed cross-section outline
     is swept down the length of the truck, and each station along the way gets
     its own half-width / shoulder height / crown. Rounding the section rounds
     every edge at once, and rounding it DOWN toward the front produces the
     bull-nose for free.

     'squircle' profile — superellipse top (|x/hw|^n + |y/c|^n = 1). Its slope
                          goes vertical exactly at the shoulder, so the crown
                          meets the flat side wall tangentially: no crease.
     'radius'   profile — classic coach build: flat centre roof + an explicit
                          large-radius fillet rolling into the side wall.

   ════════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  // ─── ⚙ Dimensions (metres). The photo bar: ~7.0 long · 2.1 wide · 3.2 tall ──
  const D = {
    len:        7.00,   // bumper to rear step
    halfW:      1.05,   // 2.10 m across the cargo box
    floorY:     0.82,   // underside of the body
    shoulderY:  2.78,   // where the side wall stops and the roof crown starts
    crown:      0.34,   // how much the roof domes up above the shoulder
    zRear:     -2.92,
    zBulkhead:  1.60,   // cargo box ends / cab begins (the vertical panel line)
    zHeader:    2.86,   // top of the windshield (the bull-nose is behind this)
    zCowl:      3.16,   // bottom of the windshield
    zNose:      3.46,   // front of the sloped nose
    zBumper:    3.58,
    cowlY:      1.54,   // windshield bottom edge
    noseY:      1.38,
    wheelR:     0.46,
    wheelW:     0.27,
    zAxleF:     2.05,   // FORWARD CONTROL — the front axle sits behind the driver
    zAxleR:    -1.62,
    dualGap:    0.40,   // centre-to-centre of the two rear tyres per side
  };

  // ─── 🎨 Materials — a real split, not one grey for everything ───────────────
  // Painted metal / dark glass / rubber / chrome / black plastic / lit lenses,
  // each with its own roughness+metalness so the light reads them differently.
  function makeMats(THREE) {
    const M = (o) => new THREE.MeshStandardMaterial(o);
    return {
      paint:  M({ color: 0xe8e4da, roughness: 0.42, metalness: 0.12 }),   // bone-white satin
      // The lofted shells are open at the cab, so their inner surface is really
      // seen (through the glass, through the open slider). DoubleSide costs one
      // extra pass and saves the body from vanishing at grazing angles.
      paintShell: M({ color: 0xe8e4da, roughness: 0.42, metalness: 0.12, side: THREE.DoubleSide }),
      paintU: M({ color: 0xb9b5ac, roughness: 0.62, metalness: 0.10 }),   // shaded underside / door returns
      floor:  M({ color: 0x6d6a63, roughness: 0.88, metalness: 0.05 }),   // cargo floor + step well
      seam:   M({ color: 0x8e8a80, roughness: 0.70, metalness: 0.08 }),   // rub rail / panel-line grooves
      glass:  M({ color: 0x0e1620, roughness: 0.07, metalness: 0.86,
                  transparent: true, opacity: 0.78 }),                     // dark tint, blue-grey sheen
      rubber: M({ color: 0x121417, roughness: 0.96, metalness: 0.02 }),
      chrome: M({ color: 0xc6ccd4, roughness: 0.20, metalness: 1.00 }),
      steel:  M({ color: 0x9aa0a8, roughness: 0.45, metalness: 0.85 }),   // plain steel wheels
      black:  M({ color: 0x1a1d22, roughness: 0.72, metalness: 0.18 }),   // mirrors, trim, grille surround
      grille: M({ color: 0x0b0d10, roughness: 0.85, metalness: 0.25 }),
      amber:  M({ color: 0xff9c2e, roughness: 0.35, emissive: 0xff7a10, emissiveIntensity: 0.85 }),
      red:    M({ color: 0xd42a22, roughness: 0.35, emissive: 0x8e1008, emissiveIntensity: 0.7 }),
      lamp:   M({ color: 0xf2f4f6, roughness: 0.14, metalness: 0.30,
                  emissive: 0xfff0cc, emissiveIntensity: 0.45 }),
      cabin:  M({ color: 0x14161a, roughness: 0.95, metalness: 0.03 }),   // what you glimpse inside
      plate:  M({ color: 0xd8d2c2, roughness: 0.55, metalness: 0.2 }),    // the number plate itself
    };
  }

  // ─── 📐 Cross-section outline ───────────────────────────────────────────────
  // Returns RING_N [x, y] pairs walking the closed outline the SAME way every
  // time, so consecutive rings can be stitched into quads without bookkeeping.
  const TOP_N = 26, SIDE_N = 4, BOT_N = 6;

  function section(profile, hw, y0, yS, crown) {
    const p = [];
    // ── top: +x → −x, domed by `crown` ──
    for (let i = 0; i < TOP_N; i++) {
      const t = i / (TOP_N - 1);
      const x = hw * (1 - 2 * t);
      const u = Math.min(1, Math.abs(x) / hw);
      let y;
      if (profile === 'radius') {
        // Flat centre roof, then a big fillet rolling into the side wall.
        const flat = 0.62;                       // fraction of the width that is flat
        if (u <= flat) y = yS + crown;
        else {
          const k = (u - flat) / (1 - flat);     // 0 at the flat, 1 at the shoulder
          y = yS + crown * Math.sqrt(Math.max(0, 1 - k * k));
        }
      } else {
        // Superellipse: |x/hw|^n + |y/crown|^n = 1. Vertical slope at the
        // shoulder → the crown meets the side wall with no crease.
        const n = 2.7;
        y = yS + crown * Math.pow(Math.max(0, 1 - Math.pow(u, n)), 1 / n);
      }
      p.push([x, y]);
    }
    // ── left side wall, shoulder → floor ──
    for (let i = 1; i <= SIDE_N; i++) p.push([-hw, yS - (yS - y0) * (i / SIDE_N)]);
    // ── underside, −x → +x ──
    for (let i = 1; i < BOT_N; i++) p.push([-hw + 2 * hw * (i / BOT_N), y0]);
    p.push([hw, y0]);
    // ── right side wall, floor → shoulder ──
    for (let i = 1; i < SIDE_N; i++) p.push([hw, y0 + (yS - y0) * (i / SIDE_N)]);
    return p;
  }

  // ⚠ MEASURED, never hand-summed. This constant was once written as
  // TOP_N + SIDE_N*2 + BOT_N = 40, but section() emits 39: the right-hand wall
  // runs i=1..SIDE_N-1 because the ring closes back onto p[0]. loft() uses this
  // as its stride, so a single vertex of drift accumulated per station and the
  // final rings indexed past the end of the buffer. That ONE character was the
  // cause of every surface bug this mesh had: the moiré band down the cargo
  // side (which is why chasing coplanar trim and shadow bias never fixed it —
  // it vanished under FrontSide because it was torn winding, not z-fighting),
  // the black tear in the nose, the melted drapery over the bull-nose, and the
  // black wedge on the ground, which was a degenerate sliver running to the
  // origin. Derive it and it can never drift again.
  const RING_N = section('squircle', 1, 0, 1, 0).length;
  // Where the KERB-SIDE (+X) wall lives in that ring. section() walks
  // top → left wall → underside → right wall, so the +X wall is the tail of the
  // array: the [hw, y0] corner plus the SIDE_N-1 points climbing back to p[0].
  const WALL_R0 = TOP_N + SIDE_N + BOT_N - 1;      // the [hw, y0] corner
  // Door opening, in truck-local Z. Full side-wall height, as a walk-in van's
  // kerb door actually is.
  const DOOR = { z0: 1.74, z1: 2.66 };

  // ─── 🧵 Loft — stitch a run of rings into one welded shell ──────────────────
  // ⚠ WINDING MATTERS. section() walks the outline counter-clockwise as seen
  // from +Z, and the rings advance along +Z, so the OUTWARD face of a quad is
  // (a_i, a_j, b_j) / (a_i, b_j, b_i). Get this backwards and every face is
  // culled — the truck renders as a hollow trough you can see straight into.
  // `skip(zA, zB, i)` omits the quad between stations zA→zB at ring index i —
  // this is how the kerb-side door becomes a REAL hole in the skin rather than
  // a dark panel the body draws over.
  function loft(THREE, rings, capFirst, capLast, skip) {
    const pos = [], idx = [];
    for (const r of rings) for (const q of r.pts) pos.push(q[0], q[1], r.z);
    const N = RING_N;
    for (let s = 0; s < rings.length - 1; s++) {
      const a = s * N, b = (s + 1) * N;
      for (let i = 0; i < N; i++) {
        if (skip && skip(rings[s].z, rings[s + 1].z, i)) continue;
        const j = (i + 1) % N;
        idx.push(a + i, a + j, b + j);
        idx.push(a + i, b + j, b + i);
      }
    }
    // Flat caps as a triangle fan around the ring's centroid.
    const cap = (ring, base, front) => {
      let cx = 0, cy = 0;
      for (const q of ring.pts) { cx += q[0]; cy += q[1]; }
      cx /= N; cy /= N;
      const c = pos.length / 3;
      pos.push(cx, cy, ring.z);
      for (let i = 0; i < N; i++) {
        const j = (i + 1) % N;
        // front cap faces +Z (ring order is CCW from +Z); rear cap faces −Z.
        if (front) idx.push(c, base + i, base + j);
        else       idx.push(c, base + j, base + i);
      }
    };
    if (capFirst) cap(rings[0], 0, false);
    if (capLast)  cap(rings[rings.length - 1], (rings.length - 1) * N, true);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // ─── 🏗 The painted shell ───────────────────────────────────────────────────
  // Constant section down the cargo box, then the roof rounds DOWN and the body
  // pulls IN over the last stretch — that descent is the bull-nose.
  // The FRONT is deliberately left open: that hole is the windshield aperture,
  // filled below by the nose shell and above by glass. Capping it would weld a
  // white wall across the cab.
  function shell(THREE, mats, profile) {
    const st = [
      // z,              halfW,        shoulder,     crown
      [D.zRear,          D.halfW,      D.shoulderY,  D.crown],
      [D.zRear + 0.10,   D.halfW,      D.shoulderY,  D.crown],
      [D.zBulkhead,      D.halfW,      D.shoulderY,  D.crown],
      [DOOR.z0,          D.halfW,      D.shoulderY,  D.crown],
      [2.10,             D.halfW,      D.shoulderY,  D.crown],
      [DOOR.z1,          D.halfW,      D.shoulderY,  D.crown],
      [2.46,             D.halfW - 0.008, D.shoulderY - 0.025, D.crown - 0.012],
      [2.66,             D.halfW - 0.026, D.shoulderY - 0.080, D.crown - 0.040],
      [2.78,             D.halfW - 0.055, D.shoulderY - 0.160, D.crown - 0.080],
      [D.zHeader,        D.halfW - 0.090, D.shoulderY - 0.270, D.crown - 0.130],
    ];
    const rings = st.map(s => ({ z: s[0], pts: section(profile, s[1], D.floorY, s[2], s[3]) }));
    // 🚪 Cut the kerb-side door clean out of the skin. Everything behind it —
    // the step well, the tread, the grab handle — is then genuinely visible,
    // which no amount of dark panelling in front of an intact wall achieves.
    const cut = (zA, zB, i) =>
      i >= WALL_R0 && zA >= DOOR.z0 - 0.001 && zB <= DOOR.z1 + 0.001;
    const m = new THREE.Mesh(loft(THREE, rings, true, false, cut), mats.paintShell);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  // ─── 👃 The nose ────────────────────────────────────────────────────────────
  // A short second loft, flush against the body's front plane, spanning floor to
  // cowl height. It is what the windshield sits ON and what the grille, bumper
  // and headlamps hang off — and its rear cap quietly closes the bottom of the
  // body's front aperture.
  function noseShell(THREE, mats, profile) {
    const st = [
      [D.zHeader,        D.halfW - 0.020, D.cowlY - 0.11, 0.11],
      [D.zHeader + 0.18, D.halfW - 0.022, D.cowlY - 0.10, 0.11],
      [D.zCowl,          D.halfW - 0.035, D.cowlY - 0.12, 0.11],
      [D.zNose,          D.halfW - 0.070, D.cowlY - 0.21, 0.10],
      [D.zNose + 0.10,   D.halfW - 0.170, D.cowlY - 0.38, 0.08],
    ];
    const rings = st.map(s => ({ z: s[0], pts: section(profile, s[1], D.floorY - 0.10, s[2], s[3]) }));
    const m = new THREE.Mesh(loft(THREE, rings, true, true), mats.paintShell);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  // ── tiny helpers, in the shorthand the rest of this codebase uses ──
  const box = (THREE, g, w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
  };
  const cyl = (THREE, g, rt, rb, h, seg, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
    m.position.set(x, y, z); m.castShadow = true; g.add(m); return m;
  };

  // ─── 🧱 mergeBoxes — many boxes, ONE mesh, ONE draw call ────────────────────
  // This is a browser game, so a prop that costs 268 draw calls is a bug even
  // when it looks right. 76 arch-lip segments, 36 lug bolts, 16 roll-up ribs
  // and the grille slats are all the same material as each other and never
  // move independently — there is no reason for them to be separate meshes.
  // Each spec is { w, h, d, x, y, z, rx } (rx = rotation about X, the only axis
  // any of these need).
  function mergeBoxes(THREE, specs, mat, cast) {
    const pos = [], nor = [], idx = [];
    const V = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
    const F = [[0,3,2,1,0,0,-1],[4,5,6,7,0,0,1],[0,1,5,4,0,-1,0],[3,7,6,2,0,1,0],
               [0,4,7,3,-1,0,0],[1,2,6,5,1,0,0]];
    for (const s2 of specs) {
      const rx = s2.rx || 0, c = Math.cos(rx), si = Math.sin(rx);
      const base = pos.length / 3;
      for (const f of F) {
        const b = pos.length / 3;
        for (let k = 0; k < 4; k++) {
          const v = V[f[k]];
          let x = v[0] * s2.w / 2, y = v[1] * s2.h / 2, z = v[2] * s2.d / 2;
          const y2 = y * c - z * si, z2 = y * si + z * c;
          pos.push(x + s2.x, y2 + s2.y, z2 + s2.z);
          const ny = f[5] * c - f[6] * si, nz = f[5] * si + f[6] * c;
          nor.push(f[4], ny, nz);
        }
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, mat);
    if (cast !== false) { m.castShadow = true; m.receiveShadow = true; }
    return m;
  }

  // ─── 🛞 Wheel — steel rim, modest hubcap, chunky sidewall ───────────────────
  function wheel(THREE, mats, x, z) {
    const g = new THREE.Group();
    const t = cyl(THREE, g, D.wheelR, D.wheelR, D.wheelW, 26, mats.rubber, 0, 0, 0);
    t.rotation.z = Math.PI / 2;
    // Sidewall shoulders, so the tyre is not a bare cylinder.
    [-1, 1].forEach(s => {
      const w = cyl(THREE, g, D.wheelR - 0.05, D.wheelR - 0.05, 0.03, 24, mats.rubber, s * D.wheelW * 0.52, 0, 0);
      w.rotation.z = Math.PI / 2;
    });
    const rim = cyl(THREE, g, D.wheelR * 0.60, D.wheelR * 0.60, D.wheelW * 0.55, 22, mats.steel, 0, 0, 0);
    rim.rotation.z = Math.PI / 2;
    const cap = cyl(THREE, g, D.wheelR * 0.36, D.wheelR * 0.40, 0.05, 20, mats.chrome, D.wheelW * 0.50, 0, 0);
    cap.rotation.z = Math.PI / 2;
    // Lug ring — reads at a glance, and as ONE mesh it costs almost nothing.
    const lugs = [];
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      lugs.push({ w: 0.034, h: 0.042, d: 0.042, x: D.wheelW * 0.54,
        y: Math.sin(a) * D.wheelR * 0.24, z: Math.cos(a) * D.wheelR * 0.24, rx: a });
    }
    g.add(mergeBoxes(THREE, lugs, mats.chrome));
    g.position.set(x, D.wheelR, z);
    return g;
  }

  // ─── 🔩 Wheel arch — a FLUSH cut-out in the slab side ───────────────────────
  // In the reference the side wall is essentially uninterrupted: the arch is a
  // dark opening with barely a lip, not a raised feature. An earlier build hung
  // a thin white croquet hoop off the body with a visible gap to the tyre and
  // square-cut legs floating below the body line — the loudest wrong note in
  // the silhouette. Now: a dark recess sitting flush on the skin, and a lip so
  // shallow (12 mm) it reads as the cut edge of the panel rather than a fender.
  function arch(THREE, mats, side, z, wide) {
    const g = new THREE.Group();
    const r = D.wheelR + 0.11, lip = 0.012;
    const rec = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, 0.016, 24, 1, false, 0, Math.PI), mats.rubber);
    rec.position.set(side * (D.halfW + 0.006), D.wheelR, z);
    rec.rotation.z = Math.PI / 2;
    g.add(rec);
    // The cut edge: a thin ring, body-coloured, hugging the opening — one mesh.
    const segs = [];
    for (let i = 0; i <= 20; i++) {
      const a = Math.PI * (i / 20);
      segs.push({ w: lip, h: 0.030, d: 0.082,
        x: side * (D.halfW + lip / 2 + 0.009),
        y: D.wheelR + Math.sin(a) * r, z: z + Math.cos(a) * r,
        rx: -a + Math.PI / 2 });
    }
    g.add(mergeBoxes(THREE, segs, mats.paintU));
    return g;
  }

  // ─── 🔦 Headlamp cluster — DUAL round lamps in a rounded-rect housing ───────
  function headlamps(THREE, mats, side, nz) {
    const g = new THREE.Group();
    const hx = side * 0.66;
    const hs = box(THREE, g, 0.50, 0.27, 0.09, mats.black, hx, 1.08, nz - 0.030);
    hs.rotation.x = -0.10;
    [-0.115, 0.115].forEach(o => {
      const bowl = cyl(THREE, g, 0.098, 0.088, 0.05, 18, mats.chrome, hx + o, 1.08, nz + 0.012);
      bowl.rotation.x = Math.PI / 2 - 0.10;
      const lens = cyl(THREE, g, 0.084, 0.084, 0.022, 18, mats.lamp, hx + o, 1.08, nz + 0.034);
      lens.rotation.x = Math.PI / 2 - 0.10;
    });
    // Amber turn signal, outboard of the lamps.
    const ts = box(THREE, g, 0.15, 0.11, 0.055, mats.amber, side * 0.845, 1.08, nz + 0.005);
    ts.rotation.x = -0.10;
    return g;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILD
  // ═══════════════════════════════════════════════════════════════════════════
  function build(THREE, opts) {
    opts = opts || {};
    const profile = opts.profile === 'radius' ? 'radius' : 'squircle';
    const doorOpen = opts.doorOpen !== false;      // curb-side slider stands open
    const mats = makeMats(THREE);
    const T = new THREE.Group();
    T.userData.mats = mats;

    T.add(shell(THREE, mats, profile));
    T.add(noseShell(THREE, mats, profile));

    // ── cargo interior — a real floor, liner walls and a cab bulkhead, so the
    //    open slider reveals somewhere goods could actually go ───────────────
    box(THREE, T, 2.02, 0.06, 4.42, mats.floor, 0, D.floorY + 0.06, -0.62);       // deck
    [-1, 1].forEach(s => box(THREE, T, 0.05, 1.95, 4.42, mats.paintU, s * 0.99, D.floorY + 1.05, -0.62));
    box(THREE, T, 2.02, 1.95, 0.06, mats.paintU, 0, D.floorY + 1.05, D.zBulkhead - 0.04);  // bulkhead
    box(THREE, T, 1.90, 0.05, 1.30, mats.floor, 0, D.floorY + 0.05, 2.28);        // cab floor
    // Cab liners. The kerb side is SPLIT fore and aft of the slider so the liner
    // never paints itself across the doorway; the street side is continuous. A
    // headliner closes the top. Without these you look straight through the
    // tinted screen and out the far side of the truck, which no real cab does.
    box(THREE, T, 0.05, 1.62, 1.26, mats.paintU, -0.99, D.floorY + 0.90, 2.28);
    box(THREE, T, 0.05, 1.62, 0.12, mats.paintU,  0.99, D.floorY + 0.90, 1.68);
    box(THREE, T, 0.05, 1.62, 0.16, mats.paintU,  0.99, D.floorY + 0.90, 2.76);
    box(THREE, T, 2.00, 0.05, 1.30, mats.paintU, 0, D.shoulderY - 0.28, 2.24);

    // ── side detailing ───────────────────────────────────────────────────────
    // ⚠ Z-FIGHTING: trim that STRADDLES the shell surface shimmers into a dotted
    // moiré band the length of the truck. Every strip below is offset so its
    // INNER face clears the shell by ~4 mm — proud trim, never coplanar trim.
    const proud = (t) => D.halfW + t / 2 + 0.004;
    [-1, 1].forEach(side => {
      // Horizontal rub rail, about a third of the way up the side.
      // ONE strip, not two. An earlier build stacked a thin black strip on the
      // rail whose slab overlapped the rail's own — 9 mm of shared volume, which
      // is exactly how you manufacture a dotted moire band 5 m long.
      box(THREE, T, 0.030, 0.070, 4.30, mats.seam,  side * proud(0.030), 1.60, -0.78);
      box(THREE, T, 0.034, 0.022, 4.30, mats.black, side * (proud(0.030) + 0.026), 1.60, -0.78);
      // Vertical panel line where the cab meets the cargo box.
      box(THREE, T, 0.022, 1.82, 0.030, mats.seam, side * proud(0.022), 1.80, D.zBulkhead);
      // Lower body seam, so the side is not one dead slab.
      box(THREE, T, 0.018, 0.032, 6.10, mats.seam, side * proud(0.018), 0.96, -0.10);
      T.add(arch(THREE, mats, side, D.zAxleF, false));
      T.add(arch(THREE, mats, side, D.zAxleR, true));
    });

    // ── roof furniture: two raised rectangular vents/hatches ────────────────
    // Kept narrow and sunk into the crown — a wide flat box perched on a domed
    // roof floats at its corners and instantly reads as a mistake.
    [-0.95, 0.62].forEach(z => {
      const v = box(THREE, T, 0.60, 0.12, 0.52, mats.paintU, 0, D.shoulderY + D.crown - 0.05, z);
      box(THREE, T, 0.50, 0.04, 0.42, mats.black, 0, D.shoulderY + D.crown + 0.02, z);
      v.receiveShadow = true;
    });

    // ── cab: windshield, pillars, marker lights, mirrors ─────────────────────
    // The shell's last ring gives us the exact header height — never guess it,
    // or the glass floats off the bodywork.
    const hdrHW = D.halfW - 0.090;
    const hdrY  = D.shoulderY - 0.270 + (D.crown - 0.130) * 0.55;
    const wsH   = Math.hypot(D.zCowl - D.zHeader, hdrY - D.cowlY);
    // ⚠ SIGN: the windshield's TOP is REARWARD of its bottom (a raked screen), so
    // the panel's local +Y must tip toward −Z — that is rotation.x = −rake.
    const wsRk  = -Math.atan2(D.zCowl - D.zHeader, hdrY - D.cowlY);
    const wsY   = (hdrY + D.cowlY) / 2, wsZ = (D.zHeader + D.zCowl) / 2;

    // Two panes split by a centre post — a step van never has one-piece glass.
    [-1, 1].forEach(s => {
      const pane = new THREE.Mesh(new THREE.BoxGeometry(hdrHW - 0.13, wsH - 0.06, 0.030), mats.glass);
      pane.position.set(s * (hdrHW / 2 + 0.02), wsY, wsZ);
      pane.rotation.x = wsRk;
      T.add(pane);
    });
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.070, wsH, 0.060), mats.paint);
    post.position.set(0, wsY, wsZ + 0.012);
    post.rotation.x = wsRk; post.castShadow = true; T.add(post);
    // A-pillars closing the glass off at the body sides.
    [-1, 1].forEach(s => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.095, wsH + 0.10, 0.095), mats.paint);
      p.position.set(s * (hdrHW - 0.035), wsY, wsZ + 0.008);
      p.rotation.x = wsRk; p.castShadow = true; T.add(p);
    });
    // Header panel above the glass + the row of 5 amber cab markers.
    const hdr = box(THREE, T, hdrHW * 2 - 0.02, 0.15, 0.15, mats.paint, 0, hdrY - 0.03, D.zHeader + 0.02);
    hdr.rotation.x = wsRk;
    const mk = [];
    for (let i = 0; i < 5; i++) mk.push({ w: 0.080, h: 0.055, d: 0.070,
      x: (i - 2) * 0.33, y: hdrY + 0.035, z: D.zHeader + 0.045, rx: -0.30 });
    T.add(mergeBoxes(THREE, mk, mats.amber));
    // Upper-nose corner markers, on the shoulder of the nose shell.
    [-1, 1].forEach(s => box(THREE, T, 0.075, 0.05, 0.07, mats.amber, s * 0.83, D.cowlY - 0.10, D.zCowl + 0.08));

    // Cabin interior — a seat, a wheel and a dash, just visible through the tint.
    const cab = new THREE.Group();
    box(THREE, cab, 0.52, 0.10, 0.50, mats.cabin, -0.44, 1.02, 2.50);          // seat pan
    const bk = box(THREE, cab, 0.52, 0.62, 0.10, mats.cabin, -0.44, 1.36, 2.28); bk.rotation.x = 0.14;
    const sw = cyl(THREE, cab, 0.19, 0.19, 0.035, 20, mats.black, -0.44, 1.32, 2.80);
    sw.rotation.x = Math.PI / 2 - 0.55;
    const col = cyl(THREE, cab, 0.045, 0.045, 0.34, 10, mats.black, -0.44, 1.20, 2.70);
    col.rotation.x = Math.PI / 2 - 0.55;
    box(THREE, cab, 1.80, 0.13, 0.42, mats.cabin, 0, 1.44, 2.98);              // dash
    T.add(cab);

    // West Coast mirrors — big black dual-arm, both sides. The arms run OUTBOARD
    // in X from the A-pillar to the head; run them along Z and they hang in mid
    // air attached to nothing.
    [-1, 1].forEach(s => {
      const g = new THREE.Group();
      const reach = 0.34;
      box(THREE, g, 0.070, 0.74, 0.23, mats.black, s * reach, 0, 0);
      box(THREE, g, 0.018, 0.68, 0.20, mats.glass, s * (reach + 0.042), 0, 0.004);
      [-0.26, 0.26].forEach(dy => {
        const arm = cyl(THREE, g, 0.026, 0.026, reach, 8, mats.black, s * reach / 2, dy, 0.01);
        arm.rotation.z = Math.PI / 2;
      });
      g.position.set(s * (hdrHW - 0.02), 1.94, D.zHeader - 0.05);
      T.add(g);
    });

    // ── nose furniture: cowl seam, recessed grille, bumper, plate recess ─────
    // ⚠ RE-SEATED for round 6. These Z positions were tuned against a nose that
    // was lofting too thin because of the RING_N stride bug; with the stitching
    // fixed the nose sits FATTER and swallowed the grille whole. The front face
    // of the nose shell is at zNose + 0.10, so everything here hangs off that
    // plane rather than off zNose.
    const nz = D.zNose + 0.10;                       // the nose's front face
    box(THREE, T, 1.90, 0.05, 0.07, mats.seam, 0, D.cowlY - 0.075, D.zCowl - 0.04);  // cowl seam
    // Recessed dark grille: LOW, CENTRED and clearly narrower than the nose, a
    // distinct rectangle rather than a full-width letterbox merged with the lamps.
    box(THREE, T, 0.92, 0.34, 0.09, mats.black,  0, 0.99, nz - 0.035);
    box(THREE, T, 0.80, 0.26, 0.05, mats.grille, 0, 0.99, nz + 0.010);
    const slats = [];
    for (let i = 0; i < 5; i++) slats.push({ w: 0.76, h: 0.020, d: 0.026, x: 0, y: 0.90 + i * 0.045, z: nz + 0.026 });
    T.add(mergeBoxes(THREE, slats, mats.black));
    [-1, 1].forEach(sd => T.add(headlamps(THREE, mats, sd, nz)));
    // Bumper stands PROUD of the nose face, with a legible plate recess.
    box(THREE, T, 2.02, 0.28, 0.22, mats.paint, 0, 0.76, nz + 0.10);
    box(THREE, T, 2.06, 0.05, 0.07, mats.seam,  0, 0.865, nz + 0.12);
    box(THREE, T, 0.58, 0.26, 0.06, mats.black, 0, 0.74, nz + 0.21);
    box(THREE, T, 0.46, 0.16, 0.02, mats.plate, 0, 0.74, nz + 0.245);
    [-1, 1].forEach(sd => box(THREE, T, 0.10, 0.26, 0.14, mats.black, sd * 0.86, 0.58, nz + 0.04));

    // ── curb-side sliding door, standing OPEN ───────────────────────────────
    // A real opening in the side: a dark doorway, a recessed step well you can
    // see down into, a grab handle, and the slid-back door panel itself.
    // The opening is a genuine hole in the skin (see shell()'s `cut`), so the
    // cavity behind it is simply built and simply seen: a back wall, returns,
    // a ceiling, and a step well you can look down into. No proud slab, no
    // painted-on rectangle, no z-fighting — because nothing is fighting.
    const dz = (DOOR.z0 + DOOR.z1) / 2, dw = DOOR.z1 - DOOR.z0;
    const dyB = D.floorY, dyT = D.shoulderY, dh = dyT - dyB, dyc = (dyB + dyT) / 2;
    const dx = D.halfW, rear = dx - 0.68;          // how deep the cavity runs
    const doorway = new THREE.Group();
    box(THREE, doorway, 0.04, dh, dw, mats.cabin, rear, dyc, dz);                       // back wall
    box(THREE, doorway, dx - rear, dh, 0.04, mats.paintU, (dx + rear) / 2, dyc, dz - dw / 2 + 0.02);
    box(THREE, doorway, dx - rear, dh, 0.04, mats.paintU, (dx + rear) / 2, dyc, dz + dw / 2 - 0.02);
    box(THREE, doorway, dx - rear, 0.04, dw, mats.paintU, (dx + rear) / 2, dyT - 0.02, dz);  // ceiling
    // Step well — a lower tread, visible THROUGH the opening, plus the sill.
    box(THREE, doorway, dx - rear, 0.06, dw - 0.06, mats.floor, (dx + rear) / 2, dyB + 0.20, dz);
    box(THREE, doorway, dx - rear - 0.16, 0.06, dw - 0.18, mats.floor, (dx + rear) / 2 + 0.06, dyB - 0.20, dz);
    box(THREE, doorway, dx - rear - 0.16, 0.40, 0.04, mats.black, (dx + rear) / 2 + 0.06, dyB, dz + dw / 2 - 0.11);
    box(THREE, doorway, dx - rear - 0.16, 0.40, 0.04, mats.black, (dx + rear) / 2 + 0.06, dyB, dz - dw / 2 + 0.11);
    cyl(THREE, doorway, 0.020, 0.020, 1.15, 8, mats.chrome, dx - 0.16, dyB + 1.05, dz - dw / 2 + 0.12);
    // A shallow returned edge around the cut, so the skin reads as folded metal
    // rather than a laser slice through paper.
    const fx = dx + 0.020;
    box(THREE, doorway, 0.042, dh + 0.06, 0.055, mats.paint, fx, dyc, dz + dw / 2 + 0.026);
    box(THREE, doorway, 0.042, dh + 0.06, 0.055, mats.paint, fx, dyc, dz - dw / 2 - 0.026);
    box(THREE, doorway, 0.042, 0.060, dw + 0.11, mats.paint, fx, dyT + 0.028, dz);
    box(THREE, doorway, 0.042, 0.060, dw + 0.11, mats.paint, fx, dyB - 0.028, dz);
    T.add(doorway);
    if (doorOpen) {
      // The door panel slid back along the body — window in its upper half.
      const p = new THREE.Group();
      box(THREE, p, 0.045, dh - 0.06, dw - 0.05, mats.paint, 0, 0, 0);
      box(THREE, p, 0.024, 0.70, dw - 0.24, mats.glass, 0.018, dh * 0.24, 0);
      box(THREE, p, 0.034, 0.042, dw - 0.20, mats.seam, 0.009, dh * 0.24 - 0.40, 0);
      cyl(THREE, p, 0.016, 0.016, 0.20, 8, mats.chrome, 0.034, -0.16, dw / 2 - 0.16).rotation.x = Math.PI / 2;
      p.position.set(fx + 0.048, dyc, dz - dw - 0.09);
      p.castShadow = true; T.add(p);
      box(THREE, T, 0.042, 0.05, dw * 2.2, mats.black, fx + 0.044, dyT + 0.09, dz - dw * 0.60);
    }

    // ── rear: ribbed roll-up door, step bumper, twin round tail lamps ────────
    const rz = D.zRear - 0.03;
    box(THREE, T, 1.86, 1.98, 0.05, mats.paintU, 0, 1.86, rz - 0.02);
    const ribs = [];
    for (let i = 0; i < 16; i++) ribs.push({ w: 1.84, h: 0.075, d: 0.045, x: 0, y: 0.95 + i * 0.118, z: rz - 0.05 });
    T.add(mergeBoxes(THREE, ribs, mats.seam));
    box(THREE, T, 0.42, 0.09, 0.06, mats.chrome, 0, 0.90, rz - 0.06);            // pull strap bar
    box(THREE, T, 1.70, 0.16, 0.26, mats.black, 0, 0.62, rz - 0.14);             // step bumper
    box(THREE, T, 1.74, 0.05, 0.05, mats.chrome, 0, 0.70, rz - 0.26);
    [-1, 1].forEach(s => [0, 1].forEach(i => {
      const l = cyl(THREE, T, 0.072, 0.072, 0.05, 14, i ? mats.amber : mats.red,
        s * 0.74, 1.10 + i * 0.20, rz - 0.06);
      l.rotation.x = Math.PI / 2;
    }));

    // ── chassis: frame rails, fuel tank, mud flaps ──────────────────────────
    [-1, 1].forEach(s => box(THREE, T, 0.12, 0.16, 5.7, mats.black, s * 0.52, D.floorY - 0.14, -0.10));
    // Tucked INSIDE the body line — at x -0.86 with a 0.40 half-length it used
    // to poke 0.21 m through the street-side wall and read as a white drum
    // bolted to the outside of the truck.
    const tank = cyl(THREE, T, 0.22, 0.22, 0.62, 16, mats.steel, -0.62, 0.66, 0.30);
    tank.rotation.z = Math.PI / 2;
    [-1, 1].forEach(s => box(THREE, T, 0.02, 0.34, 0.30, mats.rubber, s * 0.92, 0.24, D.zAxleR - 0.70));

    // ── wheels: 6 total, DUAL rears ─────────────────────────────────────────
    // The rear pair is tucked IN so the outer tyre finishes just inside the body
    // line — duals hanging proud of the sides read as a monster truck.
    [-1, 1].forEach(s => {
      T.add(wheel(THREE, mats, s * (D.halfW - 0.19), D.zAxleF));
      T.add(wheel(THREE, mats, s * (D.halfW - 0.33 - D.dualGap / 2), D.zAxleR));
      T.add(wheel(THREE, mats, s * (D.halfW - 0.33 + D.dualGap / 2), D.zAxleR));
    });
    // Axle tubes, so the truck is not floating on disconnected tyres.
    [D.zAxleF, D.zAxleR].forEach(z => {
      const a = cyl(THREE, T, 0.075, 0.075, 1.86, 10, mats.black, 0, D.wheelR, z);
      a.rotation.z = Math.PI / 2;
    });

    // ── contact shadow ─────────────────────────────────────────────────────
    // Left to the SHADOW MAP on purpose. An earlier build stacked a baked
    // radial-gradient plane under the truck for extra weight; because three
    // draws every transparent mesh after the opaque pass, that plane punched a
    // hard black wedge through the ground at grazing angles. A correctly biased
    // shadow map gives the real contact shadow and never does that — callers
    // must enable renderer.shadowMap and set light.shadow.normalBias, see
    // WHTruck.SHADOW_HINT.

    T.userData.dims = D;
    return T;
  }

  // Shadow settings this mesh is authored against. Flat slab sides nearly
  // parallel to the key light stripe themselves with acne unless normalBias is
  // generous; these are the values the reference renders were judged at.
  const SHADOW_HINT = { bias: -0.0002, normalBias: 0.06, mapSize: 2048 };

  root.WHTruck = { build: build, DIMS: D, SHADOW_HINT: SHADOW_HINT };
})(typeof window !== 'undefined' ? window : this);
