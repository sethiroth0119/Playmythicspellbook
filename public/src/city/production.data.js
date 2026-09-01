/* ════════════════════════════════════════════════════════════════════════════
   🏭 CITY_PRODUCTION — placeable buildings that YIELD resources.
   ----------------------------------------------------------------------------
   Spec: CLAUDE_TASK_buildings.md §3.

   🔴 THIS IS DELIBERATELY NOT MERGED INTO CAMP_FACILITIES, and that is the whole
   design decision. Those are three different things that only look alike:
     • CAMP_FACILITIES  — grant BONUSES (slots, multipliers). No placement, no
                          throughput, no inputs. `bonus: lv => ({…})`.
     • CAMP_BUILDINGS   — screen PORTALS. `{door, route}`; they run a transition
                          and nothing else.
     • CITY_PRODUCTION  — this. Buildings that consume inputs, occupy the city
                          grid, draw power/water/labour and produce resources
                          over time.
   Folding production into CAMP_FACILITIES would mean every facility read site
   (campBonus, resolveReadyCampBuilds, the facility grid, the admin cost editor)
   grew a "…but is it a factory?" branch, and every production read site grew the
   mirror of it. Two catalogs with one shared COST GRAMMAR is the cheaper seam.

   Every entry:
     yields   — resource units per collection cycle at level 1
     inputs   — resources CONSUMED per cycle. Production HALTS without them.
     draw     — city load: power, water, workers, pollution
     cost[]   — build/upgrade cost per level, as a resource dict (see cost.js)

   ⚠ Rates here are tuning starting points, NOT an authority. If a _cityEcon()
   tuning path is ever added (the analogue of _opEcon() for operations), route
   these through it rather than copying numbers out — CLAUDE.md: "All operation
   pricing goes through _opEcon(). Never hardcode economy numbers." Production
   has no such path YET, which is why the literals are here and why this comment
   exists to be deleted by whoever adds one.
   ════════════════════════════════════════════════════════════════════════════ */

/* 🧰 The catalogue, for the chain producers appended at the bottom of this file.
   🔴 THE QUERY STRING IS DELIBERATE AND MUST MATCH index.html's <script> tag for
      chain.js EXACTLY. An ES module is keyed by URL, so `../resources/chain.js`
      and `../resources/chain.js?v=v120w6chain2` are TWO instances of the same
      file: both parse, both register window.MythicResourceChain, and the second
      one to run wins. That is harmless today (the module is pure data) but it is
      2× the parse of a 258-entry table on every load and it is the kind of thing
      that stops being harmless the moment anyone gives chain.js state.
      round0p of tools/economy-tests/run.mjs asserts the two strings match, so a
      bump in index.html that forgets this line turns the gate red instead of
      silently double-loading. */
import { CHAIN_BY_ID } from '../resources/chain.js?v=v120w6chain2';

/* 📦 UI ORDER IS LOAD-BEARING — THE WAREHOUSE IS FIRST ON PURPOSE.
   Production halts at full storage. A player who builds a Hydroponics Bay first
   watches it fill its buffer and stop, which reads as a broken building rather
   than as a storage cap. Storage, then power, then labour, then the producers:
   the three utilities are what make any of the rest work, so they are what the
   blueprint list offers first. Do not "tidy" this into alphabetical order. */
