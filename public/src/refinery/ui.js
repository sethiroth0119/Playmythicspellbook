/* ═══════════════════════════════════════════════════════════════════════════
   🛢 HIDN PETRO — the overlay, the panels, and the session loop
   ---------------------------------------------------------------------------
   One overlay, a 3D yard on the left and a work panel on the right. The panel
   is re-rendered wholesale on state changes (the app's own idiom) EXCEPT for
   the live run gauges and the blend sliders, which are patched in place —
   re-rendering a range input under a dragging finger drops the drag, and the
   run panel updates four times a second.
   ═════════════════════════════════════════════════════════════════════════ */

import { CRUDES, GRADES, COMPONENTS, EQUIPMENT, EQUIP_LIST, CONVERSION_LIST,
         STREAMS, LAB_TIERS, specCheck, envelope } from './data.js';
import * as St from './state.js';
import * as Sim from './sim.js';
import * as C from './contracts.js';
import * as B from './blend.js';
import * as Yard from './scene.js';
import * as Build from './build.js';
import * as Models from './models.js';
import * as Walk from './walk.js';

let el = null;                 // #hp-overlay
let tab = 'intake';
let run = null;                // live Sim run, or null
let runTimer = 0, sessionTimer = 0;
let bench = {};                // componentId -> litres on the bench
let benchContract = null;
let market = [];               // crude shipments on offer
let lastTest = null;           // most recent lab reading, for non-live labs
let closing = null;

const fmt = n => Math.round(n || 0).toLocaleString();
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ═══ OPEN / CLOSE ═══════════════════════════════════════════════════════ */
export function open(onClose) {
  if (el) return;
  closing = onClose || null;
  const s = St.S();

  /* 🔴 SETTLE ANYTHING THAT LANDED WHILE THE YARD WAS SHUT.
     Deliveries only used to settle on the session tick, which runs while the
     overlay is open — so a player who dispatched a truck and left the yard was
     simply never paid for it, and the contract sat there until it expired and
     fined them. Trucks keep rolling whether or not anyone is watching; this is
     where the road catches up with the ledger.
     ⚠ ORDER MATTERS. Arrivals settle BEFORE the P&L is reset, so a delivery
     that landed between sessions is reported and then correctly excluded from
     THIS session's statement — it was not earned in this session. */
  let awayArrivals = [];
  let awayExpired = [];
  try { awayArrivals = C.settleArrivals(); } catch (e) {}
  try { awayExpired = C.sweepExpired(); } catch (e) {}

  s.pnl = St.freshPnl();                 // a session gets a fresh statement
  C.refreshMarket();
  if (!s.offers.length || Date.now() - (s.offersRolledAt || 0) > 10 * 60000) C.rollOffers(5);
  rollMarket();

  el = document.createElement('div');
  el.id = 'hp-overlay';
  el.innerHTML = shell();
  document.body.appendChild(el);

  // 3D is a bonus, never a requirement. If three.js is not there, or the
  // context fails, the fallback card explains itself and the game plays on.
  const holder = el.querySelector('#hp-yard-canvas');
  const startYard = () => {
    try {
      if (Yard.init(holder, { onInteract, onEnter, onFrame })) { Yard.start(); syncYard(); bindYardHud(); }
      else showFallback();
    } catch (e) { try { console.warn('[refinery] 3D yard failed:', e); } catch (e2) {} showFallback(); }
  };
  if (Yard.available()) startYard();
  else {
    const b = St.bridge();
    if (b && b.loadThree) { try { b.loadThree(ok => { if (ok && Yard.available()) startYard(); else showFallback(); }); } catch (e) { showFallback(); } }
    else showFallback();
  }

  bind();
  paint();
  sessionTimer = setInterval(sessionTick, 1000);

  // Tell the player what happened in their absence, once, rather than letting
  // them wonder why the Cinder count moved.
  if (awayArrivals.length || awayExpired.length) {
    const paid = awayArrivals.reduce((a, x) => a + (x.paid | 0), 0);
    const bits = [];
    if (awayArrivals.length) bits.push(awayArrivals.length + ' load' + (awayArrivals.length === 1 ? '' : 's') + ' arrived while you were away · 🔥' + fmt(paid));
    if (awayExpired.length) bits.push(awayExpired.length + ' contract' + (awayExpired.length === 1 ? '' : 's') + ' ran out of clock');
    setTimeout(() => { try { flash(bits.join(' · ')); } catch (e) {} }, 400);
    St.toast('🛢 ' + bits.join(' · '), 6000);
  }
}

function showFallback() {
  const holder = el && el.querySelector('#hp-yard-canvas');
  if (!holder) return;
  holder.innerHTML = '<div class="hp-yard-fallback"><div><div style="font-size:34px;margin-bottom:8px">🏭</div>' +
    '<b style="font-family:Oswald,sans-serif;letter-spacing:.1em">YARD VIEW UNAVAILABLE</b>' +
    '<div class="hp-muted" style="margin-top:8px;max-width:340px">The 3D engine did not load. Every part of the refinery still works — the yard is the view, not the game.</div></div></div>';
}

export function close() {
  if (!el) return;
  try { clearInterval(sessionTimer); } catch (e) {}
  try { clearInterval(runTimer); } catch (e) {}
  sessionTimer = runTimer = 0;
  if (run && !run.done && !run.aborted) {
    // An abandoned run is abandoned. Saying so is better than silently
    // pocketing the feed a player walked away from.
    St.log('warn', 'Left the yard mid-run — the column was shut down and the feed lost.');
    const s = St.S();
    const i = s.crude.findIndex(c => c.id === run.shipment.id);
    if (i >= 0) s.crude.splice(i, 1);
  }
  run = null;
  try { Yard.dispose(); } catch (e) {}
  try { el.remove(); } catch (e) {}
  el = null;
  St.save();
  if (closing) { try { closing(); } catch (e) {} closing = null; }
}

/* ═══ WALKING UP TO THINGS ════════════════════════════════════════════════
   The yard hands us whatever the operator is standing in front of. Most units
   simply open their panel; a build plot and the office door do something else. */
function onInteract(it) {
  if (!it) return;
  if (it.act === 'build') { openBuild(it.buildId); return; }
  if (it.act === 'door') { return; }            // the door opens on approach
  if (it.tab === 'contracts') { openContracts(); return; }
  if (it.tab) { tab = it.tab; paint(); }
}

/* Stepping in or out of the office. The roof handles itself in the scene; this
   is only about telling the player where they are. */
function onEnter(now) {
  if (now === 'office') flash('🏢 Head office — the terminal on the desk has the contract board');
}

/* Called every rendered frame with the current focus. Cheap by construction:
   it writes text only when the focus actually changed, because this runs 60
   times a second and a DOM write per frame is how a smooth yard becomes a
   janky one. */
let lastFocusId = null;
function onFrame(f) {
  if (!el) return;
  const id = f ? (f.id + '|' + f.label) : null;
  if (id === lastFocusId) return;
  lastFocusId = id;
  const p = el.querySelector('#hp-prompt');
  const eb = el.querySelector('#hp-ebtn');
  if (!p) return;
  if (!f) { p.hidden = true; if (eb) eb.hidden = !touchMode; return; }
  const warn = f.act === 'build' && !f.ready;
  p.hidden = false;
  p.className = 'hp-prompt' + (warn ? ' warn' : '');
  p.innerHTML = '<b>E</b> <span>' + esc(f.label) + '</span>' + (f.hint ? '<i>' + esc(f.hint) + '</i>' : '');
  if (eb) eb.hidden = false;
}

/* ═══ SHELL ══════════════════════════════════════════════════════════════ */
function shell() {
  return '<div class="hp-top">' +
      '<div class="hp-logo">🛢</div>' +
      '<div class="hp-brand"><h1>Hidn Petro</h1><span>The Cracking Yard</span></div>' +
      '<div class="hp-spacer"></div>' +
      '<div id="hp-chips" class="hp-row" style="flex-wrap:wrap;gap:6px"></div>' +
      '<button class="hp-x" id="hp-close">✕ Leave Yard</button>' +
    '</div>' +
    '<div class="hp-body">' +
      '<div class="hp-yard">' +
        '<div class="hp-yard-canvas" id="hp-yard-canvas"></div>' +
        /* The walking HUD. Sits over the canvas and is the only thing telling
           the player what pressing E will do, so it is never hidden. */
        '<div class="hp-prompt" id="hp-prompt" hidden></div>' +
        '<div class="hp-yardctl">' +
          '<button class="hp-btn sm" id="hp-view">🔭 Overview</button>' +
          '<span class="hp-keys">WASD move · Shift run · drag to look · <b>E</b> interact</span>' +
        '</div>' +
        '<div class="hp-stick" id="hp-stick" hidden><i></i></div>' +
        '<button class="hp-ebtn" id="hp-ebtn" hidden>E</button>' +
        '<div id="hp-flash"></div>' +
      '</div>' +
      '<div class="hp-side">' +
        '<div class="hp-tabs" id="hp-tabs"></div>' +
        '<div class="hp-pane" id="hp-pane"></div>' +
      '</div>' +
    '</div>';
}

const TABS = [
  ['intake',  '🛢 Intake'],
  ['run',     '🏭 Run'],
  ['blend',   '⚗️ Blend'],
  ['ship',    '🚛 Ship'],
  ['stock',   '📦 Stock'],
  ['yard',    '🏗 Yard'],
  ['ledger',  '📊 Ledger'],
];

function bind() {
  el.querySelector('#hp-close').onclick = () => { close(); };
  // Delegated, bound once — see the note in paint().
  el.querySelector('#hp-tabs').addEventListener('click', e => {
    const t = e.target.closest('[data-tab]');
    if (!t) return;
    tab = t.dataset.tab;
    paint();
  });
  // Esc leaves the yard. The overlay is fixed and full-screen, so without this
  // there is no keyboard exit at all.
  el.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  el.tabIndex = -1; el.focus();
}

