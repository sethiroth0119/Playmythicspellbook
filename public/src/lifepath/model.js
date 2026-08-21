/* ════════════════════════════════════════════════════════════════════════════
   🧬 THE LIFEPATH MODEL — an age and a career for a named person, and NOTHING
      that is not traceable to something the city already computes.
   ----------------------------------------------------------------------------
   Read /src/citizen/facts.js's header first; this file is written against it.
   Its rule is that a row with no model behind it says UNAVAILABLE with the real
   reason, never a plausible number. Two rows have said exactly that since the
   panel shipped, and this module is the model that earns them — or, where it
   cannot, leaves them saying it.

   ── THE THREE KINDS OF THING IN HERE, AND THEY ARE NEVER MIXED ─────────────

     FACT       read live off another layer and not touched:
                MythicCitizens.employer(id), MythicEconomy.firm(n).level and
                .foundedDay, MythicEconomy.snapshot().day, the workplace tile's
                `born` stamp, game.cityAge.

     DERIVATION arithmetic over facts, with no free parameters:
                tenure, career grade, the age BAND an age falls in, and the
                whole clock in tuning.js.

     SAMPLE     a draw. There is exactly ONE of them in this module — WHICH
                YEAR inside their age band a citizen was born in — and it is
                marked everywhere it surfaces. The panel prints the age with a
                "≈" for this reason and its source line says the word.
                🔴 AND "EVERYWHERE IT SURFACES" INCLUDES WHAT IS COMPUTED FROM
                   IT. This is the rule the file got wrong for a round: the
                   career grade is bounded by (age − workAge), that bound is the
                   one that actually binds for ~39 of 40 citizens in a settled
                   city, and the row still called itself DERIVED. Arithmetic
                   over a sample is a sample. careerOf() therefore reports
                   `sampled` per citizen, true exactly when the worklife term is
                   the binding one, and the panel marks that row the same way it
                   marks the age. See THE CAREER, below.

   🔴 THE AGE IS A STRATIFIED SAMPLE OF THE CITY'S OWN AGE PYRAMID, NOT A DRAW
      FROM THIN AIR. /src/demographics has had `byAge()` all along — the city
      HAS an age distribution, in people, per household archetype. What it has
      never had is a per-person age. So:

        · the BAND a citizen is dealt into is whichever band the named roster is
          currently most short of, measured against MythicDemographics.report()
          .ages. That is Hamilton apportionment, and it is what makes the roster
          reproduce the pyramid to within one person per band instead of merely
          resembling it — an independent draw per citizen would be a plausible
          number with sampling noise on it, and 72 people is not enough for that
          noise to be small.
        · the YEAR inside the band is a hash of their id, so it is the same in
          every session and on every machine — the technique citizens.city.js
          uses for names and /src/demographics uses for household draws.
        · what is STORED is not the age. It is the BIRTH STAMP, on game.cityAge,
          in the same seconds `tile.born` uses. The age is (now − born), so it
          advances by itself and no tick has to write anything.

   🔴 WHY CHILDREN ARE OUT OF THE SAMPLE FRAME, AND IT IS NOT A FUDGE.
      The named roster is sized by JOB SLOTS — `citTarget()` in node-city is
      min(citCap, max(CIT.MIN, citJobSlots().length)) — so it is a sample of the
      city's workforce, and a nine-year-old crewing a smelter is precisely the
      plausible lie facts.js exists to refuse. /src/demographics already draws
      the same line for the same reason: `byEducation()` counts adults only,
      "children have not had one yet, and counting them as uneducated would make
      every family district look like a failure of schooling."
      The frame is DERIVED, not listed: a band whose whole year range is below
      workAge is out of frame. Add a band to ECON and it classifies itself.
      ⚠ Both distributions are reported by `distribution()` — the city's full
        pyramid AND the frame — so the exclusion is visible rather than implied.

   🔴 SENIORS ARE IN FRAME. A retired household has workers: 0, but a named
      citizen past retireAge holding a crew seat is somebody working past
      retirement, which is a real thing and which the panel says out loud. It is
      not the same class of statement as a child at a furnace.

   ── THE CAREER ─────────────────────────────────────────────────────────────
   🔴 IT IS NOT A SECOND OPINION ABOUT EMPLOYMENT AND CANNOT BECOME ONE. This
      module never sets a job, never claims a seat, never touches `emp`. Who
      somebody works for is MythicCitizens.employer(id) and the firm behind it,
      full stop; all this adds is WHERE ON THAT EMPLOYER'S OWN LADDER they
      stand. If the employer changes, the career changes with it, because the
      career is computed from the employer and never stored.

   ── ⚠ AND THE TWO NUMBERS UNDER THE CAREER ARE ANALOGIES, NOT DERIVATIONS ──
   This module's headline is that it has no free parameters. That is true of the
   clock, of the bands, of the frame and of the tenure ceiling. It is NOT true
   of the two inputs to the grade, and both used to be written here as though it
   were. Naming them honestly is the point of this block.

   ① HOW MANY GRADES A FIRM HAS. The ladder is ECON.firm.levels, and the old
      words for it were "the only rank ladder this game has". Read the table:
      level 5 gates on 80 employees, 165,000 🔥/day of revenue and 2,200
      customers. It is a COMPANY-SIZE ladder. Nothing in it is about a person,
      and "5 firm levels ⇒ 5 employee grades" is not read out of it — it is an
      analogy, and it is the free parameter this module claimed not to have.
      ⚠ WHY IT IS STILL THE LEAST-BAD NUMBER AVAILABLE: the alternative is to
        write down a grade count, which is a number with no model behind it at
        all — the exact thing this codebase keeps tearing out. The analogy has
        one real thing going for it and the row is entitled to say it: a bigger
        firm has more rungs to stand on THAN A SMALLER ONE, and the direction
        and the ordering of that claim are read off ECON, even though the count
        is not. So: analogy, argued, labelled, and never called a derivation.
      ⚠ REJECTED: deriving the grade count from `gate.employees` (4 / 12 / 34 /
        80), e.g. log of headcount. It looks like a derivation and is a worse
        analogy — a span of control is not a promotion ladder, and it would put
        a made-up base of logarithms in a file whose whole claim is that it has
        no such thing.

   ② HOW LONG A GRADE TAKES. ECON.demographics.education.graduatePerDay, at
      ≈3.47 years per rung. The old words were "the only rate this game has for
      a person moving up a rung, reused rather than duplicated" — which dresses
      a repurposing in the `_opEcon()` virtue. graduatePerDay moves an IN-SCHOOL
      HOUSEHOLD one EDUCATION rung. A promotion is a different event and the
      game does not model it. So this is the same kind of thing as ① and gets
      the same treatment.
      ⚠ WHY IT IS STILL THE LEAST-BAD: it is the only rate in the whole tuning
        table whose subject is A PERSON ADVANCING A STEP rather than a firm, a
        household or a dwelling, and it is live — retune it and this moves.
        A written-down "years per promotion" would be a shadow constant.
      ⚠ REJECTED: `ECON.firm.levels[*].gate.profitDays` (6/12/20/30) as the rung
        length. It is a firm's qualifying period, denominated in economic days,
        and reading it as a person's time-in-grade is a WORSE analogy than the
        education rate with none of its "about a person" claim.

   So a person's grade is, with both analogies in plain sight:

       grade = clamp( 1 + floor(tenure / gradeYears), 1, firm.level )

   ⚠ TENURE IS A CEILING, NOT A HIRE DATE, AND THE ROW SAYS SO. The roster keeps
     no hire date and this module will not invent one by stamping "the first
     time I looked", which would make the number depend on when the player
     opened a panel. What CAN be justified is an upper bound out of two real
     stamps:

         tenure = min( years since they turned workAge,
                       age of the BUSINESS that employs them (firm.foundedDay) )

     Nobody can have worked for a business for longer than the business has
     existed, and nobody can have worked anywhere for longer than they have been
     of working age.

   🔴 THE SECOND TERM USED TO BE THE AGE OF THE BUILDING, AND THAT WAS THE ONE
      DEFECT THIS FILE COULD NOT CLOSE. `tile.born` was the only time reference
      in reach, because `firms.js found()` wrote no founding time at all. It has
      one now — an economic-day stamp, written once at founding, riding the save
      — and the ceiling reads it instead. The difference is not cosmetic:

        · A DEMOLISH-AND-REBUILD NO LONGER DEMOTES A WORKFORCE. Measured, same
          citizen, same firm at level 5: tenure 60.0 → 0.0 years and grade 5 → 1
          before, and 60.6 → 60.6 with grade 5 held after. `syncBuildings` KEEPS
          the firm when a rebuilt tile carries the same output and industry, so
          the economy's own answer to "is this the same business" was already
          "yes" while the printed ceiling said "it opened this instant".
        · A RE-FOUNDED TILE IS STILL A NEW BUSINESS AND STILL STARTS AT ZERO.
          The stamp is on the firm RECORD, and `syncBuildings` founds a new
          record — new id, today's stamp — whenever the rebuilt tile is a
          different business. Nothing inherits. That separation is the one the
          closure log exists to make readable, and stamping the TILE instead
          would have collapsed it.

      ⚠ AND IT IS STILL A CEILING. A firm founded 40 years ago does not mean
        this citizen has been there 40 years; what changed is that the ceiling
        stops moving for reasons that have nothing to do with the person. The
        row goes on saying "at most", because that is still all it knows.

      ⚠ THE SITE TERM IS NOT KEPT ALONGSIDE IT AS A THIRD min(). It would
        re-admit the whole defect: after a rebuild the site term is the smallest
        of the three, min() picks it, and the workforce is demoted again with
        the new stamp sitting unused. The building's age is still REPORTED, so
        the panel can say "the walls are younger than the business in them".

      ⚠ A FIRM WITH NO STAMP FALLS BACK TO THE OLD CEILING, DELIBERATELY. A save
        written before the field existed loads `foundedDay: null` (never 0, and
        never today — see firms.js load(), where both temptations are argued
        down), and then the ceiling is the site term and the provenance says
        'site', exactly as it did before this existed. A mature city reloaded
        from an old save therefore reads exactly as it used to read, and heals
        one business at a time as tiles turn over. For a firm with no tile of
        its own the fallback ceiling is the age of the city, which is the same
        argument one level out.

   🔴 AND HERE IS THE THING THAT MATTERS MOST ABOUT THAT min(), WHICH THIS FILE
      DID NOT USED TO SAY. THE TWO HALVES ARE NOT THE SAME KIND OF NUMBER.

        the firm half  — firm.foundedDay, or tile.born / game.cityAge when a
                         firm predates the stamp — is a REAL STAMP the game
                         already saves. Tenure bound by it is DERIVED.
        the worklife half — age − workAge — is THE SAMPLE. ageOf() is the one
                         draw in this module, and this term is that draw minus
                         a constant. Tenure bound by it is SAMPLED, and the
                         grade above it is then a pure function of the draw.

      🔴 WHICH ONE BINDS IS NOT AN EDGE CASE, IT IS THE NORMAL CASE. As soon as
         the business is older than the worker's career — a mature city, which
         is every city after a few hours — the worklife term is the one that
         binds. Measured on a 40-citizen roster whose employer was founded 60
         years ago: 39 of 40. So for practically the whole roster of a settled
         city, `tenure` IS `age − 18` exactly and the grade is a restatement of
         the sampled age.
      🔴 AND THE FOUNDING STAMP MADE THAT MORE TRUE, NOT LESS. It is worth being
         explicit, because "we added real data" reads like "the sample is gone".
         It is not: the stamp replaced a term that was WRONG after a rebuild
         with one that is right, and a right ceiling that is larger means the
         worklife binds MORE often, not less. The rebuild regime used to fall
         out of `worklife` into a site-bound 0.0 years printed under DERIVED —
         a false number wearing the stronger label. Those rows are worklife-bound
         and marked SAMPLED now. Nothing that was honestly marked lost its mark.
      🔴 THEREFORE careerOf() RETURNS `sampled: true` WHENEVER tenureFrom is
         'worklife', and the panel prints "≈ Grade N of C" with a source line
         that leads on SAMPLED — the same treatment, and the same word, the Age
         row has carried since it shipped. A row that reads DERIVED while its
         binding term is a draw is the one dishonesty this whole module exists
         to avoid, and it had it.
      ⚠ REJECTED: dropping the row back to UNAVAILABLE when the worklife binds.
        It is the safer answer and it was seriously considered — the project's
        standard is that a plausible number is worse than an admitted absence,
        and `cardSeam()` returns `value: null` in this very module for exactly
        that reason. It loses on two counts. First, the number is not plausible-
        looking fiction: it is a true CEILING, and the source line now names the
        term doing the capping, so a reader can see it is "at most", not "is".
        Second, UNAVAILABLE would take the CAP down with the grade, and the cap
        ("of 3") is a live reading off the employer with no sample in it at all
        — refusing to print an earned reading because the number beside it is a
        sample is a different kind of dishonesty, not an absence of one.
        The deciding argument: this module already prints a sample on the Age
        row and defends it. If ≈ and the word SAMPLED are enough there, they are
        enough for a quantity derived from it; if they are not enough here, the
        Age row has to go too. They are enough — provided the marking is real,
        which is what changed.

     ⚠ A REBUILD USED TO DEMOTE THE WHOLE WORKFORCE, AND NO LONGER DOES.
       `tile.born` is stamped at PLACEMENT, so demolishing and re-raising a
       building took the ceiling from 60.0 years to 0.0 and every grade in it
       from 5 to 1 with nobody's job having changed. This file recorded that as
       unfixable from here, and the reason it gave was exactly right: the cures
       were a hire date on the roster or a founding stamp on the firm record,
       and a firm carried no time at all. The stamp was added where it belongs —
       `firms.js found()`, on the economy's own `S.day` clock, one integer,
       written once, moving no money — and this module reads it. The read is
       still read-only; nothing here writes it.

     🔴 WHAT IS STILL NOT FIXED, STATED PLAINLY: THERE IS NO HIRE DATE. Firm age
       is a real ceiling and a much better one than masonry, but it is a ceiling.
       The honest answer to "how long has this person worked here" needs a stamp
       PER (citizen, employer) PAIR, written when the pairing is made, and it
       does not exist anywhere in the game. What it would take:
         · a `hiredDay` on the citizen roster's employment record, written by
           whatever assigns the seat (MythicCitizens / households.hire), and
           re-written on every job change;
         · that field in the roster's save slice, absence-tolerant;
         · nothing in this module at all — /src/lifepath is deliberately
           read-only over the roster, and that boundary is the reason its
           numbers cannot drift from the layer that owns them. Writing a hire
           date from HERE would mean the career depends on when a panel was
           first opened, and on a loaded save every career would restart at
           zero: a career that resets when you reload is worse than a bound
           that does not.
       Until that exists the row says "at most", and it means it.

     ⚠ REJECTED: a stored hire date written by THIS module, the first time it
       observed the pairing. Same objections, and it is the version that looks
       like data while being a record of panel-opening.
     ⚠ REJECTED: dropping the firm-level cap so that grades move more. Then a
       corner shop has a regional director in it. The cap is the honest half:
       in a town of level-1 businesses everybody reads "grade 1 of 1", which is
       TRUE, and the row says what their tenure would otherwise have earned.

   ── WHAT THIS MODULE STORES, AND WHAT IT COSTS ─────────────────────────────
   ONE NUMBER PER NAMED CITIZEN: an integer birth stamp on the game.cityAge
   clock, usually negative (born before the city was founded). At CIT.MAX = 80
   that is 80 integers, ~1.2 KB of save. Everything else — the age, the band,
   the tenure, the grade, the cap — is recomputed from that stamp plus live
   state on every read, exactly as /src/dossier derives residence rather than
   storing it and /src/crowd derives per-tile state from a tile seed.
   The birth stamp is stored rather than derived because it CANNOT be derived:
   it depends on the age pyramid at the moment the person was dealt into it, and
   that pyramid moves. Deriving it live would make a citizen's age jump every
   time a tower filled up.
   ════════════════════════════════════════════════════════════════════════════ */

