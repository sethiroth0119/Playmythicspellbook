/* ════════════════════════════════════════════════════════════════════════════
   🐄 HOMESTEAD FARM — catalogue + the ONE tuning table (FARM_ECON).
   ----------------------------------------------------------------------------
   Players raise farm animals in buildings they put up with Cinder + resources,
   keep them fed with Animal Feed, collect what the living animals give (eggs,
   milk, wool, feathers, manure) and slaughter stock at the Butcher's Block for
   meat and hides. Stations then refine: hide → leather, wool → cloth,
   meat / eggs / milk → food. Every output lands in the REAL ledger
   (index.html's RESOURCES) so it is tradeable, spendable and visible.

   🔴 THIS FILE IS THE ONE TUNING TABLE for the farm (the `_opEcon()` /
      TERROIR_ECON pattern — CLAUDE.md: "All operation pricing goes through
      _opEcon(). Never hardcode economy numbers"). Every price, rate, cap and
      yield in the farm is in FARM_ECON below. Callers ask; they never carry a
      copy, and render code never holds a number.

   🔴 RESOURCE IDS ARE THE CONTRACT WITH THE LEDGER. The ids used here were
      promoted into index.html's RESOURCES together with this module — the
      chain catalogue (src/resources/chain.js) already named `animalFeed`,
      `eggs`, `rawMilk` and `meat`; `leather` and `fertilizer` already existed
      in SALVAGE_RES; `feathers`, `wool` and `hide` are new and were added to
      chain.js at the same time. RESOURCES_NEXT.md explains why an id must
      never exist in the farm without also being in the ledger: "a resource
      you can hold and be capped by but cannot sell, spend or see is worse
      than a missing one".

   ⏱ The 6h collect cooldown / 36h accrual cap are NOT here. They are the
      game's existing idle contract (OP_COLLECT_CD_MS / OP_ACCRUAL_CAP_H),
      handed over by the bridge, so the farm cannot become a third idle policy.
   ════════════════════════════════════════════════════════════════════════════ */

export const FARM_ECON = {
  /* 🌾 Feed. One trough per building; feed drains per animal per hour.
     An animal with no feed does not die (a punished absence is a quit button)
     — it simply stops producing and stops growing until the trough is filled. */
  feedMillRecipe: { inputs: { food: 8, water: 6 }, output: { animalFeed: 24 } },
  troughCap: 240,                 // feed units one building holds at level 1
  troughCapPerLevel: 120,         // + per level above 1
  grazeDiscount: 0.5,             // pasture animals eat half from the trough

  /* 🧺 Living-animal yields: units per adult per FED hour. Small numbers on
     purpose — 36h of accrual across a full pen is the intended payout. */
  yieldsPerH: {
    chicken: { eggs: 0.35, feathers: 0.08 },
    cow:     { rawMilk: 0.9, fertilizer: 0.12 },
    pig:     { fertilizer: 0.2 },
    sheep:   { wool: 0.3 },
    goat:    { rawMilk: 0.45 },
  },

  /* 🔪 Slaughter — what an ADULT of each species turns into. Young stock
     yields nothing; the Butcher refuses it rather than wasting the animal. */
  slaughter: {
    chicken: { meat: 2,  feathers: 3 },
    cow:     { meat: 12, hide: 3, fertilizer: 1 },
    pig:     { meat: 8,  hide: 2 },
    sheep:   { meat: 5,  hide: 1, wool: 2 },
    goat:    { meat: 4,  hide: 1 },
  },
  butcherBonusPerLevel: 0.15,     // Butcher's Block L2 = +15%, L3 = +30%

  /* 🐣 Buying and growing. `growH` is FED hours to adulthood. */
  animals: {
    chicken: { cinder: 1800,  feedPerH: 0.6, growH: 6  },
    cow:     { cinder: 14000, feedPerH: 2.4, growH: 24 },
    pig:     { cinder: 6500,  feedPerH: 1.8, growH: 14 },
    sheep:   { cinder: 5200,  feedPerH: 1.2, growH: 12 },
    goat:    { cinder: 4200,  feedPerH: 1.0, growH: 10 },
  },
  /* 🐄 Breeding — an adult PAIR (or more) in a fed pen has a chance per fed
     hour of adding one young animal, if the pen has room. Keeps a herd
     self-sustaining without making animals free. */
  breedChancePerH: {
    chicken: 0.05, cow: 0.008, pig: 0.02, sheep: 0.015, goat: 0.018,
  },

  /* 🏭 Station recipes — instant crafts, batch sizes chosen so the input
     stack is never worth more than the output in the Exchange's terms. */
  recipes: {
    tannery:  { inputs: { hide: 3, water: 2 },  output: { leather: 2 } },
    spinner:  { inputs: { wool: 4 },            output: { cloth: 3 } },
    kitchenMeat: { inputs: { meat: 4 },         output: { food: 6 } },
    kitchenEggs: { inputs: { eggs: 6 },         output: { food: 4 } },
    kitchenMilk: { inputs: { rawMilk: 6 },      output: { food: 5 } },
  },
  recipeBonusPerLevel: 0.25,      // a level-2 station gives +25% output, L3 +50%
};

