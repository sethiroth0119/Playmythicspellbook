/* ============================================================================
   🐟 FISHING ECONOMY — module entry point. Registers window.MythicFishing.
   ============================================================================
   The economy layer of the Woods Fishing expansion: the Cold Storage supply
   board, the processing bench and the contracts board. The 3D trip, the fleet
   and the fishing screen shell stay in index.html (they are an existing
   system, extended in place); this module is the NEW system — where the catch
   is needed — and lives out here per CLAUDE.md.

   🔴 THE GLOBALS TRAP. Profile / App / Forge / RESOURCES are top-level `const`
   in index.html — lexical bindings, NOT on window. This module reads NOTHING
   by itself: index.html hands over window.MythicFishingBridge, and without it
   the module registers, stays inert, and the fishing screen falls back to its
   legacy Cold Storage panel. Nothing here can throw its way into render().

   WHAT THIS OWNS
     • demand.js — recipes, contracts, the burn/make balance (pure)
     • render.js — the two tabs' markup
     • this file — the bridge wiring, the contract ledger on the fishing corp
                   state (handed over by reference), and bind()

   WHAT THIS DOES NOT OWN
     Any Supabase call, any THREE object, any Cinder mutation outside the
     bridge's spendGems/addGems. The catch itself is banked by index.html's
     addRes at the moment it is landed — this module only moves what is
     already in the stash.
   ============================================================================ */

import * as D from './demand.js';
import * as R from './render.js';

const B = () => (typeof window !== 'undefined' ? window.MythicFishingBridge : null) || null;
const CP = () => (typeof window !== 'undefined' ? window.MythicCityProduction : null) || null;

let _warned = false;
function warnOnce(msg) { if (_warned) return; _warned = true; try { console.warn('[fishing] ' + msg); } catch (e) {} }

/* The read surface. Every accessor degrades to zero / empty with no bridge. */
const ctx = {
  meta: (id) => { const b = B(); try { return (b && b.meta && b.meta(id)) || { id, name: id, icon: '📦' }; } catch (e) { return { id, name: id, icon: '📦' }; } },
  getRes: (id) => { const b = B(); try { return (b && b.getRes ? b.getRes(id) : 0) | 0; } catch (e) { return 0; } },
  price: (id) => { const b = B(); try { const p = b && b.marketPrice && b.marketPrice(id); return p ? { base: +p.base || 0, current: +p.current || 0, delta: +p.delta24h || 0 } : { base: 0, current: 0, delta: 0 }; } catch (e) { return { base: 0, current: 0, delta: 0 }; } },
  stashCap: () => { const b = B(); try { return (b && b.resourceCap ? b.resourceCap() : 0) | 0; } catch (e) { return 0; } },
  stashUnits: () => { const b = B(); try { return (b && b.resourceUnits ? b.resourceUnits() : 0) | 0; } catch (e) { return 0; } },
  seed: () => { const b = B(); try { return (b && b.userId && b.userId()) || ''; } catch (e) { return ''; } },
  toast: (m, ms) => { const b = B(); try { b && b.toast && b.toast(m, ms); } catch (e) {} },
};

/* ── Fishing-corp state (contract ledger) ──────────────────────────────────
   Lives on Profile.fishingCorp.contracts, which index.html already cloud-syncs
   as part of __fishingCorp__. Handed over BY REFERENCE through bridge.corp()
   so a write here is a write to the real save. Absent-tolerant on load. */
function ledger() {
  const b = B(); let f = null;
  try { f = b && b.corp && b.corp(); } catch (e) { f = null; }
  if (!f || typeof f !== 'object') return { done: {}, filled: 0, earned: 0, delivered: 0 };
  if (!f.contracts || typeof f.contracts !== 'object') f.contracts = {};
  const c = f.contracts;
  if (!c.done || typeof c.done !== 'object') c.done = {};
  if (typeof c.filled !== 'number') c.filled = 0;
  if (typeof c.earned !== 'number') c.earned = 0;
  if (typeof c.delivered !== 'number') c.delivered = 0;
  // Prune fulfilment marks older than two windows so the map cannot grow forever.
  const wk = D.windowKey();
  for (const k in c.done) { const kw = parseInt(String(k).split(':')[0], 10); if (isFinite(kw) && kw < wk - 1) delete c.done[k]; }
  return c;
}

