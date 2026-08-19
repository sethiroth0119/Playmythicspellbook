/* ════════════════════════════════════════════════════════════════════════════
   ☁ THE POLLUTION INFO VIEW.
   ----------------------------------------------------------------------------
   BAR.md rubric 12 — "panels are readable at a glance; demand/economy state is
   expressed as a METER WITH A SIGNED CAUSAL LIST, not a raw number." Built to
   the same grammar as /src/power/panel.js and /src/water/panel.js on purpose, so
   the three utilities read as one application rather than as three features:

     1. EVERY METER IS A RED→AMBER→GREEN GRADIENT WITH A MARKER. The bar is a
        static gradient and only the marker moves.
     2. THE LEGEND IS NOT A KEY, IT IS THE OVERLAY CONTROL. Every row has a
        checkbox that turns that layer on in the world.
     3. LAYERS ARE GROUPED BY WHAT THEY PAINT, because the grouping IS the
        mental model.

   ⚠ AND ONE INVERSION THIS PANEL HAS AND THE OTHER TWO DO NOT. Every meter here
     reads LOW IS GOOD: 0% air pollution is the healthy end. The gradients are
     therefore mirrored against the water panel's, and every meter carries an
     explicit "clean / choking" pair of end labels so a player moving between the
     two panels is never asked to remember which way round this one runs.

   …and the thing this panel has that neither neighbour does: THE BLAME LIST.
   "The air here is 62% polluted" is a number. "…from the Coal Plant two tiles
   upwind" is an action. Every hotspot names its sources and where they are
   relative to the wind, because that is the only sentence that leads anywhere.

   🔴 THE PANEL'S OWN CSS IS SCOPED AND INJECTED FROM HERE, not added to
      index.html. Three other workflows are editing that file's style block this
      round; every rule below is prefixed `#ncpol` so nothing can collide, and
      the colours are node-city's own custom properties.

   ⚠ WHERE IT DOCKS, AND WHY IT IS THE THIRD ANSWER TO THE SAME PROBLEM.
     node-city's HUD owns both edges (#leftcol 236px, #rightcol 232px);
     /src/power parks inboard of the right rail at right:256px and /src/water
     inboard of the left at left:260px, both so the two can be open together.
     This is the third utility panel and there is no third edge, so it parks
     OUTBOARD OF THE WATER PANEL at left:620px — which fits all three at 1600px
     wide, the width the whole batch is photographed at. Under 1400px it falls
     back onto the water panel's dock (the two are unlikely to be read at the
     same instant even though they are the likely PAIR, and something has to
     give), and under 980px it takes the rail like both of its neighbours.
   ════════════════════════════════════════════════════════════════════════════ */

import { POLLUTE } from './tuning.js';
import { longName } from './wind.js';

let root = null, open = false, host = null, api = null;

/* ── LAYERS ─────────────────────────────────────────────────────────────────
   `need` names a capability the row depends on; a row whose capability is
   absent renders DISABLED and names the global it is waiting for, and can never
   be switched on. Same anti-fallback rule both neighbouring panels state: a
   layer that draws something plausible when its data source is missing is
   indistinguishable from a working feature and would have to be un-taught. */
export const LAYERS = [
  { id: 'air',     group: 'field', ramp: 'air',    label: 'Air Pollution',
    lo: 'Clean', hi: 'Choking' },
  { id: 'ground',  group: 'field', ramp: 'ground', label: 'Ground Pollution',
    lo: 'Clean', hi: 'Poisoned' },
  { id: 'water',   group: 'field', ramp: 'water',  label: 'Water Pollution',
    lo: 'Clean', hi: 'Fouled', note: 'aquifers included where /src/water is loaded' },
  { id: 'value',   group: 'field', ramp: 'value',  label: 'Land Value',
    lo: 'Worthless', hi: 'Unaffected' },
  { id: 'wind',    group: 'map',   sw: 'arrowCol', label: 'Wind Direction' },
  { id: 'sources', group: 'map',   sw: 'src',      label: 'Sources & Homes',
    sub: [['home', 'a home in the affected area']] },
];
const GROUP_LABEL = { field: 'Terrain color', map: 'Map overlay' };