/* ── Species ────────────────────────────────────────────────────────────────
   `pen` is the building that houses the species. `ground` lets a species
   graze (halves feed draw — FARM_ECON.grazeDiscount). Colours / size feed the
   3D scene; nothing economic lives here. */
export const FARM_ANIMALS = [
  { id: 'chicken', name: 'Chicken', plural: 'Chickens', emoji: '🐔', pen: 'coop',
    desc: 'Eggs while it lives, meat and feathers when it does not.',
    gives: ['eggs', 'feathers'], butchers: ['meat', 'feathers'],
    size: 0.32, colors: { body: 0xf2e8d5, head: 0xf2e8d5, accent: 0xd8352a, legs: 0xe0a13c } },
  { id: 'cow', name: 'Cow', plural: 'Cows', emoji: '🐄', pen: 'barn',
    desc: 'The big investment. Milk daily, a lot of meat and hide at the end.',
    gives: ['rawMilk', 'fertilizer'], butchers: ['meat', 'hide', 'fertilizer'],
    size: 1.0, colors: { body: 0xf4f1ea, head: 0xf4f1ea, accent: 0x2a2320, legs: 0x3a2f2a } },
  { id: 'pig', name: 'Pig', plural: 'Pigs', emoji: '🐖', pen: 'sty',
    desc: 'Grows fast and grows fat. Kept for the block, not the pail.',
    gives: ['fertilizer'], butchers: ['meat', 'hide'],
    size: 0.62, colors: { body: 0xf0a8b8, head: 0xf0a8b8, accent: 0xd88898, legs: 0xd88898 } },
  { id: 'sheep', name: 'Sheep', plural: 'Sheep', emoji: '🐑', pen: 'pasture', ground: true,
    desc: 'Wool every season without touching it. The Spinning Shed turns it into cloth.',
    gives: ['wool'], butchers: ['meat', 'hide', 'wool'],
    size: 0.58, colors: { body: 0xfaf6ee, head: 0x2b2622, accent: 0xfaf6ee, legs: 0x2b2622 } },
  { id: 'goat', name: 'Goat', plural: 'Goats', emoji: '🐐', pen: 'pasture', ground: true,
    desc: 'Cheap milk on rough ground. Eats less than a cow and complains more.',
    gives: ['rawMilk'], butchers: ['meat', 'hide'],
    size: 0.55, colors: { body: 0xc9b8a0, head: 0xb8a48c, accent: 0x5a4a3a, legs: 0x8a7660 } },
];

/* ── Buildings and stations ─────────────────────────────────────────────────
   Every entry costs Cinder AND at least two resources, mirroring the city
   catalogue rule. `plot` is a fixed spot on the 3D homestead (tiles; the
   farm is 14×14). Pens have `houses` (species) + `capacity(level)`; stations
   have `station: true` and a recipe key or role.

   📦 UI ORDER IS DELIBERATE, as in the city catalogue: the Feed Mill is first
   because nothing produces without feed, and a player who builds a Coop
   first watches hens do nothing — that reads as broken, not as hungry. */
