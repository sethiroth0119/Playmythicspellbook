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
     ECON_TEST_SABOTAGE=dark-cards round0j: put `holographicFoil: 0.02` back into
                                   the boosterPacks recipe. That is the SHIPPED
                                   recipe, and because firms.js produce() takes
                                   the MINIMUM over inputs, that one coefficient
                                   — for a foil no city tile can make — is the
                                   whole difference between a card economy and
                                   `cardOutput()` returning totalUnits 0 forever
     ECON_TEST_SABOTAGE=twin-blind round0f: drop ECO_LOGISTICS_OPS on the way
                                   in — the exact pre-fix source for op_warehouse
     ECON_TEST_SABOTAGE=venue-blind round0g: empty MORALE_VENUE_OPS on the way
                                   in — the exact pre-fix source for op_dojo
     ECON_TEST_SABOTAGE=wx-twin-blind round0h: empty WEATHER_TWIN_OPS on the way
                                   in — the exact pre-fix source for op_agri,
                                   op_smuggling, op_research and op_oil
    ECON_TEST_SABOTAGE=draw-compound round0e: open the founding window's treasury
                                   allowance, reproducing the per-call clamp that
                                   let one sync take 91.15% of the treasury
    ECON_TEST_SABOTAGE=disaster-premium round0i: zero ECON.shock.cost.emergencyPer,
                                   which re-commits the SHIPPED prices-only
                                   disaster mapping — the version under which a
                                   siege measurably paid the player better than
                                   peace
    ECON_TEST_SABOTAGE=frozen-shock round0i: make the shock sample budget
                                   effectively unbounded, which is arithmetically
                                   what a PER-CALL budget was against the host's
                                   ~12,960-slice offline sweep — the frozen
                                   premium, re-committed
    ECON_TEST_SABOTAGE=shock-ratchet round0i §5: make ECON.shock.cost.recoveryDays
                                   enormous. That is not an arbitrary poke — it is
                                   the EXACT arithmetic that produced the ratchet:
                                   a recovery window longer than the gap between
                                   shock-producing events can never drain, so the
                                   outstanding share never falls, no later event
                                   can take the window over, and `shockSev` latches
                                   at the worst severity the city has ever seen.
                                   Under it §5 must report a window that never
                                   closes and a drizzle billed at tornado rates.

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
   ROUND 0j — 🃏 PRODUCIBLE IS NOT THE SAME THING AS PRODUCIBLE-HERE
   ----------------------------------------------------------------------------
   🔴 WHAT ROUND 0b CANNOT SEE, AND WHY THAT MATTERED FOR A WHOLE ROUND.
   0b asks `Recipes.producible(id)` of every output in ECO_BUILDING_MAP. That
   predicate answers ONE question — "does this id have a recipe, a deposit or a
   byproduct entry" — and `boosterPacks`, `printedCards`, `cardStock` and
   `holographicFoil` all answered YES from the day they were written. 0b was
   green. The card economy still produced NOTHING, in every city, forever.

   The reason is a level up from the predicate:

     · a recipe only runs if a FIRM makes each of its inputs
     · a firm only exists where a BUILDING maps to that id (ECO_BUILDING_MAP)
     · firms.js `produce()` takes the MINIMUM over the inputs (:363) —
       "a line runs at the rate of its slowest input"

   so ONE input with no building behind it darkens every step above it, in
   perfect silence, with a healthy-looking firm reporting a bottleneck nobody
   reads. `boosterPacks` needed `printedCards`; nothing made `printedCards`;
   the Card Shop was structurally incapable of printing a single pack and
   `cardOutput()` — the Foundation Reserve's feed — returned
   {units:{}, totalUnits:0} for every player, forever.

   THIS ROUND ASKS THE HARDER QUESTION: walk each mapped output back down its
   PRIMARY leg and check the walk terminates in the ground. Roots are deposits
   (a tile digs them, or trade imports them — trade.js sells partner endowment
   STRENGTHS, which are deposits) and ids some other row of the map makes.
   Byproducts are NOT roots: nothing in sim.js ever adds one to inventory.

   ⚠ THE CARD LINE IS ASSERTED; THE REST IS REPORTED. Plenty of the map is
     still dark for the same structural reason (the city has no chemical tier,
     no refinery and no semiconductor fab), and turning that into a red today
     would be a test nobody could make pass. The dark list is PRINTED on every
     run so the number is visible and can be driven down deliberately, and the
     Ouroboros ids — the ones a package was written to fix — are a hard fail.

   Prove this round can fail: ECON_TEST_SABOTAGE=dark-cards, which puts
   `holographicFoil` back into the `boosterPacks` recipe. That is not an
   arbitrary poke: it is the SHIPPED recipe, and by the min rule above that one
   0.02 coefficient is the whole difference between a card economy and a dead
   one.
   ════════════════════════════════════════════════════════════════════════════ */
{
  console.log('\n########## round0j-chain-reachability ##########');
  let fails = 0;
  const chk = (name, cond, extra) => {
    if (cond) { console.log('✅ ' + name); return true; }
    fails++; console.log('❌ ' + name + (extra ? ' :: ' + extra : '')); return false;
  };

  if (!CITY_MAP) {
    /* Same vacuous-tripwire guard round 0c uses: with no map there is nothing
       to walk, and "0 unreachable ids" would be a green that means nothing. */
    console.log('🔴 round0b could not read ECO_BUILDING_MAP — this round has nothing to walk.');
    bad++; console.log('\n=== ROUND 0j: 1 FAILED ===');
  } else {
    const R = await import('../../public/src/economy/recipes.js');
    if (SABOTAGE === 'dark-cards') {
      R.RECIPES.boosterPacks.in.holographicFoil = 0.02;
      console.log('   🧨 restored `holographicFoil: 0.02` to the boosterPacks recipe (the shipped version)');
    }

    /* Every id ANY tile in the city can found a firm for. A deposit in this set
       still has to be in the ground on a given node — pickAvailable decides
       that per city — so this walk is about STRUCTURE, not about one node. */
    const MAKEABLE = new Set();
    for (const k of Object.keys(CITY_MAP)) for (const o of (CITY_MAP[k].out || [])) MAKEABLE.add(o);

    const memo = new Map();
    function reach(id, stack) {
      if (R.isDeposit(id)) return true;             // the ground, or an import
      if (R.isByproduct(id)) return false;          // nothing ever banks these
      if (memo.has(id)) return memo.get(id);
      if (stack.has(id)) return false;              // a cycle is not a root
      if (!MAKEABLE.has(id)) { memo.set(id, false); return false; }
      stack.add(id);
      const leg = R.legsOf(id)[0] || { in: {} };
      let ok = true;
      for (const inp in (leg.in || {})) if (!reach(inp, stack)) { ok = false; break; }
      stack.delete(id);
      memo.set(id, ok);
      return ok;
    }
    /* WHY THE PRIMARY LEG AND ONLY THE PRIMARY LEG. `legsOf()` returns the
       ALT_FEEDSTOCK list when there is one, and an alternate leg is NOT a
       second way to be reachable in practice: sim.js `availabilityMap()` only
       measures the inputs of the leg a firm is ALREADY running, so an
       alternate's inputs are missing from the map and read as fully available.
       Measured: an electricity plant on a node with no fuel of any kind hopped
       to the `biomass` leg and produced 1200 units from zero biomass. Counting
       alternates here would let this round certify a chain that only "runs"
       through that hole. legs[0] is also what prices.js derives base price
       from, for the same reason. */

    const dark = [], lit = [];
    for (const id of Array.from(MAKEABLE).sort()) (reach(id, new Set()) ? lit : dark).push(id);

    console.log('\n  ' + lit.length + ' of ' + MAKEABLE.size + ' mapped outputs reach the ground.');
    console.log('  still dark (no city tile makes an input, somewhere below them):');
    console.log('    ' + (dark.join(', ') || '— none —') + '\n');

    // ── THE OUROBOROS LINE IS NOT ALLOWED TO BE DARK ────────────────────────
    const LINE = ['boosterPacks', 'printedCards', 'cardStock', 'packagingMaterial'];
    for (const id of LINE) {
      chk('`' + id + '` reaches the ground — the Card Shop can actually print',
          MAKEABLE.has(id) && reach(id, new Set()),
          MAKEABLE.has(id) ? 'blocked below it' : 'NO ECO_BUILDING_MAP row makes it');
    }
    /* The two rows the whole fix hangs on. Named explicitly so deleting one is
       a red with the reason attached, rather than four confusing failures. */
    chk('the map still has a paper mill and a print works',
        MAKEABLE.has('cardStock') && MAKEABLE.has('printedCards'),
        'cardStock:' + MAKEABLE.has('cardStock') + ' printedCards:' + MAKEABLE.has('printedCards'));
    /* A CEILING, WRITTEN DOWN AS A LITERAL — deliberately NOT `dark.length`
       compared against itself. That shape is the exact tautology this package
       exists to remove (gauntlet3's old card assertion was `x > 0 || price > 0`
       and could not fail), and a self-comparison here would be the same
       mistake wearing a different hat. The number is a CEILING and not an
       equality because the list is expected to SHRINK as the city grows a
       chemical tier; a round that had to be edited every time something got
       FIXED would be edited into uselessness. Lower it when you lower it. */
    const DARK_CEILING = 19;
    chk('the dark list has not grown past the shipped ceiling of ' + DARK_CEILING,
        dark.length <= DARK_CEILING, dark.length + ' dark ids');
    chk('no Ouroboros id is on the dark list',
        !dark.some(id => LINE.includes(id)), dark.filter(id => LINE.includes(id)).join(', '));

    if (SABOTAGE === 'dark-cards') delete R.RECIPES.boosterPacks.in.holographicFoil;

    if (fails) { bad++; console.log('\n=== ROUND 0j: ' + fails + ' FAILED ==='); }
    else console.log('\n=== ROUND 0j: ALL PASS ===');
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
/* ════════════════════════════════════════════════════════════════════════════
   ROUND 0f — 🚚 THE BARE-STRING TILE-TYPE BUG CLASS
   ----------------------------------------------------------------------------
   THIS IS THE THIRD TIME THE SAME MISTAKE HAS SHIPPED IN ONE FILE, so this round
   is deliberately NOT a test for the third instance.

     #1  ecoLogisticsCounts() counted only Supply Depots, with a comment claiming
         "Warehouses do not exist as a tile type here yet". `warehouse` had been
         in BUILDINGS all along; every player who built one got none of its 900
         units/day and nothing anywhere said so.
     #2  ecoHost().hasBank tested `t.type === 'bank'` against a tile that is
         `op_bank`. Permanently false ⇒ the entire DEBT rung never executed.
     #3  the fix for #1 was applied to the standing `warehouse` tile only, while
         `op_warehouse` — "Warehouse Co.", a 280,000 🔥 licence whose own
         blueprint says "Its real product is capacity" — went on granting ZERO
         freight. Measured on the live page before the fix: injecting a
         {type:'op_warehouse'} tile left logisticsCounts at {warehouse:3,depot:2}
         and freight at 3600/day; the identical tile typed 'warehouse' gave
         {warehouse:4} and 4500. A 900-unit difference, silent, for 280k.

   A regression test that checks op_warehouse would leave instance #4 to be found
   by a player, so the assertion here is a CLASS INVARIANT, and both sides of it
   are re-derived from the shipped file rather than hand-listed:

     WHO IS A TWIN   op O is the twin of city tile M when OP_BP[O].mesh === M
                     *and* OP_ECO_MAP[O].ind === ECO_BUILDING_MAP[M].ind.
                     🔴 MESH ALONE IS NOT ENOUGH and this is the trap the naive
                        version of this test fell into: `salvage` ("Salvage
                        Operation") also renders on the warehouse mesh, and a
                        mesh-only rule hands a scrap yard 900 units/day of
                        freight the city does not have. The industry is the
                        claim; the geometry is a coincidence.
     THE INVARIANT   for EVERY op type: a city containing one op tile must
                     produce EXACTLY the counts of a city containing its twin
                     when the twin is a logistics tile, and EXACTLY the empty
                     counts otherwise. Add a new twin of a freight tile to
                     OP_BP/OP_ECO_MAP and this round goes red until the guard is
                     taught about it.

   ⚠ THE SHIPPED FUNCTION IS LIFTED AND RUN, not copied — same technique as
     round0d's ecoHost, and for the reason stated there: a copy tests a fiction
     the moment the two drift.

   Prove this round can fail:
     ECON_TEST_SABOTAGE=no-map      the scrape reads nothing ⇒ hard fail, never a
                                    vacuous pass (same switch round0b/0d honour)
     ECON_TEST_SABOTAGE=twin-blind  drops ECO_LOGISTICS_OPS on the way in, which
                                    is exactly the pre-fix source
   ════════════════════════════════════════════════════════════════════════════ */
{
  console.log('\n########## round0f-tile-type-twins ##########');
  let fails = 0;
  const chk = (name, cond, extra) => {
    if (cond) { console.log('✅ ' + name); return true; }
    fails++; console.log('❌ ' + name + (extra ? ' :: ' + extra : '')); return false;
  };

  let HTML = null;
  try {
    HTML = readFileSync(join(here, SABOTAGE === 'no-map'
      ? '../../public/node-city/THIS-FILE-DOES-NOT-EXIST.html'
      : '../../public/node-city/index.html'), 'utf8');
  } catch (e) { HTML = null; }

  /* Every one of these is brace-matched out of the shipped file. `new Function`
     parses the block natively — prose comments and all — so no regex here has to
     understand JavaScript, only to find a declaration. */
  const lit = (decl) => {
    const txt = srcBlockAfter(HTML, decl);
    if (!txt) return null;
    try { return new Function('return (' + txt + ');')(); } catch (e) { return null; }
  };
  /* Markers stop at the IDENTIFIER — srcBlockAfter takes the next `{` — so
     re-aligning the `=` in the shipped file cannot silently un-read a table.
     That is not hypothetical: ECO_LOGISTICS_OPS is column-aligned today. */
  const OP_BP        = lit('const OP_BP');
  const OP_ECO_MAP   = lit('const OP_ECO_MAP');
  const CITY_ECO_MAP = lit('const ECO_BUILDING_MAP');
  const LOG_TILES    = lit('const ECO_LOGISTICS_TILES');
  const LOG_OPS_RAW  = lit('const ECO_LOGISTICS_OPS');
  const LOG_OPS      = SABOTAGE === 'twin-blind' ? {} : LOG_OPS_RAW;
  const BODY         = srcBlockAfter(HTML, 'function ecoLogisticsCounts()');
  const prefixM      = HTML ? /const\s+OPS_PREFIX\s*=\s*'([^']*)'/.exec(HTML) : null;
  const PREFIX       = prefixM ? prefixM[1] : null;

  /* 🔴 A SCRAPE THAT MATCHED NOTHING MUST FAIL HARD. Round0b's header makes the
     same point: the failure mode of an extraction test is not a wrong answer,
     it is a green run over an empty set. If a declaration was renamed, rename
     the marker — do not let this round pass quietly. */
  const got =
    chk('read ecoLogisticsCounts() out of node-city/index.html',
        !!BODY && BODY.indexOf('ECO_LOGISTICS_TILES') > 0,
        BODY ? BODY.length + ' chars, no table lookup in it' : 'UNREADABLE or unbalanced') &
    chk('read OP_BP / OP_ECO_MAP / ECO_BUILDING_MAP / the two logistics tables',
        !!OP_BP && !!OP_ECO_MAP && !!CITY_ECO_MAP && !!LOG_TILES && !!LOG_OPS_RAW,
        [OP_BP, OP_ECO_MAP, CITY_ECO_MAP, LOG_TILES, LOG_OPS_RAW].map(o => o ? Object.keys(o).length : 'NULL').join('/')) &
    chk('read OPS_PREFIX', !!PREFIX, String(PREFIX));

  if (!got) {
    console.log('\n🔴 ecoLogisticsCounts() COULD NOT BE READ — nothing below was checked.');
    bad++; console.log('\n=== ROUND 0f: ' + fails + ' FAILED ===');
  } else {
    const CAP = (await import('../../public/src/economy/tuning.js')).ECON.logistics.capacity;
    /* ⚠ COPIED VERBATIM from node-city (`const bldSite = t => …`), same as
       round0c and round0d and for the same reason — a const arrow cannot be
       imported out of an HTML module script. If it drifts, round0c fails first. */
    const bldSite = t => !!(t && t.bld && t.bld.k === 0);
    const opsKeyOf = ty => PREFIX + ty;

    /* The shipped function, handed everything it reaches for. LOG_OPS is passed
       in so the sabotage switch can blind it without editing the shipped file. */
    const run = (tiles) => {
      const names = ['game', 'bldSite', 'opsKeyOf', 'NODE_TYPES',
                     'ECO_LOGISTICS_TILES', 'ECO_LOGISTICS_OPS'];
      const fn = new Function(...names,
        'return (function ecoLogisticsCounts() ' + BODY + ')();');
      return fn({ tiles }, bldSite, opsKeyOf, {}, LOG_TILES, LOG_OPS);
    };
    const freight = (c) => Object.keys(c).reduce((s, k) => s + (CAP[k] || 0) * c[k], 0);
    const one = (t) => run(t ? { '9,9': t } : {});
    const EMPTY = one(null);
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    // ── 1. THE INSTANCE, before and after ────────────────────────────────────
    /* 🐛 THE SHIPPED PREDICATE, WRITTEN OUT. A green test that has only ever
       seen the fixed code cannot tell you the bug was real. */
    const PRE_FIX = (ty) => ty === 'warehouse' ? 1 : 0;
    const OPW = opsKeyOf('warehouse');
    chk("BEFORE: `t.type === 'warehouse'` scores the 280,000 🔥 Warehouse Co. at ZERO",
        PRE_FIX(OPW) === 0, OPW);
    const opCounts = one({ type: OPW, lvl: 1 });
    chk('AFTER: one ' + OPW + ' grants exactly one warehouse of capacity',
        opCounts.warehouse === 1 && freight(opCounts) - freight(EMPTY) === CAP.warehouse,
        JSON.stringify(opCounts) + ' Δfreight=' + (freight(opCounts) - freight(EMPTY)));
    chk('…the SAME counts as the standing twin, level for level',
        same(one({ type: OPW, lvl: 3 }), one({ type: 'warehouse', lvl: 3 })),
        JSON.stringify(one({ type: OPW, lvl: 3 })) + ' vs ' + JSON.stringify(one({ type: 'warehouse', lvl: 3 })));

    // ── 2. 🏗 CONSTRUCTION CONSISTENCY, on the op exactly as on the tile ─────
    const now = Date.now();
    chk('🏗 a SITE Warehouse Co. grants nothing (a hole in the ground stores nothing)',
        same(one({ type: OPW, lvl: 1, bld: { k: 0, l: 1, s: now, d: 900 } }), EMPTY));
    chk('an UPGRADING Warehouse Co. still grants (bldSite, not bldBusy — WP4)',
        same(one({ type: OPW, lvl: 1, bld: { k: 1, l: 2, s: now, d: 900 } }), one({ type: OPW, lvl: 1 })));
    chk('a DAMAGED Warehouse Co. grants nothing', same(one({ type: OPW, lvl: 1, damaged: true }), EMPTY));

    // ── 3. THE KEY IS DERIVED, NOT TYPED ────────────────────────────────────
    chk("the shipped function contains NO hardcoded 'op_…' literal",
        !/['"]op_[a-z]/.test(BODY), (BODY.match(/['"]op_[a-z][a-z_]*['"]/g) || []).join(','));
    chk('the op keys go through opsKeyOf()', /opsKeyOf\s*\(/.test(BODY));
    chk("the tables are keyed by OP TYPE, not tile type — no 'op_' key in ECO_LOGISTICS_OPS",
        Object.keys(LOG_OPS_RAW).every(k => k.indexOf(PREFIX) !== 0), Object.keys(LOG_OPS_RAW).join(','));

    // ── 4. THE CLASS INVARIANT — derived, never hand-listed ─────────────────
    /* twin = same mesh AND same industry. See the header for why mesh alone is
       the trap and not the rule. */
    const twinOf = (op) => {
      const mesh = (OP_BP[op] || {}).mesh;
      if (!mesh || !CITY_ECO_MAP[mesh]) return null;
      const oi = (OP_ECO_MAP[op] || {}).ind, ci = CITY_ECO_MAP[mesh].ind;
      return (oi && oi === ci) ? mesh : null;
    };
    const expectFreight = [], expectNone = [];
    for (const op of Object.keys(OP_BP)) {
      const twin = twinOf(op);
      (twin && LOG_TILES[twin] ? expectFreight : expectNone).push(op);
    }
    chk('the twin derivation is not vacuous: it finds at least one freight twin',
        expectFreight.length > 0, 'freight twins: ' + expectFreight.join(','));
    console.log('   ↳ derived freight twins: [' + expectFreight.join(', ') +
                ']  ·  must grant nothing: [' + expectNone.join(', ') + ']');

    let missed = [], overcredited = [];
    for (const op of expectFreight) {
      const ty = opsKeyOf(op);
      if (!same(one({ type: ty, lvl: 2 }), one({ type: twinOf(op), lvl: 2 })))
        missed.push(op + ' → ' + JSON.stringify(one({ type: ty, lvl: 2 })) +
                    ' but its twin ' + twinOf(op) + ' → ' + JSON.stringify(one({ type: twinOf(op), lvl: 2 })));
    }
    for (const op of expectNone) {
      const ty = opsKeyOf(op);
      if (!same(one({ type: ty, lvl: 2 }), EMPTY))
        overcredited.push(op + ' → ' + JSON.stringify(one({ type: ty, lvl: 2 })));
    }
    chk('🔴 EVERY derived freight twin is credited exactly like its standing tile — ' +
        'THE CLASS, not the instance', missed.length === 0, missed.join(' | '));
    chk('…and no other operation is credited any freight at all (salvage shares the ' +
        'warehouse MESH and must still get nothing)', overcredited.length === 0, overcredited.join(' | '));

    // ── 5. PROTOTYPE POLLUTION, the other way a bare lookup lies ────────────
    chk("a tile typed 'constructor' is not credited as a logistics building",
        same(one({ type: 'constructor', lvl: 1 }), EMPTY), JSON.stringify(one({ type: 'constructor', lvl: 1 })));

    if (fails) { bad++; console.log('\n=== ROUND 0f: ' + fails + ' FAILED ==='); }
    else console.log('\n=== ROUND 0f: ALL PASS ===');
  }
}
/* ════════════════════════════════════════════════════════════════════════════
   ROUND 0g — 🏟 THE SAME BUG CLASS, IN THE PRODUCTION MULTIPLIER
   ----------------------------------------------------------------------------
   Round 0f pinned the class down in ecoLogisticsCounts(). It is a FILE-WIDE
   class, not a function-wide one, and the sweep that followed the freight fix
   found a fourth live instance in tileMult():

       if (t.type === 'arena') m *= Math.max(.3, wellbeing.morale / 50);

   `op_dojo` — the Dojo operation, 150,000 🔥, OP_BP mesh 'arena', OP_ECO_MAP
   `ind: 'venue'`, row commented `// ↔ arena` — never matched, so it never felt
   morale at all. Measured on the live page at morale 49: arena ×0.982 with the
   "😊 City morale 49 — crowds follow it" row in its inspector; op_dojo ×1.000
   with no such row.

   ⚠ THE FIRST SWEEP WROTE THIS OFF WITH A FALSE REASON — "operations have no
     `gen`, so there is nothing for tileMult to scale". Both halves are wrong,
     and this round asserts the truth of both so the excuse cannot be made
     again:
       · the production loop admits a tile on
         `def.gen || def.use || def.svc || LEGACY_SERVICE[t.type]`, and
       · every op in OP_BP carries `use` and/or `svc`,
     therefore tileMult IS evaluated for every operation, and its result scales
     the op's input draw and the coverage its `svc` supplies.

   THE CLASS INVARIANT, re-derived from the shipped file, never hand-listed:
     twin(op) = OP_BP[op].mesh, when that mesh is a real city building AND
                OP_ECO_MAP[op].ind === ECO_BUILDING_MAP[mesh].ind.
                (Mesh alone is the trap — see round0f's header.)
     For every op: isMoraleVenue(opsKeyOf(op)) must be TRUE exactly when its
     twin is one of the standing tiles isMoraleVenue() seeds itself with, and
     FALSE otherwise. Give any future operation the `venue` industry on the
     arena mesh and this round goes red until the guard is taught about it.

   Prove this round can fail:
     ECON_TEST_SABOTAGE=no-map       the scrape reads nothing ⇒ hard fail
     ECON_TEST_SABOTAGE=venue-blind  empties MORALE_VENUE_OPS on the way in,
                                     which is exactly the pre-fix source
   ════════════════════════════════════════════════════════════════════════════ */
{
  console.log('\n########## round0g-morale-venue-twins ##########');
  let fails = 0;
  const chk = (name, cond, extra) => {
    if (cond) { console.log('✅ ' + name); return true; }
    fails++; console.log('❌ ' + name + (extra ? ' :: ' + extra : '')); return false;
  };

  let HTML = null;
  try {
    HTML = readFileSync(join(here, SABOTAGE === 'no-map'
      ? '../../public/node-city/THIS-FILE-DOES-NOT-EXIST.html'
      : '../../public/node-city/index.html'), 'utf8');
  } catch (e) { HTML = null; }

  const lit = (decl) => {
    const txt = srcBlockAfter(HTML, decl);
    if (!txt) return null;
    try { return new Function('return (' + txt + ');')(); } catch (e) { return null; }
  };
  const OP_BP        = lit('const OP_BP');
  const OP_ECO_MAP   = lit('const OP_ECO_MAP');
  const CITY_ECO_MAP = lit('const ECO_BUILDING_MAP');
  const LEGACY_SVC   = lit('const LEGACY_SERVICE');
  const VENUE_BODY   = srcBlockAfter(HTML, 'function isMoraleVenue(ty)');
  const MULT_BODY    = srcBlockAfter(HTML, 'function tileMult(x, z, t, staff, powered)');
  const FAC_BODY     = srcBlockAfter(HTML, 'function insFactors(x, z, t)');
  const TICK_BODY    = srcBlockAfter(HTML, 'async function economyTick(dtMin)');
  const opsListM     = HTML ? /const\s+MORALE_VENUE_OPS\s*=\s*\[([^\]]*)\]/.exec(HTML) : null;
  const prefixM      = HTML ? /const\s+OPS_PREFIX\s*=\s*'([^']*)'/.exec(HTML) : null;
  const PREFIX       = prefixM ? prefixM[1] : null;
  const VENUE_OPS_RAW = opsListM
    ? opsListM[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : null;
  const VENUE_OPS    = SABOTAGE === 'venue-blind' ? [] : VENUE_OPS_RAW;
  /* The standing half of the family, read back out of the function itself
     (`new Set(['arena'])`) rather than typed here — so adding a second standing
     venue widens the invariant instead of quietly falling outside it. */
  const seedM        = VENUE_BODY ? /new Set\(\[([^\]]*)\]\)/.exec(VENUE_BODY) : null;
  const SEED         = seedM
    ? seedM[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : null;

  const got =
    chk('read isMoraleVenue() / tileMult() / insFactors() / economyTick() out of node-city',
        !!VENUE_BODY && !!MULT_BODY && !!FAC_BODY && !!TICK_BODY,
        [VENUE_BODY, MULT_BODY, FAC_BODY, TICK_BODY].map(b => b ? b.length : 'NULL').join('/')) &
    chk('read OP_BP / OP_ECO_MAP / ECO_BUILDING_MAP / LEGACY_SERVICE',
        !!OP_BP && !!OP_ECO_MAP && !!CITY_ECO_MAP && !!LEGACY_SVC,
        [OP_BP, OP_ECO_MAP, CITY_ECO_MAP, LEGACY_SVC].map(o => o ? Object.keys(o).length : 'NULL').join('/')) &
    chk('read MORALE_VENUE_OPS, its standing seed set, and OPS_PREFIX',
        !!VENUE_OPS_RAW && !!SEED && SEED.length > 0 && !!PREFIX,
        JSON.stringify(VENUE_OPS_RAW) + ' seed=' + JSON.stringify(SEED) + ' prefix=' + PREFIX);

  if (!got) {
    console.log('\n🔴 THE MORALE GUARD COULD NOT BE READ — nothing below was checked.');
    bad++; console.log('\n=== ROUND 0g: ' + fails + ' FAILED ===');
  } else {
    const opsKeyOf = ty => PREFIX + ty;
    /* The shipped predicate, lifted and run. `_moraleVenueTypes` is the module
       `let` it memoises into; a fresh one per build means the memo cannot leak
       between the sabotaged and un-sabotaged constructions. */
    const buildVenue = (opsList) => new Function('opsKeyOf', 'MORALE_VENUE_OPS',
      'let _moraleVenueTypes = null;\n' +
      'return function isMoraleVenue(ty) ' + VENUE_BODY + ';')(opsKeyOf, opsList);
    const isMoraleVenue = buildVenue(VENUE_OPS);

    // ── 1. THE PREMISE the first sweep got wrong ─────────────────────────────
    /* ⚠ "ops have no gen" was the excuse. The loop does not ask for gen. */
    chk('the production loop admits a tile on use/svc, not on gen alone',
        /!def\.gen\s*&&\s*!def\.use\s*&&\s*!def\.svc/.test(TICK_BODY),
        'admission line not found in economyTick — re-read it before trusting this round');
    const reached = (o) => !!(OP_BP[o].use || OP_BP[o].svc || OP_BP[o].gen || LEGACY_SVC[opsKeyOf(o)]);
    const skipped = Object.keys(OP_BP).filter(o => !reached(o));
    /* NOT "every op" — measured, `bank` and `warehouse` declare neither, so the
       loop really does skip them and tileMult never sees them. That is exactly
       why this is asserted per-op below instead of as a blanket claim: a sweep
       that generalises from two rows is how the first one got this wrong. */
    console.log('   ↳ ops the production loop never reaches (no gen/use/svc): [' +
                skipped.join(', ') + '] — tileMult is not evaluated for these');
    chk('most operations carry use and/or svc, so tileMult() runs for them',
        skipped.length < Object.keys(OP_BP).length / 2, 'skipped: ' + skipped.join(','));
    chk('…and tileMult() is what the loop then applies to that draw',
        /tileMult\(/.test(TICK_BODY));

    // ── 2. THE INSTANCE, before and after ────────────────────────────────────
    const PRE_FIX = (ty) => ty === 'arena';           // the shipped predicate, verbatim
    const OPD = opsKeyOf('dojo');
    chk("BEFORE: `t.type === 'arena'` scores the Dojo operation as NOT a venue", !PRE_FIX(OPD), OPD);
    chk('AFTER: ' + OPD + ' IS a venue and feels morale', isMoraleVenue(OPD) === true);
    chk('…and the standing arena still does', isMoraleVenue('arena') === true);
    /* The band the op was missing out on, printed so the report cannot round it
       off: Math.max(.3, morale/50) over morale 0…100. */
    const band = m => Math.max(.3, m / 50);
    console.log('   ↳ morale band the Dojo now feels: ×' + band(0).toFixed(2) + ' at morale 0, ×' +
                band(49).toFixed(3) + ' at the live-page morale 49, ×' + band(100).toFixed(2) + ' at 100');

    // ── 3. THE CLASS INVARIANT — derived, never hand-listed ─────────────────
    const twinOf = (op) => {
      const mesh = (OP_BP[op] || {}).mesh;
      if (!mesh || !CITY_ECO_MAP[mesh]) return null;
      const oi = (OP_ECO_MAP[op] || {}).ind, ci = CITY_ECO_MAP[mesh].ind;
      return (oi && oi === ci) ? mesh : null;
    };
    const expectVenue = [], expectNot = [];
    for (const op of Object.keys(OP_BP)) {
      const twin = twinOf(op);
      (twin && SEED.indexOf(twin) >= 0 ? expectVenue : expectNot).push(op);
    }
    chk('the twin derivation is not vacuous: it finds at least one venue twin',
        expectVenue.length > 0, 'venue twins: ' + expectVenue.join(','));
    console.log('   ↳ derived venue twins: [' + expectVenue.join(', ') +
                ']  ·  must NOT feel morale: [' + expectNot.join(', ') + ']');

    const missed = expectVenue.filter(o => !isMoraleVenue(opsKeyOf(o)));
    const spurious = expectNot.filter(o => isMoraleVenue(opsKeyOf(o)));
    chk('🔴 EVERY derived venue twin feels morale — THE CLASS, not the instance',
        missed.length === 0, missed.map(o => o + ' (twin ' + twinOf(o) + ')').join(' | '));
    chk('…and no other operation does (a Fishing Company is not a crowd)',
        spurious.length === 0, spurious.join(' | '));
    chk('a tile type nobody declared is not a venue',
        !isMoraleVenue('farm') && !isMoraleVenue('constructor') && !isMoraleVenue(undefined));
    /* The guard is only worth anything for ops the tick actually evaluates. If a
       future venue twin declares no gen/use/svc, tileMult never runs for it and
       this whole round would be asserting about dead code — say so loudly. */
    chk('every derived venue twin is an op the production loop actually reaches',
        expectVenue.every(reached), expectVenue.filter(o => !reached(o)).join(','));

    // ── 4. THE KEY IS DERIVED, NOT TYPED ────────────────────────────────────
    const opLit = s => (s.match(/['"]op_[a-z][a-z_]*['"]/g) || []);
    chk("no hardcoded 'op_…' literal in isMoraleVenue / tileMult / insFactors",
        !opLit(VENUE_BODY).length && !opLit(MULT_BODY).length && !opLit(FAC_BODY).length,
        [].concat(opLit(VENUE_BODY), opLit(MULT_BODY), opLit(FAC_BODY)).join(','));
    chk('the op keys go through opsKeyOf()', /opsKeyOf\s*\(/.test(VENUE_BODY));
    chk("MORALE_VENUE_OPS is keyed by OP TYPE, not tile type",
        VENUE_OPS_RAW.every(k => k.indexOf(PREFIX) !== 0), VENUE_OPS_RAW.join(','));

    // ── 5. THE PANEL PRINTS WHAT THE TICK CHARGED ───────────────────────────
    /* Two copies of `Math.max(.3, wellbeing.morale / 50)` behind two copies of
       the predicate is how the inspector starts lying about the tick. Both now
       call the one helper, and neither may re-inline the expression. */
    chk('tileMult() and insFactors() both gate on isMoraleVenue()',
        /isMoraleVenue\s*\(/.test(MULT_BODY) && /isMoraleVenue\s*\(/.test(FAC_BODY));
    chk('…and both take the value from moraleVenueMult(), not a re-typed literal',
        /moraleVenueMult\s*\(/.test(MULT_BODY) && /moraleVenueMult\s*\(/.test(FAC_BODY) &&
        !/wellbeing\.morale\s*\/\s*50/.test(MULT_BODY) && !/wellbeing\.morale\s*\/\s*50/.test(FAC_BODY),
        'a re-inlined morale expression is back in tileMult or insFactors');

    if (fails) { bad++; console.log('\n=== ROUND 0g: ' + fails + ' FAILED ==='); }
    else console.log('\n=== ROUND 0g: ALL PASS ===');
  }
}
/* ════════════════════════════════════════════════════════════════════════════
   ROUND 0h — ☔ THE SAME BUG CLASS, IN THE WEATHER
   ----------------------------------------------------------------------------
   Rounds 0f and 0g pinned the class down in ecoLogisticsCounts() and in the
   morale term. Both of those were found by grepping `t.type === '…'`. THAT GREP
   IS STRUCTURALLY BLIND to weatherMult(), which compares a bare PARAMETER named
   `type` — so three more live instances sat one line above the one 0g fixed
   (`tileMult` reaches them through `* weatherMult(t.type)`), plus a fourth
   nobody had named:

     · `type === 'farm'`                     missed `op_agri` (Agricultural Op.)
     · `W.anomaly && type === 'siphon'`      missed `op_smuggling`
     · `W.anomaly && type === 'reslab'`      missed `op_research`
     · `def.outdoor` — `outdoor` lives on the BUILDINGS row and the ops
       registration loop copies name/ico/pop/crew/powerNeed/use/svc and NOT
       `outdoor`, so every operation on an open-air twin's mesh was weatherproof:
       `op_oil` on the Fuel Rig mesh is the live one.

   MEASURED ON THE LIVE PAGE BEFORE THE FIX (tileMult under weather ÷ tileMult
   under clear, so every other term cancels):
     TORNADO farm ×0.50 · op_agri ×1.00   |  RAIN farm ×1.30 · op_agri ×1.00
     SNOW    farm ×0.396 · op_agri ×0.88  |  ANOMALY siphon ×3 · op_smuggling ×1
     ANOMALY reslab ×3 · op_research ×1   |  TORNADO fuelrig ×0.50 · op_oil ×1.00
   A 3× production swing denied to a 600,000 🔥 licence, silently.

   THE INVARIANT, and it is deliberately TOTAL rather than per-instance:
     for EVERY op whose twin is non-null, and under EVERY row of WEATHER,
       weatherMult(opsKeyOf(op)) === weatherMult(twin)
     and for every op with NO twin, weatherMult is the plain indoor baseline.
   twin(op) is re-derived here exactly as in 0f/0g — same mesh AND same industry
   — never hand-listed, so an operation that joins the class turns this red
   without anyone remembering to add a case. 🔴 MESH ALONE IS THE TRAP: op_fishing
   renders on the purifier mesh and is a fishing fleet (ind `fishery`), not a
   waterworks; a mesh rule would hand it the purifier's rain ×1.35. Asserted
   below as an explicit negative.

   ⚠ THE SHIPPED FUNCTIONS ARE LIFTED AND RUN, not copied, and so is the ops
     REGISTRATION LOOP — the claim "an operation never carries `outdoor`" is the
     load-bearing half of the op_oil defect, and a hand-built op blueprint here
     would be asserting about a fiction.
   ⚠ BUILDINGS is evaluated in a `with`-scope that answers 0 to every unknown
     name (it references STOCK_CAP_PER_WAREHOUSE and friends). Only the `outdoor`
     flags are read from it and those are literal `true`; nothing here depends on
     a cost number, and a stubbed cost cannot fake an `outdoor`.

   Prove this round can fail:
     ECON_TEST_SABOTAGE=no-map        the scrape reads nothing ⇒ hard fail
     ECON_TEST_SABOTAGE=wx-twin-blind empties WEATHER_TWIN_OPS on the way in,
                                      which is exactly the pre-fix source
   ════════════════════════════════════════════════════════════════════════════ */
{
  console.log('\n########## round0h-weather-twins ##########');
  let fails = 0;
  const chk = (name, cond, extra) => {
    if (cond) { console.log('✅ ' + name); return true; }
    fails++; console.log('❌ ' + name + (extra ? ' :: ' + extra : '')); return false;
  };

  let HTML = null;
  try {
    HTML = readFileSync(join(here, SABOTAGE === 'no-map'
      ? '../../public/node-city/THIS-FILE-DOES-NOT-EXIST.html'
      : '../../public/node-city/index.html'), 'utf8');
  } catch (e) { HTML = null; }

  /* Two evaluators. `lit` is 0f/0g's; `loose` is the same thing inside a `with`
     over a Proxy that answers 0 for every free identifier — BUILDINGS is the
     only table that needs it, and it needs it because it cites constants
     declared elsewhere in the file. */
  const lit = (decl) => {
    const txt = srcBlockAfter(HTML, decl);
    if (!txt) return null;
    try { return new Function('return (' + txt + ');')(); } catch (e) { return null; }
  };
  const loose = (decl) => {
    const txt = srcBlockAfter(HTML, decl);
    if (!txt) return null;
    try {
      const scope = new Proxy({}, { has: () => true,
        get: (t, k) => (k === Symbol.unscopables ? undefined : 0) });
      return new Function('__s', 'with (__s) { return (' + txt + '); }')(scope);
    } catch (e) { return null; }
  };
  const OP_BP        = lit('const OP_BP');
  const OP_ECO_MAP   = lit('const OP_ECO_MAP');
  const CITY_ECO_MAP = lit('const ECO_BUILDING_MAP');
  const WEATHER      = lit('const WEATHER');
  const TWIN_RAW     = lit('const WEATHER_TWIN_OPS');
  const TWIN         = SABOTAGE === 'wx-twin-blind' ? {} : TWIN_RAW;
  const BUILDINGS    = loose('const BUILDINGS');
  const REG_BODY     = srcBlockAfter(HTML, 'for (const t of OPS_TYPES)');
  const MULT_BODY    = srcBlockAfter(HTML, 'function weatherMult(type)');
  const TWIN_BODY    = srcBlockAfter(HTML, 'function weatherTwinType(type)');
  const SENS_BODY    = srcBlockAfter(HTML, 'function weatherSensitive(type)');
  const RISK_BODY    = srcBlockAfter(HTML, 'function insRisk(t, x, z)');
  const TILEM_BODY   = srcBlockAfter(HTML, 'function tileMult(x, z, t, staff, powered)');
  const prefixM      = HTML ? /const\s+OPS_PREFIX\s*=\s*'([^']*)'/.exec(HTML) : null;
  const PREFIX       = prefixM ? prefixM[1] : null;

  /* 🔴 A SCRAPE THAT MATCHED NOTHING MUST FAIL HARD — round0b's point, and 0f's.
     The failure mode of an extraction test is not a wrong answer, it is a green
     run over an empty set. */
  const got =
    chk('read weatherMult / weatherTwinType / weatherSensitive / insRisk out of node-city',
        !!MULT_BODY && !!TWIN_BODY && !!SENS_BODY && !!RISK_BODY && !!TILEM_BODY,
        [MULT_BODY, TWIN_BODY, SENS_BODY, RISK_BODY, TILEM_BODY].map(b => b ? b.length : 'NULL').join('/')) &
    chk('read WEATHER / BUILDINGS / OP_BP / OP_ECO_MAP / ECO_BUILDING_MAP / WEATHER_TWIN_OPS',
        !!WEATHER && !!BUILDINGS && !!OP_BP && !!OP_ECO_MAP && !!CITY_ECO_MAP && !!TWIN_RAW,
        [WEATHER, BUILDINGS, OP_BP, OP_ECO_MAP, CITY_ECO_MAP, TWIN_RAW].map(o => o ? Object.keys(o).length : 'NULL').join('/')) &
    chk('read the ops registration loop and OPS_PREFIX', !!REG_BODY && !!PREFIX,
        (REG_BODY ? REG_BODY.length : 'NULL') + ' / ' + PREFIX) &
    chk('BUILDINGS really carries outdoor flags (the loose eval did not flatten it)',
        !!BUILDINGS && Object.keys(BUILDINGS).some(k => BUILDINGS[k] && BUILDINGS[k].outdoor),
        BUILDINGS ? Object.keys(BUILDINGS).filter(k => BUILDINGS[k] && BUILDINGS[k].outdoor).join(',') : 'NULL');

  if (!got) {
    console.log('\n🔴 THE WEATHER GUARD COULD NOT BE READ — nothing below was checked.');
    bad++; console.log('\n=== ROUND 0h: ' + fails + ' FAILED ===');
  } else {
    const opsKeyOf = ty => PREFIX + ty;
    /* THE SHIPPED REGISTRATION, RUN. This is what puts op_* rows into BUILDINGS,
       and the whole op_oil defect is the fact that it does not copy `outdoor`. */
    new Function('OPS_TYPES', 'OP_BP', 'BUILDINGS', 'opsKeyOf', 'BUILD_ORDER',
                 'OP_ECO_MAP', 'ECO_BUILDING_MAP', 'for (const t of OPS_TYPES) ' + REG_BODY)
      (Object.keys(OP_BP), OP_BP, BUILDINGS, opsKeyOf, [], OP_ECO_MAP, CITY_ECO_MAP);
    chk('the registered operations exist in BUILDINGS and NONE of them carries `outdoor` — ' +
        'the reason op_oil was weatherproof',
        Object.keys(OP_BP).every(o => BUILDINGS[opsKeyOf(o)]) &&
        Object.keys(OP_BP).every(o => !BUILDINGS[opsKeyOf(o)].outdoor),
        Object.keys(OP_BP).filter(o => !BUILDINGS[opsKeyOf(o)] || BUILDINGS[opsKeyOf(o)].outdoor).join(','));

    /* The three shipped functions, built over one live `wx` so a row can be put
       over the city by assignment. `_wxTwinTypes` is the module `let` they
       memoise into; a fresh one per build keeps the sabotaged and un-sabotaged
       constructions from sharing a memo. */
    const wx = { type: 'clear' };
    const build = (keyFn, twins) => new Function('WEATHER', 'wx', 'BUILDINGS', 'opsKeyOf', 'WEATHER_TWIN_OPS',
      'let _wxTwinTypes = null;\n' +
      'function weatherTwinType(type) ' + TWIN_BODY + '\n' +
      'function weatherSensitive(type) ' + SENS_BODY + '\n' +
      'function weatherMult(type) ' + MULT_BODY + '\n' +
      'return { weatherMult, weatherSensitive, weatherTwinType };')
      (WEATHER, wx, BUILDINGS, keyFn, twins);
    const A = build(opsKeyOf, TWIN);
    const WX_ROWS = Object.keys(WEATHER);
    const under = (w, fn) => { const s = wx.type; wx.type = w; try { return fn(); } finally { wx.type = s; } };

    // ── 1. THE INSTANCES, before and after ───────────────────────────────────
    /* 🐛 THE SHIPPED PREDICATES, WRITTEN OUT — a green test that has only ever
       seen the fixed code cannot tell you the bug was real. */
    const PRE_FARM = ty => ty === 'farm';
    const PRE_RIFT = ty => ty === 'siphon' || ty === 'reslab';
    const PRE_OUT  = ty => !!(BUILDINGS[ty] && BUILDINGS[ty].outdoor);
    chk("BEFORE: `type === 'farm'` scores the Agricultural Op. as not-a-farm",
        !PRE_FARM(opsKeyOf('agri')));
    chk("BEFORE: the anomaly clause misses op_smuggling and op_research",
        !PRE_RIFT(opsKeyOf('smuggling')) && !PRE_RIFT(opsKeyOf('research')));
    chk("BEFORE: `def.outdoor` is false for op_oil though fuelrig is open-air",
        !PRE_OUT(opsKeyOf('oil')) && PRE_OUT('fuelrig'));
    const shown = [
      ['tornado', 'farm', 'agri'], ['rain', 'farm', 'agri'], ['snow', 'farm', 'agri'],
      ['anomaly', 'siphon', 'smuggling'], ['anomaly', 'reslab', 'research'],
      ['tornado', 'fuelrig', 'oil'], ['storm', 'fuelrig', 'oil'],
    ];
    for (const [w, tile, op] of shown) {
      const a = under(w, () => A.weatherMult(opsKeyOf(op))), b = under(w, () => A.weatherMult(tile));
      chk('AFTER: ' + w.toUpperCase() + ' ' + tile + ' ×' + b + ' — ' + opsKeyOf(op) + ' now ×' + a, a === b,
          'op ' + a + ' vs twin ' + b);
    }

    // ── 2. THE CLASS INVARIANT, every twin × every weather row ──────────────
    const twinOf = (op) => {
      const mesh = (OP_BP[op] || {}).mesh;
      if (!mesh || !CITY_ECO_MAP[mesh]) return null;
      const oi = (OP_ECO_MAP[op] || {}).ind, ci = CITY_ECO_MAP[mesh].ind;
      return (oi && oi === ci) ? mesh : null;
    };
    const twins = Object.keys(OP_BP).filter(twinOf), orphans = Object.keys(OP_BP).filter(o => !twinOf(o));
    chk('the twin derivation is not vacuous', twins.length > 0);
    console.log('   ↳ derived weather twins: [' + twins.map(o => o + '→' + twinOf(o)).join(', ') + ']');
    console.log('   ↳ operations with NO twin (must feel the plain indoor row): [' + orphans.join(', ') + ']');

    const mismatch = [];
    for (const w of WX_ROWS) for (const op of twins) {
      const a = under(w, () => A.weatherMult(opsKeyOf(op))), b = under(w, () => A.weatherMult(twinOf(op)));
      if (a !== b) mismatch.push(w + ': ' + op + ' ×' + a + ' vs ' + twinOf(op) + ' ×' + b);
    }
    chk('🔴 EVERY derived twin feels EXACTLY its standing twin\'s weather, in EVERY row — ' +
        'THE CLASS, not the instance', mismatch.length === 0, mismatch.join(' | '));

    const wrong = [];
    for (const w of WX_ROWS) for (const op of orphans) {
      const base = WEATHER[w] && w !== 'clear' ? (WEATHER[w].allMult || 1) : 1;
      const a = under(w, () => A.weatherMult(opsKeyOf(op)));
      if (a !== base) wrong.push(w + ': ' + op + ' ×' + a + ' (baseline ×' + base + ')');
    }
    chk('…and an operation with no twin gets the plain indoor baseline, nothing else',
        wrong.length === 0, wrong.join(' | '));
    /* 🔴 THE NEGATIVE THAT KILLS THE MESH SHORTCUT. op_fishing borrows the
       purifier MESH; if anyone ever "simplifies" the table to OP_BP[…].mesh, a
       fishing fleet starts collecting the waterworks' rain bonus and this goes
       red. */
    chk('op_fishing does NOT inherit the purifier it is drawn as (mesh ≠ industry)',
        under('rain', () => A.weatherMult(opsKeyOf('fishing'))) !== under('rain', () => A.weatherMult('purifier')),
        'rain: op_fishing ×' + under('rain', () => A.weatherMult(opsKeyOf('fishing'))) +
        ' vs purifier ×' + under('rain', () => A.weatherMult('purifier')));

    // ── 3. THE INSPECTOR PRINTS WHAT THE TICK CHARGED ───────────────────────
    const rowMiss = twins.filter(o => A.weatherSensitive(opsKeyOf(o)) !== A.weatherSensitive(twinOf(o)));
    chk('the weather ROW appears for an op exactly when it appears for its twin ' +
        '(op_agri showed none at all)', rowMiss.length === 0,
        rowMiss.map(o => o + ' ' + A.weatherSensitive(opsKeyOf(o)) + ' vs ' + twinOf(o) + ' ' + A.weatherSensitive(twinOf(o))).join(' | '));
    chk('…and insRisk gates on weatherSensitive() rather than re-typing its rule',
        /weatherSensitive\s*\(/.test(RISK_BODY) &&
        !/t\.type\s*===\s*'(farm|purifier)'/.test(RISK_BODY),
        'a re-typed farm/purifier comparison is back in insRisk');
    chk('tileMult() still routes production through weatherMult()', /weatherMult\s*\(/.test(TILEM_BODY));

    // ── 4. THE KEY IS DERIVED, NOT TYPED ────────────────────────────────────
    const opLit = s => (s.match(/['"]op_[a-z][a-z_]*['"]/g) || []);
    chk("no hardcoded 'op_…' literal in weatherMult / weatherTwinType / weatherSensitive / insRisk",
        !opLit(MULT_BODY).length && !opLit(TWIN_BODY).length && !opLit(SENS_BODY).length && !opLit(RISK_BODY).length,
        [].concat(opLit(MULT_BODY), opLit(TWIN_BODY), opLit(SENS_BODY), opLit(RISK_BODY)).join(','));
    chk('the op keys go through opsKeyOf()', /opsKeyOf\s*\(/.test(TWIN_BODY));
    chk('WEATHER_TWIN_OPS is keyed by OP TYPE, not tile type',
        Object.keys(TWIN_RAW).every(k => k.indexOf(PREFIX) !== 0), Object.keys(TWIN_RAW).join(','));
    chk('…and every value in it is a real standing building',
        Object.values(TWIN_RAW).every(v => !!BUILDINGS[v] && v.indexOf(PREFIX) !== 0),
        Object.values(TWIN_RAW).filter(v => !BUILDINGS[v]).join(','));

    // ── 5. THE TWO WAYS A LOOKUP LIES ───────────────────────────────────────
    chk("a tile typed 'constructor' resolves to itself, not up the prototype chain",
        A.weatherTwinType('constructor') === 'constructor' && A.weatherTwinType(undefined) === undefined,
        String(A.weatherTwinType('constructor')));
    /* THE TDZ PATH. opsKeyOf is a const arrow ~19,600 lines below weatherMult;
       a call during boot THROWS. The fallback must be identity AND must not be
       memoised, or "ops are not twinned yet" becomes permanent. */
    let tdz = true;
    const T = build((t) => { if (tdz) throw new ReferenceError('TDZ'); return PREFIX + t; }, TWIN);
    const duringBoot = under('tornado', () => T.weatherMult(opsKeyOf('agri')));
    tdz = false;
    const afterBoot = under('tornado', () => T.weatherMult(opsKeyOf('agri')));
    chk('during boot the twin lookup fails SAFE to the old behaviour (×1 allMult), ' +
        'and does NOT poison the memo',
        duringBoot === 1 && afterBoot === under('tornado', () => A.weatherMult('farm')),
        'boot ×' + duringBoot + ' then ×' + afterBoot);

    if (fails) { bad++; console.log('\n=== ROUND 0h: ' + fails + ' FAILED ==='); }
    else console.log('\n=== ROUND 0h: ALL PASS ===');
  }
}
/* ════════════════════════════════════════════════════════════════════════════
   ROUND 0i — 🌩 A DISASTER MUST COST THE PLAYER, NOT PAY HIM
   ----------------------------------------------------------------------------
   THE DEFECT THIS ROUND EXISTS FOR, and it shipped:
   node-city's `ecoShock()` maps weather and raids onto `host.shock`, and the
   mapping only ever RAISES prices ("a disaster is a PREMIUM"). Higher prices are
   a bigger sales and corporate tax take; the player's payout is a share of the
   day's municipal surplus; so a SIEGE RAISED THE OWNER'S REAL CINDER INCOME.
   Measured on the shipped tree over 300 deterministic economic days (the sim
   uses no RNG — six repeats were bit-identical): claimed Cinder 5,762 calm →
   5,910 at a realistic cadence, → 6,885 at a permanent 1.6 shock. Scanned over
   twelve cities at the real raid cadence, NINE of them paid their owner more
   during disasters than in peace.

   It was invisible because NO ROUND IN THIS GATE HAS EVER SET `shock`. Round 3
   of gauntlet2 pokes 3.5 at the price clamp and gauntlet2's property test rolls
   a random one 5% of the time, and neither asks the only question that matters:
   is the player better or worse off? So this round measures the CONSEQUENCE, in
   claimed Cinder, over long deterministic runs.

   ⚠ THE BASELINE HAS TO BE MATERIAL, and that is not a detail. Two of the
     twelve probe cities are structurally insolvent — they claim 33 🔥 and 73 🔥
     across 400 days, i.e. essentially nothing — and in that regime any
     perturbation reads as a huge PERCENTAGE of nothing (±30% on a shift of
     eight Cinder). The cities below are asserted to clear `MATERIAL` first, so
     the round can never pass or fail on rounding noise.

   Prove this round can fail: ECON_TEST_SABOTAGE=disaster-premium, which zeroes
   the emergency-response term and so re-commits the exact shipped behaviour.
   ════════════════════════════════════════════════════════════════════════════ */
{
  console.log('\n########## round0i-disaster-economics ##########');
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
  const Sim = await import(P + 'sim.js');
  const HH = await import(P + 'households.js');
  const Prices = await import(P + 'prices.js');
  const { ECON } = await import(P + 'tuning.js');
  const DAY = ECON.clock.dayMin;
  /* 🔴 THE SHIPPED RECOVERY WINDOW, SNAPSHOT BEFORE ANY INJURY, AND §5 MEASURES
     AGAINST THIS AND NEVER AGAINST THE LIVE VALUE.
     Learned the hard way in this round: §5's first cut derived its own trailing
     horizon from `ECON.shock.cost.recoveryDays`, and the `shock-ratchet`
     sabotage sets exactly that constant. The assertions then measured over a
     million-day horizon, went vacuous (`seen.slice(1e6)` is empty,
     `Math.max(0, ...[])` is 0) and PASSED on the injured build — a test that
     stops testing under the one injury it was written for. An assertion may not
     take its own yardstick from the thing it is checking. */
  const SHIPPED_RD = Math.ceil(ECON.shock.cost.recoveryDays);

  /* 🧨 The injury: the shipped mapping, which had a premium and no cost. */
  if (SABOTAGE === 'disaster-premium') ECON.shock.cost.emergencyPer = 0;
  /* 🧨 …and the second injury, which re-commits the OTHER shipped defect. The
     frozen-premium bug was, in effect, a sample budget that never ran out —
     a per-call meter re-issued on all 12,960 slices of the sweep is
     arithmetically indistinguishable from an unbounded one. Making the budget
     unbounded is therefore the faithful re-commit, and it must light up section
     4 and nothing else (every other section takes a FRESH reading per day, so a
     bigger budget cannot change them). */
  if (SABOTAGE === 'frozen-shock') ECON.shock.cost.sampleDays = 1e9;
  /* 🧨 …and the third, for §5. A recovery window longer than the gap between
     shock-producing events can never drain to 0, so the outstanding share of the
     last repair never falls, no later event can ever take the window over, and
     `shockSev` latches at the worst severity the city has ever seen. That IS the
     ratchet — re-committed through the one constant whose real value (4 economic
     days against a ~40-minute mean event gap) created it in the first place. */
  if (SABOTAGE === 'shock-ratchet') ECON.shock.cost.recoveryDays = 1e6;

  // ── 1. THE GUARD ────────────────────────────────────────────────────────
  /* `shock: host && host.shock ? host.shock : 1` was a TRUTHINESS test on a
     number multiplied into every price in the city. 'abc' and {} crashed the
     tick outright; the rest poisoned the market silently. Every one of these
     must resolve to exactly 1 — neutral — and none may throw. */
  const HOSTILE = [['abc', 'abc'], ['{}', {}], ['[]', []], ['NaN', NaN],
                   ['Infinity', Infinity], ['-Infinity', -Infinity], ['true', true],
                   ['-5', -5], ['1e308', 1e308], ["'2'", '2'], ['null', null],
                   ['undefined', undefined], ['0', 0]];
  let guardBad = [];
  for (const [label, v] of HOSTILE) {
    let got = null, threw = null;
    try { got = Sim.shockOf({ shock: v }); } catch (e) { threw = e.message; }
    if (threw || got !== 1) guardBad.push(label + ' → ' + (threw ? 'THREW ' + threw : got));
  }
  chk('the shock guard resolves every hostile value to exactly 1 (' +
      HOSTILE.map(h => h[0]).join(', ') + ')', guardBad.length === 0, guardBad.join(' | '));
  chk('a legitimate shock passes through untouched', Sim.shockOf({ shock: 1.3 }) === 1.3 &&
      Sim.shockOf({}) === 1 && Sim.shockOf(null) === 1, String(Sim.shockOf({ shock: 1.3 })));

  /* And end to end: a whole tick fed each hostile value must not throw and must
     leave every price finite. The two that CRASHED sim.js are in this list. */
  let tickBad = null;
  Sim.reset('hostile'); HH.setPopulation(120); Sim.bootstrap();
  for (const [label, v] of HOSTILE) {
    try {
      Sim.advance(DAY, { powerFactor: 1, waterFactor: 1, hasBank: true,
                         infrastructure: 0.7, logisticsCounts: { warehouse: 2 }, shock: v });
    } catch (e) { tickBad = label + ' threw ' + e.message; break; }
    for (const m of Prices.movers()) {
      if (!isFinite(m.price) || !isFinite(m.mul)) { tickBad = label + ' → ' + m.id + ' price ' + m.price; break; }
    }
    if (tickBad) break;
  }
  chk('a full tick survives every hostile shock with finite prices', !tickBad, tickBad);

  // ── 2. THE PRICES MUST STILL MOVE ───────────────────────────────────────
  /* The fix must not be "delete the shock". A disaster is still a premium; what
     changed is that it now costs something as well. */
  const priceAfter = (shock) => {
    Prices.reset(); Sim.reset('px'); HH.setPopulation(200); Sim.bootstrap();
    for (let d = 0; d < 30; d++) {
      Sim.advance(DAY, { powerFactor: 1, waterFactor: 1, hasBank: true, infrastructure: 0.7,
                         logisticsCounts: { warehouse: 3 }, shock });
    }
    const out = {};
    for (const m of Prices.movers(400)) out[m.id] = m.price;
    return out;
  };
  const pxCalm = priceAfter(1), pxShock = priceAfter(1.6);
  let higher = 0, lower = 0, sample = '';
  for (const id in pxCalm) {
    if (!(id in pxShock)) continue;
    if (pxShock[id] > pxCalm[id] * 1.000001) { higher++; if (!sample) sample = id + ' ' + pxCalm[id].toFixed(3) + ' → ' + pxShock[id].toFixed(3); }
    else if (pxShock[id] < pxCalm[id] * 0.999999) lower++;
  }
  chk('prices still move under a shock (' + higher + ' up, ' + lower + ' down)', higher > 0, sample || 'nothing moved');

  // ── 3. THE ECONOMICS ────────────────────────────────────────────────────
  /* The realistic signal, reconstructed from the host's own constants rather
     than invented: RAID_INTERVAL is 7200 s and an economic day is
     clock.dayMin × 60 = 1200 s, so a raid cycle is exactly six economic days
     and `raidWindowFrac` (0.15 = 1080 s) is sampled on one of them. SIEGE_EVERY
     is 4, so every fourth wave is a siege. Nothing here is random. */
  const RAID_CYCLE_DAYS = 6, SIEGE_EVERY = 4;
  const raidSignal = d => (d % RAID_CYCLE_DAYS === RAID_CYCLE_DAYS - 1)
    ? 1 + ((Math.floor(d / RAID_CYCLE_DAYS) + 1) % SIEGE_EVERY === 0 ? ECON.shock.siegeGain : ECON.shock.raidGain)
    : 1;
  const DAYS = 240, MATERIAL = 500;
  const claim = (sig, pop, node, wh) => {
    Sim.reset(node); HH.setPopulation(pop); Sim.bootstrap();
    let claimed = 0, emergency = 0, shockedDays = 0;
    for (let d = 0; d < DAYS; d++) {
      const sh = sig(d); if (sh > 1) shockedDays++;
      Sim.advance(DAY, { powerFactor: 1, waterFactor: 1, hasBank: true, infrastructure: 0.7,
                         logisticsCounts: { warehouse: wh }, shock: sh });
      claimed += Sim.claimPayout();
      emergency += Sim.state().flow.emergency;
    }
    return { claimed, emergency, shockedDays, audit: Sim.state().lastAudit };
  };
  const CITIES = [['shock-probe', 200, 3], ['mu-12', 330, 3], ['rho-6', 45, 1]];
  console.log('\n  🌩 CLAIMED CINDER over ' + DAYS + ' economic days — calm vs the real raid cadence\n');
  for (const [node, pop, wh] of CITIES) {
    const calm = claim(() => 1, pop, node, wh);
    const raid = claim(raidSignal, pop, node, wh);
    const delta = raid.claimed - calm.claimed;
    const pct = (delta / Math.max(1, calm.claimed)) * 100;
    console.log('    ' + (node + '/pop' + pop).padEnd(20) +
                ' calm ' + String(calm.claimed).padStart(7) + ' 🔥   disasters ' + String(raid.claimed).padStart(7) +
                ' 🔥   ' + (delta >= 0 ? '+' : '') + delta + ' (' + pct.toFixed(1) + '%)   ' +
                'response bill ' + Math.round(raid.emergency).toLocaleString() + ' 🔥 over ' + raid.shockedDays + ' shocked days');
    chk('  ' + node + ': the calm baseline is material (> ' + MATERIAL + ' 🔥)', calm.claimed > MATERIAL, String(calm.claimed));
    chk('  ' + node + ': a disaster leaves the player POORER than calm weather', raid.claimed < calm.claimed,
        'calm ' + calm.claimed + ' vs disasters ' + raid.claimed);
    chk('  ' + node + ': the emergency response actually billed', raid.emergency > 0, String(raid.emergency));
    chk('  ' + node + ': the closed-loop audit survived the disaster', !!(raid.audit && raid.audit.ok),
        JSON.stringify(raid.audit));
  }
  /* Calm weather must be EXACTLY the old economy: every cost term is keyed on
     `shock − 1`, so at shock 1 nothing in this feature may execute. */
  const calmA = claim(() => 1, 200, 'shock-probe', 3);
  chk('a calm city is bit-identical and never touches the disaster path',
      calmA.emergency === 0, String(calmA.emergency));

  // ── 4. OFFLINE CATCH-UP MUST NOT RUN AT A FROZEN PREMIUM ────────────────
  /* Weather resets to clear on load, but `game.raid.timer` is SERIALISED and the
     offline sweep deliberately does not run raidTick, so a save written inside
     the raid window replays one frozen siege reading for the whole absence.

     🔴 THIS BLOCK USED TO ASSERT ON A CALL SHAPE PRODUCTION NEVER MAKES, AND
        THAT IS THE WHOLE LESSON OF IT. It drove the sweep as ONE
        `Sim.advance(DAY * maxCatchUpDays, …)` and passed. The shipped host does
        not do that: `offlineCatchUp()` runs
            while (done < simSec) { dt = min(OFFLINE_SLICE_SEC, …);
                                    await economyTick(dt / 60); }
        i.e. ~12,960 SEPARATE advance() calls for the 36 h cap, each re-sampling
        the same frozen host. Against the real shape the old per-call meter was
        re-issued 12,960 times and the sweep ended at lastShock 1.6 having run
        107 economic days — the defect, sitting behind this very ✅. So the loop
        below is the host's loop, and the host's own two constants are read OUT
        OF node-city rather than typed here: a copy would drift the day this
        round is meant to catch a drift.
     ⚠ Extraction failing is a HARD FAIL, not a skip — round 0b's rule. A round
       that quietly stops testing the shipped path is worse than no round. */
  let NCSRC = null;
  try {
    NCSRC = readFileSync(join(here, SABOTAGE === 'no-map'
      ? '../../public/node-city/NOT-THERE.html'
      : '../../public/node-city/index.html'), 'utf8');
  } catch (e) { NCSRC = null; }
  const ncConst = (name) => {
    if (!NCSRC) return null;
    const m = NCSRC.match(new RegExp('const\\s+' + name + '\\s*=\\s*([0-9.]+)\\s*;'));
    return m ? Number(m[1]) : null;
  };
  const SLICE_SEC = ncConst('OFFLINE_SLICE_SEC'), CAP_H = ncConst('OFFLINE_CAP_H');
  chk('read the host\'s own catch-up constants out of node-city/index.html',
      !!(SLICE_SEC > 0 && CAP_H > 0), 'slice ' + SLICE_SEC + ' / cap ' + CAP_H);

  const boot = (id) => { Prices.reset(); Sim.reset(id); HH.setPopulation(200); Sim.bootstrap(); };
  const H = (shock) => ({ powerFactor: 1, waterFactor: 1, hasBank: true, infrastructure: 0.7,
                          logisticsCounts: { warehouse: 3 }, shock });
  /* THE SHIPPED SWEEP, slice for slice. Returns what the economy was running at
     when the player got their city back. */
  /* `sig(elapsedSec)` is what the HOST would report at that instant, so the same
     loop can drive a frozen reading, a clear sky, or a city that really was
     raided over and over. `shockedDays` is the honest exposure measure: how much
     SIMULATED TIME actually ran at a premium, which is the quantity the defect
     was unbounded in and the one no aggregate price number can confound. */
  const sweep = (hours, sig) => {
    const simSec = hours * 3600;
    let done = 0, calls = 0, shockedDays = 0;
    while (done < simSec - 1e-9) {
      const dt = Math.min(SLICE_SEC || 10, simSec - done);
      Sim.advance(dt / 60, H(sig(done)));
      if (Sim.state().lastShock > 1) shockedDays += (dt / 60) / DAY;
      done += dt; calls++;
    }
    return { calls, shockedDays, days: Sim.state().day, last: Sim.state().lastShock };
  };
  const FROZEN = () => 1.6;

  const priceLevel = () => { let s = 0; for (const m of Prices.movers(400)) s += m.mul; return s; };
  boot('catchup');
  const swept = sweep(CAP_H || 36, FROZEN);
  const pxSweep = priceLevel(), billAtReturn = Sim.state().flow.emergency;
  boot('catchup-calm');
  const calmSweep = sweep(CAP_H || 36, () => 1);
  const pxCalmSweep = priceLevel();
  /* What the SAME absence would honestly have contained. RAID_INTERVAL is 7200 s
     and the ramp runs inside the last raidWindowFrac of it, so a 36 h absence is
     eighteen raid cycles — a real city would have seen ~16 shocked economic
     days. The frozen reading must buy a tiny fraction of that, not more of it. */
  boot('catchup-real');
  const realSweep = sweep(CAP_H || 36, (t) => ((t % 7200) > 7200 * (1 - ECON.shock.raidWindowFrac)) ? 1.6 : 1);
  boot('live');
  Sim.advance(DAY, H(1.6));
  const afterLive = Sim.state().lastShock;

  console.log('\n  🕓 THE ' + CAP_H + 'h SWEEP, driven in the host\'s own ' + SLICE_SEC + 's slices (' +
              swept.calls.toLocaleString() + ' advance() calls, ' + swept.days + ' economic days)\n');
  for (const [n, r] of [['frozen siege reading', swept], ['clear sky', calmSweep],
                        ['a city really raided', realSweep]])
    console.log('    ' + n.padEnd(24) + ' ran ' + r.shockedDays.toFixed(3).padStart(7) +
                ' economic days at a premium, ended at shock ' + r.last);

  chk('a ' + CAP_H + 'h catch-up driven in REAL ' + SLICE_SEC + 's slices ends CALM, a live day does not',
      swept.last === 1 && afterLive === 1.6, 'sweep ' + swept.last + ' / live ' + afterLive);
  /* 🔴 THE BOUND, AS A NUMBER. One frozen reading buys sampleDays of premium and
     no more, however long the absence — plus at most the one slice that spends
     the last sliver of the meter. This is the assertion the round was missing:
     before the fix this figure was the ENTIRE sweep (107 of 107 economic days).
     ⚠ Deliberately NOT a price comparison. The obvious test — "sweep prices
       below three genuinely shocked days" — was in this round and was measuring
       the wrong thing: the sliced path calls stepPrices ~12,960 times against
       the 3-day path's 3, so the price integrator's step count swamped the
       shock and the sliced sweep read HIGHER (Σmul 55.6 vs 51.0) even though it
       ran a hundredth of the exposure. Two tick shapes are not comparable by
       price level. Exposure in simulated days is the quantity in question. */
  const bound = ECON.shock.cost.sampleDays + 2 * ((SLICE_SEC || 10) / 60) / DAY;
  chk('the frozen reading buys at most ' + ECON.shock.cost.sampleDays + ' economic day(s) of premium (got ' +
      swept.shockedDays.toFixed(3) + ', a real raid cadence would have been ' +
      realSweep.shockedDays.toFixed(1) + ')',
      swept.shockedDays <= bound && realSweep.shockedDays > swept.shockedDays * 4,
      'sweep ' + swept.shockedDays + ' vs bound ' + bound + ' / real ' + realSweep.shockedDays);
  /* …and it is not zero either. The fix must not be "delete the shock offline":
     the sample the city DID observe still moves the market. */
  chk('the offline sweep still moved prices above a clear sky',
      swept.shockedDays > 0 && pxSweep > pxCalmSweep,
      'shocked Σmul ' + pxSweep.toFixed(2) + ' vs calm Σmul ' + pxCalmSweep.toFixed(2));
  /* The bound holds for a SHORT absence too — 3 h is the live-page probe that
     found this, which advanced 9 economic days at a frozen 1.2997. */
  boot('catchup-3h');
  const short = sweep(3, FROZEN);
  chk('a 3 h sweep (' + short.days + ' economic days) also ends CALM', short.last === 1, String(short.last));
  /* 🚒 AND THE BILL STOPS TOO. resolveShock() RE-ARMS the recovery window every
     time it sees sev > 0, so under the old per-call meter all 12,960 slices
     re-armed it and the emergency response was still being invoiced on the last
     day of the absence (1,631 🔥 on the final day alone, on the live page). Once
     the meter is spent the shock resolves to 1, nothing re-arms, and the window
     drains. Asserted on the SWEEP'S OWN final day — the day the player returns
     to and the one they would be billed for. */
  chk('the emergency bill is NOT still being invoiced when the player returns',
      billAtReturn === 0, String(billAtReturn));

  // ── 5. THE REPAIR WINDOW MUST NOT RATCHET ───────────────────────────────
  /* 🔴 THE DEFECT THIS SECTION EXISTS FOR, and it sat behind §3's ✅ for a whole
     round. `resolveShock()` armed the window with
         S.shockSev = Math.max(S.shockSev, sev);
         S.shockRecoveryLeft = ECON.shock.cost.recoveryDays;
     and `shockSev` was cleared in exactly ONE place — runDay step 9b, when the
     window fully expired. Because `recoveryDays` (4 economic days = 80 real
     minutes) is LONGER than the gap between shock-producing events, the window
     was re-armed before it could expire, so the level locked at the worst
     severity the city had ever seen and every later drizzle was invoiced at it,
     indefinitely. Measured pre-fix: one tornado-grade 1.33 on day 0 and then
     nothing but 1.148 snow every third day left `shockSev` reading 0.330 on all
     fifteen following days — 2.2× the true severity, for ever.

     ⚠ WHY §3 CANNOT SEE IT, AND WHY THIS SECTION DRIVES WEATHER TOO. §3's signal
       is RAIDS ONLY, and a raid fires on every SIXTH economic day with five
       clean calm days between — the one cadence in which a 4-day window DOES
       drain and the level DOES reset. RAID_INTERVAL 7200 s is six economic days,
       so raids alone hold the window open 4 days in 6 and never ratchet. It is
       node-city's own weather roll that closes the gaps: WX_ROLL_EVERY 150 s
       with a 0.062 non-rain probability per roll is a ~40-minute mean gap,
       comfortably inside the 80-minute window. A round that tests one of the two
       signals the host actually feeds this term is testing the easy one.

     🔑 THE SIGNAL IS BUILT FROM node-city's OWN ROWS, NOT FROM TYPED NUMBERS.
        WEATHER, WX_CHANCES and WX_ROLL_EVERY are lifted out of the shipped HTML
        and pushed back through ecoShock()'s published arithmetic
        (hit = 1 − allMult × outdoorMult; ×weatherGain; +severeAdd if severe) so
        that retuning a weather row retunes this round with it. Extraction
        failing is a HARD FAIL — round 0b's rule.
     🔑 DETERMINISTIC. The weather roll is a fixed-seed LCG, not Math.random, so
        this run is bit-identical every time exactly as the rest of the gate is.

     Prove it can fail: ECON_TEST_SABOTAGE=shock-ratchet. */
  const ncLit = (re) => {
    if (!NCSRC) return null;
    const m = NCSRC.match(re);
    try { return m ? Function('return (' + m[1] + ')')() : null; } catch (e) { return null; }
  };
  const ncNum2 = (name) => {
    if (!NCSRC) return null;
    const m = NCSRC.match(new RegExp('const\\s+' + name + '\\s*=\\s*([0-9.]+)\\s*[,;]'));
    return m ? Number(m[1]) : null;
  };
  const WEATHER   = ncLit(/const\s+WEATHER\s*=\s*(\{[\s\S]*?\n\});/);
  const WXCHANCE  = ncLit(/const\s+WX_CHANCES\s*=\s*(\[[\s\S]*?\n\]);/);
  const WX_EVERY  = ncNum2('WX_ROLL_EVERY');
  const RAID_IV   = ncNum2('RAID_INTERVAL');
  const SIEGE_N   = ncNum2('SIEGE_EVERY');
  chk('read node-city\'s OWN weather rows, roll cadence and raid clock',
      !!(WEATHER && WXCHANCE && WXCHANCE.length && WX_EVERY > 0 && RAID_IV > 0 && SIEGE_N > 0),
      'weather ' + (WEATHER ? Object.keys(WEATHER).length : 0) + ' rows / chances ' +
      (WXCHANCE ? WXCHANCE.length : 0) + ' / roll ' + WX_EVERY + ' / raid ' + RAID_IV +
      ' / siege ' + SIEGE_N);

  if (WEATHER && WXCHANCE && WX_EVERY > 0 && RAID_IV > 0 && SIEGE_N > 0) {
    const DAY_SEC = DAY * 60;
    /* ecoShock()'s weather half, term for term. Rain reads exactly 1 here — it
       has no allMult and no outdoorMult — which is correct and is why the
       0.062 figure above excludes it. */
    const wxMul = (type) => {
      const W = WEATHER[type];
      if (!W || type === 'clear') return 1;
      const all = (typeof W.allMult === 'number') ? W.allMult : 1;
      const out = (typeof W.outdoorMult === 'number') ? W.outdoorMult : 1;
      const hit = Math.max(0, Math.min(1, 1 - all * out));
      return 1 + hit * ECON.shock.weatherGain + (W.severe ? ECON.shock.severeAdd : 0);
    };
    /* The two ends of the real weather ladder, discovered rather than typed: the
       worst row the sky can produce and the mildest row that is a shock at all. */
    let SEVERE = { t: null, m: 1 }, MILD = { t: null, m: Infinity };
    for (const t in WEATHER) {
      const m = wxMul(t);
      if (!(m > 1)) continue;
      if (m > SEVERE.m) SEVERE = { t, m };
      if (m < MILD.m) MILD = { t, m };
    }
    chk('the weather ladder has a severe end and a distinctly milder one (' +
        SEVERE.t + ' ×' + SEVERE.m.toFixed(3) + ' vs ' + MILD.t + ' ×' + MILD.m.toFixed(3) + ')',
        !!(SEVERE.t && MILD.t && SEVERE.m > MILD.m * 1.05));

    const sevOf = (sh) => Math.max(0, Math.min(ECON.shock.cost.maxSeverity, sh - 1));

    /* ── 5a. THE TRACE THAT NAILS IT ────────────────────────────────────────
       One severe event, then nothing but the mildest shock in the game, spaced
       just inside the recovery window. Every later day must be billed at the
       MILD severity. Pre-fix every one of them read the severe severity. */
    const GAP = Math.max(1, SHIPPED_RD - 1);        // just inside the shipped window
    const TRACE_DAYS = 16;
    Sim.reset('ratchet-trace'); HH.setPopulation(200); Sim.bootstrap();
    const St = Sim.state();
    const seen = [];
    for (let d = 0; d < TRACE_DAYS; d++) {
      const sh = d === 0 ? SEVERE.m : (d % GAP === 0 ? MILD.m : 1);
      Sim.advance(DAY, H(sh));
      seen.push(St.shockSev);
    }
    const sevSev = sevOf(SEVERE.m), mildSev = sevOf(MILD.m);
    /* Days strictly after the severe event's own window has had time to drain.
       Inside it the severe rate is CORRECT — one day after a tornado the city is
       repairing a tornado. What may not happen is the clock being restarted. */
    const after = seen.slice(SHIPPED_RD);
    const worstAfter = Math.max(0, ...after);
    chk('a mild shock after a severe one is billed at the MILD rate (' +
        worstAfter.toFixed(3) + ' vs mild ' + mildSev.toFixed(3) + ', severe ' + sevSev.toFixed(3) + ')',
        worstAfter <= mildSev + 1e-9,
        'trace ' + seen.map(v => v.toFixed(3)).join(' '));
    chk('…and the mild shock is still billed at all (the fix is not "stop billing")',
        worstAfter >= mildSev - 1e-9, String(worstAfter));

    /* ── 5b. THE COMBINED SIGNAL, OVER A LONG DETERMINISTIC RUN ─────────────
       Weather AND raids, which is what the host actually feeds this term. */
    /* mulberry32, not the textbook LCG this was written with first. `seed *
       1103515245` overflows 2^53 in JS doubles, so the classic LCG silently
       loses its low bits here and produced a visibly clumped stream — 240 days
       of it contained exactly ONE calm stretch long enough to test the window's
       closure with. Every step below is Math.imul / xor, i.e. exact in int32. */
    let seed = 0x5eed >>> 0;
    const rnd = () => {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const combined = (days) => {
      seed = 0x5eed;
      const out = [];
      let t = 0, nextRoll = WX_EVERY * (0.6 + rnd() * 0.8), type = 'clear', until = 0;
      const cycleDays = RAID_IV / DAY_SEC;
      for (let d = 0; d < days; d++) {
        let worst = 1;
        const end = (d + 1) * DAY_SEC;
        while (t < end) {
          const at = Math.min(end, nextRoll);
          if (until > t) worst = Math.max(worst, wxMul(type));
          t = at;
          if (t >= nextRoll - 1e-9) {
            if (t >= until) {                       // the sky is free to change
              type = 'clear';
              const u = rnd(); let acc = 0;
              for (const c of WXCHANCE) { acc += c.p; if (u < acc) { type = c.type; break; } }
              if (type !== 'clear') {
                const D = WEATHER[type].dur || [0, 0];
                until = t + D[0] + rnd() * (D[1] - D[0]);
                worst = Math.max(worst, wxMul(type));
              }
            }
            nextRoll = t + WX_EVERY * (0.6 + rnd() * 0.8);
          }
        }
        /* The walls, on the host's own clock: the ramp lands in the last
           raidWindowFrac of each RAID_INTERVAL, and every SIEGE_EVERY-th wave is
           a siege. Same reconstruction §3 documents. */
        const raidDay = cycleDays >= 1 && (d % cycleDays) === Math.ceil(cycleDays) - 1;
        const wave = Math.floor(d / cycleDays) + 1;
        const raid = raidDay
          ? 1 + (wave % SIEGE_N === 0 ? ECON.shock.siegeGain : ECON.shock.raidGain) : 1;
        out.push(Math.min(ECON.shock.max, worst * raid));
      }
      return out;
    };
    /* 🔴 LONGER THAN §3's RUN, ON PURPOSE. The real combined signal is DENSE —
       a ~40-minute mean gap against a 20-minute economic day leaves half the
       calendar shocked — so a stretch of calm longer than the 4-day window is
       genuinely rare: 240 days contained only three such days, which is not a
       sample, it is an anecdote. The closure property is the one that needs
       calm to be observable at all, so §5 runs long enough to see it happen
       repeatedly rather than tuning the weather until it does. */
    const COMBO_DAYS = DAYS * 5;
    const SIG = combined(COMBO_DAYS);
    const shockedInSig = SIG.filter(s => s > 1).length;
    const driveCombined = (arr, node) => {
      Sim.reset(node); HH.setPopulation(200); Sim.bootstrap();
      const Sx = Sim.state();
      const trail = [];
      let claimed = 0, emergency = 0, openDays = 0, overBill = 0;
      /* 🔴 THE SECOND HALF OF THE DEFECT: a window that is re-armed faster than
         it drains never closes, so the level never gets cleared either. Asserted
         where it is unambiguous — at the end of every calm stretch LONGER than
         the shipped window. Inside a shorter stretch an open window is correct
         (the city really is still repairing), so a bare "% of days open" would
         be a threshold somebody picked, not a property. */
      let calmRun = 0, stretchesChecked = 0, stillOpen = 0;
      for (let d = 0; d < arr.length; d++) {
        trail.push(sevOf(arr[d]));
        Sim.advance(DAY, H(arr[d]));
        claimed += Sim.claimPayout();
        emergency += Sx.flow.emergency;
        if (Sx.shockRecoveryLeft > 0) openDays++;
        calmRun = (arr[d] > 1) ? 0 : calmRun + 1;
        /* Every day of every stretch past the window's length, not just the
           first: more samples, and it also catches a window that closes and is
           then somehow re-armed by nothing at all. */
        if (calmRun > SHIPPED_RD) {
          stretchesChecked++;
          if (Sx.shockRecoveryLeft > 0 || Sx.shockSev > 0) stillOpen++;
        }
        /* 🔴 THE RATCHET, AS ONE NUMBER: the severity the city is being billed
           at, against the worst severity anything ACTUALLY did to it inside the
           recovery window. A level that outlives its own cause by longer than the
           window is the defect, whatever the cause was. */
        const worstTrue = Math.max(0, ...trail.slice(Math.max(0, trail.length - SHIPPED_RD)));
        overBill = Math.max(overBill, Sx.shockSev - worstTrue);
      }
      return { claimed, emergency, openDays, overBill, stretchesChecked, stillOpen,
               audit: Sx.lastAudit };
    };
    /* ⚠ THE SAME NODE ID FOR BOTH RUNS, AND IT IS NOT A DETAIL. `Sim.reset(id)`
       seeds the terrain and the seams FROM the id, so a calm baseline taken on a
       different node is a different city — the first cut of this compared
       'combo-calm' against 'combo' and read +91%, which measured the two nodes'
       geology and nothing whatever about the weather. */
    const cCalm = driveCombined(SIG.map(() => 1), 'combo');
    const cReal = driveCombined(SIG, 'combo');
    const cDelta = cReal.claimed - cCalm.claimed;
    console.log('\n  🌩🌧 WEATHER + RAIDS, ' + COMBO_DAYS + ' deterministic economic days (' +
                shockedInSig + ' shocked days)\n');
    console.log('    claimed calm ' + cCalm.claimed + ' 🔥   with disasters ' + cReal.claimed +
                ' 🔥   ' + (cDelta >= 0 ? '+' : '') + cDelta +
                ' (' + (cDelta / Math.max(1, cCalm.claimed) * 100).toFixed(1) + '%)');
    console.log('    repair window open on ' + cReal.openDays + '/' + COMBO_DAYS + ' days (' +
                (cReal.openDays / COMBO_DAYS * 100).toFixed(1) + '%), response bill ' +
                Math.round(cReal.emergency).toLocaleString() + ' 🔥, worst over-bill ' +
                cReal.overBill.toFixed(4));

    chk('the combined signal really is denser than raids alone (> ' +
        Math.floor(COMBO_DAYS / (RAID_IV / DAY_SEC)) + ' shocked days)',
        shockedInSig > Math.floor(COMBO_DAYS / (RAID_IV / DAY_SEC)) * 2, String(shockedInSig));
    chk('there are calm days past the window to test closure on (' +
        cReal.stretchesChecked + ')', cReal.stretchesChecked >= SHIPPED_RD,
        String(cReal.stretchesChecked));
    chk('the repair window CLOSES — on every calm day past the ' +
        SHIPPED_RD + '-day window, the city is out of recovery (' +
        (cReal.stretchesChecked - cReal.stillOpen) + '/' + cReal.stretchesChecked + ')',
        cReal.stretchesChecked > 0 && cReal.stillOpen === 0,
        cReal.stillOpen + ' of ' + cReal.stretchesChecked + ' still open');
    chk('the billed severity NEVER outlives its cause (over-bill ' +
        cReal.overBill.toFixed(4) + ' must be 0)', cReal.overBill <= 1e-9,
        String(cReal.overBill));
    chk('under weather AND raids the player is still POORER than in calm weather',
        cReal.claimed < cCalm.claimed, 'calm ' + cCalm.claimed + ' vs ' + cReal.claimed);
    chk('the closed-loop audit survived the combined signal',
        !!(cReal.audit && cReal.audit.ok), JSON.stringify(cReal.audit));
  }

  if (fails) { bad++; console.log('\n=== ROUND 0i: ' + fails + ' FAILED ==='); }
  else console.log('\n=== ROUND 0i: ALL PASS ===');
}

for (const f of ['gauntlet1.mjs', 'gauntlet2.mjs', 'gauntlet3.mjs']) {
  console.log('\n########## ' + f + ' ##########');
  const r = spawnSync(process.execPath, [join(here, f)], { stdio: 'inherit' });
  if (r.status !== 0) bad++;
}
console.log(bad ? '\n❌ ECONOMY GAUNTLET: ' + bad + ' round(s) failed' : '\n✅ ECONOMY GAUNTLET: all rounds passed');
process.exit(bad ? 1 : 0);
