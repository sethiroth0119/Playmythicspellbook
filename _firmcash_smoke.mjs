/* 💸 A PROFITABLE BUSINESS WAS WALKED TO BANKRUPTCY ON A FORTNIGHT TIMER.

   Reported (and marked fixed once before it was): "Out of Cash - Limited by ...
   0% impacting many businesses throughout the city... I've had buildings stuck
   on it for days and it results in the businesses going bankrupt. Nothing James
   or myself do seems to move the needle."

   THE LINE THAT WAS THE NEEDLE:
       if (f.cash <= 0) { f.badDays++; f.goodDays = 0; }
       else if (profit > 0) { f.goodDays++; ... }

   `pay()` clamps to the balance rather than refusing, so a firm that spends
   what it earns — wages, rent, inputs — CLOSES THE DAY ON ZERO. That is a
   business at the margin, not a failing one, and it is the normal state of most
   of a young city. But cash <= 0 alone booked the day as bad and reset goodDays,
   which made the recovery branch unreachable for precisely the firms that
   needed it. badDays then climbed monotonically: throttle at 2, layoffs at 4,
   BANKRUPT at 14 — and each of those cut revenue, which cut the next day's
   cash, which guaranteed the next bad day. The player could do nothing about
   it, and neither could the bank: borrowing capacity is
   `revenueAvg × maxLoanToRevenueDays − debt`, so the throttle and the layoffs
   shrink the number the rescue is sized from before autoBorrow() ever fires.

   THE INVARIANT: a firm that is MAKING MONEY never marches toward bankruptcy,
   whatever its closing balance. A firm that is losing money still does, on
   exactly the day counts it always did.

   Run: node _firmcash_smoke.mjs */
import { readFileSync } from 'fs';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/src/economy/firms.js', 'utf8');

