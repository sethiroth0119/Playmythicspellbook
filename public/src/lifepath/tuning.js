/* ════════════════════════════════════════════════════════════════════════════
   🕰 LIFEPATH TUNING — and, much more importantly, THE CLOCK.
   ----------------------------------------------------------------------------
   Two rows on the citizen dossier have said UNAVAILABLE since it shipped:

       Age        the roster has no age and never had one.
       Job level  this city keeps no rank for a person.

   Filling them in is trivial and would be fiction. What this file does instead
   is answer the ONE question that has to be answered first, and answer it out
   of numbers the game already computes:

       🔴 HOW LONG IS A YEAR IN THIS CITY?

   ── THE DERIVATION, AND IT IS NOT A CHOICE ─────────────────────────────────
   ECON.demographics.lifecycle.agePerDay is a LIVE RATE the move-in pipeline
   runs every economic day: the share of working households that age out of the
   labour force and become pensioners. Its own comment in tuning.js states the
   arithmetic behind it:

       "At ~24 economic days to the year, agePerDay 0.0008 ≈ a 52-year working
        life and retiredLeavePerDay 0.004 ≈ 10 years of retirement."

   So the economy ALREADY knows how long a year is — it just never wrote the
   number down, because nothing needed it. This file runs that same arithmetic
   backwards:

       mean working life, in economic days = 1 / agePerDay              = 1250
       working life, in years              = retireAge − workAge        =   52
       ⇒ economic days per year            = 1 / (agePerDay × 52)       ≈ 24.04

   which lands on ECON's own "~24". That is the point: the two files agree BY
   CONSTRUCTION rather than by coincidence, and retuning agePerDay moves the
   citizens' ages with it instead of leaving a stale copy behind. This is the
   `_opEcon()` rule applied to a number nobody had written down yet.

   Everything else falls out of the same table:

       young adult ends   workAge + rungs / (graduatePerDay × daysPerYear)
                          — a young adult is somebody who has not yet had time
                            to climb the whole education ladder. 3 rungs at
                            83 economic days each ≈ 10.4 years, so 18 → 28.4.
       senior begins      retireAge — because the `retired` archetype is
                          workers: 0 and ages: { senior: 1 }. A senior IS
                          somebody out of the labour force; that is not a
                          convention, it is what the archetype table says.
       life expectancy    retireAge + 1 / (retiredLeavePerDay × daysPerYear)
                          ≈ 70 + 10.4 = 80.4, which is ECON's own "≈ 10 years
                          of retirement" read as an age instead of a duration.
       one career grade   1 / (graduatePerDay × daysPerYear) ≈ 3.47 years —
                          the game's ONLY rate for a person moving up a rung,
                          reused rather than duplicated. See model.js.

   ── ⚠ AND HERE IS THE HONEST PART, WHICH IS NOT FLATTERING ─────────────────
   ECON.clock.dayMin = 20, so one economic day is 20 REAL MINUTES. Therefore:

       one citizen-year ≈ 24.04 × 20 min = 481 real minutes ≈ 8 HOURS OF PLAY.

   A player will watch a citizen's age tick over about once per eight-hour
   session-equivalent, and a career grade — 3.47 years — takes roughly 28 hours,
   which is exactly the figure ECON's own graduatePerDay comment quotes for a
   student cohort turning over ("≈ 28 real hours of play"). So this is NOT a
   number that moves while you watch, and the module does not pretend it is.
   What DOES move inside a session is the other half of the career: the grade is
   capped by the employer's own level, and a firm levelling up promotes its
   people the moment it does.

   ⚠ REJECTED: picking a faster year (a year per city day, say) because it would
     read better on the panel. That is the whole class of thing this codebase
     keeps tearing back out — a number chosen because it feels nice, with the
     model quietly bent around it. If eight hours a year is wrong, the fix is to
     retune agePerDay, and then the pensioner supply moves too, which is correct:
     they are the same fact about the same city.
   ⚠ REJECTED: a second copy of dayMin / agePerDay in this file for use when the
     economy has not mounted. A shadow copy of an economy number is exactly what
     ECON exists to prevent. With no tuning table readable this module answers
     "unavailable" and the two rows stay as they were.

   ── WHAT IS ACTUALLY WRITTEN DOWN HERE ─────────────────────────────────────
   Two numbers, and neither is an economy number: `workAge` and `retireAge`.
   The economy has no concept of a year at all, so it cannot own them. They are
   the boundaries of the labour force, they are the ONLY inputs to the whole
   derivation above that are not read live out of ECON, and they are here rather
   than inline for the same reason ECON exists — one place to change, no copies.
   ════════════════════════════════════════════════════════════════════════════ */

import { ECON } from '../economy/tuning.js';

export const V = 1;

export const LIFE = {
  /* The two ends of a working life, in years. See the header: these are not
     economy numbers and ECON cannot hold them, because the economy has no
     years. Changing either one changes how long a year is — that is the
     derivation working, not a bug. */
  workAge: 18,
  retireAge: 70,

  /* A floor under the sampled age inside a band, so a "young adult" drawn at
     the very bottom of their band is 18 and never 17.999 printed as 17. */
  round: 1,
};

