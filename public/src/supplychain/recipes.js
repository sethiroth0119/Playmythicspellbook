/* ════════════════════════════════════════════════════════════════════════════
   SUPPLY CHAIN · recipes.js — what each business MAKES and BUYS.

   The owner's PDF fixes only business-to-business edges ("the icons next to the
   business types needs the other business"). It names no resource anywhere. This
   file answers the one question the PDF leaves open: WHICH product rides each
   edge, and why that makes sense to a player reading the map.

   WHY this is a hand-written table and not derived from OPS_ECON:
   the shipped operations consume only six resource ids between them, so a
   derived table would draw almost every PDF edge with an empty truck. The owner
   asked for the opposite ("make it where all of the resources each company
   needs make sense"), so the cargo is authored here — and every row says
   whether the game does it TODAY (`live: true`, with a cite) or whether it is
   the owner's map speaking (`live: false`, with a why). The UI shows the
   difference; claiming a proposed lane is enforced today is a FAIL by contract.

   WHY there is not one quantity, rate or price in this file:
   CLAUDE.md — all operation numbers go through _opEcon(). How MUCH of anything
   moves is read live over the bridge by the views; proposal.js turns these rows
   into an {inputs,yields} overlay whose amounts come from tuning.js tiers. This
   file says WHAT and WHY only. Cites name the SYMBOL, not a line: index.html is
   being edited by other sessions and a line number would be stale by tonight.

   Pure: no window, no DOM, no imports. Node can import() it. Sibling data
   (businesses.js, the id catalogue, the OPS_ECON fixture) arrives as PARAMETERS
   to validateRecipes() — a same-wave sibling is never imported.

   Three kinds of "live" for a product, because they are NOT the same promise:
     via 'opsYield' — OPS_ECON yields it; collecting the op puts it in your stash.
     via 'minigame' — the business's own sub-screen puts it in your stash.
     via 'cityFirm' — OP_ECO_MAP: the op sited as a city tile founds a simulated
                      firm that makes it INSIDE the closed city economy. True in
                      the shipped game, but it never reaches a player's stash
                      (CLAUDE.md: never addRes() a chain resource). A buys[] row
                      therefore does NOT count a cityFirm product as live cargo.

   WHY there is an upkeep[] beside buys[] (round two):
   buys[] is EXACTLY the PDF's lane set — the validator rejects a lane the owner
   did not draw. But the shipped ops burn things the PDF never drew a lane for
   (Research burns metal and fuel; the map gives it no Mining or Gas icon). With
   only buys[] a modal would tell a player "Research needs dna and medicine" —
   both proposed — and hide what it costs to run TODAY. So every live input that
   is not a PDF lane lives in upkeep[], tagged live with a cite, and the
   validator fails if any OPS_ECON input is in neither place. A view must show
   both: upkeep is what you pay now, buys is the map.
   ════════════════════════════════════════════════════════════════════════════ */

/* ⚠ ROUND SEVEN — EVIDENCE IS NOT PROSE, AND graph.js CANNOT TELL THEM APART.
   graph.js resolves a product's on-screen note as `cite || why`, so whatever a
   makes row puts in `cite` IS the sentence a player reads. For six rounds that
   field held the thing an AUDITOR needs — "OPS_ECON (public/index.html), read
   through _opEcon() mining.yields" — on 74 rows of this file (204 across the
   graph once the city system's own rows are counted). Round six hid it by
   converting mining and agri by hand and leaving the rest, and the measurement
   that made it look safe was "modal.js only paints a note on planned rows
   today" — a sibling view declining to render a field. One edit there, or one
   admin-mode screenshot, and 74 repo paths land on screen.
   So the two are now SEPARATE FIELDS and only one of them can ever be rendered:
     evidence — the symbol an auditor greps for. No view reads it; validateRecipes
                does, and the OP_ECO_MAP / OPS_ECON cross-checks below verify it
                harder than a typed string anybody re-reads.
     why      — the sentence, in words a player already knows, or null when the
                row's `via` already says everything there is to say (an opsYield
                row's rate line reads "26.4 an hour at full crew · from the
                hourly operation"; a second sentence repeating that is noise).
   `cite` stays on the row, permanently null, because it is the field graph.js
   looks at first: leaving it named and empty is what makes the swallow
   impossible rather than merely absent. validateRecipes() rejects any makes row
   that sets it, and rejects any note that still looks like a path or a symbol. */
/* What a player must never be shown. Deliberately the same shapes modal.js
   scrubs (paths, file names, SHOUTING_SYMBOLS, _privates) plus the one its
   scrubber and the ore gate both missed: a dotted member path such as
   `transport.inputs.fuel`, which survived every check because it has no
   underscore and no capital, and reached 23 tooltips. Two dots minimum, so an
   ordinary "e.g." in a sentence is not a false positive. */
const JARGON = /(?:[\w.-]*(?:\/[\w.-]+)+\.(?:js|mjs|cjs|html|sql|json|ts)|[\w-]+\.(?:js|mjs|cjs|html|sql|json)|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|(?<![\w$])_[A-Za-z][A-Za-z0-9_]*|\b[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*){2,}\b)/;

const live = (id, via, evidence, why) => Object.freeze({ id, live: true, via, evidence, cite: null, why: why || null });
const want = (id, why) => Object.freeze({ id, live: false, via: 'proposed', evidence: null, cite: null, why });

/* PROMOTE — a cityFirm product the owner's map also asks a PLAYER to be able to dig
   or grow. The problem it was invented for (round three) is real: a cityFirm product
   never leaves the closed city sim, so a lane whose WHOLE cargo is cityFirm-only on
   the supplier is a lane no player can ever run — the modal would read "Agricultural
   Op. ships soybeans and corn to the Genetics Lab" for a shipment that cannot happen,
   and the proposal overlay would hand the Gene Lab two required inputs no
   player-facing producer can supply, the exact failure MEMORY.md records ("a new shop
   with no LOCAL producer for every input earns zero forever and still looks healthy").
   Rejected then and still rejected: dropping the 'cityFirm' via (it is true today and
   the OP_ECO_MAP cross-check reads it), and changing the cargo ids (they are the ids
   coverage.js already lists as that buyer's needs; swapping them would split the two
   files). Also rejected: a SECOND makes[] row beside the live one — round four's
   screenshot showed Copper Ore printed twice on one screen, LIVE and PLANNED.

   ⚠ ROUND FIVE — THE PROMOTION IS NOT A DIFFERENT KIND OF PRODUCT.
   Round four kept one row per id but made the promoted one `live: false`, so six rows
   that are the SAME THING in the game — every id in OP_ECO_MAP mining.out — printed
   in two different colours three cells apart: "Nickel Ore LIVE · a city firm's
   product, it never reaches your stash", "Coal LIVE · …", then "Copper Ore PLANNED ·
   rate not set — not in the game yet". Nothing in the shipped game distinguishes
   them; the only thing that differed was whether a lane on the owner's PDF happened
   to want that id. Worse, the same Mining card then printed "Weapon Smith — Metal,
   Copper Ore LIVE" under who buys it, so the card contradicted itself, on the tile
   whose own blurb says "Best for a first business". Agri did the same with
   corn/soybeans against wheat/rice/potatoes/vegetables.
   So the LIVE/PLANNED badge is now decided by the GAME (is this id made today, and
   how), never by the map, and the promotion rides as a flag on the live row:
     via 'cityFirm' + live: true — identical to every other OP_ECO_MAP row, so the six
       ores and the six crops read the same as each other and the badge tells the
       truth: the city sim really does make it, and it really never reaches a stash
       (the modal's cityFirm sentence says exactly that, and says it for all six).
     promotes: 'cityFirm' — this is the id the map needs a player's own pit or farm to
       be able to bag. laneLiveIds() below reads it, which is what keeps the Gene Lab
       lanes from being reported as unrunnable.
     why — player prose, and no `cite`: graph.js does `note: m.cite || m.why`, so a row
       that sets both loses its prose and prints a repo path at the player instead.
       The OP_ECO_MAP claim is not lost; the via IS the claim and the validator below
       still cross-checks it against the ecoMap.
   KNOWN COST, and it is a data change, not a bug: proposal.js pass 1 skips live makes
   rows ("if (!m || m.live) continue"), so the promoted ids are no longer paid out as
   overlay yields. `promotes` is the hook for the one-line change there
   (`m.live && m.promotes !== 'cityFirm'`) that restores it; until that lands, the
   overlay drops the lanes rather than inventing a supplier, which is the honest
   failure. Logged in sc/decisions/ore-parity.md. */
const cityPromote = (id, why) => Object.freeze({ id, live: true, via: 'cityFirm', promotes: 'cityFirm', evidence: ECO, cite: null, why });

