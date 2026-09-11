/* 💸 THE HOUSEHOLD WAGE POOL — NPC wages stop vanishing and start shopping.

   Reported: "Employee Wages Not Reaching Employee Accounts" — 107,050 🔥 of
   op_salary left four businesses in one cycle and no account gained it. That
   was true and nothing was leaking: op_salary was a pure sink (the treasury
   row was the whole event) and patronage, the retail layer, MINTED every
   Cinder the residents spent. The two were about the same NPCs and never met.

   THE INVARIANTS, driven not read:
     · a settle credits the pool with the wages ACTUALLY paid, less the leak;
     · the leak is inside the 25–35% band the design asked for;
     · the pool can only REPLACE minted patronage, never add to it — the
       player's takings for a tick are identical with and without a pool;
     · a draw never exceeds the balance, never goes negative, and a failing or
       absent parent means "mint it all" (the pre-pool behaviour);
     · the cloud merge is newest-stamp-wins, never a union (it is a balance).

   Run: node _wagepool_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
const NC = readFileSync('./public/node-city/index.html', 'utf8');

/* ── 1. the pool, lifted from index.html and driven ─────────────────────── */
const b = SRC.indexOf('/* WAGEPOOL:BEGIN'), e = SRC.indexOf('/* WAGEPOOL:END */');
ok(b > 0 && e > b, 'the pool block exists between its markers');
const POOL = SRC.slice(b, e);
function mkPool(profile) {
  const ctx = { Profile: profile, window: {}, saves: 0, saveProfile() { ctx.saves++; }, Date, Number, Math, Object };
  vm.createContext(ctx);
  vm.runInContext(POOL + '\nthis.credit = _wagePoolCredit; this.state = _wagePoolState; this.LEAK = WAGE_POOL_LEAK;', ctx);
  return ctx;
}
{
  const c = mkPool({});
  ok(c.LEAK >= 0.25 && c.LEAK <= 0.35, 'the leak sits in the 25–35% band', c.LEAK);
  const kept = c.credit(107050, 'test');
  const w = c.state();
  ok(kept === Math.floor(107050 * (1 - c.LEAK)), 'a settle keeps wages × (1 − leak)', kept);
  ok(w.paid === 107050 && w.leaked === 107050 - kept && w.bal === kept, 'paid / leaked / bal reconcile to the unit');
  ok(c.saves === 1, 'a credit saves the profile once');
  ok(c.credit(0) === 0 && c.credit(-5) === 0 && c.credit(NaN) === 0 && c.state().paid === 107050, 'zero, negative and NaN credit nothing');
  const draw = c.window.cityWagePoolDraw;
  ok(typeof draw === 'function', 'the city seam is on window');
  const t1 = draw(1000);
  ok(t1 === 1000 && c.state().bal === kept - 1000, 'a draw within the balance takes exactly what was asked');
  const t2 = draw(1e9);
  ok(t2 === kept - 1000 && c.state().bal === 0, 'a draw beyond the balance takes the balance and no more');
  ok(draw(50) === 0 && c.state().bal === 0, 'an empty pool draws zero, never negative');
  ok(c.state().spent === kept, 'spent reconciles with what was drawn');
  ok(draw(-1) === 0 && draw('x') === 0, 'bad input draws nothing');
  const peek = c.window.cityWagePoolPeek();
  ok(peek && peek.leak === c.LEAK && peek.bal === 0, 'peek reports the leak and the balance');
}
{
  /* A corrupt profile field is repaired, not trusted. */
  const c = mkPool({ wagePool: { bal: -40, paid: 'x' } });
  const w = c.state();
  ok(w.bal === 0 && w.paid === 0, 'a negative or non-numeric pool field is reset');
}

