/* ══════════════════════════════════════════════════════════════════════════
   🛣 ROAD CLASSES — THE TUNING TABLE.

   Every number this feature owns is in this file, behind one accessor, and
   NOTHING else in /src/roads may hold a numeric price. That is the `_opEcon()`
   / `ECON` / `POWER` pattern (CLAUDE.md), applied to roads.

   🔴 WHAT IS **NOT** IN HERE: A PRICE.
   `costMult` is a MULTIPLIER ON `costOf('road')`. The road's real price lives
   in exactly one place — node-city's BUILDINGS.road row scaled by
   BUILD_CINDER_MULT (the table says 4, the player is charged 400) — and
   /src/streets already records what happens to anyone who reads the raw table
   instead: "reading BUILDINGS.road.cost raw quotes 100x low and looks correct".
   So this file never sees 400 and never can. price.js multiplies whatever the
   host quotes today, so a retune of the road price retunes all nine classes
   with it and no class can drift out of step with the street it is priced
   against.

   ── WHY A MULTIPLIER LADDER AND NOT NINE PRICES ──────────────────────────
   The ladder is the DESIGN: an alley is cheaper than a street, a highway is a
   piece of national infrastructure. Nine independent prices would encode the
   same intent as nine numbers that can each be wrong on their own, and would
   have to be re-derived by hand the first time roads are repriced.

   ── capWeight IS NOT A PRICE, IT IS A MAINTENANCE BURDEN ─────────────────
   node-city's road cap (ROAD_CAP_BASE 40, +10/depot, +8/convoy) is explicitly
   "what the city can MAINTAIN", not what it can afford to build. So the two
   ladders are deliberately DIFFERENT shapes: a bridge is 4.5x the price of a
   street and 3x its upkeep; a roundabout is 2.8x the price and 1x the upkeep,
   because a roundabout replaces a junction the city was maintaining anyway.
   ⚠ Weights are INTEGERS on purpose. roadUsed() prints into the road meter as
     "used / cap" and a fractional meter reads as a rounding bug.
   ══════════════════════════════════════════════════════════════════════════ */

