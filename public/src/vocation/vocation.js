/* ════════════════════════════════════════════════════════════════════════════
   🧑‍🌾 VOCATIONS — what a unit is GOOD AT when you put it to work in the city.
   ----------------------------------------------------------------------------
   The game already gives every unit a combat TRAIT (index.html, `TRAITS` /
   rollTrait) and an ELEMENT. Neither means anything the moment the player
   leaves the battle board: a Lv-50 nature unit and a Lv-1 void unit socketed
   into the same Farm produced the identical +power/100 nudge.

   A VOCATION is the civic half of that idea — a second, independent roll that
   says which BUILDINGS this unit has a knack for. Slot it into a building its
   vocation covers and the tile's whole output multiplier goes up; slot it
   somewhere else and it is just a card in a socket, exactly as before.

   Three inputs decide how much it helps, which is the whole design:
     1. VOCATION  — does this unit's speciality cover this building at all?
                    No match ⇒ ×1.00. Nothing else can rescue that.
     2. ELEMENT   — is the unit's element in tune with the work? A nature unit
                    on a Farm is attuned; a lava unit on a Farm is a liability.
     3. LEVEL     — a veteran is worth more than a rookie at the same job.
   The product tops out at exactly ×2.00 (APT.CAP): a max-level unit whose
   vocation AND element both fit doubles the building. That number is a promise
   made to the player in the UI, which is why it is a hard clamp and not an
   emergent property of three multiplications.

   🔴 THIS MODULE IS PURE. No DOM, no globals, no I/O, no `window`. It is
   imported by BOTH sides of the app — index.html (which owns the roll and the
   save) and node-city/index.html (which owns the buildings and the tick) — and
   that is only safe while it stays a data-and-arithmetic file. The globals trap
   in CLAUDE.md is exactly why the hosts hand it plain objects instead of it
   reaching for `Profile` or `BUILDINGS`: neither exists from in here.

   ⚠ BUILDING IDS ARE node-city's `BUILDINGS` KEYS. They are referenced, not
   defined, here — see `coveredBuildings()` for the one rule that keeps the two
   lists honest, and the "WHERE A BOOST ACTUALLY LANDS" note below it.
   ════════════════════════════════════════════════════════════════════════════ */

export const V = 1;                     // save-blob version for anything persisted

/* ── Rarity ────────────────────────────────────────────────────────────────
   Same four bands and the same weights as the combat TRAITS table, so a player
   who has learned what "rare" means on a trait has learned it here too.
   ⚠ RARITY BUYS BREADTH, NOT DEPTH. The aptitude ceiling is APT.CAP for every
   vocation in the list — a legendary Polymath boosts a Farm by exactly as much
   as a common Farmhand does. What it buys is the number of buildings where it
   boosts anything at all. Letting rarity raise the ceiling instead would make
   the whole city-builder a lottery for one card, which is the failure mode the
   TILE_MULT_CAP comment in node-city is already fighting. */
export const VOC_RARITY_WEIGHT = { common: 100, uncommon: 42, rare: 14, legendary: 4 };
export const VOC_RARITY_COLOR  = { common: '#9aa0a6', uncommon: '#5eb37a', rare: '#5a9bd4', legendary: '#d4af37' };

/* ── The aptitude arithmetic ───────────────────────────────────────────────
   mult = 1 + gain × levelMul(level),  clamped to CAP.

     gain     = VOC_BASE                       (vocation covers this building)
              + ELEM_ATTUNED | ELEM_CLASH | 0  (element vs. the work)
     levelMul = LVL_MIN … LVL_FULL, linear over levels 1…LVL_MAX

   Solved so the headline case is exact rather than approximate:
     max gain     = 0.50 + 0.30 = 0.80
     max levelMul = 1.25
     max mult     = 1 + 0.80 × 1.25 = 2.00   ← the doubled Farm, exactly.

   The floors matter as much as the ceiling. A LEVEL-1 unit whose vocation fits
   is already worth ×1.25 (0.50 × 0.50), because a system whose entry state is
   "+3%" reads as broken rather than as early. And a clashing element is a
   PENALTY on the gain, never below zero overall: the worst a matched unit can
   do is ×1.10, so putting a lava unit on a farm is a bad choice, not a trap
   that makes the building worse than empty. Anything that can make a socket a
   net negative teaches players not to use the feature at all.

   ⚠ TUNE HERE, NOWHERE ELSE. These five numbers are the entire dial. The
   catalog below carries no magnitudes on purpose — a vocation that quietly
   shipped its own multiplier would be invisible to whoever retunes this. */
