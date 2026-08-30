/* ════════════════════════════════════════════════════════════════════════════
   ♻️ THE FOUNDRY — module entry. Registers window.MythicFoundry.
   ----------------------------------------------------------------------------
   Trash crushing + refining, as an ES module under /src (CLAUDE.md: new features
   live OUTSIDE index.html). Nothing here is added to the legacy file except the
   bridge, the script tag and the launch button.

   🔴 THE GLOBALS TRAP, YET AGAIN. `Profile`, `Cloud`, `App`, `Corp`, `Forge` and
   `RESOURCES` are top-level `const` in index.html — global LEXICAL bindings that
   are NOT properties of `window`. An ES module cannot see them, and
   `window.Profile` is undefined no matter how global `const Profile` looks. The
   repo notes this has cost real time twice already. So this module reads NOTHING
   on its own: index.html hands over `window.MythicFoundryBridge`, and if the
   bridge is absent the module registers, stays inert, and says so exactly once.

   ⚠ Every entry point is wrapped. A failure inside the Foundry must never take
   the game down — the Foundry is a feature; the game is the product.
   ════════════════════════════════════════════════════════════════════════════ */

import { MATERIALS, matById, matName, TAPS } from './recipes.js';
import { MACHINES, machineById } from './machines.js';
import {
  ensureState, tick, build, upgrade, repair, setRecipe, setTrim, toggleMachine,
  storageCap, storageUsed, powerCapacity, powerDemand, machineStatus, isBuilt, qtyOf,
} from './state.js';
import { buyFeed, cashOut, haul, DISPOSAL_IDS } from './taps.js';
import { FOUNDRY_CSS, renderLine, renderYard, renderSupply, renderTaps, esc } from './render.js';
/* ♻️ REUSED, NOT REWRITTEN. src/city/cost.js already settles a mixed
   cinder+resource cost atomically and unwinds every leg on failure — including
   the hard-won detail that a refund must use refundRes (uncapped) rather than
   addRes, because addRes silently declines into a full vault and a "refunded"
   player was left with nothing. CLAUDE.md: reuse the existing systems. A second
   implementation of this would be a second place for that bug to come back. */
import { spendCost as citySpendCost, splitCost } from '../city/cost.js';

const TABS = [
  { id: 'crush',  label: '🗜️ Crush Line' },
  { id: 'refine', label: '🛢️ Refinery' },
  { id: 'yard',   label: '🏗️ Yard' },
  { id: 'supply', label: '📦 Supply' },
  { id: 'taps',   label: '💰 Sell' },
];

/* The host adapter — every legacy capability the Foundry needs, and nothing
   more. A narrow seam is what keeps "what does this module touch?" answerable. */
function makeHost() {
  const B = (typeof window !== 'undefined') ? window.MythicFoundryBridge : null;
  if (!B) return null;
  const num = (f, d) => { try { const v = f(); return (typeof v === 'number' && isFinite(v)) ? v : d; } catch (e) { return d; } };
  return {
    gems: () => num(() => B.gems(), 0),
    getRes: (id) => num(() => B.getRes(id), 0),
    resName: (id) => { try { return B.resName ? B.resName(id) : id; } catch (e) { return id; } },
    spendGems: (n) => { try { return !!B.spendGems(n | 0); } catch (e) { return false; } },
    addGems: (n) => { try { B.addGems(n | 0); } catch (e) {} },
    /* 🔴 RETURNS THE UNITS THAT ACTUALLY LANDED, OR false. addRes enforces the
       stash cap and can deliver less than asked — /src/trading treats a clamp as
       a FAILED leg rather than a smaller delivery, and cashOut() relies on that
       distinction to put units back rather than destroy them. */
    addRes: (id, n) => { try { const r = B.addRes(id, n | 0); return r === false ? false : (n | 0); } catch (e) { return false; } },
    spendRes: (id, n) => { try { return !!B.spendRes(id, n | 0); } catch (e) { return false; } },
    refundRes: (id, n) => { try { B.refundRes ? B.refundRes(id, n | 0) : B.addRes(id, n | 0); } catch (e) {} },
    foundryState: () => { try { return B.foundryState(); } catch (e) { return {}; } },
    save: () => { try { return !!B.save(); } catch (e) { return false; } },
    accrualCapH: () => num(() => B.accrualCapH, 36),
    econ: (k) => { try { return B.econ ? B.econ(k) : undefined; } catch (e) { return undefined; } },
    toast: (m, ms) => { try { B.toast(m, ms || 3600); } catch (e) {} },
    confirm: (m) => { try { return B.confirm(m); } catch (e) { return Promise.resolve(false); } },
  };
}

