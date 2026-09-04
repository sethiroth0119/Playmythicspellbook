/* ═══════════════════════════════════════════════════════════════════════════
   🦠 THE OUTBREAK CATALOG — six viruses a city can catch, and the six cures
   that stop them.

   This is design-doc steps 10–13 (smuggling-and-contamination.md), the ones
   `public/node-city/index.html:21229` says out loud are NOT built:

       "🔴 WHAT THIS IS NOT. There is no infection state machine, no district
        spread, no global contamination and no world events here."

   That comment was accurate for its round. It is what this file changes, and
   the note beside the Containment Lab has been updated to point here rather
   than left to lie.

   ─────────────────────────────────────────────────────────────────────────
   🔴 THE ONE RULE THAT SHAPED EVERY NUMBER BELOW: A CITY NEVER CATCHES A
      VIRUS AT RANDOM.

   Every virus here is the consequence of a condition the city was ALREADY
   modelling and the player could already see on the Vital Signs panel —
   starved Health coverage, water the purifiers cannot keep up with, housing
   packed to the cap, a Hope collapse, a famine, or an Anomaly Lab run at a
   containment the player chose. A random plague is a dice roll that punishes
   nothing and teaches nothing; it makes the player feel cheated and it makes
   the Vital Signs panel decorative. A plague with a VECTOR makes the panel
   load-bearing — the outbreak is the bill arriving for a number that was
   already red.

   ⚠ REJECTED, and it is worth writing down because it is the obvious design:
     a flat "0.5% chance of a random plague per cycle". It was built, driven
     for ~40 city-days, and it read as noise: outbreaks landed on cities doing
     everything right and skipped cities that were visibly rotting. The vector
     model below fires on exactly the cities that earned it, and a city with
     all seven vitals green is genuinely, permanently safe. That is not a
     difficulty concession — it is the whole lesson the system exists to teach.

   ─────────────────────────────────────────────────────────────────────────
   💊 AND THE SECOND RULE: RESEARCH DOES NOT CURE ANYONE.

   The Research Facility SYNTHESISES doses. The Medical Corp. ADMINISTERS
   them. A player with a full lab and no clinic has a freezer full of vials
   and a dying city, and that is deliberate — it is what makes the Medical
   Corp. worth its 450,000 🔥 instead of being a Health-coverage trinket.
   See `plague.city.js` → shipDoses() for the seam.
   ═══════════════════════════════════════════════════════════════════════ */

/* ⏱ THE CLOCK. Everything below is per CITY-MINUTE, the unit economyTick and
   opsLabTick already run on. A city "day"/cycle is CITY_DAY_MIN = 20 of them,
   so `/day` in a comment means ×20. Quoting rates per minute rather than per
   day is not a style choice: the ops layer directly above learned this the
   hard way (see the ÷50 note at index.html:21235) and mixing the two scales in
   one file is how that bug happened. */
export const PLAGUE_TICK_UNIT = 'city-minute';

/* 🌱 SEED FRACTION. An outbreak does not begin at zero — zero never grows on a
   logistic curve. This is the fraction of the citizenry that is already
   carrying it on the day it is detected. */
export const PLAGUE_SEED_FRAC = 0.02;

/* 🛡 THE ALL-CLEAR. Below this infected fraction the outbreak is over: the
   last carriers recover on their own and the virus is struck from the board.
   NOT zero — a logistic decay approaches zero asymptotically and would leave
   every city permanently carrying six dormant plagues at 0.0001%, which reads
   as "we never actually cured it" and is a support ticket, not a mechanic. */
export const PLAGUE_CLEAR_FRAC = 0.012;

/* 🚪 THE GRACE PERIOD. City-minutes of life a NEW city gets before any vector
   is allowed to fire. A city cannot be born mid-plague — the first five
   minutes of a save are spent laying roads with no Clinic and no purifier, and
   every vector below would trip instantly. Measured against `game.cityAge`,
   the SIMULATED clock, so a tab left open overnight does not burn it. */
