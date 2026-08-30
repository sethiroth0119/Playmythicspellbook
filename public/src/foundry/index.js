/* ════════════════════════════════════════════════════════════════════════════
   ♻️ THE FOUNDRY — module entry. Registers window.MythicFoundry.
   ----------------------------------------------------------------------------
   Trash crushing + refining, as ES modules under /src (CLAUDE.md: new features
   live OUTSIDE index.html). Nothing is added to the legacy file except the
   bridge, the script tag and the launch button.

   TWO VIEWS OF ONE SIMULATION:
     • FLOOR     — a first-person shed you walk around (world.js). Machines are
                   models you stand in front of; panels POP UP when you reach
                   them. This is the default.
     • BLUEPRINT — the flat tabbed panels. Same state, same cards, no WebGL.

   🔴 BLUEPRINT IS A PEER, NOT A LEGACY FALLBACK, and it must keep working.
   A device that cannot hold a WebGL context, a browser with it disabled, a
   player who simply wants to read numbers without steering — all land here, and
   `open()` degrades to it automatically when Three fails to load. Both views
   render from the SAME render.js functions, so a change to a machine card shows
   up in both or neither.

   🔴 THE GLOBALS TRAP, AGAIN. `Profile`, `Forge`, `_csLoadThree`,
   `_cs3DLoadModel` are top-level `const`/function declarations in index.html —
   lexical bindings NOT on `window`. This module reads NOTHING by itself;
   index.html hands over window.MythicFoundryBridge. If the Foundry needs
   something new, it is ADDED TO THE BRIDGE.

   ⚠ Every entry point is wrapped. The Foundry is a feature; the game is the
   product, and a WebGL failure must never take the page down.
   ════════════════════════════════════════════════════════════════════════════ */

import { MATERIALS, matById, matName, TAPS } from './recipes.js';
import { MACHINES, machineById } from './machines.js';
import {
  ensureState, tick, build, upgrade, repair, setRecipe, setTrim, toggleMachine,
  storageCap, storageUsed, powerCapacity, powerDemand, machineStatus, isBuilt, qtyOf, HALT,
} from './state.js';
import { buyFeed, cashOut, haul, DISPOSAL_IDS } from './taps.js';
import {
  FOUNDRY_CSS, renderLine, renderYard, renderSupply, renderTaps, renderControl,
  machineCard, esc,
} from './render.js';
import { createWorld } from './world.js';
import { STATIONS } from './models.js';
import { renderAdmin, readRow, applyModel } from './admin.js';
/* ♻️ REUSED, NOT REWRITTEN. src/city/cost.js already settles a mixed
   cinder+resource cost atomically and unwinds every leg on failure — including
   the hard-won detail that a refund must use refundRes (uncapped) rather than
   addRes, because addRes silently declines into a full vault and a "refunded"
   player was left with nothing. CLAUDE.md: reuse the existing systems. */
import { spendCost as citySpendCost, splitCost } from '../city/cost.js';

const TABS = [
  { id: 'crush',  label: '🗜️ Crush Line' },
  { id: 'refine', label: '🛢️ Refinery' },
  { id: 'yard',   label: '🏗️ Yard' },
  { id: 'supply', label: '📦 Supply' },
  { id: 'taps',   label: '💰 Sell' },
];

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
    addRes: (id, n) => { try { const r = B.addRes(id, n | 0); return r === false ? false : (n | 0); } catch (e) { return false; } },
    spendRes: (id, n) => { try { return !!B.spendRes(id, n | 0); } catch (e) { return false; } },
    refundRes: (id, n) => { try { B.refundRes ? B.refundRes(id, n | 0) : B.addRes(id, n | 0); } catch (e) {} },
    foundryState: () => { try { return B.foundryState(); } catch (e) { return {}; } },
    save: () => { try { return !!B.save(); } catch (e) { return false; } },
    accrualCapH: () => num(() => B.accrualCapH, 36),
    econ: (k) => { try { return B.econ ? B.econ(k) : undefined; } catch (e) { return undefined; } },
    toast: (m, ms) => { try { B.toast(m, ms || 3600); } catch (e) {} },
    confirm: (m) => { try { return B.confirm(m); } catch (e) { return Promise.resolve(false); } },
    // ── 3D. All optional: absent means the floor is unavailable, not broken.
    isAdmin: () => { try { return !!(B.isAdmin && B.isAdmin()); } catch (e) { return false; } },
    loadThree: (cb) => { try { if (B.loadThree) B.loadThree(cb); else cb(false); } catch (e) { cb(false); } },
    loadModel: (url) => { try { return B.loadModel ? B.loadModel(url) : Promise.reject(new Error('no loader')); } catch (e) { return Promise.reject(e); } },
    uploadModel: (file) => { try { return B.uploadModel ? B.uploadModel(file) : Promise.reject(new Error('no uploader')); } catch (e) { return Promise.reject(e); } },
    autoplay: (root, clips, opts) => { try { B.autoplay && B.autoplay(root, clips, opts); } catch (e) {} },
    forgeFoundry: () => { try { return B.forgeFoundry ? (B.forgeFoundry() || {}) : {}; } catch (e) { return {}; } },
    saveForge: (f) => { try { return B.saveForge ? !!B.saveForge(f) : false; } catch (e) { return false; } },
  };
}

