/* ══ 🛣 THE ROAD INFORMATION PANEL ══════════════════════════════════════════
   Renders a STREET into node-city's existing #inspect dossier — the same box,
   the same header, the same topline grid, the same .ins-card/.fac/.eyeb classes
   every building dossier already uses. Nothing new is added to index.html's CSS
   except the handful of rules at the bottom of this file, which this module
   injects itself and which are all scoped under #inspect .st-*, so a 404 on this
   module leaves no orphan styling behind.

   The four readouts are the reference panel's, in the reference's order, and
   each one is derived (see tuning.js for where every constant lives):
     UPKEEP · LENGTH · CONDITION (range + average) · TRAFFIC FLOW
   followed by the two charts: an AREA chart of flow against capacity and a LINE
   chart of volume in vehicles per city hour, both across ONE CITY CYCLE.

   ── 🕰 WHICH CLOCK, AND WHY THE CAPTIONS SAY SO ───────────────────────────
   The 24 slots are 24 hours of a CITY CYCLE — CITY_DAY_MIN (20) real minutes,
   the clock game.cityAge advances and the one every rate in the game is already
   priced per. They are NOT the EST wall hours of the sky and the top bar's
   clock chip. Both clocks exist in this game and they disagree, which is why
   renderVitals prints "/ CYCLE" rather than "/ DAY"; a chart that does not name
   its own clock is how a player learns to trust neither. Every caption here
   names it, and the axis ticks are cycle hours.

   ── THE ONE RULE THE CHARTS FOLLOW ────────────────────────────────────────
   An hour that was not observed is a GAP, never a zero and never interpolated
   across. A city that has been open for one minute has one bucket of data and
   the chart says so, in the caption and in the shape of the line. The moment a
   chart draws a plausible curve through hours nobody watched, every number on
   the panel becomes unfalsifiable.                                            */

import { STREET } from './tuning.js';

const B = STREET.BUCKETS;
/* Single-series charts, so no legend: the card title names the series (the
   dataviz rule). Two hues from the game's own token set, one per chart, never
   reused for anything with a status meaning. */
const C_FLOW = '#ff7a2f';       // --ember
const C_VOL  = '#7fb8ff';       // --sky
const C_GRID = 'rgba(255,255,255,.07)';
const C_INK  = '#8f87a3';       // --mist

const esc = (ctx, s) => {
  try { return ctx.logEsc(s); } catch (e) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
};
const fmtInt = n => Math.round(n).toLocaleString();
/* A rate on the CITY hour is a small number — a bucket is fifty seconds, not
   3,600 — so rounding it to an integer throws away most of what moved. One
   decimal below 10, plain integers above, and never a spurious ".0". */
const fmtRate = n => (n < 10 ? String(Math.round(n * 10) / 10) : fmtInt(n));
/* The average condition is the number the reference prints and the number that
   used to be frozen: a street a session's traffic has taken to 99.4% rounds to
   "99", but one at 99.6% rounded to "100" and looked untouched. One decimal
   whenever there is one to show. */
const fmtAvg = n => (Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1));
/* A road costs 4 Cinder, so a short lane's honest upkeep is a fraction of one.
   Rounding that up to "1" would be the panel inventing a bill; show the decimal
   until the number is big enough not to need it. */
const fmtMoney = n => (n < 10 ? (Math.round(n * 10) / 10).toFixed(1) : fmtInt(n));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ── length ─────────────────────────────────────────────────────────────── */
export function lengthOf(tiles) {
  const m = tiles * STREET.METRES_PER_TILE;
  return { m, txt: m >= 1000 ? (m / 1000).toFixed(1) + ' km' : fmtInt(m) + ' m' };
}

/* ── the SVG charts ─────────────────────────────────────────────────────────
   Hand-built strings rather than a library: no CDN is reachable from the deploy
   and no npm dependency may be added (CLAUDE.md), and 120 lines of path maths is
   cheaper than either. Geometry is in a fixed viewBox and the element scales to
   the card, so nothing here depends on a measured layout — which matters,
   because getBoundingClientRect reads 0 in the capture harness. */
const VW = 480, VH = 152, PL = 44, PR = 10, PT = 12, PB = 24;
const PW = VW - PL - PR, PH = VH - PT - PB;
const cx = i => PL + ((i + 0.5) / B) * PW;
const cy = (v, max) => PT + PH - (clamp(v, 0, max) / (max || 1)) * PH;

