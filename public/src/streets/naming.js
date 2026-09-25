/* ══ 🛣 AUTO-NAMING ═════════════════════════════════════════════════════════
   "allow ai to do that" — PROCEDURAL AND OFFLINE. No network call, no model at
   runtime, nothing that can 404 or rate-limit. The structure is the interesting
   part, not the word list:

     · five word banks with different registers (surnames, trees, birds,
       virtues, works & landscape) so a city does not read as one theme;
     · a small grammar over them — <Word> <Suffix>, <Adj> <Word> <Suffix>,
       <Compass> <Word> <Suffix>, <Ordinal> <Suffix> — so names have shape;
     · suffixes WEIGHTED BY THE STREET ITSELF. A twelve-tile through-route can
       draw Boulevard or Parkway; a two-tile stub can only be a Lane, Close,
       Mews or Yard. The generator is told the length and the junction count and
       cannot produce "Grand Boulevard" for a dead end;
     · seeded off the street's anchor tile, so the same street is the same name
       on every reload EVEN BEFORE the save exists;
     · de-duplicated against the names already in the city, deterministically —
       no city gets two Robin Streets.

   ⚠ ONE-WAY. Nothing here reads a name back off a tile; the store in index.js
     owns persistence. This file is a pure function of (anchor, shape, taken).  */

import { STREET } from './tuning.js';

/* mulberry32 over a string hash. Deterministic, tiny, and — the point — the
   SAME sequence for the same anchor tile in every session on every machine. */
function hash32(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function rngFrom(seedStr) {
  let a = hash32(seedStr) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rnd, arr) => arr[Math.min(arr.length - 1, Math.floor(rnd() * arr.length))];

/* ── the banks ─────────────────────────────────────────────────────────────
   Deliberately mixed in register. The reference frame is "Robin Street" — a
   plausible, unremarkable municipal name — so the banks lean ordinary, with a
   thin seam of the game's own iconography (Ember, Cinder, Obelisk, Foundry)
   rather than a fantasy name generator's worth of it. */
const BANKS = {
  surname: ['Ashford', 'Bramley', 'Carrick', 'Crosby', 'Deverell', 'Ellory', 'Fairbairn',
    'Garrick', 'Halloway', 'Ingram', 'Jarrow', 'Kelsey', 'Lomond', 'Marlowe', 'Norrington',
    'Ostler', 'Pemberton', 'Quennell', 'Rushton', 'Sandoval', 'Thackeray', 'Underhill',
    'Vance', 'Whitlock', 'Alderton', 'Brackley', 'Cavendish', 'Dunmore', 'Everly', 'Fenwick',
    'Grayson', 'Hartley', 'Ingleby', 'Kingsley', 'Lockwood', 'Merrick', 'Nash', 'Pilbrow',
    'Radcliffe', 'Selwyn', 'Tarrant', 'Vellacott', 'Wexford', 'Yardley'],
  tree: ['Maple', 'Willow', 'Alder', 'Rowan', 'Hawthorn', 'Sycamore', 'Chestnut', 'Birch',
    'Cedar', 'Elm', 'Juniper', 'Laurel', 'Linden', 'Mulberry', 'Poplar', 'Aspen', 'Hazel',
    'Holly', 'Larch', 'Magnolia', 'Blackthorn', 'Whitebeam'],
  bird: ['Robin', 'Kestrel', 'Heron', 'Curlew', 'Swift', 'Falcon', 'Raven', 'Wren',
    'Plover', 'Lark', 'Osprey', 'Merlin', 'Starling', 'Redwing', 'Nightjar', 'Kingfisher'],
  virtue: ['Concord', 'Verity', 'Prudence', 'Amity', 'Clemency', 'Fortitude', 'Providence',
    'Temperance', 'Unity', 'Solace', 'Candour', 'Mercy', 'Patience', 'Resolve', 'Accord'],
  works: ['Foundry', 'Quarry', 'Kiln', 'Mill', 'Forge', 'Wharf', 'Granary', 'Aqueduct',
    'Cistern', 'Bellows', 'Anvil', 'Lantern', 'Beacon', 'Obelisk', 'Ember', 'Cinder',
    'Ironworks', 'Tannery', 'Cooperage', 'Signal', 'Colliery'],
  land: ['Hollow', 'Meadow', 'Brook', 'Ridge', 'Fen', 'Bluff', 'Dell', 'Heath', 'Moor',
    'Spring', 'Ford', 'Weir', 'Coppice', 'Thicket', 'Orchard', 'Common', 'Green', 'Warren',
    'Marsh', 'Hillock', 'Beckside'],
};
const BANK_ORDER = ['surname', 'tree', 'bird', 'virtue', 'works', 'land'];
/* Weights, not a uniform pick: a real street map is mostly surnames and trees
   with the rest as seasoning. Cumulative, summing to 1. */
const BANK_WEIGHT = [0.30, 0.24, 0.14, 0.10, 0.12, 0.10];

const ADJ = ['Old', 'New', 'Upper', 'Lower', 'Great', 'Little', 'High', 'Long', 'Broad',
  'Silver', 'Golden', 'Grey', 'Iron', 'Copper', 'Amber', 'North', 'South', 'East', 'West'];
const COMPASS = ['North', 'South', 'East', 'West'];
const ORDINAL = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh',
  'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth'];

