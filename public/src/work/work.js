/* ════════════════════════════════════════════════════════════════════════════
   👷 WORK SUITABILITY — what a unit is good at when you put it to work.
   ----------------------------------------------------------------------------
   Palworld's base loop, in this city — with the assignment left in the player's
   hands. You enlist units onto a CREW (beds cap it) and then POST each one to a
   building, and a unit only lifts the building you put it in.

   The whole model is three rolls per unit, all permanent, all read-only here:

     · SUITABILITIES — one to four kinds of WORK it can do, each at a LEVEL 1-4.
                       "Kindling 3, Transporting 1." The level is the thing that
                       matters: a Lv 3 miner is worth three Lv 1 miners.
     · PASSIVES      — nought to three work traits, GOOD AND BAD. Artisan makes
                       a unit 35% faster; Slacker makes it 30% slower. Rolling
                       one is not automatically a prize, which is the whole
                       reason opening a pack is interesting.
     · The unit's own LEVEL and its CONDITION then scale all of it.

   🔴 ELEMENT DECIDES THE ROLL, IT DOES NOT MODIFY IT. This is the load-bearing
   difference from the first cut of this system, where element was a ±30% tweak
   on a bonus. Here a fire unit is overwhelmingly likely to roll KINDLING, a
   water unit WATERING, a nature unit PLANTING — see ELEMENT weighting in
   suitabilitiesFor(). That is what makes "my units' elements decide what they
   are good at" true rather than decorative, and it is why a player looking at a
   new card's element can already guess what it will be useful for.

   🔴 THIS MODULE IS PURE. No DOM, no globals, no I/O, no `window`. It is
   imported by BOTH sides of the app — index.html (which owns the salt and shows
   a unit's work profile) and node-city (which runs the crew) — and that is only
   safe while it stays a data-and-arithmetic file. The globals trap in CLAUDE.md
   is why hosts hand it plain objects instead of it reaching for `Profile` or
   `BUILDINGS`: neither exists from in here.
   ════════════════════════════════════════════════════════════════════════════ */

export const V = 2;

/* ── THE THIRTEEN KINDS OF WORK ────────────────────────────────────────────
   Twelve of them are Palworld's suitabilities, renamed to this city's language
   where its buildings already had a word for the job. RESEARCH is the
   thirteenth and is not from that game: the Research Spire and the Rift Siphon
   are real buildings here with real output, and leaving them off this list
   would mean two buildings no unit in the game could ever help with — a hole
   the player would read as a bug, not as a design.

   `elements` is which elemental units are BORN to the work. It is the roll
   weighting (see suitabilitiesFor), not a bonus. */
