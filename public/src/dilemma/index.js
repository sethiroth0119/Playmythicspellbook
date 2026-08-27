/* ════════════════════════════════════════════════════════════════════════════
   🏛 ETHOS HEIGHTS DILEMMAS — module entry. Registers window.MythicDilemmas.
   ----------------------------------------------------------------------------
   New York's corpse is being built on top of. Somebody has to decide which
   half of a block gets the water, and the companions you last took past the
   wall are standing right there while you decide. This file is the seam that
   makes that possible without index.html growing another system (CLAUDE.md).

   Five files, one direction of travel:
       data.js    → nothing            (the corpus + DILEMMA_ECON, pure)
       engine.js  → data.js            (RNG, stance, state, roster)
       rewards.js → data.js            (Cinder, cards, the derived effect prose)
       render.js  → data, engine       (the modal and nothing else)
       index.js   → all four           (this file: the host adapter + the order)
   The DAG is strict and deliberate. engine.js does not import rewards.js and
   rewards.js does not import engine.js; the resolve transaction is composed
   HERE because this is the only file that knows the ordering. A cycle would
   work in a bundler and fail as a native ES module, which is how this app
   actually loads its /src modules.

   🔴 THE GLOBALS TRAP. `Profile`, `Cloud`, `App`, `Corp`, `Forge` are top-level
   `const` in index.html — global LEXICAL bindings, NOT properties of `window`.
   An ES module cannot see them and `window.Profile` is `undefined` however
   global `const Profile` looks. That has cost this project real time twice
   (FoundationReserve, then Profile, both on the Node City bridge). So this
   module reads NOTHING by itself: index.html hands over
   window.MythicDilemmaBridge, and with no bridge the module still loads, still
   registers, does nothing, and says so exactly once.

   ⚠ INERT UNTIL OPENED. Importing this file costs one object literal and four
   module evaluations. No timer is started, no listener is attached, no <style>
   is appended and no Profile key is touched until something calls open().
   render.js injects its own stylesheet lazily on the first open — which is a
   deliberate difference from /src/city/index.js, whose registration block
   appends its <style> immediately. A panel behind a hub tile that most players
   will never press should not put a rule in the document to prove it exists.

   ⚠ Everything here is wrapped so a failure inside a dilemma can never take
   the game down. The dilemma is a feature; the game is the product.
   ════════════════════════════════════════════════════════════════════════════ */

import { DILEMMAS, DILEMMA_SCHEMA_VERSION, validateCorpus } from './data.js';
import {
  seedFrom, makeRng,
  ensureState, saveState, influence as influenceOf, rank as rankFor,
  roster, stanceFor, previewBond,
  available as availableNow, pickDilemma, openDilemma,
  applyStances, commit, markResolved,
} from './engine.js';
import {
  describeChoice, canAfford, payCost, refundCost,
  rollReward, influenceDelta, grant,
} from './rewards.js';
import { openModal, closeModal, isOpen as modalIsOpen, paint } from './render.js';

/* ════════════════════════════════════════════════════════════════════════════
   1. THE HOST ADAPTER
   ════════════════════════════════════════════════════════════════════════════
   /src/city/index.js:34-95 is the shape, and its comment at :62-70 is the
   standard this file is held to:

     "🔴 THESE TWO REPORT FAILURE. THEY USED TO SWALLOW IT. … a throw from
      setProdState or saveProfile died here, build() returned {ok:true}, and the
      player was charged 50,000 Cinder for a building that never persisted."

   The same failure is available here in a slightly worse flavour: a swallowed
   save on step 5 of the resolve transaction means the player spent Cinder,
   watched eight companions react, and reloaded into a save where none of it
   happened — with no way to tell, because the modal said it worked. So
   `setState` and `save` return a strict boolean and the callers are written for
   it. Nothing throws across the seam in either direction; the answer is the
   return value.

   Every entry is individually wrapped with a TYPED fallback — 0 for a count,
   null for a lookup, false for a mutation, [] for a list. A partially-mounted
   or older bridge therefore degrades one accessor at a time instead of taking
   the modal down, and the module's own guards (engine.previewBond returns 0 for
   a null entry, rewards.grant treats a missing accessor as "unconfirmed") were
   all written against exactly these values. */
