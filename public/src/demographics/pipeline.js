/* ════════════════════════════════════════════════════════════════════════════
   🚚 THE MOVE-IN PIPELINE — people arrive because something attracted them.
   ----------------------------------------------------------------------------
   🔴 A PIPELINE THAT ONLY EVER ADDS IS A POPULATION COUNTER, NOT A SIMULATION.
   Every tick this asks three questions of every household type a zone draws:

     · is there a HOME of the kind they want, and is one free?
     · can they PAY the rent on it out of what their education can earn?
     · is there WORK they are qualified to do?

   A "no" to any of them is a household that does not arrive. And the same three
   questions are asked of the people already here: a household whose rent has
   outrun its income, or whose band of work has dried up for longer than its
   savings last, LEAVES. That is why zoning a city badly costs population rather
   than just capping it.

   ── 🔴 NOT ONE CINDER MOVES IN THIS FILE ────────────────────────────────────
   The rent below is an affordability INDEX (ECON.demographics.rent), used to
   compare an income against a home. The only rent that debits a household is
   `HH.chargeRent()` inside sim.js's audited day. ECONOMY.md documents four
   money leaks found during development and every one of them looked correct in
   review; the way this feature avoids being the fifth is by never touching a
   balance at all. Its whole output is HEADCOUNT and COMPOSITION.

   ── STATE SHAPE ─────────────────────────────────────────────────────────────
   Households are held as COHORTS — `zone|archetype|education` → a household
   count — at most six zones × five archetypes × four educations. Six numbers
   per household object × 4,000 households would be 4,000 objects a tick to
   produce a table with 120 cells in it; households.js makes the same call for
   the same reason and says so.
   ════════════════════════════════════════════════════════════════════════════ */

import { ECON } from '../economy/tuning.js';
import * as A from './archetypes.js';
import * as Z from './zones.js';

const D = () => ECON.demographics;
const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

const S = {
  v: 1,
  co: {},                  // "zone|arch|edu" -> households (float)
  stress: {},              // education -> consecutive economic days of a dead labour market
  flow: { in: 0, out: 0, grad: 0, evicted: 0 },   // THIS step, whatever length it was
  /* 📅 …AND THE LAST WHOLE ECONOMIC DAY, WHICH IS THE ONLY ONE A PANEL CAN
     HONESTLY PRINT AS A RATE. `rate` was an EMA of `flow / days`, and a tick is
     a quarter of a day: one structural move (a de-zoning, or the city's own
     citizenry collapsing) divided by 0.25 came out as −1,167 residents/day on
     screen in a city of 249 people. A rate is a measurement over a period, so
     this accumulates until a whole day has passed and then reports it. */
  acc: { in: 0, out: 0, grad: 0, evicted: 0, days: 0 },
  day: { in: 0, out: 0, grad: 0, evicted: 0 },
  rate: { in: 0, out: 0 },
  rentIndex: 1,
  attract: 0,
  causes: [],
  limit: null,
  seeded: false,
  /* The wealth mix of the most recent arrivals. ⚠ DECLARED HERE AND CLEARED BY
     reset(), never created on first use: households.js `lastDividend` was born
     inside the function that wrote it, so a cold process and a warm one did not
     have the same SHAPE of state object — and logistics.js shipped exactly that
     assumption being false. Every readout is declared and every readout is
     cleared, so "what does reset() leave behind" is answerable by reading. */
  lastInMix: null,
};

export function state() { return S; }
export function reset() {
  S.co = {};
  S.stress = {};
  for (const e of A.eduOrder()) S.stress[e] = 0;
  S.flow = { in: 0, out: 0, grad: 0, evicted: 0 };
  S.acc = { in: 0, out: 0, grad: 0, evicted: 0, days: 0 };
  S.day = { in: 0, out: 0, grad: 0, evicted: 0 };
  S.rate = { in: 0, out: 0 };
  S.rentIndex = 1; S.attract = 0; S.causes = []; S.limit = null;
  S.seeded = false; S.lastInMix = null;
}
reset();

const key = (z, a, e) => z + '|' + a + '|' + e;
function add(z, a, e, n) {
  if (!(n > 0)) return;
  const k = key(z, a, e);
  S.co[k] = (S.co[k] || 0) + n;
}
function take(k, n) {
  const have = S.co[k] || 0;
  const got = Math.min(have, Math.max(0, n));
  if (got <= 0) return 0;
  S.co[k] = have - got;
  if (S.co[k] < 1e-6) delete S.co[k];
  return got;
}
export function parseKey(k) {
  const p = String(k).split('|');
  return { zone: p[0], arch: p[1], edu: p[2] };
}

/* ── READS ──────────────────────────────────────────────────────────────────
   Every one of these is a sum over the cohorts. There is no second store and no
   cached total: a figure the UI recomputes its own way is a figure that
   eventually lies (terroir.js's rule, and this codebase has paid for it). */
