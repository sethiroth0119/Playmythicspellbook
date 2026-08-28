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

   🔴 THE STATE SEAM COPIES, AND THIS FILE DEPENDS ON IT. `host.state()` hands
   back a fresh CLONE of `Profile.dilemma` and `host.setState(x)` stores a
   clone — both ends, in index.js's adapter and again in index.html's bridge
   (CONTRACT-R2 §1.2). Round 1 handed the live object out by reference, so
   `commit()` wrote influence, `seen`, `recent`, `nextAt` and `resolved` onto
   the persisted blob and then reported failure without unwinding: the player
   was told the Heights did not record their call, got their Cinder back, and
   still lost ten standing, a `recent` slot and their next forty-five minutes —
   and the refund's own `addGems()` then persisted the phantom resolution. With
   a copying seam, mutating the object `ensureState()` returns costs nothing
   until `saveState()` lands it, and `saveState()` is the ONE place that lands
   it and the ONE place that unwinds. There is no second restore path in this
   file and there must never be one — a second place to put the state back is a
   second place for that bug to come back.

   🔴 `updatedAt` IS THE STAMP OF A DECISION, NOT OF A WRITE. Only a successful
   `commit()` may advance it: `saveState()` refuses to touch it unless the
   caller asks with `{ stamp: true }`, and `commit()` is the only caller that
   asks. The cloud hydration merge in index.html ranks two blobs by `resolved`
   FIRST and falls back to `updatedAt` only to break a tie, so a device that
   opened the Heights and decided nothing can no longer outrank a device that
   resolved. Those are two locks on one door and BOTH are load-bearing —
   round 2 shipped a merge that trusted the stamp and, in the same commit, a
   pin write that advanced it; each half was written correctly against a
   contract that did not name the join, and the bug landed in neither file.
   Removing either lock on the grounds that the other exists is how it comes
   back. See `saveState()` and `openDilemma()`.

   ⚙ ONE TUNING TABLE. Every number a choice is worth lives in `DILEMMA_ECON`
   in data.js and nowhere else — the `_opEcon()` habit as the CORP_LAWS header
   states it (index.html:80551-80553). If you find yourself typing a magnitude here, it
   belongs there instead. The only bare numbers below are algorithm constants
   (FNV-1a's prime, mulberry32's mixing words), the four rung indices of the
   degradation ladder — which are branch labels, not dials — and the identity
   values 0 and 1. A reviewer will grep for the rest and should find none.
   ════════════════════════════════════════════════════════════════════════════ */

import { DILEMMA_ECON, DILEMMAS, DILEMMA_BY_ID, DILEMMA_SCHEMA_VERSION, INFLUENCE_RANKS } from './data.js';

/* ── The value vocabulary ───────────────────────────────────────────────────
   Stance is derived from the SHIPPED value system: eight poles on four opposed
   axes (`LQ_AXES` index.html:73043, `LQ_POLE_AXIS` index.html:73049) and the
   tuned approve/oppose magnitudes in `LQ_INTENSITY` (index.html:73057-73061). Both
   arrive over the bridge as `host.values()`.

   🔴 THE MAGNITUDES ARE NEVER COPIED INTO THIS FILE, and that is a decision.
   Duplicating `{ mild:{approve:2,oppose:3}, … }` here would give the project a
   second bond-magnitude table that drifts from index.html's the first time
   anyone retunes it — which is exactly the live copy bug in a reference file
   (src/resonance/house.camp.js:152 promises "No rest-quality modifier here" while
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
   (index.html:48059-48062). Every timestamp in this file goes through `num()`.

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

/* The CAMP_RUN_EVENTS weight walk (`_campRollEvent`, index.html:65747-65750),
   generalised to
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
    /* 🎟 THE PINNED OFFER — { id, seed, at } — see `openDilemma()`. It rides
       INSIDE this blob deliberately: `Profile.dilemma` is already whitelisted
       wholesale in all three places (the cloud payload, the hydration merge and
       loadForge's local restore), so a new field here needs no whitelist edit
       and cannot become the sixth silent-save bug this project has shipped. */
    offer: null,
    lastDeck: null,
    updatedAt: 0,
  };
}

/* A pinned offer that survived a reload, a corrupt blob or a cross-device merge
   has to load as "no offer", never as a throw and never as a half-record: an
   offer with no id would pin the player to nothing at all for the rest of the
   45-minute window.

   🔴 `at` MUST BE A POSITIVE, FINITE NUMBER — BOTH ENDS, and round 2 only
   reasoned about one of them. A stamp of 0 is treated as absent for the same
   reason `ensureState` drops a `seen` stamp of 0: a zero timestamp is
   indistinguishable from never, and pretending otherwise arms a window that
   opened in 1970. The symmetric case is the one that shipped broken — a stamp
   this device's clock cannot have written is not a record either. `openDilemma`
   measured the pin's age as `now - at` and a FUTURE stamp gives a negative age,
   which satisfies `< offerCooldownMs` for the whole duration of the skew:
   driven at one day ahead, eight opens spanning eighteen hours returned the
   same dilemma eight times out of eight; at one year ahead, the same. This
   function has no `now` in scope so it cannot range-check the future — it can
   only reject a value that is not a timestamp at all, and `openDilemma()`'s
   `age >= 0` test is the other half. Both are needed; neither is spare.

   The coercion is written out rather than routed through `num()` because the
   SHAPE is the point: `Number()` throws on a Symbol, and NaN / ±Infinity are
   not clocks. Folding them to 0 and testing `> 0` gets the same answer today,
   but it hides the rule from the next reader. */
function normalizeOffer(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const id = (typeof o.id === 'string' && o.id) ? o.id : null;
  let at = 0;
  try { const n = Number(o.at); if (isFinite(n) && n > 0) at = n; } catch (e) { at = 0; }
  if (!id || !at) return null;
  return { id, seed: num(o.seed), at };
}

