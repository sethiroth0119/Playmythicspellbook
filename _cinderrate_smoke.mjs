/* 💱 THE CINDER RATE CHIP FLICKED BETWEEN TWO NUMBERS (v121v77).

   Reported: "In the City Builder, in the Treasury indicator, the amount of
   cinder being generated keeps flicking between two numbers… it flicks between
   the real number and a tiny one."

   BOTH NUMBERS WERE REAL, which is why it survived. economyTick runs once a
   REAL SECOND (dtMin ≈ 0.0167). Rent and building output are continuous and
   contribute the same figure every tick. Patronage is not — a citizen shops
   when their own need clock fires — so most ticks take nothing and the
   occasional tick takes a lump. The old line booked that lump as an
   INSTANTANEOUS rate (credited / dtMin ≈ credited × 60) and contributed nothing
   on the ticks in between, because it sat inside `if (credited > 0)`. The chip
   therefore alternated at 1 Hz between "rent + a 60× spike" and "rent alone".

   THE FIX IS IN TWO HALVES AND THIS SUITE PINS BOTH, because the obvious first
   answer was measured and rejected. A DECAYING average removes the 60× spike
   but a stochastic income still RIPPLES in proportion to (gap between lumps)/tau
   — a city taking one lump a minute still swung 21.8 → 18.5 at tau=5min, which
   on a chip printed to ONE DECIMAL is still a number changing every second, and
   that is the entire complaint. So the average is taken over WHOLE CLOSED
   MINUTES (_patronRatePerMin), which is piecewise constant by construction
   rather than merely damped, and _chipRate decides when the READOUT has moved
   enough to be worth repainting.

   Both of those failures were found by this suite before they shipped, which is
   why the rejected designs are named here rather than quietly forgotten.

   THE ASSERTION THAT MATTERS IS THE RENDERED STRING, not the internal number —
   the complaint was about pixels changing, so that is what is measured here.

   The money is untouched: `game.frac.cinder += P.credited` is the accrual and
   this change does not go near it. That is pinned too, because a "fix" that
   quietly changed what the city earns would be far worse than the flicker.

   Run: node _cinderrate_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const NC = readFileSync('./public/node-city/index.html', 'utf8');

/* Brace-matched lift, async-aware — the naive indexOf('function name(') form
   drops a leading `async` and dies at parse time with zero FAIL lines, which
   _checkall reports as CRASH rather than a readable failure. */