export const APT = {
  VOC_BASE:     0.50,   // vocation covers the building
  ELEM_ATTUNED: 0.30,   // …and its element suits the work
  ELEM_CLASH:  -0.15,   // …or actively fights it
  LVL_MIN:      0.50,   // level 1
  LVL_FULL:     1.25,   // level LVL_MAX
  LVL_MAX:      50,     // MAX_LVL in index.html. Not imported — see below.
  CAP:          2.00,   // the promise. Never let a change here exceed it.
};

/* ⚠ LVL_MAX IS A COPY OF index.html's MAX_LVL (=50) AND CANNOT IMPORT IT.
   index.html is not a module and `const MAX_LVL` is a global lexical binding
   invisible from here (CLAUDE.md, "the globals trap"). It is only used to
   normalise the level ramp, so a drift makes veterans scale slightly wrong —
   it can never divide by zero or exceed CAP. If the game's cap ever moves,
   move this with it. */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** How much of the level ramp a unit at `level` has earned. 1 → LVL_MIN, LVL_MAX → LVL_FULL. */
export function levelMul(level) {
  const lv = Math.max(1, Math.min(APT.LVL_MAX, Math.round(Number(level) || 1)));
  return APT.LVL_MIN + (APT.LVL_FULL - APT.LVL_MIN) * clamp01((lv - 1) / (APT.LVL_MAX - 1));
}

/* ── THE CATALOG ───────────────────────────────────────────────────────────
   Each entry:
     buildings — node-city BUILDINGS keys this vocation is good at, or '*' for
                 "any building that does work" (the one legendary generalist).
     elements  — ELEMENTS ids that SUIT the work (+ELEM_ATTUNED).
     clash     — ELEMENTS ids that FIGHT it (ELEM_CLASH).
                 An element in neither list is simply neutral.

   🔴 EVERY LISTED BUILDING MUST BE ONE WHERE tileMult() CHANGES SOMETHING —
   i.e. it has `gen` or `svc`. See "WHERE A BOOST ACTUALLY LANDS" below; the
   host asserts it at mount. Listing a Warehouse (storage), a Kalon Stable
   (a card sink) or a Resting House (input-only: a multiplier there would make
   it eat MORE and produce nothing extra) would print an aptitude the tick then
   ignores — or, for the House, actively punish the player for a good roll.

   Element choices are thematic, not mechanical, and they are meant to be
   guessable before they are read: water and nature grow things, fire and lava
   smelt things, corruption and void spoil food and taint water. A player should
   be able to predict a match without opening a table. */
