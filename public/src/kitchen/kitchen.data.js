/* ════════════════════════════════════════════════════════════════════════════
   🍔 KITCHEN.DATA.JS — THE CATALOGUE. Every id and every number in the feature.
   ----------------------------------------------------------------------------
   PURE DATA + TINY PURE HELPERS. Zero imports. Zero side effects. No DOM, no
   timers, no bridge, no Date.now(). This file is imported on EVERY page load of
   a 223k-line app, so it must not throw and must not do work at import time
   beyond building a few lookup maps.

   🔴 WHY THIS FILE EXISTS AT ALL — read CLAUDE.md: "All operation pricing goes
   through _opEcon(). Never hardcode economy numbers." Operations have _opEcon()
   (index.html ~80021) which merges an admin override map over OPS_ECON. The
   Kitchen has no such path yet, so `ECON` below IS the kitchen's _opEcon table —
   one object, one place, one thing to retune. If you write an economy number in
   kitchen.state.js, drivethru.js, convoy.js, kitchen.render.js or index.js, you
   have written a bug, not a constant.
   ⚠ WHOEVER ADDS a `_kitchenEcon()` override path later: absorb ECON wholesale
     (Object.assign({}, ECON, overrides) with the nested maps merged the way
     _opEcon merges `yields`/`inputs`), and delete this paragraph. Do NOT copy
     numbers out of here into a second table — two tables is how a live economy
     ends up with two different prices for the same burger.

   ⚠ TREAT EVERYTHING EXPORTED HERE AS READ-ONLY. It is deliberately NOT frozen:
     six modules are being written in parallel and a stray `recipe._domNode = x`
     in a renderer would throw a TypeError in strict mode and take the whole
     feature down, which is a far worse failure than a mutated catalogue. Read
     it, copy out of it, never write into it.

   ── ON THE CONTRACT'S FIXED VOCABULARY ────────────────────────────────────
   CONTRACT.md §1 fixes 15 ingredient ids, 5 station ids and 9 recipe ids and
   says "do not rename them". Every one of those ids is present below, spelled
   exactly as the contract spells it, meaning exactly what the contract means.
   The build brief then asks for "at minimum 3 pizzas, 4 burgers, 3 hot dogs,
   3 sides, 3 drinks" — 16+ recipes, which 9 ids cannot express. So the fixed
   list is treated as a FLOOR, not a ceiling: nothing is renamed, nothing is
   removed, and the extra menu is built from NEW ids that nobody else's file
   hardcodes. Renaming would break five other files. Adding cannot, because
   every consumer is data-driven (render iterates INGREDIENTS/RECIPES, state
   reads recipe.needs, convoy reads recipe.ship). If you are writing one of
   those files and you find yourself typing a literal recipe id, stop — iterate.

   ── SOURCING: WHERE FOOD ACTUALLY COMES FROM ──────────────────────────────
   The 14 live resource ids (index.html:39272) are the ONLY spendable input:
     food ammo water medicine energyDrink supplies metal fuel corruptedEssence
     memoryShards dna wood stone cloth
   They are earned in the city builder (hydroponics → food, wellhead → water,
   genevault → dna, bottling → energyDrink), by businesses (OPS_ECON agri /
   fishing → food) and by battle salvage. SUPPLY_RECIPES turns them into pantry
   stock. Nothing else does.

   🔴 PANTRY INGREDIENTS ARE NOT PROMOTED INTO `RESOURCES`, and that decision is
   load-bearing. /src/resources/chain.js is a 258-entry CATALOGUE, not a ledger,
   and index.html's r12 comment on wood/stone/cloth records exactly what happens
   when an id becomes holdable without a producer, a cost renderer and a market
   entry: "a resource a player can hold and be capped by but cannot sell, spend
   or make is worse than a missing one." Twenty-five more of those is twenty-five
   more of that fault. Pantry stock lives in Kitchen.pantry: not tradeable, not
   lootable, not stash-capped, and it never touches Profile.salvage.
   ════════════════════════════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════════════════════
   📦 SUPPLY_RECIPES — live ledger → pantry. THE RESTOCK COUNTER.
   ----------------------------------------------------------------------------
   ⚠ THIS TABLE IS DECLARED BEFORE INGREDIENTS ON PURPOSE. `INGREDIENTS[].batch`
     is DERIVED from `out.qty` down here rather than typed twice. Two hand-kept
     copies of the same number is precisely the divergence this file exists to
     prevent: the restock button would charge for 10 buns and the bin would show
     8, and the bug would live for months because both numbers "look right".

   Shape: { id, out:{ing, qty}, cost:{ <liveResId | 'cinder'> : n }, ... }

   🔴 A `cost` dict may contain ONLY the 14 live ids plus the key 'cinder'.
      buySupply() must REJECT a recipe carrying any other key rather than
      silently skipping that leg — a skipped leg is a free ingredient, and a
      free ingredient is an infinite economy. (CONTRACT §8.1.)

   💸 CINDER IS THE SMALL HALF OF THE PRICE, DELIBERATELY. Cinder is abundant
      (an op nets thousands per hour, OPS_ECON:79733); food/water/dna are the
      scarce things a city actually has to produce. So the cinder leg is sized
      to leave every dish a 40–70% gross margin before tips — enough that a
      careless restock hurts — while the REAL gate on how many burgers exist in
      the world is `food` and `dna`. Flip that ratio and the kitchen stops being
      connected to the city builder at all, which is the entire point.
      ⚠ THESE NUMBERS WERE SET BY A MARGIN TABLE, NOT BY FEEL, and the first
        pass was wrong in a way that reading could not catch: at the original
        prices a Fountain Soda cost 31 Cinder of syrup and ice and sold for 25.
        Three drinks and two sides were sold at a LOSS — invisible in review,
        fatal in play, since drinks are the attach-sale the ticket bonus is
        built around. If you retune any cinder leg, re-run the margin table
        (price vs Σ needs × supply.cost.cinder ÷ out.qty) across ALL of RECIPES
        before you commit. Never spot-tune one line.

   🧬 WHY MEAT COSTS `dna`: the Gene Vault (city/production.data.js:229) is the
      only industrial DNA source and it eats food + medicine. Vat-grown patties
      is both the flavour and the sink that makes a Gene Vault worth building.
   ════════════════════════════════════════════════════════════════════════════ */
export const SUPPLY_RECIPES = [
  // ── DRY STORE ─────────────────────────────────────────────────────────────
  { id:'sup_dough',   out:{ ing:'dough',   qty:10 }, cost:{ food:6,  water:2,          cinder:60 }, minLevel:1,  blurb:'Flour, water, a tired proofing box.' },
  { id:'sup_potato',  out:{ ing:'potato',  qty:12 }, cost:{ food:5,                    cinder:40  }, minLevel:1,  blurb:'Hydroponic spuds. Gritty, cheap, endless.' },
  { id:'sup_oil',     out:{ ing:'oil',     qty:10 }, cost:{ food:3,  fuel:2,           cinder:50  }, minLevel:2,  blurb:'Fry oil. Cut with refinery bottoms. Do not ask.' },
  { id:'sup_syrup',   out:{ ing:'syrup',   qty:10 }, cost:{ food:6,  energyDrink:2, water:2, cinder:40 }, minLevel:3, blurb:'Bottling Line concentrate. Legally a beverage.' },
  { id:'sup_coffee',  out:{ ing:'coffee',  qty:10 }, cost:{ food:5,  water:2,          cinder:80 }, minLevel:14, blurb:'Real beans. The last crate in the wasteland.' },

  // ── BREAD RACK ────────────────────────────────────────────────────────────
  { id:'sup_bun',     out:{ ing:'bun',     qty:10 }, cost:{ food:5,  supplies:1,       cinder:50  }, minLevel:4,  blurb:'Seeded, squashable, sold by the sleeve.' },
  { id:'sup_roll',    out:{ ing:'roll',    qty:10 }, cost:{ food:5,  supplies:1,       cinder:45  }, minLevel:1,  blurb:'Split-top dog rolls. The starter loaf.' },

  // ── CHILLER: PROTEIN. The expensive half of every menu. ───────────────────
  { id:'sup_patty',   out:{ ing:'patty',   qty:8  }, cost:{ food:8,  dna:2,            cinder:130 }, minLevel:4,  blurb:'Vat-grown beef, pressed at 4oz.' },
  { id:'sup_chicken', out:{ ing:'chicken', qty:8  }, cost:{ food:7,  dna:2,            cinder:120 }, minLevel:8,  blurb:'Cultured fillet. Breaded in-house.' },
  { id:'sup_sausage', out:{ ing:'sausage', qty:10 }, cost:{ food:6,  dna:1,            cinder:80 }, minLevel:1,  blurb:'Links. The first thing this kitchen ever sold.' },
  { id:'sup_bacon',   out:{ ing:'bacon',   qty:8  }, cost:{ food:6,  dna:2,            cinder:120 }, minLevel:11, blurb:'Streaky, salted, worth the markup.' },
  { id:'sup_cheese',  out:{ ing:'cheese',  qty:10 }, cost:{ food:4,  water:3, dna:1,   cinder:100 }, minLevel:5,  blurb:'Cultured curd. Melts if you are quick.' },
  { id:'sup_milk',    out:{ ing:'milk',    qty:12 }, cost:{ water:6, food:2,  dna:1,   cinder:48 }, minLevel:10, blurb:'Tank milk. Cold chain holds, mostly.' },
  { id:'sup_mayo',    out:{ ing:'mayo',    qty:12 }, cost:{ food:3,  dna:1,            cinder:48  }, minLevel:9,  blurb:'Emulsion. Keep it under the counter light.' },

  // ── FRESH RACK ────────────────────────────────────────────────────────────
  { id:'sup_lettuce', out:{ ing:'lettuce', qty:10 }, cost:{ food:3,  water:2,          cinder:45  }, minLevel:4,  blurb:'Racked greens, straight off the Hydroponics Bay.' },
  { id:'sup_tomato',  out:{ ing:'tomato',  qty:10 }, cost:{ food:4,                    cinder:50  }, minLevel:4,  blurb:'Sliced thin so one crate goes further.' },
  { id:'sup_onion',   out:{ ing:'onion',   qty:12 }, cost:{ food:3,                    cinder:36  }, minLevel:1,  blurb:'Red rings. Cheapest topping on the board.' },
  { id:'sup_slaw',    out:{ ing:'slaw',    qty:10 }, cost:{ food:3,  water:1,          cinder:45  }, minLevel:5,  blurb:'Shredded, soured, weirdly popular.' },
  /* 🍄 Mushrooms cost corruptedEssence and that is a joke with a purpose: the
     Containment Sump (production.data.js:203) is the only source, so the veggie
     pizza quietly rewards a player who built the ugliest building in their city.
     One essence per ten caps — a garnish tax, not a wall. */
  { id:'sup_mushroom',out:{ ing:'mushroom',qty:10 }, cost:{ food:4,  corruptedEssence:1, cinder:80 }, minLevel:12, blurb:'Sump-grown. Glows faintly. Sells anyway.' },

  // ── CONDIMENT LINE ────────────────────────────────────────────────────────
  { id:'sup_sauce',   out:{ ing:'sauce',   qty:12 }, cost:{ food:5,  water:1,          cinder:48  }, minLevel:1,  blurb:'Red sauce. Ladles a pizza, squeezes a burger.' },
  { id:'sup_mustard', out:{ ing:'mustard', qty:12 }, cost:{ food:2,  supplies:1,       cinder:30  }, minLevel:1,  blurb:'Yellow. Sharp. Non-negotiable on a dog.' },
  { id:'sup_pickle',  out:{ ing:'pickle',  qty:12 }, cost:{ food:3,  water:2,          cinder:48  }, minLevel:7,  blurb:'Spears, brined in the back for a week.' },
  { id:'sup_pepperoni',out:{ing:'pepperoni',qty:10}, cost:{ food:5,  dna:2,            cinder:100 }, minLevel:10, blurb:'Cured discs. The reason pizza sells.' },
  { id:'sup_chili',   out:{ ing:'chili',   qty:8  }, cost:{ food:6,  water:2,          cinder:88 }, minLevel:5,  blurb:'Yesterday’s pot, better today.' },

  // ── FREEZER ───────────────────────────────────────────────────────────────
  // Ice costs water and NOTHING ELSE — the only zero-food line in the table.
  // See the CONVOY GUARD note in ECON: it is why the cheapest dish on the menu
  // (soda) still had to be given two units of a food-costed syrup.
  { id:'sup_ice',     out:{ ing:'ice',     qty:16 }, cost:{ water:5,                   cinder:16  }, minLevel:3,  blurb:'Crushed. Melts on the pass in ninety seconds.' },
];

