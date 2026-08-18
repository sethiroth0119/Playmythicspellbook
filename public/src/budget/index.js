/* ════════════════════════════════════════════════════════════════════════════
   💰 THE CITY BUDGET — module entry point. Registers window.MythicBudget.
   ----------------------------------------------------------------------------
   Two tabs onto the city's books: BUDGET (where the treasury's money came from
   and went) and TAXATION (what the city charges, and on what).

   🔴 READ-ONLY, AND STRUCTURALLY SO. This module imports nothing that can
   write. It reads `window.MythicEconomy.snapshot()` and `.ECON`, and it holds
   exactly two pieces of state of its own: which row the player clicked, and the
   running reconciliation. There is no path from here to a ledger, a treasury,
   a firm or a household — not because it is careful, but because it never asks
   for one. ECONOMY.md documents four money leaks found during development and
   every one of them looked correct in review; the way a new panel avoids being
   the fifth is by having nothing to leak.

   🔴 THE GLOBALS TRAP (CLAUDE.md). `Profile`, `Cloud`, `App`, `Corp`, `Forge`,
   and node-city's own `game` / `BUILDINGS`, are top-level `const` bindings and
   are NOT on `window`. Nothing here reaches for one. `window.MythicEconomy` is
   a real `window` property (index.js sets it) and is the only global this file
   touches — read at CALL time, never captured, because a panel is drawn long
   after boot and the economy can mount, defer and remount underneath it.

   ⚠ IF /src/economy IS ABSENT this panel says so in a sentence and costs the
     player two tabs. The host's guard already turns a 404 here into a warning;
     between them, a missing module is never a blank card.
   ════════════════════════════════════════════════════════════════════════════ */

import { buildModel, taxModel, newReconciler, sample } from './model.js';
import { BUDGET_CSS, renderBudget, renderTax } from './render.js';

const E = () => (typeof window !== 'undefined' ? window.MythicEconomy : null) || null;

/* Selection state, per tab. Two fields and both are SELECTION, never a figure
   this module derived — the same line /src/economy's own panel draws around
   `ecoTrace` and `ecoSaid` in node-city. */
let selBudget = null;
let selTax = null;

/* The running check. See model.js `newReconciler` for what a window is. */
let rec = newReconciler();

/* 🔍 SAMPLED ON EVERY RENDER, AND THAT IS THE WHOLE SCHEDULE. The host repaints
   the economy card on a 4 s timer, so the panel takes a reading every 4 s while
   it is being looked at and none at all while it is not. That is deliberate:
   the check is a statement about readings this panel actually took, and a
   background sampler would make it a statement about a period the player never
   saw. It also means the window count starts at zero on a reload, which is
   correct — the reconciliation is not persisted, because a residual carried
   across a reload could not name which day it came from. */
function currentModel() {
  const eco = E();
  if (!eco || typeof eco.snapshot !== 'function') return { absent: true };
  /* ⚠ THREE STATES, NOT TWO, AND THE PLAYER IS TOLD WHICH. "The module is not
     there", "it is there and waiting to be told whether this city already
     exists", and "it is running" are three different situations with three
     different things to do about them, and a panel that prints the same
     sentence for all three teaches the player that the sentence means nothing.
     /src/economy's own card already makes exactly this distinction between
     `ready()` and `deferred()`. */
  if (typeof eco.deferred === 'function' && eco.deferred()) return { deferred: true };
  if (typeof eco.ready === 'function' && !eco.ready()) return { waiting: true };
  const snap = eco.snapshot();
  if (!snap) return { waiting: true };
  const m = buildModel(snap);
  if (m) sample(rec, snap, m);
  return m;
}

function stalled(m) {
  const msg = (m && m.deferred)
    ? 'The economy has not started yet — it is waiting to find out whether this city already ' +
      'existed before it issues any capital. The City tab has the retry.'
    : (m && m.waiting)
      ? 'The economy is mounted but has not run a day yet, so there is nothing in the books to show.'
      : 'The economy module has not loaded, so the city cannot open its books. Everything else ' +
        'works normally.';
  return '<div class="bud"><div class="bud-empty">' + msg + '</div></div>';
}

const api = {
  css: BUDGET_CSS,

  /* The two tabs. Each returns an HTML STRING; the host owns the DOM. */
  renderBudget() {
    const m = currentModel();
    if (!m || !m.totals) return stalled(m);
    return renderBudget(m, rec, selBudget);
  },
  /* ⚠ THE RATES DO NOT NEED A RUNNING CITY. `ECON` is the tuning table itself,
     so this tab answers even while the economy is deferred — which is when a
     player is most likely to be looking for a reason. */
  renderTax() {
    const eco = E();
    const tm = eco && eco.ECON ? taxModel(eco.ECON) : null;
    if (!tm) return stalled(eco ? { waiting: true } : { absent: true });
    return renderTax(tm, selTax);
  },

  /* One click handler for both tabs. Clicking the selected row clears it, so a
     player can always get back to the "pick a line" state without a second
     control. Returns true when the host should repaint. */
  select(tab, id) {
    const v = id == null ? null : String(id);
    if (tab === 'tax') { selTax = (selTax === v) ? null : v; return true; }
    selBudget = (selBudget === v) ? null : v; return true;
  },
  selected(tab) { return tab === 'tax' ? selTax : selBudget; },

  /* Exposed so a driver can read the check without screen-scraping the panel,
     and so a future gate can assert on it. A COPY — handing out the live object
     is the shape of a bug this codebase has already paid for on the card seam. */
  reconciliation() { return { ...rec, prev: undefined }; },

  /* The model itself, for tools. Same reasoning as the economy's own `audit()`
     being public: a claim nobody can check is a claim. */
  model() { const m = currentModel(); return (m && m.totals) ? m : null; },

  /* 🔄 Called by the host when a different city is loaded. The reconciliation
     is a statement about ONE city's treasury and must not follow the player
     into the next one — the same reasoning sim.js `reset()` gives for clearing
     the utility link's arrears. */
  reset() { rec = newReconciler(); selBudget = null; selTax = null; return true; },
};

try {
  if (typeof window !== 'undefined') window.MythicBudget = api;
} catch (e) {}

export default api;
