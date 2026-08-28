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
   🔴 THERE IS NO ROUTE TO A DISH THAT DOES NOT SPEND LIVE RESOURCES, AND THAT
     SENTENCE IS ENFORCED, NOT ASPIRED TO. The restock counter is a three-rung
     ladder and every rung moves the 14-id ledger:
       1. the CORE lines (below) — the city, the businesses, battle salvage;
       2. the SCRAP DEALER (§🗑) — half a crate, the SAME food, and Cinder
          instead of the water / dna / supplies the core line wanted;
       3. the RELIEF DROP (§🪂) — the only Cinder-only door in the feature, and
          what comes out of it is not pantry stock but live `food` and `water`
          landing in the ledger at FIFTEEN times the game's own board price —
          except for the bottom rung, which is free, dry-gated and once a day.
     assertDataSane() checks all of that: no crate may cost Cinder alone, no
     recipe may have an all-Cinder cheapest route, no recipe may be buildable
     without spending live `food`, and the Cinder → parcel → dish → Cinder loop
     must lose money on every dish at the best pay multipliers the game hands
     out. Read the two blocks before you touch either table. Three rounds of
     this feature shipped a dead end and the fourth shipped a Cinder printer to
     fix it — measured at ten days, 188 dishes and ZERO live resources spent.

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
     `SUPPLY_RECIPES` is this table plus the derived scrap-dealer lines (§🗑,
     immediately below). Everything downstream — buySupply(), the supplies
     sheet, unlocksAt() — reads the export and therefore sees both. This half is
     private because `INGREDIENTS[].batch` and `INGREDIENTS[].foodPerUnit` must
     come from THESE rows and never from a dealer row; see `_SUPPLY_BY_ING`.

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
   🗑 THE SCRAP DEALER — RUNG TWO OF THE RESTOCK LADDER.
   ----------------------------------------------------------------------------
   🔴🔴 THIS IS THE FOURTH ATTEMPT AT ONE BUG AND THE SECOND ATTEMPT AT ITS
        OPPOSITE. Read the whole history before you retune anything here,
        because rounds 3 and 4 each fixed one side by breaking the other.

     Round 1: a brand-new account (gems 0, salvage {}, pantry {}) opened the
       kitchen and the FIRST tap returned "Not enough Food — you need 5 and have
       0." Dead end, sixty seconds in.
     Round 2: START_PANTRY was granted properly. The dead end moved to minute 5,
       because 120 units is 21 dishes against a 51-ticket day and all 25 core
       supply lines cost a live resource a new account holds ZERO of.
     Round 3: the grubstake was sized against a whole shift (ECON.START_PANTRY)
       and a skip bin was added that sold pantry stock for CINDER ALONE.
     Round 4 measured that bin and it had closed the dead end by DELETING THE
       FEATURE. On a real 14-id ledger wired to a real wallet, a fresh account:
         3 days:  minted 27,340 · burned 9,754 · NET +17,586 Cinder ·
                  live resources consumed: NONE
        10 days:  minted 56,608 · burned 33,066 · NET +23,542 Cinder ·
                  live resources consumed: NONE
       188 dishes served and `wallet.resOut` was the literal empty object. The
       kitchen had become a Cinder machine that runs on Cinder, in a game whose
       own code reads "🚫 MATCH CINDER REMOVED — admin removed the post-battle
       Cinder grant to protect currency value" (index.html:152809) with every
       GEM_REWARDS constant set to 0, and whose recent history includes "Remove
       the NPC buyer queue from the car dealership — it was a Cinder faucet".
       The player did not ask for a cooking minigame. They asked for a cooking
       minigame FED BY what their businesses, their city builder and their
       battles produce. A private Cinder economy fails that request at a deeper
       level than any soft-lock does, and it fails it silently.

   🔴 SO THE RULE THIS ROUND IS ABSOLUTE, AND assertDataSane() ENFORCES IT:
      **THERE IS NO ROUTE TO A DISH THAT DOES NOT SPEND LIVE `food`.**
      Not one. Every crate on every rung of the ladder carries a live-resource
      leg, and the emergency rung does not BYPASS the ledger — it FILLS it, out
      of the player's wallet, at a rate nobody with a Hydroponics Bay would ever
      pay. The ledger flows either way; the only question is how badly you are
      being fleeced on the way in.

   ── THE LADDER, FOUR RUNGS, ALL FOUR MOVING THE 14-ID LEDGER ──────────────
     1. 🏙 THE CORE COUNTER (_SUPPLY_CORE, 25 lines). Full crate, cheapest
        Cinder, and the full resource spread — food AND water AND dna AND
        supplies AND fuel AND corruptedEssence. This is the city builder, the
        businesses and battle salvage. It is the only rung that is actually
        good, and everything else on this page exists to make a player want it.
     2. 🛻 THE SCRAP DEALER (_SALVAGE_LINES, 17 lines, below). HALF a crate,
        THE SAME `food` per unit, and CINDER INSTEAD of the water / dna /
        supplies / fuel / essence the core line wanted. It is the rung for a
        player whose farm is running but whose Gene Vault is not — you keep
        cooking without a dna line, and you pay a stranger for the privilege.
     3. 🪂 THE RELIEF DROP (RELIEF, below). Cinder → LIVE RESOURCES, at
        FIFTEEN times what the game itself values them at — see
        ECON.RELIEF_MARKUP, and ⚠ check the digit against the table rather
        than trusting this sentence: it said "seven" for a round after the table
        said twelve. It is the only door in the feature that takes Cinder alone,
        and what comes out the other side is not pantry stock — it is `food` and
        `water` landing in the 14-id ledger, where the rest of the game can see
        them. That is the
        whole trick — as far as it goes.
     4. 🤝 THE BARTER COUNTER (§🤝, below `ECON`). LIVE RESOURCES → pantry, at
        the worst rate in the game and with NO CINDER LEG AT ALL. It is the only
        door a player at ◈0 can open, and it exists because rung three's output
        was not rung two's input: the free drop paid `food` and `water` into a
        ledger every crate on this sheet refused to be paid in. Measured at HEAD
        9d41440 that was a permanent, silent soft-lock — fourteen days, 112 food
        banked, zero crates affordable, zero dishes cooked. Read §🤝 before you
        touch a number in it; it is a zero-Cinder row, which is the exact thing
        this file spent three rounds refusing to ship, and it is safe only
        because it is the dearest rung by every measure that matters.

     🔴 TOGETHER — AND ONLY TOGETHER — THE FOUR MAKE BOTH HALVES TRUE AT ONCE:
        a player with an empty ledger AND an empty wallet is NEVER refused with
        no way out, and there is still no way to cook anything without spending
        live resources. Rung three alone was not enough and said it was.

   🔴 WHY RUNG 2 CHARGES THE FULL `food` AND NOT A DISCOUNTED ONE. The obvious
      design — "half a crate, half the food, and Cinder for the difference" —
      was written, priced and thrown away, because it quietly reopens the convoy
      food printer. A claimed convoy pays ECON.CONVOY_FOOD_PER_DISH units of
      live `food` per dish. convoyGuardOk()'s food wall compares that against
      `recipe.foodCost`, which is computed from the CORE lines. Discount the
      bin's food leg and a bin-built Hot Dog costs 0.57 food and delivers 1.0 —
      Cinder in, food out, printer open, and both existing walls report ok:true
      while it runs. Charging the same rate (rounded UP, see `_salvageLine`)
      makes the bin route provably no cheaper in food than the core route, which
      is what convoyGuardOk()'s new fourth wall now asserts directly.
      💡 AND IT IS THE BETTER GAME ANYWAY. "The scrapyard stretches your food"
        is a discount. "The scrapyard sells you a frank without a Gene Vault"
        is a DECISION, and it is the decision the premise wants the player
        making — Cinder is abundant, dna is not, and the bin is where you find
        out which one you are short of.

   ── THE THREE FLOORS THAT KEEP RUNG 2 A FLOOR AND NOT A KITCHEN ────────────
      All three are checked in assertDataSane(); none of them is a mood.
      1. 🍽 IT HAS NO SPECIALITY COUNTER. It stocks bread, dry store, veg,
         condiments, ice, fry oil, scrap links and ONE grim reclaimed protein —
         and NOT `chicken`, `bacon`, `mayo`, `milk`, `pepperoni`, `mushroom`,
         `coffee` or `chili`. Which dishes that leaves buildable is a DERIVED
         fact, not a list anybody types.
         ⚠ `patty` USED TO BE ON THE EXCLUSION LIST AND ITS REMOVAL IS
           DELIBERATE. The old comment said "IT HAS NO MEAT COUNTER" and meant
           it, and the cost of meaning it was measured: the level-1 menu
           promises THREE dishes — Hot Dog, Classic Burger, Margherita — and the
           restock ladder sustained TWO of them, because the Classic Burger
           needs a patty and no rung below the core line stocked one. A first
           session that shows you three dishes and can only keep feeding you two
           is the round-1 dead end wearing a better coat: the burger just stops
           existing on day two and nothing on screen says why. So the bin gets
           exactly ONE protein line and it is the worst line on the sheet —
           quarter crate (see `minBatch` against sup_patty's qty of 8), the
           steepest Cinder-per-unit in the table, and the full `food` leg.
           `chicken`, `bacon` and the rest stay out: they are levelling rewards,
           not day-one promises, and nothing breaks if the ladder cannot reach
           them.
      2. 💸 IT CHARGES YOU FOR WHAT YOUR CITY WOULD HAVE PUT IN FREE. The Cinder
         price is the core line's own Cinder leg, PLUS a per-unit surcharge for
         every NON-FOOD live resource that line would have eaten, PLUS a
         dealer's markup. It lands strictly dearer per unit than the core line
         everywhere, and heaviest exactly where the city matters most (`dna` 30
         against `water` 2 — a scrap frank costs half again what a farmed one
         does, and that is the Gene Vault talking).
         ⚠ THE SURCHARGE TABLE IS NOT A MARKET PRICE AND MUST NOT BE READ AS
           ONE. The first draft used the game's own cold-storage valuations
           (index.html:195218 — food 4, water 6, dna 42) on the grounds that
           borrowing a real number beats inventing one. Measured, that is 27–83%
           of the SALE PRICE of the cheap end of this menu, and it put the
           Fountain Soda, the Side Salad and the Classic Burger UNDERWATER on
           scraps: a stranded player cooking them went backwards. The table is
           derived from the constraint instead — ordered by the game's relative
           valuation (dna ≫ fuel > energyDrink > supplies > water) and scaled
           until every dish the bin can build still clears the WORST pay
           multipliers the game can hand out.
           🔴 `food` IS NO LONGER IN THIS TABLE AND MUST NEVER BE PUT BACK. A
              food entry here is exactly the "buy your way past the ledger"
              line that round 4 shipped. Food is paid in food.
      3. 📦 HALF A CRATE AT A TIME. SALVAGE_BATCH_PCT halves `out.qty`, so the
         same restock is twice the taps and twice the trips. Friction, not
         economy — but it is the part the player FEELS, and feeling it is what
         sends them to the city builder. It is also what makes the bin the only
         rung a nearly-broke player can afford at all: half a crate is half the
         cash up front.

   ⚠ THE LINES ARE DERIVED, NOT TYPED. Same rule as INGREDIENTS[].batch: two
     hand-kept copies of one price diverge, and this one would diverge silently
     in the direction of "the scrap dealer is cheaper than the farm", which is
     the exact failure this whole block exists to prevent. Retune the KNOBS.
   ════════════════════════════════════════════════════════════════════════════ */
const _SALVAGE = {
  /* 🔴 WHAT THE DEALER DOES **NOT** HAVE. Stated as an exclusion, not a list of
     inclusions, and that is deliberate: an inclusion list silently fails to
     cover a NEW ingredient (the floor shrinks and nobody notices), while an
     exclusion list silently covers one (which assertDataSane's share and value
     checks catch immediately). Fail towards the loud direction. */
  notStocked: ['chicken', 'bacon', 'mayo', 'milk', 'pepperoni', 'mushroom', 'coffee',
    /* ⚠ `pickle` IS HERE FOR THE SAME ECONOMIC REASON AS `chili`, AND THE CHECK
       IS WHAT PUT IT HERE TOO. Nothing about a scrapyard makes brined spears
       implausible — this is arithmetic. Adding `patty` to the bin (see the
       block comment) made the Double Stack bin-buildable as a side effect, and
       assertDataSane() immediately reported "THE FLOOR IS UNDERWATER:
       burgerDouble costs 122.2 Cinder out of the skip bin against a worst-case
       payout of 85.0" — two patties and two handfuls of cheese is 0.7 dna a
       dish, and the surcharge that makes a scrap frank honest makes a scrap
       Double Stack a TRAP: a row on the sheet that a player can tap, afford,
       cook and lose money on, with nothing on screen saying so. `pickle` is the
       only ingredient the Double Stack has that the Classic Burger does not, so
       excluding it takes the trap off the board and leaves the day-one promise
       intact. It costs nothing else: pickle's core line is level 5, no level-1
       recipe uses one, and the only other dish it gates (the Chicken Sandwich)
       is already out of the bin's reach on `chicken` alone. */
    'pickle',
    /* ⚠ `chili` IS HERE FOR AN ECONOMIC REASON, NOT A FLAVOUR ONE, AND THE
       CHECK IS WHAT PUT IT HERE. It is a prepared item and the priciest
       condiment on the board, and the Chili Dog carries two of them on top of a
       frank and a handful of cheese against a 44% gross margin — the
       second-thinnest on the whole menu. With chili in the bin,
       assertDataSane() reported "THE FLOOR IS UNDERWATER: chiliDog costs 62.1
       Cinder against a worst-case payout of 61.2", i.e. a stranded player
       cooking the dish would go backwards by 0.9 Cinder and nothing on screen
       would say so. The pot is the kitchen's, not the scrapyard's. */
    'chili'],
  /* 🔴 THE SURCHARGE PER UNIT OF **NON-FOOD** LIVE RESOURCE THE BIN SAVES YOU.
     NOT a market price — see the long note above. ORDERED by the game's own
     relative valuation and SCALED by the floor invariant: every dish the bin
     can build must still pay at POP_PAY_FLOOR × RUSH_PAY_MIN.
     🔴 THERE IS NO `food` KEY HERE AND THERE MUST NEVER BE ONE. Food is the
        one resource the bin cannot sell you out of thin air — see the block
        comment and assertDataSane()'s FOOD IS NOT FOR SALE check. */
  resCinder: { water: 2, supplies: 4, dna: 30, energyDrink: 4, fuel: 8, corruptedEssence: 25,
               metal: 4, ammo: 5, medicine: 12, memoryShards: 50, wood: 2, stone: 2, cloth: 3 },
  /* THE DEALER'S MARKUP. ⚠ THE FIRST DRAFT HAD NO SUCH KNOB and did not need
     one, because back then the surcharge covered EVERY resource including food
     and was penalty enough on its own. Now that food is paid in food, the
     surcharge only covers the non-food legs — and five core lines
     (`sup_potato`, `sup_tomato`, `sup_onion`, plus anything else priced in food
     alone) have NO non-food legs at all, so without a markup their bin twins
     would price at exactly the core rate and assertDataSane's "the skip bin is
     the cheap route" check would fire on all five. One knob per idea:
     `resCinder` is the penalty for skipping your city, `markup` is the dealer's
     cut, and `batchPct` is the friction. */
  markup: 1.12,
  batchPct: 0.5,     // half a crate
  minBatch: 2,       // …but never so small the row is a joke. 🔴 WAS 3, AND THE
                     //    CHANGE IS LOAD-BEARING: sup_patty is a crate of 8, so
                     //    at batchPct 0.5 its bin twin is 4 — a floor of 3 was
                     //    fine, but the reclaimed-protein line is supposed to be
                     //    the grimmest row on the sheet and a floor that rounds
                     //    it UP would have been the table arguing with itself.
                     //    2 is "a smaller crate than any core line", which is
                     //    the only thing this floor actually has to guarantee.
  minLevel: 1,       // 🔴 the FLOOR of the bin's own gate. See _salvageLine():
                     //    the real gate is max(this, core.minLevel).
};

/**
 * 🔴 THE ONE LIVE RESOURCE A SCRAP-DEALER LINE PAYS IN KIND. Everything else on
 * that core line is converted to Cinder (`_SALVAGE.resCinder`); this one is not.
 *
 * `food` whenever the core line has any, because food is the resource the whole
 * feature is about and the one the convoy printer guard is denominated in.
 * Otherwise the largest live leg the line has — which today means `sup_ice`
 * pays in `water`. ⚠ THAT FALLBACK IS NOT DECORATION. Without it `sal_ice`
 * priced out as `{ cinder: 17 }` and nothing else, i.e. the exact Cinder-only
 * crate this whole round exists to delete, hiding on the one core line in the
 * table that happens not to cost food. assertDataSane()'s "FOOD IS NOT FOR
 * SALE" check catches it now, but a rule that only holds because somebody
 * remembered is not a rule. Derive it.
 */
function _salvagePrimary(core) {
  const c = (core && core.cost) || {};
  if ((c.food || 0) > 0) return 'food';
  let best = null, n = 0;
  for (const k in c) { if (k === 'cinder') continue; if (c[k] > n) { n = c[k]; best = k; } }
  return best;
}

/**
 * One scrap-dealer line derived from a core line. Pure; no side effects.
 *
 * 🔴 THE `food` LEG IS ROUNDED **UP**, AND THAT DIRECTION IS THE GUARD.
 *    Rounding down would let a bin-built dish embody less live food than the
 *    same dish built from core lines, which is exactly the gap a convoy claim
 *    pays into (see convoyGuardOk()'s fourth wall). Up is the dealer's wastage
 *    and it is also the only direction that can never open the printer.
 *
 * 🔴 THE LEVEL GATE IS max(bin floor, core line's own level), NOT the bin floor.
 *    It used to be a hardcoded 1 for every line regardless of what the core line
 *    cost, and the result was that for five ingredients the SCRAPYARD OUTRANKED
 *    THE CITY: `sal_oil`, `sal_syrup` and `sal_ice` were buyable at level 1
 *    against level-2 core lines, `sal_slaw` at 1 against 3, `sal_pickle` at 1
 *    against 5. A level-1 player could buy pickles they could not use until
 *    level 5, and the cheap route unlocked before the real one it is supposed to
 *    be a fallback FOR. The old comment — "a floor you unlock is not one" — was
 *    right about the floor and wrong about the ceiling. The floor still opens on
 *    the first shift for everything the level-1 menu needs, because every
 *    level-1 recipe is built from level-1 core lines.
 */
function _salvageLine(core) {
  const coreQty = Math.max(1, core.out.qty | 0);
  const qty = Math.max(_SALVAGE.minBatch, Math.round(coreQty * _SALVAGE.batchPct));
  const primary = _salvagePrimary(core);
  let perUnit = ((core.cost && core.cost.cinder) || 0) / coreQty;
  for (const key in (core.cost || {})) {
    if (key === 'cinder' || key === primary) continue;
    perUnit += (core.cost[key] * (_SALVAGE.resCinder[key] || 0)) / coreQty;
  }
  const cost = { cinder: Math.ceil(perUnit * qty * _SALVAGE.markup) };
  if (primary) cost[primary] = Math.max(1, Math.ceil((core.cost[primary] / coreQty) * qty));
  return {
    id: 'sal_' + core.out.ing,
    out: { ing: core.out.ing, qty },
    cost,
    minLevel: Math.max(_SALVAGE.minLevel, core.minLevel || 1),
    /* 🔴 THE TWO FIELDS EVERY OTHER FILE NEEDS. `kind` lets the renderer group
       these under one heading instead of doubling the length of a 25-row sheet
       on a 360px phone; `salvageOf` points back at the core line so a row can
       say "or bring your own" next to the real price. Neither is read by the
       sim — buySupply() only ever looks at out/cost/minLevel — so a renderer
       that ignores both still works, it just reads worse. */
    kind: 'salvage',
    salvageOf: core.id,
    blurb: 'Scrap-dealer stock. Half a crate, the same food, and Cinder instead of everything else.',
  };
}
const _SALVAGE_LINES = _SUPPLY_CORE
  .filter((s) => _SALVAGE.notStocked.indexOf(s.out.ing) === -1)
  .map(_salvageLine);

/* 📦 `export const SUPPLY_RECIPES` USED TO BE HERE AND IS NOW DECLARED BELOW
   ECON, and that move is not cosmetic. The counter gained a fourth rung this
   round — the barter counter (§🤝) — whose prices are derived from the game's
   own cold-storage board, `ECON.RES_RETAIL_CINDER`. `ECON` is a module `const`
   declared 1,000 lines below this point, so pricing a barter line up here reads
   it inside its temporal dead zone and the whole module throws AT IMPORT TIME,
   on every page load of a 223k-line app (CONTRACT §1: "must not throw at import
   time"). The declaration therefore lives immediately after ECON and
   immediately before `_SUPPLY_BY_ID`, which is the first thing that reads it.
   ⚠ If you add a fifth rung, put it there too, and leave this note here — the
     next person to wonder why the export is not beside the table it starts
     with deserves the answer without a bisect. */

/* ════════════════════════════════════════════════════════════════════════════
   🪂 THE RELIEF DROP — RUNG THREE. THE ONLY CINDER-ONLY DOOR IN THE FEATURE,
      AND IT OPENS ONTO THE LEDGER, NOT PAST IT.
   ----------------------------------------------------------------------------
   🔴🔴 READ THIS BEFORE YOU TOUCH EITHER NUMBER. Two requirements pull in
        opposite directions and the previous three rounds each satisfied one by
        breaking the other:
          (a) a player with an EMPTY 14-id ledger must ALWAYS have a way back to
              cooking — a refusal with no exit is how rounds 1, 2 and 3 shipped;
          (b) a player who plays for a week must CONSUME LIVE RESOURCES in real,
              growing quantities, because a kitchen fed by their businesses,
              their city builder and their battles is the entire request — and
              round 4 satisfied (a) by deleting (b), measured at ZERO live
              resources consumed across ten days and 188 dishes.
        The answer is not to pick one. It is to make the emergency route COST
        the player instead of BYPASSING the ledger: this rung takes Cinder and
        puts LIVE RESOURCES into the 14-id ledger, where the city builder, the
        market, crafting and every other system can see them. The kitchen then
        spends those resources through the very same core and scrap-dealer lines
        as everybody else. There is no second economy. There is one ledger, and
        this is a bad, expensive, last-resort way to fill it.

   🔴 WHY IT IS A FIXED PARCEL AND NOT A SHOPPING LIST. The obvious shape is a
      counter that sells any resource by the unit. Priced honestly that is
      strictly better for the player than this and it is also a clean arbitrage
      surface: buy exactly the ledger id whose dish has the best margin, ignore
      the rest, and the effective rate collapses to the single cheapest line.
      A PALLET is what actually turns up when a relief flight lands — you take
      what is on it. Because no dish needs food and water in the ratio the
      pallet carries them, the effective price of the binding resource is always
      WORSE than the nominal one, without anybody having to type a bigger number
      to make that true. The surplus is not waste, either: `water` is a real
      resource the rest of the game uses, and it sits in the ledger afterwards.

   🔴 WHY food AND water AND NOTHING ELSE. The parcel is deliberately the LOWEST
      TIER of the fourteen. It cannot buy you out of a missing Gene Vault: no
      `dna`, so `sup_patty`, `sup_cheese` and `sup_sausage` stay shut, and the
      only way to a burger without a dna line is the scrap dealer's reclaimed
      protein at his price. No `supplies`, no `fuel`, no `corruptedEssence` —
      those are the city's and they stay the city's. What the parcel buys is a
      working kitchen at a loss, which is exactly what a floor should be.

   💸 THE PRICE IS DERIVED FROM THE GAME'S OWN VALUATION, NOT INVENTED.
      ECON.RES_RETAIL_CINDER is the cold-storage board (index.html:195218) and
      ECON.RELIEF_MARKUP is the multiple of it a relief flight charges. FIFTEEN
      times retail reads as extortionate because it IS extortionate, and it is
      the number that keeps the loop shut: assertDataSane()'s RELIEF LOOP check
      recomputes, for EVERY recipe and by the CHEAPEST route the game offers,
      whether Cinder → parcel → dish → Cinder can come out ahead at the best
      pay multipliers the game hands out. It must not, for any dish, ever. If
      you lower RELIEF_MARKUP that check is what fails, and the correct response
      is to put it back rather than to soften the check.
      ⚠ THIS PARAGRAPH SAID "SEVEN" FOR A ROUND AFTER THE TABLE SAID TWELVE,
        which is the same class of defect as the POP_WAVE inversion above: a
        comment asserting a RELATIONSHIP that the data had stopped honouring.
        It is written out as a word here and as a digit in ECON, and
        assertDataSane() now checks the RATIO rather than either number, so the
        wall is enforced even when the prose drifts again.
      ⚠ AND IT IS NOT AN ARBITRAGE DOOR FOR THE WIDER GAME EITHER. At fifteen
        times the board price nobody buys `food` here to feed a Gene Vault; the
        Hydroponics Bay is two orders of magnitude cheaper per unit. This is a
        Cinder SINK in a game that has spent commits removing Cinder faucets
        ("🚫 MATCH CINDER REMOVED", index.html:152809; "Remove the NPC buyer
        queue from the car dealership — it was a Cinder faucet"), which is the
        right direction for it to point.

   🔴 THE RUNG HAS TWO STEPS AND THE BOTTOM ONE IS FREE. THAT IS NOT GENEROSITY,
      IT IS THE ONLY THING THAT MAKES (a) LITERALLY TRUE.
      A PAID rung, however cheap, has a bottom: a player at zero Cinder AND zero
      of all fourteen resources is refused, and "no way out" is precisely the
      failure this ladder exists to delete. It is not a hypothetical either —
      the paid parcels are priced to LOSE money on purpose, so a player who
      lives on them walks their wallet down to nothing in a few days. Measured
      on a fresh account with the paid rung alone: day 2 served 5 and lost 91,
      day 3 served 0. That is the "slower dead end" this file has warned about
      since round 3, arriving exactly on schedule.
      So `rel_drop` costs nothing, and three things keep it from being a faucet:
        • 🔴 IT ONLY LANDS WHEN THE KITCHEN IS GENUINELY STRANDED. `whenDry`
          means the consumer gates it on kitchen.state.js's existing
          `dryCheck().cookable.length === 0` — nothing on the menu can be cooked
          right now. A working kitchen never sees it, so there is nothing for a
          working kitchen to farm, and cooking your own pantry to zero to
          collect five food is a worse trade than not doing it.
          ⚠ `cookable`, NOT `dry`, AND THE DIFFERENCE IS MEASURED. `dryCheck()`
            reports `dry` only when nothing is cookable AND no unlocked supply
            line is affordable, and that second clause has a false negative that
            fires exactly in the state this parcel exists for. A ten-day
            resourceless run ended holding 83 `water` and 0 `food` — which makes
            `sal_ice` (9 Cinder, 3 water) affordable forever, so `dry` stayed
            FALSE while the kitchen served 0 dishes and lost 89 tickets a day
            for eight consecutive days. Gating the drop on `dry` meant it never
            fired once in that run. `dry` is asking "can the player make any
            move at all"; this parcel is asking "is there anything left to
            cook", and ice on its own is not a dish.
        • 🔴 ONCE PER IN-GAME DAY, KEYED ON `Kitchen.shift.day`. Deliberately
          NOT once per shift: `closeShift(now,{forfeit:true})` does not roll the
          day (kitchen.state.js's day-roll branch is inside `if (!o.forfeit)`),
          so a shift counter would reset every time the panel was closed and
          reopened, which is two taps. `shift.day` only advances on a COMPLETED
          day and is already in the saved subset (CONTRACT §5).
        • 🔴 IT IS SMALL, AND assertDataSane() HOLDS IT SMALL. The check prices
          the best dish the parcel can build at the best multipliers the game
          hands out and compares the day's whole yield against
          ECON.RELIEF_FREE_DAILY_CINDER_MAX. For scale, the game's daily
          challenge pays 75 Cinder a day and round 4's kitchen minted 5,660.

   ⚠⚠ CONSUMER — THIS TABLE NEEDS ONE FUNCTION IN kitchen.state.js AND IT IS THE
      ONLY THING IN THIS FILE THAT IS NOT ALREADY WIRED. `buySupply()` cannot
      serve it: that function's whole job is `pantryPut(out.ing, …)`, and this
      rung must call `bridge().addRes(id, n)` instead — a different door, a
      different cap, a different failure mode (the stash cap, §7). It is
      DELIBERATELY NOT in SUPPLY_RECIPES for exactly that reason: a row in that
      array with no `out.ing` would reach buySupply() and be refused as
      "malformed", which is a worse lie than an unshipped rung. The whole
      signature the rest of this file is written against:

          export function buyRelief(reliefId, batches) → {ok,code,why,granted}

        1. look the row up in `DATA.RELIEF`; `BAD_ARG` if absent.
        2. `row.whenDry` → refuse with `CLOSED` unless
           `dryCheck().cookable.length === 0` (see the ⚠ above — NOT `.dry`),
           and say why: "The drop only comes when there is nothing left to cook."
        3. `row.perDay` → refuse with `CAP` if `K.reliefDay === K.shift.day`
           already. One new saved integer, `reliefDay`, in snapshot()/hydrate().
        4. preflight `gems() >= cost.cinder × n` (n is 1 for a `perDay` row);
           `spendGems`.
        5. for each id in `out`: `addRes(id, qty × n)` and then RE-READ
           `getRes(id)`. A short landing on the stash cap is
           `{ok:false, code:'CAP'}` with the Cinder returned via `addGems` —
           never a silent clamp. CONTRACT §7: `addRes()` returns without adding
           when the vault is full, and that is the trap that destroyed 215 units
           of a real player's resources.
        6. `K.reliefDay = K.shift.day`, `K.rev++`, emit `pantry:buy`, `save(true)`.

      🔴 IT EXISTS AS OF ROUND 6 (kitchen.state.js `buyRelief` / `reliefOffer`,
      CONTRACT §1) AND WIRING IT WAS NOT ENOUGH. Round 6 shipped the whole path
      end to end and the parcel still opened no door, because what it pays out —
      `food` and `water` — was not the input of any crate on the sheet. Every
      one of them wanted Cinder as well. The rung that closes that is §🤝, and
      the check that will not let it re-open is the escape-hatch block at the
      bottom of assertDataSane(): the crate set must be payable OUT OF THE
      PARCEL ALONE. "It is wired" is not "the player can use it", which is the
      same distinction as "it is in the table" and "somebody reads it".
   ════════════════════════════════════════════════════════════════════════════ */
const _RELIEF_RAW = [
  /* 🪂 THE FREE STEP. `whenDry` + `perDay` are the two gates; see above.
     🔴 SEVEN food IS NOT A FEEL. IT WAS FIVE, IT BOUGHT NOTHING, AND THE
        JUSTIFICATION IT SHIPPED WITH FOR SEVEN WAS ALSO WRONG — IN THE SAME
        WAY, ONE ROUND LATER.
        The shop sells WHOLE crates, so a parcel is only a rescue if it can buy
        a whole set for something on the level-1 menu. At 5 food it bought no
        complete set for any dish at any level, and the measured result on a
        fresh account was days 3–10 serving 0, 1, 0, 2, 0, 2, 0, 1 while the
        drop landed every single morning.
        Seven was then derived from `sal_roll + sal_sausage + sal_mustard =
        7 food + ◈110 → five Hot Dogs` — and that route wants ◈110 the stranded
        player does not have. The comment named the food and dropped the Cinder,
        exactly as the check under it did. MEASURED at HEAD 9d41440, ◈0, the
        drop landing every morning for fourteen days: 112 food, 64 water, zero
        crates affordable, zero dishes cooked, the kitchen silently shut.
        Seven is now the number the BARTER counter is sized against (§🤝, and
        `ECON.RELIEF_RESCUE_DAYS_MAX` is the check): the Hot Dog set costs
        19 food + 6 water there and no Cinder, so a player at ◈0 with an empty
        stash is cooking on the third drop, MEASURED and not asserted —
        scratch r12s/ramp.mjs, day 2 buys the set and serves three.
     ⚠ AND THE ◈110 SALVAGE ROUTE IS STILL THE POINT OF THE PARCEL, not a dead
       sentence: once a bootstrapped kitchen has minted its first Cinder, the
       SAME seven food buys five Hot Dogs through the scrap dealer instead of
       roughly one through the counter. Rung four is a jump-start; rung two is
       the road. That gap is what makes the ramp climb instead of level off.
     Three Hot Dogs is deliberately not a shift — it is enough to prove the
     kitchen works and nowhere near enough to run it, and that gap is the
     sentence the whole feature is built on: go and get some real food.
     ⚠ It carries `water` the Hot Dog set barely needs, and that is the
       fixed-pallet argument doing its job — the surplus is real ledger stock
       the rest of the game can use, and it stops the parcel being a shopping
       list tuned to one dish. `_BARTER.waterPct` is what stops the water half
       being inert: before that knob existed, fourteen days of drops banked 64
       water that nothing in the feature could spend. */
  { id:'rel_drop',   name:'Relief Drop',  icon:'🪂', out:{ food:7,  water:4  }, minLevel:1,
    free: true, whenDry: true, perDay: 1,
    blurb:'What the flight leaves when your yard is empty. One drop a day, and only when it is.' },
  { id:'rel_tin',    name:'Ration Tin',   icon:'🥫', out:{ food:2,  water:2  }, minLevel:1,
    blurb:'One tin, one jerrycan. Fifteen times what it is worth, and worth it exactly once.' },
  { id:'rel_pallet', name:'Relief Pallet',icon:'🪂', out:{ food:10, water:10 }, minLevel:1,
    blurb:'A whole pallet, air-dropped, at a price that tells you what it cost somebody else.' },
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
  /* 🔴 THE HORIZON, NOT THE WALL. kitchen.state.js's bumpPop() damps a delta
     by how much ROOM is left in the direction it pushes, but only inside the
     last this-many points of that room:
         room = delta > 0 ? (POP_MAX - pop) : (pop - POP_MIN)
         if (room < POP_SOFT_MARGIN) delta *= room / POP_SOFT_MARGIN
     WHY IT EXISTS: a bare add-and-clamp gave the meter two dead zones. Ten
     consecutive days per skill tier, level 12 + heat lamp, GOD/EXPERT/GOOD
     ended 93.8 / 93.5 / 92.0 — everybody roughly competent walked into the 100
     rail and stopped — and SLOPPY read 24.4, 11.6, then EIGHT CONSECUTIVE DAYS
     OF EXACTLY ZERO. A clamped meter is not feedback, it is a wall you have
     already hit.
     ⚠ 0 RESTORES THE HARD CLAMP AND BOTH DEAD ZONES WITH IT. This is not a
       safety rail with a sensible "off"; it is the mechanic. It is declared
       here rather than left as kitchen.state.js's fallback because it is
       tuning, and tuning belongs where the designer is looking — but a ZERO
       here is a regression, not a disable. */
  POP_SOFT_MARGIN: 40,
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
       POP_BURN, POP_TURNAWAY, POP_BALK, POP_JAM, POP_JUMP: scaled by 0.55.

     🔴🔴 AND THAT LAST LINE USED TO INCLUDE POP_WAVE, AND IT WAS A LIE THAT
        INVERTED THE ONLY DECISION IN THE DRIVE-THRU LANE. It read "POP_BURN,
        POP_WAVE, POP_TURNAWAY, POP_BALK, POP_JAM, POP_JUMP: all scaled by the
        same 0.55 as POP_LOST, so every RATIO the previous rounds tuned is
        preserved exactly". Check the arithmetic the sentence is making a claim
        about: POP_LOST went −3.5 → −1.0, which is 0.286, NOT 0.55. The
        auxiliaries were scaled by 0.55 and POP_LOST by 0.286, so every ratio
        AGAINST POP_LOST was silently doubled — and one of those ratios had a
        design rule hanging off it. POP_WAVE went −2.0 → −1.1 while the thing
        it is supposed to be CHEAPER THAN went −3.5 → −1.0, so waving a car
        off came to cost 10% MORE than letting it time out. Meanwhile
        drivethru.js:3367 and kitchen.render.js:2737 both still tell the player,
        in the imperative, "wave early, eat a smaller hit" — a confirm dialog
        in front of a choice that was strictly worse than doing nothing.
        A comment that asserts a RATIO must be checked against the ratio. This
        one was not, for a round, and the ladder below is now ASSERTED in
        assertDataSane() ("THE FAILURE LADDER") so the next reader cannot
        re-invert it by editing one line.

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
       instead of sitting on the floor from day 2 onward.

     🔴🔴 THE TEN-DAY CURVE, RE-MEASURED AT TWELVE SEEDS, AND WHAT IT SAYS
        ABOUT THE ONE ACCEPTANCE CRITERION THESE NUMBERS STILL DO NOT MEET.
     ═══════════════════════════════════════════════════════════════════════════
     Ten CONSECUTIVE days per skill tier, level 12 + heat lamp, twelve seeds,
     day-10 popularity (scratch r9d/days12.mjs — the round-4 measurement, run at
     enough seeds to have a standard error instead of an anecdote):
         GOD     69.0  sd 2.5  se 0.7    meanQ 1.172   grades AAAAAASAAAAA
         EXPERT  67.4  sd 5.5  se 1.6    meanQ 1.182   grades AAAAAAAAASAS
         GOOD    64.5  sd 4.7  se 1.4    meanQ 1.170   grades ABSAAAAAAAAA
         AVERAGE 27.9  sd 3.4  se 1.0    meanQ 1.029   grades BBCBBBBCCBCC
         SLOPPY  17.0  sd 2.0  se 0.6    meanQ 0.942   grades CCCCCCCCCCBC
     THE GOOD HALF: the meter is MONOTONE across all five tiers, the bottom is
     alive (SLOPPY 17.0, never the pinned 0.0 of round 4), and GOOD→AVERAGE is
     36.6 points. A player can read where they are.
     THE HALF THAT IS NOT MET, AND WHY IT IS NOT A TUNING PROBLEM: the standing
     acceptance bar is GOD/EXPERT/GOOD ≥8 points apart pairwise. They are 1.6,
     2.9 and 4.5 apart. Look at the meanQ column before reaching for a constant:
     **1.172 / 1.182 / 1.170 — the top three tiers cook IDENTICAL food.** GOD is
     a fifty-actions-a-second zero-millisecond machine and GOOD is a 700ms
     four-actions-a-second human, and at level 12 the RACK saturates before
     either of their hands do, so they catch the same fraction of the perfect
     window and lose the same fraction of their tickets. The only axis they
     differ on is THROUGHPUT — GOD serves about 8% more dishes — and this meter
     is deliberately blind to throughput (see "WHY THE MEAN AND NOT THE SUM",
     three paragraphs up: summing would make reputation a function of order
     size). No popularity constant can resolve three performances that are the
     same on the axis the meter reads.
     ⚠⚠ THREE LEVERS WERE SWEPT AND ALL THREE ARE RECORDED HERE SO THE NEXT
        ROUND DOES NOT SPEND ITSELF RE-DERIVING THEM.
       1. PERFECT_MS (r9d/sweep.mjs, 3 seeds, day-10 means). Non-monotone in the
          middle and it collapses the bottom:
            1200 → 69.1 / 66.7 / 64.7 / 25.2 / 17.5   (shipped)
            1000 → 69.1 / 66.7 / 65.4 / 22.3 / 17.5
             900 → 69.1 / 60.6 / 60.9 / 24.1 / 17.5   (EXPERT below GOOD)
             800 → 69.1 / 63.2 / 35.8 / 17.4 / 17.5   (AVERAGE = SLOPPY)
          No value separates the top three, and under 900 the meter stops being
          able to tell a distracted human from a bad one. The block at
          ECON.PERFECT_MS already argued 1,200 on phone grounds; this is the
          same conclusion arrived at from the other end.
       2. A UNIFORM SCALE ON EVERY POPULARITY MAGNITUDE (r9d/kscale.mjs,
          r9d/kscale2.mjs, 5 seeds). Equilibrium is invariant under a uniform
          scale — only the NOISE and the convergence rate move — so this is the
          honest version of "damp the delta instead of accumulating":
            k=1.0                 68.4 / 65.5 / 62.2 / 27.2 / 16.7  (sd 1.8 5.8 5.7 4.1 1.9)
            k=0.5                 69.5 / 67.4 / 61.1 / 29.9 / 22.7  (AVERAGE pinned at 29.9 sd 0.7 — a NEW dead zone, on POP_REVERT_BELOW exactly as the old one sat on 2)
            k=0.5, BELOW 15       69.5 / 67.4 / 61.1 / 27.5 / 12.6  (sd 2.9 3.6 3.4 2.3 1.0)
            k=0.7, BELOW 21       70.9 / 66.6 / 61.0 / 29.0 / 14.7
          The third row is the best of them: it cuts the mid-tier seed noise
          almost in half and gets GOD−GOOD to 8.4. It was NOT shipped, and the
          reason is written down rather than assumed: it buys 2 points on one
          pair by halving fifteen constants AND the reversion threshold (whose
          own derivation runs to forty lines), and in the same run GOOD's letter
          column went ABSAA → CCAAA. The letter is the thing that finally
          separates skill; trading it for two points of meter is the wrong way
          round. If a future round wants it, take the whole row — the scale AND
          the threshold — and re-run the letter distribution first.
       3. POP_SOFT_MARGIN (r9d/margin.mjs, 5 seeds). It compresses the top by
          damping the leaders more than the chasers, so the obvious move is to
          shrink it — and it does the opposite of what that predicts, because
          all three top tiers simply rise together into the rail:
             40 → 68.4 / 65.5 / 62.2 / 27.2 / 16.7   (shipped)
             25 → 75.7 / 75.7 / 73.1 / 24.9 / 13.5
             15 → 85.4 / 85.1 / 81.1 / 22.6 /  7.4
          At 15 the top three are within 4.3 of each other AND parked at 85.
          40 is the measured best of the three on both separation and floor.
     🔴 SO THE LEVER, IF THE CRITERION IS KEPT, IS THE RACK AND NOT THE METER.
        The top three tiers converge because slots and cook times bind before
        hands do. Make HANDS the binding constraint at high level — more slots
        than two thumbs can service — and throughput separates, which shows up
        in popularity through the demand loop (a faster kitchen sustains a
        higher equilibrium) without touching a single POP_ constant. That is a
        capacity question for UPGRADES and capacityModel(), not a tuning
        question for this block.

     🔴🔴 ROUND 8 — AND THIS IS THE ANSWER, NOT ANOTHER SWEEP. THE ≥8-POINT
        SEPARATION ACROSS THE TOP THREE TIERS CANNOT BE PRODUCED FROM THIS
        TABLE, AND THE REASON IS NOT THE POPULARITY CONSTANTS. IT IS THAT THE
        GAME CANNOT SEE THE DIFFERENCE IT IS BEING ASKED TO PAY FOR.
        The acceptance has stood for four rounds as "GOD / EXPERT / GOOD must
        finish ≥8 popularity points apart at day 10", where those tiers are bots
        with 0ms, 300ms and 700ms reaction lag. Popularity has exactly two skill
        inputs: how many units you SERVE (POP_SERVE) and how many of them you
        caught in the window (POP_PERFECT_BONUS). MEASURED, L12 + heat lamp,
        12 seeds (scratch r12s/lag.mjs — it prints the axis, not the letter):
              tier          cooked   meanQ     CRAFT     served    pop
              lag    0ms      220    1.1437    0.8575    120.4    68.1
              lag  300ms      212    1.1419    0.8567    114.3    64.9
              lag  700ms      206    1.1352    0.8458    116.3    65.6
              lag 1300ms      204    1.0032    0.6708    113.1    46.1
        The Q_ scale runs 1.00 (good) to 1.25 (perfect), so the whole quality
        axis is 0.25 wide. A 300ms lag moves `meanQ` by **0.0018 — seven
        tenths of one percent of the axis** — and moves CRAFT by 0.0008. The
        serve count moves 5% and moves the WRONG WAY between 300 and 700.
        There is no gain, damping or attractor that turns a 0.7% input
        difference into 8 points of a 0..100 meter without saturating everything
        below it: the multiplier required is ~400 points per unit of score,
        which pins the top three at 100 and the bottom three at 0.

        🔴 AND THE MECHANISM IS DELIBERATE AND LIVES IN A DIFFERENT KEY.
        `PERFECT_MS` is 1200. The bots jitter their lag by 0.55–1.45×, so
        300ms is a 165–435ms reaction and 700ms is 385–1015ms — BOTH ENTIRELY
        INSIDE a 1,200ms window. 1300ms is 715–1885ms, which is the first tier
        that spills out of it, and it is exactly the first tier the axis
        separates (meanQ 1.1352 → 1.0032, a cliff). The game's quality
        resolution IS `PERFECT_MS`, and everything faster than it is the same
        player as far as the sim is concerned.
        The only knob that would resolve 0ms from 300ms is a perfect band under
        300ms — and `PERFECT_MIN_MS` (700) forbids exactly that, in writing and
        with a check: "a band nobody can tap on a phone, which measures hardware
        latency and not attention" (assertDataSane fires on it). Phones are the
        main platform. Shrinking the band to win this criterion would trade the
        skill the feature is actually about for a reflex test, on the platform
        it is mostly played on.

        🔴 ROUND 8, THE FOURTH TIME THIS WAS ASKED FOR: THE ONE REMAINING LEVER
        THAT WAS STILL OPEN HAS BEEN MEASURED, AND IT IS EMPTY.
        ══════════════════════════════════════════════════════════════════════
        kitchen.state.js's bumpPop() header hands the job to this file by name:
        "what separates them has to come from weighting the PERFECT share harder
        — POP_SERVE 0.10 against POP_PERFECT_BONUS 0.36 and POP_LOST −1.0. Those
        are kitchen.data.js's numbers." So the share was measured, which nobody
        had done. L12 + heat lamp, six seeds, one full day (r14d/share.mjs):
              tier      served   lost   units   perfect   PERFECT SHARE
              GOD        118.3   26.3   210.2    210.2       100.0%
              EXPERT     116.0   27.2   203.7    203.7       100.0%
              GOOD       116.0   29.0   197.7    194.5        98.4%
              AVERAGE    111.3   25.0   195.5     71.3        36.5%
              SLOPPY      96.8   30.0   171.8      0.0         0.0%
        🔴 THERE IS NO SHARE TO WEIGHT. The top three catch 100%, 100% and 98.4%
        of their pulls inside the window, because 1200ms > every jittered
        reaction any of them makes. POP_PERFECT_BONUS could be 0.36 or 36 and
        those three rows would move together and by the same factor. The lever
        state.js hands over does not exist, and that sentence there should now
        read "measured empty" rather than "that file's job".

        🔴 AND THE REASON IS THE RACK, NOT THE METER, WHICH IS ALSO MEASURED NOW.
        The GOD bot takes FIFTY actions a second and the GOOD bot takes four — a
        12× difference in hands — and it buys 2%:
              L12 + heat lamp   served 118.3 / 116.0 / 116.0   (GOD/EXPERT/GOOD)
              L20 fully kitted  served 241.8 / 238.8 / 231.8
        Even with every upgrade in the game bought, the three are 4% apart, and
        the perfect share only starts to separate there (100 / 98.9 / 86.8).
        `capacityModel()` says the bottleneck is `rack` at both rungs and it is
        right: the slots are full, so extra hands have nowhere to go. THREE
        PLAYERS WHO PRODUCE THE SAME OUTPUT CANNOT BE GIVEN DIFFERENT
        REPUTATIONS BY A REPUTATION FORMULA — the formula is not where the
        information is missing.

        🔴 SO, PLAINLY, AND THIS IS THE FILE'S ANSWER RATHER THAN A DEFERRAL:
        THIS ACCEPTANCE CANNOT BE MET FROM A DATA TABLE. Not by POP_SERVE, not
        by POP_PERFECT_BONUS, not by POP_LOST, not by a damped attractor in
        popDayDelta() (an attractor still has to be told WHICH tier it is
        attracting toward, and the only signals available — served, lost, mean
        quality — are the ones measured above at 2%, 5% and 0.7% apart), and not
        by shrinking PERFECT_MS, which is forbidden in writing at 700ms and
        checked by assertDataSane().

        WHAT WOULD, WRITTEN OUT SO THE NEXT ROUND CAN COST IT PROPERLY: make
        HANDS the binding constraint instead of the rack, so that a faster
        player physically cooks MORE and the meter can see it. Concretely that
        is more slots per station or shorter cookMs at the same demand — i.e.
        moving capacityModel()'s bottleneck off `rack` — and it is a change to
        the WALL bands (WALL_RATIO_*, WALL_KITTED_*, WALL_MAXED_*) and to
        SPAWN_MIN_MS, not to any key in this block. It is a re-tuning of the
        difficulty curve, it will move the grade ladder and every number in the
        GRADE_MIN_* sweep with it, and it should be a round's whole subject
        rather than a paragraph in one.

        WHAT IS TRUE TODAY AND IS WORTH HOLDING (r6/days.mjs, ten consecutive
        days, two seeds, re-measured this round): the ORDER is correct and no
        longer inverted — ten-day means GOD 70.2 / EXPERT 67.3 / GOOD 64.0 /
        AVERAGE 33.9 / SLOPPY 19.4, day-10 means GOD 69.5 / EXPERT 65.7 /
        GOOD 57.3 — SLOPPY never pins at 0 (14.9–27.2), and the recovery arm
        works (three SLOPPY days then an EXPERT climbs 27.2 → 74.2). GOD−GOOD is
        12.2 points at day 10 and clears the bar; GOD−EXPERT is 3.8 and cannot,
        because the two bots are not measurably different players.

        ⚠ AND THE GRADE CANNOT BUY IT EITHER, WHICH WAS THE LAST PLACE LEFT TO
          LOOK. The letter reads the DAY's score rather than a carried-over
          meter, so it does not saturate — but a cut placed to separate EXPERT
          from GOOD was swept this round and lands inside their shared score
          range, trading five extra seed-pair inversions for the appearance of a
          difference. The measurement and the rejection are written out at
          GRADE_MIN_A. Two instruments, two different shapes, the same answer:
          the information is not there to display. */
  POP_SERVE: 0.10,          // a good unit. × recipe.pop × popGainMul(upgrades)
  POP_PERFECT_BONUS: 0.36,  // extra, per unit, for the ones caught in the window
  POP_RAW: -0.35,           // 🔴 a raw unit COSTS reputation. See above.
  POP_LOST: -1.0,           // 🔴 STILL ASYMMETRIC — 2.2 perfect tickets to undo
  POP_BURN: -0.65,          //    one lost one. Just no longer six of them
                            //    against a decay you could never out-run.
  /* ✋ THE WAVE-OFF, RE-DERIVED FROM POP_LOST RATHER THAN INHERITED FROM A
     SCALING THAT DID NOT APPLY TO IT. 0.57 × POP_LOST is the ratio the two
     surviving comments in drivethru.js and kitchen.render.js are written
     against (they quote the pre-retune pair, −2.0 against −3.5, which is
     0.571), so pinning the ratio rather than the magnitude makes their
     ARGUMENT true again at the current scale — wave early, eat the smaller
     hit, free the slot, save the three cars behind.

     🔴 AND THE ECON HALF OF THAT STANDOFF IS ANSWERED HERE, IN THE FOURTH ROUND
        OF IT, BECAUSE "not this file's to edit" WAS NOT AN ANSWER.
        drivethru.js:3436 and kitchen.render.js:3270 argue the decision in the
        imperative from "POP_WAVE −2.0 against POP_LOST −3.5". Those two numbers
        are in no version of this table. A reader who greps POP_WAVE gets three
        answers and two are wrong, which is the same class of defect as a value
        computed and never consumed — a statement with nothing behind it.
        The question the last three rounds left open was WHICH SIDE MOVES.
        MEASURED, and the answer is neither the magnitudes nor a rescale:
          • −2.0 / −3.5 is 0.571 and −0.57 / −1.00 is 0.570. THE RATIO IS
            ALREADY THE SAME. The prose's argument — wave early, it is the
            cheaper of the two — is TRUE at today's scale and always was. Only
            the magnitudes are stale.
          • Rescaling ECON up to −2.0 / −3.5 to make the prose literal means 3.5×
            the WHOLE ladder (the order check below forces the rest to follow),
            and popularity is clamped 0..100. MEASURED, ten consecutive days ×
            two seeds, L12 + heat lamp, everything else identical
            (scratch r14d/scale.mjs, which is r6/days.mjs with one scale hook):
                          shipped ×1            prose's ×3.5
                GOD       67.9 … 75.5           4.7 … 23.1
                AVERAGE   22.9 … 49.1           0.9 … 12.5
                SLOPPY    14.9 … 27.2           0.3 …  3.5
            SLOPPY is welded to the floor again — the eight-consecutive-days-of-
            exactly-zero failure POP_REVERT_PER_DAY was written to end — and a
            frame-perfect kitchen finishes its tenth day on 8.2/100. The prose
            is not worth the meter.
        SO THE NUMBERS STAY AND THE PROSE CHANGES, and the two sentences the
        lane's builder and the renderer's builder should paste — they own those
        files, this one does not — are exactly these:
            drivethru.js:3436   "At POP_WAVE against POP_LOST the maths says:
                                 wave early…"   (drop the parenthetical; the
                                 ratio is what is pinned, and it is pinned in
                                 kitchen.data.js's failure ladder)
            render.js:3270      "It costs POP_WAVE and produces NO lost ticket,
                                 against POP_LOST."
        If a magnitude is wanted in prose after all, the only two that are true
        today are −0.57 and −1.00, and assertDataSane()'s LADDER check will not
        catch them going stale again — it holds the ORDER, not the text. That is
        the argument for quoting no number at all.

     ⚠ AND IT IS NOT THE CHEAPEST FAILURE, DELIBERATELY. A wave-off is an
     abort of a customer who has already ORDERED, so it sits above every way of
     losing somebody who never got that far. The whole ladder, as a fraction of
     POP_LOST, smallest first — assertDataSane() checks this order holds:
         BALK      0.14  drove past a full lane. Mostly a compliment.
         JUMP      0.33  you let somebody cut. Everyone behind saw.
         TURNAWAY  0.40  walked in, saw the board, walked out.
         JAM       0.50  queued, never got to order, gave up.
         WAVE      0.57  ← YOUR decision, on somebody who ordered.
         BURN      0.65  you ruined food.
         LOST      1.00  you took the order and never delivered it.
     ⚠ It must stay strictly BELOW POP_BURN too: waving a car off to free the
     window is triage, and ruining a pan is not.

     🔴 MEASURED, TWO ARMS, AND THIS IS THE ONLY THING THAT SETTLES IT.
     Identical seeds, identical cooking, level 12 + heat lamp, one full day
     (scratch r9d/twoarm.mjs). Arm A never waves. Arm B waves the front car once
     its patience is under 30% and its order is still not ready — "this one is
     going to time out anyway and take the three behind it with it", which is
     the decision the control exists for:
         POP_WAVE −1.1 (shipped round 5)  B ahead on popularity 3/6 seeds,
                                          mean 66.1 against 65.7 — a coin flip
         POP_WAVE −0.57 (this)            B ahead 4/6 seeds,
                                          mean 68.9 against 65.7
     B serves MORE in both arms (freeing the window early is real upside on its
     own), so at −1.1 the reputation charge was cancelling a benefit the player
     had correctly earned. Re-run this before changing the number: a wave-off
     that does not beat inaction is a confirm dialog in front of a trap. */
  POP_WAVE: -0.57,          // = 0.57 × POP_LOST. See the ladder above.
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
  /* 🔴🔴 THE RATCHET'S FLOOR, AND THE NUMBER IS THE THRESHOLD ITSELF ON PURPOSE.
     ═══════════════════════════════════════════════════════════════════════════
     WHAT IT WAS AND WHAT IT MEASURED. This shipped at 2.0 under a nine-line
     comment presenting it as the fix for the popularity ratchet, and as a
     mechanic it lost anyway: 2.0 a night against roughly 55 lost tickets ×
     POP_LOST (−1.0) is one twenty-fifth of the bleed. A resourceless
     auto-player went 55 → 26.2 → 2 and then sat on EXACTLY 2 for eight
     consecutive days while the reversion fired every single night. The key was
     wired, it ran, and it could not win — which is a worse failure than dead
     data, because everything on screen says the recovery mechanic is working.
     A restaurant sim whose popularity meter is welded to 2/100 from day three
     is hollow next to REF-B's face, which is a live signal you play against.

     🔴 WHY IT IS SIZED TO POP_REVERT_BELOW AND NOT MERELY "BIGGER". Popularity
     is clamped at ECON.POP_MIN, so a day that loses 55 tickets and a day that
     loses 500 leave the meter in exactly the same place — the scale of the
     disaster is information the meter physically cannot hold, and any nightly
     figure smaller than the threshold is therefore calibrated against a number
     nobody can see. Setting it to the threshold says the only thing that is
     honestly measurable: THE TOWN'S MEMORY FADES BACK TO UNREMARKABLE
     OVERNIGHT, AND NO FURTHER. Both consumers clamp with
     `min(perDay, POP_REVERT_BELOW − pop)`, so at this value a floored kitchen
     opens on 30 and a kitchen already on 29 gets +1. The 0..30 band stops being
     a hole you fall into and becomes what it should be — the shape of one bad
     day, not the shape of an account.

     🔴 AND IT CANNOT BE FARMED, WHICH IS WHY THE CEILING IS THE THRESHOLD AND
     NOT A CONSTANT OF ITS OWN. Deliberately tanking a shift buys you a morning
     at 30/100 — below POP_START (50), below every pay multiplier worth having,
     and strictly worse than the day you threw away. There is nothing there to
     exploit; there is only a hole with a bottom.

     ⚠⚠ WHY THERE IS NOT A SECOND, PROPORTIONAL KNOB HERE, BECAUSE THE FIRST
        DRAFT OF THIS ROUND ADDED ONE. `POP_REVERT_PER_LOSS` was written,
        commented, and deleted again before it shipped. Two reasons, and the
        second is the important one:
          1. With the base at the threshold the clamp always binds, so a
             per-loss term is unreachable by construction — a key that can
             never change an outcome.
          2. ✅ ROUND 7: THE CALL SITE NOW CALLS popDayDelta(), AND UNTIL IT DID
             THIS PARAGRAPH READ "THE SHIPPED CALL SITE DOES NOT". It was
             kitchen.state.js's closeShift day-roll reassembling the settle out
             of loose constants — `EC('POP_REVERT_BELOW')`,
             `EC('POP_REVERT_PER_DAY')`, `EC('POP_DECAY_PER_DAY')` — which is
             the exact shape popDayDelta() exists to replace and the exact shape
             that let these keys ship as dead data for a round. Round 5 reported
             that as CLOSED; kitchen.selftest.js then found popDayDelta() with
             ZERO call sites, which is how a "fix" stays broken while reading
             as done. There is now ONE copy of the settle and it is below.
             A per-loss key would still be wrong for reason 1, so it stays out.
        Retuning rule: change this and re-run a MULTI-DAY curve, not a day. A
        single day cannot show a ratchet; a ratchet is what the second week
        looks like. */
  POP_REVERT_PER_DAY: 30,   // = POP_REVERT_BELOW, deliberately. See above.
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

  /* ── 📋 THE REPORT CARD (kitchen.state.js gradeParts / gradeFor) ─────────
     🔴🔴 THESE FIVE SPENT A ROUND BEING READ AND NEVER DECLARED, WHICH IS THE
        MOST EXPENSIVE SHAPE A MISSING NUMBER HAS. gradeFor()'s own comment says
        "The cuts are ECON keys, swept against the measured distribution" — and
        `Object.keys(ECON).filter(k => k.startsWith('GRADE'))` returned `[]`
        against 153 keys. Every number the day's letter is built from was
        running on kitchen.state.js's `EC(key, fallback)` second argument, so a
        designer looking for the grade cuts where BOTH comments said they were
        found nothing, and the one file that is supposed to hold every number in
        the feature held none of these. CLAUDE.md: "All operation pricing goes
        through the one ECON table." A report card is pricing — it prices the
        player.
     ⚠ THE VALUES BELOW ARE THE LIVE, MEASURED ONES, COPIED OFF THE FALLBACKS
       THEY REPLACE — NOT ZEROES AND NOT ROUND NUMBERS. Declaring a key with a
       zero here is strictly worse than leaving it undeclared, because ECON WINS:
       kitchen.state.js reads `EC('GRADE_MIN_S', 0.92)`, so a `GRADE_MIN_S: 0`
       ships a report card that hands out S grades to everybody. POP_REVERT_BELOW
       spent a whole round as dead data for exactly this reason. */
  GRADE_MIN_SHIFT_MS: 300000,
  /* ↑ The shortest shift that earns a LETTER at all; below it gradeFor()
     returns '—' and the report shows the two axes alone. MEASURED: the same bot
     on 8 seeds scored TWO S grades on a 120,000ms shift and NONE on a full
     780,000ms day, from identical play — CRAFT starts near 1.000 because
     nothing has had time to spoil and the SERVICE ceiling has not had time to
     bind. The title screen prints "Last shift B" as a persistent claim about
     the player, so a twenty-minute mobile session was systematically earning a
     better one than a full day. 300,000ms is five in-game hours of a twelve-hour
     day: enough sample for the ceiling to bind, short enough that a real phone
     session still gets a letter. */
  GRADE_CAP_DUTY: 0.70,
  /* ↑ The fraction of capacityModel()'s theoretical rack a real pair of
     thumbs sustains. 🔴 NOT A FUDGE — THE MISSING HALF OF THE MODEL, which
     capacityModel() says about itself: it "ignores the player's hands
     entirely". Its raw figure is every slot cooking 100% of the time with
     nobody plating, serving or restocking — 26.9 dishes/hour at level 12
     against 17.9 for a bot with a ZERO-millisecond reaction and fifty actions a
     second. Grading against the underated rack made the ceiling unreachable by
     50%, the denominator never bound, and the service axis went back to being
     share-of-custom in a new hat. This is the one number here fitted to a
     measurement rather than swept off a distribution. */
  /* 🔴 THE FOUR LETTER CUTS ON gradeParts().score, SWEPT AND NOT TYPED — AND
     RE-SWEPT THIS ROUND, BECAUSE THE PREVIOUS SET'S OWN JUSTIFICATION HAD
     STOPPED BEING TRUE BY MEASUREMENT.
     ══════════════════════════════════════════════════════════════════════════
     Round 4's were round numbers (0.98 / 0.90 / 0.75 / 0.55) fitted to nothing,
     and the top three sat above the entire human range — 60 of 72 shifts graded
     B. Their replacement was swept off the game's own output and then the game
     moved underneath it. The comment that shipped with 0.79 read "AVERAGE tops
     out at 0.785, GOD bottoms at 0.795". RE-MEASURED at HEAD 9d41440, six skill
     tiers × 12 seeds, level 12 + heat lamp (scratch r8/grade.mjs, unmodified):
         GOD      0.775 … 0.925    EXPERT  0.800 … 0.895
         GOOD     0.775 … 0.905    AVERAGE 0.720 … 0.800
         SLOPPY   0.610 … 0.680    DISTRACT 0.440 … 0.575
     AVERAGE tops out at 0.800 and GOOD bottoms at 0.775, so 0.79 sat INSIDE the
     overlap: AVERAGE graded A on 2 of 12 seeds — the same letter as the
     frame-perfect bot — and the seed-pair inversions had gone 0/60 → 2/60.

     🔴 AND HERE IS THE THING THE SWEEP PROVED, WHICH IS MORE USEFUL THAN THE
        FOUR NUMBERS: **0/60 AND A SPREAD LETTER TABLE CANNOT BOTH BE HAD.**
        Enumerated over every behaviourally distinct cut placement, on the two
        rungs the acceptance names (L12+heatlamp and L20 all-owned):
          • GOD spans 0.775–0.925 and GOOD spans 0.775–0.905 — the SAME range.
            Adjacent tiers cross on 10 of the 60 seed-pairs. A cut placed
            anywhere inside (0.775, 0.905] therefore inverts on some seed, by
            construction and not by tuning.
          • The only cut sets that reach 0/60 push A above 0.905, which collapses
            EXPERT, GOOD and most of GOD onto a single letter and leaves A
            unreachable at level 12. Measured: `AAASAAAAAAAA / AAAAAAAAAAAA /
            AAAAAAAAAAAA` — a report card that has stopped saying anything.
          • The best achievable table keeps ONE inversion, on the single seed
            where the frame-perfect bot had its worst day of the twelve (GOD
            seed 3 scores 0.775 against EXPERT's 0.850). That is a true fact
            about that shift, not a miscalibrated cut, and pricing it away costs
            the letter its whole top end.
        So these four are swept to the best table, not to the round number.

     🔴 ROUND 8 FINISHED THE JOB, AND THE HALF THAT WAS LEFT WAS THE ONE THAT
        DECIDES WHETHER THE LETTER SAYS ANYTHING.
        ══════════════════════════════════════════════════════════════════════
        Round 7 moved C/B/A from 0.58/0.70/0.79 to 0.59/0.73/0.83, which fixed
        the inversions (2/60 → 1/60 at the time) and put AVERAGE's bad days back
        on the board (0/12 → 4/12). It left A at 0.83, and 0.83 sits BELOW the
        whole EXPERT and GOOD body — so at level 12 the shipped table read
        `EXPERT AAAAAABAAAAA` against `GOOD AAABAABAAAAA`. A report card that
        gives a 300ms player and a 700ms player the same eleven A's is not
        grading; the three top tiers were separated by nothing but the seed.

        RE-SWEPT ACROSS THREE RACKS THIS ROUND rather than one, because the cut
        that reads best at level 12 is not automatically the cut that reads
        right on a new kitchen or a maxed one, and round 7 swept one. The sweep
        is scratch r14d/ab.mjs — the REAL gradeFor(), S-rider and all, with the
        four cuts overridden between runs, six tiers × 12 seeds × three racks =
        216 shifts per candidate. Score ranges first (r14d/cut2.mjs):
             rack               GOD          EXPERT       GOOD
             L4  stock        0.750-0.915  0.755-0.875  0.725-0.895
             L12 +heatlamp    0.775-0.925  0.800-0.895  0.775-0.905
             L20 fully kitted 0.925-1.000  0.870-0.995  0.860-0.960
             rack               AVERAGE      SLOPPY       DISTRACT
             L4  stock        0.645-0.795  0.605-0.700  0.485-0.600
             L12 +heatlamp    0.720-0.800  0.610-0.680  0.440-0.575
             L20 fully kitted 0.755-0.840  0.695-0.745  0.490-0.575
        SHIPPED (0.59/0.73/0.83/0.92) against CHOSEN (0.61/0.75/0.83/0.92),
        over all 180 seed-pairs, both measured live:
             seed-pair inversions        6/180   →   6/180   (unchanged)
             AVERAGE C-or-worse          4/36    →   8/36    ← the open question
             EXPERT  B-or-better        36/36    →  36/36    (unchanged)
             GOD     A-or-better        35/36    →  35/36    (unchanged)
             DISTRACT D                 31/36    →  33/36
             SLOPPY   C                 34/36    →  35/36
             distinct letters            ABCDS   →   ABCDS
        Strictly better or equal on every axis. The two deliberate calls:
         0.61  DISTRACT (a six-second reaction) must be a D on every rack, and
               at 0.59 it collected FIVE C's across the three — all of them on
               the lower racks, where the whole board scores lower. 0.61 clears
               DISTRACT's 0.600 ceiling on the stock rack by 0.010 and costs
               SLOPPY exactly one D, on its single worst seed of thirty-six.
               0.63 was rejected: it hands SLOPPY four D's and stops the bottom
               two tiers being different letters at all.
         0.75  ↑ THE ANSWER TO THE OPEN QUESTION. AVERAGE is the middle of the
               human range and its letter should be the one that MOVES; at 0.73
               it was B on 32 of 36. At 0.75 it is an exact coin flip at level
               12 (CBCBCBCBCBCB — 6C/6B) and a clean B once the kitchen is fully
               kitted. "Average play is a B when your kitchen is good and a C
               when it is not" is a sentence about the upgrade ladder as much as
               about the player, and it is the one the report card should be
               making. 0.74 was swept too and lands at 7/36 — the same shape,
               one seed short of the coin flip.
         0.83  UNMOVED, AND THIS IS THE INTERESTING REJECTION. A=0.85 was tried
               because 0.83 sits UNDER the whole EXPERT/GOOD body and collapses
               them onto A (at L12: EXPERT AAAAAABAAAAA against GOOD
               AABBAABAAABA — the letter barely separates a 300ms player from a
               700ms one). 0.85 does cut through it — EXPERT 6A/6B, GOOD 4A/8B
               — and it costs FIVE EXTRA INVERSIONS, 6/180 → 11/180, because
               those two tiers OCCUPY THE SAME SCORE RANGE (see the table above,
               and see POP_SERVE's block for the measurement that says the two
               bots are not measurably different players). A cut placed inside
               an overlap does not resolve the overlap; it just picks a different
               seed to be wrong on. Buying a visible difference between two
               players who are not different is buying a lie, so A stays where
               it is. Do not re-propose it without first making HANDS the binding
               constraint — that is the change that would make the two tiers
               genuinely different, and it is written out at POP_SERVE.
         0.92  UNMOVED. GOD's best L12 seed scores 0.925 and a level-20 all-owned
               rack scores 0.925-1.000, so S is reachable by play at both rungs
               and is 12/12 for GOD when fully kitted. Nothing in the sweep
               improved on it and two candidates that moved it made S either
               unreachable at L12 or automatic at L20.
     🔴 WHAT THE SWEEP STILL CANNOT BUY, RECORDED SO IT IS NOT RE-ATTEMPTED:
        zero inversions. GOD spans 0.775-0.925 and GOOD spans 0.775-0.905 at
        L12 — the SAME range — so a cut anywhere inside it inverts on some seed
        by construction. 6/180 is the floor for a table that still has five
        letters in it; the sets that reach zero put A above 0.905 and collapse
        the top three onto one letter again.
     ⚠ RE-SWEEP AFTER ANY MOVE TO PERFECT_MS, THE Q_* SCALE, GRADE_CAP_DUTY OR
       capacityModel() — all four move the distribution these sit in, and a cut
       that has stopped matching its distribution is the exact bug this is the
       third fix for. The sweep is r8/grade.mjs + r8/gradeAny.mjs to capture,
       then enumerate cut placements against the captured scores; do not type a
       number and eyeball the letters. And sweep ALL THREE RACKS: round 7 swept
       one and shipped a cut that read fine at level 12 and gave DISTRACT a C on
       a stock kitchen.
     ⚠ assertDataSane() checks only that they are strictly ordered inside
       (0,1]. It CANNOT check that they still match the distribution; nothing
       pure can, because the distribution is the output of the whole sim. That
       is what the sweep is for, and it is why this comment carries the measured
       endpoints rather than an assertion about them. */
  GRADE_MIN_C: 0.61,
  GRADE_MIN_B: 0.75,
  GRADE_MIN_A: 0.83,
  GRADE_MIN_S: 0.92,
  /* 🔴 AND THE TOP LETTER IS REACHABLE BY SKILL AGAIN, WHICH IT WAS NOT.
     The S rider ALSO requires a clean sheet, and it used to read `today.burnt`
     — which is TWO different failures added together: a SLOT that crossed
     burnAt (neglect) and a PLATE that rotted on the pass (structure, and the
     game bins it FOR you). Split across 6 tiers × 12 seeds at level 12, the
     frame-perfect fifty-actions-a-second bot books 0.0 slot burns and 5.1
     spoiled plates, and clean sheets were 0 of 72 shifts across EVERY tier.
     Adding `up_warmrail` — minLevel 27 — halved spoilage and S appeared
     immediately. So the top of a five-letter scale was gated on owning a
     level-27 upgrade, not on cooking well. kitchen.state.js now charges the
     rider on `burnt − spoiled`; measured at level 12 + heat lamp on this data,
     the GOD tier collects S grades on day 1, day 2 and day 8 of a ten-day run.
     There is no ECON key for that split on purpose: it is a question about
     which TALLY the rider reads, not a price. */
  /* ── 🚪 THE DRY GATE (kitchen.state.js dryNow / reliefWatch) ──────────── */
  DRY_CHECK_MS: 500,        // throttle on the latched "are the doors shut" read.
                            // dryCheck() prices a restock basket per menu row and
                            // every price is a getRes() across the bridge, so it
                            // must not run 60×/second. Busted early by any `rev`
                            // change, so a purchase is still felt immediately.
  RELIEF_AUTO_MS: 3000,     // 🔴 how long the kitchen must have been PROVABLY
                            // stalled before the free parcel lands by itself.
                            // Firing on the instant would drop a pallet into the
                            // ordinary gap between plating one burger and
                            // starting the next, which is not a stranded player,
                            // it is a busy one. See the RELIEF block: the drop is
                            // gated on `cookable.length === 0`, and this is how
                            // long that has to have been TRUE for.

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
  /* 🔴 ROUND 7 — THE KEY THAT WAS BEING READ OUT OF THIN AIR. kitchen.state.js's
     tick() gates the whole walk-in door on `ECb('COUNTER_ENABLED', true)` and
     this table declared no such key, so the read resolved to `undefined`, the
     NaN guard supplied `true`, and the counter has been running on a number
     that lived in the READING file — which CLAUDE.md's `_opEcon` rule forbids
     precisely because tuning it here did nothing. It is `true` because the
     walk-in board is half the game (REF-B's "Customer Orders" panel); the flag
     exists so a harness can isolate the LANE by silencing the counter, which is
     how the drive-thru arrival curves were measured. Flip it to false and the
     kitchen is drive-thru only — a legal, playable configuration, not a bug. */
  COUNTER_ENABLED: true,
  /* 🔴 HOW OFTEN AN ORDER GENERATOR ASKS FOR SOMETHING THE PANTRY CAN ACTUALLY
     MAKE. `menuForLevel(lv, cookable)` has carried the filtered-menu argument
     since round 5 and NOBODY PASSED IT — the ⚠⚠ block on that function measured
     what that costs: 122 of 142 lost tickets on a stranded three-day account
     (86%) contained a dish the kitchen could never make, and every LEVEL UP
     made it worse by adding another way to be unfillable.

     ⚠ IT IS A BIAS AND NOT A FILTER, and the number is what makes that true.
       At 1.0 the board would only ever ask for what is already in the cooler,
       the whole menu would stop mattering, and there would be no reason to
       restock anything you were not already cooking. At 0 it is the shipped
       bug. 0.75 leaves one order in four drawn from the full board, which is
       the same shape — and the same reasoning — as LIKE_BIAS 0.7 one screen up:
       enough pull that a stocked kitchen mostly gets served, enough noise that
       running out of buns is still visible on the board within a minute.
     ⚠ It never starves the board: menuForLevel() returns the UNFILTERED menu
       when nothing is cookable, because no customer at all is a dead
       restaurant. See that function's ⚠. */
  COOKABLE_BIAS: 0.75,

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
         a wallet holding ~12,000 Cinder, next to a scrap dealer who will sell
         them a half-crate for a fraction of it. That is a lesson. The old one
         was an eviction.
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
     offers must cost at least this multiple of what the food it delivers is
     worth. ⚠ THIS WALL WAS LOAD-BEARING ALONE FOR ONE ROUND, when the scrap
     dealer's crates cost no live resources at all and it was the only thing
     standing between the convoy and a Cinder→food printer. It no longer is
     (every crate carries food now, and convoyGuardOk() has a fourth wall that
     measures that directly) — which is exactly why it must stay: it is the one
     that does not depend on the food legs being right. 2× is the smallest honest statement of "a convoy
     moves value, it does not mint it". Today the margin is 2.7x the bar
     (◈21.33 against ◈8) — convoyGuardOk() prints both, so do not trust this
     sentence over `__mk.debug()`. The check exists so that a future cheap
     supply line cannot quietly close it. */
  CONVOY_CINDER_GUARD_MULT: 2.0,
  /* 🏷 WHAT A UNIT OF EACH LIVE RESOURCE IS WORTH IN CINDER ON THE OPEN MARKET.
     The game's own numbers (index.html:195218, the cold-storage board) and
     deliberately NOT the scrap dealer's internal surcharge, which is a
     different question with a different answer — see _SALVAGE.resCinder. The
     board exists so that both guards built on it — the convoy food-printer wall
     and the relief-loop wall — are measured against what a resource is WORTH
     rather than against what this one kitchen happens to charge for it.
     🔴 ONE PRICE, ONE PLACE. `FOOD_RETAIL_CINDER` used to be a standalone key
        and the relief drop needed a price for `water` too; the obvious move was
        to add a second constant beside it, which is how a live economy ends up
        with two different prices for the same sack of flour. It is a lookup
        into this map now, and every consumer goes through resRetail(). */
  RES_RETAIL_CINDER: {
    food: 4, water: 6, supplies: 5, ammo: 5, metal: 6, fuel: 9, medicine: 14,
    energyDrink: 7, corruptedEssence: 26, memoryShards: 38, dna: 42,
    wood: 3, stone: 3, cloth: 4,
  },
  /* 🪂 THE MULTIPLE OF THAT BOARD PRICE A RELIEF FLIGHT CHARGES. See the RELIEF
     block for the whole argument; the short version is that this is the single
     number holding the "Cinder → dish → Cinder" loop shut, and assertDataSane()
     recomputes it against EVERY recipe by the CHEAPEST route at the BEST pay
     multipliers the game can hand out.
     ⚠ MEASURED, NOT PICKED, AND THE FIRST NUMBER WAS WRONG BY A FACTOR OF
       NEARLY TWO. At 7× the check reported three dishes still OPEN at the best
       multipliers — the Slaw Dog (168 Cinder end to end against a 191 best-case
       payout), the Margherita (234 against 342) and Chili Cheese Fries (240
       against 246). The Margherita is the one that matters: it is a LEVEL-ONE
       dish with the best margin on the board, so the hole was open on the very
       first shift, which is exactly where round 4's was. The bar this clears is
       the ABSOLUTE best the game can pay — max popularity × Q_PERFECT ×
       RUSH_PAY_MAX × a full tip = 2.734× base price — and not the sustainable
       one (2.360× using the demand-weighted mean of RUSH_CURVE rather than its
       peak). The stricter bar costs 20% on this number and removes an argument
       about what a determined player can hold for how long. Take the argument
       off the table. */
  RELIEF_MARKUP: 15,
  /* 🔴 AND THE WALL NOW HAS A DECLARED THICKNESS INSTEAD OF JUST A SIGN.
     RELIEF_MARKUP 12 satisfied "the loop must lose money" by 7% on the tightest
     dish — the Margherita, end to end out of a Ration Tin, cost 1.070× its own
     best-case payout. A guard whose margin is 7% is a guard that a routine
     basePrice nudge flips, silently, into round 4's Cinder machine; and the
     comment two blocks up was calling that same wall "seven times over" and
     "absurd". Swept (scratch r9d/markup.mjs), tightest dish at each markup:
         7× → 0.685×  (OPEN — this is the hole the previous round found)
        12× → 1.070×
        14× → 1.225×
        15× → 1.302×  ← shipped
        20× → 1.687×
     The check below demands this multiple rather than merely ">1", so the
     margin is a stated design quantity that a future edit trips 25% BEFORE the
     printer actually opens. ⚠ If it ever fails, raise RELIEF_MARKUP or lower
     the dish's price — do not lower this. */
  RELIEF_LOOP_MIN_MARGIN: 1.25,
  /* 🔴 THE CEILING ON THE ONE FREE THING IN THE FEATURE. The free `rel_drop`
     (RELIEF, above) is gated on being genuinely dry and capped at one per
     in-game day, so it cannot be farmed by a working kitchen — but "cannot be
     farmed" is not "cannot matter", and this game's own history is a list of
     faucets it went back and removed: "🚫 MATCH CINDER REMOVED — admin removed
     the post-battle Cinder grant to protect currency value" (index.html:152809,
     every GEM_REWARDS constant now 0) and "Remove the NPC buyer queue from the
     car dealership — it was a Cinder faucet".
     So the drop is measured, not asserted: assertDataSane() takes the best dish
     the parcel can build, prices it at the BEST multipliers the game hands out,
     and requires the whole day's yield to come in under this.

     🔴🔴 IT WAS 600, AND 600 MADE THIS CEILING AND THE FLOOR IT SITS OVER
        CONTRADICT EACH OTHER — WITH THE FLOOR LOSING SILENTLY.
     ═══════════════════════════════════════════════════════════════════════════
     600 was picked against two anchors from OTHER systems (the daily challenge
     pays 75; round 4's kitchen minted 5,660) and never against the one question
     this rung exists to answer: DOES ONE DROP PUT A PLATE ON THE PASS?
     Measured, whole crates, on this data (scratch r9d/dropsize.mjs):
         the cheapest complete level-1 crate set is a Hot Dog —
         sal_roll + sal_sausage + sal_mustard = 7 food + ◈110 → 5 hot dogs
         burgerClassic 14 food ◈224 → 4 · pizzaMargherita 10 food ◈171 → 2
     The parcel was 5 food. FIVE. It could not buy ONE crate set for ANY level-1
     dish, on any day, ever — and the shop sells whole crates, so the 1.9
     "dishes per parcel" the amortised guard reports is a number the player can
     never spend. Measured end to end on a fresh 0-Cinder 0-resource account
     with the drop WIRED and landing (r5p/run10.mjs): ten days, nine drops, 45
     food in, and days 3–10 served 0, 1, 0, 2, 0, 2, 0, 1 while losing 36–54
     tickets each. That is not a rescue, it is a drip feed with a parachute
     drawn on it — the round-5 dead end at one dish a day instead of zero.
     The floor is the REASON the rung exists, so the floor wins and the ceiling
     is re-derived. 7 food is the smallest parcel that reaches one plate, and
     7 food amortises to ◈776 a day at the guard's best-case multipliers.
       LOWER BOUND  776 — below it the two guards contradict and the reach guard
                          ("THE ESCAPE HATCH MUST ACTUALLY ESCAPE") is the one
                          that must hold.
       UPPER BOUND  a working shift. Measured this round, fresh account, day 1:
                    7,579 Cinder minted in one twelve-minute shift.
       SHIPPED      800 — 10.6% of a first shift at the guard's best case, and
                    at the multipliers a STRANDED kitchen actually has
                    (popularity 30, no rush, good-not-perfect, ordinary tip →
                    1.058× against the guard's 2.734×) about ◈130 a day, 1.7%.
     ⚠ THE OLD INSTRUCTION HERE — "shrink the parcel, do not raise the ceiling"
       — STILL STANDS, WITH ONE ADDED CLAUSE: the parcel cannot shrink below the
       cheapest complete level-1 crate set, and assertDataSane() now fails if it
       does. If a future supply-line edit makes that set dearer, the parcel goes
       UP and this number goes up with it. If it makes it cheaper, both come
       down. They are one number wearing two hats; do not move one alone. */
  RELIEF_FREE_DAILY_CINDER_MAX: 800,

  /* 🔴🔴 HOW MANY DROPS THE ESCAPE HATCH MAY TAKE TO PUT ONE PLATE ON THE PASS,
     AND IT IS THE NUMBER THAT WOULD HAVE CAUGHT ROUND 6'S BLOCKER.
     The old check asked "does one day's parcel buy a complete crate set" and
     IGNORED CINDER, because at the time no crate could be bought without it and
     the note under the check said so out loud and shrugged. So the check
     reported the escape hatch reaching a Hot Dog while the actual measured
     answer for a player at ◈0 was: fourteen days, 112 food, 60 water, zero
     crates affordable, zero dishes cooked (r9/dry12.mjs).
     It now prices the set in WHOLE CRATES the parcel can actually pay for —
     zero Cinder, and no live id the parcel does not carry — and asks how many
     DAYS of drops that set costs. Days, not one day, because whole crates and a
     fixed pallet do not divide evenly and a one-day bar would force the parcel
     up until it became a shift's worth of stock, which is the faucet the
     ceiling above exists to stop. The two bounds pull opposite ways ON PURPOSE:
     RELIEF_FREE_DAILY_CINDER_MAX stops the drop being worth farming, this stops
     it being worth nothing.
       LOWER BOUND  1 would demand a parcel big enough to buy a whole crate set
                    in one morning — measured, that is 19 food at the barter
                    counter against a 7-food drop, so the parcel would have to
                    nearly triple and the daily yield with it.
       UPPER BOUND  a player who has to wait a week to cook one dish has been
                    dead-ended with extra steps; the round-3 "slower dead end"
                    this file has warned about since.
       SHIPPED      4, against a measured 3 (day 1 mustard, day 2 rolls, day 3
                    sausage, cook) — one day of headroom for a supply-line edit
                    before the check fires and makes somebody look. */
  RELIEF_RESCUE_DAYS_MAX: 4,

  /* 🔴 HOW MANY DISHES THE BARTER COUNTER MAY REACH. See the §🤝 block: rung
     four is a floor, and a floor that runs a menu is a kitchen. 1 is not a
     round number — it is "the cheapest-in-food level-1 recipe and nothing
     else", which is what `_barterTarget()` derives. Raise this and you are
     deciding that a player with no city should be able to run a restaurant on
     air, which is the round-4 failure in a fourth costume. */
  BARTER_MENU_MAX: 1,

  /* 🔴 THE TWO NUMBERS THAT KEEP THE SCRAP DEALER A FLOOR AND NOT A KITCHEN.
     See the _SALVAGE block. SHARE is how much of a level-40 board one rung may
     run; VALUE_GAP is how much richer the dishes that need the city have to be.
     Together they say: the dealer keeps a small, cheap kitchen alive, and every
     expensive thing on the board is something your city bought you. */
  SALVAGE_SHARE_MAX: 0.55,  // at most this fraction of the full menu
  SALVAGE_VALUE_GAP: 1.5,   // city-only dishes must average ≥ this × bin dishes

  /* 🔴 HOW MANY OF THE FOURTEEN THE KITCHEN ACTUALLY EATS, AS A FLOOR.
     ═══════════════════════════════════════════════════════════════════════
     The other premise checks ask "does EVERY crate cost SOMETHING live". They
     are all satisfied by a kitchen that runs on `food` and nothing else — and
     the request was not "a resource", it was "the different types of resources
     that they get from the other parts of the game". A retune that quietly
     collapses eleven ids down to two passes B, B2, C, D, E and every §G, and
     turns the city builder and the battle screen back into one faucet.

     MEASURED, this round, and this is the census nobody had written down
     (scratch r14d/loop2.mjs — a real bridge, a real 14-id ledger, ten days,
     the autopilot restocking and buying every upgrade it can afford):
        THROUGH THE RESTOCK COUNTER (42 lines take food, 15 water, 8 dna,
          3 supplies, 1 energyDrink, 1 fuel, 1 corruptedEssence)
        THROUGH THE UPGRADE SHOP    (metal on 39 upgrades, supplies on 22,
          fuel on 13, stone on 12, wood on 6, cloth on 6)
        UNION: 11 of 14. Ten days of play moved 9 of them for real —
          food 5,794 · water 1,671 · dna 579 · metal 266 · supplies 246 ·
          energyDrink 192 · fuel 159 · wood 30 · corruptedEssence 7 — with
          `stone` and `cloth` sitting behind the level-11 and level-12
          upgrades the run had not reached.
     ⚠ THE THREE THE KITCHEN DOES NOT TAKE ARE `ammo`, `medicine` AND
       `memoryShards`, AND THAT IS LEFT DELIBERATE RATHER THAN PATCHED. There
       is no honest culinary or shop-fitting leg for ammunition, and a leg
       invented to make a number read 14 is a price fitted to a check instead
       of to a dish — the exact failure the `_SALVAGE.resCinder` note warns
       about. If a future round wants them in, they belong on a NEW door (a
       high-tier speciality line, a licence, a repair) with its own reason, not
       bolted onto an existing crate.
     🔴 SO THIS IS A FLOOR, NOT A TARGET. 11 is what ships; the check fires the
        moment the kitchen stops eating one of them, which is the shape a
        "simplify the costs" edit has. Fix the table, not the floor. */
  LEDGER_BREADTH_MIN: 11,

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
     pantry units, and the priciest single unit in the game is a beef patty out
     of the scrap dealer's bin at 107 Cinder ÷ 4 = 26.75 (the core line is
     16.25). A percentage bonus alone therefore fails on cheap
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
  MOD_PAY_HIT_MIN: 28,      // 🔴 …with a per-honoured-UNIT Cinder floor ABOVE the
                            //    priciest pantry unit ON ANY RUNG OF THE LADDER.
                            //    This is what makes honouring pay on a
                            //    25-Cinder soda.
                            // 🔴 WAS 18, AGAINST A CORE BEEF PATTY AT 130÷8 =
                            //    16.25. The scrap dealer's reclaimed-protein
                            //    line (sal_patty, 107 Cinder for 4) is 26.75 a
                            //    unit, and assertDataSane() — which scans ALL
                            //    of SUPPLY_RECIPES, not just the core half —
                            //    reported the inequality had flipped the moment
                            //    that line existed: a player restocking from the
                            //    bin LOST money honouring "extra patty". The
                            //    check found it, which is the entire reason it
                            //    recomputes the figure instead of quoting it.
  MOD_PAY_MISS: -0.25,      // 🔴 payout penalty for a broken promise
  MOD_PAY_UNPROVEN: 0,
  MOD_POP_HIT: 0.14,        // reputation, per honoured line. Small — it is one
  MOD_POP_MISS: -0.50,      // detail of one ticket — but a broken promise is
                            // half a lost ticket's worth of word of mouth, on
                            // the same scale as POP_LOST (−1.0).
  /* xp for getting a fussy order right.
     ✅ ROUND 7 — CONSUMER WIRED. This shipped read-by-nobody for five rounds and
     drivethru.js's handover O2 spelt out why: `addXp()` is module-private in
     kitchen.state.js, so the lane physically could not pay it, and writing
     `K.xp` from outside would skip the level-up emit, the unlock list and the
     forced save. O2 offered two fixes and round 7 took the second — the
     modifier xp is folded into `serveTicket()` beside the ticket bonus, where
     `addXp()` is in scope — so no new export exists and the level ladder keeps
     exactly one door. */
  MOD_XP_HIT: 3,

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
  /* 🔴 HOW LONG THE "A TRUCK JUST LANDED" STRIP STAYS UP. convoy.js has been
     ASKING THIS FILE FOR THIS KEY IN WRITING since the arrival moment shipped —
     `arriveMs()` reads `EC('CONVOY_ARRIVE_MS', holdMs())` and its comment says
     "`ECON.CONVOY_ARRIVE_MS` wins when its owner adds it". It is here now.
     ⚠ DECLARED AT THE VALUE THE FALLBACK ALREADY PRODUCED, ON PURPOSE. This is
       a seam, not a retune: `holdMs()` returns CONVOY_HOLD_MS, so 5000 changes
       nothing today and the two numbers can now move apart, which is the point
       — the dock hold is "how long before you may claim" and this is "how long
       the banner speaks for", and they are not the same question. convoy.js
       clamps it to 1,000..60,000 whatever lands here. */
  CONVOY_ARRIVE_MS: 5000,

  // ── FX / feel ───────────────────────────────────────────────────────────
  FLOAT_MS: 900,            // float-up lifetime — kitchen.render.js drains
                            // Kitchen._fx on this timer.
  /* ⚠ `SPARK_MS: 500` USED TO SIT HERE AND ROUND 7 DELETED IT. There is no
     spark: `grep -rn "spark" public/src/kitchen/` returned this row, and
     nothing else — no emitter, no CSS keyframe, no renderer. It was a dial
     wired to nothing, which is the same defect as a function nobody calls, and
     the honest fix for a dial with no wire is to remove the dial. If a spark FX
     is ever built, its lifetime comes back HERE and not as a literal in the
     renderer. */
  BURN_WARN_MS: 3000,       // start flashing a slot this long before burnAt

  /* Content hung off ECON BY REFERENCE. Same objects, no second copy.
     🔴 AND `dayName()` / `faceFor()` NOW READ THEM THROUGH ECON, not through the
     module consts beside them. They did not, so both keys were declared and
     read by nothing: a designer retuning ECON.POP_FACES got no faces, because
     the only reader was looking at the other name for the same array. Same
     object either way — the point is that the ECON row is the live one. */
  DAY_NAMES,
  POP_FACES,
};

