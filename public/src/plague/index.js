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
  const due = State.dueShipments().slice().sort((a, b) => (a.dispatchedAt || 0) - (b.dispatchedAt || 0));
  const results = [];
  for (const s of due) {
    try {
      const r = State.collect(host || nullHost(), s.id);
      if (r.ok) results.push(r);
    } catch (e) {}
  }
  return { ok: true, settled: results.length, results };
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