export const VOCATIONS = [
  // ── Common: the backbone jobs a starting city is made of ────────────────
  { id: 'farmhand', name: 'Farmhand', icon: '🌾', rarity: 'common',
    desc: 'Raised on a field. Knows when to sow and when to leave it alone.',
    buildings: ['farm', 'hydrofarm', 'fibercroft'],
    elements: ['nature', 'water', 'light', 'earth'],
    clash:    ['corruption', 'poison', 'lava', 'void'] },
  { id: 'waterwarden', name: 'Water Warden', icon: '💧', rarity: 'common',
    desc: 'Reads a water table like a page. Nothing they draw runs foul.',
    buildings: ['purifier', 'medlab', 'clinic'],
    elements: ['water', 'ice', 'nature', 'spirit'],
    clash:    ['fire', 'lava', 'poison', 'corruption'] },
  { id: 'prospector', name: 'Prospector', icon: '⛏️', rarity: 'common',
    desc: 'Hears the seam through the rock. Never swings twice at dead stone.',
    buildings: ['scrapmine', 'quarry'],
    elements: ['earth', 'metal', 'crystal', 'gravity'],
    clash:    ['wind', 'spirit', 'void'] },
  { id: 'hauler', name: 'Hauler', icon: '📦', rarity: 'common',
    desc: 'Packs a crate so nothing shifts and nothing spoils. The chain moves.',
    buildings: ['depot', 'railyard', 'motorpool'],
    elements: ['earth', 'metal', 'wind', 'gravity'],
    clash:    ['void', 'corruption'] },
  { id: 'forester', name: 'Forester', icon: '🪵', rarity: 'common',
    desc: 'Fells the standing dead and leaves the living. Twice the timber, half the waste.',
    buildings: ['lumbercamp', 'sawmill'],
    elements: ['nature', 'earth', 'wind', 'spirit'],
    clash:    ['fire', 'lava', 'corruption'] },

  // ── Uncommon: the trades a city grows into ──────────────────────────────
  { id: 'cook', name: 'Cook', icon: '🍳', rarity: 'uncommon',
    desc: 'Can feed a district off what the last cook threw away.',
    buildings: ['cannery', 'foodtruck', 'restaurant', 'grocery'],
    elements: ['fire', 'nature', 'water', 'light'],
    clash:    ['poison', 'corruption', 'void'] },
  { id: 'weaver', name: 'Weaver', icon: '🧵', rarity: 'uncommon',
    desc: 'Retting pit to bolt cloth without a thread wasted.',
    buildings: ['fibercroft', 'weavery'],
    elements: ['nature', 'wind', 'light', 'spirit'],
    clash:    ['fire', 'lava', 'corruption'] },
  { id: 'roughneck', name: 'Roughneck', icon: '🛢️', rarity: 'uncommon',
    desc: 'Works a rift-gas pocket without flinching, which is most of the skill.',
    buildings: ['fuelrig', 'gasstation'],
    elements: ['fire', 'lava', 'earth', 'gravity'],
    clash:    ['water', 'ice', 'spirit'] },
  { id: 'metallurgist', name: 'Metallurgist', icon: '🏭', rarity: 'uncommon',
    desc: 'Knows the colour a melt turns a half-second before it is ready.',
    buildings: ['smelter', 'machineshop', 'munitions'],
    elements: ['fire', 'metal', 'lava', 'earth'],
    clash:    ['water', 'ice', 'nature'] },
  { id: 'engineer', name: 'Engineer', icon: '⚡', rarity: 'uncommon',
    desc: 'Keeps the turbine hall spinning and the lights on the street lit.',
    buildings: ['powerstation', 'machineshop', 'railyard'],
    elements: ['storm', 'metal', 'arcane', 'light'],
    clash:    ['void', 'corruption', 'gravity'] },
  { id: 'constable', name: 'Constable', icon: '🚓', rarity: 'uncommon',
    desc: 'Holds a block by being on it. Corruption falls fastest inside their beat.',
    buildings: ['police', 'firestation', 'motorpool'],
    elements: ['light', 'metal', 'earth', 'psychic'],
    clash:    ['shadow', 'corruption', 'void', 'blood'] },

  // ── Rare: the specialists ───────────────────────────────────────────────
  { id: 'barker', name: 'Barker', icon: '🎪', rarity: 'rare',
    desc: 'Can turn six bored citizens into a paying crowd before the bell.',
    buildings: ['arena', 'club'],
    elements: ['sound', 'light', 'psychic', 'fire'],
    clash:    ['shadow', 'void', 'gravity'] },
  { id: 'broker', name: 'Broker', icon: '🤝', rarity: 'rare',
    desc: 'Never sells at the first price. Never buys at the second.',
    buildings: ['shop', 'grocery', 'gasstation'],
    elements: ['light', 'psychic', 'arcane', 'crystal'],
    clash:    ['corruption', 'void', 'shadow'] },
  { id: 'scholar', name: 'Scholar', icon: '🧠', rarity: 'rare',
    desc: 'Distills a week of node hum into one usable page.',
    buildings: ['reslab', 'clinic'],
    elements: ['psychic', 'arcane', 'crystal', 'spirit'],
    clash:    ['blood', 'corruption', 'sound'] },
  { id: 'riftwarden', name: 'Rift Warden', icon: '🟣', rarity: 'rare',
    desc: 'Handles what comes off the rift without needing to be told twice.',
    buildings: ['siphon', 'reslab'],
    elements: ['void', 'corruption', 'shadow', 'arcane'],
    clash:    ['light', 'nature', 'spirit'] },

  // ── Legendary: breadth, and only breadth. See VOC_RARITY_WEIGHT. ────────
  { id: 'magnate', name: 'Magnate', icon: '📈', rarity: 'legendary',
    desc: 'Everything with a till in it runs better once they are standing behind it.',
    buildings: ['shop', 'gasstation', 'arena', 'club', 'grocery', 'restaurant', 'foodtruck'],
    elements: ['crystal', 'light', 'psychic', 'gravity', 'arcane'],
    clash:    ['corruption', 'void'] },
  { id: 'polymath', name: 'Polymath', icon: '🛠️', rarity: 'legendary',
    desc: 'Has done every job in the city once and remembers all of them.',
    buildings: '*',
    elements: ['arcane', 'light', 'psychic', 'crystal'],
    clash:    [] },
];

export const VOCATION_BY_ID = Object.fromEntries(VOCATIONS.map(v => [v.id, v]));
export const getVocation = (id) => VOCATION_BY_ID[id] || null;