/* ════════════════════════════════════════════════════════════════════════════
   🧊 SHELVES — how the bins are grouped on screen.
   ----------------------------------------------------------------------------
   REF-B's kitchen reads as a kitchen because the ingredient bins sit in a ROW
   in a sane order (pickles, cheese, tomato, lettuce, onion) rather than as an
   alphabetical list of nouns. Shelf is that grouping, and it is data because the
   renderer must not be the place that decides mozzarella is a chilled item.
   ════════════════════════════════════════════════════════════════════════════ */
export const SHELVES = [
  { id:'dry',   name:'Dry Store',      icon:'🫙', color:'#d9b779', order:1 },
  { id:'bake',  name:'Bread Rack',     icon:'🥖', color:'#e0a86a', order:2 },
  { id:'chill', name:'Chiller',        icon:'🧊', color:'#7fd6ff', order:3 },
  { id:'fresh', name:'Fresh Rack',     icon:'🥬', color:'#9ad17a', order:4 },
  { id:'jar',   name:'Condiment Line', icon:'🍯', color:'#ff8aa0', order:5 },
  { id:'cold',  name:'Freezer',        icon:'❄️', color:'#bfe8ff', order:6 },
];

/* ════════════════════════════════════════════════════════════════════════════
   🥫 INGREDIENTS — the pantry vocabulary. 25 ids.
   ----------------------------------------------------------------------------
   The first 15 are CONTRACT-FIXED (§1) and are spelled here exactly as written
   there: dough sauce cheese tomato pepperoni patty chicken bun lettuce onion
   pickle sausage potato syrup milk. The remaining 10 exist because the brief
   asks for a menu the fixed 15 cannot build (bacon burger, chili dog, slaw dog,
   veggie pizza, onion rings, iced coffee, three squeeze bottles like REF-B).

   Fields:
     unit   — what ONE of it is, for the bin label ("3 spears", "1 ball").
              Flavour, but it is what stops the bins reading as a spreadsheet.
     batch  — DERIVED from SUPPLY_RECIPES. Never typed here. See above.
     shelf  — SHELVES id; the bin group.
     prep   — the station this ingredient is normally handled at, or null for
              anything that goes straight on the build. It is a LAYOUT HINT for
              the renderer (put the patty bin next to the griddle), not a rule
              the sim enforces — the sim only ever checks recipe.needs.
     supply — the SUPPLY_RECIPES id that stocks it. A POINTER, never a copy of
              the cost: one price, one place.
   ════════════════════════════════════════════════════════════════════════════ */
const _INGREDIENTS_RAW = [
  // ── the CONTRACT-FIXED fifteen ────────────────────────────────────────────
  { id:'dough',     name:'Dough',       icon:'🫓', color:'#e8cf9a', unit:'ball',    shelf:'dry',   prep:'assembly', supply:'sup_dough' },
  { id:'sauce',     name:'Red Sauce',   icon:'🥫', color:'#d9483b', unit:'ladle',   shelf:'jar',   prep:'assembly', supply:'sup_sauce' },
  { id:'cheese',    name:'Cheese',      icon:'🧀', color:'#f2c14e', unit:'handful', shelf:'chill', prep:'assembly', supply:'sup_cheese' },
  { id:'tomato',    name:'Tomato',      icon:'🍅', color:'#e2574c', unit:'slice',   shelf:'fresh', prep:'assembly', supply:'sup_tomato' },
  { id:'pepperoni', name:'Pepperoni',   icon:'🍕', color:'#b8433a', unit:'disc',    shelf:'jar',   prep:'assembly', supply:'sup_pepperoni' },
  { id:'patty',     name:'Beef Patty',  icon:'🥩', color:'#a1543f', unit:'patty',   shelf:'chill', prep:'griddle',  supply:'sup_patty' },
  { id:'chicken',   name:'Chicken',     icon:'🍗', color:'#e8b06a', unit:'fillet',  shelf:'chill', prep:'griddle',  supply:'sup_chicken' },
  { id:'bun',       name:'Burger Bun',  icon:'🍞', color:'#d8a35c', unit:'bun',     shelf:'bake',  prep:'griddle',  supply:'sup_bun' },
  { id:'lettuce',   name:'Lettuce',     icon:'🥬', color:'#8fc96a', unit:'leaf',    shelf:'fresh', prep:'assembly', supply:'sup_lettuce' },
  { id:'onion',     name:'Red Onion',   icon:'🧅', color:'#c98cb0', unit:'ring',    shelf:'fresh', prep:'assembly', supply:'sup_onion' },
  { id:'pickle',    name:'Pickle',      icon:'🥒', color:'#7fa84a', unit:'spear',   shelf:'jar',   prep:'assembly', supply:'sup_pickle' },
  { id:'sausage',   name:'Frank',       icon:'🌭', color:'#c2603f', unit:'link',    shelf:'chill', prep:'griddle',  supply:'sup_sausage' },
  { id:'potato',    name:'Potato',      icon:'🥔', color:'#c9a86a', unit:'spud',    shelf:'dry',   prep:'fryer',    supply:'sup_potato' },
  { id:'syrup',     name:'Soda Syrup',  icon:'🧴', color:'#8a5a3c', unit:'shot',    shelf:'dry',   prep:'drinks',   supply:'sup_syrup' },
  { id:'milk',      name:'Milk',        icon:'🥛', color:'#eef2f6', unit:'cup',     shelf:'chill', prep:'drinks',   supply:'sup_milk' },
  // ── added for the full menu ───────────────────────────────────────────────
  { id:'roll',      name:'Dog Roll',    icon:'🥖', color:'#dcae6d', unit:'roll',    shelf:'bake',  prep:'griddle',  supply:'sup_roll' },
  { id:'bacon',     name:'Bacon',       icon:'🥓', color:'#c9564a', unit:'rasher',  shelf:'chill', prep:'griddle',  supply:'sup_bacon' },
  { id:'chili',     name:'Chili',       icon:'🌶️', color:'#a33c2e', unit:'scoop',   shelf:'jar',   prep:'assembly', supply:'sup_chili' },
  { id:'slaw',      name:'Slaw',        icon:'🥗', color:'#b6d47a', unit:'scoop',   shelf:'fresh', prep:'assembly', supply:'sup_slaw' },
  { id:'mushroom',  name:'Mushroom',    icon:'🍄', color:'#b98ad1', unit:'cap',     shelf:'fresh', prep:'assembly', supply:'sup_mushroom' },
  { id:'mustard',   name:'Mustard',     icon:'🟨', color:'#e8c832', unit:'pump',    shelf:'jar',   prep:'assembly', supply:'sup_mustard' },
  { id:'mayo',      name:'Mayo',        icon:'⚪', color:'#f2ecdc', unit:'pump',    shelf:'chill', prep:'assembly', supply:'sup_mayo' },
  { id:'oil',       name:'Fry Oil',     icon:'🛢️', color:'#cfa93f', unit:'dip',     shelf:'dry',   prep:'fryer',    supply:'sup_oil' },
  { id:'ice',       name:'Ice',         icon:'🧊', color:'#bfe8ff', unit:'cube',    shelf:'cold',  prep:'drinks',   supply:'sup_ice' },
  { id:'coffee',    name:'Coffee',      icon:'☕', color:'#6b4a35', unit:'shot',    shelf:'dry',   prep:'drinks',   supply:'sup_coffee' },
];

/* ════════════════════════════════════════════════════════════════════════════
   🔥 STATIONS — the five surfaces. Contract-fixed ids (§1).
   ----------------------------------------------------------------------------
   kind: 'bake' | 'heat' | 'fry' | 'build' | 'instant' — the renderer draws a
   different surface per kind (oven mouth, flat-top, basket, board, fountain).

   `slots` is the BASE capacity. 🔴 DO NOT read station.slots directly when you
   build Kitchen.stations — call slotsFor(stationId, ownedUpgrades). The whole
   point of the upgrade ladder is that a griddle grows from 2 lanes to 4, and a
   sim that sized its slot array off the base constant would buy the upgrade,
   charge the Cinder and change nothing. (That exact shape of bug — money taken,
   effect silently dropped — is why every bridge mutator returns a boolean.)

   `speedMul` multiplies cookMs (lower = faster). Base 1; upgrades push it down.
   `upgrades` lists which UPGRADES ids point at this station, so the render can
   show "▲ 2 upgrades available" on the surface itself instead of burying them.
   ════════════════════════════════════════════════════════════════════════════ */
export const STATIONS = [
  { id:'griddle',  name:'Flat-Top',   icon:'🍳', kind:'heat',    slots:2, speedMul:1, order:1,
    desc:'Patties, franks, fillets, toasted buns. Everything that sizzles.',
    upgrades:['up_griddle2','up_griddle3','up_griddle_fast'] },
  { id:'fryer',    name:'Fryer',      icon:'🍟', kind:'fry',     slots:2, speedMul:1, order:2,
    desc:'Two baskets and a timer you will learn to hate.',
    upgrades:['up_fryer2','up_fryer_fast'] },
  { id:'oven',     name:'Deck Oven',  icon:'🔥', kind:'bake',    slots:2, speedMul:1, order:3,
    desc:'Stone deck. Slow, unforgiving, pays the best.',
    upgrades:['up_oven2','up_oven_fast'] },
  { id:'assembly', name:'Prep Board', icon:'🔪', kind:'build',   slots:2, speedMul:1, order:4,
    desc:'Where cold builds happen and where everything gets plated.',
    upgrades:['up_board2'] },
  { id:'drinks',   name:'Fountain',   icon:'🥤', kind:'instant', slots:2, speedMul:1, order:5,
    desc:'Syrup, ice, done. The only station you can run while panicking.',
    upgrades:['up_fountain2'] },
];

/* ════════════════════════════════════════════════════════════════════════════
   🍽 RECIPES — 19 dishes across 5 menu categories.
   ----------------------------------------------------------------------------
   🔴 `needs` IS DERIVED FROM `steps`. It is not typed twice. steps is the
      ordered build (what the renderer draws, layer by layer, and what the
      build-order bonus scores); needs is the flat pantry cost the sim spends.
      Hand-maintaining both is a guaranteed divergence — the classic version of
      this bug is a recipe that draws three cheese layers and charges for two.

   steps[] = { ing, qty, verb, layer }
     verb   — the imperative the UI shows while that step is highlighted
              ('stretch', 'ladle', 'scatter', 'sear', 'toast', 'dip', 'pour').
     layer  — draw order hint for the mid-build sprite: 'base' | 'spread' |
              'fill' | 'top' | 'lid' | 'none'. 'none' = consumed but invisible
              (fry oil), which is why steps and needs are not the same list.

   TIMING — the three numbers that make cooking a skill:
     cookMs        raw → done.
     doneWindowMs  how long it stays sellable after doneAt.
     burnMs        ⚠ EXACTLY EQUAL TO doneWindowMs, ON PURPOSE, AND NEVER
                   INDEPENDENTLY TUNED. CONTRACT §1 lists a `burnMs` field and
                   CONTRACT §8.2 defines `burnAt = doneAt + doneWindowMs`. Two
                   names for one interval is an ambiguity six parallel builders
                   cannot resolve by reading, so it is resolved by ARITHMETIC:
                   whether kitchen.state.js writes `doneAt + doneWindowMs` or
                   `doneAt + burnMs`, it gets the same instant. If you ever want
                   them to differ, delete one of them from the contract first.
     Perfect window = the first ECON.PERFECT_FRACTION (⅓) of doneWindowMs.

   Do NOT widen doneWindowMs to be kind. The window is the entire skill; a
   generous window turns a cooking game into a queue of buttons that eventually
   go green. Drinks are the deliberate exception — their "burn" is going flat,
   which takes 40s, because nobody should lose a shift to a warm soda.

   `ship` — may this dish ride a convoy? See the CONVOY GUARD in ECON. Fries
   arrive soggy and a milkshake arrives as milk; refusing them is flavour AND
   the outer wall of the food-printer guard.

   `pop` — popularity weight multiplier on ECON.POP_SERVE. A pizza served well
   is worth more word-of-mouth than a soda.
   ════════════════════════════════════════════════════════════════════════════ */
