/* eslint-disable */
// world-data.jsx — districts, resource yield tables, encounter registry.
// All zone coords are % of the map image (1254×1254, square).
//
// PUBLIC API (exposed on window.WorldMap so game code can hook in):
//
//   WorldMap.zones                       → read-only zone list
//   WorldMap.getZone(id)                 → zone by id
//   WorldMap.setEvent(zoneId, evt | null)→ flash a zone with an active event
//                                          evt = { kind, label, severity, ttl? }
//   WorldMap.clearEvent(zoneId)          → remove active event
//   WorldMap.registerEncounter(zoneId,
//                              encounter) → add an encounter to a zone
//                                          encounter = { id, title, brief, weight, onResolve }
//   WorldMap.rollEncounter(zoneId)       → pick + return one weighted encounter
//   WorldMap.on(event, cb)               → subscribe; event ∈ "zone:select", "zone:event", "encounter:roll"
//   WorldMap.off(event, cb)
//
// All mutations dispatch a "worldmap:changed" CustomEvent on window so the React
// view re-reads state without a tight coupling.

// ─────────────────────────────────────────────────────────────
// Resource catalog (mirrors the game's resource sheet — id, label, tier, icon).
// Icons are short tokens we map to SVG in world-app.jsx.
// ─────────────────────────────────────────────────────────────
const RESOURCES = {
  // Tier 1 — survival
  food:        { label: "Food",            tier: 1, glyph: "food" },
  water:       { label: "Water",           tier: 1, glyph: "water" },
  medicine:    { label: "Medicine",        tier: 1, glyph: "med" },
  supplies:    { label: "Supplies",        tier: 1, glyph: "crate" },
  fuel:        { label: "Fuel",            tier: 1, glyph: "fuel" },
  ammo:        { label: "Ammo",            tier: 1, glyph: "ammo" },
  metal:       { label: "Metal",           tier: 1, glyph: "metal" },
  wood:        { label: "Wood",            tier: 1, glyph: "wood" },
  fabric:      { label: "Fabric",          tier: 1, glyph: "fabric" },
  electronics: { label: "Electronics",     tier: 1, glyph: "chip" },
  batteries:   { label: "Batteries",       tier: 1, glyph: "batt" },
  // Industrial / camp
  concrete:    { label: "Concrete",        tier: 2, glyph: "block" },
  circuit:     { label: "Circuit Boards",  tier: 2, glyph: "chip" },
  mech:        { label: "Mechanical Parts",tier: 2, glyph: "gear" },
  copper:      { label: "Copper Wiring",   tier: 2, glyph: "wire" },
  gasoline:    { label: "Gasoline",        tier: 2, glyph: "fuel" },
  solar:       { label: "Solar Cells",     tier: 2, glyph: "sun" },
  steel:       { label: "Steel Plates",    tier: 2, glyph: "plate" },
  // Biological
  dna:         { label: "DNA",             tier: 2, glyph: "dna" },
  organs:      { label: "Mutant Organs",   tier: 2, glyph: "organ" },
  bio:         { label: "Bio Samples",     tier: 2, glyph: "vial" },
  blood:       { label: "Blood Samples",   tier: 2, glyph: "vial" },
  neural:      { label: "Neural Tissue",   tier: 3, glyph: "brain" },
  bone:        { label: "Bone Fragments",  tier: 2, glyph: "bone" },
  spore:       { label: "Toxic Spores",    tier: 2, glyph: "spore" },
  // Trade
  credits:     { label: "Credits",         tier: 1, glyph: "coin" },
  bmt:         { label: "Black Market Tokens", tier: 2, glyph: "token" },
  intel:       { label: "Intel Files",     tier: 2, glyph: "file" },
  forgery:     { label: "Forgery Kits",    tier: 2, glyph: "stamp" },
  contraband:  { label: "Contraband",      tier: 2, glyph: "crate" },
  enc:         { label: "Encrypted Data",  tier: 2, glyph: "lock" },
  // Anomaly
  corrupted:   { label: "Corrupted Essence", tier: 3, glyph: "rune" },
  memshard:    { label: "Memory Shards",   tier: 3, glyph: "shard" },
  relic:       { label: "Relic Shards",    tier: 3, glyph: "relic" },
  void:        { label: "Void Fragments",  tier: 3, glyph: "void" },
  anomaly:     { label: "Anomaly Cores",   tier: 3, glyph: "core" },
  kalon:       { label: "Kalon Fragments", tier: 3, glyph: "kalon" },
  dark:        { label: "Dark Matter",     tier: 3, glyph: "void" },
  echo:        { label: "Echo Dust",       tier: 3, glyph: "dust" },
  // Rare event
  tome:        { label: "Ancient Tome",    tier: 4, glyph: "book" },
  seed:        { label: "World Seeds",     tier: 4, glyph: "seed" },
  dim:         { label: "Dim. Crystals",   tier: 4, glyph: "crystal" },
  phoenix:     { label: "Phoenix Ash",     tier: 4, glyph: "ash" },
  frozen:      { label: "Frozen Hearts",   tier: 4, glyph: "ice" },
  flame:       { label: "Living Flame",    tier: 4, glyph: "flame" },
};

