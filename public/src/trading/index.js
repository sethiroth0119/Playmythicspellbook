/* ============================================================================
   🤝 TRADING — player-to-player trade + lot listings for the Player Market.
   ============================================================================
   Registers `window.MythicTrading`. INERT until the Resource Exchange renders.

   WHAT THIS OWNS
     • lots.js    — what "100 wood × 10 lots" means, and the anti-deception label
     • settle.js  — the atomic, cap-safe, fully-unwinding property mover
     • render.js  — every pixel, including the tri-state (loading/error/empty)
     • this file  — the bridge wiring and the DOM binding

   WHAT THIS DOES NOT OWN
     The Supabase calls. Those stay in index.html next to `ResMarket`, because
     that is where `Cloud`, `Profile` and the realtime channel live — all
     top-level `const`, none of them on `window` (the globals trap, CLAUDE.md).
     index.html hands this module everything through `window.MythicTradeBridge`
     and calls back into it for markup and for settlement.

   🔴 IF THIS MODULE FAILS TO LOAD the exchange must still work. index.html
      keeps a legacy render path and checks `window.MythicTrading` before every
      call, so a 404 on /src/trading/* costs the player lots and swaps, never
      the market itself.
   ============================================================================ */

import * as Lots from './lots.js';
import * as Settle from './settle.js';
import * as R from './render.js';

const B = () => (typeof window !== 'undefined' ? window.MythicTradeBridge : null) || null;

function warnOnce(msg) {
  if (warnOnce._done) return; warnOnce._done = true;
  try { console.warn('[trading] ' + msg); } catch (e) {}
}

/* The read/write surface the renderers and the settlement engine share.
   Every entry degrades to a harmless zero/no-op when the bridge is absent, so
   nothing in here can throw its way into the render pipeline. */
const ctx = {
  resources: () => { const b = B(); try { return (b && b.resources && b.resources()) || []; } catch (e) { return []; } },
  meta: (id) => { const b = B(); try { return (b && b.meta && b.meta(id)) || { id, name: id, icon: '📦' }; } catch (e) { return { id, name: id, icon: '📦' }; } },
  getRes: (id) => { const b = B(); try { return (b && b.getRes ? b.getRes(id) : 0) | 0; } catch (e) { return 0; } },
  gems: () => { const b = B(); try { return (b && b.gems ? b.gems() : 0) | 0; } catch (e) { return 0; } },
  aza: () => { const b = B(); try { return (b && b.aza ? b.aza() : 0) | 0; } catch (e) { return 0; } },
  ownCount: (k, id) => { const b = B(); try { return (b && b.ownCount ? b.ownCount(k, id) : 0) | 0; } catch (e) { return 0; } },
  resourceCap: () => { const b = B(); try { return (b && b.resourceCap ? b.resourceCap() : 0) | 0; } catch (e) { return 0; } },
  resourceUnits: () => { const b = B(); try { return (b && b.resourceUnits ? b.resourceUnits() : 0) | 0; } catch (e) { return 0; } },
  customCards: () => { const b = B(); try { return (b && b.customCards && b.customCards()) || []; } catch (e) { return []; } },
  customItems: () => { const b = B(); try { return (b && b.customItems && b.customItems()) || []; } catch (e) { return []; } },
};

/* The io handed to settle(). Straight passthrough of the bridge mutators —
   deliberately thin, so a driven test can wrap ONE of these and prove the
   unwind against the game's REAL balances rather than a mock ledger. */
function io() {
  const b = B();
  if (!b) return {};
  return {
    getRes: b.getRes, spendRes: b.spendRes, addRes: b.addRes, refundRes: b.refundRes,
    resourceCap: b.resourceCap, resourceUnits: b.resourceUnits,
    gems: b.gems, spendGems: b.spendGems, addGems: b.addGems,
    aza: b.aza, spendAza: b.spendAza, addAza: b.addAza,
    ownCount: b.ownCount, takeOwned: b.takeOwned, giveOwned: b.giveOwned,
    save: b.save,
  };
}

