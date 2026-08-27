/* ============================================================================
   🎖 INFLUENCE — the wiring. Registers `window.MythicInfluence`.
   ============================================================================
   WHAT THIS IS. A standing track for a player and their camp. Envoys arrive on
   their own; each one carries Cinder, a card, a survivor asking to join, or a
   resource convoy. What they carry — and how rare it is — follows three things
   the player already has: their node tier, their Influence level, and their
   Foundation Reserve reputation.

   WHAT LIVES WHERE
     model.js   — the numbers. Pure, testable, no browser.
     envoys.js  — who turns up and what resolving them does.
     render.js  — every pixel.
     this file  — bridge wiring, persistence, and the click handlers.

   🔴 THE GLOBALS TRAP (CLAUDE.md, and it has already cost real time twice).
   `Profile`, `Forge`, `FoundationReserve`, `addGems`, `addRes` are top-level
   `const`/function declarations in index.html. They are LEXICAL globals — an ES
   module cannot see them, and `window.Profile` is undefined however global
   `const Profile` looks. Everything arrives through
   `window.MythicInfluenceBridge`, handed over explicitly by index.html next to
   MythicBridge / MythicCityBridge / MythicTradeBridge. Nothing here reaches for
   a bare global, and if the bridge is missing the module registers, stays inert
   and warns once.

   🔴 AND IT MUST DEGRADE TO NOTHING. index.html reads this defensively: the
   camp status bar checks `window.MythicInfluence` before printing anything. If
   this file 404s the player loses the feature and nothing else.
   ============================================================================ */

import * as M from './model.js';
import * as E from './envoys.js';
import * as R from './render.js';

const B = () => { try { return (typeof window !== 'undefined' ? window.MythicInfluenceBridge : null) || null; } catch (e) { return null; } };

function warnOnce(msg) {
  if (warnOnce._done) return; warnOnce._done = true;
  try { console.warn('[influence] ' + msg); } catch (e) {}
}

/* ── Persistence ────────────────────────────────────────────────────────────
   Everything lives on `Profile.influence`, which rides the existing profile
   save + cloud sync like any other Profile field. No new table: this feature
   has no cross-player surface, so a table would be RLS surface area bought for
   nothing.

     { xp, lastAt, hosted, pending }

   ⚠ `pending` IS DELIBERATE AND IS THE ANTI-REROLL. The envoy is spent the
     moment it is rolled, and the roll is persisted, so closing the modal and
     reopening it resumes the SAME visitor rather than dealing a new hand. If
     the roll were held only in memory a player could close-and-reopen until a
     mythic turned up, and — the other way round — a player who closed the tab
     mid-encounter would have burned an envoy for nothing. */
function state() {
  const b = B();
  try {
    const s = b && typeof b.state === 'function' ? b.state() : null;
    if (!s) return { xp: 0, lastAt: 0, hosted: 0, pending: null };
    if (typeof s.xp !== 'number') s.xp = 0;
    if (typeof s.lastAt !== 'number') s.lastAt = 0;
    if (typeof s.hosted !== 'number') s.hosted = 0;
    return s;
  } catch (e) { return { xp: 0, lastAt: 0, hosted: 0, pending: null }; }
}
function save() { const b = B(); try { if (b && b.save) b.save(); } catch (e) {} }

/* ── Inputs ─────────────────────────────────────────────────────────────────
   Each one degrades to a defensible zero rather than throwing. A player who is
   offline, or signed out, or whose Reserve fetch has not landed yet, still gets
   a working (if humbler) envoy — never an exception in a click handler. */
function repPoints() { const b = B(); try { return Math.max(0, (b && b.repPoints ? b.repPoints() : 0) | 0); } catch (e) { return 0; } }
function repRank() {
  const b = B();
  try { return (b && b.repRank ? b.repRank() : null) || { name: 'Resource Runner', icon: '🎒', index: 0 }; }
  catch (e) { return { name: 'Resource Runner', icon: '🎒', index: 0 }; }
}
function nodeTier() {
  const b = B();
  try { return (b && b.nodeTier ? b.nodeTier() : null) || { id: 'free', name: 'Free', rate: 0.5, rankIndex: 0, rankCount: 7 }; }
  catch (e) { return { id: 'free', name: 'Free', rate: 0.5, rankIndex: 0, rankCount: 7 }; }
}

