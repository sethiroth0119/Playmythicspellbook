/* ══════════════════════════════════════════════════════════════════════════
   🚌 TRANSIT — THE PANEL.  Lines, stop picking, and what the network costs.
   ──────────────────────────────────────────────────────────────────────────
   Its own dialog rather than a dossier tab, for the same reason the Stadium and
   the Resting House have one: a list of lines each with a colour, a name field,
   a stop editor and a status line does not fit the inspector's panes.

   🖱 THE STOP EDITOR IS THE FEATURE. "Pick a line, click stops in order" needs
   the MAP, so entering pick mode HIDES this dialog and leaves a slim banner.
   A modal with a veil over the canvas cannot be a map tool — that was tried
   first and every click landed on the veil.

   ⚠ UI legibility is dimension 12 of the BAR: state is expressed as a meter
     with a signed causal list, not a raw number. So the network summary says
     which way each term pushes the subsidy, and a line that cannot run prints
     the actual reason rather than a red dot.
   ══════════════════════════════════════════════════════════════════════════ */

import { TRANSIT_ECON as ECON, LINE_COLORS } from './tuning.js';
import * as R from './routes.js';

let C = null;
let PICK = null;                 // line id currently collecting stops, or null
let styled = false;

export function init(ctx) { C = ctx; }

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hex6 = n => '#' + (n >>> 0).toString(16).padStart(6, '0');
const n1 = n => (Math.round((Number(n) || 0) * 10) / 10).toLocaleString('en-US');
const pct = n => Math.round((Number(n) || 0) * 100) + '%';

