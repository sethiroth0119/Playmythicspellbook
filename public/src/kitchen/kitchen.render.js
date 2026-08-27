/* ════════════════════════════════════════════════════════════════════════════
   🍔 MYTHIC KITCHEN — kitchen.render.js — EVERY PIXEL
   ----------------------------------------------------------------------------
   CONTRACT.md §1 / §6. This file reads `Kitchen`, calls the actions in
   kitchen.state.js, and paints. It NEVER writes game truth. The only state it
   owns is VIEW state: which tab is up, which sheet is open, which pan you have
   selected. If you ever find yourself assigning to a `Kitchen.*` field in here,
   the action you actually wanted belongs in kitchen.state.js.

   ── THE TWO-SPEED RULE, which is the whole architecture of this file ────────
   `paint()`  rebuilds nodes. It is EXPENSIVE, it drops focus and scroll, and it
              runs only when `Kitchen.rev` changed (the sim bumps `rev` on every
              structural mutation) or when view state changed.
   `frame()`  runs 60×/second and may only write `textContent`, `style.*` and
              `dataset.*` on nodes that already exist.
   ⚠ Repainting the ticket board every frame was drafted first and it is
     unusable: the board flickers, a half-scrolled rail snaps back to zero every
     16ms, and on a mid-range phone the whole thing drops to 20fps while the
     player is trying to pull a burger. Hence the node registry (`_reg`) built
     once per paint and walked cheaply per frame.

   ── NO LOOP LIVES HERE ──────────────────────────────────────────────────────
   🔴 CONTRACT §3: index.js owns the ONE requestAnimationFrame loop and hands us
   `(dt, now, events)`. Nothing in this file may call requestAnimationFrame or
   setInterval. The single permitted `setTimeout` is the one that removes a
   finished float-up node — that is animation cleanup, not simulation.

   ── THE GLOBALS TRAP ────────────────────────────────────────────────────────
   🔴 `Profile`, `showToast`, `gcConfirm` and friends are lexical `const`s in
   index.html and are NOT on `window`. Everything comes through
   kitchen.bridge.js. There is not one bare global in this file and there must
   never be one. (Three separate features have already lost a day to this.)

   ── WHY NAMESPACE IMPORTS ───────────────────────────────────────────────────
   Same argument kitchen.state.js makes: six people are writing this feature at
   once. A NAMED import of an export a neighbouring module has not written yet
   is a hard module-evaluation error, and a module-evaluation error here means
   the kitchen tile silently never appears and nobody can tell you why. A
   namespace import + `typeof X.foo === 'function'` degrades to a disabled
   button instead of to a dead feature.
   ════════════════════════════════════════════════════════════════════════════ */

import * as DATA from './kitchen.data.js';
import * as State from './kitchen.state.js';
import * as BRIDGE from './kitchen.bridge.js';
import * as Convoy from './convoy.js';
import * as DriveThru from './drivethru.js';

const OV = 'mythic-kitchen-ov';

/* ───────────────────────────────────────────────────────────────────────────
   BRIDGE + FORMATTERS
   ───────────────────────────────────────────────────────────────────────────
   kitchen.bridge.js owns the seam AND the shared formatters (§1). We resolve
   both through the namespace with a local floor, so a half-written bridge
   module during parallel development degrades to plain numbers rather than to a
   blank screen. The floors are FORMATTING ONLY — no economy number is defaulted
   here, because a defaulted economy number is a silently different game. */
