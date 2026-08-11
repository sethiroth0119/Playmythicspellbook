/* ════════════════════════════════════════════════════════════════════════════
   🏭 CITY PRODUCTION — module entry point. Registers window.MythicCityProduction.
   ----------------------------------------------------------------------------
   Spec: CLAUDE_TASK_buildings.md. New features live OUTSIDE index.html
   (CLAUDE.md), so the catalog, the cost grammar, the accrual and the UI are all
   here and NONE of it is added to index.html.

   🔴 THE GLOBALS TRAP. `Profile`, `Cloud`, `App`, `Corp`, `Forge` are top-level
   `const` in index.html — global LEXICAL bindings, NOT properties of `window`.
   An ES module cannot see them and `window.Profile` is undefined however global
   `const Profile` looks. This has cost real time twice. So this module reads
   NOTHING by itself: index.html hands over window.MythicCityBridge, and if the
   bridge is missing the module registers, stays inert, and says so once.

   ⚠ Everything here is wrapped so a failure inside production can never take
   the game down. The city is a feature; the game is the product.
   ════════════════════════════════════════════════════════════════════════════ */

import { CITY_PRODUCTION, cityProdDef, auditCatalog } from './production.data.js';
import { normCost, buildingCostAt, canAfford, shortfall, spendCost, costHtml, splitCost } from './cost.js';
import {
  ensureState, placed, cityBudget, storageState, haltState, pending,
  collect, build, upgrade, HALT, terroirFactor, chainCeilingFor,
} from './production.state.js';
/* 🗺 TERROIR — imported for its side effect (it registers window.MythicTerroir,
   which is how index.html's non-module code reaches it: module → window is the
   direction that works; window → `const Profile` is the direction that does
   not, and is the globals trap this file already documents). */
import Terroir from './terroir.js';
import { PRODUCTION_CSS, renderBlueprints, renderPlaced, renderVitals } from './production.render.js';

/* The host adapter. Every legacy capability the modules need, and nothing more —
   a narrow seam is what keeps "what does this module touch?" answerable. */
function makeHost() {
  const B = (typeof window !== 'undefined') ? window.MythicCityBridge : null;
  if (!B) return null;
  const FALLBACK = { name: 'Unknown', icon: '📦', color: '#cfd6e4', known: false };
  const metaOf = (id) => {
    try {
      const list = B.resources || [];
      const r = list.find(x => x && x.id === id);
      return r ? { name: r.name, icon: r.icon, color: r.color, known: true } : Object.assign({}, FALLBACK, { name: id });
    } catch (e) { return Object.assign({}, FALLBACK, { name: id }); }
  };
  return {
    // ── reads
    gems: () => { try { return B.gems() | 0; } catch (e) { return 0; } },
    getRes: (id) => { try { return B.getRes(id) | 0; } catch (e) { return 0; } },
    resMeta: metaOf,
    resName: (id) => metaOf(id).name,
    resourceCap: () => { try { return B.resourceCap() | 0; } catch (e) { return 0; } },
    resourceUnits: () => { try { return B.resourceUnits() | 0; } catch (e) { return 0; } },
    workerPool: () => { try { return B.workerPool ? (B.workerPool() | 0) : 0; } catch (e) { return 0; } },
    // ── writes, all through the sanctioned helpers. Never Profile.gems directly.
    spendGems: (n) => { try { return !!B.spendGems(n); } catch (e) { return false; } },
    addGems: (n) => { try { B.addGems(n); } catch (e) {} },
    spendRes: (id, n) => { try { return !!B.spendRes(id, n); } catch (e) { return false; } },
    addRes: (id, n) => { try { B.addRes(id, n); } catch (e) {} },
    // ↩️ Uncapped undo — see the refund note in cost.js. Falls back to addRes
    //    only if an older bridge is mounted without it.
    refundRes: (id, n) => { try { (B.refundRes || B.addRes)(id, n); } catch (e) {} },
    /* ── persistence
       🔴 THESE TWO REPORT FAILURE. THEY USED TO SWALLOW IT.
       `setState: (s) => { try { B.setProdState(s); } catch (e) {} }` made
       build()'s refund-on-record-failure branch unreachable: a throw from
       setProdState or saveProfile died here, build() returned {ok:true}, and
       the player was charged 50,000 Cinder for a building that never persisted.
       Driven and confirmed by the critic. Still no throw escapes the module —
       the failure is returned as `false` and production.state.js's `record()`
       turns it back into the exception the refund path is written for. */
    state: () => { try { return B.prodState(); } catch (e) { return {}; } },
    setState: (s) => { try { return B.setProdState(s) !== false; } catch (e) { return false; } },
    save: () => { try { return B.save() !== false; } catch (e) { return false; } },
    // ── chrome
    toast: (m, ms) => { try { B.toast(m, ms); } catch (e) {} },
    // ── the existing idle contract, passed not redeclared
    collectCdMs: (B.collectCdMs | 0) || 6 * 3600000,
    accrualCapH: (B.accrualCapH | 0) || 36,
    /* 🏙 VITALS MULTIPLIER HOOK — cityOutputMultipliers() does not exist in this
       codebase (grepped: no definition, no caller). §4.5 says apply it if it
       exists, else leave a marked hook. If the bridge ever exposes
       outputMultipliers(defId), production.state.js picks it up automatically. */
    outputMultipliers: (typeof B.outputMultipliers === 'function') ? B.outputMultipliers : null,
  };
}

