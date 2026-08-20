/* ═══════════════════════════════════════════════════════════════════════════
   🔧 WEAPON SMITH — module entry.

   The operation, its licence and its two raw resources already exist in
   index.html (phase 1). This is the skeleton the bench is built into; it wires
   nothing into gameplay yet ON PURPOSE, so the plumbing can be verified in
   isolation before there is a mini-game riding on it.

   See docs/weaponsmith-design.md for the whole design, and ws.bridge.js for
   why nothing in this folder may touch a bare global.
   ═══════════════════════════════════════════════════════════════════════════ */

import { ready, warnMissing, equipToUnit, getItem, registerItemDefs } from './ws.bridge.js';
import { ensureWeaponSmith, wsLog, wsSave, wsUnlocked } from './state.js';
import { mintLocal, composeDef, distribute, budgetPoints, SEED_BLUEPRINTS } from './mint.js';
import { allItemDefs, CATALOG, DONOR_CATALOG, cleanPart, cleanCost, stripDonor, partDef, isPart, isDonor, TIERS } from './parts.js';
import { BLUEPRINTS, blueprint, blueprintIds, canSeat, checkFit, requiredSlots } from './blueprints.js';
import { startBuild, abandonBuild, seatPart, pullPart, tryFit, scoreBuild, finishBuild, torqueScore } from './bench.gun.js';
import { openBench, closeBench, benchOpen } from './render.js';
import { syncState, mintServer, grantBlueprint, deliverContract, ownsBlueprint, online } from './server.js';
import { SCHEMATICS, schematicCatalog, learnSchematic, dropSchematic, rollSchematic, unlearned, isSchematic, schematicId, blueprintOf } from './schematics.js';
import { forSale, buy as storeBuy, priceOf, AZA_PRICE } from './store.js';

/* A missing bridge disables the Weapon Smith and does nothing else. It must
   never throw: this module is loaded from a plain <script type="module"> tag,
   so an uncaught error here is a console error on every page load for a
   feature the player may not even own. */
if (!ready()) {
  warnMissing('src/weaponsmith/index.js');
} else {
  ensureWeaponSmith();
  /* 🔩 Register the static part + donor catalogue with getItemById. Done at
     load and unconditionally — a part sitting in a player's vault has to
     resolve whether or not they currently hold the licence, or their stash
     would render as blank tiles the moment the op lapsed. */
  registerItemDefs(Object.assign({}, allItemDefs(), schematicCatalog()));
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
    // 🔩 Phase-4 probes: parts are ordinary items, so these all work through
    // the same inventory every other item uses.
    parts: () => Object.keys(CATALOG),
    part: (id) => partDef(id),
    donors: () => Object.keys(DONOR_CATALOG),
    strip: (donorId) => stripDonor(donorId || 'wsd_service'),
    clean: (partIdStr) => cleanPart(partIdStr),
    cleanCost: (partIdStr) => cleanCost(partIdStr),
    /* 🔧 Phase-5 bench probes. The whole loop from a console:
         __mg.weaponSmith.start('ws_bp_carbine')
         __mg.weaponSmith.seat('wsp_receiver_mil_pristine', 0.74)
         ... __mg.weaponSmith.score() ... __mg.weaponSmith.finish() */
    bp: () => blueprintIds(),
    start: (id) => startBuild(id || 'ws_bp_carbine'),
    seat: (partIdStr, torque) => seatPart(partIdStr, torque),
    pull: (slot) => pullPart(slot),
    tryFit: (partIdStr) => tryFit(partIdStr),
    score: () => scoreBuild(ensureWeaponSmith().bench),
    finish: () => finishBuild(),
    abandon: () => abandonBuild(),
    open: () => openBench(),
    close: () => closeBench(),
    // ☁ Phase-6 probes. Each returns null when offline or when sql/038 has not
    // been applied yet, which is the same thing from the client's side.
    sync: () => syncState(),
    online: () => online(),
    grant: (bpId, src) => grantBlueprint(bpId, src || 'loot'),
    deliver: (cId, itemId) => deliverContract(cId, itemId),
    owns: (bpId) => ownsBlueprint(bpId),
    // 📜 Phase-7 probes. drop() grants the ITEM; learn() turns it into the
    // server-side entitlement and consumes it.
    schematics: () => Object.keys(SCHEMATICS),
    drop: (bpId) => dropSchematic(bpId),
    learn: (sid) => learnSchematic(sid),
    unlearned: () => unlearned(),
    /* Ⓐ What the Vendor Market's Blueprints tab calls. Flattened to plain data
       so index.html never has to reach into a blueprint object — the tab
       paints what it is handed and nothing else. */
    storeList: () => forSale().map((r) => ({
      id: r.id, name: r.bp.name, icon: r.bp.icon, blurb: r.bp.blurb,
      tier: r.bp.tier, budget: r.bp.budget, price: r.price, owned: r.owned,
    })),
    storeBuy: (id) => storeBuy(id),
  };
  /* 🔧 The opener index.html calls. A plain window function rather than another
     bridge entry, because the flow is the OTHER direction: the bridge is what
     the module reads FROM the app, and this is what the app calls INTO the
     module. Same shape as window.cityStateLoad and friends. */
  window.openWeaponSmithBench = () => openBench();
  /* 📜 THE LOOT HOOK. Whoever owns a drop table calls this in one line to put a
     blueprint schematic in the player's vault:
         window.wsDropSchematic()               // weighted random
         window.wsDropSchematic('ws_bp_lance')  // a specific frame
     It grants the ITEM only — never the entitlement — so a drop is worth
     exactly what dropped and nothing reaches the server until the player
     chooses to learn it.
     ⚠ Deliberately a hook rather than an edit to the battle reward table:
       that arm lives in battle/encounter code, which CLAUDE.md puts out of
       scope for this feature. This lets the loot owner opt in without the
       Weapon Smith reaching into their system. */
  window.wsDropSchematic = (bpId) => dropSchematic(bpId || rollSchematic());
} catch (e) {}

export { ensureWeaponSmith, wsLog, wsSave, wsUnlocked };
export { mintLocal, composeDef, distribute, budgetPoints, SEED_BLUEPRINTS };
export { CATALOG, DONOR_CATALOG, cleanPart, cleanCost, stripDonor, partDef, isPart, isDonor, TIERS };
export { BLUEPRINTS, blueprint, blueprintIds, canSeat, checkFit, requiredSlots };
export { startBuild, abandonBuild, seatPart, pullPart, tryFit, scoreBuild, finishBuild, torqueScore };
export { openBench, closeBench, benchOpen };
export { syncState, mintServer, grantBlueprint, deliverContract, ownsBlueprint, online };
export { SCHEMATICS, learnSchematic, dropSchematic, rollSchematic, unlearned, isSchematic, schematicId, blueprintOf };
export { forSale, storeBuy, priceOf, AZA_PRICE };
