/* catalog.js — the one place the Supply Chain feature asks "what is this resource id?".

   PURE: no window, no DOM, no bridge import — Node tests and critics import it directly.
   The rows come from catalog.snapshot.js, which is GENERATED from index.html + chain.js
   (tools/supplychain/gen-catalog.mjs). Nothing in this file retypes a name or an icon.

   WHY withLive() EXISTS
   RESOURCES / SALVAGE_RES are lexical globals in index.html, so a module can only see
   them through SupplyChainBridge. The snapshot is what Node sees; at runtime the caller
   passes the bridge's rows to withLive() and THOSE win. That matters for real: admins add
   custom resources (Forge.customResources is pushed into SALVAGE_RES after boot), and a
   snapshot that is one deploy stale must never make the feature disagree with the game.

   PROVENANCE ON EVERY ROW
   row.from = { name, icon, color } names the SOURCE TABLE behind each display field
   ('ledger' | 'loot' | 'chain' | 'shipyard', or 'live' once the bridge overrides it;
   color is null when no table coloured the id and the family fill supplied one — that is
   what row.colorFrom:'family' means). Name and icon always share a table; colour has its
   own precedence because SALVAGE_RES rows carry no colour, so 7 ids wear the loot table's
   icon and chain.js's colour while the two tables disagree about the thing (medicalSupplies
   is 🥫 in loot and 💊 in chain). Those rows carry mixedSource:true and are listed in
   CATALOG_META.mixedSourceRows, so a view can mark them instead of silently labelling
   "Medical Supplies" with a food tin.

   A "catalog" everywhere in this feature is the object returned by makeCatalog() /
   withLive(): { rows, meta, byId(id), has(id), all(), family(id), colorOf(id), isPhantom(id) }.
   The module-level byId / all / family are the same thing over the bare snapshot.

   TWO LOOT FLAGS, NOT ONE — read before touching either
     inLoot  the id has a row in SALVAGE_RES: chests, field bags, world / mission salvage
             and every other whole-table roll can produce it.
     staple  the id is in LOOT_RES_IDS, the 14-id weighted pool camp missions, containers
             and the smuggler pay from.
   They overlap on 13 ids and differ on energyDrink (a staple with no SALVAGE_RES row).
   Round 1 treated the allow-list as "is lootable" at runtime, so the live catalogue said
   10 ledger ids were unlootable while its own meta said 11, and loot.js showed the player
   four energyDrink sources that cannot drop it.

   A THIRD FLAG: inShipyard — WF_REPAIR_RESOURCES (planking, rivets, pitch, hullPlates)
   Round 1 left these four OUT as "a private stockpile, so it cannot ride a supply lane".
   That was backwards. "Fishing company" is a business the owner DREW on PDF p7 with a
   Transport icon, and WF_REPAIR_RECIPE is the only material demand it declares anywhere —
   so leaving them out made the modal's "what they need to start" empty for a tile on the
   owner's own map, and hid four lanes that are pure demand with no producer (Lumber ->
   planking, Metal -> rivets, Oil -> pitch, Steel -> hullPlates), which is exactly the
   Transport story the map is supposed to reveal. They are rows now; inShipyard says the
   stock is held on Profile.fishingCorp.resources rather than in camp storage, and
   shipping.js decides what that means for a lane. CATALOG_META.shipyardDemand carries the
   recipe's own id list so nothing downstream retypes it.

   COMPLETENESS IS A CHECK, NOT A PROMISE
   unaccounted() compares CATALOG_META.otherTables (every OTHER id-bearing table the
   generator knows: the admin restock whitelist, the Warpath tables, the fishing stockpile
   seed) against the rows, PHANTOMS and LOCAL_TABLES below, and returns what nobody has
   accounted for. The generator exits 4 on a non-empty result. Round 1's phantom list was
   hand-found and missed three ids on a line it had already read; this makes the next miss
   a failure instead of a lucky grep. */
import { CATALOG, CATALOG_META } from './catalog.snapshot.js';

/* ── PHANTOMS ──────────────────────────────────────────────────────────────────────
   Ids the game's own data names but NO catalogue defines. They render as a nameless box
   wherever they surface. They are listed so the UI can flag them and so every sibling
   piece can refuse to use one as a need (contract hard rule 4) — they are deliberately
   NOT rows, because a row would make "every resource has a use" quietly include a thing
   no player can hold. Cites are by symbol: index.html line numbers move daily.
   near = the closest REAL id, only where one honestly exists (null otherwise — the
   catalogue has no lubricant and no sulfur of any kind); familyReport() checks it.
   Whether gunOil becomes a real resource is an owner call (OWNER_DECISIONS.md). */