/* Default-on is the story the panel is named after and the one the screenshot
   tells: what is in the air, and which way it is going. Ground, water, land
   value and the markers are what the player turns on when the meters send them
   looking — an info view that lights every layer at once is a colour soup whose
   first read says nothing. */
export const layers = { air: true, ground: false, water: false, value: false, wind: true, sources: true };

/* ── FORMATTING ─────────────────────────────────────────────────────────── */
const pct = (v) => Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 100) + '%';
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sgn = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1);

/* 🔴 THE METER IS FED `1 − value` FOR EVERY POLLUTION READING, AND THAT IS THE
   ONLY PLACE THE INVERSION HAPPENS. The gradient helper below is the same one
   both neighbour panels use — red at the left, green at the right — so a reading
   of "12% polluted" must be handed over as 0.88 to land in the green. Doing the
   flip anywhere else would mean two flips somewhere and none somewhere else, and
   a meter that is green when the city is choking is worse than no meter. */
function meter(good, stops, label) {
  const p = Math.max(0, Math.min(1, Number(good) || 0));
  const g = 'linear-gradient(90deg,#c0473f 0%,#c0473f ' + (stops.red * 100) + '%,' +
            '#d99a2b ' + (stops.red * 100) + '%,#d99a2b ' + (stops.amber * 100) + '%,' +
            '#4caf7a ' + (stops.amber * 100) + '%,#4caf7a 100%)';
  return '<div class="plbar" role="meter" aria-valuenow="' + Math.round(p * 100) +
         '" aria-label="' + esc(label || '') + '"><div class="plfill" style="background:' + g + '"></div>' +
         '<div class="plmark" style="left:' + (p * 100).toFixed(1) + '%"></div></div>';
}

/* ── THE SIGNED CAUSAL LIST ─────────────────────────────────────────────────
   Built from the SAME per-source emission figures the tick injected, never a
   second derivation of them. Rows below `minShare` fold into one "…and N
   smaller" line so the total stays exact while the list stays readable — the
   rule node-city's own away report already states for its leaver list. */
function causes(s) {
  const rows = (s.sources || []).slice().sort((a, b) => (b.air + b.ground + b.water) - (a.air + a.ground + a.water));
  const total = rows.reduce((n, r) => n + r.air + r.ground + r.water, 0);
  if (!total) {
    return '<div class="plcauses"><div class="plcause dim"><span class="plsign up">+</span>' +
           '<span class="plci">✔</span><span class="plcl">Nothing in this city is emitting</span>' +
           '<span class="plcv">0.00</span></div></div>';
  }
  const out = [];
  let folded = 0, foldedV = 0;
  for (const r of rows) {
    const v = r.air + r.ground + r.water;
    if (out.length >= POLLUTE.causes.maxRows || v / total < POLLUTE.causes.minShare) { folded++; foldedV += v; continue; }
    out.push('<div class="plcause">' +
      '<span class="plsign dn">−</span>' +
      '<span class="plci">' + esc(r.ico || '🏭') + '</span>' +
      '<span class="plcl">' + esc(r.name || r.type) + ' <i class="plat">' + r.x + ',' + r.z + '</i></span>' +
      '<span class="plcv">' + v.toFixed(3) + '</span></div>');
  }
  if (folded) out.push('<div class="plcause dim"><span class="plsign dn">−</span><span class="plci"></span>' +
    '<span class="plcl">…and ' + folded + ' smaller</span><span class="plcv">' + foldedV.toFixed(3) + '</span></div>');
  return '<div class="plcauses">' + out.join('') + '</div>';
}