export const WORK_TYPES = [
  { id: 'planting',   name: 'Planting',    icon: '🌱', desc: 'Sowing, tending and bringing a crop in.',
    elements: ['nature'],                    also: ['water', 'earth', 'light'] },
  { id: 'watering',   name: 'Watering',    icon: '💧', desc: 'Irrigation, reclamation, anything that moves clean water.',
    elements: ['water', 'spirit'],           also: ['ice', 'nature'] },
  { id: 'kindling',   name: 'Kindling',    icon: '🔥', desc: 'Furnaces, ovens and kilns — holding a heat steady for hours.',
    elements: ['fire', 'lava', 'blood'],     also: ['storm', 'metal'] },
  { id: 'cooling',    name: 'Cooling',     icon: '❄️', desc: 'Chilling, preserving and keeping a store from spoiling.',
    elements: ['ice', 'void'],               also: ['water', 'wind'] },
  { id: 'generating', name: 'Generating',  icon: '⚡', desc: 'Turbines, transformers and everything downstream of the grid.',
    elements: ['storm', 'crystal'],          also: ['arcane', 'metal'] },
  { id: 'handiwork',  name: 'Handiwork',   icon: '🔨', desc: 'Benches, presses and assembly. The trade every workshop runs on.',
    elements: ['metal'],                     also: ['earth', 'crystal', 'psychic', 'arcane'] },
  { id: 'mining',     name: 'Mining',      icon: '⛏️', desc: 'Ore, block and rift-gas, out of ground that does not want to give it.',
    elements: ['earth'],                     also: ['metal', 'gravity', 'lava', 'crystal'] },
  { id: 'lumbering',  name: 'Lumbering',   icon: '🪓', desc: 'Felling the standing dead and bucking it down to usable timber.',
    elements: ['wind'],                      also: ['nature', 'earth', 'metal'] },
  { id: 'medicine',   name: 'Medicine',    icon: '💊', desc: 'Preparing remedies and keeping people alive on them.',
    elements: ['light', 'poison'],           also: ['water', 'spirit', 'nature', 'psychic'] },
  { id: 'transport',  name: 'Transporting', icon: '📦', desc: 'Loading, hauling, forecourts and shop floors. The chain moving.',
    elements: ['gravity', 'wind'],           also: ['earth', 'storm', 'metal'] },
  { id: 'guarding',   name: 'Guarding',    icon: '🛡️', desc: 'Patrols, hose crews and holding a block after dark.',
    elements: ['shadow'],                    also: ['light', 'metal', 'blood', 'psychic'] },
  { id: 'performing', name: 'Performing',  icon: '🎪', desc: 'Crowds, nightlife and the arena floor. Somebody has to draw them in.',
    elements: ['sound'],                     also: ['light', 'fire', 'psychic', 'arcane'] },
  { id: 'research',   name: 'Research',    icon: '🔬', desc: 'Distilling the node hum, and handling what comes off the rift.',
    elements: ['arcane', 'psychic', 'corruption'], also: ['crystal', 'void', 'spirit', 'light'] },
];
/* 🔴 EVERY ONE OF THE GAME'S 21 ELEMENTS IS STRONG AT SOMETHING, and that is a
   requirement, not a coincidence. `elements` is the STRONG list — an element
   that appears in it is born to that work and will usually roll it as its
   primary. `also` is a lean, for flavour and so an element is not a single
   destiny. An element missing from every `elements` list would produce units
   whose element told the player nothing, which is the exact failure the first
   cut of this system had. The mapping, one line per element:
     fire·lava·blood → Kindling      water·spirit → Watering    nature → Planting
     earth → Mining                  metal → Handiwork          wind → Lumbering
     wind·gravity → Transporting     ice·void → Cooling         shadow → Guarding
     storm·crystal → Generating      light·poison → Medicine    sound → Performing
     arcane·psychic·corruption → Research
   ⚠ ADD AN ELEMENT TO THE GAME AND IT MUST BE ADDED HERE, to at least one
     `elements` list. Nothing enforces it — an unlisted element simply rolls
     flat, which is silent and is why this note is long. */
export const WORK_BY_ID = Object.fromEntries(WORK_TYPES.map(w => [w.id, w]));
export const getWork = (id) => WORK_BY_ID[id] || null;

/* ── WHAT EACH BUILDING NEEDS DOING ────────────────────────────────────────
   node-city BUILDINGS keys → the work its crew actually does, PRIMARY FIRST
   (the primary is the one the UI names when it has room for one word).

   🔴 EVERY BUILDING LISTED MUST HAVE `gen` OR `svc`. That is the set whose
   output tileMult() multiplies, and it is the only set where a faster crew
   changes anything. auditBuildings() checks it against the host's real catalog
   at mount, because a work type pointed at a building the tick ignores prints a
   number that never arrives — and a wrong number is worse than none.

   Three deliberate absences, all for the same reason:
     · Warehouse / Housing / Wall — flat capacity or defence, never a rate.
     · Kalon Stable / Stadium — card SINKS with their own meaning for a slotted
       card. Crewing them would be a second, contradictory story on one tile.
     · 🔴 Resting House — `use` and no `gen`. A multiplier there makes it eat
       MORE rations and produce nothing extra, so a good crew would be a
       punishment. The gen/svc rule excludes it for free; this note is here so
       nobody "fixes" the omission. */