/* Attach the shared cost grammar to a finished host. Split out so `h` can refer
   to itself — citySpendCost needs the very object it is being hung off. */
function withCost(h) {
  if (!h) return h;
  h.spendCost = (c) => {
    try { return citySpendCost(h, c) || { ok: false, why: 'Could not pay.' }; }
    catch (e) { return { ok: false, why: 'Could not pay.' }; }
  };
  /* The UNDO for a cost that was paid and then could not be persisted. Uses the
     uncapped refund path for the same reason cost.js does. */
  h.refundCost = (c) => {
    try {
      const { cinder, res } = splitCost(c);
      for (const k in res) h.refundRes(k, res[k]);
      if (cinder > 0) h.addGems(cinder);
    } catch (e) {}
  };
  return h;
}

let _h = null, _st = null, _tab = 'crush', _wrap = null, _timer = 0;

function host() { if (!_h) _h = withCost(makeHost()); return _h; }

function state() {
  const h = host(); if (!h) return null;
  if (!_st) _st = ensureState(h);
  return _st;
}

/* Advance the clock, then repaint. Every user action goes through here so the
   numbers a player acts on are never one tick stale. */
function pump() {
  const h = host(), st = state();
  if (!h || !st) return null;
  try { tick(st, h, Date.now()); } catch (e) { try { console.warn('[foundry] tick failed', e); } catch (e2) {} }
  return { h, st };
}

function paint() {
  const p = pump(); if (!p || !_wrap) return;
  const { h, st } = p;
  const body = _wrap.querySelector('.fdy-body'); if (!body) return;
  let html = '';
  try {
    if (_tab === 'crush' || _tab === 'refine') html = renderLine(st, h, _tab);
    else if (_tab === 'yard') html = renderYard(st, h);
    else if (_tab === 'supply') html = renderSupply(st, h);
    else html = renderTaps(st, h);
  } catch (e) {
    try { console.warn('[foundry] render failed', e); } catch (e2) {}
    html = '<div class="fdy-empty">Something went wrong drawing this panel.</div>';
  }
  body.innerHTML = html;
  _wrap.querySelectorAll('.fdy-tab').forEach(t => t.classList.toggle('on', t.getAttribute('data-fdy-tab') === _tab));
}

/* Report the outcome of an action, then repaint. A silent failure on a build is
   how a player concludes the button is broken. */
function after(res) {
  const h = host();
  if (res && res.why) h.toast(res.why, 4200);
  paint();
  return res;
}

function onClick(ev) {
  const st = state(), h = host(); if (!st || !h) return;
  const t = ev.target.closest('[data-fdy-tab],[data-fdy-build],[data-fdy-up],[data-fdy-rep],[data-fdy-tog],[data-fdy-buy],[data-fdy-sell],[data-fdy-haul],[data-fdy-close]');
  if (!t) return;
  ev.preventDefault();
  const g = (k) => t.getAttribute(k);
  if (g('data-fdy-close') !== null) return close();
  if (g('data-fdy-tab')) { _tab = g('data-fdy-tab'); return paint(); }
  pump();
  if (g('data-fdy-build')) return after(build(st, h, g('data-fdy-build')));
  if (g('data-fdy-up')) return after(upgrade(st, h, g('data-fdy-up')));
  if (g('data-fdy-rep')) return after(repair(st, h, g('data-fdy-rep')));
  if (g('data-fdy-tog')) return after(toggleMachine(st, h, g('data-fdy-tog')));
  if (g('data-fdy-buy')) return after(buyFeed(st, h, g('data-fdy-buy'), parseInt(t.getAttribute('data-q'), 10) || 0));
  if (g('data-fdy-haul')) return after(haul(st, h, g('data-fdy-haul')));
  if (g('data-fdy-sell')) {
    const id = g('data-fdy-sell');
    const r = cashOut(st, h, id, 1e9);
    if (r.ok) h.toast('Sold ' + r.units.toLocaleString() + ' ' + matName(id) + ' for ' + r.paid.toLocaleString() + ' ' + h.resName(r.to) + '.', 3600);
    return after(r);
  }
}

