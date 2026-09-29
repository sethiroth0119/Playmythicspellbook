/* loot.js — HOW EVERY RESOURCE ENTERS THE GAME AS LOOT.  (Supply Chain, piece "loot")

   PURE: no DOM, no window, no imports. `node -e "import('./loot.js')"` must work, and the
   graph / modal / hover pieces receive this file's exports as injected data.

   WHY THIS FILE EXISTS
   The owner's goal says "every business needs what can be found in the loot system in the
   battle system". To show that honestly the UI has to answer, for any resource id, "where do
   I go to get this?" — and answer it with the game that ships, not with a wish. Every row
   below is a roll that already exists in public/index.html; each `cite` is the SYMBOL to
   grep for (line numbers rot daily in that file, names do not).

   WHAT IS DELIBERATELY NOT HERE
   - No drop rate, quantity, chance or multiplier. Those live in index.html (and some are
     admin-tunable); a second copy here would be wrong the first time anybody rebalances.
     A row says WHAT drops and WHERE, never HOW MUCH.
   - No invented source. If a resource only ever arrives through the uniform "anything in
     the salvage table" pools, this file says exactly that. Inventing a themed source for it
     is a gameplay change and belongs in proposal.js, switched off.
   - No resource names or icons. Ids only; the catalogue piece owns the words.

   REJECTED: generating the drop lists at build time from index.html (as catalog.snapshot.js
   is). The lists here are five small themed tables and four weight profiles — hand-mirrored
   they stay readable next to their player-facing sentence, and the audit piece re-greps
   every cite and re-diffs every list to catch drift. At RUNTIME the three lists an admin can
   actually change — the structure tables, the staple pool and the trader line-ups — are
   taken live from the bridge when the caller passes them (see `opts` below).

   ⚠ PASS THE CATALOGUE. This file cannot embed 420 ids, so on its own it cannot tell a real
   exotic ("demonCores") from a typo ("demonCorse"): both are simply "not in any list here".
   Round 1 answered "the uniform pools can roll it" for both, which showed a misspelt need
   to players as lootable. Now the whole-table pools are only claimed for an id this file
   can vouch for — one the injected catalogue knows, or one named in a list below. Anything
   else gets an explicit `unverified` marker and isLootable() returns null, never true. */

/* ── the "pools" ──────────────────────────────────────────────────────────────────────
   Most of the 410 storable ids have no themed source: they arrive through a uniform draw.
   A row with `pool` instead of `drops` means:
     'staples' = the weighted camp loot pool (LOOT_RES_IDS)
     'exotic'  = SALVAGE_RES minus LOOT_RES_IDS  (the body "exotic" roll)
     'all'     = every SALVAGE_RES row            (chests, the secured-salvage haul)      */

/* Mirror of LOOT_RES_IDS @ index.html. Overridable at runtime via opts.lootResIds. */
export const STAPLE_IDS = Object.freeze([
  'food', 'ammo', 'water', 'medicine', 'energyDrink', 'supplies', 'metal',
  'fuel', 'corruptedEssence', 'memoryShards', 'dna', 'wood', 'stone', 'cloth',
]);

/* Ledger ids (RESOURCES) that are NOT rows of SALVAGE_RES, so no salvage pool can roll them.
   ⚠ energyDrink is in this set AND in the staple pool: it cannot come out of a chest or off
   a body, but camp missions, containers and the smuggler hand it out through addRes. So it
   IS lootable — the brief's "11 never lootable" is really 10 (see sc/decisions/loot.md).
   Used only when no catalogue is injected; with a catalogue, `inLoot` on the row wins. */
export const NOT_IN_SALVAGE = Object.freeze([
  'energyDrink', 'ingots', 'gasOil', 'heavyOil', 'slop', 'ethanol', 'reformate',
  'alkylate', 'catGasoline', 'hydrotreatedCut', 'reprocessedSlop',
]);

/* Ids the shipped game refers to but that exist in NEITHER catalogue (contract rule 4).
   sourcesFor() returns [] for them: they have no source because they do not exist. */
export const PHANTOM_IDS = Object.freeze(['gunOil', 'sulfur', 'gold', 'organs']);

/* Where the non-lootable ids come from instead. `facility` is the in-game place, NOT a
   business node id: which business tile owns the facility is the recipes piece's question,
   and asserting it here would be this file inventing a fact it has not verified.
   The nine refinery cuts are excluded from loot ON PURPOSE in index.html (the comment
   inside SALVAGE_RES beside diesel/kerosene/naphtha/butane): they do not exist outside a
   refinery that made them, and looting them would let a player skip the whole yard. */
const REFINERY_CITE = ' · SALVAGE_RES "REFINERY CUTS" comment @ index.html';
/* FACILITY_OWNER — which business TILE a modal should link the marker to. Round 2 left this
   to "the recipes piece", which meant no view could link it at all. It is NOT imported from
   recipes.js (same-wave sibling); it is a two-line mirror that tools/…/verify checks against
   recipes.js on every run:
     refinery -> 'oil'          confirmed: RECIPES.oil.makes lists every STASH_IDS cut.
     foundry  -> 'sys:city'     confirmed (graph round 3). This used to say 'trashcrusher'
                 (likely) and was wrong: src/foundry (the crusher's sub-screen) casts `metalIngot`,
                 which taps into `metal` — it never makes the `ingots` id. The id is yielded by the
                 CITY's Smelting Foundry building and banked into the player's ledger, which is the
                 whole reason it was promoted into RESOURCES (v121v70). The owner is therefore a
                 SYSTEM node, not a business; graph.js reads a system owner as "made in that
                 system" and does not look for a RECIPES row. */