function axisAndGrid(max, fmtY) {
  let out = '';
  for (let s = 0; s <= 4; s++) {
    const v = (max / 4) * s, y = cy(v, max);
    out += '<line x1="' + PL + '" y1="' + y.toFixed(1) + '" x2="' + (PL + PW) + '" y2="' + y.toFixed(1) +
      '" stroke="' + C_GRID + '" stroke-width="1"/>';
    out += '<text x="' + (PL - 6) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end" font-size="9" fill="' +
      C_INK + '">' + fmtY(v) + '</text>';
  }
  for (const h of [0, 6, 12, 18, 24]) {
    const x = PL + (h / B) * PW;
    out += '<text x="' + x.toFixed(1) + '" y="' + (VH - 7) + '" text-anchor="' +
      (h === 0 ? 'start' : h === 24 ? 'end' : 'middle') + '" font-size="9" fill="' + C_INK + '">' +
      String(h % 24).padStart(2, '0') + ':00</text>';
  }
  return out;
}

/* Runs of consecutive OBSERVED buckets. Each run is drawn as its own path, so
   an unobserved hour leaves a real hole instead of a straight line pretending
   the traffic went smoothly from 03:00 to 19:00. */
function runsOf(seen) {
  const runs = [];
  let cur = null;
  for (let i = 0; i < B; i++) {
    if (seen[i]) { if (!cur) { cur = [i, i]; runs.push(cur); } else cur[1] = i; }
    else cur = null;
  }
  return runs;
}

function hoverCells(values, seen, fmt) {
  let out = '';
  const w = PW / B;
  for (let i = 0; i < B; i++) {
    const x = PL + (i / B) * PW;
    const label = String(i).padStart(2, '0') + ':00 — ' + (seen[i] ? fmt(values[i]) : 'not observed');
    out += '<rect x="' + x.toFixed(1) + '" y="' + PT + '" width="' + w.toFixed(2) + '" height="' + PH +
      '" fill="transparent"><title>' + label + '</title></rect>';
  }
  return out;
}

function nowMarker(hour) {
  const x = PL + (clamp(hour, 0, 24) / B) * PW;
  return '<line x1="' + x.toFixed(1) + '" y1="' + PT + '" x2="' + x.toFixed(1) + '" y2="' + (PT + PH) +
    '" stroke="rgba(212,175,55,.45)" stroke-width="1" stroke-dasharray="2 3"/>';
}

function chart(opts) {
  const { values, seen, max, color, fill, fmt, hour, aria } = opts;
  const runs = runsOf(seen);
  const gid = 'stg' + Math.abs((color.charCodeAt(1) * 31 + Math.round(max))).toString(36);
  let body = '';
  for (const [a, b] of runs) {
    let line = '';
    for (let i = a; i <= b; i++) line += (i === a ? 'M' : 'L') + cx(i).toFixed(1) + ' ' + cy(values[i], max).toFixed(1);
    if (fill) {
      const base = (PT + PH).toFixed(1);
      body += '<path d="' + line + 'L' + cx(b).toFixed(1) + ' ' + base + 'L' + cx(a).toFixed(1) + ' ' + base +
        'Z" fill="url(#' + gid + ')" stroke="none"/>';
    }
    body += '<path d="' + line + '" fill="none" stroke="' + color +
      '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    // A single observed hour is one point and a path of one point draws nothing
    // at all — the commonest state of a fresh city, so it gets an explicit dot.
    if (a === b) body += '<circle cx="' + cx(a).toFixed(1) + '" cy="' + cy(values[a], max).toFixed(1) +
      '" r="3.2" fill="' + color + '"/>';
  }
  if (!runs.length) {
    body += '<text x="' + (PL + PW / 2) + '" y="' + (PT + PH / 2) + '" text-anchor="middle" font-size="11" fill="' +
      C_INK + '">no hour observed yet</text>';
  }
  return '<svg class="st-chart" viewBox="0 0 ' + VW + ' ' + VH + '" preserveAspectRatio="xMidYMid meet" ' +
    'role="img" aria-label="' + aria + '">' +
    '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + color + '" stop-opacity=".38"/>' +
      '<stop offset="100%" stop-color="' + color + '" stop-opacity=".02"/></linearGradient></defs>' +
    axisAndGrid(max, fmt) + nowMarker(hour) + body + hoverCells(values, seen, fmt) + '</svg>';
}

