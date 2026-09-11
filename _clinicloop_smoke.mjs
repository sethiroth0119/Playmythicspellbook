/* 🏥 THE CLINIC ATE ITS OWN LUNCH — and three honesty lines.

   Reported: "the Clinic is both DRAWING on remedies and PRODUCING remedies...
   at a HIGHER rate than it is producing them... it's eating its own lunch."
   Preparing AND dispensing in one building is the design (the row's desc says
   so) and the draw is deliberately not scaled by city conditions while the
   output is. So below ~67% conditions the shelf empties — and THEN svcDraw's
   raw fallback drew medicine at 2× from the ledger: the same medicine the
   Clinic's own `use` needs to make the next remedies.

   MEASURED, not read (§2 below, one Clinic at 50% conditions):
     · with a Med Lab feeding 0.20/min, the old fallback burned 0.263
       medicine/min against a recipe of 0.140 — 1.9× — and pinned the city's
       medicine at ONE unit for the whole slump (the ledger read truncates to
       whole units and stops at the last one). It bought 95% coverage, which
       is why the conditions problem underneath was invisible.
     · with no Med Lab it ran the larder to zero in 73 minutes and the gen
       gate halted the Clinic; without the raid that takes 143.

   THE RULE NOW: a service building never raids an ingredient its own recipe
   needs. A short shelf serves less (svcFed < 1, already printed — 75% at 50%
   conditions) and the larder is the producer's alone. Every other fallback
   (a Restaurant with no rations drawing raw food) is byte-for-byte what it was.

   Also pinned: the shelf note names the resource's real maker instead of
   "A Cannery" under a Clinic; the Job Fair says how many of its seats the
   roster can actually fill; the node licence dialog states the six-in-any-mix
   rule that made a second Supply PRN look like a bug.

   Run: node _clinicloop_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const NC = readFileSync('./public/node-city/index.html', 'utf8');
const SRC = readFileSync('./public/index.html', 'utf8');

/* ── 1. lift svcDraw and drive it ────────────────────────────────────────── */
const si = NC.indexOf('const svcDraw = (res, want, def) => {');
ok(si > 0, 'svcDraw takes the building definition');
const se = NC.indexOf('    return Math.min(1, got / want);\n  };', si);
ok(se > si, 'svcDraw ends where expected');
const NEW = NC.slice(si, se + '    return Math.min(1, got / want);\n  };'.length);
const GUARD = 'if (raw && def && def.use && def.use[raw]) return Math.min(1, got / want);';
ok(NEW.includes(GUARD), 'the guard: a building never raids an ingredient its own recipe uses');
const OLD = NEW.replace(GUARD, '');   // the shipped behaviour before this build

function mk(text) {
  const ctx = {
    game: { stock: {}, res: { medicine: 0, food: 0, supplies: 0 } },
    STOCK_RAW_FALLBACK: { rations: 'food', remedies: 'medicine', goods: 'supplies' },
    RAW_FOOD_SUBSISTENCE: 0.45, RAW_FALLBACK_MULT: 2, rawDraw: {}, Math, Number,
  };
  ctx.stockOf = (r) => ctx.game.stock[r] || 0;
  vm.createContext(ctx);
  vm.runInContext(text + '\nthis.svcDraw = svcDraw;', ctx);
  return ctx;
}
const CLINIC = { gen: { remedies: 0.45 }, use: { medicine: 0.28, water: 0.24 }, svc: { input: 'remedies', rate: 0.30 } };
const RESTAURANT = { svc: { input: 'rations', rate: 0.30 } };

{
  const c = mk(NEW);
  c.game.res.medicine = 100;
  const got = c.svcDraw('remedies', 0.30, CLINIC);
  ok(got === 0 && !c.rawDraw.medicine, 'Clinic, empty shelf: serves 0 and draws NO raw medicine');
  c.game.stock.remedies = 0.15;
  const half = c.svcDraw('remedies', 0.30, CLINIC);
  ok(Math.abs(half - 0.5) < 1e-9 && c.game.stock.remedies === 0, 'Clinic, half a shelf: serves half and empties the shelf, still no raid');
  c.game.stock.remedies = 1;
  ok(c.svcDraw('remedies', 0.30, CLINIC) === 1 && Math.abs(c.game.stock.remedies - 0.7) < 1e-9, 'Clinic, stocked: serves fully from its own shelf');
}
{
  const c = mk(NEW), o = mk(OLD);
  c.game.res.food = 100; o.game.res.food = 100;
  const a = c.svcDraw('rations', 1, RESTAURANT), b = o.svcDraw('rations', 1, RESTAURANT);
  ok(Math.abs(a - 0.45) < 1e-9 && a === b && c.rawDraw.food === o.rawDraw.food && c.rawDraw.food === 0.9,
    'Restaurant, empty shelf: the raw-food fallback is exactly what it was (45% served, 2× charged)');
}