export const FACILITY_OWNER = Object.freeze({
  refinery: Object.freeze({ biz: 'oil',          confidence: 'confirmed', cite: 'RECIPES.oil.makes (Cracking Yard STASH_IDS) @ src/supplychain/recipes.js' }),
  foundry:  Object.freeze({ biz: 'sys:city',     confidence: 'confirmed', cite: 'Smelting Foundry yields {metal, ingots} @ src/city/production.data.js · Smelting Works gen ingots @ node-city/index.html' }),
});
export const MADE_NOT_LOOTED = Object.freeze({
  ingots:          { facility: 'foundry',  cite: 'src/city/production.data.js (Smelting Foundry yields) · RESOURCES ingots comment @ index.html' },
  gasOil:          { facility: 'refinery', cite: 'src/refinery/state.js (STASH_IDS)' + REFINERY_CITE },
  heavyOil:        { facility: 'refinery', cite: 'src/refinery/state.js (STASH_IDS)' + REFINERY_CITE },
  slop:            { facility: 'refinery', cite: 'src/refinery/state.js (STASH_IDS)' + REFINERY_CITE },
  ethanol:         { facility: 'refinery', cite: 'src/refinery/state.js (STASH_IDS)' + REFINERY_CITE },
  reformate:       { facility: 'refinery', cite: 'src/refinery/state.js (STASH_IDS)' + REFINERY_CITE },
  alkylate:        { facility: 'refinery', cite: 'src/refinery/state.js (STASH_IDS)' + REFINERY_CITE },
  catGasoline:     { facility: 'refinery', cite: 'src/refinery/state.js (STASH_IDS)' + REFINERY_CITE },
  hydrotreatedCut: { facility: 'refinery', cite: 'src/refinery/state.js (STASH_IDS)' + REFINERY_CITE },
  reprocessedSlop: { facility: 'refinery', cite: 'src/refinery/state.js (STASH_IDS)' + REFINERY_CITE },
});
const FACILITY_WORDS = Object.freeze({
  foundry:  'the Smelting Foundry in your city',
  refinery: 'the Cracking Yard refinery',
});

/* ── the rows ─────────────────────────────────────────────────────────────────────────
   Row shape (frozen by the lead contract):
     {id,label,system,how,themed,drops:[resId] | pool:'staples'|'exotic'|'all',cite}
   Additive, optional fields this piece adds:
     always:[resId]  subset of `drops` that CANNOT come up empty: a ruin's core list, and
                     the body lines whose roll has a floor above zero. It is what makes
                     "hospital ruins" a better answer for medicine than a source where
                     medicine is one flavour of many. Round 1 also listed the body lines
                     that roll from ZERO (stone, cloth, fuel, medicine, water, dna) and the
                     Common-only fishing catch here, which promised players a drop the game
                     does not guarantee and ranked living bodies first for dna. They are
                     plain `drops` now; the verifier re-reads the rolls to keep it so.
     kind:'buy'      a trader row: a Cinder PURCHASE, not a roll. `trader` is the
                     TRADER_DEFAULTS id so a live line-up can replace the mirror.
     harvest:true    the haul passes through the harvest-mode menu (see LOOT_MODIFIERS).
     dormant:true    the read side ships but nothing can create the thing to loot;
                     kept as a row so nobody re-adds it, never returned by sourcesFor().
     ruin:'car'…     key into STRUCTURE_SALVAGE, so a live table can replace the mirror.
     secured:bool    true = lands straight in camp storage; false = rides the field bag
                     (or the run's haul) and is lost on defeat. Worth telling a player who
                     is choosing a business by where its inputs come from.
   DECLARATION ORDER IS PART OF THE ANSWER: sourcesFor() is a stable sort, so inside one
   rank the earlier row wins. 'Any fallen unit' leads (it pays on every kill); then ruins
   before the typed bodies, because a ruin is a place a player can walk to on purpose and a
   unit type is whatever the enemy brought. Among ruins the one a player would GUESS comes
   first where two share an id: houses before schools, so cloth answers "abandoned houses"
   (round 2 answered "school ruins", true but nobody's first thought). */
const B = 'sys:battle', C = 'sys:camp';