export const CITY_PRODUCTION = [
  // ───────────────────────── UTILITIES (no yield, but required) ─────────────
  {
    id: 'warehouse', name: 'Warehouse', kind: 'utility', emoji: '📦', accent: '#d4af37',
    desc: 'Raises the stash ceiling. Without it every producer fills its buffer and stops.',
    maxLevel: 3,
    yields: null, inputs: null,
    draw: { power: 5, water: 0, workers: 2, pollution: 0 },
    // +2,000 storage at L1, scaling with level.
    effect: lv => ({ storage: 2000 * lv }),
    footprint: { w: 2, h: 2 },
    /* ⚠ THE TASK DOC CONTRADICTS ITSELF HERE AND THE STRICTER RULE WINS.
       §3 states "Every building costs at least three different resources", but
       the utility table then prices the Warehouse at "cinder 50k, metal 80,
       supplies 60" — two resource legs. The `water: 15` below is the third.
       It is deliberately tiny: the Warehouse is the building players are told
       to put up first, so it must stay the cheapest thing in the list. Raising
       it further would fight the onboarding the catalog order exists to serve. */
    cost: [
      { cinder: 50000,  metal: 80,  supplies: 60,  water: 15 },
      { cinder: 125000, metal: 185, supplies: 140, fuel: 35 },
      { cinder: 295000, metal: 400, supplies: 310, fuel: 90, memoryShards: 8 },
    ],
  },
  {
    id: 'powerplant', name: 'Power Plant', kind: 'utility', emoji: '⚡', accent: '#8affd6',
    desc: 'Feeds the grid. Unpowered buildings run at 40% — or not at all.',
    maxLevel: 3,
    yields: null, inputs: { fuel: 25 },
    draw: { power: 0, water: 10, workers: 6, pollution: 22 },
    effect: lv => ({ power: 250 * lv, radius: 4 }),
    footprint: { w: 3, h: 3 },
    cost: [
      { cinder: 140000, metal: 120, supplies: 90,  fuel: 60 },
      { cinder: 335000, metal: 275, supplies: 210, fuel: 145, ammo: 25 },
      { cinder: 790000, metal: 590, supplies: 455, fuel: 320, ammo: 60, corruptedEssence: 14 },
    ],
  },
  {
    id: 'tenements', name: 'Tenements', kind: 'utility', emoji: '🏢', accent: '#c9a86a',
    desc: 'Homes. Every producer needs crew, and crew have to live somewhere.',
    maxLevel: 3,
    yields: null, inputs: { food: 20, water: 25 },
    draw: { power: 12, water: 0, workers: 0, pollution: 4 },
    effect: lv => ({ workers: 25 * lv, population: 40 * lv }),
    footprint: { w: 2, h: 3 },
    cost: [
      { cinder: 70000,  metal: 60,  supplies: 110, water: 30 },
      { cinder: 170000, metal: 140, supplies: 255, water: 75,  food: 45 },
      { cinder: 400000, metal: 300, supplies: 545, water: 165, food: 100, dna: 8 },
    ],
  },

  // ───────────────────────── PRODUCERS — one per resource ───────────────────
  {
    id: 'hydroponics', name: 'Hydroponics Bay', kind: 'production', emoji: '🥬', accent: '#9ad17a',
    desc: 'Racked greens under sodium light. Thirsty, but it feeds the city.',
    maxLevel: 3,
    yields: { food: 45 }, inputs: { water: 30 },
    draw: { power: 15, water: 30, workers: 6, pollution: 0 },
    footprint: { w: 3, h: 2 },
    // Costs no food — a food building bootstrapped from food is an infinite loop.
    cost: [
      { cinder: 45000,  metal: 40,  supplies: 30,  water: 20 },
      { cinder: 110000, metal: 95,  supplies: 70,  water: 50,  fuel: 20 },
      { cinder: 260000, metal: 210, supplies: 160, water: 120, fuel: 55, dna: 8 },
    ],
  },
  {
    id: 'wellhead', name: 'Water Reclaimer', kind: 'production', emoji: '💧', accent: '#7fd6ff',
    desc: 'Pulls the grey back out of the ground and makes it drinkable.',
    maxLevel: 3,
    yields: { water: 60 }, inputs: { supplies: 5 },
    draw: { power: 25, water: 0, workers: 4, pollution: 0 },
    footprint: { w: 2, h: 2 },
    cost: [
      { cinder: 55000,  metal: 50,  supplies: 35,  fuel: 15 },
      { cinder: 130000, metal: 115, supplies: 80,  fuel: 40, ammo: 12 },
      { cinder: 310000, metal: 250, supplies: 180, fuel: 95, ammo: 30, memoryShards: 5 },
    ],
  },
  {
    id: 'foundry', name: 'Smelting Foundry', kind: 'production', emoji: '🏭', accent: '#9fb4d8',
    desc: 'Scrap in, ingots out. The air downwind is not free.',
    maxLevel: 3,
    yields: { metal: 40 }, inputs: { fuel: 20 },
    draw: { power: 35, water: 0, workers: 8, pollution: 18 },
    footprint: { w: 3, h: 3 },
    // Produces metal, priced mostly in fuel + supplies. Rule 1 of §3.
    cost: [
      { cinder: 60000,  metal: 20,  supplies: 45,  fuel: 30 },
      { cinder: 145000, metal: 55,  supplies: 110, fuel: 75,  ammo: 15 },
      { cinder: 340000, metal: 130, supplies: 250, fuel: 170, ammo: 40, memoryShards: 6 },
    ],
  },
  {
    id: 'refinery', name: 'Fuel Refinery', kind: 'production', emoji: '⛽', accent: '#ffcf6b',
    desc: 'Cracks sludge into burnable fuel. Keep it away from the munitions bench.',
    maxLevel: 3,
    yields: { fuel: 38 }, inputs: { metal: 12, water: 20 },
    draw: { power: 30, water: 20, workers: 7, pollution: 26, fireRisk: 'high' },
    footprint: { w: 3, h: 3 },
    cost: [
      { cinder: 75000,  metal: 70,  supplies: 50,  water: 30 },
      { cinder: 180000, metal: 160, supplies: 120, water: 70,  ammo: 18 },
      { cinder: 420000, metal: 350, supplies: 270, water: 160, ammo: 45, corruptedEssence: 10 },
    ],
  },
  {
    id: 'munitions', name: 'Munitions Bench', kind: 'production', emoji: '🔫', accent: '#e0a060',
    desc: 'Presses brass and packs powder. Do not smoke.',
    maxLevel: 3,
    yields: { ammo: 30 }, inputs: { metal: 25, fuel: 8 },
    draw: { power: 12, water: 0, workers: 5, pollution: 6, fireRisk: 'high' },
    footprint: { w: 2, h: 2 },
    cost: [
      { cinder: 65000,  metal: 60,  supplies: 40,  fuel: 25 },
      { cinder: 155000, metal: 140, supplies: 95,  fuel: 60,  water: 30 },
      { cinder: 365000, metal: 300, supplies: 215, fuel: 135, water: 70, memoryShards: 7 },
    ],
  },
  {
    id: 'apothecary', name: 'Apothecary', kind: 'production', emoji: '💊', accent: '#ff8aa0',
    desc: 'Distils what the infirmary burns through.',
    maxLevel: 3,
    yields: { medicine: 18 }, inputs: { water: 25, food: 10 },
    draw: { power: 20, water: 25, workers: 5, pollution: 3 },
    footprint: { w: 2, h: 2 },
    cost: [
      { cinder: 80000,  metal: 55,  supplies: 45,  water: 35 },
      { cinder: 190000, metal: 125, supplies: 105, water: 80,  food: 40 },
      { cinder: 450000, metal: 270, supplies: 235, water: 180, food: 90, dna: 9 },
    ],
  },
  {
    id: 'depot', name: 'Supply Workshop', kind: 'production', emoji: '📦', accent: '#d4af37',
    desc: 'Crates, webbing, spare everything. The least glamorous building you own.',
    maxLevel: 3,
    yields: { supplies: 50 }, inputs: { metal: 18, fuel: 10 },
    draw: { power: 15, water: 0, workers: 7, pollution: 5 },
    footprint: { w: 3, h: 2 },
    // Costs no supplies — see rule 1. A supply shop that pays for itself in
    // supplies is a money printer with extra steps.
    cost: [
      { cinder: 55000,  metal: 65,  fuel: 30,  food: 20 },
      { cinder: 135000, metal: 150, fuel: 75,  food: 50,  water: 35 },
      { cinder: 320000, metal: 320, fuel: 165, food: 110, water: 80, memoryShards: 6 },
    ],
  },
  {
    id: 'bottling', name: 'Bottling Line', kind: 'production', emoji: '🥤', accent: '#ffd166',
    desc: 'Sugar, caffeine and something the label does not name.',
    maxLevel: 3,
    yields: { energyDrink: 22 }, inputs: { water: 35, food: 12 },
    draw: { power: 18, water: 35, workers: 4, pollution: 7 },
    footprint: { w: 2, h: 2 },
    cost: [
      { cinder: 60000,  metal: 50,  supplies: 40,  water: 30 },
      { cinder: 145000, metal: 115, supplies: 90,  water: 70,  food: 35 },
      { cinder: 340000, metal: 245, supplies: 200, water: 155, food: 80, dna: 7 },
    ],
  },
  {
    id: 'sump', name: 'Containment Sump', kind: 'production', emoji: '🟣', accent: '#b06bff',
    desc: 'Bleeds the corruption out of the water table and bottles it. Runs hot.',
    maxLevel: 3,
    yields: { corruptedEssence: 8 }, inputs: { medicine: 10 },
    draw: { power: 45, water: 0, workers: 5, pollution: 30, heat: 15 },
    footprint: { w: 2, h: 2 },
    cost: [
      { cinder: 110000, metal: 90,  supplies: 70,  medicine: 20 },
      { cinder: 265000, metal: 200, supplies: 160, medicine: 50,  memoryShards: 8 },
      { cinder: 620000, metal: 430, supplies: 340, medicine: 120, memoryShards: 22, dna: 10 },
    ],
  },
  {
    id: 'archive', name: 'Memory Archive', kind: 'production', emoji: '🧠', accent: '#7fb8ff',
    desc: 'Cold storage for things people would rather forget. Enormously power-hungry.',
    maxLevel: 3,
    yields: { memoryShards: 4 }, inputs: { supplies: 20 },
    draw: { power: 60, water: 0, workers: 4, pollution: 0 },
    footprint: { w: 2, h: 3 },
    cost: [
      { cinder: 90000,  metal: 70,  supplies: 55,  memoryShards: 3,  corruptedEssence: 2 },
      { cinder: 220000, metal: 160, supplies: 130, memoryShards: 10, corruptedEssence: 6,  dna: 4 },
      { cinder: 520000, metal: 340, supplies: 290, memoryShards: 28, corruptedEssence: 18, dna: 12 },
    ],
  },
  {
    id: 'genevault', name: 'Gene Vault', kind: 'production', emoji: '🧬', accent: '#86e08a',
    desc: 'Sequencing tanks. The most expensive building in the city, and worth it.',
    maxLevel: 3,
    yields: { dna: 5 }, inputs: { food: 30, medicine: 12 },
    draw: { power: 40, water: 15, workers: 6, pollution: 9 },
    footprint: { w: 3, h: 3 },
    cost: [
      { cinder: 120000, metal: 85,  supplies: 60,  medicine: 25,  dna: 5 },
      { cinder: 290000, metal: 190, supplies: 140, medicine: 60,  dna: 14, corruptedEssence: 8 },
      { cinder: 680000, metal: 410, supplies: 320, medicine: 145, dna: 35, corruptedEssence: 22, memoryShards: 15 },
    ],
  },
  /* ══ THE MATERIAL CHAIN (r12) ═══════════════════════════════════════════
     wood / stone / cloth joined RESOURCES this round. auditCatalog() rule 1
     says every resource needs a producer, and it is not a style rule: a
     resource with no building that makes it is obtainable only by loot, which
     is the exact inert state these three were already in.
     Yields are set against the existing shelf — Water Reclaimer 60, Supply
     Workshop 50, Hydroponics 45 — with the construction raws at the ABUNDANT
     end (wood 55, stone 60) and cloth scarcer (26), because cloth's whole job
     is to be the cheap-but-slow road into Goods.
     🔴 None is priced in what it produces (rule 2), each has ≥3 resource legs
        (rule 3), and each top tier pulls a rare (rule 5). */
  {
    id: 'timberyard', name: 'Timber Yard', kind: 'production', emoji: '🪵', accent: '#c08a4a',
    desc: 'Fells, bucks and stacks. The standing dead are the one crop the Collapse left behind.',
    maxLevel: 3,
    yields: { wood: 55 }, inputs: { fuel: 12 },
    draw: { power: 10, water: 0, workers: 6, pollution: 4 },
    footprint: { w: 3, h: 2 },
    cost: [
      { cinder: 40000,  metal: 35,  supplies: 25,  fuel: 15 },
      { cinder: 96000,  metal: 85,  supplies: 60,  fuel: 38,  stone: 25 },
      { cinder: 228000, metal: 185, supplies: 140, fuel: 85,  stone: 60, memoryShards: 5 },
    ],
  },
  {
    id: 'stonequarry', name: 'Stone Quarry', kind: 'production', emoji: '🪨', accent: '#a8a29a',
    desc: 'Cuts block and rubble out of the ridge. Slow, loud, and the reason anything stands up.',
    maxLevel: 3,
    yields: { stone: 60 }, inputs: { fuel: 18, water: 10 },
    draw: { power: 22, water: 10, workers: 8, pollution: 12 },
    footprint: { w: 3, h: 3 },
    cost: [
      { cinder: 48000,  metal: 45,  supplies: 30,  fuel: 20 },
      { cinder: 115000, metal: 105, supplies: 75,  fuel: 48,  wood: 40 },
      { cinder: 272000, metal: 225, supplies: 175, fuel: 108, wood: 95, memoryShards: 6 },
    ],
  },
  {
    id: 'textilemill', name: 'Textile Mill', kind: 'production', emoji: '🧵', accent: '#e0b8c8',
    desc: 'Retting pits, carders and looms. Everything a person wears passes through here.',
    maxLevel: 3,
    yields: { cloth: 26 }, inputs: { water: 20, food: 8 },
    draw: { power: 18, water: 20, workers: 5, pollution: 6 },
    footprint: { w: 2, h: 3 },
    cost: [
      { cinder: 52000,  metal: 40,  supplies: 35,  wood: 25 },
      { cinder: 124000, metal: 95,  supplies: 82,  wood: 60,  water: 45 },
      { cinder: 292000, metal: 205, supplies: 180, wood: 135, water: 100, dna: 7 },
    ],
  },
];