/* ── the panel ─────────────────────────────────────────────────────────────
   `st` is the street, `stats` is everything index.js already derived for it.
   This function ONLY renders; every number is computed by the caller so that
   the diagnostics seam can assert on the same object the panel drew.          */
export function render(ctx, st, stats, uiTab) {
  const $ = ctx.$;
  const name = stats.name;
  const len = lengthOf(st.len);
  const s = stats.traffic;
  const peakFlow = stats.peakFlow;

  $('inscrest').textContent = '🛣️';
  $('insname').innerHTML = esc(ctx, name) +
    ' <span class="lvl">' + (st.axis === 'x' ? 'EAST–WEST' : 'NORTH–SOUTH') + '</span>';
  $('insmeta').innerHTML =
    '<span>Street</span><i class="sep"></i><span>' + st.len + ' tile' + (st.len === 1 ? '' : 's') + '</span>' +
    '<i class="sep"></i><span>' + st.junctions + ' junction' + (st.junctions === 1 ? '' : 's') + '</span>' +
    '<i class="sep"></i><span>' + (st.deadEnds ? st.deadEnds + ' dead end' + (st.deadEnds === 1 ? '' : 's') : 'through route') + '</span>' +
    '<i class="sep"></i><span>tile ' + esc(ctx, stats.tileKey) + '</span>';

  const status = $('insstatus');
  if (peakFlow >= 100) { status.className = 'bad'; status.innerHTML = '<i class="pl"></i>CONGESTED'; }
  else if (peakFlow >= 60) { status.className = 'warn'; status.innerHTML = '<i class="pl"></i>BUSY'; }
  else if (s.observedBuckets) { status.className = ''; status.innerHTML = '<i class="pl"></i>FLOWING'; }
  else { status.className = ''; status.innerHTML = 'QUIET'; }

  const cond = stats.condition;
  const tl = [
    { e: 'Upkeep', v: '🔥 ' + fmtMoney(stats.upkeep) + '<small> /cycle</small>',
      d: Math.round(STREET.UPKEEP_PCT_PER_CYCLE * 100) + '% of build cost, scaled by wear &middot; quoted, not billed' },
    { e: 'Length', v: len.txt,
      d: st.len + ' &times; ' + STREET.METRES_PER_TILE + ' m per tile' },
    { e: 'Condition', v: (cond.min === cond.max ? cond.max + '<small>%</small>'
        : cond.min + '<small>%</small>–' + cond.max + '<small>%</small>'),
      d: fmtAvg(cond.avgExact != null ? cond.avgExact : cond.avg) + '% average across ' +
         st.len + ' tile' + (st.len === 1 ? '' : 's') +
         (stats.wearRate > 0.05 ? ' · wearing ' + fmtRate(stats.wearRate) + '%/cycle' : '') },
    { e: 'Traffic flow', v: (s.observedBuckets ? Math.round(peakFlow) + '<small>%</small>' : '—'),
      d: s.observedBuckets ? 'peak of the observed window · capacity ' + fmtRate(s.capacity) + ' veh / city hour'
                           : 'no city hour observed yet' },
  ];
  $('instop').style.gridTemplateColumns = 'repeat(4,1fr)';
  $('instop').innerHTML = tl.map(o => '<div class="tl"><div class="eyeb">' + o.e + '</div><div class="tl-v">' +
    o.v + '</div><div class="tl-d">' + o.d + '</div></div>').join('');

  const tabs = [{ id: 'ov', name: 'Overview' }, { id: 'sg', name: 'Tiles' }];
  let tab = tabs.some(t => t.id === uiTab) ? uiTab : 'ov';
  ctx.insBuildTabs(tabs);

  const volMax = Math.max(5, niceMax(s.volume, s.seen));
  /* 🕰 SAY WHICH CLOCK, EVERY TIME. The axis is 24 hours of one CITY CYCLE —
     CITY_DAY_MIN minutes, the clock production, rent and the vitals trend are
     already priced per — and NOT the EST wall clock in the top bar's chip. Both
     exist, they disagree, and a chart that does not name its own clock is how a
     player ends up trusting neither. */
  const cycleMin = Math.round(stats.cycleMin || 20);
  const observedTxt = s.observedBuckets + ' of 24 city hours observed · ' +
    Math.round(s.obsSec / 60) + ' min of city time watched' +
    '<br>one city cycle = ' + cycleMin + ' min, so an hour here is ' +
    Math.round((stats.cycleMin || 20) * 60 / B) + ' s — the city’s own clock, not the wall clock';

  const flowChart = ctx_card(ctx, 'Traffic flow', '% of capacity',
    chart({ values: s.flow, seen: s.seen, max: 100, color: C_FLOW, fill: true, hour: stats.hour,
            fmt: v => Math.round(v) + '%',
            aria: 'Traffic flow over one city cycle, peak ' + Math.round(peakFlow) + ' percent of capacity' }) +
    '<div class="st-cap">' + observedTxt + '</div>');

  const volChart = ctx_card(ctx, 'Traffic volume', 'vehicles / city hour',
    chart({ values: s.volume, seen: s.seen, max: volMax, color: C_VOL, fill: false, hour: stats.hour,
            fmt: v => (volMax < 20 ? (+v).toFixed(1) : fmtInt(v)),
            aria: 'Traffic volume over one city cycle in vehicles per city hour, peak ' + fmtRate(stats.peakVolume) }) +
    '<div class="st-cap">measured past a point on the street — the mean of its ' + st.len +
    ' tile' + (st.len === 1 ? '' : 's') + ', not their sum</div>');

  const facts = ctx_card(ctx, 'The street', 'counted, not modelled',
    ctx.insFac('🚗 Vehicle passes counted', fmtInt(s.vehTotal)) +
    ctx.insFac('🚶 Footfall counted', fmtInt(s.pedTotal)) +
    ctx.insFac('🛞 Lifetime passes (drives wear)', fmtInt(stats.lifePasses)) +
    ctx.insFac('🚦 Capacity used as 100%', fmtRate(s.capacity) + ' veh / city hour') +
    ctx.insFac('&nbsp;&nbsp;↳ limited by', stats.capParts && stats.capParts.bound === 'fleet'
      ? (stats.capParts.fleet | 0) + ' vehicles / ' + (stats.capParts.netTiles | 0) + ' tiles'
      : 'lane saturation') +
    ctx.insFac('🏚️ Average wear', stats.wearAvg.toFixed(1) + '%', stats.wearAvg > 20 ? 'dn' : '') +
    /* The rate, next to the total. See the derivation in index.js: it is the
       MEAN observed volume put through the same WEAR_PER_1K_PASSES the lifetime
       total uses, so the two can never tell different stories. Condition says
       how worn this street is; this says how fast it is wearing, which is the
       half a player can act on and the half that moves inside a session. */
    ctx.insFac('&nbsp;&nbsp;↳ wearing, at this traffic',
      s.observedBuckets ? fmtRate(stats.wearRate) + '% / cycle' : 'not observed yet') +
    ctx.insFac('🔗 Junctions on this street', String(st.junctions)) +
    (st.junctions ? '<div class="ins-desc st-note">A junction tile belongs to both streets that meet there, so its traffic is counted for both — the same way an intersection belongs to both roads in the world.</div>' : ''));

  const rename = ctx_card(ctx, 'Street name', 'rename',
    '<div class="st-rename">' +
      '<input id="st-name" class="st-input" type="text" maxlength="' + STREET.MAX_NAME_LEN +
        '" value="' + esc(ctx, name) + '" aria-label="Street name">' +
      '<button class="pbtn ember" id="st-save" type="button">Rename</button>' +
      '<button class="pbtn" id="st-auto" type="button" title="Generate a new name for this street">🎲 Auto</button>' +
    '</div>' +
    '<div class="ins-desc st-note">Named automatically when the street was laid. The name follows the tiles, so extending this street keeps it and every road you build gets one of its own.</div>');

  const rows = stats.tiles.map(t =>
    '<div class="fac"><span class="fac-l">tile ' + esc(ctx, t.k) + '</span><span class="fac-v num' +
    (t.condition < 80 ? ' dn' : '') + '">' + t.condition + '% · ' + fmtInt(t.life) + ' passes</span></div>').join('');

  let panes =
    '<div class="pane one" role="tabpanel" id="inspane-ov" data-tab="ov" aria-labelledby="instab-ov" tabindex="0"><div>' +
      /* Charts side by side rather than stacked. The reference stacks them, but
         #insbox is 1000px wide and 152-unit-tall SVGs at full width came out
         ~300px each — the volume chart fell below the fold and a player had to
         scroll to discover a second chart existed. Two columns puts both on
         screen at once; the media query stacks them again when there is no
         width to spend. */
      '<div class="st-two">' + flowChart + volChart + '</div>' +
      '<div class="st-two">' + facts + rename + '</div>' +
    '</div></div>' +
    '<div class="pane one" role="tabpanel" id="inspane-sg" data-tab="sg" aria-labelledby="instab-sg" tabindex="0"><div>' +
      ctx_card(ctx, 'Tile by tile', st.len + ' tiles',
        rows + '<div class="ins-desc st-note">Condition is 100% minus wear, and wear here comes from counted vehicle passes only — ' +
        STREET.WEAR_PER_1K_PASSES + '% per thousand, capped at ' + STREET.WEAR_CAP +
        '%. Road wear is this panel\'s own reading — it never damages a tile, never bills a repair and never touches production.</div>') +
    '</div></div>';

  $('inspanes').innerHTML = panes;
  ctx.insSelect(tab, false);
  $('inspanes').scrollTop = 0;

  // Footer: a street has no level, no rotation and no repair. Demolition is the
  // host's, on the clicked TILE, and it is relabelled so nobody expects the
  // whole street to go.
  $('btn-upgrade').style.display = 'none';
  $('btn-repair').style.display = 'none';
  $('btn-rotate').style.display = 'none';
  $('btn-action').style.display = 'none';

  return { tab };
}