export const MENU_CATS = [
  { id:'dogs',   name:'Hot Dogs', icon:'🌭', order:1 },
  { id:'burgers',name:'Burgers',  icon:'🍔', order:2 },
  { id:'pizza',  name:'Pizza',    icon:'🍕', order:3 },
  { id:'sides',  name:'Sides',    icon:'🍟', order:4 },
  { id:'drinks', name:'Drinks',   icon:'🥤', order:5 },
];

const _RECIPES_RAW = [
  /* ── 🌭 HOT DOGS ─────────────────────────────────────────────────────────
     hotDog is the DAY ONE DISH and the only thing on the board at level 1.
     Three ingredients, an 8-second cook and a forgiving 9-second window: it is
     the tutorial, and it is meant to be beatable with one hand while you read
     the drive-thru. Everything else on this menu is a variation on learning
     that rhythm and then not having enough hands for it. */
  { id:'hotDog', name:'Hot Dog', icon:'🌭', cat:'dogs', tier:1, minLevel:1, station:'griddle',
    cookMs:8000, doneWindowMs:9000, basePrice:40, xp:8, pop:1.0, ship:true,
    blurb:'A frank, a roll, a stripe of mustard. The whole business started here.',
    steps:[ { ing:'roll',    qty:1, verb:'split',  layer:'base' },
            { ing:'sausage', qty:1, verb:'sear',   layer:'fill' },
            { ing:'mustard', qty:1, verb:'stripe', layer:'top'  } ] },

  { id:'chiliDog', name:'Chili Dog', icon:'🌭', cat:'dogs', tier:2, minLevel:5, station:'griddle',
    cookMs:11000, doneWindowMs:8000, basePrice:85, xp:14, pop:1.1, ship:true,
    blurb:'Loaded, messy, and the reason the napkin dispenser is empty.',
    steps:[ { ing:'roll',    qty:1, verb:'split',   layer:'base' },
            { ing:'sausage', qty:1, verb:'sear',    layer:'fill' },
            { ing:'chili',   qty:2, verb:'spoon',   layer:'top'  },
            { ing:'cheese',  qty:1, verb:'scatter', layer:'top'  },
            { ing:'onion',   qty:1, verb:'scatter', layer:'top'  } ] },

  { id:'slawDog', name:'Slaw Dog', icon:'🌭', cat:'dogs', tier:2, minLevel:6, station:'griddle',
    cookMs:10000, doneWindowMs:8000, basePrice:70, xp:12, pop:1.05, ship:true,
    blurb:'Sour, cold, on top of hot. It should not work. It sells out.',
    steps:[ { ing:'roll',    qty:1, verb:'split',  layer:'base' },
            { ing:'sausage', qty:1, verb:'sear',   layer:'fill' },
            { ing:'slaw',    qty:2, verb:'heap',   layer:'top'  },
            { ing:'mustard', qty:1, verb:'stripe', layer:'top'  } ] },

  /* ── 🍔 BURGERS ─────────────────────────────────────────────────────────── */
  { id:'burgerClassic', name:'Classic Burger', icon:'🍔', cat:'burgers', tier:1, minLevel:4, station:'griddle',
    cookMs:12000, doneWindowMs:8000, basePrice:70, xp:12, pop:1.1, ship:true,
    blurb:'One patty, done properly. The dish the whole menu is measured against.',
    steps:[ { ing:'bun',     qty:1, verb:'toast',   layer:'base' },
            { ing:'patty',   qty:1, verb:'sear',    layer:'fill' },
            { ing:'sauce',   qty:1, verb:'squeeze', layer:'spread' },
            { ing:'lettuce', qty:1, verb:'lay',     layer:'top'  },
            { ing:'tomato',  qty:1, verb:'lay',     layer:'lid'  } ] },

  { id:'burgerDouble', name:'Double Stack', icon:'🍔', cat:'burgers', tier:2, minLevel:7, station:'griddle',
    cookMs:16000, doneWindowMs:8000, basePrice:118, xp:18, pop:1.2, ship:true,
    blurb:'Two patties. Twice the sear time, twice the chance you forget it.',
    steps:[ { ing:'bun',     qty:1, verb:'toast',   layer:'base' },
            { ing:'patty',   qty:2, verb:'sear',    layer:'fill' },
            { ing:'cheese',  qty:2, verb:'melt',    layer:'fill' },
            { ing:'pickle',  qty:2, verb:'lay',     layer:'top'  },
            { ing:'onion',   qty:1, verb:'scatter', layer:'top'  },
            { ing:'mustard', qty:1, verb:'stripe',  layer:'lid'  } ] },

  { id:'chickenSandwich', name:'Chicken Sandwich', icon:'🍗', cat:'burgers', tier:2, minLevel:9, station:'griddle',
    cookMs:14000, doneWindowMs:8000, basePrice:100, xp:17, pop:1.15, ship:true,
    blurb:'Cultured fillet, pressed flat. Undercook it and the customer knows.',
    steps:[ { ing:'bun',     qty:1, verb:'toast',   layer:'base' },
            { ing:'chicken', qty:1, verb:'press',   layer:'fill' },
            { ing:'mayo',    qty:1, verb:'squeeze', layer:'spread' },
            { ing:'lettuce', qty:1, verb:'lay',     layer:'top'  },
            { ing:'pickle',  qty:2, verb:'lay',     layer:'lid'  } ] },

  { id:'burgerBacon', name:'Bacon Melt', icon:'🥓', cat:'burgers', tier:3, minLevel:11, station:'griddle',
    cookMs:15000, doneWindowMs:7500, basePrice:138, xp:22, pop:1.3, ship:true,
    blurb:'The house special. The bacon goes on the griddle, not on the board.',
    steps:[ { ing:'bun',     qty:1, verb:'toast',   layer:'base' },
            { ing:'patty',   qty:1, verb:'sear',    layer:'fill' },
            { ing:'bacon',   qty:2, verb:'crisp',   layer:'fill' },
            { ing:'cheese',  qty:1, verb:'melt',    layer:'fill' },
            { ing:'mayo',    qty:1, verb:'squeeze', layer:'spread' },
            { ing:'onion',   qty:1, verb:'scatter', layer:'lid'  } ] },

  /* ── 🍕 PIZZA — the long-cook, high-margin tier. ──────────────────────────
     24–28 second bakes against a 12-second window. A pizza in the oven is a
     COMMITMENT: you cannot babysit it and run the drive-thru, which is exactly
     the tension the oven exists to create. Unlocks late (level 8) because a
     player who has not internalised the done-window will simply burn money. */
  { id:'pizzaMargherita', name:'Margherita', icon:'🍕', cat:'pizza', tier:2, minLevel:8, station:'oven',
    cookMs:24000, doneWindowMs:12000, basePrice:125, xp:22, pop:1.25, ship:true,
    blurb:'Sauce, cheese, tomato. Nowhere to hide a mistake.',
    steps:[ { ing:'dough',  qty:1, verb:'stretch', layer:'base' },
            { ing:'sauce',  qty:2, verb:'ladle',   layer:'spread' },
            { ing:'cheese', qty:2, verb:'scatter', layer:'fill' },
            { ing:'tomato', qty:1, verb:'lay',     layer:'top'  } ] },

  { id:'pizzaPepperoni', name:'Pepperoni', icon:'🍕', cat:'pizza', tier:2, minLevel:10, station:'oven',
    cookMs:25000, doneWindowMs:12000, basePrice:155, xp:26, pop:1.3, ship:true,
    blurb:'The one everybody orders. Discs to the edge or it goes back.',
    steps:[ { ing:'dough',     qty:1, verb:'stretch', layer:'base' },
            { ing:'sauce',     qty:2, verb:'ladle',   layer:'spread' },
            { ing:'cheese',    qty:2, verb:'scatter', layer:'fill' },
            { ing:'pepperoni', qty:3, verb:'lay',     layer:'top'  } ] },

  { id:'pizzaVeggie', name:'Garden Pie', icon:'🍕', cat:'pizza', tier:3, minLevel:12, station:'oven',
    cookMs:26000, doneWindowMs:12000, basePrice:168, xp:30, pop:1.3, ship:true,
    blurb:'Sump mushrooms and hydroponic everything. Your city grew all of it.',
    steps:[ { ing:'dough',    qty:1, verb:'stretch', layer:'base' },
            { ing:'sauce',    qty:2, verb:'ladle',   layer:'spread' },
            { ing:'cheese',   qty:1, verb:'scatter', layer:'fill' },
            { ing:'mushroom', qty:2, verb:'lay',     layer:'top'  },
            { ing:'onion',    qty:1, verb:'scatter', layer:'top'  },
            { ing:'tomato',   qty:1, verb:'lay',     layer:'top'  } ] },

  { id:'pizzaSupreme', name:'Supreme', icon:'🍕', cat:'pizza', tier:4, minLevel:16, station:'oven',
    cookMs:28000, doneWindowMs:11000, basePrice:220, xp:38, pop:1.4, ship:true,
    blurb:'Everything on the rack. The most expensive minute in the kitchen.',
    steps:[ { ing:'dough',     qty:1, verb:'stretch', layer:'base' },
            { ing:'sauce',     qty:2, verb:'ladle',   layer:'spread' },
            { ing:'cheese',    qty:2, verb:'scatter', layer:'fill' },
            { ing:'pepperoni', qty:2, verb:'lay',     layer:'top'  },
            { ing:'sausage',   qty:1, verb:'crumble', layer:'top'  },
            { ing:'mushroom',  qty:1, verb:'lay',     layer:'top'  },
            { ing:'onion',     qty:1, verb:'scatter', layer:'top'  } ] },

  /* ── 🍟 SIDES ────────────────────────────────────────────────────────────
     ⚠ ship:false on every fried side. Not a balance fudge — a convoy takes
     thirty minutes MINIMUM (CONVOY_TIERS) and soggy fries are a worse gift than
     no fries. It also happens to be the outer wall of the food-printer guard. */
  { id:'fries', name:'Fries', icon:'🍟', cat:'sides', tier:1, minLevel:2, station:'fryer',
    cookMs:12000, doneWindowMs:7000, basePrice:32, xp:6, pop:0.9, ship:false,
    blurb:'Salted at the pass, never before. The attach-rate king.',
    steps:[ { ing:'potato', qty:3, verb:'cut',  layer:'base' },
            { ing:'oil',    qty:1, verb:'dip',  layer:'none' } ] },

  { id:'sideSalad', name:'Side Salad', icon:'🥗', cat:'sides', tier:1, minLevel:5, station:'assembly',
    cookMs:5000, doneWindowMs:30000, basePrice:38, xp:6, pop:0.9, ship:false,
    blurb:'A cold build. The only thing on this menu that cannot burn.',
    steps:[ { ing:'lettuce', qty:2, verb:'tear',    layer:'base' },
            { ing:'tomato',  qty:1, verb:'lay',     layer:'fill' },
            { ing:'onion',   qty:1, verb:'scatter', layer:'top'  },
            { ing:'slaw',    qty:1, verb:'spoon',   layer:'top'  } ] },

  { id:'onionRings', name:'Onion Rings', icon:'🧅', cat:'sides', tier:2, minLevel:6, station:'fryer',
    cookMs:14000, doneWindowMs:7000, basePrice:48, xp:9, pop:1.0, ship:false,
    blurb:'Battered in the same dough as the pizza. Waste nothing.',
    steps:[ { ing:'onion', qty:3, verb:'ring',  layer:'base' },
            { ing:'dough', qty:1, verb:'batter',layer:'spread' },
            { ing:'oil',   qty:1, verb:'dip',   layer:'none' } ] },

  { id:'nuggets', name:'Nuggets', icon:'🍗', cat:'sides', tier:2, minLevel:8, station:'fryer',
    cookMs:15000, doneWindowMs:7000, basePrice:62, xp:11, pop:1.0, ship:false,
    blurb:'Six pieces. Nobody has ever asked what shape they are.',
    steps:[ { ing:'chicken', qty:2, verb:'cube', layer:'base' },
            { ing:'oil',     qty:1, verb:'dip',  layer:'none' } ] },

  { id:'chiliCheeseFries', name:'Chili Cheese Fries', icon:'🍲', cat:'sides', tier:3, minLevel:13, station:'fryer',
    cookMs:16000, doneWindowMs:7000, basePrice:90, xp:15, pop:1.15, ship:false,
    blurb:'The fryer and the chili pot arguing over one tray. Everyone wins.',
    steps:[ { ing:'potato', qty:3, verb:'cut',     layer:'base' },
            { ing:'oil',    qty:1, verb:'dip',     layer:'none' },
            { ing:'chili',  qty:1, verb:'spoon',   layer:'top'  },
            { ing:'cheese', qty:1, verb:'scatter', layer:'top'  } ] },

  /* ── 🥤 DRINKS ───────────────────────────────────────────────────────────
     Near-instant, tiny margin, and the ONLY reason they matter is the ticket
     bonus: a ticket is "fully filled" or it is not, so the 25-Cinder soda is
     what stands between you and ECON.XP_TICKET_BONUS. That is the whole design
     of a drink in a fast-food sim and it is why they are cheap on purpose.
     Their doneWindow is 40s ("goes flat"), not 8s — losing a shift to a warm
     soda would be punitive without being interesting. */
  { id:'soda', name:'Fountain Soda', icon:'🥤', cat:'drinks', tier:1, minLevel:3, station:'drinks',
    cookMs:3000, doneWindowMs:40000, basePrice:25, xp:4, pop:0.8, ship:false,
    blurb:'Syrup, ice, gas. Ninety percent of the margin in this building.',
    steps:[ { ing:'ice',   qty:2, verb:'fill',  layer:'base' },
            { ing:'syrup', qty:2, verb:'pour',  layer:'fill' } ] },

  { id:'shake', name:'Milkshake', icon:'🥛', cat:'drinks', tier:2, minLevel:10, station:'drinks',
    cookMs:6000, doneWindowMs:40000, basePrice:52, xp:8, pop:1.0, ship:false,
    blurb:'Spun thick. Melts on the pass faster than anything else you make.',
    steps:[ { ing:'milk',  qty:3, verb:'pour', layer:'base' },
            { ing:'syrup', qty:2, verb:'pour', layer:'fill' },
            { ing:'ice',   qty:1, verb:'fill', layer:'top'  } ] },

  { id:'icedCoffee', name:'Iced Coffee', icon:'☕', cat:'drinks', tier:3, minLevel:14, station:'drinks',
    cookMs:5000, doneWindowMs:40000, basePrice:55, xp:7, pop:1.05, ship:false,
    blurb:'Real beans. The night-shift crowd will queue for this and nothing else.',
    steps:[ { ing:'ice',    qty:2, verb:'fill', layer:'base' },
            { ing:'coffee', qty:2, verb:'pull', layer:'fill' },
            { ing:'milk',   qty:2, verb:'pour', layer:'top'  } ] },
];

