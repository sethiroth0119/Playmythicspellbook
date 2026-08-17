/* ════════════════════════════════════════════════════════════════════════════
   ☁ POLLUTION — THE ONE TUNING TABLE.
   ----------------------------------------------------------------------------
   CLAUDE.md: "All operation pricing goes through `_opEcon()`. Never hardcode
   economy numbers." /src/economy states the general form of that rule — ECON is
   the single table and no economy number lives anywhere else — and /src/water
   and /src/power each ship their own. This is pollution's.

   🔴 NOTHING IN THIS MODULE MAY WRITE A NUMBER OF ITS OWN. If you find yourself
      typing a literal into field.js, effects.js, overlay.js or panel.js, it
      belongs here. The one exception is a STRUCTURAL constant — a `0.5` that is
      "half of two", not a balance choice — and each of those is commented as
      such where it appears.

   ── THE UNIT, AND WHY IT IS THE COAL PLANT ─────────────────────────────────
   /src/power already computes emissions and already calls
   `MythicPollution.emit(x, z, {air, ground, water})` (see its plants.js banner,
   "POLLUTION EMIT CALL SITE"). The number it passes is:

       amount = POWER.plants[type].emit[channel] × plant.out × dtMin × 0.020

   A Coal Plant is `gen.power 9.0`, `emit.air 1.00`, so at full output it hands
   over **0.180 air-units per minute**. That figure is THE UNIT of this table:
   every industrial source below is written in the same units so that the two
   feeds — power's push and the host's industry pre-pass — are directly
   comparable, and so that a reader can say "that mine is a quarter of a coal
   plant" without doing arithmetic.

   ⚠ AND IT IS WHY `sources` BELOW MUST NEVER CONTAIN A POWER PLANT TYPE. Those
     nine types are emitted by /src/power through emit(); listing one here as
     well would double-count it, and BOTH HALVES WOULD LOOK CORRECT IN REVIEW —
     the exact failure mode /src/water's header describes for its own taint
     push. index.js `selfCheck()` asserts the two sets are disjoint at boot and
     says so out loud if they ever overlap.
     The ONE generator that IS here is `powerstation`, node-city's legacy plant,
     and it is here precisely because /src/power does NOT own it: `POWER.plants`
     has no `powerstation` row, so `emitAll()` skips it and it would otherwise
     be the only fuel-burning building in the game with no exhaust.

   ── EVERY RATE IS PER REAL MINUTE ──────────────────────────────────────────
   node-city's economy tick is `economyTick(ecoAccum / 60)` with `ecoAccum` in
   seconds, so `dtMin` is REAL minutes and every per-minute figure in the host
   is a real minute. A game day is CITY_DAY_MIN = 20 real minutes. Decay times
   below are therefore in real minutes too — the air's 4½-minute half-life is
   about five game hours, and the ground's 45 minutes is a game day and a half.
   ════════════════════════════════════════════════════════════════════════════ */