function ensureStyle() {
  if (styled) return; styled = true;
  const st = document.createElement('style');
  st.textContent = `
  #tr-ov{position:fixed;inset:0;z-index:9720;display:flex;align-items:center;justify-content:center;
    background:rgba(4,6,12,.74);backdrop-filter:blur(3px);padding:18px}
  #tr-panel{width:min(760px,96vw);max-height:92vh;overflow:auto;border-radius:14px;padding:1rem 1.15rem 1.1rem;
    background:linear-gradient(180deg,#150f1f,#0a0711);border:1px solid rgba(212,175,55,.45);
    box-shadow:0 26px 74px rgba(0,0,0,.8);color:#e8dfc9;font-size:13px}
  #tr-panel h3{margin:0 0 .1rem;font-size:1.02rem;color:var(--gold,#d4af37);letter-spacing:.05em}
  #tr-panel .sub{font-size:11px;color:var(--mist,#8f87a3);margin-bottom:.7rem;line-height:1.5}
  #tr-panel .card{background:rgba(0,0,0,.32);border:1px solid rgba(255,255,255,.09);border-radius:10px;
    padding:.6rem .7rem;margin-bottom:.6rem}
  #tr-panel .card h4{margin:0 0 .4rem;font-size:10px;letter-spacing:.14em;color:#c8ab63;font-weight:800}
  #tr-panel .row{display:flex;justify-content:space-between;gap:.5rem;padding:.14rem 0;font-size:12px}
  #tr-panel .row span{color:var(--mist,#8f87a3)} #tr-panel .row b{color:#f0e6cc}
  #tr-panel .up{color:#a8e9c2} #tr-panel .dn{color:#f4835a}
  .tr-meter{height:7px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden;margin:.28rem 0 .1rem}
  .tr-meter i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#4f74d8,#5fbf6a)}
  .tr-lic{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.55rem}
  .tr-lic div{flex:1 1 210px;border-radius:9px;padding:.5rem .6rem;font-size:11.5px;line-height:1.45;
    border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04)}
  .tr-lic div.on{border-color:rgba(126,214,160,.6);background:rgba(60,140,95,.14)}
  .tr-lic b{color:#f0d78a}
  /* The build-time line under a licence. Its own rule because the .mist class
     is scoped to the pick bar, and a card that quietly inherits body colour is
     how a warning stops reading as one.
     WARNING: this comment lives INSIDE a template literal. A backtick here
     ends the string and the rest of ensureStyle() becomes a tagged template —
     still valid syntax, so BOTH gates stay green while the panel throws
     "... is not a function" at runtime. That happened while writing this. */
  .tr-lic .note{color:var(--mist,#8f87a3)} .tr-lic .note b{color:#e8dfc9}
  .tr-line{border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:.5rem .6rem;margin-bottom:.5rem;
    background:rgba(255,255,255,.035)}
  .tr-line .hd{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
  .tr-sw{width:16px;height:16px;border-radius:5px;flex:0 0 auto;border:1px solid rgba(0,0,0,.5);cursor:pointer}
  .tr-name{flex:1 1 130px;min-width:110px;padding:.28rem .45rem;border-radius:7px;font-size:12px;
    border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.35);color:#f0e6cc}
  .tr-chip{font-size:9.5px;font-weight:800;letter-spacing:.1em;padding:.16rem .5rem;border-radius:99px;
    background:rgba(255,255,255,.07);color:#cfc7dd;white-space:nowrap}
  .tr-chip.bad{background:rgba(196,71,63,.22);color:#f4a79f}
  .tr-chip.good{background:rgba(60,140,95,.25);color:#a8e9c2}
  .tr-line .fx{font-size:11px;color:var(--mist,#8f87a3);margin-top:.35rem;line-height:1.5}
  .tr-btns{display:flex;gap:.35rem;flex-wrap:wrap;margin-top:.45rem}
  .tr-btns button{padding:.28rem .6rem;border-radius:7px;cursor:pointer;font-size:10.5px;font-weight:700;
    border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);color:#cfc7dd}
  .tr-btns button.pri{color:#241a05;border-color:rgba(212,175,55,.7);
    background:linear-gradient(180deg,#f0d98d,#c19a34)}
  .tr-btns button.dan{color:#f4a79f;border-color:rgba(196,71,63,.5)}
  .tr-btns button:disabled{opacity:.4;cursor:not-allowed}
  .tr-swatches{display:flex;gap:.25rem;margin-top:.4rem;flex-wrap:wrap}
  .tr-swatches i{width:15px;height:15px;border-radius:4px;cursor:pointer;display:block;
    border:1px solid rgba(0,0,0,.55)}
  .tr-swatches i.on{outline:2px solid #f0d78a;outline-offset:1px}
  #tr-panel .foot{display:flex;gap:.5rem;margin-top:.7rem}
  #tr-panel .foot button{flex:1;padding:.5rem;border-radius:9px;cursor:pointer;font-size:12px;
    border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);color:#cfc7dd}
  #tr-pickbar{position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:9500;
    display:flex;align-items:center;gap:.6rem;padding:.5rem .8rem;border-radius:11px;
    background:linear-gradient(180deg,#150f1f,#0a0711);border:1px solid rgba(212,175,55,.6);
    box-shadow:0 12px 40px rgba(0,0,0,.7);color:#e8dfc9;font-size:12px;max-width:94vw}
  #tr-pickbar b{color:#f0d78a} #tr-pickbar .mist{color:var(--mist,#8f87a3);font-size:11px}
  #tr-pickbar button{padding:.32rem .8rem;border-radius:8px;cursor:pointer;font-size:11px;font-weight:800;
    color:#241a05;border:1px solid rgba(212,175,55,.7);background:linear-gradient(180deg,#f0d98d,#c19a34)}`;
  document.head.appendChild(st);
}

/* ── the 🚌 button on the build bar ─────────────────────────────────────── */
export function mountButton() {
  try {
    const bar = document.getElementById('buildbar');
    if (!bar || document.getElementById('tr-openbtn')) return;
    const b = document.createElement('button');
    b.className = 'bbtn tool'; b.id = 'tr-openbtn'; b.dataset.type = '';
    b.innerHTML = '<span class="bico">🚌</span><span class="bname">Transit</span>';
    b.onclick = () => open();
    bar.appendChild(b);
  } catch (e) {}
}

