/* 🧪 THE ECONOMY GAUNTLET — the regression gate for /src/economy.
   ----------------------------------------------------------------------------
   Run from the repo root:   node tools/economy-tests/run.mjs
   Exits non-zero on any failure, so it can gate a deploy.

   Three rounds, and each exists because it caught something real:
     1. HOSTILE INPUT   NaN/Infinity dt, corrupt saves, zero population, a
                        garbage host object. Found: an Infinity dt that ran
                        three economic days off a bad clock read; a NaN
                        population from one bad byte in a save; NaN leaking
                        into the freight panel.
     2. INVARIANTS      Conservation of Cinder across 40 randomized cities ×
                        120 days, save/load completeness, price clamps, bank
                        solvency, level gates, the faucet ceiling, the payout
                        bound. Found: three unsaved state variables, one of
                        which let a firm take a SECOND loan by reloading.
     3. INTEGRATION     Buildings → businesses → jobs, through the same map
                        node-city uses. Found: a rebuilt tile inheriting the
                        previous business's balance sheet.

   ⚠ Round 3 models node-city's REAL population cap (4 + 6 per housing level).
     An earlier version let population grow freely, which made a tuning change
     look strictly beneficial when against the real cap it deleted the
     unemployment mechanic entirely. A test that does not match the host's
     constraints will confidently point the wrong way. */
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const here = dirname(fileURLToPath(import.meta.url));
let bad = 0;