function makeHost() {
  const B = (typeof window !== 'undefined') ? window.MythicDilemmaBridge : null;

  /* ⚠ SHAPE CHECK, NOT TRUTHINESS. community.bridge.js:52 uses
     `typeof b.signedIn === 'function'` for this reason: a half-built bridge
     object (a syntax error partway through the literal, an older index.html
     that predates a method) passes `!!B` and then throws on the first call,
     inside whatever tried to use it. `state` is the right probe because it is
     the one accessor with no useful fallback — a dilemma with no persisted
     state has no cooldowns, no standing and no last deck. */
  if (!B || typeof B.state !== 'function') return null;

  return {
    // ── Persisted state ────────────────────────────────────────────────────
    state: () => { try { const s = B.state(); return (s && typeof s === 'object') ? s : {}; } catch (e) { return {}; } },
    /* Strict `=== true`, both here and in engine.saveState. An older bridge
       whose setter returned `undefined` on success must read as a FAILURE
       rather than as a silent success — the whole point of the boolean is that
       the refund path can trust it. */
    setState: (s) => { try { return B.setState(s) === true; } catch (e) { return false; } },
    save: () => { try { return B.save() === true; } catch (e) { return false; } },
    /* Time comes over the bridge so a test can pin it, and so there is exactly
       one clock in the feature. `Date.now()` here would be a second one. */
    now: () => { try { const t = Number(B.now()); return isFinite(t) ? t : 0; } catch (e) { return 0; } },

    // ── Deck ───────────────────────────────────────────────────────────────
    /* engine.roster() reads `state.lastDeck` out of the persisted blob rather
       than calling this, because the blob is the thing that survives a reload
       and the accessor is only a view onto it. It is exposed anyway: the
       contract lists it, and `debug()` printing what the recorder actually
       wrote is the fastest way to answer "why is my old deck in there?". */
    lastDeck: () => { try { const d = B.lastDeck(); return (d && typeof d === 'object') ? d : null; } catch (e) { return null; } },
    resolveDeckCard: (key) => { try { return B.resolveDeckCard(key) || null; } catch (e) { return null; } },
    /* 🔴 THE JOIN. `Profile.decks[].cards` holds DECK KEYS ('unit:goblin',
       'custom:abc'); `Profile.units` is keyed by BARE CARD IDS ('goblin').
       Joining the two without this conversion produces zero matches silently —
       an empty roster, not an error, which is the worst possible failure for a
       modal whose whole point is the roster. */
    deckKeyCardId: (key) => { try { return B.deckKeyCardId(key) || null; } catch (e) { return null; } },
    cardById: (id) => { try { return B.cardById(id) || null; } catch (e) { return null; } },
    elementsOf: (card) => { try { const e = B.elementsOf(card); return Array.isArray(e) ? e : []; } catch (e) { return []; } },
    fallbackRoster: (n) => { try { const r = B.fallbackRoster(n); return Array.isArray(r) ? r : []; } catch (e) { return []; } },

    // ── Units, heroes, bond ────────────────────────────────────────────────
    /* READ-ONLY, AND THEY MUST STAY THAT WAY. Merely LOOKING at a card must
       not fabricate a progression row — window.MythicBridge states the rule for
       Resonance at index.html:206918-206921 and this feature inherits it: a
       dilemma modal DISPLAYS units, and displaying is inspecting. The bridge
       side reaches Profile.units directly rather than through getUnitProfile,
       which returns a DETACHED object for a missing row and throws every
       mutation on it away (index.html:73344-73356). Only adjustBond creates. */
    unitEntry: (id) => { try { return B.unitEntry(id) || null; } catch (e) { return null; } },
    heroEntry: (id) => { try { return B.heroEntry(id) || null; } catch (e) { return null; } },
    bondOf: (id, kind) => { try { const n = Number(B.bondOf(id, kind)); return isFinite(n) ? n : 0; } catch (e) { return 0; } },
    bondTier: (b) => { try { return B.bondTier(b) || null; } catch (e) { return null; } },
    /* ⚠ Takes a PROFILE ENTRY, not a number. Passing a number does not throw —
       bondCeilingFor's typeof-object guard sends it down the default path and
       returns BOND_MAX — so the mistake reads as "the clamp works" while
       silently ignoring saleCount and everSold. engine.previewBond passes the
       entry; nothing else may call this. */
    bondCeiling: (entry) => { try { const n = Number(B.bondCeiling(entry)); return isFinite(n) ? n : 0; } catch (e) { return 0; } },
    bondMax: () => { try { const n = Number(B.bondMax()); return isFinite(n) ? n : 0; } catch (e) { return 0; } },
    temperOf: (id, entry) => { try { return B.temperOf(id, entry) || null; } catch (e) { return null; } },
    valueProfile: (card) => { try { const p = B.valueProfile(card); return Array.isArray(p) ? p : []; } catch (e) { return []; } },
    values: () => { try { const v = B.values(); return (v && typeof v === 'object') ? v : null; } catch (e) { return null; } },

    /* 🔴 THE ONE BOND MUTATOR, and the only write this feature makes to another
       system's data. It routes to index.html's adjustBond, which applies the
       unit's temperament, clamps to bondCeilingFor(entry), and — on the create
       path — stamps `bondScaled: true`, without which saveProfile()'s
       _migrateBondScale rewrites a fresh bond of 100 as 1200 and hands the
       player an instantly Sworn companion.

       Returning `null` rather than a number is a real answer, not an error: the
       aftermath view prints "not recorded" for it instead of claiming a
       companion warmed to you when their bond never moved. */
    adjustBond: (id, delta, kind) => {
      try { const v = B.adjustBond(id, delta, kind); return (typeof v === 'number' && isFinite(v)) ? v : null; }
      catch (e) { return null; }
    },

    // ── Economy ────────────────────────────────────────────────────────────
    gems: () => { try { const n = Number(B.gems()); return isFinite(n) ? n : 0; } catch (e) { return 0; } },
    /* ⚠ Returns TRUE for n <= 0 and, on insufficient funds, returns false and
       does NOTHING ELSE — no toast, no clamp, no render (index.html:64434).
       rewards.canAfford() gates the button and this file toasts the refusal;
       an ungated button would simply do nothing when pressed. */
    spendGems: (n) => { try { return B.spendGems(n) === true; } catch (e) { return false; } },
    /* ⚠ NEVER with a negative amount. addGems guards on `amount === 0`, so a
       negative decrements Profile.gems locally while _serverMirrorCredit clamps
       to Math.max(0, …) and returns early — a durable client/server divergence.
       ⚠ `reason` is passed through and never defaulted. addGems falls back to
       the literal 'addGems', and that anonymous label is precisely why the
       Cinder supply could not be audited (index.html:64447-64453). */
    addGems: (n, reason) => { try { return B.addGems(n, reason) !== false; } catch (e) { return false; } },
    grantCard: (opts) => { try { const c = B.grantCard(opts); return (c && c.id) ? c : null; } catch (e) { return null; } },

    // ── Chrome ─────────────────────────────────────────────────────────────
    /* No `ms` is passed from this module, anywhere. The bridge owns the default
       so there is not a single timing literal in /src/dilemma outside the one
       tuning table, which is the rule data.js sets and this file keeps. */
    toast: (m) => { try { B.toast(m); } catch (e) {} },
    confirm: (m) => { try { return Promise.resolve(B.confirm(m)).then(v => !!v).catch(() => false); } catch (e) { return Promise.resolve(false); } },
    render: () => { try { B.render(); } catch (e) {} },
    isAdmin: () => { try { return (typeof B.isAdmin === 'function') ? !!B.isAdmin() : false; } catch (e) { return false; } },
  };
}

