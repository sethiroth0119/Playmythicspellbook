/* ============================================================================
   🖥 THE EXCHANGE SURFACE — every pixel the trading feature owns.
   ============================================================================
   Markup lives here, not at the call site, for the same reason the numbers do
   (see lots.js): "100 wood" and "1,000 wood" must never be confusable, and the
   only way to guarantee that is for ONE function to write every quantity.

   🔴 A FAILED READ MUST NEVER RENDER AS EMPTY. This project has shipped
      "No listings" in place of "could not load listings" four times. The list
      renderer below takes an explicit tri-state — loading / error / data — and
      there is deliberately NO code path in which an error falls through to the
      empty-state copy.

   Pure: builds strings, reads no globals. Everything it needs arrives in ctx.
   ============================================================================ */

import { readLots, unitsLabel, priceForLots, validateLots, affordableLots, LOT_SIZE_PRESETS, LOT_COUNT_MAX, LOT_SIZE_MAX } from './lots.js';

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const CIN = '<span class="cinder-icon"></span>';
const AZA = '<span class="aza-icon"></span>';

/* What the seller is asking, PER LOT, spelled out. Never just a bare number:
   a price with no unit next to a quantity with no unit is how a market lies. */
export function askLabel(row, ctx, lots) {
  const n = Math.max(1, Math.floor(Number(lots) || 1));
  const cur = row.currency || 'cinders';
  if (cur === 'trade') {
    const m = ctx.meta(row.want_res);
    const per = Math.max(0, Math.floor(Number(row.want_qty) || 0));
    return `🔄 ${(per * n).toLocaleString()} ${m.icon} ${esc(m.name)}`;
  }
  if (cur === 'barter') return `🔄 ${esc(row.want_name || row.want_id || 'an item')}${n > 1 ? ` ×${n}` : ''}`;
  if (cur === 'aza')    return `${AZA} ${priceForLots(row.price, n).toLocaleString()}`;
  return `${CIN} ${priceForLots(row.price, n).toLocaleString()}`;
}