/* ── open / close ────────────────────────────────────────────────────────── */
export function open() {
  ensureStyle();
  stopPicking(true);
  let ov = document.getElementById('tr-ov');
  if (!ov) {
    ov = document.createElement('div'); ov.id = 'tr-ov';
    ov.innerHTML = '<div id="tr-panel"></div>';
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    document.body.appendChild(ov);
  }
  ov.style.display = 'flex';
  render();
}
export function close() {
  const ov = document.getElementById('tr-ov');
  if (ov) ov.style.display = 'none';
}
export const isOpen = () => { const o = document.getElementById('tr-ov'); return !!o && o.style.display !== 'none'; };

/* ── stop picking ────────────────────────────────────────────────────────── */
export const picking = () => PICK;
function startPicking(id) {
  const L = R.byId(id); if (!L) return;
  PICK = id;
  close();
  try { C.setMode('inspect'); } catch (e) {}
  drawPickBar();
  const m = R.modeOf(L);
  C.toast('🚏 Click ' + (L.mode === 'rail' ? 'train stations' : 'bus stops') +
    ' on the map, in the order the ' + m.vehicleWord + ' should call at them. Click one again to drop it.', 'good');
}
export function stopPicking(silent) {
  PICK = null;
  const b = document.getElementById('tr-pickbar'); if (b) b.remove();
  if (!silent) open();
}
function drawPickBar() {
  const L = R.byId(PICK); if (!L) return;
  let b = document.getElementById('tr-pickbar');
  if (!b) { b = document.createElement('div'); b.id = 'tr-pickbar'; document.body.appendChild(b); }
  const m = R.modeOf(L);
  const fault = R.faultOf(L);
  b.innerHTML =
    '<span style="width:14px;height:14px;border-radius:4px;display:inline-block;background:' + hex6(L.color) + '"></span>' +
    '<b>' + esc(L.name) + '</b>' +
    '<span class="mist">' + L.stops.length + ' stop' + (L.stops.length === 1 ? '' : 's') +
      ' · click ' + (L.mode === 'rail' ? 'stations' : 'stops') + ' in order' +
      (fault ? ' · <span style="color:#f4835a">' + esc(fault) + '</span>' : ' · <span style="color:#a8e9c2">running</span>') +
    '</span>' +
    '<button id="tr-pickdone">✔ Done</button>';
  const d = document.getElementById('tr-pickdone');
  if (d) d.onclick = () => { stopPicking(false); };
}

/* Called by node-city's openInspect wrapper BEFORE the dossier opens. Returns
   true when the click was consumed as a stop pick. */
export function onTileClick(k) {
  if (!PICK) return false;
  const L = R.byId(PICK); if (!L) { PICK = null; return false; }
  const res = R.toggleStop(PICK, k);
  if (res === 'wrong-type') {
    C.toast('🚏 That is not a ' + (L.mode === 'rail' ? 'Train Station' : 'Bus Stop') +
      ' — build one there first, then add it to ' + L.name + '.', 'bad');
    return true;
  }
  if (res === 'added' || res === 'removed') {
    R.markDirty(); R.rebuildOverlay(); R.manage(); R.recompute(true);
    C.saveSoon(); drawPickBar();
  }
  return true;
}

/* ── render ──────────────────────────────────────────────────────────────── */
/* 🚦 WHAT THE LICENCE ACTUALLY GETS YOU, ON THE LICENCE — AND BEFORE IT IS
   BOUGHT. A licence is worth exactly what it lets you build, and a Rail
   Operator that lets you build a Train Station your crews will not take on is
   worth 10,000,000 🔥 of nothing. That shipped: the station was 1:32:57 against
   a 40:00 free-crew ceiling, the order gate refused it on the click, and NOTHING
   on this panel or at City Hall said a word about it beforehand.
   THE NUMBER IS THE ORDER GATE'S OWN (`C.crewNote` → node-city's bldCrewNote →
   bldDuration → ECON), so this can never advertise a build the gate would
   refuse, and the refusal sentence it prints is byte-identical to the one the
   click produces — one string, one source (bldCeilingMsg).
   ⚠ Prints nothing at all when the host hands back null (no economy module ⇒
     everything places instantly). A hand-written "about half an hour" here
     would be a second source of truth for a derived number — Rule 4. */
