/* 🧰 RESOURCE CHAIN — the full industrial catalogue behind the city builder.
   258 entries, in the order they were specified, grouped by the supply
   chain they belong to. Generated once and then owned by hand.

   🔴 THIS IS A CATALOGUE, NOT THE LIVE LEDGER — and the difference is the whole
      reason it is a separate file. index.html has two lists already:

        RESOURCES     (14)  the LIVE ledger. Tradeable, spendable, priceable,
                            visible in the city builder.
        SALVAGE_RES  (149)  the loot catalogue. Lootable and bankable, but it
                            cannot be sold, spent, produced or seen.

      .cityloop/_r12/new_resources.NOTES.md documents what happens when an id
      sits in the second without the first: "A resource you can loot, bank, and
      be capped by — but cannot sell, spend, make, or see. That is not 'wood is
      missing'; it is worse than missing, because the player's pile of it is
      real and inert."

      Promoting all 258 of these into RESOURCES today would reproduce that
      fault 258 times over: every one would appear in every cost renderer,
      market dropdown and vault grid, and NOT ONE of them would have a producer,
      a terroir tier, or a node-city HUD entry. So promotion is deliberately a
      per-resource step that happens WITH its producer, not before it. See
      RESOURCES_NEXT.md for the five sites each promotion has to touch.

   ⚠ ids are stable and are the contract. `existing: true` marks an id that
     ALREADY lives in index.html (RESOURCES or SALVAGE_RES) — those are aliases
     so the chain can reference them, and must never be redefined there.

   `inputs` is empty on purpose. It is the recipe — what this resource consumes
   to be made — and it is tomorrow's work, filled in alongside each producer. */

export const RESOURCE_CATEGORIES = [
  { key: 'water',        label: 'Water',              icon: '💧',  color: '#7fd6ff' },
  { key: 'agriculture',  label: 'Agriculture',        icon: '🌾',  color: '#d9c46a' },
  { key: 'fishing',      label: 'Fishing',            icon: '🐟',  color: '#6fc0d8' },
  { key: 'food',         label: 'Food Processing',    icon: '🍞',  color: '#e0a86a' },
  { key: 'forestry',     label: 'Forestry & Paper',   icon: '🪵',  color: '#c08a4a' },
  { key: 'minerals',     label: 'Minerals & Ore',     icon: '🪨',  color: '#a8a29a' },
  { key: 'energy',       label: 'Energy & Fuel',      icon: '⚡',   color: '#ffcf6b' },
  { key: 'construction', label: 'Construction',       icon: '🧱',  color: '#c2725a' },
  { key: 'metals',       label: 'Metals',             icon: '⛓️',  color: '#9fb4d8' },
  { key: 'chemicals',    label: 'Chemicals',          icon: '⚗️',  color: '#9ad17a' },
  { key: 'machinery',    label: 'Machinery',          icon: '⚙️',  color: '#b0b7c3' },
  { key: 'electronics',  label: 'Electronics',        icon: '🔌',  color: '#7fb8ff' },
  { key: 'vehicles',     label: 'Vehicles',           icon: '🚗',  color: '#e08a5a' },
  { key: 'consumer',     label: 'Consumer Goods',     icon: '🧥',  color: '#e0b8c8' },
  { key: 'medical',      label: 'Medical',            icon: '💊',  color: '#ff8aa0' },
  { key: 'waste',        label: 'Waste',              icon: '🗑️', color: '#8a8578' },
  { key: 'recycling',    label: 'Recycling',          icon: '♻️',  color: '#86e08a' },
  { key: 'comms',        label: 'Communications',     icon: '📡',  color: '#8fd4ff' },
  { key: 'robotics',     label: 'Robotics & AI',      icon: '🤖',  color: '#c0a8ff' },
  { key: 'cards',        label: 'Card Production',    icon: '🃏',  color: '#d4af37' },
  { key: 'holographic',  label: 'Holographics',       icon: '✨',   color: '#9ad8ff' },
  { key: 'aerospace',    label: 'Aerospace',          icon: '🛰️', color: '#b8c4d8' },
  { key: 'anomalous',    label: 'Anomalous',          icon: '🟣',  color: '#b06bff' },
  { key: 'containment',  label: 'Containment',        icon: '🛡️', color: '#7fa8c8' },
  { key: 'security',     label: 'Security',           icon: '🔒',  color: '#c8a86a' },
  { key: 'civic',        label: 'Civic & Emergency',  icon: '🧰',  color: '#d4c8a8' },
];