export const ROADS = {

  /* ── THE CLASS CATALOGUE ────────────────────────────────────────────────
     `id` is SAVED ON THE TILE and must never be renamed — same contract as a
     progression node id. Order here is the order the palette draws in.
     ⚠ `street` MUST stay first and MUST stay cost 1.0 / weight 1: it is the
       class every road that predates this module resolves to, so a city that
       loaded before /src/roads existed has to price and meter EXACTLY as it
       did. See classes.js classOf(). */
  cls: {
    street: {
      ico: '🛣', name: 'Street', short: 'Street',
      desc: 'The neighbourhood default — two lanes, kerbs, footways both sides.',
      col: 0x9a958c, costMult: 1.00, capWeight: 1, order: 0,
    },
    alley: {
      ico: '🧱', name: 'Alley', short: 'Alley',
      desc: 'Setts, no markings, no through traffic. Cheap to lay, cheap to keep.',
      col: 0x8a8378, costMult: 0.60, capWeight: 1, order: 1,
    },
    curve: {
      ico: '🌀', name: 'Curve', short: 'Curve',
      desc: 'A swept carriageway. Lay it on a diagonal run and the staircase reads as one road.',
      col: 0xc0a26a, costMult: 1.25, capWeight: 1, order: 2,
    },
    bikelane: {
      ico: '🚲', name: 'Cycle Track', short: 'Cycle',
      desc: 'Surfaced cycle tracks either side of the carriageway, wanded off the traffic.',
      col: 0x2e6b3f, costMult: 1.30, capWeight: 1, order: 3,
    },
    culdesac: {
      ico: '🔵', name: 'Cul-de-sac', short: 'Cul-de-sac',
      desc: 'A turning head with a planted island. Lay it on the dead end of a run.',
      col: 0x7fa2c4, costMult: 1.60, capWeight: 1, order: 4,
    },
    avenue: {
      ico: '🌳', name: 'Avenue', short: 'Avenue',
      desc: 'A planted central median. Twice the price of a street and twice the upkeep.',
      col: 0x4f8a49, costMult: 2.20, capWeight: 2, order: 5,
    },
    roundabout: {
      ico: '⭕', name: 'Roundabout', short: 'Roundabout',
      desc: 'A 3x3 stamp: eight circulating tiles around one planted island.',
      col: 0xd0894a, costMult: 2.80, capWeight: 1, order: 6, stamp: 3,
    },
    bridge: {
      ico: '🌉', name: 'Bridge', short: 'Bridge',
      desc: 'A parapeted deck on steel. Expensive to build and expensive to keep standing.',
      col: 0x6f8fae, costMult: 4.50, capWeight: 3, order: 7,
    },
    highway: {
      ico: '🛤', name: 'Highway', short: 'Highway',
      desc: 'Dark-surfaced trunk road, hatched shoulders and crash barriers. The most road a city can own.',
      col: 0x3f4750, costMult: 6.00, capWeight: 4, order: 8,
    },

    /* 🔵 THE ROUNDABOUT'S CENTRE TILE, and it is NOT in the palette.
       A roundabout is nine road tiles: eight circulating and one island. The
       island has to be a road tile rather than empty ground, or the middle of
       every roundabout in the city is a zonable, buildable plot — and a player
       who puts a Grocery in it has not done anything wrong, the tool has.
       It is priced and metered as part of the stamp, which is why it carries
       the SAME costMult and capWeight as the ring it belongs to; `hidden` keeps
       it out of the palette, out of the keyboard shortcuts and out of every
       list a player can arm from. */
    rbisle: {
      ico: '⭕', name: 'Roundabout island', short: 'Island',
      desc: 'The planted centre of a roundabout.',
      col: 0xd0894a, costMult: 2.80, capWeight: 1, order: 99, hidden: true,
    },
  },

  /* ── GEOMETRY DIALS ─────────────────────────────────────────────────────
     Read by mesh.js. Everything here is in TILE-LOCAL units (a tile is 1.0),
     the same frame makeRoad's RD_* cross-section constants are written in, and
     each one is chosen AGAINST one of them rather than invented — the note on
     each says which. Nothing here may move a shipped RD_* constant: widening
     the carriageway is its own round (node-city index.html, the RD_KH note). */
  geo: {
    // How far above the surface a class lays its own layer. The stack under it
    // is makeRoad's: patch .0018 / wear .0036 / paint .0054 / grate .0072.
    // ⚠ These are OFFSETS FROM A LAYER, never absolute heights — mesh.js adds
    //   them to the RD_* constant the host handed over, so if the host ever
    //   restacks its own surface the classes restack with it.
    lift: 0.0018,          // one stack step: what a class lays on top of paving
    liftHi: 0.0006,        // a hair, for two class layers that must not z-fight

    median: {
      /* ⚠ .080 IS THE WIDEST A MEDIAN MAY BE, and the number is derived, not
         chosen. RD_HW is .20, so a half-width of .080 leaves .120 of running
         lane either side — and makeRoad's outer wheel track is centred at .128
         with width .040, i.e. its INNER edge is at .108. Any wider and the
         median stands on the wheel track, which reads as a car driving through
         a hedge. Measured against the kit's own constants rather than eyeballed
         for the same reason the shoulder hatch starts outboard of the edge line.
         (First draft was .062; at the game's 20-30° camera it read as a painted
         stripe rather than a planted island, at 5.1% of the crop against a
         control of 0. Widened WITH the planting, not instead of it.) */
      half: 0.080,         // median half-width
      kerbIn: 0.018,       // planting inset from the median kerb face
      nose: 0.215,         // where a median stops short of a junction box (RD_HW .20 + a kerb)
      shrub: 0.064,        // shrub box side
      shrubH: 0.110,       // …and tall enough to break the plane from a low camera
      lineOff: 0.096,      // the white line flanking the median, outboard of `half`
      lineW: 0.014,
    },
    highway: {
      surface: 0.62,       // resurfacing tint. A LINEAR multiplier like T_TRACK .76, darker
      /* ⚠ THE SHOULDER STARTS OUTBOARD OF THE EDGE LINE, NOT ON IT. makeRoad's
         solid edge line is RD_EL ± .009, i.e. .141 … .159, and it is a FILM at
         RD_PY — so is the hatching. Two coplanar quads at the same height is
         the z-fight this whole kit is written to avoid (see THE SURFACE STACK).
         .164 clears .159 with 5mm to spare and still leaves a 3.4cm shoulder. */
      shoulderIn: 0.164,   // inboard edge of the hatched shoulder
      shoulderOut: 0.198,  // outboard edge (RD_HW .20 - a hair)
      hatch: 0.055,        // hatch bar length along the road
      hatchGap: 0.075,
      barrierLat: 0.268,   // crash barrier centreline: outboard of the kerb band (RD_IN .245)
      railH: 0.030,        // rail height
      railT: 0.014,        // rail thickness
      railY: 0.052,        // rail underside above the footway
      postW: 0.020,
      postEvery: 0.250,
      signW: 0.150, signH: 0.100, signT: 0.014, signY: 0.190,
      col: 0xb9bcc2,       // galvanised steel
      signCol: 0x1d6b3a,   // motorway green
    },
    bridge: {
      parapetLat: 0.330,   // wall centreline, on the verge band (RD_VG .325)
      parapetT: 0.052,
      parapetH: 0.090,
      capT: 0.070,         // the coping stone overhangs the wall
      capH: 0.014,
      postEvery: 0.250,
      postW: 0.062, postH: 0.118,
      beamLat: 0.400, beamT: 0.090, beamH: 0.034,
      trussW: 0.032, trussH: 0.300,
      joint: 0.026,        // expansion joint width across the deck
      jointAt: 0.320,      // and how far out from the centre the pair sits
      jointTint: 0.55,
      col: 0xb0aca2,       // concrete parapet
      capCol: 0x8d8a83,
      steel: 0x4a6a86,
    },
    round: {
      isleKerbOut: 0.470,  // island kerb outer radius — inside the tile at .5
      isleKerbIn: 0.400,
      moundR: 0.150,
      moundH: 0.030,
      mastH: 0.300, mastW: 0.026,
      ringIn: 0.560,       // circulating band, measured from the ISLAND centre
      ringOut: 1.140,
      lineR: 1.185,        // the circulatory line, outboard of the band
      lineW: 0.020,
      ringTint: 0.78,      // circulating wear — near makeRoad's T_TRACK .76
      giveWay: 0.030,      // give-way bar depth
      rows: 26,            // steps used to draw a disc/annulus. See mesh.js discs()
    },
    culdesac: {
      kerbOut: 0.442,
      kerbIn: 0.392,
      isleR: 0.128,
      isleKerb: 0.026,
      bollardW: 0.024, bollardH: 0.086, bollards: 6, bollardR: 0.470,
      signW: 0.110, signH: 0.070, signT: 0.012, signY: 0.175,
      signCol: 0xd8d2c4,
    },
    bike: {
      /* The track runs .133 … .199 — outboard of the inner wheel track and
         stopping a millimetre short of the kerb face at RD_HW .20, so it
         surfaces the gutter pan (RD_GT .176) and the kerb grime (RD_GR .197)
         it is laid over and nothing else. Widened from .050 for the same reason
         the median was: at .050 a green ribbon 50cm wide at 10 m/unit is a line,
         not a lane. */
      lat: 0.166,          // track centreline
      w: 0.066,
      lineLat: 0.118,      // the white separator, inboard of the track
      lineW: 0.014,
      dash: 0.090, dashGap: 0.060,
      wandLat: 0.118, wandW: 0.016, wandH: 0.100, wandEvery: 0.220,
      col: 0x2e6b3f,       // surfaced green
      wandCol: 0xe9e4d8,
    },
    curve: {
      rIn: 0.300,          // .5 - RD_HW: the inner kerb line of a swept bend
      rOut: 0.700,         // .5 + RD_HW: the outer kerb line
      kerbT: 0.045,        // matches RD_LIP, the kerb band width
      fillet: 0.300,       // junction corner fillet radius
      chamfer: 0.300,      // straight-run corner easement
      chevW: 0.140, chevH: 0.070, chevT: 0.012, chevY: 0.150,
      chevCol: 0x2c2f34, chevMark: 0xe4dccb,
      rows: 26,
    },
    alley: {
      cells: 5,            // setts per side. 25 boxes, one bucket, no draw call
      joint: 0.012,
      colA: 0x8a8378,
      colB: 0x7b746a,
      channel: 0.070,      // the central drainage channel width
      channelCol: 0x635d55,
    },
  },

  /* ── THE DRAG ───────────────────────────────────────────────────────────
     `max` is the hard stop on one gesture. It exists because every tile is an
     awaited payCost round trip through the bridge, not a write to a data map
     — /src/zoning's applyRect is synchronous and this is not, and a 400-tile
     drag would hold the pointer for minutes. 48 is two crossings of a 24-wide
     board, which is the longest run the grid can actually hold. */
  drag: { max: 48, previewY: 0.052 },
};

/* The loud accessor. Same shape as /src/power's pw() and /src/economy's econ():
   a dotted path and a MANDATORY fallback, so a typo reads as the fallback at
   the call site instead of as undefined three frames later. */
export function rd(path, fallback) {
  let cur = ROADS;
  for (const seg of String(path).split('.')) {
    if (cur == null || typeof cur !== 'object' || !(seg in cur)) return fallback;
    cur = cur[seg];
  }
  return cur === undefined ? fallback : cur;
}

export default { ROADS, rd };