import { ECON } from '../economy/tuning.js';
/* The same deterministic-draw machinery /src/demographics uses for household
   draws, imported rather than re-typed: one hash, one PRNG, no global state.
   A second copy would drift and every drawn age in the city would move with it. */
import { seedOf, rnd } from '../demographics/archetypes.js';
import { clockOf, bandOfYears, bandLabel } from './tuning.js';

/* ── the seams, every one probed and absence-tolerant (facts.js's pattern) ── */
const W = () => (typeof window !== 'undefined' ? window : null);
function CITS() {
  try { const w = W(); const M = w && w.MythicCitizens; return (M && typeof M.list === 'function') ? M : null; }
  catch (e) { return null; }
}
function DEMOG() {
  try { const w = W(); const D = w && w.MythicDemographics; return (D && typeof D.report === 'function') ? D : null; }
  catch (e) { return null; }
}
function ECONOMY() {
  try { const w = W(); return (w && w.MythicEconomy) || null; } catch (e) { return null; }
}
/* 🪦 /src/mortality — the layer that DRIVES the removal verb. Probed, never
   assumed: this module still writes nothing, and everything below that used to
   assert "nobody here ever dies" now ASKS instead. See mortality(). */
function MORTALITY() {
  try { const w = W(); const M = w && w.MythicMortality; return (M && typeof M.report === 'function') ? M : null; }
  catch (e) { return null; }
}

