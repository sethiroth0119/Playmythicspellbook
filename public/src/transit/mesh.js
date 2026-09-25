/* ══════════════════════════════════════════════════════════════════════════
   🚌 TRANSIT — THE MESH RECIPES.
   ──────────────────────────────────────────────────────────────────────────
   🔴 THE GLOBALS TRAP (CLAUDE.md). `box`, `cyl`, `MAT`, `winMat`, `lampMat`
   and `THREE` are top-level `const`/`function` inside node-city's module
   script — lexical bindings, NOT window properties. Every one of them arrives
   here in the ctx object node-city hands over at mount. Nothing in this file
   reaches for a bare global.

   ⚠ EVERY primitive goes through the handed-over box()/cyl(). That is not
     style: those two stamp `geometry.userData.owned`, which is the ONLY thing
     that makes disposeOwnedGeo()/despawnAgent() able to free these buffers.
     A `new THREE.Mesh(new THREE.BoxGeometry(...))` written here would leak a
     buffer per demolish and per despawn, forever — the exact bug node-city's
     dropTileMesh header records paying for twice.

   🎯 THE BAR asks for bus shelters by name ("Street furniture … benches, bus
   shelters"), for canopies and signage on transport buildings, and for roof
   clutter on anything industrial. So: the stop is a real shelter (glazed back,
   cantilever roof, bench, flag pole with a route blade), the station has a
   platform + canopy on columns + a signboard + a clock, and the depot has
   roller doors, a hazard apron and roof plant.
   ══════════════════════════════════════════════════════════════════════════ */

let C = null;                       // the ctx, set by init()
const _lineMats = new Map();        // colour → material. Bounded to LINE_COLORS.

export function init(ctx) { C = ctx; }

/* A material in a line's colour, cached. Materials are not geometry and are
   never stamped/freed — caching by colour bounds the set to the palette. */
export function lineMat(hex) {
  const k = hex >>> 0;
  let m = _lineMats.get(k);
  if (!m) {
    m = new C.THREE.MeshStandardMaterial({ color: k, roughness: .55, metalness: .1 });
    _lineMats.set(k, m);
  }
  return m;
}
/* The same colour as a flat, unlit plate — for the map overlay, which must read
   at city zoom in every light condition and must not pick up the night grade. */
export function lineFlatMat(hex) {
  const k = (hex >>> 0) | 0x1000000;      // separate cache key from lineMat
  let m = _lineMats.get(k);
  if (!m) {
    m = new C.THREE.MeshBasicMaterial({ color: hex >>> 0, transparent: true, opacity: .66 });
    _lineMats.set(k, m);
  }
  return m;
}

/* ── 🚏 THE BUS STOP ──────────────────────────────────────────────────────
   Small, and it has to stay small: it sits on a 1x1 plot beside a road and a
   shelter that fills its tile would read as a building. ~15 meshes. */
export function makeBusstop(lvl) {
  const { THREE, box, cyl, MAT, winMat, lampMat } = C;
  const g = new THREE.Group();
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fc4d8, roughness: .18, metalness: .1,
    transparent: true, opacity: .42 });

  g.add(box(.90, .028, .90, MAT.drive, 0, .014, 0));                 // paved apron
  g.add(box(.90, .045, .07, MAT.stone, 0, .022, .435));              // kerb to the road edge
  g.add(box(.56, .006, .30, MAT.stone, 0, .030, .18));               // lighter waiting slab

  // shelter: glazed back wall, two posts, a cantilever roof with a front lip
  const H = .30 + (Math.min(3, lvl) - 1) * .03;
  g.add(box(.50, H, .012, glass, 0, .028 + H / 2, -.13));            // back glazing
  g.add(cyl(.012, .012, H, MAT.metal, -.25, .028 + H / 2, -.13, 6));
  g.add(cyl(.012, .012, H, MAT.metal, .25, .028 + H / 2, -.13, 6));
  g.add(cyl(.012, .012, H, MAT.metal, -.25, .028 + H / 2, .07, 6));
  g.add(cyl(.012, .012, H, MAT.metal, .25, .028 + H / 2, .07, 6));
  g.add(box(.56, .018, .26, MAT.metal, 0, .028 + H + .009, -.03));   // roof
  g.add(box(.56, .030, .014, MAT.dark, 0, .028 + H + .028, .095));   // roof front lip / fascia
  g.add(box(.34, .050, .014, MAT.wood, 0, .120, -.115));             // bench seat
  g.add(box(.34, .012, .022, MAT.dark, 0, .095, -.115));             // bench rail

  // the flag pole + route blade — what tells you it is a STOP and not a hut
  g.add(cyl(.010, .013, .40, MAT.metal, .34, .028 + .20, .16, 6));
  g.add(box(.020, .11, .085, MAT.metal, .34, .028 + .40, .16));      // sign blade
  g.add(box(.006, .075, .060, lampMat, .352, .028 + .40, .16));      // lit route panel
  if (lvl >= 2) g.add(box(.20, .06, .012, winMat, 0, .150, .085));   // lit timetable case
  if (lvl >= 3) g.add(box(.07, .09, .07, MAT.dark, -.36, .073, .18)); // litter bin
  return g;
}

