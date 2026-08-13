/* ════════════════════════════════════════════════════════════════════════════
   🖼 ECONOMY PANEL — markup only. The host owns the DOM.
   ----------------------------------------------------------------------------
   Every function here returns an HTML STRING and touches nothing. The host
   decides where it goes and when it is refreshed, exactly as
   /src/city/production.render.js and terroir.js's `marketStripHtml` already do.

   🔴 NO NUMBER IS COMPUTED IN THIS FILE. Every figure comes from the snapshot
   the tick produced. A panel that recomputes its own version of a rate is a
   panel that eventually disagrees with the simulation — terroir.js makes the
   same rule and states the reason: "a figure the UI recomputes its own way is a
   figure that eventually lies."

   ⚠ EVERYTHING IS ESCAPED. Firm names are derived from the catalogue today, but
     a future round will let players name their businesses, and an unescaped
     name is an XSS hole in a panel that renders into the city's own page.
   ════════════════════════════════════════════════════════════════════════════ */

import { RUNG_META } from './firms.js';
import { GRADES } from './endowment.js';
import { CAUSES } from './bottleneck.js';

export function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const n0 = (v) => Math.round(Number(v) || 0).toLocaleString();
const n1 = (v) => (Math.round((Number(v) || 0) * 10) / 10).toLocaleString();
const pct = (v) => Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 100) + '%';

/* A resource id as words: ironOre → "Iron Ore". Used everywhere a raw id would
   otherwise leak into the UI. */
export function niceId(id) {
  return String(id || '').replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).trim();
}

export const ECONOMY_CSS = `
.eco-wrap{font:12px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#cfd6e4}
.eco-h{display:flex;align-items:center;gap:6px;margin:10px 0 6px;font-weight:700;
  font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8fa0b8}
.eco-h:first-child{margin-top:0}
.eco-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:6px}
.eco-stat{background:#14161d;border:1px solid #242833;border-radius:7px;padding:7px 8px}
.eco-stat b{display:block;font-size:15px;color:#e8edf6;font-weight:700;line-height:1.2}
.eco-stat span{display:block;font-size:10px;color:#8fa0b8;margin-top:2px}
.eco-stat.warn b{color:#e0a060}.eco-stat.bad b{color:#e0556a}.eco-stat.good b{color:#9ad17a}
.eco-row{display:flex;align-items:center;gap:7px;padding:5px 7px;border-radius:6px;background:#14161d;
  border:1px solid #242833;margin-bottom:4px}
.eco-row .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.eco-row .vl{font-variant-numeric:tabular-nums;color:#e8edf6;font-weight:600}
.eco-bar{height:5px;border-radius:3px;background:#242833;overflow:hidden;margin-top:3px}
.eco-bar i{display:block;height:100%;border-radius:3px;background:#9ad17a}
.eco-bar.w i{background:#e0a060}.eco-bar.b i{background:#e0556a}
.eco-pill{display:inline-flex;align-items:center;gap:3px;padding:1px 6px;border-radius:99px;
  font-size:10px;font-weight:700;background:#242833;color:#cfd6e4}
.eco-flow{display:grid;grid-template-columns:1fr auto;gap:2px 8px;font-variant-numeric:tabular-nums}
.eco-flow .k{color:#8fa0b8}.eco-flow .v{color:#e8edf6;text-align:right}
.eco-trace{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-top:5px}
.eco-trace .st{padding:2px 7px;border-radius:5px;background:#1b1f28;border:1px solid #2b303c;font-size:10px}
.eco-trace .st.bad{border-color:#5a2530;background:#2a1620;color:#ffb0bc}
.eco-trace .ar{color:#5b6376;font-size:10px}
.eco-fix{margin-top:5px;padding:6px 8px;border-radius:6px;background:#1a1520;border:1px solid #3a2b40;color:#e0c8f0;font-size:11px}
.eco-empty{padding:14px;text-align:center;color:#5b6376;font-size:11px}
.eco-grade{display:inline-block;width:14px;text-align:center;font-weight:700}
.eco-tag{font-size:10px;color:#8fa0b8}
.eco-audit-bad{padding:7px 9px;border-radius:6px;background:#2a1620;border:1px solid #5a2530;color:#ffb0bc;margin-bottom:8px}
`;

