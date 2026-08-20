/* ════════════════════════════════════════════════════════════════════════════
   🏭 RECIPES — what every resource is actually MADE OF.
   ----------------------------------------------------------------------------
   "A company cannot magically generate finished products."
       Wheat Farm → Flour Mill → Bakery → Distributor → Grocery Store → Resident

   This file is that sentence as data, for all 258 ids in
   /src/resources/chain.js.

   🔴 WHY THE RECIPES ARE HERE AND NOT IN chain.js's `inputs: []`.
   chain.js says of that slot: "It is the recipe — what this resource consumes
   to be made — and it is tomorrow's work, filled in alongside each producer."
   This IS that work, but it lives in a second file on purpose:

     • chain.js is a CATALOGUE — pure identity data (id, name, icon, category,
       tier). It is loaded by index.html today and must stay cheap and inert.
     • recipes.js is a GRAPH — it has edges, cycles to avoid, a topological
       order, and derived prices. It is only loaded by the economy.

   Merging them would mean index.html pays for the graph on every page load and
   a bad edge in a recipe could break the catalogue every other system reads.
   `audit()` below proves the two never disagree: every recipe id exists in the
   chain, every input id exists in the chain, and no id is its own ancestor.

   ⚠ EVERY INPUT ID IS A REAL CHAIN ID. Nothing here invents a resource. If a
     recipe needs something the catalogue does not have, the catalogue is what
     changes — a recipe referencing a phantom id is a producer that can never
     run and a bottleneck panel that can never explain why.

   ── READING AN ENTRY ────────────────────────────────────────────────────────
     in       {id: qty}  resources consumed per unit produced
     labor    number     labour-units per unit. Priced by ECON.price.laborCost.
     power    number     electricity per unit
     water    number     water per unit (industrialWater unless stated)
     ind      string     the INDUSTRY that runs this step — i.e. the COMPANY
     band     string     dominant skill band; defaults from the industry
   ════════════════════════════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════════════════════
   🏢 INDUSTRIES — the companies. A recipe names one; a firm runs one.
   `band` is the wage band its workforce is drawn from (ECON.labor.bands).
   `kind` decides who its customer is, and it is load-bearing:
     'extraction' | 'processing' | 'manufacturing'  → sells to OTHER FIRMS
     'retail' | 'service'                           → sells to HOUSEHOLDS
     'utility'                                      → sells to both
   demand.js routes household spending only to retail/service; firms.js routes
   input purchasing only to the rest. A step with the wrong kind is a business
   whose customers never arrive.
   ════════════════════════════════════════════════════════════════════════════ */
export const INDUSTRIES = {
  // ── extraction ────────────────────────────────────────────────────────────
  waterworks:   { name: 'Waterworks',            ico: '💧', band: 'skilled',   kind: 'utility' },
  farm:         { name: 'Farm',                  ico: '🌾', band: 'unskilled', kind: 'extraction' },
  ranch:        { name: 'Ranch',                 ico: '🐄', band: 'unskilled', kind: 'extraction' },
  fishery:      { name: 'Fishery',               ico: '🐟', band: 'unskilled', kind: 'extraction' },
  forestry:     { name: 'Forestry Camp',         ico: '🪵', band: 'unskilled', kind: 'extraction' },
  quarry:       { name: 'Quarry',                ico: '🪨', band: 'unskilled', kind: 'extraction' },
  mine:         { name: 'Mine',                  ico: '⛏️', band: 'skilled',   kind: 'extraction' },
  oilfield:     { name: 'Oil & Gas Field',       ico: '🛢️', band: 'skilled',   kind: 'extraction' },
  anomalySite:  { name: 'Anomaly Site',          ico: '🟣', band: 'advanced',  kind: 'extraction' },

  // ── processing ────────────────────────────────────────────────────────────
  mill:         { name: 'Mill',                  ico: '🌾', band: 'unskilled', kind: 'processing' },
  foodPlant:    { name: 'Food Plant',            ico: '🍞', band: 'unskilled', kind: 'processing' },
  dairyPlant:   { name: 'Dairy',                 ico: '🥛', band: 'unskilled', kind: 'processing' },
  sawmill:      { name: 'Sawmill',               ico: '🪚', band: 'unskilled', kind: 'processing' },
  paperMill:    { name: 'Paper Mill',            ico: '📄', band: 'skilled',   kind: 'processing' },
  smelter:      { name: 'Smelter',               ico: '🔥', band: 'skilled',   kind: 'processing' },
  steelMill:    { name: 'Steel Mill',            ico: '🏭', band: 'skilled',   kind: 'processing' },
  refinery:     { name: 'Refinery',              ico: '⚗️', band: 'technical', kind: 'processing' },
  chemPlant:    { name: 'Chemical Plant',        ico: '⚗️', band: 'technical', kind: 'processing' },
  cementWorks:  { name: 'Cement Works',          ico: '🧱', band: 'unskilled', kind: 'processing' },
  glassworks:   { name: 'Glassworks',            ico: '🔷', band: 'skilled',   kind: 'processing' },
  powerPlant:   { name: 'Power Plant',           ico: '⚡', band: 'skilled',   kind: 'utility' },
  recycler:     { name: 'Recycling Plant',       ico: '♻️', band: 'unskilled', kind: 'processing' },
  wasteWorks:   { name: 'Waste Works',           ico: '🗑️', band: 'unskilled', kind: 'utility' },
  textileMill:  { name: 'Textile Mill',          ico: '🧵', band: 'unskilled', kind: 'processing' },

  // ── manufacturing ─────────────────────────────────────────────────────────
  fabricator:   { name: 'Fabrication Works',     ico: '⚙️', band: 'skilled',   kind: 'manufacturing' },
  machineWorks: { name: 'Machine Works',         ico: '🔩', band: 'skilled',   kind: 'manufacturing' },
  heavyWorks:   { name: 'Heavy Industry',        ico: '🏗️', band: 'skilled',   kind: 'manufacturing' },
  electronics:  { name: 'Electronics Plant',     ico: '🔌', band: 'technical', kind: 'manufacturing' },
  semiFab:      { name: 'Semiconductor Fab',     ico: '💠', band: 'advanced',  kind: 'manufacturing' },
  autoPlant:    { name: 'Vehicle Plant',         ico: '🚗', band: 'skilled',   kind: 'manufacturing' },
  consumerPlant:{ name: 'Consumer Goods Plant',  ico: '🧥', band: 'unskilled', kind: 'manufacturing' },
  pharma:       { name: 'Pharmaceutical Works',  ico: '💊', band: 'technical', kind: 'manufacturing' },
  medDevice:    { name: 'Medical Device Works',  ico: '🩺', band: 'technical', kind: 'manufacturing' },
  roboticsPlant:{ name: 'Robotics Plant',        ico: '🤖', band: 'advanced',  kind: 'manufacturing' },
  aerospace:    { name: 'Aerospace Works',       ico: '🛰️', band: 'advanced',  kind: 'manufacturing' },
  comms:        { name: 'Communications Works',  ico: '📡', band: 'technical', kind: 'manufacturing' },
  holoWorks:    { name: 'Holographic Works',     ico: '✨', band: 'advanced',  kind: 'manufacturing' },
  cardPrinter:  { name: 'Ouroboros Printing',    ico: '🃏', band: 'skilled',   kind: 'manufacturing' },
  packaging:    { name: 'Packaging Plant',       ico: '📦', band: 'unskilled', kind: 'manufacturing' },
  containment:  { name: 'Containment Works',     ico: '🛡️', band: 'advanced',  kind: 'manufacturing' },
  scpFoundry:   { name: 'Classified Foundry',    ico: '🔒', band: 'advanced',  kind: 'manufacturing' },
  civicWorks:   { name: 'Civic Supply Works',    ico: '🧰', band: 'unskilled', kind: 'manufacturing' },

  // ── retail & service — these sell to RESIDENTS ────────────────────────────
  grocer:       { name: 'Grocery Store',         ico: '🛒', band: 'unskilled', kind: 'retail' },
  restaurant:   { name: 'Restaurant',            ico: '🍽️', band: 'unskilled', kind: 'service' },
  clothier:     { name: 'Clothing Store',        ico: '👕', band: 'unskilled', kind: 'retail' },
  techStore:    { name: 'Electronics Store',     ico: '📱', band: 'skilled',   kind: 'retail' },
  pharmacy:     { name: 'Pharmacy',              ico: '⚕️', band: 'skilled',   kind: 'retail' },
  clinic:       { name: 'Clinic',                ico: '🏥', band: 'technical', kind: 'service' },
  cardShop:     { name: 'Card Shop',             ico: '🎴', band: 'unskilled', kind: 'retail' },
  luxuryStore:  { name: 'Luxury Boutique',       ico: '💎', band: 'skilled',   kind: 'retail' },
  venue:        { name: 'Entertainment Venue',   ico: '🎭', band: 'unskilled', kind: 'service' },
  hotel:        { name: 'Hotel',                 ico: '🏨', band: 'unskilled', kind: 'service' },
  transitCo:    { name: 'Transit Company',       ico: '🚌', band: 'skilled',   kind: 'service' },
  landlord:     { name: 'Property Company',      ico: '🏠', band: 'unskilled', kind: 'service' },
  distributor:  { name: 'Distributor',           ico: '🚚', band: 'unskilled', kind: 'processing' },
};

/* ════════════════════════════════════════════════════════════════════════════
   ⛏ DEPOSITS — tier-0 resources that come OUT OF THE GROUND.
   These are the ids gated by the node's endowment (endowment.js). If your node
   has no `ironOre` deposit you cannot build an Iron Mine — not "it is slow",
   not "it is expensive": the building is not offered. That is the announcement's
   "YOUR CITY CANNOT PRODUCE EVERYTHING", and it is enforced in exactly one
   place: `canExtract()` in endowment.js, which reads this list.

   `yield` is units per labour-day at a COMMON grade; the grade multiplies it.
   `ind` is which extractor company works the deposit.
   ════════════════════════════════════════════════════════════════════════════ */