const RAW_SOURCES = [
  /* FIRST ON PURPOSE (round 3): for supplies, ammo and wood the honest best answer is "win
     fights" — every tombstone pays them — not "find a school". It only outranks the ruins
     for its three `always` ids; stone and cloth are plain drops here, so a ruin that always
     holds cloth still answers first. */
  { id: 'body:any', label: 'Any fallen unit', system: B, themed: true, secured: false, harvest: true,
    how: 'Loot the tombstone of any unit that falls in battle — supplies, ammo and timber every time, and often some stone and cloth.',
    always: ['supplies', 'ammo', 'wood'],
    drops: ['supplies', 'ammo', 'wood', 'stone', 'cloth'],
    cite: '_rollUnitSalvage (baseline + CONSTRUCTION SCRAP) @ index.html' },
  /* 2.2 battlefield structures — the ONLY fully themed tables in the game. */
  { id: 'ruin:hospital', label: 'Hospital ruins', system: B, themed: true, ruin: 'hospital', secured: false, harvest: true,
    how: 'Search a ruined hospital on the battlefield — medical stock always turns up, with a few rarer lab finds.',
    always: ['medicine', 'medicalSupplies', 'chemicals'],
    drops: ['medicine', 'medicalSupplies', 'chemicals', 'medicalHerbs', 'bioMatter', 'syntheticOrgans', 'containmentFluid', 'water'],
    cite: 'STRUCTURE_SALVAGE.hospital · _rollStructureSalvage @ index.html' },
  { id: 'ruin:car', label: 'Wrecked cars', system: B, themed: true, ruin: 'car', secured: false, harvest: true,
    how: 'Strip a wrecked car on the battlefield — metal, fuel and scrap every time, plus parts and tools.',
    always: ['metal', 'fuel', 'scrapMetal', 'mechanicalParts'],
    drops: ['metal', 'fuel', 'scrapMetal', 'mechanicalParts', 'batteryCells', 'toolKits', 'plasticComponents', 'repairKits', 'weaponParts', 'ammo'],
    cite: 'STRUCTURE_SALVAGE.car · _rollStructureSalvage @ index.html' },
  { id: 'ruin:church', label: 'Church ruins', system: B, themed: true, ruin: 'church', secured: false, harvest: true,
    how: 'Search a ruined church on the battlefield — relics, sigils and candles, sometimes coin and precious metal.',
    always: ['relicFragments', 'divineSigils', 'ritualCandles'],
    drops: ['relicFragments', 'divineSigils', 'ritualCandles', 'ancientCoins', 'spiritAshes', 'goldBars', 'silverFragments', 'memoryShards'],
    cite: 'STRUCTURE_SALVAGE.church · _rollStructureSalvage @ index.html' },
  { id: 'ruin:house', label: 'Abandoned houses', system: B, themed: true, ruin: 'house', secured: false, harvest: true,
    how: 'Search an abandoned house on the battlefield — food, water, cloth and timber, plus household supplies.',
    always: ['food', 'water', 'cloth', 'wood'],
    drops: ['food', 'water', 'cloth', 'wood', 'supplies', 'campSupplies', 'foodSupplies', 'militaryRations', 'survivalGear', 'glassShards'],
    cite: 'STRUCTURE_SALVAGE.house · _rollStructureSalvage @ index.html' },
  { id: 'ruin:school', label: 'School ruins', system: B, themed: true, ruin: 'school', secured: false, harvest: true,
    how: 'Search a ruined school on the battlefield — research notes, supplies and cloth, plus manuals, blueprints and data.',
    always: ['researchData', 'supplies', 'cloth'],
    drops: ['researchData', 'supplies', 'cloth', 'ancientDataDrives', 'survivorManuals', 'blueprintPages', 'craftingSchematics', 'dataFragments', 'memoryChips'],
    cite: 'STRUCTURE_SALVAGE.school · _rollStructureSalvage @ index.html' },

  /* 2.1 tombstone looting — one row per BRANCH of _rollUnitSalvage, because the branch is
     what a player can aim at ("fight machines for metal"). */
  { id: 'body:mech', label: 'Fallen machines', system: B, themed: true, secured: false, harvest: true,
    how: 'Loot fallen machines — mechs, robots, tanks and drones always break down into metal and ammo, and often fuel.',
    always: ['metal', 'ammo'],
    drops: ['metal', 'fuel', 'ammo'],
    cite: '_rollUnitSalvage (mech branch) @ index.html' },
  { id: 'body:organic', label: 'Fallen living units', system: B, themed: true, secured: false, harvest: true,
    how: 'Loot fallen living units — anything that is not a machine always carries food, and can carry medicine, water and DNA.',
    always: ['food'],
    drops: ['food', 'medicine', 'water', 'dna'],
    cite: '_rollUnitSalvage (non-mech branch) @ index.html' },
  { id: 'body:corrupt', label: 'Fallen corrupted units', system: B, themed: true, secured: false, harvest: true,
    how: 'Loot fallen corrupted units — shadow, undead, demon and void enemies leave Corrupted Essence behind.',
    always: ['corruptedEssence'],
    drops: ['corruptedEssence'],
    cite: '_rollUnitSalvage (corrupt branch) @ index.html' },
  { id: 'body:rare', label: 'Rare and better units', system: B, themed: true, secured: false, harvest: true,
    how: 'Loot fallen units of Rare rarity or better — they can carry Memory Shards and extra DNA.',
    drops: ['memoryShards', 'dna'],
    cite: '_rollUnitSalvage (rare+ branch) @ index.html' },
  { id: 'body:boss', label: 'Bosses', system: B, themed: true, secured: false, harvest: true,
    how: 'Loot a fallen boss — always Memory Shards, Corrupted Essence, DNA and metal on top of its normal haul.',
    always: ['memoryShards', 'corruptedEssence', 'dna', 'metal'],
    drops: ['memoryShards', 'corruptedEssence', 'dna', 'metal'],
    cite: '_rollUnitSalvage (isBoss branch) @ index.html' },
  { id: 'body:exotic', label: 'Exotic salvage off any body', system: B, themed: false, secured: false, harvest: true, pool: 'exotic',
    how: 'Any fallen unit can also carry a few exotic resources drawn at random from the whole salvage table — guaranteed on Rare-and-better units and bosses, with an occasional jackpot stack.',
    cite: '_rollUnitSalvage (EXOTIC SALVAGE roll) @ index.html' },

  /* 2.4 world-map district battles. The zone list is themed by the zone's yields[]; the
     ids a zone CAN name are the values of _WB_RES_MAP. */
  { id: 'world:zone', label: 'World-map district battles', system: B, themed: true, secured: true,
    how: 'Win a world-map district battle — the zone pays out the staples it is known for, straight to camp storage.',
    drops: ['food', 'water', 'ammo', 'fuel', 'metal', 'supplies', 'medicine', 'dna', 'corruptedEssence', 'memoryShards'],
    cite: '_WB_RES_MAP · worldBattleAfter @ index.html' },

  /* 2.6 roguelite runs — four weight profiles, one row each because difficulty is a choice. */
  { id: 'rogue:easy', label: 'Roguelite run — Easy', system: B, themed: true, secured: false,
    how: 'Fight through an Easy roguelite run — the haul leans on food and water. It is only yours once a Convoy node or extraction banks it.',
    drops: ['food', 'water', 'ammo', 'supplies', 'metal', 'medicine'],
    cite: 'RLC_HAUL_PROFILES.easy · _rlcHaulRoll @ index.html' },
  { id: 'rogue:normal', label: 'Roguelite run — Normal', system: B, themed: true, secured: false,
    how: 'Fight through a Normal roguelite run — the haul leans on ammo and supplies. Bank it at a Convoy node or extraction.',
    drops: ['ammo', 'supplies', 'metal', 'fuel', 'medicine', 'food', 'water'],
    cite: 'RLC_HAUL_PROFILES.normal · _rlcHaulRoll @ index.html' },
  { id: 'rogue:hard', label: 'Roguelite run — Hard', system: B, themed: true, secured: false,
    how: 'Fight through a Hard roguelite run — the haul leans on fuel and metal, with some Corrupted Essence and DNA. Bank it at a Convoy node or extraction.',
    drops: ['fuel', 'metal', 'medicine', 'ammo', 'corruptedEssence', 'dna'],
    cite: 'RLC_HAUL_PROFILES.hard · _rlcHaulRoll @ index.html' },
  { id: 'rogue:brutal', label: 'Roguelite run — Brutal', system: B, themed: true, secured: false,
    how: 'Fight through a Brutal roguelite run — the haul leans on Corrupted Essence and Memory Shards. Bank it at a Convoy node or extraction.',
    drops: ['corruptedEssence', 'memoryShards', 'dna', 'fuel', 'metal', 'medicine'],
    cite: 'RLC_HAUL_PROFILES.brutal · _rlcHaulRoll @ index.html' },

  /* 2.7 Territory Wars. Ids = twResId() of every key in _TW_RES_KEYS (CRYSTAL and RELIC both
     fold to memoryShards, so ten keys are nine ids). TW_RES_CANON knows more keys (WATER,
     OIL, GOLD …) but no seeded or re-rolled node ever yields them, so they are NOT listed:
     a key the map cannot roll is not a source. */
  { id: 'tw:node', label: 'Territory Wars nodes', system: B, themed: true, secured: true,
    how: 'Hold a registered Territory Wars node — each node pays one resource over time, straight to camp storage.',
    drops: ['food', 'fuel', 'medicine', 'metal', 'memoryShards', 'corruptedEssence', 'wood', 'dna', 'electricity'],
    cite: '_TW_RES_KEYS · TW_RES_CANON · _twNodeAccrueYield @ index.html' },

  /* 2.8 fishing. A catch is not combat, but freshFish is a live business input (cannery),
     so it needs a findable source. WF_FISH_DROPS is not in the reader brief — found while
     re-verifying WF_CATCH_RES; it is the crewed-expedition basket and is real. */
  { id: 'fish:cast', label: 'Fishing — casting a line', system: C, themed: true, secured: true,
    how: 'Go fishing — each landed fish is iced by its rarity: common catches as Fresh Fish, better ones as Shellfish or Prime Seafood, and some casts bring up Seaweed.',
    drops: ['freshFish', 'shellfish', 'primeSeafood', 'seaweed'],
    cite: 'WF_CATCH_RES · _wf3BankCatch @ index.html' },
  { id: 'fish:expedition', label: 'Fishing expeditions', system: C, themed: true, secured: true,
    how: 'Send a crewed boat on a fishing expedition — it returns with a basket of fish, plus whatever the sea gives up: scrap, fuel barrels, drinking water and the odd relic.',
    drops: ['freshFish', 'shellfish', 'primeSeafood', 'seaweed', 'dna', 'memoryShards', 'corruptedEssence', 'relicFragments', 'scrapMetal', 'fuel', 'water'],
    cite: 'WF_FISH_DROPS @ index.html' },
  /* 2.8b drydock repair salvage. A SEPARATE row from fish:expedition, deliberately, not four
     extra ids on that basket: these come from a different function on a different roll, they
     never touch the main resource ledger (they bank to `Profile.fishingCorp.resources`
     @ index.html:236281) and the drydock is their only consumer. Round 5 shipped all four as
     catalogue ORPHANS — 4 of 424 ids with no source and no use, the one thing the owner asked
     to eliminate — because nobody had found where they live. They do live, and here is where.
     Folding them into the expedition basket would have hidden that they are hull stock. */
  { id: 'fish:repairSalvage', label: 'Fishing expeditions — hull repair salvage', system: C, themed: true, secured: true, live: true,
    how: 'One expedition in three also comes home with boat repair stock: planking every time, pitch about half the time, rivets less often, and hull plates only off the most dangerous runs.',
    always: ['planking'],
    drops: ['planking', 'pitch', 'rivets', 'hullPlates'],
    cite: '_wfMaybeYieldRepairRes() @ index.html:236449 (called @ 236953) · WF_REPAIR_RESOURCES @ index.html:236332' },
  { id: 'fish:leviathan', label: 'Leviathan fights at sea', system: B, themed: true, secured: true,
    how: 'Kill a leviathan that attacks your boat — the carcass is rendered into Leviathan Parts.',
    always: ['monsterParts'],
    drops: ['monsterParts'],
    cite: 'addSalvage({ monsterParts @ index.html' },

  /* ── uniform pools, best-known first ─────────────────────────────────────────────── */
  /* 2.5 camp missions: two payouts per run, so two rows. */
  { id: 'camp:mission', label: 'Camp missions', system: C, themed: false, secured: true, pool: 'staples',
    how: 'Send units on a camp mission — Scout, Raid, Deep Run or a strike on the rival camp — and they haul back survival staples.',
    cite: 'CAMP_LOOT_TIERS · _campGrantLoot · _lootResPick · LOOT_RES_IDS @ index.html' },
  { id: 'camp:container', label: 'Camp loot containers', system: C, themed: false, secured: true, pool: 'staples',
    how: 'Open a loot container in a camp zone — a mix of survival staples, sometimes an item or a card.',
    cite: '_campLootContainer · _lootResRows @ index.html' },
  { id: 'camp:smuggler', label: 'The smuggler board', system: C, themed: false, secured: true, pool: 'staples',
    how: 'Trade with the smuggler — the rotating deals pay out survival staples.',
    cite: '_smugglerDeal · _lootResPick @ index.html' },
  { id: 'camp:missionSalvage', label: 'Camp missions — salvage haul', system: C, themed: false, secured: true, salvageHaul: true, pool: 'all',
    how: 'Every camp mission also brings back a random pull from the whole salvage table — more pulls on riskier runs.',
    cite: '_campGrantLoot · _rollSalvageLoot @ index.html' },
  { id: 'world:salvage', label: 'World-map battles — salvage haul', system: B, themed: false, secured: true, salvageHaul: true, pool: 'all',
    how: 'Every world-map district win also pays a random pull from the whole salvage table, more in dangerous zones.',
    cite: 'worldBattleAfter · _rollSalvageLoot @ index.html' },
  /* 2.3 chests. ONE row, not four: the four tiers differ only in amounts and in how rarely
     they drop — numbers this file refuses to restate — and all four draw the same pool. */
  { id: 'chest:any', label: 'Battle chests', system: B, themed: false, secured: true, pool: 'all', tiers: ['t1', 't2', 't3', 't4'],
    how: 'Harvesting bodies can drop a chest and, separately, its key. Opening one pays several resources drawn from the whole salvage table — bigger stacks from better chests.',
    cite: 'CHEST_TIERS · _rollChestDrops · _openChest @ index.html' },
  /* A fallen player's bag holds whatever THEY looted in the field — tombstones and ruins,
     which only roll SALVAGE_RES rows — so the honest pool is 'all' (no energyDrink: nothing
     puts one in a field bag).
     ⚠ DORMANT (found in round 2): the loot modal and the 'corpses' table READ exist, but
     nothing in public/ ever WRITES a corpse — the dropper the comment block names
     (_campDropCorpseFromBattle) is not defined anywhere. Until it ships, sending a player
     to look for a bag that cannot exist would be an invented source, so sourcesFor() skips
     dormant rows. The row stays so the audit notices the day the dropper lands. */
  { id: 'camp:fieldBag', label: "A fallen player's field bag", system: C, themed: false, secured: true, pool: 'all', dormant: true,
    how: 'Find the dropped field bag of a player who fell in a camp zone — it holds whatever they had looted.',
    cite: '_campOpenCorpseLoot @ index.html' },
];

