/* ════════════════════════════════════════════════════════════════════════════
   🌊 THE OCEAN — every number this module uses, in one table.
   ----------------------------------------------------------------------------
   The `_opEcon()` pattern from CLAUDE.md, the same shape /src/water's WATER,
   /src/power's POWER and /src/economy's ECON already are: nothing in
   ocean/index.js writes a literal, so a look pass is one file.

   🔴 THE NUMBERS THAT ARE NOT OURS TO OWN, AND THERE ARE THREE SETS.

   1. WHERE THE WATERLINE IS. It is `WATER.sea` + endowment.js's `shoreXAt()`,
      reached through `MythicWater.endowment().sea.shoreAt(z)`. It is NOT here
      and must never be copied here. /src/water decides whether a tile has the
      sea to draw from; this module decides what that looks like. If the two
      held separate opinions the player would eventually stand on a beach the
      simulation calls inland — and unlike most desyncs, that one is on screen.

   2. WHERE THE HIGHWAY AND THE RAIL ARE. Imported from /src/outside/tuning.js.
      The plain is already spoken for north and south: HW.z = −18.8 with a
      12.0-wide embankment (toe at −12.8) and RAIL.z = +18.8 with a 5.2-wide one
      (toe at +16.2). The sea's z band is DERIVED from those two toes, so if
      either corridor ever moves the water moves with it instead of drowning it.

   3. THE PLATE'S SURFACE AND TONE. NC_TERRAIN_AT / NC_GROUND_AT, handed over in
      the ctx exactly as /src/wild takes them. The shore feather lerps the
      water's rim to the ground's OWN colour so the waterline dissolves rather
      than drawing a hard line, which is the same trick /src/wild's flat writer
      uses on a scuff of bare earth and for the same reason.
   ════════════════════════════════════════════════════════════════════════════ */