export const DEPOSITS = {
  // water
  rawWater:            { yield: 220, ind: 'waterworks', band: 'unskilled' },
  // agriculture — arable land is a deposit like any other
  wheat:               { yield: 90,  ind: 'farm' },
  corn:                { yield: 95,  ind: 'farm' },
  rice:                { yield: 80,  ind: 'farm' },
  potatoes:            { yield: 110, ind: 'farm' },
  soybeans:            { yield: 75,  ind: 'farm' },
  sugarCrops:          { yield: 85,  ind: 'farm' },
  vegetables:          { yield: 70,  ind: 'farm' },
  fruit:               { yield: 60,  ind: 'farm' },
  herbs:               { yield: 28,  ind: 'farm' },
  seeds:               { yield: 40,  ind: 'farm' },
  cotton:              { yield: 55,  ind: 'farm' },
  plantFiber:          { yield: 65,  ind: 'farm' },
  // fishing
  freshFish:           { yield: 48,  ind: 'fishery' },
  seafood:             { yield: 42,  ind: 'fishery' },
  shellfish:           { yield: 26,  ind: 'fishery' },
  seaweed:             { yield: 58,  ind: 'fishery' },
  // forestry
  timber:              { yield: 72,  ind: 'forestry' },
  wood:                { yield: 68,  ind: 'forestry' },
  // minerals — quarried
  stone:               { yield: 96,  ind: 'quarry' },
  sand:                { yield: 120, ind: 'quarry' },
  clay:                { yield: 100, ind: 'quarry' },
  limestone:           { yield: 92,  ind: 'quarry' },
  gravel:              { yield: 130, ind: 'quarry' },
  quartz:              { yield: 34,  ind: 'quarry' },
  silica:              { yield: 78,  ind: 'quarry' },
  // minerals — mined
  ironOre:             { yield: 64,  ind: 'mine' },
  copperOre:           { yield: 52,  ind: 'mine' },
  aluminumOre:         { yield: 56,  ind: 'mine' },
  nickelOre:           { yield: 30,  ind: 'mine' },
  zincOre:             { yield: 34,  ind: 'mine' },
  goldOre:             { yield: 9,   ind: 'mine' },
  silverOre:           { yield: 14,  ind: 'mine' },
  platinumOre:         { yield: 5,   ind: 'mine' },
  lithium:             { yield: 18,  ind: 'mine' },
  cobalt:              { yield: 12,  ind: 'mine' },
  titanium:            { yield: 16,  ind: 'mine' },
  tungsten:            { yield: 11,  ind: 'mine' },
  rareEarthMinerals:   { yield: 7,   ind: 'mine',        band: 'technical' },
  rareMinerals:        { yield: 8,   ind: 'mine',        band: 'technical' },
  // energy
  coal:                { yield: 88,  ind: 'mine' },
  crudeOil:            { yield: 74,  ind: 'oilfield' },
  naturalGas:          { yield: 82,  ind: 'oilfield' },
  /* 🌌 THE MYTHIC SEAM. These are deposits too, but they are the RAREST grade
     of ground in the game and they are what a late-game city is actually
     hunting for. Their yields are tiny because one unit feeds a whole
     containment chain — see the anomalous recipes below. */
  mythicEssence:       { yield: 3.2, ind: 'anomalySite', band: 'advanced' },
  mythicResidue:       { yield: 5.0, ind: 'anomalySite', band: 'advanced' },
  anomalousMatter:     { yield: 2.4, ind: 'anomalySite', band: 'advanced' },
  anomalousEnergy:     { yield: 2.8, ind: 'anomalySite', band: 'advanced' },
  realityMatter:       { yield: 1.6, ind: 'anomalySite', band: 'advanced' },
  soulEnergy:          { yield: 1.9, ind: 'anomalySite', band: 'advanced' },
  dimensionalMaterial: { yield: 1.4, ind: 'anomalySite', band: 'advanced' },
  arcaneCrystal:       { yield: 2.1, ind: 'anomalySite', band: 'advanced' },
  realityFragments:    { yield: 0.9, ind: 'anomalySite', band: 'advanced' },
};

/* ♻️ BYPRODUCTS — tier-0 ids that are NOT deposits. Nobody mines wastewater.
   These are generated BY the economy (households and firms emit them) and are
   an input to the recycling chain. Listing them here rather than in DEPOSITS is
   what stops the endowment generator from ever telling a player their node is
   "barren in Medical Waste", which is a sentence that should never render. */
export const BYPRODUCTS = {
  wastewater:      { from: 'water',      note: 'Everything that uses water returns most of it dirty.' },
  residentialWaste:{ from: 'households', note: 'Residents throw things away.' },
  commercialWaste: { from: 'retail',     note: 'Shops and restaurants throw more away.' },
  industrialWaste: { from: 'industry',   note: 'Every processing step sheds some.' },
  organicWaste:    { from: 'food',       note: 'Kitchens and food plants.' },
  electronicWaste: { from: 'electronics',note: 'Devices die. This is where they go.' },
  medicalWaste:    { from: 'medical',    note: 'Clinics and pharma. Regulated.' },
  hazardousWaste:  { from: 'chemicals',  note: 'Chemical and anomalous processing.' },
};

/* ════════════════════════════════════════════════════════════════════════════
   🔗 RECIPES — every id that is MADE rather than extracted.
   ════════════════════════════════════════════════════════════════════════════ */
