/* ══════════════════════════════════════════════════════════════════════════
   🪦 MORTALITY — the numbers, and where each one comes from.

   🔴 THIS FILE WRITES DOWN ALMOST NOTHING, AND THAT IS THE POINT.
   Mortality is not a new model. The deaths already happen: /src/demographics
   pipeline.js runs a LIFE COURSE (step 3b) in which working households age
   into `retired` and retired ones reach a terminal stage at
   `ECON.demographics.lifecycle.retiredLeavePerDay`. Until this round that
   number was added to `S.flow.out` — the same bucket as "the rent went up" —
   so a city could not tell a funeral from a removal van.

   So the RATE is not invented here. It is read, two ways, and the two are the
   same model asked at two resolutions:

     EXACT      /src/demographics report().deathsTotal — a monotone count of
                people who have reached the terminal stage since load. The
                module DIFFERENCES it, so nothing is assumed about cadence and
                nothing is double-counted when a tick is short or long.
     SMOOTH     report().flow.died — the last WHOLE economic day, in people per
                day. This is the coverage DENOMINATOR (see demandPerMin), and a
                day-average is the only honest thing to divide a service rate
                by. A per-tick figure as a denominator is the −1,167/day bug
                pipeline.js's `acc` block already paid for.

   And when /src/demographics is not mounted at all there is still a city with
   people in it, so there is a third read — CRUDE — derived from the clock
   /src/lifepath already derives, with no new constant:

       life expectancy = LIFE.retireAge + 1 / (retiredLeavePerDay × daysPerYear)
       one citizen-year = daysPerYear × dayMin real minutes
       crude rate       = 1 / (lifeExpectancy × realMinutesPerYear) per person
                          per real minute

   ⚠ REJECTED: a `deathsPerPopPerMin` constant in this file. It would be a
     FOURTH opinion about how long a life is, it would silently disagree with
     the lifepath panel's own "life expectancy ≈ 80 years" the first time
     anybody retuned ECON, and it would look completely correct in review.
     clockOf() is the derivation /src/lifepath already ships and already
     prints its inputs for; reusing it means there is one answer.

   ⚠ WHAT IS NOT HERE: plots. A graveyard's capacity lives on its BUILDINGS
     row (`plots: n`, per level), never in a list inside this module. node-city
     has corrected that exact mistake three times — a module-side table of
     building ids is a table that goes stale the moment somebody adds a row.
   ══════════════════════════════════════════════════════════════════════════ */

import { clockOf } from '../lifepath/tuning.js';

export const V = 1;

export const MORT = {
  /* Cadence. Deaths are RARE — roughly one per 100 real minutes in a city of
     400 — so this is an observation interval, not a simulation step, exactly
     as /src/progression's ticker is. Every read it makes is idempotent and
     differenced, so a missed tick costs nothing and a slow one costs nothing. */
  tickMs: 4000,

  /* 🔒 THE CLAMP, AND WHY A BACKGROUNDED TAB NEEDS ONE. setInterval in a
     hidden tab is throttled to ~1/s at best and can stall for minutes; the
     elapsed real time between two ticks is therefore unbounded. The EXACT
     path is immune (it differences a counter that only advances when the
     economy ticks, which is also throttled), but the CRUDE fallback multiplies
     elapsed minutes by a rate, and an unclamped one would bury a tenth of the
     city on the frame the player came back. Nothing offline is claimed at all
     — see index.js, and note that node-city's own offlineCatchUp() runs real
     economy ticks, so the exact path picks the absence up properly anyway. */
  maxStepMin: 2,

  /* Where the roster's own deaths come from. The named roster is a VIEW of at
     most CIT.MAX people over a city of hundreds, so it dies at the city's rate
     SCALED BY ITS SHARE — `deaths × roster ÷ population`, accumulated as a
     debt and spent one whole person at a time. That is a sample of the same
     deaths, never a second source of them; see index.js `rosterDebt`.
     ⚠ The debt is capped so a population collapse (cityPop falling by half in
       a minute) cannot empty the roster in one tick. citEnsure() already trims
       the roster when the citizenry shrinks and that path is not a death. */
  rosterMaxPerTick: 1,

  /* Reported as "the dead are waiting" once the backlog reaches this many
     whole people. Below it the shortfall is a coverage number and nothing
     more — one unburied person in a city of 600 is not a civic emergency and
     a feed that says it is teaches the player to ignore the feed. */
  backlogNotice: 3,
};

/* THE CLOCK, cached. clockOf() walks ECON and derives a year; it is cheap but
   it is called from a per-tile hot path's neighbourhood, and its inputs cannot
   change inside a session. `ok:false` is a real answer and is passed through
   rather than replaced with a guess. */
let _clk = null;
export function clock(hostDayMin) {
  if (_clk) return _clk;
  let c = null;
  try { c = clockOf(hostDayMin); } catch (e) { c = { ok: false, why: 'clockOf threw: ' + (e && e.message) }; }
  _clk = c || { ok: false, why: 'clockOf returned nothing' };
  return _clk;
}
export function resetClock() { _clk = null; }

/* Deaths per PERSON per real minute, derived. Returns null — never a number —
   when the clock could not be derived, so a caller has to decide what to do
   about it rather than being handed a plausible zero. */
export function crudeRatePerMin(hostDayMin) {
  const c = clock(hostDayMin);
  if (!c || !c.ok) return null;
  const yearsMin = (c.secPerYear || 0) / 60;
  const le = c.lifeExpectancy || 0;
  if (!(yearsMin > 0) || !(le > 0)) return null;
  return 1 / (le * yearsMin);
}

export default { V, MORT, clock, resetClock, crudeRatePerMin };
