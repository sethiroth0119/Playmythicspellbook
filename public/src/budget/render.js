/* ════════════════════════════════════════════════════════════════════════════
   🖼 THE BUDGET PANEL — markup only. The host owns the DOM.
   ----------------------------------------------------------------------------
   Every function here returns an HTML STRING and touches nothing else. The
   same rule /src/economy/render.js states at the top of itself applies here and
   for the same reason:

   🔴 NO NUMBER IS COMPUTED IN THIS FILE. Every figure — including the height of
   every bar — arrives already worked out on the model object from model.js. A
   panel that recomputes its own version of a figure is a panel that eventually
   disagrees with the simulation it is describing. The only arithmetic below is
   turning a fraction the model handed over into a pixel.

   ⚠ EVERYTHING IS ESCAPED. Nothing here is player-authored today, but this
     renders into the city's own page and a future round will let players name
     things.
   ⚠ NO BACKTICK MAY APPEAR INSIDE THE CSS TEMPLATE LITERAL BELOW, INCLUDING IN
     A COMMENT. A stray backtick closed that string in /src/power/panel.js and
     the whole electricity feature silently reverted to its fallback while the
     old syntax gate reported ALL CLEAN. It has happened three times in this
     project. There are no comments inside the literal for exactly that reason.
   ════════════════════════════════════════════════════════════════════════════ */

export function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const n0 = (v) => Math.round(Number(v) || 0).toLocaleString();
const n2 = (v) => (Math.round((Number(v) || 0) * 100) / 100).toLocaleString();

/* Prose written with blank lines between paragraphs, rendered as paragraphs. */
function prose(t) {
  return String(t || '').split('\n\n')
    .map(p => '<p>' + esc(p) + '</p>').join('');
}

