/* ════════════════════════════════════════════════════════════════════════════
   🐄 HOMESTEAD FARM — module entry point. Registers window.MythicFarm.
   ----------------------------------------------------------------------------
   A 3D animal-farm simulation: build pens and stations with Cinder +
   resources, buy stock, keep the troughs full, collect eggs / milk / wool /
   feathers / manure from living animals, slaughter grown stock for meat and
   hide, and refine at the Tannery (leather), Spinning Shed (cloth) and Farm
   Kitchen (food). NEW feature, so it lives OUTSIDE index.html (CLAUDE.md).

   🔴 THE GLOBALS TRAP. `Profile`, `getRes`, `addRes`, `spendGems`, `RESOURCES`
   are top-level `const` / function declarations in index.html — global
   LEXICAL bindings, NOT properties of `window`. This module reads NOTHING by
   itself: index.html hands over window.MythicFarmBridge (defined next to
   MythicCityBridge), and without it the module registers, stays inert and
   warns once. Same seam, same reason, as /src/city and /src/community.

   ⚠ Everything is wrapped so a failure inside the farm can never take the
   game down. The farm is a feature; the game is the product.

   Lifecycle: index.html's renderFarm() writes the shell into #app and calls
   MythicFarm.mount(rootEl). The scene watches its own canvas and disposes
   itself when render() replaces #app's contents, so leaving the screen by
   ANY route (back button, admin route, App.screen set elsewhere) cleans up.
   ════════════════════════════════════════════════════════════════════════════ */

import { FARM_ECON, FARM_ANIMALS, FARM_BUILDINGS, animalDef, buildingDef, buildingCostAt, auditCatalog } from './farm.data.js';
import * as S from './farm.state.js';
import { createScene } from './farm.scene.js';
import { FARM_CSS, renderShell, renderLedger, renderHomestead, renderLivestock } from './farm.render.js';

function makeHost() {
  const B = (typeof window !== 'undefined') ? window.MythicFarmBridge : null;
  if (!B) return null;
  const FALLBACK = { name: 'Unknown', icon: '📦', color: '#cfd6e4', known: false };
  const metaOf = (id) => {
    try {
      const r = (B.resources || []).find(x => x && x.id === id);
      return r ? { name: r.name, icon: r.icon, color: r.color, known: true } : Object.assign({}, FALLBACK, { name: id });
    } catch (e) { return Object.assign({}, FALLBACK, { name: id }); }
  };
  return {
    gems: () => { try { return B.gems() | 0; } catch (e) { return 0; } },
    getRes: (id) => { try { return B.getRes(id) | 0; } catch (e) { return 0; } },
    resMeta: metaOf,
    resourceIds: () => { try { return (B.resources || []).map(r => r && r.id).filter(Boolean); } catch (e) { return []; } },
    spendGems: (n) => { try { return !!B.spendGems(n); } catch (e) { return false; } },
    addGems: (n) => { try { B.addGems(n); } catch (e) {} },
    spendRes: (id, n) => { try { return !!B.spendRes(id, n); } catch (e) { return false; } },
    addRes: (id, n) => { try { B.addRes(id, n); } catch (e) {} },
    refundRes: (id, n) => { try { (B.refundRes || B.addRes)(id, n); } catch (e) {} },
    /* 🔴 These two REPORT failure (return false) — the state module turns a
       false into the exception its refund path is written for. Swallowing
       here would charge the player for a building that never persisted. */
    state: () => { try { return B.farmState(); } catch (e) { return {}; } },
    setState: (s) => { try { return B.setFarmState(s) !== false; } catch (e) { return false; } },
    save: () => { try { return B.save() !== false; } catch (e) { return false; } },
    toast: (m, ms) => { try { B.toast(m, ms); } catch (e) {} },
    confirm: (m) => { try { return Promise.resolve(B.confirm(m)); } catch (e) { return Promise.resolve(false); } },
    back: () => { try { B.back(); } catch (e) {} },
    collectCdMs: (B.collectCdMs | 0) || 6 * 3600000,
    accrualCapH: (B.accrualCapH | 0) || 36,
    isAdmin: () => { try { return !!(B.isAdmin && B.isAdmin()); } catch (e) { return false; } },
  };
}

let _warned = false;
function host() {
  const h = makeHost();
  if (!h && !_warned) {
    _warned = true;
    try { console.warn('[farm] window.MythicFarmBridge is absent — the farm is inert. index.html must hand the module its capabilities (the globals trap).'); } catch (e) {}
  }
  return h;
}