/* ════════════════════════════════════════════════════════════════════════════
   🧰 THE CHAIN PRODUCERS — one per promoted chain resource, GENERATED.
   ----------------------------------------------------------------------------
   🔴 WHY THIS EXISTS AT ALL. auditCatalog() rule 1 — "every resource has a
   producer" — is not a style rule. index.html's RESOURCES gained 56 chain ids
   this round, and NOT ONE of them is in SALVAGE_RES (checked: the intersection
   is empty), so unlike wood/stone/cloth in r12 they cannot even be looted. A
   promoted id with no building that makes it would therefore be a vault row
   that can never hold anything — the "real and inert" failure RESOURCES_NEXT.md
   is written about, reproduced 56 times in one commit. These rows are the
   producer half of "a resource is promoted TOGETHER with its producer".

   ── THE OPEN QUESTION THIS ANSWERS ─────────────────────────────────────────
   RESOURCES_NEXT.md §"Remaining open questions" asks: does CITY_PRODUCTION need
   a building per resource, or can one building take a recipe parameter? Neither,
   quite. It is one building per resource — because `defId` is what a placed row
   stores and what CITY_PREREQ keys off, and a recipe parameter would mean a
   second identity dimension in every save row — but the 56 definitions are
   DERIVED from three inputs rather than typed:
     • the id list (PROMOTED_CHAIN_IDS below, itself the derivation),
     • the catalogue's own name/icon/colour/tier/category (chain.js), and
     • one shelf of numbers per tier (CHAIN_TIER).
   So there is nothing here for a hand to get wrong 56 times, adding a resource
   to the promotion set costs zero edits in this block, and the numbers can be
   retuned in three places instead of a hundred and sixty-eight.

   🔴 EVERY COST LEG IS ONE OF THE LEGACY 14, AND EVERY INPUT TOO. That is the
   load-bearing constraint, not a simplification:
     • A cost priced in a chain id would be unpayable on a fresh camp — none of
       the 56 can be looted, so the only source is these buildings, and pricing
       them in each other deadlocks the whole block behind itself.
     • The industrial relationships between the 56 (timber→lumber, wheat→flour…)
       ARE modelled — in /src/economy/recipes.js, which the city firms run on.
       Restating them here would create a second copy that can disagree with the
       first, and chain.js `inputs: []` is deliberately still empty precisely so
       there is one place that answer lives. This file must not become the
       second one.
   Rules 2/3/5 of auditCatalog fall out by construction: costs name only legacy
   ids so they can never be "priced solely in what it produces"; every tier's L1
   carries three non-Cinder legs; every tier's top row pulls a rare.
   ════════════════════════════════════════════════════════════════════════════ */