/* One row of the book. `mine` swaps the action for Cancel. */
export function rowHtml(row, ctx, mine) {
  const L = readLots(row);
  const m = ctx.meta(row.resource);
  const cur = row.currency || 'cinders';
  const perLot = `${L.lotSize.toLocaleString()} ${esc(m.name)}`;
  const stock = L.lotsLeft > 1
    ? `<span class="small-text" style="color:#9ad17a">${L.lotsLeft} lots left</span>`
    : `<span class="small-text ink-dim">last lot</span>`;

  // How many lots can this player actually take right now?
  const purse = cur === 'aza' ? ctx.aza() : cur === 'cinders' ? ctx.gems() : 0;
  const wantHave = cur === 'trade' ? ctx.getRes(row.want_res)
    : cur === 'barter' ? ctx.ownCount(row.want_kind === 'card' ? 'card' : 'item', row.want_id) : 0;
  const max = mine ? L.lotsLeft : affordableLots({
    lotsLeft: L.lotsLeft, pricePerLot: (cur === 'aza' || cur === 'cinders') ? row.price : 0,
    purse, lotSize: L.lotSize, stashFree: Math.max(0, ctx.resourceCap() - ctx.resourceUnits()),
    wantPerLot: cur === 'trade' ? row.want_qty : (cur === 'barter' ? 1 : 0), wantHave,
  });

  const head = `
      <div style="flex:1;min-width:190px">
        <strong style="color:#f0e6d2;font-size:1.02rem">${L.unitsLeft.toLocaleString()} ${esc(m.name)}</strong>
        <span class="small-text ink-dim"> — ${L.lotsLeft > 1 ? `${perLot} per lot × ${L.lotsLeft} lots` : `one lot of ${perLot}`}</span>
        <div class="small-text ink-dim">${mine ? 'your listing' : 'from ' + esc(row.seller_name || 'a survivor')} · ${stock}${cur === 'trade' ? ' · <span style="color:#7fd1e6">swap</span>' : ''}</div>
      </div>`;

  if (mine) {
    return `<div class="trade-row" style="display:flex;align-items:center;gap:0.7rem;flex-wrap:wrap;padding:0.55rem 0.8rem;border-bottom:1px solid rgba(212,175,55,0.16)">
      <span style="font-size:1.3rem">${m.icon}</span>${head}
      <span style="color:#ffd166;white-space:nowrap">${askLabel(row, ctx, 1)} <span class="small-text ink-dim">per lot</span></span>
      <button class="btn-mini btn-danger" data-resmkt-cancel="${esc(row.id)}" title="Pulls the listing and returns all ${L.unitsLeft.toLocaleString()} escrowed ${esc(m.name)}">Cancel</button>
    </div>`;
  }

  const canAny = max >= 1;
  const startAt = canAny ? 1 : 0;
  return `<div class="trade-row" style="display:flex;align-items:center;gap:0.7rem;flex-wrap:wrap;padding:0.55rem 0.8rem;border-bottom:1px solid rgba(212,175,55,0.16)">
      <span style="font-size:1.3rem">${m.icon}</span>${head}
      <span style="color:#ffd166;white-space:nowrap">${askLabel(row, ctx, 1)} <span class="small-text ink-dim">per lot</span></span>
      <label class="small-text ink-dim" style="display:flex;align-items:center;gap:4px">lots
        <input type="number" min="1" max="${L.lotsLeft}" value="${startAt || 1}" style="width:64px"
               data-trade-lots="${esc(row.id)}" ${canAny ? '' : 'disabled'}></label>
      <span class="small-text" id="tradesum-${esc(row.id)}" data-trade-sum="${esc(row.id)}" style="color:#cbd5e8;min-width:170px">${
        canAny ? takeSummary(row, ctx, 1) : '<span style="color:#e0879a">you cannot take a lot yet</span>'}</span>
      <button class="btn-mini" data-trade-take="${esc(row.id)}" ${canAny ? '' : 'disabled'}
        title="${canAny ? '' : esc(cannotWhy(row, ctx))}">${cur === 'trade' || cur === 'barter' ? 'Trade' : 'Buy'}</button>
    </div>`;
}

/* The sentence under the lot picker. THE anti-deception surface: it names the
   exact number of units arriving and the exact price for the lots chosen. */
export function takeSummary(row, ctx, lots) {
  const L = readLots(row);
  const n = Math.max(0, Math.min(L.lotsLeft, Math.floor(Number(lots) || 0)));
  const m = ctx.meta(row.resource);
  if (n <= 0) return '<span style="color:#e0879a">choose at least 1 lot</span>';
  return `→ <strong style="color:#9ad17a">${(L.lotSize * n).toLocaleString()} ${esc(m.name)}</strong> for ${askLabel(row, ctx, n)}`;
}

export function cannotWhy(row, ctx) {
  const L = readLots(row);
  const cur = row.currency || 'cinders';
  if (cur === 'trade') {
    const m = ctx.meta(row.want_res);
    return `This swap wants ${Math.max(0, row.want_qty | 0)} ${m.name} per lot — you have ${ctx.getRes(row.want_res).toLocaleString()}.`;
  }
  if (cur === 'barter') return `This trade wants "${row.want_name || row.want_id}" — you don't have one.`;
  const purse = cur === 'aza' ? ctx.aza() : ctx.gems();
  const free = Math.max(0, ctx.resourceCap() - ctx.resourceUnits());
  if (purse < (row.price | 0)) return `One lot costs ${row.price} ${cur === 'aza' ? 'Aza' : 'Cinders'} — you have ${purse}.`;
  if (free < L.lotSize) return `Your stash has room for ${free} more units; one lot is ${L.lotSize}. Sell or spend something first.`;
  return 'Nothing left to take.';
}

