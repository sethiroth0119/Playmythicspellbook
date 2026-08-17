/* ════════════════════════════════════════════════════════════════════════════
   ⚡ THE ELECTRICITY INFO VIEW.
   ----------------------------------------------------------------------------
   BAR.md rubric dimension 12 — "UI legibility: panels are readable at a glance;
   demand/economy state is expressed as a METER WITH A SIGNED CAUSAL LIST, not a
   raw number." This panel is the project's clearest shot at that dimension, so
   the four things worth stealing from the CS2 reference are taken deliberately
   and each one is named where it is implemented:

     1. EVERY METER IS A RED→AMBER→GREEN GRADIENT WITH A MARKER, so state reads
        before the number does. The bar is a static gradient and only the marker
        moves — a bar that recolours itself makes the player re-learn the scale
        every time they open it.
     2. UNITS ARE HONEST AND MIXED. kW against MW, so "75.3 kW of 1.5 MW" shows
        the headroom without arithmetic. See fmtW().
     3. THE LEGEND IS NOT A KEY, IT IS THE OVERLAY CONTROL. Every row has a
        checkbox that turns that layer on in the world.
     4. LAYERS ARE GROUPED BY WHAT THEY PAINT — Building / Network / Terrain.
        That grouping IS the mental model: three paint surfaces.

   …and the fifth, which is the actual diagnostic: A NETWORK LAYER CARRIES TWO
   COLOURS, normal flow and BOTTLENECK. An availability percentage can never say
   WHERE the grid is choking; the bottleneck colour is the only thing here that
   can, which is why grid.js computes flow per segment at all.

   🔴 THE PANEL'S OWN CSS IS SCOPED AND INJECTED FROM HERE, not added to
      index.html. Three other workflows are editing that file's style block this
      round; every rule below is prefixed `#ncpwr` so the two cannot collide, and
      the colours are node-city's own custom properties (--panel-solid, --edge,
      --bone, --mist, --ember) so this reads as the same application rather than
      as CS2's skin pasted in.
   ════════════════════════════════════════════════════════════════════════════ */

import { POWER } from './tuning.js';

let root = null, open = false, host = null, api = null;

/* ── LAYERS ─────────────────────────────────────────────────────────────────
   `need` names the capability a row depends on. A row whose capability is
   absent renders DISABLED and says why, and can never be switched on.

   🔴 THIS IS THE ANTI-FALLBACK RULE, AND IT IS THE POINT.
      The three terrain rows come from the reference and need a water/pollution
      model that does not exist in this repo yet — a parallel workflow owns
      `/src/water` and `/src/pollution`. The tempting build is a plausible-looking
      procedural wind field so the row lights up. That is precisely the failure
      this integration was warned about: "a guarded fallback that fires forever
      looks exactly like a working feature." A fake groundwater layer would be
      indistinguishable from a real one at a glance, would be believed, and would
      then have to be un-taught. So these rows are wired to the REAL agreed API
      (window.MythicWater / window.MythicPollution) and, until that module lands,
      they sit visibly greyed with the reason printed. The day it lands they
      light up with no change here. */