// ─────────────────────────────────────────────────────────────
// Districts. Coords measured against the 1254² source image.
// Yields are weighted probabilities, expressed as the % chance to
// roll that resource in a single scavenge tick. Stack with multiple
// ticks per run for typical 3-5 items output.
// ─────────────────────────────────────────────────────────────
const ZONES = [
  {
    id: "upper-ethos",
    name: "Upper Ethos",
    tag: "Upscale residential",
    blurb: "Penthouses, brownstones, and locked rooftop gardens. Less picked-over than midtown, but the building cores collapse without warning.",
    x: 49, y: 12,
    threat: 2,
    biome: "residential",
    control: "neutral",
    yields: [
      { r: "food",        p: 45 },
      { r: "medicine",    p: 35 },
      { r: "fabric",      p: 30 },
      { r: "electronics", p: 25 },
      { r: "credits",     p: 20 },
      { r: "dna",         p: 8  },
    ],
    encounterSlots: 3,
  },
  {
    id: "central-park",
    name: "Central Park",
    tag: "Overgrown reserve",
    blurb: "The trees grew back fast — too fast. Anything that drinks the water comes out wrong. Mutant nests in the meadow, but it's the only fresh wood for miles.",
    x: 53, y: 25,
    threat: 4,
    biome: "wild",
    control: "fauna",
    yields: [
      { r: "wood",        p: 60 },
      { r: "water",       p: 50 },
      { r: "food",        p: 35 },
      { r: "bio",         p: 20 },
      { r: "spore",       p: 15 },
      { r: "organs",      p: 8  },
    ],
    encounterSlots: 4,
  },
  {
    id: "hells-gate",
    name: "Hell's Gate",
    tag: "Industrial waterfront",
    blurb: "Refineries on the west shore. Half-flooded but the deeper holds still hold barrels. Ground crawls with raiders working the salvage.",
    x: 30, y: 36,
    threat: 3,
    biome: "industrial",
    control: "raiders",
    yields: [
      { r: "fuel",        p: 55 },
      { r: "metal",       p: 50 },
      { r: "mech",        p: 40 },
      { r: "gasoline",    p: 35 },
      { r: "steel",       p: 25 },
      { r: "ammo",        p: 15 },
    ],
    encounterSlots: 4,
  },
  {
    id: "midtown",
    name: "Midtown",
    tag: "Dense commercial — Times Sq.",
    blurb: "Storefronts gutted, but the back rooms remember. Cross-runners use the underground concourses as highways.",
    x: 47, y: 39,
    threat: 3,
    biome: "urban",
    control: "neutral",
    yields: [
      { r: "supplies",    p: 50 },
      { r: "credits",     p: 45 },
      { r: "ammo",        p: 30 },
      { r: "electronics", p: 25 },
      { r: "bmt",         p: 15 },
      { r: "intel",       p: 10 },
    ],
    encounterSlots: 5,
  },
  {
    id: "eastside",
    name: "Eastside",
    tag: "Quiet residential",
    blurb: "Brownstone rows. Each block has someone watching from a window — never the same someone twice.",
    x: 60, y: 45,
    threat: 2,
    biome: "residential",
    control: "neutral",
    yields: [
      { r: "food",        p: 40 },
      { r: "water",       p: 30 },
      { r: "fabric",      p: 30 },
      { r: "medicine",    p: 25 },
      { r: "batteries",   p: 18 },
    ],
    encounterSlots: 3,
  },
  {
    id: "downtown",
    name: "Downtown",
    tag: "Commercial / financial",
    blurb: "Vaults stayed locked. Wall Street's last gift: encrypted ledgers worth more now than the paper money ever was.",
    x: 39, y: 58,
    threat: 3,
    biome: "urban",
    control: "neutral",
    yields: [
      { r: "credits",     p: 50 },
      { r: "supplies",    p: 40 },
      { r: "ammo",        p: 30 },
      { r: "electronics", p: 25 },
      { r: "enc",         p: 12 },
      { r: "forgery",     p: 8  },
    ],
    encounterSlots: 4,
  },
  {
    id: "southpoint",
    name: "Southpoint",
    tag: "Port-adjacent yards",
    blurb: "The cranes still creak in the wind. Concrete blocks scattered like building toys.",
    x: 56, y: 65,
    threat: 2,
    biome: "industrial",
    control: "neutral",
    yields: [
      { r: "fuel",        p: 45 },
      { r: "metal",       p: 35 },
      { r: "concrete",    p: 30 },
      { r: "steel",       p: 25 },
      { r: "contraband",  p: 18 },
    ],
    encounterSlots: 3,
  },
  {
    id: "liberty-island",
    name: "Liberty Island",
    tag: "Anomaly site",
    blurb: "The statue still stands. Sort of. It hums at the right hour and the crown leaks light into the water. Nothing should be there alive. Several things are.",
    x: 11, y: 78,
    threat: 5,
    biome: "anomaly",
    control: "anomaly",
    yields: [
      { r: "memshard",    p: 35 },
      { r: "echo",        p: 25 },
      { r: "relic",       p: 18 },
      { r: "corrupted",   p: 12 },
      { r: "tome",        p: 6  },
      { r: "anomaly",     p: 4  },
    ],
    encounterSlots: 2,
  },
  {
    id: "the-docks",
    name: "The Docks",
    tag: "Warehouse district",
    blurb: "Stacked containers, half-collapsed cranes. Whatever was in the bills of lading is still in the bills of lading.",
    x: 40, y: 88,
    threat: 2,
    biome: "industrial",
    control: "neutral",
    yields: [
      { r: "supplies",    p: 50 },
      { r: "fuel",        p: 40 },
      { r: "steel",       p: 35 },
      { r: "metal",       p: 30 },
      { r: "concrete",    p: 25 },
    ],
    encounterSlots: 4,
  },
  {
    id: "brooklyn-heights",
    name: "Brooklyn Heights",
    tag: "Outer residential",
    blurb: "Quieter than the island. The few standing buildings are full, and the people inside don't trade.",
    x: 59, y: 88,
    threat: 2,
    biome: "residential",
    control: "neutral",
    yields: [
      { r: "food",        p: 45 },
      { r: "medicine",    p: 30 },
      { r: "wood",        p: 28 },
      { r: "fabric",      p: 25 },
      { r: "bio",         p: 12 },
    ],
    encounterSlots: 3,
  },
  {
    id: "red-hook",
    name: "Red Hook",
    tag: "Raider stronghold",
    blurb: "Burn-pile of a neighborhood. The Scarlet crew set up camp two months ago — and they're recruiting. Loudly.",
    x: 83, y: 88,
    threat: 4,
    biome: "industrial",
    control: "raiders",
    yields: [
      { r: "ammo",        p: 55 },
      { r: "fuel",        p: 40 },
      { r: "steel",       p: 30 },
      { r: "mech",        p: 25 },
      { r: "bone",        p: 15 },
      { r: "organs",      p: 10 },
    ],
    encounterSlots: 4,
  },
  {
    id: "the-stacks",
    name: "The Stacks",
    tag: "Tech district / server farms",
    blurb: "The cold rooms still cool — something's powering them. ATHENA flagged the place as off-limits. We're going anyway.",
    x: 83, y: 53,
    threat: 4,
    biome: "tech",
    control: "anomaly",
    yields: [
      { r: "electronics", p: 55 },
      { r: "batteries",   p: 45 },
      { r: "circuit",     p: 40 },
      { r: "copper",      p: 30 },
      { r: "enc",         p: 18 },
      { r: "neural",      p: 12 },
    ],
    encounterSlots: 4,
  },
];