/* ── 🚆 THE TRAIN STATION ─────────────────────────────────────────────────
   Platform, canopy, a real building with lit windows, a signboard and a clock.
   Sits on its own tile; the track it serves is laid on the tiles beside it. */
export function makeTrainstation(lvl) {
  const { THREE, box, cyl, MAT, winMat, lampMat } = C;
  const g = new THREE.Group();
  const L = Math.min(3, lvl);

  g.add(box(.94, .030, .94, MAT.drive, 0, .015, 0));                 // forecourt
  g.add(box(.94, .075, .34, MAT.stone, 0, .0675, -.28));             // island platform
  g.add(box(.94, .012, .05, MAT.roadLine, 0, .111, -.135));          // platform edge line
  g.add(box(.94, .012, .05, MAT.roadLine, 0, .111, -.425));

  // canopy over the platform, on four columns
  const CH = .30;
  for (const x of [-.36, -.12, .12, .36]) g.add(cyl(.013, .016, CH, MAT.metal, x, .105 + CH / 2, -.28, 6));
  g.add(box(.98, .020, .40, MAT.metal, 0, .105 + CH + .010, -.28));  // canopy deck
  g.add(box(.98, .028, .014, MAT.dark, 0, .105 + CH + .030, -.087)); // canopy fascia
  for (const x of [-.30, .30]) g.add(box(.07, .035, .028, lampMat, x, .105 + CH - .020, -.28));

  // the station building — concourse, ticket hall, entrance
  const BH = .26 + (L - 1) * .07;
  g.add(box(.60, BH, .30, MAT.stone, 0, .030 + BH / 2, .24));
  g.add(box(.66, .028, .34, MAT.dark, 0, .030 + BH + .014, .24));    // parapet roof
  g.add(box(.20, .028, .10, MAT.metal, .18, .030 + BH + .036, .24)); // roof plant (BAR: roof clutter)
  g.add(box(.09, .050, .09, MAT.metal, -.16, .030 + BH + .039, .21));
  g.add(box(.42, BH * .48, .014, winMat, 0, .030 + BH * .58, .393)); // glazed frontage
  g.add(box(.14, BH * .62, .016, MAT.dark, 0, .030 + BH * .31, .396));// entrance recess
  g.add(box(.46, .055, .020, MAT.dark, 0, .030 + BH + .002, .398));   // fascia band
  g.add(box(.34, .034, .008, lampMat, 0, .030 + BH + .002, .410));    // lit station name
  g.add(cyl(.042, .042, .012, lampMat, -.24, .030 + BH * .82, .400, 10)); // platform clock

  // a departure board on the platform side, and rails hinted along the back
  g.add(cyl(.010, .012, .26, MAT.metal, -.40, .105 + .13, -.16, 6));
  g.add(box(.016, .085, .13, MAT.dark, -.40, .105 + .26, -.16));
  g.add(box(.005, .060, .10, lampMat, -.392, .105 + .26, -.16));
  return g;
}

/* ── 🛤 RAIL TRACK ────────────────────────────────────────────────────────
   AUTO-TILING, like the road recipe: `con` carries which of the four
   neighbours is also track (or a station), and a rail pair is drawn from the
   centre out to each connected edge. That is what makes a corner look like a
   corner and a junction look like a junction — a fixed straight piece would
   have forced the player to rotate every single tile by hand, which is not a
   mechanic, it is a chore.
   ⚠ An ISOLATED piece (no connections yet) draws a straight N–S run so the
     first tile a player lays is not an empty ballast square. */