/* ── 2.8 camp traders ─────────────────────────────────────────────────────────────────
   WHY TRADERS ARE ROWS (round 1 parked them in OTHER_FAUCETS as "no static list exists" —
   that was wrong): TRADER_DEFAULTS is a static, hand-curated, THEMED table, and for the
   exotics it stocks it is a far better answer than "loot any body and hope" — a player who
   wants Titan Alloy goes to The Foreman. It is also the one place the shipped game already
   IS a supply chain: a trader's shelf only refills when a business SELLS to that trader
   (the RESOURCE TRADERS comment block above TRADER_DEFAULTS), which is exactly the link
   the owner asked this feature to show.
   A trader is a purchase, not a roll, so: kind:'buy', ranked AFTER every free source a
   player can aim at and BEFORE the lotteries, and never counted by isLootable()/themedIds().
   No price, stock cap or unlock cost is mirrored — those are admin-editable numbers.
   Compact table -> rows, so the eleven sentences cannot drift apart. */
const TRADER_MIRROR = [
  ['quartermaster', 'Quartermaster',     'survival staples and medical kits',
    ['food', 'water', 'ammo', 'medicine', 'supplies', 'foodSupplies', 'waterSupplies', 'campSupplies', 'militaryRations', 'medicalSupplies']],
  ['refiner',       'The Refiner',       'fuel, cells and generator stock',
    ['fuel', 'plasmaCells', 'plasmaOre', 'etherFuel', 'nightmareFuel', 'batteryCells', 'energyCubes', 'powerCells', 'heatCores', 'coolingUnits']],
  ['foreman',       'The Foreman',       'ore, alloys and refined metal',
    ['metal', 'scrapMetal', 'ironOre', 'stone', 'steelPlating', 'reinforcedConcrete', 'carbonFiber', 'titanAlloy', 'nanoFiber', 'rareMinerals']],
  ['industrialist', 'The Industrialist', 'finished components and mechanical assemblies',
    ['mechanicalParts', 'circuitBoards', 'reactorComponents', 'weaponParts', 'armorFragments', 'toolKits', 'repairKits', 'droneParts', 'generatorParts', 'beaconParts']],
  ['dispatcher',    'The Dispatcher',    'cargo, signal gear, maps and keys',
    ['supplyCrates', 'tradeGoods', 'signalTransmitters', 'radarComponents', 'expeditionMaps', 'tacticalEquipment', 'tacticalIntel', 'lootKeys', 'vaultCodes', 'bunkerKeys']],
  ['warehouse',     'Warehouse Keeper',  'bulk building and storage materials',
    ['constructionMaterials', 'wood', 'cloth', 'leather', 'plasticComponents', 'glassShards', 'boneFragments', 'crystalDust', 'fusionMaterials', 'craftingSchematics']],
  ['marshal',       'The Marshal',       'arms, armour and tactical kit',
    ['ammunition', 'weaponParts', 'armorFragments', 'securityModules', 'tacticalIntel', 'miningCharges', 'survivalGear', 'survivorTags', 'signalTransmitters', 'excavationTools']],
  ['scholar',       'The Scholar',       'research data, memory tech and anomalies',
    ['memoryShards', 'memoryEchoes', 'memoryChips', 'researchData', 'ancientDataDrives', 'dataFragments', 'blueprintPages', 'neuralGel', 'holoShards', 'scpSamples']],
  ['apothecary',    'The Apothecary',    'medicine, herbs and biological samples',
    ['medicine', 'medicalHerbs', 'medicalSupplies', 'bioMatter', 'mutationStrands', 'syntheticOrgans', 'beastHearts', 'virusSamples', 'plantSpores', 'fungalSamples']],
  ['forester',      'The Forester',      'lumber, hides, seeds and natural reagents',
    ['wood', 'leather', 'monsterHide', 'plantSpores', 'seeds', 'fertilizer', 'natureBloom', 'earthShards', 'iceCrystals', 'fireSalts']],
  ['smuggler',      'The Smuggler',      'contraband, relics and banned tech',
    ['contraband', 'blackMarketTokens', 'corruptedArtifacts', 'relicFragments', 'relicDust', 'mythicEssence', 'ancientCoins', 'goldBars', 'silverFragments', 'darkMatter', 'voidResidue', 'dimensionalShards']],
];
/* TRADER_RESTOCK — which business refills which shelf. The only supply-chain link the shipped
   game DESIGNED between a business and a loot-side shop, so the graph needs it as data.
   Source: the trader's own `blurb` in TRADER_DEFAULTS and the RESOURCE TRADERS comment
   ("BRP → Fuel Trader, Woods Fishing → Forester"). Company names -> contract node ids:
   Black River Petroleum = oil, Ethos Fuel Command = gas, Woods Fishing = fishing,
   Prince Portfolios = cars, Convoy ops = transport.
   ⚠ live:false ON EVERY ROW, and that is a round-3 finding, not caution: sellToTrader() is
   defined and put on window, but NOTHING in public/ calls it (the one `.sellToTrader(` call
   site is the field shop's item shelf, FS.sellToTrader, a different system). So today a
   shelf is seeded part-full and only ever drains. The links are PLANNED; the verifier fails
   the day a caller appears so this gets flipped rather than forgotten.
   Traders whose blurb names no business (or names 'Security PRN', a Reserve node type, not
   a business tile) are deliberately absent — no invented supplier. */
