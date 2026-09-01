/* ════════════════════════════════════════════════════════════════════════════
   💧 WATER — THE TUNING TABLE. Every number the hydrology uses lives here.
   ----------------------------------------------------------------------------
   CLAUDE.md: "All operation pricing goes through `_opEcon()`. Never hardcode
   economy numbers." /src/economy states the same rule as "all economy numbers
   live in ECON (tuning.js)", and /src/power/tuning.js is the same table for the
   grid. This file is the water system's ECON: nothing else under /src/water
   writes a literal, so a balance pass is one file.

   🔴 THE NUMBERS THAT ARE NOT OURS TO OWN — and there are three.
      `BUILDINGS.purifier.gen.water` (1.2/min), `MORALE.drinkPerPopPerMin`
      (0.015) and the weather `waterMult` table are declared in
      node-city/index.html and are read by the build panel, the vitals card, the
      away report and the coverage system as well as by us. Copying any of them
      here would create a second truth about how much water this city makes and
      needs, which drifts the first time somebody retunes the host — the exact
      failure this integration exists to prevent. They arrive in the host
      snapshot (`host.wells[].want`, `host.drinkPerMin`, and the weather factor
      is ALREADY BAKED into `want` because the host multiplies by tileMult before
      handing it over). None of them is given a default here.

   ⚠ WHICH IS ALSO WHY `extract` IS A MULTIPLIER AND NOT A RATE. This module
     never says how much water a Purifier makes. It says what fraction of its
     host-declared output the ground under it will actually support. One system
     owns the rate, the other owns the terrain — and the two cannot disagree
     about the rate because only one of them has ever seen it.
   ════════════════════════════════════════════════════════════════════════════ */