export const PLAGUE_GRACE_CITY_MIN = 90;

/* ⏳ RE-CATCH COOLDOWN. City-minutes after a virus is cured before the same
   virus may be caught again. Without it a city that cures Cinder Pox while
   still overcrowded re-catches it on the very next tick, the player sees the
   cure "not work", and the bug report is unanswerable because the code is
   behaving exactly as written. */
export const PLAGUE_RECATCH_CD_MIN = 240;

/* 🔒 CONCURRENT OUTBREAK CAP. Two at once is a crisis; four at once is an
   unreadable panel and an unwinnable city, because cure research is serial
   through one Research Facility. Grey Marrow is exempt as an OPPORTUNIST (see
   its entry) — it is allowed to be the third. */
export const PLAGUE_MAX_ACTIVE = 2;

/* ═══════════════════════════════════════════════════════════════════════════
   THE SIX VIRUSES

   Field contract — every one of these is read by plague.city.js and none is
   decorative:

     id          save key. NEVER renamed: it is written into city saves.
     name/ico    UI only.
     tier        1–3. Drives panel colour and the "how bad is this" sort.
     vector      human-readable cause, shown in the outbreak card. This is the
                 player's entire diagnosis — if it does not name the number
                 they can see on the Vital Signs panel, it is a bad string.
     catch(c)    THE VECTOR TEST. Given a city snapshot, returns 0..1 =
                 pressure. 0 means it cannot be caught at all right now.
                 Pure and side-effect free — it is called every tick and also
                 by the diagnostics harness to prove a city is safe.
     r0          logistic spread per city-minute (see spreadStep).
     lethality   fraction of the INFECTED who die per city-minute.
     effects     what it does to the NPCs, applied by applyEffects():
                   labour     0..1 multiplier on the city's labour output
                   morale     points/min pushed onto wellbeing.morale
                   health     points/min pushed onto vitals.health
                   waterMul   demand multiplier while symptomatic (fever)
                   foodMul    demand multiplier (appetite loss < 1)
     symptom     one line, shown on the NPC roster for an infected citizen.
     cure        id of the cure in PLAGUE_CURES that clears it.
   ═══════════════════════════════════════════════════════════════════════ */

/* Small helper so every `catch` reads the same way: how far BELOW a line a
   value has fallen, as 0..1 of the distance from the line to zero. Above the
   line it is 0 — not a small number, exactly 0 — because a vector that is
   "nearly firing" on a healthy city is a vector that eventually fires on a
   healthy city, and that is the random-plague design this file rejected. */
const below = (v, line) => (v >= line ? 0 : Math.max(0, Math.min(1, (line - v) / (line || 1))));
/* And its mirror, for the vectors that fire on TOO MUCH of something. */
const above = (v, line, ceil) => (v <= line ? 0 : Math.max(0, Math.min(1, (v - line) / ((ceil - line) || 1))));

