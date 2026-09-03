/* ══════════════════════════════════════════════════════════════════════════
   🦠 PLAGUE — module entry point. Registers window.MythicPlague.
   ──────────────────────────────────────────────────────────────────────────
   The whole disease→cure→ship→administer loop, in one namespace:

     viruses      NPCs in the city builder catch them (outbreak.js)
     cures        mixed from the game's real 14 resources (cures.js)
     mistakes     a bad batch spawns a NEW strain (cures.administer)
     shipping     a player-owned haulier moves it to a player-owned
                  Medical Corporation (logistics.js)

   🔴 IT READS NO GAME GLOBAL. index.html hands over window.MythicPlagueBridge
   (the globals trap, CLAUDE.md). Without the bridge every mutator refuses and
   every reader returns empty — the module registers, stays inert, and says so
   once. It never guesses at `window.Profile`.

   ⚠ INERT UNTIL CALLED. Importing this file starts no timer, opens no socket
   and touches no DOM.
   ══════════════════════════════════════════════════════════════════════════ */

import * as Strains from './strains.js';
import * as Cures from './cures.js';
import * as Outbreak from './outbreak.js';
import * as Logistics from './logistics.js';
import * as State from './state.js';

let WARNED = false;
function warnOnce() {
  if (WARNED || State.ready()) return;
  WARNED = true;
  try {
    console.warn('[plague] window.MythicPlagueBridge is absent — the cure system is inert. ' +
      'index.html must hand the module its capabilities (the globals trap, CLAUDE.md).');
  } catch (e) {}
}

/* ── the shipment sweep ────────────────────────────────────────────────────
   Shipments land on a clock, and the player is usually somewhere else when
   they do. `settleDue()` is the catch-up: it collects everything that has
   arrived, in dispatch order, and returns what happened.

   🔴 IT IS THE ONLY WAY A MUTANT REACHES THE CITY, so it has to be reachable
   from wherever the player actually is — the Operations screen, the city, the
   lab. index.html calls it on the same poll the mayor stipend uses.

   ⚠ ORDER MATTERS AND IS DISPATCH ORDER, not arrival order. Two batches
   aimed at the same strain must resolve in the order the player sent them, or
   "my good batch landed first" stops being true after a reload. */
export function settleDue(host) {
  if (!State.ready()) { warnOnce(); return { ok: false, settled: 0, results: [] }; }
  const h = host || nullHost();
  const due = State.dueShipments().slice().sort((a, b) => (a.dispatchedAt || 0) - (b.dispatchedAt || 0));
  const results = [];
  for (const s of due) {
    try {
      const r = State.collect(h, s.id);
      if (r.ok) results.push(r);
    } catch (e) {}
  }

  /* 🔴 NOTHING MAY STRAND AT THE WARD DOOR. A crate is opened by the player in
     the ward (that is the Medical Corporation minigame), but a player who
     never visits — or who owns no lab at all — must not leave an outbreak
     unresolved forever waiting on a click they are never going to make.

     After WARD_GRACE_MS the ward staff open it on the DEFAULT triage plan,
     which treats the critical first and is deliberately not the optimal play
     (triage.js). So skipping the ward costs you the choice and the better
     outcome; it never costs you the resolution.

     ⚠ The staff plan is computed here rather than in the ward module, because
       /src/plague must not depend on /src/ward — the ward is a consumer of
       this layer. It is the same critical-first ordering, written once more in
       eight lines rather than inverting the dependency. */
  const staffed = [];
  for (const s of State.wardOverdue()) {
    try {
      const r = State.administerBatch(h, s.id, staffPlan(h, s), { byStaff: true });
      if (r.ok) { r.notes.unshift('🛏 Nobody worked the ward, so staff opened the crate on standing orders.'); staffed.push(r); }
    } catch (e) {}
  }

  return { ok: true, settled: results.length, opened: staffed.length, results: results.concat(staffed) };
}

/* Critical first, then longest-ill, until the doses run out. Mirrors
   triage.defaultPlan; see the note in settleDue on why it is not imported. */