export const WATER = {

  /* ── UNITS ────────────────────────────────────────────────────────────────
     node-city prices water as an abstract "per minute" ledger quantity: a
     Purifier declares `gen: { water: 1.2 }` and a citizen drinks 0.015/min.
     Those are the numbers the build panel already prints, so they stay the
     model's internal unit and nothing here rescales them.

     `unitM3` exists purely so the PANEL can speak like a waterworks — "18 m³/min
     of 24 m³/min" reads as a utility, "1.08 of 1.44" reads as a spreadsheet.
     ⚠ COSMETIC ONLY. No simulation result may depend on unitM3; it is applied
       at format time in panel.js and nowhere else. */
  unitM3: 15,

  /* ── THE CITY'S ENDOWMENT ─────────────────────────────────────────────────
     The shape of a city's hydrology, as a pure function of its id. Same
     reasoning as /src/economy/endowment.js's SHAPE block, and the same warning:
     these are the dials that decide how different two cities feel, and the FLOOR
     below them is the promise that no city is unplayable.

     🔴 `minBasinStrength` IS THE FLOOR AND IT IS LOAD-BEARING.
        /src/economy/endowment.js pins `rawWater` to at least POOR on every node
        and its header says exactly why: "Water is an input to a third of the
        graph … A node with no water is not 'specialised', it is unplayable, and
        the player did not choose the node." This module answers a FINER question
        than that one (where the water is, not whether there is any), so it must
        never be able to answer "nowhere". Every city gets at least one aquifer
        at this strength, however arid it rolled. */
  endow: {
    // Wetness is the mean of two independent rolls, which makes it TRIANGULAR
    // rather than flat: most cities are ordinary, and a genuinely arid or a
    // genuinely springfed city is rare enough to be worth remarking on. A flat
    // roll made every third city an extreme and the extremes stopped meaning
    // anything.
    wetnessRolls: 2,
    basinsMin: 1,
    basinsMax: 4,
    // Radius of an aquifer, in tiles, before wetness scaling. A basin smaller
    // than ~2 tiles is a dot the player cannot aim a building at; bigger than
    // ~6 and a 24×24 city is one uniform blue field with no decision in it.
    radiusMin: 2.2,
    radiusMax: 5.6,
    minBasinStrength: 0.38,
    // Natural purity BEFORE any pollution. Not every city drinks sweet water —
    // a brackish aquifer is a permanent fact about the place, exactly like a
    // POOR ore seam, and it is why `purity` is part of the endowment and not
    // only a pollution readout.
    purityMin: 0.68,
    purityMax: 1.00,
    // Surface water appears above these wetness marks. A river is rarer than a
    // lake because a river is the stronger source AND the pollution highway.
    lakeAbove: 0.34,
    riverAbove: 0.52,
  },

  /* ── THE AQUIFER AS A FINITE BODY ─────────────────────────────────────────
     Volume is in UNIT-MINUTES — "how many minutes of one unit of draw" — the
     same unit /src/power uses for its battery, and for the same reason: it is
     the unit the rest of the model is already in, so the conversion to anything
     human happens once, at format time.

     🔴 RECHARGE IS WHAT MAKES A DRY CITY A CONSTRAINT RATHER THAN A COUNTDOWN.
        An aquifer with volume and no recharge is a fuel tank: every city
        eventually empties it and the mechanic becomes a timer nobody can play
        against. With recharge, over-pumping is a CHOICE with a visible cost and
        a reversible consequence — stop pumping and the level comes back. */
  aquifer: {
    /* ⚠ MEASURED, NOT GUESSED, AND THE FIRST VALUE WAS WRONG BY 6×. At 260 the
       reserve under an ARID city was ~2,400 unit-minutes against an overdraft of
       ~0.18/min: a full day of play, plus a 12-hour absence run through
       offlineCatchUp, moved the level by five per cent. A depletion mechanic
       nobody can perceive inside a session is flavour text with a save field
       attached. At 40 the same basin visibly falls over an afternoon, empties in
       ~35 hours of continuous over-pumping and refills in about the same — long
       enough to be a decision, short enough to be a consequence. */
    volPerTileStrength: 40,       // unit-minutes per covered tile at strength 1
    rechargePerTileStrength: 0.030,  // units/min per covered tile at strength 1
    // A basin that sits under surface water is fed by it. This is not flavour:
    // it is why a river city can pump hard and an arid one cannot, and it falls
    // out of the endowment for free because both layers are pure functions of
    // the same id.
    springfedMul: 3.2,
    // Below this the overlay and `sourceAt` stop calling it an aquifer. Without
    // a cutoff every tile in the city is "on groundwater" at 0.03 strength and
    // the map says nothing.
    minRead: 0.10,
    // Drawdown bites on a curve, not linearly: the first third of the reserve
    // costs almost nothing, the last third costs most of the yield. A linear
    // level→yield made a half-empty aquifer feel identical to a full one right
    // up to the cliff.
    yieldCurve: 0.55,
  },

  /* ── SURFACE WATER ────────────────────────────────────────────────────────
     Rivers and lakes. Stronger than groundwater, effectively unlimited — and
     the thing that carries pollution to everyone downstream of the mistake.

     ⚠ SURFACE WATER DOES NOT BLOCK CONSTRUCTION, ON PURPOSE. Making a river
       tile unbuildable would retroactively invalidate buildings standing in
       EXISTING SAVES — a city built before this file existed would open with
       its Purifier "in the river" and no way to have known. Placement is owned
       by tryPlace() and by other workflows this round; this layer is advisory
       and additive, and says so out loud in the panel. */
  surface: {
    flowCenter: 0.92,     // flow value on the channel itself
    flowBank: 0.44,       // …and on the tiles either side of it, so a building
                          // BESIDE the river still benefits — which is where a
                          // waterworks actually goes.
    lakeFlow: 0.62,       // still water: plentiful, but no current
    purity: 0.94,         // surface water starts cleaner than brackish ground…
    // …and dirties far faster, because it is open. This is the whole reason the
    // screenshot's lesson is "place the plant away from the water".
    taintRise: 2.4,
    taintFall: 0.55,
    // How far a taint travels downstream, as a fraction per tile of channel.
    // Modelled as a single city-wide river taint with this as the share that
    // reaches the far end, because a 24-tile channel is not long enough for a
    // per-tile transport model to say anything a single number does not.
    downstream: 0.75,
  },

  /* ── EXTRACTION ───────────────────────────────────────────────────────────
     🔴 THE ONE PLACE THIS MODULE TOUCHES THE HOST'S ECONOMY, AND THE REASON THE
        BAND IS SHAPED THE WAY IT IS.

        node-city has exactly ONE water building — the Purifier, which
        "condenses clean water" — and a `water` ledger resource that citizens
        drink. The task was to wire to those rather than invent a parallel
        resource, so the Purifier IS the waterworks: over an aquifer it is a
        well, beside a river it is an intake, and on dry ground it is what its
        description already says, an atmospheric condenser.

        `atmos` is therefore a FLOOR, not a penalty basket. A Purifier on dry
        ground still delivers 0.80× of what it delivers today, because every
        EXISTING SAVE has its purifiers placed by a player who could not see
        groundwater when they placed them. A retroactive 50% water cut on a
        lived city is exactly the silent balance break the save-compatibility
        rule forbids — see /src/power/tuning.js `transmission.enforce` for the
        same argument made about brownouts. Good placement is worth up to 1.80×;
        bad placement costs at most 20%. The upside is the mechanic.
     🚫 REJECTED: gating the Purifier's construction on groundwater. That is the
        HARD-GATE shape /src/economy/endowment.js uses for ore, and it is only
        acceptable there because a resource you cannot mine you can always BUY.
        You cannot buy water in node-city — there is no import path for a ledger
        resource — so a hard gate on water is a hard gate on the city living. */
  extract: {
    atmos: 0.80,          // the floor: condensation, available anywhere
    groundGain: 0.85,     // …plus this much for a full-strength clean aquifer
    surfaceGain: 0.95,    // …or this much for an intake on strong flow
    min: 0.80,
    max: 1.80,
    // Only the part ABOVE `atmos` is pumped out of the ground, because only that
    // part came from the ground. Getting this wrong in the obvious direction
    // (charging the whole output against the aquifer) drains every basin in a
    // city that would never have touched one.
  },

  /* ── PURITY AND WHAT DIRTY WATER COSTS ────────────────────────────────────
     A contaminated source is not unusable — it is expensive. The plant rejects
     part of the draw, which shows up as less water per minute from the same
     building, which the host's existing coverage system already punishes as
     thirst. That is the traceable consequence: no new failure mode was invented,
     an existing one is now reachable by putting a coal plant on your aquifer. */
  purity: {
    usableFloor: 0.25,    // even filthy water yields this share after treatment
    exp: 1.6,             // …and clean water is worth its purity on this curve
    // How much a full taint (1.0) reduces the source's purity.
    bite: 0.85,
    // Ground taint tracks the pollution module's ground field at these rates,
    // per minute. Rising fast and falling slowly is the honest asymmetry: an
    // aquifer poisons in weeks and clears in decades.
    groundRise: 0.9,
    groundFall: 0.18,
    // Below this a basin is called CONTAMINATED in the panel and drawn in the
    // taint colour on the overlay — the "polluted part visibly different from
    // the clean part" the brief asks for.
    warnBelow: 0.72,
    badBelow: 0.45,
  },

  /* ── METERS ───────────────────────────────────────────────────────────────
     Where red becomes amber becomes green, as a fraction of the bar. Same
     grammar as /src/power/panel.js so the two info views read as one
     application: a static gradient, and only the marker moves. */
  meters: {
    // supply/demand, normalised: 0 → 0.00, 1 → 0.55, 2+ → 1.00.
    supply:   { red: 0.30, amber: 0.55, ratioFull: 2.0 },
    reserve:  { red: 0.25, amber: 0.55 },   // mean aquifer level
    purity:   { red: 0.45, amber: 0.72 },   // mean purity, weighted by draw
  },

  causes: { maxRows: 7, minShare: 0.02 },

  /* ── OVERLAY ──────────────────────────────────────────────────────────────
     🔴 PERFORMANCE, and it is the same constraint /src/power/overlay.js states:
     the city already renders ~1,700 meshes / ~2.8M triangles, and a 24×24 info
     view must not be 576 more. It is ONE plane carrying ONE CanvasTexture that
     every enabled layer paints into — one draw call and one upload however many
     layers are switched on, and only when something actually changed.

     ⚠ `y` is deliberately ABOVE /src/power's 0.06. Both overlays are flat planes
       at the same place in the world, and two coplanar planes z-fight into a
       flickering mess if a player opens both info views. 0.075 is the smallest
       gap that separates them cleanly at this camera distance, and renderOrder
       backs it up. */
  overlay: {
    px: 24,
    y: 0.075,
    /* 🔴 0.55, AND THE FIRST VALUE (0.74) WAS PHOTOGRAPHED AND REJECTED.
       A water field is not like the power overlay's cables: cables touch a few
       dozen tiles, an aquifer touches a quarter of the map at once. At 0.74,
       with a ramp that started near white, the info view was a bright fog laid
       over the whole district — the city underneath it was unreadable, which
       defeats the entire purpose of an overlay whose job is "site this building
       relative to that ground". See .gauntlet/shots/wip-water3.png for the
       version this number replaced. */
    opacity: 0.55,
    renderOrder: 4,
  },

  /* ── COLOURS ──────────────────────────────────────────────────────────────
     node-city's own dark language. Every ramp is stated low→high so overlay.js
     can interpolate generically and the panel's legend strip is generated from
     the SAME array — a hand-written legend beside the ramp it describes is a
     legend that goes stale, which is how a key stops matching the map. */
  col: {
    /* Groundwater, light → deep blue. Same family as /src/power's `groundRamp`
       on purpose: the same thing must not be two colours in two panels.
       ⚠ THE LOW END IS A BLUE, NOT AN OFF-WHITE, AND THAT IS A FIX. It was
         '#dfe7ee', and a thin deposit then painted a pale grey wash that read as
         fog over the terrain rather than as water under it — every low-value
         tile in the city looked like a rendering fault. A data layer has to say
         WHAT it is at every value it can take, including its smallest. */
    aquiferRamp: ['#8fc4e8', '#3d8fd8', '#1c4f9e'],
    // …and the same field once it is poisoned. Deliberately NOT a red: red is
    // the shortage colour everywhere else in this project, and a contaminated
    // aquifer that is still delivering water is not a shortage. Sick olive reads
    // as "wrong" without reading as "empty".
    taintRamp:   ['#9fb36a', '#7d6b2e', '#4e3f18'],
    surfaceRamp: ['#7fd6ea', '#4fd8e8', '#249fc4'],
    drawRamp:    ['#e8e2c8', '#ffe066', '#ff9d3d', '#ff4d3d'],
    well:        '#4fd8e8',
    wellDry:     '#8a8f98',
    stress:      '#ff7a4d',
  },
};

/* Read a WATER path with a loud failure instead of `undefined` arithmetic.
   Same shape as /src/economy's `econ()` and /src/power's `pw()`: a mistyped path
   is a bug that should surface at the call site, not become NaN four frames
   later. */
export function wt(path, fallback) {
  let cur = WATER;
  for (const seg of String(path).split('.')) {
    if (cur == null || typeof cur !== 'object' || !(seg in cur)) {
      if (fallback !== undefined) return fallback;
      try { console.warn('[water] no tuning at WATER.' + path); } catch (e) {}
      return undefined;
    }
    cur = cur[seg];
  }
  return cur;
}
