/* ════════════════════════════════════════════════════════════════════════════
   💧 THE WATER INFO VIEW.
   ----------------------------------------------------------------------------
   BAR.md rubric dimension 12 — "panels are readable at a glance; demand/economy
   state is expressed as a METER WITH A SIGNED CAUSAL LIST, not a raw number."
   This panel is built to the same grammar as /src/power/panel.js on purpose, so
   the two utilities read as one application rather than as two features:

     1. EVERY METER IS A RED→AMBER→GREEN GRADIENT WITH A MARKER. The bar is a
        static gradient and only the marker moves — a bar that recolours itself
        makes the player re-learn the scale every time they open it.
     2. THE LEGEND IS NOT A KEY, IT IS THE OVERLAY CONTROL. Every row has a
        checkbox that turns that layer on in the world.
     3. LAYERS ARE GROUPED BY WHAT THEY PAINT — Terrain / Building — because
        that grouping IS the mental model.

   …and the one thing this panel has that the electricity panel does not: A
   NAMED SOURCE TABLE. "Supply is 82%" can never tell a player WHICH basin is
   emptying or WHICH one has gone bad, and that is the only question that leads
   to an action — move the plant, or move the waterworks.

   🔴 THE PANEL'S OWN CSS IS SCOPED AND INJECTED FROM HERE, not added to
      index.html. Three other workflows are editing that file's style block this
      round; every rule below is prefixed `#ncwtr` so nothing can collide, and
      the colours are node-city's own custom properties.

   ⚠ IT DOCKS ON THE LEFT. /src/power's panel parks inboard of the RIGHT rail at
     right:256px, and both info views can be open at once — a player comparing a
     coal plant's load against the aquifer under it is doing exactly what this
     batch is for. Docking both on the same side would put one on top of the
     other the first time they tried.
   ════════════════════════════════════════════════════════════════════════════ */

import { WATER } from './tuning.js';

let root = null, open = false, host = null, api = null;

/* ── LAYERS ─────────────────────────────────────────────────────────────────
   `need` names a capability the row depends on; a row whose capability is
   absent renders DISABLED and names the global it is waiting for, and can never
   be switched on. Same anti-fallback rule /src/power/panel.js states: a layer
   that draws something plausible when its data source is missing is
   indistinguishable from a working feature and would have to be un-taught. */
export const LAYERS = [
  { id: 'aquifer', group: 'terrain', ramp: 'aquiferRamp', label: 'Groundwater Deposits',
    lo: 'Thin', hi: 'Deep',
    sub2: ['taintRamp', 'Contaminated'] },
  { id: 'surface', group: 'terrain', ramp: 'surfaceRamp', label: 'Surface Water',
    lo: 'Still', hi: 'Flowing' },
  { id: 'stress',  group: 'terrain', sw: 'stress', label: 'Drawdown' },
  { id: 'wells',   group: 'building', sw: 'well', label: 'Waterworks',
    sub: [['wellDry', 'No source — condensing only']] },
  { id: 'draw',    group: 'building', ramp: 'drawRamp', label: 'Water Consumption',
    lo: 'Low', hi: 'High' },
];
const GROUP_LABEL = { terrain: 'Terrain color', building: 'Building color' };

/* Default-on is the story the panel is named after: where the water is, and
   what is drinking it. Drawdown and consumption are diagnostics the player
   turns on when the meters tell them to — an info view that lights every layer
   at once is a colour soup and its first read says nothing. */
export const layers = { aquifer: true, surface: true, stress: false, wells: true, draw: false };

/* ── UNITS ──────────────────────────────────────────────────────────────────
   node-city's water is an abstract per-minute ledger quantity. The panel speaks
   m³/min so the numbers read as a utility rather than as a spreadsheet, and the
   conversion happens HERE and nowhere else — WATER.unitM3 is documented as
   cosmetic and no simulation result may depend on it. */