export const RECIPES = {
  // ── 💧 Water ──────────────────────────────────────────────────────────────
  freshWater:       { in: { rawWater: 1.15 }, labor: 0.02, power: 0.06, ind: 'waterworks' },
  industrialWater:  { in: { rawWater: 1.05 }, labor: 0.01, power: 0.03, ind: 'waterworks' },
  reclaimedWater:   { in: { wastewater: 1.4 }, labor: 0.03, power: 0.11, ind: 'wasteWorks' },

  // ── 🌾 Agriculture (the made ones) ────────────────────────────────────────
  /* 🐟🌱 ALT LEGS, NOT EXTRA INPUTS — and the distinction is the whole design.
     `seeds` and `seaweed` were deposits a player could extract and NOTHING in
     the city would ever buy: the Survey graded the ground Rich and the tile
     produced into a void.
     ⚠ THEY ARE ALTERNATIVE LEGS BECAUSE A REQUIRED INPUT WOULD MAKE THE
       BROWNOUTS WORSE. The resource round closed the phantom-feedstock hole,
       and the honest consequence is that mills on an under-built board already
       run short. Adding seeds to the DEFAULT leg would deepen every feed
       chain's requirement — "give this deposit a customer" would have cost the
       city its animal feed. A leg is a choice the mill takes when it has the
       stock, and ignores when it does not.
     Both are real feeds: seed cake is what an oil press leaves behind, and
     seaweed meal is a standard livestock supplement. */
  animalFeed:  { in: { corn: 0.6, soybeans: 0.3, biomass: 0.2 }, labor: 0.04, power: 0.05, ind: 'mill' },
  livestock:   { in: { animalFeed: 3.2, freshWater: 2.4 },       labor: 0.28, power: 0.04, ind: 'ranch' },
  poultry:     { in: { animalFeed: 1.6, freshWater: 1.1 },       labor: 0.18, power: 0.04, ind: 'ranch' },
  eggs:        { in: { animalFeed: 0.9, freshWater: 0.5 },       labor: 0.09, power: 0.03, ind: 'ranch' },
  rawMilk:     { in: { animalFeed: 1.2, freshWater: 1.8 },       labor: 0.11, power: 0.05, ind: 'ranch' },
  biomass:     { in: { organicWaste: 1.3, plantFiber: 0.4 },     labor: 0.03, power: 0.04, ind: 'recycler' },

  // ── 🍞 Food processing ────────────────────────────────────────────────────
  flour:            { in: { wheat: 1.35 },                                   labor: 0.05, power: 0.09, ind: 'mill' },
  bread:            { in: { flour: 0.75, freshWater: 0.3, cookingOil: 0.05 },labor: 0.12, power: 0.14, ind: 'foodPlant' },
  meat:             { in: { livestock: 0.42 },                               labor: 0.16, power: 0.12, ind: 'foodPlant' },
  processedMeat:    { in: { meat: 0.85, sugar: 0.04, packagingMaterial: 0.1 },labor: 0.14, power: 0.16, ind: 'foodPlant' },
  dairy:            { in: { rawMilk: 1.25 },                                 labor: 0.07, power: 0.15, ind: 'dairyPlant' },
  cheese:           { in: { rawMilk: 4.2, industrialChemicals: 0.02 },       labor: 0.18, power: 0.22, ind: 'dairyPlant' },
  cookingOil:       { in: { soybeans: 1.8 },                                 labor: 0.06, power: 0.13, ind: 'foodPlant' },
  sugar:            { in: { sugarCrops: 2.1 },                               labor: 0.06, power: 0.18, ind: 'foodPlant' },
  packagedFood:     { in: { bread: 0.3, processedMeat: 0.2, vegetables: 0.4, packagingMaterial: 0.15 }, labor: 0.11, power: 0.13, ind: 'foodPlant' },
  frozenFood:       { in: { preparedMeals: 0.9, packagingMaterial: 0.12 },   labor: 0.09, power: 0.34, ind: 'foodPlant' },
  cannedFood:       { in: { vegetables: 0.7, meat: 0.2, sheetMetal: 0.08 },  labor: 0.10, power: 0.19, ind: 'foodPlant' },
  snacks:           { in: { flour: 0.3, sugar: 0.25, cookingOil: 0.12, packagingMaterial: 0.1 }, labor: 0.09, power: 0.15, ind: 'foodPlant' },
  beverages:        { in: { freshWater: 1.6, sugar: 0.2, fruit: 0.15, packagingMaterial: 0.12 }, labor: 0.08, power: 0.16, ind: 'foodPlant' },
  /* 🥔🐟 The kitchen's other four legs. `potatoes`, `freshFish`, `seafood` and
     `shellfish` were all extractable and all unsellable — a fishery could work
     a Rich seam into nothing. Same rule as animalFeed above: LEGS, never extra
     inputs on the default, because a mandatory fish would close every food
     plant on a board with no coast. */
  preparedMeals:    { in: { meat: 0.25, vegetables: 0.4, rice: 0.3, cookingOil: 0.06 }, labor: 0.15, power: 0.17, ind: 'foodPlant' },
  restaurantSupplies:{in: { preparedMeals: 0.4, cannedFood: 0.3, cookingOil: 0.15, cleaningChemicals: 0.05 }, labor: 0.07, power: 0.08, ind: 'distributor' },

  // ── 🪵 Forestry & paper ───────────────────────────────────────────────────
  lumber:              { in: { timber: 1.4 },                                labor: 0.06, power: 0.12, ind: 'sawmill' },
  plywood:             { in: { lumber: 0.9, adhesives: 0.06 },               labor: 0.08, power: 0.16, ind: 'sawmill' },
  woodPanels:          { in: { lumber: 0.7, wood: 0.3, adhesives: 0.05 },    labor: 0.07, power: 0.14, ind: 'sawmill' },
  woodPulp:            { in: { timber: 1.1, industrialWater: 2.4 },          labor: 0.05, power: 0.28, ind: 'paperMill' },
  paper:               { in: { woodPulp: 1.2, industrialChemicals: 0.08, industrialWater: 1.6 }, labor: 0.06, power: 0.31, ind: 'paperMill' },
  /* 🃏 PREMIUM PAPER is where the ordinary forestry chain turns into the card
     chain. Same mill, tighter tolerances, and the whole Ouroboros economy
     downstream depends on it — see the `cards` block below. */
  premiumPaper:        { in: { woodPulp: 1.5, specialtyPolymers: 0.05, industrialWater: 1.2 }, labor: 0.11, power: 0.38, ind: 'paperMill', band: 'skilled' },
  cardboard:           { in: { recycledPaper: 0.6, woodPulp: 0.5 },          labor: 0.05, power: 0.19, ind: 'paperMill' },
  furnitureComponents: { in: { woodPanels: 0.8, adhesives: 0.08, paint: 0.05 }, labor: 0.13, power: 0.15, ind: 'fabricator' },

  // ── ⚡ Energy ─────────────────────────────────────────────────────────────
  gasoline:        { in: { crudeOil: 1.5 },                          labor: 0.05, power: 0.21, ind: 'refinery' },
  diesel:          { in: { crudeOil: 1.4 },                          labor: 0.05, power: 0.19, ind: 'refinery' },
  industrialFuel:  { in: { crudeOil: 1.6 },                          labor: 0.04, power: 0.17, ind: 'refinery' },
  aviationFuel:    { in: { crudeOil: 1.9, industrialChemicals: 0.05 },labor: 0.08, power: 0.29, ind: 'refinery', band: 'technical' },
  naturalGasFuel:  { in: { naturalGas: 1.2 },                        labor: 0.03, power: 0.12, ind: 'refinery' },
  nuclearFuel:     { in: { rareEarthMinerals: 0.9, acids: 0.4, advancedAlloys: 0.1 }, labor: 0.42, power: 1.10, ind: 'chemPlant', band: 'advanced' },
  hydrogen:        { in: { industrialWater: 2.2, electricity: 3.4 }, labor: 0.06, power: 0.05, ind: 'chemPlant', band: 'technical' },
  /* ⚡ ELECTRICITY is the one recipe with alternate feedstocks, and the sim
     picks the cheapest available at price time — which is why a coal shock
     makes a city switch to gas by itself rather than browning out. See
     `ALT_FEEDSTOCK` below; `in` is the DEFAULT leg. */
  electricity:     { in: { coal: 0.12 },                             labor: 0.004, power: 0, ind: 'powerPlant' },

  // ── 🧱 Construction ───────────────────────────────────────────────────────
  brick:                   { in: { clay: 1.3, industrialFuel: 0.05 },                  labor: 0.05, power: 0.16, ind: 'cementWorks' },
  cement:                  { in: { limestone: 1.5, clay: 0.3, industrialFuel: 0.08 },  labor: 0.05, power: 0.34, ind: 'cementWorks' },
  /* 🪨 Crushed stone is the aggregate a quarry actually sells, and `stone` had
     no buyer at all — the one deposit on this list that is not exotic and not
     new, just never wired. A leg, so a city with gravel keeps using gravel. */
  concrete:                { in: { cement: 0.45, gravel: 0.9, sand: 0.6, industrialWater: 0.4 }, labor: 0.06, power: 0.11, ind: 'cementWorks' },
  glass:                   { in: { silica: 1.2, sand: 0.4, industrialFuel: 0.09 },     labor: 0.07, power: 0.42, ind: 'glassworks' },
  steel:                   { in: { pigIron: 1.05, coal: 0.22, metalAlloys: 0.04 },     labor: 0.11, power: 0.55, ind: 'steelMill' },
  asphalt:                 { in: { crudeOil: 0.35, gravel: 1.1, sand: 0.4 },           labor: 0.05, power: 0.14, ind: 'cementWorks' },
  structuralSteel:         { in: { steel: 1.08, metalAlloys: 0.06 },                   labor: 0.14, power: 0.31, ind: 'steelMill' },
  reinforcedConcrete:      { in: { concrete: 0.9, structuralSteel: 0.14 },             labor: 0.09, power: 0.13, ind: 'cementWorks' },
  insulation:              { in: { syntheticFiber: 0.5, plastic: 0.25 },               labor: 0.06, power: 0.13, ind: 'fabricator' },
  constructionGlass:       { in: { glass: 1.05, specialtyPolymers: 0.04 },             labor: 0.08, power: 0.17, ind: 'glassworks' },
  compositeMaterials:      { in: { syntheticFiber: 0.6, specialtyPolymers: 0.3, adhesives: 0.1 }, labor: 0.16, power: 0.28, ind: 'fabricator', band: 'technical' },
  constructionComponents:  { in: { structuralSteel: 0.4, lumber: 0.5, metalComponents: 0.2 }, labor: 0.12, power: 0.16, ind: 'fabricator' },
  prefabricatedComponents: { in: { constructionComponents: 0.7, insulation: 0.2, constructionGlass: 0.15 }, labor: 0.15, power: 0.18, ind: 'fabricator' },
  electricalComponents:    { in: { copperWire: 0.35, plastic: 0.2, metalComponents: 0.1 }, labor: 0.13, power: 0.15, ind: 'electronics' },
  plumbingComponents:      { in: { copper: 0.3, plastic: 0.25, rubber: 0.06 },         labor: 0.11, power: 0.12, ind: 'fabricator' },

  // ── ⛓ Metals ─────────────────────────────────────────────────────────────
  pigIron:         { in: { ironOre: 1.6, coal: 0.35, limestone: 0.15 },   labor: 0.08, power: 0.48, ind: 'smelter' },
  sheetMetal:      { in: { steel: 1.03 },                                 labor: 0.07, power: 0.22, ind: 'steelMill' },
  metalComponents: { in: { sheetMetal: 0.55, aluminum: 0.15 },            labor: 0.14, power: 0.19, ind: 'machineWorks' },
  aluminum:        { in: { aluminumOre: 2.0, electricity: 4.2 },          labor: 0.09, power: 0.10, ind: 'smelter' },
  copper:          { in: { copperOre: 1.8, acids: 0.08 },                 labor: 0.09, power: 0.44, ind: 'smelter' },
  copperWire:      { in: { copper: 1.02, plastic: 0.05 },                 labor: 0.08, power: 0.17, ind: 'fabricator' },
  /* 💎 `platinumOre` and `rareMinerals` are the two the Deep Mine works that
     nothing bought. Both are real alloying and catalyst feeds, and both are
     scarce (yield 5 and 8 against nickel's ordinary seam), so the leg takes far
     less of them and costs more labour — a speciality melt, not a cheaper
     route to the same alloy. `band: 'technical'` is kept: it is the same
     furnace and the same crew. */
  metalAlloys:     { in: { nickelOre: 0.4, zincOre: 0.3, steel: 0.4 },    labor: 0.16, power: 0.38, ind: 'smelter', band: 'technical' },
  advancedAlloys:  { in: { titanium: 0.5, tungsten: 0.25, cobalt: 0.2, metalAlloys: 0.3 }, labor: 0.38, power: 0.72, ind: 'smelter', band: 'advanced' },

  // ── ⚗️ Chemicals ──────────────────────────────────────────────────────────
  petrochemicals:        { in: { crudeOil: 1.3, naturalGas: 0.3 },                 labor: 0.07, power: 0.33, ind: 'refinery', band: 'technical' },
  chemicalFeedstock:     { in: { petrochemicals: 0.9, industrialWater: 0.8 },      labor: 0.06, power: 0.24, ind: 'chemPlant' },
  plasticFeedstock:      { in: { petrochemicals: 1.05 },                           labor: 0.05, power: 0.21, ind: 'chemPlant' },
  industrialChemicals:   { in: { chemicalFeedstock: 0.85, industrialWater: 0.6 },  labor: 0.09, power: 0.31, ind: 'chemPlant' },
  acids:                 { in: { industrialChemicals: 0.7, industrialWater: 0.9 }, labor: 0.10, power: 0.28, ind: 'chemPlant' },
  solvents:              { in: { petrochemicals: 0.6, industrialChemicals: 0.3 },  labor: 0.09, power: 0.26, ind: 'chemPlant' },
  fertilizer:            { in: { naturalGas: 0.5, acids: 0.25, compost: 0.2 },     labor: 0.08, power: 0.29, ind: 'chemPlant' },
  industrialGas:         { in: { naturalGas: 0.8, electricity: 1.2 },              labor: 0.06, power: 0.09, ind: 'chemPlant' },
  plastic:               { in: { plasticFeedstock: 1.05 },                         labor: 0.06, power: 0.27, ind: 'chemPlant' },
  rubber:                { in: { petrochemicals: 0.7, industrialChemicals: 0.15 }, labor: 0.08, power: 0.24, ind: 'chemPlant' },
  syntheticFiber:        { in: { petrochemicals: 0.65, industrialChemicals: 0.2 }, labor: 0.09, power: 0.29, ind: 'chemPlant' },
  paint:                 { in: { solvents: 0.35, industrialChemicals: 0.3, quartz: 0.1 }, labor: 0.08, power: 0.17, ind: 'chemPlant' },
  adhesives:             { in: { petrochemicals: 0.4, industrialChemicals: 0.25 }, labor: 0.08, power: 0.16, ind: 'chemPlant' },
  cleaningChemicals:     { in: { industrialChemicals: 0.45, solvents: 0.2, freshWater: 0.5 }, labor: 0.07, power: 0.13, ind: 'chemPlant' },
  semiconductorChemicals:{ in: { acids: 0.5, solvents: 0.35, industrialGas: 0.2 }, labor: 0.30, power: 0.55, ind: 'chemPlant', band: 'advanced' },
  medicalChemicals:      { in: { industrialChemicals: 0.5, researchChemicals: 0.1, herbs: 0.2 }, labor: 0.26, power: 0.34, ind: 'pharma', band: 'technical' },
  holographicChemicals:  { in: { rareEarthMinerals: 0.3, specialtyPolymers: 0.25, acids: 0.15 }, labor: 0.34, power: 0.61, ind: 'chemPlant', band: 'advanced' },
  specialtyPolymers:     { in: { plasticFeedstock: 0.7, industrialChemicals: 0.3 },labor: 0.19, power: 0.37, ind: 'chemPlant', band: 'technical' },

  // ── ⚙️ Machinery ──────────────────────────────────────────────────────────
  machineParts:          { in: { steel: 0.5, metalComponents: 0.35, metalAlloys: 0.08 }, labor: 0.21, power: 0.26, ind: 'machineWorks' },
  industrialMachinery:   { in: { machineParts: 1.2, electricalComponents: 0.3, sensors: 0.05 }, labor: 0.34, power: 0.31, ind: 'machineWorks' },
  heavyMachinery:        { in: { structuralSteel: 0.9, machineParts: 1.4, engines: 0.15 }, labor: 0.45, power: 0.42, ind: 'heavyWorks' },
  agriculturalMachinery: { in: { machineParts: 1.0, engines: 0.2, tires: 0.3 },   labor: 0.36, power: 0.28, ind: 'heavyWorks' },
  constructionEquipment: { in: { heavyMachinery: 0.6, engines: 0.25, tires: 0.4 },labor: 0.44, power: 0.33, ind: 'heavyWorks' },
  miningEquipment:       { in: { heavyMachinery: 0.7, advancedAlloys: 0.1, engines: 0.2 }, labor: 0.48, power: 0.37, ind: 'heavyWorks' },
  factoryEquipment:      { in: { industrialMachinery: 0.8, automationSystems: 0.15, electricalComponents: 0.25 }, labor: 0.41, power: 0.34, ind: 'machineWorks', band: 'technical' },
  pumps:                 { in: { machineParts: 0.6, metalComponents: 0.3, rubber: 0.08 }, labor: 0.22, power: 0.21, ind: 'machineWorks' },
  turbines:              { in: { advancedAlloys: 0.35, machineParts: 0.8, sensors: 0.06 }, labor: 0.52, power: 0.48, ind: 'heavyWorks', band: 'technical' },
  generators:            { in: { copperWire: 0.5, machineParts: 0.7, metalAlloys: 0.15 }, labor: 0.31, power: 0.29, ind: 'machineWorks' },

  // ── 🔌 Electronics ────────────────────────────────────────────────────────
  siliconWafers:            { in: { silica: 1.4, semiconductorChemicals: 0.2, industrialGas: 0.15 }, labor: 0.44, power: 0.92, ind: 'semiFab', band: 'advanced' },
  semiconductorMaterials:   { in: { siliconWafers: 0.7, rareEarthMinerals: 0.15, semiconductorChemicals: 0.2 }, labor: 0.48, power: 0.88, ind: 'semiFab', band: 'advanced' },
  microchips:               { in: { semiconductorMaterials: 0.6, goldOre: 0.02, semiconductorChemicals: 0.15 }, labor: 0.55, power: 1.05, ind: 'semiFab', band: 'advanced' },
  advancedMicrochips:       { in: { microchips: 0.8, rareEarthMinerals: 0.1, quantumComponents: 0.03 }, labor: 0.78, power: 1.42, ind: 'semiFab', band: 'advanced' },
  processors:               { in: { microchips: 1.1, advancedMicrochips: 0.15, circuitBoards: 0.2 }, labor: 0.62, power: 0.94, ind: 'semiFab', band: 'advanced' },
  electronicComponents:     { in: { copperWire: 0.25, plastic: 0.15, microchips: 0.08 }, labor: 0.24, power: 0.31, ind: 'electronics' },
  circuitBoards:            { in: { electronicComponents: 0.6, copper: 0.15, specialtyPolymers: 0.1 }, labor: 0.28, power: 0.36, ind: 'electronics' },
  wiring:                   { in: { copperWire: 0.8, plastic: 0.2 },              labor: 0.12, power: 0.16, ind: 'electronics' },
  batteries:                { in: { lithium: 0.35, cobalt: 0.12, plastic: 0.15, copper: 0.1 }, labor: 0.29, power: 0.47, ind: 'electronics' },
  advancedBatteries:        { in: { batteries: 0.7, rareEarthMinerals: 0.12, advancedAlloys: 0.06 }, labor: 0.46, power: 0.68, ind: 'electronics', band: 'technical' },
  sensors:                  { in: { microchips: 0.25, electronicComponents: 0.3, glass: 0.05 }, labor: 0.35, power: 0.41, ind: 'electronics', band: 'technical' },
  advancedSensors:          { in: { sensors: 0.7, advancedMicrochips: 0.12, opticalComponents: 0.1 }, labor: 0.58, power: 0.63, ind: 'electronics', band: 'advanced' },
  displays:                 { in: { glass: 0.4, microchips: 0.2, specialtyPolymers: 0.15, wiring: 0.1 }, labor: 0.38, power: 0.52, ind: 'electronics', band: 'technical' },
  computerComponents:       { in: { circuitBoards: 0.5, processors: 0.15, wiring: 0.15 }, labor: 0.36, power: 0.39, ind: 'electronics', band: 'technical' },
  computers:                { in: { computerComponents: 1.0, displays: 0.3, plastic: 0.2, batteries: 0.1 }, labor: 0.42, power: 0.44, ind: 'electronics', band: 'technical' },
  smartphones:              { in: { advancedMicrochips: 0.2, displays: 0.35, advancedBatteries: 0.2, specialtyPolymers: 0.15 }, labor: 0.51, power: 0.57, ind: 'electronics', band: 'technical' },
  servers:                  { in: { computerComponents: 2.2, processors: 0.5, dataStorageHardware: 0.4 }, labor: 0.66, power: 0.81, ind: 'electronics', band: 'advanced' },
  communicationComponents:  { in: { circuitBoards: 0.35, copperWire: 0.2, sensors: 0.1 }, labor: 0.31, power: 0.34, ind: 'comms' },
  communicationDevices:     { in: { communicationComponents: 0.8, displays: 0.2, batteries: 0.15 }, labor: 0.38, power: 0.41, ind: 'comms', band: 'technical' },

  // ── 🚗 Vehicles ───────────────────────────────────────────────────────────
  engines:           { in: { machineParts: 0.9, metalAlloys: 0.2, electricalComponents: 0.15 }, labor: 0.38, power: 0.36, ind: 'autoPlant' },
  vehicleParts:      { in: { sheetMetal: 0.6, plastic: 0.3, metalComponents: 0.25 }, labor: 0.25, power: 0.24, ind: 'autoPlant' },
  tires:             { in: { rubber: 0.85, syntheticFiber: 0.15 },                labor: 0.16, power: 0.28, ind: 'autoPlant' },
  maintenanceParts:  { in: { vehicleParts: 0.5, machineParts: 0.3, cookingOil: 0.0 }, labor: 0.19, power: 0.18, ind: 'autoPlant' },
  cars:              { in: { engines: 0.5, vehicleParts: 2.2, tires: 0.6, constructionGlass: 0.2, electronicComponents: 0.3 }, labor: 0.62, power: 0.55, ind: 'autoPlant' },
  electricVehicles:  { in: { advancedBatteries: 0.9, vehicleParts: 2.0, tires: 0.6, processors: 0.15, displays: 0.15 }, labor: 0.71, power: 0.63, ind: 'autoPlant', band: 'technical' },
  trucks:            { in: { engines: 0.8, vehicleParts: 3.4, tires: 1.0, structuralSteel: 0.4 }, labor: 0.78, power: 0.68, ind: 'autoPlant' },
  deliveryVehicles:  { in: { engines: 0.6, vehicleParts: 2.6, tires: 0.8 },       labor: 0.66, power: 0.58, ind: 'autoPlant' },
  buses:             { in: { engines: 0.9, vehicleParts: 4.0, tires: 1.2, constructionGlass: 0.5 }, labor: 0.85, power: 0.74, ind: 'autoPlant' },
  industrialVehicles:{ in: { engines: 1.0, heavyMachinery: 0.4, tires: 1.1 },     labor: 0.92, power: 0.79, ind: 'heavyWorks' },
  freightVehicles:   { in: { trucks: 0.7, vehicleParts: 1.2, advancedAlloys: 0.05 }, labor: 0.88, power: 0.76, ind: 'autoPlant' },

  // ── 🧥 Consumer goods ─────────────────────────────────────────────────────
  fabric:                { in: { cotton: 0.8, syntheticFiber: 0.35 },              labor: 0.11, power: 0.19, ind: 'textileMill' },
  leather:               { in: { livestock: 0.25, acids: 0.06, industrialWater: 0.8 }, labor: 0.17, power: 0.21, ind: 'textileMill' },
  clothing:              { in: { fabric: 1.1, plantFiber: 0.1 },                   labor: 0.22, power: 0.14, ind: 'consumerPlant' },
  shoes:                 { in: { leather: 0.45, rubber: 0.25, adhesives: 0.05 },   labor: 0.24, power: 0.17, ind: 'consumerPlant' },
  furniture:             { in: { furnitureComponents: 1.0, fabric: 0.25, adhesives: 0.06 }, labor: 0.28, power: 0.19, ind: 'consumerPlant' },
  appliances:            { in: { sheetMetal: 0.5, electricalComponents: 0.4, plastic: 0.3, microchips: 0.05 }, labor: 0.34, power: 0.31, ind: 'consumerPlant', band: 'skilled' },
  householdGoods:        { in: { plastic: 0.5, sheetMetal: 0.2, glass: 0.15 },     labor: 0.16, power: 0.15, ind: 'consumerPlant' },
  personalCareProducts:  { in: { industrialChemicals: 0.3, herbs: 0.15, packagingMaterial: 0.12 }, labor: 0.14, power: 0.13, ind: 'consumerPlant' },
  cleaningProducts:      { in: { cleaningChemicals: 0.8, packagingMaterial: 0.12 },labor: 0.10, power: 0.11, ind: 'consumerPlant' },
  toys:                  { in: { plastic: 0.45, fabric: 0.15, electronicComponents: 0.05 }, labor: 0.18, power: 0.14, ind: 'consumerPlant' },
  sportingGoods:         { in: { plastic: 0.3, metalComponents: 0.2, fabric: 0.25, rubber: 0.1 }, labor: 0.21, power: 0.16, ind: 'consumerPlant' },
  books:                 { in: { paper: 1.2, printingInk: 0.1, adhesives: 0.03 }, labor: 0.15, power: 0.13, ind: 'cardPrinter' },
  luxuryGoods:           { in: { goldOre: 0.08, silverOre: 0.1, leather: 0.2, arcaneCrystal: 0.01 }, labor: 0.62, power: 0.28, ind: 'luxuryStore', band: 'skilled' },

  // ── 💊 Medical ────────────────────────────────────────────────────────────
  researchChemicals:     { in: { acids: 0.3, solvents: 0.25, industrialGas: 0.1 },labor: 0.38, power: 0.42, ind: 'pharma', band: 'advanced' },
  medicalSupplies:       { in: { fabric: 0.3, plastic: 0.25, cleaningChemicals: 0.1 }, labor: 0.18, power: 0.16, ind: 'medDevice' },
  medicine:              { in: { medicalChemicals: 0.55, herbs: 0.2, packagingMaterial: 0.08 }, labor: 0.32, power: 0.28, ind: 'pharma', band: 'technical' },
  pharmaceuticals:       { in: { medicalChemicals: 0.8, researchChemicals: 0.2, packagingMaterial: 0.1 }, labor: 0.52, power: 0.44, ind: 'pharma', band: 'advanced' },
  surgicalSupplies:      { in: { medicalSupplies: 0.6, advancedAlloys: 0.04, cleaningChemicals: 0.1 }, labor: 0.36, power: 0.24, ind: 'medDevice', band: 'technical' },
  medicalEquipment:      { in: { metalComponents: 0.4, electronicComponents: 0.35, sensors: 0.15 }, labor: 0.48, power: 0.39, ind: 'medDevice', band: 'technical' },
  diagnosticEquipment:   { in: { medicalEquipment: 0.6, advancedSensors: 0.2, processors: 0.1, displays: 0.15 }, labor: 0.68, power: 0.58, ind: 'medDevice', band: 'advanced' },
  advancedMedicine:      { in: { pharmaceuticals: 0.7, mythicEssence: 0.02, researchChemicals: 0.25 }, labor: 0.85, power: 0.71, ind: 'pharma', band: 'advanced' },

  // ── ♻️ Recycling ──────────────────────────────────────────────────────────
  recycledMetal:                { in: { industrialWaste: 1.6 },                    labor: 0.09, power: 0.31, ind: 'recycler' },
  recycledPlastic:              { in: { residentialWaste: 1.4, commercialWaste: 0.4 }, labor: 0.08, power: 0.26, ind: 'recycler' },
  recycledGlass:                { in: { residentialWaste: 1.2, commercialWaste: 0.3 }, labor: 0.07, power: 0.29, ind: 'recycler' },
  recycledPaper:                { in: { commercialWaste: 1.1, residentialWaste: 0.5 }, labor: 0.06, power: 0.21, ind: 'recycler' },
  recycledElectronics:          { in: { electronicWaste: 1.5, acids: 0.08 },       labor: 0.24, power: 0.44, ind: 'recycler', band: 'skilled' },
  compost:                      { in: { organicWaste: 1.8 },                       labor: 0.04, power: 0.07, ind: 'recycler' },
  reclaimedIndustrialMaterials: { in: { industrialWaste: 1.2, hazardousWaste: 0.3, solvents: 0.1 }, labor: 0.26, power: 0.48, ind: 'recycler', band: 'skilled' },

  // ── 📡 Communications ─────────────────────────────────────────────────────
  fiberOpticCable:      { in: { silica: 0.7, specialtyPolymers: 0.2, opticalComponents: 0.08 }, labor: 0.34, power: 0.47, ind: 'comms', band: 'technical' },
  communicationEquipment:{in: { communicationComponents: 1.0, metalComponents: 0.25, wiring: 0.2 }, labor: 0.42, power: 0.44, ind: 'comms', band: 'technical' },
  networkingEquipment:  { in: { circuitBoards: 0.6, processors: 0.2, wiring: 0.3 },labor: 0.46, power: 0.49, ind: 'comms', band: 'technical' },
  dataStorageHardware:  { in: { computerComponents: 0.7, advancedMicrochips: 0.1, metalComponents: 0.2 }, labor: 0.51, power: 0.55, ind: 'comms', band: 'advanced' },
  satelliteComponents:  { in: { aerospaceAluminum: 0.4, advancedSensors: 0.15, processors: 0.12, advancedBatteries: 0.1 }, labor: 0.88, power: 0.92, ind: 'aerospace', band: 'advanced' },

  // ── 🤖 Robotics ───────────────────────────────────────────────────────────
  robotics:                    { in: { machineParts: 0.8, processors: 0.2, advancedSensors: 0.15, electricalComponents: 0.3 }, labor: 0.74, power: 0.68, ind: 'roboticsPlant', band: 'advanced' },
  industrialRobots:            { in: { robotics: 0.9, heavyMachinery: 0.2, automationSystems: 0.15 }, labor: 0.92, power: 0.84, ind: 'roboticsPlant', band: 'advanced' },
  automationSystems:           { in: { processors: 0.3, sensors: 0.35, networkingEquipment: 0.15 }, labor: 0.68, power: 0.61, ind: 'roboticsPlant', band: 'advanced' },
  artificialIntelligenceHardware:{in:{ advancedMicrochips: 0.5, servers: 0.2, quantumComponents: 0.08 }, labor: 1.24, power: 1.38, ind: 'roboticsPlant', band: 'advanced' },
  quantumComponents:           { in: { siliconWafers: 0.4, rareEarthMinerals: 0.2, arcaneCrystal: 0.05, advancedAlloys: 0.08 }, labor: 1.45, power: 1.62, ind: 'semiFab', band: 'advanced' },
  droneComponents:             { in: { advancedBatteries: 0.25, sensors: 0.2, aerospaceAluminum: 0.15, processors: 0.08 }, labor: 0.64, power: 0.58, ind: 'aerospace', band: 'advanced' },

  /* ── 🃏 THE OUROBOROS CARD ECONOMY ────────────────────────────────────────
     The announcement's chain:
        Wood → Pulp → Card Stock
        Chemicals → Printing Ink
        Card Stock (+ Ink + Holographic Materials) → Ouroboros Printing
                                                 → Packaging → Distribution
                                                 → Card Shops → Players
     🔗 FOUNDATION RESERVE. `boosterPacks` and `collectorPacks` are the two ids
     the Foundation Reserve seam reads (see index.js `cardOutput()`): a city
     that actually prints packs reports that volume to the host, which is how
     "NPCs buying cards puts Cinder back into that supply chain" reaches the
     real game. The seam REPORTS; it never mints.

     ══ 🔴 WHY THE BASE CHAIN IS FOUR LINKS AND NOT NINE — READ BEFORE DEEPENING
     This block shipped as a nine-link chain and PRODUCED NOTHING, in every
     city, for the entire life of the feature. Measured, not guessed: a city
     with the whole card chain founded by hand ran 600 days at population 600
     and `cardOutput()` stayed {units:{}, totalUnits:0} — every card firm sat
     HEALTHY with `lastBottleneck {key:'printedCards', pct:0}` and inventory 0
     for printedCards / cardStock / holographicFoil on all 600 days.

     The cause is structural, and it is NOT that these ids failed
     `producible()` — they always passed it. A recipe only runs if some FIRM
     makes each of its inputs, a firm only exists where a BUILDING maps to it
     (ECO_BUILDING_MAP), and firms.js `produce()` takes the MINIMUM over
     inputs — so ONE homeless input darkens the whole chain behind it. The city
     has 52 building types and none of them is a chemical plant, a holographic
     works, a pulp line or an industrial-water intake, so every id descending
     from those was unreachable and always would be.

     So the BASE product line is rooted in industry a city actually has —
     forestry → sawmill → paper mill → press → shop — and every link is one
     step from something a building makes:
        timber → lumber → cardStock → printedCards → boosterPacks
     Cinder flows back up all five (payUpstream in sim.js), which is the
     announcement's sentence working rather than being quoted.

     ⚠ INK, FOIL AND COATING ARE DELIBERATELY OFF THE BASE LINE. They keep
       their full recipes and still gate the PREMIUM ids (`collectorPacks`,
       `cardBoxes`, `tournamentProducts`) — a city that ever builds a chemical
       tier prints better product than one that has not, which is the point.
       Putting even 0.02 of `holographicFoil` back into `boosterPacks` would
       re-darken the entire base line by the min rule above. tools/economy-
       tests/run.mjs round 0j is the tripwire for exactly that mistake: it
       walks every ECO_BUILDING_MAP output back to the ground and goes RED if
       a card id stops being reachable.
       (This said "round 0e" until FIX-D2. 0e is the founding-mint round and it
       EXISTS and is green, so a reader who followed the old pointer landed on a
       real but unrelated test and concluded the card line was covered. The
       matching pointer in node-city/index.html was wrong the same way. A bad
       cross-reference to a round that does not exist is a typo; one to a round
       that does is a trap.)
     ⚠ REJECTED: fixing this with ALT_FEEDSTOCK legs. It looks like the natural
       lever, and it is a trap — `availabilityMap()` (sim.js) only measures the
       inputs of the leg a firm is ALREADY running, so an alternate leg's
       inputs are absent from the map and read as fully available. Measured: an
       electricity plant on a node with no fuel at all hopped to the `biomass`
       leg and produced 1200 units from zero biomass. Alternate legs would have
       lit the card chain with product made out of nothing — a false green over
       a worse bug. The pre-existing hole is reported separately; nothing here
       leans on it. */
  /* 📄 PULPWOOD, NOT PLANKS, AND NO WATER LINE. Both halves of that were
     measured, and both cost a whole iteration:

     • `freshWater` was an input here and it killed the mill. Households drink
       first (runSubsistence), so industry gets the residual of the drinking
       supply: the mill ran on days 3–4 and then sat at `freshWater 0.000` from
       day 5 to day 600 while its wood availability climbed to 47%. The chain
       died of thirst next to a warehouse full of wood. `industrialWater` is
       the id that exists for exactly this and no city tile makes it. Water is
       NOT ignored — the host's own coverage multiplies every firm's output
       through firms.js `ctx.water`, which is one water figure for the whole
       city rather than a second one that competes with the people.

     • `lumber` was the input after that, and something worse happened: `lumber`
       is on BOTH sim.js's `UPKEEP_GOODS` (:812) and its `PROCUREMENT` (:870)
       lists, and both run AFTER production. Measured on node ouro-2: the
       sawmill made 206 lumber every single day and city upkeep plus municipal
       procurement bought every unit of it, so `S.INV.lumber` closed at exactly
       0.0 on all 600 days and the mill's availability was 0.000 forever. That
       hazard is not this chain's to fix (it starves `constructionComponents`
       the same way, and sim.js is where the reservation would have to live) —
       but a chain rooted on a good the city itself hoovers up is a chain that
       works on some nodes and not others for reasons no player could ever see.

     `timber` is on neither list, and a paper mill really does take roundwood
     rather than sawn planks — so the mill sits BESIDE the sawmill on the
     forestry camp's output rather than downstream of it. */
  cardStock:          { in: { timber: 1.9 },                                      labor: 0.16, power: 0.24, ind: 'paperMill', band: 'skilled' },
  inkChemicals:       { in: { industrialChemicals: 0.5, solvents: 0.25, quartz: 0.05 }, labor: 0.16, power: 0.24, ind: 'chemPlant' },
  printingInk:        { in: { inkChemicals: 0.9, specialtyPolymers: 0.06 },        labor: 0.13, power: 0.19, ind: 'chemPlant', band: 'skilled' },
  holographicFoil:    { in: { holographicChemicals: 0.4, aluminum: 0.2, specialtyPolymers: 0.15 }, labor: 0.42, power: 0.58, ind: 'holoWorks', band: 'advanced' },
  protectiveCoating:  { in: { specialtyPolymers: 0.35, solvents: 0.15 },           labor: 0.15, power: 0.21, ind: 'chemPlant', band: 'skilled' },
  /* 📦 KRAFT BOARD, NOT PLASTIC. Was `cardboard 0.7 + plastic 0.2`; cardboard
     descends from `recycledPaper` (a byproduct nothing ever adds to inventory)
     and plastic from `petrochemicals`, so all four Distributor tiles — depot,
     railyard, warehouse, caravanpost — employed people and produced zero.
     Rooted on `timber` for the same measured reason as `cardStock` above: not
     on sim.js's upkeep or procurement lists, so nothing strips it nightly.

     🔴 THIS LINE IS ALSO A DELIBERATE CONSUMER-BASKET RETUNE, AND IT SHIPPED
        ONCE WITHOUT SAYING SO. That is the real story of FIX-D2 and it is
        written here because the next person to touch this line needs it.

     `packagingMaterial` is an INPUT TO 13 GOODS, and only two of them are
     cards. Re-rooting it moved every one of them. Measured with
     Prices.deriveBase(true) on both recipe objects, changing NOTHING else:

        packagingMaterial   4.477 → 0.974   −78.2%
        packagedFood        3.440 → 2.723   −20.9%     snacks        −19.8%
        beverages          −19.1%   frozenFood −13.4%  emergencyFood −13.2%
        personalCare       −10.8%   processedMeat −8.3%  bottledWater −8.2%
        cleaningProducts    −5.6%   emergencySupplies −3.3%
        medicine            −2.0%   pharmaceuticals −0.9%  advancedMedicine −0.4%
        (card ids, in scope of the card package: boosterPacks −7.5%,
         cardBoxes −7.1%, starterDecks −6.6%, tournamentProducts −6.4%,
         collectorPacks −2.9%)
     19 of 258 derived ids moved. Eleven of them have nothing to do with cards.

     ── WHY THE REPRICE IS KEPT, AND WHY THE OLD PRICE WAS THE WRONG ONE ──────
     The obvious repair — keep a cardboard/plastic leg beside the timber leg so
     the price survives — was tried on paper and is STRUCTURALLY IMPOSSIBLE, not
     merely undesirable. Walking ECO_BUILDING_MAP (the round-0j walk) over every
     candidate input:
        cardboard  MAKEABLE, does NOT reach the ground   (recycledPaper below it)
        woodPulp   not in the map at all                 (needs industrialWater)
        industrialWater  not in the map at all           (no intake tile exists)
        plastic    not in the map at all                 (no refinery, no chem tier)
        recycledPaper    byproduct — nothing ever banks one
     There is no producible non-timber input. And ALT_FEEDSTOCK is rejected for
     this by measurement three comments up: sim.js `availabilityMap()` only sees
     the leg a firm is already running, so an alternate leg reads as fully
     available and manufactures product out of nothing.

     So the price HAD to move. It also SHOULD have: 42% of the old 4.477 was
     `plastic` alone (0.2 × 9.399 = 1.880 of 3.519 units of input cost), a
     petrochemical no city in this game can refine, and most of the rest was
     `cardboard`, half of which is near-free recycled fibre. 4.477 was the
     derived price of a plastic-and-scrap composite that could not be
     manufactured anywhere. 0.974 is the price of board pressed from roundwood a
     forestry camp actually cuts. Wood packaging really is a fraction of the cost
     of plastic packaging; the number fell because the MATERIAL changed.

     ⚠ AND IT BOUGHT THOSE ELEVEN GOODS NOTHING. Measured on the same walk: not
       one of them became producible. Nine (packagedFood, snacks, frozenFood,
       emergencyFood, personalCareProducts, processedMeat, bottledWater,
       cleaningProducts, pharmaceuticals) have no ECO_BUILDING_MAP row at all;
       `beverages` and `medicine` are mapped and still dark for reasons below
       them. The re-root changed ONLY what households and importers pay. Anyone
       arguing this line back the other way is arguing about the consumer
       basket, not about producibility, and should say so out loud.

     ⚠ REJECTED: raising the timber coefficient to soften the fall. Swept it —
       0.8→0.974, 1.1→1.218, 1.9→1.868, 4.0→3.573. Reaching 4.477 needs ≈5.1
       timber per unit of board, which is not a yield, it is a number picked to
       hit a target. Half the old price was plastic; no wood-rooted recipe can
       reproduce a petrochemical price, so the honest move is to report the
       retune rather than disguise it.

     🔒 run.mjs ROUND 0k now snapshots the WHOLE derived catalogue. Any edit in
        this file that moves any base price by >0.25% turns the gate red and
        names the ids. If you meant it, re-baseline the snapshot in the same
        commit — that is the point: the number changing is fine, the number
        changing SILENTLY is what cost us this package. */
  packagingMaterial:  { in: { timber: 0.8 },                                       labor: 0.07, power: 0.12, ind: 'packaging' },
  /* 🖨 ONE MATERIAL INPUT, ON PURPOSE. The press's power and water are already
     charged through `power:` and firms.js's ctx coverage; naming `electricity`
     as a MATERIAL here was tried and rejected — it would have made every card
     shop in the game depend on the node having coal in the ground. */
  printedCards:       { in: { cardStock: 1.05 },                                   labor: 0.28, power: 0.34, ind: 'cardPrinter', band: 'skilled' },
  boosterPacks:       { in: { printedCards: 0.85, packagingMaterial: 0.15 },       labor: 0.19, power: 0.21, ind: 'packaging' },
  starterDecks:       { in: { printedCards: 1.6, packagingMaterial: 0.25, paper: 0.1 }, labor: 0.24, power: 0.23, ind: 'packaging' },
  cardBoxes:          { in: { boosterPacks: 5.0, cardboard: 0.6 },                 labor: 0.16, power: 0.14, ind: 'packaging' },
  collectorPacks:     { in: { printedCards: 1.2, holographicFoil: 0.25, protectiveCoating: 0.1, packagingMaterial: 0.2 }, labor: 0.48, power: 0.36, ind: 'cardPrinter', band: 'skilled' },
  tournamentProducts: { in: { starterDecks: 1.5, cardBoxes: 0.3, officeSupplies: 0.2 }, labor: 0.34, power: 0.22, ind: 'packaging' },

  // ── ✨ Holographics ───────────────────────────────────────────────────────
  opticalComponents:      { in: { glass: 0.5, quartz: 0.3, specialtyPolymers: 0.1 }, labor: 0.44, power: 0.51, ind: 'holoWorks', band: 'technical' },
  holographicComponents:  { in: { opticalComponents: 0.6, holographicChemicals: 0.25, microchips: 0.1 }, labor: 0.72, power: 0.78, ind: 'holoWorks', band: 'advanced' },
  holographicChips:       { in: { advancedMicrochips: 0.3, holographicComponents: 0.25, quantumComponents: 0.04 }, labor: 0.96, power: 1.12, ind: 'holoWorks', band: 'advanced' },
  signalProcessors:       { in: { processors: 0.4, holographicChips: 0.1, circuitBoards: 0.2 }, labor: 0.82, power: 0.88, ind: 'holoWorks', band: 'advanced' },
  relayComponents:        { in: { communicationComponents: 0.4, holographicComponents: 0.15, copperWire: 0.2 }, labor: 0.61, power: 0.64, ind: 'holoWorks', band: 'advanced' },
  holographicProjectors:  { in: { holographicComponents: 1.0, signalProcessors: 0.2, opticalComponents: 0.3, advancedBatteries: 0.1 }, labor: 1.05, power: 1.24, ind: 'holoWorks', band: 'advanced' },

  // ── 🛰️ Aerospace ─────────────────────────────────────────────────────────
  aerospaceAluminum: { in: { aluminum: 1.2, titanium: 0.15, advancedAlloys: 0.08 }, labor: 0.58, power: 0.74, ind: 'aerospace', band: 'advanced' },
  satelliteSystems:  { in: { satelliteComponents: 1.4, signalProcessors: 0.2, advancedBatteries: 0.3, aerospaceAluminum: 0.5 }, labor: 1.62, power: 1.48, ind: 'aerospace', band: 'advanced' },

  /* ── 🛡️ SCP / CONTAINMENT ────────────────────────────────────────────────
     "SCP contracts could become some of the largest contracts available."
     These are the most expensive things in the graph BY DERIVATION, not by a
     hand-written price: every one of them pulls on the anomalous seam AND on
     the full electronics chain, so a city can only reach them by having built
     essentially everything else first. That is the intended gate. */
  containmentMaterials:             { in: { reinforcedConcrete: 0.8, advancedAlloys: 0.2, anomalousMatter: 0.05 }, labor: 0.94, power: 0.96, ind: 'containment', band: 'advanced' },
  reinforcedContainmentMaterials:   { in: { containmentMaterials: 1.0, realityMatter: 0.04, compositeMaterials: 0.3 }, labor: 1.28, power: 1.22, ind: 'containment', band: 'advanced' },
  realityStabilizationComponents:   { in: { realityFragments: 0.06, dimensionalMaterial: 0.08, quantumComponents: 0.1, advancedAlloys: 0.15 }, labor: 1.84, power: 1.96, ind: 'containment', band: 'advanced' },
  anomalySensors:                   { in: { advancedSensors: 0.5, anomalousEnergy: 0.06, holographicChips: 0.08 }, labor: 1.32, power: 1.34, ind: 'containment', band: 'advanced' },
  secureElectronics:                { in: { advancedMicrochips: 0.35, securityEquipment: 0.15, specialtyPolymers: 0.2 }, labor: 1.06, power: 1.08, ind: 'scpFoundry', band: 'advanced' },
  researchEquipment:                { in: { diagnosticEquipment: 0.4, advancedSensors: 0.3, researchChemicals: 0.2, computers: 0.2 }, labor: 1.14, power: 1.02, ind: 'containment', band: 'advanced' },
  containmentEquipment:             { in: { reinforcedContainmentMaterials: 0.7, anomalySensors: 0.2, realityStabilizationComponents: 0.1 }, labor: 1.76, power: 1.72, ind: 'containment', band: 'advanced' },
  specializedMedicalSupplies:       { in: { surgicalSupplies: 0.6, advancedMedicine: 0.15, mythicResidue: 0.04 }, labor: 1.08, power: 0.82, ind: 'medDevice', band: 'advanced' },
  hazardousMaterialEquipment:       { in: { protectiveEquipment: 0.6, containmentMaterials: 0.2, anomalySensors: 0.08 }, labor: 1.12, power: 0.94, ind: 'containment', band: 'advanced' },
  classifiedTechnology:             { in: { secureElectronics: 0.5, realityStabilizationComponents: 0.15, artificialIntelligenceHardware: 0.1, soulEnergy: 0.03 }, labor: 2.34, power: 2.28, ind: 'scpFoundry', band: 'advanced' },

  // ── 🔒 Security ───────────────────────────────────────────────────────────
  securityEquipment:      { in: { metalComponents: 0.4, sensors: 0.25, networkingEquipment: 0.1 }, labor: 0.52, power: 0.48, ind: 'scpFoundry', band: 'technical' },
  protectiveEquipment:    { in: { compositeMaterials: 0.5, fabric: 0.3, specialtyPolymers: 0.15 }, labor: 0.38, power: 0.31, ind: 'consumerPlant', band: 'skilled' },
  surveillanceEquipment:  { in: { sensors: 0.4, opticalComponents: 0.2, networkingEquipment: 0.15, dataStorageHardware: 0.1 }, labor: 0.74, power: 0.68, ind: 'scpFoundry', band: 'advanced' },

  // ── 🧰 Civic & emergency ──────────────────────────────────────────────────
  officeSupplies:     { in: { paper: 0.6, plastic: 0.2, printingInk: 0.05 },      labor: 0.09, power: 0.11, ind: 'civicWorks' },
  emergencyFood:      { in: { cannedFood: 0.8, packagedFood: 0.3, packagingMaterial: 0.1 }, labor: 0.12, power: 0.14, ind: 'civicWorks' },
  bottledWater:       { in: { freshWater: 1.2, plastic: 0.1, packagingMaterial: 0.05 }, labor: 0.08, power: 0.13, ind: 'civicWorks' },
  emergencySupplies:  { in: { medicalSupplies: 0.4, emergencyFood: 0.3, bottledWater: 0.3, householdGoods: 0.15 }, labor: 0.16, power: 0.13, ind: 'civicWorks' },
  emergencyEquipment: { in: { medicalEquipment: 0.3, protectiveEquipment: 0.3, communicationDevices: 0.15, generators: 0.1 }, labor: 0.58, power: 0.44, ind: 'civicWorks', band: 'skilled' },
};