function onInput(ev) {
  const st = state(), h = host(); if (!st || !h) return;
  if (ev.target.hasAttribute('data-fdy-trim')) {
    pump(); // bank production at the OLD trim before the new one applies
    setTrim(st, h, (parseInt(ev.target.value, 10) || 0) / 100);
    return paint();
  }
}

function onChange(ev) {
  const st = state(), h = host(); if (!st || !h) return;
  const sel = ev.target.getAttribute && ev.target.getAttribute('data-fdy-recipe');
  if (sel) {
    /* 🔴 BANK PRODUCTION BEFORE SWITCHING. tick() attributes everything since
       lastTick to the CURRENT recipe, so changing it without pumping first would
       retroactively run the last few hours on the new recipe — a player could
       swap to the expensive recipe right before collecting and be paid for work
       the cheap one did. Same reason the trim slider pumps. */
    pump();
    return after(setRecipe(st, h, sel, ev.target.value || null));
  }
}

export function open() {
  const h = host();
  if (!h) { try { console.warn('[foundry] window.MythicFoundryBridge is absent — the Foundry is inert.'); } catch (e) {} return false; }
  if (_wrap) return true;
  try {
    if (!document.getElementById('fdy-css')) {
      const s = document.createElement('style'); s.id = 'fdy-css'; s.textContent = FOUNDRY_CSS; document.head.appendChild(s);
    }
    _wrap = document.createElement('div');
    _wrap.className = 'fdy-wrap';
    _wrap.innerHTML = `<div class="fdy-top"><span class="fdy-title">♻️ The Foundry</span>
        <button class="fdy-x" data-fdy-close>Close</button></div>
      <div class="fdy-tabs">${TABS.map(t => `<button class="fdy-tab" data-fdy-tab="${t.id}">${t.label}</button>`).join('')}</div>
      <div class="fdy-body"></div>`;
    _wrap.addEventListener('click', onClick);
    _wrap.addEventListener('input', onInput);
    _wrap.addEventListener('change', onChange);
    document.body.appendChild(_wrap);
    paint();
    // Live repaint while open so buffers filling and condition dropping are
    // visible rather than something you discover on your next visit.
    _timer = setInterval(() => { try { paint(); } catch (e) {} }, 5000);
    return true;
  } catch (e) {
    try { console.warn('[foundry] open failed', e); } catch (e2) {}
    return false;
  }
}

export function close() {
  try {
    if (_timer) { clearInterval(_timer); _timer = 0; }
    if (_wrap) { _wrap.remove(); _wrap = null; }
    const h = host(); if (h) { pump(); h.save(); }
  } catch (e) {}
  return true;
}

/* 🔔 Called by index.html on load so offline production is banked even if the
   player never opens the panel. Without this a line only runs while you are
   looking at it, which is not what "runs on the wall clock" means. */
export function catchUp() {
  const p = pump();
  if (!p) return null;
  try { p.h.save(); } catch (e) {}
  return true;
}

const api = {
  open, close, catchUp,
  isBuilt: (id) => { const st = state(); return st ? isBuilt(st, id) : false; },
  summary: () => {
    const p = pump(); if (!p) return null;
    const { st } = p;
    return {
      used: storageUsed(st), cap: storageCap(st),
      power: powerCapacity(st), draw: powerDemand(st),
      built: MACHINES.filter(d => isBuilt(st, d.id)).length,
      liabilities: DISPOSAL_IDS.reduce((a, i) => a + qtyOf(st, i), 0),
    };
  },
  MATERIALS, MACHINES, TAPS,
};

try { if (typeof window !== 'undefined') window.MythicFoundry = api; } catch (e) {}
export default api;