const fmtGot = (h, got) => Object.keys(got || {}).map(k => { const m = h.resMeta(k); return `${m.icon} ${got[k]} ${m.name}`; }).join(', ');

/* ── Mount ─────────────────────────────────────────────────────────────────── */
let _mounted = null;   // { root, scene, tab, focus, tick }

function ensureCss() {
  if (document.getElementById('farm-css')) return;
  const st = document.createElement('style'); st.id = 'farm-css'; st.textContent = FARM_CSS; document.head.appendChild(st);
}

function mount(rootEl) {
  const h = host();
  if (!h || !rootEl) return false;
  unmount();
  ensureCss();
  const missing = auditCatalog(h.resourceIds());
  if (missing.length) { try { console.warn('[farm] ledger is missing ids the farm pays out: ' + missing.join(', ')); } catch (e) {} }

  rootEl.innerHTML = renderShell();
  const m = _mounted = { root: rootEl, scene: null, tab: 'homestead', focus: null, tick: 0, busy: false };
  const stage = rootEl.querySelector('[data-farm="stage"]');

  const paint = () => {
    if (_mounted !== m) return;
    try {
      const s = S.ensureState(h);
      const view = S.summary(h, s);
      const led = rootEl.querySelector('[data-farm="ledger"]'); if (led) led.innerHTML = renderLedger(h);
      const panel = rootEl.querySelector('[data-farm="panel"]');
      if (panel) panel.innerHTML = m.tab === 'livestock' ? renderLivestock(h, s, view, m.focus) : renderHomestead(h, s, view, m.focus);
      rootEl.querySelectorAll('.farm-tab').forEach(t => t.classList.toggle('is-active', t.getAttribute('data-id') === m.tab));
      if (m.scene) m.scene.update(view);
      if (m.focus) { const el = panel && panel.querySelector(`[data-fid="${m.focus}"]`); if (el && m.scrollTo) { try { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {} m.scrollTo = false; } }
    } catch (e) { try { console.warn('[farm] paint failed:', e); } catch (x) {} }
  };
  m.paint = paint;

  createScene(stage, {
    onSelect: (kind, id) => {
      if (_mounted !== m) return;
      m.focus = id; m.scrollTo = true;
      m.tab = (kind === 'animal') ? 'livestock' : 'homestead';
      paint();
    },
  }).then(scene => {
    if (_mounted !== m) { try { scene.destroy(); } catch (e) {} return; }
    m.scene = scene;
    if (scene.mode === '2d') { const hint = rootEl.querySelector('.farm-hint'); if (hint) hint.textContent = '2D view (3D engine unavailable) · tap a building or animal'; }
    paint();
  }).catch(() => {});

  // Refresh the numbers every 20s while open (feed drains, cooldowns tick).
  m.tick = setInterval(() => { if (!rootEl.isConnected || _mounted !== m) { unmount(m); return; } paint(); }, 20000);

  rootEl.addEventListener('click', onClick);
  m.onClick = onClick;
  paint();
  return true;

  async function onClick(e) {
    const t = e.target.closest && e.target.closest('[data-fact]');
    if (!t || _mounted !== m || m.busy) return;
    const act = t.getAttribute('data-fact'), id = t.getAttribute('data-id'), n = parseInt(t.getAttribute('data-n') || '1', 10) || 1;
    e.preventDefault();
    m.busy = true;
    try {
      const s = S.ensureState(h);
      let r;
      switch (act) {
        case 'back': h.back(); return;
        case 'tab': m.tab = id; m.focus = null; break;
        case 'build': {
          const def = buildingDef(id); if (!def) break;
          r = S.build(h, s, id);
          if (r.ok) { h.toast(`${def.emoji} ${def.name} raised.`, 3000); m.focus = id; if (m.scene && m.scene.select) m.scene.select({ kind: 'building', id }); }
          else h.toast(`Cannot build: ${why(h, r)}`, 3600);
          break;
        }
        case 'upgrade': {
          const def = buildingDef(id); if (!def) break;
          r = S.upgrade(h, s, id);
          h.toast(r.ok ? `⬆ ${def.name} is now level ${r.level}.` : `Cannot upgrade: ${why(h, r)}`, 3200);
          break;
        }
        case 'buy': {
          const a = animalDef(id); if (!a) break;
          r = S.buyAnimal(h, s, id, n);
          h.toast(r.ok ? `${a.emoji} Bought ${r.bought} ${r.bought === 1 ? a.name : a.plural}. Keep the trough full — young stock only grows while fed.` : `Cannot buy: ${why(h, r)}`, 4000);
          break;
        }
        case 'feed': {
          r = S.fillTrough(h, s, id, 1e9);
          h.toast(r.ok ? `🌾 Added ${r.added} Animal Feed to the trough.` : `Trough: ${why(h, r)}`, 3000);
          break;
        }
        case 'collect': {
          r = S.collect(h, s, id);
          if (r.ok) h.toast(`🧺 Collected ${fmtGot(h, r.got)}.${r.clipped ? ' Stash full — the rest waits in the pen.' : ''}`, 4200);
          else if (r.why === 'cooldown') h.toast('🧺 Not yet — pens are collected once per cooldown.', 2600);
          else h.toast(`Collect: ${why(h, r)}`, 3000);
          break;
        }
        case 'slaughter': {
          const a = animalDef(id); if (!a) break;
          if (n > 1) { const ok = await h.confirm(`Send ${n} grown ${a.plural.toLowerCase()} to the block? This cannot be undone.`); if (!ok) break; }
          r = S.slaughter(h, s, id, n);
          if (r.ok) h.toast(`🔪 ${r.taken} ${r.taken === 1 ? a.name : a.plural} slaughtered → ${fmtGot(h, r.got)}.${r.clipped ? ' ⚠ Stash full — part of the yield was lost.' : ''}`, 5000);
          else h.toast(`Butcher: ${why(h, r)}`, 3200);
          break;
        }
        case 'craft': {
          const rk = t.getAttribute('data-recipe');
          r = S.craft(h, s, id, rk, n);
          h.toast(r.ok ? `⚙ ${r.batches}× → ${fmtGot(h, r.got)}.${r.clipped ? ' ⚠ Stash full — output was clipped.' : ''}` : `Cannot craft: ${why(h, r)}`, 3600);
          break;
        }
        default: return;
      }
    } catch (err) { try { console.warn('[farm] action failed:', err); } catch (x) {} }
    finally { m.busy = false; paint(); }
  }
}

function why(h, r) {
  if (!r) return 'unknown';
  if (r.why === 'short' && r.shortfall) return 'short by ' + Object.keys(r.shortfall).map(k => k === 'cinder' ? `🔥${r.shortfall[k]} Cinder` : `${h.resMeta(k).icon}${r.shortfall[k]} ${h.resMeta(k).name}`).join(', ');
  return r.why || 'unknown';
}

function unmount(which) {
  const m = which || _mounted;
  if (!m) return;
  if (_mounted === m) _mounted = null;
  try { clearInterval(m.tick); } catch (e) {}
  try { if (m.scene) m.scene.destroy(); } catch (e) {}
  try { if (m.onClick) m.root.removeEventListener('click', m.onClick); } catch (e) {}
}

const api = {
  FARM_ECON, FARM_ANIMALS, FARM_BUILDINGS, animalDef, buildingDef, buildingCostAt, auditCatalog,
  ready: () => !!makeHost(),
  mount, unmount,
  refresh: () => { try { if (_mounted && _mounted.paint) _mounted.paint(); } catch (e) {} },
  state: () => { const h = host(); return h ? S.ensureState(h) : { buildings: {}, animals: [] }; },
  summary: () => { const h = host(); return h ? S.summary(h, S.ensureState(h)) : null; },
  // Exposed for the harness and for any future caller (all bound to the live bridge).
  build: (id) => { const h = host(); return h ? S.build(h, S.ensureState(h), id) : { ok: false, why: 'no bridge' }; },
  upgrade: (id) => { const h = host(); return h ? S.upgrade(h, S.ensureState(h), id) : { ok: false, why: 'no bridge' }; },
  buyAnimal: (sp, n) => { const h = host(); return h ? S.buyAnimal(h, S.ensureState(h), sp, n) : { ok: false, why: 'no bridge' }; },
  fillTrough: (id, n) => { const h = host(); return h ? S.fillTrough(h, S.ensureState(h), id, n) : { ok: false, why: 'no bridge' }; },
  collect: (id) => { const h = host(); return h ? S.collect(h, S.ensureState(h), id) : { ok: false, why: 'no bridge' }; },
  slaughter: (sp, n) => { const h = host(); return h ? S.slaughter(h, S.ensureState(h), sp, n) : { ok: false, why: 'no bridge' }; },
  craft: (id, rk, n) => { const h = host(); return h ? S.craft(h, S.ensureState(h), id, rk, n) : { ok: false, why: 'no bridge' }; },
  _state: S,
};

try { if (typeof window !== 'undefined') window.MythicFarm = api; } catch (e) {}
export default api;
