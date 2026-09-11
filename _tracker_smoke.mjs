/* 🐛 v121v108 — "check the bug checker and fix what is on there".
   1. bug-mtsq62mg  a starved firm can borrow working capital (bank floor +
                    autoBorrow at zero cash with no revenue today).
   2. bug-mtrmi2e5  the workers bottleneck names the labour numbers.
   3. bug-mtu13pzm  qty() never prints 1e-7.
   4. bug-mtuasm4d  the Stadium readiness lists have / need per concession.
   Run: node _tracker_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const BANK = readFileSync('./public/src/economy/bank.js', 'utf8').replace(/\r\n/g, '\n');
const TUN = readFileSync('./public/src/economy/tuning.js', 'utf8').replace(/\r\n/g, '\n');
const BN = readFileSync('./public/src/economy/bottleneck.js', 'utf8').replace(/\r\n/g, '\n');
const DEM = readFileSync('./public/src/hud/demand.js', 'utf8').replace(/\r\n/g, '\n');
const SE = readFileSync('./public/src/city/stadium.economy.js', 'utf8').replace(/\r\n/g, '\n');
const SC = readFileSync('./public/src/city/stadium.city.js', 'utf8').replace(/\r\n/g, '\n');

/* ── 1. the bank lends to a starved firm ── */
ok(/if \(!\(rev > 0\)\) \{ try \{ cap = Math\.max\(cap, Firms\.dailyOperatingCost\(firm\) \* \(ECON\.bank\.startupDays \|\| 5\)\); \} catch \(e\) \{\} \}/.test(BANK) && /startupDays: 5,/.test(TUN), 'creditLimit: a firm with no revenue history gets five days of operating cost');
ok(/const starved = \(firm\.cash \|\| 0\) <= 0 && !\(\(firm\.revenueDay \|\| 0\) > 0\);\n\s*if \(firm\.rung !== 'DEBT' && firm\.rung !== 'DEFAULT' && !starved\) return null;/.test(BANK), 'autoBorrow: DEBT / DEFAULT, or starved (0 cash, no revenue today); breaking even at zero is left alone');
{
  const lim = BANK.slice(BANK.indexOf('export function creditLimit(firm) {'), BANK.indexOf('\n}\n', BANK.indexOf('export function creditLimit(firm) {')) + 3);
  const g = { ECON: { bank: { maxLoanToRevenueDays: 90, startupDays: 5 } }, Firms: { dailyOperatingCost: () => 120 }, Math };
  const fn = new Function('g', 'with (g) { ' + lim.replace('export function', 'function') + ' return creditLimit; }')(g);
  ok(fn({ revenueAvg: 0, debt: 0 }) === 600, 'run for real: never sold, 120 🔥/day to run → 600 🔥 of capacity (was 0)');
  ok(fn({ revenueAvg: 50, debt: 0 }) === 4500, 'a trading firm keeps revenue × 90 days');
  ok(fn({ revenueAvg: 0, debt: 600 }) === 0, 'already borrowed the floor → nothing more');
  const ab = BANK.slice(BANK.indexOf('export function autoBorrow(firm, day) {'), BANK.indexOf('\n}\n', BANK.indexOf('export function autoBorrow(firm, day) {')) + 3);
  const calls = [];
  const g2 = { Firms: { dailyOperatingCost: () => 100 }, borrow: (f, need, day) => { calls.push(need); return { ok: true, amount: need }; } };
  const auto = new Function('g', 'with (g) { ' + ab.replace('export function', 'function') + ' return autoBorrow; }')(g2);
  ok(auto({ rung: 'HEALTHY', cash: 0, revenueDay: 0 }, 5) !== null && calls.length === 1 && calls[0] === 500, 'a HEALTHY firm at 0 cash with no revenue today borrows five days of costs');
  ok(auto({ rung: 'HEALTHY', cash: 0, revenueDay: 40 }, 5) === null && calls.length === 1, 'a firm breaking even at zero (revenue today) does not');
  ok(auto({ rung: 'HEALTHY', cash: 250, revenueDay: 0 }, 5) === null, 'a firm with cash does not');
  ok(auto({ rung: 'DEBT', cash: 30, revenueDay: 10 }, 5) !== null, 'DEBT still borrows as before');
}
ok(/A Bank in the city lends a starved business a few days of working capital automatically; without one it stays stuck here\./.test(BN), 'the Out-of-cash verdict says a Bank is what unsticks it');