/* ⚠ ROUND SIX — THE PARITY MUST NOT DEPEND ON modal.js LOOKING AWAY.
   Rounds five's six ores read alike on screen, but only because modal.js happens to
   paint a product's note on PLANNED rows only. In the data they still did not match:
   four carried `cite: OP_ECO_MAP (public/node-city/index.html) …` and two carried
   prose, and graph.js resolves the note as `cite || why`. The day that view paints a
   live row's note — or the day someone screenshots admin mode — the Mining card goes
   back to printing four rows with a repo path and two with a sentence. A parity check
   that survives only while a sibling module declines to render a field is one edit
   away from passing a regression silently, so the field is made uniform HERE.
   cityMake() is cityPromote() without the map's promotion: the same live row, the
   same via, and player prose instead of a cite. A cityFirm row never needed a typed
   cite — its evidence is the `via`, which validateRecipes() checks against the real
   OP_ECO_MAP, far harder than a string nobody re-reads. The rule the validator now
   enforces is per TILE: every cityFirm row on one tile carries its evidence the same
   way, so no card can ever print two of the same kind of thing two ways again. */
const cityMake = (id, why, evidence) => Object.freeze({ id, live: true, via: 'cityFirm', evidence: evidence || ECO, cite: null, why });

/* One buys[] row. `liveIds` is the honest subset: ids the supplier really puts in
   a player's stash today AND this business really consumes today. A row is live
   only when that subset is non-empty — never because the lane "sounds" real.
   `consumerCite` records a half-live lane (the consumer exists, the producer does
   not) — the fashion-to-medical example is exactly that and the modal says so. */
const lane = (from, ids, why, o) => {
  const x = o || {};
  const liveIds = x.liveIds || [];
  return Object.freeze({
    from, ids: Object.freeze(ids.slice()), why,
    live: Boolean(liveIds.length),
    liveIds: Object.freeze(liveIds.slice()),
    cite: x.cite || null,
    consumerCite: x.consumerCite || null,
    pdf: x.pdf || 'needs-supplier',
    confidence: x.confidence || 'sure',
    /* HOW the lane is live: 'opsInput' = the operation burns it on every collect;
       'minigame' = only when the player runs that recipe in the sub-screen. The UI
       must not imply the op itself consumes a minigame input. */
    liveVia: liveIds.length ? (x.liveVia || 'opsInput') : null,
    /* The ids stand in for vehicle ITEMS (rigs, built cars, hulks), which are not
       resources today. Always proposed; owner decision pending. */
    cargoIsItem: Boolean(x.cargoIsItem),
    /* Tiles that already put this cargo in a player stash although the map's
       supplier does not (yet). */
    sourceToday: Object.freeze((x.sourceToday || []).slice()),
  });
};

/* One upkeep[] row: something the business really consumes today that is NOT a
   PDF lane. via 'opsInput' = the operation's own OPS_ECON inputs (every collect
   burns it); via 'minigame' = the business's sub-screen consumes it only when the
   player runs that recipe. madeBy is filled in after RECIPES is built (the
   businesses that put this id in a player stash today) so it can never drift
   from makes[]. Rejected: writing madeBy by hand — it would have been wrong the
   moment feed.makes grew. */
const burn = (id, via, cite, note) => ({ id, live: true, via, cite, note: note || null, madeBy: [] });

const OPS = 'OPS_ECON (public/index.html), read through _opEcon()';
const ECO = 'OP_ECO_MAP (public/node-city/index.html) — simulated city firm, never a player stash';
const FARM = 'FARM_ECON (public/src/farm/index.js)';
const YARD = 'STASH_IDS (public/src/refinery/state.js) — The Cracking Yard drums product into the real ledger';
const PHARMA = 'PHARMA lines (public/src/hospital/pharma.js) — a Hospital sub-screen recipe, gated on owning a Medical Corporation; NOT an OPS_ECON input';
const BENCH = 'Weapon Smith bench (public/src/weaponsmith/blueprints.js) — billet and step costs, NOT an OPS_ECON input';
const M = 'ch:market', CM = 'ch:carmarket';
const BATTLE = 'sys:battle', BIZ = 'sys:business', CITY = 'sys:city', CAMP = 'sys:camp';