let _warned = false;
function host() {
  const h = makeHost();
  if (!h && !_warned) {
    _warned = true;
    try {
      console.warn('[dilemma] window.MythicDilemmaBridge is absent or incomplete — Ethos Heights is inert. ' +
                   'index.html must hand the module its capabilities (the globals trap; see CLAUDE.md).');
    } catch (e) {}
  }
  return h;
}

/* ════════════════════════════════════════════════════════════════════════════
   2. SESSION STATE
   ════════════════════════════════════════════════════════════════════════════
   Two variables, both deliberately module-level and neither persisted. The
   instance is a view of one decision in progress; if the page reloads mid
   dilemma, nothing was spent and nothing moved, and the offer is still there. */
let _instance = null;   // the Instance currently on screen, or null
let _busy = false;      // resolve re-entrancy lock; released in a finally

/* ════════════════════════════════════════════════════════════════════════════
   3. THE RESOLVE TRANSACTION
   ════════════════════════════════════════════════════════════════════════════
   CONTRACT §9.4, in order, and every failure lands on the player-favourable
   side. The order is the whole design, so it is written out rather than left
   to be inferred:

     1. payCost      — a refusal here means NOTHING has happened yet. Abort clean.
     2. commit       — state first, because it is the step that CAN fail. A
                       failure refunds the cost and leaves bond untouched.
     3. applyStances — bond, AFTER commit, because adjustBond is NOT INVERTIBLE:
                       temperament scales gains and losses by different factors,
                       so +5 then −5 does not return a Vain unit to where it
                       started. There is no honest rollback for this step, so it
                       runs after the last step that can need one. Snapshotting
                       and restoring the raw `.bond` was considered and rejected
                       — restoring means a direct `.bond` write, which would put
                       a second bond-writing path into a codebase that has
                       exactly one.
     4. grant        — Cinder and the card. Both persist themselves.
     5. save         — one save for the whole resolution rather than eight;
                       saveProfile() stringifies the entire Profile (50–200 ms,
                       up to 800 ms on the slow path, index.html:70835-70839).
                       A failure here is REPORTED, not unwound: the state
                       committed and the rewards landed, only the bond ticks are
                       at risk, and taking a granted card back off a player to
                       tidy up a save is worse than a lost bond tick.
     6. markResolved + the aftermath view + host.render() for the tile badge.

   Nothing in here throws. The modal awaits this and paints whatever comes back;
   `null` means "aborted, already explained by a toast" and render.js keeps the
   player on the choice list so they can pick something else. */