function fmtQ(units) {
  const v = (Number(units) || 0) * WATER.unitM3;
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(2) + ' km³/min';
  return (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)) + ' m³/min';
}
function fmtVol(unitMin) {
  const v = (Number(unitMin) || 0) * WATER.unitM3;
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M m³';
  if (v >= 1000) return (v / 1000).toFixed(1) + 'k m³';
  return v.toFixed(0) + ' m³';
}
const pct = (v) => Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 100) + '%';
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function meter(t, stops, label) {
  const p = Math.max(0, Math.min(1, Number(t) || 0));
  const g = 'linear-gradient(90deg,#c0473f 0%,#c0473f ' + (stops.red * 100) + '%,' +
            '#d99a2b ' + (stops.red * 100) + '%,#d99a2b ' + (stops.amber * 100) + '%,' +
            '#4caf7a ' + (stops.amber * 100) + '%,#4caf7a 100%)';
  return '<div class="wtbar" role="meter" aria-valuenow="' + Math.round(p * 100) +
         '" aria-label="' + esc(label || '') + '"><div class="wtfill" style="background:' + g + '"></div>' +
         '<div class="wtmark" style="left:' + (p * 100).toFixed(1) + '%"></div></div>';
}

/* ── THE CAUSAL LIST ────────────────────────────────────────────────────────
   Built from the SAME per-well decomposition the tick charged, never a second
   derivation of it. Rows below `minShare` fold into one "…and N smaller" line so
   the total stays exact while the list stays readable — the rule node-city's own
   away report already states for its leaver list. */
function causes(s) {
  const rows = [];
  const byKind = { aquifer: 0, surface: 0, none: 0 };
  for (const w of s.wells) byKind[w.src === 'none' ? 'none' : w.src] += w.out || 0;
  if (byKind.aquifer > 0) rows.push({ sign: '+', ico: '🕳', label: 'Wells over groundwater', v: byKind.aquifer });
  if (byKind.surface > 0) rows.push({ sign: '+', ico: '🌊', label: 'Intakes on surface water', v: byKind.surface });
  if (byKind.none > 0) rows.push({ sign: '+', ico: '🌫', label: 'Condensing from air only', v: byKind.none, dim: true });
  if (s.rejected > 0.0005) rows.push({ sign: '−', ico: '☣', label: 'Rejected — contaminated source', v: s.rejected });
  if (s.drink > 0) rows.push({ sign: '−', ico: '🚰', label: 'Citizens drinking', v: s.drink });

  const users = (s.users || []).slice().sort((a, b) => b.draw - a.draw);
  const total = users.reduce((n, u) => n + u.draw, 0);
  let folded = 0, foldedV = 0;
  for (const u of users) {
    if (rows.length >= WATER.causes.maxRows || (total > 0 && u.draw / total < WATER.causes.minShare)) {
      folded++; foldedV += u.draw; continue;
    }
    rows.push({ sign: '−', ico: u.ico || '🏭', label: u.name || u.k, v: u.draw });
  }
  if (folded) rows.push({ sign: '−', ico: '', label: '…and ' + folded + ' smaller', v: foldedV, dim: true });
  if (!rows.length) return '';
  return '<div class="wtcauses">' + rows.map(r =>
    '<div class="wtcause' + (r.dim ? ' dim' : '') + '">' +
      '<span class="wtsign ' + (r.sign === '+' ? 'up' : 'dn') + '">' + r.sign + '</span>' +
      '<span class="wtci">' + esc(r.ico || '') + '</span>' +
      '<span class="wtcl">' + esc(r.label) + '</span>' +
      '<span class="wtcv">' + fmtQ(r.v) + '</span>' +
    '</div>').join('') + '</div>';
}