/* ════════════════════════════════════════════════════════════════════════════
   🤝 THE BARTER COUNTER — RUNG FOUR, AND THE ONLY DOOR IN THE FEATURE THAT
      TAKES NO CINDER AT ALL.
   ----------------------------------------------------------------------------
   🔴🔴 THIS RUNG EXISTS BECAUSE RUNG THREE PAID OUT IN A CURRENCY THAT OPENED
        NO DOOR, AND THIS FILE SAID SO IN WRITING AND DECLINED TO FIX IT.

   MEASURED AT HEAD 9d41440 (scratch r9/dry12.mjs — GEMS=0, all fourteen live
   ids at 0, pantry emptied, the shift re-opened every morning for fourteen
   in-game days, no player actions):
       day  1   food  14  water   8  ◈0   affordable 0   cookable 0
       day  3   food  28  water  16  ◈0   affordable 0   cookable 0
       day 14   food 112  water  64  ◈0   affordable 0   cookable 0   pop 41.6
       dryCheck() → {dry:true, stalled:true, cookable:[], reachable:[],
                     affordable:[], need:['supplies','dna'], ing:'roll'}
       buySupply('sal_mustard',1) → {ok:false, code:'NO_PANTRY',
                     why:'Not enough Cinder — you need 20 and have 0.'}
   The free drop landed every single morning, forever, and every one of the 24
   level-1 crates on the sheet — core AND scrap dealer — carries a Cinder leg.
   The cheapest is `sal_mustard` at ◈20. So the escape hatch's OUTPUT was not
   the INPUT of any door in the game, and round 6's genuine win (the dry gate)
   is what made it SILENT: no cars, no walk-ins, no losses, no toast. The
   restaurant simply stopped, with the stash filling up.

   🔴 AND THIS FILE PREDICTED IT AND ARGUED ITSELF OUT OF FIXING IT. The old
      note under assertDataSane()'s escape-hatch check read: "there is no
      Cinder-free line in SUPPLY_RECIPES — nor CAN there be, because invariant E
      is denominated in Cinder and a zero-Cinder line would BE the cheapest
      route by definition… it is a REAL hole and it is written down here."
      The first half of that is true and the second half does not follow.
      Invariant E is denominated in Cinder because every rung ABOVE this one is
      priced in Cinder. THIS rung is priced in FOOD, so it gets the
      food-denominated form of the same invariant, and it gets it enforced
      (§G in assertDataSane) rather than argued. A hole you have written down is
      still a hole; the note was doing the job of a check.

   ── WHAT WAS REJECTED, AND WHY, SO NOBODY RE-PROPOSES IT ───────────────────
     ✗ PUT CINDER IN THE FREE DROP. That is round 4's Cinder machine with the
       label changed: the parcel would mint the currency the ladder is priced
       in, and the 14-id ledger goes back to being optional. The premise
       (CONTRACT §8.1) is the thing that must survive, not the convenience.
     ✗ DROP THE CINDER LEG OFF `sal_mustard` (or any existing crate). Identical
       objection plus a second one: it makes the scrap dealer cheaper than the
       farm for that ingredient, which is invariant E, which is the reason
       nobody builds a Hydroponics Bay.
     ✗ LET buySupply() TAKE PART-PAYMENT IN FOOD FOR A CINDER LEG. An exchange
       rate hidden inside a purchase function is a second economy with no table
       and no guard, and it would have to be read by the three files that price
       a crate. One rung, one table, one set of invariants.

   ── WHAT THIS RUNG IS ─────────────────────────────────────────────────────
   You carry raw stock across the counter and swap it, in kind, for prepared
   ingredients. No money changes hands and you are robbed on the rate. It is
   priced in `food` and `water` AND NOTHING ELSE, because those are exactly the
   two ids the free parcel carries — a rung the parcel cannot pay for is the
   defect this rung exists to close, so the payable set is DERIVED from the
   parcel rather than chosen (assertDataSane §G2 holds it there).

   THE RATE IS THE WHOLE CORE PRICE, RE-DENOMINATED, TIMES A PREMIUM. Take the
   core line's entire cost — its Cinder leg AND every live leg — value it at the
   game's own cold-storage board (ECON.RES_RETAIL_CINDER, index.html:195218),
   and charge that in food and water instead. Nothing is discounted: the dna in
   a sausage and the supplies in a bun still get paid for, in food. That is what
   makes this the DEAREST route in the game and not a way to launder a missing
   Gene Vault, and it is why the numbers are derived and never typed — a
   hand-kept copy of a price diverges, and this one would diverge in the
   direction of "barter is cheap", which is the printer.

   ── THE FOUR THINGS THAT KEEP IT A FLOOR (all checked, §G) ─────────────────
     1. 🚫 NO CINDER LEG, EVER, and every leg it does have must be an id the
        free parcel carries. Otherwise it is not an escape from a Cinder wall,
        it is a second one.
     2. 💸 DEAREST PER UNIT, ON THE GAME'S OWN BOARD, against BOTH the core line
        and the scrap-dealer line. Measured today, board Cinder per unit:
          roll     10.67  vs core  7.00  vs dealer  8.00
          sausage  20.67  vs core 14.60  vs dealer 14.80
          mustard   6.00  vs core  3.58  vs dealer  4.00
        and in `food` alone — the currency the convoy printer guard is
        denominated in — 1.667 / 3.667 / 1.000 per unit against a core rate of
        0.500 / 0.600 / 0.167. Every barter unit embodies MORE live food than
        the same unit bought any other way, which is the only direction that can
        never open convoyGuardOk()'s fourth wall.
     3. 📦 THE SMALLEST CRATE ON THE SHEET. Quarter crate against the dealer's
        half and the farm's whole, so the same restock is four times the taps.
     4. 🍽 IT REACHES EXACTLY ONE DISH, AND THAT IS DERIVED. It stocks the
        ingredients of the CHEAPEST-IN-FOOD level-1 recipe — today the Hot Dog —
        and nothing else. Not a typed list: a typed list silently fails to cover
        a retuned menu, and an over-generous one turns the floor into the
        kitchen. `ECON.BARTER_MENU_MAX` is the ceiling and assertDataSane()
        holds it.

   ── MEASURED RECOVERY, WHICH IS THE ONLY THING THAT MATTERS HERE ───────────
   One set is 19 food + 6 water for three Hot Dogs, against a drop of 7 food +
   4 water a day. A player at ◈0 with an empty ledger and an empty pantry:
   day 1 buys the mustard, day 2 the rolls, day 3 the sausage and COOKS. Three
   Hot Dogs is deliberately not a shift — it is the sentence "go and get some
   real food" said in the only language a stranded kitchen can hear.
   ⚠ AND IT IS DELIBERATELY NOT A LADDER YOU WOULD EVER CLIMB ON PURPOSE. Three
     dogs a day is under 3% of a working shift, and the same food spent through
     the core counter buys roughly seven times as much. Nobody with a farm ever
     opens this counter; that is the design, not a shortfall.
   ════════════════════════════════════════════════════════════════════════════ */