/* 🔴 DERIVED, NOT CHOSEN — and re-derived by the gate on every run.

       PROMOTED_CHAIN_IDS = { every `out` id of node-city's ECO_BUILDING_MAP,
                              with the OP_ECO_MAP ops join applied }
                            ∩ MythicResourceChain.NEW_IDS

   i.e. exactly the catalogue ids that have a real producer standing behind them
   after this round wired 19 more buildings into the economy. It is a literal
   here only because ECO_BUILDING_MAP lives inside a 27,000-line HTML file that
   no module can import (the globals trap); round0p of
   tools/economy-tests/run.mjs scrapes the shipped map, recomputes the
   intersection and fails on ANY difference from this array, in either
   direction. Do not edit it by hand — change the map and let the gate tell you.
   45 tier-0 raws, 17 tier-1 intermediates, 9 tier-2 finished goods — the 15 added
   by the extraction round (rawWater, the deep and strategic minerals, quartz,
   sugar cane and the four deep anomalous seams) are all tier 0. */
export const PROMOTED_CHAIN_IDS = [
  'aluminumOre', 'anomalousEnergy', 'anomalousMatter', 'arcaneCrystal', 'beverages',
  'boosterPacks', 'bread', 'cannedFood', 'cardStock', 'cardboard', 'cars', 'clay', 'coal',
  'cobalt', 'constructionComponents', 'copperOre', 'corn', 'cotton', 'crudeOil',
  'dimensionalMaterial', 'electricity', 'fabric', 'freshFish', 'freshWater', 'fruit',
  'gasoline', 'goldOre', 'gravel', 'herbs', 'householdGoods', 'limestone', 'lithium',
  'lumber', 'machineParts', 'maintenanceParts', 'metalComponents', 'mythicResidue',
  'naturalGas', 'nickelOre', 'packagingMaterial', 'pigIron', 'plantFiber', 'platinumOre',
  'potatoes', 'preparedMeals', 'printedCards', 'quartz', 'rareEarthMinerals', 'rawWater',
  'realityFragments', 'realityMatter', 'recycledMetal', 'researchChemicals',
  'researchEquipment', 'rice', 'sand', 'seafood', 'seaweed', 'shellfish', 'silica',
  'silverOre', 'soybeans', 'sportingGoods', 'sugarCrops', 'timber', 'tires', 'titanium',
  'tungsten', 'vegetables', 'wheat', 'zincOre',
];