/* ── THE SOURCE TABLE — the thing a percentage can never say ─────────────── */
const STATUS = {
  full:         { ico: '●', cls: 'ok',   text: 'full' },
  recharging:   { ico: '▲', cls: 'ok',   text: 'recharging' },
  drawdown:     { ico: '▼', cls: 'warn', text: 'drawing down' },
  tainted:      { ico: '☣', cls: 'warn', text: 'tainted' },
  contaminated: { ico: '☣', cls: 'bad',  text: 'contaminated' },
};
function sources(s) {
  let h = '<div class="wtsec">SOURCES</div><div class="wtsrc">';
  for (const b of s.basins) {
    const st = STATUS[b.status] || STATUS.recharging;
    h += '<div class="wtsrow">' +
      '<span class="wtsn">🕳 ' + esc(b.name) + (b.springfed ? ' <i class="wtspring" title="Fed by surface water">⛲</i>' : '') + '</span>' +
      '<span class="wtsv" title="Reserve remaining">' + pct(b.level) + '</span>' +
      '<span class="wtsv" title="Purity">' + pct(b.purity) + '</span>' +
      '<span class="wtst ' + st.cls + '">' + st.ico + ' ' + st.text + '</span>' +
      '</div>' +
      '<div class="wtsub2">' + fmtVol(b.stock) + ' of ' + fmtVol(b.volume) +
        ' · pumping ' + fmtQ(b.pump) + ' against ' + fmtQ(b.recharge) + ' of recharge</div>';
  }
  if (s.surface.river || s.surface.lakes) {
    const bad = s.surface.purity < WATER.purity.warnBelow;
    h += '<div class="wtsrow">' +
      '<span class="wtsn">🌊 ' + (s.surface.river ? 'River' : '') +
        (s.surface.river && s.surface.lakes ? ' &amp; ' : '') +
        (s.surface.lakes ? (s.surface.lakes === 1 ? 'Lake' : s.surface.lakes + ' lakes') : '') + '</span>' +
      '<span class="wtsv" title="Effectively unlimited">∞</span>' +
      '<span class="wtsv" title="Purity">' + pct(s.surface.purity) + '</span>' +
      '<span class="wtst ' + (bad ? 'bad' : 'ok') + '">' + (bad ? '☣ polluted' : '● clean') + '</span>' +
      '</div>' +
      '<div class="wtsub2">drawing ' + fmtQ(s.surface.draw) +
        (s.surface.river ? ' · open water carries pollution downstream to every intake below it' : '') + '</div>';
  }
  return h + '</div>';
}

function legend(caps) {
  let h = '<div class="wtsec">MAP LEGEND</div>';
  for (const g of ['terrain', 'building']) {
    const rows = LAYERS.filter(l => l.group === g);
    if (!rows.length) continue;
    h += '<div class="wtgrp">' + GROUP_LABEL[g] + '</div>';
    for (const l of rows) {
      const okCap = !l.need || caps[l.need];
      const on = !!layers[l.id] && okCap;
      h += '<label class="wtrow' + (okCap ? '' : ' off') + '">' +
             '<span class="wtkey">' + (l.sw ? swatch(WATER.col[l.sw]) : '<i class="wtsw blank"></i>') +
             esc(l.label) + '</span>' +
             '<input type="checkbox" data-layer="' + l.id + '"' + (on ? ' checked' : '') +
             (okCap ? '' : ' disabled') + '>' +
           '</label>';
      if (l.ramp) h += '<div class="wtsub"><span class="wtlo">' + esc(l.lo) + '</span>' + rampStrip(l.ramp) +
                       '<span class="wtlo">' + esc(l.hi) + '</span></div>';
      if (l.sub2) h += '<div class="wtsub">' + rampStrip(l.sub2[0]) + '<span class="wtlo">' + esc(l.sub2[1]) + '</span></div>';
      if (l.sub) h += '<div class="wtsub">' + l.sub.map(([c, t]) => swatch(WATER.col[c]) + '<span class="wtlo">' + esc(t) + '</span>').join('') + '</div>';
      if (!okCap) h += '<div class="wtsub wtwait">awaiting <code>' + esc(l.from) + '</code></div>';
    }
  }
  return h;
}
function swatch(col) { return '<i class="wtsw" style="background:' + col + '"></i>'; }
function rampStrip(name) {
  const stops = WATER.col[name] || [];
  return '<i class="wtramp" style="background:linear-gradient(90deg,' + stops.join(',') + ')"></i>';
}

function header(s) {
  /* The class badge is the answer to the user's actual request — "some cities
     have more water than others" — stated in one word the moment the panel
     opens. The `static` badge marks a panel drawn without a solve behind it. */
  const badge = s && s.ok
    ? '<span class="wtbadge" title="' + esc(s.cls.blurb) + '">' + s.cls.ico + ' ' + esc(s.cls.label) + '</span>'
    : '<span class="wtbadge">static</span>';
  return '<div class="wthead"><span class="wttitle">💧 WATER</span>' + badge +
         '<button class="wtx" data-wtclose="1" aria-label="Close">×</button></div>';
}