/* ingredient id → the CORE line that stocks it. Built straight off
   `_SUPPLY_CORE` rather than off the concatenated export, which makes "a dealer
   or barter row can never be canonical" STRUCTURAL instead of guarded.
   🔴 IT USED TO BE A FIRST-WINS SCAN OVER SUPPLY_RECIPES WITH A `kind` SKIP,
   and the history is worth keeping because the failure was silent: last-wins
   would have made the dealer line canonical, `INGREDIENTS[].foodPerUnit` would
   read the dealer's rounded-UP figure for roll, sausage, mustard, dough, sauce,
   cheese and tomato, every recipe made of them would report `foodCost: 0`, and
   convoyGuardOk() — whose entire job is to prove a convoy destroys food rather
   than printing it — would have been comparing CONVOY_FOOD_PER_DISH against
   zero and passing. A one-character difference between "the guard works" and
   "the economy is dead". There is now no ordering to get wrong. */
const _CORE_BY_ING = Object.create(null);
for (const s of _SUPPLY_CORE) {
  if (!s || !s.out || !s.out.ing) continue;
  if (!_CORE_BY_ING[s.out.ing]) _CORE_BY_ING[s.out.ing] = s;
}

const _BARTER = {
  /* Quarter crate. See floor 3 — friction, and the reason the counter can never
     be a restock strategy. Rounds like `_SALVAGE.batchPct` does. */
  batchPct: 0.25,
  /* …but never so small the row is a joke; also what keeps a barter crate
     strictly smaller than the dealer's half crate for every line. */
  minBatch: 2,
  /* THE COUNTER'S CUT, on top of a price that is already the whole core cost
     re-denominated. 🔴 IT IS NOT THE ONLY THING MAKING THIS DEAR — most of the
     penalty is structural, because the core line's Cinder leg is being paid in
     food at ◈4 a unit. The premium is what guarantees a strict inequality
     against the dealer on lines whose non-food legs are small; without it,
     `bar_mustard` prices within a rounding error of `sal_mustard` and §G3
     fires. One knob per idea. */
  premium: 1.25,
  /* THE SHARE OF THE PRICE TAKEN IN `water` RATHER THAN `food`.
     🔴 NOT DECORATION AND NOT A ROUNDING. The free parcel is a fixed pallet
     carrying food AND water (see the RELIEF block on why it is a pallet and not
     a shopping list), and a rung priced in food alone leaves the water half of
     every drop inert — measured before this knob existed, fourteen days of
     drops banked 64 water that nothing in the feature could ever spend. A
     surplus that sits in the 14-id ledger is fine; a surplus that is the only
     thing the escape hatch pays you is the round-6 defect in miniature. */
  waterPct: 0.25,
};