/* ── City + ops demand inputs ───────────────────────────────────────────────
   placed rows come from the city module (window → window is the direction
   that works); ops come through the bridge because Operations/_opEcon are
   index.html lexicals. */
function placedRows() {
  const cp = CP(); if (!cp) return null;
  try { return (cp.placed() || []).map((p) => ({ defId: p.defId, level: p.level | 0 || 1, def: cp.cityProdDef(p.defId) })).filter((p) => p.def); } catch (e) { return []; }
}
function opRows() { const b = B(); try { return (b && b.ops && b.ops()) || []; } catch (e) { return []; } }

function storageModel() {
  const placed = placedRows(); const ops = opRows();
  const demand = D.demandFor(placed || [], ops);
  const rows = D.FISH_IDS.map((id) => ({ id, meta: ctx.meta(id), have: ctx.getRes(id), price: ctx.price(id), demand: demand[id] }));
  const placedFish = (placed || []).filter((p) => D.FISH_IDS.some((id) => (p.def.inputs || {})[id] || (p.def.yields || {})[id])).length;
  return { rows, stashCap: ctx.stashCap(), stashUnits: ctx.stashUnits(), cityReady: placed !== null, placedFish, opsCount: ops.length };
}
function contractsModel() {
  const L = ledger(); const now = Date.now();
  const list = D.contractsFor(ctx.seed(), now, (id) => ctx.price(id).current).map((c) => {
    const have = ctx.getRes(c.res); const price = ctx.price(c.res).current;
    return Object.assign({}, c, { have, price, payout: D.payoutFor(c.units, c.premium, price), done: !!L.done[c.id], canFill: have >= c.units });
  });
  return { contracts: list, endsAt: D.windowEndsAt(now), filledCount: L.filled | 0, earned: L.earned | 0, delivered: L.delivered | 0 };
}

/* ── Actions ────────────────────────────────────────────────────────────────
   Both are all-or-nothing: preflight, then spend, then credit; a refused spend
   leaves everything untouched. Outputs go through addRes (cap-enforced) and a
   short delivery is reported, never silent — the lesson of settle.js. */