/* ═══ PAINT ══════════════════════════════════════════════════════════════ */
export function paint() {
  if (!el) return;
  const s = St.S();
  chips(s);
  /* ⚠ DO NOT REWRITE THE TAB STRIP UNLESS IT CHANGED, and never rebind its
     handlers. paint() runs on the session tick, and replacing innerHTML under
     a pointer that is mid-click detaches the node the click was going to land
     on — the click is simply lost. The strip now re-renders only when its
     markup actually differs, and the click handler is DELEGATED to the
     container (bound once in bind()) so it survives every rebuild. */
  const strip = TABS.map(([id, label]) => {
    let dot = '';
    if (id === 'ship') { const n = s.contracts.filter(c => c.batchId).length; if (n) dot = '<span class="dot">' + n + '</span>'; }
    if (id === 'blend') { const n = s.contracts.filter(c => !c.batchId).length; if (n) dot = '<span class="dot">' + n + '</span>'; }
    return '<div class="hp-tab' + (tab === id ? ' on' : '') + '" data-tab="' + id + '">' + label + dot + '</div>';
  }).join('');
  const tabsEl = el.querySelector('#hp-tabs');
  if (tabsEl.innerHTML !== strip) tabsEl.innerHTML = strip;

  const pane = el.querySelector('#hp-pane');
  /* 🔴 SAY SO WHEN A PANE THROWS. This used to be a bare assignment: an
     exception anywhere in a pane builder aborted paint() with the PREVIOUS
     pane still on screen, so a crash was indistinguishable from a tab that
     simply did not respond. (It hid exactly that for real: paneRun called
     Sim.envelope, which lives in data.js.) A visible error is worse-looking
     and enormously better. */
  try {
    pane.innerHTML =
        tab === 'intake' ? paneIntake(s)
      : tab === 'run'    ? paneRun(s)
      : tab === 'blend'  ? paneBlend(s)
      : tab === 'ship'   ? paneShip(s)
      : tab === 'stock'  ? paneStock(s)
      : tab === 'yard'   ? paneYard(s)
      :                    paneLedger(s);
  } catch (err) {
    try { console.error('[refinery] pane "' + tab + '" failed:', err); } catch (e) {}
    pane.innerHTML = '<div class="hp-card bad"><h3>⚠ This panel failed to draw</h3>' +
      '<div class="hp-muted">Nothing was charged and nothing was lost — the rest of the yard still works. ' +
      'Details are in the browser console.</div><div class="hp-muted" style="margin-top:8px;color:#e8593a">' +
      esc(String((err && err.message) || err)) + '</div></div>';
    return;
  }
  wire(pane, s);
  syncYard();
}

function chips(s) {
  const c = [
    ['Cinder', '🔥 ' + fmt(St.cinder()), '#f0c75e'],
    ['Crude', fmt(St.crudeHeld(s)) + ' / ' + fmt(St.crudeCap(s)) + ' L', '#e8a13a'],
    ['Product', fmt(St.storeHeld(s)) + ' / ' + fmt(St.storeCap(s)) + ' L', '#7fb0ff'],
    ['Market', '×' + (s.marketIndex || 1).toFixed(2), (s.marketIndex > 1.06 ? '#7bc043' : s.marketIndex < 0.94 ? '#e8593a' : '#d8dde2')],
    ['Wholesale', St.repWholesale() + '/100', '#9fe6e6'],
  ];
  el.querySelector('#hp-chips').innerHTML = c.map(([l, v, col]) =>
    '<div class="hp-chip"><span class="lbl">' + l + '</span><span class="val" style="color:' + col + '">' + v + '</span></div>').join('');
}

function flash(msg) {
  const f = el && el.querySelector('#hp-flash');
  if (!f) return;
  f.innerHTML = '<div class="hp-flash">' + esc(msg) + '</div>';
  setTimeout(() => { try { if (f.firstChild) f.innerHTML = ''; } catch (e) {} }, 2600);
}

function syncYard() {
  const s = St.S();
  Yard.setLive({
    running: !!(run && !run.done && !run.aborted),
    severity: run ? Sim.severity(run) : 0,
    storeFill: St.storeCap(s) ? St.storeHeld(s) / St.storeCap(s) : 0,
    crudeFill: St.crudeCap(s) ? St.crudeHeld(s) / St.crudeCap(s) : 0,
    blending: Object.values(bench).some(v => v > 0),
  });
}

/* ═══ 1 · INTAKE ═════════════════════════════════════════════════════════ */
function rollMarket() {
  const s = St.S();
  market = [];
  // Sellers quote against the space you actually have — see rollShipment().
  const room = Math.max(8000, St.crudeCap(s) - St.crudeHeld(s));
  const pool = CRUDES.slice();
  for (let i = 0; i < 4; i++) {
    const g = pool[Math.floor(Math.random() * pool.length)];
    market.push(Sim.rollShipment(g.id, s.marketIndex, room));
  }
  // Condensate is rare enough to be an event; it should not be on the board
  // every single time or the "rare" in its blurb is a lie.
  if (Math.random() > 0.28) market = market.filter(m => m.grade !== 'condens');
  if (!market.length) market.push(Sim.rollShipment('midcon', s.marketIndex, room));
}

function paneIntake(s) {
  let h = '<div class="hp-card"><h3>🛢 Crude Intake <span class="r">' + fmt(St.crudeHeld(s)) + ' / ' + fmt(St.crudeCap(s)) + ' L stored</span></h3>' +
    '<div class="hp-muted">Every shipment is a gamble on an assay. Your laboratory decides how much of it you get to see before you pay — right now it is a <b style="color:#e8a13a">' + esc(St.lab().name) + '</b>.</div>' +
    '<div class="hp-row" style="margin-top:9px"><button class="hp-btn sm" id="hp-reroll">↻ New shipments on offer</button></div></div>';

  for (const sh of market) {
    const a = Sim.readAssay(sh);
    const room = St.crudeCap(s) - St.crudeHeld(s) >= sh.litres;
    const afford = St.cinder() >= sh.price;
    const rng = (v, unit) => a.exact ? '<b>' + (typeof v === 'number' ? v : v) + (unit || '') + '</b>'
      : (typeof v === 'object' ? '<b>' + v.lo + '–' + v.hi + (unit || '') + '</b>' : '<b>' + esc(v) + '</b>');
    h += '<div class="hp-offer">' +
      '<div class="hd"><b>' + esc(sh.gradeName) + '</b><span class="hp-muted">' + fmt(sh.litres) + ' L</span>' +
        '<span class="pay">🔥 ' + fmt(sh.price) + '</span></div>' +
      '<div class="sub">' +
        'API gravity ' + rng(a.exact ? a.api : a.api) + ' · ' +
        'Sulfur ' + rng(a.exact ? a.sulfur : a.sulfur, '%') + ' · ' +
        'BS&amp;W ' + rng(a.exact ? a.bsw : a.bsw, '%') + ' · ' +
        'Contamination ' + rng(a.exact ? a.contam : a.contam, typeof a.contam === 'object' ? '%' : '') +
        (a.exact ? '' : '<span class="hp-err"> · ±' + a.tier.err.toFixed(2) + ' lab error</span>') +
      '</div>' +
      '<div class="sub" style="margin-top:4px;color:#6f7780">' + esc((CRUDES.find(c => c.id === sh.grade) || {}).blurb || '') + '</div>' +
      '<div class="act"><button class="hp-btn pri sm" data-buy="' + sh.id + '"' + (room && afford ? '' : ' disabled') + '>Accept shipment</button>' +
        (!room ? '<span class="hp-muted" style="align-self:center">No tank space</span>' : !afford ? '<span class="hp-muted" style="align-self:center">Cannot afford</span>' : '') +
      '</div></div>';
  }

  h += '<div class="hp-card"><h3>🧴 Pre-Treatment <span class="r">desalter</span></h3>' +
    '<div class="hp-muted">Each pass strips about half the remaining water and sediment and a third of the contamination — and destroys 0.4% of the volume. Over-treating a clean barrel is money and litres burned; under-treating a filthy one fouls the column and caps the purity of everything that comes off it.</div>';
  if (!s.crude.length) h += '<div class="hp-muted" style="margin-top:9px;color:#6f7780">Nothing in the crude tanks.</div>';
  for (const sh of s.crude) {
    const cost = Sim.pretreatCost(sh);
    const dirty = sh.bsw > 1.2 || sh.contam > 1.2;
    h += '<div class="hp-row" style="margin-top:9px;align-items:flex-start">' +
      '<div style="flex:1"><b>' + esc(sh.gradeName) + '</b> <span class="hp-muted">' + fmt(sh.litres) + ' L · pass ' + (sh.treated | 0) + '</span>' +
      '<div class="hp-muted">BS&amp;W <b style="color:' + (sh.bsw > 1.2 ? '#e8593a' : '#7bc043') + '">' + sh.bsw.toFixed(2) + '%</b> · ' +
      'Contamination <b style="color:' + (sh.contam > 1.2 ? '#e8593a' : '#7bc043') + '">' + sh.contam.toFixed(2) + '%</b>' +
      (dirty ? ' <span style="color:#e8a13a">— this will fight you on the column</span>' : ' — clean enough to run') + '</div></div>' +
      '<button class="hp-btn sm" data-treat="' + sh.id + '">Desalt · 🔥' + fmt(cost) + '</button></div>';
  }
  h += '</div>';
  return h;
}