export const RECIPES = Object.freeze({

  /* ───────────────────────── p6 ───────────────────────── */
  mining: {
    makes: [
      live('metal', 'opsYield', OPS + ' mining.yields'),
      /* All six read alike in the data as well as on the screen — see cityMake(). */
      cityMake('ironOre', 'Feedstock for the city\'s foundries: the iron half of every beam, rail and girder it lays.'),
      cityMake('aluminumOre', 'The light-metal half of the city\'s smelter feed. Refined aluminium — what a Car Factory actually casts blocks from — is a different thing, and nobody makes it yet.'),
      cityMake('nickelOre', 'Alloy and plating metal. The city\'s works buy it; nothing a player owns consumes it today.'),
      cityMake('coal', 'Furnace and power fuel, burnt about where it is dug — which is the clearest reason none of it ever lands in a stash.'),
      cityPromote('copperOre', 'A city\'s mine already digs copper; the owner\'s map asks a player\'s pit to bag concentrate too, so the Genetics Lab lane has something it can actually be sent.'),
      cityPromote('zincOre', 'Same lane, same reason: the map runs zinc from the pit to the lab, so a player\'s mine has to be able to put it on a truck.'),
      want('stone', 'Every pit moves overburden; the Construction Company on the map needs something to pour foundations with, and stone is already battle loot with no business behind it.'),
      /* The furnace recipe lives in the foundry's own recipe table. The WHY belongs in
         this comment; the row's `why` is the sentence a player reads on the card, so
         it must not carry a repo path (graph.js prints it as the note verbatim). */
      want('limestone', 'The Trash Crusher\'s blast furnace already burns limestone as flux, and the only way to get any today is to buy it from a trader\'s contract.'),
      /* An engine block is cast from refined aluminium, not from ore, and the ore id
         is city-sim-only. Mines that ship light metal run their own smelter. */
      want('aluminum', 'The Car Factory\'s engine blocks and the city\'s light-metal trade both want refined aluminium; the only aluminium on the map today is aluminumOre inside the city sim, which no player can hold.'),
    ],
    buys: [],                       // PDF: root producer — Transport + Marketplace only.
    sellsTo: [M, CITY],
    service: null,
  },

  oil: {
    makes: [
      live('fuel', 'opsYield', OPS + ' oil.yields'),
      /* Every id in the Cracking Yard's STASH_IDS, not a sample of them: the owner
         wants every resource to have a producer, and all of these already do. */
      live('naphtha', 'minigame', YARD), live('kerosene', 'minigame', YARD), live('diesel', 'minigame', YARD),
      live('gasOil', 'minigame', YARD), live('heavyOil', 'minigame', YARD), live('slop', 'minigame', YARD),
      live('reformate', 'minigame', YARD), live('alkylate', 'minigame', YARD), live('catGasoline', 'minigame', YARD),
      live('butane', 'minigame', YARD), live('ethanol', 'minigame', YARD),
      live('hydrotreatedCut', 'minigame', YARD), live('reprocessedSlop', 'minigame', YARD),
      cityMake('crudeOil', 'The raw barrel every other cut is taken from. The city’s own wells pump it and the city’s own refineries drink it.'),
      cityMake('naturalGas', 'Wellhead gas, piped straight to the plants that heat and light the city.'),
      want('petrochemicals', 'Cracker off-take. The Car Factory on the map needs Oil for something that is not fuel (Gas Station already covers fuel): plastics feedstock, paint base, sealant.'),
      want('rubber', 'Synthetic rubber is an oil product; tyres, hoses and seals are the honest reason a car plant needs an oil company.'),
      want('fertilizer', 'Nitrogen fertiliser is made from natural gas. This is the sensible reading of the PDF\'s "Agricultural Op. needs Oil Company" icon. The only fertiliser made today is manure from the Homestead Farm.'),
      want('asphalt', 'Bottom of the barrel; the City Builder lays roads with it.'),
    ],
    buys: [
      lane('mining', ['metal'], 'Derricks, drill string and pipeline are steel that wears out. No metal, no new wells.'),
    ],
    sellsTo: [M, CM, CITY],
    service: null,
    /* gunOil is YIELDED by this op today but has no row in any catalogue (phantom id,
       contract rule four). It is listed in PHANTOMS below and never offered as cargo. */
  },

  gas: {
    makes: [
      live('fuel', 'opsYield', OPS + ' gas.yields'),
      cityMake('gasoline', 'Pump petrol for the city’s own traffic. Not the same thing as the bulk fuel you collect — that one really does reach your stash.'),
      want('diesel', 'A forecourt sells both pumps. The station does not make diesel: it buys the drums the Oil Company\'s Cracking Yard already fills and retails them to the trucks and trawlers that burn it.'),
    ],
    buys: [
      /* Round two shipped crudeOil on this lane with the why "crude to refine" and a
         blind reader called it odd — correctly: a forecourt refines nothing. The
         cargo is the finished cuts the Cracking Yard already fills drums with. */
      lane('oil', ['naphtha', 'diesel', 'fuel'], 'A forecourt refines nothing: it retails what the Oil Company has already cracked — naphtha blended into pump gasoline, diesel for the truck lane, bulk fuel for the tanks. Today the station makes fuel out of nothing at all.'),
    ],
    sellsTo: [M, CM, CITY],
    service: null,
  },

  cars: {
    makes: [
      cityMake('cars', 'Finished cars, sold off the city’s own forecourts. A car you can actually own comes off the Car Factory line instead.', ECO + ' (carDealer)'),
      live('metal', 'opsYield', OPS + ' cars.yields — trade-in scrap'),
      /* The salvage lane below carried only `cars`, which is a vehicle ITEM: no
         resource a player can hold ever moved down it. A lot cuts up what it cannot
         sell, and the loose scrap rides to the yard with the hulk. */
      want('scrapMetal', 'A write-off or a trade-in that will not move is cut up on the lot; the loose scrap leaves with the hulk. It is battle loot today with no business behind it.'),
      want('trucks', 'Transport\'s rigs already come off this business\'s floor (Prince Portfolios) as vehicle items; the map draws Transport needing the Car Dealer, so the dealer is where a haulier buys trucks.'),
    ],
    buys: [
      lane('gas', ['fuel', 'gasoline'], 'Every car on the lot is delivered with fuel in it and every test drive burns some.',
        { liveIds: ['fuel'], cite: OPS + ' cars.inputs.fuel; gas.yields.fuel' }),
      /* p1 prose: "a car dealership purchases vehicles from a car factory". The PDF
         draws this edge on the FACTORY's side (needs-as-buyer), so the cargo lane
         lives here, on the business that receives the cars. */
      lane('carfactory', ['cars', 'vehicleParts'], 'The owner\'s own example: the Car Factory builds vehicles, the Car Dealer buys them and sells them on to players for battles and delivery missions.',
        { pdf: 'needs-buyer', cargoIsItem: true, consumerCite: 'Dealer Desk (public/src/carfactory) — escrow resale of player-built cars; its server half (the cf_ functions migration) is NOT applied anywhere yet' }),
    ],
    upkeep: [
      burn('metal', 'opsInput', OPS + ' cars.inputs.metal', 'Body shop and reconditioning. The PDF draws no Mining icon on the Car Dealer, so this is a running cost, not a map lane.'),
    ],
    sellsTo: [CM, M, BATTLE, CITY],
    service: null,
  },

  construction: {
    makes: [
      live('metal', 'opsYield', OPS + ' construction.yields'),
      cityMake('constructionComponents', 'Beams, panels and fixings — the kit every building in the city is bolted together from.'),
      want('concrete', 'What a construction company visibly makes. Battle loot drops it and nothing uses it.'),
    ],
    buys: [
      lane('trashcrusher', ['recycledMetal', 'glass', 'plastic'], 'Rebar from recycled metal, glazing from recovered glass, pipe and sheeting from plastic — building sites are the biggest buyer of recyclate.'),
      lane('mining', ['metal', 'stone'], 'Structural steel and foundation stone come out of the ground.'),
    ],
    upkeep: [burn('fuel', 'opsInput', OPS + ' construction.inputs.fuel', 'Plant and site machinery. No Gas Station icon on the PDF tile.')],
    sellsTo: [CITY],                // PDF draws no Marketplace icon: it earns from City Builders.
    service: 'Each worker is one more city build slot, and the company holds the Construction licence.',
  },

  trashcrusher: {
    makes: [
      live('recycledMetal', 'opsYield', OPS + ' trashcrusher.yields'),
      live('plastic', 'opsYield', OPS + ' trashcrusher.yields'),
      live('glass', 'opsYield', OPS + ' trashcrusher.yields'),
      cityMake('recycledPlastic', 'Plastic pulled back out of the city’s waste stream and sold on as feedstock.'),
      cityMake('recycledGlass', 'Cullet from the city’s bottle banks, melted back into new glass.'),
    ],
    buys: [
      lane('mining', ['coal', 'limestone', 'metal'], 'The blast furnace behind the crusher charges coal as fuel and limestone as flux, and the jaws themselves are wear steel.',
        { consumerCite: 'RECIPES (public/src/foundry/recipes.js) — scrapMetal + coal, pigIron + limestone; both are bought from an NPC contract today' }),
      /* PDF draws "Salvage needs Trash Crusher". Nothing the crusher makes is
         something a salvage yard consumes, so reading it supplier-first gave an
         absurd lane (rejected: crusher ships recycled metal TO salvage). It is the
         same needs-as-buyer pattern as Car Factory / Car Dealer: the salvage yard
         needs the crusher to buy its hulks. */
      lane('salvage', ['scrapMetal', 'metal'], 'Salvage crews strip the valuable parts and sell the stripped hulks and loose scrap to the crusher, which is the only business that can turn them back into clean metal.',
        { pdf: 'needs-buyer', confidence: 'likely' }),
    ],
    upkeep: [burn('fuel', 'opsInput', OPS + ' trashcrusher.inputs.fuel', 'The crusher and furnace burn fuel on every collect. No Gas Station icon on the PDF tile.')],
    sellsTo: [M, CITY],
    service: null,
  },

  weaponsmith: {
    makes: [
      live('weaponParts', 'opsYield', OPS + ' weaponsmith.yields'),
      cityMake('metalComponents', 'Finished metal parts — the fittings the city’s workshops assemble everything else out of.'),
      want('ammo', 'The bench already builds the guns; battlers burn ammo every fight and no business makes it.'),
    ],
    buys: [
      lane('mining', ['metal', 'copperOre'], 'Barrels and blades are forged metal; copper is casings and jackets.',
        { liveIds: ['metal'], cite: OPS + ' weaponsmith.inputs.metal; mining.yields.metal' }),
      lane('trashcrusher', ['recycledMetal', 'plastic'], 'Recycled metal is the cheap stock for frames and magazines; plastic is grips, stocks and furniture.'),
    ],
    upkeep: [
      burn('fuel', 'opsInput', OPS + ' weaponsmith.inputs.fuel', 'The forge fire. No Gas Station icon on the PDF tile.'),
      burn('wood', 'minigame', BENCH, 'Hafts and grips on every billet.'),
      burn('cloth', 'minigame', BENCH, 'Grip wraps on every billet and the sharpening step.'),
      burn('weaponParts', 'minigame', BENCH, 'The better billets eat the op\'s own product.'),
    ],
    sellsTo: [M, BATTLE, CAMP],
    service: null,
  },

  /* ───────────────────────── p7 ───────────────────────── */
  restaurant: {
    makes: [
      cityMake('preparedMeals', 'Cooked meals for the city’s kitchens and canteens. The Restaurant you own feeds the city, not your stash.'),
      /* No 'food' row: the Kitchen's addRes('food') is a convoy CLAIM (food arriving), not
         production, and the op's yields are empty on purpose. Claiming it would be a false live flag. */
    ],
    buys: [
      lane('fishing', ['freshFish', 'shellfish'], 'The fish and shellfish on the menu.'),
      lane('agri', ['food', 'vegetables', 'potatoes', 'wheat'], 'Produce, potatoes for the fries, wheat for the buns.',
        { liveIds: ['food'], cite: OPS + ' restaurant.inputs.food; agri.yields.food' }),
      lane('feed', ['meat', 'eggs'], 'The Homestead raises the animals; the kitchen buys the meat and eggs.'),
    ],
    sellsTo: [M, CITY, CAMP],
    /* The multiplier itself is read live off the ops table (never written down here,
       CLAUDE.md). Its SYMBOL used to be in this sentence and the sentence is printed
       at a player, so it is in the comment where it belongs. */
    /* ⚠ Keep the comma. partners.js builds its "poor fit" sentence from clause cuts of
       this string and drops the distance clause when no short cut exists; a
       comma-free rewrite made _supplychain_smoke section 11 fail. */
    service: 'Owning one multiplies the food every one of your food businesses yields, at a rate read live from the game.',
  },

  agri: {
    makes: [
      live('food', 'opsYield', OPS + ' agri.yields'),
      /* All six read alike in the data as well as on the screen — see cityMake(). */
      cityMake('wheat', 'Bread grain for the city\'s mills and bakeries — the biggest single thing its farms grow.'),
      cityMake('rice', 'The city\'s second staple. Its canteens and the Smuggling Network\'s food runs both price against it.'),
      cityMake('potatoes', 'A root crop that keeps: the city\'s kitchens buy it all year, and a Restaurant would too.'),
      cityMake('vegetables', 'Fresh produce for the city\'s markets — the shortest-lived thing the farm grows, and the first to spoil.'),
      /* The Gene Lab lane is drawn from this tile and both of its cargo ids are
         city-sim-only, so nobody could ever run it. See cityPromote() above — and
         note these two read exactly like the four crops above them, because in the
         game they ARE exactly the same kind of thing. */
      cityPromote('corn', 'The map has the farm feeding the Genetics Lab, and corn is the energy half of a growth medium — so a player\'s own fields need to be able to grow it, not just a city\'s.'),
      cityPromote('soybeans', 'The protein half of the same medium, and the Homestead\'s mill wants it too, so the map asks a player\'s farm for a crop only a city grows today.'),
    ],
    buys: [
      lane('oil', ['fertilizer', 'diesel'], 'Fertiliser is made from natural gas and the tractors run on diesel — a farm with no oil supplier grows less every season.',
        { confidence: 'likely' }),
    ],
    sellsTo: [M, CM, CITY],
    service: null,
  },

  feed: {
    makes: [
      live('animalFeed', 'opsYield', OPS + ' feed.yields'),
      live('livestock', 'minigame', 'Homestead Farm (public/src/farm/index.js) — host.addRes(\'livestock\')'),
      live('meat', 'minigame', 'Homestead Farm (public/src/farm/index.js) — every output lands in the real ledger'),
      live('eggs', 'minigame', 'Homestead Farm (public/src/farm/index.js)'),
      live('wool', 'minigame', 'Homestead Farm (public/src/farm/index.js)'),
      live('hide', 'minigame', 'Homestead Farm (public/src/farm/index.js)'),
      live('leather', 'minigame', 'Homestead Farm workshop "tannery" (public/src/farm/index.js)'),
      /* Round one left these out and that made the text on the owner's own example
         false ("no business makes cloth"). The Spinning Shed makes cloth TODAY, in
         small batches, from the flock's wool. */
      live('cloth', 'minigame', FARM + ' recipes.spinner / spinnerFine — Spinning Shed, wool in, cloth out'),
      live('fertilizer', 'minigame', FARM + ' yieldsPerH cow / pig / donkey — manure'),
      live('feathers', 'minigame', FARM + ' yieldsPerH.chicken, slaughter.chicken'),
      live('rawMilk', 'minigame', FARM + ' yieldsPerH cow / goat'),
      live('food', 'minigame', FARM + ' recipes.kitchen* — the farm kitchen cooks meat, eggs and milk into rations'),
      live('goldEggs', 'minigame', FARM + ' premium.goods — only a rare-or-better breed lays them'),
      live('primeMeat', 'minigame', FARM + ' premium.goods'),
      live('richMilk', 'minigame', FARM + ' premium.goods'),
      live('fineWool', 'minigame', FARM + ' premium.goods'),
    ],
    buys: [
      lane('agri', ['food', 'corn', 'soybeans'], 'Feed is milled grain: corn for energy, soy for protein.',
        { liveIds: ['food'], cite: OPS + ' feed.inputs.food; agri.yields.food' }),
    ],
    upkeep: [
      burn('water', 'opsInput', OPS + ' feed.inputs.water', 'Troughs. Water is camp and battle loot; no business on the map makes it.'),
    ],
    sellsTo: [M, CM, CITY],
    service: null,
  },

  dojo: {
    makes: [cityMake('sportingGoods', 'Training kit for the city’s gyms and clubs. What the Dojo gives YOU is the licence below, not a resource.')],
    buys: [],
    sellsTo: [BATTLE, CAMP],        // PDF: the card icon and nothing else.
    service: 'Trains units. Holds the licence for Tutor Shop wholesale and the Camp Dojo Shop, where moves are resold to battlers.',
  },

  cardshop: {
    makes: [
      cityMake('boosterPacks', 'Sealed packs for the city’s own card players.'),
      want('printedCards', 'A card shop that prints nothing is only a till. The id exists in the ledger and no business makes it.'),
    ],
    buys: [],
    sellsTo: [M, BATTLE, CAMP],
    service: 'Holds the Card Shop licence: your own storefront selling cards to battlers.',
  },

  fishing: {
    makes: [
      live('freshFish', 'opsYield', OPS + ' fishing.yields'),
      live('shellfish', 'opsYield', OPS + ' fishing.yields'),
      live('seaweed', 'opsYield', OPS + ' fishing.yields'),
      cityMake('seafood', 'Landed catch boxed for the city’s markets — separate from the fish and shellfish the hourly operation puts in your stash.'),
    ],
    buys: [
      lane('gas', ['fuel', 'diesel'], 'Boats do not leave the dock without fuel.',
        { liveIds: ['fuel'], cite: OPS + ' fishing.inputs.fuel; gas.yields.fuel' }),
    ],
    sellsTo: [M, CITY],
    service: null,
  },

  cannery: {
    makes: [
      live('food', 'opsYield', OPS + ' cannery.yields'),
      cityMake('cannedFood', 'Shelf-stable tins: how the city keeps food that would not otherwise keep.'),
    ],
    buys: [
      lane('trashcrusher', ['recycledMetal', 'glass'], 'The cans and the jars. A cannery with no recycled metal has fish and nothing to put it in.',
        { confidence: 'likely' }),
      lane('fishing', ['freshFish', 'shellfish'], 'The catch that goes in the can.',
        { liveIds: ['freshFish'], cite: OPS + ' cannery.inputs.freshFish; fishing.yields.freshFish' }),
    ],
    sellsTo: [M, CITY, CAMP],
    service: null,
  },

  bank: {
    makes: [],
    buys: [],
    sellsTo: [BIZ, CAMP],
    service: 'Funds businesses and players: a chartered player bank takes deposits and its tellers underwrite loans (player_banks). It ships nothing, so it needs no truck.',
  },

  /* ───────────────────────── p8 ───────────────────────── */
  genelab: {
    makes: [
      live('dna', 'opsYield', OPS + ' genelab.yields'),
      cityMake('medicine', 'The city’s own pharmacy output. The medicine you can hold comes from a Medical Corporation instead.', ECO + ' (pharma)'),
    ],
    buys: [
      lane('research', ['memoryShards', 'researchEquipment', 'researchChemicals'], 'Sequencers, reagents and the recovered memory a clone is imprinted with all come from the Research Facility.'),
      lane('agri', ['soybeans', 'corn'], 'Growth media is plant protein and sugar; the crop lines the lab improves start as seed from the farm.'),
      lane('feed', ['livestock', 'animalFeed'], 'Breeding stock to sample and clone, and the feed that keeps the lab animals alive.'),
      /* Why ORE and not refined copper: nothing on the owner's map refines copper,
         and coverage.js already lists these two ids as this lab's needs. A wet lab
         buying concentrate and precipitating its own salts is the honest reading;
         swapping in `copper` would have split the two files. */
      lane('mining', ['zincOre', 'copperOre'], 'Trace minerals for the culture media and the metal salts a wet lab goes through: the pit ships concentrate and the lab precipitates what it needs from it.'),
    ],
    upkeep: [
      burn('medicine', 'opsInput', OPS + ' genelab.inputs.medicine', 'The lab burns medicine on every collect. The PDF draws no Medical icon on the Gene Lab, so this is a running cost and not a map lane.'),
    ],
    sellsTo: [BIZ, CAMP],           // PDF: no Marketplace icon. DNA goes to Research and the camp DNA Lab.
    service: 'Holds the licence for the camp DNA Lab, where battlers clone units.',
  },

  medical: {
    makes: [
      live('medicine', 'opsYield', OPS + ' medical.yields'),
      cityMake('medicalSupplies', 'Dressings, kits and consumables for the city’s clinics.'),
    ],
    buys: [
      lane('research', ['memoryShards', 'researchChemicals'], 'New drugs start as research: recovered memory for the neural line, lab chemicals for everything else.',
        { liveIds: ['memoryShards'], liveVia: 'minigame',
          cite: 'Live through the HOSPITAL sub-screen only: the Nerve Tonic line in ' + PHARMA + '. That line also needs medicine. The Medical op itself consumes no shards. Supplier side: research.yields.memoryShards in ' + OPS }),
      /* THE OWNER'S EXAMPLE. The consumer half is already in the game; the map's
         producer (a Fashion Brand) is not, so the lane is honest about being
         half-live. Round one claimed cloth had no business producer at all — false: the
         Homestead Farm's Spinning Shed does. It is not drawn as a lane because the
         PDF has no Livestock-to-Medical icon; sourceToday says where cloth really
         comes from so the modal can. */
      lane('fashion', ['cloth', 'fabric'], 'Bandages, gowns and bedding are cloth. The Fashion Brand weaves it, Transport hauls it, the hospital turns it into bandages.',
        { consumerCite: 'BANDAGE_RECIPE (public/src/hospital/patients.js) and the Field Salve pharma line — cloth + water are consumed today. The map\'s producer, Fashion Brand, does not exist yet; today cloth is battle loot or small batches from the Homestead Farm\'s Spinning Shed',
          sourceToday: ['feed'] }),
    ],
    upkeep: [
      burn('food', 'opsInput', OPS + ' medical.inputs.food', 'Ward meals. The PDF draws no farm or restaurant icon on Medical Corp.'),
      burn('water', 'minigame', 'BANDAGE_RECIPE (public/src/hospital/patients.js) and ' + PHARMA),
      /* DELIBERATE overlap with the fashion lane. cloth is a PDF lane, so the map's
         version of it lives in buys[] — but a bandage is cloth + water and only the
         water half was showing here, so liveInputsOf('medical') under-reported the
         hospital's most basic running input. Both lists are true: the lane says who
         SHOULD ship it, this row says the ward burns it today whoever ships it. */
      burn('cloth', 'minigame', 'BANDAGE_RECIPE (public/src/hospital/patients.js) — {cloth, water}, and the Field Dressing pharma line', 'Also a PDF lane (from Fashion Brand); listed here as well because the ward consumes it today and the map\'s supplier does not exist yet.'),
      burn('dna', 'minigame', PHARMA, 'Immune Serum line.'),
      burn('ethanol', 'minigame', PHARMA, 'Vaccine line. The Oil Company\'s Cracking Yard is the only thing that makes it.'),
      burn('supplies', 'minigame', PHARMA, 'Vaccine line.'),
    ],
    sellsTo: [M, CITY, CAMP],
    service: null,
  },

  fashion: {
    makes: [
      want('cloth', 'The owner\'s own example. Cloth already has real consumers (hospital bandages and salve, Weapon Smith grip wraps) but no dedicated producer: today it is battle loot, or small batches spun from wool at the Homestead Farm. The Fashion Brand is the map\'s answer to that.'),
      want('fabric', 'Finished bolts — what the city\'s clothiers and the Player Closet brands would cut from.'),
      want('clothing', 'The product a fashion brand is named for; city households already demand it.'),
    ],
    buys: [],                       // PDF: needs no other business. Its raw fibre is battle loot (see coverage.js).
    sellsTo: [M, CITY],
    service: null,
    planned: 'No Fashion Brand operation exists in the game yet. Everything on this tile is the owner\'s map, not the shipped game.',
  },

  research: {
    makes: [
      live('memoryShards', 'opsYield', OPS + ' research.yields'),
      cityMake('researchEquipment', 'Instruments and rigs for the city’s laboratories.'),
      cityMake('researchChemicals', 'Reagents for the city’s laboratories — and, on the map, what a Medical Corporation wants from you.'),
      want('researchData', 'What a research facility actually sells. It drops in battle and nothing uses it.'),
    ],
    buys: [
      lane('genelab', ['dna'], 'Sequenced samples are the raw material of the Containment Lab\'s studies.'),
      lane('medical', ['medicine', 'medicalSupplies'], 'Trial compounds to test, and the medical cover a containment crew needs to keep working.'),
    ],
    upkeep: [
      burn('metal', 'opsInput', OPS + ' research.inputs.metal', 'Containment hardware. The PDF draws no Mining icon on the Research Facility.'),
      burn('fuel', 'opsInput', OPS + ' research.inputs.fuel', 'Generators. The PDF draws no Gas Station icon on the Research Facility.'),
    ],
    sellsTo: [M, BATTLE, CAMP, CITY],
    service: null,
  },

  carfactory: {
    makes: [
      live('supplies', 'opsYield', OPS + ' carfactory.yields'),
      cityMake('vehicleParts', 'Parts for the city’s own assembly plant. The parts YOU place on a bench come from the Car Factory’s own screens.', ECO + ' (autoPlant)'),
      /* The server half of the build (the cf_mint function, sql/160) has not been
         applied to any database yet, so nothing can mint one. Same rule as limestone
         above: the symbol name stays in the comment, never in the row's `why`. */
      want('cars', 'What this factory really turns out is a car you built yourself — a vehicle on a forecourt, not a stack in your bag — and no built car can be finished in the game yet. It rides the dealer lane here because that is the run the owner drew on page one.'),
    ],
    buys: [
      lane('gas', ['fuel'], 'The line, the paint ovens and every car that rolls off need fuel.',
        { liveIds: ['fuel'], cite: OPS + ' carfactory.inputs.fuel; gas.yields.fuel' }),
      lane('oil', ['petrochemicals', 'rubber'], 'Tyres, hoses, seals and paint are all oil products.'),
      lane('trashcrusher', ['recycledMetal', 'plastic', 'glass'], 'Body panels from recycled metal, dashboards and trim from plastic, windscreens from glass.'),
      /* aluminumOre dropped for `aluminum`: a block is cast from refined metal, the
         ore id is city-sim-only, and coverage.js lists BOTH ids as this plant's
         needs — so the refined one costs nothing in agreement and reads right. */
      lane('mining', ['metal', 'aluminum'], 'Chassis steel, and engine blocks cast from refined aluminium.',
        { liveIds: ['metal'], cite: OPS + ' carfactory.inputs.metal; mining.yields.metal' }),
    ],
    /* PDF "Car Factory needs Car Dealer" = needs-as-BUYER (pdfmap section six, C). The
       cargo lane is RECIPES.cars.buys[from carfactory]; this field lets a view say
       "you need a dealer to sell through" without pretending the dealer ships here. */
    buyers: [{ to: 'cars', ids: ['cars', 'vehicleParts'], why: 'A factory cannot retail. It needs a Car Dealer\'s desk to sell what it builds.' }],
    sellsTo: ['cars', M, BATTLE],
    service: null,
  },

  smuggling: {
    makes: [
      cityMake('mythicResidue', 'What the city’s anomaly site scrapes off a breach.', ECO + ' (anomalySite)'),
      cityMake('anomalousEnergy', 'Charge bled off a breach and stored by the city.'),
      cityMake('mythicEssence', 'Refined breach-stuff, the rarest thing the city makes.'),
      cityMake('arcaneCrystal', 'Crystal grown around a breach and cut by the city.'),
      want('contraband', 'The network earns Cinder only today. Contraband is battle loot with no use; this is the one business that would plausibly deal in it.'),
    ],
    buys: [
      lane('research', ['researchData', 'memoryShards'], 'Leaked research and recovered memories are the most valuable thing that fits in a pocket.',
        { confidence: 'likely' }),
      /* Round one shipped fresh fish "as a cover load" and a blind reader found it odd:
         a lane should carry something the buyer WANTS. Shellfish is the luxury that
         sells off the books. */
      lane('fishing', ['shellfish'], 'Shellfish is the luxury catch: landed at night and sold untaxed to the camps that pay most for it. The boats that land it are also the network\'s way in.'),
      lane('gas', ['fuel'], 'Night runs burn more fuel than any honest route.',
        { liveIds: ['fuel'], cite: OPS + ' smuggling.inputs.fuel; gas.yields.fuel' }),
      lane('agri', ['food', 'rice'], 'Untaxed food is the oldest smuggled good there is: sacks of staples run past the checkpoints to camps that cannot buy them openly.'),
    ],
    /* sys:camp dropped (graph round 3, sellsTo-nothing). Nothing this tile makes is used by the
       camp in coverage.js, the PDF draws no battler card beside it and no code ties the camp's
       Smuggler trader to owning this op — so a camp arrow here was a claim with nothing under
       it. Its goods still reach camp players over the Marketplace counter. */
    sellsTo: [M],
    service: null,
  },

  salvage: {
    makes: [
      live('metal', 'opsYield', OPS + ' salvage.yields'),
      cityMake('recycledMetal', 'Scrap the city melts back into usable metal. The Trash Crusher is where a player gets the holdable kind.'),
      want('scrapMetal', 'Stripped hulks and loose scrap — what is left after the good parts come off, and what the Trash Crusher exists to eat.'),
      want('salvagedTech', 'The good parts. Battle loot today, with no business that produces or uses it.'),
    ],
    buys: [
      /* Round three briefly added scrapMetal here to get a holdable id onto the lane.
         Rejected on two counts, both measured: coverage.needsOf('salvage') does not
         list scrapMetal, so graph.js raised cargo-not-a-need and the two files
         disagreed; and a promote('cars') on the dealer would not have helped either,
         because proposal.js holds any cargoIsItem id as 'cargo-is-an-item' and would
         never have paid it out. A hulk is an ITEM. The lane is exempt from the
         dead-lane rule instead (see validateRecipes) — its runnability is the owner's
         pending vehicle-item decision, not a missing producer. */
      lane('cars', ['cars'], 'Write-offs and unsold trade-ins leave the dealer\'s lot for the salvage yard to strip.',
        { pdf: 'needs-ambiguous', confidence: 'likely', cargoIsItem: true }),
      lane('research', ['researchData'], 'Survey data: wreck manifests, hazard maps and scans tell a salvage crew which ruin is worth opening and what is inside.',
        { confidence: 'likely' }),
    ],
    /* See RECIPES.trashcrusher.buys: the PDF's Trash Crusher icon is read as a buyer.
       ⚠ DELIBERATE DEVIATION FROM THE MAP, flagged in the data so a view can say so
       rather than leaving it in a comment nobody renders. pdfmap §5 derives the edge
       as Trash Crusher -> Salvage Operation; the cargo here runs the other way,
       because a salvage yard strips hulks and sends the unsellable remainder to the
       crusher, not the reverse. validateRecipes accepts either direction, so nothing
       would have caught this — hence the flag. */
    buyers: [{ to: 'trashcrusher', ids: ['scrapMetal', 'metal'], reversedFromPdf: true, why: 'The crusher is the yard\'s outlet for everything it cannot resell as a part.' }],
    sellsTo: ['trashcrusher', M, CITY],
    service: null,
  },

  warehouse: {
    makes: [cityMake('packagingMaterial', 'Wrap, fill and strapping for everything the city ships.'),
      cityMake('cardboard', 'Boxes, flattened and re-pulped by the city’s own mills.')],
    buys: [],
    sellsTo: [BIZ],
    service: 'Holds the storage of other players: its product is capacity, rented out player to player (storage_rentals). Every lane on this map ends in somebody\'s stock room.',
  },

  /* ───────────────────────── hub ───────────────────────── */
  transport: {
    makes: [cityMake('packagingMaterial', 'Wrap and strapping, made where the city’s distribution runs start.', ECO + ' (distributor)')],
    buys: [
      lane('gas', ['fuel', 'diesel', 'gasoline'], 'The heaviest fuel user on the map: every haul is paid for in fuel.',
        { liveIds: ['fuel'], cite: OPS + ' transport.inputs.fuel; gas.yields.fuel' }),
      lane('cars', ['trucks', 'cars'], 'Rigs and vans are bought from the Car Dealer; a haulier with no dealer has no fleet.',
        { pdf: 'needs-ambiguous', cargoIsItem: true, consumerCite: '_opAfterFound transport starter rig + Prince Portfolios (public/index.html) — rigs are vehicle items bought on the dealer floor, not the resource ids shown' }),
    ],
    sellsTo: [BIZ],
    service: 'Carries every other business\'s cargo: pickup, haul, depot, deliver. Earns haulage fees, not goods. Today a carrier is mandatory only for hospital pharma wholesale and plague-cure waybills; everywhere else the map shows the owner\'s intended rule and the game still lets you haul it yourself.',
    /* Where that "mandatory only for" claim comes from: the PHASE table in
       public/src/transport/routes.js. It is a cite, so it lives in this comment —
       the string above is printed at a player verbatim. */
  },

  /* ───────────────────────── p9: city-only ───────────────────────── */
  bus: {
    makes: [], buys: [], sellsTo: [CITY, CAMP],
    upkeep: [burn('fuel', 'opsInput', OPS + ' bus.inputs.fuel', 'The fleet. p9 draws no icons at all on the city-only companies.')],
    service: 'Works only for the city: unlocks bus stops and routes so residents and NPCs can reach other cities and camps. The PDF also makes a Bus, Rail Road or Airport the condition for hiring from registered camps — that rule is NOT enforced today.',
  },
  rail: {
    makes: [], buys: [], sellsTo: [CITY, CAMP],
    upkeep: [
      burn('fuel', 'opsInput', OPS + ' rail.inputs.fuel', 'Locomotives.'),
      burn('metal', 'opsInput', OPS + ' rail.inputs.metal', 'Track and rolling stock.'),
    ],
    service: 'Works only for the city: unlocks train stations and track. Same NPC-trade and camp-hiring role as the Bus Company; it does not replace Transport for business cargo.',
  },
  airport: {
    makes: [], buys: [], sellsTo: [CITY, CAMP],
    service: 'Works only for the city: long-range NPC trade with other cities and camps, and the third way to satisfy the camp-hiring rule.',
    planned: 'No Airport operation exists in the game yet (the nearest thing is the city\'s Jet Fuel Terminal tile).',
  },
});