/* ⚡ ALTERNATE FEEDSTOCKS — the same output from a different input.
   prices.js and firms.js pick the CHEAPEST leg that is actually available, so
   a coal shortage moves a city onto gas without the player touching anything,
   and the bottleneck panel names the leg it actually used. Only ids with a
   genuine real-world substitution get one; everything else has a single path
   on purpose, because substitutability everywhere means scarcity nowhere. */
export const ALT_FEEDSTOCK = {
  electricity: [
    { in: { coal: 0.12 },                  labor: 0.004, tag: 'coal'    },
    { in: { naturalGasFuel: 0.09 },        labor: 0.004, tag: 'gas'     },
    { in: { industrialFuel: 0.10 },        labor: 0.005, tag: 'oil'     },
    { in: { biomass: 0.22 },               labor: 0.008, tag: 'biomass' },
    { in: { hydrogen: 0.07 },              labor: 0.005, tag: 'hydrogen'},
    { in: { nuclearFuel: 0.0016 },         labor: 0.012, tag: 'nuclear' },
    { in: { anomalousEnergy: 0.0008 },     labor: 0.020, tag: 'anomalous', band: 'advanced' },
  ],
  steel:          [{ in: { pigIron: 1.05, coal: 0.22, metalAlloys: 0.04 }, labor: 0.11, tag: 'blast' },
                   { in: { recycledMetal: 1.15, electricity: 2.8 },        labor: 0.09, tag: 'arc'   }],
  paper:          [{ in: { woodPulp: 1.2, industrialChemicals: 0.08, industrialWater: 1.6 }, labor: 0.06, tag: 'virgin' },
                   { in: { recycledPaper: 1.25, industrialWater: 0.9 },    labor: 0.05, tag: 'recycled' }],
  plastic:        [{ in: { plasticFeedstock: 1.05 },                       labor: 0.06, tag: 'virgin' },
                   { in: { recycledPlastic: 1.1 },                         labor: 0.05, tag: 'recycled' }],
  glass:          [{ in: { silica: 1.2, sand: 0.4, industrialFuel: 0.09 }, labor: 0.07, tag: 'virgin' },
                   { in: { recycledGlass: 1.15, industrialFuel: 0.05 },    labor: 0.06, tag: 'recycled' }],
  aluminum:       [{ in: { aluminumOre: 2.0, electricity: 4.2 },           labor: 0.09, tag: 'primary' },
                   { in: { recycledMetal: 1.05, electricity: 0.5 },        labor: 0.07, tag: 'secondary' }],
  freshWater:     [{ in: { rawWater: 1.15 },                               labor: 0.02, tag: 'raw' },
                   { in: { reclaimedWater: 1.05 },                         labor: 0.03, tag: 'reclaimed' }],

  /* ⛏ CUSTOMERS FOR THE ORPHANED SEAMS.
     Nine DEPOSITS could be extracted and nothing in the city would ever buy
     them — the Survey graded the ground Rich and the tile produced into a void.
     Derived, not taken on trust: the count in the handover is twelve; walking
     RECIPES for anything nothing consumes gives NINE, and six of them
     (potatoes, freshFish, seafood, shellfish, seaweed, stone) are not from the
     new buildings at all. They were always orphans.

     🔴 THEY ARE LEGS, NOT EXTRA INPUTS ON THE DEFAULT, and that is the whole
        design. The resource round closed the phantom-feedstock hole, and the
        honest consequence is that plants on an under-built board already brown
        out. Adding seeds to animalFeed's DEFAULT leg would have deepened every
        feed chain's requirement — "give this deposit a customer" would have
        cost the city its animal feed. A leg is a route a firm takes when it
        has the stock and ignores when it does not.

     🔴 AND THEY BELONG HERE, NOT IN RECIPES. I first wrote them as arrays
        inside RECIPES, copying the shape of the entries above — but those
        entries ARE this object. legsOf() reads ALT_FEEDSTOCK first and
        otherwise takes `r.in` off the RECIPES row; an array has no `.in`, so
        the four recipes became inputless, i.e. FREE, and 69 base prices moved.
        The gate caught it ("a recipe edit did not silently reprice the
        catalogue"). Prices in this economy are derived from the graph and
        written down nowhere, so the container is not a detail.

     Each default leg below is byte-identical to its RECIPES row, because
     legsOf() replaces the default entirely once a key appears here — omitting
     it would delete the original route. */
  animalFeed:     [{ in: { corn: 0.6, soybeans: 0.3, biomass: 0.2 },      labor: 0.04, power: 0.05, tag: 'grain' },
                   { in: { seeds: 0.7, biomass: 0.25 },                   labor: 0.05, power: 0.05, tag: 'seedcake' },
                   { in: { seaweed: 1.1, corn: 0.2 },                     labor: 0.06, power: 0.06, tag: 'seaweed' }],
  preparedMeals:  [{ in: { meat: 0.25, vegetables: 0.4, rice: 0.3, cookingOil: 0.06 }, labor: 0.15, power: 0.17, tag: 'meat' },
                   { in: { potatoes: 0.8, vegetables: 0.3, cookingOil: 0.06 },         labor: 0.13, power: 0.16, tag: 'root' },
                   { in: { freshFish: 0.45, vegetables: 0.3, cookingOil: 0.05 },       labor: 0.16, power: 0.17, tag: 'fish' },
                   { in: { seafood: 0.4, shellfish: 0.15, vegetables: 0.25 },          labor: 0.19, power: 0.18, tag: 'shellfish' }],
  concrete:       [{ in: { cement: 0.45, gravel: 0.9, sand: 0.6, industrialWater: 0.4 }, labor: 0.06, power: 0.11, tag: 'gravel' },
                   { in: { cement: 0.45, stone: 1.0, sand: 0.5, industrialWater: 0.4 },  labor: 0.08, power: 0.14, tag: 'crushed' }],
  /* platinumOre yields 5 and rareMinerals 8, against nickel's ordinary seam —
     so these take far less ore and far more labour. A speciality melt, not a
     cheaper route to the same alloy. */
  metalAlloys:    [{ in: { nickelOre: 0.4, zincOre: 0.3, steel: 0.4 },       labor: 0.16, power: 0.38, tag: 'nickel', band: 'technical' },
                   { in: { rareMinerals: 0.12, nickelOre: 0.2, steel: 0.4 }, labor: 0.22, power: 0.42, tag: 'rare', band: 'technical' },
                   { in: { platinumOre: 0.05, zincOre: 0.25, steel: 0.4 },   labor: 0.26, power: 0.44, tag: 'platinum', band: 'technical' }],
};