function crewLine(stopType) {
  let n = null;
  try { n = C.crewNote ? C.crewNote(stopType) : null; } catch (e) { n = null; }
  if (!n || n.exempt || !n.sec) return '';
  if (n.needsCo) return '<br><span class="dn">' + esc(n.sentence) + '</span>';
  return '<br><span class="note">⏱ Each one takes <b>' + esc(n.label) + '</b> to raise' +
    (n.over ? ' — your 🏗 Construction Co. takes the job; the free crew will not.' : '.') + '</span>';
}
function licenceCard(modeId) {
  const m = ECON.modes[modeId];
  const own = R.hasLicence(modeId);
  const price = C.opsPrice(m.licence);
  const label = modeId === 'rail' ? 'Rail Operator' : 'Bus Company';
  const thing = modeId === 'rail' ? 'Train Station' : 'Bus Stop';
  return '<div class="' + (own ? 'on' : '') + '">' + m.ico + ' <b>' + label + '</b><br>' +
    (own
      ? '<span class="up">Licence held.</span> You may lay ' +
        (modeId === 'rail' ? 'track, build stations and run trains.' : 'stops and run buses.')
      : '🔒 Not owned — buy it at City Hall (Just Business → Found a Business)' +
        (price ? ' for <b>' + price.toLocaleString('en-US') + ' 🔥</b>' : '') +
        '. It buys the right to build ' + esc(thing) + 's, nothing else.') +
    crewLine(m.stopType) +
    '</div>';
}

function lineCard(L) {
  const rep = R.recompute().lines[L.id] || {};
  const m = R.modeOf(L);
  const fault = rep.fault;
  const swatches = LINE_COLORS.map(c =>
    '<i data-trcol="' + L.id + '" data-hex="' + c.hex + '" title="' + c.name + '" class="' +
    (c.hex === L.color ? 'on' : '') + '" style="background:' + hex6(c.hex) + '"></i>').join('');
  return '<div class="tr-line">' +
    '<div class="hd">' +
      '<span class="tr-sw" data-trcyc="' + L.id + '" title="Line colour" style="background:' + hex6(L.color) + '"></span>' +
      '<input class="tr-name" data-trname="' + L.id + '" value="' + esc(L.name) + '" maxlength="40">' +
      '<span class="tr-chip">' + m.ico + ' ' + m.name.toUpperCase() + '</span>' +
      '<span class="tr-chip">' + (L.stops.length) + ' STOPS</span>' +
      '<span class="tr-chip">' + (L.closed ? 'LOOP' : 'OUT &amp; BACK') + '</span>' +
      '<span class="tr-chip ' + (fault ? 'bad' : 'good') + '">' + (fault ? 'HALTED' : 'RUNNING') + '</span>' +
    '</div>' +
    '<div class="fx">' + (fault
      ? '⚠ ' + esc(fault)
      : (rep.vehicles | 0) + ' ' + (rep.vehicles === 1 ? m.vehicleWord : m.pluralWord) +
        ' · ' + (rep.tiles | 0) + ' tiles of route · carries <b style="color:#f0e6cc">' + n1(rep.riders) +
        '</b> citizens/hr<br>reaches ' + pct(rep.homeReach) + ' of the city\'s homes and ' +
        pct(rep.workReach) + ' of its jobs — a commute needs BOTH ends, so this line is limited by the ' +
        (rep.homeReach <= rep.workReach ? 'homes' : 'jobs') + ' it touches' +
        (rep.capacity < rep.demand ? '; and by seats — ' + n1(rep.demand) + ' want to ride, ' + n1(rep.capacity) + ' can.' : '.')) +
    '</div>' +
    '<div class="tr-swatches">' + swatches + '</div>' +
    '<div class="tr-btns">' +
      '<button class="pri" data-trpick="' + L.id + '">🚏 Pick stops on the map</button>' +
      '<button data-trloop="' + L.id + '">' + (L.closed ? '↔ Make it out &amp; back' : '⟳ Close the loop') + '</button>' +
      '<button data-tract="' + L.id + '">' + (L.active === false ? '▶ Resume' : '⏸ Suspend') + '</button>' +
      '<button class="dan" data-trdel="' + L.id + '">🗑 Delete</button>' +
    '</div>' +
  '</div>';
}