export const BUDGET_CSS = `
.bud{font:12px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#cfd6e4}
.bud-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap;
  padding-bottom:7px;border-bottom:1px solid #242833;margin-bottom:9px}
.bud-top .bal{font-size:11px;color:#8fa0b8}
.bud-top .bal b{color:#e8edf6;font-size:14px;font-variant-numeric:tabular-nums}
.bud-period{font-size:10px;color:#8fa0b8;max-width:46ch}
.bud-cols{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start}
.bud-left{flex:1 1 360px;min-width:300px}
.bud-right{flex:1 1 270px;min-width:250px;position:sticky;top:0;align-self:flex-start}
.bud-figure{display:flex;gap:12px;align-items:center;background:#14161d;border:1px solid #242833;
  border-radius:8px;padding:9px 10px;margin-bottom:10px}
.bud-figure svg{flex:0 0 auto;display:block}
.bud-key{font-size:10px;color:#8fa0b8;min-width:0}
.bud-key div{display:flex;align-items:center;gap:5px;margin-bottom:3px}
.bud-key i{width:9px;height:9px;border-radius:2px;flex:0 0 auto;display:inline-block}
.bud-key b{color:#e8edf6;font-weight:600;font-variant-numeric:tabular-nums}
.bud-hero{margin-left:auto;text-align:right;min-width:0}
.bud-hero span{display:block;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#8fa0b8}
.bud-hero b{display:block;font-size:19px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.25}
.bud-hero b.pos{color:#6fd08c}.bud-hero b.neg{color:#e0808f}
.bud-hero em{display:block;font-style:normal;font-size:10px;color:#8fa0b8;max-width:17ch;margin-left:auto}
.bud-h{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:11px 0 4px;
  font-weight:700;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8fa0b8}
.bud-h .tot{font-variant-numeric:tabular-nums;letter-spacing:0}
.bud-h .tot.pos{color:#6fd08c}.bud-h .tot.neg{color:#e0808f}
.bud-h:first-child{margin-top:0}
.bud-row{display:flex;align-items:center;gap:7px;width:100%;text-align:left;cursor:pointer;
  padding:5px 7px;border-radius:6px;background:#14161d;border:1px solid #242833;margin-bottom:3px;
  font:inherit;color:inherit}
.bud-row:hover{border-color:#39404f;background:#171a22}
.bud-row.sel{border-color:#4a5468;background:#1b1f28}
.bud-row .sw{width:8px;height:8px;border-radius:2px;flex:0 0 auto;background:#39404f}
.bud-row .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bud-row .vl{font-variant-numeric:tabular-nums;color:#e8edf6;font-weight:600;white-space:nowrap}
.bud-row .vl.pos{color:#6fd08c}.bud-row .vl.neg{color:#e0808f}
.bud-row .vl.na{color:#7b8496;font-weight:500;font-style:italic}
.bud-total{display:flex;align-items:center;gap:7px;padding:7px;border-radius:6px;margin-top:6px;
  background:#1b1f28;border:1px solid #39404f}
.bud-total .nm{flex:1;font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-size:11px;color:#cfd6e4}
.bud-total .vl{font-variant-numeric:tabular-nums;font-weight:700;font-size:14px}
.bud-total .vl.pos{color:#6fd08c}.bud-total .vl.neg{color:#e0808f}
.bud-ex{background:#14161d;border:1px solid #242833;border-radius:8px;padding:10px 11px}
.bud-ex h4{margin:0 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#e8edf6}
.bud-ex .sub{font-size:10px;color:#8fa0b8;margin:-3px 0 7px}
.bud-ex p{margin:0 0 7px;color:#b9c2d2;font-size:11.5px;line-height:1.55}
.bud-ex p:last-child{margin-bottom:0}
.bud-src{margin-top:8px;padding-top:7px;border-top:1px solid #242833;font-size:10px;color:#7b8496}
.bud-src code{font:10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#9fb0c8;
  background:#1b1f28;border:1px solid #2b303c;border-radius:4px;padding:1px 4px;word-break:break-all}
.bud-na{padding:7px 9px;border-radius:6px;background:#1c1a15;border:1px solid #4a4330;color:#d9c48f;
  font-size:10.5px;margin-bottom:7px}
.bud-note{font-size:10px;color:#8fa0b8;margin-top:7px;line-height:1.5}
.bud-chk{margin-top:10px;padding:8px 9px;border-radius:7px;background:#14161d;border:1px solid #242833}
.bud-chk .ttl{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#8fa0b8;margin-bottom:5px}
.bud-chk .kv{display:grid;grid-template-columns:1fr auto;gap:2px 8px;font-size:10.5px}
.bud-chk .kv .k{color:#8fa0b8}
.bud-chk .kv .v{color:#e8edf6;text-align:right;font-variant-numeric:tabular-nums}
.bud-chk .v.ok{color:#6fd08c}.bud-chk .v.bad{color:#e0808f}
.bud-bad{padding:7px 9px;border-radius:6px;background:#2a1620;border:1px solid #5a2530;color:#ffb0bc;
  margin-bottom:8px;font-size:11px}
.bud-tax{display:flex;align-items:center;gap:7px;padding:6px 7px;border-radius:6px;background:#14161d;
  border:1px solid #242833;margin-bottom:3px;width:100%;text-align:left;font:inherit;color:inherit;cursor:pointer}
.bud-tax:hover{border-color:#39404f}
.bud-tax.sel{border-color:#4a5468;background:#1b1f28}
.bud-tax .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bud-tax .bs{font-size:10px;color:#8fa0b8;flex:0 0 auto}
.bud-tax .vl{font-variant-numeric:tabular-nums;color:#e8edf6;font-weight:700;white-space:nowrap}
.bud-empty{padding:14px;text-align:center;color:#5b6376;font-size:11px}
`;

/* ── THE FIGURE ─────────────────────────────────────────────────────────────
   Stacked revenue against solid expense, so the balance reads as a SHAPE
   before it reads as a number. Inline SVG, no library.
   ⚠ Rounded ends only where the bar ENDS. A rounded join in the middle of a
     stack reads as a gap that is not in the data, so the segments are plain
     rects and a single rounded cap sits on the top of each bar.
   ⚠ The 2px gap between stacked segments is drawn by SHRINKING each segment,
     never by painting a line over it — a painted divider changes the apparent
     magnitude of whichever segment it lands on. */
