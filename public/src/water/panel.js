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
  /* 🚰 The mains. A BUILDING layer, not a terrain one: pipes are the only thing
     in this panel the player put there. The pipe tool switches this on for
     itself while it is armed — an editing surface has to be visible while it is
     being edited — and this row is how the player keeps it up afterwards. */
  { id: 'pipes',   group: 'building', sw: 'pipe', label: 'Water Mains',
    sub: [['pipeDead', 'No waterworks on this run']] },
];
const GROUP_LABEL = { terrain: 'Terrain color', building: 'Building color' };

/* Default-on is the story the panel is named after: where the water is, and
   what is drinking it. Drawdown and consumption are diagnostics the player
   turns on when the meters tell them to — an info view that lights every layer
   at once is a colour soup and its first read says nothing. */
export const layers = { aquifer: true, surface: true, stress: false, wells: true, draw: false, pipes: true };

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
  /* ⚠ `sea` HAS TO BE DECLARED HERE, NOT DISCOVERED. The line below indexes this
     object by `w.src`, which is `sourceAt().kind` — so the round that added a
     third body type would otherwise have added `undefined + out = NaN` to the
     causal list and printed it, silently, only in coastal cities. */
  const byKind = { aquifer: 0, surface: 0, sea: 0, none: 0 };
  for (const w of s.wells) byKind[w.src === 'none' ? 'none' : w.src] += w.out || 0;
  if (byKind.aquifer > 0) rows.push({ sign: '+', ico: '🕳', label: 'Wells over groundwater', v: byKind.aquifer });
  if (byKind.surface > 0) rows.push({ sign: '+', ico: '🌊', label: 'Intakes on surface water', v: byKind.surface });
  // Named for what it costs, not for where it is: the player's question about a
  // coastal plant is always "why is it worse than the river one".
  if (byKind.sea > 0) rows.push({ sign: '+', ico: '🧂', label: 'Desalinating sea water', v: byKind.sea });
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
  /* 🌊 THE COAST, FIRST AMONG THE SURFACE BODIES AND ALWAYS PRINTED.
     Ordered above the river deliberately: it is the body that is always there,
     and a table that listed it last would teach a player it is the exception.
     ⚠ `∞` for reserve like the river, but the purity column is where the whole
       lesson lives — a flat 30% that never moves, against a river's 94% that
       does. The sub-line says the two things the number cannot: how far inland
       it reaches, and that no amount of cleaning up will improve it. */
  if (s.sea) {
    h += '<div class="wtsrow">' +
      '<span class="wtsn">🌊 ' + esc(s.sea.name) + ' <i class="wtspring" title="Salt water">🧂</i></span>' +
      '<span class="wtsv" title="Effectively unlimited">∞</span>' +
      '<span class="wtsv" title="Purity — salt, and it never changes">' + pct(s.sea.purity) + '</span>' +
      '<span class="wtst ok">● salt</span>' +
      '</div>' +
      '<div class="wtsub2">drawing ' + fmtQ(s.sea.draw) + ' · the ' + esc(s.sea.side) +
        ' ' + (s.sea.inland === 1 ? 'column is' : s.sea.inland + ' columns are') +
        ' coastal · salt is not pollution and does not clean up</div>';
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

/* ── 🚰 MAINS & SEWER ───────────────────────────────────────────────────────
   Everything here is read off `s.net` — network.js's own answer for the tick
   that was just charged — and NOTHING is re-derived. The panel's job is to
   explain the number the city was charged, and a panel that computes its own
   version of that number is a panel that will eventually contradict the game
   while looking authoritative.

   🔴 THE HONEST EMPTY STATE COMES FIRST. An unplumbed city is not "0% served";
      it is a city the mains do not govern at all, and saying so is the whole
      grandfathering promise made visible. A meter pinned at zero would tell a
      player who has never laid a pipe that something is broken. */
function mains(s) {
  const n = s.net;
  if (!n) return '';
  const SW = WATER.sewer;

  if (!n.plumbed) {
    return '<div class="wtsec">MAINS &amp; SEWER</div>' +
      '<div class="wtnote">🚰 This city is not plumbed. No mains, no Water Station, no Outfall — so every ' +
      'waterworks delivers at 100% and nothing here governs it. Lay a run with the 🚰 <b>Pipes</b> tool, or ' +
      'build a 🚰 Water Station over a basin, and the network starts to matter.</div>';
  }

  const d = n.demand;
  /* 🔴 REACHED, NOT ATTACHED, AND THE DIFFERENCE IS THE WHOLE HEADLINE. A
     building can sit on a main that has no waterworks anywhere on it; that
     building is plumbed to nothing. Reading `attached` here printed "100% of
     demand · every building reached" directly above a warning that a waterworks
     was at 65% — two lines of the same panel disagreeing, with the player left
     to decide which one to believe. `reached` is set by the same pass in
     network.js that sets `served`, so this line and that warning are now the
     same walk. */
  const reach = d.total > 0 ? d.reached / d.total : 1;
  let h = '<div class="wtsec">MAINS<span class="wtsecv">' + pct(reach) + ' of demand</span></div>';
  h += meter(reach, WATER.meters.supply, 'Mains coverage');
  h += '<div class="wtends"><span>' + n.pipes + ' tile' + (n.pipes === 1 ? '' : 's') + ' of main · ' +
       n.components + ' network' + (n.components === 1 ? '' : 's') + '</span>' +
       '<span>' + (d.unservedTiles
         ? '<b class="dn">' + d.unservedTiles + '</b> building' + (d.unservedTiles === 1 ? '' : 's') + ' unreached'
         : 'every building reached') + '</span></div>';

  /* 🔴 THE OFF-MAINS WATERWORKS ARE NAMED AND THE PENALTY IS QUOTED, because
     this is the one place where a number the player cannot see is taking their
     water away. /src/power's panel says "N buildings sit off the powered road
     network. Not charged today" — this one is charged today, so it says by how
     much. */
  const off = (n.wells || []).filter(w => w.governed && w.factor < 0.999);
  if (off.length) {
    const worst = off.reduce((a, b) => (b.factor < a.factor ? b : a));
    /* 🔴 THE ADVICE NAMES THE PIPE THAT WOULD FIX IT, and after this round it
       can, because there are exactly two reasons a governed waterworks is
       below 1: it is on no main at all, or there is demand nobody reaches and
       this is the nearest station to it. Both are one drag. The old text said
       "a run of pipe is the whole fix" for a penalty whose denominator was the
       whole city — where the actual remedy was joining two mains the panel
       never mentioned, so the sentence was advice that could not work. */
    h += '<div class="wtnote warn">🚰 ' + off.length + ' waterworks ' + (off.length === 1 ? 'is' : 'are') +
      ' delivering below capacity because of the mains — the worst is at <b>' + esc(worst.k) + '</b>, at ' +
      pct(worst.factor) + ' of what the ground under it would give. ' +
      (worst.comp < 0
        ? 'It is not on a main at all: drag a run from it to the district it feeds.'
        : 'Its own main reaches ' + fmtQ(worst.onMain) + ' of demand and there is ' + fmtQ(worst.missed) +
          ' nearer to it that no main reaches — a run of pipe out to that demand is the whole fix.') +
      '</div>';
  }
  if (n.components > 1) {
    h += '<div class="wtnote">There ' + (n.components === 2 ? 'are two separate networks' : 'are ' + n.components + ' separate networks') +
      '. A waterworks only delivers to the run it is standing on — two mains that never touch are two cities as far ' +
      'as the water is concerned.</div>';
  }

  h += '<div class="wtsec">SEWER<span class="wtsecv">' +
       (n.sewage.load > 0 ? pct(1 - n.backup) + ' treated' : 'no load') + '</span></div>';
  h += meter(n.sewage.load > 0 ? 1 - n.backup : 1, WATER.meters.purity, 'Sewage treated');
  h += '<div class="wtends"><span>Waste: <b>' + fmtQ(n.sewage.load) + '</b></span>' +
       '<span>Outfall capacity: <b>' + fmtQ(n.sewage.capacity) + '</b></span></div>';
  if (n.backup > SW.warnAbove) {
    /* The penalty is STATED as the multiplier the tick applied, not as a mood.
       "Sewage is backing up" is a warning; "the waterworks on that main are at
       72% because of it" is a decision.

       🔴 AND IT IS SAID PER MAIN, because that is now where the arithmetic
          happens. "Every waterworks in the city is at X" was true when one
          scalar was multiplied into every well; it is false now, and a panel
          that keeps saying it would be telling a player with a clean, outfalled
          district that their clean district is poisoned. Each backed-up main is
          named with its own share and its own multiplier. */
    const backed = (n.sewage.byComp || []).filter(c => c.backup > SW.warnAbove && c.load > 0);
    h += '<div class="wtnote warn">🚱 ' + pct(n.backup) + ' of this city\'s sewage has nowhere to go, and untreated ' +
      'waste soaks into the shallow ground the intakes on that main draw from. ' +
      (backed.length <= 1
        ? 'The waterworks on it ' + (backed.length && backed[0].wells === 1 ? 'is' : 'are') + ' at <b>' +
          pct(n.sewerFactor) + '</b>.'
        : backed.length + ' separate mains are backing up: ' +
          backed.slice().sort((a, b) => a.sewer - b.sewer)
            .map(c => 'the one carrying ' + fmtQ(c.load) + ' of waste is at <b>' + pct(c.sewer) + '</b>').join(', ') + '.') +
      ' Build a 🚱 Sewer Outfall on open water and connect it to the SAME main — an outfall on a different ' +
      'network treats nothing here, however big it is.</div>';
    const bad = n.sewage.outfalls.filter(o => o.effective <= 0 && o.why);
    if (bad.length) {
      h += '<div class="wtnote warn">' + bad.map(o => '· the outfall at ' + esc(o.k) + ' — ' + esc(o.why)).join('<br>') + '</div>';
    } else if (!n.sewage.outfalls.length) {
      h += '<div class="wtnote">This city has no Sewer Outfall at all. It is in the 🛤️ Infrastructure section of the build bar.</div>';
    }
  }
  return h;
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

  h += mains(s);

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