export const PHANTOMS = Object.freeze([
  Object.freeze({ id: 'gunOil', near: null,
    evidence: 'Yielded by the Oil Company (OPS_ECON.oil.yields, index.html) and consumed by Weapon Smith '
      + '(src/weaponsmith/blueprints.js, parts.js), but it has no row in RESOURCES, SALVAGE_RES or chain.js.' }),
  Object.freeze({ id: 'sulfur', near: null,
    evidence: 'A cost in CRAFTING_RECIPES_DEFAULT and item-shop restockCost (index.html); no catalogue row, no producer.' }),
  Object.freeze({ id: 'gold', near: 'goldOre',
    evidence: 'A cost in CRAFTING_RECIPES_DEFAULT and restockCost (index.html); the catalogue only has goldOre and goldBars.' }),
  Object.freeze({ id: 'organs', near: 'syntheticOrgans',
    evidence: 'A mission reward (index.html); no catalogue row. syntheticOrgans is a different, real id.' }),
  /* The three that were sitting on the SAME LINE as gold and sulfur. _CS_RESOURCE_KEYS is
     the admin whitelist of legal restock-cost keys, so an admin can price an item in any
     of them; five of the thirteen name nothing the catalogue has. withLive() would append
     an admin-picked id as custom:true at runtime, but the snapshot must still say out loud
     that the game can ask for these and no player can hold one. */
  Object.freeze({ id: 'silver', near: 'silverOre',
    evidence: 'Legal restock-cost key (_CS_RESOURCE_KEYS, index.html); no catalogue row. '
      + 'The catalogue has silverOre and silverFragments — neither is "silver".' }),
  Object.freeze({ id: 'crystal', near: null,
    evidence: 'Legal restock-cost key (_CS_RESOURCE_KEYS, index.html); no catalogue row. There are four '
      + 'crystals (arcaneCrystal, etherCrystals, crystalDust, iceCrystals) and no honest "the" one.' }),
  Object.freeze({ id: 'gems', near: null,
    evidence: 'Legal restock-cost key (_CS_RESOURCE_KEYS, index.html). It is not a resource at all: Profile.gems '
      + 'is CINDER, the currency, spent through spendGems(). A restock cost keyed `gems` is a currency cost '
      + 'wearing a resource\'s clothes — never draw it as cargo.' }),
  Object.freeze({ id: 'cinder', near: null,
    evidence: 'A key in the fishing stockpile (ensureFishingCorp) and in every WF_REPAIR_RECIPE tier, '
      + 'but it is the CURRENCY, not a resource: the drydock debits Profile.gems. Same thing as the `gems` '
      + 'key above under the player-facing name. It must never be drawn as cargo on a lane.' }),
  /* Seeded onto every fishing stockpile and named by no resource table anywhere. */
  Object.freeze({ id: 'indust', near: null,
    evidence: 'Seeded on Profile.fishingCorp.resources (ensureFishingCorp, index.html) alongside cinder/metal/wood, '
      + 'but no table gives it a name or an icon and nothing reads it. A stockpile key with no resource behind it.' }),
]);
const PHANTOM_IDS = new Set(PHANTOMS.map((p) => p.id));

/* ── LOCAL_TABLES ──────────────────────────────────────────────────────────────────
   Whole id namespaces the game keeps SEPARATE from the ledger. They are not phantoms —
   they have real names and icons in their own file — and they are not rows, because they
   belong to a different economy. Listing them is how the audit can say "these twelve are
   accounted for" instead of looking like it missed them.
   Each entry carries a short stable `id`: a consumer that indexes this list keys off that,
   never off `symbol` (which is a human sentence containing a file path, and which changes
   the day the file moves). */
export const LOCAL_TABLES = Object.freeze([
  Object.freeze({ id: 'warpathMap', symbol: 'RESOURCES (public/warpath/warpath-mapgen.js)',
    ids: Object.freeze(['wood', 'stone', 'iron', 'food', 'essence', 'gold',
      'dragon_heart', 'void_crystal', 'celestial_ore', 'ancient_bone', 'ouroboros_core', 'kalon_fragment']),
    why: 'The Warpath roguelite map\'s own resource table: expedition resources plus the six extraction '
      + 'materials (WARPATH_MATERIALS, index.html), which do travel with the player. It is a parallel '
      + 'namespace, not this one — Warpath\'s `gold` is "Expedition Gold" and its `wood`/`stone`/`food` are '
      + 'map nodes, not ledger rows. No business consumes any of them, so promoting them would make '
      + '"every resource has a use" a claim about two economies at once. Whether the six extraction '
      + 'materials should become tradeable is an owner call (OWNER_DECISIONS.md).' }),
]);
const LOCAL_IDS = new Set(LOCAL_TABLES.flatMap((t) => t.ids));