/* ════════════════════════════════════════════════════════════════════════════
   🧍 CUSTOMERS — who pulls up, and how long they will put up with you.
   ----------------------------------------------------------------------------
   These are the wasteland, not a mall food court: couriers, scavs, night-shift
   medics, a corp suit who tips like the money is not his. Names and icons are
   content and live HERE so drivethru.js never grows a string table.

   patienceMs — BASE seconds on the clock the moment they finish ordering.
                Multiplied by the car (CARS[].patienceMul) and by any patience
                upgrade, then ECON.PATIENCE_ITEM_MS is added per item beyond the
                first: a four-item order is not a broken promise, it is a bigger
                job, and a lane that punished big orders would train players to
                refuse the most profitable tickets.
   tipBias    — multiplies the computed tip (drivethru.tipFor). 1.0 = average.
   order      — {min,max} DISHES they ask for. Capped again by the car's seats
                and by ECON.ORDER_MAX_ITEMS.
   likes      — menu category ids this customer over-orders (weighting only,
                never a hard filter — a locked menu must still be servable).
   ════════════════════════════════════════════════════════════════════════════ */
export const CUSTOMERS = [
  { id:'commuter', name:'Commuter',     icon:'🧑‍💼', patienceMs:52000, tipBias:1.00, order:{min:1,max:2}, likes:['drinks','burgers'], line:'Same as yesterday.' },
  { id:'courier',  name:'Courier',      icon:'🛵',   patienceMs:38000, tipBias:1.15, order:{min:1,max:2}, likes:['dogs','drinks'],    line:'Engine’s running.' },
  { id:'scav',     name:'Scavver',      icon:'🥽',   patienceMs:70000, tipBias:0.70, order:{min:1,max:3}, likes:['dogs','sides'],     line:'Whatever’s cheap.' },
  { id:'trucker',  name:'Hauler',       icon:'🧢',   patienceMs:66000, tipBias:1.10, order:{min:2,max:4}, likes:['burgers','sides'],  line:'Feed the whole cab.' },
  { id:'medic',    name:'Night Medic',  icon:'🩺',   patienceMs:44000, tipBias:1.25, order:{min:1,max:2}, likes:['drinks'],           line:'Twelve hours in. Coffee.' },
  { id:'suit',     name:'Corp Suit',    icon:'🕴️',  patienceMs:34000, tipBias:1.80, order:{min:1,max:2}, likes:['pizza','burgers'],  line:'I am on a clock.' },
  { id:'kid',      name:'Kid on a BMX', icon:'🧒',   patienceMs:60000, tipBias:0.55, order:{min:1,max:2}, likes:['sides','drinks'],   line:'Fries. Just fries.' },
  { id:'raider',   name:'Raider',       icon:'💀',   patienceMs:30000, tipBias:0.40, order:{min:1,max:3}, likes:['burgers','dogs'],   line:'Make it fast.' },
  { id:'family',   name:'Vault Family', icon:'👨‍👩‍👧', patienceMs:75000, tipBias:1.05, order:{min:3,max:5}, likes:['pizza','drinks'],  line:'Big order, sorry!' },
  { id:'mayor',    name:'Mayor’s Aide', icon:'🎩',   patienceMs:48000, tipBias:1.60, order:{min:2,max:3}, likes:['pizza'],            line:'This is for the office.' },
  { id:'ghoul',    name:'Old Timer',    icon:'🧟',   patienceMs:90000, tipBias:0.80, order:{min:1,max:1}, likes:['dogs'],             line:'Been coming here forty years.' },
  { id:'guard',    name:'Gate Guard',   icon:'🛡️',  patienceMs:56000, tipBias:1.20, order:{min:2,max:3}, likes:['burgers','sides'],  line:'Two of everything.' },
];

/* ════════════════════════════════════════════════════════════════════════════
   🚗 CARS — the drive-thru sprites.
   ----------------------------------------------------------------------------
   `seats` caps the order size (a BMX does not buy a family bucket) and gives the
   renderer a reason to draw a bus differently from a bike. `patienceMul` says
   how long the vehicle itself is willing to idle — a patrol car is not waiting.
   `weight` is the spawn weight; commonest vehicles are commonest on screen.
   ════════════════════════════════════════════════════════════════════════════ */
export const CARS = [
  { id:'hatch',  icon:'🚗',  name:'Hatchback',  seats:2, patienceMul:1.00, weight:26, len:1 },
  { id:'suv',    icon:'🚙',  name:'SUV',        seats:4, patienceMul:1.10, weight:18, len:1 },
  { id:'pickup', icon:'🛻',  name:'Pickup',     seats:3, patienceMul:1.05, weight:14, len:1 },
  { id:'van',    icon:'🚐',  name:'Van',        seats:5, patienceMul:1.15, weight:10, len:1 },
  { id:'taxi',   icon:'🚕',  name:'Taxi',       seats:2, patienceMul:0.85, weight:9,  len:1 },
  { id:'bike',   icon:'🏍️', name:'Bike',       seats:1, patienceMul:0.75, weight:9,  len:1 },
  { id:'rig',    icon:'🚚',  name:'Rig',        seats:3, patienceMul:1.25, weight:6,  len:2 },
  { id:'bus',    icon:'🚌',  name:'Transit',    seats:6, patienceMul:1.30, weight:4,  len:2 },
  { id:'patrol', icon:'🚓',  name:'Patrol',     seats:2, patienceMul:0.65, weight:4,  len:1 },
];

/* ════════════════════════════════════════════════════════════════════════════
   🚚 CONVOY_TIERS — shipping finished dishes to another player's city.
   ----------------------------------------------------------------------------
   transitMs is WALL-CLOCK and is the one part of this feature that runs while
   the panel is shut (CONTRACT §4). Thirty minutes is the floor on purpose: a
   convoy that lands in ninety seconds is a vending machine, not logistics, and
   it would also hand a scripted client a fast loop around the food economy.

   feePct is charged in CINDER on the dish value at launch (spendGems). It is
   the *sender's* cost and it is why a convoy is never free money for the pair.
   ════════════════════════════════════════════════════════════════════════════ */
export const CONVOY_TIERS = [
  { id:'van',   name:'Delivery Van', icon:'🚐', capacity:12,  transitMs:30 * 60000,  feePct:0.10, minLevel:5,  blurb:'Twelve boxes and a prayer. Thirty minutes.' },
  { id:'truck', name:'Box Truck',    icon:'🚚', capacity:40,  transitMs:2  * 3600000, feePct:0.08, minLevel:12, blurb:'Forty boxes, two hours, proper insulation.' },
  { id:'rig',   name:'Road Train',   icon:'🛻', capacity:120, transitMs:6  * 3600000, feePct:0.06, minLevel:20, blurb:'A hundred and twenty. Six hours. Cheapest per box.' },
];

/* ════════════════════════════════════════════════════════════════════════════
   ⭐ UPGRADES — bought with Cinder (+ a little hardware). The difficulty answer.
   ----------------------------------------------------------------------------
   🔴 THE SHIFT CURVE IS DESIGNED AROUND THESE. Read ECON.RUSH_CURVE: the day
      peaks at 2.0× around lunch and 2.2× at the dinner rush. A stock kitchen —
      2 griddle lanes, 2 baskets, a 4-car lane — can hold the opening hours and
      CANNOT hold hour 3. That is not a tuning accident, it is the entire
      progression: hour 3 is the wall, and upgrades are the ladder over it.
      If you retune RUSH_CURVE, retune these together or the wall moves.

   `cost` uses the SAME GRAMMAR as SUPPLY_RECIPES.cost — the 14 live resource
   ids plus 'cinder' — so ONE all-or-nothing spend routine (CONTRACT §8.1 steps
   1–4: preflight everything, take, unwind with refundRes/addGems on any false)
   serves both the restock counter and the upgrade shop. Do not write a second
   spend path for upgrades; a second path is a second place to leak a refund.

   `effect` is a flat object read by the helpers at the bottom of this file
   (slotsFor / speedMulFor / laneCap / …). Nothing else should interpret it —
   if you find yourself writing `if (id === 'up_griddle2')` anywhere, the effect
   grammar is missing a key and the fix belongs here.

   `requires` is a hard prerequisite id; the shop greys the row until it is owned.
   ════════════════════════════════════════════════════════════════════════════ */
