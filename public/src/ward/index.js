/* ══════════════════════════════════════════════════════════════════════════
   🏥 THE WARD — the Medical Corporation's interior. window.MythicWard.
   ──────────────────────────────────────────────────────────────────────────
   The far end of the pipe the containment lab feeds. Crates arrive from
   player-owned hauliers; you decide whether to screen them, who gets the
   doses, and — the call that matters — whether a suspect batch goes into
   people at all.

   🔴 WHY THIS EXISTS. Before it, a lab was a mailbox: paid automatically on
   arrival, no decision, no game. The shipper mixed the cure, shipped it, and
   ate every consequence alone. Splitting arrival from administration
   (/src/plague/state.js) moved the last call here, which means two players can
   each have genuinely acted and each can genuinely blame the other. That is
   the tension a player-run economy is for.

   🔴 THE GLOBALS TRAP (CLAUDE.md). No game global is read here. Everything
   arrives through window.MythicPlagueBridge, which /src/plague/state.js owns.
   Without it the ward opens, shows nothing, and says so.

   ⚠ INERT UNTIL open(). Importing this builds nothing and touches no DOM.
   ══════════════════════════════════════════════════════════════════════════ */

import * as PL from '../plague/state.js';
import * as OB from '../plague/outbreak.js';
import * as TR from './triage.js';
import * as IN from './intake.js';
import * as HUD from './hud.js';

let RUN = null;
let STYLE = null;

function injectCss() {
  try {
    if (STYLE && STYLE.isConnected) return;
    STYLE = document.createElement('style');
    STYLE.id = 'mythic-ward-css';
    STYLE.textContent = HUD.CSS;
    document.head.appendChild(STYLE);
  } catch (e) {}
}

function B() { return PL.bridge(); }
function toastGame(m, ms) { try { B().toast(m, ms || 4200); } catch (e) {} }

/* ── who the patients are ──────────────────────────────────────────────────
   The city builder is a separate page, so its roster is usually not reachable
   from here. When it is not, the ward falls back to the infection records
   themselves: /src/plague owns those, so the beds are real even when the names
   are not. A ward that showed nothing whenever the city was closed would be
   empty almost every time it was opened. */
function roster() {
  try {
    const O = (typeof window !== 'undefined') && window.MythicOutbreak;
    if (O && typeof O._host === 'function') {
      const l = O._host().citizens();
      if (l && l.length) return l;
    }
  } catch (e) {}
  // Synthesise a roster from the infection keys so triage still has rows.
  try {
    const st = PL.outbreakState();
    return Object.keys(st.infections || {}).map((id) => ({ id, name: 'Patient ' + String(id).slice(-4), job: null }));
  } catch (e) { return []; }
}

function cityHost() {
  try {
    const O = (typeof window !== 'undefined') && window.MythicOutbreak;
    if (O && typeof O._host === 'function') return O._host();
  } catch (e) {}
  return { citizens: () => [], vitals: () => ({}), coverage: () => ({}), pop: () => 0, popCap: () => 1, nudge: () => false };
}

function labCutOf(ship) {
  return Math.round((ship.fee | 0) * Math.max(0, Math.min(0.5, +ship.labShare || 0.18)));
}

/* ══ RENDER ════════════════════════════════════════════════════════════════ */

function render() {
  const run = RUN;
  if (!run) return;
  const body = run.root.querySelector('.wd-body');
  const sub = run.root.querySelector('.wd-sub');
  if (!body) return;

  if (!PL.ready()) {
    sub.textContent = '';
    body.innerHTML = '<div class="wd-empty">⚠ The ward is not connected to your ledger. ' +
      'Reload the game — nothing here can be recorded until it is.</div>';
    return;
  }

  return run.view === 'triage' ? renderTriage(body, sub) : renderIntake(body, sub);
}

function renderIntake(body, sub) {
  const run = RUN;
  const crates = PL.awaitingWard();
  sub.textContent = crates.length
    ? crates.length + ' crate' + (crates.length === 1 ? '' : 's') + ' at the door'
    : 'Nothing at the door';

  if (!crates.length) {
    body.innerHTML = '<h2 class="wd-h">Intake</h2>' +
      '<div class="wd-empty">Nothing has arrived. Crates appear here when a haulier finishes a run to a ' +
      'lab you own.<br><br><b>The ward is the far end of the pipe</b> — cures are mixed in the containment ' +
      'lab and shipped by a player-owned Transportation Company. Nothing arrives that somebody did not send.' +
      '</div>' + logHtml();
    return;
  }

  const html = crates.map((s) => {
    const batch = PL.batchById(s.batchId);
    const view = IN.crateView(s, batch, s.screened);
    const opts = IN.options(view, labCutOf(s));
    return HUD.crateHtml(view, opts, run.sel === s.id);
  }).join('');

  body.innerHTML = '<h2 class="wd-h">Intake — ' + crates.length + ' at the door</h2>' + html +
    '<div class="wd-note" style="margin-top:12px">' + HUD.esc(HUD.doseCostNote()) + '</div>' + logHtml();
}