// ─────────────────────────────────────────────────────────────
// Seed encounter pool — placeholder. Game code calls
// WorldMap.registerEncounter(zoneId, e) to add real ones.
// ─────────────────────────────────────────────────────────────
const ENCOUNTERS = {
  "central-park":   [{ id:"cp-pack",  title:"Mutant pack",   brief:"Pack of 4 — heavy, slow.", weight:3 },
                     { id:"cp-cache", title:"Buried cache",  brief:"+ wood, +bio sample.",      weight:2 }],
  "hells-gate":     [{ id:"hg-raid",  title:"Raider patrol", brief:"2 scouts + 1 leader.",      weight:3 },
                     { id:"hg-barrel",title:"Barrel run",    brief:"+ fuel, draws attention.",  weight:2 }],
  "red-hook":       [{ id:"rh-convoy",title:"Raider convoy", brief:"Heavy escort, big payoff.", weight:2 },
                     { id:"rh-recruit",title:"Recruit pitch", brief:"Scarlets want a name.",    weight:1 }],
  "liberty-island": [{ id:"li-spike", title:"Resonance spike", brief:"Relic exposure — risk.", weight:1 }],
  "the-stacks":     [{ id:"ts-echo",  title:"ATHENA echo",   brief:"Voice in the cold room.",   weight:1 },
                     { id:"ts-server",title:"Server lock",   brief:"Encrypted data, locked.",   weight:2 }],
};