/* ════════════════════════════════════════════════════════════════════════════
   📐 GRAPH HELPERS
   ════════════════════════════════════════════════════════════════════════════ */

export function isDeposit(id)   { return Object.prototype.hasOwnProperty.call(DEPOSITS, id); }
export function isByproduct(id) { return Object.prototype.hasOwnProperty.call(BYPRODUCTS, id); }
export function recipeOf(id)    { return RECIPES[id] || null; }
export function producible(id)  { return isDeposit(id) || isByproduct(id) || !!RECIPES[id]; }

/* The industry that makes an id, whether it is dug up or built. */
export function industryOf(id) {
  if (RECIPES[id]) return RECIPES[id].ind || null;
  if (DEPOSITS[id]) return DEPOSITS[id].ind || null;
  if (BYPRODUCTS[id]) return 'wasteWorks';
  return null;
}

/* The skill band a step draws its workers from. Recipe override, then the
   industry default, then unskilled — never undefined, because an undefined
   band prices a wage as NaN and NaN wages silently zero a firm's whole cost
   line, which reads as "this factory is free to run". */
export function bandOf(id) {
  const r = RECIPES[id] || DEPOSITS[id];
  if (r && r.band) return r.band;
  const ind = INDUSTRIES[industryOf(id)];
  return (ind && ind.band) || 'unskilled';
}

