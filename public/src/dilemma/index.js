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
   /src/city/index.js:34-85 (makeHost) is the shape, and its comment at :63-70 is the
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

   🔴 AND THE STATE SEAM COPIES, IN BOTH DIRECTIONS. A strict boolean was not
   enough on its own. Round 1's `state()` handed back the LIVE Profile.dilemma;
   engine.commit() wrote influence, seen, recent, nextAt and resolved onto it,
   and when saveProfile() threw, commit() returned false without unwinding — so
   a resolution the player was told had FAILED still cost them standing, a
   `recent` slot and a 45-minute lockout, and the refund's own addGems() ->
   saveProgressCloud() wrote that phantom to disk and uploaded it. Copying on
   read alone does not close it either: setState stored the copy by reference,
   so ensureState()'s normalisation write-back re-aliased it one line later.
   Both ends copy, here and in index.html, so that engine.saveState()'s
   snapshot survives its own setState and can put the old blob back.

   Every entry is individually wrapped with a TYPED fallback — 0 for a count,
   null for a lookup, false for a mutation, [] for a list. A partially-mounted
   or older bridge therefore degrades one accessor at a time instead of taking
   the modal down, and the module's own guards (engine.previewBond returns 0 for
   a null entry, rewards.grant treats a missing accessor as "unconfirmed") were
   all written against exactly these values. `gems()` is the ONE deliberate
   exception and returns `number | null`; see its comment. */

/* The adapter's own clone, byte-identical in behaviour to index.html's
   `_dilemmaCloneState`. That duplication is NOT redundancy and must not be
   collapsed: `sw.js` caches `index.html` and `/src/*` separately and serves
   /src/** network-first, so a freshly-updated module can and does run against a
   service-worker copy of index.html that predates the copying seam and still
   returns the live Profile.dilemma. The adapter is the only surface the engine
   ever sees, so the adapter is where the invariant is actually enforced.
   Depth 3 is the whole persisted schema: seen{}, recent[], lastDeck{cards[]},
   offer{}. Nothing below that is an object, so nothing below that is aliased. */
