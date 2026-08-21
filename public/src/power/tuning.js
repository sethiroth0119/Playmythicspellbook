/* ════════════════════════════════════════════════════════════════════════════
   ⚡ POWER — THE TUNING TABLE. Every number the grid model uses lives here.
   ----------------------------------------------------------------------------
   CLAUDE.md: "All operation pricing goes through `_opEcon()`. Never hardcode
   economy numbers." /src/economy states the same rule as "all economy numbers
   live in ECON (tuning.js)". This file is the power system's ECON, and the rest
   of /src/power reads POWER rather than writing a literal.

   🔴 THE TWO NUMBERS THAT ARE NOT OURS TO OWN.
   `POWER_FLOOR` (0.5) and `DEMAND_PER_POP.power` (0.0625) are declared in
   node-city/index.html and are read by the coverage system, the vitals panel and
   the away report as well as by us. Copying either one here would create a
   second truth about brownouts that drifts the first time somebody retunes the
   host — the exact failure this integration exists to prevent. They arrive in
   the host snapshot instead (`host.floor`, `host.perPop`) and are NEVER given a
   default in this file. If they are missing the solve says so out loud.
   ════════════════════════════════════════════════════════════════════════════ */

export const POWER = {

  /* ── UNITS ────────────────────────────────────────────────────────────────
     node-city prices power as an abstract "per minute" quantity: a Power
     Station declares `gen: { power: 6.0 }` and a Machine Shop `powerNeed: 0.7`.
     Those are the numbers the build panel and the dossier already print, so
     they stay the model's internal unit and nothing here rescales them.

     `unitKW` exists purely so the PANEL can speak electricity. The CS2 reference
     is deliberately honest about mixed magnitudes — "Consumption: 75.3 kW"
     against "Production: 40 MW", so the player reads the headroom before they
     read either number — and that only works if the unit floats. 250 kW per
     unit/min puts one Power Station at 1.5 MW and a Street Light at 12.5 kW,
     which are recognisable magnitudes for what those buildings are.
     ⚠ COSMETIC ONLY. No simulation result may depend on unitKW; it is applied
       at format time in panel.js and nowhere else. */
  unitKW: 250,

  /* ══════════════════════════════════════════════════════════════════════════
     🏭 THE NINE PLANTS
     --------------------------------------------------------------------------
     "Wind Turbines, Coal Power Plants, Natural Gas Plants, Oil Power Plants,
      Solar Power Plants, Geothermal Plants, Nuclear Power Plants, Hydro-Electric
      Plants, and Garbage Incinerators."

     🔴 WHAT IS IN THIS TABLE AND WHAT IS NOT — READ BEFORE ADDING A FIELD.
     node-city's `BUILDINGS` row owns the PRICE, the POPULATION, the CREW, the
     RATED OUTPUT (`gen.power`) and the FUEL DRAW (`use`). Those are the numbers
     the build panel prints and the tick charges, and copying any of them here
     would create a second truth about a Coal Plant's cost that drifts the first
     time somebody retunes the shop. This table owns only what the host has no
     concept of:

       avail   HOW MUCH OF ITS RATING THE PLANT ACTUALLY MAKES right now, and
               why. A multiplier the host applies exactly once, at the one line
               where `def.gen.power` is read — the same one-multiplier-one-
               direction contract /src/water landed for the Purifier.
       site    WHERE IT MAY STAND. A hard refusal with a reason, or null.
       emit    WHAT IT PUTS INTO THE AIR, THE GROUND AND THE WATER, per unit of
               power per minute. Handed to window.MythicPollution.emit() and to
               nothing else — see plants.js's emit call site.
       cls     WHICH DEMAND CLASS its own draw belongs to (generators draw
               nothing today, but the field exists so the ladder is total).

     ⚠ `rated` IS NOT HERE AND MUST NEVER BE. The one number both sides would
       need to agree on is the one number only one side is allowed to hold.
     ══════════════════════════════════════════════════════════════════════════ */
  plants: {
    /* 🌬 WIND — cheap, small, and honest about being unreliable.
       Output rides the weather the game ALREADY simulates (WEATHER/wx in
       node-city), not a wind model invented here: a storm is a windy day and
       snow is a still cold one, and those are facts the player can already see
       in the HUD. When /src/pollution lands and offers a real `wind()`, its
       speed wins — see plants.js `windSpeed()`.
       ⚠ SPACING IS THE SITING RULE AND IT IS WHAT MAKES A ROW OF THEM A LOOK.
         Every occupied tile inside `wakeRadius` costs `wakePerTile`, floored at
         `wakeFloor`. Turbines shelter each other, so a dense block of them is
         genuinely worse than a line along open ground — which is the shape the
         reference photographs of wind farms actually have. */
    wind: {
      label: 'Wind Turbine', model: 'wind', cls: 'utility',
      base: 0.30, gust: 1.05,          // avail = base + gust × windSpeed(0..1)
      wakeRadius: 2, wakePerTile: 0.045, wakeFloor: 0.45,
      emit: { air: 0, ground: 0, water: 0 },
    },
    /* ☀ SOLAR — dead at night, peak at noon. Read straight off node-city's own
       day/night cycle (`hourOf()`, sun up 06:00, down 18:00 — see updateSky).
       ⚠ NIGHT OUTPUT IS ZERO AND THAT IS THE FEATURE. A solar city that has not
         built storage or a second plant browns out every night at the same hour,
         which is a lesson the grid can teach in one in-game day. `nightFloor` is
         0 for exactly that reason and is not a tuning surface. */
    solar: {
      label: 'Solar Farm', model: 'solar', cls: 'utility',
      sunrise: 6, sunset: 18, nightFloor: 0,
      // Weather cut. Cloud is the whole reason a solar farm is not a constant.
      wx: { clear: 1, rain: 0.34, storm: 0.20, snow: 0.30, tornado: 0.22, firerain: 0.45, anomaly: 0.55 },
      emit: { air: 0, ground: 0, water: 0 },
    },
    /* 🪨 COAL — cheap, high output, the dirtiest thing in the game.
       Constant availability: that is its entire appeal and the reason it is the
       trap. Its price is paid in fuel, in crew, in population and in what it
       does to the air and the water table. */
    coal: {
      label: 'Coal Plant', model: 'constant', cls: 'industry',
      base: 1.0,
      emit: { air: 1.00, ground: 0.42, water: 0.10 },
    },
    /* 🔥 NATURAL GAS — cleaner than coal, cheaper to run, still emits.
       Cheaper to RUN means less fuel per unit (the BUILDINGS row), not a
       multiplier here; the availability of a gas turbine is 1 like coal's. */
    gas: {
      label: 'Gas Plant', model: 'constant', cls: 'industry',
      base: 1.0,
      emit: { air: 0.26, ground: 0.05, water: 0.02 },
    },
    /* 🛢 OIL — between the two, on every axis, deliberately. */
    oil: {
      label: 'Oil Plant', model: 'constant', cls: 'industry',
      base: 1.0,
      emit: { air: 0.58, ground: 0.30, water: 0.14 },
    },
    /* ♨ GEOTHERMAL — clean and constant, but ONLY where the ground allows.
       `minHeat` is the hard gate and geology.js is the only thing that answers
       it. Output scales from `atMin` at the threshold to 1 at full heat, so a
       marginal site is a marginal plant rather than a free one. */
    geothermal: {
      label: 'Geothermal Plant', model: 'geothermal', cls: 'utility',
      minHeat: 0.46, atMin: 0.55,
      // Brine and a trace of hydrogen sulphide. Small, not zero — a geothermal
      // plant is clean, not sterile, and a zero here would make it the strictly
      // better button the gate exists to prevent.
      emit: { air: 0.05, ground: 0.04, water: 0.07 },
    },
    /* 💧 HYDRO — needs surface water, and output scales with the flow.
       `flow` is /src/water's own `sourceAt(x, z).flow`, which that module
       documents as "SURFACE presence at this tile whichever source won". It is
       the only field that may be read here: an aquifer's strength under a
       hydro-electric dam would be a confidently wrong answer.
       ⚠ WITH /src/water ABSENT A DAM CANNOT BE SITED AT ALL, and that is the
         honest degrade. Letting it build anywhere at full output because the
         water module 404'd would be the "guarded fallback that fires forever"
         failure wearing its most convincing disguise: a working hydro plant. */
    hydro: {
      label: 'Hydro Plant', model: 'hydro', cls: 'utility',
      minFlow: 0.30, atMin: 0.50,
      emit: { air: 0, ground: 0, water: 0.03 },
    },
    /* ☢ NUCLEAR — enormous output and cost, needs cooling WATER, and carries a
       downside the player must actually manage.

       THE DOWNSIDE IS CORE STRESS, AND IT IS NOT A RANDOM EVENT. Stress rises
       whenever the reactor is running under-cooled — the city's water coverage
       is short, or the plant is under-crewed — and falls whenever it is not. Past
       `scramAt` the reactor SCRAMs: output goes to zero and stays there until
       stress falls back under `restartAt`. So a nuclear city that lets its water
       supply slip does not lose 5% of its power, it loses ALL of it, at the exact
       moment its pumps needed power most. That is a consequence a player can see
       coming, prevent, and recover from, which is what separates a downside from
       a dice roll.
       ⚠ Rising is deliberately SLOWER than falling. A reactor that scrams the
         first time a purifier hiccups is a reactor nobody builds twice. */
    nuclear: {
      label: 'Nuclear Plant', model: 'nuclear', cls: 'utility',
      coolCoverage: 0.55,     // water coverage below this is "under-cooled"
      stressRise: 0.055,      // per minute, at zero cooling
      stressFall: 0.14,       // per minute, when cooled
      scramAt: 1.0, restartAt: 0.35,
      // Derate before the scram, so the meter is a warning and not a cliff.
      derateFrom: 0.55, derateTo: 0.55,
      // Thermal discharge into the water, and effectively nothing into the air.
      emit: { air: 0.01, ground: 0.02, water: 0.20 },
    },
    /* ♻ GARBAGE INCINERATOR — a waste problem turned into an energy answer, at
       an air-pollution price. Output is capped by the garbage the city actually
       makes (see `waste` below), SHARED between incinerators — so the second one
       is worth much less than the first, which is the whole design. */
    incinerator: {
      label: 'Incinerator', model: 'waste', cls: 'utility',
      // Garbage units per minute needed to run one unit of rated output.
      wastePerUnit: 0.55,
      // With no garbage at all it still burns something. Low, because an
      // incinerator with nothing to burn should read as a mistake.
      floor: 0.12,
      emit: { air: 0.68, ground: 0.30, water: 0.06 },
    },
  },

  /* ── 🌋 GEOLOGY (geology.js) ───────────────────────────────────────────────
     The thermal endowment's own numbers. `buildableShare` is the pair verify()
     asserts over 200 city ids, and it is the real statement of intent: between
     a fifth and a half of cities can build geothermal AT ALL. Below that it is a
     myth nobody meets; above it, it stops being a prize. */
  geo: {
    gradientRolls: 4,
    ventInset: 3,
    ventRadiusMin: 2.2, ventRadiusMax: 6.0,
    ventPeakMin: 0.52, ventPeakMax: 0.98,
    springRadiusMul: 0.85, springPeak: 0.44,
    baseFloor: 0.04, baseSpan: 0.30,
    buildableShare: { min: 0.18, max: 0.55 },
  },

  /* ── 🌬 WIND SPEED FROM THE WEATHER THE GAME ALREADY HAS ───────────────────
     0..1, keyed on node-city's `wx.type`. These are not invented weather: every
     key here is a row of node-city's own WEATHER table, and the ordering is the
     one a player already reads off the HUD icon.
     ⚠ SUPERSEDED THE MOMENT /src/pollution SHIPS A `wind()`. That module owns
       the city's wind for dispersion purposes and two wind speeds would be two
       truths; plants.js prefers it and falls back here. */
  wind: {
    byWeather: { clear: 0.34, rain: 0.52, storm: 0.92, snow: 0.28, tornado: 1.00, firerain: 0.44, anomaly: 0.62 },
    // A slow diurnal swing so a calm day is not a flat line — evenings are
    // windier than dawns nearly everywhere. Amplitude, applied to the above.
    diurnal: 0.16,
    // Per-city offset, so two cities in the same weather are not identical.
    cityVar: 0.12,
  },

  /* ── ♻ THE CITY'S GARBAGE ──────────────────────────────────────────────────
     A FLOW, not a stockpile, and deliberately so. Making garbage a CITY_STOCK
     row would mean a save-format change, a HUD chip, a warehouse cap and a
     landfill mechanic — a whole waste-management feature — to power one
     building. The incinerator does not need a pile, it needs a SUPPLY, and a
     supply is what a city with people and shops in it produces continuously.
     ⚠ Every incinerator draws on the SAME flow. Two of them do not double the
       power; they halve each other, which is the counter-play. */
  waste: {
    perPop: 0.055,          // garbage units per citizen per minute
    // …plus what the built city throws out, by demand class. A leisure venue
    // makes far more waste per tile than a farm does.
    perBuilding: { lifeline: 0.05, utility: 0.03, industry: 0.14, commerce: 0.22, leisure: 0.26, none: 0.01 },
  },

  /* ── ☁ EMISSIONS ───────────────────────────────────────────────────────────
     `scale` converts (rated-unit × minute × the per-plant `emit` above) into the
     0..1-ish quantities the agreed MythicPollution.emit() contract speaks in.
     One knob, so /src/pollution can be re-tuned against every plant at once
     rather than nine rows at a time.
     🔴 NOTHING HERE MODELS DISPERSION, DECAY OR HARM. Those belong to
        /src/pollution and re-deriving any of them here would be the second truth
        this repo keeps paying for. This module emits and stops. */
  emit: { scale: 0.020 },

  /* ══════════════════════════════════════════════════════════════════════════
     🔌 THE DEMAND LADDER — "powers homes and buildings different"
     --------------------------------------------------------------------------
     A brownout must not hit everything equally. A hospital or a water pump
     cannot fail the way a nightclub does, and a grid where they do is a grid
     with one number in it.

     🔴 THE INVARIANT THAT MAKES THIS SAFE FOR EVERY EXISTING SAVE.
        The draw-weighted MEAN of the per-tile factors this ladder produces is
        EXACTLY the flat factor node-city computes today:
              mean = floor + (1 - floor) × (served / load)
        Shedding redistributes the same energy; it never destroys or creates any.
        So no city is globally worse off than it was before this ladder existed —
        the lights simply go out in the right order. grid.js asserts that
        identity every tick (`shedAudit`) and falls back to the flat factor if it
        ever fails, for the same reason /src/economy's sim.js suspends the payout
        when its closed loop breaks: a redistribution bug that quietly LOSES
        energy would look exactly like a slightly worse grid.

     `order` is served first to last. `floorAt` is the share of its draw a class
     is guaranteed even when the budget ran out above it — the lifeline classes
     are never fully dark, because a dark hospital is not a difficulty setting.
     ══════════════════════════════════════════════════════════════════════════ */
  demand: {
    order: ['lifeline', 'utility', 'households', 'industry', 'commerce', 'leisure'],
    meta: {
      lifeline:   { label: 'Lifeline',   ico: '🏥', floorAt: 0.55, desc: 'Clinics, medical labs, fire and police. Shed last, and never to nothing.' },
      utility:    { label: 'Utilities',  ico: '🔧', floorAt: 0.35, desc: 'Water, storage, transport and the street lights.' },
      households: { label: 'Households', ico: '🏠', floorAt: 0.25, desc: 'The homes. Charged per citizen, as node-city always has.' },
      industry:   { label: 'Industry',   ico: '🏭', floorAt: 0.00, desc: 'Extraction, refining and fabrication. The first thing a real grid sheds.' },
      commerce:   { label: 'Commerce',   ico: '🛒', floorAt: 0.00, desc: 'Shops, kitchens and the motor pool.' },
      leisure:    { label: 'Leisure',    ico: '🎵', floorAt: 0.00, desc: 'The club, the arena, the stadium. First off the grid.' },
    },
    /* WHICH CLASS EACH BUILDING IS IN. Only types that DRAW appear; anything
       missing is 'none' and is never shed because it never drew.
       ⚠ Keyed on the tile type node-city uses. An OPERATIONS twin (`op_*`)
         resolves through the host's own twinTileType() before it gets here — the
         host hands over the resolved type, so this table never needs an `op_`
         row and cannot drift from WEATHER_TWIN_OPS. */
    classOf: {
      clinic: 'lifeline', medlab: 'lifeline', firestation: 'lifeline', police: 'lifeline',
      purifier: 'utility', streetlight: 'utility', depot: 'utility', warehouse: 'utility',
      railyard: 'utility', hydrofarm: 'utility',
      /* 💧 The Water Intake is the Purifier's other half and sheds with it. */
      waterintake: 'utility',
      /* 🚰 THE MAINS ROUND. Both declare `powerNeed` on their own BUILDINGS rows
         rather than joining `extra` below — no save can contain either of them,
         so the save-compatibility rule that created `extra` does not apply and
         the honest home is the row (the `papermill`/`printworks` precedent, and
         the same reading the four extraction rows above took).
         They still need a CLASS here or they would be billed and never shed,
         which is the half-wired state §③ warns about — and a Water Station that
         browns out while a nightclub does not is exactly the ordering the
         lifeline→leisure ladder exists to produce. Both are `utility`: they are
         the machinery the city's own lifelines run on. */
      waterstation: 'utility', outfall: 'utility',
      farm: 'industry', scrapmine: 'industry', fuelrig: 'industry', gasstation: 'industry',
      quarry: 'industry', lumbercamp: 'industry', fibercroft: 'industry', munitions: 'industry',
      /* ⛏ THE EXTRACTION ROUND. These four declare `powerNeed` on their own
         BUILDINGS rows rather than joining `extra` below — no save can contain
         one, so the save-compatibility rule that created `extra` does not apply
         to them and the honest home is the row (the `papermill` / `printworks`
         precedent). They still need a CLASS or they would be billed and never
         shed, which is the half-wired state §③ warns about. `riftbore` is
         deliberately absent: it is the Rift Siphon's deep twin, and §② lists
         `reslab` / `siphon` as "arcane and run on essence, not amps". */
      deepmine: 'industry', alloyworks: 'industry', canecroft: 'industry',
      smelter: 'industry', machineshop: 'industry', cannery: 'industry',
      sawmill: 'industry', weavery: 'industry', papermill: 'industry', printworks: 'industry',
      grocery: 'commerce', restaurant: 'commerce', motorpool: 'commerce', shop: 'commerce',
      forge: 'commerce', indexfund: 'commerce', holdco: 'commerce', office: 'commerce',
      club: 'leisure', arena: 'leisure', stadium: 'leisure', resthouse: 'leisure',
    },

    /* ══════════════════════════════════════════════════════════════════════
       🔴 THE 33, AND WHAT WAS DONE ABOUT THEM.
       ----------------------------------------------------------------------
       node-city declares `powerNeed` on 21 of its 54 building rows and its own
       comment says why the other 33 were left alone:

         "⚠ powerNeed is deliberately NOT retro-fitted to the pre-existing
          buildings. Doing so would brown out every save made before this layer
          existed."

       That comment is CORRECT and is still load-bearing. It is a statement about
       SAVES, not about whether a Scrap Mine runs on electricity. So the 33 are
       split three ways and only one of the three is a change:

       ① ALREADY CHARGED — 1 row. `housing`. node-city bills residential draw per
         CITIZEN (`DEMAND_PER_POP.power`), which is why the grid's household term
         exists at all. Giving housing a powerNeed would bill the same people
         twice, and the second bill would scale with buildings instead of with
         population. It is deliberately absent below.

       ② GENUINELY OFF-GRID — 17 rows. road, wall, gate, lot, tree, bush, garden,
         fountain, tower, barracks, caravanpost, obelisk, kalonstable, reslab,
         siphon, foodtruck, powerstation.
         Most are self-evident (a wall draws nothing). Three are worth stating:
           · `foodtruck` is off-grid ON THE RECORD — its own description says
             "Runs off its own generator, so a brownout never closes the hatch",
             and that is a promise the player has already been given.
           · `reslab` / `siphon` are arcane and run on essence, not amps. Their
             weather rule already treats them as a separate physics (see
             weatherMult's anomaly branch).
           · `powerstation` and the nine new plants draw NOTHING. A generator
             that consumes grid power is a feedback loop the pre-pass explicitly
             exists to avoid — see the comment above the power pre-pass.

       ③ METERED — 15 rows, listed below. These genuinely run on electricity and
         their absence was an artefact of the save-compatibility rule rather than
         a design statement. They are charged ONLY in a city that has opted in.
         ⚠ AND THEY ARE SHED AS WELL AS BILLED. A metered Scrap Mine both pays
           for electricity and misses it — node-city's tileMult applies the
           ladder's per-tile factor to any tile this module priced, not only to
           tiles carrying a `powerNeed`. Billing without the mechanic would be a
           cost the player can see and a consequence they cannot, which is the
           worse half of the feature on its own.

       🔴 HOW THE OPT-IN WORKS, AND WHY IT IS NOT A SILENT RETRO-FIT.
          A city founded AFTER this landed is metered from its first tick — there
          is no lived save to protect. A city loaded from a save written BEFORE it
          is NOT metered, and the panel says so with a button. Pressing it is a
          player decision, announced, reversible, and saved. That is the whole
          mechanism: one boolean, `metered`, in the module's save blob.
          ⚠ ABSENT ⇒ NOT METERED, and the absence is exactly what identifies an
            older save, so no version number is needed and none is written.
       ══════════════════════════════════════════════════════════════════════ */
    extra: {
      // Extraction — every one of these is a pump, a crusher or a rig.
      farm: 0.12, hydrofarm: 0.55, purifier: 0.45, scrapmine: 0.40, fuelrig: 0.35,
      gasstation: 0.30, quarry: 0.35, lumbercamp: 0.20, fibercroft: 0.15,
      // Logistics and workshops.
      depot: 0.18, warehouse: 0.12, munitions: 0.30, medlab: 0.35,
      // Venues that were somehow exempt while the Club next door was not.
      arena: 0.55, shop: 0.25,
    },
  },

  /* ── STORAGE ──────────────────────────────────────────────────────────────
     The grid module owns transmission and storage; the host owns generation.

     Capacity is expressed in UNIT-MINUTES — "how many minutes of one unit of
     draw" — because that is the unit the rest of the model is already in, and
     converting to kWh at the boundary (panel.js) keeps one conversion in one
     place. 45 unit-min is 187.5 kWh at the rate above, and lets a single plant
     carry its own 6.0/min output for seven and a half minutes.

     ⚠ perPlant, NOT a building. node-city has exactly one generator type
       (`powerstation`), whose own blueprint text reads "Turbine hall, cooling
       stack, transformer yard". A transformer yard is where a grid buffer
       physically lives, so the buffer rides on the plant rather than arriving as
       a new BUILDINGS row. Adding a building type would have been a large edit
       to a file three other workflows are editing this round — see index.js's
       header for the full list of what was deliberately not touched.
     🚫 REJECTED: a flat city-wide buffer independent of plant count. It made the
        first Power Station the only one worth building, because the buffer — not
        the turbines — was carrying the peaks. */
  storage: {
    perPlantUnitMin: 45,
    // Round-trip efficiency. Charging banks 92% of the surplus offered; the
    // other 8% is the loss that makes overbuilding genuinely wasteful rather
    // than merely unnecessary.
    chargeEff: 0.92,
    // A plant will only divert surplus to the buffer once the city is actually
    // in surplus by this margin, so a grid sitting exactly at parity does not
    // oscillate charge/discharge every tick.
    chargeAboveRatio: 1.05,
    // Discharge is capped per minute so a full buffer cannot hide a permanent
    // generation shortfall for an entire session — it smooths peaks, it does
    // not replace a turbine.
    dischargePerMinPerPlant: 3.0,
  },

  /* ══ 🔌 ELECTRICITY TRADE — IMPORT AND EXPORT OVER THE OUTSIDE CONNECTION ══
     ──────────────────────────────────────────────────────────────────────────
     🔴 READ THIS BEFORE TOUCHING ANY NUMBER BELOW. THE METER THIS FEEDS WAS
        DELETED ONCE, ON PURPOSE, AND RESTORING IT ONLY BECAME HONEST LATER.
     The CS2 reference panel carries an ELECTRICITY TRADE row ("Import: 0 kW /
     Export: 0 kW"). When panel.js was first written it dropped that row and
     said why: node-city had no neighbour grid, so the row could only ever read
     0 kW / 0 kW forever — the decorative fallback this whole integration
     refuses. That was correct THEN. `/src/outside` shipped afterwards: a
     highway that runs past the map, a Highway Interchange the player builds, a
     cached connection test over the road graph, and a gate that already stops
     caravans and cross-city deals when the city is cut off. That is the
     neighbour link the meter needed, so the row is back — BESIDE reserve
     margin, not instead of it. Reserve margin answers a different question
     about the same grid and earned its place.

     🔴 AND IT IS STILL NOT ALLOWED TO READ ZERO WHEN IT DOES NOT KNOW.
        Three separate absences are three separate readings, never one:
          · no `window.MythicOutside`  -> "cannot be priced / cannot be tested",
                                         the meter says so and trades nothing
          · no `window.MythicEconomy`  -> ditto: there is nowhere for the money
                                         to go, and inventing somewhere is the
                                         Cinder Forge
          · connected but idle         -> a REAL 0 kW, and the only one of the
                                         three that may be drawn as 0 kW
        link.js returns a `why` string for the first two and the panel prints
        it. A guarded read that silently falls back to zero forever is the exact
        failure mode this project has hit repeatedly.

     ── THE TARIFF, AND WHERE IT COMES FROM ──────────────────────────────────
     🔴 CINDER IS NEVER MINTED (CLAUDE.md, ECONOMY.md). This module does NOT
        move money. It measures the energy that crossed the link and hands the
        VALUE to /src/economy, which settles it inside runDay's audit window —
        imports out of the treasury as an ordinary `flow.imports`, exports into
        the SAME capped export faucet goods revenue already uses. Exported
        electricity that credited the player directly would be the retired
        Cinder Forge with a new label on it.

     The tariff is expressed in node-city's OWN per-minute Cinder scale, the one
     every `gen: { cinder: n }` row in BUILDINGS is written in, so it can be
     read against the buildings it competes with:

        Power Station         6.0 power/min          (BUILDINGS.powerstation)
        export tariff         0.030 🔥 per unit/min  = tariff * (1 - spread)
        -> a Power Station's whole output, sold      = 0.18 🔥/min

     …which is exactly a Player Shop's `gen: { cinder: 0.18 }` (BUILDINGS.shop),
     and it cost 200 🔥 against the shop's 70. THAT is the anchor: selling a
     whole power station to the neighbours earns what a storefront selling goods
     to them earns, off a building that cost nearly three times as much — the
     export leg is a way to stop wasting a surplus, never a business plan. The import
     leg is the same tariff the other way with the spread against you (0.050
     🔥 per unit/min), so buying back what you just sold LOSES money — the same
     job ECON.trade.spreadPct does for goods, and the reason two cities cannot
     launder electricity between them.

     ⚠ THE TARIFF IS NOT A CHAIN PRICE. /src/economy derives `electricity` from
       the recipe graph (0.25 🔥 per chain unit today) and that number is not
       used here, deliberately: a node-city power unit/min and an economy chain
       unit of electricity are different quantities, and the conversion between
       them is a number nobody can derive. Multiplying one by the other would
       look rigorous and be arbitrary. This is a TARIFF on the host's own
       quantity, in the host's own money, anchored to a building the player can
       already see the price of. */
  trade: {
    /* The interchange's substation rating: the most that can cross the link in
       either direction, in the model's unit/min. Two Power Stations' worth —
       enough to carry a small city through a plant outage, nowhere near enough
       to BE the city's grid. BUILDINGS.interchange is `cap: 1, maxLvl: 1`, so
       there is exactly one of these per city and it does not level up; the
       rating is therefore flat by construction rather than by choice. */
    linkUnitMin: 12.0,
    /* 🔥 per unit/min, mid-market. See the derivation above — do not change
       this without re-checking it against BUILDINGS.shop. */
    tariff: 0.040,
    /* The neighbour's cut, applied AGAINST you in both directions. This is the
       whole anti-laundering guard: import at tariff*(1+spread), export at
       tariff*(1-spread), so a round trip through the battery is a loss. */
    spread: 0.25,
    /* Below this the link is treated as idle. A grid sitting a hair either side
       of parity would otherwise flicker between importing and exporting every
       tick and bill the player for the noise. */
    deadbandUnitMin: 0.15,
    /* 🔴 UNPAID BILLS CURTAIL THE IMPORT, AND THIS IS NOT DECORATION.
       /src/economy settles the day's bill out of the treasury and reports back
       whatever it could not pay. Until that arrears clears, the link imports
       NOTHING — because a city that keeps drawing power it cannot pay for is a
       city being handed free electricity, which is the "credit without a debit"
       shape of the third leak ECONOMY.md documents. The neighbour cuts you off;
       the panel says so. */
    curtailOnArrears: true,
  },
  /* ── ⚖ AN HONEST BALANCE NOTE ON THE ABOVE, measured in the real page.
     A 172-tile district with no generator at all draws 3.77 unit/min. Once its
     Highway Interchange stands, the link covers the WHOLE of that from outside
     — the brownout lifts from 50% to 100% and the bill is 4.24 🔥 for the
     economic day. So a small city genuinely can run on imported power and never
     build a Power Station, and that is a deliberate consequence rather than an
     oversight: it is capped at `linkUnitMin` (two Power Stations), it is metered
     every day, and an unpaid day cuts it off. A city that outgrows 12 unit/min
     has to generate, and the interchange cannot be levelled to change that.
     Whether the crossover point is in the right place is a TUNING question with
     exactly one lever — `tariff` — and it has not been swept. Do not sweep it
     against a test city whose population grows freely: ECONOMY.md records a
     sweep that confidently pointed the wrong way for precisely that reason. */

  /* ── TRANSMISSION ─────────────────────────────────────────────────────────
     Cables run with the roads. That is not a metaphor: node-city already models
     a road as the thing that connects a building to the city, `isRoad`/`NEI`
     already exist, and the reference's own legend separates "Low Voltage
     Electric Cables" from "High Voltage Power Lines" as NETWORK colours — i.e.
     as something drawn along a network the city already has.

     🔴 `enforce` IS NOW TRUE, AND THIS IS STILL THE MOST IMPORTANT LINE IN THE
        FILE — SO READ WHAT CHANGED AND WHAT DID NOT.

        What it said before, verbatim in intent: "Turning topology into a
        production gate would retroactively black out every building in every
        EXISTING SAVE that happens to sit off the powered road component — a
        silent, unannounced balance break landing on cities the player already
        built, which the save-compatibility constraint forbids." That argument
        was never about the FLAG. It was about EXISTING SAVES. It is still
        correct and it is still enforced — by a per-city latch, not by this
        number.

        THE LATCH IS `wired`, AND IT IS THE `metered` OPT-IN, ARGUED AGAIN.
        index.js owns a module-level `wired` boolean:
          · a city that never calls load() is NEW and is wired from its first
            tick — it was built under this rule and has a Grid Connector on its
            north verge from the moment it exists;
          · load() sets `wired` from the blob's own key, and a blob written
            before this round HAS NO SUCH KEY, so it comes back false. That
            ABSENCE is the version stamp; no version number is written and none
            is needed. An old city keeps the exact pre-change numbers — same
            load, same factor, same per-tile map — until its player opts in from
            the panel.
        grid.js therefore branches on `host.enforce`, which index.js resolves as
        `POWER.transmission.enforce && wired`. This flag stays the FEATURE
        switch (set it false and no city in any state enforces anything, which
        is the kill switch a balance round needs); the latch is the SAVE switch.

     ⚠ AND IT GOVERNS LINE LOSS TOO, for exactly the same reason. Loss is a
       DEMAND term: charging it raises consumption a few per cent, which is
       enough to tip a city that sits just above parity today into a brownout it
       did not have yesterday. That is the same silent retroactive re-balance,
       just smaller, and "smaller" is not a defence. So in an UNWIRED (old) city
       the loss figure is COMPUTED and REPORTED — the panel prints what it would
       cost — and is not added to load. One flag, one meaning: "does
       transmission affect the simulation, or only the info view".
     ⚠ Anything reading this flag must degrade to "ratio only" when it is false;
       grid.js branches on the RESOLVED value in exactly one place, in solve(). */
  transmission: {
    enforce: true,
    // A road tile's cable rating, in draw units. Any segment carrying more than
    // this is a BOTTLENECK — the reference's whole diagnostic argument is that a
    // single availability number can never say WHERE the grid is choking.
    lvRating: 4.0,
    // Segments carrying at least this much are drawn as HIGH VOLTAGE trunk. A
    // trunk is not a different cable the player buys; it is the part of the same
    // network that has aggregated enough load to read as one.
    hvThreshold: 6.0,
    // …as is every segment within this many hops of a plant, so a plant always
    // leaves on trunk even in a city too small to have aggregated anything yet.
    trunkHops: 2,
    // HV carries more before it chokes.
    hvRating: 18.0,
    // Resistive loss per hop, as a fraction of the draw carried. Small, but it
    // is what makes a plant near its load genuinely better than a plant in the
    // corner — and it is a real term in the causal list rather than a fudge.
    lossPerHop: 0.004,
    // Loss is capped however long the run: beyond this the model is no longer
    // saying anything true about a 24-tile city.
    lossMax: 0.12,
  },

  /* ══ 🗼 POWER LINES AND THE GRID CONNECTOR ═════════════════════════════════
     ──────────────────────────────────────────────────────────────────────────
     A road carries cable. That was true before this round and it stays true —
     retro-fitting "you must now also run a line down every street you already
     built" onto a live city is the same retroactive break the enforce header
     spends thirty lines refusing. So lines are ADDITIVE CONDUCTORS: a second
     way to carry the grid, for the two jobs a road cannot do.

       1. REACHING OFF THE PLATE. The Grid Connector stands on the north verge,
          between the buildable plate and the highway embankment. There is no
          road out there and there never will be — `tryPlace` only places on the
          24×24 grid — so without a conductor that is not a road, the connector
          is unreachable and therefore decorative.
       2. CROSSING GROUND YOU DO NOT WANT PAVED. A line over open land is how a
          player wires an outlying plant without laying a road to it and paying
          the road maintenance cap for the privilege.

     🔴 A LINE IS NOT A TILE, AND THAT IS THE WHOLE SAFETY ARGUMENT.
        node-city's `game.tiles[k]` is one object with one `type`, and `t.type
        === 'road'` is re-derived independently in a dozen files. A new tile
        type for a cable would fall out of the road maintenance cap, render as
        an invisible building (buildMesh has no arm and no default), despawn
        every agent standing on it (agentTick reads a type change as a
        demolition), become zonable land and stop bounding zoning fills. Lines
        therefore live in THIS MODULE'S OWN SAVE SLICE as a set of cell keys.
        node-city's tile map is never written. A save round-tripped through a
        build where /src/power 404s loses its lines and nothing else — every
        tile in it is still exactly the tile it was.

     ⚠ A LINE CELL IS NOT A GRID TILE EITHER. The domain is the plate PLUS a
       one-cell apron (`apron` below), so x and z run -1 … GRID. The apron is
       where the connector and its first span live. Nothing but a line may ever
       occupy it. */
  lines: {
    /* ── COST. Cinder, per cell, charged through node-city's own payCost() —
       this module never touches a ledger. Sited against the shipped build
       shelf rather than invented: a road tile is `{cinder:4}` × BUILD_CINDER_MULT
       100 = 400🔥, and a span of cable is emphatically cheaper to lay than a
       paved carriageway with kerbs, drains and a maintenance obligation. 120 is
       a little under a third of a road and makes a ten-cell run to the connector
       1,200🔥 — real money for a settlement, pocket change for a city, which is
       the shape a first-hour tutorial cost wants.
       ⚠ ALREADY SCALED. node-city's scaleCost() multiplies a BUILDINGS row's
         cinder by 100; this number never passes through it, exactly as
         ROAD_DEMOLISH_COST does not. Writing 1.2 here and hoping would quote
         100× low and look entirely correct — /src/streets records that specific
         mistake against costOf('road'). */
    costPerCell: 120,
    /* 🚫 THERE IS NO REMOVAL PRICE AND NO REFUND DIAL, AND BOTH ABSENCES ARE
       DECISIONS. A road charges ROAD_DEMOLISH_COST to demolish because a
       carriageway is earthworks; a pole is a pole, and charging for a mis-drag
       makes a drag tool punishing to learn. A REFUND is worse than punishing:
       it would be a module crediting the player, which is the retired Cinder
       Forge with a new label on it (CLAUDE.md, ECONOMY.md — Cinder is never
       minted, and every leak that shipped looked entirely correct in review).
       So `lift()` takes the cable down and no money moves in either direction,
       and there is deliberately no number here to turn that into a faucet. */
    /* A hard ceiling on the network, in cells. Not an economy dial: it is the
       bound that keeps the mesh at two draw calls and the BFS at O(cells). The
       plate is 576 tiles; a city that has wired 900 cells has painted the map,
       which is what the road maintenance cap exists to prevent and this is the
       same argument for the same reason. */
    maxCells: 900,
    /* The one-cell apron outside the plate that a line may occupy. 1, and it
       must stay 1 unless the connector moves: the embankment toe is at world
       z = -12.8 and the apron row's centre is world z = -12.5, so a second
       apron row would put cable inside the earthworks. */
    apron: 1,

    /* ── THE CONNECTOR ────────────────────────────────────────────────────────
       Deliberately NOT a BUILDINGS row and NOT placed by the player. It is
       infrastructure that was already there — the same standing the highway
       itself has in /src/outside, which draws a road past a city that has not
       joined it yet. Every city gets one, at the same place, from its first
       frame, so "drag a line to the connector" is an instruction that is true
       in a city with nothing in it.

       ⚠ THE CELL IS OFF THE PLATE, at the NORTH-WEST outer corner: (-1, -1),
         which is world (-12.5, -12.5). North because that is where /src/outside
         put the highway (HW.z = -18.8) and the interchange row (ICH.edgeZ = 0).
         The corner because the interchange's ramps run ±X from whichever north
         edge tile the player chose and taper across the verge — and ICH.margin
         keeps the interchange one tile clear of the corners, so the corner is
         the one point on the verge the ramps are least likely to reach.
         🐞 They can still meet, when the interchange sits at x = 1 and its
            off-ramp crosses the verge heading west. That is a cosmetic overlap
            of two meshes on the plain, not a placement conflict — nothing here
            occupies a tile, so nothing can be blocked. */
    connector: {
      name: 'Grid Connector',
      ico: '🗼',
      // Cell coordinates in the apron. cx is resolved against GRID at mount so
      // a different grid size keeps the corner rather than a stale number.
      cx: -1, cz: -1,
      /* Injects at this cell as if it were a plant, ALWAYS — including in a
         city whose interconnector is refused. Being CONNECTED to the national
         grid and being ALLOWED TO TRADE OVER IT are two questions with two
         owners: link.js answers the second (and gates it on
         MythicOutside.connected, the caravan's own rule). A connector that
         stopped conducting when the trade gate shut would black out a city's
         own coal plant for want of a Highway Interchange, which is nonsense. */
      seeds: true,
    },

    /* ── THE DRAG ─────────────────────────────────────────────────────────────
       An L-shaped run between the two ends of the gesture, because a cable run
       is axis-aligned and a rectangle marquee is the wrong verb for a line: a
       zoning marquee fills an area, a road or a cable draws a PATH. `elbowFirst`
       is which leg is drawn first when the player has not expressed a
       preference — X then Z. Holding shift swaps it, which is the CS2 idiom. */
    elbowFirst: 'x',
    // A run longer than this in one gesture is refused whole rather than
    // half-charged. It is the same "one line for the whole drag" rule
    // /src/zoning's develop() states: a bulk action must be all or nothing.
    maxRun: 64,

    /* ── THE LOOK ─────────────────────────────────────────────────────────────
       Two draw calls for the whole network: one InstancedMesh of poles, one
       LineSegments of wire. The city already pushes ~1,700 meshes and the
       ground was deliberately reduced from 576 meshes to 2 — a per-cell Group
       would spend that budget on a utility. */
    pole: {
      h: 0.78,          // above the tile surface
      r: 0.035,         // pole radius at the base
      col: 0x6b6259,    // creosoted timber, not steel: steel reads as a plant
      // A pole every other cell along a straight run, plus one at every corner,
      // junction and dead end (degree ≠ 2). Poles on every cell read as a fence.
      everyOther: true,
    },
    wire: {
      // Wire height, as a fraction of pole height — the crossarm, not the tip.
      hFrac: 0.88,
      // Catenary sag at mid-span, in world units. Small, but it is the single
      // detail that stops a wire reading as a debug line.
      sag: 0.055,
      segs: 3,
      /* Ribbon width. A REAL cable would be a few millimetres and would vanish
         at the aerial camera this game is played from — the same reason
         node-city's road paint stack is 1.8 mm and its lane markings are not.
         0.028 is the narrowest that still reads as a continuous line across the
         map at the default zoom. */
      w: 0.028,
      col: 0x2b2b30,
    },
    // Y of the cable network's base above the tile surface. Above RD_Y (.016)
    // and above the hover plane (.02) so a pole never z-fights a road apron,
    // below the power overlay's plane (.06) so the info view still reads on top.
    y: 0.028,

    /* ── THE REFUSALS ─────────────────────────────────────────────────────────
       House style is node-city's own and tryPlace()'s road-cap message is the
       model: say WHAT is refused, WHY, and exactly what fixes it. */
    say: {
      occupied: 'A building stands there. Run the line around it — a line only has to REACH a building, not cross it.',
      outside:  'That is off the map. A power line may leave the plate by one cell, which is the verge the Grid Connector stands on.',
      cap:      'The network is at its limit. Take a line down before laying another.',
      afford:   'Not enough Cinder for that run.',
      run:      'That is too long for one drag. Lay it in two.',
    },
  },

  /* ── THE CAUSAL LIST ──────────────────────────────────────────────────────
     BAR.md rubric dimension 12: state reads "as a meter with a signed causal
     list, not a raw number". These bound that list so a 60-building city does
     not print sixty rows and stop being readable. */
  causes: {
    maxRows: 7,
    // A contributor smaller than this share of the total is folded into the
    // "…and N smaller" row rather than printed. Keeps the list honest — the
    // total is always exact even when the list is abbreviated, the same rule
    // node-city's own away report states for its leaver list.
    minShare: 0.02,
  },

  /* ── METERS ───────────────────────────────────────────────────────────────
     Where red becomes amber becomes green on each bar, as a fraction of the
     bar. The reference's read is "state before number": availability far right
     is a comfortable margin, mid-bar is balanced.

     availability is plotted as supply/demand normalised so that:
       ratio 0   -> 0.00   (blackout)
       ratio 1   -> 0.55   (exactly met — amber/green boundary, no headroom)
       ratio 2+  -> 1.00   (double the demand — the reference's far-right marker)
     Anything past 2x is clamped, because a city with 10x headroom is not ten
     times healthier, it is nine plants of waste. */
  meters: {
    availability: { red: 0.30, amber: 0.55, ratioFull: 2.0 },
    // Reserve margin: (capacity - load) / capacity. Under 5% is red (no
    // contingency), 5–15% amber, over 15% green. Past `wasteAbove` the panel
    // adds a "− overbuilt" cause rather than colouring the bar differently —
    // two opposite meanings on one gradient is exactly the confusion the
    // reference avoids.
    reserve: { red: 0.05, amber: 0.15, wasteAbove: 0.60 },
    battery: { red: 0.15, amber: 0.40 },
    /* 🔌 ELECTRICITY TRADE is the one CENTRE-ZERO bar on the panel: the marker
       sits at 0.5 when nothing is crossing the link, walks LEFT as the city
       imports and RIGHT as it exports, scaled against the interconnector's own
       rating so full-tilt in either direction is an end of the bar.
       Red on the left is not a scolding for importing — it is the same reading
       the rest of the panel gives, that the city is short of its own generation
       and is paying somebody else for the difference. */
    trade: { red: 0.30, amber: 0.50 },
  },

  /* ── OVERLAY ──────────────────────────────────────────────────────────────
     🔴 PERFORMANCE. The city already renders ~1,700 meshes / ~2M triangles, and
     a 24x24 overlay must not be 576 meshes. It is ONE mesh: a single plane
     carrying a single CanvasTexture that every enabled layer paints into. Cost
     is one draw call and one texture upload, and only when a layer actually
     changes — see overlay.js's repaint gate. */
  overlay: {
    // Texture pixels per tile. 24 tiles x 24 px = 576px square, which is a
    // trivial upload and still resolves a painted road centre-line.
    px: 24,
    // Height above the ground plane. Low enough to read as paint on the
    // terrain, high enough to beat z-fighting with the road slabs.
    y: 0.06,
    opacity: 0.78,
    /* How opaque a TERRAIN FIELD gets, as a function of its own 0..1 value.
       A dense field (heat, groundwater, wind) is defined on all 576 tiles, so a
       high floor here paints an opaque sheet over the whole city — see the note
       in overlay.js's paintField, which is written against the photograph that
       found it. Below `floor` a tile is not painted at all. */
    fieldAlpha: { floor: 0.03, lo: 0.10, hi: 0.72 },
  },

  /* ── COLOURS ──────────────────────────────────────────────────────────────
     node-city's own dark language, not CS2's skin. The reference's information
     design is what is being matched; its palette is not.
     ⚠ Every ramp is stated low->high so overlay.js can interpolate generically
       and the panel's legend swatch strip is generated from the SAME array —
       a legend that is hand-written beside the ramp it describes is a legend
       that goes stale, which is how a key stops matching the map. */
  col: {
    plant:       '#4fd8e8',   // cyan   — power plants
    transformer: '#5fe08a',   // green  — step-down points
    battery:     '#b79cf0',   // lilac  — storage
    lv:          '#ffd24a',   // yellow — low voltage
    lvFlow:      '#fff2b0',   // pale yellow
    lvChoke:     '#ff5a4d',   // red
    hv:          '#4fd8e8',   // cyan
    hvFlow:      '#a8f0f8',
    hvChoke:     '#ff5ad8',   // magenta
    unserved:    '#8a8f98',   // grey — connected to nothing
    // Consumption ramp, pale -> yellow -> orange -> red.
    demandRamp: ['#e8e2c8', '#ffe066', '#ff9d3d', '#ff4d3d'],
    // Wind ramp, pale -> amber (only drawn when a pollution module supplies it).
    windRamp:   ['#e8e2c8', '#ffc14d'],
    // Groundwater, pale -> blue; surface flow, pale -> white-blue. Same caveat.
    groundRamp: ['#dfe7ee', '#3d8fd8'],
    surfaceRamp:['#e6f2f5', '#9fe8f5'],
    /* ♨ Geothermal heat, cool grey -> ember -> white-hot. This one needs NO
       external module: geology.js is ours and is always answerable, so unlike
       the three rows above its legend row is never greyed out. */
    heatRamp:   ['#57606b', '#c96a2a', '#ffd9a0'],
    // The contour drawn around ground hot enough to license a well. A THRESHOLD
    // is a line, not a colour — see overlay.js.
    heatEdge:   '#ffe8b0',
    /* ☁ THE EMISSION SOURCE MAP. Deliberately named "source", not "pollution":
       this paints what OUR plants put out, which is a fact this module owns
       exactly. Where it GOES is dispersion, which belongs to /src/pollution and
       is not drawn here — painting a plume we did not compute would be the
       confidently-wrong map this file keeps refusing to draw. */
    emitRamp:   ['#cfd6c8', '#c2b04a', '#a8452e'],
  },
};

/* Read a POWER path with a loud failure instead of `undefined` arithmetic.
   Same shape as /src/economy's `econ()`: a mistyped path is a bug that should
   surface at the call site, not become NaN four frames later. */
export function pw(path, fallback) {
  let cur = POWER;
  for (const seg of String(path).split('.')) {
    if (cur == null || typeof cur !== 'object' || !(seg in cur)) {
      if (fallback !== undefined) return fallback;
      try { console.warn('[power] no tuning at POWER.' + path); } catch (e) {}
      return undefined;
    }
    cur = cur[seg];
  }
  return cur;
}
