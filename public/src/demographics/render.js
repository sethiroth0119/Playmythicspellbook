/* ════════════════════════════════════════════════════════════════════════════
   🖼 THE PEOPLE PANEL — markup only. The host owns the DOM.
   ----------------------------------------------------------------------------
   Every function here returns an HTML STRING. Same contract /src/economy's
   render.js states and for the same reason: 🔴 NO NUMBER IS COMPUTED IN THIS
   FILE. Every figure arrives inside the report the tick produced. A panel that
   recomputes its own version of a rate is a panel that eventually disagrees
   with the simulation.

   🔴 AND IT NEVER PRINTS A BARE NUMBER. The reference demand panel expresses
   state as a METER WITH A SIGNED CAUSAL LIST — "+ Local Demand, − Low-skill
   Labor Availability" — never as a raw figure, because a raw figure tells a
   player what is happening and nothing about what to do. Every meter below
   carries its causes, and the causes are the pipeline's own words.
   ════════════════════════════════════════════════════════════════════════════ */

export function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const n0 = (v) => Math.round(Number(v) || 0).toLocaleString();
const n1 = (v) => (Math.round((Number(v) || 0) * 10) / 10).toLocaleString();
const pct = (v) => Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 100) + '%';

/* The panel renders inside #ecobody and inherits the economy card's .eco-*
   classes deliberately — one visual language for one city. These are the few
   shapes that layer does not already have. */
export const DEMOG_CSS = `
.dg-meter{margin:4px 0 8px}
.dg-meter .lbl{display:flex;align-items:baseline;gap:6px;font-size:11px;color:#8fa0b8;margin-bottom:3px}
.dg-meter .lbl b{color:#e8edf6;font-size:13px;font-variant-numeric:tabular-nums}
.dg-meter .tr{height:9px;border-radius:5px;background:#242833;overflow:hidden;position:relative}
.dg-meter .tr i{display:block;height:100%;border-radius:5px;background:linear-gradient(90deg,#5a8f4a,#9ad17a)}
.dg-meter.w .tr i{background:linear-gradient(90deg,#8a6a30,#e0a060)}
.dg-meter.b .tr i{background:linear-gradient(90deg,#7a2a38,#e0556a)}
.dg-why{list-style:none;margin:5px 0 0;padding:0;font-size:11px}
.dg-why li{display:flex;gap:6px;padding:2px 0;color:#cfd6e4}
.dg-why .sg{width:11px;text-align:center;font-weight:700;flex:0 0 auto}
.dg-why .up .sg{color:#9ad17a}.dg-why .dn .sg{color:#e0556a}
.dg-why .tx{flex:1;min-width:0}
.dg-why .tx em{display:block;font-style:normal;color:#8fa0b8;font-size:10px;margin-top:1px}
.dg-split{display:flex;height:10px;border-radius:5px;overflow:hidden;background:#242833;margin:3px 0 5px}
.dg-split i{display:block;height:100%}
.dg-key{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:10px;color:#8fa0b8}
.dg-key span{display:inline-flex;align-items:center;gap:4px}
.dg-key i{width:8px;height:8px;border-radius:2px;display:inline-block}
.dg-zrow{display:grid;grid-template-columns:1fr auto auto;gap:2px 8px;align-items:center;
  padding:5px 7px;border-radius:6px;background:#14161d;border:1px solid #242833;margin-bottom:4px}
.dg-zrow .nm{font-weight:600;color:#e8edf6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dg-zrow .oc{font-size:10px;color:#8fa0b8;font-variant-numeric:tabular-nums;text-align:right}
.dg-zrow .bar{grid-column:1/-1;height:4px;border-radius:2px;background:#242833;overflow:hidden}
.dg-zrow .bar i{display:block;height:100%;background:#6f8fd0}
.dg-zrow .tag{font-size:9px;padding:1px 5px;border-radius:99px;background:#242833;color:#8fa0b8}
.dg-note{font-size:10px;color:#5b6376;margin-top:6px;line-height:1.5}
.dg-gate{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;margin:4px 0 8px;
  padding:5px 8px;border-radius:6px;background:#14161d;border:1px solid #242833;font-size:10px}
.dg-gate.shut{border-color:#5d3a20;background:#1a1410}
.dg-gate .gl{font-weight:700;color:#8fa0b8;letter-spacing:.04em}
.dg-gate.shut .gl{color:#e0a060}
.dg-gate .gn{color:#cfd6e4;font-variant-numeric:tabular-nums}
.dg-gate .gn.bad{color:#e0556a;font-weight:700}
.dg-gate .gt{margin-left:auto;color:#5b6376}
`;

