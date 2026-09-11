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

  /* ── 🌊 THE SEA ───────────────────────────────────────────────────────────
     THE THIRD BODY TYPE, AND THE ONLY ONE EVERY CITY HAS. `surface` above gives
     a city a river only above `riverAbove` (0.52 on a triangular wetness, i.e.
     about 46% of cities) and a lake only above `lakeAbove`. The sea is not
     rolled: it is off the east edge of every map, always, which is why it is the
     one body a player can be taught to plan around.

     🔴 WHY IT LIVES HERE AND NOT IN /src/ocean's OWN TABLE. /src/ocean draws the
        water. This file decides where the waterline IS. If the module that draws
        the sea also owned its position, then `sourceAt()` would answer "no water
        here" on a tile the player can see the sea from — the exact "fourth
        truth" failure /src/water/index.js's cross-workflow note is written
        against, with the added insult that the player is LOOKING at the
        contradiction. So endowment.js owns `shoreOffsetAt()` and /src/ocean
        imports it. One waterline, two consumers.

     ⚠ EVERY LENGTH BELOW IS IN TILES, measured from the PLATE'S EAST EDGE —
       which is tile coordinate `grid - 0.5`, i.e. world +HALF. endowment.js
       never sees world coordinates and must not start; /src/ocean converts once,
       at the one place it has the host's HALF.

     🔴 …AND `flow` IS NOT IN THIS TABLE AT ALL, WHICH IS DELIBERATE AND IS THE
        WHOLE OF THE "salt is salt" RULE. /src/power/plants.js sites a Hydro
        Plant on `MythicWater.sourceAt(x,z).flow >= spec.minFlow`. Registering
        the sea as FLOW would make a dam siteable on the coast of every city in
        the game — converting a wet-city reward into a universal one, off the
        back of a RENDERING feature, and doing it on salt water where a dam is
        wrong anyway. A sea has no current. `sourceAt` therefore keeps reporting
        `flow` as FRESH surface presence whichever body wins, and a coastal tile
        with no river on it reports flow 0 and the dam is refused, in the same
        words it is refused inland today. */
  sea: {
    /* How far EAST of the plate's edge the mean waterline sits, in tiles.
       🐞 2.05 AND NOT 1.45, AND THE 0.6 IS MEASURED RATHER THAN CHOSEN.
          node-city's perimeterScenery lays a ring road hugging the plate:
          carriageway from HALF+0.16, kerb, then a footway whose outer edge is
          at HALF+1.21. A waterline inside that runs the sea over a road the
          city walks on. 2.05 − `bow` (0.30) = HALF+1.75 at the closest the
          coast can ever come, which leaves the promenade a 0.54-tile verge at
          its narrowest. */
    inset: 2.05,
    /* The coast is not a ruled line. Two sines with per-city phases, summed at
       these weights — the coarse one gives the map a bay and a headland, the
       fine one keeps the waterline from reading as a single smooth arc.
       ⚠ AMPLITUDE IS CAPPED AT `bow` BY CONSTRUCTION (the weights sum to 1), so
         the clearance argument above is a proof and not a hope. */
    bow: 0.30,
    wavePeriodCoarse: 17.0,   // tiles
    wavePeriodFine: 6.5,
    weightCoarse: 0.62,
    weightFine: 0.38,

    /* ── WHAT THE SEA IS WORTH TO A WATERWORKS ─────────────────────────────
       How far the sea reaches, in tiles, MEASURED FROM THE WATERLINE.
       🐞 IT WAS 3.0 AND THAT PUT THE COAST OFF THE MAP, WHICH IS A UNITS BUG
          AND NOT A BALANCE ONE — measured, on 20 city ids, before the fix:

            seaAt(last column)  0.012 … 0.107     kind 'sea' in 12 of 20

          …i.e. eight cities in twenty had a visible sea and an east edge that
          still answered `kind: 'none'`, which is the precise defect this whole
          integration exists to prevent. The reason is arithmetic: the waterline
          sits at `inset` (2.05) past the plate EDGE, and the plate edge is
          another 0.5 past the last column's CENTRE — so the nearest tile a
          building can stand on is already ~2.55 tiles from the water before the
          falloff starts. A reach of 3.0 had 0.45 of usable band left.
          At 6.0 the same measurement gives 0.44 at the last column, 0.10 three
          columns in and nothing by the fourth: a coastal STRIP a player can plan
          a district against, and dry land for the other 21 columns.
       ⚠ WHICH IS WHY THE PANEL DOES NOT PRINT THIS NUMBER. "reaches 6 tiles
         inland" is false — six tiles inland is 2.5 tiles off the map. It prints
         `seaInland`, counted off the real field. See endowment.js. */
    reach: 6.0,
    /* Strength at the waterline itself, falling to 0 at `reach`. Below a strong
       river (flowCenter 0.92) on purpose: an intake on a river beats a
       desalination plant, and the endowment should keep saying so. */
    strength: 0.70,
    /* 🧂 SALT. This is the number that stops the sea from being a free river.
       `usable()` turns purity into the share of a draw that survives treatment
       (floor 0.25, exponent 1.6): at 0.30 that is 0.25 + 0.75·0.30^1.6 = 0.36,
       so a coastal plant runs for about a third of what a clean intake gives
       it. Sea water is not dirty — it is SALT, which costs energy to remove —
       so it is modelled where the cost lands (yield) and it does not decay: the
       sea is never "cleaned up" and never gets worse. */
    purity: 0.30,
    /* The body's name, for the panel and for `sourceAt().name`. */
    name: 'Sea',
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
    /* 🌊 …or this much for a plant on the coast. Deliberately BETWEEN ground and
       surface as a headline number and well below both after `usable(0.30)`
       bites: at the waterline the whole coastal term is 0.90 × 0.70 × 0.36 =
       0.23, so a purifier on the beach delivers ~1.03× against the 0.80× floor
       it gets on dry ground.
       🔴 THAT DIRECTION IS THE SAFE ONE AND IT IS THE ONLY DIRECTION ALLOWED.
          Every existing save has purifiers placed by a player who could not see
          a coastline, and some of them stand in the last three columns. This
          round makes those buildings slightly BETTER and can never make one
          worse, refused or relocated — which is the save rule from `extract`'s
          own header, applied to the body this round added. */
    seaGain: 0.90,
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

  /* ── 🚰 THE MAINS ─────────────────────────────────────────────────────────
     Pipes. The player drags a run, the run is a graph, and a waterworks that
     cannot reach the city through that graph cannot deliver what it pumps.

     🔴 WHY THIS IS ALLOWED TO BITE WHEN /src/power's `transmission.enforce` IS
        NOT. The grid module computes connectivity, line loss and an unserved
        list and then applies NONE of it, because turning it on would black out
        buildings standing in EVERY EXISTING SAVE — every one of them was placed
        by a player who could not see a grid. That argument is about SAVES, and
        it does not transfer to a building that did not exist until this round.
        So the mains govern by an OPT-IN THE PLAYER TAKES:

          ① A city with no pipe, no Water Station and no Sewer Outfall is
            UNPLUMBED. Every waterworks in it is delivered at 1.00×, i.e. byte
            for byte what it produced before this file existed. Every save
            written before this round is in this state by construction — the
            flag is DERIVED from the city, never stored, so it cannot drift.
          ② Once the city is plumbed, `governs` decides WHICH waterworks answer
            to the mains — and it is not a list in this file. The BUILDINGS row
            declares `mains: true` and the host hands the flag over per well
            (`w.mains`). node-city's own `roadsAdjacentTo(match)` header records
            why: a list comparison in a second file is how a type quietly falls
            out of a rule nobody re-read. Today exactly one row carries it, the
            Water Station, so no building that can be in an old save is
            governed and NO CITY IS RETROACTIVELY DRIED OUT.
          ③ The sewer factor below has no list either: untreated waste fouls the
            shallow ground the intakes ON THAT MAIN draw from. It is safe to
            apply with no exemption because its LOAD is zero until the player
            attaches demand to the mains — see WATER.sewer.

     🔴 AND THE UNIT OF BOTH FACTORS IS THE CONNECTED COMPONENT, NOT THE CITY.
        A waterworks answers for the main it is standing on and for the demand
        nearest it that no main reaches; a backup is charged to the main it is
        standing in. The first version of network.js divided by CITY totals in
        both legs, and both mistakes reported success: two properly plumbed
        districts each ran at 0.650 while the same solve said every building was
        served, and two outfalls on one run treated a disconnected run's sewage
        to a bit-perfect 1.000, below `warnAbove`, so nothing was said anywhere.
        A citywide denominator also breaks the only advice the panel can give —
        "lay a run of pipe" cannot move a ratio whose denominator is the city.

     ⚠ A PIPE IS NOT A TILE, AND THAT IS A CORRECTNESS DECISION, NOT A STYLE ONE.
       Pipes are underground and live in this module's own set, keyed by
       "x,z". They never enter `game.tiles`, so they cannot mint a new tile type
       — which is the bug class node-city has now named three times (TRUCK_STOPS
       "seventh instance", a load-order snapshot "eighth"). A pipe under a road
       therefore costs the road nothing: no maintenance cap, no invisible
       building with no buildMesh arm, no agent despawn on a type change, no
       zoning fill escaping its block. */
  mains: {
    /* Authored on node-city's OWN 2..600 shelf — the host multiplies it by
       BUILD_CINDER_MULT in scaleCost(), the one helper that prices everything
       the city builds. /src/streets/index.js records the failure this avoids:
       reading a raw table figure quotes 100× low and looks perfectly correct.
       A pipe is ~⅓ of a road tile: cheap enough to plan a network with, dear
       enough that the network is a plan. */
    pipeCost: 1.4,
    // The reach of a main, in tiles, orthogonal. 1 = the pipe under the street
    // serves the plots either side of it, which is the whole reason a CS2 main
    // follows a road.
    reach: 1,
    /* 🌊 THE FLOW ANIMATION. Tiles per second the dashes travel, the dash
       period in tiles, and the share of the trunk width the moving dash
       takes. Speed is DELIBERATELY SLOW: this is a readout saying 'this run
       is carrying', not a river. At 1.6 tiles/s a 20-tile main takes about
       12 s end to end, which is legible without pulling the eye off the map.
       ⚠ THE ANIMATION IS NOT FREE AND IS THEREFORE GATED THREE WAYS in
         netui.js: the mains layer must be VISIBLE, at least one component
         must be LIVE, and the frame loop stops itself the moment either
         stops being true. A dead network animates nothing and costs nothing,
         which is the same contract the signature gate already keeps. */
    flowSpeed: 1.6,
    flowDash: 0.9,
    flowWidth: 0.52,
    /* 🔴 THE FLOOR, AND IT IS NOT ZERO. A Water Station off the mains still has
       a yard, a tank and a tanker bay; what it loses is the network. 0.30 is a
       bite the player cannot miss and cannot mistake for weather — and the
       remedy is one drag. A zero here would make an unfinished network
       indistinguishable from a broken building. */
    unpiped: 0.30,
    // Longest single dragged run, so one slip of the pointer cannot spend a
    // treasury. The toolbar prints the count and the price before the button.
    maxRun: 48,
    /* Above /src/water's own info-view plane (0.075), which is above /src/power's
       (0.06). Three flat planes over one ground z-fight into a flicker the first
       time a player opens two info views; the y-stack is the only thing keeping
       them apart. */
    overlayY: 0.088,
    overlayOpacity: 0.92,
    renderOrder: 6,
  },

  /* ── 🚱 THE SEWER ─────────────────────────────────────────────────────────
     Water that goes into a city comes back out. Where it leaves is the Sewer
     Outfall, and it has to reach open water.

     🔴 THE LOAD IS ZERO UNTIL THE PLAYER ATTACHES DEMAND TO THE MAINS, which is
        what makes this safe to apply to every waterworks with no exemption list.
        Sewage is charged on the demand the pipe network actually SERVES: an
        unplumbed city owes nothing, a half-plumbed city owes half, and the bill
        grows exactly as fast as the player chooses to grow it. There is no
        moment at which a city wakes up owing a treatment plant it never built.

     ⚠ NO RATE IS INVENTED HERE. `returnFrac` is a fraction of the host's OWN
       water figures — the draw it already charges and the drink rate it already
       publishes — for the same reason `extract` is a multiplier: this module has
       never seen a rate and must not start now. */
  sewer: {
    // Share of served water that comes back as waste. Municipal return factors
    // sit around 0.8; the rest is drunk, evaporated or built into goods.
    returnFrac: 0.80,
    /* How much waste one Outfall level clears, in the host's own per-minute
       water units — declared on the BUILDINGS row as `sewer: { cap }`, not
       here, because it is a property of the BUILDING and the host owns rates.
       This is only the fallback for a row that forgets to say. */
    capFallback: 4.0,
    // Surface flow (river / lake) an outfall needs to discharge into. Below this
    // it is a damp bank, not open water.
    minFlow: 0.30,
    /* 🌊 …and for the SEA, measured in TILES INLAND OF THE WATERLINE rather than
       against a strength threshold.
       🐞 THE STRENGTH TEST WAS WRITTEN FIRST AND WAS DEAD ON ARRIVAL, and the
          driven test is what caught it. `WATER.sea.inset` puts the mean
          waterline 2.05 tiles EAST OF THE PLATE — deliberately, so the coast
          cannot run over perimeterScenery's ring road — so the strongest sea
          any on-grid tile reads is about 0.03 of `sea.strength`, not 0.7 of it.
          A gate written as "≥ 70% of full sea" therefore matched NO TILE IN ANY
          CITY, and it would have looked exactly like a gate that simply
          preferred the map edge: the ③ fallback answered every time and the
          feature would have shipped with its primary rule never once firing.
       So the band is `shoreAt(z) − x ≤ shoreTiles`, which is the same question
       `seaStrengthAt` asks (`d = shoreX − x`) with the smoothstep taken off.
       ⚠ 5.0, NOT `WATER.sea.reach`'s 3.0, AND THE DRIVEN TEST IS WHY. The
         waterline sits 1.6–2.4 tiles beyond the plate depending on where the
         bow falls, so a 3.0 band puts the entire legal coast on column 23 — the
         map edge, which rule ③ already covers — and on the rows where the bow
         pushes the sea furthest out it leaves NO legal tile at all. 5.0 makes
         the waterfront two to three columns deep, always satisfiable, and DEEPER
         IN A BAY than on a headland, which is a fact about the coast the player
         can see and plan against.
       ⚠ AND IT IS THE SHORE, NOT THE WATER. An outfall does not stand in the
         sea; it stands on the bank and discharges through a headwall, which is
         exactly what makeOutfall draws — a stepped apron falling off the tile.
         The rule is "close enough to reach the water", and the refusal says so
         in those words. */
    shoreTiles: 5.0,

    /* ══ 🌊 THE SEA DRAIN ═══════════════════════════════════════════════════
       THE SEWER'S SEA-ONLY ENDPOINT, AND THE DECISION BEHIND IT WRITTEN DOWN.

       🔴 IT IS A NEW SIBLING OF `outfall`, NOT `outfall` RELOCATED. The Sewer
          Outfall stands ON the plate and discharges into the sea, a river, a
          lake, or the channel off the map edge — three rules with a fallback,
          which is what makes it always satisfiable and therefore what makes it
          safe to have shipped. Narrowing it now to "sea only" would put every
          outfall standing on a river bank in an already-written save into
          violation of a rule it was never shown. The drain is the STRICTLY
          STRONGER rule on a NEW endpoint that no old city can be holding: it
          may stand nowhere but in open water. Nothing that exists is re-judged.

       🔴 AND IT STANDS OFF THE PLATE, WHICH IS WHY IT IS NOT A BUILDINGS ROW.
          Measured, over 24 city ids × 24 rows, against endowment.js's own
          shoreXAt():

              waterline, tile-x     25.253 … 25.849
              waterline, world-x    13.753 … 14.349

          The plate's last column is tile 23 (world +11.5) and its east edge is
          world +12. So there is NO on-grid tile in the water and there never can
          be — `sea.inset` (2.05) holds the coast clear of perimeterScenery's
          ring road on purpose, and pulling the waterline back onto the plate to
          make a tile wet would run the sea over a road the city walks on.
          A drain therefore lives in the APRON: cells east of the plate, picked
          with node-city's cellFromEvent(ev, pad), owned and drawn by /src/water.
          Exactly /src/power's Grid Connector, which is off-plate for the same
          class of reason and is the shipped precedent for an off-plate terminal
          that a dragged network reaches.

       ⚠ `apron` IS 3 AND THE THIRD COLUMN IS THE ONLY LEGAL ONE. From the
         measurement above: cell x = 24 is world 12.50 and x = 25 is 13.50, both
         inland of even the closest waterline (13.753); x = 26 is world 14.50,
         which clears even the furthest (14.349) by 0.151. So column GRID+2 is
         wet in EVERY city and every row, and the two before it never are.
         2 would leave rows — sometimes all of them — with no legal cell, which
         is the failure mode `shoreTiles`'s 🐞 above records happening once
         already: a rule that can be unsatisfiable is a rule that bricks a city.
         The apron is not the rule; MythicOcean.isSea is. The apron is only how
         far a pipe and a pointer are allowed to go looking for it. */
    drain: {
      apron: 3,
      /* Nameplate, in the same per-minute water units BUILDINGS.outfall.sewer
         declares (5.0 at level 1). Dearer per unit than the Outfall and worth
         nearly twice as much, because it costs a run of pipe across the whole
         city to reach and it can never be levelled up — the Outfall is a
         building with MAX_LVL behind it, the drain is a headwall. */
      cap: 9.0,
      /* On node-city's OWN 2..600 shelf — the host's scaleCinder multiplies it
         by BUILD_CINDER_MULT. Between the Outfall (26) and the Water Station
         (34): a real commitment, and one that only pays back once the pipe run
         that reaches it is also paid for. NEVER read raw; /src/streets records
         what that costs (a quote 100× low that looks perfectly correct). */
      cost: 46,
      /* Margin handed to MythicOcean.isSea, in world units. ZERO, deliberately:
         a positive margin pushes the answer INLAND and would make a cell the
         player can see is dry read as sea; a negative one would put the drain
         further out than the mesh. The predicate is the rule, unmodified. */
      margin: 0,
      /* The headwall's silhouette, in world units. It stands in shallow water,
         so its deck is above the ocean surface (OCEAN.extent.y = 0.035) and its
         apron falls below it — the same read makeOutfall gives on land. */
      deckY: 0.16,
      size: 0.78,
    },

    /* 🔴 WHAT A BACKUP COSTS. Waste standing in the streets soaks into the
       shallow ground the intakes on THAT MAIN draw from, so a full backup takes
       this share off the delivery of every waterworks standing on it — and off
       none of the ones on a main that treats its own waste. Half, not all: a city
       that cannot treat its sewage is crippled, not killed, and a mechanic that
       can reach zero is one the player can lose a city to while reading a
       panel. */
    bite: 0.50,
    // Below this the panel stops calling it a backup. Rounding on a 24-tile
    // grid should not raise an alarm.
    warnAbove: 0.02,
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
    /* 🚰 THE MAINS. Deliberately NOT in the aquifer's blue family: a pipe is a
       thing the player built and the aquifer is a thing they found, and an
       overlay that draws both in the same blue makes the player hunt for which
       of the two they are looking at. Cyan-white for a served main, a dead
       slate for one no waterworks can reach, and the ember the rest of this
       project uses for a refusal on the drag preview. */
    pipe:        '#6fe3f5',
    /* 🌊 The moving half of a live main. Brighter than `pipe` so the dashes
       read ON the trunk rather than beside it, and only ever drawn over a
       component that has a waterworks on it — see netui.js's flow pass. */
    pipeFlow:    '#d9fbff',
    pipeDead:    '#6b7480',
    pipeGhost:   '#ffd08a',
    pipeBad:     '#ff5f4a',
    sewer:       '#b9a24d',
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