/* ── THE MAIN PANEL ─────────────────────────────────────────────────────────
   `s` is the snapshot from MythicEconomy.snapshot(). */
export function renderPanel(s, opts) {
  if (!s) return '<div class="eco-empty">The economy has not started yet.</div>';
  opts = opts || {};
  const h = [];
  h.push('<div class="eco-wrap">');

  /* 🔴 A FAILED AUDIT IS THE FIRST THING ON THE PANEL. It means payouts are
     suspended, and a player whose city stopped paying deserves to be told why
     rather than left to notice. */
  if (s.audit && !s.audit.ok) {
    h.push('<div class="eco-audit-bad"><b>⚠ Treasury audit failed.</b><br>' +
      'The books do not balance (Δ ' + esc(n1(s.audit.err)) + ' 🔥), so payouts are suspended. ' +
      'This is a bug, not a game state — please report it.</div>');
  }

  // ── Headline
  const unemp = s.unemployment || 0;
  h.push('<div class="eco-h">🏙 The City Economy — day ' + n0(s.day) + '</div>');
  h.push('<div class="eco-grid">');
  h.push(stat('🔥 ' + n0(s.treasury), 'Treasury'));
  h.push(stat('👥 ' + n0(s.population), 'Residents'));
  h.push(stat('👷 ' + n0(s.employed), 'Employed'));
  h.push(stat('📉 ' + pct(unemp), 'Unemployment', unemp > 0.5 ? 'bad' : unemp > 0.25 ? 'warn' : 'good'));
  h.push(stat('🏭 ' + n0(s.firms), 'Businesses'));
  h.push(stat('💰 ' + n0(s.savings), 'Household savings'));
  h.push('</div>');

  // ── The circular flow. This is the announcement's diagram, as live numbers.
  h.push('<div class="eco-h">🔄 Where Cinder moved today</div>');
  h.push('<div class="eco-flow">');
  const f = s.flow || {};
  const lines = [
    ['Wages → residents', f.wages], ['Residents → shops', f.shopping],
    ['Business → business', f.b2b], ['Rent', f.rent],
    ['Dividends → residents', f.dividends], ['Business upkeep', f.upkeep],
    ['Taxes → city', f.tax], ['City → infrastructure', f.infrastructure],
    ['City → civic wages', f.civic], ['Benefits', f.benefits], ['Welfare', f.welfare],
    ['Exports (earned)', f.faucet], ['Imports (spent)', f.imports],
    ['Freight', f.freight], ['Paid to you', f.payout],
  ];
  let any = false;
  for (const [k, v] of lines) {
    if (!(Math.abs(v || 0) > 0.5)) continue;
    any = true;
    h.push('<div class="k">' + esc(k) + '</div><div class="v">' + n0(v) + ' 🔥</div>');
  }
  if (!any) h.push('<div class="k">Nothing moved yet.</div><div class="v">—</div>');
  h.push('</div>');

  // ── The one thing most wrong
  if (opts.primary) h.push(renderPrimary(opts.primary));

  // ── Specializations
  const specs = (s.trade && s.trade.active) || [];
  h.push('<div class="eco-h">⭐ Known for</div>');
  if (specs.length) {
    h.push(specs.map(sp => '<span class="eco-pill">' + esc(sp.ico) + ' ' + esc(sp.name) + '</span>').join(' '));
  } else {
    h.push('<div class="eco-empty">Nothing yet. A city earns a reputation by producing and exporting the same thing for ' +
           n0((opts.specDays || 14)) + ' days.</div>');
  }

  // ── Trade
  const t = s.trade || {};
  h.push('<div class="eco-h">🤝 Trade</div>');
  if ((t.gaps || []).length) {
    h.push('<div class="eco-row"><span class="nm">🚫 Cannot be mined here</span><span class="vl">' +
           n0(t.gaps.length) + '</span></div>');
    h.push('<div class="eco-tag">' + t.gaps.slice(0, 8).map(g => esc(niceId(g))).join(' · ') + '</div>');
  }
  h.push('<div class="eco-flow" style="margin-top:6px">' +
    '<div class="k">Exported</div><div class="v">' + n0(t.exportRevenue) + ' 🔥</div>' +
    '<div class="k">Imported</div><div class="v">' + n0(t.importSpend) + ' 🔥</div>' +
    '<div class="k">Partners</div><div class="v">' + n0((t.partners || []).length) + '</div></div>');

  // ── Logistics
  const L = s.logistics || {};
  h.push('<div class="eco-h">🚚 Freight</div>');
  h.push(bar('Capacity used', Math.min(1, L.load || 0), n0(L.booked) + ' / ' + n0(L.capacity)));
  if ((L.load || 0) > 1) {
    h.push('<div class="eco-fix">Over capacity — deliveries are queuing and delivered prices are up ' +
           pct((L.congestion || 1) - 1) + '. Build a warehouse or a terminal.</div>');
  }

  // ── Banking
  const bk = s.bank || {};
  if (bk.hasBank) {
    h.push('<div class="eco-h">🏦 Bank</div>');
    h.push('<div class="eco-flow">' +
      '<div class="k">Reserve</div><div class="v">' + n0(bk.reserve) + ' 🔥</div>' +
      '<div class="k">Loans outstanding</div><div class="v">' + n0(bk.loans) + '</div>' +
      '<div class="k">Owed by businesses</div><div class="v">' + n0(bk.owed) + ' 🔥</div>' +
      '<div class="k">Written off</div><div class="v">' + n0(bk.written) + ' 🔥</div></div>');
  }

  h.push('</div>');
  return h.join('');
}

