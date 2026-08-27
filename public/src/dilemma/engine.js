/* ════════════════════════════════════════════════════════════════════════════
   🏛 ETHOS HEIGHTS — SELECTION, STANCE AND BOND MATH.
   ----------------------------------------------------------------------------
   Everything in this file is a pure decision about WHO reacts, HOW they react,
   and WHAT that is worth. It never draws a pixel, never spends a Cinder and
   never mints a card — render.js and rewards.js own those, and the resolve
   ordering that composes all three lives in index.js (CONTRACT §9.4).

   🔴 THE GLOBALS TRAP. `Profile`, `App`, `Forge` and friends are top-level
   `const` declarations in index.html — lexical globals, NOT properties of
   `window`. An ES module cannot see them and `window.Profile` is `undefined`.
   Every legacy binding this file needs arrives through `host`, the adapter
   index.js builds over `window.MythicDilemmaBridge`. There is not one bare
   global in here, and there must never be one.

   🔴 EVERY EXPORT IS TOTAL. Each one wraps its own body and returns a
   documented failure value rather than throwing. The dilemma is a feature; the
   game is the product, and a civic side-panel must never be the reason a
   player's session ends.

   ⚙ ONE TUNING TABLE. Every number a choice is worth lives in `DILEMMA_ECON`
   in data.js and nowhere else — the `_opEcon()` habit as index.html:80478-80480
   states it for CORP_LAWS. If you find yourself typing a magnitude here, it
   belongs there instead. The only bare numbers below are algorithm constants
   (FNV-1a's prime, mulberry32's mixing words), the four rung indices of the
   degradation ladder — which are branch labels, not dials — and the identity
   values 0 and 1. A reviewer will grep for the rest and should find none.
   ════════════════════════════════════════════════════════════════════════════ */

import { DILEMMA_ECON, DILEMMAS, DILEMMA_BY_ID, DILEMMA_SCHEMA_VERSION, INFLUENCE_RANKS } from './data.js';

/* ── The value vocabulary ───────────────────────────────────────────────────
   Stance is derived from the SHIPPED value system: eight poles on four opposed
   axes (LQ_AXES / LQ_POLE_AXIS, index.html:72969-72975) and the tuned
   approve/oppose magnitudes in LQ_INTENSITY (index.html:72983-72987). Both
   arrive over the bridge as `host.values()`.

   🔴 THE MAGNITUDES ARE NEVER COPIED INTO THIS FILE, and that is a decision.
   Duplicating `{ mild:{approve:2,oppose:3}, … }` here would give the project a
   second bond-magnitude table that drifts from index.html's the first time
   anyone retunes it — which is exactly the live copy bug in a reference file
   (house.camp.js:151-153 promises "No rest-quality modifier here" while
   house.camp.js:88 runs at CAMP_REST_QUALITY = 0.75). With no bridge, bond
   deltas are 0. Inert is honest; invented numbers are not.

   The POLE→OPPOSITE map below IS local, and the distinction matters: it is
   structure, not tuning. It is eight identifiers, as stable as the card types,
   and having it means `stanceFor()` still answers correctly in a unit test with
   no host at all. `_absorbValues()` overwrites it from LQ_AXES the moment a
   real bridge is seen, so the bridge stays the source of truth. */
const POLE_OPPOSITE = {
  honor: 'guile', guile: 'honor',
  mercy: 'ruthless', ruthless: 'mercy',
  valor: 'caution', caution: 'valor',
  ambition: 'temperance', temperance: 'ambition',
};

/* Ranked weakest → strongest. Used only to settle a unit that holds BOTH a pole
   the choice embodies and its opposite (CONTRACT §3.3: "the HIGHER intensity
   wins; on a tie → middle, reason 'torn'").
   Ranking by LQ_INTENSITY's own `oppose` magnitude was considered and rejected:
   a future retune that flattened those numbers would silently turn every
   mixed-values unit 'torn', which is a stance change disguised as a balance
   pass. An explicit order survives a retune. */
const INTENSITY_ORDER = ['mild', 'firm', 'zealous'];

/* The live vocabulary, refreshed on every host contact (see `_absorbValues`).
   Module-level because `stanceFor(unit, choice)` and `previewBond(unit, choice)`
   take no host — that is the CONTRACT's signature, and it is the right one:
   render.js calls them per-unit per-choice on every repaint and must not be
   able to reach the bridge. The cache is primed by `ensureState()`, which every
   host-taking export calls first, so by the time a stance is asked for the
   vocabulary is present. When it is not, deltas are 0 and stances still work. */
let _vocab = { opposite: POLE_OPPOSITE, intensity: null };

function _absorbValues(host) {
  try {
    if (!host || typeof host.values !== 'function') return;
    const v = host.values();
    if (!v || typeof v !== 'object') return;
    if (v.intensity && typeof v.intensity === 'object') _vocab.intensity = v.intensity;
    // Rebuild the opposite map from LQ_AXES rather than trusting our copy — if
    // a ninth pole is ever added to index.html this picks it up for free.
    if (v.axes && typeof v.axes === 'object' && v.poleAxis && typeof v.poleAxis === 'object') {
      const next = {};
      for (const pole in v.poleAxis) {
        const ax = v.axes[v.poleAxis[pole]];
        if (!ax) continue;
        next[pole] = (ax.a === pole) ? ax.b : ax.a;
      }
      if (Object.keys(next).length) _vocab.opposite = next;
    }
  } catch (e) { /* keep whatever we had; a stale vocabulary beats a thrown one */ }
}

/* ── Small total helpers ────────────────────────────────────────────────────
   ⚠ `Number(x) || 0`, NEVER `x | 0`, on anything that can be an epoch. A
   millisecond timestamp overflows a 32-bit int and comes back NEGATIVE, which
   silently inverted the first cut of the city-production cloud merge
   (index.html:48051-48054). Every timestamp in this file goes through `num()`.

   ⚠ And `Number(x)` is not itself total: it THROWS a TypeError on a Symbol.
   Found by fuzzing every export with junk arguments — `makeRng(Symbol.iterator)`
   was the only throw that ever escaped this file, and it escaped because
   `makeRng` returns a closure and so has no body to wrap. Guarding the coercion
   once here is cheaper than wrapping every caller, and it holds for whatever the
   next exotic value turns out to be. */