/* ── state: the ONE stored field, plus whatever a newer build wrote ──────── */
let STAMPS = Object.create(null);     // citizen id -> birth stamp, game.cityAge seconds
let FOREIGN = null;                   // unknown keys from a newer build's save slice
let CTX = null;                       // { now, tileBorn, cycleMin } — the host hand-over
let CLK = null;                       // memoised clock; ECON does not change at runtime
/* ⏱ THE ECONOMY'S DAY COUNT, memoised against the city clock reading that asked
   for it. `MythicEconomy.snapshot()` is the only published read of `S.day`, and
   it is not cheap — it sums every firm's cash, reports the bank, the freight
   network and the trade book, and recomputes totalCinder(). cardSeam() walks the
   whole roster in one synchronous pass, so without this an 80-person city would
   build 80 of those objects to read one integer 80 times.
   Keyed on `t` and not on a timer: `now()` is game.cityAge, so every read taken
   inside one frame shares a key and every later frame misses. That makes the
   cache exactly as stale as the frame it is serving, which is the only staleness
   a panel can observe. */
let DAY = { t: null, day: null };

export function bind(ctx) { CTX = ctx || null; CLK = null; DAY = { t: null, day: null }; return !!CTX; }
export function bound() { return !!CTX; }

export function clock() {
  if (CLK) return CLK;
  let hostDay = null;
  try { hostDay = CTX && CTX.cycleMin ? CTX.cycleMin() : null; } catch (e) { hostDay = null; }
  CLK = clockOf(hostDay);
  return CLK;
}

function now() {
  try { const t = CTX && CTX.now ? +CTX.now() : NaN; return isFinite(t) ? t : NaN; }
  catch (e) { return NaN; }
}

/* ⏱ WHAT ECONOMIC DAY IT IS, or null. Two clocks run in this game and they are
   NOT the same clock: `game.cityAge` counts real seconds and `S.day` counts
   economic days that `ECON.clock.maxCatchUpDays` can and does drop. So a firm's
   age is measured in the economy's own unit against the economy's own counter,
   and only the RESULT — a duration in days — is converted to years, with the
   same clk.daysPerYear every other figure in this module goes through.
   Subtracting a founding stamp from cityAge would silently mix the two. */
function econDay(t) {
  if (DAY.t === t) return DAY.day;
  let d = null;
  try {
    const E = ECONOMY();
    if (E && typeof E.snapshot === 'function') {
      const s = E.snapshot();
      const n = s ? Number(s.day) : NaN;
      if (isFinite(n) && n >= 0) d = n;
    }
  } catch (e) { d = null; }
  DAY = { t, day: d };
  return d;
}

/* The bands that are IN the sample frame — derived, never listed. A band whose
   whole year range sits below working age is a band the named roster (which is
   sized by job slots) does not draw from. See the header. */
function frameBands(clk) {
  const out = [];
  for (const g in clk.bands) if (clk.bands[g][1] > clk.workAge) out.push(g);
  return out;
}