/* 🛣 SUFFIX TIERS. The bands are the whole reason a generated map reads as a
   map: length is the strongest signal a player has about what a road IS, so the
   word that ends its name has to agree with it. A stub CANNOT be an Avenue. */
const SUFFIX_TIERS = [
  { min: 12, words: ['Boulevard', 'Parkway', 'Avenue', 'Esplanade', 'Broadway'] },
  { min: 8,  words: ['Avenue', 'Boulevard', 'Road', 'Way', 'Drive'] },
  { min: 5,  words: ['Street', 'Road', 'Avenue', 'Drive', 'Way', 'Crescent'] },
  { min: 3,  words: ['Street', 'Lane', 'Terrace', 'Row', 'Walk', 'Rise'] },
  { min: 0,  words: ['Lane', 'Close', 'Court', 'Mews', 'Alley', 'Yard'] },
];
function suffixesFor(len, junctions) {
  /* A long road that never meets another road is a spur, not a boulevard —
     demote it one band. Junction count is the second real signal the tile graph
     already carries, so use it rather than length alone. */
  let effective = len;
  if (junctions === 0 && len >= 8) effective = 7;
  for (const tier of SUFFIX_TIERS) if (effective >= tier.min) return tier.words;
  return SUFFIX_TIERS[SUFFIX_TIERS.length - 1].words;
}

function bankFor(rnd) {
  const r = rnd();
  let acc = 0;
  for (let i = 0; i < BANK_ORDER.length; i++) {
    acc += BANK_WEIGHT[i];
    if (r < acc) return BANKS[BANK_ORDER[i]];
  }
  return BANKS.surname;
}

/* One candidate name. `attempt` walks the generator forward so successive calls
   with the same seed produce DIFFERENT names — that is what makes de-duplication
   deterministic rather than random. */
function candidate(seed, shape, attempt) {
  const rnd = rngFrom(seed + '#' + attempt);
  const sfx = pick(rnd, suffixesFor(shape.len, shape.junctions));
  const form = rnd();
  const word = pick(rnd, bankFor(rnd));
  if (attempt >= 6) {
    /* Late attempts stop being creative and start being unambiguous, which is
       what a real city does too (North Robin Street). */
    return pick(rnd, COMPASS) + ' ' + word + ' ' + sfx;
  }
  if (form < 0.10) return pick(rnd, ORDINAL) + ' ' + sfx;
  if (form < 0.28) return pick(rnd, ADJ) + ' ' + word + ' ' + sfx;
  return word + ' ' + sfx;
}

/* ── the public call ───────────────────────────────────────────────────────
   anchor  : "x,z" of the street's lowest tile — the stable seed
   shape   : { len, junctions }
   taken   : Set of names already used in this city (lower-cased)
   Returns a name that is not in `taken`. Guaranteed to terminate: after the
   creative attempts it falls through to a numbered form that cannot collide. */
export function generateName(anchor, shape, taken) {
  const seed = 'nc-street:' + anchor;
  for (let attempt = 0; attempt < 14; attempt++) {
    const name = candidate(seed, shape, attempt);
    if (!taken || !taken.has(name.toLowerCase())) return name;
  }
  /* The terminator. `taken` is finite, so a counter appended to a generated stem
     must eventually miss it. */
  const stem = candidate(seed, shape, 0);
  for (let n = 2; n < 400; n++) {
    const name = stem + ' ' + n;
    if (!taken || !taken.has(name.toLowerCase())) return name;
  }
  return stem + ' ' + anchor;
}

/* ── ✍ PLAYER-AUTHORED TEXT ────────────────────────────────────────────────
   This string is rendered into the dossier, drawn into a canvas texture in the
   world, and written to the save. index.html's costLabel comment states the
   house position on strings that reach a rendered surface — HTML in one is
   "either escaped noise or an injection" — so this does BOTH halves:

     1. sanitise on the way IN (here): strip anything that looks like markup or
        a control character, collapse whitespace, cap the length;
     2. escape on the way OUT (panel.js / labels.js): every render goes through
        the host's logEsc, or through canvas fillText, which is not markup at
        all. Neither half is trusted to be the only one.

   Returns '' for anything that sanitises to nothing, and the caller treats that
   as "keep the old name" rather than as a rename to blank. */
export function sanitiseName(raw) {
  let s = String(raw == null ? '' : raw);
  // Control characters, including the bidi overrides that can visually reverse
  // a name and the zero-width joiners that hide characters inside one.
  s = s.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '');
  // Anything angle-bracketed, and the bare brackets themselves. Belt: the panel
  // escapes anyway, but a name that survives into a tooltip attribute or a
  // console line somewhere else should not carry a tag either.
  s = s.replace(/<[^>]*>/g, ' ').replace(/[<>]/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > STREET.MAX_NAME_LEN) s = s.slice(0, STREET.MAX_NAME_LEN).trim();
  return s;
}

export default { generateName, sanitiseName };