export const LAYERS = [
  { id: 'plants',       group: 'building', sw: 'plant',       label: 'Power Plants' },
  { id: 'transformers', group: 'building', sw: 'transformer', label: 'Transformers' },
  { id: 'batteries',    group: 'building', sw: 'battery',     label: 'Batteries' },
  { id: 'demand',       group: 'building', ramp: 'demandRamp', label: 'Electricity Consumption',
    lo: 'Low', hi: 'High' },
  { id: 'lv',           group: 'network',  sw: 'lv',          label: 'Low Voltage Electric Cables',
    sub: [['lvFlow', 'Electricity Flow'], ['lvChoke', 'Bottleneck']] },
  { id: 'hv',           group: 'network',  sw: 'hv',          label: 'High Voltage Power Lines',
    sub: [['hvFlow', 'Electricity Flow'], ['hvChoke', 'Bottleneck']] },
  /* ☁ OURS, and named for what it actually is. A row called "Air Pollution"
     would promise a dispersion model this module does not have and must not
     invent; "Emission Sources" promises exactly what it draws — how dirty each
     plant standing in the city is. When /src/pollution lands it can add the
     plume layer beside this one and the two will not contradict each other. */
  { id: 'emit',         group: 'building', ramp: 'emitRamp',  label: 'Emission Sources',
    lo: 'Clean', hi: 'Dirty' },
  { id: 'wind',         group: 'terrain',  ramp: 'windRamp',  label: 'Wind Speed & Direction',
    lo: 'Low', hi: 'High', need: 'wind', from: 'window.MythicPollution.wind()' },
  /* ♨ The only terrain row with no external dependency: geology.js is ours. */
  { id: 'heat',         group: 'terrain',  ramp: 'heatRamp',  label: 'Geothermal Heat',
    lo: 'Cold', hi: 'Hot' },
  { id: 'ground',       group: 'terrain',  ramp: 'groundRamp', label: 'Groundwater Deposits',
    lo: 'Low', hi: 'High', need: 'ground', from: 'window.MythicWater.endowment()' },
  { id: 'surface',      group: 'terrain',  ramp: 'surfaceRamp', label: 'Surface Water Flow',
    lo: 'Weak', hi: 'Strong', need: 'surface', from: 'window.MythicWater.sourceAt()' },
];
const GROUP_LABEL = { building: 'Building color', network: 'Network color', terrain: 'Terrain color' };

/* Default-on is the electrical story only. The reference ships with Surface
   Water Flow unchecked for the same reason: an info view that turns on every
   layer at once is a colour soup, and the first read must be the one the panel
   is named after. */
export const layers = { plants: true, transformers: false, batteries: false, demand: true,
                        emit: false, lv: true, hv: true, wind: false, heat: false,
                        ground: false, surface: false };

/* ── UNITS ──────────────────────────────────────────────────────────────────
   The reference's honesty about magnitude is load-bearing: "Consumption 75.3 kW"
   beside "Production 40 MW" tells the player the headroom is enormous before
   they have read either number properly. So the unit floats per value rather
   than being fixed for the panel. */
function fmtW(units) {
  const kw = (Number(units) || 0) * POWER.unitKW;
  if (Math.abs(kw) >= 1000) return (kw / 1000).toFixed(kw >= 10000 ? 0 : 2).replace(/\.00$/, '') + ' MW';
  return (Math.abs(kw) >= 100 ? kw.toFixed(0) : kw.toFixed(1)) + ' kW';
}
function fmtWh(unitMin) {
  const kwh = (Number(unitMin) || 0) * POWER.unitKW / 60;
  if (kwh >= 1000) return (kwh / 1000).toFixed(2) + ' MWh';
  return kwh.toFixed(kwh >= 100 ? 0 : 1) + ' kWh';
}
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ── THE METER ──────────────────────────────────────────────────────────────
   One static red→amber→green gradient, one marker. `t` is 0..1 along the bar.
   The stop positions come from POWER.meters so the colour boundaries and the
   thresholds the panel's prose quotes cannot drift apart. */
function meter(t, stops, label) {
  const p = Math.max(0, Math.min(1, Number(t) || 0));
  const g = 'linear-gradient(90deg,#c0473f 0%,#c0473f ' + (stops.red * 100) + '%,' +
            '#d99a2b ' + (stops.red * 100) + '%,#d99a2b ' + (stops.amber * 100) + '%,' +
            '#4caf7a ' + (stops.amber * 100) + '%,#4caf7a 100%)';
  return '<div class="pwbar" role="meter" aria-valuenow="' + Math.round(p * 100) +
         '" aria-label="' + esc(label || '') + '"><div class="pwfill" style="background:' + g + '"></div>' +
         '<div class="pwmark" style="left:' + (p * 100).toFixed(1) + '%"></div></div>';
}

function causeList(rows) {
  if (!rows || !rows.length) return '';
  return '<div class="pwcauses">' + rows.map(r =>
    '<div class="pwcause' + (r.dim ? ' dim' : '') + '">' +
      '<span class="pwsign ' + (r.sign === '+' ? 'up' : 'dn') + '">' + r.sign + '</span>' +
      '<span class="pwci">' + esc(r.ico || '') + '</span>' +
      '<span class="pwcl">' + esc(r.label) + '</span>' +
      '<span class="pwcv">' + fmtW(r.v) + '</span>' +
    '</div>').join('') + '</div>';
}