export const TRADER_RESTOCK = Object.freeze([
  { trader: 'refiner',    biz: 'oil',       live: false, cite: 'TRADER_DEFAULTS.refiner blurb (Black River Petroleum) · RESOURCE TRADERS comment @ index.html' },
  { trader: 'refiner',    biz: 'gas',       live: false, cite: 'TRADER_DEFAULTS.refiner blurb (Fuel Command) @ index.html' },
  { trader: 'forester',   biz: 'fishing',   live: false, cite: 'TRADER_DEFAULTS.forester blurb (Woods Fishing) · RESOURCE TRADERS comment @ index.html' },
  { trader: 'dispatcher', biz: 'cars',      live: false, cite: 'TRADER_DEFAULTS.dispatcher blurb (Prince Portfolios) @ index.html' },
  { trader: 'dispatcher', biz: 'transport', live: false, cite: 'TRADER_DEFAULTS.dispatcher blurb (Convoy ops) @ index.html' },
].map((r) => Object.freeze(r)));
export function restockersOf(traderId) {
  return TRADER_RESTOCK.filter((r) => r.trader === traderId);
}

/* One sentence, three promises: it costs Cinder, the trader must be unlocked, and the shelf
   only refills when a business sells in. No number anywhere. `stocks` is optional because
   a live trader this mirror has never heard of has no authored summary. */
function traderHow(name, stocks) {
  return 'Buy it from ' + name + ' for Cinder' + (stocks ? ' — a camp trader stocking ' + stocks : ' — a camp trader') +
    '. The trader has to be unlocked first, and the shelf only refills when a business sells to that trader — no company screen does that yet, so stock runs down and can be empty.';
}
function traderRow(tid, name, stocks, drops) {
  return { id: 'trader:' + tid, label: name, system: C, themed: true, kind: 'buy', trader: tid, secured: true,
    restockedBy: restockersOf(tid).map((r) => r.biz),   // PLANNED links, see TRADER_RESTOCK
    how: traderHow(name, stocks), drops,
    cite: 'TRADER_DEFAULTS.' + tid + ' · getTraderDef @ index.html' };
}