/* ── FAMILIES ──────────────────────────────────────────────────────────────────────
   A coarse THEME family per id, so coverage.js can say "the medical company wants
   textiles and chemicals" and shipping.js can pick a cargo class, without either of them
   keeping its own 424-row table. UI chrome colours belong to the design palette; a RESOURCE's
   own colour is data, and FAMILY_SWATCH below only ever borrows one from a real row.

   Resolution order, first hit wins:
     1. ID_FAMILY     explicit, for ids where the keyword guess is wrong or the theme is
                      the whole point (cloth/cotton/wool -> textile is the owner's own
                      example: fashion makes cloth, ships it to medical).
     2. CAT_FAMILY    the chain.js category, when the id is in the chain.
     3. KEYWORDS      on the id split into words — this is what classifies the ~150
                      hand-authored loot exotics AND any admin custom id that did not
                      exist when this file was written.
     4. 'misc'        reported by familyReport() so a critic can see it, never hidden.
   REJECTED: one explicit row per id. It reads as more exact, but it is a second
   hand-typed catalogue that silently misses every id added after today. */
export const FAMILIES = Object.freeze([
  { id: 'water',        label: 'Water' },
  { id: 'food',         label: 'Food & Drink' },
  { id: 'farm',         label: 'Crops & Livestock' },
  { id: 'textile',      label: 'Textiles & Hides' },
  { id: 'timber',       label: 'Timber & Paper' },
  { id: 'ore',          label: 'Ore & Minerals' },
  { id: 'energy',       label: 'Fuel & Power' },
  { id: 'construction', label: 'Construction' },
  { id: 'metal',        label: 'Metals' },
  { id: 'chemical',     label: 'Chemicals' },
  { id: 'machinery',    label: 'Machinery & Tools' },
  { id: 'electronics',  label: 'Electronics & Robotics' },
  { id: 'vehicle',      label: 'Vehicles & Aerospace' },
  { id: 'consumer',     label: 'Consumer Goods' },
  { id: 'medical',      label: 'Medical' },
  { id: 'bio',          label: 'Biological Samples' },
  { id: 'waste',        label: 'Waste & Recycling' },
  { id: 'cards',        label: 'Card Production' },
  { id: 'anomalous',    label: 'Anomalous & Containment' },
  { id: 'security',     label: 'Arms & Security' },
  { id: 'civic',        label: 'Survival & Civic Supply' },
  { id: 'marine',       label: 'Shipyard & Marine' },
  { id: 'trade',        label: 'Valuables & Trade Tokens' },
  { id: 'knowledge',    label: 'Data & Blueprints' },
  { id: 'misc',         label: 'Unsorted' },
].map(Object.freeze));
const FAMILY_IDS = new Set(FAMILIES.map((f) => f.id));

/* ── COLOUR FOR ROWS THE SOURCE NEVER COLOURED ─────────────────────────────────────
   126 of the 424 rows — every one a loot-only exotic — have no colour in any source table
   (SALVAGE_RES rows carry none). The contract row shape promises `color`, and three views
   (3D cargo, hover card, modal) would otherwise each invent a fallback and disagree.
   So the catalog fills it, ONCE, and says so: row.color is always a string, and
   row.colorFrom is 'source' or 'family'. The raw CATALOG export keeps null = "the game
   has no colour for this", which is the truth the generator found.
   No hex is typed here. Each family names an EXEMPLAR id and borrows that row's source
   colour, so the fill moves with the game's own palette; familyReport() fails an exemplar
   that is missing, uncoloured, or an outsider to a family that has coloured rows of its
   own (trade and misc have none, so they borrow: trade takes the ledger's gold). */
export const FAMILY_SWATCH = Object.freeze({
  water: 'water', food: 'bread', farm: 'corn', textile: 'cloth', timber: 'wood', ore: 'stone',
  energy: 'fuel', construction: 'asphalt', metal: 'metal', chemical: 'acids', machinery: 'machineParts',
  electronics: 'electronicComponents', vehicle: 'cars', consumer: 'appliances', medical: 'medicine',
  bio: 'dna', waste: 'residentialWaste', cards: 'cardStock', anomalous: 'corruptedEssence',
  security: 'ammo', civic: 'officeSupplies', trade: 'supplies', knowledge: 'researchEquipment', misc: 'slop',
  marine: 'hullPlates',
});

const CAT_FAMILY = Object.freeze({
  water: 'water', agriculture: 'farm', fishing: 'food', food: 'food', forestry: 'timber',
  minerals: 'ore', energy: 'energy', construction: 'construction', metals: 'metal',
  chemicals: 'chemical', machinery: 'machinery', electronics: 'electronics', comms: 'electronics',
  robotics: 'electronics', holographic: 'electronics', vehicles: 'vehicle', aerospace: 'vehicle',
  consumer: 'consumer', medical: 'medical', waste: 'waste', recycling: 'waste', cards: 'cards',
  anomalous: 'anomalous', containment: 'anomalous', security: 'security', civic: 'civic',
});

/* Explicit placements. Each line is here because the generic rules get it wrong or
   because the theme carries a PDF edge. Validated against the snapshot by familyReport()
   so a typo or a retired id shows up instead of rotting. */