function swatch(col) { return '<i class="pwsw" style="background:' + col + '"></i>'; }
function rampStrip(name) {
  const stops = POWER.col[name] || [];
  return '<i class="pwramp" style="background:linear-gradient(90deg,' + stops.join(',') + ')"></i>';
}

/* ── THE LEGEND / OVERLAY CONTROL ───────────────────────────────────────── */
function legend(caps) {
  let h = '<div class="pwsec">MAP LEGEND</div>';
  for (const g of ['building', 'network', 'terrain']) {
    const rows = LAYERS.filter(l => l.group === g);
    if (!rows.length) continue;
    h += '<div class="pwgrp">' + GROUP_LABEL[g] + '</div>';
    for (const l of rows) {
      const okCap = !l.need || caps[l.need];
      const on = !!layers[l.id] && okCap;
      h += '<label class="pwrow' + (okCap ? '' : ' off') + '">' +
             '<span class="pwkey">' + (l.sw ? swatch(POWER.col[l.sw]) : '<i class="pwsw blank"></i>') +
             esc(l.label) + '</span>' +
             '<input type="checkbox" data-layer="' + l.id + '"' + (on ? ' checked' : '') +
             (okCap ? '' : ' disabled') + '>' +
           '</label>';
      if (l.ramp) h += '<div class="pwsub"><span class="pwlo">' + esc(l.lo) + '</span>' + rampStrip(l.ramp) +
                       '<span class="pwlo">' + esc(l.hi) + '</span></div>';
      if (l.sub) h += '<div class="pwsub">' + l.sub.map(([c, t]) => swatch(POWER.col[c]) + '<span class="pwlo">' + esc(t) + '</span>').join('') + '</div>';
      /* The honest empty state. Naming the exact global the row is waiting for
         means the next builder does not have to read this file to find the seam. */
      if (!okCap) h += '<div class="pwsub pwwait">awaiting <code>' + esc(l.from) + '</code></div>';
    }
  }
  return h;
}