/* ── 2. THE LUNCH, MEASURED. One Clinic at 50% conditions, 300 minutes, with
      and without a Med Lab (0.40 × 0.5 = 0.20 medicine/min into the ledger).
      Tick order is the city's: the gen gate reads the ledger as it stands,
      production spends and shelves, the service draws, the raw draw is
      charged, and the Med Lab's deposit lands at the end of the tick. ────── */
function run(text, lab) {
  const c = mk(text);
  const om = 0.5;                       // city conditions: output scaled, draw not
  c.game.res.medicine = 20;             // the larder at the start
  let used = 0, feds = 0, halted = 0, minMed = Infinity;
  for (let m = 0; m < 300; m++) {
    c.rawDraw = {};
    let u = 0;
    if (c.game.res.medicine > 0) {      // the gen gate: no input, no output
      u = 0.28 * om;
      c.game.res.medicine -= u;
      c.game.stock.remedies = (c.game.stock.remedies || 0) + 0.45 * om;
    } else halted++;
    const fed = c.svcDraw('remedies', 0.30, CLINIC);
    const raid = c.rawDraw.medicine || 0;
    c.game.res.medicine = Math.max(0, c.game.res.medicine - raid);
    used += u + raid;
    c.game.res.medicine += lab;
    feds += fed;
    minMed = Math.min(minMed, c.game.res.medicine);
  }
  return { usedPerMin: used / 300, fed: feds / 300, halted, medicine: c.game.res.medicine, minMed };
}
{
  const before = run(OLD, 0.20), after = run(NEW, 0.20);
  ok(before.usedPerMin > 0.25 && before.minMed < 1.2 && before.medicine < 1.2,
    'BEFORE, with a Med Lab: the Clinic burned ~1.9× its recipe in medicine and pinned the larder at one unit', JSON.stringify(before));
  ok(Math.abs(after.usedPerMin - 0.14) < 1e-6 && after.medicine > 30 && after.halted === 0 && Math.abs(after.fed - 0.75) < 0.02,
    'AFTER, with a Med Lab: it draws only its recipe, the larder grows, and it serves 0.225/0.30 = 75% — the honest figure for 50% conditions', JSON.stringify(after));
  ok(before.fed > after.fed, 'the old fallback DID buy more coverage — that is what hid the conditions problem, and the test says so rather than pretending otherwise');
  const b0 = run(OLD, 0), a0 = run(NEW, 0);
  ok(b0.halted > a0.halted && a0.halted > 0 && b0.halted - a0.halted > 50,
    'with NO Med Lab both eventually halt, and the raid halted the Clinic ~70 minutes sooner', JSON.stringify({ before: b0.halted, after: a0.halted }));
  ok(a0.fed > b0.fed, '…so the honest version keeps the city covered longer from the same larder');
}

/* ── 3. the shelf note ───────────────────────────────────────────────────── */
{
  ok(!/A Cannery is what makes the refined path cheap/.test(NC), 'the "A Cannery" line no longer sits under every empty shelf');
  ok(/Dispensing only what it prepares/.test(NC) && /that would starve its own production/.test(NC), 'a self-supplying service gets its own note');
  ok(/_chainMakers\(s\.input\)/.test(NC) && /is what makes the refined path cheap/.test(NC), 'every other empty shelf names the real maker');
}

/* ── 4. the Job Fair says what it can fill ───────────────────────────────── */
{
  ok(/seats exist across the city, but at most/.test(NC) && /citCap\(\), seats = t\.openPositions \+ t\.employed/.test(NC), 'the Job Fair states the roster ceiling against the seats');
  ok(/unfilled seats, not a hiring fault/.test(NC), '…and says what the gap is');
  ok(/if \(!\(seats > canName\)\) return '';/.test(NC), '…only when the seats exceed what the city can name');
}

/* ── 5. the node rule is on the dialog ───────────────────────────────────── */
{
  ok(/nodes per corporation, in any mix — a second node of the same type is allowed/.test(SRC), 'the licence dialog states six-in-any-mix');
  ok(/const NODE_MAX_PER_CORP\s+= 6;/.test(SRC), 'the cap itself is untouched');
}

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