function deepFreeze(row) {
  for (const k of Object.keys(row)) if (Array.isArray(row[k])) Object.freeze(row[k]);
  return Object.freeze(row);
}
/* FROZEN ALL THE WAY DOWN. Round 1 froze only the outer array, and
   sourcesFor('medicine')[0].drops.push('x') rewrote the shared table for every later
   caller. Rows, their arrays and every copy handed out are frozen now. */
export const LOOT_SOURCES = Object.freeze(
  RAW_SOURCES.concat(TRADER_MIRROR.map((t) => traderRow(t[0], t[1], t[2], t[3]))).map(deepFreeze));

/* Real faucets that are NOT rows: what they hand out is authored at runtime (by an admin, a
   contract, a gift sender, the live crisis), so there is no static drop list to mirror and
   any list written here would be invented. Listed so nobody "discovers" them later and adds
   them as loot rows with made-up drops. They never appear in sourcesFor(). */
export const OTHER_FAUCETS = Object.freeze([
  { id: 'faucet:crisisConvoy', label: 'Crisis-response campaign reward', system: B, why: 'pays the one resource the Reserve is starved of; which id is decided live', cite: 'camp.frRewardRes · RESERVE_EVENTS @ index.html' },
  { id: 'faucet:mercenary', label: 'Mercenary contracts', system: B, why: 'reward lines are authored per contract', cite: 'src/mercenary/merc.api.js' },
  { id: 'faucet:haulBoard', label: 'Haul board', system: C, why: 'payouts are authored per job', cite: 'src/haul/index.js' },
  { id: 'faucet:coupons', label: 'Coupon codes', system: C, why: 'a coupon can carry any resource map an admin typed into it', cite: '_applyCouponRewards @ index.html' },
  { id: 'faucet:gifts', label: 'Gifts and rewards inbox', system: C, why: 'a gift can name any single resource id and amount; the sender chooses', cite: 'claimGift · __res: @ index.html' },
  { id: 'faucet:reserveShop', label: 'Foundation Reserve shop products', system: C, why: 'a Cinder purchase whose grant map is per product and admin-editable', cite: 'RESERVE_PRODUCTS · frBuyProduct @ index.html' },
  { id: 'faucet:ops', label: 'Business operations', system: 'sys:business', why: 'op yields are production, not loot — the recipes piece owns them', cite: '_opEcon · _opSettle @ index.html' },
].map(Object.freeze));

/* ── levers and modifiers ─────────────────────────────────────────────────────────────
   Not sources — they change what a source pays. Recorded because two of them are the only
   way a player can AIM battle loot: the harvest modes (the way to farm DNA, Corrupted
   Essence and Memory Shards) and sending a haul to camp (the way not to lose it).
   `targets` = ids the lever pulls toward; `appliesTo` = the row flag it needs. No
   multiplier is restated. */
export const LOOT_MODIFIERS = Object.freeze([
  { id: 'mod:harvestMode', label: 'Harvest mode', appliesTo: 'harvest', targets: ['dna', 'corruptedEssence', 'memoryShards'],
    how: 'When a unit loots a body or a ruin, pick Harvest DNA, Drain Corrupted Essence or Extract Memory Shards instead of Loot Normally — that resource is then guaranteed, at the cost of a thinner haul of everything else.',
    cite: '_lootWithUnit · _lootStructureWithUnit · _biasSalvage @ index.html' },
  { id: 'mod:sendToCamp', label: 'Send to Camp', appliesTo: 'harvest', targets: [],
    how: 'Own a vehicle and you can send a haul straight to camp storage instead of carrying it in the field bag, where defeat would lose it. It burns some fuel, and a better vehicle gets more of the haul home.',
    cite: '_lootWithUnit · VEHICLE_LOOT_FUEL · _vmResearchMult · playerOwnsVehicle @ index.html' },
  { id: 'mod:worldEvent', label: 'World events', appliesTo: 'harvest', targets: [],
    how: 'The active world event makes some survival staples scarcer and others richer in every body and ruin haul.',
    cite: 'WORLD_EVENTS · _applyEventLootMods @ index.html' },
  { id: 'mod:crisisRelief', label: 'Crisis relief', appliesTo: 'salvageHaul', targets: [],
    how: 'While a world crisis is live, camp-mission and world-map salvage hauls carry extra of whatever the Reserve is starved of.',
    cite: '_rollSalvageLoot · frActiveEvent @ index.html' },
  { id: 'mod:looter', label: 'Looter rarity', appliesTo: 'harvest', targets: ['memoryShards', 'dna', 'corruptedEssence'],
    how: 'A rarer unit doing the looting brings back bigger stacks, with a chance of bonus Memory Shards, DNA and Corrupted Essence.',
    cite: '_looterRarityBoost @ index.html' },
  { id: 'mod:backpack', label: 'Backpack', appliesTo: 'harvest', targets: [],
    how: 'A better backpack on your hero increases every line of a battle haul — and makes risky tombstones more likely.',
    cite: '_battleBackpackLootMult · _rollTombstoneRisk @ index.html' },
].map(deepFreeze));

/* ── helpers ──────────────────────────────────────────────────────────────────────── */
/* RANK — and why 'buy' sits where it does. A free source a player can AIM at (a ruin, a
   unit type, a camp mission for staples) beats a purchase that needs an unlock and can be
   sold out; a named shop with the thing on its shelf beats a one-in-hundreds lottery. So
   medicine still answers "hospital ruins" first, and titanAlloy answers "The Foreman"
   before "any body, if you are lucky". */
const RANK = Object.freeze({ always: 0, drops: 1, staples: 2, buy: 3, exotic: 4, all: 5 });
export const VIA_RANK = RANK;

/* Own-property lookup. sourcesFor('constructor') must not find Object.prototype.constructor
   in a map-shaped catalogue or in MADE_NOT_LOOTED — a critic's test id, and a real hazard
   for any id-keyed object literal. */
const own = (o, k) => (o != null && Object.prototype.hasOwnProperty.call(o, k)) ? o[k] : undefined;

/* Accept the catalogue in any shape a caller is likely to hold: the CATALOG array, the
   catalog.js module namespace (byId / CATALOG / catalog()), the catalog() thunk, a
   makeCatalog()/withLive() object, or an {id: row} map. Total. */