function html(s, caps) {
  if (!s || !s.ok) {
    return header(s) + '<div class="wtempty">The hydrology model is not answering.' +
      (s && s.why ? '<br><span class="wtlo">' + esc(s.why) + '</span>' : '') + '</div>' + legend(caps);
  }
  const M = WATER.meters;
  const ratio = s.draw > 0 ? s.capacity / s.draw : (s.capacity > 0 ? M.supply.ratioFull : 1);
  const supT = Math.max(0, Math.min(1, ratio / M.supply.ratioFull));

  let h = header(s);
  h += '<div class="wtsub2 wtintro">' + esc(s.cls.blurb) + '</div>';

  h += '<div class="wtsec">WATER SUPPLY</div>' + meter(supT, M.supply, 'Water supply');
  h += '<div class="wtends"><span>Demand: <b>' + fmtQ(s.draw) + '</b></span>' +
       '<span>Supply: <b>' + fmtQ(s.capacity) + '</b></span></div>';
  h += causes(s);
  if (s.shortfall > 0.0005)
    h += '<div class="wtnote warn">💧 SHORT BY ' + fmtQ(s.shortfall) +
         ' — the city is drinking its reserves. Water coverage falls, and thirst is already in the vitals card.</div>';
  if (!s.demandKnown)
    h += '<div class="wtnote">Demand is partial: the host did not hand over its per-citizen drink rate this tick, ' +
         'so only building consumption is counted.</div>';

  h += '<div class="wtsec">AQUIFER RESERVES<span class="wtsecv">' + pct(s.meanLevel) + '</span></div>';
  h += meter(s.meanLevel, M.reserve, 'Aquifer reserves');
  h += '<div class="wtends"><span>' + (s.overdraft
        ? 'Pumping <b class="dn">' + fmtQ(s.pumped) + '</b> against ' + fmtQ(s.recharge) + ' of recharge'
        : 'Pumping <b class="up">' + fmtQ(s.pumped) + '</b> against ' + fmtQ(s.recharge) + ' of recharge') + '</span></div>';
  if (s.overdraft) {
    /* ⚠ THE OFFENDING BASINS ARE NAMED, because the totals above can look
       healthy while one basin empties — the flag is deliberately per-basin (see
       hydro.js) and a warning that contradicts the line above it without saying
       why is a warning players learn to dismiss. */
    const over = s.basins.filter(b => b.pump > b.recharge * 1.02).map(b => b.name);
    h += '<div class="wtnote warn">▼ OVERDRAFT — ' + esc(over.join(' and ')) +
         (over.length === 1 ? ' is' : ' are') + ' pumped harder than ' +
         (over.length === 1 ? 'it recharges' : 'they recharge') +
         '. Yield falls as the level does. Build over another basin, take an intake off surface water, or use less.</div>';
  }

  h += '<div class="wtsec">PURITY<span class="wtsecv">' + pct(s.meanPurity) + '</span></div>';
  h += meter(s.meanPurity, M.purity, 'Water purity');
  h += '<div class="wtends"><span>' + (s.rejected > 0.0005
        ? '<b class="dn">' + fmtQ(s.rejected) + '</b> rejected at the plant'
        : 'nothing rejected') + '</span></div>';
  /* 🔴 THE HONEST EMPTY STATE. Contamination is driven by /src/pollution, a
     parallel workflow. Until it lands the water is clean because it IS clean —
     and the panel says which global it is waiting for, rather than showing a
     purity meter that can never move and letting the player conclude the
     mechanic is broken. */
  if (!s.pollution)
    h += '<div class="wtnote">Contamination monitoring inactive — awaiting <code>window.MythicPollution.groundAt()</code>. ' +
         'Purity shown is the ground\'s own, before any industry.</div>';

  h += sources(s);

  const dry = s.wells.filter(w => w.src === 'none').length;
  if (dry) h += '<div class="wtnote">🌫 ' + dry + ' waterworks ' + (dry === 1 ? 'is' : 'are') +
                ' standing on dry ground and condensing from air alone — ' +
                Math.round(WATER.extract.atmos * 100) + '% of nominal. Turn on Groundwater Deposits and move ' +
                (dry === 1 ? 'it' : 'them') + ' over a basin.</div>';

  return h + legend(caps);
}