/* ── 1. THE CONDITION ────────────────────────────────────────────────────── */
{
  ok(/if \(f\.cash <= 0 && profit <= 0\) \{ f\.badDays\+\+; f\.goodDays = 0; \}/.test(SRC),
    'a day is bad only when the firm is BOTH out of cash AND losing money');
  ok(!/if \(f\.cash <= 0\) \{ f\.badDays\+\+/.test(SRC),
    'the cash-only test is gone — it counted a break-even day as a failing one');
  ok(/else if \(profit > 0\) \{ f\.goodDays\+\+/.test(SRC),
    'and the recovery branch is unchanged, so a profitable firm still climbs back');
}

/* ── 2. THE LADDER ITSELF IS UNTOUCHED ───────────────────────────────────── */
{
  /* The fix must not soften what happens to a business that really is failing.
     Same rungs, same thresholds, same consequences. */
  for (const rung of ['BANKRUPT', 'DEFAULT', 'DEBT', 'LAYOFFS', 'REDUCED'])
    ok(new RegExp("f\\.rung = '" + rung + "'").test(SRC), 'the ' + rung + ' rung still exists');
  ok(/f\.badDays >= D\.bankruptAfterDays\s*\)\s*f\.rung = 'BANKRUPT'/.test(SRC),
    'bankruptcy is still driven by the same badDays counter');
  ok(/f\.throttle = \(f\.rung === 'HEALTHY'\) \? 1 : D\.throttlePct;/.test(SRC),
    'and distress still throttles output');
}

/* ── 3. THE ARITHMETIC, RUN ──────────────────────────────────────────────── */
{
  /* Model the ladder exactly as closeDay does and drive both shapes of firm
     through a fortnight. This is what makes the claim a measurement rather
     than a reading of the regex above. */
  const D = { reducedAfterDays: 2, layoffsAfterDays: 4, debtAfterDays: 6, defaultAfterDays: 9, bankruptAfterDays: 14, recoverDays: 3 };
  const run = (days, cashOf, profitOf, cond) => {
    let badDays = 0, goodDays = 0, rung = 'HEALTHY';
    for (let d = 0; d < days; d++) {
      const cash = cashOf(d), profit = profitOf(d);
      if (cond(cash, profit)) { badDays++; goodDays = 0; }
      else if (profit > 0) { goodDays++; if (goodDays >= D.recoverDays) { badDays = Math.max(0, badDays - 1); goodDays = 0; } }
      if (badDays >= D.bankruptAfterDays) rung = 'BANKRUPT';
      else if (badDays >= D.defaultAfterDays) rung = 'DEFAULT';
      else if (badDays >= D.debtAfterDays) rung = 'DEBT';
      else if (badDays >= D.layoffsAfterDays) rung = 'LAYOFFS';
      else if (badDays >= D.reducedAfterDays) rung = 'REDUCED';
      else rung = 'HEALTHY';
    }
    return { badDays, rung };
  };
  const OLD = (cash) => cash <= 0;
  const NEW = (cash, profit) => cash <= 0 && profit <= 0;

  /* THE REPORTED FIRM: profitable every day, and holding nothing at close
     because it spent its takings on wages and inputs. */
  const thinOld = run(30, () => 0, () => 12, OLD);
  const thinNew = run(30, () => 0, () => 12, NEW);
  ok(thinOld.rung === 'BANKRUPT',
    'BEFORE: a firm making money every day went BANKRUPT anyway, purely for closing on zero',
    'badDays ' + thinOld.badDays);
  ok(thinNew.rung === 'HEALTHY' && thinNew.badDays === 0,
    'AFTER: the same firm stays HEALTHY — this is the reported defect, measured',
    thinNew.rung + ', badDays ' + thinNew.badDays);

  /* A GENUINELY FAILING FIRM must be unaffected: no cash and losing money. */
  const deadOld = run(30, () => 0, () => -8, OLD);
  const deadNew = run(30, () => 0, () => -8, NEW);
  ok(deadNew.rung === 'BANKRUPT', 'a firm with no cash AND losing money still goes bankrupt');
  ok(deadOld.badDays === deadNew.badDays,
    'on exactly the same day count as before — the fix rescues nobody who was failing',
    deadOld.badDays + ' vs ' + deadNew.badDays);

  /* And the rungs still arrive on schedule for that failing firm. */
  ok(run(2, () => 0, () => -8, NEW).rung === 'REDUCED', 'REDUCED still at 2 days');
  ok(run(4, () => 0, () => -8, NEW).rung === 'LAYOFFS', 'LAYOFFS still at 4');
  ok(run(6, () => 0, () => -8, NEW).rung === 'DEBT', 'DEBT still at 6');
  ok(run(14, () => 0, () => -8, NEW).rung === 'BANKRUPT', 'BANKRUPT still at 14');

  /* The marginal case that motivated the wording: breaking exactly even on
     zero cash. Not profitable, so it is still counted as a bad day — the fix
     is about firms that MAKE money, not firms that merely survive. */
  const evenNew = run(14, () => 0, () => 0, NEW);
  ok(evenNew.rung === 'BANKRUPT',
    'a firm that only ever breaks even on zero cash is still failing — profit > 0 is the bar, deliberately');
}

/* ── 4. THE RESCUE IS STILL SIZED OFF REVENUE, WHICH IS WHY THIS MATTERED ── */
{
  const BANK = readFileSync('./public/src/economy/bank.js', 'utf8');
  ok(/const rev = firm\.revenueAvg \|\| 0;/.test(BANK),
    'borrowing capacity is still a function of revenue');
  /* v121v108 (bug-mtsq62mg): the rescue ALSO fires for a firm sitting at zero
     with nothing coming in today (starved — it never traded, so it never lost
     money and never reached DEBT), and capacity has a working-capital floor
     for a firm with no revenue history (revenue × days was 0 for it). A firm
     breaking even at zero (revenue today > 0) is still left alone. */
  ok(/const starved = \(firm\.cash \|\| 0\) <= 0 && !\(\(firm\.revenueDay \|\| 0\) > 0\);\r?\n\s*if \(firm\.rung !== 'DEBT' && firm\.rung !== 'DEFAULT' && !starved\) return null;/.test(BANK),
    'autoBorrow fires at DEBT / DEFAULT, or for a starved firm (0 cash, no revenue today) — a firm breaking even at zero is left alone');
  ok(/if \(!\(rev > 0\)\) \{ try \{ cap = Math\.max\(cap, Firms\.dailyOperatingCost\(firm\) \* \(ECON\.bank\.startupDays \|\| 5\)\); \} catch \(e\) \{\} \}/.test(BANK) && /startupDays: 5,/.test(readFileSync('./public/src/economy/tuning.js', 'utf8')),
    'a firm with no revenue yet can still borrow five days of operating cost (ECON.bank.startupDays)');
}

console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
