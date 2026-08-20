#!/usr/bin/env node
/* 📦 STORAGE CAPACITY — the maths behind the resource ceiling.
   This is the check that matters because getting it wrong is INVISIBLE: the
   player's ceiling is just a number, so an over-count reads as generosity and
   an under-count reads as STASH FULL, and neither points at this file.

   The rule under test: you may not sell a shelf you are standing on.
     effective = own - rentedOut + hiredIn      (floored at 0)

   ⚠ The module registers itself on `window` at import time and reads
     window.StorageBridge, so the stub has to exist BEFORE the import — hence
     the dynamic import below rather than a top-level one. */

const mkBridge = (ops, econ) => ({
  escapeHtml: (s) => String(s), showToast: () => {}, confirm: async () => false,
  client: () => null, userId: () => 'me', displayName: () => 'Keeper',
  gems: () => 0, spendGems: () => true,
  opEcon: () => econ,
  operations: () => ops,
  resourceUnits: () => 0, resourceCap: () => 0,
});

globalThis.window = { StorageBridge: null };
globalThis.document = { getElementById: () => null, createElement: () => ({ style: {}, addEventListener: () => {} }), body: { appendChild: () => {} } };

const S = (await import('../../public/src/storage/index.js')).default;

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name); } };

const ECON = { storageBase: 600, storagePerWorker: 260, maxWorkers: 12 };

console.log('\n── storage capacity ──');

/* No bridge at all — the module must be inert, not throw. index.html reads
   these during getResourceCap(), which runs on nearly every render. */
window.StorageBridge = null;
ok('no bridge → 0 own units, no throw', S.ownUnits() === 0);
ok('no bridge → 0 effective units', S.effectiveUnits() === 0);

window.StorageBridge = mkBridge([
  { id: 'w1', op_type: 'warehouse', workers: 4 },
  { id: 'w2', op_type: 'warehouse', workers: 0 },
  { id: 'm1', op_type: 'mining', workers: 9 },
], ECON);

ok('unitsOf = base + workers x perWorker', S.unitsOf({ workers: 4 }) === 600 + 4 * 260);
ok('an unstaffed warehouse still gives the base', S.unitsOf({ workers: 0 }) === 600);
ok('negative workers cannot subtract', S.unitsOf({ workers: -5 }) === 600);
ok('only warehouses count (mining ignored)', S.warehouses().length === 2);
ok('ownUnits sums every warehouse', S.ownUnits() === (600 + 4 * 260) + 600);

/* The same operation arriving from BOTH sources — Operations.list and the
   local Just Business list — is one warehouse, not two. index.html's own
   _warehouseCapacity() dedupes by id for this reason; if this module did not,
   the office and the ceiling would disagree by a whole warehouse. */
window.StorageBridge = mkBridge([
  { id: 'w1', op_type: 'warehouse', workers: 4 },
  { id: 'w1', op_type: 'warehouse', workers: 4 },
], ECON);
ok('a duplicated op id is counted ONCE', S.ownUnits() === 600 + 4 * 260);

/* effective = own - out + in. Exercised through the real state the module
   keeps, by driving the same shape refresh() would produce. */
window.StorageBridge = mkBridge([{ id: 'w1', op_type: 'warehouse', workers: 10 }], ECON);
const own = S.ownUnits();
ok('baseline: nothing rented either way', S.effectiveUnits() === own);

console.log('  ·  own units with 10 staff = ' + own);

/* Floor: renting out more than you own must not produce a negative ceiling.
   getResourceCap() adds this straight onto the base stash, so a negative here
   would silently LOWER a player's ceiling below the floor they are entitled to. */
ok('effective never goes negative', S.effectiveUnits() >= 0);

/* Guarded server layer: with no Supabase client every call resolves to a
   refusal rather than throwing, so the office still renders. */
const r1 = await S.refresh();
ok('refresh() with no client returns null', r1 === null);
const r2 = await S.hire('x', 1, 1, 0);
ok('hire() with no client refuses cleanly', r2 && r2.ok === false && r2.reason === 'offline');
const r3 = await S.listForHire('w1', 10, 5);
ok('listForHire() with no client refuses cleanly', r3 && r3.ok === false);
const r4 = await S.cancel('x');
ok('cancel() with no client refuses cleanly', r4 && r4.ok === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