const CSS = `
/* 🪟 WHERE IT SITS. node-city's HUD owns both edges — #leftcol (left:12px,
   236px) and #rightcol (right:12px, 232px) — and #railbar is a full-width dock
   at topbarh+34 that always draws over a panel. So this parks INBOARD of the
   LEFT rail and below the dock, mirroring /src/power's panel on the right so
   both utilities can be open at once without covering each other or their own
   launchers. Below 980px there is no room for three columns and it takes the
   rail over instead. */
#ncwtr{position:absolute;top:calc(var(--topbarh) + 72px);left:260px;z-index:8;width:min(348px,calc(100vw - 300px));
  max-height:calc(100vh - var(--topbarh) - 92px);overflow-y:auto;background:var(--panel-solid);
  border:1px solid var(--edge);border-radius:10px;padding:10px 12px 12px;color:var(--bone);
  font-size:12px;line-height:1.35;box-shadow:0 8px 28px rgba(0,0,0,.55);}
@media (max-width:980px){ #ncwtr{top:calc(var(--topbarh) + 108px);left:12px;width:min(348px,92vw);z-index:9;
  max-height:calc(100vh - var(--topbarh) - 128px);} }
#ncwtr::-webkit-scrollbar{width:8px}#ncwtr::-webkit-scrollbar-thumb{background:var(--edge);border-radius:4px}
#ncwtr .wthead{display:flex;align-items:center;gap:8px;margin-bottom:6px}
#ncwtr .wttitle{font-weight:700;letter-spacing:.06em;font-size:13px;flex:1}
#ncwtr .wtbadge{font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--sky,#8fd0e8);
  border:1px solid var(--edge);border-radius:4px;padding:1px 5px;white-space:nowrap}
#ncwtr .wtx{background:none;border:0;color:var(--mist);font-size:18px;line-height:1;cursor:pointer;padding:0 2px}
#ncwtr .wtx:hover{color:var(--bone)}
#ncwtr .wtintro{padding-left:0;color:var(--mist)}
#ncwtr .wtsec{display:flex;align-items:baseline;gap:6px;margin:12px 0 5px;font-size:10px;letter-spacing:.1em;
  text-transform:uppercase;color:var(--mist);white-space:nowrap}
/* text-transform:none on the value for the same reason /src/power's panel states
   it: the heading is uppercased and a unit is not a word — "m³/MIN" is not a
   unit of anything. */
#ncwtr .wtsecv{margin-left:auto;color:var(--bone);letter-spacing:0;font-size:11px;
  text-transform:none;font-variant-numeric:tabular-nums}
/* NO overflow:hidden on the bar — the marker is deliberately taller than the
   track so it reads as a needle, and clipping it hides the two readings that
   matter most, the pinned ones at either end. */
#ncwtr .wtbar{position:relative;height:10px;border-radius:5px;background:#0d0b12;border:1px solid var(--edge)}
#ncwtr .wtfill{position:absolute;inset:0;opacity:.85;border-radius:4px}
#ncwtr .wtmark{position:absolute;top:-2px;bottom:-2px;width:3px;margin-left:-1.5px;background:var(--bone);
  border-radius:2px;box-shadow:0 0 0 1px rgba(0,0,0,.7)}
#ncwtr .wtends{display:flex;justify-content:space-between;gap:8px;margin-top:4px;color:var(--mist);font-size:11px}
#ncwtr .wtends b{color:var(--bone);font-weight:600}
#ncwtr .wtends b.up{color:var(--valid)}#ncwtr .wtends b.dn{color:var(--invalid)}
#ncwtr .wtcauses{margin-top:6px;border-top:1px solid var(--edge);padding-top:5px}
#ncwtr .wtcause{display:flex;align-items:center;gap:6px;padding:1.5px 0}
#ncwtr .wtcause.dim{opacity:.55}
#ncwtr .wtsign{width:9px;text-align:center;font-weight:700}
#ncwtr .wtsign.up{color:var(--valid)}#ncwtr .wtsign.dn{color:var(--invalid)}
#ncwtr .wtci{width:14px;text-align:center}
#ncwtr .wtcl{flex:1;color:var(--bone);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#ncwtr .wtcv{color:var(--mist);font-variant-numeric:tabular-nums}
#ncwtr .wtnote{margin-top:6px;font-size:11px;color:var(--mist);background:rgba(79,216,232,.06);
  border-left:2px solid var(--edge);padding:4px 7px;border-radius:0 4px 4px 0}
#ncwtr .wtnote.warn{color:#ffbf9a;border-left-color:var(--ember);background:rgba(255,122,47,.06)}
#ncwtr .wtnote code{color:var(--sky,#8fd0e8);font-size:10px}
#ncwtr .wtsrc{border-top:1px solid var(--edge);padding-top:5px}
#ncwtr .wtsrow{display:flex;align-items:center;gap:6px;padding:2px 0}
#ncwtr .wtsn{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--bone)}
#ncwtr .wtspring{font-style:normal;opacity:.8}
#ncwtr .wtsv{width:38px;text-align:right;font-variant-numeric:tabular-nums;color:var(--mist)}
#ncwtr .wtst{width:92px;text-align:right;font-size:10px;white-space:nowrap}
#ncwtr .wtst.ok{color:var(--valid)}#ncwtr .wtst.warn{color:#e0a060}#ncwtr .wtst.bad{color:var(--invalid)}
#ncwtr .wtsub2{color:var(--mist);font-size:10px;padding:0 0 5px 18px;opacity:.85}
#ncwtr .wtgrp{margin:9px 0 3px;font-size:10px;color:var(--mist);opacity:.75;letter-spacing:.05em}
#ncwtr .wtrow{display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer}
#ncwtr .wtrow.off{opacity:.42;cursor:default}
#ncwtr .wtkey{flex:1;display:flex;align-items:center;gap:7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#ncwtr .wtsw{width:10px;height:10px;border-radius:2px;flex:none;box-shadow:0 0 0 1px rgba(0,0,0,.5)}
#ncwtr .wtsw.blank{background:none;box-shadow:none}
#ncwtr .wtramp{display:inline-block;width:58px;height:7px;border-radius:3px;flex:none}
#ncwtr .wtsub{display:flex;align-items:center;gap:5px;padding:1px 0 3px 18px;color:var(--mist);font-size:10px}
#ncwtr .wtlo{color:var(--mist);font-size:10px}
#ncwtr .wtwait code{color:var(--sky,#8fd0e8);font-size:10px}
#ncwtr .wtempty{padding:14px 4px;color:var(--mist);text-align:center}
#ncwtr input[type=checkbox]{accent-color:var(--ember);flex:none;cursor:pointer}
#ncwtr input[type=checkbox]:disabled{cursor:default}
`;