function catRow(catalog, id) {
  try {
    if (!catalog) return null;
    /* unwrap a thunk: catalog.js's `catalog()`, passed bare or still inside its namespace.
       One level only — a thunk returning a thunk is a caller bug, not a shape. */
    if (typeof catalog === 'function') catalog = catalog();
    else if (typeof catalog.byId !== 'function' && !Array.isArray(catalog) && !Array.isArray(catalog.CATALOG) && typeof catalog.catalog === 'function') catalog = catalog.catalog();
    if (!catalog) return null;
    if (typeof catalog.byId === 'function') return catalog.byId(id) || null;
    const arr = Array.isArray(catalog) ? catalog : Array.isArray(catalog.CATALOG) ? catalog.CATALOG : null;
    if (arr) { for (const r of arr) if (r && r.id === id) return r; return null; }
    const r = own(catalog, id);
    return (r && typeof r === 'object') ? r : null;
  } catch (e) { return null; }
}

/* Rows with the runtime-overridable tables applied.
   opts.structureSalvage = the live STRUCTURE_SALVAGE ({kind:{core,flavour}});
   opts.traders          = the live line-ups, getAllTraderDefs() shape
                           ([{id,name,catalog:{resId:line}}]; catalog may also be an id array).
   The trader lineup is admin-editable in Forge -> Traders, so the mirror can be stale the
   minute an admin clicks; the bridge's copy wins when it is well-formed. ANYTHING malformed
   falls back, per row, to the static mirror, so a bad bridge can never blank the panel.
   A well-formed EMPTY catalogue is honoured (an admin really did clear that shelf). */
const strs = (a) => a.filter((x) => typeof x === 'string' && x);
function liveTraders(list) {
  if (!Array.isArray(list)) return null;
  const out = {}; let n = 0;
  for (const t of list) {
    if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !t.id) continue;
    const c = t.catalog;
    const ids = Array.isArray(c) ? strs(c) : (c && typeof c === 'object') ? Object.keys(c).filter((k) => c[k]) : null;
    if (!ids) continue;
    out[t.id] = { ids, name: (typeof t.name === 'string' && t.name) ? t.name : null }; n++;
  }
  return n ? out : null;
}
export function resolveSources(opts) {
  const ss = (opts && opts.structureSalvage && typeof opts.structureSalvage === 'object') ? opts.structureSalvage : null;
  const tr = liveTraders(opts && opts.traders);
  if (!ss && !tr) return LOOT_SOURCES;
  const seen = {};
  const rows = LOOT_SOURCES.map((row) => {
    if (row.ruin && ss) {
      const t = own(ss, row.ruin);
      if (!t || !Array.isArray(t.core) || !Array.isArray(t.flavour)) return row;
      const core = strs(t.core);
      const all = core.concat(strs(t.flavour).filter((x) => core.indexOf(x) < 0));
      return all.length ? deepFreeze(Object.assign({}, row, { always: core, drops: all })) : row;
    }
    if (row.kind === 'buy' && tr) {
      const t = own(tr, row.trader);
      if (!t) return row;
      seen[row.trader] = true;
      /* keep the authored sentence unless the admin renamed the trader */
      const patch = { drops: t.ids.slice(), live: true };
      if (t.name && t.name !== row.label) { patch.label = t.name; patch.how = traderHow(t.name, null); }
      return deepFreeze(Object.assign({}, row, patch));
    }
    return row;
  });
  /* a live trader the mirror has never heard of still gets a row — after the known ones */
  if (tr) for (const tid of Object.keys(tr)) if (!seen[tid]) {
    rows.push(deepFreeze(Object.assign(traderRow(tid, tr[tid].name || 'A camp trader', null, tr[tid].ids.slice()), { live: true })));
  }
  return rows;
}
function staplesOf(opts) {
  const l = opts && opts.lootResIds;
  return (Array.isArray(l) && l.length) ? l : STAPLE_IDS;
}
const OPT_KEYS = ['catalog', 'structureSalvage', 'lootResIds', 'traders', 'includeDormant'];
/* "Is this thing itself a catalogue?" is asked BEFORE "is it an options bag?", and the order
   is the fix for a round-2 bug: catalog.js exports a function NAMED `catalog`, so its module
   namespace has an own 'catalog' key and passed the options-bag test. o.catalog then became
   that function, catRow() found nothing on it, and sourcesFor() answered [] — the phantom
   answer — for all 420 ids with no error. `data.loot.sourcesFor(id, data.catalog)` is the
   most natural call in the contract's data bag, so that shape must work.
   The namespace is recognised by byId / CATALOG, never by its `catalog` key. */
function isCatalogue(x) {
  if (!x) return false;
  if (typeof x === 'function') return true;               // the catalog() thunk itself
  if (typeof x !== 'object') return false;
  /* NOT 'has a catalog() function': {catalog: thunk, traders: […]} is a legal options bag and
     must keep its traders. The real namespace is caught by byId / CATALOG; catRow() unwraps a
     function-valued o.catalog either way. */
  return Array.isArray(x) || typeof x.byId === 'function' || Array.isArray(x.CATALOG);
}
function normOpts(opts) {
  if (isCatalogue(opts)) return { catalog: opts };
  if (opts && typeof opts === 'object' && OPT_KEYS.some((k) => own(opts, k) !== undefined)) return opts;
  return { catalog: opts || null };   // a bare {id: row} map, to match isLootable(resId, catalog)
}

/* Can the whole-table pools ('exotic' / 'all') roll `id` — i.e. is it a SALVAGE_RES row?
   -> true | false | null (null = cannot know).
   With a catalogue the generated `inLoot` flag is the truth; it also covers admin custom
   resources. WITHOUT one this file only vouches for ids it names itself: every id in a
   drops list is a salvage row (the audit re-checks that against index.html), the ids in
   NOT_IN_SALVAGE are not, and for anything else the honest answer is "unknown". */
function inSalvage(id, catalog, rows) {
  if (catalog) { const r = catRow(catalog, id); return !!(r && r.inLoot); }
  if (NOT_IN_SALVAGE.indexOf(id) >= 0) return false;
  for (const row of rows) if (row.drops && row.drops.indexOf(id) >= 0) return true;
  return null;
}

/* sourcesFor(resId, opts?) -> best-first list.
   opts = {catalog, structureSalvage, lootResIds, traders, includeDormant} or a bare catalogue.
   ORDER, and why: a player asking "where do I get medicine" wants the place where medicine
   is the POINT (hospital ruins) before the place where it is one possible roll, and both
   before "any chest, if you are lucky". So (see RANK):
     0 themed, cannot come up empty   1 themed, one of several   2 staple pool
     3 buy from a trader              4 the body exotic roll     5 whole-table pools
   Each returned row is a frozen copy carrying `via` (which rank matched) and, where a
   harvest mode can target the id on that row, `tip` (the LOOT_MODIFIERS sentence).
   ANSWERS THAT ARE NOT SOURCES — always exactly one marker row, so a view needs no branch:
     {notLootable:true, madeBy,  the ten plant-side ids. madeBy is a FACILITY key;
      madeByBiz}                 madeByBiz is the business node id to link (FACILITY_OWNER)
     {unverified:true}           no catalogue was passed and nothing here names the id
   [] = a phantom id, an id the catalogue does not know, or a non-string. */