/* ═══ 2 · THE RUN ════════════════════════════════════════════════════════ */
function paneRun(s) {
  if (!run) {
    let h = '<div class="hp-card"><h3>🏭 Distillation <span class="r">' + (s.equip.cdu | 0) + ' column' + ((s.equip.cdu | 0) === 1 ? '' : 's') + '</span></h3>' +
      '<div class="hp-muted">Pick a barrel and take the column. The ideal temperature and pressure <b style="color:#e8a13a">drift</b> as the feed heats through and the heavy ends arrive — you are tracking a target, not holding a number.</div></div>';
    if (!s.crude.length) return h + '<div class="hp-card hp-muted">No crude in the tanks. Buy a shipment on the Intake tab.</div>';
    for (const sh of s.crude) {
      const env = envelope(sh.api, s.equip);
      h += '<div class="hp-offer"><div class="hd"><b>' + esc(sh.gradeName) + '</b>' +
        '<span class="hp-muted">' + fmt(sh.litres) + ' L · API ' + sh.api + '</span></div>' +
        '<div class="sub">Target ≈ <b style="color:#7bc043">' + Math.round(env.tempIdeal) + '°C</b> / <b style="color:#7bc043">' + env.presIdeal.toFixed(1) + ' bar</b> · safe flow up to <b>' + fmt(env.flowSafe) + ' L/min</b></div>' +
        '<div class="act"><button class="hp-btn pri sm" data-run="' + sh.id + '">Charge the column</button></div></div>';
    }
    return h;
  }

  const env = run.env;
  const sev = Sim.severity(run);
  const pct = Math.min(100, run.processed / run.shipment.litres * 100);
  const safety = Sim.safetyIndex(run);
  const kw = Sim.powerDraw(run);
  const cond = St.condition('cdu');
  const auto = (s.equip.automation | 0) > 0;

  const sevCol = sev > 1.32 ? '#e8593a' : sev > 1.08 ? '#e8a13a' : '#7bc043';

  return '<div class="hp-card' + (sev > 1.3 ? ' bad' : sev > 1.08 ? ' warn' : '') + '">' +
      '<h3>🏭 ' + esc(run.shipment.gradeName) + ' <span class="r" id="hp-run-pct">' + pct.toFixed(1) + '% through</span></h3>' +
      '<div class="hp-bar" style="margin-bottom:10px"><i id="hp-run-bar" style="width:' + pct + '%;background:linear-gradient(90deg,#8a5714,#f0c75e)"></i></div>' +
      gauge('temp', 'Temperature', run.temp, env.tempMin, env.tempMax, '°C', 0) +
      gauge('pres', 'Pressure', run.pres, env.presMin, env.presMax, ' bar', 2) +
      gauge('flow', 'Flow rate', run.flow, env.flowMin, env.flowMax, ' L/min', 0) +
      '<div class="hp-grid3" style="margin-top:10px">' +
        stat('Severity', sev.toFixed(2) + '×', sevCol, 'hp-sev') +
        stat('Safety', safety + '%', safety > 70 ? '#7bc043' : safety > 40 ? '#e8a13a' : '#e8593a', 'hp-safe') +
        stat('Cut quality', Math.round(run.quality * 100) + '%', run.quality > 0.9 ? '#7bc043' : run.quality > 0.75 ? '#e8a13a' : '#e8593a', 'hp-qual') +
        stat('Power', fmt(kw) + ' kW', '#7fb0ff', 'hp-kw') +
        stat('Condition', Math.round(cond) + '%', cond > 70 ? '#7bc043' : cond > 40 ? '#e8a13a' : '#e8593a', 'hp-cond') +
        stat('Incidents', String(run.incidents.length), run.incidents.length ? '#e8593a' : '#7bc043', 'hp-inc') +
      '</div>' +
      '<div class="hp-muted" style="margin-top:9px" id="hp-run-hint">' + runHint(run, sev) + '</div>' +
      '<div class="hp-row" style="margin-top:10px">' +
        (auto ? '<button class="hp-btn sm' + (run.auto ? ' ok' : '') + '" id="hp-auto">🤖 Autopilot: ' + (run.auto ? 'ON' : 'OFF') + '</button>' :
                '<span class="hp-muted">🤖 An Automation Suite would hold the setpoint while you look away.</span>') +
        '<div style="flex:1"></div>' +
        '<button class="hp-btn dgr sm" id="hp-abort">Shut down</button>' +
      '</div>' +
    '</div>' +
    '<div class="hp-card"><h3>Operating notes</h3><div class="hp-muted">' +
      'The green marker on each strip is where the column <i>wants</i> to be right now; the white marker is where you have it. ' +
      'Push past <b>1.00× severity</b> to run faster — wear and the chance of an incident climb on the <b>square</b> of the excess, so 1.4× is not twice as risky as 1.2×, it is about five times.' +
      (run.shipment.bsw > 1.2 ? ' <span style="color:#e8a13a">This barrel came in dirty — every incident roll is weighted against you until it is desalted.</span>' : '') +
    '</div></div>';
}

function gauge(key, name, val, lo, hi, unit, dp) {
  const p = ((val - lo) / (hi - lo)) * 100;
  return '<div class="hp-gauge" data-g="' + key + '">' +
    '<div class="hd"><span class="nm">' + name + '</span><span class="rd" data-g-read="' + key + '">' + val.toFixed(dp) + unit + '</span></div>' +
    '<div class="hp-band"><span class="tgt" data-g-tgt="' + key + '" style="left:0%"></span><span class="cur" data-g-cur="' + key + '" style="left:' + p + '%"></span></div>' +
    '<input type="range" data-g-in="' + key + '" min="' + lo + '" max="' + hi + '" step="' + (dp ? 0.01 : 1) + '" value="' + val + '">' +
  '</div>';
}
function stat(label, val, col, id) {
  return '<div class="hp-chip"><span class="lbl">' + label + '</span><span class="val" id="' + id + '" style="color:' + col + '">' + val + '</span></div>';
}
function runHint(r, sev) {
  const dT = r.temp - Sim.idealTemp(r), dP = r.pres - Sim.idealPres(r);
  const bits = [];
  if (Math.abs(dT) > r.env.tempBand) bits.push(dT > 0 ? 'running <b style="color:#e8593a">' + Math.round(dT) + '°C hot</b>' : 'running <b style="color:#7fb0ff">' + Math.round(-dT) + '°C cold</b>');
  if (Math.abs(dP) > r.env.presBand) bits.push(dP > 0 ? 'over pressure' : 'under pressure');
  if (r.flow > r.env.flowSafe * 1.02) bits.push('flow is <b style="color:#e8a13a">past what the pumps are rated for</b>');
  if (!bits.length) return '✅ Inside the envelope. Cuts are clean and nothing is wearing out faster than it should.';
  return '⚠ ' + bits.join(' · ') + '.';
}

/* Live gauge patching — see the note at the top of the file about why this is
   not a full repaint. */
function patchRun() {
  if (!el || tab !== 'run' || !run) return;
  const env = run.env;
  const set = (k, v, lo, hi, dp, unit) => {
    const rd = el.querySelector('[data-g-read="' + k + '"]');
    if (rd) rd.textContent = v.toFixed(dp) + unit;
    const cur = el.querySelector('[data-g-cur="' + k + '"]');
    if (cur) cur.style.left = (((v - lo) / (hi - lo)) * 100) + '%';
    const inp = el.querySelector('[data-g-in="' + k + '"]');
    /* Only write back to the slider when something OTHER than the player moved
       the value — autopilot, or an incident that forced the setpoint (a power
       trip drops the flow to a third). Writing during a manual drag fights the
       user's finger. */
    if (inp && (run.auto || run.flowChanged) && document.activeElement !== inp) inp.value = v;
  };
  set('temp', run.temp, env.tempMin, env.tempMax, 0, '°C');
  set('pres', run.pres, env.presMin, env.presMax, 2, ' bar');
  set('flow', run.flow, env.flowMin, env.flowMax, 0, ' L/min');
  const tgt = (k, v, lo, hi) => { const e = el.querySelector('[data-g-tgt="' + k + '"]'); if (e) e.style.left = (((v - lo) / (hi - lo)) * 100) + '%'; };
  tgt('temp', Sim.idealTemp(run), env.tempMin, env.tempMax);
  tgt('pres', Sim.idealPres(run), env.presMin, env.presMax);
  tgt('flow', env.flowSafe, env.flowMin, env.flowMax);

  const sev = Sim.severity(run), safety = Sim.safetyIndex(run);
  const put = (id, txt, col) => { const e = el.querySelector('#' + id); if (e) { e.textContent = txt; if (col) e.style.color = col; } };
  put('hp-sev', sev.toFixed(2) + '×', sev > 1.32 ? '#e8593a' : sev > 1.08 ? '#e8a13a' : '#7bc043');
  put('hp-safe', safety + '%', safety > 70 ? '#7bc043' : safety > 40 ? '#e8a13a' : '#e8593a');
  put('hp-qual', Math.round(run.quality * 100) + '%', run.quality > 0.9 ? '#7bc043' : run.quality > 0.75 ? '#e8a13a' : '#e8593a');
  put('hp-kw', fmt(Sim.powerDraw(run)) + ' kW');
  put('hp-cond', Math.round(St.condition('cdu')) + '%');
  put('hp-inc', String(run.incidents.length), run.incidents.length ? '#e8593a' : '#7bc043');
  const pct = Math.min(100, run.processed / run.shipment.litres * 100);
  const bar = el.querySelector('#hp-run-bar'); if (bar) bar.style.width = pct + '%';
  const pc = el.querySelector('#hp-run-pct'); if (pc) pc.textContent = pct.toFixed(1) + '% through';
  const hint = el.querySelector('#hp-run-hint'); if (hint) hint.innerHTML = runHint(run, sev);
  run.flowChanged = false;
}

function startRun(shipmentId) {
  const s = St.S();
  const sh = s.crude.find(c => c.id === shipmentId);
  if (!sh) return;
  run = Sim.startRun(sh);
  tab = 'run'; paint();
  clearInterval(runTimer);
  runTimer = setInterval(() => {
    if (!run) { clearInterval(runTimer); runTimer = 0; return; }
    Sim.tick(run, 0.25);
    patchRun();
    syncYard();
    if (run.done || run.aborted) finishRun();
  }, 250);
}

function finishRun() {
  clearInterval(runTimer); runTimer = 0;
  const r = run; run = null;
  const res = Sim.settleRun(r);
  if (res.aborted) flash('🔥 Batch lost — the column had to be shut in.');
  else {
    const got = Object.entries(res.out).filter(([, v]) => v > 1)
      .map(([k, v]) => (STREAMS[k] ? STREAMS[k].ico : '') + ' ' + fmt(v) + ' L ' + (STREAMS[k] ? STREAMS[k].name : k)).join(' · ');
    flash('Run complete — ' + Math.round(res.q * 100) + '% cut quality');
    St.toast('🏭 Column settled: ' + got, 6200);
    tab = 'stock';
  }
  paint();
}