function niceMax(values, seen) {
  let m = 0;
  for (let i = 0; i < B; i++) if (seen[i] && values[i] > m) m = values[i];
  if (m <= 0) return 5;
  const mag = Math.pow(10, Math.floor(Math.log10(m)));
  for (const step of [1, 2, 2.5, 5, 10]) if (m <= step * mag) return step * mag;
  return 10 * mag;
}

function ctx_card(ctx, title, right, body) {
  try { return ctx.insCardHtml(title, right, body); } catch (e) {
    return '<div class="ins-card"><div class="ins-ch"><span class="eyeb">' + title + '</span>' +
      (right ? '<span class="eyeb">' + right + '</span>' : '') + '</div>' + body + '</div>';
  }
}

/* ── the module's own CSS ───────────────────────────────────────────────────
   Injected once, scoped to #inspect, and deliberately small: everything that
   could be borrowed from the existing dossier styling was borrowed. */
let _styled = false;
export function ensureStyle() {
  if (_styled) return;
  _styled = true;
  try {
    const el = document.createElement('style');
    el.id = 'streets-css';
    el.textContent = [
      '#inspect .st-chart{width:100%;height:auto;display:block;overflow:visible;}',
      '#inspect .st-cap{font-size:10px;color:var(--mist);margin-top:7px;line-height:1.45;}',
      '#inspect .st-note{margin:10px 0 0;font-size:11px;}',
      '#inspect .st-two{display:grid;grid-template-columns:1fr 1fr;gap:13px;align-items:start;}',
      '#inspect .st-two + .st-two{margin-top:12px;}',
      // Beats the dossier's own `.ins-card + .ins-card{margin-top:12px}`, which
      // would otherwise push the right-hand card of every row down by 12px.
      '#inspect .st-two > .ins-card{margin-top:0;}',
      '@media (max-width:760px){#inspect .st-two{grid-template-columns:1fr;}',
      '  #inspect .st-two > .ins-card + .ins-card{margin-top:12px;}}',
      '#inspect .st-rename{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}',
      '#inspect .st-rename .pbtn{width:auto;margin-top:0;flex:none;}',
      '#inspect .st-input{flex:1;min-width:150px;background:#0f0c18;border:1px solid var(--edge);',
      '  border-radius:6px;color:var(--bone);padding:7px 9px;font-size:13px;font-family:inherit;}',
      '#inspect .st-input:focus{outline:none;border-color:var(--gold);}',
    ].join('\n');
    document.head.appendChild(el);
  } catch (e) { _styled = false; }
}

export default { render, ensureStyle, lengthOf };