/* Phantom ids: referenced by game data, defined in NO catalogue. Listed so a view
   can explain the gap; never used as cargo (contract rule four).
   All four of the contract's phantoms are listed, not just the one this file
   happened to meet: validateRecipes rejects any of them as a make or as cargo, and
   with only gunOil in the table a later round could have shipped `gold` as Mining's
   product and nothing would have stopped it. Same four ids as coverage.PHANTOMS. */
export const PHANTOMS = Object.freeze({
  gunOil: { yieldedBy: 'oil', consumedBy: 'weaponsmith', cite: OPS + ' oil.yields.gunOil; public/src/weaponsmith/blueprints.js', note: 'Would be a natural oil-to-weaponsmith product, but the PDF draws no such edge and the id has no catalogue row. Owner decision.' },
  sulfur: { yieldedBy: null, consumedBy: null, cite: 'CINDER_SHOP_DEFAULT_INVENTORY (public/index.html) — restockCost on the smoke and flash lines', note: 'The camp shop charges it to restock, so a player can be asked for it, but no catalogue defines it and nothing drops it. A Mining or Oil product if the owner ever wants one.' },
  gold: { yieldedBy: null, consumedBy: null, cite: 'CINDER_SHOP_DEFAULT_INVENTORY (public/index.html) — relic charm, relic hauler, focus sash restockCost', note: 'Not goldOre and not goldBars, both of which are real ids. A restock cost for an id that does not exist.' },
  organs: { yieldedBy: null, consumedBy: null, cite: 'the built-in Gas Station Run map (GS_RUN_ID, public/index.html) — node gs4 reward', note: 'A battle reward pays it out; syntheticOrgans is the real catalogue id. The Gene Lab would be its producer if the owner promotes it.' },
});