/* ═══ 3 · THE BENCH ══════════════════════════════════════════════════════ */
function paneBlend(s) {
  const jobs = s.contracts;
  if (benchContract && !jobs.some(c => c.id === benchContract)) benchContract = null;
  if (!benchContract && jobs.length) benchContract = jobs[0].id;
  const job = jobs.find(c => c.id === benchContract) || null;

  let h = '';

  // ── The job selector + the board.
  h += '<div class="hp-card"><h3>📋 Contracts <span class="r">' + jobs.length + ' / ' + (s.equip.blendTank | 0) + ' tanks committed</span></h3>';
  if (!jobs.length) {
    h += '<div class="hp-muted">No contract in hand. Take one from the board below — the spec you accept is the target the bench works toward.</div>';
  } else {
    for (const c of jobs) {
      const g = GRADES[c.grade];
      const left = C.timeLeft(c);
      const mins = Math.floor(left / 60000), secs = Math.floor(left / 1000) % 60;
      const urgent = left < 180000;
      h += '<div class="hp-offer' + (c.own ? ' own' : '') + '" style="' + (c.id === benchContract ? 'border-color:#a9772a' : '') + '">' +
        '<div class="hd"><b>' + g.ico + ' ' + esc(g.name) + '</b><span class="hp-muted">' + fmt(c.litres) + ' L → ' + esc(c.station) + '</span>' +
        '<span class="pay hp-clock' + (urgent ? ' urgent' : '') + '" data-cd="' + c.id + '">' + (left > 0 ? mins + ':' + String(secs).padStart(2, '0') : 'OVERDUE') + '</span></div>' +
        '<div class="sub">Octane ≥ <b>' + g.octaneMin + '</b> · Sulfur ≤ <b>' + g.sulfurMax + ' ppm</b> · Purity ≥ <b>' + g.purityMin + '%</b> · Stability ≤ <b>' + g.rvpMax + ' psi</b><br>' +
        'Pays <b style="color:#f0c75e">🔥 ' + fmt(c.value) + '</b> · late penalty 🔥 ' + fmt(c.penalty) + (c.own ? ' · <b style="color:#7bc043">your own station — 55% in Cinder, and the fuel lands in your pumps</b>' : '') + '</div>' +
        '<div class="act">' +
          (c.id === benchContract ? '<span class="hp-muted" style="align-self:center;color:#e8a13a">◀ on the bench</span>'
                                  : '<button class="hp-btn sm" data-bench="' + c.id + '">Work this one</button>') +
          (c.batchId ? '<button class="hp-btn ok sm" data-goship="' + c.id + '">Batch ready → Ship</button>' : '') +
          '<button class="hp-btn dgr sm" data-drop="' + c.id + '">Abandon</button>' +
        '</div></div>';
    }
  }
  h += '<div class="hp-row" style="margin-top:8px"><span class="hp-muted">Contracts are signed at the <b style="color:#e8a13a">terminal in the office</b> \u2014 walk over and press E.</span></div></div>';



  // ── The bench itself.
  const target = job ? GRADES[job.grade] : GRADES.regular;
  const assay = B.assayBench(bench);
  const vol = assay.volume;
  const t = St.lab();
  const reading = t.live ? assay : (lastTest || null);
  const chk = reading ? specCheck(reading, target) : null;

  h += '<div class="hp-card"><h3>⚗️ Blending Bench <span class="r">target: ' + target.ico + ' ' + esc(target.name) + '</span></h3>';

  /* ⚠ THE SLIDER RANGE IS REACH, NOT STOCK — what you hold PLUS what you can
     afford to buy. Capping at stock disabled ethanol and butane outright
     (nobody keeps additives in a tank), which removed the exact lever this
     stage is about. Litres past your stock are drawn in a different colour and
     priced live in the money block below. */
  for (const c of B.availableComponents()) {
    const max = Math.floor(c.reach);
    const cur = Math.round(bench[c.id] || 0);
    const capNote = c.cap ? ' · max ' + Math.round(c.cap * 100) + '% of blend' : '';
    const over = Math.max(0, cur - c.have);
    const sCol = c.sulfur > 400 ? '#e8593a' : c.sulfur > 120 ? '#e8a13a' : '#7bc043';
    /* Two rows, not three columns. The old grid put the name, every stat and
       the price into a 128px column, which wrapped a one-line label into five
       and left the separators dangling at the ends of lines. The slider now
       gets the full width it needs to be draggable, and the stats get a line
       they fit on. */
    h += '<div class="hp-comp' + (c.buyable || c.unlocked ? '' : ' locked') + '">' +
      '<div class="hd">' +
        '<b>' + c.ico + ' ' + esc(c.name) + '</b>' +
        (c.buyable
          ? '<span class="meta">' + c.ron + ' RON · <b style="color:' + sCol + '">' + Math.round(c.sulfur) + ' ppm S</b>' +
            (c.cap ? ' · max ' + Math.round(c.cap * 100) + '%' : '') + '</span>' +
            '<span class="px">' + fmt(c.have) + ' L held · 🔥' + c.spot.toFixed(2) + '/L' +
            (c.merchant ? ' <b style="color:#e8593a">MERCHANT</b>' : '') + '</span>'
          : '<span class="meta lock">🔒 ' + (c.lockedBy ? esc(c.lockedBy) + ' — ' : '') +
            esc(B.GATE_REASON[c.id] || 'cannot be bought in') + '</span>') +
      '</div>' +
      '<div class="sl">' +
        '<input type="range" data-mix="' + c.id + '" data-have="' + Math.floor(c.have) + '" min="0" max="' + Math.max(100, max) + '" step="50" value="' + cur + '"' + (max < 50 ? ' disabled' : '') + '>' +
        '<div class="qt"><span data-mixq="' + c.id + '">' + fmt(cur) + '</span>' +
          '<span class="hp-err" data-mixbuy="' + c.id + '">' + (over > 0 ? '+' + fmt(over) + ' buy' : '') + '</span></div>' +
      '</div>' +
    '</div>';
  }

  // ── The spec card.
  h += '<div style="margin-top:12px;padding-top:10px;border-top:1px solid #2c3036">';
  if (!reading) {
    h += '<div class="hp-muted">Your <b>' + esc(t.name) + '</b> cannot read a tank continuously. Blend the mix, then <b>run a test</b> to find out what you made.</div>';
  } else {
    const near = (v, need, inv, span) => inv ? (v <= need ? 'pass' : v <= need * 1.08 ? 'near' : 'fail')
                                             : (v >= need ? 'pass' : v >= need - span ? 'near' : 'fail');
    const rows = [
      ['Octane', reading.octane.toFixed(1), near(reading.octane, target.octaneMin, false, 1.5), target.octaneMin > 0],
      ['Sulfur', Math.round(reading.sulfur) + ' ppm', near(reading.sulfur, target.sulfurMax, true), true],
      ['Purity', reading.purity.toFixed(1) + '%', near(reading.purity, target.purityMin, false, 0.8), true],
      ['Stability', reading.rvp.toFixed(1) + ' psi', near(reading.rvp, target.rvpMax, true), target.rvpMax < 90],
    ];
    h += '<div class="hp-spec">';
    for (const [k, v, cls, show] of rows) {
      if (!show) continue;
      h += '<span class="k">' + k + '</span><span class="v ' + cls + '">' + v + '</span>' +
           '<span class="s ' + cls + '">' + (cls === 'pass' ? '✓' : cls === 'near' ? '~' : '✗') + '</span>';
    }
    h += '</div>';
    if (!t.live || t.err > 0) h += '<div class="hp-err" style="margin-top:5px">' + (t.err > 0 ? '± ' + t.err.toFixed(2) + ' measurement error — a number this close to the limit may not be the number you have.' : '') + '</div>';
  }

  const value = job ? job.value : Math.round(vol * target.pricePerL * s.marketIndex);
  const short = B.spotShortfall(bench);
  const margin = value - assay.cost;
  /* Cost basis and cash out of pocket are DIFFERENT numbers and the player
     needs both: the basis is what the blend is worth (litres you already paid
     for upstream), the spend is what committing it takes out of the wallet
     right now. Showing only one of them makes either the margin or the
     affordability a lie. */
  h += '<div style="margin-top:10px">' +
    '<div class="hp-money"><span>Volume in tank</span><b class="' + (job && vol >= job.litres ? 'hp-pos' : 'hp-amber') + '">' + fmt(vol) + ' L' + (job ? ' / ' + fmt(job.litres) + ' L' : '') + '</b></div>' +
    '<div class="hp-money"><span>Blend cost basis</span><b>🔥 ' + fmt(assay.cost) + '</b></div>' +
    (short.cost > 0 ? '<div class="hp-money"><span>Spot purchases on commit</span><b class="hp-neg">🔥 ' + fmt(short.cost) + '</b></div>' : '') +
    '<div class="hp-money"><span>Contract pays</span><b class="hp-amber">🔥 ' + fmt(value) + '</b></div>' +
    '<div class="hp-money tot"><span>Gross margin</span><b class="' + (margin > 0 ? 'hp-pos' : 'hp-neg') + '">🔥 ' + fmt(margin) + '</b></div>' +
  '</div>';

  h += '<div class="hp-row" style="margin-top:11px;flex-wrap:wrap">' +
    (t.live ? '' : '<button class="hp-btn sm" id="hp-test">🔬 Run test · 🔥' + fmt(t.fee) + '</button>') +
    '<button class="hp-btn sm" id="hp-clear">Empty bench</button>' +
    '<div style="flex:1"></div>' +
    '<button class="hp-btn pri" id="hp-commit"' + (vol < 100 ? ' disabled' : '') + '>Blend batch #' + ((s.batchSeq | 0) + 1) + '</button>' +
  '</div></div>';

  // ── Batches waiting on a decision. THE four exits.
  for (const b of s.batches) {
    const job2 = s.contracts.find(c => c.batchId === b.id);
    const gid = job2 ? job2.grade : 'regular';
    const v = B.verdict(b, gid);
    const fix = v.pass ? null : B.suggestFix(b, gid);
    h += '<div class="hp-card ' + (v.pass ? 'good' : 'bad') + '"><h3>' + (v.pass ? '✅' : '❌') + ' Batch #' + b.n +
      ' <span class="r">' + fmt(b.litres) + ' L' + (job2 ? ' · for ' + esc(job2.station) : ' · unassigned') + '</span></h3>' +
      '<div class="hp-spec">' +
      Object.entries(v.check).map(([k, x]) => {
        if (k === 'octane' && v.grade.octaneMin === 0) return '';
        if (k === 'stability' && v.grade.rvpMax > 90) return '';
        return '<span class="k">' + x.label + '</span><span class="v ' + (x.ok ? 'pass' : 'fail') + '">' + x.fmt(x.have) +
               '</span><span class="s ' + (x.ok ? 'pass' : 'fail') + '">' + (x.ok ? '✓' : '✗') + '</span>';
      }).join('') + '</div>';

    if (v.pass) {
      h += '<div class="hp-muted" style="margin-top:8px">On spec for <b style="color:#7bc043">' + esc(v.grade.name) + '</b>. Approve it and get it on a truck.</div>' +
        '<div class="hp-row" style="margin-top:8px">' +
        (job2 ? '<button class="hp-btn ok" data-approve="' + b.id + '">Approve for ' + esc(job2.station) + '</button>' : '') +
        '<button class="hp-btn sm" data-down="' + b.id + '">Sell on the spot market</button></div>';
    } else {
      h += '<div class="hp-muted" style="margin-top:8px">Off spec for ' + esc(v.grade.name) + '.' +
        (v.alternative ? ' It <b style="color:#e8a13a">would</b> pass as ' + esc(v.alternative.name) + '.' : ' It will not pass as anything — this is slop.') + '</div>';
      if (fix) {
        h += '<div class="hp-card' + (fix.reachable === false ? ' warn' : '') + '" style="margin:8px 0 0;background:#101216">' +
          (fix.text ? '<div class="hp-muted">💡 ' + fix.text + '</div>'
                    : '<div class="hp-muted">💡 <b style="color:#e8a13a">' + fmt(fix.litres) + ' L of ' + fix.ico + ' ' + esc(fix.name) + '</b> would land it — ' +
                      (fix.cost > 0 ? fmt(fix.cost) + ' 🔥 on the spot market' : 'all of it out of your own tanks, free') + '.</div>' +
                      '<div class="hp-row" style="margin-top:7px"><button class="hp-btn pri sm" data-fix="' + b.id + '" data-fixc="' + fix.id + '" data-fixl="' + fix.litres + '">Correct the batch</button></div>') +
        '</div>';
      }
      h += '<div class="hp-row" style="margin-top:8px;flex-wrap:wrap;gap:6px">' +
        (v.alternative ? '<button class="hp-btn sm" data-down="' + b.id + '">↘ Sell down as ' + esc(v.alternative.name) + '</button>' : '') +
        '<button class="hp-btn sm" data-repro="' + b.id + '">🥣 Reprocess</button>' +
        '<button class="hp-btn dgr sm" data-scrap="' + b.id + '">🗑 Dump</button>' +
      '</div>';
    }
    h += '</div>';
  }
  return h;
}