/* ── The book. Tri-state, and NO fall-through from error to empty. ───────── */
export function listHtml({ rows, ctx, mine, loading, error, title, colour }) {
  let body;
  if (error) {
    body = `<div style="padding:1.1rem 1.2rem;background:rgba(224,85,106,0.08);border-left:3px solid #e0556a">
        <div style="color:#e0879a;font-weight:600;margin-bottom:0.25rem">⚠ Could not load the exchange.</div>
        <div class="small-text ink-dim">${esc(error)}</div>
        <div class="small-text ink-dim" style="margin-top:0.4rem">This is <strong>not</strong> the same as "nobody is selling" — there may well be listings you cannot see right now. Hit ↻ Refresh.</div>
      </div>`;
  } else if (loading && !(rows || []).length) {
    body = `<div class="empty-list-note" style="padding:1.2rem">Loading the exchange…</div>`;
  } else if (!(rows || []).length) {
    body = `<div class="empty-list-note" style="padding:1.2rem">${mine
      ? 'You have nothing listed. Escrow some goods above and the market can see them.'
      : 'Nobody is selling or swapping right now. Be the first — list something above.'}</div>`;
  } else {
    body = rows.map(r => rowHtml(r, ctx, !!mine)).join('');
  }
  return `<div class="forge-section-header"><h3 style="color:${colour || '#e6b455'}">${esc(title)}${(rows && rows.length) ? ` (${rows.length})` : ''}</h3></div>
    <div style="background:${mine ? 'rgba(28,22,8,0.5)' : 'rgba(10,13,19,0.6)'};border:1px solid ${mine ? 'rgba(212,175,55,0.25)' : '#243042'};border-radius:8px;margin-bottom:1rem">${body}</div>`;
}

/* ── The listing form ────────────────────────────────────────────────────── */
export function formHtml(ctx) {
  const resOpts = ctx.resources().map(r =>
    `<option value="${esc(r.id)}">${r.icon} ${esc(r.name)} (have ${ctx.getRes(r.id).toLocaleString()})</option>`).join('');
  const wantResOpts = ctx.resources().map(r =>
    `<option value="${esc(r.id)}">${r.icon} ${esc(r.name)}</option>`).join('');
  const lotOpts = LOT_SIZE_PRESETS.map(n => `<option value="${n}"${n === 100 ? ' selected' : ''}>${n}</option>`).join('');
  const cards = (ctx.customCards() || []).map(c => `<option value="card::${esc(c.id)}::${esc(c.name || c.id)}">${esc(c.name || c.id)} (card)</option>`).join('');
  const items = (ctx.customItems() || []).map(i => `<option value="item::${esc(i.id)}::${esc(i.name || i.id)}">${esc(i.name || i.id)} (${i.slot === 'relic' ? 'relic' : 'item'})</option>`).join('');

  return `
    <div style="background:rgba(212,175,55,0.06);border:1px solid rgba(212,175,55,0.22);border-radius:8px;padding:0.8rem 1rem;margin-bottom:1rem">
      <div style="display:flex;flex-wrap:wrap;gap:1rem;align-items:flex-end">
        <div><div class="small-text ink-dim">Resource</div><select id="resmkt-res">${resOpts}</select></div>
        <div><div class="small-text ink-dim">Units per lot</div>
          <select id="resmkt-lotsize">${lotOpts}<option value="custom">custom…</option></select>
          <input id="resmkt-lotsize-custom" type="number" min="1" max="${LOT_SIZE_MAX}" value="100" style="width:84px;display:none">
        </div>
        <div><div class="small-text ink-dim">Number of lots</div><input id="resmkt-lots" type="number" min="1" max="${LOT_COUNT_MAX}" value="1" style="width:74px"></div>
        <div style="min-width:210px">
          <div class="small-text ink-dim">You are escrowing</div>
          <div id="resmkt-total" style="color:#ffd166;font-weight:700">—</div>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:1rem;align-items:flex-end;margin-top:0.7rem">
        <div><div class="small-text ink-dim">You want</div>
          <select id="resmkt-mode">
            <option value="cinders">🔥 Cinders</option>
            <option value="aza">👑 Aza</option>
            <option value="trade">🔄 Trade — another resource</option>
            <option value="barter">🔄 Barter — a card / item</option>
          </select>
        </div>
        <div id="resmkt-price-wrap"><div class="small-text ink-dim">Price <strong>per lot</strong></div><input id="resmkt-price" type="number" min="0" max="9999999" value="50" style="width:104px"></div>
        <div id="resmkt-trade-wrap" style="display:none">
          <div class="small-text ink-dim">In exchange for</div>
          <select id="resmkt-wantres" style="max-width:210px">${wantResOpts}</select>
          <input id="resmkt-wantqty" type="number" min="1" max="${LOT_SIZE_MAX}" value="100" style="width:84px" title="units wanted per lot">
          <span class="small-text ink-dim">per lot</span>
        </div>
        <div id="resmkt-want-wrap" style="display:none"><div class="small-text ink-dim">Ask for</div>
          <select id="resmkt-want" style="max-width:240px">
            <optgroup label="Cards">${cards || '<option disabled>none</option>'}</optgroup>
            <optgroup label="Items / Relics">${items || '<option disabled>none</option>'}</optgroup>
          </select>
        </div>
        <div style="min-width:210px">
          <div class="small-text ink-dim">Total you receive if it all sells</div>
          <div id="resmkt-ask" style="color:#9ad17a;font-weight:700">—</div>
        </div>
        <button class="btn-primary" id="resmkt-post">📦 List</button>
        <button class="btn-mini" id="resmkt-refresh" style="margin-left:auto">↻ Refresh</button>
      </div>
      <div class="small-text ink-dim" style="margin-top:0.55rem;line-height:1.45">
        📦 <strong>Lots</strong> — one listing, many identical bundles. <em>100 wood × 10 lots</em> escrows
        <strong>1,000 wood</strong> and a buyer can take some or all of them; you no longer post the same
        listing ten times. 🔄 <strong>Trade</strong> swaps goods for goods, no currency involved.
        <br>⚠ Everything you list leaves your stash <strong>now</strong> and is held in escrow. Cancelling returns all of it.
      </div>
    </div>`;
}