/* ── the live tuning reads ────────────────────────────────────────────────
   ECON is imported statically, exactly as /src/demographics/archetypes.js and
   /src/economy/firms.js import it. That is a READ of the economy's table, not a
   copy of it, and it is the established way to reach ECON from a module here.
   `dayMin` can also come from the host (node-city's CITY_DAY_MIN, handed over
   in mount's ctx) — the two are independently declared and both happen to be
   20, so the module prefers the ECONOMY's day: agePerDay is denominated per
   ECONOMIC day, and if the two ever diverge the economic one is the right
   denominator for it. */
function num(v) { const n = Number(v); return isFinite(n) ? n : NaN; }

/* THE WHOLE CLOCK, as one object, with every input named so the panel can print
   where each half of it came from. Returns ok:false rather than a fallback when
   any input is missing or nonsensical — a lifepath with a made-up year in it is
   worse than no lifepath. */
export function clockOf(hostDayMin) {
  const out = { ok: false, why: null, src: {} };
  let D = null, C = null;
  try { D = ECON && ECON.demographics; } catch (e) { D = null; }
  try { C = ECON && ECON.clock; } catch (e) { C = null; }
  if (!D || !D.lifecycle || !D.education) {
    out.why = 'ECON.demographics is not readable, so there is no rate to derive a year from';
    return out;
  }

  const agePerDay = num(D.lifecycle.agePerDay);
  const gradPerDay = num(D.education.graduatePerDay);
  const retLeave = num(D.lifecycle.retiredLeavePerDay);
  const rungs = Array.isArray(D.education.order) ? D.education.order.length - 1 : NaN;
  const dayMin = num(C && C.dayMin) > 0 ? num(C.dayMin) : num(hostDayMin);
  const workLife = LIFE.retireAge - LIFE.workAge;

  if (!(agePerDay > 0) || !(gradPerDay > 0) || !(retLeave > 0) || !(rungs > 0) ||
      !(dayMin > 0) || !(workLife > 0)) {
    out.why = 'one of the rates a year is derived from is missing or zero ' +
      '(agePerDay=' + agePerDay + ', graduatePerDay=' + gradPerDay +
      ', retiredLeavePerDay=' + retLeave + ', eduRungs=' + rungs + ', dayMin=' + dayMin + ')';
    return out;
  }

  const daysPerYear = 1 / (agePerDay * workLife);
  const secPerDay = dayMin * 60;
  const secPerYear = daysPerYear * secPerDay;
  const youngYears = rungs / (gradPerDay * daysPerYear);
  const gradeYears = 1 / (gradPerDay * daysPerYear);
  const retirementYears = 1 / (retLeave * daysPerYear);

  const childTo = LIFE.workAge;
  const youngTo = LIFE.workAge + youngYears;
  const adultTo = LIFE.retireAge;
  const seniorTo = LIFE.retireAge + retirementYears;

  /* The band table is keyed on ECON.demographics.ages' OWN ids, in ECON's own
     order — so a fifth age group added there is a missing entry here rather
     than a silently mislabelled one. */
  const bands = {
    child:  [0, childTo],
    young:  [childTo, youngTo],
    adult:  [youngTo, adultTo],
    senior: [adultTo, seniorTo],
  };
  for (const g in (D.ages || {})) {
    if (!bands[g]) { out.why = 'ECON.demographics.ages has a group this module has no year range for: ' + g; return out; }
  }
  if (!(youngTo > childTo) || !(adultTo > youngTo) || !(seniorTo > adultTo)) {
    out.why = 'the derived age bands do not increase — check workAge/retireAge against graduatePerDay';
    return out;
  }

  out.ok = true;
  out.daysPerYear = daysPerYear;
  out.secPerDay = secPerDay;
  out.secPerYear = secPerYear;
  out.dayMin = dayMin;
  out.hoursPerYear = secPerYear / 3600;      // REAL hours of play per citizen-year
  out.workAge = LIFE.workAge;
  out.retireAge = LIFE.retireAge;
  out.workingLifeYears = workLife;
  out.youngYears = youngYears;
  out.gradeYears = gradeYears;
  out.retirementYears = retirementYears;
  out.lifeExpectancy = seniorTo;
  out.bands = bands;
  /* Every input, named, so a row's source line can quote the derivation rather
     than assert it — the same discipline /src/citizen/facts.js keeps. */
  out.src = {
    agePerDay, graduatePerDay: gradPerDay, retiredLeavePerDay: retLeave,
    eduRungs: rungs, dayMin, dayMinFrom: (num(C && C.dayMin) > 0 ? 'ECON.clock.dayMin' : 'host CITY_DAY_MIN'),
  };
  return out;
}

/* The band an age in years falls in, on the derived table. Ages past life
   expectancy are still `senior` — the table's top is a MEAN, not a wall, and a
   citizen who outlives it is not a fault. */
export function bandOfYears(clk, years) {
  if (!clk || !clk.ok || !isFinite(years)) return null;
  const b = clk.bands;
  for (const g in b) if (years >= b[g][0] && years < b[g][1]) return g;
  return years >= b.senior[0] ? 'senior' : 'child';
}

/* The label and icon for a band — ECON's own words, never a second set. */
export function bandLabel(g) {
  try {
    const d = ECON.demographics.ages[g];
    return d ? { label: d.label, ico: d.ico } : { label: g, ico: '👤' };
  } catch (e) { return { label: String(g), ico: '👤' }; }
}