export const BUILDING_WORK = {
  // agriculture & water
  farm:        ['planting'],
  hydrofarm:   ['planting', 'watering'],
  fibercroft:  ['planting', 'handiwork'],
  purifier:    ['watering'],
  // extraction
  scrapmine:   ['mining'],
  quarry:      ['mining'],
  fuelrig:     ['mining', 'kindling'],
  lumbercamp:  ['lumbering'],
  // refining & fabrication
  smelter:     ['kindling', 'mining'],
  machineshop: ['handiwork', 'generating'],
  sawmill:     ['lumbering', 'handiwork'],
  weavery:     ['handiwork', 'planting'],
  cannery:     ['cooling', 'kindling'],
  munitions:   ['handiwork', 'kindling'],
  powerstation:['generating', 'kindling'],
  // logistics & trade
  depot:       ['transport', 'handiwork'],
  gasstation:  ['transport'],
  grocery:     ['transport', 'cooling'],
  shop:        ['transport', 'performing'],
  railyard:    ['transport', 'generating'],
  // food service
  foodtruck:   ['kindling', 'transport'],
  restaurant:  ['kindling', 'performing'],
  // health
  medlab:      ['medicine', 'watering'],
  clinic:      ['medicine', 'cooling'],
  // safety
  police:      ['guarding'],
  firestation: ['guarding', 'watering'],
  motorpool:   ['guarding', 'transport'],
  // leisure
  club:        ['performing'],
  arena:       ['performing', 'guarding'],
  // arcane
  reslab:      ['research'],
  siphon:      ['research', 'generating'],
};

/** The work a building needs, primary first. Empty array = nothing to crew. */
export function workNeeds(buildingId) {
  const w = BUILDING_WORK[buildingId];
  return Array.isArray(w) ? w : [];
}

/* ── WORK PASSIVES ─────────────────────────────────────────────────────────
   Palworld's passive skills, and the half of them that make a roll interesting
   is the BAD half. A system where every roll is an upgrade has no tension in it
   — the player never has to choose between two units, because more is always
   more. Clumsy and Slacker are what make "which four do I put in the crew"
   a question worth asking, and what makes a legendary card with Slacker a real
   and memorable disappointment rather than a strictly-better card.

     speed   — multiplies this unit's work output.
     day/night — replaces `speed` during that half of the clock, so a Nocturnal
               unit is not simply better, it is better at the right hours.
     appetite — multiplies rations eaten. See crew upkeep.
     condWear — multiplies how fast condition falls when underfed.
   Any field absent = ×1. */