function html(s, caps) {
  if (!s || !s.ok) {
    return header(s) + '<div class="pwempty">The grid model is not answering.' +
      (s && s.why ? '<br><span class="pwlo">' + esc(s.why) + '</span>' : '') + '</div>' + legend(caps);
  }
  const M = POWER.meters;

  // AVAILABILITY. ratio 1 lands on the amber/green boundary — exactly met, no
  // headroom — and 2x or better puts the marker at the far right, which is the
  // reference's "comfortable margin" read.
  const availT = Math.max(0, Math.min(1, s.ratio / M.availability.ratioFull));

  // RESERVE MARGIN replaces the reference's ELECTRICITY TRADE row. node-city has
  // no neighbour connection to import from or export to, and a trade meter
  // pinned at "0 kW / 0 kW" forever would be the decorative fallback this whole
  // integration is meant to refuse. Reserve margin plays the same role the trade
  // bar plays — a second, differently-shaped question about the same grid — and
  // it is a question this city can actually answer. The Power Station's own
  // blueprint text already argues for it: "overbuilding is waste".
  const resT = Math.max(0, Math.min(1, (s.reserve + 0.05) / 0.5));
  const battT = s.store.cap > 0 ? s.store.charge / s.store.cap : 0;

  let h = header(s);

  h += '<div class="pwsec">ELECTRICITY AVAILABILITY</div>' + meter(availT, M.availability, 'Electricity availability');
  h += '<div class="pwends"><span>Consumption: <b>' + fmtW(s.load) + '</b></span>' +
       '<span>Production: <b>' + fmtW(s.capacity) + '</b></span></div>';
  h += causeList((s.causes.supply || []).concat(s.causes.demand || []));
  if (s.factor < 1) h += '<div class="pwnote warn">⚡ BROWNOUT — the city is running at ' +
                          Math.round(s.factor * 100) + '% on average. See LOAD SHEDDING for who is paying it.</div>';

  /* ══ 🔌 THE METERING OPT-IN ═══════════════════════════════════════════════
     node-city declares powerNeed on 21 of its 54 building rows and its own
     comment says the other 33 were left alone because retro-fitting them "would
     brown out every save made before this layer existed". That is a statement
     about SAVES, so this is a statement to the player about their save: a city
     founded after the ladder landed is metered from its first tick, an older one
     is not, and turning it on is a decision they make with the bill in front of
     them rather than one that happens to them on load.
     ⚠ THE BUTTON QUOTES THE PRICE BEFORE IT IS PAID. "15 building types" and,
       once on, the exact figure it added. A switch whose cost is only visible
       after you press it is a switch nobody presses twice. */
  h += s.meteredOn
    ? '<div class="pwnote">🔌 <b>Metered</b> — extraction, workshops and venues that never declared a draw are billed for it (' +
        (s.meteredCount || 0) + ' building' + (s.meteredCount === 1 ? '' : 's') + ', ' + fmtW(s.meterLoad || 0) +
        '). <button class="pwbtn" data-pwmeter="0">Unmeter</button></div>'
    : '<div class="pwnote">🔌 <b>Legacy demand</b> — this city was built before the grid metered its mines, farms, depots and workshops, so those 15 building types still draw nothing. ' +
        '<button class="pwbtn" data-pwmeter="1">Meter them</button></div>';

  /* ══ 🪜 THE SHED LADDER ═══════════════════════════════════════════════════
     The answer to "powers homes and buildings different", and the one section
     that turns a single availability percentage into something a player can act
     on. Only printed while the city is actually short: a ladder that says
     "everything 100%" every tick is a section players learn to stop reading,
     which is the same argument index.html makes for its ⚡ chip and this file
     already makes for GRID DIAGNOSTICS. */
  if (s.classes && s.classes.length && s.factor < 0.999) {
    h += '<div class="pwsec">LOAD SHEDDING<span class="pwsecv">' + Math.round(s.factor * 100) + '% city average</span></div>';
    h += '<div class="pwlad">';
    for (const c of s.classes) {
      const pct = Math.round(c.factor * 100);
      const tone = c.share > 0.999 ? 'ok' : c.share > 0.5 ? 'mid' : 'bad';
      h += '<div class="pwlrow ' + tone + '" title="' + esc(c.desc) + '">' +
             '<span class="pwci">' + esc(c.ico) + '</span>' +
             '<span class="pwcl">' + esc(c.label) + '</span>' +
             '<span class="pwlbar"><i style="width:' + Math.round(c.share * 100) + '%"></i></span>' +
             '<span class="pwcv">' + pct + '%</span>' +
           '</div>';
    }
    h += '</div>';
    h += '<div class="pwnote">The grid sheds from the bottom up. Lifeline and utility load is served first and is never cut to nothing; leisure goes dark before a clinic dims.</div>';
    if (!s.shedOk) h += '<div class="pwnote warn">⚠ The shed audit did not balance this tick, so every building is running at the flat city average instead. Nothing was lost — the ladder simply refused to guess.</div>';
  }

  /* ══ 🏭 THE FLEET ═════════════════════════════════════════════════════════
     Every generator standing, what it is making, and WHY it is not making more.
     A capacity number cannot say "the wind dropped" or "the core is at 74%", and
     those are the only two facts that let a player fix it. */
  if (s.byPlant && s.byPlant.length) {
    h += '<div class="pwsec">GENERATING FLEET<span class="pwsecv">' + s.byPlant.length + '</span></div><div class="pwfleet">';
    for (const p of s.byPlant.slice().sort((a, b) => b.out - a.out)) {
      const av = typeof p.avail === 'number' ? p.avail : 1;
      const tone = p.out <= 0 ? 'bad' : av < 0.7 ? 'mid' : 'ok';
      h += '<div class="pwfrow ' + tone + '">' +
             '<span class="pwci">' + esc(p.ico || '⚡') + '</span>' +
             '<span class="pwcl">' + esc(p.name || p.type) +
               '<i class="pwwhy">' + esc(p.why || (p.out <= 0 ? 'no output' : '')) + '</i></span>' +
             '<span class="pwav">' + Math.round(av * 100) + '%</span>' +
             '<span class="pwcv">' + fmtW(p.out) + '</span>' +
           '</div>';
    }
    h += '</div>';
  }

  /* ☁ EMISSIONS. Reported honestly, including the case nobody is listening —
     the same honest-empty-state rule the terrain legend rows follow, applied to
     a number instead of a layer. */
  if (s.emissions && (s.emissions.air > 0 || s.emissions.ground > 0 || s.emissions.water > 0)) {
    const e = s.emissions;
    h += '<div class="pwsec">EMISSIONS THIS TICK</div>';
    h += '<div class="pwends"><span>☁ air <b>' + e.air.toFixed(3) + '</b></span>' +
         '<span>🪨 ground <b>' + e.ground.toFixed(3) + '</b></span>' +
         '<span>💧 water <b>' + e.water.toFixed(3) + '</b></span></div>';
    h += e.live
      ? '<div class="pwnote">Delivered to <code>window.MythicPollution.emit()</code> — ' + e.calls + ' call' + (e.calls === 1 ? '' : 's') + ' this tick.</div>'
      : '<div class="pwnote warn">Nothing is consuming these yet: <code>window.MythicPollution</code> has not loaded, so the smoke is measured and not yet modelled. Siting a dirty plant away from the water is still the right instinct.</div>';
  }

  h += '<div class="pwsec">RESERVE MARGIN</div>' + meter(resT, M.reserve, 'Reserve margin');
  h += '<div class="pwends"><span>' + (s.net < 0 ? 'Shortfall: <b class="dn">' + fmtW(-s.net) + '</b>'
                                                 : 'Headroom: <b class="up">' + fmtW(s.net) + '</b>') + '</span>' +
       '<span>' + (s.capacity > 0 ? Math.round(s.reserve * 100) + '% spare' : 'no generation') + '</span></div>';
  if (s.reserve > M.reserve.wasteAbove && s.plantCount > 1)
    h += '<div class="pwnote">− Overbuilt: ' + Math.round(s.reserve * 100) +
         '% of capacity is idle, and power is never banked beyond the buffer.</div>';

  h += '<div class="pwsec">BATTERY CHARGE<span class="pwsecv">' + fmtWh(s.store.charge) + ' / ' + fmtWh(s.store.cap) + '</span></div>';
  h += meter(battT, M.battery, 'Battery charge');
  h += '<div class="pwends"><span>' + (s.store.out > 0 ? '▼ discharging' : s.store.in > 0 ? '▲ charging' : 'idle') + '</span>' +
       '<span>' + (s.store.cap > 0 ? s.plantCount + ' transformer yard' + (s.plantCount === 1 ? '' : 's')
                                   : 'no storage — build a Power Station') + '</span></div>';

  /* ── DIAGNOSTICS. Only printed when there is something to say. A section that
     is always present and always says "all clear" is a section players stop
     reading, which is the same argument index.html makes for its ⚡ 0% chip. */
  const ch = s.topo.chokes.length, un = s.topo.unserved.length;
  const lossy = !s.enforce && s.lossWouldBe > 0;
  if (ch || un || lossy || s.idlePlants) {
    h += '<div class="pwsec">GRID DIAGNOSTICS</div><div class="pwdiag">';
    /* The one failure a production figure alone can never explain: a plant that
       is built, standing and connected, and generating nothing because nobody
       is working it. Without this line the panel shows a Power Station on the
       map and 0 kW of production and leaves the player to guess. */
    if (s.idlePlants) h += '<div class="pwnote warn">👷 ' + s.idlePlants + ' generator' + (s.idlePlants === 1 ? '' : 's') +
                           ' producing nothing — a plant with no crew makes no power. Hire workers, or check it is not damaged.</div>';
    if (lossy) h += '<div class="pwnote">〰 Line loss would be <b>' + fmtW(s.lossWouldBe) + '</b> over an average run of ' +
                    s.topo.meanHop.toFixed(1) + ' tiles. Not charged — transmission is diagnostic until ' +
                    'POWER.transmission.enforce is turned on, so no existing city is re-balanced by this panel arriving.</div>';
    if (ch) h += '<div class="pwnote warn">🔌 ' + ch + ' cable segment' + (ch === 1 ? '' : 's') +
                 ' over rating. Turn on a network layer to see where — bottlenecks paint red on low voltage, magenta on high.</div>';
    if (un) h += '<div class="pwnote warn">⛓ ' + un + ' building' + (un === 1 ? '' : 's') +
                 ' sit off the powered road network.' +
                 (s.enforce ? '' : ' Not charged today — transmission is diagnostic until POWER.transmission.enforce is turned on.') + '</div>';
    h += '</div>';
  }

  return h + legend(caps);
}

