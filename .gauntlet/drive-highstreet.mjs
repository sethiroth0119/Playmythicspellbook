/* ══════════════════════════════════════════════════════════════════════════
   🏬 DRIVE-HIGHSTREET — does a shop this city can BUILD actually TRADE?

   The commerce round added eight shops to ECO_BUILDING_MAP. Every one passes
   round0b (producible), and four of them land on round0j's DARK list: no city
   tile makes something below them. That list is REPORTED and not asserted,
   because 19 shipped ids were already on it — so passing the economy gate
   proves nothing about whether these shops work.

   🔴 AND THE DARK LIST IS NOT QUITE THE SAME QUESTION. sim.js payUpstream buys
   a missing input from OUTSIDE the city and books it as an import, so it is
   not obvious from the graph alone whether a dark shop starves. It does. The
   reason is availabilityMap(): a firm produces against S.INV, which is LOCAL
   inventory only, so an imported input never lifts availability above zero.
   That is the Card Shop mechanism — a HEALTHY firm, a bottleneck nobody read,
   and zero units printed for its entire shipped life.

   So this drives the real simulation for 180 economic days and measures it.

   WHAT IS ASSERTED vs WHAT IS REPORTED — round0j's own rule. This round is
   responsible for WIRING: a shop must found a firm of the mapped industry and
   must not break the closed loop. It is NOT responsible for the city's missing
   chemical tier, which predates it and darkens 19 shipped ids too. So the
   supply state is printed, loudly, rather than turned into a red nobody can
   clear.

   THE CONTROLS ARE THE POINT:
     · POSITIVE — the shipped Grocery, on a bootstrap-seeded chain. Without it,
       "earned 0" has no scale and might only mean the driver never ran a day.
     · NEGATIVE — a shop wired to researchEquipment, which nothing here makes.

   ⚠ THE NEGATIVE CONTROL IS A SCALE, NOT A ZERO, AND THAT IS A MEASURED
     CORRECTION TO THIS FILE. It was written expecting exactly 0 and measured
     782.9 against the Grocery's 114,216: retail and service firms take a share
     of the sales-tax and service-credit passes whether or not they produced a
     single unit. "Earned something" therefore cannot separate trading from
     starving, and an assertion written that way would have been a green that
     meant nothing. Two orders of magnitude is the separation that is real.

   Run:  node .gauntlet/drive-highstreet.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'fs';

/* The economy modules expect a browser-ish global. Same shim the economy gate
   uses (tools/economy-tests/run.mjs:773) — not invented here. */
if (!global.window) {
  global.window = { MythicCityBridge: { addCinders: async () => true }, MythicResourceChain: null };
  const chain = await import('../public/src/resources/chain.js');
  global.window.MythicResourceChain = { ALL: chain.RESOURCE_CHAIN };
}

const P = '../public/src/economy/';
const E = (await import(P + 'index.js')).default;
const { ECON } = await import(P + 'tuning.js');
const DAY = ECON.clock.dayMin;

/* Read the SHIPPED map out of node-city rather than restating it. A driver that
   carries its own copy of the table is testing its own copy. */
const nc = readFileSync(new URL('../public/node-city/index.html', import.meta.url), 'utf8');
const seg = nc.slice(nc.indexOf('const ECO_BUILDING_MAP = {'));
const MAP = {};
const ROW = /^\s{2}(\w+):\s*\{\s*out:\s*\[([^\]]*)\][^}]*ind:\s*'(\w+)'/gm;
for (const m of seg.slice(0, seg.indexOf('\n};')).matchAll(ROW)) {
  MAP[m[1]] = { out: [...m[2].matchAll(/'([^']+)'/g)].map((q) => q[1]), ind: m[3] };
}

const NEW = ['clothier', 'greatbuy', 'pharmacy', 'furnistore', 'gamestore', 'cinema', 'fastfood', 'weaponshop'];
let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail));
};

console.log('0. the map under test is the SHIPPED map');
ok('ECO_BUILDING_MAP parsed out of node-city', Object.keys(MAP).length > 30, Object.keys(MAP).length + ' rows');
for (const t of NEW) ok('  ' + t + ' is in it', !!MAP[t], MAP[t] ? MAP[t].out + ' / ' + MAP[t].ind : 'MISSING');

/* A node with a broad endowment, so a starving shop is starving on its CHAIN
   and not on this particular patch of ground. */
let node = null;
for (let i = 0; i < 60 && !node; i++) {
  const id = 'hs-' + i;
  E.mount({ nodeId: id, population: 120 });
  if (E.canBuild('cotton') && E.canBuild('ironOre')) node = id;
}
node = node || 'hs-0';
E.mount({ nodeId: node, population: 120 });
console.log('\n   node: ' + node + '  (cotton + ironOre in the ground, so the honest chains have a root)');

/* A city that has been BUILT OUT, so a shop is tested against every producer
   the catalogue can currently offer it rather than against an empty map. */
const SUPPORT = ['farm', 'hydrofarm', 'purifier', 'powerstation', 'scrapmine', 'fuelrig',
                 'lumbercamp', 'quarry', 'fibercroft', 'sawmill', 'weavery', 'smelter',
                 'cannery', 'machineshop', 'munitions', 'medlab', 'depot', 'warehouse',
                 'papermill', 'printworks', 'housing', 'housing', 'housing', 'grocery'];