export function render() {
  const host = document.getElementById('tr-panel'); if (!host) return;
  const rep = R.recompute(true);
  const L = R.ledger();
  const pop = Math.max(0, C.cityPop());
  const canBus = R.hasLicence('bus'), canRail = R.hasLicence('rail');

  host.innerHTML =
    '<h3>🚌 TRANSIT AUTHORITY</h3>' +
    '<div class="sub">Buy the company at City Hall, build the stops, then draw the routes. ' +
      'Citizens whose home AND workplace are both within ' + ECON.walkRadius +
      ' tiles of one of a line\'s stops travel on it instead of driving.</div>' +

    '<div class="tr-lic">' + licenceCard('bus') + licenceCard('rail') + '</div>' +

    '<div class="card"><h4>THE NETWORK</h4>' +
      '<div class="row"><span>Mode share — of ' + n1(pop) + ' citizens</span><b>' + pct(rep.modeShare) + '</b></div>' +
      '<div class="tr-meter"><i style="width:' + Math.round(Math.min(1, rep.modeShare / ECON.maxModeShare) * 100) + '%"></i></div>' +
      '<div class="row"><span>Carried</span><b>' + n1(rep.riders) + ' citizens / hr</b></div>' +
      '<div class="row"><span>🚏 Stops · 🚆 Stations · 🛤 Track</span><b>' +
        L.inf.busstop + ' · ' + L.inf.trainstation + ' · ' + L.inf.railtrack + '</b></div>' +
      '<div class="row"><span>Vehicles running</span><b>' + L.buses + ' buses · ' + L.trains + ' trains</b></div>' +
      /* The BAR's demand panel: a signed causal list, not a bare number. */
      '<div class="row"><span class="dn">− Operating cost</span><b class="dn">' + n1(L.upkeep) + ' ₵/hr</b></div>' +
      '<div class="row"><span class="up">+ Fares</span><b class="up">' + n1(L.fares) + ' ₵/hr</b></div>' +
      '<div class="row"><span><b>= City subsidy</b></span><b class="' + (L.net < 0 ? 'dn' : 'up') + '">' +
        (L.net < 0 ? n1(L.net) + ' ₵/hr' : 'nothing — fares cover it') + '</b></div>' +
      '<div class="sub" style="margin:.4rem 0 0">Fares can only ever REDUCE the subsidy, never turn a profit — ' +
        'public transport that pays you would be a Cinder faucet. Empty vehicles and unused stops are what cost you money.</div>' +
    '</div>' +

    '<div class="card"><h4>LINES</h4>' +
      (state_lines().length ? state_lines().map(lineCard).join('')
        : '<div class="sub" style="margin:0">No lines yet. ' +
          (canBus || canRail ? 'Create one below, then click your stops on the map in order.'
                             : 'Buy a Bus Company or a Rail Operator at City Hall first.') + '</div>') +
      '<div class="tr-btns">' +
        '<button class="pri" id="tr-newbus"' + (canBus ? '' : ' disabled') + '>🚌 New bus route</button>' +
        '<button class="pri" id="tr-newrail"' + (canRail ? '' : ' disabled') + '>🚆 New rail line</button>' +
        '<button id="tr-show">' + (R.state.show ? '👁 Hide routes on the map' : '👁 Show routes on the map') + '</button>' +
      '</div>' +
    '</div>' +

    '<div class="sub">⚠ <b>What this does and does not model.</b> Ridership is statistical: a line\'s share is ' +
      'computed from how much of the city\'s housing and how many of its jobs its stops reach, and that share is ' +
      'taken off the private cars on the streets and spent on pedestrians walking to stops. Individual named ' +
      'citizens are not carried inside a bus mesh — the vehicles run the real route, but they do not hold a ' +
      'passenger list.</div>' +

    '<div class="foot"><button id="tr-close">Close</button></div>';

  wire(host);
}
const state_lines = () => R.state.lines;

