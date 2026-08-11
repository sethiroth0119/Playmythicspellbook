/* ============================================================================
   WARPATH — content tables.
   ----------------------------------------------------------------------------
   The generator (warpath-mapgen.js) decides WHERE things are. This file decides
   WHAT they are: the starter deck you walk in with, the camp you build, the
   three recruitment pools, and the discovery tables the biomes draft from.

   ⚠ EVERY CARD KEY HERE MUST RESOLVE IN THE LIVE GAME.
   Keys are the game's own `kind:id` deck keys (public/index.html:53587,
   `resolveDeckCard`). They are drawn from the real built-in catalogs —
   UNIT_CARDS / SPELL_CARDS / TRAP_CARDS / LOCATION_CARDS / WEATHER_CARDS — so a
   Warpath deck loads in the existing battle engine with no engine change at
   all, and an extracted card lands in Profile.cardCollection like any other.
   If you add a key here, it must already exist in one of those catalogs.

   WHY NO WARPATH-EXCLUSIVE CARDS YET. The brief wants cards you can ONLY get
   out here ("Corpse Collector — Warpath Exclusive"). Minting one means writing
   a new card into the game's catalog, and the catalog lives inside the 215k-line
   production monolith. Milestone 1 therefore expresses exclusivity the safe way
   — through WHERE a card can be drafted and how scarce it is — and records an
   `acquisition: 'warpath'` provenance tag on every grant so a real exclusive
   set can be introduced later without re-plumbing anything. This is a
   deliberate Milestone-1 omission, not an oversight.
   ========================================================================= */
