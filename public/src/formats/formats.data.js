/* ════════════════════════════════════════════════════════════════════════════
   ⚖️ FORMATS + BANLIST — the data model.
   ----------------------------------------------------------------------------
   A FORMAT is a named rule set with a per-card allowance:

       { id, name, slug, active, bestOf, sideMax, notes,
         limits: { 'unit:kalon_prime': 1, 'trap:bone_snare': 0, … },
         updatedAt, updatedBy }

   `limits` maps a CARD KEY (the `kind:id` string decks already store) to how
   many copies a deck may hold ACROSS MAIN AND SIDE:

       0  🚫 Banned        — may not appear at all
       1  ⚠ Limited        — one copy
       2  ◐ Semi-limited   — two copies
       3  ✓ Unlimited      — the default, so it is never written down

   🔴 ABSENT MEANS UNLIMITED, AND THAT IS WHY THIS SCALES. A format stores ONLY
   the cards it restricts. A 900-card pool with 12 restrictions is a 12-entry
   object, not a 900-entry one, so the whole banlist fits in a single JSONB
   column and syncs in one row. Writing the default down for every card is the
   obvious first implementation and it is the one that makes the table
   unmanageable by the second season.

   🔴 EXACTLY ONE FORMAT IS ACTIVE. Two active formats means two answers to "is
   this deck legal", and the deck builder and the battle would each pick a
   different one. `activate()` in formats.api.js clears the others in the same
   statement for that reason — never as two separate writes.

   ⚠ THE CLIENT COPY IS A CACHE, NOT THE TRUTH. An offline player gets the last
   format they saw (or no format at all, which means "legacy rules, card
   restrictions only"). This is deliberate per CLAUDE.md: the app must work
   before the tables exist. Competitive enforcement that actually matters has to
   happen wherever the match is arbitrated, not here.
   ════════════════════════════════════════════════════════════════════════════ */

export const UNLIMITED = 3;

export const TIERS = [
  { n: 0, key: 'banned',  label: 'Banned',       icon: '🚫', color: '#ff6b6b' },
  { n: 1, key: 'limited', label: 'Limited',      icon: '⚠',  color: '#ffb14a' },
  { n: 2, key: 'semi',    label: 'Semi-limited', icon: '◐',  color: '#7fd6ff' },
  { n: 3, key: 'free',    label: 'Unlimited',    icon: '✓',  color: '#8fe0a8' },
];

export function tierOf(n) {
  return TIERS.find(t => t.n === (n | 0)) || TIERS[3];
}

export function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'format';
}

export function emptyFormat(name) {
  return {
    id: null,
    name: name || 'New Format',
    slug: slugify(name || 'new-format'),
    active: false,
    bestOf: 3,
    sideMax: 15,
    notes: '',
    limits: {},
    updatedAt: 0,
    updatedBy: null,
  };
}

/* DB row → in-memory format. Tolerant of a missing/garbage limits column: a
   format that fails to parse must read as "restricts nothing", never throw and
   never silently ban everything. */
export function fromRow(row) {
  if (!row) return null;
  let limits = {};
  try {
    const raw = row.limits;
    const obj = (typeof raw === 'string') ? JSON.parse(raw) : raw;
    if (obj && typeof obj === 'object') {
      for (const k of Object.keys(obj)) {
        const v = parseInt(obj[k], 10);
        if (v >= 0 && v < UNLIMITED) limits[k] = v;      // only real restrictions survive
      }
    }
  } catch (e) { limits = {}; }
  return {
    id: row.id,
    name: String(row.name || 'Format'),
    slug: String(row.slug || slugify(row.name)),
    active: !!row.active,
    bestOf: (row.best_of | 0) || 3,
    sideMax: row.side_max == null ? 15 : (row.side_max | 0),
    notes: String(row.notes || ''),
    limits,
    updatedAt: row.updated_at ? Date.parse(row.updated_at) || 0 : 0,
    updatedBy: row.updated_by || null,
  };
}

export function toRow(f) {
  return {
    name: f.name,
    slug: f.slug || slugify(f.name),
    active: !!f.active,
    best_of: f.bestOf | 0 || 3,
    side_max: f.sideMax == null ? 15 : (f.sideMax | 0),
    notes: f.notes || '',
    limits: pruned(f.limits),
  };
}

/* Drop every entry that equals the default before writing. See the "absent
   means unlimited" note above — this is what keeps the stored object small, and
   it also means setting a card back to Unlimited genuinely REMOVES it from the
   list rather than leaving a `: 3` behind that reads as a restriction to a
   human scanning the JSON. */
export function pruned(limits) {
  const out = {};
  for (const k of Object.keys(limits || {})) {
    const v = parseInt(limits[k], 10);
    if (v >= 0 && v < UNLIMITED) out[k] = v;
  }
  return out;
}

export function limitFor(format, cardKey) {
  if (!format || !format.limits) return UNLIMITED;
  const v = format.limits[cardKey];
  return (typeof v === 'number') ? v : UNLIMITED;
}

/* A printable banlist, grouped by tier — what the players' "current format"
   screen shows and what an admin proofreads before publishing. */
export function banlistView(format, nameOf) {
  const groups = TIERS.filter(t => t.n < UNLIMITED)
    .map(t => ({ ...t, cards: [] }));
  const byTier = Object.create(null);
  groups.forEach(g => { byTier[g.n] = g; });
  for (const key of Object.keys((format && format.limits) || {})) {
    const g = byTier[format.limits[key]];
    if (g) g.cards.push({ key, name: (nameOf ? nameOf(key) : key) });
  }
  groups.forEach(g => g.cards.sort((a, b) => a.name.localeCompare(b.name)));
  return groups;
}