let touchMode = false;
let modal = null;              // the one overlay-within-the-overlay

/* ── THE WALKING HUD ─────────────────────────────────────────────────────
   Overview toggle, and a thumbstick that only appears on a touch device. The
   stick is pointer-events based rather than touch-events, so it works with a
   stylus and a trackpad too. */
function bindYardHud() {
  const view = el.querySelector('#hp-view');
  if (view) view.onclick = () => {
    const on = !Yard.isOverview();
    Yard.setOverview(on);
    view.textContent = on ? '🚶 Walk the yard' : '🔭 Overview';
    const pr = el.querySelector('#hp-prompt'); if (pr && on) pr.hidden = true;
  };

  touchMode = matchMedia('(pointer: coarse)').matches
              && !matchMedia('(pointer: fine)').matches
              && (navigator.maxTouchPoints || 0) > 0;
  const stick = el.querySelector('#hp-stick');
  const eb = el.querySelector('#hp-ebtn');
  if (!touchMode || !stick) return;
  stick.hidden = false;
  if (eb) { eb.hidden = false; eb.onclick = () => { const p = Yard.getPlayer(); if (p) Walk.interact(p); }; }

  /* A device that turns out to have a keyboard does not need a thumbstick over
     its yard. Some desktop browsers and every headless one report a coarse
     pointer, so the media query alone is not enough — the first real keypress
     settles it. */
  const hideOnKey = (e) => {
    if (e.key && e.key.length && !e.metaKey && !e.ctrlKey) {
      stick.hidden = true;
      const b = el && el.querySelector('#hp-ebtn'); if (b) b.hidden = true;
      touchMode = false;
      window.removeEventListener('keydown', hideOnKey);
    }
  };
  window.addEventListener('keydown', hideOnKey);

  const knob = stick.querySelector('i');
  let id = null, cx = 0, cy = 0;
  const R = 46;
  stick.addEventListener('pointerdown', e => {
    id = e.pointerId; stick.setPointerCapture(id);
    const r = stick.getBoundingClientRect();
    cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    e.preventDefault();
  });
  stick.addEventListener('pointermove', e => {
    if (e.pointerId !== id) return;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, d / R);
    dx = dx / d * k; dy = dy / d * k;
    knob.style.transform = 'translate(' + (dx * R) + 'px,' + (dy * R) + 'px)';
    const p = Yard.getPlayer();
    if (p) { Walk.setStick(p, dx, dy); Walk.setRunning(p, k > 0.86); }
  });
  const end = e => {
    if (id !== null && e.pointerId !== id) return;
    id = null; knob.style.transform = '';
    const p = Yard.getPlayer();
    if (p) { Walk.setStick(p, 0, 0); Walk.setRunning(p, false); }
  };
  stick.addEventListener('pointerup', end);
  stick.addEventListener('pointercancel', end);
}

/* ── MODALS ──────────────────────────────────────────────────────────────
   One at a time, over the whole overlay, and always closable. Movement is
   suspended while one is open or the operator wanders off while you read. */
function openModal(html, onWire) {
  closeModal();
  const p = Yard.getPlayer(); if (p) p.enabled = false;
  modal = document.createElement('div');
  modal.className = 'hp-modal';
  modal.innerHTML = '<div class="hp-modal-box">' + html + '</div>';
  el.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  modal.querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
  if (onWire) onWire(modal);
  return modal;
}
function closeModal() {
  if (modal) { try { modal.remove(); } catch (e) {} modal = null; }
  const p = Yard.getPlayer();
  if (p && !Yard.isOverview()) p.enabled = true;
  // Hand focus back to the yard, or the operator is unresponsive after every
  // modal because the keyboard is still pointed at a button that no longer
  // exists.
  try { const c = el && el.querySelector('#hp-yard-canvas canvas'); if (c) c.focus({ preventScroll: true }); } catch (e) {}
}

function paneBoard(s) {
  let h = '<div class="hp-card"><h3>📄 Contract Board <span class="r">market ×' + (s.marketIndex || 1).toFixed(2) + '</span></h3>' +
    '<div class="hp-muted">Stations bid on what their traffic actually burns. A district full of freight wants diesel; a performance trade wants premium. Your wholesale reputation of <b style="color:#9fe6e6">' + St.repWholesale() + '</b> is worth roughly ' +
    (St.repWholesale() > 50 ? '+' : '') + Math.round(((0.88 + St.repWholesale() / 100 * 0.28) - 1) * 100) + '% on every price here.</div>';
  for (const o of s.offers) {
    const g = GRADES[o.grade];
    h += '<div class="hp-offer' + (o.rush ? ' rush' : '') + (o.own ? ' own' : '') + '">' +
      '<div class="hd"><b>' + g.ico + ' ' + esc(g.name) + '</b><span class="hp-muted">' + fmt(o.litres) + ' L</span>' +
      '<span class="pay">🔥 ' + fmt(o.value) + '</span></div>' +
      '<div class="sub">' + esc(o.station) + ' · ' + esc(o.place) + ' · ' + o.km + ' km · ' + esc(o.fleetIco) + ' ' + esc(o.fleet) + '<br>' +
      'Octane ≥ ' + g.octaneMin + ' · Sulfur ≤ ' + g.sulfurMax + ' ppm · Purity ≥ ' + g.purityMin + '% · ' +
      '<b class="hp-clock">' + o.minutes + ' min</b> · penalty 🔥' + fmt(o.penalty) +
      (o.rush ? ' · <b style="color:#e8a13a">⚡ RUSH</b>' : '') +
      (o.own ? ' · <b style="color:#7bc043">your station — 55% cash, the rest lands in your pumps</b>' : '') + '</div>' +
      '<div class="act"><button class="hp-btn pri sm" data-take="' + o.id + '">Accept</button></div></div>';
  }
  h += '<div class="hp-row"><button class="hp-btn sm" id="hp-reoffer">↻ Put the word out for new offers</button></div></div>';
  return h;
}

/* ── THE OFFICE TERMINAL ─────────────────────────────────────────────────
   The same board, opened by walking to the desk and pressing E. That is the
   point of moving it off a tab: a contract is something you go and sign for,
   and the office becomes somewhere you have a reason to be. */
function openContracts() {
  openModal(
    '<div class="hp-modal-hd"><b>🖥 Contract Terminal</b>' +
      '<span class="hp-muted">Hidn Petro · head office</span>' +
      '<button class="hp-btn sm" data-close>✕ Close</button></div>' +
    '<div class="hp-modal-body" id="hp-modal-body">' + paneBoard(St.S()) + '</div>',
    wireBoard);
}
function wireBoard(m) {
  const redraw = () => {
    const body = m.querySelector('#hp-modal-body');
    if (body) { body.innerHTML = paneBoard(St.S()); wireBoard(m); }
  };
  m.querySelectorAll('[data-take]').forEach(b => b.onclick = () => {
    if (C.accept(b.dataset.take)) { flash('Contract signed — the spec is on the bench'); redraw(); paint(); }
  });
  const re = m.querySelector('#hp-reoffer');
  if (re) re.onclick = () => { C.rollOffers(5); redraw(); };
}

/* ═══ 4 · SHIPPING ═══════════════════════════════════════════════════════ */
function paneShip(s) {
  let h = '<div class="hp-card"><h3>🚛 Dispatch <span class="r">' + C.freeTrucks() + ' / ' + (s.equip.truck | 0) + ' trucks free · ' + (s.equip.bay | 0) + ' bay' + ((s.equip.bay | 0) === 1 ? '' : 's') + '</span></h3>' +
    '<div class="hp-muted">A tanker carries ' + fmt(St.TRUCK_L) + ' L. Bays limit how many can load at once; trucks limit how many can be out at once. Priority buys time, not capacity.</div></div>';

  const ready = s.batches.filter(b => b.approved);
  if (!ready.length) h += '<div class="hp-card hp-muted">Nothing approved for shipping. Approve a batch on the Blend tab.</div>';
  for (const b of ready) {
    const job = s.contracts.find(c => c.batchId === b.id);
    if (!job) continue;
    const loads = Math.ceil(b.litres / St.TRUCK_L);
    const base = C.haulCost(b.litres, job.km);
    h += '<div class="hp-offer"><div class="hd"><b>Batch #' + b.n + '</b>' +
      '<span class="hp-muted">' + fmt(b.litres) + ' L → ' + esc(job.station) + ' · ' + job.km + ' km · ' + loads + ' load' + (loads === 1 ? '' : 's') + '</span></div>' +
      '<div class="sub">Haulage: standard 🔥' + fmt(base) + ' · express 🔥' + fmt(base * 1.4) + ' (half the time) · convoy 🔥' + fmt(base * 1.85) + ' (guarded)</div>' +
      '<div class="act">' +
        '<button class="hp-btn sm" data-ship="' + b.id + '" data-pri="standard">Standard</button>' +
        '<button class="hp-btn pri sm" data-ship="' + b.id + '" data-pri="express">Express</button>' +
        '<button class="hp-btn sm" data-ship="' + b.id + '" data-pri="convoy">Convoy</button>' +
      '</div></div>';
  }

  if (s.convoy.length) {
    h += '<div class="hp-card"><h3>🛣 On the road</h3>';
    for (const t of s.convoy) {
      const p = C.convoyProgress(t) * 100;
      h += '<div style="margin-bottom:9px"><div class="hp-barlbl"><span>' + esc(t.dest) + ' · ' + fmt(t.litres) + ' L · ' + esc(t.priority) + '</span><b data-convoypct>' + Math.round(p) + '%</b></div>' +
        '<div class="hp-bar" data-convoy="' + t.id + '"><i style="width:' + p + '%;background:linear-gradient(90deg,#2f7346,#7bc043)"></i></div></div>';
    }
    h += '</div>';
  }
  return h;
}

