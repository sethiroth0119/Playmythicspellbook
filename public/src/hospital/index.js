/* ══════════════════════════════════════════════════════════════════════════
   🏥 HOSPITAL — the Medical Corporation's 3D interior. window.MythicHospital.
   ──────────────────────────────────────────────────────────────────────────
   Buy a Medical Corporation in Just Business and it appears under My
   Companies; enter it and you are here. Walk the building:

     Front Desk        the ledger — what sold, what is waiting
     The Ward          intake + triage (/src/ward) — crates from hauliers
     Containment Vault every cure the ward opened, as a sample line
     Scrub Station     the airlock under another name — four seals
     Compounding Lab   (sterile) turn a line into one of five medicines
     Stockroom         the shelf the city's clinics and med labs retail from
     Lab Corridor      through to the containment lab, if you own one

   The room, the walker, the camera and the character rig are the containment
   lab's (/src/biolab), handed this building's floor plan. The sterile rule is
   the hazmat rule: the clean room refuses an ungowned player and an exposed
   run is on the product (/src/hospital/pharma.js).

   🔴 THE GLOBALS TRAP (CLAUDE.md). Nothing here reads a game global. All of
   it arrives through window.MythicPlagueBridge via /src/hospital/state.js.
   Without the bridge the building opens and says so; nothing trades.

   ⚠ INERT UNTIL open(). Importing builds nothing, loads no three.js.
   ══════════════════════════════════════════════════════════════════════════ */

import { ensureThree, build, SUIT_SPEED } from '../biolab/scene.js';
import { makePlayer, makeInput, step, attachInput } from '../biolab/player.js';
import { nearest, colliders, inHotZone } from '../biolab/stations.js';
import * as HZ from '../biolab/hazmat.js';
import { ROOM, HOT_Z, STATIONS, PLAN, stationByKey } from './floor.js';
import * as HUD from './hud.js';
import * as HS from './state.js';
import * as PH from './pharma.js';
import * as PL from '../plague/state.js';

let RUN = null;
let STYLE = null;

function injectCss() {
  try {
    if (!document.getElementById('mythic-biolab-css')) {
      const s = document.createElement('style'); s.id = 'mythic-biolab-css'; s.textContent = HUD.LAB_CSS; document.head.appendChild(s);
    }
    if (STYLE && STYLE.isConnected) return;
    STYLE = document.createElement('style'); STYLE.id = 'mythic-hospital-css'; STYLE.textContent = HUD.CSS; document.head.appendChild(STYLE);
  } catch (e) {}
}

function B() { return HS.bridge(); }
function toastGame(m, ms) { try { B().toast(m, ms); } catch (e) {} }

const WALK_PLAN = { room: ROOM, colliders: colliders(STATIONS) };

function newRun() {
  const p = makePlayer();
  p.x = 0; p.z = -16.2;             // just inside the lobby doors
  return {
    player: p, input: makeInput(), suit: HZ.emptySuit(),
    done: {}, near: null, blocked: null, panel: null,
    dial: null, compoundSel: { lineId: null, productId: 'antiviral', units: 10 },
    lastFrame: 0, flat: false, chip: '', shelfText: '',
  };
}

function shelfText() {
  try {
    const st = HS.stock();
    const parts = PH.PRODUCT_IDS.filter((pid) => st[pid] && st[pid].units > 0).map((pid) => PH.PRODUCTS[pid].icon + ' ' + st[pid].units);
    return parts.length ? parts.join(' · ') : 'Empty — compound a run.';
  } catch (e) { return '—'; }
}
function chipText() {
  try {
    const n = PL.ready() ? PL.awaitingWard().length : 0;
    const lines = HS.ready() ? HS.openLines().length : 0;
    return (n ? '📦 ' + n + ' crate' + (n === 1 ? '' : 's') + ' at the door · ' : '') + '🧊 ' + lines + ' cure line' + (lines === 1 ? '' : 's');
  } catch (e) { return ''; }
}

/* ══ STATION INTERACTIONS ══════════════════════════════════════════════════ */