/* ── WHERE A BOOST ACTUALLY LANDS ──────────────────────────────────────────
   The one rule tying this catalog to node-city's BUILDINGS: a vocation may only
   name a building whose output the tick actually multiplies. The host passes
   its own catalog in and gets back the ids that broke the rule, so a typo or a
   renamed building surfaces as a console warning at mount instead of as a
   number on the dossier that the economy quietly ignores.
   `defs` is node-city's BUILDINGS object ({ id: { gen, svc, … } }). */
export function auditBuildings(defs) {
  const bad = [];
  if (!defs || typeof defs !== 'object') return bad;
  for (const v of VOCATIONS) {
    if (v.buildings === '*') continue;
    for (const b of v.buildings) {
      const d = defs[b];
      if (!d) { bad.push(v.id + ' → ' + b + ' (no such building)'); continue; }
      if (!d.gen && !d.svc) bad.push(v.id + ' → ' + b + ' (no gen/svc — a multiplier does nothing there)');
    }
  }
  return bad;
}

/** Does `voc` cover `buildingId`? `defs` is only consulted for the '*' generalist. */
export function covers(voc, buildingId, defs) {
  if (!voc || !buildingId) return false;
  if (voc.buildings === '*') {
    // The generalist is good at WORK, not at storage or decoration. Without the
    // catalog to ask, assume yes — the host is the one that knows, and a
    // standalone caller (a test, the picker preview) is better served by an
    // optimistic answer than by a silent false.
    const d = defs && defs[buildingId];
    return d ? !!(d.gen || d.svc) : true;
  }
  return voc.buildings.indexOf(buildingId) >= 0;
}

/* ── THE ROLL ──────────────────────────────────────────────────────────────
   🔴 DERIVED, NOT STORED — and this is deliberate, against the obvious
   alternative. The combat trait is rolled with Math.random() and written into
   Profile.units[cardId].trait on first field (ensureUnitTrait). Copying that
   here would mean the city bridge — which walks the player's ENTIRE collection
   on every open — either stamped and saved up to 500 rows the first time
   anyone looked at a socket, or handed the city a collection where most cards
   had no vocation yet and the picker's numbers changed as you scrolled.

   So a vocation is a pure function of (per-player salt, card id). That gets all
   three properties the feature needs at once:
     • RANDOM per player — the salt is rolled once, per account, and two players
       holding the same card get different vocations, exactly like traits.
     • STABLE forever — no write, no migration, no "why did my farmhand become
       a rift warden" when a save round-trips through the cloud.
     • FREE to evaluate — the picker can score 500 cards against a building
       every time it opens without touching the profile.
   The salt is the ONLY thing the host has to persist, and losing it re-rolls
   the whole roster rather than corrupting anything.

   Weighted by rarity, so a legendary Polymath stays a ~1-in-40 card. */
export function makeSalt() {
  // 32 bits of entropy, base36. crypto when available; Math.random is a fine
  // fallback because this is flavour, not security.
  try {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const a = new Uint32Array(2); crypto.getRandomValues(a);
      return a[0].toString(36) + a[1].toString(36);
    }
  } catch (e) {}
  return Math.floor(Math.random() * 0xffffffff).toString(36) + Math.floor(Math.random() * 0xffffffff).toString(36);
}