/* ═══ 5 · STOCK & UNITS ══════════════════════════════════════════════════ */
function paneStock(s) {
  let h = '<div class="hp-card"><h3>📦 Tank Farm <span class="r">' + fmt(St.storeHeld(s)) + ' / ' + fmt(St.storeCap(s)) + ' L</span></h3>';
  const all = Object.keys(STREAMS).concat(Object.keys(COMPONENTS)).filter((v, i, a) => a.indexOf(v) === i);
  let any = false;
  for (const id of all) {
    const v = St.stock(id);
    if (v < 1) continue;
    any = true;
    const meta = COMPONENTS[id] || STREAMS[id];
    const cap = Math.max(1, St.storeCap(s));
    /* The straight-run streams carry the barrel's sulfur and dirt with them.
       Without this line the only place a player learns their naphtha is sour
       is a finished batch that nothing can rescue. */
    let note = '';
    if (id === 'naphtha' || id === 'diesel' || id === 'kero') {
      const q = Sim.streamQuality(id === 'naphtha' ? 'naphtha' : id);
      const ppm = Math.round(q.sulfur * 10000 * (id === 'diesel' ? 0.074 : id === 'kero' ? 0.04 : 0.055));
      note = ' <span style="color:' + (ppm > 400 ? '#e8593a' : ppm > 120 ? '#e8a13a' : '#7bc043') + '">· ' + ppm + ' ppm S</span>' +
             (ppm > 400 ? ' <span style="color:#8d959e">(hydrotreat before blending)</span>' : '');
    }
    /* Everything in the farm is SELLABLE — components at the spot haircut,
       the non-gasoline cuts at the rack. Nearly half of every barrel comes off
       as diesel, kerosene and residue; without a sell button here that half is
       dead weight the player paid for and can never realise. */
    const unit = B.sellUnitPrice(id);
    h += '<div style="margin-bottom:9px"><div class="hp-barlbl"><span>' + (meta.ico || '') + ' ' + esc(meta.name) + note + '</span><b>' + fmt(v) + ' L</b></div>' +
      '<div class="hp-bar"><i style="width:' + Math.min(100, v / cap * 100) + '%;background:' + (meta.color || '#8d959e') + '"></i></div>' +
      (unit > 0 ? '<div class="hp-row" style="margin-top:4px;gap:5px"><span class="hp-err" style="flex:1">' +
        (COMPONENTS[id] ? 'spot' : 'rack') + ' 🔥' + unit.toFixed(2) + '/L · whole tank 🔥' + fmt(unit * v) + '</span>' +
        '<button class="hp-btn sm" data-sellstream="' + id + '" data-selln="2000"' + (v < 2000 ? ' disabled' : '') + '>Sell 2,000</button>' +
        '<button class="hp-btn sm" data-sellstream="' + id + '" data-selln="all">Sell all</button></div>' : '') +
    '</div>';
  }
  if (!any) h += '<div class="hp-muted">Every tank is empty. Charge the column with a barrel.</div>';
  else h += '<div class="hp-muted" style="margin-top:6px">Rack prices are what an untreated cut fetches straight out of the tank. Blending into a contract grade is worth two to four times as much — that is the entire reason the bench exists.</div>';
  h += '</div>';

  h += '<div class="hp-card"><h3>⚙️ Secondary Units</h3><div class="hp-muted">These do not make you richer. They make streams you could not otherwise have — which is the only reason Premium and Jet exist for you at all.</div>';
  for (const cv of CONVERSION_LIST) {
    const owned = !cv.unit || (s.equip[cv.unit] | 0) > 0;
    const feed = St.stock(cv.in);
    const inName = (COMPONENTS[cv.in] || STREAMS[cv.in] || { name: cv.in }).name;
    const outName = (COMPONENTS[cv.out] || STREAMS[cv.out] || { name: cv.out }).name;
    h += '<div class="hp-offer" style="' + (owned ? '' : 'opacity:.5') + '">' +
      '<div class="hd"><b>' + cv.ico + ' ' + esc(cv.name) + '</b><span class="hp-muted">' + esc(inName) + ' → ' + esc(outName) + ' @ ' + Math.round(cv.yield * 100) + '%</span></div>' +
      '<div class="sub">' + esc(cv.blurb) + '<br>Feed available: <b>' + fmt(feed) + ' L</b> · power ' + cv.kwh + ' kWh / 1,000 L</div>' +
      (owned ? '<div class="act">' +
        '<button class="hp-btn sm" data-conv="' + cv.id + '" data-cvl="2000"' + (feed < 2000 ? ' disabled' : '') + '>Run 2,000 L</button>' +
        '<button class="hp-btn pri sm" data-conv="' + cv.id + '" data-cvl="all"' + (feed < 100 ? ' disabled' : '') + '>Run all ' + fmt(feed) + ' L</button></div>'
      : '<div class="sub" style="color:#c2452d;margin-top:5px">Locked — build the ' + esc(EQUIPMENT[cv.unit] ? EQUIPMENT[cv.unit].name : cv.unit) + ' on the Yard tab.</div>') +
    '</div>';
  }
  h += '</div>';

  h += '<div class="hp-card"><h3>💱 Spot Market <span class="r">×' + (s.marketIndex || 1).toFixed(2) + '</span></h3>' +
    '<div class="hp-muted">Buy a stream you are short of, at a markup, or sell one you are long on, at a haircut. Never free money — always an option.</div>';
  for (const c of B.availableComponents()) {
    const canBuy = c.buyable;
    h += '<div class="hp-comp"><div class="hd"><b>' + c.ico + ' ' + esc(c.name) + '</b>' +
        '<span class="px">' + fmt(c.have) + ' L held · 🔥' + c.spot.toFixed(2) + '/L' + (c.merchant ? ' <b style="color:#e8593a">MERCHANT</b>' : '') + '</span></div>' +
      '<div class="hp-row" style="gap:5px;margin-top:5px">' +
        (canBuy ? '<button class="hp-btn sm" data-spotbuy="' + c.id + '">Buy 1,000 L</button>' : '<span class="hp-err">🔒 needs ' + esc(c.lockedBy) + '</span>') +
        (c.have >= 500 ? '<button class="hp-btn sm" data-spotsell="' + c.id + '">Sell 500 L</button>' : '') +
      '</div></div>';
  }
  h += '</div>';
  return h;
}

/* ═══ 6 · THE YARD (equipment) ═══════════════════════════════════════════ */
function paneYard(s) {
  let h = '<div class="hp-card"><h3>🏗 Build the Yard</h3><div class="hp-muted">Nothing here is a percentage. Every purchase either unlocks a stream, widens the envelope you can safely operate in, or adds a slot that lets you run something in parallel. What you own is what stands in the yard.</div></div>';
  const cats = [['process', '⚙️ Process Units'], ['storage', '🛢 Storage'], ['logistics', '🚛 Logistics']];
  for (const [cat, label] of cats) {
    h += '<div class="hp-card"><h3>' + label + '</h3>';
    for (const e of EQUIP_LIST.filter(x => x.cat === cat)) {
      const owned = St.count(e.id), maxed = owned >= e.max;
      const cond = St.condition(e.id);
      const rep = St.repairCost(e.id);
      /* ⚠ THE SAME BILL OF MATERIALS THE BUILD PLOT USES. This list used to
         charge Cinder alone, at the undiscounted equipment price — so the yard
         had two different prices for the same unit depending on whether you
         bought it from a menu or walked to the plot. Everything goes through
         build.js now, and this panel is the reference sheet for it. */
      const c = Build.BOM[e.id] ? Build.costFor(e.id) : null;
      const ready = Build.BOM[e.id] ? Build.canBuild(e.id) : (St.cinder() >= St.nextCost(e.id));
      const bits = c ? [ '🔥 ' + fmt(c.cinder) ]
          .concat(Object.keys(c.res).map(r => (Build.MATERIALS[r] ? Build.MATERIALS[r].icon : '•') + ' ' + fmt(c.res[r])))
          .concat(Object.keys(c.yard).map(y => ((STREAMS[y] || COMPONENTS[y] || {}).ico || '•') + ' ' + fmt(c.yard[y]) + ' L'))
        : ['🔥 ' + fmt(St.nextCost(e.id))];
      h += '<div class="hp-offer"><div class="hd"><b>' + e.ico + ' ' + esc(e.name) + '</b>' +
        '<span class="hp-muted">' + owned + ' / ' + e.max + '</span>' +
        (maxed ? '<span class="pay" style="color:#7bc043">MAX</span>' : '') + '</div>' +
        '<div class="sub">' + esc(e.desc) + '</div>' +
        (maxed ? '' : '<div class="sub" style="margin-top:5px">Needs ' + bits.join(' · ') + '</div>') +
        (owned > 0 ? '<div style="margin-top:6px"><div class="hp-barlbl"><span>Condition</span><b style="color:' + (cond > 70 ? '#7bc043' : cond > 40 ? '#e8a13a' : '#e8593a') + '">' + Math.round(cond) + '%</b></div>' +
          '<div class="hp-bar"><i style="width:' + cond + '%;background:' + (cond > 70 ? '#7bc043' : cond > 40 ? '#e8a13a' : '#e8593a') + '"></i></div></div>' : '') +
        '<div class="act">' +
          (maxed ? '' : '<button class="hp-btn pri sm" data-plan="' + e.id + '">' + (ready ? '🏗 Commission' : 'See what it needs') + '</button>') +
          (rep > 0 ? '<button class="hp-btn sm" data-fixup="' + e.id + '">🔧 Overhaul · 🔥' + fmt(rep) + '</button>' : '') +
        '</div></div>';
    }
    h += '</div>';
  }

  h += '<div class="hp-card"><h3>🔬 Laboratory</h3><div class="hp-muted">The lab does not change your fuel. It changes how much of it you are allowed to see — and at the bottom of the ladder you pay per test and get one property at a time.</div>';
  const cur = St.count('lab');
  for (const t of LAB_TIERS) {
    h += '<div class="hp-comp' + (t.t > cur ? ' locked' : '') + '"><div class="nm"><b>' + (t.t === cur ? '▶ ' : '') + esc(t.name) + '</b>' +
      '<span>±' + t.err.toFixed(2) + ' error · ' + t.props + ' propert' + (t.props === 1 ? 'y' : 'ies') + ' · ' + (t.fee ? '🔥' + fmt(t.fee) + '/test' : 'free tests') + ' · ' + (t.live ? 'live readout' : 'test to see') + '</span></div>' +
      '<div></div><div class="qt">' + (t.t <= cur ? '✓' : '') + '</div></div>';
  }
  h += '</div>';
  h += paneAdmin();
  return h;
}