/* The building noun per catalogue category. Cosmetic, but it is what stops 56
   buildings all being called "<Resource> Works" — a blueprint list where every
   card has the same shape is a list nobody reads.
   ⚠ 'Yard' is deliberately NOT used for forestry: the hand-written catalog above
     already ships a "Timber Yard" (which makes legacy `wood`), and two buildings
     with the same name and different outputs is a support ticket. */
const CHAIN_CAT_NOUN = {
  water: 'Works',       agriculture: 'Farm',   fishing: 'Dock',      food: 'Kitchen',
  forestry: 'Mill',     minerals: 'Pit',       energy: 'Plant',      construction: 'Works',
  metals: 'Foundry',    chemicals: 'Plant',    machinery: 'Shop',    electronics: 'Fab',
  vehicles: 'Plant',    consumer: 'Works',     medical: 'Lab',       waste: 'Yard',
  recycling: 'Reclaimer', comms: 'Relay',      robotics: 'Works',    cards: 'Press',
  holographic: 'Optics', aerospace: 'Works',   anomalous: 'Siphon',  containment: 'Lab',
  security: 'Works',    civic: 'Depot',
};

/* 🎛 THE THREE SHELVES. Set against the hand-written catalog above so a chain
   producer is never strictly better than the building next to it: the Water
   Reclaimer yields 60 and the Supply Workshop 50, so a tier-0 extractor at 40 is
   deliberately below both — a raw with a whole industrial chain behind it should
   not also be the fastest thing in the city. Output falls and price rises with
   tier, which is the only shape that makes refining a decision.
   ⚠ Costs and inputs name ONLY legacy ids. See the header — this is the rule
     that keeps the block buildable from a cold start. */