export function households() { let n = 0; for (const k in S.co) n += S.co[k]; return n; }
export function population() {
  let n = 0;
  for (const k in S.co) { const c = parseKey(k); n += S.co[k] * A.avgSize(c.arch); }
  return n;
}
export function occupiedHomes(zoneId) {
  let n = 0;
  for (const k in S.co) { if (!zoneId || parseKey(k).zone === zoneId) n += S.co[k]; }
  return n;
}
export function byWealth() {
  const out = { low: 0, mid: 0, high: 0 };
  for (const k in S.co) {
    const c = parseKey(k), heads = S.co[k] * A.avgSize(c.arch);
    const w = A.wealthWeights(c.arch, c.edu);
    const sum = w.low + w.mid + w.high;
    if (!(sum > 0)) { out.low += heads; continue; }
    out.low += heads * w.low / sum; out.mid += heads * w.mid / sum; out.high += heads * w.high / sum;
  }
  return out;
}
/* Education is a property of the ADULTS in a household — children have not had
   one yet, and counting them as uneducated would make every family district
   look like a failure of schooling. */
export function byEducation() {
  const out = {};
  for (const e of A.eduOrder()) out[e] = 0;
  for (const k in S.co) {
    const c = parseKey(k), a = A.archetype(c.arch);
    if (!a) continue;
    const adults = S.co[k] * A.avgSize(c.arch) * (1 - (a.ages.child || 0));
    out[c.edu] = (out[c.edu] || 0) + adults;
  }
  return out;
}
export function byAge() {
  const out = {};
  for (const k in D().ages) out[k] = 0;
  for (const k in S.co) {
    const c = parseKey(k);
    const ages = A.agesOf(c.arch, A.avgSize(c.arch));
    for (const g in ages) out[g] = (out[g] || 0) + ages[g] * S.co[k];
  }
  return out;
}
export function byArchetype() {
  const out = {};
  for (const k in S.co) { const c = parseKey(k); out[c.arch] = (out[c.arch] || 0) + S.co[k]; }
  return out;
}
export function byZone() {
  const out = {};
  for (const k in S.co) { const c = parseKey(k); out[c.zone] = (out[c.zone] || 0) + S.co[k]; }
  return out;
}
/* Working-age residents per education rung — the raw material of the labour
   ladder households.js consumes. Students count at their part-time weight. */
export function workersByEducation() {
  const out = {};
  for (const e of A.eduOrder()) out[e] = 0;
  for (const k in S.co) {
    const c = parseKey(k);
    out[c.edu] = (out[c.edu] || 0) + S.co[k] * A.workersPer(c.arch);
  }
  return out;
}
/* 🎓 THE LADDER households.js `hire()` reads: how many residents are qualified
   to hold each band's jobs, counting everybody who is qualified for anything
   above it too. Monotonically decreasing by construction. */
export function labourLadder() {
  const w = workersByEducation();
  const out = {};
  for (const band in ECON.labor.bands) {
    let n = 0;
    for (const e of A.eduOrder()) if (A.qualifies(e, band)) n += w[e] || 0;
    out[band] = Math.floor(n);
  }
  return out;
}
/* The wealth mix of the households that arrived most recently — what
   households.js places new residents by. Falls back to the standing mix when
   nobody has moved in yet, so a quiet city still answers. */
export function arrivalTierMix() {
  const src = (S.lastInMix && S.lastInMix.total > 0) ? S.lastInMix : null;
  if (src) return { low: src.low, mid: src.mid, high: src.high };
  const w = byWealth();
  return (w.low + w.mid + w.high > 0) ? w : { low: 1, mid: 0, high: 0 };
}

/* ── 💸 RENT ────────────────────────────────────────────────────────────────
   Per dwelling per economic day, as an index. Priced off the unskilled wage so
   it moves with ECON.labor and cannot drift away from what anybody earns, and
   multiplied by market tightness: a city with no vacancies is an expensive
   city. That is what stops housing being a problem a player solves once. */
export function rentOf(zoneId, tightness) {
  const z = Z.zoneDef(zoneId); if (!z) return 0;
  const base = ECON.labor.bands.unskilled.wage * D().rent.baseDaysOfWage;
  return base * z.rentMul * (tightness == null ? S.rentIndex : tightness);
}
function tightnessFrom(sv) {
  const homes = sv ? sv.totalHomes : 0;
  if (!(homes > 0)) return 1;
  const occ = clamp01(occupiedHomes() / homes);
  return Math.min(D().rent.maxTightness, 1 + D().rent.tightnessK * occ * occ);
}

/* ── 👷 THE LABOUR MARKET, AS A HOUSEHOLD SEES IT ───────────────────────────
   `posts[band]` is how many jobs the city's firms have asked for. A resident's
   chance of work is the share of the city's job-seekers that the posts THEY
   QUALIFY FOR could absorb — so an uneducated resident in a city of research
   labs reads a dead market while a graduate in the same city reads a live one.
   That asymmetry is the entire education→jobs feedback, expressed as one ratio.

   ⚠ NO POSTS AT ALL IS "NO INFORMATION", NOT "NO WORK". A city whose economy
     module never mounted has no vacancy figures, and reading that as
     unemployment would empty the city on a 404. */
export function jobFitByEducation(posts, seekers) {
  const out = {};
  const known = posts && Object.keys(posts).length;
  for (const e of A.eduOrder()) {
    if (!known) { out[e] = 1; continue; }
    let reachable = 0;
    for (const band in ECON.labor.bands) if (A.qualifies(e, band)) reachable += Math.max(0, posts[band] || 0);
    out[e] = seekers > 0 ? clamp01(reachable / seekers) : 1;
  }
  return out;
}

