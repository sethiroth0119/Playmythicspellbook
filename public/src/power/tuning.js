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
      farm: 'industry', scrapmine: 'industry', fuelrig: 'industry', gasstation: 'industry',
      quarry: 'industry', lumbercamp: 'industry', fibercroft: 'industry', munitions: 'industry',
      smelter: 'industry', machineshop: 'industry', cannery: 'industry',
      sawmill: 'industry', weavery: 'industry', papermill: 'industry', printworks: 'industry',
      grocery: 'commerce', restaurant: 'commerce', motorpool: 'commerce', shop: 'commerce',
      forge: 'commerce', indexfund: 'commerce', holdco: 'commerce',
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

  /* ── TRANSMISSION ─────────────────────────────────────────────────────────
     Cables run with the roads. That is not a metaphor: node-city already models
     a road as the thing that connects a building to the city, `isRoad`/`NEI`
     already exist, and the reference's own legend separates "Low Voltage
     Electric Cables" from "High Voltage Power Lines" as NETWORK colours — i.e.
     as something drawn along a network the city already has.

     🔴 `enforce` IS OFF, ON PURPOSE, AND THIS IS THE MOST IMPORTANT LINE IN THE
        FILE. Today's host charges brownout from a pure supply/demand ratio and
        ignores topology completely. Turning topology into a production gate
        would retroactively black out every building in every EXISTING SAVE that
        happens to sit off the powered road component — a silent, unannounced
        balance break landing on cities the player already built, which the
        save-compatibility constraint forbids. So connectivity is DIAGNOSTIC:
        it drives the overlay, the bottleneck colour and the panel's "unserved"
        advisory, and it does not touch `factor`. Flipping this to true is a
        deliberate, announced balance round — one number, right here.

     ⚠ AND IT GOVERNS LINE LOSS TOO, for exactly the same reason. Loss is a
       DEMAND term: charging it raises consumption a few per cent, which is
       enough to tip a city that sits just above parity today into a brownout it
       did not have yesterday. That is the same silent retroactive re-balance,
       just smaller, and "smaller" is not a defence. So while `enforce` is false
       the loss figure is COMPUTED and REPORTED — the panel prints what it would
       cost — and is not added to load. One flag, one meaning: "does
       transmission affect the simulation, or only the info view".
     ⚠ Anything reading this flag must degrade to "ratio only" when it is false;
       grid.js branches on it in exactly one place, in solve(). */
  transmission: {
    enforce: false,
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
