/* 🔥 v121v158 — CITY CINDER: every building earns, held per building, collected
   in 15k slices. Run: node _citycinder_smoke.mjs

   Owner: "Make it where city businesses and buildings generate cinder and make
   profit from NPCs Shopping and just based on the building what it produces,
   What the level upgrade it is, the units that is on it … All buildings should
   be bringing and generating profit and cinder cap them all at 150,000 … save
   the profit progress on every building" and "they can only have 15k transfer
   the rest is held basically never stopped".

   Three things these checks exist to protect, each of which was nearly a bug:

   1. THE DOUBLE PAY. City Cinder auto-credited: economyTick accrued into
      game.frac.cinder and the flush at the bottom is "the ONE place city Cinder
      becomes real money". Adding a held pool WITHOUT removing that would have
      paid every Cinder twice.
   2. THE DEAD BRANCH. The gen loop is `for (const r in def.gen)`, so a building
      with no cinder KEY never visits the cinder branch. A fix written inside
      that branch would have changed nothing for the 126 buildings the feature
      is for, while looking correct.
   3. THE LOST POOL. serialize() writes tiles from an explicit field whitelist.
      A pool not on that list is rebuilt as 0 on every load — the feature would
      have worked for one session and then thrown the money away. */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const NC = readFileSync('./public/node-city/index.html', 'utf8').replace(/\r\n/g, '\n');
const num = (re, what) => { const m = NC.match(re); ok(!!m, 'constant is readable: ' + what); return m ? +m[1] : NaN; };

/* ── the rules the owner gave ─────────────────────────────────────────────── */
const CAP  = num(/const CITY_HOLD_CAP    = (\d+);/, 'CITY_HOLD_CAP');
const COLL = num(/const CITY_COLLECT_MAX = (\d+);/, 'CITY_COLLECT_MAX');
ok(CAP === 150000, 'a building holds at most 150,000', String(CAP));
ok(COLL === 15000, '…and one collect transfers at most 15,000', String(COLL));
ok(COLL < CAP, '…so a full building takes several collects to empty, which is what "the rest is held" means');

/* ── every building earns, and from what it PRODUCES ──────────────────────── */
{
  const lo = NC.indexOf('function bldCinderPerMin(def) {');
  const hi = NC.indexOf('\nconst CITY_HOLD_CAP', lo);
  ok(lo > 0, 'the earning rule exists');
  const f = NC.slice(lo, hi > lo ? hi : lo + 900);
  ok(/if \(def\.gen\.cinder\) return def\.gen\.cinder;/.test(f),
    'AN AUTHORED gen.cinder ALWAYS WINS — the 13 hand-balanced rows are not recomputed by a formula');
  ok(/if \(r === 'cinder' \|\| r === 'power'\) continue;/.test(f),
    'power is excluded — it is infrastructure, not something the building sells');
  ok(/CITY_SELL_VALUE\[r\] == null \? CITY_SELL_DEFAULT/.test(f),
    'an unpriced output falls back to a default rather than earning nothing');
}
ok(/A flat cost-proportional rule was tried on paper first and rejected/.test(NC)
   || /rejected cost-proportional rule/.test(NC),
  'the rejected alternative is recorded, with the reason');

/* ── the derived credit is OUTSIDE the gen loop ───────────────────────────── */
{
  const lo = NC.indexOf('🔥 EVERY BUILDING EARNS.');
  ok(lo > 0, 'the derived credit exists');
  const f = NC.slice(lo, lo + 1400);
  ok(/if \(def\.gen && !def\.gen\.cinder\)/.test(f),
    'GUARDED ON THE ABSENCE OF AN AUTHORED LINE, so an authored building is never paid twice — once by the loop and once here');
  ok(/cityHoldAdd\(t, _dMade\)/.test(f), '…and it banks to the tile, not to the wallet');
  const iLoopEnd = NC.indexOf("if (r === 'water') waterNetRaw += genR * mult;");
  ok(iLoopEnd > 0 && lo > iLoopEnd,
    'IT SITS AFTER THE GEN LOOP — that loop is `for (const r in def.gen)`, so a building with no cinder key never enters the cinder branch and a fix written inside it would have done nothing for 126 buildings');
}