/* ── the city's own age pyramid, LIVE ─────────────────────────────────────
   MythicDemographics.report().ages and nothing else. Deliberately the shipped
   read rather than a local sum over the cohort map: a figure the consumer
   recomputes its own way is a figure that eventually disagrees with the panel
   that prints it, which is the rule /src/city/terroir.js states and this
   codebase has paid for more than once. */
export function pyramid() {
  const D = DEMOG();
  if (!D) return { ok: false, why: 'the demographics layer is not mounted, so the city has no age distribution to sample from' };
  let rep = null;
  try { rep = D.report(); } catch (e) { return { ok: false, why: 'the demographics report threw' }; }
  if (!rep || !rep.ok || !Array.isArray(rep.ages)) {
    return { ok: false, why: (rep && rep.why) || 'the demographics layer has not counted anybody yet' };
  }
  const city = Object.create(null);
  let total = 0;
  for (const a of rep.ages) {
    const v = Math.max(0, +a.v || 0);
    city[a.k] = v; total += v;
  }
  return { ok: true, city, total };
}

/* …restricted to the frame and normalised. This is the distribution the roster
   is dealt against. */
function targetShares(clk) {
  const p = pyramid();
  if (!p.ok) return p;
  const bands = frameBands(clk);
  const shares = Object.create(null);
  let sum = 0;
  for (const g of bands) { const v = p.city[g] || 0; shares[g] = v; sum += v; }
  if (!(sum > 0)) {
    return { ok: false, why: 'the city has no working-age residents yet — every resident it counts is a child, so there is no frame to sample a named citizen from' };
  }
  for (const g of bands) shares[g] /= sum;
  return { ok: true, shares, bands, city: p.city, cityTotal: p.total, frameTotal: sum };
}

/* ── ages ─────────────────────────────────────────────────────────────────── */
export function yearsOf(id, t, clk) {
  const b = STAMPS[id];
  if (b == null) return NaN;
  return (t - b) / clk.secPerYear;
}

/* 🎲 THE ONE SAMPLE IN THE MODULE. A hash of the citizen id picks the position
   inside the band, so it is stable in every session and on every machine and no
   state is carried between two citizens. UNIFORM inside the band on purpose:
   the archetype table gives band SHARES and says nothing whatever about the
   shape inside a band, so anything other than uniform would be structure this
   game does not model. */
function yearInBand(clk, band, id) {
  const r = clk.bands[band];
  const u = rnd(seedOf('lifepath:' + String(id)));
  return r[0] + u * (r[1] - r[0]);
}

/* ── 🎯 THE DEAL ──────────────────────────────────────────────────────────
   Hamilton apportionment, run incrementally: each unstamped citizen takes the
   band with the largest deficit against the target, measured on the roster AS
   IT STANDS. Deterministic: the roster is walked in id order, bands are tested
   in ECON's own order, and ties go to the first.
   Verified across 3 pyramids × 10 roster sizes (n = 1…200): 30/30 within the
   one-person bound AT THE MOMENT OF THE DEAL. See distribution() for what that
   sentence deliberately does not say, and for the drift it turns into.

   🔴 A FALSE CLAIM STOOD HERE AND IT IS WORTH KEEPING THE CORRECTION VISIBLE.
      The words were: "measured on the roster AS IT STANDS — which means it
      corrects for drift as people age out of one band into the next, not just
      at intake." IT CANNOT AND IT DOES NOT. The loop below returns early the
      moment every id already has a stamp, so on a static roster it never runs
      a second time at all; `have[]` being measured on current ages only ever
      affects citizens BEING DEALT, i.e. new arrivals. And correcting through
      arrivals alone does not work either — injecting 40 fresh citizens into a
      roster of 40 seniors at +50 city-years still leaves the largest share
      deviation at 36.4%, because the existing seniors cannot be pulled back.
      What the measurement on current ages actually buys is smaller and true:
      a citizen dealt LATER is dealt against where the roster stands then, so
      arrivals do not compound the drift they are joining.

   ⚠ IT IS IDEMPOTENT AND IT NEVER RE-DEALS. A citizen who already has a stamp
     keeps it forever. That is what makes an age stable across a read, a repaint,
     a save and a reload — and it is why the deal has to be stored: it depends on
     the pyramid at the moment it was made, and the pyramid moves.
     ⚠ REJECTED: re-dealing periodically to hold the distribution. It buys the
       headline number back by breaking the one promise the module actually
       makes — that a named person's age is theirs. A citizen who was 34 last
       time you opened the panel and is 61 now is not drift, it is a different
       person wearing the same name, and it is worse than the drift.
     ✅ CLOSED — ageing people out. This was carried here as a REJECTED item
       for exactly one reason, and it was never "not worth it": retiring or
       killing a named citizen requires WRITING to the roster, this module is
       read-only over every other layer by construction (see index.js: three
       read closures, not one writer), and a lifepath layer that deletes
       citizens is a second citizen store, which facts.js exists to refuse.
       The note ended by naming where the verb would have to live instead —
       "the citizens layer that mints them" — and that is where it was built:
       node-city CITIZENS_API.retire(id, cause), driven by /src/mortality
       against the city's own death rate, taking the OLDEST resident rather
       than citEnsure()'s newest-first LIFO trim.
       ⚠ NOTHING HERE CHANGED, AND THAT IS THE POINT. This module still writes
         no roster and calls no verb; it is still read-only, and the closure of
         the note is not a licence to start writing. The only thing it gained
         is mortality() — a READ of whether that layer is present — because
         every sentence downstream used to assert "nobody here ever dies" as a
         constant and would have gone on printing it to the player in a city
         where people demonstrably do.
       ⚠ STAMPS ARE STILL CLEANED BY THIS FUNCTION, NOT BY THE KILLER. The
         removal verb deliberately does not touch STAMPS; the block below drops
         the stamp on the next seed() because the id is off the roster. Two
         layers writing one table is the bug being avoided, and _citSeq never
         reissues an id, so a dropped stamp can never be resurrected.
     ⇒ DISCLOSURE REMAINS THE FALLBACK, NOT THE ANSWER. With /src/mortality
       absent the roster is exactly the no-exit roster measured at
       distribution(), so `drift` and the Age row still say so — sourced from
       mortality().why rather than typed. An undisclosed drift is a false
       claim; a disclosed one is a limitation; a disclosure that outlived its
       cause is a false claim again. */