export const UPGRADES = [
  // ── CAPACITY: more hands. The first thing anyone should buy. ──────────────
  { id:'up_griddle2', name:'Third Griddle Lane', icon:'🍳', minLevel:3, requires:null,
    cost:{ cinder:24000,  metal:20, supplies:12 }, effect:{ station:'griddle', slots:1 },
    blurb:'A third lane on the flat-top. The single biggest jump in this shop.' },
  { id:'up_griddle3', name:'Fourth Griddle Lane', icon:'🍳', minLevel:9, requires:'up_griddle2',
    cost:{ cinder:88000,  metal:55, supplies:30 }, effect:{ station:'griddle', slots:1 },
    blurb:'Four across. Now the bottleneck is you.' },
  { id:'up_fryer2',   name:'Second Basket', icon:'🍟', minLevel:6, requires:null,
    cost:{ cinder:52000,  metal:34, fuel:20 },  effect:{ station:'fryer', slots:1 },
    blurb:'Fries and rings at the same time, finally.' },
  { id:'up_oven2',    name:'Second Deck', icon:'🔥', minLevel:11, requires:null,
    cost:{ cinder:120000, metal:70, stone:40, fuel:25 }, effect:{ station:'oven', slots:1 },
    blurb:'Two pies in the oven. The margin tier doubles.' },
  { id:'up_board2',   name:'Longer Prep Board', icon:'🔪', minLevel:7, requires:null,
    cost:{ cinder:38000,  metal:24, wood:30 }, effect:{ station:'assembly', slots:1 },
    blurb:'Room to build two things without knocking one off.' },
  { id:'up_fountain2',name:'Twin Fountain', icon:'🥤', minLevel:8, requires:null,
    cost:{ cinder:30000,  metal:18, supplies:14 }, effect:{ station:'drinks', slots:1 },
    blurb:'Two cups pouring. Drinks stop being the thing you forget.' },

  // ── SPEED: the same hands, faster. ────────────────────────────────────────
  { id:'up_fryer_fast',   name:'Pressure Fryer', icon:'⚡', minLevel:10, requires:'up_fryer2',
    cost:{ cinder:74000,  metal:48, fuel:35 }, effect:{ station:'fryer', speedMul:0.75 },
    blurb:'25% off every basket. Also 25% less time to forget one.' },
  { id:'up_griddle_fast', name:'Clamshell Grill', icon:'⚡', minLevel:13, requires:'up_griddle2',
    cost:{ cinder:96000,  metal:62, supplies:30 }, effect:{ station:'griddle', speedMul:0.80 },
    blurb:'Cooks both sides at once. 20% off every patty.' },
  { id:'up_oven_fast',    name:'Convection Kit', icon:'⚡', minLevel:17, requires:'up_oven2',
    cost:{ cinder:160000, metal:90, fuel:50, stone:30 }, effect:{ station:'oven', speedMul:0.82 },
    blurb:'Blown air. A Supreme in twenty-three seconds.' },

  // ── THE LANE ──────────────────────────────────────────────────────────────
  { id:'up_lane2',   name:'Second Drive-Thru Lane', icon:'🛣️', minLevel:14, requires:null,
    cost:{ cinder:185000, metal:110, stone:80, supplies:40 }, effect:{ laneAdd:3 },
    blurb:'Three more cars can queue. Twice the traffic, twice the shouting.' },
  { id:'up_menuboard', name:'Lit Menu Board', icon:'📋', minLevel:5, requires:null,
    cost:{ cinder:42000,  metal:22, supplies:18 }, effect:{ patienceMul:1.15 },
    blurb:'They order faster and wait longer when they can read the board.' },
  { id:'up_speaker',   name:'Clear Speaker Box', icon:'🔊', minLevel:9, requires:'up_menuboard',
    cost:{ cinder:68000,  metal:36, supplies:22 }, effect:{ tipMul:1.20, patienceMul:1.05 },
    blurb:'No more “WHAT?”. Tips up a fifth.' },

  // ── THE PASS & THE PANTRY ─────────────────────────────────────────────────
  { id:'up_heatlamp', name:'Heat Lamp Pass', icon:'💡', minLevel:6, requires:null,
    cost:{ cinder:34000,  metal:20, fuel:14 }, effect:{ passAdd:4, freshMul:1.6 },
    blurb:'Four more plates on the pass and they stay sellable far longer.' },
  { id:'up_walkin',   name:'Walk-In Cooler', icon:'🚪', minLevel:8, requires:null,
    cost:{ cinder:58000,  metal:44, supplies:26 }, effect:{ pantryAdd:250 },
    blurb:'+250 units of pantry. Restock twice a shift instead of four times.' },
  { id:'up_walkin2',  name:'Cold Room', icon:'🧊', minLevel:15, requires:'up_walkin',
    cost:{ cinder:140000, metal:95, supplies:60, stone:40 }, effect:{ pantryAdd:500 },
    blurb:'+500 more. Buy the week, not the hour.' },

  // ── REPUTATION & LOGISTICS ────────────────────────────────────────────────
  { id:'up_signage',  name:'Roadside Sign', icon:'🪧', minLevel:12, requires:null,
    cost:{ cinder:82000,  metal:50, wood:60, cloth:20 }, effect:{ popGainMul:1.35 },
    blurb:'Word of mouth, but faster. Popularity climbs 35% quicker.' },
  { id:'up_truckbay', name:'Loading Bay', icon:'🚛', minLevel:16, requires:null,
    cost:{ cinder:210000, metal:130, stone:90, supplies:55 }, effect:{ convoyCapMul:1.5, convoyFeeMul:0.85 },
    blurb:'Half again the load per convoy and 15% off the freight fee.' },

  /* ── THE LATE SHIFT (18+) ─────────────────────────────────────────────────
     ⚠ These exist because unlocksAt() came back EMPTY for levels 18–22 and an
     empty level-up is the moment a player decides the game is over. The Road
     Train unlocks at 20 (CONVOY_TIERS) and needed company. Run unlocksAt() in a
     loop after ANY retune of minLevels — a silent gap is invisible in review
     and extremely visible at the fifth blank "LEVEL UP!" in a row. */
  { id:'up_fryer3',  name:'Third Basket', icon:'🍟', minLevel:18, requires:'up_fryer2',
    cost:{ cinder:165000, metal:88, fuel:45 }, effect:{ station:'fryer', slots:1 },
    blurb:'Three baskets. Sides stop being the thing that loses you tickets.' },
  { id:'up_marquee', name:'Neon Marquee', icon:'🌟', minLevel:20, requires:'up_signage',
    cost:{ cinder:260000, metal:120, cloth:60, supplies:70 }, effect:{ popGainMul:1.25, tipMul:1.15 },
    blurb:'Visible from the highway. Reputation and tips both climb.' },
  { id:'up_board3',  name:'Full Prep Line', icon:'🔪', minLevel:22, requires:'up_board2',
    cost:{ cinder:300000, metal:150, wood:90, supplies:80 }, effect:{ station:'assembly', slots:2 },
    blurb:'Four builds at once. The board stops being the bottleneck.' },
];

/* ════════════════════════════════════════════════════════════════════════════
   📅 DAY_NAMES / 😀 POP_FACES — content the HUD reads.
   ----------------------------------------------------------------------------
   REF-A's HUD says "MONDAY 01:18 PM"; REF-B's says "Popularity 🙂". Both of
   those are strings, and strings are content, so they are here and not in the
   renderer. They are also hung off ECON below BY REFERENCE (same array object,
   not a copy) so "everything is in ECON" stays true without a second copy that
   can drift.
   ════════════════════════════════════════════════════════════════════════════ */
export const DAY_NAMES = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

// Ascending by `min`. faceFor() picks the LAST entry whose min <= popularity.
export const POP_FACES = [
  { min:0,  icon:'🤬', label:'Hated',    color:'#ff5a5a' },
  { min:15, icon:'😠', label:'Poor',     color:'#ff8a5a' },
  { min:35, icon:'😐', label:'Okay',     color:'#e0c060' },
  { min:55, icon:'🙂', label:'Liked',    color:'#9ad17a' },
  { min:75, icon:'😄', label:'Popular',  color:'#7fd6ff' },
  { min:92, icon:'🤩', label:'Famous',   color:'#ffd166' },
];

/* ════════════════════════════════════════════════════════════════════════════
   💰 ECON — EVERY TUNING NUMBER IN THE FEATURE. THE ONE TABLE.
   ----------------------------------------------------------------------------
   See the file header for WHY (CLAUDE.md's _opEcon rule). Repeating the part
   that matters: a literal economy number in any other kitchen file is a bug.

   ── THE SHAPE OF A DAY ───────────────────────────────────────────────────
   DAY_MS 12 real minutes maps onto OPEN_HOUR 10 → CLOSE_HOUR 22, so one in-game
   hour is exactly 60s of real time. That ratio is chosen so the HUD clock moves
   fast enough to feel like a shift (it visibly ticks) and slow enough that
   "hour 3" is a real, earned three minutes of sustained play rather than a
   number that flickers past. If you change DAY_MS, the RUSH_CURVE below still
   works — it is indexed as a FRACTION of the day, not in milliseconds.

   ── THE DIFFICULTY WALL ──────────────────────────────────────────────────
   Spawn interval = (SPAWN_BASE_MS − SPAWN_POP_SPAN × pop/100) ÷ rush.
     Opening (pop 50, rush 0.55): 6750 ÷ 0.55 ≈ one car every 12.3s  → easy.
     Lunch   (pop 50, rush 2.0):  6750 ÷ 2.0  ≈ one car every 3.4s   → the wall.
     Famous  (pop 95, rush 2.2):  4725 ÷ 2.2  ≈ one car every 2.1s   → upgrades
                                                                       or death.
   Against that, a STOCK kitchen (2 griddle lanes, an 8s hot dog) turns out ~15
   dishes per in-game hour if you never miss a pull. Modelled hour by hour at
   popularity 50, with a mean order of 1.9 dishes:
     10:00  rush 0.70  → ~12 dishes demanded vs 15 capacity   comfortable
     11:00  rush 1.15  → ~19 demanded vs 15                    tense
     12:00  rush 1.73  → ~29 demanded vs 15                    THE WALL
   That is the brief, exactly: the first shift is winnable and tense, and hour
   three is not survivable stock. The gap IS the upgrade shop. Retune RUSH_CURVE
   and you move the wall — re-run the hour-by-hour model, do not guess.
   ════════════════════════════════════════════════════════════════════════════ */
