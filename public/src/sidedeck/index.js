/* ════════════════════════════════════════════════════════════════════════════
   🔀 SIDE DECK + BEST-OF-3 — module entry. Registers window.MythicSideDeck.
   ----------------------------------------------------------------------------
   index.html contributes `window.MythicSideDeckBridge` and calls:

       MythicSideDeck.startMatch(deck)              → match
       MythicSideDeck.reportGame(match, 'player')   → match   (after each game)
       await MythicSideDeck.side(match, { seen })   → { deck, firstPlayer } | null
       MythicSideDeck.validate(deck)                → [errorString…]

   The deck builder calls `MythicSideDeck.editorModel(deck)` to render its Side
   tab, and `MythicSideDeck.move(deck, key, dir)` on each click.

   🔴 THE COPY LIMIT COMES FROM THE FORMAT, NOT FROM HERE. `copyLimit` below
   asks /src/formats first (which knows the active banlist) and falls back to
   the legacy `_cardCopyLimit` the bridge exposes. Hardcoding 3 here would mean
   a banned card is still legal in a side deck, which is precisely the hole a
   banlist exists to close.

   ⚠ Everything is wrapped; without the bridge this registers inert and the
   game plays single games exactly as it did before.
   ════════════════════════════════════════════════════════════════════════════ */

import { SIDE_MAX, copiesOf, sideOf, inventory, legalityErrors, swapErrors, move } from './sideboard.js';
import { newMatch, recordGame, chooseFirst, commitSiding, scoreLine, isMatchPoint, BEST_OF } from './match.js';
import { openSiding } from './sidedeck.ui.js';

function bridge() { try { return window.MythicSideDeckBridge || null; } catch (e) { return null; } }

let _warned = false;
function ready() {
  if (bridge()) return true;
  if (!_warned) { _warned = true; try { console.warn('[sidedeck] window.MythicSideDeckBridge absent — side decks and best-of-3 disabled.'); } catch (e) {} }
  return false;
}

/* The environment the rules run against. Rebuilt per call, never cached: the
   active format can change under us (an admin publishes a banlist mid-session)
   and a cached copyLimit would keep enforcing yesterday's list. */
function env() {
  const b = bridge() || {};
  return {
    deckSize: (typeof b.deckSize === 'function') ? b.deckSize() : 40,
    nameOf: (k) => { try { return b.nameOf ? b.nameOf(k) : String(k); } catch (e) { return String(k); } },
    copyLimit: (k) => {
      // 1️⃣ The active format's banlist has the final word.
      try {
        const F = window.MythicFormats;
        if (F && F.active && F.active()) {
          const lim = F.copyLimit(k);
          if (typeof lim === 'number') return lim;
        }
      } catch (e) {}
      // 2️⃣ Otherwise the card's own `restriction`, via the legacy helper.
      try { if (b.copyLimit) return b.copyLimit(k); } catch (e) {}
      return 3;
    },
  };
}

function validate(deck) {
  try { return legalityErrors(deck, env()); } catch (e) { return []; }
}

/* Data for the deck builder's Side tab — everything it needs to draw, with no
   rules logic left on the UI side. */
function editorModel(deck) {
  const e = env();
  const inv = inventory(deck || { cards: [] });
  return {
    max: SIDE_MAX,
    sideCount: sideOf(deck).length,
    mainCount: ((deck && deck.cards) || []).length,
    deckSize: e.deckSize,
    errors: validate(deck),
    rows: inv.map(r => ({
      key: r.key,
      name: e.nameOf(r.key),
      main: r.main,
      side: r.side,
      total: r.main + r.side,
      limit: e.copyLimit(r.key),
      over: (r.main + r.side) > e.copyLimit(r.key),
    })),
  };
}

async function side(match, opts) {
  if (!ready() || !match || !match.sidingOpen) return null;
  try {
    const res = await openSiding({
      deck: match.deckNow,
      ref: match.deckAtStart,
      match,
      env: env(),
      seen: (opts && opts.seen) || [],
    });
    if (!res) { match.sidingOpen = false; return null; }   // skipped — keep the deck as-is
    commitSiding(match, res.deck);
    chooseFirst(match, res.firstPlayer);
    try { bridge().toast && bridge().toast('🔀 Deck sided — ' + scoreLine(match), 3600); } catch (e) {}
    return res;
  } catch (e) {
    try { console.warn('[sidedeck] siding failed — continuing with the current deck', e); } catch (e2) {}
    match.sidingOpen = false;
    return null;
  }
}

try {
  window.MythicSideDeck = {
    // match lifecycle
    startMatch: (deck, opts) => newMatch(deck, opts),
    reportGame: (match, winner, meta) => recordGame(match, winner, meta),
    side,
    scoreLine, isMatchPoint,
    // deck-builder surface
    editorModel, validate, move, copiesOf, sideOf, inventory,
    SIDE_MAX, BEST_OF,
    available: () => ready(),
    VERSION: 'sidedeck-1.0.0',
  };
  try { console.info('%c🔀 MythicSideDeck%c ready — best-of-%d with a %d-card side deck.', 'color:#7fb0ff;font-weight:700', 'color:inherit', BEST_OF, SIDE_MAX); } catch (e) {}
} catch (e) {}