export const OCEAN = {

  /* ── 📐 EXTENT ────────────────────────────────────────────────────────────
     The sea runs from the waterline out to `far`, and from the highway's toe to
     the rail's toe. Both z limits are computed in index.js from /src/outside's
     own constants; the two margins below are all this file contributes. */
  extent: {
    /* Clearance kept from each earthwork's toe, in world units. Small on
       purpose: the point is that the water stops just short of the embankment,
       so the highway reads as a coast road rather than as a causeway. */
    marginHighway: 0.35,
    marginRail: 0.35,
    /* How far out to sea the mesh runs. The surrounding `ground` plain is
       GRID+208 = 232 across (±116) and camera.far is 220, so 108 dies inside the
       plain in every direction and the far edge is never a silhouette against
       the sky. `scene.fog` reaches its far stop at 34 on the `medium` tier and
       70 on `high`, so this edge is unreachable by eye on every tier. */
    far: 108,
    /* ⚠ THE ONE HEIGHT IN THE FILE, AND IT IS PICKED AGAINST A LIST.
       node-city's y-stack at ground level is crowded and every entry in it is a
       flat plane over the same square metres:
             plate apron floor  −0.014      `ground` plain      −0.020
             gridHelper          0.0145     RD_Y (road/apron)    0.016
             hover highlight     0.020      /src/power overlay   0.060
             /src/water overlay  0.075      /src/water mains     0.088
       0.035 is the widest gap in that stack: 15 mm clear of the hover plane
       below it and 25 mm clear of the power overlay above. It is also 55 mm
       ABOVE the plain, which is what lets the sea HIDE the plain it covers
       instead of fighting it — and the 55 mm step at the waterline is what the
       shore feather below exists to dissolve.
       🔴 NONE OF THIS MATTERS FOR THE PLATE, because the waterline can never
          come inside HALF + 1.75 (see WATER.sea.inset) and the plate ends at
          HALF. The sea never overlaps a buildable tile, a grid line, a road
          apron or a building's own ground — which is the whole reason this
          round did not have to touch tryPlace() or invalidate a single save. */
    y: 0.035,
  },

  /* ── 🔺 TESSELLATION ──────────────────────────────────────────────────────
     ONE mesh. The lattice is SWEPT along the shoreline rather than laid on a
     rectangle: every row starts exactly at the waterline for its own z, so the
     coast is the geometry's own edge and needs no mask, no alpha and no second
     surface. Rows are the resolution of the coast; columns only carry the
     depth gradient out to sea.
     ⚠ `rows` IS SET AGAINST THE FINE WOBBLE, NOT AGAINST TASTE. The shoreline's
       fast term has a 6.5-tile period (WATER.sea.wavePeriodFine) and the band is
       ~28 units, so 128 rows is ~29 samples per cycle — a smooth coast with the
       headlands intact. Halving it visibly polygonises the bays.
     ⚠ COLUMNS ARE POWER-SPACED (`columnBias`) so the near water carries the
       resolution and the far water — which is fog — costs almost nothing. */
  mesh: {
    rows: 128,
    cols: 16,
    columnBias: 2.6,
  },

  /* ── 🎨 THE WATER ─────────────────────────────────────────────────────────
     Authored in sRGB and read through THREE.Color, which converts sRGB → linear.
     🔴 A LITERAL {r,g,b} WOULD NOT BE CONVERTED and renders pale — the trap
        .gauntlet/README.md records as having cost a whole round, and which
        /src/wild's palette note repeats for the same reason. */
  col: {
    shallow: 0x4f95a0,   // the bar, where the ground shows through
    mid:     0x235469,
    deep:    0x102b3d,
    /* How far out, in world units, the colour reaches `deep`.
       🐞 IT WAS 9.0 AND THE WATER PHOTOGRAPHED AS ONE PALE CYAN SHEET. The
          reasoning behind 9.0 was "put the whole gradient inside the first
          third of the visible water", and the visible water is not what that
          sentence assumed: from the default camera the sea is only unfogged
          between about 21 and 29 units out, which on the ground is a band
          roughly 13.8 → 20 in x. A 9.0 ramp reaches t = 0.7 at the FAR end of
          that band, so every pixel the player can actually see was drawn from
          the shallow half of the ramp — a sea with a bar and no sea in it.
          5.5 puts `deep` at x ≈ 19.3, i.e. inside the visible band and inside
          the fog's near stop, so the shot contains the beach, the bar and open
          water. Everything past it was already haze at either value. */
    deepAt: 5.5,
  },

  /* ── 🏖 THE EDGES ─────────────────────────────────────────────────────────
     Three feathers, all of them the SAME idea /src/wild's flat writer states in
     full: a shape whose rim is the colour of the ground under it has a centre
     and no border, and Gouraud interpolates the difference away before the
     boundary is reached. Anything else here draws a hard line, and a hard line
     is the "board edge" read this whole line of work exists to erase. */
  shore: {
    /* The wet sand / surf band at the waterline, in world units. */
    width: 0.62,
    /* …and how strongly its innermost vertex is pulled to the ground's own tone.
       Not 1.0: a waterline that reaches the ground colour exactly makes the
       first 620 mm of sea invisible and the coast then appears to start further
       out than the simulation says it does. */
    blend: 0.86,
    /* Curve on the pull. >1 keeps the water water for most of the band and
       spends the fade in the last few centimetres, which is what a wet bar of
       sand actually looks like from 20 units up. */
    exp: 1.5,
  },
  /* The north and south ends, where the sea meets the plain against the two
     earthworks. Wider than the shore feather because there is no geographic
     feature there to justify an edge — it is the mesh running out — so it has
     to become the plain before anyone can see it stop.
     ⚠ 3.4 IS ALSO FOG-ASSISTED AND THAT IS NOT AN EXCUSE FOR IT. From the
       default camera the nearer of the two ends sits ~31 units out, i.e. ~68%
       haze on the `medium` tier. The feather is what makes it right at every
       OTHER camera the player owns, including the fully zoomed-out one. */
  ends: { feather: 3.4, blend: 0.92 },

  /* ── 🪞 THE MATERIAL ──────────────────────────────────────────────────────
     ONE MeshStandardMaterial, and deliberately NOT a MeshPhysicalMaterial.
     🚫 REJECTED: transmission / thickness / iridescence. Nothing in node-city's
        41k lines uses a physical material today, so the first one would add a
        whole shader permutation and a per-fragment cost class to a scene whose
        own budget notes are written in draw calls. Water this far from the
        camera is a REFLECTION and a COLOUR; refraction of a dead-flat seabed
        3.5 cm below the surface has nothing to show.
     🪞 THE REFLECTION IS FREE AND IT IS NOT `scene.environment`. node-city's own
        note at THE SKY ENVIRONMENT MAP is explicit that `scene.environment` is
        NOT set, on cost grounds — an IBL sample on every fragment of every
        standard material. Materials opt IN through `skyEnvRegister(mat, k)`,
        which repoints them at a 336x64 cubeUV PMREM rebuilt from the LIVE sky:
        scene.background, scene.fog.color, LAND_HAZE × hemi and the sun lobe. So
        the sea reflects the weather, the hour and the storm for the cost of one
        more material in a list. */
  mat: {
    roughness: 0.15,
    /* A touch of metalness, because a dielectric at F0 = 0.04 reflects almost
       nothing at the ~50° incidence the default camera looks at the sea from,
       and the whole argument for registering the sky is that the reflection is
       what makes it read as water. 0.10 keeps the base colour dominant. */
    metalness: 0.10,
    envIntensity: 1.00,
    /* The ripple normal map, generated once (no texture file, no network). One
       128px tileable canvas of summed gratings; `period` is its world size. */
    ripplePx: 128,
    /* 🐞 THE PERIOD WAS 6.4 AND THE FIRST CAPTURE CAME BACK WITH A MIRROR.
       The sea sits 21–29 units from the default camera and fills ~36,000 px, so
       a 6.4-unit swell is about 60 px of screen per wave — four or five waves
       across the whole body of water, i.e. a slow undulation the eye reads as a
       flat surface with a gradient on it. 4.6 puts ~8 across the visible band,
       which is chop. Anything under ~3 turns to aliasing noise at this
       distance, which is worse than flat because it sparkles when the camera
       moves. */
    ripplePeriod: 4.6,
    rippleAmp: 0.42,
    /* ⚠ NOT `NC_GRAIN_PER`. The plate's grain period (3.71) is a LAND texture's
       period and the two must not be locked together — the moment they are, a
       retune of the ground's grain moves the size of the sea's chop. */
    normalScale: 0.78,
    /* How fast the ripple drifts, in world units per second. Slow: the sea is
       20+ units away and anything faster reads as a scrolling texture, which is
       exactly what it is and exactly what must not be visible. */
    driftX: 0.055,
    driftZ: 0.021,
  },
};

/* Read an OCEAN path with a loud failure instead of `undefined` arithmetic —
   the same accessor /src/water's `wt()` and /src/power's `pw()` are. A mistyped
   path is a bug that should surface at the call site, not become NaN four
   frames later on somebody's coastline. */
export function oc(path, fallback) {
  let cur = OCEAN;
  for (const seg of String(path).split('.')) {
    if (cur == null || typeof cur !== 'object' || !(seg in cur)) {
      if (fallback !== undefined) return fallback;
      try { console.warn('[ocean] no tuning at OCEAN.' + path); } catch (e) {}
      return fallback;
    }
    cur = cur[seg];
  }
  return cur;
}

export default { OCEAN, oc };