function interact(run) {
  const near = run.near;
  if (!near) return;
  const s = near.station;
  const refusal = gateText(HZ.gate(run.suit, s));
  if (refusal) { HUD.toast(run.nodes, refusal, 'bad'); return; }
  if (s.key === 'scrub') return doScrub(run);
  if (s.key === 'desk') return openDesk(run);
  if (s.key === 'ward') return openWard(run);
  if (s.key === 'vault') return openVault(run);
  if (s.key === 'stock') return openStock(run);
  if (s.key === 'compound') return openCompound(run);
  if (s.key === 'labdoor') return openLabDoor(run);
  if (s.key === 'dock') return openDock(run);
}

/* The hazmat gate speaks lab: "airlock", "hot zone", "suit". Same rule, this
   building's words — a player told to find an airlock in a hospital will not. */
function gateText(refusal) {
  if (!refusal) return refusal;
  return String(refusal).replace(/airlock/g, 'scrub station').replace(/hot zone/g, 'clean room').replace(/Suit up/g, 'Gown up').replace(/suit/g, 'gown');
}

function doScrub(run) {
  if (run.suit.sealed) {
    HZ.doff(run.suit);
    HUD.toast(run.nodes, '🧴 Gown off and binned. Most of what was on it went with it.', 'good');
    return;
  }
  const d = HZ.startDon(run.suit, Date.now());
  if (d) HUD.toast(run.nodes, d.icon + ' ' + d.label + ' — hold still.', '');
}

function openDesk(run) {
  run.panel = 'desk';
  HS.sweep();
  const render = () => HUD.modal(run.nodes, HUD.deskPanel({
    stats: HS.stats(), day: HS.earnedSince(24 * 3600000), week: HS.earnedSince(7 * 24 * 3600000),
    atWard: PL.ready() ? PL.awaitingWard().length : 0, transit: PL.ready() ? PL.inTransit().length : 0,
    openLines: HS.openLines().length, units: HS.shelfUnits(), econ: HS.econ(), sales: HS.sales(),
    ownsResearch: HS.ownsType('research'), ownsMedical: HS.ownsType('medical'), city: cityReport(),
  }), (act) => {
    if (act === 'close') { HUD.closeModal(run.nodes); run.panel = null; return; }
    if (act === 'go-ward') { HUD.closeModal(run.nodes); run.panel = null; return openWard(run); }
    if (act === 'go-lab') { HUD.closeModal(run.nodes); run.panel = null; return goLab(run); }
  });
  render();
}

/* The ward is its own overlay (/src/ward) and it stacks on top of this one:
   same z-index, appended later. Closing it lands the player back here, and
   the vault is swept on the way back so a crate they just administered is a
   line by the time they walk to it. */
function openWard(run) {
  const W = (typeof window !== 'undefined') && window.MythicWard;
  if (!W || typeof W.open !== 'function') { HUD.toast(run.nodes, 'The ward did not load — reload the game.', 'bad'); return; }
  run.done.ward = true;
  run.wardOpen = true;
  try { W.open(); } catch (e) { HUD.toast(run.nodes, 'The ward would not open.', 'bad'); run.wardOpen = false; return; }
}

function openVault(run) {
  run.panel = 'vault';
  HS.sweep();
  run.done.vault = true;
  let sel = null;
  const render = () => HUD.modal(run.nodes, HUD.vaultPanel({ lines: HS.lines(), sel }), (act, id) => {
    if (act === 'close') { HUD.closeModal(run.nodes); run.panel = null; return; }
    if (act === 'pick-line') { sel = id; return render(); }
    if (act === 'discard') {
      if (!sel) return;
      doConfirm('Discard this cure line?\n\nThe samples are incinerated. Nothing can be compounded from it afterwards.', () => {
        if (HS.discardLine(sel)) HUD.toast(run.nodes, '🔥 Line discarded.', '');
        sel = null; render();
      });
    }
  });
  render();
}

/* The counter runs INSIDE the city iframe, so from the game window the
   pharmacy module is reached through the frame (same-origin). Null when the
   city is not open, which the panels state rather than guess around. */