export const PLAGUE_VIRUSES = {

  /* ── 1 ─────────────────────────────────────────────────────────────────
     The industrial one. Cheap to catch, cheap to cure, and its job is to be
     the FIRST plague almost every city meets — it teaches the whole loop
     (detect → research → ship → administer) at a lethality that cannot
     actually kill a city. Do not make this one dangerous. */
  ashlung: {
    id: 'ashlung', name: 'Ashlung Fever', ico: '🫁', tier: 1,
    vector: 'Industrial smoke with no clinic behind it — Health coverage under 70% while the city runs 4+ heavy operations.',
    catch: (c) => Math.min(1, below(c.cov.health, 0.70) * (c.heavyOps >= 4 ? 1 : 0) * (0.6 + 0.1 * (c.heavyOps - 4))),
    r0: 0.035, lethality: 0.0011,
    effects: { labour: 0.88, morale: -0.10, health: -0.28, waterMul: 1.10, foodMul: 1.00 },
    symptom: 'is coughing ash and cannot finish a shift',
    cure: 'antiserum',
  },

  /* ── 2 ─────────────────────────────────────────────────────────────────
     The crowding one. FASTEST spread in the catalog and the lowest lethality
     in it — Cinder Pox is a morale and labour event, not a body count. It is
     the virus that punishes building housing without building the services to
     go under it, which is the single most common way a city is played badly. */
  cinderpox: {
    id: 'cinderpox', name: 'Cinder Pox', ico: '🔴', tier: 1,
    vector: 'Housing packed past 90% of cap with Remedies stock under 8 — nothing to hand out when it starts.',
    catch: (c) => Math.min(1, above(c.popFrac, 0.90, 1.0) * below(c.stock.remedies, 8)),
    r0: 0.090, lethality: 0.0006,
    effects: { labour: 0.82, morale: -0.34, health: -0.22, waterMul: 1.05, foodMul: 0.92 },
    symptom: 'is covered in pox and has been sent home',
    cure: 'poxwash',
  },

  /* ── 3 ─────────────────────────────────────────────────────────────────
     The water one. Its effects are the nastiest FEEDBACK LOOP in the file and
     that is the point: a fever raises water demand 35%, which pushes Water
     coverage further down, which is the very thing that caused it. A city that
     ignores Ferric Rot does not decline linearly — it accelerates. This is the
     one virus where "I'll deal with it next cycle" is a losing move, and the
     cure recipe is priced accordingly (cheap, because you need it FAST). */
  ferricrot: {
    id: 'ferricrot', name: 'Ferric Rot', ico: '🟤', tier: 2,
    vector: 'Water coverage under 65% — the mains are drawing faster than the purifiers can clean.',
    catch: (c) => below(c.cov.water, 0.65),
    r0: 0.055, lethality: 0.0024,
    effects: { labour: 0.80, morale: -0.22, health: -0.45, waterMul: 1.35, foodMul: 0.88 },
    symptom: 'is feverish and has not kept water down for two days',
    cure: 'chelate',
  },

  /* ── 4 ─────────────────────────────────────────────────────────────────
     🟣 THE ONE THE CONTAINMENT LAB WAS ALWAYS FOR.

     `index.html:21911` promised that containment "is not allowed to be a
     number with no consequence" and then listed only two consequences, both
     local to the facility: a price discount and an incident that burns a
     batch. It closed with "No districts, no infection counts, no world state —
     that is deliberate and it is where this round stops."

     This is where that round restarts. Below 55% containment the Anomaly X
     line stops being a pricing problem and starts being an epidemiological
     one, and the pressure scales with TIER — a Back-Room Cut leaking at 40%
     is a bad week, a tier-5 Anomaly Lab leaking at 40% is the worst thing
     that can happen to a city.

     ⚠ DELIBERATELY NOT A CONTAINMENT-INCIDENT TRIGGER. The obvious wiring is
       "an incident rolls an outbreak", and it is wrong: incidents are already
       random, so hanging the plague off one makes the plague random too and
       lands this virus straight back in the design the top of this file
       rejects. Sustained low containment is a CHOICE the player is making
       every minute — Overdrive is a switch, lapsed investments are a supply
       decision — so hanging it off the sustained state keeps the outbreak
       something the player did, not something that happened to them. */
  violetwither: {
    id: 'violetwither', name: 'Violet Wither', ico: '🟣', tier: 3,
    vector: 'Anomaly X leaking — a sited Anomaly Lab held under 55% containment. Higher tiers leak harder.',
    catch: (c) => (c.lab.sited ? Math.min(1, below(c.lab.containment / 100, 0.55) * (0.45 + 0.14 * c.lab.tier)) : 0),
    r0: 0.048, lethality: 0.0060,
    effects: { labour: 0.70, morale: -0.40, health: -0.62, waterMul: 1.15, foodMul: 0.80 },
    symptom: 'has violet tracking under the skin and is not lucid',
    cure: 'violetlysate',
  },

  /* ── 5 ─────────────────────────────────────────────────────────────────
     The despair one, and the only virus in the catalog that is barely lethal
     and still catastrophic. Hollow Sleep does not kill your citizens — it
     stops them working (labour 0.55, the harshest figure here). A city can
     survive it indefinitely and be unable to produce anything while it does,
     which makes it the plague that is most tempting to ignore and most
     expensive to have ignored.

     ⚠ The morale effect is only -0.18 despite Hope being the vector, and that
       is on purpose: a bigger number closes a loop that has no exit. Hope
       falls → Hollow Sleep → Hope falls faster → deeper Hollow Sleep, with no
       lethality to ever end it and no way for a player to climb out. Ferric
       Rot is allowed its feedback loop because its lethality resolves it one
       way or the other; this one would just hang. */
  hollowsleep: {
    id: 'hollowsleep', name: 'Hollow Sleep', ico: '😴', tier: 2,
    vector: 'Hope under 30 in a city handling Memory Shards — the old world\'s recorded minds are contagious.',
    catch: (c) => Math.min(1, below(c.vitals.hope / 100, 0.30) * (c.shardsHandled ? 1 : 0.25)),
    r0: 0.042, lethality: 0.0004,
    effects: { labour: 0.55, morale: -0.18, health: -0.20, waterMul: 0.95, foodMul: 0.75 },
    symptom: 'has not woken for three days and is dreaming someone else\'s life',
    cure: 'wakeserum',
  },

  /* ── 6 ─────────────────────────────────────────────────────────────────
     ☠️ THE OPPORTUNIST. Grey Marrow cannot start a crisis — read its `catch`:
     it requires an outbreak to ALREADY be running. It is what turns a bad
     situation into a lost city, and it exists so that the failure state of
     this system is a spiral the player can see coming and still lose to,
     rather than a single bad number.

     It is exempt from PLAGUE_MAX_ACTIVE for exactly that reason (see
     plague.city.js → tryCatch). Capping it out would mean the worst thing in
     the catalog can only appear on a city that is not yet in trouble, which
     is precisely backwards. */
  greymarrow: {
    id: 'greymarrow', name: 'Grey Marrow', ico: '☠️', tier: 3,
    vector: 'Famine on top of an existing outbreak — Food coverage under 55% while another virus is loose.',
    catch: (c) => (c.activeCount > 0 ? below(c.cov.food, 0.55) : 0),
    r0: 0.038, lethality: 0.0085,
    effects: { labour: 0.62, morale: -0.30, health: -0.70, waterMul: 1.05, foodMul: 1.20 },
    symptom: 'is grey to the lips and the marrow has stopped making blood',
    cure: 'marrowgraft',
  },
};