export function level() {
  return M.effectiveLevel(state().xp, repRank().index | 0);
}
export function standing() {
  const nt = nodeTier();
  return M.standing({
    nodeRankIndex: nt.rankIndex | 0, nodeRankCount: nt.rankCount | 0,
    level: level(), repPoints: repPoints(),
  });
}
export function ready() {
  const s = state();
  // A pending encounter is one already dealt; it is not a second envoy waiting.
  return M.envoysReady(s.lastAt, Date.now(), M.ENVOY_INTERVAL_MS, M.ENVOY_BANK_CAP);
}

/* The one-line summary the camp status bar prints. Kept here so index.html
   never has to know how a level or an envoy count is derived. */
export function status() {
  const s = state();
  const lv = level();
  return {
    level: lv,
    name: M.levelMeta(lv).name,
    icon: M.levelMeta(lv).icon,
    xp: s.xp | 0,
    waiting: (ready() | 0) + (s.pending ? 1 : 0),
    nextMs: M.msToNextEnvoy(s.lastAt, Date.now(), M.ENVOY_INTERVAL_MS),
    standing: standing(),
    hosted: s.hosted | 0,
  };
}

/* ── ctx: the shim envoys.js resolves against ───────────────────────────────
   Thin on purpose. A driven test can replace ONE of these and prove a payout
   (or a refusal) against the game's real balances rather than a mock ledger. */
function ctx() {
  const b = B();
  const nt = nodeTier();
  return {
    level: level(),
    standing: standing(),
    rng: Math.random,
    nodeTier: nt,
    cardPool: () => { try { return (b && b.cardPool ? b.cardPool() : []) || []; } catch (e) { return []; } },
    cardMarketValue: (c) => { try { return (b && b.cardMarketValue ? b.cardMarketValue(c) : 0) | 0; } catch (e) { return 0; } },
    ownedCount: (id) => { try { return (b && b.ownedCount ? b.ownedCount(id) : 0) | 0; } catch (e) { return 0; } },
    grantCard: (id) => { try { return !!(b && b.grantCard && b.grantCard(id)); } catch (e) { return false; } },
    // 🔥 Named faucet. Every Cinder source has to say where it came from or the
    //    supply cannot be audited later — see the comment on addGems().
    addCinder: (n2) => { try { return !!(b && b.addGems && b.addGems(n2 | 0, 'influence_envoy')); } catch (e) { return false; } },
    resources: () => { try { return (b && b.resources ? b.resources() : []) || []; } catch (e) { return []; } },
    addRes: (id, q) => { try { if (b && b.addRes) b.addRes(id, q | 0); } catch (e) {} },
    resourceHeadroom: () => {
      try { return (b && b.resourceHeadroom ? b.resourceHeadroom() : null) || { cap: 0, units: 0, free: Infinity }; }
      catch (e) { return { cap: 0, units: 0, free: Infinity }; }
    },
    save,
  };
}

/* Only what the modal draws and what a resolution needs. Storing the whole card
   would put a full custom card — art blobs and all — into the profile blob that
   uploads on every save. */
function compactCard(card) {
  if (!card) return null;
  return {
    id: card.id, name: card.name, type: card.type || 'unit',
    rarity: String(card.rarity || 'common').toLowerCase(),
    cost: card.cost | 0, icon: card.icon || card.emoji || '',
    stats: card.stats ? { hp: card.stats.hp | 0, atk: card.stats.atk | 0, def: card.stats.def | 0, spd: card.stats.spd | 0 } : null,
    text: card.text ? String(card.text).slice(0, 160) : '',
  };
}

/* ── Dealing ────────────────────────────────────────────────────────────────
   Spends one envoy and persists the result. Returns the encounter, or null when
   nobody is at the gate. */
function deal() {
  const s = state();
  if (ready() <= 0) return null;
  const enc = E.rollEncounter(ctx());
  if (enc && enc.card) enc.card = compactCard(enc.card);
  s.lastAt = M.consumeStamp(s.lastAt || Date.now(), Date.now(), M.ENVOY_INTERVAL_MS, M.ENVOY_BANK_CAP);
  s.pending = enc;
  save();
  return enc;
}