function pharmacyModule() {
  try {
    if (typeof window === 'undefined') return null;
    if (window.MythicPharmacy) return window.MythicPharmacy;
    const f = document.getElementById('node-city-frame');
    const w = f && f.contentWindow;
    return (w && w.MythicPharmacy) || null;
  } catch (e) { return null; }
}
function cityReport() {
  try {
    const P = pharmacyModule();
    if (!P || typeof P.report !== 'function') return null;
    const r = P.report();
    const boost = 1 + Math.min(PH.TUNING.OUTBREAK_BOOST_MAX, (r.ctx.cases | 0) * PH.TUNING.OUTBREAK_BOOST_PER_CASE);
    return { dispensaries: r.ctx.dispensaries.length, ratePerMin: r.ratePerMin, cases: r.ctx.cases | 0, boost, prophylaxis: +r.prophylaxis || 0 };
  } catch (e) { return null; }
}

function openStock(run) {
  run.panel = 'stock';
  run.done.stock = HS.shelfUnits() > 0;
  let sel = null;
  const render = () => HUD.modal(run.nodes, HUD.stockPanel({ stock: HS.stock(), econ: HS.econ(), city: cityReport(), sel }), (act, id) => {
    if (act === 'close') { HUD.closeModal(run.nodes); run.panel = null; return; }
    if (act === 'pick-prod') { sel = id; return render(); }
    if (act === 'recall') {
      const n = HS.recall(sel, 10);
      if (n) HUD.toast(run.nodes, '🔥 ' + n + ' units recalled and destroyed.', '');
      return render();
    }
  });
  render();
}

function have() {
  const out = {};
  const b = B();
  for (const pid of PH.PRODUCT_IDS) for (const id of Object.keys(PH.PRODUCTS[pid].inputs)) { try { out[id] = b.getRes(id) | 0; } catch (e) { out[id] = 0; } }
  return out;
}

function openCompound(run) {
  run.panel = 'compound';
  HS.sweep();
  const sel = run.compoundSel;
  const render = () => {
    const lines = HS.openLines();
    if (lines.length && !lines.find((l) => l.id === sel.lineId)) sel.lineId = lines[0].id;
    HUD.modal(run.nodes, HUD.compoundPanel({ lines, sel, have: have(), econ: HS.econ() }), (act, id, e, el) => {
      if (act === 'close') { HUD.closeModal(run.nodes); run.panel = null; return; }
      if (act === 'pick-line') { sel.lineId = id; return render(); }
      if (act === 'pick-prod') { sel.productId = id; return render(); }
      if (act === 'units=') { sel.units = Math.max(1, parseInt(el.value, 10) || 1); return render(); }
      if (act === 'titrate') return openDial(run);
    });
  };
  render();
  run.compoundRender = render;
}

/* The titration needle — the compounding minigame's one skill input. Driven
   from the frame loop (see frame()), never its own interval. */
function openDial(run) {
  const sel = run.compoundSel;
  const line = HS.lineById(sel.lineId);
  const p = PH.PRODUCTS[sel.productId];
  if (!line || !p) return;
  const units = Math.max(1, Math.min(sel.units | 0, PH.maxUnits(p, line)));
  run.panel = 'dial';
  run.dial = { d: PH.dial(p, line, line.id + ':' + Date.now()), pos: 0, dir: 1, running: true, result: null };
  const render = () => HUD.modal(run.nodes, HUD.dialPanel({ d: run.dial.d, pos: run.dial.pos, running: run.dial.running, result: run.dial.result, product: p, units }), (act) => {
    if (act === 'close') { run.dial = null; run.panel = null; HUD.closeModal(run.nodes); return; }
    if (act === 'dial-stop') {
      if (!run.dial.running) { run.dial.running = true; run.dial.result = null; return render(); }
      run.dial.running = false;
      run.dial.result = PH.titrate(run.dial.d, run.dial.pos);
      return render();
    }
    if (act === 'dial-retry') { run.dial.running = true; run.dial.result = null; return render(); }
    if (act === 'dial-commit') return commit(run, line, p, units, run.dial.result);
  });
  render();
  run.dialRender = render;
}

/* THE COMMIT. Inputs leave the ledger here and nowhere else in the building.
   state.js owns the spend and the refund-on-failure. */