function header(s) {
  /* The model badge. If the host ever falls back to its own inline power maths
     — a 404 on this module, or a solve that refused — the player and any test
     can see WHICH model answered. A fallback that is invisible is a fallback
     that ships. */
  const badge = s && s.ok ? '' : '<span class="pwbadge">inline</span>';
  return '<div class="pwhead"><span class="pwtitle">⚡ ELECTRICITY</span>' + badge +
         '<button class="pwx" data-pwclose="1" aria-label="Close">×</button></div>';
}

const CSS = `
/* 🪟 WHERE IT SITS, and why it is not simply right:12px.
   node-city's HUD already owns both edges: #leftcol (left:12px, 236px) and
   #rightcol (right:12px, 232px, z-index 6), plus #adminbtn and the model
   buttons pinned top-right at z-index 7. Docking here at right:12px put the
   info view straight on top of the Vital Signs card — including the very ⚡
   chip that opens it, which is a panel that covers its own launcher.
   So it parks INBOARD of the right rail on a wide viewport and both rails stay
   readable, which matters because the whole point is to compare the meter
   against the city. Below 980px there is no room for three columns, so it
   takes the rail over instead and lifts above it. */
/* ⚠ AND IT STARTS BELOW #railbar. The dock is a full-width row pinned at
   topbarh+34 at z-index 43, so there is no horizontal way past it and it will
   always draw over this panel — which is the dock's stated design ("the
   launcher row stays lit and clickable while a panel is open"). +72px clears
   one row of .rl buttons with a gutter; the narrow breakpoint allows for the
   row wrapping to two. Measured against the live HUD, not eyeballed: docking at
   topbarh+6 put the ARMY/CAMP/SYNC/GOV launchers straight through this panel's
   own title bar. */
#ncpwr{position:absolute;top:calc(var(--topbarh) + 72px);right:256px;z-index:8;width:min(340px,calc(100vw - 300px));
  max-height:calc(100vh - var(--topbarh) - 92px);overflow-y:auto;background:var(--panel-solid);
  border:1px solid var(--edge);border-radius:10px;padding:10px 12px 12px;color:var(--bone);
  font-size:12px;line-height:1.35;box-shadow:0 8px 28px rgba(0,0,0,.55);}
@media (max-width:980px){ #ncpwr{top:calc(var(--topbarh) + 108px);right:12px;width:min(340px,92vw);z-index:9;
  max-height:calc(100vh - var(--topbarh) - 128px);} }
#ncpwr::-webkit-scrollbar{width:8px}#ncpwr::-webkit-scrollbar-thumb{background:var(--edge);border-radius:4px}
#ncpwr .pwhead{display:flex;align-items:center;gap:8px;margin-bottom:8px}
#ncpwr .pwtitle{font-weight:700;letter-spacing:.06em;font-size:13px;flex:1}
#ncpwr .pwbadge{font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--ember);
  border:1px solid var(--ember-dim);border-radius:4px;padding:1px 5px}
#ncpwr .pwx{background:none;border:0;color:var(--mist);font-size:18px;line-height:1;cursor:pointer;padding:0 2px}
#ncpwr .pwx:hover{color:var(--bone)}
#ncpwr .pwsec{display:flex;align-items:baseline;gap:6px;margin:12px 0 5px;font-size:10px;letter-spacing:.1em;
  text-transform:uppercase;color:var(--mist);white-space:nowrap}
/* ⚠ text-transform:none is load-bearing, not tidying. The section heading is
   uppercased, and the battery value is a UNIT — inheriting that turned "kWh"
   into "KWH", which is not a unit of anything. Same reason the value keeps its
   own letter-spacing: tracked-out digits are what made "20.9 kWh / 188 kWh"
   wrap onto a second line in a 340px panel. */
#ncpwr .pwsecv{margin-left:auto;color:var(--bone);letter-spacing:0;font-size:11px;
  text-transform:none;font-variant-numeric:tabular-nums}
/* ⚠ NO overflow:hidden ON THE BAR. The marker is the whole point of the meter —
   "state reads before the number does" — and it is deliberately taller than the
   track so it reads as a needle. Clipping it meant the two most important
   readings on the panel were the two you could not see: a healthy grid pins
   availability at 100% and a dead one pins it at 0%, and at both ends the
   needle was sliced to a sliver against the border. The rounding moves to the
   fill instead, which is what actually needed it. */
#ncpwr .pwbar{position:relative;height:10px;border-radius:5px;background:#0d0b12;
  border:1px solid var(--edge)}
#ncpwr .pwfill{position:absolute;inset:0;opacity:.85;border-radius:4px}
#ncpwr .pwmark{position:absolute;top:-2px;bottom:-2px;width:3px;margin-left:-1.5px;background:var(--bone);
  border-radius:2px;box-shadow:0 0 0 1px rgba(0,0,0,.7)}
#ncpwr .pwends{display:flex;justify-content:space-between;gap:8px;margin-top:4px;color:var(--mist);font-size:11px}
#ncpwr .pwends b{color:var(--bone);font-weight:600}
#ncpwr .pwends b.up{color:var(--valid)}#ncpwr .pwends b.dn{color:var(--invalid)}
#ncpwr .pwcauses{margin-top:6px;border-top:1px solid var(--edge);padding-top:5px}
#ncpwr .pwcause{display:flex;align-items:center;gap:6px;padding:1.5px 0}
#ncpwr .pwcause.dim{opacity:.55}
#ncpwr .pwsign{width:9px;text-align:center;font-weight:700}
#ncpwr .pwsign.up{color:var(--valid)}#ncpwr .pwsign.dn{color:var(--invalid)}
#ncpwr .pwci{width:14px;text-align:center}
#ncpwr .pwcl{flex:1;color:var(--bone);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#ncpwr .pwcv{color:var(--mist);font-variant-numeric:tabular-nums}
#ncpwr .pwnote{margin-top:6px;font-size:11px;color:var(--mist);background:rgba(255,122,47,.06);
  border-left:2px solid var(--ember-dim);padding:4px 7px;border-radius:0 4px 4px 0}
#ncpwr .pwnote.warn{color:#ffbf9a;border-left-color:var(--ember)}
#ncpwr .pwnote code{color:var(--sky);font-size:10px}
#ncpwr .pwbtn{background:rgba(255,122,47,.14);border:1px solid var(--ember-dim);color:var(--bone);
  border-radius:4px;padding:1px 7px;font:inherit;font-size:10.5px;cursor:pointer;margin-left:2px}
#ncpwr .pwbtn:hover{background:rgba(255,122,47,.28)}
/* 🪜 The shed ladder. One row per demand class, ordered exactly as the grid
   serves them, so the LIST ORDER is itself the information — the thing at the
   bottom is the thing that goes dark first. */
#ncpwr .pwlad{margin-top:6px;border-top:1px solid var(--edge);padding-top:5px}
#ncpwr .pwlrow{display:flex;align-items:center;gap:6px;padding:2px 0}
#ncpwr .pwlbar{flex:1.2;height:6px;border-radius:3px;background:#0d0b12;border:1px solid var(--edge);
  overflow:hidden;min-width:38px}
#ncpwr .pwlbar i{display:block;height:100%;background:var(--mist)}
#ncpwr .pwlrow.ok .pwlbar i{background:#4caf7a}
#ncpwr .pwlrow.mid .pwlbar i{background:#d99a2b}
#ncpwr .pwlrow.bad .pwlbar i{background:#c0473f}
#ncpwr .pwlrow.bad .pwcl{color:#ffbf9a}
/* 🏭 The fleet table. .pwwhy is the reason column and it is the whole point of
   the section — a capacity figure cannot say "the wind dropped".
   ⚠ NO BACKTICKS ANYWHERE IN THIS BLOCK. It is inside a template literal, so a
     backtick in a comment closes the string and the file stops parsing three
     hundred lines later with an error that names a CSS class. */
#ncpwr .pwfleet{margin-top:6px;border-top:1px solid var(--edge);padding-top:5px}
#ncpwr .pwfrow{display:flex;align-items:baseline;gap:6px;padding:2px 0}
#ncpwr .pwfrow .pwcl{display:flex;flex-direction:column;line-height:1.25}
#ncpwr .pwwhy{font-style:normal;font-size:10px;color:var(--mist);overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
#ncpwr .pwfrow.bad .pwwhy{color:#ffbf9a}
#ncpwr .pwav{width:36px;text-align:right;color:var(--mist);font-size:11px;font-variant-numeric:tabular-nums}
#ncpwr .pwfrow.ok .pwav{color:var(--valid)}
#ncpwr .pwfrow.mid .pwav{color:#d99a2b}
#ncpwr .pwfrow.bad .pwav{color:var(--invalid)}
#ncpwr .pwgrp{margin:9px 0 3px;font-size:10px;color:var(--mist);opacity:.75;letter-spacing:.05em}
#ncpwr .pwrow{display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer}
#ncpwr .pwrow.off{opacity:.42;cursor:default}
#ncpwr .pwkey{flex:1;display:flex;align-items:center;gap:7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#ncpwr .pwsw{width:10px;height:10px;border-radius:2px;flex:none;box-shadow:0 0 0 1px rgba(0,0,0,.5)}
#ncpwr .pwsw.blank{background:none;box-shadow:none}
#ncpwr .pwramp{display:inline-block;width:58px;height:7px;border-radius:3px;flex:none}
#ncpwr .pwsub{display:flex;align-items:center;gap:5px;padding:1px 0 3px 18px;color:var(--mist);font-size:10px}
#ncpwr .pwlo{color:var(--mist);font-size:10px}
#ncpwr .pwwait code{color:var(--sky);font-size:10px}
#ncpwr .pwempty{padding:14px 4px;color:var(--mist);text-align:center}
#ncpwr input[type=checkbox]{accent-color:var(--ember);flex:none;cursor:pointer}
#ncpwr input[type=checkbox]:disabled{cursor:default}
`;