export function seed() {
  const M = CITS();
  const clk = clock();
  if (!M || !clk.ok) return { ok: false, stamped: 0, why: clk.ok ? 'no citizens layer' : clk.why };
  const t = now();
  if (!isFinite(t)) return { ok: false, stamped: 0, why: 'no city clock — /src/lifepath is not mounted' };

  let roster = null;
  try { roster = M.list(); } catch (e) { roster = null; }
  if (!Array.isArray(roster)) return { ok: false, stamped: 0, why: 'the citizens layer did not answer' };

  /* 🧹 Stamps for people who are no longer on the roster are dropped. node-city
     trims from the end and mints a fresh sequence number on regrowth, so an id
     never comes back — keeping them would grow the save forever for nobody. */
  if (roster.length) {
    const live = new Set(roster.map((c) => c.id));
    for (const k in STAMPS) if (!live.has(k)) delete STAMPS[k];
  }

  const todo = [];
  for (const c of roster) if (c && c.id && STAMPS[c.id] == null) todo.push(c.id);
  if (!todo.length) return { ok: true, stamped: 0, why: null };

  const tgt = targetShares(clk);
  if (!tgt.ok) return { ok: false, stamped: 0, why: tgt.why };

  /* Where the roster stands right now, by the band each member's CURRENT age
     falls in — not by the band they were dealt into, so ageing is accounted for. */
  const have = Object.create(null);
  for (const g of tgt.bands) have[g] = 0;
  let n = 0;
  for (const c of roster) {
    if (STAMPS[c.id] == null) continue;
    const g = bandOfYears(clk, yearsOf(c.id, t, clk));
    if (g in have) { have[g]++; n++; }
  }

  todo.sort((a, b) => (seqOf(a) - seqOf(b)) || (a < b ? -1 : a > b ? 1 : 0));
  let stamped = 0;
  for (const id of todo) {
    let best = null, bv = -Infinity;
    for (const g of tgt.bands) {
      const d = tgt.shares[g] * (n + 1) - have[g];
      if (d > bv) { bv = d; best = g; }
    }
    if (!best) break;
    const years = yearInBand(clk, best, id);
    /* 🔒 FLOOR, NEVER ROUND — this is the guard LIFE.round used to *describe*
       without anybody implementing it. The stamp is stored as an integer, so
       rounding it can land up to half a second LATE, and age = (t − born) reads
       up to 0.5/secPerYear ≈ 1.7e-5 years YOUNGER than the year that was drawn.
       A citizen drawn at exactly 18.0000 then reads 17.99998, floors to 17 and
       bands as a `child` — the one band the sample frame provably excludes.
       floor() moves the stamp EARLIER, so the read age is always ≥ the drawn
       age. One-directional by construction, and it costs no constant. */
    STAMPS[id] = Math.floor(t - years * clk.secPerYear);
    have[best]++; n++; stamped++;
  }
  return { ok: true, stamped, why: null };
}

/* Citizen ids are "c<seq>" (node-city citAdd). Sorting on the number rather than
   the string keeps c9 before c10, so the deal order is the mint order. */
function seqOf(id) { const m = /^c(\d+)$/.exec(String(id || '')); return m ? +m[1] : 0; }

/* ── THE AGE READ ─────────────────────────────────────────────────────────── */
export function ageOf(id) {
  const clk = clock();
  if (!clk.ok) return { ok: false, why: clk.why };
  const t = now();
  if (!isFinite(t)) return { ok: false, why: 'no city clock — /src/lifepath is not mounted' };
  const key = String(id);
  if (STAMPS[key] == null) {
    const s = seed();
    if (STAMPS[key] == null) {
      return { ok: false, why: s.why || 'this person is not on the roster the age deal is made from' };
    }
  }
  const years = yearsOf(key, t, clk);
  if (!isFinite(years)) return { ok: false, why: 'the birth stamp is not a number' };
  /* 🔒 A FLOOR ON A READ AGE, WITH A MODEL BEHIND IT — load()'s own argument,
     applied where load() could not apply it. load() drops a non-finite stamp
     because "one NaN on a panel reads as a broken feature rather than as a bad
     byte"; the identical argument covers "≈ -6 years · 🧒 Children", which this
     used to answer ok:true to. It is not merely improbable, it is OUTSIDE THE
     MODEL: the sample frame excludes every band below working age (frameBands),
     so the lowest age this module can ever deal is exactly workAge, and an age
     only ever increases from there. So a read below workAge cannot have come
     from this deal — it is a hand-edited save, a truncated sync, or a stamp
     written by a build with a different workAge — and it says so.
     ⚠ NO CEILING TO MATCH IT, DELIBERATELY. A 178-year-old is absurd and this
       module produces them (see distribution()'s drift note) — but there is no
       maximum age anywhere in ECON to read one off, and writing one down would
       be a number with no model behind it, in the file whose entire claim is
       that it has none of those. The top of the senior band is explicitly a
       MEAN residence time, not a wall. So the top end is disclosed, not
       clamped, and `pastExpectancy` is how it is disclosed.
     ⚠ REJECTED: silently dropping the bad stamp so the next seed() re-deals
       them. It self-heals, and it heals by changing a named person's age
       without saying so — the same objection as re-dealing. UNAVAILABLE with
       the true reason is the module's standard and it applies to itself. */
  if (years < clk.workAge) {
    return { ok: false, why: 'their birth stamp reads an age of ' + years.toFixed(1) +
      ' years, below the working age of ' + clk.workAge + ' this roster is drawn from — ' +
      'so it was not written by this deal (a hand-edited save, or a build with a different workAge)' };
  }
  const band = bandOfYears(clk, years);
  const lab = bandLabel(band);
  return {
    ok: true, sampled: true,
    years, whole: Math.floor(years),
    band, bandLabel: lab.label, bandIco: lab.ico,
    born: STAMPS[key], now: t,
    /* Past the derived life expectancy is a real state, not an error — the top
       of the senior band is a MEAN residence time, not a wall. */
    pastExpectancy: years > clk.lifeExpectancy,
  };
}