function process(recipeId, count) {
  const b = B(); if (!b) return { ok: false, why: 'no bridge' };
  const rc = D.recipeById(recipeId); if (!rc) return { ok: false, why: 'unknown recipe' };
  const can = D.batchesAffordable(rc, ctx.getRes);
  let nB = (count === 'all') ? can : Math.min(can, Math.max(1, count | 0));
  if (nB <= 0) return { ok: false, why: 'Not enough ' + Object.keys(rc.inputs).map((k) => ctx.meta(k).name).join(' / ') + ' for a batch.' };
  // Do not cook what the stash cannot hold — output minus input must fit.
  const inU = Object.values(rc.inputs).reduce((s, v) => s + (v | 0), 0), outU = Object.values(rc.outputs).reduce((s, v) => s + (v | 0), 0);
  const free = Math.max(0, ctx.stashCap() - ctx.stashUnits());
  if (outU > inU) nB = Math.min(nB, Math.floor((free + inU * nB) / outU));
  if (nB <= 0) return { ok: false, why: 'Stash full — the output has nowhere to go.' };
  const spend = {}; for (const k in rc.inputs) spend[k] = rc.inputs[k] * nB;
  if (!b.spendMany(spend)) return { ok: false, why: 'Could not take the inputs from the stash.' };
  const got = {}; for (const k in rc.outputs) { const q = rc.outputs[k] * nB; b.addRes(k, q); got[k] = q; }
  try { b.consumed(spend); b.produced(got, 'coldstorage'); } catch (e) {}
  try { b.log('info', rc.name + ' ×' + nB + ' → ' + Object.keys(got).map((k) => got[k] + ' ' + ctx.meta(k).name).join(', ')); } catch (e) {}
  b.save();
  return { ok: true, batches: nB, got };
}
function fill(contractId) {
  const b = B(); if (!b) return { ok: false, why: 'no bridge' };
  const L = ledger(); if (L.done[contractId]) return { ok: false, why: 'Already delivered.' };
  const c = D.contractsFor(ctx.seed(), Date.now(), (id) => ctx.price(id).current).find((x) => x.id === contractId);
  if (!c) return { ok: false, why: 'That order has expired — the board re-rolled.' };
  if (ctx.getRes(c.res) < c.units) return { ok: false, why: 'Short ' + (c.units - ctx.getRes(c.res)) + ' ' + ctx.meta(c.res).name + '.' };
  const pay = D.payoutFor(c.units, c.premium, ctx.price(c.res).current);   // re-priced NOW, not at render
  if (!b.spendMany({ [c.res]: c.units })) return { ok: false, why: 'Could not take the fish from the stash.' };
  b.addGems(pay, 'Fishing contract: ' + c.buyer);
  L.done[contractId] = Date.now(); L.filled = (L.filled | 0) + 1; L.earned = (L.earned | 0) + pay; L.delivered = (L.delivered | 0) + c.units;
  try { b.consumed({ [c.res]: c.units }); } catch (e) {}                    // demand — lifts the exchange
  try { b.fishingXp(c.xp); } catch (e) {}
  try { b.log('good', 'Delivered ' + c.units + ' ' + ctx.meta(c.res).name + ' to ' + c.buyer + ' for ¢' + pay.toLocaleString() + '.'); } catch (e) {}
  b.save();
  return { ok: true, pay, xp: c.xp, contract: c };
}

const api = {
  ready: () => !!B(),
  D,
  renderStorage: () => { try { return R.renderStorage(ctx, storageModel()); } catch (e) { warnOnce('renderStorage: ' + e); return ''; } },
  renderContracts: () => { try { return R.renderContracts(ctx, contractsModel()); } catch (e) { warnOnce('renderContracts: ' + e); return ''; } },
  storageModel, contractsModel, process, fill,
  /* Wire the data-attributes the renderers emit. Safe to call repeatedly. */
  bind: (root) => {
    const b = B(); if (!b || !root) return;
    const rerender = () => { try { b.render(); } catch (e) {} };
    root.querySelectorAll('[data-fish-sell]').forEach((el) => { el.onclick = () => { try { b.openMarket(el.getAttribute('data-fish-sell')); } catch (e) {} }; });
    root.querySelectorAll('[data-fish-process]').forEach((el) => {
      el.onclick = () => {
        const nAttr = el.getAttribute('data-n'); const r = process(el.getAttribute('data-fish-process'), nAttr === 'all' ? 'all' : (nAttr | 0));
        if (!r.ok) { ctx.toast('⚠ ' + r.why, 3200); return; }
        ctx.toast('🥫 ' + r.batches + ' batch' + (r.batches === 1 ? '' : 'es') + ' → ' + Object.keys(r.got).map((k) => '+' + r.got[k] + ' ' + ctx.meta(k).icon).join(' '), 3000);
        rerender();
      };
    });
    root.querySelectorAll('[data-fish-fill]').forEach((el) => {
      el.onclick = () => {
        const r = fill(el.getAttribute('data-fish-fill'));
        if (!r.ok) { ctx.toast('⚠ ' + r.why, 3200); return; }
        ctx.toast('📜 Delivered to ' + r.contract.buyer + ' — +¢' + r.pay.toLocaleString() + ' · +' + r.xp + ' fishing XP', 4200);
        rerender();
      };
    });
  },
};

try {
  if (typeof window !== 'undefined') {
    window.MythicFishing = api;
    if (!B()) warnOnce('window.MythicFishingBridge is absent — the fishing economy tabs fall back to the legacy panel (the globals trap).');
  }
} catch (e) { try { console.warn('[fishing] registration failed:', e); } catch (e2) {} }

export default api;