export const RESOURCE_CHAIN = [

  // ── Water ─────────────────────────────────────────────────────
  { id: 'freshWater',              name: 'Fresh Water',                 icon: '💧',  color: '#7fd6ff', cat: 'water',        tier: 1, inputs: [] },
  { id: 'rawWater',                name: 'Raw Water',                   icon: '💧',  color: '#7fd6ff', cat: 'water',        tier: 0, inputs: [] },
  { id: 'industrialWater',         name: 'Industrial Water',            icon: '💧',  color: '#7fd6ff', cat: 'water',        tier: 1, inputs: [] },
  { id: 'reclaimedWater',          name: 'Reclaimed Water',             icon: '💧',  color: '#7fd6ff', cat: 'water',        tier: 1, inputs: [] },
  { id: 'wastewater',              name: 'Wastewater',                  icon: '💧',  color: '#7fd6ff', cat: 'water',        tier: 0, inputs: [] },

  // ── Agriculture ───────────────────────────────────────────────
  { id: 'wheat',                   name: 'Wheat',                       icon: '🌾',  color: '#d9c46a', cat: 'agriculture',  tier: 0, inputs: [] },
  { id: 'corn',                    name: 'Corn',                        icon: '🌾',  color: '#d9c46a', cat: 'agriculture',  tier: 0, inputs: [] },
  { id: 'rice',                    name: 'Rice',                        icon: '🌾',  color: '#d9c46a', cat: 'agriculture',  tier: 0, inputs: [] },
  { id: 'potatoes',                name: 'Potatoes',                    icon: '🌾',  color: '#d9c46a', cat: 'agriculture',  tier: 0, inputs: [] },
  { id: 'soybeans',                name: 'Soybeans',                    icon: '🌾',  color: '#d9c46a', cat: 'agriculture',  tier: 0, inputs: [] },
  { id: 'sugarCrops',              name: 'Sugar Crops',                 icon: '🌾',  color: '#d9c46a', cat: 'agriculture',  tier: 0, inputs: [] },
  { id: 'vegetables',              name: 'Vegetables',                  icon: '🌾',  color: '#d9c46a', cat: 'agriculture',  tier: 0, inputs: [] },
  { id: 'fruit',                   name: 'Fruit',                       icon: '🌾',  color: '#d9c46a', cat: 'agriculture',  tier: 0, inputs: [] },
  { id: 'herbs',                   name: 'Herbs',                       icon: '🌾',  color: '#d9c46a', cat: 'agriculture',  tier: 0, inputs: [] },
  { id: 'seeds',                   name: 'Seeds',                       icon: '🌾',  color: '#d9c46a', cat: 'agriculture',  tier: 0, existing: true, inputs: [] },
  { id: 'animalFeed',              name: 'Animal Feed',                 icon: '🌾',  color: '#d9c46a', cat: 'agriculture',  tier: 1, inputs: [] },
  { id: 'livestock',               name: 'Livestock',                   icon: '🌾',  color: '#d9c46a', cat: 'agriculture',  tier: 1, inputs: [] },
  { id: 'poultry',                 name: 'Poultry',                     icon: '🌾',  color: '#d9c46a', cat: 'agriculture',  tier: 1, inputs: [] },
  { id: 'eggs',                    name: 'Eggs',                        icon: '🌾',  color: '#d9c46a', cat: 'agriculture',  tier: 1, inputs: [] },
  { id: 'rawMilk',                 name: 'Raw Milk',                    icon: '🌾',  color: '#d9c46a', cat: 'agriculture',  tier: 1, inputs: [] },
  { id: 'cotton',                  name: 'Cotton',                      icon: '🌾',  color: '#d9c46a', cat: 'agriculture',  tier: 0, inputs: [] },
  { id: 'plantFiber',              name: 'Plant Fiber',                 icon: '🌾',  color: '#d9c46a', cat: 'agriculture',  tier: 0, inputs: [] },
  { id: 'biomass',                 name: 'Biomass',                     icon: '🌾',  color: '#d9c46a', cat: 'agriculture',  tier: 1, inputs: [] },

  // ── Fishing ───────────────────────────────────────────────────
  { id: 'freshFish',               name: 'Fresh Fish',                  icon: '🐟',  color: '#6fc0d8', cat: 'fishing',      tier: 0, inputs: [] },
  { id: 'seafood',                 name: 'Seafood',                     icon: '🐟',  color: '#6fc0d8', cat: 'fishing',      tier: 0, inputs: [] },
  { id: 'shellfish',               name: 'Shellfish',                   icon: '🐟',  color: '#6fc0d8', cat: 'fishing',      tier: 0, inputs: [] },
  { id: 'seaweed',                 name: 'Seaweed',                     icon: '🐟',  color: '#6fc0d8', cat: 'fishing',      tier: 0, inputs: [] },

  // ── Food Processing ───────────────────────────────────────────
  { id: 'flour',                   name: 'Flour',                       icon: '🍞',  color: '#e0a86a', cat: 'food',         tier: 1, inputs: [] },
  { id: 'bread',                   name: 'Bread',                       icon: '🍞',  color: '#e0a86a', cat: 'food',         tier: 1, inputs: [] },
  { id: 'meat',                    name: 'Meat',                        icon: '🍞',  color: '#e0a86a', cat: 'food',         tier: 1, inputs: [] },
  { id: 'processedMeat',           name: 'Processed Meat',              icon: '🍞',  color: '#e0a86a', cat: 'food',         tier: 1, inputs: [] },
  { id: 'dairy',                   name: 'Dairy',                       icon: '🍞',  color: '#e0a86a', cat: 'food',         tier: 1, inputs: [] },
  { id: 'cheese',                  name: 'Cheese',                      icon: '🍞',  color: '#e0a86a', cat: 'food',         tier: 1, inputs: [] },
  { id: 'cookingOil',              name: 'Cooking Oil',                 icon: '🍞',  color: '#e0a86a', cat: 'food',         tier: 1, inputs: [] },
  { id: 'sugar',                   name: 'Sugar',                       icon: '🍞',  color: '#e0a86a', cat: 'food',         tier: 1, inputs: [] },
  { id: 'packagedFood',            name: 'Packaged Food',               icon: '🍞',  color: '#e0a86a', cat: 'food',         tier: 1, inputs: [] },
  { id: 'frozenFood',              name: 'Frozen Food',                 icon: '🍞',  color: '#e0a86a', cat: 'food',         tier: 1, inputs: [] },
  { id: 'cannedFood',              name: 'Canned Food',                 icon: '🍞',  color: '#e0a86a', cat: 'food',         tier: 1, inputs: [] },
  { id: 'snacks',                  name: 'Snacks',                      icon: '🍞',  color: '#e0a86a', cat: 'food',         tier: 1, inputs: [] },
  { id: 'beverages',               name: 'Beverages',                   icon: '🍞',  color: '#e0a86a', cat: 'food',         tier: 1, inputs: [] },
  { id: 'preparedMeals',           name: 'Prepared Meals',              icon: '🍞',  color: '#e0a86a', cat: 'food',         tier: 1, inputs: [] },
  { id: 'restaurantSupplies',      name: 'Restaurant Supplies',         icon: '🍞',  color: '#e0a86a', cat: 'food',         tier: 1, inputs: [] },

  // ── Forestry & Paper ──────────────────────────────────────────
  { id: 'timber',                  name: 'Timber',                      icon: '🪵',  color: '#c08a4a', cat: 'forestry',     tier: 0, inputs: [] },
  { id: 'wood',                    name: 'Wood',                        icon: '🪵',  color: '#c08a4a', cat: 'forestry',     tier: 0, existing: true, inputs: [] },
  { id: 'lumber',                  name: 'Lumber',                      icon: '🪵',  color: '#c08a4a', cat: 'forestry',     tier: 1, inputs: [] },
  { id: 'plywood',                 name: 'Plywood',                     icon: '🪵',  color: '#c08a4a', cat: 'forestry',     tier: 1, inputs: [] },
  { id: 'woodPanels',              name: 'Wood Panels',                 icon: '🪵',  color: '#c08a4a', cat: 'forestry',     tier: 1, inputs: [] },
  { id: 'woodPulp',                name: 'Wood Pulp',                   icon: '🪵',  color: '#c08a4a', cat: 'forestry',     tier: 1, inputs: [] },
  { id: 'paper',                   name: 'Paper',                       icon: '🪵',  color: '#c08a4a', cat: 'forestry',     tier: 1, inputs: [] },
  { id: 'premiumPaper',            name: 'Premium Paper',               icon: '🪵',  color: '#c08a4a', cat: 'forestry',     tier: 2, inputs: [] },
  { id: 'cardboard',               name: 'Cardboard',                   icon: '🪵',  color: '#c08a4a', cat: 'forestry',     tier: 1, inputs: [] },
  { id: 'furnitureComponents',     name: 'Furniture Components',        icon: '🪵',  color: '#c08a4a', cat: 'forestry',     tier: 2, inputs: [] },

  // ── Minerals & Ore ────────────────────────────────────────────
  { id: 'stone',                   name: 'Stone',                       icon: '🪨',  color: '#a8a29a', cat: 'minerals',     tier: 0, existing: true, inputs: [] },
  { id: 'sand',                    name: 'Sand',                        icon: '🪨',  color: '#a8a29a', cat: 'minerals',     tier: 0, inputs: [] },
  { id: 'clay',                    name: 'Clay',                        icon: '🪨',  color: '#a8a29a', cat: 'minerals',     tier: 0, inputs: [] },
  { id: 'limestone',               name: 'Limestone',                   icon: '🪨',  color: '#a8a29a', cat: 'minerals',     tier: 0, inputs: [] },
  { id: 'gravel',                  name: 'Gravel',                      icon: '🪨',  color: '#a8a29a', cat: 'minerals',     tier: 0, inputs: [] },
  { id: 'ironOre',                 name: 'Iron Ore',                    icon: '🪨',  color: '#a8a29a', cat: 'minerals',     tier: 0, existing: true, inputs: [] },
  { id: 'copperOre',               name: 'Copper Ore',                  icon: '🪨',  color: '#a8a29a', cat: 'minerals',     tier: 0, inputs: [] },
  { id: 'aluminumOre',             name: 'Aluminum Ore',                icon: '🪨',  color: '#a8a29a', cat: 'minerals',     tier: 0, inputs: [] },
  { id: 'nickelOre',               name: 'Nickel Ore',                  icon: '🪨',  color: '#a8a29a', cat: 'minerals',     tier: 0, inputs: [] },
  { id: 'zincOre',                 name: 'Zinc Ore',                    icon: '🪨',  color: '#a8a29a', cat: 'minerals',     tier: 0, inputs: [] },
  { id: 'goldOre',                 name: 'Gold Ore',                    icon: '🪨',  color: '#a8a29a', cat: 'minerals',     tier: 0, inputs: [] },
  { id: 'silverOre',               name: 'Silver Ore',                  icon: '🪨',  color: '#a8a29a', cat: 'minerals',     tier: 0, inputs: [] },
  { id: 'platinumOre',             name: 'Platinum Ore',                icon: '🪨',  color: '#a8a29a', cat: 'minerals',     tier: 0, inputs: [] },
  { id: 'lithium',                 name: 'Lithium',                     icon: '🪨',  color: '#a8a29a', cat: 'minerals',     tier: 0, inputs: [] },
  { id: 'cobalt',                  name: 'Cobalt',                      icon: '🪨',  color: '#a8a29a', cat: 'minerals',     tier: 0, inputs: [] },
  { id: 'titanium',                name: 'Titanium',                    icon: '🪨',  color: '#a8a29a', cat: 'minerals',     tier: 0, inputs: [] },
  { id: 'tungsten',                name: 'Tungsten',                    icon: '🪨',  color: '#a8a29a', cat: 'minerals',     tier: 0, inputs: [] },
  { id: 'rareEarthMinerals',       name: 'Rare Earth Minerals',         icon: '🪨',  color: '#a8a29a', cat: 'minerals',     tier: 0, inputs: [] },
  { id: 'rareMinerals',            name: 'Rare Minerals',               icon: '🪨',  color: '#a8a29a', cat: 'minerals',     tier: 0, existing: true, inputs: [] },
  { id: 'quartz',                  name: 'Quartz',                      icon: '🪨',  color: '#a8a29a', cat: 'minerals',     tier: 0, inputs: [] },
  { id: 'silica',                  name: 'Silica',                      icon: '🪨',  color: '#a8a29a', cat: 'minerals',     tier: 0, inputs: [] },

  // ── Energy & Fuel ─────────────────────────────────────────────
  { id: 'coal',                    name: 'Coal',                        icon: '⚡',   color: '#ffcf6b', cat: 'energy',       tier: 0, inputs: [] },
  { id: 'crudeOil',                name: 'Crude Oil',                   icon: '⚡',   color: '#ffcf6b', cat: 'energy',       tier: 0, inputs: [] },
  { id: 'naturalGas',              name: 'Natural Gas',                 icon: '⚡',   color: '#ffcf6b', cat: 'energy',       tier: 0, inputs: [] },
  { id: 'gasoline',                name: 'Gasoline',                    icon: '⚡',   color: '#ffcf6b', cat: 'energy',       tier: 1, inputs: [] },
  { id: 'diesel',                  name: 'Diesel',                      icon: '⚡',   color: '#ffcf6b', cat: 'energy',       tier: 1, inputs: [] },
  { id: 'industrialFuel',          name: 'Industrial Fuel',             icon: '⚡',   color: '#ffcf6b', cat: 'energy',       tier: 1, inputs: [] },
  { id: 'aviationFuel',            name: 'Aviation Fuel',               icon: '⚡',   color: '#ffcf6b', cat: 'energy',       tier: 1, inputs: [] },
  { id: 'naturalGasFuel',          name: 'Natural Gas Fuel',            icon: '⚡',   color: '#ffcf6b', cat: 'energy',       tier: 1, inputs: [] },
  { id: 'nuclearFuel',             name: 'Nuclear Fuel',                icon: '⚡',   color: '#ffcf6b', cat: 'energy',       tier: 1, inputs: [] },
  { id: 'hydrogen',                name: 'Hydrogen',                    icon: '⚡',   color: '#ffcf6b', cat: 'energy',       tier: 1, inputs: [] },
  { id: 'electricity',             name: 'Electricity',                 icon: '⚡',   color: '#ffcf6b', cat: 'energy',       tier: 1, inputs: [] },

  // ── Construction ──────────────────────────────────────────────
  { id: 'brick',                   name: 'Brick',                       icon: '🧱',  color: '#c2725a', cat: 'construction', tier: 1, inputs: [] },
  { id: 'cement',                  name: 'Cement',                      icon: '🧱',  color: '#c2725a', cat: 'construction', tier: 1, inputs: [] },
  { id: 'concrete',                name: 'Concrete',                    icon: '🧱',  color: '#c2725a', cat: 'construction', tier: 1, inputs: [] },
  { id: 'glass',                   name: 'Glass',                       icon: '🧱',  color: '#c2725a', cat: 'construction', tier: 1, inputs: [] },
  { id: 'steel',                   name: 'Steel',                       icon: '🧱',  color: '#c2725a', cat: 'construction', tier: 1, inputs: [] },
  { id: 'asphalt',                 name: 'Asphalt',                     icon: '🧱',  color: '#c2725a', cat: 'construction', tier: 1, inputs: [] },
  { id: 'structuralSteel',         name: 'Structural Steel',            icon: '🧱',  color: '#c2725a', cat: 'construction', tier: 1, inputs: [] },
  { id: 'reinforcedConcrete',      name: 'Reinforced Concrete',         icon: '🧱',  color: '#c2725a', cat: 'construction', tier: 1, existing: true, inputs: [] },
  { id: 'insulation',              name: 'Insulation',                  icon: '🧱',  color: '#c2725a', cat: 'construction', tier: 1, inputs: [] },
  { id: 'constructionGlass',       name: 'Construction Glass',          icon: '🧱',  color: '#c2725a', cat: 'construction', tier: 1, inputs: [] },
  { id: 'compositeMaterials',      name: 'Composite Materials',         icon: '🧱',  color: '#c2725a', cat: 'construction', tier: 1, inputs: [] },
  { id: 'constructionComponents',  name: 'Construction Components',     icon: '🧱',  color: '#c2725a', cat: 'construction', tier: 1, inputs: [] },
  { id: 'prefabricatedComponents', name: 'Prefabricated Components',    icon: '🧱',  color: '#c2725a', cat: 'construction', tier: 1, inputs: [] },
  { id: 'electricalComponents',    name: 'Electrical Components',       icon: '🧱',  color: '#c2725a', cat: 'construction', tier: 1, inputs: [] },
  { id: 'plumbingComponents',      name: 'Plumbing Components',         icon: '🧱',  color: '#c2725a', cat: 'construction', tier: 1, inputs: [] },

  // ── Metals ────────────────────────────────────────────────────
  { id: 'pigIron',                 name: 'Pig Iron',                    icon: '⛓️',  color: '#9fb4d8', cat: 'metals',       tier: 1, inputs: [] },
  { id: 'sheetMetal',              name: 'Sheet Metal',                 icon: '⛓️',  color: '#9fb4d8', cat: 'metals',       tier: 1, inputs: [] },
  { id: 'metalComponents',         name: 'Metal Components',            icon: '⛓️',  color: '#9fb4d8', cat: 'metals',       tier: 1, inputs: [] },
  { id: 'aluminum',                name: 'Aluminum',                    icon: '⛓️',  color: '#9fb4d8', cat: 'metals',       tier: 1, inputs: [] },
  { id: 'copper',                  name: 'Copper',                      icon: '⛓️',  color: '#9fb4d8', cat: 'metals',       tier: 1, inputs: [] },
  { id: 'copperWire',              name: 'Copper Wire',                 icon: '⛓️',  color: '#9fb4d8', cat: 'metals',       tier: 1, inputs: [] },
  { id: 'metalAlloys',             name: 'Metal Alloys',                icon: '⛓️',  color: '#9fb4d8', cat: 'metals',       tier: 1, inputs: [] },
  { id: 'advancedAlloys',          name: 'Advanced Alloys',             icon: '⛓️',  color: '#9fb4d8', cat: 'metals',       tier: 1, inputs: [] },

  // ── Chemicals ─────────────────────────────────────────────────
  { id: 'industrialChemicals',     name: 'Industrial Chemicals',        icon: '⚗️',  color: '#9ad17a', cat: 'chemicals',    tier: 1, inputs: [] },
  { id: 'acids',                   name: 'Acids',                       icon: '⚗️',  color: '#9ad17a', cat: 'chemicals',    tier: 1, inputs: [] },
  { id: 'solvents',                name: 'Solvents',                    icon: '⚗️',  color: '#9ad17a', cat: 'chemicals',    tier: 1, inputs: [] },
  { id: 'fertilizer',              name: 'Fertilizer',                  icon: '⚗️',  color: '#9ad17a', cat: 'chemicals',    tier: 1, existing: true, inputs: [] },
  { id: 'industrialGas',           name: 'Industrial Gas',              icon: '⚗️',  color: '#9ad17a', cat: 'chemicals',    tier: 1, inputs: [] },
  { id: 'plastic',                 name: 'Plastic',                     icon: '⚗️',  color: '#9ad17a', cat: 'chemicals',    tier: 1, inputs: [] },
  { id: 'rubber',                  name: 'Rubber',                      icon: '⚗️',  color: '#9ad17a', cat: 'chemicals',    tier: 1, inputs: [] },
  { id: 'syntheticFiber',          name: 'Synthetic Fiber',             icon: '⚗️',  color: '#9ad17a', cat: 'chemicals',    tier: 1, inputs: [] },
  { id: 'paint',                   name: 'Paint',                       icon: '⚗️',  color: '#9ad17a', cat: 'chemicals',    tier: 1, inputs: [] },
  { id: 'adhesives',               name: 'Adhesives',                   icon: '⚗️',  color: '#9ad17a', cat: 'chemicals',    tier: 1, inputs: [] },
  { id: 'cleaningChemicals',       name: 'Cleaning Chemicals',          icon: '⚗️',  color: '#9ad17a', cat: 'chemicals',    tier: 1, inputs: [] },
  { id: 'semiconductorChemicals',  name: 'Semiconductor Chemicals',     icon: '⚗️',  color: '#9ad17a', cat: 'chemicals',    tier: 1, inputs: [] },
  { id: 'medicalChemicals',        name: 'Medical Chemicals',           icon: '⚗️',  color: '#9ad17a', cat: 'chemicals',    tier: 1, inputs: [] },
  { id: 'holographicChemicals',    name: 'Holographic Chemicals',       icon: '⚗️',  color: '#9ad17a', cat: 'chemicals',    tier: 1, inputs: [] },
  { id: 'specialtyPolymers',       name: 'Specialty Polymers',          icon: '⚗️',  color: '#9ad17a', cat: 'chemicals',    tier: 1, inputs: [] },
  { id: 'petrochemicals',          name: 'Petrochemicals',              icon: '⚗️',  color: '#9ad17a', cat: 'chemicals',    tier: 1, inputs: [] },
  { id: 'plasticFeedstock',        name: 'Plastic Feedstock',           icon: '⚗️',  color: '#9ad17a', cat: 'chemicals',    tier: 1, inputs: [] },
  { id: 'chemicalFeedstock',       name: 'Chemical Feedstock',          icon: '⚗️',  color: '#9ad17a', cat: 'chemicals',    tier: 1, inputs: [] },

  // ── Machinery ─────────────────────────────────────────────────
  { id: 'machineParts',            name: 'Machine Parts',               icon: '⚙️',  color: '#b0b7c3', cat: 'machinery',    tier: 2, inputs: [] },
  { id: 'industrialMachinery',     name: 'Industrial Machinery',        icon: '⚙️',  color: '#b0b7c3', cat: 'machinery',    tier: 2, inputs: [] },
  { id: 'heavyMachinery',          name: 'Heavy Machinery',             icon: '⚙️',  color: '#b0b7c3', cat: 'machinery',    tier: 2, inputs: [] },
  { id: 'agriculturalMachinery',   name: 'Agricultural Machinery',      icon: '⚙️',  color: '#b0b7c3', cat: 'machinery',    tier: 2, inputs: [] },
  { id: 'constructionEquipment',   name: 'Construction Equipment',      icon: '⚙️',  color: '#b0b7c3', cat: 'machinery',    tier: 2, inputs: [] },
  { id: 'miningEquipment',         name: 'Mining Equipment',            icon: '⚙️',  color: '#b0b7c3', cat: 'machinery',    tier: 2, inputs: [] },
  { id: 'factoryEquipment',        name: 'Factory Equipment',           icon: '⚙️',  color: '#b0b7c3', cat: 'machinery',    tier: 2, inputs: [] },
  { id: 'pumps',                   name: 'Pumps',                       icon: '⚙️',  color: '#b0b7c3', cat: 'machinery',    tier: 2, inputs: [] },
  { id: 'turbines',                name: 'Turbines',                    icon: '⚙️',  color: '#b0b7c3', cat: 'machinery',    tier: 2, inputs: [] },
  { id: 'generators',              name: 'Generators',                  icon: '⚙️',  color: '#b0b7c3', cat: 'machinery',    tier: 2, inputs: [] },

  // ── Electronics ───────────────────────────────────────────────
  { id: 'electronicComponents',    name: 'Electronic Components',       icon: '🔌',  color: '#7fb8ff', cat: 'electronics',  tier: 2, inputs: [] },
  { id: 'circuitBoards',           name: 'Circuit Boards',              icon: '🔌',  color: '#7fb8ff', cat: 'electronics',  tier: 2, existing: true, inputs: [] },
  { id: 'wiring',                  name: 'Wiring',                      icon: '🔌',  color: '#7fb8ff', cat: 'electronics',  tier: 2, inputs: [] },
  { id: 'batteries',               name: 'Batteries',                   icon: '🔌',  color: '#7fb8ff', cat: 'electronics',  tier: 2, inputs: [] },
  { id: 'microchips',              name: 'Microchips',                  icon: '🔌',  color: '#7fb8ff', cat: 'electronics',  tier: 2, inputs: [] },
  { id: 'processors',              name: 'Processors',                  icon: '🔌',  color: '#7fb8ff', cat: 'electronics',  tier: 2, inputs: [] },
  { id: 'sensors',                 name: 'Sensors',                     icon: '🔌',  color: '#7fb8ff', cat: 'electronics',  tier: 2, inputs: [] },
  { id: 'communicationComponents', name: 'Communication Components',    icon: '🔌',  color: '#7fb8ff', cat: 'electronics',  tier: 2, inputs: [] },
  { id: 'advancedBatteries',       name: 'Advanced Batteries',          icon: '🔌',  color: '#7fb8ff', cat: 'electronics',  tier: 2, inputs: [] },
  { id: 'computerComponents',      name: 'Computer Components',         icon: '🔌',  color: '#7fb8ff', cat: 'electronics',  tier: 2, inputs: [] },
  { id: 'computers',               name: 'Computers',                   icon: '🔌',  color: '#7fb8ff', cat: 'electronics',  tier: 2, inputs: [] },
  { id: 'smartphones',             name: 'Smartphones',                 icon: '🔌',  color: '#7fb8ff', cat: 'electronics',  tier: 2, inputs: [] },
  { id: 'displays',                name: 'Displays',                    icon: '🔌',  color: '#7fb8ff', cat: 'electronics',  tier: 2, inputs: [] },
  { id: 'communicationDevices',    name: 'Communication Devices',       icon: '🔌',  color: '#7fb8ff', cat: 'electronics',  tier: 2, inputs: [] },
  { id: 'servers',                 name: 'Servers',                     icon: '🔌',  color: '#7fb8ff', cat: 'electronics',  tier: 2, inputs: [] },
  { id: 'semiconductorMaterials',  name: 'Semiconductor Materials',     icon: '🔌',  color: '#7fb8ff', cat: 'electronics',  tier: 2, inputs: [] },
  { id: 'siliconWafers',           name: 'Silicon Wafers',              icon: '🔌',  color: '#7fb8ff', cat: 'electronics',  tier: 2, inputs: [] },
  { id: 'advancedMicrochips',      name: 'Advanced Microchips',         icon: '🔌',  color: '#7fb8ff', cat: 'electronics',  tier: 2, inputs: [] },

  // ── Vehicles ──────────────────────────────────────────────────
  { id: 'engines',                 name: 'Engines',                     icon: '🚗',  color: '#e08a5a', cat: 'vehicles',     tier: 2, inputs: [] },
  { id: 'vehicleParts',            name: 'Vehicle Parts',               icon: '🚗',  color: '#e08a5a', cat: 'vehicles',     tier: 2, inputs: [] },
  { id: 'tires',                   name: 'Tires',                       icon: '🚗',  color: '#e08a5a', cat: 'vehicles',     tier: 2, inputs: [] },
  { id: 'maintenanceParts',        name: 'Maintenance Parts',           icon: '🚗',  color: '#e08a5a', cat: 'vehicles',     tier: 2, inputs: [] },
  { id: 'cars',                    name: 'Cars',                        icon: '🚗',  color: '#e08a5a', cat: 'vehicles',     tier: 2, inputs: [] },
  { id: 'electricVehicles',        name: 'Electric Vehicles',           icon: '🚗',  color: '#e08a5a', cat: 'vehicles',     tier: 2, inputs: [] },
  { id: 'trucks',                  name: 'Trucks',                      icon: '🚗',  color: '#e08a5a', cat: 'vehicles',     tier: 2, inputs: [] },
  { id: 'deliveryVehicles',        name: 'Delivery Vehicles',           icon: '🚗',  color: '#e08a5a', cat: 'vehicles',     tier: 2, inputs: [] },
  { id: 'buses',                   name: 'Buses',                       icon: '🚗',  color: '#e08a5a', cat: 'vehicles',     tier: 2, inputs: [] },
  { id: 'industrialVehicles',      name: 'Industrial Vehicles',         icon: '🚗',  color: '#e08a5a', cat: 'vehicles',     tier: 2, inputs: [] },
  { id: 'freightVehicles',         name: 'Freight Vehicles',            icon: '🚗',  color: '#e08a5a', cat: 'vehicles',     tier: 2, inputs: [] },

  // ── Consumer Goods ────────────────────────────────────────────
  { id: 'clothing',                name: 'Clothing',                    icon: '🧥',  color: '#e0b8c8', cat: 'consumer',     tier: 2, inputs: [] },
  { id: 'shoes',                   name: 'Shoes',                       icon: '🧥',  color: '#e0b8c8', cat: 'consumer',     tier: 2, inputs: [] },
  { id: 'fabric',                  name: 'Fabric',                      icon: '🧥',  color: '#e0b8c8', cat: 'consumer',     tier: 2, inputs: [] },
  { id: 'leather',                 name: 'Leather',                     icon: '🧥',  color: '#e0b8c8', cat: 'consumer',     tier: 2, existing: true, inputs: [] },
  { id: 'furniture',               name: 'Furniture',                   icon: '🧥',  color: '#e0b8c8', cat: 'consumer',     tier: 2, inputs: [] },
  { id: 'appliances',              name: 'Appliances',                  icon: '🧥',  color: '#e0b8c8', cat: 'consumer',     tier: 2, inputs: [] },
  { id: 'householdGoods',          name: 'Household Goods',             icon: '🧥',  color: '#e0b8c8', cat: 'consumer',     tier: 2, inputs: [] },
  { id: 'personalCareProducts',    name: 'Personal Care Products',      icon: '🧥',  color: '#e0b8c8', cat: 'consumer',     tier: 2, inputs: [] },
  { id: 'cleaningProducts',        name: 'Cleaning Products',           icon: '🧥',  color: '#e0b8c8', cat: 'consumer',     tier: 2, inputs: [] },
  { id: 'toys',                    name: 'Toys',                        icon: '🧥',  color: '#e0b8c8', cat: 'consumer',     tier: 2, inputs: [] },
  { id: 'sportingGoods',           name: 'Sporting Goods',              icon: '🧥',  color: '#e0b8c8', cat: 'consumer',     tier: 2, inputs: [] },
  { id: 'books',                   name: 'Books',                       icon: '🧥',  color: '#e0b8c8', cat: 'consumer',     tier: 2, inputs: [] },
  { id: 'luxuryGoods',             name: 'Luxury Goods',                icon: '🧥',  color: '#e0b8c8', cat: 'consumer',     tier: 2, inputs: [] },

  // ── Medical ───────────────────────────────────────────────────
  { id: 'medicalSupplies',         name: 'Medical Supplies',            icon: '💊',  color: '#ff8aa0', cat: 'medical',      tier: 2, existing: true, inputs: [] },
  { id: 'medicine',                name: 'Medicine',                    icon: '💊',  color: '#ff8aa0', cat: 'medical',      tier: 2, existing: true, inputs: [] },
  { id: 'pharmaceuticals',         name: 'Pharmaceuticals',             icon: '💊',  color: '#ff8aa0', cat: 'medical',      tier: 2, inputs: [] },
  { id: 'surgicalSupplies',        name: 'Surgical Supplies',           icon: '💊',  color: '#ff8aa0', cat: 'medical',      tier: 2, inputs: [] },
  { id: 'medicalEquipment',        name: 'Medical Equipment',           icon: '💊',  color: '#ff8aa0', cat: 'medical',      tier: 2, inputs: [] },
  { id: 'diagnosticEquipment',     name: 'Diagnostic Equipment',        icon: '💊',  color: '#ff8aa0', cat: 'medical',      tier: 2, inputs: [] },
  { id: 'advancedMedicine',        name: 'Advanced Medicine',           icon: '💊',  color: '#ff8aa0', cat: 'medical',      tier: 2, inputs: [] },
  { id: 'researchChemicals',       name: 'Research Chemicals',          icon: '💊',  color: '#ff8aa0', cat: 'medical',      tier: 2, inputs: [] },

  // ── Waste ─────────────────────────────────────────────────────
  { id: 'residentialWaste',        name: 'Residential Waste',           icon: '🗑️', color: '#8a8578', cat: 'waste',        tier: 0, inputs: [] },
  { id: 'commercialWaste',         name: 'Commercial Waste',            icon: '🗑️', color: '#8a8578', cat: 'waste',        tier: 0, inputs: [] },
  { id: 'industrialWaste',         name: 'Industrial Waste',            icon: '🗑️', color: '#8a8578', cat: 'waste',        tier: 0, inputs: [] },
  { id: 'organicWaste',            name: 'Organic Waste',               icon: '🗑️', color: '#8a8578', cat: 'waste',        tier: 0, inputs: [] },
  { id: 'electronicWaste',         name: 'Electronic Waste',            icon: '🗑️', color: '#8a8578', cat: 'waste',        tier: 0, inputs: [] },
  { id: 'medicalWaste',            name: 'Medical Waste',               icon: '🗑️', color: '#8a8578', cat: 'waste',        tier: 0, inputs: [] },
  { id: 'hazardousWaste',          name: 'Hazardous Waste',             icon: '🗑️', color: '#8a8578', cat: 'waste',        tier: 0, inputs: [] },

  // ── Recycling ─────────────────────────────────────────────────
  { id: 'recycledMetal',           name: 'Recycled Metal',              icon: '♻️',  color: '#86e08a', cat: 'recycling',    tier: 1, inputs: [] },
  { id: 'recycledPlastic',         name: 'Recycled Plastic',            icon: '♻️',  color: '#86e08a', cat: 'recycling',    tier: 1, inputs: [] },
  { id: 'recycledGlass',           name: 'Recycled Glass',              icon: '♻️',  color: '#86e08a', cat: 'recycling',    tier: 1, inputs: [] },
  { id: 'recycledPaper',           name: 'Recycled Paper',              icon: '♻️',  color: '#86e08a', cat: 'recycling',    tier: 1, inputs: [] },
  { id: 'recycledElectronics',     name: 'Recycled Electronics',        icon: '♻️',  color: '#86e08a', cat: 'recycling',    tier: 1, inputs: [] },
  { id: 'compost',                 name: 'Compost',                     icon: '♻️',  color: '#86e08a', cat: 'recycling',    tier: 1, inputs: [] },
  { id: 'reclaimedIndustrialMaterials', name: 'Reclaimed Industrial Materials', icon: '♻️',  color: '#86e08a', cat: 'recycling',    tier: 1, inputs: [] },

  // ── Communications ────────────────────────────────────────────
  { id: 'fiberOpticCable',         name: 'Fiber Optic Cable',           icon: '📡',  color: '#8fd4ff', cat: 'comms',        tier: 2, inputs: [] },
  { id: 'communicationEquipment',  name: 'Communication Equipment',     icon: '📡',  color: '#8fd4ff', cat: 'comms',        tier: 2, inputs: [] },
  { id: 'networkingEquipment',     name: 'Networking Equipment',        icon: '📡',  color: '#8fd4ff', cat: 'comms',        tier: 2, inputs: [] },
  { id: 'dataStorageHardware',     name: 'Data Storage Hardware',       icon: '📡',  color: '#8fd4ff', cat: 'comms',        tier: 2, inputs: [] },
  { id: 'satelliteComponents',     name: 'Satellite Components',        icon: '📡',  color: '#8fd4ff', cat: 'comms',        tier: 2, inputs: [] },

  // ── Robotics & AI ─────────────────────────────────────────────
  { id: 'robotics',                name: 'Robotics',                    icon: '🤖',  color: '#c0a8ff', cat: 'robotics',     tier: 2, inputs: [] },
  { id: 'automationSystems',       name: 'Automation Systems',          icon: '🤖',  color: '#c0a8ff', cat: 'robotics',     tier: 2, inputs: [] },
  { id: 'artificialIntelligenceHardware', name: 'Artificial Intelligence Hardware', icon: '🤖',  color: '#c0a8ff', cat: 'robotics',     tier: 2, inputs: [] },
  { id: 'advancedSensors',         name: 'Advanced Sensors',            icon: '🤖',  color: '#c0a8ff', cat: 'robotics',     tier: 2, inputs: [] },
  { id: 'quantumComponents',       name: 'Quantum Components',          icon: '🤖',  color: '#c0a8ff', cat: 'robotics',     tier: 2, inputs: [] },
  { id: 'droneComponents',         name: 'Drone Components',            icon: '🤖',  color: '#c0a8ff', cat: 'robotics',     tier: 2, inputs: [] },
  { id: 'industrialRobots',        name: 'Industrial Robots',           icon: '🤖',  color: '#c0a8ff', cat: 'robotics',     tier: 2, inputs: [] },

  // ── Card Production ───────────────────────────────────────────
  { id: 'cardStock',               name: 'Card Stock',                  icon: '🃏',  color: '#d4af37', cat: 'cards',        tier: 1, inputs: [] },
  { id: 'printingInk',             name: 'Printing Ink',                icon: '🃏',  color: '#d4af37', cat: 'cards',        tier: 1, inputs: [] },
  { id: 'inkChemicals',            name: 'Ink Chemicals',               icon: '🃏',  color: '#d4af37', cat: 'cards',        tier: 1, inputs: [] },
  { id: 'holographicFoil',         name: 'Holographic Foil',            icon: '🃏',  color: '#d4af37', cat: 'cards',        tier: 1, inputs: [] },
  { id: 'protectiveCoating',       name: 'Protective Coating',          icon: '🃏',  color: '#d4af37', cat: 'cards',        tier: 1, inputs: [] },
  { id: 'packagingMaterial',       name: 'Packaging Material',          icon: '🃏',  color: '#d4af37', cat: 'cards',        tier: 1, inputs: [] },
  { id: 'printedCards',            name: 'Printed Cards',               icon: '🃏',  color: '#d4af37', cat: 'cards',        tier: 1, inputs: [] },
  { id: 'boosterPacks',            name: 'Booster Packs',               icon: '🃏',  color: '#d4af37', cat: 'cards',        tier: 1, inputs: [] },
  { id: 'starterDecks',            name: 'Starter Decks',               icon: '🃏',  color: '#d4af37', cat: 'cards',        tier: 1, inputs: [] },
  { id: 'cardBoxes',               name: 'Card Boxes',                  icon: '🃏',  color: '#d4af37', cat: 'cards',        tier: 1, inputs: [] },
  { id: 'collectorPacks',          name: 'Collector Packs',             icon: '🃏',  color: '#d4af37', cat: 'cards',        tier: 1, inputs: [] },
  { id: 'tournamentProducts',      name: 'Tournament Products',         icon: '🃏',  color: '#d4af37', cat: 'cards',        tier: 1, inputs: [] },

  // ── Holographics ──────────────────────────────────────────────
  { id: 'holographicComponents',   name: 'Holographic Components',      icon: '✨',   color: '#9ad8ff', cat: 'holographic',  tier: 2, inputs: [] },
  { id: 'holographicProjectors',   name: 'Holographic Projectors',      icon: '✨',   color: '#9ad8ff', cat: 'holographic',  tier: 2, inputs: [] },
  { id: 'opticalComponents',       name: 'Optical Components',          icon: '✨',   color: '#9ad8ff', cat: 'holographic',  tier: 2, inputs: [] },
  { id: 'signalProcessors',        name: 'Signal Processors',           icon: '✨',   color: '#9ad8ff', cat: 'holographic',  tier: 2, inputs: [] },
  { id: 'holographicChips',        name: 'Holographic Chips',           icon: '✨',   color: '#9ad8ff', cat: 'holographic',  tier: 2, inputs: [] },
  { id: 'relayComponents',         name: 'Relay Components',            icon: '✨',   color: '#9ad8ff', cat: 'holographic',  tier: 2, inputs: [] },

  // ── Aerospace ─────────────────────────────────────────────────
  { id: 'aerospaceAluminum',       name: 'Aerospace Aluminum',          icon: '🛰️', color: '#b8c4d8', cat: 'aerospace',    tier: 2, inputs: [] },
  { id: 'satelliteSystems',        name: 'Satellite Systems',           icon: '🛰️', color: '#b8c4d8', cat: 'aerospace',    tier: 2, inputs: [] },

  // ── Anomalous ─────────────────────────────────────────────────
  { id: 'mythicEssence',           name: 'Mythic Essence',              icon: '🟣',  color: '#b06bff', cat: 'anomalous',    tier: 0, existing: true, inputs: [] },
  { id: 'mythicResidue',           name: 'Mythic Residue',              icon: '🟣',  color: '#b06bff', cat: 'anomalous',    tier: 0, inputs: [] },
  { id: 'anomalousMatter',         name: 'Anomalous Matter',            icon: '🟣',  color: '#b06bff', cat: 'anomalous',    tier: 0, inputs: [] },
  { id: 'anomalousEnergy',         name: 'Anomalous Energy',            icon: '🟣',  color: '#b06bff', cat: 'anomalous',    tier: 0, inputs: [] },
  { id: 'realityMatter',           name: 'Reality Matter',              icon: '🟣',  color: '#b06bff', cat: 'anomalous',    tier: 0, inputs: [] },
  { id: 'soulEnergy',              name: 'Soul Energy',                 icon: '🟣',  color: '#b06bff', cat: 'anomalous',    tier: 0, existing: true, inputs: [] },
  { id: 'dimensionalMaterial',     name: 'Dimensional Material',        icon: '🟣',  color: '#b06bff', cat: 'anomalous',    tier: 0, inputs: [] },
  { id: 'arcaneCrystal',           name: 'Arcane Crystal',              icon: '🟣',  color: '#b06bff', cat: 'anomalous',    tier: 0, inputs: [] },
  { id: 'realityFragments',        name: 'Reality Fragments',           icon: '🟣',  color: '#b06bff', cat: 'anomalous',    tier: 0, inputs: [] },

  // ── Containment ───────────────────────────────────────────────
  { id: 'containmentMaterials',    name: 'Containment Materials',       icon: '🛡️', color: '#7fa8c8', cat: 'containment',  tier: 2, inputs: [] },
  { id: 'reinforcedContainmentMaterials', name: 'Reinforced Containment Materials', icon: '🛡️', color: '#7fa8c8', cat: 'containment',  tier: 2, inputs: [] },
  { id: 'realityStabilizationComponents', name: 'Reality Stabilization Components', icon: '🛡️', color: '#7fa8c8', cat: 'containment',  tier: 2, inputs: [] },
  { id: 'researchEquipment',       name: 'Research Equipment',          icon: '🛡️', color: '#7fa8c8', cat: 'containment',  tier: 2, inputs: [] },
  { id: 'secureElectronics',       name: 'Secure Electronics',          icon: '🛡️', color: '#7fa8c8', cat: 'containment',  tier: 2, inputs: [] },
  { id: 'anomalySensors',          name: 'Anomaly Sensors',             icon: '🛡️', color: '#7fa8c8', cat: 'containment',  tier: 2, inputs: [] },
  { id: 'containmentEquipment',    name: 'Containment Equipment',       icon: '🛡️', color: '#7fa8c8', cat: 'containment',  tier: 2, inputs: [] },
  { id: 'specializedMedicalSupplies', name: 'Specialized Medical Supplies', icon: '🛡️', color: '#7fa8c8', cat: 'containment',  tier: 2, inputs: [] },
  { id: 'hazardousMaterialEquipment', name: 'Hazardous Material Equipment', icon: '🛡️', color: '#7fa8c8', cat: 'containment',  tier: 2, inputs: [] },

  // ── Security ──────────────────────────────────────────────────
  { id: 'classifiedTechnology',    name: 'Classified Technology',       icon: '🔒',  color: '#c8a86a', cat: 'security',     tier: 2, inputs: [] },
  { id: 'securityEquipment',       name: 'Security Equipment',          icon: '🔒',  color: '#c8a86a', cat: 'security',     tier: 2, inputs: [] },
  { id: 'protectiveEquipment',     name: 'Protective Equipment',        icon: '🔒',  color: '#c8a86a', cat: 'security',     tier: 2, inputs: [] },
  { id: 'surveillanceEquipment',   name: 'Surveillance Equipment',      icon: '🔒',  color: '#c8a86a', cat: 'security',     tier: 2, inputs: [] },

  // ── Civic & Emergency ─────────────────────────────────────────
  { id: 'officeSupplies',          name: 'Office Supplies',             icon: '🧰',  color: '#d4c8a8', cat: 'civic',        tier: 2, inputs: [] },
  { id: 'emergencyFood',           name: 'Emergency Food',              icon: '🧰',  color: '#d4c8a8', cat: 'civic',        tier: 2, inputs: [] },
  { id: 'bottledWater',            name: 'Bottled Water',               icon: '🧰',  color: '#d4c8a8', cat: 'civic',        tier: 2, inputs: [] },
  { id: 'emergencySupplies',       name: 'Emergency Supplies',          icon: '🧰',  color: '#d4c8a8', cat: 'civic',        tier: 2, inputs: [] },
  { id: 'emergencyEquipment',      name: 'Emergency Equipment',         icon: '🧰',  color: '#d4c8a8', cat: 'civic',        tier: 2, inputs: [] },
];