const TIER_COLOR = { low: '#7a6a4a', mid: '#6f8fd0', high: '#9ad17a' };
/* Six rungs now. The three added hues sit BETWEEN the two they were split out
   of rather than beside them, so the ramp still reads low-to-high left to
   right on the stacked bar; a new colour picked for contrast alone would have
   broken the one thing this chart communicates without a legend. */
const EDU_COLOR = { guru: '#5b6376', elementary: '#66789e', middle: '#6f8fd0',
                    high: '#9a8fd0', college: '#c08fd0', university: '#9ad17a' };
const AGE_COLOR = { child: '#e0a060', young: '#6f8fd0', adult: '#9ad17a', senior: '#8fa0b8' };

/* A meter with its causes under it. `v` is 0..1, `caption` says what the number
   MEANS, and `why` is the signed list — this is the panel's whole register. */
function meter(title, v, caption, why, tone) {
  const h = [];
  h.push('<div class="dg-meter' + (tone ? ' ' + tone : '') + '">');
  h.push('<div class="lbl">' + esc(title) + ' <b>' + esc(caption) + '</b></div>');
  h.push('<div class="tr"><i style="width:' + pct(v) + '"></i></div>');
  if (why && why.length) {
    h.push('<ul class="dg-why">');
    for (const c of why) {
      h.push('<li class="' + (c.sign === '+' ? 'up' : 'dn') + '"><span class="sg">' + esc(c.sign) +
        '</span><span class="tx">' + esc(c.label) +
        (c.why ? '<em>' + esc(c.why) + '</em>' : '') + '</span></li>');
    }
    h.push('</ul>');
  }
  h.push('</div>');
  return h.join('');
}

/* A stacked split bar with a key. Used for wealth, education and age, which are
   the same question asked three ways: who is actually living here. */
function split(rows, colors, total) {
  const h = ['<div class="dg-split">'];
  for (const r of rows) {
    const w = total > 0 ? (r.v / total) * 100 : 0;
    if (!(w > 0.05)) continue;
    h.push('<i style="width:' + w.toFixed(2) + '%;background:' + (colors[r.k] || '#5b6376') + '"></i>');
  }
  h.push('</div><div class="dg-key">');
  for (const r of rows) {
    if (!(r.v > 0.05)) continue;
    h.push('<span><i style="background:' + (colors[r.k] || '#5b6376') + '"></i>' +
      esc(r.label) + ' ' + n0(r.v) + '</span>');
  }
  h.push('</div>');
  return h.join('');
}

/* ── THE PANEL ──────────────────────────────────────────────────────────────
   `r` is the report from MythicDemographics.report(). */