function commit(run, line, p, units, titration) {
  if (!HS.ready()) { HUD.toast(run.nodes, '⚠ The lab is not connected to your ledger — nothing can be compounded. Reload the game.', 'bad'); return; }
  const craft = { titration, exposure: run.suit.exposure, sealed: !!run.suit.sealed };
  const r = HS.compoundRun(line.id, p.id, units, craft);
  if (!r.ok) {
    if (r.why === 'short') HUD.toast(run.nodes, '📉 Short: ' + Object.keys(r.shortfall).map((k) => k + ' ×' + r.shortfall[k]).join(', '), 'bad');
    else HUD.toast(run.nodes, '⚠ ' + (r.error || 'The run failed.'), 'bad');
    return;
  }
  run.dial = null; run.panel = null; HUD.closeModal(run.nodes);
  const res = r.result;
  for (const w of res.warnings) HUD.toast(run.nodes, w, res.spoiled ? 'bad' : 'warn');
  if (res.spoiled) {
    toastGame('☣️ A compounding run failed sterility and was destroyed.', 6000);
  } else {
    run.done.compound = true;
    run.done.stock = true;
    const price = PH.unitPrice(p, res.quality, HS.econ());
    HUD.toast(run.nodes, p.icon + ' ' + res.made + ' × ' + p.name + ' on the shelf — quality ' + Math.round(res.quality * 100) + '%, ~' + price.toLocaleString() + ' 🔥 each at the counter.', 'good');
    toastGame(p.icon + ' ' + res.made + ' ' + p.name + ' compounded. Your clinics will sell them.', 5200);
  }
  if (r.line.status === 'spent') HUD.toast(run.nodes, '🧊 That cure line is spent.', '');
  openCompound(run);
}

/* ── the loading dock ───────────────────────────────────────────────────── */
async function openDock(run) {
  run.panel = 'dock';
  const sel = run.dockSel || (run.dockSel = { sellPid: null, sellUnits: 10, sellAsk: 0, buyId: null, carrierId: null, coldPack: false });
  let board = [], carriers = [], online = HS.online();
  const refresh = async () => {
    await HS.pollWholesale();
    const b = await HS.fetchBoard();
    online = b.online; board = b.rows;
    if (sel.buyId && !board.find((r) => r.id === sel.buyId)) sel.buyId = null;
    const row = board.find((r) => r.id === sel.buyId);
    if (row) {
      const m = await PL.fetchMarket({ doses: row.units, stability: Math.round(row.quality * 100), coldPack: sel.coldPack, distance: 1 });
      carriers = m.carriers;
      if (sel.carrierId && !carriers.find((c) => c.id === sel.carrierId)) sel.carrierId = null;
    } else carriers = [];
  };
  const quoteNow = () => {
    const row = board.find((r) => r.id === sel.buyId);
    const c = carriers.find((x) => x.id === sel.carrierId);
    if (!row || !c) return null;
    const q = HS.quoteLot(row, c, sel.coldPack);
    return Object.assign({ goods: Math.round((row.units | 0) * (+row.ask || 0)) }, q);
  };
  const canSell = (() => {
    if (!HS.online()) return { ok: false, why: 'The wholesale board needs you signed in.' };
    const op = HS.myMedicalOp();
    if (!op) return { ok: false, why: 'No Medical Corporation licence to sell from.' };
    if (!/^[0-9a-fA-F-]{36}$/.test(String(op.id))) return { ok: false, why: 'Wholesale needs a CORP-funded Medical Corporation — a personally-funded one cannot be paid through the ledger.' };
    return { ok: true, why: '' };
  })();
  const render = () => {
    if (!RUN || RUN !== run || run.panel !== 'dock') return;
    HUD.modal(run.nodes, HUD.dockPanel({ stock: HS.stock(), econ: HS.econ(), lots: HS.lots(), orders: HS.orders(), board, sel, carriers, quote: quoteNow(), online, canSell: canSell.ok, why: canSell.why }), async (act, id, e, el) => {
      if (act === 'close') { HUD.closeModal(run.nodes); run.panel = null; return; }
      if (act === 'refresh') { await refresh(); return render(); }
      if (act === 'sell-pick') { sel.sellPid = id; sel.sellAsk = 0; return render(); }
      if (act === 'sell-units') { sel.sellUnits = Math.max(1, parseInt(el.value, 10) || 1); return; }
      if (act === 'sell-ask') { sel.sellAsk = Math.max(1, parseInt(el.value, 10) || 1); return; }
      if (act === 'sell-list') {
        const ask = sel.sellAsk || PH.unitPrice(sel.sellPid, (HS.stock()[sel.sellPid] || {}).quality || 0, HS.econ());
        const r = await HS.listLot(sel.sellPid, sel.sellUnits, ask);
        HUD.toast(run.nodes, r.ok ? '🏷 Listed ' + r.lot.units + ' × ' + PH.PRODUCTS[r.lot.productId].name + ' at ' + r.lot.ask + ' 🔥/unit.' : '⚠ ' + r.error, r.ok ? 'good' : 'bad');
        if (r.ok) sel.sellPid = null;
        return render();
      }
      if (act === 'withdraw') {
        const r = await HS.withdrawLot(id);
        HUD.toast(run.nodes, r.ok ? '↩ Lot withdrawn — the units are back on the shelf.' : '⚠ ' + r.error, r.ok ? '' : 'warn');
        return render();
      }
      if (act === 'buy-pick') { sel.buyId = id; sel.carrierId = null; await refresh(); return render(); }
      if (act === 'buy-carrier') { sel.carrierId = id; return render(); }
      if (act === 'buy-coldpack') { sel.coldPack = !!(el && el.checked); await refresh(); return render(); }
      if (act === 'buy-go') {
        const row = board.find((r) => r.id === sel.buyId);
        const c = carriers.find((x) => x.id === sel.carrierId);
        const r = await HS.buyLot(row, c, sel.coldPack);
        if (!r.ok) { HUD.toast(run.nodes, '⚠ ' + r.error, 'bad'); return render(); }
        run.done.stock = true;
        HUD.toast(run.nodes, '🚚 Bought. ' + c.name + ' is on the road — ' + r.quote.hours + 'h to your dock.', 'good');
        toastGame('🚚 Wholesale lot bought from ' + r.order.sellerName + '. It lands at your Medical Corporation in ' + r.quote.hours + 'h.', 5200);
        sel.buyId = null; sel.carrierId = null;
        await refresh();
        return render();
      }
    });
  };
  HUD.modal(run.nodes, '<h3>🚚 LOADING DOCK</h3><p class="sub">Raising the board…</p>', () => {});
  await refresh();
  render();
}