export const PASSIVE_RARITY_WEIGHT = { common: 100, uncommon: 42, rare: 14, legendary: 4 };
export const PASSIVE_RARITY_COLOR  = { common: '#9aa0a6', uncommon: '#5eb37a', rare: '#5a9bd4', legendary: '#d4af37' };
export const PASSIVES = [
  // ── good ──
  { id: 'diligent',  name: 'Diligent',    icon: '🐝', rarity: 'common',    good: true,  speed: 1.10,
    desc: 'Works steadily and does not need telling twice. +10% work speed.' },
  { id: 'hardy',     name: 'Hardy',       icon: '🫀', rarity: 'common',    good: true,  condWear: 0.5,
    desc: 'Keeps its condition on short rations. Wears down at half rate when the city is short.' },
  { id: 'lighteater',name: 'Light Eater', icon: '🥄', rarity: 'uncommon',  good: true,  appetite: 0.6,
    desc: 'Eats 40% less than the rest of the crew.' },
  { id: 'serious',   name: 'Serious',     icon: '🎯', rarity: 'uncommon',  good: true,  speed: 1.20,
    desc: 'Head down, no fuss. +20% work speed.' },
  { id: 'nocturnal', name: 'Nocturnal',   icon: '🌙', rarity: 'uncommon',  good: true,  night: 1.30, day: 0.85,
    desc: 'Comes alive after dark. +30% work speed at night, −15% by day.' },
  { id: 'earlyriser',name: 'Early Riser', icon: '☀️', rarity: 'uncommon',  good: true,  day: 1.25, night: 0.85,
    desc: 'Up before the shift. +25% work speed by day, −15% at night.' },
  { id: 'lucky',     name: 'Lucky',       icon: '🍀', rarity: 'rare',      good: true,  speed: 1.18, appetite: 0.9,
    desc: 'Things simply go its way. +18% work speed and eats a little less.' },
  { id: 'artisan',   name: 'Artisan',     icon: '🛠️', rarity: 'rare',      good: true,  speed: 1.35,
    desc: 'Does it properly, and does it fast. +35% work speed.' },
  { id: 'legendhand',name: 'Legendary Hand', icon: '👑', rarity: 'legendary', good: true, speed: 1.50, condWear: 0.7,
    desc: 'The best hand in the city, and it knows it. +50% work speed, and hard to wear down.' },
  // ── bad. See the header: these are the point. ──
  { id: 'clumsy',    name: 'Clumsy',      icon: '😵', rarity: 'common',    good: false, speed: 0.80,
    desc: 'Breaks about as much as it makes. −20% work speed.' },
  { id: 'glutton',   name: 'Glutton',     icon: '🍗', rarity: 'common',    good: false, appetite: 1.6, speed: 1.08,
    desc: 'Eats 60% more than the rest of the crew — and, to be fair, works 8% harder for it.' },
  { id: 'brittle',   name: 'Brittle',     icon: '🩹', rarity: 'common',    good: false, condWear: 1.8,
    desc: 'Goes to pieces the moment rations get short. Wears down almost twice as fast.' },
  { id: 'slacker',   name: 'Slacker',     icon: '💤', rarity: 'uncommon',  good: false, speed: 0.70,
    desc: 'Found leaning on things. −30% work speed.' },
];
export const PASSIVE_BY_ID = Object.fromEntries(PASSIVES.map(p => [p.id, p]));
export const getPassive = (id) => PASSIVE_BY_ID[id] || null;

/* ── THE ARITHMETIC ────────────────────────────────────────────────────────
   One worker's contribution to the building it is working:

     contribution = SUIT_STEP × suitLevel × levelMul × speedMul × condMul

   and a building's crew boost is the SUM of its workers' contributions, clamped
   to BOOST_CAP. Multiplier = 1 + boost, so BOOST_CAP = 1.00 means:

     🔴 NOTHING THE CREW DOES CAN MORE THAN DOUBLE A BUILDING.

   That is a promise printed in the UI, so it is a hard clamp rather than
   something that happens to fall out of five multiplications. It also keeps the
   crew honest against node-city's own TILE_MULT_CAP: crew is one term inside
   that product, not a way around it.

   The numbers, solved rather than picked:
     one PERFECT worker  — suit 4 × Lv 50 × Artisan × fed
                         = 0.10×4 × 1.25 × 1.35 × 1.00 = 0.675  → ×1.68
     two GOOD workers    — suit 3, Lv 30, no passive, fed
                         = 2 × (0.30 × 0.94 × 1.00 × 1.00)      → ×1.56
   So one outstanding unit is most of the way to a doubled building and a second
   finishes it — which is the shape that makes hunting for a good roll feel
   worth doing without making a second unit pointless.

   COND_FLOOR is why a starving crew degrades instead of stopping. A city that
   runs out of rations is already in a spiral; a crew that downs tools entirely
   would deepen it faster than the player can react, and the classic outcome is
   a save that cannot be recovered. 0.30 is a bad day, not a cliff. */