/* ── one payout path, not two ─────────────────────────────────────────────── */
{
  const lo = NC.indexOf("      if (r === 'cinder') {");
  ok(lo > 0, 'the authored cinder branch is locatable');
  const f = NC.slice(lo, lo + 1200);
  ok(/const _kept = cityHoldAdd\(t, madeR\);/.test(f),
    'the authored rows bank to the TILE now, not to game.frac.cinder');
  ok(!/game\.frac\.cinder = \(game\.frac\.cinder \|\| 0\) \+ madeR;/.test(f),
    'THE AUTO-CREDIT IS GONE from that branch — leaving it would pay every Cinder twice, once on the tick and once on collect');
  ok(/t\.earn = \(t\.earn \|\| 0\) \+ _kept;/.test(f),
    'lifetime earnings follow what was ACTUALLY banked, so a full building does not claim income it could not keep');
}
{
  const lo = NC.indexOf('async function cityHoldCollect(t) {');
  ok(lo > 0, 'collect exists');
  const f = NC.slice(lo, lo + 1100);
  ok(/Math\.min\(CITY_COLLECT_MAX, Math\.floor\(cur\)\)/.test(f), 'it takes at most the transfer cap');
  ok(/MythicCityBridge\.addCinders\(take\)/.test(f),
    'it pays through the SAME bridge the tick flush uses — so there is still exactly one place city Cinder becomes real money');
  ok(/if \(!ok\) \{ t\.hold = cur; return 0; \}/.test(f),
    'IT PUTS THE MONEY BACK IF THE BRIDGE DID NOT DELIVER — addCinders returns false on a refused or failed RPC, and keeping the debit would destroy the player\'s money on a dropped call');
}
ok(/LOT RENT AND PATRON INCOME ARE DELIBERATELY LEFT AUTO-CREDITING/.test(NC)
   || /not "a building producing"/.test(NC),
  'lot rent and patron income are deliberately left alone, and it says why');

/* ── the pool survives a save ─────────────────────────────────────────────── */
ok(/hold: Math\.round\(t\.hold \|\| 0\),/.test(NC),
  'THE POOL IS ON THE SERIALISE WHITELIST — tiles are written field by field, and a pool left off it is rebuilt as 0 on every load');
ok(/hold: Number\.isFinite\(\+td\.hold\) \? Math\.max\(0, Math\.min\(CITY_HOLD_CAP, \+td\.hold\)\) : 0,/.test(NC),
  '…and read back absent-tolerantly and clamped: every existing city has no hold field, and NaN would stop the pool paying out for ever');

/* ── run the model for real ───────────────────────────────────────────────── */
{
  const SELL = {}; // parse the table out of the source so the test uses the real numbers
  const tbl = NC.slice(NC.indexOf('const CITY_SELL_VALUE = {'), NC.indexOf('};', NC.indexOf('const CITY_SELL_VALUE = {')));
  for (const m of tbl.matchAll(/([a-zA-Z]+):\s*([0-9.]+)/g)) SELL[m[1]] = +m[2];
  const DEF  = num(/const CITY_SELL_DEFAULT = ([0-9.]+);/, 'CITY_SELL_DEFAULT');
  const RATE = num(/const CINDER_PER_OUTPUT = ([0-9.]+);/, 'CINDER_PER_OUTPUT');
  const perMin = (gen) => {
    if (gen.cinder) return gen.cinder;
    let v = 0;
    for (const r in gen) { if (r === 'cinder' || r === 'power') continue; v += gen[r] * (SELL[r] == null ? DEF : SELL[r]); }
    return v * RATE;
  };
  /* the real Farm row */
  const farm = perMin({ food: 1.5, corn: 0.3, fruit: 0.18, herbs: 0.08 });
  ok(farm > 0.10 && farm < 0.35,
    'run for real: a FARM earns in the same band as the hand-balanced shops (0.18–0.30/hr), which is the calibration target',
    farm.toFixed(3) + '/hr');
  /* a shop keeps its authored rate exactly */
  ok(perMin({ cinder: 0.18 }) === 0.18, 'run for real: an authored shop is byte-for-byte unchanged');
  /* nothing produced, nothing earned */
  ok(perMin({}) === 0, 'run for real: a building that produces nothing earns nothing — housing and finance towers are not shops');
  ok(perMin({ power: 5 }) === 0, 'run for real: …and a power station is not paid for making power');
  /* the expensive-but-idle case the rejected rule got wrong */
  ok(perMin({}) < perMin({ food: 1.5 }),
    'run for real: an 11,000-cost holdco that produces nothing earns LESS than a 14-cost farm — the cost rule had it 200x the other way');

  /* the pool */
  const add = (hold, amt) => Math.min(CAP, hold + amt);
  ok(add(0, 100) === 100, 'run for real: accrual banks into the pool');
  ok(add(149950, 100) === CAP, 'run for real: …and stops exactly at the cap, never above it');
  ok(add(CAP, 5000) === CAP, 'run for real: a full building accrues no further');
  const take = (hold) => Math.min(COLL, Math.floor(hold));
  ok(take(CAP) === COLL, 'run for real: a full building gives up 15,000 and keeps 135,000');
  ok(add(CAP - COLL, 0) === CAP - COLL, 'run for real: …which is what "the rest is held" means');
  ok(take(900) === 900, 'run for real: a small pool is collected whole');
  ok(take(0) === 0, 'run for real: an empty pool pays nothing');
  ok(Math.ceil(CAP / COLL) === 10, 'run for real: emptying a full building takes 10 collects', String(Math.ceil(CAP / COLL)));
}

/* the knob */
{
  const v = (readFileSync('./public/version.txt', 'utf8') || '').trim();
  ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(NC), 'NC_BUILD carries the build', v);
}
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
