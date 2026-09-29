/* ══════════════════════════════════════════════════════════════════════════
   🏭 DRIVE-BOOTSTRAP — does a deep chain actually run end to end?

   ⚠ READ THIS BEFORE "FIXING THE DEMAND FORECAST". This file started life as
   the A/B for a `derivedDemand` bootstrap in sim.js — a pass that walked
   topoOrder() in reverse and pulled each stage's plan back through its input
   coefficients, to fix a chain that supposedly could not start itself. That
   change was written, measured, and REVERTED, and the reason is the whole
   value of this file:

   🔴 THE DEFECT IT WAS FIXING DID NOT EXIST. IT WAS AN INSTRUMENT ARTEFACT.
   The claim was "a Refinery with fill 1.00, avail 1.00 and no bottleneck
   produced ZERO over 400 days" (see .gauntlet/drive-highstreet.mjs, which
   still reports it). Every driver that measured it read `f.lifetimeProduced
   || f.lastProduced` — and firms.js HAS NO lifetimeProduced FIELD. It only
   carries lifetimeRevenue and lifetimeProfit. So every "400-day total" was
   silently ONE DAY'S RATE, and production is lumpy: a stage that made nothing
   on the final tick reads as a stage that never ran.

   Summing per tick instead, the control — the shipped code, no bootstrap —
   makes 73,887 clothing over 400 days through eight stages. The chain was
   never dead. What HAD been missing was the materials tier itself (the
   buildings), and that shipped in v121d4.

   🔴 AND THE "FIX" WAS ACTIVELY HARMFUL, which is the second reason to leave
   this note. Because base[] carries the warm-up seed (a full nameplate for
   any id nobody has bought yet), pulling it down the chain ordered ~94/day of
   printedCards against the 1.95/day the card shop could sell. plannedRate is
   a firm's share of want and headcount is sized off plannedRate, so the print
   works hired a crew for the 94, sold the 1.95 and went bankrupt: gauntlet3's
   `printedCards` went from cap 52 and alive to cap 0 and gone. That is
   runProduction's own step-3 warning — "healthy businesses starved to death
   holding enormous unsellable stock" — re-created by the cure.

   So: measure cumulatively, and be suspicious of any zero that comes from a
   single frame. The same trap is recorded in CLAUDE.md for the WebGL A/B.

   WHAT THIS FILE ASSERTS NOW: the clothing chain — rawWater and crudeOil in
   the ground, up through eight stages to a shirt — produces at EVERY stage,
   and the closed Cinder loop survives it.

   Run:  node .gauntlet/drive-bootstrap.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

if (!global.window) {
  global.window = { MythicCityBridge: { addCinders: async () => true }, MythicResourceChain: null };
  const chain = await import('../public/src/resources/chain.js');
  global.window.MythicResourceChain = { ALL: chain.RESOURCE_CHAIN };
}

const NC = path.resolve(process.cwd(), 'public/node-city/index.html');

const MAP = (() => {
  const nc = readFileSync(NC, 'utf8');
  const s0 = nc.indexOf('const ECO_BUILDING_MAP = {');
  const seg = nc.slice(s0, nc.indexOf('\n};', s0));
  const m = {};
  for (const r of seg.matchAll(/^\s{2}(\w+):\s*\{\s*out:\s*\[([^\]]*)\][^}]*ind:\s*'(\w+)'/gm)) {
    m[r[1]] = { out: [...r[2].matchAll(/'([^']+)'/g)].map((q) => q[1]), ind: r[3] };
  }
  return m;
})();

/* The clothing chain end to end, plus the support a city needs to run at all. */
const CITY = ['waterintake', 'fuelrig', 'fibercroft', 'farm', 'purifier', 'powerstation',
              'housing', 'housing', 'housing', 'grocery', 'depot', 'warehouse',
              'procwater', 'refinery', 'feedplant', 'chemworks', 'fiberplant',
              'weavery', 'clothier'];
const WATCH = ['industrialWater', 'petrochemicals', 'chemicalFeedstock',
               'industrialChemicals', 'syntheticFiber', 'fabric', 'clothing'];
const DAYS = 400;

const url = pathToFileURL(path.resolve(process.cwd(), 'public/src/economy/index.js')).href;
const E = (await import(url)).default;
const { ECON } = await import(pathToFileURL(path.resolve(process.cwd(), 'public/src/economy/tuning.js')).href);
const DAY = ECON.clock.dayMin;

let node = null;
for (let i = 0; i < 70 && !node; i++) {
  const id = 'bs-' + i;
  E.mount({ nodeId: id, population: 260 });
  if (E.canBuild('cotton') && E.canBuild('crudeOil') && E.canBuild('rawWater')) node = id;
}
node = node || 'bs-0';
E.mount({ nodeId: node, population: 260 });

const tiles = {};
let n = 0;
for (const t of CITY) tiles['t' + (n++)] = { type: t, lvl: 2 };
const list = () => Object.entries(tiles).map(([key, t]) => {
  const row = MAP[t.type];
  if (!row) return null;
  const o = E.pickAvailable(row.out);
  return o ? { key, out: o, ind: row.ind, lvl: t.lvl } : null;
}).filter(Boolean);

const host = { powerFactor: 1, waterFactor: 1, logisticsCounts: { warehouse: 4, depot: 3 },
               hasBank: true, infrastructure: 0.8 };

/* 🔴 ACCUMULATE PER TICK. Reading the final day and calling it a total is the
   exact error documented in the header — do not "simplify" this back. */
const made = {};
const days = {};
E.syncBuildings(list());
for (let d = 0; d < DAYS; d++) {
  E.tick(DAY, host);
  for (const f of E.firms()) {
    if (!WATCH.includes(f.out)) continue;
    const u = f.lastProduced || 0;
    made[f.out] = (made[f.out] || 0) + u;
    if (u > 0) days[f.out] = (days[f.out] || 0) + 1;
  }
  if (d % 40 === 0) E.syncBuildings(list());
}
E.syncBuildings(list());

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail));
};

console.log('the clothing chain over ' + DAYS + ' days — units made, and days it ran');
for (const id of WATCH) {
  console.log('   ' + id.padEnd(22) + String(Math.round(made[id] || 0)).padStart(9) +
              '   on ' + String(days[id] || 0).padStart(3) + '/' + DAYS + ' days');
}

console.log('\nthe claim — every stage runs, including the two that read as dead on a one-day sample');
for (const id of WATCH) {
  ok(id + ' produced', (made[id] || 0) > 0, Math.round(made[id] || 0) + ' units');
}
/* The two that a final-frame read reported as zero. Named, because they are the
   specific evidence that the reverted bootstrap was solving nothing. */
ok('chemicalFeedstock ran on most days (a lumpy stage is not a dead one)',
   (days.chemicalFeedstock || 0) > DAYS * 0.5,
   (days.chemicalFeedstock || 0) + '/' + DAYS + ' days');
ok('clothing — the product a shop sells — actually exists',
   (made.clothing || 0) > 1000, Math.round(made.clothing || 0) + ' units');

const sn = E.snapshot();
const audit = sn.lastAudit || sn.audit || null;
console.log('\nthe closed loop survived it');
ok('the Cinder audit balances', !!(audit && audit.ok),
   audit ? 'err=' + Number(audit.err || 0).toExponential(2) : 'no audit record');

console.log(fails ? '\n' + fails + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