/** What one unit of a supply row costs, valued in Cinder on the game's own
    cold-storage board. Cinder legs count at face; live legs at resRetail().
    This is the ONE comparable number across three rungs priced in three
    different currencies, and every §G inequality is denominated in it. */
function _boardValuePerUnit(row) {
  const c = (row && row.cost) || {};
  let v = (c.cinder || 0);
  for (const k in c) { if (k !== 'cinder') v += c[k] * resRetail(k); }
  return v / Math.max(1, (row && row.out && row.out.qty) | 0 || 1);
}

/**
 * The recipe the barter counter is built to reach: the CHEAPEST-IN-LIVE-FOOD
 * level-1 recipe, priced off the core lines.
 *
 * 🔴 DERIVED, NOT TYPED, FOR THE SAME REASON `_SALVAGE.notStocked` IS AN
 *    EXCLUSION LIST. A typed ingredient list is a list that silently stops
 *    matching the menu: retune the level-1 board and the counter either stops
 *    reaching any dish (the floor quietly vanishes) or starts reaching several
 *    (the floor quietly becomes the kitchen). Both failures look fine in review.
 *    Cheapest-in-food is the right axis because `food` is what the free parcel
 *    mostly carries and what the whole premise is denominated in.
 * ⚠ Reads `_RECIPES_RAW` and not `RECIPES`: RECIPES is normalised further down
 *   the file and is in its temporal dead zone here. `_needsFromSteps` is a
 *   hoisted function declaration, which is why calling it early is safe.
 */