// FNV-1a. Same hash the citizen namer uses (citizens.city.js) — a known-good
// avalanche on short ASCII keys, and no dependency.
function hash32(s) {
  let h = 2166136261 >>> 0;
  s = String(s);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

/** The weighted pool for a card. `pool` (card.vocationPool) restricts it, mirroring card.traitPool. */
function poolFor(pool) {
  if (Array.isArray(pool) && pool.length) {
    const allowed = VOCATIONS.filter(v => pool.indexOf(v.id) >= 0);
    if (allowed.length) return allowed;
  }
  return VOCATIONS;
}

/** Deterministic weighted pick. This is the path the game actually uses. */
export function vocationForCard(cardId, salt, pool) {
  const list = poolFor(pool);
  const total = list.reduce((a, v) => a + (VOC_RARITY_WEIGHT[v.rarity] || 1), 0);
  // hash / 2^32 ∈ [0,1) — the same card id under a different salt lands
  // somewhere unrelated in the table, which is what makes it per-player.
  let r = (hash32(String(salt || '') + '|' + String(cardId)) / 4294967296) * total;
  for (const v of list) {
    const w = VOC_RARITY_WEIGHT[v.rarity] || 1;
    if (r < w) return v;
    r -= w;
  }
  return list[list.length - 1];
}

/** Live weighted roll. Kept for anything that wants a genuinely fresh draw
    (a re-roll sink, admin tooling, tests) — nothing in the game calls it yet. */
export function rollVocation(pool) {
  const list = poolFor(pool);
  const total = list.reduce((a, v) => a + (VOC_RARITY_WEIGHT[v.rarity] || 1), 0);
  let r = Math.random() * total;
  for (const v of list) {
    const w = VOC_RARITY_WEIGHT[v.rarity] || 1;
    if (r < w) return v;
    r -= w;
  }
  return list[list.length - 1];
}

/* ── THE ANSWER ────────────────────────────────────────────────────────────
   `card` is whatever the host has to hand — the city's socket schema
   ({ id, name, element, elements, power, level, vocation }) is the shape it was
   written for, but only `vocation`, `element`/`elements` and `level` are read.
   `defs` is optional and only used to judge the '*' generalist.

   Returns EVERYTHING the UI needs to explain itself. A player looking at ×1.53
   must be able to see which of the three legs produced it, or the number is
   folklore — the same reason node-city's insFactors() decomposes tileMult
   instead of printing one total. */
export function aptitude(card, buildingId, defs) {
  const out = {
    voc: null, matched: false, elem: 'neutral', element: null,
    level: 1, levelMul: APT.LVL_MIN, gain: 0, mult: 1, pct: 0, capped: false,
  };
  if (!card || !buildingId) return out;

  const voc = getVocation(card.vocation);
  out.voc = voc;
  out.level = Math.max(1, Math.min(APT.LVL_MAX, Math.round(Number(card.level) || 1)));
  out.levelMul = levelMul(out.level);
  if (!voc) return out;

  out.matched = covers(voc, buildingId, defs);
  // 🔴 NO MATCH IS EXACTLY ×1. Not a penalty, not a consolation fraction. The
  // card still gives its ordinary +power/100 socket boost on the host side; the
  // aptitude leg simply has nothing to say about this building.
  if (!out.matched) return out;

  // The unit's elements, first-match wins. A dual-element card that is attuned
  // on one element and clashing on the other is treated as ATTUNED: the useful
  // half of a hybrid is why a player fielded a hybrid.
  const els = (Array.isArray(card.elements) && card.elements.length)
    ? card.elements
    : (card.element ? [card.element] : []);
  const norm = els.map(e => String(e || '').toLowerCase()).filter(Boolean);
  const attuned = norm.find(e => (voc.elements || []).indexOf(e) >= 0);
  const clashing = norm.find(e => (voc.clash || []).indexOf(e) >= 0);
  if (attuned)      { out.elem = 'attuned'; out.element = attuned; }
  else if (clashing) { out.elem = 'clash';   out.element = clashing; }
  else               { out.element = norm[0] || null; }

  out.gain = APT.VOC_BASE + (out.elem === 'attuned' ? APT.ELEM_ATTUNED
                          : out.elem === 'clash'    ? APT.ELEM_CLASH : 0);
  const raw = 1 + out.gain * out.levelMul;
  out.mult = Math.min(APT.CAP, Math.max(1, raw));
  out.capped = raw > APT.CAP + 1e-9;
  out.pct = Math.round((out.mult - 1) * 100);
  return out;
}

/** "×1.53" / "×2.00 — doubled". Short enough for a tile tooltip. */
export function aptitudeLabel(a) {
  if (!a || !a.matched) return '×1.00';
  return '×' + a.mult.toFixed(2) + (a.mult >= APT.CAP - 1e-9 ? ' — doubled' : '');
}

/* One line of plain English for why the number is what it is. The UI owns the
   markup; this owns the wording, so the tile tooltip, the dossier and the card
   picker cannot drift into three different explanations of one multiplier. */
export function aptitudeWhy(a, buildingName) {
  if (!a || !a.voc) return 'No vocation — this card only lends its raw power.';
  const where = buildingName || 'this building';
  if (!a.matched) return a.voc.icon + ' ' + a.voc.name + ' — no knack for ' + where + '. Raw power only.';
  const parts = [a.voc.icon + ' ' + a.voc.name + ' works ' + where];
  if (a.elem === 'attuned') parts.push('element in tune (+' + Math.round(APT.ELEM_ATTUNED * 100) + '%)');
  else if (a.elem === 'clash') parts.push('element fights the work (' + Math.round(APT.ELEM_CLASH * 100) + '%)');
  parts.push('Lv ' + a.level + ' → ×' + a.levelMul.toFixed(2) + ' on the bonus');
  return parts.join(' · ');
}