/* ── THE HOTSPOTS — the thing a percentage can never say ────────────────── */
function hotspots(s) {
  const rows = (s.tiles || []).filter(t => t.e > POLLUTE.effects.deadband).slice(0, 4);
  if (!rows.length) {
    return '<div class="plnote">No inhabited tile is above the ' +
           Math.round(POLLUTE.effects.deadband * 100) + '% threshold at which pollution starts to cost anything. ' +
           'Below it the city does not notice, which is why nothing here is being charged for it.</div>';
  }
  let h = '<div class="plsec">WORST BLOCKS</div><div class="plsrc">';
  for (const t of rows) {
    const bl = (s.blame && s.blame[t.x + ',' + t.z]) || [];
    h += '<div class="plsrow">' +
      '<span class="plsn">' + esc(t.ico || (t.home ? '🏠' : '🏗')) + ' ' + esc(t.name || ('tile ' + t.x + ',' + t.z)) +
        ' <i class="plat">' + t.x + ',' + t.z + '</i></span>' +
      '<span class="plsv" title="Exposure">' + pct(t.e) + '</span>' +
      '<span class="plst ' + (t.e > 0.6 ? 'bad' : t.e > 0.3 ? 'warn' : 'ok') + '">' +
        (t.e > 0.6 ? '☣ severe' : t.e > 0.3 ? '⚠ marked' : '● slight') + '</span></div>';
    /* THE SENTENCE THE BRIEF ASKS FOR, assembled: "the air here is 62%
       polluted, from the coal plant two tiles upwind." */
    h += '<div class="plsub2">' + (bl.length
      ? 'from ' + bl.slice(0, 2).map(b => esc(b.ico || '🏭') + ' ' + esc(b.name) + ' ' + esc(b.where)).join(' and ') +
        (bl.length > 2 ? ' and ' + (bl.length - 2) + ' more' : '')
      : 'no source could be attributed — this is drift from elsewhere in the city') + '</div>';
  }
  return h + '</div>';
}

function legend(caps) {
  let h = '<div class="plsec">MAP LEGEND</div>';
  for (const g of ['field', 'map']) {
    const rows = LAYERS.filter(l => l.group === g);
    if (!rows.length) continue;
    h += '<div class="plgrp">' + GROUP_LABEL[g] + '</div>';
    for (const l of rows) {
      const okCap = !l.need || caps[l.need];
      const on = !!layers[l.id] && okCap;
      h += '<label class="plrow' + (okCap ? '' : ' off') + '">' +
             '<span class="plkey">' + (l.sw ? swatch(POLLUTE.overlay[l.sw]) : '<i class="plsw blank"></i>') +
             esc(l.label) + '</span>' +
             '<input type="checkbox" data-layer="' + l.id + '"' + (on ? ' checked' : '') +
             (okCap ? '' : ' disabled') + '>' +
           '</label>';
      if (l.ramp) h += '<div class="plsub"><span class="pllo">' + esc(l.lo) + '</span>' + rampStrip(l.ramp) +
                       '<span class="pllo">' + esc(l.hi) + '</span></div>';
      if (l.sub) h += '<div class="plsub">' + l.sub.map(([c, t]) => swatch(POLLUTE.overlay[c]) + '<span class="pllo">' + esc(t) + '</span>').join('') + '</div>';
      if (l.note) h += '<div class="plsub"><span class="pllo">' + esc(l.note) + '</span></div>';
      if (!okCap) h += '<div class="plsub plwait">awaiting <code>' + esc(l.from) + '</code></div>';
    }
  }
  return h;
}
function swatch(col) { return '<i class="plsw" style="background:' + col + '"></i>'; }
function rampStrip(name) {
  const stops = POLLUTE.overlay.ramps[name] || [];
  return '<i class="plramp" style="background:linear-gradient(90deg,' + stops.join(',') + ')"></i>';
}

function header(s) {
  /* The badge is the ENDOWMENT — the one permanent fact about this place, stated
     the moment the panel opens, exactly as /src/water badges its wetness class
     and /src/power its thermal province. "Prevailing NE" is a thing a player can
     plan a city around before they have built anything at all. */
  const badge = s && s.ok
    ? '<span class="plbadge" title="' + esc(s.endow.blurb) + '">🧭 prevailing ' + esc(s.endow.point) + '</span>'
    : '<span class="plbadge">static</span>';
  return '<div class="plhead"><span class="pltitle">☁ POLLUTION</span>' + badge +
         '<button class="plx" data-plclose="1" aria-label="Close">×</button></div>';
}