export const WORK = {
  SUIT_STEP:  0.10,   // per suitability level
  SUIT_MAX:   4,      // levels 1..4, as Palworld
  LVL_MIN:    0.50,   // unit level 1
  LVL_FULL:   1.25,   // unit level LVL_MAX
  LVL_MAX:    50,     // MAX_LVL in index.html — see the note below
  BOOST_CAP:  1.00,   // ⇒ ×2.00 output, the promise
  COND_FLOOR: 0.30,   // output multiplier at condition 0
  COND_MAX:   100,
};

/* ⚠ LVL_MAX IS A COPY OF index.html's MAX_LVL (=50) AND CANNOT IMPORT IT.
   index.html is not a module and `const MAX_LVL` is a global lexical binding
   invisible from here (CLAUDE.md, "the globals trap"). It only normalises the
   level ramp, so a drift makes veterans scale slightly wrong — it can never
   divide by zero or breach BOOST_CAP. Move it if the game's cap ever moves. */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** How much of the level ramp a unit at `level` has earned. */
export function levelMul(level) {
  const lv = Math.max(1, Math.min(WORK.LVL_MAX, Math.round(Number(level) || 1)));
  return WORK.LVL_MIN + (WORK.LVL_FULL - WORK.LVL_MIN) * clamp01((lv - 1) / (WORK.LVL_MAX - 1));
}

/* ── THE ROLL ──────────────────────────────────────────────────────────────
   🔴 DERIVED, NOT STORED, and this is deliberate against the obvious
   alternative. The combat trait (index.html, ensureUnitTrait) rolls with
   Math.random() and writes the unit's profile row on first field. Copying that
   here would mean the city bridge — which walks the player's ENTIRE collection
   every time a crew panel opens — either stamped and saved up to 500 rows the
   first time anyone looked, or handed the panel a roster whose suitabilities
   appeared as you scrolled.

   So every roll is a pure function of (per-player salt, card id). That gets all
   three properties at once:
     • RANDOM per player — the salt is rolled once per account, so two players
       holding the same card get different work profiles, exactly like traits.
     • STABLE forever — no write, no migration, and no "why is my miner suddenly
       a cook" when a save round-trips through the cloud.
     • FREE — the crew panel can profile 500 cards on every open.
   The salt is the only thing a host must persist; losing it re-rolls the roster
   rather than corrupting anything. */
export function makeSalt() {
  try {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const a = new Uint32Array(2); crypto.getRandomValues(a);
      return a[0].toString(36) + a[1].toString(36);
    }
  } catch (e) {}
  return Math.floor(Math.random() * 0xffffffff).toString(36) + Math.floor(Math.random() * 0xffffffff).toString(36);
}

// FNV-1a, then murmur3's fmix32 finaliser. Same base hash the citizen namer
// uses (citizens.city.js); the finaliser is the part that matters here — see
// stream() below for the bug it exists to prevent.
function hash32(s) {
  let h = 2166136261 >>> 0;
  s = String(s);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 16; h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}
/* A small deterministic stream off one seed string, so every draw for one card
   is reproducible. `next()` returns a float in [0,1).

   🔴 THE COUNTER GOES IN FRONT OF THE SEED, AND THE HASH HAS A FINALISER.
   Both are load-bearing, and the first version of this had neither. It hashed
   `seed + '#' + i`, which looks obviously fine and is not: FNV-1a folds the
   string left to right, so two draws differing only in the LAST character end
   as (h ^ '0') × PRIME and (h ^ '4') × PRIME — the same h, xored with two
   values four apart. The two results therefore differ by a CONSTANT, ±4×PRIME.
   Every draw was individually uniform (measured, and it passes), and every pair
   was almost perfectly correlated.

   That does not matter until something conditions on one draw and reads
   another, which is exactly what this file does: draw 0 decides how many
   suitabilities a unit gets, and draws 4, 6, 8 are the second, third and fourth
   types — read only when draw 0 came out high. Conditioning on draw 0 therefore
   conditioned draw 4, and the secondary suitabilities collapsed onto one end of
   the table: over 20,000 units, Guarding came up 3,447 times and Handiwork
   never once, against 975 apiece expected. It shipped nothing, but it would
   have shipped as "why is every one of my units a guard", and nobody would have
   found it by reading the roll.

   Putting the counter FIRST makes the whole FNV chain diverge from the first
   byte; the fmix32 finaliser then avalanches whatever is left. Either alone
   fixes the measurement; both are here because this is the kind of fault that
   is invisible in review and expensive in play. */
