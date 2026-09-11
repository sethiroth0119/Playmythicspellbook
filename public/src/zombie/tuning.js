/* ════════════════════════════════════════════════════════════════════════════
   🧟 ZOMBIE RISK — every number, in one place.
   ----------------------------------------------------------------------------
   The `_opEcon()` pattern the project mandates: no magic constant is written
   down anywhere else in this feature, so a tuning pass is one file and a diff
   of it is the whole change. risk.js imports this and NOTHING else.

   ── THE UNITS, STATED ONCE, BECAUSE MIXING THEM IS THE CLASSIC BUG ─────────
   Everything here that is a duration is in SIMULATED SECONDS, the same dt the
   host frame loop hands raidTick(). Everything that is a rate is PER CITY DAY,
   because that is the unit the player reads on the vitals trend. `daySec` is
   the bridge between them and the HOST supplies the live value (CITY_DAY_MIN ×
   60); the number below is a fallback for a headless import, not a truth.

   ⚠ NEVER read wall clock in this feature. node-city's own trend code records
     the measured defect at index.html:31299 — performance.now() desyncs from
     simulated time on a backgrounded tab or an __nc.step() fast-forward and
     prints numbers no formula could produce. The risk clock accumulates the dt
     it was actually given.
   ════════════════════════════════════════════════════════════════════════════ */

