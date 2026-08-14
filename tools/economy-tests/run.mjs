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
     ECON_TEST_SABOTAGE=no-map     round0b AND round0d: read node-city from a
                                   path that is not there, i.e. extraction
                                   returns NOTHING
     ECON_TEST_SABOTAGE=withdraw   round0c: withdraw an UPGRADING tile from the
                                   reconcile list for exactly one sync — the
                                   invariant at node-city:17117, violated once
     ECON_TEST_SABOTAGE=seed-mint  round0e: credit one new firm its seed capital
                                   out of nowhere, inside the between-tick gap —
                                   the original firms.js mint, re-committed once
     ECON_TEST_SABOTAGE=charter-cap round0e: push the lifetime founding tally
                                   past its ceiling, i.e. a second issuance path
                                   that ignores the clamp
     ECON_TEST_SABOTAGE=reap-burn  round0e: burn a demolished firm's cash at the
                                  seam, exactly as Firms.reap() used to
    ECON_TEST_SABOTAGE=draw-compound round0e: open the founding window's treasury
                                   allowance, reproducing the per-call clamp that
                                   let one sync take 91.15% of the treasury

   ⚠ Every one of these must turn the gate RED. If you change these rounds, run
     all of them and check that they still do; an unset variable is the shipping
     path and does nothing. */
const SABOTAGE = process.env.ECON_TEST_SABOTAGE || '';
if (SABOTAGE) console.log('🧨 ECON_TEST_SABOTAGE=' + SABOTAGE + ' — this run is DELIBERATELY injured and MUST fail.');

/* Filled by round 0b, consumed by round 0c: the real ECO_BUILDING_MAP as read
   out of node-city/index.html. 0c reconciles against the SAME map the city
   does rather than against a hand-kept copy — gauntlet3.mjs keeps such a copy
   (its `MAP` literal) and it has already fallen 5 entries behind. */
let CITY_MAP = null;

/* Brace-match the `{…}` block that starts at `decl`, stepping over block
   comments, line comments and quoted strings — node-city is full of prose and
   OP_BP carries an escaped apostrophe ("the city\'s Health coverage"), both of
   which a naive scan would miscount. Returns the block TEXT, comments and all:
   `new Function` parses those natively, so nothing has to be stripped and no
   regex has to understand JavaScript. Returns null on an unbalanced scan —
   NEVER a guess, because a half-read block passes vacuously.
   Module scope because BOTH round0b (object literals) and round0d (the body of
   `function ecoHost()`) read the shipped file this way; the second copy was
   written and then deleted. */