function staffPlan(host, ship) {
  try {
    const st = State.outbreakState();
    const roster = (host.citizens && host.citizens()) || [];
    const known = {}; for (const c of roster) if (c && c.id != null) known[String(c.id)] = 1;
    const rows = [];
    for (const id of Object.keys(st.infections || {})) {
      const inf = st.infections[id];
      if (!inf || inf.strainId !== ship.strainId) continue;
      if (inf.stage !== 'symptomatic' && inf.stage !== 'critical') continue;
      if (roster.length && !known[id]) continue;
      rows.push({ id, stage: inf.stage, since: inf.since || 0, cost: inf.stage === 'critical' ? 2 : 1 });
    }
    rows.sort((a, b) => (b.stage === 'critical') - (a.stage === 'critical') || a.since - b.since);
    const budget = Math.max(0, ((ship.result && ship.result.dosesDelivered) | 0));
    const out = []; let spent = 0;
    for (const p of rows) { if (spent + p.cost > budget) continue; out.push(p.id); spent += p.cost; }
    return out;
  } catch (e) { return []; }
}

/* The city if it is in this window, otherwise a host with nobody in it. The
   city builder is a separate page, so the empty case is the NORMAL one when a
   shipment lands on the game's poll.

   🔴 AN EMPTY HOST DOES NOT LOSE THE STRAIN. introduce() queues anything it
   cannot seed (`pending`, in outbreak.js) and it takes hold the first time the
   city ticks with people in it. Nothing is faked and nothing is dropped. */
function nullHost() {
  try {
    const O = (typeof window !== 'undefined') && window.MythicOutbreak;
    if (O && typeof O._host === 'function') return O._host();
  } catch (e) {}
  return { citizens: () => [], vitals: () => ({}), coverage: () => ({}), pop: () => 0, popCap: () => 1, nudge: () => false };
}

/* One-line summary for the Operations screen: what is on the road, what has
   landed, and whether anything needs the player. */
export function status() {
  if (!State.ready()) { warnOnce(); return { ready: false, transit: 0, due: 0, held: 0, strains: 0, worst: null }; }
  const active = State.activeStrains();
  return {
    ready: true,
    transit: State.inTransit().length,
    due: State.dueShipments().length,
    // Crates at the ward door waiting on a decision — the badge the Medical
    // Corporation's tile should carry.
    atWard: State.awaitingWard().length,
    held: State.heldBatches().length,
    strains: active.length,
    worst: active.slice().sort((a, b) => b.severity - a.severity)[0] || null,
    lab: State.labStats(),
  };
}

const api = {
  // Namespaces — pure, testable, no I/O.
  strains: Strains,
  cures: Cures,
  outbreak: Outbreak,
  logistics: Logistics,
  // The stateful layer. Everything that spends, saves or talks to Supabase.
  state: State,
  ready: State.ready,

  // ── the verbs a caller actually wants
  activeStrains: State.activeStrains,
  allStrains: State.strains,
  report: State.cityReport,
  craft: State.craftBatch,
  batches: State.batches,
  heldBatches: State.heldBatches,
  destroyBatch: State.destroyBatch,
  market: State.fetchMarket,
  dispatch: State.dispatch,
  shipments: State.shipments,
  inTransit: State.inTransit,
  dueShipments: State.dueShipments,
  collect: State.collect,
  // 🛏 The ward's verbs — the Medical Corporation's half of the pipe.
  awaitingWard: State.awaitingWard,
  wardOverdue: State.wardOverdue,
  screenCrate: State.screenCrate,
  refuseCrate: State.refuseCrate,
  administerBatch: State.administerBatch,
  claimPayouts: State.claimPayouts,
  settleDue,
  status,
  seedStrain: State.seedStrain,
  describe: Strains.describe,

  /* 🔬 Test seam, same reason every other module in this codebase has one:
     the Browser pane never composites and the accrual is time-based, so
     without a way to inject elapsed time none of this is falsifiable. */
  _resetCache: State.resetCache,
  _blob: () => State.outbreakState(),
};

try { if (typeof window !== 'undefined') window.MythicPlague = api; } catch (e) {}
try { warnOnce(); } catch (e) {}

export default api;