function stat(v, label, cls) {
  return '<div class="eco-stat' + (cls ? ' ' + cls : '') + '"><b>' + esc(v) + '</b><span>' + esc(label) + '</span></div>';
}
function bar(label, frac, right) {
  const c = frac >= 0.995 ? '' : frac >= 0.6 ? ' w' : ' b';
  return '<div class="eco-row"><div style="flex:1;min-width:0">' +
    '<div class="nm">' + esc(label) + '</div>' +
    '<div class="eco-bar' + c + '"><i style="width:' + pct(frac) + '"></i></div></div>' +
    '<span class="vl">' + esc(right != null ? right : pct(frac)) + '</span></div>';
}

/* ── THE SUPPLY-CHAIN VIEW ──────────────────────────────────────────────────
   The announcement's exact example, rendered. */
export function renderPrimary(p) {
  if (!p) return '';
  const h = ['<div class="eco-h">📊 Primary bottleneck</div>'];
  h.push('<div class="eco-row"><span class="nm">' + esc(p.cause.ico) + ' ' + esc(p.firm) +
         ' — ' + esc(p.at) + '</span><span class="vl">' + pct(p.pct) + '</span></div>');
  if (p.path && p.path.length) {
    h.push('<div class="eco-trace">');
    p.path.forEach((st, i) => {
      if (i) h.push('<span class="ar">→</span>');
      h.push('<span class="st' + (st.ok ? '' : ' bad') + '" title="' + esc(st.detail || '') + '">' +
             esc(st.step) + '</span>');
    });
    h.push('</div>');
  }
  if (p.fix) h.push('<div class="eco-fix">' + esc(p.fix) + '</div>');
  return h.join('');
}

/* ── ONE BUSINESS ───────────────────────────────────────────────────────────
   `d` is MythicEconomy.diagnose(firmId). This is the panel that replaces
   "Factory efficiency: 42%". */
