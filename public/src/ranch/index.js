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
     MythicRanch.inherit(pa, pb, bondNew)  -> an heir's temperament/bond/memory
     MythicRanch.steward()                 -> speak one line, or stay quiet
     MythicRanch.labels(verdict)           -> button wording for the LQ dialog
     MythicRanch.convictionMul(entry,pole) -> 0.50 … 1.50, for _lqValuesEval
     MythicRanch.hasBanter(cardId)         -> is something queued to be judged
     MythicRanch.J                         -> the pure judgement model
   ══════════════════════════════════════════════════════════════════════════ */
import * as J from './judgement.js';
import * as T from './table.js';
import * as G from './gifts.js';
import * as L from './lineage.js';
import * as S from './steward.js';

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

/* 🎖 Build the roster the quartermaster reads, enriching each unit with the
   two ACTIONABLE facts he is allowed to raise — a request the player can fill
   right now, and a favourite sitting unused in the stores. Both are computed
   here rather than in the bridge because both are questions only /src/ranch
   knows how to ask (what a unit's favourite is, whether its gift cooldown has
   run), and steward.js must stay pure. */
function stewardRoster() {
  const b = B(); if (!b || !b.roster) return [];
  const pool = (b.giftPool && b.giftPool()) || [];
  return (b.roster() || []).map((u) => {
    const out = { id: u.id, name: u.name, prof: u.prof };
    try {
      const r = u.prof.request;
      if (r && r.item && b.ownCount(r.item) > 0) { out.hasRequested = true; out.requestName = b.itemName(r.item); }
    } catch (e) {}
    try {
      // Only a favourite the player has EARNED the right to know about — the
      // quartermaster naming it below Steady would leak what the Table
      // deliberately withholds (see gifts.js, FAVOURITE_KNOWN_TIER).
      const tierIdx = b.bondTierIndex(u.prof.bond || 0);
      if (G.favouriteKnown(tierIdx) && G.cooldownLeft(u.prof) <= 0) {
        const fav = G.favouriteOf(u.id, u.card, pool);
        if (fav && b.ownCount(fav) > 0) { out.giftReady = true; out.giftName = b.itemName(fav); }
      }
    } catch (e) {}
    return out;
  });
}

/* Speak, or stay quiet. Returns the remark it made, or null.
   Every failure path returns null rather than throwing: this runs on every
   camp arrival and a flavour line must never be able to take the screen down. */
function steward() {
  try {
    const b = B(); if (!b || !b.showToast) return null;
    const sel = S.pick(stewardRoster());
    if (!S.shouldSpeak(sel, b.stewardLast ? b.stewardLast() : null, Date.now())) return null;
    b.showToast(S.say(sel), 7000);
    if (b.setStewardLast) b.setStewardLast(sel);
    return sel;
  } catch (e) { console.warn('[ranch] steward', e); return null; }
}

export const api = {
  VERSION,
  open:  (id) => { try { return T.open(id); } catch (e) { console.warn('[ranch] open', e); return false; } },
  close: ()   => { try { T.close(); } catch (e) {} },
  judge: (id, choice) => { try { return T.judge(id, choice); } catch (e) { console.warn('[ranch] judge', e); return null; } },
  gift:  (id, itemId) => { try { return T.gift(id, itemId); } catch (e) { console.warn('[ranch] gift', e); return null; } },
  favouriteOf: (id, card, pool) => { try { return G.favouriteOf(id, card, pool); } catch (e) { return null; } },
  /* 🧬 Called by hatchCore. Returns null on any failure rather than throwing —
     a bred card must always hatch, with or without a legacy. */
  inherit: (pa, pb, bondNew) => { try { return L.inherit(pa, pb, bondNew); } catch (e) { console.warn('[ranch] inherit', e); return null; } },
  labels: (verdict) => { try { return J.labels(verdict); } catch (e) { return J.labels('approve'); } },
  convictionMul,
  convictionOf: (entry, pole) => { try { return J.convictionOf(entry, pole); } catch (e) { return 0; } },
  hasBanter,
  steward,
  stewardRoster,
  greeting: T.greeting,
  J, G, L, S,
};

try { window.MythicRanch = api; } catch (e) {}
/* 🧬 Hand index.html the heir memory kinds so every existing renderer (the
   Table, the card-detail modal) picks them up with no changes of its own.
   Fire-and-forget: without the bridge an inherited memory simply does not
   render, which is a missing line, not a broken screen. */
try {
  const b = window.MythicRanchBridge;
  if (b && typeof b.mergeMemoryKinds === 'function') b.mergeMemoryKinds(L.memoryKinds());
} catch (e) {}
export default api;
