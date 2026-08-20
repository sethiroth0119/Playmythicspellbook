/* ═══════════════════════════════════════════════════════════════════════════
   🔧 WEAPON SMITH — module entry.

   The operation, its licence and its two raw resources already exist in
   index.html (phase 1). This is the skeleton the bench is built into; it wires
   nothing into gameplay yet ON PURPOSE, so the plumbing can be verified in
   isolation before there is a mini-game riding on it.

   See docs/weaponsmith-design.md for the whole design, and ws.bridge.js for
   why nothing in this folder may touch a bare global.
   ═══════════════════════════════════════════════════════════════════════════ */

import { ready, warnMissing } from './ws.bridge.js';
import { ensureWeaponSmith, wsLog, wsSave, wsUnlocked } from './state.js';

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
  };
} catch (e) {}

export { ensureWeaponSmith, wsLog, wsSave, wsUnlocked };