/* The resolution currently being SHOWN, and the visitor it belongs to.

   🔴 IT CARRIES THE ENCOUNTER, and that is not redundancy. `settle()` clears
   `pending` so a visitor can never be resolved twice — but the renderer draws
   the outcome IN THE ENVOY'S VOICE, so it still needs to know who was standing
   there. Without this the modal fell straight through to "No one is at the
   gate" the instant a button was pressed: the player never saw what they got,
   and the full-stash refusal line — the one piece of copy this feature was
   specified around — was unreachable. A driven test caught it.

   Never persisted: it is a message, and a message the player has already read
   should not survive a reload. */
let _result = null;

function view() {
  const s = state();
  const lv = level();
  const nt = nodeTier();
  const b = B();
  return {
    level: lv,
    levelMeta: M.levelMeta(lv),
    progress: M.levelProgress(s.xp, repRank().index | 0),
    standing: standing(),
    parts: M.standingParts({ nodeRankIndex: nt.rankIndex | 0, nodeRankCount: nt.rankCount | 0, level: lv, repPoints: repPoints() }),
    nodeTier: nt,
    repRank: repRank(),
    repPoints: repPoints(),
    ready: ready(),
    nextMs: M.msToNextEnvoy(s.lastAt, Date.now(), M.ENVOY_INTERVAL_MS),
    // A settled encounter stays on screen until the player moves on, so the
    // outcome is delivered by the person who brought it.
    enc: (_result && _result.enc) || s.pending || null,
    result: _result,
    rarityMeta: (id) => { try { return b && b.rarityMeta ? b.rarityMeta(id) : null; } catch (e) { return null; } },
    cardArt: (id) => { try { return b && b.cardArt ? b.cardArt(id) : null; } catch (e) { return null; } },
  };
}

function draw() { R.mount(view(), handlers); }

/* Bank the XP, drop the spent encounter, show what happened. One funnel, so no
   outcome can forget to clear `pending` and leave a visitor who can be resolved
   twice. */
function settle(res) {
  const s = state();
  const enc = s.pending;              // captured BEFORE clearing — see _result
  s.xp = Math.max(0, (s.xp | 0) + ((res && res.xp) | 0));
  s.hosted = (s.hosted | 0) + 1;
  s.pending = null;
  save();
  _result = res ? Object.assign({}, res, { enc: enc }) : null;
  const b = B();
  try { if (res && res.toast && b && b.toast) b.toast(res.toast, res.refused ? 6000 : 4200); } catch (e) {}
  // The camp status bar prints the level and the waiting count, so it has to be
  // repainted whether or not the player closes the modal.
  try { if (b && b.render) b.render(); } catch (e) {}
  draw();
}

const handlers = {
  onClose: () => { _result = null; R.unmount(); const b = B(); try { if (b && b.render) b.render(); } catch (e) {} },
  onNext: () => { _result = null; deal(); draw(); },
  onTake: () => {
    const enc = state().pending;
    if (!enc) return;
    if (enc.kind === 'cinder') return settle(E.resolveCinder(ctx(), enc));
    if (enc.kind === 'gift') return settle(E.resolveGift(ctx(), enc));
    if (enc.kind === 'supply') return settle(E.resolveSupply(ctx(), enc));
  },
  onAccept: () => { const enc = state().pending; if (enc) settle(E.acceptRecruit(ctx(), enc)); },
  onSell: () => { const enc = state().pending; if (enc) settle(E.sellRecruit(ctx(), enc)); },
  onDecline: () => { if (state().pending) settle(E.dismiss()); },
};

export function open() {
  if (!B()) { warnOnce('window.MythicInfluenceBridge is missing — index.html has not handed this module anything, so it stays inert.'); return false; }
  _result = null;
  const s = state();
  // 🕰 First open ever: stamp the clock so the ladder starts now rather than at
  //    the epoch, which would otherwise read as "cap reached" on a fresh camp.
  if (!s.lastAt) { s.lastAt = Date.now() - M.ENVOY_INTERVAL_MS; save(); }
  if (!s.pending) deal();
  R.injectStyles();
  draw();
  return true;
}

export function close() { handlers.onClose(); }

try {
  if (typeof window !== 'undefined') {
    window.MythicInfluence = {
      MODEL: M, ENVOYS: E,
      open, close, status, level, standing, ready,
      // Published so the CAMP STATUS bar renders the same ETA string the modal
      // does — index.html cannot import, and a second copy would drift.
      formatEta: M.formatEta,
      isOpen: R.isOpen,
      NO_SPACE_LINE: E.NO_SPACE_LINE,
    };
  }
} catch (e) {}