function html(s, caps) {
  if (!s || !s.ok) {
    return header(s) + '<div class="plempty">The pollution model is not answering.' +
      (s && s.why ? '<br><span class="pllo">' + esc(s.why) + '</span>' : '') + '</div>' + legend(caps);
  }
  const M = POLLUTE.meters;
  let h = header(s);
  h += '<div class="plsub2 plintro">' + esc(s.endow.blurb) + '</div>';

  /* ── 🧭 WIND. First, because it is what the screenshot tells the player to
     look at and because it is the fact that makes every other number on this
     panel actionable. Both conventions are printed — "toward" and "from" — so a
     player who reads weather reports is not misled by a bearing that means the
     opposite of the one they know. */
  h += '<div class="plsec">WIND<span class="plsecv">' + Math.round(s.wind.deg) + '°</span></div>';
  h += '<div class="plwind"><span class="plarrow" style="transform:rotate(' + Math.round(s.wind.deg) + 'deg)">↑</span>' +
       '<div><b>' + esc(s.wind.point) + '</b> — blowing toward the ' + esc(longName(s.wind.point)) +
       '<div class="plsub2 plflat">out of the ' + esc(longName(s.wind.from)) + ' · ' +
       (s.wind.speed > 0.7 ? 'strong' : s.wind.speed > 0.4 ? 'moderate' : 'light') +
       ' (' + pct(s.wind.speed) + ') · ' + esc(s.wind.weather) + '</div></div></div>';
  h += '<div class="plnote">Anything you burn ends up ' + esc(longName(s.wind.point)) +
       ' of where you burn it. Turn on <b>Wind Direction</b> and the arrows show it across the whole map.</div>';

  /* ── AIR. The headline meter. */
  /* ⚠ THE AIR METER READS THE AIR THE CITIZENS BREATHE, not the mean of the
     field. The field's mean is a fact about ACREAGE: most of a 24×24 grid is
     empty ground, so a city with sixteen blocks under a Coal Plant's plume
     photographed at 98% CLEAN. `airAtPeople` is the same field weighted by
     where the buildings are. */
  h += '<div class="plsec">AIR QUALITY<span class="plsecv">' + pct(1 - s.airAtPeople) + ' clean</span></div>';
  h += meter(1 - s.airAtPeople, M.air, 'Air quality');
  h += '<div class="plends"><span>Worst tile: <b class="' + (s.diag.peak.air > 0.5 ? 'dn' : '') + '">' +
       pct(s.diag.peak.air) + '</b> polluted</span>' +
       '<span>' + s.diag.hot + ' block' + (s.diag.hot === 1 ? '' : 's') + ' badly affected</span></div>';
  h += causes(s);
  /* The unit, stated once. Without it the causal list is three unlabelled
     decimals; with it a player can read "that mine is a quarter of a coal
     plant" straight off the column. */
  h += '<div class="plsub2 plflat">emission units per minute, all three channels — ' +
       'a Coal Plant at full output is 0.180 of air alone</div>';

  /* ── THE CONSEQUENCES, each named with the machinery it runs through, because
     "why is my city dying" has to be answerable from this panel alone. */
  h += '<div class="plsec">WHAT IT IS COSTING<span class="plsecv">' + pct(s.exposure) + ' exposed</span></div>';
  h += meter(1 - s.exposure, M.health, 'Citizen exposure');
  h += '<div class="plcauses">' +
    row('🩹', 'Health demand', s.healthLoad > 0.0005 ? '+' + Math.round(s.healthLoad * 100) + '%' : 'none',
        s.healthLoad > 0.0005) +
    row('😊', 'Hope', s.moraleHit > 0.05 ? sgn(-s.moraleHit) + ' pts' : 'none', s.moraleHit > 0.05) +
    row('🪧', 'Land value', s.landValue < 0.995 ? '×' + s.landValue.toFixed(2) : 'unaffected', s.landValue < 0.995) +
    row('🏠', 'Homes in the affected area', s.exposedHomes + ' of ' + s.homes, s.exposedHomes > 0) +
    '</div>';
  if (s.healthLoad > 0.02) {
    h += '<div class="plnote warn">🤒 Sick citizens need more clinic than well ones, so the city\'s HEALTH ' +
         'demand is ' + Math.round(s.healthLoad * 100) + '% higher than its population alone would ask for. ' +
         'Health is one of the three gates on population growth — a poisoned city loses people.</div>';
  }
  if (s.demog && s.demog.leaving) {
    h += '<div class="plnote warn">👥 The People panel reports a net <b>' + s.demog.net.toFixed(1) +
         '</b> residents a day. Pollution is not the only reason people leave, but it is one of them.</div>';
  }

  /* ── WATER. The screenshot's own lesson, and the one place this panel defers
     entirely to another module. */
  h += '<div class="plsec">WATER<span class="plsecv">' + (s.water.live ? pct(s.water.purity) + ' pure' : 'n/a') + '</span></div>';
  if (s.water.live) {
    h += meter(s.water.purity, M.health, 'Water purity');
    h += '<div class="plends"><span>' + (s.water.taintedBasins
      ? '<b class="dn">' + s.water.taintedBasins + '</b> of ' + s.water.basins + ' groundwater deposit' +
        (s.water.basins === 1 ? '' : 's') + ' contaminated · worst ' + pct(s.water.worstTaint) + ' tainted'
      : 'all ' + s.water.basins + ' groundwater deposit' + (s.water.basins === 1 ? '' : 's') + ' clean') + '</span></div>';
    if (s.water.taintedBasins) {
      h += '<div class="plnote warn">☣ Ground pollution seeps into the deposit under it. ' +
           'Move the works off the water, or take the intake somewhere else — the deposits are on ' +
           'the 💧 panel\'s <b>Groundwater Deposits</b> layer.</div>';
    }
  } else {
    /* THE HONEST EMPTY STATE. Same rule as the neighbours: name the global, do
       not draw a plausible aquifer. */
    h += '<div class="plnote">Groundwater monitoring inactive — awaiting <code>window.MythicWater</code>. ' +
         'Ground pollution is still tracked; what it does to the water table cannot be shown without it.</div>';
  }

  h += hotspots(s);

  /* The cost line. "DIFFUSION runs on the game tick, not per frame. Measure the
     cost; don't guess." — so it is measured, and printed where a player or a
     reviewer can see it rather than asserted in a comment. */
  h += '<div class="plsec">MODEL</div>' +
       '<div class="plsub2 plflat">' + s.diag.cells + ' cells · ' + s.diag.steps + ' sub-step' +
       (s.diag.steps === 1 ? '' : 's') + ' · <b>' + s.diag.stepMs.toFixed(2) + ' ms</b> last tick' +
       (s.diag.breach ? ' · <b class="dn">' + s.diag.breach + ' conservation breaches</b>' : ' · conserved') +
       '</div>';

  return h + legend(caps);
}
function row(ico, label, val, active) {
  return '<div class="plcause' + (active ? '' : ' dim') + '">' +
    '<span class="plsign ' + (active ? 'dn' : 'up') + '">' + (active ? '−' : '·') + '</span>' +
    '<span class="plci">' + ico + '</span><span class="plcl">' + esc(label) + '</span>' +
    '<span class="plcv">' + esc(val) + '</span></div>';
}

