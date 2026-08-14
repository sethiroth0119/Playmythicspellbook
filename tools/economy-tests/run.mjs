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
     ECON_TEST_SABOTAGE=price-drift round0k: nudge the packagingMaterial timber
                                   coefficient 0.8 → 1.9 — the "soften the fall"
                                   retune FIX-D2 considered and rejected. It is a
                                   perfectly reasonable-looking recipe edit that
                                   moves 13 consumer goods, which is the whole
                                   point: 0k is red for a change nothing else in
                                   this gate can see
     ECON_TEST_SABOTAGE=twin-blind round0f: drop ECO_LOGISTICS_OPS on the way
                                   in — the exact pre-fix source for op_warehouse
     ECON_TEST_SABOTAGE=stale-workplaces round0f §7: evaluate workplaceTypes()
                                   against a BUILDINGS the ops registration loop
                                   has NOT run over. That is precisely what the
                                   `const WORKPLACES = Object.keys(BUILDINGS)…`
                                   snapshot did, three thousand lines too early
     ECON_TEST_SABOTAGE=cap-typo   round0f §9: mistype a value of
                                   ECO_LOGISTICS_TILES ('railhead' → 'railheed').
                                   Before §9 existed this passed EVERY check in
                                   the gate, because a key missing from
                                   ECON.logistics.capacity contributes 0 and both
                                   sides of every count comparison were 0
     ECON_TEST_SABOTAGE=venue-blind round0g: empty MORALE_VENUE_OPS on the way
                                   in — the exact pre-fix source for op_dojo
     ECON_TEST_SABOTAGE=wx-twin-blind round0h: empty WEATHER_TWIN_OPS on the way
                                   in — the exact pre-fix source for op_agri,
                                   op_smuggling, op_research and op_oil
    ECON_TEST_SABOTAGE=draw-compound round0e: open the founding window's treasury
                                   allowance, reproducing the per-call clamp that
                                   let one sync take 91.15% of the treasury

     ECON_TEST_SABOTAGE=warm-residue round0m: carry `Logistics.congestionMul`
                                   across `Sim.reset()` by hand — the shipped
                                   defect, in which a field written at the END of
                                   an economic day and read at the START of one
                                   was simply absent from reset(). Under it a
                                   fresh city is quoted freight at the PREVIOUS
                                   city's congestion, and the same configuration
                                   pays differently depending on what the test
                                   process happened to simulate before it

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