export function makeRailtrack(lvl, con) {
  const { THREE, box, cyl, MAT } = C;
  const g = new THREE.Group();
  const c = con || {};
  let dirs = [];
  if (c.n) dirs.push('n'); if (c.s) dirs.push('s'); if (c.e) dirs.push('e'); if (c.w) dirs.push('w');
  if (!dirs.length) dirs = ['n', 's'];
  const ns = dirs.includes('n') || dirs.includes('s');
  const ew = dirs.includes('e') || dirs.includes('w');

  g.add(box(.96, .026, .96, MAT.drive, 0, .013, 0));                 // ballast bed
  // sleepers, laid across whichever axis actually carries rails
  if (ns) for (const z of [-.36, -.20, -.04, .12, .28, .42]) g.add(box(.42, .016, .045, MAT.wood, 0, .034, z));
  if (ew) for (const x of [-.36, -.20, -.04, .12, .28, .42]) g.add(box(.045, .016, .42, MAT.wood, x, .034, 0));

  const RAIL = .026, RY = .050, GAUGE = .105;
  for (const d of dirs) {
    if (d === 'n') for (const x of [-GAUGE, GAUGE]) g.add(box(RAIL, .022, .52, MAT.metal, x, RY, -.24));
    if (d === 's') for (const x of [-GAUGE, GAUGE]) g.add(box(RAIL, .022, .52, MAT.metal, x, RY, .24));
    if (d === 'e') for (const z of [-GAUGE, GAUGE]) g.add(box(.52, .022, RAIL, MAT.metal, .24, RY, z));
    if (d === 'w') for (const z of [-GAUGE, GAUGE]) g.add(box(.52, .022, RAIL, MAT.metal, -.24, RY, z));
  }
  // a lineside signal every third tile, so a long run is not a bare ribbon
  if (lvl >= 2) {
    g.add(cyl(.009, .011, .22, MAT.metal, .38, .13, .38, 6));
    g.add(box(.030, .055, .022, MAT.dark, .38, .26, .38));
  }
  return g;
}

/* ── 🚌 THE BUS DEPOT (the Bus Company operation, sited) ───────────────────
   Roller doors, a hazard-chevron apron, roof plant and two buses on the yard.
   This is the frame-1 industrial vocabulary the BAR describes, at one tile. */
export function makeBusdepot(lvl) {
  const { THREE, box, cyl, MAT, winMat, lampMat } = C;
  const g = new THREE.Group();
  const hazard = new THREE.MeshStandardMaterial({ color: 0xd8b23a, roughness: .9 });

  g.add(box(.94, .030, .94, MAT.drive, 0, .015, 0));                  // yard
  g.add(box(.86, .008, .16, hazard, 0, .033, .10));                   // hazard apron stripe
  const SH = .30 + (Math.min(3, lvl) - 1) * .05;
  g.add(box(.86, SH, .40, MAT.stone, 0, .030 + SH / 2, -.26));        // depot shed
  g.add(box(.92, .030, .46, MAT.metal, 0, .030 + SH + .015, -.26));   // shed roof
  g.add(box(.22, .045, .12, MAT.metal, -.22, .030 + SH + .052, -.30));// roof plant
  g.add(box(.13, .060, .13, MAT.metal, .18, .030 + SH + .060, -.32)); // HVAC box
  g.add(cyl(.020, .024, .10, MAT.metal, .34, .030 + SH + .080, -.24, 8)); // vent stack
  for (const x of [-.26, 0, .26]) {                                   // three roller doors
    g.add(box(.21, SH * .70, .016, MAT.dark, x, .030 + SH * .35, -.062));
    g.add(box(.23, .016, .020, MAT.metal, x, .030 + SH * .70, -.060));
  }
  g.add(box(.60, .040, .014, MAT.dark, 0, .030 + SH + .002, -.068));  // fascia
  g.add(box(.40, .024, .006, lampMat, 0, .030 + SH + .002, -.058));   // lit depot sign

  // two buses on the apron, cheap silhouettes — a depot with no buses in it
  // reads as a warehouse, and the whole point is that you can see the fleet
  for (const [x, z] of [[-.26, .28], [.06, .28]]) {
    g.add(box(.10, .085, .30, MAT.metal, x, .075, z));
    g.add(box(.104, .038, .22, winMat, x, .098, z));
    g.add(box(.10, .020, .30, MAT.dark, x, .124, z));
  }
  g.add(cyl(.012, .015, .34, MAT.metal, .40, .030 + .17, .34, 6));    // yard mast
  g.add(box(.07, .030, .026, lampMat, .40, .030 + .34, .34));         // yard flood
  return g;
}

