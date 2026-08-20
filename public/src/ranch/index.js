/* ══════════════════════════════════════════════════════════════════════════
   🏕 THE RANCH — the seam.                        ranch / piece: registration
   ──────────────────────────────────────────────────────────────────────────
   Registers `window.MythicRanch`. Everything above it (judgement.js) is pure;
   this file and table.js are the only ones that touch the outside world, and
   even here the outside world is reached through exactly ONE object —
   `window.MythicRanchBridge`, which index.html builds by hand next to
   MythicHouseBridge.

   🔴 THE GLOBALS TRAP (CLAUDE.md), for the fourth time. `Profile`, `App`,
   `adjustBond`, `getBondTier`, `resolveDeckCard` are top-level `const` /
   `function` declarations in index.html — global LEXICAL bindings, NOT
   properties of `window`. This module reaches nothing by name. If the bridge
   is absent every entry point below no-ops and the game behaves exactly as it
   did before this file existed.

   PUBLIC SURFACE (what index.html calls)
     MythicRanch.open(cardId)              -> open the table on one companion
     MythicRanch.close()
     MythicRanch.judge(cardId, choice)     -> apply praise / silence / scold
     MythicRanch.gift(cardId, itemId)      -> hand them something, unprompted
     MythicRanch.favouriteOf(id,card,pool) -> the item this card likes best
     MythicRanch.labels(verdict)           -> button wording for the LQ dialog
     MythicRanch.convictionMul(entry,pole) -> 0.50 … 1.50, for _lqValuesEval
     MythicRanch.hasBanter(cardId)         -> is something queued to be judged
     MythicRanch.J                         -> the pure judgement model
   ══════════════════════════════════════════════════════════════════════════ */
import * as J from './judgement.js';
import * as T from './table.js';
import * as G from './gifts.js';

export const VERSION = 'ranch-1.0.0';

function B() { try { return window.MythicRanchBridge || null; } catch (e) { return null; } }

/* The ONE thing index.html's battle-reaction loop calls (see _lqValuesEval).
   It is wrapped to fail CLOSED at 1 — a throw in here must never change how a
   battle scores, so any error means "no conviction modifier", which is the
   pre-feature behaviour exactly. */
function convictionMul(entry, pole) {
  try { return J.convictionMul(entry, pole); } catch (e) { return 1; }
}

function hasBanter(cardId) {
  try {
    const b = B(); if (!b) return false;
    const p = b.unitProf(cardId);
    return !!(p && p._banter);
  } catch (e) { return false; }
}

export const api = {
  VERSION,
  open:  (id) => { try { return T.open(id); } catch (e) { console.warn('[ranch] open', e); return false; } },
  close: ()   => { try { T.close(); } catch (e) {} },
  judge: (id, choice) => { try { return T.judge(id, choice); } catch (e) { console.warn('[ranch] judge', e); return null; } },
  gift:  (id, itemId) => { try { return T.gift(id, itemId); } catch (e) { console.warn('[ranch] gift', e); return null; } },
  favouriteOf: (id, card, pool) => { try { return G.favouriteOf(id, card, pool); } catch (e) { return null; } },
  labels: (verdict) => { try { return J.labels(verdict); } catch (e) { return J.labels('approve'); } },
  convictionMul,
  convictionOf: (entry, pole) => { try { return J.convictionOf(entry, pole); } catch (e) { return 0; } },
  hasBanter,
  greeting: T.greeting,
  J, G,
};

try { window.MythicRanch = api; } catch (e) {}
export default api;