/* ── 2. wired into both settle paths, with the paid figure ──────────────── */
{
  const i = SRC.indexOf('async function _opSettle(o) {');
  const S = SRC.slice(i, i + 9000);
  ok(/_wagePoolCredit\(Math\.min\(c\.gross, c\.salary\)/.test(S), 'a personally-funded op credits the wages its production covered');
  const corp = S.indexOf("_opTreasuryRow(-salaryPay, 'op_salary'");
  ok(corp > 0 && /if \(salaryPay > 0\) \{ try \{ _wagePoolCredit\(salaryPay/.test(S.slice(corp, corp + 600)), 'a corp op credits salaryPay — the clamped figure the treasury row carries, not the wage owed');
  ok(/op_salary: 'paid worker wages into the city wage pool'/.test(SRC), 'the ledger verb says where the money went');
  ok(/__wagePool__:/.test(SRC) && /f\.__wagePool__/.test(SRC), 'the pool is exported and imported through the cloud profile');
  ok(/\(Number\(_cw\.updated\) \|\| 0\) > \(Number\(_lw\.updated\) \|\| 0\)\) Profile\.wagePool = Object\.assign\(\{\}, _cw\)/.test(SRC), 'the merge is newest-stamp-wins, not a union');
}

/* ── 3. the city draws from the pool BEFORE minting, and takings are unchanged */
{
  const bi = NC.indexOf('B.wagePoolDraw = async (want) =>');
  ok(bi > 0, 'the bridge has wagePoolDraw');
  const B = NC.slice(bi, bi + 900);
  ok(/if \(B\.mode !== 'parent'\) return 0;/.test(B), 'every mode but parent draws 0 (mint it all — the pre-pool behaviour)');
  ok(/Math\.min\(took, Number\(want\) \|\| 0\)/.test(B), 'a parent that over-answers is clamped to what was asked');

  /* Drive the bridge method with a stub parent. */
  const ctx = { P: { cityWagePoolDraw: (w) => Math.min(w, 300) }, Number, Math };
  vm.createContext(ctx);
  vm.runInContext('const B = { mode: "parent" };\n' + B.slice(0, B.indexOf('B.wagePoolPeek')) + '\nthis.B = B;', ctx);
  ok(await ctx.B.wagePoolDraw(1000) === 300 && await ctx.B.wagePoolDraw(100) === 100, 'the bridge returns what the parent took');
  ctx.P.cityWagePoolDraw = () => { throw new Error('boom'); };
  ok(await ctx.B.wagePoolDraw(1000) === 0, 'a throwing parent draws 0');
  ctx.P.cityWagePoolDraw = () => 1e9;
  ok(await ctx.B.wagePoolDraw(1000) === 1000, 'an over-answering parent is clamped');
  ctx.B.mode = 'standalone';
  ok(await ctx.B.wagePoolDraw(1000) === 0, 'standalone draws 0');

  /* The tick: the pool replaces minted Cinder, it never adds to the credit. */
  const ti = NC.indexOf('const P = PATRONAGE.tick({');
  const T = NC.slice(ti, ti + 3500);
  ok(/_fromWages = Math\.max\(0, Math\.min\(P\.credited, Number\(await MythicCityBridge\.wagePoolDraw\(P\.credited\)\) \|\| 0\)\)/.test(T), 'the draw is bounded by the credit — the pool can only replace, never add');
  const ci = T.indexOf('game.frac.cinder = (game.frac.cinder || 0) + P.credited;');
  ok(ci > 0 && T.indexOf('wagePoolDraw') < ci, 'the pool is drawn BEFORE the credit lands, and the credit is still P.credited');
  ok(/minted: Math\.max\(0, P\.credited - _fromWages\)/.test(T), '_patronLast records the minted remainder');
  ok(/wages: \(\) => Object\.assign\(\{\}, _patronWages/.test(NC), 'the seam exposes the split');
  ok(/paid out of NPC wages \(city-wide\)/.test(NC), 'the Trading card shows the share the wages paid for');
}

/* ── 4. the six version knobs moved together ─────────────────────────────── */
{
  const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
  ok(!!v && readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION', v);
  ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js CACHE_VERSION carries the build');
  ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(NC), 'NC_BUILD carries the build');
  ok(new RegExp('effects\\.js\\?v=' + v + '"').test(SRC) && new RegExp('handset\\.js\\?v=' + v + '"').test(SRC), 'effects.js and handset.js cache-busters equal the build');
}

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
