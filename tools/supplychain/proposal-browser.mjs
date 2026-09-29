#!/usr/bin/env node
/* proposal-browser.mjs — the admin copy / remove payload, run in a REAL browser.

   WHY: proposal-gate.mjs proves the overlay in Node. The round-2 critic pointed out that
   adminCopyPayload had never run in a browser: nobody had shown that proposal.js and its
   generated flux.snapshot.js even IMPORT from the deploy root, or that the staleness check
   works on tables that arrive over the bridge (clones, not the sliced source). There is no
   admin button yet, so this drives the functions directly from a page that has only the
   fake bridge (the fixture cut from index.html) — exactly what the button's handler will have.
   It does NOT prove the button, the clipboard, or a paste into the game: none of those exist.

   Usage: node tools/supplychain/proposal-browser.mjs      (needs Playwright from node_modules)
*/
import { withPage } from './shoot.mjs';

let fails = 0;
await withPage(async (page, t) => {
  await t.goto('/__sc/selftest.html?owns=mining');
  const r = await page.evaluate(async () => {
    const B = window.SupplyChainBridge;
    const dir = '/src/supplychain/';
    const [proposal, tuning, recipes, coverage, catalog, loot, businesses] = await Promise.all(
      ['proposal.js', 'tuning.js', 'recipes.js', 'coverage.js', 'catalog.js', 'loot.js', 'businesses.js'].map((f) => import(dir + f)));
    const data = { recipes, coverage, catalog, loot, businesses };
    const opEcon = (id) => B.opEcon(id);
    const tables = { structureSalvage: B.structureSalvage(), lootResIds: B.lootResIds() };
    const admin = { medical: { inputs: { cloth: 5 } } };
    const report = proposal.adminCopyReport(data, tuning.SC, opEcon, { lootTables: tables });
    const text = proposal.adminCopyPayload(data, tuning.SC, opEcon, admin, { lootTables: tables });
    const parsed = text ? JSON.parse(text) : null;
    const overlay = proposal.buildOpsEconOverlay(data, tuning.SC, opEcon);
    const staleTables = JSON.parse(JSON.stringify(tables)); staleTables.structureSalvage.church.core[0] = 'ritualCandles';
    const ex = proposal.explainOverlay(data, tuning.SC, opEcon);
    return {
      reportOk: report.ok, problems: report.problems,
      hasRecord: !!(parsed && parsed[proposal.OVERLAY_MARKER]),
      adminLineKept: !!(parsed && parsed.medical && parsed.medical.inputs.cloth === 5),
      ops: Object.keys(overlay).length, aimable: ex.stats.aimableLootInputs, inputs: ex.stats.newInputs, shipped: ex.stats.fluxShipped,
      removedBack: !!parsed && proposal.adminRemovePayload(parsed, overlay) === JSON.stringify(admin, null, 2),
      staleRefused: proposal.adminCopyPayload(data, tuning.SC, opEcon, admin, { lootTables: staleTables }) === null,
      /* round 4: fail closed — the short call the next author would type must give nothing */
      noTablesRefused: proposal.adminCopyPayload(data, tuning.SC, opEcon, admin) === null && proposal.adminCopyPayload(data, tuning.SC, opEcon, admin, {}) === null,
      noTablesWhy: proposal.adminCopyReport(data, tuning.SC, opEcon).problems.join(' | '),
      /* round 4: fail closed — the short call the next author would type must give nothing */
      noTablesRefused: proposal.adminCopyPayload(data, tuning.SC, opEcon, admin) === null && proposal.adminCopyPayload(data, tuning.SC, opEcon, admin, {}) === null,
      noTablesWhy: proposal.adminCopyReport(data, tuning.SC, opEcon).problems.join(' | '),
      /* round 4: fail closed — the short call the next author would type must give nothing */
      noTablesRefused: proposal.adminCopyPayload(data, tuning.SC, opEcon, admin) === null && proposal.adminCopyPayload(data, tuning.SC, opEcon, admin, {}) === null,
      noTablesWhy: proposal.adminCopyReport(data, tuning.SC, opEcon).problems.join(' | '),
      bytes: text ? text.length : 0,
    };
  });
  const checks = [
    ['proposal.js + flux.snapshot.js import from the deploy root in Chromium', r.ops > 0],
    ['the shipped measurement matches the loot tables that arrive over the bridge', r.reportOk, (r.problems || []).join(' | ')],
    ['in the browser, as shipped: every business touched, battle-loot needs present', r.ops === 25 && r.aimable > 0 && r.shipped, r.ops + ' ops, ' + r.aimable + ' aimable of ' + r.inputs],
    ['copy payload parses, carries the removal record, keeps the admin\'s own line', r.hasRecord && r.adminLineKept, r.bytes + ' bytes'],
    ['remove payload gives the admin\'s map back exactly', r.removedBack],
    ['a changed loot table arriving over the bridge REFUSES the copy', r.staleRefused],
    ['called WITHOUT the loot tables the copy gives NOTHING, and the report says why', r.noTablesRefused && /not supplied/.test(r.noTablesWhy), r.noTablesWhy],
    ['no page errors', t.errors.length === 0, t.errors.join(' | ')],
  ];
  for (const [n, ok, note] of checks) { console.log((ok ? '  PASS ' : '  FAIL ') + n + (note ? '  [' + note + ']' : '')); if (!ok) fails++; }
}, { w: 800, h: 600 });   // WebGL left on: the selftest page boots three.js and would log an error without it
console.log(fails ? 'FAILS: ' + fails : 'ALL GREEN');
process.exit(fails ? 1 : 0);
