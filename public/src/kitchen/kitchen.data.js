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
   fishing → food) and by battle salvage. The CORE supply lines turn them into
   pantry stock.
   ⚠ AND THERE IS EXACTLY ONE OTHER DOOR, ADDED DELIBERATELY AND BOUNDED HARD:
     the SKIP BIN (§🗑, below) sells a subset of the pantry for Cinder alone, so
     a player whose ledger is empty is never locked out of their own kitchen.
     It is a FLOOR, not a bypass — it has no meat counter, it is dearer per unit
     than the real thing, and the dishes it can make are the cheap half of the
     board. Read that block before you touch either table; three rounds of this
     feature shipped a dead end and the fourth nearly shipped a Cinder printer
     instead.

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
   📦 _SUPPLY_CORE — live ledger → pantry. THE RESTOCK COUNTER.
   ----------------------------------------------------------------------------
   ⚠ THIS IS THE CORE HALF OF THE COUNTER, NOT ALL OF IT. The exported
     `SUPPLY_RECIPES` is this table plus the derived skip-bin lines (§🗑 THE SKIP
     BIN, immediately below). Everything downstream — buySupply(), the supplies
     sheet, unlocksAt() — reads the export and therefore sees both. This half is
     private because `INGREDIENTS[].batch` and `INGREDIENTS[].foodPerUnit` must
     come from THESE rows and never from a skip-bin row; see `_SUPPLY_BY_ING`.

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
const _SUPPLY_CORE = [
  // ── DRY STORE ─────────────────────────────────────────────────────────────
  { id:'sup_dough',   out:{ ing:'dough',   qty:10 }, cost:{ food:6,  water:2,          cinder:60 }, minLevel:1,  blurb:'Flour, water, a tired proofing box.' },
  { id:'sup_potato',  out:{ ing:'potato',  qty:12 }, cost:{ food:5,                    cinder:40  }, minLevel:1,  blurb:'Hydroponic spuds. Gritty, cheap, endless.' },
  { id:'sup_oil',     out:{ ing:'oil',     qty:10 }, cost:{ food:3,  fuel:2,           cinder:50  }, minLevel:2,  blurb:'Fry oil. Cut with refinery bottoms. Do not ask.' },
  { id:'sup_syrup',   out:{ ing:'syrup',   qty:10 }, cost:{ food:6,  energyDrink:2, water:2, cinder:40 }, minLevel:2, blurb:'Bottling Line concentrate. Legally a beverage.' },
  { id:'sup_coffee',  out:{ ing:'coffee',  qty:10 }, cost:{ food:5,  water:2,          cinder:80 }, minLevel:15, blurb:'Real beans. The last crate in the wasteland.' },

  // ── BREAD RACK ────────────────────────────────────────────────────────────
  { id:'sup_bun',     out:{ ing:'bun',     qty:10 }, cost:{ food:5,  supplies:1,       cinder:50  }, minLevel:1,  blurb:'Seeded, squashable, sold by the sleeve.' },
  { id:'sup_roll',    out:{ ing:'roll',    qty:10 }, cost:{ food:5,  supplies:1,       cinder:45  }, minLevel:1,  blurb:'Split-top dog rolls. The starter loaf.' },

  // ── CHILLER: PROTEIN. The expensive half of every menu. ───────────────────
  { id:'sup_patty',   out:{ ing:'patty',   qty:8  }, cost:{ food:8,  dna:2,            cinder:130 }, minLevel:1,  blurb:'Vat-grown beef, pressed at 4oz.' },
  { id:'sup_chicken', out:{ ing:'chicken', qty:8  }, cost:{ food:7,  dna:2,            cinder:120 }, minLevel:8,  blurb:'Cultured fillet. Breaded in-house.' },
  { id:'sup_sausage', out:{ ing:'sausage', qty:10 }, cost:{ food:6,  dna:1,            cinder:80 }, minLevel:1,  blurb:'Links. The first thing this kitchen ever sold.' },
  { id:'sup_bacon',   out:{ ing:'bacon',   qty:8  }, cost:{ food:6,  dna:2,            cinder:120 }, minLevel:11, blurb:'Streaky, salted, worth the markup.' },
  { id:'sup_cheese',  out:{ ing:'cheese',  qty:10 }, cost:{ food:4,  water:3, dna:1,   cinder:100 }, minLevel:1,  blurb:'Cultured curd. Melts if you are quick.' },
  { id:'sup_milk',    out:{ ing:'milk',    qty:12 }, cost:{ water:6, food:2,  dna:1,   cinder:48 }, minLevel:9, blurb:'Tank milk. Cold chain holds, mostly.' },
  { id:'sup_mayo',    out:{ ing:'mayo',    qty:12 }, cost:{ food:3,  dna:1,            cinder:48  }, minLevel:8,  blurb:'Emulsion. Keep it under the counter light.' },

  // ── FRESH RACK ────────────────────────────────────────────────────────────
  { id:'sup_lettuce', out:{ ing:'lettuce', qty:10 }, cost:{ food:3,  water:2,          cinder:45  }, minLevel:1,  blurb:'Racked greens, straight off the Hydroponics Bay.' },
  { id:'sup_tomato',  out:{ ing:'tomato',  qty:10 }, cost:{ food:4,                    cinder:50  }, minLevel:1,  blurb:'Sliced thin so one crate goes further.' },
  { id:'sup_onion',   out:{ ing:'onion',   qty:12 }, cost:{ food:3,                    cinder:36  }, minLevel:1,  blurb:'Red rings. Cheapest topping on the board.' },
  { id:'sup_slaw',    out:{ ing:'slaw',    qty:10 }, cost:{ food:3,  water:1,          cinder:45  }, minLevel:3,  blurb:'Shredded, soured, weirdly popular.' },
  /* 🍄 Mushrooms cost corruptedEssence and that is a joke with a purpose: the
     Containment Sump (production.data.js:203) is the only source, so the veggie
     pizza quietly rewards a player who built the ugliest building in their city.
     One essence per ten caps — a garnish tax, not a wall. */
  { id:'sup_mushroom',out:{ ing:'mushroom',qty:10 }, cost:{ food:4,  corruptedEssence:1, cinder:80 }, minLevel:12, blurb:'Sump-grown. Glows faintly. Sells anyway.' },

  // ── CONDIMENT LINE ────────────────────────────────────────────────────────
  { id:'sup_sauce',   out:{ ing:'sauce',   qty:12 }, cost:{ food:5,  water:1,          cinder:48  }, minLevel:1,  blurb:'Red sauce. Ladles a pizza, squeezes a burger.' },
  { id:'sup_mustard', out:{ ing:'mustard', qty:12 }, cost:{ food:2,  supplies:1,       cinder:30  }, minLevel:1,  blurb:'Yellow. Sharp. Non-negotiable on a dog.' },
  { id:'sup_pickle',  out:{ ing:'pickle',  qty:12 }, cost:{ food:3,  water:2,          cinder:48  }, minLevel:5,  blurb:'Spears, brined in the back for a week.' },
  { id:'sup_pepperoni',out:{ing:'pepperoni',qty:10}, cost:{ food:5,  dna:2,            cinder:100 }, minLevel:4, blurb:'Cured discs. The reason pizza sells.' },
  { id:'sup_chili',   out:{ ing:'chili',   qty:8  }, cost:{ food:6,  water:2,          cinder:88 }, minLevel:3,  blurb:'Yesterday’s pot, better today.' },

  // ── FREEZER ───────────────────────────────────────────────────────────────
  // Ice costs water and NOTHING ELSE — the only zero-food line in the table.
  // See the CONVOY GUARD note in ECON: it is why the cheapest dish on the menu
  // (soda) still had to be given two units of a food-costed syrup.
  { id:'sup_ice',     out:{ ing:'ice',     qty:16 }, cost:{ water:5,                   cinder:16  }, minLevel:2,  blurb:'Crushed. Melts on the pass in ninety seconds.' },
];

/* ════════════════════════════════════════════════════════════════════════════
   🗑 THE SKIP BIN — THE FLOOR UNDER THE RESOURCE ECONOMY.
   ----------------------------------------------------------------------------
   🔴🔴 THIS IS THE ANSWER TO THE FEATURE'S OLDEST BUG, AND IT IS THE THIRD
        ATTEMPT AT IT. Read the history before you retune anything here.

     Round 1: a brand-new account (gems 0, salvage {}, pantry {}) opened the
       kitchen and the FIRST tap returned "Not enough Food — you need 5 and have
       0." Dead end, sixty seconds in.
     Round 2: START_PANTRY was granted properly. The dead end moved to minute 5,
       because 120 units is 21 dishes against a 51-ticket day and all 25 core
       supply lines cost a live resource a new account holds ZERO of. The player
       got a good five minutes and then hit the SAME SENTENCE.
     Round 3 (this): the grubstake is sized against a whole shift (see
       ECON.START_PANTRY) AND there is a route back that never closes.

   🔴 WHY THIS IS NOT "BUY EVERYTHING WITH CINDER", WHICH WOULD BE WORSE THAN
      THE SOFT LOCK. The player asked for a kitchen fed by what their businesses,
      their city and their battles produce. If Cinder bought the whole pantry,
      that request would be decorative and we would have failed it at a deeper
      level than a dead end. So the skip bin is a FLOOR, not a bypass, and it is
      floored in three independent ways, every one of them checked in
      assertDataSane():

      1. 🍽 IT HAS NO MEAT COUNTER AND NO SPECIALITIES. It stocks bread, dry
         store, veg, condiments, ice, fry oil and scrap links — and NOT `patty`,
         `chicken`, `bacon`, `mayo`, `milk`, `pepperoni`, `mushroom` or
         `coffee`. Those are the Chiller's prime lines and the exotics, and they
         are the city's. Which dishes that leaves cookable is a DERIVED fact,
         not a list anybody types, and it comes out as SEVEN OF NINETEEN: the
         Hot Dog, the Slaw Dog, the Margherita, Fries, the Side Salad, Onion
         Rings and a Fountain Soda. What it does NOT leave you is EVERY BURGER,
         three of the four pizzas, the Chili Dog, the nuggets, the chili cheese
         fries, the shake and the iced coffee. Measured over the whole menu, the
         dishes the bin can make average 54 Cinder and the ones it cannot
         average 109. YOUR CITY IS WORTH 2.0× A DISH. That is the sentence the
         whole design turns on, and it is a number, not a mood.
         Its SHAPE matters as much as its size: the bin covers 2 of the 3 dishes
         on a level-1 menu and 7 of the 19 on a level-40 one, so it is most of a
         beginner's kitchen and a minority of a grown one. It keeps the doors
         open; it never grows the business.
      2. 💸 IT CHARGES YOU FOR WHAT YOUR CITY WOULD HAVE PUT IN FREE. The Cinder
         price is the core line's own Cinder leg PLUS a per-unit surcharge for
         every live resource that line would have eaten. It lands 1.16×–1.63×
         the Cinder-per-unit of the core line, weighted so the surcharge is
         heaviest exactly where the city matters most (`dna` 30 against `food`
         2 — a scrap frank costs half again what a farmed one does, and that is
         the Gene Vault talking). You are not saving money by skipping your
         city; you are paying a stranger for it.
         ⚠ THE SURCHARGE TABLE IS NOT A MARKET PRICE AND MUST NOT BE READ AS
           ONE. The first draft used the game's own cold-storage valuations
           (index.html:195218 — food 4, water 6, dna 42) on the grounds that
           borrowing a real number beats inventing one. Measured, that is 27–83%
           of the SALE PRICE of the cheap end of this menu, and it put the
           Fountain Soda, the Side Salad and the Classic Burger UNDERWATER on
           scraps: a stranded player cooking them went backwards. So the table
           is derived from the constraint instead — ordered by the game's
           relative valuation (dna ≫ fuel > energyDrink > supplies > water ≈
           food), scaled until every dish the bin can make clears the WORST pay
           multipliers the game can hand out. assertDataSane() is what holds it
           there; if you raise a number here and a dish goes underwater, it
           tells you which one.
      3. 📦 HALF A CRATE AT A TIME. SALVAGE_BATCH_PCT halves `out.qty`, so the
         same restock is twice the taps and twice the trips. Friction, not
         economy — but it is the part the player FEELS, and feeling it is what
         sends them to the city builder.

   ⚠ AND THE ONE THAT NEARLY GOT MISSED: A CINDER-ONLY INGREDIENT PATH OPENS A
     CINDER → FOOD PRINTER THROUGH THE CONVOY. A dish bought out of the skip bin
     costs ZERO live `food`, and a claimed convoy pays CONVOY_FOOD_PER_DISH units
     of `food` per dish. convoyGuardOk()'s original wall compares that payout
     against `recipe.foodCost`, which is computed from the CORE lines and is
     therefore blind to this route entirely. The wall still holds — a skip-bin
     hot dog costs 21.4 Cinder to deliver 1 food that the game itself values at 4
     (ECON.FOOD_RETAIL_CINDER), which is five times retail for a twenty-minute
     round trip capped at three vans of twelve — but it holds by
     arithmetic nobody had written down. convoyGuardOk() now checks that second,
     Cinder-denominated wall explicitly (ECON.CONVOY_CINDER_GUARD_MULT). If you
     ever make a salvage line cheap, that check is what stops you.

   ⚠ THE LINES ARE DERIVED, NOT TYPED. Same rule as INGREDIENTS[].batch: two
     hand-kept copies of one price diverge, and this one would diverge silently
     in the direction of "the scrap dealer is cheaper than the farm", which is
     the exact failure this whole block exists to prevent. Retune the KNOBS.
   ════════════════════════════════════════════════════════════════════════════ */
const _SALVAGE = {
  /* 🔴 WHAT THE BIN DOES **NOT** HAVE. Stated as an exclusion, not a list of
     inclusions, and that is deliberate: an inclusion list silently fails to
     cover a NEW ingredient (the floor shrinks and nobody notices), while an
     exclusion list silently covers one (which assertDataSane's share and value
     checks catch immediately). Fail towards the loud direction.
     These eight are the Chiller's prime lines and the exotics — the things a
     scrapyard plausibly cannot get and a city plausibly makes. Everything else
     is bread, dry store, veg, condiments, ice, fry oil and scrap links. */
  notStocked: ['patty', 'chicken', 'bacon', 'mayo', 'milk', 'pepperoni', 'mushroom', 'coffee',
    /* ⚠ `chili` IS HERE FOR AN ECONOMIC REASON, NOT A FLAVOUR ONE, AND THE
       CHECK IS WHAT PUT IT HERE. It is a prepared item and the priciest
       condiment on the board (11 Cinder/unit), and the Chili Dog carries two of
       them on top of a frank and a handful of cheese against a 44% gross margin
       — the second-thinnest on the whole menu. With chili in the bin,
       assertDataSane() reported "THE FLOOR IS UNDERWATER: chiliDog costs 62.1
       Cinder against a worst-case payout of 61.2", i.e. a stranded player
       cooking the dish would go backwards by 0.9 Cinder and nothing on screen
       would say so. The alternative fixes were both worse: softening the `dna`
       surcharge weakens the one line that carries the premise, and raising the
       Chili Dog's price to paper over it moves a live economy number to satisfy
       a check. The pot is the kitchen's, not the scrapyard's. */
    'chili'],
  /* 🔴 THE SURCHARGE PER UNIT OF LIVE RESOURCE THE BIN SAVES YOU. NOT a market
     price — see the long note above on why the cold-storage valuations were
     tried and put half the cheap menu underwater. These are ORDERED by the
     game's own relative valuation and SCALED by the floor invariant: every dish
     the bin can make must still pay at POP_PAY_FLOOR × RUSH_PAY_MIN. The
     ordering is what carries the premise (a scrap frank costs 1.52× a farmed
     one because of the `dna` in it; a scrap tomato only 1.16×), and the scale is
     what stops the floor being a slower dead end. */
  resCinder: { food: 2, water: 2, supplies: 4, dna: 30, energyDrink: 4, fuel: 8, corruptedEssence: 25,
               metal: 4, ammo: 5, medicine: 12, memoryShards: 50, wood: 2, stone: 2, cloth: 3 },
  /* ⚠ THERE IS DELIBERATELY NO SEPARATE "dealer's markup" KNOB, AND THE FIRST
     DRAFT HAD ONE. At 1.10 it did two jobs badly: the surcharge is already the
     penalty, and stacking a flat 10% on top pushed the Hot Dog — the cheapest
     thing a stranded player can cook — to within 0.4 Cinder of losing money at
     the worst pay multipliers the game can hand out. A floor that can be
     underwater is not a floor. One knob per idea: `resCinder` is the penalty and
     `batchPct` is the friction, and both are visible in what they do. */
  batchPct: 0.5,     // half a crate
  minBatch: 3,       // …but never so small the row is a joke
  minLevel: 1,       // 🔴 open on the first shift. A floor you unlock is not one.
};

/** One skip-bin line derived from a core line. Pure; no side effects. */
function _salvageLine(core) {
  const qty = Math.max(_SALVAGE.minBatch, Math.round((core.out.qty | 0) * _SALVAGE.batchPct));
  let perUnit = ((core.cost && core.cost.cinder) || 0) / Math.max(1, core.out.qty);
  for (const key in (core.cost || {})) {
    if (key === 'cinder') continue;
    perUnit += (core.cost[key] * (_SALVAGE.resCinder[key] || 0)) / Math.max(1, core.out.qty);
  }
  return {
    id: 'sal_' + core.out.ing,
    out: { ing: core.out.ing, qty },
    cost: { cinder: Math.ceil(perUnit * qty) },
    minLevel: _SALVAGE.minLevel,
    /* 🔴 THE TWO FIELDS EVERY OTHER FILE NEEDS. `kind` lets the renderer group
       these under one heading instead of doubling the length of a 25-row sheet
       on a 360px phone; `salvageOf` points back at the core line so a row can
       say "or bring your own" next to the real price. Neither is read by the
       sim — buySupply() only ever looks at out/cost/minLevel — so a renderer
       that ignores both still works, it just reads worse. */
    kind: 'salvage',
    salvageOf: core.id,
    blurb: 'Scrap-dealer stock. Half a crate, and you pay for what your city would have grown.',
  };
}
const _SALVAGE_LINES = _SUPPLY_CORE
  .filter((s) => _SALVAGE.notStocked.indexOf(s.out.ing) === -1)
  .map(_salvageLine);

/**
 * 📦 The restock counter the rest of the feature sees: the core lines that eat
 * the live ledger, then the skip-bin lines that do not.
 * 🔴 ORDER MATTERS AND IS LOAD-BEARING. `_SUPPLY_BY_ING` below takes the FIRST
 *    row it sees per ingredient, so the CORE line stays the canonical one — it
 *    is where INGREDIENTS[].batch and INGREDIENTS[].foodPerUnit come from, and
 *    foodPerUnit is what the whole convoy food-printer guard is built on. Put
 *    the salvage lines first and every covered ingredient silently reports a
 *    food cost of ZERO, which reads as "this dish is free" to convoyGuardOk().
 */
export const SUPPLY_RECIPES = _SUPPLY_CORE.concat(_SALVAGE_LINES);

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
   point of the upgrade ladder is that a griddle grows from 2 lanes to 5, and a
   sim that sized its slot array off the base constant would buy the upgrade,
   charge the Cinder and change nothing. (That exact shape of bug — money taken,
   effect silently dropped — is why every bridge mutator returns a boolean.)

   🔴🔴 WHY EVERY STATION BUT THE GRIDDLE SHIPS WITH **ONE** SLOT, AND WHY IT
        MUST STAY THAT WAY. The first pass gave all five stations 2 slots. Read
        as a table that looks generous and reasonable. MEASURED, it was the
        single worst number in the feature: 5 × 2 = 10 slots ≈ 50 dishes per
        in-game hour against a measured peak demand of ~28, so a level-12 stock
        kitchen ran the whole dinner rush at 59% occupancy and a headless bot
        could not lose a shift AT ANY reaction lag from 0 to 20 seconds. The
        ECON header's own wall model (below) counted the griddle's 2 slots and
        nothing else — the file believed it shipped 15 dishes/hour of capacity
        and actually shipped 50. Nothing burned, nothing was ever tight, and the
        entire upgrade shop sold capacity that nobody needed.
        Base is now 2 + 1 + 1 + 1 + 1 = 6 slots — 26.9 dishes/in-game-hour at
        level 12 against a 54.3 peak, and 12.3/hour against 19.6 on day one,
        when the player owns the griddle AND the deck oven (the margherita is a
        day-one dish; the fryer and fountain open at 2, the prep board at 3).
        THAT is the wall the whole design is hung off, and
        `capacityModel()` at the bottom of this file recomputes it from
        slotsFor() so it can never silently drift from the comment again.
        ⚠ AND IT NOW COUNTS THE PASS TOO. A rack is only worth what you can get
          OFF it: the same function models the plate jam and reports which of
          the two binds. A slot you cannot plate out of is not capacity.
        If you add a base slot back, run capacityModel() and look at what you
        did to `peakRatio` before you commit it.

   `speedMul` multiplies cookMs (lower = faster). Base 1; upgrades push it down.
   `upgrades` lists which UPGRADES ids point at this station, so the render can
   show "▲ 2 upgrades available" on the surface itself instead of burying them.
   ════════════════════════════════════════════════════════════════════════════ */
