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

/* Node registry, rebuilt by paint(). frame() walks these and nothing else. */
let _reg = emptyReg();
function emptyReg() {
  return { hud: {}, tickets: [], slots: [], cars: [], dishes: [], fx: null, road: null };
}

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

    try { _root.remove(); } catch (e) {}
  }
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
   THE SHELL — built once, in open(). Everything inside #mk-body is rebuilt by
   paint(); the HUD, tabs and FX layer are permanent so their nodes survive and
   frame() can write to them without a lookup.
   ═══════════════════════════════════════════════════════════════════════════ */
function shellHtml() {
  return `
  <div class="mk-room" aria-hidden="true"></div>

  <header class="mk-hud">
    <div class="mk-hud-pop" title="Popularity">
      <span class="mk-face" id="mk-face">🙂</span>
      <div>
        <div class="mk-meter"><i id="mk-pop-bar"></i></div>
        <div class="mk-lab" id="mk-pop-lab">Popularity</div>
      </div>
    </div>

    <div class="mk-hud-lvl" title="Level and experience">
      <span class="mk-lvl-badge">Lv <b id="mk-level">1</b></span>
      <div class="mk-xp"><i id="mk-xp-bar"></i></div>
      <span class="mk-lab" id="mk-xp-lab">0/0</span>
    </div>

    <div class="mk-hud-cash" title="Cinder">
      <span class="mk-coin" aria-hidden="true"></span>
      <span class="mk-cash" id="mk-cash">0</span>
      <span class="mk-lab">Cinder</span>
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
  updateHud(nowMs(), true);
  updateTickets(nowMs());
  updateSlots(nowMs());
  updateCars(nowMs());
  updatePass(nowMs());
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
    rush: _root.querySelectorAll('#mk-rush > i'),
  };
  _reg.fx = q('#mk-fx');
  _reg.road = q('#mk-road');

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
}

/* ── 🚗 THE LANE ─────────────────────────────────────────────────────────── */
function laneHtml(k) {
  const cars = (k.lane || []).filter((c) => c && c.state !== 'gone');
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
    ? cars.map((c) => carHtml(c, travel)).join('')
    : `<div class="mk-road-empty">${k.shift.running ? 'Lane clear. Someone will turn up.' : 'The lane is closed.'}</div>`;
  return `
  <section class="mk-sec mk-sec-lane">
    <div class="mk-sec-head"><b>Drive-Thru</b><span class="mk-spacer"></span>
      <span>${live} / ${cap} cars${st && st.full ? ' · FULL' : ''}</span></div>
    <div class="mk-lane">
      <div class="mk-road" id="mk-road">
        ${body}
        <div class="mk-speaker" aria-hidden="true"><span>🔊</span>ORDER<br>HERE</div>
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
function carHtml(c, travel) {
  const car = (typeof DATA.car === 'function' ? (DATA.car(c.vehicle) || DATA.car(c.type) || DATA.car(c.carId)) : null) || {};
  const x = carX(c, travel);
  const cust = (typeof DATA.customer === 'function' ? DATA.customer(c.custId) : null) || {};
  /* The bubble node ALWAYS exists and is hidden with an attribute. `car.say` is
     set by drivethru.js with its own expiry (`sayUntil`) and does NOT bump
     `rev` — rightly, it is chatter, not structure — so if the bubble were built
     at paint time the customer would say nothing until something unrelated
     repainted the lane. It is a per-frame textContent write instead. */
  return `<div class="mk-car" data-car="${esc(c.carId || c.id)}" data-state="${esc(c.state || 'rolling')}"
      data-side="left" data-say="0" style="transform:translateX(${x}px)">
      <div class="mk-bub"></div>
      <div class="mk-car-body" aria-hidden="true">${c.vehicleIcon || car.icon || '🚗'}</div>
      <div class="mk-car-name">${esc(c.name || cust.name || 'Customer')}</div>
      <div class="mk-bar"><i></i></div>
    </div>`;
}

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
  return Math.round(Math.min(t, (1 - p) * t));
}
/** How far a car can move across the road, in px. One definition, two callers
    (the markup seed above and the per-frame update). */
function laneTravel() {
  /* ⚠ SPEAKER_W is wider than the speaker box (46px phone / 64px desktop) on
     purpose. `travel` is measured to the car's LEFT edge, so a reserve equal to
     the box parks the car's 76px-wide label underneath it and the customer at
     the window loses their name. The extra clears the label too. */
  const CAR_W = 76, SPEAKER_W = 84;
  return Math.max(0, (_laneW || 0) - CAR_W - SPEAKER_W);
}
function capLane(k) {
  try { if (typeof DATA.laneCap === 'function') return DATA.laneCap(k.upgrades || []); } catch (e) {}
  return EC('LANE_CAP', 4);
}