/* Live preview under the form — recomputed on every keystroke so the player
   never presses List while looking at a stale number. */
export function formPreview(ctx, f) {
  const v = validateLots(f.lotSize, f.lots);
  const m = ctx.meta(f.resource);
  if (!v.ok) return { total: `<span style="color:#e0879a">${esc(v.why)}</span>`, ask: '—', ok: false };
  const have = ctx.getRes(f.resource);
  const short = have < v.units;
  const total = `${m.icon} <span style="color:${short ? '#e0556a' : '#ffd166'}">${unitsLabel(v.lotSize, v.lots, esc(m.name))}</span>` +
    (short ? ` <span class="small-text" style="color:#e0556a">— you only have ${have.toLocaleString()}</span>` : ` <span class="small-text ink-dim">— you have ${have.toLocaleString()}</span>`);
  let ask;
  if (f.mode === 'trade') {
    const wm = ctx.meta(f.wantRes);
    const per = Math.max(0, Math.floor(Number(f.wantQty) || 0));
    ask = per > 0 ? `${wm.icon} ${unitsLabel(per, v.lots, esc(wm.name))}` : '<span style="color:#e0879a">set what you want per lot</span>';
  } else if (f.mode === 'barter') {
    ask = f.wantId ? `🔄 ${esc(f.wantName || f.wantId)} × ${v.lots}` : '<span style="color:#e0879a">pick a card or item</span>';
  } else {
    const p = Math.max(0, Math.floor(Number(f.price) || 0));
    ask = `${f.mode === 'aza' ? AZA : CIN} ${(p * v.lots).toLocaleString()} <span class="small-text ink-dim">(${p.toLocaleString()} × ${v.lots} lots)</span>`;
  }
  return { total, ask, ok: !short };
}

export default { rowHtml, listHtml, formHtml, formPreview, takeSummary, askLabel, cannotWhy, esc };
