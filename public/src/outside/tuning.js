/* ============================================================================
   🛣 OUTSIDE CONNECTIONS — every number in one place.
   ============================================================================
   The `_opEcon()` pattern from CLAUDE.md: nothing below is written down twice,
   and no other file in /src/outside holds a magic number.

   ⚠ THE WORLD MAPPING IS NOT OURS. node-city owns tile→world:
        worldX = x - HALF + 0.5,  worldZ = z - HALF + 0.5,  HALF = GRID/2 = 12
     so the buildable plate spans -12 … +12 on both axes and the north edge row
     (z = 0) sits at world z = -11.5. Every Z below is measured against that.
     If GRID ever changes, mount() re-derives EDGE_Z from the handed-over GRID
     rather than trusting the constant here — see index.js.
   ============================================================================ */

/* ── The highway itself (scenery; exists whether or not you joined it) ───── */
export const HW = {
  /* Centreline of the corridor, in world Z. Two constraints pin this number and
     they pull in opposite directions — both were found by photographing it.
       • FAR ENOUGH that the EMBANKMENT'S TOE clears the buildable plate. The
         plate ends at world -12. The toe sits at `z + emb.bot/2`, so at -17.4
         with a 13.8-wide base the earthworks ran 1.5 units ONTO the map and the
         interchange tile itself stood on the slope — the plaza looked like it
         was sliding off a hill. Toe now lands at -12.8, a clear 0.8 short.
       • NEAR ENOUGH to survive the fog. scene.fog runs 26 → 70 (index.html
         ~3148). At -19.6, from any camera high enough to see over the city's
         north edge, the highway sat past 35 units and washed out to the sky
         colour completely — the "thing you can see you are not yet joined to"
         was invisible in the photograph.
     -18.8 with a 12.0 base is the widest window that satisfies both. Move one
     of these and you must move the other. */
  z: -18.8,
  /* Length. The surrounding `ground` plane in node-city is GRID+208 = 232 wide
     and camera.far is 220, so 150 runs the full visible width and still dies
     inside the fog rather than at a hard clipped edge. */
  len: 150,
  /* Deck height. Elevated ON PURPOSE — a highway flush with the plain reads as
     a wide grey road, and the ramp has nothing to climb. 0.9 is roughly one
     storey at this game's scale (a Housing box is ~0.7 tall). */
  y: 0.95,
  /* top must stay wider than the two carriageways plus the median plus a verge:
     2*(median/2 + lane + kerb) = 8.4. bot = top + 1.5 of slope each side. */
  emb: { top: 9.0, bot: 12.0 },
  lane: 3.6,                        // one carriageway: 3 lanes + hard shoulder
  median: 1.0,                      // central reservation, barrier down the middle
  /* How far the deck sits ABOVE the verge plate it is laid into.
     ⚠ THIS USED TO BE A DROP (deck = y + .012 − .02) AND IT HID THE ROAD. The
       verge sits at y + .001, so a deck at y − .008 is UNDER it: photographed,
       the two carriageways and every lane marking on them were simply not
       there, and the highway read as a bare embankment. A lift, always. */
  deckLift: 0.014,
  gantryEvery: 44,                  // overhead sign gantries along the run
  lampEvery: 11,                    // lighting columns, both sides
  railPostEvery: 2.4,               // guardrail posts
};

/* ── The rail line (the caption's second outside connection) ─────────────── */
export const RAIL = {
  z: 18.8,                 // south side, mirrored
  len: 150,
  y: 0.42,
  emb: { top: 3.4, bot: 5.2 },
  gauge: 0.62,
  sleeperEvery: 0.55,
  /* A Rail Yard only reaches the mainline if it sits in this many tiles of the
     SOUTH edge. Deliberately NOT retro-fitted to every existing yard: a yard in
     the middle of a city is a goods shed, not a connection to the outside
     world, and pretending otherwise would make the highway pointless. */
  band: 3,
};