/* ── 📋 THE ORDER BOARD ──────────────────────────────────────────────────── */
function boardHtml(k) {
  const list = (k.tickets || []).filter((t) => t && (t.state === 'open' || t.state === 'ready'));
  const inner = list.length
    ? list.map(ticketHtml).join('')
    : `<div class="mk-empty">${k.shift.running ? 'No orders on the board. Enjoy it.' : 'Service is closed.'}</div>`;
  return `
  <section class="mk-sec mk-sec-board">
    <div class="mk-board">
      <div class="mk-board-head">Customer Orders<span class="mk-spacer"></span>
        <span class="mk-board-count">${list.length}</span></div>
      <div class="mk-rail" data-rail="board">${inner}</div>
    </div>
  </section>`;
}
function ticketHtml(t) {
  const cust = (typeof DATA.customer === 'function' ? DATA.customer(t.custId) : null) || {};
  const items = (t.items || []).map((it) => {
    const r = (typeof DATA.recipe === 'function' ? DATA.recipe(it.recipeId) : null) || {};
    const pips = [];
    for (let i = 0; i < it.qty; i++) pips.push(`<i class="${i < it.filled ? 'on' : ''}"></i>`);
    return `<div class="mk-tk-it" data-done="${it.filled >= it.qty ? 1 : 0}">
        <span class="mk-ic" aria-hidden="true">${r.icon || '🍽'}</span>
        <span class="mk-nm">${esc(r.name || it.recipeId)}</span>
        <span class="mk-qt">${it.filled}/${it.qty}</span>
        <span class="mk-pips" aria-hidden="true">${pips.join('')}</span>
      </div>`;
  }).join('');

  const ready = t.state === 'ready';
  const worth = ticketWorth(t);
  return `<div class="mk-tk" data-tk="${esc(t.id)}" data-src="${esc(t.source)}" data-state="${esc(t.state)}" data-urg="ok">
      <div class="mk-tk-top">
        <span class="mk-ic" aria-hidden="true">${t.icon || cust.icon || '🧑'}</span>
        <span class="mk-tk-who">${esc(t.name || cust.name || 'Customer')}</span>
        <span class="mk-tk-src">${t.source === 'drive' ? '🚗 Lane' : '🚶 Counter'}</span>
      </div>
      <div class="mk-tk-items">${items}</div>
      <div class="mk-tk-foot">
        <div class="mk-bar"><i></i></div>
        <span class="mk-tk-time">—</span>
      </div>
      ${ready ? `<button class="mk-serve" data-act="serve" data-id="${esc(t.id)}">Serve · ${esc(fmtCinder(worth))}</button>` : ''}
    </div>`;
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
  return `
  <section class="mk-sec mk-sec-line">
    <div class="mk-sec-head"><b>The Line</b><span class="mk-spacer"></span>
      <span>${_sel ? 'building · tap a bin' : 'tap a pan to start'}</span></div>
    <div class="mk-hood" aria-hidden="true"></div>
    <div class="mk-rail" data-rail="line">${cards}</div>
  </section>`;
}
function stationHtml(k, s) {
  const rack = (k.stations || {})[s.id] || { slots: [] };
  const slots = rack.slots.map((slot, i) => slotHtml(k, s, slot, i)).join('');
  return `<div class="mk-st" data-kind="${esc(s.kind || 'heat')}">
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
function passHtml(k) {
  const dishes = (k.pass || []).map(dishHtml).join('');
  const cap = safe(() => (typeof DATA.passCap === 'function' ? DATA.passCap(k.upgrades || []) : EC('PASS_CAP', 6)), EC('PASS_CAP', 6));
  return `
  <section class="mk-sec mk-sec-pass">
    <div class="mk-pass">
      <div class="mk-sec-head" style="padding-left:0"><b>The Pass</b><span class="mk-spacer"></span>
        <span>${(k.pass || []).length} / ${cap} plated</span></div>
      <div class="mk-pass-rail" data-rail="pass">${dishes || `<div class="mk-empty">Nothing plated yet. Cook something, then plate it.</div>`}</div>
    </div>
  </section>`;
}
function dishHtml(d) {
  const r = (typeof DATA.recipe === 'function' ? DATA.recipe(d.recipeId) : null) || {};
  return `<div class="mk-dish" data-dish="${esc(d.id)}" data-q="${esc(d.quality || 'good')}"
      title="${esc(r.name || d.recipeId)}">
      <span class="mk-ic" aria-hidden="true">${r.icon || '🍽'}</span>
      <span class="mk-q">${esc(d.quality || 'good')}</span>
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
    strip.innerHTML = `
      <div class="mk-tallies">
        <span class="mk-chip">✅ ${k.today.served}</span>
        <span class="mk-chip">💀 ${k.today.lost}</span>
        <span class="mk-chip">🔥 ${k.today.burnt}</span>
        <span class="mk-chip"><span class="mk-coin"></span> ${fmtNum(k.today.earned + k.today.tips)}</span>
      </div>
      <button class="mk-btn danger" data-act="shift-close">End shift</button>`;
  }
}

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
  if (k.rev !== _paintedRev || viewKey() !== _paintedView) { paint(); return; }

  updateHud(t, false);
  updateTickets(t);
  updateSlots(t);
  updateCars(t);
  updatePass(t);
  drainFx(t);
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
  }
  setText(h.cash, fmtNum(_gems));

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
  const travel = laneTravel();
  for (const row of _reg.cars) {
    const c = (k.lane || []).find((x) => x && (x.carId === row.id || x.id === row.id));
    if (!c) continue;
    const x = carX(c, travel);
    setStyle(row.el, 'transform', 'translateX(' + x + 'px)');
    setData(row.el, 'state', c.state || 'rolling');
    // Which way the order bubble hangs. See the .mk-bub[data-side] note in the
    // stylesheet: at the window a centred bubble disappears behind the speaker.
    setData(row.el, 'side', x > travel * 0.55 ? 'right' : 'left');
    const say = (c.say && t < (Number(c.sayUntil) || 0)) ? String(c.say) : '';
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
  const fresh = safe(() => (typeof DATA.passFreshMs === 'function' ? DATA.passFreshMs(k.upgrades || []) : EC('PASS_FRESH_MS', 75000)), EC('PASS_FRESH_MS', 75000));
  for (const row of _reg.dishes) {
    const d = (k.pass || []).find((x) => x.id === row.id);
    if (!d) continue;
    const p = Math.max(0, Math.min(1, 1 - (t - (d.madeAt || t)) / Math.max(1, fresh)));
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
    case 'convoy:arrive':return '🚚 A convoy has arrived.';
    case 'convoy:claim': return '📦 Convoy claimed.';
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
    case 'buy':          doBuy(el.dataset.supply, Number(el.dataset.n) || 1); break;
    case 'convoy-load':  doConvoyLaunch(el.dataset.tier, now); break;
    case 'convoy-claim': doConvoyClaim(el.dataset.id, now); break;
    default: break;
  }
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

function doServe(id, now) {
  const res = State.serveTicket(id, now);
  if (!res || !res.ok) { toast((res && res.why) || 'That order is not ready.'); return; }
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
  const items = {};
  for (const d of (k.pass || [])) {
    if (typeof DATA.shippable === 'function' && !DATA.shippable(d.recipeId)) continue;
    items[d.recipeId] = (items[d.recipeId] || 0) + 1;
  }
  if (!Object.keys(items).length) { toast('Nothing on the pass can ride a convoy.'); return; }

  const composed = safe(() => Convoy.compose(k, tierId, items), null);
  if (!composed || !composed.ok) { toast((composed && composed.why) || 'That load will not go.'); return; }
  const to = safe(() => (b().userId ? b().userId() : null), null);
  const out = await Promise.resolve(safe(() => Convoy.launch(k, composed.convoy, to, now), null));
  if (!out || !out.ok) { toast((out && out.why) || 'The convoy did not leave.'); return; }
  toast('🚚 Convoy away.');
  _lastSheetPaint = 0;
  paintSheet();
  paint();
}

async function doConvoyClaim(id, now) {
  if (typeof Convoy.claim !== 'function') { toast('The loading bay is not built yet.'); return; }
  const out = await Promise.resolve(safe(() => Convoy.claim(K(), id, now), null));
  if (!out || !out.ok) { toast((out && out.why) || 'That convoy will not unload.'); return; }
  toast('📦 Unloaded into the stash.');
  _lastSheetPaint = 0;
  paintSheet();
  paint();
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
      ${locked ? `<span class="mk-lock">🔒 Level ${r.minLevel}</span>` : ''}
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
    Crates are paid for out of your real stash — food, water, DNA and Cinder.
    ${signedIn ? '' : ' Signed out: your kitchen still runs, it just does not sync.'}</div>`;

  return banner + rows.map((s) => supplyRow(k, s)).join('');
}
function supplyRow(k, s) {
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

  return `<div class="mk-row">
      <span class="mk-ic" aria-hidden="true">${ing.icon || '🥫'}</span>
      <div class="mk-row-main">
        <b>${esc(ing.name || s.out.ing)}</b>
        <span class="mk-card-sub">+${s.out.qty} per crate · you have ${have} · ${esc(s.blurb || '')}</span>
        <div class="mk-cost">${chips}</div>
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
  const shipPass = (k.pass || []).filter((d) => (typeof DATA.shippable !== 'function') || DATA.shippable(d.recipeId));

  let banner = '';
  if (!have) banner = `<div class="mk-banner">🚧 The loading bay is still being built. Everything else in the kitchen works.</div>`;
  else if (k.missing) banner = `<div class="mk-banner">The convoy network is not set up yet — practice runs to your own city still work.</div>`;
  else if (k.offline) banner = `<div class="mk-banner">Signed out. Sign in to ship to other players; practice runs still work.</div>`;

  const tierRows = tiers.map((tt) => {
    const locked = (tt.minLevel || 1) > k.level;
    const est = safe(() => (typeof Convoy.estimate === 'function' ? Convoy.estimate(tt.id, countItems(shipPass)) : null), null);
    return `<div class="mk-row">
        <span class="mk-ic" aria-hidden="true">${tt.icon || '🚚'}</span>
        <div class="mk-row-main">
          <b>${esc(tt.name)}</b>
          <span class="mk-card-sub">${tt.capacity} boxes · ${Math.round(tt.transitMs / 60000)} min · fee ${Math.round((tt.feePct || 0) * 100)}%</span>
          <span class="mk-card-sub">${esc(tt.blurb || '')}</span>
          ${est ? `<div class="mk-cost"><span class="mk-chip">${est.dishes} ${plural(est.dishes, 'box', 'boxes')}</span><span class="mk-chip"><span class="mk-coin"></span>${fmtNum(est.feeCinder)}</span></div>` : ''}
        </div>
        <button class="mk-btn go" data-act="convoy-load" data-tier="${esc(tt.id)}"
          ${(!have || locked || !shipPass.length) ? 'disabled' : ''}>Load</button>
        ${locked ? `<span class="mk-chip">🔒 Lv ${tt.minLevel}</span>` : ''}
      </div>`;
  }).join('');

  const mine = (k.convoys || []).concat(k.inbound || []);
  const active = mine.length ? mine.map((c) => convoyRow(k, c)).join('')
    : `<div class="mk-empty">No convoys on the road.</div>`;

  return banner
    + `<div class="mk-banner">On the pass and shippable: <b>${shipPass.length}</b> ${plural(shipPass.length, 'box', 'boxes')}.
        Fries and shakes do not travel.</div>`
    + tierRows
    + `<div class="mk-sec-head" style="padding-left:0"><b>On the road</b></div>`
    + active;
}
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

function countItems(dishes) {
  const items = {};
  for (const d of dishes) items[d.recipeId] = (items[d.recipeId] || 0) + 1;
  return items;
}
function convoyRow(k, c) {
  const tier = safe(() => DATA.convoyTier(c.tierId), null) || {};
  const span = Math.max(1, (c.arrivesAt || 0) - (c.launchedAt || 0));
  const pct = Math.max(0, Math.min(1, (k.now - (c.launchedAt || 0)) / span));
  const arrived = c.state === 'arrived';
  return `<div class="mk-row mk-convoy">
      <span class="mk-ic" aria-hidden="true">${tier.icon || '🚚'}</span>
      <div class="mk-row-main">
        <b>${esc(c.toName || tier.name || 'Convoy')}</b>
        <span class="mk-card-sub">${c.dishes || 0} ${plural(c.dishes || 0, 'box', 'boxes')} · ${arrived ? 'arrived — claim it' : fmtEta((c.arrivesAt || 0) - k.now) + ' out'}</span>
        <div class="mk-bar" style="margin-top:5px"><i style="width:${Math.round(pct * 100)}%"></i></div>
      </div>
      ${arrived ? `<button class="mk-btn go" data-act="convoy-claim" data-id="${esc(c.id)}">Claim</button>` : ''}
    </div>`;
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