/* All recipe legs for an id — the primary plus any alternates, normalised to
   one shape so callers never branch on "does this have alternates". */
export function legsOf(id) {
  const alt = ALT_FEEDSTOCK[id];
  if (alt && alt.length) return alt.map((a, i) => ({ ...a, tag: a.tag || ('leg' + i) }));
  const r = RECIPES[id];
  return r ? [{ in: r.in, labor: r.labor, power: r.power, tag: 'default' }] : [];
}

/* Direct consumers of an id — "who buys what I make". Built once and cached;
   the graph is static so recomputing it per frame would be pure waste. */
let _consumers = null;
export function consumersOf(id) {
  if (!_consumers) {
    _consumers = {};
    for (const out in RECIPES) {
      for (const leg of legsOf(out)) {
        for (const inp in (leg.in || {})) {
          (_consumers[inp] = _consumers[inp] || []).push(out);
        }
      }
    }
    for (const k in _consumers) _consumers[k] = Array.from(new Set(_consumers[k]));
  }
  return _consumers[id] || [];
}

/* 🔻 TOPOLOGICAL ORDER — raws first, finished goods last.
   Everything downstream (price derivation, production scheduling, the
   bottleneck trace) needs to visit a resource only after its inputs.

   ⚠ CYCLES ARE REAL IN THIS GRAPH AND ARE NOT BUGS. `electricity` needs coal;
     `aluminum` needs electricity; `recycledMetal` needs industrialWaste which
     industry emits. A real economy is circular. So this is a DFS that breaks
     cycles by treating a back-edge as already-visited rather than throwing —
     the order is then "a valid order that respects every non-cyclic edge",
     which is all any caller actually needs. `cycles()` reports the back-edges
     it broke so the audit can print them rather than hide them. */