function _barterTarget() {
  let best = null, bestFood = Infinity;
  for (const r of _RECIPES_RAW) {
    if ((r.minLevel || 1) !== 1) continue;
    const needs = _needsFromSteps(r.steps);
    let food = 0, ok = true;
    for (const id in needs) {
      const core = _CORE_BY_ING[id];
      if (!core) { ok = false; break; }
      food += needs[id] * (((core.cost && core.cost.food) || 0) / Math.max(1, core.out.qty | 0));
    }
    if (ok && food < bestFood) { bestFood = food; best = { id: r.id, ings: Object.keys(needs) }; }
  }
  return best;
}

/**
 * One barter line derived from a core line. Pure; no side effects.
 *
 * 🔴 BOTH LEGS ROUND **UP**, AND THAT DIRECTION IS THE GUARD — same argument as
 *    `_salvageLine()`. Rounding down could let a barter-built dish embody less
 *    live food than the same dish built from core lines, which is exactly the
 *    gap a convoy claim pays into (convoyGuardOk()'s fourth wall). Up is the
 *    counter's wastage and the only direction that cannot open the printer.
 * 🔴 THE FOOD LEG HAS A FLOOR OF 1. A line that costs zero food is a Cinder-free
 *    AND food-free crate, i.e. a free ingredient, i.e. an infinite economy. The
 *    floor can never bind at today's prices; it is here so that it cannot.
 */
function _barterLine(core) {
  const coreQty = Math.max(1, core.out.qty | 0);
  const qty = Math.max(_BARTER.minBatch, Math.round(coreQty * _BARTER.batchPct));
  const board = _boardValuePerUnit(core) * qty * _BARTER.premium;
  const cost = {
    food: Math.max(1, Math.ceil((board * (1 - _BARTER.waterPct)) / resRetail('food'))),
  };
  const water = Math.ceil((board * _BARTER.waterPct) / resRetail('water'));
  if (water > 0) cost.water = water;
  return {
    id: 'bar_' + core.out.ing,
    out: { ing: core.out.ing, qty },
    cost,
    /* 🔴 max(1, core's own level), exactly as `_salvageLine()` does it: a
       fallback that unlocks before the thing it is a fallback FOR is the
       "scrapyard outranks the city" bug wearing a different hat. Every level-1
       recipe is built from level-1 core lines, so the floor still opens on the
       first shift for everything the day-one menu needs. */
    minLevel: Math.max(1, core.minLevel || 1),
    /* 🔴 THE THREE FIELDS EVERY OTHER FILE NEEDS — AND ROUND 7 SHIPPED TWO OF
       THEM WITH NO READER, INSIDE THE FIX FOR ROUND 6's BLOCKER. `grep -rn
       "barterOf" public/src/kitchen/` returned the line that writes it and the
       comment that describes it, and nothing else, in the round whose whole
       subject was values computed and consumed by nobody. That is not an
       oversight to note; it is the defect, so both are wired here rather than
       left as an offer:
         • `kind` keys `_BARTER_BY_ING` (below), which the free-drop rescue
           check walks, and it is what the supplies sheet groups on.
         • `barterOf` resolves the core line for §G's seven invariants and for
           §B2's premise check, and it names the same core line the derived
           `blurb` below is written from — which is the half the player can
           actually see, because a check nobody looks at is only half a
           consumer. Delete either field and assertDataSane() reports it by
           name — measured, not asserted: `barterOf: null` → 6 findings ("A
           DERIVED CRATE WITH NO CORE LINE BEHIND IT" ×3 from §B2 and "barter
           line … has no core line behind it" ×3 from §G); `kind: 'barter'`
           dropped → 2 findings, because the rung falls out of `_BARTER_BY_ING`
           and the free-drop rescue check reports the drop reaching no dish.
       ⚠ kitchen.render.js still splits the sheet on `kind === 'salvage'` alone,
         so these rows draw under the CORE heading with the city crates. That is
         a grouping bug in a file this one may not edit; the handover names the
         two lines. It is why the blurb has to carry the comparison itself. */
    kind: 'barter',
    barterOf: core.id,
    /* 🔴 THE SENTENCE IS DERIVED FROM `barterOf`, NOT TYPED, and that is the
       whole reason the field exists. The old blurb — "Swapped across the
       counter, in kind. No money changes hands and the rate is robbery" —
       asserted the robbery and never showed it, on a sheet where "Dog Roll"
       already appears three times with the same icon and the same bold name.
       Naming the city crate's size and the food price beside it is the one
       thing that tells the player WHICH Dog Roll they are looking at, and it
       cannot drift, because it is read off the row it is comparing against. */
    blurb: qty + ' where your city crate gives ' + coreQty + ', at ' + cost.food
      + ' food against ' + (((core.cost && core.cost.food) || 0) || 'none')
      + '. Robbery — and the one door open at \u25c80.',
  };
}

const _BARTER_TARGET = _barterTarget();
const _BARTER_LINES = ((_BARTER_TARGET && _BARTER_TARGET.ings) || [])
  .map((id) => _CORE_BY_ING[id])
  .filter(Boolean)
  .map(_barterLine);

/**
 * 📦 The restock counter the rest of the feature sees: the core lines that eat
 * the live ledger cheapest, then the scrap-dealer lines that eat it dearer,
 * then the barter counter that eats it dearest of all.
 * 🔴 ALL THREE EAT IT. That sentence was "both halves" for one round and the
 *    opposite way round for the round before that, and each time it cost the
 *    feature either its premise or its floor — see the §🗑 and §🤝 blocks.
 * 🔴 ORDER STILL MATTERS FOR READING ORDER ONLY. `_SUPPLY_BY_ING` is no longer
 *    built from this array (it comes off `_SUPPLY_CORE` directly, above), so a
 *    reordering here can no longer make a fallback row canonical. The order is
 *    kept because it is the order the sheet reads in: farm, scrapyard, counter.
 */
export const SUPPLY_RECIPES = _SUPPLY_CORE.concat(_SALVAGE_LINES, _BARTER_LINES);

/** ingredient id → its barter line, or null.
    🔴 KEYED OFF THE ROW'S OWN `kind`, NOT OFF `_BARTER_LINES`, AND THAT IS THE
    POINT. `kind` is the field the supplies sheet groups on, so it has to be
    right on every row; building the lookup off the private array instead would
    leave `kind` a decoration that the sim never depends on, and a decoration is
    what a mislabelled row looks like right up until the screen draws it in the
    wrong section. Reading it here means a row whose `kind` is wrong is a row
    the free-drop rescue check (§ESCAPE) cannot find, which fails loudly.
    ⚠ Walks the EXPORT, so it also picks up a fifth rung added later without
      anyone remembering to add a fourth private array to this line. */
const _BARTER_BY_ING = Object.create(null);
for (const s of SUPPLY_RECIPES) if (s.kind === 'barter') _BARTER_BY_ING[s.out.ing] = s;

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
/* ingredient id → THE CANONICAL supply row that stocks it, which is always the
   CORE line. Built up in the §🤝 block off `_SUPPLY_CORE` itself rather than by
   scanning the concatenated export, so no fallback row can be canonical no
   matter what order the rungs are concatenated in. The whole history of why
   that mattered is on `_CORE_BY_ING`; the short version is that a last-wins
   scan made `foodCost` read ZERO for seven ingredients and the convoy
   food-printer guard compared its numerator against nothing. */
const _SUPPLY_BY_ING = _CORE_BY_ING;
/** ingredient id → its scrap-dealer line, or null. Render uses this to show
    the "or pay the dealer" price beside the real one; the sim never needs it.
    Keyed off `kind` for the same reason `_BARTER_BY_ING` is — see the note there. */
const _SALVAGE_BY_ING = Object.create(null);
for (const s of SUPPLY_RECIPES) if (s.kind === 'salvage') _SALVAGE_BY_ING[s.out.ing] = s;

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


/**
 * 🏷 The open-market Cinder value of one unit of a live resource. Never null,
 * never NaN. Unknown ids fall back to `food`, which is the cheapest thing on
 * the board — so an id nobody priced can never make a guard look SAFER than it
 * is (a zero fallback would have done exactly that: free food, printer open,
 * every check still green).
 */
export function resRetail(id) {
  const b = ECON.RES_RETAIL_CINDER || {};
  const n = b[id];
  return (typeof n === 'number' && n > 0) ? n : (b.food || 1);
}