/* ── SEEDING ────────────────────────────────────────────────────────────────
   🔴 AN EXISTING SAVE MUST NOT EMPTY ITSELF AND REFILL. The people were already
   living there; this module is new, not the city. So the first mount with no
   saved cohorts places the city's CURRENT population into the zoning it
   currently has, at each zone's own bag, and the pipeline takes over from
   there. Without this, every lived city would drop to zero residents the day
   this shipped and spend twenty simulated days climbing back. */
export function seed(sv, target) {
  S.co = {};
  const want = Math.max(0, Number(target) || 0);
  if (!sv || !(sv.totalHomes > 0) || want <= 0) { S.seeded = true; return 0; }
  const fill = D().arrival.seedFill;
  let placed = 0;
  for (const zid of Z.zoneIds()) {
    const homes = sv.homes[zid] || 0;
    if (homes <= 0) continue;
    // Each zone takes its share of the city's people, then converts them to
    // households through its own bag — which is what makes a tower district and
    // a suburb of the same capacity hold different numbers of families.
    const share = want * (sv.capacity[zid] / Math.max(1e-9, sv.totalCapacity));
    const z = Z.zoneDef(zid);
    let bagSum = 0; for (const a in z.bag) bagSum += Math.max(0, z.bag[a] || 0);
    if (!(bagSum > 0)) continue;
    for (const a in z.bag) {
      const w = Math.max(0, z.bag[a] || 0) / bagSum;
      if (!(w > 0)) continue;
      const heads = share * w * fill;
      const hh = Math.min(homes * w, heads / Math.max(0.1, A.avgSize(a)));
      if (!(hh > 0)) continue;
      const draw = A.eduDraw(a, z.eduTilt);
      for (const e in draw) {
        if (!(draw[e] > 0)) continue;
        add(zid, a, e, hh * draw[e]);
        placed += hh * draw[e] * A.avgSize(a);
      }
    }
  }
  S.seeded = true;
  return placed;
}
export function seeded() { return S.seeded && households() > 0; }

/* ════════════════════════════════════════════════════════════════════════════
   ⏱ ONE STEP OF THE PIPELINE
   ----------------------------------------------------------------------------
   `days` is economic days (sim.js's clock — a second clock would drift).
   `ctx`  is { survey, budget, posts, seekers, services }:
     · survey   — zones.survey(), the dwellings that exist
     · budget   — the most residents the HOST says this city supports. The city
                  owns its own population; this module decides who they are and
                  how many of them the zoning can actually house. Never exceeded.
     · posts    — jobs the city's firms asked for, per band
     · seekers  — how many people are chasing them
     · services — 0..1, how well the city serves the residents it has
   ════════════════════════════════════════════════════════════════════════════ */