export const FARM_BUILDINGS = [
  {
    id: 'feedmill', name: 'Feed Mill', emoji: '🌾', accent: '#d9c46a', station: true, role: 'feed',
    desc: 'Grinds rations and water into Animal Feed. Nothing on the farm eats without it.',
    maxLevel: 3, plot: { x: 1, y: 1, w: 3, h: 2 },
    cost: [
      { cinder: 22000, wood: 30, stone: 20, water: 10 },
      { cinder: 60000, wood: 70, stone: 45, metal: 20 },
      { cinder: 150000, wood: 150, stone: 100, metal: 60 },
    ],
  },
  {
    id: 'coop', name: 'Chicken Coop', emoji: '🐔', accent: '#e8c07a', houses: ['chicken'],
    desc: 'Roosts and nesting boxes. Six birds a level.',
    maxLevel: 3, plot: { x: 5, y: 1, w: 2, h: 2 }, yard: { x: 5, y: 3, w: 3, h: 3 },
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
    maxLevel: 3, plot: { x: 9, y: 1, w: 4, h: 3 }, yard: { x: 9, y: 4, w: 4, h: 4 },
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
    maxLevel: 3, plot: { x: 1, y: 5, w: 3, h: 2 }, yard: { x: 1, y: 7, w: 3, h: 3 },
    capacity: lv => 4 * lv,
    cost: [
      { cinder: 45000, wood: 60, stone: 30, water: 20 },
      { cinder: 110000, wood: 130, stone: 70, water: 45 },
      { cinder: 260000, wood: 260, stone: 150, water: 100, metal: 30 },
    ],
  },
  {
    id: 'pasture', name: 'Fenced Pasture', emoji: '🐑', accent: '#8fc46a', houses: ['sheep', 'goat'],
    desc: 'Grass and a fence. Sheep and goats graze here, and grazing halves what they eat from the trough.',
    maxLevel: 3, plot: { x: 5, y: 7, w: 3, h: 2 }, yard: { x: 5, y: 9, w: 4, h: 4 },
    capacity: lv => 5 * lv,
    cost: [
      { cinder: 40000, wood: 80, stone: 10 },
      { cinder: 100000, wood: 170, stone: 30, cloth: 20 },
      { cinder: 240000, wood: 340, stone: 70, cloth: 50, metal: 20 },
    ],
  },
  {
    id: 'butcher', name: "Butcher's Block", emoji: '🔪', accent: '#b8404a', station: true, role: 'slaughter',
    desc: 'Where stock becomes meat, hide and feathers. Higher levels waste less of the animal.',
    maxLevel: 3, plot: { x: 10, y: 9, w: 2, h: 2 },
    cost: [
      { cinder: 35000, wood: 30, metal: 25, water: 15 },
      { cinder: 90000, wood: 60, metal: 60, water: 30 },
      { cinder: 210000, wood: 120, metal: 140, water: 60, supplies: 30 },
    ],
  },
  {
    id: 'tannery', name: 'Tannery', emoji: '🧥', accent: '#a0704a', station: true, role: 'craft', recipes: ['tannery'],
    desc: 'Cures raw hide into leather. Downwind of everything, for a reason.',
    maxLevel: 3, plot: { x: 12, y: 11, w: 2, h: 2 },
    cost: [
      { cinder: 48000, wood: 50, stone: 40, water: 30 },
      { cinder: 120000, wood: 100, stone: 90, water: 60, metal: 20 },
      { cinder: 280000, wood: 200, stone: 180, water: 120, metal: 50 },
    ],
  },
  {
    id: 'spinner', name: 'Spinning Shed', emoji: '🧵', accent: '#e0b8c8', station: true, role: 'craft', recipes: ['spinner'],
    desc: 'Cards and spins wool into cloth — the same cloth the city builder already prices.',
    maxLevel: 3, plot: { x: 1, y: 11, w: 3, h: 2 },
    cost: [
      { cinder: 42000, wood: 60, cloth: 15, metal: 10 },
      { cinder: 105000, wood: 120, cloth: 35, metal: 25 },
      { cinder: 250000, wood: 240, cloth: 80, metal: 60 },
    ],
  },
  {
    id: 'kitchen', name: 'Farm Kitchen', emoji: '🍳', accent: '#ffcf6b', station: true, role: 'craft',
    recipes: ['kitchenMeat', 'kitchenEggs', 'kitchenMilk'],
    desc: 'Smokes meat, boils eggs, sets milk: everything the farm makes can become rations.',
    maxLevel: 3, plot: { x: 5, y: 13, w: 3, h: 1 },
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

export function animalDef(id) { return FARM_ANIMALS.find(a => a.id === id) || null; }
export function buildingDef(id) { return FARM_BUILDINGS.find(b => b.id === id) || null; }
export function penFor(speciesId) {
  const a = animalDef(speciesId);
  return a ? buildingDef(a.pen) : null;
}
/* Level-indexed cost, clamped to the last row so an out-of-range level can
   never price at `undefined` (which canAfford would read as free). */
export function buildingCostAt(def, level) {
  if (!def || !Array.isArray(def.cost) || !def.cost.length) return null;
  const i = Math.max(0, Math.min(def.cost.length - 1, (level | 0) - 1));
  return def.cost[i];
}

/* Every ledger id the farm can pay out or consume — the promotion contract.
   auditCatalog() checks this list against the live ledger at mount. */
export const FARM_RESOURCE_IDS = [
  'animalFeed', 'eggs', 'feathers', 'rawMilk', 'meat', 'wool', 'hide', 'leather', 'fertilizer',
  'food', 'water', 'wood', 'stone', 'cloth', 'metal', 'supplies',
];

export function auditCatalog(knownIds) {
  const known = new Set(knownIds || []);
  const missing = [];
  const need = new Set(FARM_RESOURCE_IDS);
  Object.values(FARM_ECON.yieldsPerH).forEach(y => Object.keys(y).forEach(k => need.add(k)));
  Object.values(FARM_ECON.slaughter).forEach(y => Object.keys(y).forEach(k => need.add(k)));
  Object.values(FARM_ECON.recipes).forEach(r => { Object.keys(r.inputs).forEach(k => need.add(k)); Object.keys(r.output).forEach(k => need.add(k)); });
  FARM_BUILDINGS.forEach(b => b.cost.forEach(c => Object.keys(c).forEach(k => { if (k !== 'cinder') need.add(k); })));
  need.forEach(id => { if (!known.has(id)) missing.push(id); });
  return missing;
}