/* ── Settlement entry points ─────────────────────────────────────────────── */

/** Seller side. Goods leave the stash BEFORE the row is written; the caller
    must refund with `unescrow()` if the insert fails. */
function escrow({ resource, lotSize, lots }, customIo) {
  return Settle.settle(Settle.escrowLegs({ resource, lotSize, lots }), customIo || io());
}
/** Undo an escrow. Uncapped by construction — it goes through refundRes. */
function unescrow({ resource, lotSize, lots }, customIo) {
  const j = customIo || io();
  const n = Lots.totalUnits(lotSize, lots);
  if (n <= 0) return { ok: true, units: 0 };
  try { if (j.refundRes) { j.refundRes(resource, n); if (j.save) j.save(); return { ok: true, units: n }; } } catch (e) {}
  return { ok: false, units: 0 };
}
/** Buyer side. One call, all legs, all-or-nothing. */
function takeLots(row, lots, customIo) {
  const L = Lots.readLots(row);
  const n = Math.max(0, Math.min(L.lotsLeft, Math.floor(Number(lots) || 0)));
  if (n <= 0) return { ok: false, code: 'NO_LOTS', why: 'Choose at least one lot.', rolledBack: false };
  const legs = Settle.buyerLegs({
    resource: row.resource, lotSize: L.lotSize, lots: n,
    currency: row.currency || 'cinders', pricePerLot: row.price | 0,
    wantRes: row.want_res, wantQtyPerLot: row.want_qty | 0,
    wantKind: row.want_kind, wantId: row.want_id,
  });
  const res = Settle.settle(legs, customIo || io());
  res.lots = n; res.units = L.lotSize * n;
  return res;
}
/** Seller's payout for a settled sale — a GAIN, so it respects the cap and
    reports a clamp instead of swallowing it. */
function payout(kind, id, n, customIo) {
  const j = customIo || io();
  if (kind !== 'res') return { ok: false, code: 'BAD_KIND' };
  const before = j.getRes ? j.getRes(id) | 0 : 0;
  if (j.addRes) j.addRes(id, n);
  const after = j.getRes ? j.getRes(id) | 0 : 0;
  if (j.save) { try { j.save(); } catch (e) {} }
  return { ok: (after - before) === n, landed: after - before, wanted: n, code: (after - before) === n ? 'OK' : 'CLAMPED' };
}

/* ── DOM binding ─────────────────────────────────────────────────────────── */
/* handlers = { post({resource,lotSize,lots,mode,price,wantRes,wantQty,wantKind,wantId,wantName}),
                take(listingId, lots), cancel(listingId), refresh() } */