/* ═══ 7 · LEDGER ═════════════════════════════════════════════════════════ */
function paneLedger(s) {
  const p = s.pnl, net = St.pnlNet(p);
  let h = '<div class="hp-card"><h3>📊 Session Statement</h3>';
  for (const [k, label, sign] of St.PNL_ROWS) {
    const v = p[k] | 0;
    if (!v && k !== 'revenue') continue;
    h += '<div class="hp-money"><span>' + label + '</span><b class="' + (sign === '+' ? 'hp-pos' : 'hp-neg') + '">' + sign + '🔥 ' + fmt(v) + '</b></div>';
  }
  h += '<div class="hp-money tot"><span>Net this session</span><b class="' + (net >= 0 ? 'hp-pos' : 'hp-neg') + '">🔥 ' + fmt(net) + '</b></div></div>';

  const stars = St.repStars();
  h += '<div class="hp-card"><h3>🏅 Hidn Petro</h3><div class="hp-rep">' +
    '<span>Fuel Quality</span><span class="v" style="color:#f0c75e">' + '★'.repeat(stars) + '☆'.repeat(5 - stars) + '</span>' +
    '<span>Delivery Reliability</span><span class="v">' + Math.round(s.rep.delivery) + '%</span>' +
    '<span>Safety Rating</span><span class="v" style="color:' + (s.rep.safety > 70 ? '#7bc043' : s.rep.safety > 45 ? '#e8a13a' : '#e8593a') + '">' + St.repSafetyLetter() + '</span>' +
    '<span>Contract Completion</span><span class="v">' + Math.round(s.rep.completion) + '%</span>' +
    '<span>Wholesale Reputation</span><span class="v" style="color:#9fe6e6">' + St.repWholesale() + '/100</span>' +
  '</div><div class="hp-muted" style="margin-top:9px">Reputation is slow to earn and fast to lose. Stations read the wholesale figure, and it is what moves every price on the board.</div></div>';

  h += '<div class="hp-card"><h3>📈 Lifetime</h3><div class="hp-rep">' +
    '<span>Fuel delivered</span><span class="v">' + fmt(s.lifetimeL) + ' L</span>' +
    '<span>Revenue booked</span><span class="v hp-amber">🔥 ' + fmt(s.lifetimeRevenue) + '</span>' +
    '<span>Batches blended</span><span class="v">' + Math.max(0, (s.batchSeq | 0) - 471) + '</span>' +
  '</div></div>';

  h += '<div class="hp-card"><h3>📻 Yard Log</h3><div class="hp-log">' +
    (s.log.length ? s.log.slice(0, 40).map(l => '<div class="' + esc(l.level) + '">' + esc(l.msg) + '</div>').join('')
                  : '<div class="info">Nothing logged yet.</div>') + '</div></div>';
  return h;
}


/* ═══ THE BUILD PLOT ══════════════════════════════════════════════════════
   Walk onto a marked plot, press E, and see the bill of materials for the
   thing that goes there. Every line says what you have against what it needs,
   so "cannot afford" is never the whole answer — you can see it is the stone
   you are short of, and by how much.
   ⚠ Costs come from build.js and are drawn from the LIVE fourteen resources
   plus the yard's own streams. See the note at the top of that file for why
   the other 245 catalogued ids are deliberately not spendable. */
function openBuild(id) {
  const e = EQUIPMENT[id];
  if (!e) return;
  openModal(buildHtml(id), (m) => wireBuild(m, id));
}
function buildHtml(id) {
  const e = EQUIPMENT[id];
  const owned = St.count(id);
  const c = Build.costFor(id);
  const miss = Build.shortfall(id);
  const missOf = {};
  miss.forEach(x => { missOf[x.id] = x; });
  const ok = miss.length === 0;

  const line = (icon, name, need, have, unit) => {
    const short = have < need;
    return '<div class="hp-bom' + (short ? ' short' : '') + '">' +
      '<span class="ic">' + icon + '</span>' +
      '<span class="nm">' + esc(name) + '</span>' +
      '<span class="qt">' + fmt(need) + (unit || '') + '</span>' +
      '<span class="hv">' + (short ? 'have ' + fmt(have) : '✓') + '</span></div>';
  };

  let rows = line('🔥', 'Cinder (labour & contractors)', c.cinder, St.cinder(), '');
  for (const r in c.res) {
    const M = Build.MATERIALS[r] || { name: r, icon: '•', use: '' };
    rows += line(M.icon, M.name + (M.use ? ' — ' + M.use : ''), c.res[r], St.getRes(r), '');
  }
  for (const y in c.yard) {
    const meta = STREAMS[y] || COMPONENTS[y] || { name: y, ico: '•' };
    rows += line(meta.ico || '•', meta.name + ' — from your own tanks', c.yard[y], Math.floor(St.stock(y)), ' L');
  }

  return '<div class="hp-modal-hd"><b>' + e.ico + ' Build ' + esc(e.name) + ' #' + (owned + 1) + '</b>' +
      '<span class="hp-muted">' + owned + ' of ' + e.max + ' built</span>' +
      '<button class="hp-btn sm" data-close>✕ Close</button></div>' +
    '<div class="hp-modal-body">' +
      '<div class="hp-card"><div class="hp-muted">' + esc(e.desc) + '</div></div>' +
      '<div class="hp-card"><h3>📋 Bill of Materials</h3>' + rows +
        (ok ? '<div class="hp-muted" style="margin-top:10px;color:#7bc043">Everything is on site. The crew can start today.</div>'
            : '<div class="hp-muted" style="margin-top:10px;color:#e8a13a">Short on ' +
              miss.map(x => esc(x.name)).join(', ') + '. Materials come from your camp stores; the litres come off your own run.</div>') +
      '</div>' +
      '<div class="hp-row"><button class="hp-btn pri" id="hp-do-build"' + (ok ? '' : ' disabled') + '>🏗 Commission it</button>' +
        '<button class="hp-btn sm" data-close>Not yet</button></div>' +
    '</div>';
}
function wireBuild(m, id) {
  const b = m.querySelector('#hp-do-build');
  if (b) b.onclick = () => {
    if (!Build.commission(id)) { const box = m.querySelector('.hp-modal-box'); if (box) box.innerHTML = buildHtml(id); wireBuild(m, id); return; }
    closeModal();
    flash('🏗 ' + EQUIPMENT[id].name + ' commissioned');
    try { Yard.rebuild(); } catch (e) {}
    paint();
  };
}

/* ═══ ADMIN — THE MODEL REGISTRY ══════════════════════════════════════════
   Every visible object in the yard is a slot with a url. Setting one writes to
   Forge, which is the game's cloud-synced admin catalogue, so the change
   reaches EVERY player rather than the admin's own browser. Clearing a url
   returns the slot to its built-in primitives.
   Gated on isAdmin(); nothing here renders for a normal player. */
function paneAdmin() {
  if (!St.isAdmin()) return '';
  const urls = Models.urls();
  let h = '<div class="hp-card" style="border-color:#7a4a9e">' +
    '<h3>👑 Model Registry <span class="r">admin · applies to every player</span></h3>' +
    '<div class="hp-muted">Paste a <b>.glb</b> or <b>.gltf</b> url for any slot. It is stored on the shared Forge catalogue, so the next time anyone loads the yard they get your model. Clearing a slot returns it to the built-in shape. Models are measured and re-scaled on load, so the export units do not matter.</div></div>';

  for (const grp of Models.SLOT_GROUPS) {
    h += '<div class="hp-card"><h3>' + esc(grp) + '</h3>';
    for (const id of Models.SLOT_IDS) {
      const slot = Models.SLOTS[id];
      if (slot.group !== grp) continue;
      const url = urls[id] || '';
      const st = Models.status(id);
      const err = Models.errorFor(id);
      const badge = st === 'ready' ? '<span style="color:#7bc043">● custom</span>'
                  : st === 'pending' ? '<span style="color:#e8a13a">● loading</span>'
                  : st === 'error' ? '<span style="color:#e8593a">● failed</span>'
                  : '<span style="color:#8d959e">○ built-in</span>';
      h += '<div class="hp-slot">' +
        '<div class="hd"><b>' + esc(slot.label) + '</b><span class="meta">' + badge +
          ' · normalised to ' + slot.height + ' units high</span></div>' +
        (slot.note ? '<div class="hp-err">' + esc(slot.note) + '</div>' : '') +
        (err ? '<div class="hp-err" style="color:#e8593a">' + esc(err) + '</div>' : '') +
        '<div class="hp-row" style="gap:6px;margin-top:5px">' +
          '<input type="url" class="hp-input" data-slot="' + id + '" placeholder="https://…/' + id + '.glb" value="' + esc(url) + '">' +
          '<button class="hp-btn sm" data-setslot="' + id + '">Apply</button>' +
          (url ? '<button class="hp-btn sm" data-clearslot="' + id + '">Clear</button>' : '') +
        '</div></div>';
    }
    h += '</div>';
  }
  return h;
}
function wireAdmin(pane) {
  pane.querySelectorAll('[data-setslot]').forEach(b => b.onclick = () => {
    const id = b.dataset.setslot;
    const inp = pane.querySelector('[data-slot="' + id + '"]');
    const v = (inp && inp.value || '').trim();
    /* Only http(s). A data: or blob: url would work for the admin and be
       meaningless to every other player, which is the opposite of what this
       panel is for — so it is refused with the reason rather than accepted
       and silently useless. */
    if (v && !/^https?:\/\//i.test(v)) {
      St.toast('Model urls must be http(s) — a data: or blob: url only exists in your own browser.', 5200);
      return;
    }
    if (!Models.setUrl(id, v)) { St.toast('Could not save that — are you signed in as an admin?', 4200); return; }
    Models.invalidate(id);
    Models.preload(id).then(() => { try { Yard.rebuild(); } catch (e) {} paint(); });
    St.toast(v ? '🎨 ' + Models.SLOTS[id].label + ' updated for every player.' : 'Reverted to the built-in shape.', 4000);
    paint();
  });
  pane.querySelectorAll('[data-clearslot]').forEach(b => b.onclick = () => {
    const id = b.dataset.clearslot;
    Models.setUrl(id, '');
    Models.invalidate(id);
    try { Yard.rebuild(); } catch (e) {}
    St.toast('Reverted to the built-in shape.', 3200);
    paint();
  });
}

