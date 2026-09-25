/* ═══════════════════════════════════════════════════════════════════════════
   🍔 kitchen.bridge.js — THE SEAM between /src/kitchen and the legacy app.
   ═══════════════════════════════════════════════════════════════════════════

   🔴 WHY THIS FILE EXISTS AT ALL.
   index.html declares `Profile`, `Cloud`, `App`, `Corp`, `Forge`, `RESOURCES`,
   `getRes`, `addRes`, `spendResources`, `showToast`, `gcConfirm`, `render` and
   `saveProfile` as top-level `const`/`function` declarations. Those are global
   LEXICAL bindings — they are NOT properties of `window`, so an ES module
   genuinely cannot see them. `window.Profile` is `undefined` even though
   `const Profile` is right there on line 39272. This has cost this codebase
   real time three separate times (FoundationReserve and Profile in the Node
   City bridge, then again in Trading).

   So index.html hands this feature exactly what it needs, once, as
   `window.MythicKitchenBridge`. NOTHING in /src/kitchen reads a bare global,
   and there is no second path. If a module needs something new from the legacy
   app, it is ADDED TO THE BRIDGE — here, and in the index.html block that
   builds it. Do not reach around this file.

   ⚠ WHAT THIS FILE ADDS OVER community.bridge.js, and why.
   The community bridge is a plain `real || NULL_BRIDGE` picker. This one also
   PATCHES: whatever index.html publishes is wrapped so that (a) every key in
   §7 of CONTRACT.md exists and is callable, (b) a reader that throws inside the
   legacy app degrades to a zero instead of killing the RAF loop, and (c) a
   MUTATOR that returns `undefined` gets named in the console once.

   That third one is not fussiness. CONTRACT §7 / rule 3: every bridge mutator
   returns a boolean, and `buySupply()` decides whether to REFUND from those
   return values (`/src/trading/settle.js` discipline). A wrapper that returns
   `undefined` on success makes the rollback fire on a leg that worked — the
   player is refunded for something they actually received. We deliberately do
   NOT coerce `undefined` to `true` or to `false` here: both coercions turn one
   visible bug into a different invisible one (coerce→false refunds a real
   spend; coerce→true swallows a real failure). We pass it through unchanged so
   the existing `=== true` / `!== false` call sites behave exactly as the author
   of index.html wrote them, and we shout about it so it gets fixed.

   ⚠ NEVER CACHE `bridge()` IN A MODULE-LEVEL CONST. Resolve it per call. The
   real bridge can be published, replaced, or repaired after this module is
   imported (module scripts are deferred, and a hot-reloading dev session
   rebuilds the bridge object). A cached seam is a seam that silently points at
   a dead object for the rest of the session.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ───────────────────────────────────────────────────────────────────────────
   THE DEMO STORE.
   ───────────────────────────────────────────────────────────────────────────
   NULL_BRIDGE's save target. Module-scoped, never written to disk, gone on
   reload. See the comment on `setKitchenState` below for why it returns TRUE.  */
let _mem = {};

/* ═══════════════════════════════════════════════════════════════════════════
   NULL_BRIDGE — the bridge-shaped object that does nothing.
   ═══════════════════════════════════════════════════════════════════════════
   It mirrors EVERY key in CONTRACT §7 with a zero / false / no-op, so the whole
   feature can be imported, opened, cooked in and served against no game at all.
   That is rung 1 of the degradation ladder (§9) and it is how the sim is tested
   headlessly — hence the export, so a test can inject it.

   The shape of the fallbacks is chosen so that the kitchen is PLAYABLE but
   POWERLESS: readers answer zero, so nothing can be afforded and the restock
   screen refuses with "not enough"; mutators answer false, so no value is ever
   invented. Nothing throws, nothing is granted.
   ═══════════════════════════════════════════════════════════════════════════ */