const ID_FAMILY = Object.freeze({
  // The textile lane: chain.js files these under agriculture / consumer, which would hide
  // the Fashion Brand -> Transport -> Medical edge the owner asked for by name.
  cloth: 'textile', cotton: 'textile', fabric: 'textile', clothing: 'textile', shoes: 'textile',
  leather: 'textile', plantFiber: 'textile', wool: 'textile', fineWool: 'textile', hide: 'textile',
  feathers: 'textile', monsterHide: 'textile', nanoFiber: 'textile',
  // chain.js files syntheticFiber under chemicals. It is what a fashion house buys when it
  // cannot get cotton, so it belongs on the textile lane, not in a drum of solvent.
  syntheticFiber: 'textile',
  // chain.js category is where the thing is MADE; the family is what it IS. Research kit is
  // lab equipment (chain: containment), sheet aluminium is a metal and a satellite is
  // electronics (chain: aerospace) — left alone they would ride as "Vehicles".
  researchEquipment: 'knowledge', aerospaceAluminum: 'metal', satelliteSystems: 'electronics',
  // Staples with one-word ids the keyword pass cannot read a theme from.
  supplies: 'civic', metal: 'metal', ingots: 'metal', fuel: 'energy', ammo: 'security',
  dna: 'bio', memoryShards: 'anomalous', corruptedEssence: 'anomalous', energyDrink: 'food',
  // Refinery cuts (ledger-only, not in chain.js): all fuel-side streams.
  naphtha: 'energy', kerosene: 'energy', gasOil: 'energy', heavyOil: 'energy', butane: 'energy',
  ethanol: 'energy', reformate: 'energy', alkylate: 'energy', catGasoline: 'energy',
  hydrotreatedCut: 'energy', slop: 'waste', reprocessedSlop: 'waste',
  // Farm grade-2 goods.
  goldEggs: 'farm', primeMeat: 'food', richMilk: 'food', primeSeafood: 'food', rations: 'food',
  monsterParts: 'bio', planks: 'timber', remedies: 'medical', scrapMetal: 'waste',
  // Loot exotics whose id reads as the wrong theme.
  goldBars: 'trade', silverFragments: 'trade', ancientCoins: 'trade', energyGel: 'medical',
  nightmareFuel: 'anomalous', etherFuel: 'anomalous', plasmaOre: 'anomalous', darkMatter: 'anomalous',
  weatherBatteries: 'anomalous', corruptedBlood: 'anomalous', demonFlesh: 'anomalous',
  angelFeathers: 'anomalous', heroShards: 'anomalous', glassShards: 'waste', toxicWaste: 'waste',
  radioactiveMaterial: 'waste', carbonFiber: 'machinery', titanAlloy: 'metal', steelPlating: 'metal',
  purifiedWater: 'water', waterSupplies: 'water', foodSupplies: 'food', militaryRations: 'food',
  medicalHerbs: 'medical', syntheticOrgans: 'medical', neuralGel: 'medical',
  constructionMaterials: 'construction', chemicals: 'chemical', fireSalts: 'chemical',
  miningCharges: 'ore', excavationTools: 'machinery', researchData: 'knowledge', plasticComponents: 'chemical',
  // The drydock's four. Left to the generic rules they scatter: 'Wood Planking' reads as
  // timber, 'Iron Rivets' as metal, and pitch / hullPlates fall through to misc. What they
  // ARE is one business's repair bill; keeping them together is what lets the modal show
  // the Fishing Company one shopping list and shipping.js pick one cargo class.
  planking: 'marine', rivets: 'marine', pitch: 'marine', hullPlates: 'marine',
  // Round-2 blind pass over the 162 non-chain ids (id + family only, no table in view):
  // 'drone' and 'crates' fired before the word that says what the thing is.
  droneBatteries: 'energy', supplyCrates: 'civic',
});

/* Keyword pass. Order matters: the first rule with a matching WORD wins, so the specific
   themes (anomalous, bio, security) sit above the generic material words. Words come
   from splitting the camelCase id plus the display name — never a substring test, which
   is how "oil" would match "foil" and "ore" would match "cores". */