const CHAIN_TIER = {
  0: {
    yield: 40, inputs: { fuel: 10 },
    draw: { power: 12, water: 6, workers: 5, pollution: 6 },
    footprint: { w: 3, h: 2 },
    prereq: ['warehouse'],           // storage first — the catalog's own onboarding rule
    cost: [
      { cinder: 42000,  metal: 40,  supplies: 30,  fuel: 12 },
      { cinder: 100000, metal: 95,  supplies: 70,  fuel: 30, wood: 25 },
      { cinder: 236000, metal: 205, supplies: 155, fuel: 70, wood: 60, memoryShards: 5 },
    ],
  },
  1: {
    yield: 28, inputs: { fuel: 12, water: 15 },
    draw: { power: 22, water: 15, workers: 6, pollution: 10 },
    footprint: { w: 3, h: 3 },
    prereq: ['powerplant'],          // refining draws real power; powerplant needs warehouse
    cost: [
      { cinder: 58000,  metal: 55,  supplies: 42,  water: 18 },
      { cinder: 138000, metal: 130, supplies: 100, water: 45,  stone: 30 },
      { cinder: 325000, metal: 280, supplies: 215, water: 100, stone: 70, memoryShards: 6 },
    ],
  },
  2: {
    yield: 16, inputs: { fuel: 15, supplies: 12 },
    draw: { power: 30, water: 10, workers: 8, pollution: 14 },
    footprint: { w: 3, h: 3 },
    prereq: ['powerplant'],
    cost: [
      { cinder: 84000,  metal: 75,  supplies: 58,  cloth: 20 },
      { cinder: 200000, metal: 175, supplies: 135, cloth: 48,  fuel: 40 },
      { cinder: 470000, metal: 375, supplies: 290, cloth: 105, fuel: 90, dna: 8 },
    ],
  },
};