export const PLAGUE_IDS = Object.keys(PLAGUE_VIRUSES);

/* ═══════════════════════════════════════════════════════════════════════════
   💊 THE SIX CURES — synthesised at the RESEARCH FACILITY, administered at
   the MEDICAL CORP.

   Field contract:
     id        save key, and the value of a virus's `cure`.
     cost      CITY STOCK spent up front, per batch. Charged on START, not on
               completion — a cancelled batch does not refund (see below).
     shards    🧠 Memory Shards from the GAME LEDGER, not city stock. Only the
               two tier-3 cures need them; they are the scarcest thing in the
               game and a tier-1 cure that wanted one would be uncraftable in
               practice.
     minutes   city-minutes of research at ONE staffed Research Facility.
     doses     doses the batch yields. A dose cures ONE citizen — so a big
               city genuinely needs several batches, and starting research
               early is worth more than starting it well-supplied.
     desc      shown on the research card.

   ⚠ COST IS CHARGED ON START AND NEVER REFUNDED. This was the other way round
     first (charge on completion) and it was strictly worse: it let a player
     queue a batch they could not afford, watch the timer, and find out at 0:00
     that nothing was made — a fifteen-minute punishment for a mistake the UI
     could have refused in the first place. Charging up front means a batch
     that STARTED will always FINISH, which is the property the whole panel's
     honesty rests on. Cancelling is therefore destructive and gcConfirm()s.

   💱 PRICING. These are city-stock recipe numbers in the same band as the
     Containment Lab's OPS_INVEST (`⚙️ 0.25/min`, `🩹 0.30/min`) — i.e. a cure
     batch costs roughly what a few city-days of one containment investment
     costs. They are NOT operation pricing and deliberately do not go through
     `_opEcon()`, which prices BUSINESSES (the 400,000 🔥 at City Hall). Same
     rule as every other production recipe in the city. */