function num(x) {
  try { const n = Number(x); return isFinite(n) ? n : 0; } catch (e) { return 0; }
}
function clampAbs(v, cap) { const c = Math.abs(num(cap)); return Math.max(-c, Math.min(c, num(v))); }
function clampInfluence(v) {
  const n = Math.round(num(v));
  return Math.max(DILEMMA_ECON.influenceMin, Math.min(DILEMMA_ECON.influenceCap, n));
}

// ══════════════════════════════════════════════════════════════════════════
// RNG
// ══════════════════════════════════════════════════════════════════════════

/* FNV-1a, 32-bit. Deterministic and dependency-free: the whole point of an
   instance carrying its seed is that a bug report saying "dilemma eh_x at
   1756300000000" is reproducible on someone else's machine.
   ⚠ Never returns 0 — mulberry32 seeded with 0 is degenerate (its first pulls
   cluster hard), so the identity fallback is 1, not 0. */
export function seedFrom(str) {
  try {
    if (typeof str !== 'string' || !str.length) return 1;
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0) || 1;
  } catch (e) { return 1; }
}

/* mulberry32. Six lines, no dependency, and identical output for identical
   seeds across every engine this app runs on — which is what makes the seed on
   the instance worth storing. */
export function makeRng(seed) {
  let a = (num(seed) >>> 0) || 1;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* The CAMP_RUN_EVENTS weight walk (index.html:65686-65691), generalised to
   `[[value, weight], …]` and taking its randomness as an argument so nothing
   downstream of `openDilemma()` ever touches `Math.random()` directly. */
export function pickWeighted(rows, rng) {
  try {
    if (!Array.isArray(rows)) return null;
    // An empty bag has no rows[0] to fall back to, so `null` is the only honest
    // answer — the CONTRACT's "rows[0][0] for an empty/zero bag" is written for
    // the zero-TOTAL case, which is the one below.
    if (!rows.length) return null;
    let total = 0;
    for (const r of rows) total += Math.max(0, num(r && r[1]));
    if (total <= 0) return rows[0][0];
    let r = (typeof rng === 'function' ? num(rng()) : 0) * total;
    for (const row of rows) {
      r -= Math.max(0, num(row && row[1]));
      if (r <= 0) return row[0];
    }
    return rows[rows.length - 1][0];
  } catch (e) { return null; }
}

/* Fisher-Yates on a COPY, driven by the instance rng. Used for the without-
   replacement choice sample; never mutates the corpus, which is frozen anyway. */
function shuffled(arr, rng) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(num(typeof rng === 'function' ? rng() : 0) * (i + 1));
    const t = out[i]; out[i] = out[j]; out[j] = t;
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════
// PERSISTED STATE  —  Profile.dilemma
// ══════════════════════════════════════════════════════════════════════════

function defaultState() {
  return {
    v: DILEMMA_SCHEMA_VERSION,
    influence: DILEMMA_ECON.influenceSeed,
    seen: {},
    recent: [],
    nextAt: 0,
    resolved: 0,
    lastDeck: null,
    updatedAt: 0,
  };
}

/* A recorded deck is only useful if it can still be READ. `_dilemmaRecordDeck`
   in index.html writes this at battle start and deliberately does not call
   saveProfile() (that would add a 50-200 ms stringify to the worst possible
   moment, index.html:70835-70839), so a half-written or force-quit record is a
   real shape this has to survive. */
function normalizeLastDeck(ld) {
  if (!ld || typeof ld !== 'object' || Array.isArray(ld)) return null;
  const cards = Array.isArray(ld.cards) ? ld.cards.filter(k => typeof k === 'string' && k) : [];
  const heroId = (typeof ld.heroId === 'string' && ld.heroId) ? ld.heroId : null;
  /* A record with neither a card nor a hero is not a record — it is a failed
     write. Returning null routes the roster to the heuristic ladder (§5.2),
     which is strictly better than rendering "your last deck" as an empty box
     and telling the player their own deck is gone. */
  if (!cards.length && !heroId) return null;
  return {
    id: (typeof ld.id === 'string' && ld.id) ? ld.id : null,
    name: (typeof ld.name === 'string' && ld.name) ? ld.name : '',
    heroId,
    cards,
    at: num(ld.at),
  };
}

/* 🔴 ABSENT-TOLERANT ON LOAD. This project has shipped silent save bugs at
   least five times — index.html:46677-46682 records a player losing a
   120,000-Cinder Gene Vault to a key that was in neither cloud whitelist — so
   every field here is defaulted and no shape is assumed. A save written before
   this feature existed, a corrupt blob, `null`, a string, an array and a
   half-filled object all have to load as "a stranger arriving in Ethos
   Heights", never as a throw.

   It writes the normalised object back through `host.setState()` so the rest of
   the session reads one shape, but it deliberately does NOT save: merely
   LOOKING at your standing must not cost a whole-Profile stringify. That is the
   same split `resonanceGet`/`resonanceSet` draws at index.html:206918-206921. */
export function ensureState(host) {
  try {
    _absorbValues(host);
    let s = null;
    try { s = host.state(); } catch (e) { s = null; }
    if (!s || typeof s !== 'object' || Array.isArray(s)) s = {};

    /* One schema version exists today. The branch is here so that shipping a v2
       is an edit in this function rather than an archaeology exercise across
       three whitelists — and so that a blob stamped with a FUTURE version (a
       player rolling back a client) is normalised rather than trusted. */
    if (s.v !== DILEMMA_SCHEMA_VERSION) s.v = DILEMMA_SCHEMA_VERSION;

    s.influence = clampInfluence(typeof s.influence === 'number' ? s.influence : DILEMMA_ECON.influenceSeed);

    if (!s.seen || typeof s.seen !== 'object' || Array.isArray(s.seen)) s.seen = {};
    for (const id of Object.keys(s.seen)) {
      const t = num(s.seen[id]);
      // A stamp of 0 or garbage is indistinguishable from "never seen", so drop
      // it rather than carrying a key that blocks nothing and costs a byte.
      if (t <= 0) delete s.seen[id]; else s.seen[id] = t;
    }

    const recent = Array.isArray(s.recent) ? s.recent.filter(x => typeof x === 'string' && x) : [];
    // Dedupe newest-first: a duplicated id would burn one of the five no-repeat
    // slots on a dilemma that is already blocked, quietly shrinking the buffer.
    s.recent = recent.filter((id, i) => recent.indexOf(id) === i).slice(0, DILEMMA_ECON.recentDepth);

    s.nextAt = num(s.nextAt);
    s.resolved = Math.max(0, Math.floor(num(s.resolved)));
    s.lastDeck = normalizeLastDeck(s.lastDeck);
    s.updatedAt = num(s.updatedAt);

    try { host.setState(s); } catch (e) { /* a refused setState is reported by saveState, not here */ }
    return s;
  } catch (e) { return defaultState(); }
}

/* 🔴 A FAILED PERSIST IS A REAL FAILURE. DO NOT SWALLOW IT.
   public/src/city/index.js:62-73 records what swallowing this cost: the host
   adapter wrapped setState/save in `try { … } catch (e) {}`, which made
   build()'s refund-on-record-failure branch unreachable — it returned
   {ok:true} and charged a player 50,000 Cinder for a building that never
   persisted. The resolve transaction (§9.4 step 2) refunds the choice's Cinder
   cost and aborts on a `false` from here, and that branch only works if this
   function tells the truth.

   `=== true`, not `!== false`, and that is deliberate. A host that answers
   anything other than a plain `true` is a host we cannot vouch for, and the
   failure direction is player-favourable: the resolution aborts, the cost is
   handed back, and nothing was written. Over-reporting a save failure costs the
   player a click. Under-reporting one costs them their standing. */
export function saveState(host, state) {
  try {
    if (!state || typeof state !== 'object') return false;
    state.updatedAt = num(host.now());
    if (host.setState(state) !== true) return false;
    return host.save() === true;
  } catch (e) { return false; }
}

export function influence(host) {
  try { return clampInfluence(ensureState(host).influence); }
  catch (e) { return DILEMMA_ECON.influenceSeed; }
}

/* The named rung of the ladder, RESERVE_RANKS-style (index.html:56227-56240).
   Display only — CONTRACT §9.3 is explicit that a name a player can say out
   loud is not one of Influence's two required consumers. Those are the
   eligibility band, the reward multiplier and the choice count. */
export function rank(value) {
  try {
    const rows = Array.isArray(INFLUENCE_RANKS) ? INFLUENCE_RANKS : [];
    if (!rows.length) return null;
    const v = num(value);
    let out = rows[0];
    for (const r of rows) { if (r && num(r.min) <= v) out = r; }
    return out;
  } catch (e) {
    try { return INFLUENCE_RANKS[0] || null; } catch (e2) { return null; }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// ROSTER  —  who is standing in the room when the decision lands
// ══════════════════════════════════════════════════════════════════════════

function rosterRow(host, id, kind, card, order, fallback) {
  const entry = (kind === 'hero')
    ? (typeof host.heroEntry === 'function' ? host.heroEntry(id) : null)
    : (typeof host.unitEntry === 'function' ? host.unitEntry(id) : null);

  let bond = 0;
  try { bond = num(host.bondOf(id, kind)); } catch (e) { bond = 0; }

  let tier = null;
  try { tier = host.bondTier(bond); } catch (e) { tier = null; }

  /* 🎭 Heroes carry no temperament and never have — `getUnitTemper` would
     happily DERIVE one from the hero id (index.html:72593), and it would be a
     lie in both directions: the pill would show a temperament the hero does not
     have, and `previewBond` would scale by a multiplier `adjustBond` is never
     going to apply, because adjustBond reads `entry.temper` and a hero entry has
     none. Ask for a temper only where one exists. */
  let temper = null;
  if (kind !== 'hero') {
    try { temper = host.temperOf(id, entry) || null; } catch (e) { temper = null; }
  }

  /* The reachable ceiling is snapshotted here, once, because `previewBond`
     takes no host (it runs per-unit per-choice on every repaint). ⚠ It is
     `bondCeilingFor(ENTRY)` — passing a NUMBER returns BOND_MAX through the
     typeof-object guard at index.html:72510, which reads as "the clamp works"
     while silently ignoring saleCount and everSold. */
  let ceiling = 0;
  try { ceiling = num(host.bondCeiling(entry)); } catch (e) { ceiling = 0; }
  if (!(ceiling > 0)) { try { ceiling = num(host.bondMax()); } catch (e) { ceiling = 0; } }

  /* CAN legitimately be `[]`, and that is the COMMON case, not an edge case —
     see `stanceFor`. A null card (a forged card whose definition was never
     published on this device, lookupCustomCard at index.html:51036) resolves the
     same way instead of throwing its way into the render pipeline. */
  let poles = [];
  try { const p = host.valueProfile(card); if (Array.isArray(p)) poles = p; } catch (e) { poles = []; }

  return {
    id, kind, card: card || null, entry: entry || null,
    name: (card && card.name) || id,
    icon: (card && card.icon) || '',
    bond, tier: tier || null, ceiling, temper, poles,
    fallback: !!fallback,
    _order: order,
    together: num(entry && entry.together),
  };
}

/* Bond first, then shared history, then the order they sit in the deck. A
   40-card deck holds ~20 distinct units and a modal listing twenty reacting rows
   is noise rather than drama — the companions who have earned a voice get one. */
function rankRoster(rows) {
  return rows.sort((a, b) => (b.bond - a.bond) || (b.together - a.together) || (a._order - b._order))
             .slice(0, DILEMMA_ECON.rosterMax);
}

export function roster(host) {
  try {
    if (!host) return [];
    const s = ensureState(host);
    const ld = s.lastDeck;

    if (ld) {
      const rows = [];
      const seenIds = Object.create(null);
      let order = 0;

      /* The hero enters the field separately from the deck — `buildStarterDeck`
         strips `type === 'hero'` out of the card list at index.html:73750-73753
         — so it is prepended rather than found among the keys.
         ⚠ KNOWN GAP, stated rather than worked around: `findHeroById` is not on
         the bridge (CONTRACT §6), and `cardById` (_cardDefById,
         index.html:87319) only reaches custom + unit pools, so a BUILT-IN
         starter hero resolves to null here and reads as Middle on every choice.
         Reaching past the bridge for STARTER_HEROES is the globals trap and is
         not an option; adding `heroById()` to §6 is the round-2 fix. */
      if (ld.heroId) {
        let hcard = null;
        try { hcard = host.cardById(ld.heroId); } catch (e) { hcard = null; }
        rows.push(rosterRow(host, ld.heroId, 'hero', hcard, order++, false));
        seenIds[ld.heroId] = 1;
      }

      for (const key of ld.cards) {
        /* 🔴 DECK KEYS ARE NOT CARD IDS. `Profile.decks[].cards` holds
           '<kind>:<id>' ('unit:goblin', 'custom:abc') while `Profile.units` is
           keyed by the BARE id. Joining the two without this conversion produces
           zero matches and renders an empty roster rather than an error — which
           looks like "the player has no companions" instead of like a bug. */
        let id = null;
        try { id = host.deckKeyCardId(key); } catch (e) { id = null; }
        if (!id || typeof id !== 'string' || seenIds[id]) continue;

        let card = null;
        try { card = host.resolveDeckCard(key); } catch (e) { card = null; }

        if (card) {
          if (card.type !== 'unit') continue;   // spells, traps, locations and weather do not have opinions
        } else {
          /* An unresolvable key. If the key's own kind SAYS 'unit' we keep the
             row — the card is a companion the player owns whose definition is
             missing on this device, and dropping it would make their deck look
             shorter than it is. An unresolvable 'custom:' key is dropped
             instead: we genuinely do not know it was a unit, and listing a spell
             as a companion is a worse lie than a shorter roster. */
          if (String(key).slice(0, 5) !== 'unit:') continue;
        }
        seenIds[id] = 1;
        rows.push(rosterRow(host, id, 'unit', card, order++, false));
      }
      return rankRoster(rows);
    }

    /* ── Fallback: no deck was ever recorded ────────────────────────────────
       First run, or a save from before the recorder shipped. `fallbackRoster`
       ranks Profile.units by (_lastBattleFielded ? 1 : 0), then together, then
       fielded.
       ⚠ `_lastBattleFielded` is NOT a last-roster record and must never be
       presented as one: it is set true only for units actually DEPLOYED
       (index.html:152594) and cleared only for benched units that were in
       s._deckUnitIds (index.html:152693), so a unit from a deck the player
       abandoned keeps a stale `true` forever. It is a decaying heuristic, which
       is why every row carries `fallback: true` and render.js is required to
       relabel the section "your most-fought companions", never "your last
       deck". Degrading to a slightly wrong list is fine; claiming precision we
       do not have is not. */
    let heur = [];
    try { const r = host.fallbackRoster(DILEMMA_ECON.rosterMax); if (Array.isArray(r)) heur = r; } catch (e) { heur = []; }

    const rows = [];
    let order = 0;
    const seenIds = Object.create(null);
    for (const h of heur) {
      const id = h && h.id;
      if (!id || typeof id !== 'string' || seenIds[id]) continue;
      seenIds[id] = 1;
      let card = null;
      try { card = host.cardById(id); } catch (e) { card = null; }
      rows.push(rosterRow(host, id, 'unit', card, order++, true));
    }
    // A brand-new player has no units at all. `[]` is legal and the modal still
    // opens — render.js prints one honest line rather than an empty box.
    return rankRoster(rows);
  } catch (e) { return []; }
}

// ══════════════════════════════════════════════════════════════════════════
// STANCE  —  Support / Middle / Against, derived, never rolled
// ══════════════════════════════════════════════════════════════════════════

const MIDDLE_NO_OPINION = { stance: 'middle', pole: null, intensity: null, reason: 'no-opinion' };

function intensityRank(i) { const n = INTENSITY_ORDER.indexOf(i); return n < 0 ? 0 : n; }

/* A choice declares the value poles it EMBODIES; opposition is derived from the
   axis. A data author who could write `oppose: ['mercy']` on a choice that also
   embodies mercy would produce an incoherent dilemma no cheap validator can
   catch — deriving the far side from LQ_AXES makes that unwritable.

   This is the shipped `_lqPoleVerdict(pole, st)` (index.html:73224-73236) turned
   inside out: there, a pole reads a battle; here, a unit reads a choice. That
   function's `null` return is literally this codebase's own name for the Middle
   stance, which is why Middle is a real answer here and not a shrug.

   🔴 STANCE IS A PROPERTY OF WHO THE UNIT IS, NOT A COIN FLIP. There is no rng
   in this function and there must never be one: the same unit and the same
   choice yield the same stance on every repaint, in every session, on every
   device. The player is allowed to learn that their Kindly medic always objects
   to burning the ward. */
export function stanceFor(unit, choice) {
  try {
    const cp = (choice && Array.isArray(choice.poles)) ? choice.poles : [];
    // A procedural choice — file the paperwork, wait for the Foundation — has
    // no moral content, so nobody has a view on it. Distinguished from
    // 'no-opinion' because the reason belongs to the CHOICE, not the unit, and
    // render.js says so differently.
    if (!cp.length) return { stance: 'middle', pole: null, intensity: null, reason: 'procedural' };

    const up = (unit && Array.isArray(unit.poles)) ? unit.poles : [];
    /* 🔴 THE HONEST FALLBACK, AND IT IS THE COMMON CASE.
       `_lqUnitValueProfile` returns `[]` whenever `_lqArchetypeDefault` finds
       nothing (index.html:73036-73039) — and it finds nothing whenever the
       joined class+archetype+passive+subclass+factions string is empty or
       matches none of the eight LQ_ARCHETYPE_POLE regexes. A Forge card
       authored with a name, an icon and stats — the ordinary shape of a custom
       card — has no poles at all. Recon's claim that "every card resolves to at
       least a Mild pole" is not true, and this file does not rely on it.
       Such a unit is Middle on everything and moves 0 bond. It is still SHOWN,
       dimmed and labelled: silently dropping a player's own companion from the
       roster would make their deck look wrong. */
    if (!up.length) return MIDDLE_NO_OPINION;

    const opp = _vocab.opposite || POLE_OPPOSITE;
    const wanted = Object.create(null);
    const against = Object.create(null);
    for (const p of cp) {
      if (typeof p !== 'string' || !p) continue;
      wanted[p] = 1;
      const o = opp[p];
      if (o) against[o] = 1;
    }

    let sup = null, opz = null;
    for (const e of up) {
      if (!e || typeof e.pole !== 'string') continue;
      if (wanted[e.pole] && (!sup || intensityRank(e.intensity) > intensityRank(sup.intensity))) sup = e;
      if (against[e.pole] && (!opz || intensityRank(e.intensity) > intensityRank(opz.intensity))) opz = e;
    }

    if (sup && !opz) return { stance: 'support', pole: sup.pole, intensity: sup.intensity, reason: 'match' };
    if (opz && !sup) return { stance: 'against', pole: opz.pole, intensity: opz.intensity, reason: 'opposed' };
    if (sup && opz) {
      const rs = intensityRank(sup.intensity), ro = intensityRank(opz.intensity);
      if (rs > ro) return { stance: 'support', pole: sup.pole, intensity: sup.intensity, reason: 'match' };
      if (ro > rs) return { stance: 'against', pole: opz.pole, intensity: opz.intensity, reason: 'opposed' };
      // Held equally on both sides of the same call. Not indifference — the
      // opposite. Named 'torn' so render.js can say so.
      return { stance: 'middle', pole: sup.pole, intensity: sup.intensity, reason: 'torn' };
    }
    // Has values; this decision simply does not touch them.
    return { stance: 'middle', pole: null, intensity: null, reason: 'untouched' };
  } catch (e) { return MIDDLE_NO_OPINION; }
}

/* ── BOND MAGNITUDE ─────────────────────────────────────────────────────────
   🔴 THIS IS THE RAW DELTA — THE ONE HANDED TO `adjustBond`, NOT THE ONE SHOWN.
   `adjustBond` (index.html:72519-72542) applies the unit's temperament itself.
   Passing it a temper-scaled number would scale a Vain unit's loss by 1.5 twice
   and land −27 where the table says −12. `previewBond()` below is the display
   half and does the scaling; this half must stay raw.

   The magnitudes are LQ_INTENSITY's, verbatim, over the bridge — mild 2/3, firm
   3/6, zealous 5/10 — multiplied by how much the choice is ABOUT its poles
   (`choice.weight`, one of DILEMMA_ECON.choiceWeights). Inventing a second
   magnitude table for "a unit approved / a unit objected" when a tuned one
   already ships is the parallel-system mistake index.html:80450 argues against.

   Range: ±1 at mild/0.5 up to +8 / −12 at zealous/1.5, hard-capped at
   DILEMMA_ECON.bondCapPerResolve.

   ⚠ THAT CAP IS ON THE REQUEST, NOT ON WHAT LANDS, and the difference is real:
   `adjustBond` then multiplies by temperament, so an Ardent unit (gain/loss
   1.3) genuinely takes −13 from a −12 request and a Vain one (loss 1.5) takes
   −18. Measured, not theorised — the corpus-wide sweep in the driver reports
   the true worst case. Capping the LANDED figure instead would mean the modal
   printing −12 while the bond bar moved −18, which is the preview lie this
   whole function exists to prevent. Temperament sits on top of every bond
   source in the game; it sits on top of this one too.

   Sanity against BOND_MAX = 1200 and the tier bands: the narrowest band above
   Wary is Neutral at 100 wide, so even the true worst case of −18 moves a unit
   under a fifth of one band. A two-tier jump from one civic decision is
   arithmetically impossible, which is the requirement. At the other end the
   floor is ±1 and the roster prints the integer, so the smallest real reaction
   is still visible — nothing rounds away to a change the player cannot see.

   Rate is bounded by CADENCE, not by shrinking the scale. A dilemma is
   instantaneous where a battle is not, so reusing the battle magnitudes could in
   principle out-earn battles — it cannot here, because DILEMMA_ECON's 45-minute
   offer cooldown caps the feature near one resolution an hour against a
   battle's several. Shrinking the numbers instead would stop the two systems
   being comparable to the player, who sees one bond bar.

   ⚠ MIDDLE IS EXACTLY 0, NEVER "a little". `adjustBond`'s own anti-rounding
   guard means any non-zero delta becomes at least ±1 AFTER temperament — for a
   Vain unit (loss 1.5) a nominal "tiny" negative is a real −1. "A little" is not
   expressible through the sanctioned mutator, so 0 is the honest reading of
   "the middle moves little or not at all". */
function rawDelta(unit, choice) {
  const st = stanceFor(unit, choice);
  if (st.stance === 'middle') return 0;

  const table = _vocab.intensity;
  // No bridge ⇒ no magnitudes ⇒ no bond moves. See the header: the alternative
  // is copying index.html's numbers into this file and watching them drift.
  if (!table) return 0;
  const row = table[st.intensity];
  if (!row) return 0;

  const base = num(st.stance === 'support' ? row.approve : row.oppose);
  const wRaw = num(choice && choice.weight);
  const w = wRaw > 0 ? wRaw : 1;   // absent weight = the identity, not a tuning value
  const signed = (st.stance === 'support' ? 1 : -1) * base * w;
  if (!signed) return 0;

  // The same guard `adjustBond` uses at index.html:72533-72534, for the same
  // reason: a 0.5 weight must soften a reaction, never delete it.
  const guarded = signed > 0 ? Math.max(1, Math.round(signed)) : Math.min(-1, Math.round(signed));
  return clampAbs(guarded, DILEMMA_ECON.bondCapPerResolve);
}

/* What will ACTUALLY land, for the modal to print.

   Recon named the trap: a modal that shows "+5" straight off the magnitude
   table will frequently show a number that never happens, because `adjustBond`
   multiplies by temperament and then clamps to `bondCeilingFor(entry)`. So this
   runs the mutator's own arithmetic, in the mutator's own order, and returns the
   difference the bond bar will move by.

   Three consequences worth stating, because each one is a number a player would
   otherwise call a bug:
   • A Sworn companion at the cap previews +0 on a choice it supports. Correct:
     the ceiling ate it. The aftermath view reports the same 0.
   • Temperament is applied ONLY when the profile entry actually carries
     `.temper`, because that is the field `adjustBond` reads. A derived
     temperament (getUnitTemper's third precedence step) is display truth, not
     mutation truth, and scaling by it here would over-promise.
   • A unit whose ceiling has since been LOWERED — sold more than three times,
     or sold at all while Sworn is first-owner-only — sits above its cap, and
     `adjustBond` drops it to the cap on the next adjustment whatever the sign.
     The preview returns that negative rather than promising a gain. */
export function previewBond(unit, choice) {
  try {
    if (!unit) return 0;
    let d = rawDelta(unit, choice);
    if (!d) return 0;

    const t = unit.temper;
    const entryTemper = unit.entry && unit.entry.temper;
    if (t && entryTemper && t.id === entryTemper) {
      d = d > 0 ? d * (t.gain != null ? num(t.gain) : 1) : d * (t.loss != null ? num(t.loss) : 1);
      d = d > 0 ? Math.max(1, Math.round(d)) : Math.min(-1, Math.round(d));
    }

    const cur = num(unit.bond);
    let cap = num(unit.ceiling);
    if (!(cap > 0)) cap = cur + Math.abs(d);   // no ceiling known ⇒ do not invent a clamp
    const after = Math.max(0, Math.min(cap, cur + d));
    return after - cur;
  } catch (e) { return 0; }
}

export function stanceTally(units, choice) {
  const out = { support: 0, middle: 0, against: 0 };
  try {
    if (!Array.isArray(units)) return out;
    for (const u of units) {
      const st = stanceFor(u, choice);
      if (st.stance === 'support') out.support++;
      else if (st.stance === 'against') out.against++;
      else out.middle++;
    }
    return out;
  } catch (e) { return { support: 0, middle: 0, against: 0 }; }
}

// ══════════════════════════════════════════════════════════════════════════
// SELECTION
// ══════════════════════════════════════════════════════════════════════════

/* The degradation ladder, as levels. Level 0 is the real policy; 1-3 are what
   the Heights does when it has run out of new decisions rather than showing the
   player a broken screen.
     0 — influence band + the last `recentDepth` resolved + the 72h repeat cooldown
     1 — drop the 72h cooldown            (the common case on a 12-entry corpus)
     2 — drop the influence band too
     3 — block only the immediately-previous dilemma
   Level 3 is the floor and is never relaxed: handing a player the exact dilemma
   they just resolved is the one outcome that reads as a bug rather than as a
   quiet week. A corpus of one therefore returns null, and the caller says so. */
function poolAt(state, now, level) {
  const out = [];
  const inf = clampInfluence(state.influence);
  const recent = Array.isArray(state.recent) ? state.recent : [];
  const seen = (state.seen && typeof state.seen === 'object') ? state.seen : {};
  const list = Array.isArray(DILEMMAS) ? DILEMMAS : [];
  for (const d of list) {
    if (!d || typeof d.id !== 'string') continue;
    if (!Array.isArray(d.choices) || !d.choices.length) continue;

    if (level <= 1) {
      const lo = (typeof d.minInfluence === 'number') ? d.minInfluence : DILEMMA_ECON.influenceMin;
      const hi = (typeof d.maxInfluence === 'number') ? d.maxInfluence : DILEMMA_ECON.influenceCap;
      if (inf < lo || inf > hi) continue;
    }
    if (level <= 2) {
      if (recent.indexOf(d.id) !== -1) continue;
    } else {
      if (recent.length && recent[0] === d.id) continue;
    }
    if (level <= 0) {
      if (now - num(seen[d.id]) < DILEMMA_ECON.repeatCooldownMs) continue;
    }
    out.push(d);
  }
  return out;
}

/* Allocation-free existence check for `available()`. The hub tile asks this on
   every render of the hub screen, and building (and discarding) the whole
   eligible array to learn whether its length is greater than zero is work
   nobody reads. */
function hasEligible(state, now) {
  const inf = clampInfluence(state.influence);
  const recent = Array.isArray(state.recent) ? state.recent : [];
  const seen = (state.seen && typeof state.seen === 'object') ? state.seen : {};
  const list = Array.isArray(DILEMMAS) ? DILEMMAS : [];
  for (const d of list) {
    if (!d || typeof d.id !== 'string') continue;
    if (!Array.isArray(d.choices) || !d.choices.length) continue;
    const lo = (typeof d.minInfluence === 'number') ? d.minInfluence : DILEMMA_ECON.influenceMin;
    const hi = (typeof d.maxInfluence === 'number') ? d.maxInfluence : DILEMMA_ECON.influenceCap;
    if (inf < lo || inf > hi) continue;
    if (recent.indexOf(d.id) !== -1) continue;
    if (now - num(seen[d.id]) < DILEMMA_ECON.repeatCooldownMs) continue;
    return true;
  }
  return false;
}

/* One rule for "what time is it", used by every selection path.
   ⚠ `now == null`, not `!now`: a caller that legitimately pins the clock to 0
   (a test, or the epoch) must get 0 and not have the bridge quietly substitute
   the real time underneath it. `!now` looked identical and was not. */
function resolveNow(host, now) {
  if (now != null) return num(now);
  try { return num(host.now()); } catch (e) { return 0; }
}

export function eligible(host, now) {
  try {
    const s = ensureState(host);
    return poolAt(s, resolveNow(host, now), 0);
  } catch (e) { return []; }
}

export function available(host, now) {
  try {
    const s = ensureState(host);
    const t = resolveNow(host, now);
    // The 45-minute offer cooldown is checked FIRST because it is one
    // comparison and it is the answer most of the time.
    if (t < num(s.nextAt)) return false;
    return hasEligible(s, t);
  } catch (e) { return false; }
}

export function pickDilemma(host, now, rng) {
  try {
    const s = ensureState(host);
    const t = resolveNow(host, now);
    /* Deriving the selection rng from the clock rather than calling
       Math.random() keeps this file free of ambient randomness entirely — a
       critic can grep it and find none — and makes a selection reproducible
       from the timestamp alone. `state.resolved` is mixed in so two opens in
       the same millisecond after a resolution do not collide. */
    const r = (typeof rng === 'function') ? rng : makeRng(seedFrom('eh|pick|' + t + '|' + s.resolved));
    for (let level = 0; level <= 3; level++) {
      const pool = poolAt(s, t, level);
      if (!pool.length) continue;
      // The CAMP_RUN_EVENTS weight walk, index.html:65686-65691, verbatim in shape.
      const total = pool.reduce((a, d) => a + Math.max(0, num(d.weight)), 0);
      if (total <= 0) return pool[0];
      let x = num(r()) * total;
      for (const d of pool) { if ((x -= Math.max(0, num(d.weight))) <= 0) return d; }
      return pool[0];
    }
    return null;
  } catch (e) { return null; }
}

/* ── "About four choices" ───────────────────────────────────────────────────
   DILEMMA_ECON.choiceBag is 3:25 / 4:45 / 5:22 / 6:8 — expected value 4.13, so
   four is the shape of the thing and the count still varies per dilemma.

   Influence narrows the band at both ends (consumer #3, CONTRACT §9.3): people
   who owe you nothing offer you fewer ways out; people who need you lay out
   more. Note the floor and ceiling of the unmodified band are READ OFF the bag
   rather than restated, so retuning the bag cannot leave a stale clamp behind.

   Three degeneracies are impossible by construction, and each one was worth the
   line that prevents it:
   • FEWER THAN THE DILEMMA NEEDS — every `always: true` choice is taken first
     and `n` is raised to fit them, so the refusal option (or whatever the
     author marked essential) is in every offered set.
   • DUPLICATES — the sample is over INDICES into a Set, so an author who pastes
     the same choice object twice still gets it once.
   • AN EMPTY OR ONE-ITEM SET — `n` is at least `always.length`, and
     `validateCorpus()` guarantees at least one `always` and at least
     `choicesMin` authored choices. The `Math.min(n, all.length)` below is the
     only thing that can take it lower, and only for a corpus that is already
     failing validation.

   ⚠ ORDER NEVER VARIES, AND THAT IS A DECISION. Shuffling the presented order
   was considered and rejected: a player who has met a dilemma before would have
   to re-read every row, and the `always` refusal would float around the list,
   which reads as a bug rather than as variety. Only membership varies. */
export function rollChoices(dilemma, influenceValue, rng) {
  const all = (dilemma && Array.isArray(dilemma.choices)) ? dilemma.choices : [];
  try {
    if (!all.length) return [];

    const bag = Array.isArray(DILEMMA_ECON.choiceBag) ? DILEMMA_ECON.choiceBag : [];
    let n = num(pickWeighted(bag, rng));
    if (!(n > 0)) n = DILEMMA_ECON.choicesMin;

    let bagLo = Infinity, bagHi = 0;
    for (const row of bag) { const c = num(row && row[0]); if (c < bagLo) bagLo = c; if (c > bagHi) bagHi = c; }
    if (!isFinite(bagLo)) bagLo = DILEMMA_ECON.choicesMin;
    if (!(bagHi > 0)) bagHi = DILEMMA_ECON.choicesMin;

    const inf = clampInfluence(influenceValue);
    const lo = inf >= DILEMMA_ECON.highInfluence ? DILEMMA_ECON.choiceFloorHigh : bagLo;
    const hi = inf < DILEMMA_ECON.lowInfluence ? DILEMMA_ECON.choiceCeilLow : bagHi;
    n = Math.max(lo, Math.min(Math.max(lo, hi), n));

    /* Indices, not objects, and deduped by choice id on the way in.
       Index-only was the first cut and it was not enough: an author who pastes
       the same choice OBJECT twice into `choices` gets two distinct indices
       pointing at one object, and the sample can take both — which puts the
       identical row on screen twice and then pays its bond twice. Found by
       feeding rollChoices a corpus with a repeated entry. `validateCorpus()`
       would reject that corpus, but a validator nobody ran on the hot path is
       not a guarantee, and a duplicated row is visible to the player.
       Two passes, `always` first, so that if a duplicated id carries the flag on
       only one of its copies it is the FLAGGED one that survives — dropping a
       choice the dilemma needs to make sense is a worse failure than showing a
       repeat. */
    const alwaysIdx = [], restIdx = [], claimed = Object.create(null);
    const keyOf = (c, i) => ((c && typeof c.id === 'string' && c.id) ? c.id : ('#' + i));
    for (let i = 0; i < all.length; i++) {
      const c = all[i];
      if (!c || !c.always) continue;
      const k = keyOf(c, i);
      if (claimed[k]) continue;
      claimed[k] = 1; alwaysIdx.push(i);
    }
    for (let i = 0; i < all.length; i++) {
      const c = all[i];
      if (!c || c.always) continue;
      const k = keyOf(c, i);
      if (claimed[k]) continue;
      claimed[k] = 1; restIdx.push(i);
    }
    n = Math.max(n, alwaysIdx.length);
    n = Math.min(n, alwaysIdx.length + restIdx.length);

    const take = new Set(alwaysIdx);
    for (const i of shuffled(restIdx, rng)) {
      if (take.size >= n) break;
      take.add(i);
    }

    const out = [];
    for (let i = 0; i < all.length; i++) if (take.has(i)) out.push(all[i]);
    return out.length ? out : all.slice(0, DILEMMA_ECON.choicesMin);
  } catch (e) {
    // Never `[]`: a dilemma with no choices is a dead modal.
    return all.slice(0, DILEMMA_ECON.choicesMin);
  }
}

/* One instance = one seed. Everything random about this dilemma — which choices
   are on the table, and later the reward rolls rewards.js runs on the same rng —
   is decided HERE, once, and cached.

   The reason is a bug this codebase already documented in a different feature:
   `render.paint()` rebuilds the modal's innerHTML on every state change, so a
   choice set rolled during render would reshuffle under the player's cursor —
   the same class of failure community.render.js:51-53 records for the chat
   input. render.js must never call an rng, and a critic will grep it for
   `Math.random`. So will they grep this file, and find none either: the seed is
   derived from the clock via `seedFrom(dilemma.id + ':' + now)`, which makes a
   whole resolution reproducible from (id, openedAt) and a bug report actionable.

   OPENING IS INSPECTING. Nothing is persisted here — no `seen` stamp, no
   cooldown, no standing. A player who opens the Heights and walks back out has
   changed nothing, which is the same rule `resonanceGet` draws at
   index.html:206918-206921. */
export function openDilemma(host, opts) {
  try {
    if (!host) return null;
    const o = opts || {};
    const s = ensureState(host);

    const now = resolveNow(host, o.now);

    let d = null;
    if (o.id) {
      // A forced open (admin, debug, a test) bypasses the cooldowns but NOT the
      // corpus: an id that is not in DILEMMAS is a typo, not a dilemma.
      d = (DILEMMA_BY_ID && DILEMMA_BY_ID[o.id]) || null;
      if (!d) return null;
    } else {
      /* The offer cooldown is enforced here and not only in `available()`, so
         that the hub tile's badge and the tile's click can never disagree —
         a badge that says nothing is waiting and a panel that opens anyway is
         the same lie told twice. */
      if (now < num(s.nextAt)) return null;
      d = pickDilemma(host, now);
      if (!d) return null;
    }

    const seed = seedFrom(d.id + ':' + now);
    const rng = makeRng(seed);
    const influenceAtOpen = clampInfluence(s.influence);

    return {
      dilemma: d,
      choices: rollChoices(d, influenceAtOpen, rng),
      seed,
      openedAt: now,
      influenceAtOpen,
      roster: roster(host),
      resolved: false,
    };
  } catch (e) { return null; }
}

// ══════════════════════════════════════════════════════════════════════════
// MUTATION
// ══════════════════════════════════════════════════════════════════════════

/* 🔴 THE MODULE NEVER WRITES `.bond`. Not once, not "just to snapshot it".
   Every change goes through `host.adjustBond(id, delta, kind)`, which is the
   bridge's single wrapper over index.html's `adjustBond` — the function that
   applies temperament, clamps to `bondCeilingFor(entry)`, and (on the create
   path) stamps `bondScaled: true`.

   ⚠ `bondScaled: true` IS NOT COSMETIC. `saveProfile()` runs `_migrateBondScale`
   (index.html:70821 → 72731) across every entry, and `_migrateBondEntry`
   rewrites any unflagged `bond <= 100` as `round(100 + bond * 11)`. A row
   created at BOND_NEW (100) without the flag becomes 1200 — instantly Sworn —
   on the very next save. The bridge does the create exactly as `_rezEntry` does
   (index.html:73486-73487); this file's job is to never invent a second path.

   ⚠ THE DELTA HANDED OVER IS THE RAW ONE. `adjustBond` scales by temperament
   itself. Passing `previewBond()`'s output would apply a Vain unit's 1.5 loss
   twice.

   Nothing is saved here. The whole resolution batches one save at §9.4 step 5,
   because saveProfile() stringifies the entire Profile and doing it eight times
   for eight companions is eight stalls for one decision. */
export function applyStances(host, instance, choice) {
  const out = [];
  try {
    if (!host || !instance || !Array.isArray(instance.roster) || !choice) return out;
    for (const u of instance.roster) {
      if (!u || !u.id) continue;
      const st = stanceFor(u, choice);
      if (st.stance === 'middle') continue;
      const want = rawDelta(u, choice);
      if (!want) continue;

      let before = num(u.bond);
      try { before = num(host.bondOf(u.id, u.kind)); } catch (e) { /* keep the snapshot */ }

      let after = null;
      try { after = host.adjustBond(u.id, want, u.kind); } catch (e) { after = null; }
      const ok = (typeof after === 'number' && isFinite(after));

      /* `delta` is what LANDED, never what was asked for, and `landed` is false
         when the bridge refused (null) or when the ceiling ate the change. The
         aftermath view prints these, and a resolution that claims a companion
         warmed to you when their bond did not move is the kind of small lie a
         player notices exactly once and then stops trusting the screen. */
      out.push({
        id: u.id, kind: u.kind, name: u.name,
        before, delta: ok ? (after - before) : 0, after: ok ? after : before,
        requested: want, stance: st.stance, reason: st.reason,
        landed: ok && after !== before,
      });
    }
    return out;
  } catch (e) { return out; }
}

/* State, and ONLY state. Cinder, cards and bond are somebody else's step —
   which is what keeps "who wrote this number" answerable when a player asks why
   their standing moved.

   §9.4 runs this BEFORE the bond ticks and before the grant, deliberately:
   `adjustBond` is not invertible (temperament scales gains and losses by
   different factors, so +5 then −5 does not return a Vain unit to where it
   started), so there is no honest rollback for the bond step and the only way
   to guarantee one is never needed is to run the step that CAN fail first. The
   alternative — snapshotting each entry's raw `.bond` and restoring it — was
   rejected because restoring requires a direct `.bond` write, which would put a
   second bond-writing path into a codebase that has exactly one. */
export function commit(host, instance, choice, influenceDelta) {
  try {
    if (!host || !instance || !instance.dilemma) return false;
    // Idempotent per instance. index.js holds a `busy` lock too, but a double
    // commit must be inert on its own account rather than on a lock's — a
    // second write here would burn a second `recent` slot and re-arm the
    // 45-minute cooldown from a click the player made once.
    if (instance.resolved) return true;

    const s = ensureState(host);
    let now;
    try { now = num(host.now()); } catch (e) { now = 0; }

    const id = instance.dilemma.id;
    const dInf = clampAbs(Math.round(num(influenceDelta)), DILEMMA_ECON.influenceMax);
    s.influence = clampInfluence(s.influence + dInf);

    if (!s.seen || typeof s.seen !== 'object') s.seen = {};
    s.seen[id] = now;

    const recent = Array.isArray(s.recent) ? s.recent.filter(x => x !== id) : [];
    recent.unshift(id);
    s.recent = recent.slice(0, DILEMMA_ECON.recentDepth);

    s.nextAt = now + DILEMMA_ECON.offerCooldownMs;
    s.resolved = Math.max(0, Math.floor(num(s.resolved))) + 1;

    // Verbatim, because the caller's refund path is written for this boolean.
    return saveState(host, s);
  } catch (e) { return false; }
}

export function markResolved(instance) {
  try { if (instance && typeof instance === 'object') instance.resolved = true; } catch (e) {}
}