export function renderPanel(r) {
  if (!r) return '<div class="eco-empty">The city has not counted its residents yet.</div>';
  if (!r.ok) return '<div class="eco-empty">' + esc(r.why || 'No demographic data.') + '</div>';
  const h = ['<div class="eco-wrap">'];

  h.push('<div class="eco-h">👥 Who lives here</div>');
  h.push('<div class="eco-grid">' +
    stat(n0(r.population), 'Residents') +
    stat(n0(r.households), 'Households') +
    stat(n0(r.homes), 'Dwellings zoned') +
    stat(pct(r.occupancy), 'Occupied', r.occupancy > 0.97 ? 'warn' : '') +
    stat((r.netPerDay >= 0 ? '+' : '') + n1(r.netPerDay), 'Residents / day',
         r.netPerDay < 0 ? 'bad' : r.netPerDay > 0 ? 'good' : '') +
    '</div>');

  /* THE METER. Move-in pressure, and the signed list of what is moving it. */
  h.push('<div class="eco-h">📈 Move-in pressure</div>');
  h.push(meter('How attractive this city is to the households your zoning draws',
    r.attract, pct(r.attract), r.causes,
    r.attract < 0.25 ? 'b' : r.attract < 0.5 ? 'w' : ''));
  if (r.limitText) h.push('<div class="eco-tag">Limiting growth right now: <b>' + esc(r.limitText) + '</b></div>');
  /* 🚦 THE HOST'S GROWTH GATE, AS THREE NUMBERS AGAINST ONE LINE.
     The sentence above already says which one is short and what raises it; this
     row is the reading it was made from, so a player can watch the gap close
     while they build rather than waiting for the sentence to change.
     ⚠ NOT A SECOND OPINION. Every figure here is report().growth, which is
       node-city's own `game.cov.pct` handed over once per tick — the same
       object the Vital Signs card and the status dots draw from. There is no
       coverage arithmetic anywhere in /src/demographics. */
  if (r.growth && r.growth.ok && r.growth.needs && r.growth.needs.length) {
    const g = r.growth;
    h.push('<div class="dg-gate' + (g.open ? '' : ' shut') + '">' +
      '<span class="gl">' + (g.open ? '🚦 Growth gate — open' : '🚦 Growth gate — shut') + '</span>' +
      g.needs.map((n) => '<span class="gn' + (n.short ? ' bad' : '') + '">' +
        esc(n.ico + ' ' + n.name) + ' ' + (n.cov == null ? '—' : Math.round(n.cov * 100) + '%') + '</span>').join('') +
      '<span class="gt">needs ' + Math.round(g.grow * 100) + '% on every one</span></div>');
  }

  h.push('<div class="eco-h">🏘 Districts</div>');
  if (!r.zones.length) {
    h.push('<div class="eco-empty">No residential zoning. Nobody can move in until something is zoned to live in.</div>');
  } else {
    for (const z of r.zones) {
      h.push('<div class="dg-zrow">' +
        '<span class="nm">' + esc(z.ico + ' ' + z.name) + '</span>' +
        '<span class="tag">' + esc(z.src === 'zoned' ? 'zoned' : 'derived') + '</span>' +
        '<span class="oc">' + n0(z.residents) + ' in ' + n0(z.occupied) + '/' + n0(z.homes) + ' homes · rent ' + n1(z.rent) + '</span>' +
        '<span class="bar"><i style="width:' + pct(z.homes > 0 ? z.occupied / z.homes : 0) + '"></i></span>' +
        '</div>');
    }
  }

  h.push('<div class="eco-h">💰 Household wealth</div>');
  h.push(split(r.wealth, TIER_COLOR, r.population));
  h.push('<div class="eco-h">🎓 Education</div>');
  h.push(split(r.education, EDU_COLOR, r.adults));
  h.push('<div class="dg-note">Education decides which jobs a resident may hold. ' +
    esc(r.labourNote) + '</div>');
  h.push('<div class="eco-h">🎂 Age</div>');
  h.push(split(r.ages, AGE_COLOR, r.population));

  h.push('<div class="eco-h">🏠 Household types</div>');
  for (const a of r.archetypes) {
    if (!(a.households > 0.5)) continue;
    h.push('<div class="eco-row"><span class="nm">' + esc(a.ico + ' ' + a.name) + '</span>' +
      '<span class="vl">' + n0(a.households) + '</span></div>');
  }

  h.push('<div class="eco-h">🚚 Per economic day</div>');
  h.push('<div class="eco-flow">' +
    '<div class="k">Moved in</div><div class="v">' + n1(r.flow.in) + '</div>' +
    '<div class="k">Moved out</div><div class="v">' + n1(r.flow.out) + '</div>' +
    '<div class="k">Evicted (housing lost)</div><div class="v">' + n1(r.flow.evicted) + '</div>' +
    '<div class="k">Graduated</div><div class="v">' + n1(r.flow.grad) + '</div>' +
    '<div class="k">Rent index</div><div class="v">×' + n1(r.rentIndex) + '</div>' +
    '</div>');

  h.push('<div class="dg-note">' + esc(r.sourceNote) + '</div>');
  h.push('</div>');
  return h.join('');
}

function stat(v, label, tone) {
  return '<div class="eco-stat' + (tone ? ' ' + tone : '') + '"><b>' + esc(v) + '</b><span>' + esc(label) + '</span></div>';
}

/* ── THE DOSSIER ROWS ───────────────────────────────────────────────────────
   /src/dossier owns the building panel; this is the markup for the two rows it
   asked for (RESIDENTS and HOUSEHOLD WEALTH) so it does not have to invent a
   second visual language for them. It is markup, not a requirement — the read
   API (`residents(tileKey)`) is the contract, and a dossier that wants to draw
   its own is welcome to the same numbers. */
export function renderResidents(d) {
  if (!d || !d.ok) return '';
  const h = ['<div class="eco-wrap">'];
  h.push('<div class="eco-flow">' +
    '<div class="k">Residents</div><div class="v">' + n0(d.residents) + '</div>' +
    '<div class="k">Household wealth</div><div class="v">' + esc(d.wealth.ico + ' ' + d.wealth.label) + '</div>' +
    '<div class="k">Homes</div><div class="v">' + n0(d.occupied) + ' / ' + n0(d.homes) + '</div>' +
    '<div class="k">Zone</div><div class="v">' + esc(d.zone.ico + ' ' + d.zone.name) + '</div>' +
    '</div>');
  for (const hh of d.households) {
    h.push('<div class="eco-row"><span class="nm">' + esc(hh.ico + ' ' + hh.label) + '</span>' +
      '<span class="vl">' + n0(hh.size) + '</span></div>');
  }
  h.push('</div>');
  return h.join('');
}
