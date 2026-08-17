/* ══ 🛣 STREETS — THE ONE PLACE A STREET NUMBER IS WRITTEN DOWN ═════════════
   Same discipline as the economy's ECON table (`/src/economy/tuning.js`) and the
   `_opEcon()` rule in CLAUDE.md: nothing below this file may hardcode a street
   constant, and every readout in the panel has to be traceable to a line here.

   The four readouts in the road dossier are each derived, never invented:

     UPKEEP     tiles x the road's REAL build cost (BUILDINGS.road.cost.cinder,
                read through the host — never copied here) x UPKEEP_PCT_PER_CYCLE,
                scaled by wear. See the honesty note on UPKEEP_PCT_PER_CYCLE.
     LENGTH     tiles x METRES_PER_TILE. Stated once, here.
     CONDITION  100 - wear, where wear is accumulated from COUNTED vehicle
                passes (WEAR_PER_1K_PASSES) and from the host's own t.wear /
                t.damaged if either is ever set on a road.
     TRAFFIC    counted tile transitions out of the real agent step. Capacity for
                the flow percentage is derived from the sim's own car speed and a
                stated headway; it is not a magic number.                       */
export const STREET = {
  /* 📏 One tile carries one building's frontage plus its plot and the footway
     that serves it. 40 m is a plausible urban block face at that description,
     and it is the ONLY place metres enter this feature — the whole 24x24 grid is
     therefore 960 m across, so a long avenue reads as ~0.4 km rather than as a
     fantasy number. Change it here and every length, and nothing else, moves. */
  METRES_PER_TILE: 40,

  /* 💰 Maintenance is quoted as a fraction of the tile's REAL build cost per
     city cycle (CITY_DAY_MIN minutes — the same "cycle" the rest of the city
     dossier prints rates in).
     ⚠ THE HONEST PART, and the panel says it out loud: the city does NOT bill
       road maintenance today. There is no upkeep path for roads anywhere in
       node-city (decayTick skips t.type === 'road' outright), and inventing one
       here would be a silent economy change made from a UI feature — exactly the
       thing CLAUDE.md forbids. So this is a QUOTE derived from a real price, and
       it is labelled as a quote. If road upkeep is ever charged, it charges
       through the host's economy and this number becomes the bill. */
  UPKEEP_PCT_PER_CYCLE: 0.05,
  /* A worn road costs more to hold together. Linear in wear, capped by the wear
     cap below, so the quote can never more than double. */
  UPKEEP_WEAR_SCALE: 1.0,

  /* 🏚 WEAR. Roads are excluded from decayTick (index.html: `t.type === 'road'`
     is skipped), so t.wear on a road is always 0 and CONDITION would be a flat
     "100%" on every street in every city — a readout that cannot vary is not a
     readout. This module therefore keeps its own road wear, and it is derived
     from the ONE real thing a road accumulates: counted vehicle passes.
     ⚠ IT NEVER FAILS A TILE. Capped at WEAR_CAP, never written back to t.wear,
       never sets t.damaged. A UI feature must not invent a failure mode, a
       repair bill or a production penalty; if road decay is ever wanted as a
       MECHANIC it belongs in decayTick with the rest of them. */
  WEAR_PER_1K_PASSES: 1.6,
  WEAR_CAP: 45,

  /* 🚦 CAPACITY, for the flow percentage. THE SMALLER OF TWO REAL LIMITS, and
     the second one is the whole reason this is not just lane physics:

       LANE SATURATION   carSpeed * 3600 / HEADWAY_TILES. One vehicle per
                         HEADWAY_TILES of lane, moving at the sim's own car
                         speed. At the shipped carSpeed of 1.9 that is ~3,420/h.

       FLEET SHARE       fleetMax * carSpeed * 3600 / roadTiles. node-city caps
                         its vehicle population outright (AGENTS.carMax +
                         truckMax + policeMax = 18 on the shipped table) and
                         those vehicles are spread over the whole road network,
                         so the busiest a street can be is every vehicle in the
                         city taking an even share of it.

     ⚠ THE FIRST CUT USED LANE SATURATION ALONE AND THE CHART WAS A FLAT LINE
       ALONG THE X AXIS. It was not wrong — an 18-vehicle city genuinely never
       approaches the physical saturation of a lane, so every street really did
       read 5-8% — but a chart whose only shape is "nearly zero" tells a player
       nothing, and the fix is not to rescale the axis (that would misreport
       saturation) but to compare against the limit that actually binds in this
       simulation. Above 100% means this street is carrying more than its share
       of the city's fleet, which is exactly the thing worth knowing.

     Both terms come from the host: the speed and the fleet caps out of AGENTS,
     the road count off the live network. Only HEADWAY_TILES is a judgement. */
  HEADWAY_TILES: 2,
  /* Floor so a broken/absent AGENTS table cannot divide flow by zero. */
  MIN_CAPACITY_VPH: 60,

  /* 📊 24 buckets, one per hour of the city clock (hourOf(), which is real
     EST wall time — the same clock that drives the sky). A bucket is a rolling
     window: when the wall clock enters an hour whose bucket was last written in
     a DIFFERENT hour, that bucket is zeroed before anything is added, so the
     chart is always the last 24 hours and never a lifetime average. */
  BUCKETS: 24,
  /* A bucket with less than this much observed time is not plotted. Without it,
     the first two seconds of an hour turn one lucky pass into "1,800 veh/h" and
     the chart opens on a spike that is pure sampling noise. */
  MIN_OBSERVED_SEC: 20,

  /* 🏷 World labels. A one-tile stub gets no label (there is nowhere to put it),
     and the plane sits between the carriageway top (RD_Y = 0.016) and the
     footway top (RD_PT = 0.046) so it cannot z-fight the asphalt or climb the
     kerb. */
  LABEL_MIN_TILES: 2,
  LABEL_Y: 0.028,
  LABEL_HALF_W: 0.17,          // inside RD_HW (0.20), the kerb face
  /* Texture HEIGHT only. There is deliberately no width constant: the canvas is
     cut to the measured text and the plane is then built from the canvas's
     aspect ratio, because a fixed-width texture stretched across a street of
     any length smears the letters (see the note in labels.js). */
  LABEL_TEX_H: 64,
  LABEL_MAX: 80,               // hard cap on label planes; see labels.js
  /* Re-derive the street graph at most this often. Segmentation is O(roads) and
     roads are capped by ROAD_CAP_BASE + depots, so this is cheap — but it does
     not need to run per frame either. */
  RESCAN_MS: 2500,

  /* ✍ Player-authored names. Sanitised on the way in (see naming.js) AND escaped
     on the way out through the host's logEsc — the same belt-and-braces the
     costLabel comment in index.html argues for. */
  MAX_NAME_LEN: 42,
  /* Bound on what the traffic ring contributes to the save. The city save is one
     upserted row per user with no history, so growth here is not free. */
  SAVE_MAX_TILES: 320,
};

export default STREET;
