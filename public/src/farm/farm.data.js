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

export const FARM_ECON = {
  /* 🌾 Feed. One trough per building; feed drains per animal per hour. */
  feedMillRecipe: { inputs: { food: 8, water: 6 }, output: { animalFeed: 24 } },
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
  },
  recipeBonusPerLevel: 0.25,
};

/* ── Species ─────────────────────────────────────────────────────────────── */
export const FARM_ANIMALS = [
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
export const FARM_BUILDINGS = [
  {
    id: 'feedmill', name: 'Feed Mill', emoji: '🌾', accent: '#d9c46a', station: true, role: 'feed',
    desc: 'Grinds rations and water into Animal Feed. Nothing on the farm eats without it.',
    maxLevel: 3, buildH: [0.5, 2, 6], plot: { x: 1, y: 1, w: 3, h: 2 },
    cost: [
      { cinder: 22000, wood: 30, stone: 20, water: 10 },
      { cinder: 60000, wood: 70, stone: 45, metal: 20 },
      { cinder: 150000, wood: 150, stone: 100, metal: 60 },
    ],
  },
  {
    id: 'coop', name: 'Chicken Coop', emoji: '🐔', accent: '#e8c07a', houses: ['chicken'],
    desc: 'Roosts and nesting boxes. Six birds a level. Higher levels mean a stouter fence.',
    maxLevel: 3, buildH: [0.75, 2.5, 6], plot: { x: 5, y: 1, w: 2, h: 2 }, yard: { x: 5, y: 3, w: 3, h: 3 },
    capacity: lv => 6 * lv,
    cost: [
      { cinder: 30000, wood: 40, cloth: 10 },
      { cinder: 75000, wood: 90, cloth: 25, metal: 15 },
      { cinder: 180000, wood: 180, cloth: 60, metal: 40 },
    ],
  },
  {
    id: 'barn', name: 'Cattle Barn', emoji: '🐄', accent: '#c25a3a', houses: ['cow'],
    desc: 'Stalls and a milking bay. Three head a level — cattle need room.',
    maxLevel: 3, buildH: [4, 10, 24], plot: { x: 9, y: 1, w: 4, h: 3 }, yard: { x: 9, y: 4, w: 4, h: 4 },
    capacity: lv => 3 * lv,
    cost: [
      { cinder: 90000, wood: 120, stone: 60, metal: 30 },
      { cinder: 220000, wood: 260, stone: 140, metal: 80 },
      { cinder: 520000, wood: 520, stone: 300, metal: 180, supplies: 60 },
    ],
  },
  {
    id: 'sty', name: 'Pig Sty', emoji: '🐖', accent: '#e090a8', houses: ['pig'],
    desc: 'Mud, a roof, a trough. Four pigs a level and they will fill it.',
    maxLevel: 3, buildH: [1.5, 4, 10], plot: { x: 1, y: 5, w: 3, h: 2 }, yard: { x: 1, y: 7, w: 3, h: 3 },
    capacity: lv => 4 * lv,
    cost: [
      { cinder: 45000, wood: 60, stone: 30, water: 20 },
      { cinder: 110000, wood: 130, stone: 70, water: 45 },
      { cinder: 260000, wood: 260, stone: 150, water: 100, metal: 30 },
    ],
  },
  {
    id: 'pasture', name: 'Fenced Pasture', emoji: '🐑', accent: '#8fc46a', houses: ['sheep', 'goat'],
    desc: 'Grass and a fence. Sheep and goats graze here; how well depends on the ground your camp stands on.',
    maxLevel: 3, buildH: [1, 3, 8], plot: { x: 5, y: 7, w: 3, h: 2 }, yard: { x: 5, y: 9, w: 4, h: 4 },
    capacity: lv => 5 * lv,
    cost: [
      { cinder: 40000, wood: 80, stone: 10 },
      { cinder: 100000, wood: 170, stone: 30, cloth: 20 },
      { cinder: 240000, wood: 340, stone: 70, cloth: 50, metal: 20 },
    ],
  },
  {
    id: 'guardpost', name: 'Guard Post', emoji: '🐕', accent: '#a8b0c0', houses: ['terrier', 'collie', 'mastiff', 'donkey'],
    desc: 'A doghouse and a lantern. Guards kennel here and patrol every pen. Two a level.',
    maxLevel: 3, buildH: [0.75, 2, 5], plot: { x: 12, y: 8, w: 2, h: 1 }, yard: { x: 12, y: 9, w: 2, h: 2 },
    capacity: lv => 2 * lv,
    cost: [
      { cinder: 28000, wood: 35, stone: 15, cloth: 5 },
      { cinder: 70000, wood: 80, stone: 40, metal: 15 },
      { cinder: 170000, wood: 160, stone: 90, metal: 40 },
    ],
  },
  {
    id: 'butcher', name: "Butcher's Block", emoji: '🔪', accent: '#b8404a', station: true, role: 'slaughter',
    desc: 'Where stock becomes meat, hide and feathers. Higher levels waste less and unlock the trophy cut.',
    maxLevel: 3, buildH: [1, 3, 8], plot: { x: 10, y: 9, w: 2, h: 2 },
    cost: [
      { cinder: 35000, wood: 30, metal: 25, water: 15 },
      { cinder: 90000, wood: 60, metal: 60, water: 30 },
      { cinder: 210000, wood: 120, metal: 140, water: 60, supplies: 30 },
    ],
  },
  {
    id: 'tannery', name: 'Tannery', emoji: '🧥', accent: '#a0704a', station: true, role: 'craft', recipes: ['tannery'],
    desc: 'Cures raw hide into leather. Downwind of everything, for a reason.',
    maxLevel: 3, buildH: [2, 5, 12], plot: { x: 12, y: 11, w: 2, h: 2 },
    cost: [
      { cinder: 48000, wood: 50, stone: 40, water: 30 },
      { cinder: 120000, wood: 100, stone: 90, water: 60, metal: 20 },
      { cinder: 280000, wood: 200, stone: 180, water: 120, metal: 50 },
    ],
  },
  {
    id: 'spinner', name: 'Spinning Shed', emoji: '🧵', accent: '#e0b8c8', station: true, role: 'craft', recipes: ['spinner'],
    desc: 'Cards and spins wool into cloth — the same cloth the city builder already prices.',
    maxLevel: 3, buildH: [1.5, 4, 10], plot: { x: 1, y: 11, w: 3, h: 2 },
    cost: [
      { cinder: 42000, wood: 60, cloth: 15, metal: 10 },
      { cinder: 105000, wood: 120, cloth: 35, metal: 25 },
      { cinder: 250000, wood: 240, cloth: 80, metal: 60 },
    ],
  },
  {
    id: 'vet', name: 'Vet Clinic', emoji: '🩺', accent: '#ff8aa0', station: true, role: 'vet',
    desc: 'Treats sick stock from the medicine stash every hour it is open, and halves the odds of an outbreak. Higher levels cure faster.',
    maxLevel: 3, buildH: [2, 5, 12], plot: { x: 1, y: 13, w: 3, h: 1 },
    cost: [
      { cinder: 55000, wood: 50, metal: 25, medicine: 6 },
      { cinder: 140000, wood: 100, metal: 60, medicine: 15 },
      { cinder: 330000, wood: 200, metal: 140, medicine: 35, supplies: 30 },
    ],
  },
  {
    id: 'salering', name: 'Sale Ring', emoji: '🏛', accent: '#d4af37', station: true, role: 'auction',
    desc: 'The auction ring. Consign a prize or rare beast on sale day and Athena calls the bids — in goods from the ring\'s regulars, or in Cinder from other players.',
    maxLevel: 2, buildH: [3, 8], plot: { x: 12, y: 13, w: 2, h: 1 },
    cost: [
      { cinder: 80000, wood: 90, stone: 60, cloth: 20 },
      { cinder: 220000, wood: 200, stone: 140, cloth: 50, metal: 40 },
    ],
  },
  {
    id: 'kitchen', name: 'Farm Kitchen', emoji: '🍳', accent: '#ffcf6b', station: true, role: 'craft',
    recipes: ['kitchenMeat', 'kitchenEggs', 'kitchenMilk'],
    desc: 'Smokes meat, boils eggs, sets milk: everything the farm makes can become rations.',
    maxLevel: 3, buildH: [1.5, 4, 10], plot: { x: 5, y: 13, w: 3, h: 1 },
    cost: [
      { cinder: 38000, wood: 40, stone: 30, metal: 15 },
      { cinder: 95000, wood: 80, stone: 70, metal: 35 },
      { cinder: 230000, wood: 160, stone: 150, metal: 80, supplies: 25 },
    ],
  },
];

export const FARM_GRID = { w: 14, h: 14 };

export const RECIPE_LABELS = {
  tannery: 'Cure hide → leather',
  spinner: 'Spin wool → cloth',
  kitchenMeat: 'Smoke meat → food',
  kitchenEggs: 'Boil eggs → food',
  kitchenMilk: 'Set milk → food',
};

/* 🅰 Athena Editor — the owner's look settings. Palettes are named so the
   scene and the editor share one vocabulary; `roof` overrides per building. */
export const FARM_LOOKS = {
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

export function animalDef(id) { return FARM_ANIMALS.find(a => a.id === id) || null; }
export function buildingDef(id) { return FARM_BUILDINGS.find(b => b.id === id) || null; }
export function penFor(speciesId) {
  const a = animalDef(speciesId);
  return a ? buildingDef(a.pen) : null;
}
export function buildingCostAt(def, level) {
  if (!def || !Array.isArray(def.cost) || !def.cost.length) return null;
  const i = Math.max(0, Math.min(def.cost.length - 1, (level | 0) - 1));
  return def.cost[i];
}

/* Every ledger id the farm can pay out or consume — the promotion contract. */
export const FARM_RESOURCE_IDS = [
  'animalFeed', 'eggs', 'feathers', 'rawMilk', 'meat', 'wool', 'hide', 'leather', 'fertilizer', 'livestock',
  'food', 'water', 'wood', 'stone', 'cloth', 'metal', 'supplies', 'medicine', 'memoryShards', 'dna', 'fuel', 'ammo',
];

export function auditCatalog(knownIds) {
  const known = new Set(knownIds || []);
  const missing = [];
  const need = new Set(FARM_RESOURCE_IDS);
  Object.values(FARM_ECON.yieldsPerH).forEach(y => Object.keys(y).forEach(k => need.add(k)));
  Object.values(FARM_ECON.slaughter).forEach(y => Object.keys(y).forEach(k => need.add(k)));
  Object.values(FARM_ECON.recipes).forEach(r => { Object.keys(r.inputs).forEach(k => need.add(k)); Object.keys(r.output).forEach(k => need.add(k)); });
  FARM_ECON.townDemand.offers.forEach(o => { Object.keys(o.give).forEach(k => need.add(k)); Object.keys(o.get).forEach(k => need.add(k)); });
  FARM_ECON.contracts.templates.forEach(o => { Object.keys(o.give).forEach(k => need.add(k)); Object.keys(o.get).forEach(k => need.add(k)); });
  Object.keys(FARM_ECON.auction.payoutPer1000).forEach(k => need.add(k));
  Object.values(FARM_ECON.events).forEach(e => { Object.keys(e.loot || {}).forEach(k => need.add(k)); Object.keys(e.gift || {}).forEach(k => need.add(k)); Object.keys(e.repair || {}).forEach(k => need.add(k)); });
  FARM_BUILDINGS.forEach(b => b.cost.forEach(c => Object.keys(c).forEach(k => { if (k !== 'cinder') need.add(k); })));
  need.forEach(id => { if (!known.has(id)) missing.push(id); });
  return missing;
}