/**
 * 🪂 RELIEF — the priced parcels. Cinder in, LIVE LEDGER RESOURCES out.
 * Derived from ECON.RES_RETAIL_CINDER × ECON.RELIEF_MARKUP, never typed: two
 * hand-kept copies of one price diverge, and this one would diverge in the
 * direction of "the relief flight is cheap", which is the printer.
 * `cinderPerUnit` is carried so a renderer can print "◈ 300 a tin — fifteen
 * times what it is worth" without recomputing the markup and getting it wrong.
 * (Both halves of that sentence used to be stale in the same comment: the field
 * is `cinderPerUnit`, not `costPerUnit`, and the multiple was seven.)
 */
export const RELIEF = _RELIEF_RAW.map((r) => {
  let retail = 0, units = 0;
  for (const id in r.out) { retail += resRetail(id) * r.out[id]; units += r.out[id]; }
  const cinder = r.free ? 0 : Math.ceil(retail * (ECON.RELIEF_MARKUP || 1));
  return Object.assign({}, r, {
    kind: 'relief',
    cost: { cinder },
    units,
    // What the parcel's contents are worth on the game's own board — carried so
    // a renderer can print the comparison ("◈240 for ◈20 of stock") without
    // recomputing the markup and getting it wrong.
    retailCinder: Math.round(retail),
    cinderPerUnit: Math.round((cinder / Math.max(1, units)) * 100) / 100,
  });
});
const _RELIEF_BY_ID = _index(RELIEF);

/** A relief parcel by id, or null. */
export function relief(id) { return _RELIEF_BY_ID[id] || null; }

/**
 * 🔴 THE CHEAPEST ROUTE TO ONE DISH, IN THE THREE CURRENCIES THAT MATTER.
 * Pure. This is the function every economy guard in this file is built on, and
 * it exists because "the cheapest route" stopped being a single table the
 * moment there were three rungs: for each ingredient it takes whichever of the
 * core line and the scrap-dealer line costs less Cinder per unit, and reports
 * the live resources that route actually consumes.
 *
 * ⚠ IT MINIMISES CINDER, NOT RESOURCES, AND THAT IS THE PESSIMISTIC DIRECTION
 *   ON PURPOSE. A guard that asked "what is the least food this dish can be
 *   made from" would be measuring the best case for the ECONOMY; a player
 *   farming a loop minimises what they PAY, and the thing they pay in is the
 *   thing the loop is denominated in. Measure the exploit, not the intention.
 *
 * 🔴 …AND SINCE THE BARTER COUNTER (§🤝) COSTS NO CINDER AT ALL, "MINIMISE
 *   CINDER" NOW PICKS IT FOR EVERY INGREDIENT IT STOCKS AND REPORTS ◈0. That is
 *   correct for the questions that ask "is there an all-Cinder path" (there is
 *   not, and this proves it) and it is WRONG for any question that needs the
 *   genuinely cheapest END-TO-END cost, because a barter unit is bought with
 *   food and food has to come from somewhere. `reliefRouteCost()` used to be
 *   built straight on this function and would have started reporting the
 *   barter route — four times dearer end to end than the route an exploiter
 *   would actually take — i.e. the guard would have read SAFER than the truth.
 *   It now computes its own per-currency lower bound; see it, and do not add a
 *   third caller here without asking which of the two questions you are asking.
 *
 * ⚠ `payableIn` IS WHAT MAKES IT USABLE TWICE. Pass nothing and it answers
 *   "what is the cheapest this dish can be made for, at all" — which is the
 *   figure the ledger-cost and food-cost invariants need. Pass an array of live
 *   ids and it answers the far more interesting question: "what is the cheapest
 *   this dish can be made for by somebody who can only pay in THESE" — which is
 *   both the relief-loop exploit surface and the actual rescue path a stranded
 *   player walks. The two answers differ: the core counter is always cheaper in
 *   Cinder, so the unrestricted answer routes through `dna` and `supplies` that
 *   a relief parcel cannot buy, and a loop check built on it would have been
 *   vacuous — it returned "no relief route" for 18 of 19 dishes, which reads
 *   exactly like "the loop is shut" and means nothing of the kind. That near
 *   miss is why this parameter exists.
 *
 * → { cinder, res:{liveId:units}, ok, rows:{ing:supplyId} }
 *   ok:false when some ingredient has no line the buyer could use at all.
 */
export function cheapestRoute(recipeId, payableIn) {
  const r = _RECIPE_BY_ID[recipeId];
  if (!r) return { cinder: Infinity, res: {}, rows: {}, ok: false };
  const allow = payableIn ? Object.create(null) : null;
  if (allow) for (const id of payableIn) allow[id] = 1;
  let cinder = 0; const res = Object.create(null); const rows = Object.create(null); let ok = true;
  for (const ing in r.needs) {
    const need = r.needs[ing];
    /* 🔴 THREE RUNGS, NOT TWO. The barter counter joined this list the round it
       shipped; leaving it out would have made every guard built on this
       function blind to the one rung that costs no Cinder, which is precisely
       the shape of the bug the barter counter exists to close. */
    const lines = [_SUPPLY_BY_ING[ing], _SALVAGE_BY_ING[ing], _BARTER_BY_ING[ing]]
      .filter(Boolean).filter((row) => {
        if (!allow) return true;
        for (const k in (row.cost || {})) if (k !== 'cinder' && !allow[k]) return false;
        return true;
      });
    if (!lines.length) { ok = false; continue; }
    let best = null, bestC = Infinity;
    for (const row of lines) {
      const per = ((row.cost && row.cost.cinder) || 0) / Math.max(1, row.out.qty);
      if (per < bestC) { bestC = per; best = row; }
    }
    cinder += bestC * need;
    rows[ing] = best.id;
    const q = Math.max(1, best.out.qty);
    for (const k in (best.cost || {})) {
      if (k === 'cinder') continue;
      res[k] = (res[k] || 0) + (best.cost[k] / q) * need;
    }
  }
  return { cinder: Math.round(cinder * 1000) / 1000, res, rows, ok };
}

/**
 * What one dish costs a player whose ENTIRE ledger came off a relief pallet —
 * the closed Cinder → parcel → dish loop, in Cinder.
 * → { cinder, lineCinder, parcels, binding, parcelId, rows } | null
 *
 * `binding` names the resource that forced the parcel count, which is the whole
 * reason the parcel is a fixed pallet rather than a shopping list: no dish
 * needs food and water in the ratio the pallet carries them, so the binding
 * resource always over-buys the other one and the effective rate is worse than
 * the nominal one. If a dish needs something the parcels do not carry (dna,
 * supplies, fuel, essence) this returns null — that dish simply cannot be made
 * out of a relief drop, which is the point of keeping the parcel low-tier.
 *
 * 🔴🔴 IT IS A LOWER BOUND ON EVERY ROUTE, NOT THE COST OF ONE PARTICULAR
 *      ROUTE, AND THAT CHANGED THE ROUND THE BARTER COUNTER SHIPPED.
 *      It used to be one line — `cheapestRoute(recipeId, parcelIds)` — which
 *      picks, per ingredient, the row with the least CINDER per unit. That was
 *      the same question as "the cheapest way to close this loop" only while
 *      every row had a Cinder leg. §🤝's rows have none, so cheapest-in-Cinder
 *      now always picks barter, and barter is bought in FOOD, which the loop
 *      buys from the parcel at fifteen times retail. Measured on the Hot Dog
 *      the moment barter shipped: the barter route prices the loop at ◈1,275
 *      while the route an actual exploiter takes (the scrap dealer) costs
 *      ◈226 — so the guard would have reported the loop FIVE TIMES safer than
 *      it is, and reported it in the direction that passes. A guard that gets
 *      safer when you add a rung is not a guard.
 *      So: minimise each currency INDEPENDENTLY across all three rungs — the
 *      least Cinder any row charges, and separately the least of each parcel
 *      resource any row charges. No single row need offer both, which is
 *      exactly why the result is a floor under every real route rather than the
 *      price of any one of them. Pessimistic, cheap, and it cannot be made
 *      lenient by adding a rung.
 * ⚠ The consequence to keep in mind when reading a failure: `rows` names the
 *   least-Cinder row per ingredient for reporting, and the resource figures may
 *   have come off DIFFERENT rows. That is deliberate. Do not "fix" it by
 *   pinning both to one row — that is the version that went blind.
 */
export function reliefRouteCost(recipeId, parcelId) {
  const parcel = parcelId ? _RELIEF_BY_ID[parcelId] : _bestParcel();
  if (!parcel) return null;
  const r = _RECIPE_BY_ID[recipeId];
  if (!r) return null;
  const ids = Object.keys(parcel.out);
  let cinder = 0; const res = Object.create(null); const rows = Object.create(null);

  for (const ing in r.needs) {
    const need = r.needs[ing];
    // Only rows this buyer could use at all: every live leg must be on the parcel.
    const lines = [_SUPPLY_BY_ING[ing], _SALVAGE_BY_ING[ing], _BARTER_BY_ING[ing]]
      .filter(Boolean)
      .filter((row) => {
        for (const k in (row.cost || {})) if (k !== 'cinder' && ids.indexOf(k) === -1) return false;
        return true;
      });
    if (!lines.length) return null;            // the pallet cannot build it at all

    let minC = Infinity, cheapest = null;
    for (const row of lines) {
      const per = ((row.cost && row.cost.cinder) || 0) / Math.max(1, row.out.qty);
      if (per < minC) { minC = per; cheapest = row; }
    }
    cinder += minC * need;
    rows[ing] = cheapest.id;

    for (const k of ids) {
      let minR = Infinity;
      for (const row of lines) {
        minR = Math.min(minR, ((row.cost && row.cost[k]) || 0) / Math.max(1, row.out.qty));
      }
      if (Number.isFinite(minR) && minR > 0) res[k] = (res[k] || 0) + minR * need;
    }
  }

  let parcels = 0, binding = null;
  for (const id in res) {
    const per = parcel.out[id] || 0;
    if (per <= 0) return null;
    const n = res[id] / per;
    if (n > parcels) { parcels = n; binding = id; }
  }
  return {
    cinder: Math.round((cinder + parcels * parcel.cost.cinder) * 100) / 100,
    lineCinder: Math.round(cinder * 1000) / 1000,
    parcels: Math.round(parcels * 1000) / 1000,
    binding,
    parcelId: parcel.id,
    rows,
  };
}
/** The cheapest PURCHASABLE parcel per unit — the one an optimiser would use.
    ⚠ The free drop is excluded, and not as an oversight: it is gated on being
    dry and capped at one a day, so it is not a rate anybody can buy at. Letting
    it into this pick would report an effective cost of zero for every dish and
    make the relief-loop guard read "wide open" forever. Its own bound is
    ECON.RELIEF_FREE_DAILY_CINDER_MAX, checked separately. */
function _bestParcel() {
  let best = null;
  for (const p of RELIEF) {
    if (p.free) continue;
    if (!best || p.cinderPerUnit < best.cinderPerUnit) best = p;
  }
  return best;
}
/* ── LOOKUPS. All return null for an unknown id — NEVER throw, never undefined.
      WHY null and not undefined: `recipe(x) || fallback` reads the same either
      way, but a null in a JSON debug dump is visible and an undefined is not. */
export function recipe(id)      { return _RECIPE_BY_ID[id]  || null; }
export function ingredient(id)  { return _ING_BY_ID[id]     || null; }
export function station(id)     { return _STATION_BY_ID[id] || null; }
export function supply(id)      { return _SUPPLY_BY_ID[id]  || null; }
export function supplyFor(ingId){ return _SUPPLY_BY_ING[ingId] || null; }
/** The scrap-dealer line for an ingredient, or null if he does not stock it.
    Render: a null here is the sentence "your city is the only source of this". */
export function salvageFor(ingId){ return _SALVAGE_BY_ING[ingId] || null; }
/** Every recipe a player with an EMPTY live ledger can still cook, in menu
    order. This is THE floor, computed rather than asserted — see _SALVAGE. */
export function salvageMenu() {
  return RECIPES.filter((r) => Object.keys(r.needs).every((id) => !!_SALVAGE_BY_ING[id]));
}
/** What one dish costs in CINDER if EVERY unit of it came out of the scrap
    dealer. ⚠ Cinder only — the dealer's `food` legs are deliberately not in
    this figure, because its two callers (the underwater floor check and
    convoyGuardOk's Cinder wall) are both asking a Cinder-denominated question.
    For the food side use convoyGuardOk()'s fourth wall or cheapestRoute().
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
 *    three full days off the scrap dealer alone: 324 tickets placed, and 122 of
 *    the 142 lost ones — 86% — contained a dish that kitchen could NEVER make. Only
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
 *
 * ✅ CONSUMER — WIRED IN ROUND 7, AND THIS COMMENT USED TO BE A LIE IN TWO
 *    DIRECTIONS. It said "NOBODY PASSES IT YET" (true, for two rounds) and it
 *    named `ECON.COOKABLE_BIAS`, WHICH DID NOT EXIST — kitchen.selftest.js's
 *    COMMENT LIES check caught the second one. Both are closed:
 *      • `ECON.COOKABLE_BIAS` (0.75) is declared in the table above;
 *      • kitchen.state.js's local wrapper now takes the second argument, and
 *        `spawnCounter()` rolls it exactly the way `LIKE_BIAS` is rolled:
 *        `rng() < EC('COOKABLE_BIAS') ? menuForLevel(lv, hot) : menuForLevel(lv)`.
 *    THE MEASUREMENT THAT MADE IT NECESSARY, kept because it is the argument:
 *    over twenty in-game days, raising ECON.POP_REVERT_PER_DAY to the threshold
 *    moved a stranded kitchen's popularity from "pinned on 2 for eighteen of
 *    twenty days, mean 3.6" to a flat 30 — the floor moved, which was the fix
 *    available in this file — but the meter still did not BREATHE, because the
 *    bot was still losing 45–90 tickets a day to orders it could not fill.
 *
 * ⚠ ONE GENERATOR STILL DOES NOT PASS IT: drivethru.js's lane. That is the
 *   other half and it is somebody else's file — see the round-7 handover. Until
 *   it does, a stranded kitchen's LANE tickets are still drawn from the full
 *   board while its COUNTER tickets are not.
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
  // ⚠ THROUGH ECON, deliberately — see the "Content hung off ECON" note in the
  //    table. Reading the module const instead is what left ECON.DAY_NAMES
  //    declared and read by nothing for six rounds.
  const names = ECON.DAY_NAMES;
  return names[(d - 1) % names.length];
}

/** The emoji face for the popularity meter. Never null. */
export function faceFor(pop) {
  const p = Math.min(ECON.POP_MAX, Math.max(ECON.POP_MIN, pop || 0));
  const faces = ECON.POP_FACES;      // ⚠ through ECON — see dayName().
  let out = faces[0];
  for (const f of faces) if (p >= f.min) out = f;
  return out;
}