// ─────────────────────────────────────────────────────────────
// Active events. These are what cause a zone to "flash" on the map.
// Set externally with WorldMap.setEvent(zoneId, evt).
//   evt: { kind, label, severity: "info"|"warn"|"crit"|"anomaly", ttl? }
// ─────────────────────────────────────────────────────────────
const EVENTS = {
  "central-park":   { kind: "fauna",   label: "Mutant pack",       severity: "warn" },
  "red-hook":       { kind: "raider",  label: "Raider convoy",     severity: "crit" },
  "the-stacks":     { kind: "echo",    label: "ATHENA echo",       severity: "anomaly" },
  "liberty-island": { kind: "anomaly", label: "Resonance spike",   severity: "anomaly" },
  "hells-gate":     { kind: "raider",  label: "Patrol sweep",      severity: "warn" },
};

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function rollEncounter(zoneId) {
  const pool = ENCOUNTERS[zoneId] || [];
  if (!pool.length) return null;
  const total = pool.reduce((s, e) => s + (e.weight || 1), 0);
  let r = Math.random() * total;
  for (const e of pool) {
    r -= e.weight || 1;
    if (r <= 0) return e;
  }
  return pool[0];
}

// pub/sub
const _listeners = {};
function on(evt, cb)  { (_listeners[evt] ||= new Set()).add(cb); }
function off(evt, cb) { _listeners[evt]?.delete(cb); }
function emit(evt, payload) {
  _listeners[evt]?.forEach((cb) => { try { cb(payload); } catch (e) { console.error(e); } });
  window.dispatchEvent(new CustomEvent("worldmap:changed", { detail: { evt, payload } }));
}

const WorldMap = {
  zones: ZONES,
  resources: RESOURCES,
  getZone: (id) => ZONES.find((z) => z.id === id),
  setEvent: (id, e) => { if (e) EVENTS[id] = e; else delete EVENTS[id]; emit("zone:event", { id, e }); },
  clearEvent: (id) => { delete EVENTS[id]; emit("zone:event", { id, e: null }); },
  registerEncounter: (id, enc) => { (ENCOUNTERS[id] ||= []).push(enc); emit("encounter:add", { id, enc }); },
  rollEncounter: (id) => { const r = rollEncounter(id); emit("encounter:roll", { id, r }); return r; },
  _events: () => EVENTS,
  _encounters: () => ENCOUNTERS,
  on, off,
};

Object.assign(window, { WorldMap, ZONES, RESOURCES, ENCOUNTERS, EVENTS });

// ═════════════════════════════════════════════════════════════════════════
//                    EXPEDITION SYSTEM — destinations, world events,
//                    route generator, run state.
// ═════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────
// Destinations — long-haul locations reached via a roguelite route.
// These render as a different marker style on the map (diamond w/ glyph).
// Some sit on the visible island, some hang in the surrounding fog/water.
// ─────────────────────────────────────────────────────────────
const DESTINATIONS = [
  {
    id: "camp-heights",
    name: "Camp Heights",
    tag: "Home · settlement",
    kind: "settlement",
    glyph: "home",
    blurb: "Your camp. Walls hold for now. Returning here ends a run.",
    x: 47, y: 4,
    threat: 1,
    distance: 0,
    rewards: [],
    theme: "homecoming",
    homeBase: true,
  },
  {
    id: "hollow-bazaar",
    name: "The Hollow Bazaar",
    tag: "Black Market · hub",
    kind: "black-market",
    glyph: "bazaar",
    blurb: "Built into the bones of a sunken tanker east of the city. No questions, no records, no refunds. Bring contraband and leave with relics.",
    x: 96, y: 73,
    threat: 4,
    distance: 8,
    rewards: ["Illegal artifacts", "Rare cards", "Mutations", "Relic shards"],
    theme: "black-market",
    knownThreats: ["Smuggler crews", "Foundation patrols", "Bounty hunters"],
  },
  {
    id: "site-49",
    name: "Foundation Site-49",
    tag: "SCP containment · restricted",
    kind: "scp",
    glyph: "biohazard",
    blurb: "Plume rising from the northeast. Foundation never reported what cracked open. The signal that pulses out of there matches the Containment cage at home.",
    x: 92, y: 8,
    threat: 5,
    distance: 9,
    rewards: ["Anomaly cores", "Experimental tech", "Dangerous relics"],
    theme: "scp",
    knownThreats: ["Foundation MTF", "Breach entities", "Cognitohazards"],
  },
  {
    id: "hollow-city",
    name: "Hollow City",
    tag: "Ruins · unmapped",
    kind: "ruins",
    glyph: "ruins",
    blurb: "What's left of the old metro. Tunnels that don't end where the maps say. People who go in alone don't always come back the same person.",
    x: 4, y: 32,
    threat: 4,
    distance: 7,
    rewards: ["Magic", "Ancient units", "World lore", "Tomes"],
    theme: "ruins",
    knownThreats: ["Shifted geometry", "Echo wraiths", "Cultists"],
  },
  {
    id: "blood-arena",
    name: "Blood Arena",
    tag: "Dungeon · faction-held",
    kind: "dungeon",
    glyph: "arena",
    blurb: "Old subway station the Scarlets converted into a fight pit. Survive seven bouts and walk out with a name. Or don't walk out.",
    x: 3, y: 65,
    threat: 4,
    distance: 6,
    rewards: ["Weapons", "Armor", "Bounty contracts", "Faction rep"],
    theme: "military",
    knownThreats: ["Scarlet champions", "Arena beasts", "Crowd snipers"],
  },
  {
    id: "flesh-cathedral",
    name: "The Flesh Cathedral",
    tag: "Hidden · unverified",
    kind: "hidden",
    glyph: "unknown",
    blurb: "Whispered about by Bazaar runners. Coordinates don't agree. Unlocks once a Bazaar route uncovers the signal.",
    x: 76, y: 96,
    threat: 5,
    distance: 11,
    rewards: ["???"],
    theme: "scp",
    locked: true,
    knownThreats: ["???"],
  },
];