const CSS = `
#ncpol{position:absolute;top:calc(var(--topbarh) + 72px);left:620px;z-index:8;width:min(348px,calc(100vw - 660px));
  max-height:calc(100vh - var(--topbarh) - 92px);overflow-y:auto;background:var(--panel-solid);
  border:1px solid var(--edge);border-radius:10px;padding:10px 12px 12px;color:var(--bone);
  font-size:12px;line-height:1.35;box-shadow:0 8px 28px rgba(0,0,0,.55);}
@media (max-width:1400px){ #ncpol{left:260px;width:min(348px,calc(100vw - 300px));z-index:9;} }
@media (max-width:980px){ #ncpol{top:calc(var(--topbarh) + 108px);left:12px;width:min(348px,92vw);z-index:9;
  max-height:calc(100vh - var(--topbarh) - 128px);} }
#ncpol::-webkit-scrollbar{width:8px}#ncpol::-webkit-scrollbar-thumb{background:var(--edge);border-radius:4px}
#ncpol .plhead{display:flex;align-items:center;gap:8px;margin-bottom:6px}
#ncpol .pltitle{font-weight:700;letter-spacing:.06em;font-size:13px;flex:1}
#ncpol .plbadge{font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:#ffa63d;
  border:1px solid var(--edge);border-radius:4px;padding:1px 5px;white-space:nowrap}
#ncpol .plx{background:none;border:0;color:var(--mist);font-size:18px;line-height:1;cursor:pointer;padding:0 2px}
#ncpol .plx:hover{color:var(--bone)}
#ncpol .plintro{padding-left:0;color:var(--mist)}
#ncpol .plsec{display:flex;align-items:baseline;gap:6px;margin:12px 0 5px;font-size:10px;letter-spacing:.1em;
  text-transform:uppercase;color:var(--mist);white-space:nowrap}
#ncpol .plsecv{margin-left:auto;color:var(--bone);letter-spacing:0;font-size:11px;
  text-transform:none;font-variant-numeric:tabular-nums}
#ncpol .plbar{position:relative;height:10px;border-radius:5px;background:#0d0b12;border:1px solid var(--edge)}
#ncpol .plfill{position:absolute;inset:0;opacity:.85;border-radius:4px}
#ncpol .plmark{position:absolute;top:-2px;bottom:-2px;width:3px;margin-left:-1.5px;background:var(--bone);
  border-radius:2px;box-shadow:0 0 0 1px rgba(0,0,0,.7)}
#ncpol .plends{display:flex;justify-content:space-between;gap:8px;margin-top:4px;color:var(--mist);font-size:11px}
#ncpol .plends b{color:var(--bone);font-weight:600}
#ncpol .plends b.dn{color:var(--invalid)}
/* 🧭 The compass glyph. rotate(0) points ↑ = north, which is the same zero the
   bearing uses — so the CSS transform is the bearing, unconverted. */
#ncpol .plwind{display:flex;align-items:center;gap:10px;margin:2px 0 4px}
#ncpol .plarrow{font-size:26px;line-height:1;color:#ffa63d;display:inline-block;width:24px;text-align:center}
#ncpol .plflat{padding-left:0}
#ncpol .plcauses{margin-top:6px;border-top:1px solid var(--edge);padding-top:5px}
#ncpol .plcause{display:flex;align-items:center;gap:6px;padding:1.5px 0}
#ncpol .plcause.dim{opacity:.55}
#ncpol .plsign{width:9px;text-align:center;font-weight:700}
#ncpol .plsign.up{color:var(--valid)}#ncpol .plsign.dn{color:var(--invalid)}
#ncpol .plci{width:14px;text-align:center}
#ncpol .plcl{flex:1;color:var(--bone);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#ncpol .plat{font-style:normal;color:var(--mist);opacity:.7;font-size:10px}
#ncpol .plcv{color:var(--mist);font-variant-numeric:tabular-nums}
#ncpol .plnote{margin-top:6px;font-size:11px;color:var(--mist);background:rgba(79,216,232,.06);
  border-left:2px solid var(--edge);padding:4px 7px;border-radius:0 4px 4px 0}
#ncpol .plnote.warn{color:#ffbf9a;border-left-color:var(--ember);background:rgba(255,122,47,.06)}
#ncpol .plnote code{color:var(--sky,#8fd0e8);font-size:10px}
#ncpol .plnote b{color:var(--bone)}
#ncpol .plsrc{border-top:1px solid var(--edge);padding-top:5px}
#ncpol .plsrow{display:flex;align-items:center;gap:6px;padding:2px 0}
#ncpol .plsn{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--bone)}
#ncpol .plsv{width:38px;text-align:right;font-variant-numeric:tabular-nums;color:var(--mist)}
#ncpol .plst{width:70px;text-align:right;font-size:10px;white-space:nowrap}
#ncpol .plst.ok{color:var(--valid)}#ncpol .plst.warn{color:#e0a060}#ncpol .plst.bad{color:var(--invalid)}
#ncpol .plsub2{color:var(--mist);font-size:10px;padding:0 0 5px 18px;opacity:.85}
#ncpol .plsub2 b{color:var(--bone)}
#ncpol .plsub2 b.dn{color:var(--invalid)}
#ncpol .plgrp{margin:9px 0 3px;font-size:10px;color:var(--mist);opacity:.75;letter-spacing:.05em}
#ncpol .plrow{display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer}
#ncpol .plrow.off{opacity:.42;cursor:default}
#ncpol .plkey{flex:1;display:flex;align-items:center;gap:7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#ncpol .plsw{width:10px;height:10px;border-radius:2px;flex:none;box-shadow:0 0 0 1px rgba(0,0,0,.5)}
#ncpol .plsw.blank{background:none;box-shadow:none}
#ncpol .plramp{display:inline-block;width:58px;height:7px;border-radius:3px;flex:none}
#ncpol .plsub{display:flex;align-items:center;gap:5px;padding:1px 0 3px 18px;color:var(--mist);font-size:10px}
#ncpol .pllo{color:var(--mist);font-size:10px}
#ncpol .plwait code{color:var(--sky,#8fd0e8);font-size:10px}
#ncpol .plempty{padding:14px 4px;color:var(--mist);text-align:center}
#ncpol input[type=checkbox]{accent-color:var(--ember);flex:none;cursor:pointer}
#ncpol input[type=checkbox]:disabled{cursor:default}
`;