export const NULL_BRIDGE = {
  // ── READERS ──────────────────────────────────────────────────────────────
  /** The 14 live RESOURCES rows. [] with no game — kitchen.state.js keeps a
      literal id list as its last-ditch fallback precisely for this case. */
  resources: () => [],
  /** `_meta(id)` in the legacy app. NEVER null — every call site renders it
      straight into an icon + label, so a null here is a blank bin on screen. */
  meta: (id) => ({ id: String(id == null ? '' : id), name: String(id == null ? '' : id), icon: '📦', color: '#8ea0b5' }),
  getRes: () => 0,
  /* 🔴 0 / 0 is not a placeholder, it is the truth: with no game attached there
     is no stash, so there is no room in it. A convoy claim that checks headroom
     therefore refuses rather than pretending it landed 40 food somewhere. */
  resourceCap: () => 0,
  resourceUnits: () => 0,
  gems: () => 0,
  signedIn: () => false,
  userId: () => null,
  displayName: () => 'Survivor',
  /** ⚠ A PROPERTY, not a function (kitchen.api.js reads `bridge().cloud`
      directly). The patch layer re-exposes the real one as a live getter so it
      cannot go stale between a signed-out load and a later sign-in. */
  cloud: null,
  myCorp: () => null,
  cityProd: () => ({}),
  isAdmin: () => false,

  // ── MUTATORS — every one returns a boolean (CONTRACT rule 3) ─────────────
  spendRes: () => false,
  /* 🔴 addRes is CAPPED in the legacy app: when the vault is full it returns
     without adding. Correct for loot, catastrophic for a refund — it once
     destroyed 215 units of a real player's resources. Undoing a deduction this
     call stack just made → refundRes. Creating units → addRes, then RE-READ
     getRes() and treat a short landing as a failed leg. */
  addRes: () => false,
  refundRes: () => false,
  spendGems: () => false,
  addGems: () => false,

  // ── PERSISTENCE ──────────────────────────────────────────────────────────
  /* 🔴 WHY THESE TWO RETURN TRUE WHEN EVERY OTHER MUTATOR RETURNS FALSE.
     CONTRACT §5 says a `false` from setKitchenState/save is a REAL failure that
     must be surfaced with a toast and never swallowed. kitchen.state.js honours
     that: it sets K.error and emits `error`, which the renderer turns into a
     toast. If the null seam answered `false`, the headless/demo rung would fire
     a "could not save your kitchen" toast every five seconds forever, teaching
     the player to ignore the one message that matters when it is real.

     So the null seam keeps a module-scoped object instead and answers honestly
     for what it is: the write DID happen, into memory, and it survives a
     close/open of the panel within this page load. It does not survive a
     reload, which is exactly what "playable but unsaved demo" means. Anything
     that needs to know the difference asks bridgeReady() / `_null`. */
  kitchenState: () => _mem,
  setKitchenState: (obj) => { _mem = (obj && typeof obj === 'object') ? obj : {}; return true; },
  save: () => true,

  // ── UI ───────────────────────────────────────────────────────────────────
  toast: (m) => { try { console.log('[kitchen]', m); } catch (e) {} },
  /* ⚠ TRUE, and this is the one fallback that is NOT the conservative answer.
     With no bridge there is no player to ask and — crucially — nothing that can
     be lost: every spend mutator above returns false, so an auto-confirmed
     action cannot destroy value. Answering `false` instead would make rung 1
     unplayable, because "end the shift" and "launch a convoy" both sit behind a
     confirm and would simply never happen in a headless run.
     🔴 A REAL bridge that is merely MISSING `confirm` does NOT get this — see
     SAFE_FILL below. Auto-yes on a live game with real Cinder is a different
     thing entirely. */
  confirm: async () => true,
  /** legacy render(), for the HUD chips that live outside our overlay. */
  render: () => {},

  _null: true,
};

/* ⚠ FILL-INS USED ONLY WHEN A **REAL** BRIDGE IS MISSING A KEY.
   Identical to NULL_BRIDGE except where "there is no game" and "there is a game
   but index.html forgot a line" want different answers. Today that is exactly
   one key, and it is the destructive one. */
const SAFE_FILL = {
  /* A live game with real Cinder must never auto-confirm. Ask the browser if we
     can (ugly, blocking, but truthful), otherwise refuse. */
  confirm: async (msg) => {
    try {
      if (typeof window !== 'undefined' && typeof window.confirm === 'function') return !!window.confirm(String(msg || 'Are you sure?'));
    } catch (e) {}
    return false;
  },
};

/** The keys whose return value the unwind logic in §8.1 actually branches on.
    These — and only these — are checked for an `undefined` return. `toast` and
    `render` are void by design and are not in this set. */
const MUTATORS = ['spendRes', 'addRes', 'refundRes', 'spendGems', 'addGems', 'setKitchenState', 'save'];