/* ═══ WIRING ═════════════════════════════════════════════════════════════ */
function wire(pane, s) {
  const on = (sel, fn) => pane.querySelectorAll(sel).forEach(n => n.onclick = () => fn(n));

  // Intake
  on('#hp-reroll', () => { rollMarket(); paint(); });
  on('[data-buy]', n => { const sh = market.find(m => m.id === n.dataset.buy); if (sh && Sim.buyShipment(sh)) { market = market.filter(m => m.id !== sh.id); paint(); } });
  on('[data-treat]', n => { const sh = s.crude.find(c => c.id === n.dataset.treat); if (sh && Sim.pretreat(sh)) paint(); });

  // Run
  on('[data-run]', n => startRun(n.dataset.run));
  on('#hp-abort', async () => {
    if (!run) return;
    if (!(await St.confirmAsync('Shut the column in? Everything still in the feed line is lost.'))) return;
    run.aborted = true; finishRun();
  });
  on('#hp-auto', () => { if (run) { run.auto = !run.auto; paint(); } });
  pane.querySelectorAll('[data-g-in]').forEach(inp => {
    inp.oninput = () => {
      if (!run) return;
      const v = parseFloat(inp.value);
      if (inp.dataset.gIn === 'temp') run.temp = v;
      if (inp.dataset.gIn === 'pres') run.pres = v;
      if (inp.dataset.gIn === 'flow') run.flow = v;
      // Touching a control drops autopilot — you cannot half-automate a column.
      if (run.auto) { run.auto = false; const b = el.querySelector('#hp-auto'); if (b) { b.textContent = '🤖 Autopilot: OFF'; b.classList.remove('ok'); } }
      patchRun();
    };
  });

  // Blend
  on('#hp-reoffer', () => { C.rollOffers(5); paint(); });
  on('[data-bench]', n => { benchContract = n.dataset.bench; bench = {}; lastTest = null; paint(); });
  on('[data-goship]', () => { tab = 'ship'; paint(); });
  on('[data-drop]', async n => {
    if (!(await St.confirmAsync('Abandon this contract? You pay the penalty and take a reputation hit.'))) return;
    C.abandon(n.dataset.drop); paint();
  });
  pane.querySelectorAll('[data-mix]').forEach(inp => {
    inp.oninput = () => {
      const id = inp.dataset.mix;
      bench[id] = parseFloat(inp.value) || 0;
      const q = pane.querySelector('[data-mixq="' + id + '"]');
      if (q) q.textContent = fmt(bench[id]);
      const bl = pane.querySelector('[data-mixbuy="' + id + '"]');
      if (bl) {
        const over = Math.max(0, bench[id] - (parseFloat(inp.dataset.have) || 0));
        bl.textContent = over > 0 ? '+' + fmt(over) + ' buy' : '';
      }
      // Live labs update the spec card as you drag; the cheap ones do not, and
      // that is the whole difference between the tiers.
      if (St.lab().live) patchBenchNumbers(s);
      syncYard();
    };
    inp.onchange = () => { if (!St.lab().live) return; paint(); };
  });
  on('#hp-clear', () => { bench = {}; lastTest = null; paint(); });
  on('#hp-test', () => { const r = B.runTest(bench, JSON.stringify(bench)); if (r) { lastTest = r; paint(); } });
  on('#hp-commit', () => {
    const job = s.contracts.find(c => c.id === benchContract) || null;
    const b = B.commitBatch(bench, job);
    if (b) { bench = {}; lastTest = null; flash('Batch #' + b.n + ' in the tank'); paint(); }
  });

  // Batch decisions — the four exits.
  on('[data-fix]', n => { if (B.topUp(s.batches.find(b => b.id === n.dataset.fix), n.dataset.fixc, parseInt(n.dataset.fixl, 10))) paint(); });
  on('[data-repro]', n => { if (B.reprocess(s.batches.find(b => b.id === n.dataset.repro))) paint(); });
  on('[data-down]', n => { if (B.downgradeSell(s.batches.find(b => b.id === n.dataset.down))) paint(); });
  on('[data-scrap]', async n => {
    if (!(await St.confirmAsync('Dump this batch? You pay disposal and your quality rating drops.'))) return;
    B.scrap(s.batches.find(b => b.id === n.dataset.scrap)); paint();
  });
  on('[data-approve]', n => {
    const b = s.batches.find(x => x.id === n.dataset.approve);
    const job = s.contracts.find(c => c.batchId === b.id);
    if (B.approve(b, job)) { tab = 'ship'; paint(); }
  });

  // Ship
  on('[data-ship]', n => {
    const b = s.batches.find(x => x.id === n.dataset.ship);
    const job = s.contracts.find(c => c.batchId === b.id);
    if (C.dispatch(job, b, n.dataset.pri)) { B.removeBatch(b.id); job.batchId = 'sent'; paint(); }
  });

  // Stock
  on('[data-conv]', n => {
    const id = n.dataset.conv;
    const cv = CONVERSION_LIST.find(c => c.id === id);
    const amt = n.dataset.cvl === 'all' ? St.stock(cv.in) : parseInt(n.dataset.cvl, 10);
    if (B.convert(id, amt)) paint();
  });
  on('[data-spotbuy]', n => { if (B.buySpot(n.dataset.spotbuy, 1000)) paint(); });
  on('[data-sellstream]', n => {
    const id = n.dataset.sellstream;
    const amt = n.dataset.selln === 'all' ? St.stock(id) : parseInt(n.dataset.selln, 10);
    if (B.sellSpot(id, amt)) paint();
  });
  on('[data-spotsell]', n => { if (B.sellSpot(n.dataset.spotsell, 500)) paint(); });

  // Yard
  on('[data-plan]', n => {
    const id = n.dataset.plan;
    // Same modal the build plot opens, so the two routes cannot drift apart.
    if (Build.BOM[id]) { openBuild(id); return; }
    if (St.buyEquip(id)) { try { Yard.rebuild(); } catch (e) {} paint(); }
  });
  on('[data-fixup]', n => { if (St.repair(n.dataset.fixup)) paint(); });
  wireAdmin(pane);
}

/* Patch just the numbers under the bench sliders. Repainting the whole pane
   while a slider is captured by the pointer cancels the drag. */
function patchBenchNumbers(s) {
  const job = s.contracts.find(c => c.id === benchContract) || null;
  const target = job ? GRADES[job.grade] : GRADES.regular;
  const a = B.assayBench(bench);
  const chk = specCheck(a, target);
  const rows = [['Octane', a.octane.toFixed(1), chk.octane.ok], ['Sulfur', Math.round(a.sulfur) + ' ppm', chk.sulfur.ok],
                ['Purity', a.purity.toFixed(1) + '%', chk.purity.ok], ['Stability', a.rvp.toFixed(1) + ' psi', chk.stability.ok]];
  const spec = el.querySelector('.hp-card .hp-spec');
  if (spec) {
    let i = 0;
    const cells = spec.children;
    for (const [k, v, ok] of rows) {
      if (k === 'Octane' && target.octaneMin === 0) continue;
      if (k === 'Stability' && target.rvpMax > 90) continue;
      if (cells[i + 1]) { cells[i + 1].textContent = v; cells[i + 1].className = 'v ' + (ok ? 'pass' : 'fail'); }
      if (cells[i + 2]) { cells[i + 2].textContent = ok ? '✓' : '✗'; cells[i + 2].className = 's ' + (ok ? 'pass' : 'fail'); }
      i += 3;
    }
  }
  const value = job ? job.value : Math.round(a.volume * target.pricePerL * s.marketIndex);
  /* The spot-purchase row appears and disappears with the shortfall, so the
     money rows are addressed by LABEL rather than by index — an index-based
     patch wrote the margin into the "contract pays" slot the moment a player
     dragged a slider past their stock. */
  const put = (label, txt, cls) => {
    for (const row of el.querySelectorAll('.hp-money')) {
      if (row.firstChild && row.firstChild.textContent.trim() === label) {
        const b = row.querySelector('b');
        if (b) { b.textContent = txt; if (cls != null) b.className = cls; }
        return true;
      }
    }
    return false;
  };
  put('Volume in tank', fmt(a.volume) + ' L' + (job ? ' / ' + fmt(job.litres) + ' L' : ''),
      job && a.volume >= job.litres ? 'hp-pos' : 'hp-amber');
  put('Blend cost basis', '🔥 ' + fmt(a.cost), '');
  put('Contract pays', '🔥 ' + fmt(value), 'hp-amber');
  put('Gross margin', '🔥 ' + fmt(value - a.cost), value - a.cost > 0 ? 'hp-pos' : 'hp-neg');
  const short = B.spotShortfall(bench);
  if (!put('Spot purchases on commit', '🔥 ' + fmt(short.cost), 'hp-neg') && short.cost > 0) {
    // The row did not exist when this pane was drawn — a full repaint is the
    // honest way to add it, and it only happens on the first slider that goes
    // past stock rather than on every move.
    paint();
  }
}

/* ═══ SESSION TICK ═══════════════════════════════════════════════════════
   One second. Deliveries land, deadlines expire, the market breathes. Kept
   deliberately cheap: it repaints only when something actually happened. */
function sessionTick() {
  if (!el) return;
  const arrivals = C.settleArrivals();
  const expired = C.sweepExpired();
  let dirty = arrivals.length > 0 || expired.length > 0;

  for (const a of arrivals) {
    St.toast((a.late ? '⏰ Late — ' : '✅ ') + fmt(a.contract.delivered) + ' L to ' + a.contract.station +
             ' · 🔥' + fmt(a.paid) + (a.intoOwn ? ' (' + fmt(a.intoOwn) + ' L into your own tanks)' : ''), 5600);
    flash((a.late ? '⏰ ' : '✅ ') + 'Paid 🔥' + fmt(a.paid));
  }

  // The market re-reads demand every 20s so a shortage the player caused shows
  // up while they are still in the yard.
  if ((Date.now() / 1000 | 0) % 20 === 0) { C.refreshMarket(); dirty = true; }

  /* ⚠ THE BLEND AND SHIP TABS MUST NOT BE REPAINTED FOR A CLOCK.
     They were, once a second, for the contract countdowns — which reset every
     slider on the bench to its rendered value while the player was dragging
     one, and dropped any click that landed in the same frame. The clocks are
     now patched in place and the pane is only rebuilt when the game state
     genuinely changed. */
  if (dirty && !(tab === 'run' && run)) paint();
  else { chips(St.S()); tickClocks(); syncYard(); }
}

/* Countdown text, urgency colour and convoy bars, patched without touching the
   surrounding markup. Everything here is find-or-skip: if the pane is showing
   something else, there is simply nothing to update. */
function tickClocks() {
  if (!el) return;
  const s = St.S();
  const clocks = el.querySelectorAll('.hp-offer .hp-clock[data-cd]');
  for (const n of clocks) {
    const c = s.contracts.find(x => x.id === n.dataset.cd);
    if (!c) continue;
    const left = C.timeLeft(c);
    n.textContent = left > 0 ? Math.floor(left / 60000) + ':' + String(Math.floor(left / 1000) % 60).padStart(2, '0') : 'OVERDUE';
    n.classList.toggle('urgent', left < 180000);
  }
  el.querySelectorAll('[data-convoy]').forEach(n => {
    const t = s.convoy.find(x => x.id === n.dataset.convoy);
    if (!t) return;
    const pct = C.convoyProgress(t) * 100;
    const bar = n.querySelector('i'); if (bar) bar.style.width = pct + '%';
    const lbl = n.parentNode && n.parentNode.querySelector('[data-convoypct]');
    if (lbl) lbl.textContent = Math.round(pct) + '%';
  });
}