export function isOpen() { return open; }

export function mount(h, a) {
  host = h; api = a;
  if (root) return;
  const st = document.createElement('style'); st.id = 'ncpol-css'; st.textContent = CSS;
  document.head.appendChild(st);
  root = document.createElement('div'); root.id = 'ncpol'; root.style.display = 'none';
  // Delegated and bound once — re-binding per render is how a panel that
  // repaints on every economy tick fires its handler N times.
  root.addEventListener('change', (ev) => {
    const cb = ev.target.closest('input[data-layer]'); if (!cb) return;
    layers[cb.dataset.layer] = cb.checked;
    api.onLayers();
  });
  root.addEventListener('click', (ev) => { if (ev.target.closest('[data-plclose]')) api.close(); });
  (document.body || document.documentElement).appendChild(root);
}

/* ⚠ THE CHECKBOXES ARE NOT REDRAWN WHILE THE POINTER IS INSIDE THE LEGEND.
   This panel refreshes on the economy tick, and replacing innerHTML underneath a
   player mid-click on a layer row swallows the click — the input is destroyed
   between mousedown and change. `:hover` is a live match, so this asks the real
   question rather than tracking enter/leave and getting it wrong when the panel
   scrolls under a stationary pointer. Lifted verbatim from /src/water/panel.js,
   which had to learn it. */
export function render(state, caps) {
  if (!root || !open) return;
  let hot = false;
  try { hot = !!root.querySelector('.plrow:hover') || !!(document.activeElement && root.contains(document.activeElement)); }
  catch (e) { hot = false; }
  if (hot) return;
  root.innerHTML = html(state, caps);
}

export function show(state, caps) { if (!root) return; open = true; root.style.display = ''; render(state, caps); }
export function hide() { if (!root) return; open = false; root.style.display = 'none'; }