export const ZOM = {
  /* One city "day" in simulated seconds. CITY_DAY_MIN = 20 real minutes. */
  daySec: 20 * 60,

  /* ── THE CHECK INTERVAL ───────────────────────────────────────────────────
     The outbreak is resolved on a beat, exactly like raidTick's wave, and for
     the same reason: a continuous per-frame roll cannot be forecast, cannot be
     shown to the player before it resolves, and cannot be reproduced from a
     seed. 30 real minutes = 1.5 city days.
     🔴 THIS IS ALSO THE NO-SURPRISE DWELL. The warning must have been on
        screen for one FULL interval before any roll is permitted, so the
        earliest possible outbreak is one interval after the card first turns
        amber. See permit() in risk.js — it is a hard gate, not a tendency. */
  /* 🔴 THE MASTER SWITCH, AND IT IS OFF. See the header of this file's own
     progress page: the engine destroys buildings, has never been played, and
     does not yet confirm to the player that burial capacity fixed it. Until
     both are true this stays false and permit() refuses every roll.
     Everything else — the risk card, the forecast, the deathcare meter, the
     log — keeps working, so the feature is visible and inert rather than
     invisible and armed. */
  live: false,
  interval: 1800,

  /* ── THE TWO THRESHOLDS ───────────────────────────────────────────────────
     watch < arm, and that ordering is load-bearing: risk moves continuously
     (see tau), so it cannot reach `arm` without having passed `watch` first.
     The dwell gate then does not have to trust that — it measures — but the
     ordering is what makes the dwell gate cheap instead of punitive. */
  watch: 35,           // the card turns amber and the warning starts counting
  arm: 60,             // below this the roll is not taken at all
  hysteresis: 6,       // risk must fall this far below `watch` to clear the warning

  /* Probability at the check, as a function of risk above `arm`.
     p(risk) = pMax × ((risk - arm) / (100 - arm)) ^ curve
     A curve above 1 keeps the low end genuinely low, so crossing `arm` is a
     warning and not a sentence. p is DISPLAYED in the panel before the roll
     that uses it — see criterion 4: this is not a coin flip, it is a published
     probability against a seeded draw. */
  pMax: 0.55,
  curve: 1.35,

  /* ── HOW A BACKLOG BECOMES A RISK NUMBER ──────────────────────────────────
     pressure = unburied / reference,  reference = max(floorBacklog, pop × perPop)
     Scaled to population because 12 unburied in a town of 20 is a catastrophe
     and in a city of 400 is a bad week. floorBacklog stops a POP_MIN city (4)
     from having a reference of one and a half bodies.

     🔴 AND THE CURVE IS RATIONAL, NOT CLAMPED — a measured correction, not a
        taste. The first cut was `100 × min(1, pressure)`, which reads fine and
        is monotone, but it SATURATES: past the reference backlog every extra
        body reads 100 and, worse, so does every body you bury. The driver
        caught it as the check it was written to catch — with 14 unburied
        against a reference of 13.2, a SECOND CLINIC moved the meter by exactly
        0.0000, which is the one thing prevention is not allowed to do.
        risk = 100 × p / (p + knee) is strictly increasing on the whole of
        [0, ∞), asymptotic to 100 and never equal to it, so burying a body
        always moves the number the player is watching.
        knee = 3/7 puts pressure = 1 (a backlog equal to the reference) at
        exactly 70 — comfortably inside the ARM band, which is the calibration
        that matters. */
  perPop: 0.22,
  floorBacklog: 8,
  knee: 3 / 7,

  /* Easing time constant, seconds. risk moves toward its target by
     (target - risk) × (1 - e^(-dt/tau)) — the shape node-city's containment
     dial already uses. ~10 real minutes to close 63% of a gap, so the meter
     is something the player watches move, not a step function.
     🔴 tau is INDEPENDENT OF CAPACITY and that is the whole monotonicity
        proof. See tick() in risk.js. */
  tau: 600,

  /* ── THE WAVE ─────────────────────────────────────────────────────────────
     The strength source is the backlog itself: the horde IS the unburied.
     That is the one substantive difference from raidTick, whose strength comes
     from a wave counter. Everything downstream — the defence tally, the ammo
     fuel, the breach — is raidTick's, called through the host. */
  strBase: 12,
  strPerBody: 2.4,
  strPerWave: 5,       // repeat outbreaks escalate, as raid waves do

  /* A breach kills people, and those dead join the backlog. This is the
     escalation the player can see coming in the forecast: the projection runs
     it forward. Capacity still dominates it — fewer bodies ⇒ weaker horde ⇒
     fewer new dead — which is why adding capacity can never raise risk. */
  deadPerBreach: 0.30,     // × the shortfall (strength - effective defence)
  /* 🔴 …AND HARD-CAPPED AT A FRACTION OF THE LIVING, WHICH IS NOT COSMETIC.
     deadPerBreach alone is a feedback loop and the driver measured its GAIN:
     strength ≈ strPerBody × unburied, so a breach returned
     0.30 × 2.4 = 0.72 × unburied new bodies, and a defenceless city went
     10 → 40 → 91 → 182 → 612 unburied in five waves. A loop with gain above 1
     is not a difficulty curve, it is an unrecoverable state, and it arrives
     two waves after the first mistake.
     Capping the toll at a fraction of the POPULATION puts the gain under 1 in
     any city — an outbreak can kill up to 5% of the living, which is a
     disaster, and cannot manufacture bodies out of the bodies it is made of. */
  deadCapFrac: 0.05,       // × current population, per breach
  clearOnHold: 0.60,       // fraction of the backlog put down and interred on a HELD wave
  riskAfterHold: 0.30,     // the meter is knocked down by a win…
  riskAfterBreach: 0.75,   // …and barely dented by a loss

  /* Damage. A strike is one damageTile() call and nothing else in this
     feature touches a tile. */
  strPerStrike: 14,        // shortfall per building struck
  maxStrikes: 4,           // a hard cap; an unbounded loop over the shortfall can level a city
  razeRatio: 2.5,          // shortfall ÷ defence above which a strike DESTROYS rather than damages

  /* The counter-building is ONE ROW in node-city's WX_SHIELD table, keyed
     'outbreak'. Nothing about it is configured here — per/cap live on that row
     beside fire, tornado and anomaly, so the mitigation rule has exactly one
     home. This key is only the lookup. */
  shieldHazard: 'outbreak',

  /* Forecast horizon, in check intervals. 40 × 30 min = 20 real hours ≈ 60
     city days — long enough that a slow backlog still produces a date rather
     than "never", short enough that the projection loop is 40 iterations. */
  horizon: 40,

  /* 🔴 THE PROJECTION'S STEP SIZE, AND IT IS A MEASURED NUMBER.
     The first cut projected one whole `interval` per iteration, which is 40
     iterations and looks obviously right. It is not: the easing is
     exponential, so stepping 1800 s at once applies the WHOLE interval's
     deaths and then eases 95% toward the resulting target, while the live
     engine (1 s beats) follows a target that rises gradually. The coarse step
     therefore over-states risk, over-states p, and the panel promised outbreaks
     roughly three times sooner than they arrived — measured at 33% fired
     against a claimed 50%. Sub-stepping at 30 s costs at most 2,400 iterations
     of pure arithmetic per forecast and brings the projection onto the same
     curve the engine walks. */
  forecastStep: 30,

  /* The deaths-per-day estimate the forecast projects forward is an EMA over
     roughly this many city days. Short enough to react to a plague, long
     enough that one quiet tick does not forecast immortality.
     ⚠ ALSO MEASURED. At 1.5 days the estimate was still only 60% converged two
       city days in, so a city with a steady 12/day death rate forecast against
       7/day and promised more time than it had. 0.75 reaches 94% in three
       days, which is what a line reading "at the current rate" has to mean. */
  rateHalfLifeDays: 0.75,
};

export default ZOM;