export const PLAGUE_CURES = {
  antiserum: {
    id: 'antiserum', name: 'Ashlung Antiserum', ico: '💉', cures: 'ashlung',
    cost: { reagents: 6, remedies: 4 }, shards: 0, minutes: 8, doses: 40,
    desc: 'A bronchial antiserum. Crude, fast to run, and it clears Ashlung out of a lung in a day.',
  },
  poxwash: {
    id: 'poxwash', name: 'Pox Wash', ico: '🧴', cures: 'cinderpox', 
    cost: { reagents: 4, remedies: 6, goods: 4 }, shards: 0, minutes: 6, doses: 60,
    desc: 'A topical suspension issued by the crate. Cinder Pox spreads fastest, so this batches biggest and runs quickest.',
  },
  chelate: {
    id: 'chelate', name: 'Ferric Chelate', ico: '⚗️', cures: 'ferricrot',
    cost: { reagents: 10, remedies: 5, components: 3 }, shards: 0, minutes: 11, doses: 45,
    desc: 'Binds the iron the rot lays down in the blood. Also worth running the purifiers harder — the chelate treats people, not water.',
  },
  violetlysate: {
    id: 'violetlysate', name: 'Violet Lysate', ico: '🟪', cures: 'violetwither',
    cost: { reagents: 18, remedies: 10, components: 6 }, shards: 2, minutes: 18, doses: 35,
    desc: 'Anomaly X, denatured and turned against itself. The lab that caused this is the only place that can undo it.',
  },
  wakeserum: {
    id: 'wakeserum', name: 'Waking Serum', ico: '☕', cures: 'hollowsleep',
    cost: { reagents: 9, remedies: 6, goods: 5 }, shards: 0, minutes: 13, doses: 50,
    desc: 'Cuts the shard-dream loose from the sleeper. Nobody has explained why it tastes of someone else\'s coffee.',
  },
  marrowgraft: {
    id: 'marrowgraft', name: 'Marrow Graft', ico: '🦴', cures: 'greymarrow',
    cost: { reagents: 20, remedies: 14, components: 8, rations: 10 }, shards: 3, minutes: 22, doses: 30,
    desc: 'The hardest thing this city can make. Feed the patient first — a graft into a starving body does not take.',
  },
};

export const CURE_IDS = Object.keys(PLAGUE_CURES);
export const cureForVirus = (vid) => {
  const v = PLAGUE_VIRUSES[vid];
  return v ? PLAGUE_CURES[v.cure] || null : null;
};

/* ═══════════════════════════════════════════════════════════════════════════
   THE MATHS — pure, exported, and unit-testable without a city.
   Kept here rather than in the engine so the diagnostics harness can drive a
   whole epidemic curve with no DOM, no save and no THREE.
   ═══════════════════════════════════════════════════════════════════════ */