/* ════════════════════════════════════════════════════════════════════════════
   ROUND 0 — 🏗 THE CONSTRUCTION DURATION CURVE
   ----------------------------------------------------------------------------
   Runs IN-PROCESS (no spawn): construction.js is a pure function over a plain
   profile object and imports nothing but tuning.js — no bridge, no window, no
   chain catalogue. That is the whole point of putting the curve in a module
   instead of in node-city/index.html, and this round is the payoff.

   🔴 WHY THIS ROUND EXISTS, AND WHY IT PINS EVERY VALUE TO THE SECOND.
   `municipal.maxSec` (2400) is the free Municipal Works ceiling and it ALONE
   decides whether a brand-new city can build itself. The whole starter shelf
   has to stay under it (sawmill 30m43, barracks 33m36 are the tight ones) and
   every Cinder earner has to stay above it (gasstation 1h53) — that split IS
   the design. Nothing about a `gamma` or a `costExp` tells you at a glance
   which side of 2400 a sawmill lands on, so a retune done by feel silently
   either bricks the bootstrap or hands the player free income buildings. The
   table below is the tripwire: change any number in ECON.construction and this
   round reprints the shelf and fails on the ones that moved.

   ⚠ THE SPEC'S §2.3 TABLE IS OFF BY UP TO 4 SECONDS AND THE FORMULA WINS.
     SPEC_CONSTRUCTION.md §2.1 (the formula) and §2.3 (the worked table) do not
     agree to the second. §2.3 is internally inconsistent — feeding its OWN
     printed `score` column back through its OWN printed formula gives arena
     12194, farm 565, housing 655, gasstation 6764, which matches neither its
     duration column nor each other. The deltas run in both directions
     (-1/+1/+4), which is the signature of hand-rounded intermediate arithmetic
     rather than a different formula; four candidate re-derivations were tried
     and the verbatim one fits best. So §2.1 is implemented VERBATIM and is
     normative, and this round asserts BOTH:
       • `exact`  — the integer the shipped formula actually returns, pinned to
                    the second, because that is what regresses.
       • `spec`   — the §2.3 figure, within SPEC_TOL seconds, so the worked
                    examples stay reconciled and a real drift away from the
                    design intent still fails.
     If a future retune is meant to MOVE the shelf, update both columns
     together and say so in the commit. Do not widen SPEC_TOL to make a red
     round green — 4 seconds is rounding, 40 is a design change. */
{
  const P = '../../public/src/economy/';
  const { seconds } = await import(P + 'construction.js');
  const { ECON } = await import(P + 'tuning.js');
  const C = ECON.construction;
  const SPEC_TOL = 5;                     // seconds; see the note above

  let fails = 0;
  const chk = (name, cond, extra) => {
    if (cond) { console.log('✅ ' + name); return; }
    fails++; console.log('❌ ' + name + (extra ? ' :: ' + extra : ''));
  };
  const hms = s => [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
    .map((n, i) => i ? String(n).padStart(2, '0') : String(n)).join(':');

  /* The profiles are the spec's, and they are what node-city's bldProfile()
     will hand over: RAW def.cost/def.tierCost flattened at costResWeight=2 —
     ⚠ never costOf(), which returns tierCost unscaled and would build a
     Stadium faster than a starter Farm. cinderPerHr is genOf()*60. */
  const SHELF = [
    // name             profile                                    exact  spec§2.3
    ['farm',            { cost: 22, res: 90 },                       565,  566],
    ['housing',         { cost: 58 },                                655,  654],
    ['gasstation',      { cost: 62, cinderPerHr: 0.25 },            6765, 6765],
    ['arena',           { cost: 280, cinderPerHr: 0.20, svc: 0.8 }, 12196, 12192],
    ['indexfund',       { cost: 4166 },                            53869, 53868],
    ['holdco',          { cost: 13736 },                           86400, 86400],
    ['op_construction', { fixedSec: C.opSec },                       900,  900],
  ];

  console.log('\n########## round0-construction ##########');
  console.log('\n  🏗 DURATION CURVE — ECON.construction, formulaV ' + C.formulaV +
              '  (municipal ceiling ' + C.municipal.maxSec + 's = ' + hms(C.municipal.maxSec) + ')\n');
  console.log('    building          duration        exact    spec§2.3   Δ   free crew?');
  console.log('    ' + '-'.repeat(68));
  const got = {};
  for (const [name, p, exact, spec] of SHELF) {
    const v = seconds(p);
    got[name] = v;
    const free = (p.fixedSec ? true : v <= C.municipal.maxSec) ? 'yes' : 'NEEDS CO.';
    console.log('    ' + name.padEnd(17) + hms(v).padStart(9) + '  ' +
                String(v).padStart(9) + String(spec).padStart(11) +
                String(v - spec).padStart(5) + '   ' + free);
  }
  console.log('');
  for (const [name, p, exact, spec] of SHELF) {
    chk('duration ' + name + ' === ' + exact + 's', got[name] === exact, 'got ' + got[name]);
    chk('  …within ' + SPEC_TOL + 's of spec §2.3 (' + spec + ')',
        Math.abs(got[name] - spec) <= SPEC_TOL, 'got ' + got[name] + ', spec ' + spec);
  }

  /* (a) THE TOP OF THE CURVE MUST SEPARATE, NOT SATURATE. This is why full.cost
     is 1200 and not a value that pins everything expensive at the ceiling: if
     an Index Fund and a Holding Company both clamp to 24h, the cap stops being
     a cap and becomes the entire late game. holdco clamps (score >= 1);
     indexfund must not. */
  chk('indexfund < holdco — the top separates rather than saturating',
      got.indexfund < got.holdco, got.indexfund + ' vs ' + got.holdco);
  chk('holdco is the clamp (score clamps to 1 ⇒ exactly maxSec)',
      got.holdco === C.maxSec, String(got.holdco));

  /* (b) MONOTONICITY. A building that costs more, earns more and produces more
     can never take LESS time to build. Nothing in the curve enforces this
     structurally — it is a property of the weights all being positive and the
     clamp being applied to the SUM — so a retune that made any weight negative,
     or that clamped per channel, would break it silently and hand the player a
     "upgrade the profile to build it faster" exploit. */
  const AXES = { cost: [0, 22, 58, 280, 1200, 4166, 13736],
                 cinderPerHr: [0, 0.05, 0.2, 0.3, 1],
                 res: [0, 90, 700, 1400, 5000] };
  const grid = [];
  for (const cost of AXES.cost) for (const cinderPerHr of AXES.cinderPerHr) for (const res of AXES.res)
    grid.push({ cost, cinderPerHr, res });
  let monoBad = null;
  for (const a of grid) {
    if (monoBad) break;
    for (const b of grid) {
      if (!(a.cost <= b.cost && a.cinderPerHr <= b.cinderPerHr && a.res <= b.res)) continue;
      if (seconds(a) > seconds(b)) { monoBad = JSON.stringify(a) + ' → ' + seconds(a) + ' > ' +
                                                JSON.stringify(b) + ' → ' + seconds(b); break; }
    }
  }
  chk('monotonic over ' + grid.length + ' profiles (' + (grid.length * grid.length) +
      ' ordered pairs): bigger is never faster', !monoBad, monoBad);

  /* (c) THE 24-HOUR CEILING IS ABSOLUTE, ON EVERY PATH. The upgrade multiplier
     (0.75 × 1.6^(lvl-1)) is applied AFTER the base duration and reaches ~4.9×
     at level 5, so the cap has to be the LAST operation or a level-5 upgrade of
     an expensive building runs for five days. Hostile profiles go through the
     same gate: the feature was asked for a 24h ceiling and there is no input
     that buys more. */
  let capBad = null, floorBad = null;
  const HOSTILE = [{}, { cost: NaN }, { cost: Infinity }, { cost: -5 }, { cost: '13736' },
                   { cost: 1e300, res: 1e300, cinderPerHr: 1e300, svc: 1e300 },
                   { fixedSec: 1e12 }, { fixedSec: 1 }, { cost: 13736, speedMul: 0 },
                   { cost: 13736, speedMul: -4 }, { cost: 13736, speedMul: NaN }];
  for (const p of grid.concat(HOSTILE)) {
    for (const kind of [0, 1]) for (const lvl of [1, 2, 3, 4, 5]) {
      const v = seconds(Object.assign({}, p, { kind, lvl }));
      if (!(v <= C.maxSec)) capBad = JSON.stringify(p) + ' k' + kind + ' l' + lvl + ' → ' + v;
      if (!(v >= C.minSec)) floorBad = JSON.stringify(p) + ' k' + kind + ' l' + lvl + ' → ' + v;
    }
  }
  chk('nothing ever exceeds maxSec (' + C.maxSec + 's = 24h), incl. L5 upgrades + hostile input',
      !capBad, capBad);
  chk('nothing ever falls below minSec (' + C.minSec + 's)', !floorBad, floorBad);

  /* ⚠ speedMul DIVIDES, so it is the one input that could produce Infinity. It
     is floored at 1: a 0, a negative or a NaN can only ever fail toward the
     slower, honest duration — never toward an instant build. */
  const noCrew = seconds({ cost: 280 });
  chk('speedMul is floored at 1 — 0/negative/NaN cannot shorten a job',
      seconds({ cost: 280, speedMul: 0 })   === noCrew &&
      seconds({ cost: 280, speedMul: -4 })  === noCrew &&
      seconds({ cost: 280, speedMul: NaN }) === noCrew &&
      seconds({ cost: 280, speedMul: 0.1 }) === noCrew,
      'baseline ' + noCrew + ', speedMul0 ' + seconds({ cost: 280, speedMul: 0 }) +
      ', speedMul0.1 ' + seconds({ cost: 280, speedMul: 0.1 }));
  chk('speedMul 2.0 halves a mid-shelf job',
      Math.abs(seconds({ cost: 62, cinderPerHr: 0.25, speedMul: C.speed.maxMul }) -
               got.gasstation / C.speed.maxMul) <= 1,
      String(seconds({ cost: 62, cinderPerHr: 0.25, speedMul: C.speed.maxMul })));

  /* The upgrade branch, read off ECON rather than off a literal, so this still
     pins the shape if upgrade.base/mulPerLevel are retuned. */
  const u1 = seconds({ cost: 22, res: 90, kind: 1, lvl: 1 });
  const u2 = seconds({ cost: 22, res: 90, kind: 1, lvl: 2 });
  chk('upgrade L1 = base × upgrade.base (' + C.upgrade.base + ')',
      Math.abs(u1 / got.farm - C.upgrade.base) < 0.01, u1 + '/' + got.farm);
  chk('each upgrade level × upgrade.mulPerLevel (' + C.upgrade.mulPerLevel + ')',
      Math.abs(u2 / u1 - C.upgrade.mulPerLevel) < 0.01, u2 + '/' + u1);

  /* (d) ⚡ 'power' MUST BE SKIPPED. gen.power 6.0 falling through to
     defaultTier 1 (×4) yields vRes 1440 against full.resource 1400 — the single
     largest resource channel in the game, from a quantity that is NEVER banked
     (index.html:2211) — which makes the mandatory Power Station a 5h52 build,
     above the free-crew ceiling, in a city that cannot function without it. */
  chk("resSkip contains 'power' (never banked — index.html:2211)",
      Array.isArray(C.resSkip) && C.resSkip.indexOf('power') >= 0, JSON.stringify(C.resSkip));
  chk("resSkip contains 'cinder' (counted by the cinderPerHr channel, not twice)",
      C.resSkip.indexOf('cinder') >= 0, JSON.stringify(C.resSkip));

  /* The feature's own off switch. ECON.construction.on = 0 turns every timer
     off without touching a line of index.html (a 0 duration is the host's
     "place instantly" path), which is the rollback plan. */
  const savedOn = C.on; C.on = 0;
  chk('on:0 returns 0 — the whole feature switches off from ECON alone',
      seconds({ cost: 13736 }) === 0 && seconds({ fixedSec: 900 }) === 0);
  C.on = savedOn;

  if (fails) { bad++; console.log('\n=== ROUND 0: ' + fails + ' FAILED ==='); }
  else console.log('\n=== ROUND 0: ALL PASS ===');
}
for (const f of ['gauntlet1.mjs', 'gauntlet2.mjs', 'gauntlet3.mjs']) {
  console.log('\n########## ' + f + ' ##########');
  const r = spawnSync(process.execPath, [join(here, f)], { stdio: 'inherit' });
  if (r.status !== 0) bad++;
}
console.log(bad ? '\n❌ ECONOMY GAUNTLET: ' + bad + ' round(s) failed' : '\n✅ ECONOMY GAUNTLET: all rounds passed');
process.exit(bad ? 1 : 0);
