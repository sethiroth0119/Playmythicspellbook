#!/usr/bin/env node
/* 🤝 CITY TRADE PLANNING — the gate on the part that moves player property.
   ---------------------------------------------------------------------------
   Run:  node tools/mp-tests/citytrade.mjs   (or via tools/mp-tests/run.mjs)

   /src/citytrade/plan.js decides two things a bug in which costs players real
   goods: WHICH cycles of a standing deal are due, and HOW MUCH of a shipment
   comes out of each of the three stores (city, vault, Bank of Ethos).

   The two failure modes worth naming, because both have happened in this
   codebase in other forms:
     · DOUBLE SHIPPING — a cycle settling twice. The server's
       `unique (agreement_id, cycle_index)` is the real lock, but only if the
       index is a pure function of the clock. The moment it becomes a counter
       that "advances on settle", two clients offline for different lengths of
       time disagree about which cycle is which and the constraint guards
       nothing.
     · PART DELIVERY — shipping 40 of 100 because that is all there was.
       /src/trading/settle.js exists because a silent partial once destroyed
       215 units of a player's resources; its rule is that the preflight
       refuses before a single unit moves. planDraw follows it: short means
       ZERO, never a partial plan.
*/
import { dueCycles, cycleDueAt, planDraw, outcomeOf, shortfallMessages, MAX_CATCHUP }
  from '../../public/src/citytrade/plan.js';

const results = [];
const check = (name, cond, detail) => results.push({ name, ok: !!cond, detail: cond ? '' : detail });
const H = 3600 * 1000;
const T0 = 1_700_000_000_000;          // fixed epoch — Date.now() is never called here

// ── 1. CYCLES ARE A FUNCTION OF THE CLOCK ─────────────────────────────────
{
  // 12h cycle, 2 days => 4 cycles. Nothing due before the first period elapses.
  const atStart = dueCycles(T0, 12, 2, T0, []);
  check('nothing is due at the moment of acceptance', atStart.due.length === 0,
    'due ' + JSON.stringify(atStart.due));
  check('a 2-day deal at 12h has 4 cycles', atStart.total === 4, 'total ' + atStart.total);

  const justBefore = dueCycles(T0, 12, 2, T0 + 12 * H - 1, []);
  check('cycle 0 is not due one ms early', justBefore.due.length === 0, 'due ' + JSON.stringify(justBefore.due));

  const justAfter = dueCycles(T0, 12, 2, T0 + 12 * H, []);
  check('cycle 0 fires exactly on the period', justAfter.due.join() === '0', 'due ' + JSON.stringify(justAfter.due));

  const twoLate = dueCycles(T0, 12, 2, T0 + 25 * H, []);
  check('being late produces every missed cycle', twoLate.due.join() === '0,1', 'due ' + JSON.stringify(twoLate.due));
}
// The contract length is a hard ceiling — a deal left running for a month must
// not keep firing after its last day.
{
  const wayLate = dueCycles(T0, 12, 2, T0 + 40 * 24 * H, []);
  check('cycles stop at the contract length', wayLate.due.length === 4, 'due ' + JSON.stringify(wayLate.due));
  check('an over-run contract reports expired', wayLate.expired === true, 'expired ' + wayLate.expired);
}
// Already-settled cycles are skipped — this is what makes a second client's
// sweep a no-op rather than a re-ship.
{
  /* At +50h with a 12h period, cycles 0..3 have fired (4 whole periods). With 0
     and 2 already recorded the sweep must offer exactly 1 and 3.
     ⚠ This first read +40h and expected '1,3', which was the TEST being wrong,
       not the code: at +40h only three periods have elapsed, so cycle 3 is not
       due yet and '1' was the right answer. Worth leaving noted — an
       off-by-one in the expectation here looks exactly like an off-by-one in
       the cycle maths, and the wrong one is easy to "fix". */
  const some = dueCycles(T0, 12, 5, T0 + 50 * H, [0, 2]);
  check('settled cycles are not re-offered', some.due.join() === '1,3', 'due ' + JSON.stringify(some.due));
  const notYet = dueCycles(T0, 12, 5, T0 + 40 * H, [0, 2]);
  check('a cycle that has not come round yet is not offered', notYet.due.join() === '1',
    'due ' + JSON.stringify(notYet.due));
}
// The catch-up bound.
{
  const huge = dueCycles(T0, 1, 90, T0 + 500 * H, []);
  check('catch-up is bounded', huge.due.length === MAX_CATCHUP, 'got ' + huge.due.length);
  check('the bound takes the OLDEST cycles first', huge.due[0] === 0, 'first ' + huge.due[0]);
}
// Hostile input must not produce work.
{
  for (const [n, a] of [['NaN start', [NaN, 12, 2, T0, []]], ['zero cycleHours', [T0, 0, 2, T0 + 99 * H, []]],
                        ['negative days', [T0, 12, -3, T0 + 99 * H, []]], ['NaN now', [T0, 12, 2, NaN, []]]]) {
    check('hostile input yields no cycles: ' + n, dueCycles(...a).due.length === 0, 'produced work');
  }
}
{
  check('cycleDueAt stamps the period end, not now',
    cycleDueAt(T0, 12, 0) === T0 + 12 * H && cycleDueAt(T0, 12, 3) === T0 + 48 * H, 'wrong due stamp');
}