/* Attach the shared cost grammar. Split out so `h` can refer to itself —
   citySpendCost needs the very object it is being hung off. */
function withCost(h) {
  if (!h) return h;
  h.spendCost = (c) => {
    try { return citySpendCost(h, c) || { ok: false, why: 'Could not pay.' }; }
    catch (e) { return { ok: false, why: 'Could not pay.' }; }
  };
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
let _world = null, _pop = null, _mode = 'floor';

function host() { if (!_h) _h = withCost(makeHost()); return _h; }
function state() { const h = host(); if (!h) return null; if (!_st) _st = ensureState(h); return _st; }

function pump() {
  const h = host(), st = state();
  if (!h || !st) return null;
  try { tick(st, h, Date.now()); } catch (e) { try { console.warn('[foundry] tick failed', e); } catch (e2) {} }
  return { h, st };
}

/* ── Blueprint (flat) view ────────────────────────────────────────────────── */
function paintBlueprint() {
  const p = pump(); if (!p || !_wrap) return;
  const { h, st } = p;
  const body = _wrap.querySelector('.fdy-body'); if (!body) return;
  let html = '';
  try {
    if (_tab === 'crush' || _tab === 'refine') html = renderLine(st, h, _tab);
    else if (_tab === 'yard') html = renderYard(st, h);
    else if (_tab === 'supply') html = renderSupply(st, h);
    else if (_tab === 'admin') html = renderAdmin(h);
    else html = renderTaps(st, h);
  } catch (e) {
    try { console.warn('[foundry] render failed', e); } catch (e2) {}
    html = '<div class="fdy-empty">Something went wrong drawing this panel.</div>';
  }
  body.innerHTML = html;
  _wrap.querySelectorAll('.fdy-tab').forEach(t => t.classList.toggle('on', t.getAttribute('data-fdy-tab') === _tab));
}

/* ── Floor (3D) view ──────────────────────────────────────────────────────── */
function floorShell(h) {
  return `<div class="fdy-3d" data-fdy3d>
      <div class="fdy-x2"></div>
      <div class="fdy-hud" data-fdy3d-hud></div>
      <div class="fdy-modes">
        ${h.isAdmin() ? '<button data-fdy-adminmodels title="Swap machine models">🛠 Models</button>' : ''}
        <button data-fdy-mode="blueprint">📋 Blueprint</button>
        <button data-fdy-close>✕</button>
      </div>
      <div class="fdy-prompt" data-fdy3d-prompt></div>
      <div class="fdy-pad">
        <button class="sp"></button><button data-fdy3d-move="f">▲</button><button class="sp"></button>
        <button data-fdy3d-move="l">◀</button><button data-fdy3d-move="b">▼</button><button data-fdy3d-move="r">▶</button>
      </div>
    </div>`;
}

function paintHud() {
  const p = pump(); if (!p || !_wrap) return;
  const { st } = p;
  const el = _wrap.querySelector('[data-fdy3d-hud]'); if (!el) return;
  const used = storageUsed(st), cap = storageCap(st);
  const cp = powerCapacity(st), dm = powerDemand(st);
  const liab = DISPOSAL_IDS.reduce((a, i) => a + qtyOf(st, i), 0);
  const full = used / Math.max(1, cap);
  el.innerHTML =
    `<i class="${full > 0.95 ? 'bad' : full > 0.8 ? 'warn' : ''}">🏗️ <b>${Math.round(used).toLocaleString()}</b> / ${cap.toLocaleString()}</i>` +
    `<i class="${dm > cp ? 'bad' : ''}">⚡ <b>${cp.toLocaleString()}</b> / ${dm.toLocaleString()}</i>` +
    (liab >= 1 ? `<i class="warn">☢️ <b>${Math.round(liab).toLocaleString()}</b> to haul</i>` : '');
}

function promptFor(rec, s) {
  const el = _wrap && _wrap.querySelector('[data-fdy3d-prompt]');
  if (!el) return;
  if (!rec) { el.style.display = 'none'; return; }
  let sub = '', tone = '';
  if (rec.kind === 'machine') {
    if (!s) { sub = 'Not built — walk in to place it'; tone = 'ok'; }
    else {
      sub = s.on ? s.haltText : 'Switched off';
      tone = s.halt === HALT.OK && s.on ? 'ok' : (s.halt === HALT.BROKEN ? 'bad' : 'warn');
      if (s.cond < 100) sub += ` · ${s.cond.toFixed(0)}%`;
    }
  } else sub = 'Open';
  el.innerHTML = `<b>${rec.emoji || ''} ${esc(rec.label)}</b><span class="st ${tone}">${esc(sub)}</span>
    <div style="margin-top:6px"><span class="k">E</span>or tap</div>`;
  el.style.display = 'block';
}

/* 🎯 THE POP-UP. This is the difference the 3D mode buys: the panel arrives
   because you walked somewhere, and the shed keeps running behind it. */
function openPop(rec) {
  const p = pump(); if (!p) return;
  const { h, st } = p;
  closePop();
  const def = rec.kind === 'machine' ? machineById(rec.id) : null;
  let title = rec.label, sub = '', body = '';
  try {
    if (rec.kind === 'machine' && def) {
      title = `${def.emoji} ${def.name}`;
      // The level lives here because the card's own heading is hidden in a popup.
      const ms = machineStatus(st, def.id);
      sub = ms ? `Lv ${ms.lv}/${def.maxLevel}` : 'Not built';
      body = `<div class="fdy-grid fdy-solo">${machineCard(st, h, def)}</div>`;
    } else if (rec.panel === 'supply') body = renderSupply(st, h);
    else if (rec.panel === 'taps') body = renderTaps(st, h);
    else if (rec.panel === 'control') body = renderControl(st, h);
    else if (rec.panel === 'admin') { title = '🛠 Machine models'; body = renderAdmin(h); }
    else body = renderYard(st, h);
  } catch (e) { body = '<div class="fdy-empty">Something went wrong drawing this panel.</div>'; }

  _pop = document.createElement('div');
  _pop.className = 'fdy-pop';
  _pop.innerHTML = `<div class="fdy-pop-in">
      <div class="fdy-pop-top"><h3>${esc(title)}${sub ? ` <span class="sub">${esc(sub)}</span>` : ''}</h3><button class="fdy-btn" data-fdy-popclose>Close</button></div>
      <div class="fdy-pop-body">${body}</div>
    </div>`;
  const mountEl = _wrap.querySelector('[data-fdy3d]') || _wrap;
  mountEl.appendChild(_pop);
  _pop._rec = rec;
  if (_world) _world.setPaused(true);
  const pr = _wrap.querySelector('[data-fdy3d-prompt]'); if (pr) pr.style.display = 'none';
  // Clicking the dimmed shed behind closes — the same gesture as stepping away.
  _pop.addEventListener('click', e => { if (e.target === _pop) closePop(); });
}

function closePop() {
  if (_pop) { try { _pop.remove(); } catch (e) {} _pop = null; }
  if (_world) {
    _world.setPaused(false);
    // Re-assert the prompt for whatever we are still standing next to.
    try { const n = _world.near(); if (n) promptFor(n, n.kind === 'machine' ? machineStatus(state(), n.id) : null); } catch (e) {}
  }
}

function repaintPop() {
  if (!_pop || !_pop._rec) return;
  const rec = _pop._rec;
  const p = pump(); if (!p) return;
  const { h, st } = p;
  const body = _pop.querySelector('.fdy-pop-body'); if (!body) return;
  try {
    if (rec.kind === 'machine') {
      const def = machineById(rec.id);
      body.innerHTML = `<div class="fdy-grid fdy-solo">${machineCard(st, h, def)}</div>`;
    } else if (rec.panel === 'supply') body.innerHTML = renderSupply(st, h);
    else if (rec.panel === 'taps') body.innerHTML = renderTaps(st, h);
    else if (rec.panel === 'control') body.innerHTML = renderControl(st, h);
    else if (rec.panel === 'admin') body.innerHTML = renderAdmin(h);
  } catch (e) {}
}

function paint() {
  if (_mode === 'floor') { paintHud(); repaintPop(); }
  else paintBlueprint();
}

function after(res) {
  const h = host();
  if (res && res.why) h.toast(res.why, 4200);
  if (_world) _world.refresh();
  paint();
  return res;
}

/* ── Events ───────────────────────────────────────────────────────────────── */
function onClick(ev) {
  const st = state(), h = host(); if (!st || !h) return;
  const t = ev.target.closest('[data-fdy-tab],[data-fdy-build],[data-fdy-up],[data-fdy-rep],[data-fdy-tog],[data-fdy-buy],[data-fdy-sell],[data-fdy-haul],[data-fdy-close],[data-fdy-mode],[data-fdy-popclose],[data-fdy-adminmodels],[data-fdy-msave],[data-fdy-mclear],[data-fdy-upload]');
  if (!t) return;
  ev.preventDefault();
  const g = (k) => t.getAttribute(k);
  if (g('data-fdy-close') !== null) return close();
  if (g('data-fdy-popclose') !== null) return closePop();
  if (g('data-fdy-mode')) return setMode(g('data-fdy-mode'));
  if (g('data-fdy-adminmodels') !== null) return openPop({ kind: 'station', id: 'admin', label: 'Machine models', panel: 'admin', emoji: '🛠' });
  if (g('data-fdy-tab')) { _tab = g('data-fdy-tab'); return paint(); }

  // ── Admin model rows
  if (g('data-fdy-msave')) {
    const id = g('data-fdy-msave');
    const row = t.closest('[data-fdy-mrow]');
    const cfg = row ? readRow(row) : null;
    const r = applyModel(h, id, cfg);
    if (r.ok) { h.toast(cfg ? 'Model applied.' : 'Back to the built-in shape.', 3000); if (_world) _world.remodel(id); }
    return after(r);
  }
  if (g('data-fdy-mclear')) {
    const id = g('data-fdy-mclear');
    const r = applyModel(h, id, null);
    if (r.ok && _world) _world.remodel(id);
    return after(r);
  }
  if (g('data-fdy-upload')) return pickModel(h, g('data-fdy-upload'), t);

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

/* .glb picker. The upload itself is the card shop's — including its size-limit
   error text, which tells an admin exactly which knob to turn. */
function pickModel(h, id, btn) {
  try {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.glb,model/gltf-binary';
    inp.onchange = () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      const note = _wrap.querySelector(`[data-fdy-mnote="${id}"]`);
      if (note) note.textContent = 'Uploading ' + f.name + '…';
      btn.disabled = true;
      h.uploadModel(f).then(url => {
        btn.disabled = false;
        const row = btn.closest('[data-fdy-mrow]');
        const urlEl = row && row.querySelector('[data-mf="url"]');
        if (urlEl && url) urlEl.value = url;
        if (note) note.textContent = url ? 'Uploaded — press Apply to use it.' : 'Upload finished but returned no URL.';
      }, err => {
        btn.disabled = false;
        if (note) note.textContent = (err && err.message) ? err.message : 'Upload failed.';
      });
    };
    inp.click();
  } catch (e) { h.toast('Could not open the file picker.'); }
}

function onInput(ev) {
  const st = state(), h = host(); if (!st || !h) return;
  if (ev.target.hasAttribute && ev.target.hasAttribute('data-fdy-trim')) {
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
       retroactively run the last few hours on the new one. */
    pump();
    return after(setRecipe(st, h, sel, ev.target.value || null));
  }
}

/* ── Mode ─────────────────────────────────────────────────────────────────── */
function teardownWorld() {
  closePop();
  if (_world) { try { _world.dispose(); } catch (e) {} _world = null; }
}

function setMode(mode) {
  const st = state(); if (!st) return;
  if (mode === _mode) return;
  teardownWorld();
  _mode = mode;
  st.viewMode = mode;
  try { host().save(); } catch (e) {}
  renderShell();
}

function renderShell() {
  const h = host(), st = state(); if (!h || !st || !_wrap) return;
  const body = _wrap.querySelector('.fdy-body');
  const tabs = _wrap.querySelector('.fdy-tabs');
  const top = _wrap.querySelector('.fdy-top');
  if (_mode === 'floor') {
    if (tabs) tabs.style.display = 'none';
    if (top) top.style.display = 'none';
    body.style.padding = '0';
    body.innerHTML = floorShell(h);
    mountWorld();
  } else {
    if (tabs) tabs.style.display = '';
    if (top) top.style.display = '';
    body.style.padding = '';
    paintBlueprint();
  }
}

function mountWorld() {
  const h = host(), st = state(); if (!h || !st) return;
  const mount = _wrap.querySelector('[data-fdy3d]'); if (!mount) return;
  h.loadThree((ok) => {
    if (!ok || !window.THREE) {
      /* 🔴 DEGRADE, NEVER DEAD-END. No WebGL, a blocked CDN, an old phone —
         the player still gets the whole feature, just flat. Silently showing an
         empty black box would look like the game broke. */
      h.toast('3D is unavailable on this device — showing the Blueprint view.', 4600);
      _mode = 'blueprint'; renderShell(); return;
    }
    if (!_wrap || !mount.parentNode) return;   // closed while Three was loading
    try {
      _world = createWorld(h, {
        mount, state: st,
        resume: st.cam,
        isTyping: () => { const a = document.activeElement; return !!(a && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA')); },
        onNear: (rec, s) => promptFor(rec, s),
        onInteract: (rec) => openPop(rec),
        onMove: (c) => { st.cam = c; },
      });
      if (!_world) { h.toast('3D could not start — showing the Blueprint view.', 4600); _mode = 'blueprint'; renderShell(); return; }
      paintHud();
    } catch (e) {
      try { console.warn('[foundry] world failed', e); } catch (e2) {}
      h.toast('3D could not start — showing the Blueprint view.', 4600);
      _mode = 'blueprint'; renderShell();
    }
  });
}

/* ── Lifecycle ────────────────────────────────────────────────────────────── */
export function open(opts) {
  const h = host();
  if (!h) { try { console.warn('[foundry] window.MythicFoundryBridge is absent — the Foundry is inert.'); } catch (e) {} return false; }
  if (_wrap) return true;
  try {
    if (!document.getElementById('fdy-css')) {
      const s = document.createElement('style'); s.id = 'fdy-css'; s.textContent = FOUNDRY_CSS; document.head.appendChild(s);
    }
    const st = state();
    _mode = (opts && opts.mode) || st.viewMode || 'floor';
    _wrap = document.createElement('div');
    _wrap.className = 'fdy-wrap';
    _wrap.innerHTML = `<div class="fdy-top"><span class="fdy-title">♻️ The Foundry</span>
        <button class="fdy-x" data-fdy-mode="floor" style="margin-left:auto">🏭 Walk the floor</button>
        <button class="fdy-x" data-fdy-close style="margin-left:8px">Close</button></div>
      <div class="fdy-tabs">${TABS.map(t => `<button class="fdy-tab" data-fdy-tab="${t.id}">${t.label}</button>`).join('')}${
        h.isAdmin() ? '<button class="fdy-tab" data-fdy-tab="admin">🛠 Models</button>' : ''}</div>
      <div class="fdy-body" style="position:relative"></div>`;
    _wrap.addEventListener('click', onClick);
    _wrap.addEventListener('input', onInput);
    _wrap.addEventListener('change', onChange);
    document.body.appendChild(_wrap);
    renderShell();
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
    teardownWorld();
    if (_wrap) { _wrap.remove(); _wrap = null; }
    const h = host(); if (h) { pump(); h.save(); }
  } catch (e) {}
  return true;
}

/* 🔔 Called by index.html on load so offline production is banked even if the
   player never opens the panel. Without it a line only runs while you are
   looking at it, which is not what "runs on the wall clock" means. */
export function catchUp() {
  const p = pump();
  if (!p) return null;
  try { p.h.save(); } catch (e) {}
  return true;
}

const api = {
  open, close, catchUp,
  openFloor: () => open({ mode: 'floor' }),
  openBlueprint: () => open({ mode: 'blueprint' }),
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
  MATERIALS, MACHINES, TAPS, STATIONS,
};

try { if (typeof window !== 'undefined') window.MythicFoundry = api; } catch (e) {}
export default api;