function openLabDoor(run) {
  run.panel = 'labdoor';
  HUD.modal(run.nodes, HUD.labDoorPanel(HS.ownsType('research')), (act) => {
    if (act === 'close') { HUD.closeModal(run.nodes); run.panel = null; return; }
    if (act === 'go-lab') { HUD.closeModal(run.nodes); run.panel = null; return goLab(run); }
  });
}

function goLab(run) {
  const L = (typeof window !== 'undefined') && window.MythicBioLab;
  if (!L || typeof L.open !== 'function') { HUD.toast(run.nodes, 'The containment lab did not load.', 'bad'); return; }
  const back = run.returnTo;
  close();
  try { L.open(); } catch (e) {}
  // The lab closes back onto whatever was behind it; the hospital reopens
  // itself only if the caller asked for a return route.
  if (back) try { back(); } catch (e) {}
}

function doConfirm(msg, then) {
  try {
    const p = B().confirm(msg);
    if (p && typeof p.then === 'function') { p.then((ok) => { if (ok) then(); }); return; }
    if (p) then();
  } catch (e) { try { if (window.confirm(msg)) then(); } catch (e2) {} }
}

/* ══ THE LOOP ══════════════════════════════════════════════════════════════
   Same two clocks as the lab (see the long note in /src/biolab/index.js):
   `now` is a frame clock for dt, `wall` is what the suit runs on. */