/* tier 0 = raw (a building extracts it), 1 = intermediate (refined from raws),
   2 = finished (what a city actually consumes or sells). */
export const CHAIN_BY_ID = RESOURCE_CHAIN.reduce((m, r) => { m[r.id] = r; return m; }, {});
export const chainById   = (id) => CHAIN_BY_ID[id] || null;
export const chainByCat  = (cat) => RESOURCE_CHAIN.filter((r) => r.cat === cat);
export const chainByTier = (tier) => RESOURCE_CHAIN.filter((r) => r.tier === tier);
/* Ids this catalogue introduces — i.e. everything except the aliases to ids
   index.html already defines. This is the promotion queue. */
export const NEW_IDS = RESOURCE_CHAIN.filter((r) => !r.existing).map((r) => r.id);

/* 🔌 THE BRIDGE. Profile/App/RESOURCES are top-level `const` in index.html —
   lexical bindings, NOT on window — so a module cannot read them and index.html
   cannot import this. window is the seam that works in both directions, and it
   is the documented pattern for /src modules in this codebase. */
try {
  if (typeof window !== 'undefined') {
    window.MythicResourceChain = {
      CATEGORIES: RESOURCE_CATEGORIES,
      ALL: RESOURCE_CHAIN,
      byId: chainById,
      byCat: chainByCat,
      byTier: chainByTier,
      NEW_IDS,
    };
  }
} catch (e) {}