/* ── OWNER DECISIONS THIS FILE CANNOT MAKE ───────────────────────────────────
   Two gaps are real, are not this file's to close, and had no owner-facing prompt
   anywhere in the feature — they lived only in comment prose, which nothing renders.
   Exported so the modal and OWNER_DECISIONS.md can both show them as open asks
   instead of a reader discovering them as silence. The lane lists are DERIVED, so
   they cannot go stale and no count is written down. */
export const OPEN_QUESTIONS = Object.freeze([
  Object.freeze({
    id: 'shipyard-ids',
    ask: 'Four catalogue resources have no producer and no consumer anywhere on the map. Which business should make them?',
    ids: Object.freeze(['planking', 'rivets', 'pitch', 'hullPlates']),
    why: 'All four are shipyard goods (inShipyard in the catalogue). The owner asked that every resource in the game have a use; these are the only ids with none at either end, and buildGraph() reports an error on each. recipes.js structurally cannot absorb them: there is no shipyard tile on the PDF, an upkeep[] row has to be live with a cite, and a buys[] row has to be a lane the owner drew. So this needs a tile (a Shipyard, or the Fishing Company taking boat repair) before any cargo can be written.',
    blocks: 'coverage of four resource ids',
  }),
  Object.freeze({
    id: 'vehicles-as-items',
    ask: 'Are built cars, rigs and hulks ever going to be stackable resource ids, or do they stay vehicle ITEMS?',
    ids: Object.freeze(['cars', 'trucks', 'vehicleParts']),
    why: 'Today a vehicle is an item on a dealer floor, not a resource in a stash, so proposal.js holds every one of these lanes as cargo-is-an-item and no overlay can pay them out. The lanes read correctly and none of them can run. Until this is answered, the Car Factory cannot buy a dealer\'s stock, Transport cannot buy its own fleet down a map lane, and the Salvage Operation cannot take write-offs.',
    get lanes() {
      const out = [];
      for (const b of Object.keys(RECIPES)) for (const l of RECIPES[b].buys) if (l.cargoIsItem) out.push(l.from + ' -> ' + b);
      return Object.freeze(out);
    },
    blocks: 'every cargoIsItem lane',
  }),
]);