let _order = null, _cycles = null;
export function topoOrder() {
  if (_order) return _order;
  const seen = {}, stack = {}, out = [], cyc = [];
  const visit = (id) => {
    if (seen[id]) return;
    if (stack[id]) { cyc.push(id); return; }
    stack[id] = true;
    for (const leg of legsOf(id)) for (const inp in (leg.in || {})) visit(inp);
    stack[id] = false; seen[id] = true; out.push(id);
  };
  for (const id in DEPOSITS) visit(id);
  for (const id in BYPRODUCTS) visit(id);
  for (const id in RECIPES) visit(id);
  _order = out; _cycles = Array.from(new Set(cyc));
  return _order;
}
export function cycles() { topoOrder(); return _cycles; }

/* Everything an id transitively needs. Depth-capped because the graph has
   cycles — an uncapped walk on `aluminum → electricity → coal` is fine, but
   `steel → recycledMetal → industrialWaste` closes and would not terminate. */
export function ancestorsOf(id, maxDepth) {
  const cap = maxDepth || 12, out = new Set();
  const walk = (cur, d) => {
    if (d > cap) return;
    for (const leg of legsOf(cur)) for (const inp in (leg.in || {})) {
      if (out.has(inp)) continue;
      out.add(inp); walk(inp, d + 1);
    }
  };
  walk(id, 0);
  return Array.from(out);
}