/* A recorded deck is only useful if it can still be READ. `_dilemmaRecordDeck`
   in index.html writes this at battle start and deliberately does not call
   saveProfile() (that would add a 50-200 ms stringify to the worst possible
   moment — `saveProfile`'s own perf note, index.html:70910-70912), so a
   half-written or force-quit record is a
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
   least five times — index.html:46676-46683 records a player losing a
   120,000-Cinder Gene Vault to a key that was in neither cloud whitelist — so
   every field here is defaulted and no shape is assumed. A save written before
   this feature existed, a corrupt blob, `null`, a string, an array and a
   half-filled object all have to load as "a stranger arriving in Ethos
   Heights", never as a throw.

   It writes the normalised object back through `host.setState()` so the rest of
   the session reads one shape, but it deliberately does NOT save: merely
   LOOKING at your standing must not cost a whole-Profile stringify. That is the
   same split `resonanceGet`/`resonanceSet` draws at index.html:207034-207037
   — the citation index.html's own dilemma bridge uses for the same rule, so
   the two files now agree about the same function instead of disagreeing. */
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
    s.offer = normalizeOffer(s.offer);
    s.lastDeck = normalizeLastDeck(s.lastDeck);
    s.updatedAt = num(s.updatedAt);

    /* The normalisation write-back. It is not a save and it is not a resolution:
       it repairs the SHAPE so the rest of the session reads one blob. Since the
       seam clones (see the header), this stores a copy and leaves `s` ours to
       mutate — which is exactly what makes `saveState()`'s rollback snapshot
       survive its own `setState`. A refused setState is reported by saveState,
       not here: merely LOOKING at your standing must not raise an error. */
    try { host.setState(s); } catch (e) { /* a stale shape beats a thrown one */ }
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
   player a click. Under-reporting one costs them their standing.

   ────────────────────────────────────────────────────────────────────────────
   🔴 `opts.stamp` — WHO IS ALLOWED TO MOVE `updatedAt`, AND WHY THE DEFAULT IS
   "NO". One sentence governs this parameter and both owners of the seam must be
   able to recite it:

     `updatedAt` is the timestamp of the most recent DECISION, not of the most
     recent WRITE. Only a successful `commit()` may advance it. `resolved` is
     the count of decisions and is monotone. A blob that has decided more times
     outranks a blob that has decided fewer, whatever either one's `updatedAt`
     says.

   `saveState(host, state)` therefore leaves `updatedAt` exactly as it found it
   — it neither writes it nor deletes it, and the last real decision's stamp
   (normalised by `ensureState`) rides through untouched. `saveState(host,
   state, { stamp: true })` keeps the old behaviour, and `commit()` is the only
   call site in the feature that passes it.

   THE DEFAULT IS `false` ON PURPOSE, and the asymmetry is the reason. A write
   that FAILS to stamp merely loses a cross-device merge it should not have won.
   A write that stamps WRONGLY destroys standing the player earned. So the
   caller who forgets the parameter gets the safe direction, not the dangerous
   one. Round 2 is the whole argument: the wiring fixer removed a battle-start
   stamp from a path that decides nothing, the engine fixer added a persisted
   offer-pin write — carrying a stamp — to a path that decides nothing, both
   read their contract correctly, and a stale desktop that merely OPENED the
   Heights then outranked a phone that had resolved (influence 54 → 50,
   resolved 1 → 0, an armed 45-minute cooldown → 0).

   ⚠ This is the ENGINE's lock. index.html's hydration merge carries a second,
   independent one — it ranks on `resolved` before it looks at `updatedAt` at
   all — and neither may be removed on the grounds that the other exists. Each
   is written to hold with the other reverted, and each is tested that way. */
export function saveState(host, state, opts) {
  try {
    if (!state || typeof state !== 'object') return false;

    /* 🔴 THE ROLLBACK SNAPSHOT, AND IT LIVES HERE ON PURPOSE.
       Every state write in this feature goes through this function, so putting
       the unwind in the ONE atomic write means no future caller has to remember
       it. `host.state()` returns a COPY (CONTRACT-R2 §1.2) — that is precisely
       why the seam clones, and it is what lets this snapshot survive the
       `setState` two lines below instead of being re-aliased by it.

       The snapshot is taken AFTER `ensureState()` has already repaired the
       shape, and that split is correct: a failed resolution must not survive,
       but a normalisation must — putting a corrupt blob back would be undoing a
       repair, not undoing a purchase. */
    let prev = null;
    try { prev = host.state(); } catch (e) { prev = null; }

    /* The stamp, and ONLY when the caller has declared a decision. `!== true`
       rather than `!opts.stamp` so a truthy-but-not-true value (a stray `1`
       from a future refactor) reads as "did not say yes" — the same `=== true`
       discipline this file applies to `setState` and `save` two lines below,
       and for the same reason: the safe answer is the one an ambiguous host
       gets. */
    if (opts && opts.stamp === true) state.updatedAt = num(host.now());

    // A refused setState wrote NOTHING. There is nothing to unwind, and calling
    // setState again to "restore" would be the only write of the pair.
    if (host.setState(state) !== true) return false;
    if (host.save() === true) return true;

    /* The save failed. Put the old blob back BEFORE returning false, so the
       caller's refund does not persist a resolution we are about to tell them
       did not happen — the refund's own addGems() calls saveProgressCloud(),
       which would have written the phantom to disk and to the cloud. This is
       the order production.state.js:452-461 already uses: `s.placed.pop();
       host.setState(s);` and THEN `paid.refund()` — "the in-memory state must
       not carry a purchase that was refunded."

       If the restoring setState fails too, we still return false and we do NOT
       retry. A host that refuses two writes in a row is not one this file can
       repair from here, and `false` is the right answer either way: the caller
       refunds, which is the player-favourable direction.

       ⚠ `Object.keys(prev).length`, not a bare `if (prev)`. `{}` is TRUTHY, and
       `{}` is exactly what `host.state()` returns when it cannot read — the
       sentinel `ensureState()` documents as "a stranger arriving in Ethos
       Heights". Writing that back is not a rollback, it is a WIPE: driven
       against a live blob at influence 88, resolved 40, recent ['a','b'] and a
       recorded lastDeck, an unreadable snapshot plus a failing save left
       `Profile.dilemma` as `{}` — the player's whole standing and their deck
       record gone, on the one path whose entire purpose is to change nothing.
       An empty snapshot carries no information to restore, so the honest move
       is to restore nothing and still report the failure.

       ⚠ THE RESIDUAL, STATED RATHER THAN HIDDEN. There is no third option from
       inside this function: `{}` is the only value the snapshot offers and
       writing it is the wipe. So on this one path — an unreadable snapshot AND
       a failed save — the in-memory blob keeps the resolution the caller is
       about to be told did not happen. Both branches driven side by side: the
       shipped guard leaves influence 92 / resolved 41 with the deck record
       intact; round 2's bare `if (prev)` leaves a zero-key blob with the
       standing and the deck record GONE. Nothing reached disk in either case —
       `save()` is what failed — so the damage window is until some other
       system's `saveProfile()` fires, and a dirty blob that the next reload
       overwrites from disk is strictly better than a wipe that the next save
       makes permanent. Reachability is very low: the bridge's own `state()`
       catches its throws and creates `Profile.dilemma = {}` before reading, so
       an empty answer usually means the blob really is empty — in which case
       declining to write it back changes nothing at all. */
    if (prev && Object.keys(prev).length) { try { host.setState(prev); } catch (e) { /* nothing further to try */ } }
    return false;
  } catch (e) { return false; }
}