export function step(days, ctx) {
  days = Math.max(0, Math.min(ECON.clock.maxCatchUpDays, Number(days) || 0));
  const sv = ctx && ctx.survey;
  S.flow = { in: 0, out: 0, grad: 0, evicted: 0 };
  if (!sv) { S.causes = [{ sign: '−', label: 'No city to live in', why: 'The city has not reported any land yet.' }]; return S; }

  /* 1. 🧹 EVICTION. The dwellings went away — demolished, re-zoned, or the
        building was never finished. This is not a rate and there is no appeal:
        a household cannot live in a house that is not there. It runs FIRST so
        every ratio below is computed against a legal occupancy. */
  for (const zid of Z.zoneIds()) {
    const homes = sv.homes[zid] || 0;
    const occ = occupiedHomes(zid);
    if (occ <= homes) continue;
    let excess = occ - homes;
    /* ⚠ EVERY FLOW FIGURE IS IN PEOPLE, NOT HOUSEHOLDS. The cohorts are counted
       in households and the panel is labelled "Residents / day", so each `take`
       is multiplied back up by the archetype's size on its way into `flow`.
       Mixing the two units gave a de-zoning that evicted 112 "residents" when
       it had actually displaced 112 households — 180 people. */
    for (const k in S.co) {
      const c = parseKey(k);
      if (c.zone !== zid) continue;
      const share = S.co[k] / Math.max(1e-9, occ);
      const gone = take(k, excess * share);
      S.flow.evicted += gone * A.avgSize(c.arch);
    }
    // Floats do not divide back to the whole; sweep whatever is left.
    excess = occupiedHomes(zid) - homes;
    if (excess > 1e-6) {
      for (const k in S.co) {
        if (excess <= 1e-6) break;
        const c = parseKey(k);
        if (c.zone !== zid) continue;
        const gone = take(k, excess);
        excess -= gone; S.flow.evicted += gone * A.avgSize(c.arch);
      }
    }
  }

  /* 1b. 🏙 …AND THE OTHER WAY THE HOUSING CAN GO AWAY: the CITY stops
        supporting them. node-city's own citizenry falls when its vitals
        collapse, and this module must follow it DOWN as well as up or it
        quietly becomes a second population figure that disagrees with the HUD —
        which is exactly the divergence ECONOMY.md warns about ("two systems
        growing population independently would diverge within minutes and the
        player would see two different numbers for the same city"). MEASURED in
        the gauntlet's 172-tile district: the city's own pop fell 8 → 4 over ten
        economic days while this module sat at 7, because only ARRIVALS were
        capped by the budget. They leave, and they are counted as leaving. */
  {
    const over = population() - Math.max(0, Number(ctx && ctx.budget) || 0);
    if (over > 0.001) {
      const pop = population();
      for (const k of Object.keys(S.co)) {
        const c = parseKey(k);
        const heads = A.avgSize(c.arch);
        const share = (S.co[k] * heads) / Math.max(1e-9, pop);
        const gone = take(k, (over * share) / Math.max(0.1, heads));
        S.flow.out += gone * heads;
      }
    }
  }

  const tight = tightnessFrom(sv);
  S.rentIndex = tight;
  const posts = (ctx && ctx.posts) || null;
  const seekers = Math.max(1, (ctx && ctx.seekers) || 0);
  const fit = jobFitByEducation(posts, seekers);
  const services = clamp01(ctx && ctx.services != null ? ctx.services : 1);
  const budget = Math.max(0, Number(ctx && ctx.budget) || 0);
  const dm = D();

  /* 2. 🧳 DEPARTURES. Two independent reasons, and they are deliberately
        different in kind: rent is a level (you cannot pay it today), work is a
        DURATION (you can ride out a bad month on savings, not a bad season).
        `stress` is the season counter, per education rung, because "there is no
        work for people like me" is exactly what a rung means here. */
  for (const e of A.eduOrder()) {
    if (fit[e] < dm.departure.jobPanic) S.stress[e] = (S.stress[e] || 0) + days;
    else S.stress[e] = 0;
  }
  const causes = [];
  let rentSqueezed = 0, jobless = 0;
  for (const k of Object.keys(S.co)) {
    const c = parseKey(k);
    const rent = rentOf(c.zone, tight);
    const income = A.incomeOf(c.arch, c.edu, fit[c.edu]);
    const burden = income > 0 ? rent / income : 99;
    let leaveRate = 0;
    if (burden > dm.rent.burdenLeave) { leaveRate += dm.departure.ratePerDay; rentSqueezed += S.co[k]; }
    /* 🔴 JOBLESSNESS IS ONLY A REASON TO LEAVE IF YOU HAVE SOMEBODY IN THE
       LABOUR FORCE. This test used to run against EVERY cohort, so a retired
       household — zero workers, unjobbable by definition — was driven out of
       town by a labour market it does not participate in. That is half of the
       all-retired attractor, and it is the half that hides: it looks like the
       model being even-handed.
       ⚠ AND FIXING ONLY THIS MAKES THE BUG WORSE. Pensioners were already the
         only archetype that could still ARRIVE once job fit hit the floor
         (their exemption from `arrival.jobFloor` below, which is correct — they
         do not need a vacancy). Take away their last reason to leave and they
         become immortal as well as unlimited, and the city converges on 100%
         retired FASTER. This line is only safe because ECON.demographics
         .lifecycle now gives that state a door out (retiredLeavePerDay) and
         ECON.demographics.arrival.workerlessDrawPerWorkerHH meters the way in.
         Read that table's header before touching any of the three. */
    if (A.workersPer(c.arch) > 0 && (S.stress[c.edu] || 0) > dm.departure.joblessGraceDays) {
      leaveRate += dm.departure.ratePerDay; jobless += S.co[k];
    }
    if (leaveRate <= 0) continue;
    const gone = take(k, S.co[k] * Math.min(1, leaveRate * days));
    S.flow.out += gone * A.avgSize(c.arch);      // people, see the eviction note
  }

  /* 3. 🎒 GRADUATION. A student household's education is IN PROGRESS, and this
        is where it finishes: the rung goes up and the household stops being a
        student one. It is the reason low-rent housing is not a dead end — it is
        where a city's future skilled labour lives while it is still cheap, and
        a city that zoned none of it has nowhere for that to happen.
        ⚠ They graduate into SINGLE households, which are smaller than the share
          they left, so a graduating cohort is a small net outflow of people as
          well as an upgrade of the ones who stay. Flatmates disperse; some of
          them leave the city. Counted in `grad`, not hidden inside `out`. */
  const order = A.eduOrder();
  for (const k of Object.keys(S.co)) {
    const c = parseKey(k);
    const arch = A.archetype(c.arch);
    if (!arch || !arch.inSchool) continue;
    const i = order.indexOf(c.edu);
    const next = order[Math.min(order.length - 1, i + 1)];
    const moved = take(k, S.co[k] * Math.min(1, dm.education.graduatePerDay * days));
    if (moved <= 0) continue;
    add(c.zone, 'single', next, moved);
    S.flow.grad += moved * A.avgSize(c.arch);    // people, see the eviction note
  }

  /* 3b. 🧬 THE LIFE COURSE — working households age out of the labour force, and
        retired ones eventually end. THIS IS WHERE A CITY'S PENSIONERS COME FROM,
        and it is the structural retirement of the all-retired attractor.

        🔴 WHAT THE ATTRACTOR WAS. `retired` was an ABSORBING STATE: it had two
        inflows (the zone bags, and the arrival job-gate exemption that made it
        the only archetype able to move into a job-poor city) and NO outflow at
        all. Every other archetype churns — students graduate, workers leave when
        the work does — but nothing ever removed a pensioner. Any inflow into a
        state with no outflow converges on 100% of the system, so a job-poor city
        went 20 family / 81 couple / 100 single / 27 retired on day 2 to
        0 / 0 / 0 / 578 on day 5 and stayed there forever, labour ladder 0/0/0/0.
        Zoning dense housing is what MAKES a city job-poor, so the player's
        reward for building a big city was a dead one.

        The fix is a door, not a lid. `retiredLeavePerDay` gives the state an
        outflow, so retired households have a stationary share like every other
        cohort instead of an ever-growing one; `agePerDay` makes their inflow
        DEPEND ON THERE BEING WORKERS, so a city whose labour force has gone
        stops producing pensioners as well as stops attracting them, and the
        attractor cannot form rather than being caught after it forms.
        ⚠ See ECON.demographics.lifecycle for the two fixes that were rejected
          (exempting pensioners from departures too; capping their share) and
          why each of them hides the ratchet instead of removing it. */
  const life = dm.lifecycle || {};
  for (const k of Object.keys(S.co)) {
    const c = parseKey(k);
    const to = (life.ages && life.ages[c.arch]) || null;
    if (!to || !A.archetype(to)) continue;
    const moved = take(k, S.co[k] * Math.min(1, (life.agePerDay || 0) * days));
    if (moved <= 0) continue;
    /* 🔴 NEVER MORE HOUSEHOLDS THAN THE DWELLINGS THEY ALREADY OCCUPY, AND
       NEVER MORE PEOPLE THAN WALKED IN. The archetypes have different mean
       sizes, so a naive 1:1 household swap INVENTS residents in one direction
       (single 1.1 heads → retired 1.5) and a naive head-conserving swap invents
       DWELLINGS in the other (couple 2.2 → retired 1.5 is 1.47 households in one
       flat). This module's contract is that it never adds a resident the host
       did not authorise (index.js `population()`), and the eviction sweep at the
       top of the step is not a place to be discovering overflow you caused
       yourself. The min() holds both invariants in both directions; whichever
       one binds, the people it does not carry across are counted as leaving. */
    const hh = Math.min(moved, moved * A.avgSize(c.arch) / Math.max(0.1, A.avgSize(to)));
    add(c.zone, to, c.edu, hh);
    const lost = moved * A.avgSize(c.arch) - hh * A.avgSize(to);
    if (lost > 0) S.flow.out += lost;            // people, see the eviction note
  }
  /* …and the terminal stage ends. Without this line every other line in this
     block is just a faster road into the same absorbing state. */
  const retLeave = Math.min(1, (life.retiredLeavePerDay || 0) * days);
  if (retLeave > 0) {
    for (const k of Object.keys(S.co)) {
      const c = parseKey(k);
      if (A.workersPer(c.arch) > 0) continue;    // the retired ARE the workerless
      const gone = take(k, S.co[k] * retLeave);
      S.flow.out += gone * A.avgSize(c.arch);
    }
  }

  /* 3c. 🔁 TENANCY TURNOVER — the lease ends, and the flat is re-let.
        🔴 THE SECOND RATCHET, AND IT IS WHY A STUDENT DISTRICT STOPPED BEING
        ONE. Once a zone filled, the ONLY composition change left in it was
        graduation converting student → single IN PLACE. Nothing ever moved out
        of a full dwelling, and new students can only arrive into a vacancy — so
        a low-rent block peaked at 80 student households on day 3 and decayed
        80 → 56 → 39 → 27 → 19 → 13 → 9 while singles climbed to 282. The bag
        says a low-rent block is 47% students; what it produced was 1%. A real
        student district turns over: people graduate and LEAVE, and the room they
        free is taken by another student.

        With turnover, out_i = τ·n_i and in_i = τ·N·bag_i for every archetype, so
        a zone CONVERGES ON ITS OWN BAG instead of ratcheting away from it, and
        students settle at τ/(τ + graduatePerDay) of their bag share. The rates
        are per zone (ECON.demographics.turnover) because churn is a property of
        the housing — a cheap flat turns over most of a year, a detached house
        once a generation.

        ⚠ WORKERLESS HOUSEHOLDS ARE DELIBERATELY EXEMPT. Retirees are the least
          mobile households there are, and — the part that actually bites — their
          way back IN is metered against the working city (see the arrival meter
          below), so churning them out at a zone's rate while letting them back
          in at a demographic one would make turnover a one-way drain on exactly
          the cohort this round is trying to stop mismodelling. Their churn is
          `retiredLeavePerDay` above, which is the honest rate for it.
        ⚠ The freed dwellings are re-let in the SAME step (see `relet` below), so
          this refreshes a district rather than hollowing it out. It still leaves
          a real standing vacancy, which is correct: turnover is where a city's
          vacancy rate comes from. */
  const relets = {};
  for (const zid of Z.zoneIds()) {
    const rate = Math.min(1, Z.turnoverOf(zid) * days);
    if (!(rate > 0)) continue;
    const occ = occupiedHomes(zid);
    if (!(occ > 1e-9)) continue;
    let freed = 0;
    for (const k of Object.keys(S.co)) {
      const c = parseKey(k);
      if (c.zone !== zid || A.workersPer(c.arch) <= 0) continue;
      const gone = take(k, S.co[k] * rate);
      freed += gone;
      S.flow.out += gone * A.avgSize(c.arch);    // people, see the eviction note
    }
    if (freed > 0) relets[zid] = freed;
  }

  /* 4. 🚚 ARRIVALS. Per zone, per archetype that zone draws, per education —
        each candidate is tested on rent and on work before a single one of them
        moves in, and the ones that pass share the zone's vacant dwellings in
        proportion to how attractive the city is TO THEM. Two households looking
        at the same city do not see the same city. */
  const inMix = { low: 0, mid: 0, high: 0, total: 0 };
  let attractSum = 0, attractW = 0;
  let vacantTotal = 0, blockedRent = 0, blockedJobs = 0, considered = 0;
  const plan = [];
  for (const zid of Z.zoneIds()) {
    const homes = sv.homes[zid] || 0;
    const vacant = homes - occupiedHomes(zid);
    if (homes > 0) vacantTotal += Math.max(0, vacant);
    if (!(vacant > 0.001)) continue;
    const z = Z.zoneDef(zid);
    const rent = rentOf(zid, tight);
    const cands = [];
    let wsum = 0, wraw = 0;
    for (const a in z.bag) {
      const bagW = Math.max(0, z.bag[a] || 0);
      if (!(bagW > 0)) continue;
      const arch = A.archetype(a); if (!arch) continue;
      /* 🎓 The zone tilts the education draw — see archetypes.eduDraw() for the
         measurement that made this necessary. */
      const draw = A.eduDraw(a, z.eduTilt);
      for (const e in draw) {
        const ew = draw[e];
        if (!(ew > 0)) continue;
        const income = A.incomeOf(a, e, fit[e]);
        const burden = income > 0 ? rent / income : 99;
        considered += bagW * ew;
        if (burden > dm.rent.burdenMax) { blockedRent += bagW * ew; continue; }
        if (fit[e] < dm.arrival.jobFloor && A.workersPer(a) > 0) { blockedJobs += bagW * ew; continue; }
        /* 📊 THE ATTRACTIVENESS OF THIS CITY TO THIS HOUSEHOLD. Three signed
           terms, weighted in ECON — the same shape the reference demand panel
           expresses ("+ Local Demand, − Low-skill Labor Availability"), and the
           panel prints these back rather than inventing its own story. */
        const afford = clamp01(1 - burden / dm.rent.burdenMax);
        const W = dm.arrival.weight;
        /* 🔴 A HOUSEHOLD WITH NO WORKERS DOES NOT SCORE THE LABOUR MARKET — AND
           IT DOES NOT GET A FREE PASS ON IT EITHER. This read
           `const jobs = workersPer(a) > 0 ? fit[e] : 1`, handing pensioners a
           perfect 1 on the LARGEST of the three weights (0.50). So a retired
           household read every city as at least half-attractive and outscored
           every working household in any city with a soft labour market — the
           weighting half of the all-retired attractor, working alongside the
           job-gate exemption below. It also inflated the panel's own meter: a
           city with no work read as ATTRACTIVE, because the only households
           that would still come were the ones who did not want any.
           The weight is redistributed over what a pensioner actually chooses a
           town for — the rent against a fixed pension, and the services — so
           the three weights still sum to 1 and a retune of any of them stays
           meaningful for both kinds of household. */
        let att;
        if (A.workersPer(a) > 0) {
          att = W.jobs * fit[e] + W.rent * afford + W.services * services;
        } else {
          const rest = W.rent + W.services;
          att = rest > 0 ? (W.rent * afford + W.services * services) / rest : 0;
        }
        att = Math.max(dm.arrival.minAttract, clamp01(att));
        const w = bagW * ew * att;
        cands.push({ a, e, w, att });
        wsum += w; wraw += bagW * ew;
        attractSum += att * bagW * ew; attractW += bagW * ew;
      }
    }
    if (!cands.length || !(wsum > 0)) continue;
    /* How attractive this zone is, as the mean over the households that would
       actually consider it — the ones rent or work already ruled out are not in
       `cands` at all, which is why a zone nobody can afford fills slowly
       rather than filling with people who cannot pay. */
    const zoneAttract = wsum / Math.max(1e-9, wraw);
    /* 🔁 A FLAT WHOSE LEASE JUST ENDED IS RE-LET, NOT ABANDONED. The dwellings
       phase 3c freed are offered again in the same step; only the vacancy that
       was ALREADY standing fills at the slow arrival rate. Without this split,
       turnover would drain a district faster than the 30%/day arrival rate could
       refill it and the fix for the student ratchet would read as a bug that
       empties cities. Both halves are still scaled by how attractive the zone
       is, so an unattractive city genuinely fails to re-let. */
    const relet = Math.min(vacant, relets[zid] || 0);
    const standing = Math.max(0, vacant - relet);
    const moving = Math.min(vacant,
      (relet + standing * dm.arrival.ratePerDay * days) * clamp01(zoneAttract));
    if (!(moving > 0)) continue;
    for (const c of cands) plan.push({ zone: zid, a: c.a, e: c.e, hh: moving * (c.w / wsum) });
  }

  /* 🧓 …AND THE FINITE SUPPLY OF PENSIONERS. Households with no workers skip the
     job gate above, and that exemption is CORRECT — a retired household does not
     need a vacancy. What was missing is that nothing else limited them, so in a
     job-poor city they were the only candidates left and they took every
     dwelling that came free, forever. The honest limit is that only so many
     pensioners are looking to move at all, and the ones who do follow the
     working city: you retire to where your family lives and works, not to an
     empty district. So the whole workerless arrival stream is metered against
     the city's WORKING households, however many dwellings stand empty.

     🔴 A RATE, NOT A CAP, AND THE DIFFERENCE IS THE WHOLE POINT. A clamp at
     "retired may be at most N% of the city" would have made the measurements
     look fixed while leaving the pressure intact behind it — and the next person
     to touch this scorer would reintroduce the attractor with the clamp still
     sitting there looking deliberate. This instead collapses to zero on its own
     in the city that used to lock, because that city has no working households
     left to draw pensioners toward it.
     ⚠ Scaled, not truncated — same reason the budget ceiling below is: list
       order is a UI decision and must never be an economic one. */
  {
    let workingHH = 0;
    for (const k in S.co) if (A.workersPer(parseKey(k).arch) > 0) workingHH += S.co[k];
    const supply = workingHH * (dm.arrival.workerlessDrawPerWorkerHH || 0) * days;
    let want = 0;
    for (const p of plan) if (A.workersPer(p.a) <= 0) want += p.hh;
    if (want > supply) {
      const s = supply / Math.max(1e-9, want);
      for (const p of plan) if (A.workersPer(p.a) <= 0) p.hh *= s;
    }
  }

  /* 🏙 …AND THE CEILING. The host owns how many people this city supports; this
     module owns who they are. Arrivals are scaled back to fit rather than
     truncated one by one, so no archetype is starved by list order — list order
     is a UI decision and must never be an economic one (households.js `demand`
     makes the same call for the same reason). */
  let heads = 0;
  for (const p of plan) heads += p.hh * A.avgSize(p.a);
  const room = Math.max(0, budget - population());
  let scale = 1;
  if (heads > room) scale = room / Math.max(1e-9, heads);
  const capped = scale < 1;
  for (const p of plan) {
    const hh = p.hh * scale;
    if (!(hh > 0)) continue;
    add(p.zone, p.a, p.e, hh);
    const h = hh * A.avgSize(p.a);
    S.flow.in += h;
    const w = A.wealthWeights(p.a, p.e);
    const sum = w.low + w.mid + w.high;
    if (sum > 0) { inMix.low += h * w.low / sum; inMix.mid += h * w.mid / sum; inMix.high += h * w.high / sum; inMix.total += h; }
  }
  S.lastInMix = inMix.total > 0 ? inMix : S.lastInMix;

  /* 5. 📣 WHY THE NUMBER IS WHAT IT IS. The panel never prints a bare figure —
        it prints this list beside it, in the register the reference demand
        panel uses: a meter with a SIGNED CAUSAL LIST. */
  S.attract = attractW > 0 ? attractSum / attractW : 0;
  /* 🔴 A CAUSE HAS TO BE MATERIAL OR IT IS NOISE. Some household type is turned
     away from some zone in every city that has ever existed — students cannot
     afford detached houses anywhere — and reporting that as a limit made a
     thriving town print "rents are above what arrivals can pay" while it filled
     up. A share of the households that actually looked, not a raw count. */
  const blockShare = considered > 0 ? 1 / considered : 0;
  const material = dm.ui.materialShare;
  const rentBlocked = blockedRent * blockShare > material;
  const jobsBlocked = blockedJobs * blockShare > material;
  const full = sv.totalHomes > 0 && vacantTotal <= Math.max(0.5, sv.totalHomes * dm.ui.fullShare);
  if (sv.totalHomes <= 0) {
    causes.push({ sign: '−', label: 'No housing zoned', why: 'Nothing in this city is zoned residential, so nobody can move in.' });
  } else if (full) {
    /* ⚠ THE SAME `full` TEST THE LIMIT USES. These two used to disagree — the
       cause line printed "+ Vacant homes" off `> 0.001` while the caption
       underneath said every dwelling was occupied, which is one panel holding
       two opinions about one city. One test, read twice. */
    causes.push({ sign: '−', label: 'No vacant homes', why: 'Every dwelling the city has zoned is occupied. Zone more residential land, or zone it denser.' });
  } else {
    causes.push({ sign: '+', label: 'Vacant homes', why: Math.round(vacantTotal) + ' dwellings are standing empty and waiting for residents.' });
  }
  let fitSum = 0, fitN = 0;
  for (const e of A.eduOrder()) { fitSum += fit[e]; fitN++; }
  const meanFit = fitN ? fitSum / fitN : 1;
  /* 🔴 EVERY THRESHOLD BELOW IS AN ECON READ. They were literals here for two
     rounds, and commit 02ccda2 claimed to have moved them while leaving five
     behind — a number that only LOOKS like presentation is still a number
     somebody has to retune, and finding it meant grepping this file. */
  if (posts && meanFit > dm.ui.jobsPlentyFit) causes.push({ sign: '+', label: 'Work for most people', why: 'The city posts more jobs than it has residents to fill them.' });
  else if (posts && meanFit < dm.ui.jobsScarceFit) causes.push({ sign: '−', label: 'Not enough jobs', why: 'Most residents cannot find work here, and word gets around.' });
  if (capped) causes.push({ sign: '−', label: 'City population cap', why: 'The city itself supports no more residents yet — build Housing, or zone more land. Nobody can move into a city with nowhere to put them.' });
  if (rentBlocked && blockedRent >= blockedJobs) {
    causes.push({ sign: '−', label: 'Rents above local incomes', why: 'Households who would have taken those homes cannot pay for them on what this city pays. Cheaper zoning — low rent, or high density — is what they can afford.' });
  } else if (jobsBlocked) {
    causes.push({ sign: '−', label: 'No work they qualify for', why: 'The jobs this city posts need an education its arrivals do not have, or there are no jobs at all.' });
  }
  for (const e of A.eduOrder()) {
    if ((S.stress[e] || 0) > dm.departure.joblessGraceDays) {
      const def = A.eduDef(e);
      causes.push({ sign: '−', label: (def ? def.short : e) + ' residents leaving', why: 'There has been no work for them for ' + Math.round(S.stress[e]) + ' days and their savings have run out.' });
    }
  }
  if (services > dm.ui.servicesGood) causes.push({ sign: '+', label: 'Services are keeping up', why: 'The shops and utilities are meeting what residents ask of them.' });
  else if (services < dm.ui.servicesPoor) causes.push({ sign: '−', label: 'Services falling short', why: 'Residents cannot buy what they need here, and word gets around.' });
  if (tight > dm.ui.tightNotice) causes.push({ sign: '−', label: 'Housing market is tight', why: 'Rents are ' + Math.round((tight - 1) * 100) + '% above baseline because almost nothing is free.' });
  S.causes = causes.slice(0, Math.max(3, dm.ui.maxCauses));

  /* The binding constraint, as one sentence, for the meter's caption. */
  S.limit = sv.totalHomes <= 0 ? 'nohousing'
          : capped ? 'citycap'
          : full ? 'homes'
          /* ⚠ THE SMOOTHED DAILY RATE, WITH A MARGIN — not this tick's flow.
             A tick is a quarter of a day and the two sides arrive at different
             moments in it, so a steady city flickered between "leaving" and
             nothing every few seconds on a panel that repaints every 4 s.
             ⚠ BOTH HALVES OF THE GUARD ARE ECON READS NOW. `leavingFloor` was a
               bare `+ 0.05` sitting in this expression — in a city moving one
               resident a day the multiplicative margin is worth 0.15 of a
               person, so the absolute floor is the half that actually does the
               work at small sizes, and it was the one nobody could find. */
          : S.rate.out > S.rate.in * dm.ui.leavingMargin + dm.ui.leavingFloor ? 'leaving'
          : rentBlocked && blockedRent >= blockedJobs ? 'rent'
          : jobsBlocked ? 'jobs'
          : null;

  /* 📅 Accumulate, and only report a RATE when a whole day has actually
     elapsed — see the `acc` declaration for the −1,167/day this replaces. */
  S.acc.in += S.flow.in; S.acc.out += S.flow.out;
  S.acc.grad += S.flow.grad; S.acc.evicted += S.flow.evicted;
  S.acc.days += days;
  if (S.acc.days >= 1) {
    const d = S.acc.days;
    S.day = { in: S.acc.in / d, out: S.acc.out / d, grad: S.acc.grad / d, evicted: S.acc.evicted / d };
    S.rate.in = S.day.in;
    S.rate.out = S.day.out + S.day.evicted;
    S.acc = { in: 0, out: 0, grad: 0, evicted: 0, days: 0 };
  }
  return S;
}