export const ECON = {
  // ── TIME ────────────────────────────────────────────────────────────────
  DAY_MS: 720000,           // 12 real minutes per in-game day
  OPEN_HOUR: 10,            // service opens 10:00
  CLOSE_HOUR: 22,           // service closes 22:00 → 12 in-game hours
  HOUR_MS: 60000,           // ⚠ MUST equal DAY_MS / (CLOSE_HOUR − OPEN_HOUR).
                            //   Kept as a literal because it is read every frame
                            //   by the HUD clock; assertDataSane() checks it.
  MAX_DT_MS: 250,           // 🔴 RAF CLAMP (CONTRACT §3). A backgrounded tab hands
                            //   the loop a 40-SECOND dt: every ticket expires in
                            //   one frame, popularity floors, the player comes
                            //   back to a dead restaurant they did not lose.
                            //   250ms ≈ 4fps worth of sim; anything slower is
                            //   dropped time, and dropped time is the merciful
                            //   answer here.
  SAVE_DEBOUNCE_MS: 5000,   // CONTRACT §5. Never per tick.

  // ── THE DAY CURVE ───────────────────────────────────────────────────────
  // One entry per in-game hour, 10:00 → 21:00. Indexed as a fraction of the day
  // and INTERPOLATED (see rushAt) so the rush ramps instead of stepping — a step
  // reads as a bug, a ramp reads as lunch arriving.
  //        10   11   12    13    14    15   16   17   18    19    20    21
  RUSH_CURVE: [0.55,0.85,1.45,2.00,1.70,1.00,0.80,0.95,1.45,2.05,2.20,1.15],
  RUSH_MIN: 0.4,
  RUSH_MAX: 2.4,

  // ── QUALITY (CONTRACT §8.2) ─────────────────────────────────────────────
  Q_RAW: 0.5,               // pulled before doneAt. Pays half and earns NO xp.
  Q_GOOD: 1.0,
  Q_PERFECT: 1.25,
  Q_BURNT: 0,               // pays nothing AND costs POP_BURN.
  PERFECT_FRACTION: 1 / 3,  // the first third of doneWindowMs is 'perfect'.
                            // 🔴 Do NOT widen this to be kind. The window is the
                            //    whole skill; widened, cooking becomes a queue of
                            //    buttons that eventually go green on their own.
  Q_ORDER_BONUS: 0.10,      // max bonus multiplier for building steps in order
                            // (see orderScore). Optional for render to use;
                            // a renderer without drag-build simply passes null.

  // ── PAYOUT (CONTRACT §8.3) ──────────────────────────────────────────────
  // payout = Σ(basePrice × qualityMult) × popMult × rushMult
  POP_PAY_FLOOR: 0.80,      // popMult at popularity 0
  POP_PAY_SPAN: 0.40,       // …+ span × (pop/100) → 1.20 at popularity 100
  RUSH_PAY_MIN: 0.90,       // rushMult is COMPRESSED out of RUSH_CURVE's 0.55–2.2
  RUSH_PAY_MAX: 1.35,       //   range. WHY: rush already pays you by sending more
                            //   customers. Letting it ALSO multiply each ticket
                            //   by 2.2 would make the quiet hours pointless and
                            //   turn the whole game into "only play lunch".

  // ── TIPS ────────────────────────────────────────────────────────────────
  TIP_MAX_PCT: 0.35,        // ceiling as a fraction of payout
  TIP_PATIENCE_W: 0.45,     // weights sum to 1.0 — they are a blend, not a stack
  TIP_QUALITY_W: 0.35,
  TIP_POP_W: 0.20,
  TIP_MIN: 1,               // a tipped customer always leaves at least 1 Cinder

  // ── POPULARITY ──────────────────────────────────────────────────────────
  POP_START: 50,
  POP_MIN: 0,
  POP_MAX: 100,
  POP_SERVE: 0.60,          // × recipe.pop × popGainMul(upgrades)
  POP_PERFECT_BONUS: 0.40,  // extra on an all-perfect ticket
  POP_LOST: -3.5,           // 🔴 ASYMMETRIC ON PURPOSE. Six good tickets to undo
  POP_BURN: -1.2,           //    one lost one. A symmetric reputation meter never
  POP_WAVE: -2.0,           //    moves, and a meter that never moves is not a
  POP_DECAY_PER_DAY: -1.5,  //    mechanic — it is a decoration.

  // ── XP / LEVEL ──────────────────────────────────────────────────────────
  // xpForLevel(lv) = XP_L1×n + XP_CURVE×n²   where n = lv−1  (so level 1 = 0).
  // L2 240 · L3 600 · L5 1680 · L10 6480 · L20 25080 · L40 98280.
  // (Those are printed by xpForLevel(), not by hand — if you retune XP_L1 or
  //  XP_CURVE, re-print them rather than editing this line to what you meant.)
  // A good first shift is ~600–900 xp → level 3. That is the intended pace:
  // the menu opens fast enough to stay interesting and slow enough that the
  // oven (level 8) is something you play toward.
  XP_L1: 180,
  XP_CURVE: 60,
  MAX_LEVEL: 40,
  XP_TICKET_BONUS: 15,      // ticket fully filled AND on time
  XP_PERFECT_MULT: 1.5,     // xp multiplier on a 'perfect' dish (raw earns none)

  // ── THE LANE (drivethru.js) ─────────────────────────────────────────────
  LANE_CAP: 4,              // base cars queued; up_lane2 adds 3 → laneCap()
  LANE_LEN: 1.0,            // normalised lane length; car.pos runs 0 → 1
  SPAWN_BASE_MS: 9000,
  SPAWN_POP_SPAN: 4500,     // subtracted at popularity 100 → 4500ms floor
  SPAWN_JITTER: 0.25,       // ±25% so the lane never feels metronomic
  SPAWN_MIN_MS: 1400,       // hard floor; below this nothing is playable
  PATIENCE_ITEM_MS: 12000,  // added per item beyond the first
  PATIENCE_MIN_MS: 20000,
  ORDER_MAX_ITEMS: 5,
  COUNTER_SHARE: 0.35,      // fraction of tickets that walk in rather than drive

  // ── TICKETS ─────────────────────────────────────────────────────────────
  TICKET_BASE_MS: 45000,
  TICKET_ITEM_MS: 20000,    // per item beyond the first
  TICKET_CAP: 8,            // board is full → no new spawn (drop, do not queue)

  // ── PASS & PANTRY ───────────────────────────────────────────────────────
  PASS_CAP: 6,              // plated dishes waiting; up_heatlamp adds 4
  PASS_FRESH_MS: 75000,     // × freshMul(upgrades) before a plate goes stale
  PASS_STALE_MULT: 0.60,    // a stale plate still sells, for less
  PANTRY_CAP: 600,          // TOTAL units across all ingredients; walk-ins add
                            // 🔴 This is the kitchen's OWN cap and has NOTHING to
                            //    do with bridge().resourceCap(). Pantry stock is
                            //    not stash stock (file header).
  PANTRY_LOW: 4,            // ≤ this many units fires ONE pantry:low per ingredient
  SUPPLY_MAX_BATCHES: 20,   // per buySupply() call, so one fat-fingered tap
                            // cannot drain a player's entire food ledger

  // ── THE GRUBSTAKE ───────────────────────────────────────────────────────
  // 🔴 A new kitchen starts STOCKED FOR ONE DISH. WHY: rung 1 of the degradation
  //    ladder (CONTRACT §9) is "no bridge at all → the kitchen opens, cooks and
  //    serves against an empty pantry". Empty is *survivable*, but as a first
  //    impression it is a restaurant with nothing in it and a shop that refuses
  //    you. Twelve hot dogs is the tutorial: it is exactly the day-one menu, it
  //    runs out inside the first shift, and running out is what teaches restock.
  START_PANTRY: { roll:12, sausage:12, mustard:12, onion:8 },

  // ── CONVOYS (CONTRACT §8.4) ─────────────────────────────────────────────
  /* 🔴🔴 CONVOY_FOOD_PER_DISH IS THE MOST DANGEROUS NUMBER IN THIS FEATURE. 🔴🔴
     A claimed convoy grants `dishes × CONVOY_FOOD_PER_DISH` units of the LIVE
     resource `food` via addRes(). The dishes were themselves bought out of the
     live ledger, so a convoy is meant to MOVE value between two players. If the
     round trip returns more `food` than the ingredients consumed, the kitchen
     is an infinite food printer, `food` inflates to worthlessness, and every
     other system priced in food (Gene Vault, Bottling Line, crafting, the
     resource market) dies with it. There is no "small" version of this bug.

     THE GUARD, and it is doubled on purpose:
       Outer wall — only recipes with ship:true may ride a convoy. The cheapest
         shippable dish is the Hot Dog at 1.267 food (roll .5 + sausage .6 +
         mustard .167); every other shippable dish costs more.
       Inner wall — even the cheapest UNSHIPPABLE dish (Fountain Soda, 1.2 food:
         two shots of syrup at 0.6 each) still costs more food than this pays.
         So if convoy.js ever forgets the ship flag, the economy still holds.
     Set to 1. Verify with convoyGuardOk() — it recomputes both walls from the
     live tables and is the thing to run after ANY change to SUPPLY_RECIPES. */
  CONVOY_FOOD_PER_DISH: 1,
  CONVOY_FEE_PCT: 0.10,     // fallback when a tier has no feePct of its own
  CONVOY_MIN_DISHES: 4,     // below this it is not a convoy, it is a courier
  /* Sender's xp, awarded on convoy:arrive. ⚠ SIZED AGAINST THE SALE THE SENDER
     GAVE UP, not picked for feel: forty Hot Dogs sold over the counter are
     1,600 Cinder and 320 xp. Shipped, they are 0 Cinder, a freight fee, and
     40 × this. At 3 the trade was strictly worse than selling in BOTH currencies
     and nobody would ever have loaded a truck twice. At 6 it reads as what it
     is — you trade the money for the xp and the goodwill. */
  CONVOY_XP_PER_DISH: 6,
  CONVOY_MAX_ACTIVE: 3,     // outbound at once, stock; up_truckbay does not raise
                            // this — capacity is the upgrade, not concurrency

  // ── FX / feel ───────────────────────────────────────────────────────────
  FLOAT_MS: 900,            // float-up lifetime
  SPARK_MS: 500,
  BURN_WARN_MS: 3000,       // start flashing a slot this long before burnAt

  // Content hung off ECON BY REFERENCE. Same objects, no second copy.
  DAY_NAMES,
  POP_FACES,
};

/* ════════════════════════════════════════════════════════════════════════════
   🧮 DERIVATION — the only work this module does at import time.
   ----------------------------------------------------------------------------
   Three maps and two normalising passes. No I/O, no DOM, no clock. Everything
   below is O(entries) over ~70 rows, which is nothing next to parsing the file.

   The rule these passes enforce: A NUMBER THAT CAN BE COMPUTED IS NEVER TYPED.
     • INGREDIENTS[].batch  ← SUPPLY_RECIPES[].out.qty
     • RECIPES[].needs      ← Σ steps[].qty
     • RECIPES[].burnMs     ← doneWindowMs (see the RECIPES header on why these
                              are two names for one interval)
     • RECIPES[].foodCost   ← Σ needs × (supply.cost.food ÷ supply.out.qty)
   ════════════════════════════════════════════════════════════════════════════ */

function _index(arr) {
  const m = Object.create(null);
  for (let i = 0; i < arr.length; i++) m[arr[i].id] = arr[i];
  return m;
}

const _SUPPLY_BY_ID = _index(SUPPLY_RECIPES);
// ingredient id → the supply row that stocks it. Built by scanning `out.ing`
// rather than trusting INGREDIENTS[].supply, so a typo'd pointer surfaces as a
// missing batch (loud, in assertDataSane) instead of as a silently wrong price.
const _SUPPLY_BY_ING = Object.create(null);
for (const s of SUPPLY_RECIPES) if (s && s.out && s.out.ing) _SUPPLY_BY_ING[s.out.ing] = s;

/** 🥫 INGREDIENTS — normalised. `batch` is derived; never type it by hand. */
export const INGREDIENTS = _INGREDIENTS_RAW.map(ing => {
  const sup = _SUPPLY_BY_ING[ing.id] || null;
  return Object.assign({}, ing, {
    batch: sup ? (sup.out.qty | 0) : 0,
    // How much LIVE `food` one unit of this ingredient represents. This is the
    // number the convoy guard is built on, so it lives on the ingredient rather
    // than being recomputed at three call sites.
    foodPerUnit: sup && sup.out.qty ? ((sup.cost && sup.cost.food) || 0) / sup.out.qty : 0,
    minLevel: sup ? (sup.minLevel || 1) : 1,
  });
});
const _ING_BY_ID = _index(INGREDIENTS);

function _needsFromSteps(steps) {
  const n = Object.create(null);
  for (const s of (steps || [])) {
    if (!s || !s.ing) continue;
    n[s.ing] = (n[s.ing] || 0) + (s.qty | 0);
  }
  return n;
}