/* The PDF's needs-edges exactly as pdfmap.md section five derives them, written as
   [needer, needed]. Kept HERE (not imported from businesses.js) so this file can
   prove on its own that no drawn edge was left with an empty truck. */
export const PDF_NEEDS = Object.freeze([
  ['transport', 'gas'], ['transport', 'cars'],
  ['oil', 'mining'], ['gas', 'oil'], ['cars', 'gas'],
  ['construction', 'trashcrusher'], ['construction', 'mining'],
  ['trashcrusher', 'mining'], ['weaponsmith', 'mining'], ['weaponsmith', 'trashcrusher'],
  ['restaurant', 'fishing'], ['restaurant', 'agri'], ['restaurant', 'feed'],
  ['agri', 'oil'], ['feed', 'agri'], ['fishing', 'gas'],
  ['cannery', 'trashcrusher'], ['cannery', 'fishing'],
  ['genelab', 'research'], ['genelab', 'agri'], ['genelab', 'feed'], ['genelab', 'mining'],
  ['medical', 'research'], ['medical', 'fashion'],
  ['research', 'genelab'], ['research', 'medical'],
  ['carfactory', 'gas'], ['carfactory', 'oil'], ['carfactory', 'trashcrusher'],
  ['carfactory', 'mining'], ['carfactory', 'cars'],
  ['smuggling', 'research'], ['smuggling', 'fishing'], ['smuggling', 'gas'], ['smuggling', 'agri'],
  ['salvage', 'cars'], ['salvage', 'trashcrusher'], ['salvage', 'research'],
].map(Object.freeze));

const _lane = (from, to) => {
  const r = RECIPES[to];
  if (!r) return null;
  return r.buys.find(b => b.from === from) || null;
};

/* Full lane record for the cargo moving from -> to. If the lane only exists the
   other way round (a needs-as-buyer icon asked about in the drawn direction) the
   real lane is returned with reversed:true, so a caller walking the PDF's icons
   never gets an empty truck and never has to know which icons are buyers. */
export function edgeInfo(from, to) {
  const fwd = _lane(from, to);
  if (fwd) return Object.assign({}, fwd, { to, reversed: false });
  const back = _lane(to, from);
  if (back) return Object.assign({}, back, { to: from, reversed: true });
  return null;
}

/* Contract export: the resource ids riding from -> to (empty array = no lane). */
export function edgeCargo(from, to) {
  const e = edgeInfo(from, to);
  return e ? e.ids.slice() : [];
}