function stream(seed) {
  let i = 0;
  return { next: () => hash32((i++) + '#' + seed) / 4294967296 };
}
function pickWeighted(list, weightOf, r) {
  const total = list.reduce((a, x) => a + weightOf(x), 0);
  if (total <= 0) return list[0];
  let v = r * total;
  for (const x of list) { const w = weightOf(x); if (v < w) return x; v -= w; }
  return list[list.length - 1];
}

const COUNT_W  = [55, 30, 12, 3];        // how many suitabilities: 1,2,3,4
const LEVEL_W  = [45, 32, 17, 6];        // suitability level: 1,2,3,4
const PASS_W   = [30, 38, 24, 8];        // how many passives: 0,1,2,3
const AFFINE_W = 18;                     // STRONG element match on the primary draw
const ALSO_W   = 4;                      // a lean toward it; everything else is 1
/* ⚠ THE RARITY BUMP APPLIES TO THE PRIMARY SUITABILITY ONLY, and legendary is
   +1, not +2. Both were wrong first time round: applied to every suitability at
   +2, a legendary card came out with three or four maxed skills and was simply
   better at everything, which flattens the whole point of the roll — you would
   never compare two units again, you would read their rarity. A legendary is
   BETTER AT WHAT IT DOES, not suited to more things. */
const RARITY_LEVEL_BUMP = { common: 0, uncommon: 0, rare: 1, epic: 1, legendary: 1 };

function countFrom(weights, r) {
  const total = weights.reduce((a, b) => a + b, 0);
  let v = r * total;
  for (let i = 0; i < weights.length; i++) { if (v < weights[i]) return i; v -= weights[i]; }
  return weights.length - 1;
}

/* The unit's kinds of work, best first. `opts.elements` steers the roll and
   `opts.rarity` nudges the LEVELS (a legendary card is not suited to more
   things than a common one — it is better at what it does), and the primary
   suitability draws its level twice and keeps the higher, which is what makes
   a fire unit's Kindling reliably worth having rather than a coin flip. */
export function suitabilitiesFor(cardId, salt, opts) {
  if (!cardId) return [];
  const o = opts || {};
  const els = (Array.isArray(o.elements) ? o.elements : (o.element ? [o.element] : []))
    .map(e => String(e || '').toLowerCase()).filter(Boolean);
  const bump = RARITY_LEVEL_BUMP[String(o.rarity || '').toLowerCase()] || 0;
  const rng = stream(String(salt || '') + '|' + String(cardId));

  const weightOf = (w) => (w.elements.some(e => els.indexOf(e) >= 0) ? AFFINE_W
                        : (w.also || []).some(e => els.indexOf(e) >= 0) ? ALSO_W : 1);
  const n = 1 + countFrom(COUNT_W, rng.next());
  const pool = WORK_TYPES.slice();
  const out = [];
  for (let i = 0; i < n && pool.length; i++) {
    // Only the FIRST draw is element-weighted. The rest are flat, so a unit's
    // element tells you what it is FOR without telling you everything about it
    // — the second and third suitabilities are where the surprises live, and a
    // fire unit that also happens to be a Lv 3 miner is a card with a story.
    const w = pickWeighted(pool, (x) => (i === 0 ? weightOf(x) : 1), rng.next());
    pool.splice(pool.indexOf(w), 1);
    let lv = 1 + countFrom(LEVEL_W, rng.next());
    // The primary draws twice and keeps the better roll, so a unit's headline
    // skill is reliably worth having rather than a coin flip that often lands
    // on 1 — "a fire unit is a furnace hand" has to be true often enough to be
    // a fact the player can plan around.
    if (i === 0) lv = Math.max(lv, 1 + countFrom(LEVEL_W, rng.next())) + bump;
    lv = Math.max(1, Math.min(WORK.SUIT_MAX, lv));
    out.push({ type: w.id, level: lv, primary: i === 0 });
  }
  // Best first for display. `primary` survives the sort so the UI can still say
  // which one the unit's element gave it, even when a later draw outranks it.
  return out.sort((a, b) => (b.level - a.level) || (a.primary ? -1 : b.primary ? 1 : 0));
}