function figure(m) {
  const W = 128, H = 158, base = 132, top = 10, bw = 38, gap = 2;
  const span = base - top;
  const px = (frac) => Math.max(0, Math.min(1, frac || 0)) * span;

  const p = [];
  p.push('<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H +
         '" role="img" aria-label="Revenues against expenses">');
  p.push('<line x1="4" y1="' + base + '" x2="' + (W - 4) + '" y2="' + base +
         '" stroke="#2b303c" stroke-width="1"/>');

  // Revenue column, stacked from the baseline up.
  let y = base;
  const segs = m.chart.segments || [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    let h = px(s.frac);
    if (i < segs.length - 1) h = Math.max(1, h - gap);
    y -= h;
    p.push('<rect x="14" y="' + y.toFixed(1) + '" width="' + bw + '" height="' + h.toFixed(1) +
           '" fill="' + esc(s.color) + '"><title>' + esc(s.label) + ' + ' + n0(s.value) +
           ' Cinder</title></rect>');
    y -= gap;
  }
  if (segs.length) {
    p.push('<rect x="14" y="' + (base - px(m.chart.revFrac)).toFixed(1) + '" width="' + bw +
           '" height="6" rx="3" fill="' + esc(segs[segs.length - 1].color) + '"/>');
  }

  // Expense column, one solid mark.
  const eh = px(m.chart.expFrac);
  p.push('<rect x="' + (14 + bw + 24) + '" y="' + (base - eh).toFixed(1) + '" width="' + bw +
         '" height="' + eh.toFixed(1) + '" rx="3" fill="' + esc(m.chart.expColor) +
         '"><title>Expenses − ' + n0(m.totals.expense) + ' Cinder</title></rect>');

  p.push('<text x="' + (14 + bw / 2) + '" y="' + (base + 13) + '" text-anchor="middle" ' +
         'font-size="9" fill="#8fa0b8" letter-spacing="0.08em">IN</text>');
  p.push('<text x="' + (14 + bw + 24 + bw / 2) + '" y="' + (base + 13) + '" text-anchor="middle" ' +
         'font-size="9" fill="#8fa0b8" letter-spacing="0.08em">OUT</text>');
  p.push('</svg>');
  return p.join('');
}

function keyRow(color, label, value) {
  return '<div><i style="background:' + esc(color) + '"></i><span>' + esc(label) +
         '</span>&nbsp;<b>' + esc(value) + '</b></div>';
}

function row(l, sel) {
  const on = sel === l.id;
  const v = l.available
    ? '<span class="vl ' + (l.sign > 0 ? 'pos">+' : 'neg">−') + ' ' + n0(Math.abs(l.value)) + ' \u{1F525}</span>'
    : '<span class="vl na">not measured</span>';
  return '<button type="button" class="bud-row' + (on ? ' sel' : '') + '" data-budrow="' + esc(l.id) + '">' +
    '<span class="sw" style="background:' + esc(l.color || '#39404f') + '"></span>' +
    '<span class="nm">' + esc(l.label) + '</span>' + v + '</button>';
}

/* ── THE EXPLAINER ──────────────────────────────────────────────────────────
   One row, in plain prose, plus the call the figure came from. The source line
   is not decoration: this panel's whole claim is that every number on it can
   name where it came from, and a claim nobody can check is a claim. */
function explainer(l) {
  if (!l) {
    return '<div class="bud-ex"><h4>Pick a line</h4>' +
      '<p>Every line on the left is a counter the simulation keeps, not a figure this panel ' +
      'worked out. Choose one and this pane says what it is, who pays it, and which call it ' +
      'was read from.</p></div>';
  }
  const h = [];
  h.push('<div class="bud-ex">');
  h.push('<h4>' + esc(l.label) + '</h4>');
  if (l.detail) h.push('<div class="sub">' + esc(l.detail) + '</div>');
  if (!l.available && l.why) h.push('<div class="bud-na">Not shown as a number: ' + esc(l.why) + '</div>');
  h.push(prose(l.explain));
  if (l.source) h.push('<div class="bud-src">Read from <code>' + esc(l.source) + '</code></div>');
  h.push('</div>');
  return h.join('');
}

/* ── THE BUDGET TAB ─────────────────────────────────────────────────────────
   `m` is the model from model.js, `rec` the reconciler, `sel` the selected id. */