/**
 * 🔴 THE WHOLE DAY-ROLL POPULARITY SETTLE, IN ONE SIGNED NUMBER.
 *
 * ✅ CONSUMER: kitchen.state.js `closeShift()`, via `DF('popDayDelta')`. ONE
 *    call, once per day roll, and there is no longer a second copy of the
 *    arithmetic anywhere in the feature.
 *
 * 🔴 AND THAT SENTENCE IS THE POINT OF THIS FUNCTION, BECAUSE IT WAS FALSE FOR
 *    TWO ROUNDS. closeShift()'s day-roll used to reassemble the settle from
 *    loose constants — `bumpPop(EC('POP_DECAY_PER_DAY'))` plus a clean-day
 *    bonus written out as `-EC('POP_DECAY_PER_DAY') * 2`, plus its own copy of
 *    the revert clamp — which is precisely how POP_REVERT_BELOW /
 *    POP_REVERT_PER_DAY shipped as dead data in the first place: a settle
 *    assembled at the call site can silently be missing one of its terms and
 *    still read fine. Round 5 declared the ratchet fixed; kitchen.selftest.js
 *    then reported this function with ZERO CALL SITES. Returning the finished
 *    delta means the only way to get it wrong is not to call it.
 *
 * ⚠ IT IS APPLIED AS ONE `bumpPop()`, NOT TWO. That is a real behavioural
 *   difference and it is the correct one: bumpPop() damps movement within
 *   POP_SOFT_MARGIN of a rail, so decay-then-bonus as two calls damped each leg
 *   separately and the net drift near 0 and near 100 depended on the ORDER the
 *   two lines happened to be written in. One settle, one damping.
 *
 * Three rules, in this order:
 *   1. Below ECON.POP_REVERT_BELOW the town forgets, INSTEAD of the decay, by
 *      POP_REVERT_PER_DAY — clamped so it can never carry a kitchen above the
 *      threshold itself. It is not a floor and not a gift: 30/100 is below
 *      POP_START and below every pay multiplier worth having, so the climb out
 *      of the hole is still entirely the player's. What it stops is the hole
 *      being infinitely deep, which is what it was — measured, a competent
 *      auto-player pinned at 0 from day 3 through day 60, and even after the
 *      reversion was wired at 2.0/day a resourceless one sat on exactly 2 for
 *      eight consecutive days. See ECON.POP_REVERT_PER_DAY for the whole
 *      derivation and for why there is no second, proportional knob.
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
  /* 🔴 THE CLAMP IS THE MECHANIC, NOT A SAFETY RAIL. It is what makes the
     reversion un-farmable (see ECON.POP_REVERT_PER_DAY): the drift can never
     carry a kitchen ABOVE the threshold, so there is nothing to farm.
     ⚠ ROUND 7 DELETED THE SECOND COPY. This expression used to be duplicated
       byte-for-byte in kitchen.state.js's day roll with a note saying "change
       one, change both". That note is what a drifting duplicate always looks
       like on the way in. There is one copy now; keep it that way. */
  const d0 = (p < ECON.POP_REVERT_BELOW)
    ? Math.min(ECON.POP_REVERT_PER_DAY, Math.max(0, ECON.POP_REVERT_BELOW - p))
    : decay;
  let d = d0;
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
     🔴🔴 THE THIRD WALL, AND IT DID NOT EXIST UNTIL THE SCRAP DEALER DID.
     ═════════════════════════════════════════════════════════════════════════
     Both walls above are denominated in `food`, and both read `recipe.foodCost`,
     which is derived from the CORE supply lines. For one round the dealer sold
     the same ingredients for Cinder and NO live resources at all — so a dish
     bought entirely out of him cost exactly ZERO food, delivered
     CONVOY_FOOD_PER_DISH units of food on claim, and is invisible to every
     `foodCost` comparison in this function. Cinder in, food out: a printer, and
     the two existing walls would both have reported ok:true while it ran.
     The wall that actually holds it shut is denominated in CINDER: producing a
     shippable dish by the CHEAPEST AVAILABLE ROUTE must cost more Cinder than
     the food it delivers is worth. `food` is worth 4 (the game's own valuation,
     see _SALVAGE.resCinder), the cheapest salvage-buildable shippable dish is a
     Hot Dog at 21.33 Cinder, and CONVOY_CINDER_GUARD_MULT is the multiple of
     retail that must hold. Measured today: the bar is 1 dish x ◈4 x 2.0 = ◈8
     and the cheapest route costs ◈21.33, so the wall stands at 2.7x the bar and
     5.3x the raw value of the food delivered. ⚠ THE NUMBER IN THIS SENTENCE IS
     PRINTED BY convoyGuardOk(), NOT TYPED — it said "seven times over" for a
     round after the dealer's prices moved. Read it off `__mk.debug()`.
     It is checked so that it STAYS absurd.
     ⚠ If a future line makes some cheap dish salvage-buildable, this is the
       check that fails. Do not raise the multiplier to silence it. */
  const foodValue = resRetail('food');
  const needCinder = perDish * foodValue * (ECON.CONVOY_CINDER_GUARD_MULT || 1);
  let cinderMin = Infinity, cinderWorst = null;
  for (const r of RECIPES) {
    if (!r.ship) continue;
    const c = salvageCinderCost(r.id);
    if (c < cinderMin) { cinderMin = c; cinderWorst = r.id; }
  }
  const cinderOk = !(cinderMin < needCinder);   // Infinity (no salvage route) passes

  /* ═════════════════════════════════════════════════════════════════════════
     🔴🔴 THE FOURTH WALL, AND IT IS THE ONE THIS ROUND ADDED THE HOLE FOR.
     ═════════════════════════════════════════════════════════════════════════
     Walls one and two read `recipe.foodCost`, which is derived from the CORE
     lines only (see `_SUPPLY_BY_ING` — salvage rows are never canonical). That
     was safe while the scrap dealer's crates cost NO food, because then the
     Cinder wall above was the only thing holding, and it held enormously.
     The moment the dealer's crates carry a `food` leg — which is the whole
     point of this round — a THIRD food figure exists per dish: what the dish
     costs if every unit of it came out of the bin. If that figure is ever below
     CONVOY_FOOD_PER_DISH the convoy prints food again, and walls one, two and
     three all report ok:true while it runs, exactly as walls one and two did
     for the Cinder-only bin.
     This is why `_salvageLine()` rounds its food leg UP rather than down: up is
     the only direction that cannot open this gap. The check is here so that a
     future retune of `batchPct`, `minBatch` or the rounding cannot close it
     quietly. ⚠ Do not "fix" a failure here by lowering CONVOY_FOOD_PER_DISH
     without re-running all four walls — it is the numerator of three of them. */
  let binMin = Infinity, binWorst = null;
  for (const r of RECIPES) {
    if (!r.ship) continue;
    let f = 0, complete = true;
    for (const ing in r.needs) {
      /* 🔴 THE MINIMUM ACROSS EVERY RUNG, NOT "the dealer's row if he has one".
         This read `_SALVAGE_BY_ING[ing] || _SUPPLY_BY_ING[ing]` — a PREFERENCE,
         not a minimum — which was harmless only while there were exactly two
         rungs and the dealer's food leg was always the dearer of the two. With
         three rungs a preference can walk straight past the cheapest one, and
         the cheapest one is the whole question this wall asks. It is a
         minimum now, so a fourth rung joins it by being listed and cannot make
         the wall report safer than it is. */
      let per = Infinity;
      for (const row of [_SUPPLY_BY_ING[ing], _SALVAGE_BY_ING[ing], _BARTER_BY_ING[ing]]) {
        if (!row) continue;
        per = Math.min(per, ((row.cost && row.cost.food) || 0) / Math.max(1, row.out.qty));
      }
      if (!Number.isFinite(per)) { complete = false; break; }
      f += r.needs[ing] * per;
    }
    if (complete && f < binMin) { binMin = Math.round(f * 1000) / 1000; binWorst = r.id; }
  }
  const binOk = !(binMin <= perDish);

  return {
    ok: perDish < shipMin && perDish < anyMin && cinderOk && binOk,
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
    // The scrap-dealer food wall.
    binFoodMin: binMin === Infinity ? null : binMin,
    binFoodWorst: binWorst,
    binOk,
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

  /* ── 🔴🔴 THE RESOURCE LOOP. SIX INVARIANTS, AND EVERY ONE OF THEM IS A BUG
        THIS FEATURE HAS ACTUALLY SHIPPED. Read the _SALVAGE and RELIEF blocks
        before changing any of them; between them they hold the two halves of
        the requirement that four rounds have failed to hold at the same time.
          A. A PLAYER WITH AN EMPTY LEDGER CAN STILL GET BACK TO COOKING.
             Rounds 1, 2 and 3 all shipped a state where they could not.
          B. AND THEY CANNOT DO IT WITHOUT SPENDING LIVE RESOURCES. Round 4
             shipped the opposite failure: measured on a real ledger, ten days
             and 188 dishes with `wallet.resOut` the literal empty object. A
             kitchen that runs on Cinder is not the feature that was asked for.
          C. THE FLOOR IS NOT THE KITCHEN. The scrap dealer must stay a MINORITY
             of a grown menu and stay on the CHEAP END of it.
             ⚠ The first draft of this check was "the bin may cover NOTHING
               above level 1", which is a cleaner sentence and the wrong rule.
               Measured, it left a stranded player able to cook 2 of the 8
               dishes their level had unlocked, and since a ticket is
               all-or-nothing they filled 15 of 90 tickets a day and sat at
               popularity 2 — technically not stuck and completely broken.
               Share and value are the honest axes; "level" was a proxy that
               measured the wrong thing.
          D. THE FLOOR IS NEVER UNDERWATER. Every dish the bin can build must
             pay for itself at the WORST pay multipliers the game hands out.
          E. THE FLOOR IS NEVER THE CHEAP ROUTE. Per unit, always dearer than
             the core line, or nobody ever builds a Hydroponics Bay.
          F. THE RELIEF LOOP IS SHUT. Cinder → parcel → dish → Cinder must lose
             money on EVERY dish at the BEST multipliers, or rung three is the
             round-4 printer with an extra hop in it. */
  const salvMenu = salvageMenu();
  if (!salvMenu.length) {
    bad.push('🔴 NO FLOOR: the scrap dealer cannot build a single recipe, so a player whose city '
      + 'is dry has no route back to cooking at any price');
  }
  if (!salvMenu.some((r) => (r.minLevel || 1) === 1)) {
    bad.push('🔴 NO FLOOR ON DAY ONE: the scrap dealer covers no level-1 recipe — a brand-new '
      + 'account that runs out of the grubstake is stuck');
  }
  /* 🔴 A — AND IT HAS TO BE THE WHOLE DAY-ONE PROMISE, NOT SOME OF IT.
     MEASURED: the level-1 menu shows a Hot Dog, a Classic Burger and a
     Margherita, and before this round the restock ladder sustained the Hot Dog
     and the Margherita only — the Classic Burger needs a patty and no rung
     below the core counter stocked one. A first session that puts three dishes
     on the board and can keep feeding you two is the round-1 dead end wearing a
     better coat: the burger silently stops existing on day two. This check is
     why `patty` came off _SALVAGE.notStocked. */
  const dayOneMenu = menuForLevel(1);
  const dayOneGap = dayOneMenu.filter((r) => !salvMenu.some((x) => x.id === r.id)).map((r) => r.id);
  if (dayOneGap.length) {
    bad.push('🔴 THE FIRST SESSION PROMISES MORE THAN THE LADDER SUSTAINS: the level-1 menu is '
      + dayOneMenu.map((r) => r.id).join(', ') + ' but the scrap dealer cannot rebuild '
      + dayOneGap.join(', ') + ' — those dishes vanish the day the grubstake runs out');
  }
  /* 🔴 B — THE CHECK THAT WAS MISSING IN ROUND 4, AND ITS ABSENCE IS WHY THE
     ROUND SHIPPED A CINDER MACHINE. Every crate on the restock counter must
     cost at least one of the fourteen live ids. A Cinder-only crate is not a
     "floor"; it is a second economy, and once one exists the player's city,
     businesses and battles stop being the input to the kitchen at all.
     ⚠ THIS IS THE INVERSE OF THE CHECK THAT USED TO LIVE HERE. The old one
       read "skip-bin line X costs a live resource — then it is not a route for
       a player who has none", which is a perfectly sound sentence about a
       DEAD END and the exact reasoning that deleted the premise. The answer to
       "a player with no resources" is rung three (RELIEF), which SELLS them
       resources at a punitive rate — not a crate that needs none. */
  for (const s of SUPPLY_RECIPES) {
    const live = Object.keys(s.cost || {}).filter((k) => k !== 'cinder');
    if (!live.length) {
      bad.push('🔴 A CINDER-ONLY CRATE: ' + s.id + ' costs no live resource at all. Every route to '
        + 'a dish must spend the 14-id ledger, or the kitchen stops being fed by the city builder, '
        + 'the businesses and the battles the player asked for');
    }
  }
  /* ── 🔴 B2 — THE SENTENCE ON THE SUPPLIES SHEET, HELD AS AN INVARIANT. ────
     B above is asked one row at a time, and TWO THIRDS OF THE ROWS ARE NOT
     TYPED. `_SALVAGE_LINES` and `_BARTER_LINES` are COMPUTED from the core
     table, so one deleted line inside `_salvageLine()` takes the live leg off
     twenty crates in a single keystroke. MEASURED, round 7, by a critic who
     did exactly that: dropping `if (primary) cost[primary] = …` turned
     `sal_dough {cinder:36, food:3}` into `{cinder:36}` on all twenty salvage
     rows — the round-4 regression restored — and the point of the exercise was
     that the FEATURE'S OWN GATE could not tell the two builds apart.

     🔴 WHAT MAKES THIS ONE WORTH ADDING ON TOP OF B. B fires on that mutation,
        loudly (55 findings), and it fires as fifty-five downstream sentences
        about relief printers and convoy guards — the cascade, not the cause.
        This one names the cause in one line, per row, and points at the screen:
        kitchen.render.js states as a FACT to the player that "Every crate on
        this sheet — including the scrap dealer's — costs live resources your
        city buildings, your businesses and your battles produce." That sentence
        IS the player's request, rendered. B says a crate must cost SOMETHING
        live; B2 says a DERIVED crate must cost the same live id its core line
        costs, at no lower a rate per unit — which is the only form of the rule
        that survives a fallback rung being re-derived.

     🔴 AND IT IS ALSO WHERE `kind` / `salvageOf` / `barterOf` ARE CONSUMED.
        Those three fields were computed for a renderer, and for `barterOf` no
        renderer ever read it. A field that only a comment reads is the defect
        this feature has shipped in five separate places; wiring the back
        reference into the check that needs the core line is what makes it a
        field rather than a note. Break the pointer and this loop says so. */
  const DERIVED_RUNG = { salvage: 'the scrap dealer', barter: 'the barter counter' };
  for (const s of SUPPLY_RECIPES) {
    const kind = s.kind || 'core';
    if (kind === 'core') continue;
    const rung = DERIVED_RUNG[kind];
    if (!rung) {
      bad.push('SUPPLY_RECIPES ' + s.id + ': unknown kind "' + kind + '" — kitchen.render.js groups '
        + 'the sheet on this field, so a row it does not recognise draws in the wrong section');
      continue;
    }
    const backRef = s.salvageOf || s.barterOf || null;
    const core = backRef ? _SUPPLY_BY_ID[backRef] : null;
    if (!core) {
      bad.push('🔴 A DERIVED CRATE WITH NO CORE LINE BEHIND IT: ' + s.id + ' is ' + rung + '\'s row '
        + 'and its back reference (' + (backRef || 'missing') + ') resolves to nothing — the row can '
        + 'no longer say what your city would have charged, and nothing can check its price');
      continue;
    }
    if (core.out.ing !== s.out.ing) {
      bad.push('SUPPLY_RECIPES ' + s.id + ': back reference points at ' + core.id + ', which stocks '
        + core.out.ing + ' and not ' + s.out.ing);
      continue;
    }
    /* The live id the core line is denominated in — food wherever it has any,
       otherwise its largest live leg. Exactly what `_salvagePrimary()` derives,
       called on the core line rather than re-typed, so the check and the price
       can never disagree about which resource "in kind" means. */
    const primary = _salvagePrimary(core);
    if (!primary) continue;          // a core line with no live leg at all: B's finding, not this one
    const per  = ((s.cost && s.cost[primary]) || 0) / Math.max(1, s.out.qty);
    const cper = ((core.cost && core.cost[primary]) || 0) / Math.max(1, core.out.qty);
    if (!(per > 0)) {
      bad.push('🔴 ' + s.id + ' HAS STOPPED EATING THE LEDGER: ' + rung + ' sells ' + s.out.ing
        + ' for ' + JSON.stringify(s.cost) + ', with no `' + primary + '` in it, while the city line '
        + core.id + ' pays ' + cper.toFixed(3) + ' ' + primary + '/unit. kitchen.render.js tells the '
        + 'player as a FACT that every crate on this sheet costs live resources their city, '
        + 'businesses and battles produce — you have just made that sentence false. This is the '
        + 'round-4 regression: the last time it shipped, ten days and 188 dishes moved the 14-id '
        + 'ledger zero times. Put the leg back in _salvageLine()/_barterLine(); do not scope this '
        + 'check around the row');
    } else if (cper > 0 && !(per >= cper)) {
      bad.push('🔴 ' + s.id + ' DISCOUNTS `' + primary + '`: ' + per.toFixed(3) + '/unit against '
        + core.id + '\'s ' + cper.toFixed(3) + '. A fallback cheaper IN KIND than the line it falls '
        + 'back for is a dish that embodies less live ' + primary + ' than recipe.foodCost claims, '
        + 'and that gap is where a Cinder→resource printer lives — see convoyGuardOk()\'s fourth wall');
    }
  }
  /* 🔴 B3 — AND THE BREADTH OF IT, because B and B2 are both satisfied by a
     kitchen that eats `food` and nothing else. See ECON.LEDGER_BREADTH_MIN for
     the measured census and for why three of the fourteen are deliberately
     out. Counted across BOTH doors the ledger leaves by — the restock counter
     and the upgrade shop — because "the kitchen is fed by the rest of your
     game" is a claim about the whole feature and not about one screen. */
  const LIVE_SEEN = Object.create(null);
  for (const row of SUPPLY_RECIPES) for (const k in (row.cost || {})) {
    if (k !== 'cinder' && LIVE.indexOf(k) !== -1) LIVE_SEEN[k] = 1;
  }
  for (const u of UPGRADES) for (const k in (u.cost || {})) {
    if (k !== 'cinder' && LIVE.indexOf(k) !== -1) LIVE_SEEN[k] = 1;
  }
  const seenIds = Object.keys(LIVE_SEEN);
  if (seenIds.length < (ECON.LEDGER_BREADTH_MIN | 0)) {
    bad.push('🔴 THE KITCHEN HAS STOPPED EATING THE LEDGER BROADLY: the restock counter and the '
      + 'upgrade shop between them name only ' + seenIds.length + ' of the 14 live ids ('
      + seenIds.sort().join(', ') + ') against a floor of ' + ECON.LEDGER_BREADTH_MIN
      + '. The player asked for a kitchen fed by "the different types of resources that they get '
      + 'from the other parts of the game" — one id is a faucet with extra steps, and every other '
      + 'premise check in this function passes a kitchen that runs on food alone');
  }
  /* 🔴 …AND THE SAME THING SAID AT THE DISH LEVEL, because a per-crate check
     can be satisfied while some particular dish still has an all-Cinder path
     through a combination of crates nobody looked at. */
  for (const r of RECIPES) {
    const route = cheapestRoute(r.id);
    if (!route.ok) continue;      // reported separately as a missing supply line
    const live = Object.keys(route.res).filter((k) => route.res[k] > 0);
    if (!live.length) {
      bad.push('🔴 A DISH WITH NO LEDGER COST: ' + r.id + ' can be built for Cinder alone by its '
        + 'cheapest route — the live-resource loop the player asked for is decorative for that dish');
    }
    if (!((route.res.food || 0) > 0)) {
      bad.push('🔴 FOOD IS NOT FOR SALE: ' + r.id + ' can be built without spending live `food` by '
        + 'its cheapest route. `food` is what the convoy printer guard is denominated in and what '
        + 'the whole premise turns on — every dish must embody some');
    }
  }
  /* C — SHAPE. The dealer must be most of a beginner's kitchen and a minority of
     a grown one, and he must live on the cheap end of the board. Both are
     checked from the derived coverable set, so an added ingredient or a changed
     exclusion cannot quietly move them. */
  const covered = Object.create(null);
  for (const r of salvMenu) covered[r.id] = 1;
  const topMenu = menuForLevel(ECON.MAX_LEVEL);
  const share = topMenu.length ? (salvMenu.length / topMenu.length) : 0;
  if (share > ECON.SALVAGE_SHARE_MAX) {
    bad.push('🔴 THE FLOOR IS THE KITCHEN: the scrap dealer can build ' + salvMenu.length + ' of '
      + topMenu.length + ' dishes (' + Math.round(share * 100) + '%, max '
      + Math.round(ECON.SALVAGE_SHARE_MAX * 100) + '%) — one rung runs most of the menu and '
      + 'the rest of the ladder is decorative');
  }
  let inSum = 0, inN = 0, outSum = 0, outN = 0;
  for (const r of topMenu) {
    if (covered[r.id]) { inSum += r.basePrice; inN++; } else { outSum += r.basePrice; outN++; }
  }
  const inMean = inN ? inSum / inN : 0, outMean = outN ? outSum / outN : 0;
  if (!outN) {
    bad.push('🔴 THE FLOOR IS THE KITCHEN: there is no dish the scrap dealer cannot build');
  } else if (!(inMean * ECON.SALVAGE_VALUE_GAP <= outMean)) {
    bad.push('🔴 THE FLOOR IS NOT ON THE CHEAP END: scrap-dealer dishes average ' + Math.round(inMean)
      + ' Cinder against ' + Math.round(outMean) + ' for the ones that need the city — the city '
      + 'must be worth at least ' + ECON.SALVAGE_VALUE_GAP + '× a dish, or building it is optional');
  }
  // D — never underwater.
  for (const r of salvMenu) {
    const cost = salvageCinderCost(r.id);
    const worstPay = r.basePrice * ECON.POP_PAY_FLOOR * ECON.RUSH_PAY_MIN;
    if (!(cost < worstPay)) {
      bad.push('🔴 THE FLOOR IS UNDERWATER: ' + r.id + ' costs ' + cost
        + ' Cinder out of the scrap dealer against a worst-case payout of '
        + Math.round(worstPay * 10) / 10 + ' — a stranded player cooking it goes BACKWARDS');
    }
  }
  // E — never the cheap route, and never a bigger crate, and food is paid in food.
  for (const s of _SALVAGE_LINES) {
    /* Through the row's own `salvageOf`, not through the ingredient index. Same
       reason B2 does it: the back reference is the thing render prints the
       "your city: 10 for ◈60 + 6 food" chip from, so the invariants have to
       break when it breaks — a pointer nothing depends on is a pointer that
       rots. `_SUPPLY_BY_ID` and not `_SUPPLY_BY_ING`: the reference names a
       ROW, and B2 has already proved it names the row for this ingredient. */
    const core = _SUPPLY_BY_ID[s.salvageOf] || null;
    if (!core) { bad.push('scrap-dealer line ' + s.id + ' has no core line behind it'); continue; }
    const sp = s.cost.cinder / Math.max(1, s.out.qty);
    const bp = ((core.cost && core.cost.cinder) || 0) / Math.max(1, core.out.qty);
    if (!(sp > bp)) {
      bad.push('🔴 THE SCRAP DEALER IS THE CHEAP ROUTE: ' + s.id + ' is ' + sp.toFixed(2)
        + ' Cinder/unit against the core line\'s ' + bp.toFixed(2)
        + ' — nobody would ever spend a resource again');
    }
    /* 🔴 AND THE ONE THAT KEEPS THE CONVOY WALL HONEST. The dealer may convert
       water, dna, supplies, fuel and essence into Cinder — that is his whole
       product — but never `food`. A bin crate cheaper in food than its core
       line is a dish cheaper in food than `recipe.foodCost`, which is the
       figure convoyGuardOk()'s first two walls read; the gap between them is
       where a Cinder→food printer lives. See convoyGuardOk()'s fourth wall. */
    const corePer = ((core.cost && core.cost.food) || 0) / Math.max(1, core.out.qty);
    const salPer  = ((s.cost && s.cost.food) || 0) / Math.max(1, s.out.qty);
    if (corePer > 0 && !(salPer >= corePer)) {
      bad.push('🔴 THE SCRAP DEALER DISCOUNTS FOOD: ' + s.id + ' is ' + salPer.toFixed(3)
        + ' food/unit against the core line\'s ' + corePer.toFixed(3)
        + ' — that gap is a Cinder→food convoy printer and three of the four walls cannot see it');
    }
    if (s.out.qty >= core.out.qty) {
      bad.push('scrap-dealer line ' + s.id + ' is not a smaller crate than the core line ('
        + s.out.qty + ' vs ' + core.out.qty + ')');
    }
    /* 🔴 AND THE DEALER NEVER OPENS BEFORE THE CITY LINE HE IS A FALLBACK FOR.
       MEASURED, BEFORE THIS ROUND: every bin line was hardcoded minLevel 1, so
       `sal_oil`, `sal_syrup` and `sal_ice` were buyable at level 1 against
       level-2 core lines, `sal_slaw` at 1 against 3 and `sal_pickle` at 1
       against 5. For five ingredients the SCRAPYARD OUTRANKED THE CITY — a
       level-1 player could buy pickles they could not use until level 5, and
       the cheap route unlocked before the real one. `_salvageLine()` takes the
       max now; this is the wire that stops a future `minLevel` edit undoing it. */
    if ((s.minLevel || 1) < (core.minLevel || 1)) {
      bad.push('🔴 THE SCRAPYARD OUTRANKS THE CITY: ' + s.id + ' unlocks at level '
        + (s.minLevel || 1) + ' but the core line it falls back FOR (' + core.id
        + ') needs level ' + (core.minLevel || 1) + ' — the cheap route opens before the real one');
    }
  }
  /* ── 🔴 G — THE BARTER COUNTER (§🤝). SEVEN INVARIANTS, AND THEY ARE THE
        FOOD-DENOMINATED FORM OF E, NOT AN EXEMPTION FROM IT. ─────────────────
     E asks "is the fallback dearer in Cinder than the thing it falls back for".
     Rung four charges no Cinder at all, so asked in Cinder E is vacuous for it
     and E's loop deliberately does not walk these rows. Asked in the currency
     the counter is actually priced in — the game's own board value per unit,
     `_boardValuePerUnit()` — it is the same question and it is asked here.
     🔴 A ZERO-CINDER ROW IS THE THING THIS FILE SPENT THREE ROUNDS REFUSING TO
        SHIP. It is safe only while every one of these holds; if one of them
        fires, the correct response is to fix the price, never to scope the
        check around the row. */
  const _freeParcel = RELIEF.filter((p) => p.free)[0] || null;
  for (const s of _BARTER_LINES) {
    // Through `barterOf`, for the reason written out on the E loop above.
    const core = _SUPPLY_BY_ID[s.barterOf] || null;
    const sal = _SALVAGE_BY_ING[s.out.ing];
    if (!core) { bad.push('barter line ' + s.id + ' has no core line behind it'); continue; }

    // G1 — no Cinder leg, ever. The entire reason this rung exists.
    if ((s.cost || {}).cinder) {
      bad.push('🔴 THE BARTER COUNTER TAKES CINDER: ' + s.id + ' charges ◈'
        + s.cost.cinder + '. Rung four exists so that a player at ◈0 with a full stash has a '
        + 'door; one Cinder in its price and it is another wall');
    }
    // G2 — every leg must be an id the FREE parcel actually carries. Derived
    //      from the parcel rather than assumed, because "the drop pays out what
    //      no door takes" is exactly the defect this rung closes.
    if (_freeParcel) {
      for (const k in (s.cost || {})) {
        if (!((_freeParcel.out[k] || 0) > 0)) {
          bad.push('🔴 THE BARTER COUNTER WANTS SOMETHING THE DROP DOES NOT CARRY: ' + s.id
            + ' costs `' + k + '` and ' + _freeParcel.id + ' pays out '
            + JSON.stringify(_freeParcel.out) + ' — the escape hatch\'s output must be this '
            + 'rung\'s input or the ladder has a rung with no step below it');
        }
      }
    }
    // G3 — dearest per unit on the game's own board, against BOTH other rungs.
    const bv = _boardValuePerUnit(s), cv = _boardValuePerUnit(core);
    if (!(bv > cv)) {
      bad.push('🔴 THE BARTER COUNTER IS THE CHEAP ROUTE: ' + s.id + ' is ' + bv.toFixed(2)
        + ' Cinder of board value per unit against the core line\'s ' + cv.toFixed(2)
        + ' — the emergency rung must never be a strategy');
    }
    if (sal && !(bv > _boardValuePerUnit(sal))) {
      bad.push('🔴 THE BARTER COUNTER UNDERCUTS THE SCRAP DEALER: ' + s.id + ' is ' + bv.toFixed(2)
        + ' against ' + sal.id + '\'s ' + _boardValuePerUnit(sal).toFixed(2)
        + ' — rung four is below rung three and the ladder is upside down');
    }
    // G4 — and dearest in `food` specifically, which is the currency
    //      convoyGuardOk()'s food walls are denominated in. Cheaper in food than
    //      the core line is a dish cheaper in food than `recipe.foodCost`, and
    //      that gap is where a Cinder→food convoy printer lives.
    const bf = ((s.cost && s.cost.food) || 0) / Math.max(1, s.out.qty);
    const cf = ((core.cost && core.cost.food) || 0) / Math.max(1, core.out.qty);
    if (!(bf > 0)) {
      bad.push('🔴 A FOOD-FREE BARTER LINE: ' + s.id + ' costs no live `food`. With no Cinder leg '
        + 'either, that is a free ingredient, which is an infinite economy');
    } else if (cf > 0 && !(bf >= cf)) {
      bad.push('🔴 THE BARTER COUNTER DISCOUNTS FOOD: ' + s.id + ' is ' + bf.toFixed(3)
        + ' food/unit against the core line\'s ' + cf.toFixed(3)
        + ' — see convoyGuardOk()\'s fourth wall; that gap is the printer');
    }
    // G5 — the smallest crate on the sheet, on both comparisons.
    if (!(s.out.qty < core.out.qty)) {
      bad.push('barter line ' + s.id + ' is not a smaller crate than the core line ('
        + s.out.qty + ' vs ' + core.out.qty + ')');
    }
    if (sal && !(s.out.qty < sal.out.qty)) {
      bad.push('barter line ' + s.id + ' is not a smaller crate than the scrap-dealer line ('
        + s.out.qty + ' vs ' + sal.out.qty + ')');
    }
    // G6 — never opens before the line it is a fallback for.
    if ((s.minLevel || 1) < (core.minLevel || 1)) {
      bad.push('🔴 THE BARTER COUNTER OUTRANKS THE CITY: ' + s.id + ' unlocks at level '
        + (s.minLevel || 1) + ' against ' + core.id + '\'s ' + (core.minLevel || 1));
    }
  }
  /* G7 — THE FLOOR IS NOT THE KITCHEN, said about rung four the same way C says
     it about rung three. Derived from the rows, so an added barter line cannot
     quietly widen it. */
  const barterMenu = RECIPES.filter((r) => Object.keys(r.needs).every((id) => !!_BARTER_BY_ING[id]));
  if (!barterMenu.length) {
    bad.push('🔴 THE BARTER COUNTER REACHES NO DISH: rung four stocks '
      + _BARTER_LINES.map((x) => x.out.ing).join(', ') + ' and no recipe can be built from those '
      + 'alone — a player at ◈0 with an empty stash has a counter that sells them nothing they '
      + 'can cook, which is the round-6 defect with a fourth rung bolted on');
  } else if (!barterMenu.some((r) => (r.minLevel || 1) === 1)) {
    bad.push('🔴 THE BARTER COUNTER REACHES NOTHING ON DAY ONE: it builds '
      + barterMenu.map((r) => r.id).join(', ') + ', none of them level 1');
  }
  if (barterMenu.length > ECON.BARTER_MENU_MAX) {
    bad.push('🔴 THE BARTER FLOOR IS THE KITCHEN: rung four can build ' + barterMenu.length
      + ' dishes (' + barterMenu.map((r) => r.id).join(', ') + ') against a ceiling of '
      + ECON.BARTER_MENU_MAX + ' — a counter that takes no Cinder and runs a menu is a kitchen '
      + 'that needs no city');
  }

  /* ── 🔴 F — THE RELIEF LOOP MUST LOSE MONEY. ──────────────────────────────
     Rung three is the only door in the feature that takes Cinder alone, and it
     is safe ONLY because what it hands back is live resources at a punitive
     rate. If the closed loop — buy a parcel, cook the dish, sell the dish —
     ever comes out ahead, the kitchen is round 4's Cinder machine again with
     one extra hop and a better comment.
     The bar is the BEST pay multipliers the game can produce, not the typical
     ones: max popularity (POP_PAY_FLOOR + POP_PAY_SPAN), a perfect pull
     (Q_PERFECT), the busiest hour (RUSH_PAY_MAX) and a full tip (TIP_MAX_PCT).
     A player who can hold all four at once is playing perfectly, and perfect
     play must not unlock a money press — it should unlock a good restaurant. */
  const bestMult = (ECON.POP_PAY_FLOOR + ECON.POP_PAY_SPAN) * ECON.Q_PERFECT
                 * (ECON.RUSH_PAY_MAX || 1) * (1 + (ECON.TIP_MAX_PCT || 0));
  if (!RELIEF.length) {
    bad.push('🔴 NO RELIEF RUNG: there is no Cinder→ledger parcel, so a player whose 14-id ledger '
      + 'is empty has no way to buy back in and every scrap-dealer crate refuses them');
  }
  for (const r of RECIPES) for (const parcel of RELIEF) {
    /* ⚠ EVERY PARCEL, NOT JUST THE CHEAPEST PER UNIT. Two parcels can carry the
       same Cinder-per-unit and different RATIOS, and a dish is priced by the
       parcel whose ratio best matches its needs, not by the one with the
       prettiest headline rate. Checking only `_bestParcel()` would pass a table
       whose second row was the hole. */
    /* 🔴 The free step is exempt HERE and bounded BELOW. Its cost is zero by
       design, so this check would report every dish as a printer and say
       nothing useful; what actually holds it is the dry gate, the once-a-day
       cap and RELIEF_FREE_DAILY_CINDER_MAX. Two different bounds for two
       different rungs — do not merge them, and do not delete either. */
    if (parcel.free) continue;
    const loop = reliefRouteCost(r.id, parcel.id);
    if (!loop) continue;                       // this parcel cannot supply this dish
    const best = r.basePrice * bestMult;
    /* ⚠ THE BAR IS A MARGIN, NOT A SIGN. `loop.cinder > best` is the point the
       printer actually opens; at RELIEF_MARKUP 12 the tightest dish cleared it
       by 7%, which is inside the noise of any ordinary price edit. See
       ECON.RELIEF_LOOP_MIN_MARGIN. */
    const bar = best * (ECON.RELIEF_LOOP_MIN_MARGIN || 1);
    if (!(loop.cinder > bar)) {
      bad.push('🔴 THE RELIEF LOOP IS ' + (loop.cinder > best ? 'TOO CLOSE TO A PRINTER' : 'A PRINTER')
        + ': ' + r.id + ' costs ' + loop.cinder
        + ' Cinder end to end out of a ' + loop.parcelId + ' (' + loop.parcels + ' parcels, bound by '
        + loop.binding + ') against a best-case payout of ' + Math.round(best * 10) / 10
        + ' × a required margin of ' + (ECON.RELIEF_LOOP_MIN_MARGIN || 1) + ' = ' + Math.round(bar * 10) / 10
        + ' — Cinder in, more Cinder out, with no city, no business and no battle involved');
    }
  }
  /* And the other direction: the relief rung must never be a sensible way to
     BUY resources for the rest of the game. It is priced off the game's own
     cold-storage board precisely so this comparison is meaningful. */
  for (const p of RELIEF) {
    if (p.free) continue;                      // priced at zero on purpose; bounded below
    if (!(p.cost.cinder > p.retailCinder * 2)) {
      bad.push('🔴 THE RELIEF RUNG IS A SHOP: ' + p.id + ' sells ' + p.retailCinder
        + ' Cinder of resources for ' + p.cost.cinder + ' — at less than 2× the board price this '
        + 'stops being an emergency and starts being an arbitrage door into the whole economy');
    }
  }
  /* ── 🔴 THE FREE STEP: GATED, CAPPED, AND SMALL ENOUGH TO MEASURE. ────────
     A free parcel is the only thing that makes "a player with an empty ledger
     can ALWAYS get back to cooking" literally true rather than true-if-they-
     still-have-a-wallet. It is also, unguarded, a Cinder faucet in a game that
     has spent commits deleting Cinder faucets. All three guards are structural
     and all three are checked here, because any one of them going missing turns
     a floor back into a press. */
  for (const p of RELIEF) {
    if (!p.free) continue;
    if (!p.whenDry) {
      bad.push('🔴 A FREE PARCEL THAT IS NOT DRY-GATED: ' + p.id + ' has no `whenDry`, so a kitchen '
        + 'with a full pantry can collect it — that is a faucet, not a relief drop');
    }
    if (!((p.perDay | 0) >= 1)) {
      bad.push('🔴 A FREE PARCEL WITH NO RATE LIMIT: ' + p.id + ' has no `perDay`, so it is '
        + 'collectable as fast as the player can tap');
    }
    /* Price the day's yield at the best the game can pay, by the best dish the
       parcel can actually build. `cheapestRoute(id, payableIn)` is what makes
       this honest — the dish has to be buildable out of THIS parcel's ids. */
    let worstCase = 0, worstDish = null;
    for (const r of RECIPES) {
      const route = cheapestRoute(r.id, Object.keys(p.out));
      if (!route.ok) continue;
      let parcels = 0;
      for (const id in route.res) {
        const per = p.out[id] || 0;
        if (per <= 0) { parcels = Infinity; break; }
        parcels = Math.max(parcels, route.res[id] / per);
      }
      if (!parcels || !Number.isFinite(parcels)) continue;
      const dishes = 1 / parcels;                       // dishes one parcel makes
      const yieldC = dishes * (r.basePrice * bestMult - route.cinder) * (p.perDay || 1);
      if (yieldC > worstCase) { worstCase = yieldC; worstDish = r.id; }
    }
    if (worstCase > ECON.RELIEF_FREE_DAILY_CINDER_MAX) {
      bad.push('🔴 THE FREE DROP IS A FAUCET: ' + p.id + ' is worth up to '
        + Math.round(worstCase) + ' Cinder a day (via ' + worstDish + ' at the best multipliers) '
        + 'against a ceiling of ' + ECON.RELIEF_FREE_DAILY_CINDER_MAX
        + ' — shrink the parcel, do not raise the ceiling');
    }
  }
  /* And the floor under the floor: SOMETHING has to be free, or a player at
     zero Cinder and zero of all fourteen resources is refused with no way out,
     which is the exact failure rounds 1, 2 and 3 shipped. */
  if (RELIEF.length && !RELIEF.some((p) => p.free)) {
    bad.push('🔴 NO FREE STEP: every relief parcel costs Cinder, so a player at zero Cinder and an '
      + 'empty ledger has no way back to cooking at all — the paid parcels LOSE money by design, '
      + 'so that state is reachable by simply playing');
  }
  /* The grubstake and the floor have to be the same kitchen: every ingredient
     the grant hands out that the dealer does NOT stock is one the player can
     only replace out of the live ledger. That is intentional — it is what makes
     the speciality tier need a supply chain — but if it ever became ALL of
     them, the floor would exist on paper and be unreachable in play. */
  const grantedOnly = Object.keys(ECON.START_PANTRY).filter((id) => !_SALVAGE_BY_ING[id]);
  if (grantedOnly.length >= Object.keys(ECON.START_PANTRY).length) {
    bad.push('🔴 THE FLOOR IS UNREACHABLE FROM THE GRUBSTAKE: the scrap dealer stocks none of the '
      + 'ingredients a new kitchen opens with');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     🔴🔴 THE FAILURE LADDER. EVERY WAY OF LOSING CUSTOM, IN ORDER, AND THE
        ONE PAIR THAT HAS A DESIGN RULE HANGING OFF IT.
     ══════════════════════════════════════════════════════════════════════════
     WHY THIS CHECK EXISTS AND WHY IT IS NOT PARANOIA: for one whole round the
     drive-thru's only decision was strictly the WORSE choice. POP_WAVE was
     −1.1 and POP_LOST was −1.0, so waving a car off cost 10% MORE than letting
     it time out — while drivethru.js and kitchen.render.js BOTH told the player
     in the imperative to "wave early, eat a smaller hit", and the control sat
     behind a confirm dialog. Nothing caught it, because nothing was looking:
     the inversion arrived through a blanket re-scale that applied 0.55 to the
     auxiliary penalties and 0.286 to POP_LOST, and the comment describing that
     re-scale asserted the ratios were "preserved exactly".
     A ratio a comment argues from is a ratio a test can hold. So this holds it.
     The order is a design statement, not an accident of tuning: the further a
     customer got before you lost them, the more it costs.
     ⚠ These are MAGNITUDES. Every entry must be negative in ECON; the check
       compares |value| so a sign flip is caught as a separate failure. */
  const LADDER = [
    ['POP_BALK', 'drove past a full lane'],
    ['POP_JUMP', 'you let somebody cut the queue'],
    ['POP_TURNAWAY', 'walked in, saw the board, walked out'],
    ['POP_JAM', 'queued, never got to order, gave up'],
    ['POP_WAVE', 'YOU waved off somebody who had ordered'],
    ['POP_BURN', 'you ruined food'],
    ['POP_LOST', 'you took the order and never delivered it'],
  ];
  for (const [key] of LADDER) {
    const v = ECON[key];
    if (!(typeof v === 'number' && Number.isFinite(v))) { bad.push('ECON.' + key + ' is not a finite number'); continue; }
    if (!(v < 0)) bad.push('ECON.' + key + ' must be NEGATIVE — every rung of the failure ladder is a cost (got ' + v + ')');
  }
  for (let i = 1; i < LADDER.length; i++) {
    const [a, aw] = LADDER[i - 1], [b2, bw] = LADDER[i];
    const va = Math.abs(ECON[a]), vb = Math.abs(ECON[b2]);
    if (!(va < vb)) {
      bad.push('🔴 THE FAILURE LADDER IS OUT OF ORDER: ' + a + ' (' + ECON[a] + ', ' + aw
        + ') must cost STRICTLY LESS than ' + b2 + ' (' + ECON[b2] + ', ' + bw + '). '
        + (a === 'POP_WAVE' || b2 === 'POP_WAVE'
            ? 'The wave-off is the lane\'s only decision and two files tell the player it is the '
              + 'cheaper one — if it is not, the game is arguing the player into a trap. '
            : '')
        + 'Fix the number, not this check.');
    }
  }

  /* 🔴 THE REPORT CARD'S CUTS MUST BE A SCALE. Four cuts, strictly ascending,
     inside (0,1] — gradeParts().score is a 0..1 blend, so a cut at 1.4 makes a
     letter unreachable and a cut at 0 makes it universal. This CANNOT check
     that the cuts still match the measured score distribution (nothing pure
     can); see ECON.GRADE_MIN_C for how to re-sweep them. What it does catch is
     the failure that actually shipped: a key declared here as a placeholder
     zero, silently overriding kitchen.state.js's live fallback and grading
     every shift an S. */
  const CUTS = ['GRADE_MIN_C', 'GRADE_MIN_B', 'GRADE_MIN_A', 'GRADE_MIN_S'];
  for (const k of CUTS) {
    const v = ECON[k];
    if (!(typeof v === 'number' && v > 0 && v <= 1)) {
      bad.push('ECON.' + k + ' must be a number in (0,1] — the grade score is a 0..1 blend (got ' + v + ')');
    }
  }
  for (let i = 1; i < CUTS.length; i++) {
    if (!(ECON[CUTS[i - 1]] < ECON[CUTS[i]])) {
      bad.push('ECON: the grade cuts must ascend — ' + CUTS[i - 1] + ' (' + ECON[CUTS[i - 1]]
        + ') is not below ' + CUTS[i] + ' (' + ECON[CUTS[i]] + '), so one letter can never be awarded');
    }
  }
  if (!(ECON.GRADE_CAP_DUTY > 0 && ECON.GRADE_CAP_DUTY <= 1)) {
    bad.push('ECON.GRADE_CAP_DUTY must be in (0,1] — it derates capacityModel()\'s rack to what two '
      + 'thumbs sustain, and at 0 the service axis divides by zero and grades nothing');
  }
  if (!(ECON.GRADE_MIN_SHIFT_MS >= 0)) bad.push('ECON.GRADE_MIN_SHIFT_MS must be >= 0');

  /* 🔴 AND THE GENERAL FORM OF THAT WHOLE CLASS: no key in ECON may be
     undefined or NaN. kitchen.state.js reads every price as `EC(key, fallback)`
     and DATA WINS — so a key that exists with a broken value is strictly more
     dangerous than a key that does not exist at all, because the fallback that
     was keeping the game playable is now unreachable. Cheap, total, and it
     catches a trailing comma edit that leaves a key holding `undefined`. */
  for (const k in ECON) {
    const v = ECON[k];
    if (v === undefined) { bad.push('ECON.' + k + ' is undefined — it overrides a live fallback with nothing'); continue; }
    if (typeof v === 'number' && !Number.isFinite(v)) bad.push('ECON.' + k + ' is not finite (' + v + ')');
  }

  /* 🔴🔴 THE ESCAPE HATCH MUST ACTUALLY ESCAPE — AND THE OLD VERSION OF THIS
        CHECK CERTIFIED A KITCHEN THAT COULD NOT COOK FOR FOURTEEN DAYS.
     ══════════════════════════════════════════════════════════════════════════
     The free parcel exists so a player with an empty 14-id ledger can always
     get back to COOKING — not back to HOLDING RESOURCES. Those are different
     sentences and only one of them is the requirement. A drop of `{water:9}`
     would satisfy every guard above this one: dry-gated, rate limited, worth
     nothing, and completely useless.

     🔴 SO WOULD `{food:7, water:4}`, WHICH IS WHAT SHIPPED, AND THIS CHECK
        PASSED IT. The old version priced the crate set in whole crates (right,
        and hard-won — see the ⚠ below) and then compared only the LIVE legs
        against the parcel, because `for (const k in best.cost) if (k ===
        'cinder') continue;`. Cinder was excluded by construction. Every crate
        on the sheet had a Cinder leg, so the check was asking "could this
        parcel buy the set if the money were free", the answer was yes, and the
        answer to the question a stranded player actually asks was no. MEASURED
        at HEAD 9d41440 (r9/dry12.mjs, ◈0, fourteen days): 112 food, 64 water,
        `affordable: []` every morning, `cookable: []` every morning,
        `buySupply('sal_mustard',1)` → "Not enough Cinder — you need 20 and have
        0." The parcel landed every day into a kitchen that could never spend it.
     🔴 AND THE FILE KNEW. The note that used to sit here read: "THE TOLL IS
        REAL AND IS NOT CHECKED HERE, BECAUSE IT CANNOT BE… it is a REAL hole
        and it is written down here rather than implied." A hole you have
        written down is still a hole, and a check with a note explaining what it
        does not check is a check that will be read as passing. The hole is
        closed at the data (§🤝, the barter counter) and the note is now this
        check: the crate set must be payable OUT OF THE PARCEL ALONE — zero
        Cinder, and no live id the parcel does not carry.

     ⚠ AND IT IS ASKED IN WHOLE CRATES, WHICH IS THE ONLY UNIT THE SHOP SELLS
       IN. This half was written on `cheapestRoute()`, which amortises a crate
       across the dishes it eventually makes — and on that model a 5-food parcel
       "buys 1.9 Margheritas" and the guard passes, while in the shop a
       Margherita's crate set costs 10 food IN ONE GO and 5 food bought nothing
       at all on any day. The faucet guard above KEEPS the amortised model on
       purpose — "what is a drop worth per day if you keep taking them" really
       is a long-run question and surplus really does carry over — but "can the
       drop put a plate on the pass" is a question about whole crates. Two
       questions, two models, and the difference between them is the bug.

     ⚠ IT IS ASKED IN DAYS, NOT IN ONE DAY, AND THAT IS THE OTHER HALF OF THE
       BALANCE. Surplus carries over, so a set costing more than one parcel is
       still an escape — just a slower one. Demanding one day would force the
       parcel up until it was a shift's worth of stock, which is precisely the
       faucet RELIEF_FREE_DAILY_CINDER_MAX exists to prevent. The two ceilings
       squeeze from opposite sides; that is the design.
       See ECON.RELIEF_RESCUE_DAYS_MAX. */
  for (const p of RELIEF) {
    if (!p.free) continue;
    const per = p.out || {}, perDay = Math.max(1, p.perDay | 0);
    const payable = (row) => {
      for (const k in (row.cost || {})) if (!((per[k] || 0) > 0)) return false;
      return true;    // `cinder` is not a key on any parcel, so it fails here.
    };
    let reached = null;
    for (const r of RECIPES) {
      if ((r.minLevel || 1) !== 1) continue;
      const need = Object.create(null);
      let ok = true;
      for (const ing in r.needs) {
        /* Per ingredient, the whole-crate purchase that takes the FEWEST DAYS
           of drops — that is the route a stranded player walks, and it is the
           parcel's binding resource that decides it, not the food leg alone. */
        let best = null, bestDays = Infinity;
        for (const row of [_SUPPLY_BY_ING[ing], _SALVAGE_BY_ING[ing], _BARTER_BY_ING[ing]]) {
          if (!row || !payable(row)) continue;
          const batches = Math.ceil(r.needs[ing] / Math.max(1, row.out.qty));
          let d = 0;
          for (const k in row.cost) d = Math.max(d, (row.cost[k] * batches) / (per[k] * perDay));
          if (d < bestDays) { bestDays = d; best = { row, batches }; }
        }
        if (!best) { ok = false; break; }
        for (const k in best.row.cost) {
          need[k] = (need[k] || 0) + best.row.cost[k] * best.batches;
        }
      }
      if (!ok) continue;
      let days = 0;
      for (const k in need) days = Math.max(days, need[k] / (per[k] * perDay));
      days = Math.ceil(days);
      if (!reached || days < reached.days) reached = { id: r.id, days, need };
    }
    const cap = ECON.RELIEF_RESCUE_DAYS_MAX;
    if (!reached) {
      const sets = RECIPES.filter((r) => (r.minLevel || 1) === 1).map((r) => r.id).join(', ');
      bad.push('🔴 THE FREE DROP REACHES NO DISH A BROKE PLAYER CAN BUY: ' + p.id + ' carries '
        + JSON.stringify(p.out) + ' a day and NOT ONE complete crate set for a level-1 recipe ('
        + sets + ') can be paid for out of it — every route wants Cinder, or a live id the parcel '
        + 'does not carry. MEASURED when this was last true: fourteen days of drops, 112 food, '
        + '64 water, zero crates affordable, zero dishes cooked, popularity 50 → 41.6, and the '
        + 'kitchen silently shut. Add a rung the parcel can pay for (see §🤝) — do NOT put Cinder '
        + 'in the parcel, which is the round-4 Cinder machine with a new label');
    } else if (reached.days > cap) {
      bad.push('🔴 THE FREE DROP TAKES TOO LONG TO REACH A DISH: the cheapest complete crate set '
        + p.id + ' can pay for is ' + reached.id + ' at ' + JSON.stringify(reached.need)
        + ' = ' + reached.days + ' days of drops, against a ceiling of ' + cap
        + '. A player who has to wait a week to cook one dish has been dead-ended with extra '
        + 'steps. Cheapen the barter rung or grow the parcel — and move '
        + 'ECON.RELIEF_FREE_DAILY_CINDER_MAX with it if you grow the parcel');
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
  /* 🪂 RUNG THREE. Kept in this bag so kitchen.state.js reaches it the same way
     it reaches everything else (`DATA.RELIEF`) rather than importing a second
     symbol — and so a renderer listing the restock counter can draw the parcels
     under the crates without a special-case import. It is NOT inside
     SUPPLY_RECIPES on purpose: see the RELIEF block. */
  RELIEF,
};