/* ── THE CAREER READ ──────────────────────────────────────────────────────── */
export function careerOf(id) {
  const clk = clock();
  if (!clk.ok) return { ok: false, why: clk.why };
  const t = now();
  if (!isFinite(t)) return { ok: false, why: 'no city clock — /src/lifepath is not mounted' };

  const M = CITS();
  if (!M || typeof M.employer !== 'function') return { ok: false, why: 'the citizens layer does not report an employer' };
  let emp = null;
  try { emp = M.employer(String(id)); } catch (e) { emp = null; }
  if (!emp) return { ok: false, why: 'nofirm' };

  const E = ECONOMY();
  let f = null;
  if (E && typeof E.firm === 'function') { try { f = E.firm(emp.id); } catch (e) { f = null; } }
  if (!f) return { ok: false, why: 'nofirm' };

  const levels = (ECON.firm && ECON.firm.levels) || [];
  if (!levels.length) return { ok: false, why: 'ECON.firm.levels is empty, so there is no ladder to stand on' };
  const cap = Math.max(1, Math.min(levels.length, (f.level | 0) || 1));
  const capDef = levels[cap - 1] || levels[0];

  const a = ageOf(id);
  if (!a.ok) return { ok: false, why: a.why };

  /* The two halves of the tenure CEILING. See the header: this is the longest
     they COULD have been there — and the two halves are NOT the same kind of
     number. The site half is a real stamp; the worklife half is the sample. */
  const workedYears = Math.max(0, a.years - clk.workAge);
  let born = null;
  const siteKey = emp.tile || null;
  const canProbe = !!(CTX && typeof CTX.tileBorn === 'function');
  if (siteKey && canProbe) {
    try { born = CTX.tileBorn(siteKey); } catch (e) { born = null; }
  }
  /* 🔴 THREE SITE PROVENANCES, NOT TWO, AND THE THIRD USED TO LIE. This read
     was `born == null ? (siteKey ? 'tile' : 'city') : 'tile'` — so a firm that
     NAMES a tile which has no born stamp (demolished out from under it, or a
     host that mounted without handing tileBorn over) came back 'tile' while the
     VALUE used was silently the age of the city. facts.js then printed "the
     building it occupies (3,3) has stood 3.5 years" about a building that does
     not exist, with a number that is not its age. That is the failure mode this
     whole module is written against: not unavailable, just confident and wrong.
     'gone' is the honest third answer. The city's age is still a true ceiling —
     nobody has worked anywhere in this city longer than the city has stood, the
     same argument one level out that 'city' already rests on — so the VALUE
     stands; what changes is that the row may no longer describe it as a
     building's age, because it is not one. */
  const siteFrom = born != null ? 'tile' : (siteKey ? 'gone' : 'city');
  const siteSec = born == null ? Math.max(0, t) : Math.max(0, t - born);
  const siteYears = siteSec / clk.secPerYear;

  /* ── ⏱ HOW LONG THE BUSINESS ITSELF HAS TRADED ──────────────────────────
     🔴 THIS IS THE TERM THAT REPLACES THE MASONRY, and it is the whole of the
        rebuild fix. `firms.js found()` now stamps `foundedDay` on the economic
        day the business opened, so the ceiling on somebody's service is the age
        of THEIR EMPLOYER rather than the age of the walls around them.
        The old number was an attribute of the BUILDING in one direction and of
        the sampled age in the other, and never of anybody's work.

     WHY IT IS STRICTLY BETTER AND NOT MERELY DIFFERENT. Both are ceilings, and
     both are true — nobody has worked for a business longer than the business
     has existed, and nobody has worked in a building longer than it has stood.
     But only one of them survives the thing a player actually does: demolishing
     a workplace and putting the same workplace back up does not end anybody's
     employment, and `syncBuildings` agrees — it keeps the firm when the rebuilt
     tile carries the same output and industry, and founds a NEW one when it does
     not. The building's stamp contradicts the economy's own answer to "is this
     the same business"; the firm's stamp IS that answer.

     🔴 AND IT IS STILL A CEILING, WHICH THE ROW MUST GO ON SAYING. A firm
        founded forty years ago does not mean THIS person has been there forty
        years. What the stamp buys is a ceiling that stops moving for reasons
        that have nothing to do with the person — it does not buy a hire date,
        and nothing here may be read as one. See the header for what a real hire
        date would cost and why it is not built.

     ⚠ SO THE SITE TERM DROPS OUT OF THE min() WHEN A STAMP EXISTS, rather than
       joining it as a third term. Keeping it would re-admit the whole defect
       through the back door: after a rebuild the site term is the smallest of
       the three, so min() would pick it and demote the workforce exactly as
       before, with the new stamp sitting there unused. `siteYears` is still
       REPORTED, because the panel wants to be able to say "the building is
       younger than the business standing in it, and that is why this number did
       not move when you rebuilt".

     ⚠ AND AN UNSTAMPED FIRM FALLS BACK TO EXACTLY WHAT IT HAD BEFORE. A save
       written before the stamp existed, or a host with no economy mounted at
       all, gives `foundedDay == null` — and then the ceiling is the site term
       and the provenance is 'site', word for word as it was. That is the
       honest reading of "no answer": it does not claim the firm is as old as
       the city and it does not claim it opened today. */
  const day = econDay(t);
  const foundedDay = (f && f.foundedDay != null && isFinite(Number(f.foundedDay)) && Number(f.foundedDay) >= 0)
                   ? Math.floor(Number(f.foundedDay)) : null;
  const firmDays = (foundedDay != null && day != null) ? Math.max(0, day - foundedDay) : null;
  const firmYears = firmDays == null ? null : (firmDays / clk.daysPerYear);
  /* Why there is no firm age, in the module's own words, so the row can say it
     rather than quietly printing the older ceiling as though nothing happened. */
  const firmAgeWhy = firmYears != null ? null
    : (foundedDay == null
        ? 'this business record carries no founding stamp — it was restored from a save written before firms had one'
        : 'the economy reports no day count, so a founding stamp cannot be turned into an age');

  /* The non-worklife half of the ceiling: the business if it can be dated, the
     site if it cannot. One term, named, never two silently minned together. */
  const ceilYears = firmYears != null ? firmYears : siteYears;
  const ceilFrom = firmYears != null ? 'firm' : 'site';
  const tenure = Math.min(workedYears, ceilYears);
  const tenureFrom = workedYears <= ceilYears ? 'worklife' : ceilFrom;

  const rungs = 1 + Math.floor(Math.max(0, tenure) / clk.gradeYears);
  const grade = Math.max(1, Math.min(cap, rungs));

  return {
    ok: true,
    /* 🎲 THE PROVENANCE OF THIS ROW, PER CITIZEN. True exactly when the term
       that BINDS the ceiling is (age − workAge), i.e. when the building has
       stood longer than this person's whole working life — which is 39 of 40
       citizens once a city is mature. Then `tenure` is the sample minus a
       constant and the grade is a restatement of a draw, so the panel prints
       "≈" and leads its source line on SAMPLED.
       When the BUSINESS or the SITE binds instead, the printed ceiling is a
       real stamp — firms.js `foundedDay`, tile.born, or the city's own clock —
       and carries no draw, so the row is DERIVED. ⚠ The sample still decides
       WHICH term binds — but conditional on the other one binding, the number
       printed is a real stamp either way, and the row is a ceiling, so DERIVED
       is the honest word for that branch.

       🔴 THE FOUNDING STAMP DID NOT MAKE THIS MARK GO AWAY AND MUST NOT BE
          READ AS HAVING DONE SO. In a mature city the business is older than
          any single worker's career, so `worklife` still binds for essentially
          the whole roster and the grade is still a restatement of the draw.
          What the stamp changed is the OTHER branch: a rebuild used to throw
          every citizen into a site-bound ceiling of 0.0 years and print grade 1
          under the word DERIVED — a wrong number wearing the stronger label.
          Those rows now stay worklife-bound and stay marked SAMPLED. The mark
          moved in the direction of MORE honesty, not less, and the only thing
          that could retire it is a real per-citizen hire date. */
    sampled: tenureFrom === 'worklife',
    grade, cap, rungs, capped: rungs > cap,
    ladder: levels.length,
    tenureYears: tenure,
    tenureFrom,
    workedYears, siteYears, siteFrom, siteKey,
    /* ⏱ The business's own age, and the two numbers it was derived from, so a
       reader can check the subtraction instead of trusting it. `firmYears` is
       null — never 0 — when the firm carries no stamp; `firmAgeWhy` says which
       kind of absence it is. `ceilFrom` names the term that would have capped
       tenure if the worklife had not. */
    firmYears, firmDays, foundedDay, econDay: day, firmAgeWhy, ceilFrom,
    gradeYears: clk.gradeYears,
    firm: { id: f.id, name: f.name || emp.name, level: cap, levelName: capDef.name, levelIco: capDef.ico,
            rung: f.rung || null },
    /* A citizen past the model's own retirement age who is still on a firm's
       books. Reported, never hidden — it is a true statement about the roster. */
    pastRetirement: a.years >= clk.retireAge,
    age: a.years,
  };
}