/* ── 2. the workers bottleneck carries the numbers ── */
ok(/if \(top\.cause && top\.cause\.key === 'NO_WORKERS'\) \{[\s\S]*?const sn = Sim\.snapshot\(\);[\s\S]*?working-age residents are free to hire/.test(BN), 'primary(): NO_WORKERS prints free / working-age / employed / residents');
{
  const body = BN.slice(BN.indexOf('export function primary() {'), BN.indexOf('\n}\n', BN.indexOf('export function primary() {')) + 3);
  const g = { cityReport: () => [{ name: 'Saw Mill', out: 'planks', cause: { key: 'NO_WORKERS', fix: 'generic' }, bottleneck: { label: 'Workers', pct: 0, key: 'workers' }, efficiency: 0 }],
    Sim: { snapshot: () => ({ laborForce: 213, employed: 207, population: 345 }) }, trace: () => [], Math };
  const p = new Function('g', 'with (g) { ' + body.replace('export function', 'function') + ' return primary(); }')(g);
  ok(/Only 6 of 213 working-age residents are free to hire \(207 already employed; 345 residents in all/.test(p.fix), 'run for real: 345 residents, 213 working-age, 207 employed → "Only 6 of 213 … free to hire"', p.fix);
}

/* ── 3. the tiny basket ── */
ok(/if \(a < 0\.01\) return \(n < 0 \? '-' : ''\) \+ 'under 0\.01';/.test(DEM), 'qty(): anything under a hundredth prints "under 0.01"');
{
  const body = DEM.slice(DEM.indexOf('function qty(v) {'), DEM.indexOf('\n}\n', DEM.indexOf('function qty(v) {')) + 3);
  const qty = new Function(body + ' return qty;')();
  ok(qty(1e-7) === 'under 0.01' && qty(0.04) === '0.04' && qty(3.14) === '3.1' && qty(250) === '250' && qty(0) === '0', 'run for real: 1e-7 → under 0.01; 0.04, 3.1, 250, 0 unchanged');
}

/* ── 4. the stadium readiness ── */
ok(/return \{ have: haveOf, want: wantOf, ratio/.test(SE) && /haveOf\[r\] = have; wantOf\[r\] = want;/.test(SE), 'concessionFulfilment publishes have / want per line');
ok(/have ' \+ fmt\(Math\.floor\(have\)\) \+ ' \/ need ' \+ fmt\(Math\.ceil\(need\)\) \+ \(okLine \? ' ✓' : ' short'\)/.test(SC), 'the readiness table prints each concession line as have / need with ✓ or short');
{
  const g = {};
  const fn = new Function('g', 'with (g) { ' + SE.slice(SE.indexOf('export function concessionFulfilment'), SE.indexOf('\n}\n', SE.indexOf('export function concessionFulfilment')) + 3).replace('export function', 'function') + ' return concessionFulfilment; }');
  let f = null;
  try { f = fn({ num: (v) => Number(v) || 0, clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)), STADIUM_ECON: {}, Math })({ rations: 480, remedies: 90 }, { rations: 812, remedies: 0 }); } catch (e) { f = null; }
  ok(f && f.have.rations === 812 && f.want.rations === 480 && f.have.remedies === 0 && f.short.join() === 'remedies', 'run for real: rations 812 / 480 ✓, remedies 0 / 90 short', f && JSON.stringify(f.short));
}

/* the knobs */
const SRC = readFileSync('./public/index.html', 'utf8');
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 108, 'BUILD_VERSION is v121v108 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