let _warned = false;
function host() {
  const h = makeHost();
  if (!h && !_warned) {
    _warned = true;
    try { console.warn('[city/production] window.MythicCityBridge is absent — production is inert. index.html must hand the module its capabilities (the globals trap).'); } catch (e) {}
  }
  return h;
}

const api = {
  CITY_PRODUCTION, cityProdDef, HALT, PRODUCTION_CSS,
  /* 🗺 Terroir, re-exported so a caller holding MythicCityProduction does not
     need to know there are two modules. Same object as window.MythicTerroir. */
  terroir: Terroir,
  terroirFactor: (p, resId) => { const h = host(); try { return h ? terroirFactor(h, p, resId) : 1; } catch (e) { return 1; } },
  chainCeiling: (resId) => { try { return chainCeilingFor(resId); } catch (e) { return 1; } },
  // Pure helpers, exposed for tests and for any future caller.
  normCost, splitCost, buildingCostAt, auditCatalog,
  ready: () => !!makeHost(),
  // Bound to the live bridge on each call so a late-mounted bridge still works.
  costAt: (defId, lvl) => buildingCostAt(cityProdDef(defId), lvl),
  canAfford: (cost) => { const h = host(); return h ? canAfford(h, cost) : false; },
  shortfall: (cost) => { const h = host(); return h ? shortfall(h, cost) : {}; },
  costHtml: (cost, o) => { const h = host(); return h ? costHtml(h, cost, o) : ''; },
  spend: (cost, opts) => { const h = host(); return h ? spendCost(h, cost, opts) : { ok: false, why: 'no bridge' }; },
  state: () => { const h = host(); return h ? ensureState(h) : { placed: [] }; },
  placed: () => { const h = host(); return h ? placed(h) : []; },
  budget: () => { const h = host(); return h ? cityBudget(h) : null; },
  storage: () => { const h = host(); return h ? storageState(h) : null; },
  /* 📦 THE WAREHOUSE'S STORAGE, FOR THE LEDGER TO ADD TO ITS REAL CAP.
     index.html's getResourceCap() calls this (via _cityProdStorage) so a placed
     Warehouse raises the cap that addRes() actually enforces. Before this the
     effect existed only inside the module's own belief, and the gap between the
     two destroyed 270 units on a measured collect.
     ⚠ MUST NOT read host.resourceCap() — getResourceCap() is its caller and
     that would recurse. cityBudget() reads placed rows only; keep it that way. */
  storageBonus: () => { const h = host(); try { return h ? (cityBudget(h).storage | 0) : 0; } catch (e) { return 0; } },
  halt: (p) => { const h = host(); return h ? haltState(h, p) : null; },
  pending: (p) => { const h = host(); return h ? pending(h, p) : null; },
  build: (defId, at) => { const h = host(); return h ? build(h, defId, at) : { ok: false, why: 'no bridge' }; },
  upgrade: (id) => { const h = host(); return h ? upgrade(h, id) : { ok: false, why: 'no bridge' }; },
  collect: (id) => { const h = host(); return h ? collect(h, id) : { ok: false, why: 'no bridge' }; },
  renderBlueprints: () => { const h = host(); return h ? renderBlueprints(h) : ''; },
  renderPlaced: () => { const h = host(); return h ? renderPlaced(h) : ''; },
  renderVitals: () => { const h = host(); return h ? renderVitals(h) : ''; },
  /* Wire the three data-attributes the renderers emit. Called by whatever screen
     mounts the panel; safe to call repeatedly. */
  bind: (root) => {
    const h = host(); if (!h || !root) return;
    const go = (fn) => { const r = fn(); if (r && r.why) h.toast(r.why, 4200); try { if (window.MythicCityBridge.render) window.MythicCityBridge.render(); } catch (e) {} return r; };
    root.querySelectorAll('[data-cprod-build]').forEach(b => { b.onclick = () => go(() => build(h, b.getAttribute('data-cprod-build'), {})); });
    root.querySelectorAll('[data-cprod-upgrade]').forEach(b => { b.onclick = () => go(() => upgrade(h, b.getAttribute('data-cprod-upgrade'))); });
    root.querySelectorAll('[data-cprod-collect]').forEach(b => {
      b.onclick = () => { const r = go(() => collect(h, b.getAttribute('data-cprod-collect'))); if (r && r.ok) h.toast('📥 Collected.', 2400); };
    });
  },
};

try {
  if (typeof window !== 'undefined') {
    window.MythicCityProduction = api;
    // Inject the stylesheet once, lazily — a module that appends a <style> on
    // import costs nothing when the panel is never opened.
    if (!document.getElementById('cprod-css')) {
      const el = document.createElement('style');
      el.id = 'cprod-css'; el.textContent = PRODUCTION_CSS;
      document.head.appendChild(el);
    }
  }
} catch (e) { try { console.warn('[city/production] registration failed:', e); } catch (e2) {} }

export default api;