function cloneState(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return {};
  const out = {};
  for (const k of Object.keys(s)) {
    const v = s[k];
    if (v === null || typeof v !== 'object') { out[k] = v; continue; }
    if (Array.isArray(v)) { out[k] = v.slice(); continue; }
    const o = {};
    for (const k2 of Object.keys(v)) { const v2 = v[k2]; o[k2] = Array.isArray(v2) ? v2.slice() : v2; }
    out[k] = o;
  }
  return out;
}
function makeHost() {
  const B = (typeof window !== 'undefined') ? window.MythicDilemmaBridge : null;

  /* ⚠ SHAPE CHECK, NOT TRUTHINESS. community.bridge.js:53 uses
     `typeof b.signedIn === 'function'` for this reason: a half-built bridge
     object (a syntax error partway through the literal, an older index.html
     that predates a method) passes `!!B` and then throws on the first call,
     inside whatever tried to use it. `state` is the right probe because it is
     the one accessor with no useful fallback — a dilemma with no persisted
     state has no cooldowns, no standing and no last deck. */
  if (!B || typeof B.state !== 'function') return null;

  return {
    // ── Persisted state ────────────────────────────────────────────────────
    /* 🔴 BOTH OF THESE COPY. Read the header. `state()` never returns anything
       the bridge still holds, and `setState()` never stores anything the caller
       still holds — which is what makes engine.saveState()'s rollback snapshot
       survive its own setState, and what makes the invariant true:
       after commit() returns anything but `true`, Profile.dilemma is exactly
       what it was before the call.
       It also closes a smaller hole for free: MythicDilemmas.state() below is
       this same accessor via ensureState(), so a console session can no longer
       do `MythicDilemmas.state().influence = 999999` and have the next
       unrelated saveProfile() from any system persist it. */
    state: () => { try { const s = B.state(); return (s && typeof s === 'object' && !Array.isArray(s)) ? cloneState(s) : {}; } catch (e) { return {}; } },
    /* Strict `=== true`, both here and in engine.saveState. An older bridge
       whose setter returned `undefined` on success must read as a FAILURE
       rather than as a silent success — the whole point of the boolean is that
       the refund path can trust it.

       ⚠ THE RESOLVE TRANSACTION MUST STAY SYNCHRONOUS, and that is load-bearing
       now rather than merely tidy. Round 1's setState assigned the very object
       it was handed (which WAS Profile.dilemma), so it was a no-op; this one
       REPLACES the blob. index.html has two other writers — _dilemmaRecordDeck
       at battle start and cloudFetchProfile's hydration merge — and a
       read-modify-write that yielded between ensureState() and setState() would
       drop whichever of them landed in the gap. It cannot today: resolve() is
       declared async for its callers' benefit and contains no `await`, and
       commit() does its own ensureState immediately before saveState. Do not
       put an await between a state read and its write. */
    setState: (s) => { try { return B.setState(cloneState(s)) === true; } catch (e) { return false; } },
    save: () => { try { return B.save() === true; } catch (e) { return false; } },
    /* Time comes over the bridge so a test can pin it, and so there is exactly
       one clock in the feature. `Date.now()` here would be a second one. */
    now: () => { try { const t = Number(B.now()); return isFinite(t) ? t : 0; } catch (e) { return 0; } },

    // ── Deck ───────────────────────────────────────────────────────────────
    /* engine.roster() reads `state.lastDeck` out of the persisted blob rather
       than calling this, because the blob is the thing that survives a reload
       and the accessor is only a view onto it.
       ⚠ THE OLD VERSION OF THIS COMMENT JUSTIFIED THE ACCESSOR WITH A CLAIM
       ABOUT debug() THAT WAS SIMPLY FALSE — debug() read `st.lastDeck` out of
       the normalised state blob and never called this at all, so the sentence
       described a consumer that did not exist. Rather than delete the claim,
       debug() now really does call it, and the two readings answer different
       questions: `lastDeck` below is what engine.ensureState() NORMALISED, and
       `lastDeckRaw` is what _dilemmaRecordDeck actually WROTE at battle start.
       When those two disagree the normaliser is the thing to look at, and that
       is exactly the session where somebody asks "why is my old deck in there?".
       🔴 AND IT CLONES. index.html's accessor hands back Profile.dilemma.lastDeck
       BY REFERENCE — a live sub-object of the Profile, `cards` array and all.
       Every other read on this seam copies (see the header), and handing a
       console session a live handle into the save is the exact shape of the bug
       round 1 shipped through `state()`. cloneState() is reused rather than a
       second cloner written: {id,name,heroId,at} are scalars and `cards` is an
       array of strings, which is depth 2 of the depth-3 clone. */
    lastDeck: () => {
      try { const d = B.lastDeck(); return (d && typeof d === 'object' && !Array.isArray(d)) ? cloneState(d) : null; }
      catch (e) { return null; }
    },
    resolveDeckCard: (key) => { try { return B.resolveDeckCard(key) || null; } catch (e) { return null; } },
    /* 🔴 THE JOIN. `Profile.decks[].cards` holds DECK KEYS ('unit:goblin',
       'custom:abc'); `Profile.units` is keyed by BARE CARD IDS ('goblin').
       Joining the two without this conversion produces zero matches silently —
       an empty roster, not an error, which is the worst possible failure for a
       modal whose whole point is the roster. */
    deckKeyCardId: (key) => { try { return B.deckKeyCardId(key) || null; } catch (e) { return null; } },
    cardById: (id) => { try { return B.cardById(id) || null; } catch (e) { return null; } },
    /* ⚠ NOTHING IN /src/dilemma CALLS THIS TODAY, and saying so is the point.
       It is here because CONTRACT §3 names it and because the seam is specified
       whole rather than as whatever the current consumers happen to need — the
       bridge side carries the fact that matters (built-ins carry `elements`, an
       array; a forged card may carry `element`, singular, so reading
       card.element directly is undefined for every built-in in the game). The
       bridge comment used to call it MANDATORY, which is a false word for an
       accessor with no consumer; both halves now say the same true thing. */
    elementsOf: (card) => { try { const e = B.elementsOf(card); return Array.isArray(e) ? e : []; } catch (e) { return []; } },
    fallbackRoster: (n) => { try { const r = B.fallbackRoster(n); return Array.isArray(r) ? r : []; } catch (e) { return []; } },

    // ── Units, heroes, bond ────────────────────────────────────────────────
    /* READ-ONLY, AND THEY MUST STAY THAT WAY. Merely LOOKING at a card must
       not fabricate a progression row — window.MythicBridge states the rule for
       Resonance at index.html:207105-207108 and this feature inherits it: a
       dilemma modal DISPLAYS units, and displaying is inspecting. The bridge
       side reaches Profile.units directly rather than through getUnitProfile,
       which returns a DETACHED object for a missing row and throws every
       mutation on it away (getUnitProfile, index.html:73489-73500). Only
       adjustBond creates. */
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
    /* 🔴 THE FLOOR A NEVER-DEPLOYED COMPANION STARTS FROM. A card that was in
       the deck but never put on the field has no Profile.units row, so bondOf()
       honestly answers 0 — and round 1 rendered that as "Wary 0", the only
       surface in the game that shows a companion below BOND_NEW, previewed +3,
       and then landed +103 because the bridge's adjustBond CREATES the row at
       BOND_NEW first. engine.rosterRow/previewBond/applyStances now start from
       this instead.
       ⚠ THE LITERAL 100 IS NOT A GUESS AND NOT A DUPLICATED CONSTANT. It is the
       service-worker fallback: /src/** is served network-first but index.html is
       cached, so an updated module can run against an index.html whose bridge
       predates this accessor. `Number(undefined)` is NaN, which is why the
       isFinite test rather than a truthiness one — and BOND_NEW has been 100
       since the bond system shipped, so a stale bridge degrades to the right
       answer rather than to zero. */
    bondNew: () => { try { const n = Number(B.bondNew()); return isFinite(n) ? n : 100; } catch (e) { return 100; } },
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
    /* 🔴 `number | null`, AND `null` IS NOT `0`. This is the one accessor in the
       adapter allowed to return null for a numeric reading, and it is the one
       that had to be: round 1 collapsed an unreadable balance to `0` in BOTH
       layers, so "the reading failed" and "the player is broke" were the same
       value. A bridge whose gems() threw therefore made rewards.payCost charge
       1,600 Cinder through spendGems and then report
       {ok:false, why:'Not enough Cinder.'} off the re-read — and the branch
       below toasted that and returned WITHOUT refunding. The money was gone,
       and the `before === null` fallback rewards.js is written around was
       unreachable code that read as defence-in-depth and provided none.
       rewards.js now takes each leg in its safe direction: an unreadable
       balance disables a PAID choice, never turns a real charge into a refusal,
       and never reports a landed credit as lost.
       ⚠ Math.floor, not `| 0` — `| 0` is a 32-bit truncation and a wallet past
       2,147,483,647 comes back negative.
       ⚠ bondOf() above keeps returning 0 for a missing row. That is a real
       answer, not a failed reading, and rewards.js does not treat it as one. */
    gems: () => {
      try {
        /* 🔴 THE NULL TEST COMES BEFORE Number(), AND THAT IS THE WHOLE BUG.
           Round 2 fixed the bridge to answer `null` for an unreadable balance
           and then left `Number(B.gems())` standing one layer up. `Number(null)`
           is 0 and `isFinite(0)` is true, so every unreadable balance arrived at
           rewards.js as "the player has zero Cinder": the fix never reached the
           consumer, and rewards.js's entire `before === null` family — the
           disabled paid choice, the charge that must not be re-read into a
           refusal, the credit that must not be reported as lost — stayed dead
           code for a THIRD round while the nineteen lines of comment above this
           accessor asserted the opposite. A comment that one coercion falsifies
           is a defect, not documentation.
           So: test for the sentinel FIRST, coerce second. `null` is not `0`.
           `0` means the player has zero Cinder and nothing else.
           `undefined` is folded in with it deliberately — a bridge older than
           the null convention returns nothing at all from a failed read, and
           "the accessor gave me no answer" is the same fact as "the accessor
           said it could not read". Both are unreadable; neither is broke. */
        const g = B.gems();
        if (g === null || g === undefined) return null;
        const n = Number(g);
        return isFinite(n) ? Math.floor(n) : null;
      } catch (e) { return null; }
    },
    /* ⚠ Returns TRUE for n <= 0 and, on insufficient funds, returns false and
       does NOTHING ELSE — no toast, no clamp, no render (spendGems,
       index.html:64561).
       rewards.canAfford() gates the button and this file toasts the refusal;
       an ungated button would simply do nothing when pressed. */
    spendGems: (n) => { try { return B.spendGems(n) === true; } catch (e) { return false; } },
    /* ⚠ NEVER with a negative amount. addGems guards on `amount === 0`, so a
       negative decrements Profile.gems locally while _serverMirrorCredit clamps
       to Math.max(0, …) and returns early — a durable client/server divergence.
       ⚠ `reason` is passed through and never defaulted. addGems falls back to
       the literal 'addGems', and that anonymous label is precisely why the
       Cinder supply could not be audited (index.html:64577-64584). */
    addGems: (n, reason) => { try { return B.addGems(n, reason) !== false; } catch (e) { return false; } },
    grantCard: (opts) => { try { const c = B.grantCard(opts); return (c && c.id) ? c : null; } catch (e) { return null; } },

    // ── Chrome ─────────────────────────────────────────────────────────────
    /* No `ms` is passed from this module, anywhere. The bridge owns the default
       so there is not a single timing literal in /src/dilemma outside the one
       tuning table, which is the rule data.js sets and this file keeps. */
    toast: (m) => { try { B.toast(m); } catch (e) {} },
    /* ⚠ `confirm` and `isAdmin` are CONTRACT-named surface with no consumer in
       /src/dilemma either, for the same reason as elementsOf above. Neither is
       removed: resplitting the seam to match today's call sites is how a bridge
       ends up being edited every time a module grows a line. But neither is
       dressed up as required, and a reader grepping for their callers should
       find this sentence before they find nothing.
       The wrappers still earn their keep the moment something does call them:
       gcConfirm() is async and a bridge that throws synchronously would
       otherwise reject rather than resolve false, and a bridge older than
       isAdmin() has no such key at all — hence the typeof, which is the only
       accessor in the adapter that needs one. */
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
   dilemma, nothing was spent and nothing moved, and the offer is still there.

   ⚠ "the offer is still there" IS A CLAIM ABOUT engine.openDilemma(), not about
   these two variables, and round 1 made it without earning it: the offer was
   re-seeded from the clock on every open, so closing and reopening the modal
   rerolled the dilemma AND its choice set, and a player could shop the corpus
   for the biggest payout before committing. The offer is now PINNED in the
   persisted blob for the length of the cooldown, which is what makes the
   sentence above true across a reload as well as across a close. */
let _instance = null;   // the Instance currently on screen, or null
let _busy = false;      // resolve re-entrancy lock; released in a finally

/* ════════════════════════════════════════════════════════════════════════════
   3. THE RESOLVE TRANSACTION
   ════════════════════════════════════════════════════════════════════════════
   CONTRACT §9.4, in order, and every failure lands on the player-favourable
   side. The order is the whole design, so it is written out rather than left
   to be inferred:

     1. payCost      — a refusal here means NOTHING has happened yet. Abort clean.
     2. commit       — state first, because it is the step that CAN fail, and it
                       is ATOMIC: engine.saveState() snapshots the blob, writes,
                       and puts the old one back if the save did not land. So
                       `commit() !== true` means Profile.dilemma is byte-for-byte
                       what it was — same influence, same seen, same recent, same
                       nextAt, same resolved, same pinned offer. A failure
                       refunds the cost and leaves bond untouched.
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
                       up to 800 ms on the slow path, index.html:70980-70984).
                       A failure here is REPORTED, not unwound: the state
                       committed and the rewards landed, only the bond ticks are
                       at risk, and taking a granted card back off a player to
                       tidy up a save is worse than a lost bond tick.
     6. markResolved + the aftermath view + host.render() for the tile badge.

   Nothing in here throws. The modal awaits this and paints whatever comes back;
   `null` means "aborted, already explained by a toast" and render.js keeps the
   player on the choice list so they can pick something else.

   🔴 THIS FUNCTION IS `async` AND CONTAINS NO `await`, AND THAT IS DELIBERATE
   IN BOTH DIRECTIONS. It is declared async so render.js can await it without
   caring whether the transaction ever grows an asynchronous step; it contains
   no await because the read-modify-write above must not yield. index.html has
   two other writers to Profile.dilemma — _dilemmaRecordDeck at battle start and
   cloudFetchProfile's hydration merge — and a yield between ensureState() and
   setState() would silently drop whichever of them landed in the gap.

   ⚠ THE CONSEQUENCE, AND DO NOT "FIX" IT HERE. Because nothing yields, the
   outcome view repaints inside one microtask, so the second click of an ordinary
   double-click lands on a panel that has already been replaced under a
   stationary cursor. This file's half of that holds and was measured at click
   gaps of 40, 90, 150 and 300 ms: the `_busy` lock plus `inst.resolved` means
   onChoose fires exactly once and the second click can never resolve anything.
   What the second click CAN still hit is the backdrop or the acknowledge
   button, which close the modal — so the player loses the receipt, not the
   reward. The gate for that belongs in render.paintOutcome(), which is the only
   layer that knows when the markup changed and where the cursor is. Adding an
   `await` here to buy time would trade a cosmetic loss for the state hole this
   whole transaction was rewritten to close. */
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
      /* 🔴 THE CINDER IS THE ONLY THING THAT NEEDS UNWINDING HERE, and that is a
         guarantee rather than an oversight. engine.saveState() restored the
         previous blob before commit() returned false, so no standing moved, no
         `seen` stamp was set, no `recent` slot was burned, no cooldown was armed
         and the offer is still pinned to the same dilemma. Bond has not been
         touched — step 3 runs after this — and the card grant has not run.
         ⚠ DO NOT ADD A STATE RESTORE HERE. A second unwind path is a second
         place for round 1's bug to come back, and the two would drift. The one
         atomic write is engine.saveState(); this branch trusts it. The words in
         the toast below are now true in both directions, which is the whole
         point: round 1 said "The Heights did not record your call" while the
         resolution was in fact recorded and about to be uploaded.

         It does NOT recover the 2% Foundation spend tax the _gemsTaxTick poll
         may already have billed on the original spend (_gemsTaxTick,
         index.html:56920). That asymmetry is accepted rather than reaching for
         _gemsTaxExempt, because putting a tax-suppression hole on the bridge to
         recover a few Cinder on a rare, already-reported path is the worse
         trade. It is stated here rather than hidden.

         🔴 THREE FORMS, NOT TWO, AND THE THIRD IS THE COMMON ONE.
         rewards.refundCost() correctly returns false when there is nothing to
         refund: `n <= 0` cannot be told apart from a failed addGems by the
         return value alone, so it takes the honest direction and claims
         nothing. It flagged the consequence and handed the copy across — "the
         copy is index.js's to soften if anyone wants it softened" — and nobody
         picked it up. The consequence is structural rather than incidental, so
         it is stated as a rule and not as a count this file would have to keep
         up to date: the great majority of choices in the corpus cost nothing,
         and EVERY refusal is free by validateCorpus's R3, which makes charging
         a player to walk away an authoring error. So "the refund could not be
         confirmed" was never the edge message — it was the one a player met
         every time they refused a dilemma and hit a save failure, told their
         money might be gone over a call that took none.

         The branch reads `choice.cost`, which is already in hand — no new
         import, and nothing changes on the rewards side.
         ⚠ AND refundCost() IS NO LONGER CALLED AT ALL FOR A FREE CHOICE. That
         is the second half of the fix rather than an optimisation: it was doing
         nothing but returning false into a sentence about money, and skipping
         it takes an addGems-adjacent call off the commonest failure path in the
         feature. */
      const paid = !!(choice && choice.cost && Number(choice.cost.cinder) > 0);
      const back = paid ? refundCost(h, choice) : false;
      h.toast(
        !paid  ? '⚠ The Heights did not record your call. Nothing was charged.'
        : back ? '⚠ The Heights did not record your call. Your Cinder came back.'
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

       The rng is derived from the instance seed and the choice id, so WHETHER a
       card drops and in WHICH RARITY BAND is reproducible from
       (dilemma.id, openedAt, choiceId) alone — that much of a bug report is
       actionable. ⚠ WHICH CARD IS NOT. The identity is picked by three
       unseeded `Math.random()` sites inside the bridge's grantCard
       (index.html:208035, 208041 — that one inside a six-iteration loop — and
       208043), over a pool that depends on the player's own Forge settings. So
       replaying the triple reproduces the land/band decision and a DIFFERENT
       card every run. Threading the rng through grantCard would make the
       stronger claim true; it was rejected as a bridge-surface change made to
       satisfy a comment. The claim is narrowed instead.
       It is deliberately not `makeRng(instance.seed)` reconstructed: that
       stream's first draws were already consumed by rollChoices() inside
       openDilemma, so re-creating it would tie the reward roll to the same
       number that picked the choice count. */
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
   state. Everything it needs to draw a stance, a preview delta, an effect line,
   a pole name or a disabled button arrives through these seven functions, and
   each one is already total on its own — render.js's callH() still supplies a
   typed fallback on top, which is belt and braces rather than duplication. */
function handlersFor(inst) {
  return {
    stance: (unit, choice) => stanceFor(unit, choice),
    preview: (unit, choice) => previewBond(unit, choice),
    /* 🏷 THE POLE LABEL, HANDED OVER RATHER THAN TRANSCRIBED. LQ_POLE_LABEL
       (index.html:73121) is the game's own vocabulary — '⚔ Honor', '🕊 Mercy'.
       render.js may not call the bridge, and copying eight labels and their
       emoji into the render layer would put the player-facing spelling of the
       value system in two places that can drift. So it comes through the seam,
       like every other fact render.js needs.
       Total by construction: a missing table, a missing pole, a bridge that
       throws — every path falls back to the capitalised pole id, which is what
       render.js printed before this existed. "Honor" is not as pretty as
       "⚔ Honor" and it can never be wrong. */
    poleLabel: (p) => {
      try {
        const s = String(p || '');
        const cap = s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
        const h = host();
        /* h.values() legitimately returns null — the tables are read through
           `typeof` guards on the bridge side, so an older index.html hands back
           null rather than throwing. Guard it; do not dereference it. */
        const v = (h && typeof h.values === 'function') ? h.values() : null;
        const t = (v && v.poleLabel && typeof v.poleLabel === 'object') ? v.poleLabel : null;
        const lbl = t ? t[s] : null;
        return (typeof lbl === 'string' && lbl) ? lbl : cap;
      } catch (e) { return String(p || ''); }
    },
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

  /* A COPY, always — the adapter's state() clones on the way out, so nothing
     reachable from here is the object Profile.dilemma actually holds. There is
     deliberately no matching public mutator: writes go through the resolve
     transaction or through _save() below, never by editing what this returns. */
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
      /* The recorder's own record, read through the accessor rather than out of
         the normalised blob — the one place the two can be compared. Wrapped
         because debug() must answer even when a half-built bridge cannot. */
      lastDeckRaw: (() => {
        try {
          const d = h ? h.lastDeck() : null;
          return d ? { id: d.id || null, cards: Array.isArray(d.cards) ? d.cards.length : 0, at: Number(d.at) || 0 } : null;
        } catch (e) { return null; }
      })(),
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