const tiles = {};
let n = 0;
for (const t of SUPPORT) tiles['s' + (n++)] = { type: t, lvl: 2 };
for (const t of NEW) tiles['x' + t] = { type: t, lvl: 1 };
tiles.zctrl = { type: '__impossible__', lvl: 1 };
MAP.__impossible__ = { out: ['researchEquipment'], ind: 'distributor' };

const list = () => Object.entries(tiles).map(([key, t]) => {
  const row = MAP[t.type];
  if (!row) return null;
  const o = E.pickAvailable(row.out);
  return o ? { key, out: o, ind: row.ind, lvl: t.lvl } : null;
}).filter(Boolean);

const host = { powerFactor: 1, waterFactor: 1, logisticsCounts: { warehouse: 4, depot: 3 },
               hasBank: true, infrastructure: 0.8 };

E.syncBuildings(list());
const DAYS = 180;
for (let d = 0; d < DAYS; d++) { E.tick(DAY, host); if (d % 30 === 0) E.syncBuildings(list()); }
E.syncBuildings(list());

const firmAt = (k) => E.firms().find((f) => f.tileKey === k) || null;
const read = (key) => {
  const f = firmAt(key);
  if (!f) return { missing: true };
  const w = f.workers || {};
  const bn = f.lastBottleneck;
  return { out: f.out, ind: f.ind, rung: f.rung, rev: +(f.lifetimeRevenue || 0),
           staff: (w.unskilled | 0) + (w.skilled | 0) + (w.technical | 0) + (w.advanced | 0),
           bn: (bn && typeof bn === 'object') ? (bn.id || bn.res || JSON.stringify(bn)) : bn };
};

console.log('\n1. after ' + DAYS + ' economic days');
console.log('   ' + 'shop'.padEnd(14) + 'out'.padEnd(18) + 'staff'.padEnd(7) + 'revenue'.padEnd(13) + 'rung'.padEnd(10) + 'bottleneck');
const results = {};
for (const t of NEW.concat(['__impossible__'])) {
  const key = t === '__impossible__' ? 'zctrl' : 'x' + t;
  const r = read(key);
  results[t] = r;
  if (r.missing) { console.log('   ' + t.padEnd(14) + '- NO FIRM FOUNDED -'); continue; }
  console.log('   ' + t.padEnd(14) + String(r.out).padEnd(18) + String(r.staff).padEnd(7) +
              r.rev.toFixed(1).padEnd(13) + String(r.rung).padEnd(10) + (r.bn || '-'));
}
const gKey = Object.keys(tiles).find((k) => tiles[k].type === 'grocery');
const ctrl = read(gKey);
console.log('   ' + 'grocery*'.padEnd(14) + String(ctrl.out || '-').padEnd(18) + String(ctrl.staff || 0).padEnd(7) +
            (ctrl.rev || 0).toFixed(1).padEnd(13) + String(ctrl.rung || '-').padEnd(10) + (ctrl.bn || '-') + '   <- positive control');

console.log('\n2. the controls — if either fails, nothing below is evidence');
const imp = results.__impossible__;
ok('POSITIVE: the shipped Grocery traded (a shop CAN work in this city)',
   !ctrl.missing && (ctrl.rev || 0) > 0, ctrl.missing ? 'no firm' : ctrl.rev.toFixed(1) + ' cinder');
const FLOOR = (ctrl.rev || 0) * 0.02;
ok('NEGATIVE: the impossible shop stayed under 2% of the working shop',
   !imp.missing && (imp.rev || 0) < FLOOR,
   (imp.rev || 0).toFixed(1) + ' vs a floor of ' + FLOOR.toFixed(1));

console.log('\n3. the wiring — what THIS round is responsible for');
for (const t of NEW) {
  const r = results[t];
  ok(t + ' founded a firm of the mapped industry',
     !r.missing && r.ind === MAP[t].ind, r.missing ? 'NO FIRM' : r.ind);
  if (!r.missing) ok('  ...and it is not bankrupt', r.rung !== 'BANKRUPT', String(r.rung));
}

console.log('\n4. REPORTED, not asserted — which shops can actually be supplied');
const trading = NEW.filter((t) => !results[t].missing && results[t].rev >= FLOOR);
const blocked = NEW.filter((t) => !trading.includes(t));
console.log('   trading now   : ' + (trading.join(', ') || '- none -'));
console.log('   supply-blocked: ' + (blocked.join(', ') || '- none -'));
console.log('   A blocked shop still hires, still gives node-city coverage and still pays');
console.log('   tile income; what it cannot do is stock its shelves. The shipped Club and');
console.log('   Arena have been in exactly this state since they landed (beverages and');
console.log('   sportingGoods are both on the shipped dark list). The fix is a chemical /');
console.log('   materials tier, modelled at 14 producer buildings, which lights clothing,');
console.log('   furniture and beverages and takes the dark list from 23 down to 16.');

const sn = E.snapshot();
const audit = sn.lastAudit || sn.audit || (sn.sim && sn.sim.lastAudit) || null;
console.log('\n5. the closed loop survived all of it');
ok('the Cinder audit still balances', !!(audit && audit.ok),
   audit ? 'err=' + Number(audit.err || 0).toExponential(2) : 'snapshot exposes no audit record');

console.log(fails ? '\n' + fails + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