function frame(run, now, wall) {
  const dt = run.lastFrame ? Math.min(100, now - run.lastFrame) : 16;
  run.lastFrame = now;
  const wallNow = wall || Date.now();

  // The ward is a separate overlay on top; while it is up, nothing here moves.
  if (run.wardOpen) {
    const W = (typeof window !== 'undefined') && window.MythicWard;
    if (!(W && W.isOpen && W.isOpen())) { run.wardOpen = false; HS.sweep(); run.chip = chipText(); run.shelfText = shelfText(); }
    else return;
  }

  const modalUp = HUD.modalOpen(run.nodes);
  if (!modalUp) step(run.player, run.input, dt, run.suit.sealed ? SUIT_SPEED : 1, WALK_PLAN);

  const p = run.player;
  run.near = nearest(p.x, p.z, 3.2, STATIONS);
  const atAirlock = !!(run.near && run.near.station.key === 'scrub');
  const hot = inHotZone(p.x, p.z, HOT_Z);

  const evs = HZ.tick(run.suit, dt, { now: wallNow, atAirlock, inHot: hot });
  for (const ev of evs) {
    if (ev.kind === 'seal') HUD.toast(run.nodes, '✅ ' + ev.label + ' — sealed.', 'good');
    else if (ev.kind === 'sealed') HUD.toast(run.nodes, '🥽 GOWNED. The clean room will let you work.', 'good');
    else if (ev.kind === 'interrupted') HUD.toast(run.nodes, '⚠ You walked away mid-seal. That step has to be redone.', 'warn');
    else if (ev.kind === 'breach') HUD.toast(run.nodes, '☣️ YOU ARE IN THE CLEAN ROOM UNGOWNED. Everything you compound is now contaminated.', 'bad');
    else if (ev.kind === 'trackedOut') HUD.toast(run.nodes, '⚠ You left the clean room still gowned. Scrub out next time.', 'warn');
  }
  run.done.scrub = run.suit.everSealed;
  run.blocked = run.near ? gateText(HZ.gate(run.suit, run.near.station)) : null;

  if (run.dial && run.dial.running) {
    run.dial.pos += run.dial.dir * run.dial.d.speed * (dt / 1000);
    if (run.dial.pos >= 1) { run.dial.pos = 1; run.dial.dir = -1; }
    if (run.dial.pos <= 0) { run.dial.pos = 0; run.dial.dir = 1; }
    if (run.dialRender && run.panel === 'dial') run.dialRender();
  }

  // Cheap text, refreshed on a slow beat rather than per frame.
  run.hudAcc = (run.hudAcc || 0) + dt;
  if (run.hudAcc > 1500) { run.hudAcc = 0; run.chip = chipText(); run.shelfText = shelfText(); }

  HUD.refresh(run.nodes, run);
  if (run.scene) { try { run.scene.frame(dt, run); } catch (e) {} }
}

function loop() {
  if (!RUN) return;
  try { frame(RUN, performance.now()); } catch (e) { try { console.warn('[hospital] frame', e); } catch (e2) {} }
  RUN.raf = requestAnimationFrame(loop);
}

/* ══ PUBLIC API ════════════════════════════════════════════════════════════ */