export const STATIONS = [
  // The griddle keeps TWO because it is the day-one station carrying two of the
  // three day-one dishes (hot dog and classic burger; the margherita bakes next
  // door). One lane would make the tutorial a queue.
  { id:'griddle',  name:'Flat-Top',   icon:'🍳', kind:'heat',    slots:2, speedMul:1, order:1,
    desc:'Two lanes. Patties, franks, fillets, toasted buns — everything that sizzles.',
    upgrades:['up_griddle2','up_griddle3','up_griddle4','up_griddle_fast','up_griddle_fast2'] },
  { id:'fryer',    name:'Fryer',      icon:'🍟', kind:'fry',     slots:1, speedMul:1, order:2,
    desc:'One basket and a timer you will learn to hate.',
    upgrades:['up_fryer2','up_fryer3','up_fryer4','up_fryer_fast','up_fryer_fast2'] },
  // ⚠ The deck oven is LIVE ON DAY ONE. It used to sit dark until level 8, which
  //    is most of why a level-1 kitchen modelled at 2 slots and 15 dishes/hour.
  { id:'oven',     name:'Deck Oven',  icon:'🔥', kind:'bake',    slots:1, speedMul:1, order:3,
    desc:'One stone deck. Slow, unforgiving, pays the best — and it blocks.',
    upgrades:['up_oven2','up_oven3','up_oven_fast','up_oven_fast2'] },
  { id:'assembly', name:'Prep Board', icon:'🔪', kind:'build',   slots:1, speedMul:1, order:4,
    desc:'Where cold builds happen and where everything gets plated.',
    upgrades:['up_board2','up_board3','up_board_fast'] },
  { id:'drinks',   name:'Fountain',   icon:'🥤', kind:'instant', slots:1, speedMul:1, order:5,
    desc:'Syrup, ice, done. The only station you can run while panicking.',
    upgrades:['up_fountain2','up_fountain3'] },
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
     Perfect window = ECON.PERFECT_MS (1,200ms), ABSOLUTE and the same on every
                   station, ceilinged at PERFECT_FRACTION of doneWindowMs. It
                   used to be the fraction alone, which made the most FORGIVING
                   dishes the most rewarding (⅓ of a soda's 40s window is a 13s
                   "perfect") and swallowed the whole human reaction band. See
                   the long note at ECON.PERFECT_MS — that one number is the
                   game's entire skill axis and it is not a per-recipe dial.

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
  /* ══════════════════════════════════════════════════════════════════════
     🔴 THE LEVEL-1 MENU IS hotDog + burgerClassic + pizzaMargherita, AND THAT
        IS THE MOST IMPORTANT LINE IN THIS FILE.
     ══════════════════════════════════════════════════════════════════════
     The player's request was a feature list, not a request for a progression
     system: "players can make pizzas, burgers, hot dogs etc… serve npcs through
     drive ways… setup shipment to send to another player's city on a convoy".
     Five things, named in two sentences.

     What shipped hid three of them behind an XP ladder. MEASURED with a
     competent auto-player through this very sim (sim3.mjs, 12-minute shifts
     back to back): burgers at 36 real minutes, the first convoy of any kind at
     48, pizza at 2 HOURS 24. The level-1 menu was one 🌭 card and eighteen
     padlocks. REF-A is a pizza game whose first interaction is a pizza; REF-B
     hands you a griddle full of patties on the tutorial screen. A player who
     just closed either of those found a hot-dog stand and a note saying come
     back after lunch.

     🔴 SO WHY IS THIS NOT JUST "MAKE EVERYTHING LEVEL 1"? Because the kitchen
     already has a scarcity gate the player DID ask for, and it is a better one:
     the 14-id live ledger. A pizza needs cheese, cheese costs `dna`, and DNA
     comes out of a Gene Vault or a Genetics Lab in the city builder. A player
     who has never built one cannot spam pizzas no matter what level they are.
     That is the wall the request describes. Stacking an XP wall on top of it
     bought nothing and cost the whole premise, because it made the first two
     hours a one-dish game whose real gate was invisible — the one dish was the
     cheapest thing on the menu.

     WHAT THE 40-LEVEL LADDER IS FOR NOW, and it is still forty levels of it:
     VARIETY (16 more recipes over levels 2–16), DIFFICULTY (demandScale, and
     every new station you have to keep an eye on), THROUGHPUT (the upgrade
     shop, 2–40) and REACH (convoy tiers at 1 / 12 / 20). The depth moved from
     "which foods exist" to "how much of them can you actually get out", which
     is what depth is in REF-A and REF-B too. assertDataSane() checks that no
     level 2..40 unlocks nothing, so this re-pacing cannot quietly become a
     collapse the next time somebody retunes a minLevel.

     ── 🌭 HOT DOGS ────────────────────────────────────────────────────────
     hotDog is still the FIRST dish — three ingredients, an 8-second cook, a
     forgiving 9-second window. It is the one you learn the rhythm on, and it
     is deliberately the cheapest thing in the grubstake so it is also the one
     you run out of first. It is no longer the only thing on the board. */
  { id:'hotDog', name:'Hot Dog', icon:'🌭', cat:'dogs', tier:1, minLevel:1, station:'griddle',
    cookMs:8000, doneWindowMs:9000, basePrice:40, xp:8, pop:1.0, ship:true,
    blurb:'A frank, a roll, a stripe of mustard. The whole business started here.',
    steps:[ { ing:'roll',    qty:1, verb:'split',  layer:'base' },
            { ing:'sausage', qty:1, verb:'sear',   layer:'fill' },
            { ing:'mustard', qty:1, verb:'stripe', layer:'top'  } ] },

  { id:'chiliDog', name:'Chili Dog', icon:'🌭', cat:'dogs', tier:2, minLevel:3, station:'griddle',
    cookMs:11000, doneWindowMs:8000, basePrice:85, xp:14, pop:1.1, ship:true,
    blurb:'Loaded, messy, and the reason the napkin dispenser is empty.',
    steps:[ { ing:'roll',    qty:1, verb:'split',   layer:'base' },
            { ing:'sausage', qty:1, verb:'sear',    layer:'fill' },
            { ing:'chili',   qty:2, verb:'spoon',   layer:'top'  },
            { ing:'cheese',  qty:1, verb:'scatter', layer:'top'  },
            { ing:'onion',   qty:1, verb:'scatter', layer:'top'  } ] },

  { id:'slawDog', name:'Slaw Dog', icon:'🌭', cat:'dogs', tier:2, minLevel:7, station:'griddle',
    cookMs:10000, doneWindowMs:8000, basePrice:70, xp:12, pop:1.05, ship:true,
    blurb:'Sour, cold, on top of hot. It should not work. It sells out.',
    steps:[ { ing:'roll',    qty:1, verb:'split',  layer:'base' },
            { ing:'sausage', qty:1, verb:'sear',   layer:'fill' },
            { ing:'slaw',    qty:2, verb:'heap',   layer:'top'  },
            { ing:'mustard', qty:1, verb:'stripe', layer:'top'  } ] },

  /* ── 🍔 BURGERS ─────────────────────────────────────────────────────────── */
  { id:'burgerClassic', name:'Classic Burger', icon:'🍔', cat:'burgers', tier:1, minLevel:1, station:'griddle',
    cookMs:12000, doneWindowMs:8000, basePrice:70, xp:12, pop:1.1, ship:true,
    blurb:'One patty, done properly. The dish the whole menu is measured against.',
    steps:[ { ing:'bun',     qty:1, verb:'toast',   layer:'base' },
            { ing:'patty',   qty:1, verb:'sear',    layer:'fill' },
            { ing:'sauce',   qty:1, verb:'squeeze', layer:'spread' },
            { ing:'lettuce', qty:1, verb:'lay',     layer:'top'  },
            { ing:'tomato',  qty:1, verb:'lay',     layer:'lid'  } ] },

  { id:'burgerDouble', name:'Double Stack', icon:'🍔', cat:'burgers', tier:2, minLevel:5, station:'griddle',
    cookMs:16000, doneWindowMs:8000, basePrice:118, xp:18, pop:1.2, ship:true,
    blurb:'Two patties. Twice the sear time, twice the chance you forget it.',
    steps:[ { ing:'bun',     qty:1, verb:'toast',   layer:'base' },
            { ing:'patty',   qty:2, verb:'sear',    layer:'fill' },
            { ing:'cheese',  qty:2, verb:'melt',    layer:'fill' },
            { ing:'pickle',  qty:2, verb:'lay',     layer:'top'  },
            { ing:'onion',   qty:1, verb:'scatter', layer:'top'  },
            { ing:'mustard', qty:1, verb:'stripe',  layer:'lid'  } ] },

  { id:'chickenSandwich', name:'Chicken Sandwich', icon:'🍗', cat:'burgers', tier:2, minLevel:8, station:'griddle',
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
     the tension the oven exists to create.
     ⚠ THE MARGHERITA IS A LEVEL-1 DISH. The old comment said it "unlocks late
     (level 8) because a player who has not internalised the done-window will
     simply burn money", and that reasoning is backwards on its own terms: the
     done window IS the skill, so the dish that teaches it hardest should be
     available on the first shift, next to a hot dog that forgives you. Burning
     your first pizza costs one pizza. Waiting two and a half hours for the
     chance to burn one costs the player. The rest of the pizza tier still
     ladders (Pepperoni 4, Garden Pie 12, Supreme 16) because those are variety,
     and variety is what a ladder is for. */
  { id:'pizzaMargherita', name:'Margherita', icon:'🍕', cat:'pizza', tier:2, minLevel:1, station:'oven',
    cookMs:24000, doneWindowMs:12000, basePrice:125, xp:22, pop:1.25, ship:true,
    blurb:'Sauce, cheese, tomato. Nowhere to hide a mistake.',
    steps:[ { ing:'dough',  qty:1, verb:'stretch', layer:'base' },
            { ing:'sauce',  qty:2, verb:'ladle',   layer:'spread' },
            { ing:'cheese', qty:2, verb:'scatter', layer:'fill' },
            { ing:'tomato', qty:1, verb:'lay',     layer:'top'  } ] },

  { id:'pizzaPepperoni', name:'Pepperoni', icon:'🍕', cat:'pizza', tier:2, minLevel:4, station:'oven',
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

  { id:'sideSalad', name:'Side Salad', icon:'🥗', cat:'sides', tier:1, minLevel:3, station:'assembly',
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

  { id:'nuggets', name:'Nuggets', icon:'🍗', cat:'sides', tier:2, minLevel:14, station:'fryer',
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
  { id:'soda', name:'Fountain Soda', icon:'🥤', cat:'drinks', tier:1, minLevel:2, station:'drinks',
    cookMs:3000, doneWindowMs:40000, basePrice:25, xp:4, pop:0.8, ship:false,
    blurb:'Syrup, ice, gas. Ninety percent of the margin in this building.',
    steps:[ { ing:'ice',   qty:2, verb:'fill',  layer:'base' },
            { ing:'syrup', qty:2, verb:'pour',  layer:'fill' } ] },

  { id:'shake', name:'Milkshake', icon:'🥛', cat:'drinks', tier:2, minLevel:9, station:'drinks',
    cookMs:6000, doneWindowMs:40000, basePrice:52, xp:8, pop:1.0, ship:false,
    blurb:'Spun thick. Melts on the pass faster than anything else you make.',
    steps:[ { ing:'milk',  qty:3, verb:'pour', layer:'base' },
            { ing:'syrup', qty:2, verb:'pour', layer:'fill' },
            { ing:'ice',   qty:1, verb:'fill', layer:'top'  } ] },

  { id:'icedCoffee', name:'Iced Coffee', icon:'☕', cat:'drinks', tier:3, minLevel:15, station:'drinks',
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
  /* 🔴 THE VAN IS A DAY-ONE TIER AND BOTH OF ITS NUMBERS MOVED FOR THE SAME
     REASON. The player's request named convoys in its own sentence — "setup
     shipment to send to another player's city on a convoy". Shipped, the van
     was minLevel 5 and a measured 48 real minutes of uninterrupted play away
     (sim3.mjs), so the Convoy tab in session one was three greyed tiers and a
     dead TRUCK LOCKED button. A pillar the player described in detail was not
     merely unfinished at level 1 — it was not present.

     ⚠ AND ITS CAPACITY WAS ARITHMETICALLY UNREACHABLE. Twelve boxes against a
     PASS_CAP of 8 meant a full van was impossible until a 34,000-Cinder heat
     lamp at level 6, with nothing on screen saying so. ECON.PASS_CAP is now 16,
     so twelve is loadable by the kitchen that owns the van. If you retune
     PASS_CAP downward, assertDataSane() will now fail on this — the check exists
     because "a cap the player cannot see is a cap they read as a bug".
     ⚠ THIS SENTENCE SAID "the pass is now 14" FOR A WHOLE ROUND AFTER PASS_CAP
       LANDED ON 16. Nothing broke (16 ≥ 12 as surely as 14 ≥ 12) which is
       exactly why it survived review — a stale number in a load-bearing comment
       is invisible until the next tuner trusts it and derives 12 from it. The
       cap is named, not copied, for that reason.

     ⚠ TRANSIT DROPPED 30 → 20 MINUTES, and the old comment's reasoning for the
     30-minute floor was wrong about which number is the guard. A short convoy
     is not an exploit: CONVOY_FOOD_PER_DISH (1) sits below the food cost of the
     cheapest dish that can ride one (hot dog, 1.267), so a round trip DESTROYS
     value no matter how fast it runs — that is the guard, and convoyGuardOk()
     is what proves it. What 30 minutes actually bought was a first session in
     which the player dispatches a truck and never sees it arrive. 20 minutes
     closes the loop inside one sitting and is still, unmistakably, logistics.
     ECON.CONVOY_MIN_TRANSIT_MS is the floor that keeps it from becoming a
     vending machine, and assertDataSane() enforces it. */
  { id:'van',   name:'Delivery Van', icon:'🚐', capacity:12,  transitMs:20 * 60000,  feePct:0.10, minLevel:1,  blurb:'Twelve boxes and a prayer. Twenty minutes on the road.' },
  { id:'truck', name:'Box Truck',    icon:'🚚', capacity:40,  transitMs:2  * 3600000, feePct:0.08, minLevel:12, blurb:'Forty boxes, two hours, proper insulation.' },
  { id:'rig',   name:'Road Train',   icon:'🛻', capacity:120, transitMs:6  * 3600000, feePct:0.06, minLevel:20, blurb:'A hundred and twenty. Six hours. Cheapest per box.' },
];

/* ════════════════════════════════════════════════════════════════════════════
   ⭐ UPGRADES — bought with Cinder (+ a little hardware). The difficulty answer.
   ----------------------------------------------------------------------------
   🔴 THE SHIFT CURVE IS DESIGNED AROUND THESE. Read ECON.RUSH_CURVE: the day
      peaks at 2.10× at lunch and 2.50× at the dinner rush. A stock kitchen —
      2 griddle lanes, ONE basket, ONE deck, ONE board, ONE fountain, a 4-car
      lane — can hold the opening hours and CANNOT hold 13:00, and is buried by
      20:00. That is not a tuning accident, it is the entire progression: the
      rush is the wall, and these are the ladder over it.
      If you retune RUSH_CURVE, retune these together or the wall moves, and
      re-run capacityModel() — it prints demand vs capacity per in-game hour and
      is the only honest way to know where the wall actually landed.

   ⚠ CAPACITY UPGRADES ARE PRICED AGAINST THE SLOT THEY ADD, NOT AGAINST FEEL.
      A slot is worth roughly 60s ÷ meanCookMs dishes per in-game hour ≈ 5, so
      the Nth slot on a station is priced steeply because the player's ATTENTION,
      not the rack, becomes the limit past about eight live slots. The late tier
      (19+) is deliberately expensive enough that a level-30 kitchen is a set of
      CHOICES rather than a shopping list you finish.

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
  /* ⚠ passAdd DROPPED 4 → 2 AND THAT IS NOT A NERF. The base pass went 8 → 14
     (see ECON.PASS_CAP for the measurement that forced it), so the ladder now
     lands 14 → 16 → 18 → 20 instead of 8 → 12 → 16. What the lamp is really
     sold on is `freshMul`: two more plates and a MUCH longer window to sell
     them in. The plate count was doing the work only because the base pass was
     below the deadlock point, which is a bug the shop should not be selling the
     cure for. */
  { id:'up_heatlamp', name:'Heat Lamp Pass', icon:'💡', minLevel:6, requires:null,
    cost:{ cinder:34000,  metal:20, fuel:14 }, effect:{ passAdd:2, freshMul:1.6 },
    blurb:'Two more plates on the pass — and they stay sellable far longer.' },
  { id:'up_walkin',   name:'Walk-In Cooler', icon:'🚪', minLevel:8, requires:null,
    cost:{ cinder:58000,  metal:44, supplies:26 }, effect:{ pantryAdd:400 },
    blurb:'+400 units of pantry. Restock twice a shift instead of four times.' },
  { id:'up_walkin2',  name:'Cold Room', icon:'🧊', minLevel:15, requires:'up_walkin',
    cost:{ cinder:140000, metal:95, supplies:60, stone:40 }, effect:{ pantryAdd:700 },
    blurb:'+700 more. Buy the week, not the hour.' },

  // ── REPUTATION & LOGISTICS ────────────────────────────────────────────────
  { id:'up_signage',  name:'Roadside Sign', icon:'🪧', minLevel:12, requires:null,
    cost:{ cinder:82000,  metal:50, wood:60, cloth:20 }, effect:{ popGainMul:1.35 },
    blurb:'Word of mouth, but faster. Popularity climbs 35% quicker.' },
  { id:'up_truckbay', name:'Loading Bay', icon:'🚛', minLevel:16, requires:null,
    cost:{ cinder:210000, metal:130, stone:90, supplies:55 }, effect:{ convoyCapMul:1.5, convoyFeeMul:0.85 },
    blurb:'Half again the load per convoy and 15% off the freight fee.' },

  /* ── THE LATE SHIFT (18–35) ───────────────────────────────────────────────
     ⚠ These exist because unlocksAt() came back EMPTY for levels 19, 21 and
     23–35 and an empty level-up is the moment a player decides the game is
     over. Seventeen consecutive blank "LEVEL UP!" toasts is not a difficulty
     curve, it is a credits roll with a progress bar on it.

     🔴 THE LOOP IS NOW A TEST, NOT A REQUEST — AND THE TEST'S OWN EXEMPTION
     WAS THE NEXT HOLE. The version before this said assertDataSane() walks
     1..MAX_LEVEL−5 and called the top five levels "the trophy for finishing the
     ladder". What shipped behind that sentence was four consecutive blank
     LEVEL UP toasts at 36, 37, 38 and 39, plus a fifth at 20. The exemption was
     not a design decision; it was the hole wearing a comment as a hat.
     assertDataSane() now walks 2..MAX_LEVEL with nothing exempt, the Road Train
     fills 20, and the four rungs below the capstone fill 36–39.

     WHAT THE LATE TIER IS FOR: past about eight live slots the bottleneck stops
     being the rack and becomes the player's two thumbs, so these deliberately
     stop being "more slots" and turn into throughput (speed kits), reach
     (lanes, pass, pantry) and money (reputation, tips, freight). A level-30
     kitchen should be a set of CHOICES, not a shopping list you finish. */
  { id:'up_fryer3',  name:'Third Basket', icon:'🍟', minLevel:18, requires:'up_fryer2',
    cost:{ cinder:165000, metal:88, fuel:45 }, effect:{ station:'fryer', slots:1 },
    blurb:'Three baskets. Sides stop being the thing that loses you tickets.' },
  { id:'up_marquee', name:'Neon Marquee', icon:'🌟', minLevel:19, requires:'up_signage',
    cost:{ cinder:260000, metal:120, cloth:60, supplies:70 }, effect:{ popGainMul:1.25, tipMul:1.15 },
    blurb:'Visible from the highway. Reputation and tips both climb.' },
  { id:'up_board3',  name:'Full Prep Line', icon:'🔪', minLevel:21, requires:'up_board2',
    cost:{ cinder:300000, metal:150, wood:90, supplies:80 }, effect:{ station:'assembly', slots:2 },
    blurb:'Four builds at once. The board stops being the bottleneck.' },

  /* ── 22–27: the last of the rack. After this, slots stop and speed starts. ─ */
  { id:'up_griddle4', name:'Fifth Griddle Lane', icon:'🍳', minLevel:22, requires:'up_griddle3',
    cost:{ cinder:340000, metal:170, supplies:95 }, effect:{ station:'griddle', slots:1 },
    blurb:'Five across. Nobody has ever run all five at once and stayed calm.' },
  { id:'up_fryer4',  name:'Fourth Basket', icon:'🍟', minLevel:23, requires:'up_fryer3',
    cost:{ cinder:380000, metal:190, fuel:95 }, effect:{ station:'fryer', slots:1 },
    blurb:'The whole side of the menu, in parallel, at last.' },
  { id:'up_oven3',   name:'Third Deck', icon:'🔥', minLevel:24, requires:'up_oven2',
    cost:{ cinder:430000, metal:210, stone:140, fuel:80 }, effect:{ station:'oven', slots:1 },
    blurb:'Three pies baking. The margin tier stops being a bottleneck.' },
  { id:'up_fountain3', name:'Bank of Fountains', icon:'🥤', minLevel:25, requires:'up_fountain2',
    cost:{ cinder:300000, metal:140, supplies:90 }, effect:{ station:'drinks', slots:1 },
    blurb:'Three cups pouring. Drinks finally stop being the forgotten item.' },
  { id:'up_lane3',   name:'Third Drive-Thru Lane', icon:'🛣️', minLevel:26, requires:'up_lane2',
    cost:{ cinder:520000, metal:260, stone:180, supplies:110 }, effect:{ laneAdd:3 },
    blurb:'Three more cars queue instead of driving past. Balks halve.' },
  { id:'up_warmrail', name:'Warming Rail', icon:'🍽️', minLevel:27, requires:'up_heatlamp',
    cost:{ cinder:410000, metal:180, fuel:90 }, effect:{ passAdd:2, freshMul:1.35 },
    blurb:'Two more plates under the lamp, and they hold longer still.' },

  /* ── 28–35: throughput, reach and money. No new slots past 26. ───────────── */
  { id:'up_walkin3', name:'Cold Store', icon:'🧊', minLevel:28, requires:'up_walkin2',
    cost:{ cinder:470000, metal:240, supplies:150, stone:100 }, effect:{ pantryAdd:1000 },
    blurb:'+1,000 units. A whole week of service in the back.' },
  { id:'up_board_fast', name:'Mise en Place', icon:'⚡', minLevel:29, requires:'up_board2',
    cost:{ cinder:390000, metal:150, wood:110, cloth:50 }, effect:{ station:'assembly', speedMul:0.78 },
    blurb:'Everything prepped, portioned, within reach. Cold builds 22% faster.' },
  { id:'up_billboard', name:'Highway Billboard', icon:'🪧', minLevel:30, requires:'up_marquee',
    cost:{ cinder:620000, metal:280, wood:200, cloth:120 }, effect:{ popGainMul:1.30, patienceMul:1.10 },
    blurb:'Seen from six miles out. They arrive already deciding to be patient.' },
  { id:'up_headset', name:'Crew Headsets', icon:'🎧', minLevel:31, requires:'up_speaker',
    cost:{ cinder:560000, metal:230, supplies:140 }, effect:{ tipMul:1.25, patienceMul:1.08 },
    blurb:'Orders taken before the car stops moving. Tips up a quarter.' },
  { id:'up_griddle_fast2', name:'Induction Flat-Top', icon:'⚡', minLevel:32, requires:'up_griddle_fast',
    cost:{ cinder:700000, metal:340, supplies:170, fuel:90 }, effect:{ station:'griddle', speedMul:0.85 },
    blurb:'Instant heat, no recovery time. Another 15% off every patty.' },
  { id:'up_truckbay2', name:'Freight Terminal', icon:'🚛', minLevel:33, requires:'up_truckbay',
    cost:{ cinder:820000, metal:400, stone:260, supplies:180 }, effect:{ convoyCapMul:1.4, convoyFeeMul:0.80 },
    blurb:'Your own dock, your own rates. Bigger loads, cheaper freight.' },
  { id:'up_fryer_fast2', name:'Vacuum Fryer', icon:'⚡', minLevel:34, requires:'up_fryer_fast',
    cost:{ cinder:760000, metal:360, fuel:200 }, effect:{ station:'fryer', speedMul:0.82 },
    blurb:'Lower temperature, shorter time, better fries. All three at once.' },
  { id:'up_oven_fast2', name:'Rotating Deck', icon:'⚡', minLevel:35, requires:'up_oven_fast',
    cost:{ cinder:900000, metal:420, stone:220, fuel:180 }, effect:{ station:'oven', speedMul:0.85 },
    blurb:'The stone turns so you do not have to. A Supreme in twenty seconds.' },

  /* ── 36–39: THE LAST FOUR RUNGS. ──────────────────────────────────────────
     🔴 THESE EXIST BECAUSE assertDataSane() NOW WALKS 2..MAX_LEVEL, NOT
        2..MAX_LEVEL−5. The old horizon exempted the top five levels as "the
        trophy for finishing the ladder", and what actually shipped behind that
        exemption was FOUR CONSECUTIVE BLANK LEVEL-UP TOASTS at 36, 37, 38 and
        39 leading into the cap — measured, not theorised. An exemption that
        launders a hole is not a design decision, it is the hole with a comment
        on it. The horizon moved; these fill what it exposed. Level 40 keeps its
        capstone and is a real unlock in its own right, so nothing is exempt now.
     They are reach and throughput, not slots: past about eight live slots the
     bottleneck is the player's two thumbs (see the LATE SHIFT note above). */
  { id:'up_lane4',    name:'Fourth Drive-Thru Lane', icon:'🛣️', minLevel:36, requires:'up_lane3',
    cost:{ cinder:980000, metal:460, stone:320, supplies:190 }, effect:{ laneAdd:3 },
    blurb:'Thirteen cars can queue. Nobody drives past a Flagship.' },
  { id:'up_warmrail2', name:'Pass Extension', icon:'🍽️', minLevel:37, requires:'up_warmrail',
    cost:{ cinder:1040000, metal:480, fuel:220 }, effect:{ passAdd:2, freshMul:1.2 },
    blurb:'Two more plates again, and the lamps that keep them honest.' },
  { id:'up_board_fast2', name:'Ghost Kitchen Line', icon:'⚡', minLevel:38, requires:'up_board_fast',
    cost:{ cinder:1150000, metal:520, wood:260, cloth:160 }, effect:{ station:'assembly', speedMul:0.85 },
    blurb:'A second board nobody sees, prepping into the first. Cold builds fly.' },
  { id:'up_fountain_fast', name:'Auto-Pour Bank', icon:'⚡', minLevel:39, requires:'up_fountain3',
    cost:{ cinder:1250000, metal:560, supplies:240 }, effect:{ station:'drinks', speedMul:0.70 },
    blurb:'Cups fill themselves. The only station you never have to think about.' },

  /* 🏆 THE CAPSTONE. Level 40 is the end of the ladder and it should land like
        one — this is the only upgrade in the table that moves three meters at
        once, and it costs more than the entire early game put together. */
  { id:'up_flagship', name:'Flagship Franchise', icon:'🏆', minLevel:40, requires:'up_billboard',
    cost:{ cinder:2000000, metal:900, stone:600, supplies:500, cloth:300 },
    effect:{ popGainMul:1.5, tipMul:1.3, convoyFeeMul:0.7 },
    blurb:'The one they put on the map. Reputation, tips and freight, all of it.' },
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
     Opening (pop 50, rush 0.55): 6000 ÷ 0.55 ≈ one arrival every 10.9s → easy.
     Lunch   (pop 50, rush 2.10): 6000 ÷ 2.10 ≈ one every 2.9s          → tight.
     Famous  (pop 95, rush 2.50): 4200 ÷ 2.50 ≈ one every 1.7s          → the
                                                       upgrade shop, or the bin.

   🔴🔴 DO NOT MODEL CAPACITY BY HAND IN THIS COMMENT. THAT IS THE BUG.
   The previous version of this paragraph modelled "~15 dishes per in-game hour"
   by counting the griddle's two slots and forgetting the other four stations.
   The file shipped TEN slots ≈ 50 dishes/in-game-hour against a measured peak
   demand of 28, so there was no wall at any hour of any day: a headless bot on a
   level-12 stock kitchen ran the 20:00 dinner rush at 59% occupancy, burned
   nothing at any reaction lag from 0 to 20 seconds, and could not lose. The
   comment was not lying about the design; it was lying about the code, which is
   worse, because it read as confirmation.
   So the model now lives in CODE — `capacityModel()` at the bottom of this file
   sums slotsFor() across STATIONS, prices a mean dish, and prints demand vs
   capacity for every in-game hour. `assertDataSane()` calls it and reports a
   problem if the busiest hour is not genuinely over capacity. Run it after ANY
   change to STATIONS.slots, RUSH_CURVE, SPAWN_BASE_MS or the recipe cook times.

   Where it lands today, COPIED FROM capacityModel()'s output, not typed from
   intent — a level-12 kitchen on a stock rack, popularity 50:
     6 usable slots · mean cook 13.4s → 26.9 dishes per in-game hour
     pass 16 plates against a jam floor of 12.5 — slack 1.02, the RACK binds
       10:00  rush 0.80 →  16.4 demanded   ratio 0.61   this is where you learn
       11:00  rush 1.36 →  27.7 demanded   ratio 1.03   exactly at the line
       13:00  rush 2.11 →  43.0 demanded   ratio 1.60   the lunch wall
       16:00  rush 1.05 →  21.5 demanded   ratio 0.80   restock, load a convoy
       19:00  rush 2.66 →  54.3 demanded   ratio 2.02   the dinner rush. Stock,
                                                        you WILL lose orders.
   And the same model at LEVEL ONE, where the player owns the griddle and the
   deck oven (the margherita is a day-one dish now — see the RECIPES header):
     3 usable slots → 12.3 dishes/hour against a 19.6 peak, ratio 1.60 — a real
     wall you can still climb with two hands, which is what a tutorial is. Note
     the shape of the first day: under the line until noon, at it through lunch,
     and genuinely over it at 19:00. You learn, then you are tested.
   That is the brief exactly: the first shift is winnable and tense, and the
   dinner rush is not survivable on a stock rack. The gap IS the upgrade shop.
   🔴 assertDataSane() now runs this over a MATRIX, not a level. Checking one
      level is how a level-3 kitchen at ratio 0.78 — no rush to answer at all —
      shipped inside a model that was reporting healthy; checking one RACK is how
      the model came to be reporting ok:false for levels 20–40 and for a maxed
      kitchen while assertDataSane() returned []. Three racks, three bands:
      STOCK at every level 1..40 (WALL_RATIO_MIN..MAX), the LEVEL-APPROPRIATE
      rack sampled across the ladder and again two levels behind the shop
      (WALL_KITTED_MIN..MAX), and the FULLY MAXED rack at popularity 100
      (WALL_MAXED_MIN..MAX, two-sided — the ladder must clear the wall AND the
      top of it must still have a rush to answer).

   ── AND WHEN YOU FALL BEHIND, IT MUST GET WORSE, NOT EASIER ──────────────
   🔴 TICKET_CAP IS NOT A DIFFICULTY VALVE. An earlier build silently discarded
   any walk-in that arrived while the board was full: no event, no penalty, no
   lost sale. The board sat pinned at the cap for 13.7% of a measured day, and
   every one of those frames was a customer THE GAME DECIDED NOT TO SEND. The
   punishment for drowning was fewer customers, which is the exact inverse of
   the feedback loop this whole file is built on. Overload must express as
   PRESSURE. It now does: a walk-in who finds a full board is a TURN-AWAY —
   ECON.POP_TURNAWAY off reputation, a `ticket:lost` the renderer toasts, and a
   mark against the day's grade. See spawnCounter() in kitchen.state.js.
   ════════════════════════════════════════════════════════════════════════════ */
export const ECON = {
  // ── TIME ────────────────────────────────────────────────────────────────
  DAY_MS: 720000,           // 12 real minutes per in-game day
  OPEN_HOUR: 10,            // service opens 10:00
  CLOSE_HOUR: 22,           // service closes 22:00 → 12 in-game hours
  HOUR_MS: 60000,           // ⚠ MUST equal DAY_MS / (CLOSE_HOUR − OPEN_HOUR).
                            //   Kept as a literal because it is read every frame
                            //   by the HUD clock; assertDataSane() checks it.
  /* 🔴 RAF CLAMP (CONTRACT §3). A backgrounded tab hands the loop a 40-SECOND
     dt. 250ms ≈ 4fps worth of sim; anything past that is DROPPED TIME.

     ⚠ THE CLAMP ALONE PROTECTED NOTHING, AND THIS COMMENT USED TO CLAIM IT DID.
     Only `shift.tMs` was advanced from the clamped step; every deadline in the
     sim — doneAt, burnAt, dueAt, madeAt, the lane's balk clocks — is an absolute
     stamp compared against `now`, which had jumped the full 40 seconds. Measured
     on one 300,000ms frame after a five-minute background stall: 2 slots burnt,
     4 tickets lost, 16.4 popularity gone, while the HUD clock sat frozen at
     15:00 because tMs had advanced 250ms. The player came back to exactly the
     dead restaurant this comment promised they would not.
     Dropping time is only honest if EVERY clock drops it. kitchen.state.js now
     computes `skew = dt − clampedStep` on a gap frame and shifts every absolute
     stamp in the kitchen forward by it, so the whole sim pauses together.
     Convoys are the one deliberate exception — they are wall-clock by CONTRACT
     §4 and must keep running while you are away. */
  MAX_DT_MS: 250,
  /* Ceiling on the RAW dt a single frame may claim before the skew above is
     computed from it. A tab resumed after a week hands the loop a number with
     nine digits in it; every stamp in the kitchen would be pushed a week into
     the future and the shift would never end. 24h is far past any real frame
     and well short of anything that can overflow a comparison. */
  GAP_MAX_MS: 86400000,
  SAVE_DEBOUNCE_MS: 5000,   // CONTRACT §5. Never per tick.

  // ── THE DAY CURVE ───────────────────────────────────────────────────────
  // One entry per in-game hour, 10:00 → 21:00. Indexed as a fraction of the day
  // and INTERPOLATED (see rushAt) so the rush ramps instead of stepping — a step
  // reads as a bug, a ramp reads as lunch arriving.
  // ⚠ THE TROUGH IS AS LOAD-BEARING AS THE PEAKS. 15:00–17:00 stays under 1.1
  //   on purpose: restocking, convoy loading and upgrade shopping all need an
  //   hour where taking your eyes off the rack is not a lost ticket. Flattening
  //   the curve to raise mean occupancy would delete the only part of the day
  //   the rest of the feature is reachable from.
  //        10   11   12    13    14    15   16   17   18    19    20    21
  RUSH_CURVE: [0.55,0.90,1.55,2.10,1.70,1.05,0.85,1.05,1.65,2.30,2.50,1.30],
  RUSH_MIN: 0.4,
  RUSH_MAX: 2.6,

  /* ── 🔴 DEMAND SCALES WITH THE SIZE OF THE OPERATION ─────────────────────
     A one-item hot-dog stand with two griddle lanes does not draw the same
     crowd as a five-station kitchen with a lit menu board, and the first build
     assumed it did. When the difficulty wall was finally made real (see the
     header), that assumption bit immediately: day one — ONE recipe, ONE station,
     a hard capacity of 15 dishes per in-game hour — was measured against a peak
     demand of 49, a 3.3× wall on the tutorial. Every bot at every human tap rate
     finished the first shift on a C with popularity in the teens. "Winnable and
     tense" is the brief; that was neither.

     So the day curve is multiplied by a scale that grows with level. It is NOT
     a difficulty ramp bolted on for pacing — it tracks the thing that actually
     changes: at L1 you cook on one station, the fryer opens at L2, drinks at L3,
     the prep board at L5 and the oven at L8, so usable stock capacity roughly
     doubles over those levels and demand doubles with it. Past DEMAND_FULL_LEVEL
     it keeps creeping, slowly, so that a maxed rack still has a rush to answer —
     otherwise the last fifteen levels of upgrades buy comfort nobody needs.

     🔴 IT IS APPLIED IN `rushNow()` IN kitchen.state.js, WHICH WRITES
        `K.shift.rush`, AND drivethru.js READS THAT FIELD. That is the whole
        reason it lives on the rush and not inside spawnIntervalMs(): the lane
        and the counter are two separate spawners in two different files, and
        scaling the number they SHARE is the only way to be certain they cannot
        disagree about how busy the restaurant is. Putting it in
        spawnIntervalMs() would have needed a `level` argument drivethru.js does
        not have and cannot be made to pass without editing someone else's file. */
  /* ⚠ DEMAND_FULL_LEVEL DROPPED 10 → 3, AND IT IS NOT A DIFFICULTY CHANGE — IT
     IS THE SAME RULE APPLIED TO THE NEW MENU. This ramp was never a pacing dial;
     it tracks HOW MANY STATIONS THE PLAYER CAN ACTUALLY COOK ON, and the menu
     retune moved that. It used to be: griddle at L1, fryer L2, drinks L3, board
     L5, oven L8 — capacity doubling over ten levels, so demand doubled over ten
     levels. It is now: griddle AND oven at L1 (the margherita is a day-one
     dish), fryer and fountain at L2, prep board at L3. The whole rack is live by
     level 3, so the ramp finishes at level 3. Leaving it at 10 would have left
     levels 3–9 with a rack the town had no reason to fill — measured, ratio 0.78
     at level 3, which capacityModel() now reports as "no rush to answer".
     🔴 RE-DERIVE THIS FROM capacityModel(), NOT FROM FEEL, after any menu
        retune. Walk levels 1..14 on a stock rack and require every `ok` true;
        that sweep is what produced 0.40 / 3 / 0.02. */
  DEMAND_MIN: 0.40,         // demand multiplier at level 1
  DEMAND_FULL_LEVEL: 3,     // …reaching 1.0 here, where all five stations are open
  DEMAND_LATE_PER_LEVEL: 0.012, // …and creeping past it, so the rush never ends

  // ── QUALITY (CONTRACT §8.2) ─────────────────────────────────────────────
  Q_RAW: 0.5,               // pulled before doneAt. Pays half and earns NO xp.
  Q_GOOD: 1.0,
  Q_PERFECT: 1.25,
  Q_BURNT: 0,               // pays nothing AND costs POP_BURN.
  /* ═══════════════════════════════════════════════════════════════════════
     🔴🔴 THE PERFECT WINDOW IS AN ABSOLUTE NUMBER OF MILLISECONDS, NOT A
          FRACTION, AND THAT CHANGE IS THE WHOLE SKILL AXIS OF THE GAME.
     ═══════════════════════════════════════════════════════════════════════
     WHAT SHIPPED: `perfectMs = doneWindowMs × ⅓`. Median doneWindow across the
     19 recipes is 8,000ms, so the median perfect window was 2,667ms — a player
     2.6 SECONDS late still scored PERFECT and one 4 seconds late still scored
     GOOD. The entire human reaction band fitted inside the top grade.

     MEASURED, and this is the number that made it a blocker. Eight seeds per
     tier at level 12 on a stock rack plus a heat lamp, one identical bot with
     only its reaction lag and its taps-per-second changed:
         GOD      (50 aps, 0ms lag)     popularity 74.2   grades BBBBBBBB
         EXPERT   ( 6 aps, 250ms)                  73.0   grades BBBBBBBB
         GOOD     ( 4 aps, 600ms)                  70.2   grades BBCBBBBB
         AVERAGE  ( 3 aps, 1200ms)                 70.6   grades BBBBBBCB
     3.6 popularity points between a machine and a distracted human, against a
     SEED SPREAD OF 22.8 at fixed skill. Twenty-four shifts, twenty-four B's.
     The day was not decided by the seed any more (round 2 fixed that) and it
     was not decided by the player either. It was a constant.

     🔴 WHY AN ABSOLUTE WINDOW AND NOT JUST A SMALLER FRACTION. A fraction ties
        the window to doneWindowMs, and doneWindowMs is a FORGIVENESS dial, not
        a skill dial: the soda's 40-second window exists so nobody loses a shift
        to a warm drink, and ⅙ of it is still a 6.7-second "perfect" — free
        points for parking a cup. Meanwhile the Bacon Melt's 7.5s window would
        get a 1.25s one. The fraction made the most forgiving items the most
        rewarding and the hardest items the harshest, which is backwards. An
        absolute window says one honest thing instead: FROM THE MOMENT IT GOES
        GREEN, YOU HAVE THIS LONG. Same on every station, learnable once.

     🔴 WHY 1,200ms AND NOT 1,000, WHICH SEPARATES HARDER. Phones are the main
        platform (CONTRACT §1, kitchen.css) and the player is using ONE THUMB on
        a 360px screen. Measured with the SAME bots but a jittered reaction
        (lag × U(0.55,1.45) redrawn per pan — a constant lag sitting on the
        window boundary turns any window change into a step function and tells
        you nothing about people):
            PERFECT_MS 1200 → GOD 75.0 · EXPERT 72.2 · GOOD 69.3 · AVG 42.4
            PERFECT_MS 1000 → GOD 75.0 · EXPERT 72.2 · GOOD 65.5 · AVG 35.1
        At 1,000 a 700ms reaction — a sharp human on a good day — is already
        being docked. At 1,200 the curve is monotone and the penalty starts
        where distraction starts. Below about 800ms it stops measuring attention
        and starts measuring hardware latency, and a game that grades your phone
        is not a game of skill.
        WHERE IT LANDS: reaction axis GOD→AVERAGE 32.6 popularity points against
        a fixed-skill SEED SPREAD of 16.3 (sd 5.1). It was 3.6 against 22.8. The
        player now moves the day twice as far as the dice do. Re-run
        scratchpad/r5/skill.mjs after ANY change here and require that.

     ⚠ AND THE HALF OF THE CRITIQUE THAT MEASURED OUT AT ZERO, RECORDED SO IT IS
       NOT RE-PROPOSED: the same review asked for doneWindowMs to be cut on the
       hot line (griddle/fryer → 4,500ms, oven → 7,000ms) on top of this. It was
       tried — griddle/fryer 8000→6000, oven 12000→9000, hotDog 9000→7000 — and
       measured across all five tiers it moved NOTHING in the human band: GOD
       75.0/75.0, EXPERT 72.2/72.2, AVERAGE 42.4/42.4, identical to three
       significant figures, because a player who reacts inside 2.6s never
       reaches the burn line anyway. The ONLY tier it touched was a bot at 6
       seconds of lag, whose burns doubled (35 → 74) and whose grade fell from C
       to D. That is not resolution, it is a deeper hole for the one player
       already drowning — and it costs every phone player the forgiveness that
       lets them look at the drive-thru. The cut was reverted. The done window
       is a FORGIVENESS dial; PERFECT_MS is the SKILL dial. Keep them separate.

     ⚠ RENDER MUST PAINT THIS BAND. A 1.2s window the player cannot see is not
       difficulty, it is a coin flip: the burn bar (burnPct) shows how close the
       pan is to ruin and says NOTHING about where perfect ended. The band is
       published per-recipe as `recipe.perfectMs` for exactly this reason.
     ⚠ PERFECT_FRACTION IS STILL LIVE — it is now the CEILING, not the rule. It
       stops a hypothetical 2-second done window (a future dish, an upgrade that
       shortens the window) from having a perfect band longer than the window it
       sits in. Today no recipe's window is short enough for it to bind, and
       that is fine: a guard that is not currently binding is not dead, it is a
       guard. kitchen.state.js also reads it as its NaN fallback. */
  PERFECT_MS: 1200,         // the perfect band, in ms, on every station
  PERFECT_MIN_MS: 700,      // …never squeezed below this by the ceiling below
  PERFECT_FRACTION: 1 / 3,  // ceiling: perfect may never exceed ⅓ of the window.
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
  /* 🔴 POPULARITY IS SIGNED BY QUALITY, PER UNIT, WEIGHTED BY recipe.pop.
     serveTicket() computes the mean of a per-unit score across everything in
     the ticket: a raw unit scores POP_RAW, a good one POP_SERVE, a perfect one
     POP_SERVE + POP_PERFECT_BONUS; each is multiplied by that dish's
     `recipe.pop`, and the whole thing by popGainMul(upgrades).

     WHY THIS AND NOT A FLAT PER-TICKET GAIN: with a flat gain, a bot that
     pulled all 195 dishes of a day RAW — half price, zero xp, visibly
     undercooked — finished the shift at popularity 100.0 with an S grade and a
     profit. Serving slop was the fastest route to a perfect rating. Reputation
     that only counts whether food arrived is not reputation, it is a delivery
     receipt. POP_RAW is negative and slightly larger in magnitude than
     POP_SERVE precisely so that a raw dish is not a cheap dish, it is a bad one.

     WHY THE MEAN AND NOT THE SUM: summing would make a five-item family order
     move the meter five times as far as a hot dog, which turns reputation into
     a function of order size rather than of how well you cooked. A ticket is
     one word-of-mouth event; what was IN it decides which direction it goes. */
  /* ═══════════════════════════════════════════════════════════════════════
     🔴 THE METER MUST MOVE BOTH WAYS. IT WAS A ONE-WAY RATCHET, AND FIXING
        THE RATIO ALONE TURNED IT INTO A ONE-WAY RATCHET POINTING UP.
     ═══════════════════════════════════════════════════════════════════════
     WHAT SHIPPED: POP_SERVE 0.60 against POP_LOST −3.5, plus a −1.5/day decay.
     Measured over 60 simulated days with a competent auto-player: popularity 27
     after day 1, then 0 or 1 from day 2 through day 60 while the kitchen served
     1,767 tickets. Pinned at the floor the face reads 🤬 Hated, the pay
     multiplier sits at POP_PAY_FLOOR and spawns are at their slowest — a spiral
     whose only exit is five consecutive flawless days. The old comment defended
     that as "six good tickets to undo one lost one… a symmetric reputation meter
     never moves". The instinct is right and the conclusion is the trap: a meter
     pinned at ZERO does not move either, and it has stopped being feedback.
     REF-B's popularity face is a reward you can read at a glance. Ours was a
     permanent scold.

     🔴 AND THEN THE OBVIOUS FIX FAILED IN THE OTHER DIRECTION, WHICH IS THE
        PART WORTH RECORDING. Softening the ratio (POP_SERVE 0.85 / POP_LOST
        −1.8) put the same bot at popularity 100 by day 3 and it never came
        down. The reason is a detail two comments up: serveTicket() takes the
        MEAN per-unit score across a ticket, not the sum — so a served ticket is
        worth ~1.25 REGARDLESS OF SIZE, while a lost one costs 1.8. Over a
        110-ticket day at a 25% loss rate that nets +66 on a 0..100 scale.
        THE METER SATURATED INSIDE A SINGLE DAY, IN BOTH DIRECTIONS, AT BOTH
        SETTINGS. The ratio was never the whole problem; the MAGNITUDES were
        sized as if a day were a handful of tickets, and a day is a hundred.

     THE FIX IS BOTH: a ratio a real player can beat, and magnitudes sized
     against a real day. Every number below is derived, in this order:
       1. A day is ~110 tickets. For the meter to be a REPUTATION rather than a
          scoreboard it should move ~a third of its range in a decisive day, not
          all of it. Target: ±30 points.
       2. Break-even at ~30% lost tickets — where a competent player under
          pressure actually sits, measured, not assumed.
            served × G = lost × L  at 30% ⟹ L ≈ 2.3 × G
       3. Solve for a ±30-point day: G ≈ 0.46 per PERFECT ticket, L ≈ 1.0.
     Which lands:
       POP_SERVE          0.60 → 0.10   a merely-GOOD unit
       POP_PERFECT_BONUS  0.40 → 0.36   …and what CATCHING THE WINDOW adds
       POP_LOST           −3.5 → −1.0
       POP_DECAY_PER_DAY  −1.5 → −0.6   decay exists so fame is a thing you keep
                                        doing. At −1.5 it was a second penalty
                                        on top of the first, and the clean-day
                                        bonus (−decay × 2) could not reach it on
                                        any day that lost one ticket.
       POP_BURN, POP_WAVE, POP_TURNAWAY, POP_BALK, POP_JAM, POP_JUMP: all scaled
       by the same 0.55 as POP_LOST, so every RATIO the previous rounds tuned is
       preserved exactly and only the magnitude moved.

     🔴 WHY ALMOST ALL OF THE GAIN MOVED INTO POP_PERFECT_BONUS (0.10 good vs
        0.46 perfect, a 4.6× spread). Popularity is a per-ticket meter, so it is
        structurally blind to THROUGHPUT — serving 120 tickets instead of 100
        barely shows. Quality is the only channel it can carry a skill signal
        on, so that is where the weight goes: a cook who catches the window is
        four and a half times better liked than one who lets everything coast to
        merely done. Measured across eight seeds at level 12, that is what turns
        the meter from noise into a reading of how you cooked.
     ⚠ POP_RAW stays NEGATIVE and larger in magnitude than POP_SERVE (−0.35 vs
       0.10). That is the number that stopped a raw-spamming bot scoring S, and
       softening the curve must not soften it — a raw dish is not a cheap dish,
       it is a bad one.
     ⚠ RE-MEASURE, DO NOT SPOT-TUNE. These move together with PASS_CAP: a jammed
       pass loses tickets, and lost tickets are what pinned the meter in the
       first place. Change one and re-run the 60-day auto-player AND the
       eight-seed spread. Measured after this retune, level 12, one perfect bot:
       popularity mean 74.3, sd 5.7, range 65..82 (it was mean 27.7, sd 23.0,
       range 0..69), and the 60-day curve breathes 74 → 100 → 54 → 0 → 36
       instead of sitting on the floor from day 2 onward. */
  POP_SERVE: 0.10,          // a good unit. × recipe.pop × popGainMul(upgrades)
  POP_PERFECT_BONUS: 0.36,  // extra, per unit, for the ones caught in the window
  POP_RAW: -0.35,           // 🔴 a raw unit COSTS reputation. See above.
  POP_LOST: -1.0,           // 🔴 STILL ASYMMETRIC — 2.2 perfect tickets to undo
  POP_BURN: -0.65,          //    one lost one. Just no longer six of them
  POP_WAVE: -1.1,           //    against a decay you could never out-run.
  POP_DECAY_PER_DAY: -0.6,
  /* 🔴 MEAN REVERSION — THE RECOVERY THE OLD CURVE HAD NO ROOM FOR.
     A bad week should cost a bad week, not the account. These keys say: below
     POP_REVERT_BELOW, the town's memory fades and reputation drifts back toward
     it by POP_REVERT_PER_DAY at each day roll, INSTEAD of decaying.
     ⚠ NOT A FLOOR AND NOT A GIFT: it is strictly smaller than one good day's
     service, so climbing out is still something the player does — this only
     stops the hole being infinitely deep. Above the threshold it does nothing
     at all, so a famous kitchen still decays normally.

     🔴🔴 THESE KEYS SHIPPED A WHOLE ROUND AS DEAD DATA UNDER A NINE-LINE
        COMMENT PRESENTING THEM AS THE FIX FOR THE RATCHET, AND NOTHING READ
        THEM. `grep -rn POP_REVERT public/src/` returned four hits and all four
        were in this file — three of them in the comment's own prose. The comment
        even flagged the risk ("⚠ CONSUMER: … until it reads these two keys the
        retune above carries the fix on its own") and shipped anyway, so the file
        documented a mechanic the build did not have. A comment that describes
        code that does not exist is worse than no comment: it reads as
        verification, and CLAUDE.md's rule that comments carry the WHY assumes
        the WHY is TRUE.
     🔴 SO THE READ IS NOW A FUNCTION, NOT A CONSTANT. `popDayDelta(pop, report)`
        at the bottom of this file is the ONE thing a day roll has to call, and
        it returns the whole settle — revert-or-decay plus the clean-day bonus —
        as a single signed number. Three keys can be forgotten one at a time; one
        function call cannot be half-wired. The clean-day multiplier moved in
        here at the same time, because it had been living as a literal `* 2` in
        kitchen.state.js, which is the same CLAUDE.md violation wearing a
        different hat. */
  POP_REVERT_BELOW: 30,     // popularity under this drifts back up instead of down
  POP_REVERT_PER_DAY: 2.0,  // …by this much per day roll, replacing the decay
  POP_CLEAN_DAY_MULT: 2.0,  // a day with ZERO lost tickets pays back this many
                            // days of decay. It is the only reward for the LAST
                            // ticket of a shift, which otherwise pays the same
                            // as the first.
  /* Two ways to lose custom WITHOUT losing a ticket, and they are not the same
     size because they are not the same failure.
       POP_BALK      a car reached a FULL LANE and drove past. Small: a queue out
                     the door is mostly a compliment, and drivethru.js reads this
                     key (it had been carrying it as a local fallback).
       POP_TURNAWAY  a walk-in reached a FULL BOARD and left. Four times worse,
                     because they came inside, looked at the wall of tickets you
                     have not cleared, and walked back out. It also counts in
                     `today.lost`, so it reaches gradeFor() and the day report.
                     🔴 This is the number that makes drowning compound. */
  POP_BALK: -0.14,
  POP_TURNAWAY: -0.40,

  /* ── XP / LEVEL ──────────────────────────────────────────────────────────
     xpForLevel(lv) = XP_L1×n + XP_CURVE×n²   where n = lv−1  (so level 1 = 0).

     🔴 THIS CURVE WAS 6× TOO FAST AND THE FILE DID NOT KNOW IT. The previous
     values (180 / 60) were written against a stated intent of "a good first
     shift is ~600–900 xp → level 3". Measured with a bot on a realistic human
     tap budget, day one produced 3,311–5,354 xp — five to six times the target
     — and ten twelve-minute shifts reached level 35 of 40 with 13 of the 20
     upgrades bought. Two hours of play exhausted the progression that the menu,
     the supply ladder, the convoy tiers and the whole upgrade shop are hung off.
     The mistake is instructive: the intent was written in the comment and never
     checked against the arithmetic, and the arithmetic is the part that ships.

     The values below are printed by xpForLevel(), never typed by hand:
       L2 640 · L3 1,660 · L5 4,840 · L8 12,460 · L12 27,940
       L20 77,140 · L30 173,290 · L40 306,540
     A good first shift is ~1,600–2,100 xp → level 3, and the same play at level
     12 is worth several times that, so the ladder accelerates with skill and
     kit instead of with patience. Day 10 of committed play lands around L11–13.

     ⚠ DO NOT "FIX" PACE BY CUTTING PER-DISH `xp` INSTEAD. CONVOY_XP_PER_DISH is
     sized against exactly that number (see its comment): cutting recipe xp
     silently makes shipping the strictly better play in both currencies, which
     is the trade that comment exists to prevent. Move the CURVE, not the dish. */
  XP_L1: 450,
  XP_CURVE: 190,
  MAX_LEVEL: 40,
  /* 🔴 6, NOT 15. At 15 this was 100% of a raw-spamming bot's xp — 15 × 195
     tickets = 2,925, exactly its whole score — because the bonus asks only
     "was the ticket complete and on time", which a cook who never waits for
     anything always satisfies. The completion bonus should reward attaching the
     drink to the burger, not reward never cooking either of them properly. */
  XP_TICKET_BONUS: 6,       // ticket fully filled AND on time
  XP_PERFECT_MULT: 1.5,     // xp multiplier on a 'perfect' dish (raw earns none)

  // ── THE LANE (drivethru.js) ─────────────────────────────────────────────
  LANE_CAP: 4,              // base cars queued; up_lane2 adds 3 → laneCap()
  LANE_LEN: 1.0,            // normalised lane length; car.pos runs 0 → 1
  SPAWN_BASE_MS: 8000,
  SPAWN_POP_SPAN: 4000,     // subtracted at popularity 100 → 4000ms floor
  SPAWN_JITTER: 0.25,       // ±25% so the lane never feels metronomic
  /* 🔴 THE HARD FLOOR ON ARRIVALS, AND IT IS NOW A DERIVED NUMBER. It used to be
     1400 with the note "below this nothing is playable", which is a claim about
     the PLAYER'S kitchen written without consulting it. At 1400 the busiest
     possible hour in the game — level 40, popularity 100, the 20:00 peak — asks
     for 82.7 dishes, and a FULLY KITTED kitchen tops out at 63.9 because past
     ECON.HANDS_SLOTS live slots the rack stops being the limit. The endgame was
     therefore unwinnable by construction: there was no amount of money that
     bought the last rung, which is exactly what assertDataSane()'s
     "UPGRADE LADDER DOES NOT CLEAR THE WALL" check exists to catch.
     🔴 AND ITS DERIVATION WAS ONE-SIDED, WHICH IS WHY IT LANDED A HAIR WRONG.
     2,100 was capacityModel(MAX_LEVEL, everything, 100) read backwards — the
     interval at which the hardest hour lands just inside a MAXED kitchen's
     reach — and that ignores the other end entirely. Because this floor caps
     arrivals, it also sets where the STOCK ratio plateaus from level 20 onward,
     and at 2,100 that plateau was 2.26 against WALL_RATIO_MAX 2.25: one
     hundredth past the file's own definition of "unwinnable, not hard", for
     every level from 20 to 40. The model said so; nothing was calling the model
     up there (see assertDataSane's wall matrix), so nobody heard it.
     2,250 is the interval at which BOTH ends hold: stock peaks at 2.11 at every
     level 1..40, and a fully-kitted rack at popularity 100 still clears its own
     peak at 0.85. It binds ONLY at the extreme — at level 12 on a stock rack the
     interval is 2,166ms and this floor never touches it — so it costs the early
     and middle game nothing. Re-derive it from BOTH ends, do not nudge it. */
  SPAWN_MIN_MS: 2250,       // hard floor; below this even a maxed kitchen drowns
  PATIENCE_ITEM_MS: 12000,  // added per item beyond the first
  PATIENCE_MIN_MS: 20000,
  ORDER_MAX_ITEMS: 5,
  COUNTER_SHARE: 0.35,      // fraction of tickets that walk in rather than drive

  // ── TICKETS ─────────────────────────────────────────────────────────────
  TICKET_BASE_MS: 45000,
  TICKET_ITEM_MS: 20000,    // per item beyond the first
  /* 🔴 TICKET_CAP IS A BOARD SIZE, NOT A DIFFICULTY DIAL. See the header. It
     used to be 8 and arrivals past it were silently dropped, which made the
     game EASIER the further behind you got. It is now 12 (the board scrolls)
     and an arrival that still cannot fit is charged as a turn-away:
     POP_TURNAWAY, a `ticket:lost`, and a mark on the day's grade. Raising it
     further makes the board unreadable at 360px; lowering it starts throwing
     away custom the player could have served. */
  TICKET_CAP: 12,

  /* ── THE PASS ────────────────────────────────────────────────────────────
     🔴 THE PASS IS A PLACE, NOT A PIPE, AND THAT COST A ROUND TO LEARN. In the
     first build `fillTickets()` ran every tick and moved a plated dish into the
     nearest-due ticket the instant it was plated. Measured: max pass depth 2 of
     6, MEAN PLATE AGE 0.0 SECONDS, and zero of 276 plate-frames ever crossed the
     freshness line. PASS_FRESH_MS, PASS_STALE_MULT and the 34,000-Cinder
     up_heatlamp ("passAdd:4, freshMul:1.6") were all dead constants describing a
     mechanic that could not happen. REF-A's defining image — a row of finished
     pizzas SITTING on the pass while the cook works the next order — had no
     mechanical existence at all.
     Plating and serving are now two separate decisions (see refreshReady() /
     serveTicket() in kitchen.state.js): a plated dish sits under the lamp and
     lights up the ticket's pips, and it only leaves when the player hands the
     order over. That makes all three of these numbers live, makes cooking ahead
     into the quiet hour a real (and decaying) strategy, and makes the heat lamp
     the first thing a struggling kitchen should buy.

     ═══════════════════════════════════════════════════════════════════════
     🔴🔴 PASS_CAP IS THE BINDING CONSTRAINT OF THE WHOLE SIM. 8 WAS BELOW THE
          DEADLOCK POINT AND THAT MADE THE DAY'S RESULT THE SEED'S, NOT THE
          PLAYER'S. 8 → 14.
     ═══════════════════════════════════════════════════════════════════════
     The previous note said "8, not 6" and reasoned about a Vault Family's
     five-dish order. Both halves were right and the conclusion was still three
     sizes too small, because it modelled ONE ticket and the jam is a property of
     FIVE. `refreshReady()` claims plates nearest-due-first, so with
     ORDER_MAX_ITEMS 5 the eight plates on the pass spread across four or five
     tickets that each still need one more item — and the player cannot plate
     that item, because the pass is full. That is a deadlock, not a queue.

     MEASURED, at level 12 on a stock rack with a frame-perfect bot:
       • "pass full AND hand holding a dish AND no ticket ready" held for 26.8%
         of the shift. A bot that never binned sat in it 76.7% of the day and
         finished served 35 / lost 64 / popularity 0.0 / grade D.
       • Tripling every station's slots produced a BYTE-IDENTICAL day
         (served 100, lost 30, pop 31.7, net 14,326) while the rack was full
         only 3.4% of frames. The rack was never the wall. The pass was.
       • Raising PASS_CAP alone, touching nothing else, moved popularity
         31.7 → 81.0 and served 100 → 113.
       • The only working counter — bin your way out — cost 95 of 275 dishes
         cooked. 35% waste as the price of not deadlocking.

     🔴 AND IT WAS DESTROYING THE GAME'S CLAIM TO BE A GAME OF SKILL. Ten seeds
        per configuration, one identical perfect bot:
            PASS_CAP  8 → popularity mean 27.7, sd 23.0, range 0..69
            PASS_CAP 24 → popularity mean 65.5, sd  9.2, range 51..78
        A cliff converts RNG into outcome. Eight seeds at the shipped cap moved
        the day 73 popularity points at FIXED skill, while sweeping the same bot
        from 0ms to 2000ms of reaction lag moved it 18. The noise was four times
        the signal: a 2-second-lag player on a lucky seed beat a frame-perfect
        player on an unlucky one, and neither could tell why. You cannot learn a
        shift whose grade is mostly the seed's.

     WHY 16 AND NOT 24. Two independent methods land on the same number, which
     is the only reason to trust either of them:
       • MEASURED. The waste/popularity curve was swept and it saturates:
         cap 8 → 35% waste, pop 41; cap 12 → 13%, 68.5; cap 16 → 8%, 81.4, and
         flat thereafter. Everything past 16 is comfort nobody is short of.
       • DERIVED. capacityModel() computes the jam floor from the pigeonhole —
         TICKET_CAP × (meanOrderDishes − 1) = 12 × 1.04 = 12.5 plates that can
         be stranded one-short across a full board — times PASS_HEADROOM 1.25,
         which is 15.6. 16 is the smallest integer that clears it.
     🔴 THE FIRST DRAFT OF THIS RETUNE SAID 14, ON THE MEASUREMENT ALONE, AND
        THE MODEL CAUGHT IT AT 0.90× THE FLOOR. That is the entire argument for
        making the model code instead of a paragraph: 14 "worked" in a sweep and
        was still under the worst case the dinner rush reaches.
     The pass must stay a real constraint or cooking ahead stops being a
     decision — at 16 it clears the floor by 2%, which is a wall you can feel
     and not a wall you hit. The two pass upgrades were re-sized around the new
     base (passAdd 4 → 2 each), so the ladder is 16 → 18 → 20 → 22 rather than
     8 → 12 → 16.
     🔴 capacityModel() now MODELS the pass and reports which of the two binds.
        Re-run it after touching this number; it is the check that stops this
        constraint going invisible again. */
  PASS_CAP: 16,             // plated dishes waiting; up_heatlamp adds 2
  PASS_FRESH_MS: 45000,     // × freshMul(upgrades) before a plate goes stale.
                            // Measured: the mean plate now waits ~18s to be
                            // handed over, so a 60s line almost never bit (2.5%
                            // of plate-frames). 45s puts the decay inside the
                            // window a busy cook actually operates in — it is
                            // the difference between "cooked ahead" and "cooked
                            // too far ahead", which is the decision it exists
                            // to create.
  PASS_STALE_MULT: 0.60,    // a stale plate still sells, for less
  /* 🔴 AND THEN IT GOES IN THE BIN, WHICH IS NOT FLAVOUR — IT IS THE ONLY THING
     STOPPING A SOFT LOCK. Once the pass held stock instead of passing it
     through, a plated dish outlived the customer it was cooked for: a ticket
     that times out now leaves its food on the pass (deliberately — see
     loseTicket) and nothing on the board wants it. Measured, the pass filled
     with eight orphans — a chili dog four and a half minutes old among them —
     jammed at PASS_CAP for 77% of the day, and with the pass jammed the player's
     HAND jams too, so every slot on the rack burns down behind it. There is no
     player action that can clear it and there should not have to be one: food
     that has sat under a lamp for two minutes is bin food in any real kitchen.
     ⚠ SPOILING COSTS NO POPULARITY. The customer never saw it. You already paid
     the ingredients and the slot time, and that is the whole lesson. It does
     count in `today.burnt`, because waste is waste and it should cost you the S. */
  PASS_SPOIL_MS: 100000,    // × freshMul(upgrades). ≈2× PASS_FRESH_MS: a full
                            // stale window to sell it in before it is binned.

  /* ── THE PANTRY ──────────────────────────────────────────────────────────
     🔴 "TOTAL" MEANS TOTAL. This said "TOTAL units across all ingredients" and
     was implemented PER INGREDIENT, so a bot that bought every supply line to
     refusal banked 13,044 units across 25 bins — 21.7× the documented cap, each
     bin stopping neatly at 600. A day burns ~30 units of any one ingredient, so
     600-per-bin was twenty shifts of stock: restocking stopped being a mid-shift
     decision after the first visit, and up_walkin + up_walkin2 (198,000 Cinder
     between them, "Buy the week, not the hour") bought headroom that had never
     been scarce. The cap is now summed across the whole pantry in buySupply().
     ⚠ AND 600 WAS THE WRONG TOTAL, WHICH ONLY BECAME VISIBLE ONCE IT WAS ONE.
     The number was written when it was silently per-bin. Summed, it BRICKED a
     mid-game kitchen: a level-12 menu draws on 22 of the 25 ingredients, and at
     600 total the bins settled around 27 units each with nothing left over —
     measured, the shop refused 11,000 restock attempts in a day and `ice` and
     `milk` never got bought at all, so every drink order on the board was
     permanently unfillable. The plates for the rest of those tickets then sat on
     the pass forever, the pass jammed at cap for 74% of the day and the rack
     burned down behind it. A cap that makes part of the menu impossible is not
     difficulty, it is a soft lock.
     900 is about one and a half shifts of a level-12 menu (≈130 dishes at ≈5
     units each ≈ 650 units a day), which is what "restocking is a real mid-shift
     decision" actually costs. The walk-in tiers then buy roughly one more shift
     of breathing room each.
     ⚠ A pantry filled to the cap with something you cannot cook is still
     genuinely stuck until you cook it down. That is a real — and recoverable —
     consequence of a bad restock, and it is why SUPPLY_MAX_BATCHES exists. */
  PANTRY_CAP: 1200,         // 🔴 TOTAL units across ALL ingredients. Summed in
                            //    buySupply(). Upgrades add via pantryCap().
                            //    NOTHING to do with bridge().resourceCap() —
                            //    pantry stock is not stash stock (file header).
  /* 🔴🔴 AND THEN THE TRUE TOTAL BRICKED THE KITCHEN, WHICH IS WHY THE TWO KEYS
        BELOW EXIST. Making the cap a real total was correct and it created an
        UNRECOVERABLE state: buy one ingredient to refusal and every other bin
        is permanently unbuyable. Measured — 85 packs of dog rolls put the
        pantry at 894 of 900 with roll=862, and `buySupply('sup_patty')` then
        returned CAP forever. The refusal toast advised "cook some of it down",
        which is not executable: a hot dog needs sausage as well as a roll, and
        sausage could no longer be bought. One over-eager restock, permanently
        dead kitchen, no player action available.

        A per-bin ceiling makes that arithmetically impossible rather than
        merely unlikely. PANTRY_BIN_PCT is a fraction of the TOTAL cap, so it
        scales automatically with the walk-in upgrades and can never be retuned
        out of step with them. At 0.15 of 1,200 a single bin tops out at 180
        units — six shifts of any one ingredient, generous — and it takes SEVEN
        separate bins maxed out before the total binds at all, by which point
        the player has bought roughly ten shifts of food on purpose. That is
        past "ordinary play" by any reading.
        ⚠ It is a ceiling, not a reservation: unused headroom in one bin is
        still spendable by the others. It only stops ONE bin eating everything.

        🔴 THE CAP IS STILL NOT A SUBSTITUTE FOR AN EXIT. kitchen.state.js is
        adding `dumpSupply(ingId, n)` — bin units from one bin, no refund, no
        popularity cost, the sunk purchase is the punishment. The per-bin
        ceiling means a player never NEEDS it to keep playing; the dump means a
        player who wants their headroom back can have it. Belt and braces,
        because "the preflight should have caught it" is how the 215 units in
        CONTRACT §7 went missing. */
  PANTRY_BIN_PCT: 0.15,     // max share of pantryCap() ONE ingredient may hold
  PANTRY_BIN_MIN: 60,       // …but never fewer than this many units, so a small
                            //    cap cannot make a bin unusable for a 5-unit dish
  PANTRY_LOW: 4,            // ≤ this many units fires ONE pantry:low per ingredient
  /* ⚠ 20 → 6. Twenty batches is up to 240 units in ONE tap — more than a whole
     bin's ceiling, so the "fat-fingered tap" this key exists to bound could
     still fill a bin to refusal in a single press. Six batches is 36–96 units:
     enough that stocking a shift is two or three taps rather than twelve, small
     enough that over-buying is a thing you notice happening. */
  SUPPLY_MAX_BATCHES: 6,    // per buySupply() call, so one fat-fingered tap
                            // cannot drain a player's entire food ledger

  /* ══════════════════════════════════════════════════════════════════════
     🔴🔴 THE GRUBSTAKE — A NEW KITCHEN OPENS STOCKED FOR ALL THREE NAMED FOODS.
     ══════════════════════════════════════════════════════════════════════
     The old grubstake was twelve hot dogs, sized against a level-1 menu that
     was one hot dog. It is now sized against the level-1 menu that exists:
     a hot dog, a classic burger and a margherita.

     🔴 THIS IS THE ANSWER TO THE WORST BUG IN THE FEATURE. On a real untouched
     profile the kitchen opened with `Profile.gems 0`, `Profile.salvage {}` and
     `Kitchen.pantry {}`. Tapping the flat-top → "Out of ingredients for Hot Dog
     — restock from Supplies." Tapping Supplies → "Not enough Food — you need 5
     and have 0." Dead end, no exit, first sixty seconds. A cooking game whose
     first interaction is a refusal has already lost the player, and the code
     that was supposed to prevent it could never run — `hydrate()` granted
     START_PANTRY only when the save was ABSENT, and the bridge auto-creates
     `Profile.kitchen = {}`, which is present. (That branch is kitchen.state.js's
     to fix and it is being fixed; this table is the other half — the grant has
     to be worth having when it finally fires.)

     🔴🔴 AND THEN IT WAS SIZED AGAINST A THIRD OF A DAY, WHICH MOVED THE DEAD
        END INSTEAD OF CLOSING IT. That is the part worth recording, because the
        first version of this paragraph was proud of the number it got wrong.
        It said "~25 dishes, roughly a third of a first shift… running out
        inside the first day is what teaches restock", and every clause of that
        is defensible until you measure the other side of it: a fresh account
        holds ZERO of all fourteen live resources, so when the 120 units ran out
        there was no restock to teach. MEASURED on a real fresh profile, the
        whole first session was 5.0 real minutes of a 12-minute day — served 13,
        lost 9 — and then every one of the twenty-five core supply lines refused
        with the exact sentence round 2 had shipped on screen one.

     SIZED AGAINST A WHOLE DAY, AND DERIVED FROM A DISH COUNT RATHER THAN TYPED.
     A competent level-1 player cooks 102–120 dishes across a full 12-minute day
     (measured, four seeds, level pinned at 1 so only the three day-one dishes
     are in play: 120/116/102/111 dishes, 59–67 tickets served). The grubstake is
     102 of them — 32 hot dogs, 44 classic burgers, 26 margheritas — around 90%
     of an average day. That is deliberate on both ends:
       • It is enough that DAY ONE IS A DAY, not a demo. REF-A and REF-B both
         give you an hour on the tutorial screen; five minutes and a refusal is
         the same failure wearing a better coat.
       • It is NOT enough to finish, so the restock lesson still lands — but it
         lands in the last hour of a shift the player is already winning, with
         a wallet holding ~12,000 Cinder, next to a skip bin that will sell them
         a crate for 36. That is a lesson. The old one was an eviction.
     Every shared line below is ARITHMETIC, not judgement:
       sauce  = 44 burgers × 1 + 26 pizzas × 2   = 96
       cheese = 26 pizzas × 2                    = 52
       tomato = 44 burgers × 1 + 26 pizzas × 1   = 70
     ⚠ ONION IS GONE, AND ITS ABSENCE IS THE POINT. The old table granted 8, and
       measured play returned "leftover pantry {onion:8, …}" every single time,
       because NO level-1 recipe uses an onion (chiliDog and the Double are 3
       and 5 levels away). Eight units of visible, useless stock on the tutorial
       screen is the game telling a new player it does not know what they can
       cook. If you pull an onion recipe down to level 1, put the onions back —
       assertDataSane() will tell you, loudly, if you forget.

     🛡 assertDataSane() checks this table against EVERY level-1 recipe, so a
     recipe pulled down to level 1 without a grubstake line for it is a reported
     problem rather than a first-run dead end. That check is the whole reason
     this number is safe to change. */
  START_PANTRY: {
    roll:32, sausage:32, mustard:32,           // 32 hot dogs
    bun:44, patty:44, lettuce:44,              // 44 classic burgers
    dough:26,                                  // 26 margheritas
    sauce:96, cheese:52, tomato:70,            // shared — see the arithmetic above
  },

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
  /* 🔴 THE CINDER-DENOMINATED HALF OF THE FOOD-PRINTER GUARD. See
     convoyGuardOk(). Producing a shippable dish by the CHEAPEST route the game
     offers — which, since the skip bin exists, can be a route that spends no
     live resources at all — must cost at least this multiple of what the food
     it delivers is worth. 2× is the smallest honest statement of "a convoy
     moves value, it does not mint it". Today the margin is 7×; the check exists
     so that a future cheap supply line cannot quietly close it. */
  CONVOY_CINDER_GUARD_MULT: 2.0,
  /* What one unit of the live `food` resource is worth in Cinder ON THE OPEN
     MARKET. This is the game's own number (index.html:195218, the cold-storage
     board prices `food` at 4) and it is deliberately NOT the skip bin's internal
     surcharge, which is a different question with a different answer — see
     _SALVAGE.resCinder. It exists so the printer guard is measured against what
     food is WORTH rather than against what the kitchen happens to charge for it. */
  FOOD_RETAIL_CINDER: 4,

  /* 🔴 THE TWO NUMBERS THAT KEEP THE SKIP BIN A FLOOR AND NOT A KITCHEN. See
     the _SALVAGE block. SHARE is how much of a level-40 board Cinder alone may
     run; VALUE_GAP is how much richer the dishes that need the city have to be.
     Together they say: the bin keeps a small, cheap kitchen alive, and every
     expensive thing on the board is something your city bought you. */
  SALVAGE_SHARE_MAX: 0.55,  // at most this fraction of the full menu
  SALVAGE_VALUE_GAP: 1.5,   // city-only dishes must average ≥ this × bin dishes

  /* ═══════════════════════════════════════════════════════════════════════
     🛡 THE MODEL'S OWN THRESHOLDS. capacityModel() reads these; nothing else
        should. They are here rather than as literals in the function for the
        same reason as every other number in this file — a threshold that only
        exists inside the checker is a number nobody can retune.
     ═══════════════════════════════════════════════════════════════════════ */
  WALL_RATIO_MIN: 1.25,     // below this at the peak there is no rush to answer
  WALL_RATIO_MAX: 2.25,     // above this the rush is unwinnable, not hard.
                            //    2.25 ≈ "you can serve under half the peak
                            //    hour". Sized against the measured bot, which
                            //    holds ~77% service at ratio 2.15 because
                            //    balks and turn-aways shave real demand below
                            //    the modelled figure.
                            // 🔴 THE CEILING IS THE HALF THAT WAS MISSING. See
                            //    capacityModel()'s `ok`.
  /* ── THE OTHER TWO RACKS THE MODEL HAS TO JUDGE, AND THE REASON THE GUARD
        WAS ONLY ADVISORY UNTIL NOW. ─────────────────────────────────────────
     WALL_RATIO_MIN..MAX above is the band for a STOCK rack, and it is the only
     band the file had. Applying it to any other configuration is a category
     error, which is exactly what happened: capacityModel() reported ok:false
     for a fully-kitted level-40 kitchen at 0.91 — a kitchen that is COMFORTABLE
     BECAUSE THE PLAYER BOUGHT COMFORT, which is the shop's entire promise —
     and the only way to keep assertDataSane() green was to not call the model
     for anything except a stock rack at levels 1..14. A guard you can only run
     on a third of the range is a guard with an opinion, not a guard.
     Three racks, three bands, all three checked (see assertDataSane):
       STOCK            WALL_RATIO_MIN..MAX     you WILL lose orders
       LEVEL-APPROPRIATE (everything unlocked by that level, which is what a
                        player who keeps up with the shop is actually holding)
                        WALL_KITTED_MIN..MAX    tight, never comfortable
       FULLY MAXED      WALL_MAXED_MIN..MAX     the reward — but still a shift */
  WALL_KITTED_MIN: 0.80,    // below this the shop has over-sold and the mid-game
  WALL_KITTED_MAX: 1.70,    // is a walk; above it the shop is not keeping up
  WALL_MAXED_MIN: 0.55,     // 🔴 a FLOOR on the endgame: if a maxed kitchen is
                            //    this far under its own peak, the last fifteen
                            //    levels of upgrades bought nothing anybody
                            //    needed and the shop's top tier is decoration.
  WALL_MAXED_MAX: 0.95,     // …and the ceiling that proves the ladder CLEARS
                            //    the wall. Was a literal 0.95 inside
                            //    assertDataSane(), which is the same "economy
                            //    number outside ECON" rule this file exists for.
  PASS_HEADROOM: 1.25,      // the pass must clear TICKET_CAP × (meanOrder − 1)
                            // by this much before the rack counts as the
                            // bottleneck. See capacityModel() for the pigeonhole
                            // this comes out of — a pass that merely TIES the
                            // jam floor still deadlocks, because the floor is a
                            // worst case the dinner rush reaches.
  /* 🔴 THE ATTENTION CEILING, PROMOTED FROM A COMMENT TO A NUMBER. The UPGRADES
     header has always claimed that "past about eight live slots the bottleneck
     stops being the rack and becomes the player's two thumbs" — and then
     capacityModel() went on counting all nineteen slots of a fully-kitted
     kitchen as if they all ran hot, which credited a maxed rack with more than
     twice the throughput a human can extract from it. A claim the file makes
     and the file's own model ignores is the exact failure mode this whole
     section exists to stop. 10, a little above the stated eight, because the
     fountain and the prep board genuinely are cheap to keep fed. */
  HANDS_SLOTS: 10,          // live slots one player can actually keep fed

  /* ═══════════════════════════════════════════════════════════════════════
     🛣 THE LANE — geometry, timing and mood. OWNED BY drivethru.js.
     ═══════════════════════════════════════════════════════════════════════
     🔴 EVERY KEY IN THIS SECTION AND THE FOUR BELOW IT WAS, UNTIL NOW, AN
        `EC('KEY', literal)` FALLBACK INSIDE drivethru.js / convoy.js. Forty-three
        of them. CLAUDE.md: "All operation pricing goes through _opEcon(). Never
        hardcode economy numbers." A fallback IS a hardcoded number — it is one
        with a note attached promising somebody will move it later.
        The `EC()` second argument is a NaN GUARD, not a tuning value, and with
        the key present it can never be reached. Retune HERE. If you retune a
        fallback in drivethru.js instead, you will change nothing and then spend
        an afternoon finding out why.
        ⚠ MEASURED PROOF THAT THIS MATTERS: LANE_EXIT_MS carried a fallback of
        1500 in drivethru.js and 900 in kitchen.render.js. The sim and the
        pixels disagreed about how long a served car blocks the window, and
        neither file could tell. One key, one answer. */
  LANE_ROLL_UNITS_S: 0.55,  // lane-lengths per second a car rolls forward
  LANE_ENTRY_POS: 1.30,     // where a car appears, PAST the mouth of the lane,
                            // so it drives on screen instead of popping into
                            // existence in the queue
  LANE_SPEAKER_POS: 0.92,   // 🔴 WHERE THE SPEAKER BOX IS, as a fraction of
                            //    LANE_LEN measured from the window. A car may
                            //    not roll PAST it until it has ordered, and may
                            //    not order until it has reached it. This one
                            //    number is what makes the lane's geography and
                            //    its state machine agree — the round-2 critic
                            //    caught them disagreeing on screen ("AT THE
                            //    WINDOW" printed over a car still rolling at
                            //    pos 0.695). One key, one answer.
  LANE_ORDER_MS: 2400,      // beat at the speaker box. At 0 the dialogue flashes
                            // past and the joke never lands.
  LANE_EXIT_MS: 1500,       // 🔴 how long a SERVED car blocks the window. This is
                            //    not decoration — it is the entire "cars block
                            //    each other" mechanic. At 0 the lane is a list.
  LANE_BALK_MS: 26000,      // patience of a car that has arrived but not yet
                            // reached the speaker. Only reachable when the lane
                            // is jammed by an unserved front car.
  LANE_MOOD_TESTY: 0.55,    // patience-remaining thresholds the mood face steps
  LANE_MOOD_ANGRY: 0.25,    // down at. Render reads `car.mood`.
  LANE_NAG_MS: 9000,        // gap between a TESTY car's window nags
  LANE_NAG_ANGRY_MS: 5500,  // 🔴 …and once FURIOUS. The nag ESCALATES: the last
                            //    ten seconds of a doomed order must not read
                            //    like the first ten.
  LANE_PASSBY_MS: 2600,     // how long a balked vehicle stays drawable so the
                            // renderer can drive it across the top and off
  PASSBY_STAGGER_MS: 320,   // head start between consecutive drive-pasts, so
                            // five balks in one frame read as TRAFFIC rather
                            // than as one smeared sprite
  PASSBY_LANES: 3,          // rows of the far-side band to spread a burst across
  PLAN_SERVE_RATE: 0.35,    // hit rate arrivalPlan() models when the caller does
                            // not name one. ⚠ MEASURED off live play, not
                            // assumed — re-measure it if the lane is retuned,
                            // because a planner that lies about the serve rate
                            // makes every rush it previews look winnable.

  /* ── POPULARITY THE LANE APPLIES ITSELF ─────────────────────────────────
     Neither of these produces a lost TICKET, so neither has a path through
     kitchen.state.js's serve/lose settle. Sized against POP_LOST (−1.0): a
     balk is a seventh of a lost ticket, a jam is half of one. Those RATIOS are
     the tuned quantity and they are unchanged; only the scale moved. */
  POP_BALK: -0.14,          // a car reached a FULL LANE and drove past. Tiny on
                            // purpose: a queue out the door is a compliment.
  POP_JAM: -0.50,           // a car queued, never got to order, gave up. Yours.
  POP_JUMP: -0.33,          // everyone behind a queue-jumper sees you allow it

  /* ── SET PIECES (drivethru.js §SET PIECES) ──────────────────────────────
     ⚠ SPECIAL_MIN_LEVEL is a KINDNESS GATE, not a difficulty gate: a brand-new
       player meeting a queue-jumper in their first sixty seconds learns "this
       game is unfair", not "this game has texture". It stays at 3 even though
       the whole MENU moved to level 1 — the menu is what the player asked for,
       the set pieces are garnish, and garnish can wait a shift. */
  SPECIAL_CHANCE: 0.11,
  SPECIAL_MIN_LEVEL: 3,
  BULK_ITEM_MULT: 2.2,      // a corp bulk buy orders this much more…
  BULK_PATIENCE_MULT: 1.9,  // …is correspondingly willing to wait…
  BULK_TIP_MULT: 1.35,      // …and pays for it. 🔴 NOT HIGHER: the two
                            // personalities who place bulk orders are already
                            // the most generous rows in CUSTOMERS (tipBias
                            // 1.8 / 1.6), and a big multiplier on top of a big
                            // bias is what made this tier flat the first time.
  JUMP_PATIENCE_COST_MS: 7000,  // patience each car behind loses to the cut-in
  GRUDGE_PATIENCE_MULT: 0.70,   // a regular you failed has a shorter fuse…
  GRUDGE_TIP_MULT: 0.45,        // …and a worse memory of your prices
  FAVOUR_PATIENCE_MULT: 1.35,   // a regular you delighted gives you room…
  FAVOUR_TIP_MULT: 1.55,        // …and pays it back

  /* ═══════════════════════════════════════════════════════════════════════
     🗣 MODIFIERS — "no onions", "extra cheese". THE PROMISE, AND WHAT IT PAYS.
     ═══════════════════════════════════════════════════════════════════════
     🔴🔴 IT MUST NEVER BE MORE PROFITABLE TO IGNORE A CUSTOMER'S PROMISE THAN
          TO KEEP IT, AND UNTIL THIS BLOCK EXISTED IT WAS.
     The lane could only move a TIP: MOD_TIP_HIT/MISS shifted the tip blend and
     nothing else. Two things followed and both were fatal to the mechanic:
       1. The tip is a fraction of a payout the modifier could not touch, so an
          honoured "extra bacon" moved a handful of Cinder while COSTING two
          rashers of real pantry stock. Honouring lost money.
       2. `judgeMod()` reads build evidence — `ticket.items[i].builds` — that
          assembly did not record, so the great majority of modifiers judged
          'unproven' and were worth exactly zero in either direction.
     Both halves had to land or neither counts. kitchen.state.js now records
     what actually went on the dish (`dish.built`, carried onto the pass and
     into the served item); drivethru.js judges against it and prices the
     verdict through the four MOD_PAY_* keys below, which move the PAYOUT, not
     just the tip.

     🔴 THE ARITHMETIC THE FLOOR EXISTS FOR. Honouring an `extra` costs real
     pantry units, and the priciest single unit in the game is a beef patty at
     130 Cinder ÷ 8 = 16.25. A percentage bonus alone therefore fails on cheap
     dishes: 12% of a 25-Cinder soda is 3 Cinder against a 4-Cinder shot of
     syrup, so honouring "extra syrup" would still lose money. MOD_PAY_HIT_MIN
     is a per-honoured-UNIT floor set ABOVE the priciest pantry unit, which
     makes the inequality hold on every dish and every ingredient at once
     instead of on average. assertDataSane() recomputes that comparison from
     SUPPLY_RECIPES and reports it — so a price rise on patties cannot quietly
     re-open the hole.
     ⚠ MISS IS BIGGER THAN HIT, in both currencies. A broken promise is not a
       neutral outcome the player merely fails to profit from; the customer
       asked for one thing and got another. Symmetric numbers would make
       ignoring modifiers a valid strategy with a small tax.
     ⚠ UNPROVEN IS ZERO. Not a small bonus, not a small penalty. A modifier
       nobody can check must never be able to move money — a guess that moves
       money is worse than an honest blank. */
  MOD_CHANCE: 0.30,         // chance an ordered LINE carries a modifier
  MOD_SECOND_CHANCE: 0.18,  // …and a second, so "no onions, extra cheese" is
                            // real and rare
  MOD_MAX_PER_ORDER: 2,     // hard cap. Six instructions is a wall of text in a
                            // speech bubble on a 360px screen.
  MOD_PATIENCE_MULT: 0.94,  // a fussy order is a fussier customer
  MOD_NORUSH_PATIENCE_MULT: 1.45,  // …except `no_rush`, the one modifier that
                            // BUYS the player time. It asks for nothing and
                            // pays nothing; it is the reason to read the list.
  MOD_EXTRA_MIN: 2,         // how many of an ingredient counts as "extra"
  MOD_TIP_HIT: 0.35,        // tip-blend bonus for an HONOURED promise
  MOD_TIP_MISS: -0.45,      // …and the penalty for a BROKEN one. Bigger. See above.
  MOD_TIP_UNPROVEN: 0,      // 🔴 zero, in both directions
  MOD_PAY_HIT: 0.12,        // 🔴 PAYOUT bonus, as a fraction of the line's price
  MOD_PAY_HIT_MIN: 18,      // 🔴 …with a per-honoured-UNIT Cinder floor ABOVE the
                            //    priciest pantry unit (patty, 16.25). This is
                            //    what makes honouring pay on a 25-Cinder soda.
  MOD_PAY_MISS: -0.25,      // 🔴 payout penalty for a broken promise
  MOD_PAY_UNPROVEN: 0,
  MOD_POP_HIT: 0.14,        // reputation, per honoured line. Small — it is one
  MOD_POP_MISS: -0.50,      // detail of one ticket — but a broken promise is
                            // half a lost ticket's worth of word of mouth, on
                            // the same scale as POP_LOST (−1.0).
  MOD_XP_HIT: 3,            // xp for getting a fussy order right

  /* ── THE TIP RETURN (drivethru.js §TIP) ─────────────────────────────────── */
  TIP_GEN_MAX: 4.0,         // runaway guard on the GENEROSITY STACK (tipBias ×
                            // upgrades × set piece × modifiers, which stacks and
                            // is therefore unbounded). High enough never to
                            // touch a normal customer.
  TIP_HARD_PCT: 0.70,       // 🔴 the DESIGN ceiling, ≈2× TIP_MAX_PCT. Without it
                            //    the top tier saturated the safety clamp on 100%
                            //    of 4,000 samples and quality stopped mattering
                            //    at all — measured, not guessed.
  TIP_FRACTION_MAX: 0.95,   // 🔴 last-ditch clamp below kitchen.state.js's
                            //    `v < 1` fraction test. Should never bind; if it
                            //    does, TIP_HARD_PCT is wrong.
  TIP_FRACTION_MIN: 0.01,   // floor, so a served car always drops a coin

  /* ── SHIFT & TICKET GRACE (kitchen.state.js / index.js) ─────────────────── */
  SHIFT_GRACE_MS: 4000,     // quiet beat after the bell before the first arrival
  LAST_CALL_MS: 45000,      // no NEW arrivals inside the last this-much of a day,
                            // so the closing bell is not a mass extinction event
  TICKET_HARD_GRACE_MS: 20000,  // slack past dueAt before a ticket is truly lost
  AWAY_FORFEIT_MS: 60000,   // panel shut longer than this → the shift is forfeit
                            // rather than resumed (CONTRACT §4)
  LIKE_BIAS: 0.7,           // weight a customer's `likes` categories get in the
                            // order roll. Never a hard filter — a locked menu
                            // must still be servable.

  /* ── CONVOY KEYS THE ROUTE NEEDS (convoy.js) ────────────────────────────── */
  CONVOY_ROUTE_LEGS: 5,     // markers drawn on the road. LAYOUT, not economy —
                            // kept here so a designer can widen the road without
                            // touching code. convoy.js clamps it to 3..8.
  /* 🔴 THE ARMING KEY FOR ROUTE INCIDENTS, AND IT IS DELIBERATELY 0.
     convoy.js can lose boxes to hazards on the road. `pct × 2` is the chance
     per leg and `pct` the size. It stays OFF because a convoy is a TRANSFER
     (CONTRACT §8.4) and shrinkage on a transfer is a net DESTRUCTION of food
     the sender already paid the live ledger for — which reads to both players
     as the game eating their stuff. The road still draws, still names its legs
     and still reads as a journey at zero loss.
     ⚠ If you ever arm it: it is a difficulty knob on OTHER PEOPLE'S generosity,
       so keep it under ~0.06 and re-run the margin table. Do not arm it to
       "balance" convoys — CONVOY_FOOD_PER_DISH is the balance lever. */
  CONVOY_SPOIL_PCT: 0,
  CONVOY_MIN_TRANSIT_MS: 1200000,  // 🔴 20 min. The floor under CONVOY_TIERS
                            // transit. Below this a convoy stops being logistics
                            // and becomes a vending machine. assertDataSane()
                            // enforces it against every tier.
  CONVOY_SYNC_MS: 60000,    // how often convoy.js may re-poll the server for
                            // inbound rows. Not a game number — a POLITENESS
                            // number, and the reason it is here is that a
                            // literal buried in a networking helper is exactly
                            // where a runaway poll loop hides.
  CONVOY_HOLD_MS: 5000,     // how long an arrived convoy is held on screen
                            // before it is claimable, so the arrival is a MOMENT
                            // rather than a number changing

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
/* 🔴 FIRST ROW WINS, AND THAT LINE USED TO READ `= s` UNCONDITIONALLY. With one
   supply row per ingredient the two spellings are identical, which is precisely
   why this was safe to write the dangerous way for three rounds. The skip bin
   (§_SALVAGE) adds a SECOND row per covered ingredient, and last-wins would have
   made the skip-bin line canonical: `foodPerUnit` would read 0 for roll,
   sausage, mustard, dough, sauce, cheese and tomato, every recipe made of them
   would report `foodCost: 0`, and convoyGuardOk() — whose entire job is to
   prove a convoy destroys food rather than printing it — would have been
   comparing CONVOY_FOOD_PER_DISH against zero and passing. A one-character
   difference between "the guard works" and "the economy is dead". */
const _SUPPLY_BY_ING = Object.create(null);
for (const s of SUPPLY_RECIPES) {
  if (!s || !s.out || !s.out.ing) continue;
  if (s.kind === 'salvage') continue;          // belt: never canonical
  if (_SUPPLY_BY_ING[s.out.ing]) continue;     // braces: first row wins anyway
  _SUPPLY_BY_ING[s.out.ing] = s;
}
/** ingredient id → its skip-bin line, or null. Render uses this to show the
    "or pay retail" price beside the real one; the sim never needs it. */
const _SALVAGE_BY_ING = Object.create(null);
for (const s of _SALVAGE_LINES) _SALVAGE_BY_ING[s.out.ing] = s;

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

/** ECON.PERFECT_MS, ceilinged by PERFECT_FRACTION of the window it sits in and
    floored by PERFECT_MIN_MS — in that order, so the ceiling always wins. */
function _perfectMsFor(doneWindowMs) {
  const win = Math.max(0, doneWindowMs | 0);
  const ceil = win * ECON.PERFECT_FRACTION;
  const want = Math.min(ECON.PERFECT_MS, ceil);
  return Math.round(Math.max(want, Math.min(ECON.PERFECT_MIN_MS, ceil)));
}

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
    // 🔴 ABSOLUTE, not a fraction — see ECON.PERFECT_MS for the measurements
    //    that forced that. PERFECT_FRACTION is the ceiling and PERFECT_MIN_MS
    //    the floor, in that order: a window too short to hold the floor gets the
    //    ceiling rather than a perfect band longer than the window it lives in.
    perfectMs: _perfectMsFor(r.doneWindowMs),
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
/** The skip-bin line for an ingredient, or null if the bin does not stock it.
    Render: a null here is the sentence "your city is the only source of this". */
export function salvageFor(ingId){ return _SALVAGE_BY_ING[ingId] || null; }
/** Every recipe a player with an EMPTY live ledger can still cook, in menu
    order. This is THE floor, computed rather than asserted — see _SALVAGE. */
export function salvageMenu() {
  return RECIPES.filter((r) => Object.keys(r.needs).every((id) => !!_SALVAGE_BY_ING[id]));
}
/** What one dish costs in Cinder if EVERY unit of it came out of the skip bin.
    → number (Cinder), or Infinity when the bin cannot make it at all. */
export function salvageCinderCost(recipeId) {
  const r = _RECIPE_BY_ID[recipeId];
  if (!r) return Infinity;
  let sum = 0;
  for (const id in r.needs) {
    const s = _SALVAGE_BY_ING[id];
    if (!s) return Infinity;
    sum += r.needs[id] * (s.cost.cinder / Math.max(1, s.out.qty));
  }
  return Math.round(sum * 100) / 100;
}
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

/**
 * RECIPES the player may cook at `lv`, in MENU ORDER (category, then tier).
 *
 * 🔴 THE OPTIONAL SECOND ARGUMENT IS THE ORDER-BOARD FIX, AND IT IS NOT
 *    COSMETIC. MEASURED, on a fresh account with an empty live ledger playing
 *    three full days off the skip bin alone: 324 tickets placed, and 122 of the
 *    142 lost ones — 86% — contained a dish that kitchen could NEVER make. Only
 *    twenty losses were the player's. A ticket is all-or-nothing, so ONE
 *    unstockable line poisons the whole order, and both order generators
 *    (kitchen.state.js's counter and drivethru.js's lane) draw from this
 *    function with no reference to what the kitchen can actually cook. The
 *    result is that LEVELLING UP MAKES A STRANDED KITCHEN WORSE: every unlock
 *    is a new way for a ticket to be unfillable. Popularity went 58 → 12 → 2
 *    over two days for a player who was cooking the whole time and banking
 *    Cinder every day.
 *
 * @param {number} lv
 * @param {Set|Array|Object|Function} [cookable] recipe ids the kitchen can
 *   currently make — a Set, an array, a `{id:true}` map, or a predicate.
 *   WHEN PASSED, the menu is filtered to it. This is for the ORDER GENERATORS
 *   only. Do NOT pass it when drawing the MENU BOARD or the upgrade/level-up
 *   screens: the player must still SEE the Bacon Melt they cannot afford to
 *   stock, or the reason to go and build a Gene Vault disappears from the game.
 *   ⚠ It never returns an empty menu. If nothing is cookable the unfiltered
 *     menu comes back, because a customer who orders something you cannot make
 *     is a lost ticket and NO customer at all is a dead restaurant — and a
 *     dead restaurant is the one state this whole feature has been trying to
 *     get rid of for three rounds.
 */
export function menuForLevel(lv, cookable) {
  const L = Math.max(1, lv | 0);
  const catOrder = Object.create(null);
  for (const c of MENU_CATS) catOrder[c.id] = c.order;
  const all = RECIPES
    .filter(r => (r.minLevel || 1) <= L)
    .sort((a, b) => (catOrder[a.cat] - catOrder[b.cat]) || (a.tier - b.tier) || (a.basePrice - b.basePrice));
  if (cookable == null) return all;
  let has;
  if (typeof cookable === 'function') has = (id) => !!cookable(id);
  else if (cookable instanceof Set) has = (id) => cookable.has(id);
  else if (Array.isArray(cookable)) has = (id) => cookable.indexOf(id) !== -1;
  else if (typeof cookable === 'object') has = (id) => !!cookable[id];
  else return all;
  const hot = all.filter((r) => has(r.id));
  return hot.length ? hot : all;
}

/**
 * Everything that becomes available AT exactly level `lv` — the level-up toast.
 * A level that unlocks nothing is a level that feels like nothing.
 * 🔴 assertDataSane() walks this over EVERY level 2..MAX_LEVEL. It used to stop
 *    at MAX_LEVEL−5 and the holes simply moved into the exempt band — four
 *    consecutive blank toasts at 36–39. There is no exempt band now.
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
/** When a plate stops being sellable at all and goes in the bin. The heat lamp
 *  extends this on the same multiplier — that is most of what you are buying. */
export function passSpoilMs(owned) { return Math.round(ECON.PASS_SPOIL_MS * _mulEffect(owned, 'freshMul')); }

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
/**
 * 🔴 THE RACK A PLAYER AT THIS LEVEL IS ACTUALLY HOLDING — everything the shop
 * has unlocked by then. Not "stock" (which past about level 6 is nobody) and not
 * "everything in the file" (which is only true at 40). capacityModel() is
 * meaningless without a rack to run it against, and picking the wrong rack is
 * how the wall check ended up scoped to levels 1..14 and blind past them.
 * ⚠ It deliberately ignores AFFORDABILITY. Modelling a budget would need a
 *   whole earnings simulation inside a pure data file; the honest simplification
 *   is "unlocked", and the band it is judged against (WALL_KITTED_*) is set wide
 *   enough to absorb a player a few purchases behind. `lagLevels` exists for
 *   exactly that sensitivity check.
 */
export function expectedUpgradesFor(lv, lagLevels) {
  const L = Math.max(1, (lv | 0) - Math.max(0, lagLevels | 0));
  return UPGRADES.filter((u) => (u.minLevel || 1) <= L).map((u) => u.id);
}

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

/**
 * How busy this kitchen's town thinks it is, 0..∞, as a function of level.
 * Multiplied onto rushAt() by kitchen.state.js's rushNow(). See ECON.DEMAND_*.
 * Pure, monotonic, and 1.0 at DEMAND_FULL_LEVEL so the RUSH_CURVE table still
 * reads as literal multipliers for a mid-game kitchen.
 */
export function demandScale(level) {
  const lv = Math.max(1, (level | 0) || 1);
  const full = Math.max(2, ECON.DEMAND_FULL_LEVEL | 0);
  const lo = ECON.DEMAND_MIN;
  if (lv >= full) return 1 + ECON.DEMAND_LATE_PER_LEVEL * (lv - full);
  return lo + (1 - lo) * ((lv - 1) / (full - 1));
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

/**
 * 🔴 THE WHOLE DAY-ROLL POPULARITY SETTLE, IN ONE SIGNED NUMBER.
 *
 * 🔴 CALL THIS AND NOTHING ELSE. kitchen.state.js's closeShift() day-roll used
 *    to be two lines — `bumpPop(EC('POP_DECAY_PER_DAY'))` and a clean-day bonus
 *    computed as `-EC('POP_DECAY_PER_DAY') * 2` — and that shape is precisely
 *    how POP_REVERT_BELOW / POP_REVERT_PER_DAY shipped as dead data for a round:
 *    a settle assembled from loose constants at the call site can silently be
 *    missing one of them, and reads fine. This returns the finished delta, so
 *    the only way to get it wrong is not to call it.
 *
 * Three rules, in this order:
 *   1. Below ECON.POP_REVERT_BELOW the town forgets: +POP_REVERT_PER_DAY
 *      INSTEAD of the decay. Not a floor, not a gift — strictly smaller than a
 *      single decent day's service, so the climb is still the player's. It only
 *      stops the hole being infinitely deep, which is what it was: measured, a
 *      competent auto-player pinned at popularity 0 from day 3 through day 60.
 *   2. Otherwise the normal ECON.POP_DECAY_PER_DAY applies, because fame is a
 *      thing you keep doing rather than a thing you did once.
 *   3. A CLEAN day (something served, nothing lost) pays back
 *      POP_CLEAN_DAY_MULT days of decay on top of either branch. It is worth
 *      having in the revert branch too — a stranded player who runs one flawless
 *      short shift should climb faster than the town's own forgetting.
 *
 * @param {number} pop    popularity at the moment the bell rings, 0..100
 * @param {object} report the day's settle: { served, lost }
 * @returns {number} signed delta to apply ONCE per day roll. Never NaN.
 */
export function popDayDelta(pop, report) {
  const p = Number.isFinite(pop) ? pop : ECON.POP_START;
  const r = report || {};
  const served = (r.served | 0), lost = (r.lost | 0);
  const decay = ECON.POP_DECAY_PER_DAY;
  let d = (p < ECON.POP_REVERT_BELOW) ? ECON.POP_REVERT_PER_DAY : decay;
  if (lost === 0 && served > 0) d += -decay * ECON.POP_CLEAN_DAY_MULT;
  return Number.isFinite(d) ? d : 0;
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
 * 🔴 THE WALL, COMPUTED. Run this after ANY change to STATIONS[].slots,
 * RUSH_CURVE, SPAWN_BASE_MS, COUNTER_SHARE or the recipe cook times.
 *
 * WHY IT IS CODE AND NOT A COMMENT: the paragraph in the ECON header that used
 * to model this counted the griddle's two slots and forgot the other four
 * stations, so the file believed it shipped 15 dishes per in-game hour of
 * capacity and actually shipped 50. Nobody could tell by reading, because the
 * arithmetic looked right — it was the inputs that were wrong. A comment cannot
 * check itself against the table above it; this can.
 *
 * The model, and it is deliberately crude because a crude model that runs beats
 * an exact one that does not:
 *   capacity/hour = Σ over slots of (HOUR_MS ÷ meanCookMs)   — a slot turns out
 *     one dish per cook, and HOUR_MS of real time is one in-game hour.
 *   demand/hour   = (HOUR_MS ÷ spawnIntervalMs(pop, rush)) × meanOrderDishes
 *     — spawnIntervalMs is the WHOLE HOUSE's arrival rate (state.js takes
 *     COUNTER_SHARE of it for the counter and drivethru.js the rest), so the
 *     two channels sum back to exactly this.
 * It ignores the player's hands entirely, which is why `peakRatio` wants to be
 * comfortably ABOVE 1: a rack that is theoretically just adequate is, in a real
 * pair of thumbs, already underwater.
 *
 * @param {number} lv    level to model the menu at (default 12, a mid kitchen)
 * @param {Array}  owned upgrades owned (default none — the STOCK rack)
 * @param {number} pop   popularity to model at (default POP_START)
 * → { slots, meanCookMs, capacityPerHour, hours:[{hour,rush,demand,ratio}],
 *     peak, peakRatio, ok }
 */
export function capacityModel(lv, owned, pop) {
  const L = Math.max(1, (lv == null ? 12 : lv) | 0);
  const P = (pop == null) ? ECON.POP_START : pop;
  const menu = menuForLevel(L);
  /* 🔴 ONLY COUNT SLOTS THE PLAYER CAN ACTUALLY PUT FOOD ON. A level-1 kitchen
     physically owns a fryer, an oven, a prep board and a fountain, and has not a
     single recipe for any of them — the oven does not open until level 8. Summing
     the whole rack said "6 slots, 45 dishes/hour" for a player whose real
     capacity was two griddle lanes and 15. That is the same class of mistake as
     the hand-written model this function replaced, so it is not repeated here. */
  const live = Object.create(null);
  for (const r of menu) live[r.station] = 1;
  let slots = 0;
  for (const st of STATIONS) if (live[st.id]) slots += slotsFor(st.id, owned);

  // Mean cook time over the menu the player can actually see, through the
  // speed upgrades they actually own. An unweighted mean is the honest one
  // here: `likes` biasing means every category really does get ordered.
  let cookSum = 0, n = 0;
  for (const r of menu) { cookSum += cookMsFor(r.id, owned); n++; }
  const meanCookMs = n ? (cookSum / n) : 12000;

  const hourMs = ECON.HOUR_MS || 60000;
  // ⚠ min(slots, HANDS_SLOTS): a rack bigger than a pair of thumbs is not
  //    capacity, it is choice. See ECON.HANDS_SLOTS.
  const handSlots = Math.min(slots, ECON.HANDS_SLOTS || 10);
  const rackPerHour = handSlots * (hourMs / Math.max(1, meanCookMs));

  // Mean dishes on a ticket, straight out of CUSTOMERS rather than assumed.
  let dishSum = 0, dishN = 0;
  for (const c of CUSTOMERS) {
    const o = c.order || {};
    dishSum += ((o.min || 1) + Math.min(o.max || 2, ECON.ORDER_MAX_ITEMS)) / 2;
    dishN++;
  }
  const meanOrderDishes = dishN ? (dishSum / dishN) : 1.9;

  /* ═════════════════════════════════════════════════════════════════════════
     🔴 THE PASS TERM. THIS FUNCTION USED TO BE BLIND TO THE THING THAT BINDS.
     ═════════════════════════════════════════════════════════════════════════
     The model returned slots, cook times and a rack capacity, and nothing else
     — so a measured 26.8%-of-the-shift pass deadlock was completely invisible
     to it. It reported a healthy wall for a kitchen whose real constraint was
     somewhere it never looked. That is the SAME class of mistake as the
     hand-written comment this function replaced: the arithmetic was right and
     the inputs were incomplete, which reads as confirmation.

     🔴 THE PASS IS A STOCK CONSTRAINT, NOT A RATE ONE, AND GETTING THAT WRONG
        IS WHY THE FIRST DRAFT OF THIS BLOCK ALSO MISSED IT. Little's Law
        (λ_max = passCap ÷ mean residency) looks like the obvious tool and it
        exonerates PASS_CAP 8, because the MEAN order is only 1.93 dishes. The
        jam is not a mean, it is a pigeonhole:

          `refreshReady()` claims plates nearest-due-first, so a plate sits on
          the pass attached to an INCOMPLETE ticket. Deadlock is the state
          "pass full AND every ticket on it still missing something" — and the
          most plates that can be stranded that way is, exactly,
              TICKET_CAP × (meanOrderDishes − 1)
          one short of completion on every ticket the board can hold. Give the
          pass MORE room than that and the state is arithmetically unreachable:
          the next plate must complete something.

     CALIBRATION — this is not a fitted curve, it is the pigeonhole, and it
     lands on the measurements without being aimed at them. Level 12,
     TICKET_CAP 12, meanOrderDishes 1.93 → jamFloor = 11.2 plates:
         passCap  8  → 0.71× the floor → JAMS   (measured: deadlock 26.8% of
                                                 the shift, 35% of everything
                                                 cooked went in the bin)
         passCap 12  → 1.07×           → borderline (measured: 13% waste)
         passCap 14  → 1.25×           → clear   (measured: ~10% waste, and the
                                                 curve saturates by 16)
     PASS_HEADROOM is that 1.25: a pass that merely ties the floor deadlocks in
     practice, because arrivals are bursty and the floor is a worst case that
     the dinner rush reaches.

     🔴 THE DESIGN LAW THIS EXPOSES, WHICH IS THE REAL VALUE OF WRITING IT DOWN:
        PASS_CAP MUST SCALE WITH TICKET_CAP × ORDER SIZE. Raising TICKET_CAP
        from 8 to 12 (round one's fix for the silent demand valve) is what
        pushed the pass under water in the first place, and nothing connected
        the two numbers. Now something does. */
  const pCap = passCap(owned);
  const ticketCap = Math.max(1, ECON.TICKET_CAP || 12);
  const jamFloor = ticketCap * Math.max(0, meanOrderDishes - 1);
  const headroom = ECON.PASS_HEADROOM || 1.25;
  const passSlack = jamFloor > 0 ? (pCap / (jamFloor * headroom)) : Infinity;
  const bottleneck = passSlack < 1 ? 'pass' : 'rack';
  /* When the pass binds, throughput degrades in proportion to how far under the
     floor it is — a kitchen at 0.71× the floor spends roughly that fraction of
     its rack actually cooking, and the rest of the time the cook is holding a
     plate with nowhere to put it. Everything downstream (demand ratios, the
     peak, `ok`) is then measured against the REAL ceiling, not the rack's. */
  const passPerHour = rackPerHour * Math.min(1, passSlack);
  const capacityPerHour = Math.min(rackPerHour, passPerHour);

  const hours = [];
  let peak = null;
  const nHours = ECON.RUSH_CURVE.length;
  for (let h = 0; h < nHours; h++) {
    const rush = rushAt(((h + 0.5) / nHours) * ECON.DAY_MS) * demandScale(L);
    const demand = (hourMs / Math.max(1, spawnIntervalMs(P, rush))) * meanOrderDishes;
    const row = {
      hour: ECON.OPEN_HOUR + h,
      rush: Math.round(rush * 100) / 100,
      demand: Math.round(demand * 10) / 10,
      ratio: Math.round((demand / Math.max(0.001, capacityPerHour)) * 100) / 100,
    };
    hours.push(row);
    if (!peak || row.demand > peak.demand) peak = row;
  }
  const peakRatio = peak ? peak.ratio : 0;
  /* 🔴 `ok` NOW FAILS IN BOTH DIRECTIONS, AND THAT IS THE POINT.
     It used to be `peak.ratio >= 1.25` — a floor with no ceiling — so it
     reported ok:true for a level-40 STOCK kitchen at ratio 3.39 (a kitchen that
     can physically cook 29% of its demand) while reporting ok:false for the
     fully-kitted one at 0.74. The model endorsed the broken end of its own
     range and flagged the healthy end. A wall you cannot climb is not a wall,
     it is a wall you are standing in front of.
     WALL_RATIO_MIN..MAX is the band a stock rack should sit in at the peak:
     genuinely underwater (you WILL lose orders) but within reach of two hands
     and the upgrade shop. Outside it in either direction is a reported problem. */
  const lo = ECON.WALL_RATIO_MIN || 1.25;
  const hi = ECON.WALL_RATIO_MAX || 2.0;
  return {
    slots,
    handSlots,
    meanCookMs: Math.round(meanCookMs),
    meanOrderDishes: Math.round(meanOrderDishes * 100) / 100,
    passCap: pCap,
    jamFloor: Math.round(jamFloor * 10) / 10,
    passSlack: Math.round(passSlack * 100) / 100,
    rackPerHour: Math.round(rackPerHour * 10) / 10,
    passPerHour: Math.round(passPerHour * 10) / 10,
    bottleneck,
    capacityPerHour: Math.round(capacityPerHour * 10) / 10,
    hours,
    peak,
    peakRatio,
    // The wall exists when the busiest hour genuinely outruns a stock rack —
    // and when the thing it outruns is the RACK, not a pass that deadlocked.
    ok: !!peak && peakRatio >= lo && peakRatio <= hi && bottleneck === 'rack',
    why: !peak ? 'no hours modelled'
       : bottleneck === 'pass' ? 'the PASS binds before the rack does: ' + pCap + ' plates against a jam floor of ' + (Math.round(jamFloor * 10) / 10) + ' — orders strand instead of completing'
       : peakRatio < lo ? 'peak demand never outruns the rack — there is no rush to answer'
       : peakRatio > hi ? 'peak demand is more than ' + hi + '× capacity — unwinnable, not hard'
       : '',
  };
}

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

  /* ═════════════════════════════════════════════════════════════════════════
     🔴🔴 THE THIRD WALL, AND IT DID NOT EXIST UNTIL THE SKIP BIN DID.
     ═════════════════════════════════════════════════════════════════════════
     Both walls above are denominated in `food`, and both read `recipe.foodCost`,
     which is derived from the CORE supply lines. The skip bin (§_SALVAGE) sells
     the same ingredients for Cinder and NO live resources at all — so a dish
     bought entirely out of it costs exactly ZERO food, delivers
     CONVOY_FOOD_PER_DISH units of food on claim, and is invisible to every
     `foodCost` comparison in this function. Cinder in, food out: a printer, and
     the two existing walls would both have reported ok:true while it ran.
     The wall that actually holds it shut is denominated in CINDER: producing a
     shippable dish by the CHEAPEST AVAILABLE ROUTE must cost more Cinder than
     the food it delivers is worth. `food` is worth 4 (the game's own valuation,
     see _SALVAGE.resCinder), the cheapest salvage-buildable shippable dish is a
     Hot Dog at ~25 Cinder, and CONVOY_CINDER_GUARD_MULT is the multiple of
     retail that must hold — seven times over today, which is why the printer is
     not merely closed but absurd. It is checked so that it STAYS absurd.
     ⚠ If a future line makes some cheap dish salvage-buildable, this is the
       check that fails. Do not raise the multiplier to silence it. */
  const foodValue = ECON.FOOD_RETAIL_CINDER || 0;
  const needCinder = perDish * foodValue * (ECON.CONVOY_CINDER_GUARD_MULT || 1);
  let cinderMin = Infinity, cinderWorst = null;
  for (const r of RECIPES) {
    if (!r.ship) continue;
    const c = salvageCinderCost(r.id);
    if (c < cinderMin) { cinderMin = c; cinderWorst = r.id; }
  }
  const cinderOk = !(cinderMin < needCinder);   // Infinity (no salvage route) passes

  return {
    ok: perDish < shipMin && perDish < anyMin && cinderOk,
    perDish,
    shippableMin: shipMin,
    anyMin,
    worst,
    // The Cinder wall, reported so a test can print it rather than infer it.
    foodValueCinder: foodValue,
    cinderNeeded: Math.round(needCinder * 100) / 100,
    cheapestSalvageDish: cinderWorst,
    cheapestSalvageCinder: cinderMin === Infinity ? null : cinderMin,
    cinderOk,
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
    /* 🔴 THE PERFECT BAND MUST BE HITTABLE AND MUST FIT. Two failures, both
       silent, both introduced by the same kind of edit (a new dish with an
       unusually short done window, or a nudge to PERFECT_MS):
         • perfectMs > doneWindowMs — the whole window scores 'perfect' and the
           skill axis for that dish quietly disappears. The ceiling
           (PERFECT_FRACTION) is what stops it; this proves the ceiling ran.
         • perfectMs below PERFECT_MIN_MS with room to spare — a band nobody can
           tap on a phone, which measures hardware latency and not attention. */
    const pw = r.perfectMs | 0;
    const pCeil = r.doneWindowMs * ECON.PERFECT_FRACTION;
    if (!(pw > 0)) bad.push('RECIPES ' + r.id + ': perfectMs is not positive — nothing can score perfect');
    if (pw > Math.ceil(pCeil)) {
      bad.push('RECIPES ' + r.id + ': perfect band ' + pw + 'ms exceeds PERFECT_FRACTION of its '
        + r.doneWindowMs + 'ms done window (' + Math.round(pCeil) + 'ms) — the window stops grading anything');
    }
    if (pw < ECON.PERFECT_MIN_MS && pCeil >= ECON.PERFECT_MIN_MS) {
      bad.push('RECIPES ' + r.id + ': perfect band is ' + pw + 'ms, under PERFECT_MIN_MS ('
        + ECON.PERFECT_MIN_MS + ') with room for more — that is a reflex test on a phone, not a skill');
    }
  }

  // ── the grubstake must actually cook the day-one dish ──
  const day1 = RECIPES.filter(r => (r.minLevel || 1) === 1);
  if (!day1.length) bad.push('no level-1 recipe: a new player has nothing to cook');
  for (const r of day1) {
    for (const id in r.needs) {
      if (!(ECON.START_PANTRY[id] >= r.needs[id])) bad.push('START_PANTRY cannot cook ' + r.id + ' (missing ' + id + ')');
    }
  }

  /* ── 🔴 THE GRUBSTAKE MUST FIT IN THE COOLER IT IS POURED INTO. hydrate()
        grants START_PANTRY through the SAME two ceilings a purchase obeys — the
        total and the per-bin share — and silently gives less when it does not
        fit. A grubstake that is quietly truncated is a first shift that quietly
        ends early, and nothing on any screen would say which line was clipped. */
  const gsBinCap = Math.max(ECON.PANTRY_BIN_MIN, Math.round(ECON.PANTRY_CAP * ECON.PANTRY_BIN_PCT));
  let gsTotal = 0;
  for (const id in ECON.START_PANTRY) {
    const n = ECON.START_PANTRY[id] | 0;
    gsTotal += n;
    if (!_ING_BY_ID[id]) bad.push('START_PANTRY stocks an ingredient that does not exist: ' + id);
    if (n > gsBinCap) {
      bad.push('START_PANTRY ' + id + ' is ' + n + ' against a per-bin ceiling of ' + gsBinCap
        + ' — hydrate() will silently clip the grant');
    }
  }
  if (gsTotal > ECON.PANTRY_CAP) {
    bad.push('START_PANTRY totals ' + gsTotal + ' units against PANTRY_CAP ' + ECON.PANTRY_CAP
      + ' — the grant cannot land in full');
  }

  /* ── 🔴🔴 THE FLOOR UNDER THE RESOURCE ECONOMY. Three invariants, and every
        one of them is a bug this feature has actually shipped:
          A. A PLAYER WITH AN EMPTY LEDGER CAN STILL COOK SOMETHING. Rounds 1
             and 2 both shipped a state where they could not. If the skip bin
             stops covering at least one level-1 recipe, the dead end is back.
          B. THE FLOOR IS NOT THE KITCHEN. The bin must stay a MINORITY of a
             grown menu and must stay on the CHEAP END of it. If Cinder ever
             buys the whole board, or buys the expensive half of it, the
             resource loop the player asked for becomes decorative — a deeper
             failure than the soft lock, and a much quieter one.
             ⚠ The first draft of this check was "the bin may cover NOTHING
               above level 1", which is a cleaner sentence and the wrong rule.
               Measured, it left a stranded player able to cook 2 of the 8
               dishes their level had unlocked, and since a ticket is
               all-or-nothing they filled 15 of 90 tickets a day and sat at
               popularity 2 — technically not stuck and completely broken.
               Levelling up made the game WORSE, because every dish you cannot
               stock poisons every ticket it lands in. Share and value are the
               honest axes; "level" was a proxy that measured the wrong thing.
          C. THE FLOOR IS NEVER UNDERWATER. Every dish the bin can make must
             pay for itself at the WORST pay multipliers the game can hand out
             (POP_PAY_FLOOR × RUSH_PAY_MIN). A cheap route that loses money is
             not a floor, it is a slower version of the same dead end. */
  const salvMenu = salvageMenu();
  if (!salvMenu.length) {
    bad.push('🔴 NO FLOOR: the skip bin cannot make a single recipe, so a player with an empty '
      + 'live ledger and an empty pantry has no route back to cooking at any price');
  }
  if (!salvMenu.some((r) => (r.minLevel || 1) === 1)) {
    bad.push('🔴 NO FLOOR ON DAY ONE: the skip bin covers no level-1 recipe — a brand-new '
      + 'account that runs out of the grubstake is stuck');
  }
  /* B — SHAPE. The bin must be most of a beginner's kitchen and a minority of a
     grown one, and it must live on the cheap end of the board. Both are checked
     from the derived coverable set, so an added ingredient or a changed
     exclusion cannot quietly move them. */
  const covered = Object.create(null);
  for (const r of salvMenu) covered[r.id] = 1;
  const topMenu = menuForLevel(ECON.MAX_LEVEL);
  const share = topMenu.length ? (salvMenu.length / topMenu.length) : 0;
  if (share > ECON.SALVAGE_SHARE_MAX) {
    bad.push('🔴 THE FLOOR IS THE KITCHEN: the skip bin can make ' + salvMenu.length + ' of '
      + topMenu.length + ' dishes (' + Math.round(share * 100) + '%, max '
      + Math.round(ECON.SALVAGE_SHARE_MAX * 100) + '%) — Cinder alone runs most of the menu and '
      + 'the live-resource loop the player asked for is decorative');
  }
  let inSum = 0, inN = 0, outSum = 0, outN = 0;
  for (const r of topMenu) {
    if (covered[r.id]) { inSum += r.basePrice; inN++; } else { outSum += r.basePrice; outN++; }
  }
  const inMean = inN ? inSum / inN : 0, outMean = outN ? outSum / outN : 0;
  if (!outN) {
    bad.push('🔴 THE FLOOR IS THE KITCHEN: there is no dish the skip bin cannot make');
  } else if (!(inMean * ECON.SALVAGE_VALUE_GAP <= outMean)) {
    bad.push('🔴 THE FLOOR IS NOT ON THE CHEAP END: skip-bin dishes average ' + Math.round(inMean)
      + ' Cinder against ' + Math.round(outMean) + ' for the ones that need the city — the city '
      + 'must be worth at least ' + ECON.SALVAGE_VALUE_GAP + '× a dish, or building it is optional');
  }
  for (const r of salvMenu) {
    const cost = salvageCinderCost(r.id);
    const worstPay = r.basePrice * ECON.POP_PAY_FLOOR * ECON.RUSH_PAY_MIN;
    if (!(cost < worstPay)) {
      bad.push('🔴 THE FLOOR IS UNDERWATER: ' + r.id + ' costs ' + cost
        + ' Cinder out of the skip bin against a worst-case payout of '
        + Math.round(worstPay * 10) / 10 + ' — a stranded player cooking it goes BACKWARDS');
    }
  }
  /* And the other direction: the bin must never be the CHEAP route, or a player
     with money simply never builds a Hydroponics Bay. Per unit, always dearer. */
  for (const s of _SALVAGE_LINES) {
    const core = _SUPPLY_BY_ING[s.out.ing];
    if (!core) { bad.push('skip-bin line ' + s.id + ' has no core line behind it'); continue; }
    const sp = s.cost.cinder / Math.max(1, s.out.qty);
    const bp = ((core.cost && core.cost.cinder) || 0) / Math.max(1, core.out.qty);
    if (!(sp > bp)) {
      bad.push('🔴 THE SKIP BIN IS THE CHEAP ROUTE: ' + s.id + ' is ' + sp.toFixed(2)
        + ' Cinder/unit against the core line\'s ' + bp.toFixed(2)
        + ' — nobody would ever spend a resource again');
    }
    for (const k in s.cost) {
      if (k !== 'cinder') bad.push('skip-bin line ' + s.id + ' costs a live resource (' + k
        + ') — then it is not a route for a player who has none');
    }
    if (s.out.qty >= core.out.qty) {
      bad.push('skip-bin line ' + s.id + ' is not a smaller crate than the core line ('
        + s.out.qty + ' vs ' + core.out.qty + ')');
    }
  }
  /* The grubstake and the floor have to be the same kitchen: every ingredient
     the grant hands out that the bin does NOT stock is one the player can only
     replace out of the live ledger. That is intentional (it is what makes the
     Classic Burger need a supply chain) — but if it ever became ALL of them,
     the floor would exist on paper and be unreachable in play. */
  const grantedOnly = Object.keys(ECON.START_PANTRY).filter((id) => !_SALVAGE_BY_ING[id]);
  if (grantedOnly.length >= Object.keys(ECON.START_PANTRY).length) {
    bad.push('🔴 THE FLOOR IS UNREACHABLE FROM THE GRUBSTAKE: the skip bin stocks none of the '
      + 'ingredients a new kitchen opens with');
  }

  // ── the day clock must be self-consistent ──
  const hours = ECON.CLOSE_HOUR - ECON.OPEN_HOUR;
  if (hours <= 0) bad.push('ECON: CLOSE_HOUR must be after OPEN_HOUR');
  if (ECON.HOUR_MS !== Math.round(ECON.DAY_MS / hours)) bad.push('ECON: HOUR_MS !== DAY_MS / hours');
  if (ECON.RUSH_CURVE.length !== hours) bad.push('ECON: RUSH_CURVE should have one entry per open hour');

  // ── tip weights are a blend, not a stack ──
  const tw = ECON.TIP_PATIENCE_W + ECON.TIP_QUALITY_W + ECON.TIP_POP_W;
  if (Math.abs(tw - 1) > 0.001) bad.push('ECON: tip weights must sum to 1 (got ' + tw + ')');

  /* ── 🔴 NO EMPTY LEVEL-UPS. THIS CHECK HAS NOW FAILED TWICE AND BOTH TIMES
        THE HOLES MOVED INSTEAD OF CLOSING.
        Round one: blank LEVEL UP toasts at 19, 21 and 23–25. Round two, after
        the retune: 20, 36, 37, 38 and 39 — four consecutive dead level-ups
        leading into the cap. The check existed; the check was scoped to
        2..MAX_LEVEL−5, and the exemption was defended as "the top five levels
        are the trophy for getting there".
        🔴 THAT EXEMPTION IS GONE. A trophy is a thing you are handed, and four
        blank toasts in a row is not a thing being handed to anybody — it is the
        hole, wearing the comment as a hat. The horizon is now MAX_LEVEL itself:
        every level from 2 to 40 must unlock SOMETHING, and level 40 earns its
        place with the Flagship capstone rather than with an exemption.
        If you extend the ladder past 40, you extend the unlocks with it. */
  const empty = [];
  for (let lv = 2; lv <= ECON.MAX_LEVEL; lv++) {
    const u = unlocksAt(lv);
    if (!u.recipes.length && !u.supplies.length && !u.upgrades.length && !u.convoys.length) empty.push(lv);
  }
  if (empty.length) bad.push('EMPTY LEVEL-UP at level(s) ' + empty.join(', ') + ' — unlocksAt() returns nothing and the toast will be blank');

  /* ── 🔴 THE FIVE THINGS THE PLAYER ASKED FOR, BY NAME, ON THE FIRST SHIFT.
        The request was "pizzas, burgers, hot dogs… serve npcs through drive
        ways… setup shipment to send to another player's city on a convoy".
        What shipped put burgers 36 real minutes away, the first convoy 48 and
        pizza 2h24. That is not a bug any of the other checks in this function
        could see, because every individual number was internally consistent —
        which is exactly why it needs a check of its own that reads the REQUEST
        rather than the table.
        ⚠ This is a floor on the DESIGN, not a style rule. If a future retune
        genuinely wants a food family gated, delete this check deliberately and
        say why. Do not let it rot into a comment nobody runs. */
  const DAY_ONE = { dogs: 'hot dogs', burgers: 'burgers', pizza: 'pizza' };
  for (const cat in DAY_ONE) {
    if (!RECIPES.some((r) => r.cat === cat && (r.minLevel || 1) === 1)) {
      bad.push('🔴 NO ' + DAY_ONE[cat].toUpperCase() + ' ON THE FIRST SHIFT: the player named '
        + DAY_ONE[cat] + ' by name and no ' + cat + ' recipe is minLevel 1');
    }
  }
  if (!CONVOY_TIERS.some((t) => (t.minLevel || 1) === 1)) {
    bad.push('🔴 NO CONVOY ON THE FIRST SHIFT: every tier is level-gated, so the Convoy tab opens as a dead LOCKED button');
  }

  /* ── 🔴 THE ENTRY CONVOY MUST FIT THE ENTRY KITCHEN. A twelve-box van against
        an eight-plate pass is a load the player can never complete and no
        screen explains why — measured live: 8 dishes on the pass produced
        "SEND IT — 8 BOXES" against a 12-box van, with the missing four behind a
        34,000-Cinder heat lamp at level 6. A cap the player cannot see is a cap
        they read as a bug. */
  for (const t of CONVOY_TIERS) {
    if ((t.minLevel || 1) <= 1 && t.capacity > passCap(null)) {
      bad.push('CONVOY_TIERS ' + t.id + ': capacity ' + t.capacity + ' exceeds the base PASS_CAP ('
        + passCap(null) + ') — a level-1 player can never fill it');
    }
    if (t.transitMs < (ECON.CONVOY_MIN_TRANSIT_MS || 0)) {
      bad.push('CONVOY_TIERS ' + t.id + ': transitMs ' + t.transitMs + ' is under CONVOY_MIN_TRANSIT_MS ('
        + ECON.CONVOY_MIN_TRANSIT_MS + ') — that is a vending machine, not logistics');
    }
    if (t.capacity < (ECON.CONVOY_MIN_DISHES || 1)) {
      bad.push('CONVOY_TIERS ' + t.id + ': capacity is below CONVOY_MIN_DISHES — the tier can never be launched');
    }
  }

  /* ── 🔴 HONOURING A PROMISE MUST PAY MORE THAN IGNORING IT. §MODIFIERS in
        drivethru.js judges 'honoured' | 'broken' | 'unproven' against what the
        player actually built; the MOD_PAY_* keys price that verdict. An
        `extra` costs real pantry units, so the floor on an honoured line has to
        clear the priciest single unit in the game or honouring the fussiest
        order on the cheapest dish still loses money. Recomputed from
        SUPPLY_RECIPES so a price rise on patties cannot quietly re-open it. */
  let dearest = 0, dearestId = '';
  for (const sup of SUPPLY_RECIPES) {
    const per = ((sup.cost && sup.cost.cinder) || 0) / Math.max(1, sup.out.qty);
    if (per > dearest) { dearest = per; dearestId = sup.out.ing; }
  }
  if (!(ECON.MOD_PAY_HIT_MIN > dearest)) {
    bad.push('🔴 MOD_PAY_HIT_MIN (' + ECON.MOD_PAY_HIT_MIN + ') does not clear the priciest pantry unit ('
      + dearestId + ', ' + Math.round(dearest * 100) / 100 + ' Cinder) — honouring "extra ' + dearestId + '" LOSES money');
  }
  if (!(ECON.MOD_PAY_MISS < 0 && ECON.MOD_PAY_MISS <= -ECON.MOD_PAY_HIT)) {
    bad.push('MOD_PAY_MISS must be negative and at least as large as MOD_PAY_HIT — otherwise ignoring the ticket is a small tax, not a mistake');
  }
  if (!(ECON.MOD_TIP_MISS < 0 && ECON.MOD_TIP_MISS <= -ECON.MOD_TIP_HIT)) {
    bad.push('MOD_TIP_MISS must be negative and at least as large as MOD_TIP_HIT');
  }
  if (ECON.MOD_PAY_UNPROVEN !== 0 || ECON.MOD_TIP_UNPROVEN !== 0) {
    bad.push('🔴 an UNPROVEN modifier must be worth exactly zero in both directions — a guess that moves money is worse than an honest blank');
  }

  /* ── 🔴 THE PANTRY MUST NOT BE BRICKABLE. Making PANTRY_CAP a true total
        created an unrecoverable state: one ingredient bought to refusal and
        every other bin is permanently unbuyable (measured: 894 of 900 with
        roll=862, and buySupply('sup_patty') returned CAP forever, with the
        refusal toast advising a cook-down that needed an ingredient that could
        no longer be bought). PANTRY_BIN_PCT is what makes that arithmetically
        impossible; these are the invariants that keep it that way. */
  const binShare = ECON.PANTRY_BIN_PCT;
  if (!(binShare > 0 && binShare < 0.5)) {
    bad.push('PANTRY_BIN_PCT must be in (0, 0.5) — at 0.5 two maxed bins brick the pantry');
  }
  const binCap = Math.max(ECON.PANTRY_BIN_MIN, Math.round(ECON.PANTRY_CAP * binShare));
  const binsToBrick = Math.ceil(ECON.PANTRY_CAP / Math.max(1, binCap));
  if (binsToBrick < 5) {
    bad.push('PANTRY SOFT-LOCK: only ' + binsToBrick + ' maxed bins fill the whole pantry — ordinary play can brick the kitchen');
  }
  // One tap must never be able to fill a bin to its ceiling.
  let fattestBatch = 0;
  for (const sup of SUPPLY_RECIPES) fattestBatch = Math.max(fattestBatch, sup.out.qty * ECON.SUPPLY_MAX_BATCHES);
  if (fattestBatch > binCap) {
    bad.push('SUPPLY_MAX_BATCHES: one tap buys ' + fattestBatch + ' units against a per-bin ceiling of '
      + binCap + ' — a single fat-fingered tap fills a bin to refusal');
  }

  /* ═══════════════════════════════════════════════════════════════════════
     🔴🔴 THE DIFFICULTY WALL — CHECKED ON EVERY RACK, AT EVERY LEVEL.
     ═══════════════════════════════════════════════════════════════════════
     🔴 THIS CHECK WAS ADVISORY AND IT SHOWED. Round 2 asked for a capacity
        model; it got a good one. Round 3 asked why nothing enforced it, and the
        answer was in the scope: the model was called for a STOCK rack at levels
        1..14 and nowhere else, while capacityModel(20..40, []) returned ok:false
        ("peak demand is more than 2.25× capacity — unwinnable, not hard") and
        capacityModel(40, ALL) returned ok:false from the other end. The file's
        own model was saying "broken" in two places and assertDataSane() was
        returning []. That is worse than having no model, because a green check
        is read as a verified one.

     🔴 WHY IT WAS SCOPED THAT WAY, AND WHY THE SCOPE WAS THE BUG: there is only
        ONE band in the file (WALL_RATIO_MIN..MAX) and it describes a STOCK rack.
        Judging a fully-kitted level-40 kitchen against it is a category error —
        a kitten that comfortable is what the player SPENT 800,000 Cinder on.
        The fix is not a wider band, it is three bands for three racks, which is
        what WALL_RATIO_*, WALL_KITTED_* and WALL_MAXED_* now are.

     WHAT MOVED TO MAKE THIS PASS HONESTLY, rather than by moving a threshold:
     SPAWN_MIN_MS 2100 → 2250. The stock ratio plateaus from level 20 because
     SPAWN_MIN_MS caps arrivals, and the plateau sat at 2.26 against a ceiling of
     2.25 — one hundredth over "unwinnable". Its old derivation was one-sided
     ("the interval at which the hardest hour lands just inside a MAXED
     kitchen's reach") and a one-sided derivation is why it landed a hair wrong.
     It is now the interval at which BOTH ends hold: stock stays inside the wall
     band at every level (peak 2.11) and a maxed rack still clears it (0.85).
     ═══════════════════════════════════════════════════════════════════════ */
  const wallRow = (label, cm, lo, hi) => {
    if (cm.bottleneck !== 'rack') {
      bad.push('🔴 WALL BROKEN — ' + label + ': ' + cm.why);
      return;
    }
    if (cm.peakRatio < lo || cm.peakRatio > hi) {
      bad.push('🔴 WALL BROKEN — ' + label + ': ' + cm.slots + ' slots (' + cm.handSlots
        + ' workable) ≈ ' + cm.capacityPerHour + ' dishes/in-game-hour, pass ' + cm.passPerHour
        + '/hr, against a peak demand of ' + (cm.peak ? cm.peak.demand : 0) + ' — ratio '
        + cm.peakRatio + ', wanted ' + lo + '..' + hi + '. '
        + (cm.why || (cm.peakRatio < lo ? 'too easy for this rack' : 'too hard for this rack')));
    }
  };
  // 1. STOCK, every level. A stock rack is a real configuration early and a
  //    hypothetical one late — but a hypothetical the player can BE in, and the
  //    band is what stops the late game becoming arithmetically unwinnable for
  //    somebody who banks their Cinder instead of spending it.
  for (let lv = 1; lv <= ECON.MAX_LEVEL; lv++) {
    wallRow('level ' + lv + ', STOCK rack', capacityModel(lv, [], ECON.POP_START),
      ECON.WALL_RATIO_MIN, ECON.WALL_RATIO_MAX);
  }
  /* 2. LEVEL-APPROPRIATE, across the ladder — the rack a player who keeps up
        with the shop is holding. This is the configuration MOST play happens in
        and NOTHING checked it before. Sampled rather than swept because the
        interesting thing is the shape, and a sweep would bury a real failure in
        forty near-identical lines. Two levels of purchase lag is checked too:
        the band must absorb a player who is a couple of upgrades behind, or it
        is describing a shopping list rather than a kitchen. */
  for (const lv of [3, 6, 8, 12, 16, 20, 26, 32, ECON.MAX_LEVEL]) {
    wallRow('level ' + lv + ', rack unlocked by then',
      capacityModel(lv, expectedUpgradesFor(lv, 0), ECON.POP_START),
      ECON.WALL_KITTED_MIN, ECON.WALL_KITTED_MAX);
    wallRow('level ' + lv + ', rack two levels behind the shop',
      capacityModel(lv, expectedUpgradesFor(lv, 2), ECON.POP_START),
      ECON.WALL_KITTED_MIN, ECON.WALL_KITTED_MAX);
  }
  /* 3. FULLY MAXED at popularity 100 — the hardest hour the game can produce.
        TWO-SIDED: the ceiling proves the ladder CLEARS the wall (there is an
        amount of money that makes the dinner rush survivable), and the floor
        proves the top of the ladder was worth climbing. A maxed kitchen at 0.30
        would mean the last fifteen levels of upgrades sold comfort nobody was
        short of, which is the failure the UPGRADES header warns about and which
        nothing measured. */
  const cmMax = capacityModel(ECON.MAX_LEVEL, UPGRADES.map((u) => u.id), 100);
  if (cmMax.peakRatio > ECON.WALL_MAXED_MAX) {
    bad.push('UPGRADE LADDER DOES NOT CLEAR THE WALL: fully kitted peak ratio is '
      + cmMax.peakRatio + ' (max ' + ECON.WALL_MAXED_MAX
      + ') — there is no amount of money that makes the rush survivable.');
  }
  if (cmMax.peakRatio < ECON.WALL_MAXED_MIN) {
    bad.push('THE TOP OF THE LADDER BUYS NOTHING: fully kitted peak ratio is '
      + cmMax.peakRatio + ' (min ' + ECON.WALL_MAXED_MIN
      + ') — a maxed kitchen never has a rush to answer, so the late upgrades are decoration.');
  }

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