(function (root) {
'use strict';

/* ── The starting expedition deck ─────────────────────────────────────────
   The brief: "Players enter with Hero + small starter deck — maybe around
   20-30 basic cards, rather than bringing their competitive deck."

     Hero        1   (chosen at the gate, not listed here)
     Units      10
     Triggers    4   (the game's Trap cards)
     Resources   8   (the game's Location cards — its resource/field layer)
     Equipment   2   (the game's Spell cards — the closest existing analogue)
     ----------------
     Total      25

   The engine wants DECK_SIZE (40) cards to deal a full game, so the battle
   bridge pads a short Warpath pool on the way into a battle — see
   `warpathPadDeck` in public/index.html. The player still only OWNS what they
   have drafted; padding is a battle-time courtesy, never added to the pool. */
var STARTER_POOL = [
  // 10 units — deliberately unexciting. This deck is supposed to feel thin.
  'unit:goblin', 'unit:goblin', 'unit:wolf', 'unit:wolf', 'unit:archer',
  'unit:orc', 'unit:spider', 'unit:priest', 'unit:sprite', 'unit:golem',
  // 4 triggers
  'trap:spikes', 'trap:snare', 'trap:caltrops', 'trap:bearTrap',
  // 8 resources
  'location:forest', 'location:forest', 'location:manaFont', 'location:manaFont',
  'location:altar', 'location:holySpring', 'location:watchtower', 'location:mire',
  // 2 equipment
  'spell:mend', 'spell:bolt',
];

/* The progression the brief describes: 25 → 31 → 38 → 46 → 52 → 60. These are
   the thresholds the camp HUD shows, so a player can see how far they are from
   a real deck. FULL is DECK_SIZE in the main game. */
var DECK_MILESTONES = [25, 31, 38, 46, 52, 60];
var DECK_FULL = 40;

/* ── The Expedition Camp ──────────────────────────────────────────────────
   The brief's layout:

                 WATCHTOWER
                     │
    BLACKSMITH ── CAMPFIRE ── SUPPLY TENT
                     │
              RECRUITMENT TENT

   The campfire exists from the moment you pitch camp; everything else has to
   be built out of what you gather. Camp upgrades are how you steer the draft:
   you cannot afford all of them in one run, so choosing the Recruitment Tent
   over the Blacksmith IS the deckbuilding decision.                          */
var CAMP_BUILDINGS = {
  campfire: {
    id: 'campfire', name: 'Campfire', icon: '🔥', slot: 'centre', maxLevel: 1,
    desc: 'The camp itself. Rest here to recover Hero HP between fights.',
    levels: [{ cost: {}, effect: 'Camp established. Rest restores 25% HP per turn spent here.' }],
  },
  recruitment: {
    id: 'recruitment', name: 'Recruitment Tent', icon: '⛺', slot: 'south', maxLevel: 3,
    desc: 'Gates which Units you may recruit. The single biggest lever on your deck.',
    levels: [
      { cost: { wood: 30, food: 20 },              effect: 'Recruit Rank 1-2 Units (cost 1-2).' },
      { cost: { wood: 60, iron: 20, food: 40 },    effect: 'Recruit Rank 3-4 Units (cost 3-4).' },
      { cost: { wood: 90, iron: 50, essence: 30 }, effect: 'Recruit Rank 5 Units. The big ones talk to you now.' },
    ],
  },
  blacksmith: {
    id: 'blacksmith', name: 'Blacksmith', icon: '🔨', slot: 'west', maxLevel: 3,
    desc: 'Crafts Equipment from ore. Nothing here walks, but everything here helps.',
    levels: [
      { cost: { stone: 30, iron: 15 },              effect: 'Craft Basic Equipment.' },
      { cost: { stone: 60, iron: 40 },              effect: 'Craft Rare Equipment.' },
      { cost: { stone: 90, iron: 70, essence: 25 }, effect: 'Craft Legendary Equipment.' },
    ],
  },
  supply: {
    id: 'supply', name: 'Supply Tent', icon: '🎒', slot: 'east', maxLevel: 3,
    desc: 'The Expedition Vault. Loot you have not secured here can be taken from you.',
    levels: [
      { cost: { wood: 20, food: 10 },              effect: 'Vault: 5 secured slots.' },
      { cost: { wood: 45, stone: 30 },             effect: 'Vault: 10 secured slots.' },
      { cost: { wood: 70, stone: 55, iron: 30 },   effect: 'Vault: 20 secured slots.' },
    ],
  },
  watchtower: {
    id: 'watchtower', name: 'Watchtower', icon: '🗼', slot: 'north', maxLevel: 2,
    desc: 'Burns the fog back around camp, and spots heroes moving near it.',
    levels: [
      { cost: { wood: 40, stone: 20 },             effect: '+5 vision around camp. Enemy camps within 8 tiles are reported.' },
      { cost: { wood: 70, stone: 50, iron: 25 },   effect: '+7 vision. Hero vision +1 everywhere.' },
    ],
  },
  arcane: {
    id: 'arcane', name: 'Arcane Tent', icon: '🔮', slot: 'northeast', maxLevel: 2,
    desc: 'Researches Triggers. Essence in, strange ideas out.',
    levels: [
      { cost: { essence: 25, wood: 20 },           effect: 'Research Basic Triggers.' },
      { cost: { essence: 60, iron: 30 },           effect: 'Research Rare Triggers. Extraction takes one turn less.' },
    ],
  },
};
var CAMP_BUILD_ORDER = ['campfire', 'recruitment', 'blacksmith', 'supply', 'watchtower', 'arcane'];

// Vault capacity by Supply Tent level. Level 0 = no tent = you are carrying
// everything, and everything you carry can be lost.
var VAULT_SLOTS = [0, 5, 10, 20];

// Hero vision, in tiles (Chebyshev). The brief: "Your Hero has maybe 2-tile
// vision. Scouts: +3. Watchtower: +5 around camp."
var BASE_VISION = 2;
var CAMP_VISION = [0, 0, 0];        // by watchtower level: no tower reveals nothing extra
var WATCHTOWER_VISION = [0, 5, 7];

/* ── Recruitment pools ────────────────────────────────────────────────────
   The brief's example is the Goblin Encampment: three recruits, priced so you
   cannot take all three. That "you only have 75 Food" moment is the draft.

   Costs are in EXPEDITION resources and are tuned so a fresh camp can afford
   roughly one and a half recruits at a site — which is exactly the pick-1-of-3
   pressure the mode is built on. `rank` gates against the Recruitment Tent
   level, so a Tent I camp physically cannot take the commander.             */
var RECRUIT_POOLS = {
  forest_hollow: {
    site: 'forest_hollow',
    flavour: 'Something has been following you since the treeline. Three of them step out.',
    offers: [
      { key: 'unit:wolf',    rank: 1, cost: { food: 30 },                label: 'Dire Wolf',      note: 'Hunts in packs. Cheap, fast, disposable.' },
      { key: 'unit:spider',  rank: 2, cost: { food: 40, essence: 10 },   label: 'Giant Spider',   note: 'Venomous. Opens the poison line.' },
      { key: 'unit:troll',   rank: 4, cost: { food: 100, gold: 50 },     label: 'Cave Troll',     note: 'Regenerates. Eats like four wolves.' },
    ],
  },
  barrow_gate: {
    site: 'barrow_gate',
    flavour: 'The gate is open. It was not open a moment ago. Three shapes are waiting to be asked.',
    offers: [
      { key: 'unit:spider',  rank: 1, cost: { essence: 18 },             label: 'Crypt Spider',   note: 'The dead keep spiders. Nobody knows why.' },
      { key: 'unit:lich',    rank: 3, cost: { essence: 45, gold: 30 },   label: 'Lich Apprentice', note: 'Lifesteal. The graveyard archetype starts here.' },
      { key: 'unit:golem',   rank: 3, cost: { essence: 35, stone: 40 },  label: 'Bone Golem',     note: 'Thorns. Built from what was lying around.' },
    ],
  },
  assembly_floor: {
    site: 'assembly_floor',
    flavour: 'Half-finished constructs on the line. The fabricator is still running. It asks for iron.',
    offers: [
      { key: 'unit:sprite',  rank: 2, cost: { iron: 20, essence: 10 },   label: 'Ignition Wisp',  note: 'Flying. Magic damage from turn one.' },
      { key: 'unit:ice',     rank: 3, cost: { iron: 35, essence: 25 },   label: 'Coolant Elemental', note: 'Flying, high resist. Holds a line alone.' },
      { key: 'unit:paladin', rank: 4, cost: { iron: 60, gold: 40 },      label: 'Ouroboros Sentinel', note: 'Tough. The best body you will see out here.' },
    ],
  },
};

/* ── Discovery tables ─────────────────────────────────────────────────────
   "Explore → Discover Opportunity → Make Choice → Add Card → Continue."
   Stepping onto an undiscovered tile in a pack biome can open an ENCOUNTER:
   three cards, pick one. This is the booster pack, and the biome is the set.

   Weights are per-card within the biome. The chance of an encounter firing at
   all is `encounterChance`; the server rolls it from the tile hash so it is
   the same for everyone and cannot be re-rolled by reloading.               */
var DISCOVERY = {
  forest: {
    encounterChance: 16,
    title: 'THE WOOD OFFERS',
    cards: [
      ['unit:wolf', 20], ['unit:troll', 8], ['unit:spider', 16], ['unit:archer', 14],
      ['trap:razorVines', 12], ['trap:snare', 12], ['trap:plagueBloom', 8], ['trap:sleepPowder', 8],
      ['location:forest', 18], ['location:poisonBog', 10], ['location:mire', 10],
      ['spell:frostwind', 6], ['spell:tarPit', 8],
    ],
  },
  graveyard: {
    encounterChance: 18,
    title: 'SOMETHING SITS UP',
    cards: [
      ['unit:lich', 12], ['unit:spider', 14], ['unit:golem', 12], ['unit:priest', 8],
      ['trap:soulSnare', 14], ['trap:hexSigil', 12], ['trap:boneCrusher', 12], ['trap:plagueSpore', 10],
      ['location:cursedEarth', 16], ['location:necropolis', 10], ['location:altar', 12],
      ['weather:bloodmoon', 5], ['weather:eclipse', 5],
    ],
  },
  facility: {
    encounterChance: 17,
    title: 'A CABINET UNSEALS',
    cards: [
      ['unit:xenoDrone', 14], ['unit:hiveDrone', 12], ['unit:parasiteHost', 8], ['unit:ice', 12],
      ['trap:staticMine', 14], ['trap:nullGlyph', 12], ['trap:aetherNet', 12], ['trap:xenoBurst', 8],
      ['location:medicalCenter', 12], ['location:siphoned', 10], ['location:manaFont', 12],
      ['spell:arcaneInsight', 8], ['spell:suppressAwakening', 5],
    ],
  },
  mountain: {
    encounterChance: 15,
    title: 'THE MOUNTAIN NOTICES YOU',
    cards: [
      ['unit:orc', 16], ['unit:troll', 12], ['unit:golem', 14], ['unit:paladin', 8], ['unit:broodTyrant', 3],
      ['trap:magmaVent', 16], ['trap:flameBurst', 14], ['trap:spikes', 10],
      ['location:lava', 16], ['location:forgeAnvil', 12], ['location:bastion', 10],
      ['spell:fireblast', 10], ['spell:wrath', 6],
    ],
  },
  plains: {
    encounterChance: 9,
    title: 'A TRAVELLER STOPS',
    cards: [
      ['unit:goblin', 20], ['unit:archer', 16], ['unit:orc', 14], ['unit:priest', 12],
      ['trap:caltrops', 14], ['trap:bearTrap', 12], ['trap:snare', 10],
      ['location:watchtower', 14], ['location:holySpring', 12], ['location:forest', 12],
      ['spell:rally', 10], ['spell:mend', 10],
    ],
  },
  wastes: {
    encounterChance: 11,
    title: 'BURIED, BUT NOT DEEPLY',
    cards: [
      ['unit:golem', 16], ['unit:goblin', 14], ['unit:ice', 10], ['unit:lich', 8],
      ['trap:frostGlyph', 14], ['trap:mirePit', 12], ['trap:caltrops', 12],
      ['location:sandstormDunes', 16], ['location:mire', 12], ['location:bastion', 10],
      ['weather:sandstorm', 8], ['weather:mistveil', 6],
    ],
  },
};

/* ── Extraction ───────────────────────────────────────────────────────────
   "You don't keep every card you draft." A normal run in the brief is
   ~40 discovered → 8-12 permanently extracted. The cap is what makes the
   Warpath sit alongside packs instead of replacing them.

   Capacity comes from the camp: a base allowance, plus the Supply Tent.
   Everything above the cap is left behind, and the player chooses what to
   keep on the extraction screen.                                            */
var EXTRACT_BASE_CARDS = 6;
var EXTRACT_CARDS_PER_VAULT_LEVEL = 3;   // Supply Tent I/II/III → +3/+6/+9
var EXTRACT_TURNS = 2;                   // "extraction could take 1-3 turns"

// Entry costs. AZA buys ENTRY, never power — the reward tables above do not
// look at how the player got in. That is the no-pay-to-win rule, expressed as
// the absence of a branch rather than a comment.
var ENTRY = {
  ticket_cost: 1,
  aza_cost: 3,
  turns_per_run: 60,          // a run is bounded; the world closes
  moves_per_turn: 6,          // movement points, spent against tile moveCost
};

// Losing a battle. "Losing shouldn't erase everything." You drop UNSECURED
// carry, your hero is injured, and you wake up at your own camp.
var LOSS = {
  carry_loss_pct: 50,         // of unsecured expedition resources
  carry_material_loss: 1,     // unsecured extraction materials dropped
  hero_injured_turns: 2,      // reduced movement while injured
  retreat_to_camp: true,
};

root.WarpathData = {
  STARTER_POOL: STARTER_POOL,
  DECK_MILESTONES: DECK_MILESTONES, DECK_FULL: DECK_FULL,
  CAMP_BUILDINGS: CAMP_BUILDINGS, CAMP_BUILD_ORDER: CAMP_BUILD_ORDER,
  VAULT_SLOTS: VAULT_SLOTS,
  BASE_VISION: BASE_VISION, CAMP_VISION: CAMP_VISION, WATCHTOWER_VISION: WATCHTOWER_VISION,
  RECRUIT_POOLS: RECRUIT_POOLS,
  DISCOVERY: DISCOVERY,
  EXTRACT_BASE_CARDS: EXTRACT_BASE_CARDS,
  EXTRACT_CARDS_PER_VAULT_LEVEL: EXTRACT_CARDS_PER_VAULT_LEVEL,
  EXTRACT_TURNS: EXTRACT_TURNS,
  ENTRY: ENTRY, LOSS: LOSS,
};

})(typeof module !== 'undefined' && module.exports ? module.exports : (typeof window !== 'undefined' ? window : this));