export const POLLUTE = {

  /* ══════════════════════════════════════════════════════════════════════════
     🌬 WIND — the endowment, and the live reading.
     --------------------------------------------------------------------------
     The screenshot's own note is "look at the visual overlays to check WIND
     DIRECTION and groundwater locations", and orange arrows rake across its
     terrain. Wind is therefore two things here:

       · a PREVAILING DIRECTION that is a pure deterministic function of the
         city's id — /src/economy/endowment.js's pattern, applied to the air
         instead of to the ground. No storage, no migration, no roll at claim
         time: two players on the same node get the same prevailing wind for
         ever, an old save gets the same answer as a new one, and "which side of
         town is downwind" is a permanent, discoverable fact about the place
         that you can plan around BEFORE you spend 150🔥 on a Coal Plant.
       · a LIVE SPEED that rides the weather node-city already simulates.

     🔴 THE SPEED TABLE IS SHARED WITH /src/power AND THAT IS NOT AN ACCIDENT.
        /src/power/plants.js `windSpeed()` prefers `MythicPollution.wind().speed`
        over its own reading — "that module owns the wind for dispersion purposes
        and two wind speeds in one city is two truths about the same air". It is
        right, and this module is the owner. But its own fallback table shipped
        first, and if these numbers differed then EVERY WIND TURBINE IN EVERY
        CITY WOULD CHANGE OUTPUT on the day this module landed — a silent
        retroactive balance change with no player-visible cause, which is exactly
        what node-city's own `powerNeed` comment forbids.
        So `byWeather` and `diurnal` below are deliberately identical to
        POWER.wind's, and index.js `selfCheck()` compares them against
        `MythicPower.tuning.wind` at boot and warns if either side is retuned
        without the other. One owner, one table, and a tripwire on the copy.
     ══════════════════════════════════════════════════════════════════════════ */
  wind: {
    // ⚠ MUST MATCH POWER.wind.byWeather. See above; checked at boot.
    byWeather: { clear: 0.34, rain: 0.52, storm: 0.92, snow: 0.28, tornado: 1.00, firerain: 0.44, anomaly: 0.62 },
    diurnal: 0.16,          // evenings windier than dawns, applied to the above
    cityVar: 0.12,          // …and a per-city offset, so two cities differ

    /* How far the plume actually travels. `tilesPerMin` is the advection speed
       at wind speed 1.0, in tiles per real minute; at the `clear` reading of
       0.34 that is a little over two tiles a minute across a 24-tile map, so a
       plume crosses the city in about ten minutes and a player watching the
       overlay can SEE it move. `calmFloor` stops a dead-calm city from having a
       perfectly static plume — real air always drifts. */
    tilesPerMin: 6.5,
    calmFloor: 0.10,

    /* 🧭 THE PREVAILING DIRECTION, per city.
       `veerDeg` is how far the live wind wanders either side of the prevailing
       bearing over the day. Small on purpose: a wind that swings 180° makes
       siting unplannable and the whole counter-play ("build it downwind of the
       homes") evaporates. `veerPerHour` is how fast it wanders — a slow crawl,
       so the arrows on the overlay drift rather than twitch. */
    veerDeg: 34,
    veerPerHour: 0.42,
    /* …and how much a STORM shoves it. A storm is the one time the wind is
       allowed to do something the player did not plan for, and it is also the
       one time the air clears fastest — see `air.windScour`. */
    stormVeerDeg: 55,

    // The 8 compass points the panel and the overlay name a bearing with.
    // Bearing is measured in degrees CLOCKWISE FROM NORTH, and is the direction
    // the wind BLOWS TOWARD. See wind.js's header — this is the single most
    // reversible convention in the module and it is written down twice.
    points: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
  },

  /* ══════════════════════════════════════════════════════════════════════════
     ☁ THE THREE FIELDS.
     --------------------------------------------------------------------------
     They behave differently and THAT DIFFERENCE IS THE GAMEPLAY:

       AIR    is emitted at a source and CARRIED DOWNWIND. Upwind of a coal
              plant is fine; downwind is not. It clears fast, so the moment you
              shut the plant the air recovers — air pollution is a flow problem.
       GROUND spreads slowly, locally, and does NOT blow away. It is what you
              zone around, and it takes a game day and a half to fade. Ground
              pollution is a stock problem.
       WATER  is what GROUND becomes when it reaches water. Surface water
              carries it downstream; the aquifer underneath drinks it where it
              stands. This is the screenshot's exact lesson.

     `perUnit` converts an emission unit (see the header) into a concentration
     on the source tile. `halfLifeMin` is how long a tile takes to fall to half
     with no source. `spread` is the share of a cell handed to its four
     neighbours each minute.
     ══════════════════════════════════════════════════════════════════════════ */
  air: {
    /* 🔬 MEASURED, NOT GUESSED, AND THE FIRST GUESS WAS OUT BY AN ORDER OF
       MAGNITUDE. The obvious derivation is "steady state = injection ÷ decay",
       which for a Coal Plant's 0.180/min against a 3-minute half-life says a
       source tile should sit near saturation at perUnit ≈ 1. It does not,
       because the air is also being CARRIED: the plume's mass is spread over
       roughly (advection speed ÷ decay rate) ≈ 8 tiles, so the peak is an eighth
       of what the zero-dimensional sum predicts. Driven in the harness at 2.20
       the worst tile in a city with a Coal Plant three tiles upwind of its
       housing read 0.058 — a mechanic that technically ran and that no player
       would ever notice. This value puts that same peak near 0.75, which is what
       "the dirtiest thing you can put on the map" has to look like. */
    perUnit: 14.0,
    halfLifeMin: 4.5,
    /* Isotropic spread is small because ADVECTION does nearly all the work — a
       plume is a streak, not a disc, and a large diffusion term turns it into a
       disc no matter how hard the wind blows. Raised from 0.34 after the same
       run: at 0.34 the plume was one tile wide and slipped between the housing
       blocks, so the city read clean while a row of homes sat in it. A real
       plume fans out; this is the smallest number that fans. */
    spread: 0.55,
    /* Wind both carries AND dilutes. A storm scours the city clean; a still
       night lets the smoke sit on the houses. `windScour` is the extra decay at
       wind speed 1.0, as a multiple of the base rate. */
    windScour: 1.15,
    /* 🌧 RAIN WASHES THE AIR OUT — and it washes it INTO THE GROUND, which is
       why this number appears twice (see `ground.fallout`). A rainy day is a
       clean sky and a dirtier water table, which is both true and a nice thing
       for a player to notice. */
    rainScour: { clear: 0, rain: 1.30, storm: 1.90, snow: 0.85, tornado: 1.10, firerain: 0, anomaly: 0.30 },
  },

  ground: {
    perUnit: 0.18,
    halfLifeMin: 45.0,
    spread: 0.030,
    /* ☁→🕳 FALLOUT. A share of what is in the AIR over a tile settles into the
       GROUND under it every minute. This is what makes the wind matter for the
       ground as well as for the lungs: the ash from a coal plant lands
       DOWNWIND of the stack, not in a neat circle around it, and a player who
       moved their homes upwind has also moved them off the fallout.
       ⚠ It is a TRANSFER, not a copy: the air loses what the ground gains, and
         field.js asserts that every tick. A fallout term that copied instead of
         moved would be a pollution faucet — the same shape as the Cinder Forge
         bug ECONOMY.md exists to prevent, in a different currency. */
    fallout: 0.055,
    // …multiplied by this when it is raining. Rain drags the plume down.
    falloutRain: 3.2,
  },

  water: {
    perUnit: 0.90,
    halfLifeMin: 20.0,
    /* Water spreads FAST compared to ground, because it is water. The spread is
       biased toward tiles that actually have surface water on them — see
       field.js `waterStep` — so a river carries and dry land does not. */
    spread: 0.16,
    /* 🕳→💧 RUN-OFF. A share of the GROUND pollution on a tile passes into the
       SURFACE water on that tile every minute. Only where there IS surface
       water: on dry land the ground keeps what it has, which is the whole
       reason ground pollution is a stock problem.
       ⚠ ALSO A TRANSFER. Same reason as `fallout`.

       🔴 THIS IS NOT HOW THE AQUIFER IS POISONED, AND THAT DISTINCTION IS THE
          ONE THAT KEEPS THE TWO MODULES FROM DOUBLE-COUNTING.
          /src/water/hydro.js `pollutionSample()` PULLS `MythicPollution
          .groundAt(x, z)` over each basin's own footprint every tick and takes
          the WORST reading, then applies its own `WATER.purity.groundRise`.
          That is the screenshot's mechanic and it already exists and works —
          this module's only job in it is to make `groundAt` a real number.
          Pushing a second aquifer taint from here would poison every basin
          twice, and both halves would be individually correct; /src/water's own
          header calls out that trap by name, and so does /src/power's, which is
          why THAT module declines to call `MythicWater.taint()` even though the
          call exists and would work.
          A corollary that is easy to get backwards: ground pollution over a
          deposit is NOT drained away faster. It percolates down and stays, and
          staying is exactly what makes the basin underneath it read it. */
    seep: 0.028,
    /* Downstream drift, in tiles per minute, along the channel. Surface water
       is directional and the pollution goes with it. Small: a 24-tile river is
       not long enough to need a real transport model, and /src/water's own
       hydro.js already applies a city-wide `downstream` share on top. */
    flowPerMin: 1.8,
    // Below this a tile is not water and neither carries nor holds any.
    surfaceMin: 0.12,
  },

  /* ══════════════════════════════════════════════════════════════════════════
     🏭 THE SOURCES — the retro-fit.
     --------------------------------------------------------------------------
     "RETRO-FIT THE EXISTING DIRTY BUILDINGS — the forge, the smelter, the fuel
     rig, the scrap mine — or the feature ships with nothing to pollute."

     Units are the ones the header defines: emission units per real minute at
     LEVEL 1 AND FULL ACTIVITY. The reference is the Coal Plant at
     air 0.180 / ground 0.076 / water 0.018, and every row below is legible
     against it — the Smelting Works is two thirds of a coal plant's air, the
     Mine is a fifth of its air and more than its ash.

     🔴 SCALED BY WHAT THE BUILDING IS ACTUALLY DOING, NEVER BY ITS RATING.
        The host hands over `mult` = node-city's own `tileMult(x, z, t, staff,
        powered)` — the same central production multiplier its output is
        computed from, already carrying level, staffing, adjacency, weather,
        cards and the brownout factor. A smelter with no crew is cold and a
        smelter at level 5 works five times as hard, and both of those are true
        of its chimney too. This is the identical argument /src/power makes for
        keying on `plant.out` rather than on the plant's rating, and it has the
        identical consequence: an idle city is a clean city.

     ⚠ WHY THIS IS NOT THE `powerNeed` MISTAKE. node-city refused to retro-fit
       `powerNeed` to its pre-existing buildings because "doing so would brown
       out every save made before this layer existed" — an INSTANT, retroactive
       penalty applied at load, to a city laid out by a player who could not see
       it coming. Nothing here is applied at load. Every field starts at zero for
       every city, new or old (see field.js `load`), and fills at the rate below,
       which takes tens of minutes of play to bite. The overlay and the panel
       explain it the whole time it is happening, and the counter-play — move
       the homes, or move the works — is available from the first second. A
       consequence you can watch arrive and act on is a mechanic; one that is
       already applied when the page opens is a balance break.
     ══════════════════════════════════════════════════════════════════════════ */
  sources: {
    /* ── The legacy generator. NOT in POWER.plants, therefore ours. ────────
       A boiler burning `use.fuel 0.55` for `gen.power 6.0`. Read against the
       Coal Plant beside it: two thirds the output, a cleaner house, so a little
       under half a coal plant's smoke. */
    powerstation: { air: 0.075, ground: 0.032, water: 0.008, why: 'burns fuel in an open boiler house' },

    /* ── Heavy industry — the four the brief names, first ──────────────── */
    smelter:   { air: 0.120, ground: 0.070, water: 0.020, why: 'furnace smoke and slag' },
    scrapmine: { air: 0.045, ground: 0.090, water: 0.030, why: 'rock dust and tailings' },
    fuelrig:   { air: 0.055, ground: 0.110, water: 0.070, why: 'vented gas and spilled crude' },
    /* 📈 `forge` is the CINDER TRUST — a financial building, despite the name and
       the 📈 icon. It has no furnace and it is deliberately absent. The thing a
       reader of the brief means by "the forge" is `smelter`, above. */

    /* ── The rest of the works ────────────────────────────────────────── */
    machineshop: { air: 0.050, ground: 0.040, water: 0.020, why: 'cutting oil and swarf' },
    quarry:      { air: 0.060, ground: 0.035, water: 0.015, why: 'blasting dust' },
    munitions:   { air: 0.045, ground: 0.055, water: 0.035, why: 'propellant and solvent waste' },
    papermill:   { air: 0.040, ground: 0.030, water: 0.075, why: 'pulping liquor — a water polluter above all' },
    printworks:  { air: 0.030, ground: 0.025, water: 0.040, why: 'ink and press solvents' },
    sawmill:     { air: 0.030, ground: 0.015, water: 0.008, why: 'sawdust and preservative' },
    weavery:     { air: 0.020, ground: 0.020, water: 0.035, why: 'dye run-off' },
    cannery:     { air: 0.018, ground: 0.014, water: 0.030, why: 'boil-house effluent' },
    lumbercamp:  { air: 0.012, ground: 0.010, water: 0.006, why: 'two-stroke saws and skid ruts' },
    railyard:    { air: 0.035, ground: 0.030, water: 0.010, why: 'diesel shunters and ballast oil' },
    medlab:      { air: 0.008, ground: 0.020, water: 0.030, why: 'reagent waste' },
    /* ⛽ THE CS2 CLASSIC, and it is a GROUND polluter more than an air one: what
       ruins the ground under a filling station is the tank, not the exhaust. */
    gasstation:  { air: 0.030, ground: 0.045, water: 0.020, why: 'a leaking tank farm' },
    motorpool:   { air: 0.028, ground: 0.020, water: 0.010, why: 'idling engines and waste oil' },
    /* 🌾 NON-POINT SOURCE. Farms are the classic one — almost no smoke and a
       great deal of run-off. It is small per tile and there are usually a lot of
       them, which is the right shape for the thing it is modelling. */
    farm:        { air: 0.004, ground: 0.012, water: 0.022, why: 'fertiliser run-off' },
    fibercroft:  { air: 0.006, ground: 0.014, water: 0.020, why: 'retting and fertiliser' },
    hydrofarm:   { air: 0.000, ground: 0.004, water: 0.008, why: 'nutrient bleed — it is enclosed' },
    /* 🟣 The arcane one. A Rift Siphon does not burn anything, and what comes off
       it is not smoke — but corrupted essence has to go somewhere, and the
       ground under a siphon is the somewhere. */
    siphon:      { air: 0.020, ground: 0.030, water: 0.010, why: 'corrupted essence bleed' },
  },

  /* ══════════════════════════════════════════════════════════════════════════
     🤒 WHAT IT DOES TO THE NPCs AND THE CITY.
     --------------------------------------------------------------------------
     "A field nobody feels is a heatmap, not a feature."

     Everything below runs through machinery node-city ALREADY has, on purpose:
     a new failure mode would have to be taught, and an existing one that has
     become reachable a new way does not. The four legs:

       ① HEALTH  — exposure raises the city's health DEMAND (it does not lower
                   supply). Sick people need more clinic than well people, so the
                   same Clinic covers fewer of them; `cov.health` falls; the
                   Health vital falls with it. This is the honest direction: the
                   Clinic is not working worse, there is simply more to treat.
       ② MORALE  — a straight penalty on the Hope vital's target. Nobody is happy
                   living in smoke.
       ③ LAND VALUE — a multiplier on what a Lease Plot earns. Poisoned land is
                   cheap land, and this is the one place node-city already prices
                   land per tile.
       ④ THEY LEAVE — and this one needs NO new code at all. `cov.health` is one
                   of the three legs of node-city's population gate
                   (`min(cov.food, cov.water, cov.health)`), so ① already makes
                   people move out of a poisoned city through the exact mechanism
                   the player has already learned. /src/demographics is read for
                   the panel's causal list; it is not written to.

     🔴 EVERY ONE OF THESE IS CAPPED, AND THE CAPS ARE THE SAFETY RAIL FOR OLD
        SAVES. At total saturation on every inhabited tile — which requires a
        city that is essentially one enormous smelter — the worst that can happen
        is `maxHealthLoad` extra health demand, `maxMoraleHit` off Hope, and
        `minLandValue` of the rent. A city cannot be killed outright by a field
        it can watch arrive.
     ══════════════════════════════════════════════════════════════════════════ */
  effects: {
    /* HOW EXPOSURE IS READ OFF THE THREE FIELDS. Air is what you breathe all
       day; water is what you drink; ground is what your children play in. The
       weights say which one hurts, and they sum to 1 so `exposure` is 0..1 and
       comparable with everything else in the module. */
    weight: { air: 0.52, water: 0.33, ground: 0.15 },

    /* ⚠ THE DEAD BAND. Below this, exposure does nothing at all. Without it a
       single farm on a 24×24 map would put a permanent −0.3 on Hope in every
       city in the game, and a permanent tiny penalty that no action can clear is
       indistinguishable from a bug. Above it the response is quadratic-ish
       (`curve`), so a little pollution is genuinely tolerable and a lot is not —
       which is what makes "keep it away from the houses" a strategy rather than
       an evenly-spread tax. */
    deadband: 0.10,
    curve: 1.55,
    /* 🔬 …AND WHERE THE RESPONSE SATURATES, WHICH IS NOT 1.0 AND WAS THE SECOND
       THING THE HARNESS CORRECTED. Normalising the curve over the full 0–1 range
       assumes a tile can be at 100% on all three fields at once; nothing short
       of a city built entirely of coal plants gets near it, so in practice the
       curve only ever used its flattest quarter — a home sitting in a Coal
       Plant's plume at 28% exposure scored a response of 0.083, i.e. an eighth
       of nothing. `satAt` is the exposure at which the effect is FULL: past it
       the block is as bad as a block can be, and the difference between 55% and
       90% is not a difference a citizen can feel. */
    satAt: 0.55,

    // ① Health demand: dem.health × (1 + load), load = 0..maxHealthLoad.
    maxHealthLoad: 0.85,
    // ② Hope: a straight subtraction from its 0..100 target.
    maxMoraleHit: 22,
    // ③ Land value: rent × (1 → minLandValue) as the tile's exposure rises.
    minLandValue: 0.45,

    /* WHERE THE CITY IS MEASURED. Exposure is weighted by WHERE THE PEOPLE ARE,
       not averaged over 576 tiles — a coal plant in an empty corner of the map
       is a local mess and not a public health crisis, and an averaged field
       cannot tell those apart. `homeWeight` is the weight of a housing tile,
       `workWeight` of any other built tile (you breathe at work too), and bare
       ground counts for nothing. */
    homeWeight: 1.0,
    workWeight: 0.35,
    /* …and a floor on the denominator, so a city with one building does not read
       100% exposed because its single tile happens to be the smelter. */
    minWeight: 4,
  },

  /* ══════════════════════════════════════════════════════════════════════════
     🎨 THE OVERLAY.
     --------------------------------------------------------------------------
     ONE PlaneGeometry with ONE CanvasTexture, exactly as /src/water/overlay.js
     and /src/power/overlay.js do it, and for the reason both of them state: the
     obvious build of a 24×24 field is a tinted quad per tile, which is 576
     meshes and 576 draw calls for a layer the player toggles. Turning three
     fields and the wind arrows on costs what turning one on costs.

     ⚠ `y` SITS ABOVE BOTH OF THEM (water 0.075, power 0.06). Coplanar planes
       z-fight into a flicker the moment a player opens two info views, and a
       player comparing a coal plant's plume against the aquifer under it is
       doing precisely what this batch is for.
     ══════════════════════════════════════════════════════════════════════════ */
  overlay: {
    /* `px` is texels per tile: 24 gives a 576×576 canvas for the 24×24 grid.
       /src/water uses 16 and is right to — an aquifer is a soft blob and gains
       nothing from resolution. The ARROWS are why this one is higher: a 16-texel
       tile puts a 48-texel arrow on the screen at roughly half the pixel density
       the camera is showing the ground at, and a blurred arrow does not read as
       a direction. Photographed at 16 and kept at 24. */
    y: 0.09, px: 24, opacity: 0.80, renderOrder: 13,
    /* Below this a cell is not painted at all. A field that tints all 576 cells
       faintly reads as a global colour cast rather than as a located problem.
       ⚠ LOW, AND THE ALPHA CURVE BELOW IS WHAT DOES THE REAL WORK. Photographed
         at 0.045 with a linear alpha floor of 0.26, the plume had a hard
         rectangular edge — the cut-off WAS the edge, so a soft physical gradient
         was drawn as a stencil. The cut is now only there to keep the paint loop
         off empty cells, and the fade is `alphaGain × v^alphaCurve`, which goes
         to nothing on its own. */
    minRead: 0.018,
    alphaGain: 0.88,
    alphaCurve: 0.70,
    /* 🧭 THE ARROWS. The screenshot's orange arrows are a GRID of them across
       the terrain, not one compass rose in a corner — the point is that you can
       read the wind over the tile you are looking at without moving your eyes.
       Every `arrowEvery` tiles, so 24/4 = a 6×6 lattice of 36 arrows: enough to
       read as a field, few enough to stay out of the way of the data under it. */
    arrowEvery: 4,
    arrowCol: '#ffa63d',
    arrowAlpha: 0.92,
    ramps: {
      /* Yellow → orange → red → violet. Deliberately NOT the blue/cyan
         /src/water paints with: a player with both info views open must be able
         to tell "there is water here" from "there is poison here" at a glance,
         and hue is the only channel that survives being half-transparent over a
         lit city. */
      air:    ['#f3e07a', '#e8963c', '#c8442e', '#7d2352'],
      ground: ['#c9b784', '#a3813a', '#6e4a1f', '#3d2a13'],
      water:  ['#8fd6c0', '#b2b04a', '#8a6a2c', '#4a3f18'],
      // The land-value read: green where land is worth what it was, red where
      // it is not. Used by the Land Value layer.
      value:  ['#c0473f', '#d99a2b', '#4caf7a'],
    },
    src: '#ff7a2f',        // the marker on an emitting building
    home: '#8fd0e8',       // …and on a home that is being poisoned
  },

  /* ══════════════════════════════════════════════════════════════════════════
     📊 THE PANEL.
     ══════════════════════════════════════════════════════════════════════════ */
  causes: { maxRows: 8, minShare: 0.03 },
  meters: {
    // Meter stops are RED below `red`, AMBER to `amber`, GREEN above — and every
    // meter in this panel reads LOW IS GOOD, so these are inverted against the
    // water panel's on purpose and the labels say so.
    air:    { red: 0.30, amber: 0.60 },
    health: { red: 0.35, amber: 0.65 },
    value:  { red: 0.35, amber: 0.70 },
  },

  /* ══════════════════════════════════════════════════════════════════════════
     💾 THE SAVE.
     Stored SPARSE — only cells above `saveMin`, quantised to a byte. A clean
     city writes three empty arrays; a filthy one writes a few hundred pairs.
     A dense 576×3 blob would be ~2.3 KB of base64 on every autosave of every
     city whether or not anything was ever built.
     ══════════════════════════════════════════════════════════════════════════ */
  /* ⚠ `min` IS 0.025, NOT 0.008, AND IT WAS MEASURED. At 0.008 the harness's
     one-coal-plant city wrote 598 cell/value pairs — roughly 5 KB of JSON on
     every autosave — because a plume's faint tail eventually touches most of a
     24-tile map. What that tail buys back on reload is nothing: air
     re-equilibrates within a couple of its 4½-minute half-lives, and the two
     fields that actually persist (ground and water) are strongest exactly where
     the threshold does not bite. */
  save: { min: 0.025, quant: 255 },

  /* Diffusion runs on the game tick and is CLAMPED, because the host can hand
     over a very large dt (the offline catch-up runs real economy ticks). A
     minute-long step would make the explicit diffusion unstable; sub-stepping
     keeps it correct at any dt the host can produce. `maxStepMin` is the
     largest single step, `maxSteps` the ceiling on how many are taken for one
     tick — beyond it the remainder is applied as pure decay, which is the right
     limit behaviour: a city left alone for a day comes back cleaner, not
     smeared. */
  step: {
    maxStepMin: 0.35,
    /* 🔴 …AND A COURANT LIMIT, WHICH THE FIRST BUILD DID NOT HAVE. The diffusion
       needs `spread × h ≤ 1`, which `maxStepMin` gives. ADVECTION needs
       something else: if the wind carries the air more than about a third of a
       tile in one sub-step, the semi-Lagrangian gather reaches PAST the source
       cell and the chimney's own tile empties itself faster than it fills.
       Measured in the harness at a 0.5-minute tick: the stack read 0.167 while
       the tile two downwind read 0.743, and the same city at the live cadence
       (~1-second ticks) read 0.71 at the stack — the field depended on how big
       the caller's dt happened to be, which is exactly the bug a stable
       integrator is supposed to not have. So the sub-step count is the larger of
       the two limits, and the field now reads the same at 1-second ticks, at
       half-minute ticks and through the offline catch-up. */
    maxAdvectTiles: 0.34,
    maxSteps: 32,
  },
};

export default POLLUTE;