// ─────────────────────────────────────────────────────────────
// World events — large-scale modifiers that warp routes. Each event
// targets one or more destinations or zones and applies modifiers to
// any expedition that touches them.
//
//   mods: {
//     extraNodes:   number,    // adds N nodes to the route
//     dangerBoost:  number,    // +N threat per combat node
//     rewardBoost:  number,    // +N% reward roll
//     nodeWeights:  {type:weight}, // bias node generation
//     ttl:          number,    // event lifetime (ticks); -1 = persistent
//   }
// ─────────────────────────────────────────────────────────────
const WORLD_EVENTS = [
  {
    id: "foundation-blockade",
    title: "Foundation blockade near Hollow Bazaar",
    severity: "warn",
    affects: ["hollow-bazaar"],
    icon: "shield",
    body: "Mobile Task Force checkpoints have locked down approach corridors east of Southpoint.",
    mods: { extraNodes: 1, nodeWeights: { checkpoint: 6, elite: 2 }, rewardBoost: 15, ttl: -1 },
  },
  {
    id: "raider-war",
    title: "Raider war near Red Hook",
    severity: "crit",
    affects: ["red-hook", "blood-arena"],
    icon: "skull",
    body: "Scarlets and Bone Saws are fighting over the docks. Routes through the southeast are wall-to-wall combat.",
    mods: { dangerBoost: 1, nodeWeights: { combat: 6, elite: 3 }, rewardBoost: 25, ttl: -1 },
  },
  {
    id: "dim-storm",
    title: "Dimensional storm over Liberty Island",
    severity: "anomaly",
    affects: ["liberty-island", "site-49"],
    icon: "storm",
    body: "Atmospheric reality fluctuation. Pathfinding unreliable. Some routes will reroute through anomalies.",
    mods: { extraNodes: 2, nodeWeights: { anomaly: 5, mystery: 3 }, rewardBoost: 30, ttl: -1 },
  },
  {
    id: "fresh-rumor",
    title: "Trader rumor: Cathedral signal returning",
    severity: "info",
    affects: ["hollow-bazaar"],
    icon: "radio",
    body: "Bazaar runners say a Cathedral signal is bleeding through. Bazaar runs may surface a hidden node.",
    mods: { nodeWeights: { mystery: 3 }, unlockChance: 0.2, ttl: -1 },
  },
];

// ─────────────────────────────────────────────────────────────
// Node catalog. type → visual + base rolls.
// kind: combat | travel | event | shop | elite | boss | mystery | checkpoint | anomaly | rest
// ─────────────────────────────────────────────────────────────
const NODE_TYPES = {
  combat:     { label: "Combat",       glyph: "blade",   tone: "red",    danger: 2 },
  elite:      { label: "Elite",        glyph: "skull",   tone: "red",    danger: 4 },
  travel:     { label: "Travel",       glyph: "path",    tone: "bronze", danger: 1 },
  event:      { label: "Event",        glyph: "spark",   tone: "amber",  danger: 1 },
  shop:       { label: "Trader",       glyph: "coin",    tone: "bronze", danger: 0 },
  rest:       { label: "Rest",         glyph: "fire",    tone: "green",  danger: 0 },
  mystery:    { label: "Unknown",      glyph: "question",tone: "purple", danger: 2 },
  checkpoint: { label: "Checkpoint",   glyph: "shield",  tone: "blue",   danger: 3 },
  anomaly:    { label: "Anomaly",      glyph: "rune",    tone: "purple", danger: 3 },
  boss:       { label: "Destination",  glyph: "star",    tone: "bronze", danger: 5 },
  start:      { label: "Camp",         glyph: "home",    tone: "bronze", danger: 0 },
};