/* The PDF needs-edge [needer, needed] resolved to a real shipment. */
export function pdfEdge(needer, needed) {
  const asSupplier = _lane(needed, needer);
  if (asSupplier) return Object.assign({}, asSupplier, { to: needer, direction: 'supplier' });
  const asBuyer = _lane(needer, needed);
  if (asBuyer) return Object.assign({}, asBuyer, { to: needed, direction: 'buyer' });
  return null;
}

/* Who puts this id in a PLAYER's stash today (cityFirm output never leaves the sim). */
export function liveProducersOf(resId) {
  return Object.keys(RECIPES).filter(b => RECIPES[b].makes.some(m => m.id === resId && m.live && m.via !== 'cityFirm'));
}

/* Fill upkeep[].madeBy from makes[] and give every tile an upkeep array, so a view
   never has to null-check and the two lists cannot disagree. */
for (const b of Object.keys(RECIPES)) {
  const r = RECIPES[b];
  r.upkeep = Object.freeze((r.upkeep || []).map(u => Object.freeze(Object.assign(u, { madeBy: Object.freeze(liveProducersOf(u.id).filter(p => p !== b)) }))));
}

export const upkeepOf = bizId => (RECIPES[bizId] ? RECIPES[bizId].upkeep.slice() : []);

/* Everything the tile consumes TODAY, from both lists — what "needs to run" means
   in the shipped game, as opposed to on the owner's map. */
export function liveInputsOf(bizId) {
  const r = RECIPES[bizId]; if (!r) return [];
  const out = r.upkeep.map(u => ({ id: u.id, via: u.via, cite: u.cite, from: null, madeBy: u.madeBy }));
  for (const l of r.buys) for (const id of l.liveIds) out.push({ id, via: l.liveVia, cite: l.cite, from: l.from, madeBy: liveProducersOf(id) });
  return out;
}

/* Bare ids. One row per id since round four, so the de-duplication below is only a
   belt-and-braces guard against a future hand-edit, not a repair. */
export const makesOf = bizId => (RECIPES[bizId] ? RECIPES[bizId].makes.map(m => m.id).filter((id, i, a) => a.indexOf(id) === i) : []);

/* Every makes[] id must appear on exactly ONE row. Round three shipped a second
   row for a promoted id and the modal printed Copper Ore twice — LIVE and PLANNED —
   on the same screen; makesMerged() was exported as the remedy and no view in the
   whole of public/src ever called it, so it bought the tree nothing. The shape is
   fixed at the source now (see cityWant above) and this guard is what stops it
   coming back: a duplicate is an ERROR the validator fails on, not something a
   display helper quietly folds away. */
export function duplicateMakes(bizId) {
  const seen = new Set(), dup = [];
  for (const m of ((RECIPES[bizId] || {}).makes || [])) { if (seen.has(m.id)) dup.push(m.id); seen.add(m.id); }
  return dup;
}

/* The ids on a lane that a player could actually put on a truck: the supplier's
   makes[] row for them either already reaches a stash, or is a cityWant row that
   the proposal overlay turns into a real yield. Empty = a lane nobody can ever run.
   ⚠ `promotes` is the whole reason the test is not a bare `via !== 'cityFirm'`:
   since round four the promotion IS the cityFirm row rather than a second row
   beside it, so excluding every cityFirm row would resurrect the three dead lanes
   this rule was written to kill. */
export function haulableCargo(lane) {
  const sup = (RECIPES[lane.from] || {}).makes || [];
  return lane.ids.filter(id => sup.some(m => m.id === id && (m.via !== 'cityFirm' || m.promotes === 'cityFirm')));
}

/* One word for how true a lane is, so every lane in the UI can be honest and not
   only the eleven that carry a cite string:
     'live'     — something really moves between these two businesses today
     'half'     — the consumer burns the cargo today but the map's supplier does not
                  make it (the owner's fashion -> medical example is exactly this)
     'proposed' — the owner's map; the game does not do it yet. */
export function laneStatus(lane) {
  if (lane.live) return 'live';
  if (lane.consumerCite || lane.sourceToday.length) return 'half';
  return 'proposed';
}

/* PER-ID truth for one lane. laneStatus() answers "does this lane run today", which
   is a property of the WHOLE truck, and a view that badges every chip with it lies
   about the individual boxes: the Mining modal read "Weapon Smith · Metal, Copper Ore
   (LIVE)" while Copper Ore was badged PLANNED two panels up on the same screen.
   A lane is live when ANY id on it is live, so the per-id answer has to come from
   liveIds, and only this file knows it. Views badge chips with this, panels with
   laneStatus(). Returns 'live' | 'half' | 'proposed'. */
export function laneIdStatus(lane, id) {
  if (!lane || !lane.ids.includes(id)) return null;
  if (lane.liveIds.includes(id)) return 'live';
  /* the consumer really burns it, or somebody OTHER than the map's supplier can
     hand it over today — true of the whole lane, so it is true of each of its ids. */
  if (lane.consumerCite || lane.sourceToday.length) return 'half';
  return 'proposed';
}

/* The same question asked of a whole lane at once, so a view can render a truck
   without calling laneIdStatus in a loop and without inventing the grouping. */
export const laneCargoStatus = lane => (lane ? lane.ids.map(id => ({ id, status: laneIdStatus(lane, id) })) : []);

/* Counts for a legend ("11 of 38 lanes run today"). Derived, never written down. */
export function laneStats() {
  const out = { lanes: 0, live: 0, half: 0, proposed: 0 };
  for (const b of Object.keys(RECIPES)) for (const l of RECIPES[b].buys) { out.lanes++; out[laneStatus(l)]++; }
  return out;
}

export function producersOf(resId) {
  return Object.keys(RECIPES).filter(b => RECIPES[b].makes.some(m => m.id === resId));
}

const _has = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);

/* Self-check. Everything it needs is INJECTED so the file stays import-free:
     ids       — iterable of real catalogue ids (sc/brief/_ids.json, later the snapshot)
     bizIds    — the canonical tile ids (businesses.js)
     opsEcon   — { [opId]: { yields, inputs } } (the fixture, or live opEcon())
     businesses— optional BUSINESSES rows; cross-checks needs[] and icon-derived sellsTo
     minigameOutputs — optional { [bizId]: [resId] } parsed from the REAL minigame files
                  (farm FARM_ECON, refinery STASH_IDS). Round one's cloth omission slipped
                  through because nothing checked minigame makes for completeness.
     minigameSources — optional { [bizId]: 'source text of the cited files' }: every
                  minigame-tagged id (makes and upkeep) must literally appear in it.
   Returns { errors, warnings }; errors empty is the bar. */