/* Work passives, good and bad. Drawn from a stream OFFSET from the suitability
   stream so adding or removing a suitability draw can never silently reshuffle
   every unit's passives — the two rolls are independent by construction. */
export function passivesFor(cardId, salt, opts) {
  if (!cardId) return [];
  const rng = stream(String(salt || '') + '|p|' + String(cardId));
  const n = countFrom(PASS_W, rng.next());
  const pool = PASSIVES.slice();
  const out = [];
  for (let i = 0; i < n && pool.length; i++) {
    const p = pickWeighted(pool, (x) => PASSIVE_RARITY_WEIGHT[x.rarity] || 1, rng.next());
    pool.splice(pool.indexOf(p), 1);
    out.push(p);
  }
  return out;
}

/* ── The profile, memoised ─────────────────────────────────────────────────
   The crew engine scores every member against every job on every reassignment,
   and the panel profiles the whole collection on every open. Rolling is cheap
   but not free, and it is provably identical for one (salt, card), so it is
   cached. Bounded so a large collection browsed for a long session cannot grow
   the map without limit. */
const PROFILE_CACHE = new Map();
const PROFILE_CACHE_MAX = 2000;
export function profileFor(card, salt) {
  if (!card || !card.id) return { id: null, suits: [], passives: [], level: 1 };
  const key = String(salt || '') + '|' + card.id + '|' + (card.level | 0);
  const hit = PROFILE_CACHE.get(key);
  if (hit) return hit;
  const p = {
    id: card.id,
    level: Math.max(1, Math.min(WORK.LVL_MAX, (card.level | 0) || 1)),
    suits: suitabilitiesFor(card.id, salt, card),
    passives: passivesFor(card.id, salt, card),
  };
  if (PROFILE_CACHE.size >= PROFILE_CACHE_MAX) PROFILE_CACHE.clear();
  PROFILE_CACHE.set(key, p);
  return p;
}
/** Drop the memo — only needed when the salt itself changes under a live page. */
export function clearProfileCache() { PROFILE_CACHE.clear(); }

/** This unit's level in one kind of work, 0 if it cannot do it at all. */
export function suitLevel(profile, workType) {
  if (!profile || !workType) return 0;
  const s = (profile.suits || []).find(x => x.type === workType);
  return s ? s.level : 0;
}

/** The best work this unit can do at this building: {type, level} or null. */
export function bestWorkAt(profile, buildingId) {
  let best = null;
  for (const t of workNeeds(buildingId)) {
    const lv = suitLevel(profile, t);
    if (lv > 0 && (!best || lv > best.level)) best = { type: t, level: lv };
  }
  return best;
}

/* Passive speed. `env.night` picks the day/night face of a passive that has
   one. A passive with neither `speed` nor a day/night pair contributes ×1 —
   Hardy and Light Eater pay off elsewhere, not here. */