/* 📈 SPREAD — logistic over the SUSCEPTIBLE fraction. dI/dt = r·I·(1−I−R).

   ⚠ WHY NOT EXPONENTIAL, which is the textbook first move: exponential growth
     has no ceiling, so `inf` sails past 1.0 and the city reports 340% of its
     citizens infected. Clamping that at 1.0 afterwards hides the overshoot but
     not its cause — the curve arrives at 100% far too fast and the player gets
     no plateau, which is the phase where a cure is supposed to land.

   🔴 AND WHY THE `R` TERM IS NOT OPTIONAL — this is the bug the headless
     harness caught before any of it shipped, and it is worth the paragraph
     because the system is worthless without the fix.

     The first version was a plain logistic, r·I·(1−I), with cured citizens
     returned to the general population. Driven end-to-end on a 200-pop city:
     Ferric Rot detected at 2%, a full Ferric Chelate batch (45 doses)
     researched and shipped on the fastest possible schedule, and thirty
     city-minutes later the city was at 21.4% infected — WORSE than the 14.9%
     it had when research started. Every dose worked exactly as designed and
     the epidemic still won, because a citizen cured at minute 12 was
     susceptible again at minute 13 and the clinic was refilling the very pool
     it was draining. A player doing everything right would have watched the
     bar dip and climb back, concluded the cure was broken, and been right.

     Tracking the recovered as IMMUNE fixes it at the model level rather than
     by inflating dose counts until the numbers happen to work. Every dose now
     buys a permanent removal from the susceptible pool, so a cure is progress
     that cannot be undone — which is what makes shipping doses feel like
     winning instead of bailing. It is also simply the correct model: this is
     the R of SIR, and the plain logistic was SI with an invisible revolving
     door.

   Euler-stepped rather than solved closed-form because dtMin is small (one
   economy tick) and `r` is not constant — quarantine scales it live. */
export function spreadStep(inf, imm, r, dtMin) {
  if (!(inf > 0) || !(dtMin > 0)) return Math.max(0, inf || 0);
  const susceptible = Math.max(0, 1 - inf - Math.max(0, imm || 0));
  const next = inf + r * inf * susceptible * dtMin;
  return Math.max(0, Math.min(1, next));
}

/* ⚰️ MORTALITY. Deaths are a fraction of the INFECTED, not of the population,
   so a 5% outbreak in a huge city kills at the same per-patient rate as a 5%
   outbreak in a small one. Returns a float — the caller accumulates it, because
   rounding every tick to a whole person makes a small city immortal (0.4
   deaths/min rounds to 0 forever). */
export function deathsStep(pop, inf, lethality, dtMin) {
  if (!(pop > 0) || !(inf > 0)) return 0;
  return pop * inf * lethality * dtMin;
}

/* 🏥 ADMINISTERED DOSES. One dose, one citizen — and the recovered move into
   the IMMUNE pool, not back into the susceptible one (see spreadStep for the
   measured reason that distinction is the whole system). Returns
   { used, cured }; `used` can be less than the doses offered when there are
   fewer sick people left than vials, which is the happy path and must not
   silently burn the surplus. */
export function administer(pop, inf, doses) {
  const sick = pop * inf;
  if (!(sick > 0) || !(doses > 0)) return { used: 0, cured: 0 };
  const cured = Math.min(sick, doses);
  return { used: cured, cured };
}

/* 🧮 The city's total labour multiplier under every active outbreak.
   MULTIPLICATIVE, not additive: two viruses at 0.8 and 0.7 give 0.56, not
   0.5. Additive stacking (1 − Σ(1−m)) hits zero at three concurrent outbreaks
   and a city with zero labour produces literally nothing and can never
   research its way out — an unwinnable state reachable by ordinary play.
   Multiplicative approaches zero and never arrives. */
export function labourMul(active) {
  let m = 1;
  for (const a of active) {
    const v = PLAGUE_VIRUSES[a.id]; if (!v) continue;
    /* Scaled by how much of the city is actually sick — a 3% outbreak is not
       yet a labour event, and a card that says "-45% labour" the minute a
       virus is detected reads as a bug to anyone watching their output. */
    m *= 1 - (1 - v.effects.labour) * Math.min(1, a.inf);
  }
  return Math.max(0.05, m);
}

/* 🩺 SEVERITY, 0..1 — the single number the HUD strip and the panel sort on.
   Weighted toward lethality×infected rather than infected alone, so Violet
   Wither at 10% outranks Cinder Pox at 60%, which is the correct triage order
   and not the one raw prevalence gives you. */
export function severity(a) {
  const v = PLAGUE_VIRUSES[a.id]; if (!v) return 0;
  return Math.max(0, Math.min(1, a.inf * (0.35 + v.lethality * 90)));
}