/* 🏗 Build them. Ids are prefixed `chain_` so they can never collide with the
   hand-written catalog (a `defId` is stored in every placed row and in the save,
   so a collision would silently re-point an existing building at a new
   definition). `cost` rows are COPIED, not shared — a placed-building path that
   ever mutated a cost row would otherwise change it for all 56 at once.
   ⚠ Appended AFTER the hand-written entries on purpose: the catalog order is the
     blueprint-list order and the Warehouse has to stay first (see the comment
     above CITY_PRODUCTION). */
const CHAIN_PREREQ = {};
for (const id of PROMOTED_CHAIN_IDS) {
  const m = CHAIN_BY_ID[id];
  /* An id the catalogue does not define cannot be described, priced or drawn, so
     it is SKIPPED rather than rendered as "undefined Pit". It also cannot
     happen while round0p is green — the promotion set is an intersection WITH
     the catalogue — which is exactly why this is a guard and not a throw. */
  if (!m) continue;
  const T = CHAIN_TIER[m.tier] || CHAIN_TIER[1];
  const defId = 'chain_' + id;
  CITY_PRODUCTION.push({
    id: defId,
    name: m.name + ' ' + (CHAIN_CAT_NOUN[m.cat] || 'Works'),
    kind: 'production', emoji: m.icon, accent: m.color,
    desc: 'Tier ' + m.tier + ' · ' + m.name + ' for the camp ledger. The city\'s own firms trade this id too; '
        + 'this is the building that puts it in YOUR stash.',
    maxLevel: T.cost.length,
    yields: { [id]: T.yield },
    inputs: Object.assign({}, T.inputs),
    draw: Object.assign({}, T.draw),
    footprint: Object.assign({}, T.footprint),
    cost: T.cost.map(row => Object.assign({}, row)),
  });
  CHAIN_PREREQ[defId] = T.prereq.slice();
}

export const CITY_PRODUCTION_BY_ID = CITY_PRODUCTION.reduce((m, b) => { m[b.id] = b; return m; }, {});

/* 🔗 THE TECH TREE — what must already stand before a building can be placed.
   ────────────────────────────────────────────────────────────────────────────
   The rule is not invented: a building requires the PRODUCER OF ITS PRIMARY
   INPUT. Textile Mill eats food+water, so it needs the farm. Munitions eats
   metal, so it needs the smelter. That is the whole grammar, and it falls
   straight out of the `inputs` already declared on every def above.

   ⚠ THE INPUT GRAPH HAS A CYCLE AND THIS TREE MUST NOT. Foundry needs fuel,
     Refinery needs metal — deriving prerequisites mechanically from `inputs`
     would deadlock a fresh city with two buildings that each require the other.
     So the three bootstrap producers (warehouse, wellhead, hydroponics) are
     deliberately ungated, the tree is hand-checked acyclic from there, and
     Refinery hangs off Foundry rather than the reverse.

   ⚠ ONE LEVEL OF DEPTH IS CHECKED, NOT THE WHOLE CHAIN. Requiring the direct
     parent is enough: you cannot own a Foundry without having owned a Stone
     Quarry, so transitivity is enforced by construction rather than by walking
     the graph on every render.

   Empty / absent = buildable from turn one. */
export const CITY_PREREQ = {
  /* 🧰 The 56 generated chain producers, folded in from CHAIN_PREREQ above.
     Spread FIRST so a hand-written key below always wins — the `chain_` prefix
     already makes a collision impossible, and this is the ordering that stays
     correct if that ever stops being true.
     ⚠ STILL ACYCLIC, one level deep, by construction: every chain producer
       depends on `warehouse` or `powerplant`, and neither of those depends on
       anything the generator emits. The cycle warning below (foundry ⇄ refinery)
       is about deriving prerequisites from `inputs`; these are not derived from
       inputs — they are the two utilities that make any producer work at all. */
  ...CHAIN_PREREQ,
  // bootstrap tier — ungated on purpose, a new city must be able to start
  warehouse:   [],
  wellhead:    [],
  hydroponics: [],
  // utilities
  powerplant:  ['warehouse'],
  tenements:   ['hydroponics'],
  // raw extraction
  timberyard:  ['warehouse'],
  stonequarry: ['powerplant'],
  foundry:     ['stonequarry'],
  depot:       ['timberyard'],
  // refined — each behind the producer of what it consumes
  refinery:    ['foundry'],
  munitions:   ['foundry'],        // metal → ammo: the smelter comes first
  textilemill: ['hydroponics'],    // cloth off food/water: the farm comes first
  apothecary:  ['hydroponics'],
  bottling:    ['hydroponics'],
  // late tier
  sump:        ['apothecary'],
  archive:     ['depot'],
  genevault:   ['apothecary'],
};