export function renderBudget(m, rec, sel) {
  if (!m) return '<div class="bud-empty">The economy has not started, so there is no budget to show yet.</div>';
  const h = [];
  h.push('<div class="bud">');

  if (m.audit && !m.audit.ok) {
    h.push('<div class="bud-bad">The city’s treasury audit has failed, so payouts are suspended. ' +
      'The books do not balance by ' + n2(m.audit.err) + ' \u{1F525}, and the city will not pay its owner ' +
      'until they do. Nothing below is wrong because of it — these counters are what the ' +
      'simulation recorded either way.</div>');
  }

  h.push('<div class="bud-top">' +
    '<div class="bud-period">Day ' + n0(m.day) + '. Everything below covers the last economic day ' +
    'the city closed, plus anything that has moved since — the ledger’s own accounting period, ' +
    'because these counters are wiped at the top of each day.</div>' +
    '<div class="bal">Treasury<br><b>' + n0(m.treasury) + ' \u{1F525}</b></div></div>');

  h.push('<div class="bud-cols"><div class="bud-left">');

  const b0 = m.totals.balance;

  // The figure and its key.
  h.push('<div class="bud-figure">' + figure(m) + '<div class="bud-key">');
  for (const s of (m.chart.segments || [])) h.push(keyRow(s.color, s.label, '+' + n0(s.value)));
  if (!(m.chart.segments || []).length) h.push('<div><span>Nothing has come in yet.</span></div>');
  h.push(keyRow(m.chart.expColor, 'Expenses', '−' + n0(m.totals.expense)));
  h.push('</div>');
  /* The headline, beside the shape it comes from. Sign and word, never colour
     alone — the bars carry the colour, this carries the reading. */
  h.push('<div class="bud-hero"><span>Balance</span><b class="' + (b0 >= 0 ? 'pos' : 'neg') + '">' +
    (b0 >= 0 ? '+' : '−') + ' ' + n0(Math.abs(b0)) + ' \u{1F525}</b>' +
    '<em>' + (b0 >= 0 ? 'the city took in more than it spent' : 'the city spent more than it took in') +
    '</em></div>');
  h.push('</div>');

  // Revenues.
  const revTotCls = 'pos';
  h.push('<div class="bud-h"><span>Revenues</span><span class="tot ' + revTotCls + '">+ ' +
         n0(m.totals.revenue) + ' \u{1F525}</span></div>');
  for (const l of m.revenues) h.push(row(l, sel));

  // Expenses.
  h.push('<div class="bud-h"><span>Expenses</span><span class="tot neg">− ' +
         n0(m.totals.expense) + ' \u{1F525}</span></div>');
  for (const l of m.expenses) h.push(row(l, sel));

  // The balance, again, where a ledger puts it.
  h.push('<div class="bud-total"><span class="nm">Balance for the period</span>' +
    '<span class="vl ' + (b0 >= 0 ? 'pos">+' : 'neg">−') + ' ' + n0(Math.abs(b0)) + ' \u{1F525}</span></div>');

  // Moved money the ledger does not count.
  h.push('<div class="bud-h"><span>Moved, but not counted above</span></div>');
  for (const l of m.unmeasured) h.push(row(l, sel));
  h.push(row({ ...m.estate, sign: 1 }, sel));

  h.push(reconcile(m, rec));
  h.push('</div>');

  // The explainer pane.
  const all = m.revenues.concat(m.expenses, m.unmeasured, [m.estate]);
  h.push('<div class="bud-right">' + explainer(all.find(x => x.id === sel)) + '</div>');

  h.push('</div></div>');
  return h.join('');
}

/* ── THE CHECK ──────────────────────────────────────────────────────────────
   The panel proving its own arithmetic against the balance it describes. See
   the header above newReconciler() in model.js for what a window is and why a
   window that crosses a day boundary is discarded rather than approximated. */
function reconcile(m, rec) {
  const h = [];
  h.push('<div class="bud-chk"><div class="ttl">Does it add up?</div><div class="kv">');
  if (m.audit) {
    const ok = !!m.audit.ok;
    h.push('<div class="k">The simulation’s own closed-loop audit</div><div class="v ' +
      (ok ? 'ok">passing' : 'bad">FAILING') + '</div>');
    h.push('<div class="k">…off by</div><div class="v">' + n2(m.audit.err) +
      ' \u{1F525} (tolerance ' + n2(m.audit.tol) + ')</div>');
  } else {
    h.push('<div class="k">The simulation’s own closed-loop audit</div><div class="v">no reading yet</div>');
  }
  if (rec && rec.windows > 0) {
    const r = rec.resid;
    const clean = Math.abs(r) < 0.01;
    h.push('<div class="k">Lines checked against the treasury itself</div><div class="v">' +
      n0(rec.windows) + (rec.windows === 1 ? ' window' : ' windows') + '</div>');
    h.push('<div class="k">…unaccounted for</div><div class="v ' + (clean ? 'ok">' : '">') +
      n2(r) + ' \u{1F525}</div>');
  } else {
    h.push('<div class="k">Lines checked against the treasury itself</div><div class="v">' +
      (rec && rec.skipped ? 'waiting — every reading so far crossed a day' : 'waiting for a second reading') +
      '</div>');
  }
  h.push('</div>');
  h.push('<div class="bud-note">Between two readings taken inside the same economic day, the ' +
    'treasury must move by exactly what these lines say it did. Readings that cross a day ' +
    'boundary are thrown away rather than estimated, because the counters are wiped at the top ' +
    'of each day. Anything left over is one of the two payments listed under “moved, but not ' +
    'counted above” — almost always the start-up capital for a business you just built.</div>');
  h.push('<div class="bud-note">Not on this panel, because the city does not model them: ' +
    'municipal borrowing (the city cannot take a loan — the bank on the City tab lends to ' +
    'businesses, not to you), and upkeep broken down per service (the city’s spending on ' +
    'itself is one budget, split into the payroll and procurement lines above).</div>');
  h.push('</div>');
  return h.join('');
}

