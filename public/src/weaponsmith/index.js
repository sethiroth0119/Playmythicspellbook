/* ═══════════════════════════════════════════════════════════════════════════
   🔧 WEAPON SMITH — module entry.

   The operation, its licence and its two raw resources already exist in
   index.html (phase 1). This is the skeleton the bench is built into; it wires
   nothing into gameplay yet ON PURPOSE, so the plumbing can be verified in
   isolation before there is a mini-game riding on it.

   See docs/weaponsmith-design.md for the whole design, and ws.bridge.js for
   why nothing in this folder may touch a bare global.
   ═══════════════════════════════════════════════════════════════════════════ */

import { ready, warnMissing, equipToUnit, getItem } from './ws.bridge.js';
import { ensureWeaponSmith, wsLog, wsSave, wsUnlocked } from './state.js';
import { mintLocal, composeDef, distribute, budgetPoints, SEED_BLUEPRINTS } from './mint.js';

/* A missing bridge disables the Weapon Smith and does nothing else. It must
   never throw: this module is loaded from a plain <script type="module"> tag,
   so an uncaught error here is a console error on every page load for a
   feature the player may not even own. */
if (!ready()) {
  warnMissing('src/weaponsmith/index.js');
} else {
  ensureWeaponSmith();
}

/* 🧪 The probe, in the spirit of __mg.cityMgr and __mg.rez.
   The bench's state is reachable only through a bridge that a module owns, so
   without this there is no way to answer "did the save actually round-trip?"
   from a console — which is precisely the check phase 2 exists to make
   possible. Returns the LIVE object rather than a copy: unlike the ledger
   probes this holds no balance, and being able to poke a field is the point
   while the bench is being built. */
try {
  window.__mg = window.__mg || {};
  window.__mg.weaponSmith = {
    state: () => (ready() ? ensureWeaponSmith() : null),
    unlocked: () => wsUnlocked(),
    log: (m) => { if (!ready()) return false; wsLog('info', m); wsSave(); return true; },
    bridgeReady: () => ready(),
    /* 🔧 The phase-3 end-to-end check, from a console:
         const w = __mg.weaponSmith.mint();          // mint a Field Carbine
         __mg.weaponSmith.equip('goblin', w.id);     // equip it to a unit
       then reload and confirm getItem(w.id) still resolves and the unit still
       holds it. That round-trip is the entire point of this phase — a crafted
       id that fails to resolve renders the slot SILENTLY EMPTY rather than
       erroring, so it has to be checked, never assumed. */
    mint: (q, alloc) => mintLocal('ws_bp_carbine', alloc || { atk: 1 }, (q == null ? 1 : q)),
    equip: (unitId, itemId) => equipToUnit(unitId, itemId),
    item: (itemId) => getItem(itemId),
    blueprints: () => Object.keys(SEED_BLUEPRINTS),
  };
} catch (e) {}

export { ensureWeaponSmith, wsLog, wsSave, wsUnlocked };
export { mintLocal, composeDef, distribute, budgetPoints, SEED_BLUEPRINTS };