/** 🍽 RECIPES — normalised. `needs`, `burnMs`, `perfectMs`, `foodCost` derived. */
export const RECIPES = _RECIPES_RAW.map(r => {
  const needs = _needsFromSteps(r.steps);
  let foodCost = 0;
  for (const id in needs) {
    const ing = _ING_BY_ID[id];
    foodCost += needs[id] * (ing ? ing.foodPerUnit : 0);
  }
  return Object.assign({}, r, {
    needs,
    // ⚠ burnMs === doneWindowMs, always. See the RECIPES block comment.
    burnMs: r.doneWindowMs,
    // Length of the 'perfect' band at the START of the done window.
    perfectMs: Math.round(r.doneWindowMs * ECON.PERFECT_FRACTION),
    // start → burnAt, for a renderer that wants one bar instead of two.
    totalMs: r.cookMs + r.doneWindowMs,
    foodCost: Math.round(foodCost * 1000) / 1000,
    ship: r.ship !== false,
  });
});
const _RECIPE_BY_ID  = _index(RECIPES);
const _STATION_BY_ID = _index(STATIONS);
const _CUST_BY_ID    = _index(CUSTOMERS);
const _CAR_BY_ID     = _index(CARS);
const _TIER_BY_ID    = _index(CONVOY_TIERS);
const _UPG_BY_ID     = _index(UPGRADES);
const _SHELF_BY_ID   = _index(SHELVES);

/* ── LOOKUPS. All return null for an unknown id — NEVER throw, never undefined.
      WHY null and not undefined: `recipe(x) || fallback` reads the same either
      way, but a null in a JSON debug dump is visible and an undefined is not. */
export function recipe(id)      { return _RECIPE_BY_ID[id]  || null; }
export function ingredient(id)  { return _ING_BY_ID[id]     || null; }
export function station(id)     { return _STATION_BY_ID[id] || null; }
export function supply(id)      { return _SUPPLY_BY_ID[id]  || null; }
export function supplyFor(ingId){ return _SUPPLY_BY_ING[ingId] || null; }
export function customer(id)    { return _CUST_BY_ID[id]    || null; }
export function car(id)         { return _CAR_BY_ID[id]     || null; }
export function convoyTier(id)  { return _TIER_BY_ID[id]    || null; }
export function upgrade(id)     { return _UPG_BY_ID[id]     || null; }
export function shelf(id)       { return _SHELF_BY_ID[id]   || null; }

/* ════════════════════════════════════════════════════════════════════════════
   📈 LEVELS & THE MENU LADDER
   ════════════════════════════════════════════════════════════════════════════ */

/** Cumulative XP required to REACH level `lv`. xpForLevel(1) === 0, always. */
export function xpForLevel(lv) {
  const n = Math.max(0, (lv | 0) - 1);
  return Math.round(ECON.XP_L1 * n + ECON.XP_CURVE * n * n);
}

/** Integer level for a TOTAL xp number. Clamped to [1, MAX_LEVEL]. */
export function levelForXp(xp) {
  const total = Math.max(0, xp || 0);
  // 40 iterations worst case. An inverted quadratic would be two lines of
  // algebra and one rounding bug at every level boundary; the loop cannot be
  // wrong, and it runs once per xp change, not once per frame.
  let lv = 1;
  while (lv < ECON.MAX_LEVEL && total >= xpForLevel(lv + 1)) lv++;
  return lv;
}

/** HUD helper: {level, into, need, pct} for the XP bar (REF-B's "Level 26"). */
export function xpProgress(xp) {
  const total = Math.max(0, xp || 0);
  const lv = levelForXp(total);
  if (lv >= ECON.MAX_LEVEL) return { level: lv, into: 0, need: 0, pct: 1 };
  const base = xpForLevel(lv), next = xpForLevel(lv + 1);
  const span = Math.max(1, next - base);
  return { level: lv, into: total - base, need: span, pct: Math.min(1, (total - base) / span) };
}

/** RECIPES the player may cook at `lv`, in MENU ORDER (category, then tier). */
export function menuForLevel(lv) {
  const L = Math.max(1, lv | 0);
  const catOrder = Object.create(null);
  for (const c of MENU_CATS) catOrder[c.id] = c.order;
  return RECIPES
    .filter(r => (r.minLevel || 1) <= L)
    .sort((a, b) => (catOrder[a.cat] - catOrder[b.cat]) || (a.tier - b.tier) || (a.basePrice - b.basePrice));
}

/**
 * Everything that becomes available AT exactly level `lv` — the level-up toast.
 * A level that unlocks nothing is a level that feels like nothing, so this is
 * also the check to run when retuning minLevels: no gaps below ~L16.
 */
export function unlocksAt(lv) {
  const L = lv | 0;
  return {
    recipes:  RECIPES.filter(r => (r.minLevel || 1) === L),
    supplies: SUPPLY_RECIPES.filter(s => (s.minLevel || 1) === L),
    upgrades: UPGRADES.filter(u => (u.minLevel || 1) === L),
    convoys:  CONVOY_TIERS.filter(t => (t.minLevel || 1) === L),
  };
}

/* ════════════════════════════════════════════════════════════════════════════
   ⭐ UPGRADE EFFECTS — the ONLY interpreter of UPGRADES[].effect.
   ----------------------------------------------------------------------------
   🔴 Every consumer calls these helpers. Nobody reads STATIONS[].slots,
      ECON.LANE_CAP or ECON.PANTRY_CAP directly to size anything, because those
      are BASE values and a base value that ignores a purchased upgrade is a
      bought-and-not-delivered bug — the player is charged and nothing changes.

   `owned` may be an Array of ids, a Set, or an object map {id:true}. All three
   turn up: state saves an array, render holds a Set, a debug console types an
   object. Accepting all three here costs six lines and removes a whole class of
   "worked in my file" mismatch between six parallel builders.
   ════════════════════════════════════════════════════════════════════════════ */
function _has(owned, id) {
  if (!owned) return false;
  if (Array.isArray(owned)) return owned.indexOf(id) !== -1;
  if (typeof owned.has === 'function') return !!owned.has(id);
  return !!owned[id];
}

/** Sum a numeric effect key across every owned upgrade. */
function _sumEffect(owned, key, filter) {
  let n = 0;
  for (const u of UPGRADES) {
    if (!_has(owned, u.id)) continue;
    const e = u.effect || {};
    if (typeof e[key] !== 'number') continue;
    if (filter && !filter(u, e)) continue;
    n += e[key];
  }
  return n;
}

/** Multiply a multiplicative effect key across every owned upgrade. */
function _mulEffect(owned, key, filter) {
  let m = 1;
  for (const u of UPGRADES) {
    if (!_has(owned, u.id)) continue;
    const e = u.effect || {};
    if (typeof e[key] !== 'number') continue;
    if (filter && !filter(u, e)) continue;
    m *= e[key];
  }
  return m;
}

/** Slot count for a station INCLUDING upgrades. Size Kitchen.stations with this. */
export function slotsFor(stationId, owned) {
  const st = _STATION_BY_ID[stationId];
  if (!st) return 0;
  return (st.slots | 0) + _sumEffect(owned, 'slots', u => u.effect.station === stationId);
}

/** Cook-speed multiplier for a station (lower = faster). */
export function speedMulFor(stationId, owned) {
  const st = _STATION_BY_ID[stationId];
  if (!st) return 1;
  return (st.speedMul || 1) * _mulEffect(owned, 'speedMul', u => u.effect.station === stationId);
}

/** Actual cookMs for a recipe on the player's kitchen. Use THIS, not r.cookMs. */
export function cookMsFor(recipeId, owned) {
  const r = _RECIPE_BY_ID[recipeId];
  if (!r) return 0;
  return Math.max(500, Math.round(r.cookMs * speedMulFor(r.station, owned)));
}

/** The done window does NOT shrink with speed upgrades — a faster cook must not
 *  also be a harder cook, or every upgrade would be a trap. */
export function doneWindowMsFor(recipeId /*, owned */) {
  const r = _RECIPE_BY_ID[recipeId];
  return r ? r.doneWindowMs : 0;
}

export function laneCap(owned)     { return ECON.LANE_CAP  + _sumEffect(owned, 'laneAdd'); }
export function passCap(owned)     { return ECON.PASS_CAP  + _sumEffect(owned, 'passAdd'); }
export function pantryCap(owned)   { return ECON.PANTRY_CAP + _sumEffect(owned, 'pantryAdd'); }
export function patienceMul(owned) { return _mulEffect(owned, 'patienceMul'); }
export function tipMul(owned)      { return _mulEffect(owned, 'tipMul'); }
export function popGainMul(owned)  { return _mulEffect(owned, 'popGainMul'); }
export function passFreshMs(owned) { return Math.round(ECON.PASS_FRESH_MS * _mulEffect(owned, 'freshMul')); }

export function convoyCapacity(tierId, owned) {
  const t = _TIER_BY_ID[tierId];
  if (!t) return 0;
  return Math.floor(t.capacity * _mulEffect(owned, 'convoyCapMul'));
}

export function convoyFeePct(tierId, owned) {
  const t = _TIER_BY_ID[tierId];
  const base = t && typeof t.feePct === 'number' ? t.feePct : ECON.CONVOY_FEE_PCT;
  return base * _mulEffect(owned, 'convoyFeeMul');
}

/** UPGRADES the player can see at `lv`, prerequisites resolved for greying-out. */
export function upgradesForLevel(lv, owned) {
  const L = Math.max(1, lv | 0);
  return UPGRADES
    .filter(u => (u.minLevel || 1) <= L)
    .map(u => Object.assign({}, u, {
      owned: _has(owned, u.id),
      locked: !!(u.requires && !_has(owned, u.requires)),
    }));
}

/* ════════════════════════════════════════════════════════════════════════════
   ⏱ THE DAY CURVE — pure functions of shift.tMs. No clock reads.
   ════════════════════════════════════════════════════════════════════════════ */

/** Fraction of the in-game day elapsed, 0..1 (clamped). */
export function dayPct(tMs) {
  const d = ECON.DAY_MS || 1;
  const p = (tMs || 0) / d;
  return p < 0 ? 0 : (p > 1 ? 1 : p);
}

/** Hour as a FLOAT for the HUD clock — feed it straight to bridge().fmtClock. */
export function hourAt(tMs) {
  return ECON.OPEN_HOUR + dayPct(tMs) * (ECON.CLOSE_HOUR - ECON.OPEN_HOUR);
}

/**
 * Demand multiplier at `tMs`, LINEARLY INTERPOLATED between RUSH_CURVE entries.
 * Stepping straight from 1.45 to 2.00 on the hour reads as a bug ("why did it
 * suddenly get hard?"); ramping over the hour reads as lunch arriving, which is
 * the same information delivered as atmosphere instead of as a jolt.
 */
export function rushAt(tMs) {
  const c = ECON.RUSH_CURVE;
  if (!c || !c.length) return 1;
  const x = dayPct(tMs) * c.length;
  const i = Math.min(c.length - 1, Math.max(0, Math.floor(x)));
  const j = Math.min(c.length - 1, i + 1);
  const f = x - i;
  const v = c[i] + (c[j] - c[i]) * f;
  return Math.min(ECON.RUSH_MAX, Math.max(ECON.RUSH_MIN, v));
}

/** Payout multiplier from rush, COMPRESSED into RUSH_PAY_MIN..MAX. See ECON. */
export function rushPayMul(rush) {
  const lo = ECON.RUSH_MIN, hi = ECON.RUSH_MAX;
  const t = Math.min(1, Math.max(0, ((rush || 1) - lo) / Math.max(0.0001, hi - lo)));
  return ECON.RUSH_PAY_MIN + t * (ECON.RUSH_PAY_MAX - ECON.RUSH_PAY_MIN);
}

/** Popularity payout multiplier, 0.80 → 1.20 (CONTRACT §8.3). */
export function popPayMul(pop) {
  const p = Math.min(ECON.POP_MAX, Math.max(ECON.POP_MIN, pop || 0));
  return ECON.POP_PAY_FLOOR + (p / 100) * ECON.POP_PAY_SPAN;
}

/** Milliseconds until the next car, before jitter. drivethru.js applies jitter. */
export function spawnIntervalMs(pop, rush) {
  const p = Math.min(ECON.POP_MAX, Math.max(ECON.POP_MIN, pop || 0));
  const base = ECON.SPAWN_BASE_MS - ECON.SPAWN_POP_SPAN * (p / 100);
  return Math.max(ECON.SPAWN_MIN_MS, base / Math.max(0.1, rush || 1));
}