const KEYWORDS = Object.freeze([
  ['anomalous', ['demon', 'relic', 'ether', 'corrupted', 'anomaly', 'anomalous', 'quantum', 'divine', 'chaos', 'void',
    'dimensional', 'gravity', 'time', 'shadow', 'light', 'spirit', 'phantom', 'nightmare', 'ritual', 'scp',
    'containment', 'essence', 'echoes', 'storm', 'frozen', 'lava', 'ice', 'earth', 'nature', 'crystal', 'dust',
    'reality', 'mythic', 'arcane', 'sigils']],
  ['bio', ['bio', 'mutation', 'bone', 'bones', 'beast', 'creature', 'spores', 'fungal', 'virus', 'samples', 'eggs', 'blood', 'flesh']],
  ['knowledge', ['data', 'manuals', 'maps', 'intel', 'blueprint', 'schematics', 'codes']],
  ['trade', ['contraband', 'tokens', 'coins', 'keys', 'trade', 'tags', 'crates', 'market']],
  ['security', ['ammunition', 'weapon', 'armor', 'tactical', 'security', 'radar', 'bunker']],
  // bandage/gauze/… are not ids today. They are here for ADMIN CUSTOM resources: the two
  // lanes the owner named (fashion -> medical) are exactly where a new id is most likely.
  ['medical', ['medical', 'medicine', 'organs', 'herbs', 'bandage', 'bandages', 'gauze', 'splint', 'splints', 'syringe',
    'syringes', 'antidote', 'vaccine', 'serum', 'stimpack']],
  ['electronics', ['ai', 'chips', 'drone', 'nanite', 'cybernetic', 'holo', 'memory', 'signal', 'transmitters', 'beacon',
    'tech', 'wiring', 'limbs']],
  ['energy', ['solar', 'power', 'battery', 'batteries', 'cells', 'reactor', 'generator', 'fusion', 'plasma', 'heat', 'cores',
    'cubes', 'turbine', 'hydro', 'fuel', 'oil', 'gas', 'diesel']],
  ['machinery', ['parts', 'tool', 'tools', 'kits', 'repair', 'cooling', 'units', 'components']],
  ['civic', ['camp', 'survival', 'survivor', 'supplies', 'gear', 'emergency']],
  ['food', ['food', 'rations', 'meat', 'milk', 'seafood', 'fish', 'bread', 'meal', 'meals']],
  ['water', ['water']],
  ['metal', ['steel', 'metal', 'alloy', 'iron', 'copper', 'aluminum']],
  ['ore', ['ore', 'stone', 'stones', 'sand', 'clay', 'gravel']],
  ['timber', ['wood', 'lumber', 'planks', 'paper']],
  ['textile', ['cloth', 'fabric', 'fiber', 'wool', 'leather', 'hide', 'cotton', 'silk', 'denim', 'linen', 'thread',
    'yarn', 'textile', 'textiles', 'canvas', 'velvet', 'garment', 'garments']],
  ['chemical', ['chemical', 'chemicals', 'acid', 'acids', 'salts', 'solvent', 'fluid']],
  ['waste', ['waste', 'scrap', 'slop', 'shards', 'recycled']],
]);