/* ═══════════════════════════════════════════════════════════════════════════
   RESOLUTION
   ═══════════════════════════════════════════════════════════════════════════ */

let _rawSeen = null;      // identity of the last raw bridge we patched
let _patched = null;      // the patched wrapper for _rawSeen
let _reason = 'window.MythicKitchenBridge has not been published yet.';
const _warned = Object.create(null);

function warnOnce(key, line) {
  if (_warned[key]) return;
  _warned[key] = true;
  try { console.warn('[kitchen/bridge] ' + line); } catch (e) {}
}

/**
 * Wrap one real bridge method so that a throw inside the legacy app cannot
 * escape into the RAF loop. A thrown error mid-tick kills the loop and freezes
 * the kitchen mid-rush with no way back except a page reload — which is a much
 * worse outcome than one reader answering zero for a frame.
 *
 * The fallback is produced by calling NULL_BRIDGE's own version, so the zero
 * for every key is written down in exactly one place and cannot drift.
 */
function guard(raw, key) {
  const isMutator = MUTATORS.indexOf(key) !== -1;
  return function (/* ...args */) {
    try {
      const out = raw[key].apply(raw, arguments);
      if (isMutator && typeof out === 'undefined') {
        warnOnce('undef:' + key, 'MythicKitchenBridge.' + key + '() returned undefined. '
          + 'CONTRACT §7: every mutator must return a boolean — true means IT HAPPENED. '
          + 'Returning undefined makes the all-or-nothing unwind fire on a leg that worked. '
          + 'Fix it in index.html; this seam deliberately does not guess.');
      }
      return out;
    } catch (e) {
      warnOnce('throw:' + key, 'MythicKitchenBridge.' + key + '() threw — degrading to the null value. ' + e);
      try { return NULL_BRIDGE[key].apply(NULL_BRIDGE, arguments); } catch (e2) { return isMutator ? false : null; }
    }
  };
}

/**
 * Build the wrapper for a real bridge: every §7 key guaranteed present and
 * callable, every extra key the real bridge carries passed through, and `cloud`
 * exposed as a LIVE getter.
 *
 * ⚠ `cloud` must be a getter and not a copied value. Copying it once freezes
 * whatever `Cloud` was at patch time — which, on a page that loads signed out
 * and signs in thirty seconds later, is `null` forever, and kitchen.api.js then
 * reports "offline" for the rest of the session with nothing in the console.
 */
function patch(raw) {
  const out = {};
  for (const key of Object.keys(NULL_BRIDGE)) {
    if (key === 'cloud' || key === '_null') continue;
    if (typeof raw[key] === 'function') { out[key] = guard(raw, key); continue; }
    warnOnce('missing:' + key, 'MythicKitchenBridge is missing ' + key + '() — CONTRACT §7 lists it. '
      + 'Falling back to the null value; add it to the bridge block in index.html.');
    out[key] = (Object.prototype.hasOwnProperty.call(SAFE_FILL, key) ? SAFE_FILL : NULL_BRIDGE)[key];
  }
  // Anything the bridge grew that this file has not caught up with yet still
  // works — a builder adding a key to index.html should not have to edit two
  // files before their own module can call it.
  for (const key of Object.keys(raw)) {
    if (key === 'cloud' || Object.prototype.hasOwnProperty.call(out, key)) continue;
    out[key] = (typeof raw[key] === 'function') ? guard(raw, key) : raw[key];
  }
  try {
    Object.defineProperty(out, 'cloud', { get() { try { return raw.cloud || null; } catch (e) { return null; } }, enumerable: true });
  } catch (e) { out.cloud = null; }
  out._null = false;
  out._raw = raw;
  return out;
}

/**
 * THE accessor. Returns the patched real bridge, or NULL_BRIDGE — **never
 * null**, never a throw. Call it per use; do not hold the result.
 */