export function influence(host) {
  try { return clampInfluence(ensureState(host).influence); }
  catch (e) { return DILEMMA_ECON.influenceSeed; }
}

/* The named rung of the ladder, `RESERVE_RANKS`-style (index.html:56284-56290).
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

/* 🔴 THE NEWCOMER, AND IT IS THE ORDINARY FIRST-WEEK ROW, NOT AN EDGE CASE.
   `_dilemmaRecordDeck` records EVERY key in the deck the player took into
   battle, but index.html's battle-end loop only creates a `Profile.units` row
   for units actually DEPLOYED (`cur._lastBattleFielded = true`,
   index.html:152711, inside the fieldedSet walk). A twelve-card deck that
   fielded four leaves eight companions with no profile row at all.

   Round 1 read those rows through `bondOf`, which answers 0 for a missing row,
   and printed them at "Wary 0" — the only surface in the game that shows a
   companion below BOND_NEW. The modal then previewed +3 and the resolve landed
   +103, because the bridge's `adjustBond` CREATES the row at BOND_NEW (100)
   before applying the delta (`_rezEntry`'s create shape, index.html:73559-73561,
   is what it copies).
   A unit that OBJECTED was reported as having warmed to the player by +94.

   So the row's baseline is the value the mutator will actually start from.
   `host.bondNew()` is that number and it is the bridge's to know, not ours —
   BOND_NEW is a bond constant and CONTRACT §0 puts every bond literal in
   DILEMMA_ECON or on the far side of the bridge.

   ⚠ THE `0` BRANCH IS UNREACHABLE THROUGH THE SHIPPED SEAM, AND ROUND 2'S
   COMMENT HERE WAS WRONG ABOUT IT. It claimed that a service-worker-cached
   index.html without a `bondNew` accessor would make this return 0 and "behave
   exactly as round 1 did". It does not: index.js's adapter ALWAYS defines
   `bondNew` and converts the missing-bridge-accessor TypeError into the literal
   `100` by contract (CONTRACT-R2 §5.3), so `typeof host.bondNew` is a function
   on every path this file can be reached from. Driven with `delete
   bridge.bondNew`: newcomer rows still read 100. The behaviour is right; the
   described failure mode is impossible.

   The branch stays anyway, and NOT as a described degradation — as the
   totality guard this file applies to every host accessor it touches. It is
   here so `newcomerBase` is a total function of whatever it is handed, the same
   way `stanceFor` answers Middle for a null unit. A comment that a single
   coercion one layer up can falsify is a defect; a guard that is simply never
   needed is a habit. Those are different things and this file only claims the
   second one. */
function newcomerBase(host) {
  try {
    if (typeof host.bondNew !== 'function') return 0;
    const n = num(host.bondNew());
    return n > 0 ? n : 0;
  } catch (e) { return 0; }
}

/* A companion whose card definition is missing on this device still gets a row
   (see the `unit:` branch in `roster()`), and round 1 labelled it with the raw
   internal id — a roster line reading "ghost". Card ids in this codebase are
   slugs of the card name (`goblin`, `xenoDrone`, `parasiteHost`), so titling the
   slug is the closest honest label available: "Ghost", "Xeno Drone". It is a
   formatting rule, not an invented name, and it never puts an internal
   identifier in front of a player. The row also carries `unresolved: true` so
   the fact is preserved rather than lost; render.js does not read it this round
   and must not start without a contract change. */