const words = (s) => String(s || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function familyOfRow(row) {
  if (!row) return 'misc';
  // A live row may state its own family (withLive). A one-word custom id with no listed
  // keyword would otherwise land in 'misc' with no way out short of a code change.
  if (row.family && FAMILY_IDS.has(row.family)) return row.family;
  if (ID_FAMILY[row.id]) return ID_FAMILY[row.id];
  if (row.chainCat && CAT_FAMILY[row.chainCat]) return CAT_FAMILY[row.chainCat];
  const w = new Set([...words(row.id), ...words(row.name)]);
  for (const [fam, keys] of KEYWORDS) for (const k of keys) if (w.has(k)) return fam;
  return 'misc';
}

/* ── the catalog object ────────────────────────────────────────────────────────── */
const ROW_KEYS = ['id', 'name', 'icon', 'color', 'colorFrom', 'from', 'altIcon', 'mixedSource', 'inLedger', 'inLoot', 'staple', 'inChain', 'handLoot', 'inShipyard', 'chainCat', 'tier', 'wt'];
const FLAG_KEYS = ['inLedger', 'inLoot', 'staple', 'inChain', 'handLoot', 'inShipyard'];
const isColor = (c) => typeof c === 'string' && c.length > 0;

export function makeCatalog(rows, meta) {
  // Swatches resolve against THESE rows, so a live ledger recolour carries into the fill.
  const srcColor = new Map(rows.map((r) => [r.id, isColor(r.color) && r.colorFrom !== 'family' ? r.color : null]));
  const swatch = (famId) => srcColor.get(FAMILY_SWATCH[famId]) || srcColor.get(FAMILY_SWATCH.misc) || null;
  const list = Object.freeze(rows.map((r) => {
    const own = srcColor.get(r.id);
    return Object.freeze({ ...r, staple: r.staple === true, color: own || swatch(familyOfRow(r)), colorFrom: own ? 'source' : 'family' });
  }));
  const map = new Map(list.map((r) => [r.id, r]));
  const fam = new Map(); // memo: family() is hit once per id per view per frame
  const cat = {
    rows: list,
    meta: meta || CATALOG_META,
    byId: (id) => map.get(id) || null,
    has: (id) => map.has(id),
    all: () => list,
    isPhantom: (id) => PHANTOM_IDS.has(id),
    family(id) {
      if (!fam.has(id)) fam.set(id, familyOfRow(map.get(id)));
      return fam.get(id);
    },
    byFamily: (f) => list.filter((r) => cat.family(r.id) === f),
    // Never null, including for an id the catalogue has never heard of (a phantom on a
    // recipe card still needs a box colour).
    colorOf: (id) => (map.get(id) || {}).color || swatch('misc'),
    familyColor: (f) => swatch(FAMILY_IDS.has(f) ? f : 'misc'),
  };
  return Object.freeze(cat);
}

const SNAPSHOT = makeCatalog(CATALOG, CATALOG_META);

export const catalog = () => SNAPSHOT;
export const byId = (id) => SNAPSHOT.byId(id);
export const has = (id) => SNAPSHOT.has(id);
export const all = () => SNAPSHOT.all();
export const family = (id) => SNAPSHOT.family(id);
export const colorOf = (id) => SNAPSHOT.colorOf(id);
export const isPhantom = (id) => PHANTOM_IDS.has(id);
export const familyLabel = (f) => (FAMILIES.find((x) => x.id === f) || FAMILIES[FAMILIES.length - 1]).label;

/* countsOf(rows, lootRows) — every count the generator reports, recomputed from ROWS.
   withLive() uses it so live meta can never describe a different catalogue than the live
   rows do (round 1 only refreshed `union`, so meta said 11 unlootable while the rows said
   10). lootRows is the one count rows cannot give — it is the raw SALVAGE_RES length
   including the duplicated diesel row — so it is passed in. */
export function countsOf(rows, lootRows) {
  const n = (fn) => rows.filter(fn).length;
  return {
    ledger: n((r) => r.inLedger),
    lootRows,
    lootUnique: n((r) => r.inLoot),
    chain: n((r) => r.inChain),
    union: rows.length,
    handLoot: n((r) => r.handLoot),
    shipyard: n((r) => r.inShipyard),
    ledgerNotLootable: n((r) => r.inLedger && !r.inLoot),
    mixedSource: n((r) => r.mixedSource === true),
    staples: n((r) => r.staple),
    staplesNotInLoot: n((r) => r.staple && !r.inLoot),
    noSourceColor: n((r) => !isColor(r.color) || r.colorFrom === 'family'),
  };
}

/* withLive(live) -> a NEW catalog where runtime rows override the snapshot.
   Accepts what the bridge can give, in any of these shapes (all optional, never throws):
     withLive([{id,name,icon,...}, ...])                        plain rows
     withLive({ resources:[...], salvageRes:[...], lootResIds:[...] })   the bridge trio
   Rules:
     - a live row's name / icon / color / wt replace the snapshot's when present; a live
       row may also carry `family` (a FAMILIES id) to place a custom resource by hand;
     - resources => inLedger, salvageRes => inLoot. These flags only ever turn ON: a
       bridge that is not ready returns [] and must not un-loot 409 ids;
     - lootResIds => `staple` and NOTHING ELSE. It never touches inLoot (see the header:
       that was the round-1 energyDrink bug). A non-empty list is the WHOLE allow-list, so
       it is authoritative both ways — an id dropped from LOOT_RES_IDS stops being a
       staple even when the snapshot is a deploy stale. An empty list means "bridge not
       ready" and the snapshot's staples stand;
     - a staple id that no row defines is NOT invented into a row (it would have no name,
       no icon and no table to live in); it is reported in meta.liveUnknownStaples and by
       familyReport().unknownStaples;
     - an id the snapshot has never seen is APPENDED with custom:true and whatever the
       live row carries — this is the admin custom-resource case;
     - snapshot rows the live lists do not mention are kept untouched. A missing live
       row means "the bridge did not say", not "the game deleted it";
     - phantom ids and rows without a string id are ignored; a bridge bug must not be
       able to promote gunOil into a real resource;
     - meta.counts is recomputed from the merged rows, every field. */
export function withLive(live) {
  const src = Array.isArray(live) ? { rows: live } : (live && typeof live === 'object' ? live : {});
  const arr = (v) => (Array.isArray(v) ? v : []);
  // Start from the RAW snapshot rows (color null where the source has none): makeCatalog
  // re-derives the family fill, so a live recolour of an exemplar is honoured.
  const next = new Map(CATALOG.map((r) => [r.id, { ...r }]));
  const changed = new Set(); let added = 0;

  const apply = (row, flags, origin) => {
    if (!row || typeof row.id !== 'string' || !row.id || PHANTOM_IDS.has(row.id)) return;
    let cur = next.get(row.id);
    if (!cur) {
      // from/mixedSource: a custom row's fields all come from the live bridge, and a
      // bridge row carries one colour and one icon, so it is never mixed-source.
      cur = { id: row.id, name: row.id, icon: '', color: null, inLedger: false, inLoot: false, staple: false,
        inChain: false, handLoot: false, inShipyard: false, chainCat: null, tier: null, wt: null,
        from: Object.freeze({ name: origin, icon: origin, color: origin }), altIcon: null, mixedSource: false, custom: true };
      next.set(row.id, cur); added++;
    }
    for (const k of ['name', 'icon', 'color']) {
      if (typeof row[k] === 'string' && row[k] && row[k] !== cur[k]) {
        cur[k] = row[k]; changed.add(row.id);
        // The provenance has to move with the value, or a row that the LIVE ledger recoloured
        // would still claim chain.js's colour and could read as mixed-source when it is not.
        cur.from = Object.freeze({ ...cur.from, [k]: origin });
        // A changed icon is the one the game now draws, and the OTHER table's glyph cannot
        // be recomputed from the bridge (chain.js is not in the trio), so the recorded
        // alternate is dropped rather than left to claim a conflict that may no longer exist.
        if (k === 'icon') { cur.altIcon = null; cur.mixedSource = false; }
      }
    }
    if (typeof row.wt === 'number' && row.wt !== cur.wt) { cur.wt = row.wt; changed.add(row.id); }
    if (typeof row.family === 'string' && FAMILY_IDS.has(row.family) && row.family !== cur.family) {
      cur.family = row.family; changed.add(row.id);
    }
    // Plain rows may carry their own flags (the fake bridge does); honour true only.
    for (const k of FLAG_KEYS) {
      if ((flags && flags[k]) || row[k] === true) { if (!cur[k]) { cur[k] = true; changed.add(row.id); } }
    }
  };

  // Order = the generator's precedence reversed: salvage first so the ledger's name/icon
  // (what every renderer shows) lands last and wins, exactly as in the snapshot.
  /* The origin label is the TABLE, not the word 'live': fed the real tables, withLive()
     must reproduce the snapshot's provenance exactly (the generator's parity check compares
     row.from), and 7 ledger rows carry a different icon in SALVAGE_RES, so their from.icon
     is rewritten twice on every merge. 'live' is left for plain rows and custom ids, where
     no source table is named. */
  arr(src.salvageRes).forEach((r) => apply(r, { inLoot: true }, 'loot'));
  arr(src.resources).forEach((r) => apply(r, { inLedger: true }, 'ledger'));
  // A plain row's own staple:true is remembered here, because the allow-list pass below
  // is authoritative and would otherwise wipe it.
  const selfStaple = new Set();
  arr(src.rows).forEach((r) => { apply(r, null, 'live'); if (r && r.staple === true && typeof r.id === 'string') selfStaple.add(r.id); });

  const staples = [...new Set(arr(src.lootResIds).filter((id) => typeof id === 'string' && id && !PHANTOM_IDS.has(id)))];
  const unknownStaples = staples.filter((id) => !next.has(id));
  if (staples.length) {
    const set = new Set(staples);
    for (const cur of next.values()) {
      const want = set.has(cur.id) || selfStaple.has(cur.id);
      if (cur.staple !== want) { cur.staple = want; changed.add(cur.id); }
    }
  }

  const rows = [...next.values()];
  const overridden = [...changed].filter((id) => !next.get(id).custom).length;
  const meta = { ...CATALOG_META, live: true, liveOverridden: overridden, liveAdded: added,
    liveUnknownStaples: unknownStaples,
    counts: null };
  /* lootRows: trust the live SALVAGE_RES length only when it can be the whole table. A
     partial list (bridge mid-boot, or a test handing over three custom rows) would give
     lootRows < lootUnique, which is nonsense; then it is the snapshot's raw length plus
     the ids the live data added. */
  const base = CATALOG_META.counts; const svLen = arr(src.salvageRes).length;
  const uniq = rows.filter((r) => r.inLoot).length;
  meta.counts = countsOf(rows, svLen >= uniq ? svLen : base.lootRows + (uniq - base.lootUnique));
  return makeCatalog(rows, meta);
}

/* diffCatalogs(a, b) -> [] when two catalogs agree on the id set, every flag, every
   display field, every family and every count. The generator runs it on snapshot vs
   withLive(the same source arrays) after every write; the runtime probe can run it on
   snapshot vs withLive(bridge) to show "the snapshot is a deploy stale" as a list
   instead of a feeling. */
export function diffCatalogs(a, b) {
  const out = [];
  const keys = ['name', 'icon', 'color', 'colorFrom', 'altIcon', 'mixedSource', 'wt', 'chainCat', 'tier', ...FLAG_KEYS];
  for (const r of a.all()) {
    const o = b.byId(r.id);
    if (!o) { out.push(r.id + ': missing on the right'); continue; }
    for (const k of keys) if (r[k] !== o[k]) out.push(r.id + '.' + k + ': ' + JSON.stringify(r[k]) + ' vs ' + JSON.stringify(o[k]));
    // `from` is the only nested field on a row, so it is compared by value; === would
    // report every id as different because the two catalogs hold different objects.
    if (JSON.stringify(r.from) !== JSON.stringify(o.from)) out.push(r.id + '.from: ' + JSON.stringify(r.from) + ' vs ' + JSON.stringify(o.from));
    if (a.family(r.id) !== b.family(r.id)) out.push(r.id + '.family: ' + a.family(r.id) + ' vs ' + b.family(r.id));
  }
  for (const r of b.all()) if (!a.has(r.id)) out.push(r.id + ': missing on the left');
  const ca = a.meta.counts || {}; const cb = b.meta.counts || {};
  for (const k of new Set([...Object.keys(ca), ...Object.keys(cb)])) if (ca[k] !== cb[k]) out.push('counts.' + k + ': ' + ca[k] + ' vs ' + cb[k]);
  return out;
}

/* unaccounted(cat) — THE COMPLETENESS RECORD.
   CATALOG_META.otherTables is every OTHER id-bearing table the generator can see (the admin
   restock whitelist, WARPATH_MATERIALS, the Warpath map's own RESOURCES, the fishing
   stockpile seeder). An id there is accounted for if it is a catalogue row, a declared
   PHANTOM, or inside a named LOCAL_TABLE. Anything else is a resource source nobody has
   looked at — returned here, printed by the generator, which exits 4.
   WHY A FUNCTION AND NOT A CONSTANT: it runs against the LIVE catalog too, so an admin
   custom resource that happens to be `silver` accounts for itself the moment it exists. */
export function unaccounted(cat = SNAPSHOT) {
  const tables = (cat.meta && cat.meta.otherTables) || {};
  const seen = new Map();
  for (const [key, t] of Object.entries(tables)) {
    for (const id of (t && t.ids) || []) {
      if (typeof id !== 'string' || !id) continue;
      if (cat.has(id) || PHANTOM_IDS.has(id) || LOCAL_IDS.has(id)) continue;
      if (!seen.has(id)) seen.set(id, { id, from: [] });
      seen.get(id).from.push(t.symbol ? t.symbol + ' (' + key + ')' : key);
    }
  }
  return [...seen.values()];
}

/* familyReport(cat) — the self-check critics and the audit piece run. Pure data out:
   how many ids landed in each family, which fell through to 'misc', and whether the
   explicit table above names an id the catalogue no longer has or a family that does
   not exist. */
export function familyReport(cat = SNAPSHOT) {
  const counts = {}; const misc = [];
  for (const r of cat.all()) {
    const f = cat.family(r.id);
    counts[f] = (counts[f] || 0) + 1;
    if (f === 'misc') misc.push(r.id);
  }
  return {
    counts, misc,
    staleOverrides: Object.keys(ID_FAMILY).filter((id) => !cat.has(id)),
    badFamilies: [...new Set([...Object.values(ID_FAMILY), ...Object.values(CAT_FAMILY), ...KEYWORDS.map((k) => k[0])])]
      .filter((f) => !FAMILY_IDS.has(f)),
    badPhantomNear: PHANTOMS.filter((p) => p.near && !cat.has(p.near)).map((p) => p.id),
    phantomRows: PHANTOMS.filter((p) => cat.has(p.id)).map((p) => p.id),
    badRows: cat.all().filter((r) => ROW_KEYS.some((k) => !(k in r))).map((r) => r.id),
    noColor: cat.all().filter((r) => !isColor(r.color)).map((r) => r.id),
    // An exemplar must exist, carry a SOURCE colour and sit in the family it colours.
    badSwatches: FAMILIES.map((f) => f.id).filter((f) => {
      const r = cat.byId(FAMILY_SWATCH[f]);
      if (!r || r.colorFrom !== 'source') return true;
      // Borrowing from outside is allowed only where the family has NO source-coloured row
      // of its own (today: trade, misc) — otherwise the exemplar must be a member.
      const own = cat.all().some((x) => x.colorFrom === 'source' && cat.family(x.id) === f);
      return own && cat.family(r.id) !== f;
    }),
    // meta must describe the rows it travels with.
    countMismatch: Object.entries(countsOf(cat.all(), (cat.meta.counts || {}).lootRows))
      .filter(([k, v]) => (cat.meta.counts || {})[k] !== v).map(([k]) => k),
    unknownStaples: (cat.meta && cat.meta.liveUnknownStaples) || [],
    /* Ids a LOCAL_TABLE and the catalogue BOTH use. Informational, not an error: Warpath
       spells its map nodes wood / stone / food, which are also real ledger ids meaning a
       different thing on a different map. Listed so no view ever draws a Warpath node as
       ledger cargo by accident. */
    localTableSharedIds: [...LOCAL_IDS].filter((id) => cat.has(id)),
    unaccounted: unaccounted(cat).map((x) => x.id),
  };
}

export { CATALOG, CATALOG_META };