async function resolve(choiceId) {
  const h = host();
  if (!h) return null;

  const inst = _instance;
  if (!inst || inst.resolved) return null;

  // render.js holds its own lock as well. Both are cheap, and they guard
  // different things: this one survives a caller that reaches resolve() from
  // outside the modal (a console, a future keyboard shortcut).
  if (_busy) return null;
  _busy = true;

  try {
    let choice = null;
    for (const c of (inst.choices || [])) if (c && c.id === choiceId) { choice = c; break; }
    if (!choice) return null;

    // ── 1. COST ───────────────────────────────────────────────────────────
    const pay = payCost(h, choice);
    if (!pay.ok) {
      h.toast('⚠ ' + (pay.why || 'That call could not be made.'));
      return null;
    }

    // ── 2. STATE ──────────────────────────────────────────────────────────
    const influenceBefore = influenceOf(h);
    if (commit(h, inst, choice, influenceDelta(choice)) !== true) {
      /* The one refund path in the feature. It gives back the Cinder and says
         so; it does NOT recover the 2% Foundation spend tax the _gemsTaxTick
         poll already billed on the original spend (index.html:56789). That
         asymmetry is accepted rather than reaching for _gemsTaxExempt, because
         this branch only runs on a save that did not persist — rare, and
         already being reported to the player rather than hidden. */
      const back = refundCost(h, choice);
      h.toast(back
        ? '⚠ The Heights did not record your call. Your Cinder came back.'
        : '⚠ The Heights did not record your call, and the refund could not be confirmed.');
      return null;
    }
    const influenceAfter = influenceOf(h);

    // ── 3. BOND ───────────────────────────────────────────────────────────
    const bonds = applyStances(h, inst, choice);

    // ── 4. REWARD ─────────────────────────────────────────────────────────
    /* Rolled against `influenceAtOpen`, NOT the standing this call just moved.
       The modal quoted the player a band from the influence it had when the
       dilemma opened; paying a different one because their own choice shifted
       the multiplier mid-transaction would make the preview a lie by exactly
       the amount of the delta. The standing they earn here scales the NEXT one.

       The rng is derived from the instance seed and the choice id, so the
       outcome is reproducible from (dilemma.id, openedAt, choiceId) alone and a
       bug report is actionable. It is deliberately not `makeRng(instance.seed)`
       reconstructed: that stream's first draws were already consumed by
       rollChoices() inside openDilemma, so re-creating it would tie the reward
       roll to the same number that picked the choice count. */
    const rng = makeResolveRng(inst, choice);
    const rolled = rollReward(choice, inst.influenceAtOpen, rng);
    const gift = grant(h, inst, choice, rolled);

    // ── 5. SAVE ───────────────────────────────────────────────────────────
    /* engine.commit() already ran saveState(), which is a setState + save pair,
       so the standing is on disk. This second save is for the BOND entries —
       adjustBond writes them into Profile.units / Profile.heroes and
       deliberately does not save, so that eight companions cost one stringify
       instead of eight. */
    const saved = (bonds.length ? h.save() : true);

    let warning = '';
    if (!saved) warning = 'The companions\' regard could not be written to your save. Your standing and anything you were given are safe.';
    else if (gift && gift.ok === false && gift.why) warning = gift.why;

    // ── 6. DONE ───────────────────────────────────────────────────────────
    markResolved(inst);

    /* The hub tile's badge reads MythicDilemmas.available(), which is now false
       for the next 45 minutes. Without this the tile keeps saying a decision
       waits until something else happens to repaint the hub. */
    h.render();

    return {
      choiceId: choice.id,
      outcome: choice.outcome || '',
      lines: (gift && Array.isArray(gift.lines)) ? gift.lines : [],
      cinder: (gift && gift.cinder) || 0,
      card: (gift && gift.card) || null,
      influenceBefore,
      influenceAfter,
      bonds,
      warning,
    };
  } catch (e) {
    /* A throw that reaches here has already been through three layers of
       try/catch, so it is a bug in this file rather than in a dependency. Say
       so plainly instead of leaving the player looking at a modal that stopped
       responding — and never re-throw into render.js's click handler. */
    try { console.warn('[dilemma] resolve failed —', e); } catch (e2) {}
    try { const hh = host(); if (hh) hh.toast('⚠ Something went wrong resolving that. Nothing further was charged.'); } catch (e2) {}
    return null;
  } finally {
    _busy = false;
  }
}