/* ════════════════════════════════════════════════════════════════════════════
   ROUND 0m — 🎲 THE HARNESS ITSELF MUST BE DETERMINISTIC
   ----------------------------------------------------------------------------
   THIS ROUND RUNS FIRST BECAUSE EVERY OTHER ROUND'S NUMBERS DEPEND ON IT.

   THE DEFECT IT EXISTS FOR, and it silently invalidated measurement across the
   whole gate for as long as it was there:
   `Logistics.reset()` cleared five fields and left a sixth. `S.congestionMul` is
   WRITTEN by `resolve()` at the end of an economic day and READ by
   `costPerUnit()` from the first freight quote of a day — including day 0, which
   happens before any `resolve()` has ever run. It was not declared on the state
   object and not cleared by `reset()`, so `S.congestionMul || 1` read 1 in a cold
   process and THE PREVIOUS CITY'S FINAL CONGESTION in a warm one. A brand-new
   city with nothing booked was quoted freight at up to `maxCongestionMul`,
   entirely according to what the test process happened to have simulated before.

   MEASURED ON THE BROKEN TREE, all calm, same configuration, same process:
     rho-6 / pop45 / warehouse-0 / 600d → 3,102 🔥 cold
                                        → 3,162 🔥 called again (+1.9%)
                                        → 3,102 🔥 after an intervening city
   and neutralising THAT ONE FIELD and nothing else restored 3,102 exactly.
   (The critic's stated hypothesis — `setNode()` early-returning without calling
   `Endow.invalidate()` — was checked first and is WRONG twice over: `reset()`
   calls `Endow.invalidate()` unconditionally, and the endowment is a pure
   function of the node id, so its cache cannot carry a value that differs.
   Prices, households, trade, bank and the firm registry were all cleared by hand
   and none of them restored the cold value either. Do not re-derive those.)

   WHY THAT MATTERED SO MUCH: the round this defect was found under (0i, the
   disaster-economics sweep, since deleted with the feature it guarded) measured
   a `calm` baseline FIRST and its shocked comparisons after, so the baseline and
   every number compared against it sat at DIFFERENT points in the residue
   history by construction. Its headline worst cell was −0.18% against order
   noise of 1.9% — a tenth of the noise. Every assertion in this gate that
   compares a before against an after was resting on run.mjs's own claim that
   "Nothing here is random", and that claim was false. THAT IS NOT A HISTORICAL
   NOTE: any future round that compares two runs inherits the same exposure, and
   this round is what makes the comparison mean something.

   WHAT IS ASSERTED HERE, and §1 is the important one:
     1. STRUCTURAL. After `Sim.reset()` the economy modules hold ONE state, no
        matter what was simulated before. This is the guarantee you can check by
        READING reset(), and it catches the whole class — every future field that
        someone forgets to clear — rather than the cells this round samples.
     2. BEHAVIOURAL. The same configuration run in five different call orders
        gives bit-identical results, compared on the full serialised city and not
        merely on the headline number.
     3. A host that varies a field the model no longer reads changes NOTHING.
        `host.shock` is that field: the disaster→prices term was removed and
        sim.js `shockOf()` now answers 1 to every input, so a pulsed signal and a
        calm one must produce bit-identical cities. Asserted rather than assumed,
        because "the field is inert" is precisely the kind of claim that rots.

   Prove this round can fail: ECON_TEST_SABOTAGE=warm-residue, which re-commits
   the defect exactly — it carries `congestionMul` across the reset by hand.
   ════════════════════════════════════════════════════════════════════════════ */
{
  console.log('\n########## round0m-harness-determinism ##########');
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
  const Firms = await import(P + 'firms.js');
  const Trade = await import(P + 'trade.js');
  const Logis = await import(P + 'logistics.js');
  const Bank = await import(P + 'bank.js');
  const { ECON } = await import(P + 'tuning.js');
  const DAY = ECON.clock.dayMin;

  /* 🧨 THE INJURY: `reset()` fails to clear one field of one module. Written as
     "carry the value across the reset" rather than by editing logistics.js,
     because that is precisely what the shipped bug DID — the field survived the
     reset — and a sabotage that reproduces the mechanism is worth more than one
     that reproduces the symptom. */
  const RESIDUE = SABOTAGE === 'warm-residue';

  const resetCity = (node) => {
    const carried = Logis.state().congestionMul;
    Sim.reset(node);
    if (RESIDUE) Logis.state().congestionMul = carried;
  };

  /* THE FINGERPRINT. Deliberately WIDER than Sim.serialize(): the carrier this
     round exists for lives in logistics.js, which does not ride the save at all,
     so a fingerprint taken from the save file could never have seen it. Anything
     a tick can READ has to be in here. */
  const fingerprint = () => JSON.stringify({
    sim: Sim.state(), hh: HH.state(), trade: Trade.state(), logistics: Logis.state(),
    bank: Bank.serialize(), prices: Prices.movers(999), firms: Firms.all(),
  });

  const drive = (sig, pop, node, wh, days) => {
    resetCity(node); HH.setPopulation(pop); Sim.bootstrap();
    let claimed = 0;
    for (let d = 0; d < days; d++) {
      Sim.advance(DAY, { powerFactor: 1, waterFactor: 1, hasBank: true, infrastructure: 0.7,
                         logisticsCounts: { warehouse: wh }, shock: sig(d) });
      claimed += Sim.claimPayout();
    }
    return { claimed, print: fingerprint() };
  };
  const calm = () => 1;
  const pulse = (mag, cad) => d => (d % cad === cad - 1 ? mag : 1);

  // ── 1. RESET IS A TRUE RESET ────────────────────────────────────────────
  /* Take the state fingerprint immediately after reset(), cold, then again after
     three deliberately dissimilar cities have been simulated. Any field the
     reset forgets shows up here as a diff, named, whether or not it happens to
     change a headline number today. */
  resetCity('det-a');
  const coldReset = fingerprint();
  const churn = [['det-b', 200, 3, 90], ['rho-6', 45, 0, 120], ['mu-12', 330, 1, 60]];
  const resetDiffs = [];
  for (const [node, pop, wh, days] of churn) {
    drive(calm, pop, node, wh, days);
    resetCity('det-a');
    const after = fingerprint();
    if (after !== coldReset) {
      /* Name the offending field rather than printing two 60 KB blobs. */
      const a = JSON.parse(coldReset), b = JSON.parse(after);
      const walk = (x, y, path) => {
        if (JSON.stringify(x) === JSON.stringify(y)) return;
        if (x && y && typeof x === 'object' && typeof y === 'object') {
          for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], path + '.' + k);
          return;
        }
        resetDiffs.push('after ' + node + '/pop' + pop + ':' + path +
                        ' cold=' + JSON.stringify(x) + ' warm=' + JSON.stringify(y));
      };
      walk(a, b, '');
    }
  }
  chk('reset() leaves ONE state, whatever was simulated before (' +
      churn.length + ' dissimilar cities churned through first)',
      resetDiffs.length === 0, resetDiffs.slice(0, 6).join(' | '));

  // ── 2. THE SAME CONFIGURATION, IN FIVE DIFFERENT CALL ORDERS ────────────
  /* The orders are chosen to be the ones a round actually produces: cold, an
     immediate repeat, after an unrelated city, after a DIFFERENT node (which is
     the axis the critic's hypothesis blamed), and after a save/load cycle. */
  const CELLS = [
    { name: 'rho-6/pop45/wh0/600d calm', sig: calm, pop: 45, node: 'rho-6', wh: 0, days: 600 },
    { name: 'rho-6/pop45/wh1/240d calm', sig: calm, pop: 45, node: 'rho-6', wh: 1, days: 240 },
    { name: 'mu-12/pop200/wh3/240d calm', sig: calm, pop: 200, node: 'mu-12', wh: 3, days: 240 },
    /* A host that PULSES `host.shock`. It kept a residue that only bit the
       shocked leg from hiding when the disaster term existed; it is kept now
       because §3 below compares it against the calm run of the same cell. */
    { name: 'rho-6/pop120/wh1/240d ×1.30/cad6', sig: pulse(1.30, 6), pop: 120, node: 'rho-6', wh: 1, days: 240 },
  ];
  const ORDERS = [
    ['cold', () => {}],
    ['immediate repeat', function (c) { drive(c.sig, c.pop, c.node, c.wh, c.days); }],
    ['after an unrelated city', () => { drive(calm, 260, 'det-b', 2, 120); }],
    ['after a different node', () => { drive(calm, 45, 'det-c', 0, 120); }],
    /* A reload is a real host event and it goes through a different door into the
       same state: load() calls reset() itself. If load left anything behind, a
       measurement taken after the player reloaded would not match one taken
       before, and no round in this gate would have noticed. */
    ['after a save/load', () => { const s = drive(calm, 160, 'det-d', 1, 90); void s; Sim.load(Sim.serialize()); }],
  ];
  let orderBad = [], cellRows = [];
  for (const c of CELLS) {
    let ref = null, row = [];
    for (const [label, prep] of ORDERS) {
      prep(c);
      const got = drive(c.sig, c.pop, c.node, c.wh, c.days);
      row.push(Math.round(got.claimed));
      if (ref === null) ref = got;
      else if (got.print !== ref.print || got.claimed !== ref.claimed) {
        orderBad.push(c.name + ' [' + label + '] ' + Math.round(got.claimed) +
                      ' 🔥 against cold ' + Math.round(ref.claimed) + ' 🔥' +
                      (got.claimed === ref.claimed ? ' (claim equal, CITY differs)' : ''));
      }
    }
    cellRows.push('    ' + c.name.padEnd(32) + row.map(v => String(v).padStart(8)).join(''));
  }
  console.log('\n  🎲 SAME CONFIGURATION, ' + ORDERS.length + ' CALL ORDERS — claimed 🔥\n');
  console.log('    cell                              ' +
              ORDERS.map(o => o[0].slice(0, 7).padStart(8)).join(''));
  console.log('    ' + '-'.repeat(32 + ORDERS.length * 8));
  for (const r of cellRows) console.log(r);
  console.log('');
  chk('every configuration is bit-identical across all ' + ORDERS.length +
      ' call orders (' + CELLS.length + ' cells, compared on the whole city and not just the claim)',
      orderBad.length === 0, orderBad.slice(0, 4).join(' | '));

  // ── 3. `host.shock` IS INERT ────────────────────────────────────────────
  /* The disaster→prices feature was removed and sim.js `shockOf()` now answers
     exactly 1 to every input, so a host that reports a violent, varying shock
     must produce a city IDENTICAL to one that reports none at all. Compared on
     the whole fingerprint, not the claim: a term that moved prices but happened
     to leave the payout alone would pass a claim-only check.
     ⚠ THIS IS A SAMPLE AND IT IS LABELLED AS ONE. The real guarantee is
       structural and is checked by READING `shockOf()`, whose every branch
       returns the literal 1. This cell exists so that re-wiring the field
       without re-reading that function turns the gate red. */
  const SHOCK_CELL = { pop: 120, node: 'shock-inert', wh: 1, days: 240 };
  const inertCalm = drive(calm, SHOCK_CELL.pop, SHOCK_CELL.node, SHOCK_CELL.wh, SHOCK_CELL.days);
  const inertPulse = drive(pulse(1.30, 6), SHOCK_CELL.pop, SHOCK_CELL.node, SHOCK_CELL.wh, SHOCK_CELL.days);
  /* A signal at the far end of what the guard's old band could express, held on
     EVERY day rather than pulsed — the shape that used to be the worst cell. */
  const inertHeld = drive(() => 1.60, SHOCK_CELL.pop, SHOCK_CELL.node, SHOCK_CELL.wh, SHOCK_CELL.days);
  /* And hostile values, which is the other half of what the guard is for: these
     crashed the tick outright before it existed. */
  const HOSTILE = ['abc', {}, NaN, Infinity, -5, true, [], 1e308, null, undefined];
  let hostileBad = '';
  for (const v of HOSTILE) {
    let got = null;
    try { got = drive(() => v, SHOCK_CELL.pop, SHOCK_CELL.node, SHOCK_CELL.wh, 60); }
    catch (e) { hostileBad = JSON.stringify(String(v)) + ' THREW: ' + e.message; break; }
    const ref = drive(calm, SHOCK_CELL.pop, SHOCK_CELL.node, SHOCK_CELL.wh, 60);
    if (got.print !== ref.print) { hostileBad = JSON.stringify(String(v)) + ' moved the city'; break; }
  }
  chk('a pulsed shock signal leaves the city bit-identical to a calm one (' +
      Math.round(inertCalm.claimed) + ' 🔥 both)',
      inertPulse.print === inertCalm.print && inertPulse.claimed === inertCalm.claimed,
      Math.round(inertPulse.claimed) + ' 🔥 against calm ' + Math.round(inertCalm.claimed) + ' 🔥');
  chk('a shock held at 1.60 on EVERY day is inert too',
      inertHeld.print === inertCalm.print && inertHeld.claimed === inertCalm.claimed,
      Math.round(inertHeld.claimed) + ' 🔥 against calm ' + Math.round(inertCalm.claimed) + ' 🔥');
  chk('every hostile host.shock value (' + HOSTILE.length +
      ') neither throws nor moves the city', hostileBad === '', hostileBad);

  if (fails) { bad++; console.log('\n=== ROUND 0m: ' + fails + ' FAILED ==='); }
  else console.log('\n=== ROUND 0m: ALL PASS ===');
}

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
       ⚠ THE LIST IS THE POINT: `new Function` resolves these names from the
         parameter list, so anything ecoHost() reaches for and is NOT named here
         throws ReferenceError and this round goes red. That is what makes the
         lift honest rather than a re-implementation. It used to carry an
         `ecoShock` stub; ecoHost no longer calls it (the disaster→prices term
         was removed) and a stub for a function nobody calls is exactly the dead
         scaffolding that makes the next reader hunt for a caller. */
    const runHost = (tiles, keyFn) => {
      const names = ['game', 'cityPop', 'ecoLogisticsCounts', 'bldSite', 'opsKeyOf',
                     'roadUsed', 'roadCap'];
      const fn = new Function(...names, 'return (function ecoHost() ' + BODY + ')();');
      return fn(
        { tiles, cov: { avg: 0.75, pct: { water: 1 } }, power: { factor: 1 } },
        () => 60, () => ({ warehouse: 3, depot: 2 }), bldSite, keyFn,
        () => 0, () => 1);
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

   ────────────────────────────────────────────────────────────────────────────
   §6–§9 WERE ADDED AFTER THE SWEEP THAT FOUND #1–#6 WAS SHOWN TO BE BLIND.
   Every hunt so far grepped `t.type === '…'` (or, for the weather family, a bare
   parameter named `type`). Two more shapes had never been looked at, and both
   were live:

     (a) LIST MEMBERSHIP — `TRUCK_STOPS.includes(t.type)`. Three of that list's
         six entries are derived twins (gasstation↔op_gas, scrapmine↔op_mining,
         fuelrig↔op_oil), so those three operations generated no freight traffic
         and were not truck endpoints. MEASURED LIVE, one probe city (3 roads,
         one housing, two probe tiles): scrapmine gave {commuteDest 2, truckStops
         2, trucks 2} and op_mining gave {3, 3, 0} — 3 being the "no stops at all,
         fall back to every road" answer.
     (b) A LOAD-ORDER SNAPSHOT, a shape nobody had named. `const WORKPLACES =
         Object.keys(BUILDINGS).filter(…)` is a top-level const evaluated ~3,100
         lines ABOVE the ops registration loop, so it froze BUILDINGS before any
         op_ row existed and NO OPERATION COULD EVER BE A COMMUTE DESTINATION.
         MEASURED LIVE: 45 workplace types, 0 of them op_; 60 and 15 after the
         fix, with all 15 op types satisfying the very predicate it filters on.
         There is no string and no list here — the defect is purely WHEN the
         expression ran, which is why §7 asserts on the SHAPE as well as on the
         behaviour.

   §6 and §7 therefore drive the two SHIPPED CONSUMERS — agentEndpoints() and
   desiredAgentCounts() — over a probe city, and fail on the WORST CELL of the
   op × twin sweep rather than on an average or on three lucky points. §8/§9 are
   the same class read backwards: a PRICE WITH NO PRODUCER (ECON.logistics
   .capacity prices `port` and `airfreight` and nothing in the city grants
   either) and a VALUE THAT NAMES NOTHING (a typo in ECO_LOGISTICS_TILES made
   both sides of every existing comparison equally zero and passed).

   Prove this round can fail:
     ECON_TEST_SABOTAGE=no-map      the scrape reads nothing ⇒ hard fail, never a
                                    vacuous pass (same switch round0b/0d honour)
     ECON_TEST_SABOTAGE=twin-blind  drops ECO_LOGISTICS_OPS on the way in, which
                                    is exactly the pre-fix source
     ECON_TEST_SABOTAGE=wx-twin-blind empties the op→standing-tile twin table
                                    §6 reads, which is the pre-fix TRUCK_STOPS
     ECON_TEST_SABOTAGE=stale-workplaces §7: the pre-fix load-order snapshot
     ECON_TEST_SABOTAGE=cap-typo    §9: a mistyped logistics value
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
  /* 0h's evaluator: a `with` over a Proxy answering 0 to every free identifier.
     BUILDINGS is the only table that needs it, because its rows cite constants
     declared elsewhere. §7 reads `crew`/`gen`/`defense` off it and those are
     literals; a stubbed cost cannot fake one. */
  const loose = (decl) => {
    const txt = srcBlockAfter(HTML, decl);
    if (!txt) return null;
    try {
      const scope = new Proxy({}, { has: () => true,
        get: (t, k) => (k === Symbol.unscopables ? undefined : 0) });
      return new Function('__s', 'with (__s) { return (' + txt + '); }')(scope);
    } catch (e) { return null; }
  };
  /* Array literals have no `{`, so srcBlockAfter cannot reach them — and a LIST
     is half of what this round now exists to check. Non-greedy to the first `]`,
     which is exact for a flat list of strings and returns null rather than a
     guess for anything nested. */
  const arrLit = (name) => {
    const m = HTML ? new RegExp('const\\s+' + name + '\\s*=\\s*(\\[[^\\]]*\\])\\s*;').exec(HTML) : null;
    if (!m) return null;
    try { const v = new Function('return (' + m[1] + ');')(); return Array.isArray(v) ? v : null; }
    catch (e) { return null; }
  };
  /* Comments are prose in this file and full of the very identifiers §6 greps
     for ("`TRUCK_STOPS.includes(t.type)`" appears in two headers describing the
     bug). A structural check that counts them is a check that can never go
     green, so strip them — same scanner discipline as srcBlockAfter, strings
     preserved because the guard lists ARE strings. */
  const stripComments = (src) => {
    if (!src) return '';
    let out = '', last = '';                 // last significant char, for regex/division
    for (let i = 0; i < src.length; i++) {
      const c = src[i], d = src[i + 1];
      if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) break; i = e + 1; continue; }
      if (c === '/' && d === '/') { const e = src.indexOf('\n', i + 2); if (e < 0) break; out += '\n'; i = e; continue; }
      /* 🔴 REGEX LITERALS, or this scanner desynchronises and never recovers.
         node-city is full of `/['"]op_[a-z]/`-shaped tests; a `/` that is not a
         comment used to be emitted raw, the apostrophe inside it opened a
         phantom string, and every block comment for the next 200k characters
         survived into "code". The standard disambiguator: a `/` starts a regex
         only when the previous significant character cannot end an expression. */
      if (c === '/' && (last === '' || '(,=:[!&|?{};+-*%~^<>'.includes(last))) {
        out += c; i++;
        for (let cls = false; i < src.length; i++) {
          const r = src[i]; out += r;
          if (r === '\\') { out += src[++i]; continue; }
          if (r === '[') cls = true; else if (r === ']') cls = false;
          else if (r === '/' && !cls) break;
          else if (r === '\n') break;         // unterminated ⇒ it was division
        }
        last = '/'; continue;
      }
      if (c === '"' || c === "'") {
        /* Bounded to one line. A single-quoted JS string cannot span a newline,
           so if no closing quote appears before it this was not a string at all
           and treating it as one is exactly how the desync happened. */
        const nl = src.indexOf('\n', i);
        let j = i + 1, closed = -1;
        for (; j < src.length && (nl < 0 || j < nl); j++) {
          if (src[j] === '\\') { j++; continue; }
          if (src[j] === c) { closed = j; break; }
        }
        if (closed < 0) { out += c; last = c; continue; }
        out += src.slice(i, closed + 1); i = closed; last = c; continue;
      }
      if (c === '`') {
        let j = i + 1;
        for (; j < src.length; j++) { if (src[j] === '\\') { j++; continue; } if (src[j] === '`') break; }
        out += src.slice(i, j + 1); i = j; last = '`'; continue;
      }
      out += c;
      if (!/\s/.test(c)) last = c;
    }
    return out;
  };

  const OP_BP        = lit('const OP_BP');
  const OP_ECO_MAP   = lit('const OP_ECO_MAP');
  const CITY_ECO_MAP = lit('const ECO_BUILDING_MAP');
  const LOG_TILES_RAW= lit('const ECO_LOGISTICS_TILES');
  /* The mistyped value the `cap-typo` switch injects. It is deliberately a
     PLAUSIBLE typo of a real key, because that is the failure §9 exists for. */
  const LOG_TILES    = SABOTAGE === 'cap-typo'
    ? { ...LOG_TILES_RAW, railyard: 'railheed' } : LOG_TILES_RAW;
  const LOG_OPS_RAW  = lit('const ECO_LOGISTICS_OPS');
  const LOG_OPS      = SABOTAGE === 'twin-blind' ? {} : LOG_OPS_RAW;
  const LOG_UNIMPL   = arrLit('ECO_LOGISTICS_UNIMPLEMENTED');
  const BODY         = srcBlockAfter(HTML, 'function ecoLogisticsCounts()');
  const prefixM      = HTML ? /const\s+OPS_PREFIX\s*=\s*'([^']*)'/.exec(HTML) : null;
  const PREFIX       = prefixM ? prefixM[1] : null;
  /* ⚠ THE MODULE SCRIPT ONLY, not the whole file. node-city is an HTML document
     and its prose is full of apostrophes ("the city's"); fed the markup, the
     stripper takes the first one as a string opener and desynchronises — which
     it did, silently, and §7 then "found" a WORKPLACES snapshot inside the very
     comment that describes the bug. The self-check below is the guard: a
     correctly stripped source contains no `/*` at all. */
  const jsAt        = HTML ? HTML.indexOf('<script type="module">') : -1;
  const SRC         = jsAt >= 0 ? stripComments(HTML.slice(jsAt)) : '';

  // ── §6/§7 scaffolding: the shipped agent guards and everything they reach ──
  const BUILDINGS_RAW = loose('const BUILDINGS');
  const REG_BODY      = srcBlockAfter(HTML, 'for (const t of OPS_TYPES)');
  const WX_TWIN_RAW   = lit('const WEATHER_TWIN_OPS');
  const WX_TWIN       = SABOTAGE === 'wx-twin-blind' ? {} : WX_TWIN_RAW;
  const AGENTS_LIT    = lit('const AGENTS');
  const WEATHER_LIT   = lit('const WEATHER');
  const TRUCK_STOPS   = arrLit('TRUCK_STOPS');
  const FN = {};
  for (const [k, decl] of Object.entries({
    weatherTwinType: 'function weatherTwinType(type)', twinTileType: 'function twinTileType(type)',
    isTruckStop: 'function isTruckStop(ty)', workplaceTypes: 'function workplaceTypes()',
    tileAt: 'function tileAt(x, z)', isRoad: 'function isRoad(x, z)',
    allRoadKeys: 'function allRoadKeys()', roadsAdjacentTo: 'function roadsAdjacentTo(match)',
    roadsAdjacentToTypes: 'function roadsAdjacentToTypes(types)',
    roadsAdjacentToAnchors: 'function roadsAdjacentToAnchors()',
    agentEndpoints: 'function agentEndpoints(kind, agent)',
    desiredAgentCounts: 'function desiredAgentCounts()',
  })) FN[k] = srcBlockAfter(HTML, decl);

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
    chk('read OPS_PREFIX', !!PREFIX, String(PREFIX)) &
    chk('read ECO_LOGISTICS_UNIMPLEMENTED (§8 needs the explicit declaration, not a guess)',
        Array.isArray(LOG_UNIMPL), String(LOG_UNIMPL)) &
    chk('read the twelve shipped agent guards + BUILDINGS + AGENTS + WEATHER + TRUCK_STOPS + the ops loop',
        Object.values(FN).every(Boolean) && !!BUILDINGS_RAW && !!REG_BODY && !!AGENTS_LIT &&
        !!WEATHER_LIT && !!WX_TWIN_RAW && Array.isArray(TRUCK_STOPS),
        Object.entries(FN).filter(([, v]) => !v).map(([k]) => k).join(',') + ' | ' +
        [BUILDINGS_RAW, REG_BODY, AGENTS_LIT, WEATHER_LIT, WX_TWIN_RAW, TRUCK_STOPS]
          .map(o => o ? 'ok' : 'NULL').join('/')) &
    chk('the comment stripper left real code behind AND removed every block comment ' +
        '(a desynced stripper reads prose as code — it did, once)',
        SRC.length > 200000 && SRC.indexOf('function ecoLogisticsCounts()') > 0 && SRC.indexOf('/*') < 0,
        SRC.length + ' chars, first surviving /* at ' + SRC.indexOf('/*') +
        ' :: ' + SRC.slice(Math.max(0, SRC.indexOf('/*')), SRC.indexOf('/*') + 90));

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

    /* ══ §6/§7 — THE TWO SHAPES THE `t.type === '…'` SWEEP CANNOT SEE ═══════
       The SHIPPED consumers are assembled and run over a probe city. Nothing
       here is a copy of a guard: agentEndpoints, desiredAgentCounts, the two
       road-adjacency helpers, isTruckStop, workplaceTypes and the twin resolver
       are all lifted from node-city, and the ops REGISTRATION LOOP is lifted
       too — "no op_ row exists yet" is the load-bearing half of §7 and a
       hand-built BUILDINGS here would be asserting about a fiction.
       ⚠ COPIED VERBATIM, and only these: `key`, `NEI` (a const arrow and a const
         array — srcBlockAfter needs a `{`, and neither carries a tile-type
         comparison to get wrong). Same concession round0c/0d/0f make for
         `bldSite`, for the same stated reason. */
    const buildGuards = (BLD) => {
      const city = { tiles: {}, anchors: [] };
      const api = new Function(
        'game', 'bldSite', 'opsKeyOf', 'OPS_TYPES', 'BUILDINGS', 'TRUCK_STOPS',
        'POLICE_SOURCES', 'WEATHER_TWIN_OPS', 'WEATHER', 'wx', 'wellbeing', 'AGENTS',
        'let nightAmt = 0;\nlet _wxTwinTypes = null;\nlet _workplaceTypes = null;\n' +
        "const key = (x, z) => x + ',' + z;\nconst NEI = [[0,-1],[1,0],[0,1],[-1,0]];\n" +
        Object.entries(FN).map(([k, b]) => {
          const args = { weatherTwinType: 'type', twinTileType: 'type', isTruckStop: 'ty',
            workplaceTypes: '', tileAt: 'x, z', isRoad: 'x, z', allRoadKeys: '',
            roadsAdjacentTo: 'match', roadsAdjacentToTypes: 'types', roadsAdjacentToAnchors: '',
            agentEndpoints: 'kind, agent', desiredAgentCounts: '' }[k];
          return 'function ' + k + '(' + args + ') ' + b + '\n';
        }).join('') +
        'return { agentEndpoints, desiredAgentCounts, isTruckStop, workplaceTypes, twinTileType };')
        (city, bldSite, opsKeyOf, Object.keys(OP_BP), BLD, TRUCK_STOPS,
         arrLit('POLICE_SOURCES') || [], WX_TWIN, WEATHER_LIT, { type: 'clear' },
         { morale: 50 }, AGENTS_LIT);
      /* THE PROBE CITY. Three road tiles, not four: desiredAgentCounts() floors
         trucks at 1 once `roads >= 4` ("ambient street life"), and a floor is
         exactly the kind of thing that turns a broken guard green. Two probe
         tiles so the truck endpoint set can reach 2 and skip the `stops.length
         < 2 ⇒ use every road` fallback — with one tile the fallback answer and
         the correct answer are both "some roads" and nothing is measured. */
      api.probe = (ty) => {
        for (const k of Object.keys(city.tiles)) delete city.tiles[k];
        for (let x = 1; x <= 3; x++) city.tiles[x + ',5'] = { type: 'road', lvl: 1, bld: null };
        city.tiles['2,6'] = { type: 'housing', lvl: 1, bld: null };
        if (ty) { city.tiles['1,4'] = { type: ty, lvl: 1, bld: null };
                  city.tiles['3,4'] = { type: ty, lvl: 1, bld: null }; }
        return { commuteDest: api.agentEndpoints('civilian').to.length,
                 truckStops: api.agentEndpoints('truck').to.length,
                 trucks: api.desiredAgentCounts().truck };
      };
      return api;
    };
    /* Two BUILDINGS: one the registration loop has run over, one it has not.
       The second IS the pre-fix world and the `stale-workplaces` switch keeps
       it — a fix whose old behaviour cannot be reproduced cannot be shown to
       have been needed. */
    const mkBld = (registered) => {
      const B = loose('const BUILDINGS');
      if (registered) new Function('OPS_TYPES', 'OP_BP', 'BUILDINGS', 'opsKeyOf', 'BUILD_ORDER',
        'OP_ECO_MAP', 'ECO_BUILDING_MAP', 'for (const t of OPS_TYPES) ' + REG_BODY)
        (Object.keys(OP_BP), OP_BP, B, opsKeyOf, [], OP_ECO_MAP, { ...CITY_ECO_MAP });
      return B;
    };
    const BLD_POST = mkBld(true), BLD_PRE = mkBld(false);
    const G = buildGuards(SABOTAGE === 'stale-workplaces' ? BLD_PRE : BLD_POST);
    const CONTROL = G.probe(null);          // no probe tile: the fallback answer

    // ── 6. 📋 LIST-SHAPED GUARDS — the shape no `===` grep prints ───────────
    console.log('   ↳ probe city control (no probe tile) = ' + JSON.stringify(CONTROL) +
                '  — every number here is the "fall back to every road" answer');
    /* Every top-level SCREAMING_CASE array of standing building types is a guard
       list by construction, discovered rather than hand-listed so a future one
       is armed the day it is written. */
    const guardLists = [];
    for (const m of SRC.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*(\[[^\]]*\])\s*;/g)) {
      let v = null; try { v = new Function('return (' + m[2] + ');')(); } catch (e) { v = null; }
      if (!Array.isArray(v) || v.length < 2) continue;
      if (!v.every(s => typeof s === 'string' && s.indexOf(PREFIX) !== 0 && BLD_PRE[s])) continue;
      /* 🚫 REGISTRIES ARE NOT GUARDS. BUILD_ORDER starts life as a list of
         standing types and is then APPENDED TO by the ops registration loop, so
         it satisfies the shape above and has ten op twins in it — and it is not
         a guard at all, it is the build menu. A list the ops loop extends has
         already been taught about operations by construction. */
      if (new RegExp('\\b' + m[1] + '\\s*\\.\\s*push\\s*\\(').test(SRC)) {
        console.log('   ↳ ' + m[1] + ' is a REGISTRY (the ops loop pushes into it), not a guard list — skipped');
        continue;
      }
      guardLists.push({ name: m[1], list: v });
    }
    chk('found the LIST-shaped guards at all (a discovery that matches nothing passes vacuously)',
        guardLists.length > 0, guardLists.map(g => g.name).join(','));
    for (const g of guardLists) {
      g.twins = Object.keys(OP_BP).filter(o => twinOf(o) && g.list.includes(twinOf(o)));
      console.log('   ↳ guard list ' + g.name + ' = [' + g.list.join(', ') + ']  ·  op twins in it: [' +
                  (g.twins.join(', ') || 'NONE — exempt until one appears') + ']');
    }
    /* THE STRUCTURAL HALF. A list whose set contains an op twin may not be read
       by a bare membership test anywhere in the file. This is what generalises:
       it fires for a list this round has never heard of. */
    const rawUse = [];
    for (const g of guardLists) {
      if (!g.twins.length) continue;
      for (const m of SRC.matchAll(new RegExp('\\b' + g.name + '\\s*\\.\\s*(includes|indexOf)\\s*\\(([^)]*\\)?[^)]*)\\)', 'g')))
        if (!/twinTileType\s*\(/.test(m[2])) rawUse.push(g.name + '.' + m[1] + '(' + m[2].trim() + ')');
      for (const m of SRC.matchAll(new RegExp('roadsAdjacentToTypes\\s*\\(\\s*' + g.name + '\\s*\\)', 'g')))
        rawUse.push(m[0]);
    }
    chk('🔴 no guard list with an op twin is read by a BARE membership test — THE CLASS',
        rawUse.length === 0, rawUse.join(' | '));
    /* THE BEHAVIOURAL HALF, swept, failing on the WORST CELL. */
    const measured = {}, meas = (ty) => (measured[ty] = measured[ty] || G.probe(ty));
    let worstList = null;
    for (const op of Object.keys(OP_BP)) {
      const tw = twinOf(op); if (!tw) continue;
      const a = meas(opsKeyOf(op)), b = meas(tw);
      if (JSON.stringify(a) !== JSON.stringify(b) && !worstList)
        worstList = opsKeyOf(op) + ' ' + JSON.stringify(a) + '  vs its twin ' + tw + ' ' + JSON.stringify(b);
    }
    chk("🔴 EVERY derived twin is the SAME truck source and the same endpoint as its " +
        'standing tile, measured through the shipped agentEndpoints/desiredAgentCounts',
        !worstList, 'WORST CELL — ' + worstList);
    console.log('   ↳ ' + Object.keys(OP_BP).filter(o => G.isTruckStop(opsKeyOf(o))).map(opsKeyOf).join(', ') +
                ' generate freight;  standing truck stops: ' + TRUCK_STOPS.join(', '));
    chk('BEFORE: the raw list scores all three freight operations at ZERO',
        !['mining', 'oil', 'gas'].some(o => TRUCK_STOPS.includes(opsKeyOf(o))));

    // ── 7. 🕒 THE LOAD-ORDER SNAPSHOT ───────────────────────────────────────
    /* THE SHAPE. Any top-level `const X = Object.keys(BUILDINGS)…` declared
       ABOVE the registration loop has this bug automatically, whatever it is
       called and whatever it filters on — so the assertion is about position,
       not about WORKPLACES. */
    const regAt = SRC.indexOf('for (const t of OPS_TYPES)');
    const snaps = [];
    /* ⚠ ANCHORED AT COLUMN 0 (`^` with /m). That is what "top-level" means in
       this file, and it is the whole distinction: workplaceTypes()'s own
       `const list = Object.keys(BUILDINGS)…` is INDENTED and runs per call,
       which is the fix. Without the anchor this check reports the fix as the
       bug — it did on the first run. */
    for (const m of SRC.matchAll(/^const\s+(\w+)\s*=\s*Object\.(keys|values|entries)\s*\(\s*BUILDINGS\s*\)/gm))
      if (m.index < regAt) snaps.push(m[1] + ' at char ' + m.index + ' (registration loop at ' + regAt + ')');
    chk('🔴 no top-level Object.keys(BUILDINGS) snapshot is taken ABOVE the ops registration ' +
        'loop — THE SHAPE, not the instance', regAt > 0 && snaps.length === 0, snaps.join(' | '));
    const WP = G.workplaceTypes();
    const wpOps = Object.keys(OP_BP).filter(o => WP.includes(opsKeyOf(o)));
    console.log('   ↳ workplace types: ' + WP.length + ', of which operations: ' + wpOps.length +
                '/' + Object.keys(OP_BP).length);
    chk('every operation whose blueprint gives it crew is a WORKPLACE (the snapshot had none of them)',
        wpOps.length === Object.keys(OP_BP).length,
        Object.keys(OP_BP).filter(o => !WP.includes(opsKeyOf(o))).join(','));
    /* PARITY, swept, worst cell. An op that shipped with crew:0 beside a twin
       that has crew turns this red — the untaught-op case. */
    let worstWp = null;
    for (const op of Object.keys(OP_BP)) {
      const tw = twinOf(op); if (!tw) continue;
      const a = WP.includes(opsKeyOf(op)), b = WP.includes(tw);
      if (a !== b && !worstWp) worstWp = opsKeyOf(op) + '=' + a + ' vs twin ' + tw + '=' + b;
    }
    chk('…and an operation is a commute destination exactly when its standing twin is',
        !worstWp, 'WORST CELL — ' + worstWp);
    let worstDest = null;
    for (const op of Object.keys(OP_BP)) {
      const a = meas(opsKeyOf(op));
      if (a.commuteDest === CONTROL.commuteDest && !worstDest)
        worstDest = opsKeyOf(op) + ' ' + JSON.stringify(a) + ' — identical to the no-workplace fallback';
    }
    chk('…and the shipped agentEndpoints() really routes commuters to each one',
        !worstDest, 'WORST CELL — ' + worstDest);
    /* THE MEMO TRAP, the same one weatherTwinType()/isMoraleVenue() carry: an
       answer computed before the ops exist must not be cached, or "operations
       are not workplaces" becomes permanently true. */
    const preG = buildGuards(BLD_PRE);
    const preCount = preG.workplaceTypes().length;
    chk('BEFORE: the pre-registration BUILDINGS yields a workplace set with NO operation in it',
        preCount < WP.length && !preG.workplaceTypes().some(t => t.indexOf(PREFIX) === 0),
        preCount + ' types vs ' + WP.length);

    // ── 8. 🚢 THE CLASS BACKWARDS: A PRICE WITH NO PRODUCER ─────────────────
    /* Sweep every building type in the game plus the anchor branch through the
       shipped counter and collect which capacity kinds anything can actually
       grant. `port` (8,800/day) and `airfreight` (2,100/day) are granted by
       nothing, so node-city declares them unimplemented and this checks the
       declaration against reality rather than trusting it. */
    const reach = new Set();
    const probes = Object.keys(BLD_POST).map(ty => ({ type: ty, lvl: 1 }))
      .concat([{ type: 'anchor', lvl: 1, anchor: { node: { node_type: '__t' } } }]);
    for (const p of probes) {
      const fn = new Function('game', 'bldSite', 'opsKeyOf', 'NODE_TYPES', 'ECO_LOGISTICS_TILES',
        'ECO_LOGISTICS_OPS', 'return (function ecoLogisticsCounts() ' + BODY + ')();');
      const c = fn({ tiles: { '9,9': p } }, bldSite, opsKeyOf,
                   { __t: { feeds: ['__roads__'] } }, LOG_TILES, LOG_OPS);
      for (const k in c) if (c[k] > 0) reach.add(k);
    }
    console.log('   ↳ capacity kinds reachable from some tile: [' + [...reach].join(', ') +
                ']  ·  declared unimplemented: [' + LOG_UNIMPL.join(', ') + ']');
    const orphanCap = Object.keys(CAP).filter(k => !reach.has(k) && !LOG_UNIMPL.includes(k));
    chk('🔴 every key of ECON.logistics.capacity is reachable from some tile, or is ' +
        'explicitly declared unimplemented', orphanCap.length === 0,
        orphanCap.map(k => k + ' priced at ' + CAP[k] + '/day and granted by nothing').join(', '));
    chk('…and nothing REACHABLE is hiding on the unimplemented list (it cannot be used to ' +
        'silence a live kind)', !LOG_UNIMPL.some(k => reach.has(k)),
        LOG_UNIMPL.filter(k => reach.has(k)).join(','));
    chk('…and the unimplemented list names only real capacity keys',
        LOG_UNIMPL.every(k => k in CAP), LOG_UNIMPL.filter(k => !(k in CAP)).join(','));

    // ── 9. 💥 A VALUE THAT NAMES NOTHING ────────────────────────────────────
    /* ecoLogisticsCounts()'s own header requires every value of the two tables
       to be a capacity kind, and NOTHING CHECKED IT. A typo ('railheed') makes
       the count land on a key ECON does not price, so it contributes 0 — and
       every comparison in §1–§4 stays green because both sides are equally
       zero. That is the same failure mode as a test that samples three points. */
    const badVal = Object.entries(LOG_TILES).concat(Object.entries(LOG_OPS_RAW))
      .filter(([, v]) => !(v in CAP)).map(([k, v]) => k + ' → ' + v);
    chk('🔴 every VALUE of ECO_LOGISTICS_TILES/ECO_LOGISTICS_OPS is a priced kind in ' +
        'ECON.logistics.capacity', badVal.length === 0,
        badVal.join(', ') + ' — priced kinds are [' + Object.keys(CAP).join(', ') + ']');

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
   ROUND 0k — 💰 BASE-PRICE DRIFT: A RECIPE EDIT MAY NOT SILENTLY REPRICE THE
              CONSUMER BASKET
   ----------------------------------------------------------------------------
   🔴 THE BUG THIS ROUND EXISTS FOR, WITH ITS NUMBER.
   The card package re-rooted `packagingMaterial` from {cardboard 0.7, plastic
   0.2} to {timber 0.8} so the Ouroboros chain could actually run. It could not
   have been more clearly in scope, and it was correct. It also moved 19 of the
   258 derived base prices, and ELEVEN of them have nothing to do with cards:

     packagingMaterial 4.477→0.974 −78.2%   packagedFood −20.9%   snacks −19.8%
     beverages −19.1%   frozenFood −13.4%   emergencyFood −13.2%
     personalCareProducts −10.8%   processedMeat −8.3%   bottledWater −8.2%
     cleaningProducts −5.6%   emergencySupplies −3.3%   medicine −2.0%
     pharmaceuticals −0.9%   advancedMedicine −0.4%

   Nobody noticed. Every round was green, because every round asked whether the
   chain PRODUCED, whether the audit BALANCED, whether the ids were REACHABLE —
   and none of those questions can see a price. `packagingMaterial` is an input
   to 13 goods; one recipe line rewrote what households pay for food, medicine
   and cleaning products, and rewrote the denomination of the `value` figure
   cardOutput() hands the Foundation Reserve. It reached the gate as a footnote
   reading "packaging firms now trade".

   THE CLASS OF BUG IS "A RECIPE EDIT REPRICES UNRELATED GOODS", AND IT WILL
   RECUR, because prices.js derives every price from the graph — which is the
   right design and is exactly why one coefficient reaches everywhere. The only
   defence against a derived catalogue is a snapshot of the derived catalogue.

   ── WHAT THIS ROUND ASSERTS ────────────────────────────────────────────────
   BASELINE below is the WHOLE derived catalogue — every id deriveBase() knows,
   not a watchlist, because a watchlist only ever contains the ids somebody
   already thought of, and the eleven goods above were precisely the ids nobody
   thought of. Any id moving more than DRIFT_TOL, appearing, or disappearing is
   a RED that names it. Base prices are a pure function of ECON and RECIPES with
   no clock, no RNG and no node in them, so this is exactly reproducible and the
   tolerance can be tight.

   ⚠ GOING RED HERE IS NOT "YOU BROKE SOMETHING". It is "you changed prices, say
     so". Re-baseline in the SAME commit that moves them, and put the numbers in
     the commit message. That is the entire deliverable: the number changing is
     fine, the number changing in silence is what cost a package.

   ⚠ WHY THIS IS NOT A RUBBER STAMP, PROVEN ON EVERY RUN. A snapshot test that
     is never exercised rots into an assertion that passes because nothing
     called it. §2 below therefore re-runs the detector against the ACTUAL
     pre-card-package recipe and requires it to fire and to name
     `packagingMaterial` plus the consumer goods. So this round demonstrates,
     every time it runs, that it would have caught the change that created it.
     (That is deliberately not a `dark-cards`-style env switch: the historical
     case is the one case worth checking unconditionally.)

   Prove the round can fail from the outside too: ECON_TEST_SABOTAGE=price-drift
   nudges the `packagingMaterial` timber coefficient 0.8→1.9 — the "soften the
   fall" retune that was considered and rejected — and §1 must go red naming it.
   ════════════════════════════════════════════════════════════════════════════ */
{
  console.log('\n########## round0k-base-price-drift ##########');
  let fails = 0;
  const chk = (name, cond, extra) => {
    if (cond) { console.log('✅ ' + name); return true; }
    fails++; console.log('❌ ' + name + (extra ? ' :: ' + extra : '')); return false;
  };

  const R = await import('../../public/src/economy/recipes.js');
  const P = await import('../../public/src/economy/prices.js');

  /* The baseline, packed several ids to a row purely so 258 numbers stay
     reviewable in a diff. 8 significant figures — deriveBase() is deterministic,
     so anything looser would let a real move hide inside the rounding. */
  const BASELINE_ROWS = [
  'acids:9.70038 adhesives:6.3074081 advancedAlloys:32.687785 advancedBatteries:27.348391',
  'advancedMedicine:93.882588 advancedMicrochips:121.45881 advancedSensors:78.387204',
  'aerospaceAluminum:43.973653 agriculturalMachinery:25.463368 aluminum:6.8920429',
  'aluminumOre:2.0228571 animalFeed:0.91375884 anomalousEnergy:219.14286',
  'anomalousMatter:255.66667 anomalySensors:140.72752 appliances:22.029748',
  'arcaneCrystal:292.19048 artificialIntelligenceHardware:216.62864 asphalt:1.5697984',
  'automationSystems:117.67078 aviationFuel:5.6777831 batteries:12.496193 beverages:2.1041269',
  'biomass:0.55310685 books:11.738103 boosterPacks:7.6536281 bottledWater:2.3080658',
  'bread:1.812369 brick:1.2361633 buses:121.42305 cannedFood:2.9304904 cardBoxes:47.516575',
  'cardStock:3.1244433 cardboard:2.3419063 cars:73.233381 cement:1.7912744 cheese:15.493517',
  'chemicalFeedstock:6.3513932 circuitBoards:20.344229 classifiedTechnology:260.45006',
  'clay:0.4956 cleaningChemicals:8.2873659 cleaningProducts:8.4066824 clothing:6.7391939',
  'coal:1.2872727 cobalt:9.44 collectorPacks:27.643281 commercialWaste:0.0375',
  'communicationComponents:21.343569 communicationDevices:37.661254',
  'communicationEquipment:39.936347 compositeMaterials:13.738718 compost:0.2655',
  'computerComponents:49.967544 computers:82.456878 concrete:2.1236238',
  'constructionComponents:10.084747 constructionEquipment:43.398836',
  'constructionGlass:4.2179363 containmentEquipment:294.7911 containmentMaterials:75.594533',
  'cookingOil:1.6896892 copper:6.5221682 copperOre:2.1784615 copperWire:9.2099571',
  'corn:0.52168421 cotton:0.90109091 crudeOil:1.5308108 dairy:4.6434556',
  'dataStorageHardware:84.067089 deliveryVehicles:78.939968 diagnosticEquipment:97.293603',
  'diesel:3.6174495 dimensionalMaterial:438.28571 displays:31.072665 droneComponents:72.232696',
  'eggs:1.6729544 electricVehicles:122.03991 electricalComponents:9.8613182 electricity:0.25',
  'electronicComponents:16.709527 electronicWaste:0.0375 emergencyEquipment:29.949767',
  'emergencyFood:4.3821729 emergencySupplies:8.9645 engines:20.21532 fabric:4.3908501',
  'factoryEquipment:56.305207 fertilizer:5.4768835 fiberOpticCable:11.813466 flour:1.110262',
  'freightVehicles:122.36547 freshFish:1.0325 freshWater:0.54575 frozenFood:3.2111626',
  'fruit:0.826 furniture:8.1092477 furnitureComponents:4.3685868 gasoline:3.8039851',
  'generators:19.871934 glass:2.2793239 goldOre:12.586667 gravel:0.38123077',
  'hazardousMaterialEquipment:99.678009 hazardousWaste:0.0375 heavyMachinery:40.352319',
  'herbs:1.77 holographicChemicals:35.492001 holographicChips:117.29301',
  'holographicComponents:65.516705 holographicFoil:42.232737 holographicProjectors:171.04253',
  'householdGoods:9.1321553 hydrogen:3.328898 industrialChemicals:8.6128014',
  'industrialFuel:3.7663208 industrialGas:2.9236515 industrialMachinery:25.425414',
  'industrialRobots:187.86378 industrialVehicles:64.509265 industrialWaste:0.0375',
  'industrialWater:0.413 inkChemicals:10.927511 insulation:7.7057634 ironOre:1.77',
  'leather:3.6591235 limestone:0.53869565 lithium:6.2933333 livestock:6.1641174',
  'lumber:1.4203267 luxuryGoods:12.389771 machineParts:11.652847 maintenanceParts:15.394149',
  'meat:3.7511366 medicalChemicals:14.003373 medicalEquipment:27.77018',
  'medicalSupplies:9.0690974 medicalWaste:0.0375 medicine:16.288482 metalAlloys:10.174337',
  'metalComponents:9.4131702 microchips:77.135205 miningEquipment:46.59934',
  'mythicEssence:191.75 mythicResidue:122.72 naturalGas:1.3814634 naturalGasFuel:2.6110522',
  'networkingEquipment:66.186754 nickelOre:3.776 nuclearFuel:67.831038',
  'officeSupplies:7.6524872 opticalComponents:12.568518 organicWaste:0.0375',
  'packagedFood:2.7229497 packagingMaterial:0.97428667 paint:8.2623044 paper:5.957267',
  'personalCareProducts:4.1167307 petrochemicals:4.3801518 pharmaceuticals:46.122885',
  'pigIron:4.8655528 plantFiber:0.76246154 plastic:9.3987366 plasticFeedstock:6.5214581',
  'platinumOre:22.656 plumbingComponents:6.641336 plywood:2.3325514 potatoes:0.45054545',
  'poultry:3.1887602 prefabricatedComponents:12.364236 premiumPaper:7.1042187',
  'preparedMeals:2.4493443 printedCards:6.6146853 printingInk:13.771023',
  'processedMeat:4.5851538 processors:158.40091 protectiveCoating:8.0584548',
  'protectiveEquipment:15.545745 pumps:14.369309 quantumComponents:117.60093 quartz:1.4576471',
  'rareEarthMinerals:35.4 rareMinerals:30.975 rawMilk:2.9221055 rawWater:0.25',
  'realityFragments:681.77778 realityMatter:383.5 realityStabilizationComponents:203.97022',
  'reclaimedIndustrialMaterials:3.6164379 reclaimedWater:0.25 recycledElectronics:3.3774909',
  'recycledGlass:0.441025 recycledMetal:0.53395 recycledPaper:0.38055 recycledPlastic:0.48675',
  'reinforcedConcrete:4.7111748 reinforcedContainmentMaterials:177.97682',
  'relayComponents:55.224305 researchChemicals:25.718649 researchEquipment:157.79398',
  'residentialWaste:0.0375 restaurantSupplies:3.2942137 rice:0.6195 robotics:103.78761',
  'rubber:6.8652713 sand:0.413 satelliteComponents:105.55551 satelliteSystems:325.27674',
  'seafood:1.18 seaweed:0.85448276 secureElectronics:113.60715 securityEquipment:33.797785',
  'seeds:1.239 semiconductorChemicals:25.254676 semiconductorMaterials:62.055083',
  'sensors:36.152988 servers:296.8389 sheetMetal:10.501739 shellfish:1.9061538 shoes:5.3817367',
  'signalProcessors:135.59598 silica:0.63538462 siliconWafers:30.297312 silverOre:8.0914286',
  'smartphones:60.858049 snacks:1.6781959 solvents:8.0852792 soulEnergy:322.94737',
  'soybeans:0.6608 specializedMedicalSupplies:89.51962 specialtyPolymers:12.468306',
  'sportingGoods:8.5685637 starterDecks:14.537948 steel:8.0434746 stone:0.51625',
  'structuralSteel:12.383997 sugar:1.7457198 sugarCrops:0.58305882 surgicalSupplies:16.446494',
  'surveillanceEquipment:79.704619 syntheticFiber:7.3362476 timber:0.68833333 tires:9.7773829',
  'titanium:7.08 tournamentProducts:45.828122 toys:7.5384717 trucks:108.10154',
  'tungsten:10.298182 turbines:37.939574 vegetables:0.708 vehicleParts:15.970069',
  'wastewater:0.0375 wheat:0.55066667 wiring:13.437501 wood:0.72882353 woodPanels:2.1337304',
  'woodPulp:2.6176727 zincOre:3.3317647',
  ];
  const BASELINE = {};
  for (const row of BASELINE_ROWS) for (const cell of row.split(' ')) {
    const c = cell.lastIndexOf(':');
    if (c > 0) BASELINE[cell.slice(0, c)] = Number(cell.slice(c + 1));
  }

  /* 0.25%. Tight because there is nothing stochastic to absorb: the same ECON
     and the same RECIPES give the same doubles on every run. Loose enough that
     a pure reflow of the relaxation (SWEEPS, ordering) does not cry wolf.
     `medicine` moved 2.0% and `pharmaceuticals` 0.9% in the change above, so a
     1% tolerance would have MISSED pharmaceuticals — which is the argument
     against picking a comfortable number. */
  const DRIFT_TOL = 0.0025;

  /* Returns the whole delta, sorted worst-first. Never an average and never a
     count on its own: the point of this round is to NAME the goods that moved,
     because "3 prices drifted" tells a reviewer nothing about whether dinner
     got cheaper. */
  function drift(actual) {
    const moved = [], added = [], gone = [];
    for (const id in BASELINE) {
      if (!(id in actual)) { gone.push(id); continue; }
      const d = (actual[id] - BASELINE[id]) / Math.max(1e-12, BASELINE[id]);
      if (Math.abs(d) > DRIFT_TOL) moved.push({ id, from: BASELINE[id], to: actual[id], pct: d * 100 });
    }
    for (const id in actual) if (!(id in BASELINE)) added.push(id);
    moved.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
    return { moved, added, gone };
  }
  const cell = m => m.id + ' ' + m.from.toPrecision(6) + '→' + m.to.toPrecision(6) +
                    ' (' + (m.pct >= 0 ? '+' : '') + m.pct.toFixed(2) + '%)';
  function show(d, cap) {
    if (d.moved.length) {
      console.log('     WORST CELL: ' + cell(d.moved[0]));
      for (const m of d.moved.slice(0, cap || 24)) console.log('       ' + cell(m));
      if (d.moved.length > (cap || 24)) console.log('       … and ' + (d.moved.length - (cap || 24)) + ' more');
    }
    if (d.added.length) console.log('     NEW ids not in the baseline: ' + d.added.join(', '));
    if (d.gone.length)  console.log('     ids that VANISHED from the catalogue: ' + d.gone.join(', '));
  }

  if (SABOTAGE === 'price-drift') {
    R.RECIPES.packagingMaterial.in.timber = 1.9;
    console.log('   🧨 packagingMaterial timber 0.8 → 1.9 (the rejected "soften the fall" retune)');
  }

  // ── §1 THE TRIPWIRE ──────────────────────────────────────────────────────
  const now = P.deriveBase(true);
  const nIds = Object.keys(now).length, nBase = Object.keys(BASELINE).length;
  chk('the derived catalogue is still ' + nBase + ' ids wide', nIds === nBase,
      'deriveBase() now returns ' + nIds);
  const d1 = drift(now);
  if (!chk('NO base price has drifted past ' + (DRIFT_TOL * 100).toFixed(2) + '% — ' +
           'a recipe edit did not silently reprice the catalogue',
           d1.moved.length === 0 && d1.added.length === 0 && d1.gone.length === 0,
           d1.moved.length + ' moved, ' + d1.added.length + ' new, ' + d1.gone.length + ' gone')) {
    show(d1);
    console.log('     → If you MEANT this, re-baseline BASELINE_ROWS in the same commit');
    console.log('       (regenerate: for each id, `id:` + Number(deriveBase(true)[id].toPrecision(8)))');
    console.log('       and put these percentages in the commit message.');
  }

  // ── §2 THE DETECTOR MUST BE ABLE TO FIRE, ON THE HISTORICAL CASE ──────────
  /* Swap in the EXACT pre-card-package recipe and require the detector to
     catch it AND to name the goods a reader would care about. If this ever goes
     green, §1's green means nothing. */
  const SHIPPED = R.RECIPES.packagingMaterial;
  R.RECIPES.packagingMaterial = { in: { cardboard: 0.7, plastic: 0.2 },
                                  labor: 0.07, power: 0.12, ind: 'packaging' };
  const d2 = drift(P.deriveBase(true));
  const named = d2.moved.map(m => m.id);
  const MUST_NAME = ['packagingMaterial', 'packagedFood', 'snacks', 'beverages', 'frozenFood',
                     'emergencyFood', 'personalCareProducts', 'processedMeat', 'bottledWater',
                     'cleaningProducts', 'medicine', 'pharmaceuticals'];
  const missed = MUST_NAME.filter(id => !named.includes(id));
  chk('self-test — reverting packagingMaterial to {cardboard,plastic} FIRES this round',
      d2.moved.length > 0, 'the detector saw nothing; §1 is a rubber stamp');
  chk('self-test — and it names all ' + MUST_NAME.length + ' goods the original change moved',
      missed.length === 0, 'missed: ' + missed.join(', '));
  if (d2.moved.length) {
    console.log('   ↳ this is what the gate WOULD have printed had this round existed:');
    show(d2, 14);
  }
  R.RECIPES.packagingMaterial = SHIPPED;
  if (SABOTAGE === 'price-drift') R.RECIPES.packagingMaterial.in.timber = 0.8;
  /* Recompute so nothing after this round reads a poisoned `_base`. deriveBase
     memoises, and §2 left the cache holding the counterfactual catalogue. */
  P.deriveBase(true);

  if (fails) { bad++; console.log('\n=== ROUND 0k: ' + fails + ' FAILED ==='); }
  else console.log('\n=== ROUND 0k: ALL PASS ===');
}

/* ════════════════════════════════════════════════════════════════════════════
   ROUND 0n — 🤝 REAL CITY-TO-CITY TRADE
   ----------------------------------------------------------------------------
   THE DEFECT THIS ROUND EXISTS FOR IS THE DOUBLE SHIP.

   `city_trade_fill(offer_id, units)` takes `for update` on the offer row for one
   reason: two cities filling the last 40 units of the same offer would otherwise
   both read `filled_units = 0`, both write 40, and the seller would ship 80. The
   lock makes the SERVER's answer authoritative — and an authoritative answer is
   worth exactly nothing if the client then credits the number it ASKED for. That
   substitution is a one-word edit, it looks completely reasonable in review
   (`credit(req.units)` beside a variable called `filled`), and every green day in
   the gate would stay green: the audit only tracks Cinder, and goods that appear
   out of nowhere do not fail it.

   So the invariant is asserted by SWEEPING the space rather than by sampling it:
   every combination of what we asked for against what the server said, including
   the server answering MORE than we asked, and the round fails on the worst cell.

   WHAT ELSE IS HERE, and why each is not a comment:
     §1 STRUCTURAL — /src/economy/trade.js contains no network call at all. That
        is provable by READING it, and reading beats sampling: it holds for every
        future partner shape, not for the ones this round happens to try. Comments
        are stripped first, because that file legitimately DISCUSSES Supabase.
     §3 DEGRADE — every failure shape the transport can produce (throw, null, {},
        a non-numeric `filled`, an array, a timeout answered as null) credits
        nothing and leaves the city trading. sql/038 IS NOT APPLIED, so this is
        not an edge case: it is the shipping configuration.
     §4 refreshPartners() must never overwrite a REAL partner's inventory with
        fabricated numbers, and must still refill the simulated ones. The flag is
        the only thing separating a real neighbour from an invention.
     §6 Rule 1 with settlement live: a fill moves value between two parties and
        must not mint. Driven for 240 consecutive days.

   Prove this round can fail: ECON_TEST_SABOTAGE=settle-requested, which
   re-commits the double ship exactly — the driver hands recordFill the quantity
   it REQUESTED in place of the quantity the server filled.
   ════════════════════════════════════════════════════════════════════════════ */
{
  console.log('\n########## round0n-city-trade ##########');
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
  const PP = '../../public/src/economy/';
  const Sim = await import(PP + 'sim.js');
  const Trade = await import(PP + 'trade.js');
  const HH = await import(PP + 'households.js');
  const Logis = await import(PP + 'logistics.js');
  const { ECON } = await import(PP + 'tuning.js');
  await import(PP + 'index.js');                 // registers window.MythicEconomy
  const E = global.window.MythicEconomy;
  const DAY = ECON.clock.dayMin;
  const HOST = { powerFactor: 1, waterFactor: 1, hasBank: true, infrastructure: 0.7,
                 logisticsCounts: { warehouse: 2 } };

  /* 🧨 THE INJURY: the client credits its own request instead of the server's
     answer. Written at the CALL SITE rather than by editing trade.js, because
     that is exactly the shape the bug takes in real code — the row is right
     there and the wrong field is used. */
  const SETTLE_SABOTAGE = SABOTAGE === 'settle-requested';
  const settle = (req, row) => Trade.recordFill(req, SETTLE_SABOTAGE ? { ...row, filled: req.units } : row);

  // ── §1 NOT ONE NETWORK CALL IN THE MODULE ────────────────────────────────
  /* Strip comments FIRST. trade.js and economy/index.js both talk about
     Supabase, Cloud and the bridge at length — a grep over the raw text would
     be green only by luck and red for a doc edit. */
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  const NET = [
    ['supabase', /supabase/i], ['createClient', /createClient/], ['Cloud.', /\bCloud\s*\./],
    ['fetch(', /\bfetch\s*\(/], ['XMLHttpRequest', /XMLHttpRequest/], ['WebSocket', /WebSocket/],
    ['.rpc(', /\.rpc\s*\(/], ['.from(', /\.from\s*\(\s*['"]/], ['navigator.sendBeacon', /sendBeacon/],
    ['Profile.', /\bProfile\s*\./],
  ];
  for (const f of ['trade.js', 'index.js']) {
    const raw = readFileSync(join(here, '../../public/src/economy/' + f), 'utf8');
    const src = stripComments(raw);
    chk(f + ': the comment stripper actually ran (it is what makes this check honest)',
        src.length < raw.length * 0.9, src.length + ' of ' + raw.length + ' chars left');
    const hits = NET.filter(([, re]) => re.test(src)).map(([n]) => n);
    chk('/src/economy/' + f + ' contains ZERO network calls — every one lives in ' +
        'index.html next to Cloud and Profile (the globals trap)',
        hits.length === 0, 'found: ' + hits.join(', '));
    // Rule 2: a chain resource must never be written through the game ledger.
    const led = ['addRes', 'spendRes', 'refundRes'].filter(n => new RegExp('\\b' + n + '\\s*\\(').test(src));
    chk('/src/economy/' + f + ' never calls addRes/spendRes — Rule 2, the economy ' +
        'holds its own inventory', led.length === 0, 'found: ' + led.join(', '));
  }

  // ── §2 THE INVARIANT, SWEPT ──────────────────────────────────────────────
  /* Every ASKED × FILLED pair, including the server answering more than it was
     asked for (a doctored proxy, or a future RPC change). The rule is one line:
     credit min(filled, asked), and 0 for anything that is not a positive
     finite number. */
  Sim.reset('trade-n1'); HH.setPopulation(60); Sim.bootstrap();
  const ASKED = [1, 2, 7, 13, 40, 199, 1000];
  const answers = (a) => [0, 1, Math.max(1, a - 1), a, a + 1, a * 3, -a, a / 3];
  let swept = 0, worst = null;
  for (const asked of ASKED) {
    for (const f of answers(asked)) {
      const req = { offerId: 'o-' + asked + '-' + f, res: 'steel', units: asked,
                    unitPrice: 10, partnerId: 'p1', partnerName: 'Farvale' };
      const before = Trade.pendingSettlements().reduce((n, s) => n + s.units, 0);
      const r = settle(req, { filled: f, remaining: 0, unit_price: 10 });
      const after = Trade.pendingSettlements().reduce((n, s) => n + s.units, 0);
      const expect = (f > 0) ? Math.min(f, asked) : 0;
      swept++;
      if (r.credited !== expect || Math.abs((after - before) - expect) > 1e-9) {
        const over = r.credited - expect;
        if (!worst || over > worst.over) worst = { asked, f, got: r.credited, expect, over, queued: after - before };
      }
    }
  }
  chk('settlement credits min(filled, asked) on all ' + swept + ' asked×filled cells — ' +
      'NEVER what was requested (the double-ship bug)',
      worst === null,
      worst ? ('worst cell: asked ' + worst.asked + ', server filled ' + worst.f +
               ' → credited ' + worst.got + ' (expected ' + worst.expect + '), queued ' + worst.queued) : '');

  /* The non-numeric answers, which are the ones a JSON transport actually
     produces. `numeric` comes back as a STRING from PostgREST on some
     deployments, so '25' must work and 'abc' must not. */
  const JUNK = [undefined, null, NaN, Infinity, -Infinity, 'abc', '', {}, [], true, false, () => 40];
  let junkBad = [];
  for (const v of JUNK) {
    const req = { offerId: 'j', res: 'steel', units: 40, unitPrice: 10 };
    let r; try { r = Trade.recordFill(req, { filled: v, unit_price: 10 }); }
    catch (e) { junkBad.push(String(v) + ' THREW ' + e.message); continue; }
    if (r.credited !== 0) junkBad.push(JSON.stringify(String(v)) + ' credited ' + r.credited);
  }
  chk('a non-numeric `filled` (' + JUNK.length + ' shapes) credits nothing and never throws',
      junkBad.length === 0, junkBad.slice(0, 4).join(' | '));
  const strNum = Trade.recordFill({ offerId: 's', res: 'steel', units: 40, unitPrice: 10 },
                                  { filled: '25', unit_price: '9.5' });
  chk('a numeric STRING fills normally — PostgREST returns `numeric` as a string',
      strNum.credited === 25, 'credited ' + strNum.credited);

  // ── §3 EVERY DEGRADE SHAPE, THROUGH THE SHIPPED tradeSync() ──────────────
  /* Driven through window.MythicEconomy.tradeSync() with a stub bridge, so this
     exercises the real orchestration — publish, discover, plan, settle — and not
     a test-only twin of it. */
  /* 🔴 THE OFFERS ARE DERIVED FROM THE CITY'S OWN STRATEGIC GAPS, NOT INVENTED.
     The first version of this round used a hand-written shopping list (iron ore,
     steel, bread) and planned ZERO fills for all 240 days — it asserted that
     settlement was correct while never settling anything, which is precisely the
     kind of test this project has shipped before. Two reasons it was vacuous,
     both of them real behaviour worth knowing:
       · a want's `maxPrice` is fixed at the price on the day it was raised, and
         prices roughly double over the first day of a fresh city, so an
         ordinary want will not pay today's price for anything;
       · freight is ~3 🔥/unit at these hops, which is more than a loaf of bread
         is worth — bulk goods legitimately do not travel.
     A STRATEGIC GAP is the case that does clear: the city cannot mine it at any
     price, so `urgent` bypasses the price test — the mechanism the whole feature
     exists for. Deriving the ids from Endow keeps this true if the endowment
     ever changes, instead of rotting into another vacuous round. */
  const Endow = await import(PP + 'endowment.js');
  const gapsOf = (node) => Endow.strategicGaps(node);
  const realRows = (node) => {
    const g = gapsOf(node);
    return [
      { id: 'city-A', name: 'Farvale', nodeId: 'node-A', specs: ['mining'],
        sells: { ironOre: 500, coal: 400, steel: 120 }, buys: { bread: 200, medicine: 80 },
        offers: g.slice(0, 2).map((res, i) => ({ offerId: 'off-A' + i, res, units: 300, unitPrice: 0 })) },
      { id: 'city-B', name: 'Deepmere', nodeId: 'node-B', specs: ['agricultural'],
        sells: { wheat: 900, bread: 300 }, buys: { steel: 150, lumber: 100 },
        offers: g.slice(2, 3).map((res, i) => ({ offerId: 'off-B' + i, res, units: 200, unitPrice: 0 })) },
    ];
  };
  /* The shortfall a city with those gaps really does raise. Injected through
     the SHIPPED buildWants() — the same call sim.js makes — rather than by
     writing into S.wants, so the urgency flag is set by the code under test. */
  const wantGaps = (node, units) => {
    const short = {};
    for (const id of gapsOf(node)) short[id] = units;
    Trade.buildWants(short, node, Sim.state().day);
    return short;
  };
  const mkNet = (fill, node) => ({
    publish: async () => true,
    discover: async () => realRows(node || Sim.state().nodeId),
    fill,
  });
  const mountFresh = (node) => { E.mount({ nodeId: node, population: 90 }); Sim.state().treasury = 250000; };

  /* 🔴 THE FIRST SHAPE IS A SUCCESS, AND IT IS THE MOST IMPORTANT ONE HERE.
     Every other entry in this list answers with a failure, so before it existed
     §3 asserted the credit rule against an RPC THAT NEVER ONCE SUCCEEDED: a
     tradeSync() that credited nothing at all, ever, was green through the whole
     list. "Credits nothing on failure" is only half a spec; the other half is
     "credits exactly `filled` on success", and success is the shape that runs in
     production. It is checked below on four separate counts — the quantity the
     transport was HANDED, the quantity credited, the queue, and the goods
     actually landing after a day. */
  const PARTIAL = 0.4;                       // the server fills 40% of every ask
  const SUCCESS = 'a PARTIAL fill (the normal case)';
  const SHAPES = [
    [SUCCESS, async (id, units) => ({ filled: Math.floor(units * PARTIAL), remaining: 0, unit_price: 3 })],
    ['the RPC throws',                 async () => { throw new Error('42P01 relation does not exist'); }],
    ['the RPC returns null',           async () => null],
    ['the RPC returns undefined',      async () => undefined],
    ['a malformed row ({})',           async () => ({})],
    ['a malformed row (no filled)',    async () => ({ remaining: 40, unit_price: 3 })],
    ['a non-numeric filled',           async () => ({ filled: 'plenty', unit_price: 3 })],
    ['filled: 0 (someone else took the last units)', async () => ({ filled: 0, remaining: 0, unit_price: 3 })],
    ['the raw ARRAY, unwrapped',       async () => ([{ filled: 40, unit_price: 3 }])],
    ['a timeout, answered as null',    async () => new Promise(r => setTimeout(() => r(null), 5))],
    ['the whole seam is missing',      null],
  ];
  /* The shortfall each shape raises. NOT the same number as any offer size:
     the offers below hold 300/300/200 units, so a plan built from the request
     comes out [250, 250, 200] — a multiset that matches neither the want
     ([250,250,250]) nor the offer ([300,300,200]). That is what lets the
     success shape below tell "the transport was handed req.units" apart from
     "it was handed the want" or "it was handed the whole offer". */
  const WANT = 250;
  let shapeBad = [], drive = [];
  for (const [label, fill] of SHAPES) {
    const wins = label === SUCCESS;
    mountFresh('degrade-' + label.length);
    /* 🔴 A SPY ON THE TRANSPORT, NOT JUST A STUB. The first version of this
       loop measured nothing: a freshly mounted city has an EMPTY S.wants, so
       planFills() returned [], tradeSync()'s fill loop never ran, and all ten
       "failure shapes" were asserted against a transport that was never called
       once. §3 is the ONLY coverage tradeSync()'s fill loop has — the
       substitution `recordFill(req, {...row, filled: req.units})` in
       economy/index.js would have shipped green through it. So the stub counts
       its own calls and the gate below fails if any shape got zero. */
    let calls = 0; const args = [];
    /* The spy records its ARGUMENTS as well as its call count. `units` is the
       only quantity that may reach the RPC — handing it the want, the offer
       size or a doubled figure is a different bug from mis-crediting the
       answer, and the credit assertions below cannot see it. */
    const spy = fill ? (async (offerId, units) => { calls++; args.push({ offerId, units }); return fill(offerId, units); }) : null;
    global.window.MythicCityBridge.cityTrade = spy ? mkNet(spy) : { publish: async () => false, discover: async () => [] };
    /* THE CITY MUST WANT SOMETHING BEFORE IT CAN ASK FOR IT. Raised through the
       shipped buildWants() off this node's own STRATEGIC gaps, exactly as §6
       does — those are `urgent`, which is what gets them past the maxPrice test
       on day 0 of a fresh city (see the vacuity note above §3's fixtures). */
    const node = Sim.state().nodeId;
    wantGaps(node, WANT);
    let rep = null, threw = '';
    try { rep = await E.tradeSync(); } catch (e) { threw = e.message; }
    const pending = Trade.pendingSettlements();
    const partners = Trade.state().partners.length;
    /* Measured across the SETTLED ids only, and taken before the day runs: on
       the success shape these goods must actually arrive, not merely be
       counted. */
    const invBefore = { ...Sim.inventory() };
    let snap = null;
    try { snap = Sim.advance(DAY, HOST); } catch (e) { threw = threw || ('day threw: ' + e.message); }
    const audit = Sim.state().lastAudit;
    const inv = Sim.inventory();
    const settledIds = [...new Set(pending.map(s => s.res))];
    const gain = settledIds.reduce((n, id) => n + ((inv[id] || 0) - (invBefore[id] || 0)), 0);
    /* `seam` is false only for the last shape, which has no `fill` at all and
       no real partner — it CANNOT reach the transport by construction, so it is
       held to requested === 0 rather than to requested > 0. */
    drive.push({ label, seam: !!fill, wins, node, args, requested: rep ? rep.requested : -1,
                 real: rep ? rep.real : -1, calls, credited: rep ? rep.credited : -1,
                 queued: pending.reduce((n, s) => n + s.units, 0),
                 drained: Trade.pendingSettlements().length, gain: +gain.toFixed(3) });
    if (threw) shapeBad.push(label + ' THREW ' + threw);
    /* The success shape is EXEMPT from "credits nothing" and from "queues
       nothing" — crediting is the entire point of it — and is held to the
       stricter arithmetic below instead. It is still held to the audit and to
       keeping its partners, like everything else. */
    else if (!wins && rep && rep.credited) shapeBad.push(label + ' credited ' + rep.credited);
    else if (!wins && pending.length) shapeBad.push(label + ' queued ' + pending.length);
    else if (!partners) shapeBad.push(label + ' left the city with NO partners');
    else if (!audit || !audit.ok) shapeBad.push(label + ' broke the audit');
  }
  console.log('\n  🧨 DEGRADE — did each shape actually REACH the transport?\n');
  console.log('    real  requested  RPC calls  units asked  credited  queued  landed   shape');
  for (const d of drive) {
    console.log('    ' + String(d.real).padStart(4) + String(d.requested).padStart(11) +
                String(d.calls).padStart(11) +
                String(d.args.map(a => a.units).join('+') || '—').padStart(13) +
                String(d.credited).padStart(10) + String(d.queued).padStart(8) +
                String(d.gain).padStart(8) + '   ' + d.label);
  }
  console.log('');
  const failShapes = drive.filter(d => !d.wins);
  chk('all ' + failShapes.length + ' transport failure shapes credit nothing, keep partners ' +
      'and leave the audit clean', shapeBad.length === 0, shapeBad.slice(0, 4).join(' | '));

  /* ── THE SUCCESS SHAPE, HELD TO ARITHMETIC ────────────────────────────────
     Four independent claims, because each one fails to a different mutation:
       · the transport was handed the PLANNED quantity — not the want, not the
         whole offer, not a doubled figure;
       · tradeSync() credited exactly Σ floor(asked × 0.4), the server's answer
         summed over the calls it actually made — a client that credited its own
         request would report Σ asked = the double ship, and one that credited
         nothing would report 0;
       · that quantity is sitting in the settlement queue before the day runs;
       · and one Sim.advance later the queue is empty and the goods are IN the
         city. A LOWER BOUND and not an equality here on purpose: the ids are
         this node's strategic gaps, which firms may consume inside the very day
         the delivery lands, and a partner's `sells` can move the same id again
         through the local matching pass — so the exact figure is not knowable
         from here even though it happens to come out equal today. §5 asserts
         the exact quantity, on a fixture isolated so nothing else can move. */
  const win = drive.find(d => d.wins);
  const rows = realRows(win.node);
  const expectAsked = rows.flatMap(r => r.offers).map(o => Math.min(WANT, o.units)).sort((a, b) => a - b);
  const sawAsked = win.args.map(a => a.units).slice().sort((a, b) => a - b);
  const expectCredit = win.args.reduce((n, a) => n + Math.floor(a.units * PARTIAL), 0);
  console.log('    ↳ success shape: asked ' + JSON.stringify(sawAsked) + ', plan expected ' +
              JSON.stringify(expectAsked) + ', credited ' + win.credited + ' of ' + expectCredit +
              ' expected, queued ' + win.queued + ', landed ' + win.gain + '\n');
  chk('the RPC was handed the PLANNED units on every line (' + JSON.stringify(sawAsked) + ') — ' +
      'not the want (' + WANT + ' each) and not the whole offer',
      expectAsked.length > 0 && JSON.stringify(sawAsked) === JSON.stringify(expectAsked),
      'expected ' + JSON.stringify(expectAsked));
  chk('a PARTIAL fill credits exactly Σ floor(asked × ' + PARTIAL + ') = ' + expectCredit +
      ' — the server\'s answer, summed over the calls it really made, never the request (Σ ' +
      sawAsked.reduce((a, b) => a + b, 0) + ')',
      expectCredit > 0 && win.credited === expectCredit, 'credited ' + win.credited);
  chk('…and those ' + win.queued + ' units were QUEUED for the economic day rather than booked ' +
      'between ticks (which is how firms.js once minted 721,771 🔥 with a clean audit)',
      win.queued === expectCredit, 'queued ' + win.queued);
  chk('…and one Sim.advance later the queue is drained and the goods are actually IN the city ' +
      '(+' + win.gain + ' units of the settled ids)',
      win.drained === 0 && win.gain > 0, 'drained-left ' + win.drained + ', gain ' + win.gain);
  /* 🔴 THE ANTI-VACUITY GATE FOR §3, the same rubber-stamp guard §6 carries.
     Everything above this line passes just as happily against a city that never
     planned a fill — which is exactly what §3 did before this line existed. */
  const seamShapes = drive.filter(d => d.seam);
  const vacuous = seamShapes.filter(d => !(d.requested > 0) || !(d.calls > 0));
  chk('…and every one of those ' + seamShapes.length + ' shapes ACTUALLY REACHED THE ' +
      'TRANSPORT (' + seamShapes.reduce((n, d) => n + d.calls, 0) + ' RPC calls over ' +
      seamShapes.reduce((n, d) => n + d.requested, 0) + ' planned lines) — without this ' +
      '§3 asserts ten failure modes against an RPC it never calls',
      seamShapes.length === SHAPES.length - 1 && vacuous.length === 0,
      JSON.stringify(vacuous));
  const noSeam = drive.filter(d => !d.seam);
  chk('…and the one shape with no `fill` on the bridge plans nothing rather than ' +
      'silently succeeding', noSeam.length === 1 && noSeam[0].requested === 0 && noSeam[0].calls === 0,
      JSON.stringify(noSeam));

  /* And with no bridge AT ALL — the shipping configuration until sql/038 runs. */
  mountFresh('offline-city');
  delete global.window.MythicCityBridge.cityTrade;
  let offlineRep = null, offlineThrew = '';
  try { offlineRep = await E.tradeSync(); } catch (e) { offlineThrew = e.message; }
  for (let d = 0; d < 30; d++) Sim.advance(DAY, HOST);
  chk('with NO trade seam on the bridge the city boots, degrades and keeps trading ' +
      'against simulated partners (' + Trade.state().partners.length + ' of them)',
      !offlineThrew && offlineRep && offlineRep.degraded &&
      Trade.state().partners.length > 0 && Trade.state().partners.every(p => p.simulated),
      offlineThrew || JSON.stringify(offlineRep));

  // ── §4 REAL PARTNERS ARE REAL, AND STAY REAL ─────────────────────────────
  mountFresh('mixed-city');
  Trade.setPartners(Trade.simulatedPartners('mixed-city', 3));   // as sim.js seeds them
  global.window.MythicCityBridge.cityTrade = mkNet(async () => null);
  await E.tradeSync();
  const mixed = Trade.state().partners;
  const real = mixed.filter(p => !p.simulated), fake = mixed.filter(p => p.simulated);
  chk('discovery adds the 2 real cities alongside the fabricated ones (' +
      real.length + ' real, ' + fake.length + ' simulated)',
      real.length === 2 && fake.length === 3, JSON.stringify(mixed.map(p => [p.name, p.simulated])));
  chk('p.simulated is exactly FALSE on the real ones and exactly TRUE on the fabricated ' +
      'ones — not undefined, which is what refreshPartners() would read as "leave it alone" ' +
      'by accident rather than on purpose',
      real.every(p => p.simulated === false) && fake.every(p => p.simulated === true),
      JSON.stringify(mixed.map(p => p.simulated)));

  /* Now run a day and prove refreshPartner() rewrote the fabricated inventories
     and did NOT touch the real ones. The simulated partner is drained to zero
     first so "it was refilled" is a visible event and not a coincidence. */
  const realBefore = JSON.stringify(real.map(p => [p.id, p.sells, p.buys, p.offers]));
  for (const p of fake) { p.sells = {}; p.buys = {}; }
  Sim.advance(DAY, HOST);
  const realAfter = JSON.stringify(Trade.state().partners.filter(p => !p.simulated)
                                      .map(p => [p.id, p.sells, p.buys, p.offers]));
  const refilled = Trade.state().partners.filter(p => p.simulated)
                      .every(p => Object.keys(p.sells).length > 0 || Object.keys(p.buys).length > 0);
  chk('a whole economic day later the REAL partners still hold the inventory the ' +
      'network gave them — refreshPartners() did not overwrite them with fabricated numbers',
      realBefore === realAfter, 'before ' + realBefore.slice(0, 160) + ' … after ' + realAfter.slice(0, 160));
  chk('…while the SIMULATED partners were refilled, so the refresh really did run',
      refilled, 'simulated partners came back empty');

  // ── §5 END TO END: A FILL BECOMES GOODS, AND ONLY `filled` OF THEM ───────
  /* Isolated on purpose: the only partner is a real city with EMPTY sells and
     buys, so the local matching pass can neither import nor export and every
     unit that moves this day came out of the settlement queue. */
  const e2e = [];
  for (const [asked, filled] of [[100, 40], [100, 100], [100, 0], [60, 25]]) {
    mountFresh('e2e-' + asked + '-' + filled);
    Trade.setPartners([{ id: 'city-A', name: 'Farvale', nodeId: 'node-A', specs: [],
                         sells: {}, buys: {}, offers: [], simulated: false }]);
    const invBefore = { ...Sim.inventory() }, treBefore = Sim.state().treasury;
    const req = { offerId: 'off-X', res: 'steel', units: asked, unitPrice: 12,
                  partnerId: 'city-A', partnerName: 'Farvale' };
    const r = settle(req, { filled, remaining: 0, unit_price: 12 });
    Sim.advance(DAY, HOST);
    const got = (Sim.inventory().steel || 0) - (invBefore.steel || 0);
    const paid = treBefore - Sim.state().treasury;
    const want = Math.min(filled, asked);
    e2e.push({ asked, filled, credited: r.credited, landed: +got.toFixed(3), want,
               paid: Math.round(paid), audit: !!(Sim.state().lastAudit || {}).ok });
  }
  console.log('\n  🤝 SETTLEMENT, END TO END — asked / server filled / units landed\n');
  console.log('    asked  filled  credited   landed  expected   audit');
  for (const r of e2e) {
    console.log('    ' + String(r.asked).padStart(5) + String(r.filled).padStart(8) +
                String(r.credited).padStart(10) + String(r.landed).padStart(9) +
                String(r.want).padStart(10) + (r.audit ? '      ok' : '    FAIL'));
  }
  console.log('');
  /* 🔴 AN EQUALITY, NOT A CEILING. This read `landed > want + 1e-6` — "never
     MORE than the server filled" — which is only the half of the rule that
     catches the double ship. A settlement that delivered NOTHING at all passed
     it just as happily: drop the drain, or queue the goods and never book them,
     and every cell lands 0 ≤ want and the round stays green. The fixture is
     isolated precisely so that the exact number is knowable (the only partner
     is a real city with empty sells and buys, so nothing else can move steel),
     so there is no excuse for asserting less than the exact number. */
  const e2eBad = e2e.filter(r => Math.abs(r.landed - r.want) > 1e-6 || r.credited !== r.want || !r.audit);
  chk('the units that actually LAND in the city are EXACTLY what the server filled — ' +
      'no more (the double ship) and no fewer (a settlement that quietly delivers ' +
      'nothing) — on every cell, and the audit stays clean through settlement',
      e2eBad.length === 0, JSON.stringify(e2eBad));
  const zero = e2e.find(r => r.filled === 0);
  chk('filled: 0 lands NOTHING and moves no Cinder (the last-40-units race: both ' +
      'buyers must not be told 40)',
      zero && zero.landed === 0 && zero.credited === 0, JSON.stringify(zero));

  // ── §6 RULE 1: A TRADE MOVES VALUE, IT DOES NOT MINT ─────────────────────
  /* 240 consecutive days with settlement live on most of them. The audit is
     re-checked every single day rather than at the end, because a mint on day 3
     that is spent by day 240 leaves no trace in the closing balance. */
  mountFresh('rule1-city');
  Trade.setPartners(realRows('rule1-city'));
  let auditBad = '', days = 0, minted = 0, filledTotal = 0, planned = 0;
  for (let d = 0; d < 240; d++) {
    if (d % 3 !== 2) {
      wantGaps('rule1-city', 120);
      const plan = Trade.planFills(Sim.state().treasury, Sim.state().day);
      planned += plan.length;
      for (const req of plan) {
        // The server fills a random-but-deterministic PART of every request.
        const part = Math.max(0, Math.floor(req.units * ((d % 5) / 4)));
        const r = settle(req, { filled: part, remaining: 0, unit_price: req.unitPrice });
        filledTotal += r.credited;
      }
    }
    Sim.advance(DAY, HOST);
    days++;
    const a = Sim.state().lastAudit;
    if (!a || !a.ok) { auditBad = 'day ' + d + ' ' + JSON.stringify(a); break; }
    if (a.err > a.tol) minted++;
  }
  chk('Rule 1 — the closed-loop audit is clean on all ' + days + ' days with real ' +
      'settlement running (' + Math.round(filledTotal) + ' units filled)',
      auditBad === '' && minted === 0, auditBad || (minted + ' days minted'));
  chk('…and payouts were never suspended, which is what a failed audit does',
      Sim.state().payoutAllowed === true, 'payoutAllowed is false');
  /* 🔴 THE ANTI-VACUITY GATE. Everything above this line would pass just as
     happily against a city that never traded at all — which is exactly how the
     first draft of this round passed while planning nothing. If settlement
     stops happening, this round must go RED rather than quietly become a
     rubber stamp. */
  chk('…and settlement ACTUALLY RAN over those days (' + planned + ' fills planned, ' +
      Math.round(filledTotal) + ' units credited) — without this the round above is a rubber stamp',
      planned > 0 && filledTotal > 0, planned + ' planned / ' + filledTotal + ' credited');

  // ── §7 THE PLAN NEVER OUTRUNS THE CASH OR THE OFFER ──────────────────────
  mountFresh('plan-city');
  Trade.setPartners(realRows('plan-city'));
  Sim.advance(DAY, HOST);
  wantGaps('plan-city', 500);
  const plan = Trade.planFills(Sim.state().treasury, Sim.state().day);
  const offerUnits = {};
  for (const row of realRows('plan-city')) for (const o of row.offers) offerUnits[o.offerId] = o.units;
  const planBad = plan.filter(p => !(p.units > 0) || p.units > offerUnits[p.offerId] ||
                                   !isFinite(p.unitPrice) || p.unitPrice <= 0);
  chk('every planned fill is positive, finite, priced, and within the offer it targets (' +
      plan.length + ' lines)', plan.length > 0 && planBad.length === 0,
      plan.length ? JSON.stringify(planBad.slice(0, 3)) : 'the plan was EMPTY — this check would pass vacuously');
  /* A plan is capped by the cash on hand, and that has to be true against a
     REAL budget rather than the 250,000 🔥 the fixture hands the city. */
  const poor = Trade.planFills(1, Sim.state().day);
  chk('a city with 1 🔥 plans nothing it cannot pay for', poor.length === 0, JSON.stringify(poor));
  chk('the plan never exceeds the open-trade-line bound (ECON.trade.maxOpenOffers = ' +
      ECON.trade.maxOpenOffers + ')', plan.length <= ECON.trade.maxOpenOffers, 'planned ' + plan.length);

  // ── §8 A HOSTILE ROW CANNOT PRICE THE CITY OUT OR GIVE IT FREE GOODS ─────
  const hostile = [0, -5, 1e12, NaN, Infinity, 'free', null];
  const band = hostile.map(q => Trade.fillPrice('steel', q));
  const local = (await import(PP + 'prices.js')).priceOf('steel');
  const lo = local * (1 - ECON.trade.spreadPct), hi = local * (1 + ECON.trade.spreadPct) * ECON.trade.specPriority;
  chk('a counterparty-controlled unit_price is clamped into this city\'s own spread ' +
      '(' + lo.toFixed(2) + '–' + hi.toFixed(2) + ' 🔥) — 0 would be free goods forever ' +
      'and 1e12 would empty the treasury in a day',
      band.every(p => isFinite(p) && p >= lo - 1e-9 && p <= hi + 1e-9), JSON.stringify(band));

  if (fails) { bad++; console.log('\n=== ROUND 0n: ' + fails + ' FAILED ==='); }
  else console.log('\n=== ROUND 0n: ALL PASS ===');
}

for (const f of ['gauntlet1.mjs', 'gauntlet2.mjs', 'gauntlet3.mjs']) {
  console.log('\n########## ' + f + ' ##########');
  const r = spawnSync(process.execPath, [join(here, f)], { stdio: 'inherit' });
  if (r.status !== 0) bad++;
}
console.log(bad ? '\n❌ ECONOMY GAUNTLET: ' + bad + ' round(s) failed' : '\n✅ ECONOMY GAUNTLET: all rounds passed');
process.exit(bad ? 1 : 0);