function fnText(name) {
  const i = NC.search(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\('));
  if (i < 0) throw new Error('cannot find ' + name);
  let d = 0;
  for (let k = NC.indexOf('{', i); k < NC.length; k++) {
    if (NC[k] === '{') d++;
    else if (NC[k] === '}') { d--; if (!d) return NC.slice(i, k + 1); }
  }
  throw new Error('unbalanced ' + name);
}

/* The REAL pipeline: the average, the display latch, and the exact expression
   updateHUD() renders — lifted rather than restated, so a change to either half
   moves this suite. */
function world() {
  const win = /const PATRON_RATE_WINDOW_MIN = \d+;/.exec(NC);
  if (!win) throw new Error('PATRON_RATE_WINDOW_MIN missing');
  const ctx = { console, Math, Number };
  vm.createContext(ctx);
  vm.runInContext(
    win[0] + '\nlet _patronBuckets = [];\nlet _patronCurCred = 0;\nlet _patronCurMin = 0;\n' +
    fnText('_patronRatePerMin') + '\nconst _chipShown = {};\n' + fnText('_chipRate') +
    /* the chip's own text, copied from updateHUD's one expression */
    "\nfunction chipText(v){ return Math.abs(v) >= 0.05 ? (v > 0 ? '+' : '') + v.toFixed(1) : ''; }", ctx);
  return {
    /* one economy tick + one HUD repaint, returning what the player would read */
    tick(credited, dtMin, rentPerMin) {
      const rate = vm.runInContext('_patronRatePerMin(' + credited + ',' + dtMin + ')', ctx);
      const total = rate + (rentPerMin || 0);
      const shown = vm.runInContext('_chipRate("cinder",' + total + ')', ctx);
      return { rate, shown, text: vm.runInContext('chipText(' + shown + ')', ctx) };
    },
    raw: (c, d) => vm.runInContext('_patronRatePerMin(' + c + ',' + d + ')', ctx),
  };
}

const DT = 1 / 60;   // one real second — the live economyTick beat

/* ── 1. THE DEFECT, REPRODUCED, so the diagnosis is evidence and not a story ── */
{
  /* A city taking 3 🔥 every 10th tick: a true average of 18 🔥/min. */
  const old = [];
  for (let t = 0; t < 60; t++) old.push(t % 10 === 0 ? 3 / DT : 0);
  const hi = Math.max(...old), lo = Math.min(...old);
  ok(hi === 180 && lo === 0, 'the OLD instantaneous form printed 180/min then 0/min on a city truly making 18', hi + ' / ' + lo);
  ok(hi / 18 === 10, 'so the "real number" the player saw was itself 10x too high', String(hi / 18));
}

/* ── 2. the average converges on the TRUE figure ── */
{
  const w = world();
  let v = 0;
  for (let t = 0; t < 6000; t++) v = w.raw(t % 10 === 0 ? 3 : 0, DT);
  ok(Math.abs(v - 18) < 1, 'a city taking 3 🔥 every 10th tick averages ~18/min, the real figure', v.toFixed(3));
}
{
  const w = world();
  let v = 0;
  for (let t = 0; t < 6000; t++) v = w.raw(t % 37 === 0 ? 11.1 : 0, DT);
  ok(Math.abs(v - 18) < 1.5, 'and so does a much lumpier city on the same true average', v.toFixed(3));
}

/* ── 3. THE REPORTED SYMPTOM: the rendered text must stop changing ── */
{
  const w = world();
  for (let t = 0; t < 3000; t++) w.tick(t % 10 === 0 ? 3 : 0, DT, 2);   // warm up
  const seen = new Set();
  for (let t = 0; t < 900; t++) seen.add(w.tick(t % 10 === 0 ? 3 : 0, DT, 2).text);   // 15 min of play
  ok(seen.size === 1, 'over 15 minutes of a settled city the chip prints ONE string and never repaints',
    seen.size + ' distinct: ' + [...seen].join(' '));
  ok([...seen][0] !== '', 'and it is a real figure, not blank', [...seen][0]);
}
{
  /* The pathological case: one big lump, rarely. Even here it must not flick. */
  const w = world();
  for (let t = 0; t < 6000; t++) w.tick(t % 60 === 0 ? 18 : 0, DT, 2);
  const seen = new Set();
  for (let t = 0; t < 900; t++) seen.add(w.tick(t % 60 === 0 ? 18 : 0, DT, 2).text);
  ok(seen.size === 1, 'and a city taking one big lump a minute is steady too', seen.size + ': ' + [...seen].join(' '));
}

/* ── 4. it still MOVES when the city's income really changes ── */
{
  const w = world();
  for (let t = 0; t < 3000; t++) w.tick(t % 10 === 0 ? 3 : 0, DT, 2);
  const before = w.tick(0, DT, 2).text;
  let after = before;
  for (let t = 0; t < 120; t++) after = w.tick(t % 10 === 0 ? 6 : 0, DT, 2).text;   // a shop opens
  ok(after !== before, 'a doubled income changes the readout within two minutes — the latch is not deafness',
    before + ' → ' + after);
  let v = 0;
  for (let t = 0; t < 6000; t++) v = w.raw(t % 10 === 0 ? 6 : 0, DT);
  ok(Math.abs(v - 36) < 1.5, 'and the average settles on the new true figure', v.toFixed(3));
}
{
  const w = world();
  for (let t = 0; t < 3000; t++) w.tick(t % 10 === 0 ? 3 : 0, DT, 2);
  let last = null;
  for (let t = 0; t < 6000; t++) last = w.tick(0, DT, 0);            // everything shuts down
  ok(last.text === '', 'a city that stops earning ends up blank rather than holding a stale figure',
    JSON.stringify(last.text) + ' rate=' + last.rate.toFixed(4));
}

/* ── 5. degenerate inputs cannot produce a number at all ── */
{
  ok(world().raw(0, 0) === 0, 'a zero-length tick reads 0 rather than dividing by zero');
  ok(Number.isFinite(world().raw(5, 0)), 'a credit on a zero-length tick stays finite');
  ok(world().raw(-5, DT) === 0, 'a negative credit cannot pull the readout below zero');
  ok(Number.isFinite(world().raw(3, -1)), 'a negative dt is clamped rather than inverting the decay');
  const w = world();
  ok(w.tick(0, DT, 0).text === '', 'a city with no income at all prints nothing, as it always did');
}

/* ── 6. THE MONEY IS UNTOUCHED, and the wiring is where it must be ── */
ok(/game\.frac\.cinder = \(game\.frac\.cinder \|\| 0\) \+ P\.credited;/.test(NC),
  'the ACCRUAL is unchanged — the city earns exactly what it earned before');
ok(!/prodPerMin\.cinder = \(prodPerMin\.cinder \|\| 0\) \+ P\.credited \/ Math\.max\(1e-9, dtMin\);/.test(NC),
  'and the instantaneous-rate line that caused this is gone');
{
  /* The contribution must sit OUTSIDE `if (P && P.credited > 0)`, or the average
     only decays on ticks that took money — the original bug wearing a moving
     average, and it would still read high. */
  const i = NC.indexOf('if (P && P.credited > 0) {');
  const j = NC.indexOf('_patronRatePerMin(P ? P.credited : 0, dtMin)');
  ok(i > 0 && j > i, 'the smoothed contribution is present, after the credit branch');
  const branch = NC.slice(i, NC.indexOf('\n        }', i));
  ok(branch.indexOf('_patronRatePerMin') < 0,
    'and OUTSIDE it — a tick where nobody shopped is evidence too, and dropping it is the original bug');
}
ok(/const dc = _chipRate\('cinder', prodPerMin\.cinder \|\| 0\)/.test(NC), 'the cinder chip renders through the latch');
ok(/const d = _chipRate\(r, prodPerMin\[r\] \|\| 0\)/.test(NC), 'and so do the resource chips');
ok(!/game\.[A-Za-z_$]*[Pp]atronRate|game\.[A-Za-z_$]*chipShown/.test(NC),
  'neither the average nor the latch hangs off `game` — nothing was added to the save');
ok(/^let _patronBuckets = \[\];/m.test(NC) && /^const _chipShown = \{\};/m.test(NC),
  'both live in module scope, runtime-only');
ok(/⚠ RUNTIME ONLY, NEVER SAVED/.test(NC) && /THIS IS A DISPLAY LATCH, NOT A FILTER ON THE DATA/.test(NC),
  'and both reasons are written where the next reader will look');

console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