export async function open(opts) {
  const o = opts || {};
  if (RUN) return { ok: true, already: true };
  injectCss();

  const root = document.createElement('div');
  root.className = 'bl-root hp-root';
  document.body.appendChild(root);
  const nodes = HUD.mountHud(root);

  const run = newRun();
  run.root = root; run.nodes = nodes; run.returnTo = typeof o.onClose === 'function' ? o.onClose : null;
  RUN = run;

  try { HS.sweep(); } catch (e) {}
  run.chip = chipText(); run.shelfText = shelfText();

  const THREE = o.flat ? null : await ensureThree();
  if (!RUN || RUN !== run) return { ok: false };
  if (THREE) { try { run.scene = build(THREE, nodes.canvas, PLAN); } catch (e) { run.scene = null; } }
  if (run.scene && run.scene.loadCharacters) {
    run.scene.loadCharacters().then((c) => {
      if (!RUN || RUN !== run) return;
      if (!(c && (c.bare || c.suit))) HUD.toast(nodes, '⚠ ' + ((c && c.why) || 'Character models unavailable') + ' — using the placeholder figure.', 'warn');
    }).catch(() => { if (RUN === run) HUD.toast(nodes, '⚠ Character models failed to load — using the placeholder figure.', 'warn'); });
  }
  if (!run.scene) {
    run.flat = true;
    root.classList.add('is-flat');
    nodes.flatnote.innerHTML = '<div><b style="color:#8fd4c8">THE BUILDING DID NOT LOAD</b><br><br>' +
      'This device could not start WebGL, so the hospital is running without the walk. Every room is still here.<br><br>' +
      STATIONS.map((s) => '<button class="bl-btn" data-jump="' + HUD.esc(s.key) + '" style="margin:3px">' + HUD.esc(s.icon + ' ' + s.name) + '</button>').join('') + '</div>';
    // Teleport, never bypass: the sterile gate still applies in flat mode.
    nodes.flatnote.addEventListener('click', (e) => {
      const b = e.target.closest('[data-jump]'); if (!b) return;
      const s = stationByKey(b.getAttribute('data-jump')); if (!s) return;
      run.player.x = s.pos[0]; run.player.z = s.pos[1] - (s.size[1] / 2 + 1.4);
      run.near = nearest(run.player.x, run.player.z, 3.2, STATIONS);
      interact(run);
    });
  }

  run.detach = attachInput(root, run.input, {
    onInteract: () => { if (!run.wardOpen && !HUD.modalOpen(nodes)) interact(run); },
    onExit: () => { if (run.wardOpen) return; if (HUD.modalOpen(nodes)) { HUD.closeModal(nodes); run.panel = null; run.dial = null; } else close(); },
  });
  root.querySelector('[data-act="exit"]').addEventListener('click', () => close());
  nodes.act.addEventListener('click', () => { if (!run.wardOpen && !HUD.modalOpen(nodes)) interact(run); });
  const onResize = () => { if (run.scene) run.scene.resize(); };
  window.addEventListener('resize', onResize);
  run.onResize = onResize;

  if (!HS.ready()) HUD.toast(nodes, '⚠ Not connected to your ledger — you can walk the building, but nothing here can trade.', 'bad');
  else if (!HS.ownsType('medical')) HUD.toast(nodes, '⚠ No Medical Corporation licence on this account. Found one in Just Business to trade here.', 'warn');
  try {
    const n = PL.ready() ? PL.awaitingWard().length : 0;
    if (n) HUD.toast(nodes, '📦 ' + n + ' crate' + (n === 1 ? '' : 's') + ' at the ward door waiting on a decision.', 'good');
    const lines = HS.openLines().length;
    if (lines) HUD.toast(nodes, '🧊 ' + lines + ' cure line' + (lines === 1 ? '' : 's') + ' in the vault. Gown up and compound.', '');
    else HUD.toast(nodes, '🧊 The vault is empty. Cures arrive by haulier from a Research Facility.', '');
  } catch (e) {}

  run.raf = requestAnimationFrame(loop);
  if (o.at) {
    const s = stationByKey(o.at);
    if (s) { run.player.x = s.pos[0]; run.player.z = s.pos[1] - (s.size[1] / 2 + 1.5); run.near = nearest(run.player.x, run.player.z, 3.2, STATIONS); interact(run); }
  }
  return { ok: true, flat: run.flat };
}

export function close() {
  const run = RUN;
  if (!run) return false;
  RUN = null;
  try { if (run.raf) cancelAnimationFrame(run.raf); } catch (e) {}
  try { if (run.detach) run.detach(); } catch (e) {}
  try { if (run.onResize) window.removeEventListener('resize', run.onResize); } catch (e) {}
  try { if (run.scene) run.scene.dispose(); } catch (e) {}
  try { run.root.remove(); } catch (e) {}
  try { HS.persist(); } catch (e) {}
  if (run.returnTo) { try { run.returnTo(); } catch (e) {} }
  return true;
}

export function isOpen() { return !!RUN; }

const api = {
  open, close, isOpen,
  pharma: PH, state: HS, stations: STATIONS,
  /* The settle poll's hook: book staff-opened crates AND land wholesale
     orders that are due / notice lots that sold. The second half is async and
     best-effort; the first is synchronous and returns as before. */
  sweep: () => { const r = HS.sweep(); try { HS.pollWholesale().catch(() => {}); } catch (e) {} return r; },
  /* 🔬 Test seam, same reason as the lab's: the Browser pane never composites
     so nothing behind requestAnimationFrame is observable without one. */
  _run: () => RUN,
  _step: (ms, wall) => { if (RUN) frame(RUN, (RUN.lastFrame || 0) + (ms || 16), wall); },
  _interact: () => { if (RUN) interact(RUN); },
};

try { if (typeof window !== 'undefined') window.MythicHospital = api; } catch (e) {}
export default api;
