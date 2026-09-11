/* HOMESTEAD FARM — lifted verbatim from the Homestead Farm Sandbox artifact (the flat bundle the FARM_HANDOFF names).
   Six source files concatenated: farm.data, farm.events, farm.state, farm.scene, farm.render, farm.cloud, index —
   with the bundler's three collision renames kept (H in state/cloud, esc → escIdx, err → errC). Kept as ONE module on
   purpose: the bundle is the only copy of this code that reached this repo. The sandbox's auto-mount line was
   removed; index.html mounts it into the Farm screen. Server side: sql/038_farm_auction_and_ranch is NOT installed,
   so player lots and the corp ranch say so and everything else runs offline, as the module was built to. */

/* ═══ farm.data.js ═══ */
/* ════════════════════════════════════════════════════════════════════════════
   🐄 HOMESTEAD FARM — catalogue + the ONE tuning table (FARM_ECON).
   ----------------------------------------------------------------------------
   Players raise farm animals in buildings they put up with Cinder + resources,
   keep them fed with Animal Feed, collect what the living animals give (eggs,
   milk, wool, feathers, manure) and slaughter stock at the Butcher's Block for
   meat and hides. Stations then refine: hide → leather, wool → cloth,
   meat / eggs / milk → food. Every output lands in the REAL ledger
   (index.html's RESOURCES) so it is tradeable, spendable and visible.

   Round 2 added the living layer: every animal has HEALTH, WEIGHT, AGE and a
   NAME; neglect costs condition instead of pausing; guard dogs and a donkey
   defend against RAIDS (rival camps) and random EVENTS (fox, wolves, hawk,
   storm, a UFO); rare BREEDS are born; the oldest beast is a PRIZE animal;
   the butcher offers CUTS; SEASONS and the farm's own WEATHER move the
   numbers; the town posts a daily DEMAND; grown stock can be CRATED for the
   Exchange; hired Farmers tend the troughs; and the Athena Editor lets the
   owner restyle the homestead.

   🔴 THIS FILE IS THE ONE TUNING TABLE for the farm (the `_opEcon()` /
      TERROIR_ECON pattern — CLAUDE.md: "All operation pricing goes through
      _opEcon(). Never hardcode economy numbers"). Every price, rate, cap and
      yield in the farm is in FARM_ECON below. Callers ask; they never carry a
      copy, and render code never holds a number.

   🔴 RESOURCE IDS ARE THE CONTRACT WITH THE LEDGER. The ids used here were
      promoted into index.html's RESOURCES together with this module — see
      RESOURCES_NEXT.md for why an id must never exist in the farm without also
      being in the ledger ("a resource you can hold and be capped by but cannot
      sell, spend or see is worse than a missing one").

   🔴 NO CINDER FAUCET. The town's demand pays in RESOURCES, never Cinder. The
      car dealership's NPC buyer queue was removed for being exactly that
      faucet (git log: "it was a Cinder faucet"); the farm must not re-open it.

   ⏱ The 6h collect cooldown / 36h accrual cap are NOT here. They are the
      game's existing idle contract (OP_COLLECT_CD_MS / OP_ACCRUAL_CAP_H),
      handed over by the bridge, so the farm cannot become a third idle policy.
   ════════════════════════════════════════════════════════════════════════════ */

const FARM_ECON = {
  /* 🌾 Feed. One trough per building; feed drains per animal per hour. */
  /* 🌾 Owner's rule (2026-09-10): feed is ground from CORN, BREAD and FRUIT —
     three ledger resources the city farms and bakeries already bank — once
     the Feed Mill stands (craft() gates on the mill being built and ready). */
  feedMillRecipe: { inputs: { corn: 6, bread: 4, fruit: 4 }, output: { animalFeed: 24 } },
  troughCap: 240,
  troughCapPerLevel: 120,
  grazeDiscount: 0.5,             // pasture animals eat half from the trough (COMMON ground)

  /* 🧺 Living-animal yields: units per adult per FED hour at full health. */
  yieldsPerH: {
    chicken: { eggs: 0.35, feathers: 0.08 },
    cow:     { rawMilk: 0.9, fertilizer: 0.12 },
    pig:     { fertilizer: 0.2 },
    sheep:   { wool: 0.3 },
    goat:    { rawMilk: 0.45 },
    donkey:  { fertilizer: 0.15 },
  },

  /* 🔪 Slaughter — base yield of an ADULT at its adult weight. Scaled by the
     animal's weight/adultWeight, the butcher level, the cut and the season. */
  slaughter: {
    chicken: { meat: 2,  feathers: 3 },
    cow:     { meat: 12, hide: 3, fertilizer: 1 },
    pig:     { meat: 8,  hide: 2 },
    sheep:   { meat: 5,  hide: 1, wool: 2 },
    goat:    { meat: 4,  hide: 1 },
  },
  butcherBonusPerLevel: 0.15,
  /* Cuts: how the block is used. `trophy` needs butcher L2 and rolls a rare
     drop (memoryShards / dna) — the one place the farm touches the rare ledger. */
  cuts: {
    balanced: { label: 'Balanced', meat: 1,    hide: 1,    other: 1,    minLevel: 1 },
    meat:     { label: 'Meat cut', meat: 1.5,  hide: 0.5,  other: 1,    minLevel: 1 },
    hide:     { label: 'Hide cut', meat: 0.6,  hide: 1.5,  other: 1,    minLevel: 1 },
    trophy:   { label: 'Trophy',   meat: 0.75, hide: 0.75, other: 0.75, minLevel: 2, rareChance: 0.2, rare: { memoryShards: 1 } },
  },
  prizeRare: { chance: 0.35, drop: { dna: 1 } },   // slaughtering a prize animal
  prizeAgeMul: 3,                                    // prize = oldest adult with ageH ≥ growH × this

  /* 🐣 Buying and growing. `growH` = FED hours to adulthood; `adultWeight` in
     kg is reached at growH and keeps creeping to `maxWeight` with age. */
  animals: {
    chicken: { cinder: 1800,  feedPerH: 0.6, growH: 6,  adultWeight: 2.5,  maxWeight: 3.2,  lifeH: 720 },
    cow:     { cinder: 14000, feedPerH: 2.4, growH: 24, adultWeight: 520,  maxWeight: 680,  lifeH: 2400 },
    pig:     { cinder: 6500,  feedPerH: 1.8, growH: 14, adultWeight: 110,  maxWeight: 180,  lifeH: 1200 },
    sheep:   { cinder: 5200,  feedPerH: 1.2, growH: 12, adultWeight: 70,   maxWeight: 95,   lifeH: 1400 },
    goat:    { cinder: 4200,  feedPerH: 1.0, growH: 10, adultWeight: 55,   maxWeight: 75,   lifeH: 1400 },
    // 🐕 Guards. `defense` is what a raid or predator has to beat.
    terrier: { cinder: 2500,  feedPerH: 0.5, growH: 4,  adultWeight: 8,    maxWeight: 10,   lifeH: 2000, defense: 2 },
    collie:  { cinder: 6000,  feedPerH: 0.8, growH: 6,  adultWeight: 20,   maxWeight: 24,   lifeH: 2000, defense: 4 },
    mastiff: { cinder: 12000, feedPerH: 1.4, growH: 8,  adultWeight: 65,   maxWeight: 80,   lifeH: 1800, defense: 7 },
    donkey:  { cinder: 25000, feedPerH: 1.6, growH: 12, adultWeight: 250,  maxWeight: 300,  lifeH: 3000, defense: 10 },
  },
  breedChancePerH: { chicken: 0.05, cow: 0.008, pig: 0.02, sheep: 0.015, goat: 0.018 },

  /* ❤️ Health. Full = 100. Fed hours heal; hunger past the grace window
     hurts; at 0 the animal dies (journalled). Below `sickBelow` an animal
     yields nothing and cannot breed; yield scales linearly above it. */
  health: {
    healPerFedH: 3,
    hungerGraceH: 24,          // unfed hours before condition starts to drop
    hungerLossPerH: 2,
    sickBelow: 30,
    treatCost: { medicine: 1 }, treatHeal: 40,
    guardHalfBelow: 50,        // a guard under this defends at half strength
    oldAgeLossPerH: 0.05,      // past lifeH, condition slowly fails
  },

  /* 🧬 Rare breeds — 5% of births. Double yield, distinct colour, tradeable
     bragging rights. `glow` is the UFO's doing and can only come back that way. */
  rareBreedChance: 0.05,
  breeds: {
    // rare line (5% of births, or inherited)
    chicken: { tier: 'rare', sp: 'chicken', label: 'Golden Hen',   color: 0xf2c14e, yieldMul: 2 },
    cow:     { tier: 'rare', sp: 'cow',     label: 'Silver Cow',   color: 0xc8ccd6, yieldMul: 2 },
    pig:     { tier: 'rare', sp: 'pig',     label: 'Spotted Pig',  color: 0x6a4a3a, yieldMul: 2 },
    sheep:   { tier: 'rare', sp: 'sheep',   label: 'Black Sheep',  color: 0x2b2622, yieldMul: 2 },
    goat:    { tier: 'rare', sp: 'goat',    label: 'Ivory Goat',   color: 0xf4efe4, yieldMul: 2 },
    // royal line (two rare parents)
    'chicken:royal': { tier: 'royal', sp: 'chicken', label: 'Crown Hen',   color: 0xffe08a, yieldMul: 3, meatMul: 1.5 },
    'cow:royal':     { tier: 'royal', sp: 'cow',     label: 'Moon Cow',    color: 0xe8f0ff, yieldMul: 3, meatMul: 1.5 },
    'pig:royal':     { tier: 'royal', sp: 'pig',     label: 'Ember Pig',   color: 0xd85a2a, yieldMul: 3, meatMul: 1.5 },
    'sheep:royal':   { tier: 'royal', sp: 'sheep',   label: 'Storm Sheep', color: 0x6a7a9a, yieldMul: 3, meatMul: 1.5 },
    'goat:royal':    { tier: 'royal', sp: 'goat',    label: 'Sun Goat',    color: 0xf4c040, yieldMul: 3, meatMul: 1.5 },
    // mythic line (two royal parents)
    'chicken:mythic': { tier: 'mythic', sp: 'chicken', label: 'Phoenix Hen',   color: 0xff6a2a, yieldMul: 5, meatMul: 2 },
    'cow:mythic':     { tier: 'mythic', sp: 'cow',     label: 'Aurochs',       color: 0x3a2a20, yieldMul: 5, meatMul: 2 },
    'pig:mythic':     { tier: 'mythic', sp: 'pig',     label: 'Iron Boar',     color: 0x5a6070, yieldMul: 5, meatMul: 2 },
    'sheep:mythic':   { tier: 'mythic', sp: 'sheep',   label: 'Golden Fleece', color: 0xffd24a, yieldMul: 5, meatMul: 2 },
    'goat:mythic':    { tier: 'mythic', sp: 'goat',    label: 'Star Goat',     color: 0xc0d8ff, yieldMul: 5, meatMul: 2 },
    // the UFO's doing
    glow:    { tier: 'glow', label: 'Glow-touched', color: 0x8affd6, yieldMul: 2.5, meatMul: 1.5 },
  },

  /* 👷 Farmer citizens (Reconstruction workforce). Each hired Farmer tops up
     troughs from the stash when they run low and adds a small yield bonus. */
  farmers: { yieldPerFarmer: 0.03, yieldCap: 0.30, topUpBelow: 0.25 },

  /* 🗺 Terroir on the pasture. The `animalFeed` tier of the camp's ground
     decides how well the grass grows. BARREN also takes a stall away. */
  terroirGraze: { RICH: 0.25, COMMON: 0.5, SCARCE: 0.75, BARREN: 1.0 },
  terroirBarrenCapLoss: 1,

  /* 🍂 Seasons — by calendar month (northern). Retune here, nowhere else. */
  seasons: {
    spring: { label: 'Spring', icon: '🌱', months: [2, 3, 4],  breedMul: 2,   feedMul: 1,   grazeMul: 1,   meatMul: 1 },
    summer: { label: 'Summer', icon: '☀️', months: [5, 6, 7],  breedMul: 1,   feedMul: 1,   grazeMul: 0.7, meatMul: 1 },
    autumn: { label: 'Autumn', icon: '🍂', months: [8, 9, 10], breedMul: 0.6, feedMul: 1.1, grazeMul: 1,   meatMul: 1.15 },
    winter: { label: 'Winter', icon: '❄️', months: [11, 0, 1], breedMul: 0.3, feedMul: 2,   grazeMul: 1.6, meatMul: 1 },
  },

  /* 🌦 The farm's own weather. Battle weather is a different system (it
     lives on the board state), so the farm rolls one deterministic window
     per `weatherWindowH` from the camp seed. Effects apply while it holds. */
  weatherWindowH: 6,
  weather: {
    clear: { label: 'Clear',  icon: '☀️', weight: 40 },
    cloud: { label: 'Overcast', icon: '☁️', weight: 25 },
    rain:  { label: 'Rain',   icon: '🌧', weight: 20, troughWater: 8, grazeMul: 0.7 },   // free water in the troughs, grass grows
    storm: { label: 'Storm',  icon: '⛈', weight: 10, eggMul: 0, roofRisk: 0.35 },       // hens stop laying, roofs at risk
    fog:   { label: 'Fog',    icon: '🌫', weight: 5,  raidMul: 1.5 },                    // raiders love it
    snow:  { label: 'Snow',   icon: '🌨', weight: 0,  grazeMul: 0.5, eggMul: 0.5 },      // the city's snow — never rolled here, only mirrored
  },

  /* ⚔ Raids and events. One roll per `eventWindowH`, only when the farm
     has stock. Strength is what the guards' defense (+ fence) must beat. */
  eventWindowH: 6,
  eventChance: 0.22,                    // per window that ANYTHING happens
  fenceDefensePerLevel: 1.5,            // each pen level above 1 adds this
  events: {
    raid:   { weight: 30, label: 'Raid',        icon: '⚔',  strength: [4, 12], loot: { supplies: 6, metal: 4 } },  // repelled raiders drop loot
    fox:    { weight: 20, label: 'Fox',         icon: '🦊', strength: [1, 4],  prey: ['chicken'] },
    hawk:   { weight: 12, label: 'Hawk',        icon: '🦅', strength: [1, 3],  prey: ['chicken'] },
    wolves: { weight: 15, label: 'Wolves',      icon: '🐺', strength: [5, 11], prey: ['sheep', 'goat', 'pig', 'cow'] },
    ufo:    { weight: 6,  label: 'UFO',         icon: '🛸', strength: [99, 99], returnChance: 0.5 },   // nothing stops it
    storm:  { weight: 10, label: 'Roof damage', icon: '🌪', repair: { wood: 20, stone: 10 } },
    star:   { weight: 7,  label: 'Shooting star', icon: '🌠', gift: { fertilizer: 6 } },
  },
  predatorWound: 45,                    // health lost by the victim when a predator gets through
  guardWound: 15,                       // health lost by a guard that wins a fight

  /* 🏘 Town demand — a daily barter, resources for resources (see the faucet
     note above). One product per day; `perDay` deliveries at most. */
  townDemand: {
    perDay: 3,
    offers: [
      { give: { eggs: 12 },    get: { supplies: 6 } },
      { give: { rawMilk: 10 }, get: { medicine: 3 } },
      { give: { meat: 8 },     get: { metal: 6 } },
      { give: { wool: 6 },     get: { supplies: 5, water: 10 } },
      { give: { leather: 4 },  get: { metal: 8 } },
      { give: { feathers: 10 }, get: { cloth: 4 } },
      { give: { fertilizer: 8 }, get: { food: 12 } },
      // ⭐ Grade-2 goods: the town pays about double per unit, in goods.
      { give: { goldEggs: 6 },  get: { medicine: 4, supplies: 4 } },
      { give: { primeMeat: 4 }, get: { metal: 8, supplies: 4 } },
      { give: { richMilk: 5 },  get: { medicine: 4, water: 10 } },
      { give: { fineWool: 3 },  get: { cloth: 5, supplies: 4 } },
    ],
  },

  /* 📦 Livestock crates — the Exchange trades `livestock` units. Crating a
     grown animal makes one; uncrating pays the species' price at a discount
     because the crate is species-less (a hen crate cannot become a free cow). */
  crate: { uncrateDiscount: 0.5, minAgeMul: 1 },

  /* 🏗 Construction. Buildings take REAL hours to raise (per level, on each
     building as `buildH`). Hired Builders (Reconstruction workforce) shave a
     share off; Cinder can rush what is left, priced per remaining minute so
     rushing the last five minutes is cheap and rushing a barn is not. */
  construction: { perBuilder: 0.05, builderCap: 0.4, rushCinderPerMin: 40, rushMin: 500 },

  /* 🚚 Transport. Bought stock does not appear in the pen — it is on the road.
     Three haulage companies and, for players who own a convoy rig, their own
     truck. `hours` is the trip, `risk` the chance the shipment is hit on the
     way (one animal lost), `insured` the share of the animals' price refunded
     when that happens. Fee = base + perKg × shipping weight (young stock ships
     at `shipKgShare` of adult weight). Nothing here pays out Cinder except an
     insurance refund of Cinder the player just spent. */
  transport: {
    shipKgShare: 0.3,
    carriers: {
      hollow:   { name: 'Hollow Road Haulage',    emoji: '🛻', feeBase: 400,  feePerKg: 2, hours: 3,    risk: 0.25, insured: 0,   blurb: 'Cheap, slow, and the road is not theirs. One in four loads gets hit.' },
      voss:     { name: 'Voss Livestock Express', emoji: '🚚', feeBase: 1200, feePerKg: 4, hours: 1.5,  risk: 0.08, insured: 0.5, blurb: 'Reliable crews, half your money back if a load is lost.' },
      ironclad: { name: 'Ironclad Convoys',       emoji: '🚛', feeBase: 3000, feePerKg: 8, hours: 0.75, risk: 0,    insured: 1,   blurb: 'Armoured. Nothing on the road touches it. You pay for that.' },
    },
    /* The player's own convoy rig (index.html CONVOY_TRUCKS, via the bridge).
       Free haulage; the better the rig, the faster and safer the trip. */
    ownRig: {
      hauler:   { hours: 2.5, risk: 0.15 },
      ironback: { hours: 1.5, risk: 0.08 },
      ashrig:   { hours: 1.0, risk: 0.04 },
      warden:   { hours: 0.6, risk: 0.02 },
    },
    defaultCarrier: 'voss',
  },

  /* 🦠 Disease. An outbreak is rolled per pen per event window; crowding and
     a low pen level raise the odds. It spreads to pen-mates by the hour. An
     ill animal loses health and yields half. The Vet Clinic auto-treats from
     the medicine stash each hour it is open; without one, Treat cures by hand
     for `handCure` medicine. */
  disease: {
    outbreakBase: 0.04, crowdMul: 3, crowdAbove: 0.8, penLevelCut: 0.3,
    spreadPerH: 0.12, healthLossPerH: 1.5, yieldMul: 0.5, cureH: 12,
    handCure: { medicine: 2 }, vetMedicinePerCure: 1, vetCureHPerLevel: 3, vetOutbreakCut: 0.5,
    kinds: {
      coccidiosis: { label: 'Coccidiosis', icon: '🦠', species: ['chicken'] },
      footrot:     { label: 'Foot rot',    icon: '🦶', species: ['sheep', 'goat'] },
      swinefever:  { label: 'Swine fever', icon: '🌡', species: ['pig'] },
      bluetongue:  { label: 'Bluetongue',  icon: '💙', species: ['cow'] },
      kennelcough: { label: 'Kennel cough', icon: '😮‍💨', species: ['terrier', 'collie', 'mastiff', 'donkey'] },
    },
  },

  /* 🧬 Breeding lines. Two parents of the same LINE can produce the next
     tier. rare → royal → mythic. `collection` rewards owning every breed in
     a tier at least once (tracked for life, so a sold beast still counts). */
  lines: {
    rareChance: 0.05,            // any birth
    inheritRare: 0.35,           // one rare parent → rare child
    royalChance: 0.25,           // two rare parents → royal
    mythicChance: 0.12,          // two royal parents → mythic
    tiers: {
      rare:   { yieldMul: 2,   meatMul: 1.2 },
      royal:  { yieldMul: 3,   meatMul: 1.5 },
      mythic: { yieldMul: 5,   meatMul: 2 },
    },
    collectionReward: { rare: { memoryShards: 1 }, royal: { memoryShards: 2, dna: 1 }, mythic: { memoryShards: 3, dna: 2 } },
  },

  /* 📜 Town contracts. Two offers a week (seeded), multi-day, paid in a
     resource bundle far above the daily demand. Missing the deadline costs
     town reputation, which shrinks the daily demand until it is earned back. */
  contracts: {
    offersPerWeek: 2, maxActive: 2, days: [3, 5, 7],
    templates: [
      { give: { eggs: 40, leather: 10 },   get: { supplies: 30, metal: 20, medicine: 4 } },
      { give: { rawMilk: 60, wool: 12 },   get: { cloth: 20, supplies: 25, water: 40 } },
      { give: { meat: 30, feathers: 20 },  get: { metal: 30, fuel: 20, ammo: 15 } },
      { give: { hide: 12, fertilizer: 25 }, get: { wood: 120, stone: 60 } },
      { give: { eggs: 25, rawMilk: 25, meat: 15 }, get: { medicine: 8, supplies: 20, memoryShards: 1 } },
      { give: { wool: 20, leather: 6 },    get: { cloth: 30, metal: 15 } },
      { give: { goldEggs: 12, primeMeat: 8 }, get: { medicine: 12, supplies: 30, memoryShards: 2 } },
    ],
    repHit: 2, repGainOnDeliver: 1, repMin: -6, repMax: 6,
    demandPerDayAtRep: { '-6': 0, '-4': 1, '-2': 2, '0': 3, '2': 4, '4': 5 },
  },

  /* 🐕 Escorts. A guard rides with a shipment: risk × (1 − defense/escortDiv),
     floored, and the guard is away from the pens until the truck is back. */
  escort: { div: 14, minRiskMul: 0.15, woundOnHit: 20 },

  /* 🏛 The Sale Ring — the weekly livestock auction, Athena calling.
     NPC bidders pay in RESOURCES (never Cinder). A consigned beast's reserve
     is its value: species price × weight share × line multiplier × prize.
     The hammer falls `lotMinutes` after consignment; bids land on a seeded
     timeline in between so the ring reads live on every device. */
  auction: {
    dayOfWeek: 6,                // Saturday (local)
    hoursOpen: [8, 22],
    lotMinutes: 20, bidsMin: 4, bidsMax: 9,
    priceMul: { prize: 1.5, rare: 1.6, royal: 2.4, mythic: 4, glow: 2 },
    hammerRange: [0.85, 1.7],
    // 1,000 Cinder of animal value → this bundle, scaled.
    payoutPer1000: { supplies: 4, metal: 3, medicine: 1 },
    bidders: [
      { id: 'kael',   name: 'Warden Kael',    agg: 0.5,  taunt: 'Hoards everything. Never blinks first.' },
      { id: 'broker', name: 'The Broker',     agg: 0.72, taunt: 'Trades secrets for stock.' },
      { id: 'ash',    name: 'Ash Syndicate',  agg: 0.88, taunt: 'Buys low, betrays lower.' },
      { id: 'vex',    name: 'Node Baron Vex', agg: 0.42, taunt: 'Owns three nodes and wants your herd.' },
      { id: 'mara',   name: 'Butcher Mara',   agg: 0.6,  taunt: 'Only bids on what she can cut.' },
    ],
    athena: [
      'Fresh beast on the ring — open your bids, survivors.',
      'Walk it round under the lights. Let us see who wants it.',
      'Cinder is cheap. A good bloodline is not.',
      'This one has papers from the Reconstruction Network. Bid accordingly.',
    ],
    // Player-to-player lots (Cinder, server-settled — see sql/038).
    p2p: { minBid: 500, hoursMin: 6, hoursMax: 72, stepPct: 0.05, antiSnipeMin: 5 },
  },

  /* 🤝 The corp ranch — a shared pasture every member feeds. */
  ranch: {
    capacity: 12, troughCap: 1200, species: ['sheep', 'goat', 'cow'],
    shareWindowDays: 7,          // your claim share = your feed / everyone's feed, last N days
  },

  /* 🏭 Station recipes — instant crafts. */
  recipes: {
    tannery:  { inputs: { hide: 3, water: 2 },  output: { leather: 2 } },
    spinner:  { inputs: { wool: 4 },            output: { cloth: 3 } },
    kitchenMeat: { inputs: { meat: 4 },         output: { food: 6 } },
    kitchenEggs: { inputs: { eggs: 6 },         output: { food: 4 } },
    kitchenMilk: { inputs: { rawMilk: 6 },      output: { food: 5 } },
    // ⭐ Grade-2 goods cook richer: fewer units in, more rations out.
    kitchenGoldEggs: { inputs: { goldEggs: 4 },   output: { food: 6 } },
    kitchenPrime:    { inputs: { primeMeat: 3 },  output: { food: 8 } },
    kitchenCream:    { inputs: { richMilk: 4 },   output: { food: 7 } },
    spinnerFine:     { inputs: { fineWool: 3 },   output: { cloth: 4 } },
  },
  recipeBonusPerLevel: 0.25,

  /* ⭐ GRADE-2 GOODS — the "level 2" versions of what the farm makes, and the
     ONLY way to get them is a better breed. A rare / royal / mythic beast
     turns `shareByTier` of its eggs / milk / wool / meat into the premium
     id; the rest is the ordinary good. The Grading Table (shop, permanent)
     and Provenance Stamps (shop, timed) add to that share, capped at 1.
     Premium goods cook richer at the Kitchen, spin finer at the Spinning Shed,
     and the town pays more for them — they are NOT worth more Cinder anywhere,
     so this is not a faucet, just a better ration. */
  premium: {
    goods: { eggs: 'goldEggs', rawMilk: 'richMilk', wool: 'fineWool', meat: 'primeMeat' },
    shareByTier: { rare: 0.35, royal: 0.6, mythic: 1, glow: 0.5 },
  },

  /* 🛒 THE FARM SHOP — the merchant's cart at the gate. Everything here is
     paid in Cinder + goods and does ONE of three things: makes feed go
     further / work harder (feed), tilts the bloodline dice (breed), or
     raises the grade-2 share of a good breed's yield (grade). Timed items
     run `hours` from purchase and STACK BY EXTENDING (buying an active
     boost adds its hours to the clock, it never doubles the effect — the
     harness checks that). `permanent` items buy once. Effects are
     multipliers folded into simulate() in proportion to how much of a
     simulated interval the boost covered, so a boost that ran out at 3 a.m.
     is honoured for the hours it was live and not a minute more.
     🔴 Nothing in the shop pays out Cinder or creates goods from nothing:
     every effect scales something the animals already produce or eat. */
  shop: {
    items: {
      molasses:  { cat: 'feed',  label: 'Molasses Lick',    icon: '🍯', hours: 24, cost: { cinder: 6000,  food: 10 },                 effect: { feedMul: 0.75 },            blurb: 'Sweetens the trough. Stock eats a quarter less for a day.' },
      kelp:      { cat: 'feed',  label: 'Kelp Meal',        icon: '🌿', hours: 24, cost: { cinder: 9000,  water: 20 },                effect: { yieldMul: 1.25 },           blurb: 'Minerals in the mash: eggs, milk, wool and manure +25% for a day.' },
      mash:      { cat: 'feed',  label: 'Growth Mash',      icon: '🥣', hours: 24, cost: { cinder: 12000, food: 25 },                 effect: { growMul: 1.5 },             blurb: 'Young stock grows half again as fast on every fed hour.' },
      tonic:     { cat: 'feed',  label: 'Vet Tonic',        icon: '🧪', hours: 24, cost: { cinder: 8000,  medicine: 2 },              effect: { healMul: 2, outbreakMul: 0.5 }, blurb: 'In the water for a day: feed heals twice as fast, outbreaks are half as likely.' },
      fertility: { cat: 'breed', label: 'Fertility Mash',   icon: '💞', hours: 24, cost: { cinder: 15000, food: 30 },                 effect: { breedMul: 2 },              blurb: 'Twice the births for a day — you still need the stalls.' },
      salts:     { cat: 'breed', label: 'Bloodline Salts',  icon: '🧂', hours: 48, cost: { cinder: 20000, fertilizer: 10 },           effect: { rareMul: 3 },               blurb: 'Three times the odds that any birth is a rare breed, for two days.' },
      jelly:     { cat: 'breed', label: 'Royal Jelly',      icon: '👑', hours: 48, cost: { cinder: 45000, eggs: 20, rawMilk: 20 },    effect: { lineMul: 2 },               blurb: 'Doubles the odds that two rare parents throw a royal, and two royals a mythic.' },
      stamps:    { cat: 'grade', label: 'Provenance Stamps', icon: '📜', hours: 48, cost: { cinder: 25000, cloth: 10 },               effect: { premiumShareAdd: 0.25 },    blurb: 'Papers for the pens: a quarter more of every good breed’s yield grades as premium, for two days.' },
      grading:   { cat: 'grade', label: 'Grading Table',    icon: '🏷', permanent: true, cost: { cinder: 80000, wood: 60, metal: 30 }, effect: { premiumShareAdd: 0.25 },    blurb: 'A sorting table by the coop door. Permanently grades a quarter more of every good breed’s yield as premium.' },
    },
    cats: { feed: { label: 'Feed & trough', icon: '🌾' }, breed: { label: 'Bloodlines', icon: '🧬' }, grade: { label: 'Grading', icon: '⭐' } },
  },
};

/* ── Species ─────────────────────────────────────────────────────────────── */
const FARM_ANIMALS = [
  { id: 'chicken', name: 'Chicken', plural: 'Chickens', emoji: '🐔', pen: 'coop',
    desc: 'Eggs while it lives, meat and feathers when it does not.',
    size: 0.32, colors: { body: 0xf2e8d5, head: 0xf2e8d5, accent: 0xd8352a, legs: 0xe0a13c } },
  { id: 'cow', name: 'Cow', plural: 'Cows', emoji: '🐄', pen: 'barn',
    desc: 'The big investment. Milk daily, a lot of meat and hide at the end.',
    size: 1.0, colors: { body: 0xf4f1ea, head: 0xf4f1ea, accent: 0x2a2320, legs: 0x3a2f2a } },
  { id: 'pig', name: 'Pig', plural: 'Pigs', emoji: '🐖', pen: 'sty',
    desc: 'Grows fast and grows fat. Kept for the block, not the pail.',
    size: 0.62, colors: { body: 0xf0a8b8, head: 0xf0a8b8, accent: 0xd88898, legs: 0xd88898 } },
  { id: 'sheep', name: 'Sheep', plural: 'Sheep', emoji: '🐑', pen: 'pasture', ground: true,
    desc: 'Wool every season without touching it. The Spinning Shed turns it into cloth.',
    size: 0.58, colors: { body: 0xfaf6ee, head: 0x2b2622, accent: 0xfaf6ee, legs: 0x2b2622 } },
  { id: 'goat', name: 'Goat', plural: 'Goats', emoji: '🐐', pen: 'pasture', ground: true,
    desc: 'Cheap milk on rough ground. Eats less than a cow and complains more.',
    size: 0.55, colors: { body: 0xc9b8a0, head: 0xb8a48c, accent: 0x5a4a3a, legs: 0x8a7660 } },
  // ── Guards. Live at the Guard Post, eat feed, cannot be butchered. ──
  { id: 'terrier', name: 'Terrier', plural: 'Terriers', emoji: '🐕', pen: 'guardpost', guard: true,
    desc: 'Small, loud, fearless. Keeps foxes and hawks off the coop. Useless against wolves.',
    size: 0.3, colors: { body: 0xc8a068, head: 0xc8a068, accent: 0x3a2a1a, legs: 0xa8845a } },
  { id: 'collie', name: 'Collie', plural: 'Collies', emoji: '🐕‍🦺', pen: 'guardpost', guard: true,
    desc: 'A working dog. Herds the pasture and stands its ground against a small raid.',
    size: 0.42, colors: { body: 0x2b2622, head: 0x2b2622, accent: 0xf4f1ea, legs: 0xf4f1ea } },
  { id: 'mastiff', name: 'Mastiff', plural: 'Mastiffs', emoji: '🐶', pen: 'guardpost', guard: true,
    desc: 'Heavy, slow, and nobody argues with it. Turns most raids at the gate.',
    size: 0.55, colors: { body: 0xb08868, head: 0x8a6a50, accent: 0x3a2a1a, legs: 0x9a7a5a } },
  { id: 'donkey', name: 'Donkey', plural: 'Donkeys', emoji: '🫏', pen: 'guardpost', guard: true,
    desc: 'The best guard money buys. Kicks wolves flat, brays at raiders, and manures the field while it waits.',
    size: 0.8, colors: { body: 0x8a8078, head: 0x7a706a, accent: 0xe8e0d0, legs: 0x5a524c } },
];

/* ── Buildings and stations ──────────────────────────────────────────────── */
/* 🏗 Costs raised on the owner's instruction (2026-09-10): resources ×2 and
   Cinder ×1.5 on every level of every building, from the v121v94 table. */
const FARM_BUILDINGS = [
  {
    id: 'feedmill', name: 'Feed Mill', emoji: '🌾', accent: '#d9c46a', station: true, role: 'feed',
    desc: 'Grinds corn, bread and fruit into Animal Feed. Nothing on the farm eats without it.',
    maxLevel: 3, buildH: [0.5, 2, 6], plot: { x: 1, y: 1, w: 3, h: 2 },
    cost: [
      { cinder: 33000, wood: 60, stone: 40, water: 20 },
      { cinder: 90000, wood: 140, stone: 90, metal: 40 },
      { cinder: 225000, wood: 300, stone: 200, metal: 120 },
    ],
  },
  {
    id: 'coop', name: 'Chicken Coop', emoji: '🐔', accent: '#e8c07a', houses: ['chicken'],
    desc: 'Roosts and nesting boxes. Six birds a level. Higher levels mean a stouter fence.',
    maxLevel: 3, buildH: [0.75, 2.5, 6], plot: { x: 5, y: 1, w: 2, h: 2 }, yard: { x: 5, y: 3, w: 3, h: 3 },
    capacity: lv => 6 * lv,
    cost: [
      { cinder: 45000, wood: 80, cloth: 20 },
      { cinder: 112500, wood: 180, cloth: 50, metal: 30 },
      { cinder: 270000, wood: 360, cloth: 120, metal: 80 },
    ],
  },
  {
    id: 'barn', name: 'Cattle Barn', emoji: '🐄', accent: '#c25a3a', houses: ['cow'],
    desc: 'Stalls and a milking bay. Three head a level — cattle need room.',
    maxLevel: 3, buildH: [4, 10, 24], plot: { x: 9, y: 1, w: 4, h: 3 }, yard: { x: 9, y: 4, w: 4, h: 4 },
    capacity: lv => 3 * lv,
    cost: [
      { cinder: 135000, wood: 240, stone: 120, metal: 60 },
      { cinder: 330000, wood: 520, stone: 280, metal: 160 },
      { cinder: 780000, wood: 1040, stone: 600, metal: 360, supplies: 120 },
    ],
  },
  {
    id: 'sty', name: 'Pig Sty', emoji: '🐖', accent: '#e090a8', houses: ['pig'],
    desc: 'Mud, a roof, a trough. Four pigs a level and they will fill it.',
    maxLevel: 3, buildH: [1.5, 4, 10], plot: { x: 1, y: 5, w: 3, h: 2 }, yard: { x: 1, y: 7, w: 3, h: 3 },
    capacity: lv => 4 * lv,
    cost: [
      { cinder: 67500, wood: 120, stone: 60, water: 40 },
      { cinder: 165000, wood: 260, stone: 140, water: 90 },
      { cinder: 390000, wood: 520, stone: 300, water: 200, metal: 60 },
    ],
  },
  {
    id: 'pasture', name: 'Fenced Pasture', emoji: '🐑', accent: '#8fc46a', houses: ['sheep', 'goat'],
    desc: 'Grass and a fence. Sheep and goats graze here; how well depends on the ground your camp stands on.',
    maxLevel: 3, buildH: [1, 3, 8], plot: { x: 5, y: 7, w: 3, h: 2 }, yard: { x: 5, y: 9, w: 4, h: 4 },
    capacity: lv => 5 * lv,
    cost: [
      { cinder: 60000, wood: 160, stone: 20 },
      { cinder: 150000, wood: 340, stone: 60, cloth: 40 },
      { cinder: 360000, wood: 680, stone: 140, cloth: 100, metal: 40 },
    ],
  },
  {
    id: 'guardpost', name: 'Guard Post', emoji: '🐕', accent: '#a8b0c0', houses: ['terrier', 'collie', 'mastiff', 'donkey'],
    desc: 'A doghouse and a lantern. Guards kennel here and patrol every pen. Two a level.',
    maxLevel: 3, buildH: [0.75, 2, 5], plot: { x: 12, y: 8, w: 2, h: 1 }, yard: { x: 12, y: 9, w: 2, h: 2 },
    capacity: lv => 2 * lv,
    cost: [
      { cinder: 42000, wood: 70, stone: 30, cloth: 10 },
      { cinder: 105000, wood: 160, stone: 80, metal: 30 },
      { cinder: 255000, wood: 320, stone: 180, metal: 80 },
    ],
  },
  {
    id: 'butcher', name: "Butcher's Block", emoji: '🔪', accent: '#b8404a', station: true, role: 'slaughter',
    desc: 'Where stock becomes meat, hide and feathers. Higher levels waste less and unlock the trophy cut.',
    maxLevel: 3, buildH: [1, 3, 8], plot: { x: 10, y: 9, w: 2, h: 2 },
    cost: [
      { cinder: 52500, wood: 60, metal: 50, water: 30 },
      { cinder: 135000, wood: 120, metal: 120, water: 60 },
      { cinder: 315000, wood: 240, metal: 280, water: 120, supplies: 60 },
    ],
  },
  {
    id: 'tannery', name: 'Tannery', emoji: '🧥', accent: '#a0704a', station: true, role: 'craft', recipes: ['tannery'],
    desc: 'Cures raw hide into leather. Downwind of everything, for a reason.',
    maxLevel: 3, buildH: [2, 5, 12], plot: { x: 12, y: 11, w: 2, h: 2 },
    cost: [
      { cinder: 72000, wood: 100, stone: 80, water: 60 },
      { cinder: 180000, wood: 200, stone: 180, water: 120, metal: 40 },
      { cinder: 420000, wood: 400, stone: 360, water: 240, metal: 100 },
    ],
  },
  {
    id: 'spinner', name: 'Spinning Shed', emoji: '🧵', accent: '#e0b8c8', station: true, role: 'craft', recipes: ['spinner', 'spinnerFine'],
    desc: 'Cards and spins wool into cloth — the same cloth the city builder already prices.',
    maxLevel: 3, buildH: [1.5, 4, 10], plot: { x: 1, y: 11, w: 3, h: 2 },
    cost: [
      { cinder: 63000, wood: 120, cloth: 30, metal: 20 },
      { cinder: 157500, wood: 240, cloth: 70, metal: 50 },
      { cinder: 375000, wood: 480, cloth: 160, metal: 120 },
    ],
  },
  {
    id: 'vet', name: 'Vet Clinic', emoji: '🩺', accent: '#ff8aa0', station: true, role: 'vet',
    desc: 'Treats sick stock from the medicine stash every hour it is open, and halves the odds of an outbreak. Higher levels cure faster.',
    maxLevel: 3, buildH: [2, 5, 12], plot: { x: 1, y: 13, w: 3, h: 1 },
    cost: [
      { cinder: 82500, wood: 100, metal: 50, medicine: 12 },
      { cinder: 210000, wood: 200, metal: 120, medicine: 30 },
      { cinder: 495000, wood: 400, metal: 280, medicine: 70, supplies: 60 },
    ],
  },
  {
    id: 'salering', name: 'Sale Ring', emoji: '🏛', accent: '#d4af37', station: true, role: 'auction',
    desc: 'The auction ring. Consign a prize or rare beast on sale day and Athena calls the bids — in goods from the ring\'s regulars, or in Cinder from other players.',
    maxLevel: 2, buildH: [3, 8], plot: { x: 12, y: 13, w: 2, h: 1 },
    cost: [
      { cinder: 120000, wood: 180, stone: 120, cloth: 40 },
      { cinder: 330000, wood: 400, stone: 280, cloth: 100, metal: 80 },
    ],
  },
  {
    id: 'kitchen', name: 'Farm Kitchen', emoji: '🍳', accent: '#ffcf6b', station: true, role: 'craft',
    recipes: ['kitchenMeat', 'kitchenEggs', 'kitchenMilk', 'kitchenGoldEggs', 'kitchenPrime', 'kitchenCream'],
    desc: 'Smokes meat, boils eggs, sets milk: everything the farm makes can become rations.',
    maxLevel: 3, buildH: [1.5, 4, 10], plot: { x: 5, y: 13, w: 3, h: 1 },
    cost: [
      { cinder: 57000, wood: 80, stone: 60, metal: 30 },
      { cinder: 142500, wood: 160, stone: 140, metal: 70 },
      { cinder: 345000, wood: 320, stone: 300, metal: 160, supplies: 50 },
    ],
  },
];

/* ═══ ⚒ FARM ↔ ATHENA (build A's farm.athena.js, inlined — this bundle imports nothing) ═══ */
const FarmAthena = (() => {
  /* ════════════════════════════════════════════════════════════════════════════
     🐄 HOMESTEAD FARM ↔ ⚒ ATHENA ENGINE — the farm as a GAME SCENE.
     ----------------------------------------------------------------------------
     Two directions, one file:

     1. ADAPTER (farm → Athena). The farm registers itself with
        AthenaEngine.games so the editor can open "Homestead Farm" from its
        Maps tab. build() turns FARM_GRID + FARM_BUILDINGS into a map document:
        a flat 20 m ground and one 🧩 slot object per building (objects[].k =
        the building id), sorted into two content folders. The map is tagged
        game: 'farm' and, by default, renders NONE of its own ground/water/sky
        in the game — the farm keeps those; the map only contributes the slot
        transforms, replacements and whatever else the admin places.

     2. OVERLAY (Athena → farm). When the 3D scene mounts it asks Athena for
        the LIVE farm map and gets back an overlay: the placed objects built
        into a group the scene adds as-is, plus placement() / replacement()
        per building so the farm draws each building where the admin put it,
        at the admin's scale and turn, or draws the admin's prop / .glb in its
        place. Yards (where the animals wander) and fences shift with their
        pen. Everything degrades: no Athena, no map, or a signed-out player →
        the farm draws exactly as it did before this file existed.

     ⚠ The live map is GLOBAL — one live 'farm' scene per owner, and the game
       loads the newest live one — so the "Open in Athena Engine" button is
       admin-only: this is how the game's farm is redesigned for everyone, not
       a per-player cosmetic (that is the Athena look tab next to it).
     ⚠ Coordinates: the farm's tileToWorld(gx, gy) = (gx - w/2, gy - h/2) in
       metres with the grid centred on the origin, which is exactly Athena's
       frame (terrain centred, metres, Y up) — so slot positions are used raw.
     ⚠ THREE: both sides use the r128 global build (window.THREE), so objects
       built by Athena can sit in the farm's scene graph. Never mix in the
       import-map three (0.171).
     ════════════════════════════════════════════════════════════════════════════ */

  /* ⚠ Build B ships the farm as ONE bundle (index.js) rather than farm.data.js
     + farm.scene.js, so the tables arrive by configure() from the bundle
     (called right after FARM_GRID is defined) instead of an import. */
  let FARM_BUILDINGS = [], FARM_GRID = { w: 14, h: 14 };
  function configure(o) { if (o && Array.isArray(o.FARM_BUILDINGS)) FARM_BUILDINGS = o.FARM_BUILDINGS; if (o && o.FARM_GRID) FARM_GRID = o.FARM_GRID; }

  const FARM_GAME_ID = 'farm';

  function tileToWorld(gx, gy) { return { x: gx - FARM_GRID.w / 2, z: gy - FARM_GRID.h / 2 }; }
  function uid(p) { return (p || 'o') + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }

  /* ── 1. the adapter ──────────────────────────────────────────────────────── */
  function buildFarmMap() {
    const n = 20, cell = 1, verts = (n + 1) * (n + 1);
    const F_PENS = 'f_farm_pens', F_STATIONS = 'f_farm_stations';
    const objects = FARM_BUILDINGS.map(def => {
      const c = tileToWorld(def.plot.x + def.plot.w / 2, def.plot.y + def.plot.h / 2);
      return { id: 'o_farm_' + def.id, t: 'slot', k: def.id, n: def.name, c: def.accent, p: [c.x, 0, c.z], r: [0, 0, 0], s: [1, 1, 1], g: true, f: def.houses ? F_PENS : F_STATIONS };
    });
    return {
      v: 1, id: uid('map_'), name: 'Homestead Farm', description: 'The camp\'s homestead: one slot per building. Move a slot to move the building; replace it to swap the model.',
      game: FARM_GAME_ID,
      terrain: { n, cell, heights: new Array(verts).fill(0), paint: new Array(verts).fill(0) },
      water: { on: false, level: -1, color: '#2e6f9e', opacity: 0.78, wave: 0.12, speed: 1 },
      env: { preset: 'day', shadows: true, weather: 'none' },
      assets: [],
      folders: [
        { id: F_PENS, name: 'Pens', parent: null, open: true, vis: true, lock: false },
        { id: F_STATIONS, name: 'Stations', parent: null, open: true, vis: true, lock: false },
      ],
      objects,
      scene: { ground: false, water: false, sky: false },
      meta: { created: Date.now(), updated: Date.now(), author: 'Homestead Farm' },
    };
  }

  const FARM_ADAPTER = {
    id: FARM_GAME_ID, label: 'Homestead Farm', icon: '🐄',
    describe: 'The camp\'s 3D homestead. One slot per building (pens and stations). Ground, sky and animals stay the farm\'s; everything else you place shows up on every player\'s farm once the map is live.',
    get slots() { return FARM_BUILDINGS.map(def => ({ k: def.id, label: def.name, icon: def.emoji })); },
    build: buildFarmMap,
  };

  let _registered = false;
  function registerWithAthena() {
    if (_registered) return true;
    try {
      const A = window.AthenaEngine || window.MythicMapForge;
      if (A && A.games && typeof A.games.register === 'function') { A.games.register(FARM_ADAPTER); _registered = true; return true; }
      // Athena has not loaded yet (module order is not guaranteed): queue it. index.js drains this.
      if (!window.__athenaGames) window.__athenaGames = [];
      window.__athenaGames.push(FARM_ADAPTER); _registered = true; return true;
    } catch (e) { return false; }
  }

  function athenaAvailable() { try { const A = window.AthenaEngine || window.MythicMapForge; return !!(A && A.open); } catch (e) { return false; } }
  function openInAthena() {
    try { const A = window.AthenaEngine || window.MythicMapForge; if (!A || !A.open) return false; registerWithAthena(); A.open({ game: FARM_GAME_ID }); return true; } catch (e) { return false; }
  }

  /* ── 2. the overlay ──────────────────────────────────────────────────────── */
  /* Resolves to null when there is nothing to overlay (no Athena, no live map). */
  async function loadOverlay(THREE, scene, opts) {
    opts = opts || {};
    let A; try { A = window.AthenaEngine || window.MythicMapForge; } catch (e) { A = null; }
    if (!A || !A.overlay || typeof A.overlay.forGame !== 'function') return null;
    let ov;
    try { ov = await A.overlay.forGame(FARM_GAME_ID, { THREE, scene, lights: false, force: !!opts.force }); } catch (e) { try { console.warn('[farm] athena overlay failed:', e); } catch (x) {} return null; }
    if (!ov) return null;
    const byKey = {}; ov.slots().forEach(s => { if (s) byKey[s.o.k] = s; });
    const placementOf = (def) => {
      const s = byKey[def.id];
      const home = tileToWorld(def.plot.x + def.plot.w / 2, def.plot.y + def.plot.h / 2);
      if (!s) return { x: home.x, z: home.z, y: 0, ry: 0, scale: 1, hidden: false, replaced: false, dx: 0, dz: 0, home: true };
      return { x: s.p[0], z: s.p[2], y: s.p[1] || 0, ry: s.r[1] || 0, scale: s.s[0] || 1, hidden: !!s.hidden, replaced: !!s.replaced, dx: s.p[0] - home.x, dz: s.p[2] - home.z, home: false };
    };
    return {
      group: ov.group, pieces: ov.pieces, map: ov.map, source: ov.source,
      placement: placementOf,
      /* the yard, shifted with its pen (rounded to whole tiles so the wander grid stays sane) */
      yardOf(def) {
        const y = def.yard || def.plot; const p = placementOf(def);
        if (p.home) return y;
        return { x: y.x + Math.round(p.dx), y: y.y + Math.round(p.dz), w: y.w, h: y.h };
      },
      /* an Object3D for a replaced slot (prop or .glb), or null */
      replacement(def) { try { return ov.buildReplacement(def.id); } catch (e) { return null; } },
      update(dt, camera) { try { ov.update(dt, camera); } catch (e) {} },
      dispose() { try { ov.dispose(); } catch (e) {} },
    };
  }

  /* Athena tells the page when a map is saved, set live or the editor closes;
     the farm reloads its overlay so what the admin just did shows at once. */
  function watchAthena(fn) {
    const h = (e) => { try { const g = e && e.detail && e.detail.game; if (!g || g === FARM_GAME_ID) fn(e.type); } catch (x) {} };
    ['athena:saved', 'athena:live', 'athena:closed'].forEach(t => window.addEventListener(t, h));
    return () => ['athena:saved', 'athena:live', 'athena:closed'].forEach(t => window.removeEventListener(t, h));
  }

  return { configure, FARM_GAME_ID, buildFarmMap, FARM_ADAPTER, registerWithAthena, athenaAvailable, openInAthena, loadOverlay, watchAthena };
})();
const FARM_GRID = { w: 14, h: 14 };
/* ⚒ Athena Engine (merged v121v116): the farm registers itself as a game scene
   and, when a live 'farm' map exists, draws its buildings where the admin put
   them (farm.athena.js — build A's round 5 adapter, ported onto this bundle). */
FarmAthena.configure({ FARM_BUILDINGS, FARM_GRID });

const RECIPE_LABELS = {
  tannery: 'Cure hide → leather',
  spinner: 'Spin wool → cloth',
  kitchenMeat: 'Smoke meat → food',
  kitchenEggs: 'Boil eggs → food',
  kitchenMilk: 'Set milk → food',
  kitchenGoldEggs: 'Golden eggs → food',
  kitchenPrime: 'Prime cuts → food',
  kitchenCream: 'Rich milk → food',
  spinnerFine: 'Fine wool → cloth',
};

/* 🅰 Athena Editor — the owner's look settings. Palettes are named so the
   scene and the editor share one vocabulary; `roof` overrides per building. */
const FARM_LOOKS = {
  ground: {
    meadow: { label: 'Meadow',   a: 0x4f7a3a, b: 0x55823f, rim: 0x6b4f34 },
    dry:    { label: 'Dry range', a: 0x8a7a44, b: 0x94844c, rim: 0x6b5434 },
    snow:   { label: 'Snowfield', a: 0xdfe6ec, b: 0xd2dae2, rim: 0x8a8f96 },
    ash:    { label: 'Ashland',  a: 0x4a4a52, b: 0x52525a, rim: 0x3a3238 },
    lush:   { label: 'Lush',     a: 0x2f6a3a, b: 0x357542, rim: 0x5a4a30 },
  },
  sky: {
    day:   { label: 'Day',   top: 0x7fb8ff, bottom: 0xdfe8ff, sun: 1.15, hemi: 0.9 },
    dusk:  { label: 'Dusk',  top: 0x3a2a5a, bottom: 0xff9a5a, sun: 0.8, hemi: 0.7 },
    night: { label: 'Night', top: 0x0a0f22, bottom: 0x1a2244, sun: 0.35, hemi: 0.45 },
    storm: { label: 'Overcast', top: 0x3a4250, bottom: 0x6a7280, sun: 0.6, hemi: 0.8 },
  },
  decor: {
    trees:    { label: 'Treeline' },
    pond:     { label: 'Pond' },
    windmill: { label: 'Windmill' },
    hay:      { label: 'Hay bales' },
    crops:    { label: 'Crop rows' },
    paths:    { label: 'Dirt paths' },
    lanterns: { label: 'Lanterns' },
    fence:    { label: 'Perimeter fence' },
  },
  defaults: { ground: 'meadow', sky: 'day', decor: { trees: true, pond: true, windmill: true, hay: true, crops: true, paths: true, lanterns: false, fence: true }, roofs: {}, name: '' },
};

function animalDef(id) { return FARM_ANIMALS.find(a => a.id === id) || null; }
function buildingDef(id) { return FARM_BUILDINGS.find(b => b.id === id) || null; }
function penFor(speciesId) {
  const a = animalDef(speciesId);
  return a ? buildingDef(a.pen) : null;
}
function buildingCostAt(def, level) {
  if (!def || !Array.isArray(def.cost) || !def.cost.length) return null;
  const i = Math.max(0, Math.min(def.cost.length - 1, (level | 0) - 1));
  return def.cost[i];
}

/* Every ledger id the farm can pay out or consume — the promotion contract. */
const FARM_RESOURCE_IDS = [
  'animalFeed', 'eggs', 'feathers', 'rawMilk', 'meat', 'wool', 'hide', 'leather', 'fertilizer', 'livestock',
  // ⭐ grade-2 goods (round 5): only a rare-or-better breed makes them.
  'goldEggs', 'primeMeat', 'richMilk', 'fineWool',
  'food', 'water', 'wood', 'stone', 'cloth', 'metal', 'supplies', 'medicine', 'memoryShards', 'dna', 'fuel', 'ammo',
];

function auditCatalog(knownIds) {
  const known = new Set(knownIds || []);
  const missing = [];
  const need = new Set(FARM_RESOURCE_IDS);
  Object.values(FARM_ECON.yieldsPerH).forEach(y => Object.keys(y).forEach(k => need.add(k)));
  Object.values(FARM_ECON.slaughter).forEach(y => Object.keys(y).forEach(k => need.add(k)));
  Object.values(FARM_ECON.recipes).forEach(r => { Object.keys(r.inputs).forEach(k => need.add(k)); Object.keys(r.output).forEach(k => need.add(k)); });
  FARM_ECON.townDemand.offers.forEach(o => { Object.keys(o.give).forEach(k => need.add(k)); Object.keys(o.get).forEach(k => need.add(k)); });
  FARM_ECON.contracts.templates.forEach(o => { Object.keys(o.give).forEach(k => need.add(k)); Object.keys(o.get).forEach(k => need.add(k)); });
  Object.keys(FARM_ECON.auction.payoutPer1000).forEach(k => need.add(k));
  Object.values(FARM_ECON.premium.goods).forEach(k => need.add(k));
  Object.values(FARM_ECON.shop.items).forEach(it => Object.keys(it.cost || {}).forEach(k => { if (k !== 'cinder') need.add(k); }));
  Object.values(FARM_ECON.events).forEach(e => { Object.keys(e.loot || {}).forEach(k => need.add(k)); Object.keys(e.gift || {}).forEach(k => need.add(k)); Object.keys(e.repair || {}).forEach(k => need.add(k)); });
  FARM_BUILDINGS.forEach(b => b.cost.forEach(c => Object.keys(c).forEach(k => { if (k !== 'cinder') need.add(k); })));
  need.forEach(id => { if (!known.has(id)) missing.push(id); });
  return missing;
}

/* ═══ farm.events.js ═══ */
/* ════════════════════════════════════════════════════════════════════════════
   🐄 HOMESTEAD FARM — pure helpers for the living layer: seasons, the farm's
   own weather, the seeded RNG the event windows use, and animal names.
   ----------------------------------------------------------------------------
   Everything here is a pure function of (seed, time). That is what makes an
   offline stretch replayable: two devices that both wake up after the same
   night roll the SAME fog, the SAME raid and the SAME fox, so the cloud merge
   never has to reconcile two different histories.
   ════════════════════════════════════════════════════════════════════════════ */


const H = 3600000;

function hash32(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
/* xorshift32 — tiny, deterministic, good enough for a fox. */
function rngFor(seed) {
  let x = (hash32(seed) || 0x9e3779b9) >>> 0;
  return () => {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    return (x >>> 0) / 4294967296;
  };
}
function pickWeighted(rnd, table) {
  const keys = Object.keys(table);
  const total = keys.reduce((a, k) => a + (table[k].weight || 0), 0);
  let r = rnd() * total;
  for (const k of keys) { r -= (table[k].weight || 0); if (r <= 0) return k; }
  return keys[keys.length - 1];
}

/* 🍂 Season by calendar month. */
function seasonFor(now) {
  const m = new Date(now || Date.now()).getMonth();
  const keys = Object.keys(FARM_ECON.seasons);
  for (const k of keys) if (FARM_ECON.seasons[k].months.indexOf(m) >= 0) return Object.assign({ key: k }, FARM_ECON.seasons[k]);
  return Object.assign({ key: keys[0] }, FARM_ECON.seasons[keys[0]]);
}

/* 🌦 Weather for the window containing `now`. */
function weatherWindowIndex(now) { return Math.floor((now || Date.now()) / (FARM_ECON.weatherWindowH * H)); }
/* 🌦 THE CITY'S WEATHER FIRST. node-city publishes its live `wx` (type + the
   deadline of the current front) and the bridge hands it over; the farm's
   own seeded roll below is only the fallback for a player whose city has
   never run. A front whose deadline has passed reads as clear — the city
   would have cleared it too. `_wxHost` is set at mount so every reader
   (summary, simulate, the raid roll) sees the same sky. */
let _wxHost = null;
const CITY_WX_MAP = { clear: 'clear', cloudy: 'cloud', rain: 'rain', storm: 'storm', snow: 'snow', tornado: 'storm', firerain: 'storm', anomaly: 'storm' };
function cityWeatherAt(now) {
  try {
    if (!_wxHost || typeof _wxHost.cityWeather !== 'function') return null;
    const c = _wxHost.cityWeather(); if (!c || !c.type) return null;
    let key = CITY_WX_MAP[c.type] || 'clear';
    if (key !== 'clear' && c.until && (now || Date.now()) > c.until) key = 'clear';
    const idx = weatherWindowIndex(now);
    return Object.assign({ key, idx, until: c.until || (idx + 1) * FARM_ECON.weatherWindowH * H, city: true }, FARM_ECON.weather[key] || FARM_ECON.weather.clear);
  } catch (e) { return null; }
}
/* 🕒 The sky by the city's clock: the same bands node-city's phaseBlend uses. */
function skyForHour(h, fallback) {
  if (h == null || !isFinite(h)) return fallback;
  if (h < 5 || h >= 21) return 'night';
  if (h < 7 || h >= 19) return 'dusk';
  return 'day';
}
function cityHourNow() { try { const x = _wxHost && typeof _wxHost.cityHour === 'function' ? _wxHost.cityHour() : null; return (x == null || !isFinite(x)) ? null : x; } catch (e) { return null; } }
/* 🌦 Weather for the window containing `now` — the city's, or the seeded fallback. */
function weatherAt(seed, now) {
  const city = cityWeatherAt(now); if (city) return city;
  const idx = weatherWindowIndex(now);
  const key = pickWeighted(rngFor('wx:' + seed + ':' + idx), FARM_ECON.weather);
  return Object.assign({ key, idx, until: (idx + 1) * FARM_ECON.weatherWindowH * H }, FARM_ECON.weather[key]);
}

/* ⚔ Event windows crossed between `from` and `to` (exclusive of the one
   `from` sits in, inclusive of `to`'s). Each is rolled with its own seed. */
function eventWindowsBetween(from, to) {
  const W = FARM_ECON.eventWindowH * H;
  const a = Math.floor(from / W), b = Math.floor(to / W);
  const out = [];
  for (let i = a + 1; i <= b && out.length < 400; i++) out.push({ idx: i, at: i * W });
  return out;
}

/* 🏷 Names. Seeded by animal id so the same beast keeps the same name on
   every device until the owner renames it. */
const NAMES = {
  chicken: ['Henrietta', 'Pecky', 'Marigold', 'Nugget', 'Dotty', 'Clementine', 'Biscuit', 'Peggy', 'Goldie', 'Feathers'],
  cow:     ['Buttercup', 'Daisy', 'Bessie', 'Clover', 'Maple', 'Duchess', 'Rosie', 'Marigold', 'Bramble', 'Juniper'],
  pig:     ['Wilbur', 'Truffle', 'Porkchop', 'Hamlet', 'Peppa', 'Rasher', 'Tubs', 'Pudding', 'Snout', 'Babe'],
  sheep:   ['Shaun', 'Woolly', 'Dolly', 'Fleece', 'Lamb Chop', 'Cotton', 'Merino', 'Baabara', 'Nimbus', 'Ewenice'],
  goat:    ['Billy', 'Nanny', 'Gruff', 'Pickles', 'Capra', 'Heidi', 'Rocky', 'Cinnamon', 'Butthead', 'Gizmo'],
  terrier: ['Scrappy', 'Biscuit', 'Rufus', 'Pip', 'Tilly'],
  collie:  ['Lassie', 'Fly', 'Meg', 'Skye', 'Bramble'],
  mastiff: ['Brutus', 'Bear', 'Hulk', 'Tank', 'Duchess'],
  donkey:  ['Eeyore', 'Benjamin', 'Dominic', 'Jenny', 'Balthazar'],
};
function defaultName(sp, id) {
  const list = NAMES[sp] || ['Beast'];
  return list[hash32('nm:' + sp + ':' + id) % list.length];
}

/* 🏴 Rival raiders. Real camp names from Territory Wars when the bridge can
   supply them; otherwise bandit gangs, so the story never reads "undefined". */
const GANGS = ['the Ashfield Reavers', 'the Sludge Queen\'s runners', 'the Hollow Road gang', 'the Rustwater Cartel', 'Voss\'s deserters', 'the Cinder Foxes'];
function rivalName(rnd, rivals) {
  const list = Array.isArray(rivals) ? rivals.filter(n => typeof n === 'string' && n.trim()) : [];
  if (list.length && rnd() < 0.7) return list[Math.floor(rnd() * list.length)];
  return GANGS[Math.floor(rnd() * GANGS.length)];
}

function ageLabel(hours) {
  if (!(hours > 0)) return 'newborn';
  if (hours < 24) return Math.floor(hours) + 'h';
  const d = Math.floor(hours / 24);
  if (d < 60) return d + 'd';
  return Math.floor(d / 30) + 'mo';
}

/* ═══ farm.state.js ═══ */
/* ════════════════════════════════════════════════════════════════════════════
   🐄 HOMESTEAD FARM — state, simulation and every mutator.
   ----------------------------------------------------------------------------
   Pure over a `host` adapter (see index.js makeHost): this file never touches
   window, Profile or the DOM, so a node harness can drive the whole economy
   with a fake host and diff the ledger (tools/farm_harness.mjs does).

   State shape, persisted at Profile.farm through the bridge:
     {
       v: 2, ts, seed,
       buildings: { [defId]: { level, builtAt, feed, simAt, lastCollect, accrual: {resId: float}, damaged } },
       animals:   [ { id, sp, name, ageH, grownH, hungry, health, breed, born } ],
       seq, eventAt, journal: [ {t, kind, icon, text} ], stats: {...},
       demand: { day, used }, look: { ground, sky, decor, roofs, name },
     }
     ageH   = REAL hours lived (old age, the prize ribbon, the card's "Age").
     grownH = FED hours (growth, weight, adulthood). v1 saves stored only
              ageH-as-fed-hours; ensureState migrates them.

   ⏱ THE SIMULATION IS DETERMINISTIC AND OFFLINE. Nothing ticks in the
   background: every read calls simulate() first, which advances each pen from
   its `simAt` to now using only the feed that was in the trough, then replays
   every 6h event window the farm slept through with a seeded RNG. A 3-day
   absence and a 3-second one are the same code path.

   🔴 SPENDING IS ATOMIC OR REFUNDED. spendCost() takes resource legs first and
   Cinder last, and unwinds every taken leg with host.refundRes (UNCAPPED). A
   save failure after a spend is turned back into an exception so the same
   unwind runs, and the in-memory state is restored from a snapshot.

   🔴 EVENTS ARE THE ONE PLACE A *READ* WRITES. A replayed window can add loot
   to the ledger or remove an animal; if that were not persisted at once the
   next reload would replay the same window (double gift, double loss). So
   simulate() reports `changed` and summary() records when it is set.
   ════════════════════════════════════════════════════════════════════════════ */




const DAY = 86400000;

/* ── State ─────────────────────────────────────────────────────────────────── */
function ensureState(host) {
  let s = host.state();
  if (!s || typeof s !== 'object') s = {};
  const v1 = s.v === 1;
  s.v = 2;
  if (!s.buildings || typeof s.buildings !== 'object') s.buildings = {};
  if (!Array.isArray(s.animals)) s.animals = [];
  if (typeof s.seq !== 'number') s.seq = 1;
  if (typeof s.ts !== 'number') s.ts = 0;
  if (typeof s.seed !== 'string' || !s.seed) s.seed = 'f' + Math.floor(Math.random() * 1e9).toString(36) + Date.now().toString(36);
  if (typeof s.eventAt !== 'number') s.eventAt = Date.now();
  if (!Array.isArray(s.journal)) s.journal = [];
  if (!s.stats || typeof s.stats !== 'object') s.stats = {};
  if (!Array.isArray(s.shipments)) s.shipments = [];
  s.shipments = s.shipments.filter(x => x && animalDef(x.sp) && (x.n | 0) > 0).map(x => ({ id: x.id | 0, sp: x.sp, n: x.n | 0, carrier: String(x.carrier || ''), label: String(x.label || ''), departAt: Number(x.departAt) || 0, arriveAt: Number(x.arriveAt) || 0, fee: x.fee | 0, price: x.price | 0, risk: Number(x.risk) || 0, insured: Number(x.insured) || 0, escort: x.escort | 0 }));
  ['births', 'slaughtered', 'meat', 'raidsRepelled', 'raidsLost', 'predatorsRepelled', 'lost', 'died', 'abducted', 'returned', 'delivered', 'crated', 'shipped', 'lostInTransit', 'built', 'outbreaks', 'cured', 'contractsDone', 'contractsFailed', 'auctions', 'auctionValue', 'shopBuys', 'premium'].forEach(k => { if (typeof s.stats[k] !== 'number') s.stats[k] = 0; });
  if (!s.demand || typeof s.demand !== 'object') s.demand = { day: 0, used: 0 };
  if (!s.contracts || typeof s.contracts !== 'object') s.contracts = { week: 0, offers: [], active: [], rep: 0 };
  if (!Array.isArray(s.contracts.offers)) s.contracts.offers = [];
  if (!Array.isArray(s.contracts.active)) s.contracts.active = [];
  s.contracts.rep = Math.max(FARM_ECON.contracts.repMin, Math.min(FARM_ECON.contracts.repMax, s.contracts.rep | 0));
  if (!s.collection || typeof s.collection !== 'object') s.collection = {};
  if (!s.collectionRewarded || typeof s.collectionRewarded !== 'object') s.collectionRewarded = {};
  if (!Array.isArray(s.lots)) s.lots = [];
  // 🛒 Shop: timed boosts (item → expiry ms) and one-time unlocks (item → true).
  if (!s.boosts || typeof s.boosts !== 'object') s.boosts = {};
  Object.keys(s.boosts).forEach(k => { const it = FARM_ECON.shop.items[k]; const at = Number(s.boosts[k]) || 0; if (!it || it.permanent || at <= 0) delete s.boosts[k]; else s.boosts[k] = at; });
  if (!s.unlocks || typeof s.unlocks !== 'object') s.unlocks = {};
  Object.keys(s.unlocks).forEach(k => { const it = FARM_ECON.shop.items[k]; if (!it || !it.permanent || !s.unlocks[k]) delete s.unlocks[k]; });
  if (!Array.isArray(s.holding)) s.holding = [];      // beasts that came back (claimed lots) with no room in the pen yet
  s.holding = s.holding.filter(a => a && animalDef(a.sp));
  s.lots = s.lots.filter(l => l && l.animal && animalDef(l.animal.sp));
  s.look = normalizeLook(s.look);
  Object.keys(s.buildings).forEach(id => {
    const b = s.buildings[id];
    if (!b || typeof b !== 'object' || !buildingDef(id)) { delete s.buildings[id]; return; }
    b.level = Math.max(1, b.level | 0);
    b.feed = Math.max(0, Number(b.feed) || 0);
    b.simAt = Number(b.simAt) || Date.now();
    b.lastCollect = Number(b.lastCollect) || 0;
    b.damaged = !!b.damaged;
    b.readyAt = Number(b.readyAt) || 0;          // 0 = finished (v2 saves predate construction)
    b.constructing = !!b.constructing && b.readyAt > 0;
    b.pendingLevel = (b.pendingLevel | 0) > b.level ? (b.pendingLevel | 0) : 0;
    if (!b.accrual || typeof b.accrual !== 'object') b.accrual = {};
  });
  s.animals = s.animals.filter(a => a && animalDef(a.sp)).map(a => {
    const fed = Math.max(0, Number(v1 ? a.ageH : a.grownH) || 0);
    return {
      id: a.id | 0, sp: a.sp,
      name: (typeof a.name === 'string' && a.name.trim()) ? a.name.trim().slice(0, 24) : defaultName(a.sp, a.id | 0),
      ageH: Math.max(0, Number(v1 ? a.ageH : a.ageH) || 0),
      grownH: fed,
      hungry: Math.max(0, Number(a.hungry) || 0),
      health: (typeof a.health === 'number') ? Math.max(0, Math.min(100, a.health)) : 100,
      breed: (typeof a.breed === 'string' && FARM_ECON.breeds[a.breed]) ? a.breed : null,
      born: Number(a.born) || 0,
      ill: (typeof a.ill === 'string' && FARM_ECON.disease.kinds[a.ill]) ? a.ill : null,
      illSince: Number(a.illSince) || 0,
      away: a.away | 0,                       // shipment id this guard is escorting, else 0
    };
  });
  return s;
}
function normalizeLook(look) {
  const d = FARM_LOOKS.defaults;
  const o = (look && typeof look === 'object') ? look : {};
  const out = {
    ground: FARM_LOOKS.ground[o.ground] ? o.ground : d.ground,
    sky: FARM_LOOKS.sky[o.sky] ? o.sky : d.sky,
    decor: Object.assign({}, d.decor),
    roofs: {},
    name: (typeof o.name === 'string') ? o.name.slice(0, 28) : '',
  };
  if (o.decor && typeof o.decor === 'object') Object.keys(FARM_LOOKS.decor).forEach(k => { if (typeof o.decor[k] === 'boolean') out.decor[k] = o.decor[k]; });
  if (o.roofs && typeof o.roofs === 'object') Object.keys(o.roofs).forEach(k => { if (buildingDef(k) && /^#[0-9a-fA-F]{6}$/.test(String(o.roofs[k]))) out.roofs[k] = String(o.roofs[k]).toLowerCase(); });
  return out;
}

/* 💾 The one write path. THROWS on a failed persist so refunds are reachable. */
function record(host, s) {
  s.ts = Date.now();
  if (host.setState(s) === false) throw new Error('farm: setState failed');
  if (host.save() === false) throw new Error('farm: save failed');
}
function journal(s, kind, icon, text, now) {
  s.journal.unshift({ t: now || Date.now(), kind, icon, text: String(text).slice(0, 220) });
  if (s.journal.length > 40) s.journal.length = 40;
}

/* ── Reads ─────────────────────────────────────────────────────────────────── */
function building(s, id) { return s.buildings[id] || null; }
function has(s, id) { return !!building(s, id); }
function animalsOf(s, sp) { return s.animals.filter(a => a.sp === sp); }
function animalById(s, id) { return s.animals.find(a => a.id === (id | 0)) || null; }
function animalsInPen(s, penId) {
  const def = buildingDef(penId);
  if (!def || !def.houses) return [];
  return s.animals.filter(a => def.houses.indexOf(a.sp) >= 0);
}
function econOf(a) { return FARM_ECON.animals[a.sp] || null; }
function isAdult(a) { const d = econOf(a); return !!d && a.grownH >= d.growH; }
function isGuard(a) { const d = animalDef(a.sp); return !!(d && d.guard); }
function isSick(a) { return a.health < FARM_ECON.health.sickBelow; }
/* Health → output factor: 0 when sick, then 0.5 → 1 across the healthy band. */
function healthFactor(a) {
  const sb = FARM_ECON.health.sickBelow;
  if (a.health < sb) return 0;
  return 0.5 + 0.5 * (a.health - sb) / (100 - sb);
}
function breedOf(a) { return a.breed ? FARM_ECON.breeds[a.breed] : null; }
function yieldMul(a) { const b = breedOf(a); let m = b ? b.yieldMul : 1; if (a.ill) m *= FARM_ECON.disease.yieldMul; return m; }
function tierOf(a) { const b = breedOf(a); return b ? b.tier : null; }
/* 🦠 */
function isIll(a) { return !!a.ill; }
function diseaseFor(sp, rnd) {
  const ks = Object.keys(FARM_ECON.disease.kinds).filter(k => FARM_ECON.disease.kinds[k].species.indexOf(sp) >= 0);
  return ks.length ? ks[Math.floor((rnd ? rnd() : Math.random()) * ks.length)] : null;
}
/* Weight in kg: 15% of adult at birth → adult at growH → creeps to max. */
function weightOf(a) {
  const e = econOf(a); if (!e) return 0;
  const g = Math.min(1, a.grownH / e.growH);
  let w = e.adultWeight * (0.15 + 0.85 * g);
  if (a.grownH > e.growH) w += (e.maxWeight - e.adultWeight) * Math.min(1, (a.grownH - e.growH) / (e.growH * 2));
  // A starved or sick animal is a lighter one.
  w *= 0.75 + 0.25 * (a.health / 100);
  return Math.round(w * 10) / 10;
}
function penCapacity(s, penId, host) {
  const def = buildingDef(penId), b = building(s, penId);
  if (!(def && b && typeof def.capacity === 'function')) return 0;
  let cap = def.capacity(b.level);
  if (host && penId === 'pasture' && terroirTier(host) === 'BARREN') cap = Math.max(1, cap - FARM_ECON.terroirBarrenCapLoss);
  return cap;
}
/* 🏗 A building under construction exists on the plot but cannot be used. */
function isReady(s, id, now) { const b = building(s, id); return !!b && !(b.constructing && b.readyAt > (now || Date.now())); }
function buildProgress(s, id, now) {
  const b = building(s, id); now = now || Date.now();
  if (!b || !b.readyAt || b.readyAt <= now) return null;
  const total = b.readyAt - (b.startedAt || b.builtAt || now), left = b.readyAt - now;
  return { left, total, pct: total > 0 ? Math.max(0, Math.min(100, Math.round((1 - left / total) * 100))) : 0, upgrading: !b.constructing, toLevel: b.pendingLevel || b.level };
}
function buildersBonus(host) {
  let n = 0; try { n = host.builders ? (host.builders() | 0) : 0; } catch (e) {}
  return Math.min(FARM_ECON.construction.builderCap, n * FARM_ECON.construction.perBuilder);
}
function buildTimeMs(host, def, level) {
  const hs = Array.isArray(def.buildH) ? def.buildH : [1];
  const h = hs[Math.max(0, Math.min(hs.length - 1, (level | 0) - 1))];
  return Math.round(h * (1 - buildersBonus(host)) * H);
}
function rushCost(s, id, now) {
  const p = buildProgress(s, id, now); if (!p) return 0;
  return Math.max(FARM_ECON.construction.rushMin, Math.ceil(p.left / 60000) * FARM_ECON.construction.rushCinderPerMin);
}
/* 🚚 Transport. */
function inTransit(s, penId) {
  const def = buildingDef(penId); if (!def || !def.houses) return 0;
  return s.shipments.filter(x => def.houses.indexOf(x.sp) >= 0).reduce((a, x) => a + x.n, 0);
}
function carriersFor(host) {
  const T = FARM_ECON.transport;
  const list = Object.keys(T.carriers).map(k => Object.assign({ id: k, own: false }, T.carriers[k]));
  try {
    const rig = host.bestRig && host.bestRig();
    if (rig && rig.id && T.ownRig[rig.id]) list.unshift(Object.assign({ id: 'own:' + rig.id, own: true, name: rig.name + ' (your rig)', emoji: rig.emoji || '🚚', feeBase: 0, feePerKg: 0, insured: 0, blurb: 'Your own truck. No fee; the trip depends on the rig.' }, T.ownRig[rig.id]));
  } catch (e) {}
  return list;
}
function carrierById(host, id) { const L = carriersFor(host); return L.find(c => c.id === id) || L.find(c => c.id === FARM_ECON.transport.defaultCarrier) || L[0]; }
function shipFee(carrier, sp, n) {
  const e = FARM_ECON.animals[sp]; if (!e || !carrier) return 0;
  const kg = e.adultWeight * FARM_ECON.transport.shipKgShare * Math.max(1, n | 0);
  return Math.round(carrier.feeBase + carrier.feePerKg * kg);
}
function troughCap(s, penId) {
  const b = building(s, penId);
  return b ? FARM_ECON.troughCap + FARM_ECON.troughCapPerLevel * (b.level - 1) : 0;
}
function terroirTier(host) { try { return (host.terroirTier && host.terroirTier('animalFeed')) || 'COMMON'; } catch (e) { return 'COMMON'; } }
function grazeFactor(host, now) {
  const t = FARM_ECON.terroirGraze[terroirTier(host)] || FARM_ECON.grazeDiscount;
  const wx = weatherAt(seedOf(host), now); const se = seasonFor(now);
  return Math.min(1, t * (wx.grazeMul || 1) * (se.grazeMul || 1));
}
function seedOf(host) { try { const s = host.state(); return (s && s.seed) || 'farm'; } catch (e) { return 'farm'; } }
function farmersBonus(host) {
  let n = 0; try { n = host.farmers() | 0; } catch (e) {}
  return Math.min(FARM_ECON.farmers.yieldCap, n * FARM_ECON.farmers.yieldPerFarmer);
}
/* 🛒 Shop boosts. A timed item covers [purchase, expiry); an interval that
   straddles the expiry gets the effect for the covered share only — so a
   player who slept through the last hour of Kelp Meal is paid for the hours
   it was live and nothing after. `boostMul` folds every active item with a
   multiplicative effect (product); `boostAdd` sums additive ones. Permanent
   unlocks cover everything. */
function boostCover(s, itemId, from, to) {
  const it = FARM_ECON.shop.items[itemId]; if (!it) return 0;
  if (it.permanent) return s.unlocks && s.unlocks[itemId] ? 1 : 0;
  const exp = s.boosts ? (Number(s.boosts[itemId]) || 0) : 0; if (!exp) return 0;
  if (to == null) to = from;
  if (to <= from) return exp > from ? 1 : 0;
  return Math.max(0, Math.min(1, (exp - from) / (to - from)));
}
function boostMul(s, key, from, to) {
  let m = 1; const items = FARM_ECON.shop.items;
  Object.keys(items).forEach(id => {
    const v = items[id].effect && items[id].effect[key]; if (typeof v !== 'number') return;
    const c = boostCover(s, id, from, to); if (c > 0) m *= 1 + (v - 1) * c;
  });
  return m;
}
function boostAdd(s, key, from, to) {
  let m = 0; const items = FARM_ECON.shop.items;
  Object.keys(items).forEach(id => {
    const v = items[id].effect && items[id].effect[key]; if (typeof v !== 'number') return;
    const c = boostCover(s, id, from, to); if (c > 0) m += v * c;
  });
  return m;
}
function activeBoosts(s, now) {
  now = now || Date.now(); const out = [];
  Object.keys(FARM_ECON.shop.items).forEach(id => {
    const it = FARM_ECON.shop.items[id];
    if (it.permanent) { if (s.unlocks && s.unlocks[id]) out.push({ id, permanent: true }); return; }
    const exp = s.boosts ? (Number(s.boosts[id]) || 0) : 0;
    if (exp > now) out.push({ id, expiresAt: exp, hoursLeft: (exp - now) / H });
  });
  return out;
}
/* ⭐ Grade-2 share of a beast's yield: its tier's share + shop grading, ≤ 1. */
function premiumShare(s, a, from, to) {
  const tier = tierOf(a); if (!tier) return 0;
  const base = FARM_ECON.premium.shareByTier[tier] || 0; if (!base) return 0;
  return Math.min(1, base + boostAdd(s, 'premiumShareAdd', from, to));
}
/* Split `v` of good `r` between its premium id and itself by `share`. */
function addYield(map, r, v, share) {
  const pid = FARM_ECON.premium.goods[r];
  if (pid && share > 0) { map[pid] = (map[pid] || 0) + v * share; v *= 1 - share; }
  if (v > 0) map[r] = (map[r] || 0) + v;
}
/* Feed units this pen burns per hour with its current herd, now. */
function feedDrawPerH(s, penId, host, now) {
  now = now || Date.now();
  const se = seasonFor(now), gf = host ? grazeFactor(host, now) : FARM_ECON.grazeDiscount;
  let d = 0;
  animalsInPen(s, penId).forEach(a => {
    const ad = animalDef(a.sp), e = econOf(a);
    if (!ad || !e) return;
    d += e.feedPerH * se.feedMul * (ad.ground ? gf : 1);
  });
  return d * boostMul(s, 'feedMul', now);
}
function feedHoursLeft(s, penId, host) {
  const b = building(s, penId); if (!b) return 0;
  const d = feedDrawPerH(s, penId, host);
  return d > 0 ? b.feed / d : Infinity;
}
/* Full-pen hourly yield (healthy adults) — the accrual ceiling's basis. */
function penRatePerH(s, penId, host, now) {
  const rate = {}; now = now || Date.now();
  const wx = weatherAt(seedOf(host || { state: () => s }), now);
  const fb = host ? farmersBonus(host) : 0;
  const bm = boostMul(s, 'yieldMul', now);
  animalsInPen(s, penId).forEach(a => {
    if (!isAdult(a)) return;
    const hf = healthFactor(a); if (hf <= 0) return;
    const y = FARM_ECON.yieldsPerH[a.sp] || {};
    const share = premiumShare(s, a, now);
    Object.keys(y).forEach(r => {
      let v = y[r] * hf * yieldMul(a) * (1 + fb) * bm;
      if (r === 'eggs' && typeof wx.eggMul === 'number') v *= wx.eggMul;
      addYield(rate, r, v, share);
    });
  });
  return rate;
}
function guardDefense(s) {
  let d = 0;
  s.animals.forEach(a => {
    const e = econOf(a); if (!e || !e.defense || !isAdult(a) || a.away) return;
    d += e.defense * (a.health < FARM_ECON.health.guardHalfBelow ? 0.5 : 1);
  });
  return d;
}
function penDefense(s, penId) {
  const b = building(s, penId);
  return guardDefense(s) + (b ? (b.level - 1) * FARM_ECON.fenceDefensePerLevel : 0);
}
function collectReadyAt(host, s, penId) {
  const b = building(s, penId);
  return b ? (b.lastCollect || 0) + host.collectCdMs : 0;
}
function pendingCollect(s, penId) {
  const b = building(s, penId); if (!b) return {};
  const out = {};
  Object.keys(b.accrual).forEach(r => { const n = Math.floor(b.accrual[r]); if (n > 0) out[r] = n; });
  return out;
}
/* The prize beast: per species, the oldest adult past prizeAgeMul × growH. */
function prizeIds(s) {
  const out = new Set();
  FARM_ANIMALS.forEach(d => {
    if (d.guard) return;
    const e = FARM_ECON.animals[d.id];
    const list = animalsOf(s, d.id).filter(a => isAdult(a) && a.ageH >= e.growH * FARM_ECON.prizeAgeMul).sort((a, b) => b.ageH - a.ageH);
    if (list.length) out.add(list[0].id);
  });
  return out;
}
function townOffer(s, now) {
  now = now || Date.now();
  const day = Math.floor(now / DAY);
  const offers = FARM_ECON.townDemand.offers;
  const i = hash32('town:' + s.seed + ':' + day) % offers.length;
  const used = (s.demand.day === day) ? (s.demand.used | 0) : 0;
  const perDay = demandPerDay(s);
  return Object.assign({ day, used, left: Math.max(0, perDay - used), perDay, rep: s.contracts ? s.contracts.rep | 0 : 0 }, offers[i]);
}
function demandPerDay(s) {
  const rep = s.contracts ? (s.contracts.rep | 0) : 0;
  const table = FARM_ECON.contracts.demandPerDayAtRep;
  let best = FARM_ECON.townDemand.perDay;
  Object.keys(table).map(Number).sort((a, b) => a - b).forEach(k => { if (rep >= k) best = table[String(k)]; });
  return best;
}
/* 📜 Contracts: two seeded offers per week, accept up to maxActive. */
function weekKey(now) { return Math.floor((now || Date.now()) / (7 * DAY)); }
function contractOffers(s, now) {
  now = now || Date.now();
  const wk = weekKey(now);
  if (s.contracts.week !== wk) {
    s.contracts.week = wk; s.contracts.offers = [];
    const T = FARM_ECON.contracts, R = rngFor('contract:' + s.seed + ':' + wk);
    const used = new Set();
    for (let i = 0; i < T.offersPerWeek && used.size < T.templates.length; i++) {
      let idx = Math.floor(R() * T.templates.length); while (used.has(idx)) idx = (idx + 1) % T.templates.length; used.add(idx);
      const tpl = T.templates[idx]; const days = T.days[Math.floor(R() * T.days.length)];
      s.contracts.offers.push({ id: wk * 10 + i, give: Object.assign({}, tpl.give), get: Object.assign({}, tpl.get), days });
    }
  }
  return s.contracts.offers;
}
/* 🏛 Sale Ring. */
function auctionOpen(now) {
  const d = new Date(now || Date.now()); const A = FARM_ECON.auction;
  return d.getDay() === A.dayOfWeek && d.getHours() >= A.hoursOpen[0] && d.getHours() < A.hoursOpen[1];
}
function nextAuction(now) {
  const d = new Date(now || Date.now()); const A = FARM_ECON.auction;
  const x = new Date(d); x.setHours(A.hoursOpen[0], 0, 0, 0);
  let delta = (A.dayOfWeek - x.getDay() + 7) % 7; if (delta === 0 && x.getTime() + (A.hoursOpen[1] - A.hoursOpen[0]) * H <= d.getTime()) delta = 7;
  x.setDate(x.getDate() + delta); return x.getTime();
}
/* A beast's value in Cinder terms: price × weight share × line × prize. */
function animalValue(s, a) {
  const e = econOf(a); if (!e) return 0;
  let v = e.cinder * Math.max(0.5, weightOf(a) / e.adultWeight);
  const tier = tierOf(a); if (tier && FARM_ECON.auction.priceMul[tier]) v *= FARM_ECON.auction.priceMul[tier];
  if (prizeIds(s).has(a.id)) v *= FARM_ECON.auction.priceMul.prize;
  return Math.round(v);
}
/* The seeded bid timeline of an NPC lot: who bid what, when. Pure. */
function lotTimeline(lot) {
  const A = FARM_ECON.auction, R = rngFor('lot:' + lot.seed);
  const n = A.bidsMin + Math.floor(R() * (A.bidsMax - A.bidsMin + 1));
  const total = A.lotMinutes * 60000; const hammerMul = A.hammerRange[0] + R() * (A.hammerRange[1] - A.hammerRange[0]);
  const final = Math.round(lot.reserve * hammerMul);
  const bids = []; let cur = Math.round(lot.reserve * 0.7);
  for (let i = 0; i < n; i++) {
    const b = A.bidders[Math.floor(R() * A.bidders.length)];
    const at = lot.at + Math.round(total * (0.08 + 0.84 * (i + R() * 0.6) / n));
    cur = i === n - 1 ? final : Math.round(cur + (final - cur) * (0.3 + R() * 0.4));
    bids.push({ at, who: b.name, id: b.id, amount: cur });
  }
  const winner = bids[bids.length - 1];
  return { bids, hammerAt: lot.at + total, final, winner: winner.who, winnerId: winner.id, athena: A.athena[Math.floor(R() * A.athena.length)] };
}
function lotPayout(final) {
  const out = {}; const P = FARM_ECON.auction.payoutPer1000;
  Object.keys(P).forEach(r => { out[r] = Math.max(1, Math.round(P[r] * final / 1000)); });
  return out;
}

/* ── Simulation ────────────────────────────────────────────────────────────── */
function simulate(host, s, now, rnd) {
  now = now || Date.now();
  let changed = false;
  const se = seasonFor(now);
  const gf = grazeFactor(host, now);
  const wx = weatherAt(s.seed, now);
  const fb = farmersBonus(host);
  const capH = host.accrualCapH;
  const HL = FARM_ECON.health;

  // 🏗 Finish any construction / upgrade whose clock has run out.
  Object.keys(s.buildings).forEach(id => {
    const b = s.buildings[id];
    if (b.readyAt && b.readyAt <= now) {
      const def = buildingDef(id);
      if (b.constructing) { b.constructing = false; journal(s, 'build', '🏠', `The ${def.name} is finished.`, b.readyAt); s.stats.built++; changed = true; }
      if (b.pendingLevel > b.level) { b.level = b.pendingLevel; journal(s, 'build', '⬆', `The ${def.name} is now level ${b.level}.`, b.readyAt); changed = true; }
      b.pendingLevel = 0; b.readyAt = 0;
    }
  });
  // 🚚 Arrivals. Rolled with the shipment's own seed so two devices agree.
  const arrived = s.shipments.filter(x => x.arriveAt <= now);
  if (arrived.length) {
    s.shipments = s.shipments.filter(x => x.arriveAt > now);
    arrived.forEach(x => {
      const ad = animalDef(x.sp); const R = rngFor('ship:' + s.seed + ':' + x.id);
      let n = x.n, lostN = 0;
      const esc = x.escort ? animalById(s, x.escort) : null;
      let risk = x.risk;
      if (esc) { const e = econOf(esc); risk *= Math.max(FARM_ECON.escort.minRiskMul, 1 - (e && e.defense ? e.defense : 0) / FARM_ECON.escort.div); }
      if (risk > 0 && R() < risk) { lostN = Math.max(1, Math.round(n * 0.34)); n -= lostN; if (esc) esc.health = Math.max(1, esc.health - FARM_ECON.escort.woundOnHit); }
      if (esc) { esc.away = 0; journal(s, 'ship', '🐕', `${esc.name} rode back with the ${x.label} truck${lostN ? ', bloodied' : ''}.`, x.arriveAt); }
      const names = [];
      for (let i = 0; i < n; i++) { const a = newAnimal(s, x.sp, x.arriveAt); s.animals.push(a); names.push(a.name); }
      if (lostN) {
        s.stats.lostInTransit += lostN; s.stats.lost += lostN;
        const refund = Math.round((x.price / x.n) * lostN * (x.insured || 0));
        if (refund > 0) host.addGems(refund);
        journal(s, 'raid', '🛻', `${x.label} was hit on the road — ${lostN} ${lostN === 1 ? ad.name.toLowerCase() : ad.plural.toLowerCase()} lost.${refund ? ' Insurance paid back ' + refund.toLocaleString() + ' Cinder.' : ' No insurance.'}${n ? ' ' + n + ' arrived.' : ''}`, x.arriveAt);
      } else {
        journal(s, 'ship', '🚚', `${x.label} delivered ${n} ${n === 1 ? ad.name.toLowerCase() : ad.plural.toLowerCase()}${names.length ? ' — ' + names.slice(0, 3).join(', ') + (names.length > 3 ? '…' : '') : ''}.`, x.arriveAt);
      }
    });
    changed = true;
  }

  FARM_BUILDINGS.forEach(def => {
    if (!def.houses) return;
    const b = building(s, def.id); if (!b) return;
    if (b.constructing && b.readyAt > now) { b.simAt = now; return; }
    const hours = Math.max(0, (now - b.simAt) / H);
    /* ⏮ Never move the clock backwards. A device with a skewed clock (or a
       harness mixing fake time with Date.now()) must not rewind simAt and
       then re-live hours it already lived — that double-charged hunger. */
    if (hours <= 0) return;
    b.simAt = now;
    const herd = animalsInPen(s, def.id);
    if (!herd.length) return;

    // Rain fills the pasture trough a little (grass, really) per window it holds.
    if (def.id === 'pasture' && wx.troughWater && hours >= 1) b.feed = Math.min(troughCap(s, def.id), b.feed + wx.troughWater * Math.min(4, hours / FARM_ECON.weatherWindowH));

    const from = now - hours * H;                       // b.simAt before the write above
    let draw = 0;
    herd.forEach(a => { const ad = animalDef(a.sp), e = econOf(a); if (ad && e) draw += e.feedPerH * se.feedMul * (ad.ground ? gf : 1); });
    draw *= boostMul(s, 'feedMul', from, now);            // 🍯 Molasses Lick
    const growMul = boostMul(s, 'growMul', from, now);    // 🥣 Growth Mash
    const healMul = boostMul(s, 'healMul', from, now);    // 🧪 Vet Tonic
    const yieldBoost = boostMul(s, 'yieldMul', from, now); // 🌿 Kelp Meal
    const fedH = draw > 0 ? Math.min(hours, b.feed / draw) : hours;
    const unfedH = Math.max(0, hours - fedH);
    b.feed = Math.max(0, b.feed - fedH * draw);

    const gained = {};
    const dead = [];
    // 🦠 Spread, then the clinic. Spread is per pen-mate per hour; the clinic
    // cures the longest-ill first, one medicine each, `cured/h` by level.
    const DZ = FARM_ECON.disease;
    const illNow = herd.filter(a => a.ill);
    if (illNow.length) {
      const R = rnd || rngFor('spread:' + s.seed + ':' + def.id + ':' + Math.floor(now / H));
      herd.forEach(a => {
        if (a.ill) return;
        const src = illNow.find(x => FARM_ECON.disease.kinds[x.ill].species.indexOf(a.sp) >= 0);
        if (!src) return;
        const p = 1 - Math.pow(1 - DZ.spreadPerH, Math.min(hours, 72));
        if (R() < p) { a.ill = src.ill; a.illSince = now; changed = true; }
      });
      const vet = building(s, 'vet');
      if (vet && !vet.constructing) {
        const cures = Math.floor(hours * DZ.vetCureHPerLevel * vet.level / DZ.cureH * 2);
        const queue = herd.filter(a => a.ill).sort((x, y) => x.illSince - y.illSince);
        for (let i = 0; i < Math.min(cures, queue.length); i++) {
          if (host.getRes('medicine') < DZ.vetMedicinePerCure) break;
          if (!host.spendRes('medicine', DZ.vetMedicinePerCure)) break;
          const a = queue[i]; journal(s, 'vet', '🩺', `The clinic cured ${a.name} of ${DZ.kinds[a.ill].label.toLowerCase()}.`, now);
          a.ill = null; a.illSince = 0; s.stats.cured++; changed = true;
        }
      }
    }
    herd.forEach(a => {
      const e = econOf(a); if (!e) return;
      if (a.ill) a.health -= hours * DZ.healthLossPerH;
      // Age is real time; growth is fed time.
      a.ageH += hours;
      // Growth Mash: a fed hour counts for more; adulthood arrives sooner in
      // real hours, and the yield clock (adultH, real hours) starts then.
      const adultH = Math.max(0, fedH - Math.max(0, e.growH - a.grownH) / growMul);
      a.grownH += fedH * growMul;
      // Hunger and healing.
      // Feed heals — unless the animal is ill: a sick beast does not mend on
      // its own however full the trough, which is what makes the clinic matter.
      if (fedH > 0) { a.hungry = Math.max(0, a.hungry - fedH * 2); if (!a.ill) a.health = Math.min(100, a.health + fedH * HL.healPerFedH * healMul); }
      if (unfedH > 0) {
        const before = a.hungry; a.hungry += unfedH;
        const painful = Math.max(0, a.hungry - Math.max(before, HL.hungerGraceH));
        if (painful > 0) a.health -= painful * HL.hungerLossPerH;
      }
      if (a.ageH > e.lifeH) a.health -= hours * HL.oldAgeLossPerH;
      a.health = Math.max(0, Math.min(100, a.health));
      if (a.health <= 0) { dead.push(a); return; }
      if (b.damaged || adultH <= 0) return;
      const hf = healthFactor(a); if (hf <= 0) return;
      const y = FARM_ECON.yieldsPerH[a.sp] || {};
      const share = premiumShare(s, a, from, now);
      Object.keys(y).forEach(r => {
        let v = y[r] * adultH * hf * yieldMul(a) * (1 + fb) * yieldBoost;
        if (r === 'eggs' && typeof wx.eggMul === 'number') v *= wx.eggMul;
        addYield(gained, r, v, share);
      });
    });
    if (dead.length) {
      const ids = new Set(dead.map(a => a.id));
      s.animals = s.animals.filter(a => !ids.has(a.id));
      dead.forEach(a => { const d = animalDef(a.sp); journal(s, 'death', '🪦', `${a.name} the ${d.name.toLowerCase()} died${a.ageH > (econOf(a).lifeH) ? ' of old age' : ' of neglect'}.`, now); s.stats.died++; });
      changed = true;
    }
    const rate = penRatePerH(s, def.id, host, now);
    Object.keys(gained).forEach(r => {
      const ceiling = (rate[r] || 0) * capH;
      b.accrual[r] = Math.min(Math.max(ceiling, b.accrual[r] || 0), (b.accrual[r] || 0) + gained[r]);
    });

    // Breeding: two healthy adults of a species, a free stall, the season willing.
    if (!b.damaged && fedH > 0) {
      const cap = penCapacity(s, def.id, host);
      const R = rnd || rngFor('breed:' + s.seed + ':' + Math.floor(now / H));
      (def.houses || []).forEach(sp => {
        const ad = animalDef(sp); if (!ad || ad.guard) return;
        const adults = s.animals.filter(a => a.sp === sp && isAdult(a) && !isSick(a)).length;
        if (adults < 2) return;
        const p = Math.min(1, (FARM_ECON.breedChancePerH[sp] || 0) * se.breedMul * boostMul(s, 'breedMul', from, now));   // 💞 Fertility Mash
        let trials = Math.min(200, Math.floor(fedH)), frac = fedH - Math.floor(fedH), births = 0;
        for (let i = 0; i < trials; i++) if (R() < p) births++;
        if (R() < p * frac) births++;
        for (let i = 0; i < births; i++) {
          if (animalsInPen(s, def.id).length >= cap) break;
          // 🧬 Lines: pick two adult parents; their tiers decide the child's.
          const parents = s.animals.filter(a => a.sp === sp && isAdult(a) && !isSick(a));
          const p1 = parents[Math.floor(R() * parents.length)], p2 = parents[Math.floor(R() * parents.length)];
          const L = FARM_ECON.lines; const t1 = p1 ? tierOf(p1) : null, t2 = p2 ? tierOf(p2) : null;
          // 🧂 Bloodline Salts scale the rare roll, 👑 Royal Jelly the line rolls.
          const rareMul = boostMul(s, 'rareMul', from, now), lineMul = boostMul(s, 'lineMul', from, now);
          let breed = null;
          if (t1 === 'royal' && t2 === 'royal' && R() < Math.min(1, L.mythicChance * lineMul)) breed = sp + ':mythic';
          else if ((t1 === 'rare' || t1 === 'royal') && (t2 === 'rare' || t2 === 'royal') && R() < Math.min(1, L.royalChance * lineMul)) breed = sp + ':royal';
          else if ((t1 || t2) && R() < Math.min(1, L.inheritRare * rareMul)) breed = sp;
          else if (R() < Math.min(1, L.rareChance * rareMul)) breed = sp;
          const a = newAnimal(s, sp, now, breed);
          s.animals.push(a); s.stats.births++; changed = true;
          if (breed) noteCollection(host, s, breed, now);
          const B = breed ? FARM_ECON.breeds[breed] : null;
          journal(s, 'birth', breed ? (B.tier === 'mythic' ? '🌟' : B.tier === 'royal' ? '👑' : '✨') : '🐣', breed ? `A ${B.label} was born — ${a.name}! ${B.tier === 'mythic' ? 'The line is complete: ×5 yield.' : B.tier === 'royal' ? 'A royal line: ×3 yield.' : 'Double yield for life.'}` : `${a.name} the ${ad.name.toLowerCase()} was born.`, now);
        }
      });
    }
  });

  // ⚔ Replay every event window the farm slept through.
  const windows = eventWindowsBetween(s.eventAt, now);
  if (windows.length) {
    windows.forEach(w => { if (resolveWindow(host, s, w)) changed = true; if (rollOutbreaks(host, s, w)) changed = true; });
    s.eventAt = Math.max(s.eventAt, now);
  }
  // 🚧 Beasts waiting at the gate walk in when a stall opens.
  if (s.holding.length) {
    const keep = [];
    s.holding.forEach(a => {
      const pen = penFor(a.sp);
      if (pen && has(s, pen.id) && isReady(s, pen.id, now) && penCapacity(s, pen.id, host) - animalsInPen(s, pen.id).length - inTransit(s, pen.id) >= 1) { s.animals.push(a); journal(s, 'ship', '🚪', `${a.name} walked in from the gate.`, now); changed = true; }
      else keep.push(a);
    });
    s.holding = keep;
  }
  // 🧬 Any breed on the farm counts for the collection (covers migrated saves).
  s.animals.forEach(a => { if (a.breed && !s.collection[a.breed]) { noteCollection(host, s, a.breed, now); changed = true; } });
  // 📜 Contracts past their deadline fail: reputation drops, the town demands less.
  const failed = s.contracts.active.filter(c => c.deadline <= now);
  if (failed.length) {
    s.contracts.active = s.contracts.active.filter(c => c.deadline > now);
    failed.forEach(c => {
      s.contracts.rep = Math.max(FARM_ECON.contracts.repMin, s.contracts.rep - FARM_ECON.contracts.repHit); s.stats.contractsFailed++;
      journal(s, 'contract', '📜', `Missed the town's contract (${Object.keys(c.give).map(k => c.give[k] + ' ' + k).join(', ')}). Reputation ${s.contracts.rep}: the town now takes ${demandPerDay(s)} deliveries a day.`, c.deadline);
    });
    changed = true;
  }
  contractOffers(s, now);
  // 🏛 Lots whose hammer has fallen pay out in goods.
  const done = s.lots.filter(l => !l.p2p && lotTimeline(l).hammerAt <= now);
  if (done.length) {
    s.lots = s.lots.filter(l => done.indexOf(l) < 0);
    done.forEach(l => {
      const tl = lotTimeline(l); const pay = lotPayout(tl.final);
      const { got } = deliver(host, pay);
      s.stats.auctions++; s.stats.auctionValue += tl.final;
      journal(s, 'auction', '🔨', `SOLD — ${l.animal.name} the ${animalDef(l.animal.sp).name.toLowerCase()} to ${tl.winner} for ${tl.final.toLocaleString()}: ${Object.keys(got).map(k => got[k] + ' ' + k).join(', ')}.`, tl.hammerAt);
    });
    changed = true;
  }
  return { changed };
}
/* 🦠 One outbreak roll per pen per window. Crowding and a thin fence raise it; the clinic halves it. */
function rollOutbreaks(host, s, w) {
  const DZ = FARM_ECON.disease; let changed = false;
  const vet = building(s, 'vet'); const vetCut = (vet && !vet.constructing) ? DZ.vetOutbreakCut : 1;
  FARM_BUILDINGS.forEach(def => {
    if (!def.houses) return; const b = building(s, def.id); if (!b) return;
    const herd = animalsInPen(s, def.id).filter(a => !a.ill); if (!herd.length) return;
    const R = rngFor('dz:' + s.seed + ':' + def.id + ':' + w.idx);
    const cap = penCapacity(s, def.id, host) || 1;
    let p = DZ.outbreakBase * vetCut * boostMul(s, 'outbreakMul', w.at);   // 🧪 Vet Tonic
    if (herd.length / cap >= DZ.crowdAbove) p *= DZ.crowdMul;
    p *= Math.max(0.3, 1 - DZ.penLevelCut * (b.level - 1));
    if (R() >= p) return;
    const a = herd[Math.floor(R() * herd.length)]; const k = diseaseFor(a.sp, R); if (!k) return;
    a.ill = k; a.illSince = w.at; s.stats.outbreaks++; changed = true;
    journal(s, 'disease', DZ.kinds[k].icon, `${DZ.kinds[k].label} in the ${def.name}: ${a.name} is sick${herd.length / cap >= DZ.crowdAbove ? ' — the pen is crowded' : ''}. It spreads by the hour; ${vet ? 'the clinic is on it' : 'treat it, or build a Vet Clinic'}.`, w.at);
  });
  return changed;
}
/* 🧬 The collection: every breed ever owned. A full tier pays once. */
function noteCollection(host, s, breed, now) {
  if (!breed || s.collection[breed]) return;
  s.collection[breed] = true;
  const B = FARM_ECON.breeds[breed]; if (!B || !B.tier || B.tier === 'glow') return;
  const tier = B.tier;
  const all = Object.keys(FARM_ECON.breeds).filter(k => FARM_ECON.breeds[k].tier === tier);
  if (all.every(k => s.collection[k]) && !s.collectionRewarded[tier]) {
    s.collectionRewarded[tier] = true;
    const { got } = deliver(host, FARM_ECON.lines.collectionReward[tier] || {});
    journal(s, 'collection', '🏆', `Collection complete — every ${tier} breed has lived on this farm. Reward: ${Object.keys(got).map(k => got[k] + ' ' + k).join(', ') || 'nothing fit in the stash'}.`, now);
  }
}

function newAnimal(s, sp, now, breed) {
  const id = s.seq++;
  return { id, sp, name: defaultName(sp, id), ageH: 0, grownH: 0, hungry: 0, health: 100, breed: breed || null, born: now, ill: null, illSince: 0, away: 0 };
}

/* One event window. Returns true when anything changed. */
function resolveWindow(host, s, w) {
  if (!s.animals.length) return false;
  const R = rngFor('ev:' + s.seed + ':' + w.idx);
  const wx = weatherAt(s.seed, w.at - 1);
  if (R() >= FARM_ECON.eventChance) return false;
  const kind = pickWeighted(R, FARM_ECON.events);
  const E = FARM_ECON.events[kind];
  const at = w.at;
  const stock = s.animals.filter(a => !isGuard(a));
  const penOf = (a) => animalDef(a.sp).pen;
  const wound = (a, n) => { a.health = Math.max(0, a.health - n); if (a.health <= 0) { s.animals = s.animals.filter(x => x.id !== a.id); return true; } return false; };
  const guards = s.animals.filter(isGuard);
  const hurtGuard = () => { if (!guards.length) return ''; const g = guards[Math.floor(R() * guards.length)]; wound(g, FARM_ECON.guardWound); return ` ${g.name} the ${animalDef(g.sp).name.toLowerCase()} took a bite.`; };
  const label = (a) => `${a.name} the ${animalDef(a.sp).name.toLowerCase()}`;

  if (kind === 'star') {
    Object.keys(E.gift).forEach(r => host.addRes(r, E.gift[r]));
    journal(s, 'gift', E.icon, `A shooting star came down in the field. The crater was full of rich soil: +${Object.values(E.gift)[0]} fertilizer.`, at);
    return true;
  }
  if (kind === 'storm') {
    const pens = FARM_BUILDINGS.filter(d => d.houses && s.buildings[d.id] && !s.buildings[d.id].damaged);
    if (!pens.length) return false;
    const p = pens[Math.floor(R() * pens.length)];
    s.buildings[p.id].damaged = true;
    journal(s, 'storm', E.icon, `A storm tore the roof off the ${p.name}. Nothing there produces until it is repaired.`, at);
    return true;
  }
  if (kind === 'ufo') {
    if (!stock.length) return false;
    const a = stock[Math.floor(R() * stock.length)];
    s.animals = s.animals.filter(x => x.id !== a.id);
    s.stats.abducted++;
    if (R() < E.returnChance) {
      a.breed = 'glow'; a.health = 100; a.hungry = 0; s.animals.push(a); s.stats.returned++;
      journal(s, 'ufo', E.icon, `Lights over the pasture. ${label(a)} vanished, then walked back out of the fog an hour later — glowing faintly. Yields have doubled and nobody wants to talk about it.`, at);
    } else {
      journal(s, 'ufo', E.icon, `Lights over the pasture. ${label(a)} rose into the sky and did not come back.`, at);
      s.stats.lost++;
    }
    return true;
  }
  // Predators and raids — something has to be beaten.
  let strength = E.strength[0] + R() * (E.strength[1] - E.strength[0]);
  let targets = stock;
  if (E.prey) targets = stock.filter(a => E.prey.indexOf(a.sp) >= 0);
  if (!targets.length) return false;
  const victim = targets[Math.floor(R() * targets.length)];
  const pen = penOf(victim);
  if (kind === 'raid' && wx.raidMul) strength *= wx.raidMul;
  const defense = penDefense(s, pen);
  if (kind === 'raid') {
    const who = rivalName(R, host.rivals ? host.rivals() : []);
    if (defense >= strength) {
      Object.keys(E.loot).forEach(r => host.addRes(r, E.loot[r]));
      s.stats.raidsRepelled++;
      journal(s, 'raid', '🛡', `${who} came for the ${buildingDef(pen).name} under ${wx.label.toLowerCase()} skies and met the guards. They ran, and dropped ${E.loot.supplies} supplies and ${E.loot.metal} metal on the way out.${hurtGuard()}`, at);
    } else {
      s.animals = s.animals.filter(x => x.id !== victim.id);
      s.stats.raidsLost++; s.stats.lost++;
      journal(s, 'raid', E.icon, `${who} raided the ${buildingDef(pen).name} in the ${wx.label.toLowerCase()} and took ${label(victim)}.${guards.length ? ' The guards were not enough.' : ' There was nobody to stop them.'}`, at);
    }
    return true;
  }
  // fox / hawk / wolves
  if (defense >= strength) {
    s.stats.predatorsRepelled++;
    journal(s, kind, '🛡', `${E.label === 'Wolves' ? 'Wolves' : 'A ' + E.label.toLowerCase()} tried the ${buildingDef(pen).name}. ${guards.length ? 'The guards drove ' + (E.label === 'Wolves' ? 'them' : 'it') + ' off.' : 'The fence held.'}${hurtGuard()}`, at);
  } else {
    const died = !isAdult(victim) || wound(victim, FARM_ECON.predatorWound);
    if (died) { s.animals = s.animals.filter(x => x.id !== victim.id); s.stats.lost++; }
    journal(s, kind, E.icon, `${E.label === 'Wolves' ? 'Wolves got' : 'A ' + E.label.toLowerCase() + ' got'} into the ${buildingDef(pen).name}. ${died ? label(victim) + ' was killed.' : label(victim) + ' was mauled and needs treatment.'}${guards.length ? '' : ' A guard dog would have changed that.'}`, at);
  }
  return true;
}

/* ── Cost handling ─────────────────────────────────────────────────────────── */
function canAfford(host, cost) {
  if (!cost) return true;
  return Object.keys(cost).every(k => k === 'cinder' ? host.gems() >= (cost[k] | 0) : host.getRes(k) >= (cost[k] | 0));
}
function shortfall(host, cost) {
  const out = {};
  if (!cost) return out;
  Object.keys(cost).forEach(k => {
    const have = k === 'cinder' ? host.gems() : host.getRes(k);
    if (have < (cost[k] | 0)) out[k] = (cost[k] | 0) - have;
  });
  return out;
}
function spendCost(host, cost) {
  if (!cost) return { ok: true };
  if (!canAfford(host, cost)) return { ok: false, why: 'short', shortfall: shortfall(host, cost) };
  const taken = [];
  const unwind = () => { taken.forEach(([id, n]) => host.refundRes(id, n)); };
  const ids = Object.keys(cost).filter(k => k !== 'cinder' && (cost[k] | 0) > 0);
  for (const id of ids) {
    if (!host.spendRes(id, cost[id] | 0)) { unwind(); return { ok: false, why: 'spendRes failed: ' + id }; }
    taken.push([id, cost[id] | 0]);
  }
  const c = cost.cinder | 0;
  if (c > 0 && !host.spendGems(c)) { unwind(); return { ok: false, why: 'spendGems failed' }; }
  return { ok: true, undo: () => { unwind(); if (c > 0) host.addGems(c); } };
}
/* Run `mutate` then persist; on a persist failure undo the spend AND the
   in-memory state (snapshot). The harness caught the first cut leaving a
   refunded building in memory. */
function paid(host, s, cost, mutate) {
  const sp = spendCost(host, cost);
  if (!sp.ok) return sp;
  const snap = JSON.stringify(s);
  try {
    const r = mutate() || {};
    record(host, s);
    return Object.assign({ ok: true }, r);
  } catch (e) {
    try { if (sp.undo) sp.undo(); } catch (e2) {}
    try { const back = JSON.parse(snap); Object.keys(s).forEach(k => { delete s[k]; }); Object.assign(s, back); } catch (e3) {}
    return { ok: false, why: 'save failed — refunded' };
  }
}
/* Deliver a yield map into the ledger, reporting what actually landed. */
function deliver(host, want) {
  const got = {}; let clipped = false;
  Object.keys(want).forEach(r => {
    const n = Math.floor(want[r]); if (n <= 0) return;
    const before = host.getRes(r);
    host.addRes(r, n);
    const landed = Math.max(0, host.getRes(r) - before);
    if (landed < n) clipped = true;
    if (landed > 0) got[r] = landed;
  });
  return { got, clipped };
}

/* ── Mutators ──────────────────────────────────────────────────────────────── */
function build(host, s, id) {
  const def = buildingDef(id);
  if (!def) return { ok: false, why: 'unknown building' };
  if (has(s, id)) return { ok: false, why: 'already built' };
  return paid(host, s, buildingCostAt(def, 1), () => {
    const now = Date.now(), ms = buildTimeMs(host, def, 1);
    s.buildings[id] = { level: 1, builtAt: now, startedAt: now, readyAt: now + ms, constructing: ms > 0, pendingLevel: 0, feed: 0, simAt: now, lastCollect: 0, accrual: {}, damaged: false };
    journal(s, 'build', '🏗', `Broke ground on the ${def.name} — ready in ${Math.round(ms / 60000)} min.`, now);
    return { built: id, readyAt: now + ms };
  });
}
function upgrade(host, s, id) {
  const def = buildingDef(id), b = building(s, id);
  if (!def || !b) return { ok: false, why: 'not built' };
  if (b.level >= def.maxLevel) return { ok: false, why: 'max level' };
  if (b.readyAt > Date.now()) return { ok: false, why: 'crews are already working on it' };
  return paid(host, s, buildingCostAt(def, b.level + 1), () => {
    simulate(host, s);
    const now = Date.now(), ms = buildTimeMs(host, def, b.level + 1);
    if (ms <= 0) { b.level += 1; return { level: b.level, pendingLevel: 0, readyAt: now }; }
    b.pendingLevel = b.level + 1; b.startedAt = now; b.readyAt = now + ms;
    journal(s, 'build', '🏗', `Upgrading the ${def.name} to level ${b.pendingLevel} — ${Math.round(ms / 60000)} min. It keeps working meanwhile.`, now);
    return { level: b.level, pendingLevel: b.pendingLevel, readyAt: b.readyAt };
  });
}
function repair(host, s, id) {
  const def = buildingDef(id), b = building(s, id);
  if (!def || !b) return { ok: false, why: 'not built' };
  if (!b.damaged) return { ok: false, why: 'nothing to repair' };
  return paid(host, s, FARM_ECON.events.storm.repair, () => { simulate(host, s); b.damaged = false; journal(s, 'repair', '🔨', `The ${def.name} roof is back on.`); return { repaired: id }; });
}
function buyAnimal(host, s, sp, n, carrier, escortId) {
  n = Math.max(1, n | 0);
  const ad = animalDef(sp), e = FARM_ECON.animals[sp];
  if (!ad || !e) return { ok: false, why: 'unknown animal' };
  const pen = penFor(sp);
  if (!pen || !has(s, pen.id)) return { ok: false, why: 'needs ' + (pen ? pen.name : 'a pen') };
  if (!isReady(s, pen.id)) return { ok: false, why: pen.name + ' is still under construction' };
  simulate(host, s);
  const room = penCapacity(s, pen.id, host) - animalsInPen(s, pen.id).length - inTransit(s, pen.id);
  if (room < n) return { ok: false, why: room <= 0 ? pen.name + ' is full (counting stock on the road)' : 'only room for ' + room };
  /* 🚚 Stock is bought at market and hauled in. It arrives — or not — when
     the carrier does; the pen slot is reserved from now. */
  const c = carrierById(host, carrier);
  const fee = shipFee(c, sp, n), price = e.cinder * n;
  const esc = escortId ? animalById(s, escortId) : null;
  if (escortId && (!esc || !isGuard(esc) || !isAdult(esc) || esc.away || isSick(esc))) return { ok: false, why: 'that guard cannot ride along' };
  return paid(host, s, { cinder: price + fee }, () => {
    const now = Date.now();
    if (!(c.hours > 0)) {
      // A zero-hour carrier (a harness, or a future "at the gate" purchase) hands the stock over now.
      const names = [];
      for (let i = 0; i < n; i++) { const a = newAnimal(s, sp, now); s.animals.push(a); names.push(a.name); }
      s.stats.shipped += n;
      return { shipped: n, arriveAt: now, carrier: c.name, fee, names };
    }
    const sh = { id: s.seq++, sp, n, carrier: c.id, label: c.name, departAt: now, arriveAt: now + Math.round(c.hours * H), fee, price, risk: c.risk || 0, insured: c.insured || 0, escort: esc ? esc.id : 0 };
    if (esc) { esc.away = sh.id; journal(s, 'ship', '🐕', `${esc.name} rides with the truck — the pens are down a guard until it is back.`, now); }
    s.shipments.push(sh); s.stats.shipped += n;
    journal(s, 'ship', c.emoji || '🚚', `${n} ${n === 1 ? ad.name.toLowerCase() : ad.plural.toLowerCase()} ordered — ${c.name} is hauling ${n === 1 ? 'it' : 'them'} in, ETA ${Math.round(c.hours * 60)} min${fee ? ', fee ' + fee.toLocaleString() + ' Cinder' : ''}.`, now);
    return { shipped: n, arriveAt: sh.arriveAt, carrier: c.name, fee };
  });
}
function rush(host, s, id) {
  const def = buildingDef(id); if (!def || !building(s, id)) return { ok: false, why: 'not built' };
  const cost = rushCost(s, id);
  if (!cost) return { ok: false, why: 'nothing to rush' };
  return paid(host, s, { cinder: cost }, () => { const b = building(s, id); b.readyAt = Date.now() - 1; simulate(host, s); journal(s, 'build', '⚡', `Rushed the ${def.name} for ${cost.toLocaleString()} Cinder.`); return { rushed: id, cost }; });
}
/* 🧪 Shift every clock on the farm by `ms` into the past. Used by the
   sandbox's "skip 12 hours"; only reachable through the API. */
function debugShift(host, s, ms) {
  ms = ms | 0;
  Object.values(s.buildings).forEach(b => { b.simAt -= ms; if (b.readyAt) b.readyAt -= ms; if (b.startedAt) b.startedAt -= ms; b.lastCollect = Math.max(0, b.lastCollect - ms); });
  s.shipments.forEach(x => { x.departAt -= ms; x.arriveAt -= ms; });
  s.eventAt -= ms;
  try { record(host, s); } catch (e) {}
  return { ok: true };
}
function rename(host, s, animalId, name) {
  const a = animalById(s, animalId); if (!a) return { ok: false, why: 'no such animal' };
  const nm = String(name || '').replace(/[<>]/g, '').trim().slice(0, 24);
  if (!nm) return { ok: false, why: 'give it a name' };
  a.name = nm;
  try { record(host, s); } catch (e) { return { ok: false, why: 'save failed' }; }
  return { ok: true, name: nm };
}
function treat(host, s, animalId) {
  const a = animalById(s, animalId); if (!a) return { ok: false, why: 'no such animal' };
  simulate(host, s);
  if (a.ill) {
    const k = a.ill;
    return paid(host, s, FARM_ECON.disease.handCure, () => { a.ill = null; a.illSince = 0; a.health = Math.min(100, a.health + FARM_ECON.health.treatHeal); s.stats.cured++; journal(s, 'vet', '💊', `Treated ${a.name} for ${FARM_ECON.disease.kinds[k].label.toLowerCase()} by hand.`); return { health: a.health, cured: k }; });
  }
  if (a.health >= 100) return { ok: false, why: 'already in perfect health' };
  return paid(host, s, FARM_ECON.health.treatCost, () => { a.health = Math.min(100, a.health + FARM_ECON.health.treatHeal); a.hungry = 0; return { health: a.health }; });
}
function acceptContract(host, s, offerId) {
  simulate(host, s);
  const o = contractOffers(s).find(x => x.id === (offerId | 0)); if (!o) return { ok: false, why: 'that offer is gone' };
  if (s.contracts.active.length >= FARM_ECON.contracts.maxActive) return { ok: false, why: 'you already hold ' + FARM_ECON.contracts.maxActive + ' contracts' };
  const now = Date.now();
  s.contracts.active.push({ id: o.id, give: o.give, get: o.get, accepted: now, deadline: now + o.days * DAY });
  s.contracts.offers = s.contracts.offers.filter(x => x.id !== o.id);
  journal(s, 'contract', '📜', `Signed a town contract: ${Object.keys(o.give).map(k => o.give[k] + ' ' + k).join(', ')} within ${o.days} days.`, now);
  try { record(host, s); } catch (e) { return { ok: false, why: 'save failed' }; }
  return { ok: true };
}
function deliverContract(host, s, contractId) {
  simulate(host, s);
  const c = s.contracts.active.find(x => x.id === (contractId | 0)); if (!c) return { ok: false, why: 'no such contract' };
  return paid(host, s, c.give, () => {
    s.contracts.active = s.contracts.active.filter(x => x !== c);
    s.contracts.rep = Math.min(FARM_ECON.contracts.repMax, s.contracts.rep + FARM_ECON.contracts.repGainOnDeliver); s.stats.contractsDone++;
    const { got, clipped } = deliver(host, c.get);
    journal(s, 'contract', '📜', `Contract delivered. The town paid ${Object.keys(got).map(k => got[k] + ' ' + k).join(', ')}. Reputation ${s.contracts.rep}.`);
    return { got, clipped, rep: s.contracts.rep };
  });
}
/* 🏛 Consign a beast to the Sale Ring. NPC lot: hammer in lotMinutes, paid in goods. */
function consign(host, s, animalId) {
  const a = animalById(s, animalId); if (!a) return { ok: false, why: 'no such animal' };
  if (!has(s, 'salering')) return { ok: false, why: 'build the Sale Ring first' };
  if (!isReady(s, 'salering')) return { ok: false, why: 'the Sale Ring is still under construction' };
  simulate(host, s);
  const now = Date.now();
  if (!auctionOpen(now)) return { ok: false, why: 'the ring opens ' + new Date(nextAuction(now)).toLocaleString() };
  if (!isAdult(a)) return { ok: false, why: a.name + ' is not grown' };
  if (isGuard(a)) return { ok: false, why: 'guards are not sold at the ring' };
  if (a.ill || isSick(a)) return { ok: false, why: a.name + ' is not fit to show' };
  if (!tierOf(a) && !prizeIds(s).has(a.id)) return { ok: false, why: 'the ring only takes prize or bred stock' };
  const reserve = animalValue(s, a);
  const lot = { id: s.seq++, seed: s.seed + ':' + s.seq + ':' + now, at: now, reserve, animal: Object.assign({}, a, { prize: prizeIds(s).has(a.id) }), p2p: false };
  s.animals = s.animals.filter(x => x.id !== a.id);
  s.lots.push(lot);
  journal(s, 'auction', '🏛', `${a.name} the ${animalDef(a.sp).name.toLowerCase()} walks into the ring. Reserve ${reserve.toLocaleString()}. Athena: "${lotTimeline(lot).athena}"`, now);
  try { record(host, s); } catch (e) { s.animals.push(a); s.lots = s.lots.filter(l => l !== lot); return { ok: false, why: 'save failed' }; }
  return { ok: true, lot, timeline: lotTimeline(lot) };
}
/* 🌐 Player lots live on the server (sql/038). The farm only hands the beast
   over (and takes it back if the post fails) — see farm.cloud.js. */
function takeAnimalForLot(host, s, animalId) {
  const a = animalById(s, animalId); if (!a) return { ok: false, why: 'no such animal' };
  if (!has(s, 'salering') || !isReady(s, 'salering')) return { ok: false, why: 'the Sale Ring must be built and finished' };
  simulate(host, s);
  if (!isAdult(a) || isGuard(a) || a.ill || isSick(a)) return { ok: false, why: a.name + ' cannot be listed' };
  s.animals = s.animals.filter(x => x.id !== a.id);
  try { record(host, s); } catch (e) { s.animals.push(a); return { ok: false, why: 'save failed' }; }
  return { ok: true, animal: Object.assign({}, a, { prize: prizeIds(s).has(a.id), value: animalValue(s, a) }) };
}
/* A beast arriving from outside (a claimed lot). With no room it waits at
   the gate (`holding`) and walks in on the next simulate that finds a stall —
   the claim RPC is once-only, so the animal must never be dropped. */
function returnAnimal(host, s, animal) {
  if (!animal || !animalDef(animal.sp)) return { ok: false, why: 'bad animal' };
  simulate(host, s);
  const a = Object.assign(newAnimal(s, animal.sp, Date.now()), { name: String(animal.name || '').slice(0, 24) || defaultName(animal.sp, s.seq), ageH: Number(animal.ageH) || 0, grownH: Number(animal.grownH) || 0, health: Math.max(1, Math.min(100, Number(animal.health) || 100)), breed: (typeof animal.breed === 'string' && FARM_ECON.breeds[animal.breed]) ? animal.breed : null });
  const pen = penFor(animal.sp);
  const room = pen && has(s, pen.id) && isReady(s, pen.id) && (penCapacity(s, pen.id, host) - animalsInPen(s, pen.id).length - inTransit(s, pen.id) >= 1);
  if (room) { s.animals.push(a); if (a.breed) noteCollection(host, s, a.breed, Date.now()); }
  else { s.holding.push(a); journal(s, 'ship', '🚧', `${a.name} the ${animalDef(a.sp).name.toLowerCase()} is waiting at the gate — no room in the ${pen ? pen.name : 'pen'}.`); }
  try { record(host, s); } catch (e) { s.animals = s.animals.filter(x => x !== a); s.holding = s.holding.filter(x => x !== a); return { ok: false, why: 'save failed' }; }
  return { ok: true, animal: a, held: !room };
}
/* 🛒 Buy from the merchant's cart. Timed items EXTEND (never stack the
   effect); permanent items buy once. Paid in Cinder + goods via paid(), so a
   failed save refunds every leg. */
function buyShopItem(host, s, itemId) {
  const it = FARM_ECON.shop.items[itemId]; if (!it) return { ok: false, why: 'unknown item' };
  if (it.permanent && s.unlocks[itemId]) return { ok: false, why: 'already owned' };
  simulate(host, s);
  const now = Date.now();
  return paid(host, s, it.cost, () => {
    let expiresAt = 0;
    const had = it.permanent ? 0 : Math.max(0, (Number(s.boosts[itemId]) || 0) - now);
    if (it.permanent) s.unlocks[itemId] = true;
    else { expiresAt = now + had + it.hours * H; s.boosts[itemId] = expiresAt; }
    s.stats.shopBuys++;
    journal(s, 'shop', it.icon, `${it.label} bought from the merchant's cart${it.permanent ? '.' : ` — runs until ${new Date(expiresAt).toLocaleString()}.`}`, now);
    return { item: itemId, expiresAt, permanent: !!it.permanent, extended: had > 0 };
  });
}
function fillTrough(host, s, penId, units) {
  const def = buildingDef(penId), b = building(s, penId);
  if (!def || !def.houses || !b) return { ok: false, why: 'not a pen' };
  if (!isReady(s, penId)) return { ok: false, why: def.name + ' is still under construction' };
  if (!isReady(s, 'feedmill')) return { ok: false, why: has(s, 'feedmill') ? 'the Feed Mill is still under construction' : 'build the Feed Mill first' };
  simulate(host, s);
  const free = Math.floor(troughCap(s, penId) - b.feed);
  const have = host.getRes('animalFeed');
  const take = Math.min(free, have, Math.max(0, units | 0));
  if (take <= 0) return { ok: false, why: free <= 0 ? 'trough is full' : (have <= 0 ? 'no Animal Feed — grind some at the Feed Mill' : 'nothing to add') };
  return paid(host, s, { animalFeed: take }, () => { b.feed += take; return { added: take }; });
}
/* 👷 Hired Farmers top up any trough under the threshold from the stash.
   Called on mount; records only when feed actually moved. */
function tend(host, s) {
  let farmers = 0; try { farmers = host.farmers() | 0; } catch (e) {}
  if (farmers <= 0 || !has(s, 'feedmill')) return { ok: true, moved: 0 };
  simulate(host, s);
  // Plan first, pay once, apply inside paid() so a failed save unwinds it all.
  const plan = []; let budget = host.getRes('animalFeed'), moved = 0;
  FARM_BUILDINGS.forEach(def => {
    if (!def.houses) return;
    const b = building(s, def.id); if (!b || !animalsInPen(s, def.id).length) return;
    const cap = troughCap(s, def.id);
    if (b.feed >= cap * FARM_ECON.farmers.topUpBelow) return;
    const take = Math.min(Math.floor(cap - b.feed), Math.max(0, budget));
    if (take > 0) { plan.push([def.id, take]); budget -= take; moved += take; }
  });
  if (!moved) return { ok: true, moved: 0 };
  return paid(host, s, { animalFeed: moved }, () => {
    plan.forEach(([id, n]) => { s.buildings[id].feed += n; });
    journal(s, 'tend', '👷', `Your ${farmers} Farmer${farmers === 1 ? '' : 's'} topped up the troughs with ${moved} feed.`);
    return { moved };
  });
}
function collect(host, s, penId) {
  const b = building(s, penId);
  if (!b) return { ok: false, why: 'not built' };
  simulate(host, s);
  const readyAt = collectReadyAt(host, s, penId);
  if (Date.now() < readyAt) return { ok: false, why: 'cooldown', readyAt };
  const want = pendingCollect(s, penId);
  if (!Object.keys(want).length) return { ok: false, why: 'nothing to collect' };
  const { got, clipped } = deliver(host, want);
  Object.keys(got).forEach(r => { b.accrual[r] = Math.max(0, (b.accrual[r] || 0) - got[r]); });
  Object.values(FARM_ECON.premium.goods).forEach(pid => { s.stats.premium += got[pid] | 0; });
  if (Object.keys(got).length) b.lastCollect = Date.now();
  try { record(host, s); } catch (e) { return { ok: false, why: 'save failed', got, clipped }; }
  return { ok: true, got, clipped };
}
/* 🔪 Slaughter. `sel` = { sp, n } (oldest adults first) or { ids: [...] }.
   Yield = base × weight/adultWeight × butcher level × cut × season × breed. */
function slaughter(host, s, sel, cut) {
  const bb = building(s, 'butcher');
  if (!bb) return { ok: false, why: "build the Butcher's Block first" };
  if (!isReady(s, 'butcher')) return { ok: false, why: "the Butcher's Block is still under construction" };
  const C = FARM_ECON.cuts[cut || 'balanced'] || FARM_ECON.cuts.balanced;
  if (bb.level < C.minLevel) return { ok: false, why: `${C.label} needs Butcher's Block level ${C.minLevel}` };
  simulate(host, s);
  let list;
  if (sel && Array.isArray(sel.ids)) list = sel.ids.map(id => animalById(s, id)).filter(Boolean);
  else {
    const ad = animalDef(sel && sel.sp); if (!ad) return { ok: false, why: 'unknown animal' };
    list = animalsOf(s, ad.id).filter(isAdult).sort((a, b) => b.ageH - a.ageH).slice(0, Math.max(1, (sel.n | 0) || 1));
    if (!list.length) return { ok: false, why: 'no adult ' + ad.plural.toLowerCase() + ' to slaughter' };
  }
  list = list.filter(a => !isGuard(a));
  if (!list.length) return { ok: false, why: 'guards are not for the block' };
  const young = list.filter(a => !isAdult(a));
  if (young.length) return { ok: false, why: `${young[0].name} is not grown yet` };
  const se = seasonFor(Date.now());
  const mul = 1 + FARM_ECON.butcherBonusPerLevel * (bb.level - 1);
  const prizes = prizeIds(s);
  const want = {}; const stories = []; const R = rngFor('cut:' + s.seed + ':' + Date.now());
  list.forEach(a => {
    const table = FARM_ECON.slaughter[a.sp], e = econOf(a), br = breedOf(a);
    const wf = weightOf(a) / e.adultWeight;
    const share = premiumShare(s, a, Date.now());
    Object.keys(table).forEach(r => {
      let v = table[r] * wf * mul;
      if (r === 'meat') v *= C.meat * se.meatMul * ((br && br.meatMul) || 1);
      else if (r === 'hide') v *= C.hide;
      else v *= C.other;
      v = Math.max(1, Math.round(v));
      // ⭐ A good breed's meat and wool grade up by its premium share (whole units).
      const pid = FARM_ECON.premium.goods[r];
      if (pid && share > 0) { const p = Math.round(v * share); if (p > 0) { want[pid] = (want[pid] || 0) + p; v -= p; } }
      if (v > 0) want[r] = (want[r] || 0) + v;
    });
    if (C.rare && R() < C.rareChance) { Object.keys(C.rare).forEach(r => { want[r] = (want[r] || 0) + C.rare[r]; }); stories.push(`${a.name}'s trophy cut turned up a Memory Shard.`); }
    if (prizes.has(a.id) && R() < FARM_ECON.prizeRare.chance) { Object.keys(FARM_ECON.prizeRare.drop).forEach(r => { want[r] = (want[r] || 0) + FARM_ECON.prizeRare.drop[r]; }); stories.push(`Prize beast ${a.name} yielded a strand of DNA.`); }
  });
  const ids = new Set(list.map(a => a.id));
  s.animals = s.animals.filter(a => !ids.has(a.id));
  const { got, clipped } = deliver(host, want);
  s.stats.slaughtered += list.length; s.stats.meat += (got.meat | 0) + (got.primeMeat | 0); s.stats.premium += (got.primeMeat | 0) + (got.fineWool | 0);
  const nm = list.length === 1 ? `${list[0].name} the ${animalDef(list[0].sp).name.toLowerCase()}` : `${list.length} ${animalDef(list[0].sp).plural.toLowerCase()}`;
  journal(s, 'butcher', '🔪', `${nm} went to the block (${C.label.toLowerCase()}): ${Object.keys(got).map(k => got[k] + ' ' + k).join(', ')}.${stories.length ? ' ' + stories.join(' ') : ''}`);
  try { record(host, s); } catch (e) { return { ok: false, why: 'save failed', got, clipped, taken: list.length }; }
  return { ok: true, taken: list.length, got, clipped, stories };
}
function craft(host, s, stationId, recipeKey, batches) {
  const def = buildingDef(stationId), b = building(s, stationId);
  if (!def || !b) return { ok: false, why: 'not built' };
  if (!isReady(s, stationId)) return { ok: false, why: def.name + ' is still under construction' };
  let recipe;
  if (def.role === 'feed') recipe = FARM_ECON.feedMillRecipe;
  else if (Array.isArray(def.recipes) && def.recipes.indexOf(recipeKey) >= 0) recipe = FARM_ECON.recipes[recipeKey];
  if (!recipe) return { ok: false, why: 'unknown recipe' };
  batches = Math.max(1, batches | 0);
  const maxBy = Math.min(...Object.keys(recipe.inputs).map(k => Math.floor(host.getRes(k) / recipe.inputs[k])));
  if (!(maxBy >= 1)) return { ok: false, why: 'short', shortfall: shortfall(host, recipe.inputs) };
  batches = Math.min(batches, maxBy);
  const cost = {}; Object.keys(recipe.inputs).forEach(k => { cost[k] = recipe.inputs[k] * batches; });
  const mul = 1 + FARM_ECON.recipeBonusPerLevel * (b.level - 1);
  const sp = spendCost(host, cost);
  if (!sp.ok) return sp;
  const want = {}; Object.keys(recipe.output).forEach(r => { want[r] = Math.round(recipe.output[r] * batches * mul); });
  const { got, clipped } = deliver(host, want);
  try { record(host, s); } catch (e) {}
  return { ok: true, batches, got, clipped };
}
/* 🏘 Deliver today's town demand: resources for resources, capped per day. */
function deliverDemand(host, s) {
  simulate(host, s);
  const o = townOffer(s);
  if (o.left <= 0) return { ok: false, why: 'the town has taken all it needs today' };
  return paid(host, s, o.give, () => {
    if (s.demand.day !== o.day) { s.demand.day = o.day; s.demand.used = 0; }
    s.demand.used++; s.stats.delivered++;
    const { got, clipped } = deliver(host, o.get);
    journal(s, 'town', '🏘', `Delivered ${Object.keys(o.give).map(k => o.give[k] + ' ' + k).join(', ')} to town for ${Object.keys(got).map(k => got[k] + ' ' + k).join(', ')}.`);
    return { got, clipped, left: o.left - 1 };
  });
}
/* 📦 Crate a grown animal into one tradeable `livestock` unit. */
function crate(host, s, animalId) {
  const a = animalById(s, animalId); if (!a) return { ok: false, why: 'no such animal' };
  simulate(host, s);
  if (!isAdult(a)) return { ok: false, why: `${a.name} is not grown yet` };
  if (isSick(a)) return { ok: false, why: `${a.name} is too sick to travel` };
  const before = host.getRes('livestock');
  host.addRes('livestock', 1);
  if (host.getRes('livestock') <= before) return { ok: false, why: 'stash is full' };
  s.animals = s.animals.filter(x => x.id !== a.id);
  s.stats.crated++;
  journal(s, 'crate', '📦', `${a.name} the ${animalDef(a.sp).name.toLowerCase()} was crated for the Exchange.`);
  try { record(host, s); } catch (e) { host.spendRes('livestock', 1); return { ok: false, why: 'save failed' }; }
  return { ok: true };
}
function uncrate(host, s, sp) {
  const ad = animalDef(sp), e = FARM_ECON.animals[sp];
  if (!ad || !e) return { ok: false, why: 'unknown animal' };
  const pen = penFor(sp);
  if (!pen || !has(s, pen.id)) return { ok: false, why: 'needs ' + (pen ? pen.name : 'a pen') };
  if (!isReady(s, pen.id)) return { ok: false, why: pen.name + ' is still under construction' };
  simulate(host, s);
  if (penCapacity(s, pen.id, host) - animalsInPen(s, pen.id).length - inTransit(s, pen.id) < 1) return { ok: false, why: pen.name + ' is full' };
  const cost = { livestock: 1, cinder: Math.round(e.cinder * FARM_ECON.crate.uncrateDiscount) };
  return paid(host, s, cost, () => { const a = newAnimal(s, sp, Date.now()); a.grownH = e.growH * 0.5; s.animals.push(a); return { name: a.name }; });
}
function uncrateCost(sp) { const e = FARM_ECON.animals[sp]; return e ? { livestock: 1, cinder: Math.round(e.cinder * FARM_ECON.crate.uncrateDiscount) } : null; }
/* 🅰 Athena Editor. */
function setLook(host, s, patch) {
  const next = normalizeLook(Object.assign({}, s.look, patch || {}, {
    decor: Object.assign({}, s.look.decor, (patch && patch.decor) || {}),
    roofs: Object.assign({}, s.look.roofs, (patch && patch.roofs) || {}),
  }));
  if (patch && patch.roofs) Object.keys(patch.roofs).forEach(k => { if (patch.roofs[k] === null) delete next.roofs[k]; });
  s.look = next;
  try { record(host, s); } catch (e) { return { ok: false, why: 'save failed' }; }
  return { ok: true, look: next };
}

/* ── 🚪 THE KITCHEN DOOR — goods that leave the pens without a collect ─────
   An operation (or the node city) that wants eggs, meat or milk can take them
   straight out of a pen's accrual, skipping the 6h collect cooldown. That is
   the whole point of owning both: the restaurant's back door opens onto the
   coop. Nothing is created — it is the same accrual a Collect would bank. */
function available(host, s, id) {
  simulate(host, s);
  let n = 0;
  FARM_BUILDINGS.forEach(def => { const b = building(s, def.id); if (b && def.houses && !b.constructing) n += Math.floor(b.accrual[id] || 0); });
  return n;
}
function pendingAll(host, s) {
  simulate(host, s);
  const out = {};
  FARM_BUILDINGS.forEach(def => { const b = building(s, def.id); if (!b || !def.houses) return; Object.keys(b.accrual).forEach(r => { const n = Math.floor(b.accrual[r] || 0); if (n > 0) out[r] = (out[r] || 0) + n; }); });
  return out;
}
function drawAccrual(host, s, id, n, who) {
  n = Math.max(0, n | 0); if (!n) return { ok: true, taken: 0 };
  simulate(host, s);
  let left = n, taken = 0;
  FARM_BUILDINGS.forEach(def => {
    if (left <= 0) return; const b = building(s, def.id); if (!b || !def.houses) return;
    const have = Math.floor(b.accrual[id] || 0); if (have <= 0) return;
    const take = Math.min(have, left); b.accrual[id] = Math.max(0, (b.accrual[id] || 0) - take); left -= take; taken += take;
  });
  if (taken) {
    s.stats.kitchenDoor = (s.stats.kitchenDoor | 0) + taken;
    journal(s, 'door', '🚪', `${taken} ${id} went out the kitchen door to ${who || 'the business'}.`);
    try { record(host, s); } catch (e) { return { ok: false, why: 'save failed', taken }; }
  }
  return { ok: true, taken };
}

/* ── Snapshot for the UI + scene ───────────────────────────────────────────── */
function summary(host, s) {
  const now = Date.now();
  const sim = simulate(host, s, now);
  if (sim.changed) { try { record(host, s); } catch (e) {} }
  const prizes = prizeIds(s);
  const pens = FARM_BUILDINGS.filter(d => d.houses).map(d => {
    const b = building(s, d.id);
    const herd = animalsInPen(s, d.id);
    return {
      id: d.id, built: !!b, level: b ? b.level : 0, damaged: !!(b && b.damaged), ready: isReady(s, d.id, now), progress: buildProgress(s, d.id, now), inTransit: inTransit(s, d.id),
      herd: herd.length, adults: herd.filter(isAdult).length, capacity: penCapacity(s, d.id, host),
      feed: b ? Math.floor(b.feed) : 0, troughCap: troughCap(s, d.id), hoursLeft: b ? feedHoursLeft(s, d.id, host) : 0,
      pending: pendingCollect(s, d.id), readyAt: b ? collectReadyAt(host, s, d.id) : 0,
      ratePerH: penRatePerH(s, d.id, host, now), defense: b ? penDefense(s, d.id) : 0,
    };
  });
  const animals = s.animals.map(a => Object.assign({}, a, {
    adult: isAdult(a), guard: isGuard(a), sick: isSick(a), weight: weightOf(a), prize: prizes.has(a.id),
    breedLabel: breedOf(a) ? breedOf(a).label : null, tier: tierOf(a),
    illLabel: a.ill ? FARM_ECON.disease.kinds[a.ill].label : null, value: animalValue(s, a),
  }));
  const species = FARM_ANIMALS.map(a => {
    const list = animals.filter(x => x.sp === a.id);
    return { id: a.id, count: list.length, adults: list.filter(x => x.adult).length, young: list.filter(x => !x.adult).length };
  });
  const recent = s.journal.filter(j => now - j.t < 12 * H);
  return {
    pens, species, animals, buildings: Object.assign({}, s.buildings),
    look: s.look, journal: s.journal.slice(), stats: Object.assign({}, s.stats),
    season: seasonFor(now), weather: weatherAt(s.seed, now), hour: cityHourNow(), terroir: terroirTier(host),
    guardDefense: guardDefense(s), farmers: (() => { try { return host.farmers() | 0; } catch (e) { return 0; } })(), farmersBonus: farmersBonus(host),
    town: townOffer(s, now), recentEvents: recent,
    construction: FARM_BUILDINGS.map(d => ({ id: d.id, progress: buildProgress(s, d.id, now), rush: rushCost(s, d.id, now) })).filter(x => x.progress),
    builders: (() => { try { return host.builders ? (host.builders() | 0) : 0; } catch (e) { return 0; } })(), buildersBonus: buildersBonus(host),
    shipments: s.shipments.map(x => Object.assign({}, x, { progress: Math.max(0, Math.min(1, (now - x.departAt) / Math.max(1, x.arriveAt - x.departAt))), pen: animalDef(x.sp).pen })),
    carriers: carriersFor(host),
    contracts: { offers: contractOffers(s, now).slice(), active: s.contracts.active.slice(), rep: s.contracts.rep, demandPerDay: demandPerDay(s) },
    lots: s.lots.map(l => Object.assign({}, l, { timeline: lotTimeline(l) })),
    auction: { open: auctionOpen(now), next: nextAuction(now), ringReady: isReady(s, 'salering', now), ringBuilt: has(s, 'salering') },
    collection: Object.assign({}, s.collection), collectionRewarded: Object.assign({}, s.collectionRewarded),
    escorts: s.animals.filter(a => isGuard(a) && isAdult(a) && !a.away && !isSick(a)).map(a => ({ id: a.id, name: a.name, sp: a.sp, defense: econOf(a).defense })),
    ill: s.animals.filter(a => a.ill).length,
    holding: s.holding.slice(),
    shop: {
      active: activeBoosts(s, now),
      unlocks: Object.assign({}, s.unlocks),
      premiumShare: Object.keys(FARM_ECON.premium.shareByTier).reduce((o, t) => { o[t] = Math.min(1, FARM_ECON.premium.shareByTier[t] + boostAdd(s, 'premiumShareAdd', now)); return o; }, {}),
      graded: s.animals.filter(a => tierOf(a)).length,
    },
  };
}

/* ═══ farm.scene.js ═══ */
/* ════════════════════════════════════════════════════════════════════════════
   🐄 HOMESTEAD FARM — the 3D homestead (three.js) with a 2D canvas fallback.
   ----------------------------------------------------------------------------
   Low-poly, no assets: every building, animal, tree and raider is boxes, so
   the scene has nothing to download beyond three.js itself. three.js is
   fetched the same way the combat VFX rig fetches it (cdnjs r128 →
   window.THREE) so the two share one cached copy; if that fetch fails the
   farm still works on a top-down 2D canvas — the game must degrade, never
   break.

   What the scene shows, and where each comes from:
     • buildings + yards + fences        view.buildings (ghosts when unbuilt)
     • animals wandering their yard      view.animals (guards patrol the post)
     • prize rosette / rare-breed colour / sick marker   per animal flags
     • torn roof on a damaged pen        pen.damaged
     • live weather: rain, storm, fog    view.weather (the farm's own)
     • season tint on the grass          view.season
     • event actors for 12s after mount  view.recentEvents (UFO, raiders,
                                          wolves, fox, hawk) — the replay of
                                          what happened while you were away
     • decor + palette + roofs           view.look (the Athena Editor)

   ⚠ THE BROWSER PANE DOES NOT COMPOSITE (CLAUDE.md): requestAnimationFrame
     never fires there. The loop is RAF-driven; the interval only watches for
     a detached canvas so a dead pane still disposes the GL context.

   Contract: createScene(container, { onSelect(kind, id) })
             → { update(view), destroy(), select(pick), mode }
   ════════════════════════════════════════════════════════════════════════════ */


const THREE_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';

function ensureThree() {
  return new Promise((resolve) => {
    try {
      if (window.THREE) return resolve(window.THREE);
      if (window.__farmThreeLoading || window.__vfxThreeLoading) {
        const iv = setInterval(() => { if (window.THREE) { clearInterval(iv); resolve(window.THREE); } }, 120);
        setTimeout(() => { clearInterval(iv); resolve(window.THREE || null); }, 9000);
        return;
      }
      window.__farmThreeLoading = true;
      const s = document.createElement('script');
      s.src = THREE_SRC;
      s.onload = () => resolve(window.THREE || null);
      s.onerror = () => resolve(null);
      document.head.appendChild(s);
    } catch (e) { resolve(null); }
  });
}

function hash(n) { let x = (n | 0) * 2654435761 >>> 0; x ^= x >>> 13; x = Math.imul(x, 0x5bd1e995) >>> 0; return (x ^ (x >>> 15)) >>> 0; }
function rnd01(seed) { return (hash(seed) % 10000) / 10000; }
function yardOf(def) { return def.yard || def.plot; }
function tileToWorld(gx, gy) { return { x: gx - FARM_GRID.w / 2, z: gy - FARM_GRID.h / 2 }; }

/* ── Animal wander model (shared by 3D and 2D) ─────────────────────────────── */
class Wanderer {
  constructor(a, yard) {
    this.a = a; this.yard = yard;
    this.x = yard.x + 0.5 + rnd01(a.id * 7 + 1) * Math.max(0.2, yard.w - 1);
    this.z = yard.y + 0.5 + rnd01(a.id * 7 + 2) * Math.max(0.2, yard.h - 1);
    this.tx = this.x; this.tz = this.z; this.rot = rnd01(a.id) * Math.PI * 2;
    this.wait = rnd01(a.id * 3) * 3; this.phase = rnd01(a.id * 5) * 6.28; this.speed = 0.35 + rnd01(a.id * 11) * 0.3;
  }
  step(dt) {
    this.phase += dt * 6;
    if (this.wait > 0) { this.wait -= dt; return false; }
    const dx = this.tx - this.x, dz = this.tz - this.z, d = Math.hypot(dx, dz);
    if (d < 0.05) {
      this.wait = 1 + Math.random() * 4;
      this.tx = this.yard.x + 0.4 + Math.random() * Math.max(0.2, this.yard.w - 0.8);
      this.tz = this.yard.y + 0.4 + Math.random() * Math.max(0.2, this.yard.h - 0.8);
      return false;
    }
    const v = Math.min(d, this.speed * dt);
    this.x += dx / d * v; this.z += dz / d * v;
    const want = Math.atan2(dx, dz);
    let diff = want - this.rot; while (diff > Math.PI) diff -= 6.283; while (diff < -Math.PI) diff += 6.283;
    this.rot += diff * Math.min(1, dt * 6);
    return true;
  }
}

/* ══════════════════════════ 3D ══════════════════════════ */
function build3D(THREE, container, opts) {
  const W = () => Math.max(1, container.clientWidth), Hh = () => Math.max(1, container.clientHeight);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(W(), Hh());
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  const cv = renderer.domElement;
  cv.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;cursor:grab';
  container.appendChild(cv);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, W() / Hh(), 0.1, 200);
  const orbit = { theta: 0.65, phi: 0.95, dist: 21, cx: 0, cz: 0.6 };
  const placeCamera = () => {
    camera.position.set(
      orbit.cx + orbit.dist * Math.sin(orbit.phi) * Math.sin(orbit.theta),
      orbit.dist * Math.cos(orbit.phi),
      orbit.cz + orbit.dist * Math.sin(orbit.phi) * Math.cos(orbit.theta));
    camera.lookAt(orbit.cx, 0, orbit.cz);
  };
  placeCamera();

  const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x3a4a2a, 0.9); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d0, 1.15);
  sun.position.set(9, 16, 6); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -12; sun.shadow.camera.right = 12; sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12;
  scene.add(sun);

  const M = (c, o) => new THREE.MeshLambertMaterial(Object.assign({ color: c }, o || {}));
  const box = (w, h, d, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.castShadow = true; m.receiveShadow = true; return m; };
  const cyl = (rt, rb, h, mat, seg) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 10), mat); m.castShadow = true; m.receiveShadow = true; return m; };
  const cone = (r, h, mat, seg) => { const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg || 8), mat); m.castShadow = true; return m; };

  /* Sky: a vertical gradient baked to a tiny canvas texture. */
  const skyTex = (top, bottom) => {
    const c = document.createElement('canvas'); c.width = 4; c.height = 64; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 64); g.addColorStop(0, '#' + top.toString(16).padStart(6, '0')); g.addColorStop(1, '#' + bottom.toString(16).padStart(6, '0'));
    x.fillStyle = g; x.fillRect(0, 0, 4, 64);
    const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter; return t;
  };

  // Ground tiles, retinted by the look and season.
  const ground = new THREE.Group(); scene.add(ground);
  const gA = M(0x4f7a3a), gB = M(0x55823f), rimM = M(0x6b4f34);
  for (let y = 0; y < FARM_GRID.h; y++) for (let x = 0; x < FARM_GRID.w; x++) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 1), ((x + y) & 1) ? gA : gB);
    const p = tileToWorld(x + 0.5, y + 0.5); t.position.set(p.x, -0.1, p.z); t.receiveShadow = true; ground.add(t);
  }
  const rim = new THREE.Mesh(new THREE.BoxGeometry(FARM_GRID.w + 3, 0.18, FARM_GRID.h + 3), rimM);
  rim.position.y = -0.21; rim.receiveShadow = true; ground.add(rim);

  const pickables = [];
  const buildingNodes = {}, animalNodes = {};
  const yards = new THREE.Group(); scene.add(yards);
  const buildings = new THREE.Group(); scene.add(buildings);
  const herd = new THREE.Group(); scene.add(herd);
  const decor = new THREE.Group(); scene.add(decor);
  const actors = new THREE.Group(); scene.add(actors);
  const weatherG = new THREE.Group(); scene.add(weatherG);
  const spinners = [];   // windmill blades etc.

  /* ⚒ The Athena overlay. Null until (and unless) a live 'farm' map loads;
     every reader below falls back to the catalogue's own layout. */
  let athena = null, athenaVer = 0, athenaUnwatch = null;
  const yardFor = (def) => athena ? athena.yardOf(def) : yardOf(def);
  const placeFor = (def) => athena ? athena.placement(def) : null;
  const maxDist = () => (athena && athena.pieces && athena.pieces.ground) ? 70 : 34;
  async function loadAthena(force) {
    let ov = null;
    try { ov = await FarmAthena.loadOverlay(THREE, scene, { force }); } catch (e) { ov = null; }
    if (!alive) { if (ov) ov.dispose(); return; }
    if (athena) { try { scene.remove(athena.group); athena.dispose(); } catch (e) {} athena = null; }
    athena = ov; athenaVer++;
    if (ov) scene.add(ov.group);
    ground.visible = !(ov && ov.pieces && ov.pieces.ground);
    // everything placed by the catalogue is rebuilt against the new placement (the sync key carries athenaVer)
    Object.keys(buildingNodes).forEach(id => { const cur = buildingNodes[id]; try { unpick(cur.group); buildings.remove(cur.group); if (cur.fence) yards.remove(cur.fence); const si = spinners.indexOf(cur.spin); if (si >= 0) spinners.splice(si, 1); } catch (e) {} delete buildingNodes[id]; });
    try { if (view) update(view); } catch (e) {}
  }

  const labelSprite = (text, sub, color) => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 160;
    const x = c.getContext('2d');
    x.fillStyle = 'rgba(8,10,16,0.72)'; x.beginPath(); x.roundRect ? x.roundRect(6, 6, 628, 148, 24) : x.rect(6, 6, 628, 148); x.fill();
    x.strokeStyle = color || '#d4af37'; x.lineWidth = 6; x.stroke();
    const fit = (str, px, max) => { x.font = 'bold ' + px + 'px system-ui, sans-serif'; while (px > 22 && x.measureText(str).width > max) { px -= 2; x.font = 'bold ' + px + 'px system-ui, sans-serif'; } };
    x.fillStyle = '#f4efe4'; x.textAlign = 'center'; fit(text, 54, 590);
    x.fillText(text, 320, 70);
    if (sub) { x.fillStyle = '#c9c3b6'; x.font = '36px system-ui, sans-serif'; while (x.measureText(sub).width > 590) { x.font = (parseInt(x.font, 10) - 2) + 'px system-ui, sans-serif'; } x.fillText(sub, 320, 124); }
    const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(2.2, 0.55, 1);
    return sp;
  };
  const tinySprite = (emoji, size) => {
    const c = document.createElement('canvas'); c.width = c.height = 96; const x = c.getContext('2d');
    x.font = '72px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(emoji, 48, 52);
    const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(size || 0.4, size || 0.4, 1); return sp;
  };

  /* ── Buildings ── */
  const makeBuilding = (def, level, roofHex, damaged) => {
    const g = new THREE.Group();
    const w = def.plot.w, d = def.plot.h;
    const wall = M(0xb99a6b), roof = M(new THREE.Color(roofHex || def.accent).getHex()), trim = M(0x3a2f26);
    const hgt = 0.9 + 0.25 * level;
    if (def.id === 'pasture') {
      const hay = box(1.2, 0.6, 1.0, M(0xd9c46a)); hay.position.set(0, 0.3, 0); g.add(hay);
      const post = box(0.12, 1.1, 0.12, trim); post.position.set(-w / 2 + 0.3, 0.55, 0); g.add(post);
      const post2 = post.clone(); post2.position.x = w / 2 - 0.3; g.add(post2);
      const bar = box(w - 0.6, 0.1, 0.1, trim); bar.position.set(0, 0.9, 0); g.add(bar);
    } else if (def.id === 'guardpost') {
      const house = box(0.9, 0.7, 0.9, wall); house.position.set(-0.4, 0.35, 0); g.add(house);
      const rf = cone(0.75, 0.5, roof, 4); rf.rotation.y = Math.PI / 4; rf.position.set(-0.4, 0.95, 0); g.add(rf);
      const door = box(0.3, 0.35, 0.05, trim); door.position.set(-0.4, 0.2, 0.46); g.add(door);
      const pole = cyl(0.04, 0.05, 1.6, trim, 6); pole.position.set(0.55, 0.8, 0); g.add(pole);
      const lamp = box(0.22, 0.22, 0.22, new THREE.MeshLambertMaterial({ color: 0xffe0a0, emissive: 0xffc860, emissiveIntensity: 0.8 })); lamp.position.set(0.55, 1.55, 0); g.add(lamp);
    } else {
      const body = box(w - 0.3, hgt, d - 0.3, wall); body.position.y = hgt / 2; g.add(body);
      if (damaged) {
        // Roof gone: a few planks at angles and a dark hole.
        const hole = box(w - 0.5, 0.05, d - 0.5, M(0x1a1410)); hole.position.y = hgt + 0.03; g.add(hole);
        for (let i = 0; i < 4; i++) { const pl = box(0.8, 0.06, 0.18, roof); pl.position.set((i - 1.5) * 0.35, hgt + 0.15 + i * 0.05, (i % 2 ? 0.3 : -0.3)); pl.rotation.z = (i % 2 ? 0.5 : -0.4); pl.rotation.y = i * 0.7; g.add(pl); }
      } else {
        const rf = cone(Math.max(w, d) * 0.62, 0.7 + 0.15 * level, roof, 4);
        rf.rotation.y = Math.PI / 4; rf.position.y = hgt + 0.35 + 0.075 * level; rf.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d));
        g.add(rf);
      }
      const door = box(0.4, 0.55, 0.06, trim); door.position.set(0, 0.28, d / 2 - 0.13); g.add(door);
      const win = box(0.25, 0.25, 0.05, new THREE.MeshLambertMaterial({ color: 0x8fb8d8, emissive: 0x304050, emissiveIntensity: 0.4 })); win.position.set(w / 2 - 0.55, hgt * 0.6, d / 2 - 0.13); g.add(win);
      if (def.station) { const chimney = box(0.22, 0.6, 0.22, trim); chimney.position.set(w / 2 - 0.5, hgt + 0.5, -d / 4); g.add(chimney); }
      if (def.id === 'feedmill') {
        const tower = cyl(0.16, 0.2, 1.6, M(0x8a7a5a), 8); tower.position.set(w / 2 + 0.45, 0.8, -d / 2 + 0.3); g.add(tower);
        const hub = new THREE.Group(); hub.position.set(w / 2 + 0.45, 1.65, -d / 2 + 0.1);
        for (let i = 0; i < 4; i++) { const bl = box(0.08, 0.9, 0.16, M(0xe8dcc0)); bl.position.y = 0.45; const arm = new THREE.Group(); arm.rotation.z = i * Math.PI / 2; arm.add(bl); hub.add(arm); }
        g.add(hub); spinners.push(hub);
      }
    }
    for (let i = 0; i < level - 1; i++) { const star = box(0.16, 0.16, 0.16, M(0xd4af37)); star.position.set(-w / 2 + 0.35 + i * 0.3, hgt + 0.05, d / 2 - 0.1); g.add(star); }
    const lab = labelSprite(def.emoji + ' ' + def.name, damaged ? 'Roof torn off — repair' : 'Level ' + level, damaged ? '#e0556a' : (roofHex || def.accent)); lab.position.y = hgt + 1.35; g.add(lab);
    g.traverse(o => { if (o.isMesh) { o.userData.pick = { kind: 'building', id: def.id }; pickables.push(o); } });
    return g;
  };
  /* A building the admin REPLACED in Athena: the prop / .glb they chose, the
     farm's own label above it, and an invisible plate so a tap still opens
     the building (a .glb arrives asynchronously — meshes added later would
     not be in `pickables`). */
  const makeReplaced = (def, level, roofHex, damaged, pl) => {
    const g = new THREE.Group();
    const body = athena ? athena.replacement(def) : null; if (body) g.add(body);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(def.plot.w, 1.6, def.plot.h), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })); plate.position.y = 0.8; g.add(plate);
    const lab = labelSprite(def.emoji + ' ' + def.name, damaged ? 'Roof torn off — repair' : 'Level ' + level, damaged ? '#e0556a' : (roofHex || def.accent)); lab.position.y = 2.2 * Math.max(0.5, pl && pl.scale || 1); g.add(lab);
    g.traverse(o => { if (o.isMesh) { o.userData.pick = { kind: 'building', id: def.id }; pickables.push(o); } });
    return g;
  };
  const makeGhost = (def) => {
    const g = new THREE.Group();
    const plate = new THREE.Mesh(new THREE.BoxGeometry(def.plot.w - 0.2, 0.06, def.plot.h - 0.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(def.accent), transparent: true, opacity: 0.28 }));
    plate.position.y = 0.04; g.add(plate);
    const sign = box(0.08, 0.7, 0.08, M(0x3a2f26)); sign.position.set(0, 0.35, 0); g.add(sign);
    const lab = labelSprite(def.emoji + ' ' + def.name, 'Not built — tap to build', def.accent); lab.position.y = 1.2; lab.material.opacity = 0.85; g.add(lab);
    g.traverse(o => { if (o.isMesh) { o.userData.pick = { kind: 'building', id: def.id }; pickables.push(o); } });
    return g;
  };
  const fence = (x0t, y0t, x1t, y1t, color, tall) => {
    const g = new THREE.Group(); const mat = M(color || 0x7a5a3a); const h = tall ? 0.75 : 0.55;
    const along = (x0, z0, x1, z1) => {
      const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0)));
      for (let i = 0; i <= n; i++) { const p = box(0.1, h, 0.1, mat); p.position.set(x0 + (x1 - x0) * i / n, h / 2, z0 + (z1 - z0) * i / n); g.add(p); }
      const rail = box(Math.abs(x1 - x0) || 0.08, 0.06, Math.abs(z1 - z0) || 0.08, mat); rail.position.set((x0 + x1) / 2, h * 0.78, (z0 + z1) / 2); g.add(rail);
      const rail2 = rail.clone(); rail2.position.y = h * 0.38; g.add(rail2);
    };
    const a = tileToWorld(x0t, y0t), b = tileToWorld(x1t, y1t);
    along(a.x, a.z, b.x, a.z); along(b.x, a.z, b.x, b.z); along(b.x, b.z, a.x, b.z); along(a.x, b.z, a.x, a.z);
    return g;
  };

  /* ── Animals ── */
  const makeAnimal = (a) => {
    const def = animalDef(a.sp), s = def.size;
    const c = Object.assign({}, def.colors);
    const breed = a.breed ? FARM_ECON.breeds[a.breed] : null;
    if (breed) { c.body = breed.color; if (a.breed !== 'glow') c.head = breed.color; }
    const glow = a.breed === 'glow';
    const mk = (col) => glow ? new THREE.MeshLambertMaterial({ color: col, emissive: 0x4affc0, emissiveIntensity: 0.55 }) : M(col);
    const g = new THREE.Group(); const legs = [];
    const bodyM = mk(c.body), headM = mk(c.head), accM = M(c.accent), legM = M(c.legs);
    const leg = (x, z, h) => { const l = box(0.14 * s, h, 0.14 * s, legM); l.position.set(x, h / 2, z); g.add(l); legs.push(l); return l; };
    if (a.sp === 'chicken') {
      const body = box(0.42 * s, 0.34 * s, 0.5 * s, bodyM); body.position.y = 0.34 * s; g.add(body);
      const head = box(0.22 * s, 0.24 * s, 0.22 * s, headM); head.position.set(0, 0.62 * s, 0.26 * s); g.add(head);
      const comb = box(0.06 * s, 0.12 * s, 0.16 * s, accM); comb.position.set(0, 0.78 * s, 0.26 * s); g.add(comb);
      const beak = box(0.08 * s, 0.06 * s, 0.1 * s, M(0xe0a13c)); beak.position.set(0, 0.6 * s, 0.4 * s); g.add(beak);
      const tail = box(0.2 * s, 0.24 * s, 0.1 * s, bodyM); tail.position.set(0, 0.5 * s, -0.28 * s); g.add(tail);
      leg(-0.1 * s, 0, 0.18 * s); leg(0.1 * s, 0, 0.18 * s);
    } else if (a.sp === 'sheep') {
      const body = box(0.62 * s, 0.5 * s, 0.9 * s, bodyM); body.position.y = 0.55 * s; g.add(body);
      const head = box(0.26 * s, 0.28 * s, 0.32 * s, headM); head.position.set(0, 0.62 * s, 0.55 * s); g.add(head);
      const fluff = box(0.34 * s, 0.14 * s, 0.24 * s, bodyM); fluff.position.set(0, 0.8 * s, 0.55 * s); g.add(fluff);
      [-0.2, 0.2].forEach(x => [-0.3, 0.3].forEach(z => leg(x * s, z * s, 0.32 * s)));
    } else if (def.guard && a.sp !== 'donkey') {
      // Dogs: low body, pointed ears, tail up.
      const bw = 0.42 * s, bh = 0.4 * s, bl = 0.95 * s, lh = 0.36 * s;
      const body = box(bw, bh, bl, bodyM); body.position.y = lh + bh / 2; g.add(body);
      const head = box(bw * 0.8, bh * 0.8, bw * 0.9, headM); head.position.set(0, lh + bh * 0.95, bl / 2 + bw * 0.1); g.add(head);
      const snout = box(bw * 0.4, bh * 0.35, bw * 0.4, accM); snout.position.set(0, lh + bh * 0.8, bl / 2 + bw * 0.6); g.add(snout);
      const ear = box(0.1 * s, 0.22 * s, 0.05 * s, accM); ear.position.set(bw * 0.3, lh + bh * 1.4, bl / 2 - 0.05); g.add(ear);
      const ear2 = ear.clone(); ear2.position.x = -bw * 0.3; g.add(ear2);
      const tail = box(0.08 * s, 0.4 * s, 0.08 * s, bodyM); tail.rotation.x = 0.6; tail.position.set(0, lh + bh * 1.1, -bl / 2); g.add(tail);
      [-0.3, 0.3].forEach(x => [-0.36, 0.36].forEach(z => leg(x * bw, z * bl, lh)));
    } else {
      const isD = a.sp === 'donkey';
      const bw = (a.sp === 'cow' ? 0.6 : 0.5) * s, bh = (a.sp === 'cow' ? 0.6 : 0.45) * s, bl = (a.sp === 'cow' ? 1.15 : 0.95) * s, lh = (a.sp === 'pig' ? 0.22 : 0.42) * s;
      const body = box(bw, bh, bl, bodyM); body.position.y = lh + bh / 2; g.add(body);
      const head = box(bw * 0.6, bh * 0.65, bw * (isD ? 0.9 : 0.6), headM); head.position.set(0, lh + bh * 0.75, bl / 2 + bw * 0.2); g.add(head);
      if (a.sp === 'cow') {
        const spot = box(bw * 0.5, bh * 0.4, bl * 0.35, accM); spot.position.set(bw * 0.26, lh + bh * 0.6, -bl * 0.15); g.add(spot);
        const spot2 = box(bw * 0.4, bh * 0.35, bl * 0.25, accM); spot2.position.set(-bw * 0.3, lh + bh * 0.45, bl * 0.2); g.add(spot2);
        const horn = box(0.05 * s, 0.05 * s, 0.16 * s, M(0xe8dcc0)); horn.rotation.x = -0.6; horn.position.set(bw * 0.28, lh + bh * 1.05, bl / 2 + bw * 0.1); g.add(horn);
        const horn2 = horn.clone(); horn2.position.x = -bw * 0.28; g.add(horn2);
        const nose = box(bw * 0.62, bh * 0.28, 0.1 * s, M(0xe0a8a8)); nose.position.set(0, lh + bh * 0.6, bl / 2 + bw * 0.5); g.add(nose);
        const udder = box(bw * 0.5, bh * 0.25, bl * 0.25, M(0xe8b8b8)); udder.position.set(0, lh - bh * 0.05, -bl * 0.1); g.add(udder);
      } else if (a.sp === 'pig') {
        const snout = box(bw * 0.3, bh * 0.25, 0.1 * s, accM); snout.position.set(0, lh + bh * 0.7, bl / 2 + bw * 0.5); g.add(snout);
        const ear = box(0.1 * s, 0.14 * s, 0.05 * s, accM); ear.position.set(bw * 0.25, lh + bh * 1.05, bl / 2); g.add(ear);
        const ear2 = ear.clone(); ear2.position.x = -bw * 0.25; g.add(ear2);
        const tail = box(0.05 * s, 0.05 * s, 0.18 * s, accM); tail.rotation.x = 0.8; tail.position.set(0, lh + bh * 0.8, -bl / 2 - 0.05); g.add(tail);
      } else if (a.sp === 'goat') {
        const horn = box(0.05 * s, 0.24 * s, 0.05 * s, accM); horn.rotation.x = 0.5; horn.position.set(bw * 0.2, lh + bh * 1.15, bl / 2); g.add(horn);
        const horn2 = horn.clone(); horn2.position.x = -bw * 0.2; g.add(horn2);
        const beard = box(0.08 * s, 0.14 * s, 0.06 * s, accM); beard.position.set(0, lh + bh * 0.4, bl / 2 + bw * 0.45); g.add(beard);
      } else if (isD) {
        const ear = box(0.08 * s, 0.32 * s, 0.06 * s, accM); ear.position.set(bw * 0.25, lh + bh * 1.3, bl / 2 + bw * 0.1); g.add(ear);
        const ear2 = ear.clone(); ear2.position.x = -bw * 0.25; g.add(ear2);
        const mane = box(bw * 0.3, bh * 0.25, bl * 0.5, M(0x3a3430)); mane.position.set(0, lh + bh * 1.05, bl * 0.1); g.add(mane);
        const muzzle = box(bw * 0.5, bh * 0.3, 0.1 * s, accM); muzzle.position.set(0, lh + bh * 0.6, bl / 2 + bw * 0.65); g.add(muzzle);
        const tail = box(0.06 * s, 0.4 * s, 0.06 * s, M(0x3a3430)); tail.position.set(0, lh + bh * 0.6, -bl / 2 - 0.03); g.add(tail);
      }
      [-0.33, 0.33].forEach(x => [-0.36, 0.36].forEach(z => leg(x * bw, z * bl, lh)));
    }
    const top = (a.sp === 'chicken' ? 0.95 : 1.35) * s + 0.25;
    const rosette = tinySprite('🏅', 0.42); rosette.position.y = top; rosette.visible = false; g.add(rosette);
    const sickMark = tinySprite('🤒', 0.36); sickMark.position.y = top; sickMark.visible = false; g.add(sickMark);
    const illMark = tinySprite('🦠', 0.36); illMark.position.y = top; illMark.visible = false; g.add(illMark);
    const crown = tinySprite(a.breed && /:mythic$/.test(a.breed) ? '🌟' : '👑', 0.36); crown.position.y = top + 0.3; crown.visible = false; g.add(crown);
    g.traverse(o => { if (o.isMesh) { o.userData.pick = { kind: 'animal', id: a.sp }; pickables.push(o); } });
    return { group: g, legs, rosette, sickMark, illMark, crown };
  };

  /* ── Decor (rebuilt when the look changes) ── */
  const tree = (x, z, seed) => {
    const g = new THREE.Group(); const sc = 0.8 + rnd01(seed) * 0.6;
    const trunk = cyl(0.08 * sc, 0.12 * sc, 0.6 * sc, M(0x6b4a2a), 6); trunk.position.y = 0.3 * sc; g.add(trunk);
    const shade = [0x2f6a3a, 0x3a7a44, 0x4a8a4a][hash(seed) % 3];
    const c1 = cone(0.55 * sc, 0.9 * sc, M(shade), 7); c1.position.y = 0.95 * sc; g.add(c1);
    const c2 = cone(0.42 * sc, 0.75 * sc, M(shade), 7); c2.position.y = 1.45 * sc; g.add(c2);
    g.position.set(x, 0, z); g.rotation.y = rnd01(seed * 3) * 6.28; return g;
  };
  const buildDecor = (look, season) => {
    while (decor.children.length) { const c = decor.children.pop(); c.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    spinners.length = 0; // windmill is on the feed mill building, keep list only for decor spinners below
    const D = look.decor;
    const snow = look.ground === 'snow';
    if (D.paths) {
      const pathM = M(snow ? 0xb8b0a8 : 0x8a6a46);
      const strip = (x0, y0, x1, y1) => { const a = tileToWorld(x0, y0), b = tileToWorld(x1, y1); const m = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(b.x - a.x) || 0.6, 0.04, Math.abs(b.z - a.z) || 0.6), pathM); m.position.set((a.x + b.x) / 2, 0.02, (a.z + b.z) / 2); m.receiveShadow = true; decor.add(m); };
      strip(4.2, 0, 4.8, 14); strip(8.2, 0, 8.8, 8.8); strip(0, 0.2, 14, 0.8);
    }
    if (D.fence) decor.add(fence(0, 0, FARM_GRID.w, FARM_GRID.h, snow ? 0x5a4a3a : 0x6a4a2a, true));
    if (D.trees) {
      for (let i = 0; i < 16; i++) {
        const t = i / 16, ang = t * Math.PI * 2;
        const gx = FARM_GRID.w / 2 + Math.cos(ang) * (FARM_GRID.w / 2 + 1.1), gy = FARM_GRID.h / 2 + Math.sin(ang) * (FARM_GRID.h / 2 + 1.1);
        const p = tileToWorld(gx + (rnd01(i * 5) - 0.5) * 0.5, gy + (rnd01(i * 9) - 0.5) * 0.5);
        const tr = tree(p.x, p.z, i + 11);
        if (season && season.key === 'autumn') tr.traverse(o => { if (o.isMesh && o.geometry.type === 'ConeGeometry') o.material = M([0xc26a2a, 0xd9a03a, 0x8a5a2a][i % 3]); });
        if (snow) tr.traverse(o => { if (o.isMesh && o.geometry.type === 'ConeGeometry') o.material = M(0xdfe6ec); });
        decor.add(tr);
      }
    }
    if (D.pond) {
      const p = tileToWorld(9.5, 12.4);
      const water = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.06, 20), new THREE.MeshLambertMaterial({ color: snow ? 0x9ab8d0 : 0x3a86b8, emissive: 0x0a2a44, emissiveIntensity: 0.3, transparent: true, opacity: 0.92 }));
      water.position.set(p.x, 0.02, p.z); decor.add(water);
      const bank = new THREE.Mesh(new THREE.TorusGeometry(1.18, 0.09, 6, 20), M(0x8a7a5a)); bank.rotation.x = Math.PI / 2; bank.position.set(p.x, 0.04, p.z); decor.add(bank);
      for (let i = 0; i < 3; i++) { const reed = box(0.05, 0.5, 0.05, M(0x5a8a3a)); reed.position.set(p.x + 0.9 + i * 0.12, 0.25, p.z - 0.6 + i * 0.2); decor.add(reed); }
    }
    if (D.windmill) {
      const p = tileToWorld(8.5, 0.6);
      const tower = cone(0.35, 2.2, M(0x9a8a6a), 6); tower.position.set(p.x, 1.1, p.z); decor.add(tower);
      const hub = new THREE.Group(); hub.position.set(p.x, 2.15, p.z + 0.3);
      for (let i = 0; i < 4; i++) { const bl = box(0.1, 1.1, 0.2, M(0xe8dcc0)); bl.position.y = 0.55; const arm = new THREE.Group(); arm.rotation.z = i * Math.PI / 2; arm.add(bl); hub.add(arm); }
      decor.add(hub); spinners.push(hub);
    }
    if (D.hay) {
      for (let i = 0; i < 4; i++) { const p = tileToWorld(1.5 + i * 0.85, 10.5); const b = cyl(0.3, 0.3, 0.5, M(0xd9c46a), 10); b.rotation.z = Math.PI / 2; b.position.set(p.x, 0.3, p.z); b.rotation.y = rnd01(i * 7) * 0.6; decor.add(b); }
    }
    if (D.crops) {
      for (let r = 0; r < 6; r++) { const p = tileToWorld(13.5, 1.5 + r); const row = box(0.8, 0.12, 0.7, M(snow ? 0x8a8078 : 0x6a4a2a)); row.position.set(p.x, 0.06, p.z); decor.add(row);
        for (let k = 0; k < 3; k++) { const plant = box(0.14, 0.32, 0.14, M(snow ? 0xa8a898 : [0x7ab34a, 0x9ac05a, 0x6a9a3a][k])); plant.position.set(p.x - 0.26 + k * 0.26, 0.28, p.z); decor.add(plant); } }
    }
    if (D.lanterns) {
      FARM_BUILDINGS.forEach(def => {
        if (!def.yard) return; const yd = yardFor(def);
        [[yd.x, yd.y], [yd.x + yd.w, yd.y + yd.h]].forEach(([gx, gy], i) => {
          const p = tileToWorld(gx, gy);
          const pole = cyl(0.03, 0.04, 1.1, M(0x3a2f26), 6); pole.position.set(p.x, 0.55, p.z); decor.add(pole);
          const lamp = box(0.18, 0.18, 0.18, new THREE.MeshLambertMaterial({ color: 0xffe0a0, emissive: 0xffb040, emissiveIntensity: 1 })); lamp.position.set(p.x, 1.15, p.z); decor.add(lamp);
        });
      });
    }
  };

  /* ── Weather ── */
  let rain = null, rainVel = null, fogBase = null;
  const setWeather = (wx, sky) => {
    while (weatherG.children.length) { const c = weatherG.children.pop(); if (c.geometry) c.geometry.dispose(); }
    rain = null;
    const S = FARM_LOOKS.sky[sky] || FARM_LOOKS.sky.day;
    let top = S.top, bottom = S.bottom, sunI = S.sun, hemiI = S.hemi, fogD = 60;
    if (wx.key === 'rain' || wx.key === 'storm' || wx.key === 'cloud') { top = blend(top, 0x3a4250, wx.key === 'cloud' ? 0.45 : 0.7); bottom = blend(bottom, 0x6a7280, wx.key === 'cloud' ? 0.4 : 0.65); sunI *= wx.key === 'cloud' ? 0.75 : 0.5; }
    if (wx.key === 'fog') { top = blend(top, 0xb8bcc4, 0.6); bottom = blend(bottom, 0xd0d4d8, 0.7); fogD = 24; }
    scene.background = skyTex(top, bottom);
    scene.fog = new THREE.Fog(bottom, wx.key === 'fog' ? 10 : 22, fogD);
    sun.intensity = sunI; hemi.intensity = hemiI;
    if (wx.key === 'rain' || wx.key === 'storm') {
      const n = wx.key === 'storm' ? 900 : 500;
      const pos = new Float32Array(n * 3); rainVel = new Float32Array(n);
      for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 22; pos[i * 3 + 1] = Math.random() * 12; pos[i * 3 + 2] = (Math.random() - 0.5) * 22; rainVel[i] = 6 + Math.random() * 6; }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      rain = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xc8dcf0, size: 0.07, transparent: true, opacity: 0.8 }));
      weatherG.add(rain);
    }
  };
  const blend = (a, b, t) => { const ca = new THREE.Color(a), cb = new THREE.Color(b); return ca.lerp(cb, t).getHex(); };

  /* ── Event actors: the replay of what happened while you were away ── */
  let actorList = [];
  const spawnActors = (events) => {
    while (actors.children.length) actors.children.pop();
    actorList = [];
    const seen = new Set();
    events.forEach(ev => {
      if (seen.has(ev.kind) || actorList.length >= 3) return; seen.add(ev.kind);
      const t0 = performance.now();
      if (ev.kind === 'ufo') {
        const g = new THREE.Group();
        const disc = cyl(1.1, 1.4, 0.25, new THREE.MeshLambertMaterial({ color: 0x9aa4b8, emissive: 0x304060, emissiveIntensity: 0.5 }), 18); g.add(disc);
        const dome = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x8affd6, emissive: 0x4affc0, emissiveIntensity: 0.8, transparent: true, opacity: 0.85 })); dome.position.y = 0.12; g.add(dome);
        const beam = new THREE.Mesh(new THREE.ConeGeometry(1.2, 5.5, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0x8affd6, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })); beam.position.y = -2.9; g.add(beam);
        for (let i = 0; i < 8; i++) { const l = box(0.12, 0.08, 0.12, new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: [0xff4060, 0x40ff80, 0x4080ff][i % 3], emissiveIntensity: 1.2 })); l.position.set(Math.cos(i / 8 * 6.28) * 1.2, -0.1, Math.sin(i / 8 * 6.28) * 1.2); g.add(l); }
        const p = tileToWorld(7, 10.5); g.position.set(p.x, 6, p.z); actors.add(g);
        actorList.push({ kind: 'ufo', g, t0, tick: (t, dt) => { g.rotation.y += dt * 1.2; g.position.y = 6 + Math.sin(t / 700) * 0.3; if (t - t0 > 9000) { g.position.y += dt * 12; g.position.x += dt * 9; } } });
      } else if (ev.kind === 'raid') {
        const g = new THREE.Group();
        for (let i = 0; i < 3; i++) { const r = new THREE.Group(); const body = box(0.32, 0.6, 0.22, M(0x2a2a30)); body.position.y = 0.55; r.add(body); const head = box(0.24, 0.24, 0.24, M(0x5a4a3a)); head.position.y = 0.98; r.add(head); const mask = box(0.26, 0.1, 0.05, M(0xb8404a)); mask.position.set(0, 0.98, 0.13); r.add(mask); const sack = box(0.24, 0.28, 0.24, M(0x8a6a3a)); sack.position.set(-0.22, 0.75, -0.1); r.add(sack); r.position.x = i * 0.6; g.add(r); }
        const p = tileToWorld(-0.8, 6); g.position.set(p.x, 0, p.z); actors.add(g);
        actorList.push({ kind: 'raid', g, t0, tick: (t, dt) => { g.position.x -= dt * 1.4; g.children.forEach((r, i) => { r.position.y = Math.abs(Math.sin(t / 120 + i)) * 0.08; }); } });
      } else if (ev.kind === 'wolves' || ev.kind === 'fox') {
        const g = new THREE.Group(); const n = ev.kind === 'wolves' ? 3 : 1; const col = ev.kind === 'wolves' ? 0x5a5a62 : 0xd8742a;
        for (let i = 0; i < n; i++) { const w = new THREE.Group(); const body = box(0.32, 0.3, 0.8, M(col)); body.position.y = 0.42; w.add(body); const head = box(0.26, 0.26, 0.34, M(col)); head.position.set(0, 0.6, 0.5); w.add(head); const snout = box(0.14, 0.12, 0.2, M(ev.kind === 'fox' ? 0xf4efe4 : 0x3a3a40)); snout.position.set(0, 0.55, 0.72); w.add(snout); const tail = box(0.1, 0.1, 0.45, M(col)); tail.position.set(0, 0.5, -0.55); tail.rotation.x = 0.4; w.add(tail); [-0.1, 0.1].forEach(x => [-0.28, 0.28].forEach(z => { const l = box(0.08, 0.3, 0.08, M(col)); l.position.set(x, 0.15, z); w.add(l); })); w.position.set(i * 0.7, 0, (i % 2) * 0.5); g.add(w); }
        const p = tileToWorld(15.2, 10); g.position.set(p.x, 0, p.z); g.rotation.y = Math.PI / 2; actors.add(g);
        actorList.push({ kind: ev.kind, g, t0, tick: (t, dt) => { const ph = (t - t0) / 1000; g.position.x = p.x + Math.sin(ph * 0.8) * 1.2; g.rotation.y = Math.PI / 2 + (Math.cos(ph * 0.8) > 0 ? 0 : Math.PI); } });
      } else if (ev.kind === 'hawk') {
        const g = new THREE.Group(); const body = box(0.18, 0.12, 0.5, M(0x5a3a2a)); g.add(body); const wl = box(0.9, 0.04, 0.22, M(0x6a4a3a)); wl.position.x = -0.5; g.add(wl); const wr = wl.clone(); wr.position.x = 0.5; g.add(wr);
        const c = tileToWorld(6.5, 4.5); g.position.set(c.x, 5, c.z); actors.add(g);
        actorList.push({ kind: 'hawk', g, t0, tick: (t) => { const ph = (t - t0) / 1000; g.position.set(c.x + Math.cos(ph * 0.9) * 3.2, 4.4 + Math.sin(ph * 1.7) * 0.5, c.z + Math.sin(ph * 0.9) * 3.2); g.rotation.y = -ph * 0.9; wl.rotation.z = Math.sin(ph * 6) * 0.25; wr.rotation.z = -Math.sin(ph * 6) * 0.25; } });
      }
    });
  };

  /* 🏗 Scaffolding: a building being raised is poles, planks and a crate. */
  const makeScaffold = (def, label) => {
    const g = new THREE.Group(); const w = def.plot.w, d = def.plot.h; const wood = M(0x9a7a4a), plank = M(0xc8a068);
    const slab = box(w - 0.3, 0.12, d - 0.3, M(0x8a8078)); slab.position.y = 0.06; g.add(slab);
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sz]) => { const pole = box(0.1, 1.4, 0.1, wood); pole.position.set(sx * (w / 2 - 0.25), 0.7, sz * (d / 2 - 0.25)); g.add(pole); });
    const beam = box(w - 0.4, 0.08, 0.08, wood); beam.position.set(0, 1.35, d / 2 - 0.25); g.add(beam); const beam2 = beam.clone(); beam2.position.z = -(d / 2 - 0.25); g.add(beam2);
    for (let i = 0; i < 3; i++) { const pl = box(0.9, 0.06, 0.2, plank); pl.position.set((i - 1) * 0.5, 0.15 + i * 0.05, (i % 2 ? 0.3 : -0.3)); pl.rotation.y = i * 0.5; g.add(pl); }
    const crate = box(0.4, 0.4, 0.4, plank); crate.position.set(w / 2 - 0.55, 0.32, -d / 2 + 0.55); g.add(crate);
    const lab = labelSprite('🏗 ' + def.name, label || 'Under construction', '#d4af37'); lab.position.y = 2.0; g.add(lab);
    g.traverse(o => { if (o.isMesh) { o.userData.pick = { kind: 'building', id: def.id }; pickables.push(o); } });
    return g;
  };
  /* 🚚 A haulage truck: cab, bed, wheels, and a crate with the animal's emoji. */
  const makeTruck = (emoji, own) => {
    const g = new THREE.Group(); const body = M(own ? 0x8a6a3a : 0x3a4a6a), dark = M(0x1a1a20);
    const bed = box(1.5, 0.35, 0.7, body); bed.position.set(-0.25, 0.42, 0); g.add(bed);
    const cab = box(0.55, 0.55, 0.7, body); cab.position.set(0.75, 0.52, 0); g.add(cab);
    const glass = box(0.08, 0.25, 0.5, new THREE.MeshLambertMaterial({ color: 0x8fb8d8, emissive: 0x203040 })); glass.position.set(1.03, 0.6, 0); g.add(glass);
    const crate = box(0.9, 0.45, 0.55, M(0xc8a068)); crate.position.set(-0.4, 0.82, 0); g.add(crate);
    [[0.7, 0.35], [0.7, -0.35], [-0.6, 0.35], [-0.6, -0.35]].forEach(([x, z]) => { const wh = cyl(0.16, 0.16, 0.12, dark, 10); wh.rotation.x = Math.PI / 2; wh.position.set(x, 0.16, z); g.add(wh); });
    const sp = tinySprite(emoji, 0.45); sp.position.set(-0.4, 1.3, 0); g.add(sp);
    return g;
  };
  const truckNodes = {};

  let view = null, selected = null, selectRing = null, lookKey = '', wxKey = '', actorsShown = false;
  const unpick = (root) => root.traverse(o => { const i = pickables.indexOf(o); if (i >= 0) pickables.splice(i, 1); });

  function update(v) {
    view = v;
    const look = v.look || FARM_LOOKS.defaults;
    const lk = JSON.stringify([look.ground, look.decor, v.season && v.season.key]);
    if (lk !== lookKey) {
      lookKey = lk;
      const G = FARM_LOOKS.ground[look.ground] || FARM_LOOKS.ground.meadow;
      let a = G.a, b = G.b;
      if (v.season && look.ground === 'meadow') { if (v.season.key === 'autumn') { a = blend(a, 0x9a7a3a, 0.35); b = blend(b, 0xa8863a, 0.35); } if (v.season.key === 'winter') { a = blend(a, 0x9aa8a0, 0.35); b = blend(b, 0xa8b4ac, 0.35); } if (v.season.key === 'summer') { a = blend(a, 0x7a9a3a, 0.2); b = blend(b, 0x86a842, 0.2); } }
      gA.color.setHex(a); gB.color.setHex(b); rimM.color.setHex(G.rim);
      buildDecor(look, v.season);
    }
    const skyKey = skyForHour(v.hour, look.sky);   // 🕒 the city's clock, or the chosen look when there is none
    const wk = (v.weather ? v.weather.key : 'clear') + '|' + skyKey;
    if (wk !== wxKey) { wxKey = wk; setWeather(v.weather || { key: 'clear' }, skyKey); }

    FARM_BUILDINGS.forEach(def => {
      const row = v.buildings[def.id], lv = row ? row.level : 0;
      const roof = look.roofs && look.roofs[def.id];
      const dmg = !!(row && row.damaged);
      const constructing = !!(row && row.constructing && row.readyAt > Date.now());
      const key = lv + '|' + (roof || '') + '|' + dmg + '|' + constructing + '|' + athenaVer;
      const cur = buildingNodes[def.id];
      if (cur && cur.key === key) return;
      if (cur) { unpick(cur.group); buildings.remove(cur.group); if (cur.fence) yards.remove(cur.fence); const si = spinners.indexOf(cur.spin); if (si >= 0) spinners.splice(si, 1); }
      const pl = placeFor(def);
      const p = pl ? { x: pl.x, z: pl.z } : tileToWorld(def.plot.x + def.plot.w / 2, def.plot.y + def.plot.h / 2);
      const before = spinners.length;
      const g = !lv ? makeGhost(def) : constructing ? makeScaffold(def) : (pl && pl.replaced) ? makeReplaced(def, lv, roof, dmg, pl) : makeBuilding(def, lv, roof, dmg);
      g.position.set(p.x, pl ? pl.y : 0, p.z);
      if (pl) { g.rotation.y = pl.ry; if (!pl.replaced) g.scale.setScalar(pl.scale || 1); g.visible = !pl.hidden; }
      buildings.add(g);
      let f = null;
      const yd = yardFor(def);
      if (lv && !constructing && def.yard && !(pl && pl.hidden)) { f = fence(yd.x, yd.y, yd.x + yd.w, yd.y + yd.h, lv >= 3 ? 0x5a4a3a : 0x7a5a3a, lv >= 2); yards.add(f); }
      buildingNodes[def.id] = { group: g, key, fence: f, spin: spinners.length > before ? spinners[spinners.length - 1] : null };
    });
    const live = new Set();
    v.animals.forEach(a => {
      live.add(a.id);
      const def = animalDef(a.sp); const penDef = FARM_BUILDINGS.find(b => b.id === def.pen);
      const yard = yardFor(penDef);
      let n = animalNodes[a.id];
      const akey = (a.breed || '') ;
      if (n && n.akey !== akey) { unpick(n.group); herd.remove(n.group); delete animalNodes[a.id]; n = null; }
      if (!n) {
        const made = makeAnimal(a);
        n = animalNodes[a.id] = { group: made.group, legs: made.legs, rosette: made.rosette, sickMark: made.sickMark, illMark: made.illMark, crown: made.crown, w: new Wanderer(a, yard), sp: a.sp, akey };
        herd.add(n.group);
      }
      const e = FARM_ECON.animals[a.sp];
      const grown = e ? Math.min(1, a.grownH / e.growH) : 1;
      let sc = 0.55 + 0.45 * grown;
      if (e && a.weight) sc *= 0.9 + 0.2 * Math.min(1.3, a.weight / e.adultWeight) / 1.3;
      n.group.scale.set(sc, sc, sc);
      n.rosette.visible = !!a.prize; n.illMark.visible = !!a.ill; n.sickMark.visible = !!a.sick && !a.ill && !a.prize;
      n.crown.visible = !!(a.tier === 'royal' || a.tier === 'mythic');
      n.group.visible = !a.away;   // an escort is on the road
    });
    Object.keys(animalNodes).forEach(id => {
      if (live.has(+id)) return;
      unpick(animalNodes[id].group); herd.remove(animalNodes[id].group); delete animalNodes[id];
    });
    // 🚚 Shipments on the road: one truck each, driving the top path toward the pen.
    const ships = Array.isArray(v.shipments) ? v.shipments.slice(0, 4) : [];
    const liveShips = new Set();
    ships.forEach(x => {
      liveShips.add(x.id);
      let n = truckNodes[x.id];
      if (!n) { const ad = animalDef(x.sp); n = truckNodes[x.id] = { g: makeTruck(ad ? ad.emoji : '📦', /^own:/.test(x.carrier)), pen: x.pen }; actors.add(n.g); }
      const penDef = FARM_BUILDINGS.find(b => b.id === x.pen) || FARM_BUILDINGS[0];
      const gx0 = -2.5, gx1 = penDef.plot.x + penDef.plot.w / 2;
      const p = tileToWorld(gx0 + (gx1 - gx0) * x.progress, 0.5);
      n.g.position.set(p.x, 0, p.z); n.g.rotation.y = 0; n.target = p;
    });
    Object.keys(truckNodes).forEach(id => { if (!liveShips.has(+id)) { actors.remove(truckNodes[id].g); delete truckNodes[id]; } });
    if (!actorsShown && Array.isArray(v.recentEvents) && v.recentEvents.length) { actorsShown = true; spawnActors(v.recentEvents); }
  }

  /* ── input: orbit + pick ── */
  let dragging = false, moved = 0, lx = 0, ly = 0, pinch = 0;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const pickAt = (px, py) => {
    const r = cv.getBoundingClientRect();
    ndc.set(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(pickables, false);
    return hits.length ? hits[0].object.userData.pick : null;
  };
  const onDown = (e) => { dragging = true; moved = 0; lx = e.clientX; ly = e.clientY; cv.style.cursor = 'grabbing'; try { cv.setPointerCapture(e.pointerId); } catch (x) {} };
  const onMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
    orbit.theta -= dx * 0.008; orbit.phi = Math.max(0.35, Math.min(1.35, orbit.phi - dy * 0.006)); placeCamera();
  };
  const onUp = (e) => {
    dragging = false; cv.style.cursor = 'grab';
    if (moved < 6) { const p = pickAt(e.clientX, e.clientY); if (p) { select(p); try { opts.onSelect && opts.onSelect(p.kind, p.id); } catch (x) {} } }
  };
  const onWheel = (e) => { e.preventDefault(); orbit.dist = Math.max(8, Math.min(maxDist(), orbit.dist + e.deltaY * 0.02)); placeCamera(); };
  const onTouch = (e) => {
    if (e.touches.length === 2) {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      if (pinch) { orbit.dist = Math.max(8, Math.min(maxDist(), orbit.dist - (d - pinch) * 0.04)); placeCamera(); }
      pinch = d; e.preventDefault();
    } else pinch = 0;
  };
  cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp); cv.addEventListener('pointercancel', () => { dragging = false; });
  cv.addEventListener('wheel', onWheel, { passive: false }); cv.addEventListener('touchmove', onTouch, { passive: false });

  function select(p) {
    selected = p;
    if (!selectRing) {
      selectRing = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.85, 32), new THREE.MeshBasicMaterial({ color: 0xd4af37, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
      selectRing.rotation.x = -Math.PI / 2; selectRing.position.y = 0.03; scene.add(selectRing);
    }
    if (p.kind === 'building') {
      const def = FARM_BUILDINGS.find(b => b.id === p.id); const pl = placeFor(def); const w = pl ? { x: pl.x, z: pl.z } : tileToWorld(def.plot.x + def.plot.w / 2, def.plot.y + def.plot.h / 2);
      selectRing.position.set(w.x, 0.03, w.z); const r = Math.max(def.plot.w, def.plot.h) * 0.62; selectRing.scale.set(r, r, 1);
      selectRing.visible = true;
    } else selectRing.visible = false;
  }

  /* ── loop ── */
  let last = performance.now(), alive = true, rafId = 0, timerId = 0, flashAt = 0;
  const frame = (t) => {
    if (!alive) return;
    if (!cv.isConnected) { destroy(); return; }
    const dt = Math.min(0.1, (t - last) / 1000); last = t;
    Object.keys(animalNodes).forEach(id => {
      const n = animalNodes[id]; const walking = n.w.step(dt);
      const p = tileToWorld(n.w.x, n.w.z); n.group.position.set(p.x, 0, p.z); n.group.rotation.y = n.w.rot;
      const bob = walking ? Math.sin(n.w.phase) : 0;
      n.legs.forEach((l, i) => { l.rotation.x = bob * 0.5 * (i % 2 ? 1 : -1); });
      n.group.position.y = walking ? Math.abs(Math.sin(n.w.phase)) * 0.03 : 0;
    });
    spinners.forEach(h => { h.rotation.z += dt * 1.1; });
    if (athena) athena.update(dt, camera);
    Object.values(truckNodes).forEach(n => { n.g.position.y = Math.abs(Math.sin(t / 90)) * 0.02; });
    if (rain) {
      const pos = rain.geometry.attributes.position.array;
      for (let i = 0; i < rainVel.length; i++) { pos[i * 3 + 1] -= rainVel[i] * dt; if (pos[i * 3 + 1] < 0) pos[i * 3 + 1] = 12; }
      rain.geometry.attributes.position.needsUpdate = true;
      if (view && view.weather && view.weather.key === 'storm' && t - flashAt > 4000 + Math.random() * 6000) { flashAt = t; hemi.intensity = 2.5; setTimeout(() => { if (alive) hemi.intensity = (FARM_LOOKS.sky[(view.look || {}).sky] || FARM_LOOKS.sky.day).hemi; }, 120); }
    }
    for (let i = actorList.length - 1; i >= 0; i--) { const a = actorList[i]; a.tick(t, dt); if (t - a.t0 > 12000) { actors.remove(a.g); actorList.splice(i, 1); } }
    if (selectRing && selectRing.visible) selectRing.material.opacity = 0.6 + 0.3 * Math.sin(t / 300);
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(frame);
  };
  rafId = requestAnimationFrame(frame);
  timerId = setInterval(() => { if (alive && !cv.isConnected) destroy(); }, 1500);

  const onResize = () => { try { renderer.setSize(W(), Hh()); camera.aspect = W() / Hh(); camera.updateProjectionMatrix(); } catch (e) {} };
  window.addEventListener('resize', onResize);
  let ro = null; try { ro = new ResizeObserver(onResize); ro.observe(container); } catch (e) {}

  function destroy() {
    if (!alive) return; alive = false;
    try { if (athenaUnwatch) athenaUnwatch(); if (athena) athena.dispose(); } catch (e) {}
    try { cancelAnimationFrame(rafId); clearInterval(timerId); } catch (e) {}
    try { window.removeEventListener('resize', onResize); if (ro) ro.disconnect(); } catch (e) {}
    try { scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { const ms = [].concat(o.material); ms.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); } }); } catch (e) {}
    try { if (scene.background && scene.background.dispose) scene.background.dispose(); } catch (e) {}
    try { renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss(); } catch (e) {}
    try { cv.remove(); } catch (e) {}
  }
  // ⚒ Fetch the live Athena farm map (async, degrades to null) and follow the editor's saves.
  loadAthena(false);
  athenaUnwatch = FarmAthena.watchAthena(() => loadAthena(true));
  return { update, destroy, mode: '3d', select, get athena() { return athena; }, reloadAthena: () => loadAthena(true) };
}

/* ══════════════════════════ 2D fallback ══════════════════════════ */
function build2D(container, opts) {
  const cv = document.createElement('canvas');
  cv.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;cursor:pointer';
  container.appendChild(cv);
  const ctx = cv.getContext('2d');
  let view = null, wanderers = {}, alive = true, rafId = 0, last = performance.now();
  const tile = () => Math.floor(Math.min(cv.width / (FARM_GRID.w + 1), cv.height / (FARM_GRID.h + 1)));
  const origin = () => { const t = tile(); return { ox: (cv.width - t * FARM_GRID.w) / 2, oy: (cv.height - t * FARM_GRID.h) / 2, t }; };
  const fit = () => { const r = container.getBoundingClientRect(); cv.width = Math.max(320, r.width | 0); cv.height = Math.max(240, r.height | 0); };
  fit();
  function update(v) {
    view = v;
    const live = new Set();
    v.animals.forEach(a => { live.add(a.id); if (!wanderers[a.id]) { const d = animalDef(a.sp), pen = FARM_BUILDINGS.find(b => b.id === d.pen); wanderers[a.id] = { w: new Wanderer(a, yardOf(pen)), a }; } else wanderers[a.id].a = a; });
    Object.keys(wanderers).forEach(id => { if (!live.has(+id)) delete wanderers[id]; });
  }
  const hx = (n) => '#' + (n | 0).toString(16).padStart(6, '0');
  const draw = (dt) => {
    const { ox, oy, t } = origin();
    const G = view && view.look ? (FARM_LOOKS.ground[view.look.ground] || FARM_LOOKS.ground.meadow) : FARM_LOOKS.ground.meadow;
    ctx.fillStyle = '#1a2233'; ctx.fillRect(0, 0, cv.width, cv.height);
    for (let y = 0; y < FARM_GRID.h; y++) for (let x = 0; x < FARM_GRID.w; x++) { ctx.fillStyle = ((x + y) & 1) ? hx(G.a) : hx(G.b); ctx.fillRect(ox + x * t, oy + y * t, t, t); }
    if (!view) return;
    FARM_BUILDINGS.forEach(def => {
      const row = view.buildings[def.id];
      if (def.yard && row) { ctx.strokeStyle = '#7a5a3a'; ctx.lineWidth = 3; ctx.strokeRect(ox + def.yard.x * t, oy + def.yard.y * t, def.yard.w * t, def.yard.h * t); }
      ctx.fillStyle = row ? ((view.look && view.look.roofs && view.look.roofs[def.id]) || def.accent) : 'rgba(255,255,255,0.12)';
      ctx.fillRect(ox + def.plot.x * t + 2, oy + def.plot.y * t + 2, def.plot.w * t - 4, def.plot.h * t - 4);
      ctx.fillStyle = '#f4efe4'; ctx.font = Math.floor(t * 0.7) + 'px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(def.emoji, ox + (def.plot.x + def.plot.w / 2) * t, oy + (def.plot.y + def.plot.h / 2) * t);
      ctx.font = Math.floor(t * 0.3) + 'px system-ui'; ctx.fillText(row ? (row.damaged ? '🌪 L' + row.level : 'L' + row.level) : 'build', ox + (def.plot.x + def.plot.w / 2) * t, oy + (def.plot.y + def.plot.h) * t - t * 0.2);
    });
    Object.keys(wanderers).forEach(id => {
      const n = wanderers[id]; n.w.step(dt); const d = animalDef(n.a.sp);
      ctx.font = Math.floor(t * (0.45 + 0.35 * d.size)) + 'px system-ui'; ctx.fillText(d.emoji, ox + n.w.x * t, oy + n.w.z * t);
      if (n.a.prize) { ctx.font = Math.floor(t * 0.35) + 'px system-ui'; ctx.fillText('🏅', ox + n.w.x * t, oy + n.w.z * t - t * 0.45); }
    });
    if (view.weather && (view.weather.key === 'rain' || view.weather.key === 'storm')) { ctx.fillStyle = 'rgba(120,150,200,0.18)'; ctx.fillRect(0, 0, cv.width, cv.height); }
  };
  const frame = (ts) => { if (!alive) return; if (!cv.isConnected) { destroy(); return; } const dt = Math.min(0.1, (ts - last) / 1000); last = ts; draw(dt); rafId = requestAnimationFrame(frame); };
  rafId = requestAnimationFrame(frame);
  const onClick = (e) => {
    const r = cv.getBoundingClientRect(); const px = (e.clientX - r.left) * (cv.width / r.width), py = (e.clientY - r.top) * (cv.height / r.height);
    const { ox, oy, t } = origin(); const gx = (px - ox) / t, gy = (py - oy) / t;
    for (const id of Object.keys(wanderers)) { const n = wanderers[id]; if (Math.hypot(n.w.x - gx, n.w.z - gy) < 0.5) { opts.onSelect && opts.onSelect('animal', n.a.sp); return; } }
    for (const def of FARM_BUILDINGS) { if (gx >= def.plot.x && gx < def.plot.x + def.plot.w && gy >= def.plot.y && gy < def.plot.y + def.plot.h) { opts.onSelect && opts.onSelect('building', def.id); return; } }
  };
  cv.addEventListener('click', onClick);
  const onResize = () => fit(); window.addEventListener('resize', onResize);
  function destroy() { if (!alive) return; alive = false; try { cancelAnimationFrame(rafId); window.removeEventListener('resize', onResize); cv.remove(); } catch (e) {} }
  return { update, destroy, mode: '2d', select: () => {} };
}

async function createScene(container, opts) {
  opts = opts || {};
  if (!opts.prefer2d) {
    const THREE = await ensureThree();
    if (THREE && container.isConnected) {
      try { return build3D(THREE, container, opts); } catch (e) { try { console.warn('[farm] 3D scene failed, falling back to 2D:', e); } catch (x) {} }
    }
  }
  return build2D(container, opts);
}

/* ═══ farm.render.js ═══ */
/* ════════════════════════════════════════════════════════════════════════════
   🐄 HOMESTEAD FARM — the side panel (HTML) beside the 3D homestead.
   ----------------------------------------------------------------------------
   Render functions return HTML strings; index.js owns the DOM, the delegated
   click handler and the scene. No number in here is economic — every price,
   rate and yield is read from FARM_ECON / state at render time.
   Panels: Homestead (buildings) · Livestock (every animal) · Market · Ranch ·
   Shop (the merchant's cart) · Journal (events, town demand, stats) · Athena
   (the look editor).
   🎮 The chrome is Cities: Skylines 2 style (round 5): the 3D homestead
   fills the view, a toolbar of icon buttons sits along the bottom, and each
   button opens ONE floating panel over the scene (press it again, or ✕, to
   close). The old weather/season/defense card is now the HUD button in the
   top-left corner — press it and the Journal opens. `data-fact="tab"` was
   kept as the action name so index.js and the e2e did not have to change
   their vocabulary; only its meaning changed from "switch" to "toggle".
   ════════════════════════════════════════════════════════════════════════════ */





const FARM_CSS = `
.farm-page{position:relative;display:flex;flex-direction:column;height:100dvh;min-height:100vh;background:#0c0f16;color:#e8e2d6;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.farm-top{display:flex;align-items:center;gap:10px;padding:8px 12px;background:linear-gradient(180deg,#151a25,#0f131b);border-bottom:1px solid #2a3140;flex-wrap:wrap}
.farm-top h1{font-size:1.05rem;margin:0;letter-spacing:.04em;color:#f2d98a}
.farm-top .farm-sub{font-size:.75rem;color:#9aa3b5}
.farm-back{background:#1d2431;border:1px solid #3a4457;color:#e8e2d6;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:.85rem}
.farm-back:hover{background:#27303f}
.farm-ledger{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}
.farm-chip{display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:5px;padding:2px 7px;font-size:.78rem;white-space:nowrap}
.farm-chip b{font-weight:700;color:#fff}
.farm-chip.cinder{border-color:#d4af3766;color:#f2d98a}
.farm-chip.wx{border-color:#7fd6ff55}
.farm-body{display:flex;flex:1;min-height:0;position:relative}
.farm-stage{flex:1;min-width:0;position:relative;background:#1a2233}
.farm-stage .farm-hint{position:absolute;left:10px;bottom:76px;font-size:.72rem;color:#c9c3b6;background:rgba(8,10,16,.55);padding:3px 8px;border-radius:5px;pointer-events:none}
/* 🎮 CS2-style HUD: info buttons in the top-left corner of the scene. */
.farm-hud{position:absolute;left:10px;top:10px;display:flex;flex-direction:column;gap:6px;z-index:3;align-items:flex-start}
.farm-hudbtn{display:inline-flex;align-items:center;gap:8px;background:rgba(10,13,20,.82);border:1px solid rgba(255,255,255,.14);color:#e8e2d6;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:.8rem;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);text-align:left}
.farm-hudbtn:hover{border-color:#d4af37aa;background:rgba(20,24,34,.92)}
.farm-hudbtn.is-active{border-color:#d4af37;box-shadow:0 0 0 1px #d4af3755}
.farm-hudbtn .big{font-size:1.25rem;line-height:1}
.farm-hudbtn .col{display:flex;flex-direction:column;line-height:1.2}
.farm-hudbtn .col b{font-size:.82rem;color:#f4efe4}
.farm-hudbtn .col span{font-size:.68rem;color:#9aa3b5}
.farm-hudbtn .sep{width:1px;height:22px;background:rgba(255,255,255,.14)}
.farm-hudbtn.boost{border-color:#8affd655}
/* 🎮 The bottom toolbar: one icon button per panel. */
.farm-bar{position:absolute;left:50%;top:10px;transform:translateX(-50%);display:flex;gap:4px;padding:5px;background:rgba(10,13,20,.9);border:1px solid rgba(255,255,255,.14);border-radius:12px;z-index:4;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);max-width:calc(100% - 20px);overflow-x:auto}
.farm-tab{display:flex;flex-direction:column;align-items:center;gap:2px;min-width:62px;padding:6px 8px;background:none;border:1px solid transparent;border-radius:9px;color:#9aa3b5;cursor:pointer;font-size:.62rem;letter-spacing:.03em;white-space:nowrap;text-transform:uppercase}
.farm-tab .ic{font-size:1.35rem;line-height:1}
.farm-tab:hover{background:rgba(255,255,255,.06);color:#e8e2d6}
.farm-tab.is-active{color:#f2d98a;background:#2a2410;border-color:#d4af37}
.farm-tab .dot{position:absolute;margin-left:34px;margin-top:-2px;width:8px;height:8px;border-radius:50%;background:#8affd6;box-shadow:0 0 6px #8affd6}
/* 🎮 The floating panel a toolbar button opens. */
.farm-panel{position:absolute;right:10px;top:10px;bottom:74px;width:min(440px,46vw);min-width:300px;overflow:auto;background:rgba(16,20,29,.96);border:1px solid #2a3140;border-radius:10px;display:flex;flex-direction:column;z-index:3;box-shadow:0 12px 40px rgba(0,0,0,.45)}
.farm-panel[hidden]{display:none}
.farm-panelhead{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #2a3140;position:sticky;top:0;background:#10141d;z-index:2}
.farm-panelhead h2{margin:0;font-size:.92rem;color:#f2d98a;letter-spacing:.03em;flex:1}
.farm-panelhead .x{background:none;border:1px solid #3a4457;color:#c9c3b6;border-radius:6px;width:26px;height:26px;cursor:pointer;font-size:.9rem}
.farm-panelhead .x:hover{background:#27303f;color:#fff}
.farm-stage .farm-banner{position:absolute;left:50%;top:12px;transform:translateX(-50%);background:rgba(8,10,16,.8);border:1px solid #d4af37aa;color:#f4efe4;padding:8px 14px;border-radius:8px;font-size:.85rem;max-width:80%;text-align:center;pointer-events:none;animation:farmBanner .5s ease-out}
@keyframes farmBanner{from{opacity:0;transform:translate(-50%,-8px)}to{opacity:1;transform:translate(-50%,0)}}
.farm-cards{padding:10px;display:flex;flex-direction:column;gap:10px}
.farm-card{background:#151b26;border:1px solid #2a3140;border-radius:8px;padding:10px;border-left:3px solid var(--accent,#d4af37)}
.farm-card.is-focus{box-shadow:0 0 0 2px #d4af3788}
.farm-card.is-damaged{border-color:#e0556a88;background:#1c1418}
.farm-card h3{margin:0 0 3px;font-size:.95rem;display:flex;align-items:center;gap:6px}
.farm-card h3 .lv{margin-left:auto;font-size:.72rem;color:#9aa3b5;font-weight:400}
.farm-card p{margin:0 0 8px;font-size:.78rem;color:#b3bccb;line-height:1.35}
.farm-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:5px 0;font-size:.8rem}
.farm-row .k{color:#9aa3b5}
.farm-meter{height:6px;background:#0c0f16;border-radius:3px;overflow:hidden;flex:1;min-width:60px}
.farm-meter i{display:block;height:100%;background:#8fc46a}
.farm-meter i.low{background:#e0a060}.farm-meter i.empty{background:#e0556a}
.farm-btn{background:#1d2431;border:1px solid #3a4457;color:#e8e2d6;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:.8rem}
.farm-btn:hover:not(:disabled){background:#27303f}
.farm-btn:disabled{opacity:.45;cursor:not-allowed}
.farm-btn:focus-visible,.farm-tab:focus-visible,.farm-back:focus-visible{outline:2px solid #f2d98a;outline-offset:1px}
.farm-btn.primary{background:#5a4a1e;border-color:#d4af37;color:#f8e8b0}
.farm-btn.primary:hover:not(:disabled){background:#6e5a24}
.farm-btn.danger{background:#4a1e24;border-color:#b8404a;color:#f8c0c8}
.farm-btn.danger:hover:not(:disabled){background:#5e2630}
.farm-btn.tiny{padding:2px 7px;font-size:.72rem}
.farm-cost{display:flex;gap:4px;flex-wrap:wrap;margin:4px 0 8px}
.farm-cost .c{display:inline-flex;align-items:center;gap:3px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:4px;padding:1px 6px;font-size:.75rem;white-space:nowrap}
.farm-cost .c.short{color:#e0556a;border-color:#e0556a66}
.farm-yield{display:flex;gap:4px;flex-wrap:wrap}
.farm-empty{padding:16px;color:#9aa3b5;font-size:.82rem;text-align:center}
.farm-onboard{margin:10px;padding:10px;border:1px dashed #d4af3766;border-radius:8px;font-size:.8rem;color:#e8e2d6;background:#1a1a12}
.farm-onboard b{color:#f2d98a}
.farm-toastline{font-size:.74rem;color:#9aa3b5;margin-top:4px}
.farm-select{background:#0c0f16;border:1px solid #3a4457;color:#e8e2d6;border-radius:5px;padding:3px 6px;font-size:.78rem}
.farm-input{background:#0c0f16;border:1px solid #3a4457;color:#e8e2d6;border-radius:5px;padding:4px 7px;font-size:.8rem;min-width:0}
.farm-beast{display:grid;grid-template-columns:auto 1fr auto;gap:6px 10px;align-items:center;padding:7px 8px;border-top:1px solid #1e2532;font-size:.78rem}
.farm-beast:first-of-type{border-top:none}
.farm-beast.is-sick{background:#1c1418}
.farm-beast .nm{font-weight:700;color:#f4efe4;display:flex;gap:5px;align-items:center;flex-wrap:wrap}
.farm-beast .nm .tag{font-size:.66rem;padding:0 5px;border-radius:3px;background:#2a3140;color:#c9c3b6;font-weight:400}
.farm-beast .nm .tag.prize{background:#5a4a1e;color:#f8e8b0}.farm-beast .nm .tag.rare{background:#2a4a3a;color:#8affd6}.farm-beast .nm .tag.guard{background:#2a3350;color:#a8c0ff}.farm-beast .nm .tag.young{background:#3a3a2a;color:#e8dcc0}
.farm-beast .st{display:flex;gap:8px;flex-wrap:wrap;color:#9aa3b5}
.farm-beast .st b{color:#e8e2d6;font-weight:600}
.farm-beast .hp{display:flex;align-items:center;gap:6px;min-width:120px}
.farm-beast .acts{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}
.farm-journal{display:flex;flex-direction:column;gap:6px;padding:0 10px 10px}
.farm-entry{display:grid;grid-template-columns:auto 1fr;gap:8px;padding:7px 9px;background:#151b26;border:1px solid #2a3140;border-radius:6px;font-size:.78rem;line-height:1.35}
.farm-entry .ic{font-size:1.1rem}
.farm-entry .when{color:#9aa3b5;font-size:.7rem;margin-top:2px}
.farm-entry.raid,.farm-entry.wolves,.farm-entry.fox,.farm-entry.hawk,.farm-entry.death{border-left:3px solid #b8404a}
.farm-entry.birth,.farm-entry.gift,.farm-entry.repair,.farm-entry.tend{border-left:3px solid #8fc46a}
.farm-entry.ufo{border-left:3px solid #8affd6}.farm-entry.storm{border-left:3px solid #7fd6ff}.farm-entry.ship,.farm-entry.build{border-left:3px solid #d4af37}
.farm-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:0 10px 10px}
.farm-stat{background:#151b26;border:1px solid #2a3140;border-radius:6px;padding:6px 8px;text-align:center}
.farm-stat b{display:block;font-size:1.1rem;color:#f4efe4;font-variant-numeric:tabular-nums}
.farm-stat span{font-size:.68rem;color:#9aa3b5;letter-spacing:.03em;text-transform:uppercase}
.farm-swatches{display:flex;gap:6px;flex-wrap:wrap}
.farm-swatch{width:34px;height:26px;border-radius:5px;border:2px solid transparent;cursor:pointer;padding:0}
.farm-swatch.is-on{border-color:#f2d98a}
.farm-check{display:inline-flex;align-items:center;gap:5px;font-size:.78rem;background:#1d2431;border:1px solid #3a4457;border-radius:6px;padding:4px 8px;cursor:pointer}
.farm-check.is-on{border-color:#d4af37;color:#f8e8b0}
.farm-roofs{display:grid;grid-template-columns:1fr auto auto;gap:4px 8px;align-items:center;font-size:.78rem}
.farm-beast .nm .tag.ill{background:#4a1e24;color:#f8c0c8}.farm-beast .nm .tag.royal{background:#5a4a1e;color:#ffe08a}.farm-beast .nm .tag.mythic{background:#4a2a5a;color:#e8c0ff}.farm-beast .nm .tag.away{background:#2a3350;color:#a8c0ff}
.farm-ring{background:#0c0f16;border:1px solid #d4af3755;border-radius:8px;padding:8px 10px;margin:6px 0}
.farm-ring .ath{font-style:italic;color:#f2d98a;font-size:.8rem;margin-bottom:6px}
.farm-bid{display:flex;justify-content:space-between;gap:8px;font-size:.78rem;padding:3px 0;border-top:1px solid #1e2532}
.farm-bid:first-of-type{border-top:none}
.farm-bid.you{color:#8affd6}
.farm-coll{display:grid;grid-template-columns:repeat(5,1fr);gap:5px}
.farm-coll .b{background:#0c0f16;border:1px solid #2a3140;border-radius:6px;padding:6px 4px;text-align:center;font-size:.68rem;color:#9aa3b5}
.farm-coll .b.on{border-color:#d4af37;color:#f4efe4}
.farm-coll .b i{display:block;width:18px;height:18px;border-radius:50%;margin:0 auto 3px;border:1px solid #0008}
/* 🛒 Shop */
.farm-shopitem{display:grid;grid-template-columns:auto 1fr auto;gap:6px 10px;align-items:center;padding:8px;border-top:1px solid #1e2532}
.farm-shopitem:first-of-type{border-top:none}
.farm-shopitem .ic{font-size:1.5rem;line-height:1}
.farm-shopitem .nm{font-weight:700;color:#f4efe4;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.farm-shopitem .nm .tag{font-size:.66rem;padding:0 5px;border-radius:3px;background:#2a3140;color:#c9c3b6;font-weight:400}
.farm-shopitem .nm .tag.on{background:#1e4a3a;color:#8affd6}.farm-shopitem .nm .tag.own{background:#5a4a1e;color:#f8e8b0}
.farm-shopitem .bl{font-size:.75rem;color:#b3bccb;line-height:1.3}
.farm-shopitem .fx{font-size:.72rem;color:#8affd6}
.farm-shopitem .farm-cost{margin:3px 0 0}
.farm-boostbar{height:4px;background:#0c0f16;border-radius:2px;overflow:hidden;margin-top:3px}
.farm-boostbar i{display:block;height:100%;background:#8affd6}
.farm-grade{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}
.farm-grade .g{background:#0c0f16;border:1px solid #2a3140;border-radius:6px;padding:6px 4px;text-align:center;font-size:.68rem;color:#9aa3b5}
.farm-grade .g b{display:block;font-size:1rem;color:#f4efe4}
@media (max-width:760px){.farm-panel{left:0;right:0;top:auto;bottom:0;width:auto;min-width:0;max-height:56vh;border-radius:10px 10px 0 0}.farm-bar{top:4px;bottom:auto;gap:1px;padding:3px}.farm-tab{min-width:44px;padding:4px 3px;font-size:.5rem}.farm-tab .ic{font-size:1.2rem}.farm-hud{top:64px;left:6px}.farm-beast{grid-template-columns:1fr auto}.farm-beast .hp{grid-column:1/-1}.farm-stage .farm-hint{display:none}}
@media (prefers-reduced-motion:reduce){.farm-stage .farm-banner{animation:none}}
`;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n | 0).toLocaleString();
const hrs = (h) => !isFinite(h) ? '∞' : (h >= 48 ? Math.round(h / 24) + 'd' : h >= 1 ? Math.round(h) + 'h' : Math.max(0, Math.round(h * 60)) + 'm');
const hex6 = (n) => '#' + (n | 0).toString(16).padStart(6, '0');
const ago = (t) => { const m = Math.max(0, Date.now() - t) / 60000; return m < 1 ? 'just now' : m < 60 ? Math.floor(m) + 'm ago' : m < 1440 ? Math.floor(m / 60) + 'h ago' : Math.floor(m / 1440) + 'd ago'; };

function costHtml(host, cost) {
  if (!cost) return '';
  return '<div class="farm-cost">' + Object.keys(cost).map(k => {
    const n = cost[k] | 0; if (!n) return '';
    if (k === 'cinder') return `<span class="c ${host.gems() < n ? 'short' : ''}">🔥 <b>${fmt(n)}</b> Cinder</span>`;
    const m = host.resMeta(k);
    return `<span class="c ${host.getRes(k) < n ? 'short' : ''}" title="${esc(m.name)}">${m.icon} <b>${fmt(n)}</b> ${esc(m.name)}</span>`;
  }).join('') + '</div>';
}
function yieldHtml(host, map, perH) {
  const keys = Object.keys(map || {}).filter(k => map[k] > 0);
  if (!keys.length) return '<span class="k">—</span>';
  return '<span class="farm-yield">' + keys.map(k => { const m = host.resMeta(k); const v = perH ? (Math.round(map[k] * 100) / 100) + '/h' : fmt(map[k]); return `<span class="c farm-chip" title="${esc(m.name)}">${m.icon} ${v} ${esc(m.name)}</span>`; }).join('') + '</span>';
}
function scale(map, mul) { const o = {}; Object.keys(map).forEach(k => { o[k] = Math.round(map[k] * mul); }); return o; }

function renderLedger(host, view) {
  const ids = ['animalFeed', 'eggs', 'feathers', 'rawMilk', 'meat', 'wool', 'hide', 'leather', 'fertilizer', 'livestock', 'food', 'cloth'];
  // ⭐ Grade-2 goods only take a chip once the farm holds some (a new farm has no reason to see four zeros).
  const prem = Object.values(FARM_ECON.premium.goods).filter(id => host.getRes(id) > 0);
  // 🎮 Weather / season / defense moved to the HUD button over the scene (CS2 chrome); the ledger is just the ledger.
  return `<span class="farm-chip cinder">🔥 <b>${fmt(host.gems())}</b></span>` + ids.map(id => { const m = host.resMeta(id); return `<span class="farm-chip" title="${esc(m.name)}">${m.icon} <b>${fmt(host.getRes(id))}</b></span>`; }).join('')
    + prem.map(id => { const m = host.resMeta(id); return `<span class="farm-chip" style="border-color:#f2d98a66" title="${esc(m.name)} (grade-2)">⭐${m.icon} <b>${fmt(host.getRes(id))}</b></span>`; }).join('');
}

/* ── Homestead tab ──────────────────────────────────────────────────────── */
function renderHomestead(host, s, view, focus, ui) {
  const now = Date.now();
  const cards = FARM_BUILDINGS.map(def => {
    const b = s.buildings[def.id];
    const cls = 'farm-card' + (focus === def.id ? ' is-focus' : '') + (b && b.damaged ? ' is-damaged' : '');
    if (!b) {
      const cost = buildingCostAt(def, 1);
      const affordable = Object.keys(cost).every(k => k === 'cinder' ? host.gems() >= cost[k] : host.getRes(k) >= cost[k]);
      return `<div class="${cls}" style="--accent:${def.accent}" data-fid="${def.id}">
        <h3>${def.emoji} ${esc(def.name)}<span class="lv">not built</span></h3>
        <p>${esc(def.desc)}</p>${costHtml(host, cost)}
        <button class="farm-btn primary" data-fact="build" data-id="${def.id}" ${affordable ? '' : 'disabled'}>🔨 Build</button>
      </div>`;
    }
    const pen = view.pens.find(p => p.id === def.id);
    let body = '';
    const prog = view.construction.find(c => c.id === def.id);
    if (prog) {
      const pr = prog.progress;
      body += `<div class="farm-row"><span class="k">${pr.upgrading ? '⬆ Upgrading to level ' + pr.toLevel : '🏗 Under construction'}</span><span class="farm-meter"><i style="width:${pr.pct}%;background:#d4af37"></i></span><b>${hrs(pr.left / 3600000)} left</b></div>
        <div class="farm-row"><button class="farm-btn" data-fact="rush" data-id="${def.id}" ${host.gems() >= prog.rush ? '' : 'disabled'} title="Pay the crews to finish now">⚡ Rush · 🔥${fmt(prog.rush)}</button>${view.builders ? `<span class="k">👷 ${view.builders} Builder${view.builders === 1 ? '' : 's'} · −${Math.round(view.buildersBonus * 100)}% build time</span>` : '<span class="k">Hire Builders on the Employment Board to build faster.</span>'}</div>`;
      if (!pr.upgrading) {
        return `<div class="${cls}" style="--accent:${def.accent}" data-fid="${def.id}"><h3>${def.emoji} ${esc(def.name)}<span class="lv">building…</span></h3><p>${esc(def.desc)}</p>${body}</div>`;
      }
    }
    if (b.damaged) body += `<div class="farm-row" style="color:#f8c0c8">🌪 Roof torn off — nothing here produces or breeds until it is repaired.</div>${costHtml(host, FARM_ECON.events.storm.repair)}<div class="farm-row"><button class="farm-btn primary" data-fact="repair" data-id="${def.id}">🔨 Repair</button></div>`;
    if (pen) {
      const pct = pen.troughCap ? Math.min(100, Math.round(pen.feed / pen.troughCap * 100)) : 0;
      const ready = now >= pen.readyAt, hasPending = Object.keys(pen.pending).length > 0;
      const wait = ready ? '' : ` (${hrs((pen.readyAt - now) / 3600000)} left)`;
      const isGuardPost = def.id === 'guardpost';
      body += `
        <div class="farm-row"><span class="k">${isGuardPost ? 'Guards' : 'Herd'}</span><b>${pen.herd}/${pen.capacity}</b><span class="k">· ${pen.adults} grown, ${pen.herd - pen.adults} young${pen.inTransit ? ` · 🚚 ${pen.inTransit} on the road` : ''}</span>${def.id === 'pasture' ? `<span class="k">· ground ${esc(view.terroir.toLowerCase())}</span>` : ''}</div>
        <div class="farm-row"><span class="k">Trough</span><span class="farm-meter"><i class="${pen.feed <= 0 ? 'empty' : pct < 25 ? 'low' : ''}" style="width:${pct}%"></i></span><b>${pen.feed}/${pen.troughCap}</b><span class="k">· ${pen.herd ? hrs(pen.hoursLeft) + ' of feed' : 'no animals'}</span></div>
        <div class="farm-row"><span class="k">Defense</span><b>🛡 ${Math.round(pen.defense * 10) / 10}</b><span class="k">· guards + fence (level ${b.level})</span></div>
        <div class="farm-row"><span class="k">Yield</span>${yieldHtml(host, pen.ratePerH, true)}</div>
        <div class="farm-row"><span class="k">Ready</span>${yieldHtml(host, pen.pending)}</div>
        <div class="farm-row">
          <button class="farm-btn" data-fact="feed" data-id="${def.id}" title="Move Animal Feed from your stash into the trough">🌾 Fill trough</button>
          <button class="farm-btn primary" data-fact="collect" data-id="${def.id}" ${(ready && hasPending) ? '' : 'disabled'}>🧺 Collect${wait}</button>
        </div>
        <div class="farm-row">${(def.houses || []).map(sp => { const a = animalDef(sp), e = FARM_ECON.animals[sp]; const fee = shipFee(carrierById(host, ui && ui.carrier), sp, 1); return `<button class="farm-btn" data-fact="buy" data-id="${sp}" ${pen.herd + pen.inTransit >= pen.capacity || host.gems() < e.cinder + fee ? 'disabled' : ''} title="${esc(a.desc)} · haulage ${fmt(fee)}">${a.emoji} ${esc(a.name)} · 🔥${fmt(e.cinder + fee)}${e.defense ? ' · 🛡' + e.defense : ''}</button>`; }).join('')}</div>
        <div class="farm-toastline">Prices include haulage by ${esc(carrierById(host, ui && ui.carrier).name)} — change the carrier on the Livestock tab.</div>`;
    } else if (def.role === 'feed') {
      const r = FARM_ECON.feedMillRecipe, mul = 1 + FARM_ECON.recipeBonusPerLevel * (b.level - 1);
      body += `<div class="farm-row"><span class="k">Grind</span>${yieldHtml(host, r.inputs)}<span class="k">→</span>${yieldHtml(host, scale(r.output, mul))}</div>
        <div class="farm-row"><button class="farm-btn primary" data-fact="craft" data-id="feedmill" data-recipe="feed" data-n="1">Grind ×1</button><button class="farm-btn" data-fact="craft" data-id="feedmill" data-recipe="feed" data-n="5">×5</button><button class="farm-btn" data-fact="craft" data-id="feedmill" data-recipe="feed" data-n="999">Max</button></div>
        ${view.farmers ? `<div class="farm-row"><span class="k">👷 ${view.farmers} Farmer${view.farmers === 1 ? '' : 's'}</span><span>top up troughs from the stash · +${Math.round(view.farmersBonus * 100)}% yield</span></div>` : '<div class="farm-toastline">Hire Farmers on the Employment Board and they will keep the troughs topped up.</div>'}`;
    } else if (def.role === 'slaughter') {
      const mul = 1 + FARM_ECON.butcherBonusPerLevel * (b.level - 1);
      body += `<div class="farm-row"><span class="k">Yield bonus</span><b>+${Math.round((mul - 1) * 100)}%</b><span class="k">· ${b.level >= 2 ? 'trophy cut unlocked' : 'level 2 unlocks the trophy cut'}</span></div>
        <div class="farm-row"><button class="farm-btn" data-fact="tab" data-id="livestock">🔪 Open Livestock</button></div>`;
    } else if (def.role === 'craft') {
      const mul = 1 + FARM_ECON.recipeBonusPerLevel * (b.level - 1);
      body += (def.recipes || []).map(rk => { const r = FARM_ECON.recipes[rk]; return `<div class="farm-row"><span class="k">${esc(RECIPE_LABELS[rk] || rk)}</span></div>
        <div class="farm-row">${yieldHtml(host, r.inputs)}<span class="k">→</span>${yieldHtml(host, scale(r.output, mul))}</div>
        <div class="farm-row"><button class="farm-btn primary" data-fact="craft" data-id="${def.id}" data-recipe="${rk}" data-n="1">Make ×1</button><button class="farm-btn" data-fact="craft" data-id="${def.id}" data-recipe="${rk}" data-n="999">Max</button></div>`; }).join('');
    }
    let up = '';
    if (b.level < def.maxLevel) {
      const cost = buildingCostAt(def, b.level + 1);
      up = `<details style="margin-top:6px"><summary style="cursor:pointer;font-size:.78rem;color:#9aa3b5">⬆ Upgrade to level ${b.level + 1}${def.houses ? ' (bigger pen, stouter fence)' : ''}</summary>${costHtml(host, cost)}<button class="farm-btn" data-fact="upgrade" data-id="${def.id}">⬆ Upgrade</button></details>`;
    }
    return `<div class="${cls}" style="--accent:${def.accent}" data-fid="${def.id}">
      <h3>${def.emoji} ${esc(def.name)}<span class="lv">Level ${b.level}/${def.maxLevel}</span></h3>
      <p>${esc(def.desc)}</p>${body}${up}</div>`;
  }).join('');
  const onboard = !s.buildings.feedmill
    ? `<div class="farm-onboard"><b>Start here.</b> Build the <b>Feed Mill</b> first — nothing on the homestead eats or produces without Animal Feed. Then put up a pen, buy stock, fill the trough and come back to collect. Put up a <b>Guard Post</b> before the foxes find you.</div>` : '';
  return onboard + `<div class="farm-cards">${cards}</div>`;
}

/* ── Livestock tab: species cards + every animal ───────────────────────── */
function renderLivestock(host, s, view, focus, ui) {
  const butcher = s.buildings.butcher;
  const cut = (ui && ui.cut) || 'balanced';
  const cutOpts = Object.keys(FARM_ECON.cuts).map(k => { const c = FARM_ECON.cuts[k]; const locked = !butcher || butcher.level < c.minLevel; return `<option value="${k}" ${k === cut ? 'selected' : ''} ${locked ? 'disabled' : ''}>${esc(c.label)}${locked ? ' (L' + c.minLevel + ')' : ''}</option>`; }).join('');
  const carrier = carrierById(host, ui && ui.carrier);
  const carrierOpts = view.carriers.map(c => `<option value="${c.id}" ${c.id === carrier.id ? 'selected' : ''}>${c.emoji} ${esc(c.name)} · ${Math.round(c.hours * 60)} min · ${c.risk ? Math.round(c.risk * 100) + '% risk' : 'no risk'}${c.insured ? ' · ' + Math.round(c.insured * 100) + '% insured' : ''}${c.feeBase ? ' · from 🔥' + fmt(c.feeBase) : ' · free'}</option>`).join('');
  const roads = view.shipments.length ? view.shipments.map(x => { const a = animalDef(x.sp); return `<div class="farm-row"><span>${a.emoji} ${x.n} ${esc(x.n === 1 ? a.name : a.plural)}</span><span class="farm-meter"><i style="width:${Math.round(x.progress * 100)}%;background:#7fd6ff"></i></span><b>${hrs(Math.max(0, x.arriveAt - Date.now()) / 3600000)}</b><span class="k">· ${esc(x.label)}</span></div>`; }).join('') : '';
  const transport = `<div class="farm-card" style="--accent:#7fd6ff"><h3>🚚 Haulage<span class="lv">${view.shipments.length ? view.shipments.length + ' on the road' : 'nothing on the road'}</span></h3>
    <p>Bought stock is hauled in from market. Pick who drives: cheap and risky, insured, armoured — or your own rig if you own one.</p>
    <div class="farm-row"><select class="farm-select" data-fsel="carrier" style="max-width:100%">${carrierOpts}</select></div>
    <div class="farm-toastline">${esc(carrier.blurb || '')}</div>
    <div class="farm-row"><span class="k">🐕 Escort</span><select class="farm-select" data-fsel="escort"><option value="">none</option>${view.escorts.map(g => `<option value="${g.id}" ${ui && (ui.escort | 0) === g.id ? 'selected' : ''}>${animalDef(g.sp).emoji} ${esc(g.name)} · 🛡${g.defense} · risk ×${Math.max(FARM_ECON.escort.minRiskMul, 1 - g.defense / FARM_ECON.escort.div).toFixed(2)}</option>`).join('')}</select><span class="k">rides with the next order; the pens lose that guard until it is back</span></div>
    ${view.holding.length ? `<div class="farm-row" style="color:#e0a060">🚧 ${view.holding.map(a => esc(a.name)).join(', ')} waiting at the gate — make room in the pen.</div>` : ''}${roads}</div>`;
  const header = transport + `<div class="farm-card" style="--accent:#b8404a"><h3>🔪 The block<span class="lv">${butcher ? 'Level ' + butcher.level : 'not built'}</span></h3>
    <div class="farm-row"><span class="k">Cut</span><select class="farm-select" data-fsel="cut">${cutOpts}</select><span class="k">${esc(cutBlurb(cut))}</span></div>
    <div class="farm-row"><span class="k">Season</span><b>${view.season.icon} ${esc(view.season.label)}</b><span class="k">· meat ×${view.season.meatMul} · breeding ×${view.season.breedMul} · feed ×${view.season.feedMul}</span></div>
    ${host.getRes('livestock') > 0 ? `<div class="farm-row"><span class="k">📦 ${host.getRes('livestock')} crate${host.getRes('livestock') === 1 ? '' : 's'}</span>${FARM_ANIMALS.filter(a => !a.guard).map(a => { const c = uncrateCost(a.id); const pen = s.buildings[a.pen]; return `<button class="farm-btn tiny" data-fact="uncrate" data-id="${a.id}" ${pen && host.gems() >= c.cinder ? '' : 'disabled'} title="1 crate + 🔥${fmt(c.cinder)}">Uncrate ${a.emoji}</button>`; }).join('')}</div>` : ''}
  </div>`;
  const cards = FARM_ANIMALS.map(a => {
    const pen = buildingDef(a.pen), penRow = s.buildings[a.pen], e = FARM_ECON.animals[a.id];
    const list = view.animals.filter(x => x.sp === a.id).sort((x, y) => y.ageH - x.ageH);
    const adults = list.filter(x => x.adult).length;
    const penView = view.pens.find(p => p.id === a.pen);
    const room = penRow && penView ? penView.capacity - penView.herd - penView.inTransit : 0;
    const fee1 = shipFee(carrier, a.id, 1), feeAll = shipFee(carrier, a.id, Math.max(1, room));
    const penReady = !!(penView && penView.ready);
    const sl = FARM_ECON.slaughter[a.id];
    const mul = (butcher ? 1 + FARM_ECON.butcherBonusPerLevel * (butcher.level - 1) : 1);
    const per = {}; if (sl) Object.keys(sl).forEach(k => { per[k] = Math.max(1, Math.round(sl[k] * mul * (k === 'meat' ? FARM_ECON.cuts[cut].meat * view.season.meatMul : k === 'hide' ? FARM_ECON.cuts[cut].hide : FARM_ECON.cuts[cut].other))); });
    const rows = list.map(x => {
      const hpc = x.health < FARM_ECON.health.sickBelow ? 'empty' : x.health < 60 ? 'low' : '';
      const tags = [x.prize ? '<span class="tag prize">🏅 prize</span>' : '', x.breedLabel ? `<span class="tag ${x.tier === 'royal' ? 'royal' : x.tier === 'mythic' ? 'mythic' : 'rare'}">${x.tier === 'mythic' ? '🌟' : x.tier === 'royal' ? '👑' : '✨'} ${esc(x.breedLabel)}</span>` : '', x.guard ? `<span class="tag guard">🛡 ${e.defense}</span>` : '', x.away ? '<span class="tag away">🚚 escorting</span>' : '', !x.adult ? '<span class="tag young">young</span>' : '', x.illLabel ? `<span class="tag ill">🦠 ${esc(x.illLabel)}</span>` : (x.sick ? '<span class="tag ill">sick</span>' : '')].join('');
      const grow = x.adult ? '' : ` · grown in ${hrs(Math.max(0, e.growH - x.grownH))} fed`;
      return `<div class="farm-beast ${x.sick ? 'is-sick' : ''}" data-aid="${x.id}">
        <div class="nm">${a.emoji} ${esc(x.name)}${tags}<button class="farm-btn tiny" data-fact="rename" data-id="${x.id}" title="Rename">✎</button></div>
        <div class="st"><span>⚖ <b>${x.weight} kg</b></span><span>🎂 <b>${ageLabel(x.ageH)}</b>${grow}</span><span class="hp">❤ <span class="farm-meter"><i class="${hpc}" style="width:${Math.round(x.health)}%"></i></span><b>${Math.round(x.health)}</b></span></div>
        <div class="acts">
          ${x.ill ? `<button class="farm-btn tiny primary" data-fact="treat" data-id="${x.id}" ${host.getRes('medicine') >= FARM_ECON.disease.handCure.medicine ? '' : 'disabled'} title="${FARM_ECON.disease.handCure.medicine} medicine → cured">💊 Cure</button>` : x.health < 100 ? `<button class="farm-btn tiny" data-fact="treat" data-id="${x.id}" ${host.getRes('medicine') >= 1 ? '' : 'disabled'} title="1 medicine → +${FARM_ECON.health.treatHeal} health">💊 Treat</button>` : ''}
          ${!x.guard && x.adult && !x.ill && !x.sick && (x.tier || x.prize) && view.auction.ringReady ? `<button class="farm-btn tiny" data-fact="consign" data-id="${x.id}" ${view.auction.open ? '' : 'disabled'} title="Sale Ring · value ${fmt(x.value)}${view.auction.open ? '' : ' · opens ' + new Date(view.auction.next).toLocaleString()}">🏛 Ring</button><button class="farm-btn tiny" data-fact="p2p-post" data-id="${x.id}" title="List for other players (Cinder) · value ${fmt(x.value)}">🌐 List</button>` : ''}
          ${x.adult && !x.sick ? `<button class="farm-btn tiny" data-fact="crate" data-id="${x.id}" title="Crate for the Exchange (1 livestock)">📦</button>` : ''}
          ${!x.guard && x.adult ? `<button class="farm-btn tiny danger" data-fact="slaughter-one" data-id="${x.id}" ${butcher ? '' : 'disabled'} title="To the block">🔪</button>` : ''}
        </div>
      </div>`;
    }).join('');
    return `<div class="farm-card ${focus === a.id ? 'is-focus' : ''}" style="--accent:${hex6(a.colors.accent)}" data-fid="${a.id}">
      <h3>${a.emoji} ${esc(a.plural)}<span class="lv">${list.length} owned · ${adults} grown</span></h3>
      <p>${esc(a.desc)}</p>
      <div class="farm-row"><span class="k">Pen</span><b>${pen.emoji} ${esc(pen.name)}</b>${penRow ? (penReady ? `<span class="k">· ${room} free${penView.inTransit ? ' · 🚚 ' + penView.inTransit + ' on the road' : ''}</span>` : '<span class="k" style="color:#e0a060">· under construction</span>') : '<span class="k" style="color:#e0a060">· not built</span>'}</div>
      <div class="farm-row"><span class="k">Eats</span><b>${Math.round(e.feedPerH * view.season.feedMul * (a.ground ? 100 : 100)) / 100} feed/h${a.ground ? ' (grazes)' : ''}</b><span class="k">· grows in ${e.growH} fed hours · ${e.adultWeight} kg grown</span></div>
      ${a.guard ? `<div class="farm-row"><span class="k">Defense</span><b>🛡 ${e.defense}</b><span class="k">· halves when hurt (below ${FARM_ECON.health.guardHalfBelow} health)</span></div>` : `<div class="farm-row"><span class="k">Alive gives</span>${yieldHtml(host, FARM_ECON.yieldsPerH[a.id], true)}</div>
      <div class="farm-row"><span class="k">Slaughter gives</span>${yieldHtml(host, per)}<span class="k">· at grown weight</span></div>`}
      <div class="farm-row">
        <button class="farm-btn" data-fact="buy" data-id="${a.id}" data-n="1" ${!penReady || room < 1 || host.gems() < e.cinder + fee1 ? 'disabled' : ''} title="🔥${fmt(e.cinder)} + haulage 🔥${fmt(fee1)} · ${Math.round(carrier.hours * 60)} min">Order 1 · 🔥${fmt(e.cinder + fee1)}</button>
        ${a.guard ? '' : `<button class="farm-btn" data-fact="buy" data-id="${a.id}" data-n="${Math.max(1, room)}" ${!penReady || room < 2 || host.gems() < e.cinder * room + feeAll ? 'disabled' : ''} title="one shipment, one haulage fee">Fill pen (${Math.max(0, room)}) · 🔥${fmt(e.cinder * Math.max(0, room) + feeAll)}</button>
        <button class="farm-btn danger" data-fact="slaughter" data-id="${a.id}" data-n="${adults}" ${!butcher || adults < 2 ? 'disabled' : ''}>🔪 All grown (${adults})</button>`}
      </div>
      ${list.length ? `<div style="margin-top:6px;border:1px solid #1e2532;border-radius:6px;overflow:hidden">${rows}</div>` : ''}
    </div>`;
  }).join('');
  return `<div class="farm-cards">${header}${cards}</div>`;
}
function cutBlurb(k) {
  return { balanced: 'everything the beast has', meat: 'more meat, half the hide', hide: 'more hide, less meat', trophy: 'less of all, chance of a Memory Shard' }[k] || '';
}

/* ── Journal tab ────────────────────────────────────────────────────────── */
function renderJournal(host, s, view) {
  const t = view.town;
  const canGive = Object.keys(t.give).every(k => host.getRes(k) >= t.give[k]);
  const stats = view.stats;
  const S = (k, label) => `<div class="farm-stat"><b>${fmt(stats[k])}</b><span>${label}</span></div>`;
  const entries = view.journal.length ? view.journal.map(j => `<div class="farm-entry ${esc(j.kind)}"><div class="ic">${j.icon}</div><div>${esc(j.text)}<div class="when">${ago(j.t)}</div></div></div>`).join('')
    : '<div class="farm-empty">Nothing has happened yet. Stock the pens and the story starts — births, raids, foxes, storms, and the odd light in the sky.</div>';
  return `<div class="farm-cards">
    <div class="farm-card" style="--accent:#7fd6ff"><h3>${view.weather.icon} ${esc(view.weather.label)} · ${view.season.icon} ${esc(view.season.label)}<span class="lv">ground: ${esc(view.terroir.toLowerCase())}</span></h3>
      <p>${esc(weatherBlurb(view.weather.key))} ${esc(seasonBlurb(view.season.key))}</p>
      <div class="farm-row"><span class="k">Defense</span><b>🛡 ${Math.round(view.guardDefense)}</b><span class="k">from guards · each pen level adds ${FARM_ECON.fenceDefensePerLevel} · raids roll ${FARM_ECON.events.raid.strength[0]}–${FARM_ECON.events.raid.strength[1]}, wolves ${FARM_ECON.events.wolves.strength[0]}–${FARM_ECON.events.wolves.strength[1]}</span></div>
    </div>
    <div class="farm-card" style="--accent:#d4af37"><h3>🏘 Town demand<span class="lv">${t.left}/${FARM_ECON.townDemand.perDay} deliveries left today</span></h3>
      <p>The town posts one want a day and pays in goods, never Cinder.</p>
      <div class="farm-row">${yieldHtml(host, t.give)}<span class="k">→</span>${yieldHtml(host, t.get)}</div>
      <div class="farm-row"><button class="farm-btn primary" data-fact="deliver" ${canGive && t.left > 0 ? '' : 'disabled'}>🚚 Deliver</button></div>
    </div>
  </div>
  <div class="farm-stats">${S('births', 'Births')}${S('slaughtered', 'Butchered')}${S('meat', 'Meat')}${S('raidsRepelled', 'Raids beaten')}${S('raidsLost', 'Raids lost')}${S('predatorsRepelled', 'Predators beaten')}${S('lost', 'Stock lost')}${S('died', 'Died')}${S('returned', 'UFO returns')}${S('shipped', 'Hauled in')}${S('lostInTransit', 'Lost on road')}${S('built', 'Built')}</div>
  <div class="farm-journal">${entries}</div>`;
}
function weatherBlurb(k) {
  return { clear: 'Clear skies. Nothing unusual.', cloud: 'Overcast. The animals do not care.', rain: 'Rain: the grass grows and the pasture trough fills itself a little.', storm: 'Storm: hens stop laying and roofs are at risk.', fog: 'Fog: raiders love it. Defense matters tonight.' }[k] || '';
}
function seasonBlurb(k) {
  return { spring: 'Spring: breeding doubles.', summer: 'Summer: grazing is cheap.', autumn: 'Autumn: the cull season — meat yields +15%, feed a little dearer.', winter: 'Winter: feed costs double and little is born.' }[k] || '';
}

/* ── HUD (top-left of the scene): the weather / season / defense button ─── */
/* 🕒 "14:05 · city time" — the clock the sky follows. */
function fmtCityHour(h) { const hh = Math.floor(h) % 24, mm = Math.floor((h - Math.floor(h)) * 60); return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ' city time'; }
function renderHud(host, view, tab) {
  const boosts = (view.shop && view.shop.active) || [];
  const soon = boosts.filter(b => !b.permanent).sort((a, b) => a.expiresAt - b.expiresAt)[0];
  const under = view.construction.length;
  return `<button class="farm-hudbtn ${tab === 'journal' ? 'is-active' : ''}" data-fact="tab" data-id="journal" title="Weather, season, defense — open the Journal">
      <span class="big">${view.weather.icon}</span><span class="col"><b>${esc(view.weather.label)}${view.hour != null ? ' · ' + fmtCityHour(view.hour) : ''}</b><span>${view.season.icon} ${esc(view.season.label)} · ${esc(view.terroir.toLowerCase())} ground</span></span>
      <span class="sep"></span><span class="big">🛡</span><span class="col"><b>${Math.round(view.guardDefense)}</b><span>defense</span></span>
      ${view.ill ? `<span class="sep"></span><span class="big">🦠</span><span class="col"><b>${view.ill}</b><span>sick</span></span>` : ''}
      ${under ? `<span class="sep"></span><span class="big">🏗</span><span class="col"><b>${under}</b><span>building</span></span>` : ''}
    </button>
    ${boosts.length ? `<button class="farm-hudbtn boost ${tab === 'shop' ? 'is-active' : ''}" data-fact="tab" data-id="shop" title="Active shop boosts — open the Shop"><span class="big">${boosts.map(b => FARM_ECON.shop.items[b.id].icon).join('')}</span><span class="col"><b>${boosts.length} boost${boosts.length === 1 ? '' : 's'} active</b><span>${soon ? esc(FARM_ECON.shop.items[soon.id].label) + ' ends in ' + hrs(soon.hoursLeft) : 'permanent'}</span></span></button>` : ''}`;
}

/* ── Shop panel: the merchant's cart ────────────────────────────────────── */
function renderShop(host, s, view) {
  const SH = FARM_ECON.shop, P = FARM_ECON.premium, now = Date.now();
  const active = {}; (view.shop.active || []).forEach(b => { active[b.id] = b; });
  const fx = (e) => Object.keys(e).map(k => ({
    feedMul: `feed use ×${e.feedMul}`, yieldMul: `yields ×${e.yieldMul}`, growMul: `growth ×${e.growMul}`, healMul: `healing ×${e.healMul}`, outbreakMul: `outbreaks ×${e.outbreakMul}`,
    breedMul: `births ×${e.breedMul}`, rareMul: `rare births ×${e.rareMul}`, lineMul: `royal & mythic ×${e.lineMul}`, premiumShareAdd: `+${Math.round(e.premiumShareAdd * 100)}% graded premium`,
  }[k] || k)).join(' · ');
  const item = (id) => {
    const it = SH.items[id]; const a = active[id];
    const afford = Object.keys(it.cost).every(k => k === 'cinder' ? host.gems() >= it.cost[k] : host.getRes(k) >= it.cost[k]);
    const owned = it.permanent && a;
    const left = a && !a.permanent ? a.hoursLeft : 0;
    return `<div class="farm-shopitem"><div class="ic">${it.icon}</div>
      <div><div class="nm">${esc(it.label)}${owned ? '<span class="tag own">owned</span>' : a ? `<span class="tag on">active · ${hrs(left)} left</span>` : it.permanent ? '<span class="tag">permanent</span>' : `<span class="tag">${it.hours}h</span>`}</div>
        <div class="bl">${esc(it.blurb)}</div><div class="fx">${esc(fx(it.effect))}</div>
        ${a && !a.permanent ? `<div class="farm-boostbar"><i style="width:${Math.max(2, Math.min(100, left / it.hours * 100))}%"></i></div>` : ''}
        ${owned ? '' : costHtml(host, it.cost)}</div>
      <div class="acts">${owned ? '' : `<button class="farm-btn ${afford ? 'primary' : ''}" data-fact="shop-buy" data-id="${id}" ${afford ? '' : 'disabled'}>${a ? 'Extend' : 'Buy'}</button>`}</div>
    </div>`;
  };
  const cats = Object.keys(SH.cats).map(c => `<div class="farm-card" style="--accent:${c === 'feed' ? '#d9c46a' : c === 'breed' ? '#8affd6' : '#f2d98a'}"><h3>${SH.cats[c].icon} ${esc(SH.cats[c].label)}</h3>${Object.keys(SH.items).filter(k => SH.items[k].cat === c).map(item).join('')}</div>`).join('');
  const goods = Object.keys(P.goods).map(base => { const pid = P.goods[base]; const m = host.resMeta(pid), b = host.resMeta(base); return `<div class="g"><b>${m.icon} ${fmt(host.getRes(pid))}</b>${esc(m.name)}<br><span style="opacity:.7">from ${b.icon} ${esc(b.name)}</span></div>`; }).join('');
  const share = view.shop.premiumShare;
  return `<div class="farm-cards">
    <div class="farm-onboard"><b>The merchant's cart.</b> Feed that goes further, salts that tilt the bloodline dice, and papers that grade a good breed's yield as premium. Timed items <b>extend</b> when bought again — they never stack. Nothing here mints Cinder or goods; it only makes what you already raise work harder.</div>
    ${cats}
    <div class="farm-card" style="--accent:#f2d98a"><h3>⭐ Grade-2 goods<span class="lv">${view.shop.graded} graded beast${view.shop.graded === 1 ? '' : 's'} on the farm</span></h3>
      <p>Only a rare-or-better breed makes these. They cook richer at the Kitchen, spin finer at the Spinning Shed, and the town pays about double for them — in goods, never Cinder.</p>
      <div class="farm-grade">${goods}</div>
      <div class="farm-row" style="margin-top:8px"><span class="k">Premium share</span>${['rare', 'royal', 'mythic', 'glow'].map(tk => `<span class="farm-chip">${tk} <b>${Math.round((share[tk] || 0) * 100)}%</b></span>`).join('')}</div>
      <div class="farm-toastline">Base ${Object.keys(P.shareByTier).map(k => k + ' ' + Math.round(P.shareByTier[k] * 100) + '%').join(' · ')} — the Grading Table and Provenance Stamps add to it, capped at 100%.</div>
    </div>
  </div>`;
}

/* ── Athena Editor tab ──────────────────────────────────────────────────── */
function renderAthena(host, s, view) {
  const L = view.look;
  const grounds = Object.keys(FARM_LOOKS.ground).map(k => { const g = FARM_LOOKS.ground[k]; return `<button class="farm-swatch ${L.ground === k ? 'is-on' : ''}" data-fact="look-ground" data-id="${k}" title="${esc(g.label)}" style="background:linear-gradient(135deg,${hex6(g.a)},${hex6(g.b)})"></button>`; }).join('');
  const skies = Object.keys(FARM_LOOKS.sky).map(k => { const g = FARM_LOOKS.sky[k]; return `<button class="farm-swatch ${L.sky === k ? 'is-on' : ''}" data-fact="look-sky" data-id="${k}" title="${esc(g.label)}" style="background:linear-gradient(180deg,${hex6(g.top)},${hex6(g.bottom)})"></button>`; }).join('');
  const decor = Object.keys(FARM_LOOKS.decor).map(k => `<button class="farm-check ${L.decor[k] ? 'is-on' : ''}" data-fact="look-decor" data-id="${k}">${L.decor[k] ? '☑' : '☐'} ${esc(FARM_LOOKS.decor[k].label)}</button>`).join('');
  const roofs = FARM_BUILDINGS.filter(b => s.buildings[b.id] && b.id !== 'pasture').map(b => `<span>${b.emoji} ${esc(b.name)}</span><input type="color" class="farm-input" data-froof="${b.id}" value="${esc(L.roofs[b.id] || b.accent)}" style="width:44px;height:26px;padding:0"><button class="farm-btn tiny" data-fact="look-roof-reset" data-id="${b.id}" ${L.roofs[b.id] ? '' : 'disabled'}>reset</button>`).join('');
  return `<div class="farm-cards">${(() => { try { return host.isAdmin && host.isAdmin(); } catch (e) { return false; } })() ? `<div class="farm-card"><div class="farm-card-h">⚒ Athena Engine</div><button class="farm-btn" data-fact="athena-open" title="Open the live farm scene in Athena Engine: move or replace the homestead's buildings for every player">⚒ Open in Athena Engine (admin)</button><p class="farm-hint">One live 'farm' scene for everyone — the look tab below is per player.</p></div>` : ''}
    <div class="farm-onboard"><b>Athena Editor.</b> Restyle the homestead. Everything here is cosmetic, saves with your farm, and shows to anyone who visits.</div>
    <div class="farm-card" style="--accent:#f2d98a"><h3>🏷 Name</h3><div class="farm-row"><input class="farm-input" data-fname="1" maxlength="28" value="${esc(L.name)}" placeholder="Name your homestead" style="flex:1"><button class="farm-btn primary" data-fact="look-name">Save</button></div></div>
    <div class="farm-card" style="--accent:#8fc46a"><h3>🌿 Ground</h3><div class="farm-swatches">${grounds}</div><div class="farm-toastline">${esc(FARM_LOOKS.ground[L.ground].label)}</div></div>
    <div class="farm-card" style="--accent:#7fb8ff"><h3>🌅 Sky</h3><div class="farm-swatches">${skies}</div><div class="farm-toastline">${esc(FARM_LOOKS.sky[L.sky].label)} · live weather still paints rain and storm over it</div></div>
    <div class="farm-card" style="--accent:#c08a4a"><h3>🌳 Decor</h3><div class="farm-row">${decor}</div></div>
    <div class="farm-card" style="--accent:#c25a3a"><h3>🏠 Roofs</h3>${roofs ? `<div class="farm-roofs">${roofs}</div><div class="farm-toastline">Pick a colour and it applies at once.</div>` : '<div class="farm-empty">Build something and its roof shows up here.</div>'}</div>
  </div>`;
}

/* ── Market tab: the Sale Ring (NPC + players), contracts, the collection ── */
function renderMarket(host, s, view, ui, cloud) {
  const now = Date.now();
  const A = view.auction;
  const ring = !A.ringBuilt ? '<div class="farm-empty">Build the Sale Ring to auction prize or bred stock.</div>'
    : !A.ringReady ? '<div class="farm-empty">The Sale Ring is still under construction.</div>'
    : `<div class="farm-row"><span class="k">${A.open ? '🔔 The ring is OPEN' : '🔒 Closed'}</span><span class="k">· ${A.open ? 'consign from the Livestock tab' : 'next sale ' + new Date(A.next).toLocaleString()}</span></div>`;
  const npcLots = view.lots.map(l => {
    const tl = l.timeline; const a = l.animal; const shown = tl.bids.filter(b => b.at <= now);
    const nextBid = tl.bids.find(b => b.at > now);
    const done = tl.hammerAt <= now;
    return `<div class="farm-ring"><div class="ath">🅰 Athena: “${esc(tl.athena)}”</div>
      <div class="farm-row"><b>${animalDef(a.sp).emoji} ${esc(a.name)}</b><span class="k">${esc(a.breed && FARM_ECON.breeds[a.breed] ? FARM_ECON.breeds[a.breed].label : animalDef(a.sp).name)}${a.prize ? ' · 🏅 prize' : ''} · reserve ${fmt(l.reserve)}</span></div>
      ${shown.length ? shown.map(b => `<div class="farm-bid"><span>${esc(b.who)}</span><b>${fmt(b.amount)}</b></div>`).join('') : '<div class="farm-bid"><span class="k">The regulars are looking it over…</span></div>'}
      <div class="farm-toastline">${done ? 'Hammer down — paid in goods, see the Journal.' : nextBid ? `Next bid in ${hrs((nextBid.at - now) / 3600000)} · hammer in ${hrs((tl.hammerAt - now) / 3600000)}` : `Hammer in ${hrs((tl.hammerAt - now) / 3600000)}`}</div></div>`;
  }).join('');
  const C = cloud || {};
  const me = C.userId || null;
  const rows = C.lots || [];
  const lotRow = (l) => {
    const a = l.animal || {}; const ends = new Date(l.ends_at).getTime(); const left = ends - now;
    const isMine = l.seller_id === me, high = l.high_bidder === me;
    const minNext = Math.max(l.min_bid | 0, (l.current_bid | 0) + Math.max(100, Math.floor((l.current_bid | 0) * FARM_ECON.auction.p2p.stepPct)));
    const claimable = (l.status === 'sold' && high && !l.claimed) || (l.status === 'unsold' && isMine && !l.claimed);
    return `<div class="farm-ring" data-lot="${esc(l.id)}">
      <div class="farm-row"><b>${animalDef(a.sp) ? animalDef(a.sp).emoji : '🐾'} ${esc(a.name || '?')}</b><span class="k">${esc(a.breed && FARM_ECON.breeds[a.breed] ? FARM_ECON.breeds[a.breed].label : (animalDef(a.sp) || {}).name || '')}${a.prize ? ' · 🏅' : ''} · ${a.weight ? a.weight + ' kg · ' : ''}seller ${esc(l.seller_name || 'someone')}${isMine ? ' (you)' : ''}</span></div>
      <div class="farm-row"><span class="k">Bid</span><b>🔥${fmt(l.current_bid || l.min_bid)}</b>${high ? '<span class="tag" style="color:#8affd6">you lead</span>' : ''}<span class="k">· ${l.status === 'open' ? (left > 0 ? 'ends in ' + hrs(left / 3600000) : 'ended — settle it') : l.status}</span></div>
      ${l.status === 'open' && left > 0 && !isMine ? `<div class="farm-row"><input class="farm-input" type="number" min="${minNext}" step="100" value="${minNext}" data-fbidamt="${esc(l.id)}" style="width:120px"><button class="farm-btn tiny primary" data-fact="p2p-bid" data-id="${esc(l.id)}">🔨 Bid</button><span class="k">min ${fmt(minNext)} · escrowed from your wallet, refunded if outbid</span></div>` : ''}
      ${l.status === 'open' && left <= 0 ? `<div class="farm-row"><button class="farm-btn tiny" data-fact="p2p-settle" data-id="${esc(l.id)}">⚖ Settle</button></div>` : ''}
      ${claimable ? `<div class="farm-row"><button class="farm-btn tiny primary" data-fact="p2p-claim" data-id="${esc(l.id)}">🚪 ${l.status === 'sold' ? 'Bring it home' : 'Take it back'}</button></div>` : ''}
    </div>`;
  };
  const p2p = C.why ? `<div class="farm-empty">${esc(C.why)}</div>` : (rows.length ? rows.map(lotRow).join('') : '<div class="farm-empty">No player lots open right now.</div>');
  const mineRows = (C.mine || []).filter(l => l.status !== 'open' || !rows.some(r => r.id === l.id));
  const contracts = view.contracts;
  const offerRow = (o) => `<div class="farm-ring"><div class="farm-row">${yieldHtml(host, o.give)}<span class="k">→</span>${yieldHtml(host, o.get)}</div><div class="farm-row"><span class="k">${o.days} days</span><button class="farm-btn tiny primary" data-fact="contract-accept" data-id="${o.id}" ${contracts.active.length >= FARM_ECON.contracts.maxActive ? 'disabled' : ''}>Sign</button></div></div>`;
  const activeRow = (c) => { const can = Object.keys(c.give).every(k => host.getRes(k) >= c.give[k]); const left = c.deadline - now; return `<div class="farm-ring" style="border-color:${left < 86400000 ? '#e0556a88' : '#7fd6ff55'}"><div class="farm-row">${Object.keys(c.give).map(k => { const m = host.resMeta(k); const have = host.getRes(k); return `<span class="c farm-chip" style="${have >= c.give[k] ? 'color:#8affd6' : ''}">${m.icon} ${fmt(have)}/${fmt(c.give[k])}</span>`; }).join('')}<span class="k">→</span>${yieldHtml(host, c.get)}</div><div class="farm-row"><span class="k">${left > 0 ? hrs(left / 3600000) + ' left' : 'overdue'}</span><button class="farm-btn tiny primary" data-fact="contract-deliver" data-id="${c.id}" ${can ? '' : 'disabled'}>🚚 Deliver</button></div></div>`; };
  const tiers = ['rare', 'royal', 'mythic'];
  const coll = tiers.map(tier => { const ks = Object.keys(FARM_ECON.breeds).filter(k => FARM_ECON.breeds[k].tier === tier); const have = ks.filter(k => view.collection[k]).length; return `<div class="farm-row"><span class="k">${tier}</span><b>${have}/${ks.length}</b>${view.collectionRewarded[tier] ? '<span class="tag" style="color:#f2d98a">🏆 rewarded</span>' : `<span class="k">· full set pays ${Object.keys(FARM_ECON.lines.collectionReward[tier]).map(r => FARM_ECON.lines.collectionReward[tier][r] + ' ' + host.resMeta(r).name).join(', ')}</span>`}</div><div class="farm-coll">${ks.map(k => { const B = FARM_ECON.breeds[k]; return `<div class="b ${view.collection[k] ? 'on' : ''}"><i style="background:${hex6(B.color)}"></i>${esc(B.label)}</div>`; }).join('')}</div>`; }).join('');
  return `<div class="farm-cards">
    <div class="farm-card" style="--accent:#d4af37"><h3>🏛 Sale Ring<span class="lv">${view.lots.length} in the ring</span></h3><p>Prize and bred stock only. The regulars pay in goods; other players pay in Cinder, settled on the server.</p>${ring}${npcLots}</div>
    <div class="farm-card" style="--accent:#8affd6"><h3>🌐 Player lots<span class="lv">${C.loading ? 'loading…' : rows.length + ' open'}</span></h3>
      <div class="farm-row"><button class="farm-btn tiny" data-fact="p2p-refresh">↻ Refresh</button><span class="k">Bids are escrowed; the seller is paid at the hammer less the 2% Foundation Tax.</span></div>
      ${p2p}${mineRows.length ? '<div class="farm-row"><span class="k">Yours</span></div>' + mineRows.map(lotRow).join('') : ''}</div>
    <div class="farm-card" style="--accent:#7fd6ff"><h3>📜 Contracts<span class="lv">rep ${contracts.rep >= 0 ? '+' : ''}${contracts.rep} · ${contracts.demandPerDay}/day demand</span></h3>
      <p>Multi-day orders from the town. Deliver and the daily demand grows; miss one and it shrinks.</p>
      ${contracts.active.length ? '<div class="farm-row"><span class="k">Signed</span></div>' + contracts.active.map(activeRow).join('') : ''}
      ${contracts.offers.length ? '<div class="farm-row"><span class="k">This week\'s offers</span></div>' + contracts.offers.map(offerRow).join('') : '<div class="farm-empty">No more offers this week.</div>'}</div>
    <div class="farm-card" style="--accent:#c0a8ff"><h3>🧬 Bloodlines<span class="lv">${Object.keys(view.collection).length} breeds seen</span></h3><p>Two rare parents can throw a royal; two royals a mythic. Every breed you have ever owned counts.</p>${coll}</div>
  </div>`;
}

/* ── Ranch tab: the corporation's shared pasture ─────────────────────────── */
function renderRanch(host, view, R) {
  if (!R) return '<div class="farm-empty">Loading the ranch…</div>';
  if (!R.ok) return `<div class="farm-cards"><div class="farm-card" style="--accent:#8fc46a"><h3>🤝 Corp ranch</h3><p>A pasture every member feeds. Your claim is your share of the feed over the last ${FARM_ECON.ranch.shareWindowDays} days.</p><div class="farm-empty">${esc(R.why)}</div></div></div>`;
  const v = ranchView(R.state, R.meta);
  const pct = Math.round(v.feed / v.troughCap * 100);
  const herd = v.herd.map(a => `<div class="farm-beast"><div class="nm">${animalDef(a.sp).emoji} ${esc(a.name)}${a.adult ? '' : '<span class="tag young">young</span>'}</div><div class="st"><span>by <b>${esc(a.by || '?')}</b></span></div><div class="acts">${a.adult ? `<button class="farm-btn tiny danger" data-fact="ranch-butcher" data-id="${a.id}" ${v.share > 0 ? '' : 'disabled'}>🔪</button>` : ''}</div></div>`).join('');
  return `<div class="farm-cards">
    <div class="farm-card" style="--accent:#8fc46a"><h3>🤝 ${esc(R.corp.name)} ranch<span class="lv">${v.herd.length}/${v.capacity} head</span></h3>
      <p>Everyone feeds it; everyone claims their share. Your share right now: <b>${Math.round(v.share * 100)}%</b> (${fmt(R.meta.my_feed)} of ${fmt(R.meta.all_feed)} feed this week).</p>
      <div class="farm-row"><span class="k">Trough</span><span class="farm-meter"><i class="${v.feed <= 0 ? 'empty' : pct < 25 ? 'low' : ''}" style="width:${pct}%"></i></span><b>${v.feed}/${v.troughCap}</b><span class="k">· ${v.herd.length ? hrs(v.hoursLeft) + ' of feed' : 'no stock'}</span></div>
      <div class="farm-row"><span class="k">Pool</span>${yieldHtml(host, v.pending)}</div>
      <div class="farm-row"><span class="k">Your cut</span>${yieldHtml(host, v.mine)}</div>
      <div class="farm-row"><button class="farm-btn" data-fact="ranch-feed" data-n="60" ${host.getRes('animalFeed') >= 1 ? '' : 'disabled'}>🌾 Add 60 feed</button><button class="farm-btn" data-fact="ranch-feed" data-n="240" ${host.getRes('animalFeed') >= 1 ? '' : 'disabled'}>🌾 Add 240</button><button class="farm-btn primary" data-fact="ranch-claim" ${Object.keys(v.mine).length ? '' : 'disabled'}>🧺 Claim my share</button><button class="farm-btn tiny" data-fact="ranch-refresh">↻</button></div>
      <div class="farm-row">${FARM_ECON.ranch.species.map(sp => { const a = animalDef(sp), e = FARM_ECON.animals[sp]; return `<button class="farm-btn" data-fact="ranch-stock" data-id="${sp}" ${v.herd.length >= v.capacity || host.gems() < e.cinder ? 'disabled' : ''}>${a.emoji} Add ${esc(a.name)} · 🔥${fmt(e.cinder)}</button>`; }).join('')}</div>
      ${herd ? `<div style="margin-top:6px;border:1px solid #1e2532;border-radius:6px;overflow:hidden">${herd}</div>` : '<div class="farm-empty">No stock yet. Add a sheep, goat or cow — it grazes for the whole corporation.</div>'}
    </div>
    <div class="farm-card" style="--accent:#9aa3b5"><h3>📒 Ranch ledger</h3>${(R.meta.ledger || []).length ? (R.meta.ledger || []).slice(0, 15).map(e => `<div class="farm-bid"><span>${esc(e.who || '?')} · ${esc(e.kind)} ${esc(e.resource || '')}</span><b>${fmt(e.amount)}</b></div>`).join('') : '<div class="farm-empty">Nothing yet.</div>'}</div>
  </div>`;
}

function renderShell(sub) {
  return `<div class="farm-page">
    <div class="farm-top">
      <button class="farm-back" data-fact="back">← Camp</button>
      <div><h1 data-farm="title">🐄 Homestead Farm</h1><div class="farm-sub">${esc(sub || 'Raise stock, feed it, guard it, collect what it gives — and send it to the block when it is grown.')}</div></div>
      <div class="farm-ledger" data-farm="ledger"></div>
    </div>
    <div class="farm-body">
      <div class="farm-stage" data-farm="stage"><div class="farm-hint">Drag to orbit · wheel / pinch to zoom · tap a building or animal</div></div>
      <div class="farm-hud" data-farm="hud"></div>
      <div data-athena-slot="farm.hud" style="position:absolute;left:10px;bottom:10px;z-index:4"></div>
      <div class="farm-panel" data-farm="panelbox">
        <div class="farm-panelhead"><h2 data-farm="paneltitle">Homestead</h2><button class="x" data-fact="tab-close" title="Close">✕</button></div>
        <div data-farm="panel"></div>
      </div>
      <div class="farm-bar" role="tablist">${FARM_TABS.map(t => `<button class="farm-tab ${t.id === 'homestead' ? 'is-active' : ''}" data-fact="tab" data-id="${t.id}" title="${esc(t.title)}"><span class="ic">${t.icon}</span>${esc(t.label)}</button>`).join('')}</div>
    </div>
  </div>`;
}
/* 🎮 The toolbar. Order is the order of a session: build → stock → sell → share → shop → read → restyle. */
const FARM_TABS = [
  { id: 'homestead', icon: '🏡', label: 'Homestead', title: 'Buildings and stations' },
  { id: 'livestock', icon: '🐑', label: 'Livestock', title: 'Every animal on the farm' },
  { id: 'market',    icon: '🏛', label: 'Market',    title: 'The Sale Ring, player lots, contracts, bloodlines' },
  { id: 'ranch',     icon: '🤝', label: 'Ranch',     title: 'The corporation’s shared pasture' },
  { id: 'shop',      icon: '🛒', label: 'Shop',      title: 'The merchant’s cart: feed, bloodlines, grading' },
  { id: 'journal',   icon: '📜', label: 'Journal',   title: 'Town demand, statistics, what happened' },
  { id: 'athena',    icon: '🅰', label: 'Athena',    title: 'The look editor' },
];

/* ═══ farm.cloud.js ═══ */
/* ════════════════════════════════════════════════════════════════════════════
   🐄 HOMESTEAD FARM — the cloud half: player-to-player lots and the corp ranch.
   ----------------------------------------------------------------------------
   Everything here talks to Supabase THROUGH host.cloud, which index.html hands
   over on the bridge (the globals trap: `Cloud`, `Corp`, `Profile` are lexical
   and invisible here). Every call is guarded: no client, not signed in, no
   corp, a missing table (sql/038 not applied yet) — each degrades to a plain
   `{ ok: false, why }` the panel can print, never a throw and never a hang.

   ⚖ MONEY NEVER MOVES HERE. A bid is escrowed and a hammer paid by the
   SECURITY DEFINER functions in sql/038; this file only asks. The animal is
   client data (see the migration header) — the farm hands it over before
   posting and takes it back if the post fails.

   🤝 THE RANCH is one jsonb row per corporation with a version. The pure
   simulation below runs on whichever member opens it; the save carries the
   version it read, and a 'stale' answer means someone else saved first — we
   re-read and try once more. Feed, stock and claims are ledger rows the
   server appends from the entries we send with the save.
   ════════════════════════════════════════════════════════════════════════════ */




const errC = (why, extra) => Object.assign({ ok: false, why }, extra || {});
const ERR_TEXT = {
  not_signed_in: 'sign in to use the ring', bad_animal: 'that beast cannot be listed', min_bid_500: 'minimum bid is 500 Cinder',
  max_3_open_lots: 'you already have 3 lots open', no_such_lot: 'that lot is gone', closed: 'that lot has closed', own_lot: 'that is your own lot',
  already_high: 'you are already the high bidder', min_bid: 'bid too low', insufficient: 'not enough Cinder', still_open: 'the lot is still open',
  already_claimed: 'already claimed', not_yours: 'not yours to claim', not_a_member: 'you are not in that corporation', stale: 'someone else saved first',
  bad_state: 'bad ranch state',
};
const textOf = (e, extra) => { const t = ERR_TEXT[e] || e || 'unknown error'; return extra && extra.min ? `${t} (min ${Number(extra.min).toLocaleString()})` : t; };
const missingTable = (m) => /farm_lots|farm_ranch|PGRST205|does not exist|schema cache|function .* does not exist/i.test(String(m || ''));

function cloudOf(host) { const c = host && host.cloud; return (c && typeof c.rpc === 'function') ? c : null; }
async function rpc(host, name, args) {
  const c = cloudOf(host);
  if (!c) return errC('cloud is not available');
  if (!c.ready()) return errC('sign in to use this');
  try {
    const r = await c.rpc(name, args || {});
    if (r && r.error) return errC(missingTable(r.error.message) ? 'the ring is not set up on the server yet (sql/038)' : (r.error.message || 'server error'));
    const d = r ? r.data : null;
    if (d && typeof d === 'object' && d.ok === false) return errC(textOf(d.error, d), d);
    return { ok: true, data: d };
  } catch (e) { return errC(String(e && e.message || e)); }
}

/* ── Player lots ─────────────────────────────────────────────────────────── */
const lots = {
  async listOpen(host) {
    const c = cloudOf(host); if (!c || !c.ready()) return { ok: false, why: 'sign in to see the ring', rows: [] };
    try {
      const r = await c.select('farm_lots', { cols: 'id,seller_id,seller_name,animal,min_bid,current_bid,high_bidder,ends_at,status,claimed,created_at', eq: { status: 'open' }, order: ['ends_at', true], limit: 40 });
      if (r && r.error) return { ok: false, why: missingTable(r.error.message) ? 'the ring is not set up on the server yet (sql/038)' : r.error.message, rows: [] };
      return { ok: true, rows: r.data || [] };
    } catch (e) { return { ok: false, why: String(e && e.message || e), rows: [] }; }
  },
  async mine(host) {
    const c = cloudOf(host); if (!c || !c.ready()) return { ok: false, rows: [] };
    try {
      const me = c.userId();
      const a = await c.select('farm_lots', { cols: 'id,seller_id,seller_name,animal,min_bid,current_bid,high_bidder,ends_at,status,claimed,created_at', eq: { seller_id: me }, order: ['created_at', false], limit: 20 });
      const b = await c.select('farm_lots', { cols: 'id,seller_id,seller_name,animal,min_bid,current_bid,high_bidder,ends_at,status,claimed,created_at', eq: { high_bidder: me }, order: ['created_at', false], limit: 20 });
      const rows = [].concat((a && a.data) || [], (b && b.data) || []).filter((x, i, arr) => arr.findIndex(y => y.id === x.id) === i);
      return { ok: true, rows };
    } catch (e) { return { ok: false, rows: [] }; }
  },
  async bids(host, lotId) {
    const c = cloudOf(host); if (!c || !c.ready()) return [];
    try { const r = await c.select('farm_lot_bids', { cols: 'bidder_name,amount,created_at', eq: { lot_id: lotId }, order: ['created_at', false], limit: 12 }); return (r && r.data) || []; } catch (e) { return []; }
  },
  post: (host, animal, minBid, hours) => rpc(host, 'farm_lot_post', { p_animal: animal, p_min_bid: minBid | 0, p_hours: hours | 0, p_seller_name: cloudOf(host) ? cloudOf(host).userName() : null }),
  bid: (host, lotId, amount) => rpc(host, 'farm_lot_bid', { p_lot: lotId, p_amount: amount | 0, p_bidder_name: cloudOf(host) ? cloudOf(host).userName() : null }),
  settle: (host, lotId) => rpc(host, 'farm_lot_settle', { p_lot: lotId }),
  claim: (host, lotId) => rpc(host, 'farm_lot_claim', { p_lot: lotId }),
};

/* ── The corp ranch ───────────────────────────────────────────────────────── */
function ranchEnsure(st) {
  st = (st && typeof st === 'object') ? st : {};
  if (!Array.isArray(st.animals)) st.animals = [];
  st.feed = Math.max(0, Number(st.feed) || 0);
  st.simAt = Number(st.simAt) || Date.now();
  if (!st.accrual || typeof st.accrual !== 'object') st.accrual = {};
  if (typeof st.seq !== 'number') st.seq = 1;
  if (!Array.isArray(st.log)) st.log = [];
  st.animals = st.animals.filter(a => a && animalDef(a.sp) && FARM_ECON.ranch.species.indexOf(a.sp) >= 0).map(a => ({ id: a.id | 0, sp: a.sp, name: String(a.name || '').slice(0, 24), grownH: Math.max(0, Number(a.grownH) || 0), by: String(a.by || '') }));
  return st;
}
/* Pure. Grazing at COMMON rate, no seasons (a corp spans many camps), no health. */
function ranchSimulate(st, now) {
  now = now || Date.now();
  const hours = Math.max(0, (now - st.simAt) / H);
  if (hours <= 0 || !st.animals.length) { if (hours > 0) st.simAt = now; return st; }
  st.simAt = now;
  const draw = st.animals.reduce((d, a) => d + FARM_ECON.animals[a.sp].feedPerH * FARM_ECON.grazeDiscount, 0);
  const fedH = draw > 0 ? Math.min(hours, st.feed / draw) : hours;
  if (fedH <= 0) return st;
  st.feed = Math.max(0, st.feed - fedH * draw);
  st.animals.forEach(a => {
    const e = FARM_ECON.animals[a.sp];
    const adultH = Math.max(0, fedH - Math.max(0, e.growH - a.grownH));
    a.grownH += fedH;
    if (adultH <= 0) return;
    const y = FARM_ECON.yieldsPerH[a.sp] || {};
    Object.keys(y).forEach(r => { st.accrual[r] = (st.accrual[r] || 0) + y[r] * adultH; });
  });
  return st;
}
function ranchView(st, meta) {
  const now = Date.now();
  const draw = st.animals.reduce((d, a) => d + FARM_ECON.animals[a.sp].feedPerH * FARM_ECON.grazeDiscount, 0);
  const pending = {}; Object.keys(st.accrual).forEach(r => { const n = Math.floor(st.accrual[r]); if (n > 0) pending[r] = n; });
  const share = (meta && meta.all_feed > 0) ? Math.min(1, (meta.my_feed || 0) / meta.all_feed) : (st.animals.length ? 0 : 0);
  const mine = {}; Object.keys(pending).forEach(r => { const n = Math.floor(pending[r] * share); if (n > 0) mine[r] = n; });
  return {
    herd: st.animals.map(a => Object.assign({}, a, { adult: a.grownH >= FARM_ECON.animals[a.sp].growH })),
    feed: Math.floor(st.feed), troughCap: FARM_ECON.ranch.troughCap, capacity: FARM_ECON.ranch.capacity,
    hoursLeft: draw > 0 ? st.feed / draw : Infinity, pending, share, mine, now,
  };
}
const ranch = {
  async get(host) {
    const c = cloudOf(host); const corp = c && c.corp();
    if (!c || !c.ready()) return errC('sign in to see the ranch');
    if (!corp) return errC('join a corporation to ranch together');
    const r = await rpc(host, 'farm_ranch_get', { p_corp: corp.id });
    if (!r.ok) return r;
    const d = r.data || {};
    // Simulated for DISPLAY only (in memory): the pool the panel shows is what a
    // claim would find. Saves happen through apply(), which re-reads and re-runs.
    return { ok: true, corp, state: ranchSimulate(ranchEnsure(d.state), Date.now()), version: d.version | 0, meta: { my_feed: d.my_feed | 0, all_feed: d.all_feed | 0, ledger: d.ledger || [] } };
  },
  /* Apply `mutate(state)` → entries, then save with the version; retry once on 'stale'. */
  async apply(host, mutate) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const g = await ranch.get(host); if (!g.ok) return g;
      const st = ranchSimulate(g.state, Date.now());
      const entries = [];
      const m = mutate(st, entries, g); if (m && m.ok === false) return m;
      const r = await rpc(host, 'farm_ranch_save', { p_corp: g.corp.id, p_state: st, p_version: g.version, p_entries: entries, p_user_name: cloudOf(host).userName() });
      if (r.ok) return Object.assign({ ok: true, state: st, version: r.data && r.data.version }, m || {});
      if (r.why !== textOf('stale')) return r;
    }
    return errC('someone else saved first — try again');
  },
  feed(host, units) {
    units = Math.max(1, units | 0);
    return ranch.apply(host, (st, entries) => {
      const free = Math.floor(FARM_ECON.ranch.troughCap - st.feed);
      const take = Math.min(units, free, host.getRes('animalFeed'));
      if (take <= 0) return errC(free <= 0 ? 'the ranch trough is full' : 'no Animal Feed in your stash');
      if (!host.spendRes('animalFeed', take)) return errC('could not take the feed');
      st.feed += take; entries.push({ kind: 'feed', resource: 'animalFeed', amount: take });
      st.log.unshift({ t: Date.now(), text: `${cloudOf(host).userName()} added ${take} feed.` }); st.log.length = Math.min(st.log.length, 20);
      return { ok: true, added: take, undo: () => host.refundRes('animalFeed', take) };
    }).then(r => { if (!r.ok && r.undo) r.undo(); return r; });
  },
  stock(host, sp) {
    const e = FARM_ECON.animals[sp]; if (!e || FARM_ECON.ranch.species.indexOf(sp) < 0) return Promise.resolve(errC('the ranch keeps sheep, goats and cows'));
    return ranch.apply(host, (st, entries) => {
      if (st.animals.length >= FARM_ECON.ranch.capacity) return errC('the ranch is full');
      if (!host.spendGems(e.cinder)) return errC('not enough Cinder');
      const a = { id: st.seq++, sp, name: defaultName(sp, st.seq * 7 + 3), grownH: 0, by: cloudOf(host).userName() };
      st.animals.push(a); entries.push({ kind: 'stock', resource: sp, amount: e.cinder });
      st.log.unshift({ t: Date.now(), text: `${a.by} brought ${a.name} the ${animalDef(sp).name.toLowerCase()} to the ranch.` }); st.log.length = Math.min(st.log.length, 20);
      return { ok: true, name: a.name, undo: () => host.addGems(e.cinder) };
    }).then(r => { if (!r.ok && r.undo) r.undo(); return r; });
  },
  claim(host) {
    return ranch.apply(host, (st, entries, g) => {
      const v = ranchView(st, g.meta);
      const keys = Object.keys(v.mine);
      if (!keys.length) return errC(v.share > 0 ? 'nothing to claim yet' : 'add feed first — your share is what you fed');
      const got = {};
      keys.forEach(r => { const before = host.getRes(r); host.addRes(r, v.mine[r]); const landed = Math.max(0, host.getRes(r) - before); if (landed > 0) { got[r] = landed; st.accrual[r] = Math.max(0, st.accrual[r] - landed); entries.push({ kind: 'claim', resource: r, amount: landed }); } });
      st.log.unshift({ t: Date.now(), text: `${cloudOf(host).userName()} claimed ${Object.keys(got).map(k => got[k] + ' ' + k).join(', ') || 'nothing'}.` }); st.log.length = Math.min(st.log.length, 20);
      return { ok: true, got };
    });
  },
  butcher(host, animalId) {
    return ranch.apply(host, (st, entries, g) => {
      const a = st.animals.find(x => x.id === (animalId | 0)); if (!a) return errC('no such animal');
      if (a.grownH < FARM_ECON.animals[a.sp].growH) return errC(a.name + ' is not grown');
      const v = ranchView(st, g.meta); if (!(v.share > 0)) return errC('feed the ranch before you cull it');
      const table = FARM_ECON.slaughter[a.sp]; const got = {};
      Object.keys(table).forEach(r => { const n = Math.max(1, Math.floor(table[r] * v.share)); const before = host.getRes(r); host.addRes(r, n); const landed = Math.max(0, host.getRes(r) - before); if (landed > 0) { got[r] = landed; entries.push({ kind: 'claim', resource: r, amount: landed }); } });
      st.animals = st.animals.filter(x => x !== a);
      st.log.unshift({ t: Date.now(), text: `${cloudOf(host).userName()} sent ${a.name} to the block (${Math.round(v.share * 100)}% share).` }); st.log.length = Math.min(st.log.length, 20);
      return { ok: true, got };
    });
  },
};

const S = { ensureState, normalizeLook, building, has, animalsOf, animalById, animalsInPen, econOf, isAdult, isGuard, isSick, healthFactor, breedOf, yieldMul, tierOf, isIll, diseaseFor, weightOf, penCapacity, isReady, buildProgress, buildersBonus, buildTimeMs, rushCost, inTransit, carriersFor, carrierById, shipFee, troughCap, terroirTier, grazeFactor, farmersBonus, boostMul, boostAdd, activeBoosts, premiumShare, feedDrawPerH, feedHoursLeft, penRatePerH, guardDefense, penDefense, collectReadyAt, pendingCollect, prizeIds, townOffer, demandPerDay, weekKey, contractOffers, auctionOpen, nextAuction, animalValue, lotTimeline, lotPayout, simulate, canAfford, shortfall, spendCost, build, upgrade, repair, buyAnimal, rush, debugShift, rename, treat, acceptContract, deliverContract, consign, takeAnimalForLot, returnAnimal, buyShopItem, fillTrough, tend, collect, slaughter, craft, deliverDemand, crate, uncrate, uncrateCost, setLook, available, pendingAll, drawAccrual, summary };
/* ═══ index.js ═══ */
/* ════════════════════════════════════════════════════════════════════════════
   🐄 HOMESTEAD FARM — module entry point. Registers window.MythicFarm.
   ----------------------------------------------------------------------------
   A 3D animal-farm simulation: build pens and stations with Cinder +
   resources, buy stock, keep the troughs full, collect eggs / milk / wool /
   feathers / manure from living animals, slaughter grown stock for meat and
   hide, refine at the Tannery / Spinning Shed / Kitchen — and now keep it
   alive: every animal has health, weight, age and a name; guards defend
   against raids and predators; seasons, weather, the town's demand, crates
   for the Exchange, hired Farmers, and the Athena Editor for the look.
   NEW feature, so it lives OUTSIDE index.html (CLAUDE.md).

   🔴 THE GLOBALS TRAP. `Profile`, `getRes`, `addRes`, `spendGems`, `RESOURCES`
   are top-level `const` / function declarations in index.html — global
   LEXICAL bindings, NOT properties of `window`. This module reads NOTHING by
   itself: index.html hands over window.MythicFarmBridge, and without it the
   module registers, stays inert and warns once. window.MythicTerroir is the
   one exception, and only because terroir.js is itself a module that
   publishes on window (module → window is the direction that works).

   ⚠ Everything is wrapped so a failure inside the farm can never take the
   game down. The farm is a feature; the game is the product.
   ════════════════════════════════════════════════════════════════════════════ */






function makeHost() {
  const B = (typeof window !== 'undefined') ? window.MythicFarmBridge : null;
  if (!B) return null;
  const FALLBACK = { name: 'Unknown', icon: '📦', color: '#cfd6e4', known: false };
  const metaOf = (id) => {
    try {
      const r = (B.resources || []).find(x => x && x.id === id);
      return r ? { name: r.name, icon: r.icon, color: r.color, known: true } : Object.assign({}, FALLBACK, { name: id });
    } catch (e) { return Object.assign({}, FALLBACK, { name: id }); }
  };
  return {
    gems: () => { try { return B.gems() | 0; } catch (e) { return 0; } },
    getRes: (id) => { try { return B.getRes(id) | 0; } catch (e) { return 0; } },
    resMeta: metaOf,
    resourceIds: () => { try { return (B.resources || []).map(r => r && r.id).filter(Boolean); } catch (e) { return []; } },
    spendGems: (n) => { try { return !!B.spendGems(n); } catch (e) { return false; } },
    addGems: (n) => { try { B.addGems(n); } catch (e) {} },
    spendRes: (id, n) => { try { return !!B.spendRes(id, n); } catch (e) { return false; } },
    addRes: (id, n) => { try { B.addRes(id, n); } catch (e) {} },
    refundRes: (id, n) => { try { (B.refundRes || B.addRes)(id, n); } catch (e) {} },
    cityWeather: () => { try { return (typeof B.cityWeather === 'function') ? B.cityWeather() : null; } catch (e) { return null; } },
    cityHour: () => { try { return (typeof B.cityHour === 'function') ? B.cityHour() : null; } catch (e) { return null; } },
    state: () => { try { return B.farmState(); } catch (e) { return {}; } },
    setState: (s) => { try { return B.setFarmState(s) !== false; } catch (e) { return false; } },
    save: () => { try { return B.save() !== false; } catch (e) { return false; } },
    toast: (m, ms) => { try { B.toast(m, ms); } catch (e) {} },
    confirm: (m) => { try { return Promise.resolve(B.confirm(m)); } catch (e) { return Promise.resolve(false); } },
    back: () => { try { B.back(); } catch (e) {} },
    // 👷 Reconstruction workforce, 🏴 rival camps, 🗺 terroir — all absent-tolerant.
    farmers: () => { try { return B.farmers ? (B.farmers() | 0) : 0; } catch (e) { return 0; } },
    builders: () => { try { return B.builders ? (B.builders() | 0) : 0; } catch (e) { return 0; } },
    bestRig: () => { try { return B.bestRig ? (B.bestRig() || null) : null; } catch (e) { return null; } },
    rivals: () => { try { return B.rivals ? (B.rivals() || []) : []; } catch (e) { return []; } },
    terroirTier: (resId) => {
      try {
        const T = window.MythicTerroir; if (!T || typeof T.terroir !== 'function') return null;
        const t = T.terroir(); return (t && t.tiers && t.tiers[resId]) || null;
      } catch (e) { return null; }
    },
    collectCdMs: (B.collectCdMs | 0) || 6 * 3600000,
    accrualCapH: (B.accrualCapH | 0) || 36,
    isAdmin: () => { try { return !!(B.isAdmin && B.isAdmin()); } catch (e) { return false; } },
    // 🌐 The cloud seam (player lots, corp ranch). Absent on an older bridge → the tabs say so.
    cloud: (B.cloud && typeof B.cloud.rpc === 'function') ? {
      ready: () => { try { return !!B.cloud.ready(); } catch (e) { return false; } },
      userId: () => { try { return B.cloud.userId(); } catch (e) { return null; } },
      userName: () => { try { return B.cloud.userName() || 'Farmer'; } catch (e) { return 'Farmer'; } },
      corp: () => { try { return B.cloud.corp(); } catch (e) { return null; } },
      rpc: (n, a) => B.cloud.rpc(n, a),
      select: (tb, o) => B.cloud.select(tb, o),
    } : null,
  };
}

let _warned = false;
function host() {
  const h = makeHost();
  if (!h && !_warned) {
    _warned = true;
    try { console.warn('[farm] window.MythicFarmBridge is absent — the farm is inert. index.html must hand the module its capabilities (the globals trap).'); } catch (e) {}
  }
  return h;
}

const fmtGot = (h, got) => Object.keys(got || {}).map(k => { const m = h.resMeta(k); return `${m.icon} ${got[k]} ${m.name}`; }).join(', ');
const escIdx = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ── Mount ─────────────────────────────────────────────────────────────────── */
let _mounted = null;

function ensureCss() {
  if (document.getElementById('farm-css')) return;
  const st = document.createElement('style'); st.id = 'farm-css'; st.textContent = FARM_CSS; document.head.appendChild(st);
}

function mount(rootEl) {
  const h = host();
  if (!h || !rootEl) return false;
  unmount();
  ensureCss();
  const missing = auditCatalog(h.resourceIds());
  if (missing.length) { try { console.warn('[farm] ledger is missing ids the farm pays out: ' + missing.join(', ')); } catch (e) {} }

  _wxHost = h;   // 🌦 every weather reader sees the city's sky from here on
  rootEl.innerHTML = renderShell();
  const m = _mounted = { root: rootEl, scene: null, tab: 'homestead' /* 🎮 null = no panel open, just the homestead */, focus: null, tick: 0, busy: false, ui: { cut: 'balanced', carrier: FARM_ECON.transport.defaultCarrier, escort: 0, renaming: null }, bannerShown: false, cloud: { loading: false, lots: [], mine: [], why: null, userId: null, at: 0 }, ranch: null };
  const stage = rootEl.querySelector('[data-farm="stage"]');

  /* 🩹 NO FLASH. Markup is written only when it changed since the last paint,
     and a panel that did change keeps its scroll — a full innerHTML rebuild
     on every tick and every click is what read as "the page refreshes". */
  const setHtml = (el, html) => {
    if (!el || el._farmHtml === html) return false;
    const st = el.scrollTop; el._farmHtml = html; el.innerHTML = html;
    try { if (st) el.scrollTop = st; } catch (e) {}
    return true;
  };
  const paint = () => {
    if (_mounted !== m) return;
    try {
      const s = S.ensureState(h);
      const view = S.summary(h, s);
      const led = rootEl.querySelector('[data-farm="ledger"]'); if (led) setHtml(led, renderLedger(h, view));
      const title = rootEl.querySelector('[data-farm="title"]'); if (title) title.textContent = '🐄 ' + (view.look.name || 'Homestead Farm');
      const hud = rootEl.querySelector('[data-farm="hud"]'); if (hud) setHtml(hud, renderHud(h, view, m.tab));
      // 🎮 CS2 chrome: no tab open → no panel, just the homestead.
      const box = rootEl.querySelector('[data-farm="panelbox"]'); if (box) box.hidden = !m.tab;
      const ptitle = rootEl.querySelector('[data-farm="paneltitle"]'); if (ptitle) { const td = FARM_TABS.find(x => x.id === m.tab); ptitle.textContent = td ? td.icon + ' ' + td.label : ''; }
      const panel = rootEl.querySelector('[data-farm="panel"]');
      if (panel && !m.tab) setHtml(panel, '');
      else if (panel) {
        setHtml(panel, m.tab === 'livestock' ? renderLivestock(h, s, view, m.focus, m.ui)
          : m.tab === 'journal' ? renderJournal(h, s, view)
          : m.tab === 'athena' ? renderAthena(h, s, view)
          : m.tab === 'market' ? renderMarket(h, s, view, m.ui, m.cloud)
          : m.tab === 'ranch' ? renderRanch(h, view, m.ranch)
          : m.tab === 'shop' ? renderShop(h, s, view)
          : renderHomestead(h, s, view, m.focus, m.ui));
        if (m.ui.renaming) {
          const row = panel.querySelector(`.farm-beast[data-aid="${m.ui.renaming}"] .nm`);
          const a = S.animalById(s, m.ui.renaming);
          if (row && a) row.innerHTML = `<input class="farm-input" data-frename="${a.id}" maxlength="24" value="${escIdx(a.name)}" style="width:130px"><button class="farm-btn tiny primary" data-fact="rename-save" data-id="${a.id}">Save</button><button class="farm-btn tiny" data-fact="rename-cancel">✕</button>`;
          const inp = row && row.querySelector('input'); if (inp) { setTimeout(() => { try { inp.focus(); inp.select(); } catch (e) {} }, 0); }
        }
      }
      rootEl.querySelectorAll('.farm-tab').forEach(t => t.classList.toggle('is-active', t.getAttribute('data-id') === m.tab));
      if (m.scene) m.scene.update(view);
      if (!m.bannerShown && view.recentEvents.length && stage) {
        m.bannerShown = true;
        const ev = view.recentEvents[0];
        const b = document.createElement('div'); b.className = 'farm-banner'; b.textContent = `${ev.icon} While you were away: ${ev.text}`; stage.appendChild(b);
        setTimeout(() => { try { b.remove(); } catch (e) {} }, 12000);
      }
      if (m.focus) { const el = panel && panel.querySelector(`[data-fid="${m.focus}"]`); if (el && m.scrollTo) { try { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {} m.scrollTo = false; } }
    } catch (e) { try { console.warn('[farm] paint failed:', e); } catch (x) {} }
  };
  m.paint = paint;
  const loadLots = async () => {
    if (_mounted !== m) return;
    m.cloud.loading = true; paint();
    try {
      m.cloud.userId = h.cloud ? h.cloud.userId() : null;
      const open = await lots.listOpen(h); const mine = await lots.mine(h);
      m.cloud.lots = open.rows || []; m.cloud.mine = mine.rows || []; m.cloud.why = open.ok ? null : open.why; m.cloud.at = Date.now();
    } catch (e) { m.cloud.why = 'could not reach the ring'; }
    m.cloud.loading = false; if (_mounted === m) paint();
  };
  const loadRanch = async () => {
    if (_mounted !== m) return;
    m.ranch = null; paint();
    try { m.ranch = await ranch.get(h); } catch (e) { m.ranch = { ok: false, why: 'could not reach the ranch' }; }
    if (_mounted === m) paint();
  };

  // 👷 Farmers tend the troughs as you walk in.
  try { const s = S.ensureState(h); const r = S.tend(h, s); if (r.ok && r.moved) h.toast(`👷 Your Farmers topped up the troughs with ${r.moved} feed.`, 3000); } catch (e) {}

  createScene(stage, {
    onSelect: (kind, id) => {
      if (_mounted !== m) return;
      m.focus = id; m.scrollTo = true;
      m.tab = (kind === 'animal') ? 'livestock' : 'homestead';
      paint();
    },
  }).then(scene => {
    if (_mounted !== m) { try { scene.destroy(); } catch (e) {} return; }
    m.scene = scene;
    if (scene.mode === '2d') { const hint = rootEl.querySelector('.farm-hint'); if (hint) hint.textContent = '2D view (3D engine unavailable) · tap a building or animal'; }
    paint();
  }).catch(() => {});

  /* ⏱ Periodic refresh (feed drains, cooldowns tick). Skipped while the player
     is typing — the e2e caught a half-typed homestead name being wiped by a
     repaint that landed between keystrokes. */
  m.tick = setInterval(() => {
    if (!rootEl.isConnected || _mounted !== m) { unmount(m); return; }
    const ae = document.activeElement;
    if (m.ui.renaming || (ae && rootEl.contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName))) return;
    paint();
  }, 20000);

  rootEl.addEventListener('click', onClick);
  rootEl.addEventListener('change', onChange);
  rootEl.addEventListener('keydown', onKey);
  m.onClick = onClick; m.onChange = onChange; m.onKey = onKey;
  paint();
  return true;

  function onChange(e) {
    const t = e.target;
    if (!t || _mounted !== m) return;
    if (t.getAttribute('data-fsel') === 'cut') { m.ui.cut = t.value; paint(); return; }
    if (t.getAttribute('data-fsel') === 'carrier') { m.ui.carrier = t.value; paint(); return; }
    if (t.getAttribute('data-fsel') === 'escort') { m.ui.escort = t.value | 0; paint(); return; }
    const roof = t.getAttribute('data-froof');
    if (roof) { const s = S.ensureState(h); const r = S.setLook(h, s, { roofs: { [roof]: t.value } }); if (!r.ok) h.toast('Could not save the roof colour.', 2500); paint(); }
  }
  function onKey(e) {
    if (_mounted !== m) return;
    const t = e.target;
    if (e.key === 'Enter' && t && t.getAttribute('data-frename')) { e.preventDefault(); doRename(t.getAttribute('data-frename'), t.value); }
    if (e.key === 'Enter' && t && t.getAttribute('data-fname')) { e.preventDefault(); doName(t.value); }
    if (e.key === 'Escape' && m.ui.renaming) { m.ui.renaming = null; paint(); }
  }
  function doRename(id, value) {
    const s = S.ensureState(h); const r = S.rename(h, s, id | 0, value);
    m.ui.renaming = null;
    h.toast(r.ok ? `🏷 Renamed to ${r.name}.` : `Rename: ${r.why}`, 2500); paint();
  }
  function doName(value) {
    const s = S.ensureState(h); const r = S.setLook(h, s, { name: String(value || '').replace(/[<>]/g, '').trim() });
    h.toast(r.ok ? '🏷 Homestead renamed.' : 'Could not save the name.', 2500); paint();
  }

  async function onClick(e) {
    const t = e.target.closest && e.target.closest('[data-fact]');
    if (!t || _mounted !== m || m.busy) return;
    const act = t.getAttribute('data-fact'), id = t.getAttribute('data-id'), n = parseInt(t.getAttribute('data-n') || '1', 10) || 1;
    e.preventDefault();
    m.busy = true;
    try {
      const s = S.ensureState(h);
      let r;
      switch (act) {
        case 'back': h.back(); return;
        // 🎮 Toolbar buttons TOGGLE: pressing the open panel's button closes it.
        case 'tab': m.tab = (m.tab === id) ? null : id; m.focus = null; m.ui.renaming = null; if (m.tab === 'market' && Date.now() - m.cloud.at > 15000) loadLots(); if (m.tab === 'ranch') loadRanch(); break;
        case 'tab-close': m.tab = null; m.focus = null; m.ui.renaming = null; break;
        case 'shop-buy': {
          const it = FARM_ECON.shop.items[id]; if (!it) break;
          r = S.buyShopItem(h, s, id);
          h.toast(r.ok ? `${it.icon} ${it.label} ${r.permanent ? 'is yours — permanent.' : (r.extended ? 'extended' : 'bought') + ' — ' + it.hours + 'h on the clock, ends ' + new Date(r.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '.'}` : `Shop: ${why(h, r)}`, 4000);
          break;
        }
        case 'build': {
          const def = buildingDef(id); if (!def) break;
          r = S.build(h, s, id);
          if (r.ok) { h.toast(`🏗 Broke ground on the ${def.name} — ready in ${Math.max(1, Math.round((r.readyAt - Date.now()) / 60000))} min. Rush it with Cinder or hire Builders.`, 4000); m.focus = id; if (m.scene && m.scene.select) m.scene.select({ kind: 'building', id }); }
          else h.toast(`Cannot build: ${why(h, r)}`, 3600);
          break;
        }
        case 'upgrade': { const def = buildingDef(id); if (!def) break; r = S.upgrade(h, s, id); h.toast(r.ok ? (r.pendingLevel ? `🏗 Crews are raising ${def.name} to level ${r.pendingLevel}. It keeps working meanwhile.` : `⬆ ${def.name} is now level ${r.level}.`) : `Cannot upgrade: ${why(h, r)}`, 3400); break; }
        case 'rush': { const def = buildingDef(id); if (!def) break; r = S.rush(h, s, id); h.toast(r.ok ? `⚡ ${def.name} finished for 🔥${(r.cost | 0).toLocaleString()}.` : `Rush: ${why(h, r)}`, 3200); break; }
        case 'repair': { const def = buildingDef(id); if (!def) break; r = S.repair(h, s, id); h.toast(r.ok ? `🔨 ${def.name} repaired.` : `Repair: ${why(h, r)}`, 3200); break; }
        case 'buy': {
          const a = animalDef(id); if (!a) break;
          r = S.buyAnimal(h, s, id, n, m.ui.carrier, m.ui.escort);
          if (r.ok) m.ui.escort = 0;
          h.toast(r.ok ? `🚚 ${r.shipped} ${r.shipped === 1 ? a.name.toLowerCase() : a.plural.toLowerCase()} ordered. ${r.carrier} is on the road — ETA ${Math.max(1, Math.round((r.arriveAt - Date.now()) / 60000))} min${r.fee ? ', haulage 🔥' + r.fee.toLocaleString() : ''}.` : `Cannot order: ${why(h, r)}`, 4200);
          break;
        }
        case 'feed': { r = S.fillTrough(h, s, id, 1e9); h.toast(r.ok ? `🌾 Added ${r.added} Animal Feed to the trough.` : `Trough: ${why(h, r)}`, 3000); break; }
        case 'collect': {
          r = S.collect(h, s, id);
          if (r.ok) h.toast(`🧺 Collected ${fmtGot(h, r.got)}.${r.clipped ? ' Stash full — the rest waits in the pen.' : ''}`, 4200);
          else if (r.why === 'cooldown') h.toast('🧺 Not yet — pens are collected once per cooldown.', 2600);
          else h.toast(`Collect: ${why(h, r)}`, 3000);
          break;
        }
        case 'slaughter': {
          const a = animalDef(id); if (!a) break;
          if (n > 1) { const ok = await h.confirm(`Send ${n} grown ${a.plural.toLowerCase()} to the block (${FARM_ECON.cuts[m.ui.cut].label.toLowerCase()})? This cannot be undone.`); if (!ok) break; }
          r = S.slaughter(h, s, { sp: id, n }, m.ui.cut);
          h.toast(r.ok ? `🔪 ${r.taken} ${r.taken === 1 ? a.name : a.plural} → ${fmtGot(h, r.got)}.${r.stories.length ? ' ' + r.stories.join(' ') : ''}${r.clipped ? ' ⚠ Stash full — part of the yield was lost.' : ''}` : `Butcher: ${why(h, r)}`, 5000);
          break;
        }
        case 'slaughter-one': {
          const a = S.animalById(s, id | 0); if (!a) break;
          const d = animalDef(a.sp);
          const prize = S.prizeIds(s).has(a.id);
          const ok = await h.confirm(`Send ${a.name} the ${d.name.toLowerCase()}${prize ? ' — your PRIZE beast —' : ''} to the block (${FARM_ECON.cuts[m.ui.cut].label.toLowerCase()})?`);
          if (!ok) break;
          r = S.slaughter(h, s, { ids: [a.id] }, m.ui.cut);
          h.toast(r.ok ? `🔪 ${a.name} → ${fmtGot(h, r.got)}.${r.stories.length ? ' ' + r.stories.join(' ') : ''}` : `Butcher: ${why(h, r)}`, 5000);
          break;
        }
        case 'treat': { const a = S.animalById(s, id | 0); if (!a) break; r = S.treat(h, s, a.id); h.toast(r.ok ? (r.cured ? `💊 ${a.name} is cured of ${FARM_ECON.disease.kinds[r.cured].label.toLowerCase()} (${Math.round(r.health)} health).` : `💊 ${a.name} is at ${Math.round(r.health)} health.`) : `Treat: ${why(h, r)}`, 3000); break; }
        case 'crate': {
          const a = S.animalById(s, id | 0); if (!a) break;
          const ok = await h.confirm(`Crate ${a.name} for the Exchange? You get 1 Livestock crate; the animal leaves the farm.`); if (!ok) break;
          r = S.crate(h, s, a.id); h.toast(r.ok ? `📦 ${a.name} crated. Sell the crate on the Resource Exchange.` : `Crate: ${why(h, r)}`, 3600); break;
        }
        case 'uncrate': { const a = animalDef(id); if (!a) break; r = S.uncrate(h, s, id); h.toast(r.ok ? `📦 ${r.name} the ${a.name.toLowerCase()} came out of the crate, half grown.` : `Uncrate: ${why(h, r)}`, 3600); break; }
        case 'craft': { const rk = t.getAttribute('data-recipe'); r = S.craft(h, s, id, rk, n); h.toast(r.ok ? `⚙ ${r.batches}× → ${fmtGot(h, r.got)}.${r.clipped ? ' ⚠ Stash full — output was clipped.' : ''}` : `Cannot craft: ${why(h, r)}`, 3600); break; }
        case 'deliver': { r = S.deliverDemand(h, s); h.toast(r.ok ? `🚚 Delivered. The town paid ${fmtGot(h, r.got)}. ${r.left} left today.` : `Town: ${why(h, r)}`, 3600); break; }
        case 'rename': m.ui.renaming = id | 0; break;
        case 'consign': {
          const a = S.animalById(s, id | 0); if (!a) break;
          const ok = await h.confirm(`Walk ${a.name} into the Sale Ring? The regulars bid in goods and the hammer falls in ${FARM_ECON.auction.lotMinutes} minutes. No taking it back.`); if (!ok) break;
          r = S.consign(h, s, a.id);
          if (r.ok) { m.tab = 'market'; loadLots(); h.toast(`🏛 ${a.name} is in the ring. Athena: “${r.timeline.athena}”`, 4200); } else h.toast(`Ring: ${why(h, r)}`, 3400);
          break;
        }
        case 'p2p-post': {
          const a = S.animalById(s, id | 0); if (!a) break;
          if (!h.cloud || !h.cloud.ready()) { h.toast('Sign in to list stock for other players.', 3000); break; }
          const value = S.animalValue(s, a); const minBid = Math.max(FARM_ECON.auction.p2p.minBid, Math.round(value * 0.5 / 100) * 100);
          const ok = await h.confirm(`List ${a.name} for other players? Minimum bid 🔥${minBid.toLocaleString()} (half its value), 24 hours. The beast leaves your farm now and comes back only if nobody bids.`); if (!ok) break;
          const took = S.takeAnimalForLot(h, s, a.id); if (!took.ok) { h.toast(`List: ${took.why}`, 3000); break; }
          const animal = took.animal; delete animal.away; delete animal.ill; delete animal.illSince; delete animal.hungry;
          const pr = await lots.post(h, animal, minBid, 24);
          if (pr.ok) { h.toast(`🌐 ${a.name} is listed. Bids settle on the server.`, 3600); m.tab = 'market'; loadLots(); }
          else { S.returnAnimal(h, s, animal); h.toast(`List: ${pr.why}`, 4000); }
          break;
        }
        case 'p2p-refresh': loadLots(); break;
        case 'p2p-bid': {
          const inp = rootEl.querySelector(`[data-fbidamt="${id}"]`); const amt = parseInt(inp ? inp.value : '0', 10) | 0;
          const ok = await h.confirm(`Bid 🔥${amt.toLocaleString()}? It is held in escrow and returned if you are outbid.`); if (!ok) break;
          const br = await lots.bid(h, id, amt);
          h.toast(br.ok ? `🔨 Bid placed: 🔥${amt.toLocaleString()}.` : `Bid: ${br.why}`, 3400);
          /* ⚠ No local spendGems here. The RPC already debited the canonical
             wallet; a client-side spend would be mirrored to wallet_charge and
             debit the bid TWICE. The chip catches up on the next wallet sync. */
          loadLots(); break;
        }
        case 'p2p-settle': { const sr = await lots.settle(h, id); h.toast(sr.ok ? `⚖ Settled: ${sr.data && sr.data.status}${sr.data && sr.data.net ? ' · seller paid 🔥' + Number(sr.data.net).toLocaleString() : ''}.` : `Settle: ${sr.why}`, 3400); loadLots(); break; }
        case 'p2p-claim': {
          const cr = await lots.claim(h, id);
          if (!cr.ok) { h.toast(`Claim: ${cr.why}`, 3400); loadLots(); break; }
          const animal = cr.data && cr.data.animal;
          const rr = S.returnAnimal(h, s, animal || {});
          h.toast(rr.ok ? (rr.held ? `🚧 ${rr.animal.name} is waiting at the gate — make room in the pen.` : `🚪 ${rr.animal.name} is home.`) : `Claimed, but: ${rr.why}`, 3600);
          loadLots(); break;
        }
        case 'contract-accept': { r = S.acceptContract(h, s, id | 0); h.toast(r.ok ? '📜 Contract signed. The clock is running.' : `Contract: ${why(h, r)}`, 3000); break; }
        case 'contract-deliver': { r = S.deliverContract(h, s, id | 0); h.toast(r.ok ? `🚚 Delivered. The town paid ${fmtGot(h, r.got)}. Reputation ${r.rep >= 0 ? '+' : ''}${r.rep}.` : `Contract: ${why(h, r)}`, 4000); break; }
        case 'ranch-refresh': loadRanch(); break;
        case 'ranch-feed': { const rr = await ranch.feed(h, n); h.toast(rr.ok ? `🌾 Added ${rr.added} feed to the ranch.` : `Ranch: ${rr.why}`, 3000); loadRanch(); break; }
        case 'ranch-stock': { const a = animalDef(id); const rr = await ranch.stock(h, id); h.toast(rr.ok ? `${a.emoji} ${rr.name} joins the ranch.` : `Ranch: ${rr.why}`, 3000); loadRanch(); break; }
        case 'ranch-claim': { const rr = await ranch.claim(h); h.toast(rr.ok ? `🧺 Claimed ${fmtGot(h, rr.got)}.` : `Ranch: ${rr.why}`, 3400); loadRanch(); break; }
        case 'ranch-butcher': { const ok = await h.confirm('Send this ranch animal to the block? Your cut follows your feed share.'); if (!ok) break; const rr = await ranch.butcher(h, id | 0); h.toast(rr.ok ? `🔪 Your cut: ${fmtGot(h, rr.got)}.` : `Ranch: ${rr.why}`, 3400); loadRanch(); break; }
        case 'rename-save': { const inp = rootEl.querySelector(`[data-frename="${id}"]`); doRename(id, inp ? inp.value : ''); return; }
        case 'rename-cancel': m.ui.renaming = null; break;
        case 'athena-open': { if (!api.openInAthena()) h.toast('Athena Engine is still loading — try again in a moment.', 2600); break; }
        case 'look-ground': S.setLook(h, s, { ground: id }); break;
        case 'look-sky': S.setLook(h, s, { sky: id }); break;
        case 'look-decor': S.setLook(h, s, { decor: { [id]: !s.look.decor[id] } }); break;
        case 'look-roof-reset': S.setLook(h, s, { roofs: { [id]: null } }); break;
        case 'look-name': { const inp = rootEl.querySelector('[data-fname]'); doName(inp ? inp.value : ''); return; }
        default: return;
      }
    } catch (err) { try { console.warn('[farm] action failed:', err); } catch (x) {} }
    finally { m.busy = false; paint(); }
  }
}

function why(h, r) {
  if (!r) return 'unknown';
  if (r.why === 'short' && r.shortfall) return 'short by ' + Object.keys(r.shortfall).map(k => k === 'cinder' ? `🔥${r.shortfall[k]} Cinder` : `${h.resMeta(k).icon}${r.shortfall[k]} ${h.resMeta(k).name}`).join(', ');
  return r.why || 'unknown';
}

function unmount(which) {
  const m = which || _mounted;
  if (!m) return;
  if (_mounted === m) _mounted = null;
  try { clearInterval(m.tick); } catch (e) {}
  try { if (m.scene) m.scene.destroy(); } catch (e) {}
  try { if (m.onClick) m.root.removeEventListener('click', m.onClick); if (m.onChange) m.root.removeEventListener('change', m.onChange); if (m.onKey) m.root.removeEventListener('keydown', m.onKey); } catch (e) {}
}

const withHost = (fn) => { const h = host(); return h ? fn(h, S.ensureState(h)) : { ok: false, why: 'no bridge' }; };
const api = {
  FARM_ECON, FARM_ANIMALS, FARM_BUILDINGS, FARM_LOOKS, animalDef, buildingDef, buildingCostAt, auditCatalog,
  ready: () => !!makeHost(),
  mount, unmount,
  refresh: () => { try { if (_mounted && _mounted.paint) _mounted.paint(); } catch (e) {} },
  /* ⚒ the mounted 3D scene handle (null in 2D / before the scene resolves) — its `athena` getter is the live overlay */
  scene: () => (_mounted && _mounted.scene) || null,
  state: () => { const h = host(); return h ? S.ensureState(h) : { buildings: {}, animals: [] }; },
  summary: () => { const h = host(); return h ? S.summary(h, S.ensureState(h)) : null; },
  build: (id) => withHost((h, s) => S.build(h, s, id)),
  upgrade: (id) => withHost((h, s) => S.upgrade(h, s, id)),
  repair: (id) => withHost((h, s) => S.repair(h, s, id)),
  buyAnimal: (sp, n, carrier) => withHost((h, s) => S.buyAnimal(h, s, sp, n, carrier)),
  rush: (id) => withHost((h, s) => S.rush(h, s, id)),
  carriers: () => { const h = host(); return h ? S.carriersFor(h) : []; },
  debugShift: (ms) => withHost((h, s) => S.debugShift(h, s, ms)),
  consign: (id) => withHost((h, s) => S.consign(h, s, id)),
  acceptContract: (id) => withHost((h, s) => S.acceptContract(h, s, id)),
  deliverContract: (id) => withHost((h, s) => S.deliverContract(h, s, id)),
  returnAnimal: (a) => withHost((h, s) => S.returnAnimal(h, s, a)),
  cloud: { lots: lots, ranch: ranch },
  /* 🚪 Kitchen door — for operations and the node city (index.html reads these). */
  available: (id) => { const h = host(); return h ? S.available(h, S.ensureState(h), id) : 0; },
  pending: () => { const h = host(); return h ? S.pendingAll(h, S.ensureState(h)) : {}; },
  drawAccrual: (id, n, who) => withHost((h, s) => S.drawAccrual(h, s, id, n, who)),
  fillTrough: (id, n) => withHost((h, s) => S.fillTrough(h, s, id, n)),
  collect: (id) => withHost((h, s) => S.collect(h, s, id)),
  slaughter: (sel, cut) => withHost((h, s) => S.slaughter(h, s, typeof sel === 'string' ? { sp: sel, n: 1 } : sel, cut)),
  craft: (id, rk, n) => withHost((h, s) => S.craft(h, s, id, rk, n)),
  treat: (id) => withHost((h, s) => S.treat(h, s, id)),
  rename: (id, nm) => withHost((h, s) => S.rename(h, s, id, nm)),
  crate: (id) => withHost((h, s) => S.crate(h, s, id)),
  uncrate: (sp) => withHost((h, s) => S.uncrate(h, s, sp)),
  deliverDemand: () => withHost((h, s) => S.deliverDemand(h, s)),
  setLook: (patch) => withHost((h, s) => S.setLook(h, s, patch)),
  tend: () => withHost((h, s) => S.tend(h, s)),
  buyShopItem: (id) => withHost((h, s) => S.buyShopItem(h, s, id)),
  boosts: () => { const h = host(); return h ? S.activeBoosts(S.ensureState(h)) : []; },
  /* 🏆 For a future corp / community contest: lifetime harvest numbers. */
  harvestScore: () => { try { const s = api.state(); return { meat: s.stats.meat | 0, slaughtered: s.stats.slaughtered | 0, births: s.stats.births | 0, raidsRepelled: s.stats.raidsRepelled | 0 }; } catch (e) { return null; } },
  /* ⚒ Athena Engine: the admin opens the live farm scene in the editor */
  openInAthena: () => FarmAthena.openInAthena(),
  athenaAvailable: () => FarmAthena.athenaAvailable(),
  _state: S,
};

try { FarmAthena.registerWithAthena(); } catch (e) {}
try { if (typeof window !== 'undefined') window.MythicFarm = api; } catch (e) {}