// Themed sub-names: when generator picks a type for a node, it draws
// a flavor name from the destination's theme pool. Keeps runs distinct.
const ROUTE_THEMES = {
  "black-market": {
    combat:     ["Smuggler ambush", "Bone Saw scouts", "Junker turf"],
    elite:      ["Bounty hunter", "Cartel enforcer", "Scarlet captain"],
    travel:     ["Collapsed highway", "Sewer tunnels", "Pier crawl", "Container maze"],
    event:      ["Dead convoy", "Smuggler camp", "Contraband stash"],
    shop:       ["Roadside trader", "Fence pickup", "Black market caravan"],
    mystery:    ["Cathedral signal", "Faded glyph", "Stranger's offer"],
    checkpoint: ["Foundation checkpoint", "Customs sweep", "MTF blockade"],
    anomaly:    ["Reality bleed", "Ghost market", "Echo passage"],
    rest:       ["Safehouse", "Underbridge fire"],
  },
  "scp": {
    combat:     ["Breach pursuit", "MTF skirmish", "Containment failure"],
    elite:      ["Keter entity", "MTF Nine-Tailed", "Anomalous predator"],
    travel:     ["Decon corridor", "Sealed wing", "Containment ringway"],
    event:      ["Test log salvage", "Researcher's cache", "Audio anomaly"],
    shop:       ["Tagged contractor", "Foundation black-bag"],
    mystery:    ["Unlogged file", "Cognitohazard", "Reality stutter"],
    checkpoint: ["Decon scan", "Foundation cordon"],
    anomaly:    ["SCP-▮▮▮▮ encounter", "Memetic field", "Phase-shift hall"],
    rest:       ["Decon shower", "Quiet wing"],
  },
  "ruins": {
    combat:     ["Cultist patrol", "Ghoul nest", "Bandit camp"],
    elite:      ["Reliquary guardian", "Cult leader", "Echo wraith"],
    travel:     ["Caved tunnel", "Forgotten staircase", "Riverbed crossing"],
    event:      ["Shrine offering", "Mural puzzle", "Lost cache"],
    shop:       ["Wanderer trader"],
    mystery:    ["Reality fold", "Whispering passage", "Lost map fragment"],
    checkpoint: ["Cult toll", "Sealed door"],
    anomaly:    ["Time pocket", "Memory bleed", "Stone that hums"],
    rest:       ["Hidden alcove", "Old chapel"],
  },
  "military": {
    combat:     ["Raider gang", "Mutant pack", "Arena prelim"],
    elite:      ["Arena champion", "Raider lieutenant", "Mauler"],
    travel:     ["Service tunnel", "Stadium ringway", "Rooftop crawl"],
    event:      ["Bookmaker visit", "Prep tent", "Recruit pitch"],
    shop:       ["Quartermaster", "Bone Saw fence"],
    mystery:    ["Locked locker", "Old broadcast"],
    checkpoint: ["Door check", "Pit-fight gate"],
    anomaly:    ["Crowd hallucination"],
    rest:       ["Quiet locker", "Trainer's room"],
  },
  "homecoming": {
    combat:     ["Stray patrol"],
    travel:     ["Familiar streets"],
    event:      ["Welcome bonfire"],
    rest:       ["Camp gate"],
  },
};