export function validateRecipes(ctx) {
  const c = ctx || {};
  const errors = [], warnings = [];
  const ids = c.ids ? new Set(c.ids) : null;
  const bizIds = c.bizIds ? new Set(c.bizIds) : new Set(Object.keys(RECIPES));
  const real = id => !ids || ids.has(id);

  for (const b of bizIds) if (!RECIPES[b]) errors.push('no recipe for tile ' + b);
  for (const b of Object.keys(RECIPES)) {
    const r = RECIPES[b];
    const op = c.opsEcon ? c.opsEcon[b] : null;
    if (!bizIds.has(b)) errors.push('recipe for unknown tile ' + b);
    /* Round four. Two rows for one id put the same product on a modal twice with
       two different badges; the headline "12 products" counted rows, not ids, and
       was wrong on the surface that clipped the duplicate away. No display helper
       can fix that honestly — the data has to be right. */
    for (const id of duplicateMakes(b)) errors.push(b + ' lists ' + id + ' in makes[] more than once');
    for (const m of r.makes) {
      if (!real(m.id)) errors.push(b + ' makes unknown id ' + m.id);
      if (PHANTOMS[m.id]) errors.push(b + ' makes phantom id ' + m.id);
      /* A live row must name its evidence and a proposed row must argue for itself.
         The one exception is a cityPromote() row (round five): its evidence is the
         `via` itself, which the OP_ECO_MAP cross-check two lines below verifies far
         harder than any typed cite could, and it deliberately carries NO cite so the
         prose it does carry is what a reader sees — graph.js resolves the on-screen
         note as `cite || why`, so a cite would silently swallow the sentence and
         print a repo path in its place. Still enforced for it: a why. */
      const isCity = m.via === 'cityFirm';
      if (m.live && !m.evidence) errors.push(b + '.' + m.id + ' is live and names no evidence');
      if (!m.live && !m.why) errors.push(b + '.' + m.id + ' is proposed and argues nothing');
      /* A city firm's product is the one live row that always needs a sentence: its
         rate line says only "never reaches your stash", which tells a player what it
         is NOT. An opsYield row needs none — its rate line already reads "26.4 an
         hour at full crew". */
      if (isCity && !m.why) errors.push(b + '.' + m.id + ' is a city-firm product with no sentence for the player');
      /* graph.js does `note: cite || why`, so ANY cite on a makes row is the sentence
         a player reads, and for six rounds that was a repo path on 74 rows here. The
         field is kept, permanently null, so the swallow is impossible rather than
         merely absent; evidence lives in `evidence`, which no view reads. */
      if (m.cite) errors.push(b + '.' + m.id + ' sets a cite; a makes row\'s cite is what a PLAYER reads — put the symbol in evidence and the sentence in why');
      /* THE RULE ROUND SIX SHOULD HAVE WRITTEN. Round six enforced per-tile
         UNIFORMITY of evidence, which a tile whose every row carries the same repo
         path passes. This is the thing actually wanted: nothing this file hands a
         view as prose may be an address, a file or a symbol. */
      if (m.why && JARGON.test(String(m.why)))
        errors.push(b + '.' + m.id + ' prose is not prose: "' + String(m.why).match(JARGON)[0] + '"');
      /* ⚠ `op &&` — only check the cite when THIS BUILD HAS THE OPERATION. A tile
         whose op is absent entirely (somebody's unshipped work, e.g. the Car
         Factory in v193) is not a lying cite; graph.js already demotes it to
         planned and says so. Without this guard every such row reported as a
         hard data error on the shipped page. */
      if (c.opsEcon && op && m.via === 'opsYield' && !_has(op.yields, m.id))
        errors.push(b + '.' + m.id + ' claims opsYield but OPS_ECON does not yield it');
      if (c.ecoMap && m.via === 'cityFirm' && !(c.ecoMap[b] || []).includes(m.id))
        errors.push(b + '.' + m.id + ' claims cityFirm but OP_ECO_MAP does not list it');
    }
    /* THE PARITY RULE, ENFORCED (round six). Two ids in the same OP_ECO_MAP `out`
       list are the same kind of thing in the game and a card must not treat them two
       ways. The badge half of that is already impossible — every cityFirm row is live
       — and this closes the other half: they must all carry their evidence the same
       way too, so the note a view resolves as `cite || why` cannot come out as a repo
       path for four ores and a sentence for two. Mining and Agri were the only mixed
       tiles and this is what caught them. */
    const cityRows = r.makes.filter(m => m.via === 'cityFirm');
    if (cityRows.length > 1) {
      const kinds = [...new Set(cityRows.map(m => (m.why ? 'prose' : 'silent')))];
      if (kinds.length > 1) errors.push(b + ' badges its city-firm products two ways: ' + cityRows.map(m => m.id + ':' + (m.why ? 'prose' : 'silent')).join(', '));
    }
    if (op) for (const y of Object.keys(op.yields || {}))
      if (!PHANTOMS[y] && !r.makes.some(m => m.id === y)) errors.push(b + ' yields ' + y + ' in OPS_ECON but it is missing from makes[]');
    for (const l of r.buys) {
      if (!RECIPES[l.from]) { errors.push(b + ' buys from unknown ' + l.from); continue; }
      if (!l.ids.length) errors.push(b + ' <- ' + l.from + ' has no cargo');
      const sup = RECIPES[l.from].makes;
      for (const id of l.ids) {
        if (!real(id)) errors.push(b + ' <- ' + l.from + ' unknown id ' + id);
        if (!sup.some(m => m.id === id)) errors.push(b + ' <- ' + l.from + ': ' + id + ' is not in the supplier\'s makes[]');
      }
      if (l.live && !l.cite) errors.push(b + ' <- ' + l.from + ' is live without a cite');
      /* THE DEAD-LANE RULE (round three). A lane every one of whose ids is a
         cityFirm-only product of the supplier can never be run by anybody: the sim's
         output never reaches a stash, so the modal would describe a shipment that
         cannot happen and proposal.js would require an input with no possible
         producer. Fixed by a promote() row on the supplier, or by cargo that is
         already holdable. Three lanes failed this when it was written.
         EXEMPT: a cargoIsItem lane. Its ids stand in for vehicle ITEMS, which no
         overlay can pay out as a stackable resource — proposal.js holds them as
         'cargo-is-an-item' whatever makes[] says. A promote() there would buy a
         green tick and change nothing real, so those lanes wait on the owner's
         pending vehicle-item decision instead; cargoIsItem already forces them
         proposed, so nothing can quietly claim them live. */
      if (!l.cargoIsItem && !haulableCargo(l).length)
        errors.push(b + ' <- ' + l.from + ': every cargo id is cityFirm-only on the supplier, so no player can ever run this lane');
      for (const id of l.liveIds) {
        const m = sup.find(x => x.id === id);
        if (!l.ids.includes(id)) errors.push(b + ' <- ' + l.from + ' liveId ' + id + ' is not cargo');
        if (!m || !m.live || m.via === 'cityFirm') errors.push(b + ' <- ' + l.from + ': ' + id + ' is flagged live but the supplier does not put it in a player stash');
        if (c.opsEcon && op && (l.cite || '').includes('.inputs.') && !_has(op.inputs, id))
          errors.push(b + ' <- ' + l.from + ': cite says OPS_ECON input ' + id + ' but the op does not consume it');
      }
      /* the other direction of truthfulness: an OPS_ECON input the supplier really yields must not be left flagged proposed. */
      if (op && c.opsEcon[l.from]) for (const id of l.ids)
        if (_has(op.inputs, id) && _has(c.opsEcon[l.from].yields, id) && !l.liveIds.includes(id))
          errors.push(b + ' <- ' + l.from + ': ' + id + ' is live in OPS_ECON on both ends but not flagged');
    }
    /* Every live OPS_ECON input is shown SOMEWHERE: a live lane id or an upkeep row. */
    if (op) for (const id of Object.keys(op.inputs || {}))
      if (!r.buys.some(l => l.liveIds.includes(id)) && !r.upkeep.some(u => u.id === id && u.via === 'opsInput'))
        errors.push(b + ' consumes ' + id + ' in OPS_ECON but it is in neither a live lane nor upkeep[]');
    const mentions = id => new RegExp('\\b' + id + '\\b').test((c.minigameSources || {})[b] || '');
    for (const u of r.upkeep) {
      if (!real(u.id)) errors.push(b + ' upkeep unknown id ' + u.id);
      if (!u.live || !u.cite) errors.push(b + ' upkeep ' + u.id + ' must be live with a cite');
      if (c.opsEcon && u.via === 'opsInput' && !_has(op && op.inputs, u.id)) errors.push(b + ' upkeep ' + u.id + ' claims opsInput but OPS_ECON does not consume it');
      if (u.via === 'opsInput' && r.buys.some(l => l.liveIds.includes(u.id))) errors.push(b + ' upkeep ' + u.id + ' duplicates a live lane');
      if (c.minigameSources && u.via === 'minigame' && !mentions(u.id)) errors.push(b + ' upkeep ' + u.id + ' is tagged minigame but the cited source never mentions it');
    }
    if (c.minigameOutputs && c.minigameOutputs[b]) {
      const mine = r.makes.filter(m => m.live && m.via !== 'cityFirm').map(m => m.id);
      for (const id of c.minigameOutputs[b]) if (!PHANTOMS[id] && !mine.includes(id)) errors.push(b + ': minigame produces ' + id + ' but it is missing from makes[]');
      for (const m of r.makes) if (m.via === 'minigame' && !c.minigameOutputs[b].includes(m.id)) errors.push(b + '.' + m.id + ' claims minigame but the minigame does not output it');
    }
    if (c.minigameSources) for (const m of r.makes)
      if (m.via === 'minigame' && !mentions(m.id)) errors.push(b + '.' + m.id + ' is tagged minigame but the cited source never mentions it');
    for (const l of r.buys) {
      if (l.cargoIsItem && l.live) errors.push(b + ' <- ' + l.from + ' ships vehicle items and must stay proposed');
      for (const s of l.sourceToday)
        if (!l.ids.some(id => liveProducersOf(id).includes(s))) errors.push(b + ' <- ' + l.from + ' sourceToday ' + s + ' makes none of the cargo today');
    }
    for (const n of r.sellsTo) if (!/^(sys|ch):/.test(n) && !RECIPES[n]) errors.push(b + ' sellsTo unknown node ' + n);
    if (!r.makes.length && !r.service) errors.push(b + ' makes nothing and has no service text');
  }
  for (const [needer, needed] of PDF_NEEDS) if (!pdfEdge(needer, needed)) errors.push('PDF edge ' + needer + ' needs ' + needed + ' has no cargo lane');
  /* and the reverse: no lane the PDF did not draw. */
  for (const b of Object.keys(RECIPES)) for (const l of RECIPES[b].buys)
    if (!PDF_NEEDS.some(([needer, needed]) => (needer === b && needed === l.from) || (needer === l.from && needed === b)))
      errors.push('lane ' + l.from + ' -> ' + b + ' is not on the PDF');

  if (c.businesses) for (const row of c.businesses) {
    const r = RECIPES[row.id]; if (!r) continue;
    for (const n of row.needs || []) if (!pdfEdge(row.id, n.biz)) errors.push('businesses.js: ' + row.id + ' needs ' + n.biz + ' but no lane exists');
    const ic = row.icons || {};
    if (Boolean(ic.market) !== r.sellsTo.includes(M)) warnings.push(row.id + ': Marketplace icon and sellsTo disagree');
    if (Boolean(ic.carMarket) !== r.sellsTo.includes(CM)) warnings.push(row.id + ': Car Marketplace icon and sellsTo disagree');
  }
  return { errors, warnings };
}