function logHtml() {
  try {
    const done = PL.shipments().filter((s) => s && (s.status === 'administered' || s.status === 'refused')).slice(0, 6);
    if (!done.length) return '';
    return '<h2 class="wd-h">Recent</h2>' + done.map((s) => {
      const r = s.result || {};
      const refused = s.status === 'refused';
      const line = refused
        ? '🔥 Refused — nobody treated, nothing released.'
        : (r.mutantId ? '☣️ A new strain came out of this crate.'
          : r.cleared ? '💉 Strain cleared.'
          : '🩹 ' + (s.treated | 0) + ' treated; the strain ran on.');
      return '<div class="wd-crate"><div class="wd-crate-top"><b>' +
        HUD.esc((PL.batchById(s.batchId) || {}).strainName || 'Unknown isolate') + '</b>' +
        (s.byStaff ? ' <span class="wd-sub">· opened by staff</span>' : '') + '</div>' +
        '<div class="wd-meta">' + HUD.esc(line) + '</div></div>';
    }).join('');
  } catch (e) { return ''; }
}

function renderTriage(body, sub) {
  const run = RUN;
  const ship = PL.awaitingWard().find((s) => s.id === run.sel);
  if (!ship) { run.view = 'intake'; return render(); }

  const batch = PL.batchById(ship.batchId);
  const view = IN.crateView(ship, batch, ship.screened);
  const opts = IN.options(view, labCutOf(ship));
  const list = TR.patients(PL.outbreakState(), roster(), ship.strainId);
  const activeCases = OB.infectedIds(PL.outbreakState(), ship.strainId).length;

  const fitted = TR.fit(list, run.assign, view.doses);
  run.assign = fitted.accepted;
  const price = TR.priceOf(list, run.assign);
  const cov = TR.coverage(activeCases, price.treated);

  sub.textContent = HUD.esc(view.strainName);
  body.innerHTML = HUD.triageHtml({ view, list, assign: run.assign, price, activeCases, cov, opts });
}

/* ══ ACTIONS ═══════════════════════════════════════════════════════════════ */

function onClick(e) {
  const run = RUN;
  if (!run) return;
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.getAttribute('data-act');
  const id = t.getAttribute('data-id');

  if (act === 'exit') return close();
  if (act === 'bench') {
    /* The two halves of the pipe, cross-linked. A medical player who wants to
       make their own cures should not have to go back out to Operations. */
    try {
      if (window.MythicBioLab && typeof window.MythicBioLab.open === 'function') {
        close();
        window.MythicBioLab.open();
        return;
      }
    } catch (err) {}
    HUD.toast(run.root, 'The containment lab did not load.', 'bad');
    return;
  }
  if (act === 'pick') { run.sel = id; return render(); }
  if (act === 'back') { run.view = 'intake'; return render(); }

  if (act === 'screen') {
    const ship = PL.awaitingWard().find((s) => s.id === id);
    if (!ship) return;
    const view = IN.crateView(ship, PL.batchById(ship.batchId), false);
    const r = PL.screenCrate(id, IN.screenCost(view.doses));
    if (!r.ok) { HUD.toast(run.root, '⚠ ' + r.error, 'bad'); return; }
    const after = IN.crateView(ship, PL.batchById(ship.batchId), true);
    HUD.toast(run.root,
      after.arrivedGrade.key === 'iatrogenic'
        ? '☣️ The assay says this is not a cure. Whatever the shipper meant, this crate makes strains.'
        : after.degraded
          ? '🧊 It degraded on the road — ' + after.arrivedGrade.label + ' on arrival, not what was sent.'
          : '🔬 Assay clean — ' + after.arrivedGrade.label + '.',
      after.arrivedGrade.key === 'iatrogenic' ? 'bad' : after.degraded ? 'warn' : 'good');
    return render();
  }

  if (act === 'refuse') {
    const ship = PL.awaitingWard().find((s) => s.id === id);
    if (!ship) return;
    const cut = labCutOf(ship);
    doConfirm(
      'Refuse and incinerate this crate?\n\nNobody is treated and the ward forfeits ' +
      cut.toLocaleString() + ' 🔥 Cinder. Nothing comes out of it.',
      () => {
        const r = PL.refuseCrate(id, 'ward refused');
        if (!r.ok) { HUD.toast(run.root, '⚠ ' + r.error, 'bad'); return; }
        for (const n of r.notes) HUD.toast(run.root, n, '');
        toastGame('🔥 A crate was refused at ' + ship.labName + '. Nobody was treated.', 5200);
        run.view = 'intake'; run.sel = null;
        render();
      });
    return;
  }

  if (act === 'open') {
    run.sel = id;
    run.view = 'triage';
    const ship = PL.awaitingWard().find((s) => s.id === id);
    const view = ship ? IN.crateView(ship, PL.batchById(ship.batchId), ship.screened) : null;
    const list = ship ? TR.patients(PL.outbreakState(), roster(), ship.strainId) : [];
    // Open on the staff plan so the screen is never a blank grid — the player
    // adjusts a real proposal instead of building one from nothing.
    run.assign = view ? TR.defaultPlan(list, view.doses) : [];
    return render();
  }

  if (act === 'bed') {
    const set = new Set(run.assign.map(String));
    if (set.has(String(id))) run.assign = run.assign.filter((x) => String(x) !== String(id));
    else run.assign = run.assign.concat([id]);
    return render();
  }

  if (act === 'plan-critical' || act === 'plan-widest' || act === 'plan-clear') {
    const ship = PL.awaitingWard().find((s) => s.id === run.sel);
    if (!ship) return;
    const view = IN.crateView(ship, PL.batchById(ship.batchId), ship.screened);
    const list = TR.patients(PL.outbreakState(), roster(), ship.strainId);
    run.assign = act === 'plan-clear' ? []
      : act === 'plan-widest' ? TR.widestPlan(list, view.doses)
      : TR.defaultPlan(list, view.doses);
    return render();
  }

  if (act === 'commit') return commit();
}