// ─────────────────────────────────────────────────────────────
// Route generator — deterministic per (destId, seed).
// Slay-the-Spire style column DAG: depth = distance, each column has
// 1-3 nodes, edges fan ±1 row to the next column.
// ─────────────────────────────────────────────────────────────
function _rng(seed) {
  // small LCG so routes are reproducible per seed
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function _pickWeighted(rng, weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (const [k, w] of Object.entries(weights)) {
    r -= w;
    if (r <= 0) return k;
  }
  return Object.keys(weights)[0];
}

function generateRoute({ destId, seed = Date.now() & 0xffff }) {
  const dest = DESTINATIONS.find((d) => d.id === destId);
  if (!dest) throw new Error("unknown destination " + destId);

  const rng = _rng(seed);
  const themeMap = ROUTE_THEMES[dest.theme] || ROUTE_THEMES["black-market"];

  // collect active world-event modifiers that touch this destination
  const activeEvents = WORLD_EVENTS.filter((e) => e.affects.includes(destId));
  const mods = activeEvents.reduce((acc, e) => {
    acc.extraNodes  += e.mods.extraNodes  || 0;
    acc.dangerBoost += e.mods.dangerBoost || 0;
    acc.rewardBoost += e.mods.rewardBoost || 0;
    for (const [k, v] of Object.entries(e.mods.nodeWeights || {})) {
      acc.nodeWeights[k] = (acc.nodeWeights[k] || 0) + v;
    }
    return acc;
  }, { extraNodes: 0, dangerBoost: 0, rewardBoost: 0, nodeWeights: {} });

  // base node weights per theme
  const baseWeights = {
    "black-market": { combat: 5, travel: 6, event: 5, shop: 3, elite: 2, mystery: 2, checkpoint: 2, rest: 1 },
    "scp":          { combat: 6, travel: 4, event: 3, elite: 3, mystery: 4, anomaly: 4, checkpoint: 2, rest: 1 },
    "ruins":        { combat: 3, travel: 5, event: 4, elite: 2, mystery: 5, anomaly: 3, rest: 2 },
    "military":     { combat: 8, travel: 3, event: 2, elite: 4, shop: 2, checkpoint: 2, rest: 1 },
    "homecoming":   { travel: 8, rest: 2 },
  }[dest.theme] || { combat: 4, travel: 4, event: 3 };

  // merge event weight biases
  const weights = { ...baseWeights };
  for (const [k, v] of Object.entries(mods.nodeWeights)) {
    weights[k] = (weights[k] || 0) + v;
  }

  const cols = Math.max(3, dest.distance + mods.extraNodes);
  const nodes = [];
  let nextId = 0;

  // column 0: start (single node)
  const startId = `n${nextId++}`;
  nodes.push({
    id: startId, col: 0, row: 1, type: "start",
    name: "Camp Heights", brief: "Departure.",
  });

  // intermediate columns: 1..cols-2 → 1-3 nodes each
  const lastColNodes = [startId];
  let prevCol = [{ id: startId, row: 1 }];
  for (let c = 1; c <= cols - 2; c++) {
    const count = 1 + Math.floor(rng() * 3); // 1-3 per col
    const rows = [0, 1, 2].sort(() => rng() - 0.5).slice(0, count).sort();
    const here = [];
    for (const row of rows) {
      const type = _pickWeighted(rng, weights);
      const pool = themeMap[type] || ["Wayside encounter"];
      const name = pool[Math.floor(rng() * pool.length)];
      const id = `n${nextId++}`;
      nodes.push({
        id, col: c, row, type, name,
        brief: NODE_TYPES[type]?.label || "Encounter",
        danger: (NODE_TYPES[type]?.danger || 1) + mods.dangerBoost,
      });
      here.push({ id, row });
    }
    // connect previous column → here (each prev node fans to 1-2 here)
    for (const p of prevCol) {
      // pick 1-2 closest (by row) here nodes
      const sorted = here.slice().sort((a, b) => Math.abs(a.row - p.row) - Math.abs(b.row - p.row));
      const fanCount = Math.min(here.length, 1 + Math.floor(rng() * 2));
      const targets = sorted.slice(0, fanCount).map((n) => n.id);
      const src = nodes.find((n) => n.id === p.id);
      src.next = targets;
    }
    prevCol = here;
  }

  // final column: destination boss node
  const endId = `n${nextId++}`;
  nodes.push({
    id: endId, col: cols - 1, row: 1, type: "boss",
    name: dest.name, brief: dest.tag, danger: dest.threat,
  });
  for (const p of prevCol) {
    const src = nodes.find((n) => n.id === p.id);
    src.next = [endId];
  }

  return {
    destId,
    seed,
    cols,
    nodes,
    startId, endId,
    activeEvents: activeEvents.map((e) => e.id),
    mods,
    estReward: Math.round((dest.threat * 12) * (1 + mods.rewardBoost / 100)),
  };
}

// ─────────────────────────────────────────────────────────────
// Active expedition state (single run at a time in this demo).
// Game code can swap this for per-squad runs.
// ─────────────────────────────────────────────────────────────
let _activeRun = null;   // { route, currentId, log: [], status }

function beginExpedition(destId, opts = {}) {
  const route = generateRoute({ destId, ...opts });
  _activeRun = {
    route,
    currentId: route.startId,
    visited: new Set([route.startId]),
    log: [{ ts: Date.now(), msg: `Departed from Camp Heights to ${DESTINATIONS.find(d=>d.id===destId).name}.` }],
    status: "active",
  };
  emit("expedition:begin", _activeRun);
  return _activeRun;
}

function advanceToNode(nodeId) {
  if (!_activeRun) return null;
  const cur = _activeRun.route.nodes.find((n) => n.id === _activeRun.currentId);
  if (!cur?.next?.includes(nodeId)) return null;
  _activeRun.currentId = nodeId;
  _activeRun.visited.add(nodeId);
  const node = _activeRun.route.nodes.find((n) => n.id === nodeId);
  _activeRun.log.push({ ts: Date.now(), msg: `Reached ${node.name} (${NODE_TYPES[node.type]?.label}).` });
  if (nodeId === _activeRun.route.endId) {
    _activeRun.status = "arrived";
    emit("expedition:arrived", _activeRun);
  } else {
    emit("expedition:advance", { run: _activeRun, node });
  }
  return _activeRun;
}

function abandonExpedition() {
  if (!_activeRun) return;
  _activeRun.status = "aborted";
  emit("expedition:abort", _activeRun);
  _activeRun = null;
}

function getActiveExpedition() { return _activeRun; }

Object.assign(WorldMap, {
  destinations:        DESTINATIONS,
  worldEvents:         WORLD_EVENTS,
  nodeTypes:           NODE_TYPES,
  routeThemes:         ROUTE_THEMES,
  generateRoute,
  beginExpedition,
  advanceToNode,
  abandonExpedition,
  getActiveExpedition,
  getDestination: (id) => DESTINATIONS.find((d) => d.id === id),
});
Object.assign(window, { DESTINATIONS, WORLD_EVENTS, NODE_TYPES, ROUTE_THEMES });

// ═════════════════════════════════════════════════════════════════════════
//  REAL ROGUELITE BRIDGE — when the embedding game pushes its published
//  campaigns (Catalog.campaigns) + active run (Profile.rlcRun) via
//  window.__BRIDGE.world, the destination markers BECOME those real
//  campaigns. Clicking one launches the real run in the parent game.
//  Falls back to the demo destinations when run standalone (no bridge).
// ═════════════════════════════════════════════════════════════════════════
const _BB_HOME = DESTINATIONS.find((d) => d.homeBase) || DESTINATIONS[0];
// Periphery slots (in the fog around the island) — deterministic spread.
const _BB_SLOTS = [
  { x: 92, y: 14 }, { x: 96, y: 40 }, { x: 93, y: 66 }, { x: 80, y: 90 },
  { x: 60, y: 95 }, { x: 36, y: 95 }, { x: 8, y: 86 }, { x: 4, y: 60 },
  { x: 3, y: 34 }, { x: 8, y: 12 }, { x: 28, y: 6 }, { x: 70, y: 5 },
];
function _bbThreat(diff) {
  const d = String(diff || "").toLowerCase();
  if (/(night|leth|insan|hell)/.test(d)) return 5;
  if (/(brutal|very hard|hard\+|expert)/.test(d)) return 4;
  if (/hard/.test(d)) return 3;
  if (/(easy|intro|tutorial)/.test(d)) return 1;
  return 2;
}
const _BB_KINDS = [
  { glyph: "arena",     kind: "dungeon" },
  { glyph: "ruins",     kind: "ruins" },
  { glyph: "biohazard", kind: "scp" },
  { glyph: "bazaar",    kind: "black-market" },
];
function _bbApplyWorld() {
  const w = window.__BRIDGE && window.__BRIDGE.world;
  const camps = w && Array.isArray(w.campaigns) ? w.campaigns : null;
  if (!camps || !camps.length) return; // keep demo destinations
  const runId = w.run && w.run.campaignId;
  // Pure region selector: ONLY real campaigns are launchable markers (the
  // decorative home node is dropped — the bunker is the camp now).
  const dests = [];
  camps.forEach((c, i) => {
    const slot = _BB_SLOTS[i % _BB_SLOTS.length];
    const km = _BB_KINDS[i % _BB_KINDS.length];
    const threat = _bbThreat(c.difficulty);
    dests.push({
      id: "rlc:" + c.id,
      campaignId: c.id,
      name: c.name || "Campaign",
      tag: (c.difficulty || "Normal") + " · roguelite",
      kind: km.kind,
      glyph: km.glyph,
      blurb: c.desc || "A branching roguelite run. Persistent HP — die and the run ends.",
      x: slot.x, y: slot.y,
      threat: threat,
      distance: Math.max(3, Math.min(9, c.nodes || 4)),
      rewards: ["Cards", "Relics", c.cleared ? "Cleared ✓" : "Currency"],
      theme: "military",
      knownThreats: ["Branching battles", "Persistent HP", "Boss fight"],
      locked: !!c.locked,
      lockName: c.lockName || "",
      cleared: !!c.cleared,
      inProgress: !!(runId && runId === c.id),
      rlc: true,
    });
  });
  // Mutate the SAME array reference so generateRoute / getDestination /
  // window.DESTINATIONS / WorldMap.destinations all stay in sync.
  DESTINATIONS.splice(0, DESTINATIONS.length, ...dests);
  try { window.dispatchEvent(new CustomEvent("worldmap:changed", { detail: { evt: "bridge" } })); } catch (e) {}
}
window.addEventListener("bridgedata", _bbApplyWorld);
_bbApplyWorld(); // in case data already arrived
Object.assign(WorldMap, { applyBridgeWorld: _bbApplyWorld });