export function bridge() {
  try {
    const raw = (typeof window !== 'undefined') ? window.MythicKitchenBridge : null;
    if (!raw || typeof raw !== 'object') {
      _reason = 'window.MythicKitchenBridge is not published — index.html has no kitchen bridge block, or this module loaded before it ran.';
      return NULL_BRIDGE;
    }
    // The liveness probe. `signedIn` is the cheapest key that every real bridge
    // in this app has (MythicBridge, MythicTradeBridge, MythicCityBridge all
    // carry it), so an object without it is not a bridge, it is a half-built
    // literal or somebody else's global that happens to share the name.
    if (typeof raw.signedIn !== 'function') {
      _reason = 'window.MythicKitchenBridge exists but has no signedIn() — it is not a finished bridge.';
      return NULL_BRIDGE;
    }
    if (raw !== _rawSeen || !_patched) { _rawSeen = raw; _patched = patch(raw); }
    _reason = '';
    return _patched;
  } catch (e) {
    _reason = 'reading window.MythicKitchenBridge threw: ' + e;
    return NULL_BRIDGE;
  }
}

/** True when the real seam is present. `!bridge()._null`, per CONTRACT §1. */
export function bridgeReady() { return !bridge()._null; }

/**
 * One line saying why the seam is not ready — for the debug panel and the
 * console. Empty string when everything is fine, so it can be printed as-is.
 * ⚠ Calls bridge() first: the reason is computed during resolution, so reading
 * the cached string without resolving would report the previous page state.
 */
export function bridgeReason() { return bridgeReady() ? '' : (_reason || 'unknown'); }

/* ═══════════════════════════════════════════════════════════════════════════
   SHARED FORMATTERS
   ═══════════════════════════════════════════════════════════════════════════
   They live in the seam file — not because they are seam-shaped, but because
   every render path needs them and this is the one module in the feature that
   is guaranteed to be importable before anything else exists. They must never
   be the reason a module fails to load, so none of them can throw.
   🔴 NOT ONE OF THESE IS AN ECONOMY NUMBER. Formatting cannot change an
   outcome. Anything that could belongs in ECON in kitchen.data.js.
   ═══════════════════════════════════════════════════════════════════════════ */

/** HTML escape. Every string that reaches innerHTML goes through this — dish
    names are data today and a player-named kitchen tomorrow. */
export function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 1.2k / 3.4M. Thresholds match community.bridge.js on purpose: a Cinder
    count must read the same in the kitchen HUD as it does everywhere else. */
export function fmtNum(n) {
  const v = Number(n) || 0;
  return v >= 1000000 ? (v / 1000000).toFixed(1) + 'M'
       : v >= 10000 ? (v / 1000).toFixed(1) + 'k'
       : Math.round(v).toLocaleString();
}

/** "◈ 12,400". Cinder is Profile.gems and is the ONLY money in this feature —
    there is no separate restaurant cash, by design (CONTRACT §8.3).

    ⚠ NOT `fmtNum()`, and the difference is deliberate. fmtNum abbreviates at
    10k, so a balance of 12,400 would read "◈ 12.4k" — and a player watching a
    payout land needs to see the digits move. Money is the one number in this
    HUD that is read for its exact value. Past a million the chip would not fit
    on a 360px phone, so that far out the abbreviation wins over the digits. */
export function fmtCinder(n) {
  const v = Math.round(Number(n) || 0);
  return '◈ ' + (Math.abs(v) < 1000000 ? v.toLocaleString() : fmtNum(v));
}

/** "01:18 PM" from an hour float — REF-A's clock chip. Wraps past midnight so
    a day curve that overruns CLOSE_HOUR still prints a real time. */
export function fmtClock(hourFloat) {
  const raw = Number(hourFloat);
  const f = isFinite(raw) ? ((raw % 24) + 24) % 24 : 0;
  /* 🔴 CONVERT TO WHOLE MINUTES FIRST, WITH AN EPSILON. The obvious
     `Math.floor((f - Math.floor(f)) * 60)` is off by one minute for most
     inputs: 13.3 is stored as 13.299999999999999, the subtraction yields
     0.2999999999999998, and 13:18 renders as "01:17 PM". The clock chip is on
     screen every single frame, so a one-minute lie is permanent and looks like
     a stuck clock rather than a rounding bug. */
  const total = Math.floor(f * 60 + 1e-6);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  const ap = h >= 12 ? 'PM' : 'AM';
  let hh = h % 12; if (hh === 0) hh = 12;
  return (hh < 10 ? '0' : '') + hh + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
}

/** "1:04" countdown. Clamped at zero — a negative countdown on a ticket board
    reads as a rendering bug, not as "you are late", and the board already says
    late in red. */
export function fmtMs(ms) {
  const v = Math.max(0, Number(ms) || 0);
  const s = Math.floor(v / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