/* ── 🚆 THE RAIL OPERATOR (the Rail Operator operation, sited) ────────────
   The control end of a railway: a signalling hall, a glazed control tower and
   a gantry. Taller than the depot on purpose — it is the 10,000,000 🔥 one. */
export function makeRailops(lvl) {
  const { THREE, box, cyl, MAT, winMat, lampMat } = C;
  const g = new THREE.Group();
  const L = Math.min(3, lvl);

  g.add(box(.94, .030, .94, MAT.drive, 0, .015, 0));
  const BH = .32 + (L - 1) * .06;
  g.add(box(.72, BH, .44, MAT.stone, 0, .030 + BH / 2, -.20));        // signalling hall
  g.add(box(.78, .030, .50, MAT.dark, 0, .030 + BH + .015, -.20));
  g.add(box(.26, .040, .14, MAT.metal, -.18, .030 + BH + .050, -.24));// roof plant
  g.add(box(.11, .055, .11, MAT.metal, .20, .030 + BH + .058, -.26));
  g.add(box(.56, BH * .34, .014, winMat, 0, .030 + BH * .40, .022));  // glazed frontage
  g.add(box(.56, BH * .22, .014, winMat, 0, .030 + BH * .74, .022));

  const TH = .34 + (L - 1) * .10;                                     // control tower
  g.add(box(.20, TH, .20, MAT.stone, .30, .030 + TH / 2, .26));
  g.add(box(.26, .13, .26, winMat, .30, .030 + TH + .065, .26));      // glazed cab
  g.add(box(.28, .022, .28, MAT.dark, .30, .030 + TH + .142, .26));   // cab roof
  g.add(cyl(.008, .008, .16, MAT.metal, .30, .030 + TH + .23, .26, 6));
  g.add(box(.030, .030, .030, lampMat, .30, .030 + TH + .31, .26));   // aircraft light

  // a gantry over a stub of track, so it reads as railway and not as an office
  for (const x of [-.40, -.02]) g.add(cyl(.011, .014, .30, MAT.metal, x, .030 + .15, .34, 6));
  g.add(box(.44, .020, .030, MAT.metal, -.21, .030 + .30, .34));
  for (const x of [-.34, -.08]) g.add(box(.030, .060, .022, MAT.dark, x, .030 + .26, .355));
  g.add(box(.46, .024, .58, MAT.drive, -.21, .032, .34));             // track bed
  for (const x of [-.32, -.10]) g.add(box(.024, .020, .58, MAT.metal, x, .050, .34));
  return g;
}

/* ── 🚌 THE BUS (an agent) ────────────────────────────────────────────────
   ⚠ BUILT ALONG +X. agentTick rotates a non-civilian agent by
     `atan2(dx,dz) − π/2`, which points a +X-facing model down its direction of
     travel. Every vehicle recipe in node-city is authored the same way; a bus
     built along Z would drive sideways down every street. */