export function sourcesFor(resId, opts) {
  if (typeof resId !== 'string' || !resId) return [];
  const id = resId;
  const o = normOpts(opts);
  const catalog = o.catalog || null;
  if (PHANTOM_IDS.indexOf(id) >= 0) return [];
  if (catalog && !catRow(catalog, id)) return [];
  const rows = resolveSources(o);
  const staples = staplesOf(o);
  const isStaple = staples.indexOf(id) >= 0;
  const salv = inSalvage(id, catalog, rows);
  const tip = HARVEST_TARGETS.indexOf(id) >= 0 ? HARVEST_TIP : null;
  const out = [];
  for (const row of rows) {
    if (row.dormant && !o.includeDormant) continue;
    let via = null;
    if (row.drops) {
      if (row.drops.indexOf(id) < 0) via = null;
      else if (row.kind === 'buy') via = 'buy';
      else via = (row.always && row.always.indexOf(id) >= 0) ? 'always' : 'drops';
    } else if (row.pool === 'staples') { if (isStaple) via = 'staples'; }
    else if (row.pool === 'exotic') { if (salv === true && !isStaple) via = 'exotic'; }
    else if (row.pool === 'all') { if (salv === true) via = 'all'; }
    if (!via) continue;
    const copy = Object.assign({}, row, { via });
    /* the tip rides only rows where the mode really targets this id: a themed body/ruin
       haul. On the exotic row the same menu THINS the exotics, so no tip there. */
    if (tip && row.harvest && row.drops) copy.tip = tip;
    out.push(Object.freeze(copy));
  }
  if (!out.length) {
    if (own(MADE_NOT_LOOTED, id) || salv === false) return [notLootableMarker(id)];
    return [unverifiedMarker(id)];
  }
  return out.map((r, i) => [r, i])
    .sort((a, b) => (RANK[a[0].via] - RANK[b[0].via]) || (a[1] - b[1]))
    .map((p) => p[0]);
}
const HARVEST_TARGETS = LOOT_MODIFIERS[0].targets;
const HARVEST_TIP = LOOT_MODIFIERS[0].how;

function notLootableMarker(id) {
  const m = own(MADE_NOT_LOOTED, id) || null;
  const where = m ? own(FACILITY_WORDS, m.facility) : null;
  const owner = m ? (own(FACILITY_OWNER, m.facility) || null) : null;
  return Object.freeze({
    id: 'none:' + id, notLootable: true, system: null, themed: false, via: 'made',
    label: where ? 'Not lootable — made at ' + where : 'Not lootable',
    how: where
      /* a system owner (the city) BANKS what it makes into the ledger; only a business facility keeps it plant-side */
      ? (owner && String(owner.biz).indexOf('sys:') === 0
        ? 'This never drops in battle or at camp. It is made at ' + where + ' and banked into your stores.'
        : 'This never drops in battle or at camp. It is plant-side stock — it only exists inside ' + where + '.')
      : 'This never drops in battle or at camp, and no maker is recorded for it here.',
    madeBy: m ? m.facility : null,
    /* business node id a view can link to (see FACILITY_OWNER for how sure that is) */
    madeByBiz: owner ? owner.biz : null,
    madeByBizConfidence: owner ? owner.confidence : null,
    cite: m ? m.cite : 'not a SALVAGE_RES row and not in LOOT_RES_IDS @ index.html',
  });
}
/* NOT a player-facing answer: it means the CALLER forgot the catalogue (or mistyped an id).
   A view should render nothing for it and the graph piece should report it as an error. */
function unverifiedMarker(id) {
  return Object.freeze({
    id: 'unverified:' + id, unverified: true, system: null, themed: false, via: 'unverified',
    label: 'Not confirmed',
    how: 'No named source lists this, and without the resource catalogue it cannot be checked against the salvage table.',
    madeBy: null, madeByBiz: null, madeByBizConfidence: null,
    cite: 'pass {catalog} — SALVAGE_RES @ index.html',
  });
}

/* isLootable(resId, catalog) — can ANY loot ROLL in the shipped game hand this id out?
   -> true | false | null. A trader shelf is a purchase, so 'buy' rows do not count.
   null = cannot say (no catalogue and no list here names the id): falsy on purpose, so a
   careless `if (isLootable(x))` fails closed instead of showing a typo as lootable. */
export function isLootable(resId, catalog, opts) {
  /* the catalogue slot gets the same shape tolerance as sourcesFor(): a caller holding an
     options bag will pass it here too, and treating that as a catalogue answers false. */
  const merged = Object.assign({}, opts || {}, normOpts(catalog));
  if (!merged.catalog && opts && opts.catalog) merged.catalog = opts.catalog;
  const s = sourcesFor(resId, merged);
  if (s.length === 1 && s[0].unverified) return null;
  return s.some((r) => !r.notLootable && !r.unverified && r.kind !== 'buy');
}

/* The one-argument test other pieces inject (coverage.lootNeedsOf(node, lootable) calls
   lootable(id) with NOTHING else). Handing it bare isLootable would drop the catalogue, and
   every exotic would come back null -> filtered out, silently. Bind the catalogue here. */
export function lootableWith(catalog, opts) {
  return (id) => isLootable(id, catalog, opts) === true;
}

/* Ids with at least one THEMED LOOT source — loot a business can sensibly be told to go and
   fetch. coverage/proposal can use it to prefer needs a player can target over lottery drops.
   Trader shelves are excluded (buyableIds() below): "go and buy it" is not "go and loot it". */
export function themedIds(opts) {
  const seen = {};
  for (const row of resolveSources(opts)) if (row.themed && row.drops && row.kind !== 'buy' && !row.dormant) for (const d of row.drops) seen[d] = true;
  return Object.keys(seen);
}
export function buyableIds(opts) {
  const seen = {};
  for (const row of resolveSources(opts)) if (row.kind === 'buy') for (const d of row.drops) seen[d] = true;
  return Object.keys(seen);
}

/* Modifiers that touch a given source row (by its flags) — for a modal's small print. */
export function modifiersFor(row) {
  if (!row) return [];
  return LOOT_MODIFIERS.filter((m) => row[m.appliesTo] === true);
}

export function sourceById(id) {
  for (const r of LOOT_SOURCES) if (r.id === id) return r;
  return null;
}