export function renderFirm(d, lvl) {
  if (!d) return '<div class="eco-empty">No such business.</div>';
  const rung = RUNG_META[d.rung] || RUNG_META.HEALTHY;
  const h = ['<div class="eco-wrap">'];
  h.push('<div class="eco-h">' + esc(rung.ico) + ' ' + esc(d.name) + ' — ' + esc(niceId(d.out)) + '</div>');
  h.push('<div class="eco-grid">');
  h.push(stat('L' + n0(d.level), 'Level'));
  h.push(stat(pct(d.efficiency), 'Running at', d.efficiency > 0.9 ? 'good' : d.efficiency > 0.5 ? 'warn' : 'bad'));
  h.push(stat(n0(d.produced), 'Made today'));
  h.push(stat(n0(d.cash) + ' 🔥', 'Cash', d.cash <= 0 ? 'bad' : ''));
  h.push(stat(esc(rung.label), 'Status', d.rung === 'HEALTHY' ? 'good' : 'warn'));
  h.push('</div>');

  h.push('<div class="eco-h">Constraints</div>');
  if (!d.rows.length) h.push('<div class="eco-empty">Nothing limiting it.</div>');
  for (const r of d.rows) h.push(bar(r.label, r.pct));

  if (d.bottleneck) {
    h.push('<div class="eco-fix"><b>' + esc(d.cause.ico) + ' ' + esc(d.cause.label) + '</b><br>' + esc(d.cause.fix) + '</div>');
  }
  if (d.leg && d.leg !== 'default') {
    h.push('<div class="eco-tag" style="margin-top:5px">Running the <b>' + esc(d.leg) + '</b> process.</div>');
  }

  // Level gates — every one, with what is still short.
  if (lvl && !lvl.maxed && lvl.next) {
    h.push('<div class="eco-h">⬆ To become a ' + esc(lvl.next.name) + '</div>');
    if (lvl.ok) h.push('<div class="eco-fix">All requirements met — expanding.</div>');
    else for (const m of lvl.missing) {
      h.push('<div class="eco-row"><span class="nm">' + esc(m.label) + '</span><span class="vl">' +
             n1(m.have) + ' / ' + n1(m.need) + '</span></div>');
    }
  }
  h.push('</div>');
  return h.join('');
}

/* ── THE SURVEY — what is in the ground. ─────────────────────────────────── */
export function renderSurvey(sv) {
  if (!sv) return '<div class="eco-empty">This node has not been surveyed.</div>';
  const h = ['<div class="eco-wrap">'];
  h.push('<div class="eco-h">⛏ Survey — what this node has</div>');
  const strong = (sv.strengths || []).slice(0, 10);
  if (strong.length) {
    for (const id of strong) {
      const g = GRADES[sv.grade(id)] || GRADES.COMMON;
      h.push('<div class="eco-row"><span class="eco-grade" style="color:' + esc(g.color) + '">' + esc(g.ico) +
             '</span><span class="nm">' + esc(niceId(id)) + '</span><span class="vl" style="color:' +
             esc(g.color) + '">' + esc(g.label) + '</span></div>');
    }
  } else h.push('<div class="eco-empty">No notable seams.</div>');

  h.push('<div class="eco-h">🚫 What it will never have</div>');
  const gaps = sv.gaps || [];
  if (gaps.length) {
    h.push('<div class="eco-tag">These cannot be mined here at any price. Your city has to buy them.</div>');
    h.push('<div style="margin-top:5px">' + gaps.map(g =>
      '<span class="eco-pill" style="background:#2a1620;color:#ffb0bc">✖ ' + esc(niceId(g)) + '</span>').join(' ') + '</div>');
  } else h.push('<div class="eco-empty">Nothing strategic is missing — unusual ground.</div>');
  h.push('</div>');
  return h.join('');
}

/* ── A PRODUCTION CHAIN, as the player would read it. ────────────────────── */
export function renderChain(steps) {
  if (!steps || !steps.length) return '';
  const h = ['<div class="eco-trace">'];
  steps.forEach((st, i) => {
    if (i) h.push('<span class="ar">→</span>');
    const bad = st.ok === false;
    h.push('<span class="st' + (bad ? ' bad' : '') + '" title="' + esc(st.detail || '') + '">' +
           esc(st.step || niceId(st.res)) + '</span>');
  });
  h.push('</div>');
  return h.join('');
}

export default { ECONOMY_CSS, renderPanel, renderFirm, renderSurvey, renderChain, renderPrimary, niceId, esc };