export function makeBus(hex) {
  const { THREE, box, cyl, MAT, winMat, lampMat, limitShadowCasters } = C;
  const g = new THREE.Group();
  const paint = lineMat(hex);
  const body = new THREE.MeshStandardMaterial({ color: 0xdcd7cb, roughness: .55 });

  g.add(box(.46, .115, .17, body, 0, .105, 0));                       // main body
  g.add(box(.46, .045, .175, paint, 0, .042, 0));                     // skirt in the line colour
  g.add(box(.44, .050, .178, winMat, 0, .140, 0));                    // window band
  g.add(box(.44, .022, .175, body, -.005, .172, 0));                  // roof cap
  g.add(box(.16, .020, .13, MAT.dark, .06, .186, 0));                 // roof hatch / A-C
  g.add(box(.014, .085, .155, MAT.dark, .00, .105, 0));               // centre door pillar
  g.add(box(.045, .075, .012, winMat, .225, .128, .04));              // windscreen wrap
  g.add(box(.035, .030, .020, paint, -.232, .150, 0));                // rear route panel
  for (const z of [-.055, .055]) {
    g.add(box(.030, .018, .022, lampMat, .231, .062, z));             // headlights
    g.add(box(.024, .016, .020, MAT.ember, -.231, .070, z));          // tail lights
  }
  for (const [x, z] of [[.14, .092], [.14, -.092], [-.15, .092], [-.15, -.092]]) {
    const w = cyl(.037, .037, .028, MAT.dark, x, .040, z, 10);
    w.rotation.x = Math.PI / 2; g.add(w);
  }
  try { limitShadowCasters(g, 3); } catch (e) {}
  return g;
}

/* ── 🚆 THE TRAIN (an agent) ──────────────────────────────────────────────
   A power car and two coaches, articulated as one rigid body. Node-city has no
   trailer/bogie model and inventing one for this would be a second mover; the
   train is long enough that the joints are not what a player looks at. */
export function makeTrain(hex) {
  const { THREE, box, cyl, MAT, winMat, lampMat, limitShadowCasters } = C;
  const g = new THREE.Group();
  const paint = lineMat(hex);
  const shell = new THREE.MeshStandardMaterial({ color: 0xc9c6d0, roughness: .5, metalness: .25 });

  // power car, nose forward (+X)
  g.add(box(.34, .135, .16, shell, .30, .120, 0));
  g.add(box(.10, .095, .155, shell, .49, .098, 0));                   // raked nose
  g.add(box(.34, .034, .162, paint, .30, .048, 0));                   // livery stripe
  g.add(box(.20, .048, .164, winMat, .28, .152, 0));                  // cab + saloon glazing
  g.add(box(.055, .045, .120, winMat, .455, .140, 0));                // cab front screen
  for (const z of [-.048, .048]) g.add(box(.022, .020, .022, lampMat, .534, .088, z));
  g.add(box(.30, .020, .13, MAT.dark, .30, .190, 0));                 // roof equipment
  g.add(box(.05, .045, .05, MAT.metal, .18, .212, 0));                // pantograph block

  // two coaches behind it
  for (const x of [-.06, -.42]) {
    g.add(box(.32, .125, .155, shell, x, .118, 0));
    g.add(box(.32, .030, .158, paint, x, .050, 0));
    g.add(box(.26, .046, .160, winMat, x, .148, 0));
    g.add(box(.28, .018, .125, MAT.dark, x, .184, 0));
    g.add(box(.012, .100, .150, MAT.dark, x + .10, .118, 0));         // door pillar
  }
  g.add(box(.06, .045, .05, MAT.metal, .12, .075, 0));                // gangway
  g.add(box(.06, .045, .05, MAT.metal, -.24, .075, 0));
  for (const [x, z] of [[.40, .085], [.40, -.085], [-.55, .085], [-.55, -.085]]) {
    const w = cyl(.030, .030, .024, MAT.dark, x, .034, z, 8);
    w.rotation.x = Math.PI / 2; g.add(w);
  }
  try { limitShadowCasters(g, 4); } catch (e) {}
  return g;
}

/* One flat plate of route ribbon, laid between two adjacent tile centres.
   Paths are 4-neighbour and grid-aligned, so a segment is always axis-aligned
   and no rotation maths is needed — which is also why this can be a box(). */
export function overlaySegment(hex, ax, az, bx, bz, y, w) {
  const { box } = C;
  const m = lineFlatMat(hex);
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  /* ⚠ THE DEGENERATE CASE IS A STOP PIP, NOT A SEGMENT. Called with the same
     point twice it used to fall into the `ax === bx` branch and draw a plate a
     FULL TILE long lying across the stop — which read as a red slab in the
     street, not as a marker. Checked first, deliberately. */
  if (ax === bx && az === bz) return box(w, .010, w, m, mx, y, mz);
  return (ax === bx) ? box(w, .010, 1.02, m, mx, y, mz)
                     : box(1.02, .010, w, m, mx, y, mz);
}