function commit() {
  const run = RUN;
  const ship = PL.awaitingWard().find((s) => s.id === run.sel);
  if (!ship) { run.view = 'intake'; return render(); }
  const view = IN.crateView(ship, PL.batchById(ship.batchId), ship.screened);

  /* 🔴 THE UNSCREENED WARNING IS THE LAST HONEST MOMENT. A player who opens a
     crate blind should have been told, once, plainly, that they are choosing
     to. Anything less and a mutant reads as the game punishing them for a rule
     nobody stated. */
  const proceed = () => {
    const r = PL.administerBatch(cityHost(), ship.id, run.assign);
    if (!r.ok) { HUD.toast(run.root, '⚠ ' + r.error, 'bad'); return; }
    for (const n of r.notes) HUD.toast(run.root, n, r.mutant ? 'bad' : 'good');
    if (r.medicine) HUD.toast(run.root, '💊 +' + r.medicine + ' Medicine recovered.', 'good');
    for (const n of r.notes) toastGame(n, 6500);
    if (r.mutant) toastGame('☣️ ' + r.mutant.name + ' was released at ' + ship.labName + '.', 9000);
    run.view = 'intake'; run.sel = null; run.assign = [];
    render();
  };

  if (!ship.screened) {
    doConfirm(
      'Administer ' + view.doses + ' unscreened doses?\n\nNobody has read what actually arrived. ' +
      'If the cold chain broke, this is how a new strain gets into the city — and it will be traceable ' +
      'to this ward.',
      proceed);
    return;
  }
  if (view.arrivedGrade.key === 'iatrogenic') {
    doConfirm(
      'The assay says this is NOT a cure.\n\nAdministering it will very likely release a new strain. ' +
      'You have already been paid nothing; refusing costs you the fee and nothing else.\n\nProceed anyway?',
      proceed);
    return;
  }
  proceed();
}

/* Uses the game's own gcConfirm through the bridge when it is there, and falls
   back to the browser's so the ward is never un-usable in a bare test page. */
function doConfirm(msg, then) {
  try {
    const p = B().confirm(msg);
    if (p && typeof p.then === 'function') { p.then((ok) => { if (ok) then(); }); return; }
    if (p) then();
  } catch (e) {
    try { if (window.confirm(msg)) then(); } catch (e2) {}
  }
}

/* ══ PUBLIC API ════════════════════════════════════════════════════════════ */

export function open(opts) {
  if (RUN) return { ok: true, already: true };
  injectCss();
  const o = opts || {};

  const root = document.createElement('div');
  root.className = 'wd-root';
  root.innerHTML = HUD.shell();
  document.body.appendChild(root);

  RUN = { root, view: 'intake', sel: o.shipmentId || null, assign: [] };
  if (RUN.sel) RUN.view = 'triage';

  root.addEventListener('click', onClick);
  const onKey = (e) => { if (e.key === 'Escape') { if (RUN && RUN.view === 'triage') { RUN.view = 'intake'; render(); } else close(); } };
  window.addEventListener('keydown', onKey);
  RUN.onKey = onKey;

  render();

  const n = PL.ready() ? PL.awaitingWard().length : 0;
  if (n) HUD.toast(root, '📦 ' + n + ' crate' + (n === 1 ? '' : 's') + ' waiting on a decision.', '');
  return { ok: true, crates: n };
}

export function close() {
  const run = RUN;
  if (!run) return false;
  RUN = null;
  try { window.removeEventListener('keydown', run.onKey); } catch (e) {}
  try { run.root.removeEventListener('click', onClick); } catch (e) {}
  try { run.root.remove(); } catch (e) {}
  return true;
}

export function isOpen() { return !!RUN; }

const api = {
  open, close, isOpen,
  triage: TR, intake: IN, plague: PL,
  /* 🔬 Test seam. The ward is DOM-driven and this environment's Browser pane
     never composites, so without these nothing here is observable. */
  _run: () => RUN,
  _render: render,
  _click: (act, id) => onClick({ target: { closest: () => ({ getAttribute: (k) => (k === 'data-act' ? act : id) }) } }),
};

try { if (typeof window !== 'undefined') window.MythicWard = api; } catch (e) {}
export default api;