// ── 2. THE DRAW ORDER ─────────────────────────────────────────────────────
{
  const r = planDraw(100, { city: 250, vault: 90, boe: 500 });
  check('a covering city takes the whole load', r.ok && r.plan.city === 100 && r.plan.vault === 0 && r.plan.boe === 0,
    JSON.stringify(r.plan));
}
{
  const r = planDraw(100, { city: 40, vault: 30, boe: 500 });
  check('it spills city -> vault -> boe in order',
    r.ok && r.plan.city === 40 && r.plan.vault === 30 && r.plan.boe === 30, JSON.stringify(r.plan));
  check('the plan sums to exactly what is owed', r.total === 100, 'total ' + r.total);
}
{
  const r = planDraw(100, { city: 0, vault: 0, boe: 100 });
  check('the bank alone can cover a shipment', r.ok && r.plan.boe === 100, JSON.stringify(r.plan));
}
// 🔴 THE PART-DELIVERY REFUSAL — the property-losing shape.
{
  const r = planDraw(100, { city: 40, vault: 30, boe: 20 });
  check('short means a ZERO plan, never a partial', !r.ok && r.total === 0
    && r.plan.city === 0 && r.plan.vault === 0 && r.plan.boe === 0, JSON.stringify(r));
  check('short reports how far short', r.shortBy === 10, 'shortBy ' + r.shortBy);
}
{
  const r = planDraw(100, { city: 99.999, vault: 0, boe: 0 });
  check('one unit short is still short', !r.ok && r.total === 0, JSON.stringify(r));
}
// A zero leg is legitimate (a one-way supply deal) and must not be "short".
{
  const r = planDraw(0, { city: 0, vault: 0, boe: 0 });
  check('a zero-unit leg succeeds with an empty plan', r.ok && r.total === 0 && r.shortBy === 0, JSON.stringify(r));
}
// Hostile stores must not manufacture cargo.
{
  const r = planDraw(50, { city: -100, vault: NaN, boe: undefined });
  check('negative / NaN / missing stores cannot fund a shipment', !r.ok && r.total === 0, JSON.stringify(r));
  const r2 = planDraw(50, null);
  check('a missing store object is short, not a crash', !r2.ok && r2.total === 0, JSON.stringify(r2));
}

// ── 3. OUTCOME + THE TWO MESSAGES ─────────────────────────────────────────
{
  check('outcome names which side failed',
    outcomeOf(true, true) === 'settled' && outcomeOf(false, false) === 'short_both'
    && outcomeOf(true, false) === 'short_partner' && outcomeOf(false, true) === 'short_proposer',
    'outcome mapping wrong');
}
{
  const m = shortfallMessages({ resourceName: 'Metal', partnerName: 'Sethiroth', shortBy: 40 });
  check('the defaulter is told what they owe and where to look',
    /40/.test(m.debtor) && /Metal/.test(m.debtor) && /Bank of Ethos/.test(m.debtor), m.debtor);
  check('the partner is told WHO and WHAT, and to reach out',
    /Sethiroth/.test(m.creditor) && /Metal/.test(m.creditor) && /reach out/i.test(m.creditor), m.creditor);
  check('neither message is a bare failure', !/^(trade failed|error)/i.test(m.debtor), m.debtor);
}

// ── Report ────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r.ok);
console.log('\n🤝 CITY TRADE PLANNING — ' + results.length + ' properties\n');
for (const r of results) console.log('  ' + (r.ok ? '✅' : '❌') + ' ' + r.name + (r.ok ? '' : '  → ' + r.detail));
if (failed.length) {
  console.log('\n  ' + failed.length + ' failed.\n');
  process.exit(1);
}
console.log('\n  ✅ cycles derive from the clock, and short never part-delivers.\n');
process.exit(0);
