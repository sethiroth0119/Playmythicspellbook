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
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const here = dirname(fileURLToPath(import.meta.url));
let bad = 0;

/* 🧨 THE SABOTAGE SWITCH — how these rounds are proved to be able to FAIL.
   ----------------------------------------------------------------------------
   A tripwire nobody has ever seen trip is a comment. Rounds 0b and 0c both
   defend against SILENT failures (an id that is dropped without a warning, a
   firm that is reaped without a log line), so "it printed ✅" is exactly the
   evidence they are designed to distrust. Each accepts one deliberate injury:

     ECON_TEST_SABOTAGE=bogus-id   round0b: add an unproducible id to the map
     ECON_TEST_SABOTAGE=no-map     round0b: read the map from a path that is not
                                   there, i.e. extraction returns NOTHING
     ECON_TEST_SABOTAGE=withdraw   round0c: withdraw an UPGRADING tile from the
                                   reconcile list for exactly one sync — the
                                   invariant at node-city:17117, violated once

   ⚠ Every one of these must turn the gate RED. If you change these rounds, run
     all three and check that they still do; an unset variable is the shipping
     path and does nothing. */
const SABOTAGE = process.env.ECON_TEST_SABOTAGE || '';
if (SABOTAGE) console.log('🧨 ECON_TEST_SABOTAGE=' + SABOTAGE + ' — this run is DELIBERATELY injured and MUST fail.');

/* Filled by round 0b, consumed by round 0c: the real ECO_BUILDING_MAP as read
   out of node-city/index.html. 0c reconciles against the SAME map the city
   does rather than against a hand-kept copy — gauntlet3.mjs keeps such a copy
   (its `MAP` literal) and it has already fallen 5 entries behind. */
let CITY_MAP = null;

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