/** Weekday label. `day` is 1-based and persists forever, so day 1 is Monday. */
export function dayName(day) {
  const d = Math.max(1, day | 0);
  return DAY_NAMES[(d - 1) % DAY_NAMES.length];
}

/** The emoji face for the popularity meter. Never null. */
export function faceFor(pop) {
  const p = Math.min(ECON.POP_MAX, Math.max(ECON.POP_MIN, pop || 0));
  let out = POP_FACES[0];
  for (const f of POP_FACES) if (p >= f.min) out = f;
  return out;
}

/* ════════════════════════════════════════════════════════════════════════════
   🍳 COOKING / QUALITY / ORDER helpers
   ════════════════════════════════════════════════════════════════════════════ */

/** Quality multiplier for a quality string. Unknown → Q_GOOD (never 0/undefined:
 *  an unknown quality must not silently pay nothing). */
export function qualityMul(q) {
  if (q === 'perfect') return ECON.Q_PERFECT;
  if (q === 'raw')     return ECON.Q_RAW;
  if (q === 'burnt')   return ECON.Q_BURNT;
  return ECON.Q_GOOD;
}

/**
 * 0..1 score for how closely `laidIds` follows recipe.steps order.
 * OPTIONAL: a renderer with tap-to-add build UI passes the tap order and the
 * player earns up to ECON.Q_ORDER_BONUS on top of the timing multiplier. A
 * renderer that just presses COOK passes null and loses nothing — which is why
 * this is a bonus and not a penalty. Sauce before cheese must never be the
 * difference between a sale and a bin.
 */
export function orderScore(recipeId, laidIds) {
  const r = _RECIPE_BY_ID[recipeId];
  if (!r || !Array.isArray(laidIds) || !laidIds.length) return 1;
  const want = [];
  for (const s of r.steps) for (let i = 0; i < s.qty; i++) want.push(s.ing);
  const n = Math.min(want.length, laidIds.length);
  if (!n) return 1;
  let hit = 0;
  for (let i = 0; i < n; i++) if (want[i] === laidIds[i]) hit++;
  return hit / want.length;
}

/** May this dish ride a convoy? See the CONVOY GUARD in ECON. */
export function shippable(recipeId) {
  const r = _RECIPE_BY_ID[recipeId];
  return !!(r && r.ship);
}

/** Units of LIVE `food` embodied in one finished dish. Derived, never typed. */
export function foodCostOf(recipeId) {
  const r = _RECIPE_BY_ID[recipeId];
  return r ? r.foodCost : 0;
}

/** Cinder value of a dish list {recipeId: qty} — the convoy fee base. */
export function dishValue(items) {
  let v = 0;
  for (const id in (items || {})) {
    const r = _RECIPE_BY_ID[id];
    if (r) v += r.basePrice * (items[id] | 0);
  }
  return Math.round(v);
}

/* ════════════════════════════════════════════════════════════════════════════
   🛡 SELF-CHECKS — pure, on demand, NEVER at import time.
   ----------------------------------------------------------------------------
   These do not run themselves. This module is imported on every page load of a
   223k-line app; a console.warn here would be noise in every player's console
   forever, and a throw would take the game down over a typo in a burger. Call
   them from a headless test, or from window.__mk.debug().
   ════════════════════════════════════════════════════════════════════════════ */

/**
 * 🔴 THE FOOD-PRINTER GUARD. Run this after ANY change to SUPPLY_RECIPES,
 * RECIPES.steps or CONVOY_FOOD_PER_DISH. Both walls must hold — see ECON.
 * → { ok, perDish, shippableMin, anyMin, worst }
 */
export function convoyGuardOk() {
  let shipMin = Infinity, anyMin = Infinity, worst = null;
  for (const r of RECIPES) {
    if (r.foodCost < anyMin) { anyMin = r.foodCost; worst = r.id; }
    if (r.ship && r.foodCost < shipMin) shipMin = r.foodCost;
  }
  const perDish = ECON.CONVOY_FOOD_PER_DISH;
  return {
    ok: perDish < shipMin && perDish < anyMin,
    perDish,
    shippableMin: shipMin,
    anyMin,
    worst,
  };
}

/**
 * Catalogue integrity. Returns an array of human-readable problem strings —
 * EMPTY means healthy. Deliberately returns rather than throws so a test can
 * print all twelve problems at once instead of the first one.
 */
export function assertDataSane() {
  const bad = [];
  const seen = Object.create(null);

  // ── ids unique across every table ──
  const tables = [['INGREDIENTS', INGREDIENTS], ['RECIPES', RECIPES], ['STATIONS', STATIONS],
                  ['SUPPLY_RECIPES', SUPPLY_RECIPES], ['UPGRADES', UPGRADES],
                  ['CUSTOMERS', CUSTOMERS], ['CARS', CARS], ['CONVOY_TIERS', CONVOY_TIERS]];
  for (const [name, rows] of tables) {
    const local = Object.create(null);
    for (const row of rows) {
      if (!row || !row.id) { bad.push(name + ': a row has no id'); continue; }
      if (local[row.id]) bad.push(name + ': duplicate id ' + row.id);
      local[row.id] = 1;
      seen[name + ':' + row.id] = 1;
    }
  }

  // ── the CONTRACT-FIXED vocabulary must all still be here, spelled right ──
  const FIXED_ING = 'dough sauce cheese tomato pepperoni patty chicken bun lettuce onion pickle sausage potato syrup milk'.split(' ');
  const FIXED_REC = 'pizzaMargherita pizzaPepperoni burgerClassic burgerDouble chickenSandwich hotDog fries soda shake'.split(' ');
  const FIXED_STA = 'oven griddle fryer assembly drinks'.split(' ');
  for (const id of FIXED_ING) if (!_ING_BY_ID[id])     bad.push('CONTRACT ingredient missing: ' + id);
  for (const id of FIXED_REC) if (!_RECIPE_BY_ID[id])  bad.push('CONTRACT recipe missing: ' + id);
  for (const id of FIXED_STA) if (!_STATION_BY_ID[id]) bad.push('CONTRACT station missing: ' + id);

  // ── every ingredient is stockable; every supply outputs a real ingredient ──
  for (const ing of INGREDIENTS) {
    if (!_SUPPLY_BY_ING[ing.id]) bad.push('ingredient has no SUPPLY_RECIPE: ' + ing.id);
    if (!_SHELF_BY_ID[ing.shelf]) bad.push('ingredient has unknown shelf: ' + ing.id);
    if (ing.prep && !_STATION_BY_ID[ing.prep]) bad.push('ingredient has unknown prep station: ' + ing.id);
  }
  // 🔴 cost grammar: the 14 live ids + 'cinder'. Anything else must be rejected
  //    by buySupply, so it must never exist here in the first place.
  const LIVE = 'food ammo water medicine energyDrink supplies metal fuel corruptedEssence memoryShards dna wood stone cloth'.split(' ');
  const okCost = (dict, where) => {
    let legs = 0;
    for (const k in (dict || {})) {
      legs++;
      if (k !== 'cinder' && LIVE.indexOf(k) === -1) bad.push(where + ': illegal cost key "' + k + '"');
      if (!(dict[k] > 0)) bad.push(where + ': non-positive cost ' + k);
    }
    if (!legs) bad.push(where + ': empty cost');
  };
  for (const s of SUPPLY_RECIPES) {
    okCost(s.cost, 'SUPPLY_RECIPES ' + s.id);
    if (!_ING_BY_ID[s.out.ing]) bad.push('SUPPLY_RECIPES ' + s.id + ': unknown out.ing ' + s.out.ing);
    if (!(s.out.qty > 0))       bad.push('SUPPLY_RECIPES ' + s.id + ': out.qty must be > 0');
  }
  for (const u of UPGRADES) {
    okCost(u.cost, 'UPGRADES ' + u.id);
    if (u.requires && !_UPG_BY_ID[u.requires]) bad.push('UPGRADES ' + u.id + ': unknown requires ' + u.requires);
    if (u.effect && u.effect.station && !_STATION_BY_ID[u.effect.station]) bad.push('UPGRADES ' + u.id + ': unknown station');
    if (u.requires && (_UPG_BY_ID[u.requires].minLevel || 1) > (u.minLevel || 1)) bad.push('UPGRADES ' + u.id + ': unlocks before its prerequisite');
  }

  // ── recipes ──
  for (const r of RECIPES) {
    if (!_STATION_BY_ID[r.station]) bad.push('RECIPES ' + r.id + ': unknown station ' + r.station);
    if (!MENU_CATS.some(c => c.id === r.cat)) bad.push('RECIPES ' + r.id + ': unknown cat ' + r.cat);
    if (!r.steps || !r.steps.length) bad.push('RECIPES ' + r.id + ': no steps');
    if (r.burnMs !== r.doneWindowMs) bad.push('RECIPES ' + r.id + ': burnMs must equal doneWindowMs');
    for (const s of (r.steps || [])) {
      if (!_ING_BY_ID[s.ing]) bad.push('RECIPES ' + r.id + ': unknown ingredient ' + s.ing);
      if (!(s.qty > 0))       bad.push('RECIPES ' + r.id + ': step qty must be > 0 (' + s.ing + ')');
    }
    // 🔴 A recipe that unlocks before the shop will sell its ingredients is a
    //    dead menu row: it shows as available and cannot be cooked, ever.
    for (const id in r.needs) {
      const ing = _ING_BY_ID[id];
      if (ing && ing.minLevel > (r.minLevel || 1)) {
        bad.push('RECIPES ' + r.id + ': needs ' + id + ' (L' + ing.minLevel + ') but unlocks at L' + r.minLevel);
      }
    }
    if (!(r.basePrice > 0)) bad.push('RECIPES ' + r.id + ': basePrice must be > 0');
    if (!(r.cookMs > 0) || !(r.doneWindowMs > 0)) bad.push('RECIPES ' + r.id + ': bad timing');
  }

  // ── the grubstake must actually cook the day-one dish ──
  const day1 = RECIPES.filter(r => (r.minLevel || 1) === 1);
  if (!day1.length) bad.push('no level-1 recipe: a new player has nothing to cook');
  for (const r of day1) {
    for (const id in r.needs) {
      if (!(ECON.START_PANTRY[id] >= r.needs[id])) bad.push('START_PANTRY cannot cook ' + r.id + ' (missing ' + id + ')');
    }
  }

  // ── the day clock must be self-consistent ──
  const hours = ECON.CLOSE_HOUR - ECON.OPEN_HOUR;
  if (hours <= 0) bad.push('ECON: CLOSE_HOUR must be after OPEN_HOUR');
  if (ECON.HOUR_MS !== Math.round(ECON.DAY_MS / hours)) bad.push('ECON: HOUR_MS !== DAY_MS / hours');
  if (ECON.RUSH_CURVE.length !== hours) bad.push('ECON: RUSH_CURVE should have one entry per open hour');

  // ── tip weights are a blend, not a stack ──
  const tw = ECON.TIP_PATIENCE_W + ECON.TIP_QUALITY_W + ECON.TIP_POP_W;
  if (Math.abs(tw - 1) > 0.001) bad.push('ECON: tip weights must sum to 1 (got ' + tw + ')');

  // ── 🔴 the food printer ──
  const g = convoyGuardOk();
  if (!g.ok) bad.push('🔴 CONVOY_FOOD_PER_DISH (' + g.perDish + ') is not below the cheapest dish food cost (shippable ' + g.shippableMin + ', any ' + g.anyMin + ' via ' + g.worst + ') — THE KITCHEN IS A FOOD PRINTER');

  return bad;
}

/* One flat object for window.__mk.debug() and for headless tests, so a test
   imports one name instead of nineteen. Not used by the sim. */
export const DATA = {
  INGREDIENTS, RECIPES, STATIONS, SUPPLY_RECIPES, SHELVES, MENU_CATS,
  CUSTOMERS, CARS, CONVOY_TIERS, UPGRADES, ECON, DAY_NAMES, POP_FACES,
};