/* ── 🪦 IS THERE MORTALITY? ───────────────────────────────────────────────
   🔴 THIS FUNCTION EXISTS BECAUSE THE ANSWER USED TO BE HARD-CODED. Every
      sentence in this file that ended "…no named citizen ever dies, retires
      off the roster or leaves" was true when it was written and is a LIE the
      moment a removal verb exists. The fix is not to retype the opposite
      sentence — that would be the same mistake with the sign flipped, and it
      would be wrong in every build where /src/mortality 404s. It is to make
      the claim a READ, so the panel says whichever of the two is true here.

   TWO INDEPENDENT THINGS HAVE TO BE TRUE and they fail differently:
     canRetire  the citizens layer exposes MythicCitizens.retire(id, cause).
                That verb is node-city's (CITIZENS_API), i.e. the layer that
                MINTS people — which is exactly where seed()'s rejection note
                said it would have to live. Absent ⇒ nothing can leave the
                roster except citEnsure()'s LIFO trim, and the old sentence is
                still the true one.
     live       /src/mortality is mounted and driving it. The verb existing
                and nobody calling it looks identical from here and is not the
                same city, so it is reported separately rather than folded in.

   ⚠ STILL READ-ONLY. This module does not call retire() and must not: two
     layers writing one roster is the second-citizen-store bug facts.js exists
     to refuse. What changed is only that the disclosure is now sourced. */
export function mortality() {
  const M = CITS();
  const canRetire = !!(M && typeof M.retire === 'function');
  const mo = MORTALITY();
  let rep = null;
  if (mo) { try { rep = mo.report(); } catch (e) { rep = null; } }
  const live = !!(canRetire && rep && rep.ok);
  /* Deaths are the mortality layer's lifetime counter, not anything derived
     here. Null — never 0 — when it cannot be asked, because "no deaths yet"
     and "no death model" are different cities and 0 reads as the first. */
  const deaths = live && Number.isFinite(+rep.deaths) ? +rep.deaths : null;
  const why = canRetire
    ? (live ? null
            : (mo ? '/src/mortality is loaded but not mounted, so nothing is calling the verb'
                  : 'the roster can be retired (MythicCitizens.retire) but /src/mortality is not mounted, so nothing is driving it'))
    : 'the citizens layer exposes no removal verb, so nobody can be taken off the roster at all';
  /* The one sentence every consumer of this file wants, written once here so
     the Age row, the drift line and any driver all quote the SAME words.
     Present tense both ways — it is a statement about this city right now. */
  const note = live
    ? 'named citizens now die: /src/mortality retires the OLDEST resident (never citEnsure()’s ' +
      'newest-first trim, which is emigration) as the city’s own death rate falls due' +
      (deaths != null ? ', ' + (deaths >= 1 ? deaths.toFixed(0) + ' so far in this city' : 'none yet in this city') : '')
    : 'no named citizen dies, retires off the roster or leaves, so they all age together on one ' +
      'clock while the city’s own pyramid does not follow them' +
      /* The reason is only worth a clause when it is NEWS. "there is no verb"
         is the same statement the sentence just made; "the verb exists and
         nothing is calling it" is a different city and the player should be
         told which one they are in. */
      (canRetire ? ' — ' + why : '');
  return { ok: true, canRetire, live, deaths, why, note };
}

/* ── 📊 THE PROOF SEAM ────────────────────────────────────────────────────
   Both distributions, side by side, so "these ages match the city's pyramid"
   is falsifiable rather than asserted. `dev` is the largest share deviation
   between the roster and the frame it was dealt from; with Hamilton
   apportionment it is bounded by one person, i.e. by 1/n — AT THE MOMENT OF
   THE DEAL, and that qualifier is the whole of what follows.

   🔴 THE EVIDENCE FOR THE BOUND, AND THE EVIDENCE THAT WAS NOT EVIDENCE.
      The number first quoted for this was "a max deviation of 1.32% against a
      one-person bound of 2.50%", measured in the page driver. That measurement
      was empty and must not be quoted again: the driver raises game.pop.npc to
      500, which lifts the NAMED ROSTER to 40 while MythicDemographics still
      counts the REAL city — 4 people, of whom the entire `young` band is 0.44
      of a person. 1.32% was Hamilton's rounding residue against a pyramid with
      no content in it.
      The claim is nonetheless TRUE, and here is the measurement that shows it:
      3 pyramids (working-age-heavy, senior-light, senior-heavy) × 10 roster
      sizes from 1 to 200 — 30 of 30 inside the one-person bound, worst case
      0.77% against 2.50% at n = 40. That run is .gauntlet/critlife-2-dist.mjs
      and it is the number to cite.

   🔴 …AND THE BOUND WAS ONLY MET AT t = 0, UNTIL THE ROSTER GOT MORTALITY.
      READ THIS TABLE AS HISTORY, NOT AS A STANDING CLAIM. It measures a roster
      with NO EXIT: citEnsure trims only when cityPop() shrinks and pops from
      the END, so the people who never went were exactly the ones dealt first,
      while every stamp aged on one live clock. That is still the shape of any
      build where /src/mortality is absent, which is why the numbers stay here.
      Static roster of 40, live clock, nothing else touched:

          real hours   0     2     3      24      80        400
          max dev      0.77% 0.77% 2.63%  10.77%  25.77%    85.13%
          bound        2.50% ————————————————————————————————————
                                   ↑ first breach, 3 hours in

      At +80 h the roster holds ZERO young adults against a city reporting
      25.8%; at +400 h it is 39/40 senior with 30 of them past the life
      expectancy the same derivation produces; at +100 y every named citizen is
      119–178 years old. Three hours is one evening of play, so this was not a
      slow burn and it was not a corner.

   ✅ AND THAT IS THE ROW THAT GOT BUILT. seed() rejected ageing-out on the
      grounds that it needs a WRITER and this module is read-only — and said
      where the writer would have to live: "the citizens layer that mints
      them". It now lives there (node-city CITIZENS_API.retire), /src/mortality
      drives it against the city's own death rate, and it takes the OLDEST
      resident rather than citEnsure()'s newest. So the mechanism that made
      this table inevitable is gone, and the honest report is no longer one
      fixed sentence. `drift` below ASKS mortality() which city this is and
      says the true one; it never asserts either. A disclosure that has stopped
      being true is just a false claim with a warning triangle on it. */