export function isOpen() { return open; }

export function mount(h, a) {
  host = h; api = a;
  if (root) return;
  const st = document.createElement('style'); st.id = 'ncpwr-css'; st.textContent = CSS;
  document.head.appendChild(st);
  root = document.createElement('div'); root.id = 'ncpwr'; root.style.display = 'none';
  /* Delegated, and bound once. Re-binding per render is how a panel that
     re-renders on every economy tick ends up firing its handler N times. */
  root.addEventListener('change', (ev) => {
    const cb = ev.target.closest('input[data-layer]'); if (!cb) return;
    layers[cb.dataset.layer] = cb.checked;
    api.onLayers();
  });
  root.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-pwclose]')) { api.close(); return; }
    const m = ev.target.closest('[data-pwmeter]');
    if (m && api.meter) api.meter(m.dataset.pwmeter === '1');
  });
  (document.body || document.documentElement).appendChild(root);
}

/* ── REFRESH ────────────────────────────────────────────────────────────────
   ⚠ THE CHECKBOXES ARE NOT REDRAWN WHILE THE POINTER IS INSIDE THE LEGEND.
     This panel refreshes on the economy tick. Replacing innerHTML underneath a
     player who is mid-click on a layer row swallows the click — the input is
     destroyed between mousedown and change. So a full rebuild is deferred while
     the legend has focus/hover, and only the meters are re-rendered. */
export function render(state, caps) {
  if (!root || !open) return;
  /* `:hover` is a live match, so this asks the real question — "is the pointer
     on a layer row right now" — rather than tracking mouseenter/mouseleave and
     getting it wrong when the panel scrolls under a stationary pointer. */
  let hot = false;
  try { hot = !!root.querySelector('.pwrow:hover') || !!(document.activeElement && root.contains(document.activeElement)); }
  catch (e) { hot = false; }
  if (hot) return;
  root.innerHTML = html(state, caps);
}

export function show(state, caps) { if (!root) return; open = true; root.style.display = ''; render(state, caps); }
export function hide() { if (!root) return; open = false; root.style.display = 'none'; }