/* ════════════════════════════════════════════════════════════════════════════
   ROUND 0b — 🏭 EVERY BUILDING IN THE MAP IS A BUSINESS THAT CAN EXIST
   ----------------------------------------------------------------------------
   🔴 THE FAILURE THIS DEFENDS AGAINST IS COMPLETELY SILENT.
   `syncBuildings` (public/src/economy/index.js:153) does this:

       if (!Recipes.producible(b.out)) continue;

   — no warn, no throw, no event. A typo in ECO_BUILDING_MAP, or an id that
   exists only in /src/resources/chain.js and has no recipe or deposit behind
   it, therefore yields a tile that looks PERFECTLY wired in the table, founds
   no firm, employs nobody, and does it forever with a green console. The same
   goes for an `ind` that is not in INDUSTRIES: firms.js falls back to
   `distributor` and the building quietly becomes a haulier.

   The city has 47 entries across two literals and no human is going to re-check
   them. So the gate does.

   ── HOW IT READS THE MAP, AND WHAT HAPPENS WHEN THAT BREAKS ────────────────
   ECO_BUILDING_MAP lives inside a 25,000-line HTML file, inside one enormous
   IIFE. There is no import to be had: this round scans the text of
   public/node-city/index.html for three named object literals, brace-matching
   past comments and strings, and evaluates each as a plain literal. That is
   legitimate because the literals contain nothing but strings and arrays of
   strings — the ops rows are attached to the map by a LOOP (index.html, the
   `for (const t of OPS_TYPES)` registration block) and this round re-runs that
   join itself from OP_ECO_MAP + OPS_PREFIX.

   🔴 A TEXT SCRAPE THAT MATCHES NOTHING PASSES VACUOUSLY, and that is a worse
      state than having no test — the comment in index.html would still claim
      this round guards the map. So the read is NOT allowed to come back empty:
      a missing file, a renamed declaration, a moved brace or a partial match
      all fail HARD below, on the extraction itself, before a single id is
      checked. Prove it with ECON_TEST_SABOTAGE=no-map. The sentinel keys are
      the guard against a match that terminated early and grabbed half a map.
   ════════════════════════════════════════════════════════════════════════════ */
{
  console.log('\n########## round0b-building-map ##########');
  let fails = 0;
  const chk = (name, cond, extra) => {
    if (cond) { console.log('✅ ' + name); return true; }
    fails++; console.log('❌ ' + name + (extra ? ' :: ' + extra : '')); return false;
  };

  const HTML_PATH = SABOTAGE === 'no-map'
    ? join(here, '../../public/node-city/THIS-FILE-DOES-NOT-EXIST.html')
    : join(here, '../../public/node-city/index.html');

  let HTML = null;
  try { HTML = readFileSync(HTML_PATH, 'utf8'); } catch (e) { HTML = null; }
  chk('read node-city/index.html (' + HTML_PATH.replace(/\\/g, '/').split('/').slice(-2).join('/') + ')',
      !!HTML && HTML.length > 100000, HTML ? HTML.length + ' bytes' : 'UNREADABLE — the map cannot be checked at all');

  /* Brace-match an object literal that starts at `decl`, stepping over block
     comments, line comments and quoted strings — the map is full of prose and
     OP_BP carries an escaped apostrophe ("the city\'s Health coverage"), both
     of which a naive scan would miscount. Returns the literal TEXT, comments
     and all: `new Function` parses those natively, so nothing has to be
     stripped and no regex has to understand JavaScript. */
  const literalAfter = (src, decl) => {
    if (!src) return null;
    const at = src.indexOf(decl);
    if (at < 0) return null;
    let i = src.indexOf('{', at + decl.length - 1);
    if (i < 0) return null;
    const start = i;
    let depth = 0;
    for (; i < src.length; i++) {
      const c = src[i], d = src[i + 1];
      if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return null; i = e + 1; continue; }
      if (c === '/' && d === '/') { const e = src.indexOf('\n', i + 2); if (e < 0) return null; i = e; continue; }
      if (c === '"' || c === "'" || c === '`') {
        const q = c; i++;
        for (; i < src.length; i++) { if (src[i] === '\\') { i++; continue; } if (src[i] === q) break; }
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
    }
    return null;                       // unbalanced ⇒ nothing, never a guess
  };
  const literalObj = (decl) => {
    const txt = literalAfter(HTML, decl);
    if (!txt) return null;
    try { return (new Function('return (' + txt + ');'))(); } catch (e) { return null; }
  };
  const size = o => (o && typeof o === 'object') ? Object.keys(o).length : -1;

  const STATIC = literalObj('const ECO_BUILDING_MAP = {');
  const OPMAP  = literalObj('const OP_ECO_MAP = {');
  const OPBP   = literalObj('const OP_BP = {');
  const prefixM = HTML ? /const\s+OPS_PREFIX\s*=\s*'([^']*)'/.exec(HTML) : null;
  const PREFIX = prefixM ? prefixM[1] : null;

  const gotAll =
    chk('extracted ECO_BUILDING_MAP', size(STATIC) > 0, 'got ' + size(STATIC) + ' keys') &
    chk('extracted OP_ECO_MAP',       size(OPMAP)  > 0, 'got ' + size(OPMAP)  + ' keys') &
    chk('extracted OP_BP',            size(OPBP)   > 0, 'got ' + size(OPBP)   + ' keys') &
    chk('extracted OPS_PREFIX',       !!PREFIX,         String(PREFIX));

  if (!gotAll) {
    /* Stop here rather than "pass" 0 ids. This is the vacuous-tripwire guard
       the header talks about, and it is the whole reason this round may not
       simply `continue` past a bad read. */
    console.log('\n🔴 THE MAP COULD NOT BE READ — nothing below was checked.');
    console.log('   If a declaration was renamed or moved, fix the three `literalObj` markers');
    console.log('   in this round. Do NOT delete the round: the comment in node-city/index.html');
    console.log('   promises that this check exists.');
    bad++; console.log('\n=== ROUND 0b: ' + fails + ' FAILED ===');
  } else {
    /* Sentinels: a brace scan that terminated early still returns SOME keys.
       One key from the top of each literal, one from the bottom, and one from
       the block a previous package added — a partial match cannot hold all of
       them. */
    chk('ECO_BUILDING_MAP is whole (first/last/mid sentinels present)',
        ['farm', 'shop', 'warehouse', 'resthouse', 'housing'].every(k => STATIC[k]),
        'missing ' + ['farm', 'shop', 'warehouse', 'resthouse', 'housing'].filter(k => !STATIC[k]).join(','));
    chk('OP_ECO_MAP is whole (first/last/mid sentinels present)',
        ['mining', 'smuggling', 'construction', 'warehouse'].every(k => OPMAP[k]),
        'missing ' + ['mining', 'smuggling', 'construction', 'warehouse'].filter(k => !OPMAP[k]).join(','));

    // ── the ops join, performed exactly as the registration loop performs it ──
    const MAP = { ...STATIC };
    for (const t of Object.keys(OPMAP)) MAP[PREFIX + t] = OPMAP[t];
    CITY_MAP = MAP;

    if (SABOTAGE === 'bogus-id') {
      MAP.op_saboteur = { out: ['unobtainium'], ind: 'notAnIndustry' };
      console.log('   🧨 injected op_saboteur → out unobtainium / ind notAnIndustry');
    }

    /* Every operation must be accounted for: it has a business, or it is the
       one row that was argued out. A silent omission is the same class of bug
       as a silent unproducible id — the operation simply never employs anyone
       and nothing says so. */
    const noEco = Object.keys(OPBP).filter(t => !OPMAP[t]);
    chk('exactly one operation has no business, and it is `bank` (index.html:17101)',
        noEco.length === 1 && noEco[0] === 'bank', 'without a business: [' + noEco.join(', ') + ']');
    chk('op_bank is NOT in the map', !MAP[PREFIX + 'bank'], JSON.stringify(MAP[PREFIX + 'bank']));
    chk('every OP_ECO_MAP key names a real OP_BP blueprint',
        Object.keys(OPMAP).every(t => OPBP[t]),
        'unknown: ' + Object.keys(OPMAP).filter(t => !OPBP[t]).join(','));
    chk('all ' + (Object.keys(OPBP).length - 1) + ' non-bank operations are wired',
        Object.keys(OPMAP).length === Object.keys(OPBP).length - 1,
        Object.keys(OPMAP).length + ' of ' + (Object.keys(OPBP).length - 1));

    /* A floor, not an equality: adding a building must not require editing this
       file, but a scrape that suddenly returns a handful of entries must. The
       shipped figure is printed on every run so a real drop is visible. */
    const FLOOR = 40;
    chk('map has at least ' + FLOOR + ' entries (shipped: ' + Object.keys(MAP).length + ')',
        Object.keys(MAP).length >= FLOOR, String(Object.keys(MAP).length));

    // ── THE ACTUAL TRIPWIRE ────────────────────────────────────────────────
    global.window = { MythicCityBridge: { addCinders: async () => {} }, MythicResourceChain: null };
    const chain = await import('../../public/src/resources/chain.js');
    global.window.MythicResourceChain = { ALL: chain.RESOURCE_CHAIN };
    const R = await import('../../public/src/economy/recipes.js');

    const badOut = [], badInd = [];
    for (const k of Object.keys(MAP)) {
      const m = MAP[k];
      if (!m || !Array.isArray(m.out) || !m.out.length) { badOut.push(k + ' → no `out` list'); continue; }
      for (const o of m.out) if (!R.producible(o)) badOut.push(k + ' → ' + o);
      if (!R.INDUSTRIES[m.ind]) badInd.push(k + ' → ind ' + m.ind);
    }
    console.log('\n  checked ' + Object.keys(MAP).length + ' buildings, ' +
                Object.keys(MAP).reduce((n, k) => n + ((MAP[k].out || []).length), 0) + ' output ids, ' +
                new Set(Object.keys(MAP).map(k => MAP[k].ind)).size + ' industries\n');
    chk('every `out` id satisfies Recipes.producible() — else syncBuildings drops it SILENTLY',
        badOut.length === 0, badOut.join(' | '));
    chk('every `ind` exists in INDUSTRIES — else the firm silently becomes a distributor',
        badInd.length === 0, badInd.join(' | '));

    if (fails) { bad++; console.log('\n=== ROUND 0b: ' + fails + ' FAILED ==='); }
    else console.log('\n=== ROUND 0b: ALL PASS ===');
  }
}
/* ════════════════════════════════════════════════════════════════════════════
   ROUND 0c — 🔴 A BUILDING BEING UPGRADED IS STILL A BUSINESS
   ----------------------------------------------------------------------------
   THE INVARIANT, verbatim from node-city/index.html:17117:

     > A tile may be ABSENT from `ecoBuildings()` until its first completion,
     > and is PRESENT forever after. It is NEVER withdrawn.
     > `ecoBuildings` is gated on `bldSite`, never on `bldBusy`.

   Why it is the most dangerous line in the city, and why NOTHING ELSE catches
   a violation of it:

     · `bldSite(t)` is true only for a tile with nothing standing on it yet.
       `bldBusy(t)` is true for ANY job, including the upgrade of a working
       factory. Swapping one for the other is a one-word "simplification" that
       reads like a tidy-up.
     · With bldBusy there, an upgrading tile leaves the reconcile list for the
       length of the job — up to 24 hours. syncBuildings (economy/index.js:163)
       then sets rung='BANKRUPT', Firms.reap() DELETES the firm, and its cash
       leaves totalCinder(). No warn. No throw. No log line.
     · And the gauntlet stays GREEN, because sim.js captures `before` INSIDE
       runDay (sim.js:820) while the host calls syncBuildings from a 4 s
       setInterval — i.e. always between ticks, never inside the audited
       window. The books balance because the theft happened while nobody was
       counting.

   So this round counts. It drives a full place → build → complete → upgrade →
   complete cycle and asserts on BOTH halves of the damage:

     IDENTITY  the firm id, its lifetime revenue, its supplier set and its rung
               survive the upgrade. A reap-and-refound gives a NEW id and a
               zeroed book, which is what a player would experience as "my
               factory forgot everything".
     MONEY     totalCinder() is measured either side of EVERY syncBuildings
               call, not just either side of a tick. Across the upgrade window
               that delta must be EXACTLY zero — a reap shows up here as a
               large negative before any other test in this repo can see it.

   ⚠ MEASURED, NOT MODELLED: `Firms.found()` seeds a new firm with
     dailyOperatingCost × ECON.firm.startCashDays out of nowhere (firms.js:88),
     and because founding happens between ticks the day audit never sees that
     either. So the cycle's books are closed here as
        Δ totalCinder = Σ(faucet − imports − payout) + Σ(sync deltas)
     with the sync term measured directly. That is the honest closure, and it
     is what makes "the sync term is zero during an upgrade" a real assertion
     rather than a tautology.

   Prove this round can fail: ECON_TEST_SABOTAGE=withdraw.
   ════════════════════════════════════════════════════════════════════════════ */
{
  console.log('\n########## round0c-firm-stability ##########');
  let fails = 0;
  const chk = (name, cond, extra) => {
    if (cond) { console.log('✅ ' + name); return true; }
    fails++; console.log('❌ ' + name + (extra ? ' :: ' + extra : '')); return false;
  };

  if (!CITY_MAP) {
    console.log('❌ round0b could not read ECO_BUILDING_MAP — this round has nothing to reconcile against.');
    bad++; console.log('\n=== ROUND 0c: 1 FAILED ===');
  } else {
    if (!global.window) {
      global.window = { MythicCityBridge: { addCinders: async () => {} }, MythicResourceChain: null };
      const chain = await import('../../public/src/resources/chain.js');
      global.window.MythicResourceChain = { ALL: chain.RESOURCE_CHAIN };
    }
    const P = '../../public/src/economy/';
    const E = (await import(P + 'index.js')).default;
    const { ECON } = await import(P + 'tuning.js');
    const DAY = ECON.clock.dayMin;          // minutes that make exactly one runDay

    /* ⚠ THE GATE UNDER TEST, COPIED VERBATIM FROM node-city:17250. This is the
       one line this round exists to defend, so it is written out rather than
       imported (it cannot be imported — it is a `const` arrow inside an IIFE
       in an HTML file). If node-city's definition and this one ever disagree,
       this round is testing a fiction; that is the cost of the globals trap
       and it is why the browser-driven check in the package notes exists too. */
    const bldSite = t => !!(t && t.bld && t.bld.k === 0);

    const tiles = {};
    /* Withheld key: the sabotage hook. Nothing sets this on a shipping run. */
    let WITHHOLD = null;
    const list = () => Object.entries(tiles)
      .filter(([k, t]) => CITY_MAP[t.type] && !t.damaged && !bldSite(t) && k !== WITHHOLD)
      .map(([k, t]) => {
        const o = E.pickAvailable(CITY_MAP[t.type].out);
        return o ? { key: k, out: o, ind: CITY_MAP[t.type].ind, lvl: t.lvl } : null;
      }).filter(Boolean);
    const inList = k => list().some(b => b.key === k);
    const firmAt = k => E.firms().find(f => f.tileKey === k) || null;

    /* A node that actually has timber, so the sawmill under test buys from a
       LOCAL supplier and its `suppliers` set is non-empty. Without that the
       "suppliers survived" assertion would be true of an empty object and
       would prove nothing — the same vacuity round0b guards against. */
    let node = null;
    for (let i = 0; i < 80 && !node; i++) {
      const id = 'wp7-' + i;
      E.mount({ nodeId: id, population: 60 });
      if (E.canBuild('timber')) node = id;
    }
    chk('found a node whose ground carries timber (so the supplier leg is real)', !!node, 'scanned 80 nodes');
    if (!node) node = 'wp7-0';

    E.mount({ nodeId: node, population: 60 });
    const host = { powerFactor: 1, waterFactor: 1, logisticsCounts: { warehouse: 3, depot: 2 },
                   hasBank: true, infrastructure: 0.75 };

    // ── the accounting, running for the whole cycle ────────────────────────
    const START = E.totalCinder();
    let expected = 0, syncTotal = 0, auditBad = null;
    const tick = () => {
      E.tick(DAY, host);
      const s = E.snapshot();
      expected += s.flow.faucet - s.flow.imports - s.flow.payout;
      if (!s.audit || !s.audit.ok) auditBad = JSON.stringify(s.audit);
    };
    /* Every sync is weighed. `label` is only used to report where money moved. */
    const sync = () => { const t0 = E.totalCinder(); E.syncBuildings(list());
                         const d = E.totalCinder() - t0; syncTotal += d; return d; };

    // A small working city around the subject, so it has customers and inputs.
    tiles['1,0'] = { type: 'lumbercamp', lvl: 1, damaged: false };
    tiles['2,0'] = { type: 'purifier',   lvl: 1, damaged: false };
    tiles['3,0'] = { type: 'farm',       lvl: 1, damaged: false };
    tiles['4,0'] = { type: 'grocery',    lvl: 1, damaged: false };
    /* 🏭 …and one of the 14 operations this package wired, so the new entries
       are proved to found a firm rather than only to be spelled correctly. */
    tiles['9,0'] = { type: 'op_warehouse', lvl: 1, damaged: false };

    // ── 1. PLACED AS A SITE: nothing standing, so no business. ─────────────
    const SUBJ = '5,0';
    tiles[SUBJ] = { type: 'sawmill', lvl: 1, damaged: false,
                    bld: { k: 0, l: 1, s: Date.now(), d: 900 } };
    sync();
    chk('a construction SITE is absent from the reconcile list', !inList(SUBJ));
    chk('a construction SITE founds no firm', !firmAt(SUBJ));
    chk('an op_* tile founds a firm (the 14 new entries are live)',
        !!firmAt('9,0'), 'op_warehouse → ' + JSON.stringify(firmAt('9,0') && firmAt('9,0').out));

    // ── 2. COMPLETE: the business exists. ──────────────────────────────────
    delete tiles[SUBJ].bld;
    const dFound = sync();
    const born = firmAt(SUBJ);
    chk('completion founds the business', !!born, 'no firm at ' + SUBJ);
    chk('founding SEEDS cash the day-audit never sees (firms.js:88) — measured, not assumed',
        dFound > 0, 'sync moved ' + dFound.toFixed(2) + ' 🔥');

    // ── 3. TRADE for a while, so there is a book worth losing. ─────────────
    for (let d = 0; d < 14; d++) { sync(); tick(); }
    const f0 = firmAt(SUBJ);
    const BEFORE = f0 ? { id: f0.id, cash: f0.cash, rev: f0.lifetimeRevenue,
                          sup: Object.keys(f0.suppliers || {}).sort(), rung: f0.rung, level: f0.level } : null;
    chk('the business is trading before the upgrade (cash, revenue and a supplier)',
        !!BEFORE && BEFORE.rev > 0 && BEFORE.sup.length > 0 && BEFORE.rung !== 'BANKRUPT',
        BEFORE ? 'rev ' + BEFORE.rev.toFixed(0) + ', suppliers [' + BEFORE.sup.join(',') + ']' : 'no firm');

    // ── 4. ORDER THE UPGRADE. k=1 ⇒ a STANDING building with a job on it. ──
    tiles[SUBJ].bld = { k: 1, l: 2, s: Date.now(), d: 3600 };
    let absentDuring = 0, idChanged = 0, movedDuring = [], vanished = 0;
    /* 🔴 CONTINUOUS, NOT ENDPOINT. An earlier draft compared the firm's books
       only before and after the window and both checks stayed GREEN under the
       sabotage: the replacement firm had out-earned the original's recorded
       revenue by the time the window closed, and Firms.reap() DELETES a
       bankrupt firm outright so `snapshot().bankrupt` reads 0 afterwards. The
       reap is only visible while it is happening. So the books are read at
       every sync and any DROP is the finding. */
    let prevRev = BEFORE ? BEFORE.rev : 0;
    let prevSup = BEFORE ? BEFORE.sup : [];
    let revDropped = [], supShrank = 0;
    const upSyncStart = syncTotal;
    for (let d = 0; d < 10; d++) {
      if (SABOTAGE === 'withdraw' && d === 0) {
        WITHHOLD = SUBJ;                 // 🧨 exactly one sync, exactly as bldBusy would
        console.log('   🧨 withholding ' + SUBJ + ' from the reconcile list for one sync');
      }
      const dS = sync();
      WITHHOLD = null;
      if (Math.abs(dS) > 1e-9) movedDuring.push('sync' + d + ' Δ' + dS.toFixed(2));
      if (!inList(SUBJ)) absentDuring++;
      const f = firmAt(SUBJ);
      if (!f) { vanished++; idChanged++; }
      else {
        if (!BEFORE || f.id !== BEFORE.id) idChanged++;
        if (f.lifetimeRevenue + 1e-9 < prevRev)
          revDropped.push('sync' + d + ' ' + prevRev.toFixed(0) + '→' + f.lifetimeRevenue.toFixed(0));
        if (!prevSup.every(s => f.suppliers && f.suppliers[s])) supShrank++;
        prevRev = f.lifetimeRevenue;
        prevSup = Object.keys(f.suppliers || {});
      }
      tick();
    }
    chk('the business never disappears mid-upgrade', vanished === 0,
        vanished + ' of 10 syncs found NO firm on the tile');
    chk('lifetime revenue never drops at any sync of the upgrade (a refound zeroes it)',
        revDropped.length === 0, revDropped.join(', '));
    chk('the supplier set never shrinks at any sync of the upgrade',
        supShrank === 0, supShrank + ' of 10 syncs lost a supplier');
    chk('an UPGRADING tile is in the reconcile list on every sync of the job',
        absentDuring === 0, absentDuring + ' of 10 syncs withdrew it');
    chk('the firm id never changes during the upgrade', idChanged === 0,
        idChanged + ' of 10 syncs saw a different (or missing) firm');
    chk('NO CINDER MOVES AT SYNC during an upgrade — a reap would show up here first',
        movedDuring.length === 0, movedDuring.join(', ') +
        ' (total ' + (syncTotal - upSyncStart).toFixed(2) + ' 🔥)');

    // ── 5. COMPLETE THE UPGRADE. Still there, still the same business. ─────
    delete tiles[SUBJ].bld; tiles[SUBJ].lvl = 2;
    const dDone = sync(); tick();
    const f1 = firmAt(SUBJ);
    chk('the tile is present after the upgrade completes', inList(SUBJ) && !!f1);
    chk('same firm id across the whole cycle',
        !!f1 && !!BEFORE && f1.id === BEFORE.id,
        BEFORE ? 'id ' + BEFORE.id + ' → ' + (f1 ? f1.id : 'GONE') : 'no baseline');
    /* ⚠ `f1.id === BEFORE.id` is part of BOTH of these on purpose. A
       replacement firm can out-earn the original's recorded revenue and can
       re-acquire the same two suppliers within a few days, so without the
       identity clause these read green over a city that lost the business and
       quietly built another one on its rubble. */
    chk('the SAME firm still holds its lifetime revenue',
        !!f1 && !!BEFORE && f1.id === BEFORE.id && f1.lifetimeRevenue >= BEFORE.rev,
        BEFORE ? 'id ' + BEFORE.id + '→' + (f1 ? f1.id : '—') + ', rev ' +
                 BEFORE.rev.toFixed(0) + '→' + (f1 ? f1.lifetimeRevenue.toFixed(0) : '—') : '');
    chk('the SAME firm still holds its supplier set',
        !!f1 && !!BEFORE && f1.id === BEFORE.id &&
        BEFORE.sup.every(s => f1.suppliers && f1.suppliers[s]),
        BEFORE ? 'id ' + BEFORE.id + '→' + (f1 ? f1.id : '—') + ', suppliers [' +
                 BEFORE.sup.join(',') + '] → [' +
                 (f1 ? Object.keys(f1.suppliers || {}).sort().join(',') : '') + ']' : '');
    chk('the rung was never reset to a fresh HEALTHY after a BANKRUPT',
        !!f1 && f1.rung !== 'BANKRUPT' && E.snapshot().bankrupt === 0,
        (f1 ? 'rung ' + f1.rung + ', ' : '') + E.snapshot().bankrupt + ' bankrupt firms in the city');
    chk('completing the upgrade moves no Cinder either (no refound)',
        Math.abs(dDone) < 1e-9, dDone.toFixed(4) + ' 🔥');

    // ── 6. THE BOOKS, CLOSED OVER THE WHOLE CYCLE. ─────────────────────────
    const END = E.totalCinder();
    const drift = (END - START) - expected - syncTotal;
    const tol = Math.max(1, Math.abs(END) * 1e-6);
    console.log('\n  💰 place → build → complete → upgrade → complete');
    console.log('     totalCinder     ' + START.toFixed(2) + ' → ' + END.toFixed(2) +
                '   (Δ ' + (END - START).toFixed(2) + ')');
    console.log('     audited flows   ' + expected.toFixed(2) + '   (faucet − imports − payout)');
    console.log('     founding seeds  ' + syncTotal.toFixed(2) + '   (measured at syncBuildings)');
    console.log('     unexplained     ' + drift.toFixed(6) + '   (tolerance ' + tol.toFixed(4) + ')\n');
    chk('no Cinder was minted or burned outside the audited terms', Math.abs(drift) <= tol,
        'drift ' + drift.toFixed(6));
    chk('the day audit stayed clean throughout', !auditBad, auditBad);
    chk('payouts were never suspended', E.snapshot().payoutAllowed === true);

    if (fails) { bad++; console.log('\n=== ROUND 0c: ' + fails + ' FAILED ==='); }
    else console.log('\n=== ROUND 0c: ALL PASS ===');
  }
}
for (const f of ['gauntlet1.mjs', 'gauntlet2.mjs', 'gauntlet3.mjs']) {
  console.log('\n########## ' + f + ' ##########');
  const r = spawnSync(process.execPath, [join(here, f)], { stdio: 'inherit' });
  if (r.status !== 0) bad++;
}
console.log(bad ? '\n❌ ECONOMY GAUNTLET: ' + bad + ' round(s) failed' : '\n✅ ECONOMY GAUNTLET: all rounds passed');
process.exit(bad ? 1 : 0);