/* ── PERSISTENCE ────────────────────────────────────────────────────────────
   Absent-tolerant, like everything else in this codebase that loads: a save
   written before this feature existed opens as "not seeded yet", which the
   first tick answers by seeding from the city as it stands. Cohorts are rounded
   to 3dp on the way out — the save is JSON and a float with 17 digits in it is
   17 bytes of nothing. */
export function serialize() {
  const co = {};
  for (const k in S.co) if (S.co[k] > 0.0005) co[k] = Math.round(S.co[k] * 1000) / 1000;
  const stress = {};
  for (const e in S.stress) if (S.stress[e] > 0) stress[e] = Math.round(S.stress[e] * 100) / 100;
  return { v: S.v, co, stress, rent: Math.round(S.rentIndex * 1000) / 1000, seeded: !!S.seeded };
}
/* 🔴 EVERY NUMBER ENTERS THROUGH num(). `Math.floor((raw.x)||0)` on a string is
   NaN — households.js paid for that one with a population that silently became
   NaN and poisoned the treasury from one bad byte in a save. */
function num(v, dflt) {
  const n = Number(v);
  if (!isFinite(n) || n < 0) return dflt || 0;
  return n;
}
export function load(raw) {
  reset();
  if (!raw || typeof raw !== 'object') return false;
  const co = raw.co && typeof raw.co === 'object' ? raw.co : {};
  const zones = new Set(Z.zoneIds()), archs = new Set(A.archetypeIds()), edus = new Set(A.eduOrder());
  for (const k in co) {
    const c = parseKey(k);
    /* A cohort naming a zone, archetype or education this build does not have
       is DROPPED, not coerced. Retuning ECON must not resurrect a deleted zone
       through a save file, and silently folding it into a neighbour would make
       the population figure wrong in a way nothing could see. */
    if (!zones.has(c.zone) || !archs.has(c.arch) || !edus.has(c.edu)) continue;
    const n = num(co[k], 0);
    if (n > 0) S.co[key(c.zone, c.arch, c.edu)] = n;
  }
  for (const e of A.eduOrder()) S.stress[e] = num(raw.stress && raw.stress[e], 0);
  S.rentIndex = Math.max(1, num(raw.rent, 1));
  S.seeded = !!raw.seeded || households() > 0;
  return true;
}