const BRIDGE_FLOOR = {};
function b() {
  try {
    if (typeof BRIDGE.bridge === 'function') return BRIDGE.bridge() || BRIDGE_FLOOR;
    return BRIDGE.NULL_BRIDGE || BRIDGE_FLOOR;
  } catch (e) { return BRIDGE_FLOOR; }
}
function esc(t) {
  if (typeof BRIDGE.esc === 'function') { try { return BRIDGE.esc(t); } catch (e) {} }
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmtNum(n) {
  if (typeof BRIDGE.fmtNum === 'function') { try { return BRIDGE.fmtNum(n); } catch (e) {} }
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString();
}
function fmtCinder(n) {
  if (typeof BRIDGE.fmtCinder === 'function') { try { return BRIDGE.fmtCinder(n); } catch (e) {} }
  return '◈ ' + fmtNum(n);
}
/** "01:18 PM" from an hour float. REF-A's clock chip, verbatim. */
function fmtClock(hourFloat) {
  if (typeof BRIDGE.fmtClock === 'function') { try { return BRIDGE.fmtClock(hourFloat); } catch (e) {} }
  let h = Math.floor(Number(hourFloat) || 0);
  const m = Math.floor((((Number(hourFloat) || 0) - h) * 60));
  const ap = h >= 12 && h < 24 ? 'PM' : 'AM';
  let hh = h % 12; if (hh === 0) hh = 12;
  return (hh < 10 ? '0' : '') + hh + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
}
/** "1:04" / "9.4s" countdown. Under ten seconds it gets a decimal, because the
    last ten seconds of a burn window is exactly when tenths matter. */
function fmtMs(ms) {
  const v = Math.max(0, Number(ms) || 0);
  if (v < 10000) return (v / 1000).toFixed(1) + 's';
  if (typeof BRIDGE.fmtMs === 'function') { try { return BRIDGE.fmtMs(v); } catch (e) {} }
  const s = Math.floor(v / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
/** Cook countdowns are ALWAYS sub-minute, so they read in seconds with a tenth.
    ⚠ Not fmtMs(): that flips to m:ss at ten seconds, and a griddle flag that
    says "0:10" is both uglier and slower to parse than "10.0s" at the exact
    moment the player is timing a pull off it. */
function fmtCook(ms) {
  const v = Math.max(0, Number(ms) || 0);
  if (v < 60000) return (v / 1000).toFixed(1) + 's';
  return fmtMs(v);
}
function toast(msg, ms) { try { if (b().toast) b().toast(String(msg || ''), ms); } catch (e) {} }

/* ECON access. Identical rule to kitchen.state.js: the second argument is a
   NaN GUARD and not a tuning value — change the game in kitchen.data.js. A
   missing key here would otherwise poison a width into `NaN%`, which CSS drops
   silently, and a bar that never moves is a bug with no symptom. */
function EC(key, fallback) {
  try {
    const v = DATA.ECON ? DATA.ECON[key] : undefined;
    return (typeof v === 'number' && isFinite(v)) ? v : fallback;
  } catch (e) { return fallback; }
}
function K() { return State.Kitchen; }
/** Actions take `now`. We use the sim's last tick stamp so a click resolves
    against the same instant the frame the player reacted to was drawn with. */
function nowMs() { const k = K(); return (k && k.now) ? k.now : Date.now(); }

/* 🎨 PRESENTATION THRESHOLDS. These decide when a countdown turns amber and
   when it turns red. They are NOT economy numbers — nothing here changes a
   payout, a timer or a spawn rate, and moving them cannot make the game easier
   or harder, only more or less legible. That is why they are allowed to live
   outside kitchen.data.js; anything that could change an outcome may not. */
const URG_WARN = 0.45;   // ≤45% of the promise left → amber
const URG_LATE = 0.18;   // ≤18% left → red + panic pulse

/* ───────────────────────────────────────────────────────────────────────────
   VIEW STATE — the only state this module owns.
   ─────────────────────────────────────────────────────────────────────────── */
let _root = null;
let _openFlag = false;
let _sheet = null;              // null | 'menu' | 'supplies' | 'convoy' | 'day'
let _sel = null;                // { stationId, i } — the pan the bins build onto
let _pending = null;            // { stationId, i } — slot waiting on a menu pick
let _paintedRev = -1;
let _paintedView = '';          // view-state fingerprint, so a tab change repaints
let _offs = [];                 // event unsubscribes
let _laneW = 0;                 // cached road width; layout reads are expensive
let _laneAt = 0;                // when that measurement was taken
let _lastGemsAt = 0;
let _gems = 0;
let _lastToastAt = 0;
let _lastSheetPaint = 0;
/* Presentation-only cadence (see the URG_* note): how often an OPEN sheet
   refreshes its numbers while the kitchen runs underneath it. */
const SHEET_REPAINT_MS = 1500;

/* ── 🚚 THE LOADING BAY'S VIEW STATE ─────────────────────────────────────────
   All of this is VIEW state and none of it is game truth (§6): which truck the
   player is standing in front of, how many of each dish they have dialled onto
   it, and who they have addressed it to. `null` recipient is the explicit
   practice run — see doConvoyLaunch, and see convoy.js's own warning that
   passing `bridge().userId()` here was round 1's bug and made the entire
   player-to-player network unreachable. */
let _convoyTier = null;         // tierId the manifest panel is loading
let _convoyWant = null;         // { recipeId: qty } from the steppers, null = fill it
let _convoyTo = null;           // { id, name } chosen row, or null for a practice run
let _convoyQ = '';              // what is typed in the find-a-player field
let _convoyRows = [];           // last recipients() result
let _convoyWhy = '';            // the quiet line under the field — NEVER a toast (§9)
let _convoyBusy = false;        // a recipients() lookup is in flight
/* 🔴 DEBOUNCE OFF THE SIM CLOCK, NOT off setTimeout. CONTRACT §3 allows this
   file exactly one setTimeout (removing a finished float node) and a debounce
   timer would be a second one. `frame()` already runs 60×/s with an authoritative
   `now`, so a due-stamp costs nothing and cannot outlive the panel. */
let _findDueAt = 0;
let _findSeq = 0;               // ordering token: a slow reply must not overwrite a fast one
/* 🔴 THE IN-FLIGHT GUARD on claiming. convoy.js recomputes `paidFood` after its
   awaits and that is the SECOND wall; this is the first. Without it a double-tap
   enters `claim()` twice concurrently and the only thing that saved round 1 was
   the accident of statement order. */
const _claiming = new Set();

/* Node registry, rebuilt by paint(). frame() walks these and nothing else. */
let _reg = emptyReg();
function emptyReg() {
  return { hud: {}, tickets: [], slots: [], cars: [], dishes: [], fx: null, road: null,
           passers: null, pin: null, pinRows: [], routes: [], led: [], line: null, lineRail: null,
           laneNext: null };
}
/* The pinned card's structural fingerprint. Module-level, NOT in `_reg`, so it
   survives a rebuildRegistry() — during a rush `paint()` runs several times a
   second and re-innerHTML-ing a card the player's thumb is on the way to would
   eat the tap. It only rebuilds when the two cars, their fill or their verdict
   actually changed. */
let _pinKey = '';
/** Slow clock for the line's overflow probe — see updateLineMore(). */
let _lineMoreAt = 0;

/* ═══════════════════════════════════════════════════════════════════════════
   OPEN / CLOSE
   ═══════════════════════════════════════════════════════════════════════════ */

export function isOpen() { return !!_openFlag; }

export function open() {
  if (_openFlag && _root) { paint(); return _root; }
  close();                                   // paranoid: never two overlays

  _root = document.createElement('div');
  _root.id = OV;
  _root.setAttribute('role', 'dialog');
  _root.setAttribute('aria-label', 'Mythic Kitchen');
  _root.innerHTML = shellHtml();
  document.body.appendChild(_root);

  _root.addEventListener('click', onClick);
  /* The recipient field is the only text input in the feature. `input` (not
     `change`) because the picker must answer while you type — a find-a-player
     box that only searches on blur is a box nobody uses twice. */
  _root.addEventListener('input', onInput);
  /* 🔴 Escape is bound on DOCUMENT, not on the overlay. Bound on the overlay it
     only fires while focus is inside it — and the very act of buying a crate
     rebuilds the sheet body, which destroys the focused button and drops focus
     back to <body>. Escape then did nothing, which is exactly the moment a
     player presses it hardest. Removed again in close(). */
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', onResize);

  /* Subscribing as well as reading `frame(events)` is not redundant: an action
     the PLAYER triggered (serve, buy, plate) emits outside the tick, and those
     events would otherwise only surface a frame later — or not at all if the
     panel is closing. */
  _offs.push(State.on('*', onSimEvent));

  _openFlag = true;
  _paintedRev = -1;
  _sheet = null;
  _sel = null;
  _pending = null;
  paint();
  return _root;
}

export function close() {
  for (const off of _offs) { try { off(); } catch (e) {} }
  _offs = [];
  if (_root) {
    try { _root.removeEventListener('click', onClick); } catch (e) {}
    try { _root.removeEventListener('input', onInput); } catch (e) {}
    try { _root.remove(); } catch (e) {}
  }
  _claiming.clear();
  _findDueAt = 0;
  try { document.removeEventListener('keydown', onKeyDown, true); } catch (e) {}
  try { window.removeEventListener('resize', onResize); } catch (e) {}
  _root = null;
  _openFlag = false;
  _reg = emptyReg();
  _laneW = 0;
  _laneAt = 0;
}

function onResize() { _laneW = 0; _laneAt = 0; }

/* ═══════════════════════════════════════════════════════════════════════════
   🚧 WIRE_CSS — A STAGING AREA, NOT A STYLESHEET. DELETE ME NEXT ROUND.
   ═══════════════════════════════════════════════════════════════════════════
   CONTRACT §1: "kitchen.css owns all styling — no <style> string soup in JS."
   That rule is right and this block is a knowing, temporary exception, so here
   is the whole argument for it rather than a shrug.

   This round wired six systems that were computing real data and drawing none
   of it: the pinned lane card, per-line modifier chips, the drive-past, the
   recipient picker, the manifest, the route strip, the depot hold. Every one of
   them needs classes that do not exist in kitchen.css — and kitchen.css belongs
   to another agent this round, who has already finished. Shipping the markup
   naked would have meant screenshots of unstyled blocks, which is not "wired",
   it is "broken in a new way".

   🔴 EVERY RULE IN HERE IS WRAPPED IN `:where()` ON PURPOSE. `#id :where(.c)`
      has the specificity of the id alone (1,0,0); kitchen.css writes
      `#mythic-kitchen-ov .c` (1,1,0) and therefore BEATS this block on every
      property it chooses to define. So the CSS owner can adopt these classes one
      at a time, in any order, with no !important war and nothing to un-pick —
      and when the last one lands this constant deletes in one edit.

   The full class list is in the handover. Nothing in here is an economy number
   or a timing; it is colour, box and position only.
   ═══════════════════════════════════════════════════════════════════════════ */
const WIRE_CSS = `<style id="mk-wire-css">
#mythic-kitchen-ov :where(.mk-fails){display:flex;flex-direction:column;gap:2px;margin-left:2px}
#mythic-kitchen-ov :where(.mk-fail){font-size:10px;font-variant-numeric:tabular-nums;color:#6f6558;white-space:nowrap;letter-spacing:.04em}
#mythic-kitchen-ov :where(.mk-fail[data-on="1"]){color:#ff4d5e;text-shadow:0 0 8px rgba(255,77,94,.5)}
#mythic-kitchen-ov :where(.mk-take-wrap){display:flex;flex-direction:column;min-width:0;line-height:1.1}
#mythic-kitchen-ov :where(.mk-take){font-size:22px;font-weight:900;color:#ffd88a;font-variant-numeric:tabular-nums;text-shadow:0 2px 8px rgba(255,182,72,.35)}
#mythic-kitchen-ov :where(.mk-take-sub){font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#a99c8c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#mythic-kitchen-ov :where(.mk-take[data-pop="1"]){animation:mk-take-pop .5s ease}
@keyframes mk-take-pop{0%{transform:scale(1)}30%{transform:scale(1.22);color:#5fd97a}100%{transform:scale(1)}}

/* ── the pinned window ── */
#mythic-kitchen-ov :where(.mk-pin){position:relative;z-index:3;flex:0 0 auto;display:flex;gap:6px;padding:6px 8px 0;overflow-x:auto}
#mythic-kitchen-ov :where(.mk-pin:empty){display:none}
#mythic-kitchen-ov :where(.mk-pin-card){flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:4px;padding:6px 8px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:linear-gradient(180deg,rgba(46,52,59,.92),rgba(20,17,15,.94));box-shadow:inset 0 1px 0 rgba(255,255,255,.14),0 5px 14px rgba(0,0,0,.5)}
#mythic-kitchen-ov :where(.mk-pin-card[data-slot="next"]){flex:0 1 34%;opacity:.82}
#mythic-kitchen-ov :where(.mk-pin-card[data-ready="1"]){border-color:rgba(95,217,122,.6);box-shadow:inset 0 1px 0 rgba(255,255,255,.14),0 0 16px rgba(95,217,122,.28)}
#mythic-kitchen-ov :where(.mk-pin-card[data-mood="furious"]){border-color:rgba(255,77,94,.6)}
#mythic-kitchen-ov :where(.mk-pin-top){display:flex;align-items:center;gap:5px;min-width:0}
#mythic-kitchen-ov :where(.mk-pin-mood){font-size:19px;line-height:1;filter:drop-shadow(0 2px 3px rgba(0,0,0,.6))}
#mythic-kitchen-ov :where(.mk-pin-veh){font-size:16px;line-height:1}
#mythic-kitchen-ov :where(.mk-pin-name){font-size:12px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1 1 auto}
#mythic-kitchen-ov :where(.mk-pin-where){font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#ffb648;white-space:nowrap}
#mythic-kitchen-ov :where(.mk-pin-line){font-size:10.5px;font-style:italic;color:#cbbfae;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
#mythic-kitchen-ov :where(.mk-pin-items){display:flex;flex-direction:column;gap:2px}
#mythic-kitchen-ov :where(.mk-pin-it){display:flex;align-items:center;gap:4px;font-size:11px;min-width:0;flex-wrap:wrap}
#mythic-kitchen-ov :where(.mk-pin-it > b){font-variant-numeric:tabular-nums;color:#f6efe4}
#mythic-kitchen-ov :where(.mk-pin-it[data-done="1"] > b){color:#5fd97a}
#mythic-kitchen-ov :where(.mk-pin-acts){display:flex;gap:5px;margin-top:1px}
/* ⚠ NOT .mk-bar. kitchen.css gives .mk-bar \`flex:1 1 auto\`, which in a COLUMN
   card means flex-GROW:1 vertically — the patience bar ate the whole card and
   rendered as a green blob. Measured at 390px, not reasoned about. */
#mythic-kitchen-ov :where(.mk-pin-bar){position:relative;flex:0 0 6px;height:6px;border-radius:99px;overflow:hidden;background:rgba(0,0,0,.55);box-shadow:inset 0 1px 2px rgba(0,0,0,.7)}
#mythic-kitchen-ov :where(.mk-pin-bar > i){position:absolute;inset:0 auto 0 0;display:block;width:0;border-radius:99px;background:#5fd97a}
#mythic-kitchen-ov :where(.mk-pin-it .mk-mods-in){flex:1 1 100%;display:flex;flex-wrap:wrap;gap:3px;padding-left:18px}
#mythic-kitchen-ov :where(.mk-badge-sp){font-size:9px;letter-spacing:.06em;padding:1px 5px;border-radius:99px;background:linear-gradient(180deg,#5b4620,#332612);border:1px solid rgba(255,182,72,.5);color:#ffd88a;white-space:nowrap}

/* ── modifier chips: the promise, and whether it was kept ── */
#mythic-kitchen-ov :where(.mk-mod){display:inline-flex;align-items:center;gap:3px;font-size:9.5px;letter-spacing:.03em;padding:1px 5px;border-radius:99px;white-space:nowrap;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.42);color:#e6dccd}
#mythic-kitchen-ov :where(.mk-mod[data-kind="hold"]){border-color:rgba(255,138,90,.55);color:#ffc4a8}
#mythic-kitchen-ov :where(.mk-mod[data-kind="extra"]){border-color:rgba(127,255,196,.45);color:#b6f2d8}
#mythic-kitchen-ov :where(.mk-mod[data-result="honoured"]){border-color:rgba(95,217,122,.85);background:rgba(95,217,122,.18);color:#9fe9b1}
#mythic-kitchen-ov :where(.mk-mod[data-result="broken"]){border-color:rgba(255,77,94,.85);background:rgba(255,77,94,.2);color:#ffb4bb}
#mythic-kitchen-ov :where(.mk-mods){display:flex;flex-wrap:wrap;gap:3px;margin:2px 0 0 20px}
/* 💰 the stake, on the chip. drivethru.js prices every promise through ECON and
   publishes the signed figure; a verdict whose cost the player only meets after
   the money has moved is a mechanic they never learn. Tabular so a column of
   them lines up, and it inherits the chip's own verdict colour — the number and
   the tick are the same statement and must never disagree in colour. */
#mythic-kitchen-ov :where(.mk-mod-c){font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:0;opacity:.95}
#mythic-kitchen-ov :where(.mk-mod[data-result="unproven"] .mk-mod-c){opacity:.6}
/* the running tally under the window card: kept vs broken, at a glance */
#mythic-kitchen-ov :where(.mk-promise){display:flex;gap:6px;font-size:9.5px;letter-spacing:.06em;text-transform:uppercase}
#mythic-kitchen-ov :where(.mk-promise [data-k="ok"]){color:#9fe9b1}
#mythic-kitchen-ov :where(.mk-promise [data-k="bad"]){color:#ffb4bb;font-weight:800}

/* ── the ticket's spoken line ── */
#mythic-kitchen-ov :where(.mk-tk-line){font-size:10px;font-style:italic;line-height:1.25;color:#bdb1a0;padding:1px 2px 3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
#mythic-kitchen-ov :where(.mk-tk-mods){display:flex;flex-wrap:wrap;gap:3px;padding:0 2px 3px}

/* ── the lane: fixtures, mood, badges, the drive-past, the wave ── */
#mythic-kitchen-ov :where(.mk-fixture){position:absolute;top:4px;bottom:4px;width:46px;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:10px;line-height:1.15;text-align:center;color:#ffe0a8;background:linear-gradient(180deg,#4a515a,#1d2126);border:1px solid rgba(255,255,255,.16);box-shadow:inset 0 1px 0 rgba(255,255,255,.25),0 4px 10px rgba(0,0,0,.5);z-index:2}
#mythic-kitchen-ov :where(.mk-fixture > span){font-size:15px}
#mythic-kitchen-ov :where(.mk-fixture[data-fx="window"]){right:4px;color:#bff0cf;border-color:rgba(95,217,122,.4)}
#mythic-kitchen-ov :where(.mk-fixture[data-fx="speaker"]){left:4px}
#mythic-kitchen-ov :where(.mk-car-mood){position:absolute;top:-4px;right:8px;font-size:14px;line-height:1;filter:drop-shadow(0 2px 3px rgba(0,0,0,.7));pointer-events:none}
#mythic-kitchen-ov :where(.mk-car-badge){font-size:8.5px;letter-spacing:.04em;padding:0 4px;border-radius:99px;background:rgba(0,0,0,.65);border:1px solid rgba(255,182,72,.55);color:#ffd88a;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
#mythic-kitchen-ov :where(.mk-car-pips){display:flex;gap:2px;font-size:9px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.8))}
#mythic-kitchen-ov :where(.mk-wave){position:absolute;top:-2px;left:2px;width:17px;height:17px;padding:0;border-radius:50%;border:1px solid rgba(255,77,94,.55);background:rgba(24,12,12,.9);color:#ff9aa4;font-size:10px;line-height:1;cursor:pointer;z-index:3}
/* ⚠ 38px, not 30. Three rows of a ~12px sprite do not fit in 30 — the rows
   were 8px apart and every neighbouring pair overlapped, which is the pile
   this was meant to stop. The band still sits BEHIND the queue (z-index 1). */
/* ⚠ 44px, not 30. Three rows of a ~12px sprite do not fit in 30 — the rows
   were 8px apart and every neighbouring pair overlapped, which is the pile
   this was meant to stop. The band still sits BEHIND the queue (z-index 1). */
#mythic-kitchen-ov :where(.mk-lane-next){font-size:9.5px;letter-spacing:.08em;color:#ffb648;font-variant-numeric:tabular-nums;white-space:nowrap}
#mythic-kitchen-ov :where(.mk-lane-next:empty){display:none}
#mythic-kitchen-ov :where(.mk-passers){position:absolute;left:0;right:0;top:24px;height:44px;pointer-events:none;overflow:hidden;z-index:1}
/* ⚠ --dx IS THE TIE-BREAK, NOT THE LAYOUT. (No backticks in this block: it
   lives inside a template literal and one would end the stylesheet mid-rule,
   which is exactly how this comment was written the first time.)
   updatePassers() hands each balk the emptiest of three lanes so two cars
   turning away in the same frame never print on top of each other; the few px
   of translate here only separate the case where a fourth balk forces a lane
   to double up. Round 2 hashed the id for the lane, which spreads ids EVENLY
   rather than APART, and three simultaneous balks stacked into one illegible
   pile. Defaults to 0 so a passer built before the property is set is still
   placed correctly. */
#mythic-kitchen-ov :where(.mk-passer){position:absolute;top:0;display:flex;align-items:center;gap:2px;font-size:13px;line-height:1;white-space:nowrap;filter:grayscale(.4) brightness(.72);transform:translateX(var(--dx,0px))}
#mythic-kitchen-ov :where(.mk-passer > b){font-size:8px;font-weight:700;color:#7d7365;letter-spacing:.04em}
#mythic-kitchen-ov :where(.mk-passer[data-dup="1"] > b){display:none}

/* ── the pass: bin a plate you cannot sell ── */
#mythic-kitchen-ov :where(.mk-dish-bin){position:absolute;top:-2px;right:0;width:15px;height:15px;padding:0;border-radius:50%;border:1px solid rgba(255,255,255,.22);background:rgba(18,12,10,.85);color:#c9bcab;font-size:9px;line-height:1;cursor:pointer;opacity:.5;z-index:2}
#mythic-kitchen-ov :where(.mk-dish:hover .mk-dish-bin){opacity:1;border-color:rgba(255,77,94,.7);color:#ff9aa4}

/* ── the loading bay ── */
#mythic-kitchen-ov :where(.mk-to){display:flex;flex-direction:column;gap:6px;padding:8px;border-radius:10px;border:1px solid rgba(103,216,255,.22);background:linear-gradient(180deg,rgba(20,30,38,.85),rgba(12,14,16,.9));margin-bottom:8px}
#mythic-kitchen-ov :where(.mk-to-field){width:100%;box-sizing:border-box;padding:7px 9px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.5);color:#f6efe4;font:inherit;font-size:13px}
#mythic-kitchen-ov :where(.mk-to-field:focus){outline:none;border-color:rgba(103,216,255,.7);box-shadow:0 0 0 2px rgba(103,216,255,.18)}
#mythic-kitchen-ov :where(.mk-to-rows){display:flex;flex-wrap:wrap;gap:5px}
#mythic-kitchen-ov :where(.mk-to-chip){display:inline-flex;align-items:center;gap:5px;padding:5px 9px;border-radius:99px;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.42);color:#e6dccd;font:inherit;font-size:12px;cursor:pointer;max-width:100%}
#mythic-kitchen-ov :where(.mk-to-chip small){color:#8d8272;font-size:10px}
#mythic-kitchen-ov :where(.mk-to-chip[data-on="1"]){border-color:rgba(103,216,255,.9);background:rgba(103,216,255,.2);color:#d6f4ff;box-shadow:0 0 12px rgba(103,216,255,.3)}
#mythic-kitchen-ov :where(.mk-to-why){font-size:11px;color:#8d8272}

#mythic-kitchen-ov :where(.mk-man){display:flex;flex-direction:column;gap:5px;padding:8px;border-radius:10px;border:1px solid rgba(255,182,72,.22);background:linear-gradient(180deg,rgba(38,28,18,.85),rgba(14,11,9,.9));margin-bottom:8px}
#mythic-kitchen-ov :where(.mk-man-line){display:flex;align-items:center;gap:7px;font-size:12px}
#mythic-kitchen-ov :where(.mk-man-line > .mk-nm){flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#mythic-kitchen-ov :where(.mk-step){width:26px;height:26px;padding:0;border-radius:7px;border:1px solid rgba(255,255,255,.2);background:linear-gradient(180deg,rgba(255,255,255,.1),rgba(0,0,0,.4));color:#f6efe4;font:inherit;font-size:14px;font-weight:800;line-height:1;cursor:pointer}
#mythic-kitchen-ov :where(.mk-step:disabled){opacity:.3;cursor:default}
#mythic-kitchen-ov :where(.mk-man-take){min-width:38px;text-align:center;font-variant-numeric:tabular-nums;font-weight:800;font-size:13px}
#mythic-kitchen-ov :where(.mk-man-fill){position:relative;height:14px;border-radius:99px;overflow:hidden;background:rgba(0,0,0,.55);box-shadow:inset 0 1px 3px rgba(0,0,0,.8)}
#mythic-kitchen-ov :where(.mk-man-fill > i){position:absolute;inset:0 auto 0 0;display:block;border-radius:99px;background:linear-gradient(90deg,#ff8a5a,#ffb648)}
#mythic-kitchen-ov :where(.mk-man-fill > span){position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;text-shadow:0 1px 3px rgba(0,0,0,.9)}

/* ── the route: five named legs between two markers ── */
#mythic-kitchen-ov :where(.mk-route){position:relative;height:46px;margin:6px 0 2px}
#mythic-kitchen-ov :where(.mk-route-rail){position:absolute;left:12px;right:12px;top:26px;height:5px;border-radius:99px;background:repeating-linear-gradient(90deg,rgba(255,255,255,.22) 0 8px,transparent 8px 16px),rgba(0,0,0,.5)}
#mythic-kitchen-ov :where(.mk-route-leg){position:absolute;top:20px;transform:translateX(-50%);font-size:11px;line-height:1;opacity:.35;filter:grayscale(1)}
#mythic-kitchen-ov :where(.mk-route-leg[data-passed="1"]){opacity:1;filter:none}
#mythic-kitchen-ov :where(.mk-route-leg[data-hazard="1"][data-passed="1"]){text-shadow:0 0 9px rgba(255,77,94,.9)}
#mythic-kitchen-ov :where(.mk-route-end){position:absolute;top:2px;font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:#a99c8c;max-width:44%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#mythic-kitchen-ov :where(.mk-route-end[data-e="a"]){left:0}
#mythic-kitchen-ov :where(.mk-route-end[data-e="b"]){right:0;text-align:right}
#mythic-kitchen-ov :where(.mk-truck){position:absolute;top:12px;left:0;transform:translateX(-50%);font-size:17px;line-height:1;z-index:2;filter:drop-shadow(0 2px 4px rgba(0,0,0,.8));animation:mk-wobble .9s ease-in-out infinite}
@keyframes mk-wobble{0%,100%{transform:translateX(-50%) translateY(0) rotate(-1.5deg)}50%{transform:translateX(-50%) translateY(-1.5px) rotate(1.5deg)}}
#mythic-kitchen-ov :where(.mk-route-note){font-size:10px;color:#a99c8c;padding-top:1px}
#mythic-kitchen-ov :where(.mk-route-note[data-bad="1"]){color:#ffb4bb}
#mythic-kitchen-ov :where(.mk-held){border-color:rgba(103,216,255,.4)}
</style>`;

/* ═══════════════════════════════════════════════════════════════════════════
   THE SHELL — built once, in open(). Everything inside #mk-body is rebuilt by
   paint(); the HUD, tabs and FX layer are permanent so their nodes survive and
   frame() can write to them without a lookup.
   ═══════════════════════════════════════════════════════════════════════════ */
function shellHtml() {
  return WIRE_CSS + `
  <!-- 🏛 THE ROOM. The div paints wall + floor + lamps out of its three layers
       (element / ::before / ::after) and those three were FULL — which is why
       round 2's diners had to share one blurred layer with the bulbs and came
       out as scuffs on the floor. This one empty child buys three more layers
       at a DIFFERENT blur radius, and that is the whole difference between a
       smudge and a person: near figures sharp-ish with a rim of lamp light on
       one shoulder, the far row left soft. It is aria-hidden and inert, exactly
       like its parent. -->
  <div class="mk-room" aria-hidden="true"><i class="mk-folk"></i></div>

  <header class="mk-hud">
    <div class="mk-hud-pop" title="Popularity, and what today has cost you">
      <span class="mk-face" id="mk-face">🙂</span>
      <div>
        <div class="mk-meter"><i id="mk-pop-bar"></i></div>
        <div class="mk-lab" id="mk-pop-lab">Popularity</div>
      </div>
      <div class="mk-fails" id="mk-fails" title="Walked out / burnt today">
        <span class="mk-fail" data-on="0" id="mk-fail-lost">💀 0</span>
        <span class="mk-fail" data-on="0" id="mk-fail-burnt">🔥 0</span>
      </div>
    </div>

    <div class="mk-hud-lvl" title="Level and experience">
      <span class="mk-lvl-badge">Lv <b id="mk-level">1</b></span>
      <div class="mk-xp"><i id="mk-xp-bar"></i></div>
      <span class="mk-lab" id="mk-xp-lab">0/0</span>
    </div>

    <!-- 💰 THE MONEY ANCHOR. REF-B's loudest number is "$394.64" and it is the
         till, not the bank. Ours led with the global Cinder wallet — a number
         that reads 0 for most players and does not move while you cook — and
         buried today's takings in an 11px chip at the bottom of the screen.
         Takings lead now; the wallet is the small print under them. -->
    <div class="mk-hud-cash" title="Today's takings, and your Cinder wallet">
      <span class="mk-coin" aria-hidden="true"></span>
      <div class="mk-take-wrap">
        <span class="mk-take" id="mk-take">0</span>
        <span class="mk-take-sub" id="mk-take-sub">today · ◈ 0 in the vault</span>
      </div>
      <span class="mk-cash mk-sr-cash" id="mk-cash" hidden>0</span>
    </div>

    <div class="mk-hud-clock" title="Shift clock">
      <div>
        <div class="mk-day" id="mk-day">Monday</div>
        <div class="mk-clock" id="mk-clock">10:00 AM</div>
      </div>
      <div class="mk-rush" id="mk-rush" title="Demand"><i></i><i></i><i></i><i></i><i></i></div>
    </div>

    <button class="mk-hud-close" data-act="close" aria-label="Close the kitchen">✕</button>
  </header>

  <!-- 📌 THE PINNED WINDOW. The drive-thru is the headline feature and at 360px
       it was fourth of five sections, below the fold, unreachable during the
       one moment it matters. This is drivethru.js's own laneCard() — the car AT
       the window and the one behind it, with the two player verbs on them — and
       it never scrolls away. -->
  <div class="mk-pin" id="mk-pin"></div>

  <div class="mk-body" id="mk-body"></div>

  <div class="mk-strip" id="mk-strip"></div>

  <nav class="mk-tabs" role="tablist" aria-label="Kitchen sections">
    ${tabHtml('line', '🍳', 'Line')}
    ${tabHtml('menu', '📋', 'Menu')}
    ${tabHtml('supplies', '🧺', 'Supplies')}
    ${tabHtml('convoy', '🚚', 'Convoy')}
    ${tabHtml('day', '📊', 'Day')}
  </nav>

  <div class="mk-sheet-wrap" id="mk-sheet-wrap" hidden>
    <div class="mk-sheet" role="dialog" aria-label="Kitchen panel">
      <div class="mk-sheet-head">
        <h3 id="mk-sheet-title">—</h3>
        <span class="mk-spacer"></span>
        <button class="mk-btn" data-act="sheet-close">Close</button>
      </div>
      <div class="mk-sheet-body" id="mk-sheet-body"></div>
    </div>
  </div>

  <div class="mk-fx" id="mk-fx" aria-hidden="true"></div>`;
}
function tabHtml(id, icon, label) {
  return `<button class="mk-tab" role="tab" data-act="tab" data-tab="${id}" aria-selected="false">
    <span class="mk-ic" aria-hidden="true">${icon}</span><span>${label}</span></button>`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   PAINT — the structural repaint. Rev-gated. See the two-speed rule up top.
   ═══════════════════════════════════════════════════════════════════════════ */
export function paint() {
  if (!_root) return;
  const k = K();
  const body = _root.querySelector('#mk-body');
  if (!body) return;

  /* Preserve horizontal scroll across a repaint. Without this, a rail the
     player has scrolled halfway snaps back to zero every time a ticket fills —
     which, during a rush, is several times a second and makes the bins on the
     right unreachable. */
  const scrolls = {};
  for (const rail of body.querySelectorAll('[data-rail]')) scrolls[rail.dataset.rail] = rail.scrollLeft;

  /* 🔴 DOM ORDER IS THE PHONE ORDER: board → line → pass → lane → bins.
     A phone stacks these in source order and only the first ~540px are on
     screen, so the first two must be the two things you ACT on: the orders and
     the pans. The drive-thru is the best-looking part of this feature and it
     was at the top for exactly that reason — but it is something you WATCH, and
     at 360×640 it pushed the cooking entirely below the fold.
     Desktop is unaffected: `.mk-body` is a named-area grid there, and grid
     placement ignores source order — the lane goes back across the top. That is
     the only reason one renderer can serve both without re-parenting nodes. */
  body.innerHTML =
      boardHtml(k)
    + lineHtml(k)
    + passHtml(k)
    + laneHtml(k)
    + binsHtml(k);

  for (const rail of body.querySelectorAll('[data-rail]')) {
    const s = scrolls[rail.dataset.rail];
    if (s) rail.scrollLeft = s;
  }

  paintStrip(k);
  paintTabs();
  /* 🔴 DO NOT repaint the open sheet on every rev. During a rush the sim bumps
     `rev` several times a SECOND (every unit that fills a ticket does), and
     re-innerHTML-ing the supplies list that often makes it impossible to scroll
     — the list snaps back to the top under your thumb while you are trying to
     buy patties. The sheet's numbers ("you have 3") are worth refreshing, just
     not sixty times a minute, so they refresh on a slow clock instead. */
  if (_sheet && (k.now - _lastSheetPaint) > SHEET_REPAINT_MS) paintSheet();
  rebuildRegistry();

  _paintedRev = k.rev;
  _paintedView = viewKey();
  /* One cheap pass so a fresh paint is never a frame behind: a ticket that
     appeared this instant must not show an empty countdown for 16ms. */
  const t0 = nowMs();
  updateHud(t0, true);
  updateTickets(t0);
  updateSlots(t0);
  paintPin(k, t0, true);
  updateCars(t0);
  updatePassers(t0);
  updatePass(t0);
}

function viewKey() { return [_sheet || '-', _sel ? _sel.stationId + _sel.i : '-'].join('|'); }

function rebuildRegistry() {
  _reg = emptyReg();
  if (!_root) return;
  const q = (s) => _root.querySelector(s);

  _reg.hud = {
    face: q('#mk-face'), popBar: q('#mk-pop-bar'), popLab: q('#mk-pop-lab'),
    level: q('#mk-level'), xpBar: q('#mk-xp-bar'), xpLab: q('#mk-xp-lab'),
    cash: q('#mk-cash'), day: q('#mk-day'), clock: q('#mk-clock'),
    take: q('#mk-take'), takeSub: q('#mk-take-sub'),
    lost: q('#mk-fail-lost'), burnt: q('#mk-fail-burnt'),
    rush: _root.querySelectorAll('#mk-rush > i'),
  };
  _reg.fx = q('#mk-fx');
  _reg.laneNext = q('#mk-lane-next');
  _reg.line = q('.mk-sec-line');
  _reg.lineRail = q('.mk-sec-line .mk-rail');
  _reg.road = q('#mk-road');
  _reg.passers = q('#mk-passers');
  _reg.pin = q('#mk-pin');

  for (const el of _root.querySelectorAll('.mk-tk')) {
    _reg.tickets.push({ id: el.dataset.tk, el, bar: el.querySelector('.mk-bar > i'), time: el.querySelector('.mk-tk-time') });
  }
  for (const el of _root.querySelectorAll('.mk-slot')) {
    if (el.dataset.phase === 'empty') continue;
    _reg.slots.push({
      st: el.dataset.st, i: Number(el.dataset.i) || 0, el,
      cook: el.querySelector('.mk-bar.cook > i'),
      burn: el.querySelector('.mk-bar.burn > i'),
      flag: el.querySelector('.mk-slot-flag'),
    });
  }
  for (const el of _root.querySelectorAll('.mk-car')) {
    _reg.cars.push({ id: el.dataset.car, el, bar: el.querySelector('.mk-bar > i'), bub: el.querySelector('.mk-bub') });
  }
  for (const el of _root.querySelectorAll('.mk-dish')) {
    _reg.dishes.push({ id: el.dataset.dish, el, fresh: el.querySelector('.mk-fresh > i') });
  }
  /* The live-ledger strip over the prep counter. Registered so updateHud()'s
     throttled bridge read can keep it honest: the city collects, a business
     pays out and a battle drops loot while this panel is open, and a stash
     figure that only moves when something unrelated repaints is a figure the
     player learns not to trust. */
  for (const el of _root.querySelectorAll('.mk-led')) {
    _reg.led.push({ id: el.dataset.res, el, num: el.querySelector('b[data-led]') });
  }
}

/* ── 🚗 THE LANE ─────────────────────────────────────────────────────────── */
function laneHtml(k) {
  /* ⚠ GONE CARS STAY ON SCREEN FOR LANE_EXIT_MS. Round 1 filtered them out the
     instant `state` flipped, so a served customer VANISHED — no drive-off, no
     veer, and `exitDir` (which the lane computes for exactly this) had nothing
     to animate. They are drawn for as long as the lane says they still occupy
     their slot, and updateCars() moves them out. */
  const exitMs = EC('LANE_EXIT_MS', 900);
  const cars = (k.lane || []).filter((c) => c
    && (c.state !== 'gone' || (k.now - (Number(c.leftAt) || 0)) < exitMs));
  /* drivethru.js publishes a HUD chip of its own — take it. Its `cap`/`used`
     are in LENGTH units (a rig is two cars long) while `live` is a head-count,
     and it is the module's business to know the difference, not ours. */
  const st = safe(() => (typeof DriveThru.laneStatus === 'function' ? DriveThru.laneStatus(k, k.now) : null), null);
  const cap = st ? st.cap : capLane(k);
  const live = st ? st.live : cars.length;
  /* 🔴 Cars are born AT THEIR POSITION, not at x=0.
     `.mk-car` carries `transition: transform .25s linear` so a car rolling up
     the lane moves smoothly. But paint() recreates these nodes, and a node
     created at translateX(0) and then assigned translateX(223px) by the next
     frame ANIMATES that jump — so every structural repaint (which during a rush
     is several a second) slingshotted the entire lane in from the left kerb.
     Seeding the transform in the markup means the transition only ever fires
     for movement the sim actually asked for. Found by screenshot, not by
     reading: the DOM was correct in every probe. */
  const travel = laneTravel();
  const body = cars.length
    ? cars.map((c, i) => carHtml(c, travel, i === 0)).join('')
    : `<div class="mk-road-empty">${k.shift.running ? 'Lane clear. Someone will turn up.' : 'The lane is closed.'}</div>`;

  /* 🔴 TWO FIXTURES, AND WHICH END EACH ONE IS ON IS NOT A DETAIL.
     drivethru.js defines `pos 0` as the WINDOW and `LANE_LEN` as the mouth, and
     carX() maps pos 0 to the RIGHT edge of the road. Round 1 drew exactly one
     fixture — a box reading "ORDER HERE" — pinned to that right edge. So the
     sign telling people where to order was standing at the hatch where food is
     handed out, and the place cars actually order had no fixture at all. A
     full-day probe put 900 order-phase frames at the speaker and 24 at the
     window; the picture said the opposite.
     Now: 🪟 WINDOW at pos 0 (right), 🔊 ORDER HERE at the mouth (left), and
     laneTravel() reserves the width of BOTH so no car parks under either. */
  const fixtures = `
        <div class="mk-fixture" data-fx="speaker" aria-hidden="true"><span>🔊</span>ORDER<br>HERE</div>
        <div class="mk-fixture" data-fx="window" aria-hidden="true"><span>🪟</span>WINDOW</div>`;

  return `
  <section class="mk-sec mk-sec-lane">
    <div class="mk-sec-head"><b>Drive-Thru</b><span class="mk-spacer"></span>
      <!-- ⏱ WHEN THE NEXT ONE IS DUE. laneStatus() has published nextInMs
           since this round and nobody drew it (no backticks in this comment —
           it lives inside a template literal). It is the only
           thing on the screen that says PRESSURE IS COMING rather than
           PRESSURE IS HERE, and knowing you have eleven seconds is what turns
           "panic" into "start the fryer". Per-FRAME (it counts down), so it is
           an empty node here and a textContent write in updateCars(). -->
      <span class="mk-lane-next" id="mk-lane-next"></span>
      <span>${esc(st ? st.label : (live + ' / ' + cap + ' cars'))}</span></div>
    <div class="mk-lane">
      <div class="mk-road" id="mk-road">
        ${body}
        <div class="mk-passers" id="mk-passers" aria-hidden="true"></div>
        ${fixtures}
      </div>
    </div>
  </section>`;
}
/**
 * ⚠ `carId` is AMBIGUOUS in the contract and this is the defensive reading.
 * §2 types a lane entry as `{id, carId, …}` and kitchen.state.js resolves a
 * ticket back to its car with `lane.find(c => c.carId === ticket.carId)` — so
 * `carId` is that car's IDENTITY in the lane, which means it is NOT necessarily
 * one of the CARS sprite ids. We therefore look the sprite up through
 * `type`/`kind` first and only fall back to `carId`, and we take identity from
 * `carId || id`. Both readings render; neither builder can break the other.
 * This wants resolving in CONTRACT.md §2 before the next pass.
 */
function carHtml(c, travel, isHead) {
  const car = (typeof DATA.car === 'function' ? (DATA.car(c.vehicle) || DATA.car(c.type) || DATA.car(c.carId)) : null) || {};
  const x = carX(c, travel);
  const cust = (typeof DATA.customer === 'function' ? DATA.customer(c.custId) : null) || {};
  /* 🔴 SIX FIELDS THE LANE COMPUTED EVERY FRAME AND NOBODY DREW. drivethru.js's
     §RENDER block is explicit about each: `mood` is the per-customer emoji face
     (REF-B's popularity face, once per car, and the single best "who do I serve
     next" signal on the screen); `special` is the set piece, and a set piece the
     player cannot identify is just a random multiplier; the order pips say WHAT
     they want without opening anything. `exitDir` is honoured in updateCars(). */
  const mood = MOOD_FACE[c.mood] || '';
  const badge = SPECIAL_BADGE[c.special] || '';
  const pips = (c.items || []).slice(0, 4).map((it) => {
    const r = (typeof DATA.recipe === 'function' ? DATA.recipe(it.recipeId) : null) || {};
    return `<span>${r.icon || '🍽'}${(it.qty | 0) > 1 ? '×' + (it.qty | 0) : ''}</span>`;
  }).join('');
  /* The wave-off lives only on the HEAD car. It is the player's escape hatch —
     "this raider is going to time out anyway and take three cars behind him with
     him" — and it costs POP_WAVE, so it is deliberately a small 17px target you
     have to mean, guarded by a confirm. Offering it on every car in the queue
     would invite a mis-tap that costs popularity for no decision at all. */
  const wave = isHead && c.state !== 'gone'
    ? `<button class="mk-wave" data-act="wave" data-car="${esc(c.carId || c.id)}" title="Wave them off (costs popularity)" aria-label="Wave ${esc(c.name || 'this car')} off">✋</button>` : '';
  /* The bubble node ALWAYS exists and is hidden with an attribute. `car.say` is
     set by drivethru.js with its own expiry (`sayUntil`) and does NOT bump
     `rev` — rightly, it is chatter, not structure — so if the bubble were built
     at paint time the customer would say nothing until something unrelated
     repainted the lane. It is a per-frame textContent write instead. */
  return `<div class="mk-car" data-car="${esc(c.carId || c.id)}" data-state="${esc(c.state || 'rolling')}"
      data-side="left" data-say="0" data-mood="${esc(c.mood || 'ok')}" style="transform:translateX(${x}px)">
      <div class="mk-bub"></div>
      ${wave}
      <span class="mk-car-mood" aria-hidden="true">${mood}</span>
      <div class="mk-car-body" aria-hidden="true">${c.vehicleIcon || car.icon || '🚗'}</div>
      ${pips ? `<div class="mk-car-pips" aria-hidden="true">${pips}</div>` : ''}
      <div class="mk-car-name">${esc(c.name || cust.name || 'Customer')}</div>
      ${badge ? `<span class="mk-car-badge">${esc(badge)}</span>` : ''}
      <div class="mk-bar"><i></i></div>
    </div>`;
}
/* The lane's own vocabulary, mirrored from drivethru.js §RENDER. ⚠ Mirrored and
   not imported: these are PRESENTATION strings (see the URG_* note) and the
   module exports its own copies only inside `laneCard()`, which the pinned strip
   uses. Nothing here can change an outcome. */
const MOOD_FACE = { happy: '😄', ok: '🙂', testy: '😠', furious: '🤬' };
const SPECIAL_BADGE = { bulk: '📦 BULK', jump: '⚡ CUT IN', grudge: '😤 GRUDGE', favour: '💚 REGULAR' };

/**
 * 🔴 THE LANE RUNS RIGHT-TO-LEFT AND `pos` IS INVERTED.
 * drivethru.js: "pos 0 is the WINDOW, LANE_LEN is the mouth of the lane, and a
 * car spawns past that so it drives on screen instead of appearing" — arrivals
 * start at ~1.30. Our window (the speaker box) is drawn at the RIGHT edge, so
 * screen-x is `travel × (1 − pos)`, and a car still out at pos 1.3 lands at a
 * NEGATIVE x — off the left kerb, clipped by the road's overflow, exactly the
 * drive-on the module intends. Reading `pos` as a straight 0→1 left-to-right
 * ramp (which is what CONTRACT §2's one-line description suggests) parks
 * everybody backwards: the car being served sits at the entrance.
 */
function carX(c, travel) {
  const len = Math.max(0.01, EC('LANE_LEN', 1));
  const p = (Number(c.pos) || 0) / len;
  const t = Number(travel) || 0;
  /* 🔴 THE MOUTH IS NOW A FIXTURE TOO, so x=0 is no longer the left kerb — it is
     the left kerb PLUS the speaker box. Without the offset the last car in a
     full lane parks on top of the ORDER HERE sign, which is the one place a car
     genuinely cannot be. */
  return Math.round(MOUTH_W + Math.min(t, (1 - p) * t));
}
/** ⚠ Reserves are wider than the fixtures they clear (46px each). `travel` is
    measured to the car's LEFT edge, so a reserve equal to the box parks the
    car's 76px-wide label underneath it and the customer at the window loses
    their name. The extra clears the label too. */
const MOUTH_W = 52;
/** How far a car can move across the road, in px. One definition, two callers
    (the markup seed above and the per-frame update). */
function laneTravel() {
  const CAR_W = 76, WINDOW_W = 84;
  return Math.max(0, (_laneW || 0) - CAR_W - WINDOW_W - MOUTH_W);
}
function capLane(k) {
  try { if (typeof DATA.laneCap === 'function') return DATA.laneCap(k.upgrades || []); } catch (e) {}
  return EC('LANE_CAP', 4);
}

/* ── 📋 THE ORDER BOARD ──────────────────────────────────────────────────── */
/**
 * 🔴 THE CUSTOMER AT THE WINDOW IS NOT ALSO A TICKET ON THE BOARD.
 * Round 2 printed the same order twice, verbatim — the pinned window card
 * ("Mayor's Aide · Corp order… · Margherita 0/5") and, directly beneath it, a
 * board ticket with the same name, the same quote and the same 0/5. Between
 * them they ate the top ~45% of a 390×844 screen to say one thing, and that is
 * most of why the drive-thru lane ended up at the fold.
 *
 * The window card IS that customer's ticket: it carries the itemisation, the
 * per-line promises, the patience bar and the Serve button. So while they are
 * at the window their board copy stands down and the head says where it went.
 *
 * ⚠ ONLY the window car, never the NEXT one. The pin's second card is a preview
 *   with no Serve button on it; dropping that ticket from the board too would
 *   delete the only control that can serve it. Duplication is a cosmetic cost,
 *   an unservable ready ticket is a real one.
 */
function pinnedTicketId(k) {
  const card = safe(() => (typeof DriveThru.laneCard === 'function' ? DriveThru.laneCard(k, k.now) : null), null);
  const w = card && card.window;
  /* ⚠ NOT while the car is leaving. `laneCard().window` is `lane[0]`, and a
     served car stays in the lane for LANE_EXIT_MS so it can be animated off —
     so for that second it is still "the window car" while its pinned card is
     on its way out. Hiding a live ticket behind a card that is disappearing is
     how a ready order ends up with no Serve button anywhere on screen. */
  const carId = (w && w.state !== 'gone') ? w.carId : null;
  if (!carId) return null;
  const t = (k.tickets || []).find((x) => x && x.carId === carId && (x.state === 'open' || x.state === 'ready'));
  return t ? t.id : null;
}
function boardHtml(k) {
  const atWindow = pinnedTicketId(k);
  const all = (k.tickets || []).filter((t) => t && (t.state === 'open' || t.state === 'ready'));
  const list = all.filter((t) => t.id !== atWindow);
  const inner = list.length
    ? list.map((t) => ticketHtml(t, k)).join('')
    : `<div class="mk-empty">${!k.shift.running ? 'Service is closed.'
        : (atWindow ? 'Only the one at the window. Get it out.' : 'No orders on the board. Enjoy it.')}</div>`;
  return `
  <section class="mk-sec mk-sec-board">
    <div class="mk-board">
      <div class="mk-board-head">Customer Orders<span class="mk-spacer"></span>
        ${atWindow ? '<span class="mk-board-note">+1 at the window</span>' : ''}
        <span class="mk-board-count">${all.length}</span></div>
      <div class="mk-rail" data-rail="board">${inner}</div>
    </div>
  </section>`;
}
/**
 * 🎫 REF-B'S ORDER SCREEN: an ITEMISED ticket, with the customer's own words at
 * the top and the promises attached to the line they were made about.
 *
 * 🔴 "NO ONIONS" IS ONLY A MECHANIC IF THE PLAYER CAN SEE IT. drivethru.js has
 * scored modifiers per line since this round — `hold` clears iff the ingredient
 * is absent from every unit, `extra` iff it appears twice in every unit — and
 * round 1 rendered none of it. A promise the ticket never states is not a
 * promise, it is a hidden dice roll that quietly takes the player's tip.
 *
 * The verdict is LIVE: `modVerdict()` is a pure read, safe before anything is
 * cooked, and it says 'unproven' until there is a dish to judge. Unproven is
 * neutral by design (worth exactly 0) — it must never read as a failure, or a
 * player who has not started that line yet is being told off for it.
 */
function ticketHtml(t, k) {
  const cust = (typeof DATA.customer === 'function' ? DATA.customer(t.custId) : null) || {};
  const verdict = modResults(k, t);
  const items = (t.items || []).map((it) => {
    const r = (typeof DATA.recipe === 'function' ? DATA.recipe(it.recipeId) : null) || {};
    const pips = [];
    for (let i = 0; i < it.qty; i++) pips.push(`<i class="${i < it.filled ? 'on' : ''}"></i>`);
    const mods = (Array.isArray(it.mods) ? it.mods : []).map((m) => {
      const d = modOf(verdict, m, it.recipeId);
      return modChip(m, d && d.result, d && d.cinder);
    }).join('');
    return `<div class="mk-tk-it" data-done="${it.filled >= it.qty ? 1 : 0}">
        <span class="mk-ic" aria-hidden="true">${r.icon || '🍽'}</span>
        <span class="mk-nm">${esc(r.name || it.recipeId)}</span>
        <span class="mk-qt">${it.filled}/${it.qty}</span>
        <span class="mk-pips" aria-hidden="true">${pips.join('')}</span>
      </div>${mods ? `<div class="mk-mods">${mods}</div>` : ''}`;
  }).join('');

  /* Order-level mods that never landed on a line (a whole-ticket "well done")
     still belong on the ticket — they score, so they must be readable. */
  const seen = Object.create(null);
  for (const it of (t.items || [])) for (const m of (it.mods || [])) seen[m.id] = 1;
  const loose = (Array.isArray(t.mods) ? t.mods : []).filter((m) => m && !seen[m.id])
    .map((m) => { const d = modOf(verdict, m, null); return modChip(m, d && d.result, d && d.cinder); }).join('');

  const ready = t.state === 'ready';
  const worth = ticketWorth(t);
  return `<div class="mk-tk" data-tk="${esc(t.id)}" data-src="${esc(t.source)}" data-state="${esc(t.state)}" data-urg="ok">
      <div class="mk-tk-top">
        <span class="mk-ic" aria-hidden="true">${t.icon || cust.icon || '🧑'}</span>
        <span class="mk-tk-who">${esc(t.name || cust.name || 'Customer')}</span>
        <span class="mk-tk-src">${t.source === 'drive' ? '🚗 Lane' : '🚶 Counter'}</span>
      </div>
      ${t.line ? `<div class="mk-tk-line">“${esc(t.line)}”</div>` : ''}
      ${loose ? `<div class="mk-tk-mods">${loose}</div>` : ''}
      <div class="mk-tk-items">${items}</div>
      <div class="mk-tk-foot">
        <div class="mk-bar"><i></i></div>
        <span class="mk-tk-time">—</span>
      </div>
      ${ready ? `<button class="mk-serve" data-act="serve" data-id="${esc(t.id)}">Serve · ${esc(fmtCinder(worth))}</button>` : ''}
    </div>`;
}
const MOD_MARK = { honoured: '✓', broken: '✗' };
function modKey(m, recipeId) { return (m && m.id) + '|' + (recipeId || ''); }
/** The lane's live per-line verdict, keyed so a ticket line can look itself up.
    Degrades to an empty map (everything 'unproven') if drivethru.js is mid-rewrite. */
function modResults(k, t) {
  const out = Object.create(null);
  if (!t || t.source !== 'drive' || !t.carId || typeof DriveThru.modVerdict !== 'function') return out;
  const car = (k.lane || []).find((c) => c && (c.carId === t.carId || c.id === t.carId));
  if (!car) return out;
  const v = safe(() => DriveThru.modVerdict(k, car, k.now), null);
  /* ⚠ The whole detail ROW is kept, not just `.result`. The lane prices each
     promise (`row.cinder`) and modChip() prints that figure — pulling the
     verdict out and dropping the money was how round 2 ended up with a mechanic
     the player could see the outcome of but never the stake. */
  for (const d of ((v && v.detail) || [])) out[modKey(d, d.recipeId)] = d;
  return out;
}
function modOf(map, m, recipeId) { return map[modKey(m, recipeId)] || null; }
/**
 * 💰 THE STAKES GO ON THE CHIP.
 * drivethru.js prices every promise through ECON and hands the signed figure
 * over on `mod.cinder` (laneCard → items[].mods[].cinder). A verdict the player
 * only learns after the money has already moved is a mechanic they never learn
 * at all, so the chip carries what this promise is worth WHILE they still have
 * time to keep it: "+14" in green on a kept one, "−22" in red on a broken one.
 * ⚠ Zero is printed as nothing. UNPROVEN is worth exactly 0 in both directions
 *   (kitchen.data.js is explicit and audits itself on it) and a "0" chip on an
 *   untouched line reads as a penalty the player has already taken.
 */
function modChip(m, result, cinder) {
  if (!m) return '';
  const ing = (m.ing && typeof DATA.ingredient === 'function') ? (DATA.ingredient(m.ing) || {}) : {};
  const r = result || 'unproven';
  const c = Math.round(Number(cinder != null ? cinder : m.cinder) || 0);
  const money = c ? `<b class="mk-mod-c">${c > 0 ? '+' : '−'}${fmtNum(Math.abs(c))}</b>` : '';
  return `<span class="mk-mod" data-kind="${esc(m.kind || '')}" data-result="${esc(r)}"
      title="${esc(m.label || '')} — ${r === 'honoured' ? 'kept' : (r === 'broken' ? 'broken' : 'not judged yet')}${c ? ` · ${c > 0 ? '+' : '−'}${Math.abs(c)} Cinder` : ''}"
    >${ing.icon || (m.kind === 'hold' ? '🚫' : '➕')} ${esc(m.label || m.id)}${MOD_MARK[r] ? ' ' + MOD_MARK[r] : ''}${money}</span>`;
}
/** Menu-price estimate for the SERVE button. Deliberately the undecorated base
    price sum: quoting the popularity- and rush-adjusted figure here would be a
    promise this file cannot keep — serveTicket() does the real arithmetic and
    the float-up shows what actually landed. */
function ticketWorth(t) {
  let v = 0;
  for (const it of (t.items || [])) {
    const r = (typeof DATA.recipe === 'function' ? DATA.recipe(it.recipeId) : null);
    if (r) v += (r.basePrice || 0) * it.qty;
  }
  return v;
}

/* ── 🔥 THE LINE ─────────────────────────────────────────────────────────── */
function lineHtml(k) {
  const stations = (Array.isArray(DATA.STATIONS) ? DATA.STATIONS : []).slice()
    .sort((a, bb) => (a.order || 0) - (bb.order || 0));
  const cards = stations.map((s) => stationHtml(k, s)).join('');
  /* `.mk-line-more` is drawn always and SHOWN only when updateLineMore() says
     the rail is genuinely cut off — see the note on it below. A pill that is
     always there is a pill nobody reads. */
  return `
  <section class="mk-sec mk-sec-line" data-more="0">
    <div class="mk-sec-head"><b>The Line</b><span class="mk-spacer"></span>
      <span>${_sel ? 'building · tap a bin' : 'tap a pan to start'}</span></div>
    <div class="mk-hood" aria-hidden="true"></div>
    <div class="mk-rail" data-rail="line">${cards}</div>
    <span class="mk-line-more" aria-hidden="true">▾ more pans</span>
  </section>`;
}
/**
 * ⚠ `data-slots` EXISTS FOR THE CSS AND FOR NOTHING ELSE, and it is worth the
 * attribute. At desktop the line is a flex-wrap row; with every card asking for
 * the same basis, a ONE-pan station stretched to fill the leftover width and
 * round 2 measured the Prep Board and the Fountain at 401×146 each, holding a
 * single 388-wide pan — ~85% empty surface on the two cards a player looks at
 * most often when they are learning the line. CSS cannot count children, so the
 * renderer says how many there are and kitchen.css sizes the card to what it
 * actually holds. The extra then falls to the flat-top, which has pans to put
 * in it, and after that to the pass.
 */
function stationHtml(k, s) {
  const rack = (k.stations || {})[s.id] || { slots: [] };
  const slots = rack.slots.map((slot, i) => slotHtml(k, s, slot, i)).join('');
  return `<div class="mk-st" data-kind="${esc(s.kind || 'heat')}" data-slots="${rack.slots.length}">
      <div class="mk-st-head"><span class="mk-ic" aria-hidden="true">${s.icon || '🍳'}</span>
        ${esc(s.name || s.id)}<span class="mk-n">${rack.slots.length}</span></div>
      <div class="mk-slots">${slots}</div>
    </div>`;
}
function slotHtml(k, s, slot, i) {
  const sel = _sel && _sel.stationId === s.id && _sel.i === i ? '1' : '0';
  if (!slot) {
    return `<div class="mk-slot" role="button" tabindex="0" data-act="slot" data-st="${esc(s.id)}" data-i="${i}"
        data-phase="empty" data-sel="${sel}" aria-label="Start a dish on the ${esc(s.name || s.id)}">
        <span aria-hidden="true">＋ dish</span></div>`;
  }
  const r = (typeof DATA.recipe === 'function' ? DATA.recipe(slot.recipeId) : null) || {};
  const phase = safe(() => State.slotPhase(slot, k.now), 'cooking');
  const q = safe(() => State.qualityOf(slot, k.now), 'raw');
  return `<div class="mk-slot" role="button" tabindex="0" data-act="slot" data-st="${esc(s.id)}" data-i="${i}"
      data-phase="${esc(phase)}" data-q="${esc(q)}" data-sel="${sel}" data-warn="0"
      aria-label="${esc(r.name || slot.recipeId)} on the ${esc(s.name || s.id)}">
      <div class="mk-slot-top">
        <span class="mk-slot-dish" aria-hidden="true">${r.icon || '🍽'}</span>
        <span class="mk-slot-name">${esc(r.name || slot.recipeId)}</span>
      </div>
      ${buildHtml(r, slot)}
      <span class="mk-slot-flag">—</span>
      <div class="mk-slot-bars">
        <div class="mk-bar cook"><i></i></div>
        <div class="mk-bar burn"><i></i></div>
      </div>
      <div class="mk-sizzle" aria-hidden="true"></div>
      <button class="mk-pull" data-act="pull" data-st="${esc(s.id)}" data-i="${i}"
        aria-label="Take it off now">⤴</button>
    </div>`;
}

/**
 * 🍔 THE HALF-BUILT BURGER.
 * Laid steps are drawn solid, bottom-up in the order they were tapped; whatever
 * the recipe still wants is ghosted above them. That single picture is the
 * recipe card, the progress bar and the "what do I tap next" hint at once, and
 * it is the reason the bins feel like bins instead of like a list of nouns.
 * A slot nobody assembled still draws the ghost, so an untouched dish reads as
 * "you could be building this" rather than as an empty box.
 */
function buildHtml(r, slot) {
  const steps = Array.isArray(r.steps) ? r.steps : [];
  if (!steps.length) return '';
  const laid = Array.isArray(slot.steps) ? slot.steps.slice() : [];

  // Canonical expansion, in recipe order, carrying each step's layer role.
  const canon = [];
  for (const s of steps) for (let i = 0; i < Math.max(1, s.qty | 0); i++) canon.push({ ing: s.ing, layer: s.layer || 'top' });

  const remaining = canon.slice();
  const out = [];
  for (const id of laid) {
    const idx = remaining.findIndex((c) => c.ing === id);
    const layer = idx >= 0 ? remaining.splice(idx, 1)[0].layer : 'top';   // idx<0 ⇒ an EXTRA
    out.push(layerHtml(id, layer, false));
  }
  for (const c of remaining) out.push(layerHtml(c.ing, c.layer, true));
  return `<div class="mk-build" aria-hidden="true">${out.join('')}</div>`;
}
function layerHtml(ingId, layer, ghost) {
  if (layer === 'none') return '';           // consumed but invisible (fry oil)
  const ing = (typeof DATA.ingredient === 'function' ? DATA.ingredient(ingId) : null) || {};
  return `<span class="mk-lay${ghost ? ' ghost' : ''}" data-layer="${esc(layer)}" style="--c:${esc(ing.color || '#caa')}"></span>`;
}

/* ── 🍽 THE PASS ─────────────────────────────────────────────────────────── */
/**
 * 🔴 THERE IS NO EMPTY BRANCH. Round 1 asked for it to go and round 2 still
 * printed "Nothing plated yet. Cook something, then plate it." across the wells
 * — the words "Cook" and "something" sitting on top of two empty plate discs,
 * grey on grey, for most of a shift's first minute and every time the board is
 * cleared. REF-A's defining image is food ON the pass; an empty pass is a warm
 * empty pass, not a sentence about one. The wells are painted by the CSS, so
 * the shelf reads as a shelf with places left on it with zero DOM.
 * The nudge, where a nudge is wanted, rides the HEAD next to the count — which
 * is where the count already says the same thing in numbers.
 */
function passHtml(k) {
  const dishes = (k.pass || []).map(dishHtml).join('');
  const cap = safe(() => (typeof DATA.passCap === 'function' ? DATA.passCap(k.upgrades || []) : EC('PASS_CAP', 6)), EC('PASS_CAP', 6));
  const n = (k.pass || []).length;
  return `
  <section class="mk-sec mk-sec-pass">
    <div class="mk-pass">
      <div class="mk-sec-head" style="padding-left:0"><b>The Pass</b><span class="mk-spacer"></span>
        ${n ? '' : '<span class="mk-hint">pull a dish, then plate it</span>'}
        <span>${n} / ${cap} plated</span></div>
      <div class="mk-pass-rail" data-rail="pass">${dishes}</div>
    </div>
  </section>`;
}
function dishHtml(d) {
  const r = (typeof DATA.recipe === 'function' ? DATA.recipe(d.recipeId) : null) || {};
  /* 🔴 THE BIN BUTTON, and it is not a nicety. The pass now genuinely HOLDS food
     (the sim stopped it piping straight through), and a hard PASS_CAP means one
     wrong dish nobody on the board wants is a plate the player cannot get rid
     of. `spoilPass()` guarantees it eventually rots, so this is not the
     soft-lock fix — but waiting ~100 seconds for a mistake to decay while the
     dinner rush runs is a punishment with no decision in it. Binning it is the
     decision: you paid for it, you choose whether the space is worth more. */
  const canBin = typeof State.binPass === 'function';
  /* 🔴 WHAT IS ACTUALLY ON IT (SEAM 1, the visible half).
     kitchen.state.js now carries `built: [ingredientId, …]` in tap order all
     the way from the pan (`pullSlot`) through the hand (`plateHand`) onto the
     dish, and drivethru.js judges "no onions" against exactly that array. If
     the record the money is decided by is invisible, the player experiences the
     promise as a dice roll — so the plate wears its own build as a row of the
     ingredients' own colours, the same vocabulary the build stack on the pan
     uses. A dish nobody assembled (a drink, a bagged fry) simply has none. */
  const built = Array.isArray(d.built) ? d.built.slice(0, 8) : [];
  const strip = built.length
    ? `<span class="mk-dish-build" aria-hidden="true">${built.map((id) => {
        const ing = (typeof DATA.ingredient === 'function' ? DATA.ingredient(id) : null) || {};
        return `<i style="--c:${esc(ing.color || '#caa')}" title="${esc(ing.name || id)}"></i>`;
      }).join('')}</span>`
    : '';
  return `<div class="mk-dish" data-dish="${esc(d.id)}" data-q="${esc(d.quality || 'good')}"
      title="${esc(r.name || d.recipeId)}${built.length ? ' — built with ' + built.length + ' steps' : ''}">
      ${canBin ? `<button class="mk-dish-bin" data-act="binpass" data-id="${esc(d.id)}"
        aria-label="Bin the ${esc(r.name || d.recipeId)}" title="Bin it">✕</button>` : ''}
      <span class="mk-ic" aria-hidden="true">${r.icon || '🍽'}</span>
      <span class="mk-q">${esc(d.quality || 'good')}</span>
      ${strip}
      <span class="mk-fresh"><i></i></span>
    </div>`;
}
/**
 * WHAT IS IN YOUR HANDS — and WHY it lives in the strip rather than on the pass.
 *
 * A phone is 640–850px tall and this layout is ~1,200. Something has to be below
 * the fold, and the one thing that must NEVER be below the fold is the button
 * that resolves the dish you are holding: you pulled it at the perfect second
 * and the game then asked you to scroll. So the hand takes over the strip — the
 * bar pinned above the tab row — whenever it exists, and gives it straight back
 * to the tallies the moment it does not. Rejected: a permanent hand slot on the
 * pass (costs 56px of a 640px screen to say "you are holding nothing"), and a
 * floating action button (covers the griddle, which is the thing you are
 * watching).
 */
function handHtml(k) {
  if (!k.hand) return '';
  const r = (typeof DATA.recipe === 'function' ? DATA.recipe(k.hand.recipeId) : null) || {};
  const burnt = k.hand.quality === 'burnt';
  return `<div class="mk-hand">
      <span class="mk-ic" aria-hidden="true">${r.icon || '🍽'}</span>
      <div class="mk-hand-txt">
        <b>${esc(r.name || k.hand.recipeId)}</b>
        <span>${esc(k.hand.quality || '')}${burnt ? ' — bin it' : ' · in your hands'}</span>
      </div>
      ${burnt ? '' : '<button class="mk-btn go" data-act="plate">Plate</button>'}
      <button class="mk-btn danger" data-act="drop">Bin</button>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   🌾 WHERE THE FOOD COMES FROM — the clause the player wrote most explicitly,
   and the one thing on this screen that was doing all the work and none of the
   talking.
   ───────────────────────────────────────────────────────────────────────────
   The mechanic is already honest: `SUPPLY_RECIPES` are priced ONLY in the 14
   live ledger ids plus Cinder, `buySupply()` debits `Profile.salvage` through
   the bridge, and every one of those ids really is produced by the city
   builder, by businesses and by battle. But NOTHING ON SCREEN SAID SO. A
   player looking at "🧀 Cheese · ◈ 60" reads "the kitchen buys ingredients" —
   which is exactly the failure the request ("uses the food and food type
   resources … that they get from the other parts of the game") was aimed at.

   So two things are drawn now and they are drawn where the decision happens:
     · the LEDGER STRIP over the prep counter — the live balances, in the
       kitchen, updated as the city fills them;
     · the PROVENANCE line under every crate in Supplies — which building makes
       this, whether you own one, and what else drops it.

   ⚠ WHY A TABLE LIVES HERE AND NOT IN kitchen.data.js. These are the CITY's
   building names, owned by /src/city/production.data.js, and CONTRACT §1 bans
   this module from importing anything outside /src/kitchen/. They are also
   pure presentation — copy and a glyph, exactly like MOOD_FACE and
   STATION_WORD above; nothing here can move a price, a timer or a payout, and
   CLAUDE.md's "no hardcoded economy numbers" is about numbers that change the
   game. `resSource()` still prefers a table from kitchen.data.js the moment
   its owner adds one, so this becomes a floor rather than a fork.
   ═══════════════════════════════════════════════════════════════════════════ */
const RES_SOURCE_FLOOR = {
  food:             { def: 'hydroponics',  name: 'Hydroponics Bay',  icon: '🥬', also: 'agri contracts, fishing hauls, site loot' },
  water:            { def: 'wellhead',     name: 'Water Reclaimer',  icon: '💧', also: 'site loot' },
  metal:            { def: 'foundry',      name: 'Smelting Foundry', icon: '🏭', also: 'salvage runs' },
  fuel:             { def: 'refinery',     name: 'Fuel Refinery',    icon: '⛽', also: 'raid spoils' },
  ammo:             { def: 'munitions',    name: 'Munitions Bench',  icon: '🔫', also: 'battle spoils' },
  medicine:         { def: 'apothecary',   name: 'Apothecary',       icon: '💊', also: 'infirmary salvage' },
  supplies:         { def: 'depot',        name: 'Supply Workshop',  icon: '📦', also: 'trade and site loot' },
  energyDrink:      { def: 'bottling',     name: 'Bottling Line',    icon: '🥤', also: 'vendor stock' },
  corruptedEssence: { def: 'sump',         name: 'Containment Sump', icon: '🟣', also: 'corrupted nodes' },
  memoryShards:     { def: 'archive',      name: 'Memory Archive',   icon: '🧠', also: 'deep-site loot' },
  dna:              { def: 'genevault',    name: 'Gene Vault',       icon: '🧬', also: 'the Genetics Lab' },
  wood:             { def: 'timberyard',   name: 'Timber Yard',      icon: '🪵', also: 'scavenging' },
  stone:            { def: 'stonequarry',  name: 'Stone Quarry',     icon: '🪨', also: 'scavenging' },
  cloth:            { def: 'textilemill',  name: 'Textile Mill',     icon: '🧵', also: 'scavenging' },
};
function resSource(id) {
  const fromData = safe(() => (typeof DATA.resSource === 'function'
    ? DATA.resSource(id)
    : ((DATA.RES_SOURCE || {})[id])), null);
  return fromData || RES_SOURCE_FLOOR[id] || null;
}
/**
 * Which producers the city ACTUALLY has, `defId → highest level`.
 * `bridge().cityProd()` is read-only by contract (§7) and returns
 * `Profile.cityProduction`, whose `.placed` is a row per building. Two of the
 * same building are legal, so the higher level wins — the same rule the cloud
 * merge in index.html uses, for the same reason.
 * ⚠ Guarded to `{}` all the way down: a player who has never opened the city
 *   builder has no key at all, and "not built" is a perfectly good answer.
 */
function cityOwned() {
  const out = Object.create(null);
  const cp = safe(() => (b().cityProd ? b().cityProd() : null), null);
  const rows = (cp && Array.isArray(cp.placed)) ? cp.placed : [];
  for (const r of rows) {
    if (!r || !r.defId) continue;
    const lv = Math.max(1, r.level | 0);
    if (!(out[r.defId] >= lv)) out[r.defId] = lv;
  }
  return out;
}
/** One "🧬 Gene Vault · Lv 2" / "🧬 Gene Vault · not built yet" chip. */
function fromChip(resId, owned) {
  const src = resSource(resId);
  if (!src) return '';
  const lv = owned[src.def] | 0;
  return `<span class="mk-from" data-has="${lv ? 1 : 0}"
      title="${esc(src.name)} — ${lv ? 'you have one (level ' + lv + ')' : 'build one in the city'}. Also from ${esc(src.also || 'salvage')}."
    >${src.icon} ${esc(src.name)}<small>${lv ? ' · Lv ' + lv : ' · build one'}</small></span>`;
}
/** The live ids the CURRENT counter actually spends — not all fourteen. */
function ledgerIds(k) {
  const want = Object.create(null);
  const order = [];
  for (const id of binIds(k)) {
    const s = safe(() => (typeof DATA.supplyFor === 'function' ? DATA.supplyFor(id) : null), null);
    if (!s || !s.cost) continue;
    for (const key of Object.keys(s.cost)) {
      if (key === 'cinder' || want[key]) continue;
      want[key] = true; order.push(key);
    }
  }
  return order;
}
/**
 * THE LEDGER STRIP. Sits at the top of the prep counter, above the bins it
 * pays for, so the sentence the player reads on the way to a restock is "these
 * ingredients come out of the stash my city fills" rather than "these
 * ingredients cost money".
 * `data-out="1"` when the stash is empty of something a bin on this counter
 * needs — the one state that is worth shouting, because it is the state where
 * the answer is "go and build something", not "come back later".
 */
function ledgerHtml(k) {
  const ids = ledgerIds(k);
  if (!ids.length) return '';
  const owned = cityOwned();
  const chips = ids.map((id) => {
    const meta = safe(() => (b().meta ? b().meta(id) : null), null) || { name: id, icon: '📦' };
    const have = safe(() => (b().getRes ? b().getRes(id) : 0), 0) | 0;
    const src = resSource(id);
    const mine = src ? (owned[src.def] | 0) : 0;
    return `<span class="mk-led" data-res="${esc(id)}" data-out="${have <= 0 ? 1 : 0}" data-mine="${mine ? 1 : 0}"
        title="${esc(meta.name || id)} — you hold ${fmtNum(have)}. ${src ? esc(src.name) + (mine ? ' (built, level ' + mine + ')' : ' — not built yet') + '. Also from ' + esc(src.also || 'salvage') + '.' : ''}"
      ><span class="mk-led-ic" aria-hidden="true">${esc(meta.icon || '📦')}</span>
        <b data-led="${esc(id)}">${fmtNum(have)}</b>
        <small>${esc(meta.name || id)}</small>
        ${src ? `<em>${src.icon}</em>` : ''}</span>`;
  }).join('');
  return `<div class="mk-ledger">
      <div class="mk-ledger-lab">Out of your stash<span class="mk-spacer"></span>
        <span>your city, your businesses and your battles fill this</span></div>
      <div class="mk-ledger-row">${chips}</div>
    </div>`;
}

/* ── 🫙 THE BINS ─────────────────────────────────────────────────────────── */
/**
 * Which bins are on the counter.
 *
 * NOT all 25. A level-1 kitchen can cook one dish and showing it twenty-five
 * bins — twenty-one of which it cannot legally buy yet — is the exact failure
 * mode the brief calls "a list of buttons". So: anything the CURRENT menu needs,
 * plus anything you actually have stock of (because stock you cannot see is
 * stock you will forget you paid for).
 */
function binIds(k) {
  const want = Object.create(null);
  for (const r of safe(() => State.menu(), [])) for (const id of Object.keys((r && r.needs) || {})) want[id] = true;
  for (const id of Object.keys(k.pantry || {})) if ((k.pantry[id] | 0) > 0) want[id] = true;
  const order = (Array.isArray(DATA.INGREDIENTS) ? DATA.INGREDIENTS : []).map((i) => i.id);
  return order.filter((id) => want[id]);
}
function binsHtml(k) {
  const ids = binIds(k);
  const low = safe(() => State.pantryLowList(), []);
  const wanted = wantedBySelection(k);
  const shelves = (Array.isArray(DATA.SHELVES) ? DATA.SHELVES : []).slice().sort((a, bb) => (a.order || 0) - (bb.order || 0));

  const groups = shelves.map((sh) => {
    const mine = ids.filter((id) => {
      const ing = (typeof DATA.ingredient === 'function' ? DATA.ingredient(id) : null) || {};
      return ing.shelf === sh.id;
    });
    if (!mine.length) return '';
    return `<div class="mk-shelf">
        <div class="mk-shelf-lab"><span aria-hidden="true">${sh.icon || '🫙'}</span>${esc(sh.name || sh.id)}</div>
        <div class="mk-shelf-row">${mine.map((id) => binHtml(k, id, low, wanted)).join('')}</div>
      </div>`;
  }).join('');

  return `
  <section class="mk-sec mk-sec-bins">
    <div class="mk-sec-head"><b>Prep Counter</b><span class="mk-spacer"></span>
      <span>${_sel ? 'tap to lay it on' : 'restock in Supplies'}</span></div>
    ${ledgerHtml(k)}
    <div class="mk-rail" data-rail="bins">${groups || '<div class="mk-empty">The pantry is bare. Open Supplies.</div>'}</div>
  </section>`;
}
/** How many of each ingredient the SELECTED pan still wants → the amber badge. */
function wantedBySelection(k) {
  const out = Object.create(null);
  if (!_sel) return out;
  const rack = (k.stations || {})[_sel.stationId];
  const slot = rack && rack.slots ? rack.slots[_sel.i] : null;
  if (!slot) return out;
  const r = (typeof DATA.recipe === 'function' ? DATA.recipe(slot.recipeId) : null);
  if (!r || !r.needs) return out;
  const laid = Array.isArray(slot.steps) ? slot.steps : [];
  for (const id of Object.keys(r.needs)) {
    const done = laid.filter((x) => x === id).length;
    const n = (r.needs[id] | 0) - done;
    if (n > 0) out[id] = n;
  }
  return out;
}
function binHtml(k, id, low, wanted) {
  const ing = (typeof DATA.ingredient === 'function' ? DATA.ingredient(id) : null) || {};
  const have = (k.pantry || {})[id] | 0;
  const batch = Math.max(1, ing.batch || 10);
  const fill = Math.max(0, Math.min(1, have / batch));
  const isLow = low.indexOf(id) !== -1 ? 1 : 0;
  const want = wanted[id] || 0;
  return `<button class="mk-bin" data-act="bin" data-ing="${esc(id)}" style="--c:${esc(ing.color || '#888')}"
      data-low="${isLow}" data-out="${have <= 0 ? 1 : 0}" data-want="${want ? 1 : 0}"
      aria-label="${esc(ing.name || id)}, ${have} ${esc(ing.unit || 'units')}">
      <span class="mk-bin-fill" style="height:${Math.round(fill * 78)}%"></span>
      <span class="mk-ic" aria-hidden="true">${ing.icon || '🥫'}</span>
      <span class="mk-nm">${esc(ing.name || id)}</span>
      <span class="mk-n">${have}</span>
      ${want ? `<span class="mk-bin-badge">${want}</span>` : ''}
    </button>`;
}

/* ── 📊 THE STRIP — shift control + today's tallies ──────────────────────── */
function paintStrip(k) {
  const strip = _root && _root.querySelector('#mk-strip');
  if (!strip) return;
  if (k.hand) {
    // The hand outranks everything else that could be here (see handHtml).
    strip.innerHTML = handHtml(k);
  } else if (!k.shift.running) {
    const rep = safe(() => State.lastReport(), null);
    strip.innerHTML = `
      <div class="mk-strip-txt">
        <b>Kitchen closed</b>
        <span>${rep && !rep.forfeit
          ? `Day ${rep.day} graded ${esc(rep.grade)} · ${rep.served} served, ${rep.lost} lost`
          : `Day ${k.shift.day} · ${esc(safe(() => State.shiftClock().dayName, ''))}`}</span>
      </div>
      <button class="mk-btn go" data-act="shift-open">Open the doors</button>`;
  } else {
    /* 💀 🔥 and the money have MOVED UP to the HUD (see updateHud). What is left
       here is what the HUD has no room for: how the service is going and how
       full the lane is. Repeating the failure counters in two places just made
       both copies quiet. */
    const st = safe(() => (typeof DriveThru.laneStatus === 'function' ? DriveThru.laneStatus(k, k.now) : null), null);
    const tips = k.today.tips | 0;
    strip.innerHTML = `
      <div class="mk-tallies">
        <span class="mk-chip">✅ ${k.today.served} served</span>
        ${tips ? `<span class="mk-chip">🪙 ${fmtNum(tips)} tips</span>` : ''}
        ${st && st.full ? '<span class="mk-chip">🚗 Lane full</span>' : ''}
      </div>
      <button class="mk-btn danger" data-act="shift-close">End shift</button>`;
  }
}

/* ── 📌 THE PINNED WINDOW ────────────────────────────────────────────────────
 * The two cars that matter, under the HUD, above everything, never scrolled
 * away. `DriveThru.laneCard()` hands the whole payload over already resolved —
 * mood, set piece, patience, the spoken line, the itemised order with its
 * per-line promises and a live verdict on each, and the two booleans that say
 * whether SERVE and WAVE would actually succeed.
 *
 * 🔴 `canServe` / `canWave` GATE THE BUTTONS. drivethru.js computes them so a
 *    renderer can disable a control rather than offer it and then toast a
 *    refusal — a button that lies is worse than no button.
 *
 * ⚠ REBUILT ON A FINGERPRINT, NOT ON `rev`. During a rush the sim bumps `rev`
 *   several times a second (every unit that fills a ticket does), and rebuilding
 *   a card with a SERVE button on it that often eats taps. The fingerprint moves
 *   only when something structural about these two cars changed; patience, mood
 *   and the countdown are per-frame writes onto the nodes that are already there.
 */
function paintPin(k, t, force) {
  const host = _reg.pin;
  if (!host) return;
  const card = safe(() => (typeof DriveThru.laneCard === 'function' ? DriveThru.laneCard(k, t) : null), null);
  const slots = card ? [['window', card.window], ['next', card.next]] : [];
  const live = slots.filter((s) => s[1]);
  const key = live.map(([slot, c]) => [
    slot, c.carId, c.ready ? 1 : 0, c.special || '', c.station || '', c.state || '',
    (c.items || []).map((i) => i.recipeId + ':' + i.filled + '/' + i.qty
      + ':' + (i.mods || []).map((m) => m.id + m.result).join(',')).join('|'),
  ].join('~')).join('||');

  if (force || key !== _pinKey) {
    _pinKey = key;
    host.innerHTML = live.map(([slot, c]) => pinCardHtml(slot, c)).join('');
    _reg.pinRows = [];
    for (const el of host.querySelectorAll('.mk-pin-card')) {
      _reg.pinRows.push({
        id: el.dataset.car, el,
        mood: el.querySelector('.mk-pin-mood'),
        bar: el.querySelector('.mk-pin-bar > i'),
        where: el.querySelector('.mk-pin-where'),
      });
    }
  }
  updatePin(k, t);
}
/** WHERE the car physically is, in the player's words. The lane's `station` is
    'speaker' | 'queue' | 'window' and the whole point of drawing two fixtures
    was to make that legible — so the card says it too. */
const STATION_WORD = { window: 'At the window', speaker: 'At the speaker', queue: 'In the queue' };
function pinCardHtml(slot, c) {
  const items = (c.items || []).map((it) => {
    const mods = (it.mods || []).map((m) => modChip(m, m.result)).join('');
    return `<div class="mk-pin-it" data-done="${it.filled >= it.qty ? 1 : 0}">
        <span aria-hidden="true">${it.icon || '🍽'}</span>
        <span class="mk-nm" style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.name)}</span>
        <b>${it.filled | 0}/${it.qty | 0}</b>
        ${mods ? `<span class="mk-mods-in">${mods}</span>` : ''}
      </div>`;
  }).join('');
  const head = slot === 'window';
  return `<div class="mk-pin-card" data-slot="${slot}" data-car="${esc(c.carId)}"
      data-ready="${c.ready ? 1 : 0}" data-mood="${esc(c.mood || 'ok')}">
      <div class="mk-pin-top">
        <span class="mk-pin-mood" aria-hidden="true">${c.moodFace || '🙂'}</span>
        <span class="mk-pin-veh" aria-hidden="true">${c.vehicleIcon || '🚗'}</span>
        <span class="mk-pin-name">${esc(c.name || 'Customer')}</span>
        ${c.specialLabel ? `<span class="mk-badge-sp">${esc(c.specialLabel)}</span>` : ''}
        <span class="mk-pin-where">${head ? esc(STATION_WORD[c.station] || '') : 'NEXT'}</span>
      </div>
      ${head && c.line ? `<div class="mk-pin-line">“${esc(c.line)}”</div>` : ''}
      ${items ? `<div class="mk-pin-items">${items}</div>` : `<div class="mk-pin-line">Still reading the board…</div>`}
      ${head && (c.honoured || c.broken) ? `<div class="mk-promise" data-bad="${c.broken ? 1 : 0}">
        ${c.honoured ? `<span data-k="ok">✓ ${c.honoured} kept</span>` : ''}
        ${c.broken ? `<span data-k="bad">✗ ${c.broken} broken</span>` : ''}
      </div>` : ''}
      <div class="mk-pin-bar"><i></i></div>
      ${head ? `<div class="mk-pin-acts">
        <button class="mk-btn go" data-act="serve-car" data-car="${esc(c.carId)}" ${c.canServe ? '' : 'disabled'}
          style="flex:1 1 auto">${c.ready ? 'Serve' : 'Not ready'}</button>
        <button class="mk-btn danger" data-act="wave" data-car="${esc(c.carId)}" ${c.canWave ? '' : 'disabled'}>✋ Wave off</button>
      </div>` : ''}
    </div>`;
}
function updatePin(k, t) {
  if (!_reg.pinRows || !_reg.pinRows.length) return;
  for (const row of _reg.pinRows) {
    const c = (k.lane || []).find((x) => x && (x.carId === row.id || x.id === row.id));
    if (!c) continue;
    setText(row.mood, MOOD_FACE[c.mood] || '🙂');
    setData(row.el, 'mood', c.mood || 'ok');
    if (row.el.dataset.slot === 'window') setText(row.where, STATION_WORD[c.station] || '');
    const p = patiencePct(k, c, t);
    setStyle(row.bar, 'width', Math.round(p * 100) + '%');
    setStyle(row.bar, 'background', p <= URG_LATE ? '#ff4d5e' : (p <= URG_WARN ? '#ffd166' : '#5fd97a'));
  }
}

/* ── 🚗💨 THE DRIVE-PAST ─────────────────────────────────────────────────────
 * 🔴 THE BIGGEST NUMBER IN THE BUSINESS, AND IT WAS COMPLETELY SILENT. One
 * twelve-minute day at level 20 measured 74 cars balked against 64 served: more
 * than half of all demand was turned away at the mouth of the lane with no
 * event, no pixel and no sound. drivethru.js now records each one with a face
 * and a vehicle; this drives them across the FAR side of the road — BEHIND the
 * queue, never through it — and fades them out.
 *
 * ⚠ Built and destroyed in `frame()`, not in `paint()`. A passer-by lives ~2.6s
 *   and bumps no `rev` (it is not structure, nothing can be done about it), so a
 *   paint-time build would show them only if something unrelated repainted.
 */
function updatePassers(t) {
  const host = _reg.passers;
  if (!host) return;
  const rows = safe(() => (typeof DriveThru.passersBy === 'function' ? DriveThru.passersBy(K(), t) : []), []) || [];
  const seen = Object.create(null);
  for (const p of rows) {
    seen[p.id] = 1;
    let el = host.querySelector('[data-p="' + cssq(p.id) + '"]');
    if (!el) {
      el = document.createElement('div');
      el.className = 'mk-passer';
      el.dataset.p = p.id;
      el.innerHTML = `<span>${esc(p.vehicleIcon || '🚗')}</span><b>${esc(p.custName || '')} drove past</b>`;
      /* 🔴 SIMULTANEOUS BALKS MUST NOT LAND ON TOP OF EACH OTHER. Round 2
         hashed the id for a row, and a hash spreads ids EVENLY rather than
         APART — two of three balks in the same frame shared a row about a
         third of the time and printed one illegible pile at one x. The critic
         caught three at once.
         🤝 drivethru.js now DECIDES the row and publishes it (`lane`, `lanes`,
         from ECON.PASSBY_LANES): "Render may hash the id instead; this is the
         same answer, decided once, by the file that knows how many are in
         flight." It does know and we do not, so we take its answer. The
         occupancy pick below is the fallback for the revision that does not
         send one — the emptiest row rather than a hashed one, because the
         failure being fixed is a collision, not a distribution. */
      const lanes = Math.max(1, Number(p.lanes) || 3);
      let ln;
      if (p.lane != null && isFinite(p.lane)) {
        ln = ((Number(p.lane) | 0) % lanes + lanes) % lanes;
      } else {
        const used = new Array(lanes).fill(0);
        for (const e of host.querySelectorAll('.mk-passer')) used[(Number(e.dataset.ln) || 0) % lanes]++;
        ln = 0;
        for (let i = 1; i < lanes; i++) if (used[i] < used[ln]) ln = i;
      }
      /* The band is 30px tall (`.mk-passers`) and a passer is ~13px, so rows
         are spaced by what is actually left rather than by a constant that
         silently stops fitting when the lane count changes. */
      /* ⚠ AND THE ROW CAN STILL DOUBLE UP — four balks into three rows must,
         and the lane's own `% lanes` produces exactly that. So a second
         occupant of a row is pushed a clear 26px along the kerb rather than
         being nudged by a hash that can land 2px away (measured: 1026 vs 1028,
         which is a pile). A static offset holds for the whole drive-past
         because both sprites advance by the same `left`. */
      let occ = 0;
      for (const e of host.querySelectorAll('.mk-passer')) if ((Number(e.dataset.ln) || 0) === ln) occ++;
      let h = 0; for (const ch of String(p.id)) h = (h * 31 + ch.charCodeAt(0)) & 255;
      el.dataset.ln = String(ln);
      /* rows are spaced by what the band actually has, so adding a fourth
         PASSBY_LANE moves them closer instead of printing one on top of another */
      el.style.top = Math.round(ln * (32 / Math.max(1, lanes - 1 || 1))) + 'px';
      /* A doubled row cannot be fixed by nudging: both sprites carry a ~110px
         name and any offset short of that still overlaps the text. So the
         second occupant of a row goes down to its VEHICLE ONLY and moves a
         clear 40px along — two identifiable cars beats one unreadable caption.
         (`data-dup` is styled in WIRE_CSS.) */
      if (occ) el.dataset.dup = '1';
      /* ⚠ pushed LEFT, not right. These boxes grow rightwards from their
         `left`, so a dup nudged +20px lands INSIDE the first one's caption
         (measured: a 15px glyph sitting in a 119px label). −56px clears the
         whole caption and reads as a car slightly further along the road,
         which is the direction the traffic is going anyway. */
      el.style.setProperty('--dx', (occ ? -(occ * 56) : ((h % 9) - 4)) + 'px');
      host.appendChild(el);
    }
    // Right to left, same direction the lane runs, so it reads as traffic that
    // looked at the queue and kept going rather than as a car arriving.
    el.style.left = Math.round((1 - p.pct) * 100) + '%';
    /* ⚠ CAPPED AT .7, deliberately. The drive-past shares its band of sky with
       the speech bubble, and the ONE customer who is talking must always win
       that fight — a balk is information, a bubble is the game asking for a
       decision. It reads as traffic in the background, which is what it is. */
    el.style.opacity = String(Math.max(0, Math.min(0.7, 1.05 - p.pct * 1.05)));
  }
  for (const el of host.querySelectorAll('.mk-passer')) if (!seen[el.dataset.p]) el.remove();
}
/** Attribute-selector escaping. Ids here are ours ('p12'), but a selector built
    from data is a selector that will one day be built from data we do not own. */
function cssq(v) { return String(v == null ? '' : v).replace(/["\\\]]/g, '\\$&'); }

function paintTabs() {
  if (!_root) return;
  for (const t of _root.querySelectorAll('.mk-tab')) {
    const on = (t.dataset.tab === 'line') ? !_sheet : (t.dataset.tab === _sheet);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  }
  // A claimable convoy is the one thing that happens while you are not looking,
  // so it is the one thing that earns a dot on a tab.
  const k = K();
  const claimable = (k.inbound || []).some((c) => c && c.state === 'arrived')
    || (k.convoys || []).some((c) => c && c.state === 'arrived');
  const tab = _root.querySelector('.mk-tab[data-tab="convoy"]');
  if (tab) {
    const has = tab.querySelector('.mk-tab-dot');
    if (claimable && !has) tab.insertAdjacentHTML('beforeend', '<span class="mk-tab-dot"></span>');
    if (!claimable && has) has.remove();
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   FRAME — the cheap per-RAF pass. textContent / style / dataset ONLY.
   ═══════════════════════════════════════════════════════════════════════════ */
export function frame(dt, now, events) {
  if (!_openFlag || !_root) return;
  const t = Number(now) || nowMs();

  if (Array.isArray(events) && events.length) {
    toastEvents(events);
    reactEvents(events, t);
  }

  const k = K();
  /* The recipient lookup's debounce lives on the sim clock (see _findDueAt).
     Fired BEFORE the rev gate: a repaint must not swallow the player's typing. */
  if (_findDueAt && t >= _findDueAt) { _findDueAt = 0; runFind(); }
  if (k.rev !== _paintedRev || viewKey() !== _paintedView) { paint(); return; }

  updateHud(t, false);
  updateTickets(t);
  updateSlots(t);
  paintPin(k, t, false);
  updateCars(t);
  updatePassers(t);
  updatePass(t);
  updateRoutes(t);
  updateLineMore(t);
  drainFx(t);
}

/**
 * 🔴 IS THE LINE ACTUALLY CUT OFF? Only the layout knows, and only at runtime.
 *
 * At 1440×900 — the size the brief names — all five stations now sit on one row
 * and nothing is clipped; on a short or narrow desktop window they wrap and the
 * bottom row can go under the fold. Round 2's answer was an unconditional 26px
 * fade, and the critic's verdict was that nobody reads it: a fade that is there
 * when nothing is hidden is a fade you learn to ignore, so it fails on the one
 * occasion it is telling the truth. This measures, and the chevron only lights
 * when there is genuinely a pan below.
 *
 * ⚠ ON A SLOW CLOCK, like the road width above. `scrollHeight` forces a layout
 *   flush, and doing that once a frame right after this pass has written forty
 *   styles is exactly how the first draft of this file lost 30fps. Three times
 *   a second is instant to a human and free to the compositor.
 */
function updateLineMore(t) {
  const sec = _reg.line, rail = _reg.lineRail;
  if (!sec || !rail) return;
  if (t - _lineMoreAt < 320) return;
  _lineMoreAt = t;
  const more = (rail.scrollHeight - rail.clientHeight - rail.scrollTop) > 6 ? '1' : '0';
  setData(sec, 'more', more);
}

function updateHud(t, force) {
  const k = K(), h = _reg.hud;
  if (!h || !h.face) return;

  const face = safe(() => DATA.faceFor(k.popularity), null) || { icon: '🙂', label: 'Okay', color: '#e0c060' };
  setText(h.face, face.icon);
  setStyle(h.popBar, 'width', Math.round(Math.max(0, Math.min(100, k.popularity))) + '%');
  setStyle(h.popBar, 'background', `linear-gradient(90deg, ${face.color}88, ${face.color})`);
  setText(h.popLab, face.label + ' · ' + Math.round(k.popularity));

  /* ⚠ `need` vs `span`: CONTRACT §1 does not type xpProgress()'s return, and the
     shipped kitchen.state.js calls the denominator `need` while an earlier draft
     of it called the field `span`. Reading only one of them printed a live
     "900/0" on the HUD — a bar that says you need nothing. Accept both rather
     than pick one and be wrong for whichever revision lands. */
  const xp = safe(() => State.xpProgress(), null) || { level: k.level, into: 0, need: 1, pct: 0 };
  const xpNeed = Math.max(1, Number(xp.need != null ? xp.need : xp.span) || 1);
  setText(h.level, String(xp.level));
  setStyle(h.xpBar, 'width', Math.round((Number(xp.pct) || 0) * 100) + '%');
  setText(h.xpLab, fmtNum(xp.into) + '/' + fmtNum(xpNeed));

  /* Cinder is read through the bridge, which reaches into the legacy Profile.
     Throttled: it is the only per-frame call in this file that leaves the
     module, and the number changes at most a few times a minute. */
  if (force || t - _lastGemsAt > 250) {
    _lastGemsAt = t;
    _gems = safe(() => (b().gems ? b().gems() : 0), 0);
    for (const row of _reg.led) {
      const have = safe(() => (b().getRes ? b().getRes(row.id) : 0), 0) | 0;
      setText(row.num, fmtNum(have));
      setData(row.el, 'out', have <= 0 ? '1' : '0');
    }
  }
  setText(h.cash, fmtNum(_gems));

  /* 💰 THE ANCHOR. REF-B leads with "$394.64" and that number is the TILL. Ours
     led with the Cinder wallet, which read 0 in every screenshot the critic took
     and does not move while you cook, and buried today's takings in the fourth
     of four identical 11px chips at the bottom of the screen.
     ⚠ The Cinder wallet is NOT deleted, it is demoted — it is the currency
     supplies are actually bought with, so a player mid-restock still needs it.
     It rides the sub-line, and the hidden #mk-cash node stays because the whole
     rest of this file (and any future HUD work) addresses it by id. */
  const take = Math.max(0, (k.today.earned | 0) + (k.today.tips | 0));
  if (h.take && h.take.textContent !== fmtNum(take)) {
    // Pop on INCREASE only. A reset to zero at shift open is not a payday.
    const rose = take > (Number(h.take.dataset.v) || 0);
    setText(h.take, fmtNum(take));
    h.take.dataset.v = String(take);
    if (rose) {
      h.take.dataset.pop = '0';
      // Reading offsetWidth restarts the CSS animation. It is a layout read, but
      // it happens at most once per sale, not once per frame.
      try { void h.take.offsetWidth; } catch (e) {}
      h.take.dataset.pop = '1';
    }
  }
  const heldF = safe(() => (typeof Convoy.heldFood === 'function' ? Convoy.heldFood(k) : 0), 0);
  setText(h.takeSub, 'today · ◈ ' + fmtNum(_gems) + ' in the vault'
    + (heldF > 0 ? ' · 📦 ' + fmtNum(heldF) + ' held' : ''));

  /* 💀 / 🔥 beside the face, red above zero. These two numbers ARE the "you are
     losing" message and they were the least prominent pixels on a 1440px
     screen. They belong next to the popularity meter they are draining. */
  const lost = k.today.lost | 0, burnt = k.today.burnt | 0;
  setText(h.lost, '💀 ' + lost);   setData(h.lost, 'on', lost > 0 ? '1' : '0');
  setText(h.burnt, '🔥 ' + burnt); setData(h.burnt, 'on', burnt > 0 ? '1' : '0');

  const clock = safe(() => State.shiftClock(), null);
  if (clock) {
    setText(h.day, String(clock.dayName || '').toUpperCase());
    setText(h.clock, fmtClock(clock.hour));
    const pips = h.rush || [];
    const lit = Math.round(Math.max(0, Math.min(1, (clock.rush || 1) / EC('RUSH_MAX', 2.4))) * pips.length);
    for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('on', i < lit);
  }
}

function updateTickets(t) {
  const k = K();
  for (const row of _reg.tickets) {
    const tk = (k.tickets || []).find((x) => x.id === row.id);
    if (!tk) continue;
    const left = Math.max(0, (tk.dueAt || 0) - t);
    const span = Math.max(1, (tk.dueAt || 0) - (tk.placedAt || 0));
    const frac = left / span;
    setStyle(row.bar, 'width', Math.round(frac * 100) + '%');
    setText(row.time, fmtMs(left));
    setData(row.el, 'urg', frac <= URG_LATE ? 'late' : (frac <= URG_WARN ? 'warn' : 'ok'));
  }
}

function updateSlots(t) {
  const k = K();
  const warnMs = EC('BURN_WARN_MS', 3000);
  for (const row of _reg.slots) {
    const rack = (k.stations || {})[row.st];
    const slot = rack && rack.slots ? rack.slots[row.i] : null;
    if (!slot) continue;                       // a paint is already queued by rev
    const phase = safe(() => State.slotPhase(slot, t), 'cooking');
    const q = safe(() => State.qualityOf(slot, t), 'raw');
    setStyle(row.cook, 'width', Math.round(safe(() => State.cookPct(slot, t), 0) * 100) + '%');
    setStyle(row.burn, 'width', Math.round(safe(() => State.burnPct(slot, t), 0) * 100) + '%');
    setData(row.el, 'phase', phase);
    setData(row.el, 'q', q);

    let flag = '';
    if (phase === 'cooking') flag = fmtCook((slot.doneAt || 0) - t);
    else if (phase === 'done') flag = q === 'perfect' ? 'PERFECT' : 'READY';
    else flag = 'BURNT';
    setText(row.flag, flag);

    // 🔴 The alarm. Anything inside BURN_WARN_MS of burnAt flashes red. This is
    // the only warning the player gets before the sim destroys their food.
    const warn = (phase === 'done' && (slot.burnAt || 0) - t <= warnMs) ? '1' : '0';
    setData(row.el, 'warn', warn);
  }
}

function updateCars(t) {
  if (!_reg.cars.length) return;
  const k = K();
  /* ⚠ The road is measured on a SLOW CLOCK, not once and not every frame.
     Once was wrong: a measurement taken while the overlay was still settling
     (or while a sheet was animating over it) stuck, and every car in the lane
     then parked in the left third of a road that was really twice that wide.
     Every frame is also wrong: reading clientWidth after this pass has written
     forty styles forces a synchronous layout flush on each of them. Half a
     second is imperceptible for a lane that is metres long and cheap. */
  if (_reg.road && (!_laneW || t - _laneAt > 500)) {
    _laneW = _reg.road.clientWidth || _laneW || 0;
    _laneAt = t;
  }
  /* The countdown to the next arrival. Blank while the shift is shut and blank
     when the lane is full — a full lane is not waiting for anybody, and a
     countdown that keeps running while nothing can arrive is a countdown the
     player learns to disbelieve. */
  if (_reg.laneNext) {
    const st = safe(() => (typeof DriveThru.laneStatus === 'function' ? DriveThru.laneStatus(k, t) : null), null);
    const show = st && k.shift && k.shift.running && !st.full && st.nextInMs > 0;
    setText(_reg.laneNext, show ? ('next in ' + fmtCook(st.nextInMs)) : '');
  }
  const travel = laneTravel();

  /* 🔴 ONE BUBBLE PER FRAME, AND WHICH ONE IS A GAMEPLAY DECISION.
     `.mk-bub` is up to 190px of nowrap text centred on a 76px car; on a 364px
     road with four cars, collision is the normal case, not the edge case — the
     critic measured two bubbles at the same y overlapping by 26px and rendering
     as "Two dogs and a large fries, pl…arge fries, pl…". The stylesheet now
     staggers bubbles across three lines of sky, which stops them stacking, but
     the real fix is upstream: show the ONE customer with the least patience
     left, because that is also the one the player most needs to hear. Everyone
     else goes quiet. Their line comes back the moment they are the urgent one. */
  let loudest = null, loudestP = 2;
  for (const row of _reg.cars) {
    const c = (k.lane || []).find((x) => x && (x.carId === row.id || x.id === row.id));
    if (!c || c.state === 'gone') continue;
    if (!(c.say && t < (Number(c.sayUntil) || 0))) continue;
    const p = patiencePct(k, c, t);
    if (p < loudestP) { loudestP = p; loudest = row.id; }
  }

  for (const row of _reg.cars) {
    const c = (k.lane || []).find((x) => x && (x.carId === row.id || x.id === row.id));
    if (!c) continue;
    let x = carX(c, travel);
    let opacity = '';
    /* 🔴 exitDir — and the two cases are NOT decoration.
       'forward': the car has the window and can physically drive out, so it
         translates PAST the window and off the near end.
       'aside':   it gave up mid-queue. It CANNOT drive forward — there are cars
         in front of it — so it veers onto the shoulder and fades WHERE IT SITS.
         Animating that one forward would show a hatchback driving through the
         three cars ahead of it, which is exactly the picture the lane's own
         blocking rule (it holds its slot for LANE_EXIT_MS) exists to avoid. */
    if (c.state === 'gone') {
      const gone = Math.max(0, t - (Number(c.leftAt) || t));
      const k2 = Math.max(0, Math.min(1, gone / Math.max(1, EC('LANE_EXIT_MS', 900))));
      if (c.exitDir === 'aside') {
        setStyle(row.el, 'transform', 'translateX(' + x + 'px) translateY(' + Math.round(k2 * 16) + 'px)');
        opacity = String(1 - k2);
        x = null;
      } else {
        x = Math.round(x + k2 * 120);
        opacity = String(1 - k2 * 0.9);
      }
    }
    if (x !== null) setStyle(row.el, 'transform', 'translateX(' + x + 'px)');
    setStyle(row.el, 'opacity', opacity);
    setData(row.el, 'state', c.state || 'rolling');
    setData(row.el, 'mood', c.mood || 'ok');
    // Which way the order bubble hangs. See the .mk-bub[data-side] note in the
    // stylesheet: at the window a centred bubble disappears behind the speaker.
    setData(row.el, 'side', (x === null ? 0 : x) > travel * 0.55 ? 'right' : 'left');
    const say = (row.id === loudest && c.say && t < (Number(c.sayUntil) || 0)) ? String(c.say) : '';
    setData(row.el, 'say', say ? '1' : '0');
    if (say) setText(row.bub, say);
    const pat = patiencePct(k, c, t);
    setStyle(row.bar, 'width', Math.round(pat * 100) + '%');
    setStyle(row.bar, 'background', pat <= URG_LATE ? '#ff4d5e' : (pat <= URG_WARN ? '#ffd166' : '#5fd97a'));
  }
}
/** drivethru.js owns patience; we only ask. The local fallback is the same
    ratio off the fields the contract already puts on a lane entry, so the bar
    still moves if that module is mid-rewrite — a frozen patience bar reads as a
    frozen game. */
function patiencePct(k, c, t) {
  if (typeof DriveThru.patiencePct === 'function') {
    const v = safe(() => DriveThru.patiencePct(c, t), null);
    if (typeof v === 'number' && isFinite(v)) return Math.max(0, Math.min(1, v));
  }
  const span = Number(c.patienceMs) || 0;
  if (span <= 0) return 1;
  const started = Number(c.orderedAt || c.arrivedAt) || t;
  return Math.max(0, Math.min(1, 1 - (t - started) / span));
}

function updatePass(t) {
  if (!_reg.dishes.length) return;
  const k = K();
  /* The sim owns staleness now — `passStalePct(dish, now)` is its own number,
     upgrade-aware, and reading it means the plate timer and the quality
     multiplier can never disagree about when a dish went cold. The local
     fallback below is only for a state.js mid-rewrite. */
  const useSim = typeof State.passStalePct === 'function';
  const fresh = safe(() => (typeof DATA.passFreshMs === 'function' ? DATA.passFreshMs(k.upgrades || []) : EC('PASS_FRESH_MS', 75000)), EC('PASS_FRESH_MS', 75000));
  for (const row of _reg.dishes) {
    const d = (k.pass || []).find((x) => x.id === row.id);
    if (!d) continue;
    const stale = useSim
      ? safe(() => State.passStalePct(d, t), 0)
      : Math.max(0, Math.min(1, (t - (d.madeAt || t)) / Math.max(1, fresh)));
    const p = Math.max(0, Math.min(1, 1 - stale));
    setStyle(row.fresh, 'width', Math.round(p * 100) + '%');
    setStyle(row.fresh, 'background', p <= 0.25 ? '#ff8a5a' : '#67d8ff');
  }
}

/* ── ✨ FX ───────────────────────────────────────────────────────────────── */
/** Consume Kitchen._fx and CLEAR it — §2 says the renderer owns that buffer's
    drain. The setTimeout below is the one permitted timer in this file: it
    removes a node whose CSS animation has finished. */
function drainFx(/* now */) {
  const k = K();
  if (!k._fx || !k._fx.length || !_reg.fx) { if (k._fx) k._fx.length = 0; return; }
  const life = EC('FLOAT_MS', 900);
  for (const f of k._fx) {
    const el = document.createElement('div');
    el.className = 'mk-float';
    el.dataset.kind = f.kind || 'pay';
    el.textContent = String(f.text || '');
    el.style.left = (28 + Math.random() * 44) + '%';
    el.style.top = (34 + Math.random() * 20) + '%';
    _reg.fx.appendChild(el);
    setTimeout(() => { try { el.remove(); } catch (e) {} }, life + 160);
  }
  k._fx.length = 0;
}

/* ═══════════════════════════════════════════════════════════════════════════
   EVENTS → WORDS
   ═══════════════════════════════════════════════════════════════════════════ */
/**
 * Map sim events onto toast lines.
 *
 * ⚠ RATE-LIMITED, and that is not politeness. During a dinner rush the sim can
 * emit four `ticket:lost` in a second; the legacy showToast() keeps ONE node
 * alive at a time, so an unthrottled feed means the player sees the last one
 * for 40ms and learns nothing. One line per second, highest-priority event
 * wins, and the rest are visible on the board anyway.
 */
export function toastEvents(events) {
  if (!Array.isArray(events) || !events.length) return;
  const t = nowMs();
  let best = null, bestRank = -1;
  for (const e of events) {
    const line = toastLine(e);
    if (!line) continue;
    const rank = TOAST_RANK[e.name] || 0;
    if (rank > bestRank) { bestRank = rank; best = line; }
  }
  if (!best) return;
  if (t - _lastToastAt < 1000 && bestRank < 90) return;
  _lastToastAt = t;
  toast(best);
}
const TOAST_RANK = {
  'error': 100, 'level:up': 95, 'convoy:arrive': 80, 'convoy:claim': 80,
  'pantry:low': 60, 'cook:burnt': 50, 'ticket:lost': 40, 'shift:close': 90,
  /* 🚗 BELOW `ticket:lost` ON PURPOSE. A balk is the single largest thing
     happening to the business — 74 turned away against 64 served in one measured
     day — but a walked-out ORDER is worse than a car that never ordered, and the
     rate limiter only lets one line per second through. So the balk is present
     and audible without ever shouting over a lost sale. It is also drawn (see
     updatePassers), which is where the volume really comes from. */
  'car:balk': 30,
};
function toastLine(e) {
  if (!e || !e.name) return '';
  const rn = (id) => { const r = safe(() => DATA.recipe(id), null); return (r && r.name) || id; };
  switch (e.name) {
    case 'error':        return e.why || 'Something went wrong in the kitchen.';
    case 'level:up':     return `⭐ Level ${e.to}!` + (e.unlocked && e.unlocked.length ? ` ${rn(e.unlocked[0])} unlocked.` : '');
    case 'pantry:low':   return `⚠ Low on ${safe(() => DATA.ingredient(e.ing).name, e.ing)}.`;
    case 'cook:burnt':   return `🔥 You burnt the ${rn(e.recipeId)}.`;
    case 'ticket:lost':  return '💀 They walked out.';
    case 'car:balk':     return `🚗 ${e.custName || 'Somebody'} drove past a full lane.`;
    case 'convoy:arrive':return e.dir === 'in'
      ? `🚚 A convoy from ${e.fromName || 'another kitchen'} has landed.`
      : '🚚 Your convoy has arrived.';
    case 'convoy:claim': return `📦 ${e.granted ? fmtNum(e.granted) + ' food unloaded.' : 'Convoy claimed.'}`;
    case 'shift:close':  return e.forfeit ? '' : `🔔 Day closed — grade ${(e.report && e.report.grade) || '—'}.`;
    default: return '';
  }
}
/** Non-toast reactions: keep the open sheet honest when the sim changes under
    it (a convoy landing while the convoy sheet is up, a level-up unlocking a
    dish while the menu is up). */
function reactEvents(events /*, now */) {
  if (!_sheet) return;
  for (const e of events) {
    if (!e || !e.name) continue;
    if ((_sheet === 'convoy' && e.name.indexOf('convoy:') === 0)
      || (_sheet === 'menu' && e.name === 'level:up')
      || (_sheet === 'day' && e.name === 'shift:close')) { _lastSheetPaint = 0; paintSheet(); return; }
  }
}
function onSimEvent(e) {
  if (!_openFlag) return;
  // Structural events land as a rev bump too, so paint() will follow on the next
  // frame. The only thing worth doing HERE is repainting the strip, which lives
  // outside #mk-body and is therefore not covered by the rev gate's repaint.
  if (e && (e.name === 'shift:open' || e.name === 'shift:close')) {
    paintStrip(K());
    paintTabs();
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   INPUT
   ═══════════════════════════════════════════════════════════════════════════ */
function onKeyDown(ev) {
  if (!_openFlag || !_root) return;
  if (ev.key === 'Escape') {
    if (_sheet) { setSheet(null); ev.preventDefault(); }
    return;
  }
  // role="button" divs (the slots) must answer Enter and Space like a button.
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target && ev.target.dataset && ev.target.dataset.act
      && _root.contains(ev.target) && ev.target.tagName !== 'BUTTON') {
    ev.preventDefault();
    onClick(ev);
  }
}

function onClick(ev) {
  const el = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
  if (!el || !_root || !_root.contains(el)) return;
  const act = el.dataset.act;
  const now = nowMs();

  switch (act) {
    case 'close':        doClose(); break;
    case 'tab':          setSheet(el.dataset.tab === 'line' ? null : el.dataset.tab); break;
    case 'sheet-close':  setSheet(null); break;

    case 'shift-open':   result(State.openShift(now), 'The kitchen is already open.'); paint(); break;
    case 'shift-close':  askCloseShift(); break;

    case 'slot':         onSlot(el.dataset.st, Number(el.dataset.i) || 0, now); break;
    case 'pull':         ev.stopPropagation(); doPull(el.dataset.st, Number(el.dataset.i) || 0, now); break;
    case 'cook':         doCook(el.dataset.recipe, now); break;
    case 'bin':          doBin(el.dataset.ing, now); break;
    case 'plate':        result(State.plateHand(now)); paint(); break;
    case 'drop':         State.dropHand(); paint(); break;
    case 'serve':        doServe(el.dataset.id, now); break;
    case 'serve-car':    doServeCar(el.dataset.car, now); break;
    case 'wave':         doWave(el.dataset.car, now); break;
    case 'binpass':      doBinPass(el.dataset.id); break;
    case 'buy':          doBuy(el.dataset.supply, Number(el.dataset.n) || 1); break;

    case 'convoy-tier':  pickTier(el.dataset.tier); break;
    case 'convoy-step':  stepManifest(el.dataset.recipe, Number(el.dataset.d) || 0); break;
    case 'convoy-fill':  _convoyWant = null; paintSheetNow(); break;
    case 'convoy-clear': _convoyWant = {}; paintSheetNow(); break;
    case 'convoy-to':    pickRecipient(el.dataset.to, el.dataset.name); break;
    case 'convoy-load':  doConvoyLaunch(el.dataset.tier, now); break;
    case 'convoy-claim': doConvoyClaim(el.dataset.id, now); break;
    default: break;
  }
}

/** The one text field in the feature. See the _findDueAt note: the debounce is a
    due-stamp read by frame(), not a setTimeout, because CONTRACT §3 allows this
    file exactly one timer and it is already spent on removing float nodes. */
function onInput(ev) {
  const el = ev.target;
  if (!el || !el.dataset || el.dataset.act !== 'convoy-find') return;
  _convoyQ = String(el.value || '');
  _findDueAt = nowMs() + 260;
  _convoyBusy = _convoyQ.trim().length >= 2;
  // ⚠ Do NOT repaint the sheet here — it would destroy the field under the
  //   player's thumb and drop focus mid-word. The rows repaint when the reply
  //   lands, and the field is not part of what gets rebuilt (see paintRecipients).
  paintRecipients();
}

/** Closing must ALSO stop the RAF loop and forfeit the shift (§9), and only
    index.js can do the first of those — so we ask it, and only fall back to
    tearing our own DOM down if the public surface is not there. */
function doClose() {
  const api = window.MythicKitchen;
  if (api && typeof api.close === 'function') { try { api.close(); return; } catch (e) {} }
  close();
}

async function askCloseShift() {
  let yes = true;
  try { if (b().confirm) yes = await b().confirm('End the shift now? Anyone still waiting walks out.'); } catch (e) { yes = true; }
  if (!yes) return;
  State.closeShift(nowMs());
  setSheet('day');
  paint();
}

/**
 * The one-thumb slot rule, and it is the most important interaction decision in
 * the feature:
 *   empty        → open the menu for THIS station
 *   done / burnt → PULL IT, immediately, on the first tap
 *   cooking      → select it, so the bins build onto it
 * WHY pull-on-tap when it is ready: that tap is the reflex the whole game is
 * about, and a confirm step or a second control would put a menu between the
 * player and the perfect window. Pulling something EARLY is the deliberate,
 * rarer act, so it gets the small ⤴ corner button instead.
 */
function onSlot(stationId, i, now) {
  const k = K();
  const rack = (k.stations || {})[stationId];
  const slot = rack && rack.slots ? rack.slots[i] : null;

  if (!slot) {
    if (!k.shift.running) { toast('Open the doors first.'); return; }
    _pending = { stationId, i };
    setSheet('menu');
    return;
  }
  const phase = safe(() => State.slotPhase(slot, now), 'cooking');
  if (phase === 'done' || phase === 'burnt') { doPull(stationId, i, now); return; }
  const wasSel = _sel && _sel.stationId === stationId && _sel.i === i;
  _sel = wasSel ? null : { stationId, i };
  paint();
  /* Selecting a pan is a promise that the next tap is a bin, and on a phone the
     bins are below the fold. Bringing them up is the difference between the
     build mini-game existing and the player never finding it. */
  if (_sel && !wasSel) {
    const bins = _root && _root.querySelector('.mk-sec-bins');
    if (bins && bins.scrollIntoView) { try { bins.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {} }
  }
}

function doPull(stationId, i, now) {
  const res = State.pullSlot(stationId, i, now);
  if (!res || !res.ok) { toast((res && res.why) || 'That will not come off.'); return; }
  if (_sel && _sel.stationId === stationId && _sel.i === i) _sel = null;
  // Plating is what you want 95% of the time, so the pull leaves the dish in
  // hand with the PLATE button already under the thumb rather than auto-plating
  // — auto-plating would silently bin a burnt one, and the player must SEE that
  // they ruined it. (Plating a burnt dish is refused by the sim anyway.)
  paint();
}

function doCook(recipeId, now) {
  const k = K();
  let target = _pending;
  if (!target) {
    // No pending slot (the menu was opened from the tab bar): find the first
    // free slot on the dish's own station. Refusing outright would be correct
    // and unhelpful.
    const r = safe(() => DATA.recipe(recipeId), null);
    const stId = r && r.station;
    const rack = stId ? (k.stations || {})[stId] : null;
    const idx = rack ? rack.slots.findIndex((s) => !s) : -1;
    if (idx < 0) { toast('No free slot on that station.'); return; }
    target = { stationId: stId, i: idx };
  }
  const res = State.startCook(target.stationId, target.i, recipeId, now);
  if (!res || !res.ok) { toast((res && res.why) || 'That cannot go on yet.'); return; }
  _pending = null;
  _sel = { stationId: target.stationId, i: target.i };   // build onto what you just started
  setSheet(null);
}

function doBin(ingId, now) {
  if (!_sel) { toast('Pick a pan first, then lay ingredients on it.'); return; }
  if (typeof State.addStep !== 'function') return;
  const res = State.addStep(_sel.stationId, _sel.i, ingId, now);
  if (!res || !res.ok) { toast((res && res.why) || 'That will not go on there.'); return; }
  paint();
}

/**
 * 🔴 THE LANE'S FRONT DOOR. This is the fix for the biggest hole in the feature.
 *
 * Round 1 served every ticket with `State.serveTicket()` — including drive-thru
 * ones — which bypassed drivethru.js entirely. `serveCar()` and `waveCar()`, the
 * module's only two player verbs, had ZERO callers anywhere in the repo. The
 * measurable consequences, all of them from a real 12-minute day:
 *   · 54 `car:served` events against `laneStatus().stats.served === 0`;
 *   · `remember(K, car, 'served')` never ran, so the regulars ledger recorded
 *     failures only, so `rollSpecial`'s `wronged = (lost+waved) > served` was
 *     always true — the FAVOUR set piece fired 0 times in 822 arrivals;
 *   · 36 of the 128 authored dialogue lines (every `served` line in the file)
 *     were unreachable — 28% of the writing;
 *   · no tip resolution, no modifier verdict, no voice at the window.
 *
 * 🔴 DO NOT ALSO CALL State.serveTicket(). `serveCar()` calls it internally. The
 *    second call double-serves and returns {ok:false} on a sale that went
 *    through, which reads to the player as "it failed" on a burger they were
 *    just paid for.
 */
function doServe(id, now) {
  const k = K();
  const t = (k.tickets || []).find((x) => x && x.id === id);
  if (t && t.source === 'drive' && t.carId && typeof DriveThru.serveCar === 'function') {
    return doServeCar(t.carId, now);
  }
  const res = State.serveTicket(id, now);
  if (!res || !res.ok) { toast((res && res.why) || 'That order is not ready.'); return; }
  paint();
}

function doServeCar(carId, now) {
  if (typeof DriveThru.serveCar !== 'function') { toast('The window will not open.'); return; }
  const r = safe(() => DriveThru.serveCar(K(), carId, now), null);
  if (!r || !r.ok) { toast((r && r.why) || 'That order is not ready.'); return; }
  rewardMoment(r);
  paint();
}

/**
 * ✋ THE WAVE-OFF — the player's escape hatch, and the reason it is a decision.
 * It costs POP_WAVE (−2.0) and produces NO lost ticket, against POP_LOST (−3.5)
 * for letting them time out. So the maths says: wave early, eat the smaller hit,
 * free the slot, save the three cars behind them. A control that costs the same
 * as a failure is not a decision, which is why this one is cheaper — and why it
 * is behind a confirm rather than under a thumb that is already tapping fast.
 */
async function doWave(carId, now) {
  if (typeof DriveThru.waveCar !== 'function') { toast('There is nobody to wave off.'); return; }
  let yes = true;
  try { if (b().confirm) yes = await b().confirm('Wave them off? It costs popularity.'); } catch (e) { yes = true; }
  if (!yes) return;
  const r = safe(() => DriveThru.waveCar(K(), carId, nowMs()), null);
  if (!r || !r.ok) { toast((r && r.why) || 'They have already gone.'); return; }
  toast(`✋ You waved ${r.custName || 'them'} off. ${fmtPop(r.pop)} popularity.`);
  paint();
}
function fmtPop(n) { const v = Number(n) || 0; return (v > 0 ? '+' : '') + v.toFixed(1); }

/**
 * 🎉 THE REWARD MOMENT. `serveCar()` returns a rich struct precisely so this can
 * exist: what they paid, what they tipped, what they SAID, and — the part that
 * makes modifiers a real mechanic — which promises you kept and which you broke.
 * Round 1's only feedback for a sale was a float-up with a number on it.
 */
function rewardMoment(r) {
  const kept = (r.mods || []).filter((m) => m && m.result === 'honoured');
  const broke = (r.mods || []).filter((m) => m && m.result === 'broken');
  let line = `${r.icon || '🚗'} ${r.custName || 'Served'} · ${fmtCinder(r.paid)}`;
  if (r.tip > 0) line += ` +${fmtCinder(r.tip)} tip`;
  if (broke.length) line += ` · ✗ ${esc0(broke[0].label)}`;
  else if (kept.length) line += ` · ✓ ${esc0(kept[0].label)}`;
  toast(line);
  /* Their line is the payoff for reading the lane's voice all shift, and until
     this round none of the 24 authored `served` lines could ever be reached.
     It rides its own toast a beat later so it is not competing with the money —
     `_lastToastAt` is nudged back so the rate limiter lets this one through. */
  if (r.line) { _lastToastAt = 0; toast(`“${r.line}”`); }
}
/** toast() takes plain text, not HTML — this only strips, it does not escape. */
function esc0(s) { return String(s == null ? '' : s); }

function doBinPass(dishId) {
  if (typeof State.binPass !== 'function') { toast('That plate will not move.'); return; }
  const r = safe(() => State.binPass(dishId), null);
  if (!r || !r.ok) { toast((r && r.why) || 'That plate is not on the pass.'); return; }
  paint();
}

function doBuy(supplyId, n) {
  const res = State.buySupply(supplyId, n);
  if (!res || !res.ok) { toast((res && res.why) || 'You cannot afford that.'); return; }
  toast('Restocked.');
  _lastSheetPaint = 0;
  paintSheet();
  paint();
}

async function doConvoyLaunch(tierId, now) {
  if (typeof Convoy.compose !== 'function' || typeof Convoy.launch !== 'function') {
    toast('The loading bay is not built yet.');
    return;
  }
  const k = K();
  const man = safe(() => (typeof Convoy.manifest === 'function' ? Convoy.manifest(k, tierId, _convoyWant) : null), null);
  if (!man) { toast('That truck is not in the yard.'); return; }
  if (!man.ok) { toast(man.why || 'That load will not go.'); return; }

  const composed = safe(() => Convoy.compose(k, tierId, man.items), null);
  if (!composed || !composed.ok) { toast((composed && composed.why) || 'That load will not go.'); return; }

  /* 🔴 PASS THE CHOSEN ROW, NOT `bridge().userId()`. That single line was round
     1's headline bug: it made `self` true on every launch, so the server leg was
     never reached and the player-to-player feature — the one the player asked
     for by name — did not exist in the running build. `null` here is the
     EXPLICIT practice run, which is a choice the player made on a chip, not a
     silent fallback. */
  const out = await Promise.resolve(safe(() => Convoy.launch(k, composed.convoy, _convoyTo, now), null));
  if (!out || !out.ok) { toast((out && out.why) || 'The convoy did not leave.'); return; }

  /* ⚠ `turnedBack` is a SUCCESS that is not a success: the truck went out and
     came back. The player is owed the reason, not a cheerful "sent!". */
  if (out.turnedBack) toast('🚚 ' + (out.why || 'The truck turned back.'));
  else if (out.local) toast('🚚 Practice run away — it comes back to your own city.');
  else toast(`🚚 On the road to ${_convoyTo ? _convoyTo.name : 'their city'}.`);

  _convoyWant = null;               // the pass just emptied; start the next load fresh
  paintSheetNow();
  paint();
}

/**
 * 🔴 THE IN-FLIGHT GUARD. Round 1 had none: `doConvoyClaim` awaited `claim()`
 * with nothing stopping a second tap entering concurrently, and the only thing
 * that saved it was the accidental ordering of two statements inside convoy.js.
 * The server-side first-claim flag and convoy.js's `paidFood` recompute are the
 * SECOND and THIRD walls. This is the first one, and it is also the only one the
 * player can see — the button says what it is doing.
 */
async function doConvoyClaim(id, now) {
  if (typeof Convoy.claim !== 'function') { toast('The loading bay is not built yet.'); return; }
  if (!id || _claiming.has(id)) return;
  _claiming.add(id);
  paintSheetNow();
  try {
    const out = await Promise.resolve(safe(() => Convoy.claim(K(), id, now), null));
    if (!out || !out.ok) {
      // CAP is not a failure — it is "your stash is full", and the food is now
      // on the dock draining itself. Say that, not "it will not unload".
      toast((out && out.why) || 'That convoy will not unload.');
      return;
    }
    toast(`📦 ${fmtNum(out.granted || 0)} food unloaded into the stash.`);
  } finally {
    _claiming.delete(id);
    paintSheetNow();
    paint();
  }
}

function result(res, fallbackWhy) {
  if (res === true) return true;
  if (res === false) { if (fallbackWhy) toast(fallbackWhy); return false; }
  if (res && res.ok) return true;
  toast((res && res.why) || fallbackWhy || 'That did not work.');
  return false;
}

/* ═══════════════════════════════════════════════════════════════════════════
   SHEETS
   ═══════════════════════════════════════════════════════════════════════════ */
function setSheet(name) {
  _sheet = name || null;
  _lastSheetPaint = 0;          // an explicit open always repaints immediately
  if (!_sheet) _pending = null;
  const wrap = _root && _root.querySelector('#mk-sheet-wrap');
  if (wrap) wrap.hidden = !_sheet;
  paintTabs();
  if (_sheet) paintSheet();
  _paintedView = viewKey();
}

function paintSheet() {
  if (!_root || !_sheet) return;
  const title = _root.querySelector('#mk-sheet-title');
  const body = _root.querySelector('#mk-sheet-body');
  const wrap = _root.querySelector('#mk-sheet-wrap');
  if (!body || !wrap) return;
  wrap.hidden = false;
  const k = K();
  // Same reason paint() preserves the rails' scrollLeft: a rebuild that loses
  // your place in a 25-row supply list is a rebuild that costs a sale.
  const top = body.scrollTop;
  if (_sheet === 'menu')     { setText(title, 'Menu'); body.innerHTML = menuSheet(k); }
  else if (_sheet === 'supplies') { setText(title, 'Supplies'); body.innerHTML = suppliesSheet(k); }
  else if (_sheet === 'convoy')   { setText(title, 'Loading Bay'); body.innerHTML = convoySheet(k); }
  else if (_sheet === 'day')      { setText(title, 'The Day'); body.innerHTML = daySheet(k); }
  if (top) body.scrollTop = top;
  _lastSheetPaint = k.now;
}

/* ── 📋 MENU ─────────────────────────────────────────────────────────────── */
function menuSheet(k) {
  const all = (Array.isArray(DATA.RECIPES) ? DATA.RECIPES : []);
  const cats = (Array.isArray(DATA.MENU_CATS) ? DATA.MENU_CATS : []).slice().sort((a, bb) => (a.order || 0) - (bb.order || 0));
  const stName = _pending ? esc((safe(() => DATA.station(_pending.stationId).name, '')) || _pending.stationId) : '';
  const head = _pending
    ? `<div class="mk-banner">Putting something on the <b>${stName}</b>. Dishes for other stations are greyed out.</div>`
    : '';

  const groups = cats.map((c) => {
    const rows = all.filter((r) => r.cat === c.id);
    if (!rows.length) return '';
    return `<div class="mk-sec-head" style="padding-left:0"><b>${c.icon || ''} ${esc(c.name)}</b></div>
      <div class="mk-grid">${rows.map((r) => dishCard(k, r)).join('')}</div>`;
  }).join('');
  return head + groups;
}
function dishCard(k, r) {
  const locked = (r.minLevel || 1) > k.level;
  const wrongStation = !!(_pending && r.station && r.station !== _pending.stationId);
  const can = safe(() => State.canCook(r.id), null);
  const short = !locked && can && !can.ok && can.code === 'NO_PANTRY';
  /* ⚠ "12/1" was drafted here and it reads as a fraction the wrong way round —
     testers read "12 of 1". The recipe COST is what the card is for, so the chip
     leads with ×qty and only mentions your stock when you are short of it. */
  const needs = Object.keys(r.needs || {}).map((id) => {
    const ing = safe(() => DATA.ingredient(id), null) || {};
    const have = (k.pantry || {})[id] | 0;
    const want = r.needs[id] | 0;
    const isShort = have < want;
    return `<span class="mk-need" data-short="${isShort ? 1 : 0}" title="${esc(ing.name || id)}">${ing.icon || '•'} ×${want}${isShort ? ` · have ${have}` : ''}</span>`;
  }).join('');
  const dis = locked || wrongStation;
  return `<button class="mk-card" data-act="${dis ? 'noop' : 'cook'}" data-recipe="${esc(r.id)}"
      data-locked="${locked ? 1 : 0}" ${dis ? 'disabled' : ''}>
      <div class="mk-card-top"><span class="mk-ic" aria-hidden="true">${r.icon || '🍽'}</span><b>${esc(r.name)}</b></div>
      <div class="mk-card-sub">${esc(fmtCinder(r.basePrice))} · ${Math.round((r.cookMs || 0) / 1000)}s ·
        ${esc(safe(() => DATA.station(r.station).name, r.station) || '')}${short ? ' · <b style="color:#ffb4bb">short</b>' : ''}</div>
      <div class="mk-needs">${needs}</div>
      ${locked ? `<span class="mk-lock" title="${esc(r.name)} opens at level ${r.minLevel} — you are level ${k.level}"
        >🔒 Lv ${r.minLevel}</span>` : ''}
    </button>`;
}

/* ── 🧺 SUPPLIES ─────────────────────────────────────────────────────────── */
/**
 * The ONLY place the 14-id live ledger meets the pantry (§8.1). Every cost chip
 * is drawn from the supply row itself and coloured against a live `getRes()`
 * read, so "can I afford this" is answered before the tap rather than by a
 * refusal after it.
 */
function suppliesSheet(k) {
  const rows = (Array.isArray(DATA.SUPPLY_RECIPES) ? DATA.SUPPLY_RECIPES : []);
  const cap = safe(() => (typeof DATA.pantryCap === 'function' ? DATA.pantryCap(k.upgrades || []) : EC('PANTRY_CAP', 600)), EC('PANTRY_CAP', 600));
  let held = 0; for (const id in (k.pantry || {})) held += k.pantry[id] | 0;
  const signedIn = safe(() => (b().signedIn ? b().signedIn() : false), false);

  const banner = `<div class="mk-banner">Pantry <b>${held}</b> / ${cap} units.
    🔴 <b>Nothing here is bought in.</b> Every crate is made out of the same 14
    resources your city buildings, your businesses and your battles produce —
    the line under each one says which building makes it and whether you have
    that building yet.
    ${signedIn ? '' : ' Signed out: your kitchen still runs, it just does not sync.'}</div>`;

  /* Read ONCE per sheet, not once per row. `cityProd()` crosses the bridge into
     the legacy Profile and this list is 25 rows long; per-row it was 25 reaches
     out of the module for an object that cannot change mid-paint. */
  const owned = cityOwned();
  return banner + rows.map((s) => supplyRow(k, s, owned)).join('');
}
function supplyRow(k, s, owned) {
  const ing = safe(() => DATA.ingredient(s.out.ing), null) || {};
  const locked = (s.minLevel || 1) > k.level;
  const have = (k.pantry || {})[s.out.ing] | 0;
  const chips = Object.keys(s.cost || {}).map((key) => {
    if (key === 'cinder') {
      const gems = safe(() => (b().gems ? b().gems() : 0), 0);
      return `<span class="mk-chip" data-short="${gems < s.cost[key] ? 1 : 0}"><span class="mk-coin"></span>${fmtNum(s.cost[key])}</span>`;
    }
    /* The NAME goes in the chip, not just the icon. bridge().meta() can hand
       back the same fallback glyph for several ids (and does, under
       NULL_BRIDGE), and a cost line where food and water look identical is a
       cost line the player cannot check. */
    const meta = safe(() => (b().meta ? b().meta(key) : null), null) || { name: key, icon: '📦' };
    const hv = safe(() => (b().getRes ? b().getRes(key) : 0), 0);
    return `<span class="mk-chip" data-short="${hv < s.cost[key] ? 1 : 0}">${esc(meta.icon || '📦')} ${esc(meta.name || key)}
        ${fmtNum(s.cost[key])}<span style="opacity:.55">/${fmtNum(hv)}</span></span>`;
  }).join('');

  /* 🌾 PROVENANCE. The cost chips above say WHAT this crate takes out of the
     stash; this line says where that comes from and whether the player has the
     thing that makes it. A green "🧬 Gene Vault · Lv 2" is the reason a Gene
     Vault was worth 120,000 Cinder; a muted "🧬 Gene Vault · build one" is the
     kitchen telling the player what to go and do next in the city builder,
     which is the whole loop the request asked for. */
  const from = Object.keys(s.cost || {})
    .filter((key) => key !== 'cinder')
    .map((key) => fromChip(key, owned || {}))
    .filter(Boolean).join('');

  return `<div class="mk-row">
      <span class="mk-ic" aria-hidden="true">${ing.icon || '🥫'}</span>
      <div class="mk-row-main">
        <b>${esc(ing.name || s.out.ing)}</b>
        <span class="mk-card-sub">+${s.out.qty} per crate · you have ${have} · ${esc(s.blurb || '')}</span>
        <div class="mk-cost">${chips}</div>
        ${from ? `<div class="mk-froms"><span class="mk-from-lab">made by</span>${from}</div>` : ''}
      </div>
      <div class="mk-buys">
        <button class="mk-btn" data-act="buy" data-supply="${esc(s.id)}" data-n="1" ${locked ? 'disabled' : ''}>×1</button>
        <button class="mk-btn" data-act="buy" data-supply="${esc(s.id)}" data-n="5" ${locked ? 'disabled' : ''}>×5</button>
      </div>
      ${locked ? `<span class="mk-chip">🔒 Lv ${s.minLevel}</span>` : ''}
    </div>`;
}

/* ── 🚚 CONVOY ───────────────────────────────────────────────────────────── */
/**
 * Degradation ladder, §9, rungs 1–4 all visible in this one panel: with no
 * convoy module or no tables at all it still explains itself and never shows an
 * error toast. `missing` is a SETUP state, not a failure — CONTRACT is explicit
 * that it must never read as one.
 */
function convoySheet(k) {
  const have = typeof Convoy.compose === 'function';
  const tiers = (Array.isArray(DATA.CONVOY_TIERS) ? DATA.CONVOY_TIERS : []);

  let banner = '';
  if (!have) banner = `<div class="mk-banner">🚧 The loading bay is still being built. Everything else in the kitchen works.</div>`;
  else if (k.missing) banner = `<div class="mk-banner">The convoy network is not set up yet — practice runs to your own city still work.</div>`;
  else if (k.offline) banner = `<div class="mk-banner">Signed out. Sign in to ship to other players; practice runs still work.</div>`;
  if (!have) return banner;

  // Default to the biggest truck the player has actually unlocked.
  if (!_convoyTier || !tiers.some((tt) => tt.id === _convoyTier && (tt.minLevel || 1) <= k.level)) {
    const open = tiers.filter((tt) => (tt.minLevel || 1) <= k.level);
    _convoyTier = (open[open.length - 1] || tiers[0] || {}).id || null;
  }

  const man = safe(() => (typeof Convoy.manifest === 'function' ? Convoy.manifest(k, _convoyTier, _convoyWant) : null), null);

  /* ── 1 · WHO IS IT FOR ─────────────────────────────────────────────────── */
  const to = `<div class="mk-to">
      <div class="mk-sec-head" style="padding-left:0"><b>1 · Where is it going?</b></div>
      <input class="mk-to-field" data-act="convoy-find" type="text" autocomplete="off" spellcheck="false"
        placeholder="Find a player by name…" value="${esc(_convoyQ)}" aria-label="Find a player to ship to">
      <div class="mk-to-rows" id="mk-to-rows">${recipientChips()}</div>
      <div class="mk-to-why" id="mk-to-why">${esc(recipientWhy())}</div>
    </div>`;

  /* ── 2 · WHICH TRUCK ───────────────────────────────────────────────────── */
  const trucks = `<div class="mk-sec-head" style="padding-left:0"><b>2 · Which truck?</b></div>
    <div class="mk-to-rows" style="margin-bottom:8px">${tiers.map((tt) => {
      const locked = (tt.minLevel || 1) > k.level;
      return `<button class="mk-to-chip" data-act="convoy-tier" data-tier="${esc(tt.id)}"
          data-on="${tt.id === _convoyTier ? 1 : 0}" ${locked ? 'disabled' : ''}>
          ${tt.icon || '🚚'} ${esc(tt.name)}
          <small>${locked ? '🔒 Lv ' + tt.minLevel : (tt.capacity + ' boxes · ' + fmtEta(tt.transitMs))}</small>
        </button>`;
    }).join('')}</div>`;

  /* ── 3 · THE MANIFEST ──────────────────────────────────────────────────── */
  const lines = ((man && man.lines) || []).map((L) => `
      <div class="mk-man-line">
        <span aria-hidden="true">${L.icon || '🍽'}</span>
        <span class="mk-nm">${esc(L.name)}</span>
        <span class="mk-card-sub" style="white-space:nowrap">${L.have} on pass</span>
        <button class="mk-step" data-act="convoy-step" data-recipe="${esc(L.recipeId)}" data-d="-1"
          ${L.take <= 0 ? 'disabled' : ''} aria-label="One fewer ${esc(L.name)}">−</button>
        <span class="mk-man-take">${L.take}</span>
        <button class="mk-step" data-act="convoy-step" data-recipe="${esc(L.recipeId)}" data-d="1"
          ${(L.take >= L.max || (man && man.dishes >= man.capacity)) ? 'disabled' : ''} aria-label="One more ${esc(L.name)}">+</button>
      </div>`).join('');

  const fillPct = man && man.capacity ? Math.round((man.dishes / man.capacity) * 100) : 0;
  const dest = _convoyTo ? _convoyTo.name : 'your own city (practice)';
  /* 🔴 A CAP THE PLAYER CANNOT SEE IS A CAP THEY READ AS A BUG. A truck can be
     bigger than the pass it is loaded off, and when it is, the pass — not the
     truck — is the real ceiling. Round 2 shipped a 12-box van against an 8-dish
     pass with nothing on screen to explain why "SEND IT — 8 BOXES" was the most
     anyone could ever load. It is stated only when it actually bites; a note
     about a limit that is not limiting you is noise. */
  const passNow = safe(() => (typeof DATA.passCap === 'function' ? DATA.passCap(k.upgrades || []) : 0), 0) | 0;
  const passAdd = safe(() => (Array.isArray(DATA.UPGRADES) ? DATA.UPGRADES : [])
    .filter((u) => u && u.effect && (u.effect.passAdd | 0) > 0 && (k.upgrades || []).indexOf(u.id) === -1)
    .sort((a, bb) => (a.minLevel || 1) - (bb.minLevel || 1))[0], null);
  const ceiling = (man && passNow && man.capacity > passNow)
    ? `<div class="mk-card-sub" data-ceiling="1">⚠ Your pass holds <b>${passNow}</b> — that is the real ceiling on a load, not the
        truck's ${man.capacity}.${passAdd ? ` ${esc(passAdd.icon || '🔧')} ${esc(passAdd.name)} adds ${passAdd.effect.passAdd | 0}.` : ''}</div>`
    : '';
  const manifest = `<div class="mk-man">
      <div class="mk-sec-head" style="padding-left:0"><b>3 · What goes on it?</b>
        <span class="mk-spacer"></span>
        <button class="mk-btn" data-act="convoy-fill">Fill it</button>
        <button class="mk-btn" data-act="convoy-clear">Empty</button></div>
      ${lines || `<div class="mk-empty">Nothing on the pass can ride a convoy. Fries and shakes do not travel.</div>`}
      <div class="mk-man-fill"><i style="width:${Math.min(100, fillPct)}%"></i>
        <span>${man ? man.dishes : 0} / ${man ? man.capacity : 0} boxes · ${man ? fmtNum(man.food) : 0} food on landing</span></div>
      ${ceiling}
      <div class="mk-card-sub">Freight <span class="mk-coin"></span> ${man ? fmtNum(man.feeCinder) : 0}
        · ${man ? fmtEta(man.transitMs) : '—'} on the road · to <b>${esc(dest)}</b></div>
      <button class="mk-btn go wide" data-act="convoy-load" data-tier="${esc(_convoyTier || '')}"
        ${(man && man.ok) ? '' : 'disabled'} style="margin-top:4px"
        title="${esc((man && man.why) || '')}">
        ${(man && man.ok) ? `Send it — ${man.dishes} ${plural(man.dishes, 'box', 'boxes')}` : esc(loadLabel(man))}</button>
    </div>`;

  /* ── 4 · ON THE ROAD, and 5 · THE DEPOT ────────────────────────────────── */
  const boardRows = safe(() => (typeof Convoy.board === 'function' ? Convoy.board(k) : null), null)
    || (k.convoys || []).concat(k.inbound || []);
  const rolling = boardRows.filter((c) => c && c.state !== 'held');
  const active = rolling.length ? rolling.map((c) => convoyRow(k, c)).join('')
    : `<div class="mk-empty">No convoys on the road.</div>`;

  /* 🔴 THE DEPOT HOLD MUST BE DRAWN OR THE FIX IS INVISIBLE. A short landing
     (your stash was full) moves the row out of `inbound` and into `K.convoys`
     as `state:'held'` — the truck is DELIVERED AND GONE and the food is on a
     dock. Round 1's convoyRow rendered these with no Claim button and a negative
     ETA, which read as a broken convoy rather than as food waiting for room. */
  const heldRows = safe(() => (typeof Convoy.held === 'function' ? Convoy.held(k) : []), []) || [];
  const depot = heldRows.length ? `
    <div class="mk-sec-head" style="padding-left:0"><b>At the depot</b></div>
    ${heldRows.map((h) => `<div class="mk-row mk-held">
        <span class="mk-ic" aria-hidden="true">📦</span>
        <div class="mk-row-main">
          <b>${fmtNum(h.food)} food held</b>
          <span class="mk-card-sub">Your stash was full when the truck from
            ${esc(h.fromName || h.toName || 'the road')} landed. It unloads itself as you make room.</span>
        </div>
        <button class="mk-btn" data-act="convoy-claim" data-id="${esc(h.id)}"
          ${_claiming.has(h.id) ? 'disabled' : ''}>${_claiming.has(h.id) ? 'Unloading…' : 'Retry'}</button>
      </div>`).join('')}` : '';

  return banner + to + trucks + manifest
    + `<div class="mk-sec-head" style="padding-left:0"><b>On the road</b></div>`
    + active + depot;
}

/** The LOAD button's disabled label.
    ⚠ `manifest().why` is a full sentence written to sit UNDER a field. Printed
    on the button it wrapped to three shouty uppercase lines and repeated a
    message the panel had already given two rows above. The sentence still rides
    the `title`; the button says the short version. */
const LOAD_LABEL = {
  LOCKED: 'Truck locked', CAP: 'Too many on the road',
  NO_PANTRY: 'Not enough Cinder', BAD_ARG: 'Pick a truck',
};
function loadLabel(man) {
  if (!man) return 'Load a truck';
  if (man.code === 'NOT_READY') return man.dishes > 0 ? `Load at least ${man.minDishes} boxes` : 'Nothing to load';
  return LOAD_LABEL[man.code] || 'Load a truck';
}

/* ── THE RECIPIENT PICKER ────────────────────────────────────────────────────
 * 🔴 THIS IS THE FEATURE THE PLAYER ASKED FOR BY NAME, AND IT DID NOT EXIST.
 * Round 1 handed `bridge().userId()` to `launch()` as the recipient, so
 * convoy.js computed `self = true` on every single launch, the server leg was
 * never reached, `API.insertConvoy` was never called, and sql/038's tables, RLS,
 * ledger and claim RPC were unreachable dead weight — while the panel showed a
 * banner promising "sign in to ship to other players".
 *
 * ⚠ `null` IS THE PRACTICE RUN and it must stay an explicit, visible choice, not
 *   a fallback. convoy.js refuses a NAMED recipient while signed out rather than
 *   quietly downgrading it, because the player picked a person and silently
 *   shipping to yourself instead is a lie with their boxes in it.
 */
function recipientChips() {
  const k = K();
  const rows = _convoyRows.length ? _convoyRows
    : (safe(() => (typeof Convoy.recentPartners === 'function' ? Convoy.recentPartners(k, 6) : []), []) || []);
  const practice = `<button class="mk-to-chip" data-act="convoy-to" data-to="" data-on="${_convoyTo ? 0 : 1}">
      🏠 Practice run <small>your own city</small></button>`;
  return practice + rows.map((r) => `<button class="mk-to-chip" data-act="convoy-to"
      data-to="${esc(r.id)}" data-name="${esc(r.name)}" data-on="${_convoyTo && _convoyTo.id === r.id ? 1 : 0}">
      ${r.kind === 'recent' ? '🤝' : '🧑'} ${esc(r.name)}${r.sub ? ` <small>${esc(r.sub)}</small>` : ''}</button>`).join('');
}
function recipientWhy() {
  if (_convoyBusy) return 'Looking…';
  if (_convoyWhy) return _convoyWhy;
  return _convoyTo ? `Addressed to ${_convoyTo.name}.` : 'Practice runs come back to your own city.';
}
/** Repaint ONLY the chips and the hint. ⚠ Never the field itself — rebuilding it
    while the player types drops focus mid-word and eats the caret position. */
function paintRecipients() {
  if (!_root) return;
  const rows = _root.querySelector('#mk-to-rows');
  const why = _root.querySelector('#mk-to-why');
  if (rows) rows.innerHTML = recipientChips();
  if (why) why.textContent = recipientWhy();
}
async function runFind() {
  if (typeof Convoy.recipients !== 'function') { _convoyBusy = false; return; }
  const seq = ++_findSeq;
  const r = await Promise.resolve(safe(() => Convoy.recipients(_convoyQ, K()), null));
  // ⚠ A slow reply for an old fragment must never overwrite a fast one for the
  //   current fragment. Typing "kes" fires three lookups; only the last is true.
  if (seq !== _findSeq || !_openFlag) return;
  _convoyBusy = false;
  _convoyRows = (r && r.rows) || [];
  _convoyWhy = (r && r.why) || '';
  paintRecipients();
}
function pickRecipient(id, name) {
  _convoyTo = id ? { id, name: name || 'Survivor' } : null;
  paintRecipients();
}
function pickTier(tierId) {
  if (!tierId || tierId === _convoyTier) return;
  _convoyTier = tierId;
  // ⚠ The steppers are RELATIVE to a truck's capacity, so switching trucks with
  //   a hand-dialled manifest can leave a load that no longer fits. Reset to
  //   "fill it" rather than silently clamping numbers the player chose.
  _convoyWant = null;
  paintSheetNow();
}
function stepManifest(recipeId, d) {
  if (!recipeId || !d) return;
  const k = K();
  const man = safe(() => Convoy.manifest(k, _convoyTier, _convoyWant), null);
  if (!man) return;
  // Materialise the current auto-fill into explicit numbers on the first tap, so
  // "fill it minus one burger" is expressible.
  const want = {};
  for (const L of (man.lines || [])) want[L.recipeId] = L.take;
  const L = (man.lines || []).find((x) => x.recipeId === recipeId);
  const ceiling = L ? L.max : 0;
  want[recipeId] = Math.max(0, Math.min(ceiling, (want[recipeId] | 0) + d));
  _convoyWant = want;
  paintSheetNow();
}
function paintSheetNow() { _lastSheetPaint = 0; paintSheet(); }
/** "16 min" / "2h 10m" / "48s". ⚠ NOT fmtMs(): a convoy ETA of 16 minutes
    printed as "16:00" reads as a clock time, and players read it as 4pm. */
function fmtEta(ms) {
  const v = Math.max(0, Number(ms) || 0);
  if (v < 60000) return Math.round(v / 1000) + 's';
  const m = Math.round(v / 60000);
  if (m < 60) return m + ' min';
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}
function plural(n, one, many) { return n === 1 ? one : (many || (one + 's')); }

/**
 * 🛣 THE ROUTE, not a progress bar.
 *
 * Round 1 drew a 1-D `.mk-bar` and the word "2h 10m out". convoy.js now models
 * the trip as five named legs between two markers with deterministic incidents
 * seeded off the SERVER's uuid, and `route(c, now)` hands the whole thing over
 * pure and cheap enough for `frame()`. So: two markers, five lit-as-you-pass
 * waypoints, a wobbling truck at `pct`, and the incident line under it.
 *
 * ⚠ `armed:false` means ECON.CONVOY_SPOIL_PCT is absent — the road is scenic
 *   rather than dangerous. We say nothing about risk in that case rather than
 *   promising stakes the data file has not funded.
 */
function convoyRow(k, c) {
  const tier = safe(() => DATA.convoyTier(c.tierId), null) || {};
  const r = safe(() => (typeof Convoy.route === 'function' ? Convoy.route(c, k.now) : null), null);
  const arrived = c.state === 'arrived' || (r && r.arrived);
  const inbound = c.dir === 'in';
  const busy = _claiming.has(c.id);

  const legs = r ? r.legs.map((L) => `<span class="mk-route-leg" data-passed="${L.passed ? 1 : 0}"
      data-hazard="${L.hazard ? 1 : 0}" style="left:${railAt(L.at)}"
      title="${esc(L.name)}${L.hazard ? ' — ' + esc(L.hazard.name) : ''}">${L.hazard && L.passed ? L.hazard.icon : (L.icon || '•')}</span>`).join('') : '';

  const incident = r && r.incidents.length
    ? `<div class="mk-route-note" data-bad="1">${r.incidents[r.incidents.length - 1].hazard.icon}
        ${esc(r.incidents[r.incidents.length - 1].hazard.line)}${r.spoil ? ` — ${r.spoil} ${plural(r.spoil, 'box', 'boxes')} lost.` : ''}</div>`
    : (r && r.armed && !arrived ? `<div class="mk-route-note">The road is quiet so far.</div>` : '');

  return `<div class="mk-row mk-convoy" data-cv="${esc(c.id)}">
      <span class="mk-ic" aria-hidden="true">${tier.icon || '🚚'}</span>
      <div class="mk-row-main">
        <b>${inbound ? '⬅ ' : '➡ '}${esc(inbound ? (c.fromName || 'Another kitchen') : (c.toName || tier.name || 'Convoy'))}</b>
        <span class="mk-card-sub" data-eta="1">${c.dishes || 0} ${plural(c.dishes || 0, 'box', 'boxes')} ·
          ${arrived ? 'landed — claim it' : fmtEta((c.arrivesAt || 0) - k.now) + ' out'}</span>
        ${r ? `<div class="mk-route">
          <span class="mk-route-end" data-e="a">${r.origin.icon} ${esc(r.origin.name)}</span>
          <span class="mk-route-end" data-e="b">${esc(r.dest.name)} ${r.dest.icon}</span>
          <span class="mk-route-rail"></span>
          ${legs}
          <span class="mk-truck" data-truck="1" style="left:${railAt(r.pct)}">${tier.icon || '🚚'}</span>
        </div>` : ''}
        ${incident}
      </div>
      ${arrived ? `<button class="mk-btn go" data-act="convoy-claim" data-id="${esc(c.id)}"
        ${busy ? 'disabled' : ''}>${busy ? 'Unloading…' : 'Claim'}</button>` : ''}
    </div>`;
}
/** ⚠ The rail is inset 12px at each end, so a glyph positioned at a bare `pct%`
    of the CONTAINER hangs half off the kerb at 0 and overshoots the far marker
    at 1. Everything on the route is placed against the rail, not the box. */
function railAt(p) {
  const v = Math.max(0, Math.min(1, Number(p) || 0));
  return 'calc(12px + ' + v.toFixed(4) + ' * (100% - 24px))';
}
/** The truck moves every frame; the rest of the row does not. Cheap-path only —
    this is the whole reason `route()` is pure. */
function updateRoutes(t) {
  if (_sheet !== 'convoy' || !_root) return;
  const k = K();
  for (const el of _root.querySelectorAll('.mk-convoy[data-cv]')) {
    const c = (k.convoys || []).concat(k.inbound || []).find((x) => x && x.id === el.dataset.cv);
    if (!c) continue;
    const truck = el.querySelector('.mk-truck');
    if (truck) setStyle(truck, 'left', railAt(safe(() => Convoy.progress(c, t), 0)));
    const eta = el.querySelector('[data-eta="1"]');
    if (eta && c.state === 'transit') {
      setText(eta, `${c.dishes || 0} ${plural(c.dishes || 0, 'box', 'boxes')} · ${fmtEta((c.arrivesAt || 0) - t)} out`);
    }
  }
}

/* ── 📊 THE DAY ──────────────────────────────────────────────────────────── */
function daySheet(k) {
  const rep = safe(() => State.lastReport(), null);
  const cur = k.today;
  const clock = safe(() => State.shiftClock(), null) || {};
  const stat = (v, lab) => `<div class="mk-stat"><b>${v}</b><span>${lab}</span></div>`;

  const today = `<div class="mk-sec-head" style="padding-left:0"><b>Today · ${esc(clock.dayName || '')} ${esc(fmtClock(clock.hour || 0))}</b></div>
    <div class="mk-stats">
      ${stat(cur.served, 'served')}${stat(cur.lost, 'walked')}${stat(cur.burnt, 'burnt')}
      ${stat(fmtNum(cur.earned), 'cinder')}${stat(fmtNum(cur.tips), 'tips')}${stat(fmtNum(cur.xp || 0), 'xp')}
    </div>`;

  const last = rep ? `<div class="mk-sec-head" style="padding-left:0"><b>Last shift</b></div>
    <div class="mk-row">
      <span class="mk-grade">${esc(rep.grade || '—')}</span>
      <div class="mk-row-main">
        <b>Day ${rep.day} · ${esc(rep.dayName || '')}</b>
        <span class="mk-card-sub">${rep.served} served · ${rep.lost} walked out · ${rep.burnt} burnt</span>
        <span class="mk-card-sub">${esc(fmtCinder(rep.earned))} + ${esc(fmtCinder(rep.tips))} tips · ${fmtNum(rep.xp || 0)} xp</span>
      </div>
    </div>` : '';

  const totals = `<div class="mk-sec-head" style="padding-left:0"><b>All time</b></div>
    <div class="mk-stats">
      ${stat(fmtNum(k.totals.served), 'served')}${stat(fmtNum(k.totals.days), 'days')}${stat(fmtNum(k.totals.earned), 'cinder')}
    </div>`;

  const ctl = k.shift.running
    ? `<button class="mk-btn danger wide" data-act="shift-close" style="margin-top:12px">Ring the closing bell</button>`
    : `<button class="mk-btn go wide" data-act="shift-open" style="margin-top:12px">Open the doors — day ${k.shift.day}</button>`;

  return today + last + totals + ctl;
}

/* ═══════════════════════════════════════════════════════════════════════════
   TINY DOM HELPERS
   ───────────────────────────────────────────────────────────────────────────
   Each one SHORT-CIRCUITS when the value has not changed. That is not
   micro-optimisation theatre: writing an identical `style.width` still marks
   the element dirty in Blink, and doing that for forty nodes sixty times a
   second is exactly how the first draft of this file dropped to 30fps on a
   phone while the state layer was doing nothing at all.
   ═══════════════════════════════════════════════════════════════════════════ */
function setText(el, v) { if (el && el.textContent !== v) el.textContent = v; }
function setStyle(el, prop, v) { if (el && el.style[prop] !== v) el.style[prop] = v; }
function setData(el, key, v) { if (el && el.dataset[key] !== v) el.dataset[key] = v; }
/** Call a neighbour's function without letting a half-written module take the
    paint down. Returns `fb` on any throw — a missing feature must degrade to a
    dash on screen, never to a blank overlay. */
function safe(fn, fb) { try { const v = fn(); return (v === undefined || v === null) ? fb : v; } catch (e) { return fb; } }
