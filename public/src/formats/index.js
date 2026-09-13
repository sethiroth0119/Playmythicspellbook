/* ════════════════════════════════════════════════════════════════════════════
   ⚖️ FORMATS + BANLIST — module entry. Registers window.MythicFormats.
   ----------------------------------------------------------------------------
   The rest of the game asks this module exactly one question, and it is the
   only one that matters:

       MythicFormats.copyLimit('unit:kalon_prime')   → 0 | 1 | 2 | 3

   index.html routes `_cardCopyLimit()` through it, so a ban reaches EVERY
   consumer at once — deck builder, deck validator, side deck, AI deck
   generation — instead of each growing its own copy of the rule. That single
   chokepoint is the whole reason this retrofits cleanly; it already existed
   (see `_cardCopyLimit` in index.html) and was already the one place copy
   limits were decided.

   🔴 NO ACTIVE FORMAT MEANS LEGACY RULES, NOT "EVERYTHING BANNED".
   `copyLimit` returns null when there is no format, and the caller then falls
   back to the card's own `restriction`. Returning 0 on a missing format would
   ban the entire game the first time Supabase hiccups. This is the failure mode
   to keep in mind for every line below.

   🔴 THE CLIENT IS NOT THE SECURITY BOUNDARY. RLS in sql/100 is. Everything
   here is an admin convenience and a player-facing courtesy.
   ════════════════════════════════════════════════════════════════════════════ */

import { UNLIMITED, TIERS, tierOf, limitFor, banlistView } from './formats.data.js';
import * as api from './formats.api.js';
import { openAdmin, openPlayer } from './formats.ui.js';

function bridge() { try { return window.MythicFormatsBridge || null; } catch (e) { return null; } }

/* THE question. Returns null — meaning "I have no opinion, use the card's own
   restriction" — whenever there is no active format. See the header. */
function copyLimit(cardKey) {
  try {
    const f = api.activeFormat();
    if (!f) return null;
    return limitFor(f, cardKey);
  } catch (e) { return null; }
}

function isBanned(cardKey) {
  const n = copyLimit(cardKey);
  return n === 0;
}

/* Warm the cache. index.html calls this once at boot and again whenever the
   deck builder opens, so a freshly published banlist is in hand before the
   player starts building against it. */
async function init() {
  try { await api.refresh(); } catch (e) {}
  return api.activeFormat();
}

try {
  window.MythicFormats = {
    copyLimit,
    isBanned,
    active: () => api.activeFormat(),
    bestOf: () => { const f = api.activeFormat(); return f ? f.bestOf : null; },
    sideMax: () => { const f = api.activeFormat(); return f ? f.sideMax : null; },
    banlist: (nameOf) => banlistView(api.activeFormat(), nameOf),
    tableMissing: () => api.tableMissing(),
    refresh: (force) => api.refresh(force),
    init,
    openAdmin, openPlayer,
    TIERS, tierOf, UNLIMITED,
    available: () => !!bridge(),
    VERSION: 'formats-1.0.0',
  };
  // Warm it immediately — but never block boot on a network call.
  try { init(); } catch (e) {}
  try { console.info('%c⚖️ MythicFormats%c ready.', 'color:#f6dc95;font-weight:700', 'color:inherit'); } catch (e) {}
} catch (e) {}