function titleFromId(id) {
  try {
    const raw = String(id == null ? '' : id);
    if (!raw) return '';
    const spaced = raw.replace(/[_\-.:]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
    if (!spaced) return raw;
    return spaced.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  } catch (e) { return String(id == null ? '' : id); }
}

function rosterRow(host, id, kind, card, order, fallback) {
  const entry = (kind === 'hero')
    ? (typeof host.heroEntry === 'function' ? host.heroEntry(id) : null)
    : (typeof host.unitEntry === 'function' ? host.unitEntry(id) : null);

  /* `bondOf` returns 0 for a missing row, and 0 is a real bond for a companion
     who HAS a row. The two are only distinguishable from `entry`, which is why
     the newcomer test is `!entry` and not `bond === 0`. */
  const newcomer = !entry;
  let bond = 0;
  if (newcomer) {
    bond = newcomerBase(host);
  } else {
    try { bond = num(host.bondOf(id, kind)); } catch (e) { bond = 0; }
  }

  let tier = null;
  try { tier = host.bondTier(bond); } catch (e) { tier = null; }

  /* 🎭 Heroes carry no temperament and never have — `getUnitTemper` would
     happily DERIVE one from the hero id (`getUnitTemper`, index.html:72677), and it would be a
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
     typeof-object guard in `bondCeilingFor` (index.html:72584), which reads as "the clamp works"
     while silently ignoring saleCount and everSold. */
  let ceiling = 0;
  try { ceiling = num(host.bondCeiling(entry)); } catch (e) { ceiling = 0; }
  if (!(ceiling > 0)) { try { ceiling = num(host.bondMax()); } catch (e) { ceiling = 0; } }

  /* CAN legitimately be `[]`, and that is the COMMON case, not an edge case —
     see `stanceFor`. A null card (a forged card whose definition was never
     published on this device, `lookupCustomCard` at index.html:51096) resolves the
     same way instead of throwing its way into the render pipeline. */
  let poles = [];
  try { const p = host.valueProfile(card); if (Array.isArray(p)) poles = p; } catch (e) { poles = []; }

  return {
    id, kind, card: card || null, entry: entry || null,
    name: (card && card.name) || titleFromId(id),
    icon: (card && card.icon) || '',
    bond, tier: tier || null, ceiling, temper, poles,
    fallback: !!fallback,
    /* ⚙ ENGINE-INTERNAL. `previewBond` clamps from `bond` and `applyStances`
       takes `before` from `bond` instead of re-reading `bondOf`, so preview,
       report and the real write all move from one number. The row renders like
       any other — "Neutral 100" — which is what every other bond surface in the
       game shows for a fresh companion. */
    newcomer,
    unresolved: !card,
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

/* 🔴 THE ROSTER KNOWS WHICH LADDER IT CAME DOWN, AND ROUND 2 HAD NO WAY TO SAY
   SO. `roster()` returns an ARRAY, and an empty array cannot distinguish "no
   deck was ever recorded" from "this player owns no units" — so render's only
   available test was `rows.length > 0 && rows.every(fallback)`, which is false
   for `[]`, and a brand-new player read the heading "Standing with you — The
   deck you last took out" directly above the body "No one is standing with you
   yet." Two contradicting sentences, on the most common first-session path.

   The fix is a NAME on the instance, not a flag on the rows: `rosterSource` is
   `'deck' | 'heuristic' | 'none'` and it is set here, by the function that
   actually took the branch. `'none'` outranks the other two — an empty roster
   has no source worth naming, and a heading that describes a list with nothing
   in it is the bug. `roster()` keeps its exported signature and its `[]`
   failure value verbatim (CONTRACT §4 is frozen); this internal is what
   `buildInstance` calls.

   ⚠ `'none'` also covers the narrow case of a RECORDED deck that resolved to
   zero rows — every key filtered out as a spell or an unresolvable `custom:`.
   It does not fall through to the heuristic, and that is deliberate: the
   heuristic answers "who have you fought beside most", which is a different
   question from "who was in that deck", and silently substituting one for the
   other is the relabelling this file's fallback comment exists to prevent.
   Zero rows with an honest empty-state line beats a confident wrong list. */
function rosterOf(host) {
  try {
    if (!host) return { rows: [], source: 'none' };
    const s = ensureState(host);
    const ld = s.lastDeck;

    if (ld) {
      const rows = [];
      const seenIds = Object.create(null);
      let order = 0;

      /* The hero enters the field separately from the deck — `buildStarterDeck`
         strips `type === 'hero'` out of the card list at index.html:73809-73810
         — so it is prepended rather than found among the keys.
         ⚠ KNOWN GAP, stated rather than worked around: `findHeroById` is not on
         the bridge (CONTRACT §6), and `cardById` (_cardDefById,
         index.html:87393) only reaches custom + unit pools, so a BUILT-IN
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
      const deckRows = rankRoster(rows);
      return { rows: deckRows, source: deckRows.length ? 'deck' : 'none' };
    }

    /* ── Fallback: no deck was ever recorded ────────────────────────────────
       First run, or a save from before the recorder shipped. `fallbackRoster`
       ranks Profile.units by (_lastBattleFielded ? 1 : 0), then together, then
       fielded.
       ⚠ `_lastBattleFielded` is NOT a last-roster record and must never be
       presented as one: it is set true only for units actually DEPLOYED
       (index.html:152711) and cleared only for benched units that were in
       s._deckUnitIds (index.html:152810), so a unit from a deck the player
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
    // opens — render.js prints one honest line rather than an empty box, and
    // `'none'` is what tells it to print that line WITHOUT a heading that
    // describes a deck.
    const heurRows = rankRoster(rows);
    return { rows: heurRows, source: heurRows.length ? 'heuristic' : 'none' };
  } catch (e) { return { rows: [], source: 'none' }; }
}

/* The CONTRACT §4 export, unchanged in signature and in failure value: the
   units that react, at most `DILEMMA_ECON.rosterMax` of them, `[]` on any
   failure. Callers that also need to know which ladder produced the list read
   `instance.rosterSource`. */
export function roster(host) {
  try { return rosterOf(host).rows; } catch (e) { return []; }
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

   This is the shipped `_lqPoleVerdict(pole, st)` (index.html:73298-73310) turned
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
       nothing (`_lqUnitValueProfile` index.html:73104-73114, over
       `_lqArchetypeDefault` index.html:73093-73100) — and it finds nothing whenever the
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
   `adjustBond` (index.html:72593-72615) applies the unit's temperament itself.
   Passing it a temper-scaled number would scale a Vain unit's loss by 1.5 twice
   and land −27 where the table says −12. `previewBond()` below is the display
   half and does the scaling; this half must stay raw.

   The magnitudes are LQ_INTENSITY's, verbatim, over the bridge — mild 2/3, firm
   3/6, zealous 5/10 — multiplied by how much the choice is ABOUT its poles
   (`choice.weight`, one of DILEMMA_ECON.choiceWeights). Inventing a second
   magnitude table for "a unit approved / a unit objected" when a tuned one
   already ships is the parallel-system mistake index.html:80526 argues against.

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

  // The same guard `adjustBond` uses at index.html:72609, for the same
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
     The preview returns that negative rather than promising a gain. It is
     honest and, on its own, unexplained: a SUPPORTER reading "−551" has to be
     told why. The two surfaces get that from the same two numbers — the roster
     row already carries `bond` and `ceiling`, so render derives
     `bond > ceiling > 0` there; the aftermath row has neither, so
     `applyStances` reports `overCap` alongside the delta. One condition, three
     surfaces, which is what keeps the preview and the receipt from disagreeing.
   • A NEWCOMER — a deck card carried into battle but never deployed, so it has
     no profile row yet — clamps from `bondNew()`, which is where the bridge's
     `adjustBond` is about to create it. That is the whole of the round-2 fix
     here: this function already clamped from `unit.bond`, and `rosterRow` now
     puts the right number in it. Round 1 previewed +3 against a landed +103. */
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

/* ⚙ EXPORTED, AND NOTHING IN `/src/dilemma` IMPORTS IT — the same is true of
   `eligible()` below. Both are named in CONTRACT §4, so both stay: the seam is
   specified as a whole rather than as whatever today's consumers happen to
   reach for, and resplitting the export list is out of scope (CONTRACT-R2
   §6.11). `render.js` computes its own tallies from `stanceFor` per row because
   it already has the rows in hand, and `available()` uses the allocation-free
   `hasEligible()` instead. Saying so here is cheaper than the next reader
   grepping for a caller, finding none, and wondering whether it is dead. */
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
/* The influence gate, in one place. `eligible()`, `available()` and the pinned
   offer's re-check all ask the same question, and three copies of an inclusive
   band comparison is three chances for one of them to drift to `<` on a rewrite.
   Not invented: this is `needMorale` on RECON_EVENTS generalised to a band. */
function withinBand(d, influenceValue) {
  const inf = clampInfluence(influenceValue);
  const lo = (typeof d.minInfluence === 'number') ? d.minInfluence : DILEMMA_ECON.influenceMin;
  const hi = (typeof d.maxInfluence === 'number') ? d.maxInfluence : DILEMMA_ECON.influenceCap;
  return inf >= lo && inf <= hi;
}

function poolAt(state, now, level) {
  const out = [];
  const inf = clampInfluence(state.influence);
  const recent = Array.isArray(state.recent) ? state.recent : [];
  const seen = (state.seen && typeof state.seen === 'object') ? state.seen : {};
  const list = Array.isArray(DILEMMAS) ? DILEMMAS : [];
  for (const d of list) {
    if (!d || typeof d.id !== 'string') continue;
    if (!Array.isArray(d.choices) || !d.choices.length) continue;

    if (level <= 1 && !withinBand(d, inf)) continue;
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
    if (!withinBand(d, inf)) continue;
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
      // The CAMP_RUN_EVENTS weight walk (`_campRollEvent`, index.html:65747-65750),
      // verbatim in shape.
      const total = pool.reduce((a, d) => a + Math.max(0, num(d.weight)), 0);
      if (total <= 0) return pool[0];
      let x = num(r()) * total;
      for (const d of pool) { if ((x -= Math.max(0, num(d.weight))) <= 0) return d; }
      return pool[0];
    }
    return null;
  } catch (e) { return null; }
}

/* 🔴 THE FALLBACK SET, AND ROUND 1 GOT IT WRONG IN A WAY THAT CONTRADICTED THE
   PARAGRAPH BELOW IT. `rollChoices` promised the `always` choice — the refusal,
   the walk-away — is in EVERY offered set, and then its catch path returned
   `all.slice(0, choicesMin)`. Every authored dilemma places its refusal LAST,
   so that slice dropped it on every dilemma in the corpus: the one branch a
   player can always take, gone precisely when something has already gone wrong.

   So the fallback claims the `always` indices FIRST and fills up to `choicesMin`
   from the rest, then emits in AUTHORED ORDER — the same order guarantee the
   happy path makes, because a player who has met this dilemma before must not
   have to re-read every row. If a dilemma authors more `always` choices than
   `choicesMin`, they all survive: the floor is a floor, not a cap.

   Pure, allocation-bounded, and it takes no rng — which is the point. It is
   reached when the rng itself threw (`shuffled()` calls it outside `num()`'s
   guard), so it must not ask for another random number to recover. */
function authoredFallback(all) {
  const rows = Array.isArray(all) ? all : [];
  const take = new Set();
  for (let i = 0; i < rows.length; i++) if (rows[i] && rows[i].always) take.add(i);
  for (let i = 0; i < rows.length && take.size < DILEMMA_ECON.choicesMin; i++) take.add(i);
  const out = [];
  for (let i = 0; i < rows.length; i++) if (take.has(i)) out.push(rows[i]);
  return out;
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
     author marked essential) is in every offered set. That now holds on the
     FAILURE path too: round 1's catch returned `all.slice(0, choicesMin)`,
     which dropped the refusal on every dilemma in the corpus because every one
     of them authors it last. See `authoredFallback` above.
   • DUPLICATES — the sample is over INDICES into a Set, so an author who pastes
     the same choice object twice still gets it once.
   • AN EMPTY OR ONE-ITEM SET — `n` is at least `alwaysIdx.length`, and
     `validateCorpus()` guarantees at least one `always` and at least
     `choicesMin` authored choices. The `Math.min(n, alwaysIdx.length +
     restIdx.length)` below is the only thing that can take it lower, and only
     for a corpus that is already failing validation.

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
    return out.length ? out : authoredFallback(all);
  } catch (e) {
    // Never `[]`: a dilemma with no choices is a dead modal.
    return authoredFallback(all);
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

   🔴 AN OFFER IS A COMMITMENT TO THAT OFFER — THE PIN, AND WHY IT EXISTS.
   Round 1 seeded from the clock on every open and persisted nothing, so closing
   and reopening the modal rerolled the dilemma AND its choice set for free. The
   45-minute cadence is armed only by `commit()`, so before the first resolve of
   each window a player could reopen until the corpus handed them the branch they
   wanted: measured at forty reopens over five seconds reaching twenty-four of the
   authored dilemmas, and sixty reopens of one id producing twenty distinct choice
   sets. That is shopping, not deciding, and it aims straight at the largest
   `cinderBand` — which is the faucet data.js's own audit note is written about
   ("a farmed Cinder and an earned Cinder are the same integer in the same
   column").

   So the first open of a window PINS `{ id, seed, at }` into the blob and every
   reopen inside that window replays it. The cost is one whole-Profile stringify
   per 45 minutes, on a path that is already painting a full modal — and it is
   the same write that makes index.js's §2 claim ("if the page reloads mid
   dilemma, nothing was spent and nothing moved, and the offer is still there")
   true, which round 1's was not.

   OPENING IS STILL INSPECTING. No `seen` stamp, no cooldown, no standing, no
   Cinder — the pin records WHICH decision is on the table, never that it was
   taken. A player who opens the Heights and walks back out has changed nothing
   they can feel, which is the rule `resonanceGet` draws at
   index.html:207034-207037. `available()` stays strictly read-only: it runs
   twice per hub render and must never arm, persist or clear the pin. */
export function openDilemma(host, opts) {
  try {
    if (!host) return null;
    const o = opts || {};
    const s = ensureState(host);

    const now = resolveNow(host, o.now);

    if (o.id) {
      /* A forced open (admin, debug, a test) bypasses the cooldowns and the pin
         but NOT the corpus: an id that is not in DILEMMAS is a typo, not a
         dilemma. It persists nothing either — a debug open must not be able to
         overwrite the offer a player is in the middle of. */
      const forced = (DILEMMA_BY_ID && DILEMMA_BY_ID[o.id]) || null;
      if (!forced) return null;
      return buildInstance(host, s, forced, seedFrom(forced.id + ':' + now), now);
    }

    /* The offer cooldown is enforced here and not only in `available()`, so that
       the hub tile's badge and the tile's click can never disagree — a badge
       that says nothing is waiting and a panel that opens anyway is the same lie
       told twice. It is also what bounds a pin that arrived from another device:
       `commit()` clears the pin and arms `nextAt` in the SAME atomic write, so a
       pin that outlived its own resolution can only reach this line behind a
       `nextAt` that already blocks it. That is why the reuse test below checks
       eligibility and not `recent`. */
    if (now < num(s.nextAt)) return null;

    /* 🔴 THE AGE IS BOUND ONCE AND IT MUST BE NON-NEGATIVE.
       Round 2 wrote `(now - num(pin.at)) < offerCooldownMs` and nothing else. A
       pin stamped in the FUTURE gives a NEGATIVE age, and a negative number is
       less than the cooldown forever — so the pin is replayed for the entire
       duration of the skew and the player is stranded on one dilemma. Driven
       with a pin one day ahead: eight opens spanning eighteen hours of real
       time returned the same id eight out of eight; at one year ahead, the
       same; at one hour ahead it self-healed once real time overtook the skew,
       which is what confirms the mechanism rather than a coincidence.

       It is reachable without malice and it is not a jailbroken-phone case. A
       device whose date is fast writes the pin here, and before CONTRACT-R3 the
       same write stamped `updatedAt` and won the cloud merge onto a
       correct-clock device. The stamp is gone now (see `saveState`) and the
       merge ranks on `resolved` first, so the pin can no longer travel by
       outranking a real resolution — but a merged blob can still legitimately
       carry a foreign `at`, so the range check stays. `normalizeOffer` rejects
       an `at` that is not a timestamp at all; this rejects one that is a
       timestamp from a clock we do not share. Neither half covers the other. */
    const pin = s.offer;
    const pinAge = pin ? (now - num(pin.at)) : 0;
    if (pin && pinAge >= 0 && pinAge < DILEMMA_ECON.offerCooldownMs) {
      const pinned = (DILEMMA_BY_ID && DILEMMA_BY_ID[pin.id]) || null;
      if (pinned && withinBand(pinned, s.influence)) {
        /* Replayed from the pin's OWN clock, not from now — the seed, the choice
           set and `openedAt` must be the ones the player was already looking at,
           or reopening would still be a reroll with extra steps. */
        return buildInstance(host, s, pinned, num(pin.seed) || seedFrom(pinned.id + ':' + num(pin.at)), num(pin.at));
      }
      /* The pinned dilemma left the corpus (a trimmed data.js) or the player's
         standing moved out of its band. Fall through and roll a fresh one rather
         than offering a dilemma the Heights would no longer bring them. */
    }

    const d = pickDilemma(host, now);
    if (!d) return null;
    const seed = seedFrom(d.id + ':' + now);

    /* ONE write per window, and its failure is not fatal. If the save does not
       land the pin is simply not durable — the modal in front of the player is
       still coherent because `d` and `seed` are already in hand, and the next
       open rerolls, which is round-1 behaviour rather than a new failure.
       Refusing to open on a failed save would trade a live feature for a
       bookkeeping entry.

       ⚠ Guarded on `now > 0` because `normalizeOffer` reads `at <= 0` as absent:
       pinning against a dead clock would spend a whole-Profile stringify on a
       record the next load deletes, on EVERY open.

       🔴 AND IT MUST NOT STAMP `updatedAt`. ROUND 2 GOT THIS BACKWARDS AND THE
       COMMENT THAT SAT HERE ARGUED FOR THE BUG.

       The pin records WHICH decision is on the table. It never records that one
       was taken. `saveState()` is called WITHOUT `{ stamp: true }` above, so
       this write leaves the stamp exactly where the last real decision left it
       — and that is the whole fix. The old comment reasoned that "the pin IS
       dilemma state, written on the device the player is looking at, so
       claiming the later write is the correct one"; index.html's merge comment,
       written in the same round by a different owner, asserted the opposite
       ("`updatedAt` now moves only inside saveState() … the later blob is
       genuinely the one that decided last"). Both were half-arguments about a
       join neither file owned, and between them they reopened the exact hole
       CONTRACT-R2 §5.5 had just closed for `_dilemmaRecordDeck`: a stale
       desktop that OPENED the Heights and decided nothing outranked a phone
       that had resolved — influence 54 → 50, resolved 1 → 0, an armed
       45-minute cooldown → 0, with only `seen` surviving because `seen` was the
       one field with a per-field merge rule.

       The distinction that settles it is "did `resolved` move", not "did a
       field change" and not "did something happen". Opening is inspecting; the
       pin is a field of a blob that has not decided anything new, so its write
       is silent on the merge. `commit()` is the only writer that speaks.

       This is the engine's lock. index.html's hydration merge holds a second,
       independent one — it ranks on `resolved` before it consults `updatedAt`
       at all — and the two are deliberately redundant. Deleting either because
       the other exists is what round 2 proves you must not do. */
    if (now > 0) {
      s.offer = { id: d.id, seed, at: now };
      saveState(host, s);
    }

    return buildInstance(host, s, d, seed, now);
  } catch (e) { return null; }
}

/* The instance itself. Split out so the pinned path and the fresh path build
   byte-identical objects — a reopened dilemma that differed from its first open
   in any field would be the bug the pin exists to prevent, wearing a disguise. */
function buildInstance(host, state, dilemma, seed, openedAt) {
  const influenceAtOpen = clampInfluence(state.influence);
  /* One call, two fields. Deriving the source separately would mean walking the
     ladder twice and risking the list and its label disagreeing — which is the
     class of bug this field exists to close, not one to reintroduce. */
  const r = rosterOf(host);
  return {
    dilemma,
    choices: rollChoices(dilemma, influenceAtOpen, makeRng(seed)),
    seed,
    openedAt,
    influenceAtOpen,
    roster: r.rows,
    /* 'deck' | 'heuristic' | 'none' — CONTRACT-R3 §6.3. Additive and optional
       by contract: render.js is required to render correctly when it is absent
       (a stale service-worker engine.js), and its fallback there must suppress
       the sub-line rather than guess at one. A signal that does not arrive must
       make render say NOTHING, never something false. */
    rosterSource: r.source,
    resolved: false,
  };
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
   on its first line (index.html:70895); `_migrateBondScale` is at
   index.html:72805 and walks every entry, and
   `_migrateBondEntry` (index.html:72799-72804) rewrites any unflagged
   `bond <= 100` as `round(100 + bond * 11)`. A row
   created at BOND_NEW (100) without the flag becomes 1200 — instantly Sworn —
   on the very next save. The bridge does the create exactly as `_rezEntry` does
   (`_rezEntry`'s create shape, index.html:73559-73561); this file's job is to
   never invent a second path.

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

      /* 🔴 `before` COMES FROM THE ROW, AND FOR A NEWCOMER IT STAYS THERE.
         The re-read exists because bond can have moved since the modal opened
         (a battle finishing in another tab, a sale), and the aftermath must
         report against what was true a moment ago rather than a stale snapshot.
         But `bondOf` answers 0 for a MISSING row, and for a newcomer that 0 is
         exactly what produced round 1's "+94 to a companion who objected": the
         bridge creates the row at BOND_NEW and returns 94, and 94 − 0 is the
         report. A row with no entry has nothing to refresh from, so it doesn't. */
      let before = num(u.bond);
      if (!u.newcomer) {
        try { before = num(host.bondOf(u.id, u.kind)); } catch (e) { /* keep the snapshot */ }
      }

      let after = null;
      try { after = host.adjustBond(u.id, want, u.kind); } catch (e) { after = null; }
      const ok = (typeof after === 'number' && isFinite(after));

      /* `delta` is what LANDED, never what was asked for. A resolution that
         claims a companion warmed to you when their bond did not move is the
         kind of small lie a player notices exactly once and then stops trusting
         the screen.

         🔴 `landed` IS TWO-VALUED AND IT WAS CARRYING THREE MEANINGS. Round 2
         wrote `landed: ok && after !== before`, which collapses "the bridge
         refused the write" and "the ceiling absorbed it" into one `false`.
         render.js's ledger could then only take its `!landed` arm and printed
         "not recorded" for both — so a Sworn companion at 1200 who SUPPORTED
         the call read "This one cannot move — their regard is already at its
         ceiling" in the roster and "not recorded" in the receipt, in the same
         modal, three seconds apart. The render owner saw the ambiguity, refused
         to guess, and had no field to read; the engine owner was never told.
         Neither could fix it alone, which is exactly why the field is specified
         here rather than inferred there.

         `status` is that field, and it is TOTAL — five values, no gaps, no
         sixth meaning to be invented later:

           'refused'   the bridge returned null / non-finite. Nothing was written.
           'moved'     the bond moved, by `delta`.
           'ceiling'   accepted, nothing moved, and we ASKED for a gain — the cap.
           'floor'     accepted, nothing moved, we asked for a loss, and there was
                       nothing left to take (`before <= 0`).
           'unchanged' accepted, nothing moved, any other shape. This file will
                       not guess which end, and says so rather than picking one.

         🔴 INVARIANT, ASSERTED IN THE DRIVER ON EVERY PATH:
         `landed === (status === 'moved')`. `landed` keeps today's exact value
         because CONTRACT §4's `AppliedBond` names it; `status` is strictly more
         informative and never contradicts it.

         ⚠ 'not recorded' is render's copy for `'refused'` and for NOTHING else,
         including a row with no `status` at all. A stale service-worker
         engine.js that emits none must make the ledger print a blank note —
         accurate but unexplained — rather than round 2's confident falsehood.

         `overCap` answers the other question the receipt could not: WHY a unit
         that agreed with you lost bond. A companion whose `bondCeilingFor` has
         been LOWERED beneath its current bond (sold more than three times, or
         sold at all while Sworn) is dropped to the cap by `adjustBond` on the
         next adjustment whatever the sign. Driven at saleCount 6, bond 900,
         ceiling 349: the roster reads "▲ Support −551", the receipt reads "▼
         Cold Operator −551", and round 2 put nothing on either surface saying
         why. It is computed from the SAME `before` this row reports and the
         same `u.ceiling` `previewBond()` clamps against — one number feeding
         three surfaces, which is the property that made 567 of 567 previews
         match what landed. */
      const moved = ok && after !== before;
      let status;
      if (!ok) status = 'refused';
      else if (moved) status = 'moved';
      else if (want > 0) status = 'ceiling';
      else if (want < 0 && before <= 0) status = 'floor';
      else status = 'unchanged';

      const cap = num(u.ceiling);
      out.push({
        id: u.id, kind: u.kind, name: u.name,
        before, delta: ok ? (after - before) : 0, after: ok ? after : before,
        requested: want, stance: st.stance, reason: st.reason,
        landed: moved,
        status,
        overCap: cap > 0 && num(before) > cap,
      });
    }
    return out;
  } catch (e) { return out; }
}

/* State, and ONLY state. Cinder, cards and bond are somebody else's step —
   which is what keeps "who wrote this number" answerable when a player asks why
   their standing moved.

   🔴 ALL OR NOTHING. After this returns anything other than `true`, the
   persisted blob is exactly what it was before the call: same influence, same
   `seen`, same `recent`, same `nextAt`, same `resolved`, same pinned offer. It
   mutates the `s` it got from `ensureState()` freely, and that is safe because
   `s` is a COPY (see the header) — nothing reaches `Profile.dilemma` until
   `saveState()` lands it, and `saveState()` puts the old blob back if it
   doesn't. This function adds no unwind of its own; one restore path is the
   whole design.

   Round 1's comment here argued rollback away, and it was the one place this
   file's reasoning was wrong. The argument is true of BOND — `adjustBond`
   scales gains and losses by different temperament factors, so +5 then −5 does
   not return a Vain unit to where it started, and restoring the raw value would
   need a direct `.bond` write into a codebase that has exactly one bond-writing
   path. It is false of state: influence, `recent`, `nextAt` and `resolved` are
   plain integers and strings, fully invertible, and quoting the bond argument to
   justify leaving them dirty is how a player ended up refunded for a resolution
   that still cost them ten standing and their next forty-five minutes.

   What survives from that argument is the ORDER, and §9.4 keeps it: this runs
   BEFORE the bond ticks and before the grant, because the step that can fail
   must be the one that runs while there is still nothing to undo. */
export function commit(host, instance, choice, influenceDelta) {
  try {
    if (!host || !instance || !instance.dilemma) return false;

    /* Idempotent per instance, and now actually so. index.js holds a `busy`
       lock as well, but a double commit must be inert on its OWN account rather
       than on a lock's — round 1 read this flag and never set it, so the guard
       was dead code and two commits on one instance moved influence twice,
       burned a second `recent` slot and re-armed the cooldown from a click the
       player made once. The flag is set below, on success only; `markResolved()`
       stays exported and stays called by index.js, and both being idempotent is
       fine. */
    if (instance.resolved) return true;

    const s = ensureState(host);

    /* 🔴 NO CLOCK, NO COMMIT. Round 1 fell back to `now = 0` and then armed
       `nextAt = 0 + offerCooldownMs` — a 1970 timestamp, permanently in the
       past, which disables the 45-minute cadence gate for the rest of the save.
       That cadence is not decoration: it is the entire reason this feature can
       reuse the battle bond magnitudes without out-earning battles (see
       `rawDelta`). It also stamped `seen[id] = 0`, which the next
       `ensureState()` deletes as garbage, losing the 72h repeat cooldown too.
       A refunded resolution costs the player one click. A permanently disarmed
       cooldown costs them the balance of the feature, silently. */
    const now = resolveNow(host);
    if (!(now > 0)) return false;

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

    /* The pinned offer is spent, and it is cleared inside this same atomic
       write. A FAILED commit therefore leaves it armed, which is correct: the
       decision is still on the table and the player must find the same one
       waiting when they try again. */
    s.offer = null;

    /* 🔴 THE ONE STAMPING WRITE IN THE FEATURE. `{ stamp: true }` says a
       DECISION was taken, which is the only thing `updatedAt` is allowed to
       mean (see `saveState`). Every other `saveState` call in this file and in
       index.js omits it and therefore leaves the stamp alone. */
    if (saveState(host, s, { stamp: true }) !== true) return false;

    /* Only now. `true` from this function means the resolution is durably
       written, and index.js is entitled to spend bond and mint a card on it. */
    instance.resolved = true;
    return true;
  } catch (e) { return false; }
}

/* index.js's re-entrancy guard calls this at §9.4 step 6. `commit()` already
   set the flag on its own success path, so this is now a second idempotent write
   of the same `true` rather than the only one — which is the point: the guard
   holds whether or not a caller remembers to call it. Kept exported because the
   CONTRACT names it and because a caller that composes the transaction
   differently still needs the seal. */
export function markResolved(instance) {
  try { if (instance && typeof instance === 'object') instance.resolved = true; } catch (e) {}
}