function bind(handlers) {
  handlers = handlers || {};
  const $ = (id) => document.getElementById(id);
  const readForm = () => {
    const sizeSel = $('resmkt-lotsize');
    const custom = $('resmkt-lotsize-custom');
    const lotSize = (sizeSel && sizeSel.value === 'custom')
      ? parseInt((custom || {}).value, 10) : parseInt((sizeSel || {}).value, 10);
    const raw = ($('resmkt-want') || {}).value || '';
    const parts = raw.split('::');
    return {
      resource: ($('resmkt-res') || {}).value,
      lotSize: isNaN(lotSize) ? 0 : lotSize,
      lots: parseInt(($('resmkt-lots') || {}).value, 10) || 0,
      mode: ($('resmkt-mode') || {}).value || 'cinders',
      price: parseInt(($('resmkt-price') || {}).value, 10) || 0,
      wantRes: ($('resmkt-wantres') || {}).value,
      wantQty: parseInt(($('resmkt-wantqty') || {}).value, 10) || 0,
      wantKind: parts[0], wantId: parts[1], wantName: parts.slice(2).join('::'),
    };
  };
  const sync = () => {
    const f = readForm();
    const sizeSel = $('resmkt-lotsize'), custom = $('resmkt-lotsize-custom');
    if (sizeSel && custom) custom.style.display = (sizeSel.value === 'custom') ? '' : 'none';
    const pw = $('resmkt-price-wrap'), tw = $('resmkt-trade-wrap'), ww = $('resmkt-want-wrap');
    if (pw) pw.style.display = (f.mode === 'cinders' || f.mode === 'aza') ? '' : 'none';
    if (tw) tw.style.display = (f.mode === 'trade') ? '' : 'none';
    if (ww) ww.style.display = (f.mode === 'barter') ? '' : 'none';
    const p = R.formPreview(ctx, f);
    const tot = $('resmkt-total'), ask = $('resmkt-ask');
    if (tot) tot.innerHTML = p.total;
    if (ask) ask.innerHTML = p.ask;
  };
  ['resmkt-res', 'resmkt-lotsize', 'resmkt-lotsize-custom', 'resmkt-lots', 'resmkt-mode', 'resmkt-price', 'resmkt-wantres', 'resmkt-wantqty', 'resmkt-want']
    .forEach(id => { const el = $(id); if (el) { el.oninput = sync; el.onchange = sync; } });
  sync();

  const post = $('resmkt-post');
  if (post && handlers.post) post.onclick = async () => {
    post.disabled = true;
    try { await handlers.post(readForm()); } finally { post.disabled = false; }
  };
  const refresh = $('resmkt-refresh');
  if (refresh && handlers.refresh) refresh.onclick = () => handlers.refresh();

  // Per-row lot pickers keep their summary sentence honest on every keystroke.
  document.querySelectorAll('[data-trade-lots]').forEach(inp => {
    const id = inp.getAttribute('data-trade-lots');
    const upd = () => {
      const row = handlers.rowById ? handlers.rowById(id) : null;
      const out = document.querySelector('[data-trade-sum="' + CSS.escape(id) + '"]');
      if (row && out) out.innerHTML = R.takeSummary(row, ctx, parseInt(inp.value, 10) || 0);
    };
    inp.oninput = upd; inp.onchange = upd;
  });
  document.querySelectorAll('[data-trade-take]').forEach(btn => {
    const id = btn.getAttribute('data-trade-take');
    btn.onclick = async () => {
      const inp = document.querySelector('[data-trade-lots="' + CSS.escape(id) + '"]');
      const n = inp ? (parseInt(inp.value, 10) || 0) : 1;
      btn.disabled = true;
      try { if (handlers.take) await handlers.take(id, n); } finally { btn.disabled = false; }
    };
  });
  document.querySelectorAll('[data-resmkt-cancel]').forEach(btn => {
    const id = btn.getAttribute('data-resmkt-cancel');
    btn.onclick = async () => {
      btn.disabled = true;
      try { if (handlers.cancel) await handlers.cancel(id); } finally { btn.disabled = false; }
    };
  });
}

const API = {
  version: 'r12-trading-1',
  lots: Lots, settle: Settle, render: R, ctx, io,
  // maths
  totalUnits: Lots.totalUnits, readLots: Lots.readLots, unitsLabel: Lots.unitsLabel,
  validateLots: Lots.validateLots, priceForLots: Lots.priceForLots, affordableLots: Lots.affordableLots,
  LOT_SIZE_MAX: Lots.LOT_SIZE_MAX, LOT_COUNT_MAX: Lots.LOT_COUNT_MAX,
  // movement
  escrow, unescrow, takeLots, payout, settleLegs: (legs, j) => Settle.settle(legs, j || io()),
  preflight: (legs, j) => Settle.preflight(legs, j || io()),
  // surface
  formHtml: () => R.formHtml(ctx),
  listHtml: (o) => R.listHtml(Object.assign({ ctx }, o)),
  rowHtml: (row, mine) => R.rowHtml(row, ctx, mine),
  takeSummary: (row, n) => R.takeSummary(row, ctx, n),
  bind,
};

try {
  if (typeof window !== 'undefined') {
    window.MythicTrading = API;
    if (!window.MythicTradeBridge) warnOnce('no window.MythicTradeBridge — the exchange will stay on its legacy path.');
  }
} catch (e) {}

export default API;
