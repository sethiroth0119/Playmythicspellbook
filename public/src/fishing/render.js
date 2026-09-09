/* ============================================================================
   🐟 FISHING RENDER — Cold Storage (supply board) and the Contracts tab.
   ============================================================================
   Every pixel of the two economy tabs in the Woods Fishing screen. Markup only:
   the numbers come from demand.js, the reads/writes from the bridge (ctx), and
   the wiring from index.js `bind()`. Reuses the screen's existing `wfa-*`
   classes so the tabs sit inside the maritime-ops shell without a second
   stylesheet.

   Tri-state everywhere: a missing city module prints "no city yet" rather than
   a blank panel; a missing bridge prints a one-line notice.
   ============================================================================ */

import { FISH_IDS, RECIPES, batchesAffordable, coverageCycles, windowEndsAt } from './demand.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (v) => (Number(v) || 0).toLocaleString();
const RAR_COL = { freshFish: '#6fc0d8', shellfish: '#d8b48a', seafood: '#e08a5a', seaweed: '#7fb37a' };

function fmtEta(ms) { const m = Math.max(0, Math.ceil(ms / 60000)); return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm'; }

/* ── COLD STORAGE ─────────────────────────────────────────────────────────── */
export function renderStorage(ctx, model) {
  // model: { rows: [{id, meta, have, price:{base,current,delta}, demand}], stashFree, stashCap, cityReady, opsCount }
  const rows = model.rows.map((r) => {
    const col = RAR_COL[r.id] || '#cfd6e4';
    const d = r.demand || { burnCycle: 0, burnHour: 0, makeCycle: 0, makeHour: 0, buildings: [], ops: [] };
    const cov = coverageCycles(r.have, d.burnCycle);
    const covTxt = d.burnCycle > 0 ? (cov === Infinity ? '∞' : cov + ' cycle' + (cov === 1 ? '' : 's')) : (d.burnHour > 0 ? 'ops only' : '—');
    const delta = Number(r.price.delta) || 0;
    const users = d.buildings.concat(d.ops).filter((x) => x.n < 0).map((x) => esc(x.name)).join(', ');
    const makers = d.buildings.concat(d.ops).filter((x) => x.n > 0).map((x) => esc(x.name)).join(', ');
    return '<tr>' +
      '<td><span style="font-size:1.15rem;margin-right:0.4rem">' + r.meta.icon + '</span><b style="color:' + col + '">' + esc(r.meta.name) + '</b>' +
        (users || makers ? '<div style="font-size:0.66rem;color:#7d97a8;margin-top:2px">' + (users ? 'eaten by ' + users : '') + (users && makers ? ' · ' : '') + (makers ? 'made by ' + makers : '') + '</div>' : '') + '</td>' +
      '<td class="wfa-num">' + n(r.have) + '</td>' +
      '<td class="wfa-num" style="color:#e6b660">¢' + n(Math.round(r.price.current)) + ' <span style="font-size:0.66rem;color:' + (delta >= 0 ? '#a3d977' : '#cf6868') + '">' + (delta >= 0 ? '▲' : '▼') + Math.abs(delta).toFixed(0) + '%</span></td>' +
      '<td class="wfa-num">' + (d.burnCycle > 0 ? '<span style="color:#cf6868">−' + n(d.burnCycle) + '</span>' : '<span class="muted">0</span>') + (d.makeCycle > 0 ? ' <span style="color:#a3d977">+' + n(d.makeCycle) + '</span>' : '') + '</td>' +
      '<td class="wfa-num">' + (d.burnHour > 0 ? '<span style="color:#cf6868">−' + d.burnHour + '</span>' : '<span class="muted">0</span>') + (d.makeHour > 0 ? ' <span style="color:#a3d977">+' + d.makeHour + '</span>' : '') + '</td>' +
      '<td class="wfa-num" style="color:' + (d.burnCycle > 0 && cov < 2 ? '#cf6868' : '#e8dcc4') + '">' + covTxt + '</td>' +
      '<td class="wfa-num" style="white-space:nowrap"><button class="wfa-mini-btn" data-fish-sell="' + r.id + '"' + (r.have > 0 ? '' : ' disabled') + '>⇄ SELL</button></td>' +
    '</tr>';
  }).join('');

  const recipes = RECIPES.map((rc) => {
    const can = batchesAffordable(rc, ctx.getRes);
    const ins = Object.keys(rc.inputs).map((k) => ctx.meta(k).icon + ' ' + rc.inputs[k] + ' ' + esc(ctx.meta(k).name)).join(' + ');
    const outs = Object.keys(rc.outputs).map((k) => ctx.meta(k).icon + ' ' + rc.outputs[k] + ' ' + esc(ctx.meta(k).name)).join(' + ');
    return '<div class="wfa-rep-card" style="margin-bottom:0.55rem">' +
      '<div class="wfa-rep-h"><span>' + rc.icon + ' ' + esc(rc.name) + '</span><span style="color:' + (can > 0 ? '#a3d977' : '#7d97a8') + '">' + (can > 0 ? can + ' batch' + (can === 1 ? '' : 'es') + ' ready' : 'short of inputs') + '</span></div>' +
      '<div class="wfa-rep-body"><div style="font-size:0.72rem;color:#9aa3b2">' + esc(rc.blurb) + '</div>' +
        '<div style="font-size:0.74rem;margin-top:0.3rem;color:#cdd3df">' + ins + ' <span style="color:#7d97a8">→</span> ' + outs + '</div>' +
        '<div class="wfa-rep-actions" style="margin-top:0.4rem">' +
          '<button class="wfa-mini-btn" data-fish-process="' + rc.id + '" data-n="1"' + (can > 0 ? '' : ' disabled') + '>×1</button> ' +
          '<button class="wfa-mini-btn" data-fish-process="' + rc.id + '" data-n="5"' + (can >= 5 ? '' : ' disabled') + '>×5</button> ' +
          '<button class="wfa-mini-btn" data-fish-process="' + rc.id + '" data-n="all"' + (can > 0 ? '' : ' disabled') + '>ALL (' + can + ')</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  const cityNote = model.cityReady
    ? (model.placedFish > 0 ? '<span style="color:#a3d977">● ' + model.placedFish + ' FISH BUILDING' + (model.placedFish === 1 ? '' : 'S') + ' PLACED</span>' : '<span style="color:#e6b660">NO FISH BUILDINGS YET — a Cannery turns 30 fish into 70 food a cycle</span>')
    : '<span class="muted">CITY MODULE OFFLINE</span>';

  return '<div class="wfa-storage">' +
    '<div class="wfa-panel-header">COLD STORAGE  <span class="wfa-panel-crumb">THE CATCH · WHERE IT GOES</span></div>' +
    '<div class="wfa-panel">' +
      '<div class="wfa-panel-h"><h3>SUPPLY BOARD</h3><span>STASH ' + n(model.stashUnits) + ' / ' + n(model.stashCap) + ' · ' + cityNote + '</span></div>' +
      '<div style="overflow-x:auto"><table class="wfa-table">' +
        '<thead><tr><th>RESOURCE</th><th>IN STASH</th><th>EXCHANGE</th><th>CITY / CYCLE</th><th>OPS / HR</th><th>COVERS</th><th></th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table></div>' +
      '<div style="font-size:0.68rem;color:#7d97a8;margin-top:0.5rem;letter-spacing:0.08em">CITY / CYCLE = what your placed buildings burn (−) and make (+) per 6h collection. OPS / HR = staffed operations. SELL opens the Player Market with the resource picked.</div>' +
    '</div>' +
    '<div class="wfa-grid-1-1" style="margin-top:0.8rem">' +
      '<div class="wfa-panel">' +
        '<div class="wfa-panel-h"><h3>PROCESSING BENCH</h3><span>INSTANT · WORSE THAN THE BUILDINGS</span></div>' +
        recipes +
      '</div>' +
      '<div class="wfa-panel">' +
        '<div class="wfa-panel-h"><h3>WHERE FISH IS NEEDED</h3><span>THE CHAIN</span></div>' +
        '<div style="font-size:0.78rem;line-height:1.6;color:#cdd3df">' +
          '<div>🐟 <b style="color:#6fc0d8">Fresh Fish</b> → 🥫 <b>Cannery</b> (city, 30 → 70 food) · 🏭 <b>Fish Cannery</b> op · bait for the 🐠 <b>Deepwater Pier</b> · canteen contracts</div>' +
          '<div>🦪 <b style="color:#d8b48a">Shellfish</b> → galley &amp; rig-kitchen contracts · shuck for food + supplies</div>' +
          '<div>🐠 <b style="color:#e08a5a">Prime Seafood</b> → 💊 <b>Fish Oil Works</b> (with kelp → medicine) · Apothecary &amp; Research contracts · Legendary catches also drop 🧬 DNA</div>' +
          '<div>🌿 <b style="color:#7fb37a">Seaweed</b> → 💊 <b>Fish Oil Works</b> · Salvage Union rope &amp; compost contracts · dry for rations</div>' +
          '<div style="margin-top:0.4rem;color:#9aa3b2;font-size:0.72rem">Every unit you sell on the Player Market is a unit another survivor\'s Cannery or Oil Works does not have to catch. Every contract you fill lifts the exchange price for everyone still fishing.</div>' +
        '</div>' +
      '</div>' +
    '</div>' +
  '</div>';
}

/* ── CONTRACTS ────────────────────────────────────────────────────────────── */
export function renderContracts(ctx, model) {
  // model: { contracts: [{...contract, done, canFill, have}], endsAt, filledCount, earned }
  const now = Date.now();
  const cards = model.contracts.map((c) => {
    const m = ctx.meta(c.res); const col = RAR_COL[c.res] || '#cfd6e4';
    const pct = Math.min(100, Math.round((c.have / Math.max(1, c.units)) * 100));
    return '<div class="wfa-rep-card" style="margin-bottom:0.6rem;' + (c.done ? 'opacity:0.55' : '') + '">' +
      '<div class="wfa-rep-h"><span>📜 ' + esc(c.buyer) + '</span><span style="color:' + (c.done ? '#a3d977' : '#e6b660') + '">' + (c.done ? '✔ DELIVERED' : '¢' + n(c.payout) + ' · +' + c.xp + ' XP') + '</span></div>' +
      '<div class="wfa-rep-body">' +
        '<div style="font-size:0.72rem;color:#9aa3b2">' + esc(c.blurb) + '</div>' +
        '<div style="font-size:0.84rem;margin-top:0.35rem;color:#e8dcc4">Wants <b style="color:' + col + '">' + m.icon + ' ' + n(c.units) + ' ' + esc(m.name) + '</b> <span style="font-size:0.7rem;color:#7d97a8">· ' + Math.round((c.premium - 1) * 100) + '% over exchange (¢' + n(Math.round(c.price)) + '/unit now)</span></div>' +
        '<div class="wfa-exp-bar" style="margin-top:0.35rem"><div class="wfa-exp-fill" style="width:' + pct + '%;background:' + col + '"></div></div>' +
        '<div class="wfa-rep-row" style="margin-top:0.35rem"><span style="font-size:0.7rem;color:#9aa3b2">You hold ' + n(c.have) + ' / ' + n(c.units) + '</span>' +
          (c.done ? '' : '<button class="wfa-mini-btn" data-fish-fill="' + esc(c.id) + '"' + (c.canFill ? '' : ' disabled') + '>' + (c.canFill ? '► DELIVER' : 'SHORT ' + n(c.units - c.have)) + '</button>') +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('') || '<div class="wfa-empty-row">— NO ORDERS ON THE BOARD —</div>';

  return '<div class="wfa-contracts">' +
    '<div class="wfa-panel-header">FISHING CONTRACTS  <span class="wfa-panel-crumb">BUY ORDERS · BOARD RESETS IN ' + fmtEta(model.endsAt - now) + '</span></div>' +
    '<div class="wfa-grid-2-1">' +
      '<div class="wfa-panel">' +
        '<div class="wfa-panel-h"><h3>OPEN ORDERS</h3><span>' + model.contracts.filter((c) => !c.done).length + ' OPEN · ' + model.contracts.filter((c) => c.done).length + ' FILLED</span></div>' +
        cards +
      '</div>' +
      '<div class="wfa-panel">' +
        '<div class="wfa-panel-h"><h3>LEDGER</h3><span>ALL TIME</span></div>' +
        '<div class="wfa-row-split"><span class="muted">CONTRACTS FILLED</span><span>' + n(model.filledCount) + '</span></div>' +
        '<div class="wfa-row-split"><span class="muted">CINDER EARNED</span><span style="color:#e6b660">¢' + n(model.earned) + '</span></div>' +
        '<div class="wfa-row-split"><span class="muted">UNITS DELIVERED</span><span>' + n(model.delivered) + '</span></div>' +
        '<div class="wfa-divider"></div>' +
        '<div style="font-size:0.74rem;color:#9aa3b2;line-height:1.55">Orders pay the <b style="color:#e6b660">live exchange price plus a premium</b>, re-priced at the moment you deliver. Filling one lifts that resource\'s price on the Crash Exchange — demand is real. The board re-rolls every 8 hours and cannot be re-rolled early.</div>' +
        (model.deckhandHint ? '<div style="font-size:0.72rem;color:#7fb9c9;margin-top:0.5rem">' + esc(model.deckhandHint) + '</div>' : '') +
      '</div>' +
    '</div>' +
  '</div>';
}