function wire(host) {
  const refresh = () => { R.markDirty(); R.rebuildOverlay(); R.manage(); C.saveSoon(); render(); };
  const q = (sel, fn) => host.querySelectorAll(sel).forEach(fn);

  const cl = host.querySelector('#tr-close'); if (cl) cl.onclick = () => close();
  const nb = host.querySelector('#tr-newbus');
  if (nb) nb.onclick = () => { const L = R.newLine('bus'); refresh(); startPicking(L.id); };
  const nr = host.querySelector('#tr-newrail');
  if (nr) nr.onclick = () => { const L = R.newLine('rail'); refresh(); startPicking(L.id); };
  const sh = host.querySelector('#tr-show');
  if (sh) sh.onclick = () => { R.setShow(!R.state.show); C.saveSoon(); render(); };

  q('[data-trpick]', b => b.onclick = () => startPicking(b.getAttribute('data-trpick')));
  q('[data-trloop]', b => b.onclick = () => { const L = R.byId(b.getAttribute('data-trloop')); if (L) { L.closed = !L.closed; refresh(); } });
  q('[data-tract]', b => b.onclick = () => { const L = R.byId(b.getAttribute('data-tract')); if (L) { L.active = (L.active === false); refresh(); } });
  q('[data-trdel]', b => b.onclick = async () => {
    const L = R.byId(b.getAttribute('data-trdel')); if (!L) return;
    const ok = await C.confirm('Delete ' + L.name + '?\n\nIts ' + L.stops.length +
      ' stops stay standing — only the route is removed.');
    if (!ok) return;
    R.removeLine(L.id); refresh();
  });
  q('[data-trcyc]', s => s.onclick = () => {
    const L = R.byId(s.getAttribute('data-trcyc')); if (!L) return;
    const i = LINE_COLORS.findIndex(c => c.hex === L.color);
    L.color = LINE_COLORS[(i + 1) % LINE_COLORS.length].hex;
    refresh();
  });
  q('[data-trcol]', s => s.onclick = () => {
    const L = R.byId(s.getAttribute('data-trcol')); if (!L) return;
    L.color = (+s.getAttribute('data-hex')) >>> 0;
    refresh();
  });
  /* Rename commits on change/blur, not per keystroke: re-rendering the whole
     panel on input would steal the caret on every letter typed. */
  q('[data-trname]', inp => {
    inp.onchange = () => {
      const L = R.byId(inp.getAttribute('data-trname')); if (!L) return;
      L.name = String(inp.value || '').slice(0, 40).trim() || L.name;
      C.saveSoon(); render();
    };
  });
}

/* Live refresh while the dialog is open — ridership moves as the city does.
   ⚠ NEVER WHILE THE PLAYER IS IN A FIELD. This runs on the economy beat, and
     render() replaces the whole panel's innerHTML: re-rendering under a focused
     name box destroys the input mid-word and takes the caret with it. Same
     reason the rename commits on `change` rather than on `input`. */
export function tick() {
  if (isOpen()) {
    try {
      const a = document.activeElement;
      const host = document.getElementById('tr-panel');
      if (a && host && host.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
      render();
    } catch (e) {}
  } else if (PICK) { try { drawPickBar(); } catch (e) {} }
}