export function isOpen() { return open; }

export function mount(h, a) {
  host = h; api = a;
  if (root) return;
  const st = document.createElement('style'); st.id = 'ncwtr-css'; st.textContent = CSS;
  document.head.appendChild(st);
  root = document.createElement('div'); root.id = 'ncwtr'; root.style.display = 'none';
  // Delegated and bound once — re-binding per render is how a panel that
  // repaints on every economy tick fires its handler N times.
  root.addEventListener('change', (ev) => {
    const cb = ev.target.closest('input[data-layer]'); if (!cb) return;
    layers[cb.dataset.layer] = cb.checked;
    api.onLayers();
  });
  root.addEventListener('click', (ev) => { if (ev.target.closest('[data-wtclose]')) api.close(); });
  (document.body || document.documentElement).appendChild(root);
}

/* ⚠ THE CHECKBOXES ARE NOT REDRAWN WHILE THE POINTER IS INSIDE THE LEGEND.
   This panel refreshes on the economy tick, and replacing innerHTML underneath a
   player mid-click on a layer row swallows the click — the input is destroyed
   between mousedown and change. `:hover` is a live match, so this asks the real
   question rather than tracking enter/leave and getting it wrong when the panel
   scrolls under a stationary pointer. */
export function render(state, caps) {
  if (!root || !open) return;
  let hot = false;
  try { hot = !!root.querySelector('.wtrow:hover') || !!(document.activeElement && root.contains(document.activeElement)); }
  catch (e) { hot = false; }
  if (hot) return;
  root.innerHTML = html(state, caps);
}

export function show(state, caps) { if (!root) return; open = true; root.style.display = ''; render(state, caps); }
export function hide() { if (!root) return; open = false; root.style.display = 'none'; }