export function distribution() {
  const clk = clock();
  if (!clk.ok) return { ok: false, why: clk.why };
  const M = CITS();
  if (!M) return { ok: false, why: 'no citizens layer' };
  seed();
  const t = now();
  let roster = [];
  try { roster = M.list() || []; } catch (e) { roster = []; }

  const tgt = targetShares(clk);
  const bands = tgt.ok ? tgt.bands : frameBands(clk);
  const count = Object.create(null);
  for (const g in clk.bands) count[g] = 0;
  let n = 0, unstamped = 0;
  const ages = [];
  for (const c of roster) {
    if (STAMPS[c.id] == null) { unstamped++; continue; }
    const y = yearsOf(c.id, t, clk);
    const g = bandOfYears(clk, y);
    count[g] = (count[g] || 0) + 1; n++;
    ages.push(+y.toFixed(2));
  }
  const rosterShare = Object.create(null);
  for (const g in count) rosterShare[g] = n > 0 ? count[g] / n : 0;

  let dev = 0;
  if (tgt.ok && n > 0) for (const g of bands) dev = Math.max(dev, Math.abs(rosterShare[g] - tgt.shares[g]));

  /* The claim, and whether it currently holds. `bound` was already reported;
     what was missing was anybody saying out loud when it stops being met, and
     WHY it stops — the reason is never sampling error, it is ageing between
     deals. Which KIND of ageing depends on whether this build has mortality,
     so `cause` below reads it rather than naming one. See the header block. */
  const bound = n > 0 ? 1 / n : null;
  const withinBound = (tgt.ok && n > 0) ? dev <= bound : null;
  /* ⚠ NOT ages[ages.length - 1]: `ages` is in ROSTER order here and is not
     sorted until the return literal below, so that read gave whoever happened
     to be last on the roster and called them the oldest. */
  let oldest = null;
  for (const y of ages) if (oldest == null || y > oldest) oldest = y;
  /* ⚠ THE CAUSE CLAUSE IS A READ, NOT A CONSTANT. It used to end "…no named
     citizen ever dies, retires off the roster or leaves", which was the true
     explanation right up until the roster was given a removal verb and would
     have gone on being printed, in the player's face, for ever after. With
     mortality live the drift is real but its cause is different — the oldest
     leave, the frame moves faster than they do, and new arrivals are dealt
     against the frame as it stands — so the sentence says THAT instead. */
  const mo = mortality();
  const cause = mo.live
    ? 'the oldest residents are now retired off the roster by /src/mortality' +
      (mo.deaths != null && mo.deaths >= 1 ? ' (' + mo.deaths.toFixed(0) + ' deaths so far)' : '') +
      ', so this is lag rather than a one-way slide: the deal is only re-made when somebody ' +
      'new is dealt in, and the city’s pyramid moves between those moments'
    : 'no named citizen dies, retires off the roster or leaves, so they simply age together and ' +
      'the pyramid moves without them — ' + mo.why;
  const drift = withinBound === false
    ? 'the roster no longer reproduces the city’s pyramid: the largest band is out by ' +
      (dev * 100).toFixed(2) + '% against a one-person bound of ' + (bound * 100).toFixed(2) +
      '%. Hamilton apportionment met that bound when these people were dealt; it says nothing ' +
      'about afterwards, and ' + cause +
      (oldest != null ? ' (the oldest is now ' + oldest.toFixed(1) + ')' : '')
    : null;

  return {
    ok: true, n, unstamped, bands,
    withinBound, drift,
    city: tgt.ok ? tgt.city : null,
    cityTotal: tgt.ok ? tgt.cityTotal : null,
    frameShare: tgt.ok ? tgt.shares : null,
    frameTotal: tgt.ok ? tgt.frameTotal : null,
    rosterCount: count, rosterShare, maxShareDev: dev,
    bound,
    ages: ages.sort((a, b) => a - b),
    why: tgt.ok ? null : tgt.why,
  };
}

/* Everything about one person in one object — the read a driver wants, because
   asserting on a rendered string is asserting on a screenshot. */
export function explain(id) {
  return { id: String(id), clock: clock(), age: ageOf(id), career: careerOf(id), stamp: STAMPS[String(id)] };
}

/* ── 💾 PERSISTENCE ───────────────────────────────────────────────────────
   The slice is one map of integers. `FOREIGN` carries any key a NEWER build
   wrote that this one does not understand, straight back out on the next save —
   the same instinct SaveShelf itself applies one level up, where a module that
   never mounted keeps its slice rather than having it erased. */
export function save() {
  const out = {};
  if (FOREIGN) for (const k in FOREIGN) out[k] = FOREIGN[k];
  out.v = 1;
  const b = {};
  for (const k in STAMPS) b[k] = STAMPS[k] | 0;
  out.b = b;
  return out;
}

export function load(p) {
  STAMPS = Object.create(null);
  FOREIGN = null;
  if (!p || typeof p !== 'object') return 0;
  const keep = {};
  for (const k in p) if (k !== 'v' && k !== 'b') keep[k] = p[k];
  if (Object.keys(keep).length) FOREIGN = keep;
  const src = (p.b && typeof p.b === 'object') ? p.b : {};
  let n = 0;
  for (const k in src) {
    /* Hostile input is a real case — a hand-edited save, a truncated sync. An
       id that is not "c<n>" or a stamp that is not finite is DROPPED rather
       than carried in: a bad stamp becomes an age of NaN years, and one NaN on
       a panel reads as a broken feature rather than as a bad byte. */
    if (!/^c\d+$/.test(k)) continue;
    const v = Number(src[k]);
    if (!isFinite(v)) continue;
    /* floor(), not round(), for the same one-directional reason seed() floors:
       a stamp may only ever move EARLIER as it passes through an integer, so a
       restored age can never read below the age that was saved. Saved stamps
       are already integers, so this is a no-op on anything this build wrote —
       it is here for the hand-edited fractional value, which is the only way to
       reach it. */
    STAMPS[k] = Math.floor(v); n++;
  }
  return n;
}

export function reset() { STAMPS = Object.create(null); FOREIGN = null; CLK = null; }
export function stamps() { const o = {}; for (const k in STAMPS) o[k] = STAMPS[k]; return o; }
export function count() { let n = 0; for (const k in STAMPS) n++; return n; }