/* A per-choice rng, derived from the instance seed using engine.js's own two
   primitives rather than a second generator written out here. It lives in this
   file because WHEN randomness turns is a property of the resolve ORDER, and
   the order is this file's business; engine.js exports the primitives and takes
   no view on when they run. */
function makeResolveRng(inst, choice) {
  return makeRng(seedFrom(String((inst && inst.seed) || 0) + ':' + String((choice && choice.id) || '')));
}

/* ════════════════════════════════════════════════════════════════════════════
   4. THE HANDLER SEAM
   ════════════════════════════════════════════════════════════════════════════
   render.js never touches the bridge, never calls an RNG and never writes
   state. Everything it needs to draw a stance, a preview delta, an effect line
   or a disabled button arrives through these six functions, and each one is
   already total on its own — render.js's callH() still supplies a typed
   fallback on top, which is belt and braces rather than duplication. */
function handlersFor(inst) {
  return {
    stance: (unit, choice) => stanceFor(unit, choice),
    preview: (unit, choice) => previewBond(unit, choice),
    /* The influence the dilemma OPENED at, matching the value rollReward() is
       given at resolve. One number, quoted once, paid once. */
    describe: (choice) => describeChoice(choice, inst.influenceAtOpen),
    affordable: (choice) => { const h = host(); return h ? canAfford(h, choice) : false; },
    onChoose: (choiceId) => resolve(choiceId),
    onClose: () => { _instance = null; },
  };
}

/* ════════════════════════════════════════════════════════════════════════════
   5. THE PUBLIC SURFACE
   ════════════════════════════════════════════════════════════════════════════
   Everything the feature can do is reachable from here, so nothing else needs
   to import from inside /src/dilemma. Every method is `const h = host(); return
   h ? real(...) : <inert value>` — the module loads, registers and answers
   honestly with no bridge at all. */
