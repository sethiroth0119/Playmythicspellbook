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
       MECHANIC it belongs in decayTick with the rest of them.

     ⚠ THE FIRST NUMBER HERE WAS 1.6 AND CONDITION WAS A CONSTANT. At 1.6% per
       thousand passes a single tile needs 625 passes to lose its FIRST point,
       so every street in every city read "100% average" and the range never
       moved off 100–100. A readout that cannot vary is exactly what the comment
       above says this file exists to avoid, and it shipped anyway.

     THE RATE IS MEASURED, NOT PICKED. Driven on the standard 172-tile district
     (100 road tiles, 29 agents — 8 cars, 6 trucks, 1 police, the rest on foot),
     counting only real agent tile transitions, over a whole drive rather than a
     lull in one (traffic here swings between ~1 and ~4.4 passes a second on a
     19-tile street, so a short window can be wrong by 4x in either direction):

       one street, 19 tiles ........ ~3.6 counted vehicle passes per city second
       one tile, average ........... ~0.19/s  →  ~225 per CYCLE
       one tile, the busiest ....... ~0.48/s  →  ~575 per CYCLE

     ⚠ THE FLEET IS CAPPED (AGENTS.carMax + truckMax + policeMax = 15-18), so a
       bigger city spreads the SAME vehicles over more road and these are close
       to the busiest per-tile rates the game can produce. Tuning to them cannot
       overshoot somewhere else.

     At 5% per thousand passes, one 20-minute cycle of that traffic costs a busy
     tile ~2.9 points and an average one ~1.1 — which is the reference's shape, a
     RANGE with an average that has moved, "97%–100% (98.9% average)" — reached
     within one session instead of one week. (The panel prints that average to a
     decimal for the same reason: a whole-number average would sit on "100" for
     the first half hour and repeat the old defect in a new place.)
     ⚠ IT SATURATES, AND THAT IS DELIBERATE. WEAR_CAP is reached on the busiest
       tile after 9,000 passes — about fifteen unbroken cycles, five hours of
       play — and nothing repairs a road, so a very old city's arterials sit at
       the cap. A number that stops at 55% is the honest end of "this panel
       reports, it never damages"; letting it run to 0% would be the UI inventing
       a failed road. */
  WEAR_PER_1K_PASSES: 5.0,
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
     the road count off the live network. Only HEADWAY_TILES is a judgement.

     ⚠ BOTH TERMS ARE STATED PER REAL HOUR — vehicles per 3,600 seconds — and
       the meter converts the result into the unit the CHART is drawn in, which
       is per CITY hour (see BUCKETS below). Doing it in that order keeps the
       two constants here physical: HEADWAY_TILES is a lane fact and
       MIN_CAPACITY_VPH is a divide-by-zero floor, and neither has to be
       re-derived if CITY_DAY_MIN ever changes. The flow PERCENTAGE is
       unaffected either way — volume and capacity carry the same unit, so the
       ratio is the same number in both clocks. */
  HEADWAY_TILES: 2,
  /* Floor so a broken/absent AGENTS table cannot divide flow by zero. */
  MIN_CAPACITY_VPH: 60,

  /* 📊 24 buckets, one per hour of ONE CITY CYCLE — the clock node-city itself
     advances (game.cityAge), NOT the EST wall clock the sky runs on.

     ⚠ THIS IS THE FIX FOR A CHART THAT COULD NEVER FILL. The buckets used to be
       keyed on hourOf() — real EST wall time, 1:1, no compression — so the 24
       slots spanned 24 REAL HOURS and one sitting produced one dot. Measured on
       the standard district: after a full scene build plus forty seconds,
       "0 of 24 hours observed", both charts blank, and 19 vehicle passes sitting
       correctly counted in the rings underneath. The meter was right; the axis
       was 1,440x too wide.

     A CYCLE is what the rest of the game already means by a day: production,
     rent, upkeep and the vitals trend are all quoted per CITY_DAY_MIN (20)
     minutes, and renderVitals prints "/ CYCLE" rather than "/ DAY" precisely
     because the sky's clock and this one disagree. The traffic profile is a
     thing a player's own session draws, so it keys on the clock the session
     advances: 24 buckets x 50 seconds = one cycle = one full ring.

     The cycle length is handed over by the host (ctx.cycleMin) rather than
     copied — CITY_DAY_MIN is a top-level `const` and invisible to a module.
     This is the fallback for an index.html that mounts without that field, and
     it is the same 20. A bucket stays a rolling window: entering a city hour
     whose bucket was last written in a DIFFERENT city hour zeroes it first, so
     the chart is always the last cycle and never a lifetime average. */
  BUCKETS: 24,
  CYCLE_MIN_FALLBACK: 20,
  /* A bucket with less than this FRACTION of its own length observed is not
     plotted. Without it, the first two seconds of a bucket turn one lucky pass
     into a 25x spike and the chart opens on pure sampling noise.
     ⚠ A FRACTION, NOT THE 20 SECONDS IT USED TO BE. Once the bucket length is
       derived from the cycle, an absolute threshold is a different fraction of
       it for every cycle length — and 20 seconds of the 50-second bucket this
       resolves to today is a 40% floor nobody chose. */
  MIN_OBSERVED_FRAC: 0.25,
  /* The most city time one frame may credit as OBSERVED. Two jumps have to be
     refused: offlineCatchUp advances cityAge by up to 36 hours for a city
     nobody was watching, and loadState pushes an old save's cityAge past the
     grace period outright. Neither counted a single vehicle pass, so crediting
     them as observation would divide a session's real traffic by a day of
     imaginary watching.
     ⚠ IT CANNOT GO BELOW THE VITALS BEAT. cityAge moves in 2-second lumps
       (vitalsTick's own cadence), so a clamp under 2 would silently discard most
       of the clock and inflate every volume on the panel. 4 is that beat plus
       headroom for a slow frame. */
  MAX_TICK_CREDIT_SEC: 4,

  /* 🏷 World labels. A one-tile stub gets no label (there is nowhere to put it),
     and the plane sits between the carriageway top (RD_Y = 0.016) and the
     footway top (RD_PT = 0.046) so it cannot z-fight the asphalt or climb the
     kerb. */
  LABEL_MIN_TILES: 2,
  LABEL_Y: 0.028,
  /* 🔴 HALF THE PLANE'S WIDTH ACROSS THE LANE — and the round-2 critic found
     every frame carrying "giant" street text because this was 0.17.
     RD_HW is 0.20, so the carriageway is 0.40 wide: at 0.17 the label band
     covered 85% of the road and the CAP HEIGHT alone (the canvas puts caps at
     ~45% of its height, see labels.js) came to ~0.15, i.e. 38% of the
     carriageway. A real road legend is about a third of ONE lane. 0.11 puts the
     band at 55% of the carriageway and caps at ~0.10 — a quarter of it — which
     is paint. Raise this and it becomes a billboard again. */
  LABEL_HALF_W: 0.11,          // well inside RD_HW (0.20), the kerb face
  /* How often the labels are re-faced at the camera (labels.js orient()). Not
     per frame: the work is one dot product per label and the visible cost of
     lagging a fast orbit by a fifth of a second is nil, while the cost of doing
     it in the render loop is paid on every frame the camera never moved. */
  LABEL_ORIENT_MS: 200,
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