/* ════════════════════════════════════════════════════════════════════════════
   🔍 AUDIT — proves this file and chain.js agree.
   Called by index.js at mount in dev and by the test harness. Returns a report
   rather than throwing: a broken recipe must not stop the city from loading,
   it must show up in the console with the exact id that is wrong.
   ════════════════════════════════════════════════════════════════════════════ */
export function audit(chainIds) {
  const known = new Set(chainIds || []);
  const rep = { ok: true, unknownOutputs: [], unknownInputs: [], orphans: [], unproducible: [], cycles: cycles() };
  const has = (id) => !known.size || known.has(id);

  for (const id in RECIPES) {
    if (!has(id)) { rep.unknownOutputs.push(id); }
    for (const leg of legsOf(id)) {
      for (const inp in (leg.in || {})) {
        if (!has(inp)) rep.unknownInputs.push(id + ' ← ' + inp);
        else if (!producible(inp)) rep.unproducible.push(id + ' ← ' + inp);
      }
    }
  }
  for (const id in DEPOSITS) if (!has(id)) rep.unknownOutputs.push('deposit:' + id);
  for (const id in BYPRODUCTS) if (!has(id)) rep.unknownOutputs.push('byproduct:' + id);
  // An id in the catalogue that nothing can make. Reported, not fatal: the
  // catalogue is allowed to run ahead of the economy, which is exactly the
  // state RESOURCES_NEXT.md describes and defends.
  for (const id of known) if (!producible(id)) rep.orphans.push(id);

  rep.ok = !rep.unknownOutputs.length && !rep.unknownInputs.length && !rep.unproducible.length;
  return rep;
}

export default { INDUSTRIES, DEPOSITS, BYPRODUCTS, RECIPES, ALT_FEEDSTOCK, audit };