const srcBlockAfter = (src, decl) => {
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

  /* The brace-matching scanner lives at module scope (`srcBlockAfter`) because
     round0d reads `function ecoHost()` out of the same file the same way. */
  const literalObj = (decl) => {
    const txt = srcBlockAfter(HTML, decl);
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
       then sets rung='BANKRUPT' and Firms.reap() DELETES the firm: its id, its
       lifetime revenue, its supplier set and its rung are gone, and a fresh
       firm is founded on the rubble when the job ends. No warn. No throw. No
       log line.
       ⚠ IT USED TO TAKE THE CASH WITH IT TOO, and that is fixed — `reap()` now
         hands a closing firm's balance to the treasury (sim.js `receiveEstate`)
         so the money survives. That makes the MONEY assertion below blind to
         this particular failure and the IDENTITY assertions the only ones that
         still see it. Both are kept: money moving at this seam is a different
         bug, and this is the round positioned to catch it.
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
               that delta must be EXACTLY zero. It is the guard against ANY
               Cinder crossing this seam — not, any longer, against the reap
               itself: founding draws on the charter fund and a wind-up pays
               into the treasury, so both halves are transfers and both read 0
               here. Round 0e owns the demolition seam directly.

   ⚠ MEASURED, NOT MODELLED — AND THE MEASUREMENT CHANGED WHAT IT PROVES.
     `Firms.found()` USED to credit a new firm dailyOperatingCost ×
     ECON.firm.startCashDays out of nowhere, and because founding happens
     between ticks the day audit never saw a Cinder of it: this round measured
     721,771 🔥 of it in a 240-day city against −6,159 🔥 of audited flow. Seed
     capital now comes out of the CHARTER FUND (sim.js, `fundFounding`), which
     is a term of totalCinder(), so a founding moves the total by ZERO and the
     sync term below is zero at EVERY sync rather than only during an upgrade.
     The books are still closed the honest way,
        Δ totalCinder = Σ(faucet + founding − imports − payout) + Σ(sync deltas)
     with the sync term measured directly — it is just that the sync term is
     now expected to be flat 0, which is a much stronger statement than the
     "measure whatever it minted and add it back" closure it replaces.
     Round 0e owns the bound on the `founding` term itself.

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
      expected += s.flow.faucet + (s.flow.founding || 0) - s.flow.imports - s.flow.payout;
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
    /* 🔴 THIS CHECK USED TO ASSERT `dFound > 0` — i.e. it PINNED the mint,
       because at the time the mint was the truth and a test that models what
       ought to happen instead of what does is worthless. Founding is now a
       transfer out of the charter fund, so the honest assertion is the
       opposite one, and it is stronger: no Cinder appears at the seam, and the
       business is nevertheless capitalised. Both halves matter — "0 moved" is
       also what a founding that funded NOTHING would print. */
    chk('founding moves NO Cinder at the seam — seed capital is a transfer, not a mint',
        Math.abs(dFound) < 1e-9, 'sync moved ' + dFound.toFixed(2) + ' 🔥');
    chk('...and the business was actually capitalised out of the charter fund',
        !!born && born.cash > 0 && born.cash <= born.seedWant + 1e-9,
        born ? 'cash ' + born.cash.toFixed(2) + ' of seedWant ' + (born.seedWant || 0).toFixed(2) : 'no firm');

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
    /* ⚠ NOT the reap detector any more — see the header. A reap is a transfer
       in both directions now, so this reads 0 either way; the identity checks
       above are what catch the withdrawal. This still guards the seam against
       anything that DOES move money across it. */
    chk('NO CINDER MOVES AT SYNC during an upgrade',
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
    console.log('     audited flows   ' + expected.toFixed(2) + '   (faucet + founding − imports − payout)');
    console.log('     seam movement   ' + syncTotal.toFixed(2) + '   (measured at syncBuildings — must be 0)');
    console.log('     unexplained     ' + drift.toFixed(6) + '   (tolerance ' + tol.toFixed(4) + ')\n');
    chk('no Cinder was minted or burned outside the audited terms', Math.abs(drift) <= tol,
        'drift ' + drift.toFixed(6));
    chk('the day audit stayed clean throughout', !auditBad, auditBad);
    chk('payouts were never suspended', E.snapshot().payoutAllowed === true);

    if (fails) { bad++; console.log('\n=== ROUND 0c: ' + fails + ' FAILED ==='); }
    else console.log('\n=== ROUND 0c: ALL PASS ===');
  }
}
/* ════════════════════════════════════════════════════════════════════════════
   ROUND 0d — 🏦 THE DEAD DEBT RUNG
   ----------------------------------------------------------------------------
   THE BUG THIS ROUND EXISTS FOR, and it shipped:

     ecoHost() answered  `hasBank: …some(t => t.type === 'bank' && …)`

   but the bank tile is BUILDINGS['op_bank'], registered by the OPS loop off
   OPS_PREFIX. NO TILE IS EVER THE BARE STRING 'bank'. So hasBank was
   permanently false, sim.js never capitalised the lender, bank.js answered
   "No bank in the city" to every request, and the ENTIRE DEBT RUNG — borrow,
   interest, amortisation, missed payment, default, write-off — was dead code
   that had never once executed in production. Nothing was red, because dead
   code is quiet.

   Two halves, and neither alone is enough:

     THE TILE TEST   `function ecoHost()` is read OUT OF THE SHIPPED FILE and
                     evaluated. Not a copy — round0c has to copy `bldSite`
                     because it is a const arrow inside an IIFE, and the header
                     there says plainly that a copy tests a fiction if the two
                     drift. ecoHost is a plain `function`, so it can be lifted
                     whole and driven over real tile shapes.
     THE RUNG        a city with a real op_bank tile is driven through
                     capitalise → borrow → accrue → repay, and the loan is
                     followed by id the whole way. "hasBank is true" would pass
                     over a lender that still refuses every application.

   🔴 PROVING THE KEY IS DERIVED, NOT TYPED. `opsKeyOf('bank')` and the literal
      'op_bank' are textually different and behaviourally identical — until the
      prefix moves, at which point the literal becomes this exact bug again. So
      the strong check is not a grep: ecoHost is run a SECOND time with
      opsKeyOf stubbed to a different prefix, and the answer has to FOLLOW the
      stub. A hardcoded key cannot pass that. The greps are kept as well,
      because they name the mistake in the failure message.

   ⚠ WHICH TWO TERMS THE MONEY MOVES BETWEEN (Rule 1). totalCinder() is
     HH.totalSavings() + Firms.totalCash() + S.treasury + Bank.state().reserve.
     Seeding the lender moves treasury → reserve; a loan moves reserve → firm
     cash; a repayment moves firm cash → reserve. All four terms are INSIDE the
     sum, so every leg is a transfer and none of it mints. This round asserts
     that arithmetic directly rather than trusting the audit to notice.

   ⚠ ROUND ORDER MATTERS. This runs after 0c and re-mounts the economy on its
     own node; the modules are singletons in this process and a round that
     inherited 0c's firms would be measuring 0c's city.
   ════════════════════════════════════════════════════════════════════════════ */
{
  console.log('\n########## round0d-bank-debt-rung ##########');
  let fails = 0;
  const chk = (name, cond, extra) => {
    if (cond) { console.log('✅ ' + name); return true; }
    fails++; console.log('❌ ' + name + (extra ? ' :: ' + extra : '')); return false;
  };

  /* ECON_TEST_SABOTAGE=no-map injures this round too, not only round0b: this
     round's extraction has exactly the same vacuity failure mode — a scrape
     that matches nothing would sail past every assertion below while the
     comment in index.html still claimed the tile test was guarded. */
  let HTML = null;
  try {
    HTML = readFileSync(join(here, SABOTAGE === 'no-map'
      ? '../../public/node-city/THIS-FILE-DOES-NOT-EXIST.html'
      : '../../public/node-city/index.html'), 'utf8');
  } catch (e) { HTML = null; }
  const BODY = srcBlockAfter(HTML, 'function ecoHost() {');
  const prefixM = HTML ? /const\s+OPS_PREFIX\s*=\s*'([^']*)'/.exec(HTML) : null;
  const PREFIX = prefixM ? prefixM[1] : null;

  const got =
    chk('read ecoHost() out of node-city/index.html',
        !!BODY && BODY.indexOf('hasBank') > 0,
        BODY ? BODY.length + ' chars, no hasBank in it' : 'UNREADABLE or unbalanced — the tile test cannot be checked at all') &
    chk('read OPS_PREFIX out of node-city/index.html', !!PREFIX, String(PREFIX));

  if (!got) {
    /* Same rule as round0b: a scrape that matched nothing must fail HARD, not
       pass vacuously. If ecoHost was renamed, fix the marker above. */
    console.log('\n🔴 ecoHost() COULD NOT BE READ — nothing below was checked.');
    bad++; console.log('\n=== ROUND 0d: ' + fails + ' FAILED ===');
  } else {
    // ── 1. THE TILE TEST, read from source and then actually run ───────────
    const clause = BODY.slice(BODY.indexOf('hasBank:'), BODY.indexOf('infrastructure:'));
    chk('the hasBank clause derives its key through opsKeyOf()',
        /opsKeyOf\(\s*'bank'\s*\)/.test(clause), clause.trim().slice(0, 120));
    chk("the hasBank clause contains NO hardcoded 'op_bank' — one prefix change from being this bug again",
        !/['"]op_bank['"]/.test(clause), clause.trim().slice(0, 200));
    chk("the original bug is gone: no `t.type === 'bank'`",
        !/type\s*===\s*['"]bank['"]/.test(clause), clause.trim().slice(0, 200));
    chk('the clause still refuses a DAMAGED bank', /!\s*t\.damaged/.test(clause));
    chk('the clause guards on bldSite (a SITE is inert), NOT bldBusy (an upgrading bank still lends)',
        /bldSite\s*\(/.test(clause) && !/bldBusy\s*\(/.test(clause), clause.trim().slice(0, 200));

    /* ⚠ COPIED VERBATIM FROM node-city, same as round0c's copy and for the same
       reason — a const arrow inside an IIFE cannot be imported. If these drift,
       round0c fails first and loudly. */
    const bldSite = t => !!(t && t.bld && t.bld.k === 0);

    /* Lift the shipped function whole and hand it everything it reaches for.
       ecoShock() is stubbed to 1: this round is about one boolean and the shock
       curve has its own coverage. */
    const runHost = (tiles, keyFn) => {
      const names = ['game', 'cityPop', 'ecoLogisticsCounts', 'bldSite', 'opsKeyOf',
                     'ecoShock', 'roadUsed', 'roadCap'];
      const fn = new Function(...names, 'return (function ecoHost() ' + BODY + ')();');
      return fn(
        { tiles, cov: { avg: 0.75, pct: { water: 1 } }, power: { factor: 1 } },
        () => 60, () => ({ warehouse: 3, depot: 2 }), bldSite, keyFn,
        () => 1, () => 0, () => 1);
    };
    const realKey = ty => PREFIX + ty;
    const asks = tiles => !!runHost(tiles, realKey).hasBank;

    const BANK_T = PREFIX + 'bank';
    const standing = { '1,0': { type: 'grocery', lvl: 1 }, '2,0': { type: BANK_T, lvl: 1 } };
    const bareStr  = { '1,0': { type: 'grocery', lvl: 1 }, '2,0': { type: 'bank',  lvl: 1 } };
    const site     = { '1,0': { type: 'grocery', lvl: 1 },
                       '2,0': { type: BANK_T, lvl: 1, bld: { k: 0, l: 1, s: Date.now(), d: 900 } } };
    const upgrading= { '1,0': { type: 'grocery', lvl: 1 },
                       '2,0': { type: BANK_T, lvl: 1, bld: { k: 1, l: 2, s: Date.now(), d: 900 } } };
    const damaged  = { '1,0': { type: 'grocery', lvl: 1 }, '2,0': { type: BANK_T, lvl: 1, damaged: true } };

    /* 🐛 THE BUG, REPRODUCED. This is the predicate that shipped, written out,
       run over the SAME city that the fixed one answers true for. It is here so
       the round shows the before as well as the after — a green test that only
       ever saw the fixed code cannot tell you the bug was real. */
    const PRE_FIX = tiles => Object.values(tiles).some(t => t.type === 'bank' && !t.damaged && !bldSite(t));
    chk("BEFORE: the shipped predicate (`t.type === 'bank'`) is FALSE with a bank standing — the whole bug",
        PRE_FIX(standing) === false, 'tile type is ' + BANK_T);
    chk('AFTER: the fixed clause is TRUE with the same bank standing', asks(standing) === true);

    chk('no bank at all ⇒ false', asks({ '1,0': { type: 'grocery', lvl: 1 } }) === false);
    chk("a tile literally typed 'bank' ⇒ false (no such tile exists; the old string matched nothing)",
        asks(bareStr) === false);
    chk('🏗 a construction SITE bank ⇒ false (a hole in the ground makes no loans)', asks(site) === false);
    chk('an UPGRADING bank ⇒ TRUE (bldSite, not bldBusy — a working branch stays live)',
        asks(upgrading) === true);
    chk('a DAMAGED bank ⇒ false', asks(damaged) === false);

    /* THE DERIVATION CHECK. Move the prefix and the answer must move with it. */
    const swapped = ty => 'zz_' + ty;
    chk('the key is DERIVED: with opsKeyOf stubbed to a different prefix, op_bank stops counting',
        runHost(standing, swapped).hasBank === false,
        'a hardcoded op_bank would still read true here');
    chk('…and zz_bank starts counting instead',
        runHost({ '2,0': { type: 'zz_bank', lvl: 1 } }, swapped).hasBank === true);

    // ── 2. THE RUNG. A real city, a real op_bank tile, a real loan. ────────
    if (!global.window) {
      global.window = { MythicCityBridge: { addCinders: async () => {} }, MythicResourceChain: null };
      const chain = await import('../../public/src/resources/chain.js');
      global.window.MythicResourceChain = { ALL: chain.RESOURCE_CHAIN };
    }
    const P = '../../public/src/economy/';
    const E = (await import(P + 'index.js')).default;
    const { ECON } = await import(P + 'tuning.js');
    const DAY = ECON.clock.dayMin;

    E.mount({ nodeId: 'bank-rung', population: 60 });

    const tiles = {
      '1,0': { type: 'lumbercamp', lvl: 1 }, '2,0': { type: 'purifier', lvl: 1 },
      '3,0': { type: 'farm', lvl: 1 },       '4,0': { type: 'grocery', lvl: 1 },
      '5,0': { type: 'sawmill', lvl: 1 },    '6,0': { type: 'housing', lvl: 2 },
      /* 🏦 The subject. CITY_MAP has no op_bank row on purpose (round0b asserts
         that), so this tile founds NO firm — its entire economic effect is the
         boolean under test. */
      '9,0': { type: BANK_T, lvl: 1 },
    };
    const list = () => Object.entries(tiles)
      .filter(([, t]) => CITY_MAP[t.type] && !t.damaged && !bldSite(t))
      .map(([k, t]) => {
        const o = E.pickAvailable(CITY_MAP[t.type].out);
        return o ? { key: k, out: o, ind: CITY_MAP[t.type].ind, lvl: t.lvl } : null;
      }).filter(Boolean);

    E.syncBuildings(list());
    chk('the bank tile founds no business (it is not in ECO_BUILDING_MAP)',
        !E.firms().some(f => f.tileKey === '9,0'));

    /* The host is the SHIPPED ecoHost, over the SHIPPED tile test. Nothing
       between the fix and the lender is hand-written here. */
    const host = () => runHost(tiles, realKey);
    chk('the shipped ecoHost reports hasBank for this city', host().hasBank === true);

    /* The FIVE terms of totalCinder(), read the way sim.js defines them.
       ⚠ `charter` is the newest of them and it is the one a future edit is most
       likely to forget: the charter fund is a real balance that founding draws
       on, so leaving it out of this sum would read as a leak of exactly the
       unspent seed capital and would send the next reader hunting a phantom. */
    const terms = () => { const s = E.snapshot();
      return { savings: s.savings, firmCash: s.firmCash, treasury: s.treasury,
               charter: s.charter, reserve: s.bank.reserve, total: s.totalCinder }; };
    const SUM_TOL = 1e-6;
    let auditBad = null, flows = 0;
    const tick = () => {
      E.tick(DAY, host());
      const s = E.snapshot();
      flows += s.flow.faucet + (s.flow.founding || 0) - s.flow.imports - s.flow.payout;
      if (!s.audit || !s.audit.ok) auditBad = JSON.stringify(s.audit);
    };

    const START = E.snapshot().totalCinder;
    const seedT0 = terms();
    const flows0 = flows;
    tick();                                    // the day the lender is capitalised
    const seedT1 = terms();
    chk('CAPITALISE: the lender has a reserve for the first time in this feature\'s life',
        seedT0.reserve === 0 && seedT1.reserve > 0,
        'reserve ' + seedT0.reserve.toFixed(2) + ' → ' + seedT1.reserve.toFixed(2));
    /* ⚠ NOT `treasury went down`. That was the first draft and it failed
       honestly: the seeding happens at step 5 of runDay, and steps 7–8 of the
       SAME day then pay corporate tax and property tax INTO the treasury, so
       the day's net treasury move is upward (0.00 → 8.00 on the run that
       caught this) even though the seed left it. An endpoint comparison cannot
       see an intra-day transfer. What CAN be asserted exactly is the pair of
       claims that actually matter: the reserve appeared, and the day's total
       moved by nothing but the audited flows — i.e. the seed was a transfer
       between two totalCinder() terms, not a mint. The debit itself is pinned
       at its source below, where sim.js writes it. */
    chk('CAPITALISE mints nothing: the seeding day moves totalCinder by exactly the audited flows',
        Math.abs((seedT1.total - seedT0.total) - (flows - flows0)) <= Math.max(1, Math.abs(seedT1.total) * 1e-6),
        'Δtotal ' + (seedT1.total - seedT0.total).toFixed(6) + ' vs flows ' + (flows - flows0).toFixed(6));
    /* The two terms, named at the source. `S.treasury -= Bank.capitalise(seed)`
       debits the treasury by EXACTLY what the lender accepted — the judge's
       audit-safety argument in one line, and the line a future edit is most
       likely to break by debiting `seed` instead of the return value (they
       differ whenever the treasury is short). */
    let simSrc = '';
    try { simSrc = readFileSync(join(here, '../../public/src/economy/sim.js'), 'utf8'); } catch (e) {}
    chk('the seed is `S.treasury -= Bank.capitalise(…)` — debited by the amount actually accepted',
        /S\.treasury\s*-=\s*Bank\.capitalise\(/.test(simSrc),
        'sim.js no longer debits the treasury by capitalise()\'s return value');

    // Trade for a fortnight so a firm has a revenue average to borrow against.
    for (let d = 0; d < 14; d++) tick();

    const cands = E.firms().filter(f => f.rung !== 'BANKRUPT' && (f.revenueAvg || 0) > 0)
                           .sort((a, b) => (b.revenueAvg || 0) - (a.revenueAvg || 0));
    chk('at least one business is trading and could service a loan', cands.length > 0,
        E.firms().length + ' firms, none with revenue');
    const subject = cands[0] || null;

    // ── BORROW — the exact call the panel's 🏦 Borrow button makes ─────────
    const before = terms();
    const beforeLoans = E.snapshot().bank.loans;
    const beforeDebt = E.snapshot().firmDebt;
    const r = subject ? E.borrow(subject.id, Infinity) : { ok: false, why: 'no firm' };
    chk('BORROW: the lender advances — the rung EXECUTES for the first time',
        !!(r && r.ok && r.amount >= 1),
        r ? ('refused: ' + (r.why || '?') + ' (this is the sentence the dead rung always gave)') : 'no result');
    const after = terms();
    const loan = (r && r.ok && r.loan) ? r.loan : null;

    chk('the loan appears on the book', E.snapshot().bank.loans === beforeLoans + 1,
        beforeLoans + ' → ' + E.snapshot().bank.loans);
    chk('the borrower carries the debt', Math.abs(E.snapshot().firmDebt - beforeDebt - (r.amount || 0)) < 1e-6,
        beforeDebt.toFixed(2) + ' → ' + E.snapshot().firmDebt.toFixed(2));
    chk('BORROW moves reserve → firm cash, and ONLY those two terms',
        Math.abs((before.reserve - after.reserve) - (r.amount || 0)) < 1e-6 &&
        Math.abs((after.firmCash - before.firmCash) - (r.amount || 0)) < 1e-6 &&
        Math.abs(after.treasury - before.treasury) < 1e-6 &&
        Math.abs(after.savings - before.savings) < 1e-6,
        'Δreserve ' + (after.reserve - before.reserve).toFixed(2) +
        ', ΔfirmCash ' + (after.firmCash - before.firmCash).toFixed(2) +
        ', Δtreasury ' + (after.treasury - before.treasury).toFixed(2));
    chk('RULE 1: totalCinder is unchanged across the borrow — a loan mints nothing',
        Math.abs(after.total - before.total) < Math.max(1e-6, Math.abs(after.total) * 1e-9),
        before.total.toFixed(6) + ' → ' + after.total.toFixed(6));

    /* ── ACCRUE and REPAY ──────────────────────────────────────────────────
       🔴 FOLLOWED BY THE LOAN OBJECT, NOT BY CITY AGGREGATES. The first draft
       asserted on snapshot().bank counts and it failed HONESTLY, twice over:
       sim.js calls Bank.autoBorrow() for every DEBT/DEFAULT firm each day, so
       this city opened several OTHER loans to dying businesses, one of which
       went bankrupt and had 179.25 🔥 written off. Both are the rung working
       exactly as designed — "the reserve eats it, that is what a bad loan book
       costs" — but they make `written === 0` and `loans === 0` say nothing
       about the loan under test. So the subject loan is tracked through the
       object `borrow()` returned, which stays live in LENDER.loans and, when
       it is removed, KEEPS its final `owed` — the one field that separates a
       loan repaid (≈0) from a loan defaulted (>0). */
    const Bank = await import(P + 'bank.js');
    const L = Bank.state();
    const principal = loan ? loan.principal : 0;
    const openMine = () => !!loan && L.loans.some(x => x.id === loan.id);
    let paidMine = 0, interestMine = 0, cleared = -1, otherLoans = 0;
    for (let d = 0; d < ECON.bank.termDays + 60 && loan; d++) {
      const owed0 = loan.owed, day0 = E.snapshot().day;
      tick();
      const elapsed = E.snapshot().day - day0;
      /* bank.js: interest = owed * (rate/365) * days, added BEFORE the payment
         is taken. Recomputed here rather than read, so this is an independent
         check of the arithmetic and not a restatement of it. */
      const i = owed0 * (loan.rate / 365) * elapsed;
      interestMine += i;
      paidMine += (owed0 + i) - loan.owed;
      otherLoans = Math.max(otherLoans, L.loans.length - (openMine() ? 1 : 0));
      if (!openMine()) { cleared = d; break; }
    }
    chk('ACCRUE: interest was charged on the loan (rate ' +
        (loan ? (loan.rate * 100).toFixed(2) : '—') + '%/yr)',
        interestMine > 0, 'no interest accrued over ' + (cleared + 1) + ' days');
    chk('ACCRUE: repayments flow firm cash → reserve', paidMine > 0,
        'nothing was ever paid back');
    chk('REPAY: the borrower paid back MORE than it borrowed — debt is not free money',
        paidMine > principal + 1e-6,
        'principal ' + principal.toFixed(2) + ', paid ' + paidMine.toFixed(2));
    chk('REPAY: the subject loan cleared inside its term', cleared >= 0,
        'still open after ' + (ECON.bank.termDays + 60) + ' days');
    chk('REPAY: it cleared by being PAID OFF, not written off or defaulted',
        !!loan && loan.owed <= 0.01 && subject.rung !== 'BANKRUPT' && !(subject.blacklistUntil > 0),
        loan ? ('final owed ' + loan.owed.toFixed(2) + ', rung ' + subject.rung +
                ', blacklistUntil ' + (subject.blacklistUntil || 0)) : 'no loan');
    chk('the borrower is out of debt', Math.abs(subject.debt || 0) < 1e-6,
        String(subject.debt));
    chk('the reserve was never negative while lending', L.reserve >= 0, L.reserve.toFixed(2));
    /* Informational, and it is the other half of the rung proving it runs: the
       AUTOMATIC distress path (sim.js → Bank.autoBorrow) opened loans of its
       own, and the write-off branch executed on a business that failed. Not
       asserted — a healthy run may legitimately produce neither. */
    console.log('   ℹ the automatic distress path also ran: ' + otherLoans +
                ' other loan(s) open at peak, ' + L.lifetimeWritten.toFixed(2) +
                ' 🔥 written off across the city.');

    // ── THE BOOKS, over the whole capitalise → borrow → accrue → repay ─────
    const END = E.snapshot().totalCinder;
    const T = terms();
    const drift = (END - START) - flows;
    const tol = Math.max(1, Math.abs(END) * 1e-6);
    const bk = E.snapshot().bank;
    console.log('\n  🏦 capitalise → borrow → accrue → repay');
    console.log('     subject loan    principal ' + principal.toFixed(2) + ' → paid ' +
                paidMine.toFixed(2) + ' (interest ' + interestMine.toFixed(2) +
                ') over ' + (cleared + 1) + ' days');
    console.log('     city loan book  lent ' + bk.lent.toFixed(2) + ' · repaid ' + bk.repaid.toFixed(2) +
                ' · written ' + bk.written.toFixed(2) + ' · open ' + bk.loans);
    console.log('     terms  savings ' + T.savings.toFixed(2) + ' + firmCash ' + T.firmCash.toFixed(2) +
                ' + treasury ' + T.treasury.toFixed(2) + ' + charter ' + T.charter.toFixed(2) +
                ' + reserve ' + T.reserve.toFixed(2));
    console.log('     totalCinder     ' + START.toFixed(2) + ' → ' + END.toFixed(2) +
                '   (Δ ' + (END - START).toFixed(2) + ')');
    console.log('     audited flows   ' + flows.toFixed(2) + '   (faucet + founding − imports − payout)');
    console.log('     unexplained     ' + drift.toFixed(6) + '   (tolerance ' + tol.toFixed(4) + ')\n');
    chk('the five terms still sum to totalCinder()',
        Math.abs((T.savings + T.firmCash + T.treasury + T.charter + T.reserve) - T.total) < SUM_TOL,
        (T.savings + T.firmCash + T.treasury + T.charter + T.reserve).toFixed(6) + ' vs ' + T.total.toFixed(6));
    /* ⚠ No syncBuildings runs inside this window — the city is fixed — so no
       founding TRANSFER happens here at all. The `founding` term in `flows` is
       still carried because the charter fund tops itself up inside runDay
       whenever it is below target, and that issuance is audited creation like
       the export faucet. */
    chk('RULE 1: no Cinder minted or burned with the DEBT RUNG LIVE',
        Math.abs(drift) <= tol, 'drift ' + drift.toFixed(6));
    chk('the day audit stayed clean throughout', !auditBad, auditBad);
    chk('payouts were never suspended', E.snapshot().payoutAllowed === true);

    /* RULE 5. Belt and braces, in the gate rather than in a reviewer's memory:
       the simulated lender must never reach the player's real Cinder. */
    let bankSrc = '';
    try { bankSrc = readFileSync(join(here, '../../public/src/economy/bank.js'), 'utf8'); } catch (e) {}
    chk('RULE 5: bank.js names no player-money symbol (Profile.gems / player_banks / spendGems / addGems)',
        !!bankSrc && !/Profile\s*\.\s*gems|player_banks|spendGems|addGems|MythicCityBridge/.test(
          bankSrc.replace(/\/\*[\s\S]*?\*\//g, '')),
        'bank.js reaches for real player money');

    if (fails) { bad++; console.log('\n=== ROUND 0d: ' + fails + ' FAILED ==='); }
    else console.log('\n=== ROUND 0d: ALL PASS ===');
  }
}
/* ════════════════════════════════════════════════════════════════════════════
   ROUND 0e — 🏦 THE FOUNDING MINT, AND THE CEILING THAT NOW BOUNDS IT
   ----------------------------------------------------------------------------
   THE DEFECT THIS ROUND EXISTS FOR, measured on the pre-fix tree before a line
   was changed:

     firms.js:  f.cash = dailyOperatingCost(f) * ECON.firm.startCashDays

   credited every new firm and debited nothing. A city holding all 47 mapped
   tile types over 240 days minted 721,771 🔥 that way (69 foundings — a firm
   that goes bankrupt is RE-founded on the next sync, so this is a pump and not
   a one-off) plus 182,997 🔥 at bootstrap, against −6,159 🔥 of audited flow —
   with ZERO failed day audits and payouts enabled throughout. The audit could
   not see it because the host founds firms from `syncBuildings` on a 4 s
   interval and `runDay` captures `before` at its own top: the creation happened
   between the audit windows, every single time. That is Rule 1 — "Cinder is
   never minted" — broken continuously, behind a green gate, for the whole life
   of the file.

   So this round asserts the two claims the fix rests on, and neither one is a
   restatement of the day audit:

     TRANSFER  totalCinder() is read either side of EVERY syncBuildings call and
               must move by EXACTLY zero. Seed capital comes out of the charter
               fund, which is a term of totalCinder(); if anyone ever restores a
               credit in `found()` — or adds a second one — this is the check
               that goes red, and it goes red at the seam where it happens
               rather than in a drift number four hundred lines later.
     WIND-UP   AND THE SEAM IS WALKED IN BOTH DIRECTIONS, because for one round
               this round only ever walked it in one. The mint was fixed while
               its mirror image was left running: `syncBuildings` marks a
               DEMOLISHED tile's firm BANKRUPT, `Firms.reap()` deleted it, and
               its whole cash balance left totalCinder() in the same between-tick
               gap. Measured on the tree that shipped with the founding fix in
               it: 12 demolitions in a 60-day city destroyed 42,612.05 🔥 —
               8.73% of that city's entire money supply — and the next day's
               audit read err=-0.000000, payoutAllowed=true. A round that adds
               buildings and never removes one cannot tell those two states
               apart, so this one now razes as well as builds, and the estate
               (sim.js `receiveEstate`) makes the removal a transfer too.
     CEILING   `charterIssued` is every Cinder this city has EVER created as
               founding capital. It must never exceed ECON.firm.charter
               .lifetimeCap, and — the half that stops this round from being
               vacuous — it must actually REACH the cap in this run. A bound
               nothing ever touches proves nothing about a bound.

   And the consequence of the ceiling is asserted rather than assumed: once the
   fund is dry and the treasury cannot cover, a founding is FUNDED SHORT. The
   firm opens with less than it wanted (`seedShort > 0`), keeps existing, and
   nothing is invented to make up the difference.

   Prove this round can fail:
     ECON_TEST_SABOTAGE=seed-mint    re-commits the original bug for one sync
     ECON_TEST_SABOTAGE=charter-cap  pushes the lifetime tally past the ceiling
     ECON_TEST_SABOTAGE=reap-burn    re-commits the DEMOLITION burn for one sync
   ════════════════════════════════════════════════════════════════════════════ */
{
  console.log('\n########## round0e-charter-capital ##########');
  let fails = 0;
  const chk = (name, cond, extra) => {
    if (cond) { console.log('✅ ' + name); return true; }
    fails++; console.log('❌ ' + name + (extra ? ' :: ' + extra : '')); return false;
  };

  if (!global.window) {
    global.window = { MythicCityBridge: { addCinders: async () => {} }, MythicResourceChain: null };
    const chain = await import('../../public/src/resources/chain.js');
    global.window.MythicResourceChain = { ALL: chain.RESOURCE_CHAIN };
  }
  const P = '../../public/src/economy/';
  const E = (await import(P + 'index.js')).default;
  const Sim = await import(P + 'sim.js');
  const { ECON } = await import(P + 'tuning.js');
  const DAY = ECON.clock.dayMin;
  const C = ECON.firm.charter;

  E.mount({ nodeId: 'charter-0', population: 90 });
  const host = { powerFactor: 1, waterFactor: 1, logisticsCounts: { warehouse: 3, depot: 2 },
                 hasBank: true, infrastructure: 0.7 };

  /* 🔴 A BRAND-NEW CITY'S ENTIRE MONEY SUPPLY IS THE CHARTER TRANCHE.
     Households start at 0 savings and the treasury starts at 0 (sim.js reset),
     so before the fix this equality was against a number that fell out of
     however many firms bootstrap happened to seed and what they happened to
     cost. Now it is a stated quantity, and that is the point. */
  const START = E.totalCinder();
  chk('a fresh city holds exactly the bootstrap charter tranche and not a Cinder more',
      Math.abs(START - C.seed) < 1e-6, START.toFixed(2) + ' vs seed ' + C.seed.toFixed(2));
  chk('the bootstrap tranche is counted against the lifetime allowance',
      Math.abs(E.snapshot().charterIssued - C.seed) < 1e-6, String(E.snapshot().charterIssued));

  /* A city that keeps building. Every tile is a real map entry so the founding
     path is the shipped one; the point is the VOLUME, which is what drains the
     allowance and gets us to the ceiling inside a test-sized run. */
  const types = CITY_MAP ? Object.keys(CITY_MAP) : [];
  chk('round0b handed over the real building map', types.length > 0, 'no map — nothing to build');

  const tiles = {};
  const list = () => Object.entries(tiles).map(([k, t]) => {
    const m = CITY_MAP[t.type];
    const o = m ? E.pickAvailable(m.out) : null;
    return o ? { key: k, out: o, ind: m.ind, lvl: 1 } : null;
  }).filter(Boolean);

  let seamTotal = 0, worstSeam = 0, worstSeamAt = '', flows = 0, auditBad = null;
  let overCap = 0, peakIssued = 0, minted = false;
  /* 🪟 THE WINDOW DRAW. `winBase` is the treasury standing when the current
     founding window opened (sim.js arms the allowance at the close of runDay,
     so that is the balance right after a tick; before the very first tick the
     window arms lazily off whatever is there when the first founding draws).
     `winDrawn` is every Cinder foundings have taken out of the treasury since.
     The bound is on the WINDOW — see below for why per-founding was a fiction. */
  let winBase = Sim.state().treasury, winDrawn = 0;
  let worstDrawPct = 0, worstDrawAt = '', drawOver = 0, worstDrawDetail = '';
  /* Set by the demolition phase to the keys about to be removed, so the
     reap-burn sabotage can destroy their cash INSIDE the measured window —
     which is where `Firms.reap()` used to destroy it. Burning it before `t0` is
     read would show up as end-of-run drift instead of as a seam crossing, and
     would be testing the wrong assertion. */
  let RAZE_DOOMED = null, burned = false;
  const sync = (label) => {
    const t0 = E.totalCinder();
    const tre0 = Sim.state().treasury;
    if (SABOTAGE === 'reap-burn' && RAZE_DOOMED && !burned) {
      /* 🧨 THE DEMOLITION BURN, re-committed for exactly one sync: the firms
         about to be reaped have their cash destroyed instead of handed to the
         treasury — precisely what `Firms.reap()` did before `receiveEstate`
         existed, in this same between-tick gap, and with the same spotless
         audit on the following day. */
      let lost = 0;
      for (const k of RAZE_DOOMED) {
        const f = E.firms().find(x => String(x.tileKey) === String(k));
        if (f) { lost += f.cash; f.cash = 0; }
      }
      if (lost > 0) { burned = true;
        console.log('   🧨 destroyed ' + lost.toFixed(2) + ' 🔥 of demolished firms\' cash'); }
    }
    if (SABOTAGE === 'draw-compound') {
      /* 🧨 THE CEILING REMOVED, which is what the per-call clamp amounted to
         once `syncBuildings` founded ten tiles in one pass: each founding got
         its own share of whatever was left, so the "35%" bound multiplied out
         to 1 − 0.65^N. Forcing the budget open reproduces the same end state —
         a single sync draining the treasury the stabilisers run on. */
      Sim.state().foundingDrawBudget = Infinity;
    }
    E.syncBuildings(list());
    const drew = tre0 - Sim.state().treasury;
    if (drew > 0) winDrawn += drew;
    if (winBase > 1e-6) {
      const pct = winDrawn / winBase;
      if (pct > worstDrawPct) {
        worstDrawPct = pct; worstDrawAt = label;
        worstDrawDetail = winDrawn.toFixed(2) + ' 🔥 of a ' + winBase.toFixed(2) + ' 🔥 treasury';
      }
      if (winDrawn > winBase * C.treasuryDrawPct + Math.max(1e-6, winBase * 1e-9)) drawOver++;
    }
    if (SABOTAGE === 'seed-mint' && !minted) {
      /* 🧨 THE ORIGINAL BUG, re-committed for exactly one sync: a firm is
         credited its seed capital and nothing is debited, inside the same
         between-tick gap `syncBuildings` really runs in. */
      const f = E.firms().slice(-1)[0];
      if (f) { f.cash += f.seedWant || 1000; minted = true;
               console.log('   🧨 credited ' + f.name + ' ' + (f.seedWant || 1000).toFixed(2) + ' 🔥 out of nowhere'); }
    }
    const d = E.totalCinder() - t0;
    seamTotal += d;
    if (Math.abs(d) > Math.abs(worstSeam)) { worstSeam = d; worstSeamAt = label; }
    return d;
  };
  const tick = () => {
    E.tick(DAY, host);
    const s = E.snapshot();
    // A tick closes the founding window and opens the next one against `treasury`.
    winBase = s.treasury; winDrawn = 0;
    flows += s.flow.faucet + (s.flow.founding || 0) - s.flow.imports - s.flow.payout;
    if (!s.audit || !s.audit.ok) auditBad = JSON.stringify(s.audit);
    peakIssued = Math.max(peakIssued, s.charterIssued);
    if (s.charterIssued > C.lifetimeCap + 1e-6) overCap++;
  };

  let short = null, key = 0;
  for (let d = 0; d < 120 && types.length; d++) {
    // three new buildings a day: enough churn to spend the allowance in 120 days
    for (let i = 0; i < 3; i++) { tiles[(key++) + ',0'] = { type: types[key % types.length] }; }
    sync('d' + d);
    if (SABOTAGE === 'charter-cap' && d === 60) {
      /* 🧨 A second issuance path that ignores the clamp — the shape of the
         regression the ceiling exists to catch. */
      Sim.state().charterIssued = C.lifetimeCap * 2;
      console.log('   🧨 charterIssued forced to ' + (C.lifetimeCap * 2).toFixed(0) + ' 🔥');
    }
    if (!short) short = E.firms().find(f => (f.seedShort || 0) > 1e-6) || null;
    tick();
  }

  /* ── 🏚 AND NOW THE OTHER DIRECTION ────────────────────────────────────────
     Every sync above ADDED tiles. The burn only happens on REMOVAL, which is
     why it survived a round built to catch exactly this class: `syncBuildings`
     kills the firm on a tile that is gone, and until `receiveEstate` existed
     `Firms.reap()` deleted its cash along with its record. The demolitions are
     measured at the same seam, one sync at a time, and the per-sync bound is
     tighter than the aggregate on purpose — a single razed factory is a single
     large number, not accumulated float noise. */
  const builtTiles = Object.keys(tiles).length;
  const cashBeforeRaze = E.firms().reduce((n, f) => n + f.cash, 0);
  const firmsBeforeRaze = E.snapshot().firms;
  const estateBeforeRaze = E.snapshot().estateReceived || 0;
  let razeSeam = 0, worstRaze = 0, worstRazeAt = '', razed = 0;
  /* 🔬 THE BOUND IS IN ULPS, AND HERE IS WHY — MEASURED, NOT ASSUMED.
     The first draft of this check asserted |Δ| < 1e-9 flat and went RED at
     −1.164e-10 per raze. That was not a leak. `totalCinder()` sums savings +
     every firm's cash + treasury + charter + reserve LEFT TO RIGHT, and reaping
     a firm removes a term from the middle of that sum — so the same money
     re-associates and the last bit of a ~680,000 🔥 double moves. Probed
     directly: naive Δ was ±1.164e-10 or ±2.328e-10 (1–2 ulps; one ulp at that
     magnitude is 1.51e-10) while a KAHAN-compensated sum of the identical terms
     read exactly 0.000e+0 at every single raze. The transfer is exact to the
     bit; only the summation order is not.
     So the ceiling is 8 ulps of the money supply — about 1.2e-9 🔥 on this
     city, five orders below one Cinder and fourteen below the 113,724.82 🔥 the
     reap-burn sabotage pushes across this seam. Widening it to hide a real leak
     is not available: a leak is a firm's whole balance sheet, not a bit. */
  const ULPS = 8;
  let razeTol = 0;
  /* And the claim that owes nothing to floating point at all: every Cinder that
     left the demolished firms ARRIVED in the treasury. Term to term, no sum of
     350 doubles involved. */
  let estateMismatch = [];
  for (let d = 0; d < 20; d++) {
    /* 🔴 THE RICHEST BUSINESSES GO FIRST, deliberately. Razing whatever tile
       happens to be oldest picked near-broke firms and put 1.55 🔥 across the
       seam — a bound that only ever sees small numbers is barely a bound. The
       biggest balance in the city is the largest thing this seam can destroy,
       so that is what gets pushed through it. */
    const doomed = Object.keys(tiles)
      .map(k => ({ k, cash: (E.firms().find(f => String(f.tileKey) === String(k)) || {}).cash || 0 }))
      .sort((a, b) => b.cash - a.cash).slice(0, 3).map(x => x.k);
    if (!doomed.length) break;
    RAZE_DOOMED = doomed;
    const doomedCash = doomed.reduce((n, k) => {
      const f = E.firms().find(x => String(x.tileKey) === String(k));
      return n + (f ? f.cash : 0);
    }, 0);
    const est0 = E.snapshot().estateReceived || 0;
    razeTol = Math.max(razeTol, Math.abs(E.totalCinder()) * ULPS * Number.EPSILON);
    for (const k of doomed) { delete tiles[k]; razed++; }
    const dz = sync('raze' + d);
    RAZE_DOOMED = null;
    const arrived = (E.snapshot().estateReceived || 0) - est0;
    if (Math.abs(arrived - doomedCash) > 1e-9)
      estateMismatch.push('raze' + d + ' held ' + doomedCash.toFixed(6) +
                          ' 🔥, treasury received ' + arrived.toFixed(6));
    razeSeam += dz;
    if (Math.abs(dz) > Math.abs(worstRaze)) { worstRaze = dz; worstRazeAt = 'raze' + d; }
    tick();
  }
  const estateTaken = (E.snapshot().estateReceived || 0) - estateBeforeRaze;

  const END = E.totalCinder();
  const snap = E.snapshot();
  const drift = (END - START) - flows - seamTotal;
  const tol = Math.max(1, Math.abs(END) * 1e-6);

  console.log('\n  🏦 120 days of continuous building, ' + builtTiles + ' tiles placed');
  console.log('     totalCinder     ' + START.toFixed(2) + ' → ' + END.toFixed(2) +
              '   (Δ ' + (END - START).toFixed(2) + ')');
  console.log('     audited flows   ' + flows.toFixed(2) + '   (faucet + founding − imports − payout)');
  console.log('     seam movement   ' + seamTotal.toFixed(2) + '   (worst single sync ' +
              worstSeam.toFixed(2) + (worstSeamAt ? ' at ' + worstSeamAt : '') + ')');
  console.log('     charter issued  ' + snap.charterIssued.toFixed(2) + ' of ' + C.lifetimeCap.toFixed(2) +
              '   (fund holds ' + snap.charter.toFixed(2) + ')');
  console.log('     unexplained     ' + drift.toFixed(6) + '   (tolerance ' + tol.toFixed(4) + ')');
  console.log('     worst window draw ' + (100 * worstDrawPct).toFixed(2) + '% of the treasury' +
              (worstDrawAt ? ' at ' + worstDrawAt : '') + '   (ceiling ' +
              (100 * C.treasuryDrawPct).toFixed(0) + '%' +
              (worstDrawDetail ? ', ' + worstDrawDetail : '') + ')\n');
  console.log('  🏚 then 20 days of demolition, ' + razed + ' tiles razed');
  console.log('     businesses      ' + firmsBeforeRaze + ' → ' + snap.firms +
              '   (held ' + cashBeforeRaze.toFixed(2) + ' 🔥 before the first raze)');
  console.log('     estate received ' + estateTaken.toFixed(2) + ' 🔥 into the treasury');
  console.log('     raze seam       ' + razeSeam.toExponential(3) + '   (worst single raze ' +
              worstRaze.toExponential(3) + (worstRazeAt ? ' at ' + worstRazeAt : '') +
              ', ceiling ' + razeTol.toExponential(3) + ' = ' + ULPS + ' ulps)\n');

  chk('NO CINDER MOVES AT ANY syncBuildings — founding is a transfer, at every seam',
      Math.abs(seamTotal) < 1e-6, 'total ' + seamTotal.toFixed(6) + ', worst ' + worstSeam.toFixed(6) +
      ' at ' + worstSeamAt);
  /* 🔴 THE REMOVAL SEAM, ASSERTED PER SYNC. Prove it can fail with
     ECON_TEST_SABOTAGE=reap-burn. */
  chk('NO CINDER MOVES WHEN A BUILDING IS DEMOLISHED — the estate is a transfer, not a burn',
      Math.abs(worstRaze) <= razeTol && Math.abs(razeSeam) <= razeTol * razed,
      'total ' + razeSeam.toExponential(3) + ', worst ' + worstRaze.toExponential(3) +
      ' at ' + worstRazeAt + ', ceiling ' + razeTol.toExponential(3) + ' (' + ULPS + ' ulps)');
  chk('every Cinder a demolished business held ARRIVED in the treasury — term to term',
      estateMismatch.length === 0, estateMismatch.slice(0, 3).join(' | '));
  /* The non-vacuity half, and it is not optional: "0 moved at every raze" is
     also what a run that razed nothing, or razed only broke firms, would print.
     The demolitions have to have closed real businesses holding real money. */
  chk('the demolitions actually wound up businesses that were HOLDING money',
      razed > 0 && snap.firms < firmsBeforeRaze && estateTaken > 0,
      razed + ' razed, firms ' + firmsBeforeRaze + '→' + snap.firms +
      ', estate ' + estateTaken.toFixed(2) + ' 🔥');
  chk('founding capital NEVER exceeds its lifetime ceiling',
      overCap === 0 && snap.charterIssued <= C.lifetimeCap + 1e-6,
      snap.charterIssued.toFixed(2) + ' issued of ' + C.lifetimeCap + ' (' + overCap + ' days over)');
  chk('the ceiling actually BINDS in this run (a bound nothing touches proves nothing)',
      peakIssued >= C.lifetimeCap - 1e-6, 'peak issued ' + peakIssued.toFixed(2) + ' of ' + C.lifetimeCap);
  chk('every Cinder created for founding is carried in the audited `founding` flow',
      Math.abs(drift) <= tol, 'drift ' + drift.toFixed(6));
  chk('a founding the accounts cannot cover is FUNDED SHORT, not invented',
      !!short && short.cash < short.seedWant && short.rung !== undefined,
      short ? short.name + ' wanted ' + short.seedWant.toFixed(2) + ', got ' + short.cash.toFixed(2) +
              ' (short ' + short.seedShort.toFixed(2) + ')'
            : 'no under-funded firm appeared — the allowance was never exhausted');
  /* 🔴 THE BOUND IS ON THE WINDOW, AND IT HAS TO BE CHECKED HERE BECAUSE THE
     AUDIT CANNOT SEE IT. Founding is a TRANSFER, so a sync that moves the whole
     treasury into ten new firms balances perfectly and the day audit reports
     clean — the money is not minted, it is merely all gone from the account
     that pays unemployment benefit, freight, imports and the player's payout.
     `treasuryDrawPct` was written as the protection against exactly that and
     did not provide it: applied per founding to the balance REMAINING, N tiles
     in one `syncBuildings` pass took 1 − 0.65^N. Measured on the pre-fix tree,
     nine tiles in a single sync took 91.15% (10,000.00 → 885.39 🔥).
     Prove this can fail: ECON_TEST_SABOTAGE=draw-compound. */
  chk('NO founding window takes more than treasuryDrawPct of the treasury, however many tiles found at once',
      drawOver === 0 && worstDrawPct <= C.treasuryDrawPct + 1e-6,
      'worst ' + (100 * worstDrawPct).toFixed(2) + '% at ' + (worstDrawAt || '?') +
      ' (' + worstDrawDetail + '), ceiling ' + (100 * C.treasuryDrawPct).toFixed(0) +
      '%, ' + drawOver + ' window(s) over');
  chk('the day audit stayed clean throughout', !auditBad, auditBad);
  chk('payouts were never suspended', snap.payoutAllowed === true);

  if (fails) { bad++; console.log('\n=== ROUND 0e: ' + fails + ' FAILED ==='); }
  else console.log('\n=== ROUND 0e: ALL PASS ===');
}
for (const f of ['gauntlet1.mjs', 'gauntlet2.mjs', 'gauntlet3.mjs']) {
  console.log('\n########## ' + f + ' ##########');
  const r = spawnSync(process.execPath, [join(here, f)], { stdio: 'inherit' });
  if (r.status !== 0) bad++;
}
console.log(bad ? '\n❌ ECONOMY GAUNTLET: ' + bad + ' round(s) failed' : '\n✅ ECONOMY GAUNTLET: all rounds passed');
process.exit(bad ? 1 : 0);