/* Which prerequisites are missing, given what the city already has placed.
   `placedIds` may be an array, a Set, or an id→count map — every caller in the
   codebase holds a different one of those and none should have to convert. */
export function missingPrereqs(defId, placedIds) {
  const need = CITY_PREREQ[defId];
  if (!need || !need.length) return [];
  const has = (id) => {
    if (!placedIds) return false;
    if (typeof placedIds.has === 'function') return placedIds.has(id);
    if (Array.isArray(placedIds)) return placedIds.indexOf(id) >= 0;
    return (placedIds[id] | 0) > 0;
  };
  return need.filter((id) => !has(id));
}
export function cityProdDef(id) { return CITY_PRODUCTION_BY_ID[id] || null; }

/* 🧪 CATALOG SELF-AUDIT — the acceptance criteria of §5, checkable rather than
   claimed. Exported so a test harness can assert them; it is NOT run at import
   time, because a data assertion that throws on load would take the whole city
   down over a tuning typo. Returns [] when the catalog is sound. */
export function auditCatalog(resourceIds) {
  const RARE = ['memoryShards', 'dna', 'corruptedEssence'];
  /* ⚠ Kept in sync with index.html's RESOURCES (70 as of the chain promotion).
     A STALE list here does not just under-report: rule 4 ("every cost key must
     be a real resource") would flag every wood/stone/cloth cost leg below as an
     unknown id, which is the 'intel' bug this audit was written to catch,
     inverted.
     🔴 THE 56 ARE CONCATENATED, NOT RETYPED. The legacy 11 + 3 stay a literal
     because index.html owns them and no module can import that file; the chain
     half is PROMOTED_CHAIN_IDS, the same array the ledger and the producers are
     built from. So the fallback cannot fall behind a promotion — which is
     exactly how it would have gone stale, since the fallback is what runs when a
     caller has no host and therefore no live RESOURCE_IDS to hand over. */
  const ids = Array.isArray(resourceIds) && resourceIds.length ? resourceIds : [
    'food', 'ammo', 'water', 'medicine', 'energyDrink', 'supplies',
    'metal', 'fuel', 'corruptedEssence', 'memoryShards', 'dna',
    'wood', 'stone', 'cloth',
  ].concat(PROMOTED_CHAIN_IDS);
  const problems = [];
  // 1. Every one of the resources has a producer (14 as of r12 — the count is
  //    read from `ids`, never hardcoded, precisely so this rule cannot go stale).
  const produced = new Set();
  CITY_PRODUCTION.forEach(b => Object.keys(b.yields || {}).forEach(r => produced.add(r)));
  ids.forEach(r => { if (!produced.has(r)) problems.push(`no building yields "${r}"`); });
  CITY_PRODUCTION.forEach(b => {
    const levels = Array.isArray(b.cost) ? b.cost : [];
    if (levels.length !== b.maxLevel) problems.push(`${b.id}: ${levels.length} cost rows for maxLevel ${b.maxLevel}`);
    levels.forEach((row, i) => {
      const keys = Object.keys(row || {}).filter(k => k !== 'cinder' && (row[k] | 0) > 0);
      // 2. Never priced solely in what it produces.
      const mine = Object.keys(b.yields || {});
      if (keys.length && mine.length && keys.every(k => mine.indexOf(k) >= 0)) {
        problems.push(`${b.id} L${i + 1}: costs only what it produces`);
      }
      // 3. At least three distinct resource legs (Cinder does not count).
      if (keys.length < 3) problems.push(`${b.id} L${i + 1}: only ${keys.length} resource legs`);
      // 4. Every cost key must be a real resource — the `intel` class of bug.
      keys.forEach(k => { if (ids.indexOf(k) < 0) problems.push(`${b.id} L${i + 1}: unknown resource "${k}"`); });
      // 5. The top level pulls in a rare.
      if (i === levels.length - 1 && !RARE.some(r => (row[r] | 0) > 0)) {
        problems.push(`${b.id} L${i + 1}: top tier has no memoryShards/dna/corruptedEssence`);
      }
    });
  });
  return problems;
}