/* ── THE TAXATION TAB ───────────────────────────────────────────────────────
   Rates, and only rates. What each one YIELDED is not on here, because the
   simulation does not keep it — see the note at the bottom. */
export function renderTax(tm, sel) {
  if (!tm) return '<div class="bud-empty">The tuning table could not be read, so the rates cannot be shown.</div>';
  const h = [];
  h.push('<div class="bud"><div class="bud-cols"><div class="bud-left">');
  h.push('<div class="bud-h"><span>What the city charges</span></div>');
  for (const r of tm.rows) {
    const val = r.unit === '%' ? (Math.round(r.rate * 1000) / 10) + '%' : n0(r.rate) + ' ' + r.unit;
    h.push('<button type="button" class="bud-tax' + (sel === r.id ? ' sel' : '') +
      '" data-budrow="' + esc(r.id) + '">' +
      '<span class="nm">' + esc(r.label) + '</span>' +
      '<span class="bs">' + esc(r.base) + '</span>' +
      '<span class="vl">' + esc(val) + '</span></button>');
  }
  h.push('<div class="bud-note">The first four are <b>your policy</b> — move a slider and the ' +
    'simulation charges the new rate from the next tick. A tax is a transfer inside the city: ' +
    'it changes whose pocket the Cinder is in, never how much of it exists.</div>');
  h.push('<div class="bud-note">The last three have no slider <b>on purpose</b>. Your share of the ' +
    'surplus, the daily ceiling and the export tap govern what leaves the city for a real ' +
    'wallet, not what moves around inside it. Those stay in the tuning table, where changing ' +
    'them is a deploy and not a click.</div>');
  h.push('<div class="bud-note">What each tax actually YIELDED is not shown, and that is a real gap ' +
    'rather than a design choice: the simulation adds all four taxes and the expansion fee into a ' +
    'single counter at four different points in the day and keeps no per-tax total. A split here ' +
    'would be invented. It is one line of accounting away from being real.</div>');
  h.push('</div>');

  const r = tm.rows.find(x => x.id === sel);
  h.push('<div class="bud-right">');
  if (!r) {
    h.push('<div class="bud-ex"><h4>Pick a charge</h4><p>Each of these is read live out of the ' +
      'economy’s one tuning table. Choose one to see what it is charged on and the rule it ' +
      'follows.</p></div>');
  } else {
    /* 🎚 THE SLIDER, on the four rows that have a policy and no others.
       `r.bounds` is present only for those — taxModel attaches it from
       ECON.taxPolicy — so a row without one renders exactly as it always did.
       That is the whole guard: the payout share, the daily ceiling and the
       faucet cannot grow a control by accident, because there is nothing for
       one to bind to. */
    const b = r.bounds;
    const slider = !b ? '' :
      '<div class="bud-slider">' +
        '<input type="range" data-budtax="' + esc(r.id) + '"' +
          ' min="' + b.min + '" max="' + b.max + '" step="' + b.step + '" value="' + r.rate + '">' +
        '<div class="bud-slider-row">' +
          '<span>' + (Math.round(b.min * 1000) / 10) + '%</span>' +
          '<b data-budtaxval="' + esc(r.id) + '">' + (Math.round(r.rate * 1000) / 10) + '%</b>' +
          '<span>' + (Math.round(b.max * 1000) / 10) + '%</span>' +
        '</div>' +
        (r.rate === r.shipped ? '' :
          '<button type="button" class="bud-reset" data-budtaxreset="' + esc(r.id) + '">' +
          'Reset to ' + (Math.round(r.shipped * 1000) / 10) + '%</button>') +
      '</div>';
    h.push('<div class="bud-ex"><h4>' + esc(r.label) + '</h4>' +
      '<div class="sub">charged on ' + esc(r.base) + ' · paid by ' + esc(r.payer) + '</div>' +
      slider +
      prose(r.explain) +
      '<div class="bud-src">Read from <code>' + esc(r.source) + '</code>' +
        (b ? ' · your policy, clamped to ' + (Math.round(b.min * 1000) / 10) + '–'
           + (Math.round(b.max * 1000) / 10) + '%' : ' · fixed') +
      '</div></div>');
  }
  h.push('</div></div></div>');
  return h.join('');
}