export function speedMul(profile, env) {
  const night = !!(env && env.night);
  let m = 1;
  for (const p of (profile && profile.passives) || []) {
    const face = night ? p.night : p.day;
    m *= (typeof face === 'number') ? face : (typeof p.speed === 'number' ? p.speed : 1);
  }
  return m;
}
/** Rations eaten, as a multiple of one crew member's base appetite. */
export function appetiteMul(profile) {
  let m = 1;
  for (const p of (profile && profile.passives) || []) if (typeof p.appetite === 'number') m *= p.appetite;
  return m;
}
/** How fast condition falls when underfed, as a multiple of the base rate. */
export function condWearMul(profile) {
  let m = 1;
  for (const p of (profile && profile.passives) || []) if (typeof p.condWear === 'number') m *= p.condWear;
  return m;
}
/** Condition 0-100 → the output multiplier it buys. Never below COND_FLOOR. */
export function condMul(condition) {
  const c = clamp01((Number(condition) == null ? WORK.COND_MAX : Number(condition)) / WORK.COND_MAX);
  return WORK.COND_FLOOR + (1 - WORK.COND_FLOOR) * c;
}

/* ── ONE WORKER AT ONE BUILDING ────────────────────────────────────────────
   Returns everything the UI needs to explain the number, not just the number.
   A player looking at "+42%" has to be able to see which of the four legs
   produced it, or the figure is folklore — the same reason node-city's
   insFactors() decomposes its tile multiplier instead of printing one total. */
export function workPower(card, profile, buildingId, env) {
  const out = { work: null, suit: 0, levelMul: WORK.LVL_MIN, speed: 1, cond: 1, power: 0, night: !!(env && env.night) };
  if (!profile) return out;
  const best = bestWorkAt(profile, buildingId);
  if (!best) return out;
  out.work = best.type;
  out.suit = best.level;
  out.levelMul = levelMul(profile.level);
  out.speed = speedMul(profile, env);
  out.cond = condMul(env && env.condition != null ? env.condition : WORK.COND_MAX);
  out.power = WORK.SUIT_STEP * out.suit * out.levelMul * out.speed * out.cond;
  return out;
}

/** A building's crew boost from its assigned workers' contributions. Clamped. */
export function boostFrom(powers) {
  let sum = 0;
  for (const p of powers || []) sum += (p && p.power) || 0;
  return Math.min(WORK.BOOST_CAP, Math.max(0, sum));
}
/** …and as the multiplier the tick applies. 1.00 … 2.00. */
export function multFrom(powers) { return 1 + boostFrom(powers); }

/** "×1.68" / "×2.00 — doubled". Short enough for a tile tooltip. */
export function multLabel(mult) {
  return '×' + Number(mult || 1).toFixed(2) + (mult >= 1 + WORK.BOOST_CAP - 1e-9 ? ' — doubled' : '');
}

/** A one-line summary of a unit's suitabilities: "🔥 Kindling 3 · 📦 Transporting 1". */
export function suitsLabel(profile) {
  const s = (profile && profile.suits) || [];
  if (!s.length) return 'No work suitability';
  return s.map(x => { const w = getWork(x.type); return (w ? w.icon + ' ' + w.name : x.type) + ' ' + x.level; }).join(' · ');
}

/* ── THE ONE CONSISTENCY CHECK ─────────────────────────────────────────────
   Ties BUILDING_WORK to the host's real catalog: a building named here that
   does not exist, or whose output the tick never multiplies, would advertise a
   crew job that pays nothing. The host calls this at mount and warns; it is a
   console warning rather than a throw because a stale catalog entry must never
   be able to stop the city from booting.
   `defs` is node-city's BUILDINGS ({ id: { gen, svc, … } }). */
export function auditBuildings(defs) {
  const bad = [];
  if (!defs || typeof defs !== 'object') return bad;
  for (const id in BUILDING_WORK) {
    const d = defs[id];
    if (!d) { bad.push(id + ' — no such building'); continue; }
    if (!d.gen && !d.svc) bad.push(id + ' — no gen/svc, so a faster crew changes nothing there');
    for (const w of BUILDING_WORK[id]) if (!WORK_BY_ID[w]) bad.push(id + ' → ' + w + ' — no such work type');
  }
  return bad;
}
/** Buildings that need a given kind of work — for "where can this unit help?". */
export function buildingsNeeding(workType) {
  return Object.keys(BUILDING_WORK).filter(id => BUILDING_WORK[id].indexOf(workType) >= 0);
}