/* ── The interchange ──────────────────────────────────────────────────────── */
export const ICH = {
  type: 'interchange',
  /* The highway runs past the NORTH side, so the joint can only be made on the
     north edge row. This is the whole placement rule and the refusal quotes it. */
  edgeZ: 0,
  /* Keep one tile of margin from the map corners: the on-ramp runs +X and the
     off-ramp -X for ~9 units each, and a corner placement would throw both of
     them off the end of the embankment. */
  margin: 1,
  ramp: {
    reach: 9.2,            // how far downstream the merge point sits
    wide: 1.75,            // ramp width at the city end
    narrow: 0.72,          // ...tapering to this at the merge (the taper)
    segs: 26,
    offset: 0.62,          // on/off ramps sit either side of the tile centreline
    barrier: 0.2,
  },
};

/* ── The gate ─────────────────────────────────────────────────────────────── */
export const GATE = {
  /* ⏳ GRANDFATHER GRACE. A city that predates this feature gets an interchange
     placed for it on load (see migrate() in link.js). If — and only if — that
     migration could not also CONNECT it (the north edge fully built up, or the
     city has no roads at all), the gate is waived for this long so a live
     trading city cannot wake up cut off. The waiver is stamped into the save as
     `oc.gf` and it EXPIRES; it is a moving van, not a permanent exemption. */
    graceMs: 7 * 24 * 3600 * 1000,
  /* How many road tiles the migration is allowed to lay to reach the network.
     Beyond this it stops and waives instead — laying 20 roads into a player's
     city on their behalf is worse than a warning. */
  migrateMaxRoads: 12,
  /* The city log/toast is written ONCE per disconnect episode, not once per
     caravan tick. A four-minute drum-beat of "you are cut off" is noise. */
  nagEveryMs: 6 * 60 * 1000,
  /* localStorage key the main app reads (see status.js). */
  statusKey: 'mythic_outside_v1',
  /* A status record older than this is treated as UNKNOWN, never as a refusal.
     Without it, a player who plays node-city once and never returns would be
     locked out of the Resource Exchange forever by a stale record. */
  statusStaleMs: 7 * 24 * 3600 * 1000,
};

/* ── The connection modes ─────────────────────────────────────────────────────
   ⚠ THE OTHER TWO ARE A DOCUMENTED SEAM, NOT A HALF-BUILT FEATURE.
   The CS2 caption names four outside connections: road, rail, air and water.
   Road and rail are real below because both fall out of the SAME test — a
   building of type `t`, undamaged, standing in the right band of the map, with
   a road path to the rest of the network. Air and water do not fall out of it
   for free: neither has a building in BUILDINGS, neither has scenery to connect
   TO (there is no coast and no flight path on this map), and inventing both
   would be a second feature wearing this one's clothes.
   To add one later: give it a BUILDINGS type, add its scenery to mesh.js, and
   add one row here. link.js iterates this table and nothing else needs to know.
   ──────────────────────────────────────────────────────────────────────────── */
export const MODES = [
  { id: 'road', ico: '🛣', label: 'Highway',
    building: 'interchange', buildingName: 'Highway Interchange',
    // band: which edge the building has to stand on. 'n' = the z===0 row.
    band: 'n', bandTiles: 1,
    fix: 'Build a 🛣 Highway Interchange on the NORTH edge of the map (the top row of tiles), then run 🛤️ Road from it into your city.' },
  { id: 'rail', ico: '🚉', label: 'Rail',
    building: 'railyard', buildingName: 'Rail Yard',
    band: 's', bandTiles: RAIL.band,
    fix: 'Build a 🚉 Rail Yard within ' + RAIL.band + ' tiles of the SOUTH edge — that is as far as the mainline will throw a spur — then run 🛤️ Road from it into your city.' },
  // { id: 'air',   … } — see the note above. Needs an Airfield + a flight path.
  // { id: 'water', … } — needs a Harbour + water on the map. There is none.
];