const MythicDilemmas = {
  version: 'v1',
  schema: DILEMMA_SCHEMA_VERSION,
  corpus: DILEMMAS,

  /* Opens the modal. `opts.id` forces a specific dilemma and bypasses the
     cooldowns but not the corpus — it is for an admin, a debug session or a
     test, never for the tile.
     Returns false when there is no bridge, when nothing is eligible, or when
     the modal could not be built. The hub tile turns a false into the honest
     toast rather than into a dead button. */
  open(opts) {
    try {
      const h = host();
      if (!h) return false;

      // Already open: do not build a second instance over the first. The
      // player would lose whatever they had selected and the two would race on
      // the same commit.
      if (modalIsOpen() && _instance) return true;

      const inst = openDilemma(h, opts || {});
      if (!inst) return false;

      _instance = inst;
      const ok = openModal(inst, inst.roster, handlersFor(inst));
      if (!ok) { _instance = null; return false; }
      return true;
    } catch (e) {
      try { console.warn('[dilemma] open failed —', e); } catch (e2) {}
      _instance = null;
      return false;
    }
  },

  close() { try { _instance = null; return closeModal() !== false; } catch (e) { return false; } },
  isOpen() { try { return modalIsOpen(); } catch (e) { return false; } },
  repaint() { try { paint(); return true; } catch (e) { return false; } },

  /* Cheap enough for the hub to call on every render — one clock comparison
     answers it most of the time, because the 45-minute offer cooldown is
     checked before the pool is walked. */
  available() { const h = host(); try { return h ? availableNow(h, h.now()) === true : false; } catch (e) { return false; } },

  /* What WOULD fire, without opening it or writing anything. Used for a richer
     badge and for debug(); the tile itself only needs available(). */
  peek() {
    const h = host();
    if (!h) return null;
    try {
      const d = pickDilemma(h, h.now());
      return d ? { id: d.id, title: d.title, icon: d.icon, district: d.district, sev: d.sev } : null;
    } catch (e) { return null; }
  },

  state() { const h = host(); try { return h ? ensureState(h) : {}; } catch (e) { return {}; } },
  influence() { const h = host(); try { return h ? influenceOf(h) : 0; } catch (e) { return 0; } },
  rank() { try { return rankFor(MythicDilemmas.influence()); } catch (e) { return null; } },
  roster() { const h = host(); try { return h ? roster(h) : []; } catch (e) { return []; } },

  bridgeReady() { return !!makeHost(); },

  /* One call that answers "why is this not doing what I expect". Deliberately
     runs validateCorpus() — it is pure, allocates its own arrays and never
     throws, and it is the only thing that will tell an author their new
     dilemma has two choices with the same id or has pushed the corpus past the
     vending-machine ratio. It is NOT on the hot path. */
  debug() {
    const h = host();
    let st = {}, now = 0;
    try { st = h ? ensureState(h) : {}; } catch (e) { st = {}; }
    try { now = h ? h.now() : 0; } catch (e) { now = 0; }
    let corpus = null;
    try { corpus = validateCorpus(); } catch (e) { corpus = { ok: false, errors: ['validateCorpus threw: ' + e], warnings: [] }; }
    return {
      bridge: !!h,
      open: MythicDilemmas.isOpen(),
      influence: MythicDilemmas.influence(),
      rank: MythicDilemmas.rank(),
      available: MythicDilemmas.available(),
      nextInMs: Math.max(0, (Number(st.nextAt) || 0) - now),
      recent: Array.isArray(st.recent) ? st.recent.slice() : [],
      resolved: Number(st.resolved) || 0,
      lastDeck: (st.lastDeck && st.lastDeck.id) ? st.lastDeck.id : (st.lastDeck ? '(keys only)' : null),
      rosterSize: MythicDilemmas.roster().length,
      corpusSize: DILEMMAS.length,
      corpus,
    };
  },

  /* Escape hatches the resolve path does not use but a console session will:
     re-normalising and re-saving state after hand-editing it. Exposed rather
     than left to a `debugger` statement because the alternative is somebody
     writing Profile.dilemma by hand and skipping ensureState entirely. */
  _save() { const h = host(); try { return h ? saveState(h, ensureState(h)) : false; } catch (e) { return false; } },
};

/* ════════════════════════════════════════════════════════════════════════════
   6. REGISTRATION
   ════════════════════════════════════════════════════════════════════════════
   The module → window direction is the one that works; window → `const Profile`
   is the one that does not, and is the globals trap this file opened with.

   ⚠ NO `mythic:dilemma-ready` EVENT, deliberately. src/community/index.js:55
   dispatches `mythic:community-ready` and its comment claims index.html listens
   for it rather than polling — a grep across the whole repo finds exactly one
   hit, the dispatch itself. The tile is really gated by a `typeof` check
   evaluated at render time. Do not build an entry point on a phantom listener;
   test the global. */
try {
  if (typeof window !== 'undefined') {
    window.MythicDilemmas = MythicDilemmas;
    window.__md = MythicDilemmas;   // console shorthand, like __mg / __mc
  }
} catch (e) {
  try { console.warn('[dilemma] registration failed —', e); } catch (e2) {}
}

export { MythicDilemmas };
export default MythicDilemmas;
